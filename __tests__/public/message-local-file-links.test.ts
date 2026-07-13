import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

import { describe, expect, it, vi } from 'vitest';

function loadLocalLinkHelpers() {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'src/public/index.html'),
    'utf-8',
  );
  const start = source.indexOf('    function decodeMessageLinkTarget(value) {');
  const end = source.indexOf('    function isCollapsibleRCodeBlock(language, code) {', start);
  if (start < 0 || end < 0) throw new Error('Local message link helpers were not found');
  const openOutputAttachmentFile = vi.fn(async () => undefined);
  const context = vm.createContext({
    window: {},
    decodeURIComponent,
    escapeHtml: (value: unknown) => String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;'),
    isOutputAttachmentPath: (value: unknown) => /\.(?:docx?|xlsx?|pdf|png|txt)$/i.test(String(value || '')),
    openOutputAttachmentFile,
  });
  vm.runInContext(source.slice(start, end), context);
  return {
    context: context as unknown as {
      decodeMessageLinkTarget: (value: string) => string;
      isMessageLocalFileLinkTarget: (value: string) => boolean;
      renderMessageMarkdownLink: (label: string, target: string) => string;
      openMessageLocalFileLink: (link: unknown, event: unknown) => Promise<boolean>;
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
    expect(html).toContain('openMessageLocalFileLink(this,event)');
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

  it('recognizes forward-slash Windows artifact paths when rendering file cards', () => {
    const { source } = loadLocalLinkHelpers();
    expect(source).toContain('/[a-zA-Z]:[\\\\/]');
    expect(source).toContain('）\\]}>]|$)');
    expect(source).toContain('if (/^[a-zA-Z]:[\\\\/]/.test(value)) return true;');
  });
});
