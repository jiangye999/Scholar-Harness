/**
 * 数据脱敏工具函数
 * 用于日志输出和配置显示时隐藏敏感信息
 */

/**
 * 邮箱脱敏
 * 将邮箱地址中间部分替换为星号
 * 
 * @example
 * maskEmail('user@example.com')  // 'us***@example.com'
 * maskEmail('ab@test.org')       // 'a***@test.org'
 */
export function maskEmail(email: string | undefined): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.substring(0, 2)}***@${domain}`;
}

/**
 * 密钥/密码脱敏
 * 仅显示首尾各2个字符，中间用星号替换
 * 
 * @example
 * maskSecret('abcdef123456')  // 'ab****56'
 * maskSecret('key')           // '****'
 */
export function maskSecret(secret: string | undefined): string {
  if (!secret) return '';
  if (secret.length <= 4) return '****';
  return secret.substring(0, 2) + '****' + secret.substring(secret.length - 2);
}

/**
 * URL 脱敏（隐藏敏感查询参数）
 * 
 * @example
 * maskUrl('https://api.example.com?key=secret123')  // 'https://api.example.com?key=****'
 */
export function maskUrl(url: string | undefined): string {
  if (!url) return '';
  // 隐藏 URL 中的敏感查询参数
  return url.replace(/([?&])(api_key|key|token|secret|password)=([^&]*)/gi, '$1$2=****');
}