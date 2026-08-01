import type { QueryIntent } from '../../orchestrator/query-intent';

export interface OrdinaryDraftContextPolicyInput {
  message: string;
  queryIntent?: Partial<QueryIntent> | null;
  context?: Record<string, unknown> | null;
}

export interface PromptContextPolicyDecision {
  attach: boolean;
  reason: string;
}

const EXPLICIT_DRAFT_PATTERNS = [
  /写作进度/,
  /写到哪[了里]?/,
  /写到什么程度/,
  /完成到哪/,
  /完成了哪些/,
  /还差哪些/,
  /还有哪些没写/,
  /草稿进度/,
  /论文进度/,
  /普通草稿/,
  /论文草稿/,
  /当前草稿/,
  /草稿/,
  /manuscript/i,
  /\bdraft\b/i,
  /writing progress/i,
  /\bchapter\b/i,
  /\bsection\b/i,
  /章节/,
  /摘要/,
  /引言/,
  /前言/,
  /材料与方法/,
  /方法/,
  /结果/,
  /讨论/,
  /结论/,
  /继续写/,
  /续写/,
  /改写/,
  /修改/,
  /润色/,
  /编辑/,
  /整合/,
  /保存到草稿/,
];

function hasWritingPageState(context: Record<string, unknown>): boolean {
  return Boolean(
    context.writingSkill
    || context.discussionFramework
    || context.articleWritingProgress
    || context.ordinaryDraftPinned
    || /(?:writing|draft|discussion|chapter|manuscript|论文|写作|草稿)/i.test(
      String(context.taskType || ''),
    ),
  );
}

/**
 * Ordinary draft text can be one of the largest dynamic prompt sections.
 * Attach it whenever writing intent or page state requires it; otherwise leave
 * it on disk so unrelated configuration/search/chat requests do not pay for it.
 * Ambiguous academic-writing follow-ups deliberately stay on the safe side.
 */
export function decideOrdinaryDraftContextAttachment(
  input: OrdinaryDraftContextPolicyInput,
): PromptContextPolicyDecision {
  const message = String(input.message || '').trim();
  const context = input.context && typeof input.context === 'object' ? input.context : {};
  const intent = input.queryIntent || {};

  if (!message) return { attach: false, reason: 'empty-request' };
  if (EXPLICIT_DRAFT_PATTERNS.some(pattern => pattern.test(message))) {
    return { attach: true, reason: 'explicit-draft-language' };
  }
  if (hasWritingPageState(context)) {
    return { attach: true, reason: 'active-writing-page-state' };
  }
  if (intent.primaryIntent === 'academic_writing') {
    return { attach: true, reason: 'academic-writing-intent' };
  }
  if (
    intent.isContextualFollowUp === true
    && ['write', 'edit', 'continue', 'read'].includes(String(intent.action || ''))
  ) {
    return { attach: true, reason: 'writing-follow-up' };
  }
  return { attach: false, reason: `unrelated-intent:${String(intent.primaryIntent || 'unknown')}` };
}
