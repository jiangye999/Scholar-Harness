import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { ChatBridgeAdapter } from '../../src/bridge/chat-bridge/chat-bridge';

describe('ChatBridge provider selection policy', () => {
  it('keeps explicit API providers in the textual tool-call loop when a Coding Agent default is enabled', async () => {
    const adapter = new ChatBridgeAdapter();
    (adapter as unknown as { config: unknown }).config = {
      codex: { enabled: true, prefer: true },
      agent_runtimes: {
        default: 'codex',
        codex: { enabled: true },
      },
    };

    await expect(adapter.shouldUseCodex({ forceProvider: 'primary' })).resolves.toBe(false);
    await expect(adapter.shouldUseCodex({ forceProvider: 'secondary' })).resolves.toBe(false);
    await expect(adapter.shouldUseCodex({})).resolves.toBe(true);
    await expect(adapter.shouldUseCodex({ agentRuntime: 'codex' })).resolves.toBe(true);
  });

  it('only applies a configured Coding Agent default when no provider was explicitly selected', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
      'utf8',
    );

    expect(source).toContain('const explicitCodingRuntime = options.agentRuntime');
    expect(source).toContain("const configuredDefaultRuntime = this.config?.agent_runtimes?.default || ''");
    expect(source).toContain('!options.forceProvider && !options.bypassCodexPreference');
    expect(source).toContain("enabledDefaultRuntime || (preferCodex ? 'codex' : '')");
    expect(source).not.toContain("(options.forceProvider === 'primary' && preferCodex)");
  });

  it('connects model-pool failover to OpenAI-compatible tool calls', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
      'utf8',
    );
    expect(source).toContain('chatWithToolsFailover(');
    expect(source).toContain('poolFailover=${poolEnabled}');
  });

  it('decrypts a directly selected single-pool entry and honors request modelId', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
      'utf8',
    );
    expect(source).toContain('return { ...resolved, api_key: decryptedApiKey }');
    expect(source).toContain('options.modelId || !options.model');
    expect(source).toContain('API tool_calls 使用模型池 entry=');
  });

  it('keeps request model selection explicit through the route contract', () => {
    const routeSource = fs.readFileSync(
      path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'),
      'utf8',
    );
    expect(routeSource).toContain('model,\n          modelId,');
    expect(routeSource).not.toContain("model: model || 'unknown'");
    expect(routeSource).toContain("modelId && String(entry?.id || '') === String(modelId)");
  });
});
