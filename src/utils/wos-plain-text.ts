import * as crypto from 'crypto';
import type { LiteratureRecord } from '../literature/keyword-library';

export interface WosPlainTextDataset {
  id: string;
  sourceFileName: string;
  importedAt: string;
  records: WosPlainTextRecord[];
  authors: WosAuthorRow[];
  affiliations: WosAffiliationRow[];
  keywords: WosKeywordRow[];
  citedReferences: WosCitedReferenceRow[];
  quality: WosPlainTextQualityReport;
}

export interface WosPlainTextRecord {
  id: string;
  fields: Record<string, string[]>;
  sourceIndex: number;
  article: {
    uid: string;
    doi: string;
    title: string;
    abstract: string;
    sourceTitle: string;
    journalAbbreviation: string;
    issn: string;
    eissn: string;
    publicationYear: number | null;
    publicationDate: string;
    documentType: string;
    language: string;
    volume: string;
    issue: string;
    beginPage: string;
    endPage: string;
    articleNumber: string;
    pageCount: number | null;
    timesCited: number | null;
    usage180: number | null;
    usageSince2013: number | null;
    wosCategories: string[];
    researchAreas: string[];
    openAccess: string[];
    publisher: string;
    publisherCity: string;
    publisherAddress: string;
    reprintAddress: string;
    emails: string[];
  };
}

export interface WosAuthorRow {
  articleId: string;
  position: number;
  shortName: string;
  fullName: string;
  researcherId: string;
  orcid: string;
  isCorresponding: boolean;
}

export interface WosAffiliationRow {
  articleId: string;
  raw: string;
  authors: string[];
  institution: string;
  department: string;
  city: string;
  country: string;
}

export interface WosKeywordRow {
  articleId: string;
  keyword: string;
  type: 'author' | 'keywords_plus' | 'category' | 'research_area';
}

export interface WosCitedReferenceRow {
  articleId: string;
  position: number;
  raw: string;
  normalizedKey: string;
  citedAuthor: string;
  citedYear: number | null;
  citedSource: string;
  citedVolume: string;
  citedPage: string;
  citedDoi: string;
}

export interface WosPlainTextQualityReport {
  recordCount: number;
  citedReferenceCount: number;
  uniqueReferenceCount: number;
  referencesWithDoi: number;
  referencesWithYear: number;
  doiCount: number;
  abstractCount: number;
  authorCount: number;
  affiliationCount: number;
  keywordCount: number;
  duplicateDoiCount: number;
  duplicateUtCount: number;
  nrMismatchCount: number;
  authorNameMismatchCount: number;
  fieldCounts: Record<string, number>;
  issues: string[];
  recommendations: string[];
}

interface ParsedWosRecord {
  fields: Record<string, string[]>;
}

const LINE_ENTRY_TAGS = new Set(['AU', 'AF', 'CR', 'EM', 'RI', 'OI', 'FU']);
const ADDRESS_TAGS = new Set(['C1']);

export function parseWosPlainTextDataset(
  content: string,
  sourceFileName: string,
  importedAt = new Date().toISOString()
): WosPlainTextDataset {
  const rawRecords = parseWosRecords(content);
  const datasetId = `wos-${compactTimestamp(importedAt)}-${hashText(`${sourceFileName}\n${content}`).slice(0, 8)}`;
  const records: WosPlainTextRecord[] = [];
  const authors: WosAuthorRow[] = [];
  const affiliations: WosAffiliationRow[] = [];
  const keywords: WosKeywordRow[] = [];
  const citedReferences: WosCitedReferenceRow[] = [];

  rawRecords.forEach((rawRecord, index) => {
    const record = buildWosRecord(rawRecord, index + 1);
    records.push(record);
    authors.push(...buildAuthorRows(record));
    affiliations.push(...buildAffiliationRows(record));
    keywords.push(...buildKeywordRows(record));
    citedReferences.push(...buildCitedReferenceRows(record));
  });

  return {
    id: datasetId,
    sourceFileName,
    importedAt,
    records,
    authors,
    affiliations,
    keywords,
    citedReferences,
    quality: buildQualityReport(records, authors, affiliations, keywords, citedReferences),
  };
}

export function wosDatasetToLiteratureRecords(dataset: WosPlainTextDataset): LiteratureRecord[] {
  const authorsByArticle = groupBy(dataset.authors, row => row.articleId);
  const affiliationsByArticle = groupBy(dataset.affiliations, row => row.articleId);
  const keywordsByArticle = groupBy(dataset.keywords, row => row.articleId);
  const referencesByArticle = groupBy(dataset.citedReferences, row => row.articleId);

  return dataset.records.map(record => {
    const articleAuthors = authorsByArticle.get(record.id) || [];
    const articleAffiliations = affiliationsByArticle.get(record.id) || [];
    const articleKeywords = keywordsByArticle.get(record.id) || [];
    const articleReferences = referencesByArticle.get(record.id) || [];
    const authorNames = articleAuthors
      .sort((a, b) => a.position - b.position)
      .map(author => author.fullName || author.shortName)
      .filter(Boolean);

    return {
      id: record.id,
      title: record.article.title,
      authors: authorNames.map(name => ({ name })),
      author: authorNames.join(', '),
      year: record.article.publicationYear || undefined,
      journal: record.article.sourceTitle,
      abstract: record.article.abstract,
      keywords: uniqueStrings(articleKeywords.map(row => row.keyword)),
      doi: record.article.doi,
      issn: record.article.issn,
      eissn: record.article.eissn,
      SN: record.article.issn,
      EI: record.article.eissn,
      documentType: record.article.documentType,
      source: 'WoS Plain Text',
      references: articleReferences.map(row => row.raw),
      citedReferences: articleReferences,
      institutions: uniqueStrings(articleAffiliations.map(row => row.institution).filter(Boolean)),
      countries: uniqueStrings(articleAffiliations.map(row => row.country).filter(Boolean)),
      affiliations: articleAffiliations,
      citationCount: record.article.timesCited,
      timesCited: record.article.timesCited,
      TC: record.article.timesCited,
      UT: record.article.uid,
      rawData: {
        source: 'wos-plain-text',
        datasetId: dataset.id,
        fields: record.fields,
        citedReferences: articleReferences,
      },
    };
  });
}

export function mergeWosPlainTextDatasets(
  datasets: WosPlainTextDataset[],
  sourceFileName: string,
  importedAt = new Date().toISOString()
): WosPlainTextDataset {
  const selectedRecords: WosPlainTextRecord[] = [];
  const authors: WosAuthorRow[] = [];
  const affiliations: WosAffiliationRow[] = [];
  const keywords: WosKeywordRow[] = [];
  const citedReferences: WosCitedReferenceRow[] = [];
  const seen = new Set<string>();

  for (const dataset of datasets) {
    const authorsByArticle = groupBy(dataset.authors, row => row.articleId);
    const affiliationsByArticle = groupBy(dataset.affiliations, row => row.articleId);
    const keywordsByArticle = groupBy(dataset.keywords, row => row.articleId);
    const referencesByArticle = groupBy(dataset.citedReferences, row => row.articleId);

    for (const record of dataset.records) {
      const key = getRecordDedupeKey(record);
      if (key && seen.has(key)) continue;
      if (key) seen.add(key);
      selectedRecords.push(record);
      authors.push(...(authorsByArticle.get(record.id) || []));
      affiliations.push(...(affiliationsByArticle.get(record.id) || []));
      keywords.push(...(keywordsByArticle.get(record.id) || []));
      citedReferences.push(...(referencesByArticle.get(record.id) || []));
    }
  }

  return {
    id: `wos-${compactTimestamp(importedAt)}-${hashText(`${sourceFileName}\n${selectedRecords.map(record => record.id).join('\n')}`).slice(0, 8)}`,
    sourceFileName,
    importedAt,
    records: selectedRecords.map((record, index) => ({ ...record, sourceIndex: index + 1 })),
    authors,
    affiliations,
    keywords,
    citedReferences,
    quality: buildQualityReport(selectedRecords, authors, affiliations, keywords, citedReferences),
  };
}

export function summarizeWosDataset(dataset: WosPlainTextDataset): Record<string, unknown> {
  const years = dataset.records
    .map(record => record.article.publicationYear)
    .filter((year): year is number => typeof year === 'number');
  return {
    id: dataset.id,
    sourceFileName: dataset.sourceFileName,
    importedAt: dataset.importedAt,
    recordCount: dataset.quality.recordCount,
    citedReferenceCount: dataset.quality.citedReferenceCount,
    uniqueReferenceCount: dataset.quality.uniqueReferenceCount,
    referencesWithDoi: dataset.quality.referencesWithDoi,
    referencesWithYear: dataset.quality.referencesWithYear,
    doiCount: dataset.quality.doiCount,
    abstractCount: dataset.quality.abstractCount,
    authorCount: dataset.quality.authorCount,
    affiliationCount: dataset.quality.affiliationCount,
    keywordCount: dataset.quality.keywordCount,
    yearMin: years.length ? Math.min(...years) : null,
    yearMax: years.length ? Math.max(...years) : null,
    issues: dataset.quality.issues,
    recommendations: dataset.quality.recommendations,
  };
}

function getRecordDedupeKey(record: WosPlainTextRecord): string {
  if (record.article.uid) return `ut:${normalizeReferenceKey(record.article.uid)}`;
  if (record.article.doi) return `doi:${normalizeReferenceKey(record.article.doi)}`;
  const titleKey = normalizeReferenceKey(record.article.title);
  if (titleKey) return `title:${titleKey}|${record.article.publicationYear || ''}`;
  return `record:${normalizeReferenceKey(record.id)}`;
}

function parseWosRecords(content: string): ParsedWosRecord[] {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  const records: ParsedWosRecord[] = [];
  let current: ParsedWosRecord | null = null;
  let currentTag = '';

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');
    const tagMatch = line.match(/^([A-Z0-9]{2})\s(.*)$/);
    if (tagMatch) {
      const tag = tagMatch[1];
      const value = tagMatch[2].trim();
      if (tag === 'PT') {
        current = { fields: {} };
      }
      if (current) {
        addFieldValue(current.fields, tag, value);
        currentTag = tag;
      }
      continue;
    }

    if (current && /^ER\s*$/.test(line)) {
      records.push(current);
      current = null;
      currentTag = '';
      continue;
    }

    const continuation = line.match(/^\s{3}(.*)$/);
    if (current && continuation && currentTag) {
      const value = continuation[1].trim();
      if (!value) continue;
      if (LINE_ENTRY_TAGS.has(currentTag)) {
        addFieldValue(current.fields, currentTag, value);
      } else if (ADDRESS_TAGS.has(currentTag) && value.startsWith('[')) {
        addFieldValue(current.fields, currentTag, value);
      } else {
        appendFieldContinuation(current.fields, currentTag, value);
      }
    }
  }

  return records;
}

function buildWosRecord(rawRecord: ParsedWosRecord, sourceIndex: number): WosPlainTextRecord {
  const fields = rawRecord.fields;
  const uid = firstField(fields, 'UT');
  const doi = normalizeDoi(firstField(fields, 'DI'));
  const title = joinField(fields, 'TI');
  const id = uid || doi || `wos-record-${sourceIndex}-${hashText(title || JSON.stringify(fields)).slice(0, 10)}`;

  return {
    id,
    fields,
    sourceIndex,
    article: {
      uid,
      doi,
      title,
      abstract: joinField(fields, 'AB'),
      sourceTitle: joinField(fields, 'SO'),
      journalAbbreviation: firstField(fields, 'JI') || firstField(fields, 'J9'),
      issn: firstField(fields, 'SN'),
      eissn: firstField(fields, 'EI'),
      publicationYear: parseYear(firstField(fields, 'PY')),
      publicationDate: firstField(fields, 'PD'),
      documentType: firstField(fields, 'DT'),
      language: firstField(fields, 'LA'),
      volume: firstField(fields, 'VL'),
      issue: firstField(fields, 'IS'),
      beginPage: firstField(fields, 'BP'),
      endPage: firstField(fields, 'EP'),
      articleNumber: firstField(fields, 'AR') || firstField(fields, 'EA'),
      pageCount: parseInteger(firstField(fields, 'PG')),
      timesCited: parseInteger(firstField(fields, 'TC') || firstField(fields, 'Z9')),
      usage180: parseInteger(firstField(fields, 'U1')),
      usageSince2013: parseInteger(firstField(fields, 'U2')),
      wosCategories: splitSemicolonField(fields, 'WC'),
      researchAreas: splitSemicolonField(fields, 'SC'),
      openAccess: splitSemicolonField(fields, 'OA'),
      publisher: firstField(fields, 'PU'),
      publisherCity: firstField(fields, 'PI'),
      publisherAddress: firstField(fields, 'PA'),
      reprintAddress: joinField(fields, 'RP'),
      emails: splitSemicolonField(fields, 'EM'),
    },
  };
}

function buildAuthorRows(record: WosPlainTextRecord): WosAuthorRow[] {
  const shortNames = record.fields.AU || [];
  const fullNames = record.fields.AF || [];
  const researcherIds = splitIdentityValues(record.fields.RI || []);
  const orcids = splitIdentityValues(record.fields.OI || []);
  const correspondingNames = new Set(extractCorrespondingAuthorNames(record.article.reprintAddress).map(normalizePersonKey));

  return shortNames.map((shortName, index) => {
    const fullName = fullNames[index] || shortName;
    const keyCandidates = [fullName, shortName].map(normalizePersonKey);
    return {
      articleId: record.id,
      position: index + 1,
      shortName,
      fullName,
      researcherId: findIdentityForAuthor(researcherIds, keyCandidates),
      orcid: findIdentityForAuthor(orcids, keyCandidates),
      isCorresponding: keyCandidates.some(key => correspondingNames.has(key)),
    };
  });
}

function buildAffiliationRows(record: WosPlainTextRecord): WosAffiliationRow[] {
  return (record.fields.C1 || []).map(raw => {
    const parsed = parseAffiliation(raw);
    return {
      articleId: record.id,
      raw,
      ...parsed,
    };
  });
}

function buildKeywordRows(record: WosPlainTextRecord): WosKeywordRow[] {
  return [
    ...splitSemicolonField(record.fields, 'DE').map(keyword => ({ articleId: record.id, keyword, type: 'author' as const })),
    ...splitSemicolonField(record.fields, 'ID').map(keyword => ({ articleId: record.id, keyword, type: 'keywords_plus' as const })),
    ...record.article.wosCategories.map(keyword => ({ articleId: record.id, keyword, type: 'category' as const })),
    ...record.article.researchAreas.map(keyword => ({ articleId: record.id, keyword, type: 'research_area' as const })),
  ];
}

function buildCitedReferenceRows(record: WosPlainTextRecord): WosCitedReferenceRow[] {
  return (record.fields.CR || []).map((raw, index) => {
    const parsed = parseCitedReference(raw);
    return {
      articleId: record.id,
      position: index + 1,
      raw,
      ...parsed,
    };
  });
}

function parseCitedReference(raw: string): Omit<WosCitedReferenceRow, 'articleId' | 'position' | 'raw'> {
  const doi = extractDoi(raw);
  const parts = raw.split(',').map(item => item.trim()).filter(Boolean);
  const yearIndex = parts.findIndex(part => /\b(19|20)\d{2}\b/.test(part));
  const citedAuthor = parts[0] || '';
  const citedYear = parseYear(yearIndex >= 0 ? parts[yearIndex] : raw);
  const citedSource = yearIndex >= 0 ? cleanReferencePart(parts[yearIndex + 1] || '') : '';
  const citedVolume = extractReferenceToken(raw, 'V');
  const citedPage = extractReferenceToken(raw, 'P');
  const normalizedKey = doi
    ? `doi:${doi.toLowerCase()}`
    : normalizeReferenceKey([citedAuthor, citedYear ? String(citedYear) : '', citedSource, citedVolume, citedPage].join('|'));
  return {
    normalizedKey,
    citedAuthor,
    citedYear,
    citedSource,
    citedVolume,
    citedPage,
    citedDoi: doi,
  };
}

function parseAffiliation(raw: string): Omit<WosAffiliationRow, 'articleId' | 'raw'> {
  const authorMatch = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  const authors = authorMatch
    ? authorMatch[1].split(';').map(item => item.trim()).filter(Boolean)
    : [];
  const affiliation = authorMatch ? authorMatch[2].trim() : raw.trim();
  const parts = affiliation.split(',').map(item => item.trim()).filter(Boolean);
  const country = normalizeCountry(parts[parts.length - 1] || '');
  const city = parts.length >= 2 ? cleanCity(parts[parts.length - 2]) : '';
  return {
    authors,
    institution: parts[0] || affiliation,
    department: parts.slice(1, Math.max(1, parts.length - 2)).join(', '),
    city,
    country,
  };
}

function buildQualityReport(
  records: WosPlainTextRecord[],
  authors: WosAuthorRow[],
  affiliations: WosAffiliationRow[],
  keywords: WosKeywordRow[],
  citedReferences: WosCitedReferenceRow[]
): WosPlainTextQualityReport {
  const fieldCounts: Record<string, number> = {};
  for (const record of records) {
    Object.keys(record.fields).forEach(tag => {
      fieldCounts[tag] = (fieldCounts[tag] || 0) + 1;
    });
  }

  const doiValues = records.map(record => record.article.doi).filter(Boolean);
  const utValues = records.map(record => record.article.uid).filter(Boolean);
  const nrMismatchCount = records.filter(record => {
    const expected = parseInteger(firstField(record.fields, 'NR'));
    return expected !== null && expected !== (record.fields.CR || []).length;
  }).length;
  const authorNameMismatchCount = records.filter(record => {
    const au = record.fields.AU || [];
    const af = record.fields.AF || [];
    return au.length > 0 && af.length > 0 && au.length !== af.length;
  }).length;
  const uniqueReferenceCount = new Set(citedReferences.map(ref => ref.normalizedKey || normalizeReferenceKey(ref.raw))).size;
  const issues: string[] = [];
  const recommendations: string[] = [];

  if (records.length === 0) {
    issues.push('未解析到 WoS 记录。');
    recommendations.push('请确认导出的文件类型为 Plain Text，且导出内容包含 Full Record and Cited References。');
  }
  if (nrMismatchCount > 0) {
    issues.push(`${nrMismatchCount} 篇记录的 NR 与实际 CR 条数不一致。`);
    recommendations.push('建议重新从 Web of Science 导出 Full Record and Cited References，并检查文件是否被截断。');
  }
  if (authorNameMismatchCount > 0) {
    issues.push(`${authorNameMismatchCount} 篇记录的 AU 与 AF 数量不一致。`);
    recommendations.push('作者全名与缩写名不完全对应时，作者表会优先保留可解析字段，正式分析前建议人工复核。');
  }
  if (citedReferences.length > 0 && citedReferences.filter(ref => ref.citedDoi).length / citedReferences.length < 0.5) {
    issues.push('参考文献 DOI 覆盖率低于 50%。');
    recommendations.push('共被引和文献耦合仍可运行，但 DOI 补全与参考文献归并准确度会下降。');
  }

  return {
    recordCount: records.length,
    citedReferenceCount: citedReferences.length,
    uniqueReferenceCount,
    referencesWithDoi: citedReferences.filter(ref => ref.citedDoi).length,
    referencesWithYear: citedReferences.filter(ref => ref.citedYear !== null).length,
    doiCount: records.filter(record => record.article.doi).length,
    abstractCount: records.filter(record => record.article.abstract).length,
    authorCount: new Set(authors.map(author => normalizePersonKey(author.fullName || author.shortName)).filter(Boolean)).size,
    affiliationCount: affiliations.length,
    keywordCount: new Set(keywords.map(row => normalizeReferenceKey(row.keyword))).size,
    duplicateDoiCount: countDuplicates(doiValues),
    duplicateUtCount: countDuplicates(utValues),
    nrMismatchCount,
    authorNameMismatchCount,
    fieldCounts,
    issues,
    recommendations,
  };
}

function addFieldValue(fields: Record<string, string[]>, tag: string, value: string): void {
  if (!fields[tag]) fields[tag] = [];
  fields[tag].push(value);
}

function appendFieldContinuation(fields: Record<string, string[]>, tag: string, value: string): void {
  if (!fields[tag] || fields[tag].length === 0) {
    addFieldValue(fields, tag, value);
    return;
  }
  fields[tag][fields[tag].length - 1] = `${fields[tag][fields[tag].length - 1]} ${value}`.trim();
}

function firstField(fields: Record<string, string[]>, tag: string): string {
  return cleanText(fields[tag]?.[0] || '');
}

function joinField(fields: Record<string, string[]>, tag: string): string {
  return cleanText((fields[tag] || []).join(' '));
}

function splitSemicolonField(fields: Record<string, string[]>, tag: string): string[] {
  return uniqueStrings((fields[tag] || [])
    .join(' ')
    .split(/[;；]/)
    .map(cleanText)
    .filter(Boolean));
}

function splitIdentityValues(values: string[]): Array<{ name: string; value: string }> {
  return values.flatMap(value => value.split(';'))
    .map(item => {
      const match = item.trim().match(/^(.+?)\/(.+)$/);
      return match ? { name: match[1].trim(), value: match[2].trim() } : { name: item.trim(), value: '' };
    })
    .filter(item => item.name);
}

function findIdentityForAuthor(items: Array<{ name: string; value: string }>, authorKeys: string[]): string {
  const found = items.find(item => authorKeys.includes(normalizePersonKey(item.name)));
  return found?.value || '';
}

function extractCorrespondingAuthorNames(value: string): string[] {
  if (!value) return [];
  return value
    .split(/\(corresponding author\),/i)
    .map(part => part.split(';')[0].trim())
    .filter(part => /,/.test(part));
}

function extractDoi(raw: string): string {
  const doiMatches = raw.match(/10\.\d{4,9}\/[^\s,;\]\)]+/ig);
  if (!doiMatches || doiMatches.length === 0) return '';
  return normalizeDoi(doiMatches[0]);
}

function normalizeDoi(value: string): string {
  return cleanText(value)
    .replace(/^doi\s*:?\s*/i, '')
    .replace(/^[\[\(]+|[\]\).,;]+$/g, '')
    .toLowerCase();
}

function extractReferenceToken(raw: string, prefix: string): string {
  const match = raw.match(new RegExp(`(?:^|,|\\s)${prefix}([^,\\s]+)`, 'i'));
  return cleanReferencePart(match?.[1] || '');
}

function cleanReferencePart(value: string): string {
  return cleanText(value).replace(/^[VP]\s*/i, '').replace(/[.,;]+$/g, '');
}

function parseYear(value: string): number | null {
  const match = String(value || '').match(/\b(19|20)\d{2}\b/);
  return match ? Number(match[0]) : null;
}

function parseInteger(value: string): number | null {
  const parsed = Number.parseInt(String(value || '').replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cleanCity(value: string): string {
  return cleanText(value).replace(/\b\d{4,}\b/g, '').trim();
}

function normalizeCountry(value: string): string {
  const cleaned = cleanText(value).replace(/\.$/, '');
  const key = cleaned.toLowerCase();
  const aliases: Record<string, string> = {
    'peoples r china': 'China',
    'people r china': 'China',
    'peoples republic of china': 'China',
    'pr china': 'China',
    'usa': 'United States',
    'u s a': 'United States',
    'united states of america': 'United States',
    'england': 'United Kingdom',
    'scotland': 'United Kingdom',
    'wales': 'United Kingdom',
    'north ireland': 'United Kingdom',
  };
  return aliases[key] || cleaned;
}

function normalizeReferenceKey(value: string): string {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function normalizePersonKey(value: string): string {
  return normalizeReferenceKey(value).replace(/\s+/g, ' ');
}

function countDuplicates(values: string[]): number {
  const counts = new Map<string, number>();
  values.map(normalizeReferenceKey).filter(Boolean).forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  return Array.from(counts.values()).filter(count => count > 1).length;
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanText(value);
    const key = normalizeReferenceKey(cleaned);
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    grouped.set(key, [...(grouped.get(key) || []), item]);
  }
  return grouped;
}

function hashText(value: string): string {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function compactTimestamp(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14) || String(Date.now());
}
