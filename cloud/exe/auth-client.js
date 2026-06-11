"use strict";
/**
 * exe认证客户端
 * 负责与云端API通信，处理登录、验证、订阅查询等
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
exports.AuthClient = void 0;
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
const config_1 = require("./config");
const session_manager_1 = require("./session-manager");
/**
 * exe认证客户端
 */
class AuthClient {
    config;
    sessionManager;
    constructor(config) {
        this.config = config;
        this.sessionManager = new session_manager_1.SessionManager(config);
    }
    /**
     * 获取设备ID
     * 使用硬件特征生成唯一设备标识
     */
    async getDeviceId() {
        const hostname = os.hostname();
        const platform = os.platform();
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
        const macAddress = this.getFirstMacAddress();
        const data = `${hostname}:${platform}:${cpuModel}:${macAddress}`;
        return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
    }
    /**
     * 获取第一个MAC地址
     */
    getFirstMacAddress() {
        const interfaces = os.networkInterfaces();
        for (const name of Object.keys(interfaces)) {
            const iface = interfaces[name];
            if (iface) {
                for (const addr of iface) {
                    if (!addr.internal && addr.mac && addr.mac !== '00:00:00:00:00:00') {
                        return addr.mac;
                    }
                }
            }
        }
        return 'unknown-mac';
    }
    /**
     * exe登录
     * 使用网站账号登录exe客户端
     */
    async login(email, password) {
        try {
            const deviceId = await this.getDeviceId();
            const response = await fetch((0, config_1.buildApiUrl)(config_1.API_ENDPOINTS.AUTH_LOGIN, this.config), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    email,
                    password,
                    source: 'exe', // 标记为exe登录
                }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                return {
                    success: false,
                    error: errorData.message || '登录失败',
                };
            }
            const data = await response.json();
            const { user, tokens } = data;
            // 创建session数据
            const sessionData = {
                userId: user.id,
                email: user.email,
                username: user.username,
                accessToken: tokens.accessToken,
                refreshToken: tokens.refreshToken,
                expiresAt: Date.now() + tokens.expiresIn * 1000,
                refreshExpiresAt: Date.now() + this.config.refreshTokenExpirySeconds * 1000,
                createdAt: Date.now(),
                lastValidatedAt: Date.now(),
            };
            // 保存到本地
            await this.sessionManager.saveSession(sessionData);
            // 尝试获取订阅信息（如果用户已购买套餐）
            const subscription = await this.getSubscription();
            if (subscription) {
                await this.sessionManager.updateSubscriptionCache({
                    plan_type: subscription.plan_type,
                    status: subscription.status,
                    quota_remaining: subscription.quota_remaining,
                    quota_total: subscription.quota_total,
                    end_date: subscription.end_date,
                });
            }
            return {
                success: true,
                user,
                tokens,
            };
        }
        catch (error) {
            console.error('[AuthClient] Login failed:', error);
            return {
                success: false,
                error: '网络连接失败，请检查网络后重试',
            };
        }
    }
    /**
     * 刷新accessToken
     */
    async refreshToken() {
        try {
            const session = await this.sessionManager.getSession();
            if (!session) {
                return false;
            }
            const response = await fetch((0, config_1.buildApiUrl)(config_1.API_ENDPOINTS.AUTH_REFRESH, this.config), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    refreshToken: session.refreshToken,
                }),
            });
            if (!response.ok) {
                console.error('[AuthClient] Token refresh failed');
                await this.sessionManager.clearSession();
                return false;
            }
            const data = await response.json();
            const { tokens } = data;
            // 更新本地session
            await this.sessionManager.updateTokens(tokens.accessToken, tokens.refreshToken, tokens.expiresIn);
            return true;
        }
        catch (error) {
            console.error('[AuthClient] Token refresh failed:', error);
            return false;
        }
    }
    /**
     * 获取用户订阅信息
     */
    async getSubscription() {
        try {
            const session = await this.sessionManager.getSession();
            if (!session) {
                return null;
            }
            // 检查accessToken是否过期，尝试刷新
            if (await this.sessionManager.isAccessTokenExpired()) {
                const refreshed = await this.refreshToken();
                if (!refreshed) {
                    return null;
                }
            }
            const newSession = await this.sessionManager.getSession();
            const response = await fetch((0, config_1.buildApiUrl)(config_1.API_ENDPOINTS.SUBSCRIPTION_ME, this.config), {
                headers: {
                    'Authorization': `Bearer ${newSession?.accessToken}`,
                },
            });
            if (!response.ok) {
                if (response.status === 404) {
                    // 用户未购买套餐
                    return null;
                }
                console.error('[AuthClient] Failed to get subscription:', response.status);
                return null;
            }
            const data = await response.json();
            return data.subscription;
        }
        catch (error) {
            console.error('[AuthClient] Get subscription failed:', error);
            return null;
        }
    }
    /**
     * 验证session有效性（完整验证流程）
     * 1. 检查本地session是否存在
     * 2. 检查accessToken是否过期
     * 3. 验证云端订阅状态
     * 4. 验证设备激活状态（如果有）
     * 5. 检查额度是否耗尽
     */
    async validateSession() {
        try {
            // 1. 检查本地session
            const session = await this.sessionManager.getSession();
            if (!session) {
                return {
                    valid: false,
                    reason: '未登录',
                    error: 'NO_SESSION',
                };
            }
            // 2. 检查accessToken是否过期
            if (await this.sessionManager.isAccessTokenExpired()) {
                // 尝试刷新
                const refreshed = await this.refreshToken();
                if (!refreshed) {
                    return {
                        valid: false,
                        reason: '登录已过期，请重新登录',
                        error: 'TOKEN_EXPIRED',
                    };
                }
            }
            // 3. 检查是否在离线宽限期内
            if (!await this.sessionManager.isWithinOfflineGracePeriod()) {
                return {
                    valid: false,
                    reason: '离线时间过长，请联网验证',
                    error: 'OFFLINE_GRACE_EXPIRED',
                };
            }
            // 4. 尝试联网验证云端状态
            const subscription = await this.getSubscription();
            if (!subscription) {
                // 用户未购买套餐
                return {
                    valid: false,
                    reason: '未购买套餐，请前往网站购买',
                    error: 'NO_SUBSCRIPTION',
                };
            }
            // 5. 检查订阅状态
            if (subscription.status === 'exhausted') {
                return {
                    valid: false,
                    subscription,
                    reason: '额度已耗尽，请续费或升级套餐',
                    error: 'QUOTA_EXHAUSTED',
                };
            }
            if (subscription.status === 'expired') {
                return {
                    valid: false,
                    subscription,
                    reason: '套餐已过期，请续费',
                    error: 'SUBSCRIPTION_EXPIRED',
                };
            }
            if (subscription.status !== 'active') {
                return {
                    valid: false,
                    subscription,
                    reason: `订阅状态异常: ${subscription.status}`,
                    error: 'SUBSCRIPTION_STATUS_INVALID',
                };
            }
            // 6. 更新本地缓存
            await this.sessionManager.updateSubscriptionCache({
                plan_type: subscription.plan_type,
                status: subscription.status,
                quota_remaining: subscription.quota_remaining,
                quota_total: subscription.quota_total,
                end_date: subscription.end_date,
            });
            // 7. 验证设备激活状态（如果有）
            const activation = await this.verifyActivation();
            return {
                valid: true,
                subscription,
                activation: activation ? {
                    device_id: activation.device_id,
                    expires_at: activation.expires_at,
                    status: 'active',
                } : undefined,
            };
        }
        catch (error) {
            console.error('[AuthClient] Session validation failed:', error);
            // 网络错误时，检查离线宽限期
            const inGrace = await this.sessionManager.isWithinOfflineGracePeriod();
            if (inGrace) {
                return {
                    valid: true,
                    reason: '离线模式（宽限期内）',
                };
            }
            return {
                valid: false,
                reason: '网络连接失败，且离线宽限期已过',
                error: 'NETWORK_ERROR',
            };
        }
    }
    /**
     * 验证设备激活状态
     */
    async verifyActivation() {
        try {
            const session = await this.sessionManager.getSession();
            if (!session || !session.activation?.activation_token) {
                return null;
            }
            const deviceId = await this.getDeviceId();
            const response = await fetch((0, config_1.buildApiUrl)(config_1.API_ENDPOINTS.ACTIVATION_VERIFY, this.config), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    activation_token: session.activation.activation_token,
                    device_id: deviceId,
                }),
            });
            if (!response.ok) {
                console.error('[AuthClient] Activation verification failed');
                return null;
            }
            const data = await response.json();
            return {
                device_id: data.activation.device_id,
                expires_at: data.activation.expires_at,
            };
        }
        catch (error) {
            console.error('[AuthClient] Verify activation failed:', error);
            return null;
        }
    }
    /**
     * 绑定设备到订阅
     */
    async bindDevice() {
        try {
            const session = await this.sessionManager.getSession();
            if (!session) {
                return { success: false, error: '未登录' };
            }
            const deviceId = await this.getDeviceId();
            const deviceName = os.hostname();
            const deviceOs = os.platform() + ' ' + os.release();
            const response = await fetch((0, config_1.buildApiUrl)(config_1.API_ENDPOINTS.SUBSCRIPTION_BIND_DEVICE, this.config), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.accessToken}`,
                },
                body: JSON.stringify({
                    device_id: deviceId,
                    device_name: deviceName,
                    device_os: deviceOs,
                }),
            });
            if (!response.ok) {
                const errorData = await response.json();
                return {
                    success: false,
                    error: errorData.message || '设备绑定失败',
                };
            }
            const data = await response.json();
            // 保存激活信息到本地
            await this.sessionManager.updateActivationCache({
                activation_token: data.activation.activation_token,
                device_id: deviceId,
                expires_at: data.activation.expires_at,
            });
            return {
                success: true,
                activation_token: data.activation.activation_token,
            };
        }
        catch (error) {
            console.error('[AuthClient] Bind device failed:', error);
            return {
                success: false,
                error: '网络连接失败',
            };
        }
    }
    /**
     * 上报使用量
     */
    async reportUsage(usageType, amount) {
        try {
            const session = await this.sessionManager.getSession();
            if (!session) {
                return false;
            }
            const deviceId = await this.getDeviceId();
            const response = await fetch((0, config_1.buildApiUrl)(config_1.API_ENDPOINTS.USAGE_REPORT, this.config), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.accessToken}`,
                },
                body: JSON.stringify({
                    usage_type: usageType,
                    amount,
                    device_id: deviceId,
                }),
            });
            if (!response.ok) {
                console.error('[AuthClient] Report usage failed');
                return false;
            }
            // 更新本地缓存的剩余额度
            const subscription = await this.getSubscription();
            if (subscription) {
                await this.sessionManager.updateSubscriptionCache({
                    quota_used: subscription.quota_used,
                    quota_remaining: subscription.quota_remaining,
                });
            }
            return true;
        }
        catch (error) {
            console.error('[AuthClient] Report usage failed:', error);
            return false;
        }
    }
    /**
     * 登出
     */
    async logout() {
        await this.sessionManager.clearSession();
    }
    /**
     * 获取session管理器（供其他模块使用）
     */
    getSessionManager() {
        return this.sessionManager;
    }
}
exports.AuthClient = AuthClient;
exports.default = AuthClient;
