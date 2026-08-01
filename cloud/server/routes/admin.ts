import * as crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { User } from '../../database/types';
import { generateTokenPair, verifyRefreshToken } from '../../auth/jwt';
import { apiKeyEncryption } from '../../auth/encryption';
import { UserStore } from '../../storage/user-store';
import { logger } from '../../utils/logger';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

let db: DatabaseConnection;
let userStore: UserStore;

type UpstreamTable = 'admin_upstream_configs' | 'admin_upstream_embedding_configs';

const LB_STRATEGIES = new Set([
  'round_robin',
  'weighted',
  'least_connections',
  'priority',
  'default_only',
]);

export async function initializeAdminRoutes(database: DatabaseConnection): Promise<void> {
  db = database;
  userStore = new UserStore(db);
  await ensureAdminTables();
}

async function ensureAdminTables(): Promise<void> {
  try {
    await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  } catch (error) {
    logger.warn('[Admin] Could not ensure pgcrypto extension:', (error as Error).message);
  }

  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_model_pricing (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      model_name VARCHAR(160) NOT NULL UNIQUE,
      display_name VARCHAR(160) NOT NULL,
      provider VARCHAR(100) NOT NULL,
      model_ratio DECIMAL(12,4) NOT NULL DEFAULT 1,
      completion_ratio DECIMAL(12,4) NOT NULL DEFAULT 1,
      quota_type INTEGER NOT NULL DEFAULT 0,
      model_price DECIMAL(12,4) NOT NULL DEFAULT 0,
      official_input_price DECIMAL(12,6),
      official_output_price DECIMAL(12,6),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_listed BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureUpstreamTable('admin_upstream_configs');
  await ensureUpstreamTable('admin_upstream_embedding_configs');
}

async function ensureUpstreamTable(tableName: UpstreamTable): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider_name VARCHAR(120) NOT NULL,
      base_url TEXT NOT NULL,
      api_key_encrypted TEXT NOT NULL,
      api_key_masked VARCHAR(200) NOT NULL,
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      description TEXT,
      lb_strategy VARCHAR(40) NOT NULL DEFAULT 'round_robin',
      lb_weight INTEGER NOT NULL DEFAULT 1,
      lb_priority INTEGER NOT NULL DEFAULT 0,
      current_connections INTEGER NOT NULL DEFAULT 0,
      total_requests BIGINT NOT NULL DEFAULT 0,
      success_count BIGINT NOT NULL DEFAULT 0,
      error_count BIGINT NOT NULL DEFAULT 0,
      total_latency_ms BIGINT NOT NULL DEFAULT 0,
      max_connections INTEGER NOT NULL DEFAULT 100,
      rate_limit_per_minute INTEGER NOT NULL DEFAULT 60,
      current_minute_requests INTEGER NOT NULL DEFAULT 0,
      last_used_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseLimit(value: unknown, fallback = 100, max = 500): number {
  const parsed = intValue(value, fallback);
  if (parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function safeCompare(left: string, right: string): boolean {
  const leftHash = crypto.createHash('sha256').update(left).digest();
  const rightHash = crypto.createHash('sha256').update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function normalizePricingRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    model_ratio: numberValue(row.model_ratio, 1),
    completion_ratio: numberValue(row.completion_ratio, 1),
    quota_type: intValue(row.quota_type, 0),
    model_price: numberValue(row.model_price, 0),
    official_input_price: row.official_input_price == null ? null : numberValue(row.official_input_price, 0),
    official_output_price: row.official_output_price == null ? null : numberValue(row.official_output_price, 0),
  };
}

function normalizeUpstreamRow(row: Record<string, unknown>): Record<string, unknown> {
  const currentConnections = intValue(row.current_connections, 0);
  const totalRequests = numberValue(row.total_requests, 0);
  const maxConnections = intValue(row.max_connections, 100);
  const currentMinuteRequests = intValue(row.current_minute_requests, 0);
  const rateLimitPerMinute = intValue(row.rate_limit_per_minute, 60);
  const isActive = bool(row.is_active, false);

  return {
    id: row.id,
    provider_name: row.provider_name,
    base_url: row.base_url,
    is_default: bool(row.is_default, false),
    is_active: isActive,
    description: row.description,
    created_at: row.created_at,
    has_api_key: Boolean(row.api_key_masked),
    api_key_masked: row.api_key_masked,
    lb_strategy: row.lb_strategy || 'round_robin',
    lb_weight: intValue(row.lb_weight, 1),
    lb_priority: intValue(row.lb_priority, 0),
    current_connections: currentConnections,
    total_requests: totalRequests,
    success_count: numberValue(row.success_count, 0),
    error_count: numberValue(row.error_count, 0),
    max_connections: maxConnections,
    rate_limit_per_minute: rateLimitPerMinute,
    current_minute_requests: currentMinuteRequests,
    last_used_at: row.last_used_at,
    available: isActive && currentConnections < maxConnections && currentMinuteRequests < rateLimitPerMinute,
  };
}

function getApiKeyStorage(apiKey: string): { encrypted: string; masked: string } {
  return {
    encrypted: apiKeyEncryption.encrypt(apiKey),
    masked: apiKeyEncryption.maskApiKey(apiKey),
  };
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const configuredSecret = process.env.ADMIN_SECRET_CODE || process.env.ADMIN_SECRET;
    if (!configuredSecret) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: '管理员密令登录未配置',
      });
    }

    const secretCode = text(req.body?.secret_code);
    if (!secretCode || !safeCompare(secretCode, configuredSecret)) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '管理员密令错误',
      });
    }

    const tokens = generateTokenPair({
      userId: 'admin-secret',
      email: 'admin@scholarharness.local',
      role: 'admin',
      source: 'cloud',
    });

    return res.json({
      tokens,
      user: {
        id: 'admin-secret',
        email: 'admin@scholarharness.local',
        role: 'admin',
        source: 'cloud',
      },
    });
  } catch (error) {
    logger.error('[Admin] Secret login failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '管理员登录失败',
    });
  }
});

router.post('/login-email', async (req: Request, res: Response) => {
  try {
    const email = text(req.body?.email);
    const password = text(req.body?.password);
    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '邮箱和密码不能为空',
      });
    }

    const user = await userStore.validateCredentials(email, password);
    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '邮箱或密码错误',
      });
    }

    if (user.role !== 'admin' || user.status !== 'active') {
      return res.status(403).json({
        error: 'Forbidden',
        message: '当前账号没有管理员权限',
      });
    }

    const tokens = userStore.generateUserTokens(user);
    return res.json({
      tokens,
      user: publicUser(user),
    });
  } catch (error) {
    logger.error('[Admin] Email login failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '管理员登录失败',
    });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = text(req.body?.refreshToken);
    if (!refreshToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
    }

    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    if (payload.userId === 'admin-secret') {
      const tokens = generateTokenPair({
        userId: 'admin-secret',
        email: 'admin@scholarharness.local',
        role: 'admin',
        source: 'cloud',
      });
      return res.json({ message: 'Admin token refreshed', tokens });
    }

    const user = await userStore.findById(payload.userId);
    if (!user || user.status !== 'active' || user.role !== 'admin') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Admin account not found or inactive',
      });
    }

    return res.json({
      message: 'Admin token refreshed',
      tokens: userStore.generateUserTokens(user),
    });
  } catch (error) {
    logger.error('[Admin] Token refresh failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '管理员登录续期失败',
    });
  }
});

function publicUser(user: User): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    source: user.source,
    status: user.status,
    created_at: user.created_at,
    last_login_at: user.last_login_at,
  };
}

router.get('/stats', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [users, subscriptions, revenue, usage] = await Promise.all([
      db.queryOne<Record<string, unknown>>(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'active') AS active,
          COUNT(*) FILTER (WHERE role IN ('premium', 'admin', 'beta_tester')) AS premium,
          COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE) AS new_today
        FROM users
      `),
      db.queryOne<Record<string, unknown>>(`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status IN ('active', 'trial')) AS active,
          COUNT(*) FILTER (WHERE plan_type = 'monthly') AS monthly,
          COUNT(*) FILTER (WHERE plan_type = 'quarterly') AS quarterly,
          COUNT(*) FILTER (WHERE plan_type = 'yearly') AS yearly
        FROM subscriptions
      `),
      db.queryOne<Record<string, unknown>>(`
        SELECT
          COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0) AS total,
          COALESCE(SUM(amount) FILTER (WHERE status = 'success' AND created_at::date = CURRENT_DATE), 0) AS today,
          COALESCE(SUM(amount) FILTER (
            WHERE status = 'success'
              AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
          ), 0) AS month
        FROM payments
      `),
      db.queryOne<Record<string, unknown>>('SELECT COUNT(*) AS requests FROM usage_events'),
    ]);

    const totalRevenue = numberValue(revenue?.total, 0);
    const todayRevenue = numberValue(revenue?.today, 0);

    return res.json({
      users: {
        total: intValue(users?.total, 0),
        active: intValue(users?.active, 0),
        premium: intValue(users?.premium, 0),
      },
      subscriptions: {
        total: intValue(subscriptions?.total, 0),
        active: intValue(subscriptions?.active, 0),
        monthly: intValue(subscriptions?.monthly, 0),
        quarterly: intValue(subscriptions?.quarterly, 0),
        yearly: intValue(subscriptions?.yearly, 0),
      },
      api: {
        revenue: 0,
        cost: 0,
        profit: 0,
        requests: intValue(usage?.requests, 0),
      },
      today: {
        revenue: todayRevenue,
        profit: todayRevenue,
        new_users: intValue(users?.new_today, 0),
      },
      revenue: {
        total: totalRevenue,
        today: todayRevenue,
        month: numberValue(revenue?.month, 0),
      },
    });
  } catch (error) {
    logger.error('[Admin] Stats failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '加载统计数据失败',
    });
  }
});

router.get('/users', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 1000);
    const offset = Math.max(0, intValue(req.query.offset, 0));
    const users = await db.query<Record<string, unknown>>(
      `
        SELECT
          u.id,
          u.email,
          u.username,
          u.role,
          u.status,
          u.source,
          u.created_at,
          u.last_login_at,
          s.plan_type AS subscription_plan,
          s.status AS subscription_status
        FROM users u
        LEFT JOIN LATERAL (
          SELECT plan_type, status
          FROM subscriptions
          WHERE user_id = u.id
          ORDER BY
            CASE WHEN status IN ('active', 'trial') THEN 0 ELSE 1 END,
            created_at DESC
          LIMIT 1
        ) s ON TRUE
        ORDER BY u.created_at DESC
        LIMIT $1 OFFSET $2
      `,
      [limit, offset]
    );

    return res.json({ users });
  } catch (error) {
    logger.error('[Admin] Users failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '加载用户列表失败',
    });
  }
});

router.get('/payments', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 1000);
    const payments = await db.query<Record<string, unknown>>(
      `
        SELECT
          p.id,
          COALESCE(u.email, 'unknown') AS user_email,
          p.payment_type,
          p.amount,
          p.currency,
          p.payment_method,
          p.status,
          p.created_at,
          p.paid_at
        FROM payments p
        LEFT JOIN users u ON u.id = p.user_id
        ORDER BY p.created_at DESC
        LIMIT $1
      `,
      [limit]
    );

    return res.json({
      payments: payments.map(payment => ({
        ...payment,
        amount: numberValue(payment.amount, 0),
      })),
    });
  } catch (error) {
    logger.error('[Admin] Payments failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '加载支付列表失败',
    });
  }
});

router.get('/pricing', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const pricing = await db.query<Record<string, unknown>>(
      'SELECT * FROM admin_model_pricing ORDER BY provider ASC, model_name ASC'
    );
    return res.json({ pricing: pricing.map(normalizePricingRow) });
  } catch (error) {
    logger.error('[Admin] Pricing list failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '加载定价配置失败',
    });
  }
});

router.post('/pricing', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const modelName = text(req.body?.model_name);
    const displayName = text(req.body?.display_name);
    const provider = text(req.body?.provider);
    if (!modelName || !displayName || !provider) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '模型名称、显示名称和提供商不能为空',
      });
    }

    const pricing = await db.queryOne<Record<string, unknown>>(
      `
        INSERT INTO admin_model_pricing (
          model_name, display_name, provider, model_ratio, completion_ratio,
          quota_type, model_price, official_input_price, official_output_price,
          is_active, is_listed
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (model_name) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          provider = EXCLUDED.provider,
          model_ratio = EXCLUDED.model_ratio,
          completion_ratio = EXCLUDED.completion_ratio,
          quota_type = EXCLUDED.quota_type,
          model_price = EXCLUDED.model_price,
          official_input_price = EXCLUDED.official_input_price,
          official_output_price = EXCLUDED.official_output_price,
          is_active = EXCLUDED.is_active,
          is_listed = EXCLUDED.is_listed,
          updated_at = CURRENT_TIMESTAMP
        RETURNING *
      `,
      [
        modelName,
        displayName,
        provider,
        numberValue(req.body?.model_ratio, 1),
        numberValue(req.body?.completion_ratio, 1),
        intValue(req.body?.quota_type, 0),
        numberValue(req.body?.model_price, 0),
        req.body?.official_input_price == null ? null : numberValue(req.body.official_input_price, 0),
        req.body?.official_output_price == null ? null : numberValue(req.body.official_output_price, 0),
        bool(req.body?.is_active, true),
        bool(req.body?.is_listed, true),
      ]
    );

    return res.status(201).json({ pricing: pricing ? normalizePricingRow(pricing) : null });
  } catch (error) {
    logger.error('[Admin] Pricing create failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '保存定价配置失败',
    });
  }
});

router.put('/pricing/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const updates = buildPricingUpdates(req.body);
    if (updates.sets.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '没有可更新字段',
      });
    }

    updates.values.push(req.params.id);
    const pricing = await db.queryOne<Record<string, unknown>>(
      `
        UPDATE admin_model_pricing
        SET ${updates.sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${updates.values.length}
        RETURNING *
      `,
      updates.values
    );

    if (!pricing) {
      return res.status(404).json({ error: 'Not Found', message: '定价配置不存在' });
    }

    return res.json({ pricing: normalizePricingRow(pricing) });
  } catch (error) {
    logger.error('[Admin] Pricing update failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '更新定价配置失败',
    });
  }
});

router.delete('/pricing/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deleted = await db.queryOne<{ id: string }>(
      'DELETE FROM admin_model_pricing WHERE id = $1 RETURNING id',
      [req.params.id]
    );
    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: '定价配置不存在' });
    }
    return res.json({ success: true });
  } catch (error) {
    logger.error('[Admin] Pricing delete failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '删除定价配置失败',
    });
  }
});

function buildPricingUpdates(body: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const allowed: Record<string, (value: unknown) => unknown> = {
    model_name: value => text(value),
    display_name: value => text(value),
    provider: value => text(value),
    model_ratio: value => numberValue(value, 1),
    completion_ratio: value => numberValue(value, 1),
    quota_type: value => intValue(value, 0),
    model_price: value => numberValue(value, 0),
    official_input_price: value => (value == null ? null : numberValue(value, 0)),
    official_output_price: value => (value == null ? null : numberValue(value, 0)),
    is_active: value => bool(value, false),
    is_listed: value => bool(value, false),
  };

  return buildUpdates(body, allowed);
}

function buildUpdates(
  body: Record<string, unknown>,
  allowed: Record<string, (value: unknown) => unknown>
): { sets: string[]; values: unknown[] } {
  const sets: string[] = [];
  const values: unknown[] = [];

  for (const [field, normalize] of Object.entries(allowed)) {
    if (!Object.prototype.hasOwnProperty.call(body, field)) continue;
    values.push(normalize(body[field]));
    sets.push(`${field} = $${values.length}`);
  }

  return { sets, values };
}

router.get('/upstream-configs', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  return listUpstreamConfigs(res, 'admin_upstream_configs');
});

router.post('/upstream-configs', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return createUpstreamConfig(req, res, 'admin_upstream_configs');
});

router.put('/upstream-configs/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return updateUpstreamConfig(req, res, 'admin_upstream_configs');
});

router.delete('/upstream-configs/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return deleteUpstreamConfig(req, res, 'admin_upstream_configs');
});

router.post('/upstream-configs/:id/set-default', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return setDefaultUpstreamConfig(req, res, 'admin_upstream_configs');
});

router.put('/upstream-configs/:id/load-balancing', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return updateUpstreamLoadBalancing(req, res, 'admin_upstream_configs');
});

router.get('/load-balancer/stats', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  return getLoadBalancerStats(res, 'admin_upstream_configs');
});

router.post('/load-balancer/reset-stats', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  return resetLoadBalancerStats(res, 'admin_upstream_configs');
});

router.get('/upstream-embedding-configs', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  return listUpstreamConfigs(res, 'admin_upstream_embedding_configs');
});

router.post('/upstream-embedding-configs', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return createUpstreamConfig(req, res, 'admin_upstream_embedding_configs');
});

router.put('/upstream-embedding-configs/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return updateUpstreamConfig(req, res, 'admin_upstream_embedding_configs');
});

router.delete('/upstream-embedding-configs/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return deleteUpstreamConfig(req, res, 'admin_upstream_embedding_configs');
});

router.post('/upstream-embedding-configs/:id/set-default', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return setDefaultUpstreamConfig(req, res, 'admin_upstream_embedding_configs');
});

router.put('/upstream-embedding-configs/:id/load-balancing', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return updateUpstreamLoadBalancing(req, res, 'admin_upstream_embedding_configs');
});

router.get('/embedding-load-balancer/stats', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  return getLoadBalancerStats(res, 'admin_upstream_embedding_configs');
});

router.post('/embedding-load-balancer/reset-stats', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  return resetLoadBalancerStats(res, 'admin_upstream_embedding_configs');
});

async function listUpstreamConfigs(res: Response, table: UpstreamTable): Promise<Response> {
  try {
    const configs = await db.query<Record<string, unknown>>(
      `SELECT * FROM ${table} ORDER BY is_default DESC, lb_priority ASC, created_at DESC`
    );
    return res.json({ configs: configs.map(normalizeUpstreamRow) });
  } catch (error) {
    logger.error(`[Admin] List ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '加载上游配置失败',
    });
  }
}

async function createUpstreamConfig(
  req: AuthenticatedRequest,
  res: Response,
  table: UpstreamTable
): Promise<Response> {
  try {
    const providerName = text(req.body?.provider_name);
    const apiKey = text(req.body?.api_key);
    const baseUrl = text(req.body?.base_url);
    const lbStrategy = text(req.body?.lb_strategy) || 'round_robin';

    if (!providerName || !apiKey || !baseUrl) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '服务商名称、API 密钥和基础 URL 不能为空',
      });
    }

    if (!LB_STRATEGIES.has(lbStrategy)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '负载均衡策略无效',
      });
    }

    const apiKeyStorage = getApiKeyStorage(apiKey);
    const isDefault = bool(req.body?.is_default, false);

    const config = await db.transaction(async (client: {
      query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      if (isDefault) {
        await client.query(`UPDATE ${table} SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP`);
      }

      const result = await client.query<Record<string, unknown>>(
        `
          INSERT INTO ${table} (
            provider_name, api_key_encrypted, api_key_masked, base_url, is_default,
            is_active, description, lb_strategy, lb_weight, lb_priority,
            max_connections, rate_limit_per_minute
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `,
        [
          providerName,
          apiKeyStorage.encrypted,
          apiKeyStorage.masked,
          baseUrl,
          isDefault,
          true,
          text(req.body?.description),
          lbStrategy,
          Math.max(1, intValue(req.body?.lb_weight, 1)),
          Math.max(0, intValue(req.body?.lb_priority, 0)),
          Math.max(1, intValue(req.body?.max_connections, 100)),
          Math.max(1, intValue(req.body?.rate_limit_per_minute, 60)),
        ]
      );

      return result.rows[0];
    });

    return res.status(201).json({ config: normalizeUpstreamRow(config) });
  } catch (error) {
    logger.error(`[Admin] Create ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '保存上游配置失败',
    });
  }
}

async function updateUpstreamConfig(
  req: AuthenticatedRequest,
  res: Response,
  table: UpstreamTable
): Promise<Response> {
  try {
    const updates = buildUpstreamUpdates(req.body);
    if (updates.sets.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '没有可更新字段',
      });
    }

    const isSettingDefault = req.body?.is_default === true;
    updates.values.push(req.params.id);

    const config = await db.transaction(async (client: {
      query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      if (isSettingDefault) {
        await client.query(`UPDATE ${table} SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP`);
      }

      const result = await client.query<Record<string, unknown>>(
        `
          UPDATE ${table}
          SET ${updates.sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
          WHERE id = $${updates.values.length}
          RETURNING *
        `,
        updates.values
      );
      return result.rows[0] || null;
    });

    if (!config) {
      return res.status(404).json({ error: 'Not Found', message: '上游配置不存在' });
    }

    return res.json({ config: normalizeUpstreamRow(config) });
  } catch (error) {
    logger.error(`[Admin] Update ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '更新上游配置失败',
    });
  }
}

function buildUpstreamUpdates(body: Record<string, unknown>): { sets: string[]; values: unknown[] } {
  const allowed: Record<string, (value: unknown) => unknown> = {
    provider_name: value => text(value),
    base_url: value => text(value),
    is_default: value => bool(value, false),
    is_active: value => bool(value, false),
    description: value => text(value),
    lb_strategy: value => {
      const strategy = text(value) || 'round_robin';
      if (!LB_STRATEGIES.has(strategy)) {
        throw new Error('Invalid load balancing strategy');
      }
      return strategy;
    },
    lb_weight: value => Math.max(1, intValue(value, 1)),
    lb_priority: value => Math.max(0, intValue(value, 0)),
    max_connections: value => Math.max(1, intValue(value, 100)),
    rate_limit_per_minute: value => Math.max(1, intValue(value, 60)),
  };

  const updates = buildUpdates(body, allowed);
  const apiKey = text(body.api_key);
  if (apiKey) {
    const apiKeyStorage = getApiKeyStorage(apiKey);
    updates.values.push(apiKeyStorage.encrypted);
    updates.sets.push(`api_key_encrypted = $${updates.values.length}`);
    updates.values.push(apiKeyStorage.masked);
    updates.sets.push(`api_key_masked = $${updates.values.length}`);
  }

  return updates;
}

async function deleteUpstreamConfig(
  req: AuthenticatedRequest,
  res: Response,
  table: UpstreamTable
): Promise<Response> {
  try {
    const deleted = await db.queryOne<{ id: string }>(
      `DELETE FROM ${table} WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!deleted) {
      return res.status(404).json({ error: 'Not Found', message: '上游配置不存在' });
    }
    return res.json({ success: true });
  } catch (error) {
    logger.error(`[Admin] Delete ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '删除上游配置失败',
    });
  }
}

async function setDefaultUpstreamConfig(
  req: AuthenticatedRequest,
  res: Response,
  table: UpstreamTable
): Promise<Response> {
  try {
    const config = await db.transaction(async (client: {
      query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
    }) => {
      await client.query(`UPDATE ${table} SET is_default = FALSE, updated_at = CURRENT_TIMESTAMP`);
      const result = await client.query<Record<string, unknown>>(
        `UPDATE ${table} SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *`,
        [req.params.id]
      );
      return result.rows[0] || null;
    });

    if (!config) {
      return res.status(404).json({ error: 'Not Found', message: '上游配置不存在' });
    }

    return res.json({ config: normalizeUpstreamRow(config) });
  } catch (error) {
    logger.error(`[Admin] Set default ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '设置默认上游配置失败',
    });
  }
}

async function updateUpstreamLoadBalancing(
  req: AuthenticatedRequest,
  res: Response,
  table: UpstreamTable
): Promise<Response> {
  try {
    const allowed: Record<string, (value: unknown) => unknown> = {
      lb_strategy: value => {
        const strategy = text(value) || 'round_robin';
        if (!LB_STRATEGIES.has(strategy)) {
          throw new Error('Invalid load balancing strategy');
        }
        return strategy;
      },
      lb_weight: value => Math.max(1, intValue(value, 1)),
      lb_priority: value => Math.max(0, intValue(value, 0)),
      max_connections: value => Math.max(1, intValue(value, 100)),
      rate_limit_per_minute: value => Math.max(1, intValue(value, 60)),
    };
    const updates = buildUpdates(req.body, allowed);
    if (updates.sets.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '没有可更新字段',
      });
    }

    updates.values.push(req.params.id);
    const config = await db.queryOne<Record<string, unknown>>(
      `
        UPDATE ${table}
        SET ${updates.sets.join(', ')}, updated_at = CURRENT_TIMESTAMP
        WHERE id = $${updates.values.length}
        RETURNING *
      `,
      updates.values
    );

    if (!config) {
      return res.status(404).json({ error: 'Not Found', message: '上游配置不存在' });
    }

    return res.json({ config: normalizeUpstreamRow(config) });
  } catch (error) {
    const message = (error as Error).message === 'Invalid load balancing strategy'
      ? '负载均衡策略无效'
      : '更新负载均衡配置失败';
    logger.error(`[Admin] Update load balancing ${table} failed:`, error);
    return res.status(message === '负载均衡策略无效' ? 400 : 500).json({
      error: message === '负载均衡策略无效' ? 'Bad Request' : 'Internal Server Error',
      message,
    });
  }
}

async function getLoadBalancerStats(res: Response, table: UpstreamTable): Promise<Response> {
  try {
    const rows = await db.query<Record<string, unknown>>(
      `SELECT * FROM ${table} ORDER BY is_default DESC, lb_priority ASC, created_at DESC`
    );
    const stats = rows.map(row => {
      const normalized = normalizeUpstreamRow(row);
      return {
        provider_name: normalized.provider_name,
        current_connections: normalized.current_connections,
        total_requests: normalized.total_requests,
        available: normalized.available,
      };
    });
    return res.json({ stats });
  } catch (error) {
    logger.error(`[Admin] Load balancer stats ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '加载负载均衡统计失败',
    });
  }
}

async function resetLoadBalancerStats(res: Response, table: UpstreamTable): Promise<Response> {
  try {
    await db.query(`
      UPDATE ${table}
      SET
        current_connections = 0,
        current_minute_requests = 0,
        total_requests = 0,
        success_count = 0,
        error_count = 0,
        total_latency_ms = 0,
        last_used_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    `);
    return res.json({ success: true });
  } catch (error) {
    logger.error(`[Admin] Reset load balancer stats ${table} failed:`, error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '重置负载均衡统计失败',
    });
  }
}

export default router;
