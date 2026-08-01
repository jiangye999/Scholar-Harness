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

export interface CloneProjectResult {
  project: ProjectSummary;
  sourceProjectId: string;
  copiedProjectDir: string;
  savedSourceProjectId?: string;
  savedSourceProjectName?: string;
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
  storageMode?: 'legacy' | 'linked';
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
  storageMode?: 'legacy' | 'linked';
}

interface ProjectSwitchJournal {
  version: 1;
  targetProjectId: string;
  nextCurrentProject: CurrentProjectRecord;
  startedAt: string;
}

const PROJECT_DIR_PREFIX = 'project';

export class ProjectManager {
  constructor(private readonly dataDir: string) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.recoverPendingProjectSwitch();
    this.scheduleExistingTrashCleanup();
  }

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

  private getProjectSwitchJournalPath(): string {
    return path.join(this.dataDir, 'project-switch.json');
  }

  private getProjectSwitchTrashDir(): string {
    return path.join(this.dataDir, '.project-switch-trash');
  }

  private writeJsonAtomic(filePath: string, value: unknown): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(temporaryPath, filePath);
  }

  private pathExistsIncludingLinks(targetPath: string): boolean {
    try {
      fs.lstatSync(targetPath);
      return true;
    } catch {
      return false;
    }
  }

  private isDirectoryLink(targetPath: string): boolean {
    try {
      return fs.lstatSync(targetPath).isSymbolicLink();
    } catch {
      return false;
    }
  }

  private normalizeComparablePath(targetPath: string): string {
    let resolved = path.resolve(targetPath);
    try {
      resolved = fs.realpathSync.native(targetPath);
    } catch {
      // The path may be a not-yet-created link target. path.resolve is sufficient here.
    }
    return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
  }

  private isLinkTo(sourcePath: string, targetPath: string): boolean {
    if (!this.isDirectoryLink(sourcePath)) return false;
    try {
      return this.normalizeComparablePath(sourcePath) === this.normalizeComparablePath(targetPath);
    } catch {
      return false;
    }
  }

  private createDirectoryLink(sourcePath: string, targetPath: string): void {
    fs.mkdirSync(targetPath, { recursive: true });
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.symlinkSync(
      path.resolve(targetPath),
      sourcePath,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }

  private createTrashBatch(): string {
    const batch = path.join(
      this.getProjectSwitchTrashDir(),
      `${Date.now()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.mkdirSync(batch, { recursive: true });
    return batch;
  }

  private movePathToTrash(sourcePath: string, trashBatch: string, preferredName: string): boolean {
    if (!this.pathExistsIncludingLinks(sourcePath)) return false;
    fs.mkdirSync(trashBatch, { recursive: true });
    let target = path.join(trashBatch, preferredName);
    let suffix = 1;
    while (this.pathExistsIncludingLinks(target)) {
      target = path.join(trashBatch, `${preferredName}-${suffix++}`);
    }
    fs.renameSync(sourcePath, target);
    return true;
  }

  private scheduleTrashCleanup(trashPath: string): void {
    if (!this.pathExistsIncludingLinks(trashPath)) return;
    const timer = setTimeout(() => {
      void fs.promises.rm(trashPath, { recursive: true, force: true }).catch(error => {
        logger.warn(`[Project] Failed to clean project switch trash: ${trashPath}`, error);
      });
    }, 30_000);
    timer.unref?.();
  }

  private scheduleExistingTrashCleanup(): void {
    const trashDir = this.getProjectSwitchTrashDir();
    if (!fs.existsSync(trashDir)) return;
    try {
      for (const entry of fs.readdirSync(trashDir, { withFileTypes: true })) {
        this.scheduleTrashCleanup(path.join(trashDir, entry.name));
      }
    } catch (error) {
      logger.warn(`[Project] Failed to inspect project switch trash: ${trashDir}`, error);
    }
  }

  private removeWorkspacePath(sourcePath: string, trashBatch: string, name: string): void {
    if (!this.pathExistsIncludingLinks(sourcePath)) return;
    if (this.isDirectoryLink(sourcePath)) {
      fs.unlinkSync(sourcePath);
      return;
    }
    this.movePathToTrash(sourcePath, trashBatch, name);
  }

  private adoptCurrentWorkspaceIntoProject(projectId: string): string[] {
    const projectDir = this.getProjectDir(projectId);
    const trashBatch = this.createTrashBatch();
    const archivedPaths: string[] = [];
    let usedTrash = false;

    for (const item of this.getProjectOwnedPaths()) {
      const target = path.join(projectDir, item.name);
      if (this.isLinkTo(item.source, target)) {
        archivedPaths.push(item.source);
        continue;
      }

      if (!this.pathExistsIncludingLinks(item.source)) {
        fs.mkdirSync(target, { recursive: true });
        this.createDirectoryLink(item.source, target);
        archivedPaths.push(item.source);
        continue;
      }

      let activeDataPath = item.source;
      if (this.isDirectoryLink(item.source)) {
        try {
          activeDataPath = fs.realpathSync.native(item.source);
        } catch {
          activeDataPath = '';
        }
        fs.unlinkSync(item.source);
      }

      if (!activeDataPath || !this.pathExistsIncludingLinks(activeDataPath)) {
        fs.mkdirSync(target, { recursive: true });
      } else if (this.normalizeComparablePath(activeDataPath) !== this.normalizeComparablePath(target)) {
        if (this.pathExistsIncludingLinks(target)) {
          usedTrash = this.movePathToTrash(target, trashBatch, item.name) || usedTrash;
        }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.renameSync(activeDataPath, target);
      }

      this.createDirectoryLink(item.source, target);
      archivedPaths.push(item.source);
    }

    if (usedTrash) this.scheduleTrashCleanup(trashBatch);
    else fs.rmSync(trashBatch, { recursive: true, force: true });
    return archivedPaths;
  }

  private activateProjectWorkspace(projectId: string): string[] {
    const projectDir = this.getProjectDir(projectId);
    const trashBatch = this.createTrashBatch();
    const activatedPaths: string[] = [];
    let usedTrash = false;

    for (const item of this.getProjectOwnedPaths()) {
      const target = path.join(projectDir, item.name);
      fs.mkdirSync(target, { recursive: true });
      if (!this.isLinkTo(item.source, target)) {
        if (this.pathExistsIncludingLinks(item.source)) {
          if (this.isDirectoryLink(item.source)) {
            fs.unlinkSync(item.source);
          } else {
            usedTrash = this.movePathToTrash(item.source, trashBatch, item.name) || usedTrash;
          }
        }
        this.createDirectoryLink(item.source, target);
      }
      activatedPaths.push(item.source);
    }

    if (usedTrash) this.scheduleTrashCleanup(trashBatch);
    else fs.rmSync(trashBatch, { recursive: true, force: true });
    return activatedPaths;
  }

  private completeProjectSwitch(projectId: string, nextCurrentProject: CurrentProjectRecord): string[] {
    const journal: ProjectSwitchJournal = {
      version: 1,
      targetProjectId: projectId,
      nextCurrentProject,
      startedAt: new Date().toISOString(),
    };
    this.writeJsonAtomic(this.getProjectSwitchJournalPath(), journal);
    const activatedPaths = this.activateProjectWorkspace(projectId);
    this.writeJsonAtomic(this.getCurrentProjectPath(), nextCurrentProject);
    fs.rmSync(this.getProjectSwitchJournalPath(), { force: true });
    return activatedPaths;
  }

  private recoverPendingProjectSwitch(): void {
    const journalPath = this.getProjectSwitchJournalPath();
    if (!fs.existsSync(journalPath)) return;
    try {
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as ProjectSwitchJournal;
      if (journal.version !== 1 || !journal.targetProjectId || !journal.nextCurrentProject) {
        throw new Error('Invalid project switch journal');
      }
      this.getProjectManifest(journal.targetProjectId);
      this.activateProjectWorkspace(journal.targetProjectId);
      this.writeJsonAtomic(this.getCurrentProjectPath(), journal.nextCurrentProject);
      fs.rmSync(journalPath, { force: true });
      logger.info(`[Project] Recovered interrupted project switch to ${journal.targetProjectId}`);
    } catch (error) {
      logger.error(`[Project] Failed to recover pending project switch: ${journalPath}`, error);
    }
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
    const trashBatch = this.createTrashBatch();
    let usedTrash = false;

    for (const item of this.getProjectOwnedPaths()) {
      const wasPhysicalDirectory = this.pathExistsIncludingLinks(item.source) && !this.isDirectoryLink(item.source);
      this.removeWorkspacePath(item.source, trashBatch, item.name);
      usedTrash = usedTrash || wasPhysicalDirectory;
      fs.mkdirSync(item.source, { recursive: true });
      clearedPaths.push(item.source);
    }

    if (usedTrash) this.scheduleTrashCleanup(trashBatch);
    else fs.rmSync(trashBatch, { recursive: true, force: true });
    return clearedPaths;
  }

  private getCurrentWritingProfileId(): ProjectWritingProfileId {
    const record = this.readCurrentProjectRecord();
    return normalizeProjectWritingProfileId(record?.writingProfileId);
  }

  private writeNewActiveProject(previousProjectId?: string, writingProfileId?: ProjectWritingProfileId): void {
    const activeProjectId = this.createProjectId();
    this.writeJsonAtomic(
      this.getCurrentProjectPath(),
      {
        projectId: activeProjectId,
        createdAt: new Date().toISOString(),
        previousProjectId,
        writingProfileId: normalizeProjectWritingProfileId(writingProfileId),
        storageMode: 'legacy',
      },
    );
  }

  private saveCurrentWorkspaceToProject(projectId: string, options: NewProjectOptions, notes: string): NewProjectResult {
    const safeProjectId = this.validateProjectId(projectId);
    const projectDir = this.getProjectDir(safeProjectId);
    const manifest = this.getProjectManifest(safeProjectId);
    const archivedPaths = this.adoptCurrentWorkspaceIntoProject(safeProjectId);

    fs.mkdirSync(projectDir, { recursive: true });

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
      archivedPaths: [],
      notes,
      writingProfileId: this.getCurrentWritingProfileId(),
    };

    this.writeJsonAtomic(path.join(projectDir, 'project.json'), manifest);
    this.writeJsonAtomic(this.getCurrentProjectPath(), {
      projectId,
      openedAt: new Date().toISOString(),
      writingProfileId: manifest.writingProfileId,
      storageMode: 'linked',
    } satisfies CurrentProjectRecord);

    const archivedPaths = this.adoptCurrentWorkspaceIntoProject(projectId);
    manifest.archivedPaths = archivedPaths;
    manifest.lastSavedAt = new Date().toISOString();
    this.writeProjectManifest(projectId, manifest);

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
    this.writeJsonAtomic(this.getCurrentProjectPath(), currentRecord);
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
        storageMode: record?.storageMode || 'legacy',
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
        storageMode: record.storageMode || 'legacy',
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
        storageMode: record.storageMode || 'legacy',
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
        storageMode: record.storageMode || 'legacy',
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

    this.writeJsonAtomic(this.getCurrentProjectPath(), updatedRecord);

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

    let clientState: unknown;
    const clientStatePath = path.join(projectDir, 'client-state.json');
    if (fs.existsSync(clientStatePath)) {
      clientState = JSON.parse(fs.readFileSync(clientStatePath, 'utf-8'));
    }

    const nextCurrentProject: CurrentProjectRecord = {
      projectId: safeProjectId,
      openedAt: new Date().toISOString(),
      backupProjectId: backup?.projectId,
      previousProjectId: currentProject.projectId,
      writingProfileId: normalizeProjectWritingProfileId(this.getProjectManifest(safeProjectId).writingProfileId),
      storageMode: 'linked',
    };
    const restoredPaths = this.completeProjectSwitch(safeProjectId, nextCurrentProject);

    logger.info(`[Project] Activated project ${safeProjectId} without workspace copy; backup=${backup?.projectId || 'skipped'}`);

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

  cloneProject(projectId: string, options: NewProjectOptions): CloneProjectResult {
    const safeProjectId = this.validateProjectId(projectId);
    const sourceProjectDir = this.getProjectDir(safeProjectId);
    const sourceManifest = this.getProjectManifest(safeProjectId);
    const currentProject = this.getCurrentProject();
    let savedSource: NewProjectResult | null = null;

    if (currentProject.isArchivedProject && currentProject.projectId === safeProjectId) {
      savedSource = this.saveCurrentWorkspaceToProject(
        safeProjectId,
        options,
        `Saved source project ${safeProjectId} before cloning.`,
      );
    }

    const cloneProjectId = this.createProjectId();
    const cloneProjectDir = this.getProjectDir(cloneProjectId);
    fs.cpSync(sourceProjectDir, cloneProjectDir, { recursive: true, force: true });

    const now = new Date().toISOString();
    const cloneName = options.name?.trim() || `${sourceManifest.name || safeProjectId} 副本`;
    const cloneManifest: ProjectManifest = {
      ...sourceManifest,
      projectId: cloneProjectId,
      name: cloneName,
      userId: options.userId || sourceManifest.userId || 'web-user',
      archivedAt: now,
      lastSavedAt: now,
      notes: `Cloned from ${safeProjectId} at ${now}. ${sourceManifest.notes || ''}`.trim(),
      writingProfileId: normalizeProjectWritingProfileId(sourceManifest.writingProfileId),
    };
    this.writeProjectManifest(cloneProjectId, cloneManifest);

    logger.info(`[Project] Cloned ${safeProjectId} to ${cloneProjectId}`);

    const profile = getProjectWritingProfile(cloneManifest.writingProfileId);
    return {
      sourceProjectId: safeProjectId,
      copiedProjectDir: cloneProjectDir,
      savedSourceProjectId: savedSource?.projectId,
      savedSourceProjectName: savedSource?.savedExistingProjectName,
      project: {
        projectId: cloneProjectId,
        name: cloneManifest.name,
        userId: cloneManifest.userId,
        archivedAt: cloneManifest.archivedAt,
        projectDir: cloneProjectDir,
        writingProfileId: profile.id,
        writingProfileLabel: profile.label,
      },
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

    const currentProject = this.getCurrentProject();
    if (currentProject.isArchivedProject && currentProject.projectId === safeProjectId) {
      throw new Error('Cannot delete the currently open project');
    }
    const projectPath = this.normalizeComparablePath(projectDir);
    const hasActiveWorkspaceLink = this.getProjectOwnedPaths().some(item => {
      if (!this.isDirectoryLink(item.source)) return false;
      const activePath = this.normalizeComparablePath(item.source);
      return activePath === projectPath || activePath.startsWith(`${projectPath}${path.sep}`);
    });
    if (hasActiveWorkspaceLink) {
      throw new Error('Cannot delete a project that is attached to the active workspace');
    }

    fs.rmSync(projectDir, { recursive: true, force: true });
    logger.info(`[Project] Deleted ${safeProjectId}`);
  }
}
