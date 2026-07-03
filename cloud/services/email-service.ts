import { logger } from '../utils/logger';
import * as net from 'net';
import * as tls from 'tls';

export type VerificationEmailType = 'register' | 'reset_password' | 'change_email' | 'change_phone';

export interface EmailConfig {
  fromName?: string;
  fromEmail?: string;
  mockMode?: boolean;
  resendApiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPassword?: string;
}

export class EmailService {
  private config: EmailConfig;
  private enabled: boolean;

  constructor(config: EmailConfig) {
    this.config = config;
    this.enabled = !!config.mockMode || !!config.resendApiKey || this.hasSmtpConfig();

    if (config.mockMode) {
      logger.info('[EmailService] Initialized in mock mode');
    } else if (config.resendApiKey) {
      logger.info('[EmailService] Initialized with Resend HTTP API');
    } else if (this.hasSmtpConfig()) {
      logger.info(`[EmailService] Initialized with SMTP ${config.smtpHost}:${config.smtpPort || 465}`);
    } else {
      logger.warn('[EmailService] Email service disabled - missing RESEND_API_KEY or SMTP EMAIL_HOST/EMAIL_USER/EMAIL_PASSWORD');
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

    if (this.config.resendApiKey) {
      return this.sendViaResend(email, code, type);
    }

    if (this.hasSmtpConfig()) {
      return this.sendViaSmtp(email, code, type);
    }

    return {
      success: false,
      message: '邮件服务未配置，请联系管理员',
    };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private async sendViaResend(
    email: string,
    code: string,
    type: VerificationEmailType
  ): Promise<{ success: boolean; message: string }> {
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
      logger.error('[EmailService] Failed to send verification email:', this.formatErrorForLog(error));
      return {
        success: false,
        message: this.getUserFacingFailureMessage(error),
      };
    }
  }

  private async sendViaSmtp(
    email: string,
    code: string,
    type: VerificationEmailType
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.sendSmtpMessage({
        to: email,
        subject: this.getSubject(type),
        html: this.getVerificationEmailHtml(code, type),
      });
      logger.info(`[EmailService] Sent verification code to ${email} via SMTP`);
      return {
        success: true,
        message: '验证码已发送到您的邮箱',
      };
    } catch (error) {
      logger.error('[EmailService] SMTP send failed:', this.formatErrorForLog(error));
      return {
        success: false,
        message: this.getUserFacingFailureMessage(error),
      };
    }
  }

  private hasSmtpConfig(): boolean {
    return Boolean(this.config.smtpHost && this.config.smtpUser && this.config.smtpPassword);
  }

  private async sendSmtpMessage(input: { to: string; subject: string; html: string }): Promise<void> {
    const host = String(this.config.smtpHost || '').trim();
    const port = Number(this.config.smtpPort || 465);
    const secure = this.config.smtpSecure !== false;
    const user = String(this.config.smtpUser || '').trim();
    const password = String(this.config.smtpPassword || '');
    const fromEmail = String(this.config.fromEmail || user).trim();
    const fromName = String(this.config.fromName || 'ScholarHarness').trim();
    if (!host || !user || !password || !fromEmail) {
      throw new Error('SMTP configuration incomplete');
    }

    const socket = await this.openSmtpSocket(host, port, secure);
    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    try {
      await this.readSmtpResponse(socket, [220]);
      await this.smtpCommand(socket, `EHLO scholarharness.com`, [250]);
      await this.smtpCommand(socket, 'AUTH LOGIN', [334]);
      await this.smtpCommand(socket, Buffer.from(user, 'utf8').toString('base64'), [334]);
      await this.smtpCommand(socket, Buffer.from(password, 'utf8').toString('base64'), [235]);
      await this.smtpCommand(socket, `MAIL FROM:<${fromEmail}>`, [250]);
      await this.smtpCommand(socket, `RCPT TO:<${input.to}>`, [250, 251]);
      await this.smtpCommand(socket, 'DATA', [354]);
      socket.write(this.buildSmtpMessage({
        fromEmail,
        fromName,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }) + '\r\n.\r\n');
      await this.readSmtpResponse(socket, [250]);
      await this.smtpCommand(socket, 'QUIT', [221]).catch(() => undefined);
      cleanup();
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private openSmtpSocket(host: string, port: number, secure: boolean): Promise<net.Socket | tls.TLSSocket> {
    return new Promise((resolve, reject) => {
      const options = { host, port, servername: host };
      const socket = secure
        ? tls.connect(options, () => resolve(socket))
        : net.connect(options, () => resolve(socket));
      socket.setTimeout(15000);
      socket.once('error', reject);
      socket.once('timeout', () => reject(new Error('SMTP connection timeout')));
    });
  }

  private smtpCommand(
    socket: net.Socket | tls.TLSSocket,
    command: string,
    expectedCodes: number[]
  ): Promise<string> {
    socket.write(command + '\r\n');
    return this.readSmtpResponse(socket, expectedCodes);
  }

  private readSmtpResponse(
    socket: net.Socket | tls.TLSSocket,
    expectedCodes: number[]
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      const onData = (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        const lines = buffer.split(/\r?\n/).filter(Boolean);
        const last = lines[lines.length - 1] || '';
        const match = last.match(/^(\d{3})\s/);
        if (!match) return;
        socket.off('data', onData);
        socket.off('error', onError);
        socket.off('timeout', onTimeout);
        const code = Number(match[1]);
        if (expectedCodes.includes(code)) {
          resolve(buffer);
        } else {
          reject(new Error(`SMTP unexpected response ${code}: ${buffer.slice(0, 500)}`));
        }
      };
      const onError = (error: Error) => {
        socket.off('data', onData);
        socket.off('timeout', onTimeout);
        reject(error);
      };
      const onTimeout = () => {
        socket.off('data', onData);
        socket.off('error', onError);
        reject(new Error('SMTP response timeout'));
      };
      socket.on('data', onData);
      socket.once('error', onError);
      socket.once('timeout', onTimeout);
    });
  }

  private buildSmtpMessage(input: {
    fromEmail: string;
    fromName: string;
    to: string;
    subject: string;
    html: string;
  }): string {
    const subject = `=?UTF-8?B?${Buffer.from(input.subject, 'utf8').toString('base64')}?=`;
    const fromName = `=?UTF-8?B?${Buffer.from(input.fromName, 'utf8').toString('base64')}?=`;
    const messageId = `${Date.now()}.${Math.random().toString(16).slice(2)}@scholarharness.com`;
    const html = input.html.replace(/^\./gm, '..');
    return [
      `From: ${fromName} <${input.fromEmail}>`,
      `To: <${input.to}>`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${messageId}>`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      '',
      html,
    ].join('\r\n');
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

  private formatErrorForLog(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      const details = error as Error & {
        code?: string;
        command?: string;
        response?: string;
        responseCode?: number;
      };
      return {
        name: details.name,
        message: details.message,
        code: details.code,
        command: details.command,
        responseCode: details.responseCode,
        response: details.response ? details.response.slice(0, 500) : undefined,
        stack: details.stack ? details.stack.split('\n').slice(0, 5).join('\n') : undefined,
      };
    }

    return {
      value: String(error),
    };
  }

  private getUserFacingFailureMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error || '');

    if (message.includes('EmailAddrInBlacklist') || message.includes('邮件地址在黑名单中')) {
      return '该邮箱暂时无法接收验证码，请更换邮箱或联系管理员处理';
    }

    return '邮件发送失败，请稍后重试';
  }
}

export function createEmailServiceFromEnv(): EmailService {
  return new EmailService({
    fromName: process.env.EMAIL_FROM_NAME || 'ScholarHarness',
    fromEmail: process.env.EMAIL_FROM_EMAIL || '',
    mockMode: process.env.EMAIL_MOCK_MODE === 'true',
    resendApiKey: process.env.RESEND_API_KEY || '',
    smtpHost: process.env.EMAIL_HOST || process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.EMAIL_PORT || process.env.SMTP_PORT || 465),
    smtpSecure: String(process.env.EMAIL_SECURE ?? process.env.SMTP_SECURE ?? 'true') !== 'false',
    smtpUser: process.env.EMAIL_USER || process.env.SMTP_USER || '',
    smtpPassword: process.env.EMAIL_PASSWORD || process.env.SMTP_PASSWORD || '',
  });
}
