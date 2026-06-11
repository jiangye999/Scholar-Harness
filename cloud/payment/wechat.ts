import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface WechatPayConfig {
  appId: string;
  mchId: string;
  apiKey: string;
  apiV3Key: string;
  serialNo: string;
  privateKey: string;
  notifyUrl: string;
}

export interface PaymentOrder {
  orderId: string;
  amount: number;
  description: string;
  userId: string;
}

export interface PaymentResult {
  success: boolean;
  orderId?: string;
  prepayId?: string;
  codeUrl?: string;
  h5Url?: string;
  message?: string;
}

export class WechatPayment {
  private config: WechatPayConfig;

  constructor(config?: WechatPayConfig) {
    this.config = config || this.loadConfigFromEnv();
  }

  private loadConfigFromEnv(): WechatPayConfig {
    return {
      appId: process.env.WECHAT_APP_ID || '',
      mchId: process.env.WECHAT_MCH_ID || '',
      apiKey: process.env.WECHAT_API_KEY || '',
      apiV3Key: process.env.WECHAT_API_V3_KEY || '',
      serialNo: process.env.WECHAT_SERIAL_NO || '',
      privateKey: process.env.WECHAT_PRIVATE_KEY || '',
      notifyUrl: process.env.WECHAT_NOTIFY_URL || '',
    };
  }

  private generateSignature(message: string): string {
    return crypto
      .createSign('RSA-SHA256')
      .update(message)
      .sign(this.config.privateKey, 'base64');
  }

  private generateNonceStr(length: number = 32): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  private buildAuthorization(method: string, url: string, body: string): string {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonceStr = this.generateNonceStr();
    const message = `${method}\n${url}\n${timestamp}\n${nonceStr}\n${body}\n`;
    const signature = this.generateSignature(message);

    return `WECHATPAY2-SHA256-RSA2048 mchid="${this.config.mchId}",nonce_str="${nonceStr}",timestamp="${timestamp}",serial_no="${this.config.serialNo}",signature="${signature}"`;
  }

  async createNativeOrder(order: PaymentOrder): Promise<PaymentResult> {
    try {
      const url = 'https://api.mch.weixin.qq.com/v3/pay/transactions/native';
      const body = {
        appid: this.config.appId,
        mchid: this.config.mchId,
        description: order.description,
        out_trade_no: order.orderId,
        notify_url: this.config.notifyUrl,
        amount: {
          total: Math.round(order.amount * 100),
          currency: 'CNY',
        },
      };

      const bodyStr = JSON.stringify(body);
      const authorization = this.buildAuthorization('POST', '/v3/pay/transactions/native', bodyStr);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': authorization,
        },
        body: bodyStr,
      });

      const result = await response.json() as any;

      if (response.ok && result.code_url) {
        return {
          success: true,
          orderId: order.orderId,
          codeUrl: result.code_url,
        };
      }

      return {
        success: false,
        message: result.message || 'Failed to create order',
      };
    } catch (error) {
      logger.error('[WechatPay] Create order failed:', error);
      return {
        success: false,
        message: (error as Error).message,
      };
    }
  }

  async queryOrder(orderId: string): Promise<{ paid: boolean; status: string; transactionId?: string }> {
    try {
      const url = `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${orderId}?mchid=${this.config.mchId}`;
      const authorization = this.buildAuthorization('GET', `/v3/pay/transactions/out-trade-no/${orderId}?mchid=${this.config.mchId}`, '');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': authorization,
        },
      });

      const result = await response.json() as any;

      return {
        paid: result.trade_state === 'SUCCESS',
        status: result.trade_state,
        transactionId: result.transaction_id,
      };
    } catch (error) {
      logger.error('[WechatPay] Query order failed:', error);
      return {
        paid: false,
        status: 'UNKNOWN',
      };
    }
  }

  async closeOrder(orderId: string): Promise<boolean> {
    try {
      const url = `https://api.mch.weixin.qq.com/v3/pay/transactions/out-trade-no/${orderId}/close`;
      const body = JSON.stringify({ mchid: this.config.mchId });
      const authorization = this.buildAuthorization('POST', `/v3/pay/transactions/out-trade-no/${orderId}/close`, body);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authorization,
        },
        body,
      });

      return response.ok;
    } catch (error) {
      logger.error('[WechatPay] Close order failed:', error);
      return false;
    }
  }

  decryptResource(resource: {
    associated_data?: string;
    nonce?: string;
    ciphertext?: string;
    out_trade_no?: string;
    transaction_id?: string;
    amount?: { total?: number; currency?: string };
  }): Record<string, any> {
    if (resource.out_trade_no) {
      return resource as Record<string, any>;
    }

    if (!resource.ciphertext || !resource.nonce) {
      throw new Error('Invalid WeChat callback resource');
    }

    if (!this.config.apiV3Key || this.config.apiV3Key.length !== 32) {
      throw new Error('WECHAT_API_V3_KEY must be configured as a 32-byte key');
    }

    const ciphertext = Buffer.from(resource.ciphertext, 'base64');
    const authTag = ciphertext.subarray(ciphertext.length - 16);
    const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.apiV3Key, 'utf8'),
      Buffer.from(resource.nonce, 'utf8')
    );

    if (resource.associated_data) {
      decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    }
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  }

  verifyCallback(body: string, signature: string, timestamp: string, nonce: string): boolean {
    if (!signature || !timestamp || !nonce) {
      const allowUnsigned = process.env.PAYMENT_ALLOW_UNSIGNED_CALLBACKS === 'true' || process.env.NODE_ENV !== 'production';
      if (!allowUnsigned) {
        logger.warn('[WechatPay] Missing callback signature headers');
      }
      return allowUnsigned;
    }

    const platformPublicKey = process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY || process.env.WECHAT_PLATFORM_PUBLIC_KEY || '';
    if (!platformPublicKey) {
      const allowUnsigned = process.env.PAYMENT_ALLOW_UNSIGNED_CALLBACKS === 'true';
      logger.warn('[WechatPay] WECHAT_PAY_PLATFORM_PUBLIC_KEY is not configured');
      return allowUnsigned;
    }

    const message = `${timestamp}\n${nonce}\n${body}\n`;
    try {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(message);
      verify.end();
      return verify.verify(platformPublicKey, signature, 'base64');
    } catch (error) {
      logger.error('[WechatPay] Verify callback failed:', error);
      return false;
    }
  }

  async refund(orderId: string, refundId: string, totalAmount: number, refundAmount: number, reason: string): Promise<{ success: boolean; refundId?: string }> {
    try {
      const url = 'https://api.mch.weixin.qq.com/v3/refund/domestic/refunds';
      const body = {
        out_trade_no: orderId,
        out_refund_no: refundId,
        reason: reason,
        amount: {
          total: Math.round(totalAmount * 100),
          refund: Math.round(refundAmount * 100),
          currency: 'CNY',
        },
      };

      const bodyStr = JSON.stringify(body);
      const authorization = this.buildAuthorization('POST', '/v3/refund/domestic/refunds', bodyStr);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': authorization,
        },
        body: bodyStr,
      });

      const result = await response.json() as any;

      return {
        success: response.ok,
        refundId: result.refund_id,
      };
    } catch (error) {
      logger.error('[WechatPay] Refund failed:', error);
      return { success: false };
    }
  }
}

export const wechatPayment = new WechatPayment();
