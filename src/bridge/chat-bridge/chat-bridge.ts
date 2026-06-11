import { spawn } from 'child_process';
import { readFile, writeFile, mkdir, unlink, mkdtemp, rmdir } from 'fs/promises';
import * as path from 'path';
import { join } from 'path';
import * as os from 'os';
import http from 'http';
import { existsSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { maskEmail, maskSecret } from '../../utils/sanitize';
import { decrypt, isEncrypted } from '../../utils/encryption';
import { callChatCompletion } from '../../utils/llm-client';
import type { ChatOptions, Message } from '../../types';

// PID 文件路径（用于防止 openclaw serve 多开）
const OPENCLAW_PID_FILE = 'openclaw-serve.pid';

/**
 * 安全创建临时目录
 * 使用系统临时目录 + 随机子目录名
 */
async function createSecureTempDir(): Promise<string> {
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'chat-bridge-'));
  return tmpDir;
}

/**
 * 安全写入临时文件
 * 设置权限为仅所有者可读写 (0o600)
 */
async function writeSecureTempFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { mode: 0o600 });
}

/**
 * 获取 PID 文件路径
 */
function getPidFilePath(): string {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  return join(dataDir, OPENCLAW_PID_FILE);
}

/**
 * 检查进程是否在运行
 */
function isProcessRunning(pid: number): boolean {
  try {
    // 发送信号 0（不实际终止进程，仅检查进程是否存在）
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 读取 PID 文件
 */
function readPidFile(): number | null {
  try {
    const pidFile = getPidFilePath();
    if (!existsSync(pidFile)) {
      return null;
    }
    const pidStr = readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    return isNaN(pid) ? null : pid;
  } catch (e) {
    return null;
  }
}

/**
 * 写入 PID 文件
 */
function writePidFile(pid: number): void {
  try {
    const pidFile = getPidFilePath();
    const pidDir = join(pidFile, '..');
    if (!existsSync(pidDir)) {
      mkdir(pidDir, { recursive: true });
    }
    writeFileSync(pidFile, String(pid), 'utf-8');
    logger.info(`[ChatBridge] PID 文件已写入: ${pid}`);
  } catch (e) {
    logger.error(`[ChatBridge] 写入 PID 文件失败: ${(e as Error).message}`);
  }
}

/**
 * 删除 PID 文件
 */
function removePidFile(): void {
  try {
    const pidFile = getPidFilePath();
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
      logger.info(`[ChatBridge] PID 文件已删除`);
    }
  } catch (e) {
    logger.warn(`[ChatBridge] 删除 PID 文件失败: ${(e as Error).message}`);
  }
}

// 获取 openclaw 目录路径
function getOpenclawPath(): string {
  if (process.env.OPENCLAW_DIR) {
    return process.env.OPENCLAW_DIR;
  }
  
  const resPath = (process as any).resourcesPath;
  if (resPath && typeof resPath === 'string') {
    const packagedPath = join(resPath, 'openclaw');
    if (existsSync(packagedPath)) {
      logger.debug(`[ChatBridge] Using packaged openclaw path: ${packagedPath}`);
      return packagedPath;
    }
  }
  
  return join(process.cwd(), 'openclaw');
}

/**
 * 解析主配置路径（统一优先级）
 * 第一优先级：CHAT_BRIDGE_CONFIG_PATH
 * 第二优先级：DATA_DIR/chat-bridge-config.json
 * 第三优先级（仅开发兜底）：默认 config.json
 */
function resolvePrimaryConfigPath(): string {
  // 第一优先级：显式传入的环境变量
  const explicitPath = process.env.CHAT_BRIDGE_CONFIG_PATH;
  if (explicitPath) {
    logger.info(`[ChatBridge] 显式配置路径: ${explicitPath}`);
    return explicitPath;
  }
  
  // 第二优先级：用户数据目录
  const userDataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const userConfigPath = join(userDataDir, 'chat-bridge-config.json');
  
  if (existsSync(userConfigPath)) {
    logger.info(`[ChatBridge] 用户配置路径: ${userConfigPath}`);
    return userConfigPath;
  }
  
  // 第三优先级：开发环境默认 config.json（仅当前两者都不存在时）
  const devFallback = join(process.cwd(), 'config.json');
  if (existsSync(devFallback)) {
    logger.info(`[ChatBridge] 开发兜底配置路径: ${devFallback} (仅 fallback)`);
    return devFallback;
  }
  
  // 最终兜底：openclaw 目录下的 config.json
  const openclawConfig = join(getOpenclawPath(), 'config.json');
  logger.info(`[ChatBridge] 最终兜底: ${openclawConfig}`);
  return openclawConfig;
}

export interface ChatBridgeConfig {
  mode: 'browser' | 'api' | 'auto';
  chat: {
    api_key?: string;
    api_url?: string;
    login_url?: string;
    chat_url: string;
    credentials?: {
      email: string;
      password: string;
    };
    bridge_secret?: string;
  };
  browser: {
    profile: string;
    timeout_ms: number;
    wait_for_response_ms: number;
  };
  service?: {
    enabled: boolean;
    port: number;
  };
  // ========== 新的双 Agent API 配置 ==========
  // 大牛马 API 配置（规划、Skill生成、质量检查）
  primary?: {
    api_url?: string;
    api_key?: string;
    model?: string;
    description?: string;
  };
  // 小牛马 API 配置（执行写作、引用验证）
  secondary?: {
    api_url?: string;
    api_key?: string;
    model?: string;
    vision_model?: string;
    description?: string;
  };
  codex?: {
    enabled?: boolean;
    prefer?: boolean;
    command?: string;
    model?: string;
    reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh';
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    timeout_ms?: number;
    pdf_wiki_concurrency?: number;
    concurrency?: number;
  };
}

export interface ChatBridgeChatOptions {
  model?: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatBridgeChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ChatBridgeState {
  serviceRunning: boolean;
  paused: boolean;
  currentUrl: string | null;
  hasActivePage: boolean;
}

export class ChatBridgeAdapter {
  private configPath: string;
  private config: ChatBridgeConfig | null = null;
  private selectors: {
    inputBox: string | null;
    sendButton: string | null;
    responseArea: string | null;
  } = {
    inputBox: null,
    sendButton: null,
    responseArea: null,
  };
  private openclawServiceProcess: ReturnType<typeof spawn> | null = null;
  private paused = false;
  private serviceStarting = false;  // 互斥锁，防止并发启动

  constructor(configPath?: string) {
    if (configPath) {
      this.configPath = configPath;
      logger.info(`[ChatBridge] 使用传入配置路径: ${configPath}`);
    } else {
      this.configPath = resolvePrimaryConfigPath();
      logger.info(`[ChatBridge] 解析配置路径: ${this.configPath}`);
    }
  }

  async loadConfig(): Promise<ChatBridgeConfig> {
    try {
      // 默认配置模板
      const defaults: ChatBridgeConfig = {
        mode: 'api',  // 默认改为 API 模式
        chat: {
          chat_url: '',
          credentials: { email: '', password: '' },
        },
        browser: {
          profile: 'chrome',
          timeout_ms: 300000,
          wait_for_response_ms: 240000,
        },
        service: {
          enabled: true,
          port: 19222,
        },
        // 默认的双 Agent 配置
        primary: {
          api_url: '',
          api_key: '',
          model: 'claude-sonnet-4-5',
          description: '大牛马 - 规划、Skill生成、写作',
        },
        secondary: {
          api_url: '',
          api_key: '',
          model: 'gpt-4o',
          vision_model: 'gpt-4o',
          description: '小牛马 - 引用验证、更新记忆',
        },
        codex: {
          enabled: false,
          prefer: false,
          command: '',
          model: 'gpt-5.5',
          reasoning_effort: 'xhigh',
          sandbox: 'workspace-write',
          timeout_ms: 300000,
          pdf_wiki_concurrency: 1,
        },
      };
      
      // 检查配置文件是否存在
      if (!existsSync(this.configPath)) {
        logger.info(`[ChatBridge] 配置文件不存在，创建默认空白配置: ${this.configPath}`);
        
        // 确保目录存在
        const configDir = join(this.configPath, '..');
        if (!existsSync(configDir)) {
          await mkdir(configDir, { recursive: true });
        }
        
        // 写入默认空白配置
        await writeFile(this.configPath, JSON.stringify(defaults, null, 2), 'utf-8');
        logger.info('[ChatBridge] 默认空白配置已创建，请在前端配置 AI 桥接');
        
        this.config = defaults;
        return this.config;
      }
      
      // 文件存在，读取并解析
      const configData = await readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(configData);
      
      this.config = {
        ...defaults,
        ...parsed,
        chat: { ...defaults.chat, ...parsed.chat },
        browser: { ...defaults.browser, ...(parsed.browser || {}) },
        service: { ...defaults.service, ...(parsed.service || {}) },
        primary: { ...defaults.primary, ...(parsed.primary || {}) },
        secondary: { ...defaults.secondary, ...(parsed.secondary || {}) },
        codex: { ...defaults.codex, ...(parsed.codex || {}) },
      } as ChatBridgeConfig;
      
      // 解密加密字段 - chat 配置
      if (this.config.chat?.api_key && isEncrypted(this.config.chat.api_key)) {
        try {
          this.config.chat.api_key = decrypt(this.config.chat.api_key);
          logger.info('[ChatBridge] chat.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt chat.api_key, using as-is');
        }
      }
      
      if (this.config.chat?.credentials?.password && isEncrypted(this.config.chat.credentials.password)) {
        try {
          this.config.chat.credentials.password = decrypt(this.config.chat.credentials.password);
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt password, using as-is');
        }
      }
      
      if (this.config.chat?.bridge_secret && isEncrypted(this.config.chat.bridge_secret)) {
        try {
          this.config.chat.bridge_secret = decrypt(this.config.chat.bridge_secret);
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt bridge_secret, using as-is');
        }
      }
      
      // 解密加密字段 - primary 配置
      if (this.config.primary?.api_key && isEncrypted(this.config.primary.api_key)) {
        try {
          this.config.primary.api_key = decrypt(this.config.primary.api_key);
          logger.info('[ChatBridge] primary.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt primary.api_key, using as-is');
        }
      }
      
      // 解密加密字段 - secondary 配置
      if (this.config.secondary?.api_key && isEncrypted(this.config.secondary.api_key)) {
        try {
          this.config.secondary.api_key = decrypt(this.config.secondary.api_key);
          logger.info('[ChatBridge] secondary.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt secondary.api_key, using as-is');
        }
      }
      
      const maskedEmail = maskEmail(this.config.chat?.credentials?.email);
      const hasPrimaryConfig = !!this.config.primary?.api_url && !!this.config.primary?.api_key;
      const hasSecondaryConfig = !!this.config.secondary?.api_url && !!this.config.secondary?.api_key;
      const codexPreferred = !!this.config.codex?.prefer;
      logger.info(`[ChatBridge] 配置加载完成 | mode=${this.config.mode} | primary_valid=${hasPrimaryConfig} | secondary_valid=${hasSecondaryConfig} | codex_prefer=${codexPreferred ? 'enabled' : 'disabled'} | primary_model=${this.config.primary?.model} | secondary_model=${this.config.secondary?.model}`);
      
      return this.config;
    } catch (error) {
      logger.error(`[ChatBridge] 配置加载失败：${(error as Error).message}`);
      throw error;
    }
  }

  private resolveCodexCliExecutable(): string {
    const found = this.findCodexCliExecutable();
    if (found) return found;
    return 'codex';
  }

  private normalizeCodexCliCommand(value?: string): string {
    return String(value || '').trim().replace(/^["']|["']$/g, '');
  }

  private findCodexCliExecutable(commandOverride?: string): string | null {
    const candidates: string[] = [];
    const override = this.normalizeCodexCliCommand(commandOverride);
    const configured = this.normalizeCodexCliCommand(this.config?.codex?.command);
    const envPath = this.normalizeCodexCliCommand(process.env.CODEX_CLI_PATH);
    if (override) candidates.push(override);
    if (configured) candidates.push(configured);
    if (envPath) candidates.push(envPath);

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local');
      candidates.push(
        join(appData, 'npm', 'codex.cmd'),
        join(appData, 'npm', 'codex.exe'),
        join(appData, 'npm', 'codex.ps1'),
        join(localAppData, 'Programs', 'codex', 'codex.exe')
      );
    } else {
      candidates.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', '/usr/bin/codex');
    }

    const pathExts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.toLowerCase())
      : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (process.platform === 'win32') {
        for (const ext of pathExts) {
          candidates.push(join(dir, `codex${ext.toLowerCase()}`));
        }
      } else {
        candidates.push(join(dir, 'codex'));
      }
    }

    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    return uniqueCandidates.find(candidate => existsSync(candidate)) || null;
  }

  private spawnCodexProcess(executable: string, args: string[]): ReturnType<typeof spawn> {
    const isWindowsPowerShellScript = process.platform === 'win32' && /\.ps1$/i.test(executable);
    if (isWindowsPowerShellScript) {
      return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args], {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env: process.env,
      });
    }

    const isWindowsBatchScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    if (!isWindowsBatchScript) {
      return spawn(executable, args, {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env: process.env,
      });
    }

    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', executable, ...args], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env: process.env,
    });
  }

  async getCodexCliStatus(commandOverride?: string): Promise<{ available: boolean; path: string; version?: string; error?: string }> {
    if (!this.config) {
      await this.loadConfig();
    }
    const executable = this.findCodexCliExecutable(commandOverride);
    if (!executable) {
      return { available: false, path: '', error: '未在常见路径或 PATH 中找到 codex 命令' };
    }

    try {
      const version = await new Promise<string>((resolve, reject) => {
        const child = this.spawnCodexProcess(executable, ['--version']);
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          reject(new Error('Codex CLI version check timed out'));
        }, 10000);
        child.stdout?.on('data', chunk => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', chunk => {
          stderr += chunk.toString();
        });
        child.on('error', error => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', code => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(stderr || stdout || `Codex CLI exited with code ${code}`));
            return;
          }
          resolve((stdout || stderr).trim());
        });
      });
      return { available: true, path: executable, version };
    } catch (error) {
      return { available: false, path: executable, error: (error as Error).message };
    }
  }

  private buildCodexPrompt(options: ChatOptions): string {
    return options.messages
      .map((message) => {
        const role = message.role === 'system'
          ? 'System'
          : (message.role === 'assistant' ? 'Assistant' : 'User');
        return `## ${role}\n${message.content}`;
      })
      .join('\n\n');
  }

  private async runCodexCli(options: ChatOptions): Promise<string> {
    const codexConfig = this.config?.codex || {};
    const executable = this.resolveCodexCliExecutable();
    const outputDir = await createSecureTempDir();
    const outputFile = join(outputDir, 'codex-last-message.txt');
    const timeoutMs = Number(options.codexTimeoutMs || codexConfig.timeout_ms || 300000);
    const args = [
      'exec',
      '--skip-git-repo-check',
      '--cd',
      process.cwd(),
      '--sandbox',
      codexConfig.sandbox || 'workspace-write',
      '--output-last-message',
      outputFile,
    ];
    if (codexConfig.model?.trim()) {
      args.push('-m', codexConfig.model.trim());
    }
    if (codexConfig.reasoning_effort) {
      args.push('-c', `model_reasoning_effort="${codexConfig.reasoning_effort}"`);
    }
    args.push('-');

    const prompt = this.buildCodexPrompt(options);
    logger.info(`[ChatBridge] Codex CLI 调用 | command=${executable} | model=${codexConfig.model || 'default'} | effort=${codexConfig.reasoning_effort || 'default'} | prompt=${prompt.length} chars`);

    try {
      const content = await new Promise<string>((resolve, reject) => {
        const child = this.spawnCodexProcess(executable, args);

        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
        }, timeoutMs);

        child.stdout?.on('data', (chunk) => {
          stdout += chunk.toString();
        });
        child.stderr?.on('data', (chunk) => {
          stderr += chunk.toString();
        });
        child.on('error', (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', async (code) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout || 'no output'}`));
            return;
          }

          try {
            const finalMessage = existsSync(outputFile)
              ? (await readFile(outputFile, 'utf-8')).trim()
              : '';
            const fallbackOutput = stdout.trim();
            const answer = finalMessage || fallbackOutput;
            if (!answer) {
              reject(new Error('Codex CLI returned empty response'));
              return;
            }
            resolve(answer);
          } catch (error) {
            reject(error);
          }
        });

        child.stdin?.write(prompt);
        child.stdin?.end();
      });

      if (options.onProgress) {
        options.onProgress(content);
      }
      return content;
    } finally {
      try {
        if (existsSync(outputFile)) await unlink(outputFile);
        await rmdir(outputDir);
      } catch {
        // best-effort cleanup
      }
    }
  }

  private async chatWithSecondaryFallback(options: ChatOptions, reason: string): Promise<string> {
    logger.warn(`[ChatBridge] ${reason}，降级使用小牛马`);
    const secondaryApiUrl = options.apiUrl || this.config?.secondary?.api_url || '';
    const secondaryApiKey = options.apiKey || this.config?.secondary?.api_key || '';
    const secondaryModel = options.model || this.config?.secondary?.model || 'gpt-4o';
    const primaryApiUrl = this.config?.primary?.api_url || '';
    const primaryApiKey = this.config?.primary?.api_key || '';
    const primaryModel = this.config?.primary?.model || 'claude-sonnet-4-5';
    const attempts: string[] = [reason];

    if (secondaryApiUrl && secondaryApiKey) {
      try {
        const content = await callChatCompletion(
          {
            apiUrl: secondaryApiUrl,
            apiKey: secondaryApiKey,
            label: 'ChatBridge Secondary Fallback',
            defaultModel: secondaryModel,
          },
          {
            model: secondaryModel,
            messages: options.messages,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: false,
          }
        );
        if (options.onProgress) {
          options.onProgress(content);
        }
        return content;
      } catch (error) {
        attempts.push(`小牛马 API: ${(error as Error).message}`);
        logger.warn(`[ChatBridge] 小牛马降级失败，继续尝试大牛马: ${(error as Error).message}`);
      }
    } else {
      attempts.push('小牛马 API: 未配置');
    }

    if (primaryApiUrl && primaryApiKey) {
      const content = await callChatCompletion(
        {
          apiUrl: primaryApiUrl,
          apiKey: primaryApiKey,
          label: 'ChatBridge Primary Fallback',
          defaultModel: primaryModel,
        },
        {
          model: primaryModel,
          messages: options.messages,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          stream: false,
        }
      );
      if (options.onProgress) {
        options.onProgress(content);
      }
      return content;
    }

    attempts.push('大牛马 API: 未配置');
    throw new Error(attempts.join('；'));
  }

  async chat(options: ChatOptions): Promise<string> {
    if (!this.config) {
      await this.loadConfig();
    }

    // ========== 注释掉浏览器桥接服务同步（已弃用，使用纯API模式）==========
    // await this.syncCredentialsToOpenClaw();

    const lastMessage = options.messages[options.messages.length - 1];
    const message = lastMessage.content;

    logger.info(`[ChatBridge] 发送消息 | 长度：${message.length} 字符`);
    logger.info(`[ChatBridge] 消息预览（前200字符）："${message.substring(0, 200)}..."`);
    
    const hasFullPrompt = message.includes('## 🎯 核心职责') || 
                          message.includes('## ⚠️ 重要：代码控制参考文献') ||
                          message.length > 5000;
    logger.info(`[ChatBridge] 是否完整提示词：${hasFullPrompt} (长度>5000=${message.length > 5000})`);

    try {
      // ========== 新的双 Agent Provider 选择逻辑 ==========
      // forceProvider 选择：
      // - 'primary': 使用大牛马 API 配置（规划、Skill生成）
      // - 'secondary': 使用小牛马 API 配置（执行写作）
      // - 'codex': 使用本机 Codex CLI
      // - 'api': 使用前端传入的配置（向后兼容）
      // - 'browser': 已弃用，回退到 primary
      
      let selectedApiUrl: string;
      let selectedApiKey: string;
      let selectedModel: string;
      const preferCodex = !!this.config?.codex?.prefer;
      const shouldTryCodex =
        options.forceProvider === 'codex' ||
        (!options.forceProvider && preferCodex) ||
        (options.forceProvider === 'primary' && preferCodex);

      if (shouldTryCodex) {
        try {
          const content = await this.runCodexCli(options);
          logger.info(`[ChatBridge] Codex CLI 模式成功 | 响应长度: ${content.length}`);
          return content;
        } catch (codexError) {
          const message = (codexError as Error).message || String(codexError);
          logger.warn(`[ChatBridge] Codex CLI 不可用或执行失败: ${message}`);
          if (options.disableFallback) {
            throw codexError;
          }
          if (options.forceProvider === 'codex' || (!options.forceProvider && preferCodex)) {
            return this.chatWithSecondaryFallback(options, `Codex CLI 不可用或执行失败：${message}`);
          }
          logger.warn('[ChatBridge] @大牛马 Codex CLI 失败，继续尝试大牛马 API 配置');
        }
      }
      
      if (options.forceProvider === 'primary') {
        // 大牛马：使用 primary 配置
        selectedApiUrl = this.config?.primary?.api_url || '';
        selectedApiKey = this.config?.primary?.api_key || '';
        selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
        logger.info(`[ChatBridge] forceProvider=primary，使用大牛马配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error('大牛马 API 未配置。请在 AI 桥接设置中配置大牛马的 API URL 和 Key。');
        }
      } else if (options.forceProvider === 'secondary') {
        // 小牛马：优先使用请求中的配置，其次使用 secondary 配置
        selectedApiUrl = options.apiUrl || this.config?.secondary?.api_url || '';
        selectedApiKey = options.apiKey || this.config?.secondary?.api_key || '';
        selectedModel = options.model || this.config?.secondary?.model || 'gpt-4o';
        logger.info(`[ChatBridge] forceProvider=secondary，使用小牛马配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error('小牛马 API 未配置。请在前端 ⚙️ API 设置或 AI 桥接设置中配置小牛马的 API。');
        }
      } else if (options.forceProvider === 'api') {
        // 向后兼容：使用前端传入的配置
        selectedApiUrl = options.apiUrl || this.config?.secondary?.api_url || this.config?.chat?.api_url || '';
        selectedApiKey = options.apiKey || this.config?.secondary?.api_key || this.config?.chat?.api_key || '';
        selectedModel = options.model || this.config?.secondary?.model || 'gpt-4o';
        logger.info(`[ChatBridge] forceProvider=api，使用前端传入配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error('API 未配置。请在前端 ⚙️ API 设置中配置 API URL 和 Key。');
        }
      } else if (options.forceProvider === 'codex') {
        return this.chatWithSecondaryFallback(options, 'Codex CLI 不可用或执行失败');
      } else if (options.forceProvider === 'browser') {
        // 浏览器模式已弃用，回退到 primary
        logger.warn('[ChatBridge] forceProvider=browser 已弃用，回退到 primary API 配置');
        selectedApiUrl = this.config?.primary?.api_url || '';
        selectedApiKey = this.config?.primary?.api_key || '';
        selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error('大牛马 API 未配置。请在 AI 桥接设置中配置大牛马的 API URL 和 Key。');
        }
      } else {
        // 自动选择：默认使用 secondary（小牛马）
        selectedApiUrl = options.apiUrl || this.config?.secondary?.api_url || '';
        selectedApiKey = options.apiKey || this.config?.secondary?.api_key || '';
        selectedModel = options.model || this.config?.secondary?.model || 'gpt-4o';
        logger.info(`[ChatBridge] 自动选择小牛马配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          // 回退到 primary
          selectedApiUrl = this.config?.primary?.api_url || '';
          selectedApiKey = this.config?.primary?.api_key || '';
          selectedModel = this.config?.primary?.model || 'claude-sonnet-4-5';
          logger.info(`[ChatBridge] secondary 未配置，回退到大牛马配置 | url: ${selectedApiUrl}`);
          
          if (!selectedApiUrl || !selectedApiKey) {
            throw new Error('未配置任何 API。请在 AI 桥接设置中配置大牛马和小牛马的 API URL 和 Key。');
          }
        }
      }
      
      // ========== API 模式统一处理 ==========
      logger.info(`[ChatBridge] 使用 API 模式 | url: ${selectedApiUrl} | model: ${selectedModel}`);
      
      try {
        const content = await callChatCompletion(
          {
            apiUrl: selectedApiUrl,
            apiKey: selectedApiKey,
            label: 'ChatBridge',
            defaultModel: selectedModel,
          },
          {
            model: selectedModel,
            messages: options.messages,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: false,
          }
        );

        logger.info(`[ChatBridge] API 模式成功 | 响应长度: ${content.length}`);
        
        if (options.onProgress) {
          options.onProgress(content);
        }
        
        return content;
      } catch (apiError) {
        logger.error(`[ChatBridge] API 模式失败: ${(apiError as Error).message}`);
        throw apiError;
      }
    } catch (error) {
      logger.error(`[ChatBridge] 错误：${(error as Error).message}`);
      throw error;
    }
  }

  // ========== 浏览器桥接服务代码已注释（已弃用，使用纯API模式）==========
  // 以下代码用于启动 openclaw serve 子进程和SSE流式传输，现已弃用
  // 大牛马和小牛马使用纯API模式，无需浏览器桥接服务

  /**
   * 同步凭据到 OpenClaw 配置 [已注释 - 弃用]
   */
  // private async syncCredentialsToOpenClaw(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 确保 openclaw serve 进程在运行 [已注释 - 弃用]
   */
  // private async ensureServiceRunning(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 检查 openclaw serve 健康状态 [已注释 - 弃用]
   */
  // private checkServiceHealth(): Promise<boolean> {
  //   ... 已注释 ...
  // }

  /**
   * 启动 openclaw serve 子进程 [已注释 - 弃用]
   */
  // private async startOpenclawService(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 停止 openclaw serve 子进程 [已注释 - 弃用]
   */
  // private stopOpenclawService(): void {
  //   ... 已注释 ...
  // }

  /**
   * SSE 流式传输通过浏览器服务 [已注释 - 弃用]
   */
  // private async sendViaService(
  //   message: string,
  //   onProgress?: (chunk: string) => void,
  //   newPage?: boolean
  // ): Promise<string> {
  //   ... 已注释 ...
  // }

  /**
   * 浏览器模式发送消息 [已注释 - 弃用]
   */
  // private async sendViaBrowser(
  //   message: string, 
  //   onProgress?: (chunk: string) => void,
  //   newPage?: boolean,
  //   isRetry?: boolean
  // ): Promise<string> {
  //   ... 已注释 ...
  // }

  /**
   * 发送控制请求到浏览器服务 [已注释 - 弃用]
   */
  // private async sendControlRequest<T = any>(path: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  //   ... 已注释 ...
  // }

  /**
   * 创建新会话 [已注释 - 弃用]
   */
  // async newChat(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 刷新当前页面 [已注释 - 弃用]
   */
  // async refreshCurrentPage(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 打开桥接页面 [已注释 - 弃用]
   */
  // async openBridgePage(url?: string): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 暂停桥接 [已注释 - 弃用]
   */
  // async pause(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 恢复桥接 [已注释 - 弃用]
   */
  // async resume(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 获取状态 [已注释 - 弃用]
   */
  // async getState(): Promise<ChatBridgeState> {
  //   ... 已注释 ...
  // }

  /**
   * 刷新页面 [已注释 - 弃用]
   */
  // async refreshPage(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 测试连接 [已注释 - 弃用]
   */
  // async testConnection(): Promise<boolean> {
  //   ... 已注释 ...
  // }

  // ========== 浏览器桥接服务代码注释结束 ==========

  // ========== 浏览器辅助函数 [已注释 - 弃用] ==========
  // 注意：使用单行注释避免正则表达式中的 */ 关闭注释块
  
  // extractCleanResponse - 提取清理响应 [已注释]
  // private extractCleanResponse(stdout: string): string {
  //   const lines = stdout.split('\n').filter(line => line.trim());
  //   let fullContent = '';
  //   let doneContent = '';  // 优先使用 done 事件内容
  //   
  //   for (const line of lines) {
  //     try {
  //       const parsed = JSON.parse(line);
  //       if (parsed.type === 'start') {
  //         if (parsed.content && parsed.content.trim()) {
  //           fullContent = parsed.content;
  //         }
  //       } else if (parsed.type === 'chunk') {
  //         fullContent += parsed.content || '';
  //       } else if (parsed.type === 'done') {
  //         if (parsed.content) {
  //           doneContent = parsed.content;
  //         }
  //       }
  //     } catch (e) {
  //       // 非 JSON 行，忽略
  //     }
  //   }
  //   
  //   // 优先使用 doneContent
  //   const result = (doneContent || fullContent).trim();
  //   
  //   // 清理噪音
  //   const cleaned = result
  //     .replace(/^思考中\.\.\./gm, '')
  //     .replace(/^已思考\s*\d+\s*秒?\n/mg, '')  // 注意：正则中的星号改用 \n 匹配
  //     .replace(/^已思考若干秒\n/mg, '')
  //     .replace(/^大模型\s*说：/gm, '')
  //     .trim();
  //   
  //   return cleaned;
  // }

  // identifyElements - 识别页面元素 [已注释]
  // private async identifyElements(): Promise<void> {
  //   ... 已注释 ...
  // }

  // extractResponse - 提取响应 [已注释]
  // private async extractResponse(): Promise<string> {
  //   ... 已注释 ...
  // }

// runCommand - 安全执行 openclaw 命令 [已注释]
  /**
   * 安全执行 openclaw 命令 [已注释 - 弃用]
   * @param args 命令参数数组（安全，不会触发 shell 解析）
   * @param timeout 超时时间（毫秒）
   * @param onChunk 流式回调
   */
  /*
  private async runCommand(
    args: string[], 
    timeout: number = 60000,
    onChunk?: (chunk: string, type: 'start' | 'chunk' | 'end' | 'error') => void
  ): Promise<{ stdout: string; stderr: string }> {
    // 参数验证：确保所有参数都是字符串
    const safeArgs = args.map(arg => {
      if (typeof arg !== 'string') {
        logger.warn(`[ChatBridge] Non-string argument detected: ${typeof arg}, converting to string`);
        return String(arg);
      }
      return arg;
    });
    
    logger.debug(`[ChatBridge] Executing with args: ${safeArgs.join(' ')}`);
    
    const openclawPath = getOpenclawPath();
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['index.js', ...safeArgs], {
        cwd: openclawPath,
        timeout: timeout,
        shell: false,  // 安全：禁用 shell 解析
      });
      
      let stdout = '';
      let stderr = '';
      let buffer = '';
      let lastOutputTime = Date.now();
      let hasOutput = false;
      let stallCheckTimer: NodeJS.Timeout | null = null;
      let hasRefreshed = false;
      
      // stall 检测：仅在 onChunk 模式下启用，至少 25 秒无有效输出才触发
      const startStallCheck = () => {
        if (stallCheckTimer) clearInterval(stallCheckTimer);
        stallCheckTimer = setInterval(async () => {
          const elapsed = Date.now() - lastOutputTime;
          if (hasOutput && elapsed > 25000 && !hasRefreshed) {
            logger.warn(`[ChatBridge] 检测到输出卡住 ${elapsed}ms，触发刷新`);
            hasRefreshed = true;
            onChunk?.('【系统检测到页面卡住，正在自动刷新...】', 'chunk');
            await this.refreshPage();
            onChunk?.('【页面已刷新，继续等待响应...】', 'chunk');
            hasRefreshed = false;
          }
        }, 5000);
      };
      
      const stopStallCheck = () => {
        if (stallCheckTimer) {
          clearInterval(stallCheckTimer);
          stallCheckTimer = null;
        }
      };
      
      if (onChunk) {
        startStallCheck();
      }
      
      child.stdout?.on('data', (data) => {
        lastOutputTime = Date.now();
        const text = data.toString();
        stdout += text;
        
        if (onChunk) {
          hasOutput = true;
          buffer += text;
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'start') {
                onChunk(parsed.content || '', 'start');
              } else if (parsed.type === 'chunk') {
                onChunk(parsed.content || '', 'chunk');
              } else if (parsed.type === 'end') {
                onChunk('', 'end');
              }
            } catch (e) {
              if (line.trim()) {
                onChunk(line.trim(), 'chunk');
              }
            }
          }
        }
      });
      
      child.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          stderr += data.toString();
          if (line.includes('[Phase:') || line.includes('[STREAM')) {
            logger.info(`[ChatBridge-Debug] ${line}`);
          }
        }
      });
      
      child.on('close', (code) => {
        if (onChunk && buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            if (parsed.type === 'start') {
              onChunk(parsed.content || '', 'start');
            } else if (parsed.type === 'chunk') {
              onChunk(parsed.content || '', 'chunk');
            } else if (parsed.type === 'end') {
              onChunk('', 'end');
            }
          } catch (e) {
            onChunk(buffer.trim(), 'chunk');
          }
        }
        stopStallCheck();
        if (code === 0 || code === null) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
      
      child.on('error', (err) => {
        stopStallCheck();
        if (onChunk) {
          onChunk(err.message, 'error');
        }
        reject(err);
      });
    });
  }
  */

  // sendControlRequest - 发送控制请求到浏览器服务 [已注释]
  /*
  private async sendControlRequest<T = any>(path: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (!this.config) {
      await this.loadConfig();
    }

    await this.ensureServiceRunning();
    const port = this.config?.service?.port || 19222;

    // 根据操作类型设置不同的超时时间
    const timeout = timeoutMs || (path === '/open' ? 60000 : 15000);

    return new Promise<T>((resolve, reject) => {
      const body = payload ? JSON.stringify(payload) : undefined;
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          path,
          method,
          headers: body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : undefined,
          timeout,
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk.toString());
          res.on('end', () => {
            const statusCode = res.statusCode || 500;
            try {
              const parsed = data ? JSON.parse(data) : {};
              if (statusCode >= 200 && statusCode < 300) {
                resolve(parsed as T);
              } else {
                reject(new Error((parsed as { error?: string }).error || `控制请求失败 (${statusCode})`));
              }
            } catch {
              if (statusCode >= 200 && statusCode < 300) {
                resolve({} as T);
              } else {
                reject(new Error(`控制请求失败 (${statusCode})`));
              }
            }
          });
        }
      );

      req.on('error', (error) => reject(new Error(`控制请求失败：${error.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`控制请求超时 (${timeout/1000}秒)`));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
  */

  // newChat - 创建新会话 [已注释]
  /*
  async newChat(): Promise<void> {
    await this.sendControlRequest('/newchat');
    this.paused = false;
    logger.info('[ChatBridge] 已创建新会话页面');
  }
  */

  // refreshCurrentPage - 刷新当前页面 [已注释]
  /*
  async refreshCurrentPage(): Promise<void> {
    await this.sendControlRequest('/refresh');
    logger.info('[ChatBridge] 已通过服务刷新当前页面');
  }
  */

  // openBridgePage - 打开桥接页面 [已注释]
  /*
  async openBridgePage(url?: string): Promise<void> {
    if (!this.config) {
      await this.loadConfig();
    }

    const targetUrl = url?.trim() || this.config?.chat?.chat_url;
    if (!targetUrl || !targetUrl.trim()) {
      throw new Error('未配置 AI 桥接页面 URL，请先在设置中保存有效 URL');
    }

    await this.ensureServiceRunning();
    await this.sendControlRequest('/open', 'POST', { url: targetUrl });
    this.paused = false;
    logger.info(`[ChatBridge] 已打开桥接页面: ${targetUrl}`);
  }
  */

  // pause - 暂停桥接 [已注释]
  /*
  async pause(): Promise<void> {
    this.paused = true;
    await this.sendControlRequest('/pause', 'POST');
    logger.info('[ChatBridge] 已暂停桥接发送');
  }
  */

  // resume - 恢复桥接 [已注释]
  /*
  async resume(): Promise<void> {
    await this.sendControlRequest('/resume', 'POST');
    this.paused = false;
    logger.info('[ChatBridge] 已恢复桥接发送');
  }
  */

  // getState - 获取状态 [已注释]
  /*
  async getState(): Promise<ChatBridgeState> {
    const serviceState = await this.sendControlRequest<{
      paused?: boolean;
      currentUrl?: string | null;
      hasActivePage?: boolean;
    }>('/state');

    return {
      serviceRunning: true,
      paused: serviceState.paused ?? this.paused,
      currentUrl: serviceState.currentUrl ?? null,
      hasActivePage: serviceState.hasActivePage ?? false,
    };
  }
  */

  // refreshPage - 刷新页面 [已注释]
  /*
  async refreshPage(): Promise<void> {
    try {
      await this.refreshCurrentPage();
    } catch (error) {
      logger.warn(`[ChatBridge] 服务刷新失败，回退到浏览器打开：${(error as Error).message}`);
      if (!this.config) {
        await this.loadConfig();
      }
      
      const chatUrl = this.config!.chat.chat_url;
      const profile = this.config!.browser.profile;
      
      try {
        await this.runCommand(
          ['browser', '--action', 'open', '--url', chatUrl, '--profile', profile, '--keep-alive'],
          15000
        );
        logger.info('[ChatBridge] 页面刷新成功');
      } catch (fallbackError) {
        logger.error(`[ChatBridge] 页面刷新失败：${(fallbackError as Error).message}`);
      }
    }
  }
  */

  // sleep - 等待函数 [已注释]
  /*
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  */

  // testConnection - 测试连接 [已注释]
  /*
  async testConnection(): Promise<boolean> {
    try {
      if (this.paused) {
        throw new Error('ChatBridge 当前已暂停，请先恢复后再发送消息。');
      }

      if (!this.config) {
        await this.loadConfig();
      }

      const chatUrl = this.config!.chat.chat_url;
      
      if (!chatUrl || chatUrl.trim() === '') {
        logger.error('[ChatBridge] 连接测试失败：未配置聊天 URL');
        return false;
      }

      logger.info(`[ChatBridge] 测试连接... URL: ${chatUrl}`);
      
      await this.runCommand(
        ['browser', '--action', 'open', '--url', chatUrl, '--profile', this.config!.browser.profile, '--keep-alive'],
        15000
      );

      logger.info('[ChatBridge] 连接测试成功');
      return true;
    } catch (error) {
      logger.error(`[ChatBridge] 连接测试失败：${(error as Error).message}`);
      return false;
    }
  }
  */

  // ========== 浏览器桥接辅助函数注释结束 ==========
}

export const chatBridge = new ChatBridgeAdapter();
