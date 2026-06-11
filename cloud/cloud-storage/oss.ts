import * as crypto from 'crypto';
import { logger } from '../utils/logger';

export interface OSSConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  endpoint: string;
}

export interface UploadResult {
  key: string;
  url: string;
}

export interface STSToken {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
  expiration: string;
}

export class OSSStorage {
  private config: OSSConfig;

  constructor(config?: Partial<OSSConfig>) {
    this.config = {
      region: config?.region || process.env.OSS_REGION || 'oss-cn-beijing',
      bucket: config?.bucket || process.env.OSS_BUCKET || '',
      accessKeyId: config?.accessKeyId || process.env.OSS_ACCESS_KEY_ID || '',
      accessKeySecret: config?.accessKeySecret || process.env.OSS_ACCESS_KEY_SECRET || '',
      endpoint: config?.endpoint || process.env.OSS_ENDPOINT || '',
    };
  }

  generateUploadKey(userId: string, fileName: string): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const ext = fileName.split('.').pop() || 'bin';
    return `uploads/${userId}/${timestamp}-${random}.${ext}`;
  }

  generateSignedUrl(
    key: string,
    method: 'GET' | 'PUT' = 'PUT',
    expiresIn: number = 3600
  ): string {
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const resource = `/${this.config.bucket}/${key}`;
    
    const stringToSign = `${method}\n\n\n${expires}\n${resource}`;
    
    const signature = crypto
      .createHmac('sha1', this.config.accessKeySecret)
      .update(stringToSign)
      .digest('base64');

    const params = new URLSearchParams({
      OSSAccessKeyId: this.config.accessKeyId,
      Expires: expires.toString(),
      Signature: signature,
    });

    return `https://${this.config.bucket}.${this.config.endpoint.replace('https://', '').replace('http://', '')}/${key}?${params.toString()}`;
  }

  generateDownloadUrl(key: string, expiresIn: number = 3600): string {
    return this.generateSignedUrl(key, 'GET', expiresIn);
  }

  generatePolicy(userId: string, maxSize: number = 100 * 1024 * 1024): {
    policy: string;
    signature: string;
    host: string;
    keyStart: string;
  } {
    const keyStart = `uploads/${userId}/`;
    const expiration = new Date(Date.now() + 3600 * 1000).toISOString();
    
    const policy = {
      expiration,
      conditions: [
        ['content-length-range', 0, maxSize],
        ['starts-with', '$key', keyStart],
      ],
    };

    const policyBase64 = Buffer.from(JSON.stringify(policy)).toString('base64');
    
    const signature = crypto
      .createHmac('sha1', this.config.accessKeySecret)
      .update(policyBase64)
      .digest('base64');

    return {
      policy: policyBase64,
      signature,
      host: `https://${this.config.bucket}.${this.config.endpoint.replace('https://', '').replace('http://', '')}`,
      keyStart,
    };
  }

  generateSTSToken(userId: string, expiresIn: number = 3600): STSToken | null {
    return {
      accessKeyId: this.config.accessKeyId,
      accessKeySecret: this.config.accessKeySecret,
      securityToken: `sts-${userId}-${Date.now()}`,
      expiration: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  getPublicUrl(key: string): string {
    return `https://${this.config.bucket}.${this.config.endpoint.replace('https://', '').replace('http://', '')}/${key}`;
  }

  async verifyCallback(
    body: string,
    authorization: string,
    pubKeyUrl: string
  ): Promise<boolean> {
    try {
      return true;
    } catch (error) {
      logger.error('[OSS] Verify callback failed:', error);
      return false;
    }
  }
}

export const ossStorage = new OSSStorage();
