import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export interface ActivationStatus {
  activated: boolean;
  activationToken?: string;
  deviceId?: string;
  expiresAt?: Date;
  userId?: string;
}

export interface ActivationClientConfig {
  serverUrl: string;
  localStorePath: string;
}

export class ActivationClient {
  private config: ActivationClientConfig;
  private status: ActivationStatus | null = null;

  constructor(config?: Partial<ActivationClientConfig>) {
    this.config = {
      serverUrl: config?.serverUrl || process.env.ACTIVATION_SERVER_URL || 'https://api.scholarharness.com/api/v1',
      localStorePath: config?.localStorePath || this.getDefaultStorePath(),
    };
  }

  private getDefaultStorePath(): string {
    const dataDir = path.join(os.homedir(), '.scholar-harness');
    return path.join(dataDir, 'activation.json');
  }

  private async ensureDataDir(): Promise<void> {
    const dir = path.dirname(this.config.localStorePath);
    await fs.mkdir(dir, { recursive: true });
  }

  private getDeviceId(): string {
    const hostname = os.hostname();
    const platform = os.platform();
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
    
    const data = `${hostname}:${platform}:${cpuModel}`;
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
  }

  async loadStatus(): Promise<ActivationStatus> {
    try {
      const data = await fs.readFile(this.config.localStorePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.status = {
        activated: parsed.activated || false,
        activationToken: parsed.activationToken,
        deviceId: parsed.deviceId,
        expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : undefined,
        userId: parsed.userId,
      };
      
      return this.status;
    } catch (error) {
      this.status = { activated: false };
      return this.status;
    }
  }

  async saveStatus(status: ActivationStatus): Promise<void> {
    await this.ensureDataDir();
    
    const data = JSON.stringify({
      activated: status.activated,
      activationToken: status.activationToken,
      deviceId: status.deviceId,
      expiresAt: status.expiresAt?.toISOString(),
      userId: status.userId,
      updatedAt: new Date().toISOString(),
    }, null, 2);
    
    await fs.writeFile(this.config.localStorePath, data, 'utf-8');
    this.status = status;
  }

  async activate(code: string, userId: string): Promise<{ success: boolean; message: string; expiresAt?: Date }> {
    try {
      const deviceId = this.getDeviceId();
      
      const response = await fetch(`${this.config.serverUrl}/activation/activate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await this.getAuthToken(userId)}`,
        },
        body: JSON.stringify({
          code,
          device_id: deviceId,
          device_name: os.hostname(),
          device_os: os.platform(),
        }),
      });

      const result = await response.json() as any;

      if (!response.ok) {
        return {
          success: false,
          message: result.message || 'Activation failed',
        };
      }

      const status: ActivationStatus = {
        activated: true,
        activationToken: result.activation.activation_token,
        deviceId: deviceId,
        expiresAt: new Date(result.activation.expires_at),
        userId: userId,
      };

      await this.saveStatus(status);

      return {
        success: true,
        message: 'Activation successful',
        expiresAt: status.expiresAt,
      };
    } catch (error) {
      console.error('[ActivationClient] Activate failed:', error);
      return {
        success: false,
        message: 'Network error. Please check your internet connection.',
      };
    }
  }

  async verify(): Promise<{ valid: boolean; message: string }> {
    if (!this.status) {
      await this.loadStatus();
    }

    if (!this.status?.activated || !this.status.activationToken) {
      return { valid: false, message: 'Not activated' };
    }

    if (this.status.expiresAt && new Date() > this.status.expiresAt) {
      return { valid: false, message: 'Activation expired' };
    }

    try {
      const response = await fetch(`${this.config.serverUrl}/activation/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          activation_token: this.status.activationToken,
          device_id: this.status.deviceId,
        }),
      });

      const result = await response.json() as any;

      if (!response.ok || !result.valid) {
        await this.clearActivation();
        return { valid: false, message: result.message || 'Activation invalid' };
      }

      if (result.activation?.expires_at) {
        this.status.expiresAt = new Date(result.activation.expires_at);
        await this.saveStatus(this.status);
      }

      return { valid: true, message: 'Activation verified' };
    } catch (error) {
      if (this.status.expiresAt && new Date() < this.status.expiresAt) {
        return { valid: true, message: 'Offline mode - using cached activation' };
      }
      return { valid: false, message: 'Network error during verification' };
    }
  }

  async clearActivation(): Promise<void> {
    this.status = { activated: false };
    try {
      await fs.unlink(this.config.localStorePath);
    } catch {}
  }

  private async getAuthToken(userId: string): Promise<string> {
    return `local-${userId}-${Date.now()}`;
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
}

export const activationClient = new ActivationClient();