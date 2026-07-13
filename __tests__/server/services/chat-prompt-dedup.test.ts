import { describe, expect, it } from 'vitest';

import {
  CHAT_SYSTEM_PROMPT_VERSION,
  buildChatSystemPrompt,
} from '../../../src/server/services/chat-system-prompt';
import { omitTrailingCurrentUserRequest } from '../../../src/server/services/chat-prompt-dedup';

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('Chat prompt deduplication', () => {
  it('keeps citation and draft rules in one canonical system policy', () => {
    const prompt = buildChatSystemPrompt();

    expect(prompt).toContain('## 证据与引用规则');
    expect(prompt).toContain('## 论文草稿保存协议');
    expect(countOccurrences(prompt, '(Zhang et al., 2026)')).toBe(1);
    expect(countOccurrences(prompt, '🔧 调用工具：save_draft')).toBe(1);
    expect(countOccurrences(prompt, CHAT_SYSTEM_PROMPT_VERSION)).toBe(1);
    expect(prompt).toContain('文末参考文献条目直接从完整作者信息开始');
    expect(prompt).toContain('不得在条目前重复添加 `(Yang et al., 2024)`');
    expect(prompt).not.toContain('(第一作者姓氏 et al., 年份) 全部作者');
  });

  it('removes only the trailing history copy of the current request', () => {
    const history = [
      { role: 'user', content: '继续处理图表' },
      { role: 'assistant', content: '已完成第一步' },
      { role: 'user', content: '继续处理图表' },
    ];

    const result = omitTrailingCurrentUserRequest(history, ['继续处理图表']);

    expect(result).toEqual([
      { role: 'user', content: '继续处理图表' },
      { role: 'assistant', content: '已完成第一步' },
    ]);
    expect(history).toHaveLength(3);
  });

  it('preserves history when its latest user message is a different request', () => {
    const history = [
      { role: 'user', content: '先分析数据' },
      { role: 'assistant', content: '分析完成' },
    ];

    expect(omitTrailingCurrentUserRequest(history, ['重新作图'])).toEqual(history);
  });
});
