import {
  getPaperKeywords,
  splitKeywordInput,
  type LiteratureRecord,
  type OuterTagsConfig,
} from '../literature/keyword-library';

export interface BibliometricRankItem {
  label: string;
  count: number;
  percentage: number;
}

export interface BibliometricYearTrendItem {
  year: number;
  count: number;
  cumulative: number;
}

export type BibliometricNodeKind =
  | 'keyword'
  | 'author'
  | 'literature'
  | 'reference'
  | 'institution'
  | 'country';

export interface BibliometricNetworkNode {
  id: string;
  label: string;
  kind: BibliometricNodeKind;
  value: number;
  meta?: Record<string, unknown>;
}

export interface BibliometricNetworkEdge {
  source: string;
  target: string;
  weight: number;
  meta?: Record<string, unknown>;
}

export interface BibliometricNetwork {
  nodes: BibliometricNetworkNode[];
  edges: BibliometricNetworkEdge[];
}

export interface BibliometricTopicCluster {
  id: string;
  label: string;
  size: number;
  literatureCount: number;
  keywords: string[];
  sampleTitles: string[];
}

export interface BibliometricQualityMetric {
  id: string;
  label: string;
  count: number;
  percentage: number;
}

export interface BibliometricSummary {
  total: number;
  yearMin: number | null;
  yearMax: number | null;
  journalCount: number;
  authorCount: number;
  keywordCount: number;
  doiCount: number;
  abstractCount: number;
  embeddingCount: number;
  citedCount: number;
  referenceCount: number;
  institutionCount: number;
  countryCount: number;
  mergedKeywordTagCount: number;
  promotedKeywordTagCount: number;
}

export interface BibliometricKeywordTagSource {
  mode: 'merged-tags' | 'raw-keywords';
  mergedTagCount: number;
  promotedTagCount: number;
  mergedTaggedLiteratureCount: number;
  note: string;
}

export interface BibliometricKeywordBurst {
  keyword: string;
  score: number;
  baselineCount: number;
  recentCount: number;
  peakYear: number | null;
  activeYears: number[];
}

export interface BibliometricKeywordTrendPoint {
  year: number;
  count: number;
  percentage: number;
}

export interface BibliometricKeywordTrendSeries {
  keyword: string;
  total: number;
  peakYear: number | null;
  points: BibliometricKeywordTrendPoint[];
}

export interface BibliometricTopicEvolutionPeriod {
  period: string;
  startYear: number | null;
  endYear: number | null;
  literatureCount: number;
  topKeywords: BibliometricRankItem[];
  leadingJournals: BibliometricRankItem[];
  representativeTitles: string[];
}

export interface BibliometricHighImpactLiterature {
  id: string;
  title: string;
  authors: string;
  year: number | null;
  journal: string;
  doi: string;
  citationCount: number | null;
  influenceScore: number;
  hasCitationData: boolean;
}

export interface BibliometricJournalQuality {
  coverage: BibliometricQualityMetric[];
  quartiles: BibliometricRankItem[];
  casZones: BibliometricRankItem[];
  sourceLevels: BibliometricRankItem[];
  impactFactorAvailable: number;
  topImpactFactorJournals: Array<{ journal: string; impactFactor: number; count: number }>;
  note: string;
}

export interface BibliometricRetrievalQualityReport {
  score: number;
  metrics: BibliometricQualityMetric[];
  issues: string[];
  recommendations: string[];
}

export interface BibliometricWritingPreparation {
  suggestedTitle: string;
  methodsOutline: string[];
  resultsOutline: string[];
  discussionAngles: string[];
  requiredSupplementaryData: string[];
  exportableArtifacts: string[];
  limitations: string[];
}

export interface BibliometricReadinessItem {
  id: string;
  label: string;
  status: 'ready' | 'partial' | 'missing';
  message: string;
}

export interface BibliometricAnalysis {
  generatedAt: string;
  summary: BibliometricSummary;
  keywordTagSource: BibliometricKeywordTagSource;
  readiness: BibliometricReadinessItem[];
  yearTrend: BibliometricYearTrendItem[];
  topJournals: BibliometricRankItem[];
  topAuthors: BibliometricRankItem[];
  topKeywords: BibliometricRankItem[];
  documentTypes: BibliometricRankItem[];
  sources: BibliometricRankItem[];
  dataQuality: BibliometricQualityMetric[];
  keywordNetwork: BibliometricNetwork;
  authorNetwork: BibliometricNetwork;
  topicClusters: BibliometricTopicCluster[];
  keywordBursts: BibliometricKeywordBurst[];
  keywordYearTrends: BibliometricKeywordTrendSeries[];
  topicEvolution: BibliometricTopicEvolutionPeriod[];
  literatureSimilarityNetwork: BibliometricNetwork;
  highImpactLiteratures: BibliometricHighImpactLiterature[];
  coCitationNetwork: BibliometricNetwork;
  bibliographicCouplingNetwork: BibliometricNetwork;
  institutionNetwork: BibliometricNetwork;
  countryNetwork: BibliometricNetwork;
  journalQuality: BibliometricJournalQuality;
  retrievalQuality: BibliometricRetrievalQualityReport;
  writingPreparation: BibliometricWritingPreparation;
}

export interface BibliometricAnalysisOptions {
  topN?: number;
  keywordNodeLimit?: number;
  authorNodeLimit?: number;
  edgeLimit?: number;
  similarityNodeLimit?: number;
  similarityEdgeLimit?: number;
  keywordTrendLimit?: number;
  useMergedKeywordTags?: boolean;
  outerTags?: OuterTagsConfig;
}

interface NormalizedPaper {
  id: string;
  title: string;
  year: number | null;
  journal: string;
  authors: string[];
  keywords: string[];
  documentType: string;
  source: string;
  doi: string;
  abstract: string;
  embedding: number[];
  hasEmbedding: boolean;
  citationCount: number | null;
  references: string[];
  institutions: string[];
  countries: string[];
  journalQuartile: string;
  casZone: string;
  sourceLevel: string;
  impactFactor: number | null;
}

interface KeywordInfo {
  label: string;
  count: number;
}

interface KeywordTagContext {
  useMergedTags: boolean;
  mergedTags: Array<{
    name: string;
    originalKeywords: Set<string>;
    literatureIds: Set<string>;
  }>;
  mergedOriginalKeywords: Set<string>;
  mergedTagNames: Set<string>;
  promotedTags: Set<string>;
}

const UNKNOWN_LABEL = '未解析';

export function analyzeBibliometrics(
  papers: LiteratureRecord[],
  options: BibliometricAnalysisOptions = {}
): BibliometricAnalysis {
  const topN = clampInteger(options.topN, 20, 5, 100);
  const keywordNodeLimit = clampInteger(options.keywordNodeLimit, 80, 20, 180);
  const authorNodeLimit = clampInteger(options.authorNodeLimit, 60, 20, 160);
  const edgeLimit = clampInteger(options.edgeLimit, 180, 40, 500);
  const similarityNodeLimit = clampInteger(options.similarityNodeLimit, 80, 20, 160);
  const similarityEdgeLimit = clampInteger(options.similarityEdgeLimit, 180, 40, 500);
  const keywordTrendLimit = clampInteger(options.keywordTrendLimit, 8, 3, 20);
  const keywordTagContext = buildKeywordTagContext(options.outerTags, options.useMergedKeywordTags !== false);
  const normalized = papers.map(paper => normalizePaper(paper, keywordTagContext)).filter(paper => paper.title || paper.doi);
  const total = normalized.length;

  const years = normalized.map(paper => paper.year).filter((year): year is number => typeof year === 'number');
  const journalCounts = countValues(normalized.map(paper => paper.journal || UNKNOWN_LABEL));
  const authorCounts = countValues(normalized.flatMap(paper => paper.authors));
  const keywordCounts = countValues(normalized.flatMap(paper => paper.keywords));
  const documentTypeCounts = countValues(normalized.map(paper => paper.documentType || UNKNOWN_LABEL));
  const sourceCounts = countValues(normalized.map(paper => paper.source || UNKNOWN_LABEL));
  const institutionCounts = countValues(normalized.flatMap(paper => paper.institutions));
  const countryCounts = countValues(normalized.flatMap(paper => paper.countries));
  const keywordInfo = buildKeywordInfo(normalized);
  const keywordNetwork = buildCooccurrenceNetwork(normalized, 'keyword', keywordCounts, keywordInfo, keywordNodeLimit, edgeLimit);
  const authorNetwork = buildCooccurrenceNetwork(normalized, 'author', authorCounts, new Map(), authorNodeLimit, edgeLimit);
  const institutionNetwork = buildCooccurrenceNetwork(normalized, 'institution', institutionCounts, new Map(), 80, edgeLimit);
  const countryNetwork = buildCooccurrenceNetwork(normalized, 'country', countryCounts, new Map(), 80, edgeLimit);
  const topicClusters = buildTopicClusters(normalized, keywordNetwork, keywordInfo);
  const coCitationNetwork = buildCoCitationNetwork(normalized, 120, edgeLimit);
  const bibliographicCouplingNetwork = buildBibliographicCouplingNetwork(normalized, 120, edgeLimit);
  const literatureSimilarityNetwork = buildLiteratureSimilarityNetwork(normalized, similarityNodeLimit, similarityEdgeLimit);
  const highImpactLiteratures = buildHighImpactLiteratures(normalized, topN);

  const summary: BibliometricSummary = {
    total,
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
    journalCount: Array.from(journalCounts.keys()).filter(item => item !== UNKNOWN_LABEL).length,
    authorCount: Array.from(authorCounts.keys()).filter(item => item !== UNKNOWN_LABEL).length,
    keywordCount: Array.from(keywordCounts.keys()).filter(item => item !== UNKNOWN_LABEL).length,
    doiCount: normalized.filter(paper => paper.doi).length,
    abstractCount: normalized.filter(paper => paper.abstract).length,
    embeddingCount: normalized.filter(paper => paper.hasEmbedding).length,
    citedCount: normalized.filter(paper => paper.citationCount !== null).length,
    referenceCount: normalized.filter(paper => paper.references.length > 0).length,
    institutionCount: Array.from(institutionCounts.keys()).filter(item => item !== UNKNOWN_LABEL).length,
    countryCount: Array.from(countryCounts.keys()).filter(item => item !== UNKNOWN_LABEL).length,
    mergedKeywordTagCount: keywordTagContext.mergedTags.length,
    promotedKeywordTagCount: keywordTagContext.promotedTags.size,
  };
  const keywordTagSource = buildKeywordTagSource(keywordTagContext, normalized);
  const dataQuality = [
    qualityMetric('doi', '带 DOI', summary.doiCount, total),
    qualityMetric('abstract', '带摘要', summary.abstractCount, total),
    qualityMetric('keywords', '带关键词', normalized.filter(paper => paper.keywords.length > 0).length, total),
    qualityMetric('embedding', '带 embedding（可选）', summary.embeddingCount, total),
    qualityMetric('year', '带年份', years.length, total),
    qualityMetric('citations', '带被引次数', summary.citedCount, total),
    qualityMetric('references', '带参考文献列表', summary.referenceCount, total),
    qualityMetric('institutions', '带机构字段', normalized.filter(paper => paper.institutions.length > 0).length, total),
    qualityMetric('journalQuality', '带期刊质量字段', normalized.filter(paper => paper.journalQuartile || paper.casZone || paper.sourceLevel || paper.impactFactor !== null).length, total),
  ];
  const journalQuality = buildJournalQuality(normalized, total);
  const retrievalQuality = buildRetrievalQualityReport(summary, dataQuality, normalized, journalCounts);
  const readiness = buildReadiness(summary, literatureSimilarityNetwork, coCitationNetwork, bibliographicCouplingNetwork, institutionNetwork, journalQuality);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    keywordTagSource,
    readiness,
    yearTrend: buildYearTrend(years),
    topJournals: toRankItems(journalCounts, total, topN),
    topAuthors: toRankItems(authorCounts, total, topN),
    topKeywords: toRankItems(keywordCounts, total, topN),
    documentTypes: toRankItems(documentTypeCounts, total, topN),
    sources: toRankItems(sourceCounts, total, topN),
    dataQuality,
    keywordNetwork,
    authorNetwork,
    topicClusters,
    keywordBursts: buildKeywordBursts(normalized, keywordInfo, topN),
    keywordYearTrends: buildKeywordYearTrends(normalized, keywordInfo, keywordCounts, keywordTrendLimit),
    topicEvolution: buildTopicEvolution(normalized, topN),
    literatureSimilarityNetwork,
    highImpactLiteratures,
    coCitationNetwork,
    bibliographicCouplingNetwork,
    institutionNetwork,
    countryNetwork,
    journalQuality,
    retrievalQuality,
    writingPreparation: buildWritingPreparation(summary, topicClusters, retrievalQuality, readiness),
  };
}

function normalizePaper(paper: LiteratureRecord, keywordTagContext: KeywordTagContext): NormalizedPaper {
  const title = cleanText(paper.title);
  const doi = cleanText(paper.doi);
  return {
    id: cleanText(paper.id) || doi || title,
    title,
    year: parseYear(paper.year),
    journal: cleanText(paper.journal) || UNKNOWN_LABEL,
    authors: normalizeAuthors(paper),
    keywords: normalizeKeywords(paper, keywordTagContext),
    documentType: cleanText(paper.documentType) || UNKNOWN_LABEL,
    source: normalizeSource(paper.source),
    doi,
    abstract: cleanText(paper.abstract),
    embedding: Array.isArray(paper.embedding) ? paper.embedding.filter(value => Number.isFinite(value)) : [],
    hasEmbedding: Array.isArray(paper.embedding) && paper.embedding.length > 0,
    citationCount: parseCitationCount(paper),
    references: normalizeReferences(paper),
    institutions: normalizeInstitutions(paper),
    countries: normalizeCountries(paper),
    journalQuartile: normalizeJournalQuartile(firstExistingValue(paper, ['quartile', 'jcrQuartile', 'jcr_quartile', 'journalQuartile', 'journal_quartile'])),
    casZone: normalizeCasZone(firstExistingValue(paper, ['casZone', 'cas_zone', '中科院分区', 'zone'])),
    sourceLevel: cleanText(firstExistingValue(paper, ['sourceLevel', 'source_level', 'sourceQuality', 'source_quality', '来源等级', '来源质量', '核心类别'])),
    impactFactor: parseNumberLike(firstExistingValue(paper, ['impactFactor', 'impact_factor', 'if', 'journalImpactFactor', 'journal_impact_factor'])),
  };
}

function buildKeywordTagContext(config: OuterTagsConfig | undefined, useMergedTags: boolean): KeywordTagContext {
  const mergedTags = (config?.mergedTags || [])
    .map(tag => ({
      name: cleanKeyword(tag.name),
      originalKeywords: new Set(splitKeywordInput(tag.originalKeywords).map(item => normalizeKey(cleanKeyword(item))).filter(Boolean)),
      literatureIds: new Set((tag.literatureIds || []).map(item => cleanText(item)).filter(Boolean)),
    }))
    .filter(tag => tag.name && tag.originalKeywords.size > 0);
  const promotedTags = new Set(splitKeywordInput(config?.promotedTags || []).map(item => normalizeKey(cleanKeyword(item))).filter(Boolean));
  const mergedOriginalKeywords = new Set<string>();
  const mergedTagNames = new Set<string>();

  for (const tag of mergedTags) {
    mergedTagNames.add(normalizeKey(tag.name));
    tag.originalKeywords.forEach(keyword => mergedOriginalKeywords.add(keyword));
  }

  return {
    useMergedTags: useMergedTags && mergedTags.length > 0,
    mergedTags,
    mergedOriginalKeywords,
    mergedTagNames,
    promotedTags,
  };
}

function buildKeywordTagSource(context: KeywordTagContext, papers: NormalizedPaper[]): BibliometricKeywordTagSource {
  const mergedTaggedLiteratureCount = context.useMergedTags
    ? papers.filter(paper => paper.keywords.some(keyword => context.mergedTagNames.has(normalizeKey(keyword)))).length
    : 0;
  return {
    mode: context.useMergedTags ? 'merged-tags' : 'raw-keywords',
    mergedTagCount: context.mergedTags.length,
    promotedTagCount: context.promotedTags.size,
    mergedTaggedLiteratureCount,
    note: context.useMergedTags
      ? '已使用合并关键词标签进行计量统计；原始同义词会归并到用户维护的主标签。'
      : '计量分析使用文献原始关键词、Keywords Plus、学科分类和研究方向字段；不依赖 embedding 文献库。',
  };
}

function getPaperIdentity(paper: LiteratureRecord): string {
  return cleanText(paper.id) || cleanText(paper.doi) || cleanText(paper.title);
}

function normalizeAuthors(paper: LiteratureRecord): string[] {
  const fromArray = Array.isArray(paper.authors)
    ? paper.authors
        .map(author => typeof author === 'string' ? author : cleanText(author?.name))
        .map(cleanAuthor)
        .filter(Boolean)
    : [];
  if (fromArray.length > 0) return uniqueStrings(fromArray);

  const raw = cleanText(paper.author);
  if (!raw) return [UNKNOWN_LABEL];
  const delimiter = raw.includes(';') || raw.includes('；') ? /[;；]/ : /\s+\band\b\s+|\s+&\s+/i;
  const authors = raw
    .split(delimiter)
    .map(cleanAuthor)
    .filter(Boolean);
  return authors.length ? uniqueStrings(authors) : [raw];
}

function normalizeKeywords(paper: LiteratureRecord, context: KeywordTagContext): string[] {
  const rawKeywords = getPaperKeywords(paper)
    .flatMap(item => splitKeywordInput(item))
    .map(cleanKeyword)
    .filter(keyword => keyword && keyword.length <= 90);
  const uniqueRawKeywords = uniqueStrings(rawKeywords);
  if (!context.useMergedTags || context.mergedTags.length === 0) return uniqueRawKeywords;

  const rawKeywordKeys = new Set(uniqueRawKeywords.map(normalizeKey));
  const paperId = getPaperIdentity(paper);
  const mergedLabels: string[] = [];
  const matchedOriginalKeys = new Set<string>();

  for (const tag of context.mergedTags) {
    const matchedById = !!paperId && tag.literatureIds.has(paperId);
    const matchedByKeyword = Array.from(tag.originalKeywords).some(originalKeyword =>
      rawKeywordKeys.has(originalKeyword) ||
      Array.from(rawKeywordKeys).some(rawKeyword =>
        rawKeyword.includes(originalKeyword) || originalKeyword.includes(rawKeyword)
      )
    );

    if (matchedById || matchedByKeyword) {
      mergedLabels.push(tag.name);
      tag.originalKeywords.forEach(keyword => matchedOriginalKeys.add(keyword));
    }
  }

  const passthroughKeywords = uniqueRawKeywords.filter(keyword => {
    const key = normalizeKey(keyword);
    return !matchedOriginalKeys.has(key) && !context.mergedOriginalKeywords.has(key);
  });

  return uniqueStrings([...mergedLabels, ...passthroughKeywords]);
}

function normalizeSource(value: unknown): string {
  const source = cleanText(value);
  if (!source) return UNKNOWN_LABEL;
  if (/\.ris$/i.test(source)) return 'RIS';
  if (/\.bib$/i.test(source)) return 'BibTeX';
  if (/\.txt$/i.test(source)) return 'TXT';
  if (/cnki/i.test(source)) return 'CNKI';
  if (/wos|web of science/i.test(source)) return 'WoS';
  return source;
}

function normalizeReferences(paper: LiteratureRecord): string[] {
  const raw = firstExistingValue(paper, ['references', 'referenceList', 'citedReferences', 'cited_references', 'CR', 'refs']);
  const fromRawData = parseReferencesFromRawData(paper.rawData);
  return uniqueStrings([
    ...splitReferenceInput(raw),
    ...fromRawData,
  ]).slice(0, 500);
}

function splitReferenceInput(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(splitReferenceInput);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return [cleanReferenceText(record.raw || record.reference || record.citation || record.title || JSON.stringify(record))].filter(Boolean);
  }
  return String(value)
    .split(/\n(?=\s*(?:[A-Z][A-Za-z'’-]+,|\[\d+\]|\d+\.|10\.))/)
    .flatMap(item => item.split(/\s*\|\|\s*/))
    .map(cleanReferenceText)
    .filter(Boolean);
}

function parseReferencesFromRawData(rawData: unknown): string[] {
  if (!rawData) return [];
  try {
    const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    if (!parsed || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;
    return splitReferenceInput(record.CR || record.references || record.citedReferences || record.cited_references);
  } catch {
    return [];
  }
}

function normalizeInstitutions(paper: LiteratureRecord): string[] {
  const values = [
    firstExistingValue(paper, ['institutions', 'institution', 'affiliations', 'affiliation', 'organizations', 'C1', 'AD']),
  ];
  return uniqueStrings(values.flatMap(splitAffiliationInput).map(cleanInstitution).filter(Boolean)).slice(0, 80);
}

function normalizeCountries(paper: LiteratureRecord): string[] {
  const explicit = firstExistingValue(paper, ['countries', 'country', 'nation', 'regions']);
  const countries = splitAffiliationInput(explicit).map(cleanCountry).filter(Boolean);
  if (countries.length) return uniqueStrings(countries);
  return uniqueStrings(splitAffiliationInput(firstExistingValue(paper, ['affiliations', 'affiliation', 'C1', 'AD']))
    .map(extractCountryFromAffiliation)
    .filter(Boolean));
}

function splitAffiliationInput(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(splitAffiliationInput);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return splitAffiliationInput(record.name || record.affiliation || record.organization || record.country || JSON.stringify(record));
  }
  return String(value)
    .split(/[;；]|\n/)
    .map(item => item.trim())
    .filter(Boolean);
}

function parseCitationCount(paper: LiteratureRecord): number | null {
  const value = firstExistingValue(paper, [
    'citationCount',
    'citation_count',
    'citedByCount',
    'cited_by_count',
    'timesCited',
    'times_cited',
    'TC',
    'Z9',
    '被引频次',
  ]);
  return parseNumberLike(value);
}

function firstExistingValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && cleanText(record[key])) return record[key];
  }
  return undefined;
}

function parseYear(value: unknown): number | null {
  const match = String(value ?? '').match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) ? year : null;
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    const label = cleanText(value) || UNKNOWN_LABEL;
    const key = normalizeKey(label);
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      if (existing.label === existing.label.toLowerCase() && label !== label.toLowerCase()) {
        existing.label = label;
      }
    } else {
      counts.set(key, { label, count: 1 });
    }
  }
  return new Map(Array.from(counts.values()).map(item => [item.label, item.count]));
}

function toRankItems(counts: Map<string, number>, total: number, limit: number): BibliometricRankItem[] {
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit)
    .map(([label, count]) => ({
      label,
      count,
      percentage: total > 0 ? roundPercent(count / total) : 0,
    }));
}

function buildYearTrend(years: number[]): BibliometricYearTrendItem[] {
  const counts = new Map<number, number>();
  for (const year of years) counts.set(year, (counts.get(year) || 0) + 1);
  let cumulative = 0;
  return Array.from(counts.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, count]) => {
      cumulative += count;
      return { year, count, cumulative };
    });
}

function buildKeywordInfo(papers: NormalizedPaper[]): Map<string, KeywordInfo> {
  const info = new Map<string, KeywordInfo>();
  for (const paper of papers) {
    for (const keyword of paper.keywords) {
      const key = normalizeKey(keyword);
      const existing = info.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        info.set(key, { label: keyword, count: 1 });
      }
    }
  }
  return info;
}

function buildCooccurrenceNetwork(
  papers: NormalizedPaper[],
  kind: 'keyword' | 'author' | 'institution' | 'country',
  counts: Map<string, number>,
  keywordInfo: Map<string, KeywordInfo>,
  nodeLimit: number,
  edgeLimit: number
): BibliometricNetwork {
  const rankedLabels = Array.from(counts.entries())
    .filter(([label]) => label !== UNKNOWN_LABEL)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, nodeLimit)
    .map(([label]) => label);
  const allowed = new Set(rankedLabels.map(normalizeKey));
  const edgeCounts = new Map<string, number>();

  for (const paper of papers) {
    const rawItems = getNetworkItems(paper, kind);
    const items = uniqueStrings(rawItems)
      .map(label => ({ label, key: normalizeKey(label) }))
      .filter(item => item.key && allowed.has(item.key));
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const pair = [items[i].key, items[j].key].sort();
        const edgeKey = `${pair[0]}||${pair[1]}`;
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
      }
    }
  }

  const nodes: BibliometricNetworkNode[] = rankedLabels.map(label => {
    const key = normalizeKey(label);
    const display = kind === 'keyword' ? (keywordInfo.get(key)?.label || label) : label;
    return {
      id: key,
      label: display,
      kind,
      value: counts.get(label) || keywordInfo.get(key)?.count || 0,
    };
  });

  const edges: BibliometricNetworkEdge[] = Array.from(edgeCounts.entries())
    .map(([key, weight]) => {
      const [source, target] = key.split('||');
      return { source, target, weight };
    })
    .sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source))
    .slice(0, edgeLimit);

  const connected = new Set<string>();
  edges.forEach(edge => {
    connected.add(edge.source);
    connected.add(edge.target);
  });

  return {
    nodes: nodes.filter(node => connected.has(node.id) || node.value > 1).slice(0, nodeLimit),
    edges,
  };
}

function getNetworkItems(paper: NormalizedPaper, kind: 'keyword' | 'author' | 'institution' | 'country'): string[] {
  if (kind === 'keyword') return paper.keywords;
  if (kind === 'author') return paper.authors;
  if (kind === 'institution') return paper.institutions;
  return paper.countries;
}

function buildTopicClusters(
  papers: NormalizedPaper[],
  network: BibliometricNetwork,
  keywordInfo: Map<string, KeywordInfo>
): BibliometricTopicCluster[] {
  const adjacency = new Map<string, Set<string>>();
  network.nodes.forEach(node => adjacency.set(node.id, new Set()));
  network.edges.forEach(edge => {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) return;
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  });

  const visited = new Set<string>();
  const clusters: string[][] = [];
  for (const node of network.nodes) {
    if (visited.has(node.id)) continue;
    const stack = [node.id];
    const component: string[] = [];
    visited.add(node.id);
    while (stack.length > 0) {
      const current = stack.pop() as string;
      component.push(current);
      for (const next of adjacency.get(current) || []) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }
    if (component.length > 1) clusters.push(component);
  }

  return clusters
    .map((component, index) => {
      const ranked = component
        .map(key => ({
          key,
          label: keywordInfo.get(key)?.label || key,
          count: keywordInfo.get(key)?.count || 0,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-CN'));
      const componentKeys = new Set(component);
      const matchedPapers = papers.filter(paper => paper.keywords.some(keyword => componentKeys.has(normalizeKey(keyword))));
      return {
        id: `cluster_${index + 1}`,
        label: ranked.slice(0, 3).map(item => item.label).join(' / '),
        size: component.length,
        literatureCount: matchedPapers.length,
        keywords: ranked.slice(0, 12).map(item => item.label),
        sampleTitles: matchedPapers.slice(0, 5).map(paper => paper.title).filter(Boolean),
      };
    })
    .sort((a, b) => b.literatureCount - a.literatureCount || b.size - a.size)
    .slice(0, 12);
}

function buildKeywordBursts(
  papers: NormalizedPaper[],
  keywordInfo: Map<string, KeywordInfo>,
  limit: number
): BibliometricKeywordBurst[] {
  const years = uniqueNumbers(papers.map(paper => paper.year).filter((year): year is number => typeof year === 'number')).sort((a, b) => a - b);
  if (years.length < 3) return [];
  const recentStartIndex = Math.max(0, Math.floor(years.length * 0.62));
  const recentYears = new Set(years.slice(recentStartIndex));
  const baselineYears = new Set(years.slice(0, recentStartIndex));
  const keywordYearCounts = new Map<string, Map<number, number>>();
  for (const paper of papers) {
    if (!paper.year) continue;
    for (const keyword of paper.keywords) {
      const key = normalizeKey(keyword);
      if (!keywordYearCounts.has(key)) keywordYearCounts.set(key, new Map());
      const counts = keywordYearCounts.get(key) as Map<number, number>;
      counts.set(paper.year, (counts.get(paper.year) || 0) + 1);
    }
  }

  return Array.from(keywordYearCounts.entries())
    .map(([key, counts]) => {
      const baselineCount = Array.from(baselineYears).reduce((sum, year) => sum + (counts.get(year) || 0), 0);
      const recentCount = Array.from(recentYears).reduce((sum, year) => sum + (counts.get(year) || 0), 0);
      const baselineRate = baselineYears.size ? baselineCount / baselineYears.size : 0;
      const recentRate = recentYears.size ? recentCount / recentYears.size : 0;
      const peak = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
      return {
        keyword: keywordInfo.get(key)?.label || key,
        score: Math.round(((recentRate + 0.25) / (baselineRate + 0.25) - 1) * Math.log1p(recentCount + baselineCount) * 100) / 100,
        baselineCount,
        recentCount,
        peakYear: peak ? peak[0] : null,
        activeYears: Array.from(counts.keys()).sort((a, b) => a - b),
      };
    })
    .filter(item => item.recentCount >= 1 && item.score > 0)
    .sort((a, b) => b.score - a.score || b.recentCount - a.recentCount)
    .slice(0, limit);
}

function buildKeywordYearTrends(
  papers: NormalizedPaper[],
  keywordInfo: Map<string, KeywordInfo>,
  keywordCounts: Map<string, number>,
  limit: number
): BibliometricKeywordTrendSeries[] {
  const years = uniqueNumbers(papers.map(paper => paper.year).filter((year): year is number => typeof year === 'number')).sort((a, b) => a - b);
  if (years.length === 0) return [];

  const yearTotals = new Map<number, number>();
  for (const paper of papers) {
    if (paper.year !== null) yearTotals.set(paper.year, (yearTotals.get(paper.year) || 0) + 1);
  }

  const topKeywordKeys = Array.from(keywordCounts.entries())
    .filter(([label]) => label !== UNKNOWN_LABEL)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .slice(0, limit)
    .map(([label]) => normalizeKey(label));

  const keywordYearCounts = new Map<string, Map<number, number>>();
  for (const paper of papers) {
    if (paper.year === null) continue;
    const seenInPaper = new Set<string>();
    for (const keyword of paper.keywords) {
      const key = normalizeKey(keyword);
      if (!topKeywordKeys.includes(key) || seenInPaper.has(key)) continue;
      seenInPaper.add(key);
      if (!keywordYearCounts.has(key)) keywordYearCounts.set(key, new Map());
      const counts = keywordYearCounts.get(key) as Map<number, number>;
      counts.set(paper.year, (counts.get(paper.year) || 0) + 1);
    }
  }

  return topKeywordKeys.map(key => {
    const counts = keywordYearCounts.get(key) || new Map<number, number>();
    const points = years.map(year => {
      const count = counts.get(year) || 0;
      const total = yearTotals.get(year) || 0;
      return {
        year,
        count,
        percentage: total > 0 ? roundPercent(count / total) : 0,
      };
    });
    const peak = points.slice().sort((a, b) => b.count - a.count || b.percentage - a.percentage || b.year - a.year)[0];
    return {
      keyword: keywordInfo.get(key)?.label || key,
      total: points.reduce((sum, point) => sum + point.count, 0),
      peakYear: peak && peak.count > 0 ? peak.year : null,
      points,
    };
  }).filter(series => series.total > 0);
}

function buildTopicEvolution(papers: NormalizedPaper[], limit: number): BibliometricTopicEvolutionPeriod[] {
  const years = uniqueNumbers(papers.map(paper => paper.year).filter((year): year is number => typeof year === 'number')).sort((a, b) => a - b);
  if (years.length === 0) return [];
  const periods = buildYearPeriods(years);
  return periods.map(period => {
    const periodPapers = papers.filter(paper => paper.year !== null && paper.year >= period.startYear && paper.year <= period.endYear);
    const keywordCounts = countValues(periodPapers.flatMap(paper => paper.keywords));
    const journalCounts = countValues(periodPapers.map(paper => paper.journal));
    return {
      period: period.startYear === period.endYear ? String(period.startYear) : `${period.startYear}-${period.endYear}`,
      startYear: period.startYear,
      endYear: period.endYear,
      literatureCount: periodPapers.length,
      topKeywords: toRankItems(keywordCounts, Math.max(1, periodPapers.length), Math.min(12, limit)),
      leadingJournals: toRankItems(journalCounts, Math.max(1, periodPapers.length), 6),
      representativeTitles: periodPapers.slice(0, 6).map(paper => paper.title).filter(Boolean),
    };
  });
}

function buildYearPeriods(years: number[]): Array<{ startYear: number; endYear: number }> {
  const min = Math.min(...years);
  const max = Math.max(...years);
  if (max === min) return [{ startYear: min, endYear: max }];
  const span = max - min + 1;
  const bucketSize = Math.max(1, Math.ceil(span / 4));
  const periods: Array<{ startYear: number; endYear: number }> = [];
  for (let start = min; start <= max; start += bucketSize) {
    periods.push({ startYear: start, endYear: Math.min(max, start + bucketSize - 1) });
  }
  return periods;
}

function buildLiteratureSimilarityNetwork(
  papers: NormalizedPaper[],
  nodeLimit: number,
  edgeLimit: number
): BibliometricNetwork {
  const candidates = papers.filter(paper => paper.embedding.length > 0).slice(0, Math.max(nodeLimit, 20));
  if (candidates.length < 2) return { nodes: [], edges: [] };
  const edges: BibliometricNetworkEdge[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const sim = cosineSimilarity(candidates[i].embedding, candidates[j].embedding);
      if (sim >= 0.74) {
        edges.push({
          source: candidates[i].id,
          target: candidates[j].id,
          weight: Math.round(sim * 1000) / 1000,
          meta: { similarity: sim },
        });
      }
    }
  }
  const topEdges = edges.sort((a, b) => b.weight - a.weight).slice(0, edgeLimit);
  const connected = new Set<string>();
  topEdges.forEach(edge => {
    connected.add(edge.source);
    connected.add(edge.target);
  });
  const ranked = candidates
    .filter(paper => connected.has(paper.id))
    .slice(0, nodeLimit);
  return {
    nodes: ranked.map(paper => ({
      id: paper.id,
      label: paper.title || paper.doi || paper.id,
      kind: 'literature',
      value: paper.citationCount || paper.keywords.length || 1,
      meta: {
        year: paper.year,
        journal: paper.journal,
        doi: paper.doi,
        authors: paper.authors.join('; '),
      },
    })),
    edges: topEdges.filter(edge => connected.has(edge.source) && connected.has(edge.target)),
  };
}

function buildHighImpactLiteratures(papers: NormalizedPaper[], limit: number): BibliometricHighImpactLiterature[] {
  const maxCitation = Math.max(1, ...papers.map(paper => paper.citationCount || 0));
  return papers
    .map(paper => {
      const citationPart = paper.citationCount !== null ? paper.citationCount / maxCitation : 0;
      const evidencePart = (paper.doi ? 0.15 : 0) + (paper.abstract ? 0.1 : 0) + Math.min(0.25, paper.keywords.length * 0.025);
      const recencyPart = paper.year ? Math.max(0, Math.min(0.2, (paper.year - 2000) / 130)) : 0;
      return {
        id: paper.id,
        title: paper.title,
        authors: paper.authors.join('; '),
        year: paper.year,
        journal: paper.journal,
        doi: paper.doi,
        citationCount: paper.citationCount,
        influenceScore: Math.round((citationPart * 0.65 + evidencePart + recencyPart) * 1000) / 10,
        hasCitationData: paper.citationCount !== null,
      };
    })
    .sort((a, b) => b.influenceScore - a.influenceScore || (b.citationCount || 0) - (a.citationCount || 0))
    .slice(0, limit);
}

function buildCoCitationNetwork(papers: NormalizedPaper[], nodeLimit: number, edgeLimit: number): BibliometricNetwork {
  const referenceCounts = countValues(papers.flatMap(paper => paper.references));
  const rankedRefs = Array.from(referenceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, nodeLimit)
    .map(([ref]) => ref);
  const allowed = new Set(rankedRefs.map(normalizeKey));
  const edgeCounts = new Map<string, number>();
  for (const paper of papers) {
    const refs = uniqueStrings(paper.references).map(ref => ({ label: ref, key: normalizeKey(ref) })).filter(ref => allowed.has(ref.key));
    for (let i = 0; i < refs.length; i += 1) {
      for (let j = i + 1; j < refs.length; j += 1) {
        const pair = [refs[i].key, refs[j].key].sort();
        const edgeKey = `${pair[0]}||${pair[1]}`;
        edgeCounts.set(edgeKey, (edgeCounts.get(edgeKey) || 0) + 1);
      }
    }
  }
  const nodes = rankedRefs.map(ref => ({
    id: normalizeKey(ref),
    label: shortenReference(ref),
    kind: 'reference' as const,
    value: referenceCounts.get(ref) || 1,
  }));
  const edges = Array.from(edgeCounts.entries())
    .map(([key, weight]) => {
      const [source, target] = key.split('||');
      return { source, target, weight };
    })
    .filter(edge => edge.weight > 1)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, edgeLimit);
  const connected = new Set<string>();
  edges.forEach(edge => {
    connected.add(edge.source);
    connected.add(edge.target);
  });
  return {
    nodes: nodes.filter(node => connected.has(node.id) || node.value > 1),
    edges,
  };
}

function buildBibliographicCouplingNetwork(papers: NormalizedPaper[], nodeLimit: number, edgeLimit: number): BibliometricNetwork {
  const candidates = papers.filter(paper => paper.references.length > 0).slice(0, nodeLimit);
  if (candidates.length < 2) return { nodes: [], edges: [] };
  const refSets = new Map(candidates.map(paper => [paper.id, new Set(paper.references.map(normalizeKey))]));
  const edges: BibliometricNetworkEdge[] = [];
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const a = refSets.get(candidates[i].id) as Set<string>;
      const b = refSets.get(candidates[j].id) as Set<string>;
      let shared = 0;
      a.forEach(ref => {
        if (b.has(ref)) shared += 1;
      });
      if (shared > 0) {
        edges.push({ source: candidates[i].id, target: candidates[j].id, weight: shared });
      }
    }
  }
  const topEdges = edges.sort((a, b) => b.weight - a.weight).slice(0, edgeLimit);
  const connected = new Set<string>();
  topEdges.forEach(edge => {
    connected.add(edge.source);
    connected.add(edge.target);
  });
  return {
    nodes: candidates.filter(paper => connected.has(paper.id)).map(paper => ({
      id: paper.id,
      label: paper.title || paper.id,
      kind: 'literature',
      value: paper.references.length,
      meta: { year: paper.year, journal: paper.journal, doi: paper.doi },
    })),
    edges: topEdges,
  };
}

function buildJournalQuality(papers: NormalizedPaper[], total: number): BibliometricJournalQuality {
  const quartiles = countValues(papers.map(paper => paper.journalQuartile).filter(Boolean));
  const casZones = countValues(papers.map(paper => paper.casZone).filter(Boolean));
  const sourceLevels = countValues(papers.map(paper => paper.sourceLevel).filter(Boolean));
  const impactByJournal = new Map<string, { sum: number; count: number; paperCount: number }>();
  papers.forEach(paper => {
    if (!paper.journal || paper.impactFactor === null) return;
    const item = impactByJournal.get(paper.journal) || { sum: 0, count: 0, paperCount: 0 };
    item.sum += paper.impactFactor;
    item.count += 1;
    item.paperCount += 1;
    impactByJournal.set(paper.journal, item);
  });
  const qualityCount = papers.filter(paper => paper.journalQuartile || paper.casZone || paper.sourceLevel || paper.impactFactor !== null).length;
  return {
    coverage: [
      qualityMetric('quartile', 'JCR 分区字段', papers.filter(paper => paper.journalQuartile).length, total),
      qualityMetric('casZone', '中科院分区字段', papers.filter(paper => paper.casZone).length, total),
      qualityMetric('sourceLevel', '来源质量字段', papers.filter(paper => paper.sourceLevel).length, total),
      qualityMetric('impactFactor', '影响因子字段', papers.filter(paper => paper.impactFactor !== null).length, total),
    ],
    quartiles: toRankItems(quartiles, Math.max(1, qualityCount), 10),
    casZones: toRankItems(casZones, Math.max(1, qualityCount), 10),
    sourceLevels: toRankItems(sourceLevels, Math.max(1, qualityCount), 10),
    impactFactorAvailable: papers.filter(paper => paper.impactFactor !== null).length,
    topImpactFactorJournals: Array.from(impactByJournal.entries())
      .map(([journal, item]) => ({ journal, impactFactor: Math.round((item.sum / item.count) * 1000) / 1000, count: item.paperCount }))
      .sort((a, b) => b.impactFactor - a.impactFactor)
      .slice(0, 15),
    note: qualityCount > 0
      ? '已根据文献库中的期刊质量字段统计；若字段来自自定义表，请在方法部分说明来源。'
      : '当前文献库缺少 JCR 分区、中科院分区、来源质量或影响因子字段；可导入自定义期刊质量表后重新分析。',
  };
}

function buildRetrievalQualityReport(
  summary: BibliometricSummary,
  dataQuality: BibliometricQualityMetric[],
  papers: NormalizedPaper[],
  journalCounts: Map<string, number>
): BibliometricRetrievalQualityReport {
  const total = Math.max(1, summary.total);
  const metrics = [
    ...dataQuality,
    qualityMetric('journalConcentration', 'Top 3 期刊集中度', Array.from(journalCounts.values()).sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0), total),
  ];
  const score = Math.round((
    ratio(summary.abstractCount, total) * 22
    + ratio(summary.keywordCount, total) * 14
    + ratio(summary.doiCount, total) * 14
    + ratio(summary.referenceCount, total) * 20
    + ratio(summary.citedCount, total) * 14
    + ratio(summary.institutionCount, total) * 10
    + (papers.length >= 80 ? 6 : papers.length >= 30 ? 3 : 0)
  ));
  const issues: string[] = [];
  const recommendations: string[] = [];
  if (summary.total < 30) {
    issues.push('文献量偏少，计量网络和主题演化稳定性不足。');
    recommendations.push('扩大检索式或补充 WoS/Scopus/OpenAlex 记录，建议至少 80-150 篇用于正式计量论文。');
  }
  if (summary.referenceCount === 0) {
    issues.push('缺少参考文献列表，无法做严格共被引和文献耦合。');
    recommendations.push('导入 WoS Full Record and Cited References，或用 OpenAlex 批量补全 referenced works。');
  }
  if (summary.citedCount === 0) {
    issues.push('缺少被引次数，无法判断高影响文献。');
    recommendations.push('用 OpenAlex/Crossref/Semantic Scholar 补充 cited_by_count。');
  }
  if (summary.institutionCount === 0) {
    issues.push('缺少机构/国家字段，机构与国家合作网络不可用。');
    recommendations.push('优先导入带 C1/AD 字段的 WoS 记录，或从 OpenAlex authorships 补充机构和国家。');
  }
  if (recommendations.length === 0) {
    recommendations.push('当前数据可支撑基础文献计量分析；正式投稿前建议补充数据来源、筛选流程和参数说明。');
  }
  return { score: Math.min(100, score), metrics, issues, recommendations };
}

function buildReadiness(
  summary: BibliometricSummary,
  similarityNetwork: BibliometricNetwork,
  coCitationNetwork: BibliometricNetwork,
  couplingNetwork: BibliometricNetwork,
  institutionNetwork: BibliometricNetwork,
  journalQuality: BibliometricJournalQuality
): BibliometricReadinessItem[] {
  return [
    readinessItem('keywordBurst', '突现关键词分析', summary.keywordCount > 0 && summary.yearMin !== null, summary.keywordCount > 0 ? '可基于年份-关键词矩阵计算。' : '缺少年份或关键词。'),
    readinessItem('topicEvolution', '主题演化图', summary.keywordCount > 0 && summary.yearMin !== null, '按年份切片统计主题词和代表文献。'),
    readinessItem('similarityNetwork', '语义相似性网络（可选）', similarityNetwork.edges.length > 0, summary.embeddingCount > 1 ? '已基于 embedding 生成相似文献网络。' : '独立 WoS 计量学分析不依赖 embedding；可优先解释共被引和文献耦合。'),
    readinessItem('highImpact', '高影响文献识别', summary.citedCount > 0, summary.citedCount > 0 ? '已使用被引次数字段。' : '当前缺少被引次数，暂用结构化完整度排序。'),
    readinessItem('coCitation', '共被引分析', coCitationNetwork.edges.length > 0, summary.referenceCount > 0 ? '参考文献数量不足以形成稳定共被引边。' : '需要 cited references。'),
    readinessItem('coupling', '文献耦合分析', couplingNetwork.edges.length > 0, summary.referenceCount > 0 ? '已有共享参考文献边。' : '需要 cited references。'),
    readinessItem('collaboration', '机构/国家合作网络', institutionNetwork.edges.length > 0, summary.institutionCount > 0 ? '机构字段可用于合作网络。' : '需要 affiliation/C1/AD 字段。'),
    readinessItem('journalQuality', '期刊分区和来源质量', journalQuality.impactFactorAvailable > 0 || journalQuality.quartiles.length > 0 || journalQuality.casZones.length > 0 || journalQuality.sourceLevels.length > 0, journalQuality.note),
    readinessItem('retrievalQuality', '检索式质量报告', summary.total > 0, '已根据覆盖率、集中度和字段完整性生成。'),
    readinessItem('writingPrep', '计量学论文写作准备', summary.total > 0, '已生成方法、结果和补充数据清单。'),
  ];
}

function readinessItem(id: string, label: string, ready: boolean, message: string): BibliometricReadinessItem {
  return { id, label, status: ready ? 'ready' : 'missing', message };
}

function buildWritingPreparation(
  summary: BibliometricSummary,
  topicClusters: BibliometricTopicCluster[],
  retrievalQuality: BibliometricRetrievalQualityReport,
  readiness: BibliometricReadinessItem[]
): BibliometricWritingPreparation {
  const missing = readiness
    .filter(item => item.status !== 'ready' && item.id !== 'similarityNetwork')
    .map(item => item.label);
  return {
    suggestedTitle: '基于文献计量学的研究热点、主题演化与知识结构分析',
    methodsOutline: [
      '数据来源与检索式：说明数据库、检索日期、检索字段、纳入排除标准和去重规则。',
      '数据清洗：统一作者、期刊、关键词、年份、DOI、参考文献和机构字段。',
      '描述性统计：分析年度发文量、来源期刊、作者、关键词和文献类型。',
      '网络分析：构建关键词共现、作者合作、机构/国家合作、共被引和文献耦合网络；如另有 embedding，可补充语义相似性网络。',
      '演化分析：按年份切片识别突现关键词、主题演化和研究前沿。',
      '质量控制：报告 DOI、摘要、关键词、被引次数、参考文献和机构字段覆盖率。',
    ],
    resultsOutline: [
      '文献增长趋势与数据覆盖情况。',
      '核心期刊、核心作者和高频关键词分布。',
      `主要主题簇：${topicClusters.slice(0, 4).map(item => item.label).join('；') || '待形成主题簇'}。`,
      '关键词突现与主题演化揭示的研究前沿。',
      '高影响文献、共被引结构和文献耦合结构。',
      '作者、机构和国家合作格局。',
      '检索式质量与数据局限。',
    ],
    discussionAngles: [
      '从热点主题转移解释领域研究范式变化。',
      '比较关键词共现、共被引网络和文献耦合网络揭示的知识结构差异。',
      '讨论核心期刊和作者群体对研究方向的影响。',
      '指出数据源、语言、数据库覆盖和字段缺失可能造成的偏差。',
    ],
    requiredSupplementaryData: missing.length
      ? missing.map(item => `补齐：${item}`)
      : ['保留检索式、原始 RIS/WoS 文件、清洗脚本、网络边表和节点表。'],
    exportableArtifacts: [
      'bibliometrics.xlsx',
      'network.json',
      '关键词共现/作者合作/共被引/文献耦合网络图',
      '年度发文趋势和主题演化图',
      '计量学论文方法和结果框架',
    ],
    limitations: retrievalQuality.issues.length
      ? retrievalQuality.issues
      : ['自动计量分析依赖当前文献库字段，不等同于人工系统综述。'],
  };
}

function qualityMetric(id: string, label: string, count: number, total: number): BibliometricQualityMetric {
  return {
    id,
    label,
    count,
    percentage: total > 0 ? roundPercent(count / total) : 0,
  };
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanAuthor(value: unknown): string {
  return cleanText(value)
    .replace(/\s*\.$/, '')
    .replace(/\s+/g, ' ');
}

function cleanKeyword(value: unknown): string {
  return cleanText(value)
    .replace(/^\.+|\.+$/g, '')
    .replace(/\s+/g, ' ');
}

function cleanReferenceText(value: unknown): string {
  return cleanText(value)
    .replace(/^\[\d+\]\s*/, '')
    .replace(/^\d+\.\s*/, '')
    .slice(0, 400);
}

function cleanInstitution(value: unknown): string {
  return cleanText(value)
    .replace(/\[[^\]]+\]/g, '')
    .replace(/\b(department|dept\.?|school|faculty)\b.*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 140);
}

function cleanCountry(value: unknown): string {
  const text = cleanText(value).replace(/[.;,，。]+$/g, '');
  const map: Record<string, string> = {
    usa: 'USA',
    'united states': 'USA',
    'united states of america': 'USA',
    prc: 'China',
    'peoples r china': 'China',
    "people's republic of china": 'China',
    england: 'UK',
    'united kingdom': 'UK',
  };
  return map[text.toLowerCase()] || text;
}

function extractCountryFromAffiliation(value: unknown): string {
  const text = cleanText(value);
  if (!text) return '';
  const parts = text.split(',').map(part => part.trim()).filter(Boolean);
  return cleanCountry(parts[parts.length - 1] || '');
}

function normalizeJournalQuartile(value: unknown): string {
  const text = cleanText(value).toUpperCase();
  const match = text.match(/Q[1-4]/);
  return match ? match[0] : '';
}

function normalizeCasZone(value: unknown): string {
  const text = cleanText(value);
  const match = text.match(/[1-4一二三四]\s*区/);
  if (!match) return text;
  return match[0].replace(/\s+/g, '');
}

function normalizeKey(value: string): string {
  return cleanText(value).toLowerCase();
}

function shortenReference(value: string): string {
  const text = cleanReferenceText(value);
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = cleanText(value);
    const key = normalizeKey(text);
    if (!text || seen.has(key) || /^unknown|未解析$/i.test(text)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

function uniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values.filter(value => Number.isFinite(value))));
}

function roundPercent(value: number): number {
  return Math.round(value * 1000) / 10;
}

function clampInteger(value: unknown, defaultValue: number, min: number, max: number): number {
  const parsed = Math.floor(Number(value ?? defaultValue));
  if (!Number.isFinite(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}

function parseNumberLike(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const match = String(value).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const number = Number(match[0]);
  return Number.isFinite(number) ? number : null;
}

function ratio(count: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, count / total)) : 0;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
