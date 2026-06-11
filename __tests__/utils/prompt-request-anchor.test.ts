import { describe, expect, it } from 'vitest';
import {
  anchorPromptWithCurrentRequest,
  buildAnchoredUserMessage,
  getPromptAnchorDiagnostics,
} from '../../src/utils/prompt-request-anchor';

describe('prompt-request-anchor', () => {
  it('appends the current user request at the end of a long prompt', () => {
    const request = '请把 Word 下载里的参考文献和后续正文之间空一行';
    const prompt = anchorPromptWithCurrentRequest('旧上下文\n'.repeat(100), request, {
      source: 'test'
    });

    const diagnostics = getPromptAnchorDiagnostics(prompt, request);
    expect(diagnostics.hasAnchor).toBe(true);
    expect(diagnostics.hasExactRequest).toBe(true);
    expect(diagnostics.requestIndex).toBeGreaterThan(prompt.length - 500);
  });

  it('replaces stale current request anchors instead of accumulating them', () => {
    const first = anchorPromptWithCurrentRequest('上下文', '旧请求', { source: 'first' });
    const second = anchorPromptWithCurrentRequest(first, '新请求', { source: 'second' });

    expect(second).toContain('新请求');
    expect(second).not.toContain('旧请求');
    expect((second.match(/<CURRENT_USER_REQUEST priority="highest">/g) || [])).toHaveLength(1);
  });

  it('builds a user-role message that contains the exact request and rules', () => {
    const message = buildAnchoredUserMessage('继续工作');

    expect(message).toContain('<CURRENT_USER_REQUEST priority="highest">');
    expect(message).toContain('继续工作');
    expect(message).toContain('优先级高于历史对话');
  });
});
