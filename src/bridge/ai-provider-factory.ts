import { NiceAIGCBridgeAdapter } from './niceaigc/niceaigc-bridge';
import type { ChatOptions } from '../types';

export type AIProvider = 'openai' | 'niceaigc' | 'auto';

export interface AIProviderConfig {
  provider: AIProvider;
  openai?: {
    apiKey: string;
    baseUrl: string;
  };
  niceaigc?: {
    enabled: boolean;
    configPath?: string;
  };
}

export class AIProviderFactory {
  private static niceAIGCAdapter: NiceAIGCBridgeAdapter | null = null;
  private static config: AIProviderConfig | null = null;

  static initialize(config: AIProviderConfig): void {
    this.config = config;

    if (config.provider === 'niceaigc' || config.provider === 'auto') {
      if (config.niceaigc?.enabled) {
        this.niceAIGCAdapter = new NiceAIGCBridgeAdapter(config.niceaigc.configPath);
      }
    }
  }

  static async chat(options: ChatOptions): Promise<string> {
    if (!this.config) {
      throw new Error('AIProviderFactory not initialized');
    }

    const provider = this.config.provider;

    if (provider === 'niceaigc' && this.niceAIGCAdapter) {
      return await this.niceAIGCAdapter.chat(options);
    }

    if (provider === 'auto') {
      if (this.niceAIGCAdapter) {
        try {
          return await this.niceAIGCAdapter.chat(options);
        } catch {
          throw new Error('All AI providers failed');
        }
      }
    }

    throw new Error(`Provider ${provider} not supported or not initialized`);
  }

  static getNiceAIGCAdapter(): NiceAIGCBridgeAdapter | null {
    return this.niceAIGCAdapter;
  }
}
