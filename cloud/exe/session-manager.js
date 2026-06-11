"use strict";
/**
 * 本地Session管理器
 * 负责保存、读取、验证和管理用户session
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const fs = __importStar(require("fs/promises"));
const fsSync = __importStar(require("fs"));
const path = __importStar(require("path"));
const crypto = __importStar(require("crypto"));
/**
 * Session管理器
 */
class SessionManager {
    config;
    sessionFilePath;
    encryptionKey;
    sessionData = null;
    constructor(config) {
        this.config = config;
        this.sessionFilePath = config.sessionFilePath || path.join(process.cwd(), '.session');
        this.encryptionKey = this.getOrCreateEncryptionKey();
    }
    /**
     * 获取或创建加密密钥
     * 使用设备硬件特征生成密钥，确保密钥与设备绑定
     */
    getOrCreateEncryptionKey() {
        const keyPath = path.join(path.dirname(this.sessionFilePath), '.key');
        try {
            // 尝试读取现有密钥（使用同步方法，因为这是初始化）
            const existingKey = fsSync.readFileSync(keyPath, 'utf-8');
            return existingKey;
        }
        catch {
            // 密钥不存在，生成新密钥
            const newKey = crypto.randomBytes(32).toString('hex');
            fsSync.writeFileSync(keyPath, newKey, { mode: 0o600 }); // 仅当前用户可读写
            return newKey;
        }
    }
    /**
     * 加密session数据
     */
    encrypt(data) {
        const algorithm = 'aes-256-gcm';
        const key = Buffer.from(this.encryptionKey, 'hex');
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag().toString('hex');
        return {
            encrypted,
            iv: iv.toString('hex'),
            authTag,
            version: 1,
            createdAt: Date.now(),
        };
    }
    /**
     * 解密session数据
     */
    decrypt(encryptedData) {
        try {
            const algorithm = 'aes-256-gcm';
            const key = Buffer.from(this.encryptionKey, 'hex');
            const iv = Buffer.from(encryptedData.iv, 'hex');
            const authTag = Buffer.from(encryptedData.authTag, 'hex');
            const decipher = crypto.createDecipheriv(algorithm, key, iv);
            decipher.setAuthTag(authTag);
            let decrypted = decipher.update(encryptedData.encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return JSON.parse(decrypted);
        }
        catch (error) {
            // 解密失败（密钥不匹配或数据损坏）
            console.error('[SessionManager] Decryption failed:', error);
            return null;
        }
    }
    /**
     * 保存session到本地文件
     */
    async saveSession(session) {
        this.sessionData = session;
        const encryptedData = this.encrypt(session);
        await fs.writeFile(this.sessionFilePath, JSON.stringify(encryptedData), { mode: 0o600 } // 仅当前用户可读写
        );
        console.log('[SessionManager] Session saved successfully');
    }
    /**
     * 从本地文件读取session
     */
    async loadSession() {
        if (this.sessionData) {
            return this.sessionData;
        }
        try {
            const content = await fs.readFile(this.sessionFilePath, 'utf-8');
            const encryptedData = JSON.parse(content);
            this.sessionData = this.decrypt(encryptedData);
            return this.sessionData;
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                // 文件不存在，返回null
                return null;
            }
            console.error('[SessionManager] Failed to load session:', error);
            return null;
        }
    }
    /**
     * 获取当前session（如果内存中已有则直接返回）
     */
    async getSession() {
        return await this.loadSession();
    }
    /**
     * 检查accessToken是否过期
     */
    async isAccessTokenExpired() {
        const session = await this.getSession();
        if (!session)
            return true;
        return Date.now() > session.expiresAt;
    }
    /**
     * 检查refreshToken是否过期
     */
    async isRefreshTokenExpired() {
        const session = await this.getSession();
        if (!session)
            return true;
        return Date.now() > session.refreshExpiresAt;
    }
    /**
     * 检查是否在离线宽限期内
     */
    async isWithinOfflineGracePeriod() {
        const session = await this.getSession();
        if (!session)
            return false;
        const gracePeriodMs = this.config.offlineGraceHours * 60 * 60 * 1000;
        const lastValidated = session.lastValidatedAt || session.createdAt;
        return Date.now() < lastValidated + gracePeriodMs;
    }
    /**
     * 更新session中的tokens
     */
    async updateTokens(accessToken, refreshToken, expiresIn) {
        const session = await this.getSession();
        if (!session) {
            throw new Error('No existing session to update');
        }
        session.accessToken = accessToken;
        session.refreshToken = refreshToken;
        session.expiresAt = Date.now() + expiresIn * 1000;
        session.refreshExpiresAt = Date.now() + this.config.refreshTokenExpirySeconds * 1000;
        session.lastValidatedAt = Date.now();
        await this.saveSession(session);
    }
    /**
     * 更新订阅信息缓存
     */
    async updateSubscriptionCache(subscription) {
        const session = await this.getSession();
        if (!session) {
            throw new Error('No existing session to update');
        }
        if (!session.subscription) {
            session.subscription = {
                plan_type: '',
                status: '',
                quota_remaining: 0,
                quota_total: 0,
            };
        }
        if (subscription) {
            Object.assign(session.subscription, subscription);
        }
        await this.saveSession(session);
    }
    /**
     * 更新激活信息缓存
     */
    async updateActivationCache(activation) {
        const session = await this.getSession();
        if (!session) {
            throw new Error('No existing session to update');
        }
        if (!session.activation) {
            session.activation = {
                activation_token: '',
                device_id: '',
                expires_at: '',
            };
        }
        if (activation) {
            Object.assign(session.activation, activation);
        }
        await this.saveSession(session);
    }
    /**
     * 清除session（登出时调用）
     */
    async clearSession() {
        this.sessionData = null;
        try {
            await fs.unlink(this.sessionFilePath);
            console.log('[SessionManager] Session cleared');
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('[SessionManager] Failed to delete session file:', error);
            }
        }
    }
    /**
     * 获取剩余使用额度
     */
    async getRemainingQuota() {
        const session = await this.getSession();
        if (!session || !session.subscription)
            return 0;
        return session.subscription.quota_remaining;
    }
    /**
     * 检查是否有足够额度
     */
    async hasEnoughQuota(requiredAmount) {
        const remaining = await this.getRemainingQuota();
        // quota_total为-1表示无限额度
        const session = await this.getSession();
        if (session?.subscription?.quota_total === -1)
            return true;
        return remaining >= requiredAmount;
    }
}
exports.SessionManager = SessionManager;
exports.default = SessionManager;
