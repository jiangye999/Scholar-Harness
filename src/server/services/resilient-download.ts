import { createWriteStream } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import axios from 'axios';

export interface DownloadProgress {
  attempt: number;
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  resumed: boolean;
}

export interface ResilientDownloadOptions {
  url: string;
  destination: string;
  label: string;
  headers?: Record<string, string>;
  maxAttempts?: number;
  timeoutMs?: number;
  onProgress?: (progress: DownloadProgress) => void;
  onRetry?: (attempt: number, maxAttempts: number, error: Error) => void;
}

export interface ResilientRequestOptions {
  label: string;
  headers?: Record<string, string>;
  maxAttempts?: number;
  timeoutMs?: number;
}

const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EAI_AGAIN',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
]);

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error || '未知下载错误'));
}

function isRetryable(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = Number(error.response?.status || 0);
    if ([403, 408, 425, 429].includes(status) || status >= 500) return true;
    if (TRANSIENT_NETWORK_CODES.has(String(error.code || '').toUpperCase())) return true;
  }
  const code = String((error as NodeJS.ErrnoException | undefined)?.code || '').toUpperCase();
  return TRANSIENT_NETWORK_CODES.has(code)
    || /socket hang up|network|timed?\s*out|connection.*reset/i.test(asError(error).message);
}

function wait(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

async function partialFileSize(filePath: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

function contentRangeTotal(value: unknown): number {
  const match = /\/([0-9]+)$/.exec(String(value || ''));
  return match ? Number(match[1]) : 0;
}

function retryDelayMs(attempt: number): number {
  return Math.min(8_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export async function requestJsonWithRetry<T>(
  url: string,
  options: ResilientRequestOptions,
): Promise<T> {
  const attempts = Math.max(1, options.maxAttempts ?? 4);
  let lastError: Error = new Error(`${options.label}请求失败`);
  let attempted = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attempted = attempt;
    try {
      const response = await axios.get<T>(url, {
        headers: options.headers,
        maxRedirects: 5,
        timeout: options.timeoutMs ?? 30_000,
      });
      return response.data;
    } catch (error) {
      lastError = asError(error);
      if (attempt >= attempts || !isRetryable(error)) break;
      await wait(retryDelayMs(attempt));
    }
  }
  throw new Error(`${options.label}失败（已尝试 ${attempted} 次）：${lastError.message}`);
}

export async function requestTextWithRetry(
  url: string,
  options: ResilientRequestOptions,
): Promise<string> {
  const attempts = Math.max(1, options.maxAttempts ?? 4);
  let lastError: Error = new Error(`${options.label}请求失败`);
  let attempted = 0;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    attempted = attempt;
    try {
      const response = await axios.get<string>(url, {
        headers: options.headers,
        maxRedirects: 5,
        responseType: 'text',
        timeout: options.timeoutMs ?? 30_000,
      });
      return String(response.data || '');
    } catch (error) {
      lastError = asError(error);
      if (attempt >= attempts || !isRetryable(error)) break;
      await wait(retryDelayMs(attempt));
    }
  }
  throw new Error(`${options.label}失败（已尝试 ${attempted} 次）：${lastError.message}`);
}

export async function downloadFileWithRetry(options: ResilientDownloadOptions): Promise<void> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 4);
  const partialPath = `${options.destination}.part`;
  await fs.mkdir(path.dirname(options.destination), { recursive: true });
  let lastError: Error = new Error(`${options.label}下载失败`);
  let attempted = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempted = attempt;
    try {
      let resumedBytes = await partialFileSize(partialPath);
      const headers = { ...options.headers };
      if (resumedBytes > 0) headers.Range = `bytes=${resumedBytes}-`;
      const response = await axios.get<NodeJS.ReadableStream>(options.url, {
        headers,
        maxRedirects: 5,
        responseType: 'stream',
        timeout: options.timeoutMs ?? 120_000,
        validateStatus: status => (status >= 200 && status < 300) || status === 416,
      });

      if (response.status === 416) {
        await fs.rm(partialPath, { force: true });
        const rangeError = new Error(`${options.label}断点位置已失效，将重新下载`);
        (rangeError as NodeJS.ErrnoException).code = 'ECONNRESET';
        throw rangeError;
      }

      const resumed = resumedBytes > 0 && response.status === 206;
      if (!resumed) resumedBytes = 0;
      const responseBytes = Number(response.headers['content-length'] || 0);
      const totalBytes = contentRangeTotal(response.headers['content-range'])
        || (responseBytes > 0 ? resumedBytes + responseBytes : 0);
      let downloadedBytes = resumedBytes;
      const stream = response.data as Readable;
      stream.on('data', chunk => {
        downloadedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        options.onProgress?.({
          attempt,
          downloadedBytes,
          totalBytes,
          percent: totalBytes > 0 ? Math.min(100, Math.round(downloadedBytes / totalBytes * 100)) : 0,
          resumed,
        });
      });
      await pipeline(stream, createWriteStream(partialPath, { flags: resumed ? 'a' : 'w' }));

      const completedBytes = await partialFileSize(partialPath);
      if (totalBytes > 0 && completedBytes !== totalBytes) {
        const incompleteError = new Error(
          `${options.label}下载不完整：${completedBytes}/${totalBytes} bytes`,
        );
        (incompleteError as NodeJS.ErrnoException).code = 'ECONNRESET';
        throw incompleteError;
      }
      await fs.rm(options.destination, { force: true });
      await fs.rename(partialPath, options.destination);
      return;
    } catch (error) {
      lastError = asError(error);
      if (attempt >= maxAttempts || !isRetryable(error)) break;
      options.onRetry?.(attempt + 1, maxAttempts, lastError);
      await wait(retryDelayMs(attempt));
    }
  }

  throw new Error(`${options.label}失败（已尝试 ${attempted} 次）：${lastError.message}`);
}
