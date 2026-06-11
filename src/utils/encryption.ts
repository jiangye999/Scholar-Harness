/**
 * 敏感信息加密工具
 * 使用 AES-256-GCM 加密算法保护存储的凭据
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const ITERATIONS = 100000; // PBKDF2 迭代次数

/**
 * 获取或创建加密密钥
 * 密钥存储在用户目录下的隐藏文件中
 */
function getOrCreateEncryptionKey(): Buffer {
  const keyDir = path.join(os.homedir(), '.scholar-harness');
  const keyFile = path.join(keyDir, '.enc_key');
  
  // 确保目录存在
  if (!fs.existsSync(keyDir)) {
    fs.mkdirSync(keyDir, { recursive: true, mode: 0o700 });
  }
  
  // 如果密钥文件存在，读取它
  if (fs.existsSync(keyFile)) {
    try {
      const keyData = fs.readFileSync(keyFile);
      if (keyData.length === KEY_LENGTH) {
        return keyData;
      }
    } catch (e) {
      // 读取失败，创建新密钥
    }
  }
  
  // 生成新密钥
  const newKey = crypto.randomBytes(KEY_LENGTH);
  
  // 写入文件，权限设置为仅所有者可读写
  fs.writeFileSync(keyFile, newKey, { mode: 0o600 });
  
  // Windows 上需要额外设置隐藏属性
  if (process.platform === 'win32') {
    try {
      // 使用 attrib 命令设置隐藏属性
      const { execSync } = require('child_process');
      execSync(`attrib +h "${keyFile}"`, { stdio: 'ignore' });
    } catch (e) {
      // 忽略错误，隐藏属性设置失败不影响安全性
    }
  }
  
  return newKey;
}

// 单例密钥
let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (!cachedKey) {
    cachedKey = getOrCreateEncryptionKey();
  }
  return cachedKey;
}

/**
 * 加密敏感数据
 * @param plaintext 明文
 * @returns 加密后的 Base64 字符串（包含 salt:iv:ciphertext:tag）
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return '';
  }
  
  const key = getEncryptionKey();
  const salt = crypto.randomBytes(SALT_LENGTH);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  // 使用 PBKDF2 派生密钥，增加安全性
  const derivedKey = crypto.pbkdf2Sync(key, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  
  const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  
  // 格式: salt:iv:ciphertext:tag (全部 Base64 编码)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    encrypted.toString('base64'),
    tag.toString('base64'),
  ].join(':');
}

/**
 * 解密敏感数据
 * @param ciphertext 加密的 Base64 字符串
 * @returns 解密后的明文
 */
export function decrypt(ciphertext: string): string {
  if (!ciphertext) {
    return '';
  }
  
  try {
    const parts = ciphertext.split(':');
    if (parts.length !== 4) {
      // 可能是旧格式（未加密）或无效格式
      // 为了向后兼容，如果看起来不是加密格式，返回原值
      if (!ciphertext.includes(':')) {
        return ciphertext;
      }
      throw new Error('Invalid ciphertext format');
    }
    
    const [saltB64, ivB64, encryptedB64, tagB64] = parts;
    
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const encrypted = Buffer.from(encryptedB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    
    const key = getEncryptionKey();
    const derivedKey = crypto.pbkdf2Sync(key, salt, ITERATIONS, KEY_LENGTH, 'sha256');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    // 解密失败，可能是未加密的旧数据
    // 为了向后兼容，返回原值
    return ciphertext;
  }
}

/**
 * 检查字符串是否已加密
 * @param text 要检查的字符串
 * @returns 是否为加密格式
 */
export function isEncrypted(text: string): boolean {
  if (!text) return false;
  const parts = text.split(':');
  if (parts.length !== 4) return false;
  
  try {
    // 检查每部分是否为有效的 Base64
    for (const part of parts) {
      Buffer.from(part, 'base64');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * 安全地比较字符串（防止时序攻击）
 * @param a 字符串 a
 * @param b 字符串 b
 * @returns 是否相等
 */
export function secureCompare(a: string, b: string): boolean {
  return crypto.timingSafeEqual(
    Buffer.from(a, 'utf8'),
    Buffer.from(b, 'utf8')
  );
}

/**
 * 生成安全的随机令牌
 * @param length 字节长度（默认 32）
 * @returns Base64 编码的随机令牌
 */
export function generateToken(length: number = 32): string {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * 计算字符串的哈希值
 * @param text 要哈希的文本
 * @returns SHA-256 哈希值（十六进制）
 */
export function hash(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}