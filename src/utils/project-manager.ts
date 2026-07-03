import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import {
  DEFAULT_PROJECT_WRITING_PROFILE_ID,
  getProjectWritingProfile,
  normalizeProjectWritingProfileId,
  type ProjectWritingProfileId,
} from '../config/project-writing-profiles';

export interface NewProjectOptions {
  userId: string;
  name?: string;
  writingProfileId?: ProjectWritingProfileId;
  clientState?: unknown;
  skipBackup?: boolean;
}

export interface NewProjectResult {
  projectId: string;
  projectDir: string;
  archivedPaths: string[];
  clearedPaths: string[];
  savedExistingProjectId?: string;
  savedExistingProjectName?: string;
}

export interface ProjectSummary {
  projectId: string;
  name: string;
  userId: string;
  archivedAt: string;
  projectDir: string;
  writingProfileId: ProjectWritingProfileId;
  writingProfileLabel: string;
}

export interface OpenProjectResult {
  projectId: string;
  projectDir: string;
  backupProjectId?: string;
  backupProjectDir?: string;
  savedCurrentProjectId?: string;
  savedCurrentProjectName?: string;
  restoredPaths: string[];
  clientState?: unknown;
}

export interface CurrentProjectInfo {
  projectId?: string;
  name?: string;
  projectDir?: string;
  isArchivedProject: boolean;
  createdAt?: string;
  openedAt?: string;
  previousProjectId?: string;
  backupProjectId?: string;
  writingProfileId?: ProjectWritingProfileId;
  writingProfileLabel?: string;
}

interface ProjectManifest {
  projectId: string;
  name: string;
  userId: string;
  archivedAt: string;
  lastSavedAt?: string;
  archivedPaths: string[];
  notes: string;
  writingProfileId?: ProjectWritingProfileId;
}

interface CurrentProjectRecord {
  projectId?: string;
  createdAt?: string;
  openedAt?: string;
  previousProjectId?: string;
  backupProjectId?: string;
  writingProfileId?: ProjectWritingProfileId;
}

const PROJECT_DIR_PREFIX = 'project';

export class ProjectManager {
  constructor(private readonly dataDir: string) {}

  private getProjectsDir(): string {
    const projectsDir = path.join(this.dataDir, 'projects');
    fs.mkdirSync(projectsDir, { recursive: true });
    return projectsDir;
  }

  private createProjectId(): string {
    const now = new Date();
    const stamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
      String(now.getHours()).padStart(2, '0'),
      String(now.getMinutes()).padStart(2, '0'),
      String(now.getSeconds()).padStart(2, '0'),
    ].join('');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `${PROJECT_DIR_PREFIX}-${stamp}-${suffix}`;
  }

  private getProjectOwnedPaths(): Array<{ name: string; source: string }> {
    return [
      { name: 'uploads', source: path.join(this.dataDir, 'uploads') },
      { name: 'memory', source: path.join(this.dataDir, 'memory') },
      { name: 'sessions', source: path.join(this.dataDir, 'sessions') },
      { name: 'output', source: path.join(this.dataDir, 'output') },
      { name: 'autoresearch', source: path.join(this.dataDir, 'autoresearch') },
      { name: 'research-sessions', source: path.join(this.dataDir, 'research-sessions') },
      { name: 'r-plugin', source: path.join(this.dataDir, 'r-plugin') },
      { name: 'obsidian-vaults', source: path.join(this.dataDir, 'obsidian-vaults') },
    ];
  }

  private validateProjectId(projectId: string): string {
    const safeProjectId = path.basename(projectId);
    if (safeProjectId !== projectId || !safeProjectId.startsWith(PROJECT_DIR_PREFIX)) {
      throw new Error('Invalid project id');
    }
    return safeProjectId;
  }

  private getProjectDir(projectId: string): string {
    return path.join(this.getProjectsDir(), this.validateProjectId(projectId));
  }

  private getCurrentProjectPath(): string {
    return path.join(this.dataDir, 'current-project.json');
  }

  private readCurrentProjectRecord(): CurrentProjectRecord | null {
    const currentProjectPath = this.getCurrentProjectPath();
    if (!fs.existsSync(currentProjectPath)) {
      return null;
    }

    try {
      return JSON.parse(fs.readFileSync(currentProjectPath, 'utf-8')) as CurrentProjectRecord;
    } catch (error) {
      logger.warn(`[Project] Failed to read current project record: ${currentProjectPath}`, error);
      return null;
    }
  }

  private getProjectManifest(projectId: string): ProjectManifest {
    const projectDir = this.getProjectDir(projectId);
    const manifestPath = path.join(projectDir, 'project.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Project not found');
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ProjectManifest;
  }

  private writeProjectManifest(projectId: string, manifest: ProjectManifest): void {
    const projectDir = this.getProjectDir(projectId);
    const manifestPath = path.join(projectDir, 'project.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  private clearCurrentWorkspace(): string[] {
    const clearedPaths: string[] = [];

    for (const item of this.getProjectOwnedPaths()) {
      if (!fs.existsSync(item.source)) {
        fs.mkdirSync(item.source, { recursive: true });
        clearedPaths.push(item.source);
        continue;
      }

      fs.rmSync(item.source, { recursive: true, force: true });
      fs.mkdirSync(item.source, { recursive: true });
      clearedPaths.push(item.source);
    }

    return clearedPaths;
  }

  private getCurrentWritingProfileId(): ProjectWritingProfileId {
    const record = this.readCurrentProjectRecord();
    return normalizeProjectWritingProfileId(record?.writingProfileId);
  }

  private writeNewActiveProject(previousProjectId?: string, writingProfileId?: ProjectWritingProfileId): void {
    const activeProjectId = this.createProjectId();
    fs.writeFileSync(
      this.getCurrentProjectPath(),
      JSON.stringify({
        projectId: activeProjectId,
        createdAt: new Date().toISOString(),
        previousProjectId,
        writingProfileId: normalizeProjectWritingProfileId(writingProfileId),
      }, null, 2),
      'utf-8',
    );
  }

  private saveCurrentWorkspaceToProject(projectId: string, options: NewProjectOptions, notes: string): NewProjectResult {
    const safeProjectId = this.validateProjectId(projectId);
    const projectDir = this.getProjectDir(safeProjectId);
    const manifest = this.getProjectManifest(safeProjectId);
    const archivedPaths: string[] = [];

    fs.mkdirSync(projectDir, { recursive: true });

    for (const item of this.getProjectOwnedPaths()) {
      const target = path.join(projectDir, item.name);
      fs.rmSync(target, { recursive: true, force: true });

      if (fs.existsSync(item.source)) {
        fs.cpSync(item.source, target, { recursive: true, force: true });
        archivedPaths.push(item.source);
      } else {
        fs.mkdirSync(target, { recursive: true });
      }
    }

    if (options.clientState !== undefined) {
      fs.writeFileSync(
        path.join(projectDir, 'client-state.json'),
        JSON.stringify(options.clientState, null, 2),
        'utf-8',
      );
    }

    manifest.archivedPaths = archivedPaths;
    manifest.lastSavedAt = new Date().toISOString();
    manifest.archivedAt = manifest.lastSavedAt;
    manifest.notes = notes;
    manifest.writingProfileId = manifest.writingProfileId || this.getCurrentWritingProfileId();
    this.writeProjectManifest(safeProjectId, manifest);

    logger.info(`[Project] Saved active workspace back to ${safeProjectId}`);

    return {
      projectId: safeProjectId,
      projectDir,
      archivedPaths,
      clearedPaths: [],
      savedExistingProjectId: safeProjectId,
      savedExistingProjectName: manifest.name,
    };
  }

  private archiveCurrentWorkspace(options: NewProjectOptions, notes: string): NewProjectResult {
    const projectId = this.createProjectId();
    const projectDir = path.join(this.getProjectsDir(), projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const archivedPaths: string[] = [];

    for (const item of this.getProjectOwnedPaths()) {
      if (!fs.existsSync(item.source)) {
        continue;
      }

      const target = path.join(projectDir, item.name);
      fs.cpSync(item.source, target, { recursive: true, force: true });
      archivedPaths.push(item.source);
    }

    if (options.clientState !== undefined) {
      fs.writeFileSync(
        path.join(projectDir, 'client-state.json'),
        JSON.stringify(options.clientState, null, 2),
        'utf-8',
      );
    }

    const manifest: ProjectManifest = {
      projectId,
      name: options.name?.trim() || `Project ${new Date().toLocaleString('zh-CN')}`,
      userId: options.userId,
      archivedAt: new Date().toISOString(),
      archivedPaths,
      notes,
      writingProfileId: this.getCurrentWritingProfileId(),
    };

    fs.writeFileSync(
      path.join(projectDir, 'project.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8',
    );

    const clearedPaths = this.clearCurrentWorkspace();
    this.writeNewActiveProject(projectId);

    logger.info(`[Project] Archived current workspace to ${projectDir}`);

    return {
      projectId,
      projectDir,
      archivedPaths,
      clearedPaths,
    };
  }

  createNewProject(options: NewProjectOptions): NewProjectResult {
    const currentProject = this.getCurrentProject();
    if (currentProject.isArchivedProject && currentProject.projectId) {
      const saved = this.saveCurrentWorkspaceToProject(
        currentProject.projectId,
        options,
        'Saved when the user created a new clean project workspace.',
      );
      saved.clearedPaths = this.clearCurrentWorkspace();
      this.writeNewActiveProject(currentProject.projectId, options.writingProfileId);
      return saved;
    }

    const archived = this.archiveCurrentWorkspace(options, 'Archived when the user created a new clean project workspace.');
    const currentRecord = this.readCurrentProjectRecord();
    currentRecord!.writingProfileId = normalizeProjectWritingProfileId(options.writingProfileId);
    fs.writeFileSync(this.getCurrentProjectPath(), JSON.stringify(currentRecord, null, 2), 'utf-8');
    return archived;
  }

  getCurrentProject(): CurrentProjectInfo {
    const record = this.readCurrentProjectRecord();
    if (!record?.projectId) {
      const profile = getProjectWritingProfile(DEFAULT_PROJECT_WRITING_PROFILE_ID);
      return {
        isArchivedProject: false,
        writingProfileId: profile.id,
        writingProfileLabel: profile.label,
      };
    }

    const safeProjectId = path.basename(record.projectId);
    const projectDir = path.join(this.getProjectsDir(), safeProjectId);
    const manifestPath = path.join(projectDir, 'project.json');

    if (safeProjectId !== record.projectId || !safeProjectId.startsWith(PROJECT_DIR_PREFIX) || !fs.existsSync(manifestPath)) {
      const profile = getProjectWritingProfile(record.writingProfileId);
      return {
        projectId: record.projectId,
        isArchivedProject: false,
        createdAt: record.createdAt,
        openedAt: record.openedAt,
        previousProjectId: record.previousProjectId,
        backupProjectId: record.backupProjectId,
        writingProfileId: profile.id,
        writingProfileLabel: profile.label,
      };
    }

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ProjectManifest;
      const profile = getProjectWritingProfile(manifest.writingProfileId || record.writingProfileId);
      return {
        projectId: safeProjectId,
        name: manifest.name || safeProjectId,
        projectDir,
        isArchivedProject: true,
        createdAt: record.createdAt,
        openedAt: record.openedAt,
        previousProjectId: record.previousProjectId,
        backupProjectId: record.backupProjectId,
        writingProfileId: profile.id,
        writingProfileLabel: profile.label,
      };
    } catch (error) {
      logger.warn(`[Project] Failed to resolve current project manifest: ${manifestPath}`, error);
      const profile = getProjectWritingProfile(record.writingProfileId);
      return {
        projectId: record.projectId,
        isArchivedProject: false,
        createdAt: record.createdAt,
        openedAt: record.openedAt,
        previousProjectId: record.previousProjectId,
        backupProjectId: record.backupProjectId,
        writingProfileId: profile.id,
        writingProfileLabel: profile.label,
      };
    }
  }

  setCurrentProjectWritingProfile(writingProfileId: ProjectWritingProfileId): CurrentProjectInfo {
    const profile = getProjectWritingProfile(writingProfileId);
    const record = this.readCurrentProjectRecord() || {};
    const updatedRecord: CurrentProjectRecord = {
      ...record,
      writingProfileId: profile.id,
    };

    fs.writeFileSync(this.getCurrentProjectPath(), JSON.stringify(updatedRecord, null, 2), 'utf-8');

    if (record.projectId) {
      const safeProjectId = path.basename(record.projectId);
      const manifestPath = path.join(this.getProjectsDir(), safeProjectId, 'project.json');
      if (safeProjectId === record.projectId && safeProjectId.startsWith(PROJECT_DIR_PREFIX) && fs.existsSync(manifestPath)) {
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ProjectManifest;
          manifest.writingProfileId = profile.id;
          manifest.lastSavedAt = new Date().toISOString();
          this.writeProjectManifest(safeProjectId, manifest);
        } catch (error) {
          logger.warn(`[Project] Failed to update writing profile in manifest: ${manifestPath}`, error);
        }
      }
    }

    return this.getCurrentProject();
  }

  listProjects(): ProjectSummary[] {
    const projectsDir = this.getProjectsDir();
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
    const projects: ProjectSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const projectDir = path.join(projectsDir, entry.name);
      const manifestPath = path.join(projectDir, 'project.json');

      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ProjectManifest;
        const profile = getProjectWritingProfile(manifest.writingProfileId);
        projects.push({
          projectId: manifest.projectId || entry.name,
          name: manifest.name || entry.name,
          userId: manifest.userId || 'web-user',
          archivedAt: manifest.archivedAt || '',
          projectDir,
          writingProfileId: profile.id,
          writingProfileLabel: profile.label,
        });
      } catch (error) {
        logger.warn(`[Project] Skipping invalid project manifest: ${manifestPath}`, error);
      }
    }

    return projects.sort((a, b) => new Date(b.archivedAt).getTime() - new Date(a.archivedAt).getTime());
  }

  openProject(projectId: string, options: NewProjectOptions): OpenProjectResult {
    const safeProjectId = this.validateProjectId(projectId);
    const projectDir = this.getProjectDir(safeProjectId);
    this.getProjectManifest(safeProjectId);

    const currentProject = this.getCurrentProject();
    let backup: NewProjectResult | null = null;
    let savedCurrentProject: NewProjectResult | null = null;

    if (currentProject.isArchivedProject && currentProject.projectId) {
      if (currentProject.projectId === safeProjectId) {
        savedCurrentProject = this.saveCurrentWorkspaceToProject(
          currentProject.projectId,
          options,
          `Saved current project ${safeProjectId}.`,
        );
      } else if (!options.skipBackup) {
        savedCurrentProject = this.saveCurrentWorkspaceToProject(
          currentProject.projectId,
          options,
          `Saved before opening project ${safeProjectId}.`,
        );
      }
    } else if (!options.skipBackup) {
      backup = this.archiveCurrentWorkspace(
        {
          ...options,
          name: options.name || `Auto backup before opening ${safeProjectId}`,
        },
        `Auto backup created before opening project ${safeProjectId}.`,
      );
    }

    const restoredPaths: string[] = [];
    for (const item of this.getProjectOwnedPaths()) {
      const source = path.join(projectDir, item.name);
      fs.rmSync(item.source, { recursive: true, force: true });

      if (fs.existsSync(source)) {
        fs.cpSync(source, item.source, { recursive: true, force: true });
        restoredPaths.push(item.source);
      } else {
        fs.mkdirSync(item.source, { recursive: true });
      }
    }

    let clientState: unknown;
    const clientStatePath = path.join(projectDir, 'client-state.json');
    if (fs.existsSync(clientStatePath)) {
      clientState = JSON.parse(fs.readFileSync(clientStatePath, 'utf-8'));
    }

    fs.writeFileSync(
      this.getCurrentProjectPath(),
      JSON.stringify({
        projectId: safeProjectId,
        openedAt: new Date().toISOString(),
        backupProjectId: backup?.projectId,
        previousProjectId: currentProject.projectId,
        writingProfileId: normalizeProjectWritingProfileId(this.getProjectManifest(safeProjectId).writingProfileId),
      }, null, 2),
      'utf-8',
    );

    logger.info(`[Project] Restored project ${safeProjectId}; backup=${backup?.projectId || 'skipped'}`);

    return {
      projectId: safeProjectId,
      projectDir,
      backupProjectId: backup?.projectId,
      backupProjectDir: backup?.projectDir,
      savedCurrentProjectId: savedCurrentProject?.projectId,
      savedCurrentProjectName: savedCurrentProject?.savedExistingProjectName,
      restoredPaths,
      clientState,
    };
  }

  renameProject(projectId: string, name: string): ProjectSummary {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Project name is required');
    }

    const safeProjectId = this.validateProjectId(projectId);
    const manifest = this.getProjectManifest(safeProjectId);
    manifest.name = trimmedName;
    this.writeProjectManifest(safeProjectId, manifest);

    logger.info(`[Project] Renamed ${safeProjectId} to ${trimmedName}`);

    return {
      projectId: safeProjectId,
      name: manifest.name,
      userId: manifest.userId,
      archivedAt: manifest.archivedAt,
      projectDir: this.getProjectDir(safeProjectId),
      writingProfileId: getProjectWritingProfile(manifest.writingProfileId).id,
      writingProfileLabel: getProjectWritingProfile(manifest.writingProfileId).label,
    };
  }

  deleteProject(projectId: string): void {
    const safeProjectId = this.validateProjectId(projectId);
    const projectDir = this.getProjectDir(safeProjectId);
    if (!fs.existsSync(projectDir)) {
      throw new Error('Project not found');
    }

    fs.rmSync(projectDir, { recursive: true, force: true });
    logger.info(`[Project] Deleted ${safeProjectId}`);
  }
}
