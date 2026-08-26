import { describe, it, expect } from 'vitest';
import {
  migratePool,
  pickModel,
  listEnabledEntries,
  findActiveEntry,
  listFailoverQueue,
  resolveEntry,
  generateModelId,
  type ModelPool,
  type LegacyProviderEntry,
} from '../../src/bridge/chat-bridge/model-pool';

describe('model-pool: migratePool', () => {
  it('returns undefined for undefined entry', () => {
    expect(migratePool(undefined)).toBeUndefined();
  });

  it('returns empty entry untouched when no model/api fields', () => {
    const entry: LegacyProviderEntry = { description: 'empty' };
    const result = migratePool(entry);
    expect(result?.pool).toBeUndefined();
    expect(result?.description).toBe('empty');
  });

  it('wraps legacy single-model into pool with id=legacy', () => {
    const entry: LegacyProviderEntry = {
      api_url: 'https://api.openai.com/v1',
      api_key: 'sk-xxx',
      model: 'gpt-4o',
      vision_model: 'gpt-4o',
      description: 'primary',
    };
    const result = migratePool(entry);
    expect(result?.pool).toBeDefined();
    expect(result?.pool?.models).toHaveLength(1);
    expect(result?.pool?.models[0].id).toBe('legacy');
    expect(result?.pool?.models[0].model).toBe('gpt-4o');
    expect(result?.pool?.models[0].api_url).toBe('https://api.openai.com/v1');
    expect(result?.pool?.models[0].api_key).toBe('sk-xxx');
    expect(result?.pool?.models[0].enabled).toBe(true);
    expect(result?.pool?.models[0].priority).toBe(0);
    expect(result?.pool?.active_model_id).toBe('legacy');
    expect(result?.pool?.auto_fallback).toBe(true);
    // 老字段保留 (兼容兜底)
    expect(result?.model).toBe('gpt-4o');
    expect(result?.api_url).toBe('https://api.openai.com/v1');
  });

  it('leaves existing non-empty pool untouched but fills missing fields', () => {
    const entry: LegacyProviderEntry = {
      model: 'gpt-4o',
      api_url: 'https://old',
      api_key: 'sk-old',
      pool: {
        models: [
          { id: 'a', model: 'claude-sonnet-4-5', api_url: 'https://new', enabled: true, priority: 0 },
          { id: 'a', model: 'gpt-4o', enabled: true, priority: 1 }, // duplicate id + no api_url
        ],
      },
    };
    const result = migratePool(entry);
    const models = result?.pool?.models!;
    expect(models).toHaveLength(2);
    // 重复 id 被改写
    expect(models[0].id).toBe('a');
    expect(models[1].id).not.toBe('a');
    // 缺失字段补默认
    expect(models[1].api_url).toBe('');
    expect(models[1].priority).toBe(1);
    // auto_fallback 默认 true
    expect(result?.pool?.auto_fallback).toBe(true);
  });

  it('does not encrypt or decrypt api_key (preserves whatever form passed in)', () => {
    const plain: LegacyProviderEntry = { model: 'gpt-4o', api_key: 'plain-key', api_url: 'https://x' };
    const result = migratePool(plain);
    expect(result?.pool?.models[0].api_key).toBe('plain-key');

    const encrypted: LegacyProviderEntry = { model: 'gpt-4o', api_key: 'enc:abc123', api_url: 'https://x' };
    const result2 = migratePool(encrypted);
    expect(result2?.pool?.models[0].api_key).toBe('enc:abc123');
  });
});

describe('model-pool: findActiveEntry', () => {
  it('returns null for undefined/empty pool', () => {
    expect(findActiveEntry(undefined)).toBeNull();
    expect(findActiveEntry({ models: [] })).toBeNull();
    expect(findActiveEntry({ models: [{ id: 'a', model: 'x', api_url: '', enabled: false, priority: 0 }] })).toBeNull();
  });

  it('prefers active_model_id when set and enabled', () => {
    const pool: ModelPool = {
      models: [
        { id: 'a', model: 'm-a', api_url: 'u-a', enabled: true, priority: 0 },
        { id: 'b', model: 'm-b', api_url: 'u-b', enabled: true, priority: 1 },
      ],
      active_model_id: 'b',
    };
    const active = findActiveEntry(pool)!;
    expect(active.id).toBe('b');
  });

  it('falls back to priority when active_model_id is disabled', () => {
    const pool: ModelPool = {
      models: [
        { id: 'a', model: 'm-a', api_url: 'u-a', enabled: false, priority: 0 },
        { id: 'b', model: 'm-b', api_url: 'u-b', enabled: true, priority: 5 },
        { id: 'c', model: 'm-c', api_url: 'u-c', enabled: true, priority: 1 },
      ],
      active_model_id: 'a', // disabled
    };
    const active = findActiveEntry(pool)!;
    expect(active.id).toBe('c'); // priority 1 wins
  });
});

describe('model-pool: listEnabledEntries', () => {
  it('returns enabled entries sorted by priority', () => {
    const pool: ModelPool = {
      models: [
        { id: 'c', model: 'm-c', api_url: '', enabled: true, priority: 2 },
        { id: 'a', model: 'm-a', api_url: '', enabled: true, priority: 0 },
        { id: 'd', model: 'm-d', api_url: '', enabled: false, priority: 1 },
        { id: 'b', model: 'm-b', api_url: '', enabled: true, priority: 1 },
      ],
    };
    const list = listEnabledEntries(pool);
    expect(list.map(m => m.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('model-pool: pickModel', () => {
  const legacyEntry: LegacyProviderEntry = {
    api_url: 'https://legacy-url',
    api_key: 'legacy-key',
    model: 'legacy-model',
    vision_model: 'legacy-vision',
  };

  it('returns null when pool empty and no legacy fields', () => {
    expect(pickModel(undefined, { model: '', api_url: '', api_key: '' })).toBeNull();
    expect(pickModel(undefined, undefined)).toBeNull();
  });

  it('returns active entry from pool when pool exists', () => {
    const pool: ModelPool = {
      models: [
        { id: 'a', model: 'm-a', api_url: 'u-a', api_key: 'pool-key-a', enabled: true, priority: 0 },
        { id: 'b', model: 'm-b', api_url: '', enabled: true, priority: 1 }, // 空 api_url → 用 legacy 兜底
      ],
      active_model_id: 'a',
    };
    const r = pickModel(pool, legacyEntry, { legacyApiKey: 'legacy-key' });
    expect(r).not.toBeNull();
    expect(r!.id).toBe('a');
    expect(r!.model).toBe('m-a');
    expect(r!.api_url).toBe('u-a');
    expect(r!.api_key).toBe('pool-key-a');
    expect(r!.source).toBe('active');
  });

  it('uses legacy api_url/api_key when pool entry has empty api_url', () => {
    const pool: ModelPool = {
      models: [{ id: 'a', model: 'm-a', api_url: '', enabled: true, priority: 0 }],
      active_model_id: 'a',
    };
    const r = pickModel(pool, legacyEntry, { legacyApiKey: 'legacy-key' });
    expect(r!.api_url).toBe('https://legacy-url');
    expect(r!.api_key).toBe('legacy-key');
    expect(r!.vision_model).toBe('legacy-vision');
  });

  it('opts.modelId overrides active_model_id', () => {
    const pool: ModelPool = {
      models: [
        { id: 'a', model: 'm-a', api_url: 'u-a', enabled: true, priority: 0 },
        { id: 'b', model: 'm-b', api_url: 'u-b', enabled: true, priority: 1 },
      ],
      active_model_id: 'a',
    };
    const r = pickModel(pool, legacyEntry, { modelId: 'b', legacyApiKey: 'legacy-key' });
    expect(r!.id).toBe('b');
    expect(r!.source).toBe('request-override');
  });

  it('falls back to active when modelId not found', () => {
    const pool: ModelPool = {
      models: [{ id: 'a', model: 'm-a', api_url: 'u-a', enabled: true, priority: 0 }],
      active_model_id: 'a',
    };
    const r = pickModel(pool, legacyEntry, { modelId: 'nonexistent', legacyApiKey: 'legacy-key' });
    expect(r!.id).toBe('a');
  });

  it('falls back to legacy single-model when pool empty', () => {
    const r = pickModel(undefined, legacyEntry, { legacyApiKey: 'legacy-key', legacyApiUrl: 'https://legacy-url' });
    expect(r).not.toBeNull();
    expect(r!.id).toBe('legacy');
    expect(r!.model).toBe('legacy-model');
    expect(r!.api_url).toBe('https://legacy-url');
    expect(r!.api_key).toBe('legacy-key');
    expect(r!.source).toBe('legacy-single');
  });
});

describe('model-pool: listFailoverQueue', () => {
  it('returns queue with active first, others by priority', () => {
    const pool: ModelPool = {
      models: [
        { id: 'a', model: 'm-a', api_url: 'u-a', enabled: true, priority: 0 },
        { id: 'b', model: 'm-b', api_url: 'u-b', enabled: true, priority: 1 },
        { id: 'c', model: 'm-c', api_url: 'u-c', enabled: true, priority: 2 },
      ],
      active_model_id: 'b', // 用户手选 b, b 排第一
    };
    const queue = listFailoverQueue(pool, undefined, { legacyApiKey: 'k' });
    expect(queue.map(m => m.id)).toEqual(['b', 'a', 'c']);
  });

  it('returns legacy single when pool empty', () => {
    const legacy: LegacyProviderEntry = { model: 'lm', api_url: 'lu', api_key: 'lk' };
    const queue = listFailoverQueue(undefined, legacy, { legacyApiKey: 'lk' });
    expect(queue).toHaveLength(1);
    expect(queue[0].id).toBe('legacy');
    expect(queue[0].api_url).toBe('lu');
  });

  it('excludes disabled entries', () => {
    const pool: ModelPool = {
      models: [
        { id: 'a', model: 'm-a', api_url: 'u-a', enabled: true, priority: 0 },
        { id: 'b', model: 'm-b', api_url: 'u-b', enabled: false, priority: 1 },
      ],
      active_model_id: 'a',
    };
    const queue = listFailoverQueue(pool, undefined, { legacyApiKey: 'k' });
    expect(queue.map(m => m.id)).toEqual(['a']);
  });
});

describe('model-pool: resolveEntry', () => {
  it('prefers entry.api_key over legacy', () => {
    const r = resolveEntry(
      { id: 'x', model: 'm', api_url: 'u', api_key: 'enc:key', enabled: true, priority: 0 },
      { legacyApiKey: 'legacy-key', legacyApiUrl: 'lu' },
    );
    expect(r.api_key).toBe('enc:key');
    expect(r.api_url).toBe('u');
  });

  it('falls back to legacy when entry fields empty', () => {
    const r = resolveEntry(
      { id: 'x', model: 'm', api_url: '', api_key: '', enabled: true, priority: 0 },
      { legacyApiKey: 'legacy-key', legacyApiUrl: 'legacy-url', legacyVisionModel: 'vm' },
    );
    expect(r.api_url).toBe('legacy-url');
    expect(r.api_key).toBe('legacy-key');
    expect(r.vision_model).toBe('vm');
  });
});

describe('model-pool: generateModelId', () => {
  it('generates unique ids', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const id = generateModelId('p');
      expect(id.startsWith('p-')).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});
