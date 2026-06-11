import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  source: 'cloud' | 'exe';
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const ACCESS_TOKEN_EXPIRY = 15 * 60; // 15 minutes in seconds
const REFRESH_TOKEN_EXPIRY = 7 * 24 * 60 * 60; // 7 days in seconds
const DEFAULT_ACCESS_SECRET = 'your-super-secret-key-change-in-production';
const DEFAULT_REFRESH_SECRET = 'your-refresh-secret-key-change-in-production';

type JwtSigningKey = {
  kid: string;
  secret: string;
};

type JwtKeyRing = {
  active: JwtSigningKey;
  keys: JwtSigningKey[];
};

let accessKeyRing: JwtKeyRing | null = null;
let refreshKeyRing: JwtKeyRing | null = null;

export function initializeJwtSecrets(): void {
  accessKeyRing = loadKeyRing({
    kind: 'access',
    jsonEnv: process.env.JWT_ACCESS_KEYRING || process.env.JWT_KEYRING,
    listEnv: process.env.JWT_ACCESS_KEYS,
    currentSecret: process.env.JWT_ACCESS_SECRET_CURRENT || process.env.JWT_SECRET_CURRENT || process.env.JWT_SECRET,
    previousSecret: process.env.JWT_ACCESS_SECRET_PREVIOUS || process.env.JWT_SECRET_PREVIOUS,
    activeKid: process.env.JWT_ACCESS_ACTIVE_KID || process.env.JWT_ACTIVE_KID,
    fallbackSecret: DEFAULT_ACCESS_SECRET,
  });
  refreshKeyRing = loadKeyRing({
    kind: 'refresh',
    jsonEnv: process.env.JWT_REFRESH_KEYRING,
    listEnv: process.env.JWT_REFRESH_KEYS,
    currentSecret: process.env.JWT_REFRESH_SECRET_CURRENT || process.env.JWT_REFRESH_SECRET,
    previousSecret: process.env.JWT_REFRESH_SECRET_PREVIOUS,
    activeKid: process.env.JWT_REFRESH_ACTIVE_KID,
    fallbackSecret: DEFAULT_REFRESH_SECRET,
  });

  if (
    accessKeyRing.active.secret === DEFAULT_ACCESS_SECRET ||
    refreshKeyRing.active.secret === DEFAULT_REFRESH_SECRET
  ) {
    logger.warn('[JWT] JWT secrets not fully configured; using development defaults');
  }

  logger.info(`[JWT] Key rings initialized: access=${accessKeyRing.keys.length}, refresh=${refreshKeyRing.keys.length}`);
}

function loadKeyRing(input: {
  kind: 'access' | 'refresh';
  jsonEnv?: string;
  listEnv?: string;
  currentSecret?: string;
  previousSecret?: string;
  activeKid?: string;
  fallbackSecret: string;
}): JwtKeyRing {
  const keys: JwtSigningKey[] = [];

  keys.push(...parseJsonKeyRing(input.jsonEnv));
  keys.push(...parseListKeyRing(input.listEnv));

  if (input.currentSecret) {
    keys.push({
      kid: input.activeKid || `${input.kind}-${shortHash(input.currentSecret)}`,
      secret: input.currentSecret,
    });
  }

  if (input.previousSecret) {
    keys.push({
      kid: `${input.kind}-previous-${shortHash(input.previousSecret)}`,
      secret: input.previousSecret,
    });
  }

  if (keys.length === 0) {
    keys.push({ kid: `${input.kind}-dev`, secret: input.fallbackSecret });
  }

  const deduped = dedupeKeys(keys);
  const active = input.activeKid
    ? deduped.find(key => key.kid === input.activeKid) || deduped[0]
    : deduped[0];

  if (!active) {
    throw new Error(`No ${input.kind} JWT signing key configured`);
  }

  return { active, keys: deduped };
}

function parseJsonKeyRing(raw?: string): JwtSigningKey[] {
  if (!raw || !raw.trim()) return [];
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return [];

  try {
    const parsed = JSON.parse(trimmed) as Array<{ kid?: unknown; secret?: unknown; active?: unknown }>;
    const activeFirst = parsed.sort((a, b) => Number(Boolean(b.active)) - Number(Boolean(a.active)));
    return activeFirst
      .filter(item => typeof item.kid === 'string' && typeof item.secret === 'string')
      .map(item => ({ kid: String(item.kid), secret: String(item.secret) }));
  } catch (error) {
    logger.warn('[JWT] Failed to parse JSON keyring:', (error as Error).message);
    return [];
  }
}

function parseListKeyRing(raw?: string): JwtSigningKey[] {
  if (!raw || !raw.trim()) return [];
  return raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const separator = item.includes('=') ? '=' : ':';
      const index = item.indexOf(separator);
      if (index <= 0) return null;
      const kid = item.slice(0, index).trim();
      const secret = item.slice(index + 1).trim();
      return kid && secret ? { kid, secret } : null;
    })
    .filter((item): item is JwtSigningKey => Boolean(item));
}

function dedupeKeys(keys: JwtSigningKey[]): JwtSigningKey[] {
  const seenKids = new Set<string>();
  const result: JwtSigningKey[] = [];
  for (const key of keys) {
    if (!key.kid || !key.secret || seenKids.has(key.kid)) continue;
    seenKids.add(key.kid);
    result.push(key);
  }
  return result;
}

function shortHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 10);
}

function getAccessKeyRing(): JwtKeyRing {
  if (!accessKeyRing) initializeJwtSecrets();
  return accessKeyRing!;
}

function getRefreshKeyRing(): JwtKeyRing {
  if (!refreshKeyRing) initializeJwtSecrets();
  return refreshKeyRing!;
}

function base64UrlEncode(data: string): string {
  return Buffer.from(data)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) {
    str += '=';
  }
  return Buffer.from(str, 'base64').toString('utf-8');
}

function createSignature(data: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function decodeHeader(header: string): { kid?: string; alg?: string } {
  try {
    return JSON.parse(base64UrlDecode(header));
  } catch {
    return {};
  }
}

function findVerificationKeys(header: string, keyRing: JwtKeyRing): JwtSigningKey[] {
  const decodedHeader = decodeHeader(header);
  if (decodedHeader.kid) {
    const byKid = keyRing.keys.find(key => key.kid === decodedHeader.kid);
    if (byKid) return [byKid];
  }
  return keyRing.keys;
}

export function generateAccessToken(payload: JWTPayload): string {
  const keyRing = getAccessKeyRing();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: keyRing.active.kid }));
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    ...payload,
    iat: now,
    exp: now + ACCESS_TOKEN_EXPIRY,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = createSignature(`${header}.${encodedPayload}`, keyRing.active.secret);
  
  return `${header}.${encodedPayload}.${signature}`;
}

export function generateRefreshToken(payload: JWTPayload): string {
  const keyRing = getRefreshKeyRing();
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: keyRing.active.kid }));
  const now = Math.floor(Date.now() / 1000);
  const tokenPayload = {
    userId: payload.userId,
    email: payload.email,
    iat: now,
    exp: now + REFRESH_TOKEN_EXPIRY,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(tokenPayload));
  const signature = createSignature(`${header}.${encodedPayload}`, keyRing.active.secret);
  
  return `${header}.${encodedPayload}.${signature}`;
}

export function generateTokenPair(payload: JWTPayload): TokenPair {
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
    expiresIn: ACCESS_TOKEN_EXPIRY,
  };
}

export function getJwtKeyStatus(): {
  access: { activeKid: string; keyCount: number };
  refresh: { activeKid: string; keyCount: number };
} {
  const access = getAccessKeyRing();
  const refresh = getRefreshKeyRing();
  return {
    access: {
      activeKid: access.active.kid,
      keyCount: access.keys.length,
    },
    refresh: {
      activeKid: refresh.active.kid,
      keyCount: refresh.keys.length,
    },
  };
}

export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, payload, signature] = parts;
    const keyRing = getAccessKeyRing();
    const valid = findVerificationKeys(header, keyRing)
      .some(key => signaturesMatch(signature, createSignature(`${header}.${payload}`, key.secret)));

    if (!valid) {
      logger.warn('[JWT] Invalid access token signature');
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);
    
    if (decoded.exp && decoded.exp < now) {
      logger.warn('[JWT] Access token expired');
      return null;
    }

    return decoded as JWTPayload;
  } catch (error) {
    logger.error('[JWT] Access token verification failed:', error);
    return null;
  }
}

export function verifyRefreshToken(token: string): { userId: string; email: string } | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [header, payload, signature] = parts;
    const keyRing = getRefreshKeyRing();
    const valid = findVerificationKeys(header, keyRing)
      .some(key => signaturesMatch(signature, createSignature(`${header}.${payload}`, key.secret)));

    if (!valid) {
      logger.warn('[JWT] Invalid refresh token signature');
      return null;
    }

    const decoded = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);
    
    if (decoded.exp && decoded.exp < now) {
      logger.warn('[JWT] Refresh token expired');
      return null;
    }

    return {
      userId: decoded.userId,
      email: decoded.email,
    };
  } catch (error) {
    logger.error('[JWT] Refresh token verification failed:', error);
    return null;
  }
}

export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return null;
  }

  return parts[1];
}
