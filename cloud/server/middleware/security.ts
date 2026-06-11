import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { DatabaseConnection } from '../../database/connection';
import { extractTokenFromHeader, verifyAccessToken } from '../../auth/jwt';
import { logger } from '../../utils/logger';

type RiskLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

type SecurityContext = {
  requestId: string;
  ipAddress: string;
  deviceId: string | null;
  userAgent: string;
  route: string;
  method: string;
  startedAt: number;
  userId?: string;
  source?: string;
};

type SecurityEventInput = {
  req?: Request;
  eventType: string;
  riskLevel?: RiskLevel;
  userId?: string | null;
  deviceId?: string | null;
  ipAddress?: string | null;
  statusCode?: number | null;
  metadata?: Record<string, unknown>;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type RateLimitRule = {
  name: string;
  limit: number;
  windowMs: number;
};

const DEFAULT_GLOBAL_LIMIT_PER_MIN = parseInt(process.env.SECURITY_GLOBAL_LIMIT_PER_MIN || '300', 10);
const DEFAULT_AUTH_LIMIT_PER_MIN = parseInt(process.env.SECURITY_AUTH_LIMIT_PER_MIN || '20', 10);
const DEFAULT_PAYMENT_LIMIT_PER_MIN = parseInt(process.env.SECURITY_PAYMENT_LIMIT_PER_MIN || '60', 10);
const DEFAULT_HEAVY_LIMIT_PER_MIN = parseInt(process.env.SECURITY_HEAVY_LIMIT_PER_MIN || '90', 10);
const DEFAULT_USER_IP_WARN_PER_DAY = parseInt(process.env.SECURITY_USER_IP_WARN_PER_DAY || '6', 10);
const DEFAULT_USER_IP_BLOCK_PER_DAY = parseInt(process.env.SECURITY_USER_IP_BLOCK_PER_DAY || '12', 10);
const DEFAULT_DEVICE_USER_WARN_PER_DAY = parseInt(process.env.SECURITY_DEVICE_USER_WARN_PER_DAY || '2', 10);
const DEFAULT_DEVICE_USER_BLOCK_PER_DAY = parseInt(process.env.SECURITY_DEVICE_USER_BLOCK_PER_DAY || '4', 10);

const buckets = new Map<string, Bucket>();
const riskCache = new Map<string, { expiresAt: number; blocked: boolean; reason?: string }>();
let db: DatabaseConnection | null = null;

declare global {
  namespace Express {
    interface Request {
      securityContext?: SecurityContext;
    }
  }
}

export function initializeSecurityMiddleware(database: DatabaseConnection): void {
  db = database;
}

function nowMs(): number {
  return Date.now();
}

function compactBuckets(): void {
  const now = nowMs();
  if (buckets.size < 10000) return;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
}

function hitRateLimit(key: string, rule: RateLimitRule): { limited: boolean; retryAfterSeconds: number } {
  const now = nowMs();
  const bucketKey = `${rule.name}:${key}`;
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + rule.windowMs });
    compactBuckets();
    return { limited: false, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > rule.limit) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  return { limited: false, retryAfterSeconds: 0 };
}

function normalizeHeaderValue(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '');
  return typeof value === 'string' ? value : '';
}

function getClientIp(req: Request): string {
  const forwarded = normalizeHeaderValue(req.headers['x-forwarded-for']);
  const firstForwarded = forwarded.split(',').map(part => part.trim()).find(Boolean);
  return (
    firstForwarded ||
    normalizeHeaderValue(req.headers['x-real-ip']) ||
    req.ip ||
    req.socket.remoteAddress ||
    'unknown'
  ).replace(/^::ffff:/, '').slice(0, 64);
}

function normalizeDeviceId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length < 6 || trimmed.length > 120) return null;
  return trimmed;
}

function getDeviceId(req: Request): string | null {
  return normalizeDeviceId(req.headers['x-device-id'])
    || normalizeDeviceId(req.headers['device-id'])
    || normalizeDeviceId((req.body as any)?.device_id)
    || normalizeDeviceId((req.body as any)?.deviceId)
    || normalizeDeviceId(req.query.device_id);
}

function getVerifiedPayload(req: Request): { userId?: string; source?: string } {
  const token = extractTokenFromHeader(req.headers.authorization);
  if (!token) return {};
  const payload = verifyAccessToken(token);
  if (!payload) return {};
  return { userId: payload.userId, source: payload.source };
}

function selectRateLimitRules(req: Request, context: SecurityContext): Array<{ key: string; rule: RateLimitRule }> {
  const path = req.path.toLowerCase();
  const userOrIp = context.userId ? `user:${context.userId}` : `ip:${context.ipAddress}`;
  const rules: Array<{ key: string; rule: RateLimitRule }> = [
    {
      key: `ip:${context.ipAddress}`,
      rule: { name: 'global-ip-minute', limit: DEFAULT_GLOBAL_LIMIT_PER_MIN, windowMs: 60 * 1000 },
    },
  ];

  if (path.includes('/auth/login') || path.includes('/auth/register') || path.includes('/auth/refresh')) {
    rules.push({
      key: `ip:${context.ipAddress}`,
      rule: { name: 'auth-ip-minute', limit: DEFAULT_AUTH_LIMIT_PER_MIN, windowMs: 60 * 1000 },
    });
    rules.push({
      key: `ip:${context.ipAddress}`,
      rule: { name: 'auth-ip-hour', limit: DEFAULT_AUTH_LIMIT_PER_MIN * 8, windowMs: 60 * 60 * 1000 },
    });
  }

  if (path.includes('/payment') || path.includes('/subscription/purchase')) {
    rules.push({
      key: userOrIp,
      rule: { name: 'payment-minute', limit: DEFAULT_PAYMENT_LIMIT_PER_MIN, windowMs: 60 * 1000 },
    });
  }

  if (path.includes('/usage/report') || path.includes('/prompts') || path.includes('/referral/invite-trial/claim')) {
    rules.push({
      key: userOrIp,
      rule: { name: 'heavy-user-minute', limit: DEFAULT_HEAVY_LIMIT_PER_MIN, windowMs: 60 * 1000 },
    });
  }

  return rules;
}

function isRiskCheckedPath(req: Request): boolean {
  const path = req.path.toLowerCase();
  return (
    path.includes('/usage/report') ||
    path.includes('/prompts') ||
    path.includes('/referral/invite-trial/claim') ||
    path.includes('/activation') ||
    path.includes('/payment/create') ||
    path.includes('/subscription/bind-device')
  );
}

async function evaluateUserDeviceRisk(context: SecurityContext): Promise<{ blocked: boolean; reason?: string }> {
  if (!db || !context.userId || !context.deviceId) {
    return { blocked: false };
  }

  const cacheKey = `${context.userId}:${context.deviceId}:${context.ipAddress}`;
  const cached = riskCache.get(cacheKey);
  if (cached && cached.expiresAt > nowMs()) {
    return { blocked: cached.blocked, reason: cached.reason };
  }

  const [userIpRow, deviceUserRow] = await Promise.all([
    db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT ip_address)::text AS count
       FROM security_events
       WHERE user_id = $1
         AND ip_address IS NOT NULL
         AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
      [context.userId]
    ),
    db.queryOne<{ count: string }>(
      `SELECT COUNT(DISTINCT user_id)::text AS count
       FROM security_events
       WHERE device_id = $1
         AND user_id IS NOT NULL
         AND created_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours'`,
      [context.deviceId]
    ),
  ]);

  const userIpCount = parseInt(userIpRow?.count || '0', 10);
  const deviceUserCount = parseInt(deviceUserRow?.count || '0', 10);

  let blocked = false;
  let reason: string | undefined;

  if (userIpCount >= DEFAULT_USER_IP_BLOCK_PER_DAY) {
    blocked = true;
    reason = `user_ip_count_24h=${userIpCount}`;
  } else if (deviceUserCount >= DEFAULT_DEVICE_USER_BLOCK_PER_DAY) {
    blocked = true;
    reason = `device_user_count_24h=${deviceUserCount}`;
  }

  if (!blocked && userIpCount >= DEFAULT_USER_IP_WARN_PER_DAY) {
    void recordSecurityEvent({
      eventType: 'risk.user_many_ips',
      riskLevel: 'medium',
      userId: context.userId,
      deviceId: context.deviceId,
      ipAddress: context.ipAddress,
      metadata: { user_ip_count_24h: userIpCount },
    });
  }

  if (!blocked && deviceUserCount >= DEFAULT_DEVICE_USER_WARN_PER_DAY) {
    void recordSecurityEvent({
      eventType: 'risk.device_many_users',
      riskLevel: 'medium',
      userId: context.userId,
      deviceId: context.deviceId,
      ipAddress: context.ipAddress,
      metadata: { device_user_count_24h: deviceUserCount },
    });
  }

  riskCache.set(cacheKey, {
    expiresAt: nowMs() + 5 * 60 * 1000,
    blocked,
    reason,
  });

  return { blocked, reason };
}

function classifyAuditEvent(req: Request, statusCode: number): { eventType: string; riskLevel: RiskLevel } | null {
  const path = req.path.toLowerCase();
  const ok = statusCode < 400;

  if (path.includes('/auth/login')) {
    return { eventType: ok ? 'auth.login.success' : 'auth.login.failed', riskLevel: ok ? 'low' : 'medium' };
  }
  if (path.includes('/auth/register')) {
    return { eventType: ok ? 'auth.register.success' : 'auth.register.failed', riskLevel: ok ? 'low' : 'medium' };
  }
  if (path.includes('/auth/refresh')) {
    return { eventType: ok ? 'auth.refresh.success' : 'auth.refresh.failed', riskLevel: ok ? 'info' : 'medium' };
  }
  if (path.includes('/payment/wechat/callback') || path.includes('/payment/alipay/callback')) {
    return { eventType: ok ? 'payment.callback.received' : 'payment.callback.failed', riskLevel: ok ? 'low' : 'high' };
  }
  if (path.includes('/payment/create')) {
    return { eventType: ok ? 'payment.create.success' : 'payment.create.failed', riskLevel: ok ? 'low' : 'medium' };
  }
  if (path.includes('/usage/report')) {
    return { eventType: ok ? 'usage.report.success' : 'usage.report.failed', riskLevel: ok ? 'info' : 'medium' };
  }
  if (path.includes('/prompts')) {
    return { eventType: ok ? 'prompt.access.success' : 'prompt.access.failed', riskLevel: ok ? 'info' : 'medium' };
  }
  if (path.includes('/referral/invite-trial/claim')) {
    return { eventType: ok ? 'referral.invite_trial.claim.success' : 'referral.invite_trial.claim.failed', riskLevel: ok ? 'low' : 'high' };
  }
  if (path.includes('/activation')) {
    return { eventType: ok ? 'activation.request.success' : 'activation.request.failed', riskLevel: ok ? 'low' : 'medium' };
  }

  return null;
}

function safeMetadata(req: Request, durationMs?: number): Record<string, unknown> {
  const body = (req.body && !Buffer.isBuffer(req.body)) ? req.body as Record<string, unknown> : {};
  const metadata: Record<string, unknown> = {
    duration_ms: durationMs,
  };

  for (const key of ['usage_type', 'amount', 'payment_type', 'payment_method', 'plan_type', 'related_id']) {
    if (body[key] !== undefined) {
      metadata[key] = body[key];
    }
  }

  return metadata;
}

export async function recordSecurityEvent(input: SecurityEventInput): Promise<void> {
  if (!db) return;

  const req = input.req;
  const context = req?.securityContext;
  const userId = input.userId ?? (req as any)?.user?.userId ?? context?.userId ?? null;
  const deviceId = input.deviceId ?? context?.deviceId ?? null;
  const ipAddress = input.ipAddress ?? context?.ipAddress ?? (req ? getClientIp(req) : null);
  const userAgent = context?.userAgent || (req ? normalizeHeaderValue(req.headers['user-agent']) : '');
  const route = context?.route || req?.originalUrl || req?.path || '';
  const method = context?.method || req?.method || '';
  const source = (req as any)?.user?.source || context?.source || null;
  const requestId = context?.requestId || normalizeHeaderValue(req?.headers['x-request-id']);

  try {
    await db.query(
      `INSERT INTO security_events (
        user_id, event_type, risk_level, ip_address, device_id, user_agent,
        source, route, method, status_code, request_id, metadata
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        userId,
        input.eventType,
        input.riskLevel || 'info',
        ipAddress,
        deviceId,
        userAgent,
        source,
        route,
        method,
        input.statusCode ?? null,
        requestId || null,
        JSON.stringify(input.metadata || {}),
      ]
    );
  } catch (error) {
    logger.warn('[Security] Failed to record security event:', (error as Error).message);
  }
}

export function createSecurityMiddleware() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = normalizeHeaderValue(req.headers['x-request-id']) || crypto.randomUUID();
    const verified = getVerifiedPayload(req);
    const context: SecurityContext = {
      requestId,
      ipAddress: getClientIp(req),
      deviceId: getDeviceId(req),
      userAgent: normalizeHeaderValue(req.headers['user-agent']).slice(0, 1000),
      route: req.originalUrl || req.path,
      method: req.method,
      startedAt: nowMs(),
      userId: verified.userId,
      source: verified.source,
    };

    req.securityContext = context;
    res.setHeader('X-Request-Id', requestId);

    for (const { key, rule } of selectRateLimitRules(req, context)) {
      const result = hitRateLimit(key, rule);
      if (result.limited) {
        void recordSecurityEvent({
          req,
          eventType: 'rate_limit.blocked',
          riskLevel: 'high',
          statusCode: 429,
          metadata: {
            rule: rule.name,
            key,
            retry_after_seconds: result.retryAfterSeconds,
          },
        });
        res.status(429).json({
          error: 'Too Many Requests',
          message: 'Rate limit exceeded, please try again later',
          retryAfter: result.retryAfterSeconds,
          request_id: requestId,
        });
        return;
      }
    }

    if (isRiskCheckedPath(req)) {
      try {
        const risk = await evaluateUserDeviceRisk(context);
        if (risk.blocked) {
          void recordSecurityEvent({
            req,
            eventType: 'risk.blocked',
            riskLevel: 'critical',
            statusCode: 403,
            metadata: { reason: risk.reason },
          });
          res.status(403).json({
            error: 'Forbidden',
            message: 'This request triggered account/device risk controls',
            request_id: requestId,
          });
          return;
        }
      } catch (error) {
        logger.warn('[Security] Risk evaluation failed:', (error as Error).message);
      }
    }

    res.on('finish', () => {
      const audit = classifyAuditEvent(req, res.statusCode);
      if (!audit) return;

      const durationMs = nowMs() - context.startedAt;
      void recordSecurityEvent({
        req,
        eventType: audit.eventType,
        riskLevel: audit.riskLevel,
        statusCode: res.statusCode,
        metadata: safeMetadata(req, durationMs),
      });
    });

    next();
  };
}
