import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { describe, expect, it, vi } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

function loadLocalLinkHelpers() {
  const source = readPublicAppSource();
  const start = source.indexOf('    function decodeMessageLinkTarget(value) {');
  const end = source.indexOf('    function isCollapsibleRCodeBlock(language, code) {', start);
  if (start < 0 || end < 0) throw new Error('Local message link helpers were not found');
  const openOutputAttachmentFile = vi.fn(async () => undefined);
  const context = vm.createContext({
    window: { location: { origin: 'http://localhost' } },
    URL,
    decodeURIComponent,
    escapeHtml: (value: unknown) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    isOutputAttachmentPath: (value: unknown) => /\.(?:docx?|xlsx?|pdf|png|txt)$/i.test(String(value || '')),
    getOutputAttachmentFileName: (value: unknown) => String(value || '').split(/[?#]/)[0].split(/[\\/]/).pop() || '',
    isOutputImagePath: (value: unknown) => /\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(String(value || '')),
    openOutputAttachmentFile,
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context: context as unknown as {
      decodeMessageLinkTarget: (value: string) => string;
      isMessageLocalFileLinkTarget: (value: string) => boolean;
      isMessageImagePreviewTarget: (value: string) => boolean;
      renderMessageMarkdownLink: (label: string, target: string) => string;
      protectInlineLocalFileMarkdownLinks: (text: string) => {
        text: string;
        replacements: string[];
      };
      openMessageLocalFileLink: (link: unknown, event: unknown) => Promise<boolean>;
      handleMessageLocalFileLinkKeydown: (link: unknown, event: unknown) => boolean;
    },
    openOutputAttachmentFile,
    source,
  };
}

describe('message local-file links', () => {
  it('normalizes Codex angle-bracket Windows paths into Electron file links', () => {
    const { context } = loadLocalLinkHelpers();
    const target = 'D:/桌面文件/R123/paper_manuscript_clean_revised.docx';

    expect(context.decodeMessageLinkTarget(`&lt;${target}&gt;`)).toBe(target);
    expect(context.decodeMessageLinkTarget(`%3C${encodeURI(target)}%3E`)).toBe(target);
    expect(context.isMessageLocalFileLinkTarget(target)).toBe(true);
    const html = context.renderMessageMarkdownLink('paper_manuscript_clean_revised.docx', target);
    expect(html).toContain('data-file-path="D:/桌面文件/R123/paper_manuscript_clean_revised.docx"');
    expect(html).toContain('class="message-local-file-link"');
    expect(html).toContain('role="button"');
    expect(html).toContain('openMessageLocalFileLink(this,event)');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('target="_blank"');
  });

  it('keeps web links external and delegates local clicks to the existing attachment opener', async () => {
    const { context, openOutputAttachmentFile } = loadLocalLinkHelpers();
    const external = context.renderMessageMarkdownLink('OpenAI', 'https://openai.com/');
    expect(external).toContain('target="_blank"');

    const link = { getAttribute: () => 'D:/work/result.docx' };
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await context.openMessageLocalFileLink(link, event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(event.stopPropagation).toHaveBeenCalledOnce();
    expect(openOutputAttachmentFile).toHaveBeenCalledWith(link);
  });

  it('opens API image links in the right sidebar instead of an external browser', () => {
    const { context } = loadLocalLinkHelpers();
    const target = '/api/bibliometrics/artifacts/file?userId=web-user&file=figure1.svg';
    const html = context.renderMessageMarkdownLink(target, target);

    expect(context.isMessageImagePreviewTarget(target)).toBe(true);
    expect(html).toContain('class="message-local-file-link message-image-preview-link"');
    expect(html).toContain('data-file-kind="image"');
    expect(html).toContain('data-file-name="figure1.svg"');
    expect(html).toContain('在右侧查看图片');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('target="_blank"');
  });

  it('does not nest backtick-wrapped local file links inside fragmented code elements', () => {
    const { context } = loadLocalLinkHelpers();
    const result = context.protectInlineLocalFileMarkdownLinks(
      '`[paper manuscript.docx](<D:/work/paper manuscript.docx>)`',
    );

    expect(result.text).toBe('§§SCHOLAR_HARNESS_LOCAL_FILE_LINK_0§§');
    expect(result.replacements).toHaveLength(1);
    expect(result.replacements[0]).toContain('class="message-local-file-link"');
    expect(result.replacements[0]).not.toContain('<code');
    expect(result.replacements[0]).not.toContain('<a ');
  });

  it('opens local files from Enter or Space without allowing a navigation default', () => {
    const { context, openOutputAttachmentFile } = loadLocalLinkHelpers();
    const link = { getAttribute: () => 'D:/work/result.docx' };
    const enter = { key: 'Enter', preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const letter = { key: 'a', preventDefault: vi.fn(), stopPropagation: vi.fn() };

    expect(context.handleMessageLocalFileLinkKeydown(link, enter)).toBe(false);
    expect(enter.preventDefault).toHaveBeenCalledOnce();
    expect(enter.stopPropagation).toHaveBeenCalledOnce();
    expect(openOutputAttachmentFile).toHaveBeenCalledWith(link);
    expect(context.handleMessageLocalFileLinkKeydown(link, letter)).toBe(true);
    expect(letter.preventDefault).not.toHaveBeenCalled();
  });

  it('recognizes forward-slash Windows artifact paths when rendering file cards', () => {
    const { source } = loadLocalLinkHelpers();
    expect(source).toContain('/[a-zA-Z]:[\\\\/]');
    expect(source).toContain('）\\]}>]|$)');
    expect(source).toContain('if (/^[a-zA-Z]:[\\\\/]/.test(value)) return true;');
  });
});
