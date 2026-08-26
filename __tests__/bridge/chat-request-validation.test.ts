import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  CHAT_HISTORY_MAX_CHARS_PER_MESSAGE,
  CHAT_HISTORY_MAX_ITEMS,
  CHAT_HISTORY_TOTAL_MAX_CHARS,
  chatRequestSchema,
  multimodalIntentRequestSchema,
  normalizeChatRequestHistory,
  queryIntentRequestSchema,
  runtimeLoginRequestSchema,
  runtimeModelsRequestSchema,
  saveConfigSchema,
  validate,
} from '../../src/bridge/chat-bridge/validation';

const chatBridgeRouteSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'),
  'utf8',
);

describe('ChatBridge request payload limits', () => {
  it('accepts bounded runtime provider auth configuration and rejects shell-like provider ids', () => {
    expect(validate(saveConfigSchema, {
      mode: 'api',
      agent_runtimes: {
        pi: {
          provider_auth: { mode: 'api_key', provider: 'openrouter', api_key: 'secret' },
        },
        opencode: {
          provider_auth: { mode: 'cli_login', provider: 'anthropic' },
        },
      },
    }).success).toBe(true);
    expect(validate(runtimeModelsRequestSchema, {
      provider: 'anthropic; whoami',
      auth_mode: 'api_key',
    }).success).toBe(false);
    expect(validate(runtimeLoginRequestSchema, {
      provider: '../bad provider',
    }).success).toBe(false);
  });

  it('accepts a normal bounded chat request', () => {
    const result = validate(chatRequestSchema, {
      message: '请总结当前项目。',
      modelId: 'secondary-provider-1',
      history: [{ role: 'user', content: '前文' }],
    });

    expect(result.success).toBe(true);
  });

  it('compresses one oversized history message before request validation without mutating the source', () => {
    const longContent = `HEAD-${'中间内容'.repeat(12_000)}-TAIL`;
    const source = {
      message: '继续',
      history: [{ role: 'assistant', content: longContent }],
    };

    const normalized = normalizeChatRequestHistory(source);
    const normalizedHistory = (normalized.body as typeof source).history;

    expect(source.history[0].content).toBe(longContent);
    expect(normalizedHistory[0].content.length).toBeLessThanOrEqual(CHAT_HISTORY_MAX_CHARS_PER_MESSAGE);
    expect(normalizedHistory[0].content).toContain('完整内容仍保存在本地会话中');
    expect(normalizedHistory[0].content).toMatch(/^HEAD-/);
    expect(normalizedHistory[0].content).toMatch(/-TAIL$/);
    expect(normalized.stats.truncatedMessages).toBeGreaterThan(0);
    expect(validate(chatRequestSchema, normalized.body).success).toBe(true);
  });

  it('keeps the newest history under item and total character budgets', () => {
    const history = Array.from({ length: 30 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message-${index}:` + 'x'.repeat(15_000),
    }));

    const normalized = normalizeChatRequestHistory({ message: '继续', history });
    const output = (normalized.body as { history: Array<{ role: string; content: string }> }).history;
    const outputChars = output.reduce((sum, item) => sum + item.content.length, 0);

    expect(output.length).toBeLessThanOrEqual(CHAT_HISTORY_MAX_ITEMS);
    expect(outputChars).toBeLessThanOrEqual(CHAT_HISTORY_TOTAL_MAX_CHARS);
    expect(output.at(-1)?.content).toContain('message-29:');
    expect(normalized.stats.droppedMessages).toBeGreaterThan(0);
    expect(validate(chatRequestSchema, normalized.body).success).toBe(true);
  });

  it('normalizes legacy client history before the route validates it', () => {
    const normalizeIndex = chatBridgeRouteSource.indexOf('const normalizedRequest = normalizeChatRequestHistory(req.body);');
    const validateIndex = chatBridgeRouteSource.indexOf('const validation = validate(chatRequestSchema, normalizedRequest.body);');

    expect(normalizeIndex).toBeGreaterThan(-1);
    expect(validateIndex).toBeGreaterThan(normalizeIndex);
  });

  it('rejects oversized opaque frontend state even when named fields are valid', () => {
    const result = validate(chatRequestSchema, {
      message: '继续',
      frontendState: { opaque: 'x'.repeat(4 * 1024 * 1024) },
    });

    expect(result).toEqual({
      success: false,
      error: '聊天请求总大小超过 4 MB',
    });
  });

  it('applies a smaller total limit to intent endpoints', () => {
    const oversizedState = { opaque: 'x'.repeat(2 * 1024 * 1024) };
    const queryResult = validate(queryIntentRequestSchema, {
      message: '判断意图',
      explicitParts: [oversizedState],
    });
    const multimodalResult = validate(multimodalIntentRequestSchema, {
      message: '分析图片',
      chatAttachments: [{ path: 'C:/safe/image.png' }],
      workspaceDirectory: oversizedState,
    });

    expect(queryResult.success).toBe(false);
    expect(multimodalResult.success).toBe(false);
  });
});
