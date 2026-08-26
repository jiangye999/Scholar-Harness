import { Router, type Request, type Response } from 'express';

import { logger } from '../../utils/logger';
import { sanitizeUserId } from '../../utils/paths';
import {
  DailyPaperManager,
  type DailyPaperFeedbackDecision,
  type DailyPaperLibraryState,
  type DailyPaperLibraryTarget,
  type DailyPaperRecommendation,
  type DailyPaperSettingsInput,
} from '../services/daily-paper-manager';

export interface DailyPaperLibraryActionResult {
  status: DailyPaperLibraryState['status'];
  message: string;
  duplicate?: boolean;
  details?: Record<string, unknown>;
}

export interface DailyPaperProjectExecution<T> {
  value: T;
  projectId: string;
  projectName: string;
}

export interface DailyPapersRouterOptions {
  addToPdfLibrary?: (
    userId: string,
    paper: DailyPaperRecommendation,
  ) => Promise<DailyPaperLibraryActionResult>;
  addToEmbeddingLibrary?: (
    userId: string,
    paper: DailyPaperRecommendation,
  ) => Promise<DailyPaperLibraryActionResult>;
  runInProject?: <T>(
    projectId: string,
    operation: () => Promise<T>,
  ) => Promise<DailyPaperProjectExecution<T>>;
}

function userIdFrom(req: Request): string {
  return sanitizeUserId(req.body?.userId || req.query.userId || 'web-user');
}

function sendError(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    error: { code, message, recoverable: true },
  });
}

function settingsInput(value: unknown): DailyPaperSettingsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const hasSources = !!input.sources && typeof input.sources === 'object' && !Array.isArray(input.sources);
  const sources = hasSources
    ? input.sources as Record<string, unknown>
    : {};
  return {
    ...(input.enabled !== undefined ? { enabled: input.enabled === true } : {}),
    ...(input.researchFields !== undefined ? { researchFields: input.researchFields as string[] } : {}),
    ...(input.negativeKeywords !== undefined ? { negativeKeywords: input.negativeKeywords as string[] } : {}),
    ...(input.arxivCategories !== undefined ? { arxivCategories: input.arxivCategories as string[] } : {}),
    ...(input.expandQueries !== undefined ? { expandQueries: input.expandQueries === true } : {}),
    ...(input.minScore !== undefined ? { minScore: Number(input.minScore) } : {}),
    ...(input.runTime !== undefined ? { runTime: String(input.runTime || '') } : {}),
    ...(hasSources ? {
      sources: Object.fromEntries(
        ['wos', 'hfDaily', 'hfTrending', 'arxiv', 'openAlex', 'europePmc', 'semanticScholar']
          .filter(key => sources[key] !== undefined)
          .map(key => [key, sources[key] === true]),
      ) as DailyPaperSettingsInput['sources'],
    } : {}),
  };
}

export function createDailyPapersRouter(
  manager: DailyPaperManager,
  options: DailyPapersRouterOptions = {},
): Router {
  const router = Router();

  router.get('/config', async (req, res) => {
    try {
      res.json({ success: true, config: await manager.getSettings(userIdFrom(req)) });
    } catch (error) {
      sendError(res, 500, 'DAILY_PAPER_CONFIG_READ_FAILED', (error as Error).message);
    }
  });

  router.put('/config', async (req, res) => {
    try {
      const userId = userIdFrom(req);
      const config = await manager.saveSettings(userId, settingsInput(req.body?.config || req.body));
      res.json({ success: true, config });
      if (config.enabled && config.researchFields.length) {
        void manager.runIfDue(userId, { trigger: 'enabled', ignoreTime: true }).catch(error => {
          logger.warn('[DailyPapers] Enable-triggered run failed:', (error as Error).message);
        });
      }
    } catch (error) {
      sendError(res, 400, 'DAILY_PAPER_CONFIG_SAVE_FAILED', (error as Error).message);
    }
  });

  router.get('/status', async (req, res) => {
    try {
      const userId = userIdFrom(req);
      const [config, latest, status] = await Promise.all([
        manager.getSettings(userId),
        manager.getLatestRun(userId),
        manager.getStatusSnapshot(userId),
      ]);
      res.json({ success: true, status, config, latest });
    } catch (error) {
      sendError(res, 500, 'DAILY_PAPER_STATUS_FAILED', (error as Error).message);
    }
  });

  router.get('/runs', async (req, res) => {
    try {
      res.json({
        success: true,
        runs: await manager.listRuns(userIdFrom(req), Number(req.query.limit || 30)),
      });
    } catch (error) {
      sendError(res, 500, 'DAILY_PAPER_RUNS_READ_FAILED', (error as Error).message);
    }
  });

  router.get('/runs/:date', async (req, res) => {
    try {
      const run = await manager.getRun(userIdFrom(req), String(req.params.date || ''));
      if (!run) {
        sendError(res, 404, 'DAILY_PAPER_RUN_NOT_FOUND', '没有找到这一天的论文推荐。');
        return;
      }
      res.json({ success: true, run });
    } catch (error) {
      sendError(res, 500, 'DAILY_PAPER_RUN_READ_FAILED', (error as Error).message);
    }
  });

  router.post('/run', async (req, res) => {
    const userId = userIdFrom(req);
    if (manager.getStatus(userId).running) {
      res.status(202).json({ success: true, accepted: true, status: manager.getStatus(userId) });
      return;
    }
    res.status(202).json({ success: true, accepted: true });
    void manager.run(userId, {
      trigger: 'manual',
      days: Number(req.body?.days || 1),
      force: req.body?.force === true,
    }).catch(error => {
      logger.warn('[DailyPapers] Manual run failed:', (error as Error).message);
    });
  });

  router.post('/feedback', async (req, res) => {
    try {
      const paperId = String(req.body?.paperId || '').trim();
      const decision = String(req.body?.decision || '') as DailyPaperFeedbackDecision;
      if (!paperId || !['interested', 'not_relevant'].includes(decision)) {
        sendError(res, 400, 'DAILY_PAPER_FEEDBACK_INVALID', '请选择有效的论文和反馈类型。');
        return;
      }
      const feedback = await manager.saveFeedback(userIdFrom(req), paperId, decision);
      res.json({ success: true, feedback });
    } catch (error) {
      sendError(res, 400, 'DAILY_PAPER_FEEDBACK_SAVE_FAILED', (error as Error).message);
    }
  });

  router.post('/library', async (req, res) => {
    const target = String(req.body?.target || '') as DailyPaperLibraryTarget;
    const paperId = String(req.body?.paperId || '').trim();
    const projectId = String(req.body?.projectId || '').trim();
    if (!paperId || !['pdf', 'embedding'].includes(target)) {
      sendError(res, 400, 'DAILY_PAPER_LIBRARY_INVALID', '请选择有效的论文和文献库。');
      return;
    }
    if (!projectId) {
      sendError(res, 400, 'DAILY_PAPER_PROJECT_REQUIRED', '请先选择要入库的现有项目。');
      return;
    }
    const handler = target === 'pdf' ? options.addToPdfLibrary : options.addToEmbeddingLibrary;
    if (!handler || !options.runInProject) {
      sendError(res, 503, 'DAILY_PAPER_LIBRARY_UNAVAILABLE', '当前版本未启用该文献库入库能力。');
      return;
    }
    try {
      const userId = userIdFrom(req);
      const paper = await manager.getRecommendation(userId, paperId);
      if (!paper) {
        sendError(res, 404, 'DAILY_PAPER_NOT_FOUND', '没有在每日论文历史中找到该论文。');
        return;
      }
      const execution = await options.runInProject(projectId, () => handler(userId, paper));
      const result = execution.value;
      const libraryState = await manager.saveLibraryState(userId, paperId, target, {
        status: result.status,
        message: result.message,
        projectId: execution.projectId,
        projectName: execution.projectName,
        ...(result.duplicate !== undefined ? { duplicate: result.duplicate } : {}),
      });
      res.json({
        success: true,
        target,
        project: { projectId: execution.projectId, name: execution.projectName },
        libraryState,
        details: result.details || {},
      });
    } catch (error) {
      logger.warn(`[DailyPapers] Failed to add paper to ${target} library:`, (error as Error).message);
      sendError(
        res,
        400,
        target === 'pdf' ? 'DAILY_PAPER_PDF_IMPORT_FAILED' : 'DAILY_PAPER_EMBEDDING_IMPORT_FAILED',
        (error as Error).message,
      );
    }
  });

  return router;
}
