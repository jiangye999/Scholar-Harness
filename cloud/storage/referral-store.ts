import { DatabaseConnection } from '../database/connection';
import { ReferralRecord, CreateWithdrawInput, WithdrawRequest } from '../database/types';
import { logger } from '../utils/logger';

export class ReferralStore {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async createReferralRecord(input: {
    referrerId: string;
    refereeId: string;
    sourceType: 'activation_code' | 'subscription' | 'renewal';
    sourceId: string;
    purchaseAmount: number;
  }): Promise<ReferralRecord> {
    const configResult = await this.db.queryOne<{ config_value: string }>(
      "SELECT config_value FROM system_config WHERE config_key = 'referral_bonus_rate'"
    );

    const bonusRate = parseFloat(configResult?.config_value || '30');
    const bonusAmount = input.purchaseAmount * (bonusRate / 100);

    const sql = `
      INSERT INTO referral_records (
        referrer_id, referee_id, source_type, source_id,
        purchase_amount, bonus_rate, bonus_amount, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `;

    const params = [
      input.referrerId,
      input.refereeId,
      input.sourceType,
      input.sourceId,
      input.purchaseAmount,
      bonusRate,
      bonusAmount,
    ];

    const record = await this.db.queryOne<ReferralRecord>(sql, params);

    if (record) {
      await this.db.query(
        'UPDATE users SET referral_earnings = referral_earnings + $1 WHERE id = $2',
        [bonusAmount, input.referrerId]
      );
    }

    logger.info(`[ReferralStore] Created referral record: ${record?.id}, bonus: ${bonusAmount}`);
    return record!;
  }

  async confirmReferral(recordId: string): Promise<void> {
    await this.db.query(
      "UPDATE referral_records SET status = 'confirmed' WHERE id = $1",
      [recordId]
    );
  }

  async getPendingReferrals(userId: string): Promise<ReferralRecord[]> {
    return this.db.query<ReferralRecord>(
      "SELECT * FROM referral_records WHERE referrer_id = $1 AND status = 'pending'",
      [userId]
    );
  }

  async getConfirmedReferrals(userId: string): Promise<ReferralRecord[]> {
    return this.db.query<ReferralRecord>(
      "SELECT * FROM referral_records WHERE referrer_id = $1 AND status = 'confirmed'",
      [userId]
    );
  }

  async getReferralHistory(userId: string, limit: number = 50): Promise<ReferralRecord[]> {
    return this.db.query<ReferralRecord>(
      `SELECT r.*, u.email as referee_email, u.username as referee_name
       FROM referral_records r
       JOIN users u ON r.referee_id = u.id
       WHERE r.referrer_id = $1
       ORDER BY r.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
  }

  async createWithdrawRequest(input: CreateWithdrawInput): Promise<WithdrawRequest> {
    const configResult = await this.db.queryOne<{ config_value: string }>(
      "SELECT config_value FROM system_config WHERE config_key = 'min_withdraw_amount'"
    );

    const minWithdraw = parseFloat(configResult?.config_value || '50');

    if (input.amount < minWithdraw) {
      throw new Error(`Minimum withdrawal amount is ${minWithdraw} CNY`);
    }

    const userResult = await this.db.queryOne<{ referral_earnings: number }>(
      'SELECT referral_earnings FROM users WHERE id = $1',
      [input.user_id]
    );

    if (!userResult || userResult.referral_earnings < input.amount) {
      throw new Error('Insufficient balance');
    }

    return this.db.transaction(async (client) => {
      const withdrawResult = await client.query(
        `INSERT INTO withdraw_requests (
          user_id, amount, currency, payment_method, payment_account, account_name, status
        )
        VALUES ($1, $2, 'CNY', $3, $4, $5, 'pending')
        RETURNING *`,
        [
          input.user_id,
          input.amount,
          input.payment_method,
          input.payment_account,
          input.account_name || null,
        ]
      );

      await client.query(
        'UPDATE users SET referral_earnings = referral_earnings - $1 WHERE id = $2',
        [input.amount, input.user_id]
      );

      return withdrawResult.rows[0] as WithdrawRequest;
    });
  }

  async getWithdrawRequests(userId: string): Promise<WithdrawRequest[]> {
    return this.db.query<WithdrawRequest>(
      'SELECT * FROM withdraw_requests WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
  }

  async getPendingWithdrawRequests(): Promise<WithdrawRequest[]> {
    return this.db.query<WithdrawRequest>(
      "SELECT w.*, u.email, u.username FROM withdraw_requests w JOIN users u ON w.user_id = u.id WHERE w.status = 'pending' ORDER BY created_at ASC"
    );
  }

  async processWithdrawRequest(
    requestId: string, 
    status: 'success' | 'failed' | 'cancelled',
    externalTransactionId?: string,
    notes?: string
  ): Promise<void> {
    const withdraw = await this.db.queryOne<WithdrawRequest>(
      'SELECT * FROM withdraw_requests WHERE id = $1',
      [requestId]
    );

    if (!withdraw) {
      throw new Error('Withdraw request not found');
    }

    await this.db.transaction(async (client) => {
      await client.query(
        `UPDATE withdraw_requests 
         SET status = $1, external_transaction_id = $2, notes = $3, 
             processed_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [status, externalTransactionId || null, notes || null, requestId]
      );

      if (status === 'failed' || status === 'cancelled') {
        await client.query(
          'UPDATE users SET referral_earnings = referral_earnings + $1 WHERE id = $2',
          [withdraw.amount, withdraw.user_id]
        );
      }
    });
  }

  async markReferralsAsPaid(userId: string): Promise<void> {
    await this.db.query(
      "UPDATE referral_records SET status = 'paid', settled_at = CURRENT_TIMESTAMP WHERE referrer_id = $1 AND status = 'confirmed'",
      [userId]
    );
  }

  async getReferralStats(userId: string): Promise<{
    totalReferrals: number;
    totalEarnings: number;
    pendingBonus: number;
    paidBonus: number;
    confirmedBonus: number;
  }> {
    const sql = `
      SELECT 
        COUNT(*) as total_referrals,
        COALESCE(SUM(bonus_amount), 0) as total_earnings,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN bonus_amount ELSE 0 END), 0) as pending_bonus,
        COALESCE(SUM(CASE WHEN status = 'confirmed' THEN bonus_amount ELSE 0 END), 0) as confirmed_bonus,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN bonus_amount ELSE 0 END), 0) as paid_bonus
      FROM referral_records
      WHERE referrer_id = $1
    `;

    const result = await this.db.queryOne<{
      total_referrals: string;
      total_earnings: string;
      pending_bonus: string;
      confirmed_bonus: string;
      paid_bonus: string;
    }>(sql, [userId]);

    return {
      totalReferrals: parseInt(result?.total_referrals || '0', 10),
      totalEarnings: parseFloat(result?.total_earnings || '0'),
      pendingBonus: parseFloat(result?.pending_bonus || '0'),
      confirmedBonus: parseFloat(result?.confirmed_bonus || '0'),
      paidBonus: parseFloat(result?.paid_bonus || '0'),
    };
  }
}