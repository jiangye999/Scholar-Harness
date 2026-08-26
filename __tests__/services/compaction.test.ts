import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getSessionLog, type SessionLog } from '../../src/server/services/session-log';
import {
  buildCompactionSummaryPrompt,
  considerAutoCompaction,
  runCompaction,
  selectCompactionRange,
} from '../../src/server/services/compaction';

let tempRoot = '';
const userId = 'compact-test-user';

function freshLog(name: string): SessionLog {
  return getSessionLog({ userId, conversationId: name, rootDir: tempRoot });
}

function seedTurns(log: SessionLog, turnCount: number, content = '这是一个中等长度的对话消息，包含中文与英文 mix 123。'): void {
  for (let i = 1; i <= turnCount; i++) {
    log.append({ type: 'user', content: `第 ${i} 轮问题：${content}` });
    log.append({ type: 'assistant', content: `第 ${i} 轮回答：${content} ${content}` });
  }
}

beforeAll(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'compaction-test-'));
});

afterAll(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('selectCompactionRange', () => {
  it('returns null for a short history', () => {
    const log = freshLog('short');
    seedTurns(log, 2);
    expect(selectCompactionRange(log.replay())).toBeNull();
  });

  it('selects the oldest complete turns and ends on an assistant event', () => {
    const log = freshLog('select');
    seedTurns(log, 8);
    const range = selectCompactionRange(log.replay());
    expect(range).not.toBeNull();
    const events = log.replay();
    const span = events.filter(event => event.seq >= range!.start && event.seq <= range!.end);
    expect(span[0].type).toBe('user');
    expect(span[span.length - 1].type).toBe('assistant');
    // Oldest turns are shadowed, newest kept.
    expect(range!.start).toBe(1);
    expect(range!.end).toBeLessThan(events.length);
  });

  it('keeps the newest messages out of any span', () => {
    const log = freshLog('keep-newest');
    seedTurns(log, 10);
    const range = selectCompactionRange(log.replay(), { keepNewest: 4 });
    const events = log.replay();
    expect(range!.end).toBeLessThanOrEqual(events.length - 4);
  });
});

describe('runCompaction', () => {
  it('does not compact below the token threshold', async () => {
    const log = freshLog('below');
    seedTurns(log, 3);
    const result = await runCompaction({
      sessionLog: log,
      events: log.replay(),
      derivedMessages: log.deriveMessages(),
      summarize: async () => 'summary',
      thresholdTokens: 1_000_000,
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toContain('below-threshold');
  });

  it('compacts the oldest range and derives a summary in place', async () => {
    const log = freshLog('run');
    seedTurns(log, 8);
    const derivedBefore = log.deriveMessages();
    const result = await runCompaction({
      sessionLog: log,
      events: log.replay(),
      derivedMessages: derivedBefore,
      summarize: async () => '被压缩的早期对话摘要',
      thresholdTokens: 1,
    });
    expect(result.compacted).toBe(true);
    expect(result.range).not.toBeNull();
    const derivedAfter = log.deriveMessages();
    expect(derivedAfter[0].source).toBe('compact');
    expect(derivedAfter[0].content).toContain('被压缩的早期对话摘要');
    // The newest message survives the compaction.
    expect(derivedAfter[derivedAfter.length - 1].content).toContain('第 8 轮');
  });

  it('returns a failure reason when the summarizer throws', async () => {
    const log = freshLog('throw');
    seedTurns(log, 8);
    const result = await runCompaction({
      sessionLog: log,
      events: log.replay(),
      derivedMessages: log.deriveMessages(),
      summarize: async () => {
        throw new Error('provider down');
      },
      thresholdTokens: 1,
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toContain('summarizer-failed');
    // The log is untouched.
    expect(log.replay().filter(event => event.type === 'compact')).toHaveLength(0);
  });

  it('compaction keeps the derived prefix stable for the untouched tail', async () => {
    const log = freshLog('prefix');
    seedTurns(log, 6);
    const beforeTail = log.deriveMessages().slice(-2).map(message => message.content);
    await runCompaction({
      sessionLog: log,
      events: log.replay(),
      derivedMessages: log.deriveMessages(),
      summarize: async () => '摘要',
      thresholdTokens: 1,
    });
    const afterTail = log.deriveMessages().slice(-2).map(message => message.content);
    expect(afterTail).toEqual(beforeTail);
  });
});

describe('considerAutoCompaction', () => {
  it('skips when below the token threshold', async () => {
    const log = freshLog('auto-below');
    seedTurns(log, 3);
    const result = await considerAutoCompaction({
      sessionLog: log,
      summarize: async () => 'summary',
      thresholdTokens: 1_000_000,
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toContain('below-threshold');
    expect(log.replay().filter(event => event.type === 'compact')).toHaveLength(0);
  });

  it('force compacts even below the pressure threshold (overflow trigger)', async () => {
    const log = freshLog('auto-force');
    seedTurns(log, 8);
    const result = await considerAutoCompaction({
      sessionLog: log,
      summarize: async () => '溢出强制压缩摘要',
      thresholdTokens: 1_000_000,
      force: true,
    });
    expect(result.compacted).toBe(true);
    const derived = log.deriveMessages();
    expect(derived[0].source).toBe('compact');
    expect(derived[0].content).toContain('溢出强制压缩摘要');
  });

  it('uses the default pressure threshold when none is given', async () => {
    const log = freshLog('auto-default');
    seedTurns(log, 4, '短消息。');
    // 4 turns of short messages must be far below the 30k default threshold.
    const result = await considerAutoCompaction({
      sessionLog: log,
      summarize: async () => 'summary',
    });
    expect(result.compacted).toBe(false);
    expect(result.reason).toContain('below-threshold');
  });

  it('fails gracefully when the summarizer throws', async () => {
    const log = freshLog('auto-throw');
    seedTurns(log, 8);
    const result = await considerAutoCompaction({
      sessionLog: log,
      summarize: async () => {
        throw new Error('provider down');
      },
      force: true,
    });
    expect(result.compacted).toBe(false);
    expect(log.replay().filter(event => event.type === 'compact')).toHaveLength(0);
  });
});

describe('buildCompactionSummaryPrompt', () => {
  it('is deterministic and bounds the range text', () => {
    const longText = 'a'.repeat(100_000);
    const first = buildCompactionSummaryPrompt(longText);
    const second = buildCompactionSummaryPrompt(longText);
    expect(first).toBe(second);
    expect(first.length).toBeLessThan(45_000);
    expect(first).toContain('不超过 300 字');
  });
});
