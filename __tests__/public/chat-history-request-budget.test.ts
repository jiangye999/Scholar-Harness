import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const source = readPublicAppSource();

describe('main chat history request budget', () => {
  it('builds a bounded network copy instead of sending raw local history', () => {
    expect(source).toContain('var MAIN_CHAT_HISTORY_MAX_ITEMS = 20;');
    expect(source).toContain('var MAIN_CHAT_HISTORY_MESSAGE_MAX_CHARS = 20000;');
    expect(source).toContain('var MAIN_CHAT_HISTORY_TOTAL_MAX_CHARS = 100000;');
    expect(source).toContain('function buildMainChatHistoryRequestPayload(messages)');
    expect(source).toContain('var historyMsgs = buildMainChatHistoryRequestPayload(savedMsgs);');
    expect(source).not.toContain('var historyMsgs = savedMsgs.slice(-20);');
    expect(source).toContain('完整内容仍保存在本地会话中');
  });

  it('does not mislabel a history budget rejection as a Codex configuration failure', () => {
    expect(source).toContain('/单条历史消息过长|历史消息过多|history message.*too long|history.*too many/i');
    expect(source).toContain('对话历史上下文过长，本次请求未发送。');
    expect(source).toContain('切换模型或检查 Codex CLI 无法解决历史长度问题。');
  });
});
