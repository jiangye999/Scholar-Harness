import { Router, Request, Response } from 'express';
import { z } from 'zod';

import { verifyPassword } from '../../auth/crypto';
import { generateTokenPair, verifyRefreshToken } from '../../auth/jwt';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import {
  authMiddleware,
  AuthenticatedRequest,
  rateLimitMiddleware,
} from '../middleware/auth';
import { calculateCommission, parseReportingPeriod } from './distributors';

const router = Router();

let db: DatabaseConnection;

interface DistributorAccountRow {
  account_id: string;
  distributor_id: string;
  email: string;
  password_hash: string;
  display_name: string | null;
  account_status: 'active' | 'disabled';
  name: string;
  invite_code: string;
  contact_name: string | null;
  contact_phone: string | null;
  commission_rate: string | number;
  distributor_status: 'active' | 'disabled';
}

interface DashboardMetricRow {
  period_registrations: string | number;
  total_registrations: string | number;
  period_purchases: string | number;
  gross_revenue: string | number;
  refund_amount: string | number;
  net_revenue: string | number;
}

const loginSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200),
});

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function packageTypeSql(alias = 'payment'): string {
  return `COALESCE(
    ${alias}.metadata->>'package_type',
    subscription.plan_type,
    activation_code.code_type,
    ${alias}.payment_type
  )`;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return email;
  const visible = local.length <= 2 ? local.slice(0, 1) : local.slice(0, 2);
  return `${visible}${'*'.repeat(Math.max(2, Math.min(6, local.length - visible.length)))}@${domain}`;
}

async function findAccountByEmail(email: string): Promise<DistributorAccountRow | null> {
  return db.queryOne<DistributorAccountRow>(
    `SELECT
       account.id AS account_id,
       account.distributor_id,
       account.email,
       account.password_hash,
       account.display_name,
       account.status AS account_status,
       distributor.name,
       distributor.invite_code,
       distributor.contact_name,
       distributor.contact_phone,
       distributor.commission_rate,
       distributor.status AS distributor_status
     FROM distributor_accounts AS account
     JOIN distributors AS distributor ON distributor.id = account.distributor_id
     WHERE LOWER(account.email) = LOWER($1)`,
    [email]
  );
}

async function resolveAccount(req: AuthenticatedRequest): Promise<DistributorAccountRow | null> {
  if (!req.user || req.user.role !== 'distributor') return null;
  return db.queryOne<DistributorAccountRow>(
    `SELECT
       account.id AS account_id,
       account.distributor_id,
       account.email,
       account.password_hash,
       account.display_name,
       account.status AS account_status,
       distributor.name,
       distributor.invite_code,
       distributor.contact_name,
       distributor.contact_phone,
       distributor.commission_rate,
       distributor.status AS distributor_status
     FROM distributor_accounts AS account
     JOIN distributors AS distributor ON distributor.id = account.distributor_id
     WHERE account.id = $1`,
    [req.user.userId]
  );
}

function accountAvailable(account: DistributorAccountRow | null): account is DistributorAccountRow {
  return Boolean(
    account
    && account.account_status === 'active'
    && account.distributor_status === 'active'
  );
}

function tokensFor(account: DistributorAccountRow) {
  return generateTokenPair({
    userId: account.account_id,
    email: account.email,
    role: 'distributor',
    source: 'cloud',
  });
}

export function initializeDistributorPortalRoutes(database: DatabaseConnection): void {
  db = database;
}

router.post('/login', rateLimitMiddleware(10, 60_000), async (req: Request, res: Response) => {
  try {
    const input = loginSchema.parse(req.body);
    const account = await findAccountByEmail(input.email);
    const validPassword = account
      ? await verifyPassword(input.password, account.password_hash)
      : false;

    if (!account || !validPassword) {
      return res.status(401).json({
        code: 'INVALID_DISTRIBUTOR_CREDENTIALS',
        message: '邮箱或密码不正确',
        recoverable: true,
      });
    }
    if (!accountAvailable(account)) {
      return res.status(403).json({
        code: 'DISTRIBUTOR_ACCOUNT_DISABLED',
        message: '该分销商账户已停用，请联系管理员',
        recoverable: false,
      });
    }

    await db.query(
      `UPDATE distributor_accounts
       SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [account.account_id]
    );

    return res.json({
      tokens: tokensFor(account),
      distributor: {
        name: account.name,
        invite_code: account.invite_code,
        display_name: account.display_name,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        code: 'INVALID_LOGIN_INPUT',
        message: '请输入有效邮箱和至少 8 位密码',
        recoverable: true,
      });
    }
    logger.error('[DistributorPortal] Login failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_LOGIN_FAILED',
      message: '登录失败，请稍后重试',
      recoverable: true,
    });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const refreshToken = typeof req.body?.refreshToken === 'string'
      ? req.body.refreshToken
      : '';
    const payload = refreshToken ? verifyRefreshToken(refreshToken) : null;
    if (!payload) {
      return res.status(401).json({
        code: 'INVALID_REFRESH_TOKEN',
        message: '登录已过期，请重新登录',
        recoverable: true,
      });
    }

    const account = await db.queryOne<DistributorAccountRow>(
      `SELECT
         account.id AS account_id,
         account.distributor_id,
         account.email,
         account.password_hash,
         account.display_name,
         account.status AS account_status,
         distributor.name,
         distributor.invite_code,
         distributor.contact_name,
         distributor.contact_phone,
         distributor.commission_rate,
         distributor.status AS distributor_status
       FROM distributor_accounts AS account
       JOIN distributors AS distributor ON distributor.id = account.distributor_id
       WHERE account.id = $1`,
      [payload.userId]
    );

    if (!accountAvailable(account)) {
      return res.status(401).json({
        code: 'DISTRIBUTOR_ACCOUNT_UNAVAILABLE',
        message: '分销商账户不存在或已停用',
        recoverable: false,
      });
    }
    return res.json({ tokens: tokensFor(account) });
  } catch (error) {
    logger.error('[DistributorPortal] Refresh failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_REFRESH_FAILED',
      message: '登录续期失败',
      recoverable: true,
    });
  }
});

router.get('/dashboard', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const account = await resolveAccount(req);
    if (!accountAvailable(account)) {
      return res.status(403).json({
        code: 'DISTRIBUTOR_ACCESS_DENIED',
        message: '无权访问该分销商数据',
        recoverable: false,
      });
    }

    const period = parseReportingPeriod(req.query.period_type, req.query.period);
    const metric = await db.queryOne<DashboardMetricRow>(
      `SELECT
         (SELECT COUNT(*) FROM users
          WHERE distributor_id = $1
            AND created_at >= $2::timestamptz
            AND created_at < $3::timestamptz) AS period_registrations,
         (SELECT COUNT(*) FROM users WHERE distributor_id = $1) AS total_registrations,
         COUNT(payment.id) AS period_purchases,
         COALESCE(SUM(payment.amount), 0) AS gross_revenue,
         COALESCE(SUM(
           CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END
         ), 0) AS refund_amount,
         COALESCE(SUM(GREATEST(
           payment.amount - CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END,
           0
         )), 0) AS net_revenue
       FROM payments AS payment
       JOIN users AS app_user ON app_user.id = payment.user_id
       WHERE COALESCE(payment.distributor_id, app_user.distributor_id) = $1
         AND payment.status IN ('success', 'refunded')
         AND COALESCE(payment.paid_at, payment.created_at) >= $2::timestamptz
         AND COALESCE(payment.paid_at, payment.created_at) < $3::timestamptz`,
      [account.distributor_id, period.start, period.end]
    );

    const packageRows = await db.query<Record<string, unknown>>(
      `SELECT
         ${packageTypeSql()} AS package_type,
         COUNT(*) AS purchase_count,
         COALESCE(SUM(payment.amount), 0) AS gross_revenue,
         COALESCE(SUM(
           CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END
         ), 0) AS refund_amount,
         COALESCE(SUM(GREATEST(
           payment.amount - CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END,
           0
         )), 0) AS net_revenue
       FROM payments AS payment
       JOIN users AS app_user ON app_user.id = payment.user_id
       LEFT JOIN subscriptions AS subscription
         ON subscription.id = payment.related_id
        AND payment.payment_type IN ('subscription', 'renewal')
       LEFT JOIN activation_codes AS activation_code
         ON activation_code.id = payment.related_id
        AND payment.payment_type = 'activation_code'
       WHERE COALESCE(payment.distributor_id, app_user.distributor_id) = $1
         AND payment.status IN ('success', 'refunded')
         AND COALESCE(payment.paid_at, payment.created_at) >= $2::timestamptz
         AND COALESCE(payment.paid_at, payment.created_at) < $3::timestamptz
       GROUP BY ${packageTypeSql()}
       ORDER BY purchase_count DESC, package_type ASC`,
      [account.distributor_id, period.start, period.end]
    );

    const customers = await db.query<Record<string, unknown>>(
      `SELECT
         app_user.id,
         app_user.email,
         app_user.username,
         app_user.created_at,
         COUNT(payment.id) FILTER (WHERE payment.status IN ('success', 'refunded')) AS purchase_count,
         COALESCE(SUM(GREATEST(
           payment.amount - CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END,
           0
         )) FILTER (WHERE payment.status IN ('success', 'refunded')), 0) AS net_revenue,
         MAX(COALESCE(payment.paid_at, payment.created_at))
           FILTER (WHERE payment.status IN ('success', 'refunded')) AS last_purchase_at
       FROM users AS app_user
       LEFT JOIN payments AS payment
         ON payment.user_id = app_user.id
        AND COALESCE(payment.distributor_id, app_user.distributor_id) = $1
       WHERE app_user.distributor_id = $1
       GROUP BY app_user.id
       ORDER BY app_user.created_at DESC
       LIMIT 500`,
      [account.distributor_id]
    );

    const purchases = await db.query<Record<string, unknown>>(
      `SELECT
         payment.id,
         app_user.email,
         ${packageTypeSql()} AS package_type,
         payment.amount,
         payment.currency,
         payment.status,
         COALESCE(payment.refund_amount, 0) AS refund_amount,
         GREATEST(
           payment.amount - CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END,
           0
         ) AS net_revenue,
         COALESCE(payment.paid_at, payment.created_at) AS paid_at
       FROM payments AS payment
       JOIN users AS app_user ON app_user.id = payment.user_id
       LEFT JOIN subscriptions AS subscription
         ON subscription.id = payment.related_id
        AND payment.payment_type IN ('subscription', 'renewal')
       LEFT JOIN activation_codes AS activation_code
         ON activation_code.id = payment.related_id
        AND payment.payment_type = 'activation_code'
       WHERE COALESCE(payment.distributor_id, app_user.distributor_id) = $1
         AND payment.status IN ('success', 'refunded')
         AND COALESCE(payment.paid_at, payment.created_at) >= $2::timestamptz
         AND COALESCE(payment.paid_at, payment.created_at) < $3::timestamptz
       ORDER BY COALESCE(payment.paid_at, payment.created_at) DESC
       LIMIT 500`,
      [account.distributor_id, period.start, period.end]
    );

    const netRevenue = numberValue(metric?.net_revenue);
    const commissionRate = numberValue(account.commission_rate);
    return res.json({
      period: {
        type: period.type,
        key: period.key,
        label: period.label,
      },
      distributor: {
        name: account.name,
        invite_code: account.invite_code,
        display_name: account.display_name,
        contact_name: account.contact_name,
        commission_rate: commissionRate,
      },
      metrics: {
        period_registrations: numberValue(metric?.period_registrations),
        total_registrations: numberValue(metric?.total_registrations),
        period_purchases: numberValue(metric?.period_purchases),
        gross_revenue: numberValue(metric?.gross_revenue),
        refund_amount: numberValue(metric?.refund_amount),
        net_revenue: netRevenue,
        commission_amount: calculateCommission(netRevenue, commissionRate),
      },
      package_breakdown: packageRows.map(row => ({
        package_type: row.package_type || '未分类套餐',
        purchase_count: numberValue(row.purchase_count as string | number),
        gross_revenue: numberValue(row.gross_revenue as string | number),
        refund_amount: numberValue(row.refund_amount as string | number),
        net_revenue: numberValue(row.net_revenue as string | number),
      })),
      customers: customers.map(row => ({
        id: row.id,
        email: maskEmail(String(row.email || '')),
        username: row.username,
        registered_at: row.created_at,
        purchase_count: numberValue(row.purchase_count as string | number),
        net_revenue: numberValue(row.net_revenue as string | number),
        last_purchase_at: row.last_purchase_at,
      })),
      purchases: purchases.map(row => ({
        id: row.id,
        customer_email: maskEmail(String(row.email || '')),
        package_type: row.package_type || '未分类套餐',
        amount: numberValue(row.amount as string | number),
        currency: row.currency || 'CNY',
        status: row.status,
        refund_amount: numberValue(row.refund_amount as string | number),
        net_revenue: numberValue(row.net_revenue as string | number),
        paid_at: row.paid_at,
      })),
    });
  } catch (error) {
    if ((error as Error).message === 'INVALID_REPORTING_PERIOD') {
      return res.status(400).json({
        code: 'INVALID_REPORTING_PERIOD',
        message: '统计周期格式不正确',
        recoverable: true,
      });
    }
    logger.error('[DistributorPortal] Dashboard failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_DASHBOARD_FAILED',
      message: '读取分销商数据失败',
      recoverable: true,
    });
  }
});

export default router;
