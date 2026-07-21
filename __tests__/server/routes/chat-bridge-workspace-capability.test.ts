import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const route = readFileSync(
  path.resolve(__dirname, '../../../src/server/routes/chat-bridge.ts'),
  'utf-8',
);

describe('ChatBridge workspace capability attachment', () => {
  it('attaches authorized workspace tools after the verified intent permits file access', () => {
    expect(
      route.match(/const workspaceContext = contextForPrompt\.queryIntent\?\.needsWorkspaceSearch === true/g),
    ).toHaveLength(2);
    expect(route).toContain('aiWorkRoot: configuredWorkspaceContext.aiWorkRoot || configuredWorkspaceContext.safeWorkRoot');
    expect(route).toContain('safeWorkRoot: configuredWorkspaceContext.safeWorkRoot || configuredWorkspaceContext.aiWorkRoot');
  });

  it('passes the chat conversation identity into workspace resolution', () => {
    expect(route).toContain('if (workspaceInput && !workspaceInput.conversationId)');
    expect(route).toContain(
      "workspaceInput.conversationId = String(conversationId || rawEnvelopeRecord.sessionId || '').trim() || undefined;",
    );
  });
});
