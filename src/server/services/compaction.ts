/**
 * Context compaction (Phase 3 of docs/pi-agent-cache-and-dsh-plan.md).
 *
 * When derived history exceeds a token-pressure threshold, the OLDEST
 * contiguous span of user/assistant turns is summarized into one user-role
 * checkpoint via `SessionLog.compact`. The span is selected so it never ends
 * mid-turn (a span must end on an assistant event) and never shadows the
 * newest two messages. Compaction touches only the head of the history, so the
 * recent tail — and therefore the reusable request prefix — stays intact.
 */

import type { SessionLog, SessionLogEvent, DerivedMessage } from './session-log';
import { estimateTokens } from './token-meter';

export interface CompactionRange {
  start: number;
  end: number;
}

export interface CompactionOptions {
  /**
   * Token-pressure threshold on the full derived history. Compaction runs only
   * when `estimateTokens(historyText) >= thresholdTokens`.
   */
  thresholdTokens: number;
  /**
   * Fraction (0..1) of history chars the selected span may cover at most.
   * Defaults to 0.5 (never compact more than half of the history at once).
   */
  maxSpanFraction?: number;
  /** Always keep the newest N messages out of any span. Defaults to 2. */
  keepNewest?: number;
}

export interface CompactionResult {
  compacted: boolean;
  reason: string;
  range?: CompactionRange;
  shadowedMessages?: number;
  summaryTokens?: number;
}

const DEFAULT_MAX_SPAN_FRACTION = 0.5;
const DEFAULT_KEEP_NEWEST = 2;
/** Default token-pressure threshold for automatic (per-turn) compaction. */
const AUTO_COMPACTION_THRESHOLD_TOKENS = 30_000;

/** In-flight guard so one log never runs two compaction attempts concurrently. */
const compactionInFlight = new Set<SessionLog>();

/**
 * Shared summarizer prompt for compaction (auto + manual). Deterministic
 * framing keeps the request cheap; content is truncated to a bounded window.
 */
export function buildCompactionSummaryPrompt(rangeText: string): string {
  return [
    '请用不超过 300 字总结以下早期对话，保留关键决策、数字、研究背景、用户偏好和前文约束；不要编造未出现的事实。',
    '',
    String(rangeText || '').slice(0, 40_000),
  ].join('\n');
}

/**
 * Automatic compaction entry point, meant to run fire-and-forget after a
 * finished turn. Triggers on token pressure (`thresholdTokens`, default
 * 30k) or, with `force`, regardless of pressure (callers use this when the
 * history budget already dropped messages — the "overflow" signal). A
 * per-log in-flight guard prevents concurrent attempts; a failed summarizer
 * aborts without touching the log.
 */
export async function considerAutoCompaction(options: {
  sessionLog: SessionLog;
  summarize: (rangeText: string) => Promise<string>;
  thresholdTokens?: number;
  force?: boolean;
  maxSpanFraction?: number;
  keepNewest?: number;
}): Promise<CompactionResult> {
  const log = options.sessionLog;
  if (compactionInFlight.has(log)) {
    return { compacted: false, reason: 'already-running' };
  }
  const thresholdTokens = options.force
    ? 0
    : Math.max(0, Math.floor(options.thresholdTokens ?? AUTO_COMPACTION_THRESHOLD_TOKENS));
  const events = log.replay();
  const derivedMessages = log.deriveMessages();
  const historyText = derivedMessages
    .filter(message => message.source === 'history')
    .map(message => message.content)
    .join('\n');
  const totalTokens = estimateTokens(historyText);
  if (!options.force && totalTokens < thresholdTokens) {
    return {
      compacted: false,
      reason: `below-threshold (${totalTokens} < ${options.thresholdTokens ?? AUTO_COMPACTION_THRESHOLD_TOKENS})`,
    };
  }
  compactionInFlight.add(log);
  try {
    return await runCompaction({
      sessionLog: log,
      events,
      derivedMessages,
      summarize: options.summarize,
      thresholdTokens,
      maxSpanFraction: options.maxSpanFraction,
      keepNewest: options.keepNewest,
    });
  } finally {
    compactionInFlight.delete(log);
  }
}

/** Events that are model-visible history turns (user/assistant). */
function isTurnEvent(event: SessionLogEvent): event is SessionLogEvent & { type: 'user' | 'assistant' } {
  return event.type === 'user' || event.type === 'assistant';
}

/**
 * Select the oldest compaction span from the event log. Rules:
 *  - the span covers a contiguous run of user/assistant events;
 *  - it must END on an assistant event (a complete turn);
 *  - it leaves `keepNewest` messages at the tail untouched;
 *  - it covers at most `maxSpanFraction` of total history chars.
 * Returns null when no safe span exists (e.g. fewer than 4 turns).
 */
export function selectCompactionRange(
  events: SessionLogEvent[],
  options?: { maxSpanFraction?: number; keepNewest?: number },
): CompactionRange | null {
  const maxSpanFraction = options?.maxSpanFraction ?? DEFAULT_MAX_SPAN_FRACTION;
  const keepNewest = Math.max(1, Math.floor(options?.keepNewest ?? DEFAULT_KEEP_NEWEST));
  const turnEvents = events.filter(isTurnEvent);
  // Need enough turns: at least `keepNewest` retained after the span AND at
  // least 3 turns total (a 2-turn history is too short to compact safely).
  if (turnEvents.length < Math.max(6, keepNewest + 4)) return null;

  const totalChars = turnEvents.reduce((total, event) => total + String(event.content || '').length, 0);
  const spanBudget = Math.floor(totalChars * maxSpanFraction);

  // Walk from the OLDEST turn: accumulate until the budget or an incomplete turn.
  let accumulated = 0;
  let span: SessionLogEvent[] = [];
  let index = 0;
  for (; index < turnEvents.length - keepNewest; index++) {
    const event = turnEvents[index];
    const length = String(event.content || '').length;
    if (span.length > 0 && accumulated + length > spanBudget) break;
    span.push(event);
    accumulated += length;
    // A span must end on an assistant event (complete turn); otherwise keep
    // accumulating so the cut never splits a user/assistant pair.
    if (event.type === 'assistant') {
      const next = turnEvents[index + 1];
      if (next && index + 1 < turnEvents.length - keepNewest && next.type === 'user') {
        // Safe to cut here only if the next event is a new user turn; we still
        // prefer to close the span at this assistant boundary.
        break;
      }
      if (!next || index + 1 >= turnEvents.length - keepNewest) break;
    }
  }
  if (span.length < 2) return null;
  const last = span[span.length - 1];
  if (last.type !== 'assistant') return null;
  const first = span[0];
  return { start: first.seq, end: last.seq };
}

function renderRangeText(events: SessionLogEvent[], range: CompactionRange): string {
  const lines: string[] = [];
  for (const event of events) {
    if (event.seq < range.start || event.seq > range.end) continue;
    if (isTurnEvent(event)) {
      lines.push(`${event.type === 'user' ? '用户' : 'AI'}: ${String(event.content || '').trim()}`);
    }
  }
  return lines.join('\n\n');
}

/**
 * Run one compaction attempt. `summarize` is injected by the caller (it needs
 * an LLM call); a thrown summarizer aborts the attempt without touching the
 * log, returning `{ compacted: false, reason: ... }`.
 */
export async function runCompaction(options: {
  sessionLog: SessionLog;
  events: SessionLogEvent[];
  derivedMessages: DerivedMessage[];
  summarize: (rangeText: string) => Promise<string>;
  thresholdTokens: number;
  maxSpanFraction?: number;
  keepNewest?: number;
}): Promise<CompactionResult> {
  const historyText = options.derivedMessages
    .filter(message => message.source === 'history')
    .map(message => message.content)
    .join('\n');
  const totalTokens = estimateTokens(historyText);
  if (totalTokens < options.thresholdTokens) {
    return { compacted: false, reason: `below-threshold (${totalTokens} < ${options.thresholdTokens})` };
  }
  const range = selectCompactionRange(options.events, {
    maxSpanFraction: options.maxSpanFraction,
    keepNewest: options.keepNewest,
  });
  if (!range) {
    return { compacted: false, reason: 'no-safe-span (history too short to compact)' };
  }
  const rangeText = renderRangeText(options.events, range);
  if (!rangeText.trim()) {
    return { compacted: false, reason: 'empty-span' };
  }
  let summary: string;
  try {
    summary = await options.summarize(rangeText);
  } catch (error) {
    return { compacted: false, reason: `summarizer-failed: ${(error as Error).message || String(error)}` };
  }
  const cleanSummary = String(summary || '').trim();
  if (!cleanSummary) return { compacted: false, reason: 'empty-summary' };
  const shadowed = range.end - range.start + 1;
  const appended = options.sessionLog.compact(range, cleanSummary);
  if (!appended) return { compacted: false, reason: 'compact-append-failed' };
  return {
    compacted: true,
    reason: `compacted seq ${range.start}..${range.end}`,
    range,
    shadowedMessages: shadowed,
    summaryTokens: estimateTokens(cleanSummary),
  };
}
