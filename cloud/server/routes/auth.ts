import { Router, Request, Response } from 'express';
import { UserStore } from '../../storage/user-store';
import { BetaCodeStore } from '../../storage/beta-code-store';
import { SubscriptionStore, createTrialSubscription } from '../../storage/subscription-store';
import { VerificationStore } from '../../storage/verification-store';
import { DatabaseConnection } from '../../database/connection';
import { verifyRefreshToken } from '../../auth/jwt';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest, rateLimitMiddleware } from '../middleware/auth';
import { hashPassword, generateReferralCode } from '../../auth/crypto';
import { User, Subscription, BetaCode } from '../../database/types';

const router = Router();

type PgClient = {
  query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
};

let userStore: UserStore;
let betaCodeStore: BetaCodeStore;
let subscriptionStore: SubscriptionStore;
let verificationStore: VerificationStore;
let db: DatabaseConnection;
const LIFETIME_2D_CODE_TYPE = 'lifetime_2d';
const LIFETIME_ONCE_CODE_TYPE = 'lifetime_once';
const LIMITED_TRIAL_2D_15D_CODE_TYPE = 'limited_trial_2d_15d';
const DAY_MS = 24 * 60 * 60 * 1000;
const LIFETIME_YEARS = 100;
const REFERRAL_INVITEE_TRIAL_DAYS = 10;

type TrialInfo = {
  success: boolean;
  trial_days?: number;
  access_type?: 'trial' | 'lifetime';
  message: string;
};

function isUnlimitedUseBetaCode(codeType: string): boolean {
  return codeType === LIFETIME_2D_CODE_TYPE || codeType === LIMITED_TRIAL_2D_15D_CODE_TYPE;
}

export function initializeAuthRoutes(database: DatabaseConnection): void {
  db = database;
  userStore = new UserStore(db);
  betaCodeStore = new BetaCodeStore(db);
  subscriptionStore = new SubscriptionStore(db);
  verificationStore = new VerificationStore(db);
}

router.post('/register', rateLimitMiddleware(5, 60000), async (req: Request, res: Response) => {
  try {
    const { email, password, username, phone, source, referral_code, 
      accept_privacy_policy, accept_user_agreement, accept_cross_border_transfer,
      privacy_policy_version, user_agreement_version, beta_code, verification_code } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
    }

    // 合规验证：必须同意隐私政策和用户协议
    if (!accept_privacy_policy) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '必须同意隐私政策才能注册',
        code: 'PRIVACY_POLICY_NOT_ACCEPTED',
      });
    }

    if (!accept_user_agreement) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '必须同意用户协议才能注册',
        code: 'USER_AGREEMENT_NOT_ACCEPTED',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Password must be at least 8 characters',
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid email format',
      });
    }

    if (!verification_code) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '请输入邮箱验证码',
        code: 'VERIFICATION_CODE_REQUIRED',
      });
    }

    const normalizedBetaCode = typeof beta_code === 'string' ? beta_code.trim().toUpperCase() : '';
    const normalizedReferralCode = typeof referral_code === 'string' ? referral_code.trim().toUpperCase() : '';
    if (!normalizedBetaCode && !normalizedReferralCode) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '注册必须填写授权码/内测码或好友邀请码',
        code: 'AUTH_OR_REFERRAL_CODE_REQUIRED',
      });
    }

    const existingUser = await userStore.findByEmail(email);
    if (existingUser) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'Email already registered',
      });
    }

    // 内测码预验证 - 注册必须提供有效内测码，登录时仍然保持可选激活
    let trialDays = 0;
    let betaCodeId: string | null = null;
    let isLifetimeBetaCode = false;
    let isUnlimitedUseCode = false;
    let referredBy: string | null = null;
    let trialSource: 'beta_code' | 'referral_invitee_trial' | null = null;

    if (normalizedReferralCode) {
      const referrerResult = await db.query<User>(
        `SELECT id
         FROM users
         WHERE referral_code = $1
           AND status = 'active'
         LIMIT 1`,
        [normalizedReferralCode]
      );

      if (referrerResult.length === 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '好友邀请码不存在或不可用',
          code: 'INVALID_REFERRAL_CODE',
        });
      }

      referredBy = referrerResult[0].id;
    }

    if (normalizedBetaCode) {
      const betaCodeRecord = await betaCodeStore.findByCode(normalizedBetaCode);
      
      if (!betaCodeRecord) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '内测码不存在',
          code: 'INVALID_BETA_CODE',
        });
      }
      
      isLifetimeBetaCode = betaCodeRecord.code_type === LIFETIME_2D_CODE_TYPE || betaCodeRecord.code_type === LIFETIME_ONCE_CODE_TYPE;
      isUnlimitedUseCode = isUnlimitedUseBetaCode(betaCodeRecord.code_type);

      if (betaCodeRecord.status !== 'unused' && !isUnlimitedUseCode) {
        return res.status(400).json({
          error: 'Bad Request',
          message: `内测码已${betaCodeRecord.status === 'used' ? '被使用' : betaCodeRecord.status}`,
          code: 'BETA_CODE_UNAVAILABLE',
        });
      }
      
      // 检查内测码本身过期时间
      if (betaCodeRecord.expires_at && new Date() > new Date(betaCodeRecord.expires_at)) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '内测码已过期',
          code: 'BETA_CODE_EXPIRED',
        });
      }
      
      trialDays = betaCodeRecord.validity_days;
      betaCodeId = betaCodeRecord.id;
      trialSource = 'beta_code';
      
      logger.info(`[Auth] Beta code pre-validated: ${normalizedBetaCode} -> lifetime=${isLifetimeBetaCode}, trialDays=${trialDays}`);
    } else if (referredBy) {
      trialDays = REFERRAL_INVITEE_TRIAL_DAYS;
      trialSource = 'referral_invitee_trial';
      logger.info(`[Auth] Referral code pre-validated: ${normalizedReferralCode} -> inviteeTrialDays=${trialDays}`);
    }

    const verificationResult = await verificationStore.verify(email, String(verification_code).trim(), 'register');
    if (!verificationResult.valid) {
      return res.status(400).json({
        error: 'Bad Request',
        message: verificationResult.message,
        code: 'INVALID_VERIFICATION_CODE',
      });
    }

    // ========== 使用事务保证原子性 ==========
    const result = await db.transaction(async (client: PgClient) => {
      // 1. 创建用户
      const passwordHash = await hashPassword(password);
      const userReferralCode = generateReferralCode();

      const PRIVACY_POLICY_VERSION = 'V1.3';
      const USER_AGREEMENT_VERSION = 'V1.3';

      const userResult = await client.query<User>(
        `INSERT INTO users (email, password_hash, username, phone, source, referral_code, referred_by, role,
          privacy_policy_accepted_at, user_agreement_accepted_at, cross_border_transfer_accepted_at,
          privacy_policy_version, user_agreement_version, email_verified)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *`,
        [
          email.toLowerCase(),
          passwordHash,
          username || email.split('@')[0],
          phone || null,
          source || 'cloud',
          userReferralCode,
          referredBy,
          'user',
          new Date(),
          new Date(),
          accept_cross_border_transfer ? new Date() : null,
          privacy_policy_version || PRIVACY_POLICY_VERSION,
          user_agreement_version || USER_AGREEMENT_VERSION,
          true,
        ]
      );

      const user = userResult.rows[0];
      if (!user) {
        throw new Error('Failed to create user in transaction');
      }

      // 2. 如果有内测码或有效好友邀请，创建订阅并记录权益来源（在事务内）
      let trialSubscription: Subscription | null = null;
      let updatedBetaCode: BetaCode | null = null;
      
      if (trialDays > 0) {
        const startDate = new Date();
        const endDate = isLifetimeBetaCode
          ? new Date(new Date(startDate).setFullYear(startDate.getFullYear() + LIFETIME_YEARS))
          : new Date(Date.now() + trialDays * DAY_MS);
        const quotaTotal = isLifetimeBetaCode ? -1 : 5000000;
        const maxFileUpload = isLifetimeBetaCode ? -1 : 10;

        const subscriptionResult = await client.query<Subscription>(
          `INSERT INTO subscriptions (
            user_id, plan_type, status, start_date, end_date,
            price, currency, payment_method, auto_renew,
            quota_total, quota_used, quota_remaining,
            max_file_upload, file_upload_used,
            trial_start, trial_end,
            metadata
          )
          VALUES ($1, $6, $7, $2, $3, 0, 'CNY', $10, false, $4, 0, $4, $5, 0, $8, $9, $11)
          RETURNING *`,
          [
            user.id,
            startDate,
            endDate,
            quotaTotal,
            maxFileUpload,
            isLifetimeBetaCode ? 'lifetime' : 'trial',
            isLifetimeBetaCode ? 'active' : 'trial',
            isLifetimeBetaCode ? null : startDate,
            isLifetimeBetaCode ? null : endDate,
            betaCodeId ? 'beta_code' : 'invite_trial',
            JSON.stringify({
              source: trialSource,
              beta_code_id: betaCodeId || undefined,
              referral_code: normalizedReferralCode || undefined,
              referral_invitee_trial_days: betaCodeId ? undefined : trialDays,
            }),
          ]
        );
        
        trialSubscription = subscriptionResult.rows[0];

        if (betaCodeId) {
          const betaCodeResult = isUnlimitedUseCode
            ? await client.query<BetaCode>(
                `UPDATE beta_codes
                 SET metadata = jsonb_set(
                       jsonb_set(
                         jsonb_set(
                           COALESCE(metadata, '{}'::jsonb),
                           '{usage_count}',
                           to_jsonb(COALESCE((metadata->>'usage_count')::int, 0) + 1),
                           true
                         ),
                         '{last_used_by}',
                         to_jsonb($1::text),
                         true
                       ),
                       '{last_used_at}',
                       to_jsonb(CURRENT_TIMESTAMP::text),
                       true
                     ),
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2
                 RETURNING *`,
                [user.id, betaCodeId]
              )
            : await client.query<BetaCode>(
                `UPDATE beta_codes 
                 SET status = 'used', used_by = $1, used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                 WHERE id = $2 AND status = 'unused'
                 RETURNING *`,
                [user.id, betaCodeId]
              );
          
          if (betaCodeResult.rows.length === 0) {
            throw new Error('Beta code was used by another request concurrently');
          }
          
          updatedBetaCode = betaCodeResult.rows[0];
        }
      }

      return { user, trialSubscription, updatedBetaCode };
    });

    const user = result.user;
    const tokens = userStore.generateUserTokens(user);

    logger.info(`[Auth] User registered: ${user.email} | privacy_accepted=${accept_privacy_policy} | cross_border=${accept_cross_border_transfer} | beta_code=${betaCodeId ? 'used' : 'none'} | referral=${referredBy ? 'used' : 'none'}`);

    return res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        referral_code: user.referral_code,
        privacy_policy_accepted_at: user.privacy_policy_accepted_at,
        user_agreement_accepted_at: user.user_agreement_accepted_at,
        cross_border_transfer_accepted_at: user.cross_border_transfer_accepted_at,
        email_verified: user.email_verified,
      },
      tokens,
      trial_info: trialDays > 0 ? {
        success: true,
        trial_days: isLifetimeBetaCode ? undefined : trialDays,
        access_type: isLifetimeBetaCode ? 'lifetime' : 'trial',
        message: isLifetimeBetaCode
          ? '已激活永久免费使用权限'
          : trialSource === 'referral_invitee_trial'
            ? `已通过好友邀请激活${trialDays}天免费试用`
            : `已激活${trialDays}天免费试用`,
      } : undefined,
    });
  } catch (error) {
    const message = (error as Error).message;
    logger.error('[Auth] Registration failed:', message);
    
    // 区分并发冲突错误和其他错误
    if (message.includes('concurrently') || message.includes('Beta code was used')) {
      return res.status(409).json({
        error: 'Conflict',
        message: '内测码已被其他请求使用，请刷新页面重试',
        code: 'BETA_CODE_CONFLICT',
      });
    }
    
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Registration failed',
    });
  }
});

router.post('/login', rateLimitMiddleware(10, 60000), async (req: Request, res: Response) => {
  try {
    const { email, password, beta_code } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Email and password are required',
      });
    }

    const user = await userStore.validateCredentials(email, password);

    if (!user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password',
      });
    }

    if (user.status !== 'active') {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Account is ${user.status}`,
      });
    }

    const referralCode = user.referral_code || await userStore.ensureReferralCode(user.id);
    const tokens = userStore.generateUserTokens(user);

    // 内测码激活（可选）- 用于已有账号的用户激活权益
    let trialInfo: TrialInfo | undefined;
    if (beta_code) {
      try {
        const existingSubscription = await subscriptionStore.getActiveSubscription(user.id);
        const betaCodeRecord = await betaCodeStore.findByCode(beta_code);
        const isLifetimeCode = betaCodeRecord?.code_type === LIFETIME_2D_CODE_TYPE || betaCodeRecord?.code_type === LIFETIME_ONCE_CODE_TYPE;
        const isUnlimitedUseCode = betaCodeRecord ? isUnlimitedUseBetaCode(betaCodeRecord.code_type) : false;

        if (existingSubscription && !isLifetimeCode) {
          logger.info(`[Auth] User ${user.email} already has active subscription, beta code ignored`);
          trialInfo = {
            success: false,
            message: '您已有活跃订阅，无需使用内测码',
          };
        } else if (!betaCodeRecord) {
          trialInfo = {
            success: false,
            message: '内测码不存在',
          };
        } else if (betaCodeRecord.status === 'used' && !isUnlimitedUseCode) {
          trialInfo = {
            success: false,
            message: '内测码已被使用',
          };
        } else if (betaCodeRecord.status === 'expired') {
          trialInfo = {
            success: false,
            message: '内测码已过期',
          };
        } else if (betaCodeRecord.status === 'disabled') {
          trialInfo = {
            success: false,
            message: '内测码已禁用',
          };
        } else if (betaCodeRecord.expires_at && new Date() > new Date(betaCodeRecord.expires_at)) {
          trialInfo = {
            success: false,
            message: '内测码已过期',
          };
        } else {
          const usedCode = await betaCodeStore.useCode({
            code: beta_code,
            user_id: user.id,
          });

          if (isLifetimeCode) {
            const startDate = new Date();
            const endDate = new Date(new Date(startDate).setFullYear(startDate.getFullYear() + LIFETIME_YEARS));

            const lifetimeSubscription = existingSubscription
              ? await db.queryOne<Subscription>(
                  `UPDATE subscriptions
                   SET plan_type = 'lifetime',
                       status = 'active',
                       start_date = $1,
                       end_date = $2,
                       trial_start = NULL,
                       trial_end = NULL,
                       quota_total = -1,
                       quota_remaining = -1,
                       max_file_upload = -1,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $3
                   RETURNING *`,
                  [startDate, endDate, existingSubscription.id]
                )
              : await db.queryOne<Subscription>(
                  `INSERT INTO subscriptions (
                    user_id, plan_type, status, start_date, end_date,
                    price, currency, auto_renew,
                    quota_total, quota_used, quota_remaining,
                    max_file_upload, file_upload_used
                  )
                  VALUES ($1, 'lifetime', 'active', $2, $3, 0, 'CNY', false, -1, 0, -1, -1, 0)
                  RETURNING *`,
                  [user.id, startDate, endDate]
                );

            if (!lifetimeSubscription) {
              throw new Error('Failed to create lifetime subscription');
            }

            trialInfo = {
              success: true,
              access_type: 'lifetime',
              message: '已激活永久免费使用权限',
            };
          } else {
            const trialDays = betaCodeRecord.validity_days;

            await createTrialSubscription(db, {
              user_id: user.id,
              validity_days: trialDays,
            });

            trialInfo = {
              success: true,
              trial_days: trialDays,
              access_type: 'trial',
              message: `已激活${trialDays}天免费试用`,
            };
          }

          logger.info(`[Auth] User ${user.email} activated beta code on login, lifetime=${usedCode.isLifetime}, trialDays=${usedCode.trialDays}`);
        }
      } catch (error) {
        logger.error('[Auth] Beta code activation failed on login:', error);
        trialInfo = {
          success: false,
          message: '内测码激活失败，请稍后重试',
        };
      }
    }

    logger.info(`[Auth] User logged in: ${user.email} | beta_code=${beta_code ? (trialInfo?.success ? 'activated' : 'failed') : 'none'}`);

    return res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        avatar_url: user.avatar_url,
        role: user.role,
        source: user.source,
        referral_code: referralCode,
        referral_earnings: user.referral_earnings,
      },
      tokens,
      trial_info: trialInfo,
    });
  } catch (error) {
    logger.error('[Auth] Login failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Login failed',
    });
  }
});

router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Refresh token is required',
      });
    }

    const payload = verifyRefreshToken(refreshToken);

    if (!payload) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired refresh token',
      });
    }

    const user = await userStore.findById(payload.userId);

    if (!user || user.status !== 'active') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not found or inactive',
      });
    }

    const tokens = userStore.generateUserTokens(user);

    return res.json({
      message: 'Token refreshed',
      tokens,
    });
  } catch (error) {
    logger.error('[Auth] Token refresh failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Token refresh failed',
    });
  }
});

router.get('/me', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await userStore.findById(req.user!.userId);

    if (!user) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'User not found',
      });
    }

    const referralStats = await userStore.getReferralStats(user.id);
    const referralCode = user.referral_code || await userStore.ensureReferralCode(user.id);

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        source: user.source,
        status: user.status,
        referral_code: referralCode,
        referral_earnings: user.referral_earnings,
        email_verified: user.email_verified,
        created_at: user.created_at,
        referral_stats: referralStats,
      },
    });
  } catch (error) {
    logger.error('[Auth] Get user failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get user',
    });
  }
});

router.put('/profile', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { username, avatar_url } = req.body;

    const user = await userStore.updateProfile(req.user!.userId, { username, avatar_url });

    return res.json({
      message: 'Profile updated',
      user: {
        id: user!.id,
        email: user!.email,
        username: user!.username,
        avatar_url: user!.avatar_url,
      },
    });
  } catch (error) {
    logger.error('[Auth] Update profile failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to update profile',
    });
  }
});

router.post('/change-password', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Old and new passwords are required',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'New password must be at least 8 characters',
      });
    }

    const success = await userStore.changePassword(req.user!.userId, oldPassword, newPassword);

    if (!success) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Current password is incorrect',
      });
    }

    return res.json({
      message: 'Password changed successfully',
    });
  } catch (error) {
    logger.error('[Auth] Change password failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to change password',
    });
  }
});

router.post('/logout', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  return res.json({
    message: 'Logged out successfully',
  });
});

router.delete('/account', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    await userStore.delete(req.user!.userId);

    return res.json({
      message: 'Account deleted successfully',
    });
  } catch (error) {
    logger.error('[Auth] Delete account failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete account',
    });
  }
});

export default router;
