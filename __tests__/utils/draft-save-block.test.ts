import { describe, expect, it } from 'vitest';

import { isDraftSaveRequest, parseDraftSaveBlocks } from '../../src/utils/draft-save-block';

describe('draft save block parser', () => {
  it('parses the canonical fenced save block', () => {
    const result = parseDraftSaveBlocks([
      '正文说明',
      '```text',
      '🔧 调用工具：save_draft',
      'content: |',
      '## Discussion',
      'The result may be explained by soil moisture.',
      'section: discussion',
      'references: |',
      '(Zhang et al., 2026) Zhang, A. (2026). Example.',
      '```',
    ].join('\n'));

    expect(result).toMatchObject({ markerCount: 1, invalidCount: 0 });
    expect(result.blocks[0]).toMatchObject({
      section: 'discussion',
      syntax: 'fenced',
      content: expect.stringContaining('The result may be explained'),
      references: expect.stringContaining('Zhang et al.'),
    });
  });

  it('accepts a plain block and Chinese field colons', () => {
    const result = parseDraftSaveBlocks([
      '调用工具：save_draft',
      'content：|',
      'The treatments differed significantly.',
      'section：results',
      'references：|',
      '',
    ].join('\n'));

    expect(result.blocks[0]).toMatchObject({
      section: 'results',
      syntax: 'plain',
      content: 'The treatments differed significantly.',
    });
  });

  it('accepts a markdown-list marker and multiple save blocks', () => {
    const result = parseDraftSaveBlocks([
      '```text',
      '- **🔧 调用工具：save_draft**',
      'content: |',
      'Introduction text.',
      'section: introduction',
      '```',
      '```text',
      'save_draft',
      'content: |',
      'Methods text.',
      'section: methods',
      '```',
    ].join('\n'));

    expect(result).toMatchObject({ markerCount: 2, invalidCount: 0 });
    expect(result.blocks.map(block => block.section)).toEqual(['introduction', 'methods']);
  });

  it('accepts Chinese field names emitted by Chinese models', () => {
    const result = parseDraftSaveBlocks([
      '```',
      '🔧 调用工具：save_draft',
      '内容：|',
      'Discussion paragraph.',
      '章节：discussion',
      '参考文献：|',
      '```',
    ].join('\n'));

    expect(result.blocks[0]).toMatchObject({
      content: 'Discussion paragraph.',
      section: 'discussion',
    });
  });

  it('reports a marker with missing required fields as invalid', () => {
    const result = parseDraftSaveBlocks('```\n🔧 调用工具：save_draft\nsection: discussion\n```');
    expect(result.blocks).toHaveLength(0);
    expect(result).toMatchObject({ markerCount: 1, invalidCount: 1 });
  });

  it('detects natural-language draft save requests', () => {
    expect(isDraftSaveRequest('把这段内容保存到 Discussion 草稿')).toBe(true);
    expect(isDraftSaveRequest('看一下摘要的txt里面是不是有标题，把标题单独拿出来，放到一个txt文件里面')).toBe(true);
    expect(isDraftSaveRequest('把运行日志单独放到一个 txt 文件里面')).toBe(false);
    expect(isDraftSaveRequest('只解释一下这段结果')).toBe(false);
    expect(isDraftSaveRequest('更新右侧论文的章节框架并等待我确认')).toBe(false);
    expect(isDraftSaveRequest('已同步章节框架和每章的证据需求')).toBe(false);
    expect(isDraftSaveRequest('根据章节框架，把这段论文正文保存到 Discussion 草稿')).toBe(true);
  });
});
