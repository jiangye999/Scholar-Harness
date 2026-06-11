import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

export interface CloudPromptPayload {
  id: string;
  name?: string;
  category?: string;
  content: string;
  version: number;
  language?: string;
  hash?: string;
  lastUpdated?: string;
  source?: 'cloud' | 'cache';
}

export interface CloudPromptBundle {
  bundleId: string;
  version: number;
  prompts: CloudPromptPayload[];
  missingIds?: string[];
  cacheExpiry?: string;
  staleUntil?: string;
  source?: 'cloud' | 'cache';
}

export interface PromptClient {
  getSkill(skillId: string): Promise<CloudPromptPayload>;
  getCorePrompt?(promptId: string): Promise<CloudPromptPayload>;
  getBundle?(bundleId: string, promptIds?: string[]): Promise<CloudPromptBundle>;
}

interface CloudPromptClientOptions {
  cloudApiUrl: string;
  cacheDir: string;
  getAccessToken: () => Promise<string | null>;
  getCacheKeyMaterial: () => Promise<string>;
  enabled?: boolean;
  cacheTtlMs?: number;
  staleCacheTtlMs?: number;
  strict?: boolean;
}

interface CacheEnvelope {
  version: 1;
  id: string;
  kind: 'prompt' | 'bundle';
  hash: string;
  cachedAt: number;
  expiresAt: number;
  staleUntil: number;
  iv: string;
  tag: string;
  encrypted: string;
}

const DEFAULT_CACHE_TTL_MS = 48 * 60 * 60 * 1000;
const DEFAULT_STALE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class CloudPromptClient implements PromptClient {
  private cloudApiUrl: string;
  private cacheDir: string;
  private getAccessToken: () => Promise<string | null>;
  private getCacheKeyMaterial: () => Promise<string>;
  private enabled: boolean;
  private cacheTtlMs: number;
  private staleCacheTtlMs: number;
  private strict: boolean;

  constructor(options: CloudPromptClientOptions) {
    this.cloudApiUrl = normalizeCloudApiUrl(options.cloudApiUrl);
    this.cacheDir = options.cacheDir;
    this.getAccessToken = options.getAccessToken;
    this.getCacheKeyMaterial = options.getCacheKeyMaterial;
    this.enabled = options.enabled !== false;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.staleCacheTtlMs = options.staleCacheTtlMs ?? DEFAULT_STALE_CACHE_TTL_MS;
    this.strict = options.strict === true;
  }

  async getSkill(skillId: string): Promise<CloudPromptPayload> {
    return this.getPromptByPath(`skills/${encodeURIComponent(skillId)}`, `skill:${skillId}`);
  }

  async getCorePrompt(promptId: string): Promise<CloudPromptPayload> {
    return this.getPromptByPath(`core/${encodeURIComponent(promptId)}`, `core:${promptId}`);
  }

  async getBundle(bundleId: string, promptIds?: string[]): Promise<CloudPromptBundle> {
    const cacheId = `bundle:${bundleId}:${hashText((promptIds || []).join('|'))}`;
    const cached = await this.readCache<CloudPromptBundle>(cacheId, 'bundle');
    if (cached && cached.fresh) {
      return { ...cached.value, source: 'cache' };
    }

    try {
      this.ensureEnabled();
      const token = await this.requireAccessToken();
      const body = promptIds && promptIds.length > 0 ? { promptIds } : {};
      const data = await this.fetchJson<CloudPromptBundle>(`bundles/${encodeURIComponent(bundleId)}`, token, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      const normalized: CloudPromptBundle = {
        ...data,
        bundleId: data.bundleId || bundleId,
        version: data.version || maxPromptVersion(data.prompts || []),
        prompts: (data.prompts || []).map(prompt => ({ ...prompt, source: 'cloud' })),
        source: 'cloud',
      };
      await this.writeCache(cacheId, 'bundle', normalized, normalized.cacheExpiry, normalized.staleUntil);
      return normalized;
    } catch (error) {
      const stale = await this.readCache<CloudPromptBundle>(cacheId, 'bundle', true);
      if (stale) {
        logger.warn(`[CloudPromptClient] Using stale cached bundle ${bundleId}: ${(error as Error).message}`);
        return { ...stale.value, source: 'cache' };
      }
      throw error;
    }
  }

  private async getPromptByPath(route: string, cacheId: string): Promise<CloudPromptPayload> {
    const cached = await this.readCache<CloudPromptPayload>(cacheId, 'prompt');
    if (cached && cached.fresh) {
      return { ...cached.value, source: 'cache' };
    }

    try {
      this.ensureEnabled();
      const token = await this.requireAccessToken();
      const data = await this.fetchJson<CloudPromptPayload>(route, token);
      const normalized = { ...data, source: 'cloud' as const };
      this.verifyHash(normalized);
      await this.writeCache(cacheId, 'prompt', normalized);
      return normalized;
    } catch (error) {
      const stale = await this.readCache<CloudPromptPayload>(cacheId, 'prompt', true);
      if (stale) {
        logger.warn(`[CloudPromptClient] Using stale cached prompt ${cacheId}: ${(error as Error).message}`);
        return { ...stale.value, source: 'cache' };
      }
      throw error;
    }
  }

  private async fetchJson<T>(
    route: string,
    token: string,
    init?: { method?: string; body?: string }
  ): Promise<T> {
    const response = await fetch(`${this.cloudApiUrl}/prompts/${route}`, {
      method: init?.method || 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Client-Source': 'exe',
      },
      body: init?.body,
    });

    if (!response.ok) {
      let detail = '';
      try {
        detail = JSON.stringify(await response.json());
      } catch {
        detail = await response.text().catch(() => '');
      }
      throw new Error(`Cloud prompt request failed (${response.status}): ${detail || response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  private ensureEnabled(): void {
    if (!this.enabled) {
      throw new Error('Cloud prompt client disabled');
    }
  }

  private async requireAccessToken(): Promise<string> {
    const token = await this.getAccessToken();
    if (!token) {
      throw new Error('No cloud access token available');
    }
    return token;
  }

  private verifyHash(prompt: CloudPromptPayload): void {
    if (!prompt.hash) return;
    const actual = hashText(prompt.content);
    if (actual !== prompt.hash) {
      throw new Error(`Cloud prompt hash mismatch: ${prompt.id}`);
    }
  }

  private async getCacheKey(): Promise<Buffer> {
    const material = await this.getCacheKeyMaterial();
    return crypto
      .createHash('sha256')
      .update(`${material}:${this.cloudApiUrl}:scholar-harness-cloud-prompts-v1`)
      .digest();
  }

  private async readCache<T>(
    id: string,
    kind: CacheEnvelope['kind'],
    allowStale = false
  ): Promise<{ value: T; fresh: boolean } | null> {
    try {
      const cachePath = this.cachePath(id);
      const envelope = JSON.parse(await fs.readFile(cachePath, 'utf-8')) as CacheEnvelope;
      if (envelope.kind !== kind) return null;

      const now = Date.now();
      const fresh = now <= envelope.expiresAt;
      const usable = fresh || (allowStale && now <= envelope.staleUntil && !this.strict);
      if (!usable) return null;

      const key = await this.getCacheKey();
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'hex'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
      let plaintext = decipher.update(envelope.encrypted, 'hex', 'utf8');
      plaintext += decipher.final('utf8');
      const actualHash = hashText(plaintext);
      if (actualHash !== envelope.hash) {
        logger.warn(`[CloudPromptClient] Cache integrity mismatch: ${id}`);
        return null;
      }
      return { value: JSON.parse(plaintext) as T, fresh };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[CloudPromptClient] Failed to read cache ${id}: ${(error as Error).message}`);
      }
      return null;
    }
  }

  private async writeCache<T>(
    id: string,
    kind: CacheEnvelope['kind'],
    value: T,
    cacheExpiry?: string,
    staleUntil?: string
  ): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const plaintext = JSON.stringify(value);
      const key = await this.getCacheKey();
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(plaintext, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      const now = Date.now();
      const expiresAt = parseDateMs(cacheExpiry) ?? now + this.cacheTtlMs;
      const staleUntilMs = parseDateMs(staleUntil) ?? Math.max(expiresAt, now + this.staleCacheTtlMs);
      const envelope: CacheEnvelope = {
        version: 1,
        id,
        kind,
        hash: hashText(plaintext),
        cachedAt: now,
        expiresAt,
        staleUntil: staleUntilMs,
        iv: iv.toString('hex'),
        tag: cipher.getAuthTag().toString('hex'),
        encrypted,
      };
      await fs.writeFile(this.cachePath(id), JSON.stringify(envelope), 'utf-8');
    } catch (error) {
      logger.warn(`[CloudPromptClient] Failed to write cache ${id}: ${(error as Error).message}`);
    }
  }

  private cachePath(id: string): string {
    return path.join(this.cacheDir, `${safeCacheName(id)}.json`);
  }
}

export function normalizeCloudApiUrl(url: string): string {
  return String(url || 'https://scholarharness.com/api/v1').replace(/\/+$/, '');
}

function safeCacheName(id: string): string {
  return crypto.createHash('sha256').update(id).digest('hex');
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseDateMs(value?: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maxPromptVersion(prompts: CloudPromptPayload[]): number {
  return prompts.reduce((max, prompt) => Math.max(max, Number(prompt.version) || 0), 1);
}

export default CloudPromptClient;
