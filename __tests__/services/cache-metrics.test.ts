import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  cacheDomainKey,
  DEFAULT_COST_PRICES,
  estimateUsageCost,
  getCostReport,
  getCacheStats,
  hasCacheInfo,
  normalizeCacheUsage,
  recordCacheUsage,
  resetCostPricesCache,
  resolveCostPriceTier,
} from '../../src/server/services/cache-metrics';

let tempRoot = '';

beforeAll(() => {
  // getDataDir() caches its first value for the process, so point DATA_DIR at
  // one shared temp root for the whole file and reset the metrics dir between
  // tests instead of swapping DATA_DIR per test.
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-metrics-test-'));
  process.env.DATA_DIR = tempRoot;
});

afterEach(() => {
  fs.rmSync(path.join(tempRoot, 'cache-metrics'), { recursive: true, force: true });
});

afterAll(() => {
  delete process.env.DATA_DIR;
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

describe('cache-metrics', () => {
  it('normalizes records and bounds numeric fields', () => {
    const record = normalizeCacheUsage({
      provider: 'secondary',
      model: 'deepseek-chat',
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 900,
    });
    expect(record.provider).toBe('secondary');
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(20);
    expect(record.cacheReadTokens).toBe(900);
    expect(record.ts).toBeTruthy();
  });

  it('keeps unknown cache fields undefined rather than zero', () => {
    const record = normalizeCacheUsage({ provider: 'codex', inputTokens: 5, outputTokens: 1 });
    expect(record.cacheReadTokens).toBeUndefined();
    expect(hasCacheInfo(record)).toBe(false);
  });

  it('treats an explicit zero cache read as cache info', () => {
    const record = normalizeCacheUsage({
      provider: 'primary',
      inputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: 0,
    });
    expect(record.cacheReadTokens).toBe(0);
    expect(hasCacheInfo(record)).toBe(true);
  });

  it('persists and aggregates records into a hit ratio', () => {
    recordCacheUsage({ provider: 'secondary', model: 'm1', inputTokens: 27, outputTokens: 2, cacheReadTokens: 256 });
    recordCacheUsage({ provider: 'secondary', model: 'm1', inputTokens: 30, outputTokens: 3, cacheReadTokens: 250 });
    recordCacheUsage({ provider: 'codex', inputTokens: 100, outputTokens: 10 });

    const stats = getCacheStats();
    expect(stats.calls).toBe(3);
    expect(stats.paidInputTokens).toBe(157);
    expect(stats.cacheReadTokens).toBe(506);
    expect(stats.callsWithCacheInfo).toBe(2);
    // 506 / (157 + 506)
    expect(stats.hitRatio).toBeCloseTo(506 / 663, 5);
  });

  it('returns a null hit ratio when no call reported cache info', () => {
    recordCacheUsage({ provider: 'codex', inputTokens: 100, outputTokens: 10 });
    const stats = getCacheStats();
    expect(stats.calls).toBe(1);
    expect(stats.callsWithCacheInfo).toBe(0);
    expect(stats.hitRatio).toBeNull();
  });

  it('maps provider/model to a stable cache domain key', () => {
    expect(cacheDomainKey('secondary', 'deepseek-chat')).toBe(cacheDomainKey('secondary', 'deepseek-chat'));
    expect(cacheDomainKey('secondary', 'deepseek-chat')).not.toBe(cacheDomainKey('secondary', 'gpt-4o'));
    expect(cacheDomainKey('codex', undefined)).not.toBe(cacheDomainKey('primary', undefined));
  });

  it('ignores a torn trailing line from a crash mid-append', () => {
    const filePath = path.join(tempRoot, 'cache-metrics', `${new Date().toISOString().slice(0, 10)}.jsonl`);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    recordCacheUsage({ provider: 'secondary', inputTokens: 10, outputTokens: 1, cacheReadTokens: 90 });
    fs.appendFileSync(filePath, '{"provider": "secondary", "inputTokens": "torn\n', 'utf-8');
    const stats = getCacheStats();
    expect(stats.calls).toBe(1);
    expect(stats.callsWithCacheInfo).toBe(1);
    expect(stats.hitRatio).toBeCloseTo(0.9, 5);
  });

  it('never throws on malformed input (fail-soft accounting)', () => {
    expect(() => recordCacheUsage(undefined as never)).not.toThrow();
    expect(() => recordCacheUsage({ provider: '', inputTokens: Number.NaN, outputTokens: -3 })).not.toThrow();
    expect(() => recordCacheUsage({ provider: 'secondary', inputTokens: 1, outputTokens: 1 })).not.toThrow();
  });
});

describe('cost report (P2-5)', () => {
  afterEach(() => {
    delete process.env.CACHE_COST_PRICES_JSON;
    resetCostPricesCache();
  });

  it('resolves price tiers by model name', () => {
    expect(resolveCostPriceTier('secondary', 'deepseek-chat')).toEqual(DEFAULT_COST_PRICES['deepseek-chat']);
    expect(resolveCostPriceTier('secondary', 'deepseek-reasoner')).toEqual(DEFAULT_COST_PRICES['deepseek-reasoner']);
    expect(resolveCostPriceTier('secondary', 'deepseek-r1')).toEqual(DEFAULT_COST_PRICES['deepseek-reasoner']);
    // Unknown models fall back to the default tier.
    expect(resolveCostPriceTier('codex', 'gpt-4o')).toEqual(DEFAULT_COST_PRICES['deepseek-chat']);
  });

  it('estimates cost from paid input, cache reads and output', () => {
    // deepseek-chat: 1000 paid input @ ¥2/M + 9000 cache @ ¥0.5/M + 2000 output @ ¥8/M
    const cost = estimateUsageCost({
      provider: 'secondary',
      model: 'deepseek-chat',
      inputTokens: 1_000,
      outputTokens: 2_000,
      cacheReadTokens: 9_000,
    });
    expect(cost).toBeCloseTo((1000 * 2 + 9000 * 0.5 + 2000 * 8) / 1_000_000, 8);
  });

  it('supports a custom price table via environment', () => {
    process.env.CACHE_COST_PRICES_JSON = JSON.stringify({
      'my-model': { input: 1, cache: 0.1, output: 3 },
    });
    resetCostPricesCache();
    expect(resolveCostPriceTier('secondary', 'my-model-v2')).toEqual({
      inputPerMToken: 1,
      cacheReadPerMToken: 0.1,
      outputPerMToken: 3,
    });
  });

  it('aggregates records into a cost report with day and conversation breakdowns', () => {
    recordCacheUsage({
      provider: 'secondary',
      model: 'deepseek-chat',
      inputTokens: 500_000,
      outputTokens: 100_000,
      cacheReadTokens: 1_500_000,
      conversationId: 'conv-a',
    });
    recordCacheUsage({
      provider: 'secondary',
      model: 'deepseek-chat',
      inputTokens: 250_000,
      outputTokens: 50_000,
      cacheReadTokens: 500_000,
      conversationId: 'conv-b',
    });
    recordCacheUsage({
      provider: 'secondary',
      model: 'deepseek-reasoner',
      inputTokens: 100_000,
      outputTokens: 20_000,
      conversationId: 'conv-a',
    });

    const report = getCostReport();
    expect(report.calls).toBe(3);

    // deepseek-chat total: (500k+250k)*2 + (1500k+500k)*0.5 + (100k+50k)*8 per million
    const chatExpected = (750_000 * 2 + 2_000_000 * 0.5 + 150_000 * 8) / 1_000_000;
    // deepseek-reasoner (no cache info): 100k*4 + 20k*16 per million
    const reasonerExpected = (100_000 * 4 + 20_000 * 16) / 1_000_000;
    expect(report.totalCostYuan).toBeCloseTo(chatExpected + reasonerExpected, 8);

    const chatRow = report.byProviderModel.find(row => row.model === 'deepseek-chat');
    expect(chatRow?.calls).toBe(2);
    expect(chatRow?.costYuan).toBeCloseTo(chatExpected, 8);
    expect(chatRow?.callsWithCacheInfo).toBe(2);

    expect(report.byDay.length).toBeGreaterThanOrEqual(1);
    expect(report.byDay[0].costYuan).toBeCloseTo(report.totalCostYuan, 8);

    const convA = report.byConversation.find(row => row.conversationId === 'conv-a');
    expect(convA?.calls).toBe(2);
    expect(convA?.costYuan).toBeCloseTo(
      (500_000 * 2 + 1_500_000 * 0.5 + 100_000 * 8) / 1_000_000 + reasonerExpected,
      8,
    );
  });

  it('returns an empty report when there are no records', () => {
    const report = getCostReport();
    expect(report.calls).toBe(0);
    expect(report.totalCostYuan).toBe(0);
    expect(report.byProviderModel).toEqual([]);
  });
});
