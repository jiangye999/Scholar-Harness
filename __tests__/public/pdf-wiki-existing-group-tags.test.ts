import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();

describe('PDF manager existing group tags', () => {
  it('renders only groups already assigned to the PDF', () => {
    const start = html.indexOf('var groupTags = groups');
    const end = html.indexOf("return '<article", start);
    const source = html.slice(start, end);

    expect(source).toContain('.filter(function(group)');
    expect(source).toContain('return groupIds.indexOf(group.id) !== -1;');
    expect(source).toContain('class="pdf-wiki-existing-group-tag"');
    expect(source).toContain('onclick="setPdfWikiPdfGroupChecked(this.dataset.pdfId,this.dataset.groupId,false,this)"');
    expect(source).not.toContain('type="checkbox"');
    expect(source).not.toContain('先在左侧创建分组');
  });

  it('removes the PDF group heading and omits an empty tag row', () => {
    expect(html).not.toContain('>PDF 分组</label>');
    expect(html).toContain('class="pdf-wiki-existing-group-tags"');
    expect(html).toContain("(groupTags\n                ? '<div class=\"pdf-wiki-existing-group-tags\"");
  });

  it('rerenders immediately after an existing tag is unchecked', () => {
    const start = html.indexOf('window.setPdfWikiPdfGroupChecked = async function');
    const end = html.indexOf('async function requestPdfWikiReidentify', start);
    const source = html.slice(start, end);

    expect(source).toContain('if (!checked || wasVisible !== nowVisible)');
    expect(source).toContain('renderPdfWikiPdfManagerPreservingScroll();');
  });

  it('renders the three built-in groups in one compact row', () => {
    expect(html).toContain('class="pdf-wiki-default-group-row"');
    expect(html).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(html).toContain('var defaultGroupButtons = [');
    expect(html).toContain("var groupHtml = '<div class=\"pdf-wiki-default-group-row\">'");
  });
});
