import { isNumberedDraftSubsection } from './draft-chapter-normalizer';

export type CanonicalDraftSection =
  | 'abstract'
  | 'introduction'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion';

export interface DraftSectionClassificationInput {
  content: string;
  sourceQuery?: string;
  preferredSection?: string;
  declaredSection?: string;
}

export interface DraftSectionClassification {
  section: CanonicalDraftSection | null;
  confidence: number;
  source: 'preferred' | 'query-explicit' | 'content-heading' | 'semantic' | 'declared' | 'ambiguous';
  reason: string;
  scores: Record<CanonicalDraftSection, number>;
  candidates: CanonicalDraftSection[];
}

export interface AllowedDraftChapter {
  key: string;
  title: string;
  canonicalSection: CanonicalDraftSection | null;
}

export interface DraftChapterResolution {
  target: AllowedDraftChapter;
  source: 'preferred' | 'classification' | 'declared';
}

export interface DraftSaveTargetResolution {
  target: AllowedDraftChapter;
  source: 'manual-lock' | 'query-explicit' | 'content-heading' | 'semantic' | 'ai-declared' | 'dynamic-created';
  confidence: number;
  reason: string;
  classification: DraftSectionClassification;
}

export const CANONICAL_DRAFT_SECTIONS: CanonicalDraftSection[] = [
  'abstract',
  'introduction',
  'methods',
  'results',
  'discussion',
  'conclusion',
];

export const DRAFT_SECTION_LABELS: Record<CanonicalDraftSection, string> = {
  abstract: '摘要',
  introduction: '引言',
  methods: '材料与方法',
  results: '结果',
  discussion: '讨论',
  conclusion: '结论',
};

export const CREATABLE_CANONICAL_DRAFT_CHAPTERS: AllowedDraftChapter[] = [
  { key: 'abstract', title: 'Abstract', canonicalSection: 'abstract' },
  { key: 'introduction', title: 'Introduction', canonicalSection: 'introduction' },
  { key: 'methods', title: 'Materials and Methods', canonicalSection: 'methods' },
  { key: 'results', title: 'Results', canonicalSection: 'results' },
  { key: 'discussion', title: 'Discussion', canonicalSection: 'discussion' },
  { key: 'conclusion', title: 'Conclusion', canonicalSection: 'conclusion' },
];

const SECTION_ALIASES: Array<{ section: CanonicalDraftSection; pattern: RegExp }> = [
  { section: 'abstract', pattern: /^(abstract|summary|摘要)$/i },
  { section: 'introduction', pattern: /^(intro|introduction|background|引言|绪论|研究背景)$/i },
  { section: 'methods', pattern: /^(method|methods|materials(?:\s+and\s+methods)?|methodology|材料与方法|材料|方法)$/i },
  { section: 'results', pattern: /^(result|results|findings|结果|研究结果)$/i },
  { section: 'discussion', pattern: /^(discussion|讨论)$/i },
  { section: 'conclusion', pattern: /^(conclusion|conclusions|summary\s+and\s+outlook|结论|结论与展望|展望)$/i },
];

const SECTION_SIGNAL_PATTERNS: Record<CanonicalDraftSection, RegExp[]> = {
  abstract: [
    /\babstract\b|摘要/i,
    /研究目的[\s\S]{0,180}研究方法[\s\S]{0,180}(主要)?结果[\s\S]{0,180}结论/i,
    /\bbackground\b[\s\S]{0,180}\bmethods?\b[\s\S]{0,180}\bresults?\b[\s\S]{0,180}\bconclusions?\b/i,
  ],
  introduction: [
    /\bintroduction\b|引言|绪论|研究背景/i,
    /research gap|knowledge gap|remains? unclear|尚不清楚|仍缺乏|研究空白/i,
    /研究目的|研究假设|本研究旨在|the (?:aim|objective) of this study|we hypothesi[sz]ed/i,
    /近年来|已成为|广泛关注|plays? (?:an? )?(?:important|critical) role/i,
  ],
  methods: [
    /materials? and methods?|methodology|材料与方法|试验设计|实验设计/i,
    /sample(?:s|d| collection)?|sampling|样品采集|土壤采样|测定方法/i,
    /treatment|replicate|randomi[sz]ed|处理设置|重复(?:次数)?|随机区组/i,
    /statistical analysis|anova|mixed model|数据分析采用|统计分析/i,
    /was measured|were measured|was determined|were determined|采用.{0,30}(测定|分析)/i,
  ],
  results: [
    /\bresults?\b|研究结果|结果表明/i,
    /\bfig(?:ure)?\.?\s*\d|\btable\s*\d|图\s*\d|表\s*\d/i,
    /significant(?:ly)?|not significant|显著(?:增加|降低|差异)?|无显著差异|p\s*[<=>]\s*0?\./i,
    /increased|decreased|higher than|lower than|达到|分别为|增加了|降低了/i,
    /\bmean\s*[±+\-]|\b\d+(?:\.\d+)?\s*(?:%|mg|kg|g|mmol|μmol|ppm)/i,
  ],
  discussion: [
    /\bdiscussion\b|讨论/i,
    /may be attributed to|could be explained by|可能归因于|这可能是由于|原因可能/i,
    /consistent with|in contrast to previous|与.{0,30}(研究|报道)(一致|不同)|已有研究/i,
    /mechanism|机制|indicat(?:e|es|ed) that|suggest(?:s|ed)? that|说明了|意味着/i,
    /implication|意义|limitation|局限性/i,
  ],
  conclusion: [
    /\bconclusions?\b|结论|结论与展望/i,
    /in conclusion|to conclude|综上所述|总之/i,
    /本研究表明|本研究证实|this study demonstrates|this study concludes/i,
    /future research|未来研究|进一步研究/i,
  ],
};

export function normalizeDraftSection(value: unknown): CanonicalDraftSection | null {
  const normalized = String(value || '')
    .trim()
    .replace(/^\d+(?:\.\d+)*[\s._-]*/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized) return null;
  for (const alias of SECTION_ALIASES) {
    if (alias.pattern.test(normalized)) return alias.section;
  }
  return null;
}

export function createDynamicDraftChapter(value: unknown, titleValue?: unknown): AllowedDraftChapter | null {
  const rawKey = String(value || titleValue || '').trim();
  const rawTitle = String(titleValue || value || '').trim();
  if (!rawKey || isNumberedDraftSubsection(rawKey) || isNumberedDraftSubsection(rawTitle)) return null;

  const canonicalSection = normalizeDraftSection(rawKey) || normalizeDraftSection(rawTitle);
  if (canonicalSection) {
    const canonical = CREATABLE_CANONICAL_DRAFT_CHAPTERS.find(chapter => chapter.canonicalSection === canonicalSection);
    return canonical ? { ...canonical } : null;
  }

  const key = rawKey
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  if (!key || /^(?:section|chapter|draft|content|text|other|unknown|正文|草稿|章节)$/i.test(key)) return null;
  if (/^(?:abstract|intro(?:duction)?|methods?|results?|discussion|conclusions?)[_-]?\d+(?:[_-]?\d+)*$/i.test(key)) return null;
  if (/^\d+(?:[._-]\d+)+/.test(key)) return null;

  const title = (rawTitle || key.replace(/[_-]+/g, ' ')).slice(0, 240);
  return {
    key,
    title,
    canonicalSection: null,
  };
}

function normalizeChapterIdentity(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[.\s/-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeAllowedDraftChapters(value: unknown): AllowedDraftChapter[] {
  if (!Array.isArray(value)) return [];
  const chapters: AllowedDraftChapter[] = [];
  const seen = new Set<string>();

  for (const item of value.slice(0, 50)) {
    const raw = item && typeof item === 'object'
      ? item as { key?: unknown; title?: unknown }
      : { key: item, title: item };
    const key = String(raw.key || raw.title || '').trim().slice(0, 160);
    const title = String(raw.title || raw.key || '').trim().slice(0, 240);
    if (isNumberedDraftSubsection(title) || isNumberedDraftSubsection(key)) continue;
    const identity = normalizeChapterIdentity(key);
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    chapters.push({
      key,
      title: title || key,
      canonicalSection: normalizeDraftSection(key) || normalizeDraftSection(title),
    });
  }

  return chapters;
}

export function includeCreatableCanonicalDraftChapters(value: unknown): AllowedDraftChapter[] {
  const chapters = normalizeAllowedDraftChapters(value);
  const representedSections = new Set(
    chapters.map(chapter => chapter.canonicalSection).filter(Boolean)
  );
  for (const creatable of CREATABLE_CANONICAL_DRAFT_CHAPTERS) {
    if (representedSections.has(creatable.canonicalSection)) continue;
    chapters.push({ ...creatable });
    representedSections.add(creatable.canonicalSection);
  }
  return chapters;
}

export function findAllowedDraftChapter(
  chapters: AllowedDraftChapter[],
  value: unknown
): AllowedDraftChapter | null {
  const identity = normalizeChapterIdentity(value);
  if (!identity) return null;
  return chapters.find(chapter => (
    normalizeChapterIdentity(chapter.key) === identity
    || normalizeChapterIdentity(chapter.title) === identity
  )) || null;
}

export function resolveAllowedDraftChapter(input: {
  chapters: AllowedDraftChapter[];
  preferredChapter?: unknown;
  classifiedSection?: unknown;
  declaredChapter?: unknown;
}): DraftChapterResolution | null {
  const preferred = findAllowedDraftChapter(input.chapters, input.preferredChapter);
  if (preferred) return { target: preferred, source: 'preferred' };

  const classifiedSection = normalizeDraftSection(input.classifiedSection);
  if (classifiedSection) {
    const matches = input.chapters.filter(chapter => chapter.canonicalSection === classifiedSection);
    if (matches.length === 1) return { target: matches[0], source: 'classification' };
    if (matches.length > 1) {
      const declared = findAllowedDraftChapter(matches, input.declaredChapter);
      if (declared) return { target: declared, source: 'declared' };
      return null;
    }
  }

  const declared = findAllowedDraftChapter(input.chapters, input.declaredChapter);
  if (!declared) return null;
  if (classifiedSection && declared.canonicalSection && declared.canonicalSection !== classifiedSection) {
    return null;
  }
  return { target: declared, source: 'declared' };
}

function findExplicitSection(text: string): CanonicalDraftSection | null {
  const value = String(text || '');
  const patterns: Array<{ section: CanonicalDraftSection; pattern: RegExp }> = [
    { section: 'abstract', pattern: /(?:保存|更新|写入|放到|归入|修改|重写).{0,18}(?:摘要|abstract)|(?:摘要|abstract).{0,18}(?:章节|草稿)/i },
    { section: 'introduction', pattern: /(?:保存|更新|写入|放到|归入|修改|重写).{0,18}(?:引言|绪论|introduction)|(?:引言|绪论|introduction).{0,18}(?:章节|草稿)/i },
    { section: 'methods', pattern: /(?:保存|更新|写入|放到|归入|修改|重写).{0,18}(?:材料与方法|方法|methods?)|(?:材料与方法|methods?).{0,18}(?:章节|草稿)/i },
    { section: 'results', pattern: /(?:保存|更新|写入|放到|归入|修改|重写).{0,18}(?:结果|results?)|(?:结果|results?).{0,18}(?:章节|草稿)/i },
    { section: 'discussion', pattern: /(?:保存|更新|写入|放到|归入|修改|重写).{0,18}(?:讨论|discussion)|(?:讨论|discussion).{0,18}(?:章节|草稿)/i },
    { section: 'conclusion', pattern: /(?:保存|更新|写入|放到|归入|修改|重写).{0,18}(?:结论|展望|conclusions?)|(?:结论|展望|conclusions?).{0,18}(?:章节|草稿)/i },
  ];
  return patterns.find(item => item.pattern.test(value))?.section || null;
}

function findHeadingSection(content: string): CanonicalDraftSection | null {
  const firstLines = String(content || '').split(/\r?\n/).slice(0, 8);
  for (const line of firstLines) {
    const heading = line
      .replace(/^\s{0,3}#{1,6}\s*/, '')
      .replace(/^\s*\\(?:sub)*section\*?\{([^}]*)\}.*$/i, '$1')
      .replace(/^\s*\d+(?:\.\d+)*[.)、:：\s-]*/, '')
      .trim();
    const normalized = normalizeDraftSection(heading);
    if (normalized) return normalized;
  }
  return null;
}

function scoreSectionSignals(content: string): Record<CanonicalDraftSection, number> {
  const value = String(content || '').slice(0, 50000);
  const scores = Object.fromEntries(CANONICAL_DRAFT_SECTIONS.map(section => [section, 0])) as Record<CanonicalDraftSection, number>;
  for (const section of CANONICAL_DRAFT_SECTIONS) {
    for (const pattern of SECTION_SIGNAL_PATTERNS[section]) {
      if (pattern.test(value)) scores[section] += 1;
    }
  }
  return scores;
}

export function classifyDraftSection(input: DraftSectionClassificationInput): DraftSectionClassification {
  const scores = scoreSectionSignals(input.content);
  const preferred = normalizeDraftSection(input.preferredSection);
  if (preferred) {
    return { section: preferred, confidence: 1, source: 'preferred', reason: '用户界面明确指定章节', scores, candidates: [preferred] };
  }

  const querySection = findExplicitSection(input.sourceQuery || '');
  if (querySection) {
    return { section: querySection, confidence: 0.99, source: 'query-explicit', reason: '用户 query 明确指定章节', scores, candidates: [querySection] };
  }

  const headingSection = findHeadingSection(input.content);
  if (headingSection) {
    return { section: headingSection, confidence: 0.96, source: 'content-heading', reason: '正文标题明确标注章节', scores, candidates: [headingSection] };
  }

  const declared = normalizeDraftSection(input.declaredSection);
  const ranked = CANONICAL_DRAFT_SECTIONS
    .map(section => ({ section, score: scores[section] }))
    .sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const second = ranked[1];
  const candidates = ranked.filter(item => item.score > 0 && item.score >= top.score - 1).map(item => item.section);

  if (top.score >= 3 && top.score - second.score >= 1) {
    const confidence = Math.min(0.94, 0.62 + top.score * 0.07 + (top.score - second.score) * 0.05);
    return {
      section: top.section,
      confidence,
      source: 'semantic',
      reason: `内容特征支持 ${DRAFT_SECTION_LABELS[top.section]}（${top.score}:${second.score}）`,
      scores,
      candidates,
    };
  }

  if (declared && scores[declared] > 0 && scores[declared] >= top.score - 1) {
    return {
      section: declared,
      confidence: 0.68,
      source: 'declared',
      reason: 'AI 分类与正文内容特征基本一致',
      scores,
      candidates: Array.from(new Set([declared, ...candidates])),
    };
  }

  return {
    section: null,
    confidence: 0.35,
    source: 'ambiguous',
    reason: declared ? `AI 建议 ${DRAFT_SECTION_LABELS[declared]}，但正文证据不足或冲突` : '正文缺少足以确定章节的信号',
    scores,
    candidates: Array.from(new Set([...(declared ? [declared] : []), ...candidates])).slice(0, 3),
  };
}

export function resolveDraftSaveTarget(input: {
  chapters: AllowedDraftChapter[];
  content: string;
  sourceQuery?: string;
  preferredChapter?: unknown;
  declaredChapter?: unknown;
  declaredTitle?: unknown;
  declaredConfidence?: unknown;
}): DraftSaveTargetResolution | null {
  const preferredTarget = findAllowedDraftChapter(input.chapters, input.preferredChapter);
  const classification = classifyDraftSection({
    content: input.content,
    sourceQuery: input.sourceQuery,
    preferredSection: preferredTarget?.canonicalSection || undefined,
    declaredSection: input.declaredChapter ? String(input.declaredChapter) : undefined,
  });

  if (preferredTarget) {
    return {
      target: preferredTarget,
      source: 'manual-lock',
      confidence: 1,
      reason: '用户在页面锁定了当前写作章节',
      classification,
    };
  }

  const existingDeclaredTarget = findAllowedDraftChapter(input.chapters, input.declaredChapter);
  const dynamicDeclaredTarget = existingDeclaredTarget
    ? null
    : createDynamicDraftChapter(input.declaredChapter, input.declaredTitle);
  const rawDynamicConfidence = Number(input.declaredConfidence);
  const dynamicConfidence = Number.isFinite(rawDynamicConfidence)
    ? Math.max(0, Math.min(1, rawDynamicConfidence))
    : 0.72;
  if (dynamicDeclaredTarget && dynamicConfidence >= 0.5) {
    return {
      target: dynamicDeclaredTarget,
      source: 'dynamic-created',
      confidence: dynamicConfidence,
      reason: 'AI 根据本轮写作要求创建新的顶级章节 TXT',
      classification,
    };
  }

  if (classification.section && classification.confidence >= 0.58) {
    const classifiedTarget = resolveAllowedDraftChapter({
      chapters: input.chapters,
      classifiedSection: classification.section,
      declaredChapter: input.declaredChapter,
    })?.target;
    if (classifiedTarget) {
      return {
        target: classifiedTarget,
        source: classification.source === 'query-explicit'
          ? 'query-explicit'
          : (classification.source === 'content-heading'
              ? 'content-heading'
              : (classification.source === 'declared' ? 'ai-declared' : 'semantic')),
        confidence: classification.confidence,
        reason: classification.reason,
        classification,
      };
    }
  }

  const declaredTarget = existingDeclaredTarget;
  if (!declaredTarget) return null;
  if (
    classification.section
    && classification.confidence >= 0.8
    && declaredTarget.canonicalSection
    && declaredTarget.canonicalSection !== classification.section
  ) {
    return null;
  }

  const rawDeclaredConfidence = Number(input.declaredConfidence);
  const declaredConfidence = Number.isFinite(rawDeclaredConfidence)
    ? Math.max(0, Math.min(1, rawDeclaredConfidence))
    : (classification.source === 'declared' ? classification.confidence : 0.62);
  if (declaredConfidence < 0.5) return null;
  return {
    target: declaredTarget,
    source: 'ai-declared',
    confidence: declaredConfidence,
    reason: classification.source === 'declared'
      ? classification.reason
      : 'AI 保存工具明确选择规范章节，且未与用户 query 或正文标题冲突',
    classification,
  };
}
