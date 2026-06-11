/**
 * AuthGuard 单例管理模块
 * 提供全局访问 AuthGuard 实例，供各路由模块获取用户 session
 * 
 * 解决问题：用户切换账号后，userId 未正确传递导致数据混淆
 * 方案：后端从 session 自动获取真实 userId，而非依赖前端传递
 */

import { AuthGuard, createAuthGuard, SessionData } from './auth-guard';
import { getDataDir } from '../utils/paths';
import * as path from 'path';

// 全局单例
let authGuardInstance: AuthGuard | null = null;

/**
 * 初始化 AuthGuard 单例
 * 在服务器启动时调用一次
 */
export function initAuthGuardSingleton(): AuthGuard {
  if (authGuardInstance) {
    return authGuardInstance;
  }
  
  const dataDir = getDataDir();
  const sessionPath = path.join(dataDir, '.session');
  
  authGuardInstance = createAuthGuard(sessionPath);
  
  return authGuardInstance;
}

/**
 * 获取 AuthGuard 单例
 */
export function getAuthGuard(): AuthGuard {
  if (!authGuardInstance) {
    // 如果未初始化，自动初始化（fallback）
    return initAuthGuardSingleton();
  }
  return authGuardInstance;
}

/**
 * 从当前 session 获取 userId
 * 这是核心修复函数 - 用于替代前端传递的 userId
 * 
 * @returns userId 或 null（无 session）
 */
export async function getUserIdFromSession(): Promise<string | null> {
  try {
    const authGuard = getAuthGuard();
    const session = await authGuard.getSession();
    
    if (!session) {
      return null;
    }
    
    // 返回真实的云端用户 ID
    return session.userId;
  } catch (error) {
    return null;
  }
}

/**
 * 从 session 或请求 body 获取 userId（带 fallback）
 * 优先级：session > req.body.userId > 'web-user'
 * 
 * @param bodyUserId - 前端传递的 userId（可选）
 * @returns 最终使用的 userId
 */
export async function resolveUserId(bodyUserId?: string): Promise<string> {
  // 优先从 session 获取（安全、可靠）
  const sessionUserId = await getUserIdFromSession();
  
  if (sessionUserId) {
    return sessionUserId;
  }
  
  // Fallback: 前端传递的 userId（web 模式可能用到）
  if (bodyUserId && typeof bodyUserId === 'string' && bodyUserId.trim()) {
    return bodyUserId.trim();
  }
  
  // 最终 fallback: web-user（无登录状态）
  return 'web-user';
}

/**
 * 获取完整 session 信息
 * 用于需要 email、subscription 等详细信息的场景
 */
export async function getSessionInfo(): Promise<{
  userId: string | null;
  email: string | null;
  subscription: SessionData['subscription'] | null;
}> {
  try {
    const authGuard = getAuthGuard();
    const session = await authGuard.getSession();
    
    if (!session) {
      return { userId: null, email: null, subscription: null };
    }
    
    return {
      userId: session.userId,
      email: session.email,
      subscription: session.subscription,
    };
  } catch (error) {
    return { userId: null, email: null, subscription: null };
  }
}

export default {
  initAuthGuardSingleton,
  getAuthGuard,
  getUserIdFromSession,
  resolveUserId,
  getSessionInfo,
};