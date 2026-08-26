export interface ParsedDraftSaveBlock {
  raw: string;
  content: string;
  section: string;
  references: string;
  syntax: 'fenced' | 'plain';
}

export interface DraftSaveBlockParseResult {
  blocks: ParsedDraftSaveBlock[];
  markerCount: number;
  invalidCount: number;
}

const SAVE_DRAFT_MARKER = /^\s*(?:[-*]\s*)?(?:\*\*)?(?:🔧\s*)?(?:(?:调用工具|tool(?:_call)?|function|call(?:ing)?\s+(?:the\s+)?tool)\s*[:：]\s*)?save[ _-]?draft(?:\*\*)?\s*$/gim;
const FIELD_LINE = /^\s*(content|内容|正文|section|章节|章节名|references|参考文献)\s*[:：]\s*(.*)$/gim;

interface FieldLocation {
  name: 'content' | 'section' | 'references';
  value: string;
  index: number;
  valueStart: number;
}

function normalizeSectionValue(value: string): string {
  return String(value || '')
    .trim()
    .replace(/^\s*[\[({'"`]+/, '')
    .replace(/[\])}'"`,;，；]+\s*$/, '')
    .trim();
}

function normalizeFieldName(value: string): FieldLocation['name'] {
  const field = String(value || '').trim().toLowerCase();
  if (field === 'content' || field === '内容' || field === '正文') return 'content';
  if (field === 'section' || field === '章节' || field === '章节名') return 'section';
  return 'references';
}

function collectFields(body: string): FieldLocation[] {
  const fields: FieldLocation[] = [];
  FIELD_LINE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FIELD_LINE.exec(body)) !== null) {
    const lineEnd = body.indexOf('\n', match.index);
    fields.push({
      name: normalizeFieldName(match[1]),
      value: String(match[2] || '').trim(),
      index: match.index,
      valueStart: lineEnd >= 0 ? lineEnd + 1 : body.length,
    });
  }
  return fields;
}

function readMultilineField(body: string, fields: FieldLocation[], field: FieldLocation | undefined): string {
  if (!field) return '';
  const inlineValue = field.value.replace(/^\|\s*/, '').trim();
  const nextField = fields.find(candidate => candidate.index > field.index);
  const multilineValue = body.slice(field.valueStart, nextField?.index ?? body.length).trim();
  return [inlineValue, multilineValue].filter(Boolean).join('\n').trim();
}

function parseCandidate(raw: string, body: string, syntax: ParsedDraftSaveBlock['syntax']): ParsedDraftSaveBlock | null {
  SAVE_DRAFT_MARKER.lastIndex = 0;
  if (!SAVE_DRAFT_MARKER.test(body)) return null;
  const fields = collectFields(body);
  const contentField = fields.find(field => field.name === 'content');
  const sectionField = fields.find(field => field.name === 'section');
  const referencesField = fields.find(field => field.name === 'references');
  const content = readMultilineField(body, fields, contentField)
    .replace(/^```(?:text|markdown|md|latex|tex)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const section = normalizeSectionValue(sectionField?.value || readMultilineField(body, fields, sectionField));
  const references = readMultilineField(body, fields, referencesField)
    .replace(/^```(?:text|markdown|md)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!content || !section) return null;
  return { raw, content, section, references, syntax };
}

function markerIndexesOutsideRanges(text: string, ranges: Array<{ start: number; end: number }>): number[] {
  const indexes: number[] = [];
  SAVE_DRAFT_MARKER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SAVE_DRAFT_MARKER.exec(text)) !== null) {
    if (!ranges.some(range => match!.index >= range.start && match!.index < range.end)) {
      indexes.push(match.index);
    }
  }
  return indexes;
}

/**
 * Parses Scholar Harness save_draft pseudo-tool output across API and Codex
 * providers. Fenced blocks are preferred; a plain block is accepted when the
 * model omits backticks but keeps the marker and named fields.
 */
export function parseDraftSaveBlocks(response: string): DraftSaveBlockParseResult {
  const text = String(response || '');
  const blocks: ParsedDraftSaveBlock[] = [];
  const fencedRanges: Array<{ start: number; end: number }> = [];
  let markerCount = 0;
  let invalidCount = 0;

  const fencePattern = /```(?:[a-zA-Z0-9_-]+)?\s*\n?([\s\S]*?)```/g;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = fencePattern.exec(text)) !== null) {
    const raw = fenceMatch[0];
    const body = fenceMatch[1] || '';
    SAVE_DRAFT_MARKER.lastIndex = 0;
    if (!SAVE_DRAFT_MARKER.test(body)) continue;
    markerCount += 1;
    fencedRanges.push({ start: fenceMatch.index, end: fenceMatch.index + raw.length });
    const parsed = parseCandidate(raw, body, 'fenced');
    if (parsed) blocks.push(parsed);
    else invalidCount += 1;
  }

  const plainMarkerIndexes = markerIndexesOutsideRanges(text, fencedRanges);
  plainMarkerIndexes.forEach((start, index) => {
    const end = plainMarkerIndexes[index + 1] ?? text.length;
    const raw = text.slice(start, end).trimEnd();
    markerCount += 1;
    const parsed = parseCandidate(raw, raw, 'plain');
    if (parsed) blocks.push(parsed);
    else invalidCount += 1;
  });

  return { blocks, markerCount, invalidCount };
}

export function isDraftSaveRequest(value: string): boolean {
  const text = String(value || '');

  // The paper-framework planner stores chapter goals and structure, not
  // chapter prose. Do not route framework/proposal confirmations into the
  // legacy draft synchronizer merely because they contain words such as
  // "更新" and "章节". An explicit prose/draft/file request still wins.
  const frameworkPlanningIntent = /(?:论文|文章|章节|写作)?(?:框架|提纲|结构规划|写作规划)|(?:框架|提纲)[\s\S]{0,20}(?:章节|小节|规划|建议|确认)/i.test(text);
  const explicitDraftBodyIntent = /草稿|章节正文|论文正文|文章正文|save[ _-]*draft|draft[_-]|(?:保存|写入|写回|同步|覆盖|追加)[\s\S]{0,40}(?:txt|文本文件)/i.test(text);
  if (frameworkPlanningIntent && !explicitDraftBodyIntent) return false;

  if (/(?:保存|写入|写回|同步|更新|覆盖|追加)[\s\S]{0,30}(?:草稿|章节)|(?:草稿|章节)[\s\S]{0,30}(?:保存|写入|写回|同步|更新|覆盖|追加)|save[ _-]*draft/i.test(text)) {
    return true;
  }

  // Users often name the chapter TXT directly without saying "草稿". A
  // canonical paper component plus an explicit TXT write still means that the
  // result belongs in the application's chapter store.
  const chapterName = '(?:标题|题目|摘要|引言|绪论|材料与方法|方法|结果|讨论|结论|展望|title|abstract|introduction|methods?|results?|discussion|conclusions?)';
  const extraction = new RegExp(
    `(?:把|将)?[\\s\\S]{0,80}${chapterName}[\\s\\S]{0,60}(?:单独|提取|拿出|拆出|分离)[\\s\\S]{0,60}(?:放到|保存到|写入|生成|新建)[\\s\\S]{0,30}(?:txt|文本文件)`,
    'i'
  );
  const directChapterFile = new RegExp(
    `(?:把|将)?[\\s\\S]{0,50}${chapterName}[\\s\\S]{0,40}(?:保存|写入|放到|生成|新建)[\\s\\S]{0,30}(?:txt|文本文件)`,
    'i'
  );
  return extraction.test(text) || directChapterFile.test(text);
}
