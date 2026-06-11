import { DatabaseConnection } from '../database/connection';
import { Subscription, CreateSubscriptionInput, PlanType } from '../database/types';
import { logger } from '../utils/logger';

/**
 * 套餐配置
 */
interface PlanConfig {
  validity_days: number;
  quota_total: number;
  max_file_upload: number;
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
      input.quota_total || planConfig.quota_total,
      input.max_file_upload || planConfig.max_file_upload,
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
        AND status IN ('active', 'trial')
        AND end_date > CURRENT_TIMESTAMP
      ORDER BY created_at DESC
      LIMIT 1
    `;
    
    const subscription = await this.db.queryOne<Subscription>(sql, [userId]);
    
    // 检查额度是否耗尽
    if (subscription && subscription.quota_total !== -1) {
      if (subscription.quota_used >= subscription.quota_total) {
        // 更新状态为exhausted
        await this.updateStatus(subscription.id, 'exhausted');
        subscription.status = 'exhausted';
      }
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
   * 使用额度（扣除字数）
   */
  async consumeQuota(subscriptionId: string, amount: number): Promise<{ success: boolean; remaining: number }> {
    const subscription = await this.findById(subscriptionId);
    
    if (!subscription) {
      return { success: false, remaining: 0 };
    }
    
    // 无限额度套餐（quota_total === -1）不消耗额度
    if (subscription.quota_total === -1) {
      return { success: true, remaining: -1 };
    }
    
    // 检查剩余额度
    const newUsed = subscription.quota_used + amount;
    const newRemaining = subscription.quota_total - newUsed;
    
    if (newRemaining < 0) {
      return { success: false, remaining: subscription.quota_remaining };
    }
    
    // 更新额度
    const sql = `
      UPDATE subscriptions 
      SET quota_used = $1, quota_remaining = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING quota_remaining
    `;
    
    const result = await this.db.queryOne<{ quota_remaining: number }>(sql, [
      newUsed,
      Math.max(0, newRemaining),
      subscriptionId,
    ]);
    
    // 检查是否需要更新状态为exhausted
    if (newRemaining <= 0) {
      await this.updateStatus(subscriptionId, 'exhausted');
    }
    
    return {
      success: true,
      remaining: result?.quota_remaining || 0,
    };
  }
  
  /**
   * 上传文件计数增加
   */
  async incrementFileUpload(subscriptionId: string): Promise<boolean> {
    const subscription = await this.findById(subscriptionId);
    
    if (!subscription) {
      return false;
    }
    
    // 无限文件上传套餐（max_file_upload === -1）不计数
    if (subscription.max_file_upload === -1) {
      return true;
    }
    
    // 检查是否超过限制
    if (subscription.file_upload_used >= subscription.max_file_upload) {
      return false;
    }
    
    await this.db.query(
      'UPDATE subscriptions SET file_upload_used = file_upload_used + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [subscriptionId]
    );
    
    return true;
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
    
    // 计算新的额度（保留已使用的额度）
    let newQuotaTotal = newPlanConfig.quota_total;
    let newQuotaUsed = currentSubscription.quota_used;
    let newQuotaRemaining = newQuotaTotal === -1 ? -1 : newQuotaTotal - newQuotaUsed;
    
    // 如果新套餐额度无限，保留无限
    if (newQuotaTotal === -1) {
      newQuotaRemaining = -1;
      newQuotaUsed = 0;
    }
    
    const sql = `
      UPDATE subscriptions 
      SET plan_type = $1,
          quota_total = $2,
          quota_used = $3,
          quota_remaining = $4,
          max_file_upload = $5,
          price = $6,
          end_date = CASE 
            WHEN $7 = -1 THEN CURRENT_TIMESTAMP + INTERVAL '100 years'
            ELSE CURRENT_TIMESTAMP + INTERVAL '1 day' * $7
          END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $8
      RETURNING *
    `;
    
    const subscription = await this.db.queryOne<Subscription>(sql, [
      newPlanType,
      newQuotaTotal,
      newQuotaUsed,
      newQuotaRemaining,
      newPlanConfig.max_file_upload,
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
        quota_total: 5000000,
        max_file_upload: 10,
        price: 39,
      },
      quarterly: {
        validity_days: 90,
        quota_total: 20000000,
        max_file_upload: 30,
        price: 80,
      },
      yearly: {
        validity_days: 365,
        quota_total: 100000000,
        max_file_upload: 100,
        price: 299,
      },
      lifetime: {
        validity_days: 36500,
        quota_total: -1,
        max_file_upload: -1,
        price: 0,
      },
      trial: {
        validity_days: 30,
        quota_total: 5000000,
        max_file_upload: 10,
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
  quota_total?: number;            // 默认试用额度
  max_file_upload?: number;        // 默认试用文件上传限制
}

export async function createTrialSubscription(
  db: DatabaseConnection,
  input: CreateTrialSubscriptionInput
): Promise<Subscription> {
  const startDate = new Date();
  const endDate = new Date(Date.now() + input.validity_days * 24 * 60 * 60 * 1000);
  
  // 试用期默认额度：500万字
  const quotaTotal = input.quota_total || 5000000;
  // 试用期默认文件上传限制：10个
  const maxFileUpload = input.max_file_upload || 10;
  
  const sql = `
    INSERT INTO subscriptions (
      user_id, plan_type, status, start_date, end_date,
      price, currency, auto_renew,
      quota_total, quota_used, quota_remaining,
      max_file_upload, file_upload_used,
      trial_start, trial_end
    )
    VALUES ($1, 'trial', 'trial', $2, $3, 0, 'CNY', false, $4, 0, $4, $5, 0, $2, $3)
    RETURNING *
  `;
  
  const params = [
    input.user_id,
    startDate,
    endDate,
    quotaTotal,
    maxFileUpload,
  ];
  
  const subscription = await db.queryOne<Subscription>(sql, params);
  
  if (!subscription) {
    throw new Error('Failed to create trial subscription');
  }
  
  logger.info(`[SubscriptionStore] Created trial subscription: ${subscription.id} for user ${input.user_id}, valid for ${input.validity_days} days`);
  return subscription;
}
