import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const memoryRouteSource = readFileSync(
  path.resolve(process.cwd(), 'src/server/routes/memory.ts'),
  'utf8',
);

describe('conversation persistence', () => {
  it('stores the user turn immediately instead of waiting for the AI response', () => {
    expect(html).toMatch(
      /savedMsgs\.push\(\{ role: 'user', content: actualMessage,[\s\S]*?\}\);\s*storeConversationMessagesLocally\(activeConversationId, savedMsgs, \{ projectId: activeProjectId \}\);/,
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
    expect(html).toContain('function scheduleConversationPersistence(conversationId, options)');
    expect(html).toContain("window.addEventListener('pagehide', persistCurrentConversationForLifecycle)");
    expect(html).toContain("window.addEventListener('beforeunload', persistCurrentConversationForLifecycle)");
    expect(html).toContain("navigator.sendBeacon(");
    expect(html).toContain("{ preferBeacon: true, keepalive: true }");
  });

  it('recovers old locally stored conversations that were never added to history', () => {
    expect(html).toContain('function recoverLocalConversationsIntoHistory(restoredStorageKeys)');
    expect(html).toMatch(
      /recoverLocalConversationsIntoHistory\(\);[\s\S]*?currentConversationId = createConversationId\(\);/,
    );
  });

  it('hydrates both current and legacy project-scoped histories and lazily restores messages', () => {
    expect(html).toContain('async function hydrateConversationHistoryFromServer(hydrationGeneration)');
    expect(html).toContain('function getConversationHistoryRestoreUserIds()');
    expect(html).toContain("if (userIds[0] !== 'web-user') userIds.push('web-user')");
    expect(html).toContain("var historyQuery = '?limit=300' + (projectId ? '&projectId=' + encodeURIComponent(projectId) : '')");
    expect(html).toContain("fetch('/api/memory/conversations/' + encodeURIComponent(userId) + historyQuery)");
    expect(html).toContain('var restoreResults = await Promise.all(restoreUserIds.map(fetchConversationHistoryForUser));');
    expect(html).toContain('recentConversations.concat(conversationSummaries).forEach(function(item)');
    expect(html).toContain('async function fetchPersistedConversationMessages(convId, signal)');
    expect(html).toContain("messages = readConversationMessagesFromStorageKey(MSG_KEY + 'web-user_' + convId, convId)");
    expect(html).toContain("skipServerPersistence: restoredFromUserId !== 'web-user'");
    expect(html).toContain('function refreshConversationHistory(options)');
    expect(html).toContain('window.refreshConversationHistory = refreshConversationHistory;');
    expect(html).toContain('renderHistory(merged);');
    expect(html).toContain('已忽略过期项目的历史恢复结果');
    expect(html).toMatch(/renderHistory\(\);\s*refreshConversationHistory\(\);/);
  });

  it('refreshes history when the panel opens and isolates malformed legacy entries', () => {
    expect(html).toContain("if (panelKey === 'history' && !collapsed && typeof window.refreshConversationHistory === 'function')");
    expect(html).toContain('function revealConversationHistoryPanel(options)');
    expect(html).toContain('function getConversationHistoryListElement()');
    expect(html).toContain("console.warn('[RenderHistory] 单条历史记录渲染失败，已跳过:'");
    expect(html).toContain("title.addEventListener('click'");
    expect(html).toContain("archiveButton.addEventListener('click'");
  });

  it('rebuilds an empty project history from restored message keys and restores the visible legacy conversation', () => {
    expect(html).toMatch(
      /Object\.keys\(clientState\.messages\)\.forEach\(function\(key\)[\s\S]*?recoverLocalConversationsIntoHistory\(Object\.keys\(clientState\.messages\)\);/,
    );
    expect(html).toContain('var restoredConversation = readConversationMessagesFromRestoreNamespacesLocal(currentConversationId);');
    expect(html).toContain('if (restoredConversation.messages.length > 0)');
    expect(html).toContain('var archivedIds = new Set(getArchivedConversationHistoryIds());');
    expect(html).toContain('archivedIds.has(conversationId)');
    expect(html).toContain("return STORAGE_KEY + '_archived_' + (getConversationHistoryProjectId() || 'workspace');");
    expect(html).toContain("'?projectId=' + encodeURIComponent(projectId)");
  });

  it('archives history only after the server has persisted the full conversation', () => {
    expect(html).toContain('async function archiveHistoryItem(convId)');
    expect(html).toContain("'/api/memory/conversation/' + encodeURIComponent(currentUserId || 'web-user')");
    expect(html).toContain("+ '/' + encodeURIComponent(convId) + '/archive'");
    expect(html).toContain('cancelConversationPersistence(convId, projectId);');
    expect(html).toContain('rememberArchivedConversationHistoryId(convId);');
    expect(html).toMatch(/if \(!response\.ok \|\| !result\.success\)[\s\S]*?history = history\.filter/);
    expect(html).toContain("archiveButton.setAttribute('aria-label', '归档历史对话')");
    expect(html).toContain('本地服务版本过旧。请从系统托盘完全退出 Scholar Harness 后重新打开');
  });

  it('derives a usable title from each persisted conversation file', () => {
    expect(memoryRouteSource).toContain("const firstUserMessage = messages.find((message: unknown) => {");
    expect(memoryRouteSource).toContain("const firstUserContent = String(firstUserMessage?.content || '').replace(/\\s+/g, ' ').trim();");
    expect(memoryRouteSource).toContain("const title = storedTitle || (firstUserContent");
    expect(memoryRouteSource).toMatch(/return \{[\s\S]*?title,[\s\S]*?messageCount:/);
  });

  it('mounts restored history atomically before doing non-critical preview authorization work', () => {
    expect(html).toContain('async function renderConversationMessagesAtomically(messages, requestId)');
    expect(html).toContain('var fragment = document.createDocumentFragment();');
    expect(html).toContain('messagesDiv.appendChild(fragment);');
    expect(html).not.toContain('yieldConversationRestoreFrame');
    expect(html).toContain("emptyState.innerHTML = '<h1>历史对话</h1><p>正在恢复消息...</p>'");
    expect(html).toMatch(
      /var rendered = await renderConversationMessagesAtomically\(messages, requestId\);[\s\S]*?setTimeout\(function\(\) \{[\s\S]*?restorePreviewAuthorizationForMessages\(messages\)/,
    );
    expect(html).toContain('loadLiteratureFromServer({ preserveChatState: true });');
    expect(html).toContain('var preserveChatState = settings.preserveChatState === true;');
    expect(html).not.toMatch(
      /await restorePreviewAuthorizationForMessages\(messages\);[\s\S]*?appendMessage/,
    );
  });

  it('keeps the homepage interactive while loading only a lightweight literature summary', () => {
    expect(html).toContain("?summaryOnly=1");
    expect(html).toContain("serverBacked: true");
    expect(html).toContain("文献库摘要在后台加载，首页立即可用");
    expect(html).toContain("var chatAlreadyStarted = !!(");
    expect(html).toContain("messagesDiv.querySelector('.message.user')");
    expect(html).toContain("messagesDiv.querySelector('.literature-summary-message')");
    expect(html).not.toContain("正在加载您的' + getProjectUiLabels().embeddingLibrary");
    expect(html).not.toContain("正在加载您的资料库");
    expect(html).not.toContain("正在加载您的文献库");
  });

  it('keeps the literature count visible when the user sends before the summary request finishes', () => {
    expect(html).toContain('prependToConversation: chatAlreadyStarted');
    expect(html).toContain('if (!existingLiteratureSummary)');
    expect(html).toContain('messagesDiv.insertBefore(summaryMessage, messagesDiv.firstElementChild)');
    expect(html).not.toContain('if (!chatAlreadyStarted && !existingLiteratureSummary)');
  });

  it('falls back to server persistence when a large conversation exceeds localStorage quota', () => {
    expect(html).toContain('var storedLocally = false;');
    expect(html).toContain('会话体积超出本地缓存容量，继续使用服务端持久化');
    expect(html).toMatch(
      /if \(storedLocally\) \{[\s\S]*?scheduleConversationPersistence\(conversationId, \{ projectId: targetProjectId, messages: messages \}\);[\s\S]*?\} else \{[\s\S]*?sendConversationPersistenceRequest/,
    );
  });

  it('also flushes the previous conversation when a new chat is created', () => {
    expect(html).toMatch(/var oldConvId = currentConversationId;[\s\S]*?persistConversationNow\(oldConvId\);/);
  });

  it('keeps long history titles and their delete control on one row', () => {
    expect(html).toContain("title.className = 'history-item-title'");
    expect(html).toMatch(/\.history-item\s*\{[^}]*display:\s*flex;[^}]*flex-wrap:\s*nowrap;/);
    expect(html).toMatch(/\.history-item-title\s*\{[^}]*flex:\s*1 1 auto;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
    expect(html).toMatch(/\.history-item \.delete\s*\{[^}]*flex:\s*0 0 auto;/);
  });

  it('keeps bibliometrics chats in a dedicated persisted conversation scope', () => {
    expect(html).toContain("var BIBLIOMETRICS_CONVERSATION_PREFIX = 'bibliometrics-chat-'");
    expect(html).toContain('function createBibliometricsConversationId()');
    expect(html).toContain('function getBibliometricsConversationHistory()');
    expect(html).toContain('window.getBibliometricsConversationHistory = getBibliometricsConversationHistory;');
    expect(html).toContain("chatOptions.scope === 'bibliometrics'");
    expect(html).toContain('return item && !isBibliometricsConversationId(item.id);');
  });
});
