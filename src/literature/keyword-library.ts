export interface LiteratureRecord {
  id?: string;
  title?: string;
  authors?: Array<{ name?: string }> | string[];
  author?: string;
  year?: number | string;
  journal?: string;
  abstract?: string;
  keywords?: string[] | string;
  aiKeywords?: string[] | string;
  doi?: string;
  documentType?: string;
  embedding?: number[];
  [key: string]: unknown;
}

export interface KeywordTag {
  keyword: string;
  count: number;
}

export interface KeywordGroup {
  keyword: string;
  count: number;
  literatures: LiteraturePreview[];
}

export interface LiteraturePreview {
  id: string;
  title: string;
  author: string;
  year: string;
  journal: string;
  doi?: string;
  abstract?: string;
  keywords: string[];
  aiKeywords: string[];
  hasEmbedding: boolean;
}

export interface OuterTag {
  name: string;
  originalKeywords: string[];
  count: number;
  literatureIds: string[];
}

export interface OuterTagsConfig {
  mergedTags: OuterTag[];
  promotedTags: string[];
}

export interface KeywordFilterGroup {
  keywords: string[];
  operator?: 'AND' | 'OR';
}

export interface KeywordFilterOptions {
  keywords?: string[];
  mode?: 'AND' | 'OR';
  groups?: KeywordFilterGroup[];
  groupOperator?: 'AND' | 'OR';
  query?: string;
  yearFrom?: number;
  yearTo?: number;
  journals?: string[];
  documentTypes?: string[];
  limit?: number;
  offset?: number;
}

export interface KeywordFilterResult {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  papers: LiteraturePreview[];
}

export interface PaginatedKeywordTags {
  totalKeywords: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  tags: KeywordTag[];
}

const EMPTY_CONFIG: OuterTagsConfig = { mergedTags: [], promotedTags: [] };

export function normalizeKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function splitKeywordInput(input: unknown): string[] {
  if (!input) return [];
  if (Array.isArray(input)) {
    return input
      .flatMap(item => splitKeywordInput(item))
      .filter(Boolean);
  }
  if (typeof input !== 'string') return [];
  return input
    .split(/[;；,，、]/)
    .map(item => item.trim())
    .filter(item => item.length > 0);
}

export function getPaperKeywords(paper: LiteratureRecord): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const keyword of [
    ...splitKeywordInput(paper.keywords),
    ...splitKeywordInput(paper.aiKeywords),
  ]) {
    const key = normalizeKeyword(keyword);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(keyword.trim());
    }
  }
  return result;
}

export function toLiteraturePreview(paper: LiteratureRecord): LiteraturePreview {
  const authors = Array.isArray(paper.authors)
    ? paper.authors.map(author => typeof author === 'string' ? author : author.name || '').filter(Boolean).join(', ')
    : '';

  return {
    id: String(paper.id || paper.doi || paper.title || ''),
    title: String(paper.title || ''),
    author: String(paper.author || authors || 'Unknown'),
    year: String(paper.year || ''),
    journal: String(paper.journal || ''),
    doi: paper.doi ? String(paper.doi) : undefined,
    abstract: paper.abstract ? String(paper.abstract) : '',
    keywords: splitKeywordInput(paper.keywords),
    aiKeywords: splitKeywordInput(paper.aiKeywords),
    hasEmbedding: Array.isArray(paper.embedding) && paper.embedding.length > 0,
  };
}

export function sanitizeOuterTagsConfig(config: unknown): OuterTagsConfig {
  if (!config || typeof config !== 'object') {
    return { ...EMPTY_CONFIG };
  }

  const raw = config as Partial<OuterTagsConfig>;
  const mergedTags = Array.isArray(raw.mergedTags)
    ? raw.mergedTags
        .map(tag => ({
          name: normalizeKeyword(String(tag.name || '')),
          originalKeywords: splitKeywordInput(tag.originalKeywords).map(normalizeKeyword),
          count: Number(tag.count || 0),
          literatureIds: Array.isArray(tag.literatureIds) ? tag.literatureIds.map(String) : [],
        }))
        .filter(tag => tag.name && tag.originalKeywords.length > 0)
    : [];

  const promotedTags = Array.isArray(raw.promotedTags)
    ? raw.promotedTags.map(item => normalizeKeyword(String(item))).filter(Boolean)
    : [];

  return { mergedTags, promotedTags };
}

export function computeKeywordTags(papers: LiteratureRecord[]): { totalKeywords: number; tags: KeywordTag[] } {
  const originalCase = new Map<string, string>();
  const keywordLiteratureIds = new Map<string, Set<string>>();

  for (const paper of papers) {
    const id = String(paper.id || paper.doi || paper.title || '');
    const seenInPaper = new Set<string>();

    for (const keyword of getPaperKeywords(paper)) {
      const keywordLower = normalizeKeyword(keyword);
      if (!keywordLower || seenInPaper.has(keywordLower)) continue;
      seenInPaper.add(keywordLower);

      if (!originalCase.has(keywordLower)) {
        originalCase.set(keywordLower, keyword.trim());
      }

      if (!keywordLiteratureIds.has(keywordLower)) {
        keywordLiteratureIds.set(keywordLower, new Set<string>());
      }
      keywordLiteratureIds.get(keywordLower)!.add(id);
    }
  }

  const tags = Array.from(keywordLiteratureIds.entries())
    .map(([keywordLower, literatureIds]) => ({
      keyword: originalCase.get(keywordLower) || keywordLower,
      count: literatureIds.size,
    }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));

  return { totalKeywords: tags.length, tags };
}

export function paginateKeywordTags(
  tags: KeywordTag[],
  options: { query?: string; offset?: number; limit?: number } = {}
): PaginatedKeywordTags {
  const query = normalizeKeyword(String(options.query || ''));
  const filtered = query
    ? tags.filter(tag => normalizeKeyword(tag.keyword).includes(query))
    : tags;
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, 100, 1000);
  const page = filtered.slice(offset, offset + limit);

  return {
    totalKeywords: filtered.length,
    offset,
    limit,
    hasMore: offset + page.length < filtered.length,
    tags: page,
  };
}

export function computeKeywordGroups(
  papers: LiteratureRecord[],
  maxGroups = 50
): { totalKeywords: number; groups: KeywordGroup[] } {
  const tags = computeKeywordTags(papers);
  const groups = tags.tags.slice(0, maxGroups).map(tag => ({
    keyword: tag.keyword,
    count: tag.count,
    literatures: filterLiteraturesByKeywords(papers, {
      keywords: [tag.keyword],
      mode: 'OR',
      limit: 100,
    }).papers,
  }));

  return {
    totalKeywords: tags.totalKeywords,
    groups,
  };
}

export function filterLiteraturesByKeywords(
  papers: LiteratureRecord[],
  options: KeywordFilterOptions,
  config: OuterTagsConfig = EMPTY_CONFIG
): KeywordFilterResult {
  const offset = normalizeOffset(options.offset);
  const limit = normalizeLimit(options.limit, 100, 1000);
  const filtered = papers.filter(paper =>
    matchesYear(paper, options) &&
    matchesJournal(paper, options) &&
    matchesDocumentType(paper, options) &&
    matchesTextQuery(paper, options.query) &&
    matchesKeywordFilter(paper, options, config)
  );
  const page = filtered.slice(offset, offset + limit);

  return {
    total: filtered.length,
    offset,
    limit,
    hasMore: offset + page.length < filtered.length,
    papers: page.map(toLiteraturePreview),
  };
}

export function manualMergeKeywords(
  papers: LiteratureRecord[],
  keywords: string[],
  newName: string
): { count: number; literatureIds: string[]; originalKeywords: string[]; newName: string } {
  const originalKeywords = keywords.map(normalizeKeyword).filter(Boolean);
  const literatureIds = new Set<string>();

  for (const paper of papers) {
    if (originalKeywords.some(keyword => matchesKeyword(paper, keyword, EMPTY_CONFIG))) {
      literatureIds.add(String(paper.id || paper.doi || paper.title || ''));
    }
  }

  return {
    count: literatureIds.size,
    literatureIds: Array.from(literatureIds).filter(Boolean),
    originalKeywords,
    newName: normalizeKeyword(newName),
  };
}

export function summarizeEmbeddingLibrary(
  papers: LiteratureRecord[],
  config: OuterTagsConfig = EMPTY_CONFIG
): {
  count: number;
  abstractCount: number;
  embeddingCount: number;
  years: string[];
  journals: KeywordTag[];
  keywords: KeywordTag[];
  mergedTags: OuterTag[];
} {
  const years = Array.from(new Set(papers.map(p => String(p.year || '')).filter(Boolean))).sort();
  const journalCounts = new Map<string, number>();
  let abstractCount = 0;
  let embeddingCount = 0;

  for (const paper of papers) {
    const journal = String(paper.journal || '').trim();
    if (journal) {
      journalCounts.set(journal, (journalCounts.get(journal) || 0) + 1);
    }
    if (String(paper.abstract || '').trim()) {
      abstractCount++;
    }
    if (Array.isArray(paper.embedding) && paper.embedding.length > 0) {
      embeddingCount++;
    }
  }

  const journals = Array.from(journalCounts.entries())
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword))
    .slice(0, 20);

  return {
    count: papers.length,
    abstractCount,
    embeddingCount,
    years,
    journals,
    keywords: computeKeywordTags(papers).tags.slice(0, 50),
    mergedTags: config.mergedTags,
  };
}

function matchesKeywordFilter(
  paper: LiteratureRecord,
  options: KeywordFilterOptions,
  config: OuterTagsConfig
): boolean {
  const groups = (options.groups || []).filter(group => group.keywords && group.keywords.length > 0);
  if (groups.length > 0) {
    const paperKeywords = getPaperKeywords(paper).map(normalizeKeyword);
    const groupMatches = groups.map(group => {
      const keywords = group.keywords.map(normalizeKeyword).filter(Boolean);
      if (keywords.length === 0) return true;
      const operator = group.operator === 'OR' ? 'OR' : 'AND';
      return operator === 'OR'
        ? keywords.some(keyword => matchesKeyword(paper, keyword, config, paperKeywords))
        : keywords.every(keyword => matchesKeyword(paper, keyword, config, paperKeywords));
    });
    return options.groupOperator === 'AND'
      ? groupMatches.every(Boolean)
      : groupMatches.some(Boolean);
  }

  const keywords = (options.keywords || []).map(normalizeKeyword).filter(Boolean);
  if (keywords.length === 0) return true;

  const paperKeywords = getPaperKeywords(paper).map(normalizeKeyword);
  return options.mode === 'OR'
    ? keywords.some(keyword => matchesKeyword(paper, keyword, config, paperKeywords))
    : keywords.every(keyword => matchesKeyword(paper, keyword, config, paperKeywords));
}

function matchesKeyword(
  paper: LiteratureRecord,
  keyword: string,
  config: OuterTagsConfig,
  normalizedPaperKeywords?: string[]
): boolean {
  const mergedTag = config.mergedTags.find(tag => normalizeKeyword(tag.name) === keyword);
  const candidates = mergedTag ? mergedTag.originalKeywords.map(normalizeKeyword) : [keyword];
  const paperKeywords = normalizedPaperKeywords || getPaperKeywords(paper).map(normalizeKeyword);

  return candidates.some(candidate =>
    paperKeywords.some(paperKeyword =>
      paperKeyword === candidate ||
      paperKeyword.includes(candidate) ||
      candidate.includes(paperKeyword)
    )
  );
}

function matchesTextQuery(paper: LiteratureRecord, query?: string): boolean {
  const normalized = normalizeKeyword(String(query || ''));
  if (!normalized) return true;

  const haystack = [
    paper.title,
    paper.author,
    Array.isArray(paper.authors)
      ? paper.authors.map(author => typeof author === 'string' ? author : author.name || '').join(' ')
      : '',
    paper.year,
    paper.journal,
    paper.doi,
    paper.abstract,
    getPaperKeywords(paper).join(' '),
  ].map(item => String(item || '').toLowerCase()).join('\n');

  return haystack.includes(normalized);
}

function matchesYear(paper: LiteratureRecord, options: KeywordFilterOptions): boolean {
  const year = Number(paper.year || 0);
  if (options.yearFrom !== undefined && year < options.yearFrom) return false;
  if (options.yearTo !== undefined && year > options.yearTo) return false;
  return true;
}

function matchesJournal(paper: LiteratureRecord, options: KeywordFilterOptions): boolean {
  if (!options.journals || options.journals.length === 0) return true;
  const journal = String(paper.journal || '').toLowerCase();
  return options.journals.some(item => journal.includes(String(item).toLowerCase()));
}

function matchesDocumentType(paper: LiteratureRecord, options: KeywordFilterOptions): boolean {
  if (!options.documentTypes || options.documentTypes.length === 0) return true;
  return options.documentTypes.includes(String(paper.documentType || 'article'));
}

function normalizeOffset(value: unknown): number {
  const offset = Math.floor(Number(value || 0));
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
}

function normalizeLimit(value: unknown, defaultLimit: number, maxLimit: number): number {
  const parsed = Math.floor(Number(value || defaultLimit));
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultLimit;
  }
  return Math.min(parsed, maxLimit);
}
