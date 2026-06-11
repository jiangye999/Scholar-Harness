/**
 * exe认证客户端
 * 负责与云端API通信，处理登录、验证、订阅查询等
 */

import * as os from 'os';
import * as crypto from 'crypto';
import { ExeClientConfig, buildApiUrl, API_ENDPOINTS } from './config';
import { SessionManager, SessionData } from './session-manager';

/**
 * API 响应类型定义
 */
interface ApiErrorResponse {
  message?: string;
  error?: string;
}

interface LoginApiResponse {
  user: {
    id: string;
    email: string;
    username?: string;
    avatar_url?: string;
    role: string;
    source?: string;
    referral_code?: string;
  };
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

interface TokenRefreshApiResponse {
  tokens: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
}

interface SubscriptionApiResponse {
  subscription: SubscriptionInfo;
}

interface ActivationVerifyApiResponse {
  activation: {
    device_id: string;
    expires_at: string;
  };
}

interface BindDeviceApiResponse {
  activation: {
    activation_token: string;
    device_id: string;
    expires_at: string;
  };
}

/**
 * 登录结果
 */
export interface LoginResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    username?: string;
    avatar_url?: string;
    role: string;
    source?: string;
    referral_code?: string;
  };
  tokens?: {
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  };
  error?: string;
}

/**
 * 订阅信息
 */
export interface SubscriptionInfo {
  plan_type: string;
  status: string;
  quota_total: number;
  quota_used: number;
  quota_remaining: number;
  end_date?: string;
  features?: {
    max_file_upload: number;
    ai_model_access: string[];
  };
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  subscription?: SubscriptionInfo;
  activation?: {
    device_id: string;
    expires_at: string;
    status: string;
  };
  error?: string;
  reason?: string;
}

/**
 * exe认证客户端
 */
export class AuthClient {
  private config: ExeClientConfig;
  private sessionManager: SessionManager;
  
  constructor(config: ExeClientConfig) {
    this.config = config;
    this.sessionManager = new SessionManager(config);
  }
  
  /**
   * 获取设备ID
   * 使用硬件特征生成唯一设备标识
   */
  async getDeviceId(): Promise<string> {
    const hostname = os.hostname();
    const platform = os.platform();
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    const macAddress = this.getFirstMacAddress();
    
    const data = `${hostname}:${platform}:${cpuModel}:${macAddress}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  }
  
  /**
   * 获取第一个MAC地址
   */
  private getFirstMacAddress(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name];
      if (iface) {
        for (const addr of iface) {
          if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
            return addr.mac;
          }
        }
      }
    }
    return 'unknown-mac';
  }
  
  /**
   * exe登录
   * 使用网站账号登录exe客户端
   */
  async login(email: string, password: string): Promise<LoginResult> {
    try {
      const deviceId = await this.getDeviceId();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.AUTH_LOGIN, this.config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          source: 'exe', // 标记为exe登录
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json() as ApiErrorResponse;
        return {
          success: false,
          error: errorData.message || '登录失败',
        };
      }
      
      const data = await response.json() as LoginApiResponse;
      const { user, tokens } = data;
      
      // 创建session数据
      const sessionData: SessionData = {
        userId: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url,
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: Date.now() + tokens.expiresIn * 1000,
        refreshExpiresAt: Date.now() + this.config.refreshTokenExpirySeconds * 1000,
        createdAt: Date.now(),
        lastValidatedAt: Date.now(),
      };
      
      // 保存到本地
      await this.sessionManager.saveSession(sessionData);
      
      // 尝试获取订阅信息（如果用户已购买套餐）
      const subscription = await this.getSubscription();
      if (subscription) {
        await this.sessionManager.updateSubscriptionCache({
          plan_type: subscription.plan_type,
          status: subscription.status,
          quota_remaining: subscription.quota_remaining,
          quota_total: subscription.quota_total,
          end_date: subscription.end_date,
        });
      }
      
      return {
        success: true,
        user,
        tokens,
      };
    } catch (error) {
      console.error('[AuthClient] Login failed:', error);
      return {
        success: false,
        error: '网络连接失败，请检查网络后重试',
      };
    }
  }
  
  /**
   * 刷新accessToken
   */
  async refreshToken(): Promise<boolean> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return false;
      }
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.AUTH_REFRESH, this.config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          refreshToken: session.refreshToken,
        }),
      });
      
      if (!response.ok) {
        console.error('[AuthClient] Token refresh failed');
        await this.sessionManager.clearSession();
        return false;
      }
      
      const data = await response.json() as TokenRefreshApiResponse;
      const { tokens } = data;
      
      // 更新本地session
      await this.sessionManager.updateTokens(
        tokens.accessToken,
        tokens.refreshToken,
        tokens.expiresIn
      );
      
      return true;
    } catch (error) {
      console.error('[AuthClient] Token refresh failed:', error);
      return false;
    }
  }
  
  /**
   * 获取用户订阅信息
   */
  async getSubscription(): Promise<SubscriptionInfo | null> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return null;
      }
      
      // 检查accessToken是否过期，尝试刷新
      if (await this.sessionManager.isAccessTokenExpired()) {
        const refreshed = await this.refreshToken();
        if (!refreshed) {
          return null;
        }
      }
      
      const newSession = await this.sessionManager.getSession();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.SUBSCRIPTION_ME, this.config), {
        headers: {
          'Authorization': `Bearer ${newSession?.accessToken}`,
        },
      });
      
      if (!response.ok) {
        if (response.status === 404) {
          // 用户未购买套餐
          return null;
        }
        console.error('[AuthClient] Failed to get subscription:', response.status);
        return null;
      }
      
      const data = await response.json() as SubscriptionApiResponse;
      return data.subscription;
    } catch (error) {
      console.error('[AuthClient] Get subscription failed:', error);
      return null;
    }
  }
  
  /**
   * 验证session有效性（完整验证流程）
   * 1. 检查本地session是否存在
   * 2. 检查accessToken是否过期
   * 3. 验证云端订阅状态
   * 4. 验证设备激活状态（如果有）
   * 5. 检查额度是否耗尽
   */
  async validateSession(): Promise<ValidationResult> {
    try {
      // 1. 检查本地session
      const session = await this.sessionManager.getSession();
      if (!session) {
        return {
          valid: false,
          reason: '未登录',
          error: 'NO_SESSION',
        };
      }
      
      // 2. 检查accessToken是否过期
      if (await this.sessionManager.isAccessTokenExpired()) {
        // 尝试刷新
        const refreshed = await this.refreshToken();
        if (!refreshed) {
          return {
            valid: false,
            reason: '登录已过期，请重新登录',
            error: 'TOKEN_EXPIRED',
          };
        }
      }
      
      // 3. 检查是否在离线宽限期内
      if (!await this.sessionManager.isWithinOfflineGracePeriod()) {
        return {
          valid: false,
          reason: '离线时间过长，请联网验证',
          error: 'OFFLINE_GRACE_EXPIRED',
        };
      }
      
      // 4. 尝试联网验证云端状态
      const subscription = await this.getSubscription();
      
      if (!subscription) {
        // 用户未购买套餐
        return {
          valid: false,
          reason: '未购买套餐，请前往网站购买',
          error: 'NO_SUBSCRIPTION',
        };
      }
      
      // 5. 检查订阅状态
      if (subscription.status === 'exhausted') {
        return {
          valid: false,
          subscription,
          reason: '额度已耗尽，请续费或升级套餐',
          error: 'QUOTA_EXHAUSTED',
        };
      }
      
      if (subscription.status === 'expired') {
        return {
          valid: false,
          subscription,
          reason: '套餐已过期，请续费',
          error: 'SUBSCRIPTION_EXPIRED',
        };
      }
      
      // trial 状态是内测码激活的试用期订阅，属于有效状态
      if (subscription.status !== 'active' && subscription.status !== 'trial') {
        return {
          valid: false,
          subscription,
          reason: `订阅状态异常: ${subscription.status}`,
          error: 'SUBSCRIPTION_STATUS_INVALID',
        };
      }
      
      // 6. 更新本地缓存
      await this.sessionManager.updateSubscriptionCache({
        plan_type: subscription.plan_type,
        status: subscription.status,
        quota_remaining: subscription.quota_remaining,
        quota_total: subscription.quota_total,
        end_date: subscription.end_date,
      });
      
      // 7. 验证设备激活状态（如果有）
      const activation = await this.verifyActivation();
      
      return {
        valid: true,
        subscription,
        activation: activation ? {
          device_id: activation.device_id,
          expires_at: activation.expires_at,
          status: 'active',
        } : undefined,
      };
    } catch (error) {
      console.error('[AuthClient] Session validation failed:', error);
      
      // 网络错误时，检查离线宽限期
      const inGrace = await this.sessionManager.isWithinOfflineGracePeriod();
      if (inGrace) {
        return {
          valid: true,
          reason: '离线模式（宽限期内）',
        };
      }
      
      return {
        valid: false,
        reason: '网络连接失败，且离线宽限期已过',
        error: 'NETWORK_ERROR',
      };
    }
  }
  
  /**
   * 验证设备激活状态
   */
  async verifyActivation(): Promise<{ device_id: string; expires_at: string } | null> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session || !session.activation?.activation_token) {
        return null;
      }
      
      const deviceId = await this.getDeviceId();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.ACTIVATION_VERIFY, this.config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activation_token: session.activation.activation_token,
          device_id: deviceId,
        }),
      });
      
      if (!response.ok) {
        console.error('[AuthClient] Activation verification failed');
        return null;
      }
      
      const data = await response.json() as ActivationVerifyApiResponse;
      return {
        device_id: data.activation.device_id,
        expires_at: data.activation.expires_at,
      };
    } catch (error) {
      console.error('[AuthClient] Verify activation failed:', error);
      return null;
    }
  }
  
  /**
   * 绑定设备到订阅
   */
  async bindDevice(): Promise<{ success: boolean; activation_token?: string; error?: string }> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return { success: false, error: '未登录' };
      }
      
      const deviceId = await this.getDeviceId();
      const deviceName = os.hostname();
      const deviceOs = os.platform() + ' ' + os.release();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.SUBSCRIPTION_BIND_DEVICE, this.config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          device_id: deviceId,
          device_name: deviceName,
          device_os: deviceOs,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json() as ApiErrorResponse;
        return {
          success: false,
          error: errorData.message || '设备绑定失败',
        };
      }
      
      const data = await response.json() as BindDeviceApiResponse;
      
      // 保存激活信息到本地
      await this.sessionManager.updateActivationCache({
        activation_token: data.activation.activation_token,
        device_id: deviceId,
        expires_at: data.activation.expires_at,
      });
      
      return {
        success: true,
        activation_token: data.activation.activation_token,
      };
    } catch (error) {
      console.error('[AuthClient] Bind device failed:', error);
      return {
        success: false,
        error: '网络连接失败',
      };
    }
  }
  
  /**
   * 上报使用量
   */
  async reportUsage(usageType: string, amount: number): Promise<boolean> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return false;
      }
      
      const deviceId = await this.getDeviceId();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.USAGE_REPORT, this.config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({
          usage_type: usageType,
          amount,
          device_id: deviceId,
        }),
      });
      
      if (!response.ok) {
        console.error('[AuthClient] Report usage failed');
        return false;
      }
      
      // 更新本地缓存的剩余额度
      const subscription = await this.getSubscription();
      if (subscription) {
        await this.sessionManager.updateSubscriptionCache({
          quota_used: subscription.quota_used,
          quota_remaining: subscription.quota_remaining,
        });
      }
      
      return true;
    } catch (error) {
      console.error('[AuthClient] Report usage failed:', error);
      return false;
    }
  }
  
  /**
   * 登出
   */
  async logout(): Promise<void> {
    await this.sessionManager.clearSession();
  }
  
  /**
   * 获取session管理器（供其他模块使用）
   */
  getSessionManager(): SessionManager {
    return this.sessionManager;
  }
  
  /**
   * 获取用户信息
   */
  async getUserInfo(): Promise<{
    user?: {
      id: string;
      email: string;
      username?: string;
      avatar_url?: string;
    };
    subscription?: SubscriptionInfo;
    error?: string;
  }> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return { error: '未登录' };
      }
      
      // 检查accessToken是否过期
      if (await this.sessionManager.isAccessTokenExpired()) {
        const refreshed = await this.refreshToken();
        if (!refreshed) {
          return { error: '登录已过期' };
        }
      }
      
      const newSession = await this.sessionManager.getSession();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.AUTH_ME, this.config), {
        headers: {
          'Authorization': `Bearer ${newSession?.accessToken}`,
        },
      });
      
      if (!response.ok) {
        return { error: '获取用户信息失败' };
      }
      
      const data = await response.json() as { user: LoginApiResponse['user'] };
      
      // 更新本地缓存的头像
      if (data.user.avatar_url) {
        await this.sessionManager.updateAvatarCache(data.user.avatar_url);
      }
      
      // 获取订阅信息
      const subscription = await this.getSubscription();
      
      return {
        user: {
          id: data.user.id,
          email: data.user.email,
          username: data.user.username,
          avatar_url: data.user.avatar_url,
        },
        subscription: subscription || undefined,
      };
    } catch (error) {
      console.error('[AuthClient] Get user info failed:', error);
      return { error: '网络连接失败' };
    }
  }
  
  /**
   * 获取用量统计（用于用户信息界面）
   */
  async getDailyStats(): Promise<{
    daily_stats?: Array<{ date: string; word_count: number; file_count: number }>;
    subscription?: {
      plan_type: string;
      quota_remaining: number;
      quota_total: number;
    };
    error?: string;
  }> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return { error: '未登录' };
      }
      
      // 检查accessToken是否过期
      if (await this.sessionManager.isAccessTokenExpired()) {
        const refreshed = await this.refreshToken();
        if (!refreshed) {
          return { error: '登录已过期' };
        }
      }
      
      const newSession = await this.sessionManager.getSession();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.USAGE_DAILY_STATS, this.config), {
        headers: {
          'Authorization': `Bearer ${newSession?.accessToken}`,
        },
      });
      
      if (!response.ok) {
        return { error: '获取用量统计失败' };
      }
      
      const data = await response.json() as {
        daily_stats: Array<{ date: string; word_count: number; file_count: number }>;
        subscription: {
          plan_type: string;
          quota_remaining: number;
          quota_total: number;
        };
      };
      
      return data;
    } catch (error) {
      console.error('[AuthClient] Get daily stats failed:', error);
      return { error: '网络连接失败' };
    }
  }
  
  /**
   * 获取充值链接
   * @param amountCNY 充值金额（元）
   */
  async getPurchaseUrl(amountCNY: number): Promise<{
    pay_url?: string;
    credits?: number;
    error?: string;
  }> {
    try {
      const session = await this.sessionManager.getSession();
      if (!session) {
        return { error: '未登录' };
      }
      
      // 检查accessToken是否过期
      if (await this.sessionManager.isAccessTokenExpired()) {
        const refreshed = await this.refreshToken();
        if (!refreshed) {
          return { error: '登录已过期' };
        }
      }
      
      const newSession = await this.sessionManager.getSession();
      
      const response = await fetch(buildApiUrl(API_ENDPOINTS.USAGE_PURCHASE_CREDITS, this.config), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${newSession?.accessToken}`,
        },
        body: JSON.stringify({ amount_cny: amountCNY }),
      });
      
      if (!response.ok) {
        const errorData = await response.json() as ApiErrorResponse;
        return { error: errorData.message || '充值请求失败' };
      }
      
      const data = await response.json() as {
        pay_url: string;
        payment: { credits: number };
      };
      
      return {
        pay_url: data.pay_url,
        credits: data.payment.credits,
      };
    } catch (error) {
      console.error('[AuthClient] Get purchase URL failed:', error);
      return { error: '网络连接失败' };
    }
  }
}

export default AuthClient;