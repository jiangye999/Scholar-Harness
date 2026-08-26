import { mkdtempSync, readFileSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { AgentConversationSyncStore } from '../../src/bridge/agent-runtime/conversation-sync';

describe('AgentConversationSyncStore', () => {
  it('persists per-Agent watermarks and returns only unseen visible messages after restart', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'scholar-agent-sync-'));
    const statePath = path.join(directory, 'conversation-sync.json');
    const history = [
      { role: 'user' as const, content: '先检查论文结构' },
      { role: 'assistant' as const, content: '结构检查完成' },
    ];

    try {
      const firstStore = new AgentConversationSyncStore(statePath);
      expect(firstStore.getDelta('pi:conversation-1', history)).toEqual(history);
      firstStore.acknowledge('pi:conversation-1', history, '生成结果表', '结果表已生成');

      const restartedStore = new AgentConversationSyncStore(statePath);
      const currentHistory = [
        ...history,
        { role: 'user' as const, content: '生成结果表' },
        { role: 'assistant' as const, content: '结果表已生成' },
        { role: 'user' as const, content: '由 OpenCode 补充文件检查' },
        { role: 'assistant' as const, content: '文件检查已完成' },
      ];

      expect(restartedStore.getDelta('pi:conversation-1', currentHistory)).toEqual(
        currentHistory.slice(-2),
      );
      expect(restartedStore.getDelta('opencode:conversation-1', currentHistory)).toEqual(
        currentHistory,
      );

      const persisted = readFileSync(statePath, 'utf-8');
      expect(persisted).not.toContain('生成结果表');
      expect(persisted).not.toContain('结果表已生成');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('recognizes a budget-compacted long answer by its stable head and tail', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'scholar-agent-sync-'));
    const statePath = path.join(directory, 'conversation-sync.json');
    const longAnswer = `${'开头证据'.repeat(100)}${'中间内容'.repeat(800)}${'末尾结论'.repeat(100)}`;
    const compactedAnswer = `${longAnswer.slice(0, 1_440)}\n\n[对话历史消息已按提示词预算压缩；保留开头规则与末尾约束]\n\n${longAnswer.slice(-560)}`;

    try {
      const store = new AgentConversationSyncStore(statePath);
      store.acknowledge('codex:conversation-2', [], '分析数据', longAnswer);

      const delta = store.getDelta('codex:conversation-2', [
        { role: 'user', content: '分析数据' },
        { role: 'assistant', content: compactedAnswer },
        { role: 'user', content: 'Pi 新增了敏感性分析' },
      ]);

      expect(delta).toEqual([
        { role: 'user', content: 'Pi 新增了敏感性分析' },
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('resynchronizes the current compact summary when no prior sequence overlaps', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'scholar-agent-sync-'));
    const statePath = path.join(directory, 'conversation-sync.json');

    try {
      const store = new AgentConversationSyncStore(statePath);
      store.acknowledge('codex:conversation-3', [], '旧问题', '旧回答');
      const compactedHistory = [
        { role: 'system' as const, content: '此前对话 compact 摘要：已经确定方法和数据路径。' },
      ];

      expect(store.getDelta('codex:conversation-3', compactedHistory)).toEqual(compactedHistory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('returns only native-session context blocks whose content changed', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'scholar-agent-sync-'));
    const statePath = path.join(directory, 'conversation-sync.json');
    const initialContext = {
      workspace: 'D:\\paper | workspace-write',
      writingProgress: 'Results | 2/5',
      discussionFramework: 'confirmed | 5 chapters',
    };

    try {
      const store = new AgentConversationSyncStore(statePath);
      expect(store.getContextDelta('pi:conversation-4', initialContext)).toEqual(initialContext);
      store.acknowledge('pi:conversation-4', [], '检查结果', '已检查', initialContext);

      const restartedStore = new AgentConversationSyncStore(statePath);
      expect(restartedStore.getContextDelta('pi:conversation-4', initialContext)).toEqual({});
      expect(restartedStore.getContextDelta('pi:conversation-4', {
        ...initialContext,
        writingProgress: 'Discussion | 3/5',
      })).toEqual({ writingProgress: 'Discussion | 3/5' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
