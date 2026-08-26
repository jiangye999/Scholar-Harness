import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('homepage memory authority', () => {
  it('lets ChatBridge load and update long-term memory exactly once', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/public/app/chat.js'),
      'utf8',
    );
    const prepareStart = source.indexOf('async function prepareChatBridgeContext(');
    const prepareEnd = source.indexOf('\n    async function ', prepareStart + 1);
    const prepareSource = source.slice(prepareStart, prepareEnd > prepareStart ? prepareEnd : undefined);

    expect(prepareSource).not.toContain("fetch('/api/memory/' + currentUserId)");
    expect(source).not.toContain('async function updateMemoryWithAPI(');
    expect(source).toContain('长期记忆由 /api/chat-bridge/chat 在服务端统一加载、筛选和写回');
  });
});
