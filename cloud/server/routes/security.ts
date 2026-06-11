import { Router, Response } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { getJwtKeyStatus } from '../../auth/jwt';

const router = Router();

let db: DatabaseConnection;

export function initializeSecurityRoutes(database: DatabaseConnection): void {
  db = database;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  const parsed = parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

router.get('/events', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseLimit(req.query.limit, 100, 500);
    const filters: string[] = [];
    const params: unknown[] = [];

    for (const [queryKey, columnName] of [
      ['event_type', 'event_type'],
      ['risk_level', 'risk_level'],
      ['user_id', 'user_id'],
      ['ip_address', 'ip_address'],
      ['device_id', 'device_id'],
    ] as const) {
      const value = req.query[queryKey];
      if (typeof value === 'string' && value.trim()) {
        params.push(value.trim());
        filters.push(`${columnName} = $${params.length}`);
      }
    }

    const sinceHours = parseInt(String(req.query.since_hours || '72'), 10);
    if (Number.isFinite(sinceHours) && sinceHours > 0) {
      params.push(sinceHours);
      filters.push(`created_at >= CURRENT_TIMESTAMP - ($${params.length}::int * INTERVAL '1 hour')`);
    }

    params.push(limit);
    const whereSql = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const events = await db.query(
      `SELECT id, user_id, event_type, risk_level, ip_address, device_id, source,
              route, method, status_code, request_id, metadata, created_at
       FROM security_events
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );

    return res.json({ events });
  } catch (error) {
    logger.error('[Security] List events failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to list security events',
    });
  }
});

router.get('/summary', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sinceHours = parseLimit(req.query.since_hours, 24, 720);
    const [byType, byRisk, recentCritical] = await Promise.all([
      db.query(
        `SELECT event_type, COUNT(*)::int AS count
         FROM security_events
         WHERE created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 hour')
         GROUP BY event_type
         ORDER BY count DESC`,
        [sinceHours]
      ),
      db.query(
        `SELECT risk_level, COUNT(*)::int AS count
         FROM security_events
         WHERE created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 hour')
         GROUP BY risk_level
         ORDER BY count DESC`,
        [sinceHours]
      ),
      db.query(
        `SELECT id, user_id, event_type, risk_level, ip_address, device_id,
                route, status_code, request_id, metadata, created_at
         FROM security_events
         WHERE risk_level IN ('high', 'critical')
           AND created_at >= CURRENT_TIMESTAMP - ($1::int * INTERVAL '1 hour')
         ORDER BY created_at DESC
         LIMIT 50`,
        [sinceHours]
      ),
    ]);

    return res.json({
      since_hours: sinceHours,
      by_type: byType,
      by_risk: byRisk,
      recent_high_risk: recentCritical,
    });
  } catch (error) {
    logger.error('[Security] Summary failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to build security summary',
    });
  }
});

router.get('/jwt-key-status', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    return res.json({
      jwt: getJwtKeyStatus(),
    });
  } catch (error) {
    logger.error('[Security] JWT key status failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get JWT key status',
    });
  }
});

export default router;
