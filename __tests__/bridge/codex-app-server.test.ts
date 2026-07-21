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

function createFakeAppServer(
  onMethod?: (method: string, params?: any) => void,
  turnCompletionDelayMs = 0,
  availableTools: string[] = ['echo_tool'],
): FakeProcess {
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
  let activeTurnId = '';
  let activeTurnTimer: ReturnType<typeof setTimeout> | undefined;
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
      onMethod?.(request.method, request.params);
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
          result: {
            data: [{
              name: 'scholar_harness',
              tools: Object.fromEntries(availableTools.map(name => [name, {}])),
            }],
            nextCursor: null,
          },
        });
      } else if (request.method === 'skills/extraRoots/set' || request.method === 'thread/compact/start') {
        send({ jsonrpc: '2.0', id: request.id, result: {} });
      } else if (request.method === 'turn/steer') {
        send({ jsonrpc: '2.0', id: request.id, result: { accepted: true } });
      } else if (request.method === 'turn/interrupt') {
        send({ jsonrpc: '2.0', id: request.id, result: { interrupted: true } });
        if (activeTurnTimer) clearTimeout(activeTurnTimer);
        if (activeTurnId) {
          send({
            jsonrpc: '2.0',
            method: 'turn/completed',
            params: {
              threadId: 'thread-persistent',
              turn: { id: activeTurnId, status: 'interrupted', error: null, items: [] },
            },
          });
          activeTurnId = '';
        }
      } else if (request.method === 'turn/start') {
        turn += 1;
        const turnId = `turn-${turn}`;
        activeTurnId = turnId;
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
        const completeTurn = () => {
          if (activeTurnId !== turnId) return;
          activeTurnId = '';
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
        };
        if (turnCompletionDelayMs > 0) activeTurnTimer = setTimeout(completeTurn, turnCompletionDelayMs);
        else queueMicrotask(completeTurn);
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

  it('reloads a changed MCP tool catalogue and resumes the same Codex thread', async () => {
    const conversationKey = `vitest-tools-${Date.now()}-${Math.random()}`;
    conversationKeys.push(conversationKey);
    const methods: string[] = [];
    let spawnCount = 0;
    const echoTool: CodexBridgeToolSet['definitions'][number] = {
      type: 'function',
      function: {
        name: 'echo_tool',
        description: 'test tool',
        parameters: { type: 'object', properties: {} },
      },
    };
    const fileSearchTool: CodexBridgeToolSet['definitions'][number] = {
      type: 'function',
      function: {
        name: 'file_search',
        description: 'recursively search the authorized workspace',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      },
    };
    const common = {
      conversationKey,
      cwd: process.cwd(),
      reasoningEffort: 'low',
      sandbox: 'read-only' as const,
      timeoutMs: 10_000,
      spawnAppServer: () => {
        spawnCount += 1;
        const tools = spawnCount === 1 ? ['echo_tool'] : ['echo_tool', 'file_search'];
        return createFakeAppServer(method => methods.push(method), 0, tools) as any;
      },
    };

    const first = await codexAppServerManager.runTurn({
      ...common,
      prompt: 'ordinary chat',
      toolSet: { definitions: [echoTool], execute: async () => ({ ok: true }) },
    });
    const second = await codexAppServerManager.runTurn({
      ...common,
      prompt: 'search nested files',
      toolSet: { definitions: [echoTool, fileSearchTool], execute: async () => ({ ok: true }) },
    });

    expect(spawnCount).toBe(2);
    expect(first.threadId).toBe('thread-persistent');
    expect(second.threadId).toBe(first.threadId);
    expect(second.resumed).toBe(true);
    expect(methods.filter(method => method === 'thread/start')).toHaveLength(1);
    expect(methods.filter(method => method === 'thread/resume')).toHaveLength(1);
  });

  it('restarts the runtime and resumes the same thread when workspace permission changes', async () => {
    const conversationKey = `vitest-permission-${Date.now()}-${Math.random()}`;
    conversationKeys.push(conversationKey);
    const requests: Array<{ method: string; params?: any }> = [];
    const progress: string[] = [];
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
    const spawnAppServer = () => {
      spawnCount += 1;
      return createFakeAppServer((method, params) => {
        requests.push({ method, params });
      }) as any;
    };

    const first = await codexAppServerManager.runTurn({
      conversationKey,
      cwd: 'D:\\paper',
      prompt: 'inspect the draft',
      sandbox: 'read-only',
      timeoutMs: 10_000,
      toolSet,
      spawnAppServer,
    });
    const second = await codexAppServerManager.runTurn({
      conversationKey,
      cwd: 'D:\\paper\\ScholarHarness_AI_Workspaces\\Conversation-test',
      prompt: 'update the draft',
      sandbox: 'workspace-write',
      timeoutMs: 10_000,
      toolSet,
      spawnAppServer,
      onProgress: chunk => progress.push(chunk),
    });

    expect(spawnCount).toBe(2);
    expect(second.threadId).toBe(first.threadId);
    expect(second.resumed).toBe(true);
    expect(requests.filter(request => request.method === 'thread/start')).toHaveLength(1);
    const resumeRequest = requests.find(request => request.method === 'thread/resume');
    expect(resumeRequest?.params).toMatchObject({
      threadId: first.threadId,
      cwd: 'D:\\paper\\ScholarHarness_AI_Workspaces\\Conversation-test',
      sandbox: 'workspace-write',
    });
    expect(progress.join('')).toContain('正在按新权限重启 Codex 运行环境');
  });

  it('injects one queued Pi steering message into an active Codex turn', async () => {
    const conversationKey = `vitest-steer-${Date.now()}-${Math.random()}`;
    conversationKeys.push(conversationKey);
    const methods: string[] = [];
    const requests: Array<{ method: string; params?: any }> = [];
    const applied: string[] = [];
    let delivered = false;

    const result = await codexAppServerManager.runTurn({
      conversationKey,
      cwd: process.cwd(),
      prompt: 'initial request',
      sandbox: 'read-only',
      timeoutMs: 10_000,
      takeSteeringMessages: async () => {
        if (delivered) return [];
        delivered = true;
        return [{ id: 'pi_msg_test_steer', message: 'Focus on the mechanism section.' }];
      },
      markSteeringApplied: async messageId => {
        applied.push(messageId);
      },
      requeueSteeringMessage: async () => undefined,
      spawnAppServer: () => createFakeAppServer((method, params) => {
        methods.push(method);
        requests.push({ method, params });
      }, 60) as any,
    });

    expect(result.answer).toBe('answer 1');
    expect(methods).toContain('turn/steer');
    const steerRequest = requests.find(request => request.method === 'turn/steer');
    expect(steerRequest?.params).toMatchObject({
      expectedTurnId: expect.any(String),
    });
    expect(steerRequest?.params).not.toHaveProperty('turnId');
    expect(applied).toEqual(['pi_msg_test_steer']);
  });

  it('interrupts the active backend turn by conversation prefix', async () => {
    const conversationKey = `vitest-user:vitest-conversation:${Date.now()}`;
    conversationKeys.push(conversationKey);
    let notifyTurnStarted!: () => void;
    const turnStarted = new Promise<void>(resolve => {
      notifyTurnStarted = resolve;
    });
    const turnPromise = codexAppServerManager.runTurn({
      conversationKey,
      cwd: process.cwd(),
      prompt: 'long running request',
      sandbox: 'read-only',
      timeoutMs: 10_000,
      spawnAppServer: () => createFakeAppServer(method => {
        if (method === 'turn/start') notifyTurnStarted();
      }, 5_000) as any,
    });

    await turnStarted;
    const interruption = await codexAppServerManager.interruptConversationsByPrefix(
      'vitest-user:vitest-conversation:',
    );

    expect(interruption.matched).toBe(1);
    expect(interruption.interrupted).toBe(1);
    await expect(turnPromise).rejects.toThrow(/cancel|interrupt/i);
  });
});
