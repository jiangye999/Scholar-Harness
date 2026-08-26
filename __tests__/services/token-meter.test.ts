import { describe, expect, it } from 'vitest';

import { SessionTokenMeter, estimateTokens } from '../../src/server/services/token-meter';

describe('token-meter', () => {
  it('estimates CJK-heavy text with the shared heuristic', () => {
    const ascii = estimateTokens('hello world this is a test message');
    const cjk = estimateTokens('这是一个包含中文的测试消息');
    expect(ascii).toBeGreaterThan(0);
    expect(cjk).toBeGreaterThan(0);
    // CJK costs more per char than ASCII.
    expect(cjk).toBeGreaterThan(estimateTokens('aaaa'));
  });

  it('returns zero for empty input', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens(null)).toBe(0);
    expect(estimateTokens(undefined)).toBe(0);
  });

  it('accumulates a rolling count and resets', () => {
    const meter = new SessionTokenMeter();
    const first = meter.addTokens('abc');
    const second = meter.addTokens('def');
    expect(meter.tokens).toBe(first + second);
    meter.reset();
    expect(meter.tokens).toBe(0);
  });

  it('totals a message list without mutating the meter', () => {
    const total = SessionTokenMeter.totalTokens([
      { content: 'abc' },
      { content: 'def' },
    ]);
    expect(total).toBe(estimateTokens('abc') + estimateTokens('def'));
  });
});
