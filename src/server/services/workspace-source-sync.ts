import { createReadStream } from 'fs';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../utils/logger';

const AI_WORKSPACE_CONTAINER_NAME = 'ScholarHarness_AI_Workspaces';
const AI_WORKSPACE_README_PATTERN = /^README_ScholarHarness_AI_Workspace\.md$/i;
const DEFAULT_MAX_SCANNED_FILES = 10_000;

export interface WorkspaceSourceSnapshot {
  mtimeMs: number;
  size: number;
  sha256?: string;
}

export interface WorkspaceSourceFileSyncResult {
  sourcePath: string;
  aiPath: string;
  sourceSnapshot: WorkspaceSourceSnapshot;
  copied: boolean;
}

export interface WorkspaceSourceRefreshResult {
  scanned: number;
  matched: number;
  refreshed: number;
  unchanged: number;
  truncated: boolean;
  refreshedPaths: string[];
  synchronizedFiles: WorkspaceSourceFileSyncResult[];
}

function isSubPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function sameSnapshot(left: WorkspaceSourceSnapshot, right: WorkspaceSourceSnapshot): boolean {
  return left.size === right.size && Math.abs(left.mtimeMs - right.mtimeMs) < 1;
}

async function snapshotFile(filePath: string): Promise<WorkspaceSourceSnapshot | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  return stat?.isFile() ? { mtimeMs: stat.mtimeMs, size: stat.size } : null;
}

async function hashFile(filePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function filesMatch(
  sourcePath: string,
  aiPath: string,
  sourceSnapshot: WorkspaceSourceSnapshot,
  aiSnapshot: WorkspaceSourceSnapshot | null,
  verifyContentWhenMetadataEqual: boolean,
): Promise<boolean> {
  if (!aiSnapshot || !sameSnapshot(sourceSnapshot, aiSnapshot)) return false;
  if (!verifyContentWhenMetadataEqual) return true;
  const [sourceHash, aiHash] = await Promise.all([hashFile(sourcePath), hashFile(aiPath)]);
  return sourceHash === aiHash;
}

/**
 * Refresh one AI-workspace copy from its authoritative user file. The copy is
 * written atomically and receives the source timestamps so later checks can
 * cheaply detect a user save without trusting the older AI copy.
 */
export async function synchronizeSourceFileToAiWorkspace(
  sourcePath: string,
  aiPath: string,
  options: { verifyContentWhenMetadataEqual?: boolean; captureSourceHash?: boolean } = {},
): Promise<WorkspaceSourceFileSyncResult> {
  const source = path.resolve(sourcePath);
  const target = path.resolve(aiPath);
  const sourceSnapshot = await snapshotFile(source);
  if (!sourceSnapshot) throw new Error(`用户源文件不存在: ${source}`);
  const aiSnapshot = await snapshotFile(target);
  const matches = await filesMatch(
    source,
    target,
    sourceSnapshot,
    aiSnapshot,
    options.verifyContentWhenMetadataEqual === true,
  );
  if (matches) {
    const capturedSnapshot = options.captureSourceHash === true
      ? { ...sourceSnapshot, sha256: await hashFile(source) }
      : sourceSnapshot;
    return { sourcePath: source, aiPath: target, sourceSnapshot: capturedSnapshot, copied: false };
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporaryPath = `${target}.${process.pid}.${randomUUID()}.source-sync.tmp`;
  try {
    await fs.copyFile(source, temporaryPath);
    const sourceAfterCopy = await snapshotFile(source);
    if (!sourceAfterCopy || !sameSnapshot(sourceSnapshot, sourceAfterCopy)) {
      throw new Error(`用户源文件在同步过程中发生变化，请重试: ${source}`);
    }
    await fs.utimes(temporaryPath, new Date(sourceSnapshot.mtimeMs), new Date(sourceSnapshot.mtimeMs));
    await fs.rm(target, { force: true });
    await fs.rename(temporaryPath, target);
    const capturedSnapshot = options.captureSourceHash === true
      ? { ...sourceSnapshot, sha256: await hashFile(source) }
      : sourceSnapshot;
    return { sourcePath: source, aiPath: target, sourceSnapshot: capturedSnapshot, copied: true };
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/**
 * Before a coding Agent turn, refresh only files that already have a matching
 * path in the user source tree. AI-only outputs are deliberately left alone.
 */
export async function refreshSourceBackedAiWorkspace(
  configuredRoot: string,
  aiWorkRoot: string,
  options: { maxScannedFiles?: number; captureSourceHash?: boolean } = {},
): Promise<WorkspaceSourceRefreshResult> {
  const sourceRoot = path.resolve(configuredRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  const relativeAiRoot = path.relative(sourceRoot, aiRoot);
  const insideAuthorizedRoot = isSubPath(sourceRoot, aiRoot);
  const insideAiContainer = relativeAiRoot
    .split(/[\\/]+/)
    .some(segment => segment.toLowerCase() === AI_WORKSPACE_CONTAINER_NAME.toLowerCase());
  if (!insideAuthorizedRoot || !insideAiContainer || sourceRoot === aiRoot) {
    return {
      scanned: 0,
      matched: 0,
      refreshed: 0,
      unchanged: 0,
      truncated: false,
      refreshedPaths: [],
      synchronizedFiles: [],
    };
  }

  const maxScannedFiles = Math.max(1, Math.min(50_000, Number(options.maxScannedFiles) || DEFAULT_MAX_SCANNED_FILES));
  const pending = [aiRoot];
  const refreshedPaths: string[] = [];
  const synchronizedFiles: WorkspaceSourceFileSyncResult[] = [];
  let scanned = 0;
  let matched = 0;
  let refreshed = 0;
  let unchanged = 0;
  let truncated = false;

  while (pending.length && scanned < maxScannedFiles) {
    const directory = pending.shift()!;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (scanned >= maxScannedFiles) {
        truncated = true;
        break;
      }
      if (entry.name === '.git') continue;
      const aiPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(aiPath);
        continue;
      }
      if (!entry.isFile() || AI_WORKSPACE_README_PATTERN.test(entry.name)) continue;
      scanned += 1;
      const relativePath = path.relative(aiRoot, aiPath);
      const sourcePath = path.resolve(sourceRoot, relativePath);
      if (!isSubPath(sourceRoot, sourcePath) || isSubPath(aiRoot, sourcePath)) continue;
      const sourceSnapshot = await snapshotFile(sourcePath);
      if (!sourceSnapshot) continue;
      matched += 1;
      const result = await synchronizeSourceFileToAiWorkspace(sourcePath, aiPath, {
        verifyContentWhenMetadataEqual: true,
        captureSourceHash: options.captureSourceHash === true,
      });
      synchronizedFiles.push(result);
      if (result.copied) {
        refreshed += 1;
        refreshedPaths.push(relativePath);
      } else {
        unchanged += 1;
      }
    }
  }
  if (pending.length) truncated = true;
  if (refreshed > 0) {
    logger.info(`[WorkspaceSourceSync] Refreshed ${refreshed}/${matched} source-backed AI workspace files in ${aiRoot}`);
  }
  return { scanned, matched, refreshed, unchanged, truncated, refreshedPaths, synchronizedFiles };
}

export function workspaceSourceSnapshotMatches(
  left: WorkspaceSourceSnapshot,
  right: WorkspaceSourceSnapshot,
): boolean {
  return sameSnapshot(left, right)
    && (!left.sha256 || !right.sha256 || left.sha256 === right.sha256);
}

export async function readWorkspaceSourceSnapshot(
  filePath: string,
  options: { captureHash?: boolean } = {},
): Promise<WorkspaceSourceSnapshot | null> {
  const snapshot = await snapshotFile(filePath);
  if (!snapshot || options.captureHash !== true) return snapshot;
  return { ...snapshot, sha256: await hashFile(filePath) };
}
