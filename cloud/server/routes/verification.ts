import { Router, Request, Response } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { UserStore } from '../../storage/user-store';
import { VerificationStore, VerificationType } from '../../storage/verification-store';
import { createEmailServiceFromEnv, EmailService } from '../../services/email-service';
import { CaptchaService, createCaptchaServiceFromEnv } from '../../services/captcha-service';
import { logger } from '../../utils/logger';
import { rateLimitMiddleware } from '../middleware/auth';

const router = Router();

let userStore: UserStore;
let verificationStore: VerificationStore;
let emailService: EmailService;
let captchaService: CaptchaService;

const allowedTypes: VerificationType[] = ['register', 'reset_password', 'change_email', 'change_phone'];

export function initializeVerificationRoutes(database: DatabaseConnection): void {
  userStore = new UserStore(database);
  verificationStore = new VerificationStore(database);
  emailService = createEmailServiceFromEnv();
  captchaService = createCaptchaServiceFromEnv();
}

router.post('/send-email-code', rateLimitMiddleware(3, 60000), async (req: Request, res: Response) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const type = normalizeVerificationType(req.body?.type);
    const captchaTicket = String(req.body?.captchaTicket || req.body?.captcha_ticket || '').trim();
    const captchaRandstr = String(req.body?.captchaRandstr || req.body?.captcha_randstr || '').trim();

    if (!email) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '请输入邮箱地址',
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '邮箱格式不正确',
      });
    }

    if (!type) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '验证码类型不正确',
      });
    }

    const captchaResult = await captchaService.verify(captchaTicket, captchaRandstr, getClientIp(req));
    if (!captchaResult.valid) {
      logger.warn(`[Verification] Captcha rejected for ${email}: ${captchaResult.message}`);
      return res.status(400).json({
        error: 'Bad Request',
        message: captchaResult.message,
      });
    }
    logger.info(`[Verification] Captcha accepted for ${email}, type=${type}`);

    if (type === 'register') {
      const existingUser = await userStore.findByEmail(email);
      if (existingUser) {
        logger.info(`[Verification] Email code skipped because user already exists: ${email}`);
        return res.status(409).json({
          error: 'Conflict',
          message: '该邮箱已注册',
        });
      }
    }

    const { code } = await verificationStore.create(email, type);
    logger.info(`[Verification] Created email verification code for ${email}, type=${type}`);
    const result = await emailService.sendVerificationCode(email, code, type);

    if (!result.success) {
      await verificationStore.expirePending(email, type);
      logger.warn(`[Verification] Email send failed for ${email}, type=${type}: ${result.message}`);
      return res.status(500).json({
        error: 'Internal Server Error',
        message: result.message,
      });
    }

    logger.info(`[Verification] Email verification code sent for ${email}, type=${type}`);
    return res.json({
      success: true,
      message: result.message,
      expiresIn: 300,
    });
  } catch (error) {
    logger.error('[Verification] Failed to send email code:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: '验证码发送失败，请稍后重试',
    });
  }
});

function normalizeVerificationType(value: unknown): VerificationType | null {
  const type = String(value || 'register') as VerificationType;
  return allowedTypes.includes(type) ? type : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (Array.isArray(forwardedFor)) {
    return forwardedFor[0]?.split(',')[0]?.trim() || req.ip || '127.0.0.1';
  }

  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return req.ip || req.socket.remoteAddress || '127.0.0.1';
}

export default router;
