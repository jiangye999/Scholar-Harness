import { createHash } from 'crypto';

export type AgentContextProfile = 'main-chat' | 'meta-analysis' | 'specialized';

export interface AgentPromptSection {
  id: string;
  title: string;
  content: string;
  priority: number;
  originalIndex: number;
  maxChars: number;
  required: boolean;
}

export interface AgentContextBudgetOptions {
  profile?: AgentContextProfile;
  maxChars?: number;
  minimumSectionChars?: number;
}

export interface ResolveAgentContextBudgetOptions {
  profile?: AgentContextProfile;
  query?: string;
  primaryIntent?: string;
  secondaryIntents?: string[];
  needsWorkspaceSearch?: boolean;
  needsLiteratureRetrieval?: boolean;
  hasExplicitSkill?: boolean;
  hasSelectedText?: boolean;
  hasAttachments?: boolean;
  hasDiscussionFramework?: boolean;
  hasAutonomousRetrieval?: boolean;
}

export interface ResolvedAgentContextBudget {
  maxChars: number;
  tier: 'compact' | 'standard' | 'extended' | 'heavy';
  reasons: string[];
}

export interface AgentContextBudgetDiagnostics {
  profile: AgentContextProfile;
  maxChars: number;
  beforeChars: number;
  afterChars: number;
  beforeEstimatedTokens: number;
  afterEstimatedTokens: number;
  sectionCount: number;
  includedSectionCount: number;
  deduplicatedSectionCount: number;
  omittedSectionCount: number;
  truncatedSectionCount: number;
  includedSections: Array<{
    id: string;
    title: string;
    beforeChars: number;
    afterChars: number;
    priority: number;
  }>;
  omittedSections: Array<{ id: string; title: string; chars: number; priority: number }>;
}

export interface AgentContextBudgetResult {
  prompt: string;
  diagnostics: AgentContextBudgetDiagnostics;
}

export interface CompactAgentContextOptions {
  maxChars?: number;
  maxDepth?: number;
  maxArrayItems?: number;
  maxStringChars?: number;
}

export interface AgentConversationHandoffMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface PrecomputeAgentContextOptions {
  profile?: AgentContextProfile;
  maxChars?: number;
  prompt: string;
  catalogPrompt?: string;
  explicitSkillPrompt?: string;
  conversationHandoff?: AgentConversationHandoffMessage[];
}

export interface PrecomputedAgentContext {
  prompt: string;
  catalogPrompt: string;
  explicitSkillPrompt: string;
  conversationHandoff: AgentConversationHandoffMessage[];
  diagnostics: AgentContextBudgetDiagnostics & {
    catalogChars: number;
    explicitSkillChars: number;
    handoffChars: number;
    totalChars: number;
    omittedDuplicateHandoffMessages: number;
  };
}

const DEFAULT_PROFILE_BUDGETS: Record<AgentContextProfile, number> = {
  'main-chat': 150_000,
  'meta-analysis': 110_000,
  specialized: 120_000,
};

/**
 * Selects the provider-visible context envelope from the actual request. The
 * envelope is deliberately generous for research/writing turns, while simple
 * chat no longer pays for the maximum 150k-character context on every call.
 * Full resources remain available through tools and are not discarded here.
 */
export function resolveAgentContextBudget(
  options: ResolveAgentContextBudgetOptions = {},
): ResolvedAgentContextBudget {
  const profile = options.profile || 'main-chat';
  const reasons: string[] = [`profile:${profile}`];
  let maxChars = profile === 'meta-analysis'
    ? 68_000
    : (profile === 'specialized' ? 56_000 : 44_000);

  const query = String(options.query || '');
  const intents = [
    String(options.primaryIntent || ''),
    ...(Array.isArray(options.secondaryIntents) ? options.secondaryIntents : []),
  ].join(' ').toLowerCase();

  if (options.hasExplicitSkill) {
    maxChars += 12_000;
    reasons.push('explicit-skill');
  }
  if (options.hasSelectedText || options.hasAttachments) {
    maxChars += 8_000;
    reasons.push('user-material');
  }
  if (options.needsWorkspaceSearch) {
    maxChars += 14_000;
    reasons.push('workspace-search');
  }
  if (options.needsLiteratureRetrieval) {
    maxChars += 20_000;
    reasons.push('literature-retrieval');
  }
  if (/writ|draft|paper|manuscript|review|analysis|meta|bibliometric|research|citation|figure|code|file/.test(intents)) {
    maxChars += 12_000;
    reasons.push('research-or-writing');
  }
  if (options.hasDiscussionFramework) {
    maxChars += 8_000;
    reasons.push('discussion-framework');
  }
  if (options.hasAutonomousRetrieval) {
    maxChars += 16_000;
    reasons.push('retrieval-results');
  }
  if (query.length > 8_000) {
    maxChars += 12_000;
    reasons.push('long-query');
  } else if (query.length > 3_000) {
    maxChars += 6_000;
    reasons.push('medium-query');
  }

  const cap = profile === 'meta-analysis' ? 128_000 : (profile === 'specialized' ? 120_000 : 112_000);
  maxChars = Math.max(32_000, Math.min(cap, maxChars));
  const tier: ResolvedAgentContextBudget['tier'] = maxChars <= 52_000
    ? 'compact'
    : (maxChars <= 76_000 ? 'standard' : (maxChars <= 100_000 ? 'extended' : 'heavy'));
  return { maxChars, tier, reasons };
}

const SECTION_HEADING_PATTERN = /^##\s+(.+)$/gm;

function normalizeLineEndings(value: unknown): string {
  return String(value ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function normalizedSectionIdentity(title: string, content: string): string {
  const normalized = `${title}\n${content}`
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

export function estimateAgentPromptTokens(value: unknown): number {
  const text = normalizeLineEndings(value);
  if (!text) return 0;
  const cjkMatches = text.match(/[\u3400-\u9fff\u3000-\u303f\uff00-\uffef]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = Math.max(0, text.length - cjkCount);
  return Math.ceil(cjkCount * 1.15 + nonCjkCount / 4);
}

function classifySection(title: string, profile: AgentContextProfile): {
  priority: number;
  maxChars: number;
  required: boolean;
} {
  const value = String(title || '').trim();
  if (/CURRENT_USER_REQUEST|当前用户请求|当前请求/i.test(value)) {
    return { priority: 100, maxChars: 30_000, required: true };
  }
  if (/显式调用.*Skill|用户自定义.*Skill|Query 意图|写作任务|页面状态|目标期刊/i.test(value)) {
    return { priority: 94, maxChars: 32_000, required: true };
  }
  if (/Meta|效应量|编码表|数据包|候选因变量|当前单篇 PDF|当前工作目录|附件/i.test(value)) {
    return {
      priority: profile === 'meta-analysis' ? 93 : 88,
      maxChars: profile === 'meta-analysis' ? 42_000 : 34_000,
      required: profile === 'meta-analysis',
    };
  }
  if (/自动识别的章节写作 Skill|自动加载 Skill|章节写作|草稿|写作进度|讨论式写作/i.test(value)) {
    return { priority: 82, maxChars: 30_000, required: false };
  }
  if (/文献|检索|证据|计量|Auto Research|R 作图/i.test(value)) {
    return { priority: 76, maxChars: 28_000, required: false };
  }
  if (/最近.*query|当前对话历史|历史对话|conversation|chat history/i.test(value)) {
    return { priority: 45, maxChars: 18_000, required: false };
  }
  if (/长期记忆|memory|用户记忆/i.test(value)) {
    return { priority: 35, maxChars: 22_000, required: false };
  }
  if (/render|inspect PNG|Design standards|Core Workflow/i.test(value)) {
    return { priority: 18, maxChars: 12_000, required: false };
  }
  return { priority: 60, maxChars: 24_000, required: false };
}

export function splitAgentPromptSections(
  prompt: string,
  profile: AgentContextProfile = 'specialized',
): AgentPromptSection[] {
  const text = normalizeLineEndings(prompt);
  const matches: Array<{ index: number; title: string }> = [];
  let match: RegExpExecArray | null;
  SECTION_HEADING_PATTERN.lastIndex = 0;
  while ((match = SECTION_HEADING_PATTERN.exec(text)) !== null) {
    matches.push({
      index: match.index,
      title: String(match[1] || '').trim() || '未命名区块',
    });
  }

  const rawSections: Array<{ title: string; content: string }> = [];
  if (!matches.length) {
    rawSections.push({ title: '前置上下文', content: text });
  } else {
    if (matches[0].index > 0) {
      rawSections.push({ title: '前置上下文', content: text.slice(0, matches[0].index) });
    }
    matches.forEach((item, index) => {
      const nextIndex = matches[index + 1]?.index ?? text.length;
      rawSections.push({ title: item.title, content: text.slice(item.index, nextIndex) });
    });
  }

  return rawSections
    .map((section, originalIndex) => {
      const content = section.content.trim();
      const classification = classifySection(section.title, profile);
      return {
        id: normalizedSectionIdentity(section.title, content).slice(0, 16),
        title: section.title,
        content,
        priority: classification.priority,
        originalIndex,
        maxChars: classification.maxChars,
        required: classification.required,
      };
    })
    .filter(section => section.content.length > 0);
}

function compactSectionContent(content: string, maxChars: number, title: string): string {
  const text = content.trim();
  if (text.length <= maxChars) return text;
  const marker = `\n\n[“${title}”已按统一上下文预算压缩]\n\n`;
  const available = Math.max(800, maxChars - marker.length);
  const headChars = Math.floor(available * 0.68);
  const tailChars = available - headChars;
  return `${text.slice(0, headChars).trimEnd()}${marker}${text.slice(-tailChars).trimStart()}`;
}

export function budgetAgentPrompt(
  prompt: string,
  options: AgentContextBudgetOptions = {},
): AgentContextBudgetResult {
  const profile = options.profile || 'specialized';
  const maxChars = Math.max(8_000, Math.floor(options.maxChars || DEFAULT_PROFILE_BUDGETS[profile]));
  const minimumSectionChars = Math.max(300, Math.floor(options.minimumSectionChars || 1_200));
  const originalPrompt = normalizeLineEndings(prompt).trim();
  const parsedSections = splitAgentPromptSections(originalPrompt, profile);
  const seen = new Set<string>();
  const deduplicated: AgentPromptSection[] = [];
  let deduplicatedSectionCount = 0;

  for (const section of parsedSections) {
    const identity = normalizedSectionIdentity(section.title, section.content);
    if (seen.has(identity)) {
      deduplicatedSectionCount += 1;
      continue;
    }
    seen.add(identity);
    deduplicated.push(section);
  }

  const prepared = deduplicated.map(section => ({
    ...section,
    compacted: compactSectionContent(section.content, section.maxChars, section.title),
  }));
  const selected = new Map<string, string>();
  let remaining = maxChars;

  const required = prepared
    .filter(section => section.required)
    .sort((a, b) => b.priority - a.priority || a.originalIndex - b.originalIndex);
  const optional = prepared
    .filter(section => !section.required)
    .sort((a, b) => b.priority - a.priority || a.originalIndex - b.originalIndex);

  for (const section of [...required, ...optional]) {
    if (remaining < minimumSectionChars && !section.required) continue;
    const allowance = Math.min(section.compacted.length, Math.max(0, remaining));
    if (allowance <= 0) continue;
    if (!section.required && allowance < Math.min(minimumSectionChars, section.compacted.length)) continue;
    const included = compactSectionContent(section.compacted, allowance, section.title);
    selected.set(section.id, included);
    remaining -= included.length + 2;
  }

  const includedInOriginalOrder = prepared
    .filter(section => selected.has(section.id))
    .sort((a, b) => a.originalIndex - b.originalIndex);
  const promptBody = includedInOriginalOrder
    .map(section => selected.get(section.id) || '')
    .filter(Boolean)
    .join('\n\n')
    .trim();
  const omitted = prepared.filter(section => !selected.has(section.id));
  const truncated = includedInOriginalOrder.filter(
    section => (selected.get(section.id) || '').length < section.content.length,
  );
  const afterPrompt = promptBody.length <= maxChars
    ? promptBody
    : compactSectionContent(promptBody, maxChars, '统一动态上下文');

  return {
    prompt: afterPrompt,
    diagnostics: {
      profile,
      maxChars,
      beforeChars: originalPrompt.length,
      afterChars: afterPrompt.length,
      beforeEstimatedTokens: estimateAgentPromptTokens(originalPrompt),
      afterEstimatedTokens: estimateAgentPromptTokens(afterPrompt),
      sectionCount: parsedSections.length,
      includedSectionCount: includedInOriginalOrder.length,
      deduplicatedSectionCount,
      omittedSectionCount: omitted.length,
      truncatedSectionCount: truncated.length,
      includedSections: includedInOriginalOrder.map(section => ({
        id: section.id,
        title: section.title,
        beforeChars: section.content.length,
        afterChars: (selected.get(section.id) || '').length,
        priority: section.priority,
      })),
      omittedSections: omitted.map(section => ({
        id: section.id,
        title: section.title,
        chars: section.content.length,
        priority: section.priority,
      })),
    },
  };
}

function compactJsonNode(
  value: unknown,
  options: Required<Omit<CompactAgentContextOptions, 'maxChars'>>,
  depth: number,
): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') {
    if (value.length <= options.maxStringChars) return value;
    return `${value.slice(0, Math.floor(options.maxStringChars * 0.72))}\n[字符串已按上下文预算压缩]\n${value.slice(-Math.floor(options.maxStringChars * 0.2))}`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= options.maxDepth) return '[达到统一上下文深度上限]';
  if (Array.isArray(value)) {
    if (value.length <= options.maxArrayItems) {
      return value.map(item => compactJsonNode(item, options, depth + 1));
    }
    const headCount = Math.max(1, options.maxArrayItems - 2);
    return [
      ...value.slice(0, headCount).map(item => compactJsonNode(item, options, depth + 1)),
      { omittedItems: value.length - headCount, reason: '统一上下文数组预算' },
    ];
  }
  if (typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = compactJsonNode(child, options, depth + 1);
    }
    return output;
  }
  return String(value);
}

export function compactAgentContextValue(
  value: unknown,
  options: CompactAgentContextOptions = {},
): unknown {
  const resolved = {
    maxDepth: Math.max(2, Math.floor(options.maxDepth || 8)),
    maxArrayItems: Math.max(3, Math.floor(options.maxArrayItems || 40)),
    maxStringChars: Math.max(300, Math.floor(options.maxStringChars || 4_000)),
  };
  const maxChars = Math.max(2_000, Math.floor(options.maxChars || 45_000));
  let current = resolved;
  let compacted = compactJsonNode(value, current, 0);
  let serialized = JSON.stringify(compacted);
  while (serialized.length > maxChars && (current.maxArrayItems > 4 || current.maxStringChars > 500)) {
    current = {
      ...current,
      maxArrayItems: Math.max(4, Math.floor(current.maxArrayItems * 0.62)),
      maxStringChars: Math.max(500, Math.floor(current.maxStringChars * 0.7)),
    };
    compacted = compactJsonNode(value, current, 0);
    serialized = JSON.stringify(compacted);
  }
  if (serialized.length <= maxChars) return compacted;
  return {
    compacted: true,
    reason: '统一上下文 JSON 预算',
    originalChars: serialized.length,
    preview: compactSectionContent(serialized, maxChars, '结构化上下文'),
  };
}

function compactStandalonePrompt(
  prompt: string,
  profile: AgentContextProfile,
  maxChars: number,
): string {
  const normalized = String(prompt || '').trim();
  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  // budgetAgentPrompt deliberately has an 8k floor for full prompts. Catalogs
  // and handoff fragments may receive a smaller slice of the shared envelope,
  // so compact those fragments directly instead of silently exceeding it.
  if (maxChars < 8_000) {
    return compactSectionContent(normalized, maxChars, '共享附加上下文');
  }
  return budgetAgentPrompt(normalized, {
    profile,
    maxChars,
    minimumSectionChars: 500,
  }).prompt;
}

function normalizeComparableContext(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Computes the complete provider-visible context once, before any provider is
 * selected. This keeps the main page, Meta and other specialized entry points
 * on one deterministic budget instead of letting each adapter append another
 * unbounded copy of history or Skill content.
 */
export function precomputeAgentContext(
  options: PrecomputeAgentContextOptions,
): PrecomputedAgentContext {
  const profile = options.profile || 'specialized';
  const maxChars = Math.max(32_000, Math.floor(options.maxChars || DEFAULT_PROFILE_BUDGETS[profile]));
  // Keep all auxiliary channels below half of the provider-visible envelope.
  // The previous independent minimums could reserve 26k in a 32k envelope
  // before the actual task prompt was considered.
  // Skill/MCP catalogues are routing indexes, not full instructions. Keep the
  // provider-visible index compact while load_skill/read_skill_resource and
  // the on-disk CATALOG.md retain access to the complete content.
  const catalogLimit = Math.min(8_000, Math.max(4_000, Math.floor(maxChars * 0.06)));
  const explicitSkillLimit = Math.min(30_000, Math.max(12_000, Math.floor(maxChars * 0.22)));
  const handoffLimit = Math.min(12_000, Math.max(3_000, Math.floor(maxChars * 0.08)));

  const catalogPrompt = compactStandalonePrompt(
    String(options.catalogPrompt || ''),
    'specialized',
    catalogLimit,
  );
  const explicitSkillPrompt = compactStandalonePrompt(
    String(options.explicitSkillPrompt || ''),
    'specialized',
    explicitSkillLimit,
  );

  const promptNormalized = normalizeComparableContext(options.prompt);
  const handoffCandidates = Array.isArray(options.conversationHandoff)
    ? options.conversationHandoff.slice(-4)
    : [];
  const selectedHandoff: AgentConversationHandoffMessage[] = [];
  let handoffChars = 0;
  let omittedDuplicateHandoffMessages = 0;
  for (let index = handoffCandidates.length - 1; index >= 0; index--) {
    const message = handoffCandidates[index];
    const rawContent = String(message?.content || '').trim();
    if (!rawContent) continue;
    const comparable = normalizeComparableContext(rawContent);
    const comparablePrefix = comparable.slice(0, Math.min(600, comparable.length));
    if (
      comparable.length >= 80
      && (
        promptNormalized.includes(comparable)
        || (comparablePrefix.length >= 160 && promptNormalized.includes(comparablePrefix))
      )
    ) {
      omittedDuplicateHandoffMessages += 1;
      continue;
    }
    const remaining = handoffLimit - handoffChars;
    if (remaining < 500) break;
    const content = compactSectionContent(
      rawContent,
      Math.min(2_500, remaining),
      '对话交接消息',
    );
    selectedHandoff.unshift({
      role: message.role === 'assistant' || message.role === 'system' ? message.role : 'user',
      content,
    });
    handoffChars += content.length;
  }

  const reservedChars = catalogPrompt.length + explicitSkillPrompt.length + handoffChars;
  const promptLimit = Math.max(8_000, maxChars - reservedChars - 1_500);
  const promptBudget = budgetAgentPrompt(options.prompt, {
    profile,
    maxChars: promptLimit,
  });
  const totalChars = promptBudget.prompt.length + reservedChars;

  return {
    prompt: promptBudget.prompt,
    catalogPrompt,
    explicitSkillPrompt,
    conversationHandoff: selectedHandoff,
    diagnostics: {
      ...promptBudget.diagnostics,
      maxChars,
      catalogChars: catalogPrompt.length,
      explicitSkillChars: explicitSkillPrompt.length,
      handoffChars,
      totalChars,
      omittedDuplicateHandoffMessages,
    },
  };
}
