import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');
const route = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');
const systemPrompt = readFileSync(path.resolve(__dirname, '../../src/server/services/chat-system-prompt.ts'), 'utf-8');

describe('multimodal intent request flow', () => {
  it('runs AI intent recognition before the main chat request', () => {
    expect(html).toContain('if (allPendingFilesAreImages && raw) return true;');
    expect(html).toContain('async function classifyMultimodalAttachmentIntent(chatRequestBody)');
    expect(html).toContain("fetch('/api/chat-bridge/multimodal-intent'");
    expect(html).toContain('var multimodalIntent = await classifyMultimodalAttachmentIntent(chatBridgeRequestBody);');
    expect(html).toContain('chatBridgeContext.multimodalIntent = multimodalIntent;');
    expect(
      html.indexOf('var multimodalIntent = await classifyMultimodalAttachmentIntent(chatBridgeRequestBody);')
    ).toBeLessThan(html.indexOf("var chatBridgeResponse = await fetch('/api/chat-bridge/chat'"));
  });

  it('uses direct multimodal chat only as a non-blocking classifier fallback', () => {
    expect(html).toContain('Stage 1 unavailable; falling back to direct multimodal chat');
    expect(html).toContain("if (error && error.name === 'AbortError') throw error;");
    expect(html).toContain('return null;');
  });

  it('switches the second stage to the tool-capable execution path', () => {
    expect(route).toContain("router.post('/multimodal-intent'");
    expect(route).toContain('const visionAlreadyAnalyzed = multimodalIntent?.visionAnalyzed === true;');
    expect(route).toContain('const executionCodexImagePaths = visionAlreadyAnalyzed ? [] : codexImagePaths;');
    expect(route).toContain('buildMultimodalIntentPromptBlock');
    expect(systemPrompt).toContain('图片识别是理解用户请求的中间步骤，不是默认的最终任务');
    expect(systemPrompt).toContain('不得只描述图片后让用户再次下达命令');
  });
});
