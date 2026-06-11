/**
 * CSRF 保护中间件
 * 使用双重提交 Cookie 模式
 */

import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

// CSRF Token 存储简单的内存存储
const csrfTokens = new Map<string, { token: string; expires: number }>();

// Token 有效期（1小时）
const TOKEN_EXPIRY = 60 * 60 * 1000;

// 清理过期 token 的定时器
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of csrfTokens.entries()) {
    if (value.expires < now) {
      csrfTokens.delete(key);
    }
  }
}, 5 * 60 * 1000); // 每 5 分钟清理一次

/**
 * 生成 CSRF Token
 */
export function generateCsrfToken(sessionId: string): string {
  const token = crypto.randomBytes(32).toString('base64url');
  csrfTokens.set(sessionId, {
    token,
    expires: Date.now() + TOKEN_EXPIRY,
  });
  return token;
}

/**
 * 验证 CSRF Token
 */
export function validateCsrfToken(sessionId: string, token: string): boolean {
  const stored = csrfTokens.get(sessionId);
  if (!stored) {
    return false;
  }
  
  if (stored.expires < Date.now()) {
    csrfTokens.delete(sessionId);
    return false;
  }
  
  // 使用时序安全比较防止时序攻击
  try {
    return crypto.timingSafeEqual(
      Buffer.from(stored.token, 'utf8'),
      Buffer.from(token, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * 获取或创建 session ID
 */
function getSessionId(req: Request): string {
  // 从 cookie 获取，或使用 IP + User-Agent 作为简单的 session 标识
  let sessionId = req.cookies?.['csrf_session'] as string | undefined;
  
  if (!sessionId) {
    // 创建简单的 session 标识
    const rawId = `${req.ip}-${req.headers['user-agent']}`;
    sessionId = crypto.createHash('sha256').update(rawId).digest('base64url');
  }
  
  return sessionId;
}

/**
 * CSRF 保护中间件
 * 对于需要保护的路由，验证请求来源
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  // 安全方法（GET, HEAD, OPTIONS）不需要 CSRF 保护
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  const sessionId = getSessionId(req);
  
  // 方式 1: 检查 X-Requested-With 头（适用于 AJAX 请求）
  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'XMLHttpRequest') {
    next();
    return;
  }
  
  // 方式 2: 检查 Origin 头
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) {
        next();
        return;
      }
    } catch {
      // 无效的 origin，继续检查其他方式
    }
  }
  
  // 方式 3: 检查 Referer 头
  const referer = req.headers.referer;
  if (referer && host) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) {
        next();
        return;
      }
    } catch {
      // 无效的 referer
    }
  }
  
  // 方式 4: 检查 CSRF Token（从 header 或 body）
  const csrfToken = req.headers['x-csrf-token'] as string | undefined 
    || req.body?._csrf 
    || req.query?._csrf;
  
  if (csrfToken && validateCsrfToken(sessionId, csrfToken)) {
    next();
    return;
  }
  
  // 所有检查都失败，拒绝请求
  res.status(403).json({
    success: false,
    error: 'CSRF token validation failed',
  });
}

/**
 * 宽松的 CSRF 保护（仅检查 Origin/Referer）
 * 适用于 API 路由
 */
export function csrfProtectionLite(req: Request, res: Response, next: NextFunction): void {
  // 安全方法不需要保护
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  // 检查 X-Requested-With 头
  const xRequestedWith = req.headers['x-requested-with'];
  if (xRequestedWith === 'XMLHttpRequest') {
    next();
    return;
  }
  
  // 检查 Origin 或 Referer
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  const host = req.headers.host;
  
  // 允许同源请求
  if (host) {
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host === host) {
          next();
          return;
        }
      } catch {
        // 忽略
      }
    }
    
    if (referer) {
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.host === host) {
          next();
          return;
        }
      } catch {
        // 忽略
      }
    }
  }
  
  // 对于 localhost 开发环境，放宽限制
  if (process.env.NODE_ENV !== 'production' && host?.includes('localhost')) {
    next();
    return;
  }
  
  res.status(403).json({
    success: false,
    error: 'Request origin validation failed',
  });
}

/**
 * 为响应添加 CSRF Token
 */
export function attachCsrfToken(req: Request, res: Response, next: NextFunction): void {
  const sessionId = getSessionId(req);
  const token = generateCsrfToken(sessionId);
  
  // 设置 cookie（HttpOnly for security）
  res.cookie('csrf_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: TOKEN_EXPIRY,
  });
  
  // 在响应中提供 token（供前端使用）
  res.locals.csrfToken = token;
  
  next();
}