import { describe, expect, it } from 'vitest';

import {
  assembleMessages,
  joinSnapshotSections,
  RUNTIME_SNAPSHOT_HEADER,
  trimHistoryToBudget,
} from '../../src/orchestrator/prompt-assembler';

describe('prompt-assembler', () => {
  it('is deterministic: identical input yields identical bytes', () => {
    const input = {
      systemPrompt: 'SYSTEM',
      history: [
        { role: 'user' as const, content: 'q1' },
        { role: 'assistant' as const, content: 'a1' },
      ],
      snapshotSections: [
        { name: 'memory', order: 10, text: 'MEM' },
        { name: 'lit', order: 20, text: 'LIT' },
      ],
      currentRequest: 'q2',
    };
    const first = JSON.stringify(assembleMessages(input));
    const second = JSON.stringify(assembleMessages(input));
    expect(first).toBe(second);
  });

  it('appends history without changing earlier messages (prefix stability)', () => {
    const before = assembleMessages({
      systemPrompt: 'SYSTEM',
      history: [
        { role: 'user' as const, content: 'q1' },
        { role: 'assistant' as const, content: 'a1' },
      ],
      currentRequest: 'q2',
    });
    // Next turn: the previous request moves into history, the new request is last.
    const after = assembleMessages({
      systemPrompt: 'SYSTEM',
      history: [
        { role: 'user' as const, content: 'q1' },
        { role: 'assistant' as const, content: 'a1' },
        { role: 'user' as const, content: 'q2' },
      ],
      currentRequest: 'q3',
    });
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it('places the stable system message first and the request last', () => {
    const messages = assembleMessages({
      systemPrompt: 'SYSTEM',
      history: [{ role: 'user' as const, content: 'q1' }],
      currentRequest: 'q2',
    });
    expect(messages[0]).toEqual({ role: 'system', content: 'SYSTEM' });
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'q2' });
  });

  it('renders the runtime snapshot at the tail with the supersede header', () => {
    const messages = assembleMessages({
      systemPrompt: 'SYSTEM',
      history: [{ role: 'user' as const, content: 'q1' }],
      snapshotSections: [
        { name: 'lit', order: 20, text: 'LIT' },
        { name: 'memory', order: 10, text: 'MEM' },
      ],
      currentRequest: 'q2',
    });
    const snapshot = messages[messages.length - 2];
    expect(snapshot.role).toBe('user');
    expect(snapshot.content).toContain(RUNTIME_SNAPSHOT_HEADER);
    // Sections render in ascending order regardless of input order.
    expect(snapshot.content.indexOf('MEM')).toBeLessThan(snapshot.content.indexOf('LIT'));
  });

  it('drops the oldest history first when over budget, never the newest', () => {
    const messages = assembleMessages({
      systemPrompt: 'S',
      history: [
        { role: 'user' as const, content: 'old-11111111' },
        { role: 'assistant' as const, content: 'mid-1111111111' },
        { role: 'user' as const, content: 'new-111111111111' },
      ],
      currentRequest: 'req-111111111111',
      maxChars: 40,
    });
    const contents = messages.map(message => message.content);
    expect(contents).not.toContain('old-11111111');
    expect(contents).toContain('new-111111111111');
    expect(contents[contents.length - 1]).toBe('req-111111111111');
  });

  it('omits empty system/snapshot/request parts', () => {
    const messages = assembleMessages({ currentRequest: 'q' });
    expect(messages).toEqual([{ role: 'user', content: 'q' }]);
    expect(joinSnapshotSections([{ name: 'x', order: 1, text: '   ' }])).toBe('');
  });

  it('keeps the newest message even when a single message overflows the budget', () => {
    const trimmed = trimHistoryToBudget(
      [
        { role: 'user' as const, content: 'a'.repeat(100) },
        { role: 'user' as const, content: 'b'.repeat(100) },
      ],
      50,
    );
    expect(trimmed).toHaveLength(1);
    expect(trimmed[0].content).toBe('b'.repeat(100));
  });
});
