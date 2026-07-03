import { Router, type NextFunction, type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import archiver from 'archiver';
import multer from 'multer';
import { z } from 'zod';
import {
  analyzeBibliometrics,
  type BibliometricAnalysis,
} from '../../utils/bibliometrics';
import { getUserUploadDir, sanitizeUserId } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import {
  getPaperKeywords,
  normalizeKeyword,
  sanitizeOuterTagsConfig,
  type LiteratureRecord,
  type OuterTagsConfig,
} from '../../literature/keyword-library';
import {
  mergeWosPlainTextDatasets,
  parseWosPlainTextDataset,
  summarizeWosDataset,
  wosDatasetToLiteratureRecords,
  type WosPlainTextDataset,
} from '../../utils/wos-plain-text';
import {
  buildBibliometricArtifacts,
  readBibliometricArtifactManifest,
  type BibliometricArtifactManifest,
} from '../../utils/bibliometrics-artifacts';

export interface BibliometricsRoutesOptions {
  readUserLiteratureRecords(userId: string): LiteratureRecord[];
  loadOuterTagsConfigForUser?: (userId: string) => OuterTagsConfig;
}

interface BibliometricPaperDraft {
  generatedAt: string;
  title: string;
  mode: 'template' | 'ai';
  provider: string;
  fallbackAttempts: string[];
  flow: Array<{
    step: string;
    dataUsed: string;
    output: string;
  }>;
  sections: Array<{
    id: string;
    title: string;
    dataUsed: string[];
    content: string;
  }>;
  figuresAndTables: Array<{
    type: 'figure' | 'table';
    name?: string;
    title: string;
    source: string;
    file?: string;
    note?: string;
  }>;
  markdown: string;
}

interface BibliometricRScript {
  generatedAt: string;
  filename: string;
  rCode: string;
  expectedFiles: string[];
}

interface BibliometricContextFigure {
  kind: 'svg-preview' | 'paper-figure';
  name: string;
  title: string;
  source: string;
  note?: string;
  filename?: string;
  relativePath?: string;
  url?: string;
  markdown?: string;
  description?: string;
  dataUsed?: string[];
  status?: 'ready' | 'empty';
  available: boolean;
}

interface BibliometricContextTable {
  id: string;
  title: string;
  filename: string;
  relativePath: string;
  description: string;
  url: string;
}

interface BibliometricWritingContext {
  generatedAt: string;
  source: 'bibliometrics-writing-context';
  available: boolean;
  dataset: Record<string, unknown> | null;
  analysis: BibliometricAnalysis;
  keywordMerges: OuterTagsConfig;
  journalQualityTable: BibliometricJournalQualityTableSummary | null;
  artifacts: BibliometricArtifactManifest | null;
  figures: BibliometricContextFigure[];
  tables: BibliometricContextTable[];
  exports: {
    analysisWorkbookUrl: string;
    datasetWorkbookUrl: string;
    figureZipUrl: string;
  };
  contextMarkdown: string;
}

interface BibliometricFigureSpec {
  key: string;
  name: `figure${number}`;
  title: string;
  source: string;
  note: string;
}

const BIBLIOMETRIC_FIGURE_SPECS: BibliometricFigureSpec[] = [
  {
    key: 'year_trend',
    name: 'figure1',
    title: '年度发文量与累计增长趋势',
    source: 'YearTrend',
    note: '柱形表示年度发文量，折线表示累计发文量，用于判断领域发展阶段、增长速度和可能的拐点。',
  },
  {
    key: 'top_journals',
    name: 'figure2',
    title: '主要来源期刊/来源分布',
    source: 'TopJournals',
    note: '展示发文量最高的来源，反映该主题的主要发表阵地；若已接入期刊质量表，可结合分区与质量等级解释。',
  },
  {
    key: 'top_authors',
    name: 'figure3',
    title: '高产作者分布',
    source: 'TopAuthors',
    note: '展示发文量最高的作者，用于识别核心作者群、潜在合作对象和作者贡献集中度。',
  },
  {
    key: 'top_keywords',
    name: 'figure4',
    title: '高频关键词分布',
    source: 'TopKeywords',
    note: '展示出现频次最高的关键词；同义词合并和人工标签清洗会影响该图的主题集中度。',
  },
  {
    key: 'keyword_year_trends',
    name: 'figure5',
    title: '主流关键词年际变化趋势',
    source: 'KeywordYearTrends',
    note: '展示核心关键词随年份的出现频次变化，用于识别热点延续、主题转移和阶段性增长。',
  },
  {
    key: 'keyword_bursts',
    name: 'figure6',
    title: '关键词突现变化指标',
    source: 'KeywordBursts',
    note: '按近年增长量和增长率刻画关键词突现强度，适合筛选新兴热点；正式解释前需结合原始文献复核。',
  },
  {
    key: 'source_quality',
    name: 'figure7',
    title: '来源质量分布',
    source: 'JournalQuality',
    note: '基于外部或内置期刊质量表统计来源质量层级，用于说明样本文献来源结构和质量覆盖情况。',
  },
  {
    key: 'data_quality',
    name: 'figure8',
    title: '文献记录完整性',
    source: 'DataQuality / RetrievalQuality',
    note: '统计题名、摘要、关键词、作者、来源、DOI 和参考文献等字段完整度，用于报告数据质量和方法局限。',
  },
  {
    key: 'keyword_cooccurrence_network',
    name: 'figure9',
    title: '关键词共现网络',
    source: 'KeywordNodes / KeywordEdges',
    note: '节点表示关键词，节点大小表示频次，连线表示同一文献中共同出现；标签仅显示主要节点以减少遮挡。',
  },
  {
    key: 'author_collaboration_network',
    name: 'figure10',
    title: '作者合作网络',
    source: 'AuthorNodes / AuthorEdges',
    note: '节点表示作者，连线表示共同署名关系，节点大小反映合作网络中的连接强度。',
  },
  {
    key: 'institution_collaboration_network',
    name: 'figure11',
    title: '机构合作网络',
    source: 'InstitutionNodes / InstitutionEdges',
    note: '节点表示机构，连线表示同一文献中的机构共现关系，用于观察机构合作格局。',
  },
  {
    key: 'country_collaboration_network',
    name: 'figure12',
    title: '国家/地区合作网络',
    source: 'CountryNodes / CountryEdges',
    note: '节点表示国家或地区，连线表示合作发文关系，用于识别跨区域合作结构。',
  },
  {
    key: 'co_citation_network',
    name: 'figure13',
    title: '共被引网络',
    source: 'CoCitationNodes / CoCitationEdges',
    note: '节点表示被引参考文献，连线表示在同一文献参考文献列表中共同被引用，用于识别知识基础。',
  },
  {
    key: 'bibliographic_coupling_network',
    name: 'figure14',
    title: '文献耦合网络',
    source: 'CouplingNodes / CouplingEdges',
    note: '节点表示样本文献，连线表示共享参考文献关系，用于识别研究主题相近的文献群。',
  },
];

const querySchema = z.object({
  userId: z.string().optional(),
  topN: z.coerce.number().int().min(5).max(100).optional(),
  keywordNodeLimit: z.coerce.number().int().min(20).max(180).optional(),
  authorNodeLimit: z.coerce.number().int().min(20).max(160).optional(),
  edgeLimit: z.coerce.number().int().min(40).max(500).optional(),
  similarityNodeLimit: z.coerce.number().int().min(20).max(160).optional(),
  similarityEdgeLimit: z.coerce.number().int().min(40).max(500).optional(),
  keywordTrendLimit: z.coerce.number().int().min(3).max(20).optional(),
  useMergedKeywordTags: z.enum(['true', 'false']).optional(),
});

const paperDraftQuerySchema = querySchema.extend({
  engine: z.enum(['ai', 'template']).optional(),
});

const keywordMergeSchema = z.object({
  userId: z.string().optional(),
  name: z.string().min(1).max(120),
  keywords: z.array(z.string().min(1).max(120)).min(1).max(80),
});

const DEFAULT_ANALYSIS_OPTIONS = {
  topN: 25,
  keywordNodeLimit: 90,
  authorNodeLimit: 70,
  edgeLimit: 220,
  similarityNodeLimit: 80,
  similarityEdgeLimit: 180,
  keywordTrendLimit: 8,
} satisfies Partial<z.infer<typeof querySchema>>;

const bibliometricsUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 50,
    fileSize: 100 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext === '.txt') {
      cb(null, true);
      return;
    }
    cb(new Error('文献计量模块仅支持 Web of Science Plain Text .txt 文件'));
  },
});

const journalQualityUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 30 * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (['.xlsx', '.xls', '.csv', '.txt'].includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error('期刊质量表仅支持 .xlsx、.xls、.csv 或 .txt 文件'));
  },
});

interface BibliometricJournalQualityRow {
  journal: string;
  normalizedJournal: string;
  issn: string;
  eissn: string;
  jcrQuartile: string;
  casZone: string;
  impactFactor: number | null;
  sourceLevel: string;
  notes: string;
}

interface BibliometricJournalQualityTable {
  id: string;
  sourceFileName: string;
  importedAt: string;
  rowCount: number;
  rows: BibliometricJournalQualityRow[];
  columns: string[];
}

interface BibliometricJournalQualityTableSummary {
  id: string;
  sourceFileName: string;
  importedAt: string;
  rowCount: number;
  withIssn: number;
  withJournal: number;
  withJcrQuartile: number;
  withCasZone: number;
  withImpactFactor: number;
  withSourceLevel: number;
}

interface BuiltInJournalQualitySource {
  id: string;
  label: string;
  url: string;
  defaultEnabled: boolean;
  note: string;
}

const BUILT_IN_JOURNAL_QUALITY_SOURCES: BuiltInJournalQualitySource[] = [
  {
    id: 'nlm-pubmed',
    label: 'NLM/PubMed Journal Catalog',
    url: 'https://ftp.ncbi.nlm.nih.gov/pubmed/J_Medline.txt',
    defaultEnabled: true,
    note: '开放下载，用于标记 NLM/PubMed 期刊目录收录情况；不等同于 JCR 分区或中科院分区。',
  },
  {
    id: 'scimago-sjr',
    label: 'SCImago Journal Rank',
    url: 'https://www.scimagojr.com/journalrank.php?out=xls',
    defaultEnabled: false,
    note: '若站点允许下载，可用于 SJR/Scopus 来源质量；部分网络环境会返回 403，需要用户手动下载后上传。',
  },
  {
    id: 'doaj',
    label: 'DOAJ Journals',
    url: 'https://doaj.org/csv',
    defaultEnabled: false,
    note: '开放获取期刊目录，文件较大；可用于标记 DOAJ 收录情况。',
  },
];

function handleBibliometricsPlainTextUpload(req: Request, res: Response, next: NextFunction): void {
  bibliometricsUpload.fields([
    { name: 'file', maxCount: 50 },
    { name: 'files', maxCount: 50 },
  ])(req, res, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }
    const message = error instanceof multer.MulterError
      ? (error.code === 'LIMIT_FILE_SIZE' ? '文件不能超过 100MB' : error.message)
      : (error as Error).message || '计量学文件上传失败';
    res.status(400).json({ success: false, error: message });
  });
}

export function isWosBibliometricPlainText(content: string): boolean {
  const text = String(content || '').replace(/^\uFEFF/, '');
  if (!text.trim()) return false;
  const hasRecordStart = /^PT\s+\S+/m.test(text);
  const hasRecordEnd = /^ER\s*$/m.test(text);
  if (!hasRecordStart || !hasRecordEnd) return false;

  const hasWosHeader = /(?:Web of Science|Clarivate|^\s*FN\s+Clarivate|^\s*VR\s+1\.0)/im.test(text);
  const hasCoreFields = /^TI\s+.+/m.test(text) && /^SO\s+.+/m.test(text) && /^PY\s+\d{4}/m.test(text);
  const hasBibliometricFields = /^CR\s+.+/m.test(text) || /^TC\s+\d+/m.test(text) || /^C1\s+.+/m.test(text) || /^WC\s+.+/m.test(text);
  return hasWosHeader || (hasCoreFields && hasBibliometricFields);
}

export function importBibliometricPlainTextForUser(args: {
  userId: string;
  sourceFiles: Array<{ fileName: string; content: string }>;
  mode?: 'append' | 'replace';
}): {
  userId: string;
  mode: 'append' | 'replace';
  uploadedFiles: Array<{ fileName: string; records: number; citedReferences: number }>;
  mergedFromExisting: boolean;
  dataset: Record<string, unknown>;
  quality: WosPlainTextDataset['quality'];
  artifacts: BibliometricArtifactManifest;
  journalQualityTable: BibliometricJournalQualityTableSummary | null;
  keywordMerges: OuterTagsConfig;
  keywordMergeCandidates: Array<{ label: string; count: number; percentage: number }>;
  analysis: BibliometricAnalysis;
} {
  const userId = sanitizeUserId(args.userId || 'web-user');
  const mode = args.mode || 'append';
  const importedAt = new Date().toISOString();
  const parsedUploads = args.sourceFiles.map(source => ({
    fileName: source.fileName || 'savedrecs.txt',
    content: source.content,
    dataset: parseWosPlainTextDataset(source.content, source.fileName || 'savedrecs.txt', importedAt),
  }));
  const invalidFiles = parsedUploads.filter(item => item.dataset.records.length === 0);
  if (invalidFiles.length > 0) {
    throw new Error(`以下文件未解析到 WoS 记录：${invalidFiles.map(item => item.fileName).join('；')}。请确认导出格式为 Plain Text，且 Record Content 选择 Full Record and Cited References。`);
  }

  const existingDataset = mode === 'replace' ? null : loadCurrentWosDataset(userId);
  const datasetsToMerge = [
    ...(existingDataset ? [existingDataset] : []),
    ...parsedUploads.map(item => item.dataset),
  ];
  const sourceFileName = uniqueSourceFileNames(datasetsToMerge.flatMap(dataset => splitDatasetSourceNames(dataset.sourceFileName))).join('; ');
  const dataset = datasetsToMerge.length === 1
    ? parsedUploads[0].dataset
    : mergeWosPlainTextDatasets(datasetsToMerge, sourceFileName, importedAt);
  if (dataset.records.length === 0) {
    throw new Error('未解析到 WoS 记录。请确认导出格式为 Plain Text，且 Record Content 选择 Full Record and Cited References。');
  }

  saveWosDataset(userId, dataset, parsedUploads.map(item => ({ fileName: item.fileName, content: item.content })));
  const papers = enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset));
  const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
  const artifacts = ensureBibliometricArtifacts(userId, dataset, analysis, true);
  const keywordMerges = loadBibliometricKeywordMergeConfig(userId);

  return {
    userId,
    mode,
    uploadedFiles: parsedUploads.map(item => ({ fileName: item.fileName, records: item.dataset.records.length, citedReferences: item.dataset.citedReferences.length })),
    mergedFromExisting: !!existingDataset,
    dataset: summarizeWosDataset(dataset),
    quality: dataset.quality,
    artifacts,
    journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
    keywordMerges,
    keywordMergeCandidates: buildKeywordMergeCandidates(papers),
    analysis,
  };
}

export function getBibliometricWritingContextForUser(
  userIdInput: string,
  options: Partial<z.infer<typeof querySchema>> = DEFAULT_ANALYSIS_OPTIONS
): BibliometricWritingContext | null {
  const userId = sanitizeUserId(userIdInput || 'web-user');
  const dataset = loadCurrentWosDataset(userId);
  if (!dataset) return null;

  const analysisOptions = {
    ...DEFAULT_ANALYSIS_OPTIONS,
    ...options,
  };
  const papers = enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset));
  const analysis = analyzeWosDatasetForUser(userId, papers, analysisOptions);
  const artifacts = ensureBibliometricArtifacts(userId, dataset, analysis);
  const keywordMerges = loadBibliometricKeywordMergeConfig(userId);

  return buildBibliometricWritingContext({
    userId,
    analysis,
    dataset: summarizeWosDataset(dataset),
    artifacts,
    keywordMerges,
    journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
  });
}

export function createBibliometricsRouter(options: BibliometricsRoutesOptions): Router {
  const router = Router();

  const runAnalysis = (query: unknown): {
    userId: string;
    analysis: BibliometricAnalysis;
    dataset: Record<string, unknown> | null;
    artifacts: BibliometricArtifactManifest | null;
    keywordMerges: OuterTagsConfig;
    keywordMergeCandidates: Array<{ label: string; count: number; percentage: number }>;
    journalQualityTable: BibliometricJournalQualityTableSummary | null;
  } => {
    const parsed = querySchema.parse(query);
    const userId = sanitizeUserId(parsed.userId || 'web-user');
    const dataset = loadCurrentWosDataset(userId);
    const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
    const keywordMerges = loadBibliometricKeywordMergeConfig(userId);
    const analysis = analyzeWosDatasetForUser(userId, papers, parsed);
    const artifacts = dataset ? ensureBibliometricArtifacts(userId, dataset, analysis) : null;
    const keywordMergeCandidates = dataset ? buildKeywordMergeCandidates(papers) : [];
    return {
      userId,
      analysis,
      dataset: dataset ? summarizeWosDataset(dataset) : null,
      artifacts,
      keywordMerges,
      keywordMergeCandidates,
      journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
    };
  };

  router.get('/dataset', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      const dataset = loadCurrentWosDataset(userId);
      res.json({
        success: true,
        userId,
        dataset: dataset ? summarizeWosDataset(dataset) : null,
        quality: dataset?.quality || null,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Dataset route error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '读取计量学数据库失败' });
    }
  });

  router.post('/upload', handleBibliometricsPlainTextUpload, (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const files = getUploadedBibliometricFiles(req);
      if (files.length === 0) {
        res.status(400).json({ success: false, error: '请上传 Web of Science Plain Text .txt 文件' });
        return;
      }

      const mode = String(req.body?.mode || req.query.mode || 'append').toLowerCase();
      const result = importBibliometricPlainTextForUser({
        userId,
        mode: mode === 'replace' ? 'replace' : 'append',
        sourceFiles: files.map(file => ({
          fileName: file.originalname || 'savedrecs.txt',
          content: decodeTextBuffer(file.buffer),
        })),
      });

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Upload route error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '导入 WoS Plain Text 失败' });
    }
  });

  router.get('/dataset/export', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      const dataset = loadCurrentWosDataset(userId);
      if (!dataset) {
        res.status(404).json({ success: false, error: '暂无计量学数据库，请先上传 WoS Plain Text 文件' });
        return;
      }
      const buffer = await buildWosDatasetWorkbook(dataset);
      const filename = `wos-bibliometrics-database-${dataset.id}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buffer);
    } catch (error) {
      logger.error('[Bibliometrics] Dataset export route error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '导出计量学数据库失败' });
    }
  });

  router.get('/artifacts', (req: Request, res: Response) => {
    try {
      const parsed = querySchema.parse(req.query);
      const userId = sanitizeUserId(parsed.userId || 'web-user');
      const dataset = loadCurrentWosDataset(userId);
      if (!dataset) {
        res.status(404).json({ success: false, error: '暂无计量学数据库，请先上传 WoS Plain Text 文件' });
        return;
      }
      const analysis = analyzeWosDatasetForUser(userId, enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)), parsed);
      const artifacts = ensureBibliometricArtifacts(userId, dataset, analysis);
      res.json({
        success: true,
        userId,
        dataset: summarizeWosDataset(dataset),
        artifacts,
        journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
        keywordMerges: loadBibliometricKeywordMergeConfig(userId),
      });
    } catch (error) {
      logger.error('[Bibliometrics] Artifacts route error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '读取文献计量图表失败' });
    }
  });

  router.get('/writing-context', (req: Request, res: Response) => {
    try {
      const { userId, analysis, dataset, artifacts, keywordMerges, journalQualityTable } = runAnalysis(req.query);
      if (!dataset) {
        res.json({
          success: true,
          userId,
          available: false,
          context: null,
          error: '暂无计量学数据库，请先上传 WoS Plain Text 文件',
        });
        return;
      }
      const context = buildBibliometricWritingContext({
        userId,
        analysis,
        dataset,
        artifacts,
        keywordMerges,
        journalQualityTable,
      });
      res.json({ success: true, userId, available: true, context });
    } catch (error) {
      logger.error('[Bibliometrics] Writing context route error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '读取文献计量写作上下文失败' });
    }
  });

  router.get('/artifacts/download', async (req: Request, res: Response) => {
    try {
      const parsed = querySchema.parse(req.query);
      const userId = sanitizeUserId(parsed.userId || 'web-user');
      const dataset = loadCurrentWosDataset(userId);
      if (!dataset) {
        res.status(404).json({ success: false, error: '暂无计量学数据库，请先上传 WoS Plain Text 文件' });
        return;
      }
      const analysis = analyzeWosDatasetForUser(userId, enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)), parsed);
      ensureBibliometricArtifacts(userId, dataset, analysis);
      const outputDir = getCurrentBibliometricOutputDir(userId, dataset.id);
      const filename = `bibliometric-figures-${dataset.id}.zip`;
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      const archive = archiver('zip', { zlib: { level: 9 } });
      archive.on('error', error => {
        throw error;
      });
      archive.pipe(res);
      archive.directory(outputDir, false);
      await archive.finalize();
    } catch (error) {
      logger.error('[Bibliometrics] Artifacts download route error:', error);
      if (!res.headersSent) {
        res.status(400).json({ success: false, error: (error as Error).message || '下载文献计量图表包失败' });
      }
    }
  });

  router.get('/artifacts/file', (req: Request, res: Response) => {
    sendBibliometricArtifactFile(req, res, req.query.file);
  });

  router.get('/artifacts/file/:filename', (req: Request, res: Response) => {
    sendBibliometricArtifactFile(req, res, req.query.file || req.params.filename);
  });

  router.delete('/dataset', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || req.body?.userId || 'web-user'));
      const currentPath = getCurrentWosDatasetPath(userId);
      if (fs.existsSync(currentPath)) fs.unlinkSync(currentPath);
      res.json({ success: true, userId });
    } catch (error) {
      logger.error('[Bibliometrics] Dataset delete route error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '清除计量学数据库失败' });
    }
  });

  router.get('/keyword-merges', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      const dataset = loadCurrentWosDataset(userId);
      const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
      res.json({
        success: true,
        userId,
        keywordMerges: loadBibliometricKeywordMergeConfig(userId),
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
      });
    } catch (error) {
      logger.error('[Bibliometrics] Keyword merge route error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '读取关键词合并配置失败' });
    }
  });

  router.post('/keyword-merges', (req: Request, res: Response) => {
    try {
      const parsed = keywordMergeSchema.parse(req.body || {});
      const userId = sanitizeUserId(parsed.userId || 'web-user');
      const dataset = loadCurrentWosDataset(userId);
      if (!dataset) {
        res.status(404).json({ success: false, error: '暂无计量学数据库，请先上传 WoS Plain Text 文件' });
        return;
      }
      const papers = enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset));
      const current = loadBibliometricKeywordMergeConfig(userId);
      const keywordMerges = upsertBibliometricKeywordMerge(current, parsed.name, parsed.keywords, papers);
      saveBibliometricKeywordMergeConfig(userId, keywordMerges);
      const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
      const artifacts = ensureBibliometricArtifacts(userId, dataset, analysis, true);
      res.json({
        success: true,
        userId,
        dataset: summarizeWosDataset(dataset),
        artifacts,
        journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
        keywordMerges,
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
        analysis,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Keyword merge save error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '保存关键词合并配置失败' });
    }
  });

  router.delete('/keyword-merges/:name', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || req.body?.userId || 'web-user'));
      const dataset = loadCurrentWosDataset(userId);
      const name = normalizeKeyword(String(req.params.name || ''));
      const current = loadBibliometricKeywordMergeConfig(userId);
      const keywordMerges = sanitizeOuterTagsConfig({
        ...current,
        mergedTags: current.mergedTags.filter(tag => normalizeKeyword(tag.name) !== name),
      });
      saveBibliometricKeywordMergeConfig(userId, keywordMerges);
      const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
      const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
      const artifacts = dataset ? ensureBibliometricArtifacts(userId, dataset, analysis, true) : null;
      res.json({
        success: true,
        userId,
        dataset: dataset ? summarizeWosDataset(dataset) : null,
        artifacts,
        journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
        keywordMerges,
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
        analysis,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Keyword merge delete error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '删除关键词合并配置失败' });
    }
  });

  router.delete('/keyword-merges', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || req.body?.userId || 'web-user'));
      const dataset = loadCurrentWosDataset(userId);
      const keywordMerges = saveBibliometricKeywordMergeConfig(userId, { mergedTags: [], promotedTags: [] });
      const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
      const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
      const artifacts = dataset ? ensureBibliometricArtifacts(userId, dataset, analysis, true) : null;
      res.json({
        success: true,
        userId,
        dataset: dataset ? summarizeWosDataset(dataset) : null,
        artifacts,
        journalQualityTable: summarizeJournalQualityTable(loadJournalQualityTable(userId)),
        keywordMerges,
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
        analysis,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Keyword merge reset error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '重置关键词合并配置失败' });
    }
  });

  router.get('/journal-quality', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      const table = loadJournalQualityTable(userId);
      res.json({ success: true, userId, journalQualityTable: summarizeJournalQualityTable(table) });
    } catch (error) {
      logger.error('[Bibliometrics] Journal quality route error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '读取期刊质量表失败' });
    }
  });

  router.get('/journal-quality/builtin-sources', (_req: Request, res: Response) => {
    res.json({ success: true, sources: BUILT_IN_JOURNAL_QUALITY_SOURCES });
  });

  router.post('/journal-quality/download', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const requested = Array.isArray(req.body?.sources)
        ? req.body.sources.map(String)
        : BUILT_IN_JOURNAL_QUALITY_SOURCES.filter(source => source.defaultEnabled).map(source => source.id);
      const selectedSources = BUILT_IN_JOURNAL_QUALITY_SOURCES.filter(source => requested.includes(source.id));
      if (selectedSources.length === 0) {
        res.status(400).json({ success: false, error: '未选择可下载的内置期刊质量来源' });
        return;
      }

      const importedAt = new Date().toISOString();
      const downloaded: Array<{ source: BuiltInJournalQualitySource; rows: BibliometricJournalQualityRow[] }> = [];
      const failed: Array<{ source: string; error: string }> = [];
      for (const source of selectedSources) {
        try {
          const rows = await downloadBuiltInJournalQualityRows(source);
          downloaded.push({ source, rows });
        } catch (error) {
          logger.warn(`[Bibliometrics] Built-in journal quality download failed: ${source.id}`, error);
          failed.push({ source: source.id, error: (error as Error).message || String(error) });
        }
      }

      const existingTable = loadJournalQualityTable(userId);
      const mergedRows = mergeJournalQualityRows([
        ...(existingTable?.rows || []),
        ...downloaded.flatMap(item => item.rows),
      ]);
      if (mergedRows.length === 0) {
        res.status(400).json({
          success: false,
          error: `内置期刊质量来源下载失败或没有有效数据：${failed.map(item => `${item.source}: ${item.error}`).join('；')}`,
          failed,
        });
        return;
      }

      const sourceFileName = [
        existingTable?.sourceFileName,
        ...downloaded.map(item => `built-in:${item.source.id}`),
      ].filter(Boolean).join('; ');
      const table = buildJournalQualityTableFromRows(mergedRows, sourceFileName, importedAt, []);
      saveJournalQualityTable(userId, table);
      const dataset = loadCurrentWosDataset(userId);
      const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
      const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
      const artifacts = dataset ? ensureBibliometricArtifacts(userId, dataset, analysis, true) : null;
      res.json({
        success: true,
        userId,
        downloaded: downloaded.map(item => ({ source: item.source.id, rows: item.rows.length })),
        failed,
        dataset: dataset ? summarizeWosDataset(dataset) : null,
        artifacts,
        journalQualityTable: summarizeJournalQualityTable(table),
        keywordMerges: loadBibliometricKeywordMergeConfig(userId),
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
        analysis,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Built-in journal quality download error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '下载内置期刊质量来源失败' });
    }
  });

  router.post('/journal-quality/upload', journalQualityUpload.single('file'), (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const file = req.file;
      if (!file) {
        res.status(400).json({ success: false, error: '请上传期刊质量表文件' });
        return;
      }
      const table = parseJournalQualityTable(file.buffer, file.originalname || 'journal-quality.xlsx');
      saveJournalQualityTable(userId, table);
      const dataset = loadCurrentWosDataset(userId);
      const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
      const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
      const artifacts = dataset ? ensureBibliometricArtifacts(userId, dataset, analysis, true) : null;
      res.json({
        success: true,
        userId,
        dataset: dataset ? summarizeWosDataset(dataset) : null,
        artifacts,
        journalQualityTable: summarizeJournalQualityTable(table),
        keywordMerges: loadBibliometricKeywordMergeConfig(userId),
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
        analysis,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Journal quality upload error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '导入期刊质量表失败' });
    }
  });

  router.delete('/journal-quality', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || req.body?.userId || 'web-user'));
      const filePath = getJournalQualityTablePath(userId);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      const dataset = loadCurrentWosDataset(userId);
      const papers = dataset ? enrichPapersWithJournalQuality(userId, wosDatasetToLiteratureRecords(dataset)) : [];
      const analysis = analyzeWosDatasetForUser(userId, papers, DEFAULT_ANALYSIS_OPTIONS);
      const artifacts = dataset ? ensureBibliometricArtifacts(userId, dataset, analysis, true) : null;
      res.json({
        success: true,
        userId,
        dataset: dataset ? summarizeWosDataset(dataset) : null,
        artifacts,
        journalQualityTable: null,
        keywordMerges: loadBibliometricKeywordMergeConfig(userId),
        keywordMergeCandidates: buildKeywordMergeCandidates(papers),
        analysis,
      });
    } catch (error) {
      logger.error('[Bibliometrics] Journal quality delete error:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '清除期刊质量表失败' });
    }
  });

  router.get('/', (req: Request, res: Response) => {
    try {
      const { userId, analysis, dataset, artifacts, keywordMerges, keywordMergeCandidates, journalQualityTable } = runAnalysis(req.query);
      res.json({ success: true, userId, dataset, artifacts, keywordMerges, keywordMergeCandidates, journalQualityTable, analysis });
    } catch (error) {
      logger.error('[Bibliometrics] Analysis route error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '文献计量分析失败' });
    }
  });

  router.get('/export', async (req: Request, res: Response) => {
    try {
      const { analysis } = runAnalysis(req.query);
      const buffer = await buildBibliometricsWorkbook(analysis);
      const filename = `bibliometrics-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buffer);
    } catch (error) {
      logger.error('[Bibliometrics] Export route error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '文献计量导出失败' });
    }
  });

  router.get('/paper-draft', async (req: Request, res: Response) => {
    try {
      const { userId, analysis, artifacts } = runAnalysis(req.query);
      const parsed = paperDraftQuerySchema.parse(req.query);
      const draft = parsed.engine === 'template'
        ? buildBibliometricPaperDraft(analysis, artifacts)
        : await buildBibliometricPaperDraftWithFallback(analysis, artifacts);
      res.json({ success: true, userId, draft });
    } catch (error) {
      logger.error('[Bibliometrics] Paper draft route error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '计量学论文草稿生成失败' });
    }
  });

  router.get('/paper-draft/download', (req: Request, res: Response) => {
    try {
      const { analysis, artifacts } = runAnalysis(req.query);
      const draft = buildBibliometricPaperDraft(analysis, artifacts);
      const filename = `bibliometric-paper-draft-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`;
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(draft.markdown);
    } catch (error) {
      logger.error('[Bibliometrics] Paper draft download error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '计量学论文草稿下载失败' });
    }
  });

  router.get('/r-script', (req: Request, res: Response) => {
    try {
      const { userId, analysis } = runAnalysis(req.query);
      const script = buildBibliometricRScript(analysis);
      res.json({ success: true, userId, data: script });
    } catch (error) {
      logger.error('[Bibliometrics] R script route error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '计量学 R 图表脚本生成失败' });
    }
  });

  router.get('/r-script/download', (req: Request, res: Response) => {
    try {
      const { analysis } = runAnalysis(req.query);
      const script = buildBibliometricRScript(analysis);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${script.filename}"; filename*=UTF-8''${encodeURIComponent(script.filename)}`);
      res.send(script.rCode);
    } catch (error) {
      logger.error('[Bibliometrics] R script download error:', error);
      const message = error instanceof z.ZodError
        ? error.errors.map(item => item.message).join('; ')
        : (error as Error).message;
      res.status(400).json({ success: false, error: message || '计量学 R 图表脚本下载失败' });
    }
  });

  return router;
}

function getBibliometricsDir(userId: string): string {
  return path.join(getUserUploadDir(userId), 'bibliometrics');
}

function getCurrentWosDatasetPath(userId: string): string {
  return path.join(getBibliometricsDir(userId), 'current-dataset.json');
}

function getBibliometricKeywordMergeConfigPath(userId: string): string {
  return path.join(getBibliometricsDir(userId), 'keyword-merge-config.json');
}

function getJournalQualityTablePath(userId: string): string {
  return path.join(getBibliometricsDir(userId), 'journal-quality-table.json');
}

function getCurrentBibliometricOutputDir(userId: string, datasetId: string): string {
  return path.join(getBibliometricsDir(userId), 'datasets', datasetId, 'outputs');
}

function sendBibliometricArtifactFile(req: Request, res: Response, rawFile: unknown): void {
  try {
    const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
    const dataset = loadCurrentWosDataset(userId);
    if (!dataset) {
      res.status(404).json({ success: false, error: '暂无计量学数据库，请先上传 WoS Plain Text 文件' });
      return;
    }

    const filePath = resolveBibliometricArtifactPath(userId, dataset.id, rawFile);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({ success: false, error: '图表文件不存在' });
      return;
    }
    res.sendFile(filePath);
  } catch (error) {
    logger.error('[Bibliometrics] Artifact file route error:', error);
    res.status(400).json({ success: false, error: (error as Error).message || '读取图表文件失败' });
  }
}

function resolveBibliometricArtifactPath(userId: string, datasetId: string, rawFile: unknown): string {
  const relativePath = String(rawFile || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!relativePath || relativePath.split('/').some(part => part === '..' || part === '')) {
    throw new Error('无效的图表文件路径');
  }
  const outputDir = path.resolve(getCurrentBibliometricOutputDir(userId, datasetId));
  const filePath = path.resolve(outputDir, relativePath);
  const relative = path.relative(outputDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('无效的图表文件路径');
  }
  return filePath;
}

function buildBibliometricArtifactFileUrl(userId: string, relativePath: string): string {
  return `/api/bibliometrics/artifacts/file?userId=${encodeURIComponent(userId)}&file=${encodeURIComponent(relativePath)}`;
}

function loadCurrentWosDataset(userId: string): WosPlainTextDataset | null {
  const currentPath = getCurrentWosDatasetPath(userId);
  if (!fs.existsSync(currentPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(currentPath, 'utf-8')) as WosPlainTextDataset;
  } catch (error) {
    logger.warn(`[Bibliometrics] Failed to load current WoS dataset for ${userId}:`, error);
    return null;
  }
}

function loadBibliometricKeywordMergeConfig(userId: string): OuterTagsConfig {
  const configPath = getBibliometricKeywordMergeConfigPath(userId);
  if (!fs.existsSync(configPath)) return { mergedTags: [], promotedTags: [] };
  try {
    return sanitizeOuterTagsConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')));
  } catch (error) {
    logger.warn(`[Bibliometrics] Failed to load keyword merge config for ${userId}:`, error);
    return { mergedTags: [], promotedTags: [] };
  }
}

function saveBibliometricKeywordMergeConfig(userId: string, config: OuterTagsConfig): OuterTagsConfig {
  const sanitized = sanitizeOuterTagsConfig(config);
  fs.mkdirSync(getBibliometricsDir(userId), { recursive: true });
  fs.writeFileSync(getBibliometricKeywordMergeConfigPath(userId), JSON.stringify(sanitized, null, 2), 'utf-8');
  return sanitized;
}

function loadJournalQualityTable(userId: string): BibliometricJournalQualityTable | null {
  const filePath = getJournalQualityTablePath(userId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BibliometricJournalQualityTable;
  } catch (error) {
    logger.warn(`[Bibliometrics] Failed to load journal quality table for ${userId}:`, error);
    return null;
  }
}

function saveJournalQualityTable(userId: string, table: BibliometricJournalQualityTable): void {
  fs.mkdirSync(getBibliometricsDir(userId), { recursive: true });
  fs.writeFileSync(getJournalQualityTablePath(userId), JSON.stringify(table, null, 2), 'utf-8');
}

function summarizeJournalQualityTable(table: BibliometricJournalQualityTable | null): BibliometricJournalQualityTableSummary | null {
  if (!table) return null;
  return {
    id: table.id,
    sourceFileName: table.sourceFileName,
    importedAt: table.importedAt,
    rowCount: table.rowCount,
    withIssn: table.rows.filter(row => row.issn || row.eissn).length,
    withJournal: table.rows.filter(row => row.journal).length,
    withJcrQuartile: table.rows.filter(row => row.jcrQuartile).length,
    withCasZone: table.rows.filter(row => row.casZone).length,
    withImpactFactor: table.rows.filter(row => row.impactFactor !== null).length,
    withSourceLevel: table.rows.filter(row => row.sourceLevel).length,
  };
}

function parseJournalQualityTable(buffer: Buffer, sourceFileName: string): BibliometricJournalQualityTable {
  const xlsx = require('xlsx') as typeof import('xlsx');
  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error('期刊质量表没有可读取的工作表');
  const sheet = workbook.Sheets[firstSheetName];
  const rawRows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const columns = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
  const rows = rawRows
    .map(row => normalizeJournalQualityRow(row))
    .filter(row => row.journal || row.issn || row.eissn);
  if (rows.length === 0) {
    throw new Error('期刊质量表未识别到有效行。至少需要 journal/期刊名 或 issn/eissn 字段');
  }
  const importedAt = new Date().toISOString();
  return {
    id: `journal-quality-${compactTimestampForRoute(importedAt)}-${hashRouteText(`${sourceFileName}:${rows.length}:${JSON.stringify(rows.slice(0, 20))}`).slice(0, 8)}`,
    sourceFileName,
    importedAt,
    rowCount: rows.length,
    rows,
    columns,
  };
}

function buildJournalQualityTableFromRows(
  rows: BibliometricJournalQualityRow[],
  sourceFileName: string,
  importedAt = new Date().toISOString(),
  columns: string[] = []
): BibliometricJournalQualityTable {
  const mergedRows = mergeJournalQualityRows(rows);
  return {
    id: `journal-quality-${compactTimestampForRoute(importedAt)}-${hashRouteText(`${sourceFileName}:${mergedRows.length}:${JSON.stringify(mergedRows.slice(0, 20))}`).slice(0, 8)}`,
    sourceFileName,
    importedAt,
    rowCount: mergedRows.length,
    rows: mergedRows,
    columns,
  };
}

async function downloadBuiltInJournalQualityRows(source: BuiltInJournalQualitySource): Promise<BibliometricJournalQualityRow[]> {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'ScholarHarness/1.0 (+https://scholarharness.local)',
      Accept: 'text/plain,text/csv,application/vnd.ms-excel,*/*',
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (source.id === 'nlm-pubmed') {
    return parseNlmJournalCatalogRows(buffer.toString('utf-8'));
  }
  if (source.id === 'scimago-sjr') {
    return parseScimagoJournalRows(buffer, source);
  }
  if (source.id === 'doaj') {
    return parseDoajJournalRows(buffer, source);
  }
  return [];
}

function parseNlmJournalCatalogRows(content: string): BibliometricJournalQualityRow[] {
  return content
    .split(/-{20,}/)
    .map(block => parseNlmJournalCatalogBlock(block))
    .filter((row): row is BibliometricJournalQualityRow => Boolean(row));
}

function parseNlmJournalCatalogBlock(block: string): BibliometricJournalQualityRow | null {
  const fields = new Map<string, string>();
  block.split(/\r?\n/).forEach(line => {
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (match) fields.set(match[1].trim().toLowerCase(), match[2].trim());
  });
  const journal = fields.get('journaltitle') || '';
  const issn = fields.get('issn (print)') || '';
  const eissn = fields.get('issn (online)') || '';
  if (!journal && !issn && !eissn) return null;
  return {
    journal,
    normalizedJournal: normalizeJournalQualityName(journal),
    issn: normalizeIssnList(issn),
    eissn: normalizeIssnList(eissn),
    jcrQuartile: '',
    casZone: '',
    impactFactor: null,
    sourceLevel: 'NLM/PubMed indexed',
    notes: [fields.get('medabbr'), fields.get('isoabbr'), fields.get('nlmid') ? `NlmId:${fields.get('nlmid')}` : ''].filter(Boolean).join('; '),
  };
}

function parseScimagoJournalRows(buffer: Buffer, source: BuiltInJournalQualitySource): BibliometricJournalQualityRow[] {
  const table = parseJournalQualityTable(buffer, `${source.id}.csv`);
  return table.rows.map(row => ({
    ...row,
    sourceLevel: uniqueQualityLabels([
      row.sourceLevel,
      row.jcrQuartile ? `SJR ${row.jcrQuartile}` : '',
      'SCImago/SJR',
    ]),
    jcrQuartile: '',
    notes: uniqueQualityLabels([row.notes, 'Downloaded from SCImago Journal Rank export']),
  }));
}

function parseDoajJournalRows(buffer: Buffer, source: BuiltInJournalQualitySource): BibliometricJournalQualityRow[] {
  const table = parseJournalQualityTable(buffer, `${source.id}.csv`);
  return table.rows.map(row => ({
    ...row,
    sourceLevel: uniqueQualityLabels([row.sourceLevel, 'DOAJ indexed']),
    notes: uniqueQualityLabels([row.notes, 'Downloaded from DOAJ journal metadata']),
  }));
}

function mergeJournalQualityRows(rows: BibliometricJournalQualityRow[]): BibliometricJournalQualityRow[] {
  const map = new Map<string, BibliometricJournalQualityRow>();
  for (const row of rows) {
    const key = getJournalQualityRowKey(row);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { ...row });
      continue;
    }
    map.set(key, {
      journal: existing.journal || row.journal,
      normalizedJournal: existing.normalizedJournal || row.normalizedJournal,
      issn: uniqueQualityLabels([existing.issn, row.issn]),
      eissn: uniqueQualityLabels([existing.eissn, row.eissn]),
      jcrQuartile: existing.jcrQuartile || row.jcrQuartile,
      casZone: existing.casZone || row.casZone,
      impactFactor: existing.impactFactor !== null ? existing.impactFactor : row.impactFactor,
      sourceLevel: uniqueQualityLabels([existing.sourceLevel, row.sourceLevel]),
      notes: uniqueQualityLabels([existing.notes, row.notes]),
    });
  }
  return Array.from(map.values()).sort((a, b) => a.normalizedJournal.localeCompare(b.normalizedJournal));
}

function getJournalQualityRowKey(row: BibliometricJournalQualityRow): string {
  const issn = splitQualityTokens(row.issn)[0] || splitQualityTokens(row.eissn)[0];
  if (issn) return `issn:${issn}`;
  if (row.normalizedJournal) return `journal:${row.normalizedJournal}`;
  return '';
}

function uniqueQualityLabels(values: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const result: string[] = [];
  values
    .flatMap(value => String(value || '').split(/[;；]/))
    .map(value => value.trim())
    .filter(Boolean)
    .forEach(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });
  return result.join('; ');
}

function normalizeJournalQualityRow(row: Record<string, unknown>): BibliometricJournalQualityRow {
  const journal = cleanJournalQualityValue(pickHeaderValue(row, [
    'journal', 'journal name', 'source title', 'source', 'so', 'full journal title',
    'title', 'journal title', 'journal title in english', '期刊', '期刊名', '刊名', '来源期刊', '来源',
  ]));
  const issn = normalizeIssnList(cleanJournalQualityValue(pickHeaderValue(row, [
    'issn', 'print issn', 'p-issn', 'sn', 'journal issn (print version)', 'issn (print)', '纸质issn',
  ])));
  const eissn = normalizeIssnList(cleanJournalQualityValue(pickHeaderValue(row, [
    'eissn', 'e-issn', 'electronic issn', 'ei', 'journal eissn (online version)', 'issn (online)', '电子issn',
  ])));
  const jcrQuartile = normalizeJournalQualityQuartile(cleanJournalQualityValue(pickHeaderValue(row, [
    'jcr quartile', 'jcr_quartile', 'jcr', 'quartile', 'journal quartile', 'sjr best quartile', 'best quartile', 'jcr分区', 'jcr 分区', '分区', 'q',
  ])));
  const casZone = normalizeJournalQualityCasZone(cleanJournalQualityValue(pickHeaderValue(row, [
    'cas zone', 'cas_zone', 'cas', '中科院分区', '中科院', '科学院分区', 'zone',
  ])));
  const impactFactor = parseJournalQualityNumber(pickHeaderValue(row, [
    'impact factor', 'impact_factor', 'jif', 'if', '影响因子', '最新影响因子',
  ]));
  const sourceLevel = cleanJournalQualityValue(pickHeaderValue(row, [
    'source level', 'source_level', 'source quality', 'source_quality', 'index', 'database',
    'sjr best quartile', 'best quartile', 'indexed', 'indexed in', '来源等级', '来源质量', '核心类别', '收录', '数据库',
  ]));
  const notes = cleanJournalQualityValue(pickHeaderValue(row, ['notes', 'note', '备注', '说明']));

  return {
    journal,
    normalizedJournal: normalizeJournalQualityName(journal),
    issn,
    eissn,
    jcrQuartile,
    casZone,
    impactFactor,
    sourceLevel,
    notes,
  };
}

function enrichPapersWithJournalQuality(userId: string, papers: LiteratureRecord[]): LiteratureRecord[] {
  const table = loadJournalQualityTable(userId);
  if (!table || table.rows.length === 0) return papers;
  const byIssn = new Map<string, BibliometricJournalQualityRow>();
  const byJournal = new Map<string, BibliometricJournalQualityRow>();
  for (const row of table.rows) {
    splitQualityTokens(row.issn).forEach(issn => byIssn.set(issn, row));
    splitQualityTokens(row.eissn).forEach(issn => byIssn.set(issn, row));
    if (row.normalizedJournal) byJournal.set(row.normalizedJournal, row);
  }

  return papers.map(paper => {
    const matched = findJournalQualityRow(paper, byIssn, byJournal);
    if (!matched) return paper;
    return {
      ...paper,
      journalQuartile: matched.jcrQuartile || paper.journalQuartile,
      jcrQuartile: matched.jcrQuartile || paper.jcrQuartile,
      casZone: matched.casZone || paper.casZone,
      impactFactor: matched.impactFactor !== null ? matched.impactFactor : paper.impactFactor,
      sourceLevel: matched.sourceLevel || paper.sourceLevel,
      sourceQuality: matched.sourceLevel || paper.sourceQuality,
      journalQualitySource: table.sourceFileName,
      journalQualityMatchedBy: getJournalQualityMatchMethod(paper, matched),
    };
  });
}

function findJournalQualityRow(
  paper: LiteratureRecord,
  byIssn: Map<string, BibliometricJournalQualityRow>,
  byJournal: Map<string, BibliometricJournalQualityRow>
): BibliometricJournalQualityRow | null {
  const paperIssns = [
    paper.issn,
    paper.eissn,
    paper.SN,
    paper.EI,
    (paper.rawData as Record<string, unknown> | undefined)?.fields,
  ];
  for (const value of paperIssns) {
    for (const token of extractIssnTokens(value)) {
      const matched = byIssn.get(token);
      if (matched) return matched;
    }
  }
  const journalKey = normalizeJournalQualityName(String(paper.journal || ''));
  return journalKey ? byJournal.get(journalKey) || null : null;
}

function getJournalQualityMatchMethod(paper: LiteratureRecord, row: BibliometricJournalQualityRow): string {
  const rowIssns = new Set([...splitQualityTokens(row.issn), ...splitQualityTokens(row.eissn)]);
  const paperIssns = extractIssnTokens([paper.issn, paper.eissn, paper.SN, paper.EI]);
  if (paperIssns.some(issn => rowIssns.has(issn))) return 'issn';
  return 'journal-name';
}

function pickHeaderValue(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalizedAliases = new Set(aliases.map(normalizeJournalQualityHeader));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedAliases.has(normalizeJournalQualityHeader(key))) return value;
  }
  return '';
}

function cleanJournalQualityValue(value: unknown): string {
  return String(value ?? '')
    .replace(/\r/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeJournalQualityHeader(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[\s_\-()（）[\]【】.：:]/g, '')
    .trim();
}

function normalizeJournalQualityName(value: string): string {
  return cleanJournalQualityValue(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\bthe\b/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
    .trim();
}

function normalizeIssnList(value: string): string {
  return extractIssnTokens(value).join('; ');
}

function extractIssnTokens(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(extractIssnTokens);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(extractIssnTokens);
  const text = String(value).toUpperCase();
  const matches = text.match(/[0-9X]{4}[-\s]?[0-9X]{4}/g) || [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const compact = match.replace(/[^0-9X]/g, '');
    if (compact.length !== 8 || seen.has(compact)) continue;
    seen.add(compact);
    result.push(compact);
  }
  return result;
}

function splitQualityTokens(value: string): string[] {
  return value.split(/[;；,，\s]+/).map(item => item.trim()).filter(Boolean);
}

function normalizeJournalQualityQuartile(value: string): string {
  const upper = value.toUpperCase().replace(/\s+/g, '');
  const match = upper.match(/Q[1-4]/);
  return match ? match[0] : value;
}

function normalizeJournalQualityCasZone(value: string): string {
  const text = value.replace(/\s+/g, '');
  if (!text) return '';
  const match = text.match(/[1-4]区/);
  if (match) return match[0];
  if (/^[1-4]$/.test(text)) return `${text}区`;
  return value;
}

function parseJournalQualityNumber(value: unknown): number | null {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const match = text.match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function hashRouteText(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function compactTimestampForRoute(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14);
}

function analyzeWosDatasetForUser(
  userId: string,
  papers: LiteratureRecord[],
  options: Partial<z.infer<typeof querySchema>> = {}
): BibliometricAnalysis {
  const keywordMerges = loadBibliometricKeywordMergeConfig(userId);
  const hasMergedKeywordRules = keywordMerges.mergedTags.length > 0 || keywordMerges.promotedTags.length > 0;
  const forceRawKeywords = options.useMergedKeywordTags === 'false';
  return analyzeBibliometrics(papers, {
    ...options,
    useMergedKeywordTags: !forceRawKeywords && hasMergedKeywordRules,
    outerTags: forceRawKeywords ? undefined : keywordMerges,
  });
}

function buildKeywordMergeCandidates(papers: LiteratureRecord[]): Array<{ label: string; count: number; percentage: number }> {
  if (!papers.length) return [];
  return analyzeBibliometrics(papers, {
    topN: 100,
    keywordNodeLimit: 20,
    authorNodeLimit: 20,
    edgeLimit: 40,
    similarityNodeLimit: 20,
    similarityEdgeLimit: 40,
    keywordTrendLimit: 3,
    useMergedKeywordTags: false,
  }).topKeywords;
}

function upsertBibliometricKeywordMerge(
  current: OuterTagsConfig,
  name: string,
  keywords: string[],
  papers: LiteratureRecord[]
): OuterTagsConfig {
  const tagName = normalizeKeyword(name);
  const originalKeywords = uniqueNormalizedKeywords(keywords);
  if (!tagName) throw new Error('合并后的主关键词不能为空');
  if (!originalKeywords.length) throw new Error('请至少选择一个原始关键词');

  const selected = new Set(originalKeywords);
  const prunedTags = current.mergedTags
    .filter(tag => normalizeKeyword(tag.name) !== tagName)
    .map(tag => ({
      ...tag,
      originalKeywords: tag.originalKeywords.filter(keyword => !selected.has(normalizeKeyword(keyword))),
    }))
    .filter(tag => tag.originalKeywords.length > 0);
  const literatureIds = collectKeywordMergeLiteratureIds(papers, originalKeywords);

  return sanitizeOuterTagsConfig({
    ...current,
    mergedTags: [
      ...prunedTags,
      {
        name: tagName,
        originalKeywords,
        count: literatureIds.length,
        literatureIds,
      },
    ].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  });
}

function uniqueNormalizedKeywords(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = normalizeKeyword(String(value || ''));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

function collectKeywordMergeLiteratureIds(papers: LiteratureRecord[], keywords: string[]): string[] {
  const keywordSet = new Set(keywords.map(normalizeKeyword).filter(Boolean));
  const ids: string[] = [];
  for (const paper of papers) {
    const paperKeywords = getPaperKeywords(paper).map(normalizeKeyword);
    if (!paperKeywords.some(keyword => Array.from(keywordSet).some(target =>
      keyword === target || keyword.includes(target) || target.includes(keyword)
    ))) continue;
    ids.push(String(paper.id || paper.doi || paper.title || '').trim());
  }
  return ids.filter(Boolean);
}

function getUploadedBibliometricFiles(req: Request): Express.Multer.File[] {
  const files = req.files;
  if (!files) return [];
  if (Array.isArray(files)) return files;
  const grouped = files as Record<string, Express.Multer.File[]>;
  return [...(grouped.file || []), ...(grouped.files || [])];
}

function saveWosDataset(
  userId: string,
  dataset: WosPlainTextDataset,
  sourceFiles: Array<{ fileName: string; content: string }>
): void {
  const baseDir = getBibliometricsDir(userId);
  const datasetDir = path.join(baseDir, 'datasets', dataset.id);
  const sourceDir = path.join(datasetDir, 'source');
  fs.mkdirSync(sourceDir, { recursive: true });
  sourceFiles.forEach((source, index) => {
    fs.writeFileSync(
      path.join(sourceDir, sanitizeBibliometricSourceFileName(`${String(index + 1).padStart(2, '0')}-${source.fileName}`)),
      source.content,
      'utf-8'
    );
  });
  fs.writeFileSync(path.join(datasetDir, 'dataset.json'), JSON.stringify(dataset, null, 2), 'utf-8');
  fs.writeFileSync(getCurrentWosDatasetPath(userId), JSON.stringify(dataset, null, 2), 'utf-8');
}

function splitDatasetSourceNames(value: string): string[] {
  return String(value || '')
    .split(/\s*;\s*/)
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueSourceFileNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    const key = value.toLowerCase();
    if (!value || seen.has(key)) return;
    seen.add(key);
    result.push(value);
  });
  return result;
}

function sanitizeBibliometricSourceFileName(fileName: string): string {
  const ext = path.extname(fileName || '').toLowerCase() || '.txt';
  const base = path.basename(fileName || 'savedrecs', ext)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'savedrecs';
  return `${base}${ext}`;
}

function decodeTextBuffer(buffer: Buffer): string {
  const utf8 = buffer.toString('utf-8');
  const replacementCount = (utf8.match(/\uFFFD/g) || []).length;
  if (replacementCount > Math.max(20, utf8.length * 0.01)) {
    return buffer.toString('latin1');
  }
  return utf8;
}

function ensureBibliometricArtifacts(
  userId: string,
  dataset: WosPlainTextDataset,
  analysis: BibliometricAnalysis,
  force = false
): BibliometricArtifactManifest {
  const outputDir = getCurrentBibliometricOutputDir(userId, dataset.id);
  const existing = force ? null : readBibliometricArtifactManifest(outputDir);
  const hasCurrentFigureNames = existing?.figures?.every((figure, index) => figure.filename === `figure${index + 1}.svg`) ?? false;
  if (existing && existing.datasetId === dataset.id && hasCurrentFigureNames) {
    return existing;
  }
  return buildBibliometricArtifacts({ analysis, dataset, outputDir });
}

function buildBibliometricWritingContext(args: {
  userId: string;
  analysis: BibliometricAnalysis;
  dataset: Record<string, unknown>;
  artifacts: BibliometricArtifactManifest | null;
  keywordMerges: OuterTagsConfig;
  journalQualityTable: BibliometricJournalQualityTableSummary | null;
}): BibliometricWritingContext {
  const figures = buildBibliometricContextFigures(args.userId, args.dataset, args.artifacts);
  const tables = (args.artifacts?.tables || []).map(table => ({
    id: table.id,
    title: table.title,
    filename: table.filename,
    relativePath: table.relativePath,
    description: table.description,
    url: buildBibliometricArtifactFileUrl(args.userId, table.relativePath),
  }));
  const exports = buildBibliometricExportUrls(args.userId);
  const contextWithoutMarkdown = {
    generatedAt: new Date().toISOString(),
    source: 'bibliometrics-writing-context' as const,
    available: true,
    dataset: args.dataset,
    analysis: args.analysis,
    keywordMerges: args.keywordMerges,
    journalQualityTable: args.journalQualityTable,
    artifacts: args.artifacts,
    figures,
    tables,
    exports,
  };

  return {
    ...contextWithoutMarkdown,
    contextMarkdown: buildBibliometricWritingContextMarkdown(contextWithoutMarkdown),
  };
}

function buildBibliometricContextFigures(
  userId: string,
  dataset: Record<string, unknown>,
  artifacts: BibliometricArtifactManifest | null
): BibliometricContextFigure[] {
  const previewFigures: BibliometricContextFigure[] = (artifacts?.figures || []).map(figure => {
    const url = buildBibliometricArtifactFileUrl(userId, figure.relativePath);
    return {
      kind: 'svg-preview',
      name: figure.filename.replace(/\.[^.]+$/, ''),
      title: figure.title,
      source: figure.dataUsed.join(', '),
      filename: figure.filename,
      relativePath: figure.relativePath,
      url,
      markdown: `![${figure.title}](${url})`,
      description: figure.description,
      dataUsed: figure.dataUsed,
      status: figure.status,
      available: true,
    };
  });

  const datasetId = String(dataset.id || '');
  const outputDir = datasetId ? getCurrentBibliometricOutputDir(userId, datasetId) : '';
  const paperFigures: BibliometricContextFigure[] = BIBLIOMETRIC_FIGURE_SPECS.map(figure => {
    const candidates = [
      `plots/${figure.name}.png`,
      `plots/${figure.name}.pdf`,
      `plots/${figure.name}.svg`,
      `${figure.name}.svg`,
    ];
    const existingRelativePath = outputDir
      ? candidates.find(candidate => fs.existsSync(path.join(outputDir, candidate)))
      : undefined;
    const url = existingRelativePath ? buildBibliometricArtifactFileUrl(userId, existingRelativePath) : undefined;
    return {
      kind: 'paper-figure',
      name: figure.name,
      title: formatBibliometricFigureTitle(figure),
      source: figure.source,
      note: figure.note,
      filename: existingRelativePath || `plots/${figure.name}.png`,
      relativePath: existingRelativePath || `plots/${figure.name}.png`,
      url,
      markdown: url ? `![${figure.name}](${url})` : undefined,
      available: !!url,
    };
  });

  return [...previewFigures, ...paperFigures];
}

function buildBibliometricExportUrls(userId: string): BibliometricWritingContext['exports'] {
  const query = `userId=${encodeURIComponent(userId)}&topN=100&keywordNodeLimit=120&authorNodeLimit=100&edgeLimit=400&similarityNodeLimit=120&similarityEdgeLimit=300&keywordTrendLimit=12`;
  return {
    analysisWorkbookUrl: `/api/bibliometrics/export?${query}`,
    datasetWorkbookUrl: `/api/bibliometrics/dataset/export?userId=${encodeURIComponent(userId)}`,
    figureZipUrl: `/api/bibliometrics/artifacts/download?${query}`,
  };
}

function buildBibliometricWritingContextMarkdown(context: Omit<BibliometricWritingContext, 'contextMarkdown'>): string {
  const readyImages = context.figures.filter(figure => figure.available && figure.url);
  const paperFigures = context.figures.filter(figure => figure.kind === 'paper-figure');
  const previewFigures = context.figures.filter(figure => figure.kind === 'svg-preview');
  return [
    '# 文献计量分析写作上下文',
    '',
    '下面内容由 Scholar Harness 自动从当前用户的文献计量分析库调用。写作文献计量学文章时，应优先使用这里的完整分析结果、图件索引和表格索引；不要编造这里没有的数值、年份、频次、网络节点/边数、期刊分区或图号。',
    '',
    '## 调用规则',
    '- “完整分析结果 JSON”是写作时可调用的全部文献计量分析结果。',
    '- 正文中引用图件时使用 figure1、figure2 等图号；图件说明和图片链接放在文末“图件与注释”或图表清单中。',
    '- 如果某张正式 R 图件暂时没有可访问 URL，可先引用图号、标题、数据来源和注释，提示用户生成或下载图表包。',
    '- 可直接访问的 SVG 预览图可用于理解图形内容，但不要把图片视觉细节写成超过数据表支持的结论。',
    '',
    '## 数据库摘要',
    '```json',
    JSON.stringify(context.dataset, null, 2),
    '```',
    '',
    '## 图片索引',
    '',
    '### 可直接访问的 SVG 预览图',
    previewFigures.length
      ? previewFigures.map(figure => `- ${figure.name}: ${figure.title}；文件 ${figure.relativePath}；URL ${figure.url}；数据来源 ${figure.source}；状态 ${figure.status || 'ready'}。`).join('\n')
      : '- 当前没有可直接访问的 SVG 预览图。',
    '',
    '### 正式论文图号 figure1 至 figure14',
    paperFigures.map(figure => `- ${figure.name}: ${figure.title}；预期文件 ${figure.relativePath}；${figure.url ? `URL ${figure.url}` : '暂未检测到可访问图片文件'}；数据来源 ${figure.source}；注释 ${figure.note || ''}`).join('\n'),
    '',
    '### 可直接访问图片 Markdown',
    readyImages.length
      ? readyImages.map(figure => `- ${figure.name}: ${figure.markdown}`).join('\n')
      : '- 当前没有可直接访问的图片 Markdown。',
    '',
    '## 表格索引',
    context.tables.length
      ? context.tables.map(table => `- ${table.title}: ${table.relativePath}；URL ${table.url}；说明 ${table.description}`).join('\n')
      : '- 当前没有额外表格产物。',
    '',
    '## 导出接口',
    `- 分析结果 Excel: ${context.exports.analysisWorkbookUrl}`,
    `- WoS 解析数据库 Excel: ${context.exports.datasetWorkbookUrl}`,
    `- 图表包 ZIP: ${context.exports.figureZipUrl}`,
    '',
    '## 关键词合并配置',
    '```json',
    JSON.stringify(context.keywordMerges, null, 2),
    '```',
    '',
    '## 期刊质量表摘要',
    '```json',
    JSON.stringify(context.journalQualityTable, null, 2),
    '```',
    '',
    '## 完整分析结果 JSON',
    '```json',
    JSON.stringify(context.analysis, null, 2),
    '```',
    '',
    '## 图件 Manifest',
    '```json',
    JSON.stringify(context.artifacts, null, 2),
    '```',
  ].join('\n');
}

async function buildBibliometricPaperDraftWithFallback(
  analysis: BibliometricAnalysis,
  artifacts?: BibliometricArtifactManifest | null
): Promise<BibliometricPaperDraft> {
  const templateDraft = buildBibliometricPaperDraft(analysis, artifacts);
  const fallbackAttempts: string[] = [];
  try {
    const prompt = buildBibliometricPaperDraftPrompt(analysis, templateDraft, artifacts);
    const aiMarkdown = stripMarkdownFence(await chatBridge.chat({
      forceProvider: 'codex',
      temperature: 0.25,
      maxTokens: 20000,
      codexTimeoutMs: 600000,
      messages: [
        {
          role: 'system',
          content: [
            '你是 Scholar Harness 的文献计量论文写作 Agent。',
            '默认执行顺序由系统处理：Codex CLI 优先；失败后降级小牛马；再失败降级大牛马。',
            '你的任务是把文献计量分析结果写成可编辑的论文草稿，不要编造不存在的数据、年份、网络指标、期刊分区或引用。',
            '只输出 Markdown 正文。',
          ].join('\n'),
        },
        { role: 'user', content: prompt },
      ],
    }));
    if (aiMarkdown.trim().length < 1200) {
      fallbackAttempts.push('AI 返回内容过短，已回退到内置模板草稿。');
      return { ...templateDraft, fallbackAttempts };
    }
    return {
      ...templateDraft,
      mode: 'ai',
      provider: 'Codex CLI -> 小牛马 -> 大牛马',
      fallbackAttempts,
      markdown: ensureBibliometricFigureAppendixInMarkdown(aiMarkdown),
    };
  } catch (error) {
    fallbackAttempts.push((error as Error).message || String(error));
    return {
      ...templateDraft,
      fallbackAttempts,
    };
  }
}

function buildBibliometricPaperDraft(
  analysis: BibliometricAnalysis,
  artifacts?: BibliometricArtifactManifest | null
): BibliometricPaperDraft {
  const s = analysis.summary;
  const yearRange = s.yearMin && s.yearMax ? `${s.yearMin}-${s.yearMax}` : '年份未完整解析';
  const topKeywords = analysis.topKeywords.slice(0, 5).map(item => item.label);
  const titleKeyword = topKeywords.slice(0, 3).join('、') || '目标主题';
  const title = `${titleKeyword}研究热点、知识结构与主题演化的文献计量分析`;
  const keywordMode = analysis.keywordTagSource.mode === 'merged-tags'
    ? `使用合并关键词标签（${analysis.keywordTagSource.mergedTagCount} 个合并标签）`
    : '使用 WoS 原始关键词、Keywords Plus、学科分类和研究方向字段';

  const flow = [
    { step: '1. 数据导入与清洗', dataUsed: 'Summary, DataQuality, KeywordTagSource', output: '明确样本文献量、年份范围、字段覆盖率和关键词来源。' },
    { step: '2. 描述性计量', dataUsed: 'YearTrend, TopJournals, TopAuthors, TopKeywords', output: '写年度趋势、核心来源、作者分布和高频主题词。' },
    { step: '3. 知识结构分析', dataUsed: 'KeywordNetwork, TopicClusters, SimilarityNetwork, CoCitationNetwork, CouplingNetwork', output: '写热点主题、语义相似文献群、知识基础和研究路径。' },
    { step: '4. 演化与前沿识别', dataUsed: 'KeywordBursts, KeywordYearTrends, TopicEvolution', output: '写突现关键词、主流关键词年际变化和阶段性主题迁移。' },
    { step: '5. 合作格局与质量控制', dataUsed: 'AuthorNetwork, InstitutionNetwork, CountryNetwork, JournalQuality, RetrievalQuality', output: '写作者/机构/国家合作格局、期刊质量和检索局限。' },
    { step: '6. 论文成稿', dataUsed: 'WritingPreparation + all bibliometric sheets', output: '生成摘要、方法、结果、讨论、结论和图表清单。' },
  ];

  const sections = [
    {
      id: 'abstract',
      title: '摘要',
      dataUsed: ['Summary', 'TopKeywords', 'TopicClusters', 'KeywordBursts', 'RetrievalQuality'],
      content: [
        `目的：为系统把握 ${titleKeyword} 相关研究的发展脉络、热点主题和知识结构，本文基于本地文献库开展文献计量分析。`,
        `方法：纳入 ${s.total} 篇文献，时间范围为 ${yearRange}；${keywordMode}；综合采用年度发文趋势、来源期刊/作者/关键词统计、关键词共现、主题聚类、突现词、关键词年际趋势、共被引/文献耦合和合作网络分析。`,
        `结果：文献库覆盖 ${s.journalCount} 个来源期刊、${s.authorCount} 位作者和 ${s.keywordCount} 个关键词。高频关键词包括 ${formatRankInline(analysis.topKeywords, 8)}。主要主题簇包括 ${formatTopicInline(analysis.topicClusters)}。${formatBurstSentence(analysis)}${formatTrendSentence(analysis)}。`,
        `结论：该领域已经形成若干围绕核心主题词和代表性文献群展开的研究方向，但当前数据仍需结合字段覆盖率、参考文献列表和机构地址完整度谨慎解释。`,
      ].join('\n\n'),
    },
    {
      id: 'introduction',
      title: '引言',
      dataUsed: ['TopKeywords', 'TopicClusters', 'YearTrend'],
      content: [
        `${titleKeyword}相关研究通常涉及多学科知识、方法体系和应用情境。随着文献数量增长，传统叙述性综述难以全面揭示研究热点、知识基础和主题演化路径。`,
        `从当前文献库看，${formatRankInline(analysis.topKeywords, 6)}构成了主要关键词集合，提示该主题已围绕若干稳定概念展开。文献计量方法能够在较大样本文献上识别高频主题、主题簇、合作关系和研究前沿，从而为后续系统综述、机制解释和选题收敛提供依据。`,
        `因此，本文以 ${s.total} 篇文献为分析对象，构建年度趋势、关键词共现、主题演化、共被引/文献耦合和合作网络，并进一步讨论该领域的研究结构、热点迁移和数据局限。`,
      ].join('\n\n'),
    },
    {
      id: 'methods',
      title: '数据来源与方法',
      dataUsed: ['Summary', 'DataQuality', 'KeywordTagSource', 'Network sheets'],
      content: [
        `数据来源于用户上传的 Web of Science Plain Text 文件，共纳入 ${s.total} 条 Full Record。记录的发表年份范围为 ${yearRange}，其中带摘要记录 ${s.abstractCount} 条，带 DOI 记录 ${s.doiCount} 条，带 cited references 记录 ${s.referenceCount} 条。`,
        `关键词处理采用如下规则：${analysis.keywordTagSource.note}。该步骤用于降低同义词、大小写和 AI 标签差异对关键词统计与共现网络的干扰。`,
        `描述性分析包括年度发文量、来源期刊、作者、关键词、文献类型和数据覆盖率。网络分析包括关键词共现、作者合作、机构合作、国家/地区合作、共被引和文献耦合。主题演化分析包括关键词突现、主流关键词年际变化和分时期主题统计。全部图件统一按 figure1 至 figure14 命名，正文仅引用图件名称，图片和图注集中放在文末。`,
        `质量控制通过检索质量分、字段覆盖率和可复现导出表进行记录，字段完整性见 figure8。当前检索质量分为 ${analysis.retrievalQuality.score}/100；主要问题为：${formatListInline(analysis.retrievalQuality.issues, '暂未发现硬性问题')}。`,
      ].join('\n\n'),
    },
    {
      id: 'results',
      title: '结果',
      dataUsed: ['YearTrend', 'TopJournals', 'TopAuthors', 'TopKeywords', 'Networks', 'Bursts', 'TopicEvolution'],
      content: [
        `年度趋势见 figure1，样本文献覆盖 ${yearRange}。核心来源期刊分布见 figure2，主要来源包括 ${formatRankInline(analysis.topJournals, 6)}；高产作者分布见 figure3，主要作者包括 ${formatRankInline(analysis.topAuthors, 6)}。`,
        `高频关键词分布见 figure4，主要关键词为 ${formatRankInline(analysis.topKeywords, 10)}。关键词共现网络见 figure9，包含 ${analysis.keywordNetwork.nodes.length} 个节点和 ${analysis.keywordNetwork.edges.length} 条边，主题聚类识别出 ${analysis.topicClusters.length} 个主要主题簇：${formatTopicInline(analysis.topicClusters)}。`,
        `${formatTrendParagraph(analysis)}`,
        `${formatStructureParagraph(analysis)}`,
        `${formatCollaborationParagraph(analysis)}`,
      ].join('\n\n'),
    },
    {
      id: 'discussion',
      title: '讨论',
      dataUsed: ['TopicClusters', 'KeywordYearTrends', 'CoCitationNetwork', 'RetrievalQuality', 'WritingPreparation'],
      content: [
        `综合关键词共现、主题聚类和年际趋势结果，${titleKeyword}相关研究呈现出由核心高频主题支撑、由若干子主题簇扩展的知识结构。主流关键词年际变化见 figure5，关键词突现变化见 figure6，可用于判断哪些主题持续稳定，哪些主题具有阶段性增长或前沿潜力。`,
        `共被引网络见 figure13，文献耦合网络见 figure14，二者可分别反映知识基础和研究路径相似性。若参考文献字段覆盖不足，应避免对共被引网络作过强解释，并在论文方法与局限部分明确说明。`,
        `作者、机构和国家/地区合作网络分别见 figure10、figure11 和 figure12。若机构或国家字段缺失，合作格局更适合作为探索性结果，而不宜作为强结论。`,
        `本研究的主要局限包括：${formatListInline(analysis.writingPreparation.limitations, '自动计量分析依赖当前文献库字段，不等同于人工系统综述')}。后续应补充检索式、数据库来源、筛选流程、去重规则和字段清洗规则，以提高可复现性。`,
      ].join('\n\n'),
    },
    {
      id: 'conclusion',
      title: '结论',
      dataUsed: ['Summary', 'TopKeywords', 'TopicClusters', 'WritingPreparation'],
      content: [
        `本文基于 ${s.total} 篇文献构建了 ${titleKeyword} 相关研究的文献计量图谱。结果表明，该领域的核心主题集中在 ${formatRankInline(analysis.topKeywords, 5)}，并形成了 ${analysis.topicClusters.length} 个主要主题簇。`,
        `内置计量流程能够把文献库中的年度趋势、关键词、主题簇、网络结构、突现词、合作格局和质量评估直接转化为论文写作材料，并在文末集中输出 figure1 至 figure14 的图片、图题和注释。正式投稿前仍需人工核查检索式、数据源、字段清洗和图表解释。`,
      ].join('\n\n'),
    },
  ];

  const figureItems = BIBLIOMETRIC_FIGURE_SPECS.map(figure => ({
    type: 'figure' as const,
    name: figure.name,
    title: formatBibliometricFigureTitle(figure),
    source: figure.source,
    file: `plots/${figure.name}.png`,
    note: figure.note,
  }));
  const artifactTables = artifacts?.tables?.length
    ? artifacts.tables.map(table => ({
        type: 'table' as const,
        title: table.title,
        source: table.filename,
      }))
    : [];
  const figuresAndTables = [...figureItems, ...artifactTables];

  const markdown = [
    `# ${title}`,
    '',
    '## 内置写作流程',
    ...flow.map(item => `- ${item.step}：调用 ${item.dataUsed}，输出 ${item.output}`),
    '',
    ...sections.flatMap(section => [
      `## ${section.title}`,
      '',
      `> 数据调用：${section.dataUsed.join('；')}`,
      '',
      section.content,
      '',
    ]),
    '## 建议图表',
    '',
    ...figuresAndTables.map((item, index) => item.type === 'figure'
      ? `${index + 1}. 图：${item.name}，${item.title}。文件：${item.file}。数据来源：${item.source}。注释：${item.note}`
      : `${index + 1}. 表：${item.title}。数据来源：${item.source}。`),
    '## 数据调用索引',
    '',
    `- 年份范围：${yearRange}`,
    `- 文献总数：${s.total}`,
    `- 关键词来源：${analysis.keywordTagSource.note}`,
    `- 高频关键词：${formatRankInline(analysis.topKeywords, 10)}`,
    `- 主题簇：${formatTopicInline(analysis.topicClusters)}`,
    `- 检索质量分：${analysis.retrievalQuality.score}/100`,
    '',
    ...buildBibliometricFigureAppendix(),
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    title,
    mode: 'template',
    provider: '内置模板',
    fallbackAttempts: [],
    flow,
    sections,
    figuresAndTables,
    markdown,
  };
}

function buildBibliometricPaperDraftPrompt(
  analysis: BibliometricAnalysis,
  templateDraft: BibliometricPaperDraft,
  artifacts?: BibliometricArtifactManifest | null
): string {
  const compact = {
    generatedAt: analysis.generatedAt,
    summary: analysis.summary,
    keywordTagSource: analysis.keywordTagSource,
    topKeywords: analysis.topKeywords.slice(0, 20),
    topJournals: analysis.topJournals.slice(0, 15),
    topAuthors: analysis.topAuthors.slice(0, 15),
    topicClusters: analysis.topicClusters.slice(0, 8),
    keywordBursts: analysis.keywordBursts.slice(0, 15),
    keywordYearTrends: analysis.keywordYearTrends.slice(0, 8),
    topicEvolution: analysis.topicEvolution.slice(0, 8),
    highImpactLiteratures: analysis.highImpactLiteratures.slice(0, 12),
    networks: {
      keyword: {
        nodeCount: analysis.keywordNetwork.nodes.length,
        edgeCount: analysis.keywordNetwork.edges.length,
        topNodes: analysis.keywordNetwork.nodes.slice(0, 20),
      },
      author: {
        nodeCount: analysis.authorNetwork.nodes.length,
        edgeCount: analysis.authorNetwork.edges.length,
        topNodes: analysis.authorNetwork.nodes.slice(0, 15),
      },
      similarity: {
        nodeCount: analysis.literatureSimilarityNetwork.nodes.length,
        edgeCount: analysis.literatureSimilarityNetwork.edges.length,
      },
      coCitation: {
        nodeCount: analysis.coCitationNetwork.nodes.length,
        edgeCount: analysis.coCitationNetwork.edges.length,
      },
      coupling: {
        nodeCount: analysis.bibliographicCouplingNetwork.nodes.length,
        edgeCount: analysis.bibliographicCouplingNetwork.edges.length,
      },
      institution: {
        nodeCount: analysis.institutionNetwork.nodes.length,
        edgeCount: analysis.institutionNetwork.edges.length,
        topNodes: analysis.institutionNetwork.nodes.slice(0, 15),
      },
      country: {
        nodeCount: analysis.countryNetwork.nodes.length,
        edgeCount: analysis.countryNetwork.edges.length,
        topNodes: analysis.countryNetwork.nodes.slice(0, 15),
      },
    },
    journalQuality: analysis.journalQuality,
    retrievalQuality: analysis.retrievalQuality,
    writingPreparation: analysis.writingPreparation,
    figureArtifacts: artifacts ? {
      figures: artifacts.figures,
      tables: artifacts.tables,
      paperFigureInstructions: artifacts.paperFigureInstructions,
    } : null,
  };

  return [
    '请基于下面的文献计量分析数据，把模板草稿升级为一篇可继续编辑的中文文献计量论文草稿。',
    '',
    '硬性要求：',
    '1. 保留 Markdown 结构，包含题目、摘要、引言、数据来源与方法、结果、讨论、结论、建议图表、数据调用索引、图件与注释。',
    '2. 所有数字、年份、频次、网络节点/边数必须来自“分析数据”或“模板草稿”，不要编造。',
    '3. 如果某项数据缺失，要写成局限或待补充数据，不要强行下结论。',
    '4. 结果部分要明确调用年度趋势、关键词、主题簇、突现词、关键词年际变化、文献结构网络、合作格局和质量评估。',
    '5. 正文中只用 figure1、figure2 这类文件名引用图件，不要在正文中插入图片。',
    '6. 图片必须集中放在文末“图件与注释”部分，每张图保留图片链接、图题和必要注释。',
    '7. 图表部分必须使用模板草稿中的 figure1 至 figure14 命名；不要虚构不存在的图号或文件名。',
    '8. 输出正文即可，不要解释你使用了哪个模型或工具。',
    '',
    '## 分析数据（JSON）',
    '```json',
    JSON.stringify(compact, null, 2),
    '```',
    '',
    '## 模板草稿',
    templateDraft.markdown,
  ].join('\n');
}

function stripMarkdownFence(content: string): string {
  const trimmed = content.trim();
  const match = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function buildBibliometricRScript(analysis: BibliometricAnalysis): BibliometricRScript {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const expectedFiles = [
    ...BIBLIOMETRIC_FIGURE_SPECS.flatMap(figure => [`plots/${figure.name}.png`, `plots/${figure.name}.pdf`]),
    'plots/figure_captions.csv',
    'plots/figure_captions.md',
  ];
  const rCode = [
    '# Scholar Harness - bibliometric figures',
    `# Generated at: ${new Date().toISOString()}`,
    'options(stringsAsFactors = FALSE)',
    'dir.create("plots", showWarnings = FALSE, recursive = TRUE)',
    '',
    'required_packages <- c("ggplot2", "dplyr", "scales", "igraph", "ggrepel", "grid")',
    'missing_packages <- required_packages[!vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)]',
    'if (length(missing_packages) > 0) {',
    '  stop(paste("Missing R packages:", paste(missing_packages, collapse = ", "), "请在 ScholarHarness 的 R语言作图窗口点击一键安装R插件，或在 R 中 install.packages(missing_packages)."))',
    '}',
    'library(ggplot2)',
    'library(dplyr)',
    'library(scales)',
    'library(igraph)',
    'library(ggrepel)',
    'library(grid)',
    '',
    'font_family <- "serif"',
    'if (.Platform$OS.type == "windows") {',
    '  try(windowsFonts(serif = windowsFont("TT Times New Roman")), silent = TRUE)',
    '}',
    '',
    'base_font_size <- 15',
    'axis_text_size <- 13.2',
    'axis_title_size <- 14.4',
    'plot_title_size <- 16.8',
    'legend_text_size <- 12.8',
    'legend_title_size <- 13.8',
    'network_label_size <- 3.85',
    'annotation_text_size <- 4.8',
    '',
    'theme_scholar <- theme_bw(base_size = base_font_size) +',
    '  theme(',
    '    text = element_text(family = font_family, size = base_font_size),',
    '    panel.grid.minor = element_blank(),',
    '    panel.grid.major = element_line(linewidth = 0.25, colour = "#e6ece8"),',
    '    panel.border = element_rect(colour = "#0f3d31", fill = NA, linewidth = 0.6),',
    '    axis.text = element_text(colour = "#16231f", family = font_family, size = axis_text_size),',
    '    axis.title = element_text(colour = "#16231f", family = font_family, size = axis_title_size),',
    '    plot.title = element_text(face = "bold", colour = "#0f3d31", family = font_family, size = plot_title_size),',
    '    legend.text = element_text(family = font_family, size = legend_text_size),',
    '    legend.title = element_text(family = font_family, size = legend_title_size),',
    '    legend.position = "right",',
    '    plot.margin = margin(10, 16, 10, 10)',
    '  )',
    '',
    'theme_network <- theme_void(base_family = font_family) +',
    '  theme(',
    '    plot.title = element_text(face = "bold", colour = "#0f3d31", family = font_family, size = plot_title_size, hjust = 0),',
    '    legend.position = "right",',
    '    plot.margin = margin(12, 22, 12, 22)',
    '  )',
    '',
    'dark_green <- "#0f3d31"',
    'mid_green <- "#1f6f54"',
    'soft_green <- "#8fb7a1"',
    'gold <- "#d9a441"',
    'palette_scholar <- c("#0f3d31", "#1f6f54", "#4d8a6b", "#d9a441", "#8fb7a1", "#2f5d50", "#a5c9b4", "#6d7d39", "#276749", "#b7791f")',
    '',
    buildRDataFrame('year_trend', {
      year: analysis.yearTrend.map(item => item.year),
      count: analysis.yearTrend.map(item => item.count),
      cumulative: analysis.yearTrend.map(item => item.cumulative),
    }),
    '',
    buildRDataFrame('figure_captions', {
      figure: BIBLIOMETRIC_FIGURE_SPECS.map(figure => figure.name),
      file: BIBLIOMETRIC_FIGURE_SPECS.map(figure => `${figure.name}.png`),
      title: BIBLIOMETRIC_FIGURE_SPECS.map(figure => formatBibliometricFigureTitle(figure)),
      note: BIBLIOMETRIC_FIGURE_SPECS.map(figure => figure.note),
    }),
    '',
    buildRDataFrame('top_journals', {
      journal: analysis.topJournals.slice(0, 20).map(item => item.label),
      count: analysis.topJournals.slice(0, 20).map(item => item.count),
      percentage: analysis.topJournals.slice(0, 20).map(item => item.percentage),
    }),
    '',
    buildRDataFrame('top_authors', {
      author: analysis.topAuthors.slice(0, 20).map(item => item.label),
      count: analysis.topAuthors.slice(0, 20).map(item => item.count),
      percentage: analysis.topAuthors.slice(0, 20).map(item => item.percentage),
    }),
    '',
    buildRDataFrame('top_keywords', {
      keyword: analysis.topKeywords.slice(0, 20).map(item => item.label),
      count: analysis.topKeywords.slice(0, 20).map(item => item.count),
      percentage: analysis.topKeywords.slice(0, 20).map(item => item.percentage),
    }),
    '',
    buildRDataFrame('keyword_year_trends', {
      keyword: analysis.keywordYearTrends.flatMap(series => series.points.map(() => series.keyword)),
      total: analysis.keywordYearTrends.flatMap(series => series.points.map(() => series.total)),
      peak_year: analysis.keywordYearTrends.flatMap(series => series.points.map(() => series.peakYear ?? null)),
      year: analysis.keywordYearTrends.flatMap(series => series.points.map(point => point.year)),
      count: analysis.keywordYearTrends.flatMap(series => series.points.map(point => point.count)),
      percentage: analysis.keywordYearTrends.flatMap(series => series.points.map(point => point.percentage)),
    }),
    '',
    buildRDataFrame('keyword_bursts', {
      keyword: analysis.keywordBursts.slice(0, 20).map(item => item.keyword),
      score: analysis.keywordBursts.slice(0, 20).map(item => item.score),
      baseline_count: analysis.keywordBursts.slice(0, 20).map(item => item.baselineCount),
      recent_count: analysis.keywordBursts.slice(0, 20).map(item => item.recentCount),
      peak_year: analysis.keywordBursts.slice(0, 20).map(item => item.peakYear ?? null),
    }),
    '',
    buildRDataFrame('source_quality', {
      source_level: analysis.journalQuality.sourceLevels.map(item => item.label),
      count: analysis.journalQuality.sourceLevels.map(item => item.count),
      percentage: analysis.journalQuality.sourceLevels.map(item => item.percentage),
    }),
    '',
    buildRDataFrame('data_quality', {
      metric: analysis.dataQuality.map(item => item.label),
      count: analysis.dataQuality.map(item => item.count),
      percentage: analysis.dataQuality.map(item => item.percentage),
    }),
    '',
    ...buildRNetworkFrames('keyword_network', analysis.keywordNetwork),
    '',
    ...buildRNetworkFrames('author_network', analysis.authorNetwork),
    '',
    ...buildRNetworkFrames('institution_network', analysis.institutionNetwork),
    '',
    ...buildRNetworkFrames('country_network', analysis.countryNetwork),
    '',
    ...buildRNetworkFrames('cocitation_network', analysis.coCitationNetwork),
    '',
    ...buildRNetworkFrames('coupling_network', analysis.bibliographicCouplingNetwork),
    '',
    'save_plot <- function(filename, plot, width = 8, height = 5) {',
    '  ggsave(file.path("plots", paste0(filename, ".png")), plot, width = width, height = height, dpi = 600, bg = "white")',
    '  ggsave(file.path("plots", paste0(filename, ".pdf")), plot, width = width, height = height, device = cairo_pdf, bg = "white")',
    '}',
    '',
    'empty_plot <- function(title, message = "No data available") {',
    '  ggplot() +',
    '    annotate("text", x = 0, y = 0, label = message, family = font_family, size = annotation_text_size, colour = "#5f6f68") +',
    '    labs(title = title, x = NULL, y = NULL) +',
    '    theme_scholar +',
    '    theme(',
    '      axis.text = element_blank(),',
    '      axis.ticks = element_blank(),',
    '      axis.title = element_blank(),',
    '      panel.grid = element_blank()',
    '    )',
    '}',
    '',
    'clean_label <- function(x, max_chars = 34) {',
    '  x <- as.character(x)',
    '  ifelse(nchar(x) > max_chars, paste0(substr(x, 1, max_chars - 1), "..."), x)',
    '}',
    '',
    'rescale_safe <- function(x, to = c(0.2, 1)) {',
    '  finite <- x[is.finite(x)]',
    '  if (length(finite) == 0) return(rep(mean(to), length(x)))',
    '  if (length(unique(finite)) <= 1) return(rep(mean(to), length(x)))',
    '  scales::rescale(x, to = to, from = range(finite, na.rm = TRUE))',
    '}',
    '',
    'spread_layout <- function(layout, min_dist = 0.085, iterations = 95) {',
    '  if (nrow(layout) < 2) return(layout)',
    '  x_range <- range(layout[, 1], na.rm = TRUE)',
    '  y_range <- range(layout[, 2], na.rm = TRUE)',
    '  if (!is.finite(diff(x_range)) || diff(x_range) == 0) layout[, 1] <- seq_len(nrow(layout))',
    '  if (!is.finite(diff(y_range)) || diff(y_range) == 0) layout[, 2] <- rev(seq_len(nrow(layout)))',
    '  layout[, 1] <- scales::rescale(layout[, 1], to = c(-1, 1))',
    '  layout[, 2] <- scales::rescale(layout[, 2], to = c(-1, 1))',
    '  for (iter in seq_len(iterations)) {',
    '    for (i in seq_len(nrow(layout) - 1)) {',
    '      for (j in (i + 1):nrow(layout)) {',
    '        dx <- layout[i, 1] - layout[j, 1]',
    '        dy <- layout[i, 2] - layout[j, 2]',
    '        dist <- sqrt(dx * dx + dy * dy)',
    '        if (!is.finite(dist) || dist == 0) {',
    '          angle <- (i + j + iter) * 0.61803398875',
    '          dx <- cos(angle) * 0.001',
    '          dy <- sin(angle) * 0.001',
    '          dist <- sqrt(dx * dx + dy * dy)',
    '        }',
    '        if (dist < min_dist) {',
    '          move <- (min_dist - dist) / 2',
    '          ux <- dx / dist',
    '          uy <- dy / dist',
    '          layout[i, 1] <- layout[i, 1] + ux * move',
    '          layout[i, 2] <- layout[i, 2] + uy * move',
    '          layout[j, 1] <- layout[j, 1] - ux * move',
    '          layout[j, 2] <- layout[j, 2] - uy * move',
    '        }',
    '      }',
    '    }',
    '  }',
    '  layout[, 1] <- scales::rescale(layout[, 1], to = c(-1.08, 1.08))',
    '  layout[, 2] <- scales::rescale(layout[, 2], to = c(-1.08, 1.08))',
    '  layout',
    '}',
    '',
    'plot_rank_bar <- function(df, label_col, value_col, filename, title, xlab = NULL, fill = mid_green, max_rows = 20, width = 8.4, height = 6.0) {',
    '  if (nrow(df) == 0) {',
    '    save_plot(filename, empty_plot(title), width = width, height = height)',
    '    return(invisible(TRUE))',
    '  }',
    '  df2 <- df %>%',
    '    mutate(.label_raw = .data[[label_col]], .value_raw = .data[[value_col]]) %>%',
    '    filter(!is.na(.label_raw), !is.na(.value_raw)) %>%',
    '    arrange(desc(.value_raw)) %>%',
    '    slice_head(n = max_rows) %>%',
    '    mutate(label_plot = clean_label(.label_raw, 44), label_plot = reorder(label_plot, .value_raw))',
    '  if (nrow(df2) == 0) {',
    '    save_plot(filename, empty_plot(title), width = width, height = height)',
    '    return(invisible(TRUE))',
    '  }',
    '  p <- ggplot(df2, aes(x = label_plot, y = .value_raw)) +',
    '    geom_col(fill = fill, width = 0.72) +',
    '    coord_flip(clip = "off") +',
    '    labs(title = title, x = xlab, y = "Frequency") +',
    '    theme_scholar',
    '  save_plot(filename, p, width = width, height = height)',
    '}',
    '',
    'plot_network <- function(nodes, edges, filename, title, max_nodes = 70, max_edges = 180, label_count = 28, width = 9.4, height = 7.2) {',
    '  if (nrow(nodes) == 0 || nrow(edges) == 0) {',
    '    save_plot(filename, empty_plot(title, "Network data unavailable"), width = width, height = height)',
    '    return(invisible(TRUE))',
    '  }',
    '  nodes2 <- nodes %>%',
    '    filter(!is.na(id), id != "") %>%',
    '    mutate(value = ifelse(is.na(value) | value <= 0, 1, value)) %>%',
    '    arrange(desc(value), label) %>%',
    '    slice_head(n = max_nodes)',
    '  edges2 <- edges %>%',
    '    filter(source %in% nodes2$id, target %in% nodes2$id, source != target) %>%',
    '    mutate(weight = ifelse(is.na(weight) | weight <= 0, 1, weight)) %>%',
    '    arrange(desc(weight)) %>%',
    '    slice_head(n = max_edges)',
    '  if (nrow(nodes2) < 2 || nrow(edges2) == 0) {',
    '    save_plot(filename, empty_plot(title, "Network data unavailable"), width = width, height = height)',
    '    return(invisible(TRUE))',
    '  }',
    '  graph <- igraph::graph_from_data_frame(edges2, directed = FALSE, vertices = nodes2)',
    '  graph <- igraph::simplify(graph, edge.attr.comb = list(weight = "sum", "ignore"))',
    '  if (igraph::vcount(graph) < 2 || igraph::ecount(graph) == 0) {',
    '    save_plot(filename, empty_plot(title, "Network data unavailable"), width = width, height = height)',
    '    return(invisible(TRUE))',
    '  }',
    '  set.seed(20260531)',
    '  lay <- igraph::layout_with_fr(graph, weights = pmax(igraph::E(graph)$weight, 0.1), niter = 2200, grid = "nogrid")',
    '  lay <- spread_layout(lay, min_dist = ifelse(igraph::vcount(graph) > 55, 0.07, 0.09), iterations = 100)',
    '  node_df <- data.frame(id = igraph::V(graph)$name, x = lay[, 1], y = lay[, 2], stringsAsFactors = FALSE) %>%',
    '    left_join(nodes2, by = "id")',
    '  node_df$value <- ifelse(is.na(node_df$value) | node_df$value <= 0, 1, node_df$value)',
    '  node_df$degree <- igraph::degree(graph)[node_df$id]',
    '  node_df$node_size <- rescale_safe(sqrt(node_df$value), to = c(3.2, 12.5))',
    '  edge_df <- as.data.frame(igraph::as_edgelist(graph), stringsAsFactors = FALSE)',
    '  names(edge_df) <- c("source", "target")',
    '  edge_df$weight <- igraph::E(graph)$weight',
    '  edge_df <- edge_df %>%',
    '    left_join(node_df %>% select(id, x, y), by = c("source" = "id")) %>%',
    '    rename(x_source = x, y_source = y) %>%',
    '    left_join(node_df %>% select(id, x, y), by = c("target" = "id")) %>%',
    '    rename(x_target = x, y_target = y) %>%',
    '    mutate(edge_width = rescale_safe(weight, to = c(0.12, 1.15)))',
    '  label_df <- node_df %>%',
    '    mutate(label_score = value + degree) %>%',
    '    arrange(desc(label_score), label)',
    '  label_df <- utils::head(label_df, min(label_count, nrow(label_df))) %>%',
    '    mutate(label_plot = clean_label(label, 30))',
    '  p <- ggplot() +',
    '    geom_segment(data = edge_df, aes(x = x_source, y = y_source, xend = x_target, yend = y_target, linewidth = edge_width),',
    '                 colour = "#8fb7a1", alpha = 0.34, lineend = "round") +',
    '    geom_point(data = node_df, aes(x = x, y = y, size = node_size, fill = value), shape = 21, colour = "white", stroke = 0.42, alpha = 0.93) +',
    '    ggrepel::geom_text_repel(data = label_df, aes(x = x, y = y, label = label_plot),',
    '                             family = font_family, size = network_label_size, colour = "#16231f",',
    '                             box.padding = 0.78, point.padding = 0.55, min.segment.length = 0,',
    '                             segment.size = 0.22, segment.alpha = 0.45, max.overlaps = Inf,',
    '                             force = 3.2, force_pull = 0.12, seed = 20260531) +',
    '    scale_size_identity() +',
    '    scale_fill_gradient(low = "#8fb7a1", high = "#0f3d31", guide = "none") +',
    '    scale_linewidth_identity() +',
    '    coord_equal(clip = "off") +',
    '    labs(title = title) +',
    '    theme_network',
    '  save_plot(filename, p, width = width, height = height)',
    '}',
    '',
    'if (nrow(year_trend) > 0) {',
    '  p_year <- ggplot(year_trend, aes(x = year, y = count)) +',
    '    geom_col(fill = "#1f6f54", width = 0.72) +',
    '    geom_line(aes(y = cumulative / max(cumulative, na.rm = TRUE) * max(count, na.rm = TRUE)), colour = "#d9a441", linewidth = 0.9) +',
    '    geom_point(aes(y = cumulative / max(cumulative, na.rm = TRUE) * max(count, na.rm = TRUE)), colour = "#d9a441", size = 1.6) +',
    '    scale_x_continuous(breaks = pretty_breaks()) +',
    '    labs(title = "Annual publication trend", x = "Year", y = "Publication count") +',
    '    theme_scholar',
    '  save_plot("figure1", p_year, width = 8.2, height = 4.8)',
    '} else {',
    '  save_plot("figure1", empty_plot("Annual publication trend"), width = 8.2, height = 4.8)',
    '}',
    '',
    'plot_rank_bar(top_journals, "journal", "count", "figure2", "Top source journals", fill = dark_green, max_rows = 18, width = 8.8, height = 6.0)',
    'plot_rank_bar(top_authors, "author", "count", "figure3", "Top productive authors", fill = "#4d8a6b", max_rows = 18, width = 8.8, height = 6.0)',
    '',
    'if (nrow(top_keywords) > 0) {',
    '  top_keywords <- top_keywords %>% mutate(keyword = reorder(keyword, count))',
    '  p_keywords <- ggplot(top_keywords, aes(x = keyword, y = count)) +',
    '    geom_col(fill = "#1f6f54", width = 0.72) +',
    '    coord_flip() +',
    '    labs(title = "Top keywords", x = NULL, y = "Frequency") +',
    '    theme_scholar',
    '  save_plot("figure4", p_keywords, width = 8.4, height = 6.2)',
    '} else {',
    '  save_plot("figure4", empty_plot("Top keywords"), width = 8.4, height = 6.2)',
    '}',
    '',
    'if (nrow(keyword_year_trends) > 0) {',
    '  p_keyword_trends <- ggplot(keyword_year_trends, aes(x = year, y = count, colour = keyword, group = keyword)) +',
    '    geom_line(linewidth = 0.8) +',
    '    geom_point(size = 1.6) +',
    '    scale_x_continuous(breaks = pretty_breaks()) +',
    '    scale_colour_manual(values = rep(c("#0f3d31", "#1f6f54", "#4d8a6b", "#d9a441", "#8fb7a1", "#2f5d50", "#a5c9b4", "#6d7d39"), 4)) +',
    '    labs(title = "Yearly trends of mainstream keywords", x = "Year", y = "Frequency", colour = "Keyword") +',
    '    theme_scholar',
    '  save_plot("figure5", p_keyword_trends, width = 9.2, height = 5.6)',
    '} else {',
    '  save_plot("figure5", empty_plot("Yearly trends of mainstream keywords"), width = 9.2, height = 5.6)',
    '}',
    '',
    'if (nrow(keyword_bursts) > 0) {',
    '  keyword_bursts <- keyword_bursts %>% mutate(keyword = reorder(keyword, score))',
    '  p_bursts <- ggplot(keyword_bursts, aes(x = keyword, y = score)) +',
    '    geom_col(fill = "#d9a441", width = 0.72) +',
    '    coord_flip() +',
    '    labs(title = "Burst keywords", x = NULL, y = "Burst score") +',
    '    theme_scholar',
    '  save_plot("figure6", p_bursts, width = 8.4, height = 6.2)',
    '} else {',
    '  save_plot("figure6", empty_plot("Burst keywords"), width = 8.4, height = 6.2)',
    '}',
    '',
    'plot_rank_bar(source_quality, "source_level", "count", "figure7", "Journal/source quality", fill = "#6d7d39", max_rows = 16, width = 8.4, height = 5.4)',
    '',
    'if (nrow(data_quality) > 0) {',
    '  data_quality <- data_quality %>% mutate(metric = reorder(clean_label(metric, 34), percentage))',
    '  p_quality <- ggplot(data_quality, aes(x = metric, y = percentage)) +',
    '    geom_col(fill = soft_green, width = 0.72) +',
    '    coord_flip() +',
    '    scale_y_continuous(limits = c(0, 100), labels = function(x) paste0(x, "%")) +',
    '    labs(title = "Data completeness", x = NULL, y = "Coverage") +',
    '    theme_scholar',
    '  save_plot("figure8", p_quality, width = 8.2, height = 5.4)',
    '} else {',
    '  save_plot("figure8", empty_plot("Data completeness"), width = 8.2, height = 5.4)',
    '}',
    '',
    'plot_network(keyword_network_nodes, keyword_network_edges, "figure9", "Keyword co-occurrence network", max_nodes = 70, max_edges = 180, label_count = 30, width = 9.6, height = 7.2)',
    'plot_network(author_network_nodes, author_network_edges, "figure10", "Author collaboration network", max_nodes = 70, max_edges = 180, label_count = 28, width = 9.4, height = 7.0)',
    'plot_network(institution_network_nodes, institution_network_edges, "figure11", "Institution collaboration network", max_nodes = 60, max_edges = 160, label_count = 24, width = 9.4, height = 7.0)',
    'plot_network(country_network_nodes, country_network_edges, "figure12", "Country/region collaboration network", max_nodes = 55, max_edges = 150, label_count = 24, width = 8.6, height = 6.8)',
    'plot_network(cocitation_network_nodes, cocitation_network_edges, "figure13", "Co-citation network", max_nodes = 65, max_edges = 170, label_count = 24, width = 9.6, height = 7.2)',
    'plot_network(coupling_network_nodes, coupling_network_edges, "figure14", "Bibliographic coupling network", max_nodes = 65, max_edges = 170, label_count = 24, width = 9.6, height = 7.2)',
    '',
    'write.csv(figure_captions, file.path("plots", "figure_captions.csv"), row.names = FALSE, fileEncoding = "UTF-8")',
    'caption_lines <- c("# 文献计量图件与图注", "")',
    'if (nrow(figure_captions) > 0) {',
    '  for (i in seq_len(nrow(figure_captions))) {',
    '    caption_lines <- c(',
    '      caption_lines,',
    '      paste0("## ", figure_captions$figure[i]),',
    '      paste0("图片文件：", figure_captions$file[i]),',
    '      paste0("图题：", figure_captions$title[i]),',
    '      paste0("注释：", figure_captions$note[i]),',
    '      ""',
    '    )',
    '  }',
    '}',
    'writeLines(caption_lines, con = file.path("plots", "figure_captions.md"), useBytes = TRUE)',
    '',
    'writeLines("Scholar Harness bibliometric R figures completed.")',
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    filename: `bibliometrics-figures-${timestamp}.R`,
    rCode,
    expectedFiles,
  };
}

function buildRDataFrame(name: string, columns: Record<string, Array<string | number | null | undefined>>): string {
  const entries = Object.entries(columns);
  const rowCount = entries.reduce((max, [, values]) => Math.max(max, values.length), 0);
  if (!rowCount) {
    return `${name} <- data.frame()`;
  }
  const parts = entries.map(([key, values]) => `  ${key} = c(${values.map(formatRValue).join(', ')})`);
  return [
    `${name} <- data.frame(`,
    parts.join(',\n'),
    '  , stringsAsFactors = FALSE, check.names = FALSE',
    ')',
  ].join('\n');
}

function buildRNetworkFrames(
  prefix: string,
  network: BibliometricAnalysis['keywordNetwork'],
): string[] {
  return [
    buildRDataFrame(`${prefix}_nodes`, {
      id: network.nodes.map(node => node.id),
      label: network.nodes.map(node => node.label),
      kind: network.nodes.map(node => node.kind),
      value: network.nodes.map(node => node.value),
    }),
    '',
    buildRDataFrame(`${prefix}_edges`, {
      source: network.edges.map(edge => edge.source),
      target: network.edges.map(edge => edge.target),
      weight: network.edges.map(edge => edge.weight),
    }),
  ];
}

function formatRValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'NA';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NA';
  }
  return JSON.stringify(String(value).replace(/\r?\n/g, ' '));
}

function formatBibliometricFigureTitle(figure: BibliometricFigureSpec): string {
  const number = figure.name.replace(/^figure/, '');
  return `Figure ${number}. ${figure.title}`;
}

function buildBibliometricFigureAppendix(): string[] {
  return [
    '## 图件与注释',
    '',
    '以下图件由 R 脚本统一输出到 `plots/` 文件夹，文件名按 `figure1` 至 `figure14` 排列。正文引用时直接写 `figure1`、`figure2` 等图件名称。',
    '',
    ...BIBLIOMETRIC_FIGURE_SPECS.flatMap(figure => [
      `### ${figure.name}`,
      '',
      `![${figure.name}](plots/${figure.name}.png)`,
      '',
      `**图题**：${formatBibliometricFigureTitle(figure)}`,
      '',
      `**注释**：${figure.note}`,
      '',
    ]),
  ];
}

function ensureBibliometricFigureAppendixInMarkdown(markdown: string): string {
  const trimmed = markdown.trim();
  if (/^##\s*图件与注释/m.test(trimmed)) return trimmed;
  return [trimmed, '', ...buildBibliometricFigureAppendix()].join('\n');
}

function formatRankInline(rows: Array<{ label: string; count: number }>, limit: number): string {
  const selected = rows.filter(item => item.label && item.label !== '未解析').slice(0, limit);
  if (!selected.length) return '暂无可用数据';
  return selected.map(item => `${item.label}（${item.count}）`).join('、');
}

function formatTopicInline(clusters: BibliometricAnalysis['topicClusters']): string {
  const selected = clusters.slice(0, 5).filter(item => item.label);
  if (!selected.length) return '暂未形成稳定主题簇';
  return selected.map(item => `${item.label}（文献 ${item.literatureCount} 篇）`).join('；');
}

function formatListInline(items: string[] | undefined, fallback: string): string {
  const selected = (items || []).filter(Boolean).slice(0, 4);
  return selected.length ? selected.join('；') : fallback;
}

function formatBurstSentence(analysis: BibliometricAnalysis): string {
  if (!analysis.keywordBursts.length) return '当前数据尚不足以形成稳定突现关键词';
  return `突现关键词主要包括 ${analysis.keywordBursts.slice(0, 5).map(item => `${item.keyword}（score=${item.score}）`).join('、')}`;
}

function formatTrendSentence(analysis: BibliometricAnalysis): string {
  if (!analysis.keywordYearTrends.length) return '，主流关键词年际趋势暂不可用';
  return `，主流关键词年际趋势覆盖 ${analysis.keywordYearTrends.slice(0, 5).map(item => `${item.keyword}（峰值年 ${item.peakYear || '未解析'}）`).join('、')}`;
}

function formatTrendParagraph(analysis: BibliometricAnalysis): string {
  if (!analysis.keywordYearTrends.length && !analysis.keywordBursts.length) {
    return '由于年份或关键词字段不足，当前暂不能稳定呈现主流关键词年际变化和突现主题。';
  }
  const trend = analysis.keywordYearTrends.length
    ? `主流关键词年际变化见 figure5，结果显示 ${analysis.keywordYearTrends.slice(0, 6).map(item => `${item.keyword} 的峰值年份为 ${item.peakYear || '未解析'}`).join('；')}。`
    : '';
  const burst = analysis.keywordBursts.length
    ? `关键词突现变化见 figure6，${analysis.keywordBursts.slice(0, 6).map(item => `${item.keyword}（突现分数 ${item.score}）`).join('、')}具有较明显的近期增长特征。`
    : '';
  return [trend, burst].filter(Boolean).join(' ');
}

function formatStructureParagraph(analysis: BibliometricAnalysis): string {
  const parts = [
    `语义相似性网络包含 ${analysis.literatureSimilarityNetwork.nodes.length} 个节点和 ${analysis.literatureSimilarityNetwork.edges.length} 条边（可选）`,
    `共被引网络包含 ${analysis.coCitationNetwork.nodes.length} 个节点和 ${analysis.coCitationNetwork.edges.length} 条边`,
    `文献耦合网络包含 ${analysis.bibliographicCouplingNetwork.nodes.length} 个节点和 ${analysis.bibliographicCouplingNetwork.edges.length} 条边`,
  ];
  return `${parts.join('；')}。共被引网络见 figure13，文献耦合网络见 figure14。独立 WoS 计量学分析主要依靠共被引和文献耦合识别共同知识基础与共享参考文献较多的研究路径；语义相似性网络仅在额外提供 embedding 时启用。`;
}

function formatCollaborationParagraph(analysis: BibliometricAnalysis): string {
  return `合作格局方面，作者合作网络见 figure10，包含 ${analysis.authorNetwork.nodes.length} 个节点和 ${analysis.authorNetwork.edges.length} 条边；机构合作网络见 figure11，包含 ${analysis.institutionNetwork.nodes.length} 个节点和 ${analysis.institutionNetwork.edges.length} 条边；国家/地区合作网络见 figure12，包含 ${analysis.countryNetwork.nodes.length} 个节点和 ${analysis.countryNetwork.edges.length} 条边。若机构或国家字段覆盖不足，应将该部分解释为探索性结果。`;
}

async function buildWosDatasetWorkbook(dataset: WosPlainTextDataset): Promise<Buffer> {
  const xlsx = await import('xlsx');
  const workbook = xlsx.utils.book_new();

  appendSheet(xlsx, workbook, 'Quality', [
    ['指标', '值'],
    ['数据集 ID', dataset.id],
    ['源文件', dataset.sourceFileName],
    ['导入时间', dataset.importedAt],
    ['文章数', dataset.quality.recordCount],
    ['参考文献数', dataset.quality.citedReferenceCount],
    ['去重参考文献数', dataset.quality.uniqueReferenceCount],
    ['带 DOI 的参考文献', dataset.quality.referencesWithDoi],
    ['带年份的参考文献', dataset.quality.referencesWithYear],
    ['带 DOI 的文章', dataset.quality.doiCount],
    ['带摘要的文章', dataset.quality.abstractCount],
    ['作者数', dataset.quality.authorCount],
    ['机构地址行数', dataset.quality.affiliationCount],
    ['关键词数', dataset.quality.keywordCount],
    ['重复 DOI 数', dataset.quality.duplicateDoiCount],
    ['重复 UT 数', dataset.quality.duplicateUtCount],
    ['NR/CR 不一致记录数', dataset.quality.nrMismatchCount],
    ['AU/AF 不一致记录数', dataset.quality.authorNameMismatchCount],
    ['问题', dataset.quality.issues.join('；')],
    ['建议', dataset.quality.recommendations.join('；')],
  ]);

  appendSheet(xlsx, workbook, 'Articles', [
    ['articleId', 'UT', 'DOI', 'Title', 'Year', 'Source', 'JournalAbbrev', 'DocumentType', 'Language', 'Volume', 'Issue', 'BP', 'EP', 'ArticleNumber', 'PageCount', 'TimesCited', 'Usage180', 'UsageSince2013', 'Publisher', 'PublisherCity', 'OpenAccess', 'WOSCategories', 'ResearchAreas', 'Emails', 'Abstract'],
    ...dataset.records.map(record => [
      record.id,
      record.article.uid,
      record.article.doi,
      record.article.title,
      record.article.publicationYear,
      record.article.sourceTitle,
      record.article.journalAbbreviation,
      record.article.documentType,
      record.article.language,
      record.article.volume,
      record.article.issue,
      record.article.beginPage,
      record.article.endPage,
      record.article.articleNumber,
      record.article.pageCount,
      record.article.timesCited,
      record.article.usage180,
      record.article.usageSince2013,
      record.article.publisher,
      record.article.publisherCity,
      record.article.openAccess.join('; '),
      record.article.wosCategories.join('; '),
      record.article.researchAreas.join('; '),
      record.article.emails.join('; '),
      record.article.abstract,
    ]),
  ]);

  appendSheet(xlsx, workbook, 'Authors', [
    ['articleId', 'position', 'shortName', 'fullName', 'researcherId', 'orcid', 'isCorresponding'],
    ...dataset.authors.map(row => [row.articleId, row.position, row.shortName, row.fullName, row.researcherId, row.orcid, row.isCorresponding]),
  ]);

  appendSheet(xlsx, workbook, 'Affiliations', [
    ['articleId', 'authors', 'institution', 'department', 'city', 'country', 'raw'],
    ...dataset.affiliations.map(row => [row.articleId, row.authors.join('; '), row.institution, row.department, row.city, row.country, row.raw]),
  ]);

  appendSheet(xlsx, workbook, 'Keywords', [
    ['articleId', 'keyword', 'type'],
    ...dataset.keywords.map(row => [row.articleId, row.keyword, row.type]),
  ]);

  appendSheet(xlsx, workbook, 'CitedReferences', [
    ['articleId', 'position', 'normalizedKey', 'citedAuthor', 'citedYear', 'citedSource', 'citedVolume', 'citedPage', 'citedDoi', 'raw'],
    ...dataset.citedReferences.map(row => [row.articleId, row.position, row.normalizedKey, row.citedAuthor, row.citedYear, row.citedSource, row.citedVolume, row.citedPage, row.citedDoi, row.raw]),
  ]);

  appendSheet(xlsx, workbook, 'FieldCounts', [
    ['WoSTag', 'recordCount'],
    ...Object.entries(dataset.quality.fieldCounts).sort((a, b) => a[0].localeCompare(b[0])).map(([tag, count]) => [tag, count]),
  ]);

  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function buildBibliometricsWorkbook(analysis: BibliometricAnalysis): Promise<Buffer> {
  const xlsx = await import('xlsx');
  const workbook = xlsx.utils.book_new();

  appendSheet(xlsx, workbook, 'Summary', [
    ['指标', '值'],
    ['文献总数', analysis.summary.total],
    ['年份范围', analysis.summary.yearMin && analysis.summary.yearMax ? `${analysis.summary.yearMin}-${analysis.summary.yearMax}` : '未解析'],
    ['期刊数', analysis.summary.journalCount],
    ['作者数', analysis.summary.authorCount],
    ['关键词数', analysis.summary.keywordCount],
    ['带 DOI', analysis.summary.doiCount],
    ['带摘要', analysis.summary.abstractCount],
    ['带 embedding（可选）', analysis.summary.embeddingCount],
    ['带被引次数', analysis.summary.citedCount],
    ['带参考文献列表', analysis.summary.referenceCount],
    ['机构数', analysis.summary.institutionCount],
    ['国家数', analysis.summary.countryCount],
    ['合并关键词标签数', analysis.summary.mergedKeywordTagCount],
    ['置顶关键词标签数', analysis.summary.promotedKeywordTagCount],
    ['生成时间', analysis.generatedAt],
  ]);
  appendSheet(xlsx, workbook, 'KeywordTagSource', [
    ['指标', '值'],
    ['模式', analysis.keywordTagSource.mode],
    ['合并标签数', analysis.keywordTagSource.mergedTagCount],
    ['置顶标签数', analysis.keywordTagSource.promotedTagCount],
    ['命中合并标签的文献数', analysis.keywordTagSource.mergedTaggedLiteratureCount],
    ['说明', analysis.keywordTagSource.note],
  ]);
  appendSheet(xlsx, workbook, 'Readiness', [
    ['模块', '状态', '说明'],
    ...analysis.readiness.map(item => [item.label, item.status, item.message]),
  ]);
  appendSheet(xlsx, workbook, 'YearTrend', [
    ['年份', '发文量', '累计发文量'],
    ...analysis.yearTrend.map(item => [item.year, item.count, item.cumulative]),
  ]);
  appendRankSheet(xlsx, workbook, 'TopJournals', analysis.topJournals);
  appendRankSheet(xlsx, workbook, 'TopAuthors', analysis.topAuthors);
  appendRankSheet(xlsx, workbook, 'TopKeywords', analysis.topKeywords);
  appendRankSheet(xlsx, workbook, 'DocumentTypes', analysis.documentTypes);
  appendRankSheet(xlsx, workbook, 'Sources', analysis.sources);
  appendSheet(xlsx, workbook, 'DataQuality', [
    ['指标', '数量', '比例%'],
    ...analysis.dataQuality.map(item => [item.label, item.count, item.percentage]),
  ]);
  appendSheet(xlsx, workbook, 'TopicClusters', [
    ['主题簇', '文献数', '关键词数', '关键词', '代表文献'],
    ...analysis.topicClusters.map(item => [
      item.label,
      item.literatureCount,
      item.size,
      item.keywords.join('; '),
      item.sampleTitles.join('; '),
    ]),
  ]);
  appendSheet(xlsx, workbook, 'KeywordBursts', [
    ['关键词', '突现分数', '基线期频次', '近期频次', '峰值年份', '活跃年份'],
    ...analysis.keywordBursts.map(item => [
      item.keyword,
      item.score,
      item.baselineCount,
      item.recentCount,
      item.peakYear ?? '',
      item.activeYears.join('; '),
    ]),
  ]);
  appendSheet(xlsx, workbook, 'KeywordYearTrends', [
    ['关键词', '总频次', '峰值年份', '年份', '当年频次', '当年占比%'],
    ...analysis.keywordYearTrends.flatMap(series =>
      series.points.map(point => [
        series.keyword,
        series.total,
        series.peakYear ?? '',
        point.year,
        point.count,
        point.percentage,
      ])
    ),
  ]);
  appendSheet(xlsx, workbook, 'TopicEvolution', [
    ['时期', '起始年', '结束年', '文献数', 'Top 关键词', '主要期刊', '代表文献'],
    ...analysis.topicEvolution.map(item => [
      item.period,
      item.startYear ?? '',
      item.endYear ?? '',
      item.literatureCount,
      item.topKeywords.map(keyword => `${keyword.label}(${keyword.count})`).join('; '),
      item.leadingJournals.map(journal => `${journal.label}(${journal.count})`).join('; '),
      item.representativeTitles.join('; '),
    ]),
  ]);
  appendSheet(xlsx, workbook, 'HighImpactLiterature', [
    ['标题', '作者', '年份', '期刊', 'DOI', '被引次数', '影响分数', '是否有被引字段'],
    ...analysis.highImpactLiteratures.map(item => [
      item.title,
      item.authors,
      item.year ?? '',
      item.journal,
      item.doi,
      item.citationCount ?? '',
      item.influenceScore,
      item.hasCitationData ? 'yes' : 'no',
    ]),
  ]);
  appendSheet(xlsx, workbook, 'JournalQuality', [
    ['类型', '名称', '数量', '比例/均值'],
    ...analysis.journalQuality.coverage.map(item => ['coverage', item.label, item.count, item.percentage]),
    ...analysis.journalQuality.quartiles.map(item => ['JCR quartile', item.label, item.count, item.percentage]),
    ...analysis.journalQuality.casZones.map(item => ['CAS zone', item.label, item.count, item.percentage]),
    ...analysis.journalQuality.sourceLevels.map(item => ['source level', item.label, item.count, item.percentage]),
    ...analysis.journalQuality.topImpactFactorJournals.map(item => ['impact factor', item.journal, item.count, item.impactFactor]),
    ['note', analysis.journalQuality.note, '', ''],
  ]);
  appendSheet(xlsx, workbook, 'RetrievalQuality', [
    ['项目', '值', '说明'],
    ['score', analysis.retrievalQuality.score, '0-100'],
    ...analysis.retrievalQuality.metrics.map(item => [item.label, item.count, `${item.percentage}%`]),
    ...analysis.retrievalQuality.issues.map(item => ['issue', item, '']),
    ...analysis.retrievalQuality.recommendations.map(item => ['recommendation', item, '']),
  ]);
  appendSheet(xlsx, workbook, 'WritingPreparation', [
    ['部分', '内容'],
    ['建议题目', analysis.writingPreparation.suggestedTitle],
    ...analysis.writingPreparation.methodsOutline.map((item, index) => [`方法 ${index + 1}`, item]),
    ...analysis.writingPreparation.resultsOutline.map((item, index) => [`结果 ${index + 1}`, item]),
    ...analysis.writingPreparation.discussionAngles.map((item, index) => [`讨论 ${index + 1}`, item]),
    ...analysis.writingPreparation.requiredSupplementaryData.map((item, index) => [`补充数据 ${index + 1}`, item]),
    ...analysis.writingPreparation.exportableArtifacts.map((item, index) => [`可导出材料 ${index + 1}`, item]),
    ...analysis.writingPreparation.limitations.map((item, index) => [`局限 ${index + 1}`, item]),
  ]);
  appendNetworkSheets(xlsx, workbook, 'Keyword', analysis.keywordNetwork);
  appendNetworkSheets(xlsx, workbook, 'Author', analysis.authorNetwork);
  appendNetworkSheets(xlsx, workbook, 'Similarity', analysis.literatureSimilarityNetwork);
  appendNetworkSheets(xlsx, workbook, 'CoCitation', analysis.coCitationNetwork);
  appendNetworkSheets(xlsx, workbook, 'Coupling', analysis.bibliographicCouplingNetwork);
  appendNetworkSheets(xlsx, workbook, 'Institution', analysis.institutionNetwork);
  appendNetworkSheets(xlsx, workbook, 'Country', analysis.countryNetwork);

  return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function appendNetworkSheets(
  xlsx: typeof import('xlsx'),
  workbook: import('xlsx').WorkBook,
  prefix: string,
  network: BibliometricAnalysis['keywordNetwork']
): void {
  appendSheet(xlsx, workbook, `${prefix}Nodes`, [
    ['id', 'label', 'kind', 'value', 'meta'],
    ...network.nodes.map(node => [node.id, node.label, node.kind, node.value, node.meta ? JSON.stringify(node.meta) : '']),
  ]);
  appendSheet(xlsx, workbook, `${prefix}Edges`, [
    ['source', 'target', 'weight', 'meta'],
    ...network.edges.map(edge => [edge.source, edge.target, edge.weight, edge.meta ? JSON.stringify(edge.meta) : '']),
  ]);
}

function appendRankSheet(xlsx: typeof import('xlsx'), workbook: import('xlsx').WorkBook, name: string, rows: Array<{ label: string; count: number; percentage: number }>): void {
  appendSheet(xlsx, workbook, name, [
    ['名称', '数量', '比例%'],
    ...rows.map(item => [item.label, item.count, item.percentage]),
  ]);
}

function appendSheet(xlsx: typeof import('xlsx'), workbook: import('xlsx').WorkBook, name: string, rows: unknown[][]): void {
  const sheet = xlsx.utils.aoa_to_sheet(rows);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  sheet['!cols'] = Array.from({ length: width }, (_, index) => ({
    wch: Math.min(50, Math.max(12, ...rows.slice(0, 200).map(row => String(row[index] ?? '').length + 2))),
  }));
  xlsx.utils.book_append_sheet(workbook, sheet, name);
}
