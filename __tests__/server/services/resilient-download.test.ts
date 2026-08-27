import * as fs from 'fs/promises';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  downloadFileWithRetry,
  requestJsonWithRetry,
} from '../../../src/server/services/resilient-download';

describe('resilient plugin downloads', () => {
  let root = '';
  let server: http.Server | null = null;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-download-'));
  });

  afterEach(async () => {
    await new Promise<void>(resolve => server?.close(() => resolve()) || resolve());
    server = null;
    await fs.rm(root, { recursive: true, force: true });
  });

  async function listen(handler: http.RequestListener): Promise<string> {
    server = http.createServer(handler);
    await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    return `http://127.0.0.1:${address.port}`;
  }

  it('retries a reset connection and atomically publishes the completed file', async () => {
    let requests = 0;
    const baseUrl = await listen((_req, response) => {
      requests += 1;
      if (requests === 1) {
        response.socket?.destroy();
        return;
      }
      response.writeHead(200, { 'content-length': '11' });
      response.end('hello world');
    });
    const destination = path.join(root, 'officecli.exe');

    await downloadFileWithRetry({
      url: `${baseUrl}/asset`,
      destination,
      label: 'test asset',
      maxAttempts: 2,
      timeoutMs: 5_000,
    });

    expect(requests).toBe(2);
    expect(await fs.readFile(destination, 'utf-8')).toBe('hello world');
    await expect(fs.access(`${destination}.part`)).rejects.toThrow();
  });

  it('resumes an existing partial download with an HTTP range request', async () => {
    let range = '';
    const baseUrl = await listen((request, response) => {
      range = String(request.headers.range || '');
      response.writeHead(206, {
        'content-length': '5',
        'content-range': 'bytes 6-10/11',
      });
      response.end('world');
    });
    const destination = path.join(root, 'R-release-win.exe');
    await fs.writeFile(`${destination}.part`, 'hello ', 'utf-8');

    await downloadFileWithRetry({
      url: `${baseUrl}/asset`,
      destination,
      label: 'test asset',
      maxAttempts: 1,
      timeoutMs: 5_000,
    });

    expect(range).toBe('bytes=6-');
    expect(await fs.readFile(destination, 'utf-8')).toBe('hello world');
  });

  it('retries transient metadata responses', async () => {
    let requests = 0;
    const baseUrl = await listen((_request, response) => {
      requests += 1;
      if (requests === 1) {
        response.writeHead(503);
        response.end('busy');
        return;
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ version: '1.0.145' }));
    });

    const result = await requestJsonWithRetry<{ version: string }>(`${baseUrl}/latest`, {
      label: 'metadata',
      maxAttempts: 2,
      timeoutMs: 5_000,
    });

    expect(requests).toBe(2);
    expect(result.version).toBe('1.0.145');
  });
});
