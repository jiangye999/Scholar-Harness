import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isTransientError,
  chatWithFailover,
  chatWithToolsFailover,
} from '../../src/bridge/chat-bridge/model-failover';
import { modelHealthStore } from '../../src/bridge/chat-bridge/model-health-store';
import type { ResolvedModel } from '../../src/bridge/chat-bridge/model-pool';

// mock callChatCompletion 以隔离 HTTP
vi.mock('../../src/utils/llm-client', () => ({
  callChatCompletion: vi.fn(),
  callChatCompletionWithTools: vi.fn(),
}));
const { callChatCompletion, callChatCompletionWithTools } = await import('../../src/utils/llm-client');
const mockedCall = vi.mocked(callChatCompletion);
const mockedToolCall = vi.mocked(callChatCompletionWithTools);

// mock logger 以隔离测试日志
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeEntry(id: string, model: string = `m-${id}`): ResolvedModel {
  return {
    id,
    model,
    api_url: `https://example.com/${id}`,
    api_key: `key-${id}`,
    source: 'active',
  };
}

describe('model-failover: isTransientError', () => {
  it('5xx is transient', () => {
    expect(isTransientError(new Error('ChatBridge API error: 503 - Service Unavailable'))).toBe(true);
    expect(isTransientError(new Error('API error: 502 - Bad Gateway'))).toBe(true);
  });

  it('429 rate limit is transient', () => {
    expect(isTransientError(new Error('API error: 429 - Too Many Requests'))).toBe(true);
    expect(isTransientError(new Error('rate limit exceeded'))).toBe(true);
  });

  it('network errors are transient', () => {
    expect(isTransientError(new Error('fetch failed: ECONNRESET'))).toBe(true);
    expect(isTransientError(new Error('Request timeout'))).toBe(true);
    expect(isTransientError(new Error('ETIMEDOUT'))).toBe(true);
    expect(isTransientError(new Error('socket hang up'))).toBe(true);
  });

  it('401/403 auth errors are NOT transient', () => {
    expect(isTransientError(new Error('API error: 401 - Unauthorized'))).toBe(false);
    expect(isTransientError(new Error('API error: 403 - Forbidden'))).toBe(false);
    expect(isTransientError(new Error('Invalid API key'))).toBe(false);
  });

  it('400/404 client errors are NOT transient', () => {
    expect(isTransientError(new Error('API error: 400 - Bad Request'))).toBe(false);
    expect(isTransientError(new Error('API error: 404 - Not Found'))).toBe(false);
  });

  it('402 insufficient balance is NOT transient', () => {
    expect(isTransientError(new Error('API error: 402 - insufficient balance'))).toBe(false);
    expect(isTransientError(new Error('余额不足'))).toBe(false);
  });

  it('empty response is transient', () => {
    expect(isTransientError(new Error('API returned empty response after retry'))).toBe(true);
  });

  it('unknown errors are NOT transient (conservative default)', () => {
    expect(isTransientError(new Error('something weird happened'))).toBe(false);
  });
});

describe('model-failover: chatWithFailover', () => {
  beforeEach(() => {
    mockedCall.mockReset();
    modelHealthStore.clear();
  });

  it('returns content on first success (no switches)', async () => {
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedCall.mockResolvedValueOnce('hello from a');

    const result = await chatWithFailover('primary', queue, {
      model: 'm-a',
      messages: [],
    });

    expect(result.content).toBe('hello from a');
    expect(result.usedModel.id).toBe('a');
    expect(result.switches).toHaveLength(0);
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it('switches to next model on transient 5xx error', async () => {
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedCall
      .mockRejectedValueOnce(new Error('API error: 503 - Service Unavailable'))
      .mockResolvedValueOnce('hello from b');

    const onSwitch = vi.fn();
    const result = await chatWithFailover('primary', queue, {
      model: 'm-a',
      messages: [],
    }, { onSwitch });

    expect(result.content).toBe('hello from b');
    expect(result.usedModel.id).toBe('b');
    expect(result.switches).toHaveLength(1);
    expect(result.switches[0]).toMatchObject({ from: 'a', to: 'b' });
    expect(onSwitch).toHaveBeenCalledTimes(1);
    expect(onSwitch.mock.calls[0][1].id).toBe('b');
    expect(mockedCall.mock.calls[0][1].model).toBe('m-a');
    expect(mockedCall.mock.calls[1][1].model).toBe('m-b');
  });

  it('throws immediately on non-transient 401 error (no retry)', async () => {
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedCall.mockRejectedValueOnce(new Error('API error: 401 - Unauthorized'));

    await expect(chatWithFailover('primary', queue, {
      model: 'm-a',
      messages: [],
    })).rejects.toThrow(/401/);

    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it('throws aggregate error when all models fail with transient errors', async () => {
    const queue = [makeEntry('a'), makeEntry('b'), makeEntry('c')];
    mockedCall
      .mockRejectedValueOnce(new Error('API error: 503'))
      .mockRejectedValueOnce(new Error('API error: 429'))
      .mockRejectedValueOnce(new Error('ETIMEDOUT'));

    await expect(chatWithFailover('primary', queue, {
      model: 'm-a',
      messages: [],
    })).rejects.toThrow(/所有模型均失败/);

    expect(mockedCall).toHaveBeenCalledTimes(3);
  });

  it('marks model healthy on success', async () => {
    const queue = [makeEntry('a')];
    mockedCall.mockResolvedValueOnce('ok');

    await chatWithFailover('primary', queue, { model: 'm-a', messages: [] });

    const health = modelHealthStore.getProviderHealth('primary');
    expect(health).toHaveLength(1);
    expect(health[0].status).toBe('healthy');
    expect(health[0].lastSuccessAt).toBeDefined();
  });

  it('marks model unhealthy on transient failure', async () => {
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedCall
      .mockRejectedValueOnce(new Error('API error: 503'))
      .mockResolvedValueOnce('ok');

    await chatWithFailover('primary', queue, { model: 'm-a', messages: [] });

    const health = modelHealthStore.getProviderHealth('primary');
    const aHealth = health.find(h => h.id === 'a');
    expect(aHealth?.status).toBe('unhealthy');
    expect(aHealth?.unhealthyUntil).toBeDefined();
    expect(aHealth?.consecutiveFailures).toBe(1);
    const bHealth = health.find(h => h.id === 'b');
    expect(bHealth?.status).toBe('healthy');
  });

  it('skips models that are cooling down', async () => {
    // 预先标记 a 为不健康且冷却中
    modelHealthStore.markUnhealthy('primary', 'a', 'previous 503', 60_000);
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedCall.mockResolvedValueOnce('hello from b');

    const result = await chatWithFailover('primary', queue, {
      model: 'm-a',
      messages: [],
    });

    // 应该跳过 a 直接用 b
    expect(result.usedModel.id).toBe('b');
    expect(mockedCall).toHaveBeenCalledTimes(1);
  });

  it('throws when queue is empty', async () => {
    await expect(chatWithFailover('primary', [], {
      model: 'x',
      messages: [],
    })).rejects.toThrow(/模型池为空/);
  });

  it('forces retry of first entry when all are cooling down', async () => {
    // 标记所有 entry 为冷却中
    modelHealthStore.markUnhealthy('primary', 'a', 'err', 60_000);
    modelHealthStore.markUnhealthy('primary', 'b', 'err', 60_000);
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedCall.mockResolvedValueOnce('recovered');

    const result = await chatWithFailover('primary', queue, {
      model: 'm-a',
      messages: [],
    });

    // 强制重试第一个 (a) 成功
    expect(result.usedModel.id).toBe('a');
    expect(result.content).toBe('recovered');
  });
});

describe('model-failover: chatWithToolsFailover', () => {
  beforeEach(() => {
    mockedToolCall.mockReset();
    modelHealthStore.clear();
  });

  it('switches tool_calls requests to the next model on transient failure', async () => {
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedToolCall
      .mockRejectedValueOnce(new Error('API error: 503 - Service Unavailable'))
      .mockResolvedValueOnce({ content: '', toolCalls: [], finishReason: 'stop' });

    const result = await chatWithToolsFailover('secondary', queue, {
      model: 'stale-model',
      messages: [],
      tools: [],
      toolChoice: 'auto',
    });

    expect(result.usedModel.id).toBe('b');
    expect(result.switches).toEqual([
      expect.objectContaining({ from: 'a', to: 'b' }),
    ]);
    expect(mockedToolCall.mock.calls[0][1].model).toBe('m-a');
    expect(mockedToolCall.mock.calls[1][1].model).toBe('m-b');
  });

  it('does not switch tool_calls requests on authentication errors', async () => {
    const queue = [makeEntry('a'), makeEntry('b')];
    mockedToolCall.mockRejectedValueOnce(new Error('API error: 401 - Unauthorized'));

    await expect(chatWithToolsFailover('secondary', queue, {
      messages: [],
      tools: [],
    })).rejects.toThrow(/401/);
    expect(mockedToolCall).toHaveBeenCalledTimes(1);
  });
});
