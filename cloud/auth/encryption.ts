import * as crypto from 'crypto';
import { logger } from '../utils/logger';

const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY || 'your-32-character-encryption-k';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export class ApiKeyEncryption {
  private key: Buffer;

  constructor(encryptionKey?: string) {
    const key = encryptionKey || ENCRYPTION_KEY;
    this.key = crypto.createHash('sha256').update(key).digest();
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    
    let encrypted = cipher.update(plaintext, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    const combined = Buffer.concat([
      iv,
      authTag,
      Buffer.from(encrypted, 'base64'),
    ]);
    
    return combined.toString('base64');
  }

  decrypt(encryptedData: string): string {
    try {
      const combined = Buffer.from(encryptedData, 'base64');
      
      const iv = combined.subarray(0, IV_LENGTH);
      const authTag = combined.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const encrypted = combined.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
      
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      logger.error('[ApiKeyEncryption] Decrypt failed:', error);
      throw new Error('Failed to decrypt API key');
    }
  }

  maskApiKey(apiKey: string): string {
    if (apiKey.length <= 8) {
      return '****';
    }
    return `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
  }

  validateApiKeyFormat(apiKey: string, provider: string): boolean {
    const patterns: Record<string, RegExp> = {
      openai: /^sk-[A-Za-z0-9]{20,}$/,
      claude: /^sk-ant-[A-Za-z0-9-]{20,}$/,
      qwen: /^sk-[A-Za-z0-9]{20,}$/,
      deepseek: /^sk-[A-Za-z0-9]{20,}$/,
      generic: /^[A-Za-z0-9_-]{20,}$/,
    };

    const pattern = patterns[provider.toLowerCase()] || patterns.generic;
    return pattern.test(apiKey);
  }
}

export const apiKeyEncryption = new ApiKeyEncryption();
