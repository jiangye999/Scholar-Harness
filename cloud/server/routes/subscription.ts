import { Router, Request, Response } from 'express';
import { SubscriptionStore } from '../../storage/subscription-store';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { PlanType, Subscription } from '../../database/types';

const router = Router();

let subscriptionStore: SubscriptionStore;
let db: DatabaseConnection;

export function initializeSubscriptionRoutes(database: DatabaseConnection): void {
  db = database;
  subscriptionStore = new SubscriptionStore(db);
}

/**
 * 套餐配置策略
 */
type PlanStrategy = {
  validity_days: number;
  quota_total: number;
  price: number;
  max_file_upload: number;
  features: {
    max_file_upload: number;
    ai_model_access: string[];
  };
};

const PLAN_STRATEGIES: Record<PlanType, PlanStrategy> = {
  monthly: {
    validity_days: 30,
    quota_total: 5000000,      // 500万字
    price: 39,
    max_file_upload: 10,
    features: {
      max_file_upload: 10,
      ai_model_access: ['gpt-4o', 'qwen3.5-plus']
    }
  },
  quarterly: {
    validity_days: 90,
    quota_total: 20000000,     // 2000万字
    price: 80,
    max_file_upload: 30,
    features: {
      max_file_upload: 30,
      ai_model_access: ['gpt-4o', 'claude-sonnet-4-5', 'qwen-max']
    }
  },
  yearly: {
    validity_days: 365,
    quota_total: 100000000,    // 1亿字
    price: 299,
    max_file_upload: 100,
    features: {
      max_file_upload: 100,
      ai_model_access: ['gpt-4o', 'claude-sonnet-4-5', 'qwen-max', 'gemini-pro']
    }
  },
  lifetime: {
    validity_days: -1,
    quota_total: -1,
    price: 0,
    max_file_upload: -1,
    features: {
      max_file_upload: -1,
      ai_model_access: ['gpt-4o', 'claude-sonnet-4-5', 'qwen-max', 'gemini-pro']
    }
  },
  trial: {
    validity_days: 30,
    quota_total: 5000000,
    price: 0,
    max_file_upload: 10,
    features: {
      max_file_upload: 10,
      ai_model_access: ['gpt-4o', 'qwen3.5-plus']
    }
  }
};

function getPurchaseUrl(): string {
  return process.env.PURCHASE_URL || 'https://scholarharness.com/register/';
}

async function refreshSubscriptionStatus(subscription: Subscription): Promise<Subscription> {
  const now = new Date();
  const endDate = new Date(subscription.end_date);

  if (
    subscription.plan_type !== 'lifetime'
    && endDate <= now
    && subscription.status !== 'expired'
  ) {
    await subscriptionStore.updateStatus(subscription.id, 'expired');
    subscription.status = 'expired';
    return subscription;
  }

  if (
    subscription.quota_total !== -1
    && subscription.quota_used >= subscription.quota_total
    && subscription.status !== 'exhausted'
    && subscription.status !== 'expired'
  ) {
    await subscriptionStore.updateStatus(subscription.id, 'exhausted');
    subscription.status = 'exhausted';
  }

  return subscription;
}

function serializeSubscription(subscription: Subscription): Record<string, unknown> {
  const planConfig = PLAN_STRATEGIES[subscription.plan_type];
  const source = subscription.payment_method === 'beta_code'
    ? 'authorization_code'
    : subscription.payment_method === 'invite_trial'
      ? 'invite_trial'
      : 'subscription';

  return {
    id: subscription.id,
    plan_type: subscription.plan_type,
    status: subscription.status,
    quota_total: subscription.quota_total,
    quota_used: subscription.quota_used,
    quota_remaining: subscription.quota_remaining,
    max_file_upload: subscription.max_file_upload,
    file_upload_used: subscription.file_upload_used,
    start_date: subscription.start_date,
    end_date: subscription.end_date,
    source,
    purchase_url: getPurchaseUrl(),
    features: planConfig?.features || {
      max_file_upload: subscription.max_file_upload,
      ai_model_access: [],
    },
  };
}

/**
 * GET /subscription/me
 * 获取当前用户的订阅信息
 */
router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    let subscription = await subscriptionStore.getActiveSubscription(req.user!.userId);
    if (!subscription) {
      subscription = await subscriptionStore.getLatestSubscription(req.user!.userId);
    }
    
    if (!subscription) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No subscription or authorization code entitlement found',
        purchase_url: getPurchaseUrl(),
      });
    }

    subscription = await refreshSubscriptionStatus(subscription);
    
    return res.json({
      subscription: serializeSubscription(subscription),
    });
  } catch (error) {
    logger.error('[Subscription] Get subscription failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get subscription',
    });
  }
});

/**
 * POST /subscription/purchase
 * 购买套餐
 */
router.post('/purchase', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { plan_type } = req.body;
    
    if (!plan_type) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'plan_type is required',
      });
    }
    
    if (!['monthly', 'quarterly', 'yearly'].includes(plan_type)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid plan_type. Valid options: monthly, quarterly, yearly',
      });
    }
    
    const planConfig = PLAN_STRATEGIES[plan_type as PlanType];
    if (!planConfig) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid plan_type',
      });
    }

    // 检查是否已有活跃订阅
    const existingSubscription = await subscriptionStore.getActiveSubscription(req.user!.userId);
    if (existingSubscription) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'You already have an active subscription. Please upgrade or renew instead.',
        existing_subscription: {
          plan_type: existingSubscription.plan_type,
          end_date: existingSubscription.end_date,
        },
      });
    }

    const purchaseUrl = getPurchaseUrl();
    logger.info(`[Subscription] Purchase requested by user ${req.user!.userId}; redirecting to authorization-code purchase page`);
    
    return res.json({
      message: 'Please purchase an authorization code and activate it in Scholar Harness',
      activation_required: true,
      plan: {
        plan_type,
        price: planConfig.price,
        validity_days: planConfig.validity_days,
        quota_total: planConfig.quota_total,
        max_file_upload: planConfig.max_file_upload,
        features: planConfig.features,
      },
      purchase_url: purchaseUrl,
      pay_url: purchaseUrl,
    });
  } catch (error) {
    logger.error('[Subscription] Purchase failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create subscription',
    });
  }
});

/**
 * POST /subscription/bind-device
 * 绑定设备到订阅
 */
router.post('/bind-device', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { device_id, device_name, device_os } = req.body;
    
    if (!device_id) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'device_id is required',
      });
    }
    
    const subscription = await subscriptionStore.getActiveSubscription(req.user!.userId);
    
    if (!subscription) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active subscription found. Please purchase a plan first.',
      });
    }
    
    // trial 状态是内测码激活的试用期订阅，属于有效状态
    if (subscription.status !== 'active' && subscription.status !== 'trial') {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Subscription status is ${subscription.status}`,
      });
    }
    
    // 检查设备是否已绑定
    const existingDevice = await db.queryOne<{ id: string }>(
      'SELECT id FROM device_activations WHERE device_id = $1 AND subscription_id = $2 AND status = $3',
      [device_id, subscription.id, 'active']
    );
    
    if (existingDevice) {
      // 设备已绑定，返回现有激活信息
      const activation = await db.queryOne<{ id: string; activation_token: string; expires_at: Date }>(
        'SELECT id, activation_token, expires_at FROM device_activations WHERE device_id = $1 AND subscription_id = $2',
        [device_id, subscription.id]
      );
      
      return res.json({
        message: 'Device already bound',
        activation: {
          id: activation?.id,
          activation_token: activation?.activation_token,
          device_id,
          expires_at: activation?.expires_at,
        },
      });
    }
    
    // 创建设备激活记录
    const activationToken = `ACT${Date.now()}${Math.random().toString(36).substring(2, 10)}`.toUpperCase();
    const expiresAt = subscription.end_date;
    
    const sql = `
      INSERT INTO device_activations (
        subscription_id, user_id, device_id, device_name, device_os,
        activation_token, status, expires_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const activation = await db.queryOne(sql, [
      subscription.id,
      req.user!.userId,
      device_id,
      device_name || null,
      device_os || null,
      activationToken,
      'active',
      expiresAt,
    ]);
    
    logger.info(`[Subscription] Device bound: ${device_id} to subscription ${subscription.id}`);
    
    return res.json({
      message: 'Device bound successfully',
      activation: {
        id: activation?.id,
        activation_token: activationToken,
        device_id,
        device_name,
        device_os,
        expires_at: expiresAt,
      },
    });
  } catch (error) {
    logger.error('[Subscription] Bind device failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to bind device',
    });
  }
});

/**
 * POST /subscription/upgrade
 * 升级套餐
 */
router.post('/upgrade', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { new_plan_type, payment_method } = req.body;
    
    if (!new_plan_type || !payment_method) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'new_plan_type and payment_method are required',
      });
    }
    
    const currentSubscription = await subscriptionStore.getActiveSubscription(req.user!.userId);
    
    if (!currentSubscription) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active subscription found',
      });
    }
    
    const newPlanConfig = PLAN_STRATEGIES[new_plan_type as PlanType];
    if (!newPlanConfig) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid new_plan_type',
      });
    }
    
    // 计算升级差价（简化处理，实际需要更复杂的逻辑）
    const priceDiff = newPlanConfig.price - PLAN_STRATEGIES[currentSubscription.plan_type as PlanType].price;
    
    // 创建新订阅或更新现有订阅（这里简化处理）
    const updatedSubscription = await subscriptionStore.upgradeSubscription(
      currentSubscription.id,
      new_plan_type,
      newPlanConfig
    );
    
    logger.info(`[Subscription] Upgraded: ${currentSubscription.id} to ${new_plan_type}`);
    
    return res.json({
      message: 'Subscription upgraded successfully',
      subscription: {
        id: updatedSubscription?.id,
        plan_type: updatedSubscription?.plan_type,
        quota_total: updatedSubscription?.quota_total,
        quota_used: updatedSubscription?.quota_used,
        quota_remaining: updatedSubscription?.quota_remaining,
      },
      price_difference: Math.max(0, priceDiff),
    });
  } catch (error) {
    logger.error('[Subscription] Upgrade failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to upgrade subscription',
    });
  }
});

/**
 * GET /subscription/plans
 * 获取所有可用套餐信息
 */
router.get('/plans', async (req: Request, res: Response) => {
  const plans = Object.entries(PLAN_STRATEGIES).map(([type, config]) => ({
    plan_type: type,
    price: config.price,
    validity_days: config.validity_days === 36500 ? -1 : config.validity_days,
    quota_total: config.quota_total,
    max_file_upload: config.max_file_upload,
    features: config.features,
  }));
  
  return res.json({ plans });
});

export default router;
