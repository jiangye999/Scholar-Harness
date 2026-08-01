import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { PDFParse } from 'pdf-parse';
import { HybridRetrievalEngine } from '../literature/retrieval';
import type { UnifiedLiterature } from '../types/literature';
import { authorsToString, parseAuthorsToString } from './literature-helpers';
import { logger } from './logger';
import { extractPdfTextWithFastText, isPdfFastTextAvailable } from './pdf-fast-text';
import { extractPdfTextWithLiteParse, isLiteParseAvailable } from './pdf-liteparse';
import { extractPdfTextWithMarker, isPdfMarkerAvailable } from './pdf-marker';
import {
  addPdfWikiPdfGroupsToPdfs,
  loadPdfWikiPdfManagement,
  matchesPdfWikiPdfGroupQuery,
} from './pdf-wiki-pdf-management';
import { isNonScientificPdfFigureRecord } from './pdf-wiki-figure-filter';
import { sanitizeUserId } from './paths';
import { buildToolRuntimeEnv } from './tool-runtime-env';

export type PdfWikiStatusName = 'idle' | 'processing' | 'completed' | 'error';

export interface PdfWikiBuildStatus {
  status: PdfWikiStatusName;
  taskKind?: 'pdf-wiki' | 'meta-analysis';
  totalPdfs: number;
  processedPdfs: number;
  failedPdfs?: number;
  totalChunks: number;
  processedChunks: number;
  entryCount: number;
  sentencePointCount?: number;
  metaRowCount?: number;
  tableCount?: number;
  figureCount?: number;
  message: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
  stalled?: boolean;
  warning?: string;
  workerConcurrency?: number;
  codexWorkers?: PdfWikiCodexWorkerStatus[];
  workProgress?: PdfWikiWorkProgress;
  queue?: PdfWikiQueueSnapshot;
}

export type PdfWikiQueueJobStatus = 'queued' | 'running' | 'completed' | 'error';

export interface PdfWikiQueueJob {
  id: string;
  status: PdfWikiQueueJobStatus;
  files: Array<{ originalname: string; path: string; size: number; sha256?: string }>;
  taskConfig: Partial<PdfWikiLlmConfig>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface PdfWikiQueueSnapshot {
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  queuedPdfs: number;
  runningPdfs: number;
  jobs: PdfWikiQueueJob[];
  addedPdfs?: number;
  addedJobIds?: string[];
  skippedDuplicatePdfs?: number;
}

interface PdfWikiQueueStore {
  version: 1;
  userId: string;
  updatedAt: string;
  jobs: PdfWikiQueueJob[];
}

export type PdfWikiRecognitionQueueItemStatus = 'queued' | 'running' | 'completed' | 'error';
export type PdfWikiRecognitionQueueMode = 'full' | 'images-only';

export interface PdfWikiRecognitionQueueItem {
  pdfId: string;
  pdfName: string;
  mode: PdfWikiRecognitionQueueMode;
  status: PdfWikiRecognitionQueueItemStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  figureCount?: number;
  error?: string;
}

export interface PdfWikiRecognitionQueueJob {
  id: string;
  status: PdfWikiQueueJobStatus;
  items: PdfWikiRecognitionQueueItem[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

export interface PdfWikiRecognitionQueueSnapshot {
  queuedJobs: number;
  runningJobs: number;
  completedJobs: number;
  failedJobs: number;
  queuedItems: number;
  runningItems: number;
  completedItems: number;
  failedItems: number;
  activeJobId?: string;
  jobs: PdfWikiRecognitionQueueJob[];
  addedItems?: number;
  addedJobIds?: string[];
  skippedActiveItems?: number;
  skippedMissingItems?: number;
}

interface PdfWikiRecognitionQueueStore {
  version: 1;
  userId: string;
  updatedAt: string;
  jobs: PdfWikiRecognitionQueueJob[];
}

export interface PdfWikiWorkProgress {
  phase: 'preparing' | 'extracting' | 'codex' | 'finalizing' | 'completed';
  phaseLabel: string;
  phaseIndex: number;
  phaseCount: number;
  completedUnits: number;
  totalUnits: number;
  currentPdfIndex?: number;
  currentPdfName?: string;
  attempt?: number;
  maxAttempts?: number;
  attemptElapsedMs?: number;
}

export interface PdfWikiCodexWorkerStatus {
  slot: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  pdfId?: string;
  pdfName?: string;
  index?: number;
  message: string;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
}

export interface PdfWikiSourcePdf {
  id: string;
  originalName: string;
  fileName: string;
  filePath: string;
  size: number;
  title?: string;
  authors?: string;
  year?: string;
  journal?: string;
  doi?: string;
  referenceIndex?: PdfWikiReference[];
  textLength?: number;
  parsedMarkdownPath?: string;
  parsedTextPath?: string;
  parsedTextCachedAt?: string;
  processedAt?: string;
  extractionParser?: 'codex' | 'liteparse' | 'marker' | 'fast-text' | 'textin' | 'grobid' | 'pdf-parse' | 'qwen-long';
  metaData?: Record<string, unknown>;
  metaDataCachedAt?: string;
  figureExtractionStatus?: 'completed' | 'error';
  figureExtractionAttemptedAt?: string;
  figureExtractionError?: string;
  metaExcluded?: boolean;
}

export interface PdfWikiPdfManagerStoreSnapshot {
  generatedAt: string;
  pdfs: PdfWikiSourcePdf[];
}

export interface PdfWikiViewerStoreSnapshot {
  generatedAt: string;
  pdfs: PdfWikiSourcePdf[];
  entries: PdfWikiEntry[];
  sentenceCloud: PdfWikiSentenceCloudStore;
}

export interface PdfWikiReference {
  id: string;
  raw: string;
  sourcePdfId?: string;
  sourcePdfName?: string;
  fallbackSourcePdf?: boolean;
  index?: number;
  title?: string;
  authors?: string;
  year?: string;
  journal?: string;
  doi?: string;
}

export interface PdfWikiSentencePointReference extends PdfWikiReference {
  matchType?: 'citation' | 'semantic' | 'ai';
  matchScore?: number;
  aiReason?: string;
}

export type PdfWikiSentenceSection = 'Introduction' | 'Discussion' | 'Conclusion';

export interface PdfWikiSentencePoint {
  id: string;
  sourcePdfId: string;
  sourcePdfName: string;
  sourcePdfTitle?: string;
  section: PdfWikiSentenceSection;
  sentenceIndex: number;
  sentence: string;
  citations: string[];
  references: PdfWikiSentencePointReference[];
  referenceCount: number;
  claimCandidate: boolean;
  claimText: string;
  claimType: 'argument' | 'background' | 'mechanism' | 'result' | 'limitation' | 'method' | 'non_claim';
  claimReason?: string;
  topicKey: string;
  topicLabel: string;
  keywords: string[];
  x: number;
  y: number;
  radius: number;
  matchMethod: 'citation' | 'semantic' | 'ai' | 'citation+semantic' | 'citation+ai' | 'semantic+ai' | 'citation+semantic+ai' | 'none';
  confidence: number;
  aiTopicAnnotation?: PdfWikiSentenceTopicAnnotation;
}

export interface PdfWikiSentenceTopicAnnotation {
  version: 1;
  sourceHash: string;
  taxonomyHash: string;
  subjectTags: string[];
  trendConclusionTopic: string;
  annotatedAt: string;
  provider: 'api' | 'codex';
  model?: string;
}

export interface PdfWikiSentenceTopicAnnotationStatus {
  status: 'idle' | 'processing' | 'completed' | 'error';
  totalSentences: number;
  annotatedSentences: number;
  pendingSentences: number;
  targetSentences: number;
  processedSentences: number;
  failedSentences: number;
  skippedSentences: number;
  progress: number;
  message: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
  error?: string;
}

interface PdfWikiSentenceTopicAnnotationStore {
  version: 1;
  updatedAt: string;
  records: Record<string, PdfWikiSentenceTopicAnnotation>;
}

export interface PdfWikiSentenceCloud {
  id: string;
  topicKey: string;
  label: string;
  pointIds: string[];
  sentenceCount: number;
  referenceCount: number;
  pdfIds: string[];
  keywords: string[];
  color: string;
}

export interface PdfWikiSentenceCloudStore {
  generatedAt: string;
  points: PdfWikiSentencePoint[];
  clouds: PdfWikiSentenceCloud[];
}

export interface PdfWikiTopicDefinition {
  id: string;
  label: string;
  description: string;
  aliases: string[];
  keywords: string[];
  excludeKeywords: string[];
  expandedBy: 'ai' | 'manual';
  createdAt: string;
  updatedAt: string;
}

export interface PdfWikiTopicCatalog {
  version: 1;
  updatedAt: string;
  topics: PdfWikiTopicDefinition[];
}

export interface PdfWikiTopicInput {
  label: string;
  description?: string;
}

export interface PdfWikiManualTopicInput extends PdfWikiTopicInput {
  id?: string;
  aliases?: string[];
  keywords?: string[];
  excludeKeywords?: string[];
}

export interface PdfWikiReaderChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface PdfWikiReaderChatSession {
  pdfId: string;
  updatedAt: string;
  messages: PdfWikiReaderChatMessage[];
}

export interface PdfWikiViewpoint {
  stance: 'support' | 'oppose' | 'neutral';
  summary: string;
  evidence: string;
  section?: string;
  location?: string;
  inTextCitations: string[];
  evidenceSentenceIds?: string[];
  evidenceSentences?: string[];
  references: PdfWikiReference[];
  sourcePdfId: string;
  sourcePdfName: string;
}

export interface PdfWikiEntry {
  id: string;
  groupId: string;
  claim: string;
  normalizedClaim: string;
  displayClaimZh?: string;
  sourceEntryIds?: string[];
  similarClaims?: PdfWikiSimilarClaim[];
  sourcePdfIds: string[];
  sourcePdfNames: string[];
  sections: string[];
  pro: PdfWikiViewpoint[];
  con: PdfWikiViewpoint[];
  neutral: PdfWikiViewpoint[];
  inTextCitations: string[];
  evidenceSentenceIds?: string[];
  references: PdfWikiReference[];
  evidenceSnippets: string[];
  sourceEntries?: PdfWikiSourceEntryTrace[];
  origin?: 'pdf-wiki' | 'manual' | 'deep-analysis';
  researchUseCategory?: PdfWikiResearchUseCategory;
  researchUse?: string;
  supportScope?: string[];
  limitations?: string[];
  researchContextKeys?: string[];
  confidence?: number;
  sourcePdfMetadata?: PdfWikiDeepAnalysisSourceMetadata;
  updatedAt: string;
}

export interface PdfWikiSimilarClaim {
  entryId: string;
  claim: string;
  displayClaimZh?: string;
  similarity?: number;
  reason?: string;
}

export interface PdfWikiSourceEntryTrace {
  id: string;
  claim: string;
  normalizedClaim: string;
  displayClaimZh?: string;
  sourcePdfIds: string[];
  sourcePdfNames: string[];
  sections: string[];
  proCount: number;
  conCount: number;
  neutralCount: number;
  evidenceSnippets: string[];
}

export interface PdfWikiStore {
  version: 1;
  userId: string;
  generatedAt: string;
  pdfs: PdfWikiSourcePdf[];
  referenceIndex: PdfWikiReference[];
  entries: PdfWikiEntry[];
  sentenceCloud?: PdfWikiSentenceCloudStore;
  readerChatSessions?: Record<string, PdfWikiReaderChatSession>;
}

export interface PdfWikiLlmConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  jsonApiUrl?: string;
  jsonApiKey?: string;
  jsonModel?: string;
  ocrModel?: string;
  visionModel?: string;
  textInApiUrl?: string;
  textInAppId?: string;
  textInSecretCode?: string;
  textInParseMode?: string;
  dedicated?: boolean;
  processingProfile?: 'fast' | 'deep' | 'custom' | 'meta';
  textExtractionEngine?: 'auto' | 'codex' | 'liteparse' | 'marker' | 'fast-text' | 'qwen-long' | 'pdf-parse';
  metadataEngine?: 'auto' | 'api' | 'local';
  claimExtractionEngine?: 'auto' | 'codex' | 'qwen-long' | 'api' | 'off';
  sentenceReferenceMatchingEngine?: 'auto' | 'codex' | 'api' | 'local';
  groupingEngine?: 'auto' | 'codex' | 'api' | 'local';
  deepAnalysisEngine?: 'auto' | 'codex' | 'api';
  metaAnalysisEnabled?: boolean;
  metaAnalysisEngine?: 'auto' | 'codex' | 'api' | 'off';
  metaAnalysisUserRequirements?: string;
}

export interface PdfWikiVectorConfig {
  apiUrl?: string;
  apiKey?: string;
  model: string;
  dimensions: number;
}

export interface UploadedPdfFile {
  originalname: string;
  path?: string;
  buffer?: Buffer;
  size?: number;
  sha256?: string;
}

interface ExtractedClaim {
  claim?: string;
  section?: string;
  location?: string;
  discussionPoint?: string;
  proViews?: unknown[];
  conViews?: unknown[];
  neutralViews?: unknown[];
  evidence?: string;
  inTextCitations?: string[];
  evidenceSentenceIds?: string[];
  referenceIndexes?: number[];
  references?: Array<Partial<PdfWikiReference>>;
}

interface PdfWikiReferenceIndexResult {
  metadata: Partial<PdfWikiSourcePdf>;
  references: PdfWikiReference[];
}

export interface PdfWikiReidentifyResult {
  pdf: PdfWikiSourcePdf;
  parser: PdfWikiParsedContent['parser'];
  textLength: number;
  referenceCount: number;
  figureCount: number;
  figureError?: string;
  message: string;
  autoGroupMatch?: PdfWikiAutoGroupMatchResult;
}

export interface PdfWikiAutoGroupMatchResult {
  matchedPdfCount: number;
  addedTagCount: number;
  matchedGroupNamesByPdf: Record<string, string[]>;
}

export interface PdfWikiLiteRegisterResult {
  pdfs: PdfWikiSourcePdf[];
  uploadedCount: number;
  parsedCount: number;
  failedCount: number;
  referenceCount: number;
  figureCount: number;
  figureErrors: Array<{
    pdfId: string;
    pdfName: string;
    error: string;
  }>;
  errors: Array<{
    pdfId: string;
    pdfName: string;
    error: string;
  }>;
  message: string;
  autoGroupMatch?: PdfWikiAutoGroupMatchResult;
}

interface PdfWikiParsedContent {
  text: string;
  metadata: Partial<PdfWikiSourcePdf>;
  references: PdfWikiReference[];
  parser: 'codex' | 'liteparse' | 'marker' | 'fast-text' | 'textin' | 'grobid' | 'pdf-parse';
  metaData?: Record<string, unknown>;
}

interface PdfWikiManagerRecognitionBatchResult {
  recognizedPdfs: PdfWikiSourcePdf[];
  failedPdfs: Array<{ pdfId: string; pdfName: string; error: string }>;
  figureCount: number;
}

interface PdfWikiCodexConfig {
  enabled: boolean;
  prefer: boolean;
  command: string;
  model: string;
  reasoningEffort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  concurrency: number;
}

interface PdfWikiCodexBuildResult {
  parsedContent: PdfWikiParsedContent;
  referenceIndex: PdfWikiReferenceIndexResult;
  entries: PdfWikiEntry[];
  taskDir: string;
}

type PdfWikiCodexProgressHandler = (message: string) => Promise<void> | void;

interface PdfWikiCodexJsonProgress {
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  message: string;
}

type PdfWikiCodexJsonProgressHandler = (progress: PdfWikiCodexJsonProgress) => Promise<void> | void;

interface PdfWikiCodexMetaAnalysisResult {
  parsedContent: PdfWikiParsedContent;
  referenceIndex: PdfWikiReferenceIndexResult;
  metaData: Record<string, unknown>;
  taskDir: string;
  tableCount: number;
  figureCount: number;
}

export interface PdfWikiUserResearchContextForDeepAnalysis {
  hasContext: boolean;
  experimentSummary: string;
  dataSummary: string;
  sourceKeys: string[];
  memoryUpdatedAt?: string;
}

export type PdfWikiResearchUseCategory =
  | 'background'
  | 'method'
  | 'indicator'
  | 'result-comparison'
  | 'mechanism'
  | 'meta-analysis'
  | 'limitation';

export interface PdfWikiDeepAnalysisSourceMetadata {
  pdfId: string;
  originalName: string;
  title?: string;
  authors?: string;
  year?: string;
  journal?: string;
  doi?: string;
}

export interface PdfWikiDeepAnalysisEvidenceItem {
  id: string;
  claim: string;
  evidence: string;
  category: PdfWikiResearchUseCategory;
  researchUse: string;
  supportScope: string[];
  limitations: string[];
  keywords: string[];
  section: string;
  location: string;
  confidence: number;
  evidenceSentenceIds: string[];
  inTextCitations: string[];
  referenceIndexes: number[];
  references: PdfWikiReference[];
  sourcePdf: PdfWikiDeepAnalysisSourceMetadata;
  researchContextKeys: string[];
}

export interface PdfWikiDeepAnalysisWikiSync {
  status: 'completed' | 'partial' | 'unconfigured' | 'error';
  itemCount: number;
  entryIds: string[];
  embeddedCount: number;
  embeddingStatus: 'ready' | 'partial' | 'unconfigured' | 'error';
  syncedAt: string;
  warning?: string;
}

export interface PdfWikiDeepAnalysisCache {
  pdfId: string;
  parser: PdfWikiParsedContent['parser'];
  textLength: number;
  textPreview: string;
  metadata: Partial<PdfWikiSourcePdf>;
  referenceCount: number;
  summaryMarkdown: string;
  researchRelevanceMarkdown?: string;
  userResearchContext?: Pick<PdfWikiUserResearchContextForDeepAnalysis, 'hasContext' | 'sourceKeys' | 'memoryUpdatedAt'> & {
    experimentSummaryChars: number;
    dataSummaryChars: number;
  };
  analysisEngine?: 'codex' | 'api' | 'secondary-api' | 'local';
  overviewDiagram?: PdfWikiOverviewDiagram;
  usableItems?: PdfWikiDeepAnalysisEvidenceItem[];
  wikiSync?: PdfWikiDeepAnalysisWikiSync;
  analyzedAt: string;
}

export interface PdfWikiDeepAnalysisResult extends PdfWikiDeepAnalysisCache {
  pdf: PdfWikiSourcePdf;
  fromCache?: boolean;
}

interface PdfWikiDeepAnalysisEvidenceDraft {
  claim?: unknown;
  evidence?: unknown;
  category?: unknown;
  researchUse?: unknown;
  supportScope?: unknown;
  limitations?: unknown;
  keywords?: unknown;
  section?: unknown;
  location?: unknown;
  confidence?: unknown;
  evidenceSentenceIds?: unknown;
}

export interface PdfWikiManualSentenceClaimInput {
  sentence: string;
  pageNumber?: number;
  section?: PdfWikiSentenceSection;
  claimText?: string;
}

export interface PdfWikiManualSentenceClaimResult {
  point: PdfWikiSentencePoint;
  entry: PdfWikiEntry;
  sentencePointCount: number;
  entryCount: number;
  referenceCount: number;
  sourcePdf: PdfWikiSourcePdf;
}

export interface PdfWikiOverviewDiagram {
  kind: 'svg';
  engine: 'codex' | 'secondary-api' | 'code';
  title: string;
  svg: string;
  generatedAt: string;
  layoutVersion?: number;
  sourceFiles?: string[];
}

export interface PdfWikiMetaDatabaseItem {
  pdfId: string;
  originalName: string;
  fileName: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  parser: string;
  textLength: number;
  referenceCount: number;
  processedAt: string;
  parsedTextCachedAt: string;
  metaDataCachedAt: string;
  studyLocations: string[];
  cropTypes: string[];
  treatmentCategories: string[];
  sourceTableCount: number;
  sourceFigureCount: number;
  needsReview: boolean;
  extractionNotes: string;
  tables: PdfWikiMetaTableItem[];
  dataTable: PdfWikiIntegratedDataTable;
  metaData: Record<string, unknown>;
  searchText?: string;
  detailLoaded?: boolean;
}

export interface PdfWikiMetaDatabase {
  userId: string;
  generatedAt: string;
  pdfCount: number;
  referenceCount: number;
  items: PdfWikiMetaDatabaseItem[];
}

export interface PdfWikiMetaDatabaseOptions {
  includeDetails?: boolean;
  pdfIds?: string[];
  forceRefreshSummary?: boolean;
}

interface PdfWikiMetaDatabaseIndexFile {
  version: 1;
  sourceSignature: string;
  database: PdfWikiMetaDatabase;
}

export interface PdfWikiMetaTableItem {
  id: string;
  pdfId: string;
  pdfName: string;
  pdfTitle: string;
  tableKey: string;
  label: string;
  title: string;
  page: string;
  sourcePath: string;
  hasData: boolean;
  rowCount: number;
  columnCount: number;
  columns: string[];
  previewRows: unknown[][];
}

export interface PdfWikiMetaTableExportItem extends PdfWikiMetaTableItem {
  rows: unknown[][];
}

export interface PdfWikiIntegratedDataTable {
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

export interface PdfWikiMetaAnalysisCodingTableEditResult {
  pdfId: string;
  deletedRowCount: number;
  deletedColumnCount: number;
  protectedColumns: string[];
  updatedRowCount?: number;
  remainingRowCount: number;
  dataTable: PdfWikiIntegratedDataTable;
}

export interface PdfWikiFigureDigitizationImportInput {
  fileName: string;
  buffer: Buffer;
  figureKey?: string;
  figureLabel?: string;
  tool?: string;
  notes?: string;
  parameters?: Record<string, unknown>;
}

export interface PdfWikiFigureDigitizationImportResult {
  pdfId: string;
  importedRows: number;
  metaRowCount: number;
  figureLabel: string;
  columns: string[];
  storedFile: string;
}

interface PdfWikiMetaTableFileItem extends PdfWikiMetaTableItem {
  csvFilePath?: string;
  jsonFilePath?: string;
}

interface PdfWikiClaimSection {
  label: string;
  sectionName: string;
  text: string;
  sentenceEvidence: Map<string, PdfWikiSentenceEvidence>;
}

interface PdfWikiSentenceReferenceCandidate {
  ref: PdfWikiReference;
  score: number;
  matchType: 'citation' | 'bm25';
}

interface PdfWikiSentenceReferenceMatch {
  sentenceId: string;
  sentenceIndex: number;
  sentence: string;
  citations: string[];
  candidates: PdfWikiSentenceReferenceCandidate[];
}

interface PdfWikiSentenceEvidence {
  id: string;
  sectionName: string;
  sentenceIndex: number;
  sentence: string;
  citations: string[];
  references: PdfWikiReference[];
}

interface ParsedPdfWikiViewpointInput {
  summary: string;
  evidence: string;
  section: string;
  location: string;
  inTextCitations: string[];
  evidenceSentenceIds: string[];
  referenceIndexes: number[];
  references: Array<Partial<PdfWikiReference>>;
}

interface QwenLongPdfBuildResult {
  referenceIndex: PdfWikiReferenceIndexResult;
  entries: PdfWikiEntry[];
}

interface WikiEngineEntry {
  engine: HybridRetrievalEngine;
  updatedAt: number;
  vectorConfigKey: string;
}

const DEFAULT_STATUS: PdfWikiBuildStatus = {
  status: 'idle',
  totalPdfs: 0,
  processedPdfs: 0,
  totalChunks: 0,
  processedChunks: 0,
  entryCount: 0,
  message: '尚未生成 PDF Wiki',
};

const PDF_WIKI_OVERVIEW_DIAGRAM_LAYOUT_VERSION = 7;
const PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_VERSION = 1 as const;
const PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_BATCH_SIZE = 20;
const PDF_WIKI_RETRIEVAL_POLICY_VERSION = 'reference-backed-v1';

const PDF_WIKI_META_ANALYSIS_COLUMNS = [
  'Obs#',
  'Study#',
  '处理',
  '种植的作物',
  'N input',
  'Period',
  '持续天数',
  '重复数',
  'Lat',
  'Long',
  '实验类型',
  '实验期间土壤平均温度',
  '实验期间空气平均温度',
  '年均温',
  '实验期间降水量',
  '灌溉量',
  '总纳水量',
  '年均降水量',
  'WFPS(%)',
  'WHC（%）',
  'Soil Texture',
  'Bulk Density',
  'PH',
  'SOM',
  'SOC',
  'TC',
  'TN',
  'C/N',
  'NH4+-N (mg kg-1)',
  'NO3_-N (mg kg-1)',
  '气候',
  '施肥次数',
  '施肥方式',
  'Cum NO',
  'NO_SD',
  'NO_n',
  'NO_减氮',
  'NO_CKmean',
  'NO_CKsd',
  'NO_CKn',
  'NO_Tmean',
  'NO_Tsd',
  'NO_Tn',
  'Cum N2O',
  'N2O_SD',
  'N2O_n',
  'N2O_减氮',
  'N2O_CKmean',
  'N2O_CKsd',
  'N2O_CKn',
  'N2O_Tmean',
  'N2O_Tsd',
  'N2O_Tn',
] as const;

const PDF_WIKI_META_ANALYSIS_TRACE_COLUMNS = [
  'PDF标题',
  'PDF文件名',
  '数据来源',
  '来源名称',
  '页码/位置',
  '证据原文',
] as const;

export interface PdfWikiMetaAnalysisTemplate {
  filename: string;
  columns: string[];
  uploadedAt: string;
  sheetName?: string;
  headerRowIndex?: number;
  sheets?: Array<{
    name: string;
    headerRowIndex: number;
    columns: string[];
    previewRows: string[][];
    rowCount: number;
  }>;
}

export interface PdfWikiMetaAnalysisTemplateStatus {
  configured: boolean;
  filename: string;
  columns: string[];
  uploadedAt: string;
  sheetName?: string;
  headerRowIndex?: number;
  sheets?: PdfWikiMetaAnalysisTemplate['sheets'];
}

interface PdfWikiMetaAnalysisUnitRegistryEntry {
  base: string;
  unit: string;
  source: string;
  updatedAt: string;
}

interface PdfWikiMetaAnalysisUnitRegistry {
  version: 1;
  updatedAt: string;
  columns: Record<string, PdfWikiMetaAnalysisUnitRegistryEntry>;
}

export class PdfWikiManager {
  private engines = new Map<string, WikiEngineEntry>();
  private buildLocks = new Map<string, Promise<void>>();
  private fileWriteLocks = new Map<string, Promise<void>>();
  private statusWorkProgress = new Map<string, PdfWikiWorkProgress>();
  private queueMutationLocks = new Map<string, Promise<void>>();
  private queueWorkers = new Map<string, Promise<void>>();
  private recognitionQueueMutationLocks = new Map<string, Promise<void>>();
  private recognitionQueueWorkers = new Map<string, Promise<void>>();
  private sentenceTopicAnnotationJobs = new Map<string, Promise<void>>();
  private metaDatabaseSummaryCache = new Map<string, PdfWikiMetaDatabaseIndexFile>();
  private pdfManagerStoreSnapshotCache = new Map<string, {
    mtimeMs: number;
    size: number;
    snapshot: PdfWikiPdfManagerStoreSnapshot;
  }>();
  private viewerStoreSnapshotCache = new Map<string, {
    mtimeMs: number;
    size: number;
    snapshot: PdfWikiViewerStoreSnapshot;
  }>();
  private queueRuntimeConfigProvider: (() => PdfWikiLlmConfig) | null = null;

  constructor(private readonly dataDir: string) {}

  async getTopicCatalog(userId: string): Promise<PdfWikiTopicCatalog> {
    const catalogPath = this.getTopicCatalogPath(userId);
    if (!fs.existsSync(catalogPath)) {
      return this.createEmptyTopicCatalog();
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(catalogPath, 'utf-8')) as Partial<PdfWikiTopicCatalog>;
      return this.normalizeTopicCatalog(parsed);
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read topic catalog for ${sanitizeUserId(userId)}:`, error);
      return this.createEmptyTopicCatalog();
    }
  }

  async expandAndSaveTopics(
    userId: string,
    inputs: PdfWikiTopicInput[],
    llmConfig: PdfWikiLlmConfig
  ): Promise<{ catalog: PdfWikiTopicCatalog; reclassifiedPointCount: number }> {
    const requested = (Array.isArray(inputs) ? inputs : [])
      .map(input => ({
        label: this.cleanTopicText(input?.label, 80),
        description: this.cleanTopicText(input?.description, 500),
      }))
      .filter(input => !!input.label)
      .slice(0, 20);
    if (requested.length === 0) {
      throw new Error('请至少输入一个主题名称');
    }

    const prompt = `你正在为学术 PDF 句子级论点库扩写用户指定的主题。主题名称由用户决定，不得改名，不得增加用户没有提出的新主题。

请为每个主题生成：
1. description：一句中文用途说明，明确该主题覆盖什么研究问题。
2. aliases：常见中文别名、英文名称、英文缩写，最多 12 个。
3. keywords：适合在中英文学术句子中做精确词面匹配的词组，最多 30 个。优先使用有区分度的名词短语，不要放“研究、结果、影响、方法”等泛词。
4. excludeKeywords：容易造成误匹配、但不属于本主题的词组，最多 12 个。

返回 JSON：
{"topics":[{"label":"与输入完全一致","description":"...","aliases":["..."],"keywords":["..."],"excludeKeywords":["..."]}]}

用户主题：
${JSON.stringify(requested, null, 2)}`;

    let parsed: Record<string, unknown>;
    if (this.canUseCodexCli()) {
      const codexConfig = this.loadPdfWikiCodexConfig();
      const taskDir = path.join(this.getWikiDir(userId), 'topic-expansion', `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
      parsed = await this.callCodexJsonTask(codexConfig, taskDir, prompt, 'topic expansion');
    } else if ((llmConfig.jsonApiUrl || llmConfig.apiUrl) && (llmConfig.jsonApiKey || llmConfig.apiKey)) {
      parsed = await this.callJsonNormalizer(llmConfig, prompt, 5000, 'topic expansion');
    } else if (this.canUseCodexCli(true)) {
      const codexConfig = this.loadPdfWikiCodexConfig();
      const taskDir = path.join(this.getWikiDir(userId), 'topic-expansion', `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`);
      parsed = await this.callCodexJsonTask(codexConfig, taskDir, prompt, 'topic expansion');
    } else {
      throw new Error('未检测到可用的 Codex CLI 或 PDF Wiki AI API，暂时无法扩写主题');
    }

    const expandedRecords = Array.isArray(parsed.topics) ? parsed.topics : [];
    const now = new Date().toISOString();
    const current = await this.getTopicCatalog(userId);
    const byLabel = new Map(current.topics.map(topic => [topic.label.toLocaleLowerCase(), topic]));
    const additions = requested.map((input, index) => {
      const record = expandedRecords.find(item => {
        if (!item || typeof item !== 'object') return false;
        return this.cleanTopicText((item as Record<string, unknown>).label, 80).toLocaleLowerCase() === input.label.toLocaleLowerCase();
      }) || expandedRecords[index];
      const data = record && typeof record === 'object' ? record as Record<string, unknown> : {};
      const existing = byLabel.get(input.label.toLocaleLowerCase());
      return this.normalizeTopicDefinition({
        id: existing?.id || this.createTopicId(input.label),
        label: input.label,
        description: this.cleanTopicText(data.description, 500) || input.description || existing?.description || '',
        aliases: this.normalizeTopicTerms(data.aliases, 12),
        keywords: this.normalizeTopicTerms(data.keywords, 30),
        excludeKeywords: this.normalizeTopicTerms(data.excludeKeywords, 12),
        expandedBy: 'ai',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      });
    });

    const replacementLabels = new Set(additions.map(topic => topic.label.toLocaleLowerCase()));
    const catalog = this.normalizeTopicCatalog({
      version: 1,
      updatedAt: now,
      topics: [
        ...current.topics.filter(topic => !replacementLabels.has(topic.label.toLocaleLowerCase())),
        ...additions,
      ],
    });
    await this.writeJsonAtomic(this.getTopicCatalogPath(userId), catalog);
    const reclassifiedPointCount = await this.reclassifySentenceTopics(userId, catalog.topics);
    return { catalog, reclassifiedPointCount };
  }

  async saveManualTopicDefinition(
    userId: string,
    input: PdfWikiManualTopicInput
  ): Promise<{ catalog: PdfWikiTopicCatalog; topic: PdfWikiTopicDefinition; reclassifiedPointCount: number }> {
    const label = this.cleanTopicText(input?.label, 80);
    if (!label) {
      throw new Error('请输入主题名称');
    }

    const current = await this.getTopicCatalog(userId);
    const requestedId = this.cleanTopicText(input?.id, 80);
    const existing = requestedId ? current.topics.find(topic => topic.id === requestedId) : undefined;
    if (requestedId && !existing) {
      throw new Error('未找到需要修改的主题');
    }
    const duplicate = current.topics.find(topic => (
      topic.id !== requestedId && topic.label.toLocaleLowerCase() === label.toLocaleLowerCase()
    ));
    if (duplicate) {
      throw new Error('已存在同名主题');
    }
    if (!existing && current.topics.length >= 50) {
      throw new Error('用户主题最多保存 50 个');
    }

    const now = new Date().toISOString();
    const topic = this.normalizeTopicDefinition({
      id: existing?.id || this.createTopicId(label),
      label,
      description: this.cleanTopicText(input?.description, 500),
      aliases: this.normalizeTopicTerms(input?.aliases, 12),
      keywords: this.normalizeTopicTerms(input?.keywords, 30),
      excludeKeywords: this.normalizeTopicTerms(input?.excludeKeywords, 12),
      expandedBy: 'manual',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
    const topics = existing
      ? current.topics.map(item => item.id === existing.id ? topic : item)
      : [...current.topics, topic];
    const catalog = this.normalizeTopicCatalog({ version: 1, updatedAt: now, topics });
    await this.writeJsonAtomic(this.getTopicCatalogPath(userId), catalog);
    const reclassifiedPointCount = await this.reclassifySentenceTopics(userId, catalog.topics);
    return { catalog, topic, reclassifiedPointCount };
  }

  async deleteTopicDefinition(
    userId: string,
    topicId: string
  ): Promise<{ catalog: PdfWikiTopicCatalog; reclassifiedPointCount: number }> {
    const current = await this.getTopicCatalog(userId);
    const topics = current.topics.filter(topic => topic.id !== topicId);
    if (topics.length === current.topics.length) {
      throw new Error('未找到需要删除的主题');
    }
    const catalog = this.normalizeTopicCatalog({ version: 1, updatedAt: new Date().toISOString(), topics });
    await this.writeJsonAtomic(this.getTopicCatalogPath(userId), catalog);
    const reclassifiedPointCount = await this.reclassifySentenceTopics(userId, catalog.topics);
    return { catalog, reclassifiedPointCount };
  }

  async reclassifySentenceTopics(
    userId: string,
    topicDefinitions?: PdfWikiTopicDefinition[]
  ): Promise<number> {
    const catalog = topicDefinitions || (await this.getTopicCatalog(userId)).topics;
    const store = await this.loadStore(userId);
    const existingPoints = store.sentenceCloud?.points || [];
    if (existingPoints.length === 0) return 0;
    const points = existingPoints.map(point => this.applyTopicDefinitionToPoint(point, catalog));
    store.sentenceCloud = this.buildSentenceCloudStore(points);
    await this.persistManualStoreUpdate(userId, store, `已按 ${catalog.length} 个用户主题重新匹配 PDF Wiki 论点句`);
    return points.length;
  }

  async getSentenceTopicAnnotationStatus(userId: string): Promise<PdfWikiSentenceTopicAnnotationStatus> {
    const safeUserId = sanitizeUserId(userId);
    const [store, catalog, annotations, savedStatus] = await Promise.all([
      this.loadStore(safeUserId),
      this.getTopicCatalog(safeUserId),
      this.loadSentenceTopicAnnotationStore(safeUserId),
      this.loadSentenceTopicAnnotationStatus(safeUserId),
    ]);
    const points = store.sentenceCloud?.points || [];
    const taxonomyHash = this.getSentenceTopicTaxonomyHash(catalog);
    const annotatedSentences = points.filter(point => (
      this.isCurrentSentenceTopicAnnotation(point, annotations.records[point.id], taxonomyHash)
    )).length;
    const totalSentences = points.length;
    const pendingSentences = Math.max(0, totalSentences - annotatedSentences);
    const now = new Date().toISOString();
    let status: PdfWikiSentenceTopicAnnotationStatus = savedStatus || {
      status: totalSentences > 0 ? 'idle' : 'idle',
      totalSentences,
      annotatedSentences,
      pendingSentences,
      targetSentences: pendingSentences,
      processedSentences: 0,
      failedSentences: 0,
      skippedSentences: annotatedSentences,
      progress: totalSentences > 0 ? Math.round((annotatedSentences / totalSentences) * 100) : 0,
      message: totalSentences > 0 ? '尚未启动 AI 句子主题标注' : '句子库为空，请先导入并处理 PDF',
      updatedAt: now,
    };

    if (status.status === 'processing' && !this.sentenceTopicAnnotationJobs.has(safeUserId)) {
      status = {
        ...status,
        status: 'error',
        message: '上一次标注任务随应用退出而中断；已记录的句子不会重复处理，可直接继续。',
        error: 'INTERRUPTED_SENTENCE_TOPIC_ANNOTATION',
        updatedAt: now,
      };
      await this.saveSentenceTopicAnnotationStatus(safeUserId, status);
    }

    return {
      ...status,
      totalSentences,
      annotatedSentences,
      pendingSentences,
      skippedSentences: status.status === 'processing' ? status.skippedSentences : annotatedSentences,
      progress: status.status === 'processing' && status.targetSentences > 0
        ? Math.min(100, Math.round((status.processedSentences / status.targetSentences) * 100))
        : (totalSentences > 0 ? Math.round((annotatedSentences / totalSentences) * 100) : 0),
    };
  }

  async startSentenceTopicAnnotation(
    userId: string,
    llmConfig: PdfWikiLlmConfig,
    options: { force?: boolean } = {}
  ): Promise<PdfWikiSentenceTopicAnnotationStatus> {
    const safeUserId = sanitizeUserId(userId);
    if (this.sentenceTopicAnnotationJobs.has(safeUserId)) {
      return this.getSentenceTopicAnnotationStatus(safeUserId);
    }

    const [store, catalog, annotations] = await Promise.all([
      this.loadStore(safeUserId),
      this.getTopicCatalog(safeUserId),
      this.loadSentenceTopicAnnotationStore(safeUserId),
    ]);
    const points = store.sentenceCloud?.points || [];
    if (points.length === 0) {
      throw new Error('句子库为空，请先上传并完成 PDF Wiki 句子提取');
    }
    if (!this.hasSentenceTopicAnnotationProvider(llmConfig)) {
      throw new Error('未检测到可用的 Codex CLI 或 PDF Wiki AI API，无法进行句子主题标注');
    }

    const taxonomyHash = this.getSentenceTopicTaxonomyHash(catalog);
    const force = options.force === true;
    const pendingPoints = points.filter(point => (
      force || !this.isCurrentSentenceTopicAnnotation(point, annotations.records[point.id], taxonomyHash)
    ));
    const now = new Date().toISOString();
    if (pendingPoints.length === 0) {
      const completed: PdfWikiSentenceTopicAnnotationStatus = {
        status: 'completed',
        totalSentences: points.length,
        annotatedSentences: points.length,
        pendingSentences: 0,
        targetSentences: 0,
        processedSentences: 0,
        failedSentences: 0,
        skippedSentences: points.length,
        progress: 100,
        message: '所有句子均已有有效 AI 主题标签，无需重复处理。',
        startedAt: now,
        completedAt: now,
        updatedAt: now,
      };
      await this.saveSentenceTopicAnnotationStatus(safeUserId, completed);
      return completed;
    }

    const initialStatus: PdfWikiSentenceTopicAnnotationStatus = {
      status: 'processing',
      totalSentences: points.length,
      annotatedSentences: points.length - pendingPoints.length,
      pendingSentences: pendingPoints.length,
      targetSentences: pendingPoints.length,
      processedSentences: 0,
      failedSentences: 0,
      skippedSentences: force ? 0 : points.length - pendingPoints.length,
      progress: 0,
      message: `AI 正在标注 ${pendingPoints.length} 个${force ? '句子' : '新增或发生变化的句子'}…`,
      startedAt: now,
      updatedAt: now,
    };
    await this.saveSentenceTopicAnnotationStatus(safeUserId, initialStatus);

    const job = this.runSentenceTopicAnnotationJob(
      safeUserId,
      pendingPoints,
      catalog,
      annotations,
      llmConfig,
      initialStatus
    );
    this.sentenceTopicAnnotationJobs.set(safeUserId, job);
    const releaseJob = () => {
      if (this.sentenceTopicAnnotationJobs.get(safeUserId) === job) {
        this.sentenceTopicAnnotationJobs.delete(safeUserId);
      }
    };
    void job.then(releaseJob, error => {
      releaseJob();
      logger.error(`[PdfWiki] Unhandled sentence topic annotation job failure for ${safeUserId}:`, error);
    });
    return initialStatus;
  }

  private async runSentenceTopicAnnotationJob(
    userId: string,
    pendingPoints: PdfWikiSentencePoint[],
    catalog: PdfWikiTopicCatalog,
    annotationStore: PdfWikiSentenceTopicAnnotationStore,
    llmConfig: PdfWikiLlmConfig,
    initialStatus: PdfWikiSentenceTopicAnnotationStatus
  ): Promise<void> {
    const taxonomyHash = this.getSentenceTopicTaxonomyHash(catalog);
    let processedSentences = 0;
    let failedSentences = 0;
    let providerLabel = '';
    try {
      for (let offset = 0; offset < pendingPoints.length; offset += PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_BATCH_SIZE) {
        const batch = pendingPoints.slice(offset, offset + PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_BATCH_SIZE);
        const result = await this.annotateSentenceTopicBatch(userId, batch, catalog, taxonomyHash, llmConfig);
        providerLabel = result.provider === 'api' ? 'API' : 'Codex';
        const byId = new Map(result.annotations.map(annotation => [annotation.sentenceId, annotation]));
        let savedInBatch = 0;
        for (const point of batch) {
          const annotation = byId.get(point.id);
          if (!annotation) continue;
          annotationStore.records[point.id] = annotation.value;
          savedInBatch += 1;
        }
        processedSentences += batch.length;
        failedSentences += batch.length - savedInBatch;
        annotationStore.updatedAt = new Date().toISOString();
        await this.saveSentenceTopicAnnotationStore(userId, annotationStore);

        const annotatedSentences = pendingPoints.filter(point => (
          this.isCurrentSentenceTopicAnnotation(point, annotationStore.records[point.id], taxonomyHash)
        )).length + initialStatus.skippedSentences;
        const updatedAt = new Date().toISOString();
        await this.saveSentenceTopicAnnotationStatus(userId, {
          ...initialStatus,
          status: 'processing',
          annotatedSentences,
          pendingSentences: Math.max(0, initialStatus.totalSentences - annotatedSentences),
          processedSentences,
          failedSentences,
          progress: Math.min(100, Math.round((processedSentences / initialStatus.targetSentences) * 100)),
          message: `${providerLabel} 已处理 ${processedSentences}/${initialStatus.targetSentences} 个句子，成功记录 ${annotatedSentences} 个；返回未通过校验 ${failedSentences} 个。`,
          updatedAt,
        });
      }

      const [latestStore, latestCatalog] = await Promise.all([
        this.loadStore(userId),
        this.getTopicCatalog(userId),
      ]);
      const latestPoints = latestStore.sentenceCloud?.points || [];
      const latestTaxonomyHash = this.getSentenceTopicTaxonomyHash(latestCatalog);
      const annotatedSentences = latestPoints.filter(point => (
        this.isCurrentSentenceTopicAnnotation(point, annotationStore.records[point.id], latestTaxonomyHash)
      )).length;
      const pendingSentences = Math.max(0, latestPoints.length - annotatedSentences);
      const completedAt = new Date().toISOString();
      await this.saveSentenceTopicAnnotationStatus(userId, {
        ...initialStatus,
        status: 'completed',
        totalSentences: latestPoints.length,
        annotatedSentences,
        pendingSentences,
        processedSentences,
        failedSentences,
        progress: 100,
        message: pendingSentences > 0
          ? `本次标注完成，已记录 ${annotatedSentences} 个句子；${pendingSentences} 个返回未通过校验，可再次点击继续。`
          : `AI 句子主题标注完成，${annotatedSentences} 个句子均已记录；下次只处理新增或变化的句子。`,
        completedAt,
        updatedAt: completedAt,
      });
      this.clearEngine(userId);
    } catch (error) {
      const updatedAt = new Date().toISOString();
      const message = this.getErrorMessage(error);
      const annotatedInRun = pendingPoints.filter(point => (
        this.isCurrentSentenceTopicAnnotation(point, annotationStore.records[point.id], taxonomyHash)
      )).length;
      const annotatedSentences = Math.min(
        initialStatus.totalSentences,
        initialStatus.skippedSentences + annotatedInRun
      );
      await this.saveSentenceTopicAnnotationStatus(userId, {
        ...initialStatus,
        status: 'error',
        annotatedSentences,
        pendingSentences: Math.max(0, initialStatus.totalSentences - annotatedSentences),
        processedSentences,
        failedSentences,
        progress: initialStatus.targetSentences > 0
          ? Math.min(100, Math.round((processedSentences / initialStatus.targetSentences) * 100))
          : 0,
        message: `AI 句子主题标注中断：${message}。已完成的句子已经保存，重试时不会重复处理。`,
        error: message,
        updatedAt,
      });
      logger.error(`[PdfWiki] Sentence topic annotation failed for ${userId}:`, error);
    }
  }

  private async annotateSentenceTopicBatch(
    userId: string,
    points: PdfWikiSentencePoint[],
    catalog: PdfWikiTopicCatalog,
    taxonomyHash: string,
    llmConfig: PdfWikiLlmConfig
  ): Promise<{
    provider: 'api' | 'codex';
    annotations: Array<{ sentenceId: string; value: PdfWikiSentenceTopicAnnotation }>;
  }> {
    const buildPrompt = (batch: PdfWikiSentencePoint[], retry: boolean): string => {
      const topicCandidates = catalog.topics.map(topic => ({
        label: topic.label,
        description: topic.description,
        aliases: topic.aliases.slice(0, 4),
      }));
      return `你正在为学术 PDF 句子级论点库逐句添加多标签。必须只依据每条输入的原句和论点文本，不得补写原文没有的事实。

${retry ? '这是针对上一轮遗漏项的自动校验重试。必须逐条原样返回下面列出的每一个 sentenceId，数量必须与 SENTENCES 完全一致。' : ''}

每个句子必须返回：
1. subjectTags：1-5 个简洁、具体、可检索的中文学术主题标签；保留 N2O、DNA 等必要缩写。优先使用 USER_TOPICS 中适用的原标签，但可以在没有合适候选时生成更准确的标签。
2. trendConclusionTopic：恰好 1 个趋势/结论型主题，必须表达该句的方向、关系、变化、限制或结论，例如“增雨提高土壤 N2O 排放”“该效应受土壤含水量限制”；不得只写“趋势”“结论”“研究结果”等泛词。
3. 不要返回置信度，不要解释，不要合并或遗漏 sentenceId。

只返回 JSON：
{"annotations":[{"sentenceId":"原 ID","subjectTags":["标签1","标签2"],"trendConclusionTopic":"趋势或结论主题"}]}

USER_TOPICS:
${JSON.stringify(topicCandidates)}

SENTENCES:
${JSON.stringify(batch.map(point => ({
      sentenceId: point.id,
      section: point.section,
      sentence: point.sentence.slice(0, 1600),
      claimText: (point.claimText || '').slice(0, 600),
      currentTopic: point.topicLabel || '',
    })))}`;
    };

    const requestAnnotations = async (
      batch: PdfWikiSentencePoint[],
      retry: boolean
    ): Promise<{ parsed: unknown; provider: 'api' | 'codex'; model: string }> => {
      const prompt = buildPrompt(batch, retry);
      if ((llmConfig.jsonApiUrl && llmConfig.jsonApiKey) || (llmConfig.apiUrl && llmConfig.apiKey)) {
        return {
          parsed: await this.callJsonNormalizer(
            llmConfig,
            prompt,
            7000,
            retry ? 'sentence-topic-annotation-retry' : 'sentence-topic-annotation'
          ),
          provider: 'api',
          model: llmConfig.jsonModel || llmConfig.model || '',
        };
      }
      const codexConfig = this.loadPdfWikiCodexConfig();
      const taskDir = path.join(
        this.getWikiDir(userId),
        'sentence-topic-annotation',
        `${Date.now()}_${crypto.randomBytes(3).toString('hex')}`
      );
      return {
        parsed: await this.callCodexJsonTask(
          codexConfig,
          taskDir,
          prompt,
          retry ? 'sentence topic annotation retry' : 'sentence topic annotation'
        ),
        provider: 'codex',
        model: codexConfig.model || '',
      };
    };

    const firstResponse = await requestAnnotations(points, false);
    const firstNormalized = this.normalizeSentenceTopicAnnotationResponse(
      firstResponse.parsed,
      points,
      taxonomyHash,
      firstResponse.provider,
      firstResponse.model
    );
    const annotationsById = new Map(firstNormalized.annotations.map(item => [item.sentenceId, item]));
    const missingPoints = points.filter(point => !annotationsById.has(point.id));
    let finalRejectionReasons = firstNormalized.rejectionReasons;

    if (missingPoints.length > 0) {
      try {
        const retryResponse = await requestAnnotations(missingPoints, true);
        const retryNormalized = this.normalizeSentenceTopicAnnotationResponse(
          retryResponse.parsed,
          missingPoints,
          taxonomyHash,
          retryResponse.provider,
          retryResponse.model
        );
        for (const annotation of retryNormalized.annotations) {
          annotationsById.set(annotation.sentenceId, annotation);
        }
        finalRejectionReasons = retryNormalized.rejectionReasons;
      } catch (error) {
        finalRejectionReasons = {
          ...finalRejectionReasons,
          'retry-request-error': missingPoints.length,
        };
        logger.warn(
          `[PdfWiki] Sentence topic retry request failed; preserving ${annotationsById.size} valid first-pass record(s)`,
          error
        );
      }
    }

    const stillMissing = points.filter(point => !annotationsById.has(point.id));
    if (stillMissing.length > 0) {
      logger.warn(
        `[PdfWiki] Sentence topic response validation left ${stillMissing.length}/${points.length} sentence(s) pending`,
        {
          sentenceIds: stillMissing.slice(0, 8).map(point => point.id),
          reasons: finalRejectionReasons,
        }
      );
    }
    return { provider: firstResponse.provider, annotations: Array.from(annotationsById.values()) };
  }

  private normalizeSentenceTopicAnnotationResponse(
    parsed: unknown,
    points: PdfWikiSentencePoint[],
    taxonomyHash: string,
    provider: 'api' | 'codex',
    model: string
  ): {
    annotations: Array<{ sentenceId: string; value: PdfWikiSentenceTopicAnnotation }>;
    rejectionReasons: Record<string, number>;
  } {
    const pointById = new Map(points.map(point => [point.id, point]));
    const pointIdByLowerCase = new Map(points.map(point => [point.id.toLocaleLowerCase(), point.id]));
    const responseContainerKeys = ['annotations', 'results', 'items', 'data', 'output', 'result', 'response'];
    const findRecords = (value: unknown, depth = 0): unknown[] => {
      if (Array.isArray(value)) return value;
      if (!value || typeof value !== 'object' || depth > 4) return [];
      const record = value as Record<string, unknown>;
      const keyedRecords = Object.entries(record)
        .filter(([key, item]) => pointIdByLowerCase.has(key.toLocaleLowerCase()) && !!item && typeof item === 'object')
        .map(([key, item]) => ({ ...(item as Record<string, unknown>), sentenceId: pointIdByLowerCase.get(key.toLocaleLowerCase()) || key }));
      if (keyedRecords.length > 0) return keyedRecords;
      for (const key of responseContainerKeys) {
        if (!(key in record)) continue;
        const nested = findRecords(record[key], depth + 1);
        if (nested.length > 0) return nested;
      }
      return [];
    };
    const records = findRecords(parsed);
    const rejectionReasons: Record<string, number> = {};
    const reject = (reason: string): void => {
      rejectionReasons[reason] = (rejectionReasons[reason] || 0) + 1;
    };
    const firstValue = (record: Record<string, unknown>, keys: string[]): unknown => {
      for (const key of keys) {
        const value = record[key];
        if (value !== undefined && value !== null && value !== '') return value;
      }
      return undefined;
    };
    const normalizeTagInput = (value: unknown): unknown => {
      if (!Array.isArray(value)) return value;
      return value.map(item => {
        if (!item || typeof item !== 'object') return item;
        return firstValue(item as Record<string, unknown>, ['label', 'name', 'tag', 'topic', 'value']);
      });
    };
    const normalizeTextValue = (value: unknown): unknown => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
      return firstValue(value as Record<string, unknown>, ['label', 'name', 'topic', 'value', 'text']);
    };
    const seen = new Set<string>();
    const annotations: Array<{ sentenceId: string; value: PdfWikiSentenceTopicAnnotation }> = [];
    records.forEach((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        reject('invalid-record');
        return;
      }
      const record = raw as Record<string, unknown>;
      const rawId = firstValue(record, ['sentenceId', 'sentence_id', 'sentenceID', 'id', 'pointId', 'point_id']);
      let sentenceId = this.cleanTopicText(rawId, 180);
      if (sentenceId && !pointById.has(sentenceId)) {
        sentenceId = pointIdByLowerCase.get(sentenceId.toLocaleLowerCase()) || '';
      }
      if (!sentenceId && rawId !== undefined) {
        const cleanedRawId = this.cleanTopicText(rawId, 500).toLocaleLowerCase();
        const wrappedId = points.find(point => cleanedRawId.includes(point.id.toLocaleLowerCase()));
        sentenceId = wrappedId?.id || '';
      }
      if (!sentenceId && rawId === undefined && records.length === points.length) {
        sentenceId = points[index]?.id || '';
      }
      if (!sentenceId) {
        reject(rawId === undefined ? 'missing-id' : 'unknown-id');
        return;
      }
      const point = pointById.get(sentenceId);
      if (!point || seen.has(sentenceId)) {
        reject(point ? 'duplicate-id' : 'unknown-id');
        return;
      }
      const subjectTags = this.normalizeTopicTerms(normalizeTagInput(firstValue(record, [
        'subjectTags',
        'subject_tags',
        'topicTags',
        'topic_tags',
        'topics',
        'tags',
        'labels',
        'themeTags',
        'theme_tags',
      ])), 5).map(tag => this.cleanTopicText(tag, 80)).filter(Boolean).slice(0, 5);
      if (subjectTags.length === 0) {
        reject('missing-subject-tags');
        return;
      }
      const trendConclusionTopic = this.cleanTopicText(normalizeTextValue(firstValue(record, [
        'trendConclusionTopic',
        'trend_conclusion_topic',
        'trendTopic',
        'trend_topic',
        'conclusionTopic',
        'conclusion_topic',
        'trendConclusion',
        'trend_conclusion',
        'summaryTopic',
        'summary_topic',
        'directionalTopic',
        'directional_topic',
      ])), 120);
      if (!trendConclusionTopic) {
        reject('missing-trend-conclusion');
        return;
      }
      seen.add(sentenceId);
      annotations.push({
        sentenceId,
        value: {
          version: PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_VERSION,
          sourceHash: this.getSentenceTopicSourceHash(point),
          taxonomyHash,
          subjectTags,
          trendConclusionTopic,
          annotatedAt: new Date().toISOString(),
          provider,
          model: model || undefined,
        },
      });
    });
    const missingRecordCount = Math.max(0, points.length - annotations.length);
    if (missingRecordCount > 0) rejectionReasons['missing-or-invalid-record'] = missingRecordCount;
    return { annotations, rejectionReasons };
  }

  private hasSentenceTopicAnnotationProvider(llmConfig: PdfWikiLlmConfig): boolean {
    return !!(
      (llmConfig.jsonApiUrl && llmConfig.jsonApiKey)
      || (llmConfig.apiUrl && llmConfig.apiKey)
      || this.canUseCodexCli()
      || this.canUseCodexCli(true)
    );
  }

  private getSentenceTopicSourceHash(point: PdfWikiSentencePoint): string {
    return crypto.createHash('sha256')
      .update([
        PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_VERSION,
        point.section,
        point.sentence,
        point.claimText || '',
      ].join('\u0000'))
      .digest('hex');
  }

  private getSentenceTopicTaxonomyHash(catalog: PdfWikiTopicCatalog): string {
    const topics = catalog.topics
      .map(topic => ({
        id: topic.id,
        label: topic.label,
        description: topic.description,
        aliases: topic.aliases,
        keywords: topic.keywords,
        excludeKeywords: topic.excludeKeywords,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
    return crypto.createHash('sha256')
      .update(JSON.stringify({ version: PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_VERSION, topics }))
      .digest('hex');
  }

  private isCurrentSentenceTopicAnnotation(
    point: PdfWikiSentencePoint,
    annotation: PdfWikiSentenceTopicAnnotation | undefined,
    taxonomyHash: string
  ): boolean {
    return !!(
      annotation
      && annotation.version === PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_VERSION
      && annotation.sourceHash === this.getSentenceTopicSourceHash(point)
      && annotation.taxonomyHash === taxonomyHash
      && annotation.subjectTags.length > 0
      && annotation.trendConclusionTopic
    );
  }

  setQueueRuntimeConfigProvider(provider: () => PdfWikiLlmConfig): void {
    this.queueRuntimeConfigProvider = provider;
  }

  async getMetaAnalysisTemplate(userId: string): Promise<PdfWikiMetaAnalysisTemplateStatus> {
    const template = this.loadMetaAnalysisTemplate(userId);
    return {
      configured: !!template,
      filename: template?.filename || '',
      columns: template?.columns || [],
      uploadedAt: template?.uploadedAt || '',
      sheetName: template?.sheetName || '',
      headerRowIndex: template?.headerRowIndex,
      sheets: template?.sheets || [],
    };
  }

  async saveMetaAnalysisTemplate(
    userId: string,
    template: {
      filename: string;
      columns: string[];
      sheetName?: string;
      headerRowIndex?: number;
      sheets?: PdfWikiMetaAnalysisTemplate['sheets'];
    }
  ): Promise<PdfWikiMetaAnalysisTemplateStatus> {
    const columns = this.normalizeMetaAnalysisTemplateColumns(template.columns);
    if (columns.length === 0) {
      throw new Error('Meta 数据库模板没有可用表头');
    }
    const payload: PdfWikiMetaAnalysisTemplate = {
      filename: template.filename || 'meta-template.xlsx',
      columns,
      uploadedAt: new Date().toISOString(),
      sheetName: template.sheetName || template.sheets?.[0]?.name || '',
      headerRowIndex: typeof template.headerRowIndex === 'number' ? template.headerRowIndex : template.sheets?.[0]?.headerRowIndex,
      sheets: (template.sheets || []).map(sheet => ({
        name: sheet.name,
        headerRowIndex: sheet.headerRowIndex,
        columns: this.normalizeMetaAnalysisTemplateColumns(sheet.columns),
        previewRows: (sheet.previewRows || []).slice(0, 8).map(row => row.map(cell => this.stringifyTableCellValue(cell))),
        rowCount: Number(sheet.rowCount || 0),
      })),
    };
    await fs.promises.mkdir(this.getWikiDir(userId), { recursive: true });
    await fs.promises.writeFile(this.getMetaAnalysisTemplatePath(userId), JSON.stringify(payload, null, 2), 'utf-8');
    this.ensureMetaAnalysisUnitRegistryFromColumns(userId, [
      ...payload.columns,
      ...(payload.sheets || []).flatMap(sheet => sheet.columns || []),
    ], 'template');
    return this.getMetaAnalysisTemplate(userId);
  }

  async clearMetaAnalysisTemplate(userId: string): Promise<PdfWikiMetaAnalysisTemplateStatus> {
    try {
      await fs.promises.unlink(this.getMetaAnalysisTemplatePath(userId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
    return this.getMetaAnalysisTemplate(userId);
  }

  private normalizeDigitizationOutcomeColumn(value: unknown, unit?: unknown): string {
    return this.buildMetaAnalysisColumnWithUnit(this.stringifyTableCellValue(value), unit)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  private buildMetaAnalysisColumnWithUnit(column: unknown, unit: unknown): string {
    const parsed = this.parseMetaAnalysisColumnUnit(this.stringifyTableCellValue(column));
    const base = parsed.base || this.stringifyTableCellValue(column);
    const nextUnit = this.normalizeMetaAnalysisUnit(unit || parsed.unit);
    if (!base || !nextUnit || this.isUnitlessMetaAnalysisColumn(base)) return base.trim();
    return `${base.trim()} (${nextUnit})`;
  }

  private parseMetaAnalysisColumnUnit(column: unknown): { base: string; unit: string } {
    const text = this.stringifyTableCellValue(column).replace(/（/g, '(').replace(/）/g, ')').replace(/\s+/g, ' ').trim();
    const match = text.match(/^(.+?)\s*\(([^()]+)\)\s*$/);
    if (!match) return { base: text, unit: '' };
    return {
      base: match[1].trim(),
      unit: this.normalizeMetaAnalysisUnit(match[2]),
    };
  }

  private normalizeMetaAnalysisColumnIdentity(value: unknown): string {
    const parsed = this.parseMetaAnalysisColumnUnit(value);
    const withUnit = parsed.unit ? `${parsed.base} (${parsed.unit})` : parsed.base;
    return this.normalizeMetaAnalysisColumnKey(withUnit);
  }

  private isUnitlessMetaAnalysisColumn(column: string): boolean {
    const normalized = this.normalizeMetaAnalysisColumnKey(column);
    return [
      'obs',
      'study',
      '处理',
      '种植的作物',
      'period',
      '实验类型',
      'soiltexture',
      '气候',
      '施肥方式',
      'pdf标题',
      'pdf文件名',
      '数据来源',
      '来源名称',
      '页码位置',
      '证据原文',
    ].includes(normalized);
  }

  private normalizeMetaAnalysisUnit(value: unknown): string {
    let unit = this.stringifyTableCellValue(value);
    if (!unit) return '';
    unit = unit
      .replace(/[（）]/g, match => match === '（' ? '(' : ')')
      .replace(/[·∙⋅]/g, ' ')
      .replace(/[−–—]/g, '-')
      .replace(/\^/g, '')
      .replace(/μ/g, 'µ')
      .replace(/℃/g, '°C')
      .replace(/\s+/g, ' ')
      .trim();
    unit = unit
      .replace(/\bdegrees?\b/ig, 'degree')
      .replace(/\bdeg\b/ig, 'degree')
      .replace(/\bpercent\b/ig, '%')
      .replace(/\bper\s+hectare\b/ig, 'ha-1')
      .replace(/\bper\s+ha\b/ig, 'ha-1')
      .replace(/\bper\s+kg\b/ig, 'kg-1')
      .replace(/\bper\s+g\b/ig, 'g-1')
      .replace(/\bper\s+m(?:2|²)\b/ig, 'm-2')
      .replace(/\/\s*ha\b/ig, ' ha-1')
      .replace(/\/\s*kg\b/ig, ' kg-1')
      .replace(/\/\s*g\b/ig, ' g-1')
      .replace(/\/\s*m(?:2|²)\b/ig, ' m-2')
      .replace(/\bha\s*-?\s*1\b/ig, 'ha-1')
      .replace(/\bkg\s*-?\s*1\b/ig, 'kg-1')
      .replace(/\bg\s*-?\s*1\b/ig, 'g-1')
      .replace(/\bm\s*-?\s*2\b/ig, 'm-2')
      .replace(/\bm2\b/ig, 'm-2')
      .replace(/\bm²\b/ig, 'm-2')
      .replace(/\s*\/\s*/g, ' ');
    unit = unit
      .replace(/\bkg\s+ha-1\b/ig, 'kg ha-1')
      .replace(/\bg\s+ha-1\b/ig, 'g ha-1')
      .replace(/\bmg\s+ha-1\b/ig, 'mg ha-1')
      .replace(/\bt\s+ha-1\b/ig, 't ha-1')
      .replace(/\bkg\s+m-2\b/ig, 'kg m-2')
      .replace(/\bg\s+m-2\b/ig, 'g m-2')
      .replace(/\bmg\s+m-2\b/ig, 'mg m-2')
      .replace(/\bmg\s+kg-1\b/ig, 'mg kg-1')
      .replace(/\bg\s+kg-1\b/ig, 'g kg-1')
      .replace(/\bµg\s+g-1\b/ig, 'µg g-1')
      .replace(/\bkg\s+m-3\b/ig, 'kg m-3')
      .replace(/\bg\s+cm-3\b/ig, 'g cm-3')
      .replace(/\bdays?\b/ig, 'd')
      .replace(/\byears?\b/ig, 'yr')
      .replace(/\s+/g, ' ')
      .trim();
    const info = this.classifyMetaAnalysisUnit(unit);
    return info ? info.canonical : unit;
  }

  private classifyMetaAnalysisUnit(unit: unknown): { family: string; canonical: string; factorToCanonical: number } | null {
    const raw = this.stringifyTableCellValue(unit);
    if (!raw) return null;
    const normalized = raw
      .replace(/[（）]/g, match => match === '（' ? '(' : ')')
      .replace(/[·∙⋅]/g, ' ')
      .replace(/[−–—]/g, '-')
      .replace(/\^/g, '')
      .replace(/μ/g, 'µ')
      .replace(/℃/g, '°C')
      .replace(/\s*\/\s*/g, ' ')
      .replace(/\bper\s+hectare\b/ig, 'ha-1')
      .replace(/\bper\s+ha\b/ig, 'ha-1')
      .replace(/\bper\s+m(?:2|²)\b/ig, 'm-2')
      .replace(/\bper\s+kg\b/ig, 'kg-1')
      .replace(/\bper\s+g\b/ig, 'g-1')
      .replace(/\/\s*ha\b/ig, ' ha-1')
      .replace(/\/\s*kg\b/ig, ' kg-1')
      .replace(/\/\s*g\b/ig, ' g-1')
      .replace(/\/\s*m(?:2|²)\b/ig, ' m-2')
      .replace(/\bha\s*-?\s*1\b/ig, 'ha-1')
      .replace(/\bkg\s*-?\s*1\b/ig, 'kg-1')
      .replace(/\bg\s*-?\s*1\b/ig, 'g-1')
      .replace(/\bm\s*-?\s*2\b/ig, 'm-2')
      .replace(/\bm2\b/ig, 'm-2')
      .replace(/\bm²\b/ig, 'm-2')
      .replace(/\bm\s*-?\s*3\b/ig, 'm-3')
      .replace(/\bcm\s*-?\s*3\b/ig, 'cm-3')
      .replace(/\s+/g, ' ')
      .trim();
    const lower = normalized.toLowerCase();
    if (!lower) return null;
    if (lower === '%' || lower === 'percent') return { family: 'percent', canonical: '%', factorToCanonical: 1 };
    if (lower === '°c' || lower === 'c' || lower === 'celsius') return { family: 'temperature-c', canonical: '°C', factorToCanonical: 1 };
    if (lower === 'k' || lower === 'kelvin') return { family: 'temperature-k', canonical: 'K', factorToCanonical: 1 };
    if (lower === 'd' || lower === 'day' || lower === 'days') return { family: 'time-day', canonical: 'd', factorToCanonical: 1 };
    if (lower === 'h' || lower === 'hour' || lower === 'hours') return { family: 'time-day', canonical: 'd', factorToCanonical: 1 / 24 };
    if (lower === 'yr' || lower === 'year' || lower === 'years') return { family: 'time-year', canonical: 'yr', factorToCanonical: 1 };
    if (lower === 'degree' || lower === 'degrees' || lower === 'deg') return { family: 'angle', canonical: 'degree', factorToCanonical: 1 };
    if (lower === 'mm') return { family: 'length-mm', canonical: 'mm', factorToCanonical: 1 };
    if (lower === 'cm') return { family: 'length-mm', canonical: 'mm', factorToCanonical: 10 };
    if (lower === 'm') return { family: 'length-mm', canonical: 'mm', factorToCanonical: 1000 };

    const areaMassMatch = lower.match(/\b(µg|ug|mg|g|kg|t)\s*(n2o-n|n2o|no-n|no|n|c)?\s*(ha-1|m-2)\b/);
    if (areaMassMatch) {
      const mass = areaMassMatch[1];
      const element = areaMassMatch[2] || '';
      const area = areaMassMatch[3];
      const massToKg: Record<string, number> = { 'µg': 1e-9, ug: 1e-9, mg: 1e-6, g: 1e-3, kg: 1, t: 1000 };
      const areaFactor = area === 'm-2' ? 10000 : 1;
      const elementLabel = element ? ` ${element.toUpperCase()}` : '';
      return {
        family: `mass-area-${element || 'generic'}`,
        canonical: `kg${elementLabel} ha-1`,
        factorToCanonical: (massToKg[mass] || 1) * areaFactor,
      };
    }

    const concentrationMatch = lower.match(/\b(µg|ug|mg|g)\s*(kg-1|g-1)\b/);
    if (concentrationMatch) {
      const mass = concentrationMatch[1];
      const denominator = concentrationMatch[2];
      let factor = 1;
      if (mass === 'g' && denominator === 'kg-1') factor = 1000;
      if ((mass === 'µg' || mass === 'ug') && denominator === 'g-1') factor = 1;
      if (mass === 'mg' && denominator === 'kg-1') factor = 1;
      return { family: 'mass-concentration', canonical: 'mg kg-1', factorToCanonical: factor };
    }

    if (/\bkg\s*m-3\b/i.test(lower)) return { family: 'bulk-density', canonical: 'g cm-3', factorToCanonical: 0.001 };
    if (/\bg\s*cm-3\b/i.test(lower)) return { family: 'bulk-density', canonical: 'g cm-3', factorToCanonical: 1 };
    return null;
  }

  private unitsAreCompatible(source: { family: string }, target: { family: string }): boolean {
    if (
      source.family.startsWith('mass-area-')
      && target.family.startsWith('mass-area-')
      && (source.family.endsWith('-generic') || target.family.endsWith('-generic'))
    ) {
      return true;
    }
    return source.family === target.family;
  }

  private normalizeDigitizationReadRole(value: unknown): string {
    return this.stringifyTableCellValue(value).toLowerCase().replace(/[\s_-]+/g, '');
  }

  private getDigitizationOutcomePrefix(value: unknown): string {
    const outcome = this.stringifyTableCellValue(value);
    const lower = outcome.toLowerCase();
    if (lower.includes('n2o') || outcome.includes('N₂O')) return 'N2O';
    if (/\bno\b/i.test(outcome)) return 'NO';
    return '';
  }

  private buildDigitizationOutcomeRoleColumn(outcome: unknown, readRole: unknown): string {
    const outcomeColumn = this.normalizeDigitizationOutcomeColumn(outcome);
    const normalizedRole = this.normalizeDigitizationReadRole(readRole);
    if (!outcomeColumn || !normalizedRole) return '';

    let suffix = '';
    if (/tmean|treatmentmean|处理均值|处理组均值/.test(normalizedRole)) suffix = 'Tmean';
    else if (/tsd|treatmentsd|处理标准差|处理组标准差/.test(normalizedRole)) suffix = 'Tsd';
    else if (/tn|treatmentn|处理样本量|处理组样本量/.test(normalizedRole)) suffix = 'Tn';
    else if (/ckmean|controlmean|对照均值|对照组均值/.test(normalizedRole)) suffix = 'CKmean';
    else if (/cksd|controlsd|对照标准差|对照组标准差/.test(normalizedRole)) suffix = 'CKsd';
    else if (/ckn|controln|对照样本量|对照组样本量/.test(normalizedRole)) suffix = 'CKn';
    else if (/cum|cumulative|累计|通量|排放量|总量/.test(normalizedRole)) {
      if (/^cum\s+/i.test(outcomeColumn)) return outcomeColumn;
      const prefix = this.getDigitizationOutcomePrefix(outcomeColumn);
      return `Cum ${prefix || outcomeColumn}`;
    }
    if (!suffix) return '';

    const prefix = this.getDigitizationOutcomePrefix(outcomeColumn);
    return `${prefix || outcomeColumn}_${suffix}`;
  }

  private async ensureMetaAnalysisOutcomeColumn(userId: string, outcome: unknown): Promise<string> {
    const column = this.normalizeDigitizationOutcomeColumn(outcome);
    if (!column) return '';

    const existingTemplate = this.loadMetaAnalysisTemplate(userId);
    const baseColumns = existingTemplate?.columns.length
      ? existingTemplate.columns
      : [...PDF_WIKI_META_ANALYSIS_COLUMNS];
    const normalizedColumn = this.normalizeMetaAnalysisColumnIdentity(column);
    if (baseColumns.some(existing => this.normalizeMetaAnalysisColumnIdentity(existing) === normalizedColumn)) {
      return baseColumns.find(existing => this.normalizeMetaAnalysisColumnIdentity(existing) === normalizedColumn) || column;
    }

    const nextColumns = [...baseColumns, column];
    const now = new Date().toISOString();
    const payload: PdfWikiMetaAnalysisTemplate = {
      filename: existingTemplate?.filename || 'auto-meta-analysis-template.json',
      columns: nextColumns,
      uploadedAt: existingTemplate?.uploadedAt || now,
      sheetName: existingTemplate?.sheetName || '',
      headerRowIndex: existingTemplate?.headerRowIndex,
      sheets: (existingTemplate?.sheets || []).map(sheet => ({
        ...sheet,
        columns: sheet.columns.some(existing => this.normalizeMetaAnalysisColumnIdentity(existing) === normalizedColumn)
          ? sheet.columns
          : [...sheet.columns, column],
      })),
    };
    await fs.promises.mkdir(this.getWikiDir(userId), { recursive: true });
    await fs.promises.writeFile(this.getMetaAnalysisTemplatePath(userId), JSON.stringify(payload, null, 2), 'utf-8');
    this.ensureMetaAnalysisUnitRegistryFromColumns(userId, [column], 'template');
    return column;
  }

  private async removeMetaAnalysisTemplateColumns(userId: string, columns: string[]): Promise<number> {
    const targetColumns = new Set(columns
      .filter(column => !this.isProtectedMetaAnalysisCodingColumn(column))
      .flatMap(column => [
        this.normalizeMetaAnalysisColumnIdentity(column),
        this.normalizeMetaAnalysisColumnKey(column),
      ]));
    if (targetColumns.size === 0) return 0;

    const existingTemplate = this.loadMetaAnalysisTemplate(userId);
    const baseColumns = existingTemplate?.columns.length
      ? existingTemplate.columns
      : [...PDF_WIKI_META_ANALYSIS_COLUMNS];
    const nextColumns = baseColumns.filter(column =>
      !targetColumns.has(this.normalizeMetaAnalysisColumnIdentity(column))
      && !targetColumns.has(this.normalizeMetaAnalysisColumnKey(column))
    );
    const removedCount = baseColumns.length - nextColumns.length;
    if (removedCount <= 0 && !existingTemplate) return 0;
    if (nextColumns.length === 0) {
      throw new Error('不能删除 Meta 编码表的全部字段');
    }

    const now = new Date().toISOString();
    const payload: PdfWikiMetaAnalysisTemplate = {
      filename: existingTemplate?.filename || 'auto-meta-analysis-template.json',
      columns: nextColumns,
      uploadedAt: existingTemplate?.uploadedAt || now,
      sheetName: existingTemplate?.sheetName || '',
      headerRowIndex: existingTemplate?.headerRowIndex,
      sheets: (existingTemplate?.sheets || []).map(sheet => ({
        ...sheet,
        columns: sheet.columns.filter(column =>
          !targetColumns.has(this.normalizeMetaAnalysisColumnIdentity(column))
          && !targetColumns.has(this.normalizeMetaAnalysisColumnKey(column))
        ),
      })).filter(sheet => sheet.columns.length > 0),
    };
    await fs.promises.mkdir(this.getWikiDir(userId), { recursive: true });
    await fs.promises.writeFile(this.getMetaAnalysisTemplatePath(userId), JSON.stringify(payload, null, 2), 'utf-8');
    return removedCount;
  }

  private loadMetaAnalysisTemplate(userId: string): PdfWikiMetaAnalysisTemplate | null {
    try {
      const templatePath = this.getMetaAnalysisTemplatePath(userId);
      if (!fs.existsSync(templatePath)) return null;
      const parsed = JSON.parse(fs.readFileSync(templatePath, 'utf-8')) as Partial<PdfWikiMetaAnalysisTemplate>;
      const columns = this.normalizeMetaAnalysisTemplateColumns(parsed.columns || []);
      if (columns.length === 0) return null;
      return {
        filename: String(parsed.filename || 'meta-template.xlsx'),
        columns,
        uploadedAt: String(parsed.uploadedAt || ''),
        sheetName: String(parsed.sheetName || ''),
        headerRowIndex: typeof parsed.headerRowIndex === 'number' ? parsed.headerRowIndex : undefined,
        sheets: Array.isArray(parsed.sheets)
          ? parsed.sheets.map(sheet => ({
              name: String(sheet?.name || ''),
              headerRowIndex: Number(sheet?.headerRowIndex || 0),
              columns: this.normalizeMetaAnalysisTemplateColumns(Array.isArray(sheet?.columns) ? sheet.columns : []),
              previewRows: Array.isArray(sheet?.previewRows)
                ? sheet.previewRows.slice(0, 8).map(row => Array.isArray(row) ? row.map(cell => this.stringifyTableCellValue(cell)) : [])
                : [],
              rowCount: Number(sheet?.rowCount || 0),
            })).filter(sheet => sheet.name && sheet.columns.length > 0)
          : [],
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to load Meta analysis template for ${userId}:`, error);
      return null;
    }
  }

  private getActiveMetaAnalysisColumns(userId: string): string[] {
    const template = this.loadMetaAnalysisTemplate(userId);
    return template?.columns.length ? template.columns : [...PDF_WIKI_META_ANALYSIS_COLUMNS];
  }

  private normalizeMetaAnalysisTemplateColumns(columns: string[]): string[] {
    const seen = new Map<string, number>();
    const output: string[] = [];
    columns.forEach((column) => {
      const base = this.stringifyTableCellValue(column).trim();
      if (!base) return;
      const count = seen.get(base) || 0;
      seen.set(base, count + 1);
      output.push(count > 0 ? `${base}_${count + 1}` : base);
    });
    return output;
  }

  private getBuiltInMetaAnalysisUnitStandards(): Record<string, string> {
    return {
      ninput: 'kg N ha-1',
      nitrogeninput: 'kg N ha-1',
      nrate: 'kg N ha-1',
      fertilizerrate: 'kg N ha-1',
      氮投入: 'kg N ha-1',
      施氮量: 'kg N ha-1',
      period: 'd',
      持续天数: 'd',
      duration: 'd',
      lat: 'degree',
      latitude: 'degree',
      long: 'degree',
      longitude: 'degree',
      实验期间土壤平均温度: '°C',
      实验期间空气平均温度: '°C',
      年均温: '°C',
      实验期间降水量: 'mm',
      灌溉量: 'mm',
      总纳水量: 'mm',
      年均降水量: 'mm',
      wfps: '%',
      whc: '%',
      bulkdensity: 'g cm-3',
      som: 'g kg-1',
      soc: 'g kg-1',
      tc: 'g kg-1',
      tn: 'g kg-1',
      nh4n: 'mg kg-1',
      no3n: 'mg kg-1',
      cumno: 'kg NO ha-1',
      nosd: 'kg NO ha-1',
      nockmean: 'kg NO ha-1',
      nocksd: 'kg NO ha-1',
      notmean: 'kg NO ha-1',
      notsd: 'kg NO ha-1',
      cumn2o: 'kg N2O ha-1',
      n2osd: 'kg N2O ha-1',
      n2ockmean: 'kg N2O ha-1',
      n2ocksd: 'kg N2O ha-1',
      n2otmean: 'kg N2O ha-1',
      n2otsd: 'kg N2O ha-1',
    };
  }

  private buildMetaAnalysisUnitRegistryEntry(base: string, unit: string, source: string, updatedAt: string): PdfWikiMetaAnalysisUnitRegistryEntry | null {
    const normalizedBase = this.stringifyTableCellValue(base).trim();
    const normalizedUnit = this.normalizeMetaAnalysisUnit(unit);
    if (!normalizedBase || !normalizedUnit || this.isUnitlessMetaAnalysisColumn(normalizedBase)) return null;
    return {
      base: normalizedBase,
      unit: normalizedUnit,
      source,
      updatedAt,
    };
  }

  private loadMetaAnalysisUnitRegistry(userId: string): PdfWikiMetaAnalysisUnitRegistry {
    const now = new Date().toISOString();
    const registry: PdfWikiMetaAnalysisUnitRegistry = {
      version: 1,
      updatedAt: now,
      columns: {},
    };

    const addEntry = (base: string, unit: string, source: string, overwrite: boolean): void => {
      const entry = this.buildMetaAnalysisUnitRegistryEntry(base, unit, source, now);
      if (!entry) return;
      const key = this.normalizeMetaAnalysisColumnKey(entry.base);
      if (!key) return;
      if (overwrite || !registry.columns[key]) registry.columns[key] = entry;
    };

    const builtIns = this.getBuiltInMetaAnalysisUnitStandards();
    Object.entries(builtIns).forEach(([baseKey, unit]) => addEntry(baseKey, unit, 'built-in', false));

    try {
      const registryPath = this.getMetaAnalysisUnitRegistryPath(userId);
      if (fs.existsSync(registryPath)) {
        const parsed = JSON.parse(fs.readFileSync(registryPath, 'utf-8')) as Partial<PdfWikiMetaAnalysisUnitRegistry>;
        Object.values(parsed.columns || {}).forEach(entry => {
          if (!entry) return;
          addEntry(entry.base, entry.unit, entry.source || 'registry', true);
        });
      }
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to load Meta analysis unit registry for ${userId}:`, error);
    }

    const template = this.loadMetaAnalysisTemplate(userId);
    const templateColumns = [
      ...(template?.columns || []),
      ...(template?.sheets || []).flatMap(sheet => sheet.columns || []),
    ];
    templateColumns.forEach(column => {
      const parsed = this.parseMetaAnalysisColumnUnit(column);
      if (parsed.unit) addEntry(parsed.base, parsed.unit, 'template', true);
    });

    return registry;
  }

  private saveMetaAnalysisUnitRegistry(userId: string, registry: PdfWikiMetaAnalysisUnitRegistry): void {
    try {
      fs.mkdirSync(this.getWikiDir(userId), { recursive: true });
      const payload: PdfWikiMetaAnalysisUnitRegistry = {
        version: 1,
        updatedAt: new Date().toISOString(),
        columns: registry.columns,
      };
      fs.writeFileSync(this.getMetaAnalysisUnitRegistryPath(userId), JSON.stringify(payload, null, 2), 'utf-8');
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to save Meta analysis unit registry for ${userId}:`, error);
    }
  }

  private ensureMetaAnalysisUnitRegistryFromColumns(userId: string, columns: string[], source: string): void {
    const registry = this.loadMetaAnalysisUnitRegistry(userId);
    const now = new Date().toISOString();
    let changed = false;
    columns.forEach(column => {
      const parsed = this.parseMetaAnalysisColumnUnit(column);
      if (!parsed.base || !parsed.unit) return;
      const entry = this.buildMetaAnalysisUnitRegistryEntry(parsed.base, parsed.unit, source, now);
      if (!entry) return;
      const key = this.normalizeMetaAnalysisColumnKey(entry.base);
      if (!key) return;
      const current = registry.columns[key];
      // The template overlay intentionally labels matching columns as "template"
      // in memory. Do not rewrite the registry merely to toggle that provenance
      // back to "extracted" on every Meta detail read; only data changes matter.
      if (!current || current.unit !== entry.unit || current.base !== entry.base) {
        registry.columns[key] = entry;
        changed = true;
      }
    });
    if (changed) this.saveMetaAnalysisUnitRegistry(userId, registry);
  }

  private async autoAssignExistingPdfGroups(
    userId: string,
    pdfs: PdfWikiSourcePdf[]
  ): Promise<PdfWikiAutoGroupMatchResult> {
    const safeUserId = sanitizeUserId(userId);
    const management = loadPdfWikiPdfManagement(this.dataDir, safeUserId);
    const additions: Record<string, string[]> = {};
    const matchedGroupNamesByPdf: Record<string, string[]> = {};
    let addedTagCount = 0;

    if (management.groups.length === 0 || pdfs.length === 0) {
      return { matchedPdfCount: 0, addedTagCount: 0, matchedGroupNamesByPdf };
    }

    const uniquePdfs = Array.from(new Map(
      pdfs
        .filter(pdf => !!pdf?.id)
        .map(pdf => [pdf.id, pdf])
    ).values());
    for (const pdf of uniquePdfs) {
      if (!pdf.processedAt && !pdf.parsedTextCachedAt && !pdf.metaDataCachedAt) continue;
      const metaData = this.asRecord(pdf.metaData);
      let abstractText = this.firstString(
        metaData.abstract,
        metaData.abstractText,
        metaData.abstract_text,
        metaData.paperAbstract,
        metaData.paper_abstract,
        metaData.summaryAbstract,
        metaData['摘要']
      );
      if (!abstractText) {
        try {
          const parsed = await this.loadParsedTextCache(safeUserId, pdf);
          abstractText = parsed
            ? this.extractSectionByHeading(
                parsed.text,
                ['abstract', '摘要'],
                ['keywords', 'key words', '关键词', 'introduction', '引言', 'materials', 'methods', '方法']
              ).slice(0, 2400)
            : '';
        } catch (error) {
          logger.debug(
            `[PdfWiki] Failed to read abstract cache for auto grouping ${pdf.originalName}: ${(error as Error).message}`
          );
        }
      }

      const searchText = [pdf.title, pdf.originalName, abstractText]
        .filter(Boolean)
        .join('\n');
      const currentGroupIds = new Set(management.assignments[pdf.id] || []);
      const matchedGroups = management.groups.filter(group =>
        !currentGroupIds.has(group.id)
        && matchesPdfWikiPdfGroupQuery(searchText, group.name)
      );
      if (matchedGroups.length === 0) continue;
      additions[pdf.id] = matchedGroups.map(group => group.id);
      matchedGroupNamesByPdf[pdf.id] = matchedGroups.map(group => group.name);
      addedTagCount += matchedGroups.length;
    }

    if (addedTagCount > 0) {
      addPdfWikiPdfGroupsToPdfs(this.dataDir, safeUserId, additions);
      logger.info(
        `[PdfWiki] Automatically grouped ${Object.keys(additions).length} recognized PDF(s); added tags=${addedTagCount}`
      );
    }
    return {
      matchedPdfCount: Object.keys(additions).length,
      addedTagCount,
      matchedGroupNamesByPdf,
    };
  }

  private recordPdfFigureExtraction(
    pdf: PdfWikiSourcePdf,
    result: { figureCount: number; sourceFigures: Record<string, unknown>[]; error?: string }
  ): void {
    const attemptedAt = new Date().toISOString();
    if (result.sourceFigures.length > 0 || !result.error) {
      pdf.metaData = {
        ...this.asRecord(pdf.metaData),
        source_figures: result.sourceFigures,
      };
    }
    pdf.metaDataCachedAt = attemptedAt;
    pdf.figureExtractionAttemptedAt = attemptedAt;
    pdf.figureExtractionStatus = result.error ? 'error' : 'completed';
    pdf.figureExtractionError = result.error || undefined;
  }

  private async recognizePdfForManager(
    userId: string,
    pdf: PdfWikiSourcePdf,
    options: { extractFigures: boolean }
  ): Promise<{ pdf: PdfWikiSourcePdf; figureCount: number; figureError?: string }> {
    let parsed = await this.loadParsedTextCache(userId, pdf)
      || await this.tryExtractPdfWithLiteParse(userId, pdf);
    if (!parsed) {
      try {
        const text = this.normalizeExtractedText(await this.extractPdfTextWithPdfParse(pdf.filePath));
        if (text) {
          const references = this.parseReferences(text, pdf.id, pdf.originalName);
          const metadata = await this.enrichSourceMetadataWithDoi(
            this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text)),
            text,
            pdf.originalName
          );
          parsed = {
            text,
            metadata,
            references,
            parser: 'pdf-parse',
          };
          await this.saveParsedTextCache(userId, pdf, {
            parser: 'pdf-parse',
            markdown: text,
            text,
            references,
            metadata,
          });
        }
      } catch (error) {
        logger.warn(
          `[PdfWiki] pdf-parse base recognition failed for ${pdf.originalName}: ${this.getErrorMessage(error)}`
        );
      }
    }
    if (!parsed || !parsed.text.trim()) {
      throw new Error('LiteParse 和 pdf-parse 均未提取到可用正文');
    }

    const recognitionWasComplete = Boolean(
      pdf.parsedTextCachedAt
      || (pdf.processedAt && (pdf.extractionParser || Number(pdf.textLength || 0) > 0))
    );
    const currentMetadata = this.cleanSourceMetadata(pdf);
    const metadata = this.mergePdfReidentifiedMetadata(pdf, parsed);
    if (recognitionWasComplete) {
      metadata.title = currentMetadata.title || metadata.title;
      metadata.authors = currentMetadata.authors || metadata.authors;
      metadata.year = currentMetadata.year || metadata.year;
      metadata.journal = currentMetadata.journal || metadata.journal;
      metadata.doi = currentMetadata.doi || metadata.doi;
    }
    Object.assign(pdf, metadata);
    pdf.referenceIndex = this.mergeReferenceIndexes(pdf.referenceIndex || [], parsed.references || []);
    pdf.textLength = parsed.text.length;
    pdf.extractionParser = parsed.parser;
    pdf.processedAt = new Date().toISOString();
    pdf.metaData = this.buildPdfMetaDataRecord(
      pdf,
      parsed,
      pdf.referenceIndex,
      this.asRecord(pdf.metaData)
    );
    pdf.metaDataCachedAt = pdf.processedAt;

    if (!options.extractFigures) {
      return { pdf, figureCount: 0 };
    }

    const existingFigures = this.filterScientificSourceFigures(
      this.firstArray(
        this.asRecord(pdf.metaData).source_figures,
        this.asRecord(pdf.metaData).sourceFigures
      )
    );
    if (existingFigures.length > 0) {
      pdf.figureExtractionStatus = 'completed';
      pdf.figureExtractionAttemptedAt = pdf.figureExtractionAttemptedAt
        || pdf.metaDataCachedAt
        || pdf.processedAt
        || new Date().toISOString();
      pdf.figureExtractionError = undefined;
      return { pdf, figureCount: existingFigures.length };
    }

    const figureResult = await this.extractPdfFiguresForManager(userId, pdf);
    this.recordPdfFigureExtraction(pdf, figureResult);
    return {
      pdf,
      figureCount: figureResult.figureCount,
      figureError: figureResult.error,
    };
  }

  private async recognizeAndPersistPdfsForManager(
    userId: string,
    pdfs: PdfWikiSourcePdf[],
    options: { extractFigures: boolean }
  ): Promise<PdfWikiManagerRecognitionBatchResult> {
    const safeUserId = sanitizeUserId(userId);
    const store = await this.loadStore(safeUserId);
    const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
    const recognizedPdfs: PdfWikiSourcePdf[] = [];
    const failedPdfs: PdfWikiManagerRecognitionBatchResult['failedPdfs'] = [];
    let figureCount = 0;

    for (const sourcePdf of pdfs) {
      const existing = pdfById.get(sourcePdf.id);
      const pdf: PdfWikiSourcePdf = existing
        ? {
            ...sourcePdf,
            ...existing,
            originalName: existing.originalName || sourcePdf.originalName,
            fileName: existing.fileName || sourcePdf.fileName,
            filePath: existing.filePath && fs.existsSync(existing.filePath)
              ? existing.filePath
              : sourcePdf.filePath,
            size: existing.size || sourcePdf.size,
          }
        : sourcePdf;
      try {
        const recognition = await this.recognizePdfForManager(safeUserId, pdf, options);
        pdfById.set(pdf.id, recognition.pdf);
        Object.assign(sourcePdf, recognition.pdf);
        recognizedPdfs.push(recognition.pdf);
        figureCount += recognition.figureCount;
        if (recognition.figureError) {
          logger.warn(
            `[PdfWiki] PDF manager image recognition warning for ${pdf.originalName}: ${recognition.figureError}`
          );
        }
      } catch (error) {
        const message = this.getErrorMessage(error);
        pdfById.set(pdf.id, pdf);
        failedPdfs.push({
          pdfId: pdf.id,
          pdfName: pdf.originalName,
          error: message,
        });
        logger.warn(`[PdfWiki] Base recognition failed for ${pdf.originalName}: ${message}`);
      }
    }

    store.pdfs = this.deduplicatePdfs(Array.from(pdfById.values()));
    store.referenceIndex = this.mergeReferenceIndexes(
      store.referenceIndex || [],
      ...store.pdfs.map(pdf => pdf.referenceIndex || [])
    );
    store.generatedAt = new Date().toISOString();
    await this.saveStore(safeUserId, store);
    this.clearEngine(safeUserId);
    this.removeIndexCache(safeUserId);

    return { recognizedPdfs, failedPdfs, figureCount };
  }

  async processUploadedPdfs(
    userId: string,
    files: UploadedPdfFile[],
    llmConfig: PdfWikiLlmConfig
  ): Promise<void> {
    if (files.length === 0) return;

    const safeUserId = sanitizeUserId(userId);
    await this.runExclusiveBuild(safeUserId, async () => {
      const pdfs = await this.registerPdfFiles(safeUserId, files);
      const existing = await this.loadStore(safeUserId);
      const existingPdfIds = new Set(existing.pdfs.map(pdf => pdf.id));
      const pdfIdsWithEntries = new Set(existing.entries.flatMap(entry => entry.sourcePdfIds));
      const pdfIdsWithSentencePoints = new Set((existing.sentenceCloud?.points || []).map(point => point.sourcePdfId));
      const newSourcePdfs = pdfs.filter(pdf => !existingPdfIds.has(pdf.id));
      if (newSourcePdfs.length > 0) {
        existing.pdfs = [...existing.pdfs, ...newSourcePdfs];
        existing.generatedAt = new Date().toISOString();
        await this.saveStore(safeUserId, existing);
        newSourcePdfs.forEach(pdf => existingPdfIds.add(pdf.id));
      }
      const pending = pdfs.filter(pdf => !existingPdfIds.has(pdf.id) || (!pdfIdsWithEntries.has(pdf.id) && !pdfIdsWithSentencePoints.has(pdf.id)));

      if (pending.length === 0) {
        await this.saveStatus(safeUserId, {
          status: 'completed',
          totalPdfs: existing.pdfs.length,
          processedPdfs: existing.pdfs.length,
          totalChunks: 0,
          processedChunks: 0,
          entryCount: existing.entries.length,
          sentencePointCount: existing.sentenceCloud?.points?.length || 0,
          message: '上传的 PDF 已存在于 PDF Wiki 中，且已有对应 Wiki论点库',
          updatedAt: new Date().toISOString(),
        });
        return;
      }

      await this.saveStatus(safeUserId, {
        status: 'processing',
        taskKind: 'pdf-wiki',
        totalPdfs: pending.length,
        processedPdfs: 0,
        totalChunks: pending.length,
        processedChunks: 0,
        entryCount: existing.entries.length,
        sentencePointCount: existing.sentenceCloud?.points?.length || 0,
        message: '正在进行 PDF 基础识别并保存标题、作者、正文和参考文献',
        updatedAt: new Date().toISOString(),
      });
      const initialRecognition = await this.recognizeAndPersistPdfsForManager(
        safeUserId,
        pending,
        { extractFigures: false }
      );
      logger.info(
        `[PdfWiki] Persisted base recognition before Wiki build: recognized=${initialRecognition.recognizedPdfs.length}, failed=${initialRecognition.failedPdfs.length}`
      );

      try {
        await this.buildWiki(safeUserId, pending, llmConfig, false);
      } finally {
        const finalRecognition = await this.recognizeAndPersistPdfsForManager(
          safeUserId,
          pending,
          { extractFigures: true }
        );
        const pendingPdfIds = new Set(pending.map(pdf => pdf.id));
        const refreshedStore = await this.loadStore(safeUserId);
        await this.autoAssignExistingPdfGroups(
          safeUserId,
          refreshedStore.pdfs.filter(pdf => pendingPdfIds.has(pdf.id))
        );
        logger.info(
          `[PdfWiki] Completed PDF manager recognition after Wiki build attempt: recognized=${finalRecognition.recognizedPdfs.length}, failed=${finalRecognition.failedPdfs.length}, figures=${finalRecognition.figureCount}`
        );
      }
    });
  }

  async enqueueUploadedPdfs(
    userId: string,
    files: UploadedPdfFile[],
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiQueueSnapshot> {
    const safeUserId = sanitizeUserId(userId);
    const candidates = files.map(file => ({
      originalname: String(file.originalname || path.basename(file.path || 'document.pdf')),
      path: path.resolve(String(file.path || '')),
      size: Math.max(0, Number(file.size || 0)),
      sha256: String(file.sha256 || '').toLowerCase(),
    })).filter(file => file.path && fs.existsSync(file.path));
    if (candidates.length === 0) {
      throw new Error('没有可加入 PDF 队列的本地文件');
    }

    const knownHashes = await this.collectKnownPdfHashPrefixes(safeUserId);
    const batchHashes = new Set<string>();
    const persistentFiles: PdfWikiQueueJob['files'] = [];
    let skippedDuplicatePdfs = 0;
    for (const file of candidates) {
      const sha256 = /^[a-f0-9]{64}$/.test(file.sha256)
        ? file.sha256
        : await this.calculateFileSha256(file.path);
      if (this.isKnownPdfHash(sha256, knownHashes) || batchHashes.has(sha256)) {
        skippedDuplicatePdfs++;
        continue;
      }
      batchHashes.add(sha256);
      persistentFiles.push({ ...file, sha256 });
    }
    if (persistentFiles.length === 0) {
      return { ...(await this.getQueueSnapshot(safeUserId)), addedPdfs: 0, addedJobIds: [], skippedDuplicatePdfs };
    }

    const now = new Date().toISOString();
    const jobId = `pdfq_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
    await this.mutateQueue(safeUserId, queue => {
      queue.jobs.push({
        id: jobId,
        status: 'queued',
        files: persistentFiles,
        taskConfig: this.sanitizeQueueTaskConfig(llmConfig),
        createdAt: now,
        updatedAt: now,
      });
      queue.jobs = this.pruneQueueJobs(queue.jobs);
    });
    this.startQueueWorker(safeUserId);
    return {
      ...(await this.getQueueSnapshot(safeUserId)),
      addedPdfs: persistentFiles.length,
      addedJobIds: [jobId],
      skippedDuplicatePdfs,
    };
  }

  async matchUploadedPdfHashes(
    userId: string,
    files: Array<{ name: string; size?: number; sha256: string }>
  ): Promise<{ duplicates: Array<{ name: string; size: number; sha256: string }>; newFiles: Array<{ name: string; size: number; sha256: string }> }> {
    const knownHashes = await this.collectKnownPdfHashPrefixes(sanitizeUserId(userId));
    const seen = new Set<string>();
    const duplicates: Array<{ name: string; size: number; sha256: string }> = [];
    const newFiles: Array<{ name: string; size: number; sha256: string }> = [];
    for (const file of files.slice(0, 50)) {
      const normalized = {
        name: String(file.name || 'document.pdf').slice(0, 240),
        size: Math.max(0, Number(file.size || 0)),
        sha256: String(file.sha256 || '').trim().toLowerCase(),
      };
      if (!/^[a-f0-9]{64}$/.test(normalized.sha256)) continue;
      if (this.isKnownPdfHash(normalized.sha256, knownHashes) || seen.has(normalized.sha256)) {
        duplicates.push(normalized);
      } else {
        newFiles.push(normalized);
        seen.add(normalized.sha256);
      }
    }
    return { duplicates, newFiles };
  }

  private async collectKnownPdfHashPrefixes(userId: string): Promise<Set<string>> {
    const prefixes = new Set<string>();
    const [store, queue] = await Promise.all([this.loadStore(userId), this.loadQueue(userId)]);
    for (const pdf of store.pdfs) {
      const match = String(pdf.id || '').match(/^pdf_([a-f0-9]{16,64})$/i);
      if (match) prefixes.add(match[1].toLowerCase());
    }
    for (const job of queue.jobs) {
      if (job.status !== 'queued' && job.status !== 'running') continue;
      for (const file of job.files) {
        const hash = String(file.sha256 || '').toLowerCase();
        if (/^[a-f0-9]{64}$/.test(hash)) prefixes.add(hash);
      }
    }
    try {
      const sourceNames = await fs.promises.readdir(this.getSourcePdfDir(userId));
      for (const name of sourceNames) {
        const match = name.match(/^([a-f0-9]{16})-/i);
        if (match) prefixes.add(match[1].toLowerCase());
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return prefixes;
  }

  private isKnownPdfHash(hash: string, prefixes: Set<string>): boolean {
    const normalized = String(hash || '').toLowerCase();
    for (const prefix of prefixes) {
      if (normalized.startsWith(prefix) || prefix.startsWith(normalized)) return true;
    }
    return false;
  }

  private async calculateFileSha256(filePath: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', reject);
      stream.on('data', chunk => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  async getQueueSnapshot(userId: string): Promise<PdfWikiQueueSnapshot> {
    const queue = await this.loadQueue(sanitizeUserId(userId));
    const visibleJobs = queue.jobs.slice(-100).reverse();
    return {
      queuedJobs: queue.jobs.filter(job => job.status === 'queued').length,
      runningJobs: queue.jobs.filter(job => job.status === 'running').length,
      completedJobs: queue.jobs.filter(job => job.status === 'completed').length,
      failedJobs: queue.jobs.filter(job => job.status === 'error').length,
      queuedPdfs: queue.jobs.filter(job => job.status === 'queued').reduce((sum, job) => sum + job.files.length, 0),
      runningPdfs: queue.jobs.filter(job => job.status === 'running').reduce((sum, job) => sum + job.files.length, 0),
      jobs: visibleJobs,
    };
  }

  async enqueuePdfRecognition(
    userId: string,
    requestedItems: Array<{ pdfId: string; mode?: PdfWikiRecognitionQueueMode }>
  ): Promise<PdfWikiRecognitionQueueSnapshot> {
    const safeUserId = sanitizeUserId(userId);
    const store = await this.loadStore(safeUserId);
    const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
    const requestedByPdfId = new Map<string, PdfWikiRecognitionQueueMode>();
    for (const item of Array.isArray(requestedItems) ? requestedItems : []) {
      const pdfId = String(item?.pdfId || '').trim();
      if (!pdfId) continue;
      requestedByPdfId.set(pdfId, item?.mode === 'images-only' ? 'images-only' : 'full');
    }
    if (requestedByPdfId.size === 0) {
      throw new Error('没有可加入识别队列的 PDF');
    }

    let addedItems = 0;
    let skippedActiveItems = 0;
    let skippedMissingItems = 0;
    const addedJobIds: string[] = [];
    await this.mutateRecognitionQueue(safeUserId, queue => {
      const activePdfIds = new Set(
        queue.jobs
          .filter(job => job.status === 'queued' || job.status === 'running')
          .flatMap(job => job.items)
          .filter(item => item.status === 'queued' || item.status === 'running')
          .map(item => item.pdfId)
      );
      const now = new Date().toISOString();
      const items: PdfWikiRecognitionQueueItem[] = [];
      for (const [pdfId, mode] of requestedByPdfId.entries()) {
        const pdf = pdfById.get(pdfId);
        if (!pdf) {
          skippedMissingItems++;
          continue;
        }
        if (activePdfIds.has(pdfId)) {
          skippedActiveItems++;
          continue;
        }
        items.push({
          pdfId,
          pdfName: pdf.title || pdf.originalName || pdf.fileName || pdfId,
          mode,
          status: 'queued',
          createdAt: now,
          updatedAt: now,
        });
      }
      if (items.length > 0) {
        const jobId = `pdfr_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
        queue.jobs.push({
          id: jobId,
          status: 'queued',
          items,
          createdAt: now,
          updatedAt: now,
        });
        addedItems = items.length;
        addedJobIds.push(jobId);
      }
      queue.jobs = this.pruneRecognitionQueueJobs(queue.jobs);
    });
    if (addedItems > 0) this.startRecognitionQueueWorker(safeUserId);
    return {
      ...(await this.getRecognitionQueueSnapshot(safeUserId)),
      addedItems,
      addedJobIds,
      skippedActiveItems,
      skippedMissingItems,
    };
  }

  async getRecognitionQueueSnapshot(userId: string): Promise<PdfWikiRecognitionQueueSnapshot> {
    const queue = await this.loadRecognitionQueue(sanitizeUserId(userId));
    const jobs = queue.jobs.slice(-50).reverse();
    const allItems = queue.jobs.flatMap(job => job.items);
    const activeJob = queue.jobs.find(job => job.status === 'running')
      || queue.jobs.find(job => job.status === 'queued');
    return {
      queuedJobs: queue.jobs.filter(job => job.status === 'queued').length,
      runningJobs: queue.jobs.filter(job => job.status === 'running').length,
      completedJobs: queue.jobs.filter(job => job.status === 'completed').length,
      failedJobs: queue.jobs.filter(job => job.status === 'error').length,
      queuedItems: allItems.filter(item => item.status === 'queued').length,
      runningItems: allItems.filter(item => item.status === 'running').length,
      completedItems: allItems.filter(item => item.status === 'completed').length,
      failedItems: allItems.filter(item => item.status === 'error').length,
      activeJobId: activeJob?.id,
      jobs,
    };
  }

  async recoverPersistentQueues(): Promise<void> {
    const uploadsDir = path.join(this.dataDir, 'uploads');
    let userIds: string[] = [];
    try {
      userIds = (await fs.promises.readdir(uploadsDir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => sanitizeUserId(entry.name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return;
    }

    for (const userId of userIds) {
      if (fs.existsSync(this.getQueuePath(userId))) {
        await this.mutateQueue(userId, queue => {
          const now = new Date().toISOString();
          for (const job of queue.jobs) {
            if (job.status !== 'running') continue;
            job.status = 'queued';
            job.updatedAt = now;
            job.error = '软件上次退出时任务尚未完成，现已自动恢复排队';
            delete job.startedAt;
          }
        });
        this.startQueueWorker(userId);
      }
      if (fs.existsSync(this.getRecognitionQueuePath(userId))) {
        await this.mutateRecognitionQueue(userId, queue => {
          const now = new Date().toISOString();
          for (const job of queue.jobs) {
            let recovered = false;
            for (const item of job.items) {
              if (item.status !== 'running') continue;
              item.status = 'queued';
              item.updatedAt = now;
              item.error = '软件上次退出时识别尚未完成，现已自动恢复排队';
              delete item.startedAt;
              recovered = true;
            }
            if (recovered || job.status === 'running') {
              job.status = 'queued';
              job.updatedAt = now;
              job.error = '软件上次退出时识别尚未完成，现已自动恢复排队';
              delete job.startedAt;
            }
          }
        });
        this.startRecognitionQueueWorker(userId);
      }
    }
  }

  private startQueueWorker(userId: string): void {
    const safeUserId = sanitizeUserId(userId);
    if (this.queueWorkers.has(safeUserId)) return;
    const worker = this.runQueueWorker(safeUserId)
      .catch(error => logger.error(`[PdfWikiQueue] Worker failed for ${safeUserId}:`, error))
      .finally(() => {
        if (this.queueWorkers.get(safeUserId) === worker) {
          this.queueWorkers.delete(safeUserId);
        }
      });
    this.queueWorkers.set(safeUserId, worker);
  }

  private async runQueueWorker(userId: string): Promise<void> {
    while (true) {
      let nextJob: PdfWikiQueueJob | null = null;
      await this.mutateQueue(userId, queue => {
        const candidate = queue.jobs.find(job => job.status === 'queued');
        if (!candidate) return;
        const now = new Date().toISOString();
        candidate.status = 'running';
        candidate.startedAt = now;
        candidate.updatedAt = now;
        delete candidate.completedAt;
        delete candidate.error;
        nextJob = JSON.parse(JSON.stringify(candidate)) as PdfWikiQueueJob;
      });
      if (!nextJob) return;

      const job = nextJob as PdfWikiQueueJob;
      try {
        const missingFiles = job.files.filter(file => !fs.existsSync(file.path));
        if (missingFiles.length > 0) {
          throw new Error(`队列源文件不存在：${missingFiles.map(file => file.originalname).join('、')}`);
        }
        const runtime = this.queueRuntimeConfigProvider?.() || ({ apiUrl: '', apiKey: '', model: '' } as PdfWikiLlmConfig);
        const llmConfig: PdfWikiLlmConfig = {
          ...runtime,
          ...job.taskConfig,
          apiUrl: runtime.apiUrl,
          apiKey: runtime.apiKey,
          jsonApiUrl: runtime.jsonApiUrl,
          jsonApiKey: runtime.jsonApiKey,
          textInApiUrl: runtime.textInApiUrl,
          textInAppId: runtime.textInAppId,
          textInSecretCode: runtime.textInSecretCode,
        };
        await this.processUploadedPdfs(userId, job.files, llmConfig);
        const status = await this.getStatusWithoutQueue(userId);
        if (status.status === 'error') {
          throw new Error(status.error || status.message || 'PDF Wiki 处理失败');
        }
        await this.finishQueueJob(userId, job.id, 'completed');
      } catch (error) {
        const message = (error as Error).message || String(error);
        logger.error(`[PdfWikiQueue] Job ${job.id} failed:`, error);
        await this.finishQueueJob(userId, job.id, 'error', message);
      }
    }
  }

  private async finishQueueJob(userId: string, jobId: string, status: 'completed' | 'error', error?: string): Promise<void> {
    await this.mutateQueue(userId, queue => {
      const job = queue.jobs.find(item => item.id === jobId);
      if (!job) return;
      const now = new Date().toISOString();
      job.status = status;
      job.updatedAt = now;
      job.completedAt = now;
      job.error = error;
      queue.jobs = this.pruneQueueJobs(queue.jobs);
    });
  }

  private sanitizeQueueTaskConfig(config: PdfWikiLlmConfig): Partial<PdfWikiLlmConfig> {
    return {
      processingProfile: config.processingProfile,
      textExtractionEngine: config.textExtractionEngine,
      metadataEngine: config.metadataEngine,
      claimExtractionEngine: config.claimExtractionEngine,
      sentenceReferenceMatchingEngine: config.sentenceReferenceMatchingEngine,
      groupingEngine: config.groupingEngine,
      deepAnalysisEngine: config.deepAnalysisEngine,
      metaAnalysisEnabled: config.metaAnalysisEnabled,
      metaAnalysisEngine: config.metaAnalysisEngine,
      metaAnalysisUserRequirements: config.metaAnalysisUserRequirements,
      model: config.model,
      jsonModel: config.jsonModel,
      ocrModel: config.ocrModel,
      visionModel: config.visionModel,
      textInParseMode: config.textInParseMode,
      dedicated: config.dedicated,
    };
  }

  private pruneQueueJobs(jobs: PdfWikiQueueJob[]): PdfWikiQueueJob[] {
    const active = jobs.filter(job => job.status === 'queued' || job.status === 'running');
    const history = jobs.filter(job => job.status === 'completed' || job.status === 'error').slice(-100);
    return [...history, ...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async loadQueue(userId: string): Promise<PdfWikiQueueStore> {
    const safeUserId = sanitizeUserId(userId);
    const queuePath = this.getQueuePath(safeUserId);
    try {
      const parsed = JSON.parse(await fs.promises.readFile(queuePath, 'utf-8')) as Partial<PdfWikiQueueStore>;
      return {
        version: 1,
        userId: safeUserId,
        updatedAt: String(parsed.updatedAt || new Date().toISOString()),
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[PdfWikiQueue] Failed to read queue for ${safeUserId}:`, error);
      }
      return { version: 1, userId: safeUserId, updatedAt: new Date().toISOString(), jobs: [] };
    }
  }

  private async mutateQueue(userId: string, mutation: (queue: PdfWikiQueueStore) => void): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    const previous = this.queueMutationLocks.get(safeUserId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const queue = await this.loadQueue(safeUserId);
      mutation(queue);
      queue.updatedAt = new Date().toISOString();
      await this.writeJsonAtomic(this.getQueuePath(safeUserId), queue);
    });
    this.queueMutationLocks.set(safeUserId, current);
    try {
      await current;
    } finally {
      if (this.queueMutationLocks.get(safeUserId) === current) {
        this.queueMutationLocks.delete(safeUserId);
      }
    }
  }

  private startRecognitionQueueWorker(userId: string): void {
    const safeUserId = sanitizeUserId(userId);
    if (this.recognitionQueueWorkers.has(safeUserId)) return;
    const worker = this.runRecognitionQueueWorker(safeUserId)
      .catch(error => logger.error(`[PdfWikiRecognitionQueue] Worker failed for ${safeUserId}:`, error))
      .finally(() => {
        if (this.recognitionQueueWorkers.get(safeUserId) === worker) {
          this.recognitionQueueWorkers.delete(safeUserId);
        }
      });
    this.recognitionQueueWorkers.set(safeUserId, worker);
  }

  private async runRecognitionQueueWorker(userId: string): Promise<void> {
    while (true) {
      let next: { jobId: string; item: PdfWikiRecognitionQueueItem } | null = null;
      await this.mutateRecognitionQueue(userId, queue => {
        const job = queue.jobs.find(candidate => (
          candidate.status === 'queued'
          || candidate.status === 'running'
        ) && candidate.items.some(item => item.status === 'queued'));
        if (!job) return;
        const item = job.items.find(candidate => candidate.status === 'queued');
        if (!item) return;
        const now = new Date().toISOString();
        job.status = 'running';
        job.startedAt = job.startedAt || now;
        job.updatedAt = now;
        delete job.completedAt;
        delete job.error;
        item.status = 'running';
        item.startedAt = now;
        item.updatedAt = now;
        delete item.completedAt;
        delete item.error;
        next = {
          jobId: job.id,
          item: JSON.parse(JSON.stringify(item)) as PdfWikiRecognitionQueueItem,
        };
      });
      if (!next) return;

      const claimed = next as { jobId: string; item: PdfWikiRecognitionQueueItem };
      try {
        const result = claimed.item.mode === 'images-only'
          ? await this.ensurePdfFiguresForManager(userId, claimed.item.pdfId, { force: true })
          : await this.reidentifyPdfWithLiteParse(userId, claimed.item.pdfId);
        await this.finishRecognitionQueueItem(
          userId,
          claimed.jobId,
          claimed.item.pdfId,
          'completed',
          'figureCount' in result ? Number(result.figureCount || 0) : 0
        );
      } catch (error) {
        const message = (error as Error).message || String(error);
        logger.error(
          `[PdfWikiRecognitionQueue] ${claimed.item.mode} failed for ${claimed.item.pdfId}:`,
          error
        );
        await this.finishRecognitionQueueItem(
          userId,
          claimed.jobId,
          claimed.item.pdfId,
          'error',
          undefined,
          message
        );
      }
    }
  }

  private async finishRecognitionQueueItem(
    userId: string,
    jobId: string,
    pdfId: string,
    status: 'completed' | 'error',
    figureCount?: number,
    error?: string
  ): Promise<void> {
    await this.mutateRecognitionQueue(userId, queue => {
      const job = queue.jobs.find(candidate => candidate.id === jobId);
      const item = job?.items.find(candidate => candidate.pdfId === pdfId && candidate.status === 'running');
      if (!job || !item) return;
      const now = new Date().toISOString();
      item.status = status;
      item.updatedAt = now;
      item.completedAt = now;
      item.figureCount = figureCount;
      item.error = error;
      const pending = job.items.some(candidate => candidate.status === 'queued' || candidate.status === 'running');
      const failedCount = job.items.filter(candidate => candidate.status === 'error').length;
      if (pending) {
        job.status = 'running';
      } else {
        job.status = failedCount === job.items.length ? 'error' : 'completed';
        job.completedAt = now;
        job.error = failedCount > 0 ? `${failedCount} 个 PDF 识别失败` : undefined;
      }
      job.updatedAt = now;
      queue.jobs = this.pruneRecognitionQueueJobs(queue.jobs);
    });
  }

  private pruneRecognitionQueueJobs(jobs: PdfWikiRecognitionQueueJob[]): PdfWikiRecognitionQueueJob[] {
    const active = jobs.filter(job => job.status === 'queued' || job.status === 'running');
    const history = jobs.filter(job => job.status === 'completed' || job.status === 'error').slice(-50);
    return [...history, ...active].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  private async loadRecognitionQueue(userId: string): Promise<PdfWikiRecognitionQueueStore> {
    const safeUserId = sanitizeUserId(userId);
    try {
      const parsed = JSON.parse(
        await fs.promises.readFile(this.getRecognitionQueuePath(safeUserId), 'utf-8')
      ) as Partial<PdfWikiRecognitionQueueStore>;
      return {
        version: 1,
        userId: safeUserId,
        updatedAt: String(parsed.updatedAt || new Date().toISOString()),
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[PdfWikiRecognitionQueue] Failed to read queue for ${safeUserId}:`, error);
      }
      return { version: 1, userId: safeUserId, updatedAt: new Date().toISOString(), jobs: [] };
    }
  }

  private async mutateRecognitionQueue(
    userId: string,
    mutation: (queue: PdfWikiRecognitionQueueStore) => void
  ): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    const previous = this.recognitionQueueMutationLocks.get(safeUserId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(async () => {
      const queue = await this.loadRecognitionQueue(safeUserId);
      mutation(queue);
      queue.updatedAt = new Date().toISOString();
      await this.writeJsonAtomic(this.getRecognitionQueuePath(safeUserId), queue);
    });
    this.recognitionQueueMutationLocks.set(safeUserId, current);
    try {
      await current;
    } finally {
      if (this.recognitionQueueMutationLocks.get(safeUserId) === current) {
        this.recognitionQueueMutationLocks.delete(safeUserId);
      }
    }
  }

  async registerUploadedPdfsWithLiteParse(
    userId: string,
    files: UploadedPdfFile[]
  ): Promise<PdfWikiLiteRegisterResult> {
    const safeUserId = sanitizeUserId(userId);
    if (files.length === 0) {
      return {
        pdfs: [],
        uploadedCount: 0,
        parsedCount: 0,
        failedCount: 0,
        referenceCount: 0,
        figureCount: 0,
        figureErrors: [],
        errors: [],
        message: '没有需要识别的 PDF',
      };
    }

    let result: PdfWikiLiteRegisterResult | null = null;
    await this.runExclusiveBuild(safeUserId, async () => {
      const startedAt = new Date().toISOString();
      await this.saveStatus(safeUserId, {
        status: 'processing',
        totalPdfs: files.length,
        processedPdfs: 0,
        totalChunks: files.length,
        processedChunks: 0,
        entryCount: 0,
        sentencePointCount: 0,
        message: '正在使用 LiteParse 快速识别 PDF 文献信息',
        startedAt,
        updatedAt: startedAt,
      });

      const uploadedPdfs = await this.registerPdfFiles(safeUserId, files);
      const store = await this.loadStore(safeUserId);
      const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
      const errors: PdfWikiLiteRegisterResult['errors'] = [];
      const figureErrors: PdfWikiLiteRegisterResult['figureErrors'] = [];
      let parsedCount = 0;
      let figureCount = 0;
      let processedCount = 0;

      for (const uploadedPdf of uploadedPdfs) {
        const existing = pdfById.get(uploadedPdf.id);
        const pdf: PdfWikiSourcePdf = existing
          ? {
              ...uploadedPdf,
              ...existing,
              originalName: existing.originalName || uploadedPdf.originalName,
              fileName: existing.fileName || uploadedPdf.fileName,
              filePath: existing.filePath && fs.existsSync(existing.filePath) ? existing.filePath : uploadedPdf.filePath,
              size: existing.size || uploadedPdf.size,
              metaExcluded: existing.metaExcluded === false ? false : true,
            }
          : { ...uploadedPdf, metaExcluded: true };

        pdfById.set(pdf.id, pdf);

        try {
          await this.saveStatus(safeUserId, {
            status: 'processing',
            totalPdfs: uploadedPdfs.length,
            processedPdfs: processedCount,
            totalChunks: uploadedPdfs.length,
            processedChunks: processedCount,
            entryCount: store.entries.length,
            sentencePointCount: store.sentenceCloud?.points?.length || 0,
            figureCount,
            message: `正在使用 LiteParse 识别 PDF 正文和文献信息（${processedCount + 1}/${uploadedPdfs.length}）：${pdf.originalName}`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });

          let parsed = await this.tryExtractPdfWithLiteParse(safeUserId, pdf);
          if (!parsed) {
            const text = this.normalizeExtractedText(await this.extractPdfTextWithPdfParse(pdf.filePath));
            const references = this.parseReferences(text, pdf.id, pdf.originalName);
            const metadata = await this.enrichSourceMetadataWithDoi(this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text)), text, pdf.originalName);
            parsed = {
              text,
              metadata,
              references,
              parser: 'pdf-parse',
            };
            await this.saveParsedTextCache(safeUserId, pdf, {
              parser: 'pdf-parse',
              markdown: text,
              text,
              references,
              metadata,
            });
          }

          const metadata = this.mergePdfReidentifiedMetadata(pdf, parsed);
          Object.assign(pdf, metadata);
          pdf.referenceIndex = this.mergeReferenceIndexes(pdf.referenceIndex || [], parsed.references || []);
          pdf.textLength = parsed.text.length;
          pdf.extractionParser = parsed.parser;
          pdf.processedAt = new Date().toISOString();
          pdf.metaData = this.buildPdfMetaDataRecord(pdf, parsed, pdf.referenceIndex, pdf.metaData || {});
          pdf.metaDataCachedAt = pdf.processedAt;

          await this.saveStatus(safeUserId, {
            status: 'processing',
            totalPdfs: uploadedPdfs.length,
            processedPdfs: processedCount,
            totalChunks: uploadedPdfs.length,
            processedChunks: processedCount,
            entryCount: store.entries.length,
            sentencePointCount: store.sentenceCloud?.points?.length || 0,
            figureCount,
            message: `正在提取 PDF 图片（${processedCount + 1}/${uploadedPdfs.length}）：${pdf.originalName}`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });

          const figureResult = await this.extractPdfFiguresForManager(safeUserId, pdf);
          figureCount += figureResult.figureCount;
          logger.info(`[PdfWiki] Extracted figures for ${pdf.originalName}: figures=${figureResult.figureCount}${figureResult.error ? `, warning=${figureResult.error}` : ''}`);
          this.recordPdfFigureExtraction(pdf, figureResult);
          if (figureResult.error) {
            figureErrors.push({
              pdfId: pdf.id,
              pdfName: pdf.originalName,
              error: figureResult.error,
            });
          }
          parsedCount += 1;
        } catch (error) {
          const message = (error as Error).message || String(error);
          errors.push({
            pdfId: pdf.id,
            pdfName: pdf.originalName,
            error: message,
          });
          logger.warn(`[PdfWiki] LiteParse lite registration failed for ${pdf.originalName}: ${message}`);
        }

        processedCount += 1;
        await this.saveStatus(safeUserId, {
          status: 'processing',
          totalPdfs: uploadedPdfs.length,
          processedPdfs: processedCount,
          totalChunks: uploadedPdfs.length,
          processedChunks: processedCount,
          entryCount: store.entries.length,
          sentencePointCount: store.sentenceCloud?.points?.length || 0,
          figureCount,
          message: `正在使用 LiteParse 快速识别 PDF 文献信息和图片（${processedCount}/${uploadedPdfs.length}）`,
          startedAt,
          updatedAt: new Date().toISOString(),
        });
      }

      const allPdfs = this.deduplicatePdfs(Array.from(pdfById.values()));
      const uploadedPdfIds = new Set(uploadedPdfs.map(pdf => pdf.id));
      const uploadedStoredPdfs = allPdfs.filter(pdf => uploadedPdfIds.has(pdf.id));
      const referenceIndex = this.mergeReferenceIndexes(
        store.referenceIndex || [],
        ...allPdfs.map(pdf => pdf.referenceIndex || [])
      );
      const generatedAt = new Date().toISOString();

      await this.saveStore(safeUserId, {
        ...store,
        pdfs: allPdfs,
        referenceIndex,
        generatedAt,
      });
      this.clearEngine(safeUserId);
      this.removeIndexCache(safeUserId);

      const autoGroupMatch = await this.autoAssignExistingPdfGroups(safeUserId, uploadedStoredPdfs);
      const referenceCount = uploadedStoredPdfs.reduce((sum, pdf) => sum + (pdf.referenceIndex?.length || 0), 0);
      const autoGroupMessage = autoGroupMatch.addedTagCount > 0
        ? `；自动归类 ${autoGroupMatch.matchedPdfCount} 篇，新增 ${autoGroupMatch.addedTagCount} 个标签`
        : '';
      result = {
        pdfs: uploadedStoredPdfs,
        uploadedCount: uploadedPdfs.length,
        parsedCount,
        failedCount: errors.length,
        referenceCount,
        figureCount,
        figureErrors,
        errors,
        message: `LiteParse 快速识别完成：${parsedCount}/${uploadedPdfs.length} 个 PDF 已提取文献信息和图片，图片 ${figureCount} 张${autoGroupMessage}`,
        autoGroupMatch,
      };

      await this.saveStatus(safeUserId, {
        status: errors.length === uploadedPdfs.length ? 'error' : 'completed',
        totalPdfs: allPdfs.length,
        processedPdfs: allPdfs.length,
        failedPdfs: errors.length,
        totalChunks: uploadedPdfs.length,
        processedChunks: uploadedPdfs.length,
        entryCount: store.entries.length,
        sentencePointCount: store.sentenceCloud?.points?.length || 0,
        figureCount,
        message: result.message + (errors.length > 0 ? `；${errors.length} 个 PDF 需要人工检查` : ''),
        startedAt,
        updatedAt: generatedAt,
        error: errors.length === uploadedPdfs.length ? errors.map(item => item.error).join('; ') : undefined,
      });
    });

    if (!result) {
      throw new Error('LiteParse 快速识别没有返回结果');
    }
    return result;
  }

  async ensurePdfFiguresForManager(
    userId: string,
    pdfId: string,
    options: { force?: boolean } = {}
  ): Promise<{ pdf: PdfWikiSourcePdf; figureCount: number; figureError?: string; attempted: boolean }> {
    const safeUserId = sanitizeUserId(userId);
    const targetPdfId = String(pdfId || '').trim();
    if (!targetPdfId) {
      throw new Error('缺少需要提取图片的 PDF ID');
    }

    let result: {
      pdf: PdfWikiSourcePdf;
      figureCount: number;
      figureError?: string;
      attempted: boolean;
    } | null = null;

    await this.runExclusiveBuild(safeUserId, async () => {
      const store = await this.loadStore(safeUserId);
      const pdfIndex = store.pdfs.findIndex(pdf => pdf.id === targetPdfId);
      if (pdfIndex < 0) {
        throw new Error('未找到该 PDF，请先上传 PDF');
      }

      const pdf = store.pdfs[pdfIndex];
      const existingFigures = this.filterScientificSourceFigures(
        this.firstArray(
          this.asRecord(pdf.metaData).source_figures,
          this.asRecord(pdf.metaData).sourceFigures
        )
      );
      if (existingFigures.length > 0) {
        let changed = false;
        if (pdf.figureExtractionStatus !== 'completed') {
          pdf.figureExtractionStatus = 'completed';
          changed = true;
        }
        if (!pdf.figureExtractionAttemptedAt) {
          pdf.figureExtractionAttemptedAt = pdf.metaDataCachedAt
            || pdf.processedAt
            || new Date().toISOString();
          changed = true;
        }
        if (pdf.figureExtractionError) {
          pdf.figureExtractionError = undefined;
          changed = true;
        }
        if (changed) {
          store.pdfs[pdfIndex] = pdf;
          store.generatedAt = new Date().toISOString();
          await this.saveStore(safeUserId, store);
        }
        result = {
          pdf,
          figureCount: existingFigures.length,
          attempted: false,
        };
        return;
      }

      if (!options.force && (pdf.figureExtractionAttemptedAt || pdf.figureExtractionStatus)) {
        result = {
          pdf,
          figureCount: 0,
          figureError: pdf.figureExtractionError,
          attempted: false,
        };
        return;
      }

      if (!pdf.filePath || !fs.existsSync(pdf.filePath)) {
        throw new Error('PDF 源文件不存在，无法补充提取图片');
      }

      const figureResult = await this.extractPdfFiguresForManager(safeUserId, pdf);
      this.recordPdfFigureExtraction(pdf, figureResult);
      store.pdfs[pdfIndex] = pdf;
      store.generatedAt = new Date().toISOString();
      await this.saveStore(safeUserId, store);
      this.clearEngine(safeUserId);
      this.removeIndexCache(safeUserId);
      logger.info(
        `[PdfWiki] Backfilled legacy PDF figures for ${pdf.originalName}: figures=${figureResult.figureCount}${figureResult.error ? `, warning=${figureResult.error}` : ''}`
      );
      result = {
        pdf,
        figureCount: figureResult.figureCount,
        figureError: figureResult.error,
        attempted: true,
      };
    });

    if (!result) {
      throw new Error('PDF 图片补充提取没有返回结果');
    }
    return result;
  }

  async reidentifyPdfWithLiteParse(userId: string, pdfId: string): Promise<PdfWikiReidentifyResult> {
    const safeUserId = sanitizeUserId(userId);
    const targetPdfId = String(pdfId || '').trim();
    if (!targetPdfId) {
      throw new Error('缺少需要重新识别的 PDF ID');
    }

    let result: PdfWikiReidentifyResult | null = null;
    await this.runExclusiveBuild(safeUserId, async () => {
      await this.saveStatus(safeUserId, {
        status: 'processing',
        totalPdfs: 1,
        processedPdfs: 0,
        totalChunks: 1,
        processedChunks: 0,
        entryCount: 0,
        sentencePointCount: 0,
        message: '正在使用 LiteParse 重新识别 PDF 标题、作者、正文和图片',
        updatedAt: new Date().toISOString(),
      });

      const store = await this.loadStore(safeUserId);
      const pdfIndex = store.pdfs.findIndex(pdf => pdf.id === targetPdfId);
      if (pdfIndex < 0) {
        throw new Error('未找到该 PDF，请先上传 PDF');
      }

      const pdf = store.pdfs[pdfIndex];
      if (!pdf.filePath || !fs.existsSync(pdf.filePath)) {
        throw new Error('PDF 源文件不存在，无法重新识别');
      }

      let parsed = await this.tryExtractPdfWithLiteParse(safeUserId, pdf);
      if (!parsed) {
        const text = this.normalizeExtractedText(await this.extractPdfTextWithPdfParse(pdf.filePath));
        const references = this.parseReferences(text, pdf.id, pdf.originalName);
        const metadata = await this.enrichSourceMetadataWithDoi(this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text)), text, pdf.originalName);
        parsed = {
          text,
          metadata,
          references,
          parser: 'pdf-parse',
        };
        await this.saveParsedTextCache(safeUserId, pdf, {
          parser: 'pdf-parse',
          markdown: text,
          text,
          references,
          metadata,
        });
      }

      const metadata = this.mergePdfReidentifiedMetadata(pdf, parsed);
      Object.assign(pdf, metadata);
      pdf.referenceIndex = this.mergeReferenceIndexes(pdf.referenceIndex || [], parsed.references || []);
      pdf.textLength = parsed.text.length;
      pdf.extractionParser = parsed.parser;
      pdf.processedAt = new Date().toISOString();
      pdf.metaData = this.buildPdfMetaDataRecord(pdf, parsed, pdf.referenceIndex, pdf.metaData || {});
      pdf.metaDataCachedAt = pdf.processedAt;

      const figureResult = await this.extractPdfFiguresForManager(safeUserId, pdf);
      logger.info(`[PdfWiki] Reidentified figures for ${pdf.originalName}: figures=${figureResult.figureCount}${figureResult.error ? `, warning=${figureResult.error}` : ''}`);
      this.recordPdfFigureExtraction(pdf, figureResult);

      store.pdfs[pdfIndex] = pdf;
      store.referenceIndex = this.mergeReferenceIndexes(store.referenceIndex || [], pdf.referenceIndex || []);
      store.generatedAt = new Date().toISOString();
      await this.saveStore(safeUserId, store);
      this.clearEngine(safeUserId);
      this.removeIndexCache(safeUserId);

      const autoGroupMatch = await this.autoAssignExistingPdfGroups(safeUserId, [pdf]);
      const autoGroupMessage = autoGroupMatch.addedTagCount > 0
        ? `；自动新增标签：${autoGroupMatch.matchedGroupNamesByPdf[pdf.id].join('、')}`
        : '';
      result = {
        pdf,
        parser: parsed.parser,
        textLength: parsed.text.length,
        referenceCount: pdf.referenceIndex?.length || 0,
        figureCount: figureResult.figureCount,
        figureError: figureResult.error,
        message: `已重新识别 PDF：${this.getParsedContentParserLabel(parsed.parser)}，文字 ${parsed.text.length} 字，图片 ${figureResult.figureCount} 张${autoGroupMessage}`,
        autoGroupMatch,
      };

      await this.saveStatus(safeUserId, {
        status: 'completed',
        totalPdfs: store.pdfs.length,
        processedPdfs: store.pdfs.length,
        totalChunks: 1,
        processedChunks: 1,
        entryCount: store.entries.length,
        sentencePointCount: store.sentenceCloud?.points?.length || 0,
        message: result.message + (figureResult.error ? `；图片提取提示：${figureResult.error}` : ''),
        updatedAt: store.generatedAt,
      });
    });

    if (!result) {
      throw new Error('PDF 重新识别没有返回结果');
    }
    return result;
  }

  async processUploadedPdfsForMetaAnalysis(
    userId: string,
    files: UploadedPdfFile[],
    llmConfig: PdfWikiLlmConfig,
    options: { force?: boolean } = {}
  ): Promise<void> {
    if (files.length === 0) return;

    const safeUserId = sanitizeUserId(userId);
    await this.runExclusiveBuild(safeUserId, async () => {
      const uploadedPdfs = await this.registerPdfFiles(safeUserId, files);
      if (uploadedPdfs.length === 0) {
        throw new Error('没有可读取的 PDF 文件');
      }

      const store = await this.loadStore(safeUserId);
      const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
      const targetPdfs = uploadedPdfs.map(pdf => {
        const existing = pdfById.get(pdf.id);
        if (!existing) {
          const includedPdf: PdfWikiSourcePdf = { ...pdf, metaExcluded: false };
          pdfById.set(pdf.id, includedPdf);
          return includedPdf;
        }
        const merged = {
          ...existing,
          originalName: existing.originalName || pdf.originalName,
          fileName: existing.fileName || pdf.fileName,
          filePath: existing.filePath && fs.existsSync(existing.filePath) ? existing.filePath : pdf.filePath,
          size: existing.size || pdf.size,
          metaExcluded: false,
        };
        pdfById.set(pdf.id, merged);
        return merged;
      });

      await this.saveStore(safeUserId, {
        ...store,
        pdfs: this.deduplicatePdfs(Array.from(pdfById.values())),
        generatedAt: new Date().toISOString(),
      });

      await this.extractMetaAnalysisOnly(safeUserId, targetPdfs, {
        ...llmConfig,
        metaAnalysisEnabled: true,
        metaAnalysisEngine: this.getMetaAnalysisEngine(llmConfig) === 'off' ? 'auto' : this.getMetaAnalysisEngine(llmConfig),
      }, options);
    });
  }

  async extractMetaAnalysisForPdfs(
    userId: string,
    pdfIds: string[],
    llmConfig: PdfWikiLlmConfig,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    const requestedIds = new Set(pdfIds.map(id => String(id || '').trim()).filter(Boolean));
    if (requestedIds.size === 0) {
      throw new Error('请先选择需要提取 Meta 数据的 PDF');
    }

    await this.runExclusiveBuild(safeUserId, async () => {
      const store = await this.loadStore(safeUserId);
      const targetPdfs = store.pdfs.filter(pdf => requestedIds.has(pdf.id));
      if (targetPdfs.length === 0) {
        throw new Error('未找到需要提取 Meta 数据的 PDF');
      }
      const pdfs = store.pdfs.map(pdf => requestedIds.has(pdf.id)
        ? { ...pdf, metaExcluded: false }
        : pdf
      );
      await this.saveStore(safeUserId, {
        ...store,
        pdfs,
        generatedAt: new Date().toISOString(),
      });
      const includedTargets = pdfs.filter(pdf => requestedIds.has(pdf.id));
      await this.extractMetaAnalysisOnly(safeUserId, includedTargets, {
        ...llmConfig,
        metaAnalysisEnabled: true,
        metaAnalysisEngine: this.getMetaAnalysisEngine(llmConfig) === 'off' ? 'auto' : this.getMetaAnalysisEngine(llmConfig),
      }, options);
    });
  }

  async importFigureDigitizationData(
    userId: string,
    pdfId: string,
    input: PdfWikiFigureDigitizationImportInput
  ): Promise<PdfWikiFigureDigitizationImportResult> {
    const safeUserId = sanitizeUserId(userId);
    const store = await this.loadStore(safeUserId);
    const pdfIndex = store.pdfs.findIndex(pdf => pdf.id === pdfId);
    if (pdfIndex < 0) {
      throw new Error('未找到该 PDF，无法导入 GetData 结果');
    }
    if (!input.buffer || input.buffer.length === 0) {
      throw new Error('GetData 导出文件为空');
    }

    const pdf = store.pdfs[pdfIndex];
    const parsed = await this.parseDigitizationExportFile(input.fileName, input.buffer);
    if (parsed.rows.length === 0) {
      throw new Error('未从 GetData 导出文件中读取到有效数据行');
    }
    const processedParsed = this.applyDigitizationAggregation(parsed, input.parameters || {});
    const importedRows = processedParsed.rows.length;

    const now = new Date().toISOString();
    const figureLabel = this.firstString(input.figureLabel, input.figureKey, '待复核图件');
    const tool = this.firstString(input.tool, 'GetData Graph Digitizer');
    const taskDir = this.getCodexPdfWikiTaskDir(safeUserId, pdf);
    const digitizedDir = path.join(taskDir, 'meta-figures', 'digitized');
    await fs.promises.mkdir(digitizedDir, { recursive: true });
    const safeFileName = `${now.replace(/[:.]/g, '-')}-${this.sanitizeFileName(input.fileName || 'getdata-export.csv')}`;
    const storedPath = path.join(digitizedDir, safeFileName);
    await fs.promises.writeFile(storedPath, input.buffer);
    const relativePath = path.join('meta-figures', 'digitized', safeFileName).replace(/\\/g, '/');

    const cached = await this.loadParsedMetaCache(safeUserId, pdf);
    const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(taskDir, 'meta_data.json')));
    const cachedMeta = this.asRecord(cached?.metaData);
    const storedMeta = this.asRecord(pdf.metaData);
    const baseMeta = this.buildPdfMetaDataRecord(
      pdf,
      null,
      pdf.referenceIndex || [],
      this.mergeStoredPdfMetaData(codexMeta, cachedMeta, storedMeta)
    );
    const existingRows = this.mergeExplicitMetaAnalysisRows(codexMeta, cachedMeta, storedMeta, baseMeta);
    const sourceFigures = this.filterScientificSourceFigures(this.firstArray(baseMeta.source_figures)).map(item => this.asRecord(item));
    sourceFigures.push({
      id: input.figureKey || `figure_digitized_${sourceFigures.length + 1}`,
      label: figureLabel,
      digitization_tool: tool,
      digitization_file: relativePath,
      digitization_rows: importedRows,
      digitized_at: now,
      digitization_parameters: input.parameters || {},
      needs_manual_review: true,
      note: input.notes || '用户保存了图像数字化导出文件；数据只作为复核证据记录，不会自动追加 Meta 编码行。',
    });

    const mergedMeta = this.applyMetaAnalysisPreference({
      ...baseMeta,
      meta_analysis_rows: existingRows,
      source_figures: sourceFigures,
      extraction_notes: [
        ...this.toDisplayStringArray(baseMeta.extraction_notes),
        `已保存 ${tool} 图像数字化导出文件：${figureLabel}，${importedRows} 行；未自动追加 Meta 编码行，用户需在编码表中手动填入并保存。`,
      ],
      needs_codex_or_manual_review: true,
      meta_analysis_enabled: true,
      meta_analysis_engine: this.firstString(baseMeta.meta_analysis_engine, 'figure-digitization'),
    }, {
      apiUrl: '',
      apiKey: '',
      model: '',
      metaAnalysisEnabled: true,
      metaAnalysisEngine: 'auto',
    });

    pdf.metaData = mergedMeta;
    pdf.metaDataCachedAt = now;
    pdf.metaExcluded = false;
    store.pdfs[pdfIndex] = pdf;
    store.generatedAt = now;
    await this.saveStore(safeUserId, store);

    const integrated = await this.buildPdfIntegratedDataTable(safeUserId, pdf, mergedMeta);
    return {
      pdfId: pdf.id,
      importedRows,
      metaRowCount: integrated.rowCount,
      figureLabel,
      columns: integrated.columns,
      storedFile: relativePath,
    };
  }

  async rebuildFromSources(userId: string, llmConfig: PdfWikiLlmConfig): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    await this.runExclusiveBuild(safeUserId, async () => {
      const sourceDir = this.getSourcePdfDir(safeUserId);
      if (!fs.existsSync(sourceDir)) {
        throw new Error('未找到已上传的 PDF 文件');
      }

      const files = fs.readdirSync(sourceDir)
        .filter(name => name.toLowerCase().endsWith('.pdf'))
        .map(fileName => path.join(sourceDir, fileName));

      if (files.length === 0) {
        throw new Error('未找到已上传的 PDF 文件');
      }

      const pdfs = await Promise.all(files.map(filePath => this.createSourceMeta(filePath, this.restoreOriginalName(path.basename(filePath)))));
      await this.buildWiki(safeUserId, pdfs, llmConfig, true);
    });
  }

  async getStatus(userId: string): Promise<PdfWikiBuildStatus> {
    const safeUserId = sanitizeUserId(userId);
    const [status, queue] = await Promise.all([
      this.getStatusWithoutQueue(safeUserId),
      this.getQueueSnapshot(safeUserId),
    ]);
    const hasActiveQueue = queue.runningJobs > 0 || queue.queuedJobs > 0;
    return {
      ...status,
      status: hasActiveQueue && status.status !== 'processing' ? 'processing' : status.status,
      message: hasActiveQueue && status.status !== 'processing'
        ? `PDF 队列处理中：运行 ${queue.runningPdfs} 篇，等待 ${queue.queuedPdfs} 篇。${status.message}`
        : status.message,
      queue,
    };
  }

  /**
   * Read the persisted progress snapshot without opening and normalizing wiki.json.
   * Meta list/detail pages only need progress information; loading the complete Wiki
   * here used to add another 26 MB read to every request.
   */
  async getLightweightStatus(userId: string): Promise<PdfWikiBuildStatus> {
    const safeUserId = sanitizeUserId(userId);
    const statusPath = this.getStatusPath(safeUserId);
    const [persistedStatus, queue] = await Promise.all([
      (async (): Promise<PdfWikiBuildStatus> => {
        if (!fs.existsSync(statusPath)) return { ...DEFAULT_STATUS };
        try {
          const parsed = JSON.parse(await fs.promises.readFile(statusPath, 'utf-8')) as PdfWikiBuildStatus;
          return this.withStaleProcessingGuard(this.normalizeMetaAnalysisStatus(parsed));
        } catch (error) {
          logger.warn(`[PdfWiki] Failed to read lightweight status for ${safeUserId}:`, error);
          return { ...DEFAULT_STATUS };
        }
      })(),
      this.getQueueSnapshot(safeUserId),
    ]);
    const hasActiveQueue = queue.runningJobs > 0 || queue.queuedJobs > 0;
    return {
      ...persistedStatus,
      status: hasActiveQueue && persistedStatus.status !== 'processing' ? 'processing' : persistedStatus.status,
      message: hasActiveQueue && persistedStatus.status !== 'processing'
        ? `PDF 队列处理中：运行 ${queue.runningPdfs} 篇，等待 ${queue.queuedPdfs} 篇。${persistedStatus.message}`
        : persistedStatus.message,
      queue,
    };
  }

  private async getStatusWithoutQueue(userId: string): Promise<PdfWikiBuildStatus> {
    const statusPath = this.getStatusPath(userId);
    if (fs.existsSync(statusPath)) {
      try {
        const status = JSON.parse(await fs.promises.readFile(statusPath, 'utf-8')) as PdfWikiBuildStatus;
        if (status.status === 'completed' && status.taskKind !== 'meta-analysis') {
          const store = await this.loadStore(userId);
          const sentencePointCount = store.sentenceCloud?.points?.length || 0;
          return {
            ...status,
            entryCount: store.entries.length,
            sentencePointCount,
            message: sentencePointCount > 0
              ? `Wiki论点库已生成，共 ${sentencePointCount} 个可作论点句子，兼容论点组 ${store.entries.length} 个`
              : (store.entries.length > 0
                ? `PDF Wiki 已生成，兼容论点组 ${store.entries.length} 个；暂未生成可作论点句子`
                : 'PDF Wiki 处理完成，但未生成可作论点句子'),
          };
        }
        return this.withStaleProcessingGuard(this.normalizeMetaAnalysisStatus(status));
      } catch (error) {
        logger.warn(`[PdfWiki] Failed to read status for ${userId}:`, error);
      }
    }

    const store = await this.loadStore(userId);
    const sentencePointCount = store.sentenceCloud?.points?.length || 0;
    if (store.entries.length > 0 || sentencePointCount > 0) {
      return {
        status: 'completed',
        totalPdfs: store.pdfs.length,
        processedPdfs: store.pdfs.length,
        totalChunks: 0,
        processedChunks: 0,
        entryCount: store.entries.length,
        sentencePointCount,
        message: sentencePointCount > 0
          ? `Wiki论点库已生成，共 ${sentencePointCount} 个可作论点句子`
          : `PDF Wiki 已生成，共 ${store.entries.length} 个论点组`,
        updatedAt: store.generatedAt,
      };
    }

    return { ...DEFAULT_STATUS };
  }

  private withStaleProcessingGuard(status: PdfWikiBuildStatus): PdfWikiBuildStatus {
    if (status.status !== 'processing') return status;
    // PDF Wiki tasks publish a heartbeat while Codex is running and are allowed
    // to take as long as needed. Only Meta tasks retain stale-worker detection.
    if (status.taskKind !== 'meta-analysis') return status;

    const updatedAt = status.updatedAt ? Date.parse(status.updatedAt) : NaN;
    if (!Number.isFinite(updatedAt)) return status;

    const configuredStaleMs = Number(process.env.PDF_WIKI_STALE_STATUS_MS);
    const defaultStaleMs = 3 * 60_000;
    const staleMs = Math.max(
      60_000,
      Number.isFinite(configuredStaleMs) && configuredStaleMs > 0 ? configuredStaleMs : defaultStaleMs
    );
    const elapsedMs = Date.now() - updatedAt;
    if (elapsedMs <= staleMs) return status;

    const elapsedMinutes = Math.max(1, Math.round(elapsedMs / 60_000));
    const lastMessage = status.message ? `最后状态：${status.message}` : '没有可用的最后状态。';
    return {
      ...status,
      status: 'error',
      message: `Meta 数据提取已超过 ${elapsedMinutes} 分钟没有进度更新，可能是 Codex CLI 子进程卡住或没有写出最终文件。${lastMessage}`,
      error: 'STALE_META_ANALYSIS_TASK',
      codexWorkers: (status.codexWorkers || []).map(worker => {
        if (worker.status !== 'running') return worker;
        return {
          ...worker,
          status: 'error',
          message: `${worker.message || 'Codex worker 无进度更新'}（超过 ${elapsedMinutes} 分钟未更新）`,
          error: 'STALE_CODEX_WORKER',
        };
      }),
    };
  }

  private normalizeMetaAnalysisStatus(status: PdfWikiBuildStatus): PdfWikiBuildStatus {
    if (status.taskKind !== 'meta-analysis') return status;
    const totalPdfs = Number(status.totalPdfs || 0);
    const failedPdfs = Number(status.failedPdfs || 0);
    const attemptedPdfs = Math.max(Number(status.processedChunks || 0), Number(status.processedPdfs || 0) + failedPdfs);
    const hasActiveWorkers = (status.codexWorkers || []).some(worker => worker.status === 'running');
    if (status.status === 'completed' && (hasActiveWorkers || (totalPdfs > 0 && attemptedPdfs < totalPdfs))) {
      return {
        ...status,
        status: 'processing',
        message: `Meta 数据提取状态仍在同步：已完成/失败 ${attemptedPdfs}/${totalPdfs} 个 PDF，仍有 Codex worker 运行。${status.message || ''}`,
        error: undefined,
      };
    }
    return status;
  }

  async getStore(userId: string): Promise<PdfWikiStore> {
    const safeUserId = sanitizeUserId(userId);
    const [store, catalog, annotations] = await Promise.all([
      this.loadStore(safeUserId),
      this.getTopicCatalog(safeUserId),
      this.loadSentenceTopicAnnotationStore(safeUserId),
    ]);
    const existingPoints = store.sentenceCloud?.points || [];
    if (existingPoints.length === 0) return this.toReferenceBackedStoreView(store);
    const points = existingPoints.map(point => this.applyTopicDefinitionToPoint(point, catalog.topics));
    const changed = points.some((point, index) => (
      point.topicKey !== existingPoints[index].topicKey
      || point.topicLabel !== existingPoints[index].topicLabel
      || point.keywords.join('\u0000') !== existingPoints[index].keywords.join('\u0000')
    ));
    if (changed) {
      store.sentenceCloud = this.buildSentenceCloudStore(points);
      await this.saveStore(safeUserId, store);
      this.clearEngine(safeUserId);
      this.removeIndexCache(safeUserId);
    }
    const taxonomyHash = this.getSentenceTopicTaxonomyHash(catalog);
    const annotatedPoints = points.map(point => {
      const annotation = annotations.records[point.id];
      if (!this.isCurrentSentenceTopicAnnotation(point, annotation, taxonomyHash)) return point;
      return { ...point, aiTopicAnnotation: annotation };
    });
    store.sentenceCloud = this.buildSentenceCloudStore(annotatedPoints);
    return this.toReferenceBackedStoreView(store);
  }

  /**
   * PDF 管理列表只需要 PDF 元数据。这里直接读取受信任的本地 store，
   * 不规范化句子云、不重建主题，也绝不写回 wiki.json。
   */
  async getPdfManagerStoreSnapshot(userId: string): Promise<PdfWikiPdfManagerStoreSnapshot> {
    const safeUserId = sanitizeUserId(userId);
    const storePath = this.getStorePath(safeUserId);
    if (!fs.existsSync(storePath)) {
      this.pdfManagerStoreSnapshotCache.delete(safeUserId);
      return { generatedAt: new Date(0).toISOString(), pdfs: [] };
    }
    try {
      const stat = await fs.promises.stat(storePath);
      const cached = this.pdfManagerStoreSnapshotCache.get(safeUserId);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.snapshot;
      }
      const parsed = JSON.parse(await fs.promises.readFile(storePath, 'utf-8')) as Partial<PdfWikiStore>;
      const snapshot: PdfWikiPdfManagerStoreSnapshot = {
        generatedAt: typeof parsed.generatedAt === 'string' ? parsed.generatedAt : new Date(0).toISOString(),
        pdfs: (Array.isArray(parsed.pdfs) ? parsed.pdfs : [])
          .filter((pdf): pdf is PdfWikiSourcePdf => !!pdf && typeof pdf === 'object' && !!pdf.id),
      };
      this.pdfManagerStoreSnapshotCache.set(safeUserId, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        snapshot,
      });
      return snapshot;
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read PDF manager snapshot for ${safeUserId}:`, error);
      this.pdfManagerStoreSnapshotCache.delete(safeUserId);
      return { generatedAt: new Date(0).toISOString(), pdfs: [] };
    }
  }

  /**
   * Wiki 论点库首屏只需要已经落盘的论点和句子云。这里跳过主题规则重算、
   * AI 标签合并及 store 写回；这些工作仍由完整 getStore() 在后台刷新时完成。
   * 以 wiki.json 的 mtime/size 做进程内缓存，重复打开时不再解析十几 MB 的 JSON。
   */
  async getViewerStoreSnapshot(userId: string): Promise<PdfWikiViewerStoreSnapshot> {
    const safeUserId = sanitizeUserId(userId);
    const storePath = this.getStorePath(safeUserId);
    if (!fs.existsSync(storePath)) {
      this.viewerStoreSnapshotCache.delete(safeUserId);
      return {
        generatedAt: new Date(0).toISOString(),
        pdfs: [],
        entries: [],
        sentenceCloud: { generatedAt: new Date(0).toISOString(), points: [], clouds: [] },
      };
    }
    try {
      const stat = await fs.promises.stat(storePath);
      const cached = this.viewerStoreSnapshotCache.get(safeUserId);
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        return cached.snapshot;
      }
      const parsed = JSON.parse(await fs.promises.readFile(storePath, 'utf-8')) as Partial<PdfWikiStore>;
      const generatedAt = typeof parsed.generatedAt === 'string'
        ? parsed.generatedAt
        : new Date(0).toISOString();
      const rawSentenceCloud = parsed.sentenceCloud && typeof parsed.sentenceCloud === 'object'
        ? parsed.sentenceCloud
        : undefined;
      const snapshot: PdfWikiViewerStoreSnapshot = {
        generatedAt,
        pdfs: Array.isArray(parsed.pdfs) ? parsed.pdfs : [],
        entries: this.filterReferenceBackedEntries(Array.isArray(parsed.entries) ? parsed.entries : []),
        sentenceCloud: {
          ...this.buildSentenceCloudStore(
            this.filterPublishableSentencePoints(
              Array.isArray(rawSentenceCloud?.points) ? rawSentenceCloud.points : []
            )
          ),
          generatedAt: typeof rawSentenceCloud?.generatedAt === 'string'
            ? rawSentenceCloud.generatedAt
            : generatedAt,
        },
      };
      this.viewerStoreSnapshotCache.set(safeUserId, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        snapshot,
      });
      return snapshot;
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read Wiki argument viewer snapshot for ${safeUserId}:`, error);
      this.viewerStoreSnapshotCache.delete(safeUserId);
      return {
        generatedAt: new Date(0).toISOString(),
        pdfs: [],
        entries: [],
        sentenceCloud: { generatedAt: new Date(0).toISOString(), points: [], clouds: [] },
      };
    }
  }

  hasPdfDeepAnalysisSnapshot(userId: string, pdfId: string): boolean {
    return fs.existsSync(this.getDeepAnalysisPath(sanitizeUserId(userId), pdfId));
  }

  async getPdfDeepAnalysisSnapshot(userId: string, pdfId: string): Promise<PdfWikiDeepAnalysisCache | null> {
    return this.loadDeepAnalysisCache(sanitizeUserId(userId), pdfId);
  }

  async getMetaDatabase(userId: string, options: PdfWikiMetaDatabaseOptions = {}): Promise<PdfWikiMetaDatabase> {
    const safeUserId = sanitizeUserId(userId);
    const requestedIds = new Set((options.pdfIds || []).map(id => String(id || '').trim()).filter(Boolean));
    const includeDetails = options.includeDetails !== false;
    const isCompleteSummaryRequest = requestedIds.size === 0 && !includeDetails;
    if (isCompleteSummaryRequest && !options.forceRefreshSummary) {
      const cached = await this.loadMetaDatabaseSummaryIndex(safeUserId);
      if (cached) return cached;
    }

    const store = await this.loadStore(safeUserId);
    const pdfs = requestedIds.size > 0
      ? store.pdfs.filter(pdf => requestedIds.has(pdf.id) && pdf.metaExcluded !== true)
      : store.pdfs.filter(pdf => pdf.metaExcluded !== true);
    const items = (await Promise.all(pdfs.map(pdf => this.buildMetaDatabaseItem(safeUserId, pdf, { includeDetails }))))
      .filter((item): item is PdfWikiMetaDatabaseItem => !!item);
    const database: PdfWikiMetaDatabase = {
      userId: safeUserId,
      generatedAt: store.generatedAt,
      pdfCount: items.length,
      referenceCount: store.referenceIndex.length,
      items: items.sort((a, b) => a.originalName.localeCompare(b.originalName, 'zh-CN')),
    };
    if (isCompleteSummaryRequest) {
      await this.saveMetaDatabaseSummaryIndex(safeUserId, database);
    }
    return database;
  }

  private getMetaDatabaseSourceSignature(userId: string): string {
    return [
      this.getStorePath(userId),
      this.getMetaAnalysisTemplatePath(userId),
    ].map(filePath => {
      try {
        const stat = fs.statSync(filePath);
        const resolvedPath = fs.realpathSync(filePath);
        return `${resolvedPath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
      } catch {
        return `${path.basename(filePath)}:missing`;
      }
    }).join('|');
  }

  private async loadMetaDatabaseSummaryIndex(userId: string): Promise<PdfWikiMetaDatabase | null> {
    const sourceSignature = this.getMetaDatabaseSourceSignature(userId);
    const memoryCached = this.metaDatabaseSummaryCache.get(userId);
    if (memoryCached?.sourceSignature === sourceSignature) {
      return memoryCached.database;
    }

    const indexPath = this.getMetaDatabaseIndexPath(userId);
    if (!fs.existsSync(indexPath)) return null;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(indexPath, 'utf-8')) as Partial<PdfWikiMetaDatabaseIndexFile>;
      const database = parsed.database;
      const storedSignature = String(parsed.sourceSignature || '');
      const signatureMatches = storedSignature === sourceSignature
        || storedSignature.startsWith(`${sourceSignature}|`);
      if (
        parsed.version !== 1
        || !signatureMatches
        || !database
        || !Array.isArray(database.items)
      ) {
        return null;
      }
      const cached: PdfWikiMetaDatabaseIndexFile = { version: 1, sourceSignature, database };
      this.metaDatabaseSummaryCache.set(userId, cached);
      return database;
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read Meta database summary index for ${userId}:`, error);
      return null;
    }
  }

  private async saveMetaDatabaseSummaryIndex(userId: string, database: PdfWikiMetaDatabase): Promise<void> {
    const payload: PdfWikiMetaDatabaseIndexFile = {
      version: 1,
      sourceSignature: this.getMetaDatabaseSourceSignature(userId),
      database,
    };
    this.metaDatabaseSummaryCache.set(userId, payload);
    try {
      await this.writeJsonAtomic(this.getMetaDatabaseIndexPath(userId), payload);
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to save Meta database summary index for ${userId}:`, error);
    }
  }

  async deleteMetaDatabaseItems(userId: string, pdfIds: string[]): Promise<{ deletedCount: number; metaCount: number }> {
    const requestedIds = new Set(pdfIds.map(id => String(id || '').trim()).filter(Boolean));
    if (requestedIds.size === 0) return { deletedCount: 0, metaCount: 0 };

    const store = await this.loadStore(userId);
    let deletedCount = 0;
    const now = new Date().toISOString();
    const pdfs = store.pdfs.map(pdf => {
      if (!requestedIds.has(pdf.id)) return pdf;
      deletedCount++;
      const existingMeta = this.asRecord(pdf.metaData);
      return {
        ...pdf,
        metaExcluded: true,
        metaData: this.removeUndefinedValues({
          ...existingMeta,
          meta_analysis_enabled: false,
          meta_analysis_deleted: true,
          meta_analysis_rows: [],
          source_tables: [],
          source_figures: [],
          extraction_notes: [
            ...this.toDisplayStringArray(existingMeta.extraction_notes),
            '用户已从 Meta 数据库删除该 PDF 的 Meta 分析数据记录。',
          ],
          needs_codex_or_manual_review: false,
          deleted_from_meta_database_at: now,
        }),
        metaDataCachedAt: now,
      };
    });

    if (deletedCount > 0) {
      await this.saveStore(userId, {
        ...store,
        pdfs,
        generatedAt: new Date().toISOString(),
      });
    }

    const metaDatabase = await this.getMetaDatabase(userId);
    return { deletedCount, metaCount: metaDatabase.items.length };
  }

  async deleteMetaAnalysisCodingTableSelection(
    userId: string,
    pdfId: string,
    input: { rowIndexes?: number[]; columns?: string[] }
  ): Promise<PdfWikiMetaAnalysisCodingTableEditResult> {
    const safeUserId = sanitizeUserId(userId);
    const targetPdfId = String(pdfId || '').trim();
    if (!targetPdfId) {
      throw new Error('缺少需要编辑的 PDF ID');
    }

    const rowIndexes = Array.from(new Set((input.rowIndexes || [])
      .map(index => Number(index))
      .filter(index => Number.isInteger(index) && index >= 0)));
    const protectedColumns: string[] = [];
    const columns = this.unique((input.columns || []).map(column => this.stringifyTableCellValue(column)))
      .filter(column => {
        if (!this.isProtectedMetaAnalysisCodingColumn(column)) return true;
        protectedColumns.push(column);
        return false;
      });
    if (rowIndexes.length === 0 && columns.length === 0) {
      throw new Error(protectedColumns.length > 0
        ? '所选列属于系统追踪字段，不能删除'
        : '请先选择需要删除的行或列');
    }

    const store = await this.loadStore(safeUserId);
    const currentPdf = store.pdfs.find(pdf => pdf.id === targetPdfId);
    if (!currentPdf) {
      throw new Error('未找到该 PDF');
    }

    const now = new Date().toISOString();
    let deletedRowCount = 0;
    const shouldDeleteColumns = columns.length > 0;
    const normalizedColumns = new Set(columns.flatMap(column => [
      this.normalizeMetaAnalysisColumnIdentity(column),
      this.normalizeMetaAnalysisColumnKey(column),
    ]));
    if (shouldDeleteColumns) {
      await this.removeMetaAnalysisTemplateColumns(safeUserId, columns);
    }

    for (let index = 0; index < store.pdfs.length; index++) {
      const pdf = store.pdfs[index];
      const editingCurrentPdfRows = pdf.id === targetPdfId && rowIndexes.length > 0;
      if (!editingCurrentPdfRows && !shouldDeleteColumns) continue;

      const taskDir = this.getCodexPdfWikiTaskDir(safeUserId, pdf);
      const cached = await this.loadParsedMetaCache(safeUserId, pdf);
      const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(taskDir, 'meta_data.json')));
      const cachedMeta = this.asRecord(cached?.metaData);
      const storedMeta = this.asRecord(pdf.metaData);
      const baseMeta = this.buildPdfMetaDataRecord(
        pdf,
        null,
        pdf.referenceIndex || [],
        this.mergeStoredPdfMetaData(codexMeta, cachedMeta, storedMeta)
      );
      let rows = this.getEditableMetaAnalysisRows(codexMeta, cachedMeta, storedMeta, baseMeta);
      if (rows.length === 0 && shouldDeleteColumns && !editingCurrentPdfRows) continue;

      if (editingCurrentPdfRows) {
        const beforeCount = rows.length;
        const deleteSet = new Set(rowIndexes);
        rows = rows.filter((_, rowIndex) => !deleteSet.has(rowIndex));
        deletedRowCount = beforeCount - rows.length;
      }

      if (shouldDeleteColumns) {
        const activeColumns = this.getActiveMetaAnalysisColumns(safeUserId);
        rows = rows.map(row => this.removeColumnsFromMetaAnalysisRow(row, normalizedColumns, activeColumns));
      }

      store.pdfs[index] = {
        ...pdf,
        metaExcluded: false,
        metaData: this.removeUndefinedValues({
          ...baseMeta,
          meta_analysis_rows: rows,
          meta_analysis_rows_user_edited: true,
          meta_analysis_enabled: true,
          extraction_notes: [
            ...this.toDisplayStringArray(baseMeta.extraction_notes),
            [
              editingCurrentPdfRows ? `用户从 Meta 分析编码表删除 ${deletedRowCount} 行。` : '',
              shouldDeleteColumns ? `用户从 Meta 分析编码表删除列：${columns.join('、')}。` : '',
            ].filter(Boolean).join(' '),
          ].filter(Boolean),
        }),
        metaDataCachedAt: now,
      };
    }

    store.generatedAt = now;
    await this.saveStore(safeUserId, store);

    const updatedPdf = store.pdfs.find(pdf => pdf.id === targetPdfId) || currentPdf;
    const dataTable = await this.buildPdfIntegratedDataTable(safeUserId, updatedPdf, this.asRecord(updatedPdf.metaData));
    return {
      pdfId: targetPdfId,
      deletedRowCount,
      deletedColumnCount: columns.length,
      protectedColumns,
      remainingRowCount: dataTable.rowCount,
      dataTable,
    };
  }

  async saveMetaAnalysisCodingTable(
    userId: string,
    pdfId: string,
    input: { columns?: string[]; rows?: Array<Record<string, unknown>> }
  ): Promise<PdfWikiMetaAnalysisCodingTableEditResult> {
    const safeUserId = sanitizeUserId(userId);
    const targetPdfId = String(pdfId || '').trim();
    if (!targetPdfId) {
      throw new Error('缺少需要编辑的 PDF ID');
    }

    const store = await this.loadStore(safeUserId);
    const pdfIndex = store.pdfs.findIndex(pdf => pdf.id === targetPdfId);
    if (pdfIndex < 0) {
      throw new Error('未找到该 PDF');
    }

    const currentPdf = store.pdfs[pdfIndex];
    const taskDir = this.getCodexPdfWikiTaskDir(safeUserId, currentPdf);
    const cached = await this.loadParsedMetaCache(safeUserId, currentPdf);
    const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(taskDir, 'meta_data.json')));
    const cachedMeta = this.asRecord(cached?.metaData);
    const storedMeta = this.asRecord(currentPdf.metaData);
    const baseMeta = this.buildPdfMetaDataRecord(
      currentPdf,
      null,
      currentPdf.referenceIndex || [],
      this.mergeStoredPdfMetaData(codexMeta, cachedMeta, storedMeta)
    );

    const submittedColumns = this.unique((Array.isArray(input.columns) ? input.columns : [])
      .map(column => this.stringifyTableCellValue(column))
      .filter(Boolean));
    const activeColumns = this.getActiveMetaAnalysisColumns(safeUserId);
    const normalizingColumns = this.unique([
      ...activeColumns,
      ...submittedColumns.filter(column => !this.isProtectedMetaAnalysisCodingColumn(column)),
    ]);
    const submittedRows = Array.isArray(input.rows) ? input.rows : [];
    const sanitizedRows = submittedRows
      .map(row => {
        const record = this.asRecord(row);
        const editable: Record<string, unknown> = {};
        const columnsForRow = submittedColumns.length ? submittedColumns : Object.keys(record);
        for (const column of columnsForRow) {
          if (this.isProtectedMetaAnalysisCodingColumn(column)) continue;
          const value = record[column];
          if (!this.isMeaningfulMetaValue(value)) continue;
          editable[column] = value;
        }
        return this.normalizeMetaAnalysisRow(editable, normalizingColumns);
      })
      .filter(row => !this.isAutoImportedDigitizationMetaRow(row))
      .filter(row => Object.keys(row).length > 0);

    const now = new Date().toISOString();
    const updatedMeta = this.removeUndefinedValues({
      ...baseMeta,
      meta_analysis_enabled: true,
      meta_analysis_rows: sanitizedRows,
      meta_analysis_rows_user_edited: true,
      needs_codex_or_manual_review: false,
      extraction_notes: [
        ...this.toDisplayStringArray(baseMeta.extraction_notes),
        `用户手动编辑 Meta 分析编码表并保存：${sanitizedRows.length} 行。`,
      ],
    });
    const updatedPdf: PdfWikiSourcePdf = {
      ...currentPdf,
      metaExcluded: false,
      metaData: updatedMeta,
      metaDataCachedAt: now,
    };
    store.pdfs[pdfIndex] = updatedPdf;
    store.generatedAt = now;
    await this.saveStore(safeUserId, store);

    const dataTable = await this.buildPdfIntegratedDataTable(safeUserId, updatedPdf, updatedMeta);
    return {
      pdfId: targetPdfId,
      deletedRowCount: 0,
      deletedColumnCount: 0,
      protectedColumns: [],
      updatedRowCount: sanitizedRows.length,
      remainingRowCount: dataTable.rowCount,
      dataTable,
    };
  }

  async addMetaAnalysisCodingColumn(userId: string, column: string, afterColumn?: string): Promise<PdfWikiMetaAnalysisTemplateStatus> {
    const safeUserId = sanitizeUserId(userId);
    const requestedColumn = this.stringifyTableCellValue(column).trim();
    const requestedAfterColumn = this.stringifyTableCellValue(afterColumn || '').trim();
    if (!requestedColumn) {
      throw new Error('请输入需要新建的列名');
    }
    if (this.isProtectedMetaAnalysisCodingColumn(requestedColumn)) {
      throw new Error('系统追踪字段不能手动新建或覆盖');
    }

    const existingTemplate = this.loadMetaAnalysisTemplate(safeUserId);
    const baseColumns = existingTemplate?.columns.length
      ? existingTemplate.columns
      : [...PDF_WIKI_META_ANALYSIS_COLUMNS];
    const normalizedColumn = this.normalizeMetaAnalysisColumnIdentity(requestedColumn);
    const normalizedAfterColumn = this.normalizeMetaAnalysisColumnIdentity(requestedAfterColumn);
    const existingColumn = baseColumns.find(existing => this.normalizeMetaAnalysisColumnIdentity(existing) === normalizedColumn);
    if (existingColumn && !normalizedAfterColumn) {
      return this.getMetaAnalysisTemplate(safeUserId);
    }
    const columnToInsert = existingColumn || requestedColumn;
    const insertColumn = (columns: string[]): string[] => {
      const nextColumns = columns.filter(existing => this.normalizeMetaAnalysisColumnIdentity(existing) !== normalizedColumn);
      const afterIndex = normalizedAfterColumn
        ? nextColumns.findIndex(existing => this.normalizeMetaAnalysisColumnIdentity(existing) === normalizedAfterColumn)
        : -1;
      if (afterIndex >= 0) {
        nextColumns.splice(afterIndex + 1, 0, columnToInsert);
      } else {
        nextColumns.push(columnToInsert);
      }
      return nextColumns;
    };

    const now = new Date().toISOString();
    const nextColumns = insertColumn(baseColumns);
    const payload: PdfWikiMetaAnalysisTemplate = {
      filename: existingTemplate?.filename || 'auto-meta-analysis-template.json',
      columns: nextColumns,
      uploadedAt: existingTemplate?.uploadedAt || now,
      sheetName: existingTemplate?.sheetName || '',
      headerRowIndex: existingTemplate?.headerRowIndex,
      sheets: existingTemplate?.sheets && existingTemplate.sheets.length
        ? existingTemplate.sheets.map(sheet => ({
            ...sheet,
            columns: insertColumn(sheet.columns),
          }))
        : [],
    };
    await fs.promises.mkdir(this.getWikiDir(safeUserId), { recursive: true });
    await fs.promises.writeFile(this.getMetaAnalysisTemplatePath(safeUserId), JSON.stringify(payload, null, 2), 'utf-8');
    this.ensureMetaAnalysisUnitRegistryFromColumns(safeUserId, [columnToInsert], 'template');

    return this.getMetaAnalysisTemplate(safeUserId);
  }

  async getMetaTablesForExport(userId: string, tableIds: string[]): Promise<PdfWikiMetaTableExportItem[]> {
    const requestedIds = new Set(tableIds.map(id => String(id || '').trim()).filter(Boolean));
    if (requestedIds.size === 0) return [];

    const store = await this.loadStore(userId);
    const results: PdfWikiMetaTableExportItem[] = [];
    for (const pdf of store.pdfs) {
      if (pdf.metaExcluded === true) continue;
      const cached = await this.loadParsedMetaCache(userId, pdf);
      const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(this.getCodexPdfWikiTaskDir(userId, pdf), 'meta_data.json')));
      const metaData = this.buildPdfMetaDataRecord(
        pdf,
        null,
        pdf.referenceIndex || [],
        this.mergeStoredPdfMetaData(codexMeta, this.asRecord(cached?.metaData), this.asRecord(pdf.metaData))
      );
      if (!this.shouldIncludePdfInMetaDatabase(pdf, metaData)) continue;
      if (!this.isMetaAnalysisDataEnabled(metaData)) continue;
      const tables = await this.getPdfMetaTables(userId, pdf, metaData);
      for (const table of tables) {
        if (!requestedIds.has(table.id)) continue;
        const rows = await this.readMetaTableRows(table);
        results.push({
          ...this.toPublicMetaTableItem(table),
          rows,
        });
      }
    }
    return results;
  }

  async getIntegratedDataTablesForExport(userId: string, pdfIds: string[]): Promise<PdfWikiIntegratedDataTable[]> {
    const requestedIds = new Set(pdfIds.map(id => String(id || '').trim()).filter(Boolean));
    if (requestedIds.size === 0) return [];

    const store = await this.loadStore(userId);
    const results: PdfWikiIntegratedDataTable[] = [];
    for (const pdf of store.pdfs) {
      if (!requestedIds.has(pdf.id)) continue;
      if (pdf.metaExcluded === true) continue;
      const cached = await this.loadParsedMetaCache(userId, pdf);
      const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(this.getCodexPdfWikiTaskDir(userId, pdf), 'meta_data.json')));
      const metaData = this.buildPdfMetaDataRecord(
        pdf,
        null,
        pdf.referenceIndex || [],
        this.mergeStoredPdfMetaData(codexMeta, this.asRecord(cached?.metaData), this.asRecord(pdf.metaData))
      );
      if (!this.shouldIncludePdfInMetaDatabase(pdf, metaData)) continue;
      if (!this.isMetaAnalysisDataEnabled(metaData)) continue;
      results.push(await this.buildPdfIntegratedDataTable(userId, pdf, metaData));
    }
    return results;
  }

  async getMetaEvidenceTablesForExport(userId: string, pdfIds: string[]): Promise<PdfWikiMetaTableExportItem[]> {
    const requestedIds = new Set(pdfIds.map(id => String(id || '').trim()).filter(Boolean));
    if (requestedIds.size === 0) return [];

    const store = await this.loadStore(userId);
    const results: PdfWikiMetaTableExportItem[] = [];
    for (const pdf of store.pdfs) {
      if (!requestedIds.has(pdf.id)) continue;
      if (pdf.metaExcluded === true) continue;
      const cached = await this.loadParsedMetaCache(userId, pdf);
      const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(this.getCodexPdfWikiTaskDir(userId, pdf), 'meta_data.json')));
      const metaData = this.buildPdfMetaDataRecord(
        pdf,
        null,
        pdf.referenceIndex || [],
        this.mergeStoredPdfMetaData(codexMeta, this.asRecord(cached?.metaData), this.asRecord(pdf.metaData))
      );
      if (!this.shouldIncludePdfInMetaDatabase(pdf, metaData)) continue;
      if (!this.isMetaAnalysisDataEnabled(metaData)) continue;
      const tables = await this.getPdfMetaTables(userId, pdf, metaData);
      for (const table of tables) {
        if (this.isGeneratedMetaAnalysisTable(table)) continue;
        const rows = await this.readMetaTableRows(table);
        if (rows.length === 0) continue;
        results.push({
          ...this.toPublicMetaTableItem(table),
          rows,
        });
      }
    }
    return results;
  }

  async getPdfDeepAnalysis(userId: string, pdfId: string): Promise<PdfWikiDeepAnalysisCache | null> {
    const cached = await this.loadDeepAnalysisCache(userId, pdfId);
    if (!cached || !cached.summaryMarkdown || !this.shouldRebuildOverviewDiagram(cached.overviewDiagram)) {
      return cached;
    }

    const store = await this.loadStore(userId);
    const pdf = store.pdfs.find(item => item.id === pdfId);
    if (!pdf) return cached;

    const overviewDiagram = this.ensureUsableOverviewDiagram(pdf, null, cached.summaryMarkdown, cached.overviewDiagram);
    const upgraded: PdfWikiDeepAnalysisResult = {
      ...cached,
      pdf,
      overviewDiagram,
    };
    await this.saveDeepAnalysisCache(userId, upgraded);
    await this.persistOverviewDiagramAsFirstFigure(userId, pdf, overviewDiagram);
    store.pdfs = store.pdfs.map(item => item.id === pdf.id ? pdf : item);
    store.generatedAt = new Date().toISOString();
    await this.saveStore(userId, store);
    return {
      pdfId: upgraded.pdfId,
      parser: upgraded.parser,
      textLength: upgraded.textLength,
      textPreview: upgraded.textPreview,
      metadata: upgraded.metadata,
      referenceCount: upgraded.referenceCount,
      summaryMarkdown: upgraded.summaryMarkdown,
      researchRelevanceMarkdown: upgraded.researchRelevanceMarkdown,
      userResearchContext: upgraded.userResearchContext,
      analysisEngine: upgraded.analysisEngine,
      overviewDiagram: upgraded.overviewDiagram,
      usableItems: upgraded.usableItems,
      wikiSync: upgraded.wikiSync,
      analyzedAt: upgraded.analyzedAt,
    };
  }

  async getPdfReaderFullText(userId: string, pdfId: string): Promise<{
    pdf: PdfWikiSourcePdf;
    text: string;
    parser: string;
  } | null> {
    const store = await this.loadStore(userId);
    const targetPdfId = String(pdfId || '').trim();
    const pdf = store.pdfs.find(item => item.id === targetPdfId);
    if (!pdf) return null;

    const cached = await this.loadParsedTextCache(userId, pdf);
    if (cached?.text) {
      return {
        pdf,
        text: cached.text,
        parser: cached.parser,
      };
    }

    if (pdf.filePath && fs.existsSync(pdf.filePath)) {
      const text = this.normalizeExtractedText(await this.extractPdfTextWithPdfParse(pdf.filePath));
      if (text) {
        return {
          pdf,
          text,
          parser: 'pdf-parse',
        };
      }
    }

    return {
      pdf,
      text: [
        pdf.title || pdf.originalName || '',
        pdf.authors ? `Authors: ${pdf.authors}` : '',
        pdf.year ? `Year: ${pdf.year}` : '',
        pdf.journal ? `Journal: ${pdf.journal}` : '',
        pdf.doi ? `DOI: ${pdf.doi}` : '',
      ].filter(Boolean).join('\n'),
      parser: 'metadata-only',
    };
  }

  async getPdfReaderChatSession(userId: string, pdfId: string): Promise<PdfWikiReaderChatSession> {
    const safeUserId = sanitizeUserId(userId);
    const targetPdfId = String(pdfId || '').trim();
    const store = await this.loadStore(safeUserId);
    const pdf = store.pdfs.find(item => item.id === targetPdfId);
    if (!pdf) {
      throw new Error('未找到该 PDF，请先上传并识别 PDF');
    }
    return this.normalizeReaderChatSession(store.readerChatSessions?.[targetPdfId], targetPdfId);
  }

  async appendPdfReaderChatTurn(
    userId: string,
    pdfId: string,
    userMessage: string,
    assistantMessage: string
  ): Promise<PdfWikiReaderChatSession> {
    const safeUserId = sanitizeUserId(userId);
    const targetPdfId = String(pdfId || '').trim();
    const userContent = this.cleanReaderChatText(userMessage, 4000);
    const assistantContent = this.cleanReaderChatText(assistantMessage, 12000);
    if (!targetPdfId || !userContent || !assistantContent) {
      throw new Error('PDF 阅读器会话保存失败：缺少 PDF、用户问题或 AI 回复');
    }

    const store = await this.loadStore(safeUserId);
    const pdf = store.pdfs.find(item => item.id === targetPdfId);
    if (!pdf) {
      throw new Error('未找到该 PDF，请先上传并识别 PDF');
    }

    const now = new Date().toISOString();
    const existing = this.normalizeReaderChatSession(store.readerChatSessions?.[targetPdfId], targetPdfId);
    const messages = [
      ...existing.messages,
      { role: 'user' as const, content: userContent, createdAt: now },
      { role: 'assistant' as const, content: assistantContent, createdAt: now },
    ].slice(-200);
    const session: PdfWikiReaderChatSession = {
      pdfId: targetPdfId,
      updatedAt: now,
      messages,
    };
    store.readerChatSessions = {
      ...(store.readerChatSessions || {}),
      [targetPdfId]: session,
    };
    store.generatedAt = now;
    await this.saveStore(safeUserId, store);
    return session;
  }

  async analyzePdfDeep(
    userId: string,
    pdfId: string,
    llmConfig: PdfWikiLlmConfig,
    options: { force?: boolean; vectorConfig?: PdfWikiVectorConfig } = {}
  ): Promise<PdfWikiDeepAnalysisResult> {
    const store = await this.loadStore(userId);
    const pdf = store.pdfs.find(item => item.id === pdfId);
    if (!pdf) {
      throw new Error('未找到该 PDF，请先上传并处理 PDF');
    }

    const userResearchContext = await this.loadUserResearchContextForDeepAnalysis(userId);
    let cachedAnalysis = options.force ? null : await this.loadDeepAnalysisCache(userId, pdfId);
    if (cachedAnalysis && !cachedAnalysis.wikiSync) {
      cachedAnalysis = await this.backfillDeepAnalysisWikiSync(
        userId,
        store,
        pdf,
        cachedAnalysis,
        userResearchContext,
        options.vectorConfig
      );
    }
    if (cachedAnalysis) {
      if (this.shouldRebuildOverviewDiagram(cachedAnalysis.overviewDiagram) && cachedAnalysis.summaryMarkdown) {
        const upgraded: PdfWikiDeepAnalysisResult = {
          ...cachedAnalysis,
          pdf,
          overviewDiagram: this.buildCodePdfOverviewDiagram(pdf, null, cachedAnalysis.summaryMarkdown),
        };
        await this.saveDeepAnalysisCache(userId, upgraded);
        if (upgraded.overviewDiagram) {
          await this.persistOverviewDiagramAsFirstFigure(userId, pdf, upgraded.overviewDiagram);
          store.pdfs = store.pdfs.map(item => item.id === pdf.id ? pdf : item);
          store.generatedAt = new Date().toISOString();
          await this.saveStore(userId, store);
        }
        return {
          ...upgraded,
          fromCache: true,
        };
      }
      if (cachedAnalysis.overviewDiagram) {
        await this.persistOverviewDiagramAsFirstFigure(userId, pdf, cachedAnalysis.overviewDiagram);
        store.pdfs = store.pdfs.map(item => item.id === pdf.id ? pdf : item);
        store.generatedAt = new Date().toISOString();
        await this.saveStore(userId, store);
      }
      return {
        ...cachedAnalysis,
        pdf,
        fromCache: true,
      };
    }

    const codexConfig = this.canUseCodexCli() && this.shouldUseCodexForDeepAnalysis(llmConfig)
      ? this.loadPdfWikiCodexConfig()
      : null;
    if ((!llmConfig.apiUrl || !llmConfig.apiKey) && !codexConfig) {
      throw new Error('请先启用 Codex CLI 优先，或配置可用于深入分析的小牛马 API');
    }

    const cachedParsed = await this.loadParsedTextCache(userId, pdf);
    let parsed = codexConfig ? (cachedParsed || null) : (cachedParsed || await this.extractPdfTextForDeepAnalysis(userId, pdf));
    if (!parsed && !codexConfig) {
      throw new Error('未找到该 PDF 已缓存的文字版内容，且 LiteParse/Marker/pdf-marker-md/pdf-parse 均未提取到文本。请先重新识别 PDF，或检查 PDF 是否为扫描件/加密文件。');
    }

    let metadata = parsed
      ? this.cleanSourceMetadata({
        ...this.inferSourceMetadata(pdf.originalName, parsed.text),
        ...this.removeEmptyMetadata(parsed.metadata),
      })
      : this.cleanSourceMetadata({
        ...this.inferSourceMetadata(pdf.originalName, ''),
        title: pdf.title,
        authors: pdf.authors,
        year: pdf.year,
        journal: pdf.journal,
        doi: pdf.doi,
      });
    const applyParsedPdfMetadata = async (): Promise<void> => {
      if (!parsed) return;
      metadata = this.cleanSourceMetadata({
        ...this.inferSourceMetadata(pdf.originalName, parsed.text),
        ...this.removeEmptyMetadata(parsed.metadata),
      });
      Object.assign(pdf, metadata, {
        referenceIndex: parsed.references,
        textLength: parsed.text.length,
        extractionParser: parsed.parser,
        processedAt: new Date().toISOString(),
      });
      await this.saveStore(userId, store);
    };
    if (parsed) await applyParsedPdfMetadata();

    let summaryMarkdown = '';
    let overviewDiagram: PdfWikiOverviewDiagram | undefined;
    let evidenceDrafts: PdfWikiDeepAnalysisEvidenceDraft[] = [];
    let analysisEngine: PdfWikiDeepAnalysisCache['analysisEngine'] = 'secondary-api';
    if (codexConfig) {
      try {
        const codexAnalysis = await this.summarizePdfForDeepAnalysisWithCodex(userId, pdf, null, codexConfig, userResearchContext);
        summaryMarkdown = codexAnalysis.summaryMarkdown;
        overviewDiagram = codexAnalysis.overviewDiagram;
        evidenceDrafts = codexAnalysis.evidenceDrafts || [];
        analysisEngine = 'codex';
      } catch (error) {
        logger.warn(`[PdfWiki] Codex deep analysis failed for ${pdf.originalName}, falling back:`, error);
      }
    }
    if (!summaryMarkdown) {
      if (!parsed) {
        parsed = cachedParsed || await this.extractPdfTextForDeepAnalysis(userId, pdf);
        if (parsed) await applyParsedPdfMetadata();
      }
      if (parsed && llmConfig.apiUrl && llmConfig.apiKey) {
        try {
          const apiAnalysis = await this.summarizePdfForDeepAnalysisWithApiFallback(pdf, parsed, llmConfig, userResearchContext);
          summaryMarkdown = apiAnalysis.summaryMarkdown;
          analysisEngine = apiAnalysis.analysisEngine;
        } catch (error) {
          logger.warn(`[PdfWiki] API deep analysis failed for ${pdf.originalName}, falling back to local text analysis:`, error);
          summaryMarkdown = this.buildLocalDeepAnalysisMarkdown(pdf, parsed, userResearchContext);
          analysisEngine = 'local';
        }
      } else if (parsed) {
        summaryMarkdown = this.buildLocalDeepAnalysisMarkdown(pdf, parsed, userResearchContext);
        analysisEngine = 'local';
      } else {
        throw new Error('Codex 深入分析失败，且没有可用于降级分析的 PDF 文本或 API 配置');
      }
    }
    if (!String(summaryMarkdown || '').trim() && parsed) {
      logger.warn(`[PdfWiki] Deep analysis text is empty for ${pdf.originalName}, forcing local text analysis`);
      summaryMarkdown = this.buildLocalDeepAnalysisMarkdown(pdf, parsed, userResearchContext);
      analysisEngine = 'local';
    }
    let researchRelevanceMarkdown = this.extractResearchRelevanceMarkdown(summaryMarkdown);
    if (!researchRelevanceMarkdown) {
      researchRelevanceMarkdown = this.buildLocalResearchRelevanceMarkdown(userResearchContext);
      summaryMarkdown = `${String(summaryMarkdown || '').trim()}\n\n## 与用户现有研究的关系\n${researchRelevanceMarkdown}`.trim();
    }
    if (!overviewDiagram) {
      overviewDiagram = await this.buildOverviewDiagramWithSecondaryApi(pdf, parsed, summaryMarkdown, llmConfig)
        || this.buildCodePdfOverviewDiagram(pdf, parsed, summaryMarkdown);
    }
    overviewDiagram = this.ensureUsableOverviewDiagram(pdf, parsed, summaryMarkdown, overviewDiagram);
    if (overviewDiagram) {
      await this.persistOverviewDiagramAsFirstFigure(userId, pdf, overviewDiagram);
      store.pdfs = store.pdfs.map(item => item.id === pdf.id ? pdf : item);
      store.generatedAt = new Date().toISOString();
      await this.saveStore(userId, store);
    }

    if (!parsed) {
      parsed = cachedParsed || await this.extractPdfTextForDeepAnalysis(userId, pdf).catch(() => null);
    }
    if (evidenceDrafts.length === 0 && parsed && llmConfig.apiUrl && llmConfig.apiKey) {
      try {
        evidenceDrafts = await this.extractDeepAnalysisEvidenceDrafts(
          pdf,
          parsed,
          summaryMarkdown,
          llmConfig,
          userResearchContext
        );
      } catch (error) {
        logger.warn(`[PdfWiki] Structured deep-analysis evidence extraction failed for ${pdf.originalName}:`, error);
      }
    }
    const usableItems = this.buildDeepAnalysisEvidenceItems(
      pdf,
      parsed,
      summaryMarkdown,
      evidenceDrafts,
      userResearchContext
    );
    const wikiSync = await this.syncDeepAnalysisEvidenceToWiki(
      userId,
      store,
      pdf,
      usableItems,
      options.vectorConfig
    );

    const result: PdfWikiDeepAnalysisResult = {
      pdfId: pdf.id,
      pdf,
      parser: parsed?.parser || this.normalizeParsedContentParser(pdf.extractionParser),
      textLength: parsed?.text.length || pdf.textLength || 0,
      textPreview: parsed?.text.slice(0, 1800) || '',
      metadata,
      referenceCount: parsed?.references.length || pdf.referenceIndex?.length || 0,
      summaryMarkdown,
      researchRelevanceMarkdown,
      userResearchContext: this.toDeepAnalysisUserResearchContextSummary(userResearchContext),
      analysisEngine,
      overviewDiagram,
      usableItems,
      wikiSync,
      analyzedAt: new Date().toISOString(),
    };
    await this.saveDeepAnalysisCache(userId, result);
    return result;
  }

  async deleteEntries(userId: string, entryIds: string[]): Promise<{ deletedCount: number; entryCount: number }> {
    const ids = this.unique(entryIds);
    if (ids.length === 0) {
      throw new Error('请选择要删除的论点');
    }

    const store = await this.loadStore(userId);
    const idSet = new Set(ids);
    const beforeCount = store.entries.length;
    store.entries = store.entries.filter(entry => !idSet.has(entry.id));
    const deletedCount = beforeCount - store.entries.length;

    if (deletedCount === 0) {
      throw new Error('未找到要删除的论点');
    }

    await this.persistManualStoreUpdate(userId, store, `已删除 ${deletedCount} 个 PDF Wiki 论点组`);
    return { deletedCount, entryCount: store.entries.length };
  }

  async deleteSentencePoints(userId: string, pointIds: string[]): Promise<{
    deletedCount: number;
    missingCount: number;
    sentencePointCount: number;
    topicCount: number;
  }> {
    const ids = this.unique(pointIds);
    if (ids.length === 0) {
      throw new Error('请选择要删除的句子级论点');
    }

    const store = await this.loadStore(userId);
    const idSet = new Set(ids);
    const existingPoints = store.sentenceCloud?.points || [];
    const retainedPoints = existingPoints.filter(point => !idSet.has(point.id));
    const deletedCount = existingPoints.length - retainedPoints.length;

    if (deletedCount === 0) {
      throw new Error('未找到要删除的句子级论点');
    }

    store.sentenceCloud = this.buildSentenceCloudStore(retainedPoints);
    await this.persistManualStoreUpdate(userId, store, `已删除 ${deletedCount} 个 PDF Wiki 句子级论点`);
    return {
      deletedCount,
      missingCount: ids.length - deletedCount,
      sentencePointCount: store.sentenceCloud.points.length,
      topicCount: store.sentenceCloud.clouds.length,
    };
  }

  async deletePdfs(userId: string, pdfIds: string[]): Promise<{
    deletedCount: number;
    missingCount: number;
    pdfCount: number;
    entryCount: number;
    sentencePointCount: number;
  }> {
    const ids = this.unique(pdfIds);
    if (ids.length === 0) {
      throw new Error('请选择要删除的 PDF');
    }

    const store = await this.loadStore(userId);
    const idSet = new Set(ids);
    const removedPdfs = store.pdfs.filter(pdf => idSet.has(pdf.id));
    if (removedPdfs.length === 0) {
      throw new Error('未找到要删除的 PDF');
    }
    const removedPdfIds = new Set(removedPdfs.map(pdf => pdf.id));

    store.pdfs = store.pdfs.filter(pdf => !removedPdfIds.has(pdf.id));
    store.entries = store.entries.filter(entry => {
      const sourceIds = Array.isArray(entry.sourcePdfIds) ? entry.sourcePdfIds : [];
      return !sourceIds.some(pdfId => removedPdfIds.has(pdfId));
    });
    const retainedPoints = (store.sentenceCloud?.points || []).filter(point => !removedPdfIds.has(point.sourcePdfId));
    store.sentenceCloud = this.buildSentenceCloudStore(retainedPoints);
    store.referenceIndex = this.mergeReferenceIndexes(...store.pdfs.map(pdf => pdf.referenceIndex || []));
    if (store.readerChatSessions) {
      removedPdfIds.forEach(pdfId => {
        delete store.readerChatSessions?.[pdfId];
      });
    }
    store.generatedAt = new Date().toISOString();
    await this.saveStore(userId, store);

    removedPdfs.forEach(pdf => {
      this.deletePdfLocalFiles(userId, pdf);
    });
    this.clearEngine(userId);
    this.removeIndexCache(userId);

    await this.saveStatus(userId, {
      status: 'completed',
      totalPdfs: store.pdfs.length,
      processedPdfs: store.pdfs.length,
      totalChunks: 0,
      processedChunks: 0,
      entryCount: store.entries.length,
      sentencePointCount: store.sentenceCloud?.points?.length || 0,
      message: `已删除 ${removedPdfs.length} 个 PDF`,
      updatedAt: store.generatedAt,
    });

    return {
      deletedCount: removedPdfs.length,
      missingCount: ids.length - removedPdfs.length,
      pdfCount: store.pdfs.length,
      entryCount: store.entries.length,
      sentencePointCount: store.sentenceCloud?.points?.length || 0,
    };
  }

  async mergeEntries(
    userId: string,
    entryIds: string[],
    normalizedClaim?: string
  ): Promise<{ mergedCount: number; entryCount: number; mergedEntry: PdfWikiEntry }> {
    const ids = this.unique(entryIds);
    if (ids.length < 2) {
      throw new Error('请至少选择 2 个论点进行合并');
    }

    const store = await this.loadStore(userId);
    const entryMap = new Map(store.entries.map(entry => [entry.id, entry]));
    const selectedEntries = ids.map(id => entryMap.get(id)).filter((entry): entry is PdfWikiEntry => !!entry);

    if (selectedEntries.length < 2) {
      throw new Error('未找到足够的论点进行合并');
    }

    const selectedIdSet = new Set(selectedEntries.map(entry => entry.id));
    const mergedEntry = this.mergeEntrySelection(selectedEntries, normalizedClaim);
    store.entries = [
      ...store.entries.filter(entry => !selectedIdSet.has(entry.id)),
      mergedEntry,
    ];

    await this.persistManualStoreUpdate(userId, store, `已合并 ${selectedEntries.length} 个 PDF Wiki 论点组`);
    return { mergedCount: selectedEntries.length, entryCount: store.entries.length, mergedEntry };
  }

  async addManualSentenceClaim(
    userId: string,
    pdfId: string,
    input: PdfWikiManualSentenceClaimInput
  ): Promise<PdfWikiManualSentenceClaimResult> {
    const safeUserId = sanitizeUserId(userId);
    const sentence = this.cleanSentencePointText(String(input.sentence || '')).slice(0, 4000);
    if (!sentence || sentence.length < 8) {
      throw new Error('请先选中一句需要保存到论点库的原文');
    }

    const store = await this.loadStore(safeUserId);
    const pdf = store.pdfs.find(item => item.id === pdfId);
    if (!pdf) {
      throw new Error('未找到该 PDF，请先上传并识别 PDF');
    }

    const referencePool = this.uniqueReferences([
      ...(pdf.referenceIndex || []),
      ...(store.referenceIndex || []).filter(ref => !ref.sourcePdfId || ref.sourcePdfId === pdf.id),
    ]);
    const pageNumber = Number(input.pageNumber || 0);
    const location = await this.inferManualSentenceLocation(safeUserId, pdf, sentence, input.section, pageNumber);
    const citations = this.extractInTextCitations(sentence);
    const references = this.deduplicateSentencePointReferences(
      this.matchReferencesForCitations(citations, referencePool, [pdf.id]).map(ref => ({
        ...ref,
        matchType: 'citation' as const,
        matchScore: 1,
      })),
      8
    );
    const topicDefinitions = (await this.getTopicCatalog(safeUserId)).topics;
    const topic = this.inferSentencePointTopic(sentence, topicDefinitions);
    const inferredClaim = this.inferSentenceClaimCandidate(sentence, location.section, references.length, citations);
    const claimText = this.cleanSentencePointText(input.claimText || inferredClaim.claimText || this.deriveSentenceClaimText(sentence));
    const hash = crypto.createHash('md5')
      .update(`${safeUserId}:${pdf.id}:${location.section}:${sentence}`)
      .digest('hex')
      .slice(0, 18);
    const id = `manual_sent_${hash}`;
    const positionSeed = this.seededPointPosition(id, topic.key);
    const confidence = references.length > 0
      ? this.calculateSentencePointConfidence(references, citations)
      : 0.62;
    const point: PdfWikiSentencePoint = {
      id,
      sourcePdfId: pdf.id,
      sourcePdfName: pdf.originalName,
      sourcePdfTitle: pdf.title,
      section: location.section,
      sentenceIndex: location.sentenceIndex,
      sentence,
      citations: this.unique(citations),
      references,
      referenceCount: references.length,
      claimCandidate: true,
      claimText: claimText || sentence,
      claimType: inferredClaim.claimType === 'non_claim' ? 'argument' : inferredClaim.claimType,
      claimReason: this.unique([
        '用户在 PDF 阅读器中手动保存为论点。',
        inferredClaim.claimReason || '',
        pageNumber > 0 ? `来源页码：p.${pageNumber}` : '',
        references.length > 0 ? '已根据句中文内引用匹配参考文献。' : '句中未检测到显式文内引用；来源论文已通过 PDF 元数据绑定。',
      ].filter(Boolean)).join(' '),
      topicKey: topic.key,
      topicLabel: topic.label,
      keywords: topic.keywords,
      x: positionSeed.x,
      y: positionSeed.y,
      radius: Math.min(38, 10 + Math.max(0, references.length) * 5),
      matchMethod: this.getSentencePointMatchMethod(references),
      confidence: Math.round(confidence * 1000) / 1000,
    };

    const existingPoints = (store.sentenceCloud?.points || []).filter(item => item.id !== id);
    store.sentenceCloud = this.buildSentenceCloudStore([...existingPoints, point]);
    const entry = this.sentencePointToEntry(point);
    await this.persistManualStoreUpdate(safeUserId, store, `已保存 1 句原文到 Wiki论点库`);
    return {
      point,
      entry,
      sentencePointCount: store.sentenceCloud.points.length,
      entryCount: store.entries.length,
      referenceCount: references.length,
      sourcePdf: pdf,
    };
  }

  async getEntryMap(userId: string): Promise<Map<string, PdfWikiEntry>> {
    const store = await this.loadStore(userId);
    const entries = [
      ...store.entries,
      ...this.filterPublishableSentencePoints(store.sentenceCloud?.points || []).map(point => this.sentencePointToEntry(point)),
    ];
    return new Map(entries.map(entry => [entry.id, entry]));
  }

  async getEngine(userId: string, vectorConfig: PdfWikiVectorConfig): Promise<HybridRetrievalEngine> {
    const vectorConfigKey = [
      Boolean(vectorConfig.apiUrl && vectorConfig.apiKey) ? 'remote' : 'bm25-fallback',
      vectorConfig.apiUrl || '',
      vectorConfig.model,
      vectorConfig.dimensions,
    ].join('|');
    const cached = this.engines.get(userId);
    if (cached && cached.vectorConfigKey === vectorConfigKey) {
      cached.engine.updateApiConfig({
        url: vectorConfig.apiUrl,
        key: vectorConfig.apiKey,
        model: vectorConfig.model,
        dimensions: vectorConfig.dimensions,
      });
      cached.updatedAt = Date.now();
      return cached.engine;
    }
    if (cached) this.engines.delete(userId);

    const store = await this.getStore(userId);
    const literatures = this.storeToRetrievalLiteratures(store);
    if (literatures.length === 0) {
      throw new Error('PDF Wiki 文献库为空，请先上传 PDF 并等待 Wiki论点库生成完成');
    }

    const engine = new HybridRetrievalEngine({
      vector: {
        model: vectorConfig.model,
        dimensions: vectorConfig.dimensions,
        topN: 50,
        similarity: 'cosine',
      },
    }, {
      url: vectorConfig.apiUrl,
      key: vectorConfig.apiKey,
    });

    const cacheDir = this.getIndexCacheDir(userId);
    engine.setPersistenceDirectory(cacheDir);
    if (!engine.loadIndex(cacheDir)) {
      await engine.index(literatures);
      engine.saveIndex(cacheDir);
    }

    this.engines.set(userId, { engine, updatedAt: Date.now(), vectorConfigKey });
    return engine;
  }

  clearEngine(userId: string): void {
    this.engines.delete(userId);
  }

  clearAllEngines(): void {
    this.engines.clear();
  }

  private async runExclusiveBuild(userId: string, task: () => Promise<void>): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    const previous = this.buildLocks.get(safeUserId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    this.buildLocks.set(safeUserId, current);

    try {
      await current;
    } finally {
      if (this.buildLocks.get(safeUserId) === current) {
        this.buildLocks.delete(safeUserId);
      }
    }
  }

  private async buildWiki(
    userId: string,
    pdfs: PdfWikiSourcePdf[],
    llmConfig: PdfWikiLlmConfig,
    replaceExisting: boolean
  ): Promise<void> {
    const textExtractionEngine = this.getTextExtractionEngine(llmConfig);
    const claimExtractionEngine = this.getClaimExtractionEngine(llmConfig);
    const sentenceReferenceMatchingEngine = this.getSentenceReferenceMatchingEngine(llmConfig);
    const localSentenceBuild = this.isLocalSentenceWikiBuild(llmConfig);
    const fastCodexSentenceBuild = this.isFastCodexSentenceWikiBuild(llmConfig);
    const codexAvailable = this.canUseCodexCli(fastCodexSentenceBuild || sentenceReferenceMatchingEngine === 'codex');
    const codexConfig = codexAvailable ? this.loadPdfWikiCodexConfig() : null;
    const codexConcurrency = codexConfig?.concurrency || 1;
    const canUseCodexFullBuild = !!codexAvailable && !!codexConfig && this.shouldUseCodexFullBuild(llmConfig);
    const canUseQwenDirectBuild = this.shouldUseQwenLongDirectBuild(llmConfig);
    const fastWorkTotalUnits = fastCodexSentenceBuild ? Math.max(1, pdfs.length * 2 + 1) : 0;
    const fastWorkProgress = (
      phase: PdfWikiWorkProgress['phase'],
      phaseLabel: string,
      completedUnits: number,
      currentPdfIndex?: number,
      currentPdfName?: string,
      attempt?: number,
      maxAttempts?: number,
      attemptElapsedMs?: number
    ): PdfWikiWorkProgress | undefined => fastCodexSentenceBuild ? {
      phase,
      phaseLabel,
      phaseIndex: phase === 'extracting' ? 1 : (phase === 'codex' ? 2 : (phase === 'completed' ? 3 : 3)),
      phaseCount: 3,
      completedUnits: Math.max(0, Math.min(fastWorkTotalUnits, completedUnits)),
      totalUnits: fastWorkTotalUnits,
      currentPdfIndex,
      currentPdfName,
      attempt,
      maxAttempts,
      attemptElapsedMs,
    } : undefined;
    if (fastCodexSentenceBuild && (!codexAvailable || !codexConfig)) {
      await this.saveStatus(userId, {
        ...DEFAULT_STATUS,
        status: 'error',
        totalPdfs: pdfs.length,
        message: 'PDF Wiki 快速生成失败：快速模式需要可用的 Codex CLI 来核对句中/句末引用，并归纳绑定来源论文引用的主要结论',
        error: 'CODEX_NOT_AVAILABLE',
        updatedAt: new Date().toISOString(),
      });
      return;
    }
    if ((!llmConfig.apiUrl || !llmConfig.apiKey) && !codexAvailable && !localSentenceBuild) {
      await this.saveStatus(userId, {
        ...DEFAULT_STATUS,
        status: 'error',
        totalPdfs: pdfs.length,
        message: 'PDF Wiki 生成失败：请先配置 Codex CLI，或配置可用于论点抽取的 LLM API（千问 API/小牛马 API）',
        error: 'API_NOT_CONFIGURED',
        updatedAt: new Date().toISOString(),
      });
      return;
    }

    const startedAt = new Date().toISOString();
    await this.saveStatus(userId, {
      status: 'processing',
      taskKind: 'pdf-wiki',
      totalPdfs: pdfs.length,
      processedPdfs: 0,
      totalChunks: 0,
      processedChunks: 0,
      entryCount: 0,
      workProgress: fastWorkProgress('preparing', '准备任务', 0),
      message: fastCodexSentenceBuild
        ? `正在快速生成 PDF 句子级 Wiki：LiteParse 提取引言/讨论/结论/References，Codex 只整理显式引用句和本文主要结论，已关闭兼容论点和 Meta 提取`
        : localSentenceBuild
        ? `正在快速生成 PDF 句子级 Wiki：文本提取=${textExtractionEngine}，元信息/引用/分组均使用本地规则，已关闭兼容论点和 Meta 提取`
        : (codexAvailable
          ? `正在生成 PDF Wiki：处理方案=${llmConfig.processingProfile || 'custom'}，文本提取=${textExtractionEngine}，句子引用匹配=${sentenceReferenceMatchingEngine}，论点抽取=${claimExtractionEngine}，Codex 并发 ${codexConcurrency}`
          : `正在生成 PDF Wiki：处理方案=${llmConfig.processingProfile || 'custom'}，文本提取=${textExtractionEngine}，句子引用匹配=${sentenceReferenceMatchingEngine}，论点抽取=${claimExtractionEngine}`),
      startedAt,
      updatedAt: startedAt,
    });

    try {
      const topicDefinitions = (await this.getTopicCatalog(userId)).topics;
      const existingStore = replaceExisting ? this.createEmptyStore(userId) : await this.loadStore(userId);
      const replacingPdfIds = new Set(pdfs.map(pdf => pdf.id));
      const retainedEntries = existingStore.entries.filter(entry => !entry.sourcePdfIds.some(id => replacingPdfIds.has(id)));
      const retainedSentencePoints = (existingStore.sentenceCloud?.points || []).filter(point => !replacingPdfIds.has(point.sourcePdfId));
      const retainedPdfs = existingStore.pdfs.filter(pdf => !replacingPdfIds.has(pdf.id));
      const newEntries: PdfWikiEntry[] = [];
      const newSentencePoints: PdfWikiSentencePoint[] = [];
      const processedPdfs: PdfWikiSourcePdf[] = [];
      const failedPdfs: PdfWikiSourcePdf[] = [];
      const retainedReferenceIndex = existingStore.referenceIndex || retainedPdfs.flatMap(pdf => pdf.referenceIndex || []);
      let totalChunks = 0;
      let processedChunks = 0;
      const codexBuilds = new Map<string, PdfWikiCodexBuildResult | null>();

      if (canUseCodexFullBuild && codexConfig && pdfs.length > 0) {
        let completedCodexPdfs = 0;
        await this.saveStatus(userId, {
          status: 'processing',
          totalPdfs: pdfs.length,
          processedPdfs: 0,
          totalChunks,
          processedChunks,
          entryCount: newEntries.length,
          message: `阶段 1/3：正在并行启动 Codex CLI 解析 PDF（并发 ${codexConcurrency}）`,
          startedAt,
          updatedAt: new Date().toISOString(),
        });

        await this.mapWithConcurrency(pdfs, codexConcurrency, async (pdf) => {
          const result = await this.tryBuildPdfWithCodex(userId, pdf, codexConfig, llmConfig, async (message) => {
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: completedCodexPdfs,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          });
          codexBuilds.set(pdf.id, result);
          completedCodexPdfs++;
          await this.saveStatus(userId, {
            status: 'processing',
            totalPdfs: pdfs.length,
            processedPdfs: completedCodexPdfs,
            totalChunks,
            processedChunks,
            entryCount: newEntries.length,
            message: `阶段 1/3：Codex CLI 并行解析 ${completedCodexPdfs}/${pdfs.length}（并发 ${codexConcurrency}）`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });
        });
      }

      for (let pdfIndex = 0; pdfIndex < pdfs.length; pdfIndex++) {
        const pdf = pdfs[pdfIndex];
        await this.saveStatus(userId, {
          status: 'processing',
          taskKind: 'pdf-wiki',
          totalPdfs: pdfs.length,
          processedPdfs: fastCodexSentenceBuild ? processedPdfs.length : pdfIndex,
          totalChunks,
          processedChunks,
          entryCount: newEntries.length,
          failedPdfs: failedPdfs.length,
          workProgress: fastWorkProgress('extracting', '提取章节与参考文献', pdfIndex * 2, pdfIndex + 1, pdf.originalName),
          message: `正在解析 PDF：${pdf.originalName}`,
          startedAt,
          updatedAt: new Date().toISOString(),
        });

        try {
          const hasLiteParse = isLiteParseAvailable() && this.shouldUseLiteParseForTextExtraction(llmConfig);
          const hasMarker = isPdfMarkerAvailable() && this.shouldUseMarkerForTextExtraction(llmConfig);
          const hasFastText = isPdfFastTextAvailable() && this.shouldUseFastTextForTextExtraction(llmConfig);
          await this.saveStatus(userId, {
            status: 'processing',
            taskKind: 'pdf-wiki',
            totalPdfs: pdfs.length,
            processedPdfs: fastCodexSentenceBuild ? processedPdfs.length : pdfIndex,
            totalChunks,
            processedChunks,
            entryCount: newEntries.length,
            failedPdfs: failedPdfs.length,
            workProgress: fastWorkProgress('extracting', '提取章节与参考文献', pdfIndex * 2, pdfIndex + 1, pdf.originalName),
            message: canUseCodexFullBuild
              ? `阶段 1/3：正在优先使用 Codex CLI 直读 ${pdf.originalName}`
              : (hasLiteParse
                ? `阶段 1/3：正在使用 LiteParse 本地解析 ${pdf.originalName}`
                : (hasMarker
                  ? `阶段 1/3：正在使用 Marker 外部工具解析 ${pdf.originalName}`
                  : (hasFastText
                    ? `阶段 1/3：正在使用 pdf-marker-md 快速文本解析 ${pdf.originalName}`
                  : (canUseQwenDirectBuild
                    ? `阶段 1/3：正在尝试将 ${pdf.originalName} 直传给 Qwen-VL-Max`
                    : `阶段 1/3：正在准备解析 ${pdf.originalName}`)))),
            startedAt,
            updatedAt: new Date().toISOString(),
          });

          let parsedContent: PdfWikiParsedContent | null = null;
          const codexBuild = canUseCodexFullBuild
            ? (codexBuilds.has(pdf.id) ? codexBuilds.get(pdf.id) || null : await this.tryBuildPdfWithCodex(userId, pdf, codexConfig || undefined, llmConfig, async (message) => {
              await this.saveStatus(userId, {
                status: 'processing',
                totalPdfs: pdfs.length,
                processedPdfs: pdfIndex,
                totalChunks,
                processedChunks,
                entryCount: newEntries.length,
                message,
                startedAt,
                updatedAt: new Date().toISOString(),
              });
            }))
            : null;
          if (codexBuild) {
            Object.assign(pdf, codexBuild.referenceIndex.metadata);
            pdf.referenceIndex = codexBuild.referenceIndex.references;
            parsedContent = codexBuild.parsedContent;

            if (codexBuild.entries.length > 0) {
              pdf.textLength = codexBuild.parsedContent.text.length;
              pdf.processedAt = new Date().toISOString();
              pdf.extractionParser = codexBuild.parsedContent.parser;
              const codexRawMetaData = this.getMetaAnalysisEngine(llmConfig) === 'api'
                ? await this.extractMetaAnalysisDataWithApi(userId, pdf, codexBuild.parsedContent, llmConfig)
                : codexBuild.parsedContent.metaData;
              pdf.metaData = this.applyMetaAnalysisPreference(
                this.buildPdfMetaDataRecord(pdf, codexBuild.parsedContent, codexBuild.referenceIndex.references, codexRawMetaData),
                llmConfig
              );
              pdf.metaDataCachedAt = pdf.processedAt;
              newSentencePoints.push(...this.buildSentenceCloudPointsFromText(codexBuild.parsedContent.text, pdf, codexBuild.referenceIndex.references, topicDefinitions));
              newEntries.push(...codexBuild.entries);
              totalChunks += 1;
              processedChunks += 1;
              processedPdfs.push(pdf);

              await this.saveStatus(userId, {
                status: 'processing',
                totalPdfs: pdfs.length,
                processedPdfs: pdfIndex + 1,
                totalChunks,
                processedChunks,
                entryCount: newEntries.length,
                message: `Codex CLI 已完成 ${pdf.originalName} 的全文提取和 PDF Wiki 论点抽取`,
                startedAt,
                updatedAt: new Date().toISOString(),
              });
              continue;
            }
          }

          let qwenDirectAttempted = false;
          if (!parsedContent && canUseQwenDirectBuild) {
            qwenDirectAttempted = true;
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: pdfIndex,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: `阶段 1/3：Codex 不可用或结果不完整，正在尝试将 ${pdf.originalName} 直传给 Qwen-VL-Max`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
            const directBuild = await this.tryBuildPdfWithQwenLongFile(pdf, llmConfig);
            if (directBuild) {
              Object.assign(pdf, directBuild.referenceIndex.metadata);
              pdf.referenceIndex = directBuild.referenceIndex.references;
              pdf.textLength = pdf.size;
              pdf.processedAt = new Date().toISOString();
              pdf.extractionParser = 'qwen-long';
              pdf.metaData = this.applyMetaAnalysisPreference(
                this.buildPdfMetaDataRecord(pdf, null, directBuild.referenceIndex.references),
                llmConfig
              );
              pdf.metaDataCachedAt = pdf.processedAt;
              newEntries.push(...directBuild.entries);
              totalChunks += 1;
              processedChunks += 1;
              processedPdfs.push(pdf);

              await this.saveStatus(userId, {
                status: 'processing',
                totalPdfs: pdfs.length,
                processedPdfs: pdfIndex + 1,
                totalChunks,
                processedChunks,
                entryCount: newEntries.length,
                message: `Qwen-VL-Max 已直接完成 ${pdf.originalName} 的 PDF Wiki 抽取`,
                startedAt,
                updatedAt: new Date().toISOString(),
              });
              continue;
            }
          }

          await this.saveStatus(userId, {
            status: 'processing',
            totalPdfs: pdfs.length,
            processedPdfs: fastCodexSentenceBuild ? processedPdfs.length : pdfIndex,
            totalChunks,
            processedChunks,
            entryCount: newEntries.length,
            message: parsedContent
              ? `阶段 1/3：Codex 已提取 ${pdf.originalName} 全文，正在继续生成 Wiki 论点`
              : (hasLiteParse
                ? `阶段 1/3：${qwenDirectAttempted ? 'Qwen-VL-Max 直读失败' : 'Codex 不可用或结果不完整'}，正在使用 LiteParse 本地解析 ${pdf.originalName}`
                : (hasMarker
                  ? `阶段 1/3：${qwenDirectAttempted ? 'Qwen-VL-Max 直读失败' : 'Codex 不可用或结果不完整'}，正在使用 Marker 外部工具解析 ${pdf.originalName}`
                  : (hasFastText
                    ? `阶段 1/3：${qwenDirectAttempted ? 'Qwen-VL-Max 直读失败' : 'Codex 不可用或结果不完整'}，正在使用 pdf-marker-md 快速文本解析 ${pdf.originalName}`
                  : (qwenDirectAttempted
                    ? `阶段 1/3：Qwen-VL-Max 直读失败，正在继续处理 ${pdf.originalName}`
                    : `阶段 1/3：正在按用户选择继续处理 ${pdf.originalName}`)))),
            startedAt,
            updatedAt: new Date().toISOString(),
          });

          const allowExternalMetadata = this.getMetadataEngine(llmConfig) !== 'local';
          parsedContent = parsedContent || (hasLiteParse ? await this.tryExtractPdfWithLiteParse(userId, pdf, allowExternalMetadata) : null);
          if (!parsedContent && hasLiteParse) {
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: processedPdfs.length,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: hasMarker
                ? `阶段 1/3：LiteParse 本地解析失败，正在使用 Marker 外部工具解析 ${pdf.originalName}`
                : (hasFastText
                  ? `阶段 1/3：LiteParse 本地解析失败，正在使用 pdf-marker-md 快速文本解析 ${pdf.originalName}`
                  : `阶段 1/3：LiteParse 本地解析失败，正在继续处理 ${pdf.originalName}`),
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          }

          parsedContent = parsedContent || (hasMarker ? await this.tryExtractPdfWithMarker(userId, pdf, allowExternalMetadata) : null);
          if (!parsedContent && hasMarker) {
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: pdfIndex,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: hasFastText
                ? `阶段 1/3：Marker 外部工具解析失败，正在使用 pdf-marker-md 快速文本解析 ${pdf.originalName}`
                : `阶段 1/3：Marker 外部工具解析失败，正在继续处理 ${pdf.originalName}`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          }

          parsedContent = parsedContent || (hasFastText ? await this.tryExtractPdfWithFastText(userId, pdf, allowExternalMetadata) : null);
          if (!parsedContent && hasFastText) {
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: pdfIndex,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: `阶段 1/3：pdf-marker-md 快速文本解析失败，正在继续处理 ${pdf.originalName}`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          }
          if (!parsedContent) {
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: pdfIndex,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: qwenDirectAttempted
                ? `阶段 1/3：Qwen-VL-Max 直读和本地解析均失败，正在回退本机 pdf-parse 解析 ${pdf.originalName}`
                : `阶段 1/3：本地解析失败，正在回退本机 pdf-parse 解析 ${pdf.originalName}`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
            parsedContent = await this.extractPdfContent(userId, pdf, llmConfig);
          } else {
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: pdfIndex,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: claimExtractionEngine === 'off'
                ? (fastCodexSentenceBuild
                  ? `阶段 1/3：${this.getParsedContentParserLabel(parsedContent.parser)} 已解析 ${pdf.originalName}，正在提取引言、讨论、结论与参考文献`
                  : `阶段 1/3：${this.getParsedContentParserLabel(parsedContent.parser)} 已解析 ${pdf.originalName}，正在本地建立句子级证据索引`)
                : `阶段 1/3：${this.getParsedContentParserLabel(parsedContent.parser)} 已解析 ${pdf.originalName}，正在使用 ${llmConfig.model || 'LLM'} 抽取兼容论点`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          }

          const text = parsedContent.text;
          await this.saveStatus(userId, {
            status: 'processing',
            totalPdfs: pdfs.length,
            processedPdfs: fastCodexSentenceBuild ? processedPdfs.length : pdfIndex,
            totalChunks,
            processedChunks,
            entryCount: newEntries.length,
            message: `阶段 1/3：正在建立 ${pdf.originalName} 的元信息和参考文献索引`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });

          const shouldReuseParsedReferenceIndex = parsedContent.parser === 'codex' || (!llmConfig.apiUrl || !llmConfig.apiKey);
          const referenceIndex = shouldReuseParsedReferenceIndex
            ? {
                metadata: this.mergePdfReidentifiedMetadata(pdf, parsedContent),
                references: this.mergeReferenceIndexes(pdf.referenceIndex || [], parsedContent.references || []),
              }
            : await this.buildReferenceIndex({
                pdf,
                text,
                llmConfig,
                parsedContent,
              });
          referenceIndex.references = referenceIndex.references.map(reference => ({
            ...reference,
            sourcePdfId: pdf.id,
            sourcePdfName: pdf.originalName,
          }));
          Object.assign(pdf, referenceIndex.metadata);
          pdf.referenceIndex = referenceIndex.references;
          pdf.extractionParser = parsedContent.parser;

          const claimSections = claimExtractionEngine === 'off'
            ? []
            : this.buildClaimSections(text, pdf, referenceIndex.references);
          totalChunks += claimSections.length + (fastCodexSentenceBuild ? 1 : 0);
          pdf.textLength = text.length;
          pdf.processedAt = new Date().toISOString();
          const parsedRawMetaData = this.getMetaAnalysisEngine(llmConfig) === 'api'
            ? await this.extractMetaAnalysisDataWithApi(userId, pdf, parsedContent, llmConfig)
            : parsedContent.metaData;
          pdf.metaData = this.applyMetaAnalysisPreference(
            this.buildPdfMetaDataRecord(pdf, parsedContent, referenceIndex.references, parsedRawMetaData),
            llmConfig
          );
          pdf.metaDataCachedAt = pdf.processedAt;
          const draftSentencePoints = fastCodexSentenceBuild || this.shouldUseApiForSentenceReferenceMatching(llmConfig)
            ? this.buildSentenceCloudDraftPointsForAi(text, pdf, topicDefinitions)
            : this.buildSentenceCloudPointsFromText(text, pdf, referenceIndex.references, topicDefinitions);
          let pdfSentencePoints = draftSentencePoints;
          if (fastCodexSentenceBuild && codexConfig) {
            await this.saveStatus(userId, {
              status: 'processing',
              taskKind: 'pdf-wiki',
              totalPdfs: pdfs.length,
              processedPdfs: processedPdfs.length,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              sentencePointCount: newSentencePoints.length,
              failedPdfs: failedPdfs.length,
              workProgress: fastWorkProgress('codex', '核对引用并归纳结论', pdfIndex * 2 + 1, pdfIndex + 1, pdf.originalName, 1, this.getCodexJsonRetryCount(), 0),
              message: `阶段 2/3：Codex 正在逐句核对 ${pdf.originalName} 引言/讨论中的句中与句末引用，并归纳本文主要结论`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
            pdfSentencePoints = await this.buildFastSentenceWikiWithCodex(
              userId,
              pdf,
              text,
              referenceIndex.references,
              draftSentencePoints,
              codexConfig,
              async (codexProgress) => {
                await this.saveStatus(userId, {
                  status: 'processing',
                  taskKind: 'pdf-wiki',
                  totalPdfs: pdfs.length,
                  processedPdfs: processedPdfs.length,
                  failedPdfs: failedPdfs.length,
                  totalChunks,
                  processedChunks,
                  entryCount: newEntries.length,
                  sentencePointCount: newSentencePoints.length,
                  workProgress: fastWorkProgress(
                    'codex',
                    '核对引用并归纳结论',
                    pdfIndex * 2 + 1,
                    pdfIndex + 1,
                    pdf.originalName,
                    codexProgress.attempt,
                    codexProgress.maxAttempts,
                    codexProgress.elapsedMs
                  ),
                  message: `阶段 2/3：${codexProgress.message}`,
                  startedAt,
                  updatedAt: new Date().toISOString(),
                });
              }
            );
            processedChunks++;
          }
          newSentencePoints.push(...pdfSentencePoints);

          for (let sectionIndex = 0; sectionIndex < claimSections.length; sectionIndex++) {
            const claimSection = claimSections[sectionIndex];
            let claims: ExtractedClaim[] = [];
            try {
              claims = await this.extractClaimsFromChunk({
                userId,
                text: claimSection.text,
                chunkIndex: sectionIndex,
                totalChunks: claimSections.length,
                sectionName: claimSection.sectionName,
                pdf,
                llmConfig,
                codexConfig: this.shouldUseCodexForClaimExtraction(llmConfig) && codexConfig ? codexConfig : undefined,
              });
            } catch (error) {
              logger.warn(`[PdfWiki] Skipped section ${claimSection.sectionName} ${sectionIndex + 1}/${claimSections.length} for ${pdf.originalName}:`, error);
            }

            for (const claim of claims) {
              const entry = this.createEntryFromClaim(claim, pdf, sectionIndex, referenceIndex.references, claimSection.sentenceEvidence);
              if (entry) newEntries.push(entry);
            }

            processedChunks++;
            await this.saveStatus(userId, {
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs: pdfIndex,
              totalChunks,
              processedChunks,
              entryCount: newEntries.length,
              message: `阶段 2/3：正在抽取 ${pdf.originalName} 的${claimSection.label}论点 ${sectionIndex + 1}/${claimSections.length}`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
          }

          processedPdfs.push(pdf);
          await this.saveStatus(userId, {
            status: 'processing',
            taskKind: 'pdf-wiki',
            totalPdfs: pdfs.length,
            processedPdfs: processedPdfs.length,
            totalChunks,
            processedChunks,
            entryCount: newEntries.length,
            sentencePointCount: newSentencePoints.length,
            failedPdfs: failedPdfs.length,
            workProgress: fastWorkProgress('extracting', '准备下一篇 PDF', (pdfIndex + 1) * 2, pdfIndex + 1, pdf.originalName),
            message: claimExtractionEngine === 'off'
              ? (fastCodexSentenceBuild
                ? `快速模式已完成 ${pdf.originalName}（${pdfIndex + 1}/${pdfs.length}）：Codex 确认 ${pdfSentencePoints.filter(point => point.section !== 'Conclusion').length} 条有明确引用的论点，并归纳 ${pdfSentencePoints.filter(point => point.section === 'Conclusion').length} 条绑定本文引用的主要结论`
                : `快速模式已完成 ${pdf.originalName}（${pdfIndex + 1}/${pdfs.length}）：发现 ${pdfSentencePoints.length} 个候选证据句，已跳过旧兼容论点、全表格、全图片和 Meta 提取`)
              : `已完成 ${pdf.originalName}（${pdfIndex + 1}/${pdfs.length}）：候选证据句 ${pdfSentencePoints.length} 个，兼容论点累计 ${newEntries.length} 个`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });
        } catch (error) {
          failedPdfs.push(pdf);
          logger.error(`[PdfWiki] Failed to process ${pdf.originalName}:`, error);
          await this.saveStatus(userId, {
            status: 'processing',
            taskKind: 'pdf-wiki',
            totalPdfs: pdfs.length,
            processedPdfs: processedPdfs.length,
            failedPdfs: failedPdfs.length,
            totalChunks,
            processedChunks,
            entryCount: newEntries.length,
            sentencePointCount: newSentencePoints.length,
            workProgress: fastWorkProgress('extracting', '当前 PDF 已处理，准备继续', (pdfIndex + 1) * 2, pdfIndex + 1, pdf.originalName),
            message: `处理 ${pdf.originalName} 失败，已记录并继续下一篇：${(error as Error).message}`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      const allEntries = [...retainedEntries, ...newEntries];
      const sentencePointDrafts = [...retainedSentencePoints, ...newSentencePoints];
      if (allEntries.length === 0 && sentencePointDrafts.length === 0) {
        await this.saveStatus(userId, {
          status: 'error',
          totalPdfs: pdfs.length,
          processedPdfs: processedPdfs.length,
          totalChunks,
          processedChunks,
          entryCount: 0,
          sentencePointCount: 0,
          message: 'PDF Wiki 生成失败：未能从 PDF 的引言/讨论/结论中提取到可用句子，也未能提取到兼容论点',
          startedAt,
          updatedAt: new Date().toISOString(),
          error: 'NO_SENTENCE_POINTS_OR_WIKI_ENTRIES',
        });
        return;
      }

      await this.saveStatus(userId, {
        status: 'processing',
        taskKind: 'pdf-wiki',
        totalPdfs: pdfs.length,
        processedPdfs: processedPdfs.length,
        totalChunks,
        processedChunks,
        entryCount: allEntries.length,
        sentencePointCount: sentencePointDrafts.length,
        failedPdfs: failedPdfs.length,
        workProgress: fastWorkProgress('finalizing', '全局校验与保存', pdfs.length * 2),
        message: fastCodexSentenceBuild
          ? '阶段 3/3：正在严格校验 Codex 结果；无明确引用的引言/讨论句不会进入论点库，本文结论将绑定来源论文引用'
          : (this.shouldUseApiForSentenceReferenceMatching(llmConfig) && llmConfig.apiUrl && llmConfig.apiKey
            ? '阶段 3/3：正在使用 AI 校准引言/讨论/结论句子、文末参考文献与可作论点判断'
            : '阶段 3/3：正在建立 Wiki论点库并匹配本地参考文献'),
        startedAt,
        updatedAt: new Date().toISOString(),
      });

      const allReferenceIndex = this.mergeReferenceIndexes(
        retainedReferenceIndex,
        processedPdfs.flatMap(pdf => pdf.referenceIndex || []),
      );
      await this.saveStatus(userId, {
        status: 'processing',
        totalPdfs: pdfs.length,
        processedPdfs: processedPdfs.length,
        totalChunks,
        processedChunks,
        entryCount: allEntries.length,
        sentencePointCount: sentencePointDrafts.length,
        message: '阶段 3/3：正在校准可作论点句子与参考文献索引',
        startedAt,
        updatedAt: new Date().toISOString(),
      });
      const refinedNewSentencePoints = await this.refineSentenceCloudPointsWithAi(
        newSentencePoints,
        allReferenceIndex,
        llmConfig
      );
      const publishableSentencePoints = this.filterPublishableSentencePoints([...retainedSentencePoints, ...refinedNewSentencePoints])
        .map(point => this.applyTopicDefinitionToPoint(point, topicDefinitions));
      if (allEntries.length === 0 && publishableSentencePoints.length === 0) {
        await this.saveStatus(userId, {
          status: 'error',
          totalPdfs: pdfs.length,
          processedPdfs: processedPdfs.length,
          totalChunks,
          processedChunks,
          entryCount: 0,
          sentencePointCount: 0,
          message: 'PDF Wiki 生成失败：未能从 PDF 的引言/讨论/结论中提取到可直接作为论点的句子',
          startedAt,
          updatedAt: new Date().toISOString(),
          error: 'NO_PUBLISHABLE_SENTENCE_POINTS',
        });
        return;
      }
      await this.saveStatus(userId, {
        status: 'processing',
        totalPdfs: pdfs.length,
        processedPdfs: processedPdfs.length,
        totalChunks,
        processedChunks,
        entryCount: allEntries.length,
        sentencePointCount: publishableSentencePoints.length,
        message: '阶段 3/3：正在把可作论点句子绑定到全局参考文献',
        startedAt,
        updatedAt: new Date().toISOString(),
      });
      const resolvedEntries = this.attachGlobalReferences(allEntries, allReferenceIndex);
      await this.saveStatus(userId, {
        status: 'processing',
        totalPdfs: pdfs.length,
        processedPdfs: processedPdfs.length,
        totalChunks,
        processedChunks,
        entryCount: resolvedEntries.length,
        sentencePointCount: publishableSentencePoints.length,
        message: '阶段 3/3：正在合并跨 PDF 兼容论点组',
        startedAt,
        updatedAt: new Date().toISOString(),
      });
      const groupedEntries = await this.groupEntriesAcrossPdfs(
        resolvedEntries,
        llmConfig,
        userId,
        this.shouldUseCodexForGrouping(llmConfig) && codexConfig ? codexConfig : undefined
      );
      await this.saveStatus(userId, {
        status: 'processing',
        totalPdfs: pdfs.length,
        processedPdfs: processedPdfs.length,
        totalChunks,
        processedChunks,
        entryCount: groupedEntries.length,
        sentencePointCount: publishableSentencePoints.length,
        message: '阶段 3/3：正在保存 Wiki论点库',
        startedAt,
        updatedAt: new Date().toISOString(),
      });
      const sentenceCloud = this.buildSentenceCloudStore(publishableSentencePoints);
      const store: PdfWikiStore = {
        version: 1,
        userId,
        generatedAt: new Date().toISOString(),
        pdfs: this.deduplicatePdfs([...retainedPdfs, ...processedPdfs, ...failedPdfs]),
        referenceIndex: allReferenceIndex,
        entries: groupedEntries,
        sentenceCloud,
      };

      await this.saveStore(userId, store);
      this.clearEngine(userId);
      this.removeIndexCache(userId);

      await this.saveStatus(userId, {
        status: 'completed',
        taskKind: 'pdf-wiki',
        totalPdfs: pdfs.length,
        processedPdfs: processedPdfs.length,
        failedPdfs: failedPdfs.length,
        totalChunks,
        processedChunks,
        entryCount: store.entries.length,
        sentencePointCount: store.sentenceCloud?.points?.length || 0,
        workProgress: fastWorkProgress('completed', '已完成', fastWorkTotalUnits),
        message: failedPdfs.length > 0
          ? `Wiki论点库已生成，共 ${store.sentenceCloud?.points?.length || 0} 个可作论点句子，兼容论点组 ${store.entries.length} 个；${failedPdfs.length} 个 PDF 解析失败，可稍后重建`
          : `Wiki论点库已生成，共 ${store.sentenceCloud?.points?.length || 0} 个可作论点句子，兼容论点组 ${store.entries.length} 个`,
        startedAt,
        updatedAt: store.generatedAt,
        error: failedPdfs.length > 0 ? 'PARTIAL_PDF_FAILURE' : undefined,
      });

      logger.info(`[PdfWiki] Built wiki for ${userId}: ${store.entries.length} entries from ${store.pdfs.length} PDFs`);
    } catch (error) {
      logger.error(`[PdfWiki] Build failed for ${userId}:`, error);
      await this.saveStatus(userId, {
        status: 'error',
        totalPdfs: pdfs.length,
        processedPdfs: 0,
        totalChunks: 0,
        processedChunks: 0,
        entryCount: 0,
        message: 'PDF Wiki 生成失败：' + (error as Error).message,
        startedAt,
        updatedAt: new Date().toISOString(),
        error: (error as Error).message,
      });
    }
  }

  private async mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number, workerIndex: number) => Promise<void>
  ): Promise<void> {
    if (items.length === 0) return;
    let nextIndex = 0;
    const workerCount = Math.min(items.length, Math.max(1, Math.floor(concurrency)));
    await Promise.all(Array.from({ length: workerCount }, async (_, workerIndex) => {
      while (nextIndex < items.length) {
        const currentIndex = nextIndex++;
        await worker(items[currentIndex], currentIndex, workerIndex);
      }
    }));
  }

  private async extractMetaAnalysisOnly(
    userId: string,
    pdfs: PdfWikiSourcePdf[],
    llmConfig: PdfWikiLlmConfig,
    options: { force?: boolean } = {}
  ): Promise<void> {
    const metaEngine = this.getMetaAnalysisEngine(llmConfig);
    const codexConfig = this.canUseCodexCli() ? this.loadPdfWikiCodexConfig() : null;
    const canUseCodex = !!codexConfig && this.shouldUseCodexForMetaAnalysisEngine(metaEngine);
    const canUseApi = !!llmConfig.apiUrl && !!llmConfig.apiKey && metaEngine !== 'off';
    const startedAt = new Date().toISOString();
    let processedPdfs = 0;
    let failedPdfs = 0;
    let metaRowCount = 0;
    let tableCount = 0;
    let figureCount = 0;
    const codexWorkerCount = canUseCodex && codexConfig
      ? Math.min(pdfs.length, Math.max(1, Math.floor(codexConfig.concurrency || 1)))
      : 0;
    const processingConcurrency = codexWorkerCount || 1;
    const codexWorkers: PdfWikiCodexWorkerStatus[] = codexWorkerCount > 0
      ? Array.from({ length: codexWorkerCount }, (_, workerIndex) => ({
          slot: workerIndex + 1,
          status: 'idle',
          message: '等待分配 PDF',
          updatedAt: startedAt,
        }))
      : [];
    const cloneWorkers = () => codexWorkers.map(worker => ({ ...worker }));
    const updateWorker = (workerIndex: number, patch: Partial<PdfWikiCodexWorkerStatus>) => {
      if (workerIndex < 0 || workerIndex >= codexWorkers.length) return;
      codexWorkers[workerIndex] = {
        ...codexWorkers[workerIndex],
        ...patch,
        slot: workerIndex + 1,
        updatedAt: patch.updatedAt || new Date().toISOString(),
      };
    };

    await this.saveStatus(userId, {
      taskKind: 'meta-analysis',
      status: 'processing',
      totalPdfs: pdfs.length,
      processedPdfs: 0,
      failedPdfs: 0,
      totalChunks: pdfs.length,
      processedChunks: 0,
      entryCount: 0,
      sentencePointCount: 0,
      metaRowCount: 0,
      tableCount: 0,
      figureCount: 0,
      workerConcurrency: processingConcurrency,
      codexWorkers: cloneWorkers(),
      message: canUseCodex
        ? `正在批量提取 Meta 分析数据：Codex CLI 全流程处理，当前按配置启用 ${processingConcurrency} 个并行任务；Codex 可用时不启用 LiteParse/千问降级`
        : (canUseApi
          ? `正在批量提取 Meta 分析数据：LiteParse 本地解析 + 文本结构化 ${llmConfig.model || 'qwen-long'}/${llmConfig.jsonModel || 'qwen-max'}；图片表格 OCR ${llmConfig.ocrModel || 'qwen-vl-ocr'}；复杂视觉兜底 ${llmConfig.visionModel || 'qwen-vl-max'}`
          : '正在批量提取 Meta 分析数据：未检测到 Codex/API，只能生成基础元信息和空编码表'),
      startedAt,
      updatedAt: startedAt,
    });

    const store = await this.loadStore(userId);
    const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));

    await this.mapWithConcurrency(pdfs, processingConcurrency, async (sourcePdf, index, workerIndex) => {
      const pdf = pdfById.get(sourcePdf.id) || sourcePdf;
      const workerSlotIndex = codexWorkerCount > 0 ? workerIndex : -1;
      try {
        updateWorker(workerSlotIndex, {
          status: 'running',
          pdfId: pdf.id,
          pdfName: pdf.originalName,
          index,
          message: `正在提取 ${pdf.originalName} 的 Meta 分析数据（${index + 1}/${pdfs.length}）`,
          startedAt: new Date().toISOString(),
          error: undefined,
        });
        await this.saveStatus(userId, {
          taskKind: 'meta-analysis',
          status: 'processing',
          totalPdfs: pdfs.length,
          processedPdfs,
          failedPdfs,
          totalChunks: pdfs.length,
          processedChunks: processedPdfs + failedPdfs,
          entryCount: 0,
          sentencePointCount: 0,
          metaRowCount,
          tableCount,
          figureCount,
          workerConcurrency: processingConcurrency,
          codexWorkers: cloneWorkers(),
          message: `正在提取 ${pdf.originalName} 的 Meta 分析数据（${index + 1}/${pdfs.length}）`,
          startedAt,
          updatedAt: new Date().toISOString(),
        });

        let codexMetaResult: PdfWikiCodexMetaAnalysisResult | null = null;
        if (canUseCodex && codexConfig) {
          codexMetaResult = await this.tryExtractPdfMetaAnalysisWithCodex(
            userId,
            pdf,
            codexConfig,
            llmConfig,
            async (message) => {
              const workerMessage = message.replace(/^阶段 1\/3：/, 'Meta 提取：');
              updateWorker(workerSlotIndex, {
                status: 'running',
                pdfId: pdf.id,
                pdfName: pdf.originalName,
                index,
                message: workerMessage,
              });
              await this.saveStatus(userId, {
                taskKind: 'meta-analysis',
                status: 'processing',
                totalPdfs: pdfs.length,
                processedPdfs,
                failedPdfs,
                totalChunks: pdfs.length,
                processedChunks: processedPdfs + failedPdfs,
                entryCount: 0,
                sentencePointCount: 0,
                metaRowCount,
                tableCount,
                figureCount,
                workerConcurrency: processingConcurrency,
                codexWorkers: cloneWorkers(),
                message: workerMessage,
                startedAt,
                updatedAt: new Date().toISOString(),
              });
            }
          );
          if (!codexMetaResult) {
            throw new Error('Codex CLI 已启用但未生成 Meta 分析结果；已按配置停止，不降级到 LiteParse/千问。');
          }
        }

        let parsedContent = codexMetaResult?.parsedContent || (!options.force ? await this.loadParsedTextCache(userId, pdf) : null);
        if (!parsedContent) {
          if (this.shouldUseLiteParseForTextExtraction(llmConfig)) {
            await this.saveStatus(userId, {
              taskKind: 'meta-analysis',
              status: 'processing',
              totalPdfs: pdfs.length,
              processedPdfs,
              failedPdfs,
              totalChunks: pdfs.length,
              processedChunks: processedPdfs + failedPdfs,
              entryCount: 0,
              sentencePointCount: 0,
              metaRowCount,
              tableCount,
              figureCount,
              workerConcurrency: processingConcurrency,
              codexWorkers: cloneWorkers(),
              message: `正在使用 LiteParse 本地解析 ${pdf.originalName}；解析完成后再进入千问文本结构化和图表 OCR`,
              startedAt,
              updatedAt: new Date().toISOString(),
            });
            parsedContent = await this.tryExtractPdfWithLiteParse(userId, pdf);
          } else {
            parsedContent = null;
          }
        }
        if (!parsedContent) {
          parsedContent = this.shouldUseMarkerForTextExtraction(llmConfig)
            ? await this.tryExtractPdfWithMarker(userId, pdf)
            : null;
        }
        if (!parsedContent) {
          parsedContent = this.shouldUseFastTextForTextExtraction(llmConfig)
            ? await this.tryExtractPdfWithFastText(userId, pdf)
            : null;
        }
        if (!parsedContent) {
          parsedContent = await this.extractPdfContent(userId, pdf, llmConfig);
        }

        const shouldReuseParsedReferenceIndex = parsedContent.parser === 'codex' || (!llmConfig.apiUrl || !llmConfig.apiKey);
        const referenceIndex = codexMetaResult?.referenceIndex || (shouldReuseParsedReferenceIndex
          ? {
              metadata: this.mergePdfReidentifiedMetadata(pdf, parsedContent),
              references: this.mergeReferenceIndexes(pdf.referenceIndex || [], parsedContent.references || []),
            }
          : await this.buildReferenceIndex({
              pdf,
              text: parsedContent.text,
              llmConfig,
              parsedContent,
            }));

        Object.assign(pdf, referenceIndex.metadata);
        pdf.referenceIndex = referenceIndex.references;
        pdf.textLength = parsedContent.text.length;
        pdf.processedAt = new Date().toISOString();
        pdf.extractionParser = parsedContent.parser;
        const parsedContentParserLabel = this.getParsedContentParserLabel(parsedContent.parser);

        let rawMetaData = codexMetaResult?.metaData || this.asRecord(parsedContent.metaData);
        if (!codexMetaResult && canUseApi) {
          const figureMetaData = await this.extractMetaAnalysisFigureEvidenceWithVision(userId, pdf, llmConfig).catch(error => {
            logger.warn(`[PdfWiki] Qwen vision figure evidence extraction failed for ${pdf.originalName}:`, error);
            return null;
          });
          if (figureMetaData) {
            rawMetaData = this.mergeMetaDataRecords(rawMetaData, figureMetaData);
          }
        }
        if (!this.extractExplicitMetaAnalysisRows(rawMetaData).length && canUseApi) {
          updateWorker(workerSlotIndex, {
            status: 'running',
            pdfId: pdf.id,
            pdfName: pdf.originalName,
            index,
            message: `${parsedContentParserLabel} 已提取文本，正在用 ${llmConfig.jsonModel || llmConfig.model || 'qwen-max'} 进行 Meta 数据结构化；图表证据将按 ${llmConfig.ocrModel || 'qwen-vl-ocr'} / ${llmConfig.visionModel || 'qwen-vl-max'} 兜底策略标记复核`,
          });
          await this.saveStatus(userId, {
            taskKind: 'meta-analysis',
            status: 'processing',
            totalPdfs: pdfs.length,
            processedPdfs,
            failedPdfs,
            totalChunks: pdfs.length,
            processedChunks: processedPdfs + failedPdfs,
            entryCount: 0,
            sentencePointCount: 0,
            metaRowCount,
            tableCount,
            figureCount,
            workerConcurrency: processingConcurrency,
            codexWorkers: cloneWorkers(),
            message: `${parsedContentParserLabel} 已完成 ${pdf.originalName} 的文本解析；正在用千问国内预设抽取 Meta 数据：文本结构化 ${llmConfig.jsonModel || llmConfig.model || 'qwen-max'}，OCR ${llmConfig.ocrModel || 'qwen-vl-ocr'}，视觉兜底 ${llmConfig.visionModel || 'qwen-vl-max'}`,
            startedAt,
            updatedAt: new Date().toISOString(),
          });
          const preApiMetaData = rawMetaData;
          const apiMetaData = await this.extractMetaAnalysisDataWithApi(userId, pdf, parsedContent, {
              ...llmConfig,
              metaAnalysisEnabled: true,
              metaAnalysisEngine: 'api',
            });
          rawMetaData = this.mergeMetaDataRecords(preApiMetaData, apiMetaData);
          rawMetaData.source_figures = [
            ...this.firstArray(preApiMetaData.source_figures, preApiMetaData.sourceFigures),
            ...this.firstArray(apiMetaData.source_figures, apiMetaData.sourceFigures),
          ];
          rawMetaData.source_tables = [
            ...this.firstArray(preApiMetaData.source_tables, preApiMetaData.sourceTables),
            ...this.firstArray(apiMetaData.source_tables, apiMetaData.sourceTables),
          ];
          rawMetaData.meta_analysis_rows = [
            ...this.firstArray(preApiMetaData.meta_analysis_rows, preApiMetaData.metaAnalysisRows),
            ...this.firstArray(apiMetaData.meta_analysis_rows, apiMetaData.metaAnalysisRows),
          ];
        }

        const builtMetaData = this.buildPdfMetaDataRecord(pdf, parsedContent, referenceIndex.references, rawMetaData);
        const isolatedMetaData = await this.ensureMetaAnalysisFigureCopies(userId, pdf, builtMetaData);
        pdf.metaData = this.applyMetaAnalysisPreference(isolatedMetaData, {
          ...llmConfig,
          metaAnalysisEnabled: true,
          metaAnalysisEngine: metaEngine === 'off' ? 'auto' : metaEngine,
        });
        pdf.metaDataCachedAt = pdf.processedAt;

        const tables = await this.getPdfMetaTables(userId, pdf, pdf.metaData);
        const rowCount = this.extractExplicitMetaAnalysisRows(pdf.metaData).length;
        if (rowCount === 0 && !this.isMetaAnalysisRowsUserEdited(pdf.metaData)) {
          pdf.metaExcluded = true;
        } else {
          pdf.metaExcluded = false;
        }
        pdfById.set(pdf.id, pdf);
        metaRowCount += rowCount;
        tableCount += codexMetaResult?.tableCount || tables.length;
        figureCount += codexMetaResult?.figureCount || this.firstArray(pdf.metaData.source_figures).length;
        processedPdfs++;
        updateWorker(workerSlotIndex, {
          status: 'completed',
          pdfId: pdf.id,
          pdfName: pdf.originalName,
          index,
          message: `已完成 ${pdf.originalName} 的 Meta 数据提取：${rowCount} 行、${tables.length} 个表格文件`,
          error: undefined,
        });

        await this.saveStatus(userId, {
          taskKind: 'meta-analysis',
          status: 'processing',
          totalPdfs: pdfs.length,
          processedPdfs,
          failedPdfs,
          totalChunks: pdfs.length,
          processedChunks: processedPdfs + failedPdfs,
          entryCount: 0,
          sentencePointCount: 0,
          metaRowCount,
          tableCount,
          figureCount,
          workerConcurrency: processingConcurrency,
          codexWorkers: cloneWorkers(),
          message: `已完成 ${pdf.originalName} 的 Meta 数据提取：${rowCount} 行、${tables.length} 个表格文件`,
          startedAt,
          updatedAt: new Date().toISOString(),
        });
      } catch (error) {
        failedPdfs++;
        const previousMeta = this.asRecord(pdf.metaData);
        const previousRows = this.extractExplicitMetaAnalysisRows(previousMeta);
        pdf.metaData = this.applyMetaAnalysisPreference({
          ...previousMeta,
          extraction_notes: [
            ...this.toDisplayStringArray(previousMeta.extraction_notes),
            `Meta 分析数据提取失败：${(error as Error).message}`,
          ],
          needs_codex_or_manual_review: true,
          meta_analysis_rows: this.firstArray(previousMeta.meta_analysis_rows),
        }, {
          ...llmConfig,
          metaAnalysisEnabled: true,
          metaAnalysisEngine: metaEngine === 'off' ? 'auto' : metaEngine,
        });
        pdf.metaDataCachedAt = new Date().toISOString();
        if (previousRows.length === 0 && !this.isMetaAnalysisRowsUserEdited(previousMeta)) {
          pdf.metaExcluded = true;
        }
        pdfById.set(pdf.id, pdf);
        updateWorker(workerSlotIndex, {
          status: 'error',
          pdfId: pdf.id,
          pdfName: pdf.originalName,
          index,
          message: `Meta 分析数据提取失败：${(error as Error).message}`,
          error: (error as Error).message,
        });
        await this.saveStatus(userId, {
          taskKind: 'meta-analysis',
          status: 'processing',
          totalPdfs: pdfs.length,
          processedPdfs,
          failedPdfs,
          totalChunks: pdfs.length,
          processedChunks: processedPdfs + failedPdfs,
          entryCount: 0,
          sentencePointCount: 0,
          metaRowCount,
          tableCount,
          figureCount,
          workerConcurrency: processingConcurrency,
          codexWorkers: cloneWorkers(),
          message: `Meta 分析数据提取失败：${pdf.originalName}；${processedPdfs}/${pdfs.length} 个成功，${failedPdfs} 个失败`,
          startedAt,
          updatedAt: new Date().toISOString(),
        });
        logger.error(`[PdfWiki] Meta-analysis extraction failed for ${pdf.originalName}:`, error);
      }
    });

    const updatedPdfs = this.deduplicatePdfs(Array.from(pdfById.values()));
    const updatedStore: PdfWikiStore = {
      ...store,
      generatedAt: new Date().toISOString(),
      pdfs: updatedPdfs,
      referenceIndex: this.mergeReferenceIndexes(
        store.referenceIndex || [],
        updatedPdfs.flatMap(pdf => pdf.referenceIndex || []),
      ),
    };
    await this.saveStore(userId, updatedStore);
    this.clearEngine(userId);
    this.removeIndexCache(userId);

    const completedAt = new Date().toISOString();
    await this.saveStatus(userId, {
      taskKind: 'meta-analysis',
      status: processedPdfs > 0 ? 'completed' : 'error',
      totalPdfs: pdfs.length,
      processedPdfs,
      failedPdfs,
      totalChunks: pdfs.length,
      processedChunks: processedPdfs + failedPdfs,
      entryCount: updatedStore.entries.length,
      sentencePointCount: updatedStore.sentenceCloud?.points?.length || 0,
      metaRowCount,
      tableCount,
      figureCount,
      workerConcurrency: processingConcurrency,
      codexWorkers: cloneWorkers(),
      message: processedPdfs > 0
        ? `Meta 分析数据批量提取完成：${processedPdfs}/${pdfs.length} 个 PDF，${metaRowCount} 行编码数据，${tableCount} 个表格文件，${figureCount} 个图件描述${failedPdfs ? `；${failedPdfs} 个失败` : ''}`
        : `Meta 分析数据提取失败：${failedPdfs} 个 PDF 均未成功`,
      startedAt,
      updatedAt: completedAt,
      error: processedPdfs > 0 && failedPdfs > 0 ? 'PARTIAL_META_ANALYSIS_FAILURE' : (processedPdfs > 0 ? undefined : 'META_ANALYSIS_FAILED'),
    });
  }

  private normalizePdfWikiChoice<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    const normalized = String(value || '').trim().toLowerCase();
    return (allowed as readonly string[]).includes(normalized) ? normalized as T : fallback;
  }

  private getTextExtractionEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['textExtractionEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.textExtractionEngine, ['auto', 'codex', 'liteparse', 'marker', 'fast-text', 'qwen-long', 'pdf-parse'] as const, 'auto');
  }

  private getMetadataEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['metadataEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.metadataEngine, ['auto', 'api', 'local'] as const, 'auto');
  }

  private getClaimExtractionEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['claimExtractionEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.claimExtractionEngine, ['auto', 'codex', 'qwen-long', 'api', 'off'] as const, 'auto');
  }

  private getSentenceReferenceMatchingEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['sentenceReferenceMatchingEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.sentenceReferenceMatchingEngine, ['auto', 'codex', 'api', 'local'] as const, 'auto');
  }

  private getGroupingEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['groupingEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.groupingEngine, ['auto', 'codex', 'api', 'local'] as const, 'auto');
  }

  private getMetaAnalysisEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['metaAnalysisEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.metaAnalysisEngine, ['auto', 'codex', 'api', 'off'] as const, 'auto');
  }

  private getDeepAnalysisEngine(llmConfig: PdfWikiLlmConfig): NonNullable<PdfWikiLlmConfig['deepAnalysisEngine']> {
    return this.normalizePdfWikiChoice(llmConfig.deepAnalysisEngine, ['auto', 'codex', 'api'] as const, 'auto');
  }

  private isLocalSentenceWikiBuild(llmConfig: PdfWikiLlmConfig): boolean {
    const textEngine = this.getTextExtractionEngine(llmConfig);
    return this.getClaimExtractionEngine(llmConfig) === 'off'
      && this.getMetadataEngine(llmConfig) === 'local'
      && this.getSentenceReferenceMatchingEngine(llmConfig) === 'local'
      && this.getGroupingEngine(llmConfig) === 'local'
      && !this.shouldGenerateMetaAnalysis(llmConfig)
      && ['liteparse', 'marker', 'fast-text', 'pdf-parse'].includes(textEngine);
  }

  private isFastCodexSentenceWikiBuild(llmConfig: PdfWikiLlmConfig): boolean {
    return llmConfig.processingProfile === 'fast'
      && this.getClaimExtractionEngine(llmConfig) === 'off'
      && this.getSentenceReferenceMatchingEngine(llmConfig) === 'codex'
      && this.getGroupingEngine(llmConfig) === 'local'
      && !this.shouldGenerateMetaAnalysis(llmConfig);
  }

  private shouldUseCodexFullBuild(llmConfig: PdfWikiLlmConfig): boolean {
    const textEngine = this.getTextExtractionEngine(llmConfig);
    const claimEngine = this.getClaimExtractionEngine(llmConfig);
    return this.shouldUseCodexForEngine(textEngine)
      && this.shouldUseCodexForEngine(claimEngine);
  }

  private shouldUseFastTextForTextExtraction(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getTextExtractionEngine(llmConfig);
    return engine === 'auto' || engine === 'codex' || engine === 'fast-text';
  }

  private shouldUseLiteParseForTextExtraction(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getTextExtractionEngine(llmConfig);
    return engine === 'auto' || engine === 'codex' || engine === 'liteparse';
  }

  private shouldUseMarkerForTextExtraction(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getTextExtractionEngine(llmConfig);
    return engine === 'marker' || ((engine === 'auto' || engine === 'codex') && isPdfMarkerAvailable());
  }

  private shouldUseQwenLongDirectBuild(llmConfig: PdfWikiLlmConfig): boolean {
    const textEngine = this.getTextExtractionEngine(llmConfig);
    const claimEngine = this.getClaimExtractionEngine(llmConfig);
    return this.shouldUseQwenLongDirectPdf(llmConfig)
      && (textEngine === 'auto' || textEngine === 'codex' || textEngine === 'qwen-long')
      && (claimEngine === 'auto' || claimEngine === 'qwen-long');
  }

  private shouldUseCodexForClaimExtraction(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getClaimExtractionEngine(llmConfig);
    return this.shouldUseCodexForEngine(engine);
  }

  private shouldUseQwenLongForClaimExtraction(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getClaimExtractionEngine(llmConfig);
    return engine === 'auto' || engine === 'qwen-long';
  }

  private shouldUseApiForClaimExtraction(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getClaimExtractionEngine(llmConfig);
    return engine === 'auto' || engine === 'api' || engine === 'codex' || engine === 'qwen-long';
  }

  private shouldUseApiForSentenceReferenceMatching(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getSentenceReferenceMatchingEngine(llmConfig);
    return engine === 'auto' || engine === 'api';
  }

  private shouldUseCodexForGrouping(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getGroupingEngine(llmConfig);
    return this.shouldUseCodexForEngine(engine);
  }

  private shouldUseApiForGrouping(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getGroupingEngine(llmConfig);
    return engine === 'auto' || engine === 'api' || engine === 'codex';
  }

  private shouldUseCodexForDeepAnalysis(llmConfig: PdfWikiLlmConfig): boolean {
    const engine = this.getDeepAnalysisEngine(llmConfig);
    return this.shouldUseCodexForEngine(engine);
  }

  private shouldUseCodexForMetaAnalysisEngine(engine: string): boolean {
    return engine === 'codex' || engine === 'auto';
  }

  private shouldUseCodexForEngine(engine: string): boolean {
    return engine === 'codex' || (engine === 'auto' && this.isPdfWikiCodexAutoPreferred());
  }

  private isPdfWikiCodexAutoPreferred(): boolean {
    const override = String(process.env.PDF_WIKI_CODEX_ENABLED || '').trim();
    if (/^(false|0|off)$/i.test(override)) return false;
    if (/^(true|1|on)$/i.test(override)) return true;
    return this.isPdfWikiCodexEnabled();
  }

  private shouldGenerateMetaAnalysis(llmConfig: PdfWikiLlmConfig): boolean {
    return llmConfig.metaAnalysisEnabled !== false && this.getMetaAnalysisEngine(llmConfig) !== 'off';
  }

  private applyMetaAnalysisPreference(metaData: Record<string, unknown>, llmConfig: PdfWikiLlmConfig): Record<string, unknown> {
    if (this.shouldGenerateMetaAnalysis(llmConfig)) {
      return {
        ...metaData,
        meta_analysis_enabled: true,
        meta_analysis_engine: this.getMetaAnalysisEngine(llmConfig),
      };
    }

    return {
      ...metaData,
      meta_analysis_enabled: false,
      meta_analysis_engine: 'off',
      meta_analysis_rows: [],
      source_tables: [],
      source_figures: [],
      extraction_notes: [
        ...this.toDisplayStringArray(metaData.extraction_notes),
        '用户本次上传未启用 Meta 分析数据表提取，已跳过逐观测值表格生成。',
      ],
      needs_codex_or_manual_review: false,
    };
  }

  private isMetaAnalysisDataEnabled(metaData: Record<string, unknown>): boolean {
    if (this.toBoolean(metaData.meta_analysis_deleted ?? metaData.metaAnalysisDeleted) === true) {
      return false;
    }
    const enabled = this.toBoolean(metaData.meta_analysis_enabled ?? metaData.metaAnalysisEnabled);
    return enabled !== false;
  }

  private shouldIncludePdfInMetaDatabase(pdf: PdfWikiSourcePdf, metaData: Record<string, unknown>): boolean {
    if (pdf.metaExcluded === true) return false;
    if (this.toBoolean(metaData.meta_analysis_deleted ?? metaData.metaAnalysisDeleted) === true) return false;

    const hasRows = this.extractExplicitMetaAnalysisRows(metaData).length > 0;
    if (hasRows) return true;

    const rowsWereManuallyEdited = this.isMetaAnalysisRowsUserEdited(metaData);
    if (rowsWereManuallyEdited && pdf.metaExcluded === false) return true;

    // Older PDF-manager records may have meta_analysis_enabled=true by default even
    // though the user never sent them into the Meta workflow. Empty extraction
    // attempts are status messages, not usable Meta-analysis data tables.
    return false;
  }

  private async linkOrCopyFile(sourcePath: string, targetPath: string): Promise<'hardlink' | 'copy'> {
    const source = path.resolve(sourcePath);
    const target = path.resolve(targetPath);
    if (source === target) return 'hardlink';

    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) {
      try {
        const [sourceStat, targetStat] = await Promise.all([
          fs.promises.stat(source),
          fs.promises.stat(target),
        ]);
        if (sourceStat.dev === targetStat.dev && sourceStat.ino === targetStat.ino) {
          return 'hardlink';
        }
      } catch {
        // The replacement below will surface a meaningful error if the source is unreadable.
      }
      await fs.promises.rm(target, { force: true });
    }

    try {
      await fs.promises.link(source, target);
      return 'hardlink';
    } catch (error) {
      logger.debug(`[PdfWiki] Hard link unavailable for ${path.basename(target)}; falling back to a physical copy: ${this.getErrorMessage(error)}`);
      await fs.promises.copyFile(source, target);
      return 'copy';
    }
  }

  private async registerPdfFiles(userId: string, files: UploadedPdfFile[]): Promise<PdfWikiSourcePdf[]> {
    const sourceDir = this.getSourcePdfDir(userId);
    await fs.promises.mkdir(sourceDir, { recursive: true });

    const pdfs: PdfWikiSourcePdf[] = [];
    for (const file of files) {
      const buffer = file.buffer || (file.path ? await fs.promises.readFile(file.path) : null);
      if (!buffer) continue;

      const hash = crypto.createHash('sha256').update(buffer).digest('hex');
      const safeName = this.sanitizeFileName(file.originalname || 'uploaded.pdf');
      const fileName = `${hash.slice(0, 16)}-${safeName}`;
      const filePath = path.join(sourceDir, fileName);

      if (!fs.existsSync(filePath)) {
        if (file.path && fs.existsSync(file.path)) {
          await this.linkOrCopyFile(file.path, filePath);
        } else {
          await fs.promises.writeFile(filePath, buffer);
        }
      }

      pdfs.push({
        id: `pdf_${hash.slice(0, 24)}`,
        originalName: this.restoreOriginalName(file.originalname || safeName),
        fileName,
        filePath,
        size: file.size || buffer.length,
      });
    }

    return pdfs;
  }

  private async createSourceMeta(filePath: string, originalName: string): Promise<PdfWikiSourcePdf> {
    const buffer = await fs.promises.readFile(filePath);
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const stat = await fs.promises.stat(filePath);
    return {
      id: `pdf_${hash.slice(0, 24)}`,
      originalName,
      fileName: path.basename(filePath),
      filePath,
      size: stat.size,
    };
  }

  private async tryExtractPdfWithFastText(
    userId: string,
    pdf: PdfWikiSourcePdf,
    allowExternalMetadata = true
  ): Promise<PdfWikiParsedContent | null> {
    try {
      const result = await extractPdfTextWithFastText(pdf.filePath, {
        outputDir: this.getParsedTextDir(userId),
        label: pdf.originalName,
      });
      const text = this.normalizeExtractedText(result.text);
      if (!text) {
        throw new Error('快速文本提取结果为空');
      }

      const references = this.parseReferences(text, pdf.id, pdf.originalName);
      const inferredMetadata = this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text));
      const metadata = allowExternalMetadata
        ? await this.enrichSourceMetadataWithDoi(inferredMetadata, text, pdf.originalName)
        : inferredMetadata;
      await this.saveParsedTextCache(userId, pdf, {
        parser: 'fast-text',
        markdown: result.markdown,
        text,
        references,
        metadata,
      });
      logger.info(`[PdfWiki] Parsed ${pdf.originalName} with pdf-marker-md fast text: text=${text.length}, refs=${references.length}`);
      return {
        text,
        metadata,
        references,
        parser: 'fast-text',
      };
    } catch (error) {
      logger.warn(`[PdfWiki] pdf-marker-md fast text parse failed for ${pdf.originalName}, falling back to pdf-parse: ${(error as Error).message}`);
      return null;
    }
  }

  private async tryExtractPdfWithMarker(
    userId: string,
    pdf: PdfWikiSourcePdf,
    allowExternalMetadata = true
  ): Promise<PdfWikiParsedContent | null> {
    try {
      const result = await extractPdfTextWithMarker(pdf.filePath, {
        outputDir: this.getParsedTextDir(userId),
        label: pdf.originalName,
      });
      const text = this.normalizeExtractedText(result.text);
      if (!text) {
        throw new Error('Marker 提取结果为空');
      }

      const references = this.parseReferences(text, pdf.id, pdf.originalName);
      const inferredMetadata = this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text));
      const metadata = allowExternalMetadata
        ? await this.enrichSourceMetadataWithDoi(inferredMetadata, text, pdf.originalName)
        : inferredMetadata;
      await this.saveParsedTextCache(userId, pdf, {
        parser: 'marker',
        markdown: result.markdown,
        text,
        references,
        metadata,
      });
      logger.info(`[PdfWiki] Parsed ${pdf.originalName} with Marker: text=${text.length}, refs=${references.length}`);
      return {
        text,
        metadata,
        references,
        parser: 'marker',
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Marker parse failed for ${pdf.originalName}, falling back: ${(error as Error).message}`);
      return null;
    }
  }

  private async tryExtractPdfWithLiteParse(
    userId: string,
    pdf: PdfWikiSourcePdf,
    allowExternalMetadata = true
  ): Promise<PdfWikiParsedContent | null> {
    try {
      const result = await extractPdfTextWithLiteParse(pdf.filePath, {
        outputDir: this.getParsedTextDir(userId),
        label: pdf.originalName,
      });
      const text = this.normalizeExtractedText(result.text);
      if (!text) {
        throw new Error('LiteParse 提取结果为空');
      }

      const references = this.parseReferences(text, pdf.id, pdf.originalName);
      const inferredMetadata = this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text));
      const metadata = allowExternalMetadata
        ? await this.enrichSourceMetadataWithDoi(inferredMetadata, text, pdf.originalName)
        : inferredMetadata;
      await this.saveParsedTextCache(userId, pdf, {
        parser: 'liteparse',
        markdown: result.markdown,
        text,
        references,
        metadata,
      });
      logger.info(`[PdfWiki] Parsed ${pdf.originalName} with LiteParse: text=${text.length}, pages=${result.pageCount}, refs=${references.length}`);
      return {
        text,
        metadata,
        references,
        parser: 'liteparse',
      };
    } catch (error) {
      logger.warn(`[PdfWiki] LiteParse parse failed for ${pdf.originalName}, falling back: ${(error as Error).message}`);
      return null;
    }
  }

  private async extractPdfTextForDeepAnalysis(
    userId: string,
    pdf: PdfWikiSourcePdf
  ): Promise<PdfWikiParsedContent | null> {
    const liteParsed = await this.tryExtractPdfWithLiteParse(userId, pdf);
    if (liteParsed) return liteParsed;

    const markerParsed = await this.tryExtractPdfWithMarker(userId, pdf);
    if (markerParsed) return markerParsed;

    const fastTextParsed = await this.tryExtractPdfWithFastText(userId, pdf);
    if (fastTextParsed) return fastTextParsed;

    try {
      const text = this.normalizeExtractedText(await this.extractPdfTextWithPdfParse(pdf.filePath));
      if (!text) return null;
      const references = this.parseReferences(text, pdf.id, pdf.originalName);
      const metadata = await this.enrichSourceMetadataWithDoi(this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text)), text, pdf.originalName);
      await this.saveParsedTextCache(userId, pdf, {
        parser: 'pdf-parse',
        markdown: text,
        text,
        references,
        metadata,
      });
      logger.info(`[PdfWiki] Parsed ${pdf.originalName} with pdf-parse for deep analysis: text=${text.length}, refs=${references.length}`);
      return {
        text,
        metadata,
        references,
        parser: 'pdf-parse',
      };
    } catch (error) {
      logger.warn(`[PdfWiki] pdf-parse deep analysis text extraction failed for ${pdf.originalName}: ${(error as Error).message}`);
      return null;
    }
  }

  private async tryExtractPdfWithTextIn(
    userId: string,
    pdf: PdfWikiSourcePdf,
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiParsedContent | null> {
    const appId = String(llmConfig.textInAppId || '').trim();
    const secretCode = String(llmConfig.textInSecretCode || '').trim();
    if (!appId || !secretCode) return null;

    const endpoint = String(llmConfig.textInApiUrl || 'https://api.textin.com/ai/service/v1/pdf_to_markdown').trim();
    const buffer = await fs.promises.readFile(pdf.filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer as any], { type: 'application/pdf' }), pdf.originalName || pdf.fileName);
    if (llmConfig.textInParseMode) {
      form.append('parse_mode', llmConfig.textInParseMode);
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'x-ti-app-id': appId,
          'x-ti-secret-code': secretCode,
        },
        body: form as any,
      });
      const raw = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${raw.slice(0, 240)}`);
      }

      const parsedResponse = this.asRecord(this.parseJsonContent(raw) || raw);
      const result = this.asRecord(parsedResponse.result || parsedResponse.data);
      const markdown = this.firstString(
        result.markdown,
        result.md,
        result.text,
        parsedResponse.markdown,
        parsedResponse.md,
        parsedResponse.text,
        raw.trim().startsWith('{') ? '' : raw
      );
      const text = this.normalizeExtractedText(markdown);
      if (!text) {
        throw new Error('TextIn 返回结果为空');
      }

      const references = this.parseReferences(text, pdf.id, pdf.originalName);
      const metadata = await this.enrichSourceMetadataWithDoi(this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text)), text, pdf.originalName);
      await this.saveParsedTextCache(userId, pdf, {
        parser: 'textin',
        markdown,
        text,
        references,
        metadata,
      });
      logger.info(`[PdfWiki] Parsed ${pdf.originalName} with TextIn: text=${text.length}, refs=${references.length}`);
      return {
        text,
        metadata,
        references,
        parser: 'textin',
      };
    } catch (error) {
      logger.warn(`[PdfWiki] TextIn parse failed for ${pdf.originalName}, falling back to GROBID/pdf-parse: ${(error as Error).message}`);
      return null;
    }
  }

  private async saveParsedTextCache(
    userId: string,
    pdf: PdfWikiSourcePdf,
    parsed: {
      parser: PdfWikiParsedContent['parser'];
      markdown: string;
      text: string;
      references: PdfWikiReference[];
      metadata: Partial<PdfWikiSourcePdf>;
      metaData?: Record<string, unknown>;
    }
  ): Promise<void> {
    try {
      const dir = this.getParsedTextDir(userId);
      await fs.promises.mkdir(dir, { recursive: true });

      const safeId = this.getSafePdfCacheId(pdf);
      const baseName = `${safeId}.${parsed.parser}`;
      const markdownPath = path.join(dir, `${baseName}.md`);
      const textPath = path.join(dir, `${baseName}.txt`);
      const metaPath = path.join(dir, `${baseName}.json`);
      const cachedAt = new Date().toISOString();

      await fs.promises.writeFile(markdownPath, parsed.markdown, 'utf-8');
      await fs.promises.writeFile(textPath, parsed.text, 'utf-8');
      await fs.promises.writeFile(metaPath, JSON.stringify({
        sourcePdfId: pdf.id,
        sourcePdfName: pdf.originalName,
        sourcePdfFile: pdf.fileName,
        parser: parsed.parser,
        cachedAt,
        markdownLength: parsed.markdown.length,
        textLength: parsed.text.length,
        referenceCount: parsed.references.length,
        metadata: parsed.metadata,
        metaData: parsed.metaData || this.buildPdfMetaDataRecord(
          { ...pdf, ...parsed.metadata, extractionParser: parsed.parser },
          {
            text: parsed.text,
            metadata: parsed.metadata,
            references: parsed.references,
            parser: parsed.parser,
          },
          parsed.references
        ),
        references: parsed.references,
        files: {
          markdown: path.basename(markdownPath),
          text: path.basename(textPath),
        },
      }, null, 2), 'utf-8');

      pdf.parsedMarkdownPath = markdownPath;
      pdf.parsedTextPath = textPath;
      pdf.parsedTextCachedAt = cachedAt;
      pdf.metaData = parsed.metaData || pdf.metaData;
      pdf.metaDataCachedAt = cachedAt;
      pdf.extractionParser = parsed.parser;
      logger.info(`[PdfWiki] Saved parsed text cache for ${pdf.originalName}: ${textPath}`);
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to save parsed text cache for ${pdf.originalName}:`, error);
    }
  }

  private getSafePdfCacheId(pdf: Pick<PdfWikiSourcePdf, 'id' | 'originalName' | 'fileName'>): string {
    return pdf.id.replace(/[^a-zA-Z0-9_-]/g, '_') || crypto
      .createHash('sha256')
      .update(pdf.originalName || pdf.fileName || 'pdf')
      .digest('hex')
      .slice(0, 24);
  }

  private inferParserFromCachePath(filePath: string): PdfWikiParsedContent['parser'] {
    const baseName = path.basename(filePath).toLowerCase();
    if (baseName.includes('.codex.')) return 'codex';
    if (baseName.includes('.liteparse.')) return 'liteparse';
    if (baseName.includes('.marker.')) return 'marker';
    if (baseName.includes('.fast-text.')) return 'fast-text';
    if (baseName.includes('.textin.')) return 'textin';
    if (baseName.includes('.grobid.')) return 'grobid';
    return 'pdf-parse';
  }

  private async loadParsedTextCache(userId: string, pdf: PdfWikiSourcePdf): Promise<PdfWikiParsedContent | null> {
    const candidates: string[] = [];
    const dir = this.getParsedTextDir(userId);
    const safeId = this.getSafePdfCacheId(pdf);

    if (pdf.parsedTextPath && fs.existsSync(pdf.parsedTextPath)) {
      candidates.push(pdf.parsedTextPath);
    }

    if (fs.existsSync(dir)) {
      const metaFiles = fs.readdirSync(dir)
        .filter(name => name.endsWith('.json') && name.startsWith(`${safeId}.`))
        .sort((a, b) => {
          const score = (name: string): number => {
            if (name.includes('.codex.')) return 0;
            if (name.includes('.liteparse.')) return 1;
            if (name.includes('.marker.')) return 2;
            if (name.includes('.fast-text.')) return 3;
            if (name.includes('.textin.')) return 4;
            if (name.includes('.grobid.')) return 5;
            return 6;
          };
          return score(a) - score(b);
        })
        .map(name => path.join(dir, name));

      for (const metaPath of metaFiles) {
        try {
          const meta = JSON.parse(await fs.promises.readFile(metaPath, 'utf-8')) as {
            sourcePdfId?: string;
            parser?: PdfWikiParsedContent['parser'];
            metadata?: Partial<PdfWikiSourcePdf>;
            metaData?: Record<string, unknown>;
            references?: PdfWikiReference[];
            files?: { text?: string };
          };
          if (meta.sourcePdfId && meta.sourcePdfId !== pdf.id) continue;
          const textPath = meta.files?.text ? path.join(dir, meta.files.text) : metaPath.replace(/\.json$/i, '.txt');
          if (!fs.existsSync(textPath)) continue;
          const text = this.normalizeExtractedText(await fs.promises.readFile(textPath, 'utf-8'));
          if (!text) continue;
          const cachedReferences = Array.isArray(meta.references) ? meta.references : [];
          const references = cachedReferences.length > 0
            ? cachedReferences
            : this.parseReferences(text, pdf.id, pdf.originalName);
          logger.info(`[PdfWiki] Reusing parsed text cache for ${pdf.originalName}: ${textPath}`);
          return {
            text,
            metadata: this.cleanSourceMetadata(meta.metadata || this.inferSourceMetadata(pdf.originalName, text)),
            references,
            parser: meta.parser || this.inferParserFromCachePath(textPath),
            metaData: this.asRecord(meta.metaData),
          };
        } catch (error) {
          logger.warn(`[PdfWiki] Failed to read parsed text cache metadata ${metaPath}:`, error);
        }
      }
    }

    for (const textPath of candidates) {
      try {
        const text = this.normalizeExtractedText(await fs.promises.readFile(textPath, 'utf-8'));
        if (!text) continue;
        logger.info(`[PdfWiki] Reusing parsed text cache for ${pdf.originalName}: ${textPath}`);
        return {
          text,
          metadata: this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text)),
          references: this.parseReferences(text, pdf.id, pdf.originalName),
          parser: this.inferParserFromCachePath(textPath),
        };
      } catch (error) {
        logger.warn(`[PdfWiki] Failed to read parsed text cache ${textPath}:`, error);
      }
    }

    return null;
  }

  private async tryBuildPdfWithCodex(
    userId: string,
    pdf: PdfWikiSourcePdf,
    configOverride?: PdfWikiCodexConfig,
    llmConfig?: PdfWikiLlmConfig,
    onProgress?: PdfWikiCodexProgressHandler
  ): Promise<PdfWikiCodexBuildResult | null> {
    if (!this.canUseCodexCli()) return null;

    const config = configOverride || this.loadPdfWikiCodexConfig();
    const taskDir = this.getCodexPdfWikiTaskDir(userId, pdf);
    const sourcePdfPath = path.join(taskDir, 'source.pdf');

    try {
      await this.prepareCodexPdfWikiTaskDir(taskDir);
      await this.linkOrCopyFile(pdf.filePath, sourcePdfPath);

      const paperId = this.getSafePdfCacheId(pdf);
      const sourceInfo = {
        paper_id: paperId,
        source_pdf: 'source.pdf',
        original_name: pdf.originalName,
        original_path: pdf.filePath,
        prepared_at: new Date().toISOString(),
      };
      await fs.promises.writeFile(path.join(taskDir, 'source_info.json'), JSON.stringify(sourceInfo, null, 2), 'utf-8');
      const metaTemplate = this.loadMetaAnalysisTemplate(userId);
      if (metaTemplate) {
        await fs.promises.writeFile(path.join(taskDir, 'meta_analysis_template.json'), JSON.stringify(metaTemplate, null, 2), 'utf-8');
      }

      const prompt = this.makeCodexPdfWikiPrompt(userId, pdf, paperId, llmConfig);
      await fs.promises.writeFile(path.join(taskDir, 'TASK_PROMPT.md'), `${prompt}\n`, 'utf-8');

      const progressHandler = onProgress
        ? (message: string) => onProgress(`${message}（${pdf.originalName}）`)
        : undefined;
      await this.runCodexPdfWikiTask(config, taskDir, prompt, progressHandler);

      const fulltextMd = await this.readTextFileIfExists(path.join(taskDir, 'fulltext.md'));
      const fulltextJson = await this.readJsonFileIfExists(path.join(taskDir, 'fulltext.json'));
      const metaDataJson = await this.readJsonFileIfExists(path.join(taskDir, 'meta_data.json'));
      const claimsJson =
        await this.readJsonFileIfExists(path.join(taskDir, 'pdf_wiki_claims.json'))
        || await this.readJsonFileIfExists(path.join(taskDir, 'claims.json'))
        || this.parseJsonContent(await this.readTextFileIfExists(path.join(taskDir, 'codex_last_message.txt')));

      const text = this.normalizeExtractedText(fulltextMd || this.codexFulltextJsonToText(fulltextJson));
      if (!text) {
        throw new Error('Codex 未生成可用 fulltext.md/fulltext.json');
      }

      const metadata = this.extractCodexMetadata(fulltextJson, metaDataJson, pdf, text);
      const references = this.mergeReferenceIndexes(
        this.extractCodexReferences(fulltextJson, pdf),
        this.extractCodexReferences(metaDataJson, pdf),
        this.parseReferences(text, pdf.id, pdf.originalName),
      );
      const metaData = this.buildPdfMetaDataRecord(
        { ...pdf, ...metadata, extractionParser: 'codex' },
        {
          text,
          metadata,
          references,
          parser: 'codex',
        },
        references,
        metaDataJson
      );
      const parsedContent: PdfWikiParsedContent = {
        text,
        metadata,
        references,
        parser: 'codex',
        metaData,
      };

      await this.saveParsedTextCache(userId, pdf, {
        parser: 'codex',
        markdown: fulltextMd || text,
        text,
        references,
        metadata,
        metaData,
      });

      const claims = this.extractCodexClaims(claimsJson);
      const sentenceEvidence = this.buildSentenceEvidenceMap('FullText', text, references, pdf.id);
      const entries = claims
        .map((claim, index) => this.createEntryFromClaim({
          ...claim,
          location: claim.location || `Codex PDF task ${index + 1}`,
        }, pdf, index, references, sentenceEvidence))
        .filter((entry): entry is PdfWikiEntry => !!entry);

      if (entries.length === 0) {
        logger.warn(`[PdfWiki] Codex extracted text for ${pdf.originalName} but produced no pdf_wiki_claims entries`);
      } else {
        logger.info(`[PdfWiki] Built ${entries.length} entries from ${pdf.originalName} via Codex CLI`);
      }

      return {
        parsedContent,
        referenceIndex: { metadata, references },
        entries,
        taskDir,
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Codex PDF extraction failed for ${pdf.originalName}, falling back to configured APIs:`, error);
      return null;
    }
  }

  private async tryExtractPdfMetaAnalysisWithCodex(
    userId: string,
    pdf: PdfWikiSourcePdf,
    configOverride: PdfWikiCodexConfig,
    llmConfig: PdfWikiLlmConfig,
    onProgress?: PdfWikiCodexProgressHandler
  ): Promise<PdfWikiCodexMetaAnalysisResult | null> {
    if (!this.canUseCodexCli()) return null;

    const taskDir = this.getCodexPdfWikiTaskDir(userId, pdf);
    const sourcePdfPath = path.join(taskDir, 'source.pdf');

    try {
      await this.prepareCodexPdfWikiTaskDir(taskDir);
      await this.linkOrCopyFile(pdf.filePath, sourcePdfPath);

      const paperId = this.getSafePdfCacheId(pdf);
      const sourceInfo = {
        paper_id: paperId,
        source_pdf: 'source.pdf',
        original_name: pdf.originalName,
        original_path: pdf.filePath,
        task_kind: 'meta-analysis',
        prepared_at: new Date().toISOString(),
      };
      await fs.promises.writeFile(path.join(taskDir, 'source_info.json'), JSON.stringify(sourceInfo, null, 2), 'utf-8');
      await fs.promises.writeFile(path.join(taskDir, 'pdf_wiki_claims.json'), JSON.stringify({ claims: [] }, null, 2), 'utf-8');

      const metaTemplate = this.loadMetaAnalysisTemplate(userId);
      if (metaTemplate) {
        await fs.promises.writeFile(path.join(taskDir, 'meta_analysis_template.json'), JSON.stringify(metaTemplate, null, 2), 'utf-8');
      }

      const prompt = this.makeCodexMetaAnalysisPrompt(userId, pdf, paperId, llmConfig);
      await fs.promises.writeFile(path.join(taskDir, 'TASK_PROMPT.md'), `${prompt}\n`, 'utf-8');

      const progressHandler = onProgress
        ? (message: string) => onProgress(`${message}（${pdf.originalName}）`)
        : undefined;
      await this.runCodexPdfWikiTask(configOverride, taskDir, prompt, progressHandler);

      const fulltextMd = await this.readTextFileIfExists(path.join(taskDir, 'fulltext.md'));
      const rawPlain = await this.readTextFileIfExists(path.join(taskDir, 'raw_plain.txt'));
      const rawLayout = await this.readTextFileIfExists(path.join(taskDir, 'raw_layout.txt'));
      const fulltextJson = await this.readJsonFileIfExists(path.join(taskDir, 'fulltext.json'));
      const lastMessageJson = this.parseJsonContent(await this.readTextFileIfExists(path.join(taskDir, 'codex_last_message.txt')));
      const metaDataJson =
        await this.readJsonFileIfExists(path.join(taskDir, 'meta_data.json'))
        || this.asRecord(lastMessageJson).meta_data
        || lastMessageJson;

      const text = this.normalizeExtractedText(fulltextMd || this.codexFulltextJsonToText(fulltextJson) || rawPlain || rawLayout);
      if (!text) {
        throw new Error('Codex 未生成可用 fulltext.md/fulltext.json/raw_plain.txt');
      }

      const metadata = this.extractCodexMetadata(fulltextJson, metaDataJson, pdf, text);
      const references = this.mergeReferenceIndexes(
        this.extractCodexReferences(fulltextJson, pdf),
        this.extractCodexReferences(metaDataJson, pdf),
        this.parseReferences(text, pdf.id, pdf.originalName),
      );
      const metaData = this.buildPdfMetaDataRecord(
        { ...pdf, ...metadata, extractionParser: 'codex' },
        {
          text,
          metadata,
          references,
          parser: 'codex',
        },
        references,
        metaDataJson
      );
      const parsedContent: PdfWikiParsedContent = {
        text,
        metadata,
        references,
        parser: 'codex',
        metaData,
      };

      await this.saveParsedTextCache(userId, pdf, {
        parser: 'codex',
        markdown: fulltextMd || text,
        text,
        references,
        metadata,
        metaData,
      });

      const [tableCount, figureCount] = await Promise.all([
        this.countCodexOutputFiles(path.join(taskDir, 'tables'), /\.(?:csv|json)$/i),
        this.countCodexOutputFiles(path.join(taskDir, 'figures'), /\.(?:png|jpe?g|webp|json)$/i),
      ]);

      logger.info(`[PdfWiki] Codex Meta extraction completed for ${pdf.originalName}: rows=${this.extractExplicitMetaAnalysisRows(metaData).length}, tables=${tableCount}, figures=${figureCount}`);
      return {
        parsedContent,
        referenceIndex: { metadata, references },
        metaData,
        taskDir,
        tableCount,
        figureCount,
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Codex Meta extraction failed for ${pdf.originalName}; no fallback will be used:`, error);
      throw error;
    }
  }

  private canUseCodexCli(explicitlyRequested = false): boolean {
    const config = this.loadPdfWikiCodexConfig();
    if (!explicitlyRequested && !this.isPdfWikiCodexEnabled(config)) {
      return false;
    }
    return !!this.findCodexCliExecutable(config.command);
  }

  private isPdfWikiCodexEnabled(config = this.loadPdfWikiCodexConfig()): boolean {
    const override = String(process.env.PDF_WIKI_CODEX_ENABLED || '').trim();
    if (/^(false|0|off)$/i.test(override)) return false;
    if (/^(true|1|on)$/i.test(override)) return true;
    return config.enabled && config.prefer;
  }

  private loadPdfWikiCodexConfig(): PdfWikiCodexConfig {
    let savedCodex: Record<string, unknown> = {};
    try {
      const configPath = path.join(this.dataDir, 'chat-bridge-config.json');
      if (fs.existsSync(configPath)) {
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as { codex?: Record<string, unknown> };
        savedCodex = parsed.codex || {};
      }
    } catch (error) {
      logger.warn('[PdfWiki] Failed to read ChatBridge Codex config:', error);
    }

    const effort = String(
      process.env.PDF_WIKI_CODEX_REASONING_EFFORT
      || savedCodex.reasoning_effort
      || 'xhigh'
    ).trim().toLowerCase();
    const reasoningEffort = (['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)
      ? effort
      : 'xhigh') as PdfWikiCodexConfig['reasoningEffort'];

    const requestedSandbox = String(
      process.env.PDF_WIKI_CODEX_SANDBOX
      || savedCodex.pdf_wiki_sandbox
      || 'danger-full-access'
    ).trim();
    const sandbox = requestedSandbox === 'danger-full-access' ? 'danger-full-access' : 'workspace-write';

    const configuredConcurrency = Number(
      process.env.PDF_WIKI_CODEX_CONCURRENCY
      || savedCodex.pdf_wiki_concurrency
      || savedCodex.concurrency
      || 1
    );
    const concurrency = Math.max(1, Math.min(6, Math.floor(Number.isFinite(configuredConcurrency) ? configuredConcurrency : 1)));

    const prefer = savedCodex.prefer === true;
    const enabled = savedCodex.enabled === true || (savedCodex.enabled === undefined && prefer);

    return {
      enabled,
      prefer,
      command: this.normalizeCodexCliCommand(
        process.env.PDF_WIKI_CODEX_COMMAND
        || process.env.CODEX_CLI_PATH
        || process.env.CODEX_BINARY
        || String(savedCodex.command || '')
      ),
      model: String(process.env.PDF_WIKI_CODEX_MODEL || savedCodex.model || 'gpt-5.5').trim() || 'gpt-5.5',
      reasoningEffort,
      sandbox,
      concurrency,
    };
  }

  private normalizeCodexCliCommand(value?: string): string {
    return String(value || '').trim().replace(/^[\s"'`]+|[\s"'`]+$/g, '');
  }

  private getCodexCliCandidates(commandOverride?: string): string[] {
    const candidates: string[] = [];
    const add = (value?: string): void => {
      const normalized = this.normalizeCodexCliCommand(value);
      if (normalized) candidates.push(normalized);
    };

    add(commandOverride);
    add(process.env.PDF_WIKI_CODEX_COMMAND);
    add(process.env.CODEX_CLI_PATH);
    add(process.env.CODEX_BINARY);

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const scoop = process.env.SCOOP || path.join(os.homedir(), 'scoop');
      candidates.push(
        path.join(appData, 'npm', 'codex.cmd'),
        path.join(appData, 'npm', 'codex.exe'),
        path.join(appData, 'npm', 'codex.bat'),
        path.join(appData, 'npm', 'codex.ps1'),
        path.join(localAppData, 'pnpm', 'codex.cmd'),
        path.join(localAppData, 'Volta', 'bin', 'codex.cmd'),
        path.join(localAppData, 'Programs', 'nodejs', 'codex.cmd'),
        path.join(programFiles, 'nodejs', 'codex.cmd'),
        path.join(scoop, 'shims', 'codex.cmd'),
      );
    } else {
      candidates.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', '/usr/bin/codex');
    }

    const pathExts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.PS1').split(';').filter(Boolean)
      : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (process.platform === 'win32') {
        for (const ext of pathExts) {
          candidates.push(path.join(dir, `codex${ext.toLowerCase()}`));
        }
      } else {
        candidates.push(path.join(dir, 'codex'));
      }
    }

    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private findCodexCliExecutable(commandOverride?: string): string | null {
    return this.getCodexCliCandidates(commandOverride).find(candidate => fs.existsSync(candidate)) || null;
  }

  private resolveCodexCliExecutable(commandOverride?: string): string {
    return this.findCodexCliExecutable(commandOverride) || this.normalizeCodexCliCommand(commandOverride) || 'codex';
  }

  private spawnCodexProcess(executable: string, args: string[]): ReturnType<typeof spawn> {
    const env = buildToolRuntimeEnv(process.env);
    const isWindowsPowerShellScript = process.platform === 'win32' && /\.ps1$/i.test(executable);
    if (isWindowsPowerShellScript) {
      return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args], {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env,
      });
    }

    const isWindowsBatchScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    if (isWindowsBatchScript) {
      return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', executable, ...args], {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env,
      });
    }

    return spawn(executable, args, {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env,
    });
  }

  private async terminateCodexProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
    const pid = child.pid;
    if (!pid) {
      if (child.exitCode === null) child.kill('SIGKILL');
      return;
    }

    if (process.platform === 'win32') {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = (): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };
        const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          shell: false,
          stdio: 'ignore',
        });
        const timer = setTimeout(() => {
          try {
            killer.kill('SIGKILL');
          } catch {
            // Ignore cleanup failures; the direct child fallback below still runs.
          }
          finish();
        }, 5000);
        killer.once('error', finish);
        killer.once('close', finish);
      });
    }

    if (child.exitCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // Process may already have exited after taskkill.
      }
    }
  }

  private async prepareCodexPdfWikiTaskDir(taskDir: string): Promise<void> {
    await fs.promises.mkdir(taskDir, { recursive: true });
    const staleNames = [
      'tables',
      'figures',
      'raw_plain.txt',
      'raw_layout.txt',
      'fulltext.md',
      'fulltext.json',
      'meta_data.json',
      'pdf_wiki_claims.json',
      'claims.json',
      'extraction_report.md',
      'codex_stdout.txt',
      'codex_stderr.txt',
      'codex_last_message.txt',
      'TASK_PROMPT.md',
      'logs.txt',
    ];
    for (const name of staleNames) {
      await fs.promises.rm(path.join(taskDir, name), { recursive: true, force: true });
    }
    await fs.promises.mkdir(path.join(taskDir, 'tables'), { recursive: true });
    await fs.promises.mkdir(path.join(taskDir, 'figures'), { recursive: true });
  }

  private async summarizeCodexPdfWikiTask(taskDir: string): Promise<string> {
    const expectedFiles = [
      { name: 'raw_plain.txt', label: '正文文本' },
      { name: 'raw_layout.txt', label: '版式文本' },
      { name: 'fulltext.md', label: 'fulltext.md' },
      { name: 'fulltext.json', label: 'fulltext.json' },
      { name: 'meta_data.json', label: 'meta_data.json' },
      { name: 'pdf_wiki_claims.json', label: 'pdf_wiki_claims.json' },
      { name: 'extraction_report.md', label: 'extraction_report.md' },
    ];
    const done: string[] = [];
    const missing: string[] = [];
    for (const item of expectedFiles) {
      try {
        const stat = await fs.promises.stat(path.join(taskDir, item.name));
        if (stat.isFile() && stat.size > 0) {
          done.push(item.label);
          continue;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
      missing.push(item.label);
    }

    const [tableFiles, figureFiles] = await Promise.all([
      this.countCodexOutputFiles(path.join(taskDir, 'tables'), /\.(?:csv|json)$/i),
      this.countCodexOutputFiles(path.join(taskDir, 'figures'), /\.(?:png|jpe?g|webp|json)$/i),
    ]);

    const parts: string[] = [];
    if (done.length > 0) {
      parts.push(`已生成 ${done.join('、')}`);
    }
    if (tableFiles > 0) {
      parts.push(`表格文件 ${tableFiles} 个`);
    }
    if (figureFiles > 0) {
      parts.push(`图件文件 ${figureFiles} 个`);
    }
    if (missing.length > 0) {
      parts.push(`等待 ${missing.slice(0, 4).join('、')}${missing.length > 4 ? ' 等' : ''}`);
    }
    return parts.join('；') || '正在启动 Codex CLI';
  }

  private async isCodexPdfWikiOutputComplete(taskDir: string): Promise<boolean> {
    const requiredFiles = [
      'fulltext.md',
      'fulltext.json',
      'meta_data.json',
      'pdf_wiki_claims.json',
      'extraction_report.md',
    ];
    for (const name of requiredFiles) {
      try {
        const stat = await fs.promises.stat(path.join(taskDir, name));
        if (!stat.isFile() || stat.size <= 0) return false;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    }
    return true;
  }

  private async countCodexOutputFiles(dir: string, pattern: RegExp): Promise<number> {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      return entries.filter(entry => entry.isFile() && pattern.test(entry.name)).length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }

  private async runCodexPdfWikiTask(
    config: PdfWikiCodexConfig,
    taskDir: string,
    prompt: string,
    onProgress?: PdfWikiCodexProgressHandler
  ): Promise<void> {
    const executable = this.resolveCodexCliExecutable(config.command);
    const stdoutPath = path.join(taskDir, 'codex_stdout.txt');
    const stderrPath = path.join(taskDir, 'codex_stderr.txt');
    const lastMessagePath = path.join(taskDir, 'codex_last_message.txt');
    const logsPath = path.join(taskDir, 'logs.txt');
    const args = [
      'exec',
      '--cd',
      taskDir,
      '--sandbox',
      config.sandbox,
      '-c',
      'sandbox_workspace_write.network_access=true',
      '--skip-git-repo-check',
      '--output-last-message',
      lastMessagePath,
    ];
    if (config.model) {
      args.push('-m', config.model);
    }
    if (config.reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${config.reasoningEffort}"`);
    }
    args.push('-');

    await fs.promises.writeFile(
      logsPath,
      [
        `Prepared direct Codex PDF Wiki task at ${new Date().toISOString()}`,
        `Command: ${executable} ${args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg).join(' ')}`,
        `Model: ${config.model}`,
        `Reasoning effort: ${config.reasoningEffort}`,
        `Sandbox: ${config.sandbox}`,
        '',
      ].join('\n'),
      'utf-8'
    );

    await new Promise<void>((resolve, reject) => {
      const child = this.spawnCodexProcess(executable, args);
      let stdout = '';
      let stderr = '';
      let settled = false;
      let progressTimer: ReturnType<typeof setInterval> | null = null;
      const emitProgress = async (): Promise<void> => {
        if (!onProgress) return;
        const summary = await this.summarizeCodexPdfWikiTask(taskDir);
        await onProgress(`阶段 1/3：Codex CLI 正在处理 PDF，${summary}`);
        await fs.promises.appendFile(logsPath, `[${new Date().toISOString()}] ${summary}\n`, 'utf-8');
      };
      const clearTaskTimers = (): void => {
        if (progressTimer) {
          clearInterval(progressTimer);
          progressTimer = null;
        }
      };
      if (onProgress) {
        void emitProgress().catch(error => logger.warn('[PdfWiki] Failed to report Codex progress:', error));
        progressTimer = setInterval(() => {
            void emitProgress().catch(error => logger.warn('[PdfWiki] Failed to report Codex progress:', error));
          }, 10000);
      }

      child.stdout?.on('data', chunk => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearTaskTimers();
        reject(error);
      });
      child.on('close', async code => {
        if (settled) return;
        settled = true;
        clearTaskTimers();
        try {
          await fs.promises.writeFile(stdoutPath, stdout || '', 'utf-8');
          await fs.promises.writeFile(stderrPath, stderr || '', 'utf-8');
          try {
            await emitProgress();
          } catch (progressError) {
            logger.warn('[PdfWiki] Failed to report final Codex progress:', progressError);
          }
        } catch (error) {
          reject(error);
          return;
        }
        if (code !== 0) {
          const output = (stderr || stdout || 'no output').trim();
          const preview = output.length > 1800 ? output.slice(-1800) : output;
          reject(new Error(`Codex CLI exited with code ${code}: ${preview}`));
          return;
        }
        resolve();
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private async runCodexTextTask(
    config: PdfWikiCodexConfig,
    taskDir: string,
    prompt: string,
    contextLabel: string,
    onHeartbeat?: (elapsedMs: number) => Promise<void> | void
  ): Promise<string> {
    await fs.promises.mkdir(taskDir, { recursive: true });
    const executable = this.resolveCodexCliExecutable(config.command);
    const safeLabel = contextLabel.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80) || 'task';
    const stdoutPath = path.join(taskDir, `${safeLabel}_stdout.txt`);
    const stderrPath = path.join(taskDir, `${safeLabel}_stderr.txt`);
    const lastMessagePath = path.join(taskDir, `${safeLabel}_last_message.txt`);
    const promptPath = path.join(taskDir, `${safeLabel}_TASK_PROMPT.md`);
    const args = [
      'exec',
      '--cd',
      taskDir,
      '--sandbox',
      config.sandbox,
      '-c',
      'sandbox_workspace_write.network_access=true',
      '--skip-git-repo-check',
      '--output-last-message',
      lastMessagePath,
    ];
    if (config.model) {
      args.push('-m', config.model);
    }
    if (config.reasoningEffort) {
      args.push('-c', `model_reasoning_effort="${config.reasoningEffort}"`);
    }
    args.push('-');

    await fs.promises.writeFile(promptPath, `${prompt}\n`, 'utf-8');
    logger.info(`[PdfWiki] Codex CLI ${contextLabel}: command=${executable}; model=${config.model}; effort=${config.reasoningEffort}; prompt=${prompt.length} chars`);

    return new Promise<string>((resolve, reject) => {
      const child = this.spawnCodexProcess(executable, args);
      let stdout = '';
      let stderr = '';
      let settled = false;
      const taskStartedAt = Date.now();
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const clearRuntimeTimers = (): void => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };
      if (onHeartbeat) {
        const emitHeartbeat = (): void => {
          void Promise.resolve(onHeartbeat(Date.now() - taskStartedAt)).catch(error => {
            logger.warn(`[PdfWiki] Failed to report ${contextLabel} heartbeat:`, error);
          });
        };
        emitHeartbeat();
        heartbeatTimer = setInterval(emitHeartbeat, 10000);
      }

      child.stdout?.on('data', chunk => {
        stdout += chunk.toString();
      });
      child.stderr?.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('error', error => {
        if (settled) return;
        settled = true;
        clearRuntimeTimers();
        reject(error);
      });
      child.on('close', async code => {
        if (settled) return;
        settled = true;
        clearRuntimeTimers();
        try {
          await fs.promises.writeFile(stdoutPath, stdout || '', 'utf-8');
          await fs.promises.writeFile(stderrPath, stderr || '', 'utf-8');
          const lastMessage = fs.existsSync(lastMessagePath)
            ? (await fs.promises.readFile(lastMessagePath, 'utf-8')).trim()
            : '';
          const content = lastMessage || stdout.trim();
          if (code !== 0) {
            reject(new Error(`Codex CLI ${contextLabel} exited with code ${code}: ${(stderr || stdout || 'no output').slice(0, 1200)}`));
            return;
          }
          if (!content) {
            reject(new Error(`Codex CLI ${contextLabel} returned empty response`));
            return;
          }
          resolve(content);
        } catch (error) {
          reject(error);
        }
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }

  private async callCodexJsonTask(
    config: PdfWikiCodexConfig,
    taskDir: string,
    prompt: string,
    contextLabel: string,
    onProgress?: PdfWikiCodexJsonProgressHandler
  ): Promise<Record<string, unknown>> {
    const maxAttempts = this.getCodexJsonRetryCount();
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptDir = path.join(taskDir, `attempt_${attempt}`);
      const emitProgress = async (elapsedMs: number, message: string): Promise<void> => {
        if (!onProgress) return;
        try {
          await onProgress({ attempt, maxAttempts, elapsedMs, message });
        } catch (error) {
          logger.warn(`[PdfWiki] Failed to report ${contextLabel} attempt progress:`, error);
        }
      };
      const attemptPrompt = attempt === 1
        ? prompt
        : `${prompt}

上一次 Codex CLI 输出失败或不是合法 JSON。请重新执行同一任务。
硬性要求：
1. 只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。
2. JSON 必须能被 JSON.parse 直接解析。
3. 不要输出空内容。
4. 如果没有可抽取内容，按任务类型返回空数组结构，例如 {"claims":[]} 或 {"claimTranslations":[],"groups":[],"similarPairs":[]}.`;

      try {
        await emitProgress(0, `Codex 正在处理第 ${attempt}/${maxAttempts} 次尝试`);
        const content = await this.runCodexTextTask(config, attemptDir, `${attemptPrompt}

最终只输出一个合法 JSON 对象，不要 Markdown 代码块，不要解释。`, contextLabel, async (elapsedMs) => {
          await emitProgress(elapsedMs, `Codex 正在处理第 ${attempt}/${maxAttempts} 次尝试，已等待 ${Math.max(1, Math.round(elapsedMs / 1000))} 秒`);
        });
        const parsed = this.parseJsonContent(content);
        if (parsed) return parsed;

        const repairPrompt = `下面内容本应是一个 JSON 对象，但格式不合法。请修复为 JSON.parse 可直接解析的合法 JSON 对象。

要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. 不要新增输入中没有的信息。
3. 如果无法修复 claims，返回 {"claims":[]}；如果无法修复 groups，返回 {"claimTranslations":[],"groups":[],"similarPairs":[]}.

原始内容：
${content.slice(0, 20000)}`;
        await emitProgress(0, `Codex 第 ${attempt}/${maxAttempts} 次返回格式不完整，正在修复 JSON`);
        const repaired = await this.runCodexTextTask(config, path.join(attemptDir, 'repair'), repairPrompt, `${contextLabel}-repair`, async (elapsedMs) => {
          await emitProgress(elapsedMs, `Codex 正在修复第 ${attempt}/${maxAttempts} 次结果，已等待 ${Math.max(1, Math.round(elapsedMs / 1000))} 秒`);
        });
        const repairedParsed = this.parseJsonContent(repaired);
        if (repairedParsed) return repairedParsed;
        lastError = new Error(`Codex CLI ${contextLabel} returned invalid JSON on attempt ${attempt}`);
      } catch (error) {
        lastError = error;
        await emitProgress(0, attempt < maxAttempts
          ? `Codex 第 ${attempt}/${maxAttempts} 次失败，正在准备下一次尝试`
          : `Codex 第 ${attempt}/${maxAttempts} 次失败，已停止重试`);
        logger.warn(`[PdfWiki] Codex CLI ${contextLabel} attempt ${attempt}/${maxAttempts} failed: ${(error as Error).message}`);
      }
    }

    throw new Error(`Codex CLI ${contextLabel} failed after ${maxAttempts} attempts: ${(lastError as Error)?.message || String(lastError || 'unknown error')}`);
  }

  private getCodexJsonRetryCount(): number {
    const parsed = Number(process.env.PDF_WIKI_CODEX_JSON_RETRY_COUNT || 3);
    if (!Number.isFinite(parsed)) return 3;
    return Math.max(1, Math.min(5, Math.floor(parsed)));
  }

  private getCodexPdfWikiTaskDir(userId: string, pdf: PdfWikiSourcePdf): string {
    return path.join(this.getWikiDir(userId), 'codex-extract', this.getSafePdfCacheId(pdf));
  }

  private normalizePdfWikiTaskSubdirName(value: unknown, fallback: string): string {
    const text = this.stringifyTableCellValue(value)
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .map(part => part.replace(/[^a-zA-Z0-9_.-]+/g, '-').replace(/^-+|-+$/g, ''))
      .filter(Boolean)
      .join('/');
    return text || fallback;
  }

  private isNonScientificFigureRecord(record: Record<string, unknown>, fileName = ''): boolean {
    return isNonScientificPdfFigureRecord(record, fileName);
  }

  private filterScientificSourceFigures(values: unknown[]): unknown[] {
    const seenContentHashes = new Set<string>();
    return values.filter(item => {
      const record = this.asRecord(item);
      const fileName = this.firstString(record.name, record.file, record.path, typeof item === 'string' ? item : '');
      if (this.isNonScientificFigureRecord(record, fileName)) return false;
      const contentHash = this.firstString(record.contentHash, record.content_hash).toLowerCase();
      if (contentHash && seenContentHashes.has(contentHash)) return false;
      if (contentHash) seenContentHashes.add(contentHash);
      return true;
    });
  }

  private async ensureMetaAnalysisFigureCopies(
    userId: string,
    pdf: PdfWikiSourcePdf,
    metaData: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const rawSourceFigures = this.firstArray(metaData.source_figures, metaData.sourceFigures);
    const sourceFigures = this.filterScientificSourceFigures(rawSourceFigures);
    if (sourceFigures.length === 0) {
      return rawSourceFigures.length > 0
        ? { ...metaData, source_figures: [] }
        : metaData;
    }

    const taskDir = path.resolve(this.getCodexPdfWikiTaskDir(userId, pdf));
    const pdfFigureDir = path.resolve(path.join(taskDir, 'figures'));
    const metaFigureDir = path.resolve(path.join(taskDir, 'meta-figures'));
    const isInsideTaskDir = (filePath: string): boolean => {
      const resolved = path.resolve(filePath);
      return resolved === taskDir || resolved.startsWith(`${taskDir}${path.sep}`);
    };
    const resolveCandidate = (value: string): string => {
      const clean = String(value || '').replace(/[\\/]+/g, path.sep).trim();
      if (!clean) return '';
      const resolved = path.isAbsolute(clean) ? path.resolve(clean) : path.resolve(path.join(taskDir, clean));
      return isInsideTaskDir(resolved) ? resolved : '';
    };
    const findSourcePath = (record: Record<string, unknown>, relativeFile: string): string => {
      const candidates = [
        relativeFile,
        this.firstString(record.path, record.file_path, record.filePath, record.figure_file, record.figureFile),
        this.firstString(record.name),
      ].filter(Boolean);
      for (const candidate of candidates) {
        const resolved = resolveCandidate(candidate);
        if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
        const baseName = path.basename(String(candidate || ''));
        if (baseName) {
          const fromPdfFigures = path.join(pdfFigureDir, baseName);
          if (fs.existsSync(fromPdfFigures) && fs.statSync(fromPdfFigures).isFile()) return fromPdfFigures;
          const fromMetaFigures = path.join(metaFigureDir, baseName);
          if (fs.existsSync(fromMetaFigures) && fs.statSync(fromMetaFigures).isFile()) return fromMetaFigures;
        }
      }
      return '';
    };

    let changed = false;
    const nextFigures: Record<string, unknown>[] = [];
    await fs.promises.mkdir(metaFigureDir, { recursive: true });

    for (const figure of sourceFigures) {
      const record = this.asRecord(figure);
      const relativeFile = this.firstString(record.file, record.path, record.file_path, record.filePath, record.name);
      const normalizedRelative = relativeFile.replace(/[\\/]+/g, '/');
      if (/^meta-figures\//i.test(normalizedRelative)) {
        nextFigures.push(record);
        continue;
      }

      const sourcePath = findSourcePath(record, normalizedRelative);
      if (!sourcePath) {
        nextFigures.push(record);
        continue;
      }

      const extension = path.extname(sourcePath).toLowerCase();
      if (!/\.(?:png|jpe?g|webp|svg)$/i.test(extension)) {
        nextFigures.push(record);
        continue;
      }

      const baseName = path.basename(sourcePath);
      const targetPath = path.join(metaFigureDir, baseName);
      if (path.resolve(sourcePath) !== path.resolve(targetPath)) {
        await fs.promises.copyFile(sourcePath, targetPath).catch(() => undefined);
        const sourceJsonPath = path.join(path.dirname(sourcePath), `${path.basename(sourcePath, extension)}.json`);
        const targetJsonPath = path.join(metaFigureDir, `${path.basename(sourcePath, extension)}.json`);
        if (fs.existsSync(sourceJsonPath) && path.resolve(sourceJsonPath) !== path.resolve(targetJsonPath)) {
          await fs.promises.copyFile(sourceJsonPath, targetJsonPath).catch(() => undefined);
        }
      }
      changed = true;
      nextFigures.push({
        ...record,
        file: `meta-figures/${baseName}`,
        name: baseName,
        meta_analysis_figure_copy: true,
      });
    }

    return changed
      ? {
          ...metaData,
          source_figures: nextFigures,
        }
      : metaData;
  }

  private isWeakPdfMetadataValue(value: unknown): boolean {
    const text = typeof value === 'string' ? value.trim() : '';
    return !text
      || /^(empty|none|null|n\/a|na|unknown|未知|未解析|无)$/i.test(text)
      || this.isGarbledPdfMetadataText(text);
  }

  private isGarbledPdfMetadataText(value: unknown): boolean {
    const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    if (!text) return false;
    if (/(?:Thffi|Thffifl|ffl'|GoFf|B9B6)/i.test(text)) return true;

    const visible = text.replace(/\s/g, '');
    if (visible.length < 12) return false;

    const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
    const replacementCount = (text.match(/[\uFFFD□�]/g) || []).length;
    if (controlCount + replacementCount >= 2) return true;

    const readableCount = (text.match(/[\p{L}\p{N}]/gu) || []).length;
    const suspiciousCount = (text.match(/[^\p{L}\p{N}\s.,;:!?'"()[\]{}<>/\\\-–—+±=%&·•°_]/gu) || []).length;
    if ((controlCount + replacementCount + suspiciousCount) / Math.max(visible.length, 1) > 0.18) return true;
    return readableCount / Math.max(visible.length, 1) < 0.35 && suspiciousCount >= 4;
  }

  private isPdfTitleSameAsFileName(title: unknown, originalName: string): boolean {
    if (typeof title !== 'string' || !title.trim()) return true;
    const normalize = (value: string) => this.restoreOriginalName(path.basename(value))
      .replace(/\.pdf$/i, '')
      .replace(/[_\s-]+/g, ' ')
      .trim()
      .toLowerCase();
    return normalize(title) === normalize(originalName);
  }

  private isWeakPdfTitleCandidate(title: unknown, originalName = ''): boolean {
    if (this.isWeakPdfMetadataValue(title)) return true;
    const text = String(title || '').replace(/\s+/g, ' ').trim();
    const lower = text.toLowerCase();
    if (this.isGarbledPdfMetadataText(text)) return true;
    if (this.isPdfTitleSameAsFileName(text, originalName)) return true;
    if (this.isLikelyPdfJournalHeaderLine(text)) return true;
    if (this.isLikelyStandaloneJournalNameLine(text)) return true;
    if (/^(research article|review article|original article|article|short communication|editorial|commentary)$/i.test(text)) return true;
    if (/^(abstract|keywords?|introduction|materials|methods|results|discussion|conclusions?|references)\b/i.test(text)) return true;
    if (/(contents lists available|journal homepage|sciencedirect|elsevier|springer|wiley|mdpi|frontiers|published by|all rights reserved|creative commons|received|accepted|available online|published online|microsoft word|acrobat|manuscript|full\s*text|doi:|https?:\/\/|www\.)/i.test(text)) return true;
    if (/^(journal|volume|vol\.|issue|issn|isbn)\b/i.test(text)) return true;
    if (/^(review|article|research article|original article)\s+.+\.\s+[A-Z]/i.test(text)) return true;
    if (text.length > 90 && /[.!?]\s+[A-Z][a-z]/.test(text)) return true;
    if (/^\d+$/.test(text) || /^[\d\s,.;:()[\]-]+$/.test(text)) return true;
    if (text.length < 18 && text.split(/\s+/).length < 4) return true;
    if (/\b(19|20)\d{2}\b/.test(text) && text.split(/\s+/).length <= 4) return true;
    if (/^[a-z0-9._-]{8,}$/i.test(text) && !/\s/.test(text)) return true;
    return lower === 'pdf' || lower === 'untitled';
  }

  private mergePdfReidentifiedMetadata(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent
  ): Partial<PdfWikiSourcePdf> {
    const inferred = this.cleanSourceMetadata({
      ...this.inferSourceMetadata(pdf.originalName, parsed.text),
      ...this.removeEmptyMetadata(parsed.metadata || {}),
    });
    const current = this.cleanSourceMetadata(pdf);
    return this.cleanSourceMetadata({
      title: this.isWeakPdfTitleCandidate(current.title, pdf.originalName)
        ? inferred.title || current.title
        : current.title,
      authors: this.isWeakPdfMetadataValue(current.authors) ? inferred.authors : current.authors,
      year: this.isWeakPdfMetadataValue(current.year) ? inferred.year : current.year,
      journal: this.isWeakPdfMetadataValue(current.journal) ? inferred.journal : current.journal,
      doi: this.isWeakPdfMetadataValue(current.doi) ? inferred.doi : current.doi,
    });
  }

  private resolvePdfVisualExtractorScript(): string {
    const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
    const candidates: string[] = [
      process.env.PDF_WIKI_VISUAL_EXTRACTOR,
      process.env.PPT_PDF_VISUAL_EXTRACTOR,
      resourcesPath ? path.join(resourcesPath, 'scripts', 'extract-pdf-visuals.py') : '',
      path.join(process.cwd(), 'scripts', 'extract-pdf-visuals.py'),
      path.resolve(__dirname, '..', '..', 'scripts', 'extract-pdf-visuals.py'),
      path.resolve(__dirname, '..', '..', '..', 'scripts', 'extract-pdf-visuals.py'),
    ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return '';
  }

  private getPythonCommandCandidates(): Array<{ command: string; argsPrefix: string[] }> {
    const configured = process.env.PYTHON || process.env.PYTHON_EXE;
    const candidates: Array<{ command: string; argsPrefix: string[] }> = [];
    if (configured) candidates.push({ command: configured, argsPrefix: [] });
    candidates.push(
      { command: 'python', argsPrefix: [] },
      { command: 'python3', argsPrefix: [] },
      { command: 'py', argsPrefix: ['-3'] },
    );
    return candidates;
  }

  private async findPythonCommandForPdfVisuals(): Promise<{ command: string; argsPrefix: string[] } | null> {
    for (const candidate of this.getPythonCommandCandidates()) {
      const result = await this.runSimpleProcess(candidate.command, [...candidate.argsPrefix, '--version'], process.cwd(), 8000);
      if (result.exitCode === 0) return candidate;
    }
    return null;
  }

  private async runSimpleProcess(
    command: string,
    args: string[],
    cwd: string,
    timeoutMs: number
  ): Promise<{ exitCode: number | null; stdout: string; stderr: string; timedOut: boolean }> {
    return await new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;
      const env = buildToolRuntimeEnv({
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      });
      const child = spawn(command, args, {
        cwd,
        windowsHide: true,
        env,
      });
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      child.stdout?.on('data', chunk => {
        stdout = `${stdout}${chunk.toString('utf8')}`.slice(-12000);
      });
      child.stderr?.on('data', chunk => {
        stderr = `${stderr}${chunk.toString('utf8')}`.slice(-12000);
      });
      child.on('error', error => {
        clearTimeout(timer);
        resolve({ exitCode: null, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut });
      });
      child.on('close', exitCode => {
        clearTimeout(timer);
        resolve({ exitCode, stdout, stderr, timedOut });
      });
    });
  }

  private async extractPdfFiguresForManager(
    userId: string,
    pdf: PdfWikiSourcePdf,
    options: { figureDirName?: string; workDirName?: string } = {}
  ): Promise<{ figureCount: number; sourceFigures: Record<string, unknown>[]; error?: string }> {
    const script = this.resolvePdfVisualExtractorScript();
    if (!script) {
      return { figureCount: 0, sourceFigures: [], error: '未找到本地图片提取脚本 extract-pdf-visuals.py' };
    }
    const python = await this.findPythonCommandForPdfVisuals();
    if (!python) {
      return { figureCount: 0, sourceFigures: [], error: '未检测到 Python，已跳过本地图片提取' };
    }

    const taskDir = this.getCodexPdfWikiTaskDir(userId, pdf);
    const figureDirName = this.normalizePdfWikiTaskSubdirName(options.figureDirName || 'figures', 'figures');
    const workDirName = this.normalizePdfWikiTaskSubdirName(options.workDirName || 'visual-reidentify', 'visual-reidentify');
    const workDir = path.join(taskDir, workDirName);
    const sourceDir = path.join(workDir, 'sources');
    const tempFigureDir = path.join(workDir, 'images', 'pdf-figures');
    const targetFigureDir = path.join(taskDir, figureDirName);

    await fs.promises.rm(workDir, { recursive: true, force: true });
    await fs.promises.mkdir(sourceDir, { recursive: true });
    await fs.promises.mkdir(targetFigureDir, { recursive: true });
    await this.linkOrCopyFile(pdf.filePath, path.join(sourceDir, this.sanitizeFileName(pdf.originalName || pdf.fileName || 'source.pdf')));

    const maxAssets = Math.max(1, Math.min(200, Number(process.env.PDF_WIKI_REIDENTIFY_MAX_FIGURES || 80) || 80));
    const run = await this.runSimpleProcess(python.command, [...python.argsPrefix, script, workDir, '--max-assets', String(maxAssets)], process.cwd(), 180000);
    if (run.exitCode !== 0) {
      await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
      return {
        figureCount: 0,
        sourceFigures: [],
        error: run.timedOut
          ? '图片提取超时，已跳过'
          : `图片提取失败：${(run.stderr || run.stdout || `exit ${run.exitCode}`).slice(0, 300)}`,
      };
    }

    const manifestPath = path.join(tempFigureDir, 'manifest.json');
    const manifest = this.asRecord(await this.readJsonFileIfExists(manifestPath));
    const items = Array.isArray(manifest.items) ? manifest.items.map(item => this.asRecord(item)) : [];
    await fs.promises.rm(targetFigureDir, { recursive: true, force: true });
    await fs.promises.mkdir(targetFigureDir, { recursive: true });

    const sourceFigures: Record<string, unknown>[] = [];
    const seenContentHashes = new Set<string>();
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (this.isNonScientificFigureRecord(item, this.firstString(item.filename))) continue;
      const contentHash = this.firstString(item.contentHash, item.content_hash).toLowerCase();
      if (contentHash && seenContentHashes.has(contentHash)) continue;
      if (contentHash) seenContentHashes.add(contentHash);
      const sourcePath = this.firstString(item.absolutePath)
        || (this.firstString(item.filename) ? path.join(tempFigureDir, this.firstString(item.filename)) : '');
      if (!sourcePath || !fs.existsSync(sourcePath)) continue;
      const ext = path.extname(sourcePath).toLowerCase() || '.png';
      const base = `figure_${String(sourceFigures.length + 1).padStart(3, '0')}`;
      const fileName = `${base}${ext}`;
      const targetPath = path.join(targetFigureDir, fileName);
      await fs.promises.copyFile(sourcePath, targetPath);
      const meta = {
        id: base,
        number: this.firstString(item.captionLabel) || `Figure ${sourceFigures.length + 1}`,
        title: this.firstString(item.captionTitle, item.description),
        caption: this.firstString(item.caption),
        page: this.firstString(item.page),
        file: `${figureDirName}/${fileName}`,
        name: fileName,
        source: this.firstString(item.source),
        confidence: this.firstString(item.confidence),
        width: Number(item.width || 0),
        height: Number(item.height || 0),
        rectX: Number(item.rectX || 0),
        rectY: Number(item.rectY || 0),
        rectWidth: Number(item.rectWidth || 0),
        rectHeight: Number(item.rectHeight || 0),
        pageAreaRatio: Number(item.pageAreaRatio || 0),
        contentHash: this.firstString(item.contentHash),
        needs_manual_review: this.firstString(item.confidence) === 'low',
        needs_digitization_with_getdata: true,
      };
      if (this.isNonScientificFigureRecord(meta, fileName)) {
        await fs.promises.unlink(targetPath).catch(() => undefined);
        continue;
      }
      await fs.promises.writeFile(path.join(targetFigureDir, `${base}.json`), JSON.stringify(meta, null, 2), 'utf-8');
      sourceFigures.push(meta);
    }

    await fs.promises.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    return { figureCount: sourceFigures.length, sourceFigures };
  }

  private async persistOverviewDiagramAsFirstFigure(
    userId: string,
    pdf: PdfWikiSourcePdf,
    overviewDiagram: PdfWikiOverviewDiagram
  ): Promise<Record<string, unknown> | null> {
    const svg = this.sanitizeOverviewSvg(overviewDiagram.svg);
    if (!svg) return null;

    const now = new Date().toISOString();
    const taskDir = this.getCodexPdfWikiTaskDir(userId, pdf);
    const figureDir = path.join(taskDir, 'figures');
    await fs.promises.mkdir(figureDir, { recursive: true });

    const fileName = '000_overview_diagram.svg';
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const filePath = path.join(figureDir, fileName);
    const metaPath = path.join(figureDir, `${baseName}.json`);
    await fs.promises.writeFile(filePath, svg, 'utf-8');

    const meta: Record<string, unknown> = {
      id: 'overview_diagram',
      number: '论文一览图',
      label: '论文一览图',
      title: overviewDiagram.title || pdf.title || pdf.originalName || '论文一览图',
      caption: '深入分析生成的论文结构与研究逻辑一览图。',
      page: '',
      file: `figures/${fileName}`,
      name: fileName,
      source: `deep-analysis-${overviewDiagram.engine || 'code'}`,
      confidence: 'high',
      needs_manual_review: false,
      needs_digitization_with_getdata: false,
      is_overview_diagram: true,
      generated_at: overviewDiagram.generatedAt || now,
    };
    await fs.promises.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');

    const rawMeta = this.asRecord(pdf.metaData);
    const existingFigures = this.firstArray(rawMeta.source_figures)
      .map(item => this.asRecord(item))
      .filter(item => {
        const id = this.firstString(item.id);
        const name = this.firstString(item.name, item.file);
        return id !== 'overview_diagram'
          && !/000_overview_diagram\.svg$/i.test(name)
          && item.is_overview_diagram !== true;
      });
    pdf.metaData = {
      ...rawMeta,
      source_figures: existingFigures,
    };
    pdf.metaDataCachedAt = now;
    return meta;
  }

  private getCodexPdfWikiAuxTaskDir(userId: string, taskName: string): string {
    return path.join(this.getWikiDir(userId), 'codex-aux', taskName.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120) || 'task');
  }

  private formatMetaAnalysisTemplateForPrompt(template: PdfWikiMetaAnalysisTemplate | null): string {
    if (!template) return '未上传模板。';
    const sheetSummary = (template.sheets || []).slice(0, 4).map(sheet => {
      const preview = sheet.previewRows.length > 0
        ? `\n示例行：${JSON.stringify(sheet.previewRows.slice(0, 3))}`
        : '';
      return `- Sheet "${sheet.name}"：表头第 ${sheet.headerRowIndex || 1} 行，共 ${sheet.columns.length} 个字段：${sheet.columns.join('、')}${preview}`;
    }).join('\n');
    return [
      `模板文件：${template.filename}`,
      `主 Sheet：${template.sheetName || template.sheets?.[0]?.name || '第一个工作表'}`,
      `主表头字段：${template.columns.join('、')}`,
      sheetSummary ? `工作表结构：\n${sheetSummary}` : '',
    ].filter(Boolean).join('\n');
  }

  private formatMetaAnalysisUnitRegistryForPrompt(userId: string): string {
    const registry = this.loadMetaAnalysisUnitRegistry(userId);
    const entries = Object.values(registry.columns || {})
      .filter(entry => entry && entry.base && entry.unit)
      .sort((a, b) => a.base.localeCompare(b.base, 'zh-CN'))
      .slice(0, 80);
    if (entries.length === 0) {
      return '暂无已注册单位；遇到有单位变量时，把单位写入表头，单元格只写数值。';
    }
    const displayColumns = [...PDF_WIKI_META_ANALYSIS_COLUMNS];
    return entries.map(entry => {
      const displayBase = this.mapMetaAnalysisColumnName(entry.base, displayColumns) || entry.base;
      return `- ${displayBase}: ${entry.unit}`;
    }).join('\n');
  }

  private makeCodexPdfWikiPrompt(userId: string, pdf: PdfWikiSourcePdf, paperId: string, llmConfig?: PdfWikiLlmConfig): string {
    const metaTemplate = this.loadMetaAnalysisTemplate(userId);
    const metaAnalysisColumns = this.getActiveMetaAnalysisColumns(userId);
    const unitRegistryInstruction = this.formatMetaAnalysisUnitRegistryForPrompt(userId);
    const metaUserRequirements = this.firstString(llmConfig?.metaAnalysisUserRequirements).slice(0, 4000);
    const includeMetaAnalysisRows = !llmConfig || (this.shouldGenerateMetaAnalysis(llmConfig) && this.getMetaAnalysisEngine(llmConfig) !== 'api');
    const metaTemplateInstruction = metaTemplate
      ? `用户已上传 Meta 数据库 Excel/CSV 模板：${metaTemplate.filename}。当前任务目录已写入 meta_analysis_template.json，请先读取该文件，把它作为数据提取的目标表结构。meta_analysis_rows 必须严格按模板表头抽取；不要擅自改名、合并或删除字段。`
      : '用户未上传 Meta 数据库模板。请使用下面的默认 Meta 分析字段抽取。';
    const metaAnalysisInstruction = includeMetaAnalysisRows
      ? `- meta_analysis_rows 是用于 Meta 分析数据库的核心表格，一行代表一个独立观测值/处理组/季节作物组合；如果论文没有足够信息生成逐观测行，返回空数组，不要编造。
- ${metaTemplateInstruction}
- 用户模板结构如下：
${this.formatMetaAnalysisTemplateForPrompt(metaTemplate)}
- 用户本次 Meta 提取要求：${metaUserRequirements || '未填写额外要求，按模板和默认 Meta 分析规则提取。'}
- 已注册的统一单位如下；同一变量在所有 PDF 中必须换算到这里的单位。没有列出的新变量，第一次确定单位后也要把单位写进表头，后续同名变量沿用同一表头：
${unitRegistryInstruction}
- meta_analysis_rows 的每个对象优先使用这些字段作为 key，并尽量按这个顺序输出：${metaAnalysisColumns.join('、')}。
- 所有有单位的变量必须把单位写在字段名/表头中，例如 "N input (kg N ha-1)"、"N2O_Tmean (kg N ha-1)"；单元格只写纯数据，不要写单位、解释、来源或 "10 kg/ha" 这类值。不同 PDF 中同一变量必须统一成同一个表头单位；如果原文单位不同，先换算数值再填。
- 如果原文给出范围值，例如 "10-20"、"10 to 20"、"10–20 kg ha-1"，应取上下限均值后再填入；若有单位，先求均值再换算到统一单位。
- 如果原文或表格单元格是 "mean ± SD/SE"、"7.32 ± 0.38 d"、"mean ± standard error" 等格式，必须拆列：均值/指标列只填 7.32 这类纯均值，± 后的误差单独填入对应 SD/SE/标准差/标准误列，显著性字母单独填入显著性列或 note；绝对不要把 "7.32 ± 0.38 d" 整串放进均值列。
- 如果原文说明 ± 后是 SE/SEM，但用户模板只有 SD/标准差列，且能确定样本量 n/重复数，则按 SD = SE × sqrt(n) 换算后填入 SD 列；如果原文说明是 SD 而模板只有 SE 列，则按 SE = SD / sqrt(n) 换算。无法确定 n 时不要编造换算值，并在 note/evidence 中说明。
- 你必须在 Codex 提取阶段直接按模板填表，不要只写一段 meta 分析总结。逐列查找并填入用户模板字段，输出一行或多行结构化观测记录。
- 提取来源优先级：1) 正文表格和补充表格；2) 图和图注/坐标轴/图中数据标签（能可靠读取才填）；3) Results/结果部分文字；4) Materials and Methods/材料与方法中的地点、处理、作物、试验设计、采样周期、重复数、施肥/灌溉、土壤基础性质和测定方法；5) Abstract 仅用于补充确切出现的信息。
- 对每个模板字段都要尝试在 Tables/Figures/Results/Materials and Methods 中寻找对应信息；没有就留空字符串或 null，不要把多个指标塞进一个字段。
- 如果一个 PDF 包含多个处理、作物季节、实验年份、地点或独立观测值，应拆成多行；不要把多个处理合并成一个单元格。
- 如果模板存在示例行，按示例行的行粒度和字段含义组织新行，但不要照抄示例数据。
- 如果 PDF 中出现模板外但对 Meta 分析有用的新指标，可以额外添加新 key；模板字段必须保留。
- NO 和 N2O 的重复统计字段必须区分：NO_SD、NO_n、NO_减氮、NO_CKmean、NO_CKsd、NO_CKn、NO_Tmean、NO_Tsd、NO_Tn；N2O_SD、N2O_n、N2O_减氮、N2O_CKmean、N2O_CKsd、N2O_CKn、N2O_Tmean、N2O_Tsd、N2O_Tn。
- meta_analysis_rows 中每个数值必须来自正文、表格、图或补充材料原文；无法确定的字段留空字符串或 null，不要用常识推断。最好额外包含 evidence/source_text/page/note 说明来源。`
      : `- 本次上传未要求 Codex 生成 Meta 分析逐观测数据表；meta_analysis_rows 必须返回空数组。
- meta_data.json 仍需保留基础元信息、study_locations、crop_types、treatment_categories、experimental_design、soil_physicochemical_biological_indicators、observations、source_tables、source_figures、extraction_notes。`;
    const tableMetaInstruction = includeMetaAnalysisRows
      ? '- 必须尝试整理出 tables/meta_analysis_table.csv 和 tables/meta_analysis_table.json；表头优先使用用户 Excel 模板字段。即使没有可填数据，也要输出带模板表头的空表或空数组，并在 extraction_report.md 说明原因。'
      : '- 本次不生成 Meta 分析数据表；不要生成 tables/meta_analysis_table.csv 或 tables/meta_analysis_table.json。';
    const figureMetaInstruction = includeMetaAnalysisRows
      ? '- 尽可能提取图片标题、图注、所在页码、图片编号；如果图中包含模板所需数值，记录到 meta_analysis_rows，并在 evidence/source_text/page/note 中说明来自哪张图。'
      : '- 尽可能提取图片标题、图注、所在页码、图片编号；不需要把图片数值整理到 meta_analysis_rows。';
    return `你是一个严谨的科学文献 PDF 数据提取代理。当前目录是单篇 PDF 的输出目录。

源 PDF：
- 当前目录文件：source.pdf
- 原始文件名：${pdf.originalName}
- paper_id：${paperId}

你需要直接处理 source.pdf。不要等待用户确认。可以在当前目录创建临时脚本或中间文件来读取 PDF、提取图片、表格、OCR 或解析内容，但最终必须生成下面规定的结果文件。

执行顺序（必须遵守）：
1. 先用可用本地工具快速生成 raw_plain.txt/raw_layout.txt；如果某个工具不可用，记录原因并继续。
2. 一旦获得正文文本，立即按顺序落盘 fulltext.md、fulltext.json、meta_data.json、pdf_wiki_claims.json、extraction_report.md 的可用版本；不要等图片、表格、OCR 或补充材料全部完成后才写这些主结果文件。
3. 主结果文件写完后，再补充 tables/ 和 figures/ 的 CSV/JSON/图片文件；补充完成后可以更新主 JSON 和 extraction_report.md。
4. 某个图片、表格、OCR、补充材料或外部资源无法可靠提取时，标记 needs_manual_check=true 并继续，不要反复重试超过 1 次。
5. 最终回复前必须确认 5 个主结果文件都存在，且 fulltext.json、meta_data.json、pdf_wiki_claims.json 可以被 JSON.parse 解析。

必须生成的最终文件：
1. fulltext.md
2. fulltext.json
3. meta_data.json
4. extraction_report.md
5. pdf_wiki_claims.json

必须生成的目录：
1. tables/
2. figures/

fulltext.md 要求：
- 按 PDF 真实章节完整输出正文，不要只提摘要。
- 保留章节层级，例如 Title、Authors、Abstract、Keywords、Introduction、Materials and Methods、Results、Discussion、Conclusion、References、Supplementary Materials。
- 如果章节是推断出来的，在标题旁标注 [inferred]。
- 包含表格和图片的引用位置、标题、图注或表注。

fulltext.json 要求：
- JSON only，不要 Markdown 代码块。
- 至少包含 metadata、sections、pages、tables、figures、references。
- sections 中保留 heading、level、pages、text、inferred_section。
- tables 和 figures 中保留编号、页码、标题/图注、输出文件路径、是否需要人工检查。
- references 中尽量保留参考文献原文、作者、年份、标题、期刊、DOI。

meta_data.json 要求：
- JSON only。
- 至少包含 schema_version、paper_id、title、authors、year、journal、doi、study_locations、crop_types、treatment_categories、experimental_design、soil_physicochemical_biological_indicators、meta_analysis_rows、observations、source_tables、source_figures、extraction_notes、needs_codex_or_manual_review。
- soil_physicochemical_biological_indicators 只提取试验地土壤的物理、化学、生物指标，例如 pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、含水量/WFPS、微生物量、酶活性、微生物群落等；论文中有就填，没有就留空数组或 null，不要推断。
${metaAnalysisInstruction}
- 所有无法确定的字段使用 null 或空数组，不要编造。
- 所有推断字段必须在 extraction_notes 中说明。

tables/ 要求：
- 提取 PDF 中所有表格。
- 每个表格保存为 CSV 和 JSON，例如 tables/table_001.csv 和 tables/table_001.json。
- 保留表格标题、表注、页码、列名、行名、单位。
${tableMetaInstruction}
- 不要把跨页表格拆散；如果无法可靠合并，标记 split_table=true。

figures/ 要求：
- 提取 PDF 中所有图片，保存为 PNG 或原始可用格式。
- 每张图片生成 JSON 描述文件，例如 figures/figure_001.json。
- 自动跳过出版社 logo、期刊封面、封面页截图、装饰插图、占位图、无坐标轴/无数值/无表格内容的非科学图；这些不要写入 source_figures，只在 extraction_notes 中说明已过滤。
- 如果图中的曲线、柱状图、散点图、误差棒或坐标轴不能可靠读出精确数值，不要编造；在 figure JSON 和 meta_data.json 的 source_figures 中标记 needs_digitization_with_getdata=true、needs_manual_review=true，并提示用户用 GetData Graph Digitizer/WebPlotDigitizer 校准坐标轴后导入。
${figureMetaInstruction}

pdf_wiki_claims.json 要求：
- JSON only，不要 Markdown 代码块。
- 只从 PDF 原文中抽取用于论文写作检索的论点，不要编造。
- 优先覆盖 Introduction/Background 和 Discussion/讨论，其次补充 Abstract、Results、Conclusion。
- Introduction/Background 中的研究假设、科学争议、研究空白、机制解释、前人研究观点都要抽取；不要因为它们不是作者结果就跳过。
- Discussion/讨论中每一个独立讨论点都要梳理，尤其是机制解释、与前人研究一致/不一致、限制条件、反向证据和作者解释。
- 如果 PDF 作者把某个观点作为自己的假设、结果、发现、结论或讨论判断提出，放入 proViews。
- 如果 PDF 中明确提出反向结果、限制条件、争议观点或冲突证据，放入 conViews。
- 如果观点来自前人研究、背景机制或不能直接代表本文结果，放入 neutralViews，并保留文中引用。
- 每个 evidence 和 inTextCitations 尽量保留原文短摘录和文中引用，如 "(Smith et al., 2020)"、"Smith et al. (2020)"、"[12]" 或 "(12)"。
- claim 和 summary 用中文表述；evidence 尽量保留 PDF 原文短摘录。
- 如果章节存在，Introduction/Background 和 Discussion/讨论各至少抽取 10 个候选论点；全文最多输出 100 个高质量论点。

pdf_wiki_claims.json 格式：
{
  "claims": [
    {
      "claim": "",
      "section": "",
      "location": "",
      "discussionPoint": "",
      "proViews": [
        {"summary": "", "evidence": "", "inTextCitations": []}
      ],
      "conViews": [
        {"summary": "", "evidence": "", "inTextCitations": []}
      ],
      "neutralViews": [
        {"summary": "", "evidence": "", "inTextCitations": []}
      ],
      "evidence": "",
      "inTextCitations": [],
      "referenceIndexes": []
    }
  ]
}

最终检查：
- fulltext.json、meta_data.json、pdf_wiki_claims.json 必须是合法 JSON。
- 所有输出路径使用相对路径。
- 不要把任务说明原文当作论文内容。
- 不要删除源 PDF。`;
  }

  private makeCodexMetaAnalysisPrompt(userId: string, pdf: PdfWikiSourcePdf, paperId: string, llmConfig?: PdfWikiLlmConfig): string {
    const metaTemplate = this.loadMetaAnalysisTemplate(userId);
    const metaAnalysisColumns = this.getActiveMetaAnalysisColumns(userId);
    const unitRegistryInstruction = this.formatMetaAnalysisUnitRegistryForPrompt(userId);
    const metaUserRequirements = this.firstString(llmConfig?.metaAnalysisUserRequirements).slice(0, 4000);
    const templateInstruction = metaTemplate
      ? `用户已上传 Meta 数据库 Excel/CSV 模板。当前任务目录有 meta_analysis_template.json，必须先读取它，并严格按模板表头抽取 meta_analysis_rows。`
      : `用户未上传模板，请使用默认字段抽取：${metaAnalysisColumns.join('、')}。`;

    return `你是一个严谨的科学文献 Meta 分析数据提取代理。当前目录是单篇 PDF 的输出目录。

源 PDF：
- 当前目录文件：source.pdf
- 原始文件名：${pdf.originalName}
- paper_id：${paperId}

本任务只做 Meta 分析数据提取，不生成句子级Wiki论点库，不做引言/讨论/结论逐句切分，不做正反观点合并。

执行顺序：
1. 直接读取 source.pdf，优先提取可复制文本、版式文本、表格、图注和图片。
2. 先落盘 raw_plain.txt 或 raw_layout.txt；随后必须生成 fulltext.md、fulltext.json、meta_data.json、extraction_report.md。
3. 表格保存到 tables/，图片及图片描述保存到 figures/。
4. 无法可靠提取的表格或图片，记录 needs_manual_check=true 并继续，不要编造。

必须生成：
- fulltext.md：按 PDF 真实章节输出正文，并保留表格/图片标题、图注、页码线索。
- fulltext.json：JSON only，至少包含 metadata、sections、pages、tables、figures、references。
- meta_data.json：JSON only，至少包含 schema_version、paper_id、title、authors、year、journal、doi、study_locations、crop_types、treatment_categories、experimental_design、soil_physicochemical_biological_indicators、meta_analysis_rows、observations、source_tables、source_figures、extraction_notes、needs_codex_or_manual_review。
- extraction_report.md：说明提取了哪些表、哪些图、哪些字段为空、哪些需要人工核查。
- tables/meta_analysis_table.csv 和 tables/meta_analysis_table.json：按模板字段整理的 Meta 分析编码表；没有可填数据也要输出空表头并说明原因。

Meta 分析编码表要求：
- ${templateInstruction}
- 模板结构如下：
${this.formatMetaAnalysisTemplateForPrompt(metaTemplate)}
- 用户本次 Meta 提取要求：${metaUserRequirements || '未填写额外要求，按模板和默认 Meta 分析规则提取。'}
- 已注册的统一单位如下；同一变量在所有 PDF 中必须换算到这里的单位。没有列出的新变量，第一次确定单位后也要把单位写进表头，后续同名变量沿用同一表头：
${unitRegistryInstruction}
- 每一行代表一个独立观测值/处理组/季节作物组合；不要把多个处理、年份、地点或作物季节塞进一个单元格。
- meta_analysis_rows 的每个对象优先使用这些字段作为 key，并尽量按这个顺序输出：${metaAnalysisColumns.join('、')}。
- 所有有单位的变量必须把单位写在字段名/表头中，例如 "N input (kg N ha-1)"、"N2O_Tmean (kg N ha-1)"；单元格只写纯数据，不要写单位、解释、来源或 "10 kg/ha" 这类值。不同 PDF 中同一变量必须统一成同一个表头单位；如果原文单位不同，先换算数值再填。
- 如果原文给出范围值，例如 "10-20"、"10 to 20"、"10–20 kg ha-1"，应取上下限均值后再填入；若有单位，先求均值再换算到统一单位。
- 如果原文或表格单元格是 "mean ± SD/SE"、"7.32 ± 0.38 d"、"mean ± standard error" 等格式，必须拆列：均值/指标列只填 7.32 这类纯均值，± 后的误差单独填入对应 SD/SE/标准差/标准误列，显著性字母单独填入显著性列或 note；绝对不要把 "7.32 ± 0.38 d" 整串放进均值列。
- 如果原文说明 ± 后是 SE/SEM，但用户模板只有 SD/标准差列，且能确定样本量 n/重复数，则按 SD = SE × sqrt(n) 换算后填入 SD 列；如果原文说明是 SD 而模板只有 SE 列，则按 SE = SD / sqrt(n) 换算。无法确定 n 时不要编造换算值，并在 note/evidence 中说明。
- 提取来源优先级：1) 正文表格和补充表格；2) 图和图注/坐标轴/图中数据标签（能可靠读数才填）；3) Results/结果部分文字；4) Materials and Methods/材料与方法；5) Abstract 仅补充确切出现的信息。
- 数值、单位、处理名称、重复数、经纬度、土壤性质、显著性、均值/SD/SE/n 必须来自原文、表格、图或补充材料；没有就留空字符串或 null。
- 对每行最好额外包含 evidence、source_text、page、note，说明数据来自哪张表、哪幅图、哪段文字或哪一页。
- NO 和 N2O 的重复统计字段必须区分：NO_SD、NO_n、NO_减氮、NO_CKmean、NO_CKsd、NO_CKn、NO_Tmean、NO_Tsd、NO_Tn；N2O_SD、N2O_n、N2O_减氮、N2O_CKmean、N2O_CKsd、N2O_CKn、N2O_Tmean、N2O_Tsd、N2O_Tn。
- 不要把任务说明当作论文内容，不要用常识推断缺失值。

图表要求：
- tables/ 中尽可能保存 PDF 的每张表，CSV 和 JSON 各一份，例如 tables/table_001.csv、tables/table_001.json；保留表题、表注、页码、列名、行名、单位。
- figures/ 中尽可能保存图片或图片截图，并为每张图生成 JSON 描述，例如 figures/figure_001.json；保留图号、页码、标题、图注、坐标轴、图例和是否人工核查。
- 自动跳过出版社 logo、期刊封面、封面页截图、装饰插图、占位图、无坐标轴/无数值/无表格内容的非科学图；这些不要写入 source_figures，只在 extraction_notes 中说明已过滤。
- 图中柱状图/折线图/散点图的数值只有在坐标轴、数据标签或图注足以可靠读数时才写入 meta_analysis_rows；否则只写 source_figures 和 extraction_notes。
- 如果图中数值不能可靠读出，在 figure JSON 和 meta_data.json 的 source_figures 中标记 needs_digitization_with_getdata=true、needs_manual_review=true，并提示用户用 GetData Graph Digitizer/WebPlotDigitizer 校准坐标轴后导入。

最终检查：
- fulltext.json 和 meta_data.json 必须能被 JSON.parse 直接解析。
- meta_data.json 必须包含 meta_analysis_rows，即使是空数组。
- 所有路径使用相对路径。
- 不要删除 source.pdf。`;
  }

  private async readTextFileIfExists(filePath: string): Promise<string> {
    if (!fs.existsSync(filePath)) return '';
    return fs.promises.readFile(filePath, 'utf-8');
  }

  private async readJsonFileIfExists(filePath: string): Promise<unknown | null> {
    if (!fs.existsSync(filePath)) return null;
    try {
      const text = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(text) as unknown;
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to parse JSON file ${filePath}:`, error);
      return null;
    }
  }

  private codexFulltextJsonToText(value: unknown): string {
    if (!value || typeof value !== 'object') return '';
    const record = value as Record<string, unknown>;
    const direct = this.firstString(record.text, record.fulltext, record.full_text, record.markdown, record.content);
    if (direct) return direct;

    const sections = Array.isArray(record.sections) ? record.sections : [];
    const sectionText = sections.map((section): string => {
      if (typeof section === 'string') return section;
      if (!section || typeof section !== 'object') return '';
      const sectionRecord = section as Record<string, unknown>;
      const heading = this.firstString(sectionRecord.heading, sectionRecord.title, sectionRecord.section);
      const text = this.firstString(sectionRecord.text, sectionRecord.content, sectionRecord.markdown);
      return [heading ? `## ${heading}` : '', text].filter(Boolean).join('\n\n');
    }).filter(Boolean).join('\n\n');
    if (sectionText) return sectionText;

    const pages = Array.isArray(record.pages) ? record.pages : [];
    return pages.map((page): string => {
      if (typeof page === 'string') return page;
      if (!page || typeof page !== 'object') return '';
      const pageRecord = page as Record<string, unknown>;
      return this.firstString(pageRecord.text, pageRecord.content, pageRecord.markdown);
    }).filter(Boolean).join('\n\n');
  }

  private extractCodexMetadata(
    fulltextJson: unknown,
    metaDataJson: unknown,
    pdf: PdfWikiSourcePdf,
    text: string
  ): Partial<PdfWikiSourcePdf> {
    const fulltextRecord = this.asRecord(fulltextJson);
    const metaRecord = this.asRecord(metaDataJson);
    const fulltextMetadata = this.asRecord(fulltextRecord.metadata);
    const metadata = this.cleanSourceMetadata({
      ...this.inferSourceMetadata(pdf.originalName, text),
      title: this.firstString(metaRecord.title, metaRecord.paper_title, fulltextMetadata.title, fulltextRecord.title),
      authors: this.formatCodexAuthors(metaRecord.authors || metaRecord.author || fulltextMetadata.authors || fulltextMetadata.author),
      year: this.firstString(metaRecord.year, metaRecord.publication_year, fulltextMetadata.year, fulltextRecord.year),
      journal: this.firstString(metaRecord.journal, metaRecord.source, fulltextMetadata.journal, fulltextRecord.journal),
      doi: this.firstString(metaRecord.doi, fulltextMetadata.doi, fulltextRecord.doi),
    });
    return metadata;
  }

  private async extractMetaAnalysisDataWithApi(
    userId: string,
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent,
    llmConfig: PdfWikiLlmConfig
  ): Promise<Record<string, unknown>> {
    if (!this.shouldGenerateMetaAnalysis(llmConfig) || this.getMetaAnalysisEngine(llmConfig) !== 'api') {
      return this.asRecord(parsed.metaData);
    }
    if (!llmConfig.apiUrl || !llmConfig.apiKey) {
      return {
        extraction_notes: ['用户选择使用 API 提取 Meta 分析数据表，但当前 PDF Wiki API 未配置，已留空。'],
        needs_codex_or_manual_review: true,
        meta_analysis_rows: [],
      };
    }

    const metaTemplate = this.loadMetaAnalysisTemplate(userId);
    const metaAnalysisColumns = this.getActiveMetaAnalysisColumns(userId);
    const unitRegistryInstruction = this.formatMetaAnalysisUnitRegistryForPrompt(userId);
    const metaUserRequirements = this.firstString(llmConfig.metaAnalysisUserRequirements).slice(0, 4000);
    const textLimit = Math.max(20000, Math.min(120000, Number(process.env.PDF_WIKI_META_API_MAX_INPUT_CHARS || 70000)));
    const text = parsed.text.length > textLimit
      ? `${parsed.text.slice(0, textLimit)}\n\n[正文过长，以上为前 ${textLimit} 字符。请只基于已给出的文本抽取，不要推断未出现信息。]`
      : parsed.text;
    const templateSummary = metaTemplate
      ? JSON.stringify({
          filename: metaTemplate.filename,
          columns: metaTemplate.columns,
          sampleRows: metaTemplate.sheets?.flatMap(sheet => sheet.previewRows || []).slice(0, 3) || [],
        }, null, 2)
      : JSON.stringify({ columns: metaAnalysisColumns }, null, 2);

    const prompt = `你是严谨的 Meta 分析数据表抽取助手。请只基于 PDF 正文内容，把材料与方法、结果、表格、图注和补充材料中出现的可核查数据抽取成结构化 JSON。

PDF：${pdf.originalName}

目标表结构：
${templateSummary}

用户本次 Meta 提取要求：
${metaUserRequirements || '未填写额外要求，按模板和默认 Meta 分析规则提取。'}

统一单位表：
${unitRegistryInstruction}

要求：
1. 重点生成 meta_analysis_rows；一行代表一个独立观测值/处理组/季节作物组合。
2. 必须优先使用这些字段作为 key，并尽量按顺序输出：${metaAnalysisColumns.join('、')}。
3. 所有有单位的变量必须把单位写在字段名/表头中，例如 "N input (kg N ha-1)"、"N2O_Tmean (kg N ha-1)"；单元格只写纯数据，不要写单位、解释、来源或 "10 kg/ha" 这类值。不同 PDF 中同一变量必须统一成同一个表头单位；如果原文单位不同，先按统一单位表换算数值再填。
4. 如果原文给出范围值，例如 "10-20"、"10 to 20"、"10–20 kg ha-1"，应取上下限均值后再填入；若有单位，先求均值再换算到统一单位。
5. 如果原文或表格单元格是 "mean ± SD/SE"、"7.32 ± 0.38 d"、"mean ± standard error" 等格式，必须拆列：均值/指标列只填 7.32 这类纯均值，± 后的误差单独填入对应 SD/SE/标准差/标准误列，显著性字母单独填入显著性列或 note；绝对不要把 "7.32 ± 0.38 d" 整串放进均值列。
6. 如果原文说明 ± 后是 SE/SEM，但用户模板只有 SD/标准差列，且能确定样本量 n/重复数，则按 SD = SE × sqrt(n) 换算后填入 SD 列；如果原文说明是 SD 而模板只有 SE 列，则按 SE = SD / sqrt(n) 换算。无法确定 n 时不要编造换算值，并在 note/evidence 中说明。
7. 每个字段都要尝试从 Materials and Methods、Results、Tables、Figures、Supplementary Materials 中查找；没有就留空字符串或 null。
8. 不要把多个指标塞进一个字段；如果 PDF 有多个处理、作物、年份、地点或独立观测值，应拆成多行。
9. 数值、单位、处理名称、重复数、经纬度、土壤物化生指标、显著性等必须来自原文；不要用常识推断。
10. 最好给每行添加 evidence/source_text/page/note，说明原文来源。
11. 只返回 JSON，不要 Markdown。

返回格式：
{
  "schema_version": "1.0",
  "paper_id": "${this.getSafePdfCacheId(pdf)}",
  "title": "",
  "authors": "",
  "year": "",
  "journal": "",
  "doi": "",
  "study_locations": [],
  "crop_types": [],
  "treatment_categories": [],
  "experimental_design": "",
  "soil_physicochemical_biological_indicators": [],
  "meta_analysis_rows": [],
  "observations": [],
  "source_tables": [],
  "source_figures": [],
  "extraction_notes": [],
  "needs_codex_or_manual_review": false
}

PDF 正文：
${text}`;

    try {
      return await this.callJsonNormalizer(llmConfig, prompt, this.getMetaAnalysisJsonMaxOutputTokens(llmConfig), 'meta-analysis api extraction');
    } catch (error) {
      logger.warn(`[PdfWiki] API meta-analysis extraction failed for ${pdf.originalName}:`, error);
      return {
        extraction_notes: [`API Meta 分析数据表提取失败：${(error as Error).message}`],
        needs_codex_or_manual_review: true,
        meta_analysis_rows: [],
      };
    }
  }

  private async extractMetaAnalysisFigureEvidenceWithVision(
    userId: string,
    pdf: PdfWikiSourcePdf,
    llmConfig: PdfWikiLlmConfig
  ): Promise<Record<string, unknown> | null> {
    const maxFigures = Math.max(0, Math.min(12, Number(process.env.PDF_WIKI_META_VISION_MAX_FIGURES || 4) || 4));
    if (maxFigures <= 0 || !llmConfig.apiUrl || !llmConfig.apiKey) return null;

    const figureResult = await this.extractPdfFiguresForManager(userId, pdf, {
      figureDirName: 'meta-figures',
      workDirName: 'visual-meta-analysis',
    });
    if (!figureResult.sourceFigures.length) {
      return figureResult.error
        ? {
            source_figures: [],
            extraction_notes: [`本地图片提取未产生可 OCR 图件：${figureResult.error}`],
          }
        : null;
    }

    const taskDir = this.getCodexPdfWikiTaskDir(userId, pdf);
    const sourceFigures: Record<string, unknown>[] = [];
    const sourceTables: Record<string, unknown>[] = [];
    const metaRows: Record<string, unknown>[] = [];
    const notes: string[] = [];
    const unitRegistryInstruction = this.formatMetaAnalysisUnitRegistryForPrompt(userId);
    const metaUserRequirements = this.firstString(llmConfig.metaAnalysisUserRequirements).slice(0, 4000);

    for (const figure of figureResult.sourceFigures.slice(0, maxFigures)) {
      const record = this.asRecord(figure);
      const relativeFile = this.firstString(record.file, record.path, record.name);
      const absolutePath = relativeFile
        ? path.join(taskDir, relativeFile.replace(/[\\/]+/g, path.sep))
        : '';
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        sourceFigures.push(record);
        continue;
      }

      const prompt = `你是严谨的 Meta 分析图表 OCR 助手。请只基于这张 PDF 中提取出的图片/表格截图，识别图号、标题、图注、坐标轴、图例、表格文字、数值标签、单位和是否适合数字化。

PDF：${pdf.originalName}
图件信息：${JSON.stringify(record).slice(0, 3000)}

统一单位表：
${unitRegistryInstruction}

用户本次 Meta 提取要求：
${metaUserRequirements || '未填写额外要求，按模板和默认 Meta 分析规则提取。'}

要求：
1. 优先做 OCR 和表格文字识别；不要凭常识补数值。
2. 如果图片是表格截图，尽量输出 source_tables，并保留列名、行名、单位和可读数值。
3. 如果图片是柱状图/折线图/散点图，只有坐标轴、图例、数据标签足够清楚时，才生成 meta_analysis_rows；有单位的字段必须把单位写到表头，单元格只填纯数据，若原图单位不同则先换算到统一单位表；不确定时只标记 needs_manual_review 和 needs_digitization_with_getdata。
4. 如果图上或图注给出范围值，例如 "10-20"、"10 to 20"、"10–20 kg ha-1"，应取上下限均值后再填入；若有单位，先求均值再换算到统一单位。
5. 如果图表文字是 "mean ± SD/SE"、"7.32 ± 0.38 d"、"mean ± standard error" 等格式，必须拆列：均值/指标列只填纯均值，± 后误差单独填入对应 SD/SE/标准差/标准误列，显著性字母单独填入显著性列或 note；不要把整串放进均值列。
6. 如果图注/表注说明 ± 后是 SE/SEM，但目标表头是 SD/标准差，且可确定样本量 n/重复数，则按 SD = SE × sqrt(n) 换算；反向则按 SE = SD / sqrt(n) 换算。无法确定 n 时不要编造换算值。
7. 如果图片是出版社 logo、期刊封面、封面页截图、装饰插图、占位图，或没有坐标轴、数值、图例、表格内容的非科学图，返回空 source_figures/meta_analysis_rows，只在 extraction_notes 中说明已过滤。
8. 每个可疑科学图件都要返回 source_figures，说明是否需要图像数字化复核。
9. 只返回 JSON 对象，不要 Markdown。

返回格式：
{
  "source_figures": [
    {
      "id": "",
      "label": "",
      "title": "",
      "caption": "",
      "page": "",
      "file": "",
      "ocr_text": "",
      "axis_labels": [],
      "legend": [],
      "units": [],
      "needs_manual_review": true,
      "needs_digitization_with_getdata": true,
      "note": ""
    }
  ],
  "source_tables": [],
  "meta_analysis_rows": [],
  "extraction_notes": []
}`;

      const parsed = await this.callVisionJsonWithFallback(llmConfig, absolutePath, prompt, 5000, `meta-analysis vision ${pdf.originalName}`);
      const figures = this.firstArray(parsed.source_figures, parsed.sourceFigures, parsed.figures);
      const filteredFigures = this.filterScientificSourceFigures(figures);
      const tables = this.firstArray(parsed.source_tables, parsed.sourceTables, parsed.tables);
      const rows = this.firstArray(parsed.meta_analysis_rows, parsed.metaAnalysisRows, parsed.rows);
      const extractedNotes = this.toDisplayStringArray(parsed.extraction_notes || parsed.extractionNotes);

      if (filteredFigures.length > 0) {
        sourceFigures.push(...filteredFigures.map(item => ({
          ...record,
          ...this.asRecord(item),
          file: this.firstString(this.asRecord(item).file, record.file, relativeFile),
          name: this.firstString(this.asRecord(item).name, record.name),
        })));
      } else if (figures.length === 0 && !this.isNonScientificFigureRecord(this.asRecord(parsed), this.firstString(record.name, record.file))) {
        sourceFigures.push({
          ...record,
          needs_manual_review: true,
          needs_digitization_with_getdata: true,
          note: '千问视觉 OCR 未返回结构化图件描述，保留本地图片提取结果。',
        });
      }
      sourceTables.push(...tables.map(item => this.asRecord(item)));
      metaRows.push(...rows.map(item => this.asRecord(item)));
      notes.push(...extractedNotes);
    }

    return {
      source_figures: this.filterScientificSourceFigures(sourceFigures),
      source_tables: sourceTables,
      meta_analysis_rows: metaRows,
      extraction_notes: [
        ...notes,
        `已使用千问视觉链路处理 PDF 图件：OCR=${llmConfig.ocrModel || 'qwen-vl-ocr'}，视觉兜底=${llmConfig.visionModel || 'qwen-vl-max'}；最多处理 ${maxFigures} 张。`,
      ],
      needs_codex_or_manual_review: sourceFigures.some(item => this.toBoolean(this.asRecord(item).needs_manual_review ?? this.asRecord(item).needsManualReview)),
    };
  }

  private async callVisionJsonWithFallback(
    llmConfig: PdfWikiLlmConfig,
    imagePath: string,
    prompt: string,
    maxTokens: number,
    contextLabel: string
  ): Promise<Record<string, unknown>> {
    const ocrModel = String(llmConfig.ocrModel || 'qwen-vl-ocr').trim();
    const visionModel = String(llmConfig.visionModel || 'qwen-vl-max').trim();
    try {
      return await this.callVisionJson(llmConfig, imagePath, prompt, maxTokens, ocrModel, `${contextLabel} ocr`);
    } catch (error) {
      logger.warn(`[PdfWiki] ${contextLabel} OCR model ${ocrModel} failed, falling back to ${visionModel}:`, error);
      return this.callVisionJson(llmConfig, imagePath, prompt, maxTokens, visionModel, `${contextLabel} vision-fallback`);
    }
  }

  private async callVisionJson(
    llmConfig: PdfWikiLlmConfig,
    imagePath: string,
    prompt: string,
    maxTokens: number,
    model: string,
    contextLabel: string
  ): Promise<Record<string, unknown>> {
    const imageDataUrl = await this.readImageAsDataUrl(imagePath);
    const content = await this.callChatCompletionWithMessages({
      ...llmConfig,
      model,
      jsonApiUrl: undefined,
      jsonApiKey: undefined,
      jsonModel: undefined,
    }, [
      {
        role: 'system',
        content: '你是严格的学术图表 OCR 与 Meta 分析数据提取助手，只输出 JSON 对象。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ], maxTokens, true);
    const parsed = this.parseJsonContent(content);
    if (parsed) return parsed;
    const repairPrompt = `下面的视觉模型输出本应是 JSON 对象。请修复为合法 JSON，不要新增图中没有的信息。\n\n原始内容：\n${content.slice(0, 12000)}`;
    return this.callJsonNormalizer(llmConfig, repairPrompt, Math.min(maxTokens, 3000), `${contextLabel} repair`);
  }

  private async readImageAsDataUrl(imagePath: string): Promise<string> {
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : (ext === '.webp' ? 'image/webp' : (ext === '.gif' ? 'image/gif' : 'image/png'));
    const buffer = await fs.promises.readFile(imagePath);
    return `data:${mime};base64,${buffer.toString('base64')}`;
  }

  private buildPdfMetaDataRecord(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent | null,
    references: PdfWikiReference[] = [],
    rawMetaData: unknown = {}
  ): Record<string, unknown> {
    const raw = this.asRecord(rawMetaData);
    const parsedMetadata = parsed?.metadata || {};
    const metadata = this.cleanSourceMetadata({
      ...this.inferSourceMetadata(pdf.originalName, parsed?.text || ''),
      ...this.removeEmptyMetadata(parsedMetadata),
      title: pdf.title || parsedMetadata.title,
      authors: pdf.authors || parsedMetadata.authors,
      year: pdf.year || parsedMetadata.year,
      journal: pdf.journal || parsedMetadata.journal,
      doi: pdf.doi || parsedMetadata.doi,
    });

    const tableValues = this.firstArray(raw.source_tables, raw.sourceTables, raw.tables);
    const figureValues = this.filterScientificSourceFigures(this.firstArray(raw.source_figures, raw.sourceFigures, raw.figures));
    const output: Record<string, unknown> = { ...raw };

    const resolvedTitle = this.resolvePaperTitle(
      pdf.originalName,
      raw.title,
      raw.paper_title,
      raw.paperTitle,
      raw.article_title,
      raw.articleTitle,
      metadata.title,
      pdf.title,
      parsedMetadata.title
    );

    output.schema_version = this.firstString(raw.schema_version, raw.schemaVersion) || '1.0';
    output.paper_id = this.firstString(raw.paper_id, raw.paperId, raw.id) || this.getSafePdfCacheId(pdf);
    output.title = resolvedTitle || null;
    output.authors = metadata.authors || this.formatCodexAuthors(raw.authors || raw.author) || null;
    output.year = metadata.year || this.firstString(raw.year, raw.publication_year) || null;
    output.journal = metadata.journal || this.firstString(raw.journal, raw.source) || null;
    output.doi = metadata.doi || this.normalizeDoi(this.firstString(raw.doi)) || null;
    output.study_locations = this.firstArray(raw.study_locations, raw.studyLocations);
    output.crop_types = this.firstArray(raw.crop_types, raw.cropTypes);
    output.treatment_categories = this.firstArray(raw.treatment_categories, raw.treatmentCategories);
    output.experimental_design = raw.experimental_design ?? raw.experimentalDesign ?? null;
    output.soil_physicochemical_biological_indicators =
      raw.soil_physicochemical_biological_indicators
      ?? raw.soilPhysicochemicalBiologicalIndicators
      ?? raw.soil_indicators
      ?? raw.soilIndicators
      ?? raw.soil_properties
      ?? raw.soilProperties
      ?? null;
    output.observations = this.firstArray(raw.observations, raw.key_observations, raw.keyObservations);
    output.meta_analysis_rows = this.firstArray(
      raw.meta_analysis_rows,
      raw.metaAnalysisRows,
      raw.meta_analysis_table,
      raw.metaAnalysisTable,
      raw.observation_rows,
      raw.observationRows,
      raw.obs_rows,
      raw.obsRows
    );
    output.source_tables = tableValues;
    output.source_figures = figureValues;
    output.extraction_notes = raw.extraction_notes ?? raw.extractionNotes ?? [];
    output.needs_codex_or_manual_review = this.toBoolean(raw.needs_codex_or_manual_review ?? raw.needsCodexOrManualReview) || false;
    output.extraction_parser = parsed?.parser || pdf.extractionParser || null;
    output.source_pdf_id = pdf.id;
    output.source_pdf_name = pdf.originalName;
    output.source_pdf_file = pdf.fileName;
    output.text_length = parsed?.text?.length || pdf.textLength || 0;
    output.reference_count = references.length || parsed?.references?.length || pdf.referenceIndex?.length || 0;
    output.processed_at = pdf.processedAt || null;

    return this.removeUndefinedValues(output);
  }

  private buildMetaDatabaseSearchText(input: {
    title: string;
    authors: string;
    year: string;
    journal: string;
    doi: string;
    originalName: string;
    parser: string;
    studyLocations: string[];
    cropTypes: string[];
    treatmentCategories: string[];
    sourceTables: unknown[];
    sourceFigures: unknown[];
    metaData: Record<string, unknown>;
  }): string {
    return [
      input.title,
      input.authors,
      input.year,
      input.journal,
      input.doi,
      input.originalName,
      input.parser,
      input.studyLocations.join(' '),
      input.cropTypes.join(' '),
      input.treatmentCategories.join(' '),
      this.stringifyMetaValue(input.metaData.experimental_design),
      this.stringifyMetaValue(input.metaData.soil_physicochemical_biological_indicators),
      this.stringifyMetaValue(input.metaData.observations),
      this.stringifyMetaValue(input.metaData.extraction_notes),
      this.stringifyMetaValue(input.sourceTables),
      this.stringifyMetaValue(input.sourceFigures),
    ].filter(Boolean).join(' ').toLowerCase();
  }

  private async buildMetaDatabaseItem(
    userId: string,
    pdf: PdfWikiSourcePdf,
    options: { includeDetails?: boolean } = {}
  ): Promise<PdfWikiMetaDatabaseItem | null> {
    const cached = await this.loadParsedMetaCache(userId, pdf);
    const codexMeta = this.asRecord(await this.readJsonFileIfExists(path.join(this.getCodexPdfWikiTaskDir(userId, pdf), 'meta_data.json')));
    const cachedMeta = this.asRecord(cached?.metaData);
    const baseMeta = this.asRecord(pdf.metaData);
    const parser = pdf.extractionParser || cached?.parser || this.firstString(baseMeta.extraction_parser, cachedMeta.extraction_parser, codexMeta.extraction_parser);
    const references = pdf.referenceIndex || [];
    const metaData = this.buildPdfMetaDataRecord(
      { ...pdf, extractionParser: parser as PdfWikiSourcePdf['extractionParser'] },
      null,
      references,
      this.mergeStoredPdfMetaData(codexMeta, cachedMeta, baseMeta)
    );
    if (!this.shouldIncludePdfInMetaDatabase(pdf, metaData)) {
      return null;
    }
    if (!this.isMetaAnalysisDataEnabled(metaData)) {
      return null;
    }

    const title = this.firstString(metaData.title, pdf.title) || pdf.originalName;
    const displayOriginalName = this.restoreOriginalName(pdf.originalName || pdf.fileName || '');
    const authors = this.firstString(metaData.authors, pdf.authors);
    const year = this.firstString(metaData.year, pdf.year);
    const journal = this.firstString(metaData.journal, pdf.journal);
    const doi = this.normalizeDoi(this.firstString(metaData.doi, pdf.doi));
    const studyLocations = this.toDisplayStringArray(metaData.study_locations);
    const cropTypes = this.toDisplayStringArray(metaData.crop_types);
    const treatmentCategories = this.toDisplayStringArray(metaData.treatment_categories);
    const sourceTables = this.firstArray(metaData.source_tables);
    const sourceFigures = this.firstArray(metaData.source_figures);
    const includeDetails = options.includeDetails !== false;
    const searchText = this.buildMetaDatabaseSearchText({
      title,
      authors,
      year,
      journal,
      doi,
      originalName: displayOriginalName || pdf.originalName,
      parser: String(parser || ''),
      studyLocations,
      cropTypes,
      treatmentCategories,
      sourceTables,
      sourceFigures,
      metaData,
    });
    const metaAnalysisColumns = this.getActiveMetaAnalysisColumns(userId);
    const explicitRowCount = this.extractExplicitMetaAnalysisRows(metaData).length;
    const summaryRowCount = explicitRowCount > 0 ? explicitRowCount : (this.isMetaAnalysisRowsUserEdited(metaData) ? 0 : 1);
    const isPlaceholderTable = explicitRowCount === 0 && !this.isMetaAnalysisRowsUserEdited(metaData);

    if (!includeDetails) {
      const summaryColumns = this.standardizeMetaAnalysisTableUnits(userId, [
        ...metaAnalysisColumns,
        ...PDF_WIKI_META_ANALYSIS_TRACE_COLUMNS,
      ], []).columns;
      return {
        pdfId: pdf.id,
        originalName: displayOriginalName || pdf.originalName,
        fileName: pdf.fileName,
        title,
        authors,
        year,
        journal,
        doi,
        parser: String(parser || ''),
        textLength: Number(metaData.text_length || pdf.textLength || cached?.textLength || 0),
        referenceCount: Number(metaData.reference_count || references.length || cached?.referenceCount || 0),
        processedAt: pdf.processedAt || '',
        parsedTextCachedAt: pdf.parsedTextCachedAt || cached?.cachedAt || '',
        metaDataCachedAt: pdf.metaDataCachedAt || cached?.cachedAt || '',
        studyLocations,
        cropTypes,
        treatmentCategories,
        sourceTableCount: sourceTables.length,
        sourceFigureCount: sourceFigures.length,
        needsReview: Boolean(this.toBoolean(metaData.needs_codex_or_manual_review)),
        extractionNotes: this.stringifyMetaValue(metaData.extraction_notes),
        tables: [],
        dataTable: {
          id: `pdf_data_table_${pdf.id}`,
          pdfId: pdf.id,
          pdfName: displayOriginalName || pdf.originalName,
          pdfTitle: title,
          columns: summaryColumns,
          rows: [],
          rowCount: isPlaceholderTable ? 0 : summaryRowCount,
          realRowCount: explicitRowCount,
          isPlaceholder: isPlaceholderTable,
        },
        metaData: {},
        searchText,
        detailLoaded: false,
      };
    }

    const tables = await this.getPdfMetaTables(userId, pdf, metaData);
    const dataTable = await this.buildPdfIntegratedDataTable(userId, pdf, metaData);

    return {
      pdfId: pdf.id,
      originalName: displayOriginalName || pdf.originalName,
      fileName: pdf.fileName,
      title,
      authors,
      year,
      journal,
      doi,
      parser: String(parser || ''),
      textLength: Number(metaData.text_length || pdf.textLength || cached?.textLength || 0),
      referenceCount: Number(metaData.reference_count || references.length || cached?.referenceCount || 0),
      processedAt: pdf.processedAt || '',
      parsedTextCachedAt: pdf.parsedTextCachedAt || cached?.cachedAt || '',
      metaDataCachedAt: pdf.metaDataCachedAt || cached?.cachedAt || '',
      studyLocations,
      cropTypes,
      treatmentCategories,
      sourceTableCount: tables.length || sourceTables.length,
      sourceFigureCount: sourceFigures.length,
      needsReview: Boolean(this.toBoolean(metaData.needs_codex_or_manual_review)),
      extractionNotes: this.stringifyMetaValue(metaData.extraction_notes),
      tables: tables.map(table => this.toPublicMetaTableItem(table)),
      dataTable,
      metaData,
      searchText,
      detailLoaded: true,
    };
  }

  private async buildPdfIntegratedDataTable(
    userId: string,
    pdf: PdfWikiSourcePdf,
    metaData: Record<string, unknown>
  ): Promise<PdfWikiIntegratedDataTable> {
    const displayOriginalName = this.restoreOriginalName(pdf.originalName || pdf.fileName || '');
    if (!this.isMetaAnalysisDataEnabled(metaData)) {
      return {
        id: `pdf_data_table_${pdf.id}`,
        pdfId: pdf.id,
        pdfName: displayOriginalName || pdf.originalName,
        pdfTitle: this.firstString(metaData.title, pdf.title) || displayOriginalName || pdf.originalName,
        columns: [],
        rows: [],
        rowCount: 0,
      };
    }

    const metaAnalysisColumns = this.getActiveMetaAnalysisColumns(userId);
    const pdfTitle = this.firstString(metaData.title, pdf.title) || displayOriginalName || pdf.originalName;
    const studyTitle = this.resolvePaperTitle(
      displayOriginalName || pdf.originalName,
      metaData.paper_title,
      metaData.paperTitle,
      metaData.article_title,
      metaData.articleTitle,
      metaData.title,
      pdf.title
    );
    const studyLabel = studyTitle || '论文题目未解析';
    const traceBase: Record<string, unknown> = {
      'Study#': studyLabel,
      PDF标题: studyLabel,
      PDF文件名: displayOriginalName || pdf.originalName,
    };
    const rows: Array<Record<string, unknown>> = [];
    let isPlaceholder = false;
    const addMetaAnalysisRow = (row: Record<string, unknown>, trace: Record<string, unknown> = {}): void => {
      const normalized: Record<string, unknown> = {
        ...this.createEmptyMetaAnalysisRow(metaAnalysisColumns),
        ...traceBase,
        数据来源: 'PDF元信息',
        来源名称: '',
        '页码/位置': '',
        证据原文: '',
        ...this.normalizeMetaAnalysisRow(row, metaAnalysisColumns),
        ...trace,
      };
      normalized['Study#'] = studyLabel;
      rows.push(normalized);
    };

    const explicitRows = this.extractExplicitMetaAnalysisRows(metaData);
    explicitRows.forEach((row, index) => {
      addMetaAnalysisRow(row, {
        数据来源: 'meta_analysis_rows',
        来源名称: 'meta_data',
        '页码/位置': this.firstString(row.page, row.pages, row.location),
        证据原文: this.firstMetaValueString(row.evidence, row.evidence_text, row.source_text, row.original_text, row.note),
        'Obs#': index + 1,
      });
    });

    if (rows.length === 0 && !this.isMetaAnalysisRowsUserEdited(metaData)) {
      isPlaceholder = true;
      addMetaAnalysisRow(this.buildMetaAnalysisSummaryFallback(metaData, metaAnalysisColumns), {
        'Obs#': 1,
        数据来源: 'PDF元信息',
        来源名称: 'meta_data_summary',
        证据原文: '未提取到逐观测值 meta_analysis_rows；此行仅展示 PDF 中可确定的基础信息，缺失字段留空。',
      });
    }

    const traceColumns = PDF_WIKI_META_ANALYSIS_TRACE_COLUMNS;
    const dynamicColumns = Array.from(new Set(rows.flatMap(row => Object.keys(row))))
      .filter(column => !metaAnalysisColumns.includes(column) && !(traceColumns as readonly string[]).includes(column));

    const standardized = this.standardizeMetaAnalysisTableUnits(userId, [
      ...metaAnalysisColumns,
      ...dynamicColumns,
      ...traceColumns,
    ], rows);

    return {
      id: `pdf_data_table_${pdf.id}`,
      pdfId: pdf.id,
      pdfName: displayOriginalName || pdf.originalName,
      pdfTitle,
      columns: standardized.columns,
      rows: standardized.rows,
      rowCount: isPlaceholder ? 0 : standardized.rows.length,
      realRowCount: isPlaceholder ? 0 : standardized.rows.length,
      isPlaceholder,
    };
  }

  private standardizeMetaAnalysisTableUnits(
    userId: string,
    columns: string[],
    rows: Array<Record<string, unknown>>
  ): { columns: string[]; rows: Array<Record<string, unknown>> } {
    this.ensureMetaAnalysisUnitRegistryFromColumns(userId, columns, 'extracted');
    const outputColumns: string[] = [];
    const columnMap = new Map<string, string>();
    const columnTargets = new Map<string, { family: string; canonical: string; factorToCanonical: number }>();

    for (const column of columns) {
      const target = this.resolveMetaAnalysisColumnUnitTarget(userId, column, rows);
      const parsed = this.parseMetaAnalysisColumnUnit(column);
      const nextColumn = target
        ? this.buildMetaAnalysisColumnWithUnit(parsed.base, target.canonical)
        : this.buildMetaAnalysisColumnWithUnit(parsed.base || column, parsed.unit);
      columnMap.set(column, nextColumn);
      if (target) columnTargets.set(column, target);
      if (!outputColumns.includes(nextColumn)) outputColumns.push(nextColumn);
    }
    this.ensureMetaAnalysisUnitRegistryFromColumns(userId, outputColumns, 'extracted');

    const outputRows = rows.map(row => {
      const next: Record<string, unknown> = {};
      for (const column of columns) {
        const nextColumn = columnMap.get(column) || column;
        const target = columnTargets.get(column);
        const value = target
          ? this.moveMetaAnalysisUnitFromCellToHeader(row[column], target)
          : this.averageMetaAnalysisRangeCellIfLikelyNumeric(row[column], column);
        if (this.isMeaningfulMetaValue(value) || !this.isMeaningfulMetaValue(next[nextColumn])) {
          next[nextColumn] = value;
        }
      }
      return next;
    });

    return {
      columns: outputColumns,
      rows: outputRows,
    };
  }

  private resolveMetaAnalysisRegisteredUnitTarget(
    userId: string,
    column: string
  ): { family: string; canonical: string; factorToCanonical: number } | null {
    const parsed = this.parseMetaAnalysisColumnUnit(column);
    const base = parsed.base || this.stringifyTableCellValue(column);
    if (!base || this.isUnitlessMetaAnalysisColumn(base)) return null;
    const registry = this.loadMetaAnalysisUnitRegistry(userId);
    const keys = [
      this.normalizeMetaAnalysisColumnKey(base),
      this.normalizeMetaAnalysisColumnKey(column),
    ].filter(Boolean);
    for (const key of keys) {
      const entry = registry.columns[key];
      if (!entry?.unit) continue;
      const normalizedUnit = this.normalizeMetaAnalysisUnit(entry.unit);
      const unitInfo = this.classifyMetaAnalysisUnit(normalizedUnit);
      return unitInfo || { family: `literal:${normalizedUnit.toLowerCase()}`, canonical: normalizedUnit, factorToCanonical: 1 };
    }
    return null;
  }

  private resolveMetaAnalysisColumnUnitTarget(
    userId: string,
    column: string,
    rows: Array<Record<string, unknown>>
  ): { family: string; canonical: string; factorToCanonical: number } | null {
    if (this.isUnitlessMetaAnalysisColumn(column)) return null;
    const parsedColumn = this.parseMetaAnalysisColumnUnit(column);
    const registryTarget = this.resolveMetaAnalysisRegisteredUnitTarget(userId, parsedColumn.base || column);
    if (parsedColumn.unit) {
      const headerInfo = this.classifyMetaAnalysisUnit(parsedColumn.unit);
      if (registryTarget && headerInfo && this.unitsAreCompatible(headerInfo, registryTarget)) return registryTarget;
      if (registryTarget && !headerInfo) return registryTarget;
      return headerInfo || { family: `literal:${parsedColumn.unit.toLowerCase()}`, canonical: parsedColumn.unit, factorToCanonical: 1 };
    }
    if (registryTarget) return registryTarget;

    const cellInfos = rows
      .map(row => this.parseMetaAnalysisNumericCellWithUnit(row[column])?.unitInfo || this.parseMetaAnalysisNumericRangeCell(row[column])?.unitInfo || null)
      .filter((info): info is { family: string; canonical: string; factorToCanonical: number } => !!info);
    if (cellInfos.length === 0) return null;
    const first = cellInfos[0];
    return cellInfos.every(info => this.unitsAreCompatible(info, first)) ? first : null;
  }

  private moveMetaAnalysisUnitFromCellToHeader(
    value: unknown,
    target: { family: string; canonical: string; factorToCanonical: number }
  ): unknown {
    const range = this.parseMetaAnalysisNumericRangeCell(value);
    if (range) {
      if (range.unitInfo && !this.unitsAreCompatible(range.unitInfo, target)) return value;
      const converted = range.unitInfo
        ? range.mean * range.unitInfo.factorToCanonical / target.factorToCanonical
        : range.mean;
      return `${range.prefix}${this.formatDigitizationNumber(converted)}`;
    }
    const parsed = this.parseMetaAnalysisNumericCellWithUnit(value);
    if (!parsed) return value;
    if (!this.unitsAreCompatible(parsed.unitInfo, target)) return value;
    const converted = parsed.number * parsed.unitInfo.factorToCanonical / target.factorToCanonical;
    return `${parsed.prefix}${this.formatDigitizationNumber(converted)}`;
  }

  private averageMetaAnalysisRangeCellIfLikelyNumeric(value: unknown, column: string): unknown {
    if (!this.isLikelyNumericMetaAnalysisColumn(column)) return value;
    const range = this.parseMetaAnalysisNumericRangeCell(value);
    if (!range || range.unitInfo || range.unit) return value;
    return `${range.prefix}${this.formatDigitizationNumber(range.mean)}`;
  }

  private isLikelyNumericMetaAnalysisColumn(column: string): boolean {
    const normalized = this.normalizeMetaAnalysisColumnKey(column);
    if (!normalized || this.isUnitlessMetaAnalysisColumn(column)) return false;
    return /(?:mean|sd|se|sem|tn|ckn|n$|rate|input|yield|emission|flux|cum|period|duration|day|year|lat|latitude|lon|longitude|ph|soc|som|tn|tc|toc|no3|nh4|n2o|no|wfps|whc|moisture|temperature|precipitation|irrigation|density|sand|silt|clay|height|depth|area|volume|biomass|carbon|nitrogen|phosphorus|potassium|ratio|百分比|均值|标准差|样本量|重复|投入|产量|排放|通量|累计|持续|天数|年份|经度|纬度|温度|降水|灌溉|容重|含水|水分|有机|全氮|硝态氮|铵态氮|土壤|比例|浓度)/i.test(normalized);
  }

  private parseMetaAnalysisNumericRangeCell(value: unknown): {
    prefix: string;
    start: number;
    end: number;
    mean: number;
    unit: string;
    unitInfo?: { family: string; canonical: string; factorToCanonical: number };
  } | null {
    const text = this.stringifyTableCellValue(value).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const numeric = '([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:e[+-]?\\d+)?)';
    const rangePattern = new RegExp(`^([<>≤≥~≈]?\\s*)${numeric}\\s*(?:-|–|—|~|至|到|to)\\s*${numeric}\\s*([^;；,，]*)$`, 'i');
    const match = text.match(rangePattern);
    if (!match) return null;
    const start = Number(match[2]);
    const end = Number(match[3]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
    const rawUnit = String(match[4] || '')
      .replace(/\s*(?:\([^)]*\)|（[^）]*）)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const unit = this.normalizeMetaAnalysisUnit(rawUnit);
    const unitInfo = unit ? this.classifyMetaAnalysisUnit(unit) || undefined : undefined;
    return {
      prefix: match[1] || '',
      start,
      end,
      mean: (start + end) / 2,
      unit,
      unitInfo,
    };
  }

  private parseMetaAnalysisNumericCellWithUnit(value: unknown): {
    prefix: string;
    number: number;
    unit: string;
    unitInfo: { family: string; canonical: string; factorToCanonical: number };
  } | null {
    const text = this.stringifyTableCellValue(value).replace(/\s+/g, ' ').trim();
    if (!text) return null;
    const match = text.match(/^([<>≤≥~≈]?\s*)([+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?)\s*(%|[A-Za-zµμ°℃][^;；,，]*)/i);
    if (!match) return null;
    const number = Number(match[2]);
    if (!Number.isFinite(number)) return null;
    const unitText = String(match[3] || '')
      .replace(/\s*(?:\([^)]*\)|（[^）]*）)\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const unit = this.normalizeMetaAnalysisUnit(unitText);
    const unitInfo = this.classifyMetaAnalysisUnit(unit);
    if (!unitInfo) return null;
    return {
      prefix: match[1] || '',
      number,
      unit,
      unitInfo,
    };
  }

  private async parseDigitizationExportFile(fileName: string, buffer: Buffer): Promise<{ columns: string[]; rows: Array<Record<string, unknown>> }> {
    const xlsx = await import('xlsx');
    const ext = path.extname(fileName || '').toLowerCase();
    const workbook = xlsx.read(buffer, {
      type: 'buffer',
      raw: false,
      FS: ext === '.tsv' ? '\t' : undefined,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return { columns: [], rows: [] };

    const rawRows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
    const rows = rawRows
      .map(row => Array.isArray(row) ? row.map(cell => this.stringifyTableCellValue(cell)) : [])
      .filter(row => row.some(cell => cell.trim()));
    if (rows.length === 0) return { columns: [], rows: [] };

    const firstRow = rows[0] || [];
    const firstRowHasText = firstRow.some(cell => cell && !/^[+-]?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cell));
    const width = rows.reduce((max, row) => Math.max(max, row.length), firstRow.length || 2);
    const columns = firstRowHasText
      ? this.dedupeWideColumnNames(Array.from({ length: width }, (_, index) => firstRow[index] || `列${index + 1}`))
      : Array.from({ length: width }, (_, index) => index === 0 ? 'X' : (index === 1 ? 'Y' : `列${index + 1}`));
    const dataRows = firstRowHasText ? rows.slice(1) : rows;

    return {
      columns,
      rows: dataRows
        .map(row => {
          const record: Record<string, unknown> = {};
          columns.forEach((column, index) => {
            const value = row[index] || '';
            if (value) record[column] = value;
          });
          return record;
        })
        .filter(row => Object.keys(row).length > 0),
    };
  }

  private getDigitizationAggregationMode(parameters: Record<string, unknown>): string {
    const mode = this.firstString(parameters.aggregationMode, parameters.aggregation, parameters.aggregateMode);
    return [
      'meanByTreatmentSeriesX',
      'sumByTreatmentSeriesX',
      'sdByTreatmentSeriesX',
      'meanByTreatmentSeries',
      'sumByTreatmentSeries',
      'sdByTreatmentSeries',
      'meanAll',
      'sumAll',
      'sdAll',
    ].includes(mode) ? mode : 'none';
  }

  private getDigitizationAggregationStatistic(mode: string): 'mean' | 'sum' | 'sd' {
    if (mode.startsWith('sum')) return 'sum';
    if (mode.startsWith('sd')) return 'sd';
    return 'mean';
  }

  private isDigitizationAggregationAll(mode: string): boolean {
    return mode === 'meanAll' || mode === 'sumAll' || mode === 'sdAll';
  }

  private isDigitizationAggregationByX(mode: string): boolean {
    return mode === 'meanByTreatmentSeriesX' || mode === 'sumByTreatmentSeriesX' || mode === 'sdByTreatmentSeriesX';
  }

  private isParsedDigitizationAlreadyAggregated(parsed: { columns: string[]; rows: Array<Record<string, unknown>> }): boolean {
    if (!parsed.columns.some(column => this.normalizeMetaAnalysisColumnKey(column) === 'aggregation')) return false;
    return parsed.rows.some(row => {
      const label = this.firstString(row.Aggregation, row.aggregation, row['数据处理']).toLowerCase();
      return !!label && label !== 'raw' && label !== 'none';
    });
  }

  private parseDigitizationNumber(value: unknown): number {
    const text = this.stringifyTableCellValue(value).replace(/,/g, '').trim();
    if (!text) return Number.NaN;
    const num = Number(text);
    return Number.isFinite(num) ? num : Number.NaN;
  }

  private meanDigitizationNumbers(values: number[]): number {
    const nums = values.filter(value => Number.isFinite(value));
    if (nums.length === 0) return Number.NaN;
    return nums.reduce((sum, value) => sum + value, 0) / nums.length;
  }

  private sumDigitizationNumbers(values: number[]): number {
    const nums = values.filter(value => Number.isFinite(value));
    if (nums.length === 0) return Number.NaN;
    return nums.reduce((sum, value) => sum + value, 0);
  }

  private sdDigitizationNumbers(values: number[]): number {
    const nums = values.filter(value => Number.isFinite(value));
    if (nums.length <= 1) return Number.NaN;
    const mean = this.meanDigitizationNumbers(nums);
    const variance = nums.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (nums.length - 1);
    return Math.sqrt(variance);
  }

  private formatDigitizationNumber(value: number): string {
    if (!Number.isFinite(value)) return '';
    return Math.abs(value) >= 1000 || (Math.abs(value) > 0 && Math.abs(value) < 0.001)
      ? value.toExponential(6)
      : String(Math.round(value * 1000000) / 1000000);
  }

  private applyDigitizationAggregation(
    parsed: { columns: string[]; rows: Array<Record<string, unknown>> },
    parameters: Record<string, unknown>
  ): { columns: string[]; rows: Array<Record<string, unknown>> } {
    const mode = this.getDigitizationAggregationMode(parameters);
    if (mode === 'none' || this.isParsedDigitizationAlreadyAggregated(parsed)) return parsed;

    const columns = parsed.columns.length > 0 ? parsed.columns : Object.keys(parsed.rows[0] || {});
    const xColumn = columns.find(column => /^x$/i.test(column) || /横坐标|时间|time|date|day|dose|rate/i.test(column)) || columns[0] || 'X';
    const yColumn = columns.find(column => /^y$/i.test(column) || /纵坐标|value|mean|emission|flux|concentration|rate/i.test(column)) || columns[1] || 'Y';
    const seriesColumn = columns.find(column => /series|legend|图例|系列/i.test(column));
    const treatmentColumn = columns.find(column => /treatment|处理|组别|group/i.test(column));
    const controlColumn = columns.find(column => /control|对照|ck/i.test(column));
    const subfigureColumn = columns.find(column => /subfigure|panel|figure|子图|图件/i.test(column));
    const treatmentParam = this.firstString(parameters.treatment);
    const controlParam = this.firstString(parameters.control);
    const subfigureParam = this.firstString(parameters.subfigure);
    const seriesParam = this.firstString(parameters.seriesName);

    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const row of parsed.rows) {
      const y = this.parseDigitizationNumber(row[yColumn]);
      if (!Number.isFinite(y)) continue;
      const subfigure = this.firstString(subfigureColumn ? row[subfigureColumn] : '', subfigureParam);
      const treatment = this.firstString(treatmentColumn ? row[treatmentColumn] : '', treatmentParam);
      const control = this.firstString(controlColumn ? row[controlColumn] : '', controlParam);
      const series = this.firstString(seriesColumn ? row[seriesColumn] : '', seriesParam, treatment);
      const key = this.isDigitizationAggregationAll(mode)
        ? 'all'
        : [subfigure, treatment, control, series, this.isDigitizationAggregationByX(mode) ? this.stringifyTableCellValue(row[xColumn]) : ''].join('\u0001');
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }

    const statistic = this.getDigitizationAggregationStatistic(mode);
    if (groups.size === 0) return parsed;
    const rows = Array.from(groups.values()).map((group, index) => {
      const first = group[0] || {};
      const xValues = group.map(row => this.parseDigitizationNumber(row[xColumn]));
      const yValues = group.map(row => this.parseDigitizationNumber(row[yColumn]));
      const meanX = this.meanDigitizationNumbers(xValues);
      const meanY = this.meanDigitizationNumbers(yValues);
      const sumY = this.sumDigitizationNumbers(yValues);
      const sdY = this.sdDigitizationNumbers(yValues);
      const semY = Number.isFinite(sdY) ? sdY / Math.sqrt(group.length) : Number.NaN;
      const selectedY = statistic === 'sum' ? sumY : (statistic === 'sd' ? sdY : meanY);
      const subfigure = this.firstString(subfigureColumn ? first[subfigureColumn] : '', subfigureParam);
      const treatment = this.firstString(treatmentColumn ? first[treatmentColumn] : '', treatmentParam);
      const control = this.firstString(controlColumn ? first[controlColumn] : '', controlParam);
      const series = this.firstString(seriesColumn ? first[seriesColumn] : '', seriesParam, treatment, `Group ${index + 1}`);
      return this.removeUndefinedValues({
        X: this.formatDigitizationNumber(meanX),
        Y: this.formatDigitizationNumber(selectedY),
        Series: series,
        Treatment: treatment,
        Control: control,
        Subfigure: subfigure,
        N: group.length,
        Mean: this.formatDigitizationNumber(meanY),
        Sum: this.formatDigitizationNumber(sumY),
        SD: this.formatDigitizationNumber(sdY),
        SEM: this.formatDigitizationNumber(semY),
        Statistic: statistic,
        Aggregation: mode,
      });
    });

    return {
      columns: ['X', 'Y', 'Series', 'Treatment', 'Control', 'Subfigure', 'N', 'Mean', 'Sum', 'SD', 'SEM', 'Statistic', 'Aggregation'],
      rows,
    };
  }

  private buildDigitizedMetaAnalysisRow(input: {
    row: Record<string, unknown>;
    rowIndex: number;
    columns: string[];
    figureLabel: string;
    tool: string;
    fileName: string;
    notes?: string;
    parameters?: Record<string, unknown>;
    outcomeColumn?: string;
    outcomeRoleColumn?: string;
  }): Record<string, unknown> {
    const columns = input.columns.length > 0 ? input.columns : Object.keys(input.row);
    const xColumn = columns.find(column => /^x$/i.test(column) || /横坐标|时间|time|date|day|dose|rate/i.test(column)) || columns[0] || 'X';
    const yColumn = columns.find(column => /^y$/i.test(column) || /纵坐标|value|mean|emission|flux|concentration|rate/i.test(column)) || columns[1] || 'Y';
    const seriesColumn = columns.find(column => /series|group|treatment|legend|处理|图例|组别/i.test(column));
    const parameters = input.parameters || {};
    const rowTreatment = this.firstString(input.row.Treatment, input.row.treatment, input.row['处理'], input.row['图像数字化处理组']);
    const rowControl = this.firstString(input.row.Control, input.row.control, input.row['对照'], input.row['图像数字化对照组']);
    const treatment = this.firstString(rowTreatment, parameters.treatment, parameters.treatmentLabel, parameters.readRoleTreatment, parameters.roleTreatment);
    const control = this.firstString(rowControl, parameters.control, parameters.controlLabel, parameters.readRoleControl, parameters.roleControl);
    const outcome = this.firstString(parameters.outcome, parameters.outcomeLabel);
    const unit = this.firstString(parameters.unit);
    const canonicalUnit = this.normalizeMetaAnalysisUnit(unit);
    const readRole = this.firstString(parameters.readRole, parameters.valueRole);
    const xVariable = this.firstString(parameters.xVariable);
    const yVariable = this.firstString(parameters.yVariable);
    const subfigure = this.firstString(parameters.subfigure, input.row.Subfigure, input.row.subfigure, input.row['子图']);
    const seriesName = this.firstString(parameters.seriesName) || (seriesColumn ? this.stringifyTableCellValue(input.row[seriesColumn]) : '');
    const yValue = this.stringifyTableCellValue(input.row[yColumn]);
    const output: Record<string, unknown> = {
      ...input.row,
      '图像数字化X': this.stringifyTableCellValue(input.row[xColumn]),
      '图像数字化Y': yValue,
      '图像数字化系列': seriesName,
      '图像数字化工具': input.tool,
      '图像数字化文件': input.fileName,
      '图像数字化图件': input.figureLabel,
      '图像数字化子图': subfigure,
      '图像数字化行号': input.rowIndex + 1,
      '图像数字化指标': outcome,
      '图像数字化单位': unit,
      '图像数字化读数角色': readRole,
      '图像数字化处理组': treatment,
      '图像数字化对照组': control,
      '图像数字化X轴': xVariable,
      '图像数字化Y轴': yVariable,
      '处理': treatment || seriesName,
      source_figure: input.figureLabel,
      digitization_tool: input.tool,
      subfigure,
      digitization_parameters: JSON.stringify(parameters || {}),
      needs_manual_review: true,
      evidence: `Imported from ${input.tool} export for ${input.figureLabel}; values are digitized estimates and require manual review.`,
      source_text: `GetData digitized row ${input.rowIndex + 1} from ${input.figureLabel}`,
      note: input.notes || '图像数字化估算值，需人工复核；若论文表格或补充材料存在原始数值，应优先使用原始数值。',
    };
    const factorVariables = this.asRecord(parameters.factorVariables);
    for (const [column, value] of Object.entries(factorVariables)) {
      const targetColumn = this.firstString(column);
      const text = this.firstString(value);
      if (targetColumn && text && this.isDigitizationFactorColumnName(targetColumn)) {
        output[targetColumn] = text;
      }
    }
    const fallbackFactorMappings: Array<[unknown, string]> = [
      [parameters.cropType ?? parameters.crop ?? parameters.crop_type, '种植的作物'],
      [parameters.studyYear ?? parameters.year ?? parameters.experimentYear, '年份'],
    ];
    for (const [value, column] of fallbackFactorMappings) {
      const text = this.firstString(value);
      if (text && this.isDigitizationFactorColumnName(column)) output[column] = text;
    }
    const xValue = this.stringifyTableCellValue(input.row[xColumn]);
    if (xVariable && xValue && this.isDigitizationFactorColumnName(xVariable)) {
      output[xVariable] = xValue;
    }
    const outcomeColumn = this.normalizeDigitizationOutcomeColumn(input.outcomeColumn || outcome, canonicalUnit);
    if (outcomeColumn && yValue) {
      output[outcomeColumn] = yValue;
    }
    const outcomeRoleColumn = this.normalizeDigitizationOutcomeColumn(input.outcomeRoleColumn, canonicalUnit);
    if (outcomeRoleColumn && yValue) {
      output[outcomeRoleColumn] = yValue;
    }
    const prefix = this.getDigitizationOutcomePrefix(outcomeColumn || outcome);
    const normalizedRole = this.normalizeDigitizationReadRole(readRole);
    if (prefix && yValue) {
      if (/tmean|treatmentmean|处理均值|处理组均值/.test(normalizedRole)) output[this.buildMetaAnalysisColumnWithUnit(`${prefix}_Tmean`, canonicalUnit)] = yValue;
      else if (/tsd|treatmentsd|处理标准差|处理组标准差/.test(normalizedRole)) output[this.buildMetaAnalysisColumnWithUnit(`${prefix}_Tsd`, canonicalUnit)] = yValue;
      else if (/tn|treatmentn|处理样本量|处理组样本量/.test(normalizedRole)) output[`${prefix}_Tn`] = yValue;
      else if (/ckmean|controlmean|对照均值|对照组均值/.test(normalizedRole)) output[this.buildMetaAnalysisColumnWithUnit(`${prefix}_CKmean`, canonicalUnit)] = yValue;
      else if (/cksd|controlsd|对照标准差|对照组标准差/.test(normalizedRole)) output[this.buildMetaAnalysisColumnWithUnit(`${prefix}_CKsd`, canonicalUnit)] = yValue;
      else if (/ckn|controln|对照样本量|对照组样本量/.test(normalizedRole)) output[`${prefix}_CKn`] = yValue;
      else if (/cum|cumulative|累计|通量|排放量|总量/.test(normalizedRole)) output[this.buildMetaAnalysisColumnWithUnit(`Cum ${prefix}`, canonicalUnit)] = yValue;
    }
    return this.removeUndefinedValues(output);
  }

  private isDigitizationFactorColumnName(column: string): boolean {
    const label = this.firstString(column);
    if (!label) return false;
    const normalized = label.toLowerCase()
      .replace(/[（）]/g, match => match === '（' ? '(' : ')')
      .replace(/[_\s#:/\\()]+/g, '')
      .trim();
    if (!normalized || ['obs', 'study', 'pdf'].includes(normalized) || /图像数字化|digitization|source|evidence|doi|title|abstract/.test(normalized)) return false;
    if (/mean|sd|se|sem|variance|effect|yi|vi|weight|flux|emission|yield|rate|dose|ninput|nitrogeninput|period|duration|replicate|lat|long|latitude|longitude|temperature|precipitation|rain|irrigation|water|wfps|whc|texture|bulk|density|ph|som|soc|tc|tn|nh4|no3|cnratio|climate|fertilizationtimes|施氮量|氮投入|持续天数|重复数|纬度|经度|温度|降水|灌溉|纳水|土壤|质地|容重|有机质|有机碳|全碳|全氮|气候|施肥次数/.test(normalized)) return false;
    return /处理|treatment|group|组别|年份|year|作物|crop|season|季节|地点|location|site|品种|variety|cultivar|制度|system|rotation|轮作|管理|management/i.test(label);
  }

  private createEmptyMetaAnalysisRow(metaAnalysisColumns: string[]): Record<string, unknown> {
    return Object.fromEntries(metaAnalysisColumns.map(column => [column, '']));
  }

  private extractExplicitMetaAnalysisRows(metaData: Record<string, unknown>): Record<string, unknown>[] {
    const rows = this.firstArray(
      metaData.meta_analysis_rows,
      metaData.metaAnalysisRows,
      metaData.meta_analysis_table,
      metaData.metaAnalysisTable,
      metaData.observation_rows,
      metaData.observationRows,
      metaData.obs_rows,
      metaData.obsRows
    );
    return rows
      .map(row => this.asRecord(row))
      .filter(row => Object.keys(row).length > 0)
      .filter(row => !this.isAutoImportedDigitizationMetaRow(row));
  }

  private isAutoImportedDigitizationMetaRow(row: Record<string, unknown>): boolean {
    const keys = Object.keys(row);
    if (keys.length === 0) return false;
    const joinedKeys = keys.join(' ');
    const toolText = this.firstString(
      row.digitization_tool,
      row.digitizationTool,
      row['图像数字化工具'],
      row.tool,
      row.Tool
    );
    const fileText = this.firstString(
      row.digitization_file,
      row.digitizationFile,
      row['图像数字化文件'],
      row.fileName,
      row.filename,
      row.File
    );
    const noteText = this.firstString(
      row.note,
      row.notes,
      row.evidence,
      row.evidence_text,
      row.source_text,
      row.original_text,
      row['证据原文']
    );
    const sourceText = this.firstString(row['数据来源'], row.source, row.dataSource);
    const hasDigitizationKey = /图像数字化|digitization/i.test(joinedKeys);
    const hasRawDigitizerColumns = keys.some(key => /^(X|Y|Series|Mean|Sum|SD|SEM|Statistic|Aggregation)$/i.test(key));
    const hasDigitizerTool = /GetData\s*Graph\s*Digitizer|WebPlotDigitizer|internal-digitizer/i.test(`${toolText} ${fileText}`);
    const hasAutoImportNote = /Imported\s+from\s+GetData\s+Graph\s+Digitizer|values\s+are\s+digitized\s+estimates|图像数字化估算值|图像读数为估算值/i.test(noteText);
    const hasAutoTrace = /meta_analysis_rows/i.test(sourceText) && (hasDigitizerTool || hasAutoImportNote || hasDigitizationKey);
    return (hasDigitizerTool && (hasDigitizationKey || hasAutoImportNote || hasRawDigitizerColumns)) || hasAutoImportNote || hasAutoTrace;
  }

  private isMetaAnalysisRowsUserEdited(metaData: Record<string, unknown>): boolean {
    return this.toBoolean(metaData.meta_analysis_rows_user_edited ?? metaData.metaAnalysisRowsUserEdited) === true;
  }

  private mergeStoredPdfMetaData(
    codexMeta: Record<string, unknown>,
    cachedMeta: Record<string, unknown>,
    storedMeta: Record<string, unknown>
  ): Record<string, unknown> {
    const merged = this.mergeMetaDataRecords(codexMeta, cachedMeta, storedMeta);
    if (this.isMetaAnalysisRowsUserEdited(storedMeta)) {
      merged.meta_analysis_rows = this.firstArray(storedMeta.meta_analysis_rows, storedMeta.metaAnalysisRows);
      merged.meta_analysis_rows_user_edited = true;
    }
    return merged;
  }

  private getEditableMetaAnalysisRows(
    codexMeta: Record<string, unknown>,
    cachedMeta: Record<string, unknown>,
    storedMeta: Record<string, unknown>,
    baseMeta: Record<string, unknown>
  ): Record<string, unknown>[] {
    if (this.isMetaAnalysisRowsUserEdited(storedMeta)) {
      return this.extractExplicitMetaAnalysisRows(storedMeta);
    }
    return this.mergeExplicitMetaAnalysisRows(codexMeta, cachedMeta, storedMeta, baseMeta);
  }

  private mergeExplicitMetaAnalysisRows(...records: Array<Record<string, unknown>>): Record<string, unknown>[] {
    const rows: Record<string, unknown>[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      for (const row of this.extractExplicitMetaAnalysisRows(record)) {
        const key = this.getStableMetaAnalysisRowKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push(row);
      }
    }
    return rows;
  }

  private getStableMetaAnalysisRowKey(row: Record<string, unknown>): string {
    const normalized: Record<string, string> = {};
    Object.keys(row).sort((a, b) => a.localeCompare(b, 'zh-CN')).forEach(key => {
      normalized[key] = this.stringifyTableCellValue(row[key]);
    });
    return JSON.stringify(normalized);
  }

  private isProtectedMetaAnalysisCodingColumn(column: string): boolean {
    const protectedColumns = [
      'Obs#',
      'Study#',
      ...PDF_WIKI_META_ANALYSIS_TRACE_COLUMNS,
    ];
    const normalized = this.normalizeMetaAnalysisColumnKey(column);
    return protectedColumns.some(item => this.normalizeMetaAnalysisColumnKey(item) === normalized);
  }

  private removeColumnsFromMetaAnalysisRow(
    row: Record<string, unknown>,
    normalizedColumns: Set<string>,
    activeColumns: string[]
  ): Record<string, unknown> {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const mapped = this.mapMetaAnalysisColumnName(key, activeColumns) || key;
      const shouldDelete =
        normalizedColumns.has(this.normalizeMetaAnalysisColumnIdentity(key))
        || normalizedColumns.has(this.normalizeMetaAnalysisColumnIdentity(mapped))
        || normalizedColumns.has(this.normalizeMetaAnalysisColumnKey(key))
        || normalizedColumns.has(this.normalizeMetaAnalysisColumnKey(mapped));
      if (!shouldDelete) next[key] = value;
    }
    return next;
  }

  private normalizeMetaAnalysisRow(row: Record<string, unknown>, metaAnalysisColumns: string[]): Record<string, unknown> {
    const output: Record<string, unknown> = {};
    const auxiliaryKeys = new Set([
      'page',
      'pages',
      'location',
      'evidence',
      'evidencetext',
      'sourcetext',
      'originaltext',
      'note',
      'source',
      'sourcetable',
    ]);
    for (const [key, value] of Object.entries(row)) {
      if (!this.isMeaningfulMetaValue(value)) continue;
      const mapped = this.mapMetaAnalysisColumnName(key, metaAnalysisColumns)
        || (auxiliaryKeys.has(this.normalizeMetaAnalysisColumnKey(key)) ? '' : this.normalizeWideColumnName(key, ''));
      if (!mapped) continue;
      output[mapped] = this.stringifyTableCellValue(value);
    }
    return this.normalizeMetaAnalysisMeanErrorCells(output, row, metaAnalysisColumns);
  }

  private normalizeMetaAnalysisMeanErrorCells(
    row: Record<string, unknown>,
    sourceRow: Record<string, unknown>,
    metaAnalysisColumns: string[]
  ): Record<string, unknown> {
    const availableColumns = Array.from(new Set([...metaAnalysisColumns, ...Object.keys(row)]));
    for (const column of Object.keys(row)) {
      if (!this.isLikelyNumericMetaAnalysisColumn(column)) continue;
      const columnKind = this.getMetaAnalysisStatisticColumnKind(column);
      if (columnKind === 'sd' || columnKind === 'se' || columnKind === 'n') continue;

      const parsed = this.parseMetaAnalysisMeanErrorCell(row[column]);
      if (!parsed) continue;

      const sourceErrorKind = parsed.errorKind || this.inferMetaAnalysisErrorKind(this.buildMetaAnalysisErrorContext(sourceRow, column));
      row[column] = parsed.unit
        ? `${parsed.prefix}${this.formatDigitizationNumber(parsed.mean)} ${parsed.unit}`
        : `${parsed.prefix}${this.formatDigitizationNumber(parsed.mean)}`;

      const preferredKinds: Array<'sd' | 'se'> = sourceErrorKind === 'se'
        ? ['se', 'sd']
        : (sourceErrorKind === 'sd' ? ['sd', 'se'] : ['sd', 'se']);
      for (const preferredKind of preferredKinds) {
        const errorColumn = this.findMetaAnalysisCompanionStatisticColumn(column, availableColumns, preferredKind);
        if (!errorColumn) continue;
        const targetKind = this.getMetaAnalysisStatisticColumnKind(errorColumn);
        if (targetKind !== 'sd' && targetKind !== 'se') continue;

        const n = this.findMetaAnalysisCompanionSampleSize(column, row, sourceRow, availableColumns);
        let errorValue = parsed.error;
        let converted = false;
        if (sourceErrorKind === 'se' && targetKind === 'sd') {
          if (!n || n <= 0) {
            if (!this.isMeaningfulMetaValue(row[errorColumn])) continue;
          } else {
            errorValue = parsed.error * Math.sqrt(n);
            converted = true;
          }
        } else if (sourceErrorKind === 'sd' && targetKind === 'se') {
          if (!n || n <= 0) {
            if (!this.isMeaningfulMetaValue(row[errorColumn])) continue;
          } else {
            errorValue = parsed.error / Math.sqrt(n);
            converted = true;
          }
        }

        const nextErrorValue = parsed.unit
          ? `${this.formatDigitizationNumber(errorValue)} ${parsed.unit}`
          : this.formatDigitizationNumber(errorValue);
        const existingErrorIsCombined = !!this.parseMetaAnalysisMeanErrorCell(row[errorColumn]);
        if (converted || existingErrorIsCombined || !this.isMeaningfulMetaValue(row[errorColumn])) {
          row[errorColumn] = nextErrorValue;
        }
        break;
      }

      if (parsed.significance) {
        const significanceColumn = this.findMetaAnalysisSignificanceColumn(column, availableColumns);
        if (significanceColumn && !this.isMeaningfulMetaValue(row[significanceColumn])) {
          row[significanceColumn] = parsed.significance;
        }
      }
    }
    return row;
  }

  private parseMetaAnalysisMeanErrorCell(value: unknown): {
    prefix: string;
    mean: number;
    error: number;
    unit: string;
    significance: string;
    errorKind: 'sd' | 'se' | null;
  } | null {
    const text = this.stringifyTableCellValue(value).replace(/\s+/g, ' ').trim();
    if (!text || !/(?:±|\+\/-|＋\/－|\+-|∓)/.test(text)) return null;
    const numeric = '([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?)';
    const pattern = new RegExp(`^([<>≤≥~≈]?\\s*)${numeric}\\s*(?:±|\\+\\/\\-|＋\\/－|\\+\\-|∓)\\s*${numeric}\\s*(.*)$`, 'i');
    const match = text.replace(/,/g, '').match(pattern);
    if (!match) return null;
    const mean = Number(match[2]);
    const error = Number(match[3]);
    if (!Number.isFinite(mean) || !Number.isFinite(error)) return null;

    const suffix = String(match[4] || '').trim();
    const errorKind = this.inferMetaAnalysisErrorKind(suffix);
    const cleanedSuffix = suffix
      .replace(/\b(?:mean|means?)\s*(?:±|\+\/-|\+-)?\s*(?:sd|s\.d\.|standard\s+deviation|se|s\.e\.|sem|standard\s+error)\b/gi, ' ')
      .replace(/\b(?:sd|s\.d\.|standard\s+deviation|se|s\.e\.|sem|standard\s+error)\b/gi, ' ')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const significance = /^[A-Za-z]{1,3}$/.test(cleanedSuffix) && !/^(?:sd|se|sem)$/i.test(cleanedSuffix)
      ? cleanedSuffix
      : '';
    const unit = this.extractMetaAnalysisMeanErrorUnit(cleanedSuffix);
    return {
      prefix: String(match[1] || '').replace(/\s+/g, ''),
      mean,
      error,
      unit,
      significance,
      errorKind,
    };
  }

  private extractMetaAnalysisMeanErrorUnit(suffix: string): string {
    const cleaned = String(suffix || '').replace(/^[,，;；]+|[,，;；]+$/g, '').trim();
    if (!cleaned || /^[A-Za-z]{1,3}$/.test(cleaned)) return '';
    return /(?:%|kg|mg|g|t\s*ha|ha|μmol|µmol|umol|nmol|mol|ppm|ppb|mL|L|mm|cm|m2|m\^2|°C|℃|K|days?|years?|yr)/i.test(cleaned)
      ? cleaned
      : '';
  }

  private inferMetaAnalysisErrorKind(context: string): 'sd' | 'se' | null {
    const text = String(context || '').replace(/[_-]+/g, ' ').toLowerCase();
    if (/(?:standard\s+error|std\s+error|\bs\.?\s*e\.?\b|\bsem\b|标准误|标准误差|均值标准误)/i.test(text)) return 'se';
    if (/(?:standard\s+deviation|std\s+dev|\bs\.?\s*d\.?\b|\bsd\b|标准差)/i.test(text)) return 'sd';
    return null;
  }

  private buildMetaAnalysisErrorContext(sourceRow: Record<string, unknown>, column: string): string {
    const contextKeys = [
      'error_type',
      'errorType',
      'statistic',
      'statistics',
      'note',
      'notes',
      'evidence',
      'evidence_text',
      'source_text',
      'original_text',
      'table_note',
      'tableNote',
      'caption',
      'source_table',
      'sourceTable',
    ];
    return [
      column,
      ...contextKeys.map(key => this.stringifyTableCellValue(sourceRow[key])),
    ].filter(Boolean).join(' ');
  }

  private getMetaAnalysisStatisticColumnKind(column: string): 'mean' | 'sd' | 'se' | 'n' | 'other' {
    const raw = this.stringifyTableCellValue(column).replace(/[_/()#:-]+/g, ' ').toLowerCase();
    const normalized = this.normalizeMetaAnalysisColumnKey(column);
    if (!normalized || normalized === 'tn' || normalized === 'totalnitrogen' || normalized === '全氮') return 'other';
    if (/(?:standarderror|stderr|sem|标准误|标准误差)/.test(normalized) || /\b(?:se|sem|s\.?\s*e\.?)\b/.test(raw)) return 'se';
    if (/(?:standarddeviation|stddev|stdev|cksd|tsd|n2osd|nosd|标准差)/.test(normalized) || /\b(?:sd|s\.?\s*d\.?)\b/.test(raw)) return 'sd';
    if (/(?:samplesize|replicate|replicates|replication|ckn|n2otn|notn|n2on|non|样本量|重复数)/.test(normalized)) return 'n';
    if (/mean|均值|平均/.test(normalized)) return 'mean';
    return 'other';
  }

  private findMetaAnalysisCompanionStatisticColumn(
    column: string,
    availableColumns: string[],
    kind: 'sd' | 'se' | 'n'
  ): string {
    const candidates = this.buildMetaAnalysisCompanionStatisticCandidates(column, kind);
    for (const candidate of candidates) {
      const mapped = this.mapMetaAnalysisColumnName(candidate, availableColumns);
      if (mapped && availableColumns.some(columnName => this.normalizeMetaAnalysisColumnIdentity(columnName) === this.normalizeMetaAnalysisColumnIdentity(mapped))) {
        return availableColumns.find(columnName => this.normalizeMetaAnalysisColumnIdentity(columnName) === this.normalizeMetaAnalysisColumnIdentity(mapped)) || mapped;
      }
      const normalizedCandidate = this.normalizeMetaAnalysisColumnIdentity(candidate);
      const found = availableColumns.find(columnName =>
        this.normalizeMetaAnalysisColumnIdentity(columnName) === normalizedCandidate
        || this.normalizeMetaAnalysisColumnKey(columnName) === this.normalizeMetaAnalysisColumnKey(candidate)
      );
      if (found) return found;
    }
    return '';
  }

  private buildMetaAnalysisCompanionStatisticCandidates(column: string, kind: 'sd' | 'se' | 'n'): string[] {
    const parsed = this.parseMetaAnalysisColumnUnit(column);
    const base = parsed.base || this.stringifyTableCellValue(column);
    const normalized = this.normalizeMetaAnalysisColumnKey(base);
    const suffixes = kind === 'sd'
      ? ['SD', 'sd', '标准差']
      : (kind === 'se' ? ['SE', 'SEM', 'se', 'sem', '标准误'] : ['n', 'N', '样本量', '重复数']);
    const candidates: string[] = [];
    const add = (value: string): void => {
      const cleaned = value.trim();
      if (cleaned && !candidates.includes(cleaned)) candidates.push(cleaned);
    };
    const addBaseSuffixes = (targetBase: string): void => {
      for (const suffix of suffixes) {
        add(`${targetBase}_${suffix}`);
        add(`${targetBase} ${suffix}`);
        add(`${targetBase}${suffix}`);
      }
    };

    if (/n2o/.test(normalized)) {
      if (/ckmean|controlmean|对照/.test(normalized)) add(kind === 'sd' ? 'N2O_CKsd' : (kind === 'se' ? 'N2O_CKse' : 'N2O_CKn'));
      else if (/tmean|treatmentmean|处理组|处理均值/.test(normalized)) add(kind === 'sd' ? 'N2O_Tsd' : (kind === 'se' ? 'N2O_Tse' : 'N2O_Tn'));
      else add(kind === 'sd' ? 'N2O_SD' : (kind === 'se' ? 'N2O_SE' : 'N2O_n'));
    } else if (/(^|[^2])no/.test(normalized)) {
      if (/ckmean|controlmean|对照/.test(normalized)) add(kind === 'sd' ? 'NO_CKsd' : (kind === 'se' ? 'NO_CKse' : 'NO_CKn'));
      else if (/tmean|treatmentmean|处理组|处理均值/.test(normalized)) add(kind === 'sd' ? 'NO_Tsd' : (kind === 'se' ? 'NO_Tse' : 'NO_Tn'));
      else add(kind === 'sd' ? 'NO_SD' : (kind === 'se' ? 'NO_SE' : 'NO_n'));
    }

    if (/mean/i.test(base)) {
      for (const suffix of suffixes) add(base.replace(/mean/ig, suffix));
    }
    if (/均值|平均/.test(base)) {
      const replacement = kind === 'sd' ? '标准差' : (kind === 'se' ? '标准误' : '样本量');
      add(base.replace(/均值|平均/g, replacement));
    }
    addBaseSuffixes(base);
    if (kind === 'n') {
      add('重复数');
      add('replicates');
      add('n');
      add('N');
    }
    return candidates;
  }

  private findMetaAnalysisCompanionSampleSize(
    column: string,
    row: Record<string, unknown>,
    sourceRow: Record<string, unknown>,
    availableColumns: string[]
  ): number | null {
    const nColumn = this.findMetaAnalysisCompanionStatisticColumn(column, availableColumns, 'n');
    const candidates = [
      nColumn ? row[nColumn] : undefined,
      row['重复数'],
      row.n,
      row.N,
      sourceRow[nColumn],
      sourceRow['重复数'],
      sourceRow.n,
      sourceRow.N,
      sourceRow.sample_size,
      sourceRow.sampleSize,
      sourceRow.replicates,
      sourceRow.replication,
    ];
    for (const value of candidates) {
      const n = this.parseMetaAnalysisFirstNumber(value);
      if (n && n > 0) return n;
    }
    return null;
  }

  private parseMetaAnalysisFirstNumber(value: unknown): number | null {
    const text = this.stringifyTableCellValue(value).replace(/,/g, '').trim();
    const match = text.match(/[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) ? number : null;
  }

  private findMetaAnalysisSignificanceColumn(column: string, availableColumns: string[]): string {
    const parsed = this.parseMetaAnalysisColumnUnit(column);
    const base = parsed.base || this.stringifyTableCellValue(column);
    const candidates = [
      `${base}_significance`,
      `${base} significance`,
      `${base}_显著性`,
      `${base} 显著性`,
      'significance',
      '显著性',
      '差异字母',
    ];
    for (const candidate of candidates) {
      const normalized = this.normalizeMetaAnalysisColumnIdentity(candidate);
      const found = availableColumns.find(columnName => this.normalizeMetaAnalysisColumnIdentity(columnName) === normalized);
      if (found) return found;
    }
    return '';
  }

  private mapMetaAnalysisColumnName(rawColumn: unknown, metaAnalysisColumns: string[]): string {
    const original = this.stringifyTableCellValue(rawColumn);
    if (!original) return '';
    if (metaAnalysisColumns.includes(original)) return original;
    if ((PDF_WIKI_META_ANALYSIS_COLUMNS as readonly string[]).includes(original)) return original;

    const normalized = this.normalizeMetaAnalysisColumnIdentity(original);
    const templateMatch = metaAnalysisColumns.find(column => this.normalizeMetaAnalysisColumnIdentity(column) === normalized);
    if (templateMatch) return templateMatch;

    const aliases: Record<string, string> = {
      obs: 'Obs#',
      obsid: 'Obs#',
      observation: 'Obs#',
      observationid: 'Obs#',
      observationnumber: 'Obs#',
      study: 'Study#',
      studyid: 'Study#',
      studynumber: 'Study#',
      paperid: 'Study#',
      研究编号: 'Study#',
      处理: '处理',
      treatment: '处理',
      treatmentname: '处理',
      croptype: '种植的作物',
      crop: '种植的作物',
      crops: '种植的作物',
      作物: '种植的作物',
      种植作物: '种植的作物',
      ninput: 'N input',
      nitrogeninput: 'N input',
      nrate: 'N input',
      fertilizerrate: 'N input',
      氮投入: 'N input',
      施氮量: 'N input',
      period: 'Period',
      持续天数: '持续天数',
      duration: '持续天数',
      durationdays: '持续天数',
      days: '持续天数',
      重复数: '重复数',
      replicate: '重复数',
      replicates: '重复数',
      replication: '重复数',
      nrep: '重复数',
      lat: 'Lat',
      latitude: 'Lat',
      纬度: 'Lat',
      long: 'Long',
      lon: 'Long',
      longitude: 'Long',
      经度: 'Long',
      实验类型: '实验类型',
      experimenttype: '实验类型',
      experimentaltype: '实验类型',
      实验期间土壤平均温度: '实验期间土壤平均温度',
      soiltemperature: '实验期间土壤平均温度',
      meansoiltemperature: '实验期间土壤平均温度',
      soiltemp: '实验期间土壤平均温度',
      实验期间空气平均温度: '实验期间空气平均温度',
      airtemperature: '实验期间空气平均温度',
      meanairtemperature: '实验期间空气平均温度',
      airtemp: '实验期间空气平均温度',
      年均温: '年均温',
      mat: '年均温',
      meanannualtemperature: '年均温',
      实验期间降水量: '实验期间降水量',
      periodprecipitation: '实验期间降水量',
      precipitationduringexperiment: '实验期间降水量',
      灌溉量: '灌溉量',
      irrigation: '灌溉量',
      irrigationamount: '灌溉量',
      总纳水量: '总纳水量',
      totalwaterinput: '总纳水量',
      precipitationandirrigation: '总纳水量',
      年均降水量: '年均降水量',
      map: '年均降水量',
      meanannualprecipitation: '年均降水量',
      wfps: 'WFPS(%)',
      'wfps%': 'WFPS(%)',
      whc: 'WHC（%）',
      'whc%': 'WHC（%）',
      soiltexture: 'Soil Texture',
      texture: 'Soil Texture',
      土壤质地: 'Soil Texture',
      bulkdensity: 'Bulk Density',
      soilbulkdensity: 'Bulk Density',
      容重: 'Bulk Density',
      ph: 'PH',
      soilph: 'PH',
      som: 'SOM',
      soilorganicmatter: 'SOM',
      有机质: 'SOM',
      soc: 'SOC',
      soilorganiccarbon: 'SOC',
      有机碳: 'SOC',
      tc: 'TC',
      totalcarbon: 'TC',
      tn: 'TN',
      totalnitrogen: 'TN',
      全氮: 'TN',
      cn: 'C/N',
      cnratio: 'C/N',
      'c/n': 'C/N',
      nh4n: 'NH4+-N (mg kg-1)',
      'nh4+-n': 'NH4+-N (mg kg-1)',
      ammoniumnitrogen: 'NH4+-N (mg kg-1)',
      铵态氮: 'NH4+-N (mg kg-1)',
      no3n: 'NO3_-N (mg kg-1)',
      'no3-n': 'NO3_-N (mg kg-1)',
      nitratenitrogen: 'NO3_-N (mg kg-1)',
      硝态氮: 'NO3_-N (mg kg-1)',
      气候: '气候',
      climate: '气候',
      施肥次数: '施肥次数',
      fertilizationtimes: '施肥次数',
      fertilizationfrequency: '施肥次数',
      施肥方式: '施肥方式',
      fertilizationmethod: '施肥方式',
      fertilizerapplicationmethod: '施肥方式',
      cumno: 'Cum NO',
      cumulativeno: 'Cum NO',
      noemission: 'Cum NO',
      no_sd: 'NO_SD',
      nosd: 'NO_SD',
      sdno: 'NO_SD',
      no_n: 'NO_n',
      non: 'NO_n',
      nno: 'NO_n',
      no减氮: 'NO_减氮',
      noreduction: 'NO_减氮',
      nreductionno: 'NO_减氮',
      ckmeanno: 'NO_CKmean',
      no_ckmean: 'NO_CKmean',
      cksdno: 'NO_CKsd',
      no_cksd: 'NO_CKsd',
      cknno: 'NO_CKn',
      no_ckn: 'NO_CKn',
      tmeanno: 'NO_Tmean',
      no_tmean: 'NO_Tmean',
      tsdno: 'NO_Tsd',
      no_tsd: 'NO_Tsd',
      tnno: 'NO_Tn',
      no_tn: 'NO_Tn',
      cumn2o: 'Cum N2O',
      cumulativen2o: 'Cum N2O',
      n2oemission: 'Cum N2O',
      n2o_sd: 'N2O_SD',
      n2osd: 'N2O_SD',
      sdn2o: 'N2O_SD',
      n2o_n: 'N2O_n',
      n2on: 'N2O_n',
      nn2o: 'N2O_n',
      n2o减氮: 'N2O_减氮',
      n2oreduction: 'N2O_减氮',
      nreductionn2o: 'N2O_减氮',
      ckmeann2o: 'N2O_CKmean',
      n2o_ckmean: 'N2O_CKmean',
      cksdn2o: 'N2O_CKsd',
      n2o_cksd: 'N2O_CKsd',
      cknn2o: 'N2O_CKn',
      n2o_ckn: 'N2O_CKn',
      tmeann2o: 'N2O_Tmean',
      n2o_tmean: 'N2O_Tmean',
      tsdn2o: 'N2O_Tsd',
      n2o_tsd: 'N2O_Tsd',
      tnn2o: 'N2O_Tn',
      n2o_tn: 'N2O_Tn',
    };

    if (aliases[normalized]) return aliases[normalized];
    if (/^obs(?:ervation)?(?:id|number)?$/.test(normalized)) return 'Obs#';
    if (/^study(?:id|number)?$/.test(normalized)) return 'Study#';
    if (/^(ninput|nitrogeninput|nrate|fertilizerrate)/.test(normalized)) return 'N input';
    if (/^(lat|latitude|纬度)$/.test(normalized)) return 'Lat';
    if (/^(long|lon|longitude|经度)$/.test(normalized)) return 'Long';
    if (/wfps/.test(normalized)) return 'WFPS(%)';
    if (/whc/.test(normalized)) return 'WHC（%）';
    if (/soiltexture|texture|土壤质地/.test(normalized)) return 'Soil Texture';
    if (/bulkdensity|容重/.test(normalized)) return 'Bulk Density';
    if (/^ph|soilph/.test(normalized)) return 'PH';
    if (/som|soilorganicmatter|有机质/.test(normalized)) return 'SOM';
    if (/soc|soilorganiccarbon|有机碳/.test(normalized)) return 'SOC';
    if (/^(tc|totalcarbon)/.test(normalized)) return 'TC';
    if (/^(tn|totalnitrogen)|全氮/.test(normalized)) return 'TN';
    if (/cnratio|^cn$|c\/n/.test(normalized)) return 'C/N';
    if (/nh4|ammonium|铵态氮/.test(normalized)) return 'NH4+-N (mg kg-1)';
    if (/no3|nitrate|硝态氮/.test(normalized)) return 'NO3_-N (mg kg-1)';
    if (/climate|气候/.test(normalized)) return '气候';
    if (/fertiliz.*times|fertiliz.*frequency|施肥次数/.test(normalized)) return '施肥次数';
    if (/fertiliz.*method|applicationmethod|施肥方式/.test(normalized)) return '施肥方式';
    if (/cumn2o|cumulativen2o|n2o.*emission/.test(normalized)) return 'Cum N2O';
    if (/cumno|cumulativeno|no.*emission/.test(normalized)) return 'Cum NO';
    if (/n2o.*sd|sdn2o/.test(normalized)) return 'N2O_SD';
    if (/n2o.*(?:replicate|sample|^n$)|^nn2o$/.test(normalized)) return 'N2O_n';
    if (/n2o.*(?:reduction|减氮)|(?:reduction|减氮).*n2o/.test(normalized)) return 'N2O_减氮';
    if (/n2o.*ckmean|ckmean.*n2o/.test(normalized)) return 'N2O_CKmean';
    if (/n2o.*cksd|cksd.*n2o/.test(normalized)) return 'N2O_CKsd';
    if (/n2o.*ckn|ckn.*n2o/.test(normalized)) return 'N2O_CKn';
    if (/n2o.*tmean|tmean.*n2o/.test(normalized)) return 'N2O_Tmean';
    if (/n2o.*tsd|tsd.*n2o/.test(normalized)) return 'N2O_Tsd';
    if (/n2o.*tn$|tn.*n2o/.test(normalized)) return 'N2O_Tn';
    if (/(^|[^2])no.*sd|sdno/.test(normalized)) return 'NO_SD';
    if (/(^|[^2])no.*(?:replicate|sample|^n$)|^nno$/.test(normalized)) return 'NO_n';
    if (/(^|[^2])no.*(?:reduction|减氮)|(?:reduction|减氮).*no/.test(normalized)) return 'NO_减氮';
    if (/(^|[^2])no.*ckmean|ckmean.*no/.test(normalized)) return 'NO_CKmean';
    if (/(^|[^2])no.*cksd|cksd.*no/.test(normalized)) return 'NO_CKsd';
    if (/(^|[^2])no.*ckn|ckn.*no/.test(normalized)) return 'NO_CKn';
    if (/(^|[^2])no.*tmean|tmean.*no/.test(normalized)) return 'NO_Tmean';
    if (/(^|[^2])no.*tsd|tsd.*no/.test(normalized)) return 'NO_Tsd';
    if (/(^|[^2])no.*tn$|tn.*no/.test(normalized)) return 'NO_Tn';
    return '';
  }

  private normalizeMetaAnalysisColumnKey(value: unknown): string {
    return this.stringifyTableCellValue(value)
      .toLowerCase()
      .replace(/[（）]/g, match => match === '（' ? '(' : ')')
      .replace(/[_\s#:/\\]+/g, '')
      .replace(/[()]/g, '')
      .replace(/[−-]/g, '-')
      .replace(/％/g, '%')
      .trim();
  }

  private buildMetaAnalysisSummaryFallback(metaData: Record<string, unknown>, metaAnalysisColumns: string[]): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    const locations = this.firstArray(metaData.study_locations);
    const firstLocation = this.asRecord(locations[0]);
    row['Study#'] = this.firstString(metaData.paper_id, metaData.paperId, metaData.study_id, metaData.studyId);
    row['种植的作物'] = this.toDisplayStringArray(metaData.crop_types).join('；');
    row['处理'] = this.toDisplayStringArray(metaData.treatment_categories).join('；');
    row.Lat = this.firstString(firstLocation.latitude, firstLocation.lat, metaData.lat, metaData.latitude);
    row.Long = this.firstString(firstLocation.longitude, firstLocation.long, firstLocation.lon, metaData.long, metaData.lon, metaData.longitude);
    row['气候'] = this.firstString(firstLocation.climate, metaData.climate);
    const soil = this.asRecord(metaData.soil_physicochemical_biological_indicators);
    Object.assign(row, this.normalizeMetaAnalysisRow(soil, metaAnalysisColumns));
    return row;
  }

  private async getPdfMetaTables(
    userId: string,
    pdf: PdfWikiSourcePdf,
    metaData: Record<string, unknown>
  ): Promise<PdfWikiMetaTableFileItem[]> {
    const pdfTitle = this.firstString(metaData.title, pdf.title) || pdf.originalName;
    const taskDir = this.getCodexPdfWikiTaskDir(userId, pdf);
    const tablesDir = path.join(taskDir, 'tables');
    const items = new Map<string, PdfWikiMetaTableFileItem>();

    const ensureItem = (tableKey: string): PdfWikiMetaTableFileItem => {
      const safeKey = this.normalizeMetaTableKey(tableKey);
      const existing = items.get(safeKey);
      if (existing) return existing;
      const item: PdfWikiMetaTableFileItem = {
        id: this.makeMetaTableId(pdf.id, safeKey),
        pdfId: pdf.id,
        pdfName: pdf.originalName,
        pdfTitle,
        tableKey: safeKey,
        label: safeKey,
        title: '',
        page: '',
        sourcePath: '',
        hasData: false,
        rowCount: 0,
        columnCount: 0,
        columns: [],
        previewRows: [],
      };
      items.set(safeKey, item);
      return item;
    };

    const sourceTables = this.firstArray(metaData.source_tables);
    sourceTables.forEach((table, index) => {
      const record = this.asRecord(table);
      const sourcePath = this.firstString(
        record.csv_path,
        record.csvPath,
        record.json_path,
        record.jsonPath,
        record.output_path,
        record.outputPath,
        record.file_path,
        record.filePath,
        record.path,
        record.file
      );
      const tableKey = this.inferMetaTableKey(
        sourcePath,
        this.firstString(record.id, record.table_id, record.tableId, record.number, record.table_number, record.tableNumber),
        index
      );
      const item = ensureItem(tableKey);
      item.title = this.firstString(record.title, record.caption, record.name, record.label, typeof table === 'string' ? table : '') || item.title;
      item.page = this.firstString(record.page, record.pages, record.page_number, record.pageNumber) || item.page;
      item.sourcePath = sourcePath || item.sourcePath;
      item.label = this.firstString(record.label, record.id, record.table_id, record.tableId, item.title, item.label) || item.label;
      const columns = this.toDisplayStringArray(record.columns || record.headers);
      if (columns.length > 0) item.columns = columns;
      const rowCount = Number(record.row_count || record.rowCount || record.rows_count || record.rowsCount || 0);
      const columnCount = Number(record.column_count || record.columnCount || record.cols || record.colsCount || 0);
      if (Number.isFinite(rowCount) && rowCount > 0) item.rowCount = rowCount;
      if (Number.isFinite(columnCount) && columnCount > 0) item.columnCount = columnCount;
    });

    if (fs.existsSync(tablesDir)) {
      const files = await fs.promises.readdir(tablesDir);
      for (const fileName of files) {
        const ext = path.extname(fileName).toLowerCase();
        if (!['.csv', '.json'].includes(ext)) continue;
        const baseName = path.basename(fileName, ext);
        const item = ensureItem(baseName);
        const absolutePath = path.join(tablesDir, fileName);
        const relativePath = path.join('tables', fileName).replace(/\\/g, '/');
        if (ext === '.csv') item.csvFilePath = absolutePath;
        if (ext === '.json') item.jsonFilePath = absolutePath;
        item.sourcePath = item.sourcePath || relativePath;
        item.hasData = true;
      }
    }

    const result = Array.from(items.values()).sort((a, b) => a.tableKey.localeCompare(b.tableKey, 'zh-CN'));
    await Promise.all(result.map(async table => {
      if (!table.hasData) return;
      try {
        const rows = await this.readMetaTableRows(table);
        table.previewRows = rows.slice(0, 3);
        table.rowCount = rows.length;
        table.columnCount = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 0), table.columnCount || 0);
        if (table.columns.length === 0 && rows.length > 0) {
          table.columns = (rows[0] || []).map(cell => this.stringifyMetaValue(cell)).filter(Boolean);
        }
      } catch (error) {
        logger.warn(`[PdfWiki] Failed to inspect table ${table.id}:`, error);
      }
    }));
    return result;
  }

  private toPublicMetaTableItem(table: PdfWikiMetaTableFileItem): PdfWikiMetaTableItem {
    const {
      csvFilePath: _csvFilePath,
      jsonFilePath: _jsonFilePath,
      ...publicTable
    } = table;
    return publicTable;
  }

  private makeMetaTableId(pdfId: string, tableKey: string): string {
    return `${pdfId}__table__${this.normalizeMetaTableKey(tableKey)}`;
  }

  private normalizeMetaTableKey(value: string): string {
    return String(value || 'table')
      .trim()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      || 'table';
  }

  private inferMetaTableKey(sourcePath: string, fallback: string, index: number): string {
    const fromPath = sourcePath ? path.basename(sourcePath, path.extname(sourcePath)) : '';
    return this.normalizeMetaTableKey(fromPath || fallback || `meta_table_${index + 1}`);
  }

  private isGeneratedMetaAnalysisTable(table: PdfWikiMetaTableFileItem | PdfWikiMetaTableItem): boolean {
    const text = [
      table.tableKey,
      table.label,
      table.sourcePath,
      table.sourcePath ? path.basename(table.sourcePath) : '',
    ].join(' ').toLowerCase();
    return /(^|[/_\s-])meta[_\s-]*analysis([_\s-]*table|[_\s-]*rows)?($|[.\s/_-])/i.test(text)
      || /template[_\s-]*aligned[_\s-]*meta/i.test(text);
  }

  private async readMetaTableRows(table: PdfWikiMetaTableFileItem): Promise<unknown[][]> {
    if (table.csvFilePath && fs.existsSync(table.csvFilePath)) {
      const xlsx = await import('xlsx');
      const buffer = await fs.promises.readFile(table.csvFilePath);
      const workbook = xlsx.read(buffer, { type: 'buffer', raw: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      return sheet ? (xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][]) : [];
    }

    if (table.jsonFilePath && fs.existsSync(table.jsonFilePath)) {
      const json = await this.readJsonFileIfExists(table.jsonFilePath);
      return this.normalizeMetaTableJsonRows(json);
    }

    return [];
  }

  private normalizeMetaTableJsonRows(value: unknown): unknown[][] {
    if (!value) return [];
    if (Array.isArray(value)) {
      return this.arrayToTableRows(value);
    }
    const record = this.asRecord(value);
    const rows = this.firstArray(record.rows, record.data, record.table, record.cells, record.records);
    if (rows.length > 0) {
      const columns = this.toDisplayStringArray(record.columns || record.headers);
      return this.arrayToTableRows(rows, columns);
    }
    return [];
  }

  private inferTableHeader(rows: unknown[][], preferredColumns: string[] = []): string[] {
    if (preferredColumns.length > 0) {
      return preferredColumns.map((column, index) => this.stringifyTableCellValue(column) || `列${index + 1}`);
    }
    const firstRow = rows[0] || [];
    const width = rows.reduce((max, row) => Math.max(max, Array.isArray(row) ? row.length : 1), 0);
    const nonEmptyCells = firstRow.filter(cell => this.stringifyTableCellValue(cell).trim()).length;
    const numericCells = firstRow.filter(cell => /\d/.test(this.stringifyTableCellValue(cell))).length;
    if (firstRow.length > 0 && numericCells === 0 && nonEmptyCells >= Math.min(2, width)) {
      return Array.from({ length: width }, (_, index) => this.stringifyTableCellValue(firstRow[index]) || `列${index + 1}`);
    }
    return Array.from({ length: Math.max(1, width) }, (_, index) => `列${index + 1}`);
  }

  private shouldSkipFirstTableRow(rows: unknown[][], header: string[]): boolean {
    if (rows.length <= 1) return false;
    const firstRow = rows[0] || [];
    if (firstRow.length === 0) return false;
    const normalizedHeader = header.map(cell => this.normalizeForEvidenceMatching(cell)).join('|');
    const normalizedFirst = firstRow.map(cell => this.normalizeForEvidenceMatching(this.stringifyTableCellValue(cell))).join('|');
    if (normalizedHeader && normalizedHeader === normalizedFirst) return true;
    const numericCells = firstRow.filter(cell => /\d/.test(this.stringifyTableCellValue(cell))).length;
    return numericCells === 0 && firstRow.filter(cell => this.stringifyTableCellValue(cell)).length >= Math.min(2, header.length);
  }

  private stringifyTableCellValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(item => this.stringifyTableCellValue(item)).filter(Boolean).join('；');
    const record = this.asRecord(value);
    return Object.entries(record)
      .filter(([, item]) => this.isMeaningfulMetaValue(item))
      .map(([key, item]) => `${key}: ${this.stringifyTableCellValue(item)}`)
      .join('；');
  }

  private flattenWideMetaColumns(prefix: string, value: unknown): Record<string, unknown> {
    const metricColumns = this.extractStructuredMetricColumns(value);
    if (Object.keys(metricColumns).length > 0) return metricColumns;

    const result: Record<string, unknown> = {};
    const visit = (label: string, current: unknown): void => {
      if (!this.isMeaningfulMetaValue(current)) return;
      if (typeof current !== 'object' || current === null) {
        result[this.normalizeWideColumnName(label, prefix)] = this.stringifyTableCellValue(current);
        return;
      }

      if (Array.isArray(current)) {
        const records = current.map(item => this.asRecord(item)).filter(record => Object.keys(record).length > 0);
        if (records.length > 0 && records.length === current.length) {
          const keys = Array.from(new Set(records.flatMap(record => Object.keys(record))));
          for (const key of keys) {
            const values = records.map(record => record[key]).filter(item => this.isMeaningfulMetaValue(item));
            if (values.length === 0) continue;
            const column = `${label}.${this.formatWideMetaKey(key)}`;
            if (values.every(item => typeof item !== 'object' || item === null || (Array.isArray(item) && item.every(cell => typeof cell !== 'object' || cell === null)))) {
              result[this.normalizeWideColumnName(column, key)] = this.unique(values.map(item => this.stringifyTableCellValue(item))).join('；');
            } else {
              visit(column, values);
            }
          }
          return;
        }

        result[this.normalizeWideColumnName(label, prefix)] = this.stringifyTableCellValue(current);
        return;
      }

      const record = this.asRecord(current);
      for (const [key, item] of Object.entries(record)) {
        if (!this.isMeaningfulMetaValue(item)) continue;
        visit(`${label}.${this.formatWideMetaKey(key)}`, item);
      }
    };

    visit(prefix, value);
    return result;
  }

  private extractStructuredMetricColumns(value: unknown): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const valueKeys = ['value', 'values', 'mean', 'median', 'result', 'measurement', 'content', 'range', 'amount', 'concentration'];
    const metricKeys = ['indicator', 'metric', 'variable', 'parameter', 'property', 'index', 'name', 'label'];
    const unitKeys = ['unit', 'units'];

    const visit = (current: unknown): void => {
      if (!this.isMeaningfulMetaValue(current)) return;
      if (Array.isArray(current)) {
        current.forEach(visit);
        return;
      }
      if (typeof current !== 'object' || current === null) return;

      const record = this.asRecord(current);
      const metricName = this.firstString(...metricKeys.map(key => record[key]));
      const metricValue = this.firstString(...valueKeys.map(key => record[key]));
      if (metricName && metricValue && valueKeys.some(key => this.isMeaningfulMetaValue(record[key]))) {
        const unit = this.firstString(...unitKeys.map(key => record[key]));
        const column = this.normalizeWideColumnName(unit ? `${metricName} (${unit})` : metricName, metricName);
        result[column] = metricValue;
        return;
      }

      Object.values(record).forEach(visit);
    };

    visit(value);
    return result;
  }

  private extractMetricValueRecordFromText(text: string): Record<string, string> {
    const cleanText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleanText) return {};

    const valuePattern = /(?:[<>≤≥~≈]?\s*\d+(?:\.\d+)?\s*%\s*(?:[–-]\s*\d+(?:\.\d+)?\s*%)?(?:\s*±\s*\d+(?:\.\d+)?\s*%)?)|(?:[<>≤≥~≈]?\s*\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?(?:\s*±\s*\d+(?:\.\d+)?)?\s*(?:%|mg\s*(?:kg|g)?(?:[-−]1)?|g\s*(?:kg|g)?(?:[-−]1)?|kg\s*ha(?:[-−]1)?|t\s*ha(?:[-−]1)?|μmol|µmol|umol|nmol|mol|ppm|ppb|mL|L|mm|cm|m2|m\^2|m|°C|℃|K|h|d|days?|years?|yr)?)|(?:p\s*[<≤]\s*0\.\d+)/gi;
    const metricPatterns: Array<{ column: string; pattern: RegExp }> = [
      { column: 'pH', pattern: /\bpH\b/i },
      { column: 'SOC', pattern: /\bSOC\b|soil organic carbon|organic carbon/i },
      { column: 'SOM', pattern: /\bSOM\b|soil organic matter/i },
      { column: 'TN', pattern: /\bTN\b|total nitrogen/i },
      { column: 'NH4+', pattern: /\bNH4\+?\b|NH4[-\s]?N|ammonium/i },
      { column: 'NO3-', pattern: /\bNO3-?\b|NO3[-\s]?N|nitrate/i },
      { column: 'NO2-', pattern: /\bNO2-?\b|NO2[-\s]?N|nitrite/i },
      { column: 'N2O', pattern: /\bN2O\b|nitrous oxide/i },
      { column: 'CO2', pattern: /\bCO2\b|carbon dioxide/i },
      { column: 'CH4', pattern: /\bCH4\b|methane/i },
      { column: 'H2O2', pattern: /\bH2O2\b|hydrogen peroxide/i },
      { column: 'OH', pattern: /˙OH|·OH|hydroxyl radical/i },
      { column: 'O2-', pattern: /˙O2-|·O2-|superoxide/i },
      { column: 'WFPS', pattern: /\bWFPS\b|water[-\s]?filled pore space/i },
      { column: '土壤含水量', pattern: /soil water content|volumetric water content|water content/i },
      { column: '容重', pattern: /bulk density/i },
      { column: '有效磷', pattern: /available phosphorus|olsen\s*p|\bAP\b/i },
      { column: '速效钾', pattern: /available potassium|\bAK\b/i },
      { column: '微生物量', pattern: /microbial biomass/i },
      { column: '酶活性', pattern: /enzyme activit/i },
      { column: 'AImod', pattern: /\bAImod\b/i },
      { column: 'amoA(AOA)', pattern: /\bamoA\s*\(?AOA\)?/i },
      { column: 'amoA(AOB)', pattern: /\bamoA\s*\(?AOB\)?/i },
      { column: 'hao', pattern: /\bhao\b/i },
      { column: 'nxrA', pattern: /\bnxrA\b/i },
      { column: 'narG', pattern: /\bnarG\b/i },
      { column: 'nirK', pattern: /\bnirK\b/i },
      { column: 'nirS', pattern: /\bnirS\b/i },
      { column: 'nosZ', pattern: /\bnosZ\b/i },
      { column: 'nrfA', pattern: /\bnrfA\b/i },
    ];

    const result: Record<string, string> = {};
    const collectValues = (source: string): string[] => {
      const values: string[] = [];
      const matcher = new RegExp(valuePattern.source, valuePattern.flags);
      for (const match of source.matchAll(matcher)) {
        const matchedText = match[0] || '';
        const raw = matchedText.replace(/\s+/g, ' ').trim();
        const index = match.index ?? 0;
        const leadingSpaces = matchedText.length - matchedText.trimStart().length;
        const trailingSpaces = matchedText.length - matchedText.trimEnd().length;
        const valueStart = index + leadingSpaces;
        const valueEnd = index + matchedText.length - trailingSpaces;
        const before = source[valueStart - 1] || '';
        const after = source[valueEnd] || '';
        const afterNext = source[valueEnd + 1] || '';
        if ((/[A-Za-z]/.test(before) || /[A-Za-z]/.test(after)) && !/^p\s*[<≤]\s*0\.\d+/i.test(raw)) continue;
        if (/^\d+(?:\.\d+)?$/.test(raw) && /[-−]/.test(after) && /h/i.test(afterNext)) continue;
        values.push(raw);
      }
      return this.unique(values);
    };
    const allValues = collectValues(cleanText);
    for (const metric of metricPatterns) {
      const index = cleanText.search(metric.pattern);
      if (index < 0) continue;
      let end = Math.min(cleanText.length, index + 120);
      for (const other of metricPatterns) {
        if (other.column === metric.column) continue;
        const offset = cleanText.slice(index + 1).search(other.pattern);
        if (offset >= 0) {
          const absolute = index + 1 + offset;
          if (absolute > index && absolute < end) end = absolute;
        }
      }
      const afterWindow = cleanText.slice(index, end);
      const beforeWindow = cleanText.slice(Math.max(0, index - 70), Math.min(cleanText.length, index + 40));
      let values = collectValues(afterWindow);
      if (values.length === 0) values = collectValues(beforeWindow);
      if (values.length === 0 && allValues.length > 0 && metricPatterns.filter(item => item.pattern.test(cleanText)).length === 1) {
        values = allValues;
      }
      if (values.length > 0) {
        result[metric.column] = values.slice(0, 8).join('；');
      }
    }

    const dynamicColumns = this.extractDynamicMetricValueRecord(cleanText, collectValues);
    for (const [column, value] of Object.entries(dynamicColumns)) {
      if (!result[column]) result[column] = value;
    }
    return result;
  }

  private extractDynamicMetricValueRecord(text: string, collectValues: (source: string) => string[]): Record<string, string> {
    const result: Record<string, string> = {};
    const clauses = text
      .split(/(?<=[。！？.!?])\s+|[；;]/)
      .map(clause => clause.trim())
      .filter(clause => clause.length >= 6);

    const englishMetric = '[A-Za-zμµ][A-Za-z0-9+\\-−_/().·˙μµ]*(?:\\s+[A-Za-zμµ][A-Za-z0-9+\\-−_/().·˙μµ]*){0,6}';
    const chineseMetric = '[\\u4e00-\\u9fa5A-Za-z0-9+\\-−_/().（）·˙μµ]{1,42}';
    const numericStart = '(?:[<>≤≥~≈]?\\s*\\d|p\\s*[<≤])';
    const patterns = [
      new RegExp(`(${englishMetric})\\s*(?:was|were|is|are|reached|ranged|averaged|increased|decreased|reduced|enhanced|declined|changed|accounted|contributed|showed|produced|emitted|accumulated|=|:)\\s*(?:by|to|from|at|about|approximately|around|~|≈)?\\s*${numericStart}`, 'i'),
      new RegExp(`(${englishMetric})\\s+(?:content|concentration|activity|activities|abundance|emission|emissions|flux|rate|yield|biomass|density|capacity|ratio)\\s*(?:of|was|were|is|are|=|:)?\\s*${numericStart}`, 'i'),
      new RegExp(`${numericStart}[^,;。；]{0,30}\\s+(?:of|for|in)\\s+(${englishMetric})`, 'i'),
      new RegExp(`(${chineseMetric})\\s*(?:为|是|达到|增加|降低|下降|减少|提高|变化为|=|：|:)\\s*${numericStart}`, 'i'),
      new RegExp(`${numericStart}[^,;。；]{0,20}\\s*的\\s*(${chineseMetric})`, 'i'),
    ];

    for (const clause of clauses) {
      const values = collectValues(clause);
      if (values.length === 0) continue;
      for (const pattern of patterns) {
        const match = clause.match(pattern);
        if (!match || !match[1]) continue;
        const column = this.normalizeDynamicMetricColumn(match[1]);
        if (!column || !this.isLikelyDynamicMetricColumn(column)) continue;
        result[column] = values.slice(0, 8).join('；');
        break;
      }
    }

    return result;
  }

  private normalizeDynamicMetricColumn(candidate: string): string {
    let text = String(candidate || '')
      .replace(/[：:=]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) return '';

    text = text
      .replace(/\b(?:after|before|during|under|with|without|between|among|across|the|a|an|and|or|of|for|in|on|at|by|to|from)\b/gi, ' ')
      .replace(/\b(?:control|treatment|addition|quenching|sterilization|incubation|rewetting|drying|soil|sample|samples|group|groups|mean|means|average|total|relative|cumulative|significant|significantly)\b/gi, ' ')
      .replace(/\b(?:was|were|is|are|reached|ranged|averaged|increased|decreased|reduced|enhanced|declined|changed|accounted|contributed|showed|produced|emitted|accumulated)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const symbolMatch = text.match(/\b(?:[A-Za-z]+[0-9][A-Za-z0-9+−-]*|[A-Za-z]{2,}[A-Za-z0-9]*\([A-Za-z0-9]+\)|[A-Z]{2,}[A-Za-z0-9+−-]*)\b/);
    if (symbolMatch && /\d|[A-Z]{2,}/.test(symbolMatch[0])) {
      text = symbolMatch[0];
    } else {
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length > 6) text = tokens.slice(-6).join(' ');
    }

    text = text
      .replace(/\s+(?:accumulation|concentration|content|activity|activities|abundance|emission|emissions|flux|rate)$/i, match => match.trim().toLowerCase().includes('content') ? match : '')
      .replace(/^[,.;，。；、\s]+|[,.;，。；、\s]+$/g, '')
      .trim();

    if (text.length < 2 || text.length > 64) return '';
    if (/^(data|result|results|value|values|change|changes|effect|effects|difference|differences)$/i.test(text)) return '';
    return this.normalizeWideColumnName(text, '');
  }

  private isLikelyDynamicMetricColumn(column: string): boolean {
    const text = String(column || '').trim();
    if (!text || /^[0-9.]+$/.test(text)) return false;
    if (/^(?:bare|moss|cyan|cyan\/lich|nbt|pg|h2|pH2|no3|roughly|shade|desert|rainfall|financial support research|this solution slowly uniformly applied|147)$/i.test(text)) {
      return false;
    }
    if (/^(?:global land area|dryland ecosystems|annual temperature study area|rainfall\)|gas extracted using needle|subsequent determination enzyme|subsequent analyses microbial diversity|decreases oxidation|can be quenched methanol|moss soils|content component structure)$/i.test(text)) {
      return false;
    }

    const measurementPhrasePattern = /\b(?:content|concentration|activity|activities|abundance|expression|emission|emissions|flux|rate|yield|biomass|density|capacity|ratio|temperature|rainfall|precipitation|moisture|carbon|nitrogen|phosphorus|potassium|nitrate|ammonium|enzyme|gene|soil organic|available)\b/i;
    const chineseMetricPattern = /含量|浓度|活性|丰度|表达|产量|通量|排放|速率|密度|容量|比值|温度|降水|水分|有机碳|全氮|硝态氮|铵态氮|有效磷|速效钾|酶|基因|生物量/;
    const formulaPattern = /\b[A-Za-z]+[0-9][A-Za-z0-9+−-]*\b|[A-Z][a-z]?[0-9]/;
    return measurementPhrasePattern.test(text) || chineseMetricPattern.test(text) || formulaPattern.test(text);
  }

  private dedupeWideColumnNames(columns: string[]): string[] {
    const counts = new Map<string, number>();
    return columns.map((column, index) => {
      const base = this.normalizeWideColumnName(column, `列${index + 1}`);
      const count = counts.get(base) || 0;
      counts.set(base, count + 1);
      return count === 0 ? base : `${base}_${count + 1}`;
    });
  }

  private normalizeWideColumnName(value: unknown, fallback: string): string {
    return (this.stringifyTableCellValue(value) || fallback || '指标')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private formatWideMetaKey(key: string): string {
    const map: Record<string, string> = {
      name: '名称',
      latitude: '纬度',
      longitude: '经度',
      country: '国家',
      region: '区域',
      climate: '气候',
      sampling: '采样',
      rewetting_simulation: '复水模拟',
      replication: '重复',
      measurements: '测定指标',
      table_id: '表格ID',
      in_source_pdf: '是否在原PDF',
      needs_manual_review: '需人工核查',
    };
    return map[key] || key;
  }

  private extractNumericTextDataRows(text: string): string[] {
    const cleanText = this.normalizeExtractedText(text)
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleanText) return [];
    const sentences = cleanText
      .split(/(?<=[。！？.!?])\s+|[；;]/)
      .map(sentence => sentence.trim())
      .filter(sentence => sentence.length >= 20 && sentence.length <= 360);
    const dataPattern = /(?:\d+(?:\.\d+)?\s*(?:%|mg|g|kg|t|ha|m2|m\^2|cm|mm|mL|L|ppm|ppb|℃|°C|K|d|day|days|h|yr|year|years|mol|μmol|umol|nmol|pH|WFPS|SOC|TN|NH4|NO3|N2O|CO2|CH4)|(?:pH|WFPS|SOC|TN|NH4|NO3|N2O|CO2|CH4|organic carbon|soil organic|available phosphorus|available potassium|bulk density|microbial biomass|enzyme activity))/i;
    const blockedPattern = /\b(?:doi|references|bibliography|copyright|accepted|received|http|www\.)\b/i;
    const seen = new Set<string>();
    const result: string[] = [];
    for (const sentence of sentences) {
      if (!dataPattern.test(sentence) || blockedPattern.test(sentence)) continue;
      const key = this.normalizeForEvidenceMatching(sentence).slice(0, 220);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(sentence);
      if (result.length >= 200) break;
    }
    return result;
  }

  private arrayToTableRows(values: unknown[], preferredColumns: string[] = []): unknown[][] {
    if (values.length === 0) return [];
    if (values.every(item => Array.isArray(item))) {
      return values.map(item => (item as unknown[]).map(cell => cell ?? ''));
    }
    const records = values
      .map(item => this.asRecord(item))
      .filter(record => Object.keys(record).length > 0);
    if (records.length === 0) {
      return values.map(item => [this.stringifyMetaValue(item)]);
    }
    const columns = preferredColumns.length > 0
      ? preferredColumns
      : Array.from(new Set(records.flatMap(record => Object.keys(record))));
    return [
      columns,
      ...records.map(record => columns.map(column => record[column] ?? '')),
    ];
  }

  private async loadParsedMetaCache(
    userId: string,
    pdf: PdfWikiSourcePdf
  ): Promise<{
    parser?: PdfWikiSourcePdf['extractionParser'];
    metaData?: Record<string, unknown>;
    referenceCount?: number;
    textLength?: number;
    cachedAt?: string;
  } | null> {
    const dir = this.getParsedTextDir(userId);
    const safeId = this.getSafePdfCacheId(pdf);
    if (!fs.existsSync(dir)) return null;

    const metaFiles = fs.readdirSync(dir)
      .filter(name => name.endsWith('.json') && name.startsWith(`${safeId}.`))
      .sort((a, b) => {
        const score = (name: string): number => {
          if (name.includes('.codex.')) return 0;
          if (name.includes('.liteparse.')) return 1;
          if (name.includes('.marker.')) return 2;
          if (name.includes('.fast-text.')) return 3;
          if (name.includes('.textin.')) return 4;
          if (name.includes('.grobid.')) return 5;
          return 6;
        };
        return score(a) - score(b);
      })
      .map(name => path.join(dir, name));

    for (const metaPath of metaFiles) {
      try {
        const parsed = this.asRecord(JSON.parse(await fs.promises.readFile(metaPath, 'utf-8')));
        if (parsed.sourcePdfId && parsed.sourcePdfId !== pdf.id) continue;
        return {
          parser: this.firstString(parsed.parser) as PdfWikiSourcePdf['extractionParser'],
          metaData: this.asRecord(parsed.metaData),
          referenceCount: Number(parsed.referenceCount || 0),
          textLength: Number(parsed.textLength || 0),
          cachedAt: this.firstString(parsed.cachedAt),
        };
      } catch (error) {
        logger.warn(`[PdfWiki] Failed to read parsed meta cache ${metaPath}:`, error);
      }
    }

    return null;
  }

  private mergeMetaDataRecords(...records: Array<Record<string, unknown>>): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const record of records) {
      for (const [key, value] of Object.entries(record || {})) {
        if (this.isMeaningfulMetaValue(value)) {
          merged[key] = value;
        }
      }
    }
    return merged;
  }

  private removeUndefinedValues(record: Record<string, unknown>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (value !== undefined) cleaned[key] = value;
    }
    return cleaned;
  }

  private isMeaningfulMetaValue(value: unknown): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
    return true;
  }

  private toBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
      if (/^(true|1|yes|y|是|需要)$/i.test(value.trim())) return true;
      if (/^(false|0|no|n|否|不需要)$/i.test(value.trim())) return false;
    }
    return null;
  }

  private toDisplayStringArray(value: unknown): string[] {
    return this.firstArray(value)
      .map(item => this.stringifyMetaValue(item))
      .map(item => item.trim())
      .filter(Boolean);
  }

  private stringifyMetaValue(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      return value.map(item => this.stringifyMetaValue(item)).filter(Boolean).join('；');
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  private firstMetaValueString(...values: unknown[]): string {
    for (const value of values) {
      const text = this.stringifyMetaValue(value).trim();
      if (text && !/^(empty|none|null|n\/a|na|unknown|未知|无)$/i.test(text)) return text;
    }
    return '';
  }

  private extractCodexReferences(value: unknown, pdf: PdfWikiSourcePdf): PdfWikiReference[] {
    const referencesValue = this.findCodexArray(value, ['references', 'bibliography']);
    if (!referencesValue.length) return [];
    return referencesValue
      .slice(0, 300)
      .map((ref, index): PdfWikiReference | null => {
        if (typeof ref === 'string') {
          return this.parseReferenceDetails(ref, pdf.id, pdf.originalName, index);
        }
        if (!ref || typeof ref !== 'object') return null;
        const record = ref as Record<string, unknown>;
        const raw = this.firstString(record.raw, record.reference, record.citation, record.text, record.full_text, record.fullText);
        return this.normalizeReferenceFromPartial({
          raw,
          title: this.firstString(record.title, record.article_title),
          authors: this.formatCodexAuthors(record.authors || record.author),
          year: this.firstString(record.year, record.publication_year),
          journal: this.firstString(record.journal, record.source),
          doi: this.firstString(record.doi),
        }, pdf.id, pdf.originalName, index);
      })
      .filter((ref): ref is PdfWikiReference => !!ref);
  }

  private extractCodexClaims(value: unknown): ExtractedClaim[] {
    const rawClaims = this.findCodexArray(value, ['claims', 'pdf_wiki_claims', 'wikiClaims', 'arguments', 'entries']);
    return rawClaims
      .map((claim): ExtractedClaim | null => {
        if (!claim || typeof claim !== 'object') return null;
        const record = claim as Record<string, unknown>;
        const claimText = this.firstString(record.claim, record.argument, record.thesis, record.statement, record.title);
        if (!claimText) return null;
        return {
          claim: claimText,
          section: this.firstString(record.section, record.heading, record.chapter),
          location: this.firstString(record.location, record.pages, record.page, record.position),
          discussionPoint: this.firstString(record.discussionPoint, record.discussion_point, record.topic),
          proViews: this.firstArray(record.proViews, record.supportViews, record.support_views, record.support, record.pro),
          conViews: this.firstArray(record.conViews, record.opposeViews, record.limitationViews, record.con_views, record.opposition, record.con),
          neutralViews: this.firstArray(record.neutralViews, record.backgroundViews, record.neutral_views, record.background, record.neutral),
          evidence: this.firstString(record.evidence, record.quote, record.snippet),
          inTextCitations: this.toStringArray(record.inTextCitations || record.in_text_citations || record.citations),
          evidenceSentenceIds: this.toStringArray(record.evidenceSentenceIds || record.evidence_sentence_ids || record.sentenceIds || record.sentence_ids),
          referenceIndexes: this.toNumberArray(record.referenceIndexes || record.reference_indexes || record.references),
        };
      })
      .filter((claim): claim is ExtractedClaim => !!claim);
  }

  private findCodexArray(value: unknown, keys: string[]): unknown[] {
    if (Array.isArray(value)) return value;
    if (!value || typeof value !== 'object') return [];
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      const direct = record[key];
      if (Array.isArray(direct)) return direct;
    }
    for (const nestedKey of ['data', 'result', 'metadata', 'fulltext', 'full_text', 'pdfWiki']) {
      const nested = record[nestedKey];
      if (nested && typeof nested === 'object') {
        const found = this.findCodexArray(nested, keys);
        if (found.length) return found;
      }
    }
    return [];
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private firstString(...values: unknown[]): string {
    for (const value of values) {
      if (Array.isArray(value)) {
        const joined = value.map(item => typeof item === 'string' ? item : this.firstString((item as Record<string, unknown>)?.name)).filter(Boolean).join('; ');
        if (joined.trim()) return joined.trim();
        continue;
      }
      if (value === null || value === undefined) continue;
      const text = String(value).trim();
      if (text && !/^(empty|none|null|n\/a|na|unknown|未知|无)$/i.test(text)) return text;
    }
    return '';
  }

  private resolvePaperTitle(originalName: string, ...values: unknown[]): string {
    let fallback = '';
    for (const value of values) {
      const title = this.firstString(value);
      if (!title || this.isLikelyPdfFileName(title, originalName)) continue;
      if (!this.isWeakPdfTitleCandidate(title, originalName)) return title;
      if (!fallback && !/^(research article|review article|original article|article|abstract|keywords?|introduction|materials|methods|results|discussion|conclusions?|references)$/i.test(title)) {
        fallback = title;
      }
    }
    return fallback;
  }

  private isLikelyPdfFileName(value: string, originalName: string): boolean {
    const title = String(value || '').trim();
    if (!title) return false;
    const normalizedTitle = this.normalizeTitleLikeFileName(title);
    const fileBase = this.restoreOriginalName(path.basename(originalName || '')).replace(/\.pdf$/i, '').trim();
    const normalizedFileBase = this.normalizeTitleLikeFileName(fileBase);
    if (normalizedTitle && normalizedFileBase && normalizedTitle === normalizedFileBase) return true;
    if (/\.pdf$/i.test(title)) return true;
    if (/^10\.\d{4,9}\//i.test(title)) return true;
    const wordCount = title.split(/\s+/).filter(Boolean).length;
    const punctuationCount = (title.match(/[._/-]/g) || []).length;
    const digitCount = (title.match(/\d/g) || []).length;
    return wordCount <= 2 && punctuationCount >= 2 && digitCount >= 2;
  }

  private normalizeTitleLikeFileName(value: string): string {
    return String(value || '')
      .trim()
      .replace(/\.pdf$/i, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }

  private firstArray(...values: unknown[]): unknown[] {
    for (const value of values) {
      if (Array.isArray(value)) return value;
      if (typeof value === 'string' && value.trim()) return [value.trim()];
    }
    return [];
  }

  private toStringArray(value: unknown): string[] {
    if (Array.isArray(value)) return this.unique(value.map(item => String(item || '')));
    if (typeof value === 'string') {
      return this.unique(value.split(/[,;；，]\s*/).map(item => item.trim()));
    }
    return [];
  }

  private toNumberArray(value: unknown): number[] {
    const items = Array.isArray(value)
      ? value
      : (typeof value === 'string' ? value.split(/[,;；，\s]+/) : []);
    return items
      .map(item => Number(item))
      .filter(item => Number.isFinite(item) && item > 0);
  }

  private formatCodexAuthors(value: unknown): string {
    if (Array.isArray(value)) {
      return value.map(author => {
        if (typeof author === 'string') return author;
        if (!author || typeof author !== 'object') return '';
        const record = author as Record<string, unknown>;
        return this.firstString(record.name, record.fullName, record.full_name, [record.family, record.given].filter(Boolean).join(' '));
      }).filter(Boolean).join('; ');
    }
    return this.firstString(value);
  }

  private async loadDeepAnalysisCache(userId: string, pdfId: string): Promise<PdfWikiDeepAnalysisCache | null> {
    const cachePath = this.getDeepAnalysisPath(userId, pdfId);
    if (!fs.existsSync(cachePath)) return null;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(cachePath, 'utf-8')) as Partial<PdfWikiDeepAnalysisCache>;
      if (!parsed.summaryMarkdown || !parsed.pdfId) return null;
      return {
        pdfId: String(parsed.pdfId),
        parser: parsed.parser || 'textin',
        textLength: Number(parsed.textLength || 0),
        textPreview: String(parsed.textPreview || ''),
        metadata: parsed.metadata || {},
        referenceCount: Number(parsed.referenceCount || 0),
        summaryMarkdown: String(parsed.summaryMarkdown || ''),
        researchRelevanceMarkdown: String(parsed.researchRelevanceMarkdown || this.extractResearchRelevanceMarkdown(String(parsed.summaryMarkdown || '')) || ''),
        userResearchContext: this.normalizeDeepAnalysisUserResearchContext(parsed.userResearchContext),
        analysisEngine: parsed.analysisEngine === 'codex' || parsed.analysisEngine === 'api' || parsed.analysisEngine === 'secondary-api' || parsed.analysisEngine === 'local'
          ? parsed.analysisEngine
          : undefined,
        overviewDiagram: this.normalizeOverviewDiagram(parsed.overviewDiagram),
        usableItems: this.normalizeCachedDeepAnalysisEvidenceItems(parsed.usableItems),
        wikiSync: this.normalizeDeepAnalysisWikiSync(parsed.wikiSync),
        analyzedAt: String(parsed.analyzedAt || ''),
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read deep analysis cache for ${pdfId}:`, error);
      return null;
    }
  }

  private async saveDeepAnalysisCache(userId: string, result: PdfWikiDeepAnalysisResult): Promise<void> {
    const cachePath = this.getDeepAnalysisPath(userId, result.pdfId);
    await fs.promises.mkdir(path.dirname(cachePath), { recursive: true });
    const payload: PdfWikiDeepAnalysisCache = {
      pdfId: result.pdfId,
      parser: result.parser,
      textLength: result.textLength,
      textPreview: result.textPreview,
      metadata: result.metadata,
      referenceCount: result.referenceCount,
      summaryMarkdown: result.summaryMarkdown,
      researchRelevanceMarkdown: result.researchRelevanceMarkdown,
      userResearchContext: result.userResearchContext,
      analysisEngine: result.analysisEngine,
      overviewDiagram: this.normalizeOverviewDiagram(result.overviewDiagram),
      usableItems: this.normalizeCachedDeepAnalysisEvidenceItems(result.usableItems),
      wikiSync: this.normalizeDeepAnalysisWikiSync(result.wikiSync),
      analyzedAt: result.analyzedAt,
    };
    await fs.promises.writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf-8');
  }

  private async extractDeepAnalysisEvidenceDrafts(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent,
    summaryMarkdown: string,
    llmConfig: PdfWikiLlmConfig,
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis
  ): Promise<PdfWikiDeepAnalysisEvidenceDraft[]> {
    const prompt = `请把 PDF 深入分析整理成可写入句子级 Wiki 的研究证据 JSON。

只输出 JSON：
{
  "items": [
    {
      "claim": "单一、可引用的原子论点",
      "evidence": "必须逐字摘录下面 PDF 正文中的一至两句英文/中文原文",
      "category": "background|method|indicator|result-comparison|mechanism|meta-analysis|limitation",
      "researchUse": "结合用户研究上下文，说明在用户论文中如何使用",
      "supportScope": ["能够支持的对象、条件、变量或结论范围"],
      "limitations": ["不适用条件或不能外推的边界"],
      "keywords": ["3-8 个中英文关键词"],
      "section": "原文章节",
      "location": "页码/章节/图表位置",
      "confidence": 0.0
    }
  ]
}

硬性规则：
1. evidence 必须是 PDF 正文逐字原句，禁止把分析摘要或你的改写填入 evidence。
2. 没有可核验原句的条目不要输出；每条只表达一个原子论点。
3. 优先覆盖与用户研究直接相关的背景、方法、指标、结果对照、机制、Meta 可提取项和局限/边界。
4. category 只能使用给定枚举；confidence 为 0-1。
5. 不要猜参考文献编号，系统会根据 evidence 原句中的显式引用完成绑定。
6. 最多输出 30 条，宁缺毋滥。

PDF 元数据：
${JSON.stringify({
  title: pdf.title || parsed.metadata.title || pdf.originalName,
  authors: pdf.authors || parsed.metadata.authors || '',
  year: pdf.year || parsed.metadata.year || '',
  journal: pdf.journal || parsed.metadata.journal || '',
  doi: pdf.doi || parsed.metadata.doi || '',
}, null, 2)}

用户研究上下文：
${this.formatUserResearchContextForPrompt(userResearchContext)}

已生成的深入分析：
${this.compactPromptText(summaryMarkdown, 18000)}

PDF 正文：
${this.compactPromptText(this.stripReferenceTail(parsed.text), 70000)}`;
    const normalized = await this.callJsonNormalizer(llmConfig, prompt, 7000, 'deep-analysis-wiki-evidence');
    return (Array.isArray(normalized.items) ? normalized.items : [])
      .filter(item => item && typeof item === 'object') as PdfWikiDeepAnalysisEvidenceDraft[];
  }

  private buildDeepAnalysisEvidenceItems(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent | null,
    summaryMarkdown: string,
    drafts: PdfWikiDeepAnalysisEvidenceDraft[],
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis
  ): PdfWikiDeepAnalysisEvidenceItem[] {
    const referencePool = parsed?.references || pdf.referenceIndex || [];
    const bodyText = parsed?.text ? this.stripReferenceTail(parsed.text) : '';
    const sentenceEvidence = bodyText
      ? this.sentenceEvidenceMapFromMatches(
        'FullText',
        this.matchSectionSentencesToReferences('FullText', bodyText, referencePool, pdf.id, 1800)
      )
      : new Map<string, PdfWikiSentenceEvidence>();
    const sourcePdf = this.toDeepAnalysisSourceMetadata(pdf);
    const normalizedDrafts = drafts.length > 0
      ? drafts
      : this.extractDeepAnalysisDraftsFromMarkdown(summaryMarkdown);
    const items: PdfWikiDeepAnalysisEvidenceItem[] = [];
    const seen = new Set<string>();

    for (const draft of normalizedDrafts.slice(0, 60)) {
      const claim = this.cleanDeepAnalysisItemText(draft.claim, 900);
      const rawEvidence = this.cleanDeepAnalysisItemText(draft.evidence, 2400);
      if (!claim || !rawEvidence || sentenceEvidence.size === 0) continue;
      const resolvedEvidence = this.resolveEvidenceSentences(
        this.toStringArray(draft.evidenceSentenceIds),
        rawEvidence,
        sentenceEvidence
      );
      if (resolvedEvidence.length === 0) {
        logger.warn(`[PdfWiki] Dropped deep-analysis item without a verifiable PDF sentence: ${claim.slice(0, 120)} (${pdf.originalName})`);
        continue;
      }

      const evidence = this.unique(resolvedEvidence.map(item => item.sentence)).join(' ');
      const fingerprint = this.normalizeForEvidenceMatching(`${claim}|${evidence}`);
      if (!fingerprint || seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      const category = this.normalizeDeepAnalysisResearchUseCategory(draft.category, `${claim} ${draft.researchUse || ''}`);
      const boundReferences = this.uniqueReferences(resolvedEvidence.flatMap(item => item.references))
        .filter(reference => this.isReferenceBackedReference(reference));
      if (boundReferences.length === 0) {
        logger.warn(`[PdfWiki] Dropped deep-analysis item without a matched reference: ${claim.slice(0, 120)} (${pdf.originalName})`);
        continue;
      }
      const evidenceSentenceIds = this.unique(resolvedEvidence.map(item => item.id));
      const inTextCitations = this.unique(resolvedEvidence.flatMap(item => item.citations));
      const researchUse = this.cleanDeepAnalysisItemText(draft.researchUse, 1000)
        || this.defaultDeepAnalysisResearchUse(category);
      const supportScope = this.normalizeDeepAnalysisTextArray(draft.supportScope, 8, 260);
      const limitations = this.normalizeDeepAnalysisTextArray(draft.limitations, 8, 260);
      const keywords = this.normalizeDeepAnalysisTextArray(draft.keywords, 12, 80);
      const section = this.cleanDeepAnalysisItemText(draft.section, 120)
        || resolvedEvidence[0]?.sectionName
        || 'FullText';
      const location = this.cleanDeepAnalysisItemText(draft.location, 180)
        || evidenceSentenceIds.join(', ');
      const hash = crypto.createHash('sha256')
        .update(`${pdf.id}|${category}|${claim}|${evidence}`)
        .digest('hex')
        .slice(0, 20);

      items.push({
        id: `pdfwiki_deep_${hash}`,
        claim,
        evidence,
        category,
        researchUse,
        supportScope: supportScope.length > 0 ? supportScope : [this.defaultDeepAnalysisSupportScope(category)],
        limitations,
        keywords,
        section,
        location,
        confidence: this.clampDeepAnalysisConfidence(draft.confidence),
        evidenceSentenceIds,
        inTextCitations,
        referenceIndexes: boundReferences
          .filter(ref => !ref.fallbackSourcePdf && Number.isFinite(ref.index))
          .map(ref => Number(ref.index)),
        references: boundReferences,
        sourcePdf,
        researchContextKeys: [...userResearchContext.sourceKeys],
      });
    }

    return items.slice(0, 40);
  }

  private async syncDeepAnalysisEvidenceToWiki(
    userId: string,
    store: PdfWikiStore,
    pdf: PdfWikiSourcePdf,
    items: PdfWikiDeepAnalysisEvidenceItem[],
    vectorConfig?: PdfWikiVectorConfig
  ): Promise<PdfWikiDeepAnalysisWikiSync> {
    const syncedAt = new Date().toISOString();
    if (items.length === 0) {
      return {
        status: 'error',
        itemCount: 0,
        entryIds: [],
        embeddedCount: 0,
        embeddingStatus: vectorConfig?.apiUrl && vectorConfig.apiKey ? 'error' : 'unconfigured',
        syncedAt,
        warning: '没有找到同时具备“可用论点 + PDF 原文证据句 + 可核验参考文献”的条目，未覆盖 Wiki 中已有结果。',
      };
    }

    const entries = items.map(item => this.deepAnalysisEvidenceItemToEntry(item, pdf));
    store.entries = [
      ...store.entries.filter(entry => !(entry.origin === 'deep-analysis' && entry.sourcePdfIds.includes(pdf.id))),
      ...entries,
    ];
    await this.persistManualStoreUpdate(
      userId,
      store,
      `PDF 深入分析已同步 ${entries.length} 个可用研究条目到 Wiki论点库`
    );

    if (!vectorConfig?.apiUrl || !vectorConfig.apiKey) {
      return {
        status: 'unconfigured',
        itemCount: entries.length,
        entryIds: entries.map(entry => entry.id),
        embeddedCount: 0,
        embeddingStatus: 'unconfigured',
        syncedAt,
        warning: '条目已写入 Wiki；当前未配置 Embedding API，将先使用 BM25，配置后检索时可补齐向量。',
      };
    }

    try {
      const engine = await this.getEngine(userId, vectorConfig);
      const embedding = await engine.prepareDocumentEmbeddings(entries.map(entry => entry.id));
      const complete = embedding.embeddedCount === entries.length;
      return {
        status: complete ? 'completed' : 'partial',
        itemCount: entries.length,
        entryIds: entries.map(entry => entry.id),
        embeddedCount: embedding.embeddedCount,
        embeddingStatus: complete ? 'ready' : (embedding.embeddedCount > 0 ? 'partial' : 'error'),
        syncedAt,
        warning: complete ? undefined : `已写入 Wiki，但仅完成 ${embedding.embeddedCount}/${entries.length} 条向量化。`,
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to prepare deep-analysis embeddings for ${pdf.originalName}:`, error);
      return {
        status: 'partial',
        itemCount: entries.length,
        entryIds: entries.map(entry => entry.id),
        embeddedCount: 0,
        embeddingStatus: 'error',
        syncedAt,
        warning: `条目已写入 Wiki，但增量 Embedding 失败：${this.getErrorMessage(error)}`,
      };
    }
  }

  private deepAnalysisEvidenceItemToEntry(
    item: PdfWikiDeepAnalysisEvidenceItem,
    pdf: PdfWikiSourcePdf
  ): PdfWikiEntry {
    const stance: PdfWikiViewpoint['stance'] = item.category === 'limitation' ? 'neutral' : 'support';
    const viewpoint: PdfWikiViewpoint = {
      stance,
      summary: item.claim,
      evidence: item.evidence,
      section: item.section,
      location: item.location,
      inTextCitations: [...item.inTextCitations],
      evidenceSentenceIds: [...item.evidenceSentenceIds],
      evidenceSentences: [item.evidence],
      references: item.references,
      sourcePdfId: pdf.id,
      sourcePdfName: pdf.originalName,
    };
    return {
      id: item.id,
      groupId: `deep_group_${item.id.replace(/^pdfwiki_deep_/, '')}`,
      claim: item.claim,
      normalizedClaim: item.claim,
      displayClaimZh: this.isMostlyChinese(item.claim) ? item.claim : undefined,
      sourceEntryIds: [item.id],
      sourcePdfIds: [pdf.id],
      sourcePdfNames: [pdf.originalName],
      sections: [item.section],
      pro: stance === 'support' ? [viewpoint] : [],
      con: [],
      neutral: stance === 'neutral' ? [viewpoint] : [],
      inTextCitations: [...item.inTextCitations],
      evidenceSentenceIds: [...item.evidenceSentenceIds],
      references: item.references,
      evidenceSnippets: [item.evidence],
      sourceEntries: [{
        id: item.id,
        claim: item.claim,
        normalizedClaim: item.claim,
        displayClaimZh: this.isMostlyChinese(item.claim) ? item.claim : undefined,
        sourcePdfIds: [pdf.id],
        sourcePdfNames: [pdf.originalName],
        sections: [item.section],
        proCount: stance === 'support' ? 1 : 0,
        conCount: 0,
        neutralCount: stance === 'neutral' ? 1 : 0,
        evidenceSnippets: [item.evidence],
      }],
      origin: 'deep-analysis',
      researchUseCategory: item.category,
      researchUse: item.researchUse,
      supportScope: [...item.supportScope],
      limitations: [...item.limitations],
      researchContextKeys: [...item.researchContextKeys],
      confidence: item.confidence,
      sourcePdfMetadata: item.sourcePdf,
      updatedAt: new Date().toISOString(),
    };
  }

  private async backfillDeepAnalysisWikiSync(
    userId: string,
    store: PdfWikiStore,
    pdf: PdfWikiSourcePdf,
    cached: PdfWikiDeepAnalysisCache,
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis,
    vectorConfig?: PdfWikiVectorConfig
  ): Promise<PdfWikiDeepAnalysisCache> {
    const parsed = await this.loadParsedTextCache(userId, pdf).catch(() => null);
    const existingDrafts = store.entries
      .filter(entry => entry.sourcePdfIds.includes(pdf.id) && entry.origin !== 'deep-analysis')
      .slice(0, 40)
      .map(entry => ({
        claim: entry.displayClaimZh || entry.normalizedClaim || entry.claim,
        evidence: entry.evidenceSnippets[0] || entry.pro[0]?.evidence || entry.neutral[0]?.evidence || '',
        category: this.normalizeDeepAnalysisResearchUseCategory(undefined, `${entry.sections.join(' ')} ${entry.claim}`),
        researchUse: this.defaultDeepAnalysisResearchUse(
          this.normalizeDeepAnalysisResearchUseCategory(undefined, `${entry.sections.join(' ')} ${entry.claim}`)
        ),
        supportScope: entry.sections,
        limitations: [],
        keywords: entry.inTextCitations,
        section: entry.sections[0] || 'FullText',
        location: entry.pro[0]?.location || entry.neutral[0]?.location || '',
        confidence: 0.72,
        evidenceSentenceIds: entry.evidenceSentenceIds || [],
      }));
    const usableItems = this.buildDeepAnalysisEvidenceItems(
      pdf,
      parsed,
      cached.summaryMarkdown,
      existingDrafts,
      userResearchContext
    );
    const wikiSync = await this.syncDeepAnalysisEvidenceToWiki(userId, store, pdf, usableItems, vectorConfig);
    const upgraded: PdfWikiDeepAnalysisCache = { ...cached, usableItems, wikiSync };
    await this.saveDeepAnalysisCache(userId, { ...upgraded, pdf });
    return upgraded;
  }

  private extractDeepAnalysisDraftsFromMarkdown(markdown: string): PdfWikiDeepAnalysisEvidenceDraft[] {
    const text = String(markdown || '').replace(/\r/g, '\n');
    const drafts: PdfWikiDeepAnalysisEvidenceDraft[] = [];
    let heading = '';
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const headingMatch = /^#{1,5}\s+(.+)$/.exec(line);
      if (headingMatch) {
        heading = headingMatch[1].trim();
        continue;
      }
      const bullet = line.match(/^(?:[-*+]\s+|\d+[.)、]\s+)(.+)$/)?.[1]?.trim();
      if (!bullet || bullet.length < 24) continue;
      const category = this.normalizeDeepAnalysisResearchUseCategory(undefined, `${heading} ${bullet}`);
      drafts.push({
        claim: this.stripDeepAnalysisMarkdown(bullet),
        evidence: this.extractQuotedDeepAnalysisEvidence(bullet),
        category,
        researchUse: heading.includes('用户') || heading.includes('研究') ? bullet : this.defaultDeepAnalysisResearchUse(category),
        supportScope: [heading].filter(Boolean),
        limitations: category === 'limitation' ? [bullet] : [],
        keywords: [],
        section: heading,
        confidence: 0.62,
      });
    }
    return drafts;
  }

  private extractQuotedDeepAnalysisEvidence(value: string): string {
    const text = String(value || '');
    const matches = Array.from(text.matchAll(/[“\"]([^”\"]{24,1200})[”\"]/g));
    return matches.map(match => match[1].trim()).sort((a, b) => b.length - a.length)[0] || '';
  }

  private normalizeDeepAnalysisResearchUseCategory(value: unknown, fallbackText = ''): PdfWikiResearchUseCategory {
    const raw = String(value || '').trim().toLowerCase();
    const allowed: PdfWikiResearchUseCategory[] = [
      'background', 'method', 'indicator', 'result-comparison', 'mechanism', 'meta-analysis', 'limitation',
    ];
    if (allowed.includes(raw as PdfWikiResearchUseCategory)) return raw as PdfWikiResearchUseCategory;
    const text = `${raw} ${fallbackText}`.toLowerCase();
    if (/局限|边界|限制|反证|limitation|boundary|caution/.test(text)) return 'limitation';
    if (/meta|效应量|均值|标准差|样本量|effect size|sample size/.test(text)) return 'meta-analysis';
    if (/机制|途径|调控|解释|mechanis|pathway|mediator/.test(text)) return 'mechanism';
    if (/结果|发现|对照|比较|响应|result|finding|comparison|response/.test(text)) return 'result-comparison';
    if (/指标|变量|测定|测量|indicator|variable|measurement/.test(text)) return 'indicator';
    if (/方法|设计|处理|采样|统计|method|design|treatment|sampling/.test(text)) return 'method';
    return 'background';
  }

  private defaultDeepAnalysisResearchUse(category: PdfWikiResearchUseCategory): string {
    const uses: Record<PdfWikiResearchUseCategory, string> = {
      background: '用于研究背景、问题提出或研究必要性的证据支撑。',
      method: '用于实验设计、处理设置、采样或分析方法的参照。',
      indicator: '用于指标选择、变量定义或测定方法的参照。',
      'result-comparison': '用于结果段的横向比较或讨论段的异同分析。',
      mechanism: '用于解释结果背后的过程、路径或调控机制。',
      'meta-analysis': '用于 Meta 分析候选数据项及其提取条件的复核。',
      limitation: '用于限定结论外推范围、说明反证或讨论研究局限。',
    };
    return uses[category];
  }

  private defaultDeepAnalysisSupportScope(category: PdfWikiResearchUseCategory): string {
    const scopes: Record<PdfWikiResearchUseCategory, string> = {
      background: '仅支持原文明确涉及的研究对象和问题背景',
      method: '仅支持原文实际采用的方法、处理和实验条件',
      indicator: '仅支持原文定义或测定的指标与变量',
      'result-comparison': '仅支持原文样本、处理和时空条件下的结果比较',
      mechanism: '仅支持原文证据能够直接说明的机制链路',
      'meta-analysis': '仅支持原文可核验且单位、组别明确的数据项',
      limitation: '用于约束结论边界，不应被改写为正向因果证据',
    };
    return scopes[category];
  }

  private normalizeDeepAnalysisTextArray(value: unknown, maxItems: number, maxChars: number): string[] {
    const values = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[\n;；]+/) : []);
    return this.unique(values
      .map(item => this.cleanDeepAnalysisItemText(item, maxChars))
      .filter(Boolean))
      .slice(0, maxItems);
  }

  private cleanDeepAnalysisItemText(value: unknown, maxChars: number): string {
    return this.stripDeepAnalysisMarkdown(String(value || ''))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxChars);
  }

  private stripDeepAnalysisMarkdown(value: string): string {
    return String(value || '')
      .replace(/^#{1,6}\s+/, '')
      .replace(/^(?:[-*+]\s+|\d+[.)、]\s+)/, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .trim();
  }

  private clampDeepAnalysisConfidence(value: unknown): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0.75;
    return Math.max(0, Math.min(1, numeric));
  }

  private toDeepAnalysisSourceMetadata(pdf: PdfWikiSourcePdf): PdfWikiDeepAnalysisSourceMetadata {
    return {
      pdfId: pdf.id,
      originalName: pdf.originalName,
      title: pdf.title,
      authors: pdf.authors,
      year: pdf.year,
      journal: pdf.journal,
      doi: pdf.doi,
    };
  }

  private normalizeCachedDeepAnalysisEvidenceItems(value: unknown): PdfWikiDeepAnalysisEvidenceItem[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter(item => item && typeof item === 'object') as PdfWikiDeepAnalysisEvidenceItem[];
    return items.length > 0 ? items : [];
  }

  private normalizeDeepAnalysisWikiSync(value: unknown): PdfWikiDeepAnalysisWikiSync | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Partial<PdfWikiDeepAnalysisWikiSync>;
    const status = record.status === 'completed' || record.status === 'partial' || record.status === 'unconfigured' || record.status === 'error'
      ? record.status
      : 'error';
    const embeddingStatus = record.embeddingStatus === 'ready' || record.embeddingStatus === 'partial' || record.embeddingStatus === 'unconfigured' || record.embeddingStatus === 'error'
      ? record.embeddingStatus
      : 'error';
    return {
      status,
      itemCount: Math.max(0, Number(record.itemCount || 0)),
      entryIds: this.toStringArray(record.entryIds),
      embeddedCount: Math.max(0, Number(record.embeddedCount || 0)),
      embeddingStatus,
      syncedAt: String(record.syncedAt || new Date(0).toISOString()),
      warning: record.warning ? String(record.warning) : undefined,
    };
  }

  private async loadUserResearchContextForDeepAnalysis(userId: string): Promise<PdfWikiUserResearchContextForDeepAnalysis> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const candidateUserIds = Array.from(new Set([safeUserId, safeUserId === 'web-user' ? '' : 'web-user'].filter(Boolean)));
    for (const candidateUserId of candidateUserIds) {
      const memoryPath = path.join(this.dataDir, 'memory', candidateUserId, 'memory.json');
      if (!fs.existsSync(memoryPath)) continue;
      try {
        const parsed = JSON.parse(await fs.promises.readFile(memoryPath, 'utf-8')) as {
          entries?: Array<{ key?: unknown; value?: unknown }>;
          updatedAt?: unknown;
        };
        const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
        const entryByKey = new Map<string, string>();
        for (const entry of entries) {
          const key = String(entry.key || '').trim();
          const value = String(entry.value || '').trim();
          if (key && value) entryByKey.set(key, value);
        }
        const experimentEntry = this.pickMemoryEntry(entryByKey, ['experiment_summary_structured', 'experiment_summary']);
        const dataEntry = this.pickMemoryEntry(entryByKey, ['data_summary_structured', 'data_summary']);
        const experimentSummary = this.compactPromptText(experimentEntry.value, 14000);
        const dataSummary = this.compactPromptText(dataEntry.value, 14000);
        const sourceKeys = [experimentEntry.key, dataEntry.key].filter(Boolean);
        if (experimentSummary || dataSummary) {
          return {
            hasContext: true,
            experimentSummary,
            dataSummary,
            sourceKeys,
            memoryUpdatedAt: String(parsed.updatedAt || ''),
          };
        }
      } catch (error) {
        logger.warn(`[PdfWiki] Failed to read user research memory for deep analysis (${candidateUserId}):`, error);
      }
    }

    return {
      hasContext: false,
      experimentSummary: '',
      dataSummary: '',
      sourceKeys: [],
    };
  }

  private pickMemoryEntry(entryByKey: Map<string, string>, keys: string[]): { key: string; value: string } {
    for (const key of keys) {
      const value = entryByKey.get(key);
      if (value) return { key, value };
    }
    return { key: '', value: '' };
  }

  private formatUserResearchContextForPrompt(context: PdfWikiUserResearchContextForDeepAnalysis): string {
    if (!context.hasContext) {
      return [
        '未检测到可用的用户研究上下文。',
        '请在“与用户现有研究的关系”中说明：当前跨会话长期记忆里缺少试验资料总结或试验数据总结，因此只能给出通用写作支撑建议，不能推断用户实验细节。',
      ].join('\n');
    }
    return [
      `来源长期记忆键：${context.sourceKeys.length ? context.sourceKeys.join('、') : '未记录'}`,
      context.memoryUpdatedAt ? `长期记忆更新时间：${context.memoryUpdatedAt}` : '',
      '',
      '## 试验资料总结',
      context.experimentSummary || '未提供。',
      '',
      '## 试验数据总结',
      context.dataSummary || '未提供。',
    ].filter(line => line !== '').join('\n');
  }

  private toDeepAnalysisUserResearchContextSummary(context: PdfWikiUserResearchContextForDeepAnalysis): PdfWikiDeepAnalysisCache['userResearchContext'] {
    return {
      hasContext: context.hasContext,
      sourceKeys: context.sourceKeys,
      memoryUpdatedAt: context.memoryUpdatedAt,
      experimentSummaryChars: context.experimentSummary.length,
      dataSummaryChars: context.dataSummary.length,
    };
  }

  private normalizeDeepAnalysisUserResearchContext(value: unknown): PdfWikiDeepAnalysisCache['userResearchContext'] | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    return {
      hasContext: record.hasContext === true || String(record.hasContext || '').toLowerCase() === 'true',
      sourceKeys: this.firstArray(record.sourceKeys).map(item => String(item || '').trim()).filter(Boolean),
      memoryUpdatedAt: this.firstString(record.memoryUpdatedAt),
      experimentSummaryChars: Number(record.experimentSummaryChars || 0),
      dataSummaryChars: Number(record.dataSummaryChars || 0),
    };
  }

  private extractResearchRelevanceMarkdown(summaryMarkdown: string): string {
    return this.extractDeepAnalysisSection(summaryMarkdown, ['与用户现有研究的关系', '与我的研究的关系', '与用户研究的关系', '用户研究相关性']);
  }

  private buildLocalResearchRelevanceMarkdown(context: PdfWikiUserResearchContextForDeepAnalysis): string {
    if (!context.hasContext) {
      return [
        '当前没有读取到跨会话长期记忆中的“试验资料总结”或“试验数据总结”。',
        '',
        '- 研究背景/问题依据：可结合本文核心问题判断是否能作为背景文献，但需要用户补充自己的研究主题后再精确匹配。',
        '- 方法与实验设计参照：可人工核对本文方法是否与用户实验相近；当前缺少用户实验设计细节，不能自动判断。',
        '- 结果对照与讨论支撑：可作为通用讨论候选文献；当前缺少用户结果摘要，不能判断是否支持具体结果。',
        '- 局限/反证/边界条件：需要结合用户实验材料、处理和数据范围人工复核。',
      ].join('\n');
    }

    return [
      '本地兜底判断：已读取用户长期记忆中的试验资料总结和/或试验数据总结；以下为保守匹配建议，具体证据仍需以 PDF 原文和深入分析文本为准。',
      '',
      `- 研究背景/问题依据：可将本文核心问题与用户试验资料中的研究对象、处理设置和目标问题进行对照；若主题一致，可作为引言背景或问题提出依据。`,
      `- 方法与实验设计参照：可比较本文的材料、处理、采样和统计方法是否与用户试验资料总结一致；一致处可写入方法合理性或设计参照。`,
      `- 指标/变量/测定方法参照：可核对本文指标与用户数据总结中的变量是否重叠；重叠指标适合用于指标解释、单位换算或测定方法说明。`,
      `- 结果对照与讨论支撑：可把本文主要发现与用户数据总结中的趋势、显著性和异常结果对照；方向一致时作为支持证据，方向不同则作为讨论差异原因的文献。`,
      `- 机制解释：如果本文提供机制链条，可用于解释用户结果背后的土壤、作物、养分、微生物或管理措施机制。`,
      `- Meta分析数据提取参考：若本文含可提取的均值、标准差、样本量、处理组和对照组，可进入 Meta 分析候选；需要人工复核图表数值。`,
      `- 局限/反证/边界条件：如果本文的地区、作物、土壤、处理或尺度与用户研究不同，应作为外推限制写清。`,
    ].join('\n');
  }

  private normalizeExtractedText(text: string): string {
    return String(text || '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
  }

  private async extractPdfContent(userId: string, pdf: PdfWikiSourcePdf, llmConfig?: PdfWikiLlmConfig): Promise<PdfWikiParsedContent> {
    const engine = llmConfig ? this.getTextExtractionEngine(llmConfig) : 'auto';
    const allowExternalMetadata = !llmConfig || this.getMetadataEngine(llmConfig) !== 'local';
    if (engine === 'liteparse' && isLiteParseAvailable()) {
      const liteParse = await this.tryExtractPdfWithLiteParse(userId, pdf, allowExternalMetadata);
      if (liteParse) return liteParse;
    }
    if (engine === 'marker' && isPdfMarkerAvailable()) {
      const marker = await this.tryExtractPdfWithMarker(userId, pdf, allowExternalMetadata);
      if (marker) return marker;
    }
    if (engine === 'fast-text' && isPdfFastTextAvailable()) {
      const fastText = await this.tryExtractPdfWithFastText(userId, pdf, allowExternalMetadata);
      if (fastText) return fastText;
    }
    if (['liteparse', 'marker', 'fast-text', 'pdf-parse'].includes(engine)) {
      return this.extractPdfWithPdfParse(userId, pdf, allowExternalMetadata);
    }

    const textIn = llmConfig ? await this.tryExtractPdfWithTextIn(userId, pdf, llmConfig) : null;
    if (textIn) return textIn;

    const grobid = await this.tryExtractPdfWithGrobid(pdf);
    if (grobid) return grobid;

    return {
      text: await this.extractPdfTextWithPdfParse(pdf.filePath),
      metadata: {},
      references: [],
      parser: 'pdf-parse',
    };
  }

  private async extractPdfWithPdfParse(
    userId: string,
    pdf: PdfWikiSourcePdf,
    allowExternalMetadata = true
  ): Promise<PdfWikiParsedContent> {
    const text = this.normalizeExtractedText(await this.extractPdfTextWithPdfParse(pdf.filePath));
    const references = this.parseReferences(text, pdf.id, pdf.originalName);
    const inferredMetadata = this.cleanSourceMetadata(this.inferSourceMetadata(pdf.originalName, text));
    const metadata = allowExternalMetadata
      ? await this.enrichSourceMetadataWithDoi(inferredMetadata, text, pdf.originalName)
      : inferredMetadata;
    await this.saveParsedTextCache(userId, pdf, {
      parser: 'pdf-parse',
      markdown: text,
      text,
      references,
      metadata,
    });
    return {
      text,
      metadata,
      references,
      parser: 'pdf-parse',
    };
  }

  private async tryExtractPdfWithGrobid(pdf: PdfWikiSourcePdf): Promise<PdfWikiParsedContent | null> {
    const grobidUrl = this.getGrobidUrl();
    if (!grobidUrl) return null;

    const endpoint = `${grobidUrl.replace(/\/+$/, '')}/api/processFulltextDocument`;
    const buffer = await fs.promises.readFile(pdf.filePath);
    const form = new FormData();
    form.append('input', new Blob([buffer as any], { type: 'application/pdf' }), pdf.originalName || pdf.fileName);
    form.append('consolidateHeader', '1');
    form.append('consolidateCitations', '1');
    form.append('includeRawCitations', '1');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getGrobidTimeoutMs());

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        body: form as any,
        signal: controller.signal,
      });
      const tei = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${tei.slice(0, 240)}`);
      }

      const parsed = this.parseGrobidTei(tei, pdf);
      if (!parsed.text) {
        throw new Error('GROBID 返回的 TEI 中没有可用正文');
      }

      logger.info(`[PdfWiki] Parsed ${pdf.originalName} with GROBID: text=${parsed.text.length}, refs=${parsed.references.length}`);
      return parsed;
    } catch (error) {
      const message = error instanceof Error && error.name === 'AbortError'
        ? `GROBID 请求超时（${this.getGrobidTimeoutMs()}ms）`
        : (error as Error).message;
      logger.warn(`[PdfWiki] GROBID parse failed for ${pdf.originalName}, falling back to pdf-parse: ${message}`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private getGrobidUrl(): string {
    if (/^(false|0|off)$/i.test(String(process.env.GROBID_ENABLED || ''))) {
      return '';
    }
    if (String(process.env.PDF_PREPROCESSOR || '').toLowerCase() === 'pdf-parse') {
      return '';
    }
    return String(process.env.GROBID_URL || process.env.PDF_GROBID_URL || '').trim();
  }

  private getGrobidTimeoutMs(): number {
    const parsed = Number(process.env.GROBID_TIMEOUT_MS || 60000);
    return Number.isFinite(parsed) && parsed > 1000 ? parsed : 60000;
  }

  private async extractPdfTextWithPdfParse(filePath: string): Promise<string> {
    const buffer = await fs.promises.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = String(result.text || '').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) {
        throw new Error('PDF 文本为空，可能是扫描件或加密 PDF');
      }
      return text;
    } finally {
      await parser.destroy();
    }
  }

  private parseGrobidTei(tei: string, pdf: PdfWikiSourcePdf): PdfWikiParsedContent {
    const sourceDesc = this.extractFirstXmlTag(tei, 'sourceDesc') || tei;
    const headerBibl = this.extractFirstXmlTag(sourceDesc, 'biblStruct') || sourceDesc;
    const analytic = this.extractFirstXmlTag(headerBibl, 'analytic') || headerBibl;
    const monogr = this.extractFirstXmlTag(headerBibl, 'monogr') || '';
    const body = this.extractFirstXmlTag(tei, 'body') || '';
    const title = this.xmlText(
      this.extractFirstXmlTag(analytic, 'title', /\blevel=["']a["']/i)
      || this.extractFirstXmlTag(headerBibl, 'title', /\btype=["']main["']/i)
      || this.extractFirstXmlTag(analytic, 'title')
      || this.extractFirstXmlTag(headerBibl, 'title')
      || ''
    );
    const journal = this.xmlText(
      this.extractFirstXmlTag(monogr, 'title', /\blevel=["']j["']/i)
      || this.extractFirstXmlTag(monogr, 'title', /\blevel=["']m["']/i)
      || this.extractFirstXmlTag(monogr, 'title')
      || ''
    );
    const authors = this.parseTeiAuthors(analytic).join('; ');
    const metadata = this.cleanSourceMetadata({
      title,
      authors,
      year: this.extractTeiYear(headerBibl),
      journal,
      doi: this.extractTeiIdno(headerBibl, 'DOI'),
    });

    return {
      text: this.teiBodyToText(body),
      metadata,
      references: this.parseGrobidReferences(tei, pdf.id, pdf.originalName),
      parser: 'grobid',
    };
  }

  private parseGrobidReferences(tei: string, sourcePdfId: string, sourcePdfName: string): PdfWikiReference[] {
    const listBibl = this.extractFirstXmlTag(tei, 'listBibl');
    if (!listBibl) return [];

    return this.extractAllXmlTags(listBibl, 'biblStruct').slice(0, 300).map((bibl, index) => {
      const analytic = this.extractFirstXmlTag(bibl, 'analytic') || bibl;
      const monogr = this.extractFirstXmlTag(bibl, 'monogr') || '';
      const raw = this.xmlText(this.extractFirstXmlTag(bibl, 'note', /\btype=["']raw_reference["']/i) || bibl);
      const title = this.xmlText(
        this.extractFirstXmlTag(analytic, 'title', /\blevel=["']a["']/i)
        || this.extractFirstXmlTag(analytic, 'title')
        || ''
      );
      const journal = this.xmlText(
        this.extractFirstXmlTag(monogr, 'title', /\blevel=["']j["']/i)
        || this.extractFirstXmlTag(monogr, 'title', /\blevel=["']m["']/i)
        || this.extractFirstXmlTag(monogr, 'title')
        || ''
      );
      const id = crypto.createHash('md5').update(`${sourcePdfId}:grobid:${index}:${raw || title}`).digest('hex').slice(0, 16);

      return {
        id: `ref_${id}`,
        raw: raw || [this.parseTeiAuthors(analytic).join('; '), this.extractTeiYear(bibl), title, journal].filter(Boolean).join('. '),
        sourcePdfId,
        sourcePdfName,
        index: index + 1,
        title: title || undefined,
        authors: this.parseTeiAuthors(analytic).join('; ') || undefined,
        year: this.extractTeiYear(bibl) || undefined,
        journal: journal || undefined,
        doi: this.normalizeDoi(this.extractTeiIdno(bibl, 'DOI') || '') || undefined,
      };
    }).filter(ref => ref.raw);
  }

  private teiBodyToText(bodyXml: string): string {
    const withoutNonBody = bodyXml
      .replace(/<listBibl\b[\s\S]*?<\/listBibl>/gi, ' ')
      .replace(/<figure\b[\s\S]*?<\/figure>/gi, ' ')
      .replace(/<table\b[\s\S]*?<\/table>/gi, ' ')
      .replace(/<note\b[\s\S]*?<\/note>/gi, ' ');
    const sectioned = withoutNonBody
      .replace(/<head\b[^>]*>([\s\S]*?)<\/head>/gi, '\n\n$1\n')
      .replace(/<\/(p|div|body)>/gi, '\n\n')
      .replace(/<lb\s*\/?>/gi, '\n');
    return this.decodeXmlEntities(sectioned.replace(/<[^>]+>/g, ' '))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  private parseTeiAuthors(xml: string): string[] {
    const authors = this.extractAllXmlTags(xml, 'author').map(authorXml => {
      const forenames = this.extractAllXmlTags(authorXml, 'forename')
        .map(name => this.xmlText(name))
        .filter(Boolean)
        .join(' ');
      const surname = this.xmlText(this.extractFirstXmlTag(authorXml, 'surname') || '');
      const persName = this.xmlText(this.extractFirstXmlTag(authorXml, 'persName') || '');
      return [forenames, surname].filter(Boolean).join(' ') || persName;
    });
    return this.unique(authors);
  }

  private extractTeiIdno(xml: string, type: string): string {
    const escapedType = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`<idno\\b([^>]*)>([\\s\\S]*?)<\\/idno>`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      if (new RegExp(`\\btype=["']${escapedType}["']`, 'i').test(match[1])) {
        return this.xmlText(match[2]);
      }
    }
    return '';
  }

  private extractTeiYear(xml: string): string {
    const attrYear = xml.match(/<date\b[^>]*(?:when|from|notBefore)=["']((?:19|20)\d{2})/i)?.[1];
    if (attrYear) return attrYear;
    return xml.match(/<date\b[^>]*>[\s\S]*?\b((?:19|20)\d{2})\b[\s\S]*?<\/date>/i)?.[1] || '';
  }

  private extractFirstXmlTag(xml: string, tag: string, attrPattern?: RegExp): string {
    const regex = new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      if (!attrPattern || attrPattern.test(match[1])) {
        return match[2];
      }
    }
    return '';
  }

  private extractAllXmlTags(xml: string, tag: string): string[] {
    const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    const values: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
      values.push(match[1]);
    }
    return values;
  }

  private xmlText(xml: string): string {
    return this.decodeXmlEntities(String(xml || '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
  }

  private decodeXmlEntities(value: string): string {
    return value
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
  }

  private normalizePdfHeaderLine(line: string): string {
    return String(line || '')
      .replace(/\u00ad/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim();
  }

  private isLikelyPdfArticleNumberLine(line: string): boolean {
    const text = this.normalizePdfHeaderLine(line);
    return /^\d{1,4}\s*\(\s*(?:19|20)\d{2}\s*\)\s*[A-Z]?\d{2,}(?:[-–]\d+)?$/i.test(text);
  }

  private isLikelyStandaloneJournalNameLine(line: string): boolean {
    const text = this.normalizePdfHeaderLine(line);
    if (!text || text.length > 90) return false;
    if (/[.:：,;!?]/.test(text)) return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 7) return false;
    if (/^(nature|science|cell|plos one|scientific reports|global change biology|soil biology and biochemistry|geoderma|catena)$/i.test(text)) return true;
    if (!/\b(journal|biology|biochemistry|environment|environmental|agriculture|agricultural|ecology|ecological|science|scientific|research|reports|letters|communications|sustainability|agronomy|plants?|soil|crop|field)\b/i.test(text)) {
      return false;
    }
    if (/^(a|an|the)\b/i.test(text)) return false;
    return /^[A-Z0-9][A-Za-z0-9& -]+$/.test(text);
  }

  private isLikelyPdfJournalHeaderLine(line: string): boolean {
    const text = this.normalizePdfHeaderLine(line);
    if (!text) return false;
    if (/\b(?:issn|e-issn|eissn)\b/i.test(text)) return true;
    if (/\b(?:contents lists available|journal homepage|sciencedirect|elsevier|springer|wiley|mdpi|frontiers)\b/i.test(text)) return true;
    if (/\b\d{1,4}\s*\(\s*(?:19|20)\d{2}\s*\)\s*[A-Z]?\d{2,}(?:[-–]\d+)?\b/i.test(text)) return true;
    if (/\b(?:vol(?:ume)?|issue|no\.?|pages?|pp\.?|article)\b.{0,30}\b(?:19|20)\d{2}\b/i.test(text)) return true;
    const words = text.split(/\s+/).filter(Boolean);
    return words.length <= 9
      && /\b(?:19|20)\d{2}\b\s*[A-Z]?\d{3,}(?:[-–]\d+)?$/i.test(text)
      && /\b(journal|biology|biochemistry|environment|environmental|agriculture|agricultural|ecology|ecological|science|scientific|research|reports|letters|communications|sustainability|agronomy|soil|crop|field)\b/i.test(text);
  }

  private isPdfHeaderNoiseLine(line: string): boolean {
    const text = this.normalizePdfHeaderLine(line);
    if (!text) return true;
    if (this.isLikelyPdfJournalHeaderLine(text)) return true;
    if (/^\d{1,4}$/.test(text) || /^[\d\s,.;:()[\]-]+$/.test(text)) return true;
    if (/^(abstract|keywords?|introduction|materials|methods|results|discussion|conclusions?|references|supplementary)\b/i.test(text)) return true;
    if (/^(research article|review article|original article|article|short communication|editorial|commentary)$/i.test(text)) return true;
    if (/(contents lists available|journal homepage|sciencedirect|elsevier|springer|wiley|mdpi|frontiers|published by|all rights reserved|creative commons|received|accepted|available online|published online|corresponding author|e-?mail|orcid|issn|isbn|doi:|https?:\/\/|www\.)/i.test(text)) return true;
    if (/^(journal|volume|vol\.|issue|no\.|page)\b/i.test(text)) return true;
    return false;
  }

  private looksLikePdfAuthorLine(line: string): boolean {
    const text = this.normalizePdfHeaderLine(line);
    const words = text.split(/\s+/).filter(Boolean);
    const commaCount = (text.match(/,/g) || []).length;
    const initialCount = (text.match(/\b[A-Z]\./g) || []).length;
    if (/@|orcid|corresponding author/i.test(text)) return true;
    if (words.length <= 18 && commaCount >= 2 && initialCount >= 1) return true;
    if (words.length <= 16 && /(?:^|[,;]\s*)[A-Z][A-Za-z'`-]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Za-z'`-]+)?(?:[,;]|\s+and\s+)/.test(text)) {
      return true;
    }
    return false;
  }

  private cleanPdfTitleCandidate(value: string): string {
    return this.normalizePdfHeaderLine(value)
      .replace(/\s*-\s*$/g, '')
      .replace(/^(title|article title)\s*[:：]\s*/i, '')
      .trim();
  }

  private scorePdfTitleCandidate(candidate: string, lineIndex: number, span: number, followedByAuthorLine = false): number {
    const words = candidate.split(/\s+/).filter(Boolean);
    let score = 100 - lineIndex * 4;
    score += Math.min(candidate.length, 160) / 4;
    if (span > 1) score += 8;
    if (candidate.length >= 35 && candidate.length <= 180) score += 16;
    if (/[a-z]/.test(candidate) && /[A-Z]/.test(candidate)) score += 8;
    if (words.length >= 6 && words.length <= 28) score += 10;
    if (followedByAuthorLine) score += 70;
    if (/[,;]{3,}/.test(candidate)) score -= 18;
    if (/^[A-Z\s,;:()\-]+$/.test(candidate) && candidate.length < 80) score -= 12;
    if (/\b(journal|volume|issue|copyright|publisher)\b/i.test(candidate)) score -= 25;
    if (this.isLikelyPdfJournalHeaderLine(candidate)) score -= 110;
    if (this.looksLikePdfAuthorLine(candidate)) score -= 55;
    return score;
  }

  private inferTitleFromHeaderText(text: string): string {
    const rawLines = String(text || '')
      .slice(0, 7000)
      .split('\n')
      .map(line => this.normalizePdfHeaderLine(line))
      .filter(line => line.length > 0 && line.length <= 240);
    if (rawLines.length === 0) return '';

    const abstractIndex = rawLines.findIndex(line => /^(abstract|keywords?)\b/i.test(line));
    const headerLines = (abstractIndex >= 3 ? rawLines.slice(0, abstractIndex) : rawLines).slice(0, 70);
    let best: { title: string; score: number } | null = null;

    for (let i = 0; i < headerLines.length; i++) {
      if (this.isPdfHeaderNoiseLine(headerLines[i])) continue;
      for (let span = 1; span <= 4 && i + span <= headerLines.length; span++) {
        const chunk = headerLines.slice(i, i + span);
        const nextLine = headerLines[i + span] || '';
        if (
          i <= 4
          && span === 1
          && this.isLikelyStandaloneJournalNameLine(headerLines[i])
          && (this.isLikelyPdfArticleNumberLine(nextLine) || this.isLikelyPdfJournalHeaderLine(nextLine))
        ) {
          continue;
        }
        if (chunk.some(line => this.isPdfHeaderNoiseLine(line))) break;
        if (span > 1 && chunk.slice(1).some(line => this.looksLikePdfAuthorLine(line))) break;
        const candidate = this.cleanPdfTitleCandidate(chunk.join(' '));
        if (this.isWeakPdfTitleCandidate(candidate)) continue;
        const words = candidate.split(/\s+/).filter(Boolean);
        if (words.length < 4 && candidate.length < 32) continue;
        const nextInformativeLine = headerLines.slice(i + span).find(line => !this.isPdfHeaderNoiseLine(line));
        const followedByAuthorLine = Boolean(nextInformativeLine && (
          this.looksLikePdfAuthorLine(nextInformativeLine)
          || this.isLikelyPdfAuthorCandidateLine(nextInformativeLine)
        ));
        const score = this.scorePdfTitleCandidate(candidate, i, span, followedByAuthorLine);
        if (!best || score > best.score) {
          best = { title: candidate, score };
        }
      }
    }

    return best?.title || '';
  }

  private normalizePdfMetadataCompare(value: string): string {
    return this.normalizePdfHeaderLine(value)
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isPdfAffiliationOrContactLine(line: string): boolean {
    const text = this.normalizePdfHeaderLine(line);
    if (!text) return true;
    if (/@|orcid|corresponding author|e-?mail|address|telephone|fax|https?:\/\/|www\./i.test(text)) return true;
    if (/\b(department|faculty|school|college|university|universities|institute|institution|academy|laborator(?:y|ies)|center|centre|hospital|ministry|station|campus|graduate|research group|key laboratory)\b/i.test(text)) return true;
    if (/\b(china|usa|u\.s\.a\.|united states|united kingdom|uk|germany|france|italy|spain|japan|korea|india|australia|canada|brazil|netherlands|province|city|postal|zip)\b/i.test(text)) return true;
    return false;
  }

  private cleanPdfAuthorCandidateLine(line: string): string {
    return this.normalizePdfHeaderLine(line)
      .replace(/^(authors?|by)\s*[:：]\s*/i, '')
      .replace(/\([^)]*(?:orcid|e-?mail|corresponding author)[^)]*\)/gi, ' ')
      .replace(/\b(?:orcid|e-?mail|email|corresponding author)\b.*$/i, ' ')
      .replace(/[†‡§*]+/g, ' ')
      .replace(/\s+(?:[a-z]|\d+)(?:\s*[,，]\s*(?:[a-z]|\d+))*\b(?=\s*(?:[,;；、]|$))/g, '')
      .replace(/([A-Za-z\u00C0-\u024F])\d+(?=(?:[,;；、]|\s|$))/g, '$1')
      .replace(/([A-Za-z\u00C0-\u024F])\s+[a-z]\b(?=(?:[,;；、]|\s|$))/g, '$1')
      .replace(/(?:^|[,;；、]\s*)[a-z](?=\s*(?:[,;；、]|$))/g, '')
      .replace(/\s*([,;；、])\s*/g, '$1 ')
      .replace(/\s+/g, ' ')
      .replace(/^[,;；、\s]+|[,;；、\s]+$/g, '')
      .trim();
  }

  private isLikelyPdfAuthorCandidateLine(line: string): boolean {
    const text = this.cleanPdfAuthorCandidateLine(line);
    if (!text || text.length < 4 || text.length > 280) return false;
    if (this.isPdfHeaderNoiseLine(text) || this.isPdfAffiliationOrContactLine(text)) return false;
    if (/[.:：]$/.test(text) && !/[,;；、]|\band\b/i.test(text)) return false;
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length > 32) return false;
    if (/[\u4e00-\u9fff]{2,}(?:\s*[、，,;；]\s*[\u4e00-\u9fff]{2,})+/.test(text)) return true;
    const latinTokens = text.match(/[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F'`’.-]+/g) || [];
    if (/[,;；、]/.test(text) && latinTokens.length >= 2) return true;
    if (/\band\b/i.test(text) && latinTokens.length >= 3 && words.length <= 22) return true;
    const fullNameMatches = text.match(/\b[A-Z][A-Za-z\u00C0-\u024F'`’.-]+(?:\s+[A-Z]\.)?(?:\s+[A-Z][A-Za-z\u00C0-\u024F'`’.-]+)+\b/g) || [];
    if (fullNameMatches.length >= 2) return true;
    return fullNameMatches.length === 1 && words.length <= 5 && !/\b(soil|nitrogen|carbon|climate|effect|effects|response|responses|study|analysis|application|management)\b/i.test(text);
  }

  private findPdfHeaderTitleEndIndex(lines: string[], title: string): number {
    const normalizedTitle = this.normalizePdfMetadataCompare(title);
    if (!normalizedTitle) return 0;
    for (let i = 0; i < lines.length; i++) {
      for (let span = 1; span <= 4 && i + span <= lines.length; span++) {
        const chunk = this.normalizePdfMetadataCompare(lines.slice(i, i + span).join(' '));
        if (!chunk) continue;
        const enoughOverlap =
          (normalizedTitle.includes(chunk) && chunk.length >= Math.min(60, Math.floor(normalizedTitle.length * 0.55)))
          || (chunk.includes(normalizedTitle) && normalizedTitle.length >= Math.min(60, Math.floor(chunk.length * 0.55)));
        if (chunk === normalizedTitle || enoughOverlap) {
          return i + span;
        }
      }
    }
    return 0;
  }

  private inferAuthorsFromHeaderText(text: string, title: string): string {
    const rawLines = String(text || '')
      .slice(0, 9000)
      .split('\n')
      .map(line => this.normalizePdfHeaderLine(line))
      .filter(line => line.length > 0 && line.length <= 260);
    if (rawLines.length === 0) return '';

    const abstractIndex = rawLines.findIndex(line => /^(abstract|keywords?)\b/i.test(line));
    const headerLines = (abstractIndex >= 3 ? rawLines.slice(0, abstractIndex) : rawLines).slice(0, 80);
    const titleEndIndex = this.findPdfHeaderTitleEndIndex(headerLines, title);
    const normalizedTitle = this.normalizePdfMetadataCompare(title);
    const candidates: string[] = [];
    let missesAfterCandidate = 0;
    const scanStart = titleEndIndex > 0 ? titleEndIndex : 0;
    const scanEnd = Math.min(headerLines.length, scanStart + 14);

    for (let i = scanStart; i < scanEnd; i++) {
      const line = headerLines[i];
      if (/^(abstract|keywords?|introduction|materials|methods|results|discussion|conclusions?)\b/i.test(line)) break;
      const normalizedLine = this.normalizePdfMetadataCompare(line);
      if (normalizedTitle && normalizedLine && normalizedTitle.includes(normalizedLine) && normalizedLine.length > 12) continue;
      if (this.isPdfAffiliationOrContactLine(line)) {
        if (candidates.length > 0) break;
        continue;
      }
      if (this.isLikelyPdfAuthorCandidateLine(line)) {
        const cleaned = this.cleanPdfAuthorCandidateLine(line);
        if (cleaned && !candidates.some(existing => this.normalizePdfMetadataCompare(existing) === this.normalizePdfMetadataCompare(cleaned))) {
          candidates.push(cleaned);
        }
        if (candidates.join('; ').length >= 240) break;
        continue;
      }
      if (candidates.length > 0) {
        missesAfterCandidate += 1;
        if (missesAfterCandidate >= 2) break;
      }
    }

    return candidates.join('; ').slice(0, 260).trim();
  }

  private choosePdfTitle(fileTitle: string, headerTitle: string, fileBase: string): string {
    const fileWeak = this.isWeakPdfTitleCandidate(fileTitle, fileBase);
    const headerWeak = this.isWeakPdfTitleCandidate(headerTitle, fileBase);
    if (!headerWeak && (fileWeak || headerTitle.length >= 28)) return headerTitle;
    if (!fileWeak) return fileTitle;
    if (!headerWeak) return headerTitle;
    return fileBase;
  }

  private inferSourceMetadata(originalName: string, text: string): Partial<PdfWikiSourcePdf> {
    const fileBase = this.restoreOriginalName(path.basename(originalName)).replace(/\.pdf$/i, '').trim();
    const parts = fileBase.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
    const yearFromName = fileBase.match(/\b(19|20)\d{2}\b/)?.[0];
    const doi = this.normalizeDoi(text.match(/\b10\.\d{4,9}\/[^\s"'<>\\]+/i)?.[0] || '');

    let titleFromFile = '';
    let authors = '';
    let year = yearFromName || '';
    let journal = '';

    if (parts.length >= 3) {
      const yearIndex = parts.findIndex(part => /\b(19|20)\d{2}\b/.test(part));
      if (yearIndex >= 0 && yearIndex < parts.length - 1) {
        year = parts[yearIndex].match(/\b(19|20)\d{2}\b/)?.[0] || year;
        titleFromFile = parts.slice(yearIndex + 1).join(' - ');
        const beforeYear = parts.slice(0, yearIndex).join(' - ');
        if (beforeYear && !/\b(journal|biology|science|nature|environment|agriculture|soil|ecology|chemistry)\b/i.test(beforeYear)) {
          authors = beforeYear;
        } else {
          journal = beforeYear;
        }
      }
    }

    const headerTitle = this.inferTitleFromHeaderText(text);
    const title = this.choosePdfTitle(titleFromFile, headerTitle, fileBase);
    const headerAuthors = this.inferAuthorsFromHeaderText(text, title);
    if (!authors && headerAuthors) {
      authors = headerAuthors;
    }

    return {
      title,
      authors,
      year,
      journal,
      doi,
    };
  }

  private isDoiMetadataLookupEnabled(): boolean {
    return !/^(false|0|off|no)$/i.test(String(process.env.PDF_WIKI_DOI_METADATA_LOOKUP || 'true').trim());
  }

  private extractDoiFromMetadataOrText(metadata: Partial<PdfWikiSourcePdf>, text: string): string {
    const fromMetadata = this.normalizeDoi(String(metadata.doi || ''));
    if (fromMetadata) return fromMetadata;
    const matches = String(text || '').match(/\b10\.\d{4,9}\/[^\s"'<>\\]+/ig) || [];
    for (const match of matches) {
      const doi = this.normalizeDoi(match);
      if (doi && doi.length >= 8 && !/[<>{}]/.test(doi)) return doi;
    }
    return '';
  }

  private async enrichSourceMetadataWithDoi(
    metadata: Partial<PdfWikiSourcePdf>,
    text: string,
    originalName: string
  ): Promise<Partial<PdfWikiSourcePdf>> {
    const cleaned = this.cleanSourceMetadata(metadata);
    if (!this.isDoiMetadataLookupEnabled()) return cleaned;

    const doiCandidates = this.unique([
      this.extractDoiFromMetadataOrText(cleaned, text),
      ...this.inferDoiCandidatesFromFileName(originalName),
    ].filter(Boolean));
    if (doiCandidates.length === 0) return cleaned;

    let doi = doiCandidates[0];
    let external: Partial<PdfWikiSourcePdf> | null = null;
    for (const candidate of doiCandidates) {
      external = await this.fetchExternalMetadataByDoi(candidate);
      if (external?.title) {
        doi = candidate;
        break;
      }
    }
    if (!external) {
      return {
        ...cleaned,
        doi: cleaned.doi || doi,
      };
    }

    const externalTitle = external.title && !this.isWeakPdfTitleCandidate(external.title, originalName) ? external.title : undefined;
    return this.cleanSourceMetadata({
      ...cleaned,
      title: externalTitle && (this.isWeakPdfTitleCandidate(cleaned.title, originalName) || external.doi)
        ? externalTitle
        : cleaned.title,
      authors: this.isWeakPdfMetadataValue(cleaned.authors) ? external.authors || cleaned.authors : cleaned.authors,
      year: this.isWeakPdfMetadataValue(cleaned.year) ? external.year || cleaned.year : cleaned.year,
      journal: this.isWeakPdfMetadataValue(cleaned.journal) ? external.journal || cleaned.journal : cleaned.journal,
      doi: cleaned.doi || external.doi || doi,
    });
  }

  private inferDoiCandidatesFromFileName(originalName: string): string[] {
    const restored = this.restoreOriginalName(path.basename(originalName || '')).replace(/\.pdf$/i, '').trim();
    if (!restored) return [];

    const decodedValues = this.unique([
      restored,
      restored.replace(/_/g, '/'),
      restored.replace(/%2[fF]/g, '/'),
    ]);
    const candidates: string[] = [];
    for (const value of decodedValues) {
      const direct = this.normalizeDoi(value.match(/\b10\.\d{4,9}\/[^\s"'<>\\]+/i)?.[0] || '');
      if (direct) candidates.push(direct);

      const wiley = value.match(/\bj\.\d{4}-\d{4}\.\d{4}\.\d{4,6}\.x\b/i)?.[0];
      if (wiley) {
        candidates.push(`10.1046/${wiley}`);
        candidates.push(`10.1111/${wiley}`);
      }
    }
    return this.unique(candidates.map(candidate => this.normalizeDoi(candidate)).filter(Boolean));
  }

  private async fetchExternalMetadataByDoi(doi: string): Promise<Partial<PdfWikiSourcePdf> | null> {
    const normalizedDoi = this.normalizeDoi(doi);
    if (!normalizedDoi) return null;

    const crossref = await this.fetchCrossrefMetadataByDoi(normalizedDoi);
    if (crossref?.title) return crossref;

    return this.fetchOpenAlexMetadataByDoi(normalizedDoi);
  }

  private async fetchCrossrefMetadataByDoi(doi: string): Promise<Partial<PdfWikiSourcePdf> | null> {
    const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    try {
      const data = await this.fetchJsonWithTimeout(url, this.getDoiMetadataLookupTimeoutMs());
      const message = this.asRecord(this.asRecord(data).message);
      const title = this.firstArray(message.title).map(item => String(item || '').trim()).find(Boolean) || '';
      const containerTitle = this.firstArray(message['container-title']).map(item => String(item || '').trim()).find(Boolean) || '';
      const authors = this.formatExternalAuthorList(this.firstArray(message.author));
      const year = this.extractYearFromCrossrefMessage(message);
      return this.cleanSourceMetadata({
        title,
        authors,
        year,
        journal: containerTitle,
        doi: this.normalizeDoi(this.firstString(message.DOI, doi)),
      });
    } catch (error) {
      logger.debug(`[PdfWiki] Crossref DOI metadata lookup failed for ${doi}: ${(error as Error).message}`);
      return null;
    }
  }

  private async fetchOpenAlexMetadataByDoi(doi: string): Promise<Partial<PdfWikiSourcePdf> | null> {
    const url = `https://api.openalex.org/works/${encodeURIComponent(`https://doi.org/${doi}`)}`;
    try {
      const data = this.asRecord(await this.fetchJsonWithTimeout(url, this.getDoiMetadataLookupTimeoutMs()));
      const primaryLocation = this.asRecord(data.primary_location);
      const source = this.asRecord(primaryLocation.source);
      const authorships = this.firstArray(data.authorships);
      const authors = authorships
        .map(item => this.firstString(this.asRecord(this.asRecord(item).author).display_name))
        .filter(Boolean)
        .slice(0, 20)
        .join('; ');
      return this.cleanSourceMetadata({
        title: this.firstString(data.title, data.display_name),
        authors,
        year: this.firstString(data.publication_year),
        journal: this.firstString(source.display_name),
        doi,
      });
    } catch (error) {
      logger.debug(`[PdfWiki] OpenAlex DOI metadata lookup failed for ${doi}: ${(error as Error).message}`);
      return null;
    }
  }

  private async fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'ScholarHarness/1.0 (mailto:sjs@cau.edu.cn)',
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private getDoiMetadataLookupTimeoutMs(): number {
    const parsed = Number(process.env.PDF_WIKI_DOI_METADATA_TIMEOUT_MS || 7000);
    return Number.isFinite(parsed) && parsed >= 1000 ? parsed : 7000;
  }

  private formatExternalAuthorList(values: unknown[]): string {
    return values
      .map(item => {
        const author = this.asRecord(item);
        return this.firstString(
          [author.given, author.family].filter(Boolean).join(' '),
          author.name,
          author.family
        );
      })
      .filter(Boolean)
      .slice(0, 20)
      .join('; ');
  }

  private extractYearFromCrossrefMessage(message: Record<string, unknown>): string {
    const dateCandidates = [
      message.published,
      message['published-print'],
      message['published-online'],
      message.created,
      message.issued,
    ];
    for (const candidate of dateCandidates) {
      const record = this.asRecord(candidate);
      const dateParts = this.firstArray(record['date-parts']);
      const firstPart = this.firstArray(dateParts[0]);
      const year = this.firstString(firstPart[0]);
      if (/^(19|20)\d{2}$/.test(year)) return year;
    }
    return '';
  }

  private async buildReferenceIndex(input: {
    pdf: PdfWikiSourcePdf;
    text: string;
    llmConfig: PdfWikiLlmConfig;
    parsedContent?: PdfWikiParsedContent;
  }): Promise<PdfWikiReferenceIndexResult> {
    const metadataEngine = this.getMetadataEngine(input.llmConfig);
    const inferredMetadata = this.cleanSourceMetadata({
      ...this.inferSourceMetadata(input.pdf.originalName, input.text),
      ...this.removeEmptyMetadata(input.parsedContent?.metadata || {}),
    });
    const localMetadata = metadataEngine === 'local'
      ? inferredMetadata
      : await this.enrichSourceMetadataWithDoi(inferredMetadata, input.text, input.pdf.originalName);
    const localReferences = this.mergeReferenceIndexes(
      input.parsedContent?.references || [],
      this.parseReferences(input.text, input.pdf.id, input.pdf.originalName),
    );
    let llmMetadata: Partial<PdfWikiSourcePdf> = {};
    let enrichedReferences: PdfWikiReference[] = [];

    if (metadataEngine !== 'local') {
      try {
        const llmResult = await this.extractMetadataAndReferencesWithLlm(input.pdf, input.text, input.llmConfig);
        llmMetadata = llmResult.metadata;
      } catch (error) {
        logger.warn(`[PdfWiki] LLM metadata extraction failed for ${input.pdf.originalName}, using local metadata parser:`, error);
      }

      if (localReferences.length > 0) {
        try {
          enrichedReferences = await this.enrichReferencesWithLlm(input.pdf, localReferences, input.llmConfig);
        } catch (error) {
          logger.warn(`[PdfWiki] LLM reference enrichment failed for ${input.pdf.originalName}, using local reference parser:`, error);
        }
      }
    }

    return {
      metadata: this.cleanSourceMetadata({
        ...localMetadata,
        ...this.removeEmptyMetadata(llmMetadata),
      }),
      references: this.mergeReferenceIndexes(localReferences, enrichedReferences),
    };
  }

  private async extractMetadataAndReferencesWithLlm(
    pdf: PdfWikiSourcePdf,
    text: string,
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiReferenceIndexResult> {
    const header = text.slice(0, 7000);
    if (!header) {
      return { metadata: {}, references: [] };
    }

    const prompt = `你是严谨的学术 PDF 元信息解析器。请只基于给定 PDF 首页/开头文本，抽取这篇 PDF 本身的元信息。

PDF 文件名：${pdf.originalName}

要求：
1. 只抽取这篇 PDF 本身的 metadata：title, authors, year, journal, doi。
2. 不要抽取 References/Bibliography 中的参考文献列表。
3. 不要抽取正文论点；不要编造缺失信息；缺失字段留空字符串。
4. 只返回 JSON，不要 Markdown。

PDF 首页/开头文本：
${header}

返回格式：
{
  "metadata": {
    "title": "PDF 标题",
    "authors": "PDF 作者",
    "year": "发表年份",
    "journal": "期刊",
    "doi": "DOI"
  }
}`;

    const parsed = await this.callJsonNormalizer(llmConfig, prompt, 2000, 'reference-index metadata');
    const rawMetadata = (parsed.metadata || {}) as Record<string, unknown>;
    const metadata = this.cleanSourceMetadata({
      title: rawMetadata.title ? String(rawMetadata.title) : undefined,
      authors: rawMetadata.authors ? String(rawMetadata.authors) : undefined,
      year: rawMetadata.year ? String(rawMetadata.year) : undefined,
      journal: rawMetadata.journal ? String(rawMetadata.journal) : undefined,
      doi: rawMetadata.doi ? this.normalizeDoi(String(rawMetadata.doi)) : undefined,
    });

    return { metadata, references: [] };
  }

  private async enrichReferencesWithLlm(
    pdf: PdfWikiSourcePdf,
    references: PdfWikiReference[],
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiReference[]> {
    const batchSize = this.getReferenceEnrichmentBatchSize();
    const maxRefs = this.getReferenceEnrichmentMaxRefs();
    const refsToParse = references.slice(0, maxRefs);
    const enriched: PdfWikiReference[] = [];

    for (let start = 0; start < refsToParse.length; start += batchSize) {
      const batch = refsToParse.slice(start, start + batchSize);
      const batchNumber = Math.floor(start / batchSize) + 1;
      const totalBatches = Math.ceil(refsToParse.length / batchSize);
      try {
        const parsed = await this.enrichReferenceBatchWithLlm(pdf, batch, start, llmConfig, batchNumber, totalBatches);
        enriched.push(...parsed);
      } catch (error) {
        logger.warn(`[PdfWiki] reference batch ${batchNumber}/${totalBatches} enrichment failed for ${pdf.originalName}, keeping local fields:`, error);
        enriched.push(...batch);
      }
    }

    logger.info(`[PdfWiki] Reference enrichment completed for ${pdf.originalName}: ${enriched.length}/${references.length} refs`);
    return enriched;
  }

  private async enrichReferenceBatchWithLlm(
    pdf: PdfWikiSourcePdf,
    batch: PdfWikiReference[],
    startIndex: number,
    llmConfig: PdfWikiLlmConfig,
    batchNumber: number,
    totalBatches: number
  ): Promise<PdfWikiReference[]> {
    const referenceLines = batch.map((ref, offset) => {
      const inputIndex = startIndex + offset + 1;
      return `[${inputIndex}] ${this.compactPromptText(ref.raw || ref.title || '', 1800)}`;
    }).join('\n');

    const prompt = `你是严格的参考文献结构化解析器。请只解析下面这一小批 References raw，不要解析正文，不要新增文献。

PDF 文件名：${pdf.originalName}
批次：${batchNumber}/${totalBatches}

要求：
1. 每条输入必须返回一条 references 结果，inputIndex 必须与输入编号一致。
2. raw 必须尽量保持输入原文。
3. 能解析则补 title, authors, year, journal, doi；无法解析的字段留空字符串。
4. 不要合并、不要拆分、不要补充输入中没有的文献。
5. 只返回 JSON 对象，不要 Markdown，不要解释。

输入参考文献：
${referenceLines}

返回格式：
{
  "references": [
    {
      "inputIndex": 1,
      "raw": "完整参考文献原文",
      "title": "参考文献标题",
      "authors": "参考文献作者",
      "year": "年份",
      "journal": "期刊",
      "doi": "DOI"
    }
  ]
}`;

    const parsed = await this.callJsonNormalizer(
      llmConfig,
      prompt,
      this.getReferenceJsonMaxOutputTokens(llmConfig),
      `reference-index batch ${batchNumber}/${totalBatches}`
    );
    const parsedRefs = Array.isArray(parsed.references) ? parsed.references : [];
    const refsByInputIndex = new Map<number, Partial<PdfWikiReference>>();
    parsedRefs.forEach((ref: unknown, offset: number) => {
      if (!ref || typeof ref !== 'object') return;
      const record = ref as Partial<PdfWikiReference> & { inputIndex?: unknown };
      const inputIndex = Number(record.inputIndex) || startIndex + offset + 1;
      refsByInputIndex.set(inputIndex, record);
    });

    return batch.map((localRef, offset) => {
      const inputIndex = startIndex + offset + 1;
      const parsedRef = refsByInputIndex.get(inputIndex);
      if (!parsedRef) return localRef;
      const normalized = this.normalizeReferenceFromPartial({
        ...localRef,
        raw: String(parsedRef.raw || localRef.raw || ''),
        title: parsedRef.title ? String(parsedRef.title) : localRef.title,
        authors: parsedRef.authors ? String(parsedRef.authors) : localRef.authors,
        year: parsedRef.year ? String(parsedRef.year) : localRef.year,
        journal: parsedRef.journal ? String(parsedRef.journal) : localRef.journal,
        doi: parsedRef.doi ? String(parsedRef.doi) : localRef.doi,
      }, localRef.sourcePdfId || pdf.id, localRef.sourcePdfName || pdf.originalName, (localRef.index || inputIndex) - 1);
      return {
        ...localRef,
        ...this.removeEmptyReferenceFields(normalized || localRef),
        raw: localRef.raw || normalized?.raw || '',
        id: localRef.id,
        index: localRef.index,
        sourcePdfId: localRef.sourcePdfId || pdf.id,
        sourcePdfName: localRef.sourcePdfName || pdf.originalName,
      };
    });
  }

  private async tryBuildPdfWithQwenLongFile(
    pdf: PdfWikiSourcePdf,
    llmConfig: PdfWikiLlmConfig
  ): Promise<QwenLongPdfBuildResult | null> {
    if (!this.shouldUseQwenLongDirectPdf(llmConfig)) return null;

    try {
      const fileId = await this.uploadPdfToQwenLong(pdf, llmConfig);
      const referenceIndex = await this.extractMetadataAndReferencesFromQwenFile(pdf, fileId, llmConfig);
      Object.assign(pdf, referenceIndex.metadata);
      pdf.referenceIndex = referenceIndex.references;

      const claims = await this.extractClaimsFromQwenFile(pdf, fileId, llmConfig);
      const entries = claims
        .map((claim, index) => this.createEntryFromClaim({
          ...claim,
          location: claim.location || `Qwen-VL-Max file ${index + 1}`,
        }, pdf, index, referenceIndex.references))
        .filter((entry): entry is PdfWikiEntry => !!entry);

      if (entries.length === 0) {
        throw new Error('Qwen-VL-Max 未从 PDF 中返回可用论点');
      }

      logger.info(`[PdfWiki] Built ${entries.length} entries from ${pdf.originalName} via Qwen-VL-Max direct PDF`);
      return { referenceIndex, entries };
    } catch (error) {
      logger.warn(`[PdfWiki] Qwen-VL-Max direct PDF failed for ${pdf.originalName}, falling back to text extraction:`, error);
      return null;
    }
  }

  private shouldUseQwenLongDirectPdf(llmConfig: PdfWikiLlmConfig): boolean {
    if (/^(false|0|off)$/i.test(String(process.env.QWEN_VL_MAX_DIRECT_PDF || process.env.QWEN_LONG_DIRECT_PDF || process.env.PDF_WIKI_DIRECT_PDF || ''))) {
      return false;
    }
    if (/^(true|1|on)$/i.test(String(process.env.QWEN_VL_MAX_DIRECT_PDF || process.env.QWEN_LONG_DIRECT_PDF || process.env.PDF_WIKI_DIRECT_PDF || ''))) {
      return true;
    }
    return /qwen[-_]?(long|vl[-_]?max)/i.test(String(llmConfig.model || ''));
  }

  private async uploadPdfToQwenLong(pdf: PdfWikiSourcePdf, llmConfig: PdfWikiLlmConfig): Promise<string> {
    const buffer = await fs.promises.readFile(pdf.filePath);
    const form = new FormData();
    form.append('file', new Blob([buffer as any], { type: 'application/pdf' }), pdf.originalName || pdf.fileName);
    form.append('purpose', 'file-extract');

      const response = await fetch(`${this.getApiBaseUrl(llmConfig)}/files`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${llmConfig.apiKey}`,
        },
        body: form as any,
      });

    if (!response.ok) {
      throw new Error(`Qwen-VL-Max file upload error (${response.status}): ${await response.text()}`);
    }

    const data = await response.json() as { id?: string; file?: { id?: string } };
    const fileId = data.id || data.file?.id || '';
    if (!fileId) {
      throw new Error('Qwen-VL-Max 文件上传未返回 file id');
    }

    return fileId;
  }

  private async extractMetadataAndReferencesFromQwenFile(
    pdf: PdfWikiSourcePdf,
    fileId: string,
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiReferenceIndexResult> {
    const prompt = `请直接阅读已上传 PDF 文件，抽取 PDF Wiki 第一阶段数据。

PDF 文件名：${pdf.originalName}

要求：
1. 只输出普通文本，不要输出 JSON，不要 Markdown 代码块。
2. 先列出这篇 PDF 本身的元信息：Title, Authors, Year, Journal, DOI。
3. 再列出 References/Bibliography 中能识别到的参考文献原文。
4. 参考文献按编号逐条列出，每条尽量保持原文；能看出 DOI 就保留 DOI。
5. references 最多列出 120 条；如果原文过长，优先保留正文和 Discussion 中引用过的文献。
6. 不要编造缺失信息；看不到就写 empty。

请按下面这种纯文本格式输出：
PDF_METADATA
Title:
Authors:
Year:
Journal:
DOI:

REFERENCES_RAW
1. ...
2. ...`;

    const rawText = await this.callQwenLongFileText(llmConfig, fileId, prompt, 8000);
    const parsed = this.parseQwenMetadataAndReferencesText(rawText, pdf);
    logger.info(`[PdfWiki] Parsed Qwen-VL-Max reference text for ${pdf.originalName}: refs=${parsed.references.length}`);
    return parsed;
  }

  private async extractClaimsFromQwenFile(
    pdf: PdfWikiSourcePdf,
    fileId: string,
    llmConfig: PdfWikiLlmConfig
  ): Promise<ExtractedClaim[]> {
    const prompt = `请直接阅读已上传 PDF 文件，抽取用于 PDF Wiki 的全文论点。

PDF：${pdf.originalName}

要求：
1. 只输出普通文本，不要输出 JSON，不要 Markdown 代码块。
2. 优先覆盖 Introduction/Background 和 Discussion/讨论，其次再补充 Abstract、Results、Conclusion。
3. Introduction/Background 中的研究假设、科学争议、研究空白、机制解释、前人研究观点都要抽取；不要因为它们不是作者结果就跳过。
4. Discussion/讨论中每一个独立讨论点都要梳理，尤其是机制解释、与前人研究一致/不一致、限制条件、反向证据和作者解释。
5. 如果 PDF 作者把某个观点作为自己的假设、结果、发现、结论或讨论判断提出，标记为“支持观点”。
6. 如果某个观点来自前人研究、背景机制或讨论中的引用文献，但不能直接代表本文结果，放入“中性背景/机制”，并保留文中引用。
7. “反对/限制观点”只放 PDF 中明确提出的反向结果、限制条件、争议观点或冲突证据。
8. 每个 Support/Oppose/Neutral 观点都要尽量保留原文证据短摘录和文中引用，如 "(Smith et al., 2020)"、"Smith et al. (2020)"、"[12]" 或 "(12)"；如果证据句附近有引用，不要漏掉。
9. 不要编造 PDF 中没有的信息；缺失字段写 empty。
10. 如果章节存在，Introduction/Background 和 Discussion/讨论各至少抽取 10 个候选论点；全文最多输出 100 个高质量论点。
11. Claim、Summary 用中文表述；Evidence 尽量保留 PDF 原文短摘录。

请按下面这种纯文本格式输出：
CLAIM 1
Claim:
Section:
Location:
Discussion point:
Support views:
- Summary:
  Evidence:
  In-text citations:
Oppose/limitation views:
- Summary:
  Evidence:
  In-text citations:
Neutral/background views:
- Summary:
  Evidence:
  In-text citations:

CLAIM 2
...`;

    const rawText = await this.callQwenLongFileText(llmConfig, fileId, prompt, 16000);
    const normalizePrompt = `你是严格的 PDF Wiki 论点 JSON 整理器。下面是长上下文模型从 PDF 中读出的普通文本，请整理为合法 JSON。

要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. claims 只来自输入文本，不要新增论点。
3. proViews 只放输入中的 Support views。
4. conViews 只放输入中的 Oppose/limitation views。
5. neutralViews 只放输入中的 Neutral/background views。
6. 每个 evidence 和 inTextCitations 尽量保留原文；如果 evidence 或 summary 里出现文中引用，必须放进 inTextCitations。
7. claim、summary 用中文；evidence 保留原文证据。
8. 缺失字段用空字符串或空数组。

输入文本：
${rawText.slice(0, 70000)}

返回格式：
{
  "claims": [
    {
      "claim": "",
      "section": "",
      "location": "",
      "discussionPoint": "",
      "proViews": [
        {"summary": "", "evidence": "", "inTextCitations": []}
      ],
      "conViews": [
        {"summary": "", "evidence": "", "inTextCitations": []}
      ],
      "neutralViews": [
        {"summary": "", "evidence": "", "inTextCitations": []}
      ],
      "evidence": "",
      "inTextCitations": []
    }
  ]
}`;

    const parsed = await this.callJsonNormalizer(llmConfig, normalizePrompt, 9000, 'qwen-direct-claims');
    const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];
    return claims.filter((claim: ExtractedClaim) => typeof claim.claim === 'string' && claim.claim.trim().length > 0);
  }

  private cleanSourceMetadata(metadata: Partial<PdfWikiSourcePdf>): Partial<PdfWikiSourcePdf> {
    return this.removeEmptyMetadata({
      title: metadata.title ? String(metadata.title).trim() : undefined,
      authors: metadata.authors ? String(metadata.authors).trim() : undefined,
      year: metadata.year ? String(metadata.year).match(/\b(19|20)\d{2}\b/)?.[0] : undefined,
      journal: metadata.journal ? String(metadata.journal).trim() : undefined,
      doi: metadata.doi ? this.normalizeDoi(String(metadata.doi)) : undefined,
    });
  }

  private removeEmptyMetadata(metadata: Partial<PdfWikiSourcePdf>): Partial<PdfWikiSourcePdf> {
    const cleaned: Partial<PdfWikiSourcePdf> = {};
    for (const key of ['title', 'authors', 'year', 'journal', 'doi'] as const) {
      const value = metadata[key];
      if (typeof value === 'string' && value.trim()) {
        cleaned[key] = value.trim();
      }
    }
    return cleaned;
  }

  private normalizeReferenceFromPartial(
    ref: Partial<PdfWikiReference>,
    sourcePdfId: string,
    sourcePdfName: string,
    index: number
  ): PdfWikiReference | null {
    const raw = String(ref.raw || ref.title || '').trim();
    const title = ref.title ? String(ref.title).trim() : undefined;
    if (!raw && !title) return null;

    const year = ref.year ? String(ref.year).match(/\b(19|20)\d{2}\b/)?.[0] : raw.match(/\b(19|20)\d{2}\b/)?.[0];
    const doi = this.normalizeDoi(String(ref.doi || raw.match(/\b10\.\d{4,9}\/[^\s"'<>\\]+/i)?.[0] || ''));
    const id = crypto.createHash('md5').update(`${sourcePdfId}:${index}:${raw}:${title || ''}:${doi}`).digest('hex').slice(0, 16);

    return {
      id: `ref_${id}`,
      raw: raw || title || '',
      sourcePdfId,
      sourcePdfName,
      index: index + 1,
      title,
      authors: ref.authors ? String(ref.authors).trim() : undefined,
      year,
      journal: ref.journal ? String(ref.journal).trim() : undefined,
      doi: doi || undefined,
    };
  }

  private parseQwenMetadataAndReferencesText(text: string, pdf: PdfWikiSourcePdf): PdfWikiReferenceIndexResult {
    const metadataBlock = this.extractNamedBlock(text, 'PDF_METADATA', 'REFERENCES_RAW') || text.slice(0, 3000);
    const metadata = this.cleanSourceMetadata({
      ...this.inferSourceMetadata(pdf.originalName, text),
      title: this.extractLabeledValue(metadataBlock, 'Title') || undefined,
      authors: this.extractLabeledValue(metadataBlock, 'Authors') || undefined,
      year: this.extractLabeledValue(metadataBlock, 'Year') || undefined,
      journal: this.extractLabeledValue(metadataBlock, 'Journal') || undefined,
      doi: this.normalizeDoi(this.extractLabeledValue(metadataBlock, 'DOI') || ''),
    });

    const referencesBlock = this.extractNamedBlock(text, 'REFERENCES_RAW') || '';
    const references = referencesBlock
      ? this.parseReferencesFromRawList(referencesBlock, pdf.id, pdf.originalName, 120)
      : [];

    return { metadata, references };
  }

  private extractNamedBlock(text: string, startLabel: string, endLabel?: string): string {
    const startPattern = new RegExp(`(^|\\n)\\s*${this.escapeRegExp(startLabel)}\\s*:?\\s*\\n`, 'i');
    const startMatch = startPattern.exec(text);
    if (!startMatch || startMatch.index === undefined) return '';

    const start = startMatch.index + startMatch[0].length;
    if (!endLabel) return text.slice(start).trim();

    const rest = text.slice(start);
    const endPattern = new RegExp(`(^|\\n)\\s*${this.escapeRegExp(endLabel)}\\s*:?\\s*\\n`, 'i');
    const endMatch = endPattern.exec(rest);
    return (endMatch && endMatch.index !== undefined ? rest.slice(0, endMatch.index) : rest).trim();
  }

  private extractLabeledValue(text: string, label: string): string {
    const regex = new RegExp(`^\\s*${this.escapeRegExp(label)}\\s*[:：]\\s*(.+?)\\s*$`, 'im');
    const value = regex.exec(text)?.[1]?.trim() || '';
    return /^(empty|none|null|n\/a|na|未[知见]|无)$/i.test(value) ? '' : value;
  }

  private parseReferencesFromRawList(
    rawText: string,
    sourcePdfId: string,
    sourcePdfName: string,
    maxRefs: number
  ): PdfWikiReference[] {
    const normalized = rawText
      .replace(/\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
    const lines = normalized.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    const refs: string[] = [];
    let current = '';

    for (const line of lines) {
      const cleanedLine = line.replace(/^[-*]\s+/, '').trim();
      const startsNew = /^(\[\d+\]|\d{1,3}[.)]\s+|\d{1,3}\s{1,3}|[A-Z][A-Za-z'`-]+,\s+[A-Z])/.test(cleanedLine);
      if (startsNew && current.length > 30) {
        refs.push(current.trim());
        current = cleanedLine;
      } else {
        current = current ? `${current} ${cleanedLine}` : cleanedLine;
      }
      if (refs.length >= maxRefs) break;
    }

    if (current.trim().length > 20 && refs.length < maxRefs) refs.push(current.trim());

    return refs
      .map((raw, index) => this.parseReferenceDetails(raw, sourcePdfId, sourcePdfName, index))
      .filter(ref => ref.raw && ref.raw.length > 20);
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private mergeReferenceIndexes(...indexes: PdfWikiReference[][]): PdfWikiReference[] {
    const merged = new Map<string, PdfWikiReference>();

    for (const ref of indexes.flat()) {
      const key = this.getReferenceMergeKey(ref);
      if (!key) continue;

      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, ref);
        continue;
      }

      merged.set(key, {
        ...existing,
        ...this.removeEmptyReferenceFields(ref),
        raw: existing.raw || ref.raw,
        sourcePdfId: existing.sourcePdfId || ref.sourcePdfId,
        sourcePdfName: existing.sourcePdfName || ref.sourcePdfName,
        index: existing.index || ref.index,
      });
    }

    return Array.from(merged.values()).sort((a, b) => {
      const sourceCompare = String(a.sourcePdfId || '').localeCompare(String(b.sourcePdfId || ''));
      if (sourceCompare !== 0) return sourceCompare;
      return (a.index || 0) - (b.index || 0);
    });
  }

  private getReferenceMergeKey(ref: PdfWikiReference): string {
    const source = ref.sourcePdfId || '';
    const doi = this.normalizeDoi(ref.doi || '');
    if (doi) return `source:${source}:doi:${doi.toLowerCase()}`;
    const title = String(ref.title || '').trim().toLowerCase();
    if (title) return `source:${source}:title:${title}:${ref.year || ''}`;
    const raw = String(ref.raw || '').trim().toLowerCase();
    return raw ? `source:${source}:raw:${raw.slice(0, 180)}` : '';
  }

  private removeEmptyReferenceFields(ref: PdfWikiReference): Partial<PdfWikiReference> {
    const cleaned: Partial<PdfWikiReference> = {};
    for (const key of ['title', 'authors', 'year', 'journal', 'doi'] as const) {
      const value = ref[key];
      if (typeof value === 'string' && value.trim()) cleaned[key] = value.trim();
    }
    return cleaned;
  }

  private buildClaimSections(
    text: string,
    pdf: PdfWikiSourcePdf,
    referenceIndex: PdfWikiReference[]
  ): PdfWikiClaimSection[] {
    const bodyText = this.stripReferenceTail(text);
    const referenceText = this.formatReferencesForPrompt(text, referenceIndex);
    const metadataText = this.formatPdfMetadataForPrompt(pdf);
    const introductionText = this.extractSectionByHeading(bodyText, [
      'introduction',
      'background',
    ], [
      'materials and methods',
      'material and methods',
      'methods',
      'methodology',
      'experimental procedures',
      'results',
      'results and discussion',
      'discussion',
      'conclusion',
      'conclusions',
      'references',
      'acknowledgements',
      'acknowledgments',
    ]) || this.fallbackIntroductionText(bodyText);
    const discussionText = this.extractSectionByHeading(bodyText, [
      'discussion',
      'results and discussion',
      'discussion and conclusions',
      'discussion and conclusion',
    ], [
      'conclusion',
      'conclusions',
      'summary and conclusions',
      'concluding remarks',
      'references',
      'acknowledgements',
      'acknowledgments',
      'supplementary',
    ]);
    const conclusionText = this.extractSectionByHeading(bodyText, [
      'conclusion',
      'conclusions',
      'summary and conclusions',
      'concluding remarks',
    ], [
      'references',
      'bibliography',
      'literature cited',
      'acknowledgements',
      'acknowledgments',
      'supplementary',
    ]);
    const introductionSentenceMatches = this.matchSectionSentencesToReferences(
      'Introduction',
      introductionText,
      referenceIndex,
      pdf.id
    );
    const discussionSentenceMatches = this.matchSectionSentencesToReferences(
      'Discussion',
      discussionText,
      referenceIndex,
      pdf.id
    );
    const conclusionSentenceMatches = this.matchSectionSentencesToReferences(
      'Conclusion',
      conclusionText,
      referenceIndex,
      pdf.id
    );
    const introductionSentenceEvidence = this.sentenceEvidenceMapFromMatches('Introduction', introductionSentenceMatches);
    const discussionSentenceEvidence = this.sentenceEvidenceMapFromMatches('Discussion', discussionSentenceMatches);
    const conclusionSentenceEvidence = this.sentenceEvidenceMapFromMatches('Conclusion', conclusionSentenceMatches);

    return [
      {
        label: '引言',
        sectionName: 'Introduction',
        text: this.composeSectionPromptText({
          metadataText,
          sectionName: 'Introduction',
          sectionText: introductionText,
          numberedSectionText: this.formatNumberedSectionSentences(introductionSentenceMatches),
          referenceText,
          sentenceReferenceText: this.formatSentenceReferenceHints('Introduction', introductionSentenceMatches),
          includeReferences: true,
        }),
        sentenceEvidence: introductionSentenceEvidence,
      },
      {
        label: '讨论',
        sectionName: 'Discussion',
        text: this.composeSectionPromptText({
          metadataText,
          sectionName: 'Discussion',
          sectionText: discussionText,
          numberedSectionText: this.formatNumberedSectionSentences(discussionSentenceMatches),
          referenceText,
          sentenceReferenceText: this.formatSentenceReferenceHints('Discussion', discussionSentenceMatches),
          includeReferences: true,
        }),
        sentenceEvidence: discussionSentenceEvidence,
      },
      {
        label: '结论',
        sectionName: 'Conclusion',
        text: this.composeSectionPromptText({
          metadataText,
          sectionName: 'Conclusion',
          sectionText: conclusionText,
          numberedSectionText: this.formatNumberedSectionSentences(conclusionSentenceMatches),
          referenceText: '',
          sentenceReferenceText: '',
          includeReferences: false,
        }),
        sentenceEvidence: conclusionSentenceEvidence,
      },
    ];
  }

  private extractSentenceWikiSection(text: string, section: PdfWikiSentenceSection): string {
    const bodyText = this.stripReferenceTail(text);
    if (section === 'Introduction') {
      return this.extractSectionByHeading(bodyText, [
        'introduction',
        'background',
      ], [
        'materials and methods',
        'material and methods',
        'methods',
        'methodology',
        'experimental procedures',
        'results',
        'results and discussion',
        'discussion',
        'conclusion',
        'conclusions',
        'references',
        'acknowledgements',
        'acknowledgments',
      ]) || this.fallbackIntroductionText(bodyText);
    }
    if (section === 'Discussion') {
      return this.extractSectionByHeading(bodyText, [
        'discussion',
        'results and discussion',
        'discussion and conclusions',
        'discussion and conclusion',
      ], [
        'conclusion',
        'conclusions',
        'summary and conclusions',
        'concluding remarks',
        'references',
        'acknowledgements',
        'acknowledgments',
        'supplementary',
      ]);
    }
    return this.extractSectionByHeading(bodyText, [
      'conclusion',
      'conclusions',
      'summary and conclusions',
      'concluding remarks',
    ], [
      'references',
      'bibliography',
      'literature cited',
      'acknowledgements',
      'acknowledgments',
      'supplementary',
    ]);
  }

  private buildSentenceCloudPointsFromText(
    text: string,
    pdf: PdfWikiSourcePdf,
    referenceIndex: PdfWikiReference[],
    topicDefinitions: PdfWikiTopicDefinition[] = []
  ): PdfWikiSentencePoint[] {
    const sectionInputs: Array<{ section: PdfWikiSentenceSection; text: string }> = [
      {
        section: 'Introduction',
        text: this.extractSentenceWikiSection(text, 'Introduction'),
      },
      {
        section: 'Discussion',
        text: this.extractSentenceWikiSection(text, 'Discussion'),
      },
      {
        section: 'Conclusion',
        text: this.extractSentenceWikiSection(text, 'Conclusion'),
      },
    ];

    const points: PdfWikiSentencePoint[] = [];
    for (const input of sectionInputs) {
      const matches = this.matchSectionSentencesToReferences(input.section, input.text, referenceIndex, pdf.id, 220, {
        includeSemanticCandidates: false,
        terminalCitationsOnly: false,
      });
      for (const match of matches) {
        const sentence = this.cleanSentencePointText(match.sentence);
        if (!this.isUsefulSentencePoint(sentence)) continue;
        const references = this.uniqueSentencePointReferences(match.candidates);
        const topic = this.inferSentencePointTopic(sentence, topicDefinitions);
        const claimInfo = this.inferSentenceClaimCandidate(sentence, input.section, references.length, match.citations);
        const referenceCount = references.length;
        const id = `sent_${crypto.createHash('md5').update(`${pdf.id}:${input.section}:${match.sentenceIndex}:${sentence}`).digest('hex').slice(0, 18)}`;
        const positionSeed = this.seededPointPosition(id, topic.key);
        points.push({
          id,
          sourcePdfId: pdf.id,
          sourcePdfName: pdf.originalName,
          sourcePdfTitle: pdf.title,
          section: input.section,
          sentenceIndex: match.sentenceIndex,
          sentence,
          citations: this.unique(match.citations || []),
          references,
          referenceCount,
          claimCandidate: claimInfo.claimCandidate,
          claimText: claimInfo.claimText,
          claimType: claimInfo.claimType,
          claimReason: claimInfo.claimReason,
          topicKey: topic.key,
          topicLabel: topic.label,
          keywords: topic.keywords,
          x: positionSeed.x,
          y: positionSeed.y,
          radius: Math.min(34, 8 + Math.max(0, referenceCount) * 5),
          matchMethod: this.getSentencePointMatchMethod(references),
          confidence: this.calculateSentencePointConfidence(references, match.citations),
        });
      }
    }
    return points;
  }

  /**
   * Fast AI matching mode deliberately stops at section extraction and sentence
   * splitting. Citation detection and References alignment belong to the AI
   * request that receives these raw sentences plus the complete tail-note list.
   */
  private buildSentenceCloudDraftPointsForAi(
    text: string,
    pdf: PdfWikiSourcePdf,
    topicDefinitions: PdfWikiTopicDefinition[] = []
  ): PdfWikiSentencePoint[] {
    const sectionInputs: Array<{ section: PdfWikiSentenceSection; text: string }> = [
      { section: 'Introduction', text: this.extractSentenceWikiSection(text, 'Introduction') },
      { section: 'Discussion', text: this.extractSentenceWikiSection(text, 'Discussion') },
    ];
    const points: PdfWikiSentencePoint[] = [];
    for (const input of sectionInputs) {
      const sentences = this.splitSectionIntoSentences(input.text, 220);
      sentences.forEach((rawSentence, sentenceIndex) => {
        const sentence = this.cleanSentencePointText(rawSentence);
        if (!this.isUsefulSentencePoint(sentence)) return;
        const topic = this.inferSentencePointTopic(sentence, topicDefinitions);
        const id = `sent_${crypto.createHash('md5').update(`${pdf.id}:${input.section}:${sentenceIndex}:${sentence}`).digest('hex').slice(0, 18)}`;
        const positionSeed = this.seededPointPosition(id, topic.key);
        points.push({
          id,
          sourcePdfId: pdf.id,
          sourcePdfName: pdf.originalName,
          sourcePdfTitle: pdf.title,
          section: input.section,
          sentenceIndex,
          sentence,
          citations: [],
          references: [],
          referenceCount: 0,
          claimCandidate: false,
          claimText: '',
          claimType: 'non_claim',
          claimReason: '等待 AI 根据原句中的显式引用与文末 References 对齐。',
          topicKey: topic.key,
          topicLabel: topic.label,
          keywords: topic.keywords,
          x: positionSeed.x,
          y: positionSeed.y,
          radius: 8,
          matchMethod: 'none',
          confidence: 0,
        });
      });
    }
    return points;
  }

  private async buildFastSentenceWikiWithCodex(
    userId: string,
    pdf: PdfWikiSourcePdf,
    text: string,
    referenceIndex: PdfWikiReference[],
    draftPoints: PdfWikiSentencePoint[],
    codexConfig: PdfWikiCodexConfig,
    onProgress?: PdfWikiCodexJsonProgressHandler
  ): Promise<PdfWikiSentencePoint[]> {
    const sectionSentencePoints = draftPoints.filter(point =>
      point.section === 'Introduction' || point.section === 'Discussion'
    );
    const conclusionSentences = this.splitSectionIntoSentences(
      this.extractSentenceWikiSection(text, 'Conclusion'),
      120
    ).filter(sentence => this.isUsefulSentencePoint(sentence));

    if (sectionSentencePoints.length === 0 && conclusionSentences.length === 0) {
      return [];
    }

    const batchSize = Math.max(6, Math.min(40, Number(process.env.PDF_WIKI_AI_CITATION_BATCH_SIZE || 18)));
    const configuredConcurrency = Number(process.env.PDF_WIKI_AI_CITATION_CONCURRENCY || codexConfig.concurrency || 2);
    const concurrency = Math.max(2, Math.min(6, Math.floor(Number.isFinite(configuredConcurrency) ? configuredConcurrency : 2)));
    const taskRoot = path.join(this.getCodexPdfWikiTaskDir(userId, pdf), 'fast-sentence-wiki');
    const batches: PdfWikiSentencePoint[][] = [];
    for (let start = 0; start < sectionSentencePoints.length; start += batchSize) {
      batches.push(sectionSentencePoints.slice(start, start + batchSize));
    }

    const detectedBatches: PdfWikiSentencePoint[][] = new Array(batches.length);
    await this.mapWithConcurrency(batches, concurrency, async (batch, batchIndex) => {
      const prompt = this.composeFastCitationDetectionPrompt(batch);
      const parsed = await this.callCodexJsonTask(
        codexConfig,
        path.join(taskRoot, 'citation-detection', `batch_${batchIndex + 1}`),
        prompt,
        `fast-citation-detection-${batchIndex + 1}`,
        async progress => {
          if (onProgress) await onProgress({
            ...progress,
            message: `并发识别引用 ${batchIndex + 1}/${batches.length}：${progress.message}`,
          });
        }
      );
      detectedBatches[batchIndex] = this.applyFastCitationDetection(batch, parsed);
    });

    const matchedBatches: PdfWikiSentencePoint[][] = new Array(detectedBatches.length);
    const conclusionPromise: Promise<Record<string, unknown>> = conclusionSentences.length > 0
      ? this.callCodexJsonTask(
        codexConfig,
        path.join(taskRoot, 'conclusions'),
        this.composeFastCodexSentenceWikiPrompt(pdf, [], conclusionSentences, []),
        'fast-conclusions',
        onProgress
      )
      : Promise.resolve({ conclusions: [] });
    const matchingJobs = detectedBatches.map((batch, batchIndex) => ({ batch, batchIndex }));
    await this.mapWithConcurrency(matchingJobs, concurrency, async job => {
      const relevantReferences = this.selectReferencesForAiDetectedCitations(job.batch, referenceIndex);
      if (relevantReferences.length === 0) {
        matchedBatches[job.batchIndex] = [];
        return;
      }
      const prompt = this.composeFastCodexSentenceWikiPrompt(pdf, job.batch, [], relevantReferences);
      const parsed = await this.callCodexJsonTask(
        codexConfig,
        path.join(taskRoot, 'reference-matching', `batch_${job.batchIndex + 1}`),
        prompt,
        `fast-reference-matching-${job.batchIndex + 1}`,
        async progress => {
          if (onProgress) await onProgress({
            ...progress,
            message: `并发匹配尾注 ${job.batchIndex + 1}/${matchingJobs.length}（候选 ${relevantReferences.length}/${referenceIndex.length}）：${progress.message}`,
          });
        }
      );
      matchedBatches[job.batchIndex] = this.applyFastCodexSentenceMatches(job.batch, relevantReferences, parsed);
    });

    const conclusionParsed = await conclusionPromise;
    const citedClaims = matchedBatches.flatMap(batch => batch || []);
    const conclusionClaims = this.buildFastCodexConclusionPoints(pdf, conclusionSentences, conclusionParsed);
    logger.info(
      `[PdfWiki] Fast Codex sentence wiki completed for ${pdf.originalName}: cited=${citedClaims.length}/${sectionSentencePoints.length}, conclusions=${conclusionClaims.length}`
    );
    return [...citedClaims, ...conclusionClaims];
  }

  private composeFastCitationDetectionPrompt(points: PdfWikiSentencePoint[]): string {
    const sentences = points.map(point => [
      `pointId: ${point.id}`,
      `section: ${point.section}`,
      `sentenceIndex: ${point.sentenceIndex}`,
      `sentence: ${this.compactPromptText(point.sentence, 1400)}`,
    ].join('\n')).join('\n\n');
    return `你是学术论文显式引用识别器。本阶段只识别原句句中或句末实际出现的引用，不提供 References，也不匹配文末条目。

要求：
1. 每个 pointId 必须返回一条 matches 记录。
2. citations 必须逐字来自 sentence，例如 [12]、[3, 5, 8]、(Smith et al., 2020)、Smith et al. (2020)。
3. 没有显式引用时返回 citations=[]。
4. 不要根据句子主题猜引用，不要改写引用。
5. 只输出 JSON：{"matches":[{"pointId":"sent_xxx","citations":["[12]"]}]}。

SENTENCES
${sentences}`;
  }

  private applyFastCitationDetection(
    points: PdfWikiSentencePoint[],
    parsed: Record<string, unknown>
  ): PdfWikiSentencePoint[] {
    const matches = this.firstArray(parsed.matches, parsed.results, parsed.items);
    const byId = new Map<string, Record<string, unknown>>();
    for (const item of matches) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const pointId = this.firstString(record.pointId, record.point_id, record.id);
      if (pointId) byId.set(pointId, record);
    }
    return points.map(point => {
      const record = byId.get(point.id);
      const citations = record ? this.resolveFastCodexSentenceCitations(point, record) : [];
      return { ...point, citations };
    });
  }

  private selectReferencesForAiDetectedCitations(
    points: PdfWikiSentencePoint[],
    references: PdfWikiReference[]
  ): PdfWikiReference[] {
    const selected: PdfWikiReference[] = [];
    const citations = this.unique(points.flatMap(point => point.citations || []));
    for (const citation of citations) {
      const numericIndexes = this.extractNumericReferenceIndexes(citation);
      for (const index of numericIndexes) {
        const reference = references.find((item, position) => (item.index || position + 1) === index);
        if (reference) selected.push(reference);
      }
      for (const pair of this.extractAuthorYearPairs(citation)) {
        const normalizedAuthor = this.normalizeCitationToken(pair.author);
        const authorYearCandidates = references.filter(reference => {
          const referenceText = this.normalizeCitationToken(`${reference.authors || ''} ${reference.raw || ''}`);
          return String(reference.year || reference.raw || '').includes(pair.year)
            && !!normalizedAuthor
            && ` ${referenceText} `.includes(` ${normalizedAuthor} `);
        });
        selected.push(...authorYearCandidates);
      }
    }
    const narrowed = this.uniqueReferences(selected);
    // AI detection found a citation but metadata was too incomplete to narrow it
    // safely. Preserve correctness by giving that batch the full tail-note list.
    return citations.length > 0 && narrowed.length === 0 ? references : narrowed;
  }

  private composeFastCodexSentenceWikiPrompt(
    pdf: PdfWikiSourcePdf,
    sectionSentencePoints: PdfWikiSentencePoint[],
    conclusionSentences: string[],
    references: PdfWikiReference[]
  ): string {
    const sentenceLines = sectionSentencePoints.map(point => [
      `pointId: ${point.id}`,
      `section: ${point.section}`,
      `sentenceIndex: ${point.sentenceIndex}`,
      `sentence: ${this.compactPromptText(point.sentence, 1200)}`,
      `aiDetectedCitations: ${point.citations.join('; ') || 'none'}`,
    ].join('\n')).join('\n\n');
    const conclusionLines = conclusionSentences
      .map((sentence, index) => `[C${index + 1}] ${this.compactPromptText(sentence, 1400)}`)
      .join('\n');
    const referenceLines = references
      .map((ref, index) => `[${ref.index || index + 1}] ${this.compactPromptText(this.formatReferenceForSentenceMatching(ref), 620)}`)
      .join('\n');

    return `你是 PDF 句子级 Wiki 的严格引用整理器。本任务是快速模式，只处理给定材料，不分析整篇论文，也不生成表格、图片或 Meta 数据。

必须执行两项任务：

A. 引言/讨论逐句引用整理
1. SECTION_SENTENCES 包含 Introduction 与 Discussion 中的可读句子。逐句判断，不得遗漏输入 pointId。
2. 每个输入 pointId 必须返回一条 matches 记录，pointId 原样返回。
3. aiDetectedCitations 来自上一阶段 AI 对原句的并发识别，不是本地匹配结果。你必须结合 sentence 复核这些引用，并把原句中实际出现的引用片段原样写入 citations。
4. 只能依据 citations 中的显式引用对齐 REFERENCES。禁止根据语义相似度猜参考文献；referenceIndexes 只能填写 REFERENCES 中真实存在且被该句明确引用的编号。
5. 句中和句末都没有明确参考文献时，必须返回 citations=[]、referenceIndexes=[]、claimCandidate=false、claimText=""，该句不能单独作为论点。
6. 有引用但无法可靠对齐文末条目时，同样返回 referenceIndexes=[]、claimCandidate=false、claimText=""。
7. 有明确引用且包含实质性背景事实、前人发现、研究空白、机制解释、限制条件或结果判断的完整句，应当作为论点；只有纯方法步骤、目录标题、残缺句或没有实质信息的过渡句才返回 claimCandidate=false。
8. claimCandidate=true 时，claimText 只概括该句表达的独立论点，不新增原文没有的信息。背景事实可以使用 claimType=background，不要因为它不是作者自己的结果而丢弃。

B. 本文主要结论整理
1. 只能依据 CONCLUSION_SENTENCES 归纳这篇来源论文自己的主要结论，输出 1-8 条 conclusions；没有可用结论则返回空数组。
2. 每条必须列出真实 sourceSentenceIndexes，对应 [C1]、[C2]；不得使用引言/讨论或 REFERENCES 代替本文结论。
3. conclusionText 不要自行添加引用。系统会在结论后追加 SOURCE_PAPER_METADATA 对应的本文引用，并保存完整文献信息。
4. 不得把文末 REFERENCES 中的其他论文当成本论文主要结论的来源。

统一要求：
- 只输出一个 JSON 对象，不要 Markdown，不要解释。
- confidence 为 0-1。
- claimType 只能是 argument、background、mechanism、result、limitation、method、non_claim。
- 不要输出 topicLabel、topicKey 或 keywords。主题由用户主题库和本地代码统一匹配。

返回格式：
{
  "matches": [
    {
      "pointId": "sent_xxx",
      "citations": ["Smith et al. (2020)", "[3]"],
      "referenceIndexes": [1, 3],
      "confidence": 0.95,
      "claimCandidate": true,
      "claimText": "该引用句表达的论点",
      "claimType": "mechanism",
      "claimReason": "句中/句末显式引用已与文末条目对齐"
    }
  ],
  "conclusions": [
    {
      "sourceSentenceIndexes": [1, 2],
      "conclusionText": "本文的主要结论",
      "confidence": 0.96,
      "claimType": "result"
    }
  ]
}

SOURCE_PAPER_METADATA
${this.formatPdfMetadataForPrompt(pdf)}

SECTION_SENTENCES
${sentenceLines || 'none'}

CONCLUSION_SENTENCES
${conclusionLines || 'none'}

REFERENCES
${referenceLines || 'none'}`;
  }

  private applyFastCodexSentenceMatches(
    points: PdfWikiSentencePoint[],
    references: PdfWikiReference[],
    parsed: Record<string, unknown>
  ): PdfWikiSentencePoint[] {
    const rawMatches = this.firstArray(
      parsed.matches,
      parsed.sentenceMatches,
      parsed.sentence_matches,
      parsed.citedSentenceClaims,
      parsed.cited_sentence_claims
    );
    const matchByPointId = new Map<string, Record<string, unknown>>();
    for (const item of rawMatches) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const pointId = this.firstString(record.pointId, record.point_id, record.id);
      if (pointId) matchByPointId.set(pointId, record);
    }

    const accepted: PdfWikiSentencePoint[] = [];
    for (const point of points) {
      const record = matchByPointId.get(point.id);
      if (!record) continue;
      const verifiedCitations = this.resolveFastCodexSentenceCitations(point, record);
      const codexReferences = this.resolveSentencePointAiReferences(record, references);
      const verifiedReferenceCandidates = this.deduplicateSentencePointReferences([
        ...codexReferences.map(ref => ({
          ...ref,
          matchType: 'citation' as const,
          matchScore: 1,
          aiReason: 'AI 根据原句句中/句末显式引用与文末 References 对齐；系统仅验证返回编号真实存在。',
        })),
      ], 8);
      if (verifiedCitations.length === 0 || verifiedReferenceCandidates.length === 0) continue;

      const localClaim = this.inferSentenceClaimCandidate(
        point.sentence,
        point.section,
        verifiedReferenceCandidates.length,
        verifiedCitations
      );
      const aiClaimCandidate = this.toBoolean(
        record.claimCandidate ?? record.claim_candidate ?? record.isClaim ?? record.is_claim
      );
      const aiClaimReason = this.firstString(
        record.claimReason,
        record.claim_reason,
        record.reason,
        record.rationale
      );
      const alignmentOnlyFailure = aiClaimCandidate === false
        && /引用.*(?:未|无法).*(?:对齐|匹配)|(?:reference|citation).*(?:unmatched|not aligned|cannot align|failed to match)/i.test(aiClaimReason);
      const effectiveRecord = alignmentOnlyFailure && localClaim.claimCandidate
        ? {
            ...record,
            claimCandidate: true,
            claimText: this.firstString(record.claimText, record.claim_text, localClaim.claimText),
            claimType: localClaim.claimType,
            claimReason: '原 Codex 结果因参考文献目录缺失而未对齐；系统已从原文 References 恢复详细条目并按显式引用重新核验。',
          }
        : record;
      const refined = this.applyAiSentencePointMatch({
        ...point,
        citations: verifiedCitations,
        references: verifiedReferenceCandidates,
        referenceCount: verifiedReferenceCandidates.length,
      }, effectiveRecord, references);
      const verifiedReferences = this.deduplicateSentencePointReferences(
        (refined.references || []).filter(ref => !ref.fallbackSourcePdf),
        8
      );
      const claimType = this.normalizeSentenceClaimType(refined.claimType);
      if (
        refined.citations.length === 0
        || verifiedReferences.length === 0
        || refined.claimCandidate !== true
        || claimType === 'method'
        || claimType === 'non_claim'
      ) {
        continue;
      }
      accepted.push({
        ...refined,
        references: verifiedReferences,
        referenceCount: verifiedReferences.length,
        matchMethod: this.getSentencePointMatchMethod(verifiedReferences),
        claimReason: this.unique([
          refined.claimReason || '',
          '快速模式：已核对句中/句末显式引用，并绑定文末参考文献的作者、年份、题名、期刊、DOI 和原始条目。',
        ].filter(Boolean)).join(' '),
      });
    }
    return accepted;
  }

  private resolveFastCodexSentenceCitations(
    point: PdfWikiSentencePoint,
    record: Record<string, unknown>
  ): string[] {
    const localCitations = this.unique(point.citations || []);
    const codexCitations = this.toStringArray(
      record.citations
      || record.inTextCitations
      || record.in_text_citations
      || record.citation
    );
    const normalizedSentence = this.normalizeSuperscriptCitationDigits(point.sentence)
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    return this.unique([...localCitations, ...codexCitations]).filter(citation => {
      if (localCitations.includes(citation)) return true;
      const normalizedCitation = this.normalizeSuperscriptCitationDigits(citation)
        .normalize('NFKC')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
      if (normalizedCitation.length < 2 || !normalizedSentence.includes(normalizedCitation)) return false;
      return this.extractInTextCitations(citation).length > 0;
    });
  }

  private buildFastCodexConclusionPoints(
    pdf: PdfWikiSourcePdf,
    conclusionSentences: string[],
    parsed: Record<string, unknown>
  ): PdfWikiSentencePoint[] {
    if (conclusionSentences.length === 0) return [];
    const rawConclusions = this.firstArray(
      parsed.conclusions,
      parsed.mainConclusions,
      parsed.main_conclusions,
      parsed.paperConclusions,
      parsed.paper_conclusions
    );
    const sourceReference = this.createSourcePaperReference(pdf);
    const sourceCitation = this.formatSourcePaperInTextCitation(pdf);
    const points: PdfWikiSentencePoint[] = [];
    const seen = new Set<string>();

    for (const item of rawConclusions.slice(0, 12)) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const sourceIndexes = this.toNumberArray(
        record.sourceSentenceIndexes
        || record.source_sentence_indexes
        || record.sentenceIndexes
        || record.sentence_indexes
        || record.sourceSentenceIndex
      ).filter(index => index >= 1 && index <= conclusionSentences.length);
      if (sourceIndexes.length === 0) continue;
      const conclusionText = this.cleanSentencePointText(
        this.firstString(record.conclusionText, record.conclusion_text, record.claimText, record.claim, record.summary)
      );
      if (!this.isUsefulSentencePoint(conclusionText) || seen.has(conclusionText.toLowerCase())) continue;
      seen.add(conclusionText.toLowerCase());
      const evidenceSentences = this.unique(sourceIndexes.map(index => conclusionSentences[index - 1]).filter(Boolean));
      if (evidenceSentences.length === 0) continue;
      const topicLabel = '未分类';
      const topicKey = 'unclassified';
      const normalizedClaimType = this.normalizeSentenceClaimType(
        this.firstString(record.claimType, record.claim_type, 'result')
      );
      const claimType = normalizedClaimType === 'method' || normalizedClaimType === 'non_claim'
        ? 'result'
        : normalizedClaimType;
      const claimText = this.appendSourcePaperCitation(conclusionText, sourceCitation);
      const sentenceIndex = Math.min(...sourceIndexes);
      const id = `sent_conclusion_${crypto.createHash('md5').update(`${pdf.id}:${sourceIndexes.join(',')}:${conclusionText}`).digest('hex').slice(0, 18)}`;
      const positionSeed = this.seededPointPosition(id, topicKey);
      const confidenceValue = this.clamp01(Number(record.confidence ?? record.score ?? 0.95));
      points.push({
        id,
        sourcePdfId: pdf.id,
        sourcePdfName: pdf.originalName,
        sourcePdfTitle: pdf.title,
        section: 'Conclusion',
        sentenceIndex,
        sentence: evidenceSentences.join(' '),
        citations: [sourceCitation],
        references: [sourceReference],
        referenceCount: 1,
        claimCandidate: true,
        claimText,
        claimType,
        claimReason: `Codex 根据 Conclusion 的 ${sourceIndexes.map(index => `C${index}`).join('、')} 归纳本文主要结论；引用绑定到来源论文本身。`,
        topicKey,
        topicLabel,
        keywords: [],
        x: positionSeed.x,
        y: positionSeed.y,
        radius: 13,
        matchMethod: 'ai',
        confidence: Math.round((confidenceValue || 0.95) * 1000) / 1000,
      });
    }
    return points;
  }

  private createSourcePaperReference(pdf: PdfWikiSourcePdf): PdfWikiSentencePointReference {
    const title = pdf.title || pdf.originalName || '来源论文';
    const raw = [pdf.authors, pdf.year, title, pdf.journal, pdf.doi ? `DOI: ${pdf.doi}` : '']
      .filter(Boolean)
      .join('. ');
    const id = crypto.createHash('md5').update(`${pdf.id}:${raw}:source-paper`).digest('hex').slice(0, 16);
    return {
      id: `ref_source_${id}`,
      raw: raw || `来源论文：${title}`,
      sourcePdfId: pdf.id,
      sourcePdfName: pdf.originalName,
      fallbackSourcePdf: true,
      title,
      authors: pdf.authors,
      year: pdf.year,
      journal: pdf.journal,
      doi: pdf.doi,
      matchType: 'ai',
      matchScore: 1,
      aiReason: '本文主要结论必须引用来源论文本身。',
    };
  }

  private formatSourcePaperInTextCitation(pdf: PdfWikiSourcePdf): string {
    const rawAuthors = String(pdf.authors || '').trim();
    const firstAuthor = rawAuthors
      .split(/\s*(?:;|；|，|\band\b|&)\s*/i)
      .map(value => value.trim())
      .filter(Boolean)[0] || '';
    const authorLabel = firstAuthor.includes(',')
      ? firstAuthor.split(',')[0].trim()
      : firstAuthor;
    const year = String(pdf.year || '').trim();
    if (authorLabel && year) return `(${authorLabel} et al., ${year})`;
    if (authorLabel) return `(${authorLabel} et al.)`;
    const title = String(pdf.title || pdf.originalName || '来源论文').trim();
    return year ? `(${title}, ${year})` : `(来源论文：${title})`;
  }

  private appendSourcePaperCitation(text: string, citation: string): string {
    const cleaned = this.cleanSentencePointText(text).replace(/[。.!?！？]+$/g, '');
    if (!cleaned) return citation;
    if (cleaned.endsWith(citation)) return cleaned;
    return `${cleaned} ${citation}`;
  }

  private async refineSentenceCloudPointsWithAi(
    points: PdfWikiSentencePoint[],
    referenceIndex: PdfWikiReference[],
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiSentencePoint[]> {
    if (points.length === 0) return points;
    if (!llmConfig.apiUrl || !llmConfig.apiKey) return points;
    if (!this.shouldUseApiForSentenceReferenceMatching(llmConfig)) return points;

    const references = referenceIndex || [];
    const byPdf = new Map<string, PdfWikiSentencePoint[]>();
    for (const point of points) {
      const list = byPdf.get(point.sourcePdfId) || [];
      list.push(point);
      byPdf.set(point.sourcePdfId, list);
    }

    const refinedById = new Map<string, PdfWikiSentencePoint>();
    const batchSize = Math.max(6, Math.min(30, Number(process.env.PDF_WIKI_SENTENCE_MATCH_BATCH_SIZE || 18)));
    for (const [sourcePdfId, pdfPoints] of byPdf.entries()) {
      const pdfReferences = references.filter(ref => ref.sourcePdfId === sourcePdfId);
      const fallbackReferences = pdfReferences.length > 0
        ? pdfReferences
        : references.filter(ref => !ref.sourcePdfId || ref.sourcePdfId === sourcePdfId);
      if (fallbackReferences.length === 0) continue;

      for (let start = 0; start < pdfPoints.length; start += batchSize) {
        const batch = pdfPoints.slice(start, start + batchSize);
        try {
          const refinedBatch = await this.refineSentencePointBatchWithAi(batch, fallbackReferences, llmConfig);
          for (const point of refinedBatch) {
            refinedById.set(point.id, point);
          }
        } catch (error) {
          logger.warn(`[PdfWiki] AI sentence-reference matching failed for ${batch[0]?.sourcePdfName || sourcePdfId}, keeping local matches:`, error);
        }
      }
    }

    return points.map(point => refinedById.get(point.id) || point);
  }

  private async refineSentencePointBatchWithAi(
    points: PdfWikiSentencePoint[],
    references: PdfWikiReference[],
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiSentencePoint[]> {
    const prompt = this.composeSentenceReferenceMatchingPrompt(points, references);
    const parsed = await this.callJsonNormalizer(llmConfig, prompt, 9000, 'sentence-reference matching');
    const rawMatches = this.firstArray(
      parsed.matches,
      parsed.sentenceMatches,
      parsed.sentence_matches,
      parsed.results,
      parsed.items,
    );
    if (rawMatches.length === 0) return points;

    const matchByPointId = new Map<string, Record<string, unknown>>();
    for (const item of rawMatches) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const pointId = this.firstString(record.pointId, record.point_id, record.id, record.sentencePointId, record.sentence_point_id);
      if (pointId) matchByPointId.set(pointId, record);
    }

    return points.map(point => {
      const record = matchByPointId.get(point.id);
      if (!record) return point;
      const verifiedCitations = this.resolveFastCodexSentenceCitations(point, record);
      return this.applyAiSentencePointMatch({ ...point, citations: verifiedCitations }, record, references);
    });
  }

  private composeSentenceReferenceMatchingPrompt(points: PdfWikiSentencePoint[], references: PdfWikiReference[]): string {
    const sentenceLines = points.map((point, index) => {
      return [
        `SENTENCE ${index + 1}`,
        `pointId: ${point.id}`,
        `section: ${point.section}`,
        `sentenceIndex: ${point.sentenceIndex}`,
        `sentence: ${this.compactPromptText(point.sentence, 900)}`,
      ].join('\n');
    }).join('\n\n');

    const referenceLines = references
      .map((ref, index) => {
        const displayIndex = ref.index || index + 1;
        return `[${displayIndex}] ${this.compactPromptText(this.formatReferenceForSentenceMatching(ref), 520)}`;
      })
      .join('\n');

    return `你是学术论文引用对齐与句子论点判断助手。请把论文 Introduction / Discussion / Conclusion 中已经逐句切分的句子，与该 PDF 文末 References 条目做匹配，并判断该句是否可转成论点。

任务要求：
1. 每个输入句子都必须返回一条 matches 记录，pointId 必须原样返回。
2. 本地没有预先提取引用，也没有提供参考文献候选。请逐字检查 sentence 的句中和句末显式引用，例如 [1,2]、(Author, 2020)、Author et al. (2021)，并将原句中真实存在的引用片段原样返回到 citations。
3. 如果 sentence 中没有显式引用，必须返回 citations=[]、referenceIndexes=[]；不要根据句子语义、主题相似或参考文献标题猜测匹配。
4. 不要编造文末不存在的参考文献；referenceIndexes 只能来自下面 REFERENCES 的编号。
5. 不要生成或修改主题。主题由用户主题库和本地匹配代码统一决定。
6. confidence 为 0-1；成功对齐显式引用通常 0.85 以上；没有显式引用时 confidence 不超过 0.2。
7. claimCandidate 判断该句是否能作为论点：研究空白、机制解释、前人结论、作者发现/解释、限制条件都可以；纯方法步骤、目录性陈述、无明确判断的背景句通常为 false。
8. claimText 用中文或保留原文概括该句可作为论点的判断，必须只来自该句，不要新增信息；不能作为论点时留空。
9. 只输出 JSON 对象，不要 Markdown，不要解释。

返回格式：
{
  "matches": [
    {
      "pointId": "sent_xxx",
      "citations": ["[1,3]"],
      "referenceIndexes": [1, 3],
      "matchMethod": "citation",
      "confidence": 0.92,
      "claimCandidate": true,
      "claimText": "优化氮肥管理可降低硝态氮积累和 N2O 损失",
      "claimType": "result",
      "claimReason": "该句表达结果判断，并有句尾显式引用",
      "reason": "句中编号引用 [1,3] 对应文末条目"
    }
  ]
}

SENTENCES
${sentenceLines}

REFERENCES
${referenceLines || '未解析到文末参考文献。'}`;
  }

  private applyAiSentencePointMatch(
    point: PdfWikiSentencePoint,
    record: Record<string, unknown>,
    references: PdfWikiReference[]
  ): PdfWikiSentencePoint {
    const aiReferences = point.citations.length > 0
      ? this.resolveSentencePointAiReferences(record, references)
      : [];
    const confidence = this.clamp01(Number(record.confidence ?? record.score ?? record.matchScore ?? 0));
    const reason = this.firstString(record.reason, record.rationale, record.note);
    const protectedCitationRefs = (point.references || []).filter(ref => ref.matchType === 'citation');
    const matchedAiRefs = aiReferences.map(ref => ({
      ...ref,
      matchType: 'citation' as const,
      matchScore: confidence > 0 ? Math.round(confidence * 1000) / 1000 : undefined,
      aiReason: reason || undefined,
    }));
    const nextReferences = this.deduplicateSentencePointReferences([
      ...protectedCitationRefs,
      ...matchedAiRefs,
    ], 8);
    const referenceCount = nextReferences.length;
    const aiClaimCandidate = this.toBoolean(record.claimCandidate ?? record.claim_candidate ?? record.isClaim ?? record.is_claim);
    const claimType = this.normalizeSentenceClaimType(this.firstString(record.claimType, record.claim_type, record.type, point.claimType));
    const claimText = this.firstString(record.claimText, record.claim_text, record.claim, record.argument);
    const claimReason = this.firstString(record.claimReason, record.claim_reason, record.reason, point.claimReason);
    const nextConfidence = confidence > 0
      ? confidence
      : this.calculateSentencePointConfidence(nextReferences, point.citations);

    return {
      ...point,
      references: nextReferences,
      referenceCount,
      claimCandidate: aiClaimCandidate === null ? point.claimCandidate : aiClaimCandidate,
      claimText: claimText || point.claimText,
      claimType: claimType || point.claimType,
      claimReason: claimReason || point.claimReason,
      topicKey: point.topicKey,
      topicLabel: point.topicLabel,
      keywords: point.keywords,
      radius: Math.min(38, 8 + Math.max(0, referenceCount) * 5),
      matchMethod: this.getSentencePointMatchMethod(nextReferences),
      confidence: Math.round(nextConfidence * 1000) / 1000,
    };
  }

  private resolveSentencePointAiReferences(
    record: Record<string, unknown>,
    references: PdfWikiReference[]
  ): PdfWikiReference[] {
    const refByIndex = new Map<number, PdfWikiReference>();
    const refById = new Map<string, PdfWikiReference>();
    references.forEach((ref, index) => {
      refByIndex.set(ref.index || index + 1, ref);
      if (ref.id) refById.set(ref.id, ref);
      if (ref.doi) refById.set(ref.doi.toLowerCase(), ref);
    });

    const resolved: PdfWikiReference[] = [];
    const indexes = this.toNumberArray(record.referenceIndexes || record.reference_indexes || record.refIndexes || record.ref_indexes || record.indexes);
    for (const index of indexes) {
      const match = refByIndex.get(index) || references[index - 1];
      if (match) resolved.push(match);
    }

    for (const id of this.toStringArray(record.referenceIds || record.reference_ids || record.refIds || record.ref_ids)) {
      const match = refById.get(id) || refById.get(id.toLowerCase());
      if (match) resolved.push(match);
    }

    const rawReferences = this.firstArray(record.references, record.refs, record.reference);
    for (const item of rawReferences) {
      if (typeof item === 'number') {
        const match = refByIndex.get(item) || references[item - 1];
        if (match) resolved.push(match);
        continue;
      }
      if (typeof item === 'string') {
        const numeric = Number(item);
        const byNumber = Number.isFinite(numeric) ? (refByIndex.get(numeric) || references[numeric - 1]) : undefined;
        const byId = refById.get(item) || refById.get(item.toLowerCase());
        if (byNumber || byId) resolved.push((byNumber || byId)!);
        continue;
      }
      if (item && typeof item === 'object') {
        const refRecord = item as Record<string, unknown>;
        const index = Number(refRecord.index ?? refRecord.referenceIndex ?? refRecord.reference_index);
        const id = this.firstString(refRecord.id, refRecord.doi);
        const match = (Number.isFinite(index) && index > 0 ? (refByIndex.get(index) || references[index - 1]) : undefined)
          || (id ? (refById.get(id) || refById.get(id.toLowerCase())) : undefined);
        if (match) resolved.push(match);
      }
    }

    return this.uniqueReferences(resolved);
  }

  private formatReferenceForSentenceMatching(ref: PdfWikiReference): string {
    return [
      ref.authors ? `Authors: ${ref.authors}` : '',
      ref.year ? `Year: ${ref.year}` : '',
      ref.title ? `Title: ${ref.title}` : '',
      ref.journal ? `Journal: ${ref.journal}` : '',
      ref.doi ? `DOI: ${ref.doi}` : '',
      ref.raw ? `Raw: ${ref.raw}` : '',
    ].filter(Boolean).join('; ') || ref.id || '';
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  private buildSentenceCloudStore(points: PdfWikiSentencePoint[]): PdfWikiSentenceCloudStore {
    const normalizedPoints = this.filterPublishableSentencePoints(points)
      .sort((a, b) =>
        a.topicLabel.localeCompare(b.topicLabel, 'zh-CN')
        || a.sourcePdfName.localeCompare(b.sourcePdfName, 'zh-CN')
        || a.section.localeCompare(b.section)
        || a.sentenceIndex - b.sentenceIndex
      );
    const grouped = new Map<string, PdfWikiSentencePoint[]>();
    for (const point of normalizedPoints) {
      const list = grouped.get(point.topicKey) || [];
      list.push(point);
      grouped.set(point.topicKey, list);
    }
    const palette = ['#0f766e', '#166534', '#15803d', '#047857', '#0d9488', '#14532d', '#065f46', '#4d7c0f'];
    const clouds = Array.from(grouped.entries()).map(([topicKey, cloudPoints], index): PdfWikiSentenceCloud => {
      const pdfIds = this.unique(cloudPoints.map(point => point.sourcePdfId));
      const keywords = this.unique(cloudPoints.flatMap(point => point.keywords)).slice(0, 8);
      return {
        id: `cloud_${crypto.createHash('md5').update(topicKey).digest('hex').slice(0, 14)}`,
        topicKey,
        label: cloudPoints[0]?.topicLabel || topicKey,
        pointIds: cloudPoints.map(point => point.id),
        sentenceCount: cloudPoints.length,
        referenceCount: cloudPoints.reduce((sum, point) => sum + point.referenceCount, 0),
        pdfIds,
        keywords,
        color: palette[index % palette.length],
      };
    }).sort((a, b) => b.sentenceCount - a.sentenceCount || b.referenceCount - a.referenceCount || a.label.localeCompare(b.label, 'zh-CN'));
    return {
      generatedAt: new Date().toISOString(),
      points: normalizedPoints,
      clouds,
    };
  }

  private cleanSentencePointText(value: string): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  private isUsefulSentencePoint(sentence: string): boolean {
    if (sentence.length < 30) return false;
    if (/^(figure|table|fig\.|图|表)\s*\d+/i.test(sentence)) return false;
    if (/^(introduction|discussion|conclusion|references|acknowledg)/i.test(sentence)) return false;
    return /[a-zA-Z\u4e00-\u9fa5]/.test(sentence);
  }

  private filterPublishableSentencePoints(points: PdfWikiSentencePoint[]): PdfWikiSentencePoint[] {
    return (points || []).filter(point => this.isPublishableSentencePoint(point));
  }

  private isPublishableSentencePoint(point: PdfWikiSentencePoint | null | undefined): point is PdfWikiSentencePoint {
    if (!point) return false;
    if (!this.hasReferenceBackedReferences(point.references)) return false;
    if (point.claimCandidate !== true) return false;
    const claimType = this.normalizeSentenceClaimType(point.claimType);
    if (claimType === 'method' || claimType === 'non_claim') return false;
    const claimText = this.cleanSentencePointText(point.claimText || point.sentence || '');
    if (!claimText) return false;
    return this.isUsefulSentencePoint(point.sentence || claimText);
  }

  /**
   * `fallbackSourcePdf` 只是历史兼容信息，表示“这句话来自哪篇 PDF”，并不表示
   * 句子已经匹配到可核验的参考文献。展示、导出和写作检索只能使用真正绑定的
   * 参考文献，避免把无引文句子误当成可引用证据。
   */
  private isReferenceBackedReference(reference: PdfWikiReference | null | undefined): reference is PdfWikiReference {
    if (!reference || reference.fallbackSourcePdf === true) return false;
    if (/^ref_source_/i.test(String(reference.id || ''))) return false;
    if (/^\s*来源\s*PDF\s*[:：]/i.test(String(reference.raw || ''))) return false;
    return Number.isFinite(reference.index)
      || Boolean(String(reference.doi || '').trim())
      || Boolean(String(reference.title || '').trim())
      || Boolean(String(reference.raw || '').trim());
  }

  private hasReferenceBackedReferences(references: PdfWikiReference[] | null | undefined): boolean {
    return (Array.isArray(references) ? references : []).some(reference => this.isReferenceBackedReference(reference));
  }

  private filterReferenceBackedViewpoints(viewpoints: PdfWikiViewpoint[] | null | undefined): PdfWikiViewpoint[] {
    return (Array.isArray(viewpoints) ? viewpoints : []).flatMap(viewpoint => {
      const references = this.uniqueReferences(
        (Array.isArray(viewpoint?.references) ? viewpoint.references : [])
          .filter(reference => this.isReferenceBackedReference(reference))
      );
      if (references.length === 0) return [];
      return [{
        ...viewpoint,
        inTextCitations: this.unique(Array.isArray(viewpoint.inTextCitations) ? viewpoint.inTextCitations : []),
        evidenceSentenceIds: this.unique(Array.isArray(viewpoint.evidenceSentenceIds) ? viewpoint.evidenceSentenceIds : []),
        evidenceSentences: this.unique(Array.isArray(viewpoint.evidenceSentences) ? viewpoint.evidenceSentences : []),
        references,
      }];
    });
  }

  private filterReferenceBackedEntry(entry: PdfWikiEntry | null | undefined): PdfWikiEntry | null {
    if (!entry) return null;
    const pro = this.filterReferenceBackedViewpoints(entry.pro);
    const con = this.filterReferenceBackedViewpoints(entry.con);
    const neutral = this.filterReferenceBackedViewpoints(entry.neutral);
    const viewpoints = [...pro, ...con, ...neutral];
    if (viewpoints.length === 0) return null;

    const references = this.uniqueReferences([
      ...(Array.isArray(entry.references) ? entry.references : [])
        .filter(reference => this.isReferenceBackedReference(reference)),
      ...viewpoints.flatMap(viewpoint => viewpoint.references),
    ]);
    if (references.length === 0) return null;

    const evidenceSnippets = this.unique(viewpoints.flatMap(viewpoint => [
      viewpoint.evidence,
      ...(viewpoint.evidenceSentences || []),
    ]).filter(Boolean));
    const retainedEvidence = new Set(evidenceSnippets.map(item => this.cleanSentencePointText(item)));

    return {
      ...entry,
      pro,
      con,
      neutral,
      inTextCitations: this.unique(viewpoints.flatMap(viewpoint => viewpoint.inTextCitations || [])),
      evidenceSentenceIds: this.unique(viewpoints.flatMap(viewpoint => viewpoint.evidenceSentenceIds || [])),
      references,
      evidenceSnippets,
      sourceEntries: Array.isArray(entry.sourceEntries)
        ? entry.sourceEntries.map(sourceEntry => ({
          ...sourceEntry,
          evidenceSnippets: (sourceEntry.evidenceSnippets || [])
            .filter(snippet => retainedEvidence.has(this.cleanSentencePointText(snippet))),
        }))
        : entry.sourceEntries,
    };
  }

  private filterReferenceBackedEntries(entries: PdfWikiEntry[]): PdfWikiEntry[] {
    return (Array.isArray(entries) ? entries : [])
      .map(entry => this.filterReferenceBackedEntry(entry))
      .filter((entry): entry is PdfWikiEntry => !!entry);
  }

  private toReferenceBackedStoreView(store: PdfWikiStore): PdfWikiStore {
    const sentenceCloud = this.buildSentenceCloudStore(
      this.filterPublishableSentencePoints(store.sentenceCloud?.points || [])
    );
    sentenceCloud.generatedAt = store.sentenceCloud?.generatedAt || store.generatedAt;
    return {
      ...store,
      entries: this.filterReferenceBackedEntries(store.entries || []),
      sentenceCloud,
    };
  }

  private inferSentenceClaimCandidate(
    sentence: string,
    section: PdfWikiSentenceSection,
    referenceCount: number,
    citations: string[]
  ): Pick<PdfWikiSentencePoint, 'claimCandidate' | 'claimText' | 'claimType' | 'claimReason'> {
    const text = this.cleanSentencePointText(sentence);
    const lower = text.toLowerCase().replace(/[₂]/g, '2');
    const methodLike = /\b(we used|we measured|samples were|was measured|were measured|materials and methods|statistical analysis|using a|using an|according to the protocol)\b/i.test(text)
      || /采用|测定方法|统计分析|试验设计|样品采集|数据处理|材料与方法/.test(text);
    const limitationLike = /\b(however|although|whereas|uncertain|unclear|limited|limitation|constraint|caution|may not|not always|inconsistent|conflicting)\b/i.test(text)
      || /然而|但是|尽管|不确定|尚不清楚|限制|局限|不一致|争议|可能并不/.test(text);
    const mechanismLike = /\b(mechanism|because|due to|driven by|mediated by|associated with|controlled by|regulate|pathway|nitrification|denitrification)\b/i.test(text)
      || /机制|由于|驱动|调控|介导|硝化|反硝化|路径|影响因素/.test(text);
    const resultLike = /\b(show|shows|showed|indicate|indicates|indicated|suggest|suggests|suggested|demonstrate|demonstrates|demonstrated|found|reveal|reveals|conclude|concludes|increase|decrease|reduce|enhance|affect|promote|inhibit)\b/i.test(text)
      || /表明|说明|显示|发现|揭示|认为|结论|增加|降低|减少|提高|促进|抑制|影响|导致/.test(text);
    const gapLike = /\b(gap|lack|few studies|poorly understood|remain unknown|needs? to|important to|critical to)\b/i.test(text)
      || /研究空白|缺乏|很少研究|尚需|亟需|有必要|关键问题/.test(text);

    let claimType: PdfWikiSentencePoint['claimType'] = 'non_claim';
    if (methodLike) {
      claimType = 'method';
    } else if (limitationLike) {
      claimType = 'limitation';
    } else if (mechanismLike) {
      claimType = 'mechanism';
    } else if (resultLike || section === 'Conclusion') {
      claimType = 'result';
    } else if (gapLike) {
      claimType = 'background';
    }

    const hasExplicitCitation = citations.length > 0 || referenceCount > 0;
    const claimCandidate = !methodLike && (
      resultLike
      || mechanismLike
      || limitationLike
      || gapLike
      || section === 'Conclusion'
      || (section === 'Discussion' && text.length >= 45)
      || (section === 'Introduction' && hasExplicitCitation && text.length >= 45)
    );

    const claimText = claimCandidate
      ? this.deriveSentenceClaimText(text)
      : '';
    const claimReason = claimCandidate
      ? (hasExplicitCitation ? '句子包含可追溯引用，并表达可检验判断。' : '句子表达机制、结果、限制或结论性判断。')
      : (methodLike ? '句子更像方法或流程描述，暂不作为论点。' : '句子缺少明确判断，需要人工复核后再转为论点。');

    return {
      claimCandidate,
      claimText,
      claimType: claimCandidate && claimType === 'non_claim' ? 'argument' : claimType,
      claimReason,
    };
  }

  private deriveSentenceClaimText(sentence: string): string {
    return sentence
      .replace(/\s+/g, ' ')
      .replace(/\s*(?:\[[\d,，\s\-–]+\]|[\(（](?:\d{1,3}(?:\s*[-,，]\s*\d{1,3})*|[^()（）]{0,80}?(?:19|20)\d{2}[^()（）]{0,40})[\)）])\s*([.;。])?$/g, '$1')
      .trim();
  }

  private normalizeSentenceClaimType(value: unknown): PdfWikiSentencePoint['claimType'] {
    const text = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '_');
    const allowed: PdfWikiSentencePoint['claimType'][] = ['argument', 'background', 'mechanism', 'result', 'limitation', 'method', 'non_claim'];
    if ((allowed as string[]).includes(text)) return text as PdfWikiSentencePoint['claimType'];
    if (/limit|caution|uncertain|争议|限制|局限/.test(text)) return 'limitation';
    if (/mechanism|pathway|机制/.test(text)) return 'mechanism';
    if (/result|finding|conclusion|发现|结论/.test(text)) return 'result';
    if (/method|方法/.test(text)) return 'method';
    if (/background|gap|背景|空白/.test(text)) return 'background';
    return 'argument';
  }

  private uniqueSentencePointReferences(candidates: PdfWikiSentenceReferenceCandidate[]): PdfWikiSentencePointReference[] {
    return this.deduplicateSentencePointReferences((candidates || []).map(candidate => {
      const ref = candidate.ref;
      return {
        ...ref,
        matchType: candidate.matchType === 'citation' ? 'citation' : 'semantic',
        matchScore: Math.round(candidate.score * 1000) / 1000,
      };
    }), 5);
  }

  private deduplicateSentencePointReferences(
    references: PdfWikiSentencePointReference[],
    limit: number
  ): PdfWikiSentencePointReference[] {
    const seen = new Set<string>();
    const result: PdfWikiSentencePointReference[] = [];
    for (const ref of references || []) {
      const key = ref.id || ref.doi || ref.title || ref.raw;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(ref);
    }
    return result.slice(0, limit);
  }

  private getSentencePointMatchMethod(references: PdfWikiSentencePointReference[]): PdfWikiSentencePoint['matchMethod'] {
    const hasCitation = references.some(ref => ref.matchType === 'citation');
    const hasSemantic = references.some(ref => ref.matchType === 'semantic');
    const hasAi = references.some(ref => ref.matchType === 'ai');
    if (hasCitation && hasSemantic && hasAi) return 'citation+semantic+ai';
    if (hasCitation && hasAi) return 'citation+ai';
    if (hasSemantic && hasAi) return 'semantic+ai';
    if (hasCitation && hasSemantic) return 'citation+semantic';
    if (hasCitation) return 'citation';
    if (hasSemantic) return 'semantic';
    if (hasAi) return 'ai';
    return 'none';
  }

  private calculateSentencePointConfidence(references: PdfWikiSentencePointReference[], citations: string[]): number {
    if (references.some(ref => ref.matchType === 'citation')) return citations.length > 0 ? 0.95 : 0.85;
    if (references.some(ref => ref.matchType === 'ai')) {
      const bestAi = Math.max(0, ...references.map(ref => ref.matchScore || 0));
      return Math.max(0.35, Math.min(0.82, bestAi || 0.62));
    }
    const bestSemantic = Math.max(0, ...references.map(ref => ref.matchScore || 0));
    if (bestSemantic > 0) return Math.max(0.35, Math.min(0.78, bestSemantic / 3));
    return 0.1;
  }

  private inferSentencePointTopic(
    sentence: string,
    topicDefinitions: PdfWikiTopicDefinition[] = []
  ): { key: string; label: string; keywords: string[] } {
    const normalizedSentence = this.normalizeTopicMatchText(sentence);
    let best: { definition: PdfWikiTopicDefinition; score: number; matched: string[] } | null = null;

    for (const definition of topicDefinitions) {
      const matched: string[] = [];
      let score = 0;
      const positiveTerms = [
        { value: definition.label, weight: 12 },
        ...definition.aliases.map(value => ({ value, weight: 9 })),
        ...definition.keywords.map(value => ({ value, weight: 5 })),
      ];
      for (const term of positiveTerms) {
        if (!this.topicTermMatches(normalizedSentence, term.value)) continue;
        const normalizedTerm = this.normalizeTopicMatchText(term.value);
        matched.push(term.value);
        score += term.weight + Math.min(5, Math.max(0, normalizedTerm.length - 3) / 4);
      }
      const excluded = definition.excludeKeywords.filter(term => this.topicTermMatches(normalizedSentence, term));
      if (excluded.length > 0) {
        score -= excluded.length * 12;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { definition, score, matched };
      }
    }

    if (!best) {
      return { key: 'unclassified', label: '未分类', keywords: [] };
    }
    return {
      key: this.normalizeSentenceTopicKey(best.definition.id),
      label: best.definition.label,
      keywords: this.unique(best.matched).slice(0, 8),
    };
  }

  private applyTopicDefinitionToPoint(
    point: PdfWikiSentencePoint,
    topicDefinitions: PdfWikiTopicDefinition[]
  ): PdfWikiSentencePoint {
    const topic = this.inferSentencePointTopic(`${point.sentence}\n${point.claimText || ''}`, topicDefinitions);
    const position = this.seededPointPosition(point.id, topic.key);
    return {
      ...point,
      topicKey: topic.key,
      topicLabel: topic.label,
      keywords: topic.keywords,
      x: position.x,
      y: position.y,
    };
  }

  private normalizeTopicMatchText(value: unknown): string {
    return String(value || '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[₂]/g, '2')
      .replace(/[\s\u00a0]+/g, ' ')
      .trim();
  }

  private topicTermMatches(normalizedSentence: string, term: string): boolean {
    const normalizedTerm = this.normalizeTopicMatchText(term);
    if (!normalizedTerm || normalizedTerm.length < 2) return false;
    if (/^[a-z0-9][a-z0-9 +./_-]*$/i.test(normalizedTerm)) {
      const escaped = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
      return new RegExp(`(^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, 'i').test(normalizedSentence);
    }
    return normalizedSentence.includes(normalizedTerm);
  }

  private extractSentencePointKeywords(sentence: string, preferred?: string): string[] {
    const lower = sentence.toLowerCase().replace(/[₂]/g, '2');
    const keywords = [
      preferred || '',
      ...(lower.match(/\bn2o\b|nitrous oxide|nitrogen fertil(?:izer|ization)?|denitrification|nitrification|soil moisture|greenhouse gas|north china plain|crop yield/g) || []),
      ...(sentence.match(/[\u4e00-\u9fa5]{2,8}/g) || []).filter(item => /氮肥|施肥|排放|硝化|反硝化|土壤|水分|作物|产量|农田|机制|华北/.test(item)),
    ];
    return this.unique(keywords.map(item => String(item || '').trim()).filter(Boolean)).slice(0, 8);
  }

  private normalizeSentenceTopicKey(value: string): string {
    return String(value || 'background')
      .toLowerCase()
      .replace(/[₂]/g, '2')
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'background';
  }

  private createEmptyTopicCatalog(): PdfWikiTopicCatalog {
    return { version: 1, updatedAt: new Date(0).toISOString(), topics: [] };
  }

  private normalizeTopicCatalog(value: Partial<PdfWikiTopicCatalog> | unknown): PdfWikiTopicCatalog {
    const record = value && typeof value === 'object' ? value as Partial<PdfWikiTopicCatalog> : {};
    const seenIds = new Set<string>();
    const seenLabels = new Set<string>();
    const topics = (Array.isArray(record.topics) ? record.topics : [])
      .map(topic => this.normalizeTopicDefinition(topic))
      .filter(topic => {
        if (!topic.label) return false;
        const labelKey = topic.label.toLocaleLowerCase();
        if (seenIds.has(topic.id) || seenLabels.has(labelKey)) return false;
        seenIds.add(topic.id);
        seenLabels.add(labelKey);
        return true;
      })
      .slice(0, 50);
    return {
      version: 1,
      updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : new Date().toISOString(),
      topics,
    };
  }

  private normalizeTopicDefinition(value: Partial<PdfWikiTopicDefinition> | unknown): PdfWikiTopicDefinition {
    const record = value && typeof value === 'object' ? value as Partial<PdfWikiTopicDefinition> : {};
    const label = this.cleanTopicText(record.label, 80);
    const now = new Date().toISOString();
    return {
      id: this.cleanTopicText(record.id, 80) || this.createTopicId(label),
      label,
      description: this.cleanTopicText(record.description, 500),
      aliases: this.normalizeTopicTerms(record.aliases, 12),
      keywords: this.normalizeTopicTerms(record.keywords, 30),
      excludeKeywords: this.normalizeTopicTerms(record.excludeKeywords, 12),
      expandedBy: record.expandedBy === 'manual' ? 'manual' : 'ai',
      createdAt: typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'string' && record.updatedAt ? record.updatedAt : now,
    };
  }

  private normalizeTopicTerms(value: unknown, limit: number): string[] {
    const values = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(/[,;，；\n]+/) : []);
    return this.unique(values
      .map(item => this.cleanTopicText(item, 100))
      .filter(item => item.length >= 2))
      .slice(0, limit);
  }

  private cleanTopicText(value: unknown, maxLength: number): string {
    return String(value || '')
      .replace(/[\u0000-\u001f\u007f]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private createTopicId(label: string): string {
    const normalized = this.normalizeTopicMatchText(label) || crypto.randomBytes(8).toString('hex');
    return `topic_${crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16)}`;
  }

  private seededPointPosition(id: string, topicKey: string): { x: number; y: number } {
    const hash = crypto.createHash('md5').update(`${topicKey}:${id}`).digest('hex');
    const a = parseInt(hash.slice(0, 6), 16) / 0xffffff;
    const b = parseInt(hash.slice(6, 12), 16) / 0xffffff;
    return {
      x: Math.round((12 + a * 76) * 10) / 10,
      y: Math.round((14 + b * 72) * 10) / 10,
    };
  }

  private composeSectionPromptText(input: {
    metadataText: string;
    sectionName: string;
    sectionText: string;
    numberedSectionText?: string;
    referenceText: string;
    sentenceReferenceText?: string;
    includeReferences: boolean;
  }): string {
    const sectionText = input.sectionText.trim() || `未检测到 ${input.sectionName} 章节正文。`;
    return [
      'PDF_METADATA',
      input.metadataText,
      '',
      `SECTION: ${input.sectionName}`,
      sectionText,
      input.numberedSectionText ? '\nSECTION_SENTENCES_WITH_IDS' : '',
      input.numberedSectionText || '',
      input.sentenceReferenceText ? '\nSENTENCE_REFERENCE_HINTS' : '',
      input.sentenceReferenceText || '',
      input.includeReferences ? '\nREFERENCES_FOR_CITATION_MATCHING' : '',
      input.includeReferences ? (input.referenceText || '未检测到文末参考文献。') : '',
    ].filter(part => part !== '').join('\n');
  }

  private formatPdfMetadataForPrompt(pdf: PdfWikiSourcePdf): string {
    return [
      `Title: ${pdf.title || pdf.originalName || ''}`,
      `Authors: ${pdf.authors || ''}`,
      `Year: ${pdf.year || ''}`,
      `Journal: ${pdf.journal || ''}`,
      `DOI: ${pdf.doi || ''}`,
    ].join('\n');
  }

  private formatReferencesForPrompt(text: string, referenceIndex: PdfWikiReference[]): string {
    const indexed = (referenceIndex || [])
      .slice(0, 120)
      .map((ref, index) => {
        const raw = String(ref.raw || '').trim();
        const parts = [
          ref.authors ? `Authors: ${ref.authors}` : '',
          ref.year ? `Year: ${ref.year}` : '',
          ref.title ? `Title: ${ref.title}` : '',
          ref.journal ? `Journal: ${ref.journal}` : '',
          ref.doi ? `DOI: ${ref.doi}` : '',
          raw ? `Raw: ${raw}` : '',
        ].filter(Boolean).join('; ');
        return `${ref.index || index + 1}. ${parts}`;
      })
      .filter(line => line.trim().length > 3)
      .join('\n');

    if (indexed) return indexed.slice(0, 30000);
    return this.extractReferenceTail(text).slice(0, 30000);
  }

  private formatNumberedSectionSentences(matches: PdfWikiSentenceReferenceMatch[]): string {
    if (matches.length === 0) return '';
    return [
      '说明：请优先从这些带编号的句子中选择证据句，并把编号写入 evidenceSentenceIds。',
      ...matches.map(match => {
        const refs = match.candidates
          .filter(candidate => candidate.matchType === 'citation')
          .map(candidate => candidate.ref.index ? `[${candidate.ref.index}]` : '')
          .filter(Boolean)
          .slice(0, 3)
          .join(', ');
        const suffix = refs ? ` {matchedRefs=${refs}}` : '';
        return `[${match.sentenceId}] ${match.sentence}${suffix}`;
      }),
    ].join('\n').slice(0, 60000);
  }

  private formatSentenceReferenceHints(
    sectionName: string,
    matchesOrSectionText: PdfWikiSentenceReferenceMatch[] | string,
    referenceIndex?: PdfWikiReference[],
    sourcePdfId?: string
  ): string {
    const matches = Array.isArray(matchesOrSectionText)
      ? matchesOrSectionText
      : this.matchSectionSentencesToReferences(
          sectionName,
          matchesOrSectionText,
          referenceIndex || [],
          sourcePdfId || ''
        );
    if (matches.length === 0) return '';

    const lines: string[] = [
      '说明：以下是系统在发送给 AI 前，对本章节每句话做的本地参考文献候选匹配。',
      '用途：辅助 evidence / inTextCitations 与文末参考文献对齐；不要把候选参考文献当作章节正文论点。',
      '约束：只有 match=citation 或证据句中明确出现的文内引用可作为 referenceIndexes；match=bm25 仅是排查线索，不能当作直接支撑引用。',
      `Section: ${sectionName}`,
    ];
    const maxChars = 36000;

    for (const match of matches) {
      lines.push('');
      lines.push(`[${match.sentenceId}] ${this.compactPromptText(match.sentence, 320)}`);
      lines.push(`Citations: ${match.citations.length > 0 ? match.citations.join('; ') : 'none detected'}`);
      if (match.candidates.length === 0) {
        lines.push('Reference candidates: none');
      } else {
        lines.push('Reference candidates:');
        for (const candidate of match.candidates) {
          const ref = candidate.ref;
          const refIndex = ref.index || '?';
          const parts = [
            ref.authors ? `Authors: ${ref.authors}` : '',
            ref.year ? `Year: ${ref.year}` : '',
            ref.title ? `Title: ${ref.title}` : '',
            ref.journal ? `Journal: ${ref.journal}` : '',
            ref.doi ? `DOI: ${ref.doi}` : '',
          ].filter(Boolean).join('; ');
          const rawFallback = parts || this.compactPromptText(ref.raw || '', 260);
          lines.push(`- [${refIndex}] ${rawFallback} (match=${candidate.matchType}, score=${candidate.score.toFixed(2)})`);
        }
      }

      if (lines.join('\n').length > maxChars) {
        lines.push('');
        lines.push('[sentence reference hints truncated]');
        break;
      }
    }

    return lines.join('\n').slice(0, maxChars);
  }

  private matchSectionSentencesToReferences(
    sectionName: string,
    sectionText: string,
    referenceIndex: PdfWikiReference[],
    sourcePdfId: string,
    maxSentences = 160,
    options: { includeSemanticCandidates?: boolean; terminalCitationsOnly?: boolean } = {}
  ): PdfWikiSentenceReferenceMatch[] {
    const sentences = this.splitSectionIntoSentences(sectionText, maxSentences);
    const references = (referenceIndex || []).filter(ref => !sourcePdfId || !ref.sourcePdfId || ref.sourcePdfId === sourcePdfId);
    if (sentences.length === 0) return [];
    if (references.length === 0) {
      return sentences.map((sentence, index) => ({
        sentenceId: this.makeSentenceEvidenceId(sectionName, index + 1),
        sentenceIndex: index + 1,
        sentence,
        citations: options.terminalCitationsOnly ? this.extractTerminalInTextCitations(sentence) : this.extractInTextCitations(sentence),
        candidates: [],
      }));
    }

    const includeSemanticCandidates = options.includeSemanticCandidates !== false;
    const bm25Index = includeSemanticCandidates ? this.buildReferenceBm25Index(references) : [];
    return sentences.map((sentence, index) => {
      const citations = options.terminalCitationsOnly ? this.extractTerminalInTextCitations(sentence) : this.extractInTextCitations(sentence);
      const strongMatches = this.matchReferencesForCitations(citations, references, [sourcePdfId]);
      const candidates: PdfWikiSentenceReferenceCandidate[] = strongMatches.map(ref => ({
        ref,
        score: 100,
        matchType: 'citation',
      }));
      const seen = new Set(candidates.map(candidate => candidate.ref.id));
      const bm25Matches = citations.length > 0 || !includeSemanticCandidates
        ? []
        : this.scoreReferencesWithBm25(sentence, bm25Index)
          .filter(candidate => !seen.has(candidate.ref.id))
          .slice(0, Math.max(0, 3 - candidates.length));

      for (const candidate of bm25Matches) {
        if (candidate.score < (citations.length > 0 ? 0.8 : 1.2)) continue;
        candidates.push(candidate);
        seen.add(candidate.ref.id);
      }

      return {
        sentenceId: this.makeSentenceEvidenceId(sectionName, index + 1),
        sentenceIndex: index + 1,
        sentence,
        citations,
        candidates: candidates.slice(0, 3),
      };
    });
  }

  private buildSentenceEvidenceMap(
    sectionName: string,
    sectionText: string,
    referenceIndex: PdfWikiReference[],
    sourcePdfId: string
  ): Map<string, PdfWikiSentenceEvidence> {
    return this.sentenceEvidenceMapFromMatches(
      sectionName,
      this.matchSectionSentencesToReferences(sectionName, sectionText, referenceIndex, sourcePdfId, sectionName === 'FullText' ? 600 : 160)
    );
  }

  private sentenceEvidenceMapFromMatches(
    sectionName: string,
    matches: PdfWikiSentenceReferenceMatch[]
  ): Map<string, PdfWikiSentenceEvidence> {
    const map = new Map<string, PdfWikiSentenceEvidence>();
    for (const match of matches) {
      const evidence: PdfWikiSentenceEvidence = {
        id: match.sentenceId,
        sectionName,
        sentenceIndex: match.sentenceIndex,
        sentence: match.sentence,
        citations: match.citations,
        references: this.uniqueReferences(match.candidates
          .filter(candidate => candidate.matchType === 'citation')
          .map(candidate => candidate.ref)),
      };
      this.addSentenceEvidenceAliases(map, evidence);
    }
    return map;
  }

  private addSentenceEvidenceAliases(
    map: Map<string, PdfWikiSentenceEvidence>,
    evidence: PdfWikiSentenceEvidence
  ): void {
    const aliases = [
      evidence.id,
      `[${evidence.id}]`,
      `S${evidence.sentenceIndex}`,
      `[S${evidence.sentenceIndex}]`,
      `${evidence.sectionName}-S${evidence.sentenceIndex}`,
      `${evidence.sectionName.toLowerCase()}-s${evidence.sentenceIndex}`,
    ];
    for (const alias of aliases) {
      map.set(this.normalizeSentenceEvidenceId(alias), evidence);
    }
  }

  private makeSentenceEvidenceId(sectionName: string, sentenceIndex: number): string {
    const normalizedSection = String(sectionName || 'Section')
      .replace(/[^A-Za-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'Section';
    return `${normalizedSection}-S${sentenceIndex}`;
  }

  private normalizeSentenceEvidenceId(value: string): string {
    return String(value || '')
      .trim()
      .replace(/^[\[\](){}]+|[\[\](){}]+$/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
  }

  private splitSectionIntoSentences(text: string, maxSentences: number): string[] {
    const normalized = this.normalizeExtractedText(text)
      .replace(/\bet al\./gi, 'et al<prd>')
      .replace(/\be\.g\./gi, 'e<prd>g<prd>')
      .replace(/\bi\.e\./gi, 'i<prd>e<prd>')
      .replace(/\bFig\./g, 'Fig<prd>')
      .replace(/\bEq\./g, 'Eq<prd>')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) return [];

    return normalized
      .split(/(?<=[。！？!?])\s+|(?<=\.)\s+(?=[A-Z[(])/g)
      .map(sentence => sentence.replace(/<prd>/g, '.').replace(/^#+\s*/, '').trim())
      .filter(sentence => sentence.length >= 24 && !this.isLikelyShortHeading(sentence))
      .slice(0, maxSentences);
  }

  private async inferManualSentenceLocation(
    userId: string,
    pdf: PdfWikiSourcePdf,
    sentence: string,
    requestedSection?: PdfWikiSentenceSection,
    pageNumber?: number
  ): Promise<{ section: PdfWikiSentenceSection; sentenceIndex: number; location: string }> {
    if (requestedSection) {
      return {
        section: requestedSection,
        sentenceIndex: 1,
        location: `${requestedSection}${pageNumber && pageNumber > 0 ? ` · p.${pageNumber}` : ''}`,
      };
    }

    const parsed = await this.loadParsedTextCache(userId, pdf).catch(() => null);
    const bodyText = parsed?.text ? this.stripReferenceTail(parsed.text) : '';
    const normalizedTarget = this.normalizeManualSentenceSearchText(sentence);
    const sections: Array<{ section: PdfWikiSentenceSection; text: string }> = bodyText ? [
      {
        section: 'Introduction',
        text: this.extractSectionByHeading(bodyText, [
          'introduction',
          'background',
        ], [
          'materials and methods',
          'material and methods',
          'methods',
          'methodology',
          'experimental procedures',
          'results',
          'results and discussion',
          'discussion',
          'conclusion',
          'conclusions',
          'references',
          'acknowledgements',
          'acknowledgments',
        ]) || this.fallbackIntroductionText(bodyText),
      },
      {
        section: 'Discussion',
        text: this.extractSectionByHeading(bodyText, [
          'discussion',
          'results and discussion',
          'discussion and conclusions',
          'discussion and conclusion',
        ], [
          'conclusion',
          'conclusions',
          'summary and conclusions',
          'concluding remarks',
          'references',
          'acknowledgements',
          'acknowledgments',
          'supplementary',
        ]),
      },
      {
        section: 'Conclusion',
        text: this.extractSectionByHeading(bodyText, [
          'conclusion',
          'conclusions',
          'summary and conclusions',
          'concluding remarks',
        ], [
          'references',
          'bibliography',
          'literature cited',
          'acknowledgements',
          'acknowledgments',
          'supplementary',
        ]),
      },
    ] : [];

    for (const item of sections) {
      if (!item.text) continue;
      const sentences = this.splitSectionIntoSentences(item.text, 1200);
      const matchIndex = sentences.findIndex(candidate => {
        const normalizedCandidate = this.normalizeManualSentenceSearchText(candidate);
        return normalizedCandidate.includes(normalizedTarget) || normalizedTarget.includes(normalizedCandidate);
      });
      if (matchIndex >= 0) {
        const sentenceIndex = matchIndex + 1;
        return {
          section: item.section,
          sentenceIndex,
          location: `${item.section} S${sentenceIndex}${pageNumber && pageNumber > 0 ? ` · p.${pageNumber}` : ''}`,
        };
      }
    }

    return {
      section: 'Discussion',
      sentenceIndex: Math.max(1, pageNumber && pageNumber > 0 ? pageNumber : 1),
      location: pageNumber && pageNumber > 0 ? `p.${pageNumber}` : '手动保存',
    };
  }

  private normalizeManualSentenceSearchText(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[“”"']/g, '')
      .replace(/[。！？!?.,;:，；：()[\]{}]/g, '')
      .trim()
      .slice(0, 1600);
  }

  private isLikelyShortHeading(text: string): boolean {
    const normalized = text.replace(/[：:.\-–—]+$/g, '').trim();
    if (!normalized) return true;
    if (normalized.length > 90) return false;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    if (tokens.length > 10) return false;
    return !/[。！？!?.]\s*$/.test(text) && /^[A-Z0-9\s/&-]+$/.test(normalized);
  }

  private buildReferenceBm25Index(references: PdfWikiReference[]): Array<{
    ref: PdfWikiReference;
    tokens: string[];
    termCounts: Map<string, number>;
    length: number;
    df: Map<string, number>;
    avgLength: number;
    totalDocs: number;
  }> {
    const docs = references.map(ref => {
      const tokens = this.tokenizeForReferenceMatching([
        ref.authors,
        ref.year,
        ref.title,
        ref.journal,
        ref.doi,
        ref.raw,
      ].filter(Boolean).join(' '));
      const termCounts = new Map<string, number>();
      for (const token of tokens) {
        termCounts.set(token, (termCounts.get(token) || 0) + 1);
      }
      return { ref, tokens, termCounts };
    });
    const df = new Map<string, number>();
    for (const doc of docs) {
      for (const token of new Set(doc.tokens)) {
        df.set(token, (df.get(token) || 0) + 1);
      }
    }
    const totalDocs = Math.max(1, docs.length);
    const avgLength = Math.max(1, docs.reduce((sum, doc) => sum + doc.tokens.length, 0) / totalDocs);

    return docs.map(doc => ({
      ...doc,
      length: Math.max(1, doc.tokens.length),
      df,
      avgLength,
      totalDocs,
    }));
  }

  private scoreReferencesWithBm25(
    sentence: string,
    docs: ReturnType<PdfWikiManager['buildReferenceBm25Index']>
  ): PdfWikiSentenceReferenceCandidate[] {
    const queryTokens = this.tokenizeForReferenceMatching(sentence);
    if (queryTokens.length === 0 || docs.length === 0) return [];

    const uniqueQueryTokens = Array.from(new Set(queryTokens));
    const k1 = 1.4;
    const b = 0.75;
    return docs
      .map(doc => {
        let score = 0;
        for (const token of uniqueQueryTokens) {
          const tf = doc.termCounts.get(token) || 0;
          if (tf <= 0) continue;
          const df = doc.df.get(token) || 0;
          const idf = Math.log(1 + (doc.totalDocs - df + 0.5) / (df + 0.5));
          score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (doc.length / doc.avgLength))));
        }
        return {
          ref: doc.ref,
          score,
          matchType: 'bm25' as const,
        };
      })
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }

  private tokenizeForReferenceMatching(text: string): string[] {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'that', 'this', 'from', 'were', 'was', 'are', 'has', 'have',
      'had', 'not', 'but', 'can', 'may', 'into', 'than', 'then', 'also', 'such', 'their',
      'soil', 'study', 'studies', 'effect', 'effects', 'using', 'used', 'between', 'under',
      'during', 'after', 'before', 'across', 'based', 'showed', 'shown', 'reported',
    ]);
    const normalized = String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, ' ')
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ');
    return (normalized.match(/[a-z0-9]{2,}|[\u4e00-\u9fa5]{2,}/g) || [])
      .filter(token => !stopWords.has(token) && !/^\d{1,3}$/.test(token));
  }

  private fallbackIntroductionText(text: string): string {
    const normalized = this.normalizeExtractedText(text);
    const stop = this.findFirstHeadingOffset(normalized, [
      'materials and methods',
      'material and methods',
      'methods',
      'methodology',
      'results',
      'results and discussion',
      'discussion',
    ], 1500);
    const start = Math.min(9000, Math.max(0, normalized.toLowerCase().indexOf('abstract')));
    const end = stop > start ? stop : Math.min(normalized.length, 25000);
    return normalized.slice(start > 0 ? start : 0, end).trim();
  }

  private extractSectionByHeading(text: string, aliases: string[], stopAliases: string[]): string {
    const normalized = this.normalizeExtractedText(text);
    const lines = normalized.split('\n');
    let offset = 0;
    let start = -1;
    let startLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (this.headingMatches(line, aliases)) {
        start = offset + line.length + 1;
        startLine = i;
        break;
      }
      offset += line.length + 1;
    }

    if (start < 0) return '';

    let end = normalized.length;
    offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (i > startLine && this.headingMatches(line, stopAliases)) {
        end = offset;
        break;
      }
      offset += line.length + 1;
    }

    return normalized.slice(start, end).trim();
  }

  private findFirstHeadingOffset(text: string, aliases: string[], minOffset: number): number {
    const normalized = this.normalizeExtractedText(text);
    const lines = normalized.split('\n');
    let offset = 0;
    for (const line of lines) {
      if (offset >= minOffset && this.headingMatches(line, aliases)) {
        return offset;
      }
      offset += line.length + 1;
    }
    return -1;
  }

  private headingMatches(line: string, aliases: string[]): boolean {
    const heading = this.normalizeHeadingLine(line);
    if (!heading) return false;
    return aliases.some(alias => {
      const normalizedAlias = this.normalizeHeadingLine(alias);
      return heading === normalizedAlias
        || heading.startsWith(`${normalizedAlias} `)
        || heading.includes(` ${normalizedAlias}`)
        || heading.includes(`${normalizedAlias} and`);
    });
  }

  private normalizeHeadingLine(line: string): string {
    const raw = String(line || '').trim();
    if (!raw || raw.length > 160) return '';
    const withoutMarkup = raw
      .replace(/^#{1,6}\s*/, '')
      .replace(/^\*\*(.*?)\*\*$/, '$1')
      .replace(/^[_*]+|[_*]+$/g, '')
      .replace(/^\s*(section|chapter)\s+/i, '')
      .replace(/^\s*(\d+(?:\.\d+)*|[ivxlcdm]+)\s*[.)]?\s+/i, '')
      .replace(/\s+/g, ' ')
      .replace(/[：:.\-–—]+$/g, '')
      .trim()
      .toLowerCase();
    if (!withoutMarkup || withoutMarkup.split(/\s+/).length > 14) return '';
    return withoutMarkup;
  }

  private async extractClaimsFromChunk(input: {
    userId: string;
    text: string;
    chunkIndex: number;
    totalChunks: number;
    sectionName?: string;
    pdf: PdfWikiSourcePdf;
    llmConfig: PdfWikiLlmConfig;
    codexConfig?: PdfWikiCodexConfig;
  }): Promise<ExtractedClaim[]> {
    if (input.codexConfig && this.shouldUseCodexForClaimExtraction(input.llmConfig)) {
      try {
        return await this.extractClaimsFromChunkWithCodex(input, input.codexConfig);
      } catch (error) {
        logger.warn(`[PdfWiki] Codex CLI claim extraction failed for section ${input.chunkIndex + 1}/${input.totalChunks}, falling back to configured API:`, error);
      }
    }

    if (this.shouldUseQwenLongForClaimExtraction(input.llmConfig) && this.shouldUseQwenLongDirectPdf(input.llmConfig)) {
      try {
        const claims = await this.extractClaimsFromChunkWithLongText(input);
        if (claims.length > 0) return claims;
      } catch (error) {
        logger.warn(`[PdfWiki] Qwen-VL-Max text claim extraction failed for section ${input.chunkIndex + 1}/${input.totalChunks}, retrying JSON extraction:`, error);
      }
    }

    if (!this.shouldUseApiForClaimExtraction(input.llmConfig)) {
      return [];
    }

    const prompt = `你是严谨的论文 PDF 知识库构建助手。请只基于给定 PDF 章节输入，抽取可用于论文写作检索的论点 wiki。

PDF：${input.pdf.originalName}
章节调用：${input.chunkIndex + 1}/${input.totalChunks}

要求：
1. 只从 SECTION 章节正文中抽取 PDF 明确出现的科学论点；REFERENCES_FOR_CITATION_MATCHING 只用于解析文中引用，不要从参考文献列表本身抽取论点。
2. Introduction/Background 中的研究假设、科学争议、研究空白、机制解释、前人研究观点都要抽取；不要因为它们不是作者结果就跳过。
3. 如果 PDF 作者把某个观点作为自己的假设、结果、发现、结论或讨论判断提出，应放入 proViews，表示这篇 PDF 支持该论点。
4. 如果文本属于 Discussion/讨论部分，必须梳理每个论点的正向观点和反向/限制性观点，尤其是与前人研究一致/不一致、限制条件和作者解释。
5. conViews 只放 PDF 中明确提出的反向结果、限制条件、争议观点或与该论点相冲突的证据。
6. neutralViews 只放纯背景、机制解释或不能直接支撑/反对该论点的内容；不要把 PDF 自身结果和结论放入 neutralViews。
7. 每个观点都要尽量保留文中引用，如 "(Smith et al., 2020)"、"Smith et al. (2020)"、"[12]" 或 "(12)"；如果证据句附近有引用，不要漏掉。
8. 必须优先从 SECTION_SENTENCES_WITH_IDS 中选择证据句，并把句子编号写入 evidenceSentenceIds，例如 ["Introduction-S12"]；如果同一论点由多句话支持，可以写多个编号。
9. 如果输入中有 SENTENCE_REFERENCE_HINTS，应优先用它核对 evidenceSentenceIds 对应的参考文献候选；只有证据句中明确出现的引用或 match=citation 候选才能写入 referenceIndexes，match=bm25 只能作为排查线索，不能当作直接支撑引用；不要把候选参考文献当作章节正文论点。
10. 本阶段只抽取论点、观点、证据、证据句编号和文中引用；不要输出参考文献详细信息。
11. 不要编造 PDF 中没有的信息；缺失字段留空。
12. claim 和 summary 用中文；evidence 尽量保留 PDF 原文短摘录。
13. PDF_METADATA 中的标题、作者、年份、期刊、DOI 必须作为上下文使用，不要忽略。
14. 不要为了让论点看起来“有支持观点”而把 neutralViews 改写为 proViews；无法确定立场就保留 neutralViews。
15. 每个 proViews/conViews/neutralViews 项都必须尽量绑定 evidenceSentenceIds；如果无法定位原文证据句，不要输出该 viewpoint。

PDF 章节输入：
${input.text}

只返回 JSON，不要 Markdown：
{
  "claims": [
    {
      "claim": "论点本身",
      "section": "所在章节，如 Discussion/Introduction/Results",
      "location": "文本块或页码线索",
      "discussionPoint": "如果是讨论部分，写该讨论点",
      "proViews": [
        {"summary": "正向或支持观点", "evidence": "该观点对应的原文证据", "evidenceSentenceIds": ["Introduction-S12"], "inTextCitations": ["该观点对应的文中引用"], "referenceIndexes": [12]}
      ],
      "conViews": [
        {"summary": "反向、限制性或争议观点", "evidence": "该观点对应的原文证据", "evidenceSentenceIds": [], "inTextCitations": ["该观点对应的文中引用"], "referenceIndexes": []}
      ],
      "neutralViews": [
        {"summary": "中性背景或机制解释", "evidence": "该观点对应的原文证据", "evidenceSentenceIds": [], "inTextCitations": ["该观点对应的文中引用"], "referenceIndexes": []}
      ],
      "evidence": "PDF 中支撑该论点的原文短摘录，不超过120字",
      "evidenceSentenceIds": ["Introduction-S12"],
      "inTextCitations": ["文中引用"],
      "referenceIndexes": [12]
    }
  ]
}`;

    try {
      const parsed = await this.callJsonNormalizer(input.llmConfig, prompt, 5000, this.getClaimJsonLabel(input));
      return this.filterExtractedClaims(parsed);
    } catch (error) {
      if (!this.isRecoverableClaimExtractionError(error)) throw error;
      logger.warn(`[PdfWiki] Empty/invalid claim JSON for section ${input.chunkIndex + 1}/${input.totalChunks}, retrying with compact prompt: ${(error as Error).message}`);
    }

    const compactText = this.compactChunkForClaimExtraction(input.text, 6500);
    const retryPrompt = `请从下面 PDF 章节输入中抽取最多 12 个高质量论点。优先抽取 Introduction/Background 和 Discussion 中的研究假设、研究空白、机制解释、正反观点、限制条件和与前人研究一致/不一致的讨论。

硬性要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. 如果没有可抽取论点，必须返回 {"claims":[]}，不要返回空内容。
3. claim 和 summary 用中文；evidence 保留原文短摘录；inTextCitations 保留 "(Smith et al., 2020)"、"[12]"、"(12)" 等文中引用。
4. 必须优先从 SECTION_SENTENCES_WITH_IDS 中选择证据句，并返回 evidenceSentenceIds；如果看到明确的参考文献编号，同时返回 referenceIndexes。
5. 只从 SECTION 章节正文中抽取论点；SENTENCE_REFERENCE_HINTS 和 REFERENCES_FOR_CITATION_MATCHING 只用于引用匹配，不要从参考文献列表抽取论点。
6. 不要把 neutral/background views 改写为 support/proViews；每个 viewpoint 尽量绑定 evidenceSentenceIds，无法定位原文证据句就跳过该 viewpoint。

PDF：${input.pdf.originalName}
章节调用：${input.chunkIndex + 1}/${input.totalChunks}

文本：
${compactText}

返回格式：
{"claims":[{"claim":"","section":"","location":"","discussionPoint":"","proViews":[{"summary":"","evidence":"","evidenceSentenceIds":[],"inTextCitations":[],"referenceIndexes":[]}],"conViews":[],"neutralViews":[],"evidence":"","evidenceSentenceIds":[],"inTextCitations":[],"referenceIndexes":[]}]}`;

    try {
      const parsed = await this.callJsonNormalizer(input.llmConfig, retryPrompt, 4000, `${this.getClaimJsonLabel(input)} retry`);
      return this.filterExtractedClaims(parsed);
    } catch (error) {
      if (this.isRecoverableClaimExtractionError(error)) {
        logger.warn(`[PdfWiki] Claim extraction retry failed for section ${input.chunkIndex + 1}/${input.totalChunks}; treating this section as no claims: ${(error as Error).message}`);
        return [];
      }
      throw error;
    }
  }

  private async extractClaimsFromChunkWithCodex(input: {
    userId: string;
    text: string;
    chunkIndex: number;
    totalChunks: number;
    sectionName?: string;
    pdf: PdfWikiSourcePdf;
  }, codexConfig: PdfWikiCodexConfig): Promise<ExtractedClaim[]> {
    const prompt = `你是严谨的论文 PDF Wiki 论点抽取代理。请只基于给定 PDF 章节输入，抽取可用于论文写作检索的论点。

PDF：${input.pdf.originalName}
章节调用：${input.chunkIndex + 1}/${input.totalChunks}
章节名：${input.sectionName || 'Unknown'}

要求：
1. 只从 SECTION 章节正文抽取 PDF 明确出现的科学论点；REFERENCES_FOR_CITATION_MATCHING 只用于解析文中引用，不要从参考文献列表本身抽取论点。
2. Introduction/Background 中的研究假设、科学争议、研究空白、机制解释、前人研究观点都要抽取。
3. Discussion/讨论中每一个独立讨论点都要梳理，尤其是机制解释、与前人研究一致/不一致、限制条件、反向证据和作者解释。
4. 如果 PDF 作者把某个观点作为自己的假设、结果、发现、结论或讨论判断提出，放入 proViews。
5. 如果 PDF 中明确提出反向结果、限制条件、争议观点或冲突证据，放入 conViews。
6. 如果观点来自前人研究、背景机制或不能直接代表本文结果，放入 neutralViews，并保留文中引用。
7. 每个 viewpoint 都必须尽量保留 evidence 原文短摘录、evidenceSentenceIds、inTextCitations 和 referenceIndexes；referenceIndexes 只能来自证据句中明确出现的引用或 match=citation 候选，不能使用 match=bm25 候选。
8. Evidence sentence IDs 必须来自 SECTION_SENTENCES_WITH_IDS，例如 Introduction-S12；不要编造不存在的句子编号。
9. claim 和 summary 用中文；evidence 保留 PDF 原文。
10. 如果没有可抽取论点，返回 {"claims":[]}。
11. 不要为了补齐支持观点把 neutralViews 转成 proViews；无法绑定原文证据句的 viewpoint 不要输出。

PDF 章节输入：
${input.text}

返回 JSON 格式：
{
  "claims": [
    {
      "claim": "论点本身",
      "section": "所在章节",
      "location": "文本块或页码线索",
      "discussionPoint": "讨论点",
      "proViews": [
        {"summary": "支持观点", "evidence": "原文证据", "evidenceSentenceIds": ["Introduction-S12"], "inTextCitations": ["文中引用"], "referenceIndexes": [12]}
      ],
      "conViews": [
        {"summary": "反向、限制性或争议观点", "evidence": "原文证据", "evidenceSentenceIds": [], "inTextCitations": [], "referenceIndexes": []}
      ],
      "neutralViews": [
        {"summary": "中性背景或机制解释", "evidence": "原文证据", "evidenceSentenceIds": [], "inTextCitations": [], "referenceIndexes": []}
      ],
      "evidence": "支撑该论点的原文短摘录",
      "evidenceSentenceIds": ["Introduction-S12"],
      "inTextCitations": ["文中引用"],
      "referenceIndexes": [12]
    }
  ]
}`;
    const safePdfId = this.getSafePdfCacheId(input.pdf);
    const taskDir = path.join(
      this.getCodexPdfWikiAuxTaskDir(input.userId, `claims_${safePdfId}`),
      `section_${input.chunkIndex + 1}`
    );
    const parsed = await this.callCodexJsonTask(codexConfig, taskDir, prompt, this.getClaimJsonLabel(input));
    return this.filterExtractedClaims(parsed);
  }

  private async extractClaimsFromChunkWithLongText(input: {
    text: string;
    chunkIndex: number;
    totalChunks: number;
    sectionName?: string;
    pdf: PdfWikiSourcePdf;
    llmConfig: PdfWikiLlmConfig;
  }): Promise<ExtractedClaim[]> {
    const prompt = `请阅读下面从 PDF 解析出的章节输入，抽取用于 PDF Wiki 的论点。只输出普通文本，不要输出 JSON，不要 Markdown 代码块。

PDF：${input.pdf.originalName}
章节调用：${input.chunkIndex + 1}/${input.totalChunks}

要求：
1. 只从 SECTION 章节正文中抽取论点；SENTENCE_REFERENCE_HINTS 和 REFERENCES_FOR_CITATION_MATCHING 只用于理解和保留文中引用，不要从参考文献列表本身抽取论点。
2. 如果作者把某个观点作为自己的假设、发现、结论或讨论判断提出，放入 Support views。
3. 如果是反向结果、限制条件、争议观点或冲突证据，放入 Oppose/limitation views。
4. 如果是前人研究、背景机制或不能直接支撑/反对本文结果的内容，放入 Neutral/background views。
5. 每个观点都尽量保留 Evidence、Evidence sentence IDs 和 In-text citations；没有论点也要输出 "CLAIMS: empty"，不要返回空内容。
6. Evidence sentence IDs 必须来自 SECTION_SENTENCES_WITH_IDS，例如 Introduction-S12；只有证据句中明确出现的引用或 match=citation 候选才能写 Reference indexes，match=bm25 候选不能作为直接支撑引用。
7. Claim、Summary 用中文；Evidence 保留 PDF 原文短摘录。
8. PDF_METADATA 中的标题、作者、年份、期刊、DOI 必须作为上下文使用，不要忽略。

PDF 章节输入：
${input.text}

输出格式：
CLAIM 1
Claim:
Section:
Location:
Discussion point:
Support views:
- Summary:
  Evidence:
  Evidence sentence IDs:
  In-text citations:
  Reference indexes:
Oppose/limitation views:
- Summary:
  Evidence:
  Evidence sentence IDs:
  In-text citations:
  Reference indexes:
Neutral/background views:
- Summary:
  Evidence:
  Evidence sentence IDs:
  In-text citations:
  Reference indexes:`;

    const rawText = await this.callChatCompletionWithMessages(input.llmConfig, [
      { role: 'system', content: '你是严谨的学术论文论点抽取助手。请输出普通文本，不要 JSON。' },
      { role: 'user', content: prompt },
    ], 9000, false);

    if (!rawText.trim()) {
      throw new Error('Qwen-VL-Max returned empty claim text');
    }

    const normalizePrompt = `你是严格的 PDF Wiki 论点 JSON 整理器。下面是长上下文模型从 PDF 文本块中读出的普通文本，请整理为合法 JSON。

要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. claims 只来自输入文本，不要新增论点。
3. Support views -> proViews；Oppose/limitation views -> conViews；Neutral/background views -> neutralViews。
4. 每个 evidence 和 inTextCitations 尽量保留原文；如果 evidence 或 summary 里出现文中引用，必须放进 inTextCitations。
5. 如果输入文本中出现 Evidence sentence IDs 或 Reference indexes，必须整理进 evidenceSentenceIds 和 referenceIndexes。
6. claim、summary 用中文；evidence 保留原文证据。
7. 如果输入没有论点，返回 {"claims":[]}。

输入文本：
${rawText.slice(0, 50000)}

返回格式：
{"claims":[{"claim":"","section":"","location":"","discussionPoint":"","proViews":[{"summary":"","evidence":"","evidenceSentenceIds":[],"inTextCitations":[],"referenceIndexes":[]}],"conViews":[],"neutralViews":[],"evidence":"","evidenceSentenceIds":[],"inTextCitations":[],"referenceIndexes":[]}]}`;

    const parsed = await this.callJsonNormalizer(input.llmConfig, normalizePrompt, 6000, this.getClaimJsonLabel(input));
    return this.filterExtractedClaims(parsed);
  }

  private getClaimJsonLabel(input: { sectionName?: string; chunkIndex: number }): string {
    const sectionName = input.sectionName || (input.chunkIndex === 0 ? 'Introduction' : input.chunkIndex === 1 ? 'Discussion' : 'Conclusion');
    return `${sectionName} claim`;
  }

  private filterExtractedClaims(parsed: Record<string, unknown>): ExtractedClaim[] {
    const claims = Array.isArray(parsed?.claims) ? parsed.claims : [];
    return claims
      .map(claim => this.normalizeExtractedClaim(claim))
      .filter((claim): claim is ExtractedClaim => !!claim);
  }

  private normalizeExtractedClaim(value: unknown): ExtractedClaim | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    const claimText = String(record.claim || record.argument || record.statement || '').trim();
    if (!claimText) return null;
    return {
      claim: claimText,
      section: record.section ? String(record.section) : undefined,
      location: record.location ? String(record.location) : undefined,
      discussionPoint: record.discussionPoint || record.discussion_point ? String(record.discussionPoint || record.discussion_point) : undefined,
      proViews: Array.isArray(record.proViews) ? record.proViews : this.firstArray(record.supportViews, record.support_views, record.support),
      conViews: Array.isArray(record.conViews) ? record.conViews : this.firstArray(record.opposeViews, record.limitationViews, record.con_views, record.opposition),
      neutralViews: Array.isArray(record.neutralViews) ? record.neutralViews : this.firstArray(record.backgroundViews, record.neutral_views, record.background),
      evidence: record.evidence ? String(record.evidence) : undefined,
      inTextCitations: this.toStringArray(record.inTextCitations || record.in_text_citations || record.citations),
      evidenceSentenceIds: this.toStringArray(record.evidenceSentenceIds || record.evidence_sentence_ids || record.sentenceIds || record.sentence_ids),
      referenceIndexes: this.toNumberArray(record.referenceIndexes || record.reference_indexes),
      references: Array.isArray(record.references) ? record.references as Array<Partial<PdfWikiReference>> : [],
    };
  }

  private isRecoverableClaimExtractionError(error: unknown): boolean {
    const message = (error as Error)?.message || '';
    return /empty JSON response|JSON empty|empty claim text|did not return valid JSON|invalid JSON|JSON invalid|JSON repair failed/i.test(message);
  }

  private compactChunkForClaimExtraction(text: string, maxLength: number): string {
    const normalized = this.normalizeExtractedText(text);
    if (normalized.length <= maxLength) return normalized;

    const paragraphs = normalized.split(/\n{2,}/).map(part => part.trim()).filter(Boolean);
    const highValue = paragraphs.filter(paragraph =>
      /(introduction|background|discussion|hypothes|limitation|however|whereas|contrary|consistent|inconsistent|suggest|indicat|show|found|result|mechanism|previous|reported|meta-analysis)/i.test(paragraph)
    ).join('\n\n');

    if (highValue.length >= Math.min(1200, maxLength / 3)) {
      return highValue.slice(0, maxLength);
    }

    const headLength = Math.floor(maxLength * 0.62);
    const tailLength = maxLength - headLength - 40;
    return `${normalized.slice(0, headLength)}\n\n...[middle omitted]...\n\n${normalized.slice(-tailLength)}`;
  }

  private createEntryFromClaim(
    claim: ExtractedClaim,
    pdf: PdfWikiSourcePdf,
    chunkIndex: number,
    referencePool: PdfWikiReference[] = [],
    sentenceEvidence: Map<string, PdfWikiSentenceEvidence> = new Map()
  ): PdfWikiEntry | null {
    const claimText = String(claim.claim || '').trim();
    if (!claimText) return null;

    const claimSentenceEvidence = this.resolveEvidenceSentences(
      claim.evidenceSentenceIds || [],
      String(claim.evidence || ''),
      sentenceEvidence
    );
    const sentenceCitations = claimSentenceEvidence.flatMap(item => item.citations);
    const sentenceReferences = claimSentenceEvidence.flatMap(item => item.references);
    const explicitClaimReferences = this.resolveReferences(claim, referencePool, pdf.id);
    const inTextCitations = Array.isArray(claim.inTextCitations)
      ? claim.inTextCitations.map(String).filter(Boolean)
      : this.extractInTextCitations(`${claimText} ${claim.evidence || ''}`);
    const evidenceReferences = this.uniqueReferences([
      ...sentenceReferences,
      ...this.matchReferencesForCitations([...inTextCitations, ...sentenceCitations], referencePool, [pdf.id]),
    ]);
    const claimReferences = sentenceEvidence.size > 0 && claimSentenceEvidence.length > 0
      ? evidenceReferences
      : this.uniqueReferences([
        ...explicitClaimReferences,
        ...evidenceReferences,
      ]);
    const section = String(claim.section || '').trim() || 'Unknown';
    const location = String(claim.location || '').trim() || `section-${chunkIndex + 1}`;
    const evidence = String(claim.evidence || '').trim();
    const totalViewCount = this.countViews(claim.proViews) + this.countViews(claim.conViews) + this.countViews(claim.neutralViews);
    const hasInputViews = totalViewCount > 0;
    const useSharedEvidenceForCitations = totalViewCount <= 1;

    const pro = this.toViewpoints(claim.proViews, 'support', claimReferences, pdf, section, location, evidence, useSharedEvidenceForCitations, referencePool, sentenceEvidence);
    const con = this.toViewpoints(claim.conViews, 'oppose', claimReferences, pdf, section, location, evidence, useSharedEvidenceForCitations, referencePool, sentenceEvidence);
    const neutral = this.toViewpoints(claim.neutralViews, 'neutral', claimReferences, pdf, section, location, evidence, useSharedEvidenceForCitations, referencePool, sentenceEvidence);

    if (pro.length === 0 && con.length === 0 && neutral.length === 0) {
      if (sentenceEvidence.size > 0 && claimSentenceEvidence.length === 0) {
        logger.warn(`[PdfWiki] Dropped claim without verifiable evidence sentence: ${claimText.slice(0, 120)} (${pdf.originalName})`);
        return null;
      }
      if (hasInputViews) {
        logger.warn(`[PdfWiki] Dropped claim after all viewpoints failed evidence binding: ${claimText.slice(0, 120)} (${pdf.originalName})`);
        return null;
      }
      pro.push({
        stance: 'support',
        summary: claimText,
        evidence,
        section,
        location,
        inTextCitations: this.unique([...inTextCitations, ...sentenceCitations]),
        evidenceSentenceIds: claimSentenceEvidence.map(item => item.id),
        evidenceSentences: claimSentenceEvidence.map(item => item.sentence),
        references: claimReferences,
        sourcePdfId: pdf.id,
        sourcePdfName: pdf.originalName,
      });
    }

    const evidenceSentenceIds = this.unique([
      ...claimSentenceEvidence.map(item => item.id),
      ...pro.flatMap(view => view.evidenceSentenceIds || []),
      ...con.flatMap(view => view.evidenceSentenceIds || []),
      ...neutral.flatMap(view => view.evidenceSentenceIds || []),
    ]);
    const entryCitations = this.unique([
      ...inTextCitations,
      ...sentenceCitations,
      ...pro.flatMap(view => view.inTextCitations),
      ...con.flatMap(view => view.inTextCitations),
      ...neutral.flatMap(view => view.inTextCitations),
    ]);
    const viewpointReferences = this.uniqueReferences([
      ...pro.flatMap(view => view.references),
      ...con.flatMap(view => view.references),
      ...neutral.flatMap(view => view.references),
    ]);
    const entryReferences = this.uniqueReferences(viewpointReferences.length > 0
      ? viewpointReferences
      : [
        ...claimReferences,
        ...this.matchReferencesForCitations(entryCitations, referencePool, [pdf.id]),
      ]);

    const hash = crypto.createHash('md5').update(`${pdf.id}:${claimText}:${location}`).digest('hex').slice(0, 16);
    return {
      id: `pdfwiki_${hash}`,
      groupId: `group_${hash}`,
      claim: claimText,
      normalizedClaim: claimText,
      displayClaimZh: this.isMostlyChinese(claimText) ? claimText : undefined,
      sourceEntryIds: [`pdfwiki_${hash}`],
      sourcePdfIds: [pdf.id],
      sourcePdfNames: [pdf.originalName],
      sections: [section],
      pro,
      con,
      neutral,
      inTextCitations: entryCitations,
      evidenceSentenceIds,
      references: entryReferences,
      evidenceSnippets: evidence ? [evidence] : [],
      sourceEntries: [{
        id: `pdfwiki_${hash}`,
        claim: claimText,
        normalizedClaim: claimText,
        displayClaimZh: this.isMostlyChinese(claimText) ? claimText : undefined,
        sourcePdfIds: [pdf.id],
        sourcePdfNames: [pdf.originalName],
        sections: [section],
        proCount: pro.length,
        conCount: con.length,
        neutralCount: neutral.length,
        evidenceSnippets: evidence ? [evidence] : [],
      }],
      updatedAt: new Date().toISOString(),
    };
  }

  private toViewpoints(
    views: unknown,
    stance: PdfWikiViewpoint['stance'],
    inheritedReferences: PdfWikiReference[],
    pdf: PdfWikiSourcePdf,
    section: string,
    location: string,
    evidence: string,
    useSharedEvidenceForCitations: boolean,
    referencePool: PdfWikiReference[],
    sentenceEvidence: Map<string, PdfWikiSentenceEvidence>
  ): PdfWikiViewpoint[] {
    if (!Array.isArray(views)) return [];
    return views
      .map(view => this.parseViewpointInput(view, section, location, evidence, useSharedEvidenceForCitations))
      .filter((view): view is ParsedPdfWikiViewpointInput => !!view)
      .map(view => ({
        view,
        resolvedEvidence: this.resolveEvidenceSentences(view.evidenceSentenceIds, view.evidence, sentenceEvidence),
      }))
      .filter(({ view, resolvedEvidence }) => {
        const keep = sentenceEvidence.size === 0 || resolvedEvidence.length > 0;
        if (!keep) {
          logger.warn(`[PdfWiki] Dropped ${stance} viewpoint without verifiable evidence sentence: ${view.summary.slice(0, 120)} (${pdf.originalName})`);
        }
        return keep;
      })
      .map(view => {
        const resolvedEvidence = view.resolvedEvidence;
        const parsedView = view.view;
        const sentenceCitations = resolvedEvidence.flatMap(item => item.citations);
        const sentenceReferences = this.uniqueReferences(resolvedEvidence.flatMap(item => item.references));
        const localRefs = this.resolveReferences({
          inTextCitations: parsedView.inTextCitations,
          referenceIndexes: parsedView.referenceIndexes,
          references: parsedView.references,
        }, referencePool, pdf.id);
        const inTextCitations = this.unique([
          ...parsedView.inTextCitations,
          ...sentenceCitations,
          ...this.extractInTextCitations(`${parsedView.summary} ${parsedView.evidence}`),
        ]);
        const citationRefs = this.matchReferencesForCitations(inTextCitations, referencePool, [pdf.id]);
        const evidenceRefs = this.uniqueReferences([
          ...sentenceReferences,
          ...citationRefs,
        ]);
        const references = sentenceEvidence.size > 0 && resolvedEvidence.length > 0
          ? evidenceRefs
          : this.uniqueReferences([
            ...localRefs,
            ...evidenceRefs,
            ...inheritedReferences,
          ]);
        return {
          stance,
          summary: parsedView.summary,
          evidence: parsedView.evidence,
          section: parsedView.section,
          location: parsedView.location,
          inTextCitations,
          evidenceSentenceIds: resolvedEvidence.map(item => item.id),
          evidenceSentences: resolvedEvidence.map(item => item.sentence),
          references,
          sourcePdfId: pdf.id,
          sourcePdfName: pdf.originalName,
        };
      });
  }

  private countViews(views: unknown): number {
    return Array.isArray(views) ? views.filter(view => String(view || '').trim()).length : 0;
  }

  private parseViewpointInput(
    view: unknown,
    fallbackSection: string,
    fallbackLocation: string,
    fallbackEvidence: string,
    useSharedEvidenceForCitations: boolean
  ): ParsedPdfWikiViewpointInput | null {
    if (typeof view === 'string') {
      const summary = view.trim();
      if (!summary) return null;
      const citationText = useSharedEvidenceForCitations ? `${summary} ${fallbackEvidence}` : summary;
      return {
        summary,
        evidence: useSharedEvidenceForCitations ? fallbackEvidence : '',
        section: fallbackSection,
        location: fallbackLocation,
        inTextCitations: this.extractInTextCitations(citationText),
        evidenceSentenceIds: [],
        referenceIndexes: [],
        references: [],
      };
    }

    if (!view || typeof view !== 'object') return null;
    const record = view as Record<string, unknown>;
    const summary = String(record.summary || record.view || record.text || '').trim();
    if (!summary) return null;
    const explicitEvidence = String(record.evidence || '').trim();
    const evidence = explicitEvidence || (useSharedEvidenceForCitations ? fallbackEvidence : '');
    const section = String(record.section || '').trim() || fallbackSection;
    const location = String(record.location || '').trim() || fallbackLocation;
    const explicitCitations = Array.isArray(record.inTextCitations)
      ? record.inTextCitations.map(String).filter(Boolean)
      : [];
    const citationEvidence = explicitEvidence ? evidence : (useSharedEvidenceForCitations ? evidence : '');

    return {
      summary,
      evidence,
      section,
      location,
      inTextCitations: this.unique([
        ...explicitCitations,
        ...this.extractInTextCitations(`${summary} ${citationEvidence}`),
      ]),
      evidenceSentenceIds: this.toStringArray(record.evidenceSentenceIds || record.evidence_sentence_ids || record.sentenceIds || record.sentence_ids),
      referenceIndexes: this.toNumberArray(record.referenceIndexes || record.reference_indexes),
      references: Array.isArray(record.references) ? record.references as Array<Partial<PdfWikiReference>> : [],
    };
  }

  private resolveEvidenceSentences(
    evidenceSentenceIds: string[],
    evidenceText: string,
    sentenceEvidence: Map<string, PdfWikiSentenceEvidence>
  ): PdfWikiSentenceEvidence[] {
    const resolved: PdfWikiSentenceEvidence[] = [];
    const seen = new Set<string>();
    for (const rawId of evidenceSentenceIds || []) {
      const evidence = sentenceEvidence.get(this.normalizeSentenceEvidenceId(rawId));
      if (evidence && !seen.has(evidence.id)) {
        resolved.push(evidence);
        seen.add(evidence.id);
      }
    }

    if (resolved.length > 0) return resolved;
    const matched = this.findSentenceEvidenceByText(evidenceText, sentenceEvidence);
    return matched ? [matched] : [];
  }

  private findSentenceEvidenceByText(
    evidenceText: string,
    sentenceEvidence: Map<string, PdfWikiSentenceEvidence>
  ): PdfWikiSentenceEvidence | null {
    const evidence = this.normalizeForEvidenceMatching(evidenceText);
    if (!evidence || evidence.length < 16 || sentenceEvidence.size === 0) return null;

    const candidates = Array.from(new Map(
      Array.from(sentenceEvidence.values()).map(item => [item.id, item])
    ).values());
    let best: { evidence: PdfWikiSentenceEvidence; score: number } | null = null;
    const evidenceTokens = new Set(this.tokenizeForReferenceMatching(evidenceText));

    for (const candidate of candidates) {
      const sentence = this.normalizeForEvidenceMatching(candidate.sentence);
      let score = 0;
      if (sentence && (sentence.includes(evidence) || evidence.includes(sentence))) {
        score = 1;
      } else {
        const sentenceTokens = new Set(this.tokenizeForReferenceMatching(candidate.sentence));
        const intersection = Array.from(evidenceTokens).filter(token => sentenceTokens.has(token)).length;
        const denominator = Math.max(1, Math.min(evidenceTokens.size, sentenceTokens.size));
        score = intersection / denominator;
      }
      if (!best || score > best.score) {
        best = { evidence: candidate, score };
      }
    }

    return best && best.score >= 0.48 ? best.evidence : null;
  }

  private normalizeForEvidenceMatching(text: string): string {
    return String(text || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private attachGlobalReferences(entries: PdfWikiEntry[], referenceIndex: PdfWikiReference[]): PdfWikiEntry[] {
    return entries.map(entry => {
      const pro = this.attachReferencesToViewpoints(entry.pro, referenceIndex);
      const con = this.attachReferencesToViewpoints(entry.con, referenceIndex);
      const neutral = this.attachReferencesToViewpoints(entry.neutral, referenceIndex);
      const entryCitations = this.unique([
        ...entry.inTextCitations,
        ...this.extractInTextCitations([
          entry.claim,
          entry.normalizedClaim,
          ...entry.evidenceSnippets,
          ...pro.flatMap(view => [view.summary, view.evidence]),
          ...con.flatMap(view => [view.summary, view.evidence]),
          ...neutral.flatMap(view => [view.summary, view.evidence]),
        ].join(' ')),
      ]);
      const entryRefs = this.uniqueReferences([
        ...entry.references,
        ...this.matchReferencesForCitations(entryCitations, referenceIndex, entry.sourcePdfIds),
        ...pro.flatMap(view => view.references),
        ...con.flatMap(view => view.references),
        ...neutral.flatMap(view => view.references),
      ]);
      return {
        ...entry,
        pro,
        con,
        neutral,
        inTextCitations: entryCitations,
        references: entryRefs,
      };
    });
  }

  private attachReferencesToViewpoints(viewpoints: PdfWikiViewpoint[], referenceIndex: PdfWikiReference[]): PdfWikiViewpoint[] {
    return viewpoints.map(viewpoint => {
      const citations = this.unique([
        ...viewpoint.inTextCitations,
        ...this.extractInTextCitations(`${viewpoint.summary} ${viewpoint.evidence}`),
      ]);
      const matched = this.matchReferencesForCitations(citations, referenceIndex, [viewpoint.sourcePdfId]);
      const refs = this.uniqueReferences([
        ...viewpoint.references,
        ...matched,
      ]);
      return {
        ...viewpoint,
        inTextCitations: citations,
        references: refs,
      };
    });
  }

  private createSourcePdfFallbackReference(sourcePdfId: string, sourcePdfName: string, sourcePdfTitle?: string): PdfWikiReference {
    const displayName = sourcePdfTitle || sourcePdfName || sourcePdfId || 'PDF';
    const inferred = this.inferSourceMetadata(displayName, '');
    const id = crypto.createHash('md5').update(`${sourcePdfId}:${displayName}:source-pdf-fallback`).digest('hex').slice(0, 16);
    return {
      id: `ref_source_${id}`,
      raw: `来源 PDF：${displayName}`,
      sourcePdfId,
      sourcePdfName,
      fallbackSourcePdf: true,
      title: sourcePdfTitle || inferred.title || sourcePdfName || '来源 PDF',
      authors: inferred.authors,
      year: inferred.year,
      journal: inferred.journal,
      doi: inferred.doi,
    };
  }

  private matchReferencesForCitations(
    citations: string[],
    referenceIndex: PdfWikiReference[],
    preferredSourcePdfIds: string[]
  ): PdfWikiReference[] {
    const matches: PdfWikiReference[] = [];
    const preferred = new Set(preferredSourcePdfIds.filter(Boolean));
    const preferredRefs = preferred.size > 0
      ? referenceIndex.filter(ref => ref.sourcePdfId && preferred.has(ref.sourcePdfId))
      : referenceIndex;
    const candidateSets = preferredRefs.length > 0 && preferredRefs.length < referenceIndex.length
      ? [preferredRefs, referenceIndex]
      : [preferredRefs];

    for (const citation of citations || []) {
      const numericIndexes = this.extractNumericReferenceIndexes(citation);
      if (numericIndexes.length > 0) {
        for (const index of numericIndexes) {
          const match = preferredRefs.find(ref => ref.index === index) || referenceIndex.find(ref => ref.index === index);
          if (match) matches.push(match);
        }
        continue;
      }

      const pairs = this.extractAuthorYearPairs(citation);
      for (const pair of pairs) {
        let matched = false;
        for (const candidates of candidateSets) {
          const ref = this.findReferenceByAuthorYear(pair.author, pair.year, candidates);
          if (ref) {
            matches.push(ref);
            matched = true;
            break;
          }
        }
        if (matched) continue;
      }
    }

    return this.uniqueReferences(matches);
  }

  private extractNumericReferenceIndexes(citation: string): number[] {
    const normalizedCitation = this.normalizeSuperscriptCitationDigits(citation)
      .trim()
      .replace(/[–—]/g, '-');
    const bracketMatch = normalizedCitation.match(/^(?:\[|\(|（)([\d,，\s-]+)(?:\]|\)|）)$/);
    const plainMatch = normalizedCitation.match(/^(\d{1,3}(?:\s*[,，-]\s*\d{1,3})*)$/);
    const rawIndexes = bracketMatch?.[1] || plainMatch?.[1];
    if (!rawIndexes) return [];

    const indexes: number[] = [];
    for (const part of rawIndexes.split(/[,，]/)) {
      const range = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        for (let value = start; value <= end && value <= start + 50; value++) {
          indexes.push(value);
        }
      } else {
        const value = Number(part.trim());
        if (Number.isFinite(value) && value > 0) indexes.push(value);
      }
    }

    return Array.from(new Set(indexes));
  }

  private extractAuthorYearPairs(citation: string): Array<{ author: string; year: string }> {
    const cleaned = citation.replace(/[()[\]（）]/g, ' ').replace(/，/g, ',');
    const pairs: Array<{ author: string; year: string }> = [];

    for (const segment of cleaned.split(/[;；]/)) {
      const years = segment.match(/\b(19|20)\d{2}[a-z]?\b/g) || [];
      const authorMatch = segment.match(/([A-Z][A-Za-z'’`-]+|[\u4e00-\u9fa5]{2,})(?:\s+(?:et\s+al\.?|and\s+[A-Z][A-Za-z'’`-]+|&\s+[A-Z][A-Za-z'’`-]+)|等)?/i);
      const author = authorMatch ? authorMatch[1] : '';
      for (const year of years) {
        if (author && year) {
          pairs.push({ author, year: year.slice(0, 4) });
        }
      }
    }

    return pairs;
  }

  private findReferenceByAuthorYear(author: string, year: string, references: PdfWikiReference[]): PdfWikiReference | undefined {
    const normalizedAuthor = this.normalizeCitationToken(author);
    if (!normalizedAuthor || !year) return undefined;

    return references.find(ref => {
      const refText = this.normalizeCitationToken([
        ref.authors,
        ref.raw,
        ref.title,
      ].filter(Boolean).join(' '));
      const refYear = String(ref.year || ref.raw || '');
      const authorMatches = ` ${refText} `.includes(` ${normalizedAuthor} `);
      return refYear.includes(year) && authorMatches;
    });
  }

  private normalizeCitationToken(value: string): string {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ')
      .trim();
  }

  private async groupEntriesAcrossPdfs(
    entries: PdfWikiEntry[],
    llmConfig: PdfWikiLlmConfig,
    userId: string,
    codexConfig?: PdfWikiCodexConfig
  ): Promise<PdfWikiEntry[]> {
    if (entries.length === 0) return [];
    const groupingEngine = this.getGroupingEngine(llmConfig);
    if (groupingEngine === 'local') {
      return this.mergeGroups(entries, this.fallbackGroups(entries), []);
    }

    const promptEntries = entries.slice(0, 100).map((entry, index) => {
      return `[${index + 1}] id=${entry.id}
claim=${this.compactPromptText(entry.normalizedClaim || entry.claim, 220)}
displayClaimZh=${this.compactPromptText(entry.displayClaimZh || '', 120)}
sources=${this.compactPromptText(entry.sourcePdfNames.join('; '), 220)}
pro=${this.compactPromptText(entry.pro.map(v => v.summary).join(' | '), 420)}
con=${this.compactPromptText(entry.con.map(v => v.summary).join(' | '), 320)}`;
    }).join('\n\n');

    const prompt = `请把下列来自多个 PDF 的论文论点做智能整合，并生成中文展示名。

要求：
1. 不要删除任何 entryId。
2. 中文展示名必须使用简洁中文，适合显示在论点库左侧列表。
3. claimTranslations 必须覆盖每一个 entryId。
4. 只有语义等价、研究问题和因果关系基本一致的论点才放入 groups 自动合并。
5. 相似但不应合并的论点放入 similarPairs，供用户点击查看。
6. similarity 为 0-1，小于 0.72 的不要列入 similarPairs。
7. 只返回 JSON，不要 Markdown。

论点列表：
${promptEntries}

返回格式：
{
  "claimTranslations": [
    {"entryId": "pdfwiki_xxx", "displayClaimZh": "中文论点名"}
  ],
  "groups": [
    {"normalizedClaim": "归并后的论点", "displayClaimZh": "中文归并论点名", "entryIds": ["pdfwiki_xxx"]}
  ],
  "similarPairs": [
    {"entryIds": ["pdfwiki_xxx", "pdfwiki_yyy"], "similarity": 0.78, "reason": "相似但研究对象或机制不同"}
  ]
}`;

    if (codexConfig && this.shouldUseCodexForGrouping(llmConfig)) {
      try {
        const taskDir = this.getCodexPdfWikiAuxTaskDir(userId, `grouping_${Date.now()}`);
        const parsed = await this.callCodexJsonTask(codexConfig, taskDir, prompt, 'grouping');
        const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
        const translations = Array.isArray(parsed?.claimTranslations) ? parsed.claimTranslations : [];
        const similarPairs = Array.isArray(parsed?.similarPairs) ? parsed.similarPairs : [];
        logger.info(`[PdfWiki] Smart claim grouping completed via Codex CLI: groups=${groups.length}, translations=${translations.length}, similarPairs=${similarPairs.length}`);
        return this.applySimilarRelations(
          this.mergeGroups(entries, groups.length > 0 ? groups : this.fallbackGroups(entries), translations),
          similarPairs,
        );
      } catch (error) {
        logger.warn(`[PdfWiki] Codex CLI smart claim grouping failed, falling back to configured API: ${(error as Error).message}`);
      }
    }

    if (this.shouldUseApiForGrouping(llmConfig)) {
      try {
        const parsed = await this.callJsonNormalizer(llmConfig, prompt, 4000, 'grouping');
        const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
        const translations = Array.isArray(parsed?.claimTranslations) ? parsed.claimTranslations : [];
        const similarPairs = Array.isArray(parsed?.similarPairs) ? parsed.similarPairs : [];
        return this.applySimilarRelations(
          this.mergeGroups(entries, groups.length > 0 ? groups : this.fallbackGroups(entries), translations),
          similarPairs,
        );
      } catch (error) {
        logger.warn(`[PdfWiki] Smart claim grouping failed, using fallback grouping: ${(error as Error).message}`);
      }
    }

    return this.mergeGroups(entries, this.fallbackGroups(entries), []);
  }

  private compactPromptText(value: string, maxLength: number): string {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength - 1).trimEnd() + '…';
  }

  private mergeGroups(
    entries: PdfWikiEntry[],
    groups: Array<{ normalizedClaim?: string; displayClaimZh?: string; entryIds?: string[] }>,
    translations: Array<{ entryId?: string; displayClaimZh?: string }> = []
  ): PdfWikiEntry[] {
    const entryMap = new Map(entries.map(entry => [entry.id, entry]));
    const translationMap = new Map<string, string>();
    for (const item of translations) {
      const entryId = String(item.entryId || '').trim();
      const displayClaimZh = String(item.displayClaimZh || '').trim();
      if (entryId && displayClaimZh) translationMap.set(entryId, displayClaimZh);
    }
    const used = new Set<string>();
    const merged: PdfWikiEntry[] = [];

    for (const group of groups) {
      const ids = this.unique(Array.isArray(group.entryIds) ? group.entryIds.filter(id => entryMap.has(id)) : []);
      const mergeIds = this.filterMergeGroupEntryIds(ids, entryMap);
      if (mergeIds.length < 2) continue;

      const groupEntries = mergeIds.map(id => entryMap.get(id)!).filter(Boolean);
      groupEntries.forEach(entry => used.add(entry.id));
      const normalizedClaim = String(group.normalizedClaim || groupEntries[0].claim).trim();
      const displayClaimZh = String(group.displayClaimZh || '').trim()
        || groupEntries.map(entry => entry.displayClaimZh || translationMap.get(entry.id)).find(Boolean)
        || (this.isMostlyChinese(normalizedClaim) ? normalizedClaim : undefined);
      const groupHash = crypto.createHash('md5').update([...mergeIds].sort().join('|') + normalizedClaim).digest('hex').slice(0, 16);

      merged.push({
        id: `pdfwiki_group_${groupHash}`,
        groupId: `group_${groupHash}`,
        claim: normalizedClaim,
        normalizedClaim,
        displayClaimZh,
        sourceEntryIds: this.unique(groupEntries.flatMap(entry => entry.sourceEntryIds || [entry.id])),
        sourcePdfIds: this.unique(groupEntries.flatMap(entry => entry.sourcePdfIds)),
        sourcePdfNames: this.unique(groupEntries.flatMap(entry => entry.sourcePdfNames)),
        sections: this.unique(groupEntries.flatMap(entry => entry.sections)),
        pro: groupEntries.flatMap(entry => entry.pro),
        con: groupEntries.flatMap(entry => entry.con),
        neutral: groupEntries.flatMap(entry => entry.neutral),
        inTextCitations: this.unique(groupEntries.flatMap(entry => entry.inTextCitations)),
        references: this.uniqueReferences(groupEntries.flatMap(entry => entry.references)),
        evidenceSnippets: this.unique(groupEntries.flatMap(entry => entry.evidenceSnippets)).slice(0, 8),
        sourceEntries: groupEntries.flatMap(entry => entry.sourceEntries && entry.sourceEntries.length > 0
          ? entry.sourceEntries
          : [this.toSourceEntryTrace(entry)]
        ),
        updatedAt: new Date().toISOString(),
      });
    }

    for (const entry of entries) {
      if (!used.has(entry.id)) {
        merged.push(this.ensureEntryDisplayClaim({
          ...entry,
          displayClaimZh: entry.displayClaimZh || translationMap.get(entry.id),
          sourceEntryIds: entry.sourceEntryIds || [entry.id],
        }));
      }
    }

    return merged;
  }

  private applySimilarRelations(
    entries: PdfWikiEntry[],
    similarPairs: Array<{ entryIds?: string[]; similarity?: number; reason?: string }>
  ): PdfWikiEntry[] {
    if (similarPairs.length === 0) {
      return entries.map(entry => ({ ...entry, similarClaims: [] }));
    }

    const entryById = new Map(entries.map(entry => [entry.id, entry]));
    const originalToCurrent = new Map<string, string>();
    for (const entry of entries) {
      originalToCurrent.set(entry.id, entry.id);
      for (const sourceId of entry.sourceEntryIds || []) {
        originalToCurrent.set(sourceId, entry.id);
      }
    }

    const relationMap = new Map<string, PdfWikiSimilarClaim[]>();
    const addRelation = (fromId: string, toId: string, similarity: number, reason: string) => {
      if (fromId === toId) return;
      const target = entryById.get(toId);
      if (!target) return;
      const current = relationMap.get(fromId) || [];
      if (!current.some(item => item.entryId === toId)) {
        current.push({
          entryId: toId,
          claim: target.normalizedClaim || target.claim,
          displayClaimZh: target.displayClaimZh,
          similarity,
          reason,
        });
      }
      relationMap.set(fromId, current);
    };

    for (const pair of similarPairs) {
      const rawIds = Array.isArray(pair.entryIds) ? pair.entryIds.map(String).filter(Boolean) : [];
      if (rawIds.length < 2) continue;
      const currentIds = this.unique(rawIds.map(id => originalToCurrent.get(id) || id).filter(id => entryById.has(id)));
      if (currentIds.length < 2) continue;
      const similarity = Math.max(0, Math.min(1, Number(pair.similarity || 0)));
      const reason = String(pair.reason || '').trim();
      for (let i = 0; i < currentIds.length; i++) {
        for (let j = i + 1; j < currentIds.length; j++) {
          addRelation(currentIds[i], currentIds[j], similarity, reason);
          addRelation(currentIds[j], currentIds[i], similarity, reason);
        }
      }
    }

    return entries.map(entry => ({
      ...entry,
      similarClaims: (relationMap.get(entry.id) || []).sort((a, b) => (b.similarity || 0) - (a.similarity || 0)),
    }));
  }

  private ensureEntryDisplayClaim(entry: PdfWikiEntry): PdfWikiEntry {
    return {
      ...entry,
      displayClaimZh: entry.displayClaimZh || (this.isMostlyChinese(entry.normalizedClaim || entry.claim) ? (entry.normalizedClaim || entry.claim) : undefined),
      sourceEntryIds: entry.sourceEntryIds || [entry.id],
      sourceEntries: entry.sourceEntries && entry.sourceEntries.length > 0 ? entry.sourceEntries : [this.toSourceEntryTrace(entry)],
      similarClaims: entry.similarClaims || [],
    };
  }

  private toSourceEntryTrace(entry: PdfWikiEntry): PdfWikiSourceEntryTrace {
    return {
      id: entry.id,
      claim: entry.claim,
      normalizedClaim: entry.normalizedClaim || entry.claim,
      displayClaimZh: entry.displayClaimZh,
      sourcePdfIds: entry.sourcePdfIds,
      sourcePdfNames: entry.sourcePdfNames,
      sections: entry.sections,
      proCount: entry.pro.length,
      conCount: entry.con.length,
      neutralCount: entry.neutral.length,
      evidenceSnippets: entry.evidenceSnippets,
    };
  }

  private filterMergeGroupEntryIds(ids: string[], entryMap: Map<string, PdfWikiEntry>): string[] {
    const uniqueIds = this.unique(ids).filter(id => entryMap.has(id));
    if (uniqueIds.length < 2) return uniqueIds;

    const threshold = this.getGroupMergeMinSimilarity();
    const kept: string[] = [];
    for (const id of uniqueIds) {
      const candidate = entryMap.get(id);
      if (!candidate) continue;
      if (kept.length === 0) {
        kept.push(id);
        continue;
      }

      const isCompatible = kept.every(existingId => {
        const existing = entryMap.get(existingId);
        return !!existing && this.calculateClaimMergeSimilarity(existing, candidate) >= threshold;
      });
      if (isCompatible) {
        kept.push(id);
      }
    }

    if (kept.length !== uniqueIds.length) {
      logger.warn(`[PdfWiki] Skipped ${uniqueIds.length - kept.length} over-broad grouped entries below merge threshold ${threshold}`);
    }
    return kept;
  }

  private getGroupMergeMinSimilarity(): number {
    const value = Number(process.env.PDF_WIKI_GROUP_MERGE_MIN_SIMILARITY || 0.82);
    if (!Number.isFinite(value)) return 0.82;
    return Math.max(0.6, Math.min(0.98, value));
  }

  private calculateClaimMergeSimilarity(a: PdfWikiEntry, b: PdfWikiEntry): number {
    const aText = this.normalizeClaimForMerge(a.normalizedClaim || a.claim);
    const bText = this.normalizeClaimForMerge(b.normalizedClaim || b.claim);
    if (!aText || !bText) return 0;
    if (aText === bText) return 1;

    const aTokens = new Set(this.tokenizeClaimForMerge(aText));
    const bTokens = new Set(this.tokenizeClaimForMerge(bText));
    if (aTokens.size === 0 || bTokens.size === 0) return 0;
    const intersection = Array.from(aTokens).filter(token => bTokens.has(token)).length;
    const dice = (2 * intersection) / (aTokens.size + bTokens.size);
    const containment = intersection / Math.max(1, Math.min(aTokens.size, bTokens.size));
    return Math.max(dice, containment * 0.92);
  }

  private normalizeClaimForMerge(value: string): string {
    return this.normalizeForEvidenceMatching(value)
      .replace(/\bnitrous\s+oxide\b/g, ' n2o ')
      .replace(/\bgreenhouse\s+gas(?:es)?\b/g, ' ghg ')
      .replace(/\b(availab(?:le|ility)|supply|supplies|substrate)\b/g, ' availability ')
      .replace(/\b(increase|increases|increased|increasing|enhance|enhances|enhanced|promote|promotes|promoted|stimulate|stimulates|stimulated)\b/g, ' increase ')
      .replace(/\b(decrease|decreases|decreased|decreasing|reduce|reduces|reduced|suppress|suppresses|suppressed|mitigate|mitigates|mitigated)\b/g, ' decrease ')
      .replace(/\b(emission|emissions|release|releases|released|flux|fluxes)\b/g, ' emission ')
      .replace(/\b(significant|significantly|effect|effects|impact|impacts)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private tokenizeClaimForMerge(value: string): string[] {
    const normalized = this.normalizeForEvidenceMatching(value);
    const tokens = this.tokenizeForReferenceMatching(normalized);
    const chinese = normalized.replace(/[^\u4e00-\u9fa5]/g, '');
    for (let index = 0; index < chinese.length - 1; index++) {
      tokens.push(chinese.slice(index, index + 2));
    }
    return this.unique(tokens);
  }

  private isMostlyChinese(value: string): boolean {
    const text = String(value || '');
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    const letters = (text.match(/[A-Za-z]/g) || []).length;
    return chinese > 0 && chinese >= letters / 2;
  }

  private fallbackGroups(entries: PdfWikiEntry[]): Array<{ normalizedClaim: string; entryIds: string[] }> {
    const groups = new Map<string, string[]>();
    for (const entry of entries) {
      const key = this.normalizeClaimForMerge(entry.claim);
      const existing = groups.get(key) || [];
      existing.push(entry.id);
      groups.set(key, existing);
    }
    return Array.from(groups.entries()).filter(([, entryIds]) => entryIds.length > 1).map(([key, entryIds]) => ({
      normalizedClaim: entries.find(entry => entry.id === entryIds[0])?.claim || key,
      entryIds,
    }));
  }

  private storeToRetrievalLiteratures(store: PdfWikiStore): UnifiedLiterature[] {
    const sentencePoints = this.filterPublishableSentencePoints(store.sentenceCloud?.points || []);
    const entries = this.filterReferenceBackedEntries(store.entries || []);
    return [
      ...this.entriesToLiteratures(entries, 0),
      ...this.sentencePointsToLiteratures(sentencePoints, entries.length),
    ];
  }

  private entriesToLiteratures(entries: PdfWikiEntry[], offset = 0): UnifiedLiterature[] {
    return this.filterReferenceBackedEntries(entries).map((entry, index) => {
      const firstRef = entry.references[0];
      const authors = parseAuthorsToString(firstRef?.authors || entry.sourcePdfNames.join(', '));
      const year = parseInt(firstRef?.year || '', 10) || new Date().getFullYear();
      const displayClaim = entry.displayClaimZh || entry.normalizedClaim || entry.claim;
      const abstract = [
        `论点: ${displayClaim}`,
        entry.displayClaimZh ? `原始论点: ${entry.normalizedClaim || entry.claim}` : '',
        `来源PDF: ${entry.sourcePdfNames.join('; ')}`,
        `正向观点: ${entry.pro.map(v => v.summary).join('；')}`,
        `反向观点: ${entry.con.map(v => v.summary).join('；')}`,
        `中性/机制: ${entry.neutral.map(v => v.summary).join('；')}`,
        `证据摘录: ${entry.evidenceSnippets.join('；')}`,
        `文中引用: ${entry.inTextCitations.join('; ')}`,
        `参考文献: ${entry.references.map(ref => this.formatReference(ref)).join('\n')}`,
        entry.researchUseCategory ? `研究用途类别: ${entry.researchUseCategory}` : '',
        entry.researchUse ? `在用户研究中的用途: ${entry.researchUse}` : '',
        entry.supportScope?.length ? `论点支撑范围: ${entry.supportScope.join('；')}` : '',
        entry.limitations?.length ? `使用边界: ${entry.limitations.join('；')}` : '',
        entry.sourcePdfMetadata ? `来源PDF详情: ${[
          entry.sourcePdfMetadata.title,
          entry.sourcePdfMetadata.authors,
          entry.sourcePdfMetadata.year,
          entry.sourcePdfMetadata.journal,
          entry.sourcePdfMetadata.doi,
        ].filter(Boolean).join('；')}` : '',
      ].filter(Boolean).join('\n');
      const embeddingText = [
        displayClaim,
        ...entry.evidenceSnippets,
        ...entry.pro.map(view => view.summary),
        ...entry.con.map(view => view.summary),
        ...entry.neutral.map(view => view.summary),
        entry.researchUse || '',
        ...(entry.supportScope || []),
        ...(entry.limitations || []),
        entry.sourcePdfMetadata?.title || '',
      ].filter(Boolean).join('\n');

      return {
        id: entry.id,
        citationId: offset + index + 1,
        title: displayClaim,
        authors,
        author: authorsToString(authors),
        year,
        abstract,
        keywords: this.unique([
          'pdf-wiki',
          ...(entry.origin === 'deep-analysis' ? ['deep-analysis', entry.researchUseCategory || ''] : []),
          ...entry.sections,
          ...entry.inTextCitations,
          ...(entry.supportScope || []),
        ]).filter(Boolean),
        journal: 'PDF Wiki',
        documentType: 'article',
        categories: ['pdf-wiki'],
        references: entry.references.map(ref => this.formatReference(ref)),
        source: 'wos',
        embeddingText,
        evidenceAttachment: {
          kind: entry.origin === 'deep-analysis' ? 'pdf-wiki-deep-analysis' : 'pdf-wiki-claim',
          claim: displayClaim,
          sourcePdfId: entry.sourcePdfIds[0],
          sourcePdfName: entry.sourcePdfNames[0],
          section: entry.sections[0],
          citations: [...entry.inTextCitations],
          referenceIndexes: entry.references
            .filter(ref => !ref.fallbackSourcePdf && Number.isFinite(ref.index))
            .map(ref => Number(ref.index)),
          references: entry.references.map(ref => ({
            id: ref.id,
            index: ref.index,
            raw: ref.raw,
            title: ref.title,
            authors: ref.authors,
            year: ref.year,
            journal: ref.journal,
            doi: ref.doi,
            sourcePdfId: ref.sourcePdfId,
            sourcePdfName: ref.sourcePdfName,
            fallbackSourcePdf: ref.fallbackSourcePdf,
          })),
          researchUseCategory: entry.researchUseCategory,
          researchUse: entry.researchUse,
          supportScope: entry.supportScope ? [...entry.supportScope] : undefined,
          limitations: entry.limitations ? [...entry.limitations] : undefined,
          researchContextKeys: entry.researchContextKeys ? [...entry.researchContextKeys] : undefined,
          confidence: entry.confidence,
          sourcePdfAuthors: entry.sourcePdfMetadata?.authors,
          sourcePdfYear: entry.sourcePdfMetadata?.year,
          sourcePdfJournal: entry.sourcePdfMetadata?.journal,
          sourcePdfDoi: entry.sourcePdfMetadata?.doi,
        },
      };
    });
  }

  private sentencePointsToLiteratures(points: PdfWikiSentencePoint[], offset = 0): UnifiedLiterature[] {
    return this.filterPublishableSentencePoints(points).map((point, index) => {
      const references = this.getSentencePointCitationReferences(point);
      const firstRef = references[0];
      const authors = parseAuthorsToString(firstRef?.authors || point.sourcePdfName);
      const year = parseInt(firstRef?.year || '', 10) || new Date().getFullYear();
      const abstract = [
        `可作论点: 是`,
        point.claimText ? `可归纳论点: ${point.claimText}` : '',
        `句子: ${point.sentence}`,
        `论点类型: ${point.claimType}`,
        point.claimReason ? `判断原因: ${point.claimReason}` : '',
        `主题: ${point.topicLabel}`,
        point.aiTopicAnnotation?.subjectTags?.length
          ? `AI多主题标签: ${point.aiTopicAnnotation.subjectTags.join('；')}`
          : '',
        point.aiTopicAnnotation?.trendConclusionTopic
          ? `趋势/结论主题: ${point.aiTopicAnnotation.trendConclusionTopic}`
          : '',
        `来源PDF: ${point.sourcePdfName}`,
        `章节: ${point.section} S${point.sentenceIndex}`,
        `文中引用: ${point.citations.join('; ') || '未检测到显式引用'}`,
        references.some(ref => ref.fallbackSourcePdf) ? `引用规则: 该句未匹配到句后引文，写作时引用来源 PDF。` : `引用规则: 该句已匹配句后引文，写作时引用对应参考文献。`,
        `匹配方式: ${point.matchMethod}; confidence=${point.confidence}`,
        `参考文献: ${references.map(ref => this.formatReference(ref)).join('\n')}`,
      ].filter(Boolean).join('\n');
      const embeddingText = [
        point.sentence,
        point.claimText,
        point.topicLabel,
        ...(point.aiTopicAnnotation?.subjectTags || []),
        point.aiTopicAnnotation?.trendConclusionTopic || '',
      ].filter(Boolean).join('\n');

      return {
        id: point.id,
        citationId: offset + index + 1,
        title: point.claimText || point.sentence,
        authors,
        author: authorsToString(authors),
        year,
        abstract,
        keywords: this.unique([
          'pdf-wiki',
          'sentence-claim',
          point.section,
          point.topicLabel,
          point.claimType,
          ...point.keywords,
          ...(point.aiTopicAnnotation?.subjectTags || []),
          point.aiTopicAnnotation?.trendConclusionTopic || '',
          ...point.citations,
        ]).filter(Boolean),
        journal: 'PDF Wiki Sentence Argument Library',
        documentType: 'article',
        categories: ['pdf-wiki', 'sentence-claim'],
        references: references.map(ref => this.formatReference(ref)),
        source: 'wos',
        embeddingText,
        evidenceAttachment: {
          kind: 'pdf-wiki-sentence',
          sentenceId: point.id,
          sentence: point.sentence,
          claim: point.claimText || point.sentence,
          claimType: point.claimType,
          topic: point.topicLabel,
          sourcePdfId: point.sourcePdfId,
          sourcePdfName: point.sourcePdfName,
          sourcePdfTitle: point.sourcePdfTitle,
          section: point.section,
          sentenceIndex: point.sentenceIndex,
          citations: [...point.citations],
          referenceIndexes: references
            .filter(ref => !ref.fallbackSourcePdf && Number.isFinite(ref.index))
            .map(ref => Number(ref.index)),
          references: references.map(ref => ({
            id: ref.id,
            index: ref.index,
            raw: ref.raw,
            title: ref.title,
            authors: ref.authors,
            year: ref.year,
            journal: ref.journal,
            doi: ref.doi,
            sourcePdfId: ref.sourcePdfId,
            sourcePdfName: ref.sourcePdfName,
            fallbackSourcePdf: ref.fallbackSourcePdf,
          })),
          matchMethod: point.matchMethod,
          confidence: point.confidence,
        },
      };
    });
  }

  private sentencePointToEntry(point: PdfWikiSentencePoint): PdfWikiEntry {
    const evidenceId = this.makeSentenceEvidenceId(point.section, point.sentenceIndex);
    const references = this.getSentencePointCitationReferences(point);
    const claim = point.claimText || point.sentence;
    const viewpoint: PdfWikiViewpoint = {
      stance: point.claimCandidate ? 'support' : 'neutral',
      summary: claim,
      evidence: point.sentence,
      section: point.section,
      location: `${point.section} S${point.sentenceIndex}`,
      inTextCitations: point.citations,
      evidenceSentenceIds: [evidenceId],
      evidenceSentences: [point.sentence],
      references,
      sourcePdfId: point.sourcePdfId,
      sourcePdfName: point.sourcePdfName,
    };

    return {
      id: point.id,
      groupId: `sentence_argument_${point.topicKey}`,
      claim,
      normalizedClaim: claim,
      displayClaimZh: point.claimCandidate ? claim : point.topicLabel,
      sourcePdfIds: [point.sourcePdfId],
      sourcePdfNames: [point.sourcePdfName],
      sections: [point.section],
      pro: point.claimCandidate ? [viewpoint] : [],
      con: [],
      neutral: point.claimCandidate ? [] : [viewpoint],
      inTextCitations: point.citations,
      evidenceSentenceIds: [evidenceId],
      references,
      evidenceSnippets: [point.sentence],
      updatedAt: new Date().toISOString(),
    };
  }

  private getSentencePointCitationReferences(point: PdfWikiSentencePoint): PdfWikiReference[] {
    const allReferences = this.deduplicateSentencePointReferences(point.references || [], 8);
    return allReferences.filter(ref => this.isReferenceBackedReference(ref));
  }

  private parseReferences(text: string, sourcePdfId: string, sourcePdfName: string): PdfWikiReference[] {
    const tail = this.extractReferenceTail(text);
    if (!tail) return [];

    const streams = this.splitReferenceTailIntoReadingStreams(tail);
    const rawReferences = streams.flatMap(stream => this.parseReferenceStream(stream));
    const seen = new Set<string>();
    const uniqueRawReferences = rawReferences.filter(raw => {
      const key = raw.replace(/\s+/g, ' ').trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return uniqueRawReferences
      .slice(0, 300)
      .map((raw, index) => this.parseReferenceDetails(raw, sourcePdfId, sourcePdfName, index));
  }

  /**
   * PDF layout extractors frequently interleave the left and right reference
   * columns on the same physical line. Preserve the large horizontal gap long
   * enough to rebuild two independent reading streams before normalizing
   * whitespace; otherwise authors from one column are merged into a different
   * reference in the other column.
   */
  private splitReferenceTailIntoReadingStreams(tail: string): string[] {
    const lines = String(tail || '').replace(/\r/g, '\n').split('\n');
    const headingNames = String.raw`references?|bibliography|literature cited|works cited|参考文献|参考资料`;
    const headingPattern = new RegExp(`(?:^|[ \\t]{3,})(${headingNames})(?=[ \\t]{2,}|$)`, 'i');
    let splitColumn = 0;
    let headingColumn: 'left' | 'right' | undefined;

    // The heading line is the most reliable column ruler. A heading at the
    // right edge marks the start of the right column; a heading at the left
    // edge is followed by the gap before the already-active right column.
    for (const line of lines.slice(0, 20)) {
      const headingMatch = headingPattern.exec(line);
      if (!headingMatch || headingMatch.index === undefined) continue;
      const headingStart = line.indexOf(headingMatch[1], headingMatch.index);
      const headingEnd = headingStart + headingMatch[1].length;
      if (headingStart >= 24) {
        splitColumn = headingStart;
        headingColumn = 'right';
        break;
      }
      const trailingGap = /[ \t]{8,}/g;
      trailingGap.lastIndex = headingEnd;
      const gap = trailingGap.exec(line);
      if (gap && line.slice(gap.index + gap[0].length).trim()) {
        splitColumn = gap.index + gap[0].length;
        headingColumn = 'left';
        break;
      }
    }

    if (splitColumn <= 0) {
      return [lines.join('\n')];
    }

    const left: string[] = [];
    const right: string[] = [];

    for (const rawLine of lines) {
      if (!rawLine.trim()) {
        left.push('');
        right.push('');
        continue;
      }

      const windowStart = Math.max(0, splitColumn - 8);
      const windowEnd = Math.min(rawLine.length, splitColumn + 8);
      const boundaryWindow = rawLine.slice(windowStart, windowEnd);
      const hasColumnGap = /[ \t]{5,}/.test(boundaryWindow);
      const firstContentIndex = rawLine.search(/\S/);
      if (firstContentIndex >= splitColumn - 6) {
        right.push(rawLine.trim());
        continue;
      }
      if (rawLine.length > splitColumn && hasColumnGap) {
        left.push(rawLine.slice(0, splitColumn).trim());
        right.push(rawLine.slice(splitColumn).trim());
        continue;
      }
      left.push(rawLine.trim());
    }

    const streams = [left.join('\n'), right.join('\n')];
    // When References starts in the right column, the left column is still
    // Discussion/Conclusion text on that page and must never be interpreted as
    // bibliography entries. A left-column heading means both columns belong
    // to the reference section and both streams are retained.
    const selectedStreams = headingColumn === 'right' ? [streams[1]] : streams;
    return selectedStreams.filter(stream => stream.trim().length > 0);
  }

  private parseReferenceStream(stream: string): string[] {
    const lines = String(stream || '')
      .split('\n')
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
    const references: string[] = [];
    let current = '';

    for (const line of lines) {
      if (this.isReferenceLayoutNoiseLine(line)) continue;
      const cleanedLine = line
        .replace(/^\s*(?:#{1,6}\s*|\*\*)?(?:references?|bibliography|literature cited|works cited|参考文献|参考资料)(?:\*\*)?\s*[:：]?\s*/i, '')
        .trim();
      if (!cleanedLine) continue;
      const startsNew = this.looksLikeReferenceStart(cleanedLine);
      if (startsNew) {
        if (current.length > 20) references.push(current.trim());
        current = cleanedLine;
      } else if (current) {
        current = `${current} ${cleanedLine}`;
      }
    }

    if (current.length > 20) references.push(current.trim());
    return references;
  }

  private isReferenceLayoutNoiseLine(line: string): boolean {
    const value = String(line || '').replace(/\s+/g, ' ').trim();
    if (!value) return true;
    return /downloaded from https?:\/\/|terms and conditions|creative commons license|online library on \[|^\d{6,},\s*\d{4},\s*\d+\b|^ecosphere\s+\d+\s+of\s+\d+$/i.test(value);
  }

  private looksLikeReferenceStart(line: string): boolean {
    const value = String(line || '').trim();
    const bracketedIndex = Number(value.match(/^\[(\d{1,4})\]\s*/)?.[1] || 0);
    if (bracketedIndex > 0) return true;
    const numberedIndex = Number(value.match(/^(\d{1,4})[.)]\s+/)?.[1] || 0);
    if (numberedIndex > 0 && (numberedIndex < 1900 || numberedIndex > 2099)) return true;
    const authorLead = String.raw`(?:[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’\x60-]{1,50}|(?:de|del|van|von|da|dos)\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'’\x60-]{1,50})`;
    if (new RegExp(`^${authorLead},\\s*[^]{0,220}?\\b(?:19|20)\\d{2}[a-z]?\\b`, 'i').test(value)) return true;
    if (new RegExp(`^${authorLead}\\s+[A-Z](?:[.\\s-]*[A-Z])?[.]?[,\\s]+[^]{0,180}?\\b(?:19|20)\\d{2}[a-z]?\\b`, 'i').test(value)) return true;
    if (new RegExp(`^${authorLead},\\s*(?:[A-Z](?:[.\\s-]*[A-Z])?[.]?[,\\s]+){1,6}`, 'i').test(value)) return true;
    return /^[A-Z][A-Z0-9&.-]{2,}(?:\s+[A-Z][A-Za-z&.-]+){0,4}\s+(?:19|20)\d{2}\b/.test(value);
  }

  private parseReferenceDetails(raw: string, sourcePdfId: string, sourcePdfName: string, index: number): PdfWikiReference {
    const year = raw.match(/\b(19|20)\d{2}\b/)?.[0];
    const doi = this.extractDoiFromReferenceRaw(raw);
    const explicitIndexMatch = raw.match(/^\s*(?:\[(\d+)\]\s*|(\d+)[.)]\s+)/);
    const explicitIndexCandidate = Number(explicitIndexMatch?.slice(1).find(Boolean) || 0);
    const explicitIndex = explicitIndexCandidate >= 1900 && explicitIndexCandidate <= 2099
      ? 0
      : explicitIndexCandidate;
    const cleaned = explicitIndex > 0
      ? raw.replace(/^\s*(?:\[\d+\]\s*|\d+[.)]\s+)/, '').trim()
      : raw.trim();
    const yearIndex = year ? cleaned.indexOf(year) : -1;
    const authors = yearIndex > 0 ? cleaned.slice(0, yearIndex).replace(/[()., ]+$/, '').trim() : undefined;
    const afterYear = yearIndex >= 0 ? cleaned.slice(yearIndex + 4).replace(/^[).,\s]+/, '') : cleaned;
    const title = afterYear.split(/\. (?=[A-Z][A-Za-z\s&-]{2,},? \d|[A-Z][A-Za-z\s&-]{2,}\.)/)[0]?.trim();
    const id = crypto.createHash('md5').update(`${sourcePdfId}:${index}:${raw}`).digest('hex').slice(0, 16);

    return {
      id: `ref_${id}`,
      raw,
      sourcePdfId,
      sourcePdfName,
      index: explicitIndex > 0 ? explicitIndex : index + 1,
      title: title || undefined,
      authors,
      year,
      journal: undefined,
      doi: doi || undefined,
    };
  }

  private extractDoiFromReferenceRaw(raw: string): string {
    const value = String(raw || '');
    const match = /\b10\.\d{4,9}\/[^\s,;]+/i.exec(value);
    if (!match || match.index === undefined) return '';

    let candidate = match[0];
    let remaining = value.slice(match.index + match[0].length);
    // Layout extraction can insert whitespace inside a DOI at a wrapped line,
    // for example "10.1111/j.1365- 2486.2008.01617.x". Join only strongly
    // signalled continuation tokens so normal words after a DOI are untouched.
    for (let index = 0; index < 3; index++) {
      const continuation = remaining.match(/^\s+([A-Za-z0-9][A-Za-z0-9._()/:+-]*)/);
      if (!continuation) break;
      const token = continuation[1];
      if (!/[-./]$/.test(candidate) && !/^\d/.test(token)) break;
      const needsDot = /^\d/.test(token)
        && /(?:j\.\d{4}-\d{4}(?:\.(?:19|20)\d{2})?|\.(?:19|20)\d{2})$/i.test(candidate);
      candidate += `${needsDot ? '.' : ''}${token}`;
      remaining = remaining.slice(continuation[0].length);
    }

    const normalized = this.normalizeDoi(candidate);
    if (!/^10\.\d{4,9}\/\S{3,}$/i.test(normalized) || /[-./]$/.test(normalized)) return '';
    return normalized;
  }

  private resolveReferences(claim: ExtractedClaim, referencePool: PdfWikiReference[], sourcePdfId: string): PdfWikiReference[] {
    const refs: PdfWikiReference[] = [];

    if (Array.isArray(claim.referenceIndexes)) {
      for (const rawIndex of claim.referenceIndexes) {
        const refIndex = Number(rawIndex);
        const match = referencePool.find(ref => ref.index === refIndex) || referencePool[refIndex - 1];
        if (match) refs.push(match);
      }
    }

    if (Array.isArray(claim.references)) {
      for (let index = 0; index < claim.references.length; index++) {
        const ref = claim.references[index];
        const raw = String(ref.raw || ref.title || '').trim();
        if (!raw && !ref.title) continue;
        const normalized = this.normalizeReferenceFromPartial(ref, sourcePdfId, '', index);
        if (normalized) refs.push(normalized);
      }
    }

    const citations = Array.isArray(claim.inTextCitations)
      ? claim.inTextCitations.map(String)
      : this.extractInTextCitations(`${claim.claim || ''} ${claim.evidence || ''}`);

    for (const citation of citations) {
      refs.push(...this.matchReferencesForCitations([citation], referencePool, [sourcePdfId]));
    }

    return this.uniqueReferences(refs);
  }

  private extractInTextCitations(text: string): string[] {
    const citations = new Set<string>();
    const citationText = this.normalizeSuperscriptCitationDigits(text);
    const author = String.raw`(?:[A-Z][A-Za-z'’\`-]+|[\u4e00-\u9fa5]{2,})(?:\s+(?:et\s+al\.?|and\s+[A-Z][A-Za-z'’\`-]+|&\s+[A-Z][A-Za-z'’\`-]+|等))?`;
    const year = String.raw`(?:19|20)\d{2}[a-z]?`;
    const authorYearMatches = citationText.match(new RegExp(String.raw`[\(（]${author}[,，]?\s+${year}(?:\s*[;；]\s*${author}[,，]?\s+${year})*[\)）]`, 'g')) || [];
    const authorParenYearMatches = citationText.match(new RegExp(String.raw`\b${author}\s*[\(（]\s*${year}\s*[\)）]`, 'g')) || [];
    const authorCommaYearMatches = citationText.match(new RegExp(String.raw`${author}[,，]\s*${year}\b`, 'g')) || [];
    const numericMatches = citationText.match(/\[[\d,，\s-]+\]/g) || [];
    const numericParenMatches = citationText.match(/[\(（](?:\d{1,3}(?:\s*[-,，]\s*\d{1,3})*)[\)）]/g) || [];
    const bareNumericClusters = citationText.match(/(?<=[a-z\)\]\}\u4e00-\u9fa5])\d{1,3}(?:\s*[,，]\s*\d{1,3}|\s*[-–]\s*\d{1,3})+(?=[\s.;,，；:]|$)/g) || [];
    const bareSingleNumerics = citationText.match(/(?<=[a-z\)\]\}\u4e00-\u9fa5])\d{1,3}(?=[.;；:]|$)/g) || [];
    for (const item of [
      ...authorYearMatches,
      ...authorParenYearMatches,
      ...authorCommaYearMatches,
      ...numericMatches,
      ...numericParenMatches,
      ...bareNumericClusters,
      ...bareSingleNumerics,
    ]) {
      citations.add(item);
    }
    return Array.from(citations);
  }

  private extractTerminalInTextCitations(text: string): string[] {
    const citationText = this.normalizeSuperscriptCitationDigits(text)
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[。.!?！？]+$/g, '')
      .trim();
    if (!citationText) return [];

    const tailStart = Math.max(0, citationText.length - 280);
    const tail = citationText.slice(tailStart);
    const citations = this.extractInTextCitations(tail);
    return citations.filter(citation => {
      const index = tail.lastIndexOf(citation);
      if (index < 0) return false;
      const after = tail.slice(index + citation.length)
        .replace(/[\s,，;；:：.。()\[\]（）]+/g, '')
        .trim();
      return after.length === 0;
    });
  }

  private normalizeSuperscriptCitationDigits(text: string): string {
    const superscriptDigits: Record<string, string> = {
      '⁰': '0',
      '¹': '1',
      '²': '2',
      '³': '3',
      '⁴': '4',
      '⁵': '5',
      '⁶': '6',
      '⁷': '7',
      '⁸': '8',
      '⁹': '9',
    };
    return String(text || '').replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => superscriptDigits[digit] || digit);
  }

  private extractReferenceTail(text: string): string {
    const match = this.findReferenceHeading(text);
    if (!match || match.index === undefined) return '';
    return text.slice(match.index).slice(0, 120000);
  }

  private stripReferenceTail(text: string): string {
    const match = this.findReferenceHeading(text);
    if (!match || match.index === undefined) return text;
    return text.slice(0, match.index);
  }

  private findReferenceHeading(text: string): RegExpExecArray | null {
    const normalized = String(text || '').replace(/\r/g, '\n');
    const patterns = [
      /(^|\n)\s{0,3}#{1,6}\s*(references|reference|bibliography|literature cited|works cited|参考文献|参考资料)\s*[:：]?\s*(?=\n|$)/i,
      /(^|\n)\s*(references|reference|bibliography|literature cited|works cited|参考文献|参考资料)\s*[:：]?\s*(?=\n|$)/i,
      /(^|\n)\s*\*\*(references|reference|bibliography|literature cited|works cited|参考文献|参考资料)\*\*\s*[:：]?\s*(?=\n|$)/i,
    ];
    for (const pattern of patterns) {
      const match = pattern.exec(normalized);
      if (match) return match;
    }

    // Layout-aware fallback: in two-column PDF text, the References heading is
    // often followed by the first entry from the other column on the same line,
    // or appears after a large gap at the right edge of a body-text line.
    const columnHeadingPattern = /(^|\n)(?:[ \t]{0,20}|[^\n]*?[ \t]{6,})(references|reference|bibliography|literature cited|works cited|参考文献|参考资料)[ \t]*[:：]?[ \t]*(?=[ \t]{2,}|\n|$)/ig;
    const candidates: RegExpExecArray[] = [];
    let candidate: RegExpExecArray | null;
    while ((candidate = columnHeadingPattern.exec(normalized)) !== null) {
      candidates.push(candidate);
      if (candidate[0].length === 0) columnHeadingPattern.lastIndex++;
    }
    if (candidates.length > 0) {
      const likelyStart = Math.floor(normalized.length * 0.25);
      return candidates.filter(item => (item.index || 0) >= likelyStart).at(-1) || candidates.at(-1) || null;
    }

    const trailingColumnHeadingPattern = /(^|\n)[^\n]*[ \t]{3,}(references|reference|bibliography|literature cited|works cited|参考文献|参考资料)[ \t]*[:：]?[ \t]*(?=\n|$)/ig;
    const trailingCandidates: RegExpExecArray[] = [];
    while ((candidate = trailingColumnHeadingPattern.exec(normalized)) !== null) {
      trailingCandidates.push(candidate);
      if (candidate[0].length === 0) trailingColumnHeadingPattern.lastIndex++;
    }
    if (trailingCandidates.length > 0) {
      const likelyStart = Math.floor(normalized.length * 0.25);
      return trailingCandidates.filter(item => (item.index || 0) >= likelyStart).at(-1) || trailingCandidates.at(-1) || null;
    }
    return null;
  }

  private splitIntoChunks(text: string, maxChars: number, maxChunks: number): string[] {
    const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
    const chunks: string[] = [];
    let current = '';

    for (const paragraph of paragraphs) {
      if ((current + '\n\n' + paragraph).length > maxChars && current) {
        chunks.push(current);
        current = paragraph;
      } else {
        current = current ? `${current}\n\n${paragraph}` : paragraph;
      }
      if (chunks.length >= maxChunks) break;
    }

    if (current && chunks.length < maxChunks) chunks.push(current);
    return chunks.length > 0 ? chunks : [text.slice(0, maxChars)];
  }

  private async summarizePdfForDeepAnalysis(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent,
    llmConfig: PdfWikiLlmConfig,
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis
  ): Promise<string> {
    const maxInputChars = this.getDeepAnalysisMaxInputChars();
    const text = parsed.text.length > maxInputChars
      ? `${parsed.text.slice(0, maxInputChars)}\n\n[由于原文较长，以上为前 ${maxInputChars} 字符内容。]`
      : parsed.text;
    const referencePreview = parsed.references
      .slice(0, 24)
      .map((ref, index) => `${index + 1}. ${[ref.authors, ref.year, ref.title || ref.raw, ref.journal, ref.doi].filter(Boolean).join(' | ')}`)
      .join('\n');
    const metadata = {
      title: pdf.title || parsed.metadata.title || pdf.originalName,
      authors: pdf.authors || parsed.metadata.authors || '',
      year: pdf.year || parsed.metadata.year || '',
      journal: pdf.journal || parsed.metadata.journal || '',
      doi: pdf.doi || parsed.metadata.doi || '',
      fileName: pdf.originalName,
    };

    return this.callChatCompletionWithMessages(llmConfig, [
      {
        role: 'system',
        content: '你是严谨的学术论文深度阅读助手。请用中文总结分析论文，只基于用户提供的 PDF 文字内容，不编造未出现的信息。只能输出 Markdown 文字分析，禁止输出 SVG、图片、JSON、代码块或 HTML。',
      },
      {
        role: 'user',
        content: `请对以下 PDF 论文做深入分析，输出 Markdown。

要求：
1. 用中文，结构清晰，面向论文写作和文献综述使用。
2. 必须覆盖：核心问题、研究设计/方法、数据或样本、主要发现、创新点、局限性、可引用观点、与用户现有研究的关系、与后续研究/写作的关系。
3. 如果文本中找不到某项信息，明确写“原文未明确提供”。
4. 不要输出 JSON、SVG、HTML、图片链接或代码块；本步骤只生成文字版深度分析。
5. 必须单独输出章节：## 与用户现有研究的关系。
6. “与用户现有研究的关系”只依据下面的用户研究上下文判断；如果上下文不足，明确说明缺少哪些信息，不要编造用户实验。
7. 该章节需要把这篇文章能提供的支撑分成几类写，优先使用这些类别：研究背景/问题依据、方法与实验设计参照、指标/变量/测定方法参照、结果对照与讨论支撑、机制解释、Meta分析数据提取参考、局限/反证/边界条件。每类都写清：能支撑什么、来自论文的依据、用户论文中怎么用、注意限制。

PDF 元数据：
${JSON.stringify(metadata, null, 2)}

用户现有研究上下文：
${this.formatUserResearchContextForPrompt(userResearchContext)}

参考文献预览：
${referencePreview || '未解析到参考文献'}

PDF 文字内容：
${text}`,
      },
    ], 5000, false).then(content => {
      const cleaned = String(content || '').trim();
      if (!cleaned) {
        throw new Error('LLM 未返回文字版深入分析');
      }
      if (/<svg\b|<html\b|<foreignObject\b/i.test(cleaned) && !/核心问题|研究设计|主要发现|局限性/.test(cleaned)) {
        throw new Error('LLM 返回了图形/HTML 内容而不是文字版深入分析');
      }
      return cleaned;
    });
  }

  private async summarizePdfForDeepAnalysisWithApiFallback(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent,
    llmConfig: PdfWikiLlmConfig,
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis
  ): Promise<{ summaryMarkdown: string; analysisEngine: Exclude<PdfWikiDeepAnalysisCache['analysisEngine'], 'codex' | 'local'> }> {
    const useSecondaryDirectly = !llmConfig.dedicated;
    try {
      return {
        summaryMarkdown: await this.summarizePdfForDeepAnalysis(pdf, parsed, llmConfig, userResearchContext),
        analysisEngine: useSecondaryDirectly ? 'secondary-api' : 'api',
      };
    } catch (error) {
      if (useSecondaryDirectly) {
        throw new Error(`小牛马 API 深入分析失败：${this.getErrorMessage(error)}`);
      }

      const fallbackConfig = this.getSecondaryApiFallbackConfig(llmConfig);
      if (fallbackConfig && this.isRecoverablePrimaryLlmError(error)) {
        logger.warn(
          `[PdfWiki] Primary deep analysis API failed for ${pdf.originalName}; falling back to configured secondary API (${fallbackConfig.model}):`,
          error
        );
        try {
          return {
            summaryMarkdown: await this.summarizePdfForDeepAnalysis(pdf, parsed, fallbackConfig, userResearchContext),
            analysisEngine: 'secondary-api',
          };
        } catch (fallbackError) {
          logger.warn(`[PdfWiki] Secondary API deep analysis fallback failed for ${pdf.originalName}:`, fallbackError);
          throw new Error(
            `PDF Wiki 专用 API 调用失败，已尝试小牛马 API 兜底但仍失败。专用 API：${this.getErrorMessage(error)}；小牛马 API：${this.getErrorMessage(fallbackError)}`
          );
        }
      }

      if (this.isRecoverablePrimaryLlmError(error)) {
        throw new Error(
          `PDF Wiki 专用 API 调用失败：${this.getErrorMessage(error)}。请改用 Codex CLI 深入分析，或在通用模型配置中填写可用的小牛马 API。`
        );
      }

      throw error;
    }
  }

  private getPdfOverviewFlowchartDesignGuide(): string {
    return [
      '论文一览图流程图设计规范：',
      '- 采用学术流程图结构，不做海报式堆字：核心问题 -> 研究设计/方法 -> 数据或样本 -> 主要发现 -> 结论，局限性作为最后的反思节点。',
      '- 每个节点必须有清晰层级：短标题、2-4 条编号要点、必要时用小标签标明“问题/方法/证据/发现/判断/复核”。',
      '- 主要信息块必须采用两行三列布局：第一行 3 个模块、第二行 3 个模块；两行整体水平居中，第二行三个模块的 x 坐标必须与第一行三个模块一一对齐。',
      '- 版式优先使用左右或蛇形 DAG 阅读路径，节点对齐到网格，箭头只表达主因果/研究路径，尽量避免交叉线。',
      '- 颜色使用深绿色主色、浅绿色节点、少量琥珀/青色强调关键发现，不使用紫色、蓝紫渐变、花哨装饰或随机图标。',
      '- 文字必须放在卡片内部并显式换行；中文每行不要过长，卡片留足内边距，标题、正文、编号之间保持稳定间距。',
      '- 视觉重心放在论文逻辑而不是装饰：留白、对齐、序号徽章、细线箭头、轻微阴影即可。',
      '- 不要生成外部依赖：禁止 script、foreignObject、外链图片、外部 CSS、事件属性。',
    ].join('\n');
  }

  private async summarizePdfForDeepAnalysisWithCodex(
    userId: string,
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent | null,
    config: PdfWikiCodexConfig,
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis
  ): Promise<{
    summaryMarkdown: string;
    overviewDiagram?: PdfWikiOverviewDiagram;
    evidenceDrafts?: PdfWikiDeepAnalysisEvidenceDraft[];
  }> {
    const safePdfId = this.getSafePdfCacheId(pdf);
    const taskDir = this.getCodexPdfWikiAuxTaskDir(userId, `deep_analysis_${safePdfId}`);
    await fs.promises.mkdir(taskDir, { recursive: true });
    await this.linkOrCopyFile(pdf.filePath, path.join(taskDir, 'source.pdf'));

    const metadata = {
      title: pdf.title || parsed?.metadata.title || pdf.originalName,
      authors: pdf.authors || parsed?.metadata.authors || '',
      year: pdf.year || parsed?.metadata.year || '',
      journal: pdf.journal || parsed?.metadata.journal || '',
      doi: pdf.doi || parsed?.metadata.doi || '',
      fileName: pdf.originalName,
    };
    const excerpt = parsed
      ? this.compactPromptText(parsed.text, Math.min(this.getDeepAnalysisMaxInputChars(), 90000))
      : '';
    if (excerpt) {
      await fs.promises.writeFile(path.join(taskDir, 'fulltext_excerpt.md'), excerpt, 'utf-8');
    }
    await fs.promises.writeFile(path.join(taskDir, 'user_research_context.md'), this.formatUserResearchContextForPrompt(userResearchContext), 'utf-8');
    await fs.promises.writeFile(path.join(taskDir, 'source_info.json'), JSON.stringify({
      paper_id: safePdfId,
      source_pdf: 'source.pdf',
      original_name: pdf.originalName,
      metadata,
      has_fulltext_excerpt: !!excerpt,
      prepared_at: new Date().toISOString(),
    }, null, 2), 'utf-8');

    const prompt = `你是严谨的学术论文深度阅读和信息图设计助手。当前目录是一篇 PDF 的深入分析任务目录。

文件：
- source.pdf：原始 PDF
${excerpt ? '- fulltext_excerpt.md：系统已解析出的正文摘录，可作为 PDF 读取失败时的后备文本' : ''}
- source_info.json：PDF 元信息
- user_research_context.md：用户跨会话长期记忆中的“试验资料总结”和“试验数据总结”

请直接分析 source.pdf；如果当前环境读取 PDF 不稳定，再使用 fulltext_excerpt.md。不要等待用户确认。

必须生成：
1. deep_analysis.md：中文 Markdown 深入分析。
2. overview_diagram.svg：一张论文一览图 SVG。
3. overview_diagram.json：结构化一览图信息。
4. wiki_evidence_items.json：可直接写入 PDF Wiki 的研究证据条目。

deep_analysis.md 必须覆盖：
- 核心问题
- 研究设计/方法
- 数据或样本
- 主要发现
- 结论
- 创新点
- 局限性
- 可引用观点
- 与用户现有研究的关系
- 与后续研究/写作的关系

deep_analysis.md 中“与用户现有研究的关系”要求：
- 必须单独使用标题：## 与用户现有研究的关系
- 只基于 user_research_context.md 中的用户研究上下文进行判断；上下文不足时明确说明缺少信息。
- 把这篇文章可能提供的支撑分成几类，优先使用：研究背景/问题依据、方法与实验设计参照、指标/变量/测定方法参照、结果对照与讨论支撑、机制解释、Meta分析数据提取参考、局限/反证/边界条件。
- 每类写清：能支撑什么、来自论文的依据、用户论文中怎么用、注意限制。
- 如果某类不适用，写“不适用/原文未明确提供”，不要硬凑。

overview_diagram.svg 要求：
- 独立 SVG，建议 viewBox 0 0 1200 780。
- 用中文概括整篇论文的研究逻辑、方法、主要发现、结论和局限。
- 视觉上要像一张论文思路一览图：标题、流程箭头、模块卡片、结果/结论强调区。
- 主体模块必须是两行三列：第一行 3 个卡片、第二行 3 个卡片；每一行整体水平居中，两行的三列 x 坐标必须严格对齐。
- 整体配色使用深绿色系：深绿色背景/标题/箭头，浅绿色卡片底色，避免紫色、蓝紫渐变或花哨装饰。
- 每个模块气泡/卡片必须根据内部文字自动留足宽度和高度，文字必须在形状内部换行显示，不能跑出气泡/卡片边界。
- 如果模块内容是多条要点，必须在气泡/卡片内用“1.”、“2.”、“3.”这样的序号逐条呈现；不要只用无序圆点。
- 优先使用圆角矩形卡片而不是过小圆形气泡；卡片内边距至少 18px，文字行距清晰。
- 箭头和箭头头要小巧，不要喧宾夺主；连接线线宽不超过 1.5px，箭头头尺寸约为普通字号的 1/3。
- 禁止 script、foreignObject、外部图片、外部 CSS、onclick/onload 等事件属性。
- 只使用 SVG 原生形状、线条、渐变、文字。

${this.getPdfOverviewFlowchartDesignGuide()}

overview_diagram.json 格式：
{
  "title": "",
  "researchQuestion": "",
  "methods": [],
  "dataSample": "",
  "keyFindings": [],
  "conclusions": [],
  "limitations": []
}

wiki_evidence_items.json 格式：
{
  "items": [
    {
      "claim": "可直接用于论文写作的原子论点，不能把多个结论拼成一句",
      "evidence": "必须逐字摘录 source.pdf/fulltext_excerpt.md 中真正支持该论点的一至两句原文",
      "category": "background|method|indicator|result-comparison|mechanism|meta-analysis|limitation",
      "researchUse": "结合 user_research_context.md，说明用户论文中具体如何使用",
      "supportScope": ["该证据能支持的对象、条件、变量或结论范围"],
      "limitations": ["不能外推的对象、条件或解释边界"],
      "keywords": ["3-8 个中英文检索词"],
      "section": "原文章节",
      "location": "页码/章节/图表位置（不确定时只写章节）",
      "confidence": 0.0
    }
  ]
}

wiki_evidence_items.json 硬性约束：
- 每条 evidence 必须是 PDF 原文逐字摘录，禁止把你的中文总结写成 evidence。
- 每条只表达一个原子论点；优先提取与用户现有研究直接相关且可用于背景、方法、结果比较、机制讨论或边界限定的内容。
- category 只能使用给定的 7 个枚举值。
- confidence 取 0-1；找不到可核验原文证据的内容不要输出。
- 不要根据语义猜文献编号或参考文献；引用关系由系统根据 evidence 原句中的显式引用另行绑定。

PDF 元信息：
${JSON.stringify(metadata, null, 2)}

用户现有研究上下文：
${this.formatUserResearchContextForPrompt(userResearchContext)}

${excerpt ? `正文摘录：\n${excerpt}` : '未提供正文摘录；请直接读取 source.pdf。'}

最终回复只用一句话说明已生成文件。`;

    const lastMessage = await this.runCodexTextTask(config, taskDir, prompt, 'deep-analysis');
    const summaryMarkdown = (await this.readTextFileIfExists(path.join(taskDir, 'deep_analysis.md'))).trim()
      || lastMessage.trim();
    const rawSvg = await this.readTextFileIfExists(path.join(taskDir, 'overview_diagram.svg'));
    const rawEvidence = this.asRecord(await this.readJsonFileIfExists(path.join(taskDir, 'wiki_evidence_items.json')));
    const evidenceDrafts = (Array.isArray(rawEvidence.items) ? rawEvidence.items : [])
      .filter(item => item && typeof item === 'object') as PdfWikiDeepAnalysisEvidenceDraft[];
    const svg = this.sanitizeOverviewSvg(rawSvg);
    if (!summaryMarkdown) {
      throw new Error('Codex 未生成 deep_analysis.md');
    }
    if (!svg) {
      return { summaryMarkdown, evidenceDrafts };
    }
    return {
      summaryMarkdown,
      evidenceDrafts,
      overviewDiagram: {
        kind: 'svg',
        engine: 'codex',
        title: this.firstString(this.asRecord(await this.readJsonFileIfExists(path.join(taskDir, 'overview_diagram.json'))).title, metadata.title, pdf.originalName),
        svg,
        generatedAt: new Date().toISOString(),
        layoutVersion: PDF_WIKI_OVERVIEW_DIAGRAM_LAYOUT_VERSION,
        sourceFiles: [
          path.join(taskDir, 'deep_analysis.md'),
          path.join(taskDir, 'overview_diagram.svg'),
          path.join(taskDir, 'overview_diagram.json'),
        ],
      },
    };
  }

  private async buildOverviewDiagramWithSecondaryApi(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent | null,
    summaryMarkdown: string,
    llmConfig: PdfWikiLlmConfig
  ): Promise<PdfWikiOverviewDiagram | undefined> {
    const diagramConfig = this.getSecondaryOverviewDiagramConfig(llmConfig);
    if (!diagramConfig) return undefined;

    const title = this.compactPromptText(pdf.title || parsed?.metadata.title || pdf.originalName || 'PDF 论文一览图', 90);
    const metadata = {
      title,
      authors: pdf.authors || parsed?.metadata.authors || '',
      year: pdf.year || parsed?.metadata.year || '',
      journal: pdf.journal || parsed?.metadata.journal || '',
      doi: pdf.doi || parsed?.metadata.doi || '',
      fileName: pdf.originalName,
    };
    const summary = this.compactPromptText(summaryMarkdown, 18000);

    try {
      const rawSvg = await this.callChatCompletionWithMessages(diagramConfig, [
        {
          role: 'system',
          content: '你是学术论文信息图设计助手。你只输出一个完整 SVG，不输出 Markdown、解释、JSON 或代码块。',
        },
        {
          role: 'user',
          content: `请根据以下 PDF 深度分析文本生成一张中文“论文一览图”SVG。

硬性要求：
1. 只输出 <svg>...</svg>，不要 Markdown 代码块。
2. viewBox 建议为 0 0 1200 780，可根据内容自适应加高。
3. 覆盖：核心问题、研究设计/方法、数据或样本、主要发现、结论、局限性。
4. 视觉结构要像论文研究逻辑图：问题 -> 方法 -> 数据 -> 发现 -> 结论 -> 局限。
5. 主体模块必须是两行三列：第一行 3 个卡片、第二行 3 个卡片；每行整体水平居中，第二行三个卡片的 x 坐标必须与第一行三个卡片一一对齐。
6. 使用深绿色系背景/标题/箭头，浅绿色卡片，避免紫色、蓝紫渐变、过度装饰。
7. 只能使用 SVG 原生元素；禁止 script、foreignObject、外部图片、外部 CSS、onclick/onload、外链。
8. 所有中文必须在卡片内换行，不得跑出卡片边界；卡片内边距至少 18px。
9. 箭头小巧，连接线线宽不超过 1.5px。
10. 不要新增分析文本中没有的信息；缺失信息写“原文未明确提供”。

${this.getPdfOverviewFlowchartDesignGuide()}

PDF 元数据：
${JSON.stringify(metadata, null, 2)}

深度分析文本：
${summary}`,
        },
      ], 7000, false);
      const svg = this.sanitizeOverviewSvg(rawSvg);
      if (!svg) {
        logger.warn(`[PdfWiki] Secondary API overview diagram returned no valid SVG for ${pdf.originalName}`);
        return undefined;
      }

      return {
        kind: 'svg',
        engine: 'secondary-api',
        title,
        svg,
        generatedAt: new Date().toISOString(),
        layoutVersion: PDF_WIKI_OVERVIEW_DIAGRAM_LAYOUT_VERSION,
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Secondary API overview diagram failed for ${pdf.originalName}, falling back to local code SVG:`, error);
      return undefined;
    }
  }

  private buildLocalDeepAnalysisMarkdown(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent,
    userResearchContext: PdfWikiUserResearchContextForDeepAnalysis
  ): string {
    const text = this.normalizeExtractedText(parsed.text);
    const abstractText = this.extractSectionByHeading(text, ['abstract', '摘要'], ['keywords', 'introduction', '1 introduction']).slice(0, 1200);
    const methodsText = this.extractSectionByHeading(text, [
      'materials and methods',
      'material and methods',
      'methods',
      'methodology',
    ], ['results', 'result', 'discussion']).slice(0, 1600);
    const resultsText = this.extractSectionByHeading(text, ['results', 'result'], ['discussion', 'conclusion']).slice(0, 1600);
    const discussionText = this.extractSectionByHeading(text, ['discussion', 'conclusions', 'conclusion'], ['references']).slice(0, 1800);
    return [
      `# ${pdf.title || parsed.metadata.title || pdf.originalName}`,
      '',
      '## 核心问题',
      abstractText || '原文未明确提供；请结合 PDF 原文人工核查。',
      '',
      '## 研究设计/方法',
      methodsText || '原文未明确提供。',
      '',
      '## 数据或样本',
      methodsText ? this.compactPromptText(methodsText, 700) : '原文未明确提供。',
      '',
      '## 主要发现',
      resultsText || discussionText || '原文未明确提供。',
      '',
      '## 结论',
      discussionText || resultsText || '原文未明确提供。',
      '',
      '## 局限性',
      '原文未明确提供；请人工核查 Discussion 或 Limitation 相关段落。',
      '',
      '## 可引用观点',
      discussionText || abstractText || '原文未明确提供。',
      '',
      '## 与用户现有研究的关系',
      this.buildLocalResearchRelevanceMarkdown(userResearchContext),
      '',
      '## 与后续研究/写作的关系',
      '可作为文献综述、讨论或方法参照的候选文献；具体使用位置需要结合用户研究问题、实验处理和数据结果进一步筛选。',
    ].join('\n');
  }

  private buildCodePdfOverviewDiagram(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent | null,
    summaryMarkdown: string
  ): PdfWikiOverviewDiagram {
    const title = this.compactPromptText(pdf.title || parsed?.metadata.title || pdf.originalName || 'PDF 论文一览', 90);
    const cardSections = [
      {
        label: '核心问题',
        tag: '问题定位',
        text: this.extractDeepAnalysisSection(summaryMarkdown, ['核心问题', '研究问题', '科学问题']),
        fill: '#effdf5',
        headerFill: '#bbf7d0',
        stroke: '#059669',
        badgeFill: '#d1fae5',
      },
      {
        label: '研究设计/方法',
        tag: '方法路径',
        text: this.extractDeepAnalysisSection(summaryMarkdown, ['研究设计/方法', '研究设计', '方法', '研究方法']),
        fill: '#f0fdfa',
        headerFill: '#99f6e4',
        stroke: '#0d9488',
        badgeFill: '#ccfbf1',
      },
      {
        label: '数据或样本',
        tag: '证据基础',
        text: this.extractDeepAnalysisSection(summaryMarkdown, ['数据或样本', '数据', '样本']),
        fill: '#f7fee7',
        headerFill: '#d9f99d',
        stroke: '#65a30d',
        badgeFill: '#ecfccb',
      },
      {
        label: '主要发现',
        tag: '关键发现',
        text: this.extractDeepAnalysisSection(summaryMarkdown, ['主要发现', '结果', '研究结果']),
        fill: '#fffbeb',
        headerFill: '#fde68a',
        stroke: '#d97706',
        badgeFill: '#fef3c7',
      },
      {
        label: '结论',
        tag: '核心判断',
        text: this.extractDeepAnalysisSection(summaryMarkdown, ['结论', '主要结论']),
        fill: '#ecfdf5',
        headerFill: '#86efac',
        stroke: '#16a34a',
        badgeFill: '#dcfce7',
      },
      {
        label: '局限性',
        tag: '需要复核',
        text: this.extractDeepAnalysisSection(summaryMarkdown, ['局限性', '限制', '不足']),
        fill: '#f8fafc',
        headerFill: '#cbd5e1',
        stroke: '#64748b',
        badgeFill: '#e2e8f0',
      },
    ].map(card => ({
      label: card.label,
      tag: card.tag,
      items: this.extractDiagramItems(card.text || '原文未明确提供', 4),
      fill: card.fill,
      headerFill: card.headerFill,
      stroke: card.stroke,
      badgeFill: card.badgeFill,
    }));

    const width = 1200;
    const titleLines = this.wrapSvgText(title, 35, 2);
    const titleBlockHeight = titleLines.length > 1 ? 76 : 42;
    const headerTop = 52;
    const metaY = headerTop + titleBlockHeight + 12;
    const logicY = metaY + 38;
    const topY = logicY + 42;
    const marginX = 58;
    const cardWidth = 330;
    const gapX = 47;
    const gapY = 88;
    const headerHeight = 66;
    const bodyTopPadding = 28;
    const bodyBottomPadding = 32;
    const bodyLineHeight = 23;
    const itemGap = 12;
    const cardModels = cardSections.map((card, index) => {
      const lineGroups = card.items.map(item => this.wrapSvgText(item, 17, 4));
      const lineCount = lineGroups.reduce((sum, lines) => sum + Math.max(1, lines.length), 0);
      const bodyHeight = lineCount * bodyLineHeight + Math.max(0, lineGroups.length - 1) * itemGap;
      return {
        ...card,
        number: index + 1,
        lineGroups,
        height: Math.max(214, headerHeight + bodyTopPadding + bodyHeight + bodyBottomPadding),
      };
    });
    const layoutOrder = [0, 1, 2, 5, 4, 3];
    const row1Height = Math.max(...layoutOrder.slice(0, 3).map(index => cardModels[index].height));
    const row2Height = Math.max(...layoutOrder.slice(3).map(index => cardModels[index].height));
    const bottomY = topY + row1Height + gapY;
    const height = Math.max(780, bottomY + row2Height + 92);
    const positions = layoutOrder.map((cardIndex, layoutIndex) => ({
      cardIndex,
      x: marginX + (layoutIndex % 3) * (cardWidth + gapX),
      y: layoutIndex < 3 ? topY : bottomY,
    }));
    const positionByCardIndex = new Map(positions.map(pos => [pos.cardIndex, pos]));
    const cardSvgs = positions.map((pos, layoutIndex) => {
      const card = cardModels[pos.cardIndex];
      const bodyStartY = pos.y + headerHeight + bodyTopPadding;
      let cursorY = bodyStartY;
      const itemSvgs: string[] = [];
      card.lineGroups.forEach((lines, itemIndex) => {
        itemSvgs.push(`<circle cx="${pos.x + 34}" cy="${cursorY - 5}" r="11" fill="${card.badgeFill}" stroke="${card.stroke}" stroke-width="1"/>`);
        itemSvgs.push(`<text x="${pos.x + 34}" y="${cursorY}" text-anchor="middle" font-size="11" font-weight="850" fill="#064e3b">${itemIndex + 1}</text>`);
        lines.forEach((line, lineIndex) => {
          itemSvgs.push(`<text x="${pos.x + 58}" y="${cursorY + lineIndex * bodyLineHeight}" font-size="14" fill="#064e3b">${this.escapeSvgText(line)}</text>`);
        });
        cursorY += Math.max(1, lines.length) * bodyLineHeight + (itemIndex < card.lineGroups.length - 1 ? itemGap : 0);
      });
      return [
        `<g filter="url(#cardShadow)">`,
        `<rect x="${pos.x}" y="${pos.y}" width="${cardWidth}" height="${card.height}" rx="18" fill="${card.fill}" stroke="${card.stroke}" stroke-width="2"/>`,
        `<rect x="${pos.x}" y="${pos.y}" width="${cardWidth}" height="${headerHeight}" rx="18" fill="${card.headerFill}"/>`,
        `<path d="M ${pos.x} ${pos.y + 42} Q ${pos.x} ${pos.y + headerHeight} ${pos.x + 18} ${pos.y + headerHeight} L ${pos.x + cardWidth - 18} ${pos.y + headerHeight} Q ${pos.x + cardWidth} ${pos.y + headerHeight} ${pos.x + cardWidth} ${pos.y + 42} L ${pos.x + cardWidth} ${pos.y + headerHeight} L ${pos.x} ${pos.y + headerHeight} Z" fill="${card.headerFill}"/>`,
        `<rect x="${pos.x + 20}" y="${pos.y + 17}" width="42" height="26" rx="13" fill="#ffffff" opacity="0.82"/>`,
        `<text x="${pos.x + 41}" y="${pos.y + 35}" text-anchor="middle" font-size="12" font-weight="900" fill="#052e2b">${String(card.number).padStart(2, '0')}</text>`,
        `<text x="${pos.x + 76}" y="${pos.y + 31}" font-size="19" font-weight="850" fill="#052e2b">${this.escapeSvgText(card.label)}</text>`,
        `<text x="${pos.x + 76}" y="${pos.y + 52}" font-size="11" font-weight="650" fill="#0f766e">${this.escapeSvgText(card.tag)}</text>`,
        `<rect x="${pos.x}" y="${pos.y + headerHeight}" width="6" height="${card.height - headerHeight}" fill="${card.stroke}" opacity="0.72"/>`,
        ...itemSvgs,
        `</g>`,
      ].join('\n');
    }).join('\n');
    const corePos = positionByCardIndex.get(0)!;
    const methodPos = positionByCardIndex.get(1)!;
    const dataPos = positionByCardIndex.get(2)!;
    const findingsPos = positionByCardIndex.get(3)!;
    const conclusionPos = positionByCardIndex.get(4)!;
    const limitsPos = positionByCardIndex.get(5)!;
    const arrowSvgs = [
      this.svgArrow(corePos.x + cardWidth + 8, corePos.y + cardModels[0].height / 2, methodPos.x - 8, methodPos.y + cardModels[1].height / 2),
      this.svgArrow(methodPos.x + cardWidth + 8, methodPos.y + cardModels[1].height / 2, dataPos.x - 8, dataPos.y + cardModels[2].height / 2),
      this.svgArrow(dataPos.x + cardWidth / 2, dataPos.y + cardModels[2].height + 12, findingsPos.x + cardWidth / 2, findingsPos.y - 12),
      this.svgArrow(findingsPos.x - 8, findingsPos.y + cardModels[3].height / 2, conclusionPos.x + cardWidth + 8, conclusionPos.y + cardModels[4].height / 2),
      this.svgArrow(conclusionPos.x - 8, conclusionPos.y + cardModels[4].height / 2, limitsPos.x + cardWidth + 8, limitsPos.y + cardModels[5].height / 2),
    ].join('\n');
    const metaLine = [pdf.authors || parsed?.metadata.authors, pdf.year || parsed?.metadata.year, pdf.journal || parsed?.metadata.journal]
      .filter(Boolean)
      .join(' · ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="PDF 论文一览图">
  <defs>
    <filter id="cardShadow" x="-8%" y="-8%" width="116%" height="120%">
      <feDropShadow dx="0" dy="10" stdDeviation="8" flood-color="#022c22" flood-opacity="0.18"/>
    </filter>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#052e2b"/>
      <stop offset="52%" stop-color="#064e3b"/>
      <stop offset="100%" stop-color="#0f766e"/>
    </linearGradient>
    <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.2" markerHeight="4.2" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#d1fae5"/>
    </marker>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg)"/>
  <rect x="38" y="30" width="1124" height="${height - 62}" rx="30" fill="#ffffff" opacity="0.07" stroke="#a7f3d0" stroke-width="1"/>
  <path d="M 58 ${topY - 24} L ${dataPos.x + cardWidth / 2} ${topY - 24} Q ${dataPos.x + cardWidth / 2} ${topY - 24} ${dataPos.x + cardWidth / 2} ${findingsPos.y - 34} L ${limitsPos.x + cardWidth / 2} ${findingsPos.y - 34}" fill="none" stroke="#d1fae5" stroke-width="6" stroke-linecap="round" opacity="0.13"/>
  ${titleLines.map((line, index) => `<text x="58" y="${headerTop + index * 34}" font-size="32" font-weight="850" fill="#ecfdf5">${this.escapeSvgText(line)}</text>`).join('\n  ')}
  <text x="58" y="${metaY}" font-size="16" fill="#bbf7d0">${this.escapeSvgText(metaLine || 'PDF 深入分析生成的论文逻辑一览')}</text>
  <g>
    <rect x="58" y="${logicY - 25}" width="502" height="36" rx="18" fill="#ecfdf5" opacity="0.12" stroke="#a7f3d0" stroke-width="1"/>
    <text x="78" y="${logicY}" font-size="17" font-weight="800" fill="#d1fae5">研究路径：问题 → 方法 → 数据 → 发现 → 结论 → 局限</text>
  </g>
  ${arrowSvgs}
  ${cardSvgs}
  <text x="58" y="${height - 36}" font-size="13" fill="#bbf7d0">由本地代码根据深入分析文本绘制；请以 PDF 原文和证据句为最终依据。</text>
</svg>`;

    return {
      kind: 'svg',
      engine: 'code',
      title,
      svg: this.sanitizeOverviewSvg(svg),
      generatedAt: new Date().toISOString(),
      layoutVersion: PDF_WIKI_OVERVIEW_DIAGRAM_LAYOUT_VERSION,
    };
  }

  private extractDeepAnalysisSection(markdown: string, labels: string[]): string {
    const text = String(markdown || '').replace(/\r/g, '\n');
    for (const label of labels) {
      const pattern = new RegExp(`(^|\\n)\\s{0,3}#{1,4}\\s*${this.escapeRegExp(label)}\\s*[:：]?\\s*\\n`, 'i');
      const match = pattern.exec(text);
      if (!match || match.index === undefined) continue;
      const start = match.index + match[0].length;
      const rest = text.slice(start);
      const next = /\n\s{0,3}#{1,4}\s+\S/.exec(rest);
      return (next && next.index !== undefined ? rest.slice(0, next.index) : rest).trim();
    }
    return '';
  }

  private cleanDiagramText(text: string): string {
    return String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
      .replace(/\[[^\]]+]\([^)]*\)/g, match => match.replace(/^\[|\]\([^)]*\)$/g, ''))
      .replace(/^[-*+]\s+/gm, '')
      .replace(/^\d+[.)]\s+/gm, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 420);
  }

  private extractDiagramItems(text: string, maxItems: number): string[] {
    const raw = String(text || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
      .replace(/\r/g, '\n')
      .trim();
    const lines = raw
      .split(/\n+/)
      .map(line => line.replace(/^\s{0,3}#{1,6}\s+/, '').trim())
      .filter(Boolean);
    const listItems = lines
      .map(line => line.match(/^\s*(?:[-*+]|\d+[.)、．])\s*(.+)$/)?.[1] || '')
      .map(item => this.cleanDiagramItem(item))
      .filter(Boolean);
    const sourceItems = listItems.length >= 2
      ? listItems
      : (this.cleanDiagramText(lines.join(' ')) || '原文未明确提供')
          .split(/(?<=[。！？!?；;])\s*/u)
          .map(item => this.cleanDiagramItem(item))
          .filter(item => item.length >= 4);
    const items = sourceItems.length > 0 ? sourceItems : ['原文未明确提供'];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of items) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(this.compactPromptText(item, 140));
      if (result.length >= maxItems) break;
    }
    return result.length > 0 ? result : ['原文未明确提供'];
  }

  private cleanDiagramItem(text: string): string {
    return String(text || '')
      .replace(/^\s*(?:[-*+]|\d+[.)、．])\s*/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[:：]+/, '')
      .replace(/\s+([。！？!?；;,.，])$/g, '$1');
  }

  private wrapSvgText(text: string, maxChars: number, maxLines: number): string[] {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return [];
    const lines: string[] = [];
    let current = '';
    for (const token of this.tokenizeSvgText(normalized)) {
      const next = token === ' '
        ? (current && !current.endsWith(' ') ? `${current} ` : current)
        : `${current}${token}`.trimStart();
      if (this.estimateSvgTextUnits(next) > maxChars && current) {
        lines.push(current.trim());
        current = token.trim();
      } else {
        current = next;
      }
      if (lines.length >= maxLines) break;
    }
    if (current && lines.length < maxLines) lines.push(current.trim());
    if (lines.length === maxLines && this.estimateSvgTextUnits(normalized) > this.estimateSvgTextUnits(lines.join(''))) {
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[。；;,.，]+$/g, '')}...`;
    }
    return lines;
  }

  private tokenizeSvgText(text: string): string[] {
    const tokens: string[] = [];
    let asciiRun = '';
    const flushAscii = (): void => {
      if (asciiRun) {
        tokens.push(asciiRun);
        asciiRun = '';
      }
    };
    for (const char of Array.from(text)) {
      if (/\s/.test(char)) {
        flushAscii();
        tokens.push(' ');
      } else if (/^[\x00-\x7F]$/.test(char) && /[A-Za-z0-9._%/+&-]/.test(char)) {
        asciiRun += char;
      } else {
        flushAscii();
        tokens.push(char);
      }
    }
    flushAscii();
    return tokens.flatMap(token => {
      if (this.estimateSvgTextUnits(token) <= 18) return [token];
      return Array.from(token);
    });
  }

  private estimateSvgTextUnits(text: string): number {
    return Array.from(String(text || '')).reduce((sum, char) => sum + (/^[\x00-\x7F]$/.test(char) ? 0.56 : 1), 0);
  }

  private svgArrow(x1: number, y1: number, x2: number, y2: number): string {
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#a7f3d0" stroke-width="1.5" marker-end="url(#arrow)"/>`;
  }

  private sanitizeOverviewSvg(svg: string): string {
    const match = String(svg || '').match(/<svg\b[\s\S]*<\/svg>/i);
    if (!match) return '';
    let cleaned = match[0]
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(?:href|xlink:href)\s*=\s*(?:"\s*javascript:[^"]*"|'\s*javascript:[^']*')/gi, '')
      .replace(/\s+(?:href|xlink:href)\s*=\s*(?:"\s*https?:\/\/[^"]*"|'\s*https?:\/\/[^']*')/gi, '');
    if (!/\sxmlns=/.test(cleaned.slice(0, 300))) {
      cleaned = cleaned.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
    }
    return cleaned.slice(0, 500000);
  }

  private ensureUsableOverviewDiagram(
    pdf: PdfWikiSourcePdf,
    parsed: PdfWikiParsedContent | null,
    summaryMarkdown: string,
    candidate: PdfWikiOverviewDiagram | undefined
  ): PdfWikiOverviewDiagram {
    if (
      candidate
      && candidate.layoutVersion === PDF_WIKI_OVERVIEW_DIAGRAM_LAYOUT_VERSION
      && this.isUsableOverviewDiagram(candidate)
    ) {
      return candidate;
    }
    if (candidate) {
      logger.warn(`[PdfWiki] Overview diagram for ${pdf.originalName} failed readability gate; using deterministic code SVG fallback`);
    }
    return this.buildCodePdfOverviewDiagram(pdf, parsed, summaryMarkdown);
  }

  private isUsableOverviewDiagram(diagram: PdfWikiOverviewDiagram | undefined): boolean {
    const svg = this.sanitizeOverviewSvg(diagram?.svg || '');
    if (!svg || svg.length < 1800) return false;
    const textCount = (svg.match(/<text\b/gi) || []).length;
    const shapeCount = (svg.match(/<(?:rect|path|line|polyline|polygon|circle|ellipse)\b/gi) || []).length;
    if (textCount < 8 || shapeCount < 8) return false;
    const bodyText = svg
      .replace(/<style\b[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, '')
      .trim();
    if (bodyText.length < 80) return false;
    const colors = Array.from(svg.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)).map(match => this.normalizeSvgHexColor(match[1]));
    const darkColors = colors.filter(color => color && this.getSvgColorLuminance(color) < 0.58);
    if (darkColors.length < 3) return false;
    const ultraLightTextMatches = Array.from(svg.matchAll(/<text\b[^>]*(?:fill|stroke)\s*=\s*["']#([0-9a-f]{3}|[0-9a-f]{6})["'][^>]*>/gi))
      .map(match => this.normalizeSvgHexColor(match[1]))
      .filter(color => color && this.getSvgColorLuminance(color) > 0.86);
    if (ultraLightTextMatches.length > 0 && ultraLightTextMatches.length >= Math.max(4, Math.ceil(textCount * 0.55))) {
      return false;
    }
    if (diagram?.engine !== 'code' && !this.hasCenteredTwoRowOverviewLayout(svg)) {
      return false;
    }
    return true;
  }

  private hasCenteredTwoRowOverviewLayout(svg: string): boolean {
    const cards = Array.from(svg.matchAll(/<rect\b[^>]*>/gi))
      .map(match => this.parseSvgRectGeometry(match[0]))
      .filter((rect): rect is { x: number; y: number; width: number; height: number } => {
        return !!rect
          && rect.width >= 150
          && rect.width <= 520
          && rect.height >= 90
          && rect.height <= 520;
      })
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (cards.length < 6) return false;

    const rows: Array<{ y: number; items: Array<{ x: number; y: number; width: number; height: number }> }> = [];
    for (const card of cards) {
      let row = rows.find(item => Math.abs(item.y - card.y) <= 90);
      if (!row) {
        row = { y: card.y, items: [] };
        rows.push(row);
      }
      row.items.push(card);
      row.y = row.items.reduce((sum, item) => sum + item.y, 0) / row.items.length;
    }

    const candidateRows = rows
      .filter(row => row.items.length >= 3)
      .sort((a, b) => a.y - b.y)
      .slice(0, 2);
    if (candidateRows.length < 2) return false;

    const normalized = candidateRows.map(row => {
      const sorted = row.items
        .sort((a, b) => a.x - b.x)
        .slice(0, 3);
      const left = Math.min(...sorted.map(item => item.x));
      const right = Math.max(...sorted.map(item => item.x + item.width));
      return {
        center: (left + right) / 2,
        centers: sorted.map(item => item.x + item.width / 2),
      };
    });

    if (normalized.some(row => Math.abs(row.center - 600) > 90)) return false;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(normalized[0].centers[i] - normalized[1].centers[i]) > 70) return false;
    }
    return true;
  }

  private parseSvgRectGeometry(tag: string): { x: number; y: number; width: number; height: number } | null {
    const attr = (name: string): number => {
      const match = new RegExp(`\\b${name}\\s*=\\s*["']?(-?\\d+(?:\\.\\d+)?)`, 'i').exec(tag);
      return match ? Number(match[1]) : NaN;
    };
    const x = attr('x');
    const y = attr('y');
    const width = attr('width');
    const height = attr('height');
    if (![x, y, width, height].every(Number.isFinite)) return null;
    return { x, y, width, height };
  }

  private normalizeSvgHexColor(value: string): string {
    const raw = String(value || '').trim().replace(/^#/, '');
    if (/^[0-9a-f]{3}$/i.test(raw)) {
      return raw.split('').map(char => `${char}${char}`).join('').toLowerCase();
    }
    return /^[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : '';
  }

  private getSvgColorLuminance(hex: string): number {
    const normalized = this.normalizeSvgHexColor(hex);
    if (!normalized) return 1;
    const channels = [0, 2, 4].map(offset => parseInt(normalized.slice(offset, offset + 2), 16) / 255);
    const linear = channels.map(value => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  }

  private shouldRebuildOverviewDiagram(diagram: PdfWikiOverviewDiagram | undefined): boolean {
    if (!diagram) return true;
    return diagram.layoutVersion !== PDF_WIKI_OVERVIEW_DIAGRAM_LAYOUT_VERSION
      || !this.isUsableOverviewDiagram(diagram);
  }

  private normalizeOverviewDiagram(value: unknown): PdfWikiOverviewDiagram | undefined {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Partial<PdfWikiOverviewDiagram>;
    const svg = this.sanitizeOverviewSvg(String(record.svg || ''));
    if (!svg) return undefined;
    const engine = record.engine === 'codex' || record.engine === 'secondary-api' ? record.engine : 'code';
    return {
      kind: 'svg',
      engine,
      title: String(record.title || 'PDF 论文一览图'),
      svg,
      generatedAt: String(record.generatedAt || new Date().toISOString()),
      layoutVersion: Number(record.layoutVersion || 0) || undefined,
      sourceFiles: Array.isArray(record.sourceFiles) ? record.sourceFiles.map(String).filter(Boolean) : undefined,
    };
  }

  private normalizeParsedContentParser(value: unknown): PdfWikiParsedContent['parser'] {
    const parser = String(value || '').trim().toLowerCase();
    if (parser === 'codex' || parser === 'liteparse' || parser === 'marker' || parser === 'fast-text' || parser === 'textin' || parser === 'grobid' || parser === 'pdf-parse') {
      return parser;
    }
    return 'codex';
  }

  private getParsedContentParserLabel(parser: PdfWikiParsedContent['parser']): string {
    if (parser === 'liteparse') return 'LiteParse 本地解析';
    if (parser === 'marker') return 'Marker 外部工具';
    if (parser === 'fast-text') return 'pdf-marker-md 快速文本';
    if (parser === 'textin') return 'TextIn';
    if (parser === 'pdf-parse') return '本地 pdf-parse';
    return parser;
  }

  private escapeSvgText(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getDeepAnalysisMaxInputChars(): number {
    const parsed = Number(process.env.PDF_WIKI_DEEP_ANALYSIS_MAX_INPUT_CHARS || 60000);
    if (!Number.isFinite(parsed) || parsed < 10000) return 60000;
    return Math.min(Math.floor(parsed), 180000);
  }

  private async callChatJson(
    llmConfig: PdfWikiLlmConfig,
    prompt: string,
    maxTokens: number,
    contextLabel = 'unknown'
  ): Promise<Record<string, unknown>> {
    let content = await this.callChatCompletion(llmConfig, prompt, maxTokens, true);
    if (!content.trim()) {
      logger.warn(`[PdfWiki] ${contextLabel} JSON empty, retrying once without JSON mode`);
      const fallbackPrompt = `${prompt}

重要：上一次响应为空。请务必返回一个 JSON 对象，不要返回空内容。
如果当前任务是抽取论点且没有内容，返回 {"claims":[]}。
如果当前任务是解析参考文献且没有内容，返回 {"metadata":{},"references":[]}。
如果当前任务是整合论点且没有内容，返回 {"claimTranslations":[],"groups":[],"similarPairs":[]}.`;
      content = await this.callChatCompletion(llmConfig, fallbackPrompt, Math.min(maxTokens, 16000), false);
      if (!content.trim()) {
        throw new Error(`${contextLabel} JSON empty`);
      }
    }

    const parsed = this.parseJsonContent(content);
    if (parsed) {
      return parsed;
    }

    logger.warn(`[PdfWiki] ${contextLabel} JSON invalid, trying repair. Preview: ${content.slice(0, 500)}`);

    const repairPrompt = `下面的内容本应是一个 JSON 对象，但格式不合法或混入了说明文字。请把它修复为可被 JSON.parse 直接解析的合法 JSON 对象。

要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. 保留 claims 或 groups 字段。
3. 不要新增原文中没有的信息。
4. 如果某个字段无法修复，删除该字段或设为空数组。

原始内容：
${content.slice(0, 12000)}`;

    const repairedContent = await this.callChatCompletion(llmConfig, repairPrompt, Math.min(maxTokens, 16000), true);
    const repairedParsed = this.parseJsonContent(repairedContent);
    if (repairedParsed) {
      return repairedParsed;
    }

    logger.warn(`[PdfWiki] ${contextLabel} JSON repair failed. Preview: ${repairedContent.slice(0, 500)}`);
    throw new Error(`${contextLabel} JSON invalid after repair`);
  }

  private async callJsonNormalizer(
    llmConfig: PdfWikiLlmConfig,
    prompt: string,
    maxTokens: number,
    contextLabel = 'unknown'
  ): Promise<Record<string, unknown>> {
    const jsonConfig = this.getJsonNormalizerConfig(llmConfig);
    logger.debug(`[PdfWiki] ${contextLabel} JSON normalizer model=${jsonConfig.model}; temperature=0`);
    return this.callChatJson(jsonConfig, prompt, maxTokens, contextLabel);
  }

  private getJsonNormalizerConfig(llmConfig: PdfWikiLlmConfig): PdfWikiLlmConfig {
    if (llmConfig.jsonApiUrl && llmConfig.jsonApiKey) {
      return {
        apiUrl: llmConfig.jsonApiUrl,
        apiKey: llmConfig.jsonApiKey,
        model: llmConfig.jsonModel || llmConfig.model,
      };
    }
    return llmConfig;
  }

  private getSecondaryApiFallbackConfig(llmConfig: PdfWikiLlmConfig): PdfWikiLlmConfig | null {
    const apiUrl = String(llmConfig.jsonApiUrl || '').trim();
    const apiKey = String(llmConfig.jsonApiKey || '').trim();
    const model = String(llmConfig.jsonModel || llmConfig.model || '').trim();
    if (!apiUrl || !apiKey || !model) return null;

    const sameConfig =
      this.normalizeApiBaseForCompare(apiUrl) === this.normalizeApiBaseForCompare(llmConfig.apiUrl)
      && apiKey === String(llmConfig.apiKey || '').trim()
      && model === String(llmConfig.model || '').trim();
    if (sameConfig) return null;

    return {
      ...llmConfig,
      apiUrl,
      apiKey,
      model,
      jsonApiUrl: undefined,
      jsonApiKey: undefined,
      jsonModel: undefined,
    };
  }

  private getSecondaryOverviewDiagramConfig(llmConfig: PdfWikiLlmConfig): PdfWikiLlmConfig | null {
    const fallbackConfig = this.getSecondaryApiFallbackConfig(llmConfig);
    if (fallbackConfig) return fallbackConfig;

    if (!llmConfig.dedicated && llmConfig.apiUrl && llmConfig.apiKey && llmConfig.model) {
      return llmConfig;
    }

    return null;
  }

  private normalizeApiBaseForCompare(value: string | undefined): string {
    return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
  }

  private isRecoverablePrimaryLlmError(error: unknown): boolean {
    const message = this.getErrorMessage(error);
    return /Arrearage|overdue-payment|Access denied|unauthorized|forbidden|permission|quota|billing|payment|insufficient|invalid api key|account|LLM API error \((?:400|401|403|429)\)|欠费|余额|额度|权限|无权|拒绝访问/i.test(message);
  }

  private getErrorMessage(error: unknown): string {
    const raw = error instanceof Error ? error.message : String(error || '');
    return raw.replace(/\s+/g, ' ').trim().slice(0, 1200) || '未知错误';
  }

  private async callQwenLongFileText(
    llmConfig: PdfWikiLlmConfig,
    fileId: string,
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    return this.callChatCompletionWithMessages(llmConfig, [
      { role: 'system', content: `fileid://${fileId}` },
      { role: 'user', content: prompt },
    ], maxTokens, false);
  }

  private async callQwenLongFileJson(
    llmConfig: PdfWikiLlmConfig,
    fileId: string,
    prompt: string,
    maxTokens: number
  ): Promise<Record<string, unknown>> {
    const messages = [
      { role: 'system', content: `fileid://${fileId}` },
      { role: 'user', content: `你是严格的学术论文 PDF 结构化信息抽取助手，只输出可被 JSON.parse 解析的合法 JSON 对象。\n\n${prompt}` },
    ];
    const content = await this.callChatCompletionWithMessages(llmConfig, messages, maxTokens, true);
    const parsed = this.parseJsonContent(content);
    if (parsed) {
      return parsed;
    }

    logger.warn(`[PdfWiki] Qwen-VL-Max file response invalid JSON, trying repair. Preview: ${content.slice(0, 500)}`);

    const repairPrompt = `下面的内容本应是一个 JSON 对象，但格式不合法或混入了说明文字。请把它修复为可被 JSON.parse 直接解析的合法 JSON 对象。

要求：
1. 只输出 JSON 对象，不要 Markdown，不要解释。
2. 保留 metadata、references 或 claims 字段。
3. 不要新增原文中没有的信息。
4. 如果某个字段无法修复，删除该字段或设为空数组。

原始内容：
${content.slice(0, 12000)}`;

    return this.callJsonNormalizer(llmConfig, repairPrompt, Math.min(maxTokens, 3000), 'qwen-direct-file-repair');
  }

  private async callChatCompletion(
    llmConfig: PdfWikiLlmConfig,
    prompt: string,
    maxTokens: number,
    preferJsonMode: boolean
  ): Promise<string> {
    return this.callChatCompletionWithMessages(llmConfig, [
      { role: 'system', content: '你是严格的学术论文 PDF 结构化信息抽取助手，只输出可被 JSON.parse 解析的合法 JSON 对象。' },
      { role: 'user', content: prompt },
    ], maxTokens, preferJsonMode);
  }

  private async callChatCompletionWithMessages(
    llmConfig: PdfWikiLlmConfig,
    messages: Array<{ role: string; content: unknown }>,
    maxTokens: number,
    preferJsonMode: boolean
  ): Promise<string> {
    let lastError = '';
    for (const tokenLimit of this.getMaxTokenAttempts(llmConfig, maxTokens)) {
      const body: Record<string, unknown> = {
        model: llmConfig.model,
        messages,
        temperature: 0,
        max_tokens: tokenLimit,
      };

      if (preferJsonMode) {
        body.response_format = { type: 'json_object' };
      }

      const response = await fetch(`${this.getApiBaseUrl(llmConfig)}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${llmConfig.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = `LLM API error (${response.status}): ${errorText}`;
        if (preferJsonMode && (response.status === 400 || response.status === 422) && /response_format|json/i.test(errorText)) {
          logger.warn('[PdfWiki] JSON mode unsupported by API, retrying without response_format');
          return this.callChatCompletionWithMessages(llmConfig, messages, tokenLimit, false);
        }
        if ((response.status === 400 || response.status === 422) && this.isMaxTokensError(errorText)) {
          logger.warn(`[PdfWiki] max_tokens=${tokenLimit} rejected by API, retrying with a lower output limit`);
          continue;
        }
        throw new Error(lastError);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
      const finishReason = data.choices?.[0]?.finish_reason;
      if (finishReason === 'length') {
        logger.warn(`[PdfWiki] LLM response reached max_tokens=${tokenLimit}; output may be truncated`);
      }
      return data.choices?.[0]?.message?.content || '';
    }

    throw new Error(lastError || 'LLM API error: max_tokens rejected by API');
  }

  private getReferenceEnrichmentBatchSize(): number {
    const parsed = Number(process.env.PDF_WIKI_REFERENCE_BATCH_SIZE || 12);
    if (!Number.isFinite(parsed)) return 12;
    return Math.max(5, Math.min(30, Math.floor(parsed)));
  }

  private getReferenceEnrichmentMaxRefs(): number {
    const parsed = Number(process.env.PDF_WIKI_REFERENCE_MAX_REFS || 300);
    if (!Number.isFinite(parsed)) return 300;
    return Math.max(20, Math.min(600, Math.floor(parsed)));
  }

  private getReferenceJsonMaxOutputTokens(llmConfig: PdfWikiLlmConfig): number {
    const configured = Number(
      process.env.PDF_WIKI_REFERENCE_MAX_OUTPUT_TOKENS
      || process.env.PDF_WIKI_MAX_OUTPUT_TOKENS
      || ''
    );
    if (Number.isFinite(configured) && configured > 0) {
      return Math.floor(configured);
    }

    return this.isQwenLikeConfig(llmConfig) ? 8192 : (this.isDeepSeekLikeConfig(llmConfig) ? 384000 : 32000);
  }

  private getMetaAnalysisJsonMaxOutputTokens(llmConfig: PdfWikiLlmConfig): number {
    const configured = Number(
      process.env.PDF_WIKI_META_JSON_MAX_OUTPUT_TOKENS
      || process.env.PDF_WIKI_MAX_OUTPUT_TOKENS
      || ''
    );
    if (Number.isFinite(configured) && configured > 0) {
      return Math.floor(configured);
    }
    return this.isQwenLikeConfig(llmConfig) ? 8192 : (this.isDeepSeekLikeConfig(llmConfig) ? 384000 : 16000);
  }

  private getMaxTokenAttempts(llmConfig: PdfWikiLlmConfig, maxTokens: number): number[] {
    const requested = Math.max(1, Math.floor(maxTokens || 1));
    const providerCap = this.getProviderOutputTokenCap(llmConfig);
    const cappedRequested = providerCap > 0 ? Math.min(requested, providerCap) : requested;
    const fallbacks = this.isDeepSeekLikeConfig(llmConfig)
      ? [384000, 128000, 64000, 32768, 16384, 8192, 4096, 2048]
      : [16384, 8192, 4096, 2048];
    return Array.from(new Set([cappedRequested, ...fallbacks.filter(value => value < cappedRequested)]));
  }

  private getProviderOutputTokenCap(llmConfig: PdfWikiLlmConfig): number {
    const configured = Number(process.env.PDF_WIKI_PROVIDER_MAX_OUTPUT_TOKENS || '');
    if (Number.isFinite(configured) && configured > 0) return Math.floor(configured);
    if (this.isQwenLikeConfig(llmConfig)) {
      const qwenConfigured = Number(process.env.PDF_WIKI_QWEN_MAX_OUTPUT_TOKENS || '');
      return Number.isFinite(qwenConfigured) && qwenConfigured > 0 ? Math.floor(qwenConfigured) : 8192;
    }
    return 0;
  }

  private isQwenLikeConfig(llmConfig: PdfWikiLlmConfig): boolean {
    return /(qwen|dashscope|aliyun|alibailian|bailian|aliyuncs)/i.test(`${llmConfig.model || ''} ${llmConfig.apiUrl || ''}`);
  }

  private isDeepSeekLikeConfig(llmConfig: PdfWikiLlmConfig): boolean {
    return /deepseek/i.test(`${llmConfig.model || ''} ${llmConfig.apiUrl || ''}`);
  }

  private isMaxTokensError(errorText: string): boolean {
    return /max[_\s-]?tokens|max output|output token|too many tokens|context length|maximum context|tokens limit|token limit/i.test(errorText);
  }

  private getApiBaseUrl(llmConfig: PdfWikiLlmConfig): string {
    return llmConfig.apiUrl.replace(/\/+$/, '');
  }

  private parseJsonContent(content: string): Record<string, unknown> | null {
    const jsonText = this.extractJson(content);
    if (!jsonText) {
      return null;
    }

    try {
      return JSON.parse(jsonText) as Record<string, unknown>;
    } catch {
      const repaired = this.repairCommonJsonIssues(jsonText);
      if (repaired !== jsonText) {
        try {
          return JSON.parse(repaired) as Record<string, unknown>;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private extractJson(content: string): string {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      return this.extractBalancedJson(fenced[1].trim()) || fenced[1].trim();
    }
    return this.extractBalancedJson(content);
  }

  private extractBalancedJson(content: string): string {
    const start = content.indexOf('{');
    if (start < 0) return '';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < content.length; i++) {
      const char = content[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
        if (depth === 0) {
          return content.slice(start, i + 1).trim();
        }
      }
    }

    return content.slice(start).trim();
  }

  private repairCommonJsonIssues(jsonText: string): string {
    return jsonText
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/[\u0000-\u001F]+/g, ' ');
  }

  private mergeEntrySelection(entries: PdfWikiEntry[], normalizedClaimInput?: string): PdfWikiEntry {
    const now = new Date().toISOString();
    const fallbackClaim = entries[0]?.normalizedClaim || entries[0]?.claim || '合并论点';
    const normalizedClaim = String(normalizedClaimInput || fallbackClaim).trim() || fallbackClaim;
    const sourceIds = this.unique(entries.flatMap(entry => entry.sourcePdfIds));
    const hash = crypto.createHash('md5')
      .update(`${entries.map(entry => entry.id).sort().join('|')}|${normalizedClaim}|${now}`)
      .digest('hex')
      .slice(0, 16);

    return {
      id: `pdfwiki_manual_${hash}`,
      groupId: `manual_group_${hash}`,
      claim: normalizedClaim,
      normalizedClaim,
      displayClaimZh: this.isMostlyChinese(normalizedClaim)
        ? normalizedClaim
        : entries.find(entry => entry.displayClaimZh)?.displayClaimZh,
      sourceEntryIds: this.unique(entries.flatMap(entry => entry.sourceEntryIds || [entry.id])),
      sourcePdfIds: sourceIds,
      sourcePdfNames: this.unique(entries.flatMap(entry => entry.sourcePdfNames)),
      sections: this.unique(entries.flatMap(entry => entry.sections)),
      pro: entries.flatMap(entry => entry.pro),
      con: entries.flatMap(entry => entry.con),
      neutral: entries.flatMap(entry => entry.neutral),
      inTextCitations: this.unique(entries.flatMap(entry => entry.inTextCitations)),
      references: this.uniqueReferences(entries.flatMap(entry => entry.references)),
      evidenceSnippets: this.unique(entries.flatMap(entry => entry.evidenceSnippets)).slice(0, 20),
      updatedAt: now,
    };
  }

  private async persistManualStoreUpdate(userId: string, store: PdfWikiStore, message: string): Promise<void> {
    const now = new Date().toISOString();
    store.generatedAt = now;
    await this.saveStore(userId, store);
    this.clearEngine(userId);
    this.removeIndexCache(userId);
    await this.saveStatus(userId, {
      status: 'completed',
      totalPdfs: store.pdfs.length,
      processedPdfs: store.pdfs.length,
      totalChunks: 0,
      processedChunks: 0,
      entryCount: store.entries.length,
      sentencePointCount: store.sentenceCloud?.points?.length || 0,
      message: store.entries.length > 0 || (store.sentenceCloud?.points?.length || 0) > 0
        ? message
        : 'PDF Wiki 论点库已清空，可重新上传或重建',
      updatedAt: now,
    });
  }

  private async loadSentenceTopicAnnotationStore(userId: string): Promise<PdfWikiSentenceTopicAnnotationStore> {
    const filePath = this.getSentenceTopicAnnotationStorePath(userId);
    if (!fs.existsSync(filePath)) {
      return { version: 1, updatedAt: new Date(0).toISOString(), records: {} };
    }
    try {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as Partial<PdfWikiSentenceTopicAnnotationStore>;
      const rawRecords = parsed.records && typeof parsed.records === 'object' ? parsed.records : {};
      const records: Record<string, PdfWikiSentenceTopicAnnotation> = {};
      for (const [sentenceId, raw] of Object.entries(rawRecords)) {
        if (!raw || typeof raw !== 'object') continue;
        const record = raw as Partial<PdfWikiSentenceTopicAnnotation>;
        const subjectTags = this.normalizeTopicTerms(record.subjectTags, 5)
          .map(tag => this.cleanTopicText(tag, 80))
          .filter(Boolean);
        const trendConclusionTopic = this.cleanTopicText(record.trendConclusionTopic, 120);
        const sourceHash = String(record.sourceHash || '').trim();
        const taxonomyHash = String(record.taxonomyHash || '').trim();
        if (!sentenceId || !sourceHash || !taxonomyHash || subjectTags.length === 0 || !trendConclusionTopic) continue;
        records[sentenceId] = {
          version: PDF_WIKI_SENTENCE_TOPIC_ANNOTATION_VERSION,
          sourceHash,
          taxonomyHash,
          subjectTags,
          trendConclusionTopic,
          annotatedAt: String(record.annotatedAt || new Date(0).toISOString()),
          provider: record.provider === 'codex' ? 'codex' : 'api',
          model: record.model ? String(record.model) : undefined,
        };
      }
      return {
        version: 1,
        updatedAt: String(parsed.updatedAt || new Date(0).toISOString()),
        records,
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read sentence topic annotations for ${userId}:`, error);
      return { version: 1, updatedAt: new Date(0).toISOString(), records: {} };
    }
  }

  private async saveSentenceTopicAnnotationStore(
    userId: string,
    store: PdfWikiSentenceTopicAnnotationStore
  ): Promise<void> {
    await this.writeJsonAtomic(this.getSentenceTopicAnnotationStorePath(userId), {
      ...store,
      version: 1,
      updatedAt: new Date().toISOString(),
    });
  }

  private async loadSentenceTopicAnnotationStatus(
    userId: string
  ): Promise<PdfWikiSentenceTopicAnnotationStatus | null> {
    const filePath = this.getSentenceTopicAnnotationStatusPath(userId);
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf-8')) as Partial<PdfWikiSentenceTopicAnnotationStatus>;
      const status = parsed.status === 'processing' || parsed.status === 'completed' || parsed.status === 'error'
        ? parsed.status
        : 'idle';
      return {
        status,
        totalSentences: Math.max(0, Number(parsed.totalSentences || 0)),
        annotatedSentences: Math.max(0, Number(parsed.annotatedSentences || 0)),
        pendingSentences: Math.max(0, Number(parsed.pendingSentences || 0)),
        targetSentences: Math.max(0, Number(parsed.targetSentences || 0)),
        processedSentences: Math.max(0, Number(parsed.processedSentences || 0)),
        failedSentences: Math.max(0, Number(parsed.failedSentences || 0)),
        skippedSentences: Math.max(0, Number(parsed.skippedSentences || 0)),
        progress: Math.max(0, Math.min(100, Number(parsed.progress || 0))),
        message: String(parsed.message || ''),
        startedAt: parsed.startedAt ? String(parsed.startedAt) : undefined,
        completedAt: parsed.completedAt ? String(parsed.completedAt) : undefined,
        updatedAt: String(parsed.updatedAt || new Date(0).toISOString()),
        error: parsed.error ? String(parsed.error) : undefined,
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read sentence topic annotation status for ${userId}:`, error);
      return null;
    }
  }

  private async saveSentenceTopicAnnotationStatus(
    userId: string,
    status: PdfWikiSentenceTopicAnnotationStatus
  ): Promise<void> {
    await this.writeJsonAtomic(this.getSentenceTopicAnnotationStatusPath(userId), status);
  }

  private async loadStore(userId: string): Promise<PdfWikiStore> {
    const storePath = this.getStorePath(userId);
    if (!fs.existsSync(storePath)) {
      return this.createEmptyStore(userId);
    }

    try {
      const parsed = JSON.parse(await fs.promises.readFile(storePath, 'utf-8')) as PdfWikiStore;
      return {
        ...parsed,
        referenceIndex: parsed.referenceIndex || (parsed.pdfs || []).flatMap(pdf => pdf.referenceIndex || []),
        pdfs: parsed.pdfs || [],
        entries: parsed.entries || [],
        sentenceCloud: this.normalizeSentenceCloudStore(parsed.sentenceCloud),
        readerChatSessions: this.normalizeReaderChatSessions(parsed.readerChatSessions),
      };
    } catch (error) {
      logger.warn(`[PdfWiki] Failed to read store for ${userId}:`, error);
      return this.createEmptyStore(userId);
    }
  }

  private async saveStore(userId: string, store: PdfWikiStore): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    await fs.promises.mkdir(this.getWikiDir(safeUserId), { recursive: true });
    await this.writeJsonAtomic(this.getStorePath(safeUserId), store);
    this.pdfManagerStoreSnapshotCache.delete(safeUserId);
    this.viewerStoreSnapshotCache.delete(safeUserId);
  }

  private async saveStatus(userId: string, status: PdfWikiBuildStatus): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    if (status.workProgress) {
      this.statusWorkProgress.set(safeUserId, status.workProgress);
    }
    const cachedWorkProgress = status.taskKind === 'meta-analysis'
      ? undefined
      : this.statusWorkProgress.get(safeUserId);
    const statusToSave = !status.workProgress && cachedWorkProgress
      ? { ...status, workProgress: cachedWorkProgress }
      : status;
    await fs.promises.mkdir(this.getWikiDir(safeUserId), { recursive: true });
    await this.writeJsonAtomic(this.getStatusPath(safeUserId), statusToSave);
    if (status.status === 'completed' || status.status === 'error') {
      this.statusWorkProgress.delete(safeUserId);
    }
  }

  private normalizeReaderChatSessions(value: unknown): Record<string, PdfWikiReaderChatSession> {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const sessions: Record<string, PdfWikiReaderChatSession> = {};
    for (const [pdfId, sessionValue] of Object.entries(record)) {
      const session = this.normalizeReaderChatSession(sessionValue, pdfId);
      if (session.messages.length > 0) {
        sessions[session.pdfId] = session;
      }
    }
    return sessions;
  }

  private normalizeReaderChatSession(value: unknown, fallbackPdfId: string): PdfWikiReaderChatSession {
    const record = value && typeof value === 'object' ? value as Partial<PdfWikiReaderChatSession> : {};
    const pdfId = String(record.pdfId || fallbackPdfId || '').trim();
    const messages = (Array.isArray(record.messages) ? record.messages : [])
      .map(message => this.normalizeReaderChatMessage(message))
      .filter((message): message is PdfWikiReaderChatMessage => !!message)
      .slice(-200);
    const updatedAt = typeof record.updatedAt === 'string' && record.updatedAt
      ? record.updatedAt
      : (messages[messages.length - 1]?.createdAt || new Date(0).toISOString());
    return {
      pdfId,
      updatedAt,
      messages,
    };
  }

  private normalizeReaderChatMessage(value: unknown): PdfWikiReaderChatMessage | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<PdfWikiReaderChatMessage>;
    const role = record.role === 'assistant' ? 'assistant' : (record.role === 'user' ? 'user' : null);
    const content = this.cleanReaderChatText(record.content, 12000);
    if (!role || !content) return null;
    const createdAt = typeof record.createdAt === 'string' && record.createdAt
      ? record.createdAt
      : new Date(0).toISOString();
    return { role, content, createdAt };
  }

  private cleanReaderChatText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    return value
      .replace(/\u0000/g, '')
      .replace(/\r/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim()
      .slice(0, Math.max(0, maxLength));
  }

  private normalizeSentenceCloudStore(value: unknown): PdfWikiSentenceCloudStore {
    const record = value && typeof value === 'object' ? value as Partial<PdfWikiSentenceCloudStore> : {};
    const points = (Array.isArray(record.points) ? record.points : [])
      .map(point => this.normalizeSentenceCloudPoint(point))
      .filter((point): point is PdfWikiSentencePoint => !!point);
    if (points.length > 0) {
      const rebuilt = this.buildSentenceCloudStore(points);
      return {
        ...rebuilt,
        generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : rebuilt.generatedAt,
      };
    }
    return {
      generatedAt: typeof record.generatedAt === 'string' ? record.generatedAt : new Date(0).toISOString(),
      points: [],
      clouds: [],
    };
  }

  private normalizeSentenceCloudPoint(value: unknown): PdfWikiSentencePoint | null {
    if (!value || typeof value !== 'object') return null;
    const record = value as Partial<PdfWikiSentencePoint>;
    const id = String(record.id || '').trim();
    const sentence = String(record.sentence || '').trim();
    if (!id || !sentence) return null;
    const citations = this.unique(Array.isArray(record.citations) ? record.citations.map(String) : []);
    const references = this.deduplicateSentencePointReferences(
      (Array.isArray(record.references) ? record.references : [])
        .filter(ref => ref && typeof ref === 'object' && citations.length > 0 && (ref as PdfWikiSentencePointReference).matchType === 'citation')
        .map(ref => ({ ...(ref as PdfWikiSentencePointReference), matchType: 'citation' as const })),
      8
    );
    const fallbackTopic = this.inferSentencePointTopic(sentence);
    const section: PdfWikiSentenceSection = record.section === 'Discussion'
      ? 'Discussion'
      : record.section === 'Conclusion'
      ? 'Conclusion'
      : 'Introduction';
    const referenceCount = references.length;
    const fallbackClaim = this.inferSentenceClaimCandidate(sentence, section, referenceCount, citations);
    const storedClaimCandidate = this.toBoolean(record.claimCandidate ?? (record as Record<string, unknown>).claim_candidate ?? (record as Record<string, unknown>).isClaim ?? (record as Record<string, unknown>).is_claim);
    return {
      id,
      sourcePdfId: String(record.sourcePdfId || ''),
      sourcePdfName: String(record.sourcePdfName || ''),
      sourcePdfTitle: record.sourcePdfTitle ? String(record.sourcePdfTitle) : undefined,
      section,
      sentenceIndex: Number(record.sentenceIndex || 0) || 0,
      sentence,
      citations,
      references,
      referenceCount,
      claimCandidate: storedClaimCandidate === null ? fallbackClaim.claimCandidate : storedClaimCandidate,
      claimText: this.firstString(record.claimText, (record as Record<string, unknown>).claim_text, (record as Record<string, unknown>).claim, fallbackClaim.claimText),
      claimType: this.normalizeSentenceClaimType(record.claimType || (record as Record<string, unknown>).claim_type || fallbackClaim.claimType),
      claimReason: this.firstString(record.claimReason, (record as Record<string, unknown>).claim_reason, fallbackClaim.claimReason) || undefined,
      topicKey: this.normalizeSentenceTopicKey(record.topicKey || fallbackTopic.key),
      topicLabel: String(record.topicLabel || fallbackTopic.label),
      keywords: this.unique(Array.isArray(record.keywords) ? record.keywords.map(String) : fallbackTopic.keywords).slice(0, 8),
      x: Number(record.x || 50) || 50,
      y: Number(record.y || 50) || 50,
      radius: Math.min(38, 8 + Math.max(0, referenceCount) * 5),
      matchMethod: this.getSentencePointMatchMethod(references),
      confidence: this.calculateSentencePointConfidence(references, citations),
    };
  }

  private async writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await this.withFileWriteLock(filePath, async () => {
      const dir = path.dirname(filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`);
      await fs.promises.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf-8');
      await this.replaceFileWithRetry(tempPath, filePath);
    });
  }

  private async withFileWriteLock<T>(filePath: string, task: () => Promise<T>): Promise<T> {
    const key = process.platform === 'win32'
      ? path.resolve(filePath).toLowerCase()
      : path.resolve(filePath);
    const previous = this.fileWriteLocks.get(key) || Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    const tail = run.then(() => undefined, () => undefined);
    this.fileWriteLocks.set(key, tail);
    try {
      return await run;
    } finally {
      if (this.fileWriteLocks.get(key) === tail) {
        this.fileWriteLocks.delete(key);
      }
    }
  }

  private async replaceFileWithRetry(tempPath: string, filePath: string): Promise<void> {
    const maxAttempts = 14;
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await fs.promises.rename(tempPath, filePath);
        return;
      } catch (error) {
        lastError = error;
        if (!this.isRetryableFileReplaceError(error) || attempt === maxAttempts) {
          break;
        }
        await this.delay(Math.min(500, 25 * attempt * attempt));
      }
    }

    try {
      await fs.promises.copyFile(tempPath, filePath);
      await fs.promises.unlink(tempPath).catch(() => undefined);
      logger.warn(`[PdfWiki] Atomic rename failed for ${filePath}; used copy fallback:`, lastError);
      return;
    } catch (copyError) {
      await fs.promises.unlink(tempPath).catch(() => undefined);
      throw copyError || lastError;
    }
  }

  private isRetryableFileReplaceError(error: unknown): boolean {
    const code = (error as NodeJS.ErrnoException)?.code;
    return code === 'EPERM' || code === 'EACCES' || code === 'EBUSY' || code === 'ENOTEMPTY';
  }

  private async delay(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  private createEmptyStore(userId: string): PdfWikiStore {
    return {
      version: 1,
      userId,
      generatedAt: new Date(0).toISOString(),
      pdfs: [],
      referenceIndex: [],
      entries: [],
      sentenceCloud: {
        generatedAt: new Date(0).toISOString(),
        points: [],
        clouds: [],
      },
      readerChatSessions: {},
    };
  }

  private getWikiDir(userId: string): string {
    return path.join(this.dataDir, 'uploads', sanitizeUserId(userId), 'pdf-wiki');
  }

  private getSourcePdfDir(userId: string): string {
    return path.join(this.getWikiDir(userId), 'source-pdfs');
  }

  private getParsedTextDir(userId: string): string {
    return path.join(this.getWikiDir(userId), 'parsed-texts');
  }

  private getDeepAnalysisDir(userId: string): string {
    return path.join(this.getWikiDir(userId), 'deep-analysis');
  }

  private getDeepAnalysisPath(userId: string, pdfId: string): string {
    const safeId = String(pdfId || 'pdf').replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.getDeepAnalysisDir(userId), `${safeId}.json`);
  }

  private getIndexCacheDir(userId: string): string {
    return path.join(this.getWikiDir(userId), 'index-cache', PDF_WIKI_RETRIEVAL_POLICY_VERSION);
  }

  private getStorePath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'wiki.json');
  }

  private getStatusPath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'status.json');
  }

  private getQueuePath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'queue.json');
  }

  private getRecognitionQueuePath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'recognition-queue.json');
  }

  private getTopicCatalogPath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'topic-catalog.json');
  }

  private getSentenceTopicAnnotationStorePath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'sentence-topic-annotations.json');
  }

  private getSentenceTopicAnnotationStatusPath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'sentence-topic-annotation-status.json');
  }

  private getMetaAnalysisTemplatePath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'meta-analysis-template.json');
  }

  private getMetaAnalysisUnitRegistryPath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'meta-analysis-unit-registry.json');
  }

  private getMetaDatabaseIndexPath(userId: string): string {
    return path.join(this.getWikiDir(userId), 'meta-database-index.json');
  }

  private removeIndexCache(userId: string): void {
    const cacheDir = path.join(this.getWikiDir(userId), 'index-cache');
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
  }

  private deletePdfLocalFiles(userId: string, pdf: PdfWikiSourcePdf): void {
    const candidates = [
      pdf.filePath,
      pdf.parsedMarkdownPath,
      pdf.parsedTextPath,
      this.getDeepAnalysisPath(userId, pdf.id),
    ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0);

    for (const filePath of candidates) {
      try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          fs.unlinkSync(filePath);
        }
      } catch (error) {
        logger.warn(`[PdfWiki] Failed to delete local file for removed PDF ${pdf.originalName}: ${filePath}`, error);
      }
    }
  }

  private sanitizeFileName(fileName: string): string {
    const ext = path.extname(fileName) || '.pdf';
    const base = path.basename(fileName, ext).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'uploaded';
    return `${base}${ext.toLowerCase()}`;
  }

  private restoreOriginalName(fileName: string): string {
    return this.repairMojibakeText(fileName.replace(/^[a-f0-9]{16}-/, ''));
  }

  private repairMojibakeText(value: string): string {
    const text = String(value || '');
    if (!text || !/[ÃÂåæçèéäöü]/.test(text)) return text;
    try {
      const repaired = Buffer.from(text, 'latin1').toString('utf8');
      const score = (input: string): number => {
        const replacementCount = (input.match(/\uFFFD/g) || []).length;
        const cjkCount = (input.match(/[\u4e00-\u9fff]/g) || []).length;
        const mojibakeCount = (input.match(/[ÃÂåæçèé]/g) || []).length;
        return cjkCount * 3 - replacementCount * 6 - mojibakeCount;
      };
      return score(repaired) > score(text) ? repaired : text;
    } catch {
      return text;
    }
  }

  private deduplicatePdfs(pdfs: PdfWikiSourcePdf[]): PdfWikiSourcePdf[] {
    const seen = new Set<string>();
    const result: PdfWikiSourcePdf[] = [];
    for (const pdf of pdfs) {
      if (!seen.has(pdf.id)) {
        seen.add(pdf.id);
        result.push(pdf);
      }
    }
    return result;
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
  }

  private uniqueReferences(references: PdfWikiReference[]): PdfWikiReference[] {
    const seen = new Set<string>();
    const result: PdfWikiReference[] = [];
    for (const ref of references) {
      const key = (ref.doi || ref.raw || ref.title || ref.id || '').toLowerCase();
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(ref);
      }
    }
    return result;
  }

  private formatReference(ref: PdfWikiReference): string {
    const parts = [
      ref.authors,
      ref.year ? `(${ref.year})` : undefined,
      ref.title,
      ref.journal,
      ref.doi ? `DOI: ${ref.doi}` : undefined,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join('. ') : (ref.raw || '未在 PDF 中解析到完整参考文献信息');
  }

  private normalizeDoi(doi: string): string {
    return String(doi || '')
      .trim()
      .replace(/^doi:\s*/i, '')
      .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
      .replace(/[),.;\]]+$/g, '')
      .trim();
  }
}

export default PdfWikiManager;
