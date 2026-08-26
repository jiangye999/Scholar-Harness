import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

function readFunctionBody(name: string, nextName: string): string {
  const start = html.indexOf(`function ${name}`);
  const end = html.indexOf(`function ${nextName}`, start + 1);
  return start >= 0 && end > start ? html.slice(start, end) : '';
}

describe('right article progress sidebar', () => {
  it('removes the manual discussion framework page and toggles article progress from the composer', () => {
    expect(html).not.toContain('id="rightSidebarTabDiscussion"');
    expect(html).not.toContain('id="discussionFrameworkPage"');
    expect(html).toContain('id="articleWritingProgressBtn"');
    expect(html).toContain('onclick="toggleArticleWritingProgressPanel()"');
    expect(html).toContain('aria-controls="articleProgressPage" aria-expanded="false"');
    expect(html).toContain('id="articleWritingProgressMeta"');

    const body = readFunctionBody('toggleArticleWritingProgressPanel()', 'openPaperFigureLibraryPanel()');
    expect(body).toContain("getRightSidebarActiveTab() === 'article'");
    expect(body).toContain('setRightSidebarCollapsed(true);');
    expect(body).toContain('openArticleWritingProgressPanel();');
  });

  it('builds visible chapters from the current project framework and only uses TXT as hidden status metadata', () => {
    const body = readFunctionBody('getArticleWritingProgressItemsForContext()', 'getArticleWritingProgressSnapshot()');
    expect(body).toContain('articleDraftProgressCache.drafts');
    expect(body).toContain('loadDiscussionFrameworkState');
    expect(body).toContain("type: 'framework'");
    expect(body).not.toContain('content: draft.content');
  });

  it('renders framework planning without chapter draft prose and attaches it to every Agent turn', () => {
    const body = readFunctionBody('renderArticleWritingProgressPanel(forceDraftReload)', 'scheduleArticleChapterDraftSave(textarea)');
    expect(body).toContain('当前项目论文框架');
    expect(body).toContain('本章定位与写作目标');
    expect(body).toContain('小节与论证顺序');
    expect(body).toContain('证据、图表与材料安排');
    expect(body).toContain('调整本章规划');
    expect(body).not.toContain('article-draft-readonly-content');
    expect(body).not.toContain('draft.content');
    expect(html).toContain('context.discussionFramework = discussionFramework');
    expect(html).toContain("planningStatus: state.planningStatus");
  });

  it('requires user confirmation before正文 writing and exposes planning actions', () => {
    expect(html).toContain('function startArticleFrameworkPlanning()');
    expect(html).toContain('function confirmArticleFrameworkPlanning()');
    expect(html).toContain("state.planningStatus = 'confirmed'");
    expect(html).toContain('必须等我在右侧确认框架后再开始正文写作');
    expect(html).toContain('与 AI 规划');
    expect(html).toContain('确认框架');
  });

  it('uses three eighths of the window as the default sidebar width', () => {
    expect(html).toContain('width: var(--right-sidebar-width, 37.5vw);');
    expect(html).toContain('var RIGHT_SIDEBAR_DEFAULT_RATIO = 0.375;');
    expect(html).toContain('return Math.round(viewportWidth * RIGHT_SIDEBAR_DEFAULT_RATIO);');
    expect(html).toContain("var RIGHT_SIDEBAR_WIDTH_VERSION = '9';");
    expect(html).toContain('var RIGHT_SIDEBAR_MAX_WIDTH = 1350;');
    expect(html).toContain('RIGHT_SIDEBAR_CUSTOM_WIDTH_KEY');
  });
});
