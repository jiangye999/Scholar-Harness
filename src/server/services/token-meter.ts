/**
 * Token estimation for compaction pressure (Phase 3).
 *
 * Reuses the CJK-aware heuristic from `estimateAgentPromptTokens` and adds a
 * per-session rolling counter so the compaction service can decide when
 * derived history exceeds the pressure threshold.
 */

import { estimateAgentPromptTokens } from '../../orchestrator/agent-context-budget';

export function estimateTokens(value: string | undefined | null): number {
  return estimateAgentPromptTokens(String(value ?? ''));
}

/** Rolling token accounting for one conversation's derived history. */
export class SessionTokenMeter {
  private count = 0;

  addTokens(text: string | undefined | null): number {
    const tokens = estimateTokens(text);
    this.count += tokens;
    return tokens;
  }

  get tokens(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
  }

  /** Total tokens of a message list, without mutating the meter. */
  static totalTokens(messages: Array<{ content: string }>): number {
    return messages.reduce((total, message) => total + estimateTokens(message.content), 0);
  }
}
