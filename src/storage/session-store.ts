import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { sanitizeUserId } from '../utils/paths';
import type { UserState } from '../types';

const DEFAULT_DRAFT_CHAPTER_NAME = 'section';

export function sanitizeDraftChapterName(chapterName: unknown): string {
  const raw = String(chapterName || DEFAULT_DRAFT_CHAPTER_NAME).trim();
  const cleaned = raw
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
    return `${cleaned}_`;
  }
  return cleaned || DEFAULT_DRAFT_CHAPTER_NAME;
}

export class SessionStore {
  private dataDir: string;

  constructor(dataDir: string) {
    this.dataDir = dataDir;
  }

  private getFilePath(userId: string): string {
    return path.join(this.dataDir, `${sanitizeUserId(userId)}.json`);
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

  // 历史会话永久保留；仅保留该方法用于兼容旧调用。
  async cleanExpired(): Promise<number> {
    return 0;
  }

  // 保存草稿到独立文件
  async saveDraft(userId: string, chapterName: string, content: string): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    const safeChapterName = sanitizeDraftChapterName(chapterName);
    const userDraftsDir = path.join(this.dataDir, safeUserId, 'drafts');
    await fs.mkdir(userDraftsDir, { recursive: true });
    
    const draftFile = path.join(userDraftsDir, `${safeChapterName}.json`);
    const draftData = {
      chapterName: safeChapterName,
      content,
      savedAt: new Date().toISOString(),
    };
    
    await fs.writeFile(draftFile, JSON.stringify(draftData, null, 2), 'utf-8');
    logger.info(`[SessionStore] Draft saved for user ${safeUserId}, chapter: ${safeChapterName}`);
  }

  // 加载草稿
  async loadDraft(userId: string, chapterName: string): Promise<{ content: string; savedAt: string } | null> {
    const draftFile = path.join(
      this.dataDir,
      sanitizeUserId(userId),
      'drafts',
      `${sanitizeDraftChapterName(chapterName)}.json`
    );
    
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
    const userDraftsDir = path.join(this.dataDir, sanitizeUserId(userId), 'drafts');
    
    try {
      const files = await fs.readdir(userDraftsDir);
      const drafts = [];
      
      for (const file of files.filter(f => f.endsWith('.json'))) {
        const filePath = path.join(userDraftsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        drafts.push({
          chapterName: sanitizeDraftChapterName(data.chapterName || path.basename(file, '.json')),
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
    const draftFile = path.join(
      this.dataDir,
      sanitizeUserId(userId),
      'drafts',
      `${sanitizeDraftChapterName(chapterName)}.json`
    );
    try {
      await fs.unlink(draftFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }
}
