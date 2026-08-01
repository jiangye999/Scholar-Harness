import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import type { Author, DocumentType, UnifiedLiterature } from '../types/literature';
import {
  authorsToString,
  generateLiteratureId,
  parseAuthorsToString,
} from './literature-helpers';
import { decrypt, encrypt } from './encryption';
import { logger } from './logger';
import { sanitizeUserId } from './paths';
import { getRetrievalEngineManager } from './retrieval-engine-manager';
import { callChatCompletion, type LLMClientConfig } from './llm-client';

export type LiteratureCollectionSource = 'wos-starter' | 'wos-expanded' | 'cnki-assisted';
export type LiteratureCollectionJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'awaiting-user'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface LiteratureSearchPlan {
  id: string;
  topic: string;
  generatedAt: string;
  provider: 'ai' | 'local';
  concepts: Array<{
    label: string;
    englishTerms: string[];
    chineseTerms: string[];
  }>;
  includeTerms: string[];
  excludeTerms: string[];
  wosQuery: string;
  cnkiQuery: string;
  yearFrom?: number;
  yearTo?: number;
  documentTypes: string[];
  notes: string[];
}

export interface LiteratureCollectionImportResult {
  totalRecords: number;
  addedRecords: number;
  duplicateRecords: number;
  missingAbstractRecords: number;
  bibliometricsEligibleRecords: number;
  literaturePath: string;
  indexRefreshPending: boolean;
  bibliometricsImported?: boolean;
  bibliometricsError?: string;
}

export interface LiteratureCollectionJob {
  id: string;
  userId: string;
  source: LiteratureCollectionSource;
  topic: string;
  query: string;
  planId?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  status: LiteratureCollectionJobStatus;
  statusMessage: string;
  error?: string;
  yearFrom?: number;
  yearTo?: number;
  documentTypes: string[];
  maxRecords: number;
  pageSize: number;
  nextPage: number;
  pagesCompleted: number;
  totalFound: number;
  recordsFetched: number;
  recordsEligible: number;
  missingAbstractRecords: number;
  recordsImported: number;
  duplicateRecords: number;
  outputRoot?: string;
  durableRoot: string;
  importToLiterature: boolean;
  importToBibliometrics: boolean;
  importResult?: LiteratureCollectionImportResult;
}

export interface LiteratureCollectionPublicConfig {
  hasWosApiKey: boolean;
  wosMode: 'starter' | 'expanded';
  wosStarterBaseUrl: string;
  wosExpandedBaseUrl: string;
  updatedAt?: string;
}

interface StoredLiteratureCollectionConfig {
  encryptedWosApiKey?: string;
  wosMode: 'starter' | 'expanded';
  wosStarterBaseUrl: string;
  wosExpandedBaseUrl: string;
  updatedAt?: string;
}

interface LiteratureCollectionManagerOptions {
  dataDir: string;
  getPlannerRuntime?: () => (LLMClientConfig & { configured?: boolean }) | null;
  importWosPlainText?: (args: {
    userId: string;
    fileName: string;
    content: string;
  }) => Promise<void> | void;
}

interface CreateJobInput {
  userId: string;
  source: LiteratureCollectionSource;
  topic: string;
  query: string;
  planId?: string;
  yearFrom?: number;
  yearTo?: number;
  documentTypes?: string[];
  maxRecords?: number;
  outputRoot?: string;
  importToLiterature?: boolean;
  importToBibliometrics?: boolean;
}

interface StarterPage {
  total: number;
  records: unknown[];
}

const DEFAULT_STARTER_BASE_URL = 'https://api.clarivate.com/apis/wos-starter/v1';
const DEFAULT_EXPANDED_BASE_URL = 'https://api.clarivate.com/api/wos';
const MAX_COLLECTION_RECORDS = 100_000;
const MAX_RETRY_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 1_200;

function nowIso(): string {
  return new Date().toISOString();
}

function compactTimestamp(): string {
  return nowIso().replace(/[-:.TZ]/g, '').slice(0, 14);
}

function safeFileSegment(value: string, fallback = 'collection'): string {
  return String(value || '')
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80) || fallback;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeYear(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= 1800 && parsed <= 2200 ? parsed : undefined;
}

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join('; ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return normalizeText(
      record.content
      ?? record.value
      ?? record.text
      ?? record.displayName
      ?? record.full_name
      ?? record.name
      ?? ''
    );
  }
  return '';
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(item => normalizeStringArray(item)).filter(Boolean);
  }
  const text = normalizeText(value);
  if (!text) return [];
  return text
    .split(/\s*[;|]\s*|\s+\/\s+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readPath(value: unknown, pathSegments: string[]): unknown {
  let current: unknown = value;
  for (const segment of pathSegments) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function firstPresent(value: unknown, paths: string[][]): unknown {
  for (const segments of paths) {
    const candidate = readPath(value, segments);
    if (candidate !== undefined && candidate !== null && normalizeText(candidate)) return candidate;
  }
  return undefined;
}

function atomicWriteJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
  fs.renameSync(temporaryPath, filePath);
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (error) {
    logger.warn(`[LiteratureCollection] Failed to read ${filePath}:`, error);
    return fallback;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf-8').digest('hex');
}

function normalizeDoi(value: unknown): string {
  return normalizeText(value)
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
    .replace(/^doi\s*:?\s*/i, '')
    .replace(/[.,;)\]}]+$/g, '')
    .trim();
}

function parseDocumentType(value: unknown): DocumentType {
  const text = normalizeText(value).toLowerCase();
  if (/review/.test(text)) return 'review';
  if (/proceeding|conference/.test(text)) return 'conference';
  if (/book chapter|chapter/.test(text)) return 'chapter';
  if (/book/.test(text)) return 'book';
  if (/thesis|dissertation/.test(text)) return 'thesis';
  if (/article|journal/.test(text)) return 'article';
  return 'other';
}

function parseAuthors(value: unknown): Author[] {
  const items = Array.isArray(value) ? value : normalizeStringArray(value);
  const names = items
    .map(item => {
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        return normalizeText(
          record.displayName
          ?? record.display_name
          ?? record.fullName
          ?? record.full_name
          ?? record.wosStandard
          ?? record.wos_standard
          ?? record.name
          ?? ''
        );
      }
      return normalizeText(item);
    })
    .filter(Boolean);
  return names.length > 0 ? parseAuthorsToString(names) : [{ name: 'Unknown' }];
}

function pickTypedValue(
  value: unknown,
  acceptedTypes: string[],
  valueKeys: string[] = ['content', 'value', 'text', 'title'],
): string {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  const normalizedTypes = new Set(acceptedTypes.map(item => item.toLowerCase()));
  for (const item of values) {
    const record = asRecord(item);
    const type = normalizeText(record.type ?? record.label ?? record.name).toLowerCase();
    if (normalizedTypes.size > 0 && !normalizedTypes.has(type)) continue;
    for (const key of valueKeys) {
      const result = normalizeText(record[key]);
      if (result) return result;
    }
  }
  return '';
}

function pickIdentifierValue(value: unknown, acceptedTypes: string[]): string {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  const normalizedTypes = new Set(acceptedTypes.map(item => item.toLowerCase()));
  for (const item of values) {
    const record = asRecord(item);
    const type = normalizeText(record.type ?? record.identifierType ?? record.label).toLowerCase();
    if (normalizedTypes.size > 0 && type && !normalizedTypes.has(type)) continue;
    const candidate = normalizeText(
      record.value
      ?? record.content
      ?? record.id
      ?? record.identifier
      ?? record.doi
      ?? record.uid
      ?? ''
    );
    if (candidate && (!type || normalizedTypes.has(type))) return candidate;
  }
  return '';
}

function normalizeReferences(value: unknown): string[] {
  const values = Array.isArray(value) ? value : (value ? [value] : []);
  return values.map(item => {
    if (!item || typeof item !== 'object') return normalizeText(item);
    const record = item as Record<string, unknown>;
    return normalizeText(
      record.full_ref
      ?? record.fullRef
      ?? record.content
      ?? record.value
      ?? record.title
      ?? record.uid
      ?? ''
    );
  }).filter(Boolean);
}

function toStableLiterature(record: unknown, sourceRecordId: string, jobId: string): UnifiedLiterature {
  const expandedTitles = readPath(record, ['static_data', 'summary', 'titles', 'title']);
  const title = pickTypedValue(expandedTitles, ['item', 'article', 'book'])
    || normalizeText(firstPresent(record, [
    ['title'],
    ['document', 'title'],
    ['static_data', 'summary', 'titles', 'title'],
  ])) || 'Unknown Title';
  const yearValue = firstPresent(record, [
    ['year'],
    ['publicationYear'],
    ['source', 'publishYear'],
    ['static_data', 'summary', 'pub_info', 'pubyear'],
  ]);
  const year = normalizeYear(yearValue) || new Date().getFullYear();
  const authorValue = firstPresent(record, [
    ['authors'],
    ['names', 'authors'],
    ['document', 'authors'],
    ['static_data', 'summary', 'names', 'name'],
  ]);
  const authors = parseAuthors(authorValue);
  const expandedIdentifiers = readPath(record, ['dynamic_data', 'cluster_related', 'identifiers', 'identifier']);
  const doi = normalizeDoi(
    pickIdentifierValue(expandedIdentifiers, ['doi'])
    || firstPresent(record, [
    ['doi'],
    ['identifiers', 'doi'],
    ['document', 'identifiers', 'doi'],
  ]));
  const journal = pickTypedValue(expandedTitles, ['source', 'book_series', 'book series'])
    || normalizeText(firstPresent(record, [
    ['journal'],
    ['sourceTitle'],
    ['source', 'sourceTitle'],
    ['static_data', 'summary', 'titles', 'title'],
  ]));
  const abstract = normalizeText(firstPresent(record, [
    ['abstract'],
    ['document', 'abstract'],
    ['static_data', 'fullrecord_metadata', 'abstracts', 'abstract', 'abstract_text', 'p'],
  ]));
  const keywords = [
    ...normalizeStringArray(firstPresent(record, [
    ['keywords', 'authorKeywords'],
    ['keywords', 'author_keywords'],
    ['document', 'keywords'],
    ['static_data', 'fullrecord_metadata', 'keywords', 'keyword'],
    ])),
    ...normalizeStringArray(firstPresent(record, [
      ['keywords', 'keywordsPlus'],
      ['keywords', 'keywords_plus'],
    ])),
  ];
  const categories = normalizeStringArray(firstPresent(record, [
    ['categories'],
    ['document', 'categories'],
    ['static_data', 'fullrecord_metadata', 'category_info', 'subjects', 'subject'],
  ]));
  const references = normalizeReferences(firstPresent(record, [
    ['references'],
    ['citedReferences'],
    ['static_data', 'fullrecord_metadata', 'references', 'reference'],
  ]));
  const documentType = parseDocumentType(firstPresent(record, [
    ['documentType'],
    ['types'],
    ['static_data', 'summary', 'doctypes', 'doctype'],
  ]));
  const volume = normalizeText(firstPresent(record, [
    ['volume'],
    ['source', 'volume'],
    ['static_data', 'summary', 'pub_info', 'vol'],
  ]));
  const issue = normalizeText(firstPresent(record, [
    ['issue'],
    ['source', 'issue'],
    ['static_data', 'summary', 'pub_info', 'issue'],
  ]));
  const pages = normalizeText(firstPresent(record, [
    ['pages'],
    ['source', 'pages', 'range'],
    ['static_data', 'summary', 'pub_info', 'page'],
  ]));
  const id = generateLiteratureId(title, year, authors, doi || undefined);
  const result: UnifiedLiterature & Record<string, unknown> = {
    id,
    title,
    authors,
    author: authorsToString(authors),
    year,
    abstract,
    keywords: Array.from(new Set(keywords)),
    journal,
    volume: volume || undefined,
    issue: issue || undefined,
    pages: pages || undefined,
    doi: doi || undefined,
    documentType,
    categories,
    references,
    source: 'wos',
    collectionJobId: jobId,
    sourceRecordId,
  };
  return result;
}

function getExpandedRecords(payload: unknown): unknown[] {
  const candidates = [
    readPath(payload, ['Data', 'Records', 'records', 'REC']),
    readPath(payload, ['Data', 'Records', 'REC']),
    readPath(payload, ['records', 'REC']),
    readPath(payload, ['records']),
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') return [candidate];
  }
  return [];
}

function getStarterPage(payload: unknown): StarterPage {
  const record = asRecord(payload);
  const candidates = [
    record.hits,
    record.documents,
    record.records,
    readPath(payload, ['data', 'hits']),
    readPath(payload, ['data', 'documents']),
    readPath(payload, ['Data', 'Records', 'records', 'REC']),
  ];
  let records: unknown[] = [];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      records = candidate;
      break;
    }
  }
  const total = clampInteger(
    firstPresent(payload, [
      ['metadata', 'total'],
      ['meta', 'total'],
      ['total'],
      ['QueryResult', 'RecordsFound'],
    ]),
    records.length,
    0,
    Number.MAX_SAFE_INTEGER,
  );
  return { total, records };
}

function buildDedupeKeys(record: Partial<UnifiedLiterature> & Record<string, unknown>): string[] {
  const keys: string[] = [];
  const doi = normalizeDoi(record.doi);
  if (doi) keys.push(`doi:${doi.toLowerCase()}`);
  const sourceRecordId = normalizeText(record.sourceRecordId);
  if (sourceRecordId) keys.push(`source:${sourceRecordId.toLowerCase()}`);
  const title = normalizeText(record.title)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
  const firstAuthor = Array.isArray(record.authors)
    ? normalizeText(record.authors[0]?.name).toLowerCase()
    : normalizeText(record.author).split(/[;,]/)[0].toLowerCase();
  if (title) keys.push(`title:${title}|${record.year || ''}|${firstAuthor}`);
  if (record.id) keys.push(`id:${String(record.id).toLowerCase()}`);
  return keys;
}

function toRisRecord(record: UnifiedLiterature): string {
  const lines = [
    `TY  - ${record.documentType === 'review' ? 'JOUR' : 'JOUR'}`,
    `TI  - ${record.title}`,
    ...record.authors.map(author => `AU  - ${author.name}`),
    record.year ? `PY  - ${record.year}` : '',
    record.journal ? `JO  - ${record.journal}` : '',
    record.volume ? `VL  - ${record.volume}` : '',
    record.issue ? `IS  - ${record.issue}` : '',
    record.pages ? `SP  - ${record.pages}` : '',
    record.abstract ? `AB  - ${record.abstract}` : '',
    ...record.keywords.map(keyword => `KW  - ${keyword}`),
    record.doi ? `DO  - ${record.doi}` : '',
    'DB  - Web of Science',
    'ER  -',
  ];
  return lines.filter(Boolean).join('\n');
}

function toWosField(tag: string, values: string[]): string[] {
  const clean = values.map(value => String(value || '').replace(/\r?\n/g, ' ').trim()).filter(Boolean);
  return clean.map(value => `${tag} ${value}`);
}

function toWosPlainText(records: UnifiedLiterature[]): string {
  const lines: string[] = [
    'FN Clarivate Web of Science API',
    'VR 1.0',
  ];
  records.forEach((record, index) => {
    const sourceRecordId = normalizeText((record as UnifiedLiterature & Record<string, unknown>).sourceRecordId);
    lines.push('PT J');
    lines.push(...toWosField('AU', record.authors.map(author => author.name)));
    lines.push(...toWosField('AF', record.authors.map(author => author.name)));
    lines.push(...toWosField('TI', [record.title]));
    lines.push(...toWosField('SO', [record.journal || 'Unknown Source']));
    lines.push(...toWosField('AB', [record.abstract]));
    lines.push(...toWosField('DE', record.keywords));
    lines.push(...toWosField('WC', record.categories || []));
    lines.push(...toWosField('PY', [String(record.year || '')]));
    lines.push(...toWosField('DI', [record.doi || '']));
    lines.push(...toWosField('UT', [sourceRecordId || `WOS:SH-${index + 1}-${hashText(record.id).slice(0, 12)}`]));
    lines.push(...toWosField('CR', record.references || []));
    lines.push('ER');
    lines.push('');
  });
  lines.push('EF');
  return lines.join('\n');
}

function extractJsonObject(text: string): Record<string, unknown> {
  const clean = String(text || '').trim();
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || clean;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('AI 未返回可解析的检索方案');
  return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
}

function normalizePlan(input: {
  topic: string;
  yearFrom?: number;
  yearTo?: number;
  documentTypes?: string[];
  raw?: Record<string, unknown>;
  provider: 'ai' | 'local';
}): LiteratureSearchPlan {
  const raw = input.raw || {};
  const topic = String(raw.topic || input.topic || '').trim();
  const conceptsRaw = Array.isArray(raw.concepts) ? raw.concepts : [];
  const concepts = conceptsRaw.map(item => {
    const record = asRecord(item);
    return {
      label: normalizeText(record.label || record.name),
      englishTerms: normalizeStringArray(record.englishTerms || record.english_terms),
      chineseTerms: normalizeStringArray(record.chineseTerms || record.chinese_terms),
    };
  }).filter(item => item.label || item.englishTerms.length || item.chineseTerms.length);
  const includeTerms = normalizeStringArray(raw.includeTerms || raw.include_terms);
  const excludeTerms = normalizeStringArray(raw.excludeTerms || raw.exclude_terms);
  const fallbackTerm = topic.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim();
  let wosQuery = normalizeText(raw.wosQuery || raw.wos_query);
  if (!wosQuery) wosQuery = `TS=("${fallbackTerm}")`;
  const yearFrom = normalizeYear(raw.yearFrom || raw.year_from || input.yearFrom);
  const yearTo = normalizeYear(raw.yearTo || raw.year_to || input.yearTo);
  if (yearFrom && yearTo && !/\bPY\s*=/.test(wosQuery)) {
    wosQuery = `${wosQuery} AND PY=(${Math.min(yearFrom, yearTo)}-${Math.max(yearFrom, yearTo)})`;
  }
  const documentTypes = normalizeStringArray(
    raw.documentTypes || raw.document_types || input.documentTypes || ['Article', 'Review'],
  );
  if (documentTypes.length > 0 && !/\bDT\s*=/i.test(wosQuery)) {
    const typeQuery = documentTypes
      .map(item => item.replace(/["()]/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .map(item => item.includes(' ') ? `"${item}"` : item)
      .join(' OR ');
    if (typeQuery) wosQuery = `${wosQuery} AND DT=(${typeQuery})`;
  }
  return {
    id: `plan-${compactTimestamp()}-${crypto.randomBytes(3).toString('hex')}`,
    topic,
    generatedAt: nowIso(),
    provider: input.provider,
    concepts,
    includeTerms,
    excludeTerms,
    wosQuery,
    cnkiQuery: normalizeText(raw.cnkiQuery || raw.cnki_query) || `主题=(${topic})`,
    yearFrom,
    yearTo,
    documentTypes,
    notes: normalizeStringArray(raw.notes),
  };
}

export class LiteratureCollectionManager {
  private readonly runningUsers = new Set<string>();
  private readonly scheduledUsers = new Set<string>();

  constructor(private readonly options: LiteratureCollectionManagerOptions) {
    fs.mkdirSync(this.getRoot(), { recursive: true });
  }

  getPublicConfig(userIdInput: string): LiteratureCollectionPublicConfig {
    const config = this.loadStoredConfig(userIdInput);
    return {
      hasWosApiKey: !!this.resolveApiKey(config),
      wosMode: config.wosMode,
      wosStarterBaseUrl: config.wosStarterBaseUrl,
      wosExpandedBaseUrl: config.wosExpandedBaseUrl,
      updatedAt: config.updatedAt,
    };
  }

  saveConfig(userIdInput: string, input: {
    wosApiKey?: string;
    keepWosApiKey?: boolean;
    wosMode?: 'starter' | 'expanded';
    wosStarterBaseUrl?: string;
    wosExpandedBaseUrl?: string;
  }): LiteratureCollectionPublicConfig {
    const userId = sanitizeUserId(userIdInput || 'web-user');
    const current = this.loadStoredConfig(userId);
    const suppliedKey = String(input.wosApiKey || '').trim();
    const next: StoredLiteratureCollectionConfig = {
      encryptedWosApiKey: suppliedKey
        ? encrypt(suppliedKey)
        : (input.keepWosApiKey !== false ? current.encryptedWosApiKey : ''),
      // 正式采集必须使用 Full Record；Starter 只含基础题录，不再作为可入库模式。
      wosMode: 'expanded',
      wosStarterBaseUrl: String(input.wosStarterBaseUrl || current.wosStarterBaseUrl || DEFAULT_STARTER_BASE_URL).trim().replace(/\/+$/, ''),
      wosExpandedBaseUrl: String(input.wosExpandedBaseUrl || current.wosExpandedBaseUrl || DEFAULT_EXPANDED_BASE_URL).trim().replace(/\/+$/, ''),
      updatedAt: nowIso(),
    };
    atomicWriteJson(this.getConfigPath(userId), next);
    return this.getPublicConfig(userId);
  }

  async planTopic(input: {
    userId: string;
    topic: string;
    yearFrom?: number;
    yearTo?: number;
    documentTypes?: string[];
    requirements?: string;
  }): Promise<LiteratureSearchPlan> {
    const topic = String(input.topic || '').trim();
    if (!topic) throw new Error('请输入需要检索的研究主题');
    const runtime = this.options.getPlannerRuntime?.() || null;
    let plan: LiteratureSearchPlan;
    if (runtime?.configured !== false && runtime?.apiUrl && runtime?.apiKey && runtime?.defaultModel) {
      try {
        const response = await callChatCompletion(runtime, {
          model: runtime.defaultModel,
          temperature: 0.15,
          maxTokens: 2800,
          messages: [
            {
              role: 'system',
              content: [
                '你是学术数据库检索策略专家。把用户主题转换为可复现的 Web of Science Core Collection 与 CNKI 检索方案。',
                '只返回 JSON，不要 Markdown。字段：topic, concepts[{label,englishTerms[],chineseTerms[]}], includeTerms[], excludeTerms[], wosQuery, cnkiQuery, yearFrom, yearTo, documentTypes[], notes[]。',
                'wosQuery 必须使用合法的 TS=(...) 布尔检索，必要时附加 PY=(起始年-结束年)。不要编造作者、DOI 或文献结果。',
                'cnkiQuery 使用中文可读的主题/篇关摘组合检索表达式，保留同义词。',
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                topic,
                yearFrom: input.yearFrom,
                yearTo: input.yearTo,
                documentTypes: input.documentTypes || ['Article', 'Review'],
                requirements: String(input.requirements || '').trim(),
              }),
            },
          ],
        });
        plan = normalizePlan({
          topic,
          yearFrom: input.yearFrom,
          yearTo: input.yearTo,
          documentTypes: input.documentTypes,
          raw: extractJsonObject(response),
          provider: 'ai',
        });
      } catch (error) {
        logger.warn('[LiteratureCollection] AI query planning failed; using local fallback:', error);
        plan = normalizePlan({
          topic,
          yearFrom: input.yearFrom,
          yearTo: input.yearTo,
          documentTypes: input.documentTypes,
          provider: 'local',
        });
        plan.notes.push(`AI 检索式生成失败，已使用本地兜底：${(error as Error).message}`);
      }
    } else {
      plan = normalizePlan({
        topic,
        yearFrom: input.yearFrom,
        yearTo: input.yearTo,
        documentTypes: input.documentTypes,
        provider: 'local',
      });
      plan.notes.push('小牛马尚未配置，当前使用本地保守检索式；配置模型后可自动扩写中英文同义词。');
    }
    const planDir = path.join(this.getUserRoot(input.userId), 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    atomicWriteJson(path.join(planDir, `${plan.id}.json`), plan);
    return plan;
  }

  createJob(input: CreateJobInput): LiteratureCollectionJob {
    const userId = sanitizeUserId(input.userId || 'web-user');
    const topic = String(input.topic || '').trim();
    const query = String(input.query || '').trim();
    if (!topic || !query) throw new Error('主题和检索式不能为空');
    const source = input.source;
    const importToBibliometrics = input.importToBibliometrics !== false;
    if (source === 'wos-starter' && importToBibliometrics) {
      throw new Error('WoS Starter 只有基础题录，不能进入文献计量分析；请配置 Expanded API 并获取 Full Record');
    }
    const id = `collect-${compactTimestamp()}-${crypto.randomBytes(4).toString('hex')}`;
    const durableRoot = path.join(this.getUserRoot(userId), 'jobs', id);
    fs.mkdirSync(path.join(durableRoot, 'raw', source), { recursive: true });
    fs.mkdirSync(path.join(durableRoot, 'normalized'), { recursive: true });
    fs.mkdirSync(path.join(durableRoot, 'exports'), { recursive: true });
    const status: LiteratureCollectionJobStatus = source === 'cnki-assisted' ? 'awaiting-user' : 'queued';
    const job: LiteratureCollectionJob = {
      id,
      userId,
      source,
      topic,
      query,
      planId: input.planId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status,
      statusMessage: source === 'cnki-assisted'
        ? '检索式已准备，请在用户登录的 CNKI 页面导出题录文件'
        : '已加入持久化采集队列',
      yearFrom: normalizeYear(input.yearFrom),
      yearTo: normalizeYear(input.yearTo),
      documentTypes: (input.documentTypes || ['Article', 'Review']).map(String),
      maxRecords: clampInteger(input.maxRecords, 10_000, 1, MAX_COLLECTION_RECORDS),
      pageSize: source === 'wos-expanded' ? 100 : 50,
      nextPage: 1,
      pagesCompleted: 0,
      totalFound: 0,
      recordsFetched: 0,
      recordsEligible: 0,
      missingAbstractRecords: 0,
      recordsImported: 0,
      duplicateRecords: 0,
      outputRoot: input.outputRoot
        ? path.join(path.resolve(input.outputRoot), `${safeFileSegment(topic)}-${id}`)
        : undefined,
      durableRoot,
      importToLiterature: input.importToLiterature !== false,
      importToBibliometrics,
    };
    this.saveJob(job);
    this.writeSearchStrategy(job);
    this.mirrorOutputs(job);
    if (status === 'queued') this.scheduleUser(userId);
    return job;
  }

  listJobs(userIdInput: string): LiteratureCollectionJob[] {
    const jobsDir = path.join(this.getUserRoot(userIdInput), 'jobs');
    if (!fs.existsSync(jobsDir)) return [];
    return fs.readdirSync(jobsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => this.readJob(path.join(jobsDir, entry.name, 'job.json')))
      .filter((job): job is LiteratureCollectionJob => !!job)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getJob(userIdInput: string, jobId: string): LiteratureCollectionJob | null {
    const safeJobId = safeFileSegment(jobId);
    return this.readJob(path.join(this.getUserRoot(userIdInput), 'jobs', safeJobId, 'job.json'));
  }

  updateJobStatus(
    userIdInput: string,
    jobId: string,
    action: 'pause' | 'resume' | 'cancel' | 'retry',
  ): LiteratureCollectionJob {
    const job = this.getJob(userIdInput, jobId);
    if (!job) throw new Error('采集任务不存在');
    if (action === 'pause' && ['queued', 'running'].includes(job.status)) {
      job.status = 'paused';
      job.statusMessage = '任务已暂停，可随时继续';
    } else if (action === 'resume' && ['paused', 'failed'].includes(job.status)) {
      job.status = 'queued';
      job.error = undefined;
      job.statusMessage = '任务已恢复并重新加入队列';
    } else if (action === 'retry' && job.status === 'failed') {
      job.status = 'queued';
      job.error = undefined;
      job.statusMessage = '失败任务已重新加入队列';
    } else if (action === 'cancel' && !['completed', 'cancelled'].includes(job.status)) {
      job.status = 'cancelled';
      job.statusMessage = '任务已取消，已下载的原始批次仍保留';
    }
    this.saveJob(job);
    if (job.status === 'queued') this.scheduleUser(job.userId);
    return job;
  }

  recoverPersistentQueues(): void {
    const root = this.getRoot();
    if (!fs.existsSync(root)) return;
    for (const userEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!userEntry.isDirectory()) continue;
      const userId = sanitizeUserId(userEntry.name);
      let shouldSchedule = false;
      for (const job of this.listJobs(userId)) {
        if (job.status === 'running') {
          job.status = 'queued';
          job.statusMessage = '应用重新启动，任务已从上次批次继续';
          this.saveJob(job);
          shouldSchedule = true;
        } else if (job.status === 'queued') {
          shouldSchedule = true;
        }
      }
      if (shouldSchedule) this.scheduleUser(userId);
    }
  }

  private scheduleUser(userIdInput: string): void {
    const userId = sanitizeUserId(userIdInput);
    if (this.runningUsers.has(userId) || this.scheduledUsers.has(userId)) return;
    this.scheduledUsers.add(userId);
    setImmediate(() => {
      this.scheduledUsers.delete(userId);
      void this.runUserQueue(userId);
    });
  }

  private async runUserQueue(userId: string): Promise<void> {
    if (this.runningUsers.has(userId)) return;
    this.runningUsers.add(userId);
    try {
      while (true) {
        const next = this.listJobs(userId)
          .filter(job => job.status === 'queued')
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (!next) break;
        await this.runJob(next);
      }
    } finally {
      this.runningUsers.delete(userId);
      if (this.listJobs(userId).some(job => job.status === 'queued')) this.scheduleUser(userId);
    }
  }

  private async runJob(job: LiteratureCollectionJob): Promise<void> {
    const config = this.loadStoredConfig(job.userId);
    const apiKey = this.resolveApiKey(config);
    if (!apiKey) {
      job.status = 'failed';
      job.error = '尚未配置 Web of Science API Key';
      job.statusMessage = job.error;
      this.saveJob(job);
      return;
    }
    job.status = 'running';
    job.startedAt ||= nowIso();
    job.statusMessage = '正在连接 Web of Science 官方 API';
    this.saveJob(job);
    try {
      while (job.recordsFetched < job.maxRecords) {
        const latest = this.getJob(job.userId, job.id);
        if (!latest || latest.status === 'cancelled' || latest.status === 'paused') return;
        Object.assign(job, latest);
        const page = await this.fetchWosPage(job, config, apiKey);
        const afterFetch = this.getJob(job.userId, job.id);
        if (!afterFetch || afterFetch.status === 'cancelled' || afterFetch.status === 'paused') return;
        Object.assign(job, afterFetch);
        job.totalFound = Math.max(job.totalFound, page.total);
        if (page.records.length === 0) {
          if (job.nextPage === 1 && page.total > 0) {
            throw new Error('WoS API 返回了命中数量，但记录字段为空；请检查 API 类型与订阅权限');
          }
          break;
        }
        const normalized = page.records.map((record, index) => {
          const sourceId = normalizeText(firstPresent(record, [
            ['uid'],
            ['UID'],
            ['ut'],
            ['id'],
            ['dynamic_data', 'cluster_related', 'identifiers', 'identifier'],
          ])) || `${job.source}:${job.nextPage}:${index + 1}`;
          return toStableLiterature(record, sourceId, job.id);
        });
        const remaining = Math.max(0, job.maxRecords - job.recordsFetched);
        const accepted = normalized.slice(0, remaining);
        this.writeRawPage(job, page, accepted);
        job.recordsFetched += accepted.length;
        job.pagesCompleted += 1;
        job.nextPage += 1;
        job.statusMessage = `已获取 ${job.recordsFetched}/${Math.min(job.totalFound || job.maxRecords, job.maxRecords)} 条，完成 ${job.pagesCompleted} 批`;
        this.saveJob(job);
        if (accepted.length < page.records.length || page.records.length < job.pageSize) break;
      }
      const records = this.loadNormalizedRecords(job);
      const uniqueRecords = this.dedupeRecords(records);
      const recordsWithAbstract = uniqueRecords.filter(record => normalizeText(record.abstract).length > 0);
      const recordsMissingAbstract = uniqueRecords.filter(record => normalizeText(record.abstract).length === 0);
      job.recordsEligible = recordsWithAbstract.length;
      job.missingAbstractRecords = recordsMissingAbstract.length;
      if (recordsMissingAbstract.length > 0) {
        atomicWriteJson(
          path.join(job.durableRoot, 'rejected-missing-abstract.json'),
          {
            reason: '摘要为空，未进入通用文献库或文献计量数据库',
            records: recordsMissingAbstract,
          },
        );
      }
      if (uniqueRecords.length > 0 && recordsWithAbstract.length === 0) {
        throw new Error(
          job.source === 'wos-starter'
            ? '本批记录均缺少摘要。Starter 基础题录不能用于正式入库，请切换到 WoS Expanded Full Record'
            : '本批 Full Record 均未解析到摘要，已停止入库；请检查 Expanded API 权限和返回字段',
        );
      }
      this.writeExports(job, recordsWithAbstract);
      let importResult: LiteratureCollectionImportResult = {
        totalRecords: recordsWithAbstract.length,
        addedRecords: 0,
        duplicateRecords: 0,
        missingAbstractRecords: recordsMissingAbstract.length,
        bibliometricsEligibleRecords: job.source === 'wos-expanded' ? recordsWithAbstract.length : 0,
        literaturePath: this.getLiteraturePath(job.userId),
        indexRefreshPending: false,
      };
      if (job.importToLiterature) {
        importResult = {
          ...this.importIntoLiteratureLibrary(job, recordsWithAbstract),
          missingAbstractRecords: recordsMissingAbstract.length,
          bibliometricsEligibleRecords: job.source === 'wos-expanded' ? recordsWithAbstract.length : 0,
        };
      }
      if (
        job.importToBibliometrics
        && job.source === 'wos-expanded'
        && this.options.importWosPlainText
        && recordsWithAbstract.length > 0
      ) {
        try {
          await this.options.importWosPlainText({
            userId: job.userId,
            fileName: `${safeFileSegment(job.topic, 'wos-api')}-wos-api.txt`,
            content: toWosPlainText(recordsWithAbstract),
          });
          importResult.bibliometricsImported = true;
        } catch (error) {
          importResult.bibliometricsImported = false;
          importResult.bibliometricsError = (error as Error).message;
          logger.warn(`[LiteratureCollection] Bibliometrics import failed for ${job.id}:`, error);
        }
      }
      job.importResult = importResult;
      job.recordsImported = importResult.addedRecords;
      job.duplicateRecords = importResult.duplicateRecords;
      job.status = 'completed';
      job.completedAt = nowIso();
      job.statusMessage = [
        `采集完成：获取 ${job.recordsFetched} 条`,
        `符合摘要要求 ${job.recordsEligible} 条`,
        `新增入库 ${job.recordsImported} 条`,
        `重复 ${job.duplicateRecords} 条`,
        job.missingAbstractRecords > 0 ? `缺摘要跳过 ${job.missingAbstractRecords} 条` : '',
      ].filter(Boolean).join('，');
      this.saveJob(job);
      this.mirrorOutputs(job);
    } catch (error) {
      job.status = 'failed';
      job.error = (error as Error).message || String(error);
      job.statusMessage = `采集失败：${job.error}`;
      this.saveJob(job);
      this.mirrorOutputs(job);
      logger.error(`[LiteratureCollection] Job ${job.id} failed:`, error);
    }
  }

  private async fetchWosPage(
    job: LiteratureCollectionJob,
    config: StoredLiteratureCollectionConfig,
    apiKey: string,
  ): Promise<StarterPage> {
    const mode = job.source === 'wos-expanded' ? 'expanded' : 'starter';
    const url = mode === 'expanded'
      ? new URL(config.wosExpandedBaseUrl || DEFAULT_EXPANDED_BASE_URL)
      : new URL(`${(config.wosStarterBaseUrl || DEFAULT_STARTER_BASE_URL).replace(/\/+$/, '')}/documents`);
    if (mode === 'expanded') {
      url.searchParams.set('databaseId', 'WOS');
      url.searchParams.set('usrQuery', job.query);
      url.searchParams.set('count', String(job.pageSize));
      url.searchParams.set('firstRecord', String(((job.nextPage - 1) * job.pageSize) + 1));
      url.searchParams.set('optionView', 'FR');
    } else {
      url.searchParams.set('q', job.query);
      url.searchParams.set('db', 'WOS');
      url.searchParams.set('limit', String(job.pageSize));
      url.searchParams.set('page', String(job.nextPage));
      url.searchParams.set('detail', 'full');
    }
    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'X-ApiKey': apiKey,
          },
        });
        const text = await response.text();
        if (!response.ok) {
          const retryAfter = clampInteger(response.headers.get('retry-after'), 0, 0, 30);
          if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRY_ATTEMPTS) {
            await sleep(Math.max(retryAfter * 1000, RETRY_BASE_DELAY_MS * attempt));
            continue;
          }
          throw new Error(`WoS API ${response.status}：${text.slice(0, 800) || response.statusText}`);
        }
        const payload = JSON.parse(text || '{}') as unknown;
        if (mode === 'expanded') {
          return {
            total: clampInteger(readPath(payload, ['QueryResult', 'RecordsFound']), 0, 0, Number.MAX_SAFE_INTEGER),
            records: getExpandedRecords(payload),
          };
        }
        return getStarterPage(payload);
      } catch (error) {
        lastError = error;
        if (attempt >= MAX_RETRY_ATTEMPTS) break;
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('WoS API 请求失败');
  }

  private writeRawPage(job: LiteratureCollectionJob, page: StarterPage, records: UnifiedLiterature[]): void {
    const rawPath = path.join(
      job.durableRoot,
      'raw',
      job.source,
      `page-${String(job.nextPage).padStart(6, '0')}.json`,
    );
    atomicWriteJson(rawPath, {
      collectedAt: nowIso(),
      page: job.nextPage,
      total: page.total,
      records: page.records,
    });
    const normalizedPath = path.join(job.durableRoot, 'normalized', 'records.jsonl');
    fs.appendFileSync(
      normalizedPath,
      records.map(record => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''),
      'utf-8',
    );
  }

  private loadNormalizedRecords(job: LiteratureCollectionJob): UnifiedLiterature[] {
    const filePath = path.join(job.durableRoot, 'normalized', 'records.jsonl');
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf-8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .flatMap(line => {
        try {
          return [JSON.parse(line) as UnifiedLiterature];
        } catch {
          return [];
        }
      });
  }

  private dedupeRecords(records: UnifiedLiterature[]): UnifiedLiterature[] {
    const seen = new Set<string>();
    const unique: UnifiedLiterature[] = [];
    for (const record of records) {
      const keys = buildDedupeKeys(record as UnifiedLiterature & Record<string, unknown>);
      if (keys.some(key => seen.has(key))) continue;
      keys.forEach(key => seen.add(key));
      unique.push(record);
    }
    return unique;
  }

  private importIntoLiteratureLibrary(
    job: LiteratureCollectionJob,
    records: UnifiedLiterature[],
  ): LiteratureCollectionImportResult {
    const literaturePath = this.getLiteraturePath(job.userId);
    const existingPayload = readJsonFile<{ papers?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      literaturePath,
      { papers: [] },
    );
    const existing = Array.isArray(existingPayload)
      ? existingPayload
      : (Array.isArray(existingPayload.papers) ? existingPayload.papers : []);
    const seen = new Set<string>();
    existing.forEach(record => buildDedupeKeys(record).forEach(key => seen.add(key)));
    const added: UnifiedLiterature[] = [];
    let duplicateRecords = 0;
    for (const record of records) {
      const keys = buildDedupeKeys(record as UnifiedLiterature & Record<string, unknown>);
      if (keys.some(key => seen.has(key))) {
        duplicateRecords += 1;
        continue;
      }
      keys.forEach(key => seen.add(key));
      added.push(record);
    }
    const merged = [...existing, ...added];
    fs.mkdirSync(path.dirname(literaturePath), { recursive: true });
    atomicWriteJson(literaturePath, { papers: merged });
    const textPath = this.getLiteratureTextPath(job.userId);
    fs.writeFileSync(
      textPath,
      merged.map((paper, index) => {
        const authors = Array.isArray(paper.authors)
          ? (paper.authors as Array<{ name?: string }>).map(author => author.name || '').filter(Boolean).join(', ')
          : normalizeText(paper.author);
        return [
          `[${index + 1}] ${normalizeText(paper.title)}`,
          `作者: ${authors}`,
          `年份: ${normalizeText(paper.year)}`,
          `期刊: ${normalizeText(paper.journal)}`,
          `DOI: ${normalizeText(paper.doi)}`,
          `关键词: ${normalizeStringArray(paper.keywords).join('; ')}`,
          `摘要: ${normalizeText(paper.abstract)}`,
        ].join('\n');
      }).join('\n\n'),
      'utf-8',
    );
    getRetrievalEngineManager().clearUserEngine(job.userId);
    return {
      totalRecords: records.length,
      addedRecords: added.length,
      duplicateRecords,
      missingAbstractRecords: 0,
      bibliometricsEligibleRecords: 0,
      literaturePath,
      indexRefreshPending: added.length > 0,
    };
  }

  private writeExports(job: LiteratureCollectionJob, records: UnifiedLiterature[]): void {
    const exportDir = path.join(job.durableRoot, 'exports');
    fs.mkdirSync(exportDir, { recursive: true });
    fs.writeFileSync(
      path.join(exportDir, 'merged.ris'),
      records.map(toRisRecord).join('\n\n'),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(exportDir, 'wos-api-normalized.txt'),
      toWosPlainText(records),
      'utf-8',
    );
    atomicWriteJson(path.join(exportDir, 'records.json'), { records });
  }

  private writeSearchStrategy(job: LiteratureCollectionJob): void {
    const strategy = [
      '# 文献采集检索策略',
      '',
      `- 主题：${job.topic}`,
      `- 来源：${job.source}`,
      `- 检索式：\`${job.query}\``,
      `- 年份：${job.yearFrom || '不限'}–${job.yearTo || '不限'}`,
      `- 文献类型：${job.documentTypes.join('、') || '不限'}`,
      `- 最大获取量：${job.maxRecords}`,
      `- 创建时间：${job.createdAt}`,
      '',
      '本文件与 job.json、原始分页响应和标准化导出共同构成可复现检索记录。',
    ].join('\n');
    fs.writeFileSync(path.join(job.durableRoot, 'search-strategy.md'), strategy, 'utf-8');
  }

  private mirrorOutputs(job: LiteratureCollectionJob): void {
    if (!job.outputRoot) return;
    try {
      fs.mkdirSync(job.outputRoot, { recursive: true });
      for (const relativePath of [
        'job.json',
        'search-strategy.md',
        'rejected-missing-abstract.json',
        path.join('exports', 'merged.ris'),
        path.join('exports', 'wos-api-normalized.txt'),
        path.join('exports', 'records.json'),
      ]) {
        const sourcePath = path.join(job.durableRoot, relativePath);
        if (!fs.existsSync(sourcePath)) continue;
        const targetPath = path.join(job.outputRoot, relativePath);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.copyFileSync(sourcePath, targetPath);
      }
    } catch (error) {
      logger.warn(`[LiteratureCollection] Failed to mirror outputs for ${job.id}:`, error);
    }
  }

  private getRoot(): string {
    return path.join(this.options.dataDir, 'literature-collection');
  }

  private getUserUploadRoot(userIdInput: string): string {
    const root = path.join(
      this.options.dataDir,
      'uploads',
      sanitizeUserId(userIdInput || 'web-user'),
    );
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  private getLiteraturePath(userIdInput: string): string {
    return path.join(this.getUserUploadRoot(userIdInput), 'literature.json');
  }

  private getLiteratureTextPath(userIdInput: string): string {
    return path.join(this.getUserUploadRoot(userIdInput), 'literature.txt');
  }

  private getUserRoot(userIdInput: string): string {
    const root = path.join(this.getRoot(), sanitizeUserId(userIdInput || 'web-user'));
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  private getConfigPath(userIdInput: string): string {
    return path.join(this.getUserRoot(userIdInput), 'config.json');
  }

  private loadStoredConfig(userIdInput: string): StoredLiteratureCollectionConfig {
    const stored = readJsonFile<Partial<StoredLiteratureCollectionConfig>>(
      this.getConfigPath(userIdInput),
      {},
    );
    return {
      encryptedWosApiKey: stored.encryptedWosApiKey || '',
      wosMode: 'expanded',
      wosStarterBaseUrl: stored.wosStarterBaseUrl || DEFAULT_STARTER_BASE_URL,
      wosExpandedBaseUrl: stored.wosExpandedBaseUrl || DEFAULT_EXPANDED_BASE_URL,
      updatedAt: stored.updatedAt,
    };
  }

  private resolveApiKey(config: StoredLiteratureCollectionConfig): string {
    return decrypt(config.encryptedWosApiKey || '') || String(process.env.WOS_API_KEY || '').trim();
  }

  private saveJob(job: LiteratureCollectionJob): void {
    job.updatedAt = nowIso();
    atomicWriteJson(path.join(job.durableRoot, 'job.json'), job);
  }

  private readJob(jobPath: string): LiteratureCollectionJob | null {
    const job = readJsonFile<LiteratureCollectionJob | null>(jobPath, null);
    if (!job?.id || !job.userId || !job.durableRoot) return null;
    job.recordsEligible = Number(job.recordsEligible || 0);
    job.missingAbstractRecords = Number(job.missingAbstractRecords || 0);
    if (job.importResult) {
      job.importResult.missingAbstractRecords = Number(job.importResult.missingAbstractRecords || 0);
      job.importResult.bibliometricsEligibleRecords = Number(job.importResult.bibliometricsEligibleRecords || 0);
    }
    return job;
  }
}

export default LiteratureCollectionManager;
