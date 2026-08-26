import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PassThrough } from 'stream';
import type { ChildProcess } from 'child_process';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeJsonRuntimeAdapter } from '../../src/bridge/agent-runtime/opencode-json-adapter';
import { PiRpcRuntimeAdapter } from '../../src/bridge/agent-runtime/pi-rpc-adapter';
import { parseRuntimeModelLines } from '../../src/bridge/agent-runtime/process-utils';
import { buildCodingAgentAuthEnvironment, getCodingAgentProviders } from '../../src/bridge/agent-runtime/provider-auth';
import { CodingAgentRuntimeRegistry } from '../../src/bridge/agent-runtime/registry';
import type { CodingAgentProtocolAdapter } from '../../src/bridge/agent-runtime/types';
import { buildPortableAgentConversationKeyPrefix } from '../../src/bridge/chat-bridge/chat-bridge';
import { getDataDir } from '../../src/utils/paths';

const temporaryDirectories: string[] = [];

function temporaryDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeChild(): ChildProcess & {
  stdin: PassThrough;
  stdout: PassThrough;
  stderr: PassThrough;
} {
  const emitter = new EventEmitter() as ChildProcess & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
  };
  emitter.stdin = new PassThrough();
  emitter.stdout = new PassThrough();
  emitter.stderr = new PassThrough();
  emitter.kill = (() => {
    queueMicrotask(() => emitter.emit('close', 0));
    return true;
  }) as ChildProcess['kill'];
  return emitter;
}

afterEach(() => {
  temporaryDirectories.splice(0).forEach(directory => {
    fs.rmSync(directory, { recursive: true, force: true });
  });
});

describe('Coding Agent runtime adapters', () => {
  it('normalizes model inventory lines from CLI and JSON output', () => {
    expect(parseRuntimeModelLines('anthropic/claude-sonnet-4\nopenai/gpt-5.4\n')).toEqual([
      'anthropic/claude-sonnet-4',
      'openai/gpt-5.4',
    ]);
    expect(parseRuntimeModelLines('["openai/gpt-5.5","google/gemini-2.5-pro"]')).toEqual([
      'openai/gpt-5.5',
      'google/gemini-2.5-pro',
    ]);
    expect(parseRuntimeModelLines([
      'provider    model                         context  max-out  thinking  images',
      'anthropic   claude-sonnet-4-5             200K     64K      yes       yes',
      'openrouter  anthropic/claude-sonnet-4.5   200K     64K      yes       yes',
    ].join('\n'))).toEqual([
      'anthropic/claude-sonnet-4-5',
      'openrouter/anthropic/claude-sonnet-4.5',
    ]);
  });

  it('builds isolated provider authentication environments without exposing keys in model arguments', () => {
    expect(buildCodingAgentAuthEnvironment('pi', {
      mode: 'api_key',
      provider: 'openrouter',
      api_key: 'pi-secret',
    })).toEqual({ OPENROUTER_API_KEY: 'pi-secret' });
    const openCodeEnv = buildCodingAgentAuthEnvironment('opencode', {
      mode: 'api_key',
      provider: 'anthropic',
      api_key: 'oc-secret',
    });
    expect(JSON.parse(openCodeEnv.OPENCODE_AUTH_CONTENT)).toEqual({
      anthropic: { type: 'api', key: 'oc-secret' },
    });
    expect(getCodingAgentProviders('pi')).toContainEqual(expect.objectContaining({
      id: 'openrouter',
      environmentVariable: 'OPENROUTER_API_KEY',
    }));
  });

  it('builds cancellation prefixes that match versioned portable runtime session keys', () => {
    const prefix = buildPortableAgentConversationKeyPrefix(
      'pi',
      'user-1',
      'conversation-1',
      'project-1',
    );

    expect(prefix).toMatch(/^pi:[^:]+:user-1:project-1:conversation-1:$/);
    expect(`${prefix}workspace-hash:capability-signature`).toMatch(/^pi:/);
  });

  it('filters model discovery by provider and injects the configured credential', async () => {
    let piArgs: string[] = [];
    let piEnv: NodeJS.ProcessEnv | undefined;
    const pi = new PiRpcRuntimeAdapter({
      resolveExecutable: () => 'pi-test',
      capture: async (_command, args, options) => {
        piArgs = args;
        piEnv = options.env;
        return { stdout: 'openrouter/model-a\nopenrouter/model-b\n', stderr: '', code: 0 };
      },
    });
    const piModels = await pi.listModels({
      provider_auth: { mode: 'api_key', provider: 'openrouter', api_key: 'pi-secret' },
    });
    expect(piArgs).toEqual(['--list-models', 'openrouter']);
    expect(piEnv?.OPENROUTER_API_KEY).toBe('pi-secret');
    expect(piModels.map(model => model.slug)).toEqual(['openrouter/model-a', 'openrouter/model-b']);

    let openCodeArgs: string[] = [];
    let openCodeEnv: NodeJS.ProcessEnv | undefined;
    const openCode = new OpenCodeJsonRuntimeAdapter({
      resolveExecutable: () => 'opencode-test',
      capture: async (_command, args, options) => {
        openCodeArgs = args;
        openCodeEnv = options.env;
        return { stdout: 'anthropic/claude-a\n', stderr: '', code: 0 };
      },
    });
    const openCodeModels = await openCode.listModels({
      provider_auth: { mode: 'api_key', provider: 'anthropic', api_key: 'oc-secret' },
    });
    expect(openCodeArgs).toEqual(['--pure', 'models', 'anthropic', '--refresh']);
    expect(JSON.parse(String(openCodeEnv?.OPENCODE_AUTH_CONTENT))).toEqual({
      anthropic: { type: 'api', key: 'oc-secret' },
    });
    expect(openCodeModels.map(model => model.slug)).toEqual(['anthropic/claude-a']);
  });

  it('streams one Pi RPC turn and preserves its session identity and usage', async () => {
    const dataDir = temporaryDirectory('scholar-pi-runtime-');
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = dataDir;
    const child = fakeChild();
    let capturedPiArgs: string[] = [];
    let capturedPiEnv: NodeJS.ProcessEnv | undefined;
    let capturedSteering: Record<string, unknown> | null = null;
    const capturedPrompts: string[] = [];
    const commandCounts = new Map<string, number>();
    let spawnCount = 0;
    let autoCompactionEnabled = false;
    let steeringTaken = false;
    let steeringApplied = '';
    let isStreaming = false;
    const steeringImage = path.join(dataDir, 'steering.png');
    fs.writeFileSync(steeringImage, Buffer.from('89504e470d0a1a0a', 'hex'));
    let inputBuffer = '';
    child.stdin.on('data', chunk => {
      inputBuffer += String(chunk);
      while (inputBuffer.includes('\n')) {
        const index = inputBuffer.indexOf('\n');
        const line = inputBuffer.slice(0, index);
        inputBuffer = inputBuffer.slice(index + 1);
        if (!line.trim()) continue;
        const command = JSON.parse(line) as Record<string, unknown>;
        const id = String(command.id || '');
        const type = String(command.type || '');
        commandCounts.set(type, (commandCounts.get(type) || 0) + 1);
        if (type === 'get_state') {
          child.stdout.write(`${JSON.stringify({
            type: 'response',
            id,
            command: type,
            success: true,
            data: {
              sessionId: 'pi-session-1',
              sessionFile: path.join(dataDir, 'session.jsonl'),
              isStreaming,
              isCompacting: false,
              pendingMessageCount: 0,
            },
          })}\n`);
        } else if (type === 'set_model' || type === 'set_thinking_level' || type === 'set_auto_compaction') {
          if (type === 'set_auto_compaction') autoCompactionEnabled = command.enabled === true;
          child.stdout.write(`${JSON.stringify({ type: 'response', id, command: type, success: true, data: {} })}\n`);
        } else if (type === 'steer') {
          capturedSteering = command;
          child.stdout.write(`${JSON.stringify({ type: 'response', id, command: type, success: true, data: {} })}\n`);
        } else if (type === 'prompt') {
          isStreaming = true;
          capturedPrompts.push(String(command.message || ''));
          const promptNumber = capturedPrompts.length;
          child.stdout.write(`${JSON.stringify({ type: 'response', id, command: type, success: true })}\n`);
          setTimeout(() => {
            child.stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Pi ready' } })}\n`);
            child.stdout.write(`${JSON.stringify({ type: 'turn_end', message: { usage: { input: 12, output: 3, reasoning: 1 } } })}\n`);
            isStreaming = false;
            if (promptNumber === 1) {
              child.stdout.write(`${JSON.stringify({ type: 'agent_settled' })}\n`);
            } else if (promptNumber === 2) {
              // Simulate Pi persisting the final answer while losing both completion events.
            } else {
              child.stdout.write(`${JSON.stringify({ type: 'agent_end', messages: [], willRetry: false })}\n`);
              child.stdout.write(`${JSON.stringify({ type: 'agent_settled' })}\n`);
            }
          }, 650);
        }
      }
    });
    const adapter = new PiRpcRuntimeAdapter({
      resolveExecutable: () => 'pi-test',
      capture: async () => ({ stdout: 'pi 1.0', stderr: '', code: 0 }),
      spawn: (_command, args, options) => {
        spawnCount += 1;
        capturedPiArgs = args;
        capturedPiEnv = options?.env;
        return child;
      },
    });
    try {
      const events: string[] = [];
      const result = await adapter.runTurn({
        runtimeId: 'pi',
        conversationKey: 'user:conversation',
        cwd: dataDir,
        prompt: 'hello',
        model: 'openai/gpt-5.5',
        reasoningEffort: 'high',
        providerAuth: { mode: 'api_key', provider: 'openrouter', api_key: 'pi-secret' },
        sandbox: 'workspace-write',
        timeoutMs: 5_000,
        takeSteeringMessages: async () => {
          if (steeringTaken) return [];
          steeringTaken = true;
          return [{
            id: 'steer-1',
            message: '改为检查图像',
            chatAttachments: [{ path: steeringImage, type: 'image' }],
            workspaceFileMentions: [{ path: 'figures/figure-1.png' }],
          }];
        },
        markSteeringApplied: async id => { steeringApplied = id; },
        onEvent: event => events.push(event.type),
      });
      expect(result.answer).toBe('Pi ready');
      expect(result.sessionId).toBe('pi-session-1');
      expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, reasoningTokens: 1 });
      expect(events).toContain('assistant.delta');
      expect(events).toContain('turn.completed');
      expect(capturedPiArgs).toEqual(expect.arrayContaining([
        '--mode', 'rpc', '--model', 'openai/gpt-5.5', '--thinking', 'high',
      ]));
      expect(capturedPiEnv?.OPENROUTER_API_KEY).toBe('pi-secret');
      expect(autoCompactionEnabled).toBe(true);
      expect(capturedSteering).toMatchObject({
        type: 'steer',
        message: expect.stringContaining('figures/figure-1.png'),
        images: [expect.objectContaining({ type: 'image', mimeType: 'image/png' })],
      });
      expect(steeringApplied).toBe('steer-1');
      const resumedResult = await adapter.runTurn({
        runtimeId: 'pi',
        conversationKey: 'user:conversation',
        cwd: dataDir,
        prompt: 'full bootstrap must not be resent',
        resumePrompt: 'small session delta',
        model: 'openai/gpt-5.5',
        reasoningEffort: 'high',
        providerAuth: { mode: 'api_key', provider: 'openrouter', api_key: 'pi-secret' },
        sandbox: 'workspace-write',
        timeoutMs: 5_000,
        onEvent: event => events.push(event.type),
      });
      expect(resumedResult.resumed).toBe(true);
      expect(capturedPrompts).toEqual(['hello', 'small session delta']);
      expect(spawnCount).toBe(1);
      expect(commandCounts.get('get_state')).toBeGreaterThanOrEqual(3);
      expect(commandCounts.get('set_auto_compaction')).toBe(1);
      expect(commandCounts.get('set_model') || 0).toBe(0);
      expect(commandCounts.get('set_thinking_level') || 0).toBe(0);

      const reconfiguredResult = await adapter.runTurn({
        runtimeId: 'pi',
        conversationKey: 'user:conversation',
        cwd: dataDir,
        prompt: 'full bootstrap still must not be resent',
        resumePrompt: 'changed model session delta',
        model: 'openai/gpt-5.6',
        reasoningEffort: 'xhigh',
        providerAuth: { mode: 'api_key', provider: 'openrouter', api_key: 'pi-secret' },
        sandbox: 'workspace-write',
        timeoutMs: 5_000,
        onEvent: event => events.push(event.type),
      });
      expect(reconfiguredResult.resumed).toBe(true);
      expect(spawnCount).toBe(1);
      expect(commandCounts.get('get_state')).toBeGreaterThanOrEqual(3);
      expect(commandCounts.get('set_model')).toBe(1);
      expect(commandCounts.get('set_thinking_level')).toBe(1);
      expect(capturedPrompts).toEqual(['hello', 'small session delta', 'changed model session delta']);
      expect(events.filter(event => event === 'turn.completed')).toHaveLength(3);
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      adapter.dispose?.('user:conversation');
    }
  });

  it('abandons a stale persisted Pi session when startup handshake fails', async () => {
    const dataDir = temporaryDirectory('scholar-pi-stale-workspace-');
    const conversationKey = `user:stale-conversation:${Date.now()}:${Math.random()}`;
    const keyHash = createHash('sha256').update(conversationKey).digest('hex').slice(0, 24);
    const runtimeRoot = path.join(getDataDir(), 'agent-runtimes', 'pi', keyHash);
    const sessionDir = path.join(runtimeRoot, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, 'stale.jsonl'), '{"type":"session"}\n');
    const firstChild = fakeChild();
    const freshChild = fakeChild();
    const spawnArgs: string[][] = [];
    let spawnCount = 0;

    freshChild.stdin.on('data', chunk => {
      for (const line of String(chunk).split(/\r?\n/).filter(Boolean)) {
        const command = JSON.parse(line) as Record<string, unknown>;
        const id = String(command.id || '');
        const type = String(command.type || '');
        if (type === 'get_state') {
          freshChild.stdout.write(`${JSON.stringify({
            type: 'response',
            id,
            command: type,
            success: true,
            data: {
              sessionId: 'fresh-pi-session',
              isStreaming: false,
              isCompacting: false,
              pendingMessageCount: 0,
            },
          })}\n`);
        } else if (type === 'set_auto_compaction') {
          freshChild.stdout.write(`${JSON.stringify({ type: 'response', id, command: type, success: true, data: {} })}\n`);
        } else if (type === 'prompt') {
          freshChild.stdout.write(`${JSON.stringify({ type: 'response', id, command: type, success: true })}\n`);
          queueMicrotask(() => {
            freshChild.stdout.write(`${JSON.stringify({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'recovered' } })}\n`);
            freshChild.stdout.write(`${JSON.stringify({ type: 'turn_end', message: {} })}\n`);
            freshChild.stdout.write(`${JSON.stringify({ type: 'agent_end', messages: [] })}\n`);
          });
        }
      }
    });

    const adapter = new PiRpcRuntimeAdapter({
      resolveExecutable: () => 'pi-test',
      spawn: (_command, args) => {
        spawnArgs.push(args);
        spawnCount += 1;
        if (spawnCount === 1) {
          queueMicrotask(() => firstChild.emit('close', 1));
          return firstChild;
        }
        return freshChild;
      },
    });

    try {
      const result = await adapter.runTurn({
        runtimeId: 'pi',
        conversationKey,
        cwd: dataDir,
        prompt: 'full compact Scholar Harness history',
        resumePrompt: 'small delta',
        sandbox: 'workspace-write',
        timeoutMs: 5_000,
      });

      expect(result.answer).toBe('recovered');
      expect(result.resumed).toBe(false);
      expect(spawnArgs).toHaveLength(2);
      expect(spawnArgs[0]).toContain('--continue');
      expect(spawnArgs[1]).not.toContain('--continue');
    } finally {
      adapter.dispose?.(conversationKey);
      fs.rmSync(runtimeRoot, { recursive: true, force: true });
    }
  });

  it('parses OpenCode JSON events and stores the resumable session id', async () => {
    const runtimeDir = temporaryDirectory('scholar-opencode-runtime-');
    const child = fakeChild();
    let capturedArgs: string[] = [];
    let capturedConfig = '';
    let capturedAuth = '';
    child.stdin.once('finish', () => {
      child.stdout.write(`${JSON.stringify({ type: 'step_start', sessionID: 'ses-test', part: { type: 'step-start' } })}\n`);
      child.stdout.write(`${JSON.stringify({ type: 'text', sessionID: 'ses-test', part: { type: 'text', text: 'OpenCode ready' } })}\n`);
      child.stdout.write(`${JSON.stringify({ type: 'step_finish', sessionID: 'ses-test', part: { type: 'step-finish', tokens: { input: 20, output: 4, reasoning: 2, cache: { read: 5 } } } })}\n`);
      queueMicrotask(() => child.emit('close', 0));
    });
    const adapter = new OpenCodeJsonRuntimeAdapter({
      transport: 'json-cli',
      sessionMapPath: path.join(runtimeDir, 'sessions.json'),
      resolveExecutable: () => 'opencode-test',
      capture: async () => ({ stdout: '', stderr: '', code: 0 }),
      spawn: (_command, args, options) => {
        capturedArgs = args;
        capturedConfig = String(options?.env?.OPENCODE_CONFIG_CONTENT || '');
        capturedAuth = String(options?.env?.OPENCODE_AUTH_CONTENT || '');
        return child;
      },
    });
    const result = await adapter.runTurn({
      runtimeId: 'opencode',
      conversationKey: 'user:conversation',
      cwd: runtimeDir,
      prompt: 'hello',
      model: 'openai/gpt-5.5',
      reasoningEffort: 'high',
      providerAuth: { mode: 'api_key', provider: 'anthropic', api_key: 'oc-secret' },
      sandbox: 'read-only',
      timeoutMs: 5_000,
    });
    expect(result.answer).toBe('OpenCode ready');
    expect(result.sessionId).toBe('ses-test');
    expect(result.usage).toMatchObject({ inputTokens: 20, outputTokens: 4, reasoningTokens: 2, cacheReadTokens: 5 });
    expect(capturedArgs).toContain('--format');
    expect(capturedArgs.slice(0, 2)).toEqual(['--pure', 'run']);
    expect(capturedArgs).toContain('--model');
    expect(capturedArgs).toContain('--auto');
    expect(JSON.parse(capturedConfig)).toMatchObject({
      permission: { edit: 'deny', bash: 'deny', task: 'deny', external_directory: 'deny' },
    });
    expect(JSON.parse(capturedAuth)).toEqual({ anthropic: { type: 'api', key: 'oc-secret' } });
    expect(JSON.parse(fs.readFileSync(path.join(runtimeDir, 'sessions.json'), 'utf-8'))).toEqual({
      'user:conversation': 'ses-test',
    });
  });

  it('streams OpenCode server SSE deltas before the turn completes', async () => {
    const runtimeDir = temporaryDirectory('scholar-opencode-sse-');
    const sessionMapPath = path.join(runtimeDir, 'sessions.json');
    fs.writeFileSync(sessionMapPath, JSON.stringify({ 'user:sse-conversation': 'ses-sse' }));
    const child = fakeChild();
    const originalFetch = global.fetch;
    let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const encoder = new TextEncoder();
    let capturedPromptText = '';
    const pushEvent = (event: Record<string, unknown>): void => {
      eventController?.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    };
    global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/global/health')) {
        return new Response(JSON.stringify({ healthy: true, version: 'test' }), { status: 200 });
      }
      if (url.endsWith('/session/ses-sse') && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ id: 'ses-sse' }), { status: 200 });
      }
      if (url.endsWith('/session') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'ses-sse' }), { status: 200 });
      }
      if (url.endsWith('/event')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            eventController = controller;
            pushEvent({ type: 'server.connected', properties: {} });
          },
        });
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (url.endsWith('/session/ses-sse/prompt_async')) {
        const promptBody = JSON.parse(String(init?.body || '{}')) as { parts?: Array<{ type?: string; text?: string }> };
        capturedPromptText = String(promptBody.parts?.find(part => part.type === 'text')?.text || '');
        setTimeout(() => {
          pushEvent({
            type: 'message.updated',
            properties: { sessionID: 'ses-sse', info: { id: 'msg-a', sessionID: 'ses-sse', role: 'assistant' } },
          });
          pushEvent({
            type: 'message.part.updated',
            properties: {
              delta: 'Open',
              part: { id: 'part-a', messageID: 'msg-a', sessionID: 'ses-sse', type: 'text', text: 'Open', time: { start: 1 } },
            },
          });
        }, 5);
        setTimeout(() => {
          pushEvent({
            type: 'message.part.updated',
            properties: {
              delta: 'Code ready',
              part: { id: 'part-a', messageID: 'msg-a', sessionID: 'ses-sse', type: 'text', text: 'OpenCode ready', time: { start: 1, end: 2 } },
            },
          });
          pushEvent({
            type: 'message.part.updated',
            properties: {
              part: { id: 'step-a', messageID: 'msg-a', sessionID: 'ses-sse', type: 'step-finish', tokens: { input: 8, output: 3, reasoning: 0, cache: { read: 2 } } },
            },
          });
          pushEvent({ type: 'session.idle', properties: { sessionID: 'ses-sse' } });
          eventController?.close();
        }, 30);
        return new Response(null, { status: 204 });
      }
      if (url.includes('/session/ses-sse/message')) {
        return new Response(JSON.stringify([{
          info: { role: 'assistant' },
          parts: [{ type: 'text', text: 'OpenCode ready' }],
        }]), { status: 200 });
      }
      return new Response(JSON.stringify(true), { status: 200 });
    }) as typeof fetch;

    const adapter = new OpenCodeJsonRuntimeAdapter({
      sessionMapPath,
      resolveExecutable: () => 'opencode-test',
      spawn: () => child,
    });
    let turnResolved = false;
    let resolveFirstDelta!: () => void;
    const firstDelta = new Promise<void>(resolve => { resolveFirstDelta = resolve; });
    try {
      const resultPromise = adapter.runTurn({
        runtimeId: 'opencode',
        conversationKey: 'user:sse-conversation',
        cwd: runtimeDir,
        prompt: 'hello',
        resumePrompt: 'small OpenCode delta',
        model: 'openai/gpt-test',
        sandbox: 'workspace-write',
        timeoutMs: 5_000,
        onEvent: event => {
          if (event.type === 'assistant.delta') resolveFirstDelta();
        },
      }).then(result => {
        turnResolved = true;
        return result;
      });
      await firstDelta;
      expect(turnResolved).toBe(false);
      const result = await resultPromise;
      expect(result.answer).toBe('OpenCode ready');
      expect(result.resumed).toBe(true);
      expect(capturedPromptText).toBe('small OpenCode delta');
      expect(result.usage).toMatchObject({ inputTokens: 8, outputTokens: 3, cacheReadTokens: 2 });
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('registers adapters behind one runtime registry contract', async () => {
    const registry = new CodingAgentRuntimeRegistry();
    let disposedKey = '';
    let resetKey = '';
    const adapter: CodingAgentProtocolAdapter = {
      descriptor: {
        id: 'pi',
        label: 'Pi',
        protocol: 'pi-rpc',
        defaultCommand: 'pi',
        defaultModel: '',
        capabilities: {
          persistentSession: true,
          streaming: true,
          tools: true,
          mcp: false,
          steering: true,
          followUp: true,
          cancellation: true,
          images: true,
          modelDiscovery: true,
        },
      },
      status: async () => ({ id: 'pi', available: true, path: 'pi' }),
      listModels: async () => [],
      runTurn: async () => ({ answer: 'ok', sessionId: 'one', resumed: false, receipts: [] }),
      interrupt: async () => 1,
      resetContext: conversationKey => { resetKey = conversationKey; },
      dispose: conversationKey => { disposedKey = conversationKey; },
    };
    registry.register(adapter);
    expect(registry.list()).toHaveLength(1);
    await expect(registry.status('pi')).resolves.toMatchObject({ available: true });
    registry.dispose('pi', 'pi:conversation:old-capabilities');
    expect(disposedKey).toBe('pi:conversation:old-capabilities');
    await registry.resetContext('pi', 'pi:conversation:overflow');
    expect(resetKey).toBe('pi:conversation:overflow');
    expect(() => registry.register(adapter)).toThrow(/already registered/);
  });
});
