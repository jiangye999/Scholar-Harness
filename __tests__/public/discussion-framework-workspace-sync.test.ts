import { describe, expect, it } from 'vitest';

import { readPublicAppSource, readPublicStyleSource } from '../helpers/public-app-source';

describe('project paper framework workspace sync', () => {
  const source = readPublicAppSource();
  const styles = readPublicStyleSource('styles/shell-layout.css');

  it('persists the framework to the current project and includes its project identity in Agent context', () => {
    expect(source).toContain("fetch('/api/discussion-framework/state'");
    expect(source).toContain('expectedRevision = discussionFrameworkServerRevision');
    expect(source).toContain('projectId: getDiscussionFrameworkCurrentProjectId()');
    expect(source).toContain('storageRevision: discussionFrameworkServerRevision');
  });

  it('offers workspace extraction, a diff preview and explicit user application', () => {
    expect(source).toContain('从工作目录更新');
    expect(source).toContain("fetch('/api/discussion-framework/scan'");
    expect(source).toContain('论文框架更新预览');
    expect(source).toContain('确认并更新框架');
    expect(source).toContain("'/apply'");
    expect(source).toContain('planningStatus');
  });

  it('checks pending Agent proposals after a response and renders a responsive preview', () => {
    expect(source).toContain('loadPendingDiscussionFrameworkProposal(false)');
    expect(source).toContain('propose_discussion_framework_update');
    expect(styles).toContain('.discussion-framework-proposal-overlay');
    expect(styles).toContain('.discussion-framework-proposal-chapters');
  });

  it('reports effective progress from real drafts and synchronizes workspace JSON files', () => {
    expect(source).toContain('draftedChapterCount: draftedChapterCount');
    expect(source).toContain('effectiveStage: effectiveStage');
    expect(source).toContain("item.draft ? '已有草稿'");
    expect(source).toContain('当前项目处于章节写作与修改阶段');
    expect(source).toContain("fetch('/api/chat-bridge/writing-state/sync'");
  });
});
