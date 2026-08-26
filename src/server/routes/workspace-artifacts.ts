/**
 * Workspace artifact layout API.
 *
 *   POST /api/workspace-artifacts/organize
 *     Move/copy loose figure/table assets into figures_tables/figureN|tableN/
 *     canonical sub-folders, move Word drafts into drafts/, and optionally
 *     regenerate the integrated Word document.
 *
 *   GET  /api/workspace-artifacts/layout
 *     Return the canonical artifact layout of the current conversation AI work
 *     root (drafts/, figures_tables/, figureN/tableN entries).
 *
 *   POST /api/workspace-artifacts/build-integrated-docx
 *     Regenerate figures_tables.docx from the project-cumulative canonical layout.
 *
 * All endpoints resolve the AI work root through the existing workspace
 * directory authorization (prepareWorkspaceOutputDirectory), so they inherit
 * the same path/permission rules as the native workspace tools.
 */

import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../../utils/logger';
import { prepareWorkspaceOutputDirectory } from '../services/workspace-directory';
import {
  buildIntegratedDocx,
  importSourceWorkspaceAssets,
  listArtifactLayout,
  organizeFigureTableAssets,
} from '../services/workspace-artifact-layout';

const workspaceInputSchema = z.object({
  workspaceRoot: z.string().min(1).max(2000),
  permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional().default('workspace-write'),
  conversationId: z.string().max(160).optional(),
  aiWorkRoot: z.string().max(2000).optional(),
  enabled: z.boolean().optional().default(true),
});

const organizeSchema = workspaceInputSchema.extend({
  mode: z.enum(['move', 'copy', 'dry-run']).optional().default('move'),
  buildDocx: z.boolean().optional().default(true),
  captions: z.record(z.object({
    caption: z.string().max(2000).optional(),
    note: z.string().max(4000).optional(),
  })).optional().default({}),
});

const captionsSchema = z.record(z.object({
  caption: z.string().max(2000).optional(),
  note: z.string().max(4000).optional(),
})).optional().default({});

const importSchema = workspaceInputSchema.extend({
  mode: z.enum(['copy', 'dry-run']).optional().default('copy'),
  buildDocx: z.boolean().optional().default(true),
  captions: captionsSchema,
});

export interface WorkspaceArtifactsRouterOptions {
  logger?: typeof logger;
}

export function createWorkspaceArtifactsRouter(options: WorkspaceArtifactsRouterOptions = {}): Router {
  const router = Router();
  const log = options.logger || logger;

  async function resolveAiWorkRoot(body: z.infer<typeof workspaceInputSchema>): Promise<string> {
    const prepared = await prepareWorkspaceOutputDirectory(
      {
        path: body.workspaceRoot,
        permission: body.permission,
        conversationId: body.conversationId,
        aiWorkRoot: body.aiWorkRoot,
        safeWorkRoot: body.aiWorkRoot,
        enabled: body.enabled,
      },
      []
    );
    if (!prepared) {
      throw new Error('工作目录未启用或无法解析 AI 工作文件夹');
    }
    return prepared.aiWorkRoot;
  }

  router.post('/organize', async (req, res) => {
    try {
      const body = organizeSchema.parse(req.body || {});
      const aiWorkRoot = await resolveAiWorkRoot(body);
      const result = await organizeFigureTableAssets(aiWorkRoot, { mode: body.mode });

      let docx: Awaited<ReturnType<typeof buildIntegratedDocx>> | null = null;
      if (body.buildDocx) {
        docx = await buildIntegratedDocx(aiWorkRoot, body.captions);
      }

      res.json({
        success: true,
        aiWorkRoot,
        mode: body.mode,
        result,
        docx,
      });
    } catch (error) {
      log.error('[WorkspaceArtifacts] organize failed:', error);
      res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  router.post('/import', async (req, res) => {
    try {
      const body = importSchema.parse(req.body || {});
      const prepared = await prepareWorkspaceOutputDirectory(
        {
          path: body.workspaceRoot,
          permission: body.permission,
          conversationId: body.conversationId,
          aiWorkRoot: body.aiWorkRoot,
          safeWorkRoot: body.aiWorkRoot,
          enabled: body.enabled,
        },
        []
      );
      if (!prepared) {
        res.status(400).json({ success: false, error: '工作目录未启用或无法解析 AI 工作文件夹' });
        return;
      }

      // Source review + copy-only import: user files are never modified.
      const importResult = await importSourceWorkspaceAssets(prepared.workspaceRoot, prepared.aiWorkRoot, {
        mode: body.mode,
      });

      let docx: Awaited<ReturnType<typeof buildIntegratedDocx>> | null = null;
      if (body.buildDocx) {
        docx = await buildIntegratedDocx(prepared.aiWorkRoot, body.captions);
      }

      res.json({
        success: true,
        sourceRoot: prepared.workspaceRoot,
        aiWorkRoot: prepared.aiWorkRoot,
        mode: body.mode,
        result: importResult,
        docx,
      });
    } catch (error) {
      log.error('[WorkspaceArtifacts] import failed:', error);
      res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  router.get('/layout', async (req, res) => {
    try {
      const body = workspaceInputSchema.parse({
        workspaceRoot: String(req.query.workspaceRoot || ''),
        permission: String(req.query.permission || 'workspace-write'),
        conversationId: String(req.query.conversationId || ''),
        aiWorkRoot: String(req.query.aiWorkRoot || ''),
        enabled: req.query.enabled !== 'false',
      });
      const aiWorkRoot = await resolveAiWorkRoot(body);
      const layout = await listArtifactLayout(aiWorkRoot);
      res.json({ success: true, aiWorkRoot, layout });
    } catch (error) {
      log.error('[WorkspaceArtifacts] layout failed:', error);
      res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  router.post('/build-integrated-docx', async (req, res) => {
    try {
      const body = workspaceInputSchema.extend({ captions: captionsSchema }).parse(req.body || {});
      const aiWorkRoot = await resolveAiWorkRoot(body);
      const docx = await buildIntegratedDocx(aiWorkRoot, body.captions);
      res.json({ success: true, aiWorkRoot, docx });
    } catch (error) {
      log.error('[WorkspaceArtifacts] build-integrated-docx failed:', error);
      res.status(400).json({ success: false, error: (error as Error).message });
    }
  });

  return router;
}
