import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../../utils/logger';
import type { ChatOptions, Message } from '../../types';

export interface NiceAIGCConfig {
  mode: 'browser' | 'auto';
  niceaigc: {
    api_key?: string;
    api_url?: string;
    login_url?: string;
    chat_url: string;
  };
  browser: {
    profile: string;
    timeout_ms: number;
    wait_for_response_ms: number;
  };
}

export interface NiceAIGCChatOptions {
  model?: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}

export interface NiceAIGCChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class NiceAIGCBridgeAdapter {
  private configPath: string;
  private config: NiceAIGCConfig | null = null;
  private selectors: {
    inputBox: string | null;
    sendButton: string | null;
    responseArea: string | null;
  } = {
    inputBox: null,
    sendButton: null,
    responseArea: null,
  };

  constructor(configPath?: string) {
    this.configPath = configPath || join(process.cwd(), 'src', 'bridge', 'niceaigc', 'config.json');
  }

  async loadConfig(): Promise<NiceAIGCConfig> {
    try {
      const configData = await readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configData) as NiceAIGCConfig;
      logger.info(`[NiceAIGC] 配置加载完成 | 模式：${this.config.mode}`);
      return this.config;
    } catch (error) {
      logger.error(`[NiceAIGC] 配置加载失败：${(error as Error).message}`);
      throw error;
    }
  }

  async chat(options: ChatOptions): Promise<string> {
    if (!this.config) {
      await this.loadConfig();
    }

    const lastMessage = options.messages[options.messages.length - 1];
    const message = lastMessage.content;

    logger.info(`[NiceAIGC] 发送消息 | 长度：${message.length} 字符`);

    try {
      return await this.sendViaBrowser(message);
    } catch (error) {
      logger.error(`[NiceAIGC] 错误：${(error as Error).message}`);
      throw error;
    }
  }

  private async sendViaBrowser(message: string): Promise<string> {
    logger.info('[NiceAIGC] 使用浏览器模式...');

    if (!this.config) {
      throw new Error('配置未加载');
    }

    const chatUrl = this.config.niceaigc.chat_url;
    const profile = this.config.browser.profile;
    const waitMs = this.config.browser.wait_for_response_ms || 240000;

    try {
      logger.info('[NiceAIGC] 执行聊天操作...');
      const sanitizedMessage = message.replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const { stdout } = await this.runCommand(
        `browser --action chat --url "${chatUrl}" --profile ${profile} --text "${sanitizedMessage}" --wait ${waitMs}`,
        this.config.browser.timeout_ms
      );

      logger.info('[NiceAIGC] 完成');
      return stdout || '[无响应]';
    } catch (error) {
      logger.error(`[NiceAIGC] 浏览器模式错误：${(error as Error).message}`);
      throw error;
    }
  }

  private async identifyElements(): Promise<void> {
    try {
      const { stdout } = await this.runCommand(
        'browser --action snapshot --refs aria',
        10000
      );

      const lines = stdout.split('\n');

      for (const line of lines) {
        if (
          line.includes('textarea') ||
          line.includes('contenteditable') ||
          line.includes('输入') ||
          line.includes('message')
        ) {
          const match = line.match(/\[([\w-]+)\]/);
          if (match && !this.selectors.inputBox) {
            this.selectors.inputBox = match[1];
            logger.info(`[NiceAIGC] 找到输入框: ${this.selectors.inputBox}`);
          }
        }

        if (
          line.includes('button') &&
          (line.includes('发送') || line.includes('submit') || line.includes('send'))
        ) {
          const match = line.match(/\[([\w-]+)\]/);
          if (match && !this.selectors.sendButton) {
            this.selectors.sendButton = match[1];
            logger.info(`[NiceAIGC] 找到发送按钮: ${this.selectors.sendButton}`);
          }
        }
      }

      if (!this.selectors.inputBox) {
        this.selectors.inputBox = 'textarea';
        logger.warn('[NiceAIGC] 使用默认输入框选择器: textarea');
      }
      if (!this.selectors.sendButton) {
        this.selectors.sendButton = 'button[type="submit"]';
        logger.warn('[NiceAIGC] 使用默认发送按钮选择器: button[type="submit"]');
      }
    } catch (error) {
      logger.error(`[NiceAIGC] 元素识别失败：${(error as Error).message}`);
      this.selectors.inputBox = 'textarea';
      this.selectors.sendButton = 'button[type="submit"]';
    }
  }

  private async extractResponse(): Promise<string> {
    try {
      const { stdout } = await this.runCommand(
        'browser --action snapshot --format text',
        10000
      );

      const lines = stdout.split('\n').filter((line) => line.trim());
      const response = lines.slice(-10).join('\n');

      return response || '[未提取到响应]';
    } catch (error) {
      logger.error(`[NiceAIGC] 响应提取失败：${(error as Error).message}`);
      return '[响应提取失败]';
    }
  }

  private async runCommand(command: string, timeout: number = 60000): Promise<{ stdout: string; stderr: string }> {
    logger.debug(`[NiceAIGC] Executing: ${command}`);
    
    const openclawPath = 'E:/AI_projects/openclaw';
    
    // Parse command with proper quote handling
    const args: string[] = [];
    let current = '';
    let inQuote = false;
    let quoteChar = '';
    
    for (let i = 0; i < command.length; i++) {
      const char = command[i];
      
      if (!inQuote && (char === '"' || char === "'")) {
        inQuote = true;
        quoteChar = char;
      } else if (inQuote && char === quoteChar) {
        inQuote = false;
        quoteChar = '';
      } else if (!inQuote && char === ' ') {
        if (current) {
          args.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }
    
    if (current) {
      args.push(current);
    }
    
    logger.debug(`[NiceAIGC] Parsed args: ${JSON.stringify(args)}`);
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['index.js', ...args], {
        cwd: openclawPath,
        timeout: timeout,
      });
      
      let stdout = '';
      let stderr = '';
      
      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });
      
      child.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          stderr += data.toString();
          // Real-time log stderr
          logger.info(`[NiceAIGC-Debug] ${line}`);
        }
      });
      
      child.on('close', (code) => {
        if (code === 0 || code === null) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
      
      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async testConnection(): Promise<boolean> {
    try {
      if (!this.config) {
        await this.loadConfig();
      }

      logger.info('[NiceAIGC] 测试连接...');
      await this.runCommand(
        `browser --action open --url "${this.config!.niceaigc.chat_url}" --profile ${this.config!.browser.profile}`,
        10000
      );

      logger.info('[NiceAIGC] 连接测试成功');
      return true;
    } catch (error) {
      logger.error(`[NiceAIGC] 连接测试失败：${(error as Error).message}`);
      return false;
    }
  }
}

export const niceAIGCBridge = new NiceAIGCBridgeAdapter();
