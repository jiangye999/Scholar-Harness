import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  dropSessionLog,
  getSessionLog,
  RUNTIME_SNAPSHOT_HEADER,
  SessionLog,
  type SessionLog as SessionLogType,
} from '../../src/server/services/session-log';

let tempRoot = '';
let userId = 'log-test-user';
let conversationId = 'conv-1';

function freshLog(name = conversationId): SessionLogType {
  return getSessionLog({ userId, conversationId: name, rootDir: tempRoot });
}

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'session-log-test-'));
});

afterAll(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('session-log', () => {
  it('assigns sequential seqs and persists to JSONL', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog();
    const u1 = log.append({ type: 'user', content: 'q1' });
    const a1 = log.append({ type: 'assistant', content: 'a1' });
    expect(u1?.seq).toBe(1);
    expect(a1?.seq).toBe(2);
    const filePath = path.join(tempRoot, userId, 'session-logs', `${conversationId}.jsonl`);
    expect(fs.existsSync(filePath)).toBe(true);
    const raw = fs.readFileSync(filePath, 'utf-8');
    expect(raw.split('\n').filter(Boolean)).toHaveLength(2);
  });

  it('derives model messages from the log in order', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog();
    log.append({ type: 'user', content: 'q1' });
    log.append({ type: 'assistant', content: 'a1' });
    log.append({ type: 'tool', name: 'search', output: 'hits', ok: true });
    const messages = log.deriveMessages();
    expect(messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'q1'],
      ['assistant', 'a1'],
    ]);
  });

  it('reloads the persisted log from disk (seq continuity)', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const first = freshLog('reload-conv');
    first.append({ type: 'user', content: 'q1' });
    first.append({ type: 'assistant', content: 'a1' });
    const second = freshLog('reload-conv'); // same key → same in-memory instance
    expect(second.lastSeq()).toBe(2);
    expect(second.deriveMessages()).toHaveLength(2);

    // A fresh registry entry (simulated by direct construction) also reloads.
    const fresh = new SessionLog({ userId, conversationId: 'reload-conv', rootDir: tempRoot });
    expect(fresh.lastSeq()).toBe(2);
    expect(fresh.deriveMessages().map(m => m.content)).toEqual(['q1', 'a1']);
  });

  it('tolerates a torn trailing line from a crash', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('torn-conv');
    log.append({ type: 'user', content: 'q1' });
    const filePath = path.join(tempRoot, userId, 'session-logs', 'torn-conv.jsonl');
    fs.appendFileSync(filePath, '{"type": "assistant", "content": "torn\n', 'utf-8');
    const reloaded = new SessionLog({ userId, conversationId: 'torn-conv', rootDir: tempRoot });
    expect(reloaded.lastSeq()).toBe(1);
    expect(reloaded.deriveMessages().map(m => m.content)).toEqual(['q1']);
  });

  it('renders snapshot events as supersede-style user messages', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('snapshot-conv');
    log.append({ type: 'user', content: 'q1' });
    log.append({ type: 'snapshot', sections: { memory: 'MEM', literature: 'LIT' } });
    log.append({ type: 'assistant', content: 'a1' });
    const messages = log.deriveMessages();
    const snapshot = messages.find(m => m.source === 'snapshot');
    expect(snapshot?.role).toBe('user');
    expect(snapshot?.content).toContain(RUNTIME_SNAPSHOT_HEADER);
    expect(snapshot?.content).toContain('MEM');
    expect(snapshot?.content).toContain('LIT');
  });

  it('compaction replaces the shadowed range with one summary', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('compact-conv');
    log.append({ type: 'user', content: 'q1' });
    log.append({ type: 'assistant', content: 'a1' });
    log.append({ type: 'user', content: 'q2' });
    log.append({ type: 'assistant', content: 'a2' });
    log.append({ type: 'user', content: 'q3' });
    log.compact({ start: 1, end: 4 }, '早期对话：q1/a1/q2/a2');
    const messages = log.deriveMessages();
    expect(messages.map(m => m.content)).toEqual([
      '## 早期对话摘要（已压缩）\n早期对话：q1/a1/q2/a2',
      'q3',
    ]);
  });

  it('keeps the newest messages when over the maxChars budget', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('budget-conv');
    log.append({ type: 'user', content: 'old-' + 'a'.repeat(200) });
    log.append({ type: 'assistant', content: 'mid-' + 'b'.repeat(200) });
    log.append({ type: 'user', content: 'new-' + 'c'.repeat(200) });
    const messages = log.deriveMessages({ maxChars: 300 });
    expect(messages.map(m => m.content)).not.toContain('old-' + 'a'.repeat(200));
    expect(messages[messages.length - 1].content).toBe('new-' + 'c'.repeat(200));
  });

  it('clear removes the persisted file and resets seqs', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('clear-conv');
    log.append({ type: 'user', content: 'q1' });
    const filePath = path.join(tempRoot, userId, 'session-logs', 'clear-conv.jsonl');
    expect(fs.existsSync(filePath)).toBe(true);
    log.clear();
    expect(fs.existsSync(filePath)).toBe(false);
    expect(log.lastSeq()).toBe(0);
  });

  it('deriveMessagesWithStats reports total/dropped chars and history count', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('stats-conv');
    log.append({ type: 'user', content: 'old-' + 'a'.repeat(200) });
    log.append({ type: 'assistant', content: 'mid-' + 'b'.repeat(200) });
    log.append({ type: 'user', content: 'new-' + 'c'.repeat(200) });
    const untrimmed = log.deriveMessagesWithStats();
    expect(untrimmed.historyMessageCount).toBe(3);
    expect(untrimmed.droppedChars).toBe(0);
    expect(untrimmed.totalHistoryChars).toBeGreaterThan(600);

    const trimmed = log.deriveMessagesWithStats({ maxChars: 300 });
    expect(trimmed.droppedChars).toBeGreaterThan(300);
    expect(trimmed.messages[trimmed.messages.length - 1].content).toBe('new-' + 'c'.repeat(200));
    // Untrimmed stats stay available regardless of the per-call budget.
    expect(log.deriveMessagesWithStats().totalHistoryChars).toBe(untrimmed.totalHistoryChars);
  });

  it('projection cache stays consistent across incremental appends', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('cache-conv');
    log.append({ type: 'user', content: 'q1' });
    log.append({ type: 'assistant', content: 'a1' });
    const first = log.deriveMessages().map(m => m.content);
    log.append({ type: 'user', content: 'q2' });
    log.append({ type: 'snapshot', sections: { memory: 'MEM' } });
    log.append({ type: 'assistant', content: 'a2' });
    const second = log.deriveMessages().map(m => m.content);
    expect(second).toEqual([...first, 'q2', expect.stringContaining('MEM'), 'a2']);
    // A fresh instance reloaded from disk must agree with the cached instance.
    const fresh = new SessionLog({ userId, conversationId: 'cache-conv', rootDir: tempRoot });
    expect(fresh.deriveMessages().map(m => m.content)).toEqual(second);
  });

  it('compact invalidates the projection cache and the rebuilt result replaces the range', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('cache-compact-conv');
    log.append({ type: 'user', content: 'q1' });
    log.append({ type: 'assistant', content: 'a1' });
    log.append({ type: 'user', content: 'q2' });
    log.deriveMessages(); // build cache
    log.append({ type: 'assistant', content: 'a2' });
    log.compact({ start: 1, end: 4 }, 'summary');
    log.append({ type: 'user', content: 'q3' });
    const messages = log.deriveMessages().map(m => m.content);
    expect(messages).toEqual([
      '## 早期对话摘要（已压缩）\nsummary',
      'q3',
    ]);
  });

  it('queue audit events are recorded but never surface as model messages', () => {
    dropSessionLog(userId, conversationId, tempRoot);
    const log = freshLog('queue-conv');
    log.append({ type: 'user', content: 'q1' });
    const cancelled = log.append({ type: 'queue', action: 'cancelled', messageId: 'pi_msg_abc12345', behavior: 'steer' });
    expect(cancelled?.seq).toBe(2);
    log.append({ type: 'assistant', content: 'a1' });
    const replay = log.replay();
    expect(replay.filter(e => e.type === 'queue')).toHaveLength(1);
    expect(log.deriveMessages().map(m => m.content)).toEqual(['q1', 'a1']);
    const fresh = new SessionLog({ userId, conversationId: 'queue-conv', rootDir: tempRoot });
    expect(fresh.replay().filter(e => e.type === 'queue')).toHaveLength(1);
  });
});
