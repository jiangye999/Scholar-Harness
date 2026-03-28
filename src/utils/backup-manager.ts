import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from './logger';

export class BackupManager {
  private dataDir: string;
  private backupDir: string;
  private maxBackups: number;

  constructor(dataDir: string, maxBackups: number = 10) {
    this.dataDir = dataDir;
    this.backupDir = path.join(dataDir, '.backups');
    this.maxBackups = maxBackups;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.backupDir, { recursive: true });
      logger.info(`[BackupManager] Initialized backup directory: ${this.backupDir}`);
    } catch (error) {
      logger.error('[BackupManager] Failed to initialize backup directory:', error);
    }
  }

  async createBackup(userId?: string): Promise<string | null> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = userId ? `backup-${userId}-${timestamp}` : `backup-all-${timestamp}`;
      const backupPath = path.join(this.backupDir, backupName);

      await fs.mkdir(backupPath, { recursive: true });

      const sourceDir = userId 
        ? path.join(this.dataDir, 'uploads', userId)
        : path.join(this.dataDir, 'uploads');

      if (!await this.pathExists(sourceDir)) {
        logger.warn(`[BackupManager] Source directory does not exist: ${sourceDir}`);
        return null;
      }

      await this.copyDirectory(sourceDir, backupPath);

      logger.info(`[BackupManager] Created backup: ${backupPath}`);

      await this.cleanupOldBackups(userId);

      return backupPath;
    } catch (error) {
      logger.error('[BackupManager] Failed to create backup:', error);
      return null;
    }
  }

  async restoreBackup(backupName: string, targetUserId?: string): Promise<boolean> {
    try {
      const backupPath = path.join(this.backupDir, backupName);
      
      if (!await this.pathExists(backupPath)) {
        logger.error(`[BackupManager] Backup not found: ${backupPath}`);
        return false;
      }

      const targetDir = targetUserId
        ? path.join(this.dataDir, 'uploads', targetUserId)
        : path.join(this.dataDir, 'uploads');

      await fs.mkdir(path.dirname(targetDir), { recursive: true });

      if (await this.pathExists(targetDir)) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const archivePath = `${targetDir}.archive-${timestamp}`;
        await fs.rename(targetDir, archivePath);
        logger.info(`[BackupManager] Archived existing data to: ${archivePath}`);
      }

      await this.copyDirectory(backupPath, targetDir);

      logger.info(`[BackupManager] Restored backup: ${backupName} -> ${targetDir}`);
      return true;
    } catch (error) {
      logger.error('[BackupManager] Failed to restore backup:', error);
      return false;
    }
  }

  async listBackups(userId?: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(this.backupDir, { withFileTypes: true });
      const backups = entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => userId ? name.includes(userId) : true)
        .sort((a, b) => b.localeCompare(a));

      return backups;
    } catch (error) {
      logger.error('[BackupManager] Failed to list backups:', error);
      return [];
    }
  }

  async autoBackupBeforeOperation(userId: string, operation: string): Promise<void> {
    logger.info(`[BackupManager] Auto-backing up before ${operation} for user: ${userId}`);
    const backupPath = await this.createBackup(userId);
    if (backupPath) {
      logger.info(`[BackupManager] Auto-backup completed: ${backupPath}`);
    }
  }

  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  private async cleanupOldBackups(userId?: string): Promise<void> {
    try {
      const backups = await this.listBackups(userId);
      const prefix = userId ? `backup-${userId}-` : 'backup-all-';
      const relevantBackups = backups.filter(name => name.startsWith(prefix));

      if (relevantBackups.length > this.maxBackups) {
        const toDelete = relevantBackups.slice(this.maxBackups);
        for (const backupName of toDelete) {
          const backupPath = path.join(this.backupDir, backupName);
          await fs.rm(backupPath, { recursive: true, force: true });
          logger.info(`[BackupManager] Cleaned up old backup: ${backupName}`);
        }
      }
    } catch (error) {
      logger.error('[BackupManager] Failed to cleanup old backups:', error);
    }
  }

  private async pathExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }
}

export default BackupManager;
