import { randomInt } from 'crypto';
import { DatabaseConnection } from '../database/connection';
import { logger } from '../utils/logger';

export type VerificationType = 'register' | 'reset_password' | 'change_email' | 'change_phone';
export type VerificationStatus = 'pending' | 'used' | 'expired';

export interface VerificationCode {
  id: string;
  email: string;
  code: string;
  type: VerificationType;
  status: VerificationStatus;
  attempts: number;
  expires_at: Date;
  used_at?: Date;
  created_at: Date;
  updated_at: Date;
  metadata?: Record<string, any>;
}

export class VerificationStore {
  private db: DatabaseConnection;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private readonly maxAttempts = 5;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async create(
    email: string,
    type: VerificationType,
    ttlMinutes = 5
  ): Promise<{ code: string; expiresAt: Date }> {
    await this.ensureTable();

    const normalizedEmail = this.normalizeEmail(email);
    await this.expirePending(normalizedEmail, type);

    const code = this.generateCode();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

    const row = await this.db.queryOne<VerificationCode>(
      `INSERT INTO verification_codes (email, code, type, status, expires_at)
       VALUES ($1, $2, $3, 'pending', $4)
       RETURNING *`,
      [normalizedEmail, code, type, expiresAt]
    );

    if (!row) {
      throw new Error('Failed to create verification code');
    }

    logger.info(`[VerificationStore] Created ${type} verification code for ${normalizedEmail}`);
    return { code, expiresAt };
  }

  async verify(
    email: string,
    code: string,
    type: VerificationType
  ): Promise<{ valid: boolean; message: string }> {
    await this.ensureTable();

    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = String(code || '').trim();

    if (!normalizedCode) {
      return { valid: false, message: '请输入验证码' };
    }

    const latest = await this.db.queryOne<VerificationCode>(
      `SELECT *
       FROM verification_codes
       WHERE email = $1 AND type = $2 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 1`,
      [normalizedEmail, type]
    );

    if (!latest) {
      return { valid: false, message: '验证码不存在或已过期，请重新获取' };
    }

    if (new Date(latest.expires_at).getTime() <= Date.now()) {
      await this.markExpired(latest.id);
      return { valid: false, message: '验证码已过期，请重新获取' };
    }

    if (latest.attempts >= this.maxAttempts) {
      await this.markExpired(latest.id);
      return { valid: false, message: '验证码错误次数过多，请重新获取' };
    }

    if (latest.code !== normalizedCode) {
      const attempts = latest.attempts + 1;
      await this.db.query(
        `UPDATE verification_codes
         SET attempts = $1,
             status = CASE WHEN $1 >= $2 THEN 'expired' ELSE status END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [attempts, this.maxAttempts, latest.id]
      );

      if (attempts >= this.maxAttempts) {
        return { valid: false, message: '验证码错误次数过多，请重新获取' };
      }

      return { valid: false, message: '验证码错误' };
    }

    const updated = await this.db.queryOne<VerificationCode>(
      `UPDATE verification_codes
       SET status = 'used', used_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [latest.id]
    );

    if (!updated) {
      return { valid: false, message: '验证码状态异常，请重新获取' };
    }

    logger.info(`[VerificationStore] Verified ${type} code for ${normalizedEmail}`);
    return { valid: true, message: '验证通过' };
  }

  async expirePending(email: string, type: VerificationType): Promise<void> {
    await this.ensureTable();

    await this.db.query(
      `UPDATE verification_codes
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE email = $1 AND type = $2 AND status = 'pending'`,
      [this.normalizeEmail(email), type]
    );
  }

  async cleanupExpired(): Promise<void> {
    await this.ensureTable();

    await this.db.query(
      `UPDATE verification_codes
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`
    );
  }

  private async markExpired(id: string): Promise<void> {
    await this.db.query(
      `UPDATE verification_codes
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'`,
      [id]
    );
  }

  private async ensureTable(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.initializing) {
      this.initializing = this.db.query(`
        CREATE TABLE IF NOT EXISTS verification_codes (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          email VARCHAR(255) NOT NULL,
          code VARCHAR(10) NOT NULL,
          type VARCHAR(30) NOT NULL CHECK (type IN ('register', 'reset_password', 'change_email', 'change_phone')),
          status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'used', 'expired')),
          attempts INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
          used_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          metadata JSONB DEFAULT '{}'::jsonb
        );

        CREATE INDEX IF NOT EXISTS idx_verification_codes_lookup
          ON verification_codes(email, type, status, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_verification_codes_expires_at
          ON verification_codes(expires_at);
      `).then(() => {
        this.initialized = true;
      }).finally(() => {
        this.initializing = null;
      });
    }

    await this.initializing;
  }

  private normalizeEmail(email: string): string {
    return String(email || '').trim().toLowerCase();
  }

  private generateCode(): string {
    return randomInt(100000, 1000000).toString();
  }
}
