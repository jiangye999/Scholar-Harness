import { EventEmitter } from 'events';
import { PassThrough } from 'stream';

import { afterEach, describe, expect, it } from 'vitest';

import { codexAppServerManager } from '../../src/bridge/chat-bridge/codex-app-server';
import type { CodexBridgeToolSet } from '../../src/types';

interface FakeProcess extends EventEmitter {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
  kill: () => boolean;
}

function createFakeAppServer(onMethod?: (method: string) => void): FakeProcess {
  const child = new EventEmitter() as FakeProcess;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {
    child.emit('close', 0);
    return true;
  };
  let inputBuffer = '';
  let turn = 0;
  const send = (value: unknown): void => {
    child.stdout.write(`${JSON.stringify(value)}\n`);
  };
  child.stdin.on('data', chunk => {
    inputBuffer += String(chunk);
    const lines = inputBuffer.split(/\r?\n/);
    inputBuffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const request = JSON.parse(line) as { id?: number; method?: string; params?: any };
      if (!request.method) continue;
      onMethod?.(request.method);
      if (request.id === undefined) continue;
      if (request.method === 'initialize') {
        send({ jsonrpc: '2.0', id: request.id, result: { userAgent: 'fake' } });
      } else if (request.method === 'thread/start') {
        send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: 'thread-persistent' } } });
      } else if (request.method === 'thread/resume') {
        send({ jsonrpc: '2.0', id: request.id, result: { thread: { id: request.params.threadId } } });
      } else if (request.method === 'mcpServerStatus/list') {
        send({
          jsonrpc: '2.0',
          id: request.id,
          result: { data: [{ name: 'scholar_harness', tools: { echo_tool: {} } }], nextCursor: null },
        });
      } else if (request.method === 'skills/extraRoots/set' || request.method === 'thread/compact/start') {
        send({ jsonrpc: '2.0', id: request.id, result: {} });
      } else if (request.method === 'turn/start') {
        turn += 1;
        const turnId = `turn-${turn}`;
        const item = {
          type: 'agentMessage',
          id: `answer-${turn}`,
          text: `answer ${turn}`,
          phase: 'final_answer',
          memoryCitation: null,
        };
        send({
          jsonrpc: '2.0',
          id: request.id,
          result: { turn: { id: turnId, status: 'inProgress', items: [] } },
        });
        queueMicrotask(() => {
          send({ jsonrpc: '2.0', method: 'item/completed', params: { threadId: 'thread-persistent', turnId, item } });
          send({
            jsonrpc: '2.0',
            method: 'thread/tokenUsage/updated',
            params: {
              threadId: 'thread-persistent',
              turnId,
              tokenUsage: {
                last: { inputTokens: 10, outputTokens: 2, reasoningOutputTokens: 1, totalTokens: 12 },
              },
            },
          });
          send({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: {
              threadId: 'thread-persistent',
              turn: { id: turnId, status: 'completed', error: null, items: [item] },
            },
          });
        });
      }
    }
  });
  return child;
}

describe('Codex App Server lifecycle', () => {
  const conversationKeys: string[] = [];

  afterEach(() => {
    for (const key of conversationKeys.splice(0)) {
      codexAppServerManager.disposeConversation(key, true);
    }
  });

  it('reuses one process and one thread for consecutive Scholar Harness turns', async () => {
    const conversationKey = `vitest-${Date.now()}-${Math.random()}`;
    conversationKeys.push(conversationKey);
    const methods: string[] = [];
    let spawnCount = 0;
    const toolSet: CodexBridgeToolSet = {
      definitions: [{
        type: 'function',
        function: {
          name: 'echo_tool',
          description: 'test tool',
          parameters: { type: 'object', properties: {} },
        },
      }],
      execute: async () => ({ ok: true }),
    };
    const common = {
      conversationKey,
      cwd: process.cwd(),
      reasoningEffort: 'low',
      sandbox: 'read-only' as const,
      timeoutMs: 10_000,
      toolSet,
      spawnAppServer: () => {
        spawnCount += 1;
        return createFakeAppServer(method => methods.push(method)) as any;
      },
    };

    const first = await codexAppServerManager.runTurn({ ...common, prompt: 'first' });
    const second = await codexAppServerManager.runTurn({ ...common, prompt: 'second' });

    expect(spawnCount).toBe(1);
    expect(first.threadId).toBe('thread-persistent');
    expect(second.threadId).toBe(first.threadId);
    expect(first.answer).toBe('answer 1');
    expect(second.answer).toBe('answer 2');
    expect(first.usage?.inputTokens).toBe(10);
    expect(methods.filter(method => method === 'thread/start')).toHaveLength(1);
    expect(methods.filter(method => method === 'turn/start')).toHaveLength(2);
  });
});
