import { describe, expect, it } from 'vitest';

import {
  budgetAgentPrompt,
  compactAgentContextValue,
  precomputeAgentContext,
} from '../../../src/orchestrator/agent-context-budget';

describe('shared Agent context budget', () => {
  it('deduplicates repeated sections and preserves the current user request', () => {
    const repeated = `## 长期记忆\n${'重复记忆 '.repeat(2_000)}`;
    const currentRequest = '请对已选 Meta 数据执行随机效应模型，并保留可恢复的运行状态。';
    const result = budgetAgentPrompt(
      [
        repeated,
        repeated,
        `## CURRENT_USER_REQUEST\n${currentRequest}`,
        `## Core Workflow\n${'低优先级说明 '.repeat(2_000)}`,
      ].join('\n\n'),
      { profile: 'meta-analysis', maxChars: 12_000 },
    );

    expect(result.prompt.length).toBeLessThanOrEqual(12_000);
    expect(result.prompt).toContain(currentRequest);
    expect(result.diagnostics.deduplicatedSectionCount).toBe(1);
    expect(result.diagnostics.afterChars).toBeLessThan(result.diagnostics.beforeChars);
  });

  it('precomputes one provider-visible budget across prompt, Skill catalog and history', () => {
    const duplicateHistory = '这是已经包含在主动态上下文中的一条完整历史消息，用来验证交接历史不会被重复追加。'.repeat(3);
    const result = precomputeAgentContext({
      profile: 'main-chat',
      maxChars: 32_000,
      prompt: [
        `## 当前对话历史\n${duplicateHistory}`,
        `## CURRENT_USER_REQUEST\n${'当前任务 '.repeat(4_000)}`,
      ].join('\n\n'),
      catalogPrompt: `## Skill 清单\n${'catalog '.repeat(5_000)}`,
      explicitSkillPrompt: `## 用户显式调用的自定义 Skill\n${'skill '.repeat(5_000)}`,
      conversationHandoff: [
        { role: 'assistant', content: duplicateHistory },
        { role: 'user', content: '这是只存在于交接历史中的最近用户请求。' },
      ],
    });

    expect(result.diagnostics.totalChars).toBeLessThanOrEqual(32_000);
    expect(result.diagnostics.omittedDuplicateHandoffMessages).toBe(1);
    expect(result.conversationHandoff).toHaveLength(1);
    expect(result.conversationHandoff[0].content).toContain('最近用户请求');
    expect(result.catalogPrompt.length).toBeGreaterThan(0);
    expect(result.catalogPrompt.length).toBeLessThanOrEqual(4_000);
    expect(result.explicitSkillPrompt.length).toBeGreaterThan(0);
  });

  it('bounds deeply nested structured workflow payloads before prompt rendering', () => {
    const compacted = compactAgentContextValue(
      {
        rows: Array.from({ length: 200 }, (_, index) => ({
          index,
          abstract: `摘要 ${index} ${'证据 '.repeat(1_000)}`,
        })),
      },
      {
        maxChars: 6_000,
        maxArrayItems: 12,
        maxStringChars: 600,
      },
    );
    const serialized = JSON.stringify(compacted);

    expect(serialized.length).toBeLessThanOrEqual(6_500);
    expect(serialized).toMatch(/omittedItems|统一上下文/);
  });
});
