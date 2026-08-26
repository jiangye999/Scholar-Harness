import { describe, expect, it } from 'vitest';

import {
  buildProjectContinuityPromptBlock,
  collectProjectUserRequirements,
  deriveProjectWritingStatus,
} from '../../../src/server/services/project-writing-status';

describe('project writing status', () => {
  it('does not regress an existing draft project to framework planning', () => {
    const context = {
      discussionFramework: {
        available: true,
        planningStatus: 'draft',
        progressSummary: { analyzedChapters: 1 },
      },
      articleWritingProgress: {
        available: true,
        totalChapterCount: 6,
        chapters: [
          { key: 'introduction', drafted: true, draftChars: 4200, status: 'not_started' },
          { key: 'methods', drafted: true, draftChars: 6100, status: 'in_progress', current: true },
        ],
      },
      articleDraftChapterRegistry: {
        available: true,
        chapters: [
          { key: 'introduction', exists: true },
          { key: 'methods', exists: true },
        ],
      },
    };

    const status = deriveProjectWritingStatus(context);

    expect(status.stage).toBe('drafting');
    expect(status.stageLabel).toBe('章节写作与修改阶段');
    expect(status.frameworkExplicitlyConfirmed).toBe(false);
    expect(status.canContinueWriting).toBe(true);
    expect(status.draftedChapterCount).toBe(2);
    expect(buildProjectContinuityPromptBlock(context)).toContain('不得把整个项目说成“仍处于规划阶段”');
  });

  it('keeps a genuinely new unconfirmed project in planning', () => {
    const status = deriveProjectWritingStatus({
      discussionFramework: { available: true, planningStatus: 'draft' },
      articleWritingProgress: {
        available: true,
        totalChapterCount: 6,
        chapters: [{ key: 'introduction', drafted: false, status: 'not_started' }],
      },
    });

    expect(status.stage).toBe('planning');
    expect(status.canContinueWriting).toBe(false);
  });

  it('treats an explicitly confirmed framework as ready to write', () => {
    const status = deriveProjectWritingStatus({
      discussionFramework: { available: true, planningStatus: 'confirmed' },
      articleWritingProgress: { available: true, totalChapterCount: 5, chapters: [] },
    });

    expect(status.stage).toBe('ready_to_write');
    expect(status.canContinueWriting).toBe(true);
  });

  it('injects persisted preferences and recent user requirements but ignores greetings', () => {
    const requirements = collectProjectUserRequirements({
      memory: {
        targetJournal: 'Global Change Biology',
        writingStyle: '全文使用简洁、克制的学术英语。',
        citationPreferences: '所有关键论断都要有可核验引用。',
      },
    }, [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！' },
      { role: 'user', content: '结果部分不要重复讨论内容，并保留效应量。' },
    ]);

    expect(requirements.map(item => item.text)).toEqual(expect.arrayContaining([
      'Global Change Biology',
      '全文使用简洁、克制的学术英语。',
      '所有关键论断都要有可核验引用。',
      '结果部分不要重复讨论内容，并保留效应量。',
    ]));
    expect(requirements.some(item => item.text === '你好')).toBe(false);
  });
});
