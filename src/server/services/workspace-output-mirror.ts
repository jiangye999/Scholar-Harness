import * as fs from 'fs/promises';
import * as path from 'path';

import { filterUserFacingWorkspaceOutputPaths } from './workspace-output-artifacts';
import { finalizeWorkspaceWorkbench } from './workspace-workbench';

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

/**
 * Backward-compatible publication entry point. It no longer copies files into
 * the source tree: publication means refreshing a shortcut under 用户查看 and
 * updating the workbench README.
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
  if (!isPathInside(aiWork, source)) return null;
  const stat = await fs.stat(source).catch(() => null);
  if (!stat?.isFile()) return null;
  const [result] = await publishWorkspaceOutputFiles([source], configured, aiWork);
  return result || null;
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

/**
 * Publish selected files from the conversation AI workspace. The user source
 * tree stays immutable; publication only refreshes 用户查看 shortcuts and the
 * per-workbench README.
 */
export async function publishWorkspaceOutputFiles(
  sourcePaths: string[],
  configuredRoot: string,
  aiWorkRoot: string,
): Promise<WorkspaceOutputMirrorResult[]> {
  const resolvedAiWorkRoot = path.resolve(String(aiWorkRoot || '').trim());
  if (!aiWorkRoot) return [];
  const selectedPaths = filterUserFacingWorkspaceOutputPaths(sourcePaths)
    .map(sourcePath => path.resolve(String(sourcePath || '').trim()))
    .filter(sourcePath => isPathInside(resolvedAiWorkRoot, sourcePath));
  const finalized = await finalizeWorkspaceWorkbench(configuredRoot, resolvedAiWorkRoot, selectedPaths);
  return finalized.shortcuts.map(result => ({
    sourcePath: result.sourcePath,
    targetPath: result.shortcutPath,
    relativePath: result.relativePath,
    mirrored: result.created,
    error: result.error,
  }));
}
