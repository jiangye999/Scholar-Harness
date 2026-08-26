import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  archiveConversationMessages,
  listConversations,
  saveConversationMessages,
} from '../../../src/server/routes/memory';

describe('conversation archive persistence', () => {
  let rootDir = '';

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-conversation-archive-'));
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('moves a complete conversation into the project archive and blocks late saves', async () => {
    const userId = 'user-archive';
    const conversationId = 'conv-archive-1';
    const messages = [
      { role: 'user', content: '规划 Discussion' },
      { role: 'assistant', content: '已经完成。' },
    ];
    await saveConversationMessages(userId, conversationId, messages, rootDir);
    const userDir = path.join(rootDir, userId);
    fs.writeFileSync(path.join(userDir, 'memory.json'), JSON.stringify({
      userId,
      entries: [],
      conversations: [{ id: conversationId, title: 'Discussion', summary: '', keyTopics: [], messageCount: 2, createdAt: '', updatedAt: '' }],
      updatedAt: new Date().toISOString(),
    }), 'utf-8');

    const result = await archiveConversationMessages({
      userId,
      conversationId,
      rootDir,
      projectId: 'project-test',
      title: 'Discussion 规划',
      messages,
    });

    const archive = JSON.parse(fs.readFileSync(path.join(rootDir, 'archived-conversations.json'), 'utf-8'));
    expect(result.record).toMatchObject({ id: conversationId, title: 'Discussion 规划', messageCount: 2 });
    expect(archive.conversations).toEqual([
      expect.objectContaining({ id: conversationId, messages, projectId: 'project-test' }),
    ]);
    expect(fs.existsSync(path.join(userDir, 'conversations', `${conversationId}.json`))).toBe(false);
    expect(await listConversations(userId, undefined, rootDir)).toEqual([]);

    await expect(saveConversationMessages(userId, conversationId, messages, rootDir)).resolves.toBe(false);
    expect(fs.existsSync(path.join(userDir, 'conversations', `${conversationId}.json`))).toBe(false);
    const memory = JSON.parse(fs.readFileSync(path.join(userDir, 'memory.json'), 'utf-8'));
    expect(memory.conversations).toEqual([]);
  });

  it('suppresses a legacy web-user copy using the same project archive file', async () => {
    const conversationId = 'conv-migrated-1';
    const messages = [{ role: 'user', content: 'legacy conversation' }];
    await saveConversationMessages('signed-user', conversationId, messages, rootDir);
    await saveConversationMessages('web-user', conversationId, messages, rootDir);
    await archiveConversationMessages({ userId: 'signed-user', conversationId, rootDir, messages });

    expect(await listConversations('web-user', undefined, rootDir)).toEqual([]);
  });

  it('recovers from empty active and summary files using the client message snapshot', async () => {
    const userId = 'user-empty-json';
    const conversationId = 'conv-empty-json';
    const userDir = path.join(rootDir, userId);
    const conversationDir = path.join(userDir, 'conversations');
    fs.mkdirSync(conversationDir, { recursive: true });
    fs.writeFileSync(path.join(conversationDir, `${conversationId}.json`), '', 'utf-8');
    fs.writeFileSync(path.join(userDir, 'memory.json'), '', 'utf-8');
    const messages = [{ role: 'user', content: 'recover this complete browser copy' }];

    await expect(archiveConversationMessages({
      userId,
      conversationId,
      rootDir,
      messages,
    })).resolves.toMatchObject({
      record: { id: conversationId, messages, messageCount: 1 },
    });

    const archive = JSON.parse(fs.readFileSync(path.join(rootDir, 'archived-conversations.json'), 'utf-8'));
    expect(archive.conversations[0]).toMatchObject({ id: conversationId, messages });
    expect(fs.existsSync(path.join(conversationDir, `${conversationId}.json`))).toBe(false);
    expect(fs.readFileSync(path.join(userDir, 'memory.json'), 'utf-8')).toBe('');
  });

  it('embeds a truncated source in the archive when no client messages exist', async () => {
    const userId = 'user-truncated-json';
    const conversationId = 'conv-truncated-json';
    const conversationDir = path.join(rootDir, userId, 'conversations');
    const conversationFile = path.join(conversationDir, `${conversationId}.json`);
    fs.mkdirSync(conversationDir, { recursive: true });
    fs.writeFileSync(conversationFile, '{"messages":[', 'utf-8');

    await expect(archiveConversationMessages({
      userId,
      conversationId,
      rootDir,
    })).resolves.toMatchObject({
      record: {
        id: conversationId,
        messages: [],
        recoverySources: [expect.objectContaining({
          userId,
          rawContent: '{"messages":[',
        })],
      },
    });
    expect(fs.existsSync(conversationFile)).toBe(false);
    const archive = JSON.parse(fs.readFileSync(path.join(rootDir, 'archived-conversations.json'), 'utf-8'));
    expect(archive.conversations[0].recoverySources[0].rawContent).toBe('{"messages":[');
  });
});
