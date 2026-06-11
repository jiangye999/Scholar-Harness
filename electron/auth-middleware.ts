/**
 * Electron认证中间件
 * 负责处理登录请求、验证session、与云端API通信
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import { AuthClient } from '../cloud/exe/auth-client';
import { ExeClientConfig, getExeClientConfig } from '../cloud/exe/config';

/**
 * 认证结果
 */
export interface AuthResult {
  success: boolean;
  user?: {
    id: string;
    email: string;
    username?: string;
  };
  error?: string;
}

/**
 * 验证结果
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  subscription?: {
    plan_type: string;
    status: string;
    quota_remaining: number;
  };
}

/**
 * 认证中间件类
 */
export class AuthMiddleware {
  private authClient: AuthClient;
  private config: ExeClientConfig;
  private dataDir: string;
  
  constructor(dataDir: string) {
    this.dataDir = dataDir;
    
    // 初始化配置
    this.config = getExeClientConfig({
      sessionFilePath: path.join(dataDir, '.session'),
      usageCachePath: path.join(dataDir, '.usage-cache'),
    } as any);
    
    // 初始化AuthClient
    this.authClient = new AuthClient(this.config);
  }
  
  /**
   * 处理登录请求
   */
  async handleLogin(email: string, password: string): Promise<AuthResult> {
    try {
      console.log('[AuthMiddleware] Processing login for:', email);
      
      // 调用AuthClient进行登录
      const result = await this.authClient.login(email, password);
      
      if (result.success) {
        console.log('[AuthMiddleware] Login successful');
        
        return {
          success: true,
          user: result.user,
        };
      } else {
        console.error('[AuthMiddleware] Login failed:', result.error);
        
        return {
          success: false,
          error: result.error || '登录失败',
        };
      }
    } catch (error) {
      console.error('[AuthMiddleware] Login error:', error);
      
      return {
        success: false,
        error: error instanceof Error ? error.message : '登录失败',
      };
    }
  }
  
  /**
   * 验证当前session
   */
  async validateSession(): Promise<ValidationResult> {
    try {
      console.log('[AuthMiddleware] Validating session...');
      
      const result = await this.authClient.validateSession();
      
      if (result.valid) {
        console.log('[AuthMiddleware] Session valid');
        
        return {
          valid: true,
          subscription: result.subscription ? {
            plan_type: result.subscription.plan_type,
            status: result.subscription.status,
            quota_remaining: result.subscription.quota_remaining,
          } : undefined,
        };
      } else {
        console.log('[AuthMiddleware] Session invalid:', result.reason);
        
        return {
          valid: false,
          reason: result.reason,
        };
      }
    } catch (error) {
      console.error('[AuthMiddleware] Validation error:', error);
      
      return {
        valid: false,
        reason: error instanceof Error ? error.message : '验证失败',
      };
    }
  }
  
  /**
   * 检查是否有session
   */
  async hasSession(): Promise<boolean> {
    try {
      const session = await this.authClient.getSessionManager().getSession();
      return session !== null;
    } catch (error) {
      return false;
    }
  }
  
  /**
   * 获取剩余额度
   */
  async getRemainingQuota(): Promise<number> {
    try {
      return await this.authClient.getSessionManager().getRemainingQuota();
    } catch (error) {
      return 0;
    }
  }
  
  /**
   * 检查是否有足够额度
   */
  async hasEnoughQuota(requiredAmount: number): Promise<boolean> {
    try {
      return await this.authClient.getSessionManager().hasEnoughQuota(requiredAmount);
    } catch (error) {
      return false;
    }
  }
  
  /**
   * 上报使用量
   */
  async reportUsage(usageType: string, amount: number): Promise<boolean> {
    try {
      return await this.authClient.reportUsage(usageType, amount);
    } catch (error) {
      console.error('[AuthMiddleware] Report usage failed:', error);
      return false;
    }
  }
  
  /**
   * 登出
   */
  async logout(): Promise<void> {
    try {
      await this.authClient.logout();
      console.log('[AuthMiddleware] Logged out');
    } catch (error) {
      console.error('[AuthMiddleware] Logout failed:', error);
    }
  }
  
  /**
   * 获取AuthClient实例
   */
  getAuthClient(): AuthClient {
    return this.authClient;
  }
}

/**
 * 创建认证中间件实例
 */
export function createAuthMiddleware(dataDir: string): AuthMiddleware {
  return new AuthMiddleware(dataDir);
}