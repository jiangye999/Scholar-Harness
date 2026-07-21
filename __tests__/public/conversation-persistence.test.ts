import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('conversation persistence', () => {
  it('stores the user turn immediately instead of waiting for the AI response', () => {
    expect(html).toMatch(
      /savedMsgs\.push\(\{ role: 'user', content: actualMessage,[\s\S]*?\}\);\s*storeConversationMessagesLocally\(activeConversationId, savedMsgs\);/,
    );
    expect(html).toMatch(
      /savedMsgs\.push\(\{ role: 'user', content: originalMessage \|\| address,[\s\S]*?\}\);\s*storeConversationMessagesLocally\(projectImportConversationId, savedMsgs\);/,
    );
  });

  it('adds non-empty conversations to history as soon as they are stored', () => {
    expect(html).toContain('function ensureConversationHistoryEntry(conversationId, messages, options)');
    expect(html).toContain('ensureConversationHistoryEntry(conversationId, messages, options);');
    expect(html).toContain('history.unshift({');
  });

  it('syncs conversation changes and flushes the latest local copy during shutdown', () => {
    expect(html).toContain('function scheduleConversationPersistence(conversationId)');
    expect(html).toContain("window.addEventListener('pagehide', persistCurrentConversationForLifecycle)");
    expect(html).toContain("window.addEventListener('beforeunload', persistCurrentConversationForLifecycle)");
    expect(html).toContain("navigator.sendBeacon(");
    expect(html).toContain("{ preferBeacon: true, keepalive: true }");
  });

  it('recovers old locally stored conversations that were never added to history', () => {
    expect(html).toContain('function recoverLocalConversationsIntoHistory()');
    expect(html).toMatch(
      /recoverLocalConversationsIntoHistory\(\);[\s\S]*?currentConversationId = createConversationId\(\);/,
    );
  });

  it('also flushes the previous conversation when a new chat is created', () => {
    expect(html).toMatch(/var oldConvId = currentConversationId;[\s\S]*?persistConversationNow\(oldConvId\);/);
  });
});
