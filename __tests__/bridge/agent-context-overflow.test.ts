import { describe, expect, it } from 'vitest';

import { isCodingAgentContextOverflowError } from '../../src/bridge/agent-runtime/context-overflow';

describe('coding Agent context overflow classification', () => {
  it.each([
    'Codex error: Your input exceeds the context window of this model.',
    'context_length_exceeded',
    'maximum context length is 128000 tokens',
    'Prompt is too long for this model',
    'Codex ran out of room in the model context',
  ])('recognizes prompt admission failure: %s', message => {
    expect(isCodingAgentContextOverflowError(new Error(message))).toBe(true);
  });

  it.each([
    'Selected model is at capacity',
    'Authentication failed',
    'finish_reason=max_tokens',
    'Pi turn timed out',
  ])('does not misclassify unrelated failure: %s', message => {
    expect(isCodingAgentContextOverflowError(new Error(message))).toBe(false);
  });
});
