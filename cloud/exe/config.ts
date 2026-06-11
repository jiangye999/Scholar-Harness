/**
 * exe客户端配置
 * 定义云端API地址、验证策略等
 */

export interface ExeClientConfig {
  // 云端API配置
  cloudApiUrl: string;
  apiVersion: string;
  
  // 认证配置
  accessTokenExpirySeconds: number;  // accessToken有效期（秒）
  refreshTokenExpirySeconds: number; // refreshToken有效期（秒）
  
  // 验证策略
  validationIntervalMinutes: number; // 定期验证间隔（分钟）
  offlineGraceHours: number;         // 离线宽限期（小时）
  
  // 本地存储路径
  sessionFilePath: string;           // session文件路径
  usageCachePath: string;            // 使用缓存路径
  
  // 设备信息
  deviceId: string;                  // 设备ID（运行时生成）
  deviceName: string;                // 设备名称
  deviceOs: string;                  // 操作系统
}

// 默认配置
export const DEFAULT_CONFIG: Partial<ExeClientConfig> = {
  cloudApiUrl: process.env.CLOUD_API_URL || 'https://scholarharness.com',
  apiVersion: 'v1',
  
  accessTokenExpirySeconds: 15 * 60,  // 15分钟
  refreshTokenExpirySeconds: 7 * 24 * 60 * 60, // 7天
  
  validationIntervalMinutes: 30,
  offlineGraceHours: 24,
};

/**
 * 获取exe客户端配置
 * @param customConfig 自定义配置（可覆盖默认值）
 */
export function getExeClientConfig(customConfig?: Partial<ExeClientConfig>): ExeClientConfig {
  return {
    ...DEFAULT_CONFIG,
    ...customConfig,
  } as ExeClientConfig;
}

/**
 * 云端API端点定义
 */
export const API_ENDPOINTS = {
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
  USAGE_DAILY_STATS: '/usage/daily-stats',
  USAGE_PURCHASE_CREDITS: '/usage/purchase-credits',
  
  // Prompt 相关（新增）
  PROMPTS_SKILLS_LIST: '/prompts/skills',
  PROMPTS_SKILL_GET: '/prompts/skills/:id',
  PROMPTS_VERSION: '/prompts/version',
  PROMPTS_CACHE: '/prompts/cache',
  PROMPTS_GENERATE: '/prompts/generate',
  PROMPTS_WRITE: '/prompts/write',
};

/**
 * 构建完整的API URL
 */
export function buildApiUrl(endpoint: string, config: ExeClientConfig): string {
  return `${config.cloudApiUrl}/api/${config.apiVersion}${endpoint}`;
}