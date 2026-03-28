const Lark = require('@larksuiteoapi/node-sdk');
import type { WSClient as WSClientType, EventDispatcher as EventDispatcherType } from '@larksuiteoapi/node-sdk';

const WSClient = Lark.WSClient;
const EventDispatcher = Lark.EventDispatcher;
import { logger } from '../utils/logger';
import type { MessageHandler } from '../types';

export interface FeishuWebSocketConfig {
  appId: string;
  appSecret: string;
  verificationToken?: string;
  encryptKey?: string;
}

export interface FeishuUserIdentifier {
  userId: string;
  userIdType: 'open_id' | 'user_id' | 'union_id';
}

const DEDUP_TTL_MS = 10 * 60 * 1000;

const globalProcessedEventIds: Map<string, number> = new Map();
const globalProcessedMessageIds: Map<string, number> = new Map();
const globalReplyLocks: Map<string, boolean> = new Map();
let globalConnectionGeneration = 0;
let cleanupInterval: NodeJS.Timeout | null = null;

function startGlobalCleanup(): void {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [id, timestamp] of globalProcessedEventIds) {
      if (now - timestamp > DEDUP_TTL_MS) {
        globalProcessedEventIds.delete(id);
        cleaned++;
      }
    }
    
    for (const [id, timestamp] of globalProcessedMessageIds) {
      if (now - timestamp > DEDUP_TTL_MS) {
        globalProcessedMessageIds.delete(id);
        cleaned++;
      }
    }
    
    for (const [id, _] of globalReplyLocks) {
      globalReplyLocks.delete(id);
    }
    
    if (cleaned > 0) {
      logger.info(`[FeishuWS] Global cleanup: removed ${cleaned} expired entries`);
    }
  }, DEDUP_TTL_MS);
}

function stopGlobalCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('[FeishuWS] Cleanup interval stopped');
  }
}

function isGlobalDuplicate(eventId?: string, messageId?: string): boolean {
  const now = Date.now();
  
  if (eventId) {
    if (globalProcessedEventIds.has(eventId)) {
      return true;
    }
    globalProcessedEventIds.set(eventId, now);
  }
  
  if (messageId) {
    if (globalProcessedMessageIds.has(messageId)) {
      return true;
    }
    globalProcessedMessageIds.set(messageId, now);
  }
  
  return false;
}

function acquireReplyLock(key: string): boolean {
  if (globalReplyLocks.has(key)) {
    return false;
  }
  globalReplyLocks.set(key, true);
  return true;
}

function getStats(): { eventCount: number; messageCount: number; generation: number } {
  return {
    eventCount: globalProcessedEventIds.size,
    messageCount: globalProcessedMessageIds.size,
    generation: globalConnectionGeneration
  };
}

export class FeishuWebSocketClient {
  private wsClient: WSClientType;
  private messageHandler: MessageHandler;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private myGeneration: number = 0;

  constructor(config: FeishuWebSocketConfig, messageHandler: MessageHandler) {
    if (!config.appId || !config.appSecret) {
      throw new Error('Feishu WebSocket: appId and appSecret are required');
    }

    this.messageHandler = messageHandler;

    this.wsClient = new WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      loggerLevel: 3,
    });
    
    startGlobalCleanup();
  }

  async start(): Promise<void> {
    globalConnectionGeneration++;
    this.myGeneration = globalConnectionGeneration;
    
    logger.info(`[FeishuWS] Starting WebSocket (generation: ${this.myGeneration})`);
    logger.info(`[FeishuWS] Current dedup stats: ${JSON.stringify(getStats())}`);

    const myGen = this.myGeneration;

    const eventDispatcher = new EventDispatcher({
      verificationToken: '',
      encryptKey: '',
    });

    eventDispatcher.register({
      'im.message.receive_v1': async (data: any) => {
        const currentGen = globalConnectionGeneration;
        if (myGen !== currentGen) {
          const eventId = data.header?.event_id || 'unknown';
          logger.debug(`[FeishuWS] Dropping message from old generation ${myGen} (current: ${currentGen}), event_id: ${eventId}`);
          return;
        }
        await this.handleMessageEvent(data, myGen);
      },
      'im.chat.access_event.bot_p2p_chat_entered_v1': async (data: any) => {
        if (myGen !== globalConnectionGeneration) {
          return;
        }
        logger.info('[FeishuWS] User entered chat');
      },
    });

    this.wsClient.start({ eventDispatcher });

    this.isConnected = true;
    this.reconnectAttempts = 0;
    logger.info(`[FeishuWS] ✓ WebSocket started (generation: ${this.myGeneration})`);
  }

  private async handleMessageEvent(data: any, generation: number): Promise<void> {
    const eventId = data.header?.event_id;
    const messageData = data.message || data.event?.message;
    const messageId = messageData?.message_id;
    
    const timestamp = Date.now();
    const callId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    
    logger.info(`[FeishuWS] ========== Message Event [${callId}] ==========`);
    logger.info(`[FeishuWS] Full data: ${JSON.stringify(data).substring(0, 500)}`);
    logger.info(`[FeishuWS] Generation: ${generation}, Current global: ${globalConnectionGeneration}`);
    logger.info(`[FeishuWS] event_id from header: "${eventId}"`);
    logger.info(`[FeishuWS] message_id: "${messageId}"`);
    logger.info(`[FeishuWS] Global cache before: events=${globalProcessedEventIds.size}, msgs=${globalProcessedMessageIds.size}`);
    
    if (!eventId && !messageId) {
      logger.error(`[FeishuWS] ⚠️ NO IDENTIFIER FOUND! Cannot dedup!`);
      logger.error(`[FeishuWS] header: ${JSON.stringify(data.header)}`);
      logger.error(`[FeishuWS] event: ${JSON.stringify(data.event).substring(0, 300)}`);
      logger.error(`[FeishuWS] ⚠️ REJECTING message without identifier to prevent duplicate sends`);
      return;  // 【修复】没有标识符时直接拒绝处理，防止重复发送
    }
    
    // 【修复】在处理开始时就获取锁，而不是等到发送回复时
    const processingLockKey = `proc-${eventId || messageId}`;
    if (!acquireReplyLock(processingLockKey)) {
      logger.warn(`[FeishuWS] ⚠️ Message already being processed (lock: ${processingLockKey}), skipping`);
      return;
    }
    
    if (isGlobalDuplicate(eventId, messageId)) {
      logger.warn(`[FeishuWS] ⚠️ DUPLICATE DETECTED [${callId}] - Skipping (event: ${eventId}, msg: ${messageId})`);
      logger.info(`[FeishuWS] Stats after dedup: ${JSON.stringify(getStats())}`);
      return;
    }
    
    logger.info(`[FeishuWS] Global cache after: events=${globalProcessedEventIds.size}, msgs=${globalProcessedMessageIds.size}`);
    
    logger.info(`[FeishuWS] ✓ New message, processing...`);

    try {
      const senderData = data.sender || data.event?.sender;

      if (!messageData) {
        logger.warn('[FeishuWS] No message in event data');
        return;
      }

      const msgType = messageData.message_type || messageData.msg_type;
      if (msgType !== 'text') {
        logger.info(`[FeishuWS] Ignoring non-text message: ${msgType}`);
        return;
      }

      let contentStr: string;
      if (typeof messageData.content === 'string') {
        contentStr = messageData.content;
      } else if (messageData.content?.text) {
        contentStr = JSON.stringify(messageData.content);
      } else if (messageData.body?.content) {
        contentStr = messageData.body.content;
      } else {
        logger.warn('[FeishuWS] Cannot find message content');
        return;
      }

      let content: { text?: string };
      try {
        content = JSON.parse(contentStr);
      } catch (e) {
        logger.warn('[FeishuWS] Failed to parse message content');
        return;
      }

      const text = content.text || '';
      
      const senderId = senderData?.sender_id || {};
      const userIdType: 'open_id' | 'user_id' | 'union_id' = 
        senderId.union_id ? 'union_id' :
        senderId.open_id ? 'open_id' :
        senderId.user_id ? 'user_id' : 'open_id';
      
      const userId = senderId[userIdType] || senderId.union_id || senderId.open_id || senderId.user_id;

      if (!userId) {
        logger.warn('[FeishuWS] No user ID in message');
        return;
      }

      logger.info(`[FeishuWS] ✓ Parsed: user=${userId}, type=${userIdType}, text="${text.slice(0, 30)}..."`);

      const messageHandler = this.messageHandler as any;
      
      if (typeof messageHandler.handle === 'function') {
        logger.info(`[FeishuWS] → Calling handle()...`);
        try {
          const response = await messageHandler.handle(userId, text);
          logger.info(`[FeishuWS] ← handle() returned, response length: ${response?.length || 0}`);
          
          if (globalConnectionGeneration !== generation) {
            logger.warn(`[FeishuWS] ⚠️ Generation changed during processing (${generation} → ${globalConnectionGeneration}), skipping reply`);
            return;
          }
          
          if (response && response.trim()) {
            logger.info(`[FeishuWS] → Sending reply (${response.length} chars)...`);
            try {
              if (typeof messageHandler.sendWithIdType === 'function') {
                await messageHandler.sendWithIdType(userId, userIdType, response);
              } else {
                await messageHandler.send(userId, response);
              }
              logger.info(`[FeishuWS] ✓ Reply sent to ${userId}`);
            } catch (sendError) {
              logger.error('[FeishuWS] Failed to send reply:', sendError);
            }
          } else {
            logger.warn('[FeishuWS] Empty response, not sending');
          }
        } catch (handleError) {
          logger.error('[FeishuWS] Error calling handle():', handleError);
          // 尝试发送错误消息给用户
          try {
            if (typeof messageHandler.sendWithIdType === 'function') {
              await messageHandler.sendWithIdType(userId, userIdType, '抱歉，处理消息时出现错误，请稍后再试。');
            }
          } catch (e) {
            logger.error('[FeishuWS] Failed to send error message:', e);
          }
        }
      } else {
        logger.error('[FeishuWS] MessageHandler has no handle() method');
      }

    } catch (error) {
      logger.error('[FeishuWS] Error in handleMessageEvent:', error);
    }
  }

  isConnectionAlive(): boolean {
    return this.isConnected;
  }
  
  getGeneration(): number {
    return this.myGeneration;
  }

  async stop(): Promise<void> {
    const oldGen = this.myGeneration;
    logger.info(`[FeishuWS] Stopping (generation: ${oldGen})...`);
    
    this.isConnected = false;
    globalConnectionGeneration++;
    stopGlobalCleanup();
    
    const client = this.wsClient as any;
    if (client) {
      try {
        if (typeof client.stop === 'function') {
          await client.stop();
          logger.info('[FeishuWS] WebSocket client stopped');
        } else if (typeof client.close === 'function') {
          client.close();
          logger.info('[FeishuWS] WebSocket client closed');
        }
      } catch (e) {
        logger.warn('[FeishuWS] Error stopping WebSocket client:', e);
      }
      
      try {
        if (typeof client.disconnect === 'function') {
          await client.disconnect();
          logger.info('[FeishuWS] WebSocket client disconnected');
        }
      } catch (e) {
        logger.debug('[FeishuWS] No disconnect method or error:', e);
      }
      
      try {
        if (client.ws && typeof client.ws.terminate === 'function') {
          client.ws.terminate();
          logger.info('[FeishuWS] Underlying socket terminated');
        }
      } catch (e) {
        logger.debug('[FeishuWS] No terminate method or error:', e);
      }
    }
    
    logger.info(`[FeishuWS] ✓ Stopped (old gen ${oldGen} invalidated, new gen: ${globalConnectionGeneration})`);
    logger.info(`[FeishuWS] Dedup stats: ${JSON.stringify(getStats())}`);
  }

  getClient(): WSClientType {
    return this.wsClient;
  }
}

export default FeishuWebSocketClient;