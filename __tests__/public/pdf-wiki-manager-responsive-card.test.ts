import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();

describe('PDF manager responsive cards', () => {
  it('uses the PDF list width as the responsive layout boundary', () => {
    expect(html).toContain('#pdfWikiPdfManagerScroll {');
    expect(html).toContain('container-name: pdf-wiki-manager-list;');
    expect(html).toContain('container-type: inline-size;');
    expect(html).toContain('@container pdf-wiki-manager-list (max-width: 1050px)');
  });

  it('moves actions below full-width paper metadata in a narrow manager pane', () => {
    expect(html).toContain('class="pdf-wiki-manager-card-main"');
    expect(html).toContain('class="pdf-wiki-manager-card-copy"');
    expect(html).toContain('class="pdf-wiki-manager-card-title"');
    expect(html).toContain('class="pdf-wiki-manager-card-actions"');
    expect(html).toMatch(
      /@container pdf-wiki-manager-list \(max-width: 1050px\)[\s\S]*?\.pdf-wiki-manager-card-main\s*\{\s*grid-template-columns: minmax\(0, 1fr\);/,
    );
    expect(html).toMatch(
      /@container pdf-wiki-manager-list \(max-width: 1050px\)[\s\S]*?\.pdf-wiki-manager-card-actions\s*\{\s*justify-content: flex-start;/,
    );
  });
});
