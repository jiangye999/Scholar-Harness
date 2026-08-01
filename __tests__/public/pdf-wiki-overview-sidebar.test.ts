import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();

describe('PDF Wiki overview diagram right sidebar', () => {
  it('provides a transient PDF overview tab and panel in the shared right sidebar', () => {
    expect(html).toContain('id="rightSidebarPdfOverviewTab"');
    expect(html).toContain("onclick=\"setRightSidebarTab('pdf-overview')\"");
    expect(html).toContain('id="rightSidebarPdfOverviewPage"');
    expect(html).toContain('id="rightSidebarPdfOverviewPanel"');
    expect(html).toContain("rightSidebarTransientTab === 'pdf-overview'");
    expect(html).toContain('renderRightSidebarPdfOverviewPanel()');
  });

  it('opens the overview in the right sidebar without creating a separate modal', () => {
    const start = html.indexOf('window.openPdfWikiOverviewDiagramFromButton = function(button)');
    const end = html.indexOf('window.openPdfWikiFigurePreviewFromButton', start);
    const source = html.slice(start, end);

    expect(source).toContain("rightSidebarTransientTab = 'pdf-overview'");
    expect(source).toContain("setRightSidebarTab('pdf-overview')");
    expect(source).toContain('rightSidebarPdfOverviewState = {');
    expect(source).not.toContain("showModal('论文一览图'");
  });

  it('keeps the PDF manager visible beside the raised right sidebar and cleans up on close', () => {
    expect(html).toContain('body.pdf-wiki-overview-sidebar-open #pdfWikiViewerModal');
    expect(html).toContain('right: var(--active-right-sidebar-width, 37.5vw) !important;');
    expect(html).toContain('body.pdf-wiki-overview-sidebar-open .right-sidebar');
    expect(html).toContain("document.body.classList.toggle('pdf-wiki-overview-sidebar-open', shouldLiftRightSidebar)");
    expect(html).toContain('clearRightSidebarPdfOverviewState(true);');
    expect(html).toContain('window.closeRightSidebarPdfOverview = closeRightSidebarPdfOverview');
  });

  it('zooms the overview with the mouse wheel around the pointer position', () => {
    expect(html).toContain('onwheel="handleRightSidebarPdfOverviewWheel(event)"');
    expect(html).toContain('function handleRightSidebarPdfOverviewWheel(event)');
    expect(html).toContain('event.deltaY < 0 ? 1.12 : (1 / 1.12)');
    expect(html).toContain('contentX * scaleRatio - pointerX');
    expect(html).toContain('contentY * scaleRatio - pointerY');
    expect(html).toContain("var minZoom = state && state.kind === 'image' ? 0.25 : 0.4");
    expect(html).toContain("var maxZoom = state && state.kind === 'image' ? 8 : 5");
    expect(html).toContain('id="rightSidebarPdfOverviewZoomStatus"');
    expect(html).toContain('onclick="resetRightSidebarPdfOverviewZoom()"');
    expect(html).toContain('window.resetRightSidebarPdfOverviewZoom = resetRightSidebarPdfOverviewZoom');
  });

  it('opens PDF figures in the same zoomable right sidebar instead of a modal', () => {
    const start = html.indexOf('window.openPdfWikiFigurePreviewFromButton = function(button)');
    const end = html.indexOf('window.openPdfWikiOriginalPdfReaderFromButton', start);
    const source = html.slice(start, end);

    expect(source).toContain("kind: 'image'");
    expect(source).toContain('src: src');
    expect(source).toContain("rightSidebarTransientTab = 'pdf-overview'");
    expect(source).toContain("setRightSidebarTab('pdf-overview')");
    expect(source).not.toContain("showModal('PDF 图片预览'");
    expect(html).toContain('class="right-sidebar-pdf-figure-image"');
    expect(html).toContain("? 'PDF 图片'\n          : '论文一览图'");
  });
});
