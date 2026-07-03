import axios from 'axios';
import { createHash, createHmac } from 'crypto';
import { logger } from '../utils/logger';

export interface CaptchaConfig {
  appId: string;
  appSecretKey: string;
  secretId: string;
  secretKey: string;
}

interface TencentCaptchaResponse {
  Response?: {
    CaptchaCode?: number;
    CaptchaMsg?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
}

export class CaptchaService {
  private readonly appId: string;
  private readonly appSecretKey: string;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly enabled: boolean;

  constructor(config: CaptchaConfig) {
    this.appId = config.appId;
    this.appSecretKey = config.appSecretKey;
    this.secretId = config.secretId;
    this.secretKey = config.secretKey;

    if (process.env.CAPTCHA_ENABLED !== 'true') {
      logger.info('[CaptchaService] Disabled - CAPTCHA_ENABLED is not true');
      this.enabled = false;
      return;
    }

    this.enabled = Boolean(this.appId && this.appSecretKey && this.secretId && this.secretKey);
    if (this.enabled) {
      logger.info('[CaptchaService] Initialized with Tencent Cloud API');
    } else {
      logger.warn('[CaptchaService] Disabled - missing API credentials');
    }
  }

  async verify(ticket: string, randstr: string, userIp: string): Promise<{ valid: boolean; message: string }> {
    if (!this.enabled) {
      logger.warn('[CaptchaService] Verification skipped - service disabled');
      return { valid: true, message: '验证码服务未启用' };
    }

    if (!ticket || !randstr) {
      return { valid: false, message: '请先完成人机验证' };
    }

    try {
      const response = await this.callTencentCaptchaApi({
        CaptchaType: 9,
        Ticket: ticket,
        Randstr: randstr,
        UserIp: userIp,
        CaptchaAppId: Number.parseInt(this.appId, 10),
        AppSecretKey: this.appSecretKey,
        BusinessId: 0,
        SceneId: 0,
      });

      const payload = response.Response;
      if (payload?.Error) {
        logger.warn('[CaptchaService] Tencent API error:', payload.Error.Code, payload.Error.Message);
        if (payload.Error.Code?.includes('AuthFailure')) {
          return {
            valid: false,
            message: formatTencentAuthFailureMessage(payload.Error.Code, payload.Error.Message || ''),
          };
        }

        if (payload.Error.Code?.includes('UnauthorizedOperation')) {
          if (payload.Error.Message?.includes('套餐') || payload.Error.Message?.includes('欠费')) {
            return {
              valid: false,
              message: '腾讯云验证码服务无有效套餐包或账户已欠费，请检查验证码套餐/账户余额后重试',
            };
          }

          return {
            valid: false,
            message: '腾讯云验证码校验未授权，请检查验证码套餐、账户余额以及 Captcha DescribeCaptchaResult 权限',
          };
        }
        return { valid: false, message: payload.Error.Message || '人机验证校验失败' };
      }

      if (payload?.CaptchaCode === 1) {
        logger.info('[CaptchaService] Verification passed');
        return { valid: true, message: '验证通过' };
      }

      logger.warn('[CaptchaService] Verification failed:', payload?.CaptchaCode, payload?.CaptchaMsg);
      if (payload?.CaptchaCode === 100) {
        return {
          valid: false,
          message:
            '腾讯云验证码 AppID、AppSecretKey 与 ticket 不匹配，请确认前端 AppID 和后端验证码应用密钥来自同一个腾讯云验证码应用',
        };
      }
      if (payload?.CaptchaCode === 15) {
        return {
          valid: false,
          message: '腾讯云验证码解密失败，请确认前端 AppID、后端 CAPTCHA_APP_SECRET_KEY 与同一个验证码应用匹配，且验证码未过期',
        };
      }
      return { valid: false, message: payload?.CaptchaMsg || '人机验证校验失败' };
    } catch (error) {
      logger.error('[CaptchaService] Verification error:', error);
      const errorCode = getErrorCode(error);
      if (errorCode.includes('UnauthorizedOperation')) {
        const errorMessage = getErrorMessage(error);
        if (errorMessage.includes('套餐') || errorMessage.includes('欠费')) {
          return {
            valid: false,
            message: '腾讯云验证码服务无有效套餐包或账户已欠费，请检查验证码套餐/账户余额后重试',
          };
        }

        return {
          valid: false,
          message: '腾讯云验证码校验未授权，请检查验证码套餐、账户余额以及 Captcha DescribeCaptchaResult 权限',
        };
      }
      if (errorCode.includes('AuthFailure')) {
        return {
          valid: false,
          message: formatTencentAuthFailureMessage(errorCode, getErrorMessage(error)),
        };
      }
      return { valid: false, message: '人机验证校验异常，请重试' };
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private async callTencentCaptchaApi(payload: Record<string, unknown>): Promise<TencentCaptchaResponse> {
    const service = 'captcha';
    const host = 'captcha.tencentcloudapi.com';
    const action = 'DescribeCaptchaResult';
    const version = '2019-07-22';
    const region = 'ap-guangzhou';
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const body = JSON.stringify(payload);

    const authorization = this.createTencentAuthorization({
      service,
      host,
      action,
      timestamp,
      date,
      body,
    });

    const result = await axios.post<TencentCaptchaResponse>(`https://${host}`, body, {
      timeout: 10000,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: host,
        'X-TC-Action': action,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': version,
        'X-TC-Region': region,
      },
    });

    return result.data;
  }

  private createTencentAuthorization(input: {
    service: string;
    host: string;
    action: string;
    timestamp: number;
    date: string;
    body: string;
  }): string {
    const algorithm = 'TC3-HMAC-SHA256';
    const canonicalHeaders = [
      'content-type:application/json; charset=utf-8',
      `host:${input.host}`,
      `x-tc-action:${input.action.toLowerCase()}`,
      '',
    ].join('\n');
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedRequestPayload = sha256Hex(input.body);
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload,
    ].join('\n');

    const credentialScope = `${input.date}/${input.service}/tc3_request`;
    const stringToSign = [
      algorithm,
      String(input.timestamp),
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join('\n');

    const secretDate = hmacSha256(`TC3${this.secretKey}`, input.date);
    const secretService = hmacSha256(secretDate, input.service);
    const secretSigning = hmacSha256(secretService, 'tc3_request');
    const signature = hmacSha256(secretSigning, stringToSign).toString('hex');

    return `${algorithm} Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function getErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const maybeError = error as {
    code?: unknown;
    Code?: unknown;
    response?: { data?: { Response?: { Error?: { Code?: unknown } } } };
  };

  return String(
    maybeError.code ||
      maybeError.Code ||
      maybeError.response?.data?.Response?.Error?.Code ||
      ''
  );
}

function getErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return '';
  }

  const maybeError = error as {
    message?: unknown;
    Message?: unknown;
    response?: { data?: { Response?: { Error?: { Message?: unknown } } } };
  };

  return String(
    maybeError.message ||
      maybeError.Message ||
      maybeError.response?.data?.Response?.Error?.Message ||
      ''
  );
}

function formatTencentAuthFailureMessage(code: string, message: string): string {
  if (code.includes('SecretIdNotFound')) {
    return '腾讯云 API SecretId 不存在或不属于当前腾讯云账号，请在腾讯云访问管理 CAM 中重新生成 SecretId/SecretKey，并同步到服务器配置';
  }
  if (code.includes('SignatureFailure')) {
    return '腾讯云 API 签名校验失败，请检查 SecretId/SecretKey 是否成对、是否复制完整';
  }
  return message || '验证码服务的腾讯云 API 密钥配置无效，请检查 SecretId/SecretKey 后重试';
}

function firstEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return '';
}

export function createCaptchaServiceFromEnv(): CaptchaService {
  return new CaptchaService({
    appId: firstEnv('CAPTCHA_APP_ID', 'TENCENT_CAPTCHA_APP_ID', 'NEXT_PUBLIC_TENCENT_CAPTCHA_APP_ID'),
    appSecretKey: firstEnv('CAPTCHA_APP_SECRET_KEY', 'TENCENT_CAPTCHA_APP_SECRET_KEY'),
    secretId: firstEnv('TENCENT_SECRET_ID', 'TENCENTCLOUD_SECRET_ID', 'TENCENT_CLOUD_SECRET_ID', 'CAPTCHA_TENCENT_SECRET_ID'),
    secretKey: firstEnv('TENCENT_SECRET_KEY', 'TENCENTCLOUD_SECRET_KEY', 'TENCENT_CLOUD_SECRET_KEY', 'CAPTCHA_TENCENT_SECRET_KEY'),
  });
}
