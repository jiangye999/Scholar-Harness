/**
 * ChatBridge 统一超时配置
 * 所有超时值集中管理，便于维护
 */

/**
 * 默认超时配置（毫秒）
 */
export const TIMEOUT_CONFIG = {
  // 浏览器操作超时
  BROWSER_OPERATION: 30000,        // 30秒 - 基本浏览器操作
  BROWSER_PAGE_LOAD: 15000,        // 15秒 - 页面加载
  
  // 聊天相关超时
  CHAT_RESPONSE_WAIT: 240000,      // 4分钟 - 等待 AI 响应
  CHAT_STREAM_TIMEOUT: 180000,     // 3分钟 - 流式响应超时
  CHAT_SERVICE_STARTUP: 60000,     // 60秒 - 服务启动等待
  
  // HTTP 请求超时
  HTTP_REQUEST: 30000,             // 30秒 - 普通 HTTP 请求
  HTTP_LONG_REQUEST: 180000,       // 3分钟 - 长时间请求
  HTTP_CONTROL_REQUEST: 15000,     // 15秒 - 控制请求
  
  // 服务健康检查
  HEALTH_CHECK: 3000,              // 3秒 - 健康检查超时
  
  // Stall 检测（流式响应卡住检测）
  STALL_DETECTION: 25000,          // 25秒 - 判定为卡住的时间
  
  // 服务端口
  DEFAULT_PORT: 19222,
  
  // 重试配置
  MAX_RETRY_ATTEMPTS: 5,           // 最大重试次数
  RETRY_DELAY: 2000,               // 2秒 - 重试间隔
} as const;

/**
 * 获取超时值（支持从环境变量覆盖）
 */
export function getTimeout(key: keyof typeof TIMEOUT_CONFIG): number {
  const envKey = `CHATBRIDGE_TIMEOUT_${key}`;
  const envValue = process.env[envKey];
  
  if (envValue) {
    const parsed = parseInt(envValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  
  return TIMEOUT_CONFIG[key];
}

/**
 * 获取服务端口
 */
export function getServicePort(): number {
  const envPort = process.env.CHATBRIDGE_PORT;
  if (envPort) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return TIMEOUT_CONFIG.DEFAULT_PORT;
}