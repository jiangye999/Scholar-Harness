import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

const SALT_LENGTH = 16;
const HASH_ITERATIONS = 100000;
const HASH_KEY_LENGTH = 64;
const HASH_ALGORITHM = 'sha512';
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$/;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      HASH_ITERATIONS,
      HASH_KEY_LENGTH,
      HASH_ALGORITHM,
      (err, derivedKey) => {
        if (err) reject(err);
        resolve(`${salt}:${derivedKey.toString('hex')}`);
      }
    );
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) {
    return false;
  }

  if (BCRYPT_HASH_PATTERN.test(storedHash)) {
    return bcrypt.compare(password, storedHash);
  }

  const [salt, hash] = storedHash.split(':');
  
  if (!salt || !hash) {
    return false;
  }

  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      HASH_ITERATIONS,
      HASH_KEY_LENGTH,
      HASH_ALGORITHM,
      (err, derivedKey) => {
        if (err) reject(err);
        resolve(derivedKey.toString('hex') === hash);
      }
    );
  });
}

export function generateRandomToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

export function generateReferralCode(): string {
  // 使用排除容易混淆字符的字符集 (排除 I, L, O, 0, 1)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  
  // 使用 crypto.randomBytes 生成安全的随机数
  const randomBytes = crypto.randomBytes(8);
  let code = '';
  
  for (let i = 0; i < 8; i++) {
    // 使用每个字节映射到字符集
    const index = randomBytes[i] % chars.length;
    code += chars.charAt(index);
  }
  
  return code;
}

export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function generateDeviceHash(deviceId: string, deviceName?: string, deviceOs?: string): string {
  const data = `${deviceId}:${deviceName || ''}:${deviceOs || ''}`;
  return hashString(data);
}

/**
 * 生成内测码 - 使用更安全的随机数和更长的长度
 * 格式: BETA-XXXXXXXXXXXX (前缀 + 12位大写字母数字)
 * 熵值: 32^12 ≈ 1.15 × 10^18，足够防止暴力枚举
 */
export function generateBetaCode(): string {
  // 使用排除容易混淆字符的字符集 (排除 I, L, O, 0, 1)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const prefix = 'BETA-';
  
  // 使用 crypto.randomBytes 生成安全的随机数
  const randomBytes = crypto.randomBytes(12);
  let codeBody = '';
  
  for (let i = 0; i < 12; i++) {
    // 使用每个字节映射到字符集
    const index = randomBytes[i] % chars.length;
    codeBody += chars.charAt(index);
  }
  
  return prefix + codeBody;
}
