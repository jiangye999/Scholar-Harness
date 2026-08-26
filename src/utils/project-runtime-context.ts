import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import * as path from 'path';

export interface ProjectRuntimeContext {
  projectId: string;
  projectRoot: string;
}

const projectRuntimeStorage = new AsyncLocalStorage<ProjectRuntimeContext>();

export function normalizeRuntimeProjectId(value: unknown): string {
  const projectId = String(value || '').trim();
  if (!projectId) return '';
  const safeProjectId = path.basename(projectId);
  if (safeProjectId !== projectId || !/^project-[a-zA-Z0-9._-]+$/.test(projectId)) {
    throw new Error('Invalid project id');
  }
  return projectId;
}

export function resolveProjectRuntimeContext(
  dataDir: string,
  projectIdValue: unknown,
): ProjectRuntimeContext | null {
  const projectId = normalizeRuntimeProjectId(projectIdValue);
  if (!projectId) return null;
  const projectsRoot = path.resolve(dataDir, 'projects');
  const projectRoot = path.resolve(projectsRoot, projectId);
  if (!projectRoot.startsWith(`${projectsRoot}${path.sep}`)) {
    throw new Error('Invalid project path');
  }
  if (!fs.existsSync(path.join(projectRoot, 'project.json'))) {
    throw new Error('Project not found');
  }
  return { projectId, projectRoot };
}

export function runWithProjectRuntimeContext<T>(
  context: ProjectRuntimeContext | null,
  callback: () => T,
): T {
  if (!context) return callback();
  return projectRuntimeStorage.run(context, callback);
}

export function getProjectRuntimeContext(): ProjectRuntimeContext | null {
  return projectRuntimeStorage.getStore() || null;
}

export function resolveProjectOwnedDirectory(
  directoryName: string,
  fallbackDirectory: string,
): string {
  const context = getProjectRuntimeContext();
  return context ? path.join(context.projectRoot, directoryName) : fallbackDirectory;
}
