import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConversationFlow } from '../../workflows/conversation-flow';
import { SessionStore } from '../../src/storage/session-store';

describe('ConversationFlow', () => {
  let flow: ConversationFlow;
  let mockSessionStore: SessionStore;
  const mockHandler = {
    send: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    mockSessionStore = {
      save: vi.fn().mockResolvedValue(undefined),
      load: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue([]),
      cleanExpired: vi.fn().mockResolvedValue(0),
    } as unknown as SessionStore;
    
    flow = new ConversationFlow(mockHandler as any, mockSessionStore, {
      apiUrl: 'https://test.api.com',
      apiKey: 'test-key',
      maxConcurrency: 3,
    });
  });

  it('should create conversation flow', () => {
    expect(flow).toBeDefined();
  });

  it('should handle greeting phase', async () => {
    const response = await flow.processMessage('user123', '你好');
    expect(response).toContain('学术论文写作助手');
  });

  it('should transition from greeting to topic', async () => {
    await flow.processMessage('user123', '你好');
    const session = await flow.getSession('user123');
    expect(session.phase).toBe('topic');
  });

  it('should handle topic phase', async () => {
    await flow.processMessage('user123', '你好');
    const response = await flow.processMessage(
      'user123',
      '土壤微生物对气候变化的影响'
    );
    expect(response).toContain('很好');
  });

  it('should handle journal phase', async () => {
    await flow.processMessage('user123', '你好');
    await flow.processMessage('user123', '土壤微生物');
    const response = await flow.processMessage('user123', 'Global Change Biology');
    expect(response).toContain('收到');
  });

  it('should handle upload phase', async () => {
    await flow.processMessage('user123', '你好');
    await flow.processMessage('user123', '土壤微生物');
    await flow.processMessage('user123', 'GCB');
    const response = await flow.processMessage(
      'user123',
      '我的研究是关于...'
    );
    expect(response).toContain('规划');
  });

  it('should save and load progress', async () => {
    await flow.processMessage('user123', '你好');
    await flow.saveProgress('user123');
    expect(mockSessionStore.save).toHaveBeenCalled();
    
    const loadedSession = await flow.loadProgress('user123');
    expect(loadedSession).toBeNull();
  });
});