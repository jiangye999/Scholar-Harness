type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  private isDebug: boolean;

  constructor() {
    this.isDebug = process.env.DEBUG === '1' || process.env.NODE_ENV === 'development';
  }

  private formatMessage(level: LogLevel, ...args: any[]): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
    return `${prefix} ${args.map(a => 
      typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)
    ).join(' ')}`;
  }

  debug(...args: any[]): void {
    if (this.isDebug) {
      console.log(this.formatMessage('debug', ...args));
    }
  }

  info(...args: any[]): void {
    console.log(this.formatMessage('info', ...args));
  }

  warn(...args: any[]): void {
    console.warn(this.formatMessage('warn', ...args));
  }

  error(...args: any[]): void {
    console.error(this.formatMessage('error', ...args));
  }
}

export const logger = new Logger();