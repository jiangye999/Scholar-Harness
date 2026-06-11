import { Router, Request, Response } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { SubscriptionStore } from '../../storage/subscription-store';
import { Subscription } from '../../database/types';

const router = Router();

let db: DatabaseConnection;
let subscriptionStore: SubscriptionStore;

const QUOTA_DEDUCTING_USAGE_TYPES = new Set([
  'word_generation',
  'cloud_prompt_bundle',
  'autoresearch_orchestration',
  'autoresearch_write_paper_orchestration',
  'review_writer_quality_orchestration',
]);

type PgClient = {
  query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
};

type UsageWriteResult = {
  success: boolean;
  code?: 'NO_ACTIVE_SUBSCRIPTION' | 'INSUFFICIENT_QUOTA' | 'FILE_UPLOAD_LIMIT_REACHED';
  remaining?: number;
};

export function initializeUsageRoutes(database: DatabaseConnection): void {
  db = database;
  subscriptionStore = new SubscriptionStore(db);
}

function normalizeUsageAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000) {
    return null;
  }
  return amount;
}

function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > 120) return null;
  return trimmed;
}

async function getActiveSubscriptionForUpdate(client: PgClient, userId: string): Promise<Subscription | null> {
  const result = await client.query<Subscription>(
    `SELECT *
     FROM subscriptions
     WHERE user_id = $1
       AND status IN ('active', 'trial')
       AND end_date > CURRENT_TIMESTAMP
     ORDER BY created_at DESC
     LIMIT 1
     FOR UPDATE`,
    [userId]
  );

  return result.rows[0] || null;
}

async function insertUsageEvent(
  client: PgClient,
  input: {
    userId: string;
    subscriptionId: string;
    usageType: string;
    eventData: Record<string, unknown>;
    deviceId: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO usage_events (user_id, subscription_id, event_type, event_data, device_id)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [
      input.userId,
      input.subscriptionId,
      input.usageType,
      JSON.stringify(input.eventData),
      input.deviceId,
    ]
  );
}

async function consumeQuotaAndRecordUsage(input: {
  userId: string;
  usageType: string;
  amount: number;
  deviceId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<UsageWriteResult> {
  return db.transaction(async (client: PgClient) => {
    const subscription = await getActiveSubscriptionForUpdate(client, input.userId);
    if (!subscription) {
      return { success: false, code: 'NO_ACTIVE_SUBSCRIPTION' };
    }

    const quotaTotal = Number(subscription.quota_total);
    const quotaUsed = Number(subscription.quota_used || 0);
    let remaining = Number(subscription.quota_remaining || 0);

    if (quotaTotal !== -1) {
      const newUsed = quotaUsed + input.amount;
      remaining = quotaTotal - newUsed;

      if (remaining < 0) {
        return {
          success: false,
          code: 'INSUFFICIENT_QUOTA',
          remaining: Number(subscription.quota_remaining || 0),
        };
      }

      await client.query(
        `UPDATE subscriptions
         SET quota_used = $1,
             quota_remaining = $2,
             status = CASE WHEN $2 <= 0 THEN 'exhausted' ELSE status END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [newUsed, Math.max(0, remaining), subscription.id]
      );
    } else {
      remaining = -1;
    }

    await insertUsageEvent(client, {
      userId: input.userId,
      subscriptionId: subscription.id,
      usageType: input.usageType,
      deviceId: input.deviceId,
      eventData: {
        amount: input.amount,
        remaining: quotaTotal === -1 ? -1 : Math.max(0, remaining),
        ...(input.metadata || {}),
      },
    });

    return {
      success: true,
      remaining: quotaTotal === -1 ? -1 : Math.max(0, remaining),
    };
  });
}

async function incrementFileUploadAndRecordUsage(input: {
  userId: string;
  usageType: string;
  deviceId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<UsageWriteResult> {
  return db.transaction(async (client: PgClient) => {
    const subscription = await getActiveSubscriptionForUpdate(client, input.userId);
    if (!subscription) {
      return { success: false, code: 'NO_ACTIVE_SUBSCRIPTION' };
    }

    const maxFileUpload = Number(subscription.max_file_upload);
    const fileUploadUsed = Number(subscription.file_upload_used || 0);

    if (maxFileUpload !== -1 && fileUploadUsed >= maxFileUpload) {
      return { success: false, code: 'FILE_UPLOAD_LIMIT_REACHED' };
    }

    if (maxFileUpload !== -1) {
      await client.query(
        'UPDATE subscriptions SET file_upload_used = file_upload_used + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
        [subscription.id]
      );
    }

    await insertUsageEvent(client, {
      userId: input.userId,
      subscriptionId: subscription.id,
      usageType: input.usageType,
      deviceId: input.deviceId,
      eventData: {
        file_count: 1,
        ...(input.metadata || {}),
      },
    });

    return { success: true };
  });
}

async function recordNonDeductingUsage(input: {
  userId: string;
  usageType: string;
  amount: number;
  deviceId: string | null;
  metadata?: Record<string, unknown>;
}): Promise<UsageWriteResult> {
  return db.transaction(async (client: PgClient) => {
    const subscription = await getActiveSubscriptionForUpdate(client, input.userId);
    if (!subscription) {
      return { success: false, code: 'NO_ACTIVE_SUBSCRIPTION' };
    }

    await insertUsageEvent(client, {
      userId: input.userId,
      subscriptionId: subscription.id,
      usageType: input.usageType,
      deviceId: input.deviceId,
      eventData: {
        amount: input.amount,
        ...(input.metadata || {}),
      },
    });

    return { success: true };
  });
}

/**
 * POST /usage/report
 * 上报使用量
 */
router.post('/report', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { usage_type, amount, device_id, metadata } = req.body;
    
    if (!usage_type || amount === undefined || amount === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'usage_type and amount are required',
      });
    }

    const normalizedAmount = normalizeUsageAmount(amount);
    if (normalizedAmount === null) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'amount must be a positive integer',
      });
    }

    const normalizedDeviceId = normalizeDeviceId(device_id);
    const safeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata as Record<string, unknown>
      : {};
    
    // 根据使用类型处理
    if (QUOTA_DEDUCTING_USAGE_TYPES.has(usage_type)) {
      const result = await consumeQuotaAndRecordUsage({
        userId: req.user!.userId,
        usageType: usage_type,
        amount: normalizedAmount,
        deviceId: normalizedDeviceId,
        metadata: safeMetadata,
      });
      
      if (!result.success) {
        if (result.code === 'NO_ACTIVE_SUBSCRIPTION') {
          return res.status(404).json({
            error: 'Not Found',
            message: 'No active subscription found',
          });
        }
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Insufficient quota',
          remaining: result.remaining,
        });
      }

      return res.json({
        recorded: true,
        quota_remaining: result.remaining,
      });
    }
    
    if (usage_type === 'file_upload') {
      const result = await incrementFileUploadAndRecordUsage({
        userId: req.user!.userId,
        usageType: usage_type,
        deviceId: normalizedDeviceId,
        metadata: safeMetadata,
      });
      
      if (!result.success) {
        if (result.code === 'NO_ACTIVE_SUBSCRIPTION') {
          return res.status(404).json({
            error: 'Not Found',
            message: 'No active subscription found',
          });
        }
        return res.status(403).json({
          error: 'Forbidden',
          message: 'File upload limit reached',
        });
      }

      return res.json({
        recorded: true,
      });
    }
    
    // 其他类型的使用统计
    const result = await recordNonDeductingUsage({
      userId: req.user!.userId,
      usageType: usage_type,
      amount: normalizedAmount,
      deviceId: normalizedDeviceId,
      metadata: safeMetadata,
    });

    if (!result.success && result.code === 'NO_ACTIVE_SUBSCRIPTION') {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active subscription found',
      });
    }
    
    return res.json({ recorded: true });
  } catch (error) {
    logger.error('[Usage] Report failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to report usage',
    });
  }
});

/**
 * GET /usage/my-stats
 * 获取用户使用统计
 */
router.get('/my-stats', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = await subscriptionStore.getActiveSubscription(req.user!.userId);
    
    if (!subscription) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active subscription found',
      });
    }
    
    // 获取今日使用量
    const todayUsage = await db.queryOne<{ word_count: string; file_count: string }>(
      `SELECT 
         COALESCE(SUM((event_data->>'amount')::int), 0) as word_count,
         COUNT(CASE WHEN event_type = 'file_upload' THEN 1 END) as file_count
       FROM usage_events
       WHERE user_id = $1 
         AND subscription_id = $2
         AND created_at >= CURRENT_DATE`,
      [req.user!.userId, subscription.id]
    );
    
    // 获取本月使用量
    const monthUsage = await db.queryOne<{ word_count: string; file_count: string }>(
      `SELECT 
         COALESCE(SUM((event_data->>'amount')::int), 0) as word_count,
         COUNT(CASE WHEN event_type = 'file_upload' THEN 1 END) as file_count
       FROM usage_events
       WHERE user_id = $1 
         AND subscription_id = $2
         AND created_at >= DATE_TRUNC('month', CURRENT_DATE)`,
      [req.user!.userId, subscription.id]
    );
    
    return res.json({
      subscription: {
        plan_type: subscription.plan_type,
        status: subscription.status,
        quota_total: subscription.quota_total,
        quota_used: subscription.quota_used,
        quota_remaining: subscription.quota_remaining,
        max_file_upload: subscription.max_file_upload,
        file_upload_used: subscription.file_upload_used,
      },
      usage: {
        today: {
          word_count: parseInt(todayUsage?.word_count || '0', 10),
          file_count: parseInt(todayUsage?.file_count || '0', 10),
        },
        this_month: {
          word_count: parseInt(monthUsage?.word_count || '0', 10),
          file_count: parseInt(monthUsage?.file_count || '0', 10),
        },
      },
    });
  } catch (error) {
    logger.error('[Usage] Get stats failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get usage stats',
    });
  }
});

/**
 * GET /usage/daily-stats
 * 获取最近30天的每日使用统计（用于柱状图）
 */
router.get('/daily-stats', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const subscription = await subscriptionStore.getActiveSubscription(req.user!.userId);
    
    if (!subscription) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'No active subscription found',
      });
    }
    
    // 获取最近30天的每日使用量
    const dailyStats = await db.query<{ date: Date; word_count: string; file_count: string }>(
      `SELECT 
         DATE(created_at) as date,
         COALESCE(SUM((event_data->>'amount')::int), 0) as word_count,
         COUNT(CASE WHEN event_type = 'file_upload' THEN 1 END) as file_count
       FROM usage_events
       WHERE user_id = $1 
         AND subscription_id = $2
         AND created_at >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY DATE(created_at) ASC`,
      [req.user!.userId, subscription.id]
    );
    
    // 生成最近30天的完整日期列表（包含无数据的日期）
    const result: Array<{ date: string; word_count: number; file_count: number }> = [];
    const statsMap = new Map<string, { word_count: number; file_count: number }>();
    
    // 将数据库结果映射到Map
    for (const stat of dailyStats) {
      const dateStr = new Date(stat.date).toISOString().split('T')[0];
      statsMap.set(dateStr, {
        word_count: parseInt(stat.word_count, 10),
        file_count: parseInt(stat.file_count, 10),
      });
    }
    
    // 生成最近30天的完整数据
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const stat = statsMap.get(dateStr) || { word_count: 0, file_count: 0 };
      result.push({
        date: dateStr,
        word_count: stat.word_count,
        file_count: stat.file_count,
      });
    }
    
    return res.json({
      daily_stats: result,
      subscription: {
        plan_type: subscription.plan_type,
        quota_remaining: subscription.quota_remaining,
        quota_total: subscription.quota_total,
      },
    });
  } catch (error) {
    logger.error('[Usage] Get daily stats failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get daily usage stats',
    });
  }
});

/**
 * POST /usage/purchase-credits
 * 旧客户端兼容入口：不再出售积分，统一跳转到套餐/授权码购买页
 */
router.post('/purchase-credits', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount_cny } = req.body;
    
    if (!amount_cny || amount_cny < 1) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'amount_cny is required and must be at least 1',
      });
    }
    
    const purchaseUrl = process.env.PURCHASE_URL || 'https://scholarharness.com/register/';
    logger.info(`[Usage] Credits purchase requested by user ${req.user!.userId}; redirecting to authorization-code purchase page`);
    
    return res.json({
      message: 'Please purchase an authorization code and activate it in Scholar Harness',
      activation_required: true,
      amount_cny,
      purchase_url: purchaseUrl,
      pay_url: purchaseUrl,
    });
  } catch (error) {
    logger.error('[Usage] Purchase credits failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to purchase credits',
    });
  }
});

export default router;
