/**
 * Prompt 加密模块
 * 使用 AES-256-CBC 加密存储敏感 Prompt 内容
 */

import * as crypto from 'crypto';

// 加密密钥（32 bytes for AES-256）
// 生产环境应从环境变量加载
const PROMPT_ENCRYPTION_KEY = process.env.PROMPT_ENCRYPTION_KEY 
  || 'default-dev-key-do-not-use-in-production-32b!';

/**
 * 加密 Prompt 内容
 * @param content 原始内容
 * @returns 加密后的内容（格式：iv:encrypted）
 */
export function encryptPrompt(content: string): string {
  // 确保 key 为 32 bytes
  const key = crypto.createHash('sha256').update(PROMPT_ENCRYPTION_KEY).digest();
  
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(content, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * 解密 Prompt 内容
 * @param encryptedContent 加密内容（格式：iv:encrypted）
 * @returns 解密后的原始内容
 */
export function decryptPrompt(encryptedContent: string): string {
  const [ivHex, encrypted] = encryptedContent.split(':');
  
  if (!ivHex || !encrypted) {
    throw new Error('Invalid encrypted content format');
  }
  
  const key = crypto.createHash('sha256').update(PROMPT_ENCRYPTION_KEY).digest();
  const iv = Buffer.from(ivHex, 'hex');
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * 计算 Prompt 内容哈希（用于完整性验证）
 * @param content 原始内容
 * @returns SHA-256 哈希值
 */
export function hashPrompt(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * 验证内容完整性
 * @param content 原始内容
 * @param expectedHash 预期哈希值
 * @returns 是否匹配
 */
export function verifyPromptIntegrity(content: string, expectedHash: string): boolean {
  const actualHash = hashPrompt(content);
  return actualHash === expectedHash;
}

/**
 * 从设备 ID 派生本地缓存加密密钥
 * @param deviceId 设备唯一标识
 * @returns AES-256 密钥（32 bytes）
 */
export function deriveCacheKey(deviceId: string): Buffer {
  const salt = 'scholar-harness-prompt-cache-v1';
  return crypto.createHash('sha256')
    .update(deviceId + salt)
    .digest()
    .slice(0, 32);
}

/**
 * 加密本地缓存数据
 * @param data 数据内容
 * @param deviceId 设备 ID
 * @returns 加密后的 Buffer（格式：iv + encrypted）
 */
export function encryptCacheData(data: string, deviceId: string): Buffer {
  const key = deriveCacheKey(deviceId);
  const iv = crypto.randomBytes(16);
  
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  
  let encrypted = cipher.update(data, 'utf8');
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return Buffer.concat([iv, encrypted]);
}

/**
 * 解密本地缓存数据
 * @param encryptedData 加密数据（格式：iv + encrypted）
 * @param deviceId 设备 ID
 * @returns 解密后的原始内容
 */
export function decryptCacheData(encryptedData: Buffer, deviceId: string): string {
  const key = deriveCacheKey(deviceId);
  
  const iv = encryptedData.slice(0, 16);
  const encrypted = encryptedData.slice(16);
  
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  
  return decrypted.toString('utf8');
}

export default {
  encryptPrompt,
  decryptPrompt,
  hashPrompt,
  verifyPromptIntegrity,
  encryptCacheData,
  decryptCacheData,
};