/**
 * Meta analysis engineering workflow.
 *
 * This route consumes the PDF Wiki Meta database directly, turns extracted
 * study rows into effect-size rows, and emits an R/metafor script for full
 * local plotting and diagnostics.
 */

import { Router, type Request, type Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { getUserUploadDir, sanitizeUserId } from '../../utils/paths';

export interface MetaAnalysisIntegratedDataTable {
  id: string;
  pdfId: string;
  pdfName: string;
  pdfTitle: string;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  realRowCount?: number;
  isPlaceholder?: boolean;
}

export interface CreateMetaAnalysisRouterOptions {
  getIntegratedDataTablesForExport: (userId: string, pdfIds: string[]) => Promise<MetaAnalysisIntegratedDataTable[]>;
  generateAiPlan?: (input: MetaAnalysisAssistantInput) => Promise<MetaAnalysisAssistantResult>;
}

export type VariableType = 'numeric' | 'categorical' | 'empty';
export type EffectMeasure = 'lnRR' | 'MD' | 'SMD' | 'lnRR_mean_only' | 'MD_mean_only';
export type MetaModelType = 'random' | 'fixed' | 'mixed';

export interface MetaControlRule {
  id: string;
  label?: string;
  treatmentLabels?: string[];
  treatmentPattern?: string;
  controlLabels: string[];
  controlPattern?: string;
  matchColumns?: string[];
}

interface MetaVariable {
  name: string;
  type: VariableType;
  nonMissingCount: number;
  missingCount: number;
  numericCount: number;
  uniqueCount: number;
  sampleValues: string[];
}

export interface MetaOutcomeMapping {
  treatmentMean: string;
  treatmentSd: string;
  treatmentN: string;
  controlMean: string;
  controlSd: string;
  controlN: string;
}

interface CandidateOutcome {
  id: string;
  label: string;
  measure: EffectMeasure;
  mapping: MetaOutcomeMapping;
  completeRows: number;
  totalRows: number;
  warnings: string[];
}

export interface MetaOutcomeConfig extends Partial<MetaOutcomeMapping> {
  treatmentMean: string;
  controlMean: string;
  id?: string;
  label?: string;
  measure?: EffectMeasure;
  moderators?: string[];
  direction?: number | string;
}

export interface MetaRangeGroupConfig {
  label: string;
  min?: number;
  max?: number;
  includeMin: boolean;
  includeMax: boolean;
}

export interface MetaColumnPreprocessConfig {
  column: string;
  type: 'rangeGroups';
  spec: string;
  groups?: MetaRangeGroupConfig[];
  unmatchedLabel?: string;
}

export interface MetaRunConfig {
  outcomes?: MetaOutcomeConfig[];
  model?: MetaModelType;
  method?: string;
  studyIdColumn?: string;
  clusterBy?: string;
  moderatorColumns?: string[];
  subgroupColumns?: string[];
  columnPreprocess?: MetaColumnPreprocessConfig[];
  minCompleteRows?: number;
  controlRules?: MetaControlRule[];
  excludeManualReview?: boolean;
  manualReviewColumn?: string;
}

interface FlattenedDataset {
  tables: MetaAnalysisIntegratedDataTable[];
  rows: Array<Record<string, unknown>>;
  columns: string[];
  pdfCount: number;
}

export interface MetaAnalysisAssistantOperation {
  id: string;
  type: string;
  title: string;
  rationale: string;
  params?: Record<string, unknown>;
  requiresConfirmation?: boolean;
}

export interface MetaAnalysisAssistantWorkspace {
  id: string;
  conversationId?: string;
  createdAt: string;
  userId: string;
  sourcePdfIds: string[];
  dataset: {
    pdfCount: number;
    tableCount: number;
    rowCount: number;
    columnCount: number;
  };
  columns: string[];
  sampleRows: Array<Record<string, unknown>>;
  copyStoragePath?: string;
  excelJsonPath?: string;
  excelJsonSummary?: Record<string, unknown>;
  excelJsonPacket?: Record<string, unknown>;
}

export interface MetaAnalysisAssistantInput {
  userId: string;
  pdfIds: string[];
  conversationId?: string;
  writingConversationId?: string;
  confirmedByUser?: boolean;
  forceProvider?: 'secondary' | 'primary' | 'codex';
  query: string;
  chatHistory?: Array<{ role: 'user' | 'assistant'; content: string; createdAt?: string }>;
  recentUserQueries?: string[];
  workspace: MetaAnalysisAssistantWorkspace;
  excelJsonPacket?: Record<string, unknown>;
  variables: MetaVariable[];
  candidateOutcomes: CandidateOutcome[];
  moderatorCandidates: MetaVariable[];
  recommendedConfig: Required<MetaRunConfig>;
  warnings: string[];
}

export interface MetaAnalysisAssistantResult {
  provider: string;
  conversationId?: string;
  codexSessionId?: string;
  workflowStage?: string;
  assistantMessage: string;
  dataUnderstanding?: Record<string, unknown>;
  operations: MetaAnalysisAssistantOperation[];
  rPlan?: Record<string, unknown>;
  suggestedConfig?: Partial<MetaRunConfig>;
  questions?: string[];
  warnings?: string[];
  rawText?: string;
  fallbackChain?: string[];
  progressLogs?: string[];
  autoPreparedDataset?: MetaAnalysisPreparedDatasetInfo;
  autoRun?: MetaAnalysisRunData;
}

export interface EffectRow {
  outcome_id: string;
  outcome_label: string;
  measure: EffectMeasure;
  study_id: string;
  cluster_id: string;
  contrast_id: string;
  contrast_label: string;
  pdf_id: string;
  pdf_title: string;
  pdf_file: string;
  row_index: number;
  obs_id: string;
  yi: number;
  vi: number;
  sei: number;
  weight: number;
  treatment_mean: number;
  treatment_sd: number;
  treatment_n: number;
  control_mean: number;
  control_sd: number;
  control_n: number;
  effect_label: string;
  source: string;
  location: string;
  evidence: string;
  moderators: Record<string, string | number>;
}

export interface SkippedEffectRow {
  outcomeId: string;
  rowIndex: number;
  studyId: string;
  reason: string;
}

export interface MetaSummary {
  outcomeId: string;
  outcomeLabel: string;
  measure: EffectMeasure;
  k: number;
  fixed: SummaryEstimate;
  random: SummaryEstimate;
  heterogeneity: {
    q: number;
    df: number;
    i2: number;
    tau2: number;
  };
}

export interface MetaSubgroupSummary extends MetaSummary {
  subgroupColumn: string;
  subgroupLevel: string;
}

export interface MetaAnalysisRArtifacts {
  generatedAt: string;
  markdown?: string;
  jobId?: string;
  files?: unknown[];
  imageFiles?: unknown[];
  supportFiles?: unknown[];
  workDir?: string;
  plotDir?: string;
}

export interface MetaAnalysisWritingContext {
  analysisId: string;
  conversationId?: string;
  workspaceId?: string;
  userId: string;
  sourcePdfIds: string[];
  datasetFingerprint: string;
  generatedAt: string;
  source: 'meta-analysis-writing-context';
  available: boolean;
  status?: 'completed' | 'stale';
  staleReason?: string;
  supersededByWorkspaceId?: string;
  dataset: {
    pdfCount: number;
    tableCount: number;
    rowCount: number;
    columnCount: number;
  };
  config: Required<MetaRunConfig>;
  summaries: MetaSummary[];
  subgroups: MetaSubgroupSummary[];
  quality: { warnings: string[]; checks: Array<{ label: string; status: 'ok' | 'warn'; message: string }> };
  effectRows: EffectRow[];
  skippedRows: SkippedEffectRow[];
  skippedCount: number;
  markdown: string;
  rArtifacts?: MetaAnalysisRArtifacts;
  exports: {
    writingContextUrl: string;
    effectSizesCsvUrl: string;
  };
  effectRowsCsv: string;
  effectRowsFilename: string;
  contextMarkdown: string;
}

export interface MetaAnalysisPreparedDatasetInfo {
  workspaceId: string;
  generatedAt: string;
  rowCount: number;
  columnCount: number;
  effectRowCount: number;
  skippedCandidateCount: number;
  excludedManualReviewCount?: number;
  selectedMeasures?: EffectMeasure[];
  storagePath?: string;
  notes: string[];
}

export interface MetaAnalysisRunData {
  analysisId: string;
  conversationId?: string;
  workspaceId?: string;
  sourcePdfIds: string[];
  datasetFingerprint: string;
  dataset: {
    pdfCount: number;
    tableCount: number;
    rowCount: number;
    columnCount: number;
  };
  config: Required<MetaRunConfig>;
  effectRows: EffectRow[];
  skippedRows: SkippedEffectRow[];
  skippedCount: number;
  summaries: MetaSummary[];
  subgroups: MetaSubgroupSummary[];
  quality: { warnings: string[]; checks: Array<{ label: string; status: 'ok' | 'warn'; message: string }> };
  markdown: string;
  rCode: string;
  effectRowsCsv: string;
  effectRowsFilename: string;
  preparedDataset?: MetaAnalysisPreparedDatasetInfo;
}

export interface SummaryEstimate {
  estimate: number;
  se: number;
  ciLower: number;
  ciUpper: number;
  z: number;
  p: number;
  method?: string;
  bootstrapIterations?: number;
  clusterCount?: number;
}

interface MetaAnalysisRunScope {
  analysisId?: string;
  conversationId?: string;
  workspaceId?: string;
  sourcePdfIds?: string[];
}

interface MetaWritingContextLookup {
  analysisId?: string;
  conversationId?: string;
  allowLegacyFallback?: boolean;
}

const EFFECT_MEASURES: Array<{ id: EffectMeasure; name: string; description: string }> = [
  {
    id: 'lnRR',
    name: '自然对数响应比 lnRR',
    description: '适合处理组/对照组均值均为正值的生态与农学指标，可解释为相对变化。',
  },
  {
    id: 'MD',
    name: '均值差 MD',
    description: '保留原始单位，适合同一量纲、同一测量尺度的数据。',
  },
  {
    id: 'SMD',
    name: '标准化均值差 SMD/Hedges g',
    description: '适合不同量纲或不同测量尺度的连续变量，使用合并标准差标准化。',
  },
  {
    id: 'lnRR_mean_only',
    name: '无SD/SE：均值响应比 lnRR + bootstrap',
    description: '只用处理组/对照组均值计算 lnRR，不使用逆方差权重；用非参数重抽样得到总体效应和置信区间。',
  },
  {
    id: 'MD_mean_only',
    name: '无SD/SE：均值差 MD + bootstrap',
    description: '只用处理组/对照组均值计算均值差，不使用逆方差权重；用非参数重抽样得到总体效应和置信区间。',
  },
];

const TRACE_COLUMNS = new Set([
  'PDF标题',
  'PDF文件名',
  'PDF ID',
  'PDFID',
  '数据来源',
  '来源名称',
  '页码/位置',
  '证据原文',
  'DOI',
  'doi',
]);

const STUDY_ID_CANDIDATES = ['Study#', 'study_id', 'Study ID', 'study', '论文ID', 'PDF标题', 'PDF文件名', 'PDF ID'];

const STAT_SUFFIXES: Record<keyof MetaOutcomeMapping, string[]> = {
  treatmentMean: ['_tmean', '_t_mean', '_trtmean', '_trt_mean', '_treatmentmean', '_treatment_mean', '_experimentalmean', '_experimental_mean'],
  treatmentSd: ['_tsd', '_t_sd', '_trtsd', '_trt_sd', '_treatmentsd', '_treatment_sd', '_experimentalsd', '_experimental_sd'],
  treatmentN: ['_tn', '_t_n', '_trtn', '_trt_n', '_treatmentn', '_treatment_n', '_experimentaln', '_experimental_n'],
  controlMean: ['_ckmean', '_ck_mean', '_cmean', '_c_mean', '_controlmean', '_control_mean'],
  controlSd: ['_cksd', '_ck_sd', '_csd', '_c_sd', '_controlsd', '_control_sd'],
  controlN: ['_ckn', '_ck_n', '_cn', '_c_n', '_controln', '_control_n'],
};

const STAT_ROLE_KEYS: Array<keyof MetaOutcomeMapping> = [
  'treatmentMean',
  'treatmentSd',
  'treatmentN',
  'controlMean',
  'controlSd',
  'controlN',
];

const ROLE_LABELS: Record<keyof MetaOutcomeMapping, string> = {
  treatmentMean: '处理组均值',
  treatmentSd: '处理组SD',
  treatmentN: '处理组n',
  controlMean: '对照组均值',
  controlSd: '对照组SD',
  controlN: '对照组n',
};

const MEAN_ONLY_BOOTSTRAP_ITERATIONS = 9999;
const META_SUBGROUP_MIN_EFFECTS = 3;
const META_SUBGROUP_MIN_STUDIES = 2;
const META_SUBGROUP_MAX_PLOT_LEVELS = 12;

function isMeanOnlyMeasure(measure: EffectMeasure | string | undefined): boolean {
  return measure === 'lnRR_mean_only' || measure === 'MD_mean_only';
}

function getRequiredOutcomeRoles(measure: EffectMeasure | string | undefined): Array<keyof MetaOutcomeMapping> {
  return isMeanOnlyMeasure(measure) ? ['treatmentMean', 'controlMean'] : STAT_ROLE_KEYS;
}

function normalizeEffectMeasure(value: unknown): EffectMeasure {
  const text = stringifyCell(value);
  if (text === 'MD' || text === 'SMD' || text === 'lnRR' || text === 'lnRR_mean_only' || text === 'MD_mean_only') return text;
  return 'lnRR';
}

function normalizeMetaScopeId(value: unknown, fallback = ''): string {
  const normalized = stringifyCell(value)
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return normalized || fallback;
}

function getMetaAnalysisActiveUserPath(): string {
  return path.join(path.dirname(getUserUploadDir('web-user')), 'meta-analysis-active-user.json');
}

async function rememberMetaAnalysisActiveUser(userId: string): Promise<void> {
  const safeUserId = sanitizeUserId(userId || 'web-user');
  const filePath = getMetaAnalysisActiveUserPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, JSON.stringify({
    userId: safeUserId,
    updatedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');
}

function readMetaAnalysisActiveUser(): string {
  try {
    const filePath = getMetaAnalysisActiveUserPath();
    if (!fs.existsSync(filePath)) return 'web-user';
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, unknown>;
    return sanitizeUserId(parsed.userId || 'web-user');
  } catch (error) {
    logger.warn('[MetaAnalysis] Failed to read active user pointer:', error);
    return 'web-user';
  }
}

export function createMetaAnalysisRouter(options: CreateMetaAnalysisRouterOptions): Router {
  const router = Router();

  router.get('/active-user', (_req: Request, res: Response) => {
    res.json({ success: true, data: { userId: readMetaAnalysisActiveUser() } });
  });

  router.post('/active-user', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      await rememberMetaAnalysisActiveUser(userId);
      res.json({ success: true, data: { userId } });
    } catch (error) {
      logger.error('[MetaAnalysis] Active user update failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || '记录 Meta 当前用户失败' });
    }
  });

  router.post('/inspect', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      await rememberMetaAnalysisActiveUser(userId);
      const writingConversationId = normalizeMetaScopeId(req.body?.conversationId);
      const pdfIds = normalizeStringArray(req.body?.pdfIds);
      if (pdfIds.length === 0) {
        res.status(400).json({ success: false, error: '请先勾选需要纳入 Meta 分析的 PDF' });
        return;
      }

      const dataset = await loadFlattenedDataset(options, userId, pdfIds);
      if (dataset.rows.length === 0) {
        res.status(404).json({ success: false, error: '未找到可分析的 Meta 整合数据行，请先完成 PDF Meta 数据提取' });
        return;
      }
      if (writingConversationId) {
        await invalidateMetaAnalysisConversationContext(
          userId,
          writingConversationId,
          pdfIds,
          buildMetaDatasetFingerprint(dataset, pdfIds),
          '打开了新的 Meta 数据预检，需重新运行后才能用于写作。',
        );
      }

      const variables = inferVariables(dataset);
      const candidates = inferCandidateOutcomes(dataset);
      const studyIdColumn = pickExistingColumn(dataset.columns, STUDY_ID_CANDIDATES) || 'Study#';
      const moderators = inferModeratorCandidates(variables, candidates);
      const manualReviewColumn = pickExistingColumn(dataset.columns, ['needs_manual_review', 'needsManualReview', '需人工复核', '人工复核']);
      const recommendedModerators = moderators
        .filter(item => moderatorPreferenceScore(item.name) > 0)
        .slice(0, 6)
        .map(item => item.name);
      const subgroupColumns = moderators
        .filter(item => moderatorPreferenceScore(item.name) > 0)
        .filter(item => item.type === 'categorical' || item.uniqueCount <= 8)
        .slice(0, 4)
        .map(item => item.name);
      const warnings = buildInspectionWarnings(dataset, candidates);

      res.json({
        success: true,
        data: {
          dataset: {
            pdfCount: dataset.pdfCount,
            tableCount: dataset.tables.length,
            rowCount: dataset.rows.length,
            columnCount: dataset.columns.length,
          },
          variables,
          candidateOutcomes: candidates,
          moderatorCandidates: moderators,
          effectMeasures: EFFECT_MEASURES,
          recommendedConfig: {
            model: 'random',
            method: 'REML',
            studyIdColumn,
            clusterBy: studyIdColumn,
            moderatorColumns: recommendedModerators,
            subgroupColumns,
            columnPreprocess: [],
            minCompleteRows: 2,
            controlRules: [],
            excludeManualReview: true,
            manualReviewColumn,
            outcomes: candidates.map(candidate => ({
              id: candidate.id,
              label: candidate.label,
              measure: candidate.measure,
              ...candidate.mapping,
              moderators: recommendedModerators,
              direction: 1,
            })),
          },
          warnings,
        },
      });
    } catch (error) {
      logger.error('[MetaAnalysis] Inspect failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || 'Meta 分析预检失败' });
    }
  });

  router.post('/ai-conversation/open', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      const conversationId = normalizeExistingMetaAssistantConversationId(req.body?.conversationId);
      if (!conversationId) {
        res.status(400).json({ success: false, error: '无效的 Meta AI 会话 ID' });
        return;
      }
      const assistantDir = path.join(getUserUploadDir(userId), 'meta-analysis', 'ai-assistant', conversationId);
      const sessionPath = path.join(assistantDir, 'codex_session.json');
      let session: Record<string, unknown> | null = null;
      if (fs.existsSync(sessionPath)) {
        try {
          session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as Record<string, unknown>;
        } catch {
          session = null;
        }
      }
      res.json({
        success: true,
        data: {
          conversationId,
          workspaceId: conversationId,
          hasWorkspace: fs.existsSync(assistantDir),
          hasCodexSession: !!session,
          codexSessionUpdatedAt: stringifyCell(session?.updatedAt),
        },
      });
    } catch (error) {
      logger.error('[MetaAnalysisAI] Open conversation failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || '打开 Meta AI 历史会话失败' });
    }
  });

  router.post('/ai-plan', async (req: Request, res: Response) => {
    try {
      const progressLogs: string[] = [];
      const appendProgressLog = (message: string) => {
        progressLogs.push(message);
        logger.info(`[MetaAnalysisAI] ${message}`);
      };
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      await rememberMetaAnalysisActiveUser(userId);
      const conversationId = normalizeMetaAssistantConversationId(req.body?.conversationId);
      const writingConversationId = normalizeMetaScopeId(req.body?.writingConversationId);
      const pdfIds = normalizeStringArray(req.body?.pdfIds);
      const query = stringifyCell(req.body?.query);
      const requestedProvider = stringifyCell(req.body?.forceProvider);
      const forceProvider = requestedProvider === 'secondary' || requestedProvider === 'primary' || requestedProvider === 'codex'
        ? requestedProvider
        : undefined;
      const chatHistory = normalizeMetaAssistantChatHistory(req.body?.chatHistory);
      const recentUserQueries = normalizeStringArray(req.body?.recentUserQueries).slice(-10);
      const confirmedByUser = isMetaAssistantConversationConfirmed(query, chatHistory);
      if (pdfIds.length === 0) {
        res.status(400).json({ success: false, error: '请先勾选需要纳入 Meta 分析的 PDF' });
        return;
      }

      appendProgressLog(`收到 Meta AI 请求：${pdfIds.length} 篇 PDF，正在读取 Meta 编码表。`);
      const dataset = await loadFlattenedDataset(options, userId, pdfIds);
      if (dataset.rows.length === 0) {
        res.status(404).json({ success: false, error: '未找到可分析的 Meta 整合数据行，请先完成 PDF Meta 数据提取' });
        return;
      }

      appendProgressLog(`已合并 Excel 副本：${dataset.tables.length} 个 sheet，${dataset.rows.length} 行，${dataset.columns.length} 列。`);
      const variables = inferVariables(dataset);
      appendProgressLog(`已完成列统计：识别 ${variables.length} 个表头，包含类型、缺失率、唯一值和样例值。`);
      const candidateOutcomes = inferCandidateOutcomes(dataset);
      appendProgressLog(`已预检效应量字段：候选因变量 ${candidateOutcomes.length} 个。`);
      const studyIdColumn = pickExistingColumn(dataset.columns, STUDY_ID_CANDIDATES) || 'Study#';
      const moderatorCandidates = inferModeratorCandidates(variables, candidateOutcomes);
      const manualReviewColumn = pickExistingColumn(dataset.columns, ['needs_manual_review', 'needsManualReview', '需人工复核', '人工复核']);
      appendProgressLog(`已筛选自变量候选：调节/亚组候选 ${moderatorCandidates.length} 个。`);
      const recommendedModerators = moderatorCandidates
        .filter(item => moderatorPreferenceScore(item.name) > 0)
        .slice(0, 6)
        .map(item => item.name);
      const subgroupColumns = moderatorCandidates
        .filter(item => moderatorPreferenceScore(item.name) > 0)
        .filter(item => item.type === 'categorical' || item.uniqueCount <= 8)
        .slice(0, 4)
        .map(item => item.name);
      const recommendedConfig: Required<MetaRunConfig> = {
        model: 'random',
        method: 'REML',
        studyIdColumn,
        clusterBy: studyIdColumn,
        moderatorColumns: recommendedModerators,
        subgroupColumns,
        columnPreprocess: [],
        minCompleteRows: 2,
        controlRules: [],
        excludeManualReview: true,
        manualReviewColumn,
        outcomes: candidateOutcomes.map(candidate => ({
          id: candidate.id,
          label: candidate.label,
          measure: candidate.measure,
          ...candidate.mapping,
          moderators: recommendedModerators,
          direction: 1,
        })),
      };
      const warnings = buildInspectionWarnings(dataset, candidateOutcomes);
      const workspace = await saveMetaAnalysisAssistantWorkspace(userId, pdfIds, dataset, {
        conversationId,
        variables,
        candidateOutcomes,
        moderatorCandidates,
        recommendedConfig,
        warnings,
      });
      if (writingConversationId) {
        await invalidateMetaAnalysisConversationContext(
          userId,
          writingConversationId,
          pdfIds,
          buildMetaDatasetFingerprint(dataset, pdfIds),
          'Meta AI 已生成新的数据副本，需确认并重新运行后才能用于写作。',
          workspace.id,
        );
      }
      appendProgressLog(`已把 Excel 编码表转换为 JSON 数据包：${workspace.excelJsonPath || '已生成内存数据包'}。`);
      const input: MetaAnalysisAssistantInput = {
        userId,
        pdfIds,
        conversationId,
        writingConversationId,
        confirmedByUser,
        forceProvider,
        query,
        chatHistory,
        recentUserQueries,
        workspace,
        excelJsonPacket: workspace.excelJsonPacket,
        variables,
        candidateOutcomes,
        moderatorCandidates,
        recommendedConfig,
        warnings,
      };

      let result: MetaAnalysisAssistantResult | null = null;
      const assistantWarnings: string[] = [];
      if (options.generateAiPlan) {
        try {
          appendProgressLog('正在调用 AI 判断列角色、CK/control、treatment 和副本整理方案。');
          result = sanitizeMetaAssistantResult(await options.generateAiPlan(input), input);
          appendProgressLog(`AI 已返回数据理解结果：${result.provider || 'unknown'}。`);
        } catch (error) {
          const message = (error as Error).message || String(error);
          assistantWarnings.push(`AI 规划链路失败，已使用本地规则兜底：${message}`);
          logger.warn('[MetaAnalysis] AI assistant plan failed, using local fallback:', error);
        }
      }
      if (!result) {
        appendProgressLog('正在使用本地规则兜底生成列角色判断。');
        result = buildLocalMetaAssistantPlan(input);
      }

      result.warnings = Array.from(new Set([...(result.warnings || []), ...assistantWarnings]));
      result.progressLogs = Array.from(new Set([...(result.progressLogs || []), ...progressLogs]));
      result.conversationId = conversationId;
      result = applyMetaAssistantConfirmationState(result, input);
      if (input.confirmedByUser) {
        try {
          appendProgressLog('用户已确认规则，正在执行副本整理、自动配对和 mean-only 效应量计算。');
          const prepared = await prepareMetaAssistantConfirmedDataset(input, result);
          if (prepared && prepared.config.outcomes.length > 0) {
            const autoRun = await runMetaAnalysisOnDataset(userId, prepared.dataset, prepared.config, prepared.info, {
              conversationId: input.writingConversationId || input.conversationId,
              workspaceId: input.workspace.id,
              sourcePdfIds: input.pdfIds,
            });
            result = {
              ...result,
              workflowStage: 'analysis_completed',
              suggestedConfig: autoRun.config,
              autoPreparedDataset: prepared.info,
              autoRun,
              assistantMessage: `${result.assistantMessage || '已进入可分析阶段。'}\n\n已自动整理副本并完成 Meta 分析：生成 ${autoRun.effectRows.length} 个有效效应量，跳过 ${autoRun.skippedCount} 个候选组合；下一步将调用本机 R 插件出图。`,
              progressLogs: Array.from(new Set([...(result.progressLogs || []), '已执行副本整理并完成 Meta 分析。'])),
              questions: [],
            };
          } else {
            result.warnings = Array.from(new Set([...(result.warnings || []), '已确认规则，但自动副本整理没有生成有效配对；请检查处理列、对照标签和均值列。']));
          }
        } catch (error) {
          const message = (error as Error).message || String(error);
          logger.warn('[MetaAnalysis] Auto prepare/run after AI confirmation failed:', error);
          result.warnings = Array.from(new Set([...(result.warnings || []), `自动执行副本整理/Meta 分析失败：${message}`]));
          result.progressLogs = Array.from(new Set([...(result.progressLogs || []), `自动执行失败：${message}`]));
        }
      }
      res.json({
        success: true,
        data: {
          conversationId,
          workspace: {
            ...workspace,
            excelJsonPacket: undefined,
          },
          excelJsonSummary: workspace.excelJsonSummary,
          progressLogs: result.progressLogs,
          ...result,
        },
      });
    } catch (error) {
      logger.error('[MetaAnalysis] AI assistant plan failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || 'Meta AI 分析助手失败' });
    }
  });

  router.post('/run', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      await rememberMetaAnalysisActiveUser(userId);
      const pdfIds = normalizeStringArray(req.body?.pdfIds);
      if (pdfIds.length === 0) {
        res.status(400).json({ success: false, error: '请先勾选需要纳入 Meta 分析的 PDF' });
        return;
      }

      const dataset = await loadFlattenedDataset(options, userId, pdfIds);
      if (dataset.rows.length === 0) {
        res.status(404).json({ success: false, error: '未找到可分析的 Meta 整合数据行，请先完成 PDF Meta 数据提取' });
        return;
      }

      const inferred = inferCandidateOutcomes(dataset);
      const config = normalizeRunConfig(req.body?.config, dataset, inferred);
      if (config.outcomes.length === 0) {
        res.status(400).json({ success: false, error: '没有可用的效应量配置，请先选择处理组/对照组的均值、SD 和 n 字段' });
        return;
      }

      const runResult = await runMetaAnalysisOnDataset(userId, dataset, config, undefined, {
        conversationId: normalizeMetaScopeId(req.body?.conversationId),
        workspaceId: normalizeMetaScopeId(req.body?.workspaceId),
        sourcePdfIds: pdfIds,
      });
      if (runResult.effectRows.length === 0) {
        res.status(400).json({
          success: false,
          error: '没有生成任何有效效应量。标准模式请检查均值、SD、n 字段映射；无 SD/SE 时可选择 mean-only lnRR/MD，只需要处理组和对照组均值。lnRR 要求两组均值均大于 0。',
          data: {
            skippedRows: runResult.skippedRows.slice(0, 50),
            skippedCount: runResult.skippedCount,
          },
        });
        return;
      }

      res.json({
        success: true,
        data: runResult,
      });
    } catch (error) {
      logger.error('[MetaAnalysis] Run failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || 'Meta 分析运行失败' });
    }
  });

  router.get('/writing-context', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const analysisId = normalizeMetaScopeId(req.query.analysisId);
      const conversationId = normalizeMetaScopeId(req.query.conversationId);
      const context = getMetaAnalysisWritingContextForUser(userId, {
        analysisId,
        conversationId,
        allowLegacyFallback: !analysisId && !conversationId,
      });
      if (!context) {
        res.status(404).json({
          success: false,
          error: conversationId
            ? '当前会话还没有已完成的 Meta 分析结果；不会自动挂载其他会话的旧结果。'
            : '未找到已运行的 Meta 分析结果，请先在 Meta 分析向导中点击“运行Meta分析”。',
        });
        return;
      }
      res.json({ success: true, data: context });
    } catch (error) {
      logger.error('[MetaAnalysis] Writing context read failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || '读取 Meta 分析写作上下文失败' });
    }
  });

  router.get('/writing-context/effect-sizes.csv', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const analysisId = normalizeMetaScopeId(req.query.analysisId);
      const conversationId = normalizeMetaScopeId(req.query.conversationId);
      const context = getMetaAnalysisWritingContextForUser(userId, {
        analysisId,
        conversationId,
        allowLegacyFallback: !analysisId && !conversationId,
      });
      if (!context) {
        res.status(404).send('Meta analysis writing context not found');
        return;
      }
      const filename = context.effectRowsFilename || 'meta_effect_sizes.csv';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(context.effectRowsCsv || '');
    } catch (error) {
      res.status(500).send((error as Error).message || 'export failed');
    }
  });

  router.post('/r-artifacts', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(req.body?.userId || 'web-user');
      await rememberMetaAnalysisActiveUser(userId);
      const analysisId = normalizeMetaScopeId(req.body?.analysisId);
      const conversationId = normalizeMetaScopeId(req.body?.conversationId);
      const context = getMetaAnalysisWritingContextForUser(userId, {
        analysisId,
        conversationId,
        allowLegacyFallback: !analysisId && !conversationId,
      });
      if (!context) {
        res.status(404).json({ success: false, error: '未找到可更新的 Meta 分析结果，请先运行 Meta 分析。' });
        return;
      }
      const artifacts: MetaAnalysisRArtifacts = {
        generatedAt: new Date().toISOString(),
        markdown: stringifyCell(req.body?.markdown),
        jobId: stringifyCell(req.body?.jobId),
        files: Array.isArray(req.body?.files) ? req.body.files : [],
        imageFiles: Array.isArray(req.body?.imageFiles) ? req.body.imageFiles : [],
        supportFiles: Array.isArray(req.body?.supportFiles) ? req.body.supportFiles : [],
        workDir: stringifyCell(req.body?.workDir),
        plotDir: stringifyCell(req.body?.plotDir),
      };
      const nextContext: MetaAnalysisWritingContext = {
        ...context,
        generatedAt: new Date().toISOString(),
        rArtifacts: artifacts,
      };
      nextContext.contextMarkdown = buildMetaAnalysisWritingContextMarkdown(nextContext);
      await saveMetaAnalysisWritingContext(userId, nextContext);
      res.json({ success: true, data: { generatedAt: nextContext.generatedAt, rArtifacts: artifacts } });
    } catch (error) {
      logger.error('[MetaAnalysis] R artifacts update failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || '更新 Meta 分析 R 图表上下文失败' });
    }
  });

  return router;
}

async function runMetaAnalysisOnDataset(
  userId: string,
  dataset: FlattenedDataset,
  config: Required<MetaRunConfig>,
  preparedDataset?: MetaAnalysisPreparedDatasetInfo,
  scope: MetaAnalysisRunScope = {},
): Promise<MetaAnalysisRunData> {
  const analysisId = normalizeMetaScopeId(scope.analysisId, `meta_run_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`);
  const conversationId = normalizeMetaScopeId(scope.conversationId);
  const workspaceId = normalizeMetaScopeId(scope.workspaceId);
  const sourcePdfIds = normalizeStringArray(scope.sourcePdfIds);
  const datasetFingerprint = buildMetaDatasetFingerprint(dataset, sourcePdfIds);
  const effectBuild = buildEffectRows(dataset, config);
  const summaries = summarizeEffects(effectBuild.effectRows);
  const subgroups = summarizeSubgroups(effectBuild.effectRows, config.subgroupColumns);
  const quality = buildRunQualityReport(dataset, effectBuild.effectRows, effectBuild.skippedRows, config);
  const csv = buildEffectRowsCsv(effectBuild.effectRows);
  const rCode = buildMetaAnalysisRCode(config, effectBuild.effectRows);
  const markdown = buildRunMarkdown(dataset, effectBuild.effectRows, effectBuild.skippedRows, summaries, subgroups, quality, config);
  const runData: MetaAnalysisRunData = {
    analysisId,
    conversationId: conversationId || undefined,
    workspaceId: workspaceId || undefined,
    sourcePdfIds,
    datasetFingerprint,
    dataset: {
      pdfCount: dataset.pdfCount,
      tableCount: dataset.tables.length,
      rowCount: dataset.rows.length,
      columnCount: dataset.columns.length,
    },
    config,
    effectRows: effectBuild.effectRows,
    skippedRows: effectBuild.skippedRows.slice(0, 200),
    skippedCount: effectBuild.skippedRows.length,
    summaries,
    subgroups,
    quality,
    markdown,
    rCode,
    effectRowsCsv: csv,
    effectRowsFilename: 'meta_effect_sizes.csv',
    preparedDataset,
  };
  if (effectBuild.effectRows.length > 0) {
    const writingContext = buildMetaAnalysisWritingContext(userId, runData);
    await saveMetaAnalysisWritingContext(userId, writingContext);
  }
  return runData;
}

function getMetaAnalysisWritingContextDir(userId: string): string {
  return path.join(getUserUploadDir(sanitizeUserId(userId)), 'meta-analysis');
}

function getMetaAnalysisWritingContextPath(userId: string): string {
  return path.join(getMetaAnalysisWritingContextDir(userId), 'writing-context.json');
}

function getMetaAnalysisRunContextPath(userId: string, analysisId: string): string {
  return path.join(getMetaAnalysisWritingContextDir(userId), 'runs', normalizeMetaScopeId(analysisId, 'unknown'), 'writing-context.json');
}

function getMetaAnalysisConversationContextPath(userId: string, conversationId: string): string {
  return path.join(getMetaAnalysisWritingContextDir(userId), 'conversations', `${normalizeMetaScopeId(conversationId, 'unknown')}.json`);
}

function buildMetaDatasetFingerprint(dataset: FlattenedDataset, sourcePdfIds: string[]): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({
      sourcePdfIds: [...sourcePdfIds].sort(),
      columns: dataset.columns,
      rows: dataset.rows,
    }))
    .digest('hex');
}

async function invalidateMetaAnalysisConversationContext(
  userId: string,
  conversationId: string,
  sourcePdfIds: string[],
  datasetFingerprint: string,
  reason: string,
  workspaceId?: string,
): Promise<void> {
  const conversationPath = getMetaAnalysisConversationContextPath(userId, conversationId);
  const latestPath = getMetaAnalysisWritingContextPath(userId);
  const sourcePath = fs.existsSync(conversationPath)
    ? conversationPath
    : (fs.existsSync(latestPath) ? latestPath : '');
  if (!sourcePath) return;
  try {
    const parsed = normalizeStoredMetaAnalysisWritingContext(
      JSON.parse(await fs.promises.readFile(sourcePath, 'utf-8')) as MetaAnalysisWritingContext,
      userId,
    );
    const currentPdfIds = [...parsed.sourcePdfIds].sort();
    const nextPdfIds = [...sourcePdfIds].sort();
    if (parsed.datasetFingerprint === datasetFingerprint && JSON.stringify(currentPdfIds) === JSON.stringify(nextPdfIds)) return;
    const staleContext: MetaAnalysisWritingContext = {
      ...parsed,
      available: false,
      status: 'stale',
      staleReason: reason,
      supersededByWorkspaceId: normalizeMetaScopeId(workspaceId) || undefined,
    };
    const runArchivePath = getMetaAnalysisRunContextPath(userId, parsed.analysisId);
    if (!fs.existsSync(runArchivePath)) {
      await fs.promises.mkdir(path.dirname(runArchivePath), { recursive: true });
      await fs.promises.writeFile(runArchivePath, JSON.stringify(parsed, null, 2), 'utf-8');
    }
    await fs.promises.mkdir(path.dirname(conversationPath), { recursive: true });
    await fs.promises.writeFile(conversationPath, JSON.stringify({
      ...staleContext,
      conversationId,
    }, null, 2), 'utf-8');
    if (fs.existsSync(latestPath)) {
      const latest = normalizeStoredMetaAnalysisWritingContext(
        JSON.parse(await fs.promises.readFile(latestPath, 'utf-8')) as MetaAnalysisWritingContext,
        userId,
      );
      if (latest.analysisId === parsed.analysisId) {
        await fs.promises.writeFile(latestPath, JSON.stringify(staleContext, null, 2), 'utf-8');
      }
    }
  } catch (error) {
    logger.warn('[MetaAnalysis] Failed to invalidate stale conversation context:', error);
  }
}

async function saveMetaAnalysisWritingContext(userId: string, context: MetaAnalysisWritingContext): Promise<void> {
  const dir = getMetaAnalysisWritingContextDir(userId);
  await fs.promises.mkdir(dir, { recursive: true });
  const serialized = JSON.stringify(context, null, 2);
  const paths = [getMetaAnalysisWritingContextPath(userId)];
  if (context.analysisId) paths.push(getMetaAnalysisRunContextPath(userId, context.analysisId));
  if (context.conversationId) paths.push(getMetaAnalysisConversationContextPath(userId, context.conversationId));
  for (const filePath of Array.from(new Set(paths))) {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, serialized, 'utf-8');
  }
}

export function getMetaAnalysisWritingContextForUser(
  userId: string,
  lookup: MetaWritingContextLookup = {},
): MetaAnalysisWritingContext | null {
  try {
    const analysisId = normalizeMetaScopeId(lookup.analysisId);
    const conversationId = normalizeMetaScopeId(lookup.conversationId);
    const candidatePaths = [
      analysisId ? getMetaAnalysisRunContextPath(userId, analysisId) : '',
      conversationId ? getMetaAnalysisConversationContextPath(userId, conversationId) : '',
      (!analysisId && !conversationId) || lookup.allowLegacyFallback ? getMetaAnalysisWritingContextPath(userId) : '',
    ].filter(Boolean);
    const filePath = candidatePaths.find(candidate => fs.existsSync(candidate));
    if (!filePath) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as MetaAnalysisWritingContext;
    if (!parsed || parsed.source !== 'meta-analysis-writing-context' || !parsed.available) return null;
    return normalizeStoredMetaAnalysisWritingContext(parsed, userId);
  } catch (error) {
    logger.warn('[MetaAnalysis] Failed to read writing context:', error);
    return null;
  }
}

function normalizeStoredMetaAnalysisWritingContext(
  context: MetaAnalysisWritingContext,
  userId: string,
): MetaAnalysisWritingContext {
  const generatedAt = stringifyCell(context.generatedAt) || new Date(0).toISOString();
  const legacyHash = crypto
    .createHash('sha1')
    .update(`${sanitizeUserId(userId)}|${generatedAt}|${context.effectRows?.length || 0}`)
    .digest('hex')
    .slice(0, 12);
  const effectRows = (context.effectRows || []).map(row => ({
    ...row,
    cluster_id: stringifyCell(row.cluster_id || row.study_id),
    contrast_id: stringifyCell(row.contrast_id) || 'legacy_default',
    contrast_label: stringifyCell(row.contrast_label) || '历史默认对照',
  }));
  return {
    ...context,
    analysisId: normalizeMetaScopeId(context.analysisId, `legacy_${legacyHash}`),
    conversationId: normalizeMetaScopeId(context.conversationId) || undefined,
    workspaceId: normalizeMetaScopeId(context.workspaceId) || undefined,
    userId: sanitizeUserId(context.userId || userId),
    datasetFingerprint: stringifyCell(context.datasetFingerprint) || `legacy_${legacyHash}`,
    config: {
      ...context.config,
      controlRules: Array.isArray(context.config?.controlRules) ? context.config.controlRules : [],
      excludeManualReview: context.config?.excludeManualReview === true,
      manualReviewColumn: stringifyCell(context.config?.manualReviewColumn),
    },
    effectRows,
    sourcePdfIds: normalizeStringArray(context.sourcePdfIds).length
      ? normalizeStringArray(context.sourcePdfIds)
      : Array.from(new Set(effectRows.map(row => stringifyCell(row.pdf_id)).filter(Boolean))),
  };
}

function buildMetaAnalysisWritingContext(
  userId: string,
  runData: {
    analysisId: string;
    conversationId?: string;
    workspaceId?: string;
    sourcePdfIds: string[];
    datasetFingerprint: string;
    dataset: MetaAnalysisWritingContext['dataset'];
    config: Required<MetaRunConfig>;
    effectRows: EffectRow[];
    skippedRows: SkippedEffectRow[];
    skippedCount: number;
    summaries: MetaSummary[];
    subgroups: MetaSubgroupSummary[];
    quality: MetaAnalysisWritingContext['quality'];
    markdown: string;
    effectRowsCsv: string;
    effectRowsFilename: string;
  },
): MetaAnalysisWritingContext {
  const safeUserId = sanitizeUserId(userId);
  const scopeParams = new URLSearchParams({ userId: safeUserId, analysisId: runData.analysisId });
  if (runData.conversationId) scopeParams.set('conversationId', runData.conversationId);
  const context: MetaAnalysisWritingContext = {
    analysisId: runData.analysisId,
    conversationId: runData.conversationId,
    workspaceId: runData.workspaceId,
    userId: safeUserId,
    sourcePdfIds: runData.sourcePdfIds,
    datasetFingerprint: runData.datasetFingerprint,
    generatedAt: new Date().toISOString(),
    source: 'meta-analysis-writing-context',
    available: true,
    status: 'completed',
    dataset: runData.dataset,
    config: runData.config,
    summaries: runData.summaries,
    subgroups: runData.subgroups,
    quality: runData.quality,
    effectRows: runData.effectRows,
    skippedRows: runData.skippedRows,
    skippedCount: runData.skippedCount,
    markdown: runData.markdown,
    exports: {
      writingContextUrl: `/api/meta-analysis/writing-context?${scopeParams.toString()}`,
      effectSizesCsvUrl: `/api/meta-analysis/writing-context/effect-sizes.csv?${scopeParams.toString()}`,
    },
    effectRowsCsv: runData.effectRowsCsv,
    effectRowsFilename: runData.effectRowsFilename,
    contextMarkdown: '',
  };
  context.contextMarkdown = buildMetaAnalysisWritingContextMarkdown(context);
  return context;
}

function buildMetaAnalysisWritingContextMarkdown(context: MetaAnalysisWritingContext): string {
  const effectRowsForPrompt = context.effectRows.length > 1000
    ? context.effectRows.slice(0, 1000)
    : context.effectRows;
  const skippedForPrompt = context.skippedRows.length > 200
    ? context.skippedRows.slice(0, 200)
    : context.skippedRows;

  return [
    '# Meta 分析写作上下文',
    '',
    `下面内容来自分析运行 ${context.analysisId}${context.conversationId ? `，绑定会话 ${context.conversationId}` : ''}。它是已经计算好的 Meta 分析结果，不是 PDF 原始编码表，也不是未分析的原始数据。写作时只能使用这里的效应量、模型汇总、质量检查、跳过原因和 R 图表产物；不要编造未出现在本上下文中的效应量、I²、tau²、p 值、图件或研究数量。`,
    '',
    '## 调用规则',
    '- “Meta 分析运行摘要”是用户已经运行出的分析结果，可直接用于结果写作。',
    '- “已计算效应量表”中的 yi、vi、sei、weight 是分析后的效应量数据，不是原始均值/SD/n 编码表。',
    '- 如果需要完整效应量表，使用导出接口中的 effectSizesCsvUrl；不要要求用户重新上传原始数据。',
    '- R 图表文件只有在用户点击“执行R出图”成功后才可引用；未生成时只说明 R 脚本已准备好。',
    '- mean-only 结果使用研究/聚类内等权汇总和研究级 bootstrap；不得写成常规 REML 逆方差 Meta，也不得引用 I²、tau²、Egger 或漏斗图结论。',
    '',
    '## 分析版本',
    '```json',
    JSON.stringify({
      analysisId: context.analysisId,
      conversationId: context.conversationId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      sourcePdfIds: context.sourcePdfIds,
      generatedAt: context.generatedAt,
    }, null, 2),
    '```',
    '',
    '## 数据集摘要',
    '```json',
    JSON.stringify(context.dataset, null, 2),
    '```',
    '',
    '## Meta 分析运行摘要',
    context.markdown || '暂无运行摘要。',
    '',
    '## 模型配置',
    '```json',
    JSON.stringify(context.config, null, 2),
    '```',
    '',
    '## 效应量汇总 summaries',
    '```json',
    JSON.stringify(context.summaries, null, 2),
    '```',
    '',
    '## 亚组分析 subgroups',
    '```json',
    JSON.stringify(context.subgroups, null, 2),
    '```',
    '',
    '## 质量检查 quality',
    '```json',
    JSON.stringify(context.quality, null, 2),
    '```',
    '',
    `## 已计算效应量表 effectRows（${context.effectRows.length} 行${context.effectRows.length > effectRowsForPrompt.length ? `，下方展示前 ${effectRowsForPrompt.length} 行` : ''}）`,
    '```json',
    JSON.stringify(effectRowsForPrompt, null, 2),
    '```',
    '',
    `## 跳过原因 skippedRows（${context.skippedCount} 个${context.skippedRows.length > skippedForPrompt.length ? `，下方展示前 ${skippedForPrompt.length} 个` : ''}）`,
    '```json',
    JSON.stringify(skippedForPrompt, null, 2),
    '```',
    '',
    '## R 图表产物',
    context.rArtifacts
      ? [
          `- 生成时间：${context.rArtifacts.generatedAt}`,
          `- Job ID：${context.rArtifacts.jobId || 'unknown'}`,
          `- 图片文件数：${Array.isArray(context.rArtifacts.imageFiles) ? context.rArtifacts.imageFiles.length : 0}`,
          `- 支持文件数：${Array.isArray(context.rArtifacts.supportFiles) ? context.rArtifacts.supportFiles.length : 0}`,
          context.rArtifacts.markdown || '',
        ].filter(Boolean).join('\n')
      : '- 用户尚未成功执行 R 出图；当前仅有 Meta 分析结果、效应量 CSV 和 R 脚本。',
    '',
    '## 导出接口',
    `- 写作上下文 JSON: ${context.exports.writingContextUrl}`,
    `- 已计算效应量 CSV: ${context.exports.effectSizesCsvUrl}`,
  ].join('\n');
}

async function loadFlattenedDataset(
  options: CreateMetaAnalysisRouterOptions,
  userId: string,
  pdfIds: string[],
): Promise<FlattenedDataset> {
  const tables = await options.getIntegratedDataTablesForExport(userId, pdfIds);
  return flattenIntegratedTables(tables);
}

function flattenIntegratedTables(tables: MetaAnalysisIntegratedDataTable[]): FlattenedDataset {
  const rows: Array<Record<string, unknown>> = [];
  const columns = new Set<string>();
  const pdfIds = new Set<string>();

  for (const table of tables) {
    if (table.isPlaceholder) continue;
    pdfIds.add(table.pdfId);
    for (const column of table.columns || []) columns.add(column);
    columns.add('PDF ID');
    columns.add('PDF标题');
    columns.add('PDF文件名');

    (table.rows || []).forEach((row, index) => {
      const merged: Record<string, unknown> = {
        ...row,
        'PDF ID': firstNonEmpty(row['PDF ID'], row.PDFID, table.pdfId),
        PDF标题: firstNonEmpty(row.PDF标题, row['Study#'], table.pdfTitle),
        PDF文件名: firstNonEmpty(row.PDF文件名, table.pdfName),
        _table_id: table.id,
        _row_index: index + 1,
      };
      Object.keys(merged).forEach(column => columns.add(column));
      rows.push(merged);
    });
  }

  return {
    tables,
    rows,
    columns: Array.from(columns),
    pdfCount: pdfIds.size,
  };
}

function inferVariables(dataset: FlattenedDataset): MetaVariable[] {
  return dataset.columns.map(column => {
    const rawValues = dataset.rows.map(row => row[column]);
    const nonMissingValues = rawValues.filter(value => !isBlank(value));
    const numericValues = nonMissingValues
      .map(value => parseNumeric(value))
      .filter((value): value is number => Number.isFinite(value));
    const sampleValues = Array.from(new Set(nonMissingValues.map(value => stringifyCell(value)).filter(Boolean))).slice(0, 6);
    const uniqueCount = new Set(nonMissingValues.map(value => stringifyCell(value))).size;
    const numericRatio = nonMissingValues.length > 0 ? numericValues.length / nonMissingValues.length : 0;
    const type: VariableType = nonMissingValues.length === 0
      ? 'empty'
      : (numericRatio >= 0.75 ? 'numeric' : 'categorical');

    return {
      name: column,
      type,
      nonMissingCount: nonMissingValues.length,
      missingCount: rawValues.length - nonMissingValues.length,
      numericCount: numericValues.length,
      uniqueCount,
      sampleValues,
    };
  });
}

function inferCandidateOutcomes(dataset: FlattenedDataset): CandidateOutcome[] {
  const bucket = new Map<string, Partial<MetaOutcomeMapping> & { rawPrefix: string }>();

  for (const column of dataset.columns) {
    const match = matchStatColumn(column);
    if (!match) continue;
    const existing = bucket.get(match.prefix) || { rawPrefix: match.rawPrefix };
    existing[match.role] = column;
    bucket.set(match.prefix, existing);
  }

  const candidates: CandidateOutcome[] = [];
  for (const [prefix, mapping] of bucket.entries()) {
    if (!hasCompleteMapping(mapping)) continue;
    const cleanMapping = mapping as MetaOutcomeMapping;
    const completeRows = dataset.rows.filter(row => hasCompleteOutcomeValues(row, cleanMapping, 'MD')).length;
    const positiveRows = dataset.rows.filter(row => hasCompleteOutcomeValues(row, cleanMapping, 'lnRR')).length;
    const label = normalizeOutcomeLabel(mapping.rawPrefix || prefix);
    const warnings: string[] = [];
    if (completeRows < 3) warnings.push('完整均值/SD/n 行数少于 3，Meta 模型稳定性不足');
    if (positiveRows < completeRows) warnings.push('部分行均值非正，lnRR 会自动跳过这些行');

    candidates.push({
      id: normalizeOutcomeId(prefix),
      label,
      measure: positiveRows >= Math.max(3, Math.ceil(completeRows * 0.8)) ? 'lnRR' : 'SMD',
      mapping: cleanMapping,
      completeRows,
      totalRows: dataset.rows.length,
      warnings,
    });
  }

  return candidates.sort((a, b) => b.completeRows - a.completeRows || a.label.localeCompare(b.label, 'zh-CN'));
}

function matchStatColumn(column: string): { prefix: string; rawPrefix: string; role: keyof MetaOutcomeMapping } | null {
  const normalized = normalizeColumnForMatching(column);
  for (const role of STAT_ROLE_KEYS) {
    for (const suffix of STAT_SUFFIXES[role]) {
      if (!normalized.endsWith(suffix)) continue;
      const rawPrefix = column.slice(0, Math.max(0, column.length - suffix.length)).replace(/[_\s-]+$/g, '');
      const normalizedPrefix = normalized.slice(0, normalized.length - suffix.length).replace(/[_\s-]+$/g, '');
      if (!normalizedPrefix) continue;
      return {
        prefix: normalizedPrefix,
        rawPrefix: rawPrefix || normalizedPrefix,
        role,
      };
    }
  }
  return null;
}

function hasCompleteMapping(mapping: Partial<MetaOutcomeMapping>): mapping is MetaOutcomeMapping {
  return STAT_ROLE_KEYS.every(role => typeof mapping[role] === 'string' && !!String(mapping[role]).trim());
}

function inferModeratorCandidates(variables: MetaVariable[], outcomes: CandidateOutcome[]): MetaVariable[] {
  const statColumns = new Set<string>();
  outcomes.forEach(outcome => {
    STAT_ROLE_KEYS.forEach(role => statColumns.add(outcome.mapping[role]));
  });

  return variables
    .filter(variable => {
      if (variable.type === 'empty') return false;
      if (statColumns.has(variable.name)) return false;
      if (TRACE_COLUMNS.has(variable.name)) return false;
      if (isMetaAnalysisStructuralVariable(variable.name)) return false;
      if (/证据|原文|abstract|全文|标题|filename|file|pdf/i.test(variable.name)) return false;
      if (/mean|sd|se|sem|n$|_n$|ck|control|treat|tmean|tsd|ckmean|cksd/i.test(variable.name)) return false;
      if (variable.nonMissingCount < 2) return false;
      if (variable.type === 'categorical') return variable.uniqueCount >= 2 && variable.uniqueCount <= Math.max(20, Math.ceil(variable.nonMissingCount * 0.7));
      return variable.uniqueCount >= 2;
    })
    .sort((a, b) => {
      const preferredA = moderatorPreferenceScore(a.name);
      const preferredB = moderatorPreferenceScore(b.name);
      if (preferredA !== preferredB) return preferredB - preferredA;
      return b.nonMissingCount - a.nonMissingCount;
    })
    .slice(0, 40);
}

function moderatorPreferenceScore(name: string): number {
  const text = name.toLowerCase();
  let score = 0;
  if (/处理|treatment|fertili|施肥|作物|crop|soil|texture|气候|climate|experiment/.test(text)) score += 5;
  if (/n input|nitrogen|减氮|period|持续|天数|temp|温|rain|precip|ph|soc|som|tn|cn|c\/n|wfps|whc|bulk|lat|long/.test(text)) score += 4;
  if (/study|obs/.test(text)) score -= 5;
  return score;
}

function isMetaAnalysisStructuralVariable(name: string): boolean {
  const compact = String(name || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
  if (!compact) return true;
  return [
    'rowindex',
    'index',
    'obs',
    'obsid',
    'study',
    'studyid',
    'pdfid',
    'id',
    '序号',
    '行号',
    '编号',
    '观测编号',
    '研究编号',
  ].includes(compact);
}

function buildInspectionWarnings(dataset: FlattenedDataset, candidates: CandidateOutcome[]): string[] {
  const warnings: string[] = [];
  if (dataset.rows.length < 3) warnings.push('整合数据行数少于 3，通常不足以完成稳健 Meta 分析。');
  if (candidates.length === 0) {
    warnings.push('未自动识别到完整的处理组/对照组均值、SD 和 n 字段，请在向导中手动映射。');
  }
  candidates.forEach(candidate => {
    candidate.warnings.forEach(warning => warnings.push(`${candidate.label}: ${warning}`));
  });
  return Array.from(new Set(warnings));
}

function normalizeMetaAssistantChatHistory(input: unknown): Array<{ role: 'user' | 'assistant'; content: string; createdAt?: string }> {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => {
      if (!isRecord(item)) return null;
      const rawRole = stringifyCell(item.role);
      const role: 'user' | 'assistant' | null = rawRole === 'assistant' ? 'assistant' : (rawRole === 'user' ? 'user' : null);
      const content = stringifyCell(item.content);
      if (!role || !content) return null;
      const createdAt = stringifyCell(item.createdAt);
      return createdAt ? { role, content, createdAt } : { role, content };
    })
    .filter((item): item is { role: 'user' | 'assistant'; content: string; createdAt?: string } => !!item)
    .slice(-10);
}

function normalizeMetaAssistantConversationId(input: unknown): string {
  const raw = stringifyCell(input).trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 96);
  if (safe.startsWith('meta_ai_chat_') && safe.length >= 24) {
    return safe;
  }
  return `meta_ai_chat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeExistingMetaAssistantConversationId(input: unknown): string {
  const raw = stringifyCell(input).trim();
  const safe = raw.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 96);
  return safe.startsWith('meta_ai_chat_') && safe.length >= 24 ? safe : '';
}

function isMetaAssistantNegativeConfirmationText(text: string): boolean {
  const compact = String(text || '').toLowerCase();
  return /(不|不要|暂不|先不|取消|别|停止|stop|cancel).{0,8}(确认|接受|同意|开始|执行|运行|分析|proceed|confirm|accept|run)/i.test(compact)
    || /(do\s+not|don't|dont|not)\s+(confirm|accept|run|proceed)/i.test(compact);
}

function isMetaAssistantConfirmationText(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw || isMetaAssistantNegativeConfirmationText(raw)) return false;
  return /(接受|确认|同意|可以|没问题|没错|按这个|按此|就这样|开始|执行|运行|进行|继续分析|开始分析|开始执行|进入分析|出图|proceed|confirm|accepted|accept|ok|okay|run)/i.test(raw)
    || /(使用|采用).{0,20}(lnRR|MD|mean_only|均值差|响应比|boot|bootstrap|配对|对照|单位|规则)/i.test(raw)
    || /(剔除|排除|纳入|保留|默认按|严格按照).{0,60}(零|无均值|Study#|Crop|Season|单位|对照|匹配|人工复核|manual.review)/i.test(raw);
}

function isMetaAssistantConversationConfirmed(
  query: string,
  _chatHistory: Array<{ role: 'user' | 'assistant'; content: string; createdAt?: string }>,
): boolean {
  return isMetaAssistantConfirmationText(query);
}

async function saveMetaAnalysisAssistantWorkspace(
  userId: string,
  pdfIds: string[],
  dataset: FlattenedDataset,
  context?: {
    conversationId?: string;
    variables: MetaVariable[];
    candidateOutcomes: CandidateOutcome[];
    moderatorCandidates: MetaVariable[];
    recommendedConfig: Required<MetaRunConfig>;
    warnings: string[];
  },
): Promise<MetaAnalysisAssistantWorkspace> {
  const workspaceId = context?.conversationId || `meta_ai_chat_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const workspaceDir = path.join(getUserUploadDir(userId), 'meta-analysis', 'ai-workspaces');
  await fs.promises.mkdir(workspaceDir, { recursive: true });
  const storagePath = path.join(workspaceDir, `${workspaceId}.json`);
  const excelJsonPath = path.join(workspaceDir, `${workspaceId}.excel-json.json`);
  const sampleRows = dataset.rows.slice(0, 20).map(row => limitMetaAssistantRow(row, dataset.columns));
  const workspace: MetaAnalysisAssistantWorkspace = {
    id: workspaceId,
    conversationId: workspaceId,
    createdAt: new Date().toISOString(),
    userId,
    sourcePdfIds: pdfIds,
    dataset: {
      pdfCount: dataset.pdfCount,
      tableCount: dataset.tables.length,
      rowCount: dataset.rows.length,
      columnCount: dataset.columns.length,
    },
    columns: dataset.columns.slice(),
    sampleRows,
    copyStoragePath: storagePath,
    excelJsonPath,
  };
  const excelJsonPacket = context
    ? buildMetaAnalysisExcelJsonPacket(workspace, dataset, context)
    : buildMetaAnalysisExcelJsonPacket(workspace, dataset, {
        variables: inferVariables(dataset),
        candidateOutcomes: inferCandidateOutcomes(dataset),
        moderatorCandidates: [],
        recommendedConfig: {
          model: 'random',
          method: 'REML',
          studyIdColumn: pickExistingColumn(dataset.columns, STUDY_ID_CANDIDATES) || 'Study#',
          clusterBy: pickExistingColumn(dataset.columns, STUDY_ID_CANDIDATES) || 'Study#',
          moderatorColumns: [],
          subgroupColumns: [],
          columnPreprocess: [],
          minCompleteRows: 2,
          controlRules: [],
          excludeManualReview: true,
          manualReviewColumn: pickExistingColumn(dataset.columns, ['needs_manual_review', 'needsManualReview', '需人工复核', '人工复核']),
          outcomes: [],
        },
        warnings: [],
      });
  workspace.excelJsonSummary = isRecord(excelJsonPacket.summary) ? excelJsonPacket.summary : undefined;
  workspace.excelJsonPacket = excelJsonPacket;

  const stored = {
    ...workspace,
    excelJsonPacket: undefined,
    source: 'meta-analysis-ai-copy-workspace',
    note: 'This is a copy-on-write workspace for AI planning. Original Meta coding tables are not modified by this file.',
    rows: dataset.rows,
    tables: dataset.tables,
  };
  await fs.promises.writeFile(storagePath, JSON.stringify(stored, null, 2), 'utf-8');
  await fs.promises.writeFile(excelJsonPath, JSON.stringify(excelJsonPacket, null, 2), 'utf-8');
  return workspace;
}

function buildMetaAnalysisExcelJsonPacket(
  workspace: MetaAnalysisAssistantWorkspace,
  dataset: FlattenedDataset,
  context: {
    variables: MetaVariable[];
    candidateOutcomes: CandidateOutcome[];
    moderatorCandidates: MetaVariable[];
    recommendedConfig: Required<MetaRunConfig>;
    warnings: string[];
  },
): Record<string, unknown> {
  const sheetSummaries = dataset.tables.slice(0, 80).map((table, index) => ({
    sheetIndex: index + 1,
    sheetId: table.id,
    sheetName: table.pdfTitle || table.pdfName || `PDF ${index + 1}`,
    pdfId: table.pdfId,
    pdfTitle: table.pdfTitle,
    pdfName: table.pdfName,
    rowCount: table.rowCount,
    realRowCount: table.realRowCount,
    columnCount: (table.columns || []).length,
    columns: (table.columns || []).slice(0, 120),
    sampleRows: (table.rows || []).slice(0, 8).map(row => limitMetaAssistantRow(row, table.columns || dataset.columns)),
  }));

  const variableByName = new Map(context.variables.map(variable => [variable.name, variable]));
  const statRoleMap = new Map<string, string[]>();
  context.candidateOutcomes.forEach(candidate => {
    STAT_ROLE_KEYS.forEach(role => {
      const column = candidate.mapping[role];
      if (!column) return;
      const roles = statRoleMap.get(column) || [];
      roles.push(`${candidate.label}:${role}`);
      statRoleMap.set(column, roles);
    });
  });
  const moderatorSet = new Set(context.moderatorCandidates.map(variable => variable.name));
  const subgroupSet = new Set(context.recommendedConfig.subgroupColumns || []);

  const columns = dataset.columns.slice(0, 240).map(column => {
    const variable = variableByName.get(column);
    const unit = extractUnitFromMetaColumnName(column);
    const candidateRoles: string[] = [];
    if (statRoleMap.has(column)) candidateRoles.push(...(statRoleMap.get(column) || []));
    if (moderatorSet.has(column)) candidateRoles.push('moderator_candidate');
    if (subgroupSet.has(column)) candidateRoles.push('subgroup_candidate');
    if (isLikelyTreatmentDescriptorColumn(column)) candidateRoles.push('treatment_descriptor_candidate');
    if (TRACE_COLUMNS.has(column)) candidateRoles.push('source_trace');
    return {
      name: column,
      unit,
      type: variable?.type || 'empty',
      nonMissingCount: variable?.nonMissingCount || 0,
      missingCount: variable?.missingCount || 0,
      numericCount: variable?.numericCount || 0,
      uniqueCount: variable?.uniqueCount || 0,
      sampleValues: variable?.sampleValues || [],
      candidateRoles,
    };
  });

  return {
    source: 'meta-analysis-excel-json-packet',
    version: 1,
    generatedAt: new Date().toISOString(),
    workspace: {
      id: workspace.id,
      userId: workspace.userId,
      sourcePdfIds: workspace.sourcePdfIds,
      copyStoragePath: workspace.copyStoragePath,
      excelJsonPath: workspace.excelJsonPath,
    },
    summary: {
      pdfCount: dataset.pdfCount,
      sheetCount: dataset.tables.length,
      rowCount: dataset.rows.length,
      columnCount: dataset.columns.length,
      candidateOutcomeCount: context.candidateOutcomes.length,
      moderatorCandidateCount: context.moderatorCandidates.length,
      warningCount: context.warnings.length,
    },
    sheets: sheetSummaries,
    columns,
    candidateOutcomes: context.candidateOutcomes.map(candidate => ({
      id: candidate.id,
      label: candidate.label,
      measure: candidate.measure,
      mapping: candidate.mapping,
      completeRows: candidate.completeRows,
      totalRows: candidate.totalRows,
      warnings: candidate.warnings,
    })),
    candidateRoles: {
      recommendedConfig: context.recommendedConfig,
      moderatorCandidates: context.moderatorCandidates.slice(0, 40),
      likelyTreatmentColumns: context.variables
        .filter(variable => isLikelyTreatmentDescriptorColumn(variable.name))
        .slice(0, 20)
        .map(variable => ({
          column: variable.name,
          type: variable.type,
          sampleValues: variable.sampleValues,
          uniqueCount: variable.uniqueCount,
        })),
    },
    sampleRows: workspace.sampleRows,
    warnings: context.warnings,
  };
}

function extractUnitFromMetaColumnName(column: string): string {
  const text = stringifyCell(column);
  const parenMatches = Array.from(text.matchAll(/[\(（]([^\)）]{1,60})[\)）]/g));
  if (parenMatches.length) {
    const candidate = stringifyCell(parenMatches[parenMatches.length - 1][1]);
    if (candidate && /[a-zA-Zµμ%°]|kg|g|mg|ha|m2|m-2|ppm|mol|d\b|day|年|天|月/.test(candidate)) return candidate;
  }
  const trailing = text.match(/(?:^|[\s_])((?:kg|g|mg|µg|ug|t|ha|m2|m-2|ppm|ppb|%|d|day|year|yr|年|天|月)[a-zA-Z0-9µμ%/ .-]{0,35})$/i);
  return trailing ? trailing[1].trim() : '';
}

function limitMetaAssistantRow(row: Record<string, unknown>, columns: string[]): Record<string, unknown> {
  const preferred = [
    'Obs#',
    'Study#',
    'PDF标题',
    'PDF文件名',
    'Treatment',
    'Control',
    'Crop',
    'Period',
    '年份',
    '处理',
    '作物',
  ];
  const selected = new Set<string>();
  preferred.forEach(column => {
    if (columns.includes(column)) selected.add(column);
  });
  columns.forEach(column => {
    if (selected.size >= 60) return;
    if (TRACE_COLUMNS.has(column) && selected.size > 20) return;
    selected.add(column);
  });

  const result: Record<string, unknown> = {};
  selected.forEach(column => {
    result[column] = shortenMetaAssistantValue(row[column]);
  });
  return result;
}

function shortenMetaAssistantValue(value: unknown): unknown {
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  const text = stringifyCell(value);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function buildLocalMetaAssistantDataUnderstanding(input: MetaAnalysisAssistantInput): Record<string, unknown> {
  const outcomes = input.recommendedConfig.outcomes || [];
  const mappedRoles = new Map<string, string[]>();
  const addMappedRole = (column: string, role: string) => {
    if (!column) return;
    const roles = mappedRoles.get(column) || [];
    if (!roles.includes(role)) roles.push(role);
    mappedRoles.set(column, roles);
  };

  outcomes.forEach(outcome => {
    addMappedRole(outcome.treatmentMean, 'treatmentMean');
    addMappedRole(outcome.treatmentSd || '', 'treatmentSd');
    addMappedRole(outcome.treatmentN || '', 'treatmentN');
    addMappedRole(outcome.controlMean, 'controlMean');
    addMappedRole(outcome.controlSd || '', 'controlSd');
    addMappedRole(outcome.controlN || '', 'controlN');
  });

  const dependentVariables = outcomes.map(outcome => ({
    label: outcome.label || outcome.id || '因变量',
    measure: outcome.measure || 'lnRR',
    columns: {
      treatmentMean: outcome.treatmentMean,
      treatmentSd: outcome.treatmentSd,
      treatmentN: outcome.treatmentN,
      controlMean: outcome.controlMean,
      controlSd: outcome.controlSd,
      controlN: outcome.controlN,
    },
    reason: '这些列形成了处理组/对照组的均值、SD 和 n 的完整效应量计算字段。',
    confidence: 0.86,
  }));

  const independentColumnMap = new Map<string, { column: string; type: string; reason: string; confidence: number }>();
  input.recommendedConfig.subgroupColumns.forEach(column => {
    independentColumnMap.set(column, {
      column,
      type: 'subgroup',
      reason: '该列水平数较少或为分类变量，适合针对合并效应量做亚组分析。',
      confidence: 0.78,
    });
  });
  input.recommendedConfig.moderatorColumns.forEach(column => {
    const existing = independentColumnMap.get(column);
    independentColumnMap.set(column, {
      column,
      type: existing ? 'subgroup_or_moderator' : 'moderator',
      reason: existing
        ? '该列既适合亚组分析，也可作为元回归/调节变量探索异质性。'
        : '该列不是均值/SD/n 字段，且具有可用于解释异质性的有效取值。',
      confidence: existing ? Math.max(existing.confidence, 0.8) : 0.72,
    });
  });

  input.variables
    .filter(variable => isLikelyTreatmentDescriptorColumn(variable.name) && variable.nonMissingCount > 0)
    .slice(0, 12)
    .forEach(variable => {
      if (!independentColumnMap.has(variable.name)) {
        independentColumnMap.set(variable.name, {
          column: variable.name,
          type: 'treatment_descriptor',
          reason: '表头或样例值显示它可能描述处理方式、对照组或试验分组。',
          confidence: 0.68,
        });
      }
    });

  const groupUnderstanding = inferMetaTreatmentControlUnderstanding(input);
  const mergeCandidates = inferMetaMergeCandidates(input, mappedRoles);
  const columnRoleMap = input.variables.slice(0, 120).map(variable => {
    const roles = mappedRoles.get(variable.name) || [];
    const independent = independentColumnMap.get(variable.name);
    const isControlColumn = groupUnderstanding.controlGroups.some(item => item.column === variable.name);
    const isTreatmentColumn = groupUnderstanding.treatmentGroups.some(item => item.column === variable.name);
    if (roles.length) {
      return {
        column: variable.name,
        role: roles.join('|'),
        reason: '该列已被识别为效应量计算字段。',
        confidence: 0.86,
      };
    }
    if (isControlColumn && isTreatmentColumn) {
      return {
        column: variable.name,
        role: 'treatment_group',
        reason: '该列同时包含 CK/对照值和其他处理水平，适合作为处理/对照分组依据。',
        confidence: 0.78,
      };
    }
    if (independent) {
      return {
        column: variable.name,
        role: independent.type,
        reason: independent.reason,
        confidence: independent.confidence,
      };
    }
    if (TRACE_COLUMNS.has(variable.name) || isMetaAnalysisStructuralVariable(variable.name)) {
      return {
        column: variable.name,
        role: 'source_or_trace',
        reason: '来源、ID 或追踪字段，通常不直接参与效应量模型。',
        confidence: 0.82,
      };
    }
    if (variable.type === 'numeric' && variable.nonMissingCount > 0 && !mappedRoles.has(variable.name)) {
      return {
        column: variable.name,
        role: 'possible_covariate',
        reason: '数值型非空字段，可能作为连续调节变量，但需要结合研究问题确认。',
        confidence: 0.48,
      };
    }
    return {
      column: variable.name,
      role: 'unclassified',
      reason: '当前样例不足以高置信判断用途。',
      confidence: 0.35,
    };
  });

  const questions: string[] = [];
  if (dependentVariables.length === 0) {
    questions.push('我还没有高置信识别出完整的因变量效应量字段，需要确认哪些列分别是均值、SD/SE 和 n。');
  }
  if (groupUnderstanding.controlGroups.length === 0) {
    questions.push('我还没有在处理分组列中找到明确的 CK/control/对照值，需要确认哪一类是对照组。');
  }
  if (mergeCandidates.length > 0) {
    questions.push('我发现部分列可能需要拆分、合并或单位换算，建议先在副本里整理后再计算效应量。');
  }

  return {
    dependentVariables,
    independentVariables: Array.from(independentColumnMap.values()).slice(0, 30),
    controlGroups: groupUnderstanding.controlGroups,
    treatmentGroups: groupUnderstanding.treatmentGroups,
    mergeCandidates,
    columnRoleMap,
    lowConfidenceQuestions: questions,
    notes: [
      '这些判断来自本地规则兜底；如果 Codex/小牛马/大牛马可用，会在此基础上结合用户需求进一步推理。',
      '字段整理和删改只应发生在副本工作区，原始 Meta 编码表不直接修改。',
    ],
  };
}

function inferMetaTreatmentControlUnderstanding(input: MetaAnalysisAssistantInput): {
  controlGroups: Array<{ column: string; values: string[]; reason: string; confidence: number }>;
  treatmentGroups: Array<{ column: string; values: string[]; reason: string; confidence: number }>;
} {
  const controlGroups: Array<{ column: string; values: string[]; reason: string; confidence: number }> = [];
  const treatmentGroups: Array<{ column: string; values: string[]; reason: string; confidence: number }> = [];

  input.variables
    .filter(variable => variable.nonMissingCount > 0)
    .filter(variable => isLikelyTreatmentDescriptorColumn(variable.name) || variable.sampleValues.some(isLikelyControlValue))
    .slice(0, 18)
    .forEach(variable => {
      const values = collectMetaColumnSampleValues(input, variable.name, 30);
      const controls = values.filter(isLikelyControlValue).slice(0, 12);
      const treatments = values
        .filter(value => !isLikelyControlValue(value))
        .filter(value => !isPlainNumericMetaText(value) || isLikelyTreatmentDescriptorColumn(variable.name))
        .slice(0, 16);
      if (controls.length) {
        controlGroups.push({
          column: variable.name,
          values: controls,
          reason: '样例值包含 CK/control/对照/blank 等对照组信号。',
          confidence: 0.82,
        });
      }
      if (treatments.length && (controls.length || isLikelyTreatmentDescriptorColumn(variable.name))) {
        treatmentGroups.push({
          column: variable.name,
          values: treatments,
          reason: controls.length
            ? '同一列除 CK/control/对照外还包含其他处理水平。'
            : '表头显示该列描述处理方式，样例值可作为 treatment 水平。',
          confidence: controls.length ? 0.78 : 0.62,
        });
      }
    });

  return {
    controlGroups: controlGroups.slice(0, 8),
    treatmentGroups: treatmentGroups.slice(0, 8),
  };
}

function inferMetaMergeCandidates(input: MetaAnalysisAssistantInput, mappedRoles: Map<string, string[]>): Array<Record<string, unknown>> {
  const candidates: Array<Record<string, unknown>> = [];
  for (const variable of input.variables) {
    const samples = collectMetaColumnSampleValues(input, variable.name, 10);
    if (samples.some(value => /[±＋]\s*[-+]?(?:\d+\.?\d*|\.\d+)/.test(value))) {
      candidates.push({
        operation: 'split_mean_sd',
        target: variable.name,
        columns: [variable.name],
        reason: '样例值包含 mean ± SD/SE 格式，均值列不能带 ± 后的离散度，需要在副本中拆成均值列和 SD/SE 列。',
        confidence: 0.9,
      });
    }
    if (/(^|[_\s(（-])se(m)?($|[_\s)）-])/i.test(variable.name)) {
      candidates.push({
        operation: 'convert_se_to_sd',
        target: variable.name.replace(/se(m)?/ig, 'SD'),
        columns: [variable.name],
        reason: '该列表头像 SE/SEM；如果样本量 n 可用，后续应按 SD = SE * sqrt(n) 换算为统一 SD。',
        confidence: 0.72,
      });
    }
  }

  input.recommendedConfig.outcomes.forEach(outcome => {
    const columns = [
      outcome.treatmentMean,
      outcome.treatmentSd,
      outcome.treatmentN,
      outcome.controlMean,
      outcome.controlSd,
      outcome.controlN,
    ].filter(Boolean);
    if (columns.length >= 6) {
      candidates.push({
        operation: 'effect_size_bundle',
        target: outcome.label || outcome.id || '因变量',
        columns,
        reason: '这些列需要作为同一个因变量的处理组/对照组效应量字段一起使用，不能分散到不同指标。',
        confidence: 0.86,
      });
    }
  });

  const mappedColumns = new Set(mappedRoles.keys());
  input.variables
    .filter(variable => variable.type === 'numeric' && !mappedColumns.has(variable.name))
    .filter(variable => /单位|unit|kg|mg|g |ha|m2|m-2|ppm|%|\(|（/i.test(variable.name))
    .slice(0, 12)
    .forEach(variable => {
      candidates.push({
        operation: 'unit_check',
        target: variable.name,
        columns: [variable.name],
        reason: '该数值列表头含单位或量纲信号，跨 PDF 合并前需要确认统一单位。',
        confidence: 0.58,
      });
    });

  return candidates.slice(0, 30);
}

interface AutoOutcomeSpec {
  key: 'N2O' | 'NO';
  id: string;
  label: string;
  treatmentMeanColumn: string;
  treatmentSdColumn: string;
  controlMeanColumn: string;
  controlSdColumn: string;
  treatmentNColumn: string;
  controlNColumn: string;
}

async function prepareMetaAssistantConfirmedDataset(
  input: MetaAnalysisAssistantInput,
  result: MetaAnalysisAssistantResult,
): Promise<{ dataset: FlattenedDataset; config: Required<MetaRunConfig>; info: MetaAnalysisPreparedDatasetInfo } | null> {
  const sourceDataset = await loadMetaAssistantWorkspaceDataset(input.workspace);
  if (!sourceDataset || sourceDataset.rows.length === 0) return null;

  const studyIdColumn = pickExistingColumn(sourceDataset.columns, [input.recommendedConfig.studyIdColumn, ...STUDY_ID_CANDIDATES]) || 'Study#';
  const treatmentColumn = pickExistingColumn(sourceDataset.columns, ['Treatment (%)', 'Treatment', '处理', '处理组', '处理名称', 'treatment', 'Group', 'group']);
  const nInputColumn = pickExistingColumn(sourceDataset.columns, ['N input (kg N ha-1)', 'N input', '施氮量', '施氮量 (kg N ha-1)']);
  const cropColumn = pickExistingColumn(sourceDataset.columns, ['Crop', '作物', '作物类型']);
  const seasonColumn = pickExistingColumn(sourceDataset.columns, ['Season', '季节', 'season']);
  const matchColumns = [studyIdColumn, cropColumn, seasonColumn].filter(Boolean);
  const specs = buildAutoOutcomeSpecs();
  const suggestedConfig = result.suggestedConfig || {};
  const controlRules = normalizeMetaControlRules(suggestedConfig.controlRules, sourceDataset.columns);
  const manualReviewColumn = pickExistingColumn(sourceDataset.columns, [
    stringifyCell(suggestedConfig.manualReviewColumn),
    stringifyCell(input.recommendedConfig.manualReviewColumn),
    'needs_manual_review',
    'needsManualReview',
    '需人工复核',
    '人工复核',
  ]);
  const excludeManualReview = suggestedConfig.excludeManualReview === undefined
    ? !/(保留|纳入|include|keep).{0,20}(needs_manual_review|manual review|人工复核)/i.test(input.query)
    : suggestedConfig.excludeManualReview !== false;
  const measureByOutcome = new Map(specs.map(spec => [spec.key, resolveAutoOutcomeMeasure(spec, result, input)]));
  specs.forEach(spec => {
    const measure = measureByOutcome.get(spec.key);
    if (measure !== 'MD' && measure !== 'MD_mean_only') return;
    const units = collectAutoOutcomeUnits(sourceDataset, spec.key);
    if (units.length > 1) {
      throw new Error(
        `${spec.label} 选择了 ${measure}，但检测到多个单位（${units.slice(0, 8).join('、')}）。请先统一单位，或改用均值均为正时的 lnRR。`,
      );
    }
  });
  const notes = [
    '自动副本整理规则：不修改原始 Meta 编码表，只生成会话副本。',
    controlRules.length > 0
      ? `对照匹配规则：使用 ${controlRules.length} 条已确认 contrast 规则，并按规则指定字段配对。`
      : '对照匹配规则：优先使用逐行 control_for_contrast；否则按 Study# + Crop + Season 匹配 CK/Control/N0/F0/0N 行。',
    `用户确认的效应量：${Array.from(new Set(measureByOutcome.values())).join('、')}。lnRR 仅剔除非正均值，MD 保留零值和负值。`,
    excludeManualReview && manualReviewColumn
      ? `主分析排除 ${manualReviewColumn}=true 的待人工复核行。`
      : '待人工复核行未被自动排除；结果中保留数据质量警告。',
  ];

  const explicitControlLabels = new Set(
    sourceDataset.rows
      .map(row => stringifyCell(row.control_for_contrast || row.controlForContrast || row['control for contrast']).toLowerCase())
      .filter(Boolean),
  );
  controlRules.forEach(rule => rule.controlLabels.forEach(label => explicitControlLabels.add(label.toLowerCase())));
  const controlRows = sourceDataset.rows.filter(row => isAutoMetaControlRow(
    row,
    treatmentColumn,
    nInputColumn,
    explicitControlLabels,
    controlRules,
  ));

  const preparedRows: Array<Record<string, unknown>> = [];
  let skippedCandidateCount = 0;
  let excludedManualReviewCount = 0;
  sourceDataset.rows.forEach((row, rowIndex) => {
    const treatmentLabel = stringifyCell(treatmentColumn ? row[treatmentColumn] : '');
    const requestedControlLabel = stringifyCell(row.control_for_contrast || row.controlForContrast || row['control for contrast']);
    const controlRule = selectMetaControlRule(controlRules, treatmentLabel);
    if (
      isAutoMetaControlRow(row, treatmentColumn, nInputColumn, explicitControlLabels, controlRules)
      && !controlRule
      && !requestedControlLabel
    ) return;
    if (excludeManualReview && manualReviewColumn && isMetaManualReviewRequired(row[manualReviewColumn])) {
      excludedManualReviewCount += 1;
      return;
    }
    const rowMatchColumns = Array.from(new Set([
      ...matchColumns,
      ...(controlRule?.matchColumns || []),
    ].filter(Boolean)));
    const matchKey = buildAutoMetaMatchKey(row, rowMatchColumns);
    const candidateControls = controlRows.filter(controlRow => (
      buildAutoMetaMatchKey(controlRow, rowMatchColumns) === matchKey
      && (
        !controlRule
        || metaControlRowMatchesRule(controlRow, treatmentColumn, controlRule)
        || normalizeAutoMetaKeyValue(treatmentColumn ? controlRow[treatmentColumn] : '') === normalizeAutoMetaKeyValue(requestedControlLabel)
      )
    ));
    let rowHasOutcome = false;
    const nextRow: Record<string, unknown> = {
      ...row,
      meta_ai_source_row_index: rowIndex + 1,
      meta_ai_match_key: matchKey,
      meta_ai_treatment_label: treatmentLabel,
      meta_ai_contrast_id: controlRule?.id || (requestedControlLabel ? 'row_control_for_contrast' : 'default_no_input_control'),
      meta_ai_contrast_label: controlRule?.label || requestedControlLabel || 'CK/Control/N0/F0/0N',
    };

    specs.forEach(spec => {
      const measure = measureByOutcome.get(spec.key) || 'lnRR_mean_only';
      const treatmentMean = pickAutoOutcomeTreatmentMean(sourceDataset.columns, row, spec.key);
      const controlRow = pickAutoControlRowForOutcome(candidateControls, row, treatmentColumn, spec.key, controlRule);
      const controlMean = pickAutoOutcomeControlMean(sourceDataset.columns, row, controlRow, spec.key);
      const treatmentN = pickAutoOutcomeN(sourceDataset.columns, row, spec.key, 'treatment');
      const controlN = pickAutoOutcomeN(sourceDataset.columns, controlRow || row, spec.key, 'control');
      const treatmentSd = pickAutoOutcomeSd(sourceDataset.columns, row, spec.key, 'treatment', treatmentN);
      const controlSd = pickAutoOutcomeSd(sourceDataset.columns, controlRow || row, spec.key, 'control', controlN);

      if (!Number.isFinite(treatmentMean) || !Number.isFinite(controlMean)) {
        if (Number.isFinite(treatmentMean) || Number.isFinite(controlMean)) skippedCandidateCount += 1;
        return;
      }
      if ((measure === 'lnRR' || measure === 'lnRR_mean_only') && (treatmentMean <= 0 || controlMean <= 0)) {
        skippedCandidateCount += 1;
        return;
      }

      nextRow[spec.treatmentMeanColumn] = treatmentMean;
      nextRow[spec.controlMeanColumn] = controlMean;
      if (Number.isFinite(treatmentSd)) nextRow[spec.treatmentSdColumn] = treatmentSd;
      if (Number.isFinite(controlSd)) nextRow[spec.controlSdColumn] = controlSd;
      if (Number.isFinite(treatmentN)) nextRow[spec.treatmentNColumn] = treatmentN;
      if (Number.isFinite(controlN)) nextRow[spec.controlNColumn] = controlN;
      nextRow[`${spec.key}_control_label`] = stringifyCell(controlRow && treatmentColumn ? controlRow[treatmentColumn] : '');
      rowHasOutcome = true;
    });

    if (rowHasOutcome) preparedRows.push(nextRow);
  });

  if (preparedRows.length === 0) return null;

  const addedColumns = Array.from(new Set(specs.flatMap(spec => [
    spec.treatmentMeanColumn,
    spec.treatmentSdColumn,
    spec.controlMeanColumn,
    spec.controlSdColumn,
    spec.treatmentNColumn,
    spec.controlNColumn,
    `${spec.key}_control_label`,
  ]).concat([
    'meta_ai_source_row_index',
    'meta_ai_match_key',
    'meta_ai_treatment_label',
    'meta_ai_contrast_id',
    'meta_ai_contrast_label',
  ])));
  const columns = Array.from(new Set([...sourceDataset.columns, ...addedColumns]));
  const preparedTable: MetaAnalysisIntegratedDataTable = {
    id: `${input.workspace.id}_prepared`,
    pdfId: 'meta-ai-prepared',
    pdfName: 'Meta AI prepared paired contrasts',
    pdfTitle: 'Meta AI prepared paired contrasts',
    columns,
    rows: preparedRows,
    rowCount: preparedRows.length,
    realRowCount: preparedRows.length,
  };
  const preparedDataset: FlattenedDataset = {
    tables: [preparedTable],
    rows: preparedRows,
    columns,
    pdfCount: sourceDataset.pdfCount,
  };

  const moderatorColumns = Array.from(new Set([
    ...normalizeStringArray(result.suggestedConfig?.moderatorColumns),
    ...normalizeStringArray(input.recommendedConfig.moderatorColumns),
    nInputColumn,
    cropColumn,
    seasonColumn,
    pickExistingColumn(columns, ['施肥方式', '施肥次数', '持续天数 (d)', 'PH', 'WFPS (%)', '气候', '年均温 (degree C)']),
  ].filter((column): column is string => !!column && columns.includes(column))));
  const subgroupColumns = Array.from(new Set([
    ...normalizeStringArray(result.suggestedConfig?.subgroupColumns),
    cropColumn,
    seasonColumn,
  ].filter((column): column is string => !!column && columns.includes(column))));
  const config: Required<MetaRunConfig> = {
    model: 'random',
    method: 'REML',
    studyIdColumn,
    clusterBy: studyIdColumn,
    moderatorColumns,
    subgroupColumns,
    columnPreprocess: [],
    minCompleteRows: 2,
    controlRules,
    excludeManualReview,
    manualReviewColumn,
    outcomes: specs
      .filter(spec => preparedRows.some(row => Number.isFinite(parseNumeric(row[spec.treatmentMeanColumn])) && Number.isFinite(parseNumeric(row[spec.controlMeanColumn]))))
      .map(spec => ({
        id: `${spec.id}_${String(measureByOutcome.get(spec.key) || 'lnRR_mean_only').toLowerCase()}`,
        label: spec.label,
        measure: measureByOutcome.get(spec.key) || 'lnRR_mean_only',
        treatmentMean: spec.treatmentMeanColumn,
        treatmentSd: spec.treatmentSdColumn,
        controlMean: spec.controlMeanColumn,
        controlSd: spec.controlSdColumn,
        treatmentN: spec.treatmentNColumn,
        controlN: spec.controlNColumn,
        moderators: moderatorColumns,
        direction: 1,
      })),
  };
  if (config.outcomes.length === 0) return null;

  const storagePath = path.join(getUserUploadDir(input.userId), 'meta-analysis', 'ai-workspaces', `${input.workspace.id}.prepared.json`);
  const effectPreview = buildEffectRows(preparedDataset, config);
  const info: MetaAnalysisPreparedDatasetInfo = {
    workspaceId: input.workspace.id,
    generatedAt: new Date().toISOString(),
    rowCount: preparedRows.length,
    columnCount: columns.length,
    effectRowCount: effectPreview.effectRows.length,
    skippedCandidateCount: skippedCandidateCount + effectPreview.skippedRows.length,
    excludedManualReviewCount,
    selectedMeasures: Array.from(new Set(config.outcomes.map(outcome => outcome.measure || 'lnRR'))),
    storagePath,
    notes,
  };
  await fs.promises.writeFile(storagePath, JSON.stringify({
    source: 'meta-analysis-ai-prepared-dataset',
    info,
    config,
    rows: preparedRows,
    columns,
  }, null, 2), 'utf-8');
  return { dataset: preparedDataset, config, info };
}

async function loadMetaAssistantWorkspaceDataset(workspace: MetaAnalysisAssistantWorkspace): Promise<FlattenedDataset | null> {
  if (!workspace.copyStoragePath || !fs.existsSync(workspace.copyStoragePath)) return null;
  const parsed = JSON.parse(await fs.promises.readFile(workspace.copyStoragePath, 'utf-8')) as Record<string, unknown>;
  const rows = Array.isArray(parsed.rows)
    ? parsed.rows.filter(isRecord).map(row => ({ ...row }))
    : [];
  const rawTables = Array.isArray(parsed.tables) ? parsed.tables : [];
  const tables = rawTables
    .filter(isRecord)
    .map((table, index): MetaAnalysisIntegratedDataTable => ({
      id: stringifyCell(table.id) || `table_${index + 1}`,
      pdfId: stringifyCell(table.pdfId),
      pdfName: stringifyCell(table.pdfName),
      pdfTitle: stringifyCell(table.pdfTitle),
      columns: normalizeStringArray(table.columns),
      rows: Array.isArray(table.rows) ? table.rows.filter(isRecord).map(row => ({ ...row })) : [],
      rowCount: Number(table.rowCount || 0),
      realRowCount: Number(table.realRowCount || 0),
      isPlaceholder: Boolean(table.isPlaceholder),
    }));
  const parsedColumns = normalizeStringArray(parsed.columns);
  const columns = parsedColumns.length ? parsedColumns : (workspace.columns || []);
  return {
    tables,
    rows,
    columns,
    pdfCount: workspace.dataset.pdfCount || tables.length,
  };
}

function buildAutoOutcomeSpecs(): AutoOutcomeSpec[] {
  return [
    {
      key: 'N2O',
      id: 'n2o_lnr_mean_only_bootstrap',
      label: '累积 N2O 排放',
      treatmentMeanColumn: 'N2O_treatment_mean_harmonized',
      treatmentSdColumn: 'N2O_treatment_sd_harmonized',
      controlMeanColumn: 'N2O_control_mean_harmonized',
      controlSdColumn: 'N2O_control_sd_harmonized',
      treatmentNColumn: 'N2O_treatment_n_harmonized',
      controlNColumn: 'N2O_control_n_harmonized',
    },
    {
      key: 'NO',
      id: 'no_lnr_mean_only_bootstrap',
      label: '累积 NO 排放',
      treatmentMeanColumn: 'NO_treatment_mean_harmonized',
      treatmentSdColumn: 'NO_treatment_sd_harmonized',
      controlMeanColumn: 'NO_control_mean_harmonized',
      controlSdColumn: 'NO_control_sd_harmonized',
      treatmentNColumn: 'NO_treatment_n_harmonized',
      controlNColumn: 'NO_control_n_harmonized',
    },
  ];
}

function resolveAutoOutcomeMeasure(
  spec: AutoOutcomeSpec,
  result: MetaAnalysisAssistantResult,
  input: MetaAnalysisAssistantInput,
): EffectMeasure {
  const suggestedOutcomes = result.suggestedConfig?.outcomes || [];
  const matching = suggestedOutcomes.find(outcome => {
    const text = [
      outcome.id,
      outcome.label,
      outcome.treatmentMean,
      outcome.controlMean,
      outcome.treatmentSd,
      outcome.controlSd,
    ].map(value => stringifyCell(value)).join(' ');
    return columnMatchesAutoOutcome(text, spec.key);
  });
  if (matching?.measure) return normalizeEffectMeasure(matching.measure);

  const query = `${input.query}\n${(input.chatHistory || []).filter(item => item.role === 'user').slice(-3).map(item => item.content).join('\n')}`;
  if (/\bMD_mean_only\b|均值差.{0,12}(无\s*(SD|SE)|bootstrap|自助法)|mean[-\s]?only\s+MD/i.test(query)) return 'MD_mean_only';
  if (/\bMD\b|均值差/i.test(query) && !/\blnRR\b|响应比/i.test(query)) return 'MD_mean_only';
  if (/\blnRR_mean_only\b|响应比|response\s+ratio/i.test(query)) return 'lnRR_mean_only';
  return 'lnRR_mean_only';
}

function isMetaManualReviewRequired(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const text = stringifyCell(value).toLowerCase();
  return ['1', 'true', 'yes', 'y', '是', '需要', '待复核', '需复核', 'manual', 'review'].includes(text)
    || /needs?.{0,4}review|manual.{0,4}review|待.{0,2}复核|需.{0,2}复核/.test(text);
}

function isAutoMetaControlRow(
  row: Record<string, unknown>,
  treatmentColumn: string,
  nInputColumn: string,
  explicitControlLabels: Set<string> = new Set(),
  controlRules: MetaControlRule[] = [],
): boolean {
  const label = treatmentColumn ? stringifyCell(row[treatmentColumn]) : '';
  if (explicitControlLabels.has(label.toLowerCase())) return true;
  if (controlRules.some(rule => metaControlRowMatchesRule(row, treatmentColumn, rule))) return true;
  if (isAutoMetaControlLabel(label)) return true;
  const nInput = nInputColumn ? parseNumeric(row[nInputColumn]) : Number.NaN;
  return Number.isFinite(nInput) && nInput === 0 && /(^|\W)(ck|control|n0|f0|fn0|0n)($|\W)|对照|不施/i.test(label);
}

function isAutoMetaControlLabel(value: string): boolean {
  const text = String(value || '').toLowerCase();
  if (!text) return false;
  return /(^|[^a-z0-9])(ck|control|ctrl|n0|f0|fn0|0n|0\s*n|blank)([^a-z0-9]|$)/i.test(text)
    || /no\s+n|no\s+nitrogen|no\s+fertili[sz]ation|without\s+n|zero\s+n/i.test(text)
    || /对照|不施氮|不施肥|无氮|零氮|空白/.test(text);
}

function buildAutoMetaMatchKey(row: Record<string, unknown>, columns: string[]): string {
  return columns.map(column => normalizeAutoMetaKeyValue(row[column])).join('||');
}

function normalizeAutoMetaKeyValue(value: unknown): string {
  return stringifyCell(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function selectMetaControlRule(rules: MetaControlRule[], treatmentLabel: string): MetaControlRule | undefined {
  return rules.find(rule => {
    const exact = (rule.treatmentLabels || []).some(label => normalizeAutoMetaKeyValue(label) === normalizeAutoMetaKeyValue(treatmentLabel));
    return exact || matchesMetaControlPattern(treatmentLabel, rule.treatmentPattern);
  });
}

function metaControlRowMatchesRule(
  row: Record<string, unknown>,
  treatmentColumn: string,
  rule: MetaControlRule,
): boolean {
  const label = treatmentColumn ? stringifyCell(row[treatmentColumn]) : '';
  return rule.controlLabels.some(item => normalizeAutoMetaKeyValue(item) === normalizeAutoMetaKeyValue(label))
    || matchesMetaControlPattern(label, rule.controlPattern);
}

function matchesMetaControlPattern(value: string, pattern?: string): boolean {
  const source = stringifyCell(pattern).slice(0, 240);
  if (!source) return false;
  try {
    return new RegExp(source, 'i').test(value);
  } catch {
    return normalizeAutoMetaKeyValue(value).includes(normalizeAutoMetaKeyValue(source));
  }
}

function columnMatchesAutoOutcome(column: string, key: 'N2O' | 'NO'): boolean {
  const text = column.toLowerCase();
  if (key === 'N2O') return /n2o|n₂o|nitrous\s+oxide|氧化亚氮/.test(text);
  if (/n2o|n₂o|nitrous\s+oxide/.test(text)) return false;
  return /(^|[^a-z0-9])no([^a-z0-9]|$)|cum[_\s-]*no|no[_\s-]|[_\s-]no|nitric\s+oxide|一氧化氮/.test(text);
}

function collectAutoOutcomeUnits(dataset: FlattenedDataset, key: 'N2O' | 'NO'): string[] {
  const unitColumns = dataset.columns.filter(column => (
    (columnMatchesAutoOutcome(column, key) && /unit|单位/i.test(column))
    || /^(unit|units|单位|测量单位)$/i.test(column.trim())
  ));
  return Array.from(new Set(
    dataset.rows
      .flatMap(row => unitColumns.map(column => normalizeAutoMetaKeyValue(row[column])))
      .filter(Boolean),
  ));
}

function isAutoOutcomeNonMeanColumn(column: string): boolean {
  const text = column.toLowerCase();
  return /(^|[_\s-])(sd|se|sem|stderr|std|variance|var|n|sample|replicate|p|df)([_\s-]|$)|_sd|_se|_n$|ckn|_tn|t_n|c_n|unit|单位/.test(text);
}

function pickAutoOutcomeTreatmentMean(columns: string[], row: Record<string, unknown>, key: 'N2O' | 'NO'): number {
  return pickAutoNumericFromColumns(row, columns.filter(column => {
    const text = column.toLowerCase();
    if (!columnMatchesAutoOutcome(column, key) || isAutoOutcomeNonMeanColumn(column)) return false;
    return /tmean|t_mean|treatment.*mean|trt.*mean|source_mean|source.*mean/.test(text)
      || (/cum|cumulative|mean/.test(text) && !/ckmean|ck_mean|control|cmean|c_mean/.test(text));
  }));
}

function pickAutoOutcomeControlMean(
  columns: string[],
  treatmentRow: Record<string, unknown>,
  controlRow: Record<string, unknown> | null,
  key: 'N2O' | 'NO',
): number {
  const explicitOnTreatment = pickAutoNumericFromColumns(treatmentRow, columns.filter(column => {
    const text = column.toLowerCase();
    return columnMatchesAutoOutcome(column, key)
      && !isAutoOutcomeNonMeanColumn(column)
      && /ckmean|ck_mean|control.*mean|cmean|c_mean/.test(text);
  }));
  if (Number.isFinite(explicitOnTreatment)) return explicitOnTreatment;
  if (!controlRow) return Number.NaN;
  return pickAutoNumericFromColumns(controlRow, columns.filter(column => {
    const text = column.toLowerCase();
    if (!columnMatchesAutoOutcome(column, key) || isAutoOutcomeNonMeanColumn(column)) return false;
    return /ckmean|ck_mean|control.*mean|cmean|c_mean|source_mean|source.*mean|cum|cumulative|mean/.test(text);
  }));
}

function pickAutoOutcomeSd(
  columns: string[],
  row: Record<string, unknown>,
  key: 'N2O' | 'NO',
  role: 'treatment' | 'control',
  sampleSize: number,
): number {
  const roleSdPattern = role === 'treatment'
    ? /tsd|t_sd|treatment.*sd|trt.*sd|source.*sd|(^|[_\s-])sd([_\s-]|$)/
    : /cksd|ck_sd|control.*sd|c_sd|source.*sd|(^|[_\s-])sd([_\s-]|$)/;
  const sd = pickAutoNumericFromColumns(row, columns.filter(column => (
    columnMatchesAutoOutcome(column, key) && roleSdPattern.test(column.toLowerCase())
  )));
  if (Number.isFinite(sd)) return sd;
  const roleSePattern = role === 'treatment'
    ? /tse|t_se|treatment.*se|trt.*se|source.*se|(^|[_\s-])(se|sem|stderr)([_\s-]|$)/
    : /ckse|ck_se|control.*se|c_se|source.*se|(^|[_\s-])(se|sem|stderr)([_\s-]|$)/;
  const se = pickAutoNumericFromColumns(row, columns.filter(column => (
    columnMatchesAutoOutcome(column, key) && roleSePattern.test(column.toLowerCase())
  )));
  return Number.isFinite(se) && Number.isFinite(sampleSize) && sampleSize > 0
    ? se * Math.sqrt(sampleSize)
    : Number.NaN;
}

function pickAutoOutcomeN(columns: string[], row: Record<string, unknown>, key: 'N2O' | 'NO', role: 'treatment' | 'control'): number {
  const rolePattern = role === 'treatment'
    ? /tn|t_n|treatment.*n|trt.*n|sample|replicate|cum.*_n|_n$/
    : /ckn|ck_n|control.*n|c_n|sample|replicate|cum.*_n|_n$/;
  return pickAutoNumericFromColumns(row, columns.filter(column => columnMatchesAutoOutcome(column, key) && rolePattern.test(column.toLowerCase())));
}

function pickAutoNumericFromColumns(row: Record<string, unknown>, columns: string[]): number {
  for (const column of columns) {
    const value = parseNumeric(row[column]);
    if (Number.isFinite(value)) return value;
  }
  return Number.NaN;
}

function pickAutoControlRowForOutcome(
  candidates: Array<Record<string, unknown>>,
  treatmentRow: Record<string, unknown>,
  treatmentColumn: string,
  key: 'N2O' | 'NO',
  controlRule?: MetaControlRule,
): Record<string, unknown> | null {
  if (!candidates.length) return null;
  const requested = stringifyCell(treatmentRow.control_for_contrast || treatmentRow.controlForContrast || treatmentRow['control_for_contrast']);
  const requestedControls = requested
    ? candidates.filter(row => stringifyCell(treatmentColumn ? row[treatmentColumn] : '').toLowerCase() === requested.toLowerCase())
    : [];
  const ruleControls = controlRule
    ? candidates.filter(row => metaControlRowMatchesRule(row, treatmentColumn, controlRule))
    : [];
  const pool = requestedControls.length ? requestedControls : (ruleControls.length ? ruleControls : candidates);
  const rowColumns = Array.from(new Set(pool.flatMap(row => Object.keys(row))));
  return pool.find(row => Number.isFinite(pickAutoOutcomeControlMean(rowColumns, treatmentRow, row, key))) || pool[0] || null;
}

function collectMetaColumnSampleValues(input: MetaAnalysisAssistantInput, column: string, limit: number): string[] {
  const values: string[] = [];
  const variable = input.variables.find(item => item.name === column);
  if (variable) values.push(...variable.sampleValues);
  for (const row of input.workspace.sampleRows || []) {
    const text = stringifyCell(row[column]);
    if (text) values.push(text);
  }
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function isLikelyTreatmentDescriptorColumn(column: string): boolean {
  const text = column.toLowerCase();
  return /treatment|control|group|处理|对照|ck|组别|分组|施肥|fertili|biochar|amendment|管理|management|period|时期|作物|crop/.test(text);
}

function isLikelyControlValue(value: string): boolean {
  const text = value.toLowerCase().trim();
  if (!text) return false;
  return /(^|[^a-z0-9])(ck|control|ctrl|blank|baseline|untreated|without|zero|none|no\s+\w+)([^a-z0-9]|$)/i.test(text)
    || /对照|空白|未处理|不施|无添加|常规|基线/.test(text);
}

function isPlainNumericMetaText(value: string): boolean {
  const text = value.trim();
  return /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text);
}

function buildLocalMetaAssistantPlan(input: MetaAnalysisAssistantInput): MetaAnalysisAssistantResult {
  const outcomes = input.recommendedConfig.outcomes || [];
  const dataUnderstanding = buildLocalMetaAssistantDataUnderstanding(input);
  const operations: MetaAnalysisAssistantOperation[] = [
    {
      id: 'create-copy-workspace',
      type: 'copy_workspace',
      title: '创建副本工作区',
      rationale: '后续字段整理、删除行列、预处理和模型配置先在副本上规划，不直接改原始 Meta 编码表。',
      params: {
        workspaceId: input.workspace.id,
        rowCount: input.workspace.dataset.rowCount,
        columnCount: input.workspace.dataset.columnCount,
      },
      requiresConfirmation: false,
    },
    {
      id: 'inspect-effect-columns',
      type: 'inspect_columns',
      title: '识别效应量字段',
      rationale: outcomes.length
        ? `已识别 ${outcomes.length} 个候选因变量，每个因变量都需要处理组/对照组的均值、SD 和 n。`
        : '没有自动识别到完整的均值、SD、n 字段，需要用户在表头用途标注里手动指定。',
      params: {
        candidateOutcomeCount: outcomes.length,
        candidates: outcomes.map(outcome => ({
          label: outcome.label,
          measure: outcome.measure,
          treatmentMean: outcome.treatmentMean,
          treatmentSd: outcome.treatmentSd,
          treatmentN: outcome.treatmentN,
          controlMean: outcome.controlMean,
          controlSd: outcome.controlSd,
          controlN: outcome.controlN,
        })),
      },
      requiresConfirmation: false,
    },
  ];

  if (input.recommendedConfig.subgroupColumns.length > 0) {
    operations.push({
      id: 'configure-subgroups',
      type: 'configure_subgroups',
      title: '配置亚组分析',
      rationale: '这些列不是效应量计算字段，但适合作为合并效应值后的亚组分析变量；同一亚组水平会先合并为一个 pooled subgroup effect，例如同一 Crop 合并为该作物的合并效应值。',
      params: { subgroupColumns: input.recommendedConfig.subgroupColumns },
      requiresConfirmation: true,
    });
  }

  if (input.recommendedConfig.moderatorColumns.length > 0) {
    operations.push({
      id: 'configure-moderators',
      type: 'configure_moderators',
      title: '配置调节变量 / 元回归变量',
      rationale: '这些变量可用于解释效应量异质性；有效效应量较少时先作为探索性结果。',
      params: { moderatorColumns: input.recommendedConfig.moderatorColumns },
      requiresConfirmation: true,
    });
  }

  operations.push({
    id: 'await-user-confirmation',
    type: 'await_confirmation',
    title: '等待用户确认副本数据',
    rationale: '只有用户确认副本字段、单位、拆列和分组规则无误后，才进入效应量计算、Meta 模型和 R 出图。',
    params: { nextStep: 'confirm_then_run_meta_analysis' },
    requiresConfirmation: true,
  });

  const questions: string[] = [];
  if (outcomes.length === 0) {
    questions.push('请告诉我哪一列是处理组均值、处理组SD、处理组n、对照组均值、对照组SD、对照组n。');
  }
  if (input.query) {
    questions.push('如果你有优先分析的因变量或亚组变量，我会按你的要求覆盖自动建议。');
  }

  const assistantMessage = outcomes.length
    ? `我已在副本工作区 ${input.workspace.id} 中预检 ${input.workspace.dataset.rowCount} 行 Meta 数据，并识别到 ${outcomes.length} 个可能的因变量。下一步应先核查副本中的均值、SD/SE、n、单位和亚组字段，确认无误后再运行 Meta 分析。`
    : `我已创建副本工作区 ${input.workspace.id}，但当前表头还不足以自动组成效应量。我们先通过对话确认因变量、处理组/对照组、均值、SD/SE 和 n 的含义，再整理副本。`;

  return {
    provider: 'local-rule',
    fallbackChain: ['local-rule'],
    workflowStage: 'prepare_copy',
    assistantMessage,
    dataUnderstanding,
    operations,
    rPlan: {
      packages: ['metafor', 'meta', 'clubSandwich'],
      plots: [
        'pooled_effect_summary',
        'subgroup_pooled_effects',
        'study_cluster_forest',
        'study_cluster_funnel_if_clusters_ge_10',
        'numeric_moderator_meta_regression',
      ],
      diagnostics: [
        'prediction_interval',
        'cluster_robust_CR2_if_available',
        'leave_one_study_out_csv',
        'egger_if_clusters_ge_10',
        'baujat_study_cluster',
      ],
      notes: [
        'Deferred until the user confirms that the copied Excel-style dataset is ready for analysis.',
        'If SD/SE is unavailable, use mean-only lnRR/MD with non-parametric bootstrap/resampling instead of inverse-variance weighting.',
        'Standard variance-based analyses aggregate dependent rows to independent study/cluster summaries for forest, funnel, Egger, leave-one-study-out and Baujat diagnostics.',
        'Mean-only analyses report equal-cluster bootstrap summaries and explicitly skip diagnostics that require sampling variances.',
      ],
    },
    suggestedConfig: input.recommendedConfig,
    questions,
    warnings: input.warnings,
  };
}

function sanitizeMetaAssistantResult(result: MetaAnalysisAssistantResult, input: MetaAnalysisAssistantInput): MetaAnalysisAssistantResult {
  const record: Record<string, unknown> = isRecord(result) ? result : {};
  const provider = stringifyCell(record.provider) || 'ai';
  const assistantMessage = stringifyCell(record.assistantMessage)
    || stringifyCell(record.rawText)
    || 'AI 已生成 Meta 分析配置建议。';
  const operationsInput: unknown[] = Array.isArray(record.operations) ? record.operations : [];
  const operations = operationsInput
    .map((item: unknown, index: number): MetaAnalysisAssistantOperation | null => {
      if (!isRecord(item)) return null;
      const type = stringifyCell(item.type) || 'note';
      const title = stringifyCell(item.title) || `建议 ${index + 1}`;
      return {
        id: stringifyCell(item.id) || `${type}_${index + 1}`,
        type,
        title,
        rationale: stringifyCell(item.rationale) || title,
        params: isRecord(item.params) ? item.params : {},
        requiresConfirmation: item.requiresConfirmation !== false,
      };
    })
    .filter((item): item is MetaAnalysisAssistantOperation => !!item)
    .slice(0, 20);

  if (operations.length === 0) {
    operations.push(...buildLocalMetaAssistantPlan(input).operations);
  }

  return {
    provider,
    workflowStage: stringifyCell(record.workflowStage),
    assistantMessage,
    dataUnderstanding: isRecord(record.dataUnderstanding) ? record.dataUnderstanding : buildLocalMetaAssistantDataUnderstanding(input),
    operations,
    rPlan: isRecord(record.rPlan) ? record.rPlan : undefined,
    suggestedConfig: sanitizeMetaAssistantSuggestedConfig(record.suggestedConfig, input),
    questions: normalizeStringArray(record.questions).slice(0, 8),
    warnings: normalizeStringArray(record.warnings),
    rawText: stringifyCell(record.rawText),
    fallbackChain: normalizeStringArray(record.fallbackChain),
    progressLogs: normalizeStringArray(record.progressLogs),
  };
}

function applyMetaAssistantConfirmationState(
  result: MetaAnalysisAssistantResult,
  input: MetaAnalysisAssistantInput,
): MetaAnalysisAssistantResult {
  if (!input.confirmedByUser) return result;
  const operations = Array.isArray(result.operations) ? result.operations.slice() : [];
  const hasReadyOperation = operations.some(operation => operation.type === 'ready_for_analysis' || operation.id === 'ready-for-analysis');
  if (!hasReadyOperation) {
    operations.push({
      id: 'ready-for-analysis',
      type: 'ready_for_analysis',
      title: '进入 Meta 分析',
      rationale: '用户已确认副本整理规则、对照匹配规则和效应量方案；不再重复等待确认。',
      params: {
        conversationId: input.conversationId || input.workspace.id,
        workspaceId: input.workspace.id,
        confirmedByUser: true,
      },
      requiresConfirmation: false,
    });
  }

  const warnings = Array.from(new Set([
    ...(result.warnings || []),
    ...((result.suggestedConfig?.outcomes || []).length
      ? []
      : ['用户已确认分析规则，但当前 AI 建议尚未形成可直接运行的效应量字段映射；如果仍缺少处理组/对照组均值列，需要先完成副本整理或手动映射。']),
  ]));

  return {
    ...result,
    workflowStage: 'ready_for_analysis',
    assistantMessage: result.assistantMessage && !/确认|等待/.test(result.assistantMessage)
      ? result.assistantMessage
      : '已记录你的确认，并进入可分析阶段；后续不再重复询问同一批确认问题。请按当前方案运行 Meta 分析，或继续补充新的修改要求。',
    operations,
    questions: [],
    warnings,
  };
}

function sanitizeMetaAssistantSuggestedConfig(input: unknown, context: MetaAnalysisAssistantInput): Partial<MetaRunConfig> {
  const record = isRecord(input) ? input : {};
  const columns = context.workspace.columns;
  const fallback = context.recommendedConfig;
  const modelInput = stringifyCell(record.model || fallback.model);
  const model: MetaModelType = modelInput === 'fixed' || modelInput === 'mixed' ? modelInput : 'random';
  const method = stringifyCell(record.method || fallback.method) || 'REML';
  const studyIdColumn = pickExistingColumn(columns, [stringifyCell(record.studyIdColumn), fallback.studyIdColumn, ...STUDY_ID_CANDIDATES]) || fallback.studyIdColumn;
  const clusterBy = pickExistingColumn(columns, [stringifyCell(record.clusterBy), fallback.clusterBy, studyIdColumn, 'PDF ID']) || studyIdColumn;
  const moderatorColumns = normalizeStringArray(record.moderatorColumns).filter(column => columns.includes(column));
  const subgroupColumns = normalizeStringArray(record.subgroupColumns).filter(column => columns.includes(column));
  const columnPreprocess = normalizeColumnPreprocess(record.columnPreprocess, columns);
  const controlRules = normalizeMetaControlRules(record.controlRules, columns);
  const excludeManualReview = record.excludeManualReview === undefined
    ? fallback.excludeManualReview
    : normalizeBoolean(record.excludeManualReview, true);
  const manualReviewColumn = pickExistingColumn(columns, [
    stringifyCell(record.manualReviewColumn),
    fallback.manualReviewColumn,
    'needs_manual_review',
    'needsManualReview',
    '需人工复核',
    '人工复核',
  ]);
  const rawOutcomes = Array.isArray(record.outcomes) ? record.outcomes : [];
  const outcomes = rawOutcomes
    .map(item => normalizeOutcomeConfig(item, columns))
    .filter((item): item is MetaOutcomeConfig => !!item);

  return {
    model,
    method,
    studyIdColumn,
    clusterBy,
    moderatorColumns: moderatorColumns.length ? moderatorColumns : fallback.moderatorColumns,
    subgroupColumns: subgroupColumns.length ? subgroupColumns : fallback.subgroupColumns,
    columnPreprocess,
    minCompleteRows: Number.isFinite(Number(record.minCompleteRows)) ? Math.max(1, Math.floor(Number(record.minCompleteRows))) : fallback.minCompleteRows,
    controlRules,
    excludeManualReview,
    manualReviewColumn,
    outcomes: outcomes.length ? outcomes : fallback.outcomes,
  };
}

function normalizeRunConfig(input: unknown, dataset: FlattenedDataset, inferred: CandidateOutcome[]): Required<MetaRunConfig> {
  const record = isRecord(input) ? input : {};
  const outcomesInput = Array.isArray(record.outcomes) ? record.outcomes : [];
  const outcomes = outcomesInput
    .map(item => normalizeOutcomeConfig(item, dataset.columns))
    .filter((item): item is MetaOutcomeConfig => !!item);
  if (outcomes.length === 0) {
    outcomes.push(...inferred.map(candidate => ({
      id: candidate.id,
      label: candidate.label,
      measure: candidate.measure,
      ...candidate.mapping,
      moderators: [],
      direction: 1,
    })));
  }

  const modelInput = stringifyCell(record.model);
  const model: MetaModelType = modelInput === 'fixed' || modelInput === 'mixed' ? modelInput : 'random';
  const method = typeof record.method === 'string' && record.method.trim() ? record.method.trim() : 'REML';
  const studyIdColumn = pickExistingColumn(dataset.columns, [stringifyCell(record.studyIdColumn), ...STUDY_ID_CANDIDATES]) || 'Study#';
  const clusterBy = pickExistingColumn(dataset.columns, [stringifyCell(record.clusterBy), studyIdColumn, 'PDF ID']) || studyIdColumn;
  const moderatorColumns = normalizeStringArray(record.moderatorColumns).filter(column => dataset.columns.includes(column));
  const subgroupColumns = normalizeStringArray(record.subgroupColumns).filter(column => dataset.columns.includes(column));
  const columnPreprocess = normalizeColumnPreprocess(record.columnPreprocess, dataset.columns);
  const controlRules = normalizeMetaControlRules(record.controlRules, dataset.columns);
  const excludeManualReview = normalizeBoolean(record.excludeManualReview, true);
  const manualReviewColumn = pickExistingColumn(dataset.columns, [
    stringifyCell(record.manualReviewColumn),
    'needs_manual_review',
    'needsManualReview',
    '需人工复核',
    '人工复核',
  ]);
  const minCompleteRows = Number.isFinite(Number(record.minCompleteRows)) ? Math.max(1, Math.floor(Number(record.minCompleteRows))) : 2;

  return {
    outcomes,
    model,
    method,
    studyIdColumn,
    clusterBy,
    moderatorColumns,
    subgroupColumns,
    columnPreprocess,
    minCompleteRows,
    controlRules,
    excludeManualReview,
    manualReviewColumn,
  };
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  const text = stringifyCell(value).toLowerCase();
  if (['1', 'true', 'yes', 'on', '是', '排除'].includes(text)) return true;
  if (['0', 'false', 'no', 'off', '否', '保留'].includes(text)) return false;
  return fallback;
}

function normalizeMetaControlRules(input: unknown, columns: string[]): MetaControlRule[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item, index): MetaControlRule | null => {
      if (!isRecord(item)) return null;
      const controlLabels = normalizeStringArray(item.controlLabels);
      const controlPattern = stringifyCell(item.controlPattern);
      if (controlLabels.length === 0 && !controlPattern) return null;
      return {
        id: normalizeMetaScopeId(item.id, `contrast_${index + 1}`),
        label: stringifyCell(item.label),
        treatmentLabels: normalizeStringArray(item.treatmentLabels),
        treatmentPattern: stringifyCell(item.treatmentPattern),
        controlLabels,
        controlPattern,
        matchColumns: normalizeStringArray(item.matchColumns).filter(column => columns.includes(column)),
      };
    })
    .filter((item): item is MetaControlRule => !!item)
    .slice(0, 24);
}

function normalizeColumnPreprocess(input: unknown, columns: string[]): MetaColumnPreprocessConfig[] {
  if (!Array.isArray(input)) return [];
  const normalized: Array<MetaColumnPreprocessConfig | null> = input
    .map((item): MetaColumnPreprocessConfig | null => {
      if (!isRecord(item)) return null;
      const column = stringifyCell(item.column);
      if (!column || !columns.includes(column)) return null;
      const type = stringifyCell(item.type);
      if (type !== 'rangeGroups') return null;
      const spec = stringifyCell(item.spec);
      const groups = parseRangeGroupSpec(spec);
      if (!spec || groups.length === 0) return null;
      return {
        column,
        type: 'rangeGroups' as const,
        spec,
        groups,
        unmatchedLabel: stringifyCell(item.unmatchedLabel) || '未分组',
      };
    });
  return normalized.filter((item): item is MetaColumnPreprocessConfig => !!item);
}

function normalizeOutcomeConfig(input: unknown, columns: string[]): MetaOutcomeConfig | null {
  if (!isRecord(input)) return null;
  const mapping: Partial<MetaOutcomeMapping> = {};
  const measure = normalizeEffectMeasure(input.measure);
  const requiredRoles = getRequiredOutcomeRoles(measure);
  for (const role of STAT_ROLE_KEYS) {
    const column = stringifyCell(input[role]);
    if (!column) {
      if (requiredRoles.includes(role)) return null;
      continue;
    }
    if (!columns.includes(column)) {
      if (requiredRoles.includes(role)) return null;
      continue;
    }
    mapping[role] = column;
  }
  if (!requiredRoles.every(role => typeof mapping[role] === 'string' && !!String(mapping[role]).trim())) return null;
  const treatmentMean = stringifyCell(mapping.treatmentMean);
  const controlMean = stringifyCell(mapping.controlMean);
  if (!treatmentMean || !controlMean) return null;
  return {
    id: stringifyCell(input.id) || normalizeOutcomeId(stringifyCell(input.label) || treatmentMean),
    label: stringifyCell(input.label) || normalizeOutcomeLabel(stringifyCell(input.id) || treatmentMean),
    measure,
    ...mapping,
    treatmentMean,
    controlMean,
    moderators: normalizeStringArray(input.moderators).filter(column => columns.includes(column)),
    direction: typeof input.direction === 'number' ? input.direction : stringifyCell(input.direction || '1'),
  };
}

function parseRangeGroupSpec(spec: string): MetaRangeGroupConfig[] {
  return String(spec || '')
    .split(/[;\n；]+/)
    .map(part => parseRangeGroupPart(part))
    .filter((group): group is MetaRangeGroupConfig => !!group);
}

function parseRangeGroupPart(part: string): MetaRangeGroupConfig | null {
  const text = String(part || '').trim();
  if (!text) return null;
  const split = splitRangeGroupAssignment(text);
  if (!split.expression) return null;
  const range = parseRangeExpression(split.expression);
  if (!range) return null;
  return {
    ...range,
    label: split.label || split.expression,
  };
}

function splitRangeGroupAssignment(text: string): { expression: string; label: string } {
  const equalsIndex = text.indexOf('=');
  if (equalsIndex >= 0) {
    return {
      expression: text.slice(0, equalsIndex).trim(),
      label: text.slice(equalsIndex + 1).trim(),
    };
  }

  const colonIndex = text.indexOf(':');
  if (colonIndex >= 0) {
    const left = text.slice(0, colonIndex).trim();
    const right = text.slice(colonIndex + 1).trim();
    if (parseRangeExpression(left)) return { expression: left, label: right };
    return { expression: right, label: left };
  }

  return { expression: text, label: text };
}

function parseRangeExpression(expression: string): Omit<MetaRangeGroupConfig, 'label'> | null {
  const numberPattern = '[-+]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][-+]?\\d+)?';
  const normalized = String(expression || '')
    .replace(/[，]/g, ',')
    .replace(/[－–—~～]/g, '-')
    .replace(/\s+/g, '')
    .trim();
  if (!normalized) return null;

  const bracketMatch = normalized.match(new RegExp(`^([\\[\\(])(${numberPattern}),(${numberPattern})([\\]\\)])$`));
  if (bracketMatch) {
    const min = parseRangeNumber(bracketMatch[2]);
    const max = parseRangeNumber(bracketMatch[3]);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return {
      min: Math.min(min, max),
      max: Math.max(min, max),
      includeMin: bracketMatch[1] === '[',
      includeMax: bracketMatch[4] === ']',
    };
  }

  const comparatorMatch = normalized.match(new RegExp(`^(<=|≤|<|>=|≥|>)(${numberPattern})$`));
  if (comparatorMatch) {
    const value = parseRangeNumber(comparatorMatch[2]);
    if (!Number.isFinite(value)) return null;
    const comparator = comparatorMatch[1];
    if (comparator === '<' || comparator === '<=' || comparator === '≤') {
      return {
        max: value,
        includeMin: true,
        includeMax: comparator !== '<',
      };
    }
    return {
      min: value,
      includeMin: comparator !== '>',
      includeMax: true,
    };
  }

  const rangeMatch = normalized.match(new RegExp(`^(${numberPattern})-(${numberPattern})$`));
  if (rangeMatch) {
    const left = parseRangeNumber(rangeMatch[1]);
    const right = parseRangeNumber(rangeMatch[2]);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
    return {
      min: Math.min(left, right),
      max: Math.max(left, right),
      includeMin: true,
      includeMax: true,
    };
  }

  return null;
}

function parseRangeNumber(value: string): number {
  const text = String(value || '').replace(/,/g, '').trim();
  if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) return Number.NaN;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function applyColumnPreprocess(value: unknown, preprocess?: MetaColumnPreprocessConfig): string | number | undefined {
  if (!preprocess || preprocess.type !== 'rangeGroups') return undefined;
  const raw = stringifyCell(value);
  if (!raw) return '';
  const numeric = parseNumeric(value);
  if (!Number.isFinite(numeric)) return raw;
  const groups = preprocess.groups && preprocess.groups.length > 0 ? preprocess.groups : parseRangeGroupSpec(preprocess.spec);
  const matched = groups.find(group => isNumericInRangeGroup(numeric, group));
  return matched ? matched.label : (preprocess.unmatchedLabel || '未分组');
}

function isNumericInRangeGroup(value: number, group: MetaRangeGroupConfig): boolean {
  if (typeof group.min === 'number' && Number.isFinite(group.min)) {
    if (group.includeMin ? value < group.min : value <= group.min) return false;
  }
  if (typeof group.max === 'number' && Number.isFinite(group.max)) {
    if (group.includeMax ? value > group.max : value >= group.max) return false;
  }
  return true;
}

function buildEffectRows(
  dataset: FlattenedDataset,
  config: Required<MetaRunConfig>,
): { effectRows: EffectRow[]; skippedRows: SkippedEffectRow[] } {
  const effectRows: EffectRow[] = [];
  const skippedRows: SkippedEffectRow[] = [];
  const preprocessByColumn = new Map((config.columnPreprocess || []).map(item => [item.column, item]));

  dataset.rows.forEach((row, rowIndex) => {
    if (config.excludeManualReview && config.manualReviewColumn && isMetaManualReviewRequired(row[config.manualReviewColumn])) {
      config.outcomes.forEach(outcome => {
        skippedRows.push({
          outcomeId: outcome.id || '',
          rowIndex: rowIndex + 1,
          studyId: stringifyCell(firstNonEmpty(row[config.studyIdColumn], row['Study#'], row.PDF标题, row.PDF文件名, row['PDF ID'])) || `Study_${rowIndex + 1}`,
          reason: `${config.manualReviewColumn}=true，已按主分析规则排除`,
        });
      });
      return;
    }
    for (const outcome of config.outcomes) {
      const measure = outcome.measure || 'lnRR';
      const studyId = stringifyCell(firstNonEmpty(row[config.studyIdColumn], row['Study#'], row.PDF标题, row.PDF文件名, row['PDF ID'])) || `Study_${rowIndex + 1}`;
      const clusterId = stringifyCell(firstNonEmpty(row[config.clusterBy], row.meta_ai_match_key, studyId)) || studyId;
      const parsed = parseOutcomeNumbers(row, outcome, measure);
      if (!parsed.ok) {
        skippedRows.push({
          outcomeId: outcome.id || '',
          rowIndex: rowIndex + 1,
          studyId,
          reason: parsed.reason,
        });
        continue;
      }

      const calculated = calculateEffectSize(parsed.values, measure, normalizeDirection(outcome.direction));
      if (!calculated.ok) {
        skippedRows.push({
          outcomeId: outcome.id || '',
          rowIndex: rowIndex + 1,
          studyId,
          reason: calculated.reason,
        });
        continue;
      }

      const moderatorNames = Array.from(new Set([...(config.moderatorColumns || []), ...(config.subgroupColumns || []), ...normalizeStringArray(outcome.moderators)]));
      const moderators: Record<string, string | number> = {};
      moderatorNames.forEach(column => {
        if (!column) return;
        const processed = applyColumnPreprocess(row[column], preprocessByColumn.get(column));
        if (processed !== undefined) {
          moderators[column] = processed;
          return;
        }
        const numeric = parseNumeric(row[column]);
        moderators[column] = Number.isFinite(numeric) ? numeric : stringifyCell(row[column]);
      });

      effectRows.push({
        outcome_id: outcome.id || normalizeOutcomeId(outcome.label || outcome.treatmentMean),
        outcome_label: outcome.label || normalizeOutcomeLabel(outcome.id || outcome.treatmentMean),
        measure,
        study_id: studyId,
        cluster_id: clusterId,
        contrast_id: stringifyCell(row.meta_ai_contrast_id) || 'default',
        contrast_label: stringifyCell(row.meta_ai_contrast_label || row.control_for_contrast || row.controlForContrast) || '默认对照',
        pdf_id: stringifyCell(row['PDF ID']),
        pdf_title: stringifyCell(row.PDF标题),
        pdf_file: stringifyCell(row.PDF文件名),
        row_index: rowIndex + 1,
        obs_id: stringifyCell(firstNonEmpty(row['Obs#'], row.obs_id, row.ObsID, row._row_index)) || String(rowIndex + 1),
        yi: calculated.yi,
        vi: calculated.vi,
        sei: Number.isFinite(calculated.vi) && calculated.vi > 0 ? Math.sqrt(calculated.vi) : Number.NaN,
        weight: Number.isFinite(calculated.vi) && calculated.vi > 0 ? 1 / calculated.vi : 1,
        treatment_mean: parsed.values.treatmentMean,
        treatment_sd: parsed.values.treatmentSd ?? Number.NaN,
        treatment_n: parsed.values.treatmentN ?? Number.NaN,
        control_mean: parsed.values.controlMean,
        control_sd: parsed.values.controlSd ?? Number.NaN,
        control_n: parsed.values.controlN ?? Number.NaN,
        effect_label: formatEffectLabel(measure, calculated.yi),
        source: stringifyCell(row.数据来源),
        location: stringifyCell(row['页码/位置']),
        evidence: stringifyCell(row.证据原文),
        moderators,
      });
    }
  });

  return { effectRows, skippedRows };
}

function parseOutcomeNumbers(
  row: Record<string, unknown>,
  outcome: MetaOutcomeConfig,
  measure: EffectMeasure,
): { ok: true; values: Partial<Record<keyof MetaOutcomeMapping, number>> & { treatmentMean: number; controlMean: number } } | { ok: false; reason: string } {
  const values: Partial<Record<keyof MetaOutcomeMapping, number>> = {};
  const requiredRoles = getRequiredOutcomeRoles(measure);
  for (const role of STAT_ROLE_KEYS) {
    const column = outcome[role];
    if (!column) {
      if (requiredRoles.includes(role)) return { ok: false, reason: `${ROLE_LABELS[role]}未映射` };
      continue;
    }
    const value = parseNumeric(row[column]);
    if (!Number.isFinite(value)) {
      if (requiredRoles.includes(role)) return { ok: false, reason: `${ROLE_LABELS[role]}缺失或不是数值` };
      continue;
    }
    values[role] = value;
  }

  if (!Number.isFinite(values.treatmentMean) || !Number.isFinite(values.controlMean)) {
    return { ok: false, reason: '处理组或对照组均值缺失' };
  }
  if (!isMeanOnlyMeasure(measure)) {
    if ((values.treatmentN || 0) < 2 || (values.controlN || 0) < 2) return { ok: false, reason: '处理组或对照组 n 小于 2' };
    if ((values.treatmentSd || 0) < 0 || (values.controlSd || 0) < 0) return { ok: false, reason: 'SD 不能为负数' };
  }
  return { ok: true, values: values as Partial<Record<keyof MetaOutcomeMapping, number>> & { treatmentMean: number; controlMean: number } };
}

function calculateEffectSize(
  values: Partial<Record<keyof MetaOutcomeMapping, number>> & { treatmentMean: number; controlMean: number },
  measure: EffectMeasure,
  direction: number,
): { ok: true; yi: number; vi: number } | { ok: false; reason: string } {
  const tm = values.treatmentMean;
  const tsd = values.treatmentSd ?? Number.NaN;
  const tn = values.treatmentN ?? Number.NaN;
  const cm = values.controlMean;
  const csd = values.controlSd ?? Number.NaN;
  const cn = values.controlN ?? Number.NaN;

  if (measure === 'lnRR_mean_only') {
    if (tm <= 0 || cm <= 0) return { ok: false, reason: 'mean-only lnRR 要求处理组和对照组均值均大于 0' };
    return { ok: true, yi: direction * Math.log(tm / cm), vi: Number.NaN };
  }

  if (measure === 'MD_mean_only') {
    return { ok: true, yi: direction * (tm - cm), vi: Number.NaN };
  }

  if (measure === 'lnRR') {
    if (tm <= 0 || cm <= 0) return { ok: false, reason: 'lnRR 要求处理组和对照组均值均大于 0' };
    const yi = direction * Math.log(tm / cm);
    const vi = (tsd * tsd) / (tn * tm * tm) + (csd * csd) / (cn * cm * cm);
    if (!Number.isFinite(vi) || vi <= 0) return { ok: false, reason: 'lnRR 方差无效，请检查 SD/n/均值' };
    return { ok: true, yi, vi };
  }

  if (measure === 'MD') {
    const yi = direction * (tm - cm);
    const vi = (tsd * tsd) / tn + (csd * csd) / cn;
    if (!Number.isFinite(vi) || vi <= 0) return { ok: false, reason: 'MD 方差无效，请检查 SD/n' };
    return { ok: true, yi, vi };
  }

  const df = tn + cn - 2;
  if (df <= 0) return { ok: false, reason: 'SMD 自由度无效' };
  const pooledVariance = (((tn - 1) * tsd * tsd) + ((cn - 1) * csd * csd)) / df;
  if (!Number.isFinite(pooledVariance) || pooledVariance <= 0) return { ok: false, reason: 'SMD 合并标准差无效' };
  const d = (tm - cm) / Math.sqrt(pooledVariance);
  const correction = 1 - (3 / (4 * df - 1));
  const yi = direction * correction * d;
  const vi = (tn + cn) / (tn * cn) + (yi * yi) / (2 * (tn + cn - 2));
  if (!Number.isFinite(vi) || vi <= 0) return { ok: false, reason: 'SMD 方差无效' };
  return { ok: true, yi, vi };
}

function summarizeEffects(effectRows: EffectRow[]): MetaSummary[] {
  const byOutcome = new Map<string, EffectRow[]>();
  effectRows.forEach(row => {
    const key = row.outcome_id;
    byOutcome.set(key, [...(byOutcome.get(key) || []), row]);
  });

  return Array.from(byOutcome.entries())
    .map(([outcomeId, rows]) => summarizeEffectGroup(outcomeId, rows))
    .sort((a, b) => b.k - a.k);
}

function summarizeSubgroups(effectRows: EffectRow[], subgroupColumns: string[]): MetaSubgroupSummary[] {
  const selectedColumns = Array.from(new Set(normalizeStringArray(subgroupColumns)));
  if (selectedColumns.length === 0) return [];
  const summaries: MetaSubgroupSummary[] = [];
  const byOutcome = new Map<string, EffectRow[]>();
  effectRows.forEach(row => {
    byOutcome.set(row.outcome_id, [...(byOutcome.get(row.outcome_id) || []), row]);
  });

  byOutcome.forEach((outcomeRows, outcomeId) => {
    selectedColumns.forEach(column => {
      const byLevel = new Map<string, EffectRow[]>();
      outcomeRows.forEach(row => {
        const raw = row.moderators ? row.moderators[column] : undefined;
        const level = stringifyCell(raw);
        if (!level) return;
        byLevel.set(level, [...(byLevel.get(level) || []), row]);
      });
      if (byLevel.size < 2) return;
      byLevel.forEach((rows, level) => {
        const studyCount = new Set(rows.map(row => row.study_id)).size;
        if (rows.length < META_SUBGROUP_MIN_EFFECTS || studyCount < META_SUBGROUP_MIN_STUDIES) return;
        summaries.push({
          ...summarizeEffectGroup(outcomeId, rows),
          subgroupColumn: column,
          subgroupLevel: level,
        });
      });
    });
  });

  return summaries.sort((a, b) => {
    if (a.outcomeLabel !== b.outcomeLabel) return a.outcomeLabel.localeCompare(b.outcomeLabel);
    if (a.subgroupColumn !== b.subgroupColumn) return a.subgroupColumn.localeCompare(b.subgroupColumn);
    return b.k - a.k;
  });
}

function summarizeEffectGroup(outcomeId: string, rows: EffectRow[]): MetaSummary {
  const meanOnly = rows.length > 0 && rows.every(row => isMeanOnlyMeasure(row.measure) || !Number.isFinite(row.vi) || row.vi <= 0);
  if (meanOnly) {
    const bootstrap = estimatePooledMeanOnly(rows, MEAN_ONLY_BOOTSTRAP_ITERATIONS);
    return {
      outcomeId,
      outcomeLabel: rows[0]?.outcome_label || outcomeId,
      measure: rows[0]?.measure || 'lnRR_mean_only',
      k: rows.length,
      fixed: bootstrap,
      random: bootstrap,
      heterogeneity: {
        q: Number.NaN,
        df: Math.max(0, rows.length - 1),
        i2: Number.NaN,
        tau2: Number.NaN,
      },
    };
  }
  const fixed = estimatePooled(rows, 0);
  const q = rows.reduce((sum, row) => sum + (1 / row.vi) * Math.pow(row.yi - fixed.estimate, 2), 0);
  const df = Math.max(0, rows.length - 1);
  const weights = rows.map(row => 1 / row.vi);
  const sumW = weights.reduce((sum, item) => sum + item, 0);
  const sumW2 = weights.reduce((sum, item) => sum + item * item, 0);
  const c = sumW > 0 ? sumW - (sumW2 / sumW) : 0;
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0;
  const random = estimatePooled(rows, tau2);
  const i2 = q > 0 ? Math.max(0, ((q - df) / q) * 100) : 0;
  return {
    outcomeId,
    outcomeLabel: rows[0]?.outcome_label || outcomeId,
    measure: rows[0]?.measure || 'lnRR',
    k: rows.length,
    fixed,
    random,
    heterogeneity: {
      q,
      df,
      i2,
      tau2,
    },
  };
}

function estimatePooledMeanOnly(rows: EffectRow[], iterations: number): SummaryEstimate {
  const clusterValues = new Map<string, number[]>();
  rows.forEach((row, index) => {
    if (!Number.isFinite(row.yi)) return;
    const clusterId = stringifyCell(row.cluster_id || row.study_id) || `cluster_${index + 1}`;
    clusterValues.set(clusterId, [...(clusterValues.get(clusterId) || []), row.yi]);
  });
  const values = Array.from(clusterValues.values())
    .map(items => mean(items.filter(value => Number.isFinite(value))))
    .filter(value => Number.isFinite(value));
  const estimate = mean(values);
  const bootstrap = bootstrapMeans(values, iterations);
  const se = sampleSd(bootstrap);
  const ciLower = quantileSorted(bootstrap, 0.025);
  const ciUpper = quantileSorted(bootstrap, 0.975);
  const z = se > 0 ? estimate / se : Number.NaN;
  const p = Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : Number.NaN;
  return {
    estimate,
    se,
    ciLower,
    ciUpper,
    z,
    p,
    method: 'mean-only equal-cluster non-parametric bootstrap',
    bootstrapIterations: iterations,
    clusterCount: values.length,
  };
}

function estimatePooled(rows: EffectRow[], tau2: number): SummaryEstimate {
  const weights = rows.map(row => 1 / (row.vi + tau2));
  const sumW = weights.reduce((sum, item) => sum + item, 0);
  const estimate = sumW > 0
    ? rows.reduce((sum, row, index) => sum + weights[index] * row.yi, 0) / sumW
    : Number.NaN;
  const se = sumW > 0 ? Math.sqrt(1 / sumW) : Number.NaN;
  const z = se > 0 ? estimate / se : Number.NaN;
  const p = Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : Number.NaN;
  return {
    estimate,
    se,
    ciLower: estimate - 1.96 * se,
    ciUpper: estimate + 1.96 * se,
    z,
    p,
  };
}

function mean(values: number[]): number {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleSd(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (values.length - 1);
  return variance >= 0 ? Math.sqrt(variance) : Number.NaN;
}

function bootstrapMeans(values: number[], iterations: number): number[] {
  if (!values.length) return [];
  if (values.length === 1) return Array.from({ length: Math.max(1, iterations) }, () => values[0]);
  const rng = createSeededRandom(values);
  const results: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let total = 0;
    for (let j = 0; j < values.length; j += 1) {
      const index = Math.floor(rng() * values.length);
      total += values[Math.max(0, Math.min(values.length - 1, index))];
    }
    results.push(total / values.length);
  }
  return results.sort((a, b) => a - b);
}

function createSeededRandom(values: number[]): () => number {
  let seed = 2166136261;
  values.forEach(value => {
    const scaled = Math.floor(Math.abs(value) * 1000000);
    seed ^= scaled;
    seed = Math.imul(seed, 16777619);
  });
  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function quantileSorted(sortedValues: number[], probability: number): number {
  if (!sortedValues.length) return Number.NaN;
  if (sortedValues.length === 1) return sortedValues[0];
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  const weight = position - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function buildRunQualityReport(
  dataset: FlattenedDataset,
  effectRows: EffectRow[],
  skippedRows: SkippedEffectRow[],
  config: Required<MetaRunConfig>,
): { warnings: string[]; checks: Array<{ label: string; status: 'ok' | 'warn'; message: string }> } {
  const warnings: string[] = [];
  const checks: Array<{ label: string; status: 'ok' | 'warn'; message: string }> = [];
  const uniqueStudies = new Set(effectRows.map(row => row.study_id)).size;
  const outcomes = new Set(effectRows.map(row => row.outcome_id)).size;
  const uniqueClusters = new Set(effectRows.map(row => row.cluster_id || row.study_id)).size;

  checks.push({
    label: '效应量行',
    status: effectRows.length >= Math.max(3, config.minCompleteRows) ? 'ok' : 'warn',
    message: `生成 ${effectRows.length} 行效应量，来自 ${uniqueStudies} 个研究，覆盖 ${outcomes} 个因变量。`,
  });

  const meanOnlyCount = effectRows.filter(row => isMeanOnlyMeasure(row.measure) || !Number.isFinite(row.vi) || row.vi <= 0).length;
  if (meanOnlyCount > 0) {
    checks.push({
      label: '无 SD/SE mean-only 分析',
      status: 'warn',
      message: `${meanOnlyCount} 行效应量先在 ${uniqueClusters} 个研究/聚类内等权汇总，再按研究/聚类执行非参数 bootstrap；未使用 SD/SE 逆方差权重，I²/tau² 等异质性指标不适用。`,
    });
    warnings.push('存在无 SD/SE 的 mean-only 研究级聚类 bootstrap 结果。请在论文中明确说明这是无方差信息时的替代方案，不能解释为常规逆方差加权 Meta 分析。');
    if (uniqueClusters < 3) {
      warnings.push('mean-only 结果的独立研究/聚类少于 3 个，聚类 bootstrap 置信区间不稳定，只应作描述性展示。');
    }
  }
  checks.push({
    label: '跳过行',
    status: skippedRows.length === 0 ? 'ok' : 'warn',
    message: `原始 ${dataset.rows.length} 行中有 ${skippedRows.length} 个效应量组合被跳过。`,
  });

  const duplicateKeys = new Map<string, number>();
  effectRows.forEach(row => {
    const key = [row.outcome_id, row.study_id, row.obs_id, row.yi.toFixed(8)].join('|');
    duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
  });
  const duplicateCount = Array.from(duplicateKeys.values()).filter(count => count > 1).length;
  checks.push({
    label: '重复效应量',
    status: duplicateCount === 0 ? 'ok' : 'warn',
    message: duplicateCount === 0 ? '未发现明显重复效应量键。' : `发现 ${duplicateCount} 组疑似重复效应量，请核查是否同一观测被重复编码。`,
  });

  if (config.columnPreprocess.length > 0) {
    checks.push({
      label: '数据列预处理',
      status: 'ok',
      message: config.columnPreprocess
        .map(item => `${item.column} 按范围分组：${item.spec}`)
        .join('；'),
    });
  }

  if (config.subgroupColumns.length > 0) {
    config.subgroupColumns.forEach(column => {
      const levels = new Map<string, number>();
      effectRows.forEach(row => {
        const level = stringifyCell(row.moderators ? row.moderators[column] : '');
        if (!level) return;
        levels.set(level, (levels.get(level) || 0) + 1);
      });
      const levelStudyCounts = new Map<string, Set<string>>();
      effectRows.forEach(row => {
        const level = stringifyCell(row.moderators ? row.moderators[column] : '');
        if (!level) return;
        if (!levelStudyCounts.has(level)) levelStudyCounts.set(level, new Set());
        levelStudyCounts.get(level)?.add(row.study_id);
      });
      const usableLevels = Array.from(levels.entries())
        .filter(([level, count]) => count >= META_SUBGROUP_MIN_EFFECTS && (levelStudyCounts.get(level)?.size || 0) >= META_SUBGROUP_MIN_STUDIES)
        .length;
      checks.push({
        label: `亚组变量：${column}`,
        status: usableLevels >= 2 ? 'ok' : 'warn',
        message: usableLevels >= 2
          ? `识别到 ${levels.size} 个水平，其中 ${usableLevels} 个水平达到可报告门槛（每水平至少 ${META_SUBGROUP_MIN_EFFECTS} 个效应量、${META_SUBGROUP_MIN_STUDIES} 篇研究）。`
          : `识别到 ${levels.size} 个水平，但有效水平不足；每个可报告亚组默认要求至少 ${META_SUBGROUP_MIN_EFFECTS} 个效应量、${META_SUBGROUP_MIN_STUDIES} 篇研究。`,
      });
    });
  }

  const byOutcome = new Map<string, number>();
  effectRows.forEach(row => byOutcome.set(row.outcome_label, (byOutcome.get(row.outcome_label) || 0) + 1));
  byOutcome.forEach((count, label) => {
    if (count < 3) warnings.push(`${label} 有效效应量少于 3，建议补充数据或仅做描述性展示。`);
  });
  if (uniqueStudies < effectRows.length) {
    warnings.push('同一研究包含多个效应量：mean-only 使用研究级等权聚类 bootstrap；标准方差型数据的 R 模型使用多层随机效应并输出 CR2 聚类稳健检验。');
  }
  if (skippedRows.length > 0) warnings.push('存在被跳过的原始行，请优先核查均值、SD、n、lnRR 正值约束和图像数字化来源；mean-only 模式只要求处理组/对照组均值。');

  const addEvidenceCoverageCheck = (
    label: string,
    pattern: RegExp,
    missingMessage: string,
  ) => {
    const columns = dataset.columns.filter(column => pattern.test(String(column || '')));
    if (columns.length === 0) {
      checks.push({ label, status: 'warn', message: missingMessage });
      return;
    }
    const coveredRows = dataset.rows.filter(row =>
      columns.some(column => stringifyCell(row[column]).length > 0)
    ).length;
    const coverage = dataset.rows.length > 0 ? coveredRows / dataset.rows.length : 0;
    checks.push({
      label,
      status: coverage >= 0.8 ? 'ok' : 'warn',
      message: `检测到字段 ${columns.join('、')}；已填写 ${coveredRows}/${dataset.rows.length} 行（${Math.round(coverage * 100)}%）。`,
    });
  };

  addEvidenceCoverageCheck(
    '偏倚风险评价',
    /(?:^|[_\s-])(?:risk[_\s-]*of[_\s-]*bias|rob(?:2)?|quality[_\s-]*(?:score|assessment))(?:$|[_\s-])|偏倚风险|质量评价|质量评分/i,
    '当前编码表未检测到偏倚风险/研究质量字段；合并效应可计算，但正式报告前仍需独立完成研究层面的偏倚风险评价。',
  );
  addEvidenceCoverageCheck(
    '证据确定性（GRADE）',
    /(?:^|[_\s-])(?:grade|certainty|evidence[_\s-]*quality)(?:$|[_\s-])|证据确定性|证据质量/i,
    '当前编码表未检测到 GRADE/证据确定性字段；不要把统计显著性直接解释为高确定性证据。',
  );

  return { warnings: Array.from(new Set(warnings)), checks };
}

function buildEffectRowsCsv(effectRows: EffectRow[]): string {
  const moderatorColumns = Array.from(new Set(effectRows.flatMap(row => Object.keys(row.moderators))));
  const columns = [
    'outcome_id',
    'outcome_label',
    'measure',
    'study_id',
    'cluster_id',
    'contrast_id',
    'contrast_label',
    'pdf_id',
    'pdf_title',
    'pdf_file',
    'row_index',
    'obs_id',
    'yi',
    'vi',
    'sei',
    'weight',
    'treatment_mean',
    'treatment_sd',
    'treatment_n',
    'control_mean',
    'control_sd',
    'control_n',
    'effect_label',
    'source',
    'location',
    'evidence',
    ...moderatorColumns,
  ];

  const lines = [columns.map(csvEscape).join(',')];
  for (const row of effectRows) {
    const record: Record<string, unknown> = {
      outcome_id: row.outcome_id,
      outcome_label: row.outcome_label,
      measure: row.measure,
      study_id: row.study_id,
      cluster_id: row.cluster_id,
      contrast_id: row.contrast_id,
      contrast_label: row.contrast_label,
      pdf_id: row.pdf_id,
      pdf_title: row.pdf_title,
      pdf_file: row.pdf_file,
      row_index: row.row_index,
      obs_id: row.obs_id,
      yi: row.yi,
      vi: row.vi,
      sei: row.sei,
      weight: row.weight,
      treatment_mean: row.treatment_mean,
      treatment_sd: row.treatment_sd,
      treatment_n: row.treatment_n,
      control_mean: row.control_mean,
      control_sd: row.control_sd,
      control_n: row.control_n,
      effect_label: row.effect_label,
      source: row.source,
      location: row.location,
      evidence: row.evidence,
      ...row.moderators,
    };
    lines.push(columns.map(column => csvEscape(record[column])).join(','));
  }
  return lines.join('\n');
}

function buildMetaAnalysisRCode(config: Required<MetaRunConfig>, effectRows: EffectRow[]): string {
  const moderatorColumns = Array.from(new Set(effectRows.flatMap(row => Object.keys(row.moderators))));
  const subgroupColumns = Array.from(new Set((config.subgroupColumns || []).filter(column => moderatorColumns.includes(column))));
  const method = config.method || 'REML';
  const script = [
    '# Scholar Harness Meta analysis workflow',
    '# Data file uploaded by the app: meta_effect_sizes.csv',
    'options(stringsAsFactors = FALSE)',
    'options(repos = c(CRAN = "https://cloud.r-project.org"))',
    'required_packages <- c("metafor", "ggplot2")',
    'optional_packages <- c("clubSandwich")',
    'missing_packages <- required_packages[!vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)]',
    'if (length(missing_packages) > 0) stop(paste("Missing R packages:", paste(missing_packages, collapse = ", ")))',
    'missing_optional_packages <- optional_packages[!vapply(optional_packages, requireNamespace, logical(1), quietly = TRUE)]',
    'if (length(missing_optional_packages) > 0) cat("Optional R packages missing:", paste(missing_optional_packages, collapse = ", "), "- cluster-robust tests will be skipped.\\n")',
    'library(metafor)',
    'library(ggplot2)',
    'pdf_device <- if (isTRUE(capabilities("cairo"))) grDevices::cairo_pdf else grDevices::pdf',
    'plot_base_family <- if (.Platform$OS.type == "windows") "Microsoft YaHei" else ""',
    'dir.create("plots", showWarnings = FALSE, recursive = TRUE)',
    'safe_plot_height <- function(height, min_height = 3.2, max_height = 48) {',
    '  value <- suppressWarnings(as.numeric(height)[1])',
    '  if (!is.finite(value)) value <- min_height',
    '  max(min_height, min(max_height, value))',
    '}',
    'data_path <- "meta_effect_sizes.csv"',
    'dat <- read.csv(data_path, check.names = FALSE, stringsAsFactors = FALSE, fileEncoding = "UTF-8-BOM")',
    'if (!all(c("yi", "vi", "outcome_id", "study_id") %in% names(dat))) stop("Effect-size data is missing required columns.")',
    'dat$yi <- as.numeric(dat$yi)',
    'dat$vi <- as.numeric(dat$vi)',
    'if (!"cluster_id" %in% names(dat)) dat$cluster_id <- dat$study_id',
    'dat$cluster_id[is.na(dat$cluster_id) | dat$cluster_id == ""] <- dat$study_id[is.na(dat$cluster_id) | dat$cluster_id == ""]',
    'dat$cluster_id <- as.character(dat$cluster_id)',
    'dat$mean_only <- grepl("mean_only", dat$measure, ignore.case = TRUE) | !is.finite(dat$vi) | dat$vi <= 0',
    'dat$sei <- ifelse(is.finite(dat$vi) & dat$vi > 0, sqrt(dat$vi), NA_real_)',
    'dat <- dat[is.finite(dat$yi) & (dat$mean_only | (is.finite(dat$vi) & dat$vi > 0)), , drop = FALSE]',
    `meta_model_type <- ${JSON.stringify(config.model)}`,
    `meta_method <- ${JSON.stringify(method)}`,
    `moderator_cols <- c(${moderatorColumns.map(item => JSON.stringify(item)).join(', ')})`,
    'moderator_cols <- moderator_cols[moderator_cols %in% names(dat)]',
    `subgroup_cols <- c(${subgroupColumns.map(item => JSON.stringify(item)).join(', ')})`,
    'subgroup_cols <- subgroup_cols[subgroup_cols %in% names(dat)]',
    'analysis_cols <- unique(c(moderator_cols, subgroup_cols))',
    'for (mod in analysis_cols) {',
    '  numeric_try <- suppressWarnings(as.numeric(dat[[mod]]))',
    '  if (sum(is.finite(numeric_try)) >= max(3, ceiling(sum(!is.na(dat[[mod]])) * 0.7))) {',
    '    dat[[mod]] <- numeric_try',
    '  } else {',
    '    dat[[mod]] <- as.factor(dat[[mod]])',
    '  }',
    '}',
    'quote_name <- function(x) paste0("`", gsub("`", "", x), "`")',
    'fit_main_model <- function(d) {',
    '  d$effect_uid <- seq_len(nrow(d))',
    '  if (meta_model_type == "fixed") {',
    '    return(metafor::rma(yi = yi, vi = vi, data = d, method = "FE"))',
    '  }',
    '  if (meta_model_type == "mixed" || anyDuplicated(d$cluster_id)) {',
    '    return(metafor::rma.mv(yi = yi, V = vi, random = ~ 1 | cluster_id/effect_uid, data = d, method = meta_method))',
    '  }',
    '  metafor::rma(yi = yi, vi = vi, data = d, method = meta_method)',
    '}',
    'fit_moderator_model <- function(d, form) {',
    '  d$effect_uid <- seq_len(nrow(d))',
    '  if (meta_model_type == "fixed") {',
    '    return(metafor::rma(yi = yi, vi = vi, mods = form, data = d, method = "FE"))',
    '  }',
    '  if (meta_model_type == "mixed" || anyDuplicated(d$cluster_id)) {',
    '    return(metafor::rma.mv(yi = yi, V = vi, mods = form, random = ~ 1 | cluster_id/effect_uid, data = d, method = meta_method))',
    '  }',
    '  metafor::rma(yi = yi, vi = vi, mods = form, data = d, method = meta_method)',
    '}',
    'safe_slug <- function(x) {',
    '  x <- iconv(x, from = "", to = "ASCII//TRANSLIT", sub = "_")',
    '  x <- gsub("[^A-Za-z0-9_-]+", "_", x)',
    '  substr(gsub("_+", "_", x), 1, 80)',
    '}',
    'first_num <- function(x) {',
    '  y <- suppressWarnings(as.numeric(x))',
    '  if (length(y) == 0 || !is.finite(y[1])) return(NA_real_)',
    '  y[1]',
    '}',
    `min_subgroup_k <- ${META_SUBGROUP_MIN_EFFECTS}`,
    `min_subgroup_studies <- ${META_SUBGROUP_MIN_STUDIES}`,
    `max_subgroup_plot_levels <- ${META_SUBGROUP_MAX_PLOT_LEVELS}`,
    `bootstrap_iterations <- ${MEAN_ONLY_BOOTSTRAP_ITERATIONS}`,
    'bootstrap_cluster_mean <- function(d, iterations = bootstrap_iterations) {',
    '  d <- d[is.finite(d$yi) & !is.na(d$cluster_id) & d$cluster_id != "", c("cluster_id", "yi"), drop = FALSE]',
    '  cluster_means <- vapply(split(d$yi, d$cluster_id), mean, numeric(1), na.rm = TRUE)',
    '  cluster_means <- cluster_means[is.finite(cluster_means)]',
    '  if (length(cluster_means) == 0) return(data.frame(estimate = NA_real_, se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_, clusters = 0))',
    '  if (length(cluster_means) == 1) return(data.frame(estimate = cluster_means[1], se = NA_real_, ci_lower = cluster_means[1], ci_upper = cluster_means[1], clusters = 1))',
    '  set.seed(20260609)',
    '  boots <- replicate(iterations, mean(sample(cluster_means, size = length(cluster_means), replace = TRUE)))',
    '  data.frame(estimate = mean(cluster_means), se = stats::sd(boots), ci_lower = stats::quantile(boots, 0.025, names = FALSE), ci_upper = stats::quantile(boots, 0.975, names = FALSE), clusters = length(cluster_means))',
    '}',
    'make_mean_only_row <- function(d, outcome_id, outcome_label, subgroup_col = "", subgroup_level = "") {',
    '  boot <- bootstrap_cluster_mean(d)',
    '  data.frame(outcome_id = outcome_id, outcome_label = outcome_label, subgroup_column = subgroup_col, subgroup_level = subgroup_level, k = nrow(d), studies = length(unique(d$study_id)), clusters = boot$clusters[1], estimate = boot$estimate[1], se = boot$se[1], ci_lower = boot$ci_lower[1], ci_upper = boot$ci_upper[1], pi_lower = NA_real_, pi_upper = NA_real_, z = NA_real_, p = NA_real_, tau2 = NA_real_, method = "mean-only equal-cluster bootstrap", stringsAsFactors = FALSE)',
    '}',
    'estimate_row <- function(fit, outcome_id, outcome_label, subgroup_col, subgroup_level, k, studies, clusters) {',
    '  prediction <- try(stats::predict(fit), silent = TRUE)',
    '  pi_lower <- if (!inherits(prediction, "try-error") && !is.null(prediction$pi.lb)) first_num(prediction$pi.lb) else NA_real_',
    '  pi_upper <- if (!inherits(prediction, "try-error") && !is.null(prediction$pi.ub)) first_num(prediction$pi.ub) else NA_real_',
    '  data.frame(',
    '    outcome_id = outcome_id,',
    '    outcome_label = outcome_label,',
    '    subgroup_column = subgroup_col,',
    '    subgroup_level = subgroup_level,',
    '    k = k,',
    '    studies = studies,',
    '    clusters = clusters,',
    '    estimate = first_num(fit$b),',
    '    se = first_num(fit$se),',
    '    ci_lower = first_num(fit$ci.lb),',
    '    ci_upper = first_num(fit$ci.ub),',
    '    pi_lower = pi_lower,',
    '    pi_upper = pi_upper,',
    '    z = first_num(fit$zval),',
    '    p = first_num(fit$pval),',
    '    tau2 = if (!is.null(fit$tau2)) first_num(fit$tau2) else if (!is.null(fit$sigma2)) sum(suppressWarnings(as.numeric(fit$sigma2)), na.rm = TRUE) else NA_real_,',
    '    stringsAsFactors = FALSE',
    '  )',
    '}',
    'plot_label <- function(x, max_chars = 56) {',
    '  x <- gsub("\\\\s+", " ", as.character(x))',
    '  x <- trimws(x)',
    '  ifelse(nchar(x) > max_chars, paste0(substr(x, 1, max_chars - 3), "..."), x)',
    '}',
    'plot_pooled_effect_summary <- function(summary_table, title_text, include_subgroup = TRUE, max_rows = max_subgroup_plot_levels) {',
    '  st <- summary_table[is.finite(summary_table$estimate) & is.finite(summary_table$ci_lower) & is.finite(summary_table$ci_upper), , drop = FALSE]',
    '  if (nrow(st) == 0) return(NULL)',
    '  has_subgroup <- include_subgroup && any(!is.na(st$subgroup_column) & st$subgroup_column != "")',
    '  if (has_subgroup) {',
    '    st <- st[order(-st$studies, -st$k, st$subgroup_level), , drop = FALSE]',
    '    if (nrow(st) > max_rows) st <- st[seq_len(max_rows), , drop = FALSE]',
    '    st <- st[order(st$estimate), , drop = FALSE]',
    '    st$display_label <- paste0(plot_label(st$subgroup_level), " (k=", st$k, ", studies=", st$studies, ")")',
    '  } else {',
    '    st <- st[order(st$estimate), , drop = FALSE]',
    '    st$display_label <- paste0(plot_label(st$outcome_label), " (k=", st$k, ", studies=", st$studies, ")")',
    '  }',
    '  st$display_label <- factor(st$display_label, levels = rev(unique(st$display_label)))',
    '  ggplot2::ggplot(st, ggplot2::aes(x = estimate, y = display_label)) +',
    '    ggplot2::geom_vline(xintercept = 0, linetype = 2, color = "grey60") +',
    '    ggplot2::geom_segment(ggplot2::aes(x = ci_lower, xend = ci_upper, yend = display_label), linewidth = 0.8, color = "#334155") +',
    '    ggplot2::geom_point(size = 3.2, color = "#0f766e") +',
    '    ggplot2::labs(x = "Pooled effect size", y = NULL, title = title_text, subtitle = "Point = pooled effect; horizontal bar = 95% CI") +',
    '    ggplot2::theme_bw(base_size = 11, base_family = plot_base_family) +',
    '    ggplot2::theme(panel.grid.major.y = ggplot2::element_blank(), axis.text.y = ggplot2::element_text(size = 9))',
    '}',
    'aggregate_cluster_effects <- function(d) {',
    '  rows <- lapply(split(d, d$cluster_id), function(dd) {',
    '    dd <- dd[is.finite(dd$yi) & is.finite(dd$vi) & dd$vi > 0, , drop = FALSE]',
    '    if (nrow(dd) == 0) return(NULL)',
    '    fit <- try(metafor::rma(yi = yi, vi = vi, data = dd, method = "FE"), silent = TRUE)',
    '    if (inherits(fit, "try-error")) return(NULL)',
    '    data.frame(cluster_id = as.character(dd$cluster_id[1]), study_id = as.character(dd$study_id[1]), k = nrow(dd), yi = first_num(fit$b), vi = first_num(fit$se)^2, sei = first_num(fit$se), ci_lower = first_num(fit$ci.lb), ci_upper = first_num(fit$ci.ub), stringsAsFactors = FALSE)',
    '  })',
    '  rows <- rows[!vapply(rows, is.null, logical(1))]',
    '  if (length(rows) == 0) return(data.frame())',
    '  do.call(rbind, rows)',
    '}',
    'plot_cluster_forest <- function(cluster_dat, title_text) {',
    '  if (nrow(cluster_dat) == 0) return(NULL)',
    '  cluster_dat <- cluster_dat[order(cluster_dat$yi), , drop = FALSE]',
    '  cluster_dat$display_label <- paste0(plot_label(cluster_dat$study_id), " (k=", cluster_dat$k, ")")',
    '  cluster_dat$display_label <- factor(cluster_dat$display_label, levels = rev(cluster_dat$display_label))',
    '  ggplot2::ggplot(cluster_dat, ggplot2::aes(x = yi, y = display_label)) +',
    '    ggplot2::geom_vline(xintercept = 0, linetype = 2, color = "grey60") +',
    '    ggplot2::geom_segment(ggplot2::aes(x = ci_lower, xend = ci_upper, yend = display_label), linewidth = 0.7, color = "#475569") +',
    '    ggplot2::geom_point(size = 2.6, color = "#0f766e") +',
    '    ggplot2::labs(x = "Study/cluster effect size", y = NULL, title = title_text, subtitle = "Multiple effects are first combined within study/cluster using a fixed-effect model") +',
    '    ggplot2::theme_bw(base_size = 10, base_family = plot_base_family) +',
    '    ggplot2::theme(panel.grid.major.y = ggplot2::element_blank(), axis.text.y = ggplot2::element_text(size = 8))',
    '}',
    'plot_cluster_funnel <- function(cluster_dat, pooled_estimate, title_text) {',
    '  if (nrow(cluster_dat) < 10) return(NULL)',
    '  ggplot2::ggplot(cluster_dat, ggplot2::aes(x = yi, y = sei)) +',
    '    ggplot2::geom_vline(xintercept = pooled_estimate, linetype = 2, color = "#0f766e") +',
    '    ggplot2::geom_point(size = 2.4, alpha = 0.78, color = "#334155") +',
    '    ggplot2::scale_y_reverse() +',
    '    ggplot2::labs(x = "Study/cluster effect size", y = "Standard error", title = title_text, subtitle = "Exploratory funnel plot based on independent study/cluster summaries") +',
    '    ggplot2::theme_bw(base_size = 11, base_family = plot_base_family)',
    '}',
    'save_plot_pair <- function(plot, stem, width = 8.5, height = 6) {',
    '  if (is.null(plot)) return(invisible(FALSE))',
    '  ggplot2::ggsave(file.path("plots", paste0(stem, ".png")), plot, width = width, height = safe_plot_height(height), dpi = 600, bg = "white")',
    '  ggplot2::ggsave(file.path("plots", paste0(stem, ".pdf")), plot, width = width, height = safe_plot_height(height), device = pdf_device, bg = "white")',
    '  invisible(TRUE)',
    '}',
    'sink(file.path("plots", "meta_model_summary.txt"))',
    'cat("Scholar Harness Meta Analysis\\n")',
    'cat("Rows:", nrow(dat), "\\n")',
    'cat("Model:", meta_model_type, " Method:", meta_method, "\\n")',
    'cat("Outcomes:", paste(unique(dat$outcome_label), collapse = ", "), "\\n\\n")',
    'model_summaries <- list()',
    'mean_only_summaries <- list()',
    'overall_effect_summaries <- list()',
    'pooled_effect_summaries <- list()',
    'for (outcome in unique(dat$outcome_id)) {',
    '  d <- dat[dat$outcome_id == outcome, , drop = FALSE]',
    '  d <- d[order(d$study_id, d$row_index), , drop = FALSE]',
    '  label <- if ("outcome_label" %in% names(d)) unique(d$outcome_label)[1] else outcome',
    '  slug <- safe_slug(outcome)',
    '  cat("\\n==============================\\n")',
    '  cat("Outcome:", label, "(", outcome, ")\\n")',
    '  cat("Effect sizes:", nrow(d), " Studies:", length(unique(d$study_id)), "\\n")',
    '  if (nrow(d) < 2) { cat("Skipped: fewer than 2 effect sizes.\\n"); next }',
    '  if (all(d$mean_only)) {',
    '    cat("Mean-only equal-cluster bootstrap mode: effects are averaged within cluster_id, then clusters receive equal weight; no SD/SE inverse-variance weights are used.\\n")',
    '    mean_row <- make_mean_only_row(d, outcome, label)',
    '    print(mean_row)',
    '    mean_only_summaries[[outcome]] <- mean_row',
    '    overall_effect_summaries[[outcome]] <- mean_row',
    '    pooled_effect_summaries[[outcome]] <- mean_row',
    '    p_pooled <- plot_pooled_effect_summary(mean_row, paste("Pooled meta-analysis effect:", label), include_subgroup = FALSE)',
    '    if (!is.null(p_pooled)) {',
    '      ggplot2::ggsave(file.path("plots", paste0(slug, "_pooled_effect.png")), p_pooled, width = 8.5, height = 3.8, dpi = 600, bg = "white")',
    '      ggplot2::ggsave(file.path("plots", paste0(slug, "_pooled_effect.pdf")), p_pooled, width = 8.5, height = 3.8, device = pdf_device, bg = "white")',
    '    }',
    '    cat("Funnel, Egger, Baujat and conventional heterogeneity diagnostics are not applicable to mean-only data; reporting pooled and subgroup clustered-bootstrap effects only.\\n")',
    '    for (subgroup_col in subgroup_cols) {',
    '      if (is.numeric(d[[subgroup_col]])) { cat("Subgroup skipped:", subgroup_col, "is numeric; use moderator/meta-regression or define range groups first.\\n"); next }',
    '      levels <- unique(d[[subgroup_col]][!is.na(d[[subgroup_col]]) & d[[subgroup_col]] != ""])',
    '      if (length(levels) < 2) next',
    '      rows <- list()',
    '      for (level in levels) {',
    '        dd <- d[d[[subgroup_col]] == level, , drop = FALSE]',
    '        studies_n <- length(unique(dd$study_id))',
    '        if (nrow(dd) >= min_subgroup_k && studies_n >= min_subgroup_studies) {',
    '          rows[[as.character(level)]] <- make_mean_only_row(dd, outcome, label, subgroup_col, as.character(level))',
    '        } else {',
    '          cat("  Skipped", as.character(level), ": k=", nrow(dd), ", studies=", studies_n, "; below subgroup reporting threshold.\\n")',
    '        }',
    '      }',
    '      if (length(rows) >= 2) {',
    '        subgroup_table <- do.call(rbind, rows)',
    '        mean_only_summaries[[paste(outcome, subgroup_col, sep = "_")]] <- subgroup_table',
    '        pooled_effect_summaries[[paste(outcome, subgroup_col, "subgroups", sep = "_")]] <- subgroup_table',
    '        subgroup_slug <- safe_slug(paste0(outcome, "_", subgroup_col, "_mean_only_subgroup_pooled"))',
    '        write.csv(subgroup_table, file.path("plots", paste0(subgroup_slug, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")',
    '        psub <- plot_pooled_effect_summary(subgroup_table, paste("Subgroup pooled effects:", label, "by", subgroup_col), include_subgroup = TRUE)',
    '        if (!is.null(psub)) {',
    '          plot_height <- safe_plot_height(max(4.2, 0.42 * min(nrow(subgroup_table), max_subgroup_plot_levels) + 1.8), max_height = 8.5)',
    '          ggplot2::ggsave(file.path("plots", paste0(subgroup_slug, ".png")), psub, width = 8.5, height = plot_height, dpi = 600, bg = "white")',
    '          ggplot2::ggsave(file.path("plots", paste0(subgroup_slug, ".pdf")), psub, width = 8.5, height = plot_height, device = pdf_device, bg = "white")',
    '        }',
    '      } else {',
    '        cat("Subgroup analysis skipped for", subgroup_col, ": fewer than 2 reportable subgroup levels.\\n")',
    '      }',
    '    }',
    '    next',
    '  }',
    '  d <- d[!d$mean_only & is.finite(d$vi) & d$vi > 0, , drop = FALSE]',
    '  if (nrow(d) < 2) { cat("Skipped: fewer than 2 inverse-variance effect sizes after excluding mean-only rows.\\n"); next }',
    '  fit <- fit_main_model(d)',
    '  print(summary(fit))',
    '  main_summary_row <- estimate_row(fit, outcome, label, "", "", nrow(d), length(unique(d$study_id)), length(unique(d$cluster_id)))',
    '  model_summaries[[outcome]] <- main_summary_row',
    '  overall_effect_summaries[[outcome]] <- main_summary_row',
    '  pooled_effect_summaries[[outcome]] <- main_summary_row',
    '  p_pooled <- plot_pooled_effect_summary(main_summary_row, paste("Pooled meta-analysis effect:", label), include_subgroup = FALSE)',
    '  if (!is.null(p_pooled)) {',
    '    ggplot2::ggsave(file.path("plots", paste0(slug, "_pooled_effect.png")), p_pooled, width = 8.5, height = 3.8, dpi = 600, bg = "white")',
    '    ggplot2::ggsave(file.path("plots", paste0(slug, "_pooled_effect.pdf")), p_pooled, width = 8.5, height = 3.8, device = pdf_device, bg = "white")',
    '  }',
    '  if (length(unique(d$cluster_id)) < nrow(d) && requireNamespace("clubSandwich", quietly = TRUE)) {',
    '    cat("\\nCluster-robust variance by cluster_id:\\n")',
    '    print(try(clubSandwich::coef_test(fit, vcov = "CR2", cluster = d$cluster_id), silent = TRUE))',
    '  }',
    '  cluster_dat <- aggregate_cluster_effects(d)',
    '  if (nrow(cluster_dat) >= 1) {',
    '    write.csv(cluster_dat, file.path("plots", paste0(slug, "_study_cluster_effects.csv")), row.names = FALSE, fileEncoding = "UTF-8")',
    '    p_forest <- plot_cluster_forest(cluster_dat, paste("Study/cluster forest plot:", label))',
    '    forest_height <- safe_plot_height(0.34 * nrow(cluster_dat) + 2.4, max_height = 18)',
    '    save_plot_pair(p_forest, paste0(slug, "_study_cluster_forest"), width = 9, height = forest_height)',
    '  }',
    '  cluster_fit <- if (nrow(cluster_dat) >= 2) try(metafor::rma(yi = yi, vi = vi, slab = study_id, data = cluster_dat, method = if (meta_model_type == "fixed") "FE" else meta_method), silent = TRUE) else NULL',
    '  if (!is.null(cluster_fit) && !inherits(cluster_fit, "try-error") && nrow(cluster_dat) >= 10) {',
    '    p_funnel <- plot_cluster_funnel(cluster_dat, first_num(cluster_fit$b), paste("Funnel plot:", label))',
    '    save_plot_pair(p_funnel, paste0(slug, "_study_cluster_funnel"), width = 7, height = 6)',
    '    cat("\\nEgger regression test on independent study/cluster summaries:\\n")',
    '    print(try(metafor::regtest(cluster_fit, model = "rma"), silent = TRUE))',
    '  } else {',
    '    cat("\\nFunnel plot and Egger regression skipped: fewer than 10 independent study/cluster summaries.\\n")',
    '  }',
    '  if (!is.null(cluster_fit) && !inherits(cluster_fit, "try-error") && nrow(cluster_dat) >= 3) {',
    '    cat("\\nLeave-one-study/cluster-out diagnostics:\\n")',
    '    loo <- try(metafor::leave1out(cluster_fit), silent = TRUE)',
    '    print(loo)',
    '    try(write.csv(as.data.frame(loo), file.path("plots", paste0(slug, "_leave_one_study_out.csv")), row.names = FALSE), silent = TRUE)',
    '    baujat_png <- file.path("plots", paste0(slug, "_study_cluster_baujat.png"))',
    '    grDevices::png(baujat_png, width = 2200, height = 1800, res = 300, bg = "white")',
    '    baujat_result <- try(metafor::baujat(cluster_fit), silent = TRUE)',
    '    grDevices::dev.off()',
    '    baujat_pdf <- file.path("plots", paste0(slug, "_study_cluster_baujat.pdf"))',
    '    grDevices::pdf(baujat_pdf, width = 8, height = 6)',
    '    try(metafor::baujat(cluster_fit), silent = TRUE)',
    '    grDevices::dev.off()',
    '    if (inherits(baujat_result, "try-error")) cat("Baujat plot failed:", as.character(baujat_result), "\\n")',
    '  }',
    '  cat("Diagnostics use independent study/cluster summaries; the full row-level effect table remains available as CSV.\\n")',
    '  for (mod in moderator_cols) {',
    '    values <- d[[mod]]',
    '    if (length(unique(values[!is.na(values) & values != ""])) < 2 || nrow(d) < 4) next',
    '    form <- stats::as.formula(paste("~", quote_name(mod)))',
    '    mod_fit <- try(fit_moderator_model(d, form), silent = TRUE)',
    '    cat("\\nModerator:", mod, "\\n")',
    '    print(mod_fit)',
    '    if (!inherits(mod_fit, "try-error")) {',
    '      mod_slug <- safe_slug(paste0(outcome, "_", mod))',
    '      capture.output(summary(mod_fit), file = file.path("plots", paste0(mod_slug, "_meta_regression.txt")))',
    '      if (is.numeric(d[[mod]])) {',
    '        grid <- seq(min(d[[mod]], na.rm = TRUE), max(d[[mod]], na.rm = TRUE), length.out = 100)',
    '        pred <- try(stats::predict(mod_fit, newmods = matrix(grid, ncol = 1)), silent = TRUE)',
    '        if (!inherits(pred, "try-error")) {',
    '          pred_df <- data.frame(x = grid, estimate = as.numeric(pred$pred), ci_lower = as.numeric(pred$ci.lb), ci_upper = as.numeric(pred$ci.ub))',
    '          p_mod <- ggplot2::ggplot(d, ggplot2::aes(x = .data[[mod]], y = yi)) +',
    '            ggplot2::geom_point(ggplot2::aes(size = 1 / sqrt(vi)), alpha = 0.55, color = "#475569") +',
    '            ggplot2::geom_ribbon(data = pred_df, ggplot2::aes(x = x, ymin = ci_lower, ymax = ci_upper), inherit.aes = FALSE, alpha = 0.18, fill = "#0f766e") +',
    '            ggplot2::geom_line(data = pred_df, ggplot2::aes(x = x, y = estimate), inherit.aes = FALSE, linewidth = 1, color = "#0f766e") +',
    '            ggplot2::scale_size_continuous(range = c(1.5, 5), guide = "none") +',
    '            ggplot2::labs(x = mod, y = "Effect size", title = paste("Meta-regression:", label, "by", mod), subtitle = "Line and band are model prediction and 95% CI") +',
    '            ggplot2::theme_bw(base_size = 11, base_family = plot_base_family)',
    '          save_plot_pair(p_mod, paste0(mod_slug, "_meta_regression"), width = 7.5, height = 5.5)',
    '        }',
    '      } else {',
    '        cat("Categorical moderator summary saved as text; pooled levels are shown in subgroup plots when selected.\\n")',
    '      }',
    '    }',
    '  }',
    '  for (subgroup_col in subgroup_cols) {',
    '    if (is.numeric(d[[subgroup_col]])) { cat("Subgroup skipped:", subgroup_col, "is numeric; use moderator/meta-regression or define range groups first.\\n"); next }',
    '    group_values <- as.character(d[[subgroup_col]])',
    '    subgroup_levels <- unique(group_values[!is.na(group_values) & group_values != ""])',
    '    if (length(subgroup_levels) < 2) next',
    '    cat("\\nSubgroup analysis:", subgroup_col, "\\n")',
    '    subgroup_rows <- list()',
    '    for (subgroup_level in subgroup_levels) {',
    '      sd <- d[group_values == subgroup_level & !is.na(group_values), , drop = FALSE]',
    '      studies_n <- length(unique(sd$study_id))',
    '      if (nrow(sd) < min_subgroup_k || studies_n < min_subgroup_studies) { cat("  Skipped", subgroup_level, ": k=", nrow(sd), ", studies=", studies_n, "; below subgroup reporting threshold.\\n"); next }',
    '      sub_fit <- try(fit_main_model(sd), silent = TRUE)',
    '      cat("\\nSubgroup:", subgroup_col, "=", subgroup_level, " k=", nrow(sd), " studies=", length(unique(sd$study_id)), "\\n")',
    '      print(sub_fit)',
    '      if (!inherits(sub_fit, "try-error")) {',
    '        subgroup_rows[[length(subgroup_rows) + 1]] <- estimate_row(sub_fit, outcome, label, subgroup_col, subgroup_level, nrow(sd), length(unique(sd$study_id)), length(unique(sd$cluster_id)))',
    '        cat("  Subgroup pooled effect recorded; subgroup row-per-effect forest plot skipped.\\n")',
    '      }',
    '    }',
    '    if (length(subgroup_rows) >= 2) {',
    '      subgroup_table <- do.call(rbind, subgroup_rows)',
    '      pooled_effect_summaries[[paste(outcome, subgroup_col, "subgroups", sep = "_")]] <- subgroup_table',
    '      subgroup_slug <- safe_slug(paste0(outcome, "_", subgroup_col, "_subgroup_summary"))',
    '      write.csv(subgroup_table, file.path("plots", paste0(subgroup_slug, ".csv")), row.names = FALSE, fileEncoding = "UTF-8")',
    '      print(subgroup_table)',
    '      psub <- plot_pooled_effect_summary(subgroup_table, paste("Subgroup pooled effects:", label, "by", subgroup_col), include_subgroup = TRUE)',
    '      if (!is.null(psub)) {',
    '        plot_height <- safe_plot_height(max(4.2, 0.42 * min(nrow(subgroup_table), max_subgroup_plot_levels) + 1.8), max_height = 8.5)',
    '        ggplot2::ggsave(file.path("plots", paste0(subgroup_slug, ".png")), psub, width = 8.5, height = plot_height, dpi = 600, bg = "white")',
    '        ggplot2::ggsave(file.path("plots", paste0(subgroup_slug, ".pdf")), psub, width = 8.5, height = plot_height, device = pdf_device, bg = "white")',
    '      }',
    '    } else {',
    '      cat("Subgroup analysis skipped for", subgroup_col, ": fewer than 2 reportable subgroup levels.\\n")',
    '    }',
    '  }',
    '}',
    'sink()',
    'if (length(pooled_effect_summaries) > 0) {',
    '  pooled_effect_table <- do.call(rbind, pooled_effect_summaries)',
    '  write.csv(pooled_effect_table, file.path("plots", "pooled_effect_summary.csv"), row.names = FALSE, fileEncoding = "UTF-8")',
    '}',
    'if (length(overall_effect_summaries) > 0) {',
    '  overall_effect_table <- do.call(rbind, overall_effect_summaries)',
    '  write.csv(overall_effect_table, file.path("plots", "overall_pooled_effect_summary.csv"), row.names = FALSE, fileEncoding = "UTF-8")',
    '  p_overall <- plot_pooled_effect_summary(overall_effect_table, "Overall pooled meta-analysis effects", include_subgroup = FALSE, max_rows = 1000)',
    '  if (!is.null(p_overall)) {',
    '    plot_height <- safe_plot_height(max(3.8, 0.55 * nrow(overall_effect_table) + 1.8), max_height = 7)',
    '    ggplot2::ggsave(file.path("plots", "overall_pooled_effect_summary.png"), p_overall, width = 8.5, height = plot_height, dpi = 600, bg = "white")',
    '    ggplot2::ggsave(file.path("plots", "overall_pooled_effect_summary.pdf"), p_overall, width = 8.5, height = plot_height, device = pdf_device, bg = "white")',
    '  }',
    '}',
    'if (length(mean_only_summaries) > 0) {',
    '  mean_only_table <- do.call(rbind, mean_only_summaries)',
    '  write.csv(mean_only_table, file.path("plots", "mean_only_bootstrap_summary.csv"), row.names = FALSE, fileEncoding = "UTF-8")',
    '}',
    'write.csv(dat, file.path("plots", "meta_effect_sizes_used.csv"), row.names = FALSE, fileEncoding = "UTF-8")',
    'capture.output(sessionInfo(), file = file.path("plots", "session_info.txt"))',
  ];
  return script.join('\n');
}

function buildRunMarkdown(
  dataset: FlattenedDataset,
  effectRows: EffectRow[],
  skippedRows: SkippedEffectRow[],
  summaries: MetaSummary[],
  subgroups: MetaSubgroupSummary[],
  quality: { warnings: string[]; checks: Array<{ label: string; status: 'ok' | 'warn'; message: string }> },
  config: Required<MetaRunConfig>,
): string {
  const lines: string[] = [];
  lines.push('## Meta 分析工程化运行结果');
  lines.push('');
  lines.push(`- 纳入 PDF：${dataset.pdfCount} 篇`);
  lines.push(`- 原始编码行：${dataset.rows.length} 行`);
  lines.push(`- 有效效应量：${effectRows.length} 行`);
  lines.push(`- 跳过组合：${skippedRows.length} 个`);
  const meanOnlyRows = effectRows.filter(row => isMeanOnlyMeasure(row.measure) || !Number.isFinite(row.vi) || row.vi <= 0);
  const allMeanOnly = effectRows.length > 0 && meanOnlyRows.length === effectRows.length;
  lines.push(`- 模型：${allMeanOnly
    ? '无方差信息：研究/聚类内等权汇总 + 研究级非参数 bootstrap'
    : formatMetaModelLabel(config.model, config.method)}`);
  if (meanOnlyRows.length > 0) {
    const clusterCount = new Set(meanOnlyRows.map(row => row.cluster_id || row.study_id)).size;
    lines.push(`- 无 SD/SE 替代方案：${meanOnlyRows.length} 行先汇总为 ${clusterCount} 个研究/聚类，再执行 ${MEAN_ONLY_BOOTSTRAP_ITERATIONS} 次聚类 bootstrap；不使用逆方差权重。`);
  }
  if (config.excludeManualReview && config.manualReviewColumn) {
    lines.push(`- 人工复核：主分析排除 ${config.manualReviewColumn}=true 的数据行。`);
  }
  if (config.controlRules.length > 0) {
    lines.push(`- 对照规则：${config.controlRules.map(rule => rule.label || rule.id).join('；')}`);
  }
  if (config.columnPreprocess.length > 0) {
    lines.push(`- 数据列预处理：${config.columnPreprocess.map(item => `${item.column} => ${item.spec}`).join('；')}`);
  }
  lines.push('');
  lines.push('### 效应量汇总');
  lines.push('| 因变量 | 类型 | k | 模型估计 | 95% CI | I² | tau² |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  summaries.forEach(summary => {
    const random = summary.random;
    lines.push([
      escapeMarkdownCell(summary.outcomeLabel),
      summary.measure,
      String(summary.k),
      formatNumber(random.estimate),
      `${formatNumber(random.ciLower)} to ${formatNumber(random.ciUpper)}`,
      `${formatNumber(summary.heterogeneity.i2)}%`,
      formatNumber(summary.heterogeneity.tau2),
    ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  });
  lines.push('');
  if (subgroups.length > 0) {
    lines.push('### 亚组分析');
    lines.push('| 因变量 | 亚组变量 | 亚组水平 | k | 合并效应量 | 95% CI | I² | tau² |');
    lines.push('|---|---|---|---:|---:|---:|---:|---:|');
    subgroups.forEach(summary => {
      const random = summary.random;
      lines.push([
        escapeMarkdownCell(summary.outcomeLabel),
        escapeMarkdownCell(summary.subgroupColumn),
        escapeMarkdownCell(summary.subgroupLevel),
        String(summary.k),
        formatNumber(random.estimate),
        `${formatNumber(random.ciLower)} to ${formatNumber(random.ciUpper)}`,
        `${formatNumber(summary.heterogeneity.i2)}%`,
        formatNumber(summary.heterogeneity.tau2),
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    });
    lines.push('');
  } else if (config.subgroupColumns.length > 0) {
    lines.push('### 亚组分析');
    lines.push(`已选择亚组变量，但有效亚组水平不足 2 个，或各水平未达到至少 ${META_SUBGROUP_MIN_EFFECTS} 个效应量、${META_SUBGROUP_MIN_STUDIES} 篇研究的默认门槛，未生成可报告的亚组汇总。`);
    lines.push('');
  }
  lines.push('### 数据质量');
  if (meanOnlyRows.length > 0) {
    lines.push('- 方法说明：mean-only response ratio / mean difference 只用处理组和对照组均值计算效应量；总体效应与置信区间使用非参数 bootstrap/resampling。该方案适合无 SD/SE 时的生态学 Meta 替代分析，但不能提供常规逆方差权重、Q/I²/tau² 解释。');
  }
  quality.checks.forEach(check => {
    lines.push(`- ${check.status === 'ok' ? 'OK' : '需核查'}：${check.label}，${check.message}`);
  });
  quality.warnings.forEach(warning => lines.push(`- 警告：${warning}`));
  if (skippedRows.length > 0) {
    lines.push('');
    lines.push('### 前 10 个跳过原因');
    skippedRows.slice(0, 10).forEach(row => {
      lines.push(`- ${row.outcomeId || 'unknown'} / 第 ${row.rowIndex} 行 / ${row.studyId}: ${row.reason}`);
    });
  }
  lines.push('');
  lines.push('### R 输出');
  lines.push(meanOnlyRows.length > 0
    ? '已生成 `meta_effect_sizes.csv` 和 R 脚本。mean-only 效应量会使用无权重 bootstrap/resampling 输出总体合并效应、置信区间和亚组合并效应；不再生成每条效应量一行的长图。'
    : '已生成 `meta_effect_sizes.csv` 和完整 `metafor` 脚本。点击“执行R出图”会生成总体/亚组合并效应、预测区间、研究/聚类级 forest、满足门槛时的 funnel 与 Egger、leave-one-study-out、Baujat、数值调节变量回归图及模型摘要。依赖效应先在研究/聚类层级处理，不再绘制误导性的逐效应量长 forest 图。');
  return lines.join('\n');
}

function formatMetaModelLabel(model: MetaModelType, method: string): string {
  if (model === 'fixed') return '固定效应';
  if (model === 'mixed') return `混合效应/多层模型 rma.mv (${method})`;
  return `随机效应 ${method}`;
}

function hasCompleteOutcomeValues(row: Record<string, unknown>, mapping: MetaOutcomeMapping, measure: EffectMeasure): boolean {
  const parsed = parseOutcomeNumbers(row, mapping, measure);
  if (!parsed.ok) return false;
  if (measure === 'lnRR' || measure === 'lnRR_mean_only') return parsed.values.treatmentMean > 0 && parsed.values.controlMean > 0;
  if (measure === 'SMD') return (parsed.values.treatmentSd ?? Number.NaN) > 0 || (parsed.values.controlSd ?? Number.NaN) > 0;
  return true;
}

function parseNumeric(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const raw = stringifyCell(value);
  if (!raw) return Number.NaN;
  let text = raw
    .replace(/[，]/g, ',')
    .replace(/[－]/g, '-')
    .replace(/±.*$/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/,/g, '')
    .trim();
  if (/^[-+]?nan$/i.test(text)) return Number.NaN;
  const percent = /%/.test(text);
  const match = text.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/);
  if (!match) return Number.NaN;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return percent ? parsed / 100 : parsed;
}

function stringifyCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isBlank(value: unknown): boolean {
  const text = stringifyCell(value);
  return !text || /^(-|na|n\/a|null|undefined|未解析|无)$/i.test(text);
}

function firstNonEmpty(...values: unknown[]): unknown {
  for (const value of values) {
    if (!isBlank(value)) return value;
  }
  return '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => stringifyCell(item)).filter(Boolean);
  const text = stringifyCell(value);
  if (!text) return [];
  return text.split(/[;,，；\n]/).map(item => item.trim()).filter(Boolean);
}

function pickExistingColumn(columns: string[], candidates: string[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const exact = columns.find(column => column === candidate);
    if (exact) return exact;
    const lowered = candidate.toLowerCase();
    const loose = columns.find(column => column.toLowerCase() === lowered);
    if (loose) return loose;
  }
  return '';
}

function normalizeColumnForMatching(column: string): string {
  return column.trim().toLowerCase().replace(/[()\[\]{}%（）]/g, '').replace(/\s+/g, '_');
}

function normalizeOutcomeId(value: string): string {
  const text = value.trim() || 'outcome';
  return text.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_').replace(/^_+|_+$/g, '') || 'outcome';
}

function normalizeOutcomeLabel(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b(n2o)\b/i, 'N2O')
    .replace(/\b(no)\b/i, 'NO')
    .trim() || 'Outcome';
}

function normalizeDirection(value: unknown): number {
  if (typeof value === 'number') return value < 0 ? -1 : 1;
  const text = stringifyCell(value).toLowerCase();
  if (text === '-1' || text.includes('negative') || text.includes('lower') || text.includes('反向') || text.includes('越低越好')) return -1;
  return 1;
}

function formatEffectLabel(measure: EffectMeasure, yi: number): string {
  if (measure === 'lnRR') {
    const percent = (Math.exp(yi) - 1) * 100;
    return `${formatNumber(percent)}%`;
  }
  return formatNumber(yi);
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return 'NA';
  const abs = Math.abs(value);
  if (abs !== 0 && abs < 0.001) return value.toExponential(2);
  if (abs >= 1000) return value.toFixed(1);
  return value.toFixed(3);
}

function csvEscape(value: unknown): string {
  const text = stringifyCell(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default createMetaAnalysisRouter;
