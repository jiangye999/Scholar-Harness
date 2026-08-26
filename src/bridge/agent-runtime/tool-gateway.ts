import { randomUUID } from 'crypto';
import * as http from 'http';

import type { CodexBridgeToolSet } from '../../types';
import { logger } from '../../utils/logger';
import type { CodingAgentRuntimeToolReceipt } from './types';

export interface AgentToolGatewayConnection {
  url: string;
  token: string;
  sessionKey: string;
}

interface GatewaySession {
  toolSet?: CodexBridgeToolSet;
  receipts: CodingAgentRuntimeToolReceipt[];
}

function readBody(request: http.IncomingMessage, maxBytes = 8 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf-8');
    request.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) {
        request.destroy();
        reject(new Error('Tool request body is too large'));
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

export class AgentToolGateway {
  private readonly token = randomUUID();
  private readonly sessions = new Map<string, GatewaySession>();
  private server: http.Server | null = null;
  private url = '';

  async register(sessionKey: string, toolSet?: CodexBridgeToolSet): Promise<AgentToolGatewayConnection> {
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

  takeReceipts(sessionKey: string): CodingAgentRuntimeToolReceipt[] {
    const current = this.sessions.get(sessionKey);
    if (!current) return [];
    const receipts = [...current.receipts];
    current.receipts = [];
    return receipts;
  }

  unregister(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  private async ensureStarted(): Promise<void> {
    if (this.server && this.url) return;
    this.server = http.createServer((request, response) => {
      void this.handle(request, response).catch(error => {
        logger.warn('[AgentToolGateway] Tool request failed', error);
        if (!response.headersSent) sendJson(response, 500, { ok: false, error: (error as Error).message });
        else response.end();
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
    if (!address || typeof address === 'string') throw new Error('Unable to resolve Agent tool gateway address');
    this.url = `http://127.0.0.1:${address.port}`;
    this.server.unref();
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (request.headers.authorization !== `Bearer ${this.token}`) {
      sendJson(response, 401, { ok: false, error: 'Unauthorized' });
      return;
    }
    const sessionKey = String(request.headers['x-scholar-harness-session'] || '').trim();
    const session = this.sessions.get(sessionKey);
    if (!session) {
      sendJson(response, 404, { ok: false, error: 'Unknown Agent tool session' });
      return;
    }
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (request.method === 'GET' && pathname === '/tools') {
      sendJson(response, 200, { ok: true, tools: session.toolSet?.definitions || [] });
      return;
    }
    if (request.method !== 'POST' || pathname !== '/call') {
      sendJson(response, 404, { ok: false, error: 'Not found' });
      return;
    }
    const payload = JSON.parse((await readBody(request)) || '{}') as {
      name?: string;
      arguments?: Record<string, unknown>;
      callId?: string;
    };
    const name = String(payload.name || '').trim();
    const definition = session.toolSet?.definitions.find(item => item.function.name === name);
    if (!definition || !session.toolSet) {
      sendJson(response, 404, { ok: false, error: `Unknown tool: ${name}` });
      return;
    }
    const callId = String(payload.callId || `agent-tool-${randomUUID()}`);
    try {
      const result = await session.toolSet.execute({
        id: callId,
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(payload.arguments || {}),
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
