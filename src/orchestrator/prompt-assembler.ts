/**
 * Cache-friendly prompt assembly (Phase 1 of docs/pi-agent-cache-and-dsh-plan.md).
 *
 * The provider-visible request becomes:
 *
 *   [ stable system, ...append-only history, tail runtime snapshot, current request ]
 *
 * Rules that make the DeepSeek-style prefix cache hit:
 *  1. The system prompt must be byte-identical across turns (no dynamic state).
 *  2. History is append-only: earlier messages are never rewritten in place.
 *  3. Dynamic state rides in ONE user-role "runtime context" snapshot at the
 *     tail, framed as superseding earlier snapshots, so a changed section does
 *     not touch the reusable prefix.
 *  4. Section order and serialization are deterministic.
 *  5. When over budget, only the OLDEST history messages are dropped — never
 *     mid-history rewrites, which would invalidate the prefix from the first
 *     changed token.
 */

import type { Message } from '../types';

/** One named dynamic-context contribution to the tail snapshot. */
export interface PromptSnapshotSection {
  name: string;
  order: number;
  text: string;
}

export interface AssembledPromptInput {
  /** Byte-stable system prompt; empty string omits the system message. */
  systemPrompt?: string;
  /** Append-only conversation history, oldest first. */
  history?: Array<Pick<Message, 'role' | 'content'>>;
  /** Dynamic context contributions, rendered at the tail in `order`. */
  snapshotSections?: PromptSnapshotSection[];
  /** The user's latest instruction; always the final message. */
  currentRequest: string;
  /**
   * Total budget cap for history + snapshot + request (in characters).
   * When exceeded, the OLDEST history messages are dropped first.
   * 0 or undefined means no cap.
   */
  maxChars?: number;
}

/** Header framing for the runtime snapshot; mirrors the DSH supersede pattern. */
export const RUNTIME_SNAPSHOT_HEADER =
  'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.';

/** Deterministically join snapshot sections in ascending `order`. */
export function joinSnapshotSections(sections: PromptSnapshotSection[] | undefined): string {
  if (!Array.isArray(sections) || sections.length === 0) return '';
  const body = sections
    .slice()
    .sort((a, b) => (Number.isFinite(a.order) ? a.order : 0) - (Number.isFinite(b.order) ? b.order : 0))
    .map(section => String(section.text || '').trim())
    .filter(text => text.length > 0)
    .join('\n\n');
  if (!body) return '';
  return `${RUNTIME_SNAPSHOT_HEADER}\n\n${body}`;
}

/**
 * Drop the OLDEST history messages until the combined length fits `budgetChars`.
 * Never drops the newest message; never rewrites content.
 */
export function trimHistoryToBudget(
  history: Array<Pick<Message, 'role' | 'content'>>,
  budgetChars: number,
): Array<Pick<Message, 'role' | 'content'>> {
  if (history.length === 0) return history;
  let total = 0;
  for (const message of history) total += String(message.content || '').length;
  if (total <= budgetChars) return history;
  const kept: Array<Pick<Message, 'role' | 'content'>> = [];
  let keptChars = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index];
    const length = String(message.content || '').length;
    if (kept.length > 0 && keptChars + length > budgetChars) break;
    kept.unshift(message);
    keptChars += length;
  }
  return kept;
}

/**
 * Assemble the final provider-visible message list. The result is
 * deterministic: identical input yields identical output bytes, and appending
 * history never changes earlier messages.
 */
export function assembleMessages(input: AssembledPromptInput): Message[] {
  const messages: Message[] = [];
  const systemPrompt = String(input.systemPrompt || '').trim();
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

  const history: Message[] = (input.history || [])
    .filter(message => message && String(message.content || '').trim().length > 0)
    .map(message => ({
      role: (message.role === 'system' ? 'system' : (message.role === 'assistant' ? 'assistant' : 'user')) as Message['role'],
      content: String(message.content || ''),
    }));
  const snapshot = joinSnapshotSections(input.snapshotSections);
  const currentRequest = String(input.currentRequest || '').trim();

  let boundedHistory = history;
  if (input.maxChars && input.maxChars > 0) {
    const reserved = snapshot.length + currentRequest.length;
    boundedHistory = trimHistoryToBudget(history, Math.max(0, input.maxChars - reserved));
  }

  for (const message of boundedHistory) messages.push(message);
  if (snapshot) messages.push({ role: 'user', content: snapshot });
  if (currentRequest) messages.push({ role: 'user', content: currentRequest });
  return messages;
}
