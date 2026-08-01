import { describe, expect, it } from 'vitest';

import { decideOrdinaryDraftContextAttachment } from '../../../src/server/services/prompt-context-policy';

describe('prompt context policy', () => {
  it('keeps the ordinary draft for writing requests and contextual editing follow-ups', () => {
    expect(decideOrdinaryDraftContextAttachment({
      message: '继续完善 Discussion',
      queryIntent: { primaryIntent: 'academic_writing', action: 'continue' },
    })).toMatchObject({ attach: true });

    expect(decideOrdinaryDraftContextAttachment({
      message: '继续刚才的修改',
      queryIntent: {
        primaryIntent: 'workspace_file',
        action: 'edit',
        isContextualFollowUp: true,
      },
    })).toMatchObject({ attach: true });
  });

  it('does not preload a large draft for unrelated configuration or general-chat requests', () => {
    expect(decideOrdinaryDraftContextAttachment({
      message: 'Python 插件怎么配置？',
      queryIntent: { primaryIntent: 'skill_or_tool', action: 'configure' },
    })).toEqual({
      attach: false,
      reason: 'unrelated-intent:skill_or_tool',
    });

    expect(decideOrdinaryDraftContextAttachment({
      message: '你好',
      queryIntent: { primaryIntent: 'general_chat', action: 'explain' },
    }).attach).toBe(false);
  });

  it('keeps the draft when the active page carries writing state even if the query is short', () => {
    expect(decideOrdinaryDraftContextAttachment({
      message: '继续',
      queryIntent: { primaryIntent: 'general_chat', action: 'continue' },
      context: { articleWritingProgress: { available: true } },
    })).toMatchObject({
      attach: true,
      reason: 'active-writing-page-state',
    });
  });
});
