/**
 * 本地服务器认证守卫
 * 负责验证 session、转发登录请求到云端并检查订阅有效期
 * 
 * v2: 完整移植 exe/session-manager.ts 的加密/解密逻辑
 * 使开发模式也能正常保存和读取云端账号session
 */

import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * Session数据结构（从exe/session-manager.ts同步）
 */
export interface SessionData {
  userId: string;
  email: string;
  username?: string;
  avatar_url?: string;         // 用户头像URL
  referral_code?: string;      // 用户邀请码
  accessToken: string;
  refreshToken: string;
  expiresAt: number;         // accessToken过期时间（毫秒时间戳）
  refreshExpiresAt: number;  // refreshToken过期时间
  createdAt: number;
  lastValidatedAt: number;
  
  // 订阅信息缓存
  subscription?: {
    plan_type: string;
    status: string;
    /** @deprecated 仅用于读取旧 session；套餐不再按字符额度授权。 */
    quota_remaining?: number;
    /** @deprecated 仅用于读取旧 session；固定视为无限。 */
    quota_total?: number;
    /** @deprecated 仅作历史用量统计。 */
    quota_used?: number;
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
 * 登录结果（包含tokens）
 */
export interface LoginResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    username?: string;
    role: string;
    referral_code?: string;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  trial_info?: {
    success: boolean;
    trial_days?: number;
    access_type?: string;
    message: string;
  };
  referral_trial_info?: {
    success: boolean;
    code?: string;
    trial_days?: number;
    access_type?: string;
    message: string;
    referral_count?: number;
    required_referrals?: number;
    remaining_referrals?: number;
  };
  error?: string;
}

/**
 * 认证守卫类
 * 支持完整的session加密存储和读取
 */
export class AuthGuard {
  private sessionPath: string;
  private keyPath: string;
  private cloudApiUrl: string;
  private encryptionKey: string;
  private sessionData: SessionData | null = null;
  
  // 默认配置
  private readonly accessTokenExpirySeconds = 15 * 60;  // 15分钟
  private readonly refreshTokenExpirySeconds = 7 * 24 * 60 * 60; // 7天
  private readonly offlineGraceHours = 24;
  
  constructor(sessionPath: string) {
    this.sessionPath = sessionPath;
    this.keyPath = path.join(path.dirname(sessionPath), '.key');
    this.cloudApiUrl = process.env.CLOUD_API_URL || 'https://scholarharness.com/api/v1';
    this.encryptionKey = this.getOrCreateEncryptionKey();
    
    logger.info(`[AuthGuard] Initialized with session path: ${sessionPath}`);
    logger.info(`[AuthGuard] Cloud API URL: ${this.cloudApiUrl}`);
  }
  
  /**
   * 获取或创建加密密钥
   * 使用设备硬件特征生成密钥，确保密钥与设备绑定
   */
  private getOrCreateEncryptionKey(): string {
    try {
      // 尝试读取现有密钥（使用同步方法，因为这是初始化）
      const existingKey = fsSync.readFileSync(this.keyPath, 'utf-8');
      logger.info('[AuthGuard] Using existing encryption key');
      return existingKey;
    } catch {
      // 密钥不存在，生成新密钥
      const newKey = crypto.randomBytes(32).toString('hex');
      
      // 确保目录存在
      const dir = path.dirname(this.keyPath);
      if (!fsSync.existsSync(dir)) {
        fsSync.mkdirSync(dir, { recursive: true });
      }
      
      fsSync.writeFileSync(this.keyPath, newKey, { mode: 0o600 }); // 仅当前用户可读写
      logger.info('[AuthGuard] Generated new encryption key');
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
      logger.error('[AuthGuard] Decryption failed:', error);
      return null;
    }
  }
  
  /**
   * 保存session到本地文件（加密）
   */
  async saveSession(session: SessionData): Promise<void> {
    this.sessionData = session;
    
    const encryptedData = this.encrypt(session);
    
    // 确保目录存在
    const dir = path.dirname(this.sessionPath);
    if (!fsSync.existsSync(dir)) {
      fsSync.mkdirSync(dir, { recursive: true });
    }
    
    await fs.writeFile(
      this.sessionPath,
      JSON.stringify(encryptedData),
      { mode: 0o600 } // 仅当前用户可读写
    );
    
    logger.info('[AuthGuard] Session saved successfully');
  }
  
  /**
   * 获取本地session（解密）
   */
  async getSession(): Promise<SessionData | null> {
    // 如果内存中已有缓存，直接返回
    if (this.sessionData) {
      return this.sessionData;
    }
    
    try {
      const content = await fs.readFile(this.sessionPath, 'utf-8');
      const encryptedData = JSON.parse(content) as EncryptedSessionData;
      
      this.sessionData = this.decrypt(encryptedData);
      
      if (this.sessionData) {
        logger.info(`[AuthGuard] Session loaded for user: ${this.sessionData.email}`);
      }
      
      return this.sessionData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        logger.info('[AuthGuard] No session file found');
        return null;
      }
      
      logger.error('[AuthGuard] Failed to get session:', error);
      return null;
    }
  }
  
  /**
   * 检查session是否存在
   */
  async hasSession(): Promise<boolean> {
    try {
      await fs.access(this.sessionPath);
      return true;
    } catch {
      return false;
    }
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
   * 检查是否在离线宽限期内
   */
  async isWithinOfflineGracePeriod(): Promise<boolean> {
    const session = await this.getSession();
    if (!session) return false;
    
    const gracePeriodMs = this.offlineGraceHours * 60 * 60 * 1000;
    const lastValidated = session.lastValidatedAt || session.createdAt;
    
    return Date.now() < lastValidated + gracePeriodMs;
  }
  
  /**
   * 验证session（通过云端API）
   * 使用 axios 替代 fetch，在 Electron 打包环境中更稳定
   */
  async validateSession(accessToken: string): Promise<{ valid: boolean; reason?: string; subscription?: SessionData['subscription'] }> {
    let referralTrial: { success: boolean; subscription?: SessionData['subscription'] } | null = null;
    try {
      referralTrial = await this.tryClaimInviteTrial(accessToken);
      if (referralTrial?.success && referralTrial.subscription) {
        const session = await this.getSession();
        if (session) {
          session.subscription = referralTrial.subscription;
          session.lastValidatedAt = Date.now();
          await this.saveSession(session);
        }
      }

      const response = await axios.get(`${this.cloudApiUrl}/subscription/me`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        timeout: 10000,
      });
      
      const data = response.data as { subscription?: SessionData['subscription'] };
      
      // 旧服务可能仍返回 exhausted；数字额度已经退出授权逻辑，将其按有效订阅恢复。
      if (data.subscription?.status === 'exhausted') {
        data.subscription.status = data.subscription.plan_type === 'trial' ? 'trial' : 'active';
      }
      
      if (data.subscription?.status === 'expired') {
        return { valid: false, reason: '订阅已过期', subscription: data.subscription };
      }
      
      // trial 状态是内测码激活的试用期订阅，属于有效状态
      if (data.subscription?.status !== 'active' && data.subscription?.status !== 'trial') {
        return { valid: false, reason: `订阅状态异常: ${data.subscription?.status}`, subscription: data.subscription };
      }
      
      // 更本地缓存中的订阅信息
      const session = await this.getSession();
      if (session && data.subscription) {
        session.subscription = data.subscription;
        session.lastValidatedAt = Date.now();
        await this.saveSession(session);
      }
      
      return { valid: true, subscription: data.subscription };
    } catch (error: any) {
      logger.error('[AuthGuard] Validate session failed:', error?.message || error);
      
      // 检查是否是 404 错误（未购买套餐）
      if (error?.response?.status === 404) {
        if (referralTrial?.success && referralTrial.subscription) {
          return { valid: true, subscription: referralTrial.subscription };
        }
        return { valid: false, reason: '未购买套餐' };
      }
      
      // 网络错误时，检查离线宽限期
      const inGrace = await this.isWithinOfflineGracePeriod();
      if (inGrace) {
        logger.info('[AuthGuard] Network error, but within offline grace period');
        return { valid: true, reason: '离线模式（宽限期内）' };
      }
      
      return { valid: false, reason: '网络连接失败，且离线宽限期已过' };
    }
  }
  
  /**
   * 登录（转发到云端API并保存session）
   * 使用 axios 替代 fetch，在 Electron 打包环境中更稳定
   */
  async login(email: string, password: string, betaCode?: string): Promise<LoginResult> {
    try {
      logger.info(`[AuthGuard] Login request for: ${email}`);
      
      const response = await axios.post(`${this.cloudApiUrl}/auth/login`, {
        email,
        password,
        source: 'exe', // 标记为exe客户端登录
        beta_code: betaCode || undefined, // 内测码（可选）
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      
      const data = response.data as any;
      const { user, tokens } = data;
      
      // 构造session数据（包含avatar_url）
      const sessionData: SessionData = {
        userId: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url, // 保存用户头像URL
        referral_code: user.referral_code,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        refreshExpiresAt: Date.now() + this.refreshTokenExpirySeconds * 1000,
        createdAt: Date.now(),
        lastValidatedAt: Date.now(),
      };
      
      // 保存加密的session到本地
      await this.saveSession(sessionData);

      const referralTrialInfo = await this.tryClaimInviteTrial(tokens.accessToken);
      if (referralTrialInfo?.success && referralTrialInfo.subscription) {
        const session = await this.getSession();
        if (session) {
          session.subscription = referralTrialInfo.subscription;
          session.lastValidatedAt = Date.now();
          await this.saveSession(session);
        }
      }
      
      logger.info(`[AuthGuard] Login successful: ${email}`);
      
      return {
        success: true,
        user,
        tokens,
        trial_info: data.trial_info, // 内测码激活信息
        referral_trial_info: referralTrialInfo
          ? {
              success: !!referralTrialInfo.success,
              code: referralTrialInfo.code,
              trial_days: referralTrialInfo.trial_days,
              access_type: referralTrialInfo.access_type,
              message: referralTrialInfo.message,
              referral_count: referralTrialInfo.referral_count,
              required_referrals: referralTrialInfo.required_referrals,
              remaining_referrals: referralTrialInfo.remaining_referrals,
            }
          : undefined,
      };
    } catch (error: any) {
      const status = error?.response?.status;
      const responseData = error?.response?.data;
      const responseMessage = responseData?.message || responseData?.error || responseData?.reason;
      const errorMsg = responseMessage
        || (status ? `云端登录接口返回 ${status}` : '')
        || error?.message
        || '网络连接失败';
      logger.error('[AuthGuard] Login failed:', {
        status,
        message: errorMsg,
        cloudApiUrl: this.cloudApiUrl,
      });
      
      return {
        success: false,
        error: errorMsg,
      };
    }
  }
  
  /**
   * 刷新accessToken
   */
  async refreshToken(): Promise<boolean> {
    try {
      const session = await this.getSession();
      if (!session) {
        return false;
      }
      
      const response = await axios.post(`${this.cloudApiUrl}/auth/refresh`, {
        refreshToken: session.refreshToken,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });
      
      const data = response.data as { tokens: { accessToken: string; refreshToken: string; expiresIn: number } };
      const { tokens } = data;
      
      // 更新本地session
      session.accessToken = tokens.accessToken;
      session.refreshToken = tokens.refreshToken;
      session.expiresAt = Date.now() + tokens.expiresIn * 1000;
      session.refreshExpiresAt = Date.now() + this.refreshTokenExpirySeconds * 1000;
      session.lastValidatedAt = Date.now();
      
      await this.saveSession(session);
      
      logger.info('[AuthGuard] Token refreshed successfully');
      return true;
    } catch (error: any) {
      const status = error?.response?.status;
      const isDefinitiveAuthFailure = status === 400 || status === 401 || status === 403;
      if (isDefinitiveAuthFailure) {
        logger.error('[AuthGuard] Token refresh rejected by cloud:', error?.message || error);
        await this.clearSession();
      } else {
        logger.warn('[AuthGuard] Token refresh temporarily unavailable; keeping local session for offline grace:', error?.message || error);
      }
      return false;
    }
  }
  
  /**
   * 清除session（登出）
   */
  async clearSession(): Promise<void> {
    this.sessionData = null;
    
    try {
      await fs.unlink(this.sessionPath);
      logger.info('[AuthGuard] Session cleared');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.error('[AuthGuard] Failed to delete session file:', error);
      }
    }
  }
  
  /**
   * 兼容旧调用：只检查订阅是否有效，不再比较字符额度。
   */
  async hasEnoughQuota(accessToken: string, _requiredAmount: number): Promise<boolean> {
    const validation = await this.validateSession(accessToken);
    return validation.valid;
  }
  
  /**
   * 兼容旧调用：-1 表示订阅期内不限字符数。
   */
  async getRemainingQuota(): Promise<number> {
    const session = await this.getSession();
    return session?.subscription ? -1 : 0;
  }

  private getFirstMacAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (!iface) continue;
      for (const addr of iface) {
        if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
          return addr.mac;
        }
      }
    }
    return 'unknown-mac';
  }

  private getDeviceId(): string {
    const hostname = os.hostname();
    const platform = os.platform();
    const cpuModel = os.cpus()[0]?.model || 'unknown-cpu';
    const macAddress = this.getFirstMacAddress();
    return crypto
      .createHash('sha256')
      .update(`${hostname}:${platform}:${cpuModel}:${macAddress}`)
      .digest('hex')
      .substring(0, 32);
  }

  private async tryClaimInviteTrial(accessToken: string): Promise<{
    success: boolean;
    code?: string;
    message: string;
    trial_days?: number;
    access_type?: string;
    referral_count?: number;
    required_referrals?: number;
    remaining_referrals?: number;
    subscription?: SessionData['subscription'];
  } | null> {
    try {
      const response = await axios.post(`${this.cloudApiUrl}/referral/invite-trial/claim`, {
        device_id: this.getDeviceId(),
        device_name: os.hostname(),
        device_os: `${os.platform()} ${os.release()}`,
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
        validateStatus: (status) => status >= 200 && status < 500,
      });

      const data = response.data as {
        success?: boolean;
        code?: string;
        message?: string;
        trial_days?: number;
        access_type?: string;
        referral_count?: number;
        required_referrals?: number;
        remaining_referrals?: number;
        subscription?: SessionData['subscription'];
      };

      if (data.success) {
        logger.info(`[AuthGuard] Invite trial claim result: ${data.code || 'success'} - ${data.message || ''}`);
      }

      return {
        success: !!data.success,
        code: data.code,
        message: data.message || '',
        trial_days: data.trial_days,
        access_type: data.access_type,
        referral_count: data.referral_count,
        required_referrals: data.required_referrals,
        remaining_referrals: data.remaining_referrals,
        subscription: data.subscription,
      };
    } catch (error: any) {
      logger.warn('[AuthGuard] Invite trial claim skipped:', error?.message || error);
      return null;
    }
  }
  
  /**
   * 获取云端API URL
   */
  getCloudApiUrl(): string {
    return this.cloudApiUrl;
  }
}

/**
 * 创建认证守卫实例
 */
export function createAuthGuard(sessionPath: string): AuthGuard {
  return new AuthGuard(sessionPath);
}

/**
 * Express中间件：验证session
 */
export function authGuardMiddleware(authGuard: AuthGuard) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // 检查是否需要验证的路由
      const protectedRoutes = [
        '/api/chat',
        '/api/generate',
        '/api/upload',
        '/api/literature',
        '/api/pdf-wiki',
        '/api/chat-bridge',
        '/api/memory',
        '/api/unified',
        '/api/experiment-results',
        '/api/r-code',
        '/api/data-analysis',
        '/api/ocr',
        '/api/ppt-master',
        '/api/meta-analysis',
        '/api/academic-research',
        '/api/project-memory',
        '/api/research-session',
        '/api/bibliometrics',
        '/api/autoresearch',
        '/api/review-writer',
        '/api/overview',
        '/api/flowchart-maker',
        '/api/cloud-prompts',
        '/api/embedding-library',
        '/api/embedding/config',
      ];
      
      const needsAuth = protectedRoutes.some(route => req.path.startsWith(route));
      
      if (!needsAuth) {
        return next();
      }
      
      // 从本地session获取accessToken（优先）
      const session = await authGuard.getSession();
      
      if (!session) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: '未登录',
        });
      }
      
      // 检查accessToken是否过期
      if (await authGuard.isAccessTokenExpired()) {
        // 尝试刷新token
        const refreshed = await authGuard.refreshToken();
        if (!refreshed) {
          const graceSession = await authGuard.getSession();
          if (graceSession && await authGuard.isWithinOfflineGracePeriod()) {
            logger.warn('[AuthGuard] Token refresh unavailable; allowing request in offline grace period');
            (req as any).session = graceSession;
            (req as any).user = {
              userId: graceSession.userId,
              email: graceSession.email,
              username: graceSession.username,
            };
            return next();
          }
          return res.status(401).json({
            error: 'Unauthorized',
            message: '登录已过期，请重新登录',
          });
        }
      }
      
      // 重新获取session（可能已更新）
      const currentSession = await authGuard.getSession();
      if (!currentSession) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: '未登录',
        });
      }

      const validationCacheMs = Number(process.env.AUTH_VALIDATION_CACHE_MS || 5 * 60 * 1000);
      const cachedSubscription = currentSession.subscription;
      const cachedStatus = cachedSubscription?.status;
      const cacheFresh = validationCacheMs > 0 && Date.now() - (currentSession.lastValidatedAt || 0) < validationCacheMs;
      if (cacheFresh && (cachedStatus === 'active' || cachedStatus === 'trial')) {
        (req as any).session = currentSession;
        (req as any).user = {
          userId: currentSession.userId,
          email: currentSession.email,
          username: currentSession.username,
        };
        return next();
      }
      
      // 验证session有效性
      const validation = await authGuard.validateSession(currentSession.accessToken);
      
      if (!validation.valid) {
        return res.status(403).json({
          error: 'Forbidden',
          message: validation.reason || '验证失败',
        });
      }
      
      // 将session信息附加到请求对象
      (req as any).session = currentSession;
      (req as any).user = {
        userId: currentSession.userId,
        email: currentSession.email,
        username: currentSession.username,
      };
      
      // 验证通过，继续处理请求
      next();
    } catch (error) {
      logger.error('[AuthGuard] Middleware error:', error);
      
      return res.status(500).json({
        error: 'Internal Server Error',
        message: '验证失败',
      });
    }
  };
}

export default AuthGuard;
