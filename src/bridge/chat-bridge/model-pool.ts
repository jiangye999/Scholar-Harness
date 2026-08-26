/**
 * Model Pool: 多模型池 + 手动切换 + 自动故障切换的基础设施
 *
 * 设计目标:
 * - 兼容老的 "单模型" 配置 (primary/secondary/secondary_vision 的扁平字段)
 * - 新增 pool?: ModelPool, 包含多个候选 ModelEntry + active_model_id + auto_fallback
 * - 读取层 "pool 优先 → 老字段兜底", 删配置文件能正常工作
 *
 * 注意:
 * - api_key 字段在 pool.models[*].api_key 中保持加密形态 (落盘), 内存中由调用方解密
 *   这里不做加密/解密, 交由 ChatBridgeAdapter.loadConfig() 统一处理
 */

import { logger } from '../../utils/logger';

export interface ModelEntry {
  /** 稳定 id, 用于跨保存周期引用, 如 "p1", "legacy" */
  id: string;
  /** 用户起的名字, 如 "Claude 官方" / "OpenRouter 中转" */
  label?: string;
  /** 实际模型名, 如 "claude-sonnet-4-5" */
  model: string;
  /** API base url. 空字符串表示 "继承档位默认" (老配置兼容) */
  api_url: string;
  /** 密文存储的 api_key (与 ChatBridgeConfig 加密机制一致) */
  api_key?: string;
  /** 仅 secondary 档位使用; 视觉模型名 */
  vision_model?: string;
  /** 是否启用. false 的不会被 pickModel 选中 */
  enabled: boolean;
  /** fallback 顺序, 0 最优先. 同 priority 按数组顺序 */
  priority: number;
}

export interface ModelPool {
  /** 候选池 */
  models: ModelEntry[];
  /** 用户手选的当前激活模型 id. 缺失时取 enabled && priority 最小 */
  active_model_id?: string;
  /** 是否启用故障自动切换, 默认 true */
  auto_fallback?: boolean;
}

/**
 * 解析后的可用模型. api_key 已解密, 可直接喂给 callChatCompletion
 */
export interface ResolvedModel {
  id: string;
  model: string;
  api_url: string;
  api_key: string;
  vision_model?: string;
  label?: string;
  /** 选中原因 */
  source: 'active' | 'priority-fallback' | 'legacy-single' | 'request-override';
}

/** 老字段入口 (primary/secondary/secondary_vision 的扁平结构) */
export interface LegacyProviderEntry {
  api_url?: string;
  api_key?: string;
  model?: string;
  vision_model?: string;
  description?: string;
  pool?: ModelPool;
}

/**
 * 把老的 "单模型" 配置迁移成 pool 形态.
 * 已有 pool.models 非空 → 直接返回, 不动.
 * 没有 pool 但有 model → 包装成单元素 pool.
 *
 * 不修改 api_key 的加密形态. loadConfig() 已经在调用前解密过老字段,
 * 这里如果发现 api_key 已是明文 (loadConfig 解密后), 会原样塞进 pool.models[0].api_key,
 * 后续保存时由 routes/chat-bridge.ts 的 encrypt 流程重新加密.
 */
export function migratePool(entry: LegacyProviderEntry | undefined): LegacyProviderEntry | undefined {
  if (!entry) return entry;

  // 已有 pool 且非空, 校验 id 唯一性 + 补字段
  if (entry.pool && Array.isArray(entry.pool.models) && entry.pool.models.length > 0) {
    const seen = new Set<string>();
    let nextId = 1;
    entry.pool.models = entry.pool.models.map((m) => {
      let id = (typeof m.id === 'string' && m.id ? m.id : `m${nextId++}`);
      while (seen.has(id)) id = `m${nextId++}`;
      seen.add(id);
      return {
        id,
        label: m.label,
        model: typeof m.model === 'string' ? m.model : '',
        api_url: typeof m.api_url === 'string' ? m.api_url : '',
        api_key: m.api_key,
        vision_model: m.vision_model,
        enabled: m.enabled !== false,
        priority: typeof m.priority === 'number' ? m.priority : 0,
      };
    });
    if (entry.pool.auto_fallback === undefined) {
      entry.pool.auto_fallback = true;
    }
    return entry;
  }

  // 没有 pool, 但有 model/api_url → 包装成单元素 pool (legacy id)
  if (entry.model || entry.api_url || entry.api_key) {
    entry.pool = {
      models: [
        {
          id: 'legacy',
          label: undefined,
          model: entry.model || '',
          api_url: entry.api_url || '',
          api_key: entry.api_key,
          vision_model: entry.vision_model,
          enabled: true,
          priority: 0,
        },
      ],
      active_model_id: 'legacy',
      auto_fallback: true,
    };
    return entry;
  }

  // 空档位, 不动
  return entry;
}

/**
 * 从 pool.models 找出激活的 (用户手选). 不做 fallback.
 */
export function findActiveEntry(pool: ModelPool | undefined): ModelEntry | null {
  if (!pool || !Array.isArray(pool.models) || pool.models.length === 0) return null;
  const enabled = pool.models.filter((m) => m.enabled);
  if (enabled.length === 0) return null;
  if (pool.active_model_id) {
    const hit = enabled.find((m) => m.id === pool.active_model_id);
    if (hit) return hit;
  }
  // active 失效, 回退到 priority 最小
  return enabled.slice().sort((a, b) => a.priority - b.priority)[0] || null;
}

/**
 * 列出所有启用模型, 按 priority 升序. 用于故障切换队列.
 */
export function listEnabledEntries(pool: ModelPool | undefined): ModelEntry[] {
  if (!pool || !Array.isArray(pool.models) || pool.models.length === 0) return [];
  return pool.models
    .filter((m) => m.enabled)
    .sort((a, b) => a.priority - b.priority);
}

/**
 * 把 ModelEntry 转成 ResolvedModel. 调用方负责解密 api_key.
 *
 * @param entry pool 中的条目
 * @param decryptedApiKey 已解密的 api_key. 优先使用 entry.api_key, 缺失时回退到 legacyFallback
 * @param legacyFallback 老档位字段的已解密 api_key / api_url, 用于 entry 字段为空时兜底
 * @param source 选中原因
 */
export function resolveEntry(
  entry: ModelEntry,
  opts: {
    decryptedApiKey?: string;
    legacyApiUrl?: string;
    legacyApiKey?: string;
    legacyVisionModel?: string;
    source?: ResolvedModel['source'];
  } = {},
): ResolvedModel {
  const apiKey =
    (entry.api_key && entry.api_key.length > 0 ? entry.api_key : opts.legacyApiKey) || '';
  const apiUrl = (entry.api_url && entry.api_url.length > 0 ? entry.api_url : opts.legacyApiUrl) || '';
  const visionModel = entry.vision_model || opts.legacyVisionModel;
  return {
    id: entry.id,
    model: entry.model,
    api_url: apiUrl,
    api_key: apiKey,
    vision_model: visionModel,
    label: entry.label,
    source: opts.source || 'active',
  };
}

/**
 * 主入口: 选出一个 ResolvedModel.
 *
 * 优先级:
 * 1. opts.modelId 显式指定 (前端手动切换)
 * 2. pool.active_model_id
 * 3. pool 中 priority 最小的 enabled 模型
 * 4. 老字段 legacyEntry.model / api_url / api_key
 *
 * @param pool 档位 pool, 可能为空
 * @param legacyEntry 老字段 (primary/secondary/secondary_vision)
 * @param opts decryptedApiKey 等已解密字段 + 可选 modelId
 */
export function pickModel(
  pool: ModelPool | undefined,
  legacyEntry: LegacyProviderEntry | undefined,
  opts: {
    modelId?: string;
    decryptedApiKey?: string;
    legacyApiKey?: string;
    legacyApiUrl?: string;
    legacyVisionModel?: string;
  } = {},
): ResolvedModel | null {
  // 1. 显式指定 id
  if (opts.modelId && pool) {
    const hit = pool.models.find((m) => m.id === opts.modelId && m.enabled);
    if (hit) {
      return resolveEntry(hit, {
        decryptedApiKey: opts.decryptedApiKey,
        legacyApiUrl: opts.legacyApiUrl || legacyEntry?.api_url,
        legacyApiKey: opts.legacyApiKey,
        legacyVisionModel: opts.legacyVisionModel || legacyEntry?.vision_model,
        source: 'request-override',
      });
    }
    logger.warn(`[ModelPool] modelId=${opts.modelId} not found or disabled, falling back to active`);
  }

  // 2/3. pool 激活或 priority 兜底
  const active = findActiveEntry(pool);
  if (active) {
    return resolveEntry(active, {
      decryptedApiKey: opts.decryptedApiKey,
      legacyApiUrl: opts.legacyApiUrl || legacyEntry?.api_url,
      legacyApiKey: opts.legacyApiKey,
      legacyVisionModel: opts.legacyVisionModel || legacyEntry?.vision_model,
      source: pool?.active_model_id === active.id ? 'active' : 'priority-fallback',
    });
  }

  // 4. 老字段兜底 (单模型配置)
  if (legacyEntry && (legacyEntry.model || legacyEntry.api_url || legacyEntry.api_key)) {
    return {
      id: 'legacy',
      model: legacyEntry.model || '',
      api_url: legacyEntry.api_url || opts.legacyApiUrl || '',
      api_key: opts.legacyApiKey || '',
      vision_model: legacyEntry.vision_model || opts.legacyVisionModel,
      source: 'legacy-single',
    };
  }

  return null;
}

/**
 * 列出故障切换队列. 激活模型排第一, 其余按 priority.
 * 用于 chatWithFailover.
 */
export function listFailoverQueue(
  pool: ModelPool | undefined,
  legacyEntry: LegacyProviderEntry | undefined,
  opts: {
    decryptedApiKey?: string;
    legacyApiKey?: string;
    legacyApiUrl?: string;
    legacyVisionModel?: string;
  } = {},
): ResolvedModel[] {
  const queue: ResolvedModel[] = [];
  const seenIds = new Set<string>();

  if (pool && pool.models.length > 0) {
    const active = findActiveEntry(pool);
    if (active) {
      queue.push(resolveEntry(active, {
        decryptedApiKey: opts.decryptedApiKey,
        legacyApiUrl: opts.legacyApiUrl || legacyEntry?.api_url,
        legacyApiKey: opts.legacyApiKey,
        legacyVisionModel: opts.legacyVisionModel || legacyEntry?.vision_model,
        source: 'active',
      }));
      seenIds.add(active.id);
    }
    for (const m of listEnabledEntries(pool)) {
      if (seenIds.has(m.id)) continue;
      queue.push(resolveEntry(m, {
        decryptedApiKey: opts.decryptedApiKey,
        legacyApiUrl: opts.legacyApiUrl || legacyEntry?.api_url,
        legacyApiKey: opts.legacyApiKey,
        legacyVisionModel: opts.legacyVisionModel || legacyEntry?.vision_model,
        source: 'priority-fallback',
      }));
      seenIds.add(m.id);
    }
  }

  // 老字段兜底 (如果 pool 没有可用条目)
  if (queue.length === 0 && legacyEntry && (legacyEntry.model || legacyEntry.api_url || legacyEntry.api_key)) {
    queue.push({
      id: 'legacy',
      model: legacyEntry.model || '',
      api_url: legacyEntry.api_url || opts.legacyApiUrl || '',
      api_key: opts.legacyApiKey || '',
      vision_model: legacyEntry.vision_model || opts.legacyVisionModel,
      source: 'legacy-single',
    });
  }

  return queue;
}

/**
 * 生成稳定 id (前端临时也用这套规则). 后端 loadConfig 时会校验唯一性.
 */
export function generateModelId(prefix: string = 'm'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
