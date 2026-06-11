import { chatBridge } from './chat-bridge/chat-bridge';
import type { ChatOptions } from '../types';
import { logger } from '../utils/logger';
import { callChatCompletion } from '../utils/llm-client';

export type AIProvider = 'openai' | 'chat-bridge' | 'auto';

export interface AIProviderConfig {
  provider: AIProvider;
  openai?: {
    apiKey: string;
    baseUrl: string;
  };
  chatBridge?: {
    enabled: boolean;
    configPath?: string;
  };
}

export class AIProviderFactory {
  private static config: AIProviderConfig | null = null;
  private static initialized = false;

  static initialize(config: AIProviderConfig): void {
    // 验证配置
    if (!config.provider) {
      throw new Error('[AIProviderFactory] Provider must be specified');
    }

    // 验证 OpenAI 配置
    if (config.provider === 'openai' || config.provider === 'auto') {
      if (config.openai && (!config.openai.apiKey || !config.openai.baseUrl)) {
        logger.warn('[AIProviderFactory] OpenAI provider selected but apiKey or baseUrl is missing');
      }
    }

    this.config = config;
    this.initialized = true;

    // 不再创建新实例，使用模块导出的单例 chatBridge
    // 如果配置了 configPath，可以在这里加载配置
    if (config.provider === 'chat-bridge' || config.provider === 'auto') {
      if (config.chatBridge?.enabled && config.chatBridge.configPath) {
        // 单例已存在，如果需要特定配置路径，可以调用 loadConfig
        chatBridge.loadConfig().catch(err => {
          logger.error('[AIProviderFactory] Failed to load chatBridge config:', err);
        });
      }
    }

    logger.info(`[AIProviderFactory] Initialized with provider: ${config.provider}`);
  }

  static isInitialized(): boolean {
    return this.initialized;
  }

  static async chat(options: ChatOptions): Promise<string> {
    if (!this.config || !this.initialized) {
      throw new Error('[AIProviderFactory] Not initialized. Call initialize() first.');
    }

    const provider = this.config.provider;

    // OpenAI 模式：直接调用 OpenAI 兼容 API
    if (provider === 'openai') {
      if (!this.config.openai?.apiKey || !this.config.openai?.baseUrl) {
        throw new Error('[AIProviderFactory] OpenAI provider selected but apiKey or baseUrl is missing');
      }

      const { apiKey, baseUrl } = this.config.openai;

      try {
        return await callChatCompletion(
          { apiUrl: baseUrl, apiKey, label: 'OpenAI', defaultModel: 'gpt-4o' },
          {
            model: options.model,
            messages: options.messages,
            temperature: options.temperature,
            maxTokens: options.maxTokens,
          }
        );
      } catch (error) {
        logger.error('[AIProviderFactory] OpenAI call failed:', error);
        throw error;
      }
    }

    // ChatBridge 模式：通过浏览器桥接调用（使用单例）
    if (provider === 'chat-bridge') {
      return await chatBridge.chat(options);
    }

    // Auto 模式：智能选择，失败时降级
    if (provider === 'auto') {
      // 优先尝试 OpenAI API（如果配置了）
      if (this.config.openai?.apiKey && this.config.openai?.baseUrl) {
        try {
          const { apiKey, baseUrl } = this.config.openai;
          const content = await callChatCompletion(
            { apiUrl: baseUrl, apiKey, label: 'OpenAI', defaultModel: 'gpt-4o' },
            {
              model: options.model,
              messages: options.messages,
              temperature: options.temperature,
              maxTokens: options.maxTokens,
            }
          );
          logger.info('[AIProviderFactory] Auto mode: succeeded with OpenAI API');
          return content;
        } catch (error) {
          logger.warn('[AIProviderFactory] Auto mode: OpenAI API failed, falling back to ChatBridge:', error);
        }
      } else {
        logger.info('[AIProviderFactory] Auto mode: OpenAI not configured, using ChatBridge');
      }

      // 降级到 ChatBridge（使用单例）
      try {
        logger.info('[AIProviderFactory] Auto mode: using ChatBridge');
        return await chatBridge.chat(options);
      } catch (error) {
        logger.error('[AIProviderFactory] Auto mode: ChatBridge also failed:', error);
      }

      throw new Error('[AIProviderFactory] All AI providers failed in auto mode');
    }

    throw new Error(`[AIProviderFactory] Provider ${provider} not supported`);
  }

  // 返回单例 chatBridge（保持向后兼容的接口）
  static getChatBridgeAdapter(): typeof chatBridge {
    return chatBridge;
  }
}
