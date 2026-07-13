import * as http from 'http';
import * as readline from 'readline';

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface GatewayResponse {
  ok: boolean;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description?: string;
      parameters?: Record<string, unknown>;
    };
  }>;
  result?: unknown;
  error?: string;
}

const gatewayUrl = String(process.env.SCHOLAR_HARNESS_CODEX_GATEWAY_URL || '').trim();
const gatewayToken = String(process.env.SCHOLAR_HARNESS_CODEX_GATEWAY_TOKEN || '').trim();
const sessionKey = String(process.env.SCHOLAR_HARNESS_CODEX_SESSION_KEY || '').trim();

function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeResult(id: string | number | null | undefined, result: unknown): void {
  writeJson({ jsonrpc: '2.0', id: id ?? null, result });
}

function writeError(id: string | number | null | undefined, code: number, message: string): void {
  writeJson({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });
}

async function requestGateway(method: 'GET' | 'POST', pathname: string, payload?: unknown): Promise<GatewayResponse> {
  if (!gatewayUrl || !gatewayToken || !sessionKey) {
    throw new Error('Scholar Harness Codex tool gateway is not configured');
  }
  const target = new URL(pathname, gatewayUrl);
  const body = payload === undefined ? '' : JSON.stringify(payload);
  return new Promise<GatewayResponse>((resolve, reject) => {
    const request = http.request(target, {
      method,
      headers: {
        authorization: `Bearer ${gatewayToken}`,
        'x-scholar-harness-session': sessionKey,
        ...(body ? {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        } : {}),
      },
    }, (response) => {
      let responseBody = '';
      response.setEncoding('utf-8');
      response.on('data', chunk => {
        responseBody += chunk;
      });
      response.on('end', () => {
        try {
          const parsed = JSON.parse(responseBody || '{}') as GatewayResponse;
          if ((response.statusCode || 500) >= 400 || !parsed.ok) {
            reject(new Error(parsed.error || `Tool gateway returned HTTP ${response.statusCode || 500}`));
            return;
          }
          resolve(parsed);
        } catch (error) {
          reject(new Error(`Invalid tool gateway response: ${(error as Error).message}`));
        }
      });
    });
    request.on('error', reject);
    request.setTimeout(30_000, () => {
      request.destroy(new Error('Tool gateway request timed out'));
    });
    if (body) request.write(body);
    request.end();
  });
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const method = String(request.method || '');
  if (!method) return;
  if (request.id === undefined || request.id === null) {
    return;
  }

  if (method === 'initialize') {
    const requestedVersion = String(request.params?.protocolVersion || '').trim();
    writeResult(request.id, {
      protocolVersion: requestedVersion || '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'scholar-harness', version: '1.0.6' },
    });
    return;
  }
  if (method === 'ping') {
    writeResult(request.id, {});
    return;
  }
  if (method === 'tools/list') {
    const response = await requestGateway('GET', '/tools');
    const tools = (response.tools || []).map(tool => ({
      name: tool.function.name,
      description: tool.function.description || '',
      inputSchema: tool.function.parameters || { type: 'object', properties: {} },
    }));
    writeResult(request.id, { tools });
    return;
  }
  if (method === 'tools/call') {
    const name = String(request.params?.name || '').trim();
    const args = request.params?.arguments && typeof request.params.arguments === 'object'
      ? request.params.arguments
      : {};
    if (!name) {
      writeError(request.id, -32602, 'Tool name is required');
      return;
    }
    try {
      const response = await requestGateway('POST', '/call', {
        name,
        arguments: args,
        callId: `mcp-${String(request.id)}`,
      });
      const result = response.result;
      const failed = !!result && typeof result === 'object' && 'ok' in result
        && (result as { ok?: unknown }).ok === false;
      writeResult(request.id, {
        content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
        structuredContent: result && typeof result === 'object' ? result : undefined,
        isError: failed,
      });
    } catch (error) {
      writeResult(request.id, {
        content: [{ type: 'text', text: (error as Error).message }],
        isError: true,
      });
    }
    return;
  }

  writeError(request.id, -32601, `Method not found: ${method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(trimmed) as JsonRpcRequest;
  } catch {
    writeError(null, -32700, 'Parse error');
    return;
  }
  void handleRequest(request).catch(error => {
    writeError(request.id, -32603, (error as Error).message || 'Internal error');
  });
});

input.on('close', () => {
  process.exit(0);
});
