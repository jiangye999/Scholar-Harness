// 简单的日志工具

const DEBUG = process.env.DEBUG === '1';

export const logger = {
  debug(...args: unknown[]) {
    if (DEBUG) console.log('[DEBUG]', ...args);
  },
  
  info(...args: unknown[]) {
    console.log('[INFO]', ...args);
  },
  
  warn(...args: unknown[]) {
    console.warn('[WARN]', ...args);
  },
  
  error(...args: unknown[]) {
    console.error('[ERROR]', ...args);
  },
};

export default logger;
