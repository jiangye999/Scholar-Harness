import { Router, Request, Response } from 'express';
import { DatabaseConnection } from '../../database/connection';
import { Payment } from '../../database/types';
import { wechatPayment } from '../../payment/wechat';
import { alipayPayment } from '../../payment/alipay';
import { logger } from '../../utils/logger';
import { authMiddleware, AuthenticatedRequest } from '../middleware/auth';
import { recordSecurityEvent } from '../middleware/security';

const router = Router();

let db: DatabaseConnection;

type PgClient = {
  query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[] }>;
};

const PAYMENT_TYPES = new Set(['subscription', 'activation_code', 'renewal']);
const PAYMENT_METHODS = new Set(['wechat', 'alipay']);
const MAX_PAYMENT_AMOUNT_CNY = 100000;

export function initializePaymentRoutes(database: DatabaseConnection): void {
  db = database;
}

function normalizeAmount(value: unknown): number | null {
  const amount = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_PAYMENT_AMOUNT_CNY) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

function amountsMatch(left: number | string, right: number | string): boolean {
  return Math.round(Number(left) * 100) === Math.round(Number(right) * 100);
}

async function validateRelatedPayment(
  userId: string,
  paymentType: string,
  relatedId: string | null,
  amount: number
): Promise<{ ok: boolean; message?: string; metadata?: Record<string, unknown> }> {
  if (!relatedId) {
    return { ok: true };
  }

  if (paymentType === 'subscription' || paymentType === 'renewal') {
    const subscription = await db.queryOne<{ id: string; user_id: string; price: string; status: string }>(
      'SELECT id, user_id, price, status FROM subscriptions WHERE id = $1',
      [relatedId]
    );

    if (!subscription || subscription.user_id !== userId) {
      return {
        ok: false,
        message: 'Related subscription not found for this user',
        metadata: { related_id: relatedId, payment_type: paymentType },
      };
    }

    if (!amountsMatch(subscription.price, amount)) {
      return {
        ok: false,
        message: 'Payment amount does not match subscription price',
        metadata: { related_id: relatedId, expected: subscription.price, actual: amount },
      };
    }
  }

  if (paymentType === 'activation_code') {
    const activationCode = await db.queryOne<{ id: string; purchaser_id: string | null; price: string; status: string }>(
      'SELECT id, purchaser_id, price, status FROM activation_codes WHERE id = $1',
      [relatedId]
    );

    if (!activationCode) {
      return {
        ok: false,
        message: 'Related activation code not found',
        metadata: { related_id: relatedId, payment_type: paymentType },
      };
    }

    if (activationCode.price !== null && !amountsMatch(activationCode.price, amount)) {
      return {
        ok: false,
        message: 'Payment amount does not match activation code price',
        metadata: { related_id: relatedId, expected: activationCode.price, actual: amount },
      };
    }
  }

  return { ok: true };
}

async function completePaidOrder(input: {
  client: PgClient;
  paymentId: string;
  method: 'wechat' | 'alipay';
  transactionId?: string | null;
  providerAmount?: number | null;
  providerPayload?: Record<string, unknown>;
}): Promise<{ ok: boolean; idempotent?: boolean; statusCode?: number; message?: string; payment?: Payment }> {
  const paymentResult = await input.client.query<Payment>(
    'SELECT * FROM payments WHERE id = $1 FOR UPDATE',
    [input.paymentId]
  );
  const payment = paymentResult.rows[0];

  if (!payment) {
    return { ok: false, statusCode: 404, message: 'Payment not found' };
  }

  if (payment.payment_method !== input.method) {
    return {
      ok: false,
      statusCode: 409,
      message: `Payment method mismatch: expected ${payment.payment_method}, got ${input.method}`,
      payment,
    };
  }

  if (payment.status === 'success') {
    if (input.transactionId && payment.external_payment_id && payment.external_payment_id !== input.transactionId) {
      return {
        ok: false,
        statusCode: 409,
        message: 'Successful payment has a different provider transaction id',
        payment,
      };
    }
    return { ok: true, idempotent: true, payment };
  }

  if (payment.status !== 'pending' && payment.status !== 'processing') {
    return {
      ok: false,
      statusCode: 409,
      message: `Payment is not payable in status ${payment.status}`,
      payment,
    };
  }

  if (input.providerAmount !== null && input.providerAmount !== undefined && !amountsMatch(payment.amount, input.providerAmount)) {
    await input.client.query(
      `UPDATE payments
       SET risk_status = 'blocked',
           risk_score = GREATEST(COALESCE(risk_score, 0), 90),
           metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          payment_risk: 'amount_mismatch',
          expected_amount: payment.amount,
          provider_amount: input.providerAmount,
        }),
        payment.id,
      ]
    );
    return {
      ok: false,
      statusCode: 409,
      message: 'Payment amount mismatch',
      payment,
    };
  }

  const updatedResult = await input.client.query<Payment>(
    `UPDATE payments
     SET status = 'success',
         paid_at = CURRENT_TIMESTAMP,
         external_payment_id = $1,
         risk_status = 'passed',
         risk_score = 0,
         metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id = $3
     RETURNING *`,
    [
      input.transactionId || null,
      JSON.stringify({
        provider_callback: input.providerPayload || {},
        completed_at: new Date().toISOString(),
      }),
      payment.id,
    ]
  );
  const updatedPayment = updatedResult.rows[0] || payment;

  if ((payment.payment_type === 'subscription' || payment.payment_type === 'renewal') && payment.related_id) {
    await input.client.query(
      `UPDATE subscriptions
       SET status = 'active',
           last_payment_id = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
         AND user_id = $3`,
      [payment.id, payment.related_id, payment.user_id]
    );
  }

  if (payment.payment_type === 'activation_code' && payment.related_id) {
    await input.client.query(
      `UPDATE activation_codes
       SET purchaser_id = COALESCE(purchaser_id, $1),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [payment.user_id, payment.related_id]
    );
  }

  return { ok: true, payment: updatedPayment };
}

router.post('/create', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { payment_type, related_id, amount, payment_method, referral_code } = req.body;

    if (!payment_type || !amount || !payment_method) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'payment_type, amount, and payment_method are required',
      });
    }

    if (!PAYMENT_TYPES.has(payment_type) || !PAYMENT_METHODS.has(payment_method)) {
      void recordSecurityEvent({
        req,
        eventType: 'payment.create.invalid_request',
        riskLevel: 'medium',
        statusCode: 400,
        metadata: { payment_type, payment_method },
      });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid payment_type or payment_method',
      });
    }

    const normalizedAmount = normalizeAmount(amount);
    if (normalizedAmount === null) {
      void recordSecurityEvent({
        req,
        eventType: 'payment.create.invalid_amount',
        riskLevel: 'medium',
        statusCode: 400,
        metadata: { payment_type, payment_method, amount },
      });
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid payment amount',
      });
    }

    const relatedId = typeof related_id === 'string' && related_id.trim() ? related_id.trim() : null;
    const relatedValidation = await validateRelatedPayment(
      req.user!.userId,
      payment_type,
      relatedId,
      normalizedAmount
    );

    if (!relatedValidation.ok) {
      void recordSecurityEvent({
        req,
        eventType: 'payment.create.related_mismatch',
        riskLevel: 'high',
        statusCode: 409,
        metadata: relatedValidation.metadata,
      });
      return res.status(409).json({
        error: 'Conflict',
        message: relatedValidation.message,
      });
    }

    const sql = `
      INSERT INTO payments (
        user_id, payment_type, related_id, amount, currency,
        payment_method, status, risk_status, risk_score, metadata
      )
      VALUES ($1, $2, $3, $4, 'CNY', $5, 'pending', 'passed', 0, $6)
      RETURNING *
    `;

    const payment = await db.queryOne<Payment>(sql, [
      req.user!.userId,
      payment_type,
      relatedId,
      normalizedAmount,
      payment_method,
      JSON.stringify({
        referral_code: typeof referral_code === 'string' ? referral_code.trim() : undefined,
        device_id: req.securityContext?.deviceId || null,
        ip_address: req.securityContext?.ipAddress || null,
        request_id: req.securityContext?.requestId || null,
      }),
    ]);

    if (!payment) {
      return res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to create payment',
      });
    }

    let payUrl: string | undefined;
    let codeUrl: string | undefined;

    if (payment_method === 'wechat') {
      const result = await wechatPayment.createNativeOrder({
        orderId: payment.id,
        amount: payment.amount,
        description: `Scholar Harness - ${payment_type}`,
        userId: req.user!.userId,
      });

      if (result.success) {
        codeUrl = result.codeUrl;
      } else {
        return res.status(400).json({
          error: 'Bad Request',
          message: result.message || 'Failed to create WeChat payment',
        });
      }
    } else if (payment_method === 'alipay') {
      const result = await alipayPayment.createPageOrder({
        orderId: payment.id,
        amount: payment.amount,
        subject: `Scholar Harness - ${payment_type}`,
        userId: req.user!.userId,
      });

      if (result.success) {
        payUrl = result.payUrl;
      } else {
        return res.status(400).json({
          error: 'Bad Request',
          message: result.message || 'Failed to create Alipay payment',
        });
      }
    } else {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Unsupported payment method',
      });
    }

    return res.json({
      message: 'Payment created',
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        payment_method: payment.payment_method,
        status: payment.status,
        created_at: payment.created_at,
      },
      pay_url: payUrl,
      code_url: codeUrl,
    });
  } catch (error) {
    logger.error('[Payment] Create payment failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to create payment',
    });
  }
});

router.get('/query/:paymentId', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { paymentId } = req.params;

    const payment = await db.queryOne<Payment>(
      'SELECT * FROM payments WHERE id = $1 AND user_id = $2',
      [paymentId, req.user!.userId]
    );

    if (!payment) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Payment not found',
      });
    }

    let paid = false;
    let transactionId: string | undefined;

    if (payment.payment_method === 'wechat') {
      const result = await wechatPayment.queryOrder(paymentId);
      paid = result.paid;
      transactionId = result.transactionId;
    } else if (payment.payment_method === 'alipay') {
      const result = await alipayPayment.queryOrder(paymentId);
      paid = result.paid;
      transactionId = result.transactionId;
    }

    if (paid && payment.status !== 'success') {
      await db.query(
        `UPDATE payments SET status = 'success', paid_at = CURRENT_TIMESTAMP, external_payment_id = $1 
         WHERE id = $2`,
        [transactionId, paymentId]
      );
      payment.status = 'success';
    }

    return res.json({
      payment: {
        id: payment.id,
        amount: payment.amount,
        currency: payment.currency,
        payment_method: payment.payment_method,
        status: payment.status,
        created_at: payment.created_at,
        paid_at: payment.paid_at,
      },
    });
  } catch (error) {
    logger.error('[Payment] Query payment failed:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to query payment',
    });
  }
});

router.post('/wechat/callback', async (req: Request, res: Response) => {
  try {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : JSON.stringify(req.body || {});
    const body = Buffer.isBuffer(req.body) ? JSON.parse(rawBody) : req.body;
    const signature = String(req.headers['wechatpay-signature'] || '');
    const timestamp = String(req.headers['wechatpay-timestamp'] || '');
    const nonce = String(req.headers['wechatpay-nonce'] || '');

    if (!wechatPayment.verifyCallback(rawBody, signature, timestamp, nonce)) {
      void recordSecurityEvent({
        req,
        eventType: 'payment.wechat.invalid_signature',
        riskLevel: 'critical',
        statusCode: 400,
      });
      return res.status(400).send('FAIL');
    }

    const { resource } = body || {};

    if (!resource) {
      return res.status(400).send('FAIL');
    }

    const decryptedResource = wechatPayment.decryptResource(resource);
    const paymentId = decryptedResource.out_trade_no;
    const transactionId = decryptedResource.transaction_id;
    const providerAmount = typeof decryptedResource.amount?.total === 'number'
      ? decryptedResource.amount.total / 100
      : null;

    if (!paymentId) {
      void recordSecurityEvent({
        req,
        eventType: 'payment.wechat.missing_order',
        riskLevel: 'high',
        statusCode: 400,
      });
      return res.status(400).send('FAIL');
    }

    const result = await db.transaction((client: PgClient) => completePaidOrder({
      client,
      paymentId,
      method: 'wechat',
      transactionId,
      providerAmount,
      providerPayload: {
        trade_state: decryptedResource.trade_state,
        amount: decryptedResource.amount,
      },
    }));

    if (!result.ok) {
      void recordSecurityEvent({
        req,
        eventType: 'payment.wechat.risk_rejected',
        riskLevel: 'critical',
        statusCode: result.statusCode || 409,
        userId: result.payment?.user_id || null,
        metadata: {
          payment_id: paymentId,
          reason: result.message,
          provider_amount: providerAmount,
        },
      });
      return res.status(result.statusCode || 409).send('FAIL');
    }

    logger.info(`[Payment] WeChat callback: ${paymentId} - ${result.idempotent ? 'IDEMPOTENT' : 'SUCCESS'}`);
    return res.send('SUCCESS');
  } catch (error) {
    logger.error('[Payment] WeChat callback failed:', error);
    return res.status(500).send('FAIL');
  }
});

router.post('/alipay/callback', async (req: Request, res: Response) => {
  try {
    const params = req.body;

    if (!alipayPayment.verifyCallback(params)) {
      return res.send('fail');
    }

    const paymentId = params.out_trade_no;
    const transactionId = params.trade_no;
    const providerAmount = params.total_amount ? normalizeAmount(params.total_amount) : null;

    if (params.trade_status === 'TRADE_SUCCESS' || params.trade_status === 'TRADE_FINISHED') {
      const result = await db.transaction((client: PgClient) => completePaidOrder({
        client,
        paymentId,
        method: 'alipay',
        transactionId,
        providerAmount,
        providerPayload: {
          trade_status: params.trade_status,
          total_amount: params.total_amount,
          seller_id: params.seller_id,
          app_id: params.app_id,
        },
      }));

      if (!result.ok) {
        void recordSecurityEvent({
          req,
          eventType: 'payment.alipay.risk_rejected',
          riskLevel: 'critical',
          statusCode: result.statusCode || 409,
          userId: result.payment?.user_id || null,
          metadata: {
            payment_id: paymentId,
            reason: result.message,
            provider_amount: providerAmount,
          },
        });
        return res.send('fail');
      }

      logger.info(`[Payment] Alipay callback: ${paymentId} - ${result.idempotent ? 'IDEMPOTENT' : 'SUCCESS'}`);
    }

    return res.send('success');
  } catch (error) {
    logger.error('[Payment] Alipay callback failed:', error);
    return res.send('fail');
  }
});

export default router;
