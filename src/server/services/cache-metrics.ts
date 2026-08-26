/**
 * Cache usage metrics for LLM calls.
 *
 * Records how many input tokens were served from the provider's KV/prefix
 * cache (`cacheReadTokens`) versus paid fresh input, per provider/model and
 * per conversation. The numbers are appended to a daily JSONL file so hit
 * ratios can be tracked over time and surfaced in the UI.
 *
 * Semantics follow the DeepSeek-compatible wire accounting: providers that
 * report cache reads include them in `prompt_tokens`, so the *paid* input is
 * `prompt_tokens - cache_read`. A missing cache field is recorded as
 * `cacheReadTokens: undefined` (unknown), never guessed.
 */

import * as fs from 'fs';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';

export interface CacheUsageRecord {
  ts: string;
  userId?: string;
  conversationId?: string;
  provider: string;
  model?: string;
  /** Paid (uncached) input tokens. */
  inputTokens: number;
  outputTokens: number;
  /** Tokens served from the provider cache; undefined when the provider reported none. */
  cacheReadTokens?: number;
  estimated?: boolean;
}

export interface CacheStatsWindow {
  calls: number;
  callsWithCacheInfo: number;
  paidInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** cacheReadTokens / (paidInputTokens + cacheReadTokens); null when no cache info. */
  hitRatio: number | null;
}

const MAX_BATCH_CACHE_RECORDS = 200;

/** Map a provider/model onto a stable cache domain key for grouping. */
export function cacheDomainKey(provider: string, model?: string): string {
  return `${String(provider || 'unknown')}\u0001${String(model || '').trim()}`;
}

function normalizeProvider(provider: string | undefined): string {
  const value = String(provider || 'unknown').trim();
  if (!value) return 'unknown';
  return value.slice(0, 64);
}

function normalizeId(value: string | undefined, fallback: string): string {
  const text = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 96);
  return text || fallback;
}

function todayFile(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(getDataDir(), 'cache-metrics', `${stamp}.jsonl`);
}

/**
 * Normalize and bound a raw cache usage record before it is persisted.
 * Unknown cache fields are preserved as `undefined` rather than fabricated.
 */
export function normalizeCacheUsage(input: Partial<CacheUsageRecord>): CacheUsageRecord {
  const provider = normalizeProvider(input.provider);
  const inputTokens = Number.isFinite(Number(input.inputTokens))
    ? Math.max(0, Math.floor(Number(input.inputTokens)))
    : 0;
  const outputTokens = Number.isFinite(Number(input.outputTokens))
    ? Math.max(0, Math.floor(Number(input.outputTokens)))
    : 0;
  const cacheRead = input.cacheReadTokens === undefined
    ? undefined
    : (Number.isFinite(Number(input.cacheReadTokens))
      ? Math.max(0, Math.floor(Number(input.cacheReadTokens)))
      : undefined);
  return {
    ts: String(input.ts || new Date().toISOString()),
    userId: input.userId ? normalizeId(input.userId, 'web-user') : undefined,
    conversationId: input.conversationId ? normalizeId(input.conversationId, 'conversation') : undefined,
    provider,
    model: input.model ? String(input.model).trim().slice(0, 128) || undefined : undefined,
    inputTokens,
    outputTokens,
    ...(cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {}),
    ...(input.estimated === true ? { estimated: true } : {}),
  };
}

/**
 * Persist one cache usage record. Failures are logged but never throw, so
 * cache accounting can never break a chat turn.
 */
export function recordCacheUsage(input: Partial<CacheUsageRecord>): void {
  try {
    const record = normalizeCacheUsage(input);
    const filePath = todayFile();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf-8');
  } catch (error) {
    logger.warn('[CacheMetrics] Failed to record cache usage:', error);
  }
}

/**
 * Aggregate cache usage over the given time window (defaults to today).
 * Returns a stable shape with a `null` hit ratio when no call reported cache
 * information.
 */
export function getCacheStats(options?: {
  since?: Date;
  until?: Date;
  provider?: string;
  model?: string;
  file?: string;
}): CacheStatsWindow {
  const records = readCacheMetricRecords(options);
  const stats: CacheStatsWindow = {
    calls: 0,
    callsWithCacheInfo: 0,
    paidInputTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    hitRatio: null,
  };
  for (const record of records) {
    stats.calls += 1;
    stats.paidInputTokens += record.inputTokens;
    stats.outputTokens += record.outputTokens;
    if (record.cacheReadTokens !== undefined) {
      stats.callsWithCacheInfo += 1;
      stats.cacheReadTokens += record.cacheReadTokens;
    }
  }
  const totalInput = stats.paidInputTokens + stats.cacheReadTokens;
  stats.hitRatio = stats.callsWithCacheInfo > 0 && totalInput > 0
    ? stats.cacheReadTokens / totalInput
    : null;
  return stats;
}

/** Shared JSONL reader used by stats and cost reports. */
function readCacheMetricRecords(options?: {
  since?: Date;
  until?: Date;
  provider?: string;
  model?: string;
  file?: string;
}): CacheUsageRecord[] {
  const since = options?.since?.getTime() ?? Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
  const until = options?.until?.getTime() ?? Date.now();
  const filePath = options?.file || todayFile();
  const records: CacheUsageRecord[] = [];
  try {
    if (!fs.existsSync(filePath)) return records;
    const lines = fs.readFileSync(filePath, 'utf-8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const record = normalizeCacheUsage(JSON.parse(trimmed) as Partial<CacheUsageRecord>);
        const ts = Date.parse(record.ts);
        if (!Number.isFinite(ts) || ts < since || ts > until) continue;
        if (options?.provider && cacheDomainKey(record.provider, record.model) !== cacheDomainKey(options.provider, options.model)) {
          if (record.provider !== options.provider) continue;
        }
        records.push(record);
      } catch {
        continue; // Tolerate a torn trailing line from a crash mid-append.
      }
    }
  } catch (error) {
    logger.warn('[CacheMetrics] Failed to read cache records:', error);
  }
  return records;
}

/* ---------------------------------------------------------------------------
 * Cost reporting (P2-5 of docs/pi-agent-cache-and-dsh-plan.md).
 *
 * Prices below are reference values in CNY per million tokens; DeepSeek
 * changes them from time to time (see e.g. the Feb 2025 adjustments), so the
 * table can be overridden wholesale via the CACHE_COST_PRICES_JSON env var:
 *   {"deepseek-chat": {"input": 2, "cache": 0.5, "output": 8}, ...}
 * ------------------------------------------------------------------------- */

export interface CostPriceTier {
  /** Paid (uncached) input, CNY per million tokens. */
  inputPerMToken: number;
  /** Cache-hit input, CNY per million tokens. */
  cacheReadPerMToken: number;
  /** Output, CNY per million tokens. */
  outputPerMToken: number;
}

export const DEFAULT_COST_PRICES: Record<string, CostPriceTier> = {
  'deepseek-chat': { inputPerMToken: 2, cacheReadPerMToken: 0.5, outputPerMToken: 8 },
  'deepseek-reasoner': { inputPerMToken: 4, cacheReadPerMToken: 1, outputPerMToken: 16 },
};

const FALLBACK_COST_PRICE_TIER: CostPriceTier = { inputPerMToken: 2, cacheReadPerMToken: 0.5, outputPerMToken: 8 };

let cachedCostPrices: Record<string, CostPriceTier> | null = null;

function loadCostPrices(): Record<string, CostPriceTier> {
  if (cachedCostPrices) return cachedCostPrices;
  const raw = process.env.CACHE_COST_PRICES_JSON;
  if (raw && raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
      const normalized: Record<string, CostPriceTier> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || typeof value !== 'object') continue;
        normalized[key.toLowerCase()] = {
          inputPerMToken: Number(value.input ?? value.inputPerMToken) || 0,
          cacheReadPerMToken: Number(value.cache ?? value.cacheReadPerMToken) || 0,
          outputPerMToken: Number(value.output ?? value.outputPerMToken) || 0,
        };
      }
      if (Object.keys(normalized).length > 0) {
        cachedCostPrices = normalized;
        return cachedCostPrices;
      }
    } catch (error) {
      logger.warn('[CacheMetrics] Invalid CACHE_COST_PRICES_JSON, using defaults:', error);
    }
  }
  cachedCostPrices = { ...DEFAULT_COST_PRICES };
  return cachedCostPrices;
}

/** Reset the price-table cache (used by tests and config reloads). */
export function resetCostPricesCache(): void {
  cachedCostPrices = null;
}

export function resolveCostPriceTier(provider: string, model?: string): CostPriceTier {
  const modelText = String(model || '').toLowerCase();
  const prices = loadCostPrices();
  for (const [key, tier] of Object.entries(prices)) {
    if (key && modelText.includes(key)) return tier;
  }
  if (/reasoner|r1/i.test(modelText)) return DEFAULT_COST_PRICES['deepseek-reasoner'];
  return FALLBACK_COST_PRICE_TIER;
}

/** Estimate the cost (CNY) of one usage record. */
export function estimateUsageCost(record: Pick<CacheUsageRecord, 'provider' | 'model' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens'>): number {
  const tier = resolveCostPriceTier(record.provider, record.model);
  const paidInput = Math.max(0, Number(record.inputTokens) || 0);
  const cacheRead = record.cacheReadTokens !== undefined ? Math.max(0, Number(record.cacheReadTokens) || 0) : 0;
  const output = Math.max(0, Number(record.outputTokens) || 0);
  return (
    paidInput * tier.inputPerMToken
    + cacheRead * tier.cacheReadPerMToken
    + output * tier.outputPerMToken
  ) / 1_000_000;
}

export interface CostReportRow {
  provider: string;
  model?: string;
  calls: number;
  callsWithCacheInfo: number;
  paidInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costYuan: number;
}

export interface CostReportConversationRow {
  conversationId: string;
  calls: number;
  paidInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  costYuan: number;
}

export interface CostReport {
  since: string;
  until: string;
  calls: number;
  paidInputTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalCostYuan: number;
  byProviderModel: CostReportRow[];
  byDay: CostReportRow[];
  byConversation: CostReportConversationRow[];
}

function mergeCostRow(target: CostReportRow, record: CacheUsageRecord, costYuan: number): void {
  target.calls += 1;
  target.paidInputTokens += record.inputTokens;
  target.outputTokens += record.outputTokens;
  target.costYuan += costYuan;
  if (record.cacheReadTokens !== undefined) {
    target.callsWithCacheInfo += 1;
    target.cacheReadTokens += record.cacheReadTokens;
  }
}

/**
 * Cost report over the given window: totals plus breakdowns by provider/model,
 * by UTC day and by conversation. Unknown/missing prices fall back to the
 * default table; the report is always computed, never thrown.
 */
export function getCostReport(options?: {
  since?: Date;
  until?: Date;
  file?: string;
  provider?: string;
  model?: string;
}): CostReport {
  const records = readCacheMetricRecords(options);
  const sinceIso = options?.since?.toISOString() ?? new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z';
  const untilIso = options?.until?.toISOString() ?? new Date().toISOString();

  const totals: CostReportRow = { provider: '*', calls: 0, callsWithCacheInfo: 0, paidInputTokens: 0, cacheReadTokens: 0, outputTokens: 0, costYuan: 0 };
  const byProviderModel = new Map<string, CostReportRow>();
  const byDay = new Map<string, CostReportRow>();
  const byConversation = new Map<string, CostReportConversationRow>();

  for (const record of records) {
    const costYuan = estimateUsageCost(record);
    mergeCostRow(totals, record, costYuan);

    const domainKey = cacheDomainKey(record.provider, record.model);
    const row = byProviderModel.get(domainKey) || {
      provider: record.provider,
      model: record.model,
      calls: 0,
      callsWithCacheInfo: 0,
      paidInputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      costYuan: 0,
    };
    mergeCostRow(row, record, costYuan);
    byProviderModel.set(domainKey, row);

    const day = String(record.ts || '').slice(0, 10);
    if (day) {
      const dayRow = byDay.get(day) || {
        provider: day,
        calls: 0,
        callsWithCacheInfo: 0,
        paidInputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costYuan: 0,
      };
      mergeCostRow(dayRow, record, costYuan);
      byDay.set(day, dayRow);
    }

    if (record.conversationId) {
      const conversationRow = byConversation.get(record.conversationId) || {
        conversationId: record.conversationId,
        calls: 0,
        paidInputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costYuan: 0,
      };
      conversationRow.calls += 1;
      conversationRow.paidInputTokens += record.inputTokens;
      conversationRow.outputTokens += record.outputTokens;
      conversationRow.costYuan += costYuan;
      if (record.cacheReadTokens !== undefined) conversationRow.cacheReadTokens += record.cacheReadTokens;
      byConversation.set(record.conversationId, conversationRow);
    }
  }

  const sortRows = (rows: CostReportRow[]): CostReportRow[] => rows.sort((a, b) => b.costYuan - a.costYuan);
  const conversations = Array.from(byConversation.values()).sort((a, b) => b.costYuan - a.costYuan);

  return {
    since: sinceIso,
    until: untilIso,
    calls: totals.calls,
    paidInputTokens: totals.paidInputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    outputTokens: totals.outputTokens,
    totalCostYuan: totals.costYuan,
    byProviderModel: sortRows(Array.from(byProviderModel.values())),
    byDay: sortRows(Array.from(byDay.values())),
    byConversation: conversations,
  };
}

/** Batch append support for turn-level flushing. */
export function recordCacheUsageBatch(records: Array<Partial<CacheUsageRecord>>): void {
  const bounded = records.slice(0, MAX_BATCH_CACHE_RECORDS);
  for (const record of bounded) recordCacheUsage(record);
}

/** True when the underlying wire reported cache-read tokens. */
export function hasCacheInfo(input: Partial<CacheUsageRecord>): boolean {
  return input.cacheReadTokens !== undefined && Number.isFinite(Number(input.cacheReadTokens));
}
