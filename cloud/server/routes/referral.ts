import { Router, Request, Response } from 'express';
import { ReferralStore } from '../../storage/referral-store';
import { DatabaseConnection } from '../../database/connection';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { InviteTrialClaim, Subscription } from '../../database/types';

const router = Router();

let referralStore: ReferralStore;
let db: DatabaseConnection;

const INVITE_TRIAL_REQUIRED_REFERRALS = 3;
const INVITE_TRIAL_BONUS_DAYS = 30;

export function initializeReferralRoutes(database: DatabaseConnection): void {
  db = database;
  referralStore = new ReferralStore(db);
}

function normalizeDeviceId(deviceId: unknown): string {
  return typeof deviceId === 'string' ? deviceId.trim().toLowerCase() : '';
}

async function getQualifiedReferralCount(client: { query: Function }, userId: string): Promise<number> {
  const result = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM users
     WHERE referred_by = $1
       AND status = 'active'
       AND email_verified = TRUE`,
    [userId]
  ) as { rows: Array<{ count: number }> };

  return Number(result.rows[0]?.count || 0);
}

function serializeInviteTrialClaim(claim: InviteTrialClaim | null): Record<string, unknown> | null {
  if (!claim) return null;
  return {
    id: claim.id,
    user_id: claim.user_id,
    device_id: claim.device_id,
    device_name: claim.device_name,
    device_os: claim.device_os,
    referred_count_at_claim: claim.referred_count_at_claim,
    required_referrals: claim.required_referrals,
    bonus_days: claim.bonus_days,
    subscription_id: claim.subscription_id,
    claimed_at: claim.claimed_at,
  };
}

async function getInviteTrialStatus(userId: string, deviceId?: string): Promise<{
  referralCount: number;
  claimedByUser: InviteTrialClaim | null;
  claimedByDevice: InviteTrialClaim | null;
}> {
  const referralCount = await getQualifiedReferralCount({
    query: async (sql: string, params: unknown[]) => ({ rows: await db.query(sql, params) }),
  }, userId);

  const claimedByUser = await db.queryOne<InviteTrialClaim>(
    'SELECT * FROM invite_trial_claims WHERE user_id = $1',
    [userId]
  );

  const claimedByDevice = deviceId
    ? await db.queryOne<InviteTrialClaim>(
        'SELECT * FROM invite_trial_claims WHERE device_id = $1',
        [deviceId]
      )
    : null;

  return { referralCount, claimedByUser, claimedByDevice };
}

router.get('/invite-trial/status', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deviceId = normalizeDeviceId(req.query.device_id);
    const status = await getInviteTrialStatus(req.user!.userId, deviceId || undefined);
    const eligible = status.referralCount >= INVITE_TRIAL_REQUIRED_REFERRALS
      && !status.claimedByUser
      && !status.claimedByDevice;

    return res.json({
      success: true,
      eligible,
      required_referrals: INVITE_TRIAL_REQUIRED_REFERRALS,
      referral_count: status.referralCount,
      remaining_referrals: Math.max(0, INVITE_TRIAL_REQUIRED_REFERRALS - status.referralCount),
      claimed_by_user: serializeInviteTrialClaim(status.claimedByUser),
      claimed_by_device: serializeInviteTrialClaim(status.claimedByDevice),
    });
  } catch (error) {
    logger.error('[Referral] Invite trial status failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to get invite trial status',
    });
  }
});

router.post('/invite-trial/claim', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const deviceId = normalizeDeviceId(req.body.device_id);
    const deviceName = typeof req.body.device_name === 'string' ? req.body.device_name.trim().slice(0, 100) : null;
    const deviceOs = typeof req.body.device_os === 'string' ? req.body.device_os.trim().slice(0, 100) : null;

    if (!deviceId || deviceId.length < 8 || deviceId.length > 100) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DEVICE_ID',
        message: 'device_id is required and must be 8-100 characters',
      });
    }

    const result = await db.transaction(async (client) => {
      const existingUserClaim = await client.query(
        'SELECT * FROM invite_trial_claims WHERE user_id = $1 FOR UPDATE',
        [req.user!.userId]
      ) as { rows: InviteTrialClaim[] };

      if (existingUserClaim.rows[0]) {
        return {
          status: 'already_claimed',
          referralCount: 0,
          claim: existingUserClaim.rows[0],
          subscription: null as Subscription | null,
        };
      }

      const existingDeviceClaim = await client.query(
        'SELECT * FROM invite_trial_claims WHERE device_id = $1 FOR UPDATE',
        [deviceId]
      ) as { rows: InviteTrialClaim[] };

      if (existingDeviceClaim.rows[0]) {
        return {
          status: 'device_already_claimed',
          referralCount: 0,
          claim: existingDeviceClaim.rows[0],
          subscription: null as Subscription | null,
        };
      }

      const referralCount = await getQualifiedReferralCount(client, req.user!.userId);
      if (referralCount < INVITE_TRIAL_REQUIRED_REFERRALS) {
        return {
          status: 'not_qualified',
          referralCount,
          claim: null as InviteTrialClaim | null,
          subscription: null as Subscription | null,
        };
      }

      const latestSubscriptionResult = await client.query(
        `SELECT * FROM subscriptions
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 1
         FOR UPDATE`,
        [req.user!.userId]
      ) as { rows: Subscription[] };

      const latestSubscription = latestSubscriptionResult.rows[0] || null;

      if (latestSubscription?.plan_type === 'lifetime' && latestSubscription.status === 'active') {
        return {
          status: 'already_unlimited',
          referralCount,
          claim: null as InviteTrialClaim | null,
          subscription: latestSubscription,
        };
      }

      let subscription: Subscription | null = null;

      if (!latestSubscription) {
        const subscriptionResult = await client.query(
          `INSERT INTO subscriptions (
            user_id, plan_type, status, start_date, end_date,
            price, currency, payment_method, auto_renew,
            quota_total, quota_used, quota_remaining,
            max_file_upload, file_upload_used,
            trial_start, trial_end,
            metadata
          )
          VALUES (
            $1, 'trial', 'trial', CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP + INTERVAL '${INVITE_TRIAL_BONUS_DAYS} days',
            0, 'CNY', 'invite_trial', false,
            -1, 0, -1, -1, 0,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '${INVITE_TRIAL_BONUS_DAYS} days',
            $2
          )
          RETURNING *`,
          [
            req.user!.userId,
            JSON.stringify({ source: 'invite_trial', required_referrals: INVITE_TRIAL_REQUIRED_REFERRALS }),
          ]
        ) as { rows: Subscription[] };
        subscription = subscriptionResult.rows[0] || null;
      } else {
        const nextStatus = latestSubscription.plan_type === 'trial' ? 'trial' : 'active';
        const subscriptionResult = await client.query(
          `UPDATE subscriptions
           SET status = $1,
               end_date = GREATEST(end_date, CURRENT_TIMESTAMP) + INTERVAL '${INVITE_TRIAL_BONUS_DAYS} days',
               trial_end = CASE
                 WHEN plan_type = 'trial' THEN GREATEST(COALESCE(trial_end, end_date), CURRENT_TIMESTAMP) + INTERVAL '${INVITE_TRIAL_BONUS_DAYS} days'
                 ELSE trial_end
               END,
               quota_total = -1,
               quota_remaining = -1,
               max_file_upload = -1,
               payment_method = COALESCE(payment_method, 'invite_trial'),
               metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $3
           RETURNING *`,
          [
            nextStatus,
            JSON.stringify({ invite_trial_bonus_days: INVITE_TRIAL_BONUS_DAYS }),
            latestSubscription.id,
          ]
        ) as { rows: Subscription[] };
        subscription = subscriptionResult.rows[0] || null;
      }

      if (!subscription) {
        throw new Error('Failed to create or extend invite trial subscription');
      }

      const claimResult = await client.query(
        `INSERT INTO invite_trial_claims (
          user_id, device_id, device_name, device_os,
          referred_count_at_claim, required_referrals, bonus_days,
          subscription_id, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          req.user!.userId,
          deviceId,
          deviceName,
          deviceOs,
          referralCount,
          INVITE_TRIAL_REQUIRED_REFERRALS,
          INVITE_TRIAL_BONUS_DAYS,
          subscription.id,
          JSON.stringify({ source: 'invite_trial' }),
        ]
      ) as { rows: InviteTrialClaim[] };

      return {
        status: 'claimed',
        referralCount,
        claim: claimResult.rows[0] || null,
        subscription,
      };
    });

    if (result.status === 'already_claimed') {
      return res.status(409).json({
        success: false,
        code: 'USER_ALREADY_CLAIMED',
        message: '该账号已经领取过邀请试用权益',
        claim: serializeInviteTrialClaim(result.claim),
      });
    }

    if (result.status === 'device_already_claimed') {
      return res.status(409).json({
        success: false,
        code: 'DEVICE_ALREADY_CLAIMED',
        message: '该电脑已经用于领取过邀请试用权益，不能换账号再次领取',
        claim: serializeInviteTrialClaim(result.claim),
      });
    }

    if (result.status === 'not_qualified') {
      return res.status(403).json({
        success: false,
        code: 'NOT_QUALIFIED',
        message: `还需邀请 ${Math.max(0, INVITE_TRIAL_REQUIRED_REFERRALS - result.referralCount)} 个已验证用户`,
        required_referrals: INVITE_TRIAL_REQUIRED_REFERRALS,
        referral_count: result.referralCount,
        remaining_referrals: Math.max(0, INVITE_TRIAL_REQUIRED_REFERRALS - result.referralCount),
      });
    }

    if (result.status === 'already_unlimited') {
      return res.json({
        success: true,
        code: 'ALREADY_UNLIMITED',
        message: '当前账号已是永久权益，无需领取邀请试用',
        subscription: result.subscription,
      });
    }

    logger.info(`[Referral] Invite trial claimed by user ${req.user!.userId} on device ${deviceId}`);

    return res.json({
      success: true,
      code: 'CLAIMED',
      message: `已领取邀请奖励：增加 ${INVITE_TRIAL_BONUS_DAYS} 天试用时长`,
      trial_days: INVITE_TRIAL_BONUS_DAYS,
      access_type: 'invite_trial',
      required_referrals: INVITE_TRIAL_REQUIRED_REFERRALS,
      referral_count: result.referralCount,
      claim: serializeInviteTrialClaim(result.claim),
      subscription: result.subscription,
    });
  } catch (error) {
    logger.error('[Referral] Invite trial claim failed:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: 'Failed to claim invite trial',
    });
  }
});

router.get('/stats', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await referralStore.getReferralStats(req.user!.userId);

    return res.json({
      stats,
    });
  } catch (error) {
    logger.error('[Referral] Get stats failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get referral stats',
    });
  }
});

router.get('/history', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const history = await referralStore.getReferralHistory(req.user!.userId, limit);
    const historyRows = history as Array<typeof history[number] & {
      referee_email?: string;
    }>;

    return res.json({
      history: historyRows.map(h => ({
        id: h.id,
        referee_email: h.referee_email,
        purchase_amount: h.purchase_amount,
        bonus_amount: h.bonus_amount,
        bonus_rate: h.bonus_rate,
        status: h.status,
        source_type: h.source_type,
        created_at: h.created_at,
        settled_at: h.settled_at,
      })),
    });
  } catch (error) {
    logger.error('[Referral] Get history failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get referral history',
    });
  }
});

router.post('/withdraw', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { amount, payment_method, payment_account, account_name } = req.body;

    if (!amount || !payment_method || !payment_account) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'amount, payment_method, and payment_account are required',
      });
    }

    if (amount <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Amount must be positive',
      });
    }

    const withdraw = await referralStore.createWithdrawRequest({
      user_id: req.user!.userId,
      amount,
      payment_method,
      payment_account,
      account_name,
    });

    logger.info(`[Referral] Withdraw request created: ${withdraw.id}`);

    return res.json({
      message: 'Withdraw request submitted',
      withdraw: {
        id: withdraw.id,
        amount: withdraw.amount,
        status: withdraw.status,
        created_at: withdraw.created_at,
      },
    });
  } catch (error) {
    const message = (error as Error).message;
    logger.error('[Referral] Withdraw failed:', message);

    if (message.includes('Insufficient') || message.includes('Minimum')) {
      return res.status(400).json({
        error: 'Bad Request',
        message,
      });
    }

    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Withdraw request failed',
    });
  }
});

router.get('/withdrawals', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const withdrawals = await referralStore.getWithdrawRequests(req.user!.userId);

    return res.json({
      withdrawals: withdrawals.map(w => ({
        id: w.id,
        amount: w.amount,
        payment_method: w.payment_method,
        payment_account: w.payment_account,
        status: w.status,
        created_at: w.created_at,
        processed_at: w.processed_at,
      })),
    });
  } catch (error) {
    logger.error('[Referral] Get withdrawals failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get withdrawals',
    });
  }
});

export default router;
