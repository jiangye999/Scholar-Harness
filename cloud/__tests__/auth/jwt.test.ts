import { afterEach, describe, expect, it, vi } from 'vitest';

const JWT_ENV_KEYS = [
  'JWT_ACCESS_KEYRING',
  'JWT_KEYRING',
  'JWT_ACCESS_KEYS',
  'JWT_ACCESS_SECRET_CURRENT',
  'JWT_SECRET_CURRENT',
  'JWT_SECRET',
  'JWT_ACCESS_SECRET_PREVIOUS',
  'JWT_SECRET_PREVIOUS',
  'JWT_ACCESS_ACTIVE_KID',
  'JWT_ACTIVE_KID',
  'JWT_REFRESH_KEYRING',
  'JWT_REFRESH_KEYS',
  'JWT_REFRESH_SECRET_CURRENT',
  'JWT_REFRESH_SECRET',
  'JWT_REFRESH_SECRET_PREVIOUS',
  'JWT_REFRESH_ACTIVE_KID',
] as const;

const originalNodeEnv = process.env.NODE_ENV;
const originalJwtEnv = Object.fromEntries(
  JWT_ENV_KEYS.map(key => [key, process.env[key]])
);

function clearJwtEnvironment(): void {
  for (const key of JWT_ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  vi.resetModules();
  process.env.NODE_ENV = originalNodeEnv;
  for (const key of JWT_ENV_KEYS) {
    const value = originalJwtEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('JWT production configuration guard', () => {
  it('refuses to initialize with development defaults in production', async () => {
    clearJwtEnvironment();
    process.env.NODE_ENV = 'production';
    const { initializeJwtSecrets } = await import('../../auth/jwt');

    expect(() => initializeJwtSecrets()).toThrow(/JWT signing secrets are not configured/);
  });

  it('allows explicit access and refresh secrets in production', async () => {
    clearJwtEnvironment();
    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET_CURRENT = 'access-secret-for-production-test-123456';
    process.env.JWT_REFRESH_SECRET_CURRENT = 'refresh-secret-for-production-test-123456';
    const { getJwtKeyStatus, initializeJwtSecrets } = await import('../../auth/jwt');

    expect(() => initializeJwtSecrets()).not.toThrow();
    expect(getJwtKeyStatus()).toMatchObject({
      access: { keyCount: 1 },
      refresh: { keyCount: 1 },
    });
  });
});
