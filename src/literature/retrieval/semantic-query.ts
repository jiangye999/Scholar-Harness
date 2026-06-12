export type RetrievalQueryLanguage = 'en' | 'zh';

export interface RetrievalQueryVariant {
  language: RetrievalQueryLanguage;
  label: string;
  query: string;
}

const GENERIC_STOP_WORDS = new Set([
  'the', 'and', 'or', 'for', 'with', 'from', 'that', 'this', 'these', 'those',
  'into', 'onto', 'between', 'among', 'about', 'over', 'under', 'using', 'based',
  'study', 'studies', 'research', 'paper', 'article', 'review', 'analysis',
  'effect', 'effects', 'impact', 'impacts', 'factor', 'factors', 'different',
  '研究', '文献', '论文', '综述', '分析', '影响', '作用', '因素', '不同', '相关',
  '基于', '面向', '一种', '方法', '结果', '讨论', '机制', '证据',
]);

const DIRECTIONAL_TERM_GROUPS = [
  ['increase', 'increased', 'increasing', 'enhance', 'enhanced', 'promote', 'promoted', 'stimulate', 'stimulated', 'rise', 'higher', 'upregulate', 'upregulated', '增加', '提高', '升高', '上升', '促进', '增强', '提升', '上调'],
  ['decrease', 'decreased', 'decreasing', 'reduce', 'reduced', 'reduction', 'lower', 'lowered', 'decline', 'declined', 'suppress', 'suppressed', 'inhibit', 'inhibited', 'mitigate', 'mitigated', 'downregulate', 'downregulated', '下降', '降低', '减少', '削减', '抑制', '减弱', '缓解', '下调'],
  ['positive', 'positively', 'negative', 'negatively', 'correlate', 'correlated', 'associated', 'association', 'mediate', 'mediated', 'drive', 'driven', 'caused', 'causal', '正相关', '负相关', '相关', '关联', '介导', '驱动', '导致', '因果'],
  ['significant', 'significantly', 'insignificant', 'unchanged', 'neutral', 'non-significant', '显著', '不显著', '无显著', '无明显', '不变', '稳定'],
] as const;

const DIRECTIONAL_TERMS = new Set<string>(DIRECTIONAL_TERM_GROUPS.flat());

export function normalizeRetrievalText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[₂]/g, '2')
    .toLowerCase()
    .replace(/[\u00A0\r\n\t]+/g, ' ')
    .trim();
}

export function containsChinese(value: unknown): boolean {
  return /[\u4e00-\u9fff]/.test(String(value || ''));
}

export function containsLatin(value: unknown): boolean {
  return /[a-zA-Z]/.test(String(value || ''));
}

function pushChineseNgrams(tokens: string[], value: string): void {
  const run = value.replace(/\s+/g, '');
  if (run.length < 2) return;
  if (run.length <= 14) tokens.push(run);
  const maxN = Math.min(4, run.length);
  for (let n = 2; n <= maxN; n++) {
    for (let index = 0; index <= run.length - n; index++) {
      tokens.push(run.slice(index, index + n));
      if (tokens.length >= 12000) return;
    }
  }
}

export function tokenizeRetrievalText(value: unknown): string[] {
  const normalized = normalizeRetrievalText(value)
    .replace(/[^\w+\-./\s\u4e00-\u9fff]/g, ' ');
  const tokens: string[] = [];

  for (const match of normalized.matchAll(/[a-z0-9][a-z0-9+._/-]{1,}/g)) {
    const token = match[0].replace(/^[-./]+|[-./]+$/g, '');
    if (token.length > 1 && !GENERIC_STOP_WORDS.has(token)) tokens.push(token);
  }

  for (const match of normalized.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    pushChineseNgrams(tokens, match[0]);
    if (tokens.length >= 12000) break;
  }

  for (const term of DIRECTIONAL_TERMS) {
    if (normalized.includes(term)) tokens.push(term, term);
  }

  return tokens.slice(0, 12000);
}

export function weightRetrievalQueryTokens(tokens: string[]): string[] {
  const weighted: string[] = [];
  for (const token of tokens) {
    weighted.push(token);
    if (DIRECTIONAL_TERMS.has(token)) {
      weighted.push(token, token, token);
    }
  }
  return weighted;
}

export function findDirectionalSemanticTerms(value: unknown): string[] {
  const normalized = normalizeRetrievalText(value);
  const terms: string[] = [];
  for (const group of DIRECTIONAL_TERM_GROUPS) {
    if (group.some(term => normalized.includes(term))) {
      terms.push(...group);
    }
  }
  return Array.from(new Set(terms));
}

export function buildSemanticRetrievalQuery(value: unknown): string {
  const normalized = normalizeRetrievalText(value);
  const directionalTerms = findDirectionalSemanticTerms(normalized);
  const baseTokens = tokenizeRetrievalText(normalized)
    .filter(token => token.length >= 2)
    .slice(0, 80);
  return [
    String(value || '').trim(),
    directionalTerms.join(' '),
    directionalTerms.join(' '),
    baseTokens.join(' '),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim().slice(0, 1600);
}

function cleanQueryPart(value: unknown, maxLength = 500): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function uniqueQueryParts(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = cleanQueryPart(value);
    if (!clean) continue;
    const key = normalizeRetrievalText(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
  }
  return result;
}

export function buildBilingualRetrievalQueries(input: {
  sentence?: string;
  topic?: string;
  keywordsEn?: string[];
  keywordsCn?: string[];
}): RetrievalQueryVariant[] {
  const sentence = cleanQueryPart(input.sentence);
  const topic = cleanQueryPart(input.topic);
  const raw = [sentence, topic].filter(Boolean).join(' ');
  const keywordsEn = (input.keywordsEn || []).filter(item => containsLatin(item) && !containsChinese(item));
  const keywordsCn = (input.keywordsCn || []).filter(item => containsChinese(item));

  const englishParts = uniqueQueryParts([
    ...keywordsEn,
    containsLatin(sentence) && !containsChinese(sentence) ? sentence : '',
    containsLatin(topic) && !containsChinese(topic) ? topic : '',
    !containsChinese(raw) ? raw : '',
  ]);

  const chineseParts = uniqueQueryParts([
    ...keywordsCn,
    containsChinese(sentence) ? sentence : '',
    containsChinese(topic) ? topic : '',
  ]);

  const variants: RetrievalQueryVariant[] = [];
  if (englishParts.length > 0) {
    variants.push({
      language: 'en',
      label: '英文检索',
      query: englishParts.join(' '),
    });
  }
  if (chineseParts.length > 0) {
    variants.push({
      language: 'zh',
      label: '中文检索',
      query: chineseParts.join(' '),
    });
  }

  if (variants.length === 0 && raw) {
    variants.push({
      language: containsChinese(raw) ? 'zh' : 'en',
      label: containsChinese(raw) ? '中文检索' : '英文检索',
      query: raw,
    });
  }

  return variants;
}

export function formatRetrievalQueryVariants(variants: RetrievalQueryVariant[]): string {
  return variants.map(item => `${item.label}: ${item.query}`).join(' | ');
}
