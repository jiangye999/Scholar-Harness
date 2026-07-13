import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../utils/logger';
import { sanitizeUserId } from '../utils/paths';
import type { UserState } from '../types';

const DEFAULT_DRAFT_CHAPTER_NAME = 'section';

export interface DraftRecord {
  content: string;
  savedAt: string;
  fileName: string;
  storageFormat: 'txt' | 'json';
}

export interface DraftSummary {
  chapterName: string;
  savedAt: string;
  fileName: string;
  storageFormat: 'txt' | 'json';
  hasLegacyJson?: boolean;
}

export interface UpdateDraftOptions {
  expectedSavedAt?: string;
}

export class DraftConflictError extends Error {
  readonly code = 'DRAFT_CONFLICT';
  readonly currentSavedAt: string;

  constructor(currentSavedAt: string) {
    super('章节草稿已被其他操作更新，请刷新后重试');
    this.name = 'DraftConflictError';
    this.currentSavedAt = currentSavedAt;
  }
}

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
  private draftLocks = new Map<string, Promise<void>>();

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

  private getDraftsDir(userId: string): string {
    return path.join(this.dataDir, sanitizeUserId(userId), 'drafts');
  }

  private getDraftTextPath(userId: string, chapterName: string): string {
    return path.join(this.getDraftsDir(userId), `${sanitizeDraftChapterName(chapterName)}.txt`);
  }

  private getLegacyDraftJsonPath(userId: string, chapterName: string): string {
    return path.join(this.getDraftsDir(userId), `${sanitizeDraftChapterName(chapterName)}.json`);
  }

  private async removeFileIfPresent(filePath: string): Promise<void> {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private async withDraftLock<T>(userId: string, chapterName: string, task: () => Promise<T>): Promise<T> {
    const lockKey = `${sanitizeUserId(userId)}:${sanitizeDraftChapterName(chapterName).toLowerCase()}`;
    const previous = (this.draftLocks.get(lockKey) || Promise.resolve()).catch(() => undefined);
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.draftLocks.set(lockKey, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (this.draftLocks.get(lockKey) === tail) {
        this.draftLocks.delete(lockKey);
      }
    }
  }

  private async saveDraftUnlocked(userId: string, chapterName: string, content: string): Promise<void> {
    const safeUserId = sanitizeUserId(userId);
    const safeChapterName = sanitizeDraftChapterName(chapterName);
    const userDraftsDir = this.getDraftsDir(safeUserId);
    await fs.mkdir(userDraftsDir, { recursive: true });

    const draftFile = this.getDraftTextPath(safeUserId, safeChapterName);
    const legacyDraftFile = this.getLegacyDraftJsonPath(safeUserId, safeChapterName);
    const temporaryFile = path.join(
      userDraftsDir,
      `.${safeChapterName}.${process.pid}.${Date.now()}.tmp`
    );

    await fs.writeFile(temporaryFile, String(content ?? ''), 'utf-8');
    try {
      await fs.rename(temporaryFile, draftFile);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') {
        await this.removeFileIfPresent(temporaryFile);
        throw error;
      }
      try {
        await this.removeFileIfPresent(draftFile);
        await fs.rename(temporaryFile, draftFile);
      } catch (replaceError) {
        await this.removeFileIfPresent(temporaryFile);
        throw replaceError;
      }
    }
    await this.removeFileIfPresent(legacyDraftFile);
    logger.info(`[SessionStore] Draft saved for user ${safeUserId}, chapter: ${safeChapterName}`);
  }

  // 每个章节只保留一个 TXT。JSON 仅作为旧版本迁移输入。
  async saveDraft(userId: string, chapterName: string, content: string): Promise<void> {
    await this.withDraftLock(userId, chapterName, () => this.saveDraftUnlocked(userId, chapterName, content));
  }

  async updateDraft(
    userId: string,
    chapterName: string,
    updater: (current: DraftRecord | null) => string | Promise<string>,
    options: UpdateDraftOptions = {}
  ): Promise<DraftRecord> {
    return this.withDraftLock(userId, chapterName, async () => {
      const current = await this.loadDraft(userId, chapterName);
      if (options.expectedSavedAt) {
        const currentRevision = current?.savedAt || '';
        const expectedTime = Date.parse(options.expectedSavedAt);
        const currentTime = Date.parse(currentRevision);
        const revisionMatches = currentRevision
          && Number.isFinite(expectedTime)
          && Number.isFinite(currentTime)
          && expectedTime === currentTime;
        if (!revisionMatches) {
          throw new DraftConflictError(currentRevision);
        }
      }

      const nextContent = await updater(current);
      await this.saveDraftUnlocked(userId, chapterName, nextContent);
      const saved = await this.loadDraft(userId, chapterName);
      if (!saved) throw new Error('草稿写入后无法重新读取');
      return saved;
    });
  }

  // TXT 是唯一活跃来源；没有 TXT 时才读取旧 JSON，供一次性迁移使用。
  async loadDraft(userId: string, chapterName: string): Promise<DraftRecord | null> {
    const safeChapterName = sanitizeDraftChapterName(chapterName);
    const draftFile = this.getDraftTextPath(userId, safeChapterName);
    try {
      const content = await fs.readFile(draftFile, 'utf-8');
      const stat = await fs.stat(draftFile);
      return {
        content,
        savedAt: stat.mtime.toISOString(),
        fileName: `${safeChapterName}.txt`,
        storageFormat: 'txt',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const legacyDraftFile = this.getLegacyDraftJsonPath(userId, safeChapterName);
    try {
      const [content, stat] = await Promise.all([
        fs.readFile(legacyDraftFile, 'utf-8'),
        fs.stat(legacyDraftFile),
      ]);
      const data = JSON.parse(content) as { content?: unknown; savedAt?: unknown };
      return {
        content: String(data.content ?? ''),
        savedAt: String(data.savedAt || stat.mtime.toISOString()),
        fileName: `${safeChapterName}.json`,
        storageFormat: 'json',
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  // 列出所有草稿
  async listDrafts(userId: string): Promise<DraftSummary[]> {
    const userDraftsDir = this.getDraftsDir(userId);
    try {
      const files = await fs.readdir(userDraftsDir);
      const draftsByChapter = new Map<string, DraftSummary>();

      for (const file of files.filter(file => file.toLowerCase().endsWith('.txt'))) {
        const chapterName = sanitizeDraftChapterName(path.basename(file, path.extname(file)));
        const filePath = path.join(userDraftsDir, file);
        const stat = await fs.stat(filePath);
        draftsByChapter.set(chapterName, {
          chapterName,
          savedAt: stat.mtime.toISOString(),
          fileName: file,
          storageFormat: 'txt',
          hasLegacyJson: files.some(candidate => candidate.toLowerCase() === `${chapterName.toLowerCase()}.json`),
        });
      }

      for (const file of files.filter(file => file.toLowerCase().endsWith('.json'))) {
        const filePath = path.join(userDraftsDir, file);
        try {
          const [content, stat] = await Promise.all([
            fs.readFile(filePath, 'utf-8'),
            fs.stat(filePath),
          ]);
          const data = JSON.parse(content) as { chapterName?: unknown; savedAt?: unknown };
          const chapterName = sanitizeDraftChapterName(data.chapterName || path.basename(file, '.json'));
          if (draftsByChapter.has(chapterName)) continue;
          draftsByChapter.set(chapterName, {
            chapterName,
            savedAt: String(data.savedAt || stat.mtime.toISOString()),
            fileName: file,
            storageFormat: 'json',
          });
        } catch (error) {
          logger.warn(`[SessionStore] Ignored unreadable legacy draft ${filePath}: ${String(error)}`);
        }
      }

      return Array.from(draftsByChapter.values())
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  private async deleteDraftUnlocked(userId: string, chapterName: string): Promise<void> {
    const safeChapterName = sanitizeDraftChapterName(chapterName);
    await Promise.all([
      this.removeFileIfPresent(this.getDraftTextPath(userId, safeChapterName)),
      this.removeFileIfPresent(this.getLegacyDraftJsonPath(userId, safeChapterName)),
    ]);

    const draftsDir = this.getDraftsDir(userId);
    try {
      const temporaryFiles = (await fs.readdir(draftsDir))
        .filter(file => file.startsWith(`.${safeChapterName}.`) && file.endsWith('.tmp'));
      await Promise.all(temporaryFiles.map(file => this.removeFileIfPresent(path.join(draftsDir, file))));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  // 删除与写入共享同一章节锁，避免删除和保存交错后复活旧内容。
  async deleteDraft(userId: string, chapterName: string): Promise<void> {
    await this.withDraftLock(userId, chapterName, () => this.deleteDraftUnlocked(userId, chapterName));
  }
}
