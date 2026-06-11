import { DatabaseConnection } from '../database/connection';
import { ActivationCode, Activation, ActivateCodeInput, CreateActivationCodeInput } from '../database/types';
import { generateRandomToken, generateDeviceHash } from '../auth/crypto';
import { logger } from '../utils/logger';

export class ActivationStore {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  async generateCode(input: CreateActivationCodeInput): Promise<ActivationCode[]> {
    const codes: ActivationCode[] = [];
    const batchId = input.batch_id || `batch-${Date.now()}`;

    for (let i = 0; i < input.quantity; i++) {
      const code = generateRandomToken(16);
      
      const sql = `
        INSERT INTO activation_codes (
          code, code_type, price, currency, validity_days, 
          batch_id, batch_name, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'unused')
        RETURNING *
      `;

      const params = [
        code,
        input.code_type,
        input.price,
        'CNY',
        input.validity_days || 365,
        batchId,
        input.batch_name || null,
      ];

      const result = await this.db.queryOne<ActivationCode>(sql, params);
      if (result) {
        codes.push(result);
      }
    }

    logger.info(`[ActivationStore] Generated ${codes.length} codes in batch ${batchId}`);
    return codes;
  }

  async findByCode(code: string): Promise<ActivationCode | null> {
    return this.db.queryOne<ActivationCode>(
      'SELECT * FROM activation_codes WHERE code = $1',
      [code.toUpperCase()]
    );
  }

  async findById(id: string): Promise<ActivationCode | null> {
    return this.db.queryOne<ActivationCode>(
      'SELECT * FROM activation_codes WHERE id = $1',
      [id]
    );
  }

  async purchaseCode(
    codeId: string, 
    userId: string, 
    referralCodeUsed?: string
  ): Promise<ActivationCode | null> {
    return this.db.transaction(async (client) => {
      const codeResult = await client.query(
        'SELECT * FROM activation_codes WHERE id = $1 FOR UPDATE',
        [codeId]
      );
      
      const code = codeResult.rows[0] as ActivationCode;
      
      if (!code || code.status !== 'unused') {
        throw new Error('Code not available');
      }

      let referralBonus = 0;
      
      if (referralCodeUsed) {
        const referrer = await client.query(
          'SELECT id FROM users WHERE referral_code = $1',
          [referralCodeUsed.toUpperCase()]
        );
        
        if (referrer.rows.length > 0) {
          const configResult = await client.query(
            "SELECT config_value FROM system_config WHERE config_key = 'referral_bonus_rate'"
          );
          const bonusRate = parseFloat(configResult.rows[0]?.config_value || '30');
          referralBonus = code.price * (bonusRate / 100);
        }
      }

      const updateResult = await client.query(
        `UPDATE activation_codes 
         SET purchaser_id = $1, status = 'used', used_at = CURRENT_TIMESTAMP,
             referral_code_used = $2, referral_bonus = $3
         WHERE id = $4
         RETURNING *`,
        [userId, referralCodeUsed || null, referralBonus, codeId]
      );

      return updateResult.rows[0] as ActivationCode;
    });
  }

  async activateCode(input: ActivateCodeInput): Promise<{ activation: Activation; code: ActivationCode }> {
    const code = await this.findByCode(input.code);

    if (!code) {
      throw new Error('Invalid activation code');
    }

    if (code.status === 'used' && code.purchaser_id !== input.user_id) {
      throw new Error('Code already used by another user');
    }

    if (code.status === 'expired' || code.status === 'disabled') {
      throw new Error(`Code is ${code.status}`);
    }

    const existingActivation = await this.db.queryOne<Activation>(
      'SELECT * FROM activations WHERE code_id = $1 AND status = $2',
      [code.id, 'active']
    );

    if (existingActivation) {
      throw new Error('Code already activated on another device');
    }

    const hardwareHash = generateDeviceHash(input.device_id, input.device_name, input.device_os);
    const activationToken = generateRandomToken(32);
    
    const validityDays = code.validity_days === -1 ? 36500 : code.validity_days;
    const expiresAt = new Date(Date.now() + validityDays * 24 * 60 * 60 * 1000);

    const sql = `
      INSERT INTO activations (
        code_id, user_id, status, device_id, device_name, device_os,
        device_ip, activation_token, hardware_hash, expires_at
      )
      VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const params = [
      code.id,
      input.user_id,
      input.device_id,
      input.device_name || null,
      input.device_os || null,
      input.device_ip || null,
      activationToken,
      hardwareHash,
      expiresAt,
    ];

    const activation = await this.db.queryOne<Activation>(sql, params);

    if (!activation) {
      throw new Error('Failed to create activation');
    }

    await this.db.query(
      `UPDATE activation_codes SET activation_id = $1, status = 'used', used_at = CURRENT_TIMESTAMP 
       WHERE id = $2`,
      [activation.id, code.id]
    );

    logger.info(`[ActivationStore] Code activated: ${code.code} by user ${input.user_id}`);

    return { activation, code };
  }

  async verifyActivation(activationToken: string, deviceId: string): Promise<Activation | null> {
    const activation = await this.db.queryOne<Activation>(
      'SELECT * FROM activations WHERE activation_token = $1',
      [activationToken]
    );

    if (!activation) {
      return null;
    }

    if (activation.device_id !== deviceId) {
      logger.warn(`[ActivationStore] Device mismatch for activation ${activation.id}`);
      return null;
    }

    if (activation.status !== 'active') {
      return null;
    }

    if (new Date() > activation.expires_at) {
      await this.db.query(
        "UPDATE activations SET status = 'expired' WHERE id = $1",
        [activation.id]
      );
      return null;
    }

    await this.db.query(
      'UPDATE activations SET last_verified_at = CURRENT_TIMESTAMP, verification_count = verification_count + 1 WHERE id = $1',
      [activation.id]
    );

    return activation;
  }

  async getActivationsByUser(userId: string): Promise<Activation[]> {
    return this.db.query<Activation>(
      `SELECT a.*, ac.code, ac.code_type, ac.validity_days
       FROM activations a
       JOIN activation_codes ac ON a.code_id = ac.id
       WHERE a.user_id = $1
       ORDER BY a.activated_at DESC`,
      [userId]
    );
  }

  async getCodesByPurchaser(userId: string): Promise<ActivationCode[]> {
    return this.db.query<ActivationCode>(
      'SELECT * FROM activation_codes WHERE purchaser_id = $1 ORDER BY created_at DESC',
      [userId]
    );
  }

  async deactivateActivation(activationId: string): Promise<void> {
    await this.db.query(
      "UPDATE activations SET status = 'revoked' WHERE id = $1",
      [activationId]
    );
  }

  async extendActivation(activationId: string, days: number): Promise<Activation | null> {
    return this.db.queryOne<Activation>(
      `UPDATE activations 
       SET expires_at = expires_at + INTERVAL '${days} days'
       WHERE id = $1
       RETURNING *`,
      [activationId]
    );
  }

  async listCodes(options: {
    status?: string;
    batchId?: string;
    limit?: number;
    offset?: number;
  }): Promise<ActivationCode[]> {
    let sql = 'SELECT * FROM activation_codes';
    const params: any[] = [];
    const conditions: string[] = [];

    if (options.status) {
      params.push(options.status);
      conditions.push(`status = $${params.length}`);
    }

    if (options.batchId) {
      params.push(options.batchId);
      conditions.push(`batch_id = $${params.length}`);
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

    return this.db.query<ActivationCode>(sql, params);
  }

  async checkAndUpdateExpiredActivations(): Promise<number> {
    const expired = await this.db.query<{ id: string }>(
      `UPDATE activations
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'active'
         AND expires_at <= CURRENT_TIMESTAMP
       RETURNING id`
    );

    if (expired.length > 0) {
      logger.info(`[ActivationStore] Updated ${expired.length} expired activations`);
    }

    return expired.length;
  }

  async checkAndUpdateExpiredActivationCodes(): Promise<number> {
    const expired = await this.db.query<{ id: string }>(
      `UPDATE activation_codes
       SET status = 'expired', updated_at = CURRENT_TIMESTAMP
       WHERE status = 'unused'
         AND expires_at IS NOT NULL
         AND expires_at <= CURRENT_TIMESTAMP
       RETURNING id`
    );

    if (expired.length > 0) {
      logger.info(`[ActivationStore] Updated ${expired.length} expired activation codes`);
    }

    return expired.length;
  }
}
