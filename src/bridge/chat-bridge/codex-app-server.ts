import type { ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import * as http from 'http';

import type { CodexBridgeToolSet, PiSteeringMessage } from '../../types';
import { logger } from '../../utils/logger';

export interface CodexToolGatewayConnection {
  url: string;
  token: string;
  sessionKey: string;
}

export interface CodexToolReceipt {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface CodexAppServerUsage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface CodexAppServerTurnOptions {
  conversationKey: string;
  cwd: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
  timeoutMs: number;
  compactInputTokenThreshold?: number;
  developerInstructions?: string;
  imagePaths?: string[];
  skillRoots?: string[];
  toolSet?: CodexBridgeToolSet;
  isCancelled?: () => boolean;
  takeSteeringMessages?: (options?: { allowAttachments?: boolean }) => Promise<PiSteeringMessage[]>;
  markSteeringApplied?: (messageId: string) => Promise<void>;
  requeueSteeringMessage?: (messageId: string) => Promise<void>;
  spawnAppServer: (connection: CodexToolGatewayConnection) => ChildProcess;
  onProgress?: (chunk: string) => void;
}

export interface CodexAppServerTurnResult {
  answer: string;
  threadId: string;
  turnId: string;
  usage?: CodexAppServerUsage;
  receipts: CodexToolReceipt[];
  resumed: boolean;
  compacted: boolean;
}

export class CodexTurnCancelledError extends Error {
  constructor(message = 'Codex turn was cancelled by the user') {
    super(message);
    this.name = 'CodexTurnCancelledError';
  }
}

export interface CodexModelCapacityActivity {
  assistantOutputObserved: boolean;
  sideEffectObserved: boolean;
  toolReceiptCount: number;
  turnStarted: boolean;
}

export class CodexModelCapacityError extends Error {
  readonly code = 'CODEX_MODEL_CAPACITY';
  readonly retrySafe: boolean;
  readonly activity: CodexModelCapacityActivity;

  constructor(message: string, activity: CodexModelCapacityActivity, cause?: unknown) {
    super(message);
    this.name = 'CodexModelCapacityError';
    this.activity = activity;
    this.retrySafe = !activity.assistantOutputObserved
      && !activity.sideEffectObserved
      && activity.toolReceiptCount === 0;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

export function isCodexModelCapacityError(error: unknown): boolean {
  if (error instanceof CodexModelCapacityError) return true;
  const candidate = error as { code?: unknown; message?: unknown } | null;
  if (candidate?.code === 'CODEX_MODEL_CAPACITY') return true;
  const message = String(candidate?.message || error || '');
  return /selected model is at capacity|model[^\n]{0,80}\bat capacity\b|model[^\n]{0,80}\bcapacity (?:is )?(?:full|exhausted)|temporarily unavailable due to (?:high )?(?:load|demand)|model[^\n]{0,80}\boverloaded\b/i.test(message);
}

export function isCodexTurnCancelledError(error: unknown): boolean {
  return error instanceof CodexTurnCancelledError
    || (error instanceof Error && (
      error.name === 'CodexTurnCancelledError'
      || /\b(?:cancelled|canceled|interrupted|user aborted|用户.*(?:取消|停止|中断))\b/i.test(error.message)
    ));
}

interface GatewaySession {
  toolSet?: CodexBridgeToolSet;
  receipts: CodexToolReceipt[];
}

interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface TurnCollector {
  turnId: string;
  finalAnswer: string;
  lastAgentAnswer: string;
  itemPhases: Map<string, string | null>;
  emittedCommentary: Set<string>;
  usage?: CodexAppServerUsage;
  resolve: (value: { status: string; error?: string }) => void;
  reject: (error: Error) => void;
  completion: Promise<{ status: string; error?: string }>;
}

interface CodexAppServerSession {
  key: string;
  process: ChildProcess;
  connection: CodexToolGatewayConnection;
  toolCatalogSignature: string;
  runtimeSignature: string;
  pending: Map<string, PendingRequest>;
  nextRequestId: number;
  stdoutBuffer: string;
  initialized: boolean;
  closed: boolean;
  threadId: string;
  lastUsage?: CodexAppServerUsage;
  collector?: TurnCollector;
  lastUsedAt: number;
  onProgress?: (chunk: string) => void;
  stderrWarnings: Set<string>;
  interruptionPromise?: Promise<boolean>;
  turnActivity?: Omit<CodexModelCapacityActivity, 'toolReceiptCount'>;
}

function readRequestBody(request: http.IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf-8');
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error('Tool request body is too large'));
        request.destroy();
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response: http.ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  response.end(body);
}

class CodexToolGateway {
  private readonly token = randomUUID();
  private readonly sessions = new Map<string, GatewaySession>();
  private server: http.Server | null = null;
  private url = '';

  async register(sessionKey: string, toolSet?: CodexBridgeToolSet): Promise<CodexToolGatewayConnection> {
    await this.ensureStarted();
    const current = this.sessions.get(sessionKey) || { receipts: [] };
    current.toolSet = toolSet;
    this.sessions.set(sessionKey, current);
    return { url: this.url, token: this.token, sessionKey };
  }

  update(sessionKey: string, toolSet?: CodexBridgeToolSet): void {
    const current = this.sessions.get(sessionKey) || { receipts: [] };
    current.toolSet = toolSet;
    this.sessions.set(sessionKey, current);
  }

  clearReceipts(sessionKey: string): void {
    const current = this.sessions.get(sessionKey);
    if (current) current.receipts = [];
  }

  takeReceipts(sessionKey: string): CodexToolReceipt[] {
    const current = this.sessions.get(sessionKey);
    if (!current) return [];
    const receipts = [...current.receipts];
    current.receipts = [];
    return receipts;
  }

  private async ensureStarted(): Promise<void> {
    if (this.server && this.url) return;
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response).catch(error => {
        logger.warn(`[CodexToolGateway] Request failed: ${(error as Error).message}`);
        if (!response.headersSent) {
          sendJson(response, 500, { ok: false, error: (error as Error).message });
        } else {
          response.end();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(0, '127.0.0.1', () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to resolve Codex tool gateway address');
    }
    this.url = `http://127.0.0.1:${address.port}`;
    this.server.unref();
  }

  private async handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      sendJson(response, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const sessionKey = String(request.headers['x-scholar-harness-session'] || '').trim();
    const session = this.sessions.get(sessionKey);
    if (!session) {
      sendJson(response, 404, { ok: false, error: 'Unknown Codex tool session' });
      return;
    }
    const pathname = new URL(request.url || '/', this.url).pathname;
    if (request.method === 'GET' && pathname === '/tools') {
      sendJson(response, 200, { ok: true, tools: session.toolSet?.definitions || [] });
      return;
    }
    if (request.method !== 'POST' || pathname !== '/call') {
      sendJson(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    if (!session.toolSet) {
      sendJson(response, 409, { ok: false, error: 'No Scholar Harness tools are active for this turn' });
      return;
    }
    const payload = JSON.parse(await readRequestBody(request) || '{}') as {
      name?: unknown;
      arguments?: unknown;
      callId?: unknown;
    };
    const name = String(payload.name || '').trim();
    const callId = String(payload.callId || `mcp-${randomUUID()}`);
    const definition = session.toolSet.definitions.find(tool => tool.function.name === name);
    if (!definition) {
      const error = `Unknown Scholar Harness tool: ${name}`;
      session.receipts.push({ callId, name, ok: false, error });
      sendJson(response, 404, { ok: false, error });
      return;
    }
    try {
      const result = await session.toolSet.execute({
        id: callId,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(payload.arguments && typeof payload.arguments === 'object' ? payload.arguments : {}),
        },
      });
      const ok = !(result && typeof result === 'object' && 'ok' in result)
        || (result as { ok?: unknown }).ok !== false;
      session.receipts.push({ callId, name, ok, result });
      sendJson(response, 200, { ok: true, result });
    } catch (error) {
      const message = (error as Error).message || String(error);
      session.receipts.push({ callId, name, ok: false, error: message });
      sendJson(response, 500, { ok: false, error: message });
    }
  }
}

function requestKey(id: string | number): string {
  return String(id);
}

function truncate(value: unknown, max = 4000): string {
  const text = String(value || '').trim();
  return text.length > max ? `${text.slice(0, max)}\n...` : text;
}

function toUsage(value: any): CodexAppServerUsage | undefined {
  const usage = value?.last || value;
  if (!usage || typeof usage !== 'object') return undefined;
  const inputTokens = Number(usage.inputTokens || 0);
  const outputTokens = Number(usage.outputTokens || 0);
  const reasoningTokens = Number(usage.reasoningOutputTokens || usage.reasoningTokens || 0);
  const totalTokens = Number(usage.totalTokens || inputTokens + outputTokens);
  if (![inputTokens, outputTokens, reasoningTokens, totalTokens].some(Number.isFinite)) return undefined;
  return { inputTokens, outputTokens, reasoningTokens, totalTokens };
}

function createCollector(): TurnCollector {
  let resolve!: (value: { status: string; error?: string }) => void;
  let reject!: (error: Error) => void;
  const completion = new Promise<{ status: string; error?: string }>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    turnId: '',
    finalAnswer: '',
    lastAgentAnswer: '',
    itemPhases: new Map(),
    emittedCommentary: new Set(),
    resolve,
    reject,
    completion,
  };
}

function getItemLabel(item: any): string {
  if (!item || typeof item !== 'object') return '';
  if (item.type === 'commandExecution') return `exec_shell: ${truncate(item.command, 1200)}`;
  if (item.type === 'mcpToolCall') return `${item.server || 'mcp'}.${item.tool || 'tool'}`;
  if (item.type === 'fileChange') {
    const paths = Array.isArray(item.changes) ? item.changes.map((change: any) => change.path).filter(Boolean) : [];
    return `file_change${paths.length ? `: ${paths.join(', ')}` : ''}`;
  }
  if (item.type === 'webSearch') return 'web_search';
  if (item.type === 'imageView') return `view_image: ${item.path || ''}`;
  if (item.type === 'contextCompaction') return 'context_compaction';
  return '';
}

function buildToolCatalogSignature(toolSet?: CodexBridgeToolSet): string {
  if (!toolSet?.definitions.length) return '';
  return JSON.stringify(toolSet.definitions.map(definition => definition.function));
}

function buildRuntimeSignature(options: Pick<CodexAppServerTurnOptions, 'cwd' | 'sandbox'>): string {
  const cwd = String(options.cwd || '')
    .trim()
    .replace(/[\\/]+$/, '')
    .replace(/\\/g, '/');
  return JSON.stringify({
    cwd: process.platform === 'win32' ? cwd.toLowerCase() : cwd,
    sandbox: options.sandbox,
  });
}

class CodexAppServerManager {
  private readonly gateway = new CodexToolGateway();
  private readonly sessions = new Map<string, CodexAppServerSession>();
  private readonly knownThreadIds = new Map<string, string>();
  private readonly queues = new Map<string, Promise<void>>();

  hasThread(conversationKey: string): boolean {
    return !!(this.sessions.get(conversationKey)?.threadId || this.knownThreadIds.get(conversationKey));
  }

  getThreadId(conversationKey: string): string {
    return this.sessions.get(conversationKey)?.threadId || this.knownThreadIds.get(conversationKey) || '';
  }

  async interruptConversationsByPrefix(conversationKeyPrefix: string): Promise<{
    matched: number;
    interrupted: number;
    conversationKeys: string[];
  }> {
    const sessions = Array.from(this.sessions.entries())
      .filter(([key, session]) => key.startsWith(conversationKeyPrefix) && !session.closed);
    let interrupted = 0;
    const conversationKeys: string[] = [];
    for (const [key, session] of sessions) {
      conversationKeys.push(key);
      if (await this.interruptSession(session)) interrupted += 1;
    }
    return { matched: sessions.length, interrupted, conversationKeys };
  }

  clearThread(conversationKey: string): void {
    this.knownThreadIds.delete(conversationKey);
    const session = this.sessions.get(conversationKey);
    if (session) session.threadId = '';
  }

  disposeConversation(conversationKey: string, forgetThread = false): void {
    const session = this.sessions.get(conversationKey);
    if (session) {
      session.process.kill();
      this.closeSession(session, new Error('Codex App Server session disposed'));
    }
    if (forgetThread) this.knownThreadIds.delete(conversationKey);
  }

  async runTurn(options: CodexAppServerTurnOptions): Promise<CodexAppServerTurnResult> {
    const previous = this.queues.get(options.conversationKey) || Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>(resolve => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.queues.set(options.conversationKey, queued);
    await previous;
    try {
      return await this.runTurnUnlocked(options);
    } catch (error) {
      if (!isCodexModelCapacityError(error)) throw error;
      const receipts = this.gateway.takeReceipts(options.conversationKey);
      const activity = this.sessions.get(options.conversationKey)?.turnActivity;
      throw new CodexModelCapacityError(
        (error as Error).message || 'Selected model is at capacity. Please try a different model.',
        {
          assistantOutputObserved: activity?.assistantOutputObserved === true,
          sideEffectObserved: activity?.sideEffectObserved === true,
          turnStarted: activity?.turnStarted === true,
          toolReceiptCount: receipts.length,
        },
        error,
      );
    } finally {
      release();
      if (this.queues.get(options.conversationKey) === queued) {
        this.queues.delete(options.conversationKey);
      }
    }
  }

  private async runTurnUnlocked(options: CodexAppServerTurnOptions): Promise<CodexAppServerTurnResult> {
    if (options.isCancelled?.()) throw new CodexTurnCancelledError();
    const connection = await this.gateway.register(options.conversationKey, options.toolSet);
    this.gateway.update(options.conversationKey, options.toolSet);
    this.gateway.clearReceipts(options.conversationKey);
    let session = this.sessions.get(options.conversationKey);
    const toolCatalogSignature = buildToolCatalogSignature(options.toolSet);
    const runtimeSignature = buildRuntimeSignature(options);
    const toolCatalogChanged = !!session
      && !session.closed
      && session.toolCatalogSignature !== toolCatalogSignature;
    const runtimeChanged = !!session
      && !session.closed
      && session.runtimeSignature !== runtimeSignature;
    if (session && !session.closed && (toolCatalogChanged || runtimeChanged)) {
      const reasons: string[] = [];
      if (toolCatalogChanged) {
        const previousToolCount = session.toolCatalogSignature ? JSON.parse(session.toolCatalogSignature).length : 0;
        const nextToolCount = options.toolSet?.definitions.length || 0;
        reasons.push(`tools ${previousToolCount} -> ${nextToolCount}`);
      }
      if (runtimeChanged) reasons.push(`cwd/sandbox -> ${options.sandbox}`);
      const error = new Error(`Codex App Server runtime changed between turns: ${reasons.join(', ')}`);
      logger.info(
        `[CodexAppServer] Reloading runtime for ${options.conversationKey} `
        + `(${reasons.join('; ')}) while preserving the Codex thread`
      );
      options.onProgress?.(
        runtimeChanged
          ? '\n→ 工作目录或权限已变化，正在按新权限重启 Codex 运行环境并续接当前会话\n'
          : '\n→ 本轮可用文件/应用工具发生变化，正在刷新 Codex 工具目录并续接当前会话\n'
      );
      session.process.kill();
      this.closeSession(session, error);
      session = undefined;
    }
    if (!session || session.closed) {
      session = await this.startSession(options, connection);
    }
    session.turnActivity = {
      assistantOutputObserved: false,
      sideEffectObserved: false,
      turnStarted: false,
    };
    if (options.isCancelled?.()) {
      await this.interruptSession(session);
      throw new CodexTurnCancelledError();
    }
    session.onProgress = options.onProgress;
    session.lastUsedAt = Date.now();

    const knownThreadId = session.threadId || this.knownThreadIds.get(options.conversationKey) || '';
    let resumed = false;
    if (!session.threadId) {
      if (knownThreadId) {
        try {
          const response = await this.request(session, 'thread/resume', {
            threadId: knownThreadId,
            model: options.model || null,
            cwd: options.cwd,
            approvalPolicy: 'never',
            sandbox: options.sandbox,
            developerInstructions: options.developerInstructions || null,
          }, 60_000);
          session.threadId = String(response?.thread?.id || knownThreadId);
          resumed = true;
        } catch (error) {
          logger.warn(`[CodexAppServer] Unable to resume thread ${knownThreadId}; starting a new thread: ${(error as Error).message}`);
          this.knownThreadIds.delete(options.conversationKey);
        }
      }
      if (!session.threadId) {
        const response = await this.request(session, 'thread/start', {
          model: options.model || null,
          cwd: options.cwd,
          approvalPolicy: 'never',
          sandbox: options.sandbox,
          serviceName: 'Scholar Harness',
          developerInstructions: options.developerInstructions || null,
          ephemeral: false,
        }, 60_000);
        session.threadId = String(response?.thread?.id || '');
        if (!session.threadId) throw new Error('Codex App Server did not return a thread id');
      }
      this.knownThreadIds.set(options.conversationKey, session.threadId);
    } else {
      resumed = true;
    }

    if (options.toolSet?.definitions.length) {
      const inventory = await this.request(session, 'mcpServerStatus/list', {
        detail: 'toolsAndAuthOnly',
        threadId: session.threadId,
      }, 30_000);
      const scholarServer = Array.isArray(inventory?.data)
        ? inventory.data.find((server: any) => server?.name === 'scholar_harness')
        : null;
      const availableTools = scholarServer?.tools && typeof scholarServer.tools === 'object'
        ? Object.keys(scholarServer.tools)
        : [];
      const expectedTools = options.toolSet.definitions.map(tool => tool.function.name);
      const missingTools = expectedTools.filter(name => !availableTools.includes(name));
      if (!scholarServer || availableTools.length === 0 || missingTools.length > 0) {
        const detail = missingTools.length > 0
          ? `; missing tools: ${missingTools.join(', ')}`
          : '';
        const error = new Error(`Scholar Harness MCP tools were not loaded by Codex App Server${detail}`);
        session.process.kill();
        this.closeSession(session, error);
        throw error;
      }
      logger.info(`[CodexAppServer] Scholar Harness MCP ready | tools=${availableTools.length}`);
    }

    if (options.skillRoots?.length) {
      await this.request(session, 'skills/extraRoots/set', {
        extraRoots: Array.from(new Set(options.skillRoots)),
      }, 30_000).catch(error => {
        logger.warn(`[CodexAppServer] Unable to set Skill roots: ${(error as Error).message}`);
      });
    }

    let compacted = false;
    const threshold = Math.max(1, Number(options.compactInputTokenThreshold || 2_000_000));
    if (session.lastUsage && session.lastUsage.inputTokens > threshold) {
      options.onProgress?.(`\n→ Codex 上轮输入 tokens 超过 ${threshold}，正在压缩当前 thread 上下文\n`);
      await this.request(session, 'thread/compact/start', { threadId: session.threadId }, 180_000);
      compacted = true;
      options.onProgress?.('✓ Codex thread 上下文压缩完成，继续同一会话\n');
    }

    const collector = createCollector();
    session.collector = collector;
    const input: any[] = [{ type: 'text', text: options.prompt, text_elements: [] }];
    for (const imagePath of options.imagePaths || []) {
      input.push({ type: 'localImage', path: imagePath });
    }

    let turnResponse: any;
    try {
      if (options.isCancelled?.()) throw new CodexTurnCancelledError();
      turnResponse = await this.request(session, 'turn/start', {
        threadId: session.threadId,
        input,
        cwd: options.cwd,
        approvalPolicy: 'never',
        model: options.model || null,
        effort: options.reasoningEffort || null,
      }, 60_000);
      session.turnActivity.turnStarted = true;
      collector.turnId = collector.turnId || String(turnResponse?.turn?.id || '');
      if (!collector.turnId) throw new Error('Codex App Server did not return a turn id');
      let completion: { status: string; error?: string };
      const stopSteeringPump = this.startSteeringPump(session, collector, options);
      const stopCancellationPump = this.startCancellationPump(session, collector, options);
      try {
        completion = await this.waitForTurn(session, collector, options.timeoutMs);
      } catch (error) {
        if (/turn timed out/i.test((error as Error).message || '')) {
          session.process.kill();
          this.closeSession(session, error as Error);
        }
        throw error;
      } finally {
        stopSteeringPump();
        stopCancellationPump();
      }
      if (completion.status !== 'completed') {
        if (options.isCancelled?.() || /cancel|interrupt|abort/i.test(completion.status)) {
          throw new CodexTurnCancelledError(completion.error || `Codex turn ended with status ${completion.status}`);
        }
        throw new Error(completion.error || `Codex turn ended with status ${completion.status}`);
      }
      const answer = (collector.finalAnswer || collector.lastAgentAnswer).trim();
      if (!answer) throw new Error('Codex App Server returned an empty final answer');
      if (collector.usage) {
        session.lastUsage = collector.usage;
      }
      return {
        answer,
        threadId: session.threadId,
        turnId: collector.turnId,
        usage: collector.usage || session.lastUsage,
        receipts: this.gateway.takeReceipts(options.conversationKey),
        resumed,
        compacted,
      };
    } finally {
      if (session.collector === collector) session.collector = undefined;
    }
  }

  private async startSession(
    options: CodexAppServerTurnOptions,
    connection: CodexToolGatewayConnection,
  ): Promise<CodexAppServerSession> {
    this.pruneIdleSessions(options.conversationKey);
    const child = options.spawnAppServer(connection);
    const session: CodexAppServerSession = {
      key: options.conversationKey,
      process: child,
      connection,
      toolCatalogSignature: buildToolCatalogSignature(options.toolSet),
      runtimeSignature: buildRuntimeSignature(options),
      pending: new Map(),
      nextRequestId: 1,
      stdoutBuffer: '',
      initialized: false,
      closed: false,
      threadId: '',
      lastUsedAt: Date.now(),
      onProgress: options.onProgress,
      stderrWarnings: new Set(),
    };
    this.sessions.set(options.conversationKey, session);
    child.stdout?.setEncoding('utf-8');
    child.stdout?.on('data', chunk => this.consumeStdout(session, String(chunk)));
    child.stderr?.setEncoding('utf-8');
    child.stderr?.on('data', chunk => {
      const message = String(chunk).trim();
      if (!message) return;
      if (/mcp\.notion\.com|Transport channel closed/i.test(message)) {
        logger.warn('[CodexAppServer] Ignored disabled Notion MCP diagnostic.');
        return;
      }
      if (/responses_websocket[\s\S]*failed to connect to websocket|tls handshake eof/i.test(message)) {
        if (!session.stderrWarnings.has('websocket')) {
          session.stderrWarnings.add('websocket');
          logger.warn('[CodexAppServer] Codex WebSocket transport unavailable; Codex will use its HTTP fallback.');
        }
        return;
      }
      if (/windows sandbox:\s*spawn setup refresh/i.test(message)) {
        if (!session.stderrWarnings.has('windows-sandbox')) {
          session.stderrWarnings.add('windows-sandbox');
          logger.warn('[CodexAppServer] Windows shell sandbox initialization failed; Scholar Harness MCP tools remain available.');
        }
        return;
      }
      logger.warn(`[CodexAppServer] stderr: ${truncate(message, 6000)}`);
    });
    child.on('error', error => this.closeSession(session, error));
    child.on('close', code => this.closeSession(session, new Error(`Codex App Server exited with code ${code ?? 'unknown'}`)));
    if (!child.stdin || !child.stdout) {
      this.closeSession(session, new Error('Codex App Server stdio is unavailable'));
      throw new Error('Codex App Server stdio is unavailable');
    }
    try {
      await this.request(session, 'initialize', {
        clientInfo: { name: 'scholar-harness', title: 'Scholar Harness', version: '1.0.9' },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          mcpServerOpenaiFormElicitation: true,
        },
      }, 30_000);
      this.notify(session, 'initialized', {});
      session.initialized = true;
      return session;
    } catch (error) {
      child.kill();
      this.closeSession(session, error as Error);
      throw error;
    }
  }

  private consumeStdout(session: CodexAppServerSession, chunk: string): void {
    session.stdoutBuffer += chunk;
    const lines = session.stdoutBuffer.split(/\r?\n/);
    session.stdoutBuffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.handleMessage(session, JSON.parse(trimmed) as JsonRpcMessage);
      } catch (error) {
        logger.warn(`[CodexAppServer] Invalid stdout JSON: ${truncate(trimmed, 2000)} | ${(error as Error).message}`);
      }
    }
  }

  private handleMessage(session: CodexAppServerSession, message: JsonRpcMessage): void {
    if (message.id !== undefined && message.id !== null && !message.method) {
      const key = requestKey(message.id);
      const pending = session.pending.get(key);
      if (!pending) return;
      session.pending.delete(key);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new Error(message.error.message || `Codex JSON-RPC error ${message.error.code || ''}`));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && message.id !== null && message.method) {
      if (message.method === 'mcpServer/elicitation/request'
        && String(message.params?.serverName || '') === 'scholar_harness') {
        logger.info(`[CodexAppServer] Accepted trusted Scholar Harness MCP elicitation | mode=${String(message.params?.mode || 'unknown')}`);
        this.write(session, {
          jsonrpc: '2.0',
          id: message.id,
          result: { action: 'accept', content: {}, _meta: null },
        });
        return;
      }
      this.write(session, {
        jsonrpc: '2.0',
        id: message.id,
        error: { code: -32601, message: `Scholar Harness does not accept server request ${message.method}` },
      });
      return;
    }
    if (message.method) this.handleNotification(session, message.method, message.params || {});
  }

  private handleNotification(session: CodexAppServerSession, method: string, params: any): void {
    if (method === 'mcpServer/startupStatus/updated') {
      const name = String(params?.name || 'unknown');
      const status = String(params?.status || 'unknown');
      const detail = String(params?.error || params?.failureReason || '').trim();
      logger.info(`[CodexAppServer] MCP ${name}: ${status}${detail ? ` | ${detail}` : ''}`);
      if (name === 'scholar_harness' && status === 'failed') {
        session.onProgress?.(`! Scholar Harness MCP 启动失败${detail ? `：${detail}` : ''}\n`);
      }
      return;
    }
    const collector = session.collector;
    if (method === 'thread/tokenUsage/updated') {
      const usage = toUsage(params?.tokenUsage);
      if (usage) {
        session.lastUsage = usage;
        if (collector) collector.usage = usage;
      }
      return;
    }
    if (!collector) return;
    const notificationTurnId = String(params?.turnId || params?.turn?.id || '');
    if (notificationTurnId && collector.turnId && notificationTurnId !== collector.turnId) return;
    if (method === 'turn/started') {
      collector.turnId = collector.turnId || notificationTurnId;
      if (session.turnActivity) session.turnActivity.turnStarted = true;
      return;
    }
    if (method === 'item/started') {
      const item = params?.item;
      this.observeTurnItemActivity(session, item);
      if (item?.id) collector.itemPhases.set(String(item.id), item.phase ?? null);
      const label = getItemLabel(item);
      if (label) session.onProgress?.(`\n→ ${label}\n`);
      return;
    }
    if (method === 'item/agentMessage/delta') {
      const itemId = String(params?.itemId || '');
      const phase = collector.itemPhases.get(itemId);
      const delta = String(params?.delta || '');
      if (phase === 'commentary' && delta) {
        if (session.turnActivity) session.turnActivity.assistantOutputObserved = true;
        collector.emittedCommentary.add(itemId);
        session.onProgress?.(delta);
      }
      return;
    }
    if (method === 'item/reasoning/summaryTextDelta') {
      const delta = String(params?.delta || '');
      if (delta) session.onProgress?.(delta);
      return;
    }
    if (method === 'item/commandExecution/outputDelta') {
      const delta = String(params?.delta || '');
      if (session.turnActivity) session.turnActivity.sideEffectObserved = true;
      if (delta) session.onProgress?.(truncate(delta, 3000));
      return;
    }
    if (method === 'item/mcpToolCall/progress') {
      const progress = String(params?.message || '').trim();
      if (session.turnActivity) session.turnActivity.sideEffectObserved = true;
      if (progress) session.onProgress?.(`  ${progress}\n`);
      return;
    }
    if (method === 'item/completed') {
      this.consumeCompletedItem(session, collector, params?.item);
      return;
    }
    if (method === 'thread/compacted') {
      session.onProgress?.('✓ Codex thread compact 完成\n');
      return;
    }
    if (method === 'turn/completed') {
      const turn = params?.turn || {};
      if (Array.isArray(turn.items)) {
        for (const item of turn.items) this.consumeCompletedItem(session, collector, item, false);
      }
      const status = String(turn.status || 'completed');
      collector.resolve({ status, error: turn.error?.message || undefined });
    }
  }

  private consumeCompletedItem(
    session: CodexAppServerSession,
    collector: TurnCollector,
    item: any,
    emit = true,
  ): void {
    if (!item || typeof item !== 'object') return;
    this.observeTurnItemActivity(session, item);
    if (item.type === 'agentMessage') {
      const text = String(item.text || '').trim();
      if (!text) return;
      if (session.turnActivity) session.turnActivity.assistantOutputObserved = true;
      collector.lastAgentAnswer = text;
      if (item.phase === 'final_answer') {
        collector.finalAnswer = text;
      } else if (emit && item.phase === 'commentary' && !collector.emittedCommentary.has(String(item.id || ''))) {
        session.onProgress?.(`${text}\n`);
      }
      return;
    }
    if (!emit) return;
    if (item.type === 'commandExecution') {
      const ok = item.status === 'completed' && (item.exitCode === 0 || item.exitCode === null);
      const output = truncate(item.aggregatedOutput || '', 5000);
      session.onProgress?.(`${ok ? '✓' : '!'} exec_shell ${item.status || ''}${item.exitCode !== null && item.exitCode !== undefined ? ` (exit ${item.exitCode})` : ''}${output ? `\n${output}` : ''}\n`);
      return;
    }
    if (item.type === 'mcpToolCall') {
      const ok = item.status === 'completed' && !item.error;
      const detail = item.error?.message || '';
      session.onProgress?.(`${ok ? '✓' : '!'} ${item.server || 'mcp'}.${item.tool || 'tool'}${detail ? `: ${detail}` : ''}\n`);
      return;
    }
    if (item.type === 'fileChange') {
      session.onProgress?.(`${item.status === 'completed' ? '✓' : '!'} file_change ${item.status || ''}\n`);
    }
  }

  private observeTurnItemActivity(session: CodexAppServerSession, item: any): void {
    if (!session.turnActivity || !item || typeof item !== 'object') return;
    const type = String(item.type || '').toLowerCase();
    if (type === 'agentmessage') {
      if (String(item.text || '').trim()) session.turnActivity.assistantOutputObserved = true;
      return;
    }
    if (
      type === 'commandexecution'
      || type === 'filechange'
      || type === 'mcptoolcall'
      || type === 'dynamictoolcall'
      || type === 'websearch'
    ) {
      session.turnActivity.sideEffectObserved = true;
    }
  }

  private async waitForTurn(
    session: CodexAppServerSession,
    collector: TurnCollector,
    timeoutMs: number,
  ): Promise<{ status: string; error?: string }> {
    if (timeoutMs <= 0) {
      return collector.completion;
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => {
        void this.request(session, 'turn/interrupt', {
          threadId: session.threadId,
          turnId: collector.turnId,
        }, 10_000).catch(() => undefined);
        reject(new Error(`Codex App Server turn timed out after ${timeoutMs}ms`));
      }, Math.max(30_000, timeoutMs));
    });
    try {
      return await Promise.race([collector.completion, timedOut]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private startCancellationPump(
    session: CodexAppServerSession,
    collector: TurnCollector,
    options: CodexAppServerTurnOptions,
  ): () => void {
    if (!options.isCancelled) return () => undefined;
    let stopped = false;
    let interrupting = false;
    const pump = async (): Promise<void> => {
      if (stopped || interrupting || session.closed || !collector.turnId || !options.isCancelled?.()) return;
      interrupting = true;
      try {
        await this.request(session, 'turn/interrupt', {
          threadId: session.threadId,
          turnId: collector.turnId,
        }, 10_000);
      } catch (error) {
        if (!session.closed) {
          const cancellationError = new CodexTurnCancelledError((error as Error).message);
          this.closeSession(session, cancellationError);
          session.process.kill();
        }
      }
    };
    const timer = setInterval(() => {
      void pump();
    }, 200);
    timer.unref?.();
    void pump();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private startSteeringPump(
    session: CodexAppServerSession,
    collector: TurnCollector,
    options: CodexAppServerTurnOptions,
  ): () => void {
    if (!options.takeSteeringMessages) return () => undefined;
    let stopped = false;
    let running = false;
    let supported = true;

    const pump = async (): Promise<void> => {
      if (stopped || running || !supported || session.closed || !collector.turnId) return;
      running = true;
      try {
        const messages = await options.takeSteeringMessages?.({ allowAttachments: true }) || [];
        for (const item of messages) {
          const selectedFiles = Array.isArray(item.workspaceFileMentions)
            ? item.workspaceFileMentions
                .map(file => String(file?.path || file?.name || '').trim())
                .filter(Boolean)
                .slice(0, 30)
            : [];
          const text = [
            '用户在你运行过程中发来了 Pi 转向消息。请在保留已完成且仍有效的工具结果基础上，立即按这条最新指令调整后续行动。',
            selectedFiles.length ? `用户同时选择的工作目录文件：\n${selectedFiles.map(file => `- ${file}`).join('\n')}` : '',
            '<CURRENT_STEERING_REQUEST>',
            String(item.message || '').slice(0, 20000),
            '</CURRENT_STEERING_REQUEST>',
          ].filter(Boolean).join('\n');
          const input: any[] = [{ type: 'text', text, text_elements: [] }];
          for (const attachment of item.chatAttachments || []) {
            const imagePath = String(attachment?.path || '').trim();
            const type = String(attachment?.type || '').toLowerCase();
            if (imagePath && (type === 'image' || /\.(png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(imagePath))) {
              input.push({ type: 'localImage', path: imagePath });
            }
          }
          try {
            await this.request(session, 'turn/steer', {
              threadId: session.threadId,
              expectedTurnId: collector.turnId,
              input,
            }, 30_000);
            await options.markSteeringApplied?.(item.id);
            session.onProgress?.(`\n↪ 已将转向消息注入当前 Codex turn：${truncate(item.message, 160)}\n`);
          } catch (error) {
            try {
              await options.requeueSteeringMessage?.(item.id);
            } catch {
              // Session settlement performs a second recovery pass.
            }
            supported = false;
            logger.warn(`[CodexAppServer] turn/steer unavailable; message kept for prioritized continuation: ${(error as Error).message}`);
            session.onProgress?.('\n! 当前 Codex App Server 不支持本轮 steer，消息已保留，将在本轮结束后优先继续。\n');
            break;
          }
        }
      } catch (error) {
        logger.warn(`[CodexAppServer] Steering pump failed: ${(error as Error).message}`);
      } finally {
        running = false;
      }
    };

    const timer = setInterval(() => {
      void pump();
    }, 500);
    timer.unref?.();
    void pump();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }

  private request(session: CodexAppServerSession, method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (session.closed) return Promise.reject(new Error('Codex App Server session is closed'));
    const id = session.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(requestKey(id));
        reject(new Error(`Codex App Server request ${method} timed out`));
      }, timeoutMs);
      session.pending.set(requestKey(id), { resolve, reject, timer });
      try {
        this.write(session, { jsonrpc: '2.0', id, method, params });
      } catch (error) {
        clearTimeout(timer);
        session.pending.delete(requestKey(id));
        reject(error);
      }
    });
  }

  private notify(session: CodexAppServerSession, method: string, params: unknown): void {
    this.write(session, { jsonrpc: '2.0', method, params });
  }

  private async interruptSession(session: CodexAppServerSession): Promise<boolean> {
    if (session.interruptionPromise) return session.interruptionPromise;
    const promise = this.interruptSessionUnlocked(session);
    session.interruptionPromise = promise;
    try {
      return await promise;
    } finally {
      if (session.interruptionPromise === promise) session.interruptionPromise = undefined;
    }
  }

  private async interruptSessionUnlocked(session: CodexAppServerSession): Promise<boolean> {
    if (session.closed) return false;
    const collector = session.collector;
    const cancellationError = new CodexTurnCancelledError();
    if (!collector?.turnId || !session.threadId) {
      this.closeSession(session, cancellationError);
      session.process.kill();
      return true;
    }
    try {
      await this.request(session, 'turn/interrupt', {
        threadId: session.threadId,
        turnId: collector.turnId,
      }, 10_000);
      const completed = await Promise.race([
        collector.completion.then(() => true, () => true),
        new Promise<boolean>(resolve => {
          const timer = setTimeout(() => resolve(false), 1_500);
          timer.unref?.();
        }),
      ]);
      if (!completed && !session.closed) {
        this.closeSession(session, cancellationError);
        session.process.kill();
      }
      return true;
    } catch (error) {
      if (!session.closed) {
        this.closeSession(
          session,
          isCodexTurnCancelledError(error)
            ? error as Error
            : new CodexTurnCancelledError((error as Error).message),
        );
        session.process.kill();
      }
      return true;
    }
  }

  private write(session: CodexAppServerSession, message: JsonRpcMessage): void {
    if (session.closed || !session.process.stdin) throw new Error('Codex App Server stdin is closed');
    session.process.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private closeSession(session: CodexAppServerSession, error: Error): void {
    if (session.closed) return;
    session.closed = true;
    if (session.threadId) this.knownThreadIds.set(session.key, session.threadId);
    if (this.sessions.get(session.key) === session) this.sessions.delete(session.key);
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pending.clear();
    session.collector?.reject(error);
  }

  private pruneIdleSessions(exceptKey: string): void {
    const live = Array.from(this.sessions.values()).filter(session => !session.closed && session.key !== exceptKey);
    if (live.length < 7) return;
    live.sort((left, right) => left.lastUsedAt - right.lastUsedAt);
    for (const session of live.slice(0, Math.max(1, live.length - 6))) {
      if (session.collector) continue;
      session.process.kill();
      this.closeSession(session, new Error('Codex App Server session evicted after becoming idle'));
    }
  }
}

export const codexAppServerManager = new CodexAppServerManager();
