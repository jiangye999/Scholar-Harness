import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

function readFunctionBody(name: string, nextName: string): string {
  const start = html.indexOf(`function ${name}`);
  const end = html.indexOf(`function ${nextName}`, start + 1);
  return start >= 0 && end > start ? html.slice(start, end) : '';
}

describe('right article progress sidebar', () => {
  it('removes the manual discussion framework page and opens article progress instead', () => {
    expect(html).not.toContain('id="rightSidebarTabDiscussion"');
    expect(html).not.toContain('id="discussionFrameworkPage"');
    expect(html).toContain('onclick="openArticleWritingProgressPanel()"');
    expect(html).toContain('id="articleWritingProgressMeta"');
  });

  it('builds visible chapters only from persisted TXT drafts', () => {
    const body = readFunctionBody('getArticleWritingProgressItemsForContext()', 'getArticleWritingProgressSnapshot()');
    expect(body).toContain('articleDraftProgressCache.drafts');
    expect(body).not.toContain('loadDiscussionFrameworkState');
    expect(body).not.toContain("type: 'framework'");
  });

  it('renders chapter content read-only and no longer attaches manual framework context', () => {
    const body = readFunctionBody('renderArticleWritingProgressPanel(forceDraftReload)', 'scheduleArticleChapterDraftSave(textarea)');
    expect(body).toContain('article-draft-readonly-content');
    expect(body).not.toContain('<textarea');
    expect(html).not.toContain('context.discussionFramework = await buildDiscussionFrameworkContextForChat()');
  });

  it('uses one quarter of the window as the default sidebar width', () => {
    expect(html).toContain('width: var(--right-sidebar-width, 25vw);');
    expect(html).toContain('return Math.round(window.innerWidth * 0.25);');
    expect(html).toContain("var RIGHT_SIDEBAR_WIDTH_VERSION = '6';");
    expect(html).toContain('RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY');
  });
});
