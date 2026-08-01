import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const source = readPublicAppSource();

function buildTableRenderer(): (input: string) => string {
  const start = source.indexOf('function splitMessageMarkdownTableRow');
  const end = source.indexOf('function formatMessage(text, options)', start);
  if (start < 0 || end < 0) {
    throw new Error('Unable to locate the Markdown table renderer');
  }
  const rendererSource = source.slice(start, end);
  return new Function(
    'input',
    `${rendererSource}\nreturn renderMessageMarkdownTables(input);`,
  ) as (input: string) => string;
}

describe('chat Markdown table rendering', () => {
  const renderTables = buildTableRenderer();

  it('wraps pipe-delimited rows in a complete scrollable table', () => {
    const rendered = renderTables([
      '| 微生物机制 | 关键基因 | 结论 |',
      '| --- | --- | --- |',
      '| 硝化 | amoA | 对水分变化敏感 |',
      '| 反硝化 | nirK | 影响 N2O 排放 |',
    ].join('\n'));

    expect(rendered).toContain('<div class="message-markdown-table-scroll">');
    expect(rendered).toContain('<table class="message-markdown-table">');
    expect(rendered).toContain('<thead><tr><th');
    expect(rendered).toContain('<tbody><tr><td');
    expect(rendered).toContain('对水分变化敏感');
    expect(rendered).toContain('</tbody></table></div>');
  });

  it('leaves a single prose line containing pipes as prose', () => {
    const input = '比较 amoA | AOA | AOB 的响应差异。';
    expect(renderTables(input)).toBe(input);
  });

  it('keeps table cells readable and scrolls instead of squeezing glyphs', () => {
    expect(source).toMatch(
      /\.message-markdown-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/,
    );
    expect(source).toMatch(
      /\.message-markdown-table th,[\s\S]*?min-width:\s*120px;[\s\S]*?word-break:\s*normal !important;/,
    );
    expect(source).not.toContain("return '<tr>' + cells + '</tr>'");
  });
});
