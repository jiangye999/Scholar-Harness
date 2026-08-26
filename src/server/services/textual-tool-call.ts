import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';

interface JsonObjectCandidate {
  start: number;
  end: number;
  value: Record<string, unknown>;
}

export interface TextualToolProgressPartition {
  visible: string;
  pending: string;
  holdingToolArtifact: boolean;
}

const MAX_TEXTUAL_TOOL_CALLS_PER_RESPONSE = 16;
const MAX_DOT_TOOL_CALL_ENVELOPES = 128;

function parseLooseScalar(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed.replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
}

function stripSingleCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json|ya?ml|text)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

export function looksLikeTextualToolCallPrefix(value: string): boolean {
  const compact = stripSingleCodeFence(value).replace(/^[-*]\s*/, '').trimStart();
  if (!compact) return true;
  const chinesePrefix = '调用工具';
  const withoutIcon = compact.replace(/^🔧\s*/, '');
  return chinesePrefix.startsWith(withoutIcon)
    || '.tool_call'.startsWith(withoutIcon.toLowerCase())
    || /^\.tool_call(?:\s*:|$)/i.test(withoutIcon)
    || '<function'.startsWith(withoutIcon.toLowerCase())
    || /^<function(?:\s|=|>)/i.test(withoutIcon)
    || 'ScholarHarness'.toLowerCase().startsWith(withoutIcon.toLowerCase())
    || /^ScholarHarness\s+/i.test(withoutIcon)
    || withoutIcon.startsWith(chinesePrefix)
    || /^(?:tool(?:_call)?|function(?:_call)?|call(?:ing)?\s+(?:the\s+)?tool)\b/i.test(withoutIcon)
    || /^\{\s*["']?[A-Za-z_][\w.-]*["']?\s*:/i.test(withoutIcon)
    || (
      withoutIcon.length <= 240
      && /(?:我来|我先|让我|请让我|现在|接下来|正在|先|将|开始|准备|好的|可以).{0,80}(?:查找|搜索|读取|查看|检查|定位|调用|执行|打开|分析)/s.test(withoutIcon)
    )
    || (
      withoutIcon.length <= 48
      && /^(?:我|让我|请让我|现在|接下来|正在|先|将|开始|准备|好的|可以|I(?:'ll|\s+will)?|Let me)/i.test(withoutIcon)
    );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Locate a possible textual tool envelope inside streamed prose. Only names
 * from the registered tool set qualify, so ordinary JSON remains unaffected.
 */
export function findTextualToolArtifactStart(
  value: string,
  tools: LLMToolDefinition[],
): number {
  const names = tools.map(tool => tool.function.name).filter(Boolean);
  if (!value || names.length === 0) return -1;
  const alternatives = names.map(escapeRegExp).join('|');
  const patterns = [
    // A few OpenAI-compatible providers serialize one or more tool calls as
    // `.tool_call:{"name":...,"arguments":...}` content fragments.
    /\.tool_call(?=\s*:|$)/i,
    // Some OpenAI-compatible models glue a JSON tool_calls envelope directly
    // to prose without a newline. Detect the opening object wherever it starts
    // so streamed JSON never reaches the visible chat bubble before recovery.
    /\{\s*["']?tool_calls["']?[ \t]*:/i,
    new RegExp(
      `(?:^|\\n)[ \\t]*(?:<tool_call>\\s*)?\\{\\s*["']?(?:name|tool)["']?\\s*:\\s*["'](?:${alternatives})["']`,
      'i',
    ),
    /<(?:tool_call|function_call)>/i,
    new RegExp(`<function[ \\t]*=[ \\t]*(?:${alternatives})[ \\t]*>`, 'i'),
    new RegExp(`<function[ \\t]+name[ \\t]*=[ \\t]*["'](?:${alternatives})["'][ \\t]*>`, 'i'),
    new RegExp(`(?:^|\\n)[ \\t]*ScholarHarness[ \\t]+(?:${alternatives})(?=[ \\t\\r\\n]|$)`, 'i'),
    new RegExp(
      '(?:^|\\n)[ \\t]*(?:```(?:json)?[ \\t]*\\r?\\n[ \\t]*)?\\{\\s*["\']?(?:'
        + alternatives
        + ')["\']?[ \\t]*:',
      'i',
    ),
    new RegExp(`(?:^|\\n)[ \\t]*(?:[-*][ \\t]*)?(?:🔧[ \\t]*)?(?:调用工具|tool(?:_call)?|function(?:_call)?)[ \\t]*[:：]`, 'i'),
    new RegExp(
      `调用工具[ \\t]*[:：][ \\t]*(?:${alternatives})[ \\t]*(?:\\r?\\n[ \\t]*)?(?:参数|arguments?)[ \\t]*[:：]`,
      'i',
    ),
    new RegExp(
      `(?:调用工具|tool(?:_call)?|function(?:_call)?)[ \\t]*[:：][ \\t]*(?:${alternatives})[ \\t]*\\(`,
      'i',
    ),
    new RegExp(`(?:^|\\n)[ \\t]*(?:ScholarHarness[.\\s]+)?(?:${alternatives})[ \\t]*\\(`, 'i'),
  ];
  let earliest = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const start = match.index + (match[0].startsWith('\n') ? 1 : 0);
    if (earliest === -1 || start < earliest) earliest = start;
  }
  return earliest;
}

/**
 * Keep a small streaming tail so a JSON envelope split across chunks can be
 * classified before it reaches the chat bubble. If a registered tool envelope
 * is found, everything from that envelope onward stays pending until the full
 * model response is safely parsed.
 */
export function partitionTextualToolProgress(
  value: string,
  tools: LLMToolDefinition[],
  tailChars = 192,
): TextualToolProgressPartition {
  const artifactStart = findTextualToolArtifactStart(value, tools);
  if (artifactStart >= 0) {
    return {
      visible: value.slice(0, artifactStart),
      pending: value.slice(artifactStart),
      holdingToolArtifact: true,
    };
  }
  if (looksLikeTextualToolCallPrefix(value)) {
    // A prose prefix such as “我来查找……” is only provisional. Keep
    // reclassifying it as more chunks arrive; only a registered JSON/header
    // envelope makes the hold sticky.
    return { visible: '', pending: value, holdingToolArtifact: false };
  }
  const keep = Math.max(64, Math.min(512, Math.floor(tailChars)));
  if (value.length <= keep) {
    return { visible: '', pending: value, holdingToolArtifact: false };
  }
  return {
    visible: value.slice(0, value.length - keep),
    pending: value.slice(value.length - keep),
    holdingToolArtifact: false,
  };
}

function extractBalancedJsonObjects(content: string): JsonObjectCandidate[] {
  const results: JsonObjectCandidate[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const start = content.indexOf('{', cursor);
    if (start === -1) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let index = start; index < content.length; index += 1) {
      const char = content[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === '{') {
        depth += 1;
      } else if (char === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      const parsed = JSON.parse(content.slice(start, end)) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        results.push({ start, end, value: parsed as Record<string, unknown> });
      }
    } catch {
      // Not a JSON object; continue after this opening brace and look again.
    }
    cursor = end > start ? end : start + 1;
  }
  return results;
}

function normalizeToolArguments(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
  const args = { ...input };
  if (toolName === 'file_search' && !String(args.query || '').trim() && typeof args.pattern === 'string') {
    args.query = args.pattern.trim();
    delete args.pattern;
  }
  if (toolName === 'grep_files' && !String(args.pattern || '').trim() && typeof args.query === 'string') {
    args.pattern = args.query.trim();
    delete args.query;
  }
  if (toolName === 'read_page_context') {
    const nestedOptions = args.options && typeof args.options === 'object' && !Array.isArray(args.options)
      ? args.options as Record<string, unknown>
      : undefined;
    if (!String(args.focus || '').trim()) {
      if (typeof args.sectionKey === 'string' && args.sectionKey.trim()) {
        args.focus = args.sectionKey.trim();
      } else if (typeof nestedOptions?.chapterKey === 'string' && nestedOptions.chapterKey.trim()) {
        args.focus = nestedOptions.chapterKey.trim();
      } else if (typeof nestedOptions?.focus === 'string' && nestedOptions.focus.trim()) {
        args.focus = nestedOptions.focus.trim();
      } else if (Array.isArray(args.keys)) {
        const keys = args.keys.map(value => String(value || '').trim()).filter(Boolean);
        if (keys.length > 0) args.focus = keys.join(', ');
      } else if (typeof args.query === 'string' && args.query.trim()) {
        args.focus = args.query.trim();
      }
    }
    // These aliases are frequently invented by models but are not part of the
    // registered schema. Convert them before direct execution so the resource
    // loader receives the same shape as a native tool call.
    delete args.sectionKey;
    delete args.keys;
    delete args.query;
    delete args.options;
  }
  return args;
}

function hasRequiredArguments(tool: LLMToolDefinition, args: Record<string, unknown>): boolean {
  const required = Array.isArray(tool.function.parameters?.required)
    ? tool.function.parameters.required
    : [];
  return required.every(key => {
    const value = args[key];
    return value !== undefined && value !== null && (typeof value !== 'string' || value.trim().length > 0);
  });
}

function buildToolCall(
  tool: LLMToolDefinition,
  args: Record<string, unknown>,
  index: number,
): LLMToolCall | null {
  const normalized = normalizeToolArguments(tool.function.name, args);
  if (!hasRequiredArguments(tool, normalized)) return null;
  return {
    id: `text_tool_call_${Date.now()}_${index}`,
    type: 'function',
    function: {
      name: tool.function.name,
      arguments: JSON.stringify(normalized),
    },
  };
}

function isSafeToolIntentNarrative(value: string): boolean {
  const narrative = value
    .replace(/<\/?(?:tool_call|function_call)>/gi, '')
    .replace(/```(?:json|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/[\s:：,，。;；-]+/g, ' ')
    .trim();
  if (!narrative) return true;
  if (narrative.length > 500 || /(?:示例|例如|演示|格式如下|不要调用|不要执行|example|for example|do not (?:call|execute))/i.test(narrative)) {
    return false;
  }
  return /(?:我来|我先|让我|请让我|现在|接下来|正在|先|将|开始|准备|好的|可以).{0,100}(?:查找|搜索|读取|查看|检查|定位|调用|执行|打开|分析)/s.test(narrative)
    || /(?:I(?:'ll|\s+will)?|let me|now|next).{0,100}(?:search|find|read|inspect|call|execute|open|analy[sz]e)/is.test(narrative);
}

function recoverNamedJsonToolEnvelope(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const candidates = extractBalancedJsonObjects(content);
  if (candidates.length !== 1) return [];
  const candidate = candidates[0];
  const value = candidate.value;
  const rawName = String(value.name || value.tool || '').trim();
  if (!rawName) return [];
  const unqualifiedName = rawName.split('.').pop() || rawName;
  const tool = tools.find(item => item.function.name === rawName || item.function.name === unqualifiedName);
  if (!tool) return [];

  const rawArgs = value.arguments ?? value.parameters ?? value.input ?? {};
  let args: Record<string, unknown>;
  if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  } else if (typeof rawArgs === 'string') {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
      args = parsed as Record<string, unknown>;
    } catch {
      return [];
    }
  } else {
    return [];
  }

  const narrative = `${content.slice(0, candidate.start)}${content.slice(candidate.end)}`;
  if (!isSafeToolIntentNarrative(narrative)) return [];
  const call = buildToolCall(tool, args, 0);
  return call ? [call] : [];
}

/**
 * Recover the repeated `.tool_call:{...}` content protocol emitted by some
 * OpenAI-compatible models. Validate every envelope, deduplicate exact calls,
 * and execute at most one bounded batch even if the provider repeats a large
 * block in the same response.
 */
function recoverDotToolCallEnvelopes(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const candidatesByStart = new Map(
    extractBalancedJsonObjects(content).map(candidate => [candidate.start, candidate]),
  );
  const markerPattern = /\.tool_call\s*:\s*(?=\{)/gi;
  const toolsByName = new Map(tools.map(tool => [tool.function.name.toLowerCase(), tool]));
  const calls: LLMToolCall[] = [];
  const signatures = new Set<string>();
  const ranges: Array<{ start: number; end: number }> = [];
  let envelopeCount = 0;
  let match: RegExpExecArray | null;

  while ((match = markerPattern.exec(content)) !== null) {
    envelopeCount += 1;
    if (envelopeCount > MAX_DOT_TOOL_CALL_ENVELOPES) return [];
    const objectStart = content.indexOf('{', markerPattern.lastIndex);
    if (objectStart < 0 || content.slice(markerPattern.lastIndex, objectStart).trim()) return [];
    const candidate = candidatesByStart.get(objectStart);
    if (!candidate) return [];

    const rawName = String(candidate.value.name || candidate.value.tool || '').trim();
    const unqualifiedName = rawName.split('.').pop() || rawName;
    const tool = toolsByName.get(rawName.toLowerCase()) || toolsByName.get(unqualifiedName.toLowerCase());
    if (!tool) return [];

    const rawArgs = candidate.value.arguments ?? candidate.value.parameters ?? candidate.value.input ?? {};
    let args: Record<string, unknown>;
    if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
      args = rawArgs as Record<string, unknown>;
    } else if (typeof rawArgs === 'string') {
      try {
        const parsed = JSON.parse(rawArgs) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
        args = parsed as Record<string, unknown>;
      } catch {
        return [];
      }
    } else {
      return [];
    }

    const call = buildToolCall(tool, args, calls.length);
    if (!call) return [];
    const signature = `${call.function.name}\n${call.function.arguments}`;
    if (!signatures.has(signature) && calls.length < MAX_TEXTUAL_TOOL_CALLS_PER_RESPONSE) {
      const suppliedId = String(candidate.value.id || '').trim();
      if (suppliedId && suppliedId.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(suppliedId)) {
        call.id = suppliedId;
      }
      signatures.add(signature);
      calls.push(call);
    }
    ranges.push({ start: match.index, end: candidate.end });
    markerPattern.lastIndex = candidate.end;
  }

  if (envelopeCount === 0 || calls.length === 0) return [];
  const narrative = ranges.reduceRight(
    (value, range) => `${value.slice(0, range.start)}${value.slice(range.end)}`,
    content,
  );
  return isSafeToolIntentNarrative(narrative) ? calls : [];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function parseTaggedFunctionArguments(value: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  const parameterPattern = /<parameter(?:\s*=\s*([A-Za-z_][\w-]*)|\s+name\s*=\s*["']([A-Za-z_][\w-]*)["'])\s*>([\s\S]*?)<\/parameter\s*>/gi;
  let cursor = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  while ((match = parameterPattern.exec(value)) !== null) {
    if (value.slice(cursor, match.index).trim()) return null;
    const key = match[1] || match[2];
    if (!key || Object.prototype.hasOwnProperty.call(args, key)) return null;
    args[key] = parseLooseScalar(decodeXmlEntities(match[3]));
    cursor = parameterPattern.lastIndex;
    count += 1;
    if (count > 64) return null;
  }
  if (value.slice(cursor).trim()) return null;
  return args;
}

function recoverTaggedFunctionToolCalls(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const blockPattern = /<function(?:\s*=\s*([A-Za-z_][\w.-]*)|\s+name\s*=\s*["']([A-Za-z_][\w.-]*)["'])\s*>([\s\S]*?)<\/function\s*>/gi;
  const toolsByName = new Map(tools.map(tool => [tool.function.name.toLowerCase(), tool]));
  const calls: LLMToolCall[] = [];
  const ranges: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(content)) !== null) {
    const rawName = match[1] || match[2] || '';
    const unqualifiedName = rawName.split('.').pop() || rawName;
    const tool = toolsByName.get(rawName.toLowerCase()) || toolsByName.get(unqualifiedName.toLowerCase());
    if (!tool) return [];
    const args = parseTaggedFunctionArguments(match[3]);
    if (!args) return [];
    const call = buildToolCall(tool, args, calls.length);
    if (!call) return [];
    calls.push(call);
    ranges.push({ start: match.index, end: blockPattern.lastIndex });
    if (calls.length > 16) return [];
  }
  if (calls.length === 0) return [];
  const narrative = ranges.reduceRight(
    (value, range) => `${value.slice(0, range.start)}${value.slice(range.end)}`,
    content,
  );
  return isSafeToolIntentNarrative(narrative) ? calls : [];
}

function recoverJsonEnvelopeToolCalls(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const candidates = extractBalancedJsonObjects(content);
  if (candidates.length === 0 || candidates.length > 8) return [];
  const toolsByName = new Map(tools.map(tool => [tool.function.name, tool]));
  const calls: LLMToolCall[] = [];
  for (const candidate of candidates) {
    const keys = Object.keys(candidate.value);
    if (keys.length !== 1) return [];
    const rawName = keys[0];
    const unqualifiedName = rawName.split('.').pop() || rawName;
    const tool = toolsByName.get(rawName) || toolsByName.get(unqualifiedName);
    const rawArgs = candidate.value[rawName];
    if (!tool || !rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) return [];
    const call = buildToolCall(tool, rawArgs as Record<string, unknown>, calls.length);
    if (!call) return [];
    calls.push(call);
  }
  const narrative = candidates
    .reduceRight((text, candidate) => `${text.slice(0, candidate.start)}${text.slice(candidate.end)}`, content);
  return isSafeToolIntentNarrative(narrative) ? calls : [];
}

function recoverToolCallsArrayEnvelope(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const candidates = extractBalancedJsonObjects(content);
  if (candidates.length !== 1) return [];
  const candidate = candidates[0];
  const keys = Object.keys(candidate.value);
  if (keys.length !== 1 || keys[0] !== 'tool_calls') return [];
  const rawCalls = candidate.value.tool_calls;
  if (!Array.isArray(rawCalls) || rawCalls.length === 0 || rawCalls.length > 16) return [];

  const toolsByName = new Map(tools.map(tool => [tool.function.name, tool]));
  const calls: LLMToolCall[] = [];
  for (const rawCall of rawCalls) {
    if (!rawCall || typeof rawCall !== 'object' || Array.isArray(rawCall)) return [];
    const callRecord = rawCall as Record<string, unknown>;
    const nestedFunction = callRecord.function && typeof callRecord.function === 'object' && !Array.isArray(callRecord.function)
      ? callRecord.function as Record<string, unknown>
      : null;
    const rawName = String(callRecord.name || nestedFunction?.name || '').trim();
    const unqualifiedName = rawName.split('.').pop() || rawName;
    const tool = toolsByName.get(rawName) || toolsByName.get(unqualifiedName);
    if (!tool) return [];

    const rawArguments = callRecord.arguments ?? nestedFunction?.arguments;
    let args: Record<string, unknown>;
    if (rawArguments && typeof rawArguments === 'object' && !Array.isArray(rawArguments)) {
      args = rawArguments as Record<string, unknown>;
    } else if (typeof rawArguments === 'string') {
      try {
        const parsed = JSON.parse(rawArguments) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return [];
        args = parsed as Record<string, unknown>;
      } catch {
        return [];
      }
    } else {
      args = {};
    }

    const call = buildToolCall(tool, args, calls.length);
    if (!call) return [];
    const suppliedId = String(callRecord.id || '').trim();
    if (suppliedId && suppliedId.length <= 200 && /^[A-Za-z0-9_.:-]+$/.test(suppliedId)) {
      call.id = suppliedId;
    }
    calls.push(call);
  }

  const narrative = `${content.slice(0, candidate.start)}${content.slice(candidate.end)}`;
  return isSafeToolIntentNarrative(narrative) ? calls : [];
}

function parseInlineToolArguments(value: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  const argumentPattern = /([A-Za-z_][\w-]*)=("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = argumentPattern.exec(value)) !== null) {
    if (value.slice(cursor, match.index).trim()) return null;
    args[match[1]] = parseLooseScalar(match[2]);
    cursor = argumentPattern.lastIndex;
  }
  if (value.slice(cursor).trim()) return null;
  return args;
}

function recoverScholarHarnessLineToolCalls(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const lines = content.split(/\r?\n/);
  const firstCallIndex = lines.findIndex(line => /^\s*ScholarHarness\s+/i.test(line));
  if (firstCallIndex < 0) return [];
  const narrative = lines.slice(0, firstCallIndex).join('\n');
  if (!isSafeToolIntentNarrative(narrative)) return [];

  const callLines = lines.slice(firstCallIndex).filter(line => line.trim());
  if (callLines.length === 0 || callLines.length > 16) return [];
  const toolsByName = new Map(tools.map(tool => [tool.function.name, tool]));
  const calls: LLMToolCall[] = [];
  for (const line of callLines) {
    const parsedLine = line.match(/^\s*ScholarHarness\s+([A-Za-z_][\w.-]*)(?:\s+([\s\S]*?))?\s*$/i);
    if (!parsedLine) return [];
    const rawName = parsedLine[1];
    const unqualifiedName = rawName.split('.').pop() || rawName;
    const tool = toolsByName.get(rawName) || toolsByName.get(unqualifiedName);
    if (!tool) return [];
    const args = parseInlineToolArguments(parsedLine[2] || '');
    if (!args) return [];
    const call = buildToolCall(tool, args, calls.length);
    if (!call) return [];
    calls.push(call);
  }
  return calls;
}

function recoverInlineLabeledToolCall(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const header = /调用工具\s*[:：]\s*([A-Za-z_][\w.-]*)\s*(?:\r?\n\s*)?(?:参数|arguments?)\s*[:：]\s*/i.exec(content);
  if (!header || header.index === undefined) return [];

  const narrative = content.slice(0, header.index);
  if (!isSafeToolIntentNarrative(narrative)) return [];

  const toolsByName = new Map(tools.map(tool => [tool.function.name, tool]));
  const rawName = header[1];
  const unqualifiedName = rawName.split('.').pop() || rawName;
  const tool = toolsByName.get(rawName) || toolsByName.get(unqualifiedName);
  if (!tool) return [];

  const argumentText = content.slice(header.index + header[0].length);
  const candidates = extractBalancedJsonObjects(argumentText);
  if (candidates.length !== 1) return [];
  const candidate = candidates[0];
  if (argumentText.slice(0, candidate.start).trim()) return [];
  if (!/^[\s。；;，,]*$/.test(argumentText.slice(candidate.end))) return [];

  const call = buildToolCall(tool, candidate.value, 0);
  return call ? [call] : [];
}

function findClosingParenthesis(value: string, openIndex: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = openIndex; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function splitTopLevelArguments(value: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quote = '';
  let escaped = false;
  let containerDepth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '[' || char === '{' || char === '(') {
      containerDepth += 1;
    } else if (char === ']' || char === '}' || char === ')') {
      containerDepth -= 1;
      if (containerDepth < 0) return null;
    } else if (char === ',' && containerDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  if (quote || containerDepth !== 0) return null;
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function parseParenthesizedArguments(value: string): Record<string, unknown> | null {
  if (!value.trim()) return {};
  const parts = splitTopLevelArguments(value);
  if (!parts || parts.length > 64) return null;
  const args: Record<string, unknown> = {};
  for (const part of parts) {
    const match = part.match(/^([A-Za-z_][\w-]*)\s*(?:=|:)\s*([\s\S]+)$/);
    if (!match || Object.prototype.hasOwnProperty.call(args, match[1])) return null;
    args[match[1]] = parseLooseScalar(match[2]);
  }
  return args;
}

function recoverParenthesizedToolCall(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const alternatives = tools.map(tool => escapeRegExp(tool.function.name)).filter(Boolean).join('|');
  if (!alternatives) return [];
  const header = new RegExp(
    `(?:(?:调用工具|tool(?:_call)?|function(?:_call)?)[ \\t]*[:：][ \\t]*)?(?:ScholarHarness[.\\s]+)?(${alternatives})[ \\t]*\\(`,
    'i',
  ).exec(content);
  if (!header || header.index === undefined) return [];
  const openIndex = header.index + header[0].lastIndexOf('(');
  const closeIndex = findClosingParenthesis(content, openIndex);
  if (closeIndex < 0 || !/^[\s。；;，,.]*$/.test(content.slice(closeIndex + 1))) return [];
  const narrative = content.slice(0, header.index);
  if (!isSafeToolIntentNarrative(narrative)) return [];

  const rawName = header[1];
  const tool = tools.find(item => item.function.name.toLowerCase() === rawName.toLowerCase());
  if (!tool) return [];
  const args = parseParenthesizedArguments(content.slice(openIndex + 1, closeIndex));
  if (!args) return [];
  const call = buildToolCall(tool, args, 0);
  return call ? [call] : [];
}

export function recoverTextualToolCalls(
  content: string,
  tools: LLMToolDefinition[],
): LLMToolCall[] {
  const normalized = stripSingleCodeFence(content);
  const dotToolCalls = recoverDotToolCallEnvelopes(normalized, tools);
  if (dotToolCalls.length > 0) return dotToolCalls;
  const arrayEnvelopeCalls = recoverToolCallsArrayEnvelope(normalized, tools);
  if (arrayEnvelopeCalls.length > 0) return arrayEnvelopeCalls;
  const scholarHarnessLineCalls = recoverScholarHarnessLineToolCalls(normalized, tools);
  if (scholarHarnessLineCalls.length > 0) return scholarHarnessLineCalls;
  const inlineLabeledCalls = recoverInlineLabeledToolCall(normalized, tools);
  if (inlineLabeledCalls.length > 0) return inlineLabeledCalls;
  const parenthesizedCalls = recoverParenthesizedToolCall(normalized, tools);
  if (parenthesizedCalls.length > 0) return parenthesizedCalls;
  const taggedFunctionCalls = recoverTaggedFunctionToolCalls(normalized, tools);
  if (taggedFunctionCalls.length > 0) return taggedFunctionCalls;
  const namedEnvelopeCalls = recoverNamedJsonToolEnvelope(normalized, tools);
  if (namedEnvelopeCalls.length > 0) return namedEnvelopeCalls;
  const header = normalized.match(
    /^(?:[-*]\s*)?(?:🔧\s*)?(?:调用工具|tool(?:_call)?|function(?:_call)?|call(?:ing)?\s+(?:the\s+)?tool)\s*[:：]\s*([A-Za-z_][\w.-]*)\s*(?:\r?\n|$)([\s\S]*)$/i,
  );
  if (!header) return recoverJsonEnvelopeToolCalls(normalized, tools);

  const toolsByName = new Map(tools.map(tool => [tool.function.name, tool]));
  const rawName = header[1];
  const unqualifiedName = rawName.split('.').pop() || rawName;
  const tool = toolsByName.get(rawName) || toolsByName.get(unqualifiedName);
  if (!tool) return [];

  const body = header[2].trim();
  let args: Record<string, unknown> = {};
  if (body) {
    try {
      const parsed = JSON.parse(body) as unknown;
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return [];
      args = parsed as Record<string, unknown>;
    } catch {
      const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      for (const line of lines) {
        const argument = line.match(/^(?:[-*]\s*)?([A-Za-z_][\w-]*)\s*[:：=]\s*(.+)$/);
        if (!argument) return [];
        args[argument[1]] = parseLooseScalar(argument[2]);
      }
    }
  }

  const call = buildToolCall(tool, args, 0);
  return call ? [call] : [];
}
