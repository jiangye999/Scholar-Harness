import type { MessageHandler } from '../types';
import { ConversationFlow } from '../../workflows/conversation-flow';
import { logger } from '../utils/logger';

export type ChatProcessor = (userId: string, message: string) => Promise<string>;

export interface FeishuConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
}

export interface FeishuMessage {
  msg_type: 'text' | 'image' | 'interactive' | 'post';
  content: {
    text?: string;
    image_key?: string;
    post?: object;
    interactive?: object;
  };
}

export interface FeishuEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender?: {
      sender_id: {
        type: string;
        user_id?: string;
        open_id?: string;
        union_id?: string;
      };
      sender_type: string;
    };
    message?: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      msg_type: string;
      create_time: string;
      chat_id?: string;
      body: {
        content: string;
      };
    };
  };
}

export class FeishuHandler implements MessageHandler {
  private appId: string;
  private appSecret: string;
  private tenantAccessToken?: string;
  private tokenExpireTime?: number;
  private conversationFlow?: ConversationFlow;
  private chatProcessor?: ChatProcessor;

  constructor(config: FeishuConfig, conversationFlow?: ConversationFlow, chatProcessor?: ChatProcessor) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.conversationFlow = conversationFlow;
    this.chatProcessor = chatProcessor;
  }

  setConversationFlow(conversationFlow: ConversationFlow): void {
    this.conversationFlow = conversationFlow;
  }

  setChatProcessor(chatProcessor: ChatProcessor): void {
    this.chatProcessor = chatProcessor;
  }

  private async getTenantAccessToken(): Promise<string> {
    if (this.tenantAccessToken && this.tokenExpireTime && Date.now() < this.tokenExpireTime) {
      return this.tenantAccessToken;
    }

    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    const data = await response.json() as { tenant_access_token?: string; expire?: number };
    
    if (!data.tenant_access_token) {
      throw new Error('Failed to get Feishu tenant access token');
    }

    this.tenantAccessToken = data.tenant_access_token;
    this.tokenExpireTime = Date.now() + (data.expire || 7200) * 1000 - 60000;

    return this.tenantAccessToken!;
  }

  async send(userId: string, message: string): Promise<void> {
    // 默认使用 open_id，为了兼容性
    await this.sendWithIdType(userId, 'open_id', message);
  }

  async sendWithIdType(userId: string, idType: 'open_id' | 'user_id' | 'union_id', message: string): Promise<void> {
    const token = await this.getTenantAccessToken();

    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: userId,
        msg_type: 'text',
        content: JSON.stringify({ text: message }),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('[Feishu] Send message failed:', error);
      throw new Error(`Feishu send failed: ${error}`);
    }
    
    logger.info(`[Feishu] Message sent to ${userId} (${idType})`);
  }

  async sendRichText(userId: string, title: string, content: string): Promise<void> {
    // 默认使用 open_id，为了兼容性
    await this.sendRichTextWithIdType(userId, 'open_id', title, content);
  }

  async sendRichTextWithIdType(userId: string, idType: 'open_id' | 'user_id' | 'union_id', title: string, content: string): Promise<void> {
    const token = await this.getTenantAccessToken();

    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`;

    const richContent = {
      title,
      content: [
        [
          {
            tag: 'text',
            text: content,
          },
        ],
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: userId,
        msg_type: 'post',
        content: JSON.stringify(richContent),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('[Feishu] Rich text send failed:', error);
      throw new Error(`Feishu rich text failed: ${error}`);
    }
    
    logger.info(`[Feishu] Rich text sent to ${userId} (${idType})`);
  }

  async sendInteractiveCard(userId: string, message: string, actions: Array<{ tag: string; text?: string; url?: string; value?: object }>): Promise<void> {
    // 默认使用 open_id，为了兼容性
    await this.sendInteractiveCardWithIdType(userId, 'open_id', message, actions);
  }

  async sendInteractiveCardWithIdType(userId: string, idType: 'open_id' | 'user_id' | 'union_id', message: string, actions: Array<{ tag: string; text?: string; url?: string; value?: object }>): Promise<void> {
    const token = await this.getTenantAccessToken();

    const url = `https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=${idType}`;

    const card = {
      config: {
        wide_screen_mode: true,
      },
      elements: [
        {
          tag: 'markdown',
          content: message,
        },
        {
          tag: 'action',
          actions: actions.map(action => ({
            tag: 'button',
            text: action.text ? { tag: 'plain_text', content: action.text } : undefined,
            url: action.url,
            type: 'primary',
          })),
        },
      ],
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: userId,
        msg_type: 'interactive',
        content: JSON.stringify(card),
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('[Feishu] Interactive card send failed:', error);
      throw new Error(`Feishu card failed: ${error}`);
    }
    
    logger.info(`[Feishu] Interactive card sent to ${userId} (${idType})`);
  }

  parseWebhookEvent(body: FeishuEvent): { userId: string; message: string } | null {
    const event = body.event;
    
    if (!event?.message) {
      return null;
    }

    const messageType = event.message.msg_type;
    
    if (messageType === 'text') {
      const content = JSON.parse(event.message.body.content);
      const senderId = event.sender?.sender_id;

      // 优先使用 union_id（跨应用唯一），其次 open_id，最后 user_id
      const userId = senderId?.union_id || senderId?.open_id || senderId?.user_id || '';

      return {
        userId,
        message: content.text || '',
      };
    }

    return null;
  }

  verifyURLParams(params: { signature: string; timestamp: string; nonce: string }): boolean {
    return true;
  }

  async handle(userId: string, message: string): Promise<string | void> {
    // 优先使用 chatProcessor（Web UI 的聊天逻辑）
    if (this.chatProcessor) {
      logger.info(`[FeishuHandler] Using chatProcessor for ${userId}`);
      try {
        const response = await this.chatProcessor(userId, message);
        return response;
      } catch (error) {
        logger.error('[FeishuHandler] ChatProcessor error:', error);
        return '抱歉，处理您的消息时出现错误。请稍后再试。';
      }
    }

    // 降级到 ConversationFlow
    if (!this.conversationFlow) {
      logger.warn('[FeishuHandler] No chatProcessor or conversationFlow configured');
      return '系统配置不完整，请检查后端设置。';
    }

    try {
      const response = await this.conversationFlow.processMessage(userId, message);
      await this.conversationFlow.saveProgress(userId);
      return response;
    } catch (error) {
      logger.error('[FeishuHandler] Error handling message:', error);
      return '抱歉，处理您的消息时出现错误。请稍后再试。';
    }
  }
}

export default FeishuHandler;
