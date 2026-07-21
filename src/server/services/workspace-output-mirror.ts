import * as fs from 'fs/promises';
import * as path from 'path';

import {
  filterUserFacingWorkspaceOutputPaths,
  isTransientPageQaArtifact,
} from './workspace-output-artifacts';

export interface WorkspaceOutputMirrorResult {
  sourcePath: string;
  targetPath: string;
  relativePath: string;
  mirrored: boolean;
  error?: string;
}

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeComparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isInternalWorkspacePath(relativePath: string): boolean {
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  return segments.some(segment => segment === '.git')
    || segments.some(segment => /^README_ScholarHarness_AI_Workspace\.md$/i.test(segment));
}

/**
 * Mirror one generated/updated file between the current conversation AI work
 * directory and the user-configured workspace while preserving its relative
 * path. This is intentionally deterministic: the model does not need to copy
 * the file itself or remember two output paths.
 */
export async function mirrorWorkspaceOutputFile(
  sourcePath: string,
  configuredRoot: string,
  aiWorkRoot: string,
): Promise<WorkspaceOutputMirrorResult | null> {
  const source = path.resolve(String(sourcePath || '').trim());
  const configured = path.resolve(String(configuredRoot || '').trim());
  const aiWork = path.resolve(String(aiWorkRoot || '').trim());
  if (!sourcePath || !configuredRoot || !aiWorkRoot) return null;
  if (normalizeComparablePath(configured) === normalizeComparablePath(aiWork)) return null;

  let targetRoot = '';
  let relativePath = '';
  if (isPathInside(aiWork, source)) {
    targetRoot = configured;
    relativePath = path.relative(aiWork, source);
  } else if (isPathInside(configured, source) && !isPathInside(aiWork, source)) {
    targetRoot = aiWork;
    relativePath = path.relative(configured, source);
  } else {
    return null;
  }

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  if (isInternalWorkspacePath(relativePath)) return null;
  if (isTransientPageQaArtifact(relativePath)) return null;

  const targetPath = path.resolve(targetRoot, relativePath);
  if (!isPathInside(targetRoot, targetPath) || normalizeComparablePath(source) === normalizeComparablePath(targetPath)) {
    return null;
  }

  try {
    const stat = await fs.stat(source);
    if (!stat.isFile()) return null;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(source, targetPath);
    await fs.utimes(targetPath, stat.atime, stat.mtime).catch(() => undefined);
    return {
      sourcePath: source,
      targetPath,
      relativePath,
      mirrored: true,
    };
  } catch (error) {
    return {
      sourcePath: source,
      targetPath,
      relativePath,
      mirrored: false,
      error: (error as Error).message,
    };
  }
}

export async function mirrorWorkspaceOutputFiles(
  sourcePaths: string[],
  configuredRoot: string,
  aiWorkRoot: string,
): Promise<WorkspaceOutputMirrorResult[]> {
  const seen = new Set<string>();
  const results: WorkspaceOutputMirrorResult[] = [];
  for (const rawPath of filterUserFacingWorkspaceOutputPaths(sourcePaths)) {
    const sourcePath = String(rawPath || '').trim();
    if (!sourcePath) continue;
    const key = normalizeComparablePath(sourcePath);
    if (seen.has(key)) continue;
    seen.add(key);
    const result = await mirrorWorkspaceOutputFile(sourcePath, configuredRoot, aiWorkRoot);
    if (result) results.push(result);
  }
  return results;
}
