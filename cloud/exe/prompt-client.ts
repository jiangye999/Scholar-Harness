/**
 * exe Prompt 客户端
 * 负责从云端获取加密 Prompt，本地缓存管理
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { AuthClient } from './auth-client';
import { buildApiUrl, ExeClientConfig } from './config';
import { logger } from '../utils/logger';

// ============ 类型定义 ============

export interface CachedPrompt {
  id: string;
  content: string;
  version: number;
  cachedAt: number;
  hash: string;
}

export interface PromptVersionInfo {
  skillsVersion: number;
  agentVersion: number;
  lastUpdated: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  category: string;
  version: number;
  language: string;
  lastUpdated: string;
}

export interface GeneratePromptResult {
  promptTemplate: string;
  skillId: string;
  creditsConsumed: number;
  quotaRemaining: number;
}

// ============ API 端点定义 ============

export const PROMPT_API_ENDPOINTS = {
  SKILLS_LIST: '/prompts/skills',
  SKILL_GET: '/prompts/skills',  // + /:id
  VERSION: '/prompts/version',
  CACHE: '/prompts/cache',
  GENERATE: '/prompts/generate',
  WRITE: '/prompts/write',
};

// ============ 缓存配置 ============

const CACHE_CONFIG = {
  cacheExpiryMs: 48 * 60 * 60 * 1000,  // 48小时缓存有效期
  versionCheckIntervalMs: 6 * 60 * 60 * 1000,  // 每6小时检查版本
};

// ============ Prompt 客户端 ============

export class PromptClient {
  private authClient: AuthClient;
  private config: ExeClientConfig;
  private cacheDir: string;
  private deviceId: string;
  
  constructor(authClient: AuthClient, config: ExeClientConfig) {
    this.authClient = authClient;
    this.config = config;
    this.cacheDir = path.join(process.cwd(), 'data', 'prompt-cache');
    this.deviceId = '';  // 运行时初始化
  }
  
  /**
   * 初始化客户端
   */
  async initialize(): Promise<void> {
    this.deviceId = await this.authClient.getDeviceId();
    await this.ensureCacheDir();
    logger.info('[PromptClient] Initialized');
  }
  
  /**
   * 确保缓存目录存在
   */
  private async ensureCacheDir(): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
    } catch (error) {
      logger.error('[PromptClient] Failed to create cache dir:', error);
    }
  }
  
  /**
   * 获取 Skill（优先本地缓存）
   */
  async getSkill(skillId: string): Promise<{ content: string; version: number }> {
    // 1. 尝试本地缓存
    const cached = await this.loadFromCache(skillId);
    
    if (cached && !this.isCacheExpired(cached)) {
      // 2. 检查版本是否需要更新（仅在非离线时）
      const needsUpdate = await this.checkVersionUpdate(cached.version);
      
      if (!needsUpdate) {
        logger.info(`[PromptClient] Using cached skill: ${skillId}`);
        return { content: cached.content, version: cached.version };
      }
    }
    
    // 3. 从云端获取
    logger.info(`[PromptClient] Fetching skill from cloud: ${skillId}`);
    return await this.fetchFromCloud(skillId);
  }
  
  /**
   * 从云端获取 Skill
   */
  private async fetchFromCloud(skillId: string): Promise<{ content: string; version: number }> {
    const session = await this.authClient.getSessionManager().getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }
    
    const url = buildApiUrl(`${PROMPT_API_ENDPOINTS.SKILL_GET}/${skillId}`, this.config);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
      },
    });
    
    if (!response.ok) {
      if (response.status === 401) {
        // 尝试刷新 token
        const refreshed = await this.authClient.refreshToken();
        if (refreshed) {
          return await this.fetchFromCloud(skillId);  // 重试
        }
      }
      throw new Error(`Failed to fetch skill: ${response.status}`);
    }
    
    const data = await response.json() as {
      content: string;
      version: number;
      hash: string;
      id: string;
      name: string;
    };
    
    // 验证内容哈希
    const computedHash = crypto.createHash('sha256').update(data.content).digest('hex');
    if (computedHash !== data.hash) {
      logger.error(`[PromptClient] Hash mismatch for skill ${skillId}`);
      throw new Error('Prompt content integrity check failed');
    }
    
    // 保存到本地缓存
    await this.saveToCache(skillId, data.content, data.version, data.hash);
    
    return { content: data.content, version: data.version };
  }
  
  /**
   * 批量预缓存 Skills（用于离线准备）
   */
  async prefetchSkills(skillIds: string[]): Promise<void> {
    const session = await this.authClient.getSessionManager().getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }
    
    logger.info(`[PromptClient] Prefetching ${skillIds.length} skills...`);
    
    const url = buildApiUrl(PROMPT_API_ENDPOINTS.CACHE, this.config);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ skillIds }),
    });
    
    if (!response.ok) {
      throw new Error(`Failed to prefetch skills: ${response.status}`);
    }
    
    const data = await response.json() as {
      skills: Array<{ id: string; content: string; version: number; hash: string }>;
      version: number;
      cacheExpiry: string;
    };
    
    // 保存所有到缓存
    for (const skill of data.skills) {
      await this.saveToCache(skill.id, skill.content, skill.version, skill.hash);
    }
    
    // 保存版本信息
    await this.saveVersionInfo(data.version);
    
    logger.info(`[PromptClient] Prefetched ${data.skills.length} skills, cache valid until ${data.cacheExpiry}`);
  }
  
  /**
   * 获取生成 Prompt（消耗额度）
   */
  async getGeneratePrompt(input: {
    chapterName: string;
    userPlan: {
      writingFocus: string;
      keyPoints: string[];
      specialRequirements?: string;
      wordCountTarget?: number;
    };
    researchContent: string;
    targetJournal?: string;
    userSkillId?: string;
  }): Promise<GeneratePromptResult> {
    const session = await this.authClient.getSessionManager().getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }
    
    const url = buildApiUrl(PROMPT_API_ENDPOINTS.GENERATE, this.config);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(input),
    });
    
    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(error.message || `Failed to generate prompt: ${response.status}`);
    }
    
    const data = await response.json() as GeneratePromptResult;
    
    // 更新本地额度缓存
    await this.authClient.getSessionManager().updateSubscriptionCache({
      quota_remaining: data.quotaRemaining,
    });
    
    logger.info(`[PromptClient] Generated prompt, consumed ${data.creditsConsumed} credits`);
    
    return data;
  }
  
  /**
   * 获取写作 Prompt（消耗额度）
   */
  async getWritePrompt(input: {
    chapterName: string;
    skill: Record<string, unknown>;
    literatureCount: number;
  }): Promise<{ promptTemplate: string; creditsConsumed: number; quotaRemaining: number }> {
    const session = await this.authClient.getSessionManager().getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }
    
    const url = buildApiUrl(PROMPT_API_ENDPOINTS.WRITE, this.config);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify(input),
    });
    
    if (!response.ok) {
      const error = await response.json() as { message?: string };
      throw new Error(error.message || `Failed to get write prompt: ${response.status}`);
    }
    
    const data = await response.json() as {
      promptTemplate: string;
      creditsConsumed: number;
      quotaRemaining: number;
    };
    
    // 更新本地额度缓存
    await this.authClient.getSessionManager().updateSubscriptionCache({
      quota_remaining: data.quotaRemaining,
    });
    
    return data;
  }
  
  /**
   * 获取所有可用 Skills 列表
   */
  async getSkillsList(): Promise<SkillInfo[]> {
    const session = await this.authClient.getSessionManager().getSession();
    if (!session) {
      throw new Error('Not authenticated');
    }
    
    const url = buildApiUrl(PROMPT_API_ENDPOINTS.SKILLS_LIST, this.config);
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${session.accessToken}`,
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to get skills list: ${response.status}`);
    }
    
    const data = await response.json() as { skills: SkillInfo[] };
    return data.skills;
  }
  
  /**
   * 检查版本是否需要更新
   */
  private async checkVersionUpdate(localVersion: number): Promise<boolean> {
    // 离线时不检查
    const inGrace = await this.authClient.getSessionManager().isWithinOfflineGracePeriod();
    if (!inGrace) {
      try {
        const session = await this.authClient.getSessionManager().getSession();
        if (!session) return false;
        
        const url = buildApiUrl(PROMPT_API_ENDPOINTS.VERSION, this.config);
        
        const response = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${session.accessToken}`,
          },
        });
        
        if (response.ok) {
          const data = await response.json() as PromptVersionInfo;
          return data.skillsVersion > localVersion;
        }
      } catch {
        // 网络失败，不更新
      }
    }
    
    return false;
  }
  
  /**
   * 加载本地缓存
   */
  private async loadFromCache(skillId: string): Promise<CachedPrompt | null> {
    try {
      const cachePath = path.join(this.cacheDir, `${skillId}.cache`);
      const encryptedData = await fs.readFile(cachePath);
      
      // 解密缓存（使用设备 ID 派生密钥）
      const decrypted = this.decryptCacheData(encryptedData);
      const parsed = JSON.parse(decrypted) as CachedPrompt;
      
      // 验证哈希
      const computedHash = crypto.createHash('sha256').update(parsed.content).digest('hex');
      if (computedHash !== parsed.hash) {
        logger.warn(`[PromptClient] Cache integrity check failed for ${skillId}`);
        return null;
      }
      
      return parsed;
    } catch {
      return null;
    }
  }
  
  /**
   * 保存到本地缓存（加密）
   */
  private async saveToCache(
    skillId: string,
    content: string,
    version: number,
    hash: string
  ): Promise<void> {
    try {
      const cacheData: CachedPrompt = {
        id: skillId,
        content,
        version,
        cachedAt: Date.now(),
        hash,
      };
      
      const encrypted = this.encryptCacheData(JSON.stringify(cacheData));
      const cachePath = path.join(this.cacheDir, `${skillId}.cache`);
      
      await fs.writeFile(cachePath, encrypted);
      logger.info(`[PromptClient] Cached skill: ${skillId} v${version}`);
    } catch (error) {
      logger.error(`[PromptClient] Failed to cache skill ${skillId}:`, error);
    }
  }
  
  /**
   * 检查缓存是否过期
   */
  private isCacheExpired(cached: CachedPrompt): boolean {
    return Date.now() - cached.cachedAt > CACHE_CONFIG.cacheExpiryMs;
  }
  
  /**
   * 保存版本信息
   */
  private async saveVersionInfo(version: number): Promise<void> {
    try {
      const versionPath = path.join(this.cacheDir, 'version.json');
      await fs.writeFile(versionPath, JSON.stringify({ version, updatedAt: Date.now() }));
    } catch {
      // 忽略错误
    }
  }
  
  /**
   * 从设备 ID 派生缓存加密密钥
   */
  private deriveCacheKey(): Buffer {
    const salt = 'scholar-harness-prompt-cache-v1';
    return crypto.createHash('sha256')
      .update(this.deviceId + salt)
      .digest()
      .slice(0, 32);
  }
  
  /**
   * 加密缓存数据
   */
  private encryptCacheData(data: string): Buffer {
    const key = this.deriveCacheKey();
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    
    let encrypted = cipher.update(data, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return Buffer.concat([iv, encrypted]);
  }
  
  /**
   * 解密缓存数据
   */
  private decryptCacheData(data: Buffer): string {
    const key = this.deriveCacheKey();
    
    const iv = data.slice(0, 16);
    const encrypted = data.slice(16);
    
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }
  
  /**
   * 清除缓存
   */
  async clearCache(): Promise<void> {
    try {
      const files = await fs.readdir(this.cacheDir);
      for (const file of files) {
        if (file.endsWith('.cache')) {
          await fs.unlink(path.join(this.cacheDir, file));
        }
      }
      logger.info('[PromptClient] Cache cleared');
    } catch {
      // 目录不存在时忽略
    }
  }
}

export default PromptClient;