import type { ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';
import { AgentToolGateway } from './tool-gateway';
import {
  captureRuntimeCommand,
  parseRuntimeModelLines,
  resolveRuntimeExecutable,
  spawnRuntimeExecutable,
} from './process-utils';
import { buildCodingAgentAuthEnvironment, normalizeProviderId } from './provider-auth';
import type {
  CodingAgentProtocolAdapter,
  CodingAgentRuntimeConfig,
  CodingAgentRuntimeEvent,
  CodingAgentRuntimeModel,
  CodingAgentRuntimeStatus,
  CodingAgentRuntimeTurnRequest,
  CodingAgentRuntimeTurnResult,
  CodingAgentRuntimeUsage,
} from './types';

interface ActiveOpenCodeTurn {
  process: ChildProcess;
  sessionId?: string;
  baseUrl?: string;
}

type OpenCodeTransport = 'server-sse' | 'json-cli';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseUsage(value: unknown): CodingAgentRuntimeUsage | undefined {
  const source = asRecord(value);
  const cache = asRecord(source.cache);
  const input = Number(source.input || source.inputTokens || 0);
  const output = Number(source.output || source.outputTokens || 0);
  const reasoning = Number(source.reasoning || source.reasoningTokens || 0);
  const cacheRead = Number(cache.read || source.cacheReadTokens || 0);
  if (![input, output, reasoning, cacheRead].some(item => item > 0)) return undefined;
  return {
    inputTokens: Math.max(0, input),
    outputTokens: Math.max(0, output),
    reasoningTokens: Math.max(0, reasoning),
    cacheReadTokens: Math.max(0, cacheRead),
    totalTokens: Math.max(0, input + output),
  };
}

function addUsage(
  total: CodingAgentRuntimeUsage | undefined,
  next: CodingAgentRuntimeUsage | undefined,
): CodingAgentRuntimeUsage | undefined {
  if (!next) return total;
  const inputTokens = Number(total?.inputTokens || 0) + next.inputTokens;
  const outputTokens = Number(total?.outputTokens || 0) + next.outputTokens;
  const reasoningTokens = Number(total?.reasoningTokens || 0) + Number(next.reasoningTokens || 0);
  const cacheReadTokens = Number(total?.cacheReadTokens || 0) + Number(next.cacheReadTokens || 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
    ...(cacheReadTokens > 0 ? { cacheReadTokens } : {}),
  };
}

export class OpenCodeJsonRuntimeAdapter implements CodingAgentProtocolAdapter {
  readonly descriptor = {
    id: 'opencode' as const,
    label: 'OpenCode',
    protocol: 'opencode-json' as const,
    defaultCommand: 'opencode',
    defaultModel: '',
    capabilities: {
      persistentSession: true,
      streaming: true,
      tools: true,
      mcp: true,
      steering: false,
      followUp: false,
      cancellation: true,
      images: true,
      modelDiscovery: true,
    },
  };

  private readonly active = new Map<string, ActiveOpenCodeTurn>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly sessions = new Map<string, string>();
  private readonly gateway = new AgentToolGateway();
  private readonly sessionMapPath = path.join(getDataDir(), 'agent-runtimes', 'opencode-sessions.json');

  constructor(private readonly processOptions: {
    resolveExecutable?: typeof resolveRuntimeExecutable;
    capture?: typeof captureRuntimeCommand;
    spawn?: typeof spawnRuntimeExecutable;
    sessionMapPath?: string;
    transport?: OpenCodeTransport;
  } = {}) {
    if (processOptions.sessionMapPath) this.sessionMapPath = processOptions.sessionMapPath;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.sessionMapPath, 'utf-8')) as Record<string, unknown>;
      Object.entries(parsed).forEach(([key, value]) => {
        const sessionId = asString(value).trim();
        if (sessionId) this.sessions.set(key, sessionId);
      });
    } catch {
      // A fresh installation has no OpenCode session map yet.
    }
  }

  async status(config: CodingAgentRuntimeConfig = {}): Promise<CodingAgentRuntimeStatus> {
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(config.command, ['opencode']);
    if (!executable) return { id: 'opencode', available: false, path: '', error: 'OpenCode CLI was not found' };
    try {
      const result = await (this.processOptions.capture || captureRuntimeCommand)(executable, ['--pure', '--version'], { timeoutMs: 10_000 });
      return {
        id: 'opencode',
        available: result.code === 0,
        path: executable,
        version: (result.stdout || result.stderr).trim().split(/\r?\n/)[0],
        ...(result.code === 0 ? {} : { error: (result.stderr || `OpenCode exited with code ${result.code}`).trim() }),
      };
    } catch (error) {
      return { id: 'opencode', available: false, path: executable, error: (error as Error).message };
    }
  }

  async listModels(config: CodingAgentRuntimeConfig = {}): Promise<CodingAgentRuntimeModel[]> {
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(config.command, ['opencode']);
    if (!executable) return config.model ? [this.asModel(config.model)] : [];
    try {
      const provider = normalizeProviderId(config.provider_auth?.provider);
      const result = await (this.processOptions.capture || captureRuntimeCommand)(
        executable,
        ['--pure', 'models', ...(provider ? [provider] : []), '--refresh'],
        {
          env: buildCodingAgentAuthEnvironment('opencode', config.provider_auth),
          timeoutMs: 60_000,
        },
      );
      const slugs = parseRuntimeModelLines(`${result.stdout}\n${result.stderr}`);
      if (config.model && !slugs.includes(config.model)) slugs.unshift(config.model);
      return slugs.map(slug => this.asModel(slug));
    } catch {
      return config.model ? [this.asModel(config.model)] : [];
    }
  }

  async runTurn(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    const previous = this.queues.get(request.conversationKey) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => { release = resolve; });
    const queued = previous.then(() => current);
    this.queues.set(request.conversationKey, queued);
    await previous;
    try {
      return await this.runTurnUnlocked(request);
    } finally {
      release();
      if (this.queues.get(request.conversationKey) === queued) this.queues.delete(request.conversationKey);
    }
  }

  async interrupt(conversationKeyPrefix: string): Promise<number> {
    const entries = Array.from(this.active.entries()).filter(([key]) => key.startsWith(conversationKeyPrefix));
    await Promise.all(entries.map(async ([, turn]) => {
      if (turn.baseUrl && turn.sessionId) {
        await fetch(`${turn.baseUrl}/session/${encodeURIComponent(turn.sessionId)}/abort`, { method: 'POST' }).catch(() => undefined);
      }
      turn.process.kill();
    }));
    return entries.length;
  }

  dispose(conversationKey: string): void {
    this.active.get(conversationKey)?.process.kill();
    this.active.delete(conversationKey);
    this.sessions.delete(conversationKey);
    this.gateway.unregister(conversationKey);
  }

  resetContext(conversationKey: string): void {
    this.dispose(conversationKey);
  }

  private asModel(slug: string): CodingAgentRuntimeModel {
    return {
      slug,
      displayName: slug,
      provider: slug.includes('/') ? slug.split('/')[0] : undefined,
      defaultReasoningLevel: 'medium',
      supportedReasoningLevels: ['low', 'medium', 'high', 'xhigh'].map(effort => ({ effort })),
    };
  }

  private async runTurnUnlocked(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    if (this.processOptions.transport === 'json-cli') return this.runJsonCliTurn(request);
    return this.runServerSseTurn(request);
  }

  /**
   * Compatibility transport retained for older OpenCode builds and isolated
   * adapter tests. `opencode run --format json` only publishes completed text
   * parts, so production uses the server event stream below for real deltas.
   */
  private async runJsonCliTurn(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    if (request.isCancelled?.()) throw new Error('OpenCode turn was cancelled by the user');
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(request.command, ['opencode']);
    if (!executable) throw new Error('OPENCODE_RUNTIME_UNAVAILABLE: OpenCode CLI was not found');
    const connection = await this.gateway.register(request.conversationKey, request.toolSet);
    this.gateway.update(request.conversationKey, request.toolSet);
    this.gateway.clearReceipts(request.conversationKey);
    const previousSessionId = this.sessions.get(request.conversationKey) || '';
    const args = ['--pure', 'run', '--format', 'json', '--dir', request.cwd, '--auto'];
    if (previousSessionId) args.push('--session', previousSessionId);
    if (request.model) args.push('--model', request.model);
    if (request.reasoningEffort) args.push('--variant', request.reasoningEffort);
    for (const imagePath of request.imagePaths || []) {
      if (fs.existsSync(imagePath)) args.push('--file', imagePath);
    }
    const inlineConfig: Record<string, unknown> = {};
    if (request.sandbox === 'read-only') {
      inlineConfig.permission = {
        edit: 'deny',
        bash: 'deny',
        task: 'deny',
        external_directory: 'deny',
      };
    }
    if (request.toolSet?.definitions.length) {
      if (!request.mcpServerScript) throw new Error('OpenCode MCP bridge has not been built; run npm run build first');
      inlineConfig.mcp = {
        scholar_harness: {
          type: 'local',
          command: [process.execPath, request.mcpServerScript],
          enabled: true,
          timeout: 1_800_000,
          environment: {
            ELECTRON_RUN_AS_NODE: '1',
            SCHOLAR_HARNESS_AGENT_GATEWAY_URL: connection.url,
            SCHOLAR_HARNESS_AGENT_GATEWAY_TOKEN: connection.token,
            SCHOLAR_HARNESS_AGENT_SESSION_KEY: connection.sessionKey,
          },
        },
      };
    }
    const child = (this.processOptions.spawn || spawnRuntimeExecutable)(executable, args, {
      cwd: request.cwd,
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig),
        ELECTRON_RUN_AS_NODE: '1',
        SCHOLAR_HARNESS_AGENT_GATEWAY_URL: connection.url,
        SCHOLAR_HARNESS_AGENT_GATEWAY_TOKEN: connection.token,
        SCHOLAR_HARNESS_AGENT_SESSION_KEY: connection.sessionKey,
        ...buildCodingAgentAuthEnvironment('opencode', request.providerAuth),
      },
    });
    this.active.set(request.conversationKey, { process: child, sessionId: previousSessionId || undefined });
    let answer = '';
    let stdoutBuffer = '';
    let stderr = '';
    let sessionId = previousSessionId;
    let usage: CodingAgentRuntimeUsage | undefined;
    let settled = false;
    request.onEvent?.({ type: 'turn.started', runtimeId: 'opencode', sessionId: sessionId || undefined });
    const consumeLine = (line: string): void => {
      if (!line.trim()) return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(line) as Record<string, unknown>; }
      catch { return; }
      sessionId = asString(event.sessionID) || sessionId;
      if (sessionId && this.active.has(request.conversationKey)) this.active.get(request.conversationKey)!.sessionId = sessionId;
      const type = asString(event.type);
      const part = asRecord(event.part);
      const partType = asString(part.type);
      if (type === 'text' || partType === 'text') {
        const text = asString(part.text);
        if (text) {
          answer += text;
          request.onEvent?.({ type: 'assistant.delta', runtimeId: 'opencode', sessionId, text });
        }
      } else if (type === 'reasoning' || partType === 'reasoning') {
        const text = asString(part.text);
        if (text) request.onEvent?.({ type: 'thinking.delta', runtimeId: 'opencode', sessionId, text });
      } else if (type === 'tool_use' || partType === 'tool') {
        const state = asRecord(part.state);
        const toolName = asString(part.tool) || asString(part.name);
        const status = asString(state.status);
        request.onEvent?.({
          type: status === 'completed' || status === 'error' ? 'tool.completed' : 'tool.started',
          runtimeId: 'opencode',
          sessionId,
          toolName,
          data: state,
        });
      } else if (type === 'step_finish' || partType === 'step-finish') {
        usage = addUsage(usage, parseUsage(part.tokens));
        if (usage) request.onEvent?.({ type: 'usage.updated', runtimeId: 'opencode', sessionId, usage });
      }
    };
    child.stdout?.on('data', chunk => {
      stdoutBuffer += String(chunk);
      while (true) {
        const index = stdoutBuffer.indexOf('\n');
        if (index < 0) break;
        const line = stdoutBuffer.slice(0, index).replace(/\r$/, '');
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        consumeLine(line);
      }
    });
    child.stderr?.on('data', chunk => {
      const text = String(chunk);
      stderr += text;
      logger.debug(`[OpenCodeRuntime] ${text.trim()}`);
      request.onEvent?.({ type: 'runtime.stderr', runtimeId: 'opencode', sessionId: sessionId || undefined, text });
    });
    const completion = new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => {
        if (stdoutBuffer.trim()) consumeLine(stdoutBuffer.replace(/\r$/, ''));
        resolve(Number(code ?? -1));
      });
    });
    child.stdin?.end(previousSessionId && request.resumePrompt ? request.resumePrompt : request.prompt);
    const cancellationTimer = setInterval(() => {
      if (!request.isCancelled?.() || settled) return;
      settled = true;
      child.kill();
    }, 200);
    cancellationTimer.unref?.();
    let code: number;
    try {
      code = await this.withTimeout(completion, request.timeoutMs, child);
    } finally {
      settled = true;
      clearInterval(cancellationTimer);
      if (this.active.get(request.conversationKey)?.process === child) this.active.delete(request.conversationKey);
    }
    if (request.isCancelled?.()) throw new Error('OpenCode turn was cancelled by the user');
    if (sessionId) {
      this.sessions.set(request.conversationKey, sessionId);
      this.saveSessions();
    }
    if (code !== 0) throw new Error(`OpenCode exited with code ${code}: ${stderr.trim().slice(0, 2000)}`);
    if (!answer.trim() && sessionId) answer = await this.readLastAssistantText(executable, sessionId, request.cwd);
    if (!answer.trim()) throw new Error('OpenCode completed without an assistant response');
    request.onEvent?.({ type: 'turn.completed', runtimeId: 'opencode', sessionId });
    return {
      answer: answer.trim(),
      sessionId,
      resumed: Boolean(previousSessionId),
      usage,
      receipts: this.gateway.takeReceipts(request.conversationKey),
    };
  }

  private async runServerSseTurn(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    if (request.isCancelled?.()) throw new Error('OpenCode turn was cancelled by the user');
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(request.command, ['opencode']);
    if (!executable) throw new Error('OPENCODE_RUNTIME_UNAVAILABLE: OpenCode CLI was not found');

    const connection = await this.gateway.register(request.conversationKey, request.toolSet);
    this.gateway.update(request.conversationKey, request.toolSet);
    this.gateway.clearReceipts(request.conversationKey);
    const inlineConfig = this.buildInlineConfig(request, connection);
    const port = await this.reserveLocalPort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = (this.processOptions.spawn || spawnRuntimeExecutable)(executable, [
      '--pure',
      'serve',
      '--hostname', '127.0.0.1',
      '--port', String(port),
    ], {
      cwd: request.cwd,
      env: {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(inlineConfig),
        ELECTRON_RUN_AS_NODE: '1',
        SCHOLAR_HARNESS_AGENT_GATEWAY_URL: connection.url,
        SCHOLAR_HARNESS_AGENT_GATEWAY_TOKEN: connection.token,
        SCHOLAR_HARNESS_AGENT_SESSION_KEY: connection.sessionKey,
        ...buildCodingAgentAuthEnvironment('opencode', request.providerAuth),
      },
    });
    this.active.set(request.conversationKey, { process: child, baseUrl });

    let serverDiagnostics = '';
    let serverClosed = false;
    let serverError: Error | null = null;
    child.stdout?.on('data', chunk => {
      serverDiagnostics += String(chunk);
      if (serverDiagnostics.length > 8_000) serverDiagnostics = serverDiagnostics.slice(-8_000);
    });
    child.stderr?.on('data', chunk => {
      const text = String(chunk);
      serverDiagnostics += text;
      if (serverDiagnostics.length > 8_000) serverDiagnostics = serverDiagnostics.slice(-8_000);
      logger.debug(`[OpenCodeRuntime] ${text.trim()}`);
      request.onEvent?.({ type: 'runtime.stderr', runtimeId: 'opencode', text });
    });
    child.once('error', error => { serverError = error; });
    child.once('close', code => {
      serverClosed = true;
      if (code !== 0 && !serverError) serverError = new Error(`OpenCode server exited with code ${code ?? -1}`);
    });

    const eventAbort = new AbortController();
    let sessionId = '';
    let cancellationTimer: ReturnType<typeof setInterval> | undefined;
    try {
      await this.waitForServer(baseUrl, () => ({ closed: serverClosed, error: serverError, diagnostics: serverDiagnostics }));
      const previousSessionId = this.sessions.get(request.conversationKey) || '';
      const resolvedSession = await this.ensureServerSession(baseUrl, previousSessionId);
      sessionId = resolvedSession.sessionId;
      this.active.set(request.conversationKey, { process: child, baseUrl, sessionId });
      request.onEvent?.({ type: 'session.started', runtimeId: 'opencode', sessionId });
      request.onEvent?.({ type: 'turn.started', runtimeId: 'opencode', sessionId });

      const eventResponse = await fetch(`${baseUrl}/event`, {
        headers: { Accept: 'text/event-stream' },
        signal: eventAbort.signal,
      });
      if (!eventResponse.ok || !eventResponse.body) {
        throw new Error(`OpenCode event stream failed with HTTP ${eventResponse.status}`);
      }

      const messageRoles = new Map<string, string>();
      const textParts = new Map<string, string>();
      const textPartOrder: string[] = [];
      const thinkingParts = new Map<string, string>();
      const toolStatuses = new Map<string, string>();
      let usage: CodingAgentRuntimeUsage | undefined;
      let promptSent = false;
      let turnSettled = false;
      let resolveTurn!: () => void;
      let rejectTurn!: (error: Error) => void;
      const turnCompletion = new Promise<void>((resolve, reject) => {
        resolveTurn = resolve;
        rejectTurn = reject;
      });

      const emitPartDelta = (
        part: Record<string, unknown>,
        properties: Record<string, unknown>,
        kind: 'text' | 'reasoning',
      ): void => {
        const partId = asString(part.id);
        if (!partId) return;
        const target = kind === 'text' ? textParts : thinkingParts;
        const previous = target.get(partId) || '';
        const cumulative = asString(part.text);
        const rawDelta = asString(properties.delta);
        let next = cumulative;
        if (!next && rawDelta) next = previous + rawDelta;
        if (!next || next === previous) return;
        let delta = '';
        if (next.startsWith(previous)) delta = next.slice(previous.length);
        else if (rawDelta && !previous.endsWith(rawDelta)) delta = rawDelta;
        target.set(partId, next);
        if (kind === 'text' && !textPartOrder.includes(partId)) textPartOrder.push(partId);
        if (!delta) return;
        request.onEvent?.({
          type: kind === 'text' ? 'assistant.delta' : 'thinking.delta',
          runtimeId: 'opencode',
          sessionId,
          text: delta,
        });
      };

      const consumeEvent = (event: Record<string, unknown>): void => {
        const type = asString(event.type);
        const properties = asRecord(event.properties);
        if (type === 'message.updated') {
          const info = asRecord(properties.info);
          if (asString(info.sessionID) === sessionId) {
            messageRoles.set(asString(info.id), asString(info.role));
          }
          return;
        }
        if (type === 'message.part.updated') {
          const part = asRecord(properties.part);
          if (asString(part.sessionID) !== sessionId) return;
          const partType = asString(part.type);
          const messageRole = messageRoles.get(asString(part.messageID));
          const looksGenerated = messageRole === 'assistant' || Object.keys(asRecord(part.time)).length > 0;
          if (partType === 'text' && looksGenerated) emitPartDelta(part, properties, 'text');
          else if (partType === 'reasoning' && looksGenerated) emitPartDelta(part, properties, 'reasoning');
          else if (partType === 'tool') {
            const partId = asString(part.id);
            const state = asRecord(part.state);
            const status = asString(state.status);
            const previousStatus = toolStatuses.get(partId) || '';
            const toolName = asString(part.tool) || asString(part.name);
            if (status && status !== previousStatus) {
              toolStatuses.set(partId, status);
              if ((status === 'pending' || status === 'running') && !previousStatus) {
                request.onEvent?.({ type: 'tool.started', runtimeId: 'opencode', sessionId, toolName, data: state });
              } else if (status === 'completed' || status === 'error') {
                request.onEvent?.({ type: 'tool.completed', runtimeId: 'opencode', sessionId, toolName, data: state });
              } else {
                request.onEvent?.({ type: 'tool.progress', runtimeId: 'opencode', sessionId, toolName, data: state });
              }
            }
          } else if (partType === 'step-finish') {
            usage = addUsage(usage, parseUsage(part.tokens));
            if (usage) request.onEvent?.({ type: 'usage.updated', runtimeId: 'opencode', sessionId, usage });
          }
          return;
        }
        if (type === 'session.error' && (!asString(properties.sessionID) || asString(properties.sessionID) === sessionId)) {
          const error = asRecord(properties.error);
          const data = asRecord(error.data);
          const message = asString(data.message) || asString(error.message) || asString(error.name) || 'OpenCode session failed';
          rejectTurn(new Error(message));
          return;
        }
        if (type === 'session.idle' && asString(properties.sessionID) === sessionId && promptSent) {
          turnSettled = true;
          resolveTurn();
          return;
        }
        if (type === 'session.status' && asString(properties.sessionID) === sessionId) {
          const status = asRecord(properties.status);
          if (asString(status.type) === 'idle' && promptSent) {
            turnSettled = true;
            resolveTurn();
          }
        }
      };

      const readerTask = this.readServerEvents(eventResponse.body, consumeEvent, eventAbort.signal)
        .catch(error => {
          if (!turnSettled && !eventAbort.signal.aborted) rejectTurn(error as Error);
        });

      const promptBody = await this.buildServerPromptBody(
        request,
        resolvedSession.resumed && request.resumePrompt ? request.resumePrompt : request.prompt,
      );
      promptSent = true;
      const promptResponse = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(promptBody),
      });
      if (!promptResponse.ok) {
        const detail = await promptResponse.text().catch(() => '');
        throw new Error(`OpenCode prompt failed with HTTP ${promptResponse.status}: ${detail.slice(0, 2000)}`);
      }

      let cancellationRequested = false;
      cancellationTimer = setInterval(() => {
        if (!request.isCancelled?.() || cancellationRequested) return;
        cancellationRequested = true;
        void fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' })
          .catch(() => undefined)
          .finally(() => rejectTurn(new Error('OpenCode turn was cancelled by the user')));
      }, 200);
      cancellationTimer.unref?.();

      await this.withTimeout(turnCompletion, request.timeoutMs, child);
      eventAbort.abort();
      await readerTask;
      if (request.isCancelled?.()) throw new Error('OpenCode turn was cancelled by the user');

      const streamedAnswer = textPartOrder.map(partId => textParts.get(partId) || '').join('').trim();
      const recoveredAnswer = await this.readLastAssistantTextFromServer(baseUrl, sessionId);
      const answer = recoveredAnswer || streamedAnswer;
      if (!answer.trim()) throw new Error('OpenCode completed without an assistant response');
      this.sessions.set(request.conversationKey, sessionId);
      this.saveSessions();
      request.onEvent?.({ type: 'turn.completed', runtimeId: 'opencode', sessionId });
      return {
        answer: answer.trim(),
        sessionId,
        resumed: resolvedSession.resumed,
        usage,
        receipts: this.gateway.takeReceipts(request.conversationKey),
      };
    } finally {
      if (cancellationTimer) clearInterval(cancellationTimer);
      eventAbort.abort();
      if (sessionId && request.isCancelled?.()) {
        await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/abort`, { method: 'POST' }).catch(() => undefined);
      }
      await fetch(`${baseUrl}/instance/dispose`, { method: 'POST' }).catch(() => undefined);
      child.kill();
      if (this.active.get(request.conversationKey)?.process === child) this.active.delete(request.conversationKey);
    }
  }

  private buildInlineConfig(
    request: CodingAgentRuntimeTurnRequest,
    connection: { url: string; token: string; sessionKey: string },
  ): Record<string, unknown> {
    const inlineConfig: Record<string, unknown> = {};
    if (request.sandbox === 'read-only') {
      inlineConfig.permission = { edit: 'deny', bash: 'deny', task: 'deny', external_directory: 'deny' };
    }
    if (request.toolSet?.definitions.length) {
      if (!request.mcpServerScript) throw new Error('OpenCode MCP bridge has not been built; run npm run build first');
      inlineConfig.mcp = {
        scholar_harness: {
          type: 'local',
          command: [process.execPath, request.mcpServerScript],
          enabled: true,
          timeout: 1_800_000,
          environment: {
            ELECTRON_RUN_AS_NODE: '1',
            SCHOLAR_HARNESS_AGENT_GATEWAY_URL: connection.url,
            SCHOLAR_HARNESS_AGENT_GATEWAY_TOKEN: connection.token,
            SCHOLAR_HARNESS_AGENT_SESSION_KEY: connection.sessionKey,
          },
        },
      };
    }
    return inlineConfig;
  }

  private async reserveLocalPort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : 0;
        server.close(error => error ? reject(error) : resolve(port));
      });
    });
  }

  private async waitForServer(
    baseUrl: string,
    getState: () => { closed: boolean; error: Error | null; diagnostics: string },
  ): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const state = getState();
      if (state.error || state.closed) {
        throw state.error || new Error(`OpenCode server closed during startup: ${state.diagnostics.trim().slice(-2000)}`);
      }
      try {
        const response = await fetch(`${baseUrl}/global/health`);
        if (response.ok) return;
      } catch {
        // The listener is not ready yet.
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`OpenCode server did not become ready: ${getState().diagnostics.trim().slice(-2000)}`);
  }

  private async ensureServerSession(
    baseUrl: string,
    previousSessionId: string,
  ): Promise<{ sessionId: string; resumed: boolean }> {
    if (previousSessionId) {
      const response = await fetch(`${baseUrl}/session/${encodeURIComponent(previousSessionId)}`).catch(() => null);
      if (response?.ok) return { sessionId: previousSessionId, resumed: true };
    }
    const response = await fetch(`${baseUrl}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Scholar Harness' }),
    });
    if (!response.ok) throw new Error(`OpenCode session creation failed with HTTP ${response.status}`);
    const session = asRecord(await response.json());
    const sessionId = asString(session.id);
    if (!sessionId) throw new Error('OpenCode session creation returned no session id');
    return { sessionId, resumed: false };
  }

  private async buildServerPromptBody(
    request: CodingAgentRuntimeTurnRequest,
    prompt: string,
  ): Promise<Record<string, unknown>> {
    const parts: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }];
    for (const imagePath of request.imagePaths || []) {
      if (!fs.existsSync(imagePath)) continue;
      const extension = path.extname(imagePath).toLowerCase();
      const mime = extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.gif'
            ? 'image/gif'
            : 'image/png';
      parts.push({
        type: 'file',
        mime,
        filename: path.basename(imagePath),
        url: `data:${mime};base64,${fs.readFileSync(imagePath).toString('base64')}`,
      });
    }
    const body: Record<string, unknown> = { parts };
    if (request.model) {
      const [providerID, ...modelParts] = request.model.split('/');
      const modelID = modelParts.join('/');
      if (providerID && modelID) body.model = { providerID, modelID };
    }
    if (request.reasoningEffort) body.variant = request.reasoningEffort;
    return body;
  }

  private async readServerEvents(
    body: ReadableStream<Uint8Array>,
    onEvent: (event: Record<string, unknown>) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (!signal.aborted) {
        const result = await reader.read();
        if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const data = block.split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trimStart())
            .join('\n');
          if (!data) continue;
          try { onEvent(JSON.parse(data) as Record<string, unknown>); }
          catch { logger.warn('[OpenCodeRuntime] Ignored malformed SSE event'); }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async readLastAssistantTextFromServer(baseUrl: string, sessionId: string): Promise<string> {
    try {
      const response = await fetch(`${baseUrl}/session/${encodeURIComponent(sessionId)}/message?limit=20`);
      if (!response.ok) return '';
      const messages = await response.json() as unknown;
      if (!Array.isArray(messages)) return '';
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = asRecord(messages[index]);
        const info = asRecord(message.info);
        if (asString(info.role) !== 'assistant') continue;
        const parts = Array.isArray(message.parts) ? message.parts : [];
        const text = parts.map(part => {
          const item = asRecord(part);
          return asString(item.type) === 'text' ? asString(item.text) : '';
        }).join('');
        if (text.trim()) return text.trim();
      }
    } catch (error) {
      logger.warn('[OpenCodeRuntime] Unable to recover final assistant text from server', error);
    }
    return '';
  }

  private async readLastAssistantText(executable: string, sessionId: string, cwd: string): Promise<string> {
    try {
      const result = await (this.processOptions.capture || captureRuntimeCommand)(executable, ['--pure', 'export', sessionId], { cwd, timeoutMs: 30_000 });
      const parsed = JSON.parse(result.stdout) as unknown;
      const root = asRecord(parsed);
      const messages = Array.isArray(root.messages) ? root.messages : (Array.isArray(parsed) ? parsed : []);
      for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = asRecord(messages[index]);
        const info = asRecord(message.info);
        if (asString(info.role) !== 'assistant') continue;
        const parts = Array.isArray(message.parts) ? message.parts : [];
        const text = parts.map(part => {
          const item = asRecord(part);
          return asString(item.type) === 'text' ? asString(item.text) : '';
        }).join('');
        if (text.trim()) return text.trim();
      }
    } catch (error) {
      logger.warn('[OpenCodeRuntime] Unable to recover final assistant text from session export', error);
    }
    return '';
  }

  private saveSessions(): void {
    try {
      fs.mkdirSync(path.dirname(this.sessionMapPath), { recursive: true });
      const temporary = `${this.sessionMapPath}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(Object.fromEntries(this.sessions), null, 2), 'utf-8');
      try {
        fs.renameSync(temporary, this.sessionMapPath);
      } catch {
        if (fs.existsSync(this.sessionMapPath)) fs.unlinkSync(this.sessionMapPath);
        fs.renameSync(temporary, this.sessionMapPath);
      }
    } catch (error) {
      logger.warn('[OpenCodeRuntime] Unable to persist session map', error);
    }
  }

  private async withTimeout<T>(completion: Promise<T>, timeoutMs: number, child: ChildProcess): Promise<T> {
    if (timeoutMs < 0) return completion;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`OpenCode turn timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      completion.then(code => { clearTimeout(timer); resolve(code); }, error => { clearTimeout(timer); reject(error); });
    });
  }
}
