import type { ChildProcess } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'string_decoder';

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

interface PendingRpcRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PiTurnCollector {
  answer: string;
  error?: string;
  usage?: CodingAgentRuntimeUsage;
  settled: boolean;
  sawTurnEnd: boolean;
  turnEndedAt: number;
  idleConfirmations: number;
  resolve: () => void;
  reject: (error: Error) => void;
  completion: Promise<void>;
}

interface PiRpcSession {
  key: string;
  process: ChildProcess;
  executable: string;
  signature: string;
  pending: Map<string, PendingRpcRequest>;
  decoder: StringDecoder;
  buffer: string;
  closed: boolean;
  sessionId: string;
  sessionFile?: string;
  resumedFromDisk: boolean;
  autoCompactionEnabled: boolean;
  model: string;
  reasoningEffort: string;
  stderrTail: string;
  collector?: PiTurnCollector;
  onEvent?: (event: CodingAgentRuntimeEvent) => void;
}

const PI_RPC_STARTUP_TIMEOUT_MS = 60_000;
const PI_RPC_STDERR_TAIL_CHARS = 4_000;
const PI_RPC_IDLE_PROBE_INTERVAL_MS = 500;
const PI_RPC_IDLE_PROBE_GRACE_MS = 500;
const PI_RPC_IDLE_PROBE_TIMEOUT_MS = 5_000;
const PI_RPC_IDLE_CONFIRMATIONS_REQUIRED = 2;

class PiRpcHandshakeError extends Error {
  constructor(
    message: string,
    readonly resumedFromDisk: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PiRpcHandshakeError';
  }
}

function safeSegment(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function getRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toUsage(value: unknown): CodingAgentRuntimeUsage | undefined {
  const source = getRecord(value);
  const input = Number(source.input || source.inputTokens || source.promptTokens || 0);
  const output = Number(source.output || source.outputTokens || source.completionTokens || 0);
  const reasoning = Number(source.reasoning || source.reasoningTokens || 0);
  const cacheRead = Number(source.cacheRead || source.cache_read || source.cacheReadTokens || 0);
  if (![input, output, reasoning, cacheRead].some(item => item > 0)) return undefined;
  return {
    inputTokens: Math.max(0, input),
    outputTokens: Math.max(0, output),
    reasoningTokens: Math.max(0, reasoning),
    cacheReadTokens: Math.max(0, cacheRead),
    totalTokens: Math.max(0, input + output),
  };
}

function readPiImage(imagePath: string): { type: 'image'; data: string; mimeType: string } | null {
  try {
    if (!fs.existsSync(imagePath)) return null;
    const extension = path.extname(imagePath).toLowerCase();
    const mimeType = extension === '.jpg' || extension === '.jpeg'
      ? 'image/jpeg'
      : extension === '.webp'
        ? 'image/webp'
        : extension === '.gif'
          ? 'image/gif'
          : 'image/png';
    return { type: 'image', data: fs.readFileSync(imagePath).toString('base64'), mimeType };
  } catch (error) {
    logger.warn(`[PiRuntime] Unable to attach image: ${imagePath}`, error);
    return null;
  }
}

function buildPiToolExtension(toolDefinitions: CodingAgentRuntimeTurnRequest['toolSet']): string {
  const tools = (toolDefinitions?.definitions || []).map(item => ({
    name: item.function.name,
    description: item.function.description || '',
    parameters: item.function.parameters || { type: 'object', properties: {} },
  }));
  return [
    'import { Type } from "typebox";',
    `const tools = ${JSON.stringify(tools)};`,
    'const url = String(process.env.SCHOLAR_HARNESS_AGENT_GATEWAY_URL || "");',
    'const token = String(process.env.SCHOLAR_HARNESS_AGENT_GATEWAY_TOKEN || "");',
    'const sessionKey = String(process.env.SCHOLAR_HARNESS_AGENT_SESSION_KEY || "");',
    'export default function scholarHarnessTools(pi) {',
    '  for (const tool of tools) {',
    '    pi.registerTool({',
    '      name: tool.name,',
    '      label: tool.name,',
    '      description: tool.description,',
    '      parameters: Type.Unsafe(tool.parameters),',
    '      async execute(toolCallId, params) {',
    '        const response = await fetch(new URL("/call", url), {',
    '          method: "POST",',
    '          headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-scholar-harness-session": sessionKey },',
    '          body: JSON.stringify({ name: tool.name, arguments: params || {}, callId: toolCallId }),',
    '        });',
    '        const payload = await response.json();',
    '        if (!response.ok || !payload.ok) throw new Error(payload.error || `Scholar Harness tool failed: ${tool.name}`);',
    '        return { content: [{ type: "text", text: JSON.stringify(payload.result ?? null) }], details: payload.result };',
    '      },',
    '    });',
    '  }',
    '}',
    '',
  ].join('\n');
}

export class PiRpcRuntimeAdapter implements CodingAgentProtocolAdapter {
  readonly descriptor = {
    id: 'pi' as const,
    label: 'Pi',
    protocol: 'pi-rpc' as const,
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
  };

  private readonly sessions = new Map<string, PiRpcSession>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly forceFreshSessions = new Set<string>();
  private readonly gateway = new AgentToolGateway();

  constructor(private readonly processOptions: {
    resolveExecutable?: typeof resolveRuntimeExecutable;
    capture?: typeof captureRuntimeCommand;
    spawn?: typeof spawnRuntimeExecutable;
  } = {}) {}

  async status(config: CodingAgentRuntimeConfig = {}): Promise<CodingAgentRuntimeStatus> {
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(config.command, ['pi']);
    if (!executable) return { id: 'pi', available: false, path: '', error: 'Pi CLI was not found' };
    try {
      const result = await (this.processOptions.capture || captureRuntimeCommand)(executable, ['--version'], {
        env: { PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' },
        timeoutMs: 20_000,
      });
      return {
        id: 'pi',
        available: result.code === 0,
        path: executable,
        version: (result.stdout || result.stderr).trim().split(/\r?\n/)[0],
        ...(result.code === 0 ? {} : { error: (result.stderr || `Pi exited with code ${result.code}`).trim() }),
      };
    } catch (error) {
      return { id: 'pi', available: false, path: executable, error: (error as Error).message };
    }
  }

  async listModels(config: CodingAgentRuntimeConfig = {}): Promise<CodingAgentRuntimeModel[]> {
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(config.command, ['pi']);
    if (!executable) return config.model ? [this.asModel(config.model)] : [];
    try {
      const provider = normalizeProviderId(config.provider_auth?.provider);
      const args = ['--list-models', ...(provider ? [provider] : [])];
      const result = await (this.processOptions.capture || captureRuntimeCommand)(executable, args, {
        env: {
          PI_SKIP_VERSION_CHECK: '1',
          PI_TELEMETRY: '0',
          ...buildCodingAgentAuthEnvironment('pi', config.provider_auth),
        },
        timeoutMs: 30_000,
      });
      const models = parseRuntimeModelLines(`${result.stdout}\n${result.stderr}`);
      if (config.model && !models.includes(config.model)) models.unshift(config.model);
      return models.map(item => this.asModel(item));
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
    const sessions = Array.from(this.sessions.entries()).filter(([key]) => key.startsWith(conversationKeyPrefix));
    for (const [, session] of sessions) {
      if (!session.closed) {
        this.notify(session, { type: 'abort' });
        setTimeout(() => {
          if (!session.closed && session.collector) session.process.kill();
        }, 1_500).unref?.();
      }
    }
    return sessions.length;
  }

  dispose(conversationKey: string): void {
    const session = this.sessions.get(conversationKey);
    if (session && !session.closed) session.process.kill();
    this.sessions.delete(conversationKey);
    this.gateway.unregister(conversationKey);
  }

  resetContext(conversationKey: string): void {
    this.dispose(conversationKey);
    // Keep old JSONL files as recoverable history, but do not --continue them.
    this.forceFreshSessions.add(conversationKey);
  }

  private asModel(slug: string): CodingAgentRuntimeModel {
    return {
      slug,
      displayName: slug,
      provider: slug.includes('/') ? slug.split('/')[0] : undefined,
      defaultReasoningLevel: 'medium',
      supportedReasoningLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
        .map(effort => ({ effort })),
    };
  }

  private async runTurnUnlocked(request: CodingAgentRuntimeTurnRequest): Promise<CodingAgentRuntimeTurnResult> {
    if (request.isCancelled?.()) throw new Error('Pi turn was cancelled by the user');
    const executable = (this.processOptions.resolveExecutable || resolveRuntimeExecutable)(request.command, ['pi']);
    if (!executable) throw new Error('PI_RUNTIME_UNAVAILABLE: Pi CLI was not found');
    const connection = await this.gateway.register(request.conversationKey, request.toolSet);
    this.gateway.update(request.conversationKey, request.toolSet);
    this.gateway.clearReceipts(request.conversationKey);
    const toolSignature = JSON.stringify((request.toolSet?.definitions || []).map(item => item.function.name));
    const signature = JSON.stringify({
      executable,
      cwd: request.cwd,
      sandbox: request.sandbox,
      toolSignature,
      provider: normalizeProviderId(request.providerAuth?.provider),
      authMode: request.providerAuth?.mode || '',
      authFingerprint: request.providerAuth?.api_key
        ? createHash('sha256').update(request.providerAuth.api_key).digest('hex').slice(0, 12)
        : '',
    });
    let session = this.sessions.get(request.conversationKey);
    const reusedLiveProcess = Boolean(session?.sessionId && !session.closed && session.signature === signature);
    let resumed = reusedLiveProcess;
    let allowPersistedResume = !this.forceFreshSessions.delete(request.conversationKey);
    if (session && (session.closed || session.signature !== signature)) {
      session.process.kill();
      allowPersistedResume = session.closed && session.signature === signature;
      session = undefined;
    }
    if (!session) {
      try {
        session = await this.startSession(request, executable, signature, connection, allowPersistedResume);
      } catch (error) {
        if (!(error instanceof PiRpcHandshakeError) || !error.resumedFromDisk) throw error;
        logger.warn(
          `[PiRuntime] Persisted session handshake failed; starting a fresh Pi context while preserving the old JSONL: ${(error as Error).message}`
        );
        request.onEvent?.({
          type: 'runtime.stderr',
          runtimeId: 'pi',
          text: 'Pi 旧会话加载超时，正在从 Scholar Harness 压缩历史新建会话。',
          data: { userVisibleStatus: true, recovery: 'fresh-context' },
        });
        session = await this.startSession(request, executable, signature, connection, false);
      }
      this.sessions.set(request.conversationKey, session);
      resumed = session.resumedFromDisk;
    }
    session.onEvent = request.onEvent;
    this.emit(session, {
      type: 'session.started',
      runtimeId: 'pi',
      sessionId: session.sessionId,
      data: { reusedLiveProcess, resumedFromDisk: session.resumedFromDisk },
    });
    if (!session.autoCompactionEnabled) {
      await this.rpc(session, { type: 'set_auto_compaction', enabled: true }, 15_000).then(() => {
        session.autoCompactionEnabled = true;
      }).catch(error => {
        logger.warn('[PiRuntime] Unable to enable native auto-compaction', error);
      });
    }
    if (request.model && request.model !== session.model) {
      const separator = request.model.indexOf('/');
      const provider = separator > 0 ? request.model.slice(0, separator) : '';
      const modelId = separator > 0 ? request.model.slice(separator + 1) : request.model;
      if (provider) {
        await this.rpc(session, { type: 'set_model', provider, modelId }, 30_000);
        session.model = request.model;
      }
    }
    if (request.reasoningEffort && request.reasoningEffort !== session.reasoningEffort) {
      await this.rpc(session, { type: 'set_thinking_level', level: request.reasoningEffort }, 15_000).then(() => {
        session.reasoningEffort = request.reasoningEffort || '';
      }).catch(error => {
        logger.warn('[PiRuntime] Unable to set thinking level', error);
      });
    }
    const collector = this.createCollector();
    session.collector = collector;
    this.emit(session, { type: 'turn.started', runtimeId: 'pi', sessionId: session.sessionId });
    const images = (request.imagePaths || [])
      .map(readPiImage)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const effectivePrompt = (resumed && request.resumePrompt) ? request.resumePrompt : request.prompt;
    await this.rpc(session, { type: 'prompt', message: effectivePrompt, ...(images.length ? { images } : {}) }, 30_000);
    const stopSteering = this.startSteeringPump(session, request);
    const stopCancellation = this.startCancellationPump(session, request);
    const stopSettlementWatchdog = this.startSettlementWatchdog(session, collector);
    try {
      await this.withTimeout(collector.completion, request.timeoutMs, 'Pi turn timed out');
    } finally {
      stopSteering();
      stopCancellation();
      stopSettlementWatchdog();
      session.collector = undefined;
    }
    if (!collector.answer.trim()) {
      const response = await this.rpc(session, { type: 'get_last_assistant_text' }, 15_000);
      collector.answer = getText(getRecord(response.data).text);
    }
    if (!collector.answer.trim()) throw new Error('Pi completed without an assistant response');
    return {
      answer: collector.answer.trim(),
      sessionId: session.sessionId,
      resumed,
      usage: collector.usage,
      receipts: this.gateway.takeReceipts(request.conversationKey),
    };
  }

  private async startSession(
    request: CodingAgentRuntimeTurnRequest,
    executable: string,
    signature: string,
    connection: { url: string; token: string; sessionKey: string },
    allowPersistedResume: boolean,
  ): Promise<PiRpcSession> {
    const runtimeRoot = path.join(getDataDir(), 'agent-runtimes', 'pi', safeSegment(request.conversationKey));
    const sessionDir = path.join(runtimeRoot, 'sessions');
    fs.mkdirSync(sessionDir, { recursive: true });
    const args = ['--mode', 'rpc', '--session-dir', sessionDir, '--name', `Scholar Harness ${safeSegment(request.conversationKey).slice(0, 8)}`];
    const resumedFromDisk = allowPersistedResume
      && fs.readdirSync(sessionDir).some(item => item.toLowerCase().endsWith('.jsonl'));
    if (resumedFromDisk) args.push('--continue');
    if (request.model) args.push('--model', request.model);
    if (request.reasoningEffort) args.push('--thinking', request.reasoningEffort);
    if (request.sandbox === 'read-only') args.push('--tools', 'read,grep,find,ls');
    if (request.toolSet?.definitions.length) {
      const extensionPath = path.join(runtimeRoot, 'scholar-harness-tools.ts');
      const extension = buildPiToolExtension(request.toolSet);
      if (!fs.existsSync(extensionPath) || fs.readFileSync(extensionPath, 'utf-8') !== extension) {
        fs.writeFileSync(extensionPath, extension, 'utf-8');
      }
      args.push('--extension', extensionPath);
    }
    for (const skillRoot of request.skillRoots || []) {
      if (fs.existsSync(skillRoot)) args.push('--skill', skillRoot);
    }
    const child = (this.processOptions.spawn || spawnRuntimeExecutable)(executable, args, {
      cwd: request.cwd,
      env: {
        SCHOLAR_HARNESS_AGENT_GATEWAY_URL: connection.url,
        SCHOLAR_HARNESS_AGENT_GATEWAY_TOKEN: connection.token,
        SCHOLAR_HARNESS_AGENT_SESSION_KEY: connection.sessionKey,
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
        ...buildCodingAgentAuthEnvironment('pi', request.providerAuth),
      },
    });
    const session: PiRpcSession = {
      key: request.conversationKey,
      process: child,
      executable,
      signature,
      pending: new Map(),
      decoder: new StringDecoder('utf8'),
      buffer: '',
      closed: false,
      sessionId: '',
      resumedFromDisk,
      autoCompactionEnabled: false,
      model: request.model || '',
      reasoningEffort: request.reasoningEffort || '',
      stderrTail: '',
    };
    child.stdout?.on('data', chunk => this.consumeChunk(session, chunk as Buffer));
    child.stderr?.on('data', chunk => {
      const text = String(chunk);
      session.stderrTail = `${session.stderrTail}${text}`.slice(-PI_RPC_STDERR_TAIL_CHARS);
      logger.debug(`[PiRuntime] ${text.trim()}`);
      this.emit(session, { type: 'runtime.stderr', runtimeId: 'pi', text });
    });
    child.once('error', error => this.closeSession(session, error));
    child.once('close', code => this.closeSession(session, new Error(`Pi RPC process exited with code ${code ?? -1}`)));
    let state: Record<string, unknown>;
    try {
      state = await this.rpc(session, { type: 'get_state' }, PI_RPC_STARTUP_TIMEOUT_MS);
    } catch (error) {
      session.process.kill();
      this.closeSession(session, error as Error);
      const stderrDetail = session.stderrTail.trim();
      throw new PiRpcHandshakeError(
        `PI_RPC_HANDSHAKE_FAILED: Pi CLI 未能完成 get_state 握手（上限 ${Math.round(PI_RPC_STARTUP_TIMEOUT_MS / 1000)} 秒；原因：${(error as Error).message || 'unknown'}）。`
        + `${stderrDetail ? ` Pi stderr: ${stderrDetail}` : ''}`,
        resumedFromDisk,
        error,
      );
    }
    const stateData = getRecord(state.data);
    session.sessionId = getText(stateData.sessionId) || `pi-${safeSegment(request.conversationKey)}`;
    session.sessionFile = getText(stateData.sessionFile) || undefined;
    return session;
  }

  private consumeChunk(session: PiRpcSession, chunk: Buffer): void {
    session.buffer += session.decoder.write(chunk);
    while (true) {
      const index = session.buffer.indexOf('\n');
      if (index < 0) break;
      let line = session.buffer.slice(0, index);
      session.buffer = session.buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      try { this.consumeMessage(session, JSON.parse(line) as Record<string, unknown>); }
      catch (error) { logger.warn('[PiRuntime] Invalid RPC JSON line', error); }
    }
  }

  private consumeMessage(session: PiRpcSession, message: Record<string, unknown>): void {
    if (message.type === 'response') {
      const id = getText(message.id);
      const pending = session.pending.get(id);
      if (pending) {
        session.pending.delete(id);
        clearTimeout(pending.timer);
        if (message.success === false) pending.reject(new Error(getText(message.error) || 'Pi RPC command failed'));
        else pending.resolve(message);
      }
      return;
    }
    const collector = session.collector;
    const eventType = getText(message.type);
    if (collector && (eventType === 'turn_start' || eventType === 'message_start' || eventType === 'tool_execution_start')) {
      collector.sawTurnEnd = false;
      collector.idleConfirmations = 0;
    }
    if (eventType === 'message_update' && collector) {
      const delta = getRecord(message.assistantMessageEvent);
      const deltaType = getText(delta.type);
      const text = getText(delta.delta);
      collector.usage = toUsage(message.usage) || collector.usage;
      if (deltaType === 'text_delta' && text) {
        collector.answer += text;
        this.emit(session, { type: 'assistant.delta', runtimeId: 'pi', sessionId: session.sessionId, text });
      } else if ((deltaType === 'thinking_delta' || deltaType === 'reasoning_delta') && text) {
        this.emit(session, { type: 'thinking.delta', runtimeId: 'pi', sessionId: session.sessionId, text });
      }
      return;
    }
    if (eventType === 'tool_execution_start') {
      this.emit(session, { type: 'tool.started', runtimeId: 'pi', sessionId: session.sessionId, toolName: getText(message.toolName) });
    } else if (eventType === 'tool_execution_update') {
      this.emit(session, { type: 'tool.progress', runtimeId: 'pi', sessionId: session.sessionId, toolName: getText(message.toolName), text: getText(message.output) });
    } else if (eventType === 'tool_execution_end') {
      this.emit(session, { type: 'tool.completed', runtimeId: 'pi', sessionId: session.sessionId, toolName: getText(message.toolName) });
    } else if (eventType === 'turn_end' && collector) {
      const assistantMessage = getRecord(message.message);
      collector.usage = toUsage(assistantMessage.usage) || collector.usage;
      collector.error = getText(assistantMessage.stopReason) === 'error'
        ? (getText(assistantMessage.errorMessage) || 'Pi provider returned an error')
        : undefined;
      collector.sawTurnEnd = true;
      collector.turnEndedAt = Date.now();
      collector.idleConfirmations = 0;
      if (collector.usage) this.emit(session, { type: 'usage.updated', runtimeId: 'pi', sessionId: session.sessionId, usage: collector.usage });
    } else if (eventType === 'agent_end' && collector) {
      // agent_end is emitted before Pi finishes retry/compaction/extension hooks. It is
      // only a hint for old Pi versions; completion is confirmed by agent_settled or
      // by the independent RPC idle-state watchdog below.
      collector.sawTurnEnd = true;
      collector.turnEndedAt = collector.turnEndedAt || Date.now();
    } else if (eventType === 'agent_settled' && collector) {
      this.settleCollector(session, collector, 'agent_settled');
    } else if (eventType === 'extension_error' && collector) {
      const error = getText(message.error) || 'Pi extension failed';
      this.emit(session, { type: 'turn.failed', runtimeId: 'pi', sessionId: session.sessionId, text: error });
    }
  }

  private createCollector(): PiTurnCollector {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const completion = new Promise<void>((resolveValue, rejectValue) => {
      resolve = resolveValue;
      reject = rejectValue;
    });
    return {
      answer: '',
      settled: false,
      sawTurnEnd: false,
      turnEndedAt: 0,
      idleConfirmations: 0,
      resolve,
      reject,
      completion,
    };
  }

  private settleCollector(session: PiRpcSession, collector: PiTurnCollector, source: 'agent_settled' | 'rpc-idle'): void {
    if (collector.settled) return;
    collector.settled = true;
    if (collector.error) {
      this.emit(session, { type: 'turn.failed', runtimeId: 'pi', sessionId: session.sessionId, text: collector.error });
      collector.reject(new Error(collector.error));
      return;
    }
    if (source === 'rpc-idle') {
      logger.warn(`[PiRuntime] agent_settled was not observed; confirmed completion from idle RPC state (${session.sessionId})`);
    }
    this.emit(session, {
      type: 'turn.completed',
      runtimeId: 'pi',
      sessionId: session.sessionId,
      data: { completionSource: source },
    });
    collector.resolve();
  }

  private startSettlementWatchdog(session: PiRpcSession, collector: PiTurnCollector): () => void {
    let probeInFlight = false;
    const timer = setInterval(() => {
      if (
        probeInFlight
        || session.closed
        || collector.settled
        || session.collector !== collector
        || !collector.sawTurnEnd
        || Date.now() - collector.turnEndedAt < PI_RPC_IDLE_PROBE_GRACE_MS
      ) return;
      probeInFlight = true;
      void this.rpc(session, { type: 'get_state' }, PI_RPC_IDLE_PROBE_TIMEOUT_MS).then(response => {
        if (collector.settled || session.collector !== collector) return;
        const state = getRecord(response.data);
        const pendingValue = Number(state.pendingMessageCount);
        const pendingMessageCount = Number.isFinite(pendingValue) ? Math.max(0, pendingValue) : 0;
        const isIdle = state.isStreaming === false
          && state.isCompacting !== true
          && pendingMessageCount === 0;
        collector.idleConfirmations = isIdle ? collector.idleConfirmations + 1 : 0;
        if (collector.idleConfirmations >= PI_RPC_IDLE_CONFIRMATIONS_REQUIRED) {
          this.settleCollector(session, collector, 'rpc-idle');
        }
      }).catch(error => {
        collector.idleConfirmations = 0;
        logger.debug(`[PiRuntime] Idle completion probe failed: ${(error as Error).message}`);
      }).finally(() => {
        probeInFlight = false;
      });
    }, PI_RPC_IDLE_PROBE_INTERVAL_MS);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private rpc(session: PiRpcSession, command: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    if (session.closed || !session.process.stdin) return Promise.reject(new Error('Pi RPC session is closed'));
    const id = `sh-${randomUUID()}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`Pi RPC command timed out: ${String(command.type || 'unknown')}`));
      }, timeoutMs);
      timer.unref?.();
      session.pending.set(id, { resolve, reject, timer });
      session.process.stdin!.write(`${JSON.stringify({ id, ...command })}\n`);
    });
  }

  private notify(session: PiRpcSession, command: Record<string, unknown>): void {
    if (!session.closed && session.process.stdin) session.process.stdin.write(`${JSON.stringify(command)}\n`);
  }

  private startSteeringPump(session: PiRpcSession, request: CodingAgentRuntimeTurnRequest): () => void {
    if (!request.takeSteeringMessages) return () => undefined;
    let busy = false;
    const timer = setInterval(() => {
      if (busy || session.closed || !session.collector) return;
      busy = true;
      void request.takeSteeringMessages!({ allowAttachments: true }).then(async messages => {
        for (const message of messages) {
          try {
            const selectedFiles = (message.workspaceFileMentions || [])
              .map(item => String(item.path || item.name || '').trim())
              .filter(Boolean)
              .slice(0, 30);
            const steeringText = [
              String(message.message || '').slice(0, 20_000),
              selectedFiles.length
                ? `用户同时选择的工作目录文件：\n${selectedFiles.map(item => `- ${item}`).join('\n')}`
                : '',
            ].filter(Boolean).join('\n\n');
            const images = (message.chatAttachments || [])
              .map(item => String(item.path || '').trim())
              .filter(item => item && /\.(?:png|jpe?g|gif|webp)$/i.test(item))
              .slice(0, 8)
              .map(readPiImage)
              .filter((item): item is NonNullable<typeof item> => Boolean(item));
            await this.rpc(session, {
              type: 'steer',
              message: steeringText,
              ...(images.length ? { images } : {}),
            }, 15_000);
            await request.markSteeringApplied?.(message.id);
          } catch (error) {
            await request.requeueSteeringMessage?.(message.id);
            logger.warn('[PiRuntime] Steering message requeued', error);
          }
        }
      }).finally(() => { busy = false; });
    }, 500);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private startCancellationPump(session: PiRpcSession, request: CodingAgentRuntimeTurnRequest): () => void {
    const timer = setInterval(() => {
      const collector = session.collector;
      if (!request.isCancelled?.() || session.closed || !collector || collector.settled) return;
      this.notify(session, { type: 'abort' });
      collector.settled = true;
      collector.reject(new Error('Pi turn was cancelled by the user'));
    }, 200);
    timer.unref?.();
    return () => clearInterval(timer);
  }

  private emit(session: PiRpcSession, event: CodingAgentRuntimeEvent): void {
    try { session.onEvent?.(event); } catch { /* Runtime observers are best effort. */ }
  }

  private closeSession(session: PiRpcSession, error: Error): void {
    if (session.closed) return;
    session.closed = true;
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    session.pending.forEach(pending => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    session.pending.clear();
    if (session.collector && !session.collector.settled) {
      session.collector.settled = true;
      session.collector.reject(error);
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    if (timeoutMs < 0) return promise;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      timer.unref?.();
      promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
  }
}
