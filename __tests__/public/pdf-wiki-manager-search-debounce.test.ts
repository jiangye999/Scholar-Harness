import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();

describe('PDF manager search debounce', () => {
  it('waits 1.2 seconds after the latest input before applying the filter', () => {
    expect(html).toContain('var PDF_WIKI_PDF_MANAGER_SEARCH_DELAY_MS = 1200;');
    expect(html).toContain('var pdfWikiPdfManagerSearchInputValue =');

    const start = html.indexOf('window.setPdfWikiPdfManagerSearchTerm = function(value)');
    const end = html.indexOf('window.clearPdfWikiPdfManagerSearch = function()', start);
    const source = html.slice(start, end);

    expect(source).toContain('pdfWikiPdfManagerSearchInputValue = String(value || \'\');');
    expect(source).toContain('cancelPdfWikiPdfManagerSearchTimer();');
    expect(source).toContain('pdfWikiPdfManagerSearchTimer = setTimeout(function()');
    expect(source).toContain('pdfWikiPdfManagerSearchTerm = pdfWikiPdfManagerSearchInputValue;');
    expect(source).toContain('}, PDF_WIKI_PDF_MANAGER_SEARCH_DELAY_MS);');
  });

  it('cancels pending filtering during composition and when clearing the search', () => {
    expect(html).toContain(
      'oncompositionstart="pdfWikiPdfManagerSearchComposing=true;cancelPdfWikiPdfManagerSearchTimer()"',
    );

    const start = html.indexOf('window.clearPdfWikiPdfManagerSearch = function()');
    const end = html.indexOf('function setPdfWikiSelectionButtonState', start);
    const source = html.slice(start, end);

    expect(source).toContain('cancelPdfWikiPdfManagerSearchTimer();');
    expect(source).toContain('pdfWikiPdfManagerSearchInputValue = \'\';');
    expect(source).toContain('pdfWikiPdfManagerSearchTerm = \'\';');
  });
});
