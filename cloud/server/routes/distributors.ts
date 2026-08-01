import * as crypto from 'crypto';

import { Router, Response } from 'express';
import { z } from 'zod';

import { hashPassword } from '../../auth/crypto';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth';

const router = Router();

let db: DatabaseConnection;

const createDistributorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  invite_code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4,20}$/).optional(),
  contact_name: z.string().trim().max(120).optional(),
  contact_phone: z.string().trim().max(80).optional(),
  commission_rate: z.coerce.number().min(0).max(100).default(0),
  notes: z.string().trim().max(2000).optional(),
  account_email: z.string().trim().email().max(255).optional(),
  account_password: z.string().min(8).max(200).optional(),
}).refine(
  value => Boolean(value.account_email) === Boolean(value.account_password),
  { message: '分销商登录邮箱和密码必须同时填写' }
);

const updateDistributorSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  contact_name: z.string().trim().max(120).nullable().optional(),
  contact_phone: z.string().trim().max(80).nullable().optional(),
  commission_rate: z.coerce.number().min(0).max(100).optional(),
  status: z.enum(['active', 'disabled']).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
}).refine(value => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

const upsertDistributorAccountSchema = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(8).max(200).optional(),
  display_name: z.string().trim().max(120).nullable().optional(),
  status: z.enum(['active', 'disabled']).default('active'),
});

type PeriodType = 'month' | 'year';

interface ReportingPeriod {
  type: PeriodType;
  key: string;
  start: string;
  end: string;
  label: string;
}

interface DistributorRow {
  id: string;
  name: string;
  invite_code: string;
  contact_name: string | null;
  contact_phone: string | null;
  commission_rate: string | number;
  status: 'active' | 'disabled';
  notes: string | null;
  created_at: Date;
  updated_at: Date;
  account_email: string | null;
  account_display_name: string | null;
  account_status: 'active' | 'disabled' | null;
  account_last_login_at: Date | null;
  period_registrations: string | number;
  total_registrations: string | number;
  period_purchases: string | number;
  period_gross_revenue: string | number;
  period_refund_amount: string | number;
  period_net_revenue: string | number;
}

interface PackageBreakdownRow {
  distributor_id: string;
  package_type: string;
  purchase_count: string | number;
  gross_revenue: string | number;
  refund_amount: string | number;
  net_revenue: string | number;
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function calculateCommission(netRevenue: number, commissionRate: number): number {
  const safeRevenue = Math.max(0, numberValue(netRevenue));
  const safeRate = Math.min(100, Math.max(0, numberValue(commissionRate)));
  return Math.round(safeRevenue * safeRate) / 100;
}

export function parseReportingPeriod(typeValue: unknown, keyValue: unknown): ReportingPeriod {
  const type: PeriodType = typeValue === 'year' ? 'year' : 'month';
  const now = new Date();

  if (type === 'year') {
    const fallbackYear = now.getFullYear();
    const candidate = typeof keyValue === 'string' ? keyValue.trim() : '';
    const year = /^\d{4}$/.test(candidate) ? Number(candidate) : fallbackYear;
    if (year < 2000 || year > 2200) {
      throw new Error('INVALID_REPORTING_PERIOD');
    }
    return {
      type,
      key: String(year),
      start: `${year}-01-01T00:00:00+08:00`,
      end: `${year + 1}-01-01T00:00:00+08:00`,
      label: `${year} 年`,
    };
  }

  const fallbackKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const candidate = typeof keyValue === 'string' ? keyValue.trim() : '';
  const key = /^\d{4}-(0[1-9]|1[0-2])$/.test(candidate) ? candidate : fallbackKey;
  const [year, month] = key.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;

  return {
    type,
    key,
    start: `${key}-01T00:00:00+08:00`,
    end: `${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+08:00`,
    label: `${year} 年 ${month} 月`,
  };
}

function normalizeInviteCode(value: string): string {
  return value.trim().toUpperCase();
}

function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(9);
  let suffix = '';
  for (const byte of bytes) {
    suffix += alphabet[byte % alphabet.length];
  }
  return `DLR${suffix}`;
}

function nullableAdminId(userId: string): string | null {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
    ? userId
    : null;
}

async function inviteCodeExists(inviteCode: string): Promise<boolean> {
  const result = await db.queryOne<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM distributors WHERE UPPER(invite_code) = $1
       UNION ALL
       SELECT 1 FROM users WHERE UPPER(referral_code) = $1
       UNION ALL
       SELECT 1 FROM beta_codes WHERE UPPER(code) = $1
     ) AS exists`,
    [inviteCode]
  );
  return Boolean(result?.exists);
}

async function createUniqueInviteCode(requested?: string): Promise<string> {
  if (requested) {
    const normalized = normalizeInviteCode(requested);
    if (await inviteCodeExists(normalized)) {
      throw new Error('INVITE_CODE_CONFLICT');
    }
    return normalized;
  }

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const generated = generateInviteCode();
    if (!(await inviteCodeExists(generated))) {
      return generated;
    }
  }

  throw new Error('INVITE_CODE_GENERATION_FAILED');
}

function getPackageTypeSql(alias = 'payment'): string {
  return `COALESCE(
    ${alias}.metadata->>'package_type',
    subscription.plan_type,
    activation_code.code_type,
    ${alias}.payment_type
  )`;
}

export function initializeDistributorRoutes(database: DatabaseConnection): void {
  db = database;
}

router.get('/', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const period = parseReportingPeriod(req.query.period_type, req.query.period);
    const rows = await db.query<DistributorRow>(
      `WITH registration_metrics AS (
         SELECT
           distributor_id,
           COUNT(*) FILTER (
             WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
           ) AS period_registrations,
           COUNT(*) AS total_registrations
         FROM users
         WHERE distributor_id IS NOT NULL
         GROUP BY distributor_id
       ),
       attributed_payments AS (
         SELECT
           COALESCE(payment.distributor_id, app_user.distributor_id) AS distributor_id,
           payment.amount,
           payment.refund_amount,
           payment.status,
           COALESCE(payment.paid_at, payment.created_at) AS effective_paid_at
         FROM payments AS payment
         JOIN users AS app_user ON app_user.id = payment.user_id
         WHERE COALESCE(payment.distributor_id, app_user.distributor_id) IS NOT NULL
           AND payment.status IN ('success', 'refunded')
       ),
       payment_metrics AS (
         SELECT
           distributor_id,
           COUNT(*) FILTER (
             WHERE effective_paid_at >= $1::timestamptz AND effective_paid_at < $2::timestamptz
           ) AS period_purchases,
           COALESCE(SUM(amount) FILTER (
             WHERE effective_paid_at >= $1::timestamptz AND effective_paid_at < $2::timestamptz
           ), 0) AS period_gross_revenue,
           COALESCE(SUM(
             CASE
               WHEN effective_paid_at >= $1::timestamptz AND effective_paid_at < $2::timestamptz
               THEN CASE
                 WHEN status = 'refunded' AND refund_amount IS NULL THEN amount
                 ELSE COALESCE(refund_amount, 0)
               END
               ELSE 0
             END
           ), 0) AS period_refund_amount,
           COALESCE(SUM(
             CASE
               WHEN effective_paid_at >= $1::timestamptz AND effective_paid_at < $2::timestamptz
               THEN GREATEST(
                 amount - CASE
                   WHEN status = 'refunded' AND refund_amount IS NULL THEN amount
                   ELSE COALESCE(refund_amount, 0)
                 END,
                 0
               )
               ELSE 0
             END
           ), 0) AS period_net_revenue
         FROM attributed_payments
         GROUP BY distributor_id
       )
       SELECT
         distributor.*,
         account.email AS account_email,
         account.display_name AS account_display_name,
         account.status AS account_status,
         account.last_login_at AS account_last_login_at,
         COALESCE(registration.period_registrations, 0) AS period_registrations,
         COALESCE(registration.total_registrations, 0) AS total_registrations,
         COALESCE(payment.period_purchases, 0) AS period_purchases,
         COALESCE(payment.period_gross_revenue, 0) AS period_gross_revenue,
         COALESCE(payment.period_refund_amount, 0) AS period_refund_amount,
         COALESCE(payment.period_net_revenue, 0) AS period_net_revenue
       FROM distributors AS distributor
       LEFT JOIN distributor_accounts AS account ON account.distributor_id = distributor.id
       LEFT JOIN registration_metrics AS registration ON registration.distributor_id = distributor.id
       LEFT JOIN payment_metrics AS payment ON payment.distributor_id = distributor.id
       ORDER BY distributor.created_at DESC`,
      [period.start, period.end]
    );

    const packageRows = await db.query<PackageBreakdownRow>(
      `SELECT
         COALESCE(payment.distributor_id, app_user.distributor_id) AS distributor_id,
         ${getPackageTypeSql()} AS package_type,
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
       WHERE COALESCE(payment.distributor_id, app_user.distributor_id) IS NOT NULL
         AND payment.status IN ('success', 'refunded')
         AND COALESCE(payment.paid_at, payment.created_at) >= $1::timestamptz
         AND COALESCE(payment.paid_at, payment.created_at) < $2::timestamptz
       GROUP BY COALESCE(payment.distributor_id, app_user.distributor_id), ${getPackageTypeSql()}
       ORDER BY purchase_count DESC, package_type ASC`,
      [period.start, period.end]
    );

    const packageMap = new Map<string, Array<Record<string, unknown>>>();
    for (const packageRow of packageRows) {
      const current = packageMap.get(packageRow.distributor_id) || [];
      current.push({
        package_type: packageRow.package_type,
        purchase_count: numberValue(packageRow.purchase_count),
        gross_revenue: numberValue(packageRow.gross_revenue),
        refund_amount: numberValue(packageRow.refund_amount),
        net_revenue: numberValue(packageRow.net_revenue),
      });
      packageMap.set(packageRow.distributor_id, current);
    }

    const distributors = rows.map(row => {
      const commissionRate = numberValue(row.commission_rate);
      const netRevenue = numberValue(row.period_net_revenue);
      return {
        id: row.id,
        name: row.name,
        invite_code: row.invite_code,
        contact_name: row.contact_name,
        contact_phone: row.contact_phone,
        commission_rate: commissionRate,
        status: row.status,
        notes: row.notes,
        created_at: row.created_at,
        updated_at: row.updated_at,
        account: row.account_email
          ? {
              email: row.account_email,
              display_name: row.account_display_name,
              status: row.account_status,
              last_login_at: row.account_last_login_at,
            }
          : null,
        metrics: {
          period_registrations: numberValue(row.period_registrations),
          total_registrations: numberValue(row.total_registrations),
          period_purchases: numberValue(row.period_purchases),
          gross_revenue: numberValue(row.period_gross_revenue),
          refund_amount: numberValue(row.period_refund_amount),
          net_revenue: netRevenue,
          commission_amount: calculateCommission(netRevenue, commissionRate),
        },
        package_breakdown: packageMap.get(row.id) || [],
      };
    });

    return res.json({
      period: {
        type: period.type,
        key: period.key,
        label: period.label,
        start: period.start,
        end: period.end,
      },
      summary: distributors.reduce(
        (summary, distributor) => ({
          distributors: summary.distributors + 1,
          registrations: summary.registrations + distributor.metrics.period_registrations,
          purchases: summary.purchases + distributor.metrics.period_purchases,
          net_revenue: summary.net_revenue + distributor.metrics.net_revenue,
          commission_amount: summary.commission_amount + distributor.metrics.commission_amount,
        }),
        { distributors: 0, registrations: 0, purchases: 0, net_revenue: 0, commission_amount: 0 }
      ),
      distributors,
    });
  } catch (error) {
    if ((error as Error).message === 'INVALID_REPORTING_PERIOD') {
      return res.status(400).json({
        code: 'INVALID_REPORTING_PERIOD',
        message: '统计周期格式不正确',
        recoverable: true,
      });
    }
    logger.error('[Distributors] List failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_LIST_FAILED',
      message: '读取分销商统计失败',
      recoverable: true,
    });
  }
});

router.post('/', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = createDistributorSchema.parse(req.body);
    const inviteCode = await createUniqueInviteCode(input.invite_code);
    const passwordHash = input.account_password
      ? await hashPassword(input.account_password)
      : null;
    const adminId = nullableAdminId(req.user!.userId);
    const distributor = await db.transaction(async client => {
      const insertResult = await client.query(
        `INSERT INTO distributors (
           name, invite_code, contact_name, contact_phone,
           commission_rate, notes, created_by
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          input.name,
          inviteCode,
          input.contact_name || null,
          input.contact_phone || null,
          input.commission_rate,
          input.notes || null,
          adminId,
        ]
      );
      const created = insertResult.rows[0];

      if (input.account_email && passwordHash) {
        await client.query(
          `INSERT INTO distributor_accounts (
             distributor_id, email, password_hash, display_name
           )
           VALUES ($1, LOWER($2), $3, $4)`,
          [
            created.id,
            input.account_email,
            passwordHash,
            input.contact_name || input.name,
          ]
        );
      }

      if (adminId) {
        await client.query(
          `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address)
           VALUES ($1, 'distributor.create', 'distributor', $2, $3::jsonb, $4)`,
          [
            adminId,
            created.id,
            JSON.stringify({
              invite_code: inviteCode,
              commission_rate: input.commission_rate,
              account_email: input.account_email || null,
            }),
            req.ip || null,
          ]
        );
      }
      return created;
    });

    return res.status(201).json({ distributor });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        code: 'INVALID_DISTRIBUTOR_INPUT',
        message: error.issues[0]?.message || '分销商信息格式不正确',
        recoverable: true,
      });
    }
    if ((error as Error).message === 'INVITE_CODE_CONFLICT') {
      return res.status(409).json({
        code: 'INVITE_CODE_CONFLICT',
        message: '邀请码已被内测码、好友邀请码或其他分销商使用',
        recoverable: true,
      });
    }
    logger.error('[Distributors] Create failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_CREATE_FAILED',
      message: '创建分销商邀请码失败',
      recoverable: true,
    });
  }
});

router.put('/:id/account', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = upsertDistributorAccountSchema.parse(req.body);
    const distributor = await db.queryOne<{ id: string }>(
      'SELECT id FROM distributors WHERE id = $1',
      [req.params.id]
    );
    if (!distributor) {
      return res.status(404).json({
        code: 'DISTRIBUTOR_NOT_FOUND',
        message: '分销商不存在',
        recoverable: false,
      });
    }

    const current = await db.queryOne<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM distributor_accounts WHERE distributor_id = $1',
      [req.params.id]
    );
    if (!current && !input.password) {
      return res.status(400).json({
        code: 'DISTRIBUTOR_PASSWORD_REQUIRED',
        message: '首次创建登录账户时必须设置至少 8 位密码',
        recoverable: true,
      });
    }

    const passwordHash = input.password
      ? await hashPassword(input.password)
      : current!.password_hash;
    const account = await db.queryOne(
      `INSERT INTO distributor_accounts (
         distributor_id, email, password_hash, display_name, status
       )
       VALUES ($1, LOWER($2), $3, $4, $5)
       ON CONFLICT (distributor_id) DO UPDATE SET
         email = EXCLUDED.email,
         password_hash = EXCLUDED.password_hash,
         display_name = EXCLUDED.display_name,
         status = EXCLUDED.status,
         updated_at = CURRENT_TIMESTAMP
       RETURNING id, distributor_id, email, display_name, status, last_login_at, created_at, updated_at`,
      [
        req.params.id,
        input.email,
        passwordHash,
        input.display_name ?? null,
        input.status,
      ]
    );

    const adminId = nullableAdminId(req.user!.userId);
    if (adminId) {
      await db.query(
        `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address)
         VALUES ($1, 'distributor.account.upsert', 'distributor', $2, $3::jsonb, $4)`,
        [
          adminId,
          req.params.id,
          JSON.stringify({
            email: input.email,
            status: input.status,
            password_reset: Boolean(input.password),
          }),
          req.ip || null,
        ]
      );
    }

    return res.json({ account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        code: 'INVALID_DISTRIBUTOR_ACCOUNT_INPUT',
        message: error.issues[0]?.message || '分销商登录账户格式不正确',
        recoverable: true,
      });
    }
    if ((error as { code?: string }).code === '23505') {
      return res.status(409).json({
        code: 'DISTRIBUTOR_EMAIL_CONFLICT',
        message: '该登录邮箱已绑定其他分销商',
        recoverable: true,
      });
    }
    logger.error('[Distributors] Account upsert failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_ACCOUNT_UPDATE_FAILED',
      message: '保存分销商登录账户失败',
      recoverable: true,
    });
  }
});

router.patch('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = updateDistributorSchema.parse(req.body);
    const current = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM distributors WHERE id = $1',
      [req.params.id]
    );
    if (!current) {
      return res.status(404).json({
        code: 'DISTRIBUTOR_NOT_FOUND',
        message: '分销商不存在',
        recoverable: false,
      });
    }

    const distributor = await db.queryOne(
      `UPDATE distributors
       SET name = COALESCE($1, name),
           contact_name = CASE WHEN $2::boolean THEN $3 ELSE contact_name END,
           contact_phone = CASE WHEN $4::boolean THEN $5 ELSE contact_phone END,
           commission_rate = COALESCE($6, commission_rate),
           status = COALESCE($7, status),
           notes = CASE WHEN $8::boolean THEN $9 ELSE notes END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $10
       RETURNING *`,
      [
        input.name || null,
        Object.prototype.hasOwnProperty.call(input, 'contact_name'),
        input.contact_name ?? null,
        Object.prototype.hasOwnProperty.call(input, 'contact_phone'),
        input.contact_phone ?? null,
        input.commission_rate ?? null,
        input.status || null,
        Object.prototype.hasOwnProperty.call(input, 'notes'),
        input.notes ?? null,
        req.params.id,
      ]
    );

    await db.query(
      `INSERT INTO admin_logs (admin_id, action, target_type, target_id, details, ip_address)
       VALUES ($1, 'distributor.update', 'distributor', $2, $3::jsonb, $4)`,
      [req.user!.userId, req.params.id, JSON.stringify({ before: current, changes: input }), req.ip || null]
    );

    return res.json({ distributor });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        code: 'INVALID_DISTRIBUTOR_INPUT',
        message: error.issues[0]?.message || '分销商信息格式不正确',
        recoverable: true,
      });
    }
    logger.error('[Distributors] Update failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_UPDATE_FAILED',
      message: '更新分销商失败',
      recoverable: true,
    });
  }
});

router.get('/:id/purchases', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const period = parseReportingPeriod(req.query.period_type, req.query.period);
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const purchases = await db.query(
      `SELECT
         payment.id,
         payment.user_id,
         app_user.email AS user_email,
         app_user.username,
         payment.payment_type,
         ${getPackageTypeSql()} AS package_type,
         payment.amount,
         payment.currency,
         payment.payment_method,
         payment.status,
         COALESCE(payment.refund_amount, 0) AS refund_amount,
         GREATEST(
           payment.amount - CASE
             WHEN payment.status = 'refunded' AND payment.refund_amount IS NULL THEN payment.amount
             ELSE COALESCE(payment.refund_amount, 0)
           END,
           0
         ) AS net_revenue,
         payment.created_at,
         payment.paid_at
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
       LIMIT $4`,
      [req.params.id, period.start, period.end, limit]
    );

    return res.json({
      period: {
        type: period.type,
        key: period.key,
        label: period.label,
      },
      purchases: purchases.map(purchase => ({
        ...purchase,
        amount: numberValue((purchase as Record<string, unknown>).amount as string | number),
        refund_amount: numberValue((purchase as Record<string, unknown>).refund_amount as string | number),
        net_revenue: numberValue((purchase as Record<string, unknown>).net_revenue as string | number),
      })),
    });
  } catch (error) {
    logger.error('[Distributors] Purchase history failed:', error);
    return res.status(500).json({
      code: 'DISTRIBUTOR_PURCHASES_FAILED',
      message: '读取分销商购买明细失败',
      recoverable: true,
    });
  }
});

export default router;
