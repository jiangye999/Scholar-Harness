import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();
const localServer = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');
const chatBridge = readFileSync(path.join(repoRoot, 'src/server/routes/chat-bridge.ts'), 'utf-8');

describe('single PDF homepage chat integration', () => {
  it('opens PDF chat as a standard homepage conversation instead of a floating panel', () => {
    const start = html.indexOf('window.openPdfWikiPaperAiChat = async function(pdfId)');
    const end = html.indexOf('async function runPdfWikiReaderAiRead', start);
    const source = html.slice(start, end);

    expect(source).toContain("if (typeof newChat === 'function') newChat();");
    expect(source).toContain('setActivePdfPaperChatContext({');
    expect(source).toContain('setComposerChatProvider');
    expect(source).toContain('storeConversationMessagesLocally(currentConversationId, homeMessages');
    expect(source).not.toContain("panel.id = 'pdfWikiReaderExternalChatPanel'");
    expect(source).not.toContain("panel.className = 'app-secondary-floating-panel'");
  });

  it('restores the originating PDF manager location from a persistent chat return button', () => {
    expect(html).toContain('id="pdfPaperChatReturnBar"');
    expect(html).toContain("window.returnToPdfPaperSource = async function()");
    expect(html).toContain('pdfWikiPdfManagerSelectedGroupId = context.groupId');
    expect(html).toContain('pdfWikiPdfManagerSearchTerm = context.searchTerm');
    expect(html).toContain('focusPdfId: context.pdfId');
    expect(html).toContain("id=\"pdfWikiPdfCard-' + getPdfWikiDomIdPart(pdf.id)");
    expect(html).toContain('restorePdfWikiPdfManagerReturnTarget(restoreScrollTop, focusPdfId)');
  });

  it('indexes homepage conversations by PDF and resumes the matching paper history', () => {
    const start = html.indexOf('window.openPdfWikiPaperAiChat = async function(pdfId)');
    const end = html.indexOf('async function runPdfWikiReaderAiRead', start);
    const source = html.slice(start, end);

    expect(html).toContain('function registerPdfPaperConversation(pdfId, conversationId)');
    expect(html).toContain('function findLatestPdfPaperConversationId(pdfId)');
    expect(source).toContain('var existingConversationId = findLatestPdfPaperConversationId(targetPdfId)');
    expect(source).toContain('await loadConversation(existingConversationId)');
    expect(html).toContain("setPdfPaperChatReturnContext(loadPdfPaperChatReturnContextForConversation(convId)");
    expect(html).toContain("'论文 · ' + (pdfConversationContext.title");
  });

  it('routes the reader expand action to the same homepage chat', () => {
    const start = html.indexOf('function togglePdfWikiReaderChatExpanded(open)');
    const end = html.indexOf('function closePdfWikiPaperAiChat()', start);
    const source = html.slice(start, end);

    expect(source).toContain('window.openPdfWikiPaperAiChat(pdfWikiOriginalReaderPdfId)');
    expect(html).toContain('id="pdfWikiReaderHomeChatBtn"');
    expect(html).toContain('onclick="openPdfWikiReaderHomeChat()"');
  });

  it('sends inline reader questions through the standard homepage sender', () => {
    const start = html.indexOf('async function sendPdfWikiReaderChatQuestion(source)');
    const end = html.indexOf('function handlePdfWikiReaderChatInputKeydown', start);
    const source = html.slice(start, end);

    expect(source).toContain('await window.openPdfWikiPaperAiChat(pdf.id)');
    expect(source).toContain('await sendMessage()');
    expect(source).not.toContain("fetch('/api/pdf-wiki/reader/chat'");
  });

  it('exposes the selected PDF as an on-demand resource on every homepage turn', () => {
    expect(localServer).toContain('app.get("/api/pdf-wiki/reader/context"');
    expect(localServer).toContain('paperText: truncatePdfReaderFullText(fullText.text, 90000)');
    expect(html).toContain("registerMainChatAgentResource(context, 'current-pdf', '当前论文', {");
    expect(html).toContain("pdfId: activePaperResource.pdfId || activePaperResource.id || ''");
    expect(html).toContain('正文由 Agent 按需读取');
    expect(chatBridge).toContain('function buildPdfPaperChatPromptBlock(value: any)');
    expect(chatBridge).toContain('<CURRENT_PDF_SELECTION>');
    expect(chatBridge).toContain('read_page_context(resourceId="current-pdf")');
  });
});

describe('PDF reader workspace sizing and cleanup', () => {
  it('sizes fullscreen panels to their inset overlay instead of the viewport', () => {
    expect(html).toContain('.custom-fullscreen-panel {');
    expect(html).toContain('width: 100% !important;');
    expect(html).toContain('height: 100% !important;');
    expect(html).not.toMatch(/\.custom-fullscreen-panel\s*\{[\s\S]{0,240}width:\s*100vw/);
    expect(html).not.toMatch(/\.custom-fullscreen-panel\s*\{[\s\S]{0,240}height:\s*100vh/);
  });

  it('uses the complete PDF close lifecycle and restores horizontal workspace state', () => {
    const start = html.indexOf('function closeStandaloneWorkspaceSurfaces(exceptId)');
    const end = html.indexOf('function prepareStandaloneWorkspaceSurface', start);
    const source = html.slice(start, end);

    expect(source).toContain("surfaceId === 'pdfWikiViewerModal' && typeof closePdfWikiViewer === 'function'");
    expect(source).toContain('closePdfWikiViewer();');
    expect(html).toContain('function resetMainWorkspaceHorizontalPosition()');
    expect(html).toContain('resetMainWorkspaceHorizontalPosition();');
  });
});
