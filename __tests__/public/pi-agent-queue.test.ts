import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');
const route = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');
const codexAppServer = readFileSync(path.resolve(__dirname, '../../src/bridge/chat-bridge/codex-app-server.ts'), 'utf-8');

describe('Pi-style discussion writing queue', () => {
  it('keeps the composer interactive and exposes steer/follow-up controls', () => {
    expect(html).toContain("panel.id = 'mainChatPiQueuePanel';");
    expect(html).toContain('width: 66.6667%;');
    expect(html).toContain('align-self: center;');
    expect(html).toContain('margin: 0 auto;');
    expect(html).toContain('.pi-queue-panel { width: 100%; }');
    expect(html).toContain("setMainChatPiQueueBehavior(\\'follow_up\\')");
    expect(html).toContain("setMainChatPiQueueBehavior(\\'steer\\')");
    expect(html).toContain('Ctrl+Enter 始终转向');
    expect(html).toContain("piBehavior: isGenerating && (e.ctrlKey || e.metaKey) ? 'steer' : undefined");
    expect(html).toContain('userInput.disabled = false;');
  });

  it('mounts the compact running panel above the active AI response', () => {
    expect(html).toContain('function createMainChatPiQueuePanel()');
    expect(html).toContain('function attachMainChatPiQueuePanelToMessage(messageDiv)');
    expect(html).toContain('messageDiv.insertBefore(panel, content);');
    expect(html).toContain('attachMainChatPiQueuePanelToMessage(thinkingDiv);');
    expect(html).toContain('grid-template-areas:');
    expect(html).toContain('"avatar pi"');
    expect(html).toContain('"avatar content"');
    expect(html).toContain('row-gap: 0;');
    expect(html).toContain('border-radius: 10px 10px 0 0;');
    expect(html).toContain('border-bottom: 0;');
    expect(html).toContain('id="mainChatPiQueueItems"');
    expect(html).toContain("return behavior === 'steer' ? '转向当前任务：' : '后续执行：';");
    expect(html).not.toContain('<div class="pi-queue-list"');
    expect(html).not.toContain('<div class="pi-queue-help"');
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
    expect(route).toContain('piAgentSessionManager.settleRun');
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
    expect(route).toContain("router.post('/pi/sessions/:conversationId/interrupt'");
    expect(route).toContain('piAgentSessionManager.requestRunCancellation');
    expect(route).toContain('chatBridgeAdapter.interruptCodexConversation');
    expect(route).toContain('cancellationRequested: cancellation.requested');
    expect(route).not.toContain('Forced stale run settlement after cancellation timeout');
    expect(route).toContain("res.once('close'");
    expect(codexAppServer).toContain("this.request(session, 'turn/interrupt'");
  });
});
