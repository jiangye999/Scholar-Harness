"use strict";
/**
 * exe客户端配置
 * 定义云端API地址、验证策略等
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.API_ENDPOINTS = exports.DEFAULT_CONFIG = void 0;
exports.getExeClientConfig = getExeClientConfig;
exports.buildApiUrl = buildApiUrl;
// 默认配置
exports.DEFAULT_CONFIG = {
    cloudApiUrl: process.env.CLOUD_API_URL || 'https://scholarharness.com',
    apiVersion: 'v1',
    accessTokenExpirySeconds: 15 * 60, // 15分钟
    refreshTokenExpirySeconds: 7 * 24 * 60 * 60, // 7天
    validationIntervalMinutes: 30,
    offlineGraceHours: 24,
};
/**
 * 获取exe客户端配置
 * @param customConfig 自定义配置（可覆盖默认值）
 */
function getExeClientConfig(customConfig) {
    return {
        ...exports.DEFAULT_CONFIG,
        ...customConfig,
    };
}
/**
 * 云端API端点定义
 */
exports.API_ENDPOINTS = {
    // 认证相关
    AUTH_LOGIN: '/auth/login',
    AUTH_REGISTER: '/auth/register',
    AUTH_REFRESH: '/auth/refresh',
    AUTH_ME: '/auth/me',
    // 订阅相关
    SUBSCRIPTION_ME: '/subscription/me',
    SUBSCRIPTION_PURCHASE: '/subscription/purchase',
    SUBSCRIPTION_BIND_DEVICE: '/subscription/bind-device',
    // 激活相关
    ACTIVATION_VERIFY: '/activation/verify',
    ACTIVATION_MY: '/activation/my-activations',
    // 使用量相关
    USAGE_REPORT: '/usage/report',
    USAGE_STATS: '/usage/my-stats',
};
/**
 * 构建完整的API URL
 */
function buildApiUrl(endpoint, config) {
    return `${config.cloudApiUrl}/api/${config.apiVersion}${endpoint}`;
}
