import { DatabaseConnection } from '../database/connection';
import { Subscription, CreateSubscriptionInput, PlanType } from '../database/types';
import { logger } from '../utils/logger';

/**
 * 套餐配置
 */
interface PlanConfig {
  validity_days: number;
  price: number;
}

/**
 * 订阅存储层
 */
export class SubscriptionStore {
  private db: DatabaseConnection;
  
  constructor(db: DatabaseConnection) {
    this.db = db;
  }
  
  /**
   * 创建订阅
   */
  async create(input: CreateSubscriptionInput): Promise<Subscription> {
    const planConfig = this.getPlanConfig(input.plan_type);
    
    const startDate = new Date();
    const endDate = new Date(Date.now() + planConfig.validity_days * 24 * 60 * 60 * 1000);
    
    const sql = `
      INSERT INTO subscriptions (
        user_id, plan_type, status, start_date, end_date,
        price, currency, payment_method, auto_renew,
        quota_total, quota_used, quota_remaining,
        max_file_upload, file_upload_used
      )
      VALUES ($1, $2, 'pending', $3, $4, $5, 'CNY', $6, $7, $8, 0, $8, $9, 0)
      RETURNING *
    `;
    
    const params = [
      input.user_id,
      input.plan_type,
      startDate,
      endDate,
      input.price,
      input.payment_method,
      input.auto_renew || false,
      -1,
      -1,
    ];
    
    const subscription = await this.db.queryOne<Subscription>(sql, params);
    
    if (!subscription) {
      throw new Error('Failed to create subscription');
    }
    
    logger.info(`[SubscriptionStore] Created subscription: ${subscription.id} for user ${input.user_id}`);
    return subscription;
  }
  
  /**
   * 获取用户的活跃订阅
   */
  async getActiveSubscription(userId: string): Promise<Subscription | null> {
    const sql = `
      SELECT * FROM subscriptions
      WHERE user_id = $1 
        AND status IN ('active', 'trial', 'exhausted')
        AND end_date > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const subscription = await this.db.queryOne<Subscription>(sql, [userId]);
    
    // 兼容旧数据：字符额度不再是使用权门禁。
    if (subscription?.status === 'exhausted') {
      const activeStatus = subscription.plan_type === 'trial' ? 'trial' : 'active';
      await this.updateStatus(subscription.id, activeStatus);
      subscription.status = activeStatus;
    }
    
    return subscription;
  }

  /**
   * 获取用户最近一条订阅/授权码权益。
   * 用于 /subscription/me 返回 expired/exhausted 等非活跃状态，避免客户端只能看到 404。
   */
  async getLatestSubscription(userId: string): Promise<Subscription | null> {
    return this.db.queryOne<Subscription>(
      'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [userId]
    );
  }
  
  /**
   * 根据ID获取订阅
   */
  async findById(id: string): Promise<Subscription | null> {
    return this.db.queryOne<Subscription>(
      'SELECT * FROM subscriptions WHERE id = $1',
      [id]
    );
  }
  
  /**
   * 更新订阅状态
   */
  async updateStatus(subscriptionId: string, status: Subscription['status']): Promise<void> {
    await this.db.query(
      'UPDATE subscriptions SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [status, subscriptionId]
    );
    
    logger.info(`[SubscriptionStore] Updated subscription ${subscriptionId} status to ${status}`);
  }
  
  /**
   * 激活订阅（支付成功后调用）
   */
  async activateSubscription(subscriptionId: string, paymentId: string): Promise<Subscription | null> {
    const sql = `
      UPDATE subscriptions 
      SET status = 'active', last_payment_id = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    
    const subscription = await this.db.queryOne<Subscription>(sql, [paymentId, subscriptionId]);
    
    logger.info(`[SubscriptionStore] Activated subscription: ${subscriptionId}`);
    return subscription;
  }
  
  /**
   * @deprecated 订阅已改为按有效期授权。保留方法只为兼容旧调用方。
   */
  async consumeQuota(subscriptionId: string, _amount: number): Promise<{ success: boolean; remaining: number }> {
    const subscription = await this.findById(subscriptionId);
    if (!subscription) {
      return { success: false, remaining: 0 };
    }
    return { success: true, remaining: -1 };
  }
  
  /** @deprecated 文件上传数量不再作为套餐门禁。 */
  async incrementFileUpload(subscriptionId: string): Promise<boolean> {
    const subscription = await this.findById(subscriptionId);
    return subscription !== null;
  }
  
  /**
   * 升级订阅
   */
  async upgradeSubscription(
    subscriptionId: string,
    newPlanType: PlanType,
    newPlanConfig: PlanConfig
  ): Promise<Subscription | null> {
    const currentSubscription = await this.findById(subscriptionId);
    
    if (!currentSubscription) {
      return null;
    }
    
    const sql = `
      UPDATE subscriptions 
      SET plan_type = $1,
          quota_total = -1,
          quota_remaining = -1,
          max_file_upload = -1,
          price = $2,
          end_date = CASE 
            WHEN $3 = -1 THEN CURRENT_TIMESTAMP + INTERVAL '100 years'
            ELSE CURRENT_TIMESTAMP + INTERVAL '1 day' * $3
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *
    `;
    
    const subscription = await this.db.queryOne<Subscription>(sql, [
      newPlanType,
      newPlanConfig.price,
      newPlanConfig.validity_days,
      subscriptionId,
    ]);
    
    logger.info(`[SubscriptionStore] Upgraded subscription ${subscriptionId} to ${newPlanType}`);
    return subscription;
  }
  
  /**
   * 续费订阅
   */
  async renewSubscription(subscriptionId: string, days: number): Promise<Subscription | null> {
    const sql = `
      UPDATE subscriptions 
      SET end_date = end_date + INTERVAL '1 day' * $1,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING *
    `;
    
    const subscription = await this.db.queryOne<Subscription>(sql, [days, subscriptionId]);
    
    logger.info(`[SubscriptionStore] Renewed subscription ${subscriptionId} by ${days} days`);
    return subscription;
  }
  
  /**
   * 取消订阅
   */
  async cancelSubscription(subscriptionId: string): Promise<void> {
    await this.updateStatus(subscriptionId, 'cancelled');
  }
  
  /**
   * 获取用户所有订阅历史
   */
  async getSubscriptionHistory(userId: string): Promise<Subscription[]> {
    return this.db.query<Subscription>(
      'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
  }
  
  /**
   * 获取套餐配置
   */
  private getPlanConfig(planType: PlanType): PlanConfig {
    const configs: Record<string, PlanConfig> = {
      monthly: {
        validity_days: 30,
        price: 39,
      },
      quarterly: {
        validity_days: 90,
        price: 80,
      },
      yearly: {
        validity_days: 365,
        price: 299,
      },
      lifetime: {
        validity_days: 36500,
        price: 0,
      },
      trial: {
        validity_days: 30,
        price: 0,
      },
    };
    
    return configs[planType];
  }
  
/**
    * 检查并更新过期订阅（定时任务）
    * 注意：无限有效期套餐（plan_type 为旧版 lifetime 或 end_date 极长）不会被标记为过期
    */
  async checkAndUpdateExpiredSubscriptions(): Promise<number> {
    const sql = `
      UPDATE subscriptions 
      SET status = 'expired', updated_at = CURRENT_TIMESTAMP
      WHERE status IN ('active', 'trial')
        AND end_date <= CURRENT_TIMESTAMP
        AND plan_type NOT IN ('lifetime')
      RETURNING id
    `;
    
    const expired = await this.db.query<{ id: string }>(sql, []);
    
    if (expired.length > 0) {
      logger.info(`[SubscriptionStore] Updated ${expired.length} expired subscriptions`);
    }
    
    return expired.length;
  }
}

export default SubscriptionStore;

/**
 * 创建试用期订阅（内测码激活后）
 */
export interface CreateTrialSubscriptionInput {
  user_id: string;
  validity_days: number;           // 试用天数
}

export async function createTrialSubscription(
  db: DatabaseConnection,
  input: CreateTrialSubscriptionInput
): Promise<Subscription> {
  const startDate = new Date();
  const endDate = new Date(Date.now() + input.validity_days * 24 * 60 * 60 * 1000);
  
  const sql = `
    INSERT INTO subscriptions (
      user_id, plan_type, status, start_date, end_date,
      price, currency, auto_renew,
      quota_total, quota_used, quota_remaining,
      max_file_upload, file_upload_used,
      trial_start, trial_end
    )
    VALUES ($1, 'trial', 'trial', $2, $3, 0, 'CNY', false, -1, 0, -1, -1, 0, $2, $3)
    RETURNING *
  `;
  
  const params = [
    input.user_id,
    startDate,
    endDate,
  ];
  
  const subscription = await db.queryOne<Subscription>(sql, params);
  
  if (!subscription) {
    throw new Error('Failed to create trial subscription');
  }
  
  logger.info(`[SubscriptionStore] Created trial subscription: ${subscription.id} for user ${input.user_id}, valid for ${input.validity_days} days`);
  return subscription;
}
