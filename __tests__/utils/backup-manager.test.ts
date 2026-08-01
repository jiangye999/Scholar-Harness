import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BackupManager } from '../../src/utils/backup-manager.ts';

describe('BackupManager linked workspace compatibility', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-manager-linked-'));
  });

  afterEach(() => {
    const uploadsPath = path.join(dataDir, 'uploads');
    try {
      if (fs.lstatSync(uploadsPath).isSymbolicLink()) fs.unlinkSync(uploadsPath);
    } catch {
      // The link may already be absent.
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('restores a backup into the linked project target without replacing the active link', async () => {
    const projectUploads = path.join(dataDir, 'projects', 'project-test', 'uploads');
    const backupName = 'backup-all-linked-test';
    const backupPath = path.join(dataDir, '.backups', backupName);
    fs.mkdirSync(projectUploads, { recursive: true });
    fs.mkdirSync(backupPath, { recursive: true });
    fs.writeFileSync(path.join(projectUploads, 'old.txt'), 'old', 'utf-8');
    fs.writeFileSync(path.join(backupPath, 'restored.txt'), 'restored', 'utf-8');
    fs.symlinkSync(
      path.resolve(projectUploads),
      path.join(dataDir, 'uploads'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const manager = new BackupManager(dataDir);
    const restored = await manager.restoreBackup(backupName);

    expect(restored).toBe(true);
    expect(fs.lstatSync(path.join(dataDir, 'uploads')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(dataDir, 'uploads', 'restored.txt'), 'utf-8')).toBe('restored');
    expect(fs.existsSync(path.join(dataDir, 'uploads', 'old.txt'))).toBe(false);
  });
});
