import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../../utils/logger';
import {
  applyDiscussionFrameworkProposal,
  createDiscussionFrameworkProposal,
  dismissDiscussionFrameworkProposal,
  loadDiscussionFrameworkRecord,
  loadLatestDiscussionFrameworkProposal,
  saveDiscussionFrameworkState,
  scanWorkspaceFrameworkStructure,
  type DiscussionFrameworkState,
  type FrameworkProjectTarget,
} from '../services/discussion-framework';
import { normalizeWorkspaceDirectoryInput } from '../services/workspace-directory';

const frameworkStateSchema = z.object({
  chapters: z.array(z.unknown()).max(100),
}).passthrough();

const saveStateSchema = z.object({
  state: frameworkStateSchema,
  userId: z.string().max(160).optional().default('web-user'),
  expectedRevision: z.number().int().nonnegative().optional(),
});

const scanSchema = z.object({
  workspaceDirectory: z.unknown(),
  selectedFile: z.string().max(2000).optional(),
  replaceProposalId: z.string().max(200).optional(),
  state: frameworkStateSchema.optional(),
  userId: z.string().max(160).optional().default('web-user'),
});

const proposalActionSchema = z.object({
  userId: z.string().max(160).optional().default('web-user'),
});

export interface DiscussionFrameworkRouterOptions {
  getCurrentProject: () => FrameworkProjectTarget;
  logger?: typeof logger;
}

export function createDiscussionFrameworkRouter(options: DiscussionFrameworkRouterOptions): Router {
  const router = Router();
  const log = options.logger || logger;

  router.get('/state', async (_req, res) => {
    try {
      const target = options.getCurrentProject();
      const record = await loadDiscussionFrameworkRecord(target);
      res.json({ success: true, projectId: target.projectId, record });
    } catch (error) {
      log.error('[DiscussionFramework] state read failed:', error);
      res.status(500).json({ success: false, code: 'FRAMEWORK_STATE_READ_FAILED', message: (error as Error).message, recoverable: true });
    }
  });

  router.put('/state', async (req, res) => {
    try {
      const body = saveStateSchema.parse(req.body || {});
      const target = options.getCurrentProject();
      const record = await saveDiscussionFrameworkState(target, body.state, body.userId, body.expectedRevision);
      res.json({ success: true, projectId: target.projectId, record });
    } catch (error) {
      const conflict = error as Error & { code?: string; current?: unknown };
      if (conflict.code === 'FRAMEWORK_REVISION_CONFLICT') {
        res.status(409).json({
          success: false,
          code: conflict.code,
          message: conflict.message,
          recoverable: true,
          current: conflict.current,
        });
        return;
      }
      log.error('[DiscussionFramework] state save failed:', error);
      res.status(400).json({ success: false, code: 'FRAMEWORK_STATE_SAVE_FAILED', message: (error as Error).message, recoverable: true });
    }
  });

  router.post('/scan', async (req, res) => {
    try {
      const body = scanSchema.parse(req.body || {});
      const workspaceDirectory = normalizeWorkspaceDirectoryInput(body.workspaceDirectory);
      if (!workspaceDirectory || workspaceDirectory.enabled === false) {
        res.status(400).json({ success: false, code: 'WORKSPACE_REQUIRED', message: '请先在输入框左侧配置并启用工作目录', recoverable: true });
        return;
      }
      const target = options.getCurrentProject();
      const stored = await loadDiscussionFrameworkRecord(target);
      const state = (body.state || stored?.state) as DiscussionFrameworkState | undefined;
      if (!state) {
        res.status(400).json({ success: false, code: 'FRAMEWORK_STATE_REQUIRED', message: '当前项目还没有可比较的论文框架', recoverable: true });
        return;
      }
      const existingPending = await loadLatestDiscussionFrameworkProposal(target);
      if (existingPending && body.replaceProposalId === existingPending.id) {
        await dismissDiscussionFrameworkProposal(target, existingPending.id);
      } else if (existingPending) {
        res.json({
          success: true,
          projectId: target.projectId,
          changed: true,
          pendingExisting: true,
          selected: null,
          candidates: [],
          proposal: existingPending,
        });
        return;
      }
      const scan = await scanWorkspaceFrameworkStructure({ workspaceDirectory, selectedFile: body.selectedFile });
      const currentFingerprint = String(state.structureSource?.fingerprint || '');
      const source = {
        type: 'workspace' as const,
        path: scan.selected.path,
        modifiedAt: scan.selected.modifiedAt,
        fingerprint: scan.selected.fingerprint,
        detectedAt: new Date().toISOString(),
      };
      const proposal = await createDiscussionFrameworkProposal({
        target,
        state,
        chapters: scan.selected.chapters,
        source,
        summary: `从工作目录文件 ${scan.selected.path} 识别到 ${scan.selected.chapterCount} 个章节、${scan.selected.subsectionCount} 个小节`,
      });
      if (!proposal.diff.changed) {
        await dismissDiscussionFrameworkProposal(target, proposal.id);
      }
      res.json({
        success: true,
        projectId: target.projectId,
        changed: proposal.diff.changed,
        fingerprintChanged: currentFingerprint !== scan.selected.fingerprint,
        selected: scan.selected,
        candidates: scan.candidates.map(candidate => ({
          path: candidate.path,
          modifiedAt: candidate.modifiedAt,
          size: candidate.size,
          score: candidate.score,
          chapterCount: candidate.chapterCount,
          subsectionCount: candidate.subsectionCount,
        })),
        proposal: proposal.diff.changed ? proposal : null,
      });
    } catch (error) {
      log.warn('[DiscussionFramework] workspace scan failed:', error);
      res.status(400).json({ success: false, code: 'FRAMEWORK_SCAN_FAILED', message: (error as Error).message, recoverable: true });
    }
  });

  router.get('/proposal', async (_req, res) => {
    try {
      const target = options.getCurrentProject();
      const proposal = await loadLatestDiscussionFrameworkProposal(target);
      res.json({ success: true, projectId: target.projectId, proposal });
    } catch (error) {
      log.error('[DiscussionFramework] proposal read failed:', error);
      res.status(500).json({ success: false, code: 'FRAMEWORK_PROPOSAL_READ_FAILED', message: (error as Error).message, recoverable: true });
    }
  });

  router.post('/proposal/:proposalId/apply', async (req, res) => {
    try {
      const body = proposalActionSchema.parse(req.body || {});
      const target = options.getCurrentProject();
      const result = await applyDiscussionFrameworkProposal(target, req.params.proposalId, body.userId);
      res.json({ success: true, projectId: target.projectId, proposal: result.proposal, record: result.record });
    } catch (error) {
      log.error('[DiscussionFramework] proposal apply failed:', error);
      res.status(400).json({ success: false, code: 'FRAMEWORK_PROPOSAL_APPLY_FAILED', message: (error as Error).message, recoverable: true });
    }
  });

  router.post('/proposal/:proposalId/dismiss', async (req, res) => {
    try {
      proposalActionSchema.parse(req.body || {});
      const target = options.getCurrentProject();
      const proposal = await dismissDiscussionFrameworkProposal(target, req.params.proposalId);
      res.json({ success: true, projectId: target.projectId, proposal });
    } catch (error) {
      log.error('[DiscussionFramework] proposal dismiss failed:', error);
      res.status(400).json({ success: false, code: 'FRAMEWORK_PROPOSAL_DISMISS_FAILED', message: (error as Error).message, recoverable: true });
    }
  });

  return router;
}

export default createDiscussionFrameworkRouter;
