import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const source = readPublicAppSource();

function buildListRenderer(): (input: string) => string {
  const start = source.indexOf('function getMarkdownListLevel');
  const end = source.indexOf('// 处理分隔线', start);
  if (start < 0 || end < 0) {
    throw new Error('Unable to locate the message list renderer');
  }
  const listRendererSource = source.slice(start, end);
  return new Function(
    'input',
    `var text = input;\n${listRendererSource}\nreturn text;`,
  ) as (input: string) => string;
}

function getOrderedMarkers(rendered: string): string[] {
  return Array.from(
    rendered.matchAll(/<span class="message-list-marker">(\d+\.)<\/span>/g),
    match => match[1],
  );
}

describe('message ordered-list rendering', () => {
  const renderList = buildListRenderer();

  it('keeps a two-pixel vertical gap between wrapped inline-code chips', () => {
    const rowHeight = source.match(
      /\.message-list-body\s*\{[\s\S]*?line-height:\s*(\d+)px;/,
    );
    const chipContentHeight = source.match(
      /\.message-list-body code\s*\{[\s\S]*?line-height:\s*(\d+)px;/,
    );

    expect(rowHeight?.[1]).toBe('26');
    expect(chipContentHeight?.[1]).toBe('18');
    const chipOuterHeight = Number(chipContentHeight?.[1]) + (2 * 2) + (1 * 2);
    expect(Number(rowHeight?.[1]) - chipOuterHeight).toBe(2);
  });

  it('guards bot messages against collapsed continuation-line layouts', () => {
    expect(source).toMatch(
      /\.message\.bot \.content\s*\{[\s\S]*?white-space:\s*normal;/,
    );
    expect(source).toContain("replace(/^([•‣◦])\\s*\\n[ \\t]*(?=\\S)/gm, '$1 ')");
    expect(source).toContain(".replace(/^(\\s*)(?:`([•‣◦])`|([•‣◦]))\\s+(?=\\S)/gm, '$1- ')");
    expect(source).toContain('Math.min(3, Math.max(1, Math.floor((width - 2) / 2)))');
  });

  it('keeps mixed scientific emphasis in one horizontal inline flow', () => {
    const rendered = renderList(
      '3. **微生物机制方面**：AOB（*amoA-b*）比AOA（*amoA-a*）更敏感；*ureC*丰度下降。',
    );

    expect(rendered).toContain('<span class="message-list-marker">3.</span>');
    expect(rendered).toContain(
      '<span class="message-list-body">**微生物机制方面**：AOB（*amoA-b*）比AOA（*amoA-a*）更敏感；*ureC*丰度下降。</span>',
    );
    expect(source).toContain(
      '.message.bot .message-list-body.message-inline-layout-normalized :where(',
    );
    expect(source).toMatch(
      /\.message-list-body\.message-inline-layout-normalized[\s\S]*?display:\s*inline !important;[\s\S]*?position:\s*static !important;/,
    );
    expect(source).toContain(
      "body.classList.add('message-inline-layout-normalized')",
    );
  });

  it('keeps numbering across indented file metadata continuation lines', () => {
    const rendered = renderList([
      '1. first.docx',
      '   54768 bytes，修改时间：2026-07-15 15:41:42',
      '',
      '2. second.docx',
      '   79706 bytes，修改时间：2026-07-14 16:18:24',
      '',
      '3. third.docx',
    ].join('\n'));

    expect(getOrderedMarkers(rendered)).toEqual(['1.', '2.', '3.']);
  });

  it('auto-increments Markdown lists that intentionally repeat 1.', () => {
    const rendered = renderList([
      '1. first.docx',
      '   metadata',
      '1. second.docx',
      '   metadata',
      '1. third.docx',
    ].join('\n'));

    expect(getOrderedMarkers(rendered)).toEqual(['1.', '2.', '3.']);
  });

  it('starts a new list after a real paragraph', () => {
    const rendered = renderList([
      '1. first item',
      'This paragraph ends the list.',
      '1. first item in another list',
    ].join('\n'));

    expect(getOrderedMarkers(rendered)).toEqual(['1.', '1.']);
  });
});
