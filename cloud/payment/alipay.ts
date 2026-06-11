import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface AlipayConfig {
  appId: string;
  privateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  returnUrl: string;
}

export interface AlipayOrder {
  orderId: string;
  amount: number;
  subject: string;
  userId: string;
}

export class AlipayPayment {
  private config: AlipayConfig;
  private gatewayUrl = 'https://openapi.alipay.com/gateway.do';

  constructor(config?: AlipayConfig) {
    this.config = config || this.loadConfigFromEnv();
  }

  private loadConfigFromEnv(): AlipayConfig {
    return {
      appId: process.env.ALIPAY_APP_ID || '',
      privateKey: process.env.ALIPAY_PRIVATE_KEY || '',
      alipayPublicKey: process.env.ALIPAY_PUBLIC_KEY || '',
      notifyUrl: process.env.ALIPAY_NOTIFY_URL || '',
      returnUrl: process.env.ALIPAY_RETURN_URL || '',
    };
  }

  private sign(params: Record<string, string>): string {
    const sortedParams = Object.keys(params)
      .filter(key => params[key] !== '' && params[key] !== undefined)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(sortedParams);
    return sign.sign(this.config.privateKey, 'base64');
  }

  private buildCommonParams(method: string): Record<string, string> {
    return {
      app_id: this.config.appId,
      method: method,
      format: 'JSON',
      charset: 'utf-8',
      sign_type: 'RSA2',
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      version: '1.0',
    };
  }

  async createPageOrder(order: AlipayOrder): Promise<{ success: boolean; payUrl?: string; message?: string }> {
    try {
      const params = this.buildCommonParams('alipay.trade.page.pay');
      
      const bizContent = JSON.stringify({
        out_trade_no: order.orderId,
        total_amount: order.amount.toFixed(2),
        subject: order.subject,
        product_code: 'FAST_INSTANT_TRADE_PAY',
      });

      (params as any).biz_content = bizContent;
      (params as any).notify_url = this.config.notifyUrl;
      (params as any).return_url = this.config.returnUrl;

      const signature = this.sign(params);
      (params as any).sign = signature;

      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key] || '')}`)
        .join('&');

      return {
        success: true,
        payUrl: `${this.gatewayUrl}?${queryString}`,
      };
    } catch (error) {
      logger.error('[Alipay] Create order failed:', error);
      return {
        success: false,
        message: (error as Error).message,
      };
    }
  }

  async createWapOrder(order: AlipayOrder): Promise<{ success: boolean; payUrl?: string; message?: string }> {
    try {
      const params = this.buildCommonParams('alipay.trade.wap.pay');
      
      const bizContent = JSON.stringify({
        out_trade_no: order.orderId,
        total_amount: order.amount.toFixed(2),
        subject: order.subject,
        product_code: 'QUICK_WAP_WAY',
      });

      (params as any).biz_content = bizContent;
      (params as any).notify_url = this.config.notifyUrl;
      (params as any).return_url = this.config.returnUrl;

      const signature = this.sign(params);
      (params as any).sign = signature;

      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key] || '')}`)
        .join('&');

      return {
        success: true,
        payUrl: `${this.gatewayUrl}?${queryString}`,
      };
    } catch (error) {
      logger.error('[Alipay] Create WAP order failed:', error);
      return {
        success: false,
        message: (error as Error).message,
      };
    }
  }

  async queryOrder(orderId: string): Promise<{ paid: boolean; status: string; transactionId?: string }> {
    try {
      const params = this.buildCommonParams('alipay.trade.query');
      
      const bizContent = JSON.stringify({
        out_trade_no: orderId,
      });

      (params as any).biz_content = bizContent;

      const signature = this.sign(params);
      (params as any).sign = signature;

      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key] || '')}`)
        .join('&');

      const response = await fetch(`${this.gatewayUrl}?${queryString}`);
      const result = await response.json() as any;

      const tradeStatus = result?.alipay_trade_query_response?.trade_status;
      
      return {
        paid: tradeStatus === 'TRADE_SUCCESS' || tradeStatus === 'TRADE_FINISHED',
        status: tradeStatus || 'UNKNOWN',
        transactionId: result?.alipay_trade_query_response?.trade_no,
      };
    } catch (error) {
      logger.error('[Alipay] Query order failed:', error);
      return {
        paid: false,
        status: 'UNKNOWN',
      };
    }
  }

  async closeOrder(orderId: string): Promise<boolean> {
    try {
      const params = this.buildCommonParams('alipay.trade.close');
      
      const bizContent = JSON.stringify({
        out_trade_no: orderId,
      });

      (params as any).biz_content = bizContent;

      const signature = this.sign(params);
      (params as any).sign = signature;

      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key] || '')}`)
        .join('&');

      const response = await fetch(`${this.gatewayUrl}?${queryString}`);
      const result = await response.json() as any;

      return result?.alipay_trade_close_response?.code === '10000';
    } catch (error) {
      logger.error('[Alipay] Close order failed:', error);
      return false;
    }
  }

  async refund(orderId: string, refundAmount: number, refundReason: string): Promise<{ success: boolean; refundId?: string }> {
    try {
      const params = this.buildCommonParams('alipay.trade.refund');
      
      const bizContent = JSON.stringify({
        out_trade_no: orderId,
        refund_amount: refundAmount.toFixed(2),
        refund_reason: refundReason,
        out_request_no: `refund_${Date.now()}`,
      });

      (params as any).biz_content = bizContent;

      const signature = this.sign(params);
      (params as any).sign = signature;

      const queryString = Object.keys(params)
        .map(key => `${key}=${encodeURIComponent(params[key] || '')}`)
        .join('&');

      const response = await fetch(`${this.gatewayUrl}?${queryString}`);
      const result = await response.json() as any;

      return {
        success: result?.alipay_trade_refund_response?.code === '10000',
        refundId: result?.alipay_trade_refund_response?.trade_no,
      };
    } catch (error) {
      logger.error('[Alipay] Refund failed:', error);
      return { success: false };
    }
  }

  verifyCallback(params: Record<string, string>): boolean {
    try {
      const sign = params.sign;
      const signType = params.sign_type || 'RSA2';
      
      const paramsWithoutSign = { ...params };
      delete paramsWithoutSign.sign;
      delete paramsWithoutSign.sign_type;

      const sortedParams = Object.keys(paramsWithoutSign)
        .filter(key => paramsWithoutSign[key] !== '' && paramsWithoutSign[key] !== undefined)
        .sort()
        .map(key => `${key}=${paramsWithoutSign[key]}`)
        .join('&');

      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(sortedParams);
      
      return verify.verify(this.config.alipayPublicKey, sign, 'base64');
    } catch (error) {
      logger.error('[Alipay] Verify callback failed:', error);
      return false;
    }
  }
}

export const alipayPayment = new AlipayPayment();