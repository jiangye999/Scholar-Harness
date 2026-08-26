/**
 * 模型健康状态存储 (步骤 3 的核心数据结构)
 *
 * 行为:
 * - 每个 provider 维护一个 Map<entryId, ModelHealth>
 * - 失败时 markUnhealthy(id, cooldownMs) 设定冷却期, 冷却期内 listFailoverQueue 跳过该 entry
 * - 成功时 markHealthy(id) 清除失败状态
 * - 前端 GET /api/chat-bridge/pool/health 读此 store
 *
 * 注意: 内存态, 进程重启后清空 (重启后所有模型回到 unknown, 不持久化冷却状态)
 */

import type { ModelPool } from './model-pool';

export type ProviderKey = 'primary' | 'secondary' | 'secondary_vision';
export type HealthStatus = 'unknown' | 'healthy' | 'unhealthy';

export interface ModelHealth {
  id: string;
  model: string;
  status: HealthStatus;
  lastSuccessAt?: number;
  lastErrorAt?: number;
  lastErrorMessage?: string;
  /** 冷却到该时间戳前, 不会被 failover 队列选中 */
  unhealthyUntil?: number;
  consecutiveFailures: number;
}

class ModelHealthStore {
  private store: Map<ProviderKey, Map<string, ModelHealth>> = new Map();

  constructor() {
    this.store.set('primary', new Map());
    this.store.set('secondary', new Map());
    this.store.set('secondary_vision', new Map());
  }

  /**
   * 初始化 pool 中所有 entry 的健康状态 (loadConfig 后调用)
   * 不覆盖已有的状态, 只补全缺失
   */
  syncFromPool(provider: ProviderKey, pool: ModelPool | undefined): void {
    const map = this.store.get(provider);
    if (!map) return;
    if (!pool || !Array.isArray(pool.models)) {
      map.clear();
      return;
    }
    const currentIds = new Set(pool.models.map(m => m.id));
    // 删除不存在的 entry
    for (const [id] of map.entries()) {
      if (!currentIds.has(id)) map.delete(id);
    }
    // 补全新 entry
    for (const m of pool.models) {
      if (!map.has(m.id)) {
        map.set(m.id, {
          id: m.id,
          model: m.model,
          status: 'unknown',
          consecutiveFailures: 0,
        });
      } else {
        // 模型名可能变了
        const h = map.get(m.id)!;
        h.model = m.model;
      }
    }
  }

  markHealthy(provider: ProviderKey, entryId: string): void {
    const map = this.store.get(provider);
    if (!map) return;
    const h = map.get(entryId);
    if (!h) {
      map.set(entryId, { id: entryId, model: '', status: 'healthy', lastSuccessAt: Date.now(), consecutiveFailures: 0 });
      return;
    }
    h.status = 'healthy';
    h.lastSuccessAt = Date.now();
    h.lastErrorMessage = undefined;
    h.unhealthyUntil = undefined;
    h.consecutiveFailures = 0;
  }

  markUnhealthy(provider: ProviderKey, entryId: string, reason: string, cooldownMs: number = 60_000): void {
    const map = this.store.get(provider);
    if (!map) return;
    const now = Date.now();
    let h = map.get(entryId);
    if (!h) {
      h = { id: entryId, model: '', status: 'unhealthy', lastErrorAt: now, lastErrorMessage: reason, consecutiveFailures: 1, unhealthyUntil: now + cooldownMs };
      map.set(entryId, h);
      return;
    }
    h.status = 'unhealthy';
    h.lastErrorAt = now;
    h.lastErrorMessage = reason;
    h.consecutiveFailures = (h.consecutiveFailures || 0) + 1;
    // 指数退避: 第 N 次失败冷却 min(cooldownMs * 2^(N-1), 30min)
    const backoff = Math.min(cooldownMs * Math.pow(2, h.consecutiveFailures - 1), 30 * 60 * 1000);
    h.unhealthyUntil = now + backoff;
  }

  /** 检查 entry 是否在冷却期内 (步骤 3 failover 跳过用) */
  isCoolingDown(provider: ProviderKey, entryId: string): boolean {
    const map = this.store.get(provider);
    if (!map) return false;
    const h = map.get(entryId);
    if (!h) return false;
    if (!h.unhealthyUntil) return false;
    if (Date.now() >= h.unhealthyUntil) {
      // 冷却结束, 状态回到 unknown, 允许重试
      h.status = 'unknown';
      h.unhealthyUntil = undefined;
      return false;
    }
    return true;
  }

  getProviderHealth(provider: ProviderKey): ModelHealth[] {
    const map = this.store.get(provider);
    if (!map) return [];
    // 刷新过期冷却状态后再返回
    for (const [, h] of map.entries()) {
      if (h.unhealthyUntil && Date.now() >= h.unhealthyUntil) {
        h.status = 'unknown';
        h.unhealthyUntil = undefined;
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      // 按 status 排序: healthy < unknown < unhealthy
      const order = { healthy: 0, unknown: 1, unhealthy: 2 } as const;
      return order[a.status] - order[b.status];
    });
  }

  /** 清空所有状态 (用于测试) */
  clear(): void {
    for (const map of this.store.values()) map.clear();
  }
}

export const modelHealthStore = new ModelHealthStore();
