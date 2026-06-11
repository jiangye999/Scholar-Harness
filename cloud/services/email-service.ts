import { logger } from '../utils/logger';

export type VerificationEmailType = 'register' | 'reset_password' | 'change_email' | 'change_phone';

export interface EmailConfig {
  fromName?: string;
  fromEmail?: string;
  mockMode?: boolean;
  resendApiKey?: string;
}

export class EmailService {
  private config: EmailConfig;
  private enabled: boolean;

  constructor(config: EmailConfig) {
    this.config = config;
    this.enabled = !!config.mockMode || !!config.resendApiKey;

    if (config.mockMode) {
      logger.info('[EmailService] Initialized in mock mode');
    } else if (config.resendApiKey) {
      logger.info('[EmailService] Initialized with Resend HTTP API');
    } else {
      logger.warn('[EmailService] Email service disabled - missing RESEND_API_KEY or EMAIL_MOCK_MODE=true');
    }
  }

  async sendVerificationCode(
    email: string,
    code: string,
    type: VerificationEmailType
  ): Promise<{ success: boolean; message: string }> {
    if (!this.enabled) {
      return {
        success: false,
        message: '邮件服务未配置，请联系管理员',
      };
    }

    if (this.config.mockMode) {
      logger.info(`[EmailService] Mock verification code for ${email}: ${code}`);
      return {
        success: true,
        message: `[测试模式] 验证码: ${code}`,
      };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.resendApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${this.config.fromName || 'ScholarHarness'} <${this.config.fromEmail || 'onboarding@resend.dev'}>`,
          to: [email],
          subject: this.getSubject(type),
          html: this.getVerificationEmailHtml(code, type),
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        logger.error('[EmailService] Resend API error:', {
          status: response.status,
          detail: detail.slice(0, 300),
        });
        return {
          success: false,
          message: '邮件发送失败，请稍后重试',
        };
      }

      logger.info(`[EmailService] Sent verification code to ${email} via Resend`);
      return {
        success: true,
        message: '验证码已发送到您的邮箱',
      };
    } catch (error) {
      logger.error('[EmailService] Failed to send verification email:', error);
      return {
        success: false,
        message: '邮件发送失败，请稍后重试',
      };
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private getSubject(type: VerificationEmailType): string {
    const subjects: Record<VerificationEmailType, string> = {
      register: 'ScholarHarness 注册验证码',
      reset_password: 'ScholarHarness 重置密码验证码',
      change_email: 'ScholarHarness 更换邮箱验证码',
      change_phone: 'ScholarHarness 绑定手机验证码',
    };
    return subjects[type];
  }

  private getVerificationEmailHtml(code: string, type: VerificationEmailType): string {
    const purposes: Record<VerificationEmailType, string> = {
      register: '完成账号注册',
      reset_password: '重置账号密码',
      change_email: '更换邮箱地址',
      change_phone: '绑定手机号码',
    };
    const purpose = purposes[type];

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #222; }
    .container { max-width: 600px; margin: 0 auto; padding: 24px; }
    .header { background: #2563eb; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
    .content { background: #f8fafc; padding: 28px; border: 1px solid #e5e7eb; border-top: 0; border-radius: 0 0 8px 8px; }
    .code-box { background: white; border: 2px solid #2563eb; padding: 16px; text-align: center; margin: 20px 0; border-radius: 6px; }
    .code { font-size: 32px; font-weight: bold; color: #2563eb; letter-spacing: 6px; }
    .warning { background: #fff7ed; border-left: 4px solid #f97316; padding: 12px; margin: 18px 0; }
    .footer { text-align: center; color: #777; font-size: 12px; margin-top: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>ScholarHarness</h1>
      <p>论文写作助手</p>
    </div>
    <div class="content">
      <h2>邮箱验证码</h2>
      <p>您好，您正在${purpose}，验证码如下：</p>
      <div class="code-box">
        <div class="code">${this.escapeHtml(code)}</div>
      </div>
      <div class="warning">
        <strong>注意：</strong>验证码有效期为 5 分钟，请勿告知他人。如非本人操作，请忽略此邮件。
      </div>
      <p>此邮件由系统自动发送，请勿回复。</p>
    </div>
    <div class="footer">© 2026 ScholarHarness</div>
  </div>
</body>
</html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export function createEmailServiceFromEnv(): EmailService {
  return new EmailService({
    fromName: process.env.EMAIL_FROM_NAME || 'ScholarHarness',
    fromEmail: process.env.EMAIL_FROM_EMAIL || '',
    mockMode: process.env.EMAIL_MOCK_MODE === 'true',
    resendApiKey: process.env.RESEND_API_KEY || '',
  });
}
