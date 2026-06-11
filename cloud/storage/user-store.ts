import { DatabaseConnection } from '../database/connection';
import { User, CreateUserInput } from '../database/types';
import { hashPassword, verifyPassword, generateReferralCode } from '../auth/crypto';
import { JWTPayload, generateTokenPair } from '../auth/jwt';
import { logger } from '../utils/logger';

export class UserStore {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async create(input: CreateUserInput): Promise<User> {
    // 合规验证：必须同意隐私政策和用户协议
    if (!input.accept_privacy_policy) {
      throw new Error('必须同意隐私政策才能注册');
    }
    if (!input.accept_user_agreement) {
      throw new Error('必须同意用户协议才能注册');
    }
    
    const passwordHash = await hashPassword(input.password);
    const referralCode = generateReferralCode();

    let referredBy: string | null = null;
    if (input.referral_code) {
      const referrer = await this.findByReferralCode(input.referral_code);
      if (referrer) {
        referredBy = referrer.id;
      }
    }

    // 当前法律文档版本
    const PRIVACY_POLICY_VERSION = 'V1.3';
    const USER_AGREEMENT_VERSION = 'V1.3';

    const sql = `
      INSERT INTO users (email, password_hash, username, phone, source, referral_code, referred_by, role,
        privacy_policy_accepted_at, user_agreement_accepted_at, cross_border_transfer_accepted_at,
        privacy_policy_version, user_agreement_version)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `;

    const params = [
      input.email.toLowerCase(),
      passwordHash,
      input.username || input.email.split('@')[0],
      input.phone || null,
      input.source,
      referralCode,
      referredBy,
      'user',
      new Date(),  // privacy_policy_accepted_at
      new Date(),  // user_agreement_accepted_at
      input.accept_cross_border_transfer ? new Date() : null,
      input.privacy_policy_version || PRIVACY_POLICY_VERSION,
      input.user_agreement_version || USER_AGREEMENT_VERSION,
    ];

    const user = await this.db.queryOne<User>(sql, params);
    
    if (!user) {
      throw new Error('Failed to create user');
    }

    logger.info(`[UserStore] Created user: ${user.id} (${user.email}) | privacy_accepted=${!!user.privacy_policy_accepted_at} | cross_border=${!!user.cross_border_transfer_accepted_at}`);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE email = $1',
      [email.toLowerCase()]
    );
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE phone = $1',
      [phone]
    );
  }

  async findByReferralCode(code: string): Promise<User | null> {
    return this.db.queryOne<User>(
      'SELECT * FROM users WHERE referral_code = $1',
      [code.toUpperCase()]
    );
  }

  async ensureReferralCode(userId: string): Promise<string> {
    const existing = await this.findById(userId);
    if (existing?.referral_code) {
      return existing.referral_code;
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      const referralCode = generateReferralCode();
      try {
        const updated = await this.db.queryOne<{ referral_code: string }>(
          `UPDATE users
           SET referral_code = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2 AND (referral_code IS NULL OR referral_code = '')
           RETURNING referral_code`,
          [referralCode, userId]
        );

        if (updated?.referral_code) {
          return updated.referral_code;
        }

        const latest = await this.findById(userId);
        if (latest?.referral_code) {
          return latest.referral_code;
        }
      } catch (error) {
        if ((error as { code?: string }).code !== '23505') {
          throw error;
        }
      }
    }

    throw new Error('Failed to generate referral code');
  }

  async validateCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.findByEmail(email);
    
    if (!user) {
      return null;
    }

    const isValid = await verifyPassword(password, user.password_hash);
    
    if (!isValid) {
      return null;
    }

    await this.updateLastLogin(user.id);
    return user;
  }

  async updateLastLogin(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = $1',
      [userId]
    );
  }

  async updateProfile(userId: string, updates: { username?: string; avatar_url?: string }): Promise<User | null> {
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (updates.username) {
      setClauses.push(`username = $${paramIndex++}`);
      params.push(updates.username);
    }
    if (updates.avatar_url) {
      setClauses.push(`avatar_url = $${paramIndex++}`);
      params.push(updates.avatar_url);
    }

    if (setClauses.length === 0) {
      return this.findById(userId);
    }

    params.push(userId);
    const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    
    return this.db.queryOne<User>(sql, params);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<boolean> {
    const user = await this.findById(userId);
    
    if (!user) {
      return false;
    }

    const isValid = await verifyPassword(oldPassword, user.password_hash);
    
    if (!isValid) {
      return false;
    }

    const newHash = await hashPassword(newPassword);
    
    await this.db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2',
      [newHash, userId]
    );

    return true;
  }

  async updateStatus(userId: string, status: User['status']): Promise<void> {
    await this.db.query(
      'UPDATE users SET status = $1 WHERE id = $2',
      [status, userId]
    );
  }

  async updateRole(userId: string, role: User['role']): Promise<void> {
    await this.db.query(
      'UPDATE users SET role = $1 WHERE id = $2',
      [role, userId]
    );
  }

  async verifyEmail(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE users SET email_verified = TRUE WHERE id = $1',
      [userId]
    );
  }

  async verifyPhone(userId: string): Promise<void> {
    await this.db.query(
      'UPDATE users SET phone_verified = TRUE WHERE id = $1',
      [userId]
    );
  }

  async incrementReferralEarnings(userId: string, amount: number): Promise<void> {
    await this.db.query(
      'UPDATE users SET referral_earnings = referral_earnings + $1 WHERE id = $2',
      [amount, userId]
    );
  }

  async getReferralStats(userId: string): Promise<{
    totalReferrals: number;
    totalEarnings: number;
    pendingBonus: number;
    paidBonus: number;
  }> {
    const sql = `
      SELECT 
        COUNT(*) as total_referrals,
        COALESCE(SUM(bonus_amount), 0) as total_earnings,
        COALESCE(SUM(CASE WHEN status = 'pending' THEN bonus_amount ELSE 0 END), 0) as pending_bonus,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN bonus_amount ELSE 0 END), 0) as paid_bonus
      FROM referral_records
      WHERE referrer_id = $1
    `;

    const result = await this.db.queryOne<{
      total_referrals: string;
      total_earnings: string;
      pending_bonus: string;
      paid_bonus: string;
    }>(sql, [userId]);

    return {
      totalReferrals: parseInt(result?.total_referrals || '0', 10),
      totalEarnings: parseFloat(result?.total_earnings || '0'),
      pendingBonus: parseFloat(result?.pending_bonus || '0'),
      paidBonus: parseFloat(result?.paid_bonus || '0'),
    };
  }

  async delete(userId: string): Promise<boolean> {
    const result = await this.db.query(
      "UPDATE users SET status = 'deleted' WHERE id = $1",
      [userId]
    );
    return true;
  }

  async list(options: { limit?: number; offset?: number; status?: string }): Promise<User[]> {
    let sql = 'SELECT * FROM users';
    const params: any[] = [];
    const conditions: string[] = [];

    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    if (options.limit) {
      params.push(options.limit);
      sql += ` LIMIT $${params.length}`;
    }

    if (options.offset) {
      params.push(options.offset);
      sql += ` OFFSET $${params.length}`;
    }

    return this.db.query<User>(sql, params);
  }

  generateUserTokens(user: User): { accessToken: string; refreshToken: string; expiresIn: number } {
    const payload: JWTPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      source: user.source,
    };

    return generateTokenPair(payload);
  }
}
