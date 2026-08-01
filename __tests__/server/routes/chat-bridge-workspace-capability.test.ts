import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const route = readFileSync(
  path.resolve(__dirname, '../../../src/server/routes/chat-bridge.ts'),
  'utf-8',
);

describe('ChatBridge workspace capability attachment', () => {
  it('keeps an explicitly configured workspace attached regardless of query classification', () => {
    expect(
      route.match(/const workspaceContext = configuredWorkspaceContext;/g),
    ).toHaveLength(2);
    expect(route).not.toContain(
      'const workspaceContext = contextForPrompt.queryIntent?.needsWorkspaceSearch === true',
    );
    expect(route).toContain('aiWorkRoot: configuredWorkspaceContext.aiWorkRoot || configuredWorkspaceContext.safeWorkRoot');
    expect(route).toContain('safeWorkRoot: configuredWorkspaceContext.safeWorkRoot || configuredWorkspaceContext.aiWorkRoot');
  });

  it('allows legacy workspace tool blocks only when a workspace is configured', () => {
    expect(route).toContain('if (context?.workspaceDirectory)');
    expect(route).toContain('当前请求没有配置工作目录。');
    expect(route).not.toContain('本轮经过校验的 Query Intent 未授权工作目录访问');
  });

  it('passes the chat conversation identity into workspace resolution', () => {
    expect(route).toContain('if (workspaceInput && !workspaceInput.conversationId)');
    expect(route).toContain(
      "workspaceInput.conversationId = String(conversationId || rawEnvelopeRecord.sessionId || '').trim() || undefined;",
    );
  });
});
