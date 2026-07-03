import { Router, type Request, type Response } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../../utils/logger';
import { sanitizeUserId } from '../../utils/paths';
import {
  researchSessionManager,
  summarizeSession,
  type ResearchSessionSourceSnapshot,
} from '../../research/research-session-manager';
import type { UserMemory } from './memory';

const projectIdSchema = z.string().max(160).optional();

const sourceRefSchema = z.object({
  id: z.string().optional(),
  sourceType: z.enum(['embedding', 'pdf-wiki', 'memory', 'data-file', 'r-code', 'manual', 'autoresearch', 'other']),
  title: z.string().optional(),
  authors: z.string().optional(),
  year: z.union([z.string(), z.number()]).optional(),
  journal: z.string().optional(),
  doi: z.string().optional(),
  path: z.string().optional(),
  location: z.string().optional(),
  query: z.string().optional(),
  score: z.number().optional(),
  supportRelation: z.string().optional(),
  supportConfidence: z.number().optional(),
  evidenceSnippet: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const citationRefSchema = z.object({
  citationText: z.string().min(1),
  referenceId: z.string().optional(),
  title: z.string().optional(),
  doi: z.string().optional(),
  supportRelation: z.string().optional(),
  supportConfidence: z.number().optional(),
  evidenceSnippet: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const dataRefSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  filePath: z.string().optional(),
  sheetName: z.string().optional(),
  columns: z.array(z.string()).optional(),
  rowCount: z.number().optional(),
  statistic: z.string().optional(),
  value: z.union([z.string(), z.number()]).optional(),
  pValue: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const codeRefSchema = z.object({
  language: z.enum(['R', 'Python', 'Shell', 'TypeScript', 'Other']),
  filePath: z.string().optional(),
  contentHash: z.string().optional(),
  command: z.string().optional(),
  packageSnapshot: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const startSessionSchema = z.object({
  userId: z.string().optional(),
  projectId: projectIdSchema,
  title: z.string().max(160).optional(),
  topic: z.string().max(500).optional(),
  goal: z.string().max(2000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const provenanceSchema = z.object({
  userId: z.string().optional(),
  projectId: projectIdSchema,
  sessionId: z.string().optional(),
  sessionTitle: z.string().max(160).optional(),
  sessionTopic: z.string().max(500).optional(),
  targetType: z.enum(['paragraph', 'figure', 'table', 'citation', 'retrieval', 'data-analysis', 'r-code', 'pdf-wiki', 'memory', 'writing', 'review', 'other']),
  targetId: z.string().max(200).optional(),
  operation: z.string().min(1).max(200),
  sourceModule: z.string().min(1).max(160),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  query: z.string().max(4000).optional(),
  model: z.string().max(160).optional(),
  prompt: z.string().max(200000).optional(),
  sources: z.array(sourceRefSchema).max(200).optional(),
  citations: z.array(citationRefSchema).max(200).optional(),
  dataRefs: z.array(dataRefSchema).max(100).optional(),
  codeRefs: z.array(codeRefSchema).max(50).optional(),
  artifactIds: z.array(z.string().max(160)).max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const artifactSchema = z.object({
  userId: z.string().optional(),
  projectId: projectIdSchema,
  sessionId: z.string().optional(),
  sessionTitle: z.string().max(160).optional(),
  sessionTopic: z.string().max(500).optional(),
  kind: z.enum(['writing', 'paragraph', 'figure', 'table', 'retrieval', 'data-analysis', 'r-code', 'pdf-wiki', 'memory', 'review', 'bundle', 'other']),
  name: z.string().min(1).max(240),
  filePath: z.string().max(2000).optional(),
  content: z.string().max(2_000_000).optional(),
  contentType: z.string().max(120).optional(),
  input: z.unknown().optional(),
  provenanceRecordIds: z.array(z.string().max(160)).max(500).optional(),
  reviewerReportIds: z.array(z.string().max(160)).max(200).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const reviewSchema = z.object({
  userId: z.string().optional(),
  projectId: projectIdSchema,
  sessionId: z.string().optional(),
  artifactId: z.string().optional(),
});

const ledgerQuerySchema = z.object({
  userId: z.string().optional(),
  projectId: projectIdSchema,
  write: z.string().optional(),
});

interface ResearchSessionRouterDeps {
  loadUserMemory?: (userId: string) => Promise<UserMemory>;
  getPdfWikiStatus?: (userId: string) => Promise<Record<string, unknown>>;
  readUserLiteratureRecords?: (userId: string) => unknown[];
  getCurrentProject?: () => Record<string, unknown>;
}

export function createResearchSessionRouter(deps: ResearchSessionRouterDeps = {}): Router {
  const router = Router();

  router.post('/start', async (req, res) => {
    try {
      const body = startSessionSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps, body.projectId);
      const sources = await buildSourceSnapshot(userId, deps);
      const session = await researchSessionManager.createSession(userId, {
        projectId,
        title: body.title,
        topic: body.topic,
        goal: body.goal,
        sources,
        metadata: body.metadata,
      });
      res.json({ success: true, session, summary: summarizeSession(session) });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Start error:');
    }
  });

  router.get('/current', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps);
      const session = await researchSessionManager.getActiveSession(userId, projectId);
      res.json({ success: true, session, summary: session ? summarizeSession(session) : null });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Current error:');
    }
  });

  router.get('/list', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps);
      const sessions = await researchSessionManager.listSessions(userId, projectId);
      res.json({ success: true, sessions });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] List error:');
    }
  });

  router.post('/refresh-sources', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps);
      const sessionId = String(req.body?.sessionId || '').trim();
      if (!sessionId) {
        res.status(400).json({ success: false, error: '缺少 sessionId' });
        return;
      }
      const session = await researchSessionManager.updateSources(userId, sessionId, await buildSourceSnapshot(userId, deps), projectId);
      res.json({ success: true, session, summary: summarizeSession(session) });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Refresh sources error:');
    }
  });

  router.post('/provenance', async (req, res) => {
    try {
      const body = provenanceSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps, body.projectId);
      const result = await researchSessionManager.appendProvenance({ ...body, userId, projectId });
      res.json({ success: true, record: result.record, summary: summarizeSession(result.session) });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Provenance error:');
    }
  });

  router.post('/artifact', async (req, res) => {
    try {
      const body = artifactSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps, body.projectId);
      const result = await researchSessionManager.appendArtifact({ ...body, userId, projectId });
      res.json({ success: true, artifact: result.artifact, summary: summarizeSession(result.session) });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Artifact error:');
    }
  });

  router.post('/review', async (req, res) => {
    try {
      const body = reviewSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps, body.projectId);
      const result = await researchSessionManager.runReviewer(userId, body.sessionId, body.artifactId, projectId);
      res.json({ success: true, report: result.report, summary: summarizeSession(result.session) });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Review error:');
    }
  });

  router.get('/evidence-ledger', async (req, res) => {
    try {
      const query = ledgerQuerySchema.parse(req.query || {});
      const userId = sanitizeUserId(query.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps, query.projectId);
      const write = String(query.write || '').toLowerCase() === '1' || String(query.write || '').toLowerCase() === 'true';
      if (write) {
        const result = await researchSessionManager.writeEvidenceLedger(userId, projectId);
        res.json({ success: true, ledger: result.ledger, filePath: result.filePath });
        return;
      }
      const ledger = await researchSessionManager.buildEvidenceLedger(userId, projectId);
      res.json({ success: true, ledger });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Evidence ledger error:');
    }
  });

  router.get('/bundle/:sessionId', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps);
      const write = String(req.query.write || '').toLowerCase() === '1' || String(req.query.write || '').toLowerCase() === 'true';
      if (write) {
        const result = await researchSessionManager.writeBundle(userId, req.params.sessionId, projectId);
        res.json({ success: true, bundle: result.bundle, filePath: result.filePath });
        return;
      }
      const bundle = await researchSessionManager.buildBundle(userId, req.params.sessionId, projectId);
      res.json({ success: true, bundle });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Bundle error:');
    }
  });

  router.get('/:sessionId', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const projectId = resolveProjectIdFromRequest(req, deps);
      const session = await researchSessionManager.getSession(userId, req.params.sessionId, projectId);
      if (!session) {
        res.status(404).json({ success: false, error: '科研 session 不存在' });
        return;
      }
      res.json({ success: true, session, summary: summarizeSession(session) });
    } catch (error) {
      sendResearchSessionError(res, error, '[ResearchSession] Get error:');
    }
  });

  return router;
}

async function buildSourceSnapshot(userId: string, deps: ResearchSessionRouterDeps): Promise<ResearchSessionSourceSnapshot> {
  const snapshot: ResearchSessionSourceSnapshot = {
    metadata: {
      refreshedAt: new Date().toISOString(),
      project: deps.getCurrentProject?.(),
    },
  };

  if (deps.readUserLiteratureRecords) {
    const records = deps.readUserLiteratureRecords(userId);
    snapshot.embeddingLibrary = {
      available: records.length > 0,
      recordCount: records.length,
    };
  }

  if (deps.getPdfWikiStatus) {
    try {
      snapshot.pdfWiki = await deps.getPdfWikiStatus(userId);
    } catch (error) {
      snapshot.pdfWiki = { available: false, error: (error as Error).message };
    }
  }

  if (deps.loadUserMemory) {
    try {
      const memory = await deps.loadUserMemory(userId);
      snapshot.longTermMemory = {
        available: memory.entries.length > 0 || memory.conversations.length > 0,
        entryCount: memory.entries.length,
        conversationCount: memory.conversations.length,
        updatedAt: memory.updatedAt,
      };
    } catch (error) {
      snapshot.longTermMemory = { available: false, error: (error as Error).message };
    }
  }

  return snapshot;
}

function resolveProjectIdFromRequest(req: Request, deps: ResearchSessionRouterDeps, explicit?: unknown): string {
  const fromExplicit = cleanProjectId(explicit);
  if (fromExplicit) return fromExplicit;

  const fromBody = cleanProjectId((req.body as { projectId?: unknown } | undefined)?.projectId);
  if (fromBody) return fromBody;

  const fromQuery = cleanProjectId(req.query.projectId);
  if (fromQuery) return fromQuery;

  const fromHeader = cleanProjectId(req.header('x-project-id'));
  if (fromHeader) return fromHeader;

  const currentProject = deps.getCurrentProject?.();
  const fromCurrentProject = cleanProjectId(currentProject?.projectId);
  return fromCurrentProject || 'current-workspace';
}

function cleanProjectId(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return cleanProjectId(value[0]);
  }
  const cleaned = String(value || '')
    .trim()
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9._@-]/g, '_')
    .slice(0, 160);
  return cleaned || undefined;
}

function sendResearchSessionError(res: Response, error: unknown, logPrefix: string): void {
  logger.error(logPrefix, error);
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: error.errors.map(item => `${item.path.join('.')}: ${item.message}`).join('; '),
    });
    return;
  }
  res.status(500).json({ success: false, error: (error as Error).message || '科研 session 操作失败' });
}

export default createResearchSessionRouter;
