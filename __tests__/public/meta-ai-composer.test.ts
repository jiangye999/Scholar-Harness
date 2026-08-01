import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('Meta AI composer', () => {
  it('uses the same composer primitives as the main chat input', () => {
    const start = html.indexOf('<div class="meta-analysis-ai-panel meta-analysis-ai-input-panel">');
    const end = html.indexOf('<div class="meta-analysis-wizard-footer">', start);
    const source = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain('input-area-container meta-analysis-ai-composer');
    expect(source).toContain('class="chat-input meta-analysis-ai-input"');
    expect(source).toContain('id="metaAnalysisComposerProviderSlot"');
    expect(source).toContain('class="send-btn"');
    expect(html).toContain("['uploadExperimentBtn', 'metaAnalysisComposerLeftActions']");
    expect(html).toContain("['composerProviderSelector', 'metaAnalysisComposerProviderSlot']");
    expect(source).not.toContain('模型顺序：Codex');
  });

  it('returns borrowed homepage controls safely after Meta redraws or closes', () => {
    const borrowStart = html.indexOf('function borrowPdfWikiMetaSharedComposerNode(nodeId, slotId)');
    const borrowEnd = html.indexOf('function renderMetaAnalysisColumnOptions', borrowStart);
    const source = html.slice(borrowStart, borrowEnd);

    expect(borrowStart).toBeGreaterThan(-1);
    expect(source).toContain('pdfWikiMetaSharedComposerBorrowedNodes.find');
    expect(source).toContain('originalParent: originalParent');
    expect(source).toContain('originalNextSibling: originalNextSibling');
    expect(source).toContain('pdfWikiMetaSharedComposerBorrowedNodes.slice().reverse()');
    expect(source).toContain('entry.originalParent.insertBefore(entry.node, referenceNode)');
    expect(source).toContain('if (pdfWikiMetaSharedComposerBorrowedNodes.length)');
    expect(source).toContain('restorePdfWikiMetaSharedComposer();');
    expect(source).toContain('function ensureMainComposerIntegrity()');
    expect(html).toContain("if (typeof ensureMainComposerIntegrity === 'function')");
  });

  it('supports model selection, autosizing and stopping an active request', () => {
    expect(html).toContain('var provider = getComposerChatProvider();');
    expect(html).toContain('applyPdfWikiMetaChatProviderConfig(requestBody, provider);');
    expect(html).toContain('window.autoResizePdfWikiMetaAiInput = function(input)');
    expect(html).toContain('window.stopPdfWikiMetaAnalysisAiPlan = function()');
    expect(html).toContain('signal: abortController.signal');
    expect(html).toContain("input.value = '';");
  });

  it('uses the same query-first Agent route as the homepage instead of the fixed Meta plan route', () => {
    const start = html.indexOf('window.runPdfWikiMetaAnalysisAiPlan = async function(queuedItem)');
    const end = html.indexOf('window.handlePdfWikiMetaAiInputKeydown', start);
    const source = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain('await prepareChatBridgeContext(');
    expect(source).toContain('sharedContext.metaAnalysisAgent = buildPdfWikiMetaAgentPageContext(');
    expect(source).toContain("fetch('/api/chat-bridge/chat'");
    expect(source).toContain('await readPdfWikiMetaAgentStream(response, pending)');
    expect(source).not.toContain("fetch('/api/meta-analysis/ai-plan'");
  });

  it('passes persistent Skill selection and Meta page state to the shared Agent', () => {
    expect(html).toContain('selectedContextSources: loadMainContextSourceSelection()');
    expect(html).toContain('selectedSkills: loadMainContextSkillSelection()');
    expect(html).toContain("capabilityNote: '本页面复用主页统一 Agent、Skill Runtime、MCP Runtime");
    expect(html).toContain('conversationId: routingInput.conversationId || currentConversationId || null');
  });

  it('uses the persistent Pi session queue while Meta Agent is running', () => {
    expect(html).toContain("panel.id = 'metaAnalysisPiQueuePanel';");
    expect(html).toContain("window.setPdfWikiMetaPiQueueBehavior = function(behavior)");
    expect(html).toContain("getPdfWikiMetaPiSessionUrl(conversationId) + '/messages'");
    expect(html).toContain("getPdfWikiMetaPiSessionUrl(pdfWikiMetaAnalysisConversationId) + '/claim'");
    expect(html).toContain("getPdfWikiMetaPiSessionUrl(conversationId) + '/interrupt'");
    expect(html).toContain('requestBody.piQueueMessageId = queuedItem.id');
    expect(html).toContain('await syncPdfWikiMetaPiQueueState({ claimWhenIdle: true });');
  });

  it('mounts the running state inside the active AI response with the Meta black treatment', () => {
    const start = html.indexOf('function createPdfWikiMetaPiQueuePanel()');
    const end = html.indexOf('function updatePdfWikiMetaPiHistoryStatus', start);
    const source = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain("panel.className = 'pi-queue-panel meta-analysis-running-strip';");
    expect(source).toContain("messageElement.insertBefore(panel, content);");
    expect(source).toContain("pdfWikiMetaPiQueueHostMessage.classList.toggle('pi-agent-message', visible)");
    expect(source).toContain("title.textContent = (running ? '运行中' : '会话待继续')");
    expect(source).not.toContain('id="metaPiFollowUpModeBtn"');
    expect(source).not.toContain('id="metaPiSteerModeBtn"');
    expect(html).toContain('attachPdfWikiMetaPiQueuePanelToMessage(messageElement);');
    expect(html).toContain('.meta-analysis-running-strip.pi-queue-panel');
    expect(html).toContain('background: #44484f;');
    expect(html).toContain('.meta-analysis-running-strip .pi-queue-title');
    expect(html).toContain('color: #ffffff;');
    expect(html).toContain('#metaAnalysisPiQueuePanel.meta-analysis-running-strip.pi-queue-panel');
    expect(html).toContain('.message.bot.pi-agent-message > .content');
    expect(html).toContain('background: #44484f !important;');
    expect(html).not.toContain('.meta-analysis-pi-queue-panel.pi-queue-panel');
    expect(html).not.toContain('<section id="metaAnalysisPiQueuePanel"');
  });

  it('deletes Meta history conversations and cleans their backend state', () => {
    expect(html).toContain('id="metaAiDeleteConversationBtn"');
    expect(html).toContain('onclick="deleteCurrentPdfWikiMetaAnalysisConversation()"');
    expect(html).toContain('window.deleteCurrentPdfWikiMetaAnalysisConversation = async function()');
    expect(html).toContain("method: 'DELETE'");
    expect(html).toContain("var remaining = history.filter(function(item) { return item.id !== conversationId; });");
    expect(html).toContain('await window.openPdfWikiMetaAnalysisConversation(remaining[0].id);');
    expect(html).toContain('window.startNewPdfWikiMetaAnalysisConversation();');
  });

  it('reuses the homepage query navigation rail for Meta chat messages', () => {
    expect(html).toContain("var metaRail = document.getElementById('metaAnalysisQueryNavRail');");
    expect(html).toContain("messageRoot: metaOutput");
    expect(html).toContain("scrollContainer: metaOutput");
    expect(html).toContain("rail.className = 'query-nav-rail empty';");
    expect(html).toContain("rail.setAttribute('aria-label', 'Meta 分析用户 query 导航');");
    expect(html).toContain("metaOutput.addEventListener('scroll'");
    expect(html).toContain("scrollContainer.scrollTo({ top: targetScrollTop, behavior: 'smooth' });");
    expect(html).toContain('bindMetaAnalysisQueryNavRail();');
    expect(html).toContain('scheduleQueryNavRender();');
    expect(html).toContain('#modalOverlay.meta-analysis-shared-composer-overlay #metaAnalysisQueryNavRail');
    expect(html).toContain('right: 18px;');
    expect(html).toContain('border-radius: 50%;');
    expect(html).toContain('.query-nav-dot.hover-focus::before');
    expect(html).toContain('transform: translate(-50%, -50%) scale(2);');
    expect(html).toContain('.query-nav-dot.hover-neighbor::before');
    expect(html).toContain('transform: translate(-50%, -50%) scale(1.5);');
  });

  it('uses the workspace name only in the modal header and gives the chat body the freed space', () => {
    const start = html.indexOf('function renderPdfWikiMetaAnalysisWizard(data, pdfIds)');
    const end = html.indexOf('function collectPdfWikiMetaAnalysisConfig()', start);
    const source = html.slice(start, end);

    expect(html).toContain("return showModal('AI Meta 分析工作区', content, true, true");
    expect(source).toContain('id="metaAnalysisAiOutput"');
    expect(source).not.toContain('>AI Meta 分析工作区</div>');
    expect(source).not.toContain('自动判断因变量、自变量、CK/treatment、合并/拆分列');
    expect(html).toContain('.meta-analysis-ai-workspace-panel > .meta-analysis-header-conversation-controls');
    expect(html).toContain("subtitle.id = 'metaAnalysisHeaderSubtitle'");
    expect(html).toContain("subtitle.textContent = '在底部输入 Meta 分析需求后");
    expect(html).toContain('row-gap: 8px;');
    expect(html).toContain('grid-area: subtitle;');
    expect(html).toContain('margin-bottom: 0;');
    expect(html).toContain('.meta-analysis-ai-workspace-panel {');
    expect(html).toContain('margin: 0 auto;');
    expect(html).toContain('#metaAiNewConversationBtn.meta-analysis-wizard-btn');
    expect(html).toContain('background: #111827 !important;');
    expect(html).toContain('color: #d4a017 !important;');
    expect(html).toContain('output.replaceChildren();');
    expect(html).not.toContain('<div class="meta-analysis-ai-empty">在底部输入 Meta 分析需求后');
  });

  it('keeps only the inner chat scroller in the Meta workspace', () => {
    expect(html).toContain('#modalOverlay.meta-analysis-shared-composer-overlay #modalContent {');
    expect(html).toContain('overflow: hidden;');
    expect(html).toContain('scrollbar-width: none;');
    expect(html).toContain('#modalOverlay.meta-analysis-shared-composer-overlay #modalContent::-webkit-scrollbar');
    expect(html).toContain('.meta-analysis-ai-output {');
    expect(html).toContain('overflow: auto;');
    expect(html).toContain('.modal-fullscreen .meta-analysis-wizard {');
    expect(html).toContain('height: 100%;');
    expect(html).toContain('max-height: 100%;');
    expect(html).not.toContain('.modal-fullscreen .meta-analysis-wizard {\n      height: calc(100vh - 88px);');
  });

  it('queues non-empty input instead of stopping the active Meta Agent', () => {
    expect(html).toContain('await enqueuePdfWikiMetaPiMessage(queuedMessage, pdfWikiMetaPiQueueBehavior)');
    expect(html).toContain("button.classList.toggle('queue-ready', running && hasDraft)");
    expect(html).not.toContain("if (pdfWikiMetaAnalysisAiAbortController) return;\n      window.handlePdfWikiMetaAiSendAction();");
  });

  it('centers the single-line input and keeps the running control visually active', () => {
    expect(html).toContain('min-height: 100px;');
    expect(html).toContain('.meta-analysis-ai-composer .meta-analysis-ai-input');
    expect(html).toContain('field-sizing: fixed;');
    expect(html).toContain("input.style.height = '46px';");
    expect(html).toContain('.meta-analysis-ai-composer .composer-provider-option.active');
    expect(html).toContain('.meta-analysis-ai-composer .send-btn.can-stop:hover');
    expect(html).toContain('background: #111111;');
    expect(html).toContain('.meta-analysis-ai-composer .send-btn.can-stop #metaAiLoadingSpinner');
    expect(html).toContain('animation: spin 0.9s linear infinite;');
    expect(html).toContain('stroke="#ffffff" stroke-width="2.4" stroke-dasharray="42 16"');
    expect(html).not.toContain('id="metaAiStopIcon"');
  });
});
