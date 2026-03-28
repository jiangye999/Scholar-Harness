import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import type { UserState } from '../types';

// 会话默认过期时间（毫秒）- 7天
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class SessionStore {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private getFilePath(userId: string): string {
    return path.join(this.dataDir, `${userId}.json`);
  }

  async save(userId: string, state: UserState): Promise<void> {
    const filePath = this.getFilePath(userId);
    
    // Ensure directory exists
    await fs.mkdir(this.dataDir, { recursive: true });
    
    // Save state with updated timestamp
    const data = {
      ...state,
      createdAt: state.createdAt instanceof Date 
        ? state.createdAt.toISOString() 
        : state.createdAt,
      updatedAt: new Date().toISOString(),
    };
    
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async load(userId: string): Promise<UserState | null> {
    const filePath = this.getFilePath(userId);
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      
      // 检查会话是否过期
      const updatedAt = new Date(data.updatedAt);
      if (Date.now() - updatedAt.getTime() > SESSION_TTL_MS) {
        await this.delete(userId);
        return null;
      }
      
      // Restore Map objects from plain objects
      if (data.chapterPlans && typeof data.chapterPlans === 'object') {
        data.chapterPlans = new Map(Object.entries(data.chapterPlans));
      }
      if (data.writingProgress && typeof data.writingProgress === 'object') {
        data.writingProgress = new Map(Object.entries(data.writingProgress));
      }
      
      // Restore Date objects
      data.createdAt = new Date(data.createdAt);
      data.updatedAt = new Date(data.updatedAt);
      
      return data as UserState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async delete(userId: string): Promise<void> {
    const filePath = this.getFilePath(userId);
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // 文件不存在时忽略错误
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  async list(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.dataDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  // 清理过期会话
  async cleanExpired(): Promise<number> {
    const userIds = await this.list();
    let cleaned = 0;
    
    for (const userId of userIds) {
      const state = await this.load(userId);
      // load 内部已处理过期逻辑，如果返回 null 则已清理
      if (!state) {
        cleaned++;
      }
    }
    
    return cleaned;
  }

  // 保存草稿到独立文件
  async saveDraft(userId: string, chapterName: string, content: string): Promise<void> {
    const userDraftsDir = path.join(this.dataDir, userId, 'drafts');
    await fs.mkdir(userDraftsDir, { recursive: true });
    
    const draftFile = path.join(userDraftsDir, `${chapterName}.json`);
    const draftData = {
      chapterName,
      content,
      savedAt: new Date().toISOString(),
    };
    
    await fs.writeFile(draftFile, JSON.stringify(draftData, null, 2), 'utf-8');
    logger.info(`[SessionStore] Draft saved for user ${userId}, chapter: ${chapterName}`);
  }

  // 加载草稿
  async loadDraft(userId: string, chapterName: string): Promise<{ content: string; savedAt: string } | null> {
    const draftFile = path.join(this.dataDir, userId, 'drafts', `${chapterName}.json`);
    
    try {
      const content = await fs.readFile(draftFile, 'utf-8');
      const data = JSON.parse(content);
      return {
        content: data.content,
        savedAt: data.savedAt,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  // 列出所有草稿
  async listDrafts(userId: string): Promise<Array<{ chapterName: string; savedAt: string }>> {
    const userDraftsDir = path.join(this.dataDir, userId, 'drafts');
    
    try {
      const files = await fs.readdir(userDraftsDir);
      const drafts = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const filePath = path.join(userDraftsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        drafts.push({
          chapterName: data.chapterName,
          savedAt: data.savedAt,
        });
      }
      
      return drafts.sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  // 删除草稿
  async deleteDraft(userId: string, chapterName: string): Promise<void> {
    const draftFile = path.join(this.dataDir, userId, 'drafts', `${chapterName}.json`);
    try {
      await fs.unlink(draftFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
