import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();

describe('PDF Wiki group rename return target', () => {
  it('keeps the PDF manager mounted while the rename dialog is open', () => {
    const start = html.indexOf('window.renamePdfWikiPdfGroup = function(groupId)');
    const end = html.indexOf('window.submitRenamePdfWikiPdfGroup = async function()', start);
    const source = html.slice(start, end);

    expect(source).toContain("preserveStandaloneSurfaceId: 'pdfWikiViewerModal'");
    expect(source).toContain(
      "overlayClass: 'app-secondary-overlay app-tertiary-overlay pdf-wiki-group-rename-overlay'",
    );
  });

  it('reloads or restores the PDF manager after saving', () => {
    const start = html.indexOf('window.submitRenamePdfWikiPdfGroup = async function()');
    const end = html.indexOf('window.deletePdfWikiPdfGroupClient = async function(groupId)', start);
    const source = html.slice(start, end);

    expect(source).toContain("document.getElementById('pdfWikiViewerModal')");
    expect(source).toContain('await reloadPdfWikiPdfManager();');
    expect(source).toContain('await window.showPdfWikiPdfManager({ preserveOverviewReturn: true });');
  });
});
