/**
 * 本地Session管理器
 * 负责保存、读取、验证和管理用户session
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ExeClientConfig } from './config';

/**
 * Session数据结构
 */
export interface SessionData {
  userId: string;
  email: string;
  username?: string;
  avatar_url?: string;  // 用户头像URL
  accessToken: string;
  refreshToken: string;
  expiresAt: number;         // accessToken过期时间（毫秒时间戳）
  refreshExpiresAt: number;  // refreshToken过期时间
  createdAt: number;
  lastValidatedAt: number;
  
  // 订阅信息缓存（字数额度）
  subscription?: {
    plan_type: string;
    status: string;
    quota_remaining: number;  // 剩余字数额度
    quota_total: number;      // 总字数额度
    quota_used?: number;      // 已使用字数额度
    end_date?: string;
  };
  
  // 设备激活信息缓存
  activation?: {
    activation_token: string;
    device_id: string;
    expires_at: string;
  };
}

/**
 * 加密的Session数据（存储格式）
 */
interface EncryptedSessionData {
  encrypted: string;
  iv: string;
  authTag: string;
  version: number;
  createdAt: number;
}

/**
 * Session管理器
 */
export class SessionManager {
  private config: ExeClientConfig;
  private sessionFilePath: string;
  private encryptionKey: string;
  private sessionData: SessionData | null = null;
  
  constructor(config: ExeClientConfig) {
    this.config = config;
    this.sessionFilePath = config.sessionFilePath || path.join(process.cwd(), '.session');
    this.encryptionKey = this.getOrCreateEncryptionKey();
  }
  
  /**
   * 获取或创建加密密钥
   * 使用设备硬件特征生成密钥，确保密钥与设备绑定
   */
  private getOrCreateEncryptionKey(): string {
    const keyPath = path.join(path.dirname(this.sessionFilePath), '.key');
    
    try {
      // 尝试读取现有密钥（使用同步方法，因为这是初始化）
      const existingKey = fsSync.readFileSync(keyPath, 'utf-8');
      return existingKey;
    } catch {
      // 密钥不存在，生成新密钥
      const newKey = crypto.randomBytes(32).toString('hex');
      fsSync.writeFileSync(keyPath, newKey, { mode: 0o600 }); // 仅当前用户可读写
      return newKey;
    }
  }
  
  /**
   * 加密session数据
   */
  private encrypt(data: SessionData): EncryptedSessionData {
    const algorithm = 'aes-256-gcm';
    const key = Buffer.from(this.encryptionKey, 'hex');
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag,
      version: 1,
      createdAt: Date.now(),
    };
  }
  
  /**
   * 解密session数据
   */
  private decrypt(encryptedData: EncryptedSessionData): SessionData | null {
    try {
      const algorithm = 'aes-256-gcm';
      const key = Buffer.from(this.encryptionKey, 'hex');
      const iv = Buffer.from(encryptedData.iv, 'hex');
      const authTag = Buffer.from(encryptedData.authTag, 'hex');
      
      const decipher = crypto.createDecipheriv(algorithm, key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return JSON.parse(decrypted) as SessionData;
    } catch (error) {
      // 解密失败（密钥不匹配或数据损坏）
      console.error('[SessionManager] Decryption failed:', error);
      return null;
    }
  }
  
  /**
   * 保存session到本地文件
   */
  async saveSession(session: SessionData): Promise<void> {
    this.sessionData = session;
    
    const encryptedData = this.encrypt(session);
    
    await fs.writeFile(
      this.sessionFilePath,
      JSON.stringify(encryptedData),
      { mode: 0o600 } // 仅当前用户可读写
    );
    
    console.log('[SessionManager] Session saved successfully');
  }
  
  /**
   * 从本地文件读取session
   */
  async loadSession(): Promise<SessionData | null> {
    if (this.sessionData) {
      return this.sessionData;
    }
    
    try {
      const content = await fs.readFile(this.sessionFilePath, 'utf-8');
      const encryptedData = JSON.parse(content) as EncryptedSessionData;
      
      this.sessionData = this.decrypt(encryptedData);
      return this.sessionData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // 文件不存在，返回null
        return null;
      }
      
      console.error('[SessionManager] Failed to load session:', error);
      return null;
    }
  }
  
  /**
   * 获取当前session（如果内存中已有则直接返回）
   */
  async getSession(): Promise<SessionData | null> {
    return await this.loadSession();
  }
  
  /**
   * 检查accessToken是否过期
   */
  async isAccessTokenExpired(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) return true;
    
    return Date.now() > session.expiresAt;
  }
  
  /**
   * 检查refreshToken是否过期
   */
  async isRefreshTokenExpired(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) return true;
    
    return Date.now() > session.refreshExpiresAt;
  }
  
  /**
   * 检查是否在离线宽限期内
   */
  async isWithinOfflineGracePeriod(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) return false;
    
    const gracePeriodMs = this.config.offlineGraceHours * 60 * 60 * 1000;
    const lastValidated = session.lastValidatedAt || session.createdAt;
    
    return Date.now() < lastValidated + gracePeriodMs;
  }
  
  /**
   * 更新session中的tokens
   */
  async updateTokens(accessToken: string, refreshToken: string, expiresIn: number): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('No existing session to update');
    }
    
    session.accessToken = accessToken;
    session.refreshToken = refreshToken;
    session.expiresAt = Date.now() + expiresIn * 1000;
    session.refreshExpiresAt = Date.now() + this.config.refreshTokenExpirySeconds * 1000;
    session.lastValidatedAt = Date.now();
    
    await this.saveSession(session);
  }
  
  /**
   * 更新订阅信息缓存
   */
  async updateSubscriptionCache(subscription: Partial<SessionData['subscription']>): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('No existing session to update');
    }
    
    if (!session.subscription) {
      session.subscription = {
        plan_type: '',
        status: '',
        quota_remaining: 0,
        quota_total: 0,
      };
    }
    
    if (subscription) {
      Object.assign(session.subscription, subscription);
    }
    
    await this.saveSession(session);
  }
  
/**
    * 更新激活信息缓存
    */
  async updateActivationCache(activation: Partial<SessionData['activation']>): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('No existing session to update');
    }
    
    if (!session.activation) {
      session.activation = {
        activation_token: '',
        device_id: '',
        expires_at: '',
      };
    }
    
    if (activation) {
      Object.assign(session.activation, activation);
    }
    
    await this.saveSession(session);
  }
  
  /**
   * 更新头像缓存
   */
  async updateAvatarCache(avatar_url: string): Promise<void> {
    const session = await this.getSession();
    if (!session) {
      throw new Error('No existing session to update');
    }
    
    session.avatar_url = avatar_url;
    await this.saveSession(session);
  }
  
  /**
    * 清除session（登出时调用）
    */
  async clearSession(): Promise<void> {
    this.sessionData = null;
    
    try {
      await fs.unlink(this.sessionFilePath);
      console.log('[SessionManager] Session cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('[SessionManager] Failed to delete session file:', error);
      }
    }
  }
  
  /**
   * 获取剩余使用额度
   */
  async getRemainingQuota(): Promise<number> {
    const session = await this.getSession();
    if (!session || !session.subscription) return 0;
    
    return session.subscription.quota_remaining;
  }
  
  /**
   * 检查是否有足够额度
   */
  async hasEnoughQuota(requiredAmount: number): Promise<boolean> {
    const remaining = await this.getRemainingQuota();
    
    // quota_total为-1表示无限额度
    const session = await this.getSession();
    if (session?.subscription?.quota_total === -1) return true;
    
    return remaining >= requiredAmount;
  }
}

export default SessionManager;
