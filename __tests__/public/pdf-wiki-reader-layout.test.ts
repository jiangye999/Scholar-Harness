import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('PDF Wiki original reader layout', () => {
  it('uses the full workspace width instead of reserving an empty left-sidebar strip', () => {
    expect(html).toContain('.app-secondary-overlay.pdf-wiki-reader-overlay {');
    expect(html).toContain('body.left-sidebar-collapsed .app-secondary-overlay.pdf-wiki-reader-overlay');
    expect(html).not.toContain('body:has(.sidebar.collapsed)');
    expect(html).toContain('left: 0 !important;');
    expect(html).toContain('function syncPdfWikiReaderOverlayInset(forcedCollapsed)');
    expect(html).toContain(
      "modal.className = 'app-secondary-overlay' + (pdfWikiWorkspaceMode === 'pdf-reader' ? ' pdf-wiki-reader-overlay' : '');",
    );
  });

  it('writes the live left inset with inline important priority and observes sidebar changes', () => {
    const workspaceModeStart = html.indexOf('function syncPdfWikiReaderOverlayInset(forcedCollapsed)');
    const workspaceModeEnd = html.indexOf('function updateAcademicWorkflowOverviewReturn', workspaceModeStart);
    const source = html.slice(workspaceModeStart, workspaceModeEnd);

    expect(source).toContain("var isReader = pdfWikiWorkspaceMode === 'pdf-reader'");
    expect(source).toContain("viewer.classList.toggle('pdf-wiki-reader-overlay', isReader)");
    expect(source).toContain("sidebar.classList.contains('collapsed')");
    expect(source).toContain("document.body.classList.contains('left-sidebar-collapsed')");
    expect(source).toContain('var sidebarContentVisible = !!(');
    expect(source).toContain("Number.parseFloat(sidebarPanelsStyle.opacity || '1') > 0.05");
    expect(source).toContain('|| !sidebarContentVisible');
    expect(source).toContain("syncGlobalLeftSidebarInset(sidebarCollapsed)");
    expect(source).toContain("'var(--active-left-sidebar-width)'");
    expect(source).toContain("'important'");
    expect(source).toContain('function observePdfWikiReaderSidebarClass()');
    expect(source).toContain('new MutationObserver(function()');
    expect(html).toContain('syncPdfWikiReaderOverlayInset(shouldCollapse)');
    expect(html).toContain('[80, 260].forEach(function(delay)');
  });

  it('uses one footer button that opens the same homepage PDF chat as PDF manager', () => {
    const readerStart = html.indexOf('function renderPdfWikiOriginalPdfPage(pdfId)');
    const readerEnd = html.indexOf('window.renderPdfWikiOriginalPdfPage = renderPdfWikiOriginalPdfPage;', readerStart);
    const readerSource = html.slice(readerStart, readerEnd);
    const homeChatStart = html.indexOf('window.openPdfWikiReaderHomeChat = function()');
    const homeChatEnd = html.indexOf('window.openPdfWikiOriginalPdfReader = async function(pdfId)', homeChatStart);
    const homeChatSource = html.slice(homeChatStart, homeChatEnd);

    expect(readerSource).toContain('class="pdf-wiki-reader-home-chat-footer"');
    expect(readerSource).toContain('id="pdfWikiReaderHomeChatBtn"');
    expect(readerSource).toContain('onclick="openPdfWikiReaderHomeChat()"');
    expect(readerSource).not.toContain("renderPdfWikiReaderToolBubble('chat'");
    expect(readerSource).not.toContain("renderPdfWikiReaderToolSection('chat'");
    expect(homeChatSource).toContain('return window.openPdfWikiPaperAiChat(targetPdfId);');
  });

  it('returns from the original reader to PDF manager without closing the manager workspace', () => {
    const closeStart = html.indexOf('window.handlePdfWikiViewerClose = function()');
    const closeEnd = html.indexOf('window.exportPdfWikiObsidian', closeStart);
    const closeSource = html.slice(closeStart, closeEnd);
    const openStart = html.indexOf('window.openPdfWikiOriginalPdfReader = async function(pdfId)');
    const openEnd = html.indexOf('function renderPdfWikiPdfTitleImages', openStart);
    const openSource = html.slice(openStart, openEnd);

    expect(closeSource).toContain("pdfWikiWorkspaceMode === 'pdf-reader'");
    expect(closeSource).toContain('window.showPdfWikiPdfManager({');
    expect(openSource).toContain("pdfWikiViewerReturnTarget = 'pdf-manager';");
    expect(openSource).toContain('focusPdfId: targetPdfId');
    expect(openSource).toContain('preserveReturnTarget: true');
  });
});
