import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ProjectManager } from '../../src/utils/project-manager';

const OWNED_AREAS = [
  'uploads',
  'memory',
  'sessions',
  'output',
  'autoresearch',
  'research-sessions',
  'r-plugin',
  'obsidian-vaults',
];

function writeArchivedProject(dataDir: string, projectId: string, name: string, marker: string): string {
  const projectDir = path.join(dataDir, 'projects', projectId);
  fs.mkdirSync(projectDir, { recursive: true });
  for (const area of OWNED_AREAS) {
    fs.mkdirSync(path.join(projectDir, area), { recursive: true });
  }
  fs.writeFileSync(path.join(projectDir, 'uploads', `${marker}.txt`), marker, 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'client-state.json'), JSON.stringify({ marker }), 'utf-8');
  fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify({
    projectId,
    name,
    userId: 'web-user',
    archivedAt: new Date().toISOString(),
    archivedPaths: [],
    notes: 'test project',
    writingProfileId: 'paper-writing',
  }, null, 2), 'utf-8');
  return projectDir;
}

function createLegacyWorkspace(dataDir: string, marker?: string): void {
  for (const area of OWNED_AREAS) {
    fs.mkdirSync(path.join(dataDir, area), { recursive: true });
  }
  if (marker) {
    fs.writeFileSync(path.join(dataDir, 'uploads', `${marker}.txt`), marker, 'utf-8');
  }
}

function normalizeComparablePath(targetPath: string): string {
  const resolved = fs.realpathSync.native(targetPath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
}

describe('ProjectManager linked workspaces', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-manager-'));
  });

  afterEach(() => {
    for (const area of OWNED_AREAS) {
      const activePath = path.join(dataDir, area);
      try {
        if (fs.lstatSync(activePath).isSymbolicLink()) fs.unlinkSync(activePath);
      } catch {
        // The active path may already be absent.
      }
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('migrates a legacy active project once and switches projects through directory links', () => {
    const projectA = 'project-20260722000100-aaaaaa';
    const projectB = 'project-20260722000200-bbbbbb';
    const projectADir = writeArchivedProject(dataDir, projectA, '项目 A', 'archived-a');
    const projectBDir = writeArchivedProject(dataDir, projectB, '项目 B', 'project-b');
    createLegacyWorkspace(dataDir, 'current-a');
    fs.writeFileSync(path.join(dataDir, 'current-project.json'), JSON.stringify({
      projectId: projectA,
      openedAt: new Date().toISOString(),
      writingProfileId: 'paper-writing',
      storageMode: 'legacy',
    }), 'utf-8');

    const manager = new ProjectManager(dataDir);
    const openedB = manager.openProject(projectB, {
      userId: 'web-user',
      clientState: { marker: 'saved-a' },
    });

    expect(openedB.clientState).toEqual({ marker: 'project-b' });
    expect(openedB.restoredPaths).toHaveLength(OWNED_AREAS.length);
    expect(fs.lstatSync(path.join(dataDir, 'uploads')).isSymbolicLink()).toBe(true);
    expect(normalizeComparablePath(path.join(dataDir, 'uploads')))
      .toBe(normalizeComparablePath(path.join(projectBDir, 'uploads')));
    expect(fs.readFileSync(path.join(projectADir, 'uploads', 'current-a.txt'), 'utf-8')).toBe('current-a');
    expect(fs.existsSync(path.join(projectADir, 'uploads', 'archived-a.txt'))).toBe(false);

    fs.writeFileSync(path.join(dataDir, 'uploads', 'new-in-b.txt'), 'new-in-b', 'utf-8');
    expect(fs.readFileSync(path.join(projectBDir, 'uploads', 'new-in-b.txt'), 'utf-8')).toBe('new-in-b');

    manager.openProject(projectA, { userId: 'web-user', clientState: { marker: 'saved-b' } });
    expect(normalizeComparablePath(path.join(dataDir, 'uploads')))
      .toBe(normalizeComparablePath(path.join(projectADir, 'uploads')));
    expect(fs.readFileSync(path.join(dataDir, 'uploads', 'current-a.txt'), 'utf-8')).toBe('current-a');
    expect(fs.readFileSync(path.join(projectBDir, 'uploads', 'new-in-b.txt'), 'utf-8')).toBe('new-in-b');
    expect(manager.getCurrentProject().storageMode).toBe('linked');
  });

  it('archives an unsaved workspace by moving it into a project and leaves a clean workspace', () => {
    createLegacyWorkspace(dataDir, 'unsaved-work');
    const manager = new ProjectManager(dataDir);

    const archived = manager.createNewProject({
      userId: 'web-user',
      name: '原项目',
      writingProfileId: 'paper-writing',
      clientState: { marker: 'original' },
    });

    expect(fs.readFileSync(path.join(archived.projectDir, 'uploads', 'unsaved-work.txt'), 'utf-8')).toBe('unsaved-work');
    expect(fs.lstatSync(path.join(dataDir, 'uploads')).isSymbolicLink()).toBe(false);
    expect(fs.readdirSync(path.join(dataDir, 'uploads'))).toHaveLength(0);
    expect(manager.listProjects().some(project => project.name === '原项目')).toBe(true);
  });

  it('promotes a legacy active workspace to a stable linked runtime project', () => {
    createLegacyWorkspace(dataDir, 'runtime-marker');
    const manager = new ProjectManager(dataDir);

    const current = manager.ensureCurrentProjectRuntime('user-runtime');

    expect(current.isArchivedProject).toBe(true);
    expect(current.projectId).toMatch(/^project-/);
    expect(current.projectDir).toBeTruthy();
    expect(fs.lstatSync(path.join(dataDir, 'uploads')).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(current.projectDir!, 'uploads', 'runtime-marker.txt'), 'utf-8'))
      .toBe('runtime-marker');
  });

  it('recovers an interrupted linked project switch during startup', () => {
    const projectId = 'project-20260722000300-cccccc';
    const projectDir = writeArchivedProject(dataDir, projectId, '恢复项目', 'recover-me');
    createLegacyWorkspace(dataDir);
    fs.writeFileSync(path.join(dataDir, 'project-switch.json'), JSON.stringify({
      version: 1,
      targetProjectId: projectId,
      nextCurrentProject: {
        projectId,
        openedAt: new Date().toISOString(),
        writingProfileId: 'paper-writing',
        storageMode: 'linked',
      },
      startedAt: new Date().toISOString(),
    }), 'utf-8');

    const manager = new ProjectManager(dataDir);

    expect(fs.existsSync(path.join(dataDir, 'project-switch.json'))).toBe(false);
    expect(manager.getCurrentProject().projectId).toBe(projectId);
    expect(normalizeComparablePath(path.join(dataDir, 'uploads')))
      .toBe(normalizeComparablePath(path.join(projectDir, 'uploads')));
    expect(fs.readFileSync(path.join(dataDir, 'uploads', 'recover-me.txt'), 'utf-8')).toBe('recover-me');
  });

  it('refuses to delete the project attached to the active workspace', () => {
    const projectId = 'project-20260722000400-dddddd';
    writeArchivedProject(dataDir, projectId, '当前项目', 'active');
    createLegacyWorkspace(dataDir);
    const manager = new ProjectManager(dataDir);
    manager.openProject(projectId, { userId: 'web-user', skipBackup: true });

    expect(() => manager.deleteProject(projectId)).toThrow('Cannot delete the currently open project');
  });
});
