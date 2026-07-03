import { Router, type Response } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../../utils/logger';
import { sanitizeUserId } from '../../utils/paths';
import {
  AUTO_RESEARCH_STAGE_IDS,
  AutoResearchManager,
  type AutoResearchActor,
  type AutoResearchFinalReport,
  type AutoResearchMemoryKind,
  type AutoResearchOperationStatus,
  type AutoResearchPaperDraft,
  type AutoResearchProjectContext,
  type AutoResearchStageStatus,
  type AutoResearchState,
} from '../../utils/autoresearch-manager';
import type { LiteratureRecord, OuterTagsConfig } from '../../literature/keyword-library';
import type { PdfWikiManager } from '../../utils/pdf-wiki-manager';
import type { ProjectManager } from '../../utils/project-manager';
import {
  expandCitations,
  verifyDois,
  type CitationExpansionResult,
  type DoiVerificationResult,
} from '../../research/literature-review-tools';

const stageIdSchema = z.enum(AUTO_RESEARCH_STAGE_IDS);
const stageStatusSchema = z.enum(['pending', 'active', 'done', 'blocked']);
const actorSchema = z.enum(['user', 'primary', 'secondary', 'codex', 'system']);
const operationStatusSchema = z.enum(['started', 'completed', 'failed']);
const memoryKindSchema = z.enum(['finding', 'hypothesis', 'failure', 'decision', 'method', 'constraint', 'evidence', 'todo']);

const startTaskSchema = z.object({
  userId: z.string().optional(),
  title: z.string().max(160).optional(),
  topic: z.string().max(500).optional(),
  goal: z.string().max(1000).optional(),
  clientRunId: z.string().max(120).optional(),
});

const runAutoResearchSchema = z.object({
  userId: z.string().optional(),
  title: z.string().max(160).optional(),
  topic: z.string().min(1).max(500),
  goal: z.string().max(1000).optional(),
  clientRunId: z.string().max(120).optional(),
});

const updateStageSchema = z.object({
  userId: z.string().optional(),
  stageId: stageIdSchema,
  status: stageStatusSchema.optional(),
  note: z.string().max(2000).optional(),
  artifact: z.string().max(1000).optional(),
  clientRunId: z.string().max(120).optional(),
});

const upsertMemorySchema = z.object({
  userId: z.string().optional(),
  kind: memoryKindSchema,
  content: z.string().min(1).max(4000),
  source: z.string().max(200).optional(),
  tags: z.array(z.string().max(80)).max(20).optional(),
  evidenceObjectIds: z.array(z.string().max(120)).max(50).optional(),
  operationIds: z.array(z.string().max(120)).max(50).optional(),
  confidence: z.number().min(0).max(1).optional(),
  clientRunId: z.string().max(120).optional(),
});

const recordOperationSchema = z.object({
  userId: z.string().optional(),
  kind: z.string().min(1).max(160),
  stageId: stageIdSchema.optional(),
  actor: actorSchema.optional(),
  status: operationStatusSchema.optional(),
  input: z.record(z.unknown()).optional(),
  output: z.record(z.unknown()).optional(),
  toolResults: z.array(z.record(z.unknown())).optional(),
  model: z.string().max(160).optional(),
  error: z.string().max(2000).optional(),
  clientRunId: z.string().max(120).optional(),
});

const updateFinalReportMarkdownSchema = z.object({
  userId: z.string().optional(),
  markdown: z.string().min(1).max(200000),
});

const updatePaperDraftMarkdownSchema = z.object({
  userId: z.string().optional(),
  markdown: z.string().min(1).max(400000),
});

const deleteCompletedTaskRecordsSchema = z.object({
  userId: z.string().optional(),
  recordIds: z.array(z.string().min(1).max(160)).min(1).max(100),
});

interface AutoResearchProgressEvent {
  id: string;
  runId: string;
  userId: string;
  action: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
}

interface AutoResearchProgressState {
  runId: string;
  userId: string;
  action: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  updatedAt: string;
  events: AutoResearchProgressEvent[];
}

const autoResearchProgressByUser = new Map<string, AutoResearchProgressState>();

interface AutoResearchRouterDependencies {
  manager: AutoResearchManager;
  pdfWikiManager: PdfWikiManager;
  projectManager: ProjectManager;
  readUserLiteratureRecords?: (userId: string) => LiteratureRecord[];
  loadOuterTagsConfigForUser?: (userId: string) => OuterTagsConfig;
  saveOuterTagsConfigForUser?: (userId: string, config: OuterTagsConfig) => OuterTagsConfig;
  refreshOuterTagCounts?: (papers: LiteratureRecord[], config: OuterTagsConfig) => OuterTagsConfig;
  consumeCloudQuota?: (usageType: string, amount: number, metadata?: Record<string, unknown>) => Promise<void>;
}

export function createAutoResearchRouter(deps: AutoResearchRouterDependencies): Router {
  const router = Router();

  router.get('/state', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const state = await deps.manager.getState(userId, resolveProjectContext(deps.projectManager));
      res.json({ success: true, state });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] State route error:');
    }
  });

  router.get('/writing-context', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const state = await deps.manager.getState(userId, resolveProjectContext(deps.projectManager));
      const context = buildAutoResearchWritingContext(state);
      res.json({ success: true, available: context.available, context });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Writing context route error:');
    }
  });

  router.get('/progress', (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const runId = typeof req.query.runId === 'string' ? req.query.runId : '';
      const progress = autoResearchProgressByUser.get(userId);
      if (runId && progress && progress.runId !== runId) {
        res.json({ success: true, progress: null });
        return;
      }
      res.json({ success: true, progress: progress || null });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Progress route error:');
    }
  });

  router.post('/start', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = startTaskSchema.parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'start');
      pushAutoResearchProgress(userId, runId, 'start', 'running', 8, '收到启动任务请求');
      pushAutoResearchProgress(userId, runId, 'start', 'running', 34, '正在写入长期任务与阶段状态');
      const state = await deps.manager.startTask(userId, {
        title: body.title,
        topic: body.topic,
        goal: body.goal,
        project: resolveProjectContext(deps.projectManager),
      });
      pushAutoResearchProgress(userId, runId, 'start', 'completed', 100, 'AutoResearch 任务已启动');
      res.json({ success: true, state });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'start', 'failed', 100, `启动失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Start route error:');
    }
  });

  router.post('/run', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = runAutoResearchSchema.parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'run_full');
      const project = resolveProjectContext(deps.projectManager);
      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 4, '收到 AutoResearch 自动运行请求');
      await deps.consumeCloudQuota?.('autoresearch_orchestration', 3000, { runId, route: 'autoresearch.run' });

      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 10, '阶段1：初始化长期研究任务');
      await deps.manager.startTask(userId, {
        title: body.title || 'AutoResearch 自动研究',
        topic: body.topic,
        goal: body.goal || '自动完成文献图谱、证据库、假设、实验计划、草稿框架和审稿式自检',
        project,
      });

      let literatureSnapshotId = '';
      if (deps.readUserLiteratureRecords) {
        pushAutoResearchProgress(userId, runId, 'run_full', 'running', 22, '阶段2：读取 embedding 文献库并构建文献图谱');
        const papers = deps.readUserLiteratureRecords(userId).filter(paper => !(paper as { isPdf?: unknown }).isPdf);
        const rawOuterTags = deps.loadOuterTagsConfigForUser
          ? deps.loadOuterTagsConfigForUser(userId)
          : { mergedTags: [], promotedTags: [] };
        const outerTags = deps.refreshOuterTagCounts
          ? deps.refreshOuterTagCounts(papers, rawOuterTags)
          : rawOuterTags;
        if (deps.saveOuterTagsConfigForUser) deps.saveOuterTagsConfigForUser(userId, outerTags);
        const literatureResult = await deps.manager.syncEmbeddingLibrary(userId, papers, outerTags, project);
        literatureSnapshotId = literatureResult.snapshot.id;
        const citationGraphTrace = await buildAutoResearchCitationGraphTrace(papers);
        if (citationGraphTrace.dois.length > 0) {
          await deps.manager.recordOperation(userId, {
            kind: 'literature-review.citation-graph-expansion',
            stageId: 'literature_map',
            actor: 'system',
            status: 'completed',
            input: {
              literatureSnapshotId,
              doiCount: citationGraphTrace.dois.length,
              dois: citationGraphTrace.dois,
            },
            output: {
              doiVerification: citationGraphTrace.doiVerification,
              citationExpansion: citationGraphTrace.citationExpansion,
            },
            toolResults: citationGraphTrace.citationExpansion.map(item => ({
              doi: item.doi,
              referenceCount: item.references.length,
              citedByCount: item.citedBy.length,
            })),
            project,
          });
        }
        pushAutoResearchProgress(userId, runId, 'run_full', 'running', 42, `文献图谱完成：${literatureResult.snapshot.literatureCount} 篇文献，${literatureResult.snapshot.embeddingCount} 篇带向量`);
      } else {
        pushAutoResearchProgress(userId, runId, 'run_full', 'running', 42, '跳过文献图谱：当前服务未配置 embedding 文献库读取器');
      }

      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 52, '阶段3：读取 PDF Wiki 并构建可追溯证据库');
      const store = await deps.pdfWikiManager.getStore(userId);
      const evidenceResult = await deps.manager.syncPdfWikiStore(userId, store, project);
      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 66, describePdfWikiEvidenceReadiness(store, evidenceResult.snapshot.evidenceObjectCount));

      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 72, '阶段4：重建研究 Wiki 与证据关系图谱');
      const wikiResult = await deps.manager.rebuildResearchWiki(userId, project);
      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 78, `研究 Wiki 完成：${wikiResult.wiki.nodes.length} 个节点，${wikiResult.wiki.edges.length} 条关系`);

      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 84, '阶段5：运行审稿式自检');
      const evaluationResult = await deps.manager.evaluate(userId, project);
      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 90, `自检完成：总分 ${Math.round(evaluationResult.report.overallScore * 100)}`);

      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 94, '阶段6：运行引用与论据审计');
      const auditResult = await deps.manager.runAudit(userId, project);
      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 97, `审计完成：${auditResult.report.verdict.toUpperCase()}，${Math.round(auditResult.report.overallScore * 100)} 分`);

      pushAutoResearchProgress(userId, runId, 'run_full', 'running', 98, '阶段7：生成最终 AutoResearch 结果');
      const finalResult = await deps.manager.generateFinalReport(userId, project);
      pushAutoResearchProgress(userId, runId, 'run_full', 'completed', 100, `AutoResearch 完成：已生成结果报告 ${finalResult.report.id}`);
      res.json({
        success: true,
        state: finalResult.state,
        report: finalResult.report,
        evaluation: evaluationResult.report,
        audit: auditResult.report,
        researchWiki: wikiResult.wiki,
        snapshots: {
          literature: literatureSnapshotId,
          evidence: evidenceResult.snapshot.id,
        },
      });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'run_full', 'failed', 100, `AutoResearch 自动运行失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Full run route error:');
    }
  });

  router.post('/stages', async (req, res) => {
    try {
      const body = updateStageSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const state = await deps.manager.updateStage(userId, {
        stageId: body.stageId,
        status: body.status as AutoResearchStageStatus | undefined,
        note: body.note,
        artifact: body.artifact,
        project: resolveProjectContext(deps.projectManager),
      });
      res.json({ success: true, state });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Stage route error:');
    }
  });

  router.post('/memory', async (req, res) => {
    try {
      const body = upsertMemorySchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const state = await deps.manager.upsertMemoryItem(userId, {
        kind: body.kind as AutoResearchMemoryKind,
        content: body.content,
        source: body.source,
        tags: body.tags,
        evidenceObjectIds: body.evidenceObjectIds,
        operationIds: body.operationIds,
        confidence: body.confidence,
        project: resolveProjectContext(deps.projectManager),
      });
      res.json({ success: true, state });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Memory route error:');
    }
  });

  router.post('/completed-task-records/delete', async (req, res) => {
    try {
      const body = deleteCompletedTaskRecordsSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const result = await deps.manager.deleteCompletedTaskRecords(userId, {
        recordIds: body.recordIds,
        project: resolveProjectContext(deps.projectManager),
      });
      res.json({
        success: true,
        state: result.state,
        deletedCount: result.deletedCount,
        deletedRecordIds: result.deletedRecordIds,
      });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Completed task records delete route error:');
    }
  });

  router.post('/sync-pdf-wiki', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = z.object({ userId: z.string().optional(), clientRunId: z.string().max(120).optional() }).parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'sync_pdf_wiki');
      pushAutoResearchProgress(userId, runId, 'sync_pdf_wiki', 'running', 10, '开始读取 PDF Wiki 论点库');
      const store = await deps.pdfWikiManager.getStore(userId);
      pushAutoResearchProgress(userId, runId, 'sync_pdf_wiki', 'running', 46, describePdfWikiEvidenceReadiness(store));
      const result = await deps.manager.syncPdfWikiStore(userId, store, resolveProjectContext(deps.projectManager));
      pushAutoResearchProgress(userId, runId, 'sync_pdf_wiki', 'completed', 100, describePdfWikiEvidenceReadiness(store, result.snapshot.evidenceObjectCount));
      res.json({ success: true, state: result.state, snapshot: result.snapshot });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'sync_pdf_wiki', 'failed', 100, `同步证据失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] PDF Wiki sync route error:');
    }
  });

  router.post('/sync-embedding-library', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      if (!deps.readUserLiteratureRecords) {
        throw new Error('当前服务未配置 embedding 文献库读取器');
      }
      const body = z.object({ userId: z.string().optional(), clientRunId: z.string().max(120).optional() }).parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'sync_embedding_library');
      pushAutoResearchProgress(userId, runId, 'sync_embedding_library', 'running', 10, '开始读取 embedding 文献库');
      const papers = deps.readUserLiteratureRecords(userId).filter(paper => !(paper as { isPdf?: unknown }).isPdf);
      pushAutoResearchProgress(userId, runId, 'sync_embedding_library', 'running', 38, `已读取 ${papers.length} 篇文献，正在刷新外层标签`);
      const rawOuterTags = deps.loadOuterTagsConfigForUser
        ? deps.loadOuterTagsConfigForUser(userId)
        : { mergedTags: [], promotedTags: [] };
      const outerTags = deps.refreshOuterTagCounts
        ? deps.refreshOuterTagCounts(papers, rawOuterTags)
        : rawOuterTags;
      pushAutoResearchProgress(userId, runId, 'sync_embedding_library', 'running', 66, `正在写入文献图谱：${papers.length} 篇文献，${outerTags.mergedTags.length} 个合并标签`);
      if (deps.saveOuterTagsConfigForUser) {
        deps.saveOuterTagsConfigForUser(userId, outerTags);
      }
      const result = await deps.manager.syncEmbeddingLibrary(userId, papers, outerTags, resolveProjectContext(deps.projectManager));
      pushAutoResearchProgress(userId, runId, 'sync_embedding_library', 'completed', 100, `文献图谱同步完成：${result.snapshot.literatureCount} 个节点，${result.snapshot.embeddingCount} 个向量节点`);
      res.json({ success: true, state: result.state, snapshot: result.snapshot });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'sync_embedding_library', 'failed', 100, `同步文献库失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Embedding library sync route error:');
    }
  });

  router.post('/evaluate', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = z.object({ userId: z.string().optional(), clientRunId: z.string().max(120).optional() }).parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'evaluate');
      pushAutoResearchProgress(userId, runId, 'evaluate', 'running', 12, '开始审稿式自检');
      pushAutoResearchProgress(userId, runId, 'evaluate', 'running', 48, '正在检查引用对齐、证据充分性、创新性与可复现性');
      const result = await deps.manager.evaluate(userId, resolveProjectContext(deps.projectManager));
      pushAutoResearchProgress(userId, runId, 'evaluate', 'completed', 100, `自检完成：总分 ${Math.round(result.report.overallScore * 100)}`);
      res.json({ success: true, state: result.state, report: result.report });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'evaluate', 'failed', 100, `自检失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Evaluate route error:');
    }
  });

  router.post('/research-wiki/rebuild', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = z.object({ userId: z.string().optional(), clientRunId: z.string().max(120).optional() }).parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'research_wiki');
      pushAutoResearchProgress(userId, runId, 'research_wiki', 'running', 12, '开始重建研究 Wiki');
      pushAutoResearchProgress(userId, runId, 'research_wiki', 'running', 44, '正在连接文献、论点、证据和知识缺口');
      const result = await deps.manager.rebuildResearchWiki(userId, resolveProjectContext(deps.projectManager));
      pushAutoResearchProgress(userId, runId, 'research_wiki', 'completed', 100, `研究 Wiki 已重建：${result.wiki.nodes.length} 个节点，${result.wiki.edges.length} 条关系`);
      res.json({ success: true, state: result.state, researchWiki: result.wiki });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'research_wiki', 'failed', 100, `研究 Wiki 重建失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Research Wiki route error:');
    }
  });

  router.post('/audit', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = z.object({ userId: z.string().optional(), clientRunId: z.string().max(120).optional() }).parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'audit');
      pushAutoResearchProgress(userId, runId, 'audit', 'running', 12, '开始引用与论据审计');
      pushAutoResearchProgress(userId, runId, 'audit', 'running', 46, '正在检查引用覆盖、证据强度、反证材料和可回放记录');
      const result = await deps.manager.runAudit(userId, resolveProjectContext(deps.projectManager));
      pushAutoResearchProgress(userId, runId, 'audit', 'completed', 100, `审计完成：${result.report.verdict.toUpperCase()}，${Math.round(result.report.overallScore * 100)} 分`);
      res.json({ success: true, state: result.state, report: result.report });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'audit', 'failed', 100, `引用与论据审计失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Audit route error:');
    }
  });

  router.get('/final-reports/:reportId/markdown', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const state = await deps.manager.getState(userId, resolveProjectContext(deps.projectManager));
      const report = findFinalReportOrThrow(state.finalReports || [], req.params.reportId);
      const markdown = report.editedMarkdown || formatFinalReportMarkdown(report);
      res.json({ success: true, reportId: report.id, markdown, editedAt: report.editedAt || null });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Final report markdown route error:');
    }
  });

  router.put('/final-reports/:reportId/markdown', async (req, res) => {
    try {
      const body = updateFinalReportMarkdownSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const result = await deps.manager.updateFinalReportMarkdown(userId, {
        reportId: req.params.reportId,
        markdown: body.markdown,
        project: resolveProjectContext(deps.projectManager),
      });
      res.json({ success: true, state: result.state, report: result.report });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Final report markdown update route error:');
    }
  });

  router.get('/final-reports/:reportId/download', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const state = await deps.manager.getState(userId, resolveProjectContext(deps.projectManager));
      const report = findFinalReportOrThrow(state.finalReports || [], req.params.reportId);
      const markdown = report.editedMarkdown || formatFinalReportMarkdown(report);
      const filename = `${sanitizeDownloadFilename(report.title || 'AutoResearch报告')}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(markdown);
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Final report download route error:');
    }
  });

  router.post('/final-reports/:reportId/write-paper', async (req, res) => {
    let userId = 'web-user';
    let runId = '';
    try {
      const body = z.object({ userId: z.string().optional(), clientRunId: z.string().max(120).optional() }).parse(req.body || {});
      userId = sanitizeUserId(body.userId || 'web-user');
      runId = resolveClientRunId(body.clientRunId, 'write_paper');
      pushAutoResearchProgress(userId, runId, 'write_paper', 'running', 10, '收到一键写论文请求');
      await deps.consumeCloudQuota?.('autoresearch_write_paper_orchestration', 2000, { runId, route: 'autoresearch.write_paper', reportId: req.params.reportId });
      pushAutoResearchProgress(userId, runId, 'write_paper', 'running', 36, '正在读取 AutoResearch 报告、证据综合和文献图谱');
      const result = await deps.manager.generatePaperDraft(userId, {
        reportId: req.params.reportId,
        project: resolveProjectContext(deps.projectManager),
      });
      pushAutoResearchProgress(userId, runId, 'write_paper', 'completed', 100, `论文草稿已生成：约 ${result.draft.wordCountEstimate} 字，参考文献 ${result.draft.referenceCount} 条`);
      res.json({ success: true, state: result.state, draft: result.draft });
    } catch (error) {
      if (runId) pushAutoResearchProgress(userId, runId, 'write_paper', 'failed', 100, `一键写论文失败：${(error as Error).message || '未知错误'}`);
      sendAutoResearchError(res, error, '[AutoResearch] Write paper route error:');
    }
  });

  router.get('/paper-drafts/:draftId/markdown', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const state = await deps.manager.getState(userId, resolveProjectContext(deps.projectManager));
      const draft = findPaperDraftOrThrow(state.paperDrafts || [], req.params.draftId);
      res.json({ success: true, draftId: draft.id, markdown: draft.editedMarkdown || draft.markdown, editedAt: draft.editedAt || null });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Paper draft markdown route error:');
    }
  });

  router.put('/paper-drafts/:draftId/markdown', async (req, res) => {
    try {
      const body = updatePaperDraftMarkdownSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const result = await deps.manager.updatePaperDraftMarkdown(userId, {
        draftId: req.params.draftId,
        markdown: body.markdown,
        project: resolveProjectContext(deps.projectManager),
      });
      res.json({ success: true, state: result.state, draft: result.draft });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Paper draft markdown update route error:');
    }
  });

  router.get('/paper-drafts/:draftId/download', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const state = await deps.manager.getState(userId, resolveProjectContext(deps.projectManager));
      const draft = findPaperDraftOrThrow(state.paperDrafts || [], req.params.draftId);
      const markdown = draft.editedMarkdown || draft.markdown;
      const filename = `${sanitizeDownloadFilename(draft.title || 'AutoResearch论文草稿')}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(markdown);
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Paper draft download route error:');
    }
  });

  router.post('/operations', async (req, res) => {
    try {
      const body = recordOperationSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const state = await deps.manager.recordOperation(userId, {
        kind: body.kind,
        stageId: body.stageId,
        actor: body.actor as AutoResearchActor | undefined,
        status: body.status as AutoResearchOperationStatus | undefined,
        input: body.input,
        output: body.output,
        toolResults: body.toolResults,
        model: body.model,
        error: body.error,
        project: resolveProjectContext(deps.projectManager),
      });
      res.json({ success: true, state });
    } catch (error) {
      sendAutoResearchError(res, error, '[AutoResearch] Operation route error:');
    }
  });

  return router;
}

function resolveProjectContext(projectManager: ProjectManager): AutoResearchProjectContext {
  const currentProject = projectManager.getCurrentProject();
  return {
    projectId: currentProject.projectId || 'current-workspace',
    projectName: currentProject.name || '当前工作区',
    writingProfileId: currentProject.writingProfileId,
    writingProfileLabel: currentProject.writingProfileLabel,
  };
}

function resolveClientRunId(clientRunId: string | undefined, action: string): string {
  const clean = String(clientRunId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
  return clean || `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pushAutoResearchProgress(
  userId: string,
  runId: string,
  action: string,
  status: 'running' | 'completed' | 'failed',
  progress: number,
  message: string
): void {
  const now = new Date().toISOString();
  const previous = autoResearchProgressByUser.get(userId);
  const events = previous && previous.runId === runId ? previous.events.slice(-40) : [];
  const event: AutoResearchProgressEvent = {
    id: `evt_${Date.now()}_${events.length}`,
    runId,
    userId,
    action,
    status,
    progress: Math.max(0, Math.min(100, Math.round(progress))),
    message,
    createdAt: now,
  };
  events.push(event);
  autoResearchProgressByUser.set(userId, {
    runId,
    userId,
    action,
    status,
    progress: event.progress,
    message,
    updatedAt: now,
    events,
  });
}

function describePdfWikiEvidenceReadiness(
  store: { pdfs?: unknown[]; entries?: unknown[]; referenceIndex?: unknown[] },
  evidenceObjectCount?: number
): string {
  const pdfCount = Array.isArray(store.pdfs) ? store.pdfs.length : 0;
  const entryCount = Array.isArray(store.entries) ? store.entries.length : 0;
  const referenceCount = Array.isArray(store.referenceIndex) ? store.referenceIndex.length : 0;
  if (typeof evidenceObjectCount === 'number' && evidenceObjectCount > 0) {
    return `证据库完成：${evidenceObjectCount} 个证据对象`;
  }
  if (pdfCount === 0) {
    return '未找到 PDF Wiki 数据：请先在 PDF 管理上传 PDF 并完成深入分析';
  }
  if (entryCount === 0) {
    return `PDF Wiki 已有 ${pdfCount} 个 PDF，但尚未生成论点组；请运行深入分析或重建 PDF Wiki`;
  }
  return `PDF Wiki 已有 ${entryCount} 个论点组、${referenceCount} 条参考文献，但未生成可追溯 evidence object；请检查论点是否绑定证据句`;
}

function findFinalReportOrThrow(reports: AutoResearchFinalReport[], reportId: string): AutoResearchFinalReport {
  const report = reports.find(item => item.id === reportId);
  if (!report) {
    throw new Error('未找到 AutoResearch 最终报告');
  }
  return report;
}

function findPaperDraftOrThrow(drafts: AutoResearchPaperDraft[], draftId: string): AutoResearchPaperDraft {
  const draft = drafts.find(item => item.id === draftId);
  if (!draft) {
    throw new Error('未找到 AutoResearch 论文草稿');
  }
  return draft;
}

function formatFinalReportMarkdown(report: AutoResearchFinalReport): string {
  const lines: string[] = [];
  lines.push(`# ${report.title || 'AutoResearch 结果'}`);
  lines.push('');
  lines.push(`生成时间：${report.generatedAt || ''}`);
  if (report.editedAt) lines.push(`编辑时间：${report.editedAt}`);
  lines.push(`研究主题：${report.topic || ''}`);
  lines.push('');
  lines.push('## 摘要');
  lines.push(report.executiveSummary || '');
  appendPaperTopicReview(lines, report);
  appendPaperWritingBlueprint(lines, report);
  appendContentEnhancementReport(lines, report);
  appendListSection(lines, '文献图谱', report.literatureOverview);
  appendEvidenceSynthesis(lines, report.evidenceSynthesis || []);
  appendListSection(lines, '研究假设', report.hypotheses);
  appendListSection(lines, '知识缺口', report.knowledgeGaps);
  appendListSection(lines, '实验/数据计划', report.experimentPlan);
  appendListSection(lines, '草稿框架', report.draftOutline);
  lines.push('');
  lines.push('## 审稿式自检摘要');
  lines.push(report.reviewSummary || '');
  appendListSection(lines, '限制', report.limitations);
  appendListSection(lines, '下一步', report.nextSteps);
  lines.push('');
  lines.push('## 追溯信息');
  lines.push(`- 文献快照：${report.trace?.literatureSnapshotId || '未记录'}`);
  lines.push(`- 证据快照：${report.trace?.evidenceSnapshotId || '未记录'}`);
  lines.push(`- 自评报告：${report.trace?.evaluationId || '未记录'}`);
  lines.push(`- 主题相关文献：${report.trace?.literatureNodeCount || 0}/${report.trace?.totalLiteratureNodeCount || 0}`);
  lines.push(`- 等权纳入证据对象：${report.trace?.evidenceObjectCount || 0}`);
  lines.push(`- PDF Wiki 句级证据原始数量：${report.trace?.pdfWikiEvidenceObjectCount || 0}`);
  lines.push(`- Embedding 摘要证据原始数量：${report.trace?.embeddingEvidenceObjectCount || 0}`);
  lines.push(`- 操作记录：${report.trace?.operationCount || 0}`);
  lines.push('');
  return lines.join('\n');
}

function appendPaperTopicReview(lines: string[], report: AutoResearchFinalReport): void {
  const review = report.paperTopicReview;
  if (!review) return;
  lines.push('');
  lines.push('## 论文选题与内容前置审查');
  lines.push(`- 推荐论文类型：${review.paperType || '未判断'}`);
  lines.push(`- 不推荐类型：${Array.isArray(review.notRecommendedTypes) && review.notRecommendedTypes.length ? review.notRecommendedTypes.join('；') : '暂无'}`);
  lines.push(`- 选题风险等级：${review.topicRiskLevel || '未判断'}`);
  lines.push(`- 证据准备度：${review.evidenceReadiness || '未判断'}`);
  lines.push(`- 是否建议进入写作：${review.goToWritingStage || '未判断'}`);
  lines.push(`- 选题大小诊断：${review.topicScopeDiagnosis || ''}`);
  lines.push(`- 当前证据实际覆盖范围：${review.actualEvidenceScope || ''}`);
  appendListSection(lines, '主要不匹配点', review.mismatchPoints);
  if (review.recommendedBoundary) {
    lines.push('');
    lines.push('## 研究边界锁定');
    lines.push(`- 区域：${review.recommendedBoundary.region || ''}`);
    lines.push(`- 作物/系统：${review.recommendedBoundary.system || ''}`);
    lines.push(`- 研究对象：${review.recommendedBoundary.object || ''}`);
    lines.push(`- 管理措施/处理：${(review.recommendedBoundary.treatments || []).join('；') || '需要补充'}`);
    lines.push(`- 核心指标：${(review.recommendedBoundary.indicators || []).join('；') || '需要补充'}`);
    lines.push(`- 机制变量：${(review.recommendedBoundary.mechanisms || []).join('；') || '需要补充'}`);
    lines.push(`- 时间尺度：${review.recommendedBoundary.timeScale || ''}`);
    lines.push(`- 不应讨论内容：${(review.recommendedBoundary.excludedScope || []).join('；') || '暂无'}`);
  }
  appendListSection(lines, '优化后的核心科学问题', review.optimizedScientificQuestions);
  appendListSection(lines, '高风险问题清单', review.highRiskIssues);
}

function appendPaperWritingBlueprint(lines: string[], report: AutoResearchFinalReport): void {
  const blueprint = report.paperWritingBlueprint;
  if (!blueprint) return;
  lines.push('');
  lines.push('## 推荐论文写作蓝图');
  lines.push(`- 推荐论文类型：${blueprint.paperType || ''}`);
  lines.push(`- 稳妥型题目：${blueprint.titleOptions?.conservative || ''}`);
  lines.push(`- 创新型题目：${blueprint.titleOptions?.innovative || ''}`);
  lines.push(`- 投稿型题目：${blueprint.titleOptions?.submissionReady || ''}`);
  lines.push(`- 推荐使用：${blueprint.recommendedTitle || ''}`);
  lines.push(`- 核心研究对象：${blueprint.coreResearchObject || ''}`);
  lines.push(`- 中心论点：${blueprint.centralArgument || ''}`);
  appendListSection(lines, '核心科学问题', blueprint.coreScientificQuestions);
  appendListSection(lines, '可支持的结论', blueprint.supportedClaims);
  appendListSection(lines, '不能写的结论', blueprint.claimsToAvoid);
  if (blueprint.evidenceHierarchy) {
    lines.push('');
    lines.push('## 证据分级策略');
    appendListSection(lines, '直接证据用于', blueprint.evidenceHierarchy.directEvidence);
    appendListSection(lines, '相邻证据用于', blueprint.evidenceHierarchy.adjacentEvidence);
    appendListSection(lines, '机制证据用于', blueprint.evidenceHierarchy.mechanisticEvidence);
  }
  appendListSection(lines, '创新性诊断保留点', blueprint.innovationPoints);
  appendListSection(lines, '机制链条', blueprint.mechanismChain);
  appendListSection(lines, '文章结构建议', blueprint.recommendedStructure);
  appendListSection(lines, '必须增加的图表', blueprint.requiredFiguresTables);
  appendListSection(lines, '写作限制', blueprint.writingWarnings);
}

function appendContentEnhancementReport(lines: string[], report: AutoResearchFinalReport): void {
  const enhancement = report.contentEnhancementReport;
  if (!enhancement) return;
  lines.push('');
  lines.push('## 内容厚度与论证结构增强报告');
  lines.push(`- 报告 ID：${enhancement.id || ''}`);
  lines.push(`- 生成时间：${enhancement.generatedAt || ''}`);
  lines.push(`- 当前稿件类型：${enhancement.paperPositionDiagnosis?.currentManuscriptType || ''}`);
  lines.push(`- 目标论文类型：${enhancement.paperPositionDiagnosis?.targetPaperType || ''}`);
  lines.push(`- 是否需要重构：${enhancement.paperPositionDiagnosis?.needsReconstruction ? '是' : '否'}`);
  lines.push(`- Go / No-Go：${enhancement.goNoGoDecision?.decision || ''}；${enhancement.goNoGoDecision?.reason || ''}`);
  appendListSection(lines, '主要内容问题', enhancement.mainContentProblems);
  appendContentEvidenceDependencyTable(lines, enhancement.coreEvidenceDependencyCheck || []);
  appendListSection(lines, '正向发现', enhancement.positiveFindings);
  appendContentEvidenceMatrix(lines, enhancement.evidenceMatrix || []);
  appendContentVmoMatrix(lines, enhancement.variableMechanismOutcomeMatrix || []);
  appendContentQuantitativeSummary(lines, enhancement.quantitativeResultSummary || []);
  appendContentIndicatorBoundary(lines, enhancement.indicatorBoundaryCheck || []);
  lines.push('');
  lines.push('## Innovation Framework');
  lines.push(`- Framework name：${enhancement.innovationFramework?.frameworkName || ''}`);
  lines.push(`- Core logic：${enhancement.innovationFramework?.coreLogic || ''}`);
  appendListSection(lines, 'Framework components', enhancement.innovationFramework?.components);
  appendListSection(lines, 'What it explains', enhancement.innovationFramework?.whatItExplains);
  appendListSection(lines, 'What it does not explain', enhancement.innovationFramework?.whatItDoesNotExplain);
  appendListSection(lines, 'Testable hypotheses or future questions', enhancement.innovationFramework?.testableHypothesesOrFutureQuestions);
  lines.push('');
  lines.push('## Figure 1. Conceptual Framework');
  lines.push(enhancement.proposedConceptualFigure?.caption || '');
  lines.push('');
  lines.push('```mermaid');
  lines.push(enhancement.proposedConceptualFigure?.mermaid || '');
  lines.push('```');
  appendContentHeatmap(lines, enhancement.evidenceStrengthHeatmap || []);
  appendListSection(lines, 'Revised Results Structure', enhancement.revisedResultsStructure);
  appendListSection(lines, 'Revised Discussion Structure', enhancement.revisedDiscussionStructure);
  appendListSection(lines, 'Revised Conclusion Logic', enhancement.revisedConclusionLogic);
  lines.push('');
  lines.push('## Reference Cleaning Notes');
  lines.push(`- Core evidence to retain：${enhancement.referenceCleaningNotes?.coreEvidenceToRetain?.join('；') || 'NR'}`);
  lines.push(`- Mechanistic evidence to retain：${enhancement.referenceCleaningNotes?.mechanisticEvidenceToRetain?.join('；') || 'NR'}`);
  lines.push(`- Background evidence to retain：${enhancement.referenceCleaningNotes?.backgroundEvidenceToRetain?.join('；') || 'NR'}`);
  lines.push(`- References requiring verification：${enhancement.referenceCleaningNotes?.referencesRequiringVerification?.join('；') || 'NR'}`);
  lines.push(`- References to remove or exclude：${enhancement.referenceCleaningNotes?.referencesToRemoveOrExclude?.join('；') || 'NR'}`);
  appendListSection(lines, 'Required actions before writing', enhancement.goNoGoDecision?.requiredActionsBeforeWriting);
  appendContentQualityChecklist(lines, enhancement.qualityChecklist || []);
}

function appendContentEvidenceDependencyTable(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['coreEvidenceDependencyCheck']): void {
  lines.push('');
  lines.push('## 核心证据依赖检查');
  appendMarkdownTable(lines, ['核心结论', '主要依赖证据', '是否过度依赖单一来源', '需要补充的证据路径'], rows.map(row => [
    row.coreClaim,
    row.primaryEvidence,
    row.overDependsOnSingleSource ? '是' : '否',
    row.evidencePathToAdd,
  ]));
}

function appendContentEvidenceMatrix(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['evidenceMatrix']): void {
  lines.push('');
  lines.push('## Table 1. Evidence Matrix');
  appendMarkdownTable(lines, [
    'Study / Data source',
    'Object / System',
    'Context',
    'Variable / Intervention',
    'Outcome / Indicator',
    'Quantitative result',
    'Mechanism indicator',
    'Evidence class',
    'Evidence strength',
    'Supported claim',
    'Claim to avoid',
  ], rows.slice(0, 30).map(row => [
    row.studyOrDataSource,
    row.objectPopulationSystem,
    row.contextRegionScenario,
    row.variableInterventionExposure,
    row.outcomeIndicator,
    row.quantitativeResult,
    row.mechanismIndicator,
    row.evidenceClass,
    row.evidenceStrength,
    row.supportedClaim,
    row.claimToAvoid,
  ]));
}

function appendContentVmoMatrix(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['variableMechanismOutcomeMatrix']): void {
  lines.push('');
  lines.push('## Table 2. Variable-Mechanism-Outcome Matrix');
  appendMarkdownTable(lines, [
    'Variable / Intervention / Phenomenon',
    'Direct effect',
    'Intermediate mechanism',
    'Primary outcome',
    'Secondary outcome / Trade-off',
    'Evidence class',
    'Evidence strength',
    'Boundary condition',
    'Uncertainty',
  ], rows.slice(0, 30).map(row => [
    row.variableInterventionPhenomenon,
    row.directEffect,
    row.intermediateMechanism,
    row.primaryOutcome,
    row.secondaryOutcomeTradeoff,
    row.evidenceClass,
    row.evidenceStrength,
    row.boundaryCondition,
    row.uncertainty,
  ]));
}

function appendContentQuantitativeSummary(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['quantitativeResultSummary']): void {
  lines.push('');
  lines.push('## Table 3. Quantitative Result Summary');
  appendMarkdownTable(lines, [
    'Source',
    'Object / Group',
    'Treatment / Variable',
    'Indicator',
    'Baseline / Control',
    'Reported value or change',
    'Direction',
    'Statistical information',
    'Interpretation',
    'Limitation',
  ], rows.slice(0, 30).map(row => [
    row.source,
    row.objectGroup,
    row.treatmentVariable,
    row.indicator,
    row.baselineControl,
    row.reportedValueOrChange,
    row.direction,
    row.statisticalInformation,
    row.interpretation,
    row.limitation,
  ]));
}

function appendContentIndicatorBoundary(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['indicatorBoundaryCheck']): void {
  lines.push('');
  lines.push('## Indicator Boundary Check');
  appendMarkdownTable(lines, ['Indicator', 'What it can support', 'What it cannot support', 'Needs separation from'], rows.map(row => [
    row.indicator,
    row.whatItCanSupport,
    row.whatItCannotSupport,
    row.needsSeparationFrom,
  ]));
}

function appendContentHeatmap(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['evidenceStrengthHeatmap']): void {
  lines.push('');
  lines.push('## Figure 2. Evidence Strength Heatmap');
  appendMarkdownTable(lines, ['Pathway / Topic', 'Direct evidence', 'System-specific evidence', 'Adjacent evidence', 'Mechanistic evidence', 'Overall confidence'], rows.map(row => [
    row.pathwayTopic,
    row.directEvidence,
    row.systemSpecificEvidence,
    row.adjacentEvidence,
    row.mechanisticEvidence,
    row.overallConfidence,
  ]));
}

function appendContentQualityChecklist(lines: string[], rows: NonNullable<AutoResearchFinalReport['contentEnhancementReport']>['qualityChecklist']): void {
  lines.push('');
  lines.push('## 内容增强质量自检清单');
  appendMarkdownTable(lines, ['检查项', '是否通过', '说明'], rows.map(row => [
    row.item,
    row.passed ? '是' : '否',
    row.detail,
  ]));
}

function appendMarkdownTable(lines: string[], headers: string[], rows: string[][]): void {
  if (!rows.length) {
    lines.push('暂无内容。');
    return;
  }
  lines.push(`| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  rows.forEach(row => {
    lines.push(`| ${headers.map((_, index) => escapeMarkdownTableCell(row[index] || 'NR')).join(' | ')} |`);
  });
}

function escapeMarkdownTableCell(value: unknown): string {
  return String(value || 'NR').replace(/\r?\n/g, ' ').replace(/\|/g, '/').trim().slice(0, 700);
}

function appendListSection(lines: string[], title: string, items?: string[]): void {
  lines.push('');
  lines.push(`## ${title}`);
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (list.length === 0) {
    lines.push('暂无内容。');
    return;
  }
  list.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
}

function appendEvidenceSynthesis(lines: string[], items: AutoResearchFinalReport['evidenceSynthesis']): void {
  lines.push('');
  lines.push('## 证据综合');
  if (!items || items.length === 0) {
    lines.push('暂无可追溯证据对象。');
    return;
  }
  items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.claim}`);
    lines.push(`   - 支持：${item.supportCount}；中性：${item.neutralCount}；反对：${item.opposeCount}`);
    lines.push(`   - 摘要：${item.summary}`);
  });
}

function buildAutoResearchWritingContext(state: AutoResearchState): {
  generatedAt: string;
  source: string;
  available: boolean;
  dataset: Record<string, unknown>;
  latestFinalReport: Record<string, unknown> | null;
  latestPaperDraft: Record<string, unknown> | null;
  latestAudit: Record<string, unknown> | null;
  contextMarkdown: string;
} {
  const finalReport = Array.isArray(state.finalReports) ? state.finalReports[0] : undefined;
  const draft = Array.isArray(state.paperDrafts) ? state.paperDrafts[0] : undefined;
  const audit = Array.isArray(state.auditReports) ? state.auditReports[0] : undefined;
  const wiki = state.researchWiki || { nodes: [], edges: [], queryPack: '' };
  const evidenceObjects = state.evidenceLibrary?.objects || [];
  const literatureNodes = state.literatureMap?.nodes || [];
  const completedTaskRecords = state.completedTaskRecords || [];
  const available = Boolean(
    finalReport ||
    draft ||
    audit ||
    completedTaskRecords.length > 0 ||
    (Array.isArray(wiki.nodes) && wiki.nodes.length > 0) ||
    evidenceObjects.length > 0 ||
    literatureNodes.length > 0
  );
  const generatedAt = new Date().toISOString();
  const dataset = {
    taskTitle: state.task?.title || '',
    taskTopic: state.task?.topic || state.task?.goal || '',
    taskStatus: state.task?.status || '',
    currentStageId: state.task?.currentStageId || '',
    finalReportCount: state.finalReports?.length || 0,
    paperDraftCount: state.paperDrafts?.length || 0,
    completedTaskRecordCount: completedTaskRecords.length,
    auditReportCount: state.auditReports?.length || 0,
    literatureNodeCount: literatureNodes.length,
    evidenceObjectCount: evidenceObjects.length,
    wikiNodeCount: Array.isArray(wiki.nodes) ? wiki.nodes.length : 0,
    wikiEdgeCount: Array.isArray(wiki.edges) ? wiki.edges.length : 0,
  };

  const lines: string[] = [];
  lines.push('# Auto Research 结果使用上下文');
  lines.push('');
  lines.push('用户已在主页输入框上方选择“Auto Research 结果”。后续回答必须把这些结果作为上游调研、选题审查、证据综合、论文结构和风险控制依据。不能超出证据边界编造结论；正式写作时优先使用可追溯证据与已有文献。');
  lines.push('');
  lines.push(`任务：${dataset.taskTitle || '未命名任务'}`);
  lines.push(`主题：${dataset.taskTopic || '未记录主题'}`);
  lines.push(`状态：${dataset.taskStatus || '未记录'}；当前阶段：${dataset.currentStageId || '未记录'}`);
  lines.push(`计数：最终报告 ${dataset.finalReportCount}；论文草稿 ${dataset.paperDraftCount}；任务记录 ${dataset.completedTaskRecordCount}；文献节点 ${dataset.literatureNodeCount}；证据对象 ${dataset.evidenceObjectCount}；Wiki 节点 ${dataset.wikiNodeCount}。`);

  if (finalReport) {
    const finalReportMarkdown = finalReport.editedMarkdown || formatFinalReportMarkdown(finalReport);
    lines.push('');
    lines.push('## 最新 Auto Research 最终报告');
    lines.push(compactAutoResearchContextText(finalReportMarkdown, 16000));
  }

  if (audit) {
    lines.push('');
    lines.push('## 引用与论据审计');
    lines.push(`结论：${String(audit.verdict || '').toUpperCase() || '未记录'}；评分：${Math.round(Number(audit.overallScore || 0) * 100)}`);
    if (audit.summary) lines.push(String(audit.summary));
    if (Array.isArray(audit.findings) && audit.findings.length > 0) {
      audit.findings.slice(0, 12).forEach((finding: any, index: number) => {
        lines.push(`${index + 1}. [${finding.level || ''}/${finding.category || ''}] ${finding.message || ''}${finding.detail ? ` - ${finding.detail}` : ''}`);
      });
    }
  }

  if (wiki.queryPack) {
    lines.push('');
    lines.push('## Auto Research Wiki Query Pack');
    lines.push(compactAutoResearchContextText(wiki.queryPack, 5000));
  } else if (Array.isArray(wiki.nodes) && wiki.nodes.length > 0) {
    lines.push('');
    lines.push('## Auto Research Wiki 摘要');
    wiki.nodes.slice(0, 40).forEach((node: any, index: number) => {
      lines.push(`${index + 1}. [${node.type || 'node'}] ${node.title || ''}${node.summary ? ` - ${node.summary}` : ''}`);
    });
  }

  if (evidenceObjects.length > 0) {
    lines.push('');
    lines.push('## 可追溯证据对象');
    evidenceObjects.slice(0, 30).forEach((item: any, index: number) => {
      const refs = Array.isArray(item.references)
        ? item.references.map((ref: any) => ref.doi || ref.title || ref.raw || ref.id).filter(Boolean).slice(0, 3).join('; ')
        : '';
      lines.push(`${index + 1}. ${item.claim || ''} | stance=${item.stance || ''} | source=${item.sourcePdfTitle || item.sourcePdfName || item.source || ''}${refs ? ` | refs=${refs}` : ''}`);
      const evidenceText = compactAutoResearchContextText(item.evidenceText || item.viewpointSummary || item.summary || '', 700);
      if (evidenceText) lines.push(`   ${evidenceText}`);
    });
  }

  if (!finalReport && literatureNodes.length > 0) {
    lines.push('');
    lines.push('## 文献图谱节点摘要');
    literatureNodes.slice(0, 25).forEach((node: any, index: number) => {
      lines.push(`${index + 1}. ${node.title || node.label || ''}${node.year ? ` (${node.year})` : ''}${node.journal ? ` - ${node.journal}` : ''}`);
    });
  }

  if (draft) {
    lines.push('');
    lines.push('## 已生成论文草稿预览');
    lines.push(`题目：${draft.title || ''}`);
    lines.push(`生成时间：${draft.generatedAt || ''}；预计字数：${draft.wordCountEstimate || 0}；参考文献数：${draft.referenceCount || 0}`);
    lines.push(compactAutoResearchContextText(draft.editedMarkdown || draft.markdown || '', 7000));
  }

  return {
    generatedAt,
    source: 'auto-research',
    available,
    dataset,
    latestFinalReport: finalReport ? {
      id: finalReport.id,
      title: finalReport.title,
      topic: finalReport.topic,
      generatedAt: finalReport.generatedAt,
      editedAt: finalReport.editedAt,
      executiveSummary: finalReport.executiveSummary,
      paperTopicReview: finalReport.paperTopicReview,
      paperWritingBlueprint: finalReport.paperWritingBlueprint,
      contentEnhancementReport: finalReport.contentEnhancementReport,
    } : null,
    latestPaperDraft: draft ? {
      id: draft.id,
      reportId: draft.reportId,
      title: draft.title,
      topic: draft.topic,
      generatedAt: draft.generatedAt,
      editedAt: draft.editedAt,
      wordCountEstimate: draft.wordCountEstimate,
      referenceCount: draft.referenceCount,
    } : null,
    latestAudit: audit ? {
      id: audit.id,
      generatedAt: audit.generatedAt,
      verdict: audit.verdict,
      overallScore: audit.overallScore,
      summary: audit.summary,
    } : null,
    contextMarkdown: compactAutoResearchContextText(lines.filter(Boolean).join('\n'), 30000),
  };
}

function compactAutoResearchContextText(value: unknown, maxLength = 3000): string {
  const text = String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  if (text.length <= maxLength) return text;
  if (maxLength <= 80) return text.slice(0, maxLength);
  const headLength = Math.max(40, Math.floor(maxLength * 0.72));
  const tailLength = Math.max(20, maxLength - headLength - 80);
  return `${text.slice(0, headLength).trim()}\n\n...[已压缩，省略 ${text.length - headLength - tailLength} 字]...\n\n${text.slice(-tailLength).trim()}`;
}

function sanitizeDownloadFilename(value: string): string {
  return String(value || 'AutoResearch报告')
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 120) || 'AutoResearch报告';
}

async function buildAutoResearchCitationGraphTrace(papers: LiteratureRecord[]): Promise<{
  dois: string[];
  doiVerification: Record<string, DoiVerificationResult>;
  citationExpansion: CitationExpansionResult[];
}> {
  const dois = Array.from(new Set(
    papers
      .map(paper => String((paper as { doi?: unknown }).doi || '').trim())
      .filter(doi => /^10\.\d{4,9}\//i.test(doi))
  )).slice(0, 5);
  if (dois.length === 0) {
    return { dois: [], doiVerification: {}, citationExpansion: [] };
  }

  const doiVerification = await verifyDois(dois, { maxDois: dois.length, timeoutMs: 5000 }).catch(error => {
    logger.warn('[AutoResearch] DOI verification during citation graph expansion failed:', error);
    return {};
  });
  const citationExpansion: CitationExpansionResult[] = [];
  for (const doi of dois.slice(0, 3)) {
    try {
      citationExpansion.push(await expandCitations(doi, 8, 5, 5000));
    } catch (error) {
      logger.warn(`[AutoResearch] Citation graph expansion failed for ${doi}:`, error);
      citationExpansion.push({ doi, references: [], citedBy: [] });
    }
  }
  return { dois, doiVerification, citationExpansion };
}

function sendAutoResearchError(res: Response, error: unknown, logMessage: string): void {
  const status = error instanceof ZodError ? 400 : 500;
  const message = error instanceof ZodError
    ? error.issues.map(issue => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ')
    : (error as Error).message || 'AutoResearch 请求失败';
  logger.error(logMessage, error);
  res.status(status).json({ success: false, error: message });
}

export default createAutoResearchRouter;
