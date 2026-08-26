/**
 * Append-only session event log (Phase 2 of docs/pi-agent-cache-and-dsh-plan.md).
 *
 * Model-visible history is derived from this log (`deriveMessages`), mirroring
 * the "model-visible means logged" invariant of the DeepSeek Harness session
 * store. Events are appended to a per-conversation JSONL file:
 *
 *   <memoryDir>/<userId>/session-logs/<conversationId>.jsonl
 *
 * Append-only writes keep the model request prefix byte-stable across turns:
 * earlier events are never rewritten; a `compact` event shadows an older range
 * with one summary. A torn trailing line from a crash is tolerated on load.
 *
 * P0-1 (cache-friendly): the derived message list is cached in memory and
 * extended incrementally on append (O(new events)); a `compact` event
 * invalidates the cache and the next `deriveMessages` rebuilds it in one pass.
 * `deriveMessagesWithStats` additionally reports how much history was dropped
 * by the maxChars budget so callers can trigger compaction on overflow.
 */

import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { getMemoryDir } from '../../utils/paths';

export type SessionLogEvent =
  | { seq: number; ts: string; type: 'user'; content: string; requestId?: string; delivery?: 'steer' | 'follow_up' | 'normal' }
  | { seq: number; ts: string; type: 'assistant'; content: string; provider?: string; model?: string; usage?: Record<string, unknown> }
  | { seq: number; ts: string; type: 'tool'; name: string; input?: unknown; output?: string; ok: boolean }
  | { seq: number; ts: string; type: 'snapshot'; sections: Record<string, string> }
  | { seq: number; ts: string; type: 'compact'; summary: string; shadowed: [number, number] }
  | { seq: number; ts: string; type: 'queue'; action: 'cancelled' | 'requeued' | 'applied'; messageId: string; behavior?: 'steer' | 'follow_up' };

export type SessionLogEventType = SessionLogEvent['type'];

/** Append input without seq/ts (explicit union so callers stay type-safe). */
export type SessionLogEventInput =
  | { type: 'user'; content: string; requestId?: string; delivery?: 'steer' | 'follow_up' | 'normal' }
  | { type: 'assistant'; content: string; provider?: string; model?: string; usage?: Record<string, unknown> }
  | { type: 'tool'; name: string; input?: unknown; output?: string; ok: boolean }
  | { type: 'snapshot'; sections: Record<string, string> }
  | { type: 'compact'; summary: string; shadowed: [number, number] }
  | { type: 'queue'; action: 'cancelled' | 'requeued' | 'applied'; messageId: string; behavior?: 'steer' | 'follow_up' };

export type DerivedMessageRole = 'user' | 'assistant' | 'system';

export interface DerivedMessage {
  role: DerivedMessageRole;
  content: string;
  source: 'history' | 'snapshot' | 'compact' | 'request';
}

export interface DerivedMessagesWithStats {
  messages: DerivedMessage[];
  /** Total chars of the UNTRIMMED derived list (history + snapshots + compact summaries). */
  totalHistoryChars: number;
  /** Chars dropped by the maxChars budget (0 when no trimming happened). */
  droppedChars: number;
  /** Count of plain history-derived messages (user/assistant turns). */
  historyMessageCount: number;
}

export interface SessionLogOptions {
  userId: string;
  conversationId: string;
  /** Root memory dir; defaults to getMemoryDir(). */
  rootDir?: string;
  maxHistoryChars?: number;
}

export const RUNTIME_SNAPSHOT_HEADER =
  'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.';

const MAX_EVENT_CONTENT_CHARS = 1_500_000;

function nowIso(): string {
  return new Date().toISOString();
}

function safeSegment(value: string, fallback: string): string {
  const raw = String(value || '').trim();
  const readable = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 96) || fallback;
  return readable;
}

function sanitizeEventContent(value: unknown): string {
  const text = String(value ?? '');
  return text.length > MAX_EVENT_CONTENT_CHARS
    ? text.slice(0, MAX_EVENT_CONTENT_CHARS)
    : text;
}

function sanitizeEvent(value: unknown, fallbackSeq: number): SessionLogEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const type = String(raw.type || '');
  const seq = Number.isFinite(Number(raw.seq)) ? Math.max(1, Math.floor(Number(raw.seq))) : fallbackSeq;
  const ts = String(raw.ts || nowIso());
  switch (type) {
    case 'user': {
      const content = sanitizeEventContent(raw.content);
      if (!content.trim()) return null;
      return {
        seq,
        ts,
        type: 'user',
        content,
        ...(raw.requestId ? { requestId: String(raw.requestId).slice(0, 200) } : {}),
        ...(raw.delivery === 'steer' || raw.delivery === 'follow_up'
          ? { delivery: raw.delivery }
          : raw.delivery === 'normal' ? { delivery: 'normal' } : {}),
      };
    }
    case 'assistant': {
      const content = sanitizeEventContent(raw.content);
      return {
        seq,
        ts,
        type: 'assistant',
        content,
        ...(raw.provider ? { provider: String(raw.provider).slice(0, 128) } : {}),
        ...(raw.model ? { model: String(raw.model).slice(0, 128) } : {}),
      };
    }
    case 'tool': {
      return {
        seq,
        ts,
        type: 'tool',
        name: String(raw.name || 'tool').slice(0, 200),
        ...(raw.input !== undefined ? { input: raw.input } : {}),
        ...(raw.output !== undefined ? { output: sanitizeEventContent(raw.output) } : {}),
        ok: raw.ok === true,
      };
    }
    case 'snapshot': {
      const sections = raw.sections;
      if (!sections || typeof sections !== 'object' || Array.isArray(sections)) return null;
      const normalized: Record<string, string> = {};
      for (const [key, text] of Object.entries(sections as Record<string, unknown>)) {
        const value = sanitizeEventContent(text);
        if (value.trim()) normalized[String(key).slice(0, 200)] = value;
      }
      if (Object.keys(normalized).length === 0) return null;
      return { seq, ts, type: 'snapshot', sections: normalized };
    }
    case 'compact': {
      const summary = sanitizeEventContent(raw.summary);
      if (!summary.trim()) return null;
      const shadowed = raw.shadowed;
      if (!Array.isArray(shadowed) || shadowed.length < 2) return null;
      const start = Math.max(1, Math.floor(Number(shadowed[0])));
      const end = Math.max(start, Math.floor(Number(shadowed[1])));
      return { seq, ts, type: 'compact', summary, shadowed: [start, end] };
    }
    case 'queue': {
      const action = raw.action === 'cancelled' || raw.action === 'requeued' || raw.action === 'applied'
        ? raw.action
        : null;
      if (!action) return null;
      const messageId = String(raw.messageId || '').trim().slice(0, 200);
      if (!messageId) return null;
      return {
        seq,
        ts,
        type: 'queue',
        action,
        messageId,
        ...(raw.behavior === 'steer' || raw.behavior === 'follow_up' ? { behavior: raw.behavior } : {}),
      };
    }
    default:
      return null;
  }
}

/**
 * One conversation's event log. All operations are synchronous and fail-soft
 * on disk errors (logging instead of throwing), matching the PI session queue.
 */
export class SessionLog {
  private readonly filePath: string;
  private readonly key: string;
  private events: SessionLogEvent[] = [];
  private nextSeq = 1;
  private maxSeq = 0;
  private loaded = false;
  /** P0-1: derived-message projection cache (null = needs (re)build). */
  private derivedCache: DerivedMessage[] | null = null;

  constructor(private readonly options: SessionLogOptions) {
    const rootDir = options.rootDir || getMemoryDir();
    const safeUserId = safeSegment(options.userId, 'web-user');
    const safeConversationId = safeSegment(options.conversationId, 'conversation');
    this.key = `${safeUserId}\u0001${safeConversationId}`;
    this.filePath = path.join(rootDir, safeUserId, 'session-logs', `${safeConversationId}.jsonl`);
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const lines = fs.readFileSync(this.filePath, 'utf-8').split('\n');
      for (let index = 0; index < lines.length; index++) {
        const trimmed = lines[index].trim();
        if (!trimmed) continue;
        const event = sanitizeEvent(safeParse(trimmed), index + 1);
        if (event) {
          this.events.push(event);
          this.maxSeq = Math.max(this.maxSeq, event.seq);
        }
        // A torn trailing line fails to parse and is skipped; the log stays valid.
      }
      this.nextSeq = this.maxSeq + 1;
    } catch (error) {
      logger.warn('[SessionLog] Failed to load log; starting fresh:', error);
      this.events = [];
      this.nextSeq = 1;
      this.maxSeq = 0;
    }
  }

  private writeLine(line: string): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, `${line}\n`, 'utf-8');
    } catch (error) {
      logger.warn('[SessionLog] Append failed (log stays in memory):', error);
    }
  }

  /** Append one event; assigns seq/ts. Returns the stored event or null when invalid. */
  append(input: SessionLogEventInput): SessionLogEvent | null {
    this.ensureLoaded();
    const candidate = sanitizeEvent({ ...input, seq: this.nextSeq, ts: nowIso() }, this.nextSeq);
    if (!candidate) return null;
    this.events.push(candidate);
    this.maxSeq = Math.max(this.maxSeq, candidate.seq);
    this.nextSeq = this.maxSeq + 1;
    this.appendToDerivedCache(candidate);
    this.writeLine(JSON.stringify(candidate));
    return candidate;
  }

  /** All events in sequence order (for replay/export). */
  replay(): SessionLogEvent[] {
    this.ensureLoaded();
    return this.events.slice();
  }

  /** Highest assigned sequence number. */
  lastSeq(): number {
    this.ensureLoaded();
    return this.maxSeq;
  }

  /**
   * Compact a shadowed event range into one summary. The `compact` event is
   * appended to the log (durable record), and derived messages replace the
   * shadowed range with the summary. Appending a compact event invalidates the
   * projection cache; the next derive rebuilds it in one pass.
   */
  compact(range: { start: number; end: number }, summary: string): SessionLogEvent | null {
    this.ensureLoaded();
    const start = Math.max(1, Math.floor(Number(range.start)));
    const end = Math.max(start, Math.floor(Number(range.end)));
    return this.append({ type: 'compact', summary: sanitizeEventContent(summary), shadowed: [start, end] });
  }

  /**
   * Derive the model-visible message list from the log. Snapshot events render
   * as user-role runtime-context snapshots; compact events replace their
   * shadowed range with the summary AT THE RANGE'S ORIGINAL POSITION. When
   * `maxChars` is set, the OLDEST history messages are dropped first (never
   * mid-history rewrites).
   */
  deriveMessages(options?: { maxChars?: number }): DerivedMessage[] {
    return this.deriveMessagesWithStats(options).messages;
  }

  /**
   * Same as `deriveMessages` plus budget diagnostics. `totalHistoryChars` is
   * the untrimmed total; `droppedChars` reports how much the maxChars budget
   * actually removed — callers use a non-zero droppedChars as the "overflow"
   * signal to trigger compaction instead of silently losing history.
   */
  deriveMessagesWithStats(options?: { maxChars?: number }): DerivedMessagesWithStats {
    this.ensureLoaded();
    const derived = this.buildOrGetDerivedCache();
    let messages = derived;
    let droppedChars = 0;
    if (options?.maxChars && options.maxChars > 0) {
      const total = derived.reduce((sum, message) => sum + message.content.length, 0);
      if (total > options.maxChars) {
        messages = trimDerivedToBudget(derived, options.maxChars);
        droppedChars = total - messages.reduce((sum, message) => sum + message.content.length, 0);
      }
    }
    return {
      messages,
      totalHistoryChars: derived.reduce((sum, message) => sum + message.content.length, 0),
      droppedChars,
      historyMessageCount: derived.filter(message => message.source === 'history').length,
    };
  }

  /** Build the projection cache in one pass over all events (O(n), only after load or compact). */
  private buildOrGetDerivedCache(): DerivedMessage[] {
    if (this.derivedCache !== null) return this.derivedCache;
    const derived: DerivedMessage[] = [];
    const shadowed = new Set<number>();
    const replacements: Array<{ start: number; summary: string }> = [];
    // First pass: collect compaction ranges.
    for (const event of this.events) {
      if (event.type === 'compact') {
        for (let seq = event.shadowed[0]; seq <= event.shadowed[1]; seq++) shadowed.add(seq);
        replacements.push({ start: event.shadowed[0], summary: event.summary });
      }
    }
    replacements.sort((a, b) => a.start - b.start);
    let replacementIndex = 0;
    const flushReplacementUpTo = (seq: number): void => {
      while (replacementIndex < replacements.length && replacements[replacementIndex].start <= seq) {
        const replacement = replacements[replacementIndex];
        replacementIndex += 1;
        derived.push({ role: 'user', content: `## 早期对话摘要（已压缩）\n${replacement.summary}`, source: 'compact' });
      }
    };
    for (const event of this.events) {
      if (event.type === 'compact') continue;
      flushReplacementUpTo(event.seq);
      if (shadowed.has(event.seq)) continue;
      if (event.type === 'user') {
        derived.push({ role: 'user', content: event.content, source: 'history' });
      } else if (event.type === 'assistant') {
        derived.push({ role: 'assistant', content: event.content, source: 'history' });
      } else if (event.type === 'snapshot') {
        derived.push({ role: 'user', content: renderSnapshot(event.sections), source: 'snapshot' });
      }
      // tool/queue events are recorded but never surface as model messages.
    }
    flushReplacementUpTo(Number.POSITIVE_INFINITY);
    this.derivedCache = derived;
    return derived;
  }

  /**
   * Extend the projection cache with one newly appended event (O(1)). A
   * `compact` event invalidates the cache: later ranges can only be decided
   * with the full log, so the next derive rebuilds. Tool/queue events are
   * log-only and never surface.
   */
  private appendToDerivedCache(event: SessionLogEvent): void {
    if (this.derivedCache === null) return;
    if (event.type === 'compact') {
      this.derivedCache = null;
      return;
    }
    if (event.type === 'user') {
      this.derivedCache.push({ role: 'user', content: event.content, source: 'history' });
    } else if (event.type === 'assistant') {
      this.derivedCache.push({ role: 'assistant', content: event.content, source: 'history' });
    } else if (event.type === 'snapshot') {
      this.derivedCache.push({ role: 'user', content: renderSnapshot(event.sections), source: 'snapshot' });
    }
  }

  /** Delete the persisted log (session reset). */
  clear(): void {
    this.loaded = true;
    this.events = [];
    this.nextSeq = 1;
    this.maxSeq = 0;
    this.derivedCache = null;
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch (error) {
      logger.warn('[SessionLog] Clear failed:', error);
    }
  }
}

function safeParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function renderSnapshot(sections: Record<string, string>): string {
  const body = Object.entries(sections)
    .map(([, text]) => String(text || '').trim())
    .filter(text => text.length > 0)
    .join('\n\n');
  return `${RUNTIME_SNAPSHOT_HEADER}\n\n${body}`;
}

/** Drop the OLDEST derived messages first; keep snapshot/request tails when possible. */
function trimDerivedToBudget(derived: DerivedMessage[], maxChars: number): DerivedMessage[] {
  let total = 0;
  for (const message of derived) total += message.content.length;
  if (total <= maxChars) return derived;
  const kept: DerivedMessage[] = [];
  let keptChars = 0;
  for (let index = derived.length - 1; index >= 0; index--) {
    const message = derived[index];
    const length = message.content.length;
    if (kept.length > 0 && keptChars + length > maxChars) break;
    kept.unshift(message);
    keptChars += length;
  }
  return kept;
}

/** In-process registry so a conversation log is loaded once. */
const logRegistry = new Map<string, SessionLog>();

export function getSessionLog(options: SessionLogOptions): SessionLog {
  const rootDir = options.rootDir || getMemoryDir();
  const safeUserId = safeSegment(options.userId, 'web-user');
  const safeConversationId = safeSegment(options.conversationId, 'conversation');
  const key = `${safeUserId}\u0001${safeConversationId}\u0001${rootDir}`;
  const existing = logRegistry.get(key);
  if (existing) return existing;
  const log = new SessionLog({ ...options, rootDir });
  logRegistry.set(key, log);
  return log;
}

export function dropSessionLog(userId: string, conversationId: string, rootDir?: string): void {
  const resolvedRoot = rootDir || getMemoryDir();
  const safeUserId = safeSegment(userId, 'web-user');
  const safeConversationId = safeSegment(conversationId, 'conversation');
  const key = `${safeUserId}\u0001${safeConversationId}\u0001${resolvedRoot}`;
  const log = logRegistry.get(key);
  if (log) {
    log.clear();
    logRegistry.delete(key);
  }
}
