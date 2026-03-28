import type { MessageHandler } from '../types';

export class TelegramHandler implements MessageHandler {
  private botToken: string;
  private chatId?: string;

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async send(userId: string, message: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
  }

  async sendMarkdown(userId: string, markdown: string): Promise<void> {
    await this.send(userId, markdown);
  }

  async sendImage(userId: string, imageUrl: string, caption?: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.botToken}/sendPhoto`;
    
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: userId,
        photo: imageUrl,
        caption,
        parse_mode: 'Markdown',
      }),
    });
  }

  async handleWebhook(update: TelegramUpdate): Promise<{userId: string; text: string; firstName?: string; lastName?: string} | null> {
    const message = update.message;
    if (!message || !message.text) {
      return null;
    }

    return {
      userId: String(message.chat.id),
      text: message.text,
      firstName: message.from?.first_name,
      lastName: message.from?.last_name,
    };
  }
}

export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: {
      first_name?: string;
      last_name?: string;
    };
  };
}

export default TelegramHandler;
