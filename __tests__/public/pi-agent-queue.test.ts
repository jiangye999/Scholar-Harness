import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const route = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');
const executionKernel = readFileSync(
  path.resolve(__dirname, '../../src/server/services/agent-execution-kernel.ts'),
  'utf-8',
);
const codexAppServer = readFileSync(path.resolve(__dirname, '../../src/bridge/chat-bridge/codex-app-server.ts'), 'utf-8');
const localServer = readFileSync(path.resolve(__dirname, '../../src/server/local-server.ts'), 'utf-8');

describe('Pi-style discussion writing queue', () => {
  it('recovers a stale homepage generating state before queueing a new instruction', () => {
    expect(html).toContain('function hasActiveMainChatRunVisual()');
    expect(html).toContain('function recoverStaleMainChatFrontendRun(reason)');
    expect(html).toContain("recoverStaleMainChatFrontendRun('server reports no active Pi run')");
    expect(html).toContain("recoverStaleMainChatFrontendRun('new homepage instruction')");
    expect(html).toContain("sendBtn.classList.remove('sending', 'can-stop', 'queue-ready')");
  });

  it('keeps the composer interactive without showing steer/follow-up mode bubbles', () => {
    expect(html).toContain("panel.id = 'mainChatPiQueuePanel';");
    expect(html).not.toContain('width: 66.6667%;');
    expect(html).toContain('align-self: stretch;');
    expect(html).toContain('margin: 0;');
    expect(html).toContain('.pi-queue-panel { width: 100%; }');
    expect(html).not.toContain('id="piFollowUpModeBtn"');
    expect(html).not.toContain('id="piSteerModeBtn"');
    expect(html).toContain('#mainChatPiQueuePanel.pi-queue-panel');
    expect(html).toContain('background: #44484f;');
    expect(html).toContain('padding-top: 10px;');
    expect(html).toContain('backdrop-filter: blur(22px) saturate(150%) contrast(1.04);');
    expect(html).toContain('backdrop-filter: blur(20px) saturate(142%);');
    expect(html).toContain('#mainChatPiQueuePanel .pi-queue-title');
    expect(html).toContain('color: #ffffff;');
    expect(html).toContain('Ctrl+Enter 始终转向');
    expect(html).toContain("piBehavior: isGenerating && (e.ctrlKey || e.metaKey) ? 'steer' : undefined");
    expect(html).toContain('userInput.disabled = false;');
  });

  it('animates both the live core and its outer ring only while running', () => {
    expect(html).toContain('@keyframes pi-queue-live-core-pulse');
    expect(html).toContain('@keyframes pi-queue-live-ring-pulse');
    expect(html).toContain(
      '.pi-queue-panel.running .pi-queue-live-dot::after',
    );
    expect(html).toContain(
      'animation: pi-queue-live-core-pulse 1.35s ease-in-out infinite;',
    );
    expect(html).toContain(
      'animation: pi-queue-live-ring-pulse 1.35s ease-out infinite;',
    );
  });

  it('merges the running state into the transcript and reserves the queue panel for queued input', () => {
    expect(html).toContain('function createMainChatPiQueuePanel()');
    expect(html).toContain('function attachMainChatPiQueuePanelToMessage(messageDiv)');
    expect(html).toContain('messageDiv.insertBefore(panel, content);');
    expect(html).toContain('attachMainChatPiQueuePanelToMessage(thinkingDiv);');
    expect(html).toContain("'运行中 · 可继续输入' + (elapsed ? ' · ' + elapsed : '')");
    expect(html).toContain('agent-transcript-live-dot');
    expect(html).toContain('.agent-transcript.is-running');
    expect(html).toContain('border-color: #44484f;');
    expect(html).toContain('background: #44484f;');
    expect(html).toContain("mainChatPiQueueHostMessage.querySelector('.agent-transcript.is-running')");
    expect(html).toContain('|| (running && !hasRunningTranscript)');
    expect(html).toContain('renderMainChatPiQueue(mainChatPiState);');
    expect(html).toContain('id="mainChatPiQueueItems"');
    expect(html).toContain("return behavior === 'steer' ? '转向当前任务：' : '后续执行：';");
    expect(html).not.toContain('<div class="pi-queue-list"');
    expect(html).not.toContain('<div class="pi-queue-help"');
  });

  it('keeps running transcripts and normal assistant bubbles on the same width', () => {
    expect(html).toContain('.message.bot > .content.agent-transcript-content');
    expect(html).toContain('.message.bot.pi-agent-message > .content.agent-transcript-content');
    expect(html).toContain('.message.bot > .content.agent-transcript-content > .agent-transcript');
    expect(html).toContain('max-width: 100% !important;');
  });

  it('labels MCP failures as plugin failures instead of blaming the selected AI provider', () => {
    expect(html).toContain('function getComposerFailureDisplay(provider, errorText, requestLabel)');
    expect(html).toContain("message: 'MCP 插件调用失败: ' + detail");
    expect(html).toContain('系统会自动重建一次 MCP 会话');
    expect(html).toContain("getComposerFailureDisplay(streamErrorProvider, data.error || '未知错误', '连接失败: ')");
  });

  it('recognizes every native tool progress line as an integrated running transcript', () => {
    expect(html).toContain('[→✓!]\\s*[A-Za-z_][A-Za-z0-9_.:-]*');
    expect(html).toContain('已完成第\\s*\\d+\\s*个工具循环');
    expect(html).toContain('本轮没有新的工具调用');
  });

  it('keeps avatar gutters inside the painted chat area when a sidebar narrows the page', () => {
    expect(html).toContain('padding-inline: var(--chat-message-avatar-outset);');
    expect(html).toContain('var(--main-content-max-width)');
    expect(html).toContain('+ var(--chat-message-avatar-outset)');
  });

  it('recovers workspace context from the query envelope for restored conversations', () => {
    expect(route).toContain('normalizeWorkspaceDirectoryInput(contextWorkspaceDirectory)');
    expect(route).toContain('normalizeWorkspaceDirectoryInput(rawEnvelopeRecord.workspace)');
  });

  it('persists, edits, cancels, restores, and drains queued messages by conversation', () => {
    expect(html).toContain("fetch(getMainChatPiSessionUrl(currentConversationId) + '/messages'");
    expect(html).toContain('async function editMainChatPiQueuedMessage(messageId)');
    expect(html).toContain('async function cancelMainChatPiQueuedMessage(messageId)');
    expect(html).toContain('async function claimNextMainChatPiMessage()');
    expect(html).toContain('await syncMainChatPiQueueState({ claimWhenIdle: true });');
    expect(html).toContain('piQueueMessageId = queuedItem.piQueueMessageId');
    expect(html).toContain('piQueueOriginalMessage = queuedItem.message');
    expect(html).not.toContain('queueItem.userMessageEl = appendQueuedUserMessage(queueItem);');
    expect(html).toContain('renderMainChatPiQueueItems(displayedPending);');
    expect(html).toContain('.message.user:has(+ .message.bot.pi-preflight-message)');
    expect(html).toContain('background: #ffffff !important;');
    expect(html).toContain('color: var(--theme-primary) !important;');
  });

  it('provides a server-side session contract and active-run collision protection', () => {
    expect(route).toContain("router.get('/pi/sessions/:conversationId'");
    expect(route).toContain("router.post('/pi/sessions/:conversationId/messages'");
    expect(route).toContain("router.patch('/pi/sessions/:conversationId/messages/:messageId'");
    expect(route).toContain("router.post('/pi/sessions/:conversationId/claim'");
    expect(route).toContain("code: 'PI_SESSION_RUNNING'");
    expect(route).toContain("code: 'PI_QUEUE_CLAIM_INVALID'");
    const postProcessIndex = route.indexOf('response = await postProcessResponse');
    expect(postProcessIndex).toBeGreaterThan(-1);
    expect(postProcessIndex).toBeLessThan(
      route.indexOf('if (piContinuedMessageId && piRunIdentity)', postProcessIndex),
    );
    expect(route).toContain('executionKernel.settle()');
  });

  it('keeps one running transcript when a persisted run hands off to a follow-up', () => {
    expect(html).toContain("messageDiv.dataset.piRunFinalizing === 'true'");
    expect(html).toContain("messageDiv.dataset.piRunFinalizing = 'true'");
    expect(html).toContain('attachedRenderer.finish(mainChatAttachedRunText, elapsedMs)');
    expect(html).toContain('var currentRunUsesReattachedRenderer = !!(');
    expect(html).toContain('&& !currentRunUsesReattachedRenderer');
  });

  it('injects steering between tool turns and uses native Codex turn steering when available', () => {
    expect(route).toContain('const claimedPiSteering = await takePiSteeringMessages();');
    expect(route).toContain('<PI_STEERING_MESSAGE');
    expect(codexAppServer).toContain("this.request(session, 'turn/steer'");
    expect(codexAppServer).toContain('message kept for prioritized continuation');
  });

  it('propagates the stop button to the backend Codex turn and Pi run state', () => {
    expect(html).toContain('async function interruptMainChatAgent(conversationId)');
    expect(html).toContain("getMainChatPiSessionUrl(conversationId) + '/interrupt'");
    expect(html).toContain('var backendStopPromise = interruptMainChatAgent(activeStopConversationId);');
    expect(html).toContain('var controllerToStop = currentAbortController;');
    expect(html).toContain('if (currentAbortController === controllerToStop)');
    expect(html).toContain('removeMainChatThinkingMessages();');
    expect(html).toContain('var activeMainChatConversationId = null;');
    expect(html).toContain('var activeStopConversationId = activeMainChatConversationId || currentConversationId || ensureCurrentConversationId();');
    expect(html).toContain('function stopActiveMainChatForNavigation()');
    expect(route).toContain("router.post('/pi/sessions/:conversationId/interrupt'");
    expect(route).toContain('piAgentSessionManager.requestRunCancellation');
    expect(route).toContain('chatBridgeAdapter.interruptCodexConversation');
    expect(route).toContain('cancellationRequested: cancellation.requested');
    expect(route).not.toContain('Forced stale run settlement after cancellation timeout');
    expect(route).toContain("res.once('close'");
    expect(route).toContain('executionKernel.detachTransport(');
    expect(executionKernel).toContain('Client transport detached; Agent run continues for renderer recovery');
    expect(route).not.toContain("cancelActiveRun('client-disconnected')");
    expect(route).toContain('executionKernel.appendEvent');
    expect(route).toContain('executionKernel.complete(');
    expect(html).toContain('function reconcileMainChatPersistedRun(state)');
    expect(html).toContain('正在重新连接原 Agent 任务');
    expect(codexAppServer).toContain("this.request(session, 'turn/interrupt'");
  });

  it('keeps each request abort signal stable while stop clears the active run', () => {
    expect(html).toContain('var requestAbortController = currentAbortController;');
    expect(html).toContain('signal: requestAbortController.signal');
    expect(html).toContain('abortSignal: requestAbortController.signal');
    expect(html).toContain('function finishMainChatRequest(requestController)');
    expect(html).toContain('currentAbortController !== requestController');
    expect(html).not.toContain("signal: currentAbortController.signal\n          });");
  });

  it('cancels autonomous retrieval and exposes its progress in the running strip', () => {
    expect(html).toContain('function setMainChatPreflightStatus(messageDiv, status)');
    expect(html).toContain('messageDiv.dataset.piStatus = normalizedStatus');
    expect(html).toContain("id=\"mainChatPreflightCurrent\"");
    expect(html).toContain("id=\"mainChatPreflightLog\"");
    expect(html).toContain('function renderMainChatPreflightLog(messageDiv)');
    expect(html).toContain('var currentEntry = entries.length ? entries[entries.length - 1] : null;');
    expect(html).toContain('var historyEntries = entries.length > 1 ? entries.slice(0, -1) : [];');
    expect(html).toContain('.pi-preflight-log-row');
    expect(html).toContain('setMainChatPreflightStatus(thinkingDiv, progressMessage);');
    expect(html).toContain('async function runAutonomousRetrievalForMessage(message, onProgress, queryIntent, recentHistory, abortSignal)');
    expect(html).toContain('signal: abortSignal');
    expect(html).toContain("'Accept': 'text/event-stream'");
    expect(html).toContain('async function readRetrievalExecutionResponse(response, onProgress)');
    expect(html).toContain("if (error && error.name === 'AbortError') throw error;");
    expect(html).toContain("running && preflightStatus ? preflightStatus : (running ? '运行中' : '会话待继续')");
  });

  it('renders queued instructions immediately after the latest preflight status', () => {
    const currentIndex = html.indexOf("id=\"mainChatPreflightCurrent\"");
    const queueIndex = html.indexOf("id=\"mainChatPiQueueItems\"");
    const historyIndex = html.indexOf("id=\"mainChatPreflightLog\"");
    expect(currentIndex).toBeGreaterThan(-1);
    expect(queueIndex).toBeGreaterThan(currentIndex);
    expect(historyIndex).toBeGreaterThan(queueIndex);
    expect(html).toContain('function getVisibleMainChatPiQueueItems(pending)');
    expect(html).toContain('if (seenIds[itemId]) return false;');
  });

  it('replaces opaque fetch errors with a recoverable local-service message', () => {
    expect(html).toContain('/failed to fetch|fetch failed|networkerror|network request failed|load failed/i');
    expect(html).toContain('本地服务连接中断，当前请求没有收到完整响应。');
    expect(html).not.toContain("appendMessage('Error: ' + error.message");
  });

  it('keeps long evidence retrieval connections alive and streams granular progress', () => {
    expect(localServer).toContain('includes("text/event-stream")');
    expect(localServer).toContain('Content-Type", "text/event-stream; charset=utf-8"');
    expect(localServer).toContain('retrieval-heartbeat');
    expect(localServer).toContain('RetrievalProgressReporter');
    expect(localServer).toContain('正在筛选最相关证据');
    expect(localServer).toContain('正在匹配句子证据');
  });

  it('does not persist an unchanged queued message on every poll', () => {
    expect(html).toContain('if (unchanged) return;');
  });
});
