import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { attachVisionImagesToMessages } from '../../src/bridge/chat-bridge/chat-bridge';
import type { LLMToolMessage } from '../../src/utils/llm-client';

describe('ChatBridge vision messages', () => {
  let tempDir = '';

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('attaches images to the last user message instead of a later tool result', async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chat-bridge-vision-'));
    const imagePath = path.join(tempDir, 'figure.png');
    await fs.writeFile(imagePath, Buffer.from('89504e470d0a1a0a', 'hex'));
    const messages: LLMToolMessage[] = [
      { role: 'system', content: 'system policy' },
      { role: 'user', content: '分析这张图' },
      { role: 'assistant', content: null, tool_calls: [] },
      { role: 'tool', tool_call_id: 'call-1', name: 'read_file', content: 'tool result' },
    ];

    const result = attachVisionImagesToMessages(messages, [imagePath], true);
    const userContent = result[1].content as unknown as Array<Record<string, unknown>>;

    expect(userContent[0]).toEqual({ type: 'text', text: '分析这张图' });
    expect(userContent[1]).toMatchObject({
      type: 'image_url',
      image_url: {
        detail: 'high',
      },
    });
    expect(String((userContent[1].image_url as { url: string }).url)).toMatch(/^data:image\/png;base64,/);
    expect(result[3]).toEqual(messages[3]);
    expect(messages[1].content).toBe('分析这张图');
  });

  it('does not alter messages when vision is not requested', () => {
    const messages: LLMToolMessage[] = [{ role: 'user', content: '普通文本请求' }];
    expect(attachVisionImagesToMessages(messages, [], false)).toBe(messages);
  });
});
