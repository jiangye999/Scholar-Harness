// 简单的日志工具

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 50,
};

function resolveLogLevel(): LogLevel {
  const configured = String(process.env.LOG_LEVEL || '').toLowerCase();
  if (configured in LEVEL_WEIGHT) {
    return configured as LogLevel;
  }
  if (process.env.DEBUG === '1') {
    return 'debug';
  }
  return process.env.NODE_ENV === 'production' ? 'warn' : 'info';
}

const CURRENT_LEVEL = resolveLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_WEIGHT[level] >= LEVEL_WEIGHT[CURRENT_LEVEL];
}

export const logger = {
  debug(...args: unknown[]) {
    if (shouldLog('debug')) console.log('[DEBUG]', ...args);
  },
  
  info(...args: unknown[]) {
    if (shouldLog('info')) console.log('[INFO]', ...args);
  },
  
  warn(...args: unknown[]) {
    if (shouldLog('warn')) console.warn('[WARN]', ...args);
  },
  
  error(...args: unknown[]) {
    if (shouldLog('error')) console.error('[ERROR]', ...args);
  },
};

export default logger;
