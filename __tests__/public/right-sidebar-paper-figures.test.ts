import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('right sidebar paper figure library', () => {
  it('provides a dedicated paper figure tab and page', () => {
    expect(html).toContain('id="rightSidebarFiguresTab"');
    expect(html).toContain('id="paperFiguresPage"');
    expect(html).toContain("setRightSidebarTab('figures')");
    expect(html).toContain('id="paperFigureLibraryPanel"');
  });

  it('keeps the extensible tab group compact with a visible dark border', () => {
    expect(html).toContain('justify-content: flex-start;');
    expect(html).toContain('flex-wrap: wrap;');
    expect(html).toContain('border: 1px solid #111111 !important;');
    expect(html).toContain('border-radius: 8px;');
  });

  it('clips scrolling figures at the selection toolbar bottom edge', () => {
    expect(html).toMatch(/\.paper-figure-library-panel\s*\{[^}]*display:\s*flex;[^}]*overflow:\s*hidden;/s);
    expect(html).toMatch(/\.paper-figure-library-list\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*overflow-y:\s*auto;/s);
    expect(html).toMatch(/\.paper-figure-library-card\s*\{[^}]*flex:\s*0 0 auto;/s);
    expect(html).toMatch(/\.paper-figure-library-selection\s*\{[^}]*position:\s*relative;[^}]*flex:\s*0 0 auto;/s);
  });

  it('archives uploaded figures and refreshes the library', () => {
    expect(html).toContain('function archiveUploadedPaperFigures(');
    expect(html).toContain('/api/draft-assets/figures/library');
    expect(html).toContain('invalidatePaperFigureLibraryCache(false);');
    expect(html).toContain('renderPaperFigureLibraryPanel(true)');
    expect(html).toContain('id="paperFigureRefreshButton"');
    expect(html).toContain("paperFigureRefreshButton.hidden = activeTab !== 'figures'");
    expect(html).not.toContain('<div><strong>论文图片库</strong><br>上传时勾选保存的图片及已归档图件</div>');
  });

  it('supports in-app preview and metadata editing', () => {
    expect(html).toContain('function renderPaperFigureLibraryPanel(');
    expect(html).toContain('function savePaperFigureMetadata(');
    expect(html).toContain('function togglePaperFigureEdit(');
    expect(html).toContain('previewOutputAttachment(this)');
    expect(html).toContain("method: 'PATCH'");
  });

  it('supports multi-select deletion and merged figure creation', () => {
    expect(html).toContain('id="paperFigureSelectAll"');
    expect(html).toContain('function togglePaperFigureSelection(');
    expect(html).toContain('function deleteSelectedPaperFigures(');
    expect(html).toContain("method: 'DELETE'");
    expect(html).toContain('function showPaperFigureMergeDialog(');
    expect(html).toContain('function composePaperFigureCanvas(');
    expect(html).toContain('/api/draft-assets/figures/merge');
  });
});
