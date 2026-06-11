import { Router, Request, Response, NextFunction } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';

const publicRouter = Router();
const adminRouter = Router();

let db: DatabaseConnection;
let ensureTablePromise: Promise<void> | null = null;

const FEEDBACK_STATUSES = new Set(['open', 'reviewing', 'resolved', 'closed']);
const FEEDBACK_CATEGORIES = new Set(['bug', 'suggestion', 'experience', 'billing', 'other']);
const FEEDBACK_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);

export function initializeFeedbackRoutes(database: DatabaseConnection): void {
  db = database;
  ensureFeedbackTable().catch((error) => {
    logger.error('[Feedback] Failed to initialize feedback table:', error);
  });
}

async function ensureFeedbackTable(): Promise<void> {
  if (ensureTablePromise) return ensureTablePromise;

  ensureTablePromise = (async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_feedback (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        user_email VARCHAR(255),
        user_name VARCHAR(100),
        contact VARCHAR(255),
        category VARCHAR(40) NOT NULL DEFAULT 'suggestion',
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        priority VARCHAR(20) NOT NULL DEFAULT 'normal',
        source VARCHAR(40) NOT NULL DEFAULT 'desktop',
        app_version VARCHAR(80),
        machine_id VARCHAR(120),
        user_agent TEXT,
        client_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        admin_notes TEXT,
        handled_by VARCHAR(80),
        handled_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_email VARCHAR(255)`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_name VARCHAR(100)`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS contact VARCHAR(255)`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'suggestion'`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS title VARCHAR(200) NOT NULL DEFAULT '未命名反馈'`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS content TEXT NOT NULL DEFAULT ''`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'open'`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS priority VARCHAR(20) NOT NULL DEFAULT 'normal'`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS source VARCHAR(40) NOT NULL DEFAULT 'desktop'`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS app_version VARCHAR(80)`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS machine_id VARCHAR(120)`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS user_agent TEXT`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS client_metadata JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS admin_notes TEXT`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS handled_by VARCHAR(80)`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS handled_at TIMESTAMP WITH TIME ZONE`);
    await db.query(`ALTER TABLE user_feedback ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP`);
    await db.query(`UPDATE user_feedback SET status = 'open' WHERE status IS NULL OR status = ''`);
    await db.query(`UPDATE user_feedback SET category = 'suggestion' WHERE category IS NULL OR category = ''`);
    await db.query(`UPDATE user_feedback SET priority = 'normal' WHERE priority IS NULL OR priority = ''`);
    await db.query(`UPDATE user_feedback SET source = 'desktop' WHERE source IS NULL OR source = ''`);
    await db.query(`ALTER TABLE user_feedback ALTER COLUMN status SET DEFAULT 'open'`);
    await db.query(`ALTER TABLE user_feedback ALTER COLUMN category SET DEFAULT 'suggestion'`);
    await db.query(`ALTER TABLE user_feedback ALTER COLUMN priority SET DEFAULT 'normal'`);
    await db.query(`ALTER TABLE user_feedback ALTER COLUMN source SET DEFAULT 'desktop'`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback(status)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at ON user_feedback(created_at DESC)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id ON user_feedback(user_id)`);
  })();

  return ensureTablePromise;
}

function cleanText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, maxLength);
}

function normalizeCategory(value: unknown): string {
  const category = cleanText(value, 40).toLowerCase();
  return FEEDBACK_CATEGORIES.has(category) ? category : 'suggestion';
}

function normalizeStatus(value: unknown): string | null {
  const status = cleanText(value, 20).toLowerCase();
  return FEEDBACK_STATUSES.has(status) ? status : null;
}

function normalizePriority(value: unknown): string {
  const priority = cleanText(value, 20).toLowerCase();
  return FEEDBACK_PRIORITIES.has(priority) ? priority : 'normal';
}

function normalizeUuid(value: unknown): string | null {
  const id = cleanText(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    ? id
    : null;
}

const adminMiddleware = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  try {
    if (req.user?.userId === 'admin') return next();

    const user = await db.queryOne<{ role: string }>(
      'SELECT role FROM users WHERE id = $1',
      [req.user!.userId]
    );

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }

    next();
  } catch (error) {
    logger.error('[Feedback] Admin permission check failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Permission check failed' });
  }
};

publicRouter.post('/', async (req: Request, res: Response) => {
  try {
    await ensureFeedbackTable();

    const content = cleanText(req.body.content, 10000);
    if (!content) {
      return res.status(400).json({ error: 'Bad Request', message: '反馈内容不能为空' });
    }

    const title = cleanText(req.body.title, 200) || content.slice(0, 60) || '用户反馈';
    const category = normalizeCategory(req.body.category);
    const priority = normalizePriority(req.body.priority);
    const metadata = {
      ...(typeof req.body.metadata === 'object' && req.body.metadata ? req.body.metadata : {}),
      rawUserId: cleanText(req.body.userId, 80) || undefined,
    };

    const result = await db.queryOne<{ id: string; created_at: string }>(
      `INSERT INTO user_feedback (
        user_id, user_email, user_name, contact, category, title, content,
        status, priority, source, app_version, machine_id, user_agent, client_metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'open', $8, $9, $10, $11, $12, $13::jsonb)
       RETURNING id, created_at`,
      [
        normalizeUuid(req.body.userId),
        cleanText(req.body.userEmail, 255),
        cleanText(req.body.username, 100),
        cleanText(req.body.contact, 255),
        category,
        title,
        content,
        priority,
        cleanText(req.body.source, 40) || 'desktop',
        cleanText(req.body.appVersion, 80),
        cleanText(req.body.machineId, 120),
        cleanText(req.headers['user-agent'], 500),
        JSON.stringify(metadata),
      ]
    );

    logger.info(`[Feedback] Created feedback ${result?.id || ''} category=${category}`);
    return res.json({
      success: true,
      feedback: {
        id: result?.id,
        status: 'open',
        created_at: result?.created_at,
      },
    });
  } catch (error) {
    logger.error('[Feedback] Create feedback failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: '提交反馈失败' });
  }
});

adminRouter.get('/', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFeedbackTable();

    const status = normalizeStatus(req.query.status);
    const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit || '80'), 10) || 80));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);
    const params: unknown[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE f.status = $${params.length}`;
    }
    params.push(limit, offset);

    const feedback = await db.query(
      `SELECT
        f.id,
        f.user_id AS "userId",
        COALESCE(f.user_email, u.email) AS "userEmail",
        COALESCE(f.user_name, u.username) AS "username",
        f.contact,
        f.category,
        f.title,
        f.content,
        f.status,
        f.priority,
        f.source,
        f.app_version AS "appVersion",
        f.machine_id AS "machineId",
        f.client_metadata AS "metadata",
        f.admin_notes AS "adminNotes",
        f.handled_by AS "handledBy",
        f.handled_at AS "handledAt",
        f.created_at AS "createdAt",
        f.updated_at AS "updatedAt"
       FROM user_feedback f
       LEFT JOIN users u ON f.user_id = u.id
       ${where}
       ORDER BY f.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({ feedback });
  } catch (error) {
    logger.error('[Feedback] List feedback failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to list feedback' });
  }
});

adminRouter.get('/stats', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFeedbackTable();
    const stats = await db.queryOne<{
      total: string;
      open: string;
      reviewing: string;
      resolved: string;
      closed: string;
    }>(
      `SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'reviewing') AS reviewing,
        COUNT(*) FILTER (WHERE status = 'resolved') AS resolved,
        COUNT(*) FILTER (WHERE status = 'closed') AS closed
       FROM user_feedback`
    );

    return res.json({
      stats: {
        total: parseInt(stats?.total || '0', 10),
        open: parseInt(stats?.open || '0', 10),
        reviewing: parseInt(stats?.reviewing || '0', 10),
        resolved: parseInt(stats?.resolved || '0', 10),
        closed: parseInt(stats?.closed || '0', 10),
      },
    });
  } catch (error) {
    logger.error('[Feedback] Feedback stats failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to get feedback stats' });
  }
});

adminRouter.put('/:id', authMiddleware, adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await ensureFeedbackTable();

    const id = normalizeUuid(req.params.id);
    if (!id) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid feedback id' });
    }

    const status = normalizeStatus(req.body.status);
    const priority = normalizePriority(req.body.priority);
    const adminNotes = cleanText(req.body.adminNotes ?? req.body.admin_notes, 5000);
    const shouldMarkHandled = status === 'resolved' || status === 'closed';

    const feedback = await db.queryOne(
      `UPDATE user_feedback
       SET status = COALESCE($2, status),
           priority = $3,
           admin_notes = $4,
           handled_by = CASE WHEN $5 THEN $6 ELSE handled_by END,
           handled_at = CASE WHEN $5 THEN CURRENT_TIMESTAMP ELSE handled_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING *`,
      [id, status, priority, adminNotes, shouldMarkHandled, req.user?.userId || 'admin']
    );

    if (!feedback) {
      return res.status(404).json({ error: 'Not Found', message: 'Feedback not found' });
    }

    return res.json({ success: true, feedback });
  } catch (error) {
    logger.error('[Feedback] Update feedback failed:', error);
    return res.status(500).json({ error: 'Internal Server Error', message: 'Failed to update feedback' });
  }
});

export { publicRouter, adminRouter };
