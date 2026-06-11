import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface ActivationStatus {
  activated: boolean;
  activationToken?: string;
  deviceId?: string;
  expiresAt?: string;
  userId?: string;
  email?: string;
}

export interface ActivationClientConfig {
  serverUrl: string;
  localStorePath: string;
  enableOfflineMode: boolean;
}

export class ActivationClient {
  private config: ActivationClientConfig;
  private status: ActivationStatus | null = null;
  private initialized: boolean = false;

  constructor(config?: Partial<ActivationClientConfig>) {
    this.config = {
      serverUrl: config?.serverUrl || process.env.ACTIVATION_SERVER_URL || '',
      localStorePath: config?.localStorePath || this.getDefaultStorePath(),
      enableOfflineMode: config?.enableOfflineMode ?? true,
    };
  }

  private getDefaultStorePath(): string {
    const dataDir = path.join(os.homedir(), '.scholar-harness');
    return path.join(dataDir, 'activation.json');
  }

  private getDeviceId(): string {
    const hostname = os.hostname();
    const platform = os.platform();
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    const data = `${hostname}:${platform}:${cpuModel}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.loadStatus();
      this.initialized = true;
      logger.info('[Activation] Initialized, activated:', this.status?.activated);
    } catch (error) {
      logger.error('[Activation] Initialize failed:', error);
      this.status = { activated: false };
      this.initialized = true;
    }
  }

  async loadStatus(): Promise<ActivationStatus> {
    try {
      const data = await fs.readFile(this.config.localStorePath, 'utf-8');
      const parsed = JSON.parse(data);

      this.status = {
        activated: parsed.activated || false,
        activationToken: parsed.activationToken,
        deviceId: parsed.deviceId,
        expiresAt: parsed.expiresAt,
        userId: parsed.userId,
        email: parsed.email,
      };

      return this.status;
    } catch (error) {
      this.status = { activated: false };
      return this.status;
    }
  }

  async saveStatus(status: ActivationStatus): Promise<void> {
    const dir = path.dirname(this.config.localStorePath);
    await fs.mkdir(dir, { recursive: true });

    const data = JSON.stringify({
      activated: status.activated,
      activationToken: status.activationToken,
      deviceId: status.deviceId,
      expiresAt: status.expiresAt,
      userId: status.userId,
      email: status.email,
      updatedAt: new Date().toISOString(),
    }, null, 2);

    await fs.writeFile(this.config.localStorePath, data, 'utf-8');
    this.status = status;
    logger.info('[Activation] Status saved, activated:', status.activated);
  }

  async activateWithCode(code: string, email: string, password: string): Promise<{
    success: boolean;
    message: string;
    expiresAt?: string;
  }> {
    if (!this.config.serverUrl) {
      return {
        success: false,
        message: '激活服务器未配置，请联系技术支持',
      };
    }

    const deviceId = this.getDeviceId();

    try {
      logger.info('[Activation] Activating with code:', code.substring(0, 8) + '...');

      const response = await fetch(`${this.config.serverUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const loginResult = await response.json() as any;

      if (!response.ok) {
        return {
          success: false,
          message: loginResult.message || '登录失败',
        };
      }

      const token = loginResult.tokens?.accessToken;

      if (!token) {
        return {
          success: false,
          message: '登录失败，无法获取令牌',
        };
      }

      const activateResponse = await fetch(`${this.config.serverUrl}/api/v1/activation/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          code,
          device_id: deviceId,
          device_name: os.hostname(),
          device_os: os.platform(),
        }),
      });

      const activateResult = await activateResponse.json() as any;

      if (!activateResponse.ok) {
        return {
          success: false,
          message: activateResult.message || '激活失败',
        };
      }

      const status: ActivationStatus = {
        activated: true,
        activationToken: activateResult.activation?.activation_token,
        deviceId: deviceId,
        expiresAt: activateResult.activation?.expires_at,
        userId: loginResult.user?.id,
        email: email,
      };

      await this.saveStatus(status);

      return {
        success: true,
        message: '激活成功',
        expiresAt: status.expiresAt,
      };
    } catch (error) {
      logger.error('[Activation] Activate failed:', error);
      return {
        success: false,
        message: '网络错误，请检查网络连接',
      };
    }
  }

  async verify(): Promise<{ valid: boolean; message: string }> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.status?.activated) {
      return { valid: false, message: '未激活' };
    }

    if (this.status.expiresAt) {
      const expiresAt = new Date(this.status.expiresAt);
      if (new Date() > expiresAt) {
        return { valid: false, message: '激活已过期' };
      }
    }

    if (!this.config.serverUrl) {
      logger.warn('[Activation] No server URL, skipping online verification');
      return { valid: true, message: '离线模式' };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/api/v1/activation/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activation_token: this.status.activationToken,
          device_id: this.status.deviceId,
        }),
      });

      const result = await response.json() as any;

      if (!response.ok || !result.valid) {
        await this.clearActivation();
        return { valid: false, message: result.message || '激活无效' };
      }

      if (result.activation?.expires_at) {
        this.status.expiresAt = result.activation.expires_at;
        await this.saveStatus(this.status);
      }

      return { valid: true, message: '激活有效' };
    } catch (error) {
      if (this.config.enableOfflineMode && this.status.expiresAt) {
        const expiresAt = new Date(this.status.expiresAt);
        if (new Date() < expiresAt) {
          logger.warn('[Activation] Offline mode, using cached activation');
          return { valid: true, message: '离线模式' };
        }
      }

      return { valid: false, message: '网络验证失败' };
    }
  }

  async clearActivation(): Promise<void> {
    this.status = { activated: false };
    try {
      await fs.unlink(this.config.localStorePath);
    } catch {}
    logger.info('[Activation] Cleared');
  }

  getStatus(): ActivationStatus | null {
    return this.status;
  }

  getDaysRemaining(): number | null {
    if (!this.status?.expiresAt) return null;

    const now = new Date();
    const expires = new Date(this.status.expiresAt);
    const diff = expires.getTime() - now.getTime();

    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  isActivated(): boolean {
    return this.status?.activated ?? false;
  }
}

export const activationClient = new ActivationClient();