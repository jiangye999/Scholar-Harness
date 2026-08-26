/**
 * 多用户检索引擎管理器
 * 
 * 解决问题 C5: 多用户数据隔离
 * 
 * 为每个用户维护独立的 HybridRetrievalEngine 实例，
 * 确保用户 A 的文献不会被用户 B 检索到。
 */

import { HybridRetrievalEngine } from '../literature/retrieval';
import { getIndexCacheDir, getUserLiteraturePath } from './paths';
import { normalizePapers } from './literature-helpers';
import { logger } from './logger';
import * as fs from 'fs';
import * as path from 'path';
import { getProjectRuntimeContext } from './project-runtime-context';

interface EngineEntry {
  engine: HybridRetrievalEngine;
  lastAccess: number;
  userId: string;
  projectId?: string;
}

interface RetrievalEngineManagerOptions {
  apiUrl?: string;
  apiKey?: string;
  embeddingModel?: string;
  embeddingDimensions?: number;
  maxEngines?: number; // 最大缓存的引擎数量
  idleTimeoutMs?: number; // 空闲超时时间（毫秒）
}

/**
 * 检索引擎管理器
 * 
 * 特性：
 * - 每个用户独立的检索引擎实例
 * - LRU 缓存策略，自动清理长时间未使用的引擎
 * - 自动加载用户文献库和索引缓存
 */
export class RetrievalEngineManager {
  private engines: Map<string, EngineEntry> = new Map();
  private apiConfig: { url?: string; key?: string };
  private embeddingModel: string;
  private embeddingDimensions: number;
  private maxEngines: number;
  private idleTimeoutMs: number;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(options: RetrievalEngineManagerOptions = {}) {
    this.apiConfig = {
      url: options.apiUrl,
      key: options.apiKey,
    };
    this.embeddingModel = options.embeddingModel || 'text-embedding-v4';
    this.embeddingDimensions = options.embeddingDimensions || 1024;
    this.maxEngines = options.maxEngines || 10;
    this.idleTimeoutMs = options.idleTimeoutMs || 30 * 60 * 1000; // 默认 30 分钟
    
    // 启动定期清理任务
    this.startCleanupTask();
  }

  /**
   * 获取用户的检索引擎
   * 
   * 如果引擎不存在，会自动创建并加载用户文献
   */
  async getEngine(userId: string): Promise<HybridRetrievalEngine> {
    const projectId = getProjectRuntimeContext()?.projectId || '';
    const engineKey = `${projectId || 'current-workspace'}\u0001${userId}`;
    const entry = this.engines.get(engineKey);
    
    if (entry) {
      // 更新访问时间
      entry.lastAccess = Date.now();
      return entry.engine;
    }
    
    // 检查是否需要清理旧引擎
    if (this.engines.size >= this.maxEngines) {
      this.cleanupOldest();
    }
    
    // 创建新引擎
    const engine = await this.createEngineForUser(userId);
    
    this.engines.set(engineKey, {
      engine,
      lastAccess: Date.now(),
      userId,
      projectId: projectId || undefined,
    });
    
    logger.info(`[RetrievalManager] Created engine for user ${userId} (total: ${this.engines.size})`);
    
    return engine;
  }

  /**
   * 为用户创建并初始化检索引擎
   */
  private async createEngineForUser(userId: string): Promise<HybridRetrievalEngine> {
    const engine = new HybridRetrievalEngine({
      vector: {
        model: this.embeddingModel,
        dimensions: this.embeddingDimensions,
        topN: 50,
        similarity: 'cosine',
      },
    }, this.apiConfig);
    const cacheDir = getIndexCacheDir(userId);
    engine.setPersistenceDirectory(cacheDir);
    const literatureFile = getUserLiteraturePath(userId);
    
    // 尝试加载缓存的索引
    const loaded = engine.loadIndex(cacheDir);
    if (loaded) {
      logger.info(`[RetrievalManager] Loaded cached index for user ${userId} (${engine.getDocumentCount()} docs)`);
      return engine;
    }
    
    // 没有缓存，从 literature.json 构建
    if (fs.existsSync(literatureFile)) {
      try {
        const content = await fs.promises.readFile(literatureFile, 'utf-8');
        const data = JSON.parse(content);
        const papers = Array.isArray(data) ? data : (data.papers || []);
        
        if (papers.length > 0) {
          const literatures = normalizePapers(papers);
          await engine.index(literatures);
          
          // 保存缓存
          engine.saveIndex(cacheDir);
          logger.info(`[RetrievalManager] Built index for user ${userId} from literature.json (${literatures.length} docs)`);
        }
      } catch (error) {
        logger.error(`[RetrievalManager] Failed to load literature for user ${userId}:`, error);
      }
    }
    
    return engine;
  }

  /**
   * 更新 API 配置（所有现有引擎和新引擎都会使用）
   */
  updateApiConfig(config: { url?: string; key?: string; model?: string; dimensions?: number }): void {
    this.apiConfig = {
      url: config.url,
      key: config.key,
    };
    if (config.model) this.embeddingModel = config.model;
    if (config.dimensions && Number.isFinite(config.dimensions)) this.embeddingDimensions = config.dimensions;
    
    // 更新所有现有引擎的 API 配置
    for (const entry of this.engines.values()) {
      entry.engine.updateApiConfig(config);
    }
    
    logger.info(`[RetrievalManager] Updated API config for all engines`);
  }

  /**
   * 清理指定用户的引擎
   */
  clearUserEngine(userId: string): void {
    for (const [key, entry] of this.engines.entries()) {
      if (entry.userId !== userId) continue;
      entry.engine.clear();
      this.engines.delete(key);
    }
    logger.info(`[RetrievalManager] Cleared engines for user ${userId}`);
  }

  /**
   * 清理所有引擎
   */
  clearAll(): void {
    for (const entry of this.engines.values()) {
      entry.engine.clear();
    }
    this.engines.clear();
    logger.info(`[RetrievalManager] Cleared all engines`);
  }

  /**
   * 清理最久未使用的引擎
   */
  private cleanupOldest(): void {
    let oldest: EngineEntry | null = null;
    
    for (const entry of this.engines.values()) {
      if (!oldest || entry.lastAccess < oldest.lastAccess) {
        oldest = entry;
      }
    }
    
    if (oldest) {
      const oldestKey = Array.from(this.engines.entries()).find(([, entry]) => entry === oldest)?.[0];
      if (oldestKey) this.engines.delete(oldestKey);
      logger.info(`[RetrievalManager] Cleaned up oldest engine for user ${oldest.userId}`);
    }
  }

  /**
   * 清理空闲超时的引擎
   */
  private cleanupIdle(): void {
    const now = Date.now();
    const toDelete: string[] = [];
    
    for (const [engineKey, entry] of this.engines) {
      if (now - entry.lastAccess > this.idleTimeoutMs) {
        toDelete.push(engineKey);
      }
    }
    
    for (const engineKey of toDelete) {
      this.engines.delete(engineKey);
      logger.info(`[RetrievalManager] Cleaned up idle engine ${engineKey}`);
    }
  }

  /**
   * 启动定期清理任务
   */
  private startCleanupTask(): void {
    // 每 5 分钟检查一次空闲引擎
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdle();
    }, 5 * 60 * 1000);
  }

  /**
   * 停止定期清理任务
   */
  stopCleanupTask(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalEngines: number;
    maxEngines: number;
    users: Array<{ userId: string; docCount: number; lastAccess: Date }>;
  } {
    const users = Array.from(this.engines.entries()).map(([userId, entry]) => ({
      userId,
      docCount: entry.engine.getDocumentCount(),
      lastAccess: new Date(entry.lastAccess),
    }));
    
    return {
      totalEngines: this.engines.size,
      maxEngines: this.maxEngines,
      users,
    };
  }
}

// 全局单例
let globalManager: RetrievalEngineManager | null = null;

/**
 * 获取全局检索引擎管理器
 */
export function getRetrievalEngineManager(
  options?: RetrievalEngineManagerOptions
): RetrievalEngineManager {
  if (!globalManager) {
    globalManager = new RetrievalEngineManager(options);
  }
  return globalManager;
}

/**
 * 初始化全局检索引擎管理器
 */
export function initRetrievalEngineManager(
  options: RetrievalEngineManagerOptions
): RetrievalEngineManager {
  if (globalManager) {
    globalManager.stopCleanupTask();
  }
  globalManager = new RetrievalEngineManager(options);
  return globalManager;
}

export default {
  RetrievalEngineManager,
  getRetrievalEngineManager,
  initRetrievalEngineManager,
};
