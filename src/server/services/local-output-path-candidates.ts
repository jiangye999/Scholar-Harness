import * as fs from 'fs';
import * as path from 'path';

const SAFE_WORKSPACE_DIR_NAME = 'ScholarHarness_AI_Workspaces';

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function uniqueResolvedPaths(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach(value => {
    const text = String(value || '').trim();
    if (!text) return;
    const resolved = path.resolve(text);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(resolved);
  });
  return result;
}

function getSafeWorkspaceRelativePath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const parsed = path.parse(resolved);
  const segments = path.relative(parsed.root, resolved).split(path.sep).filter(Boolean);
  const safeRootIndex = segments.findIndex(
    segment => segment.toLowerCase() === SAFE_WORKSPACE_DIR_NAME.toLowerCase(),
  );
  if (safeRootIndex < 0 || safeRootIndex + 2 >= segments.length) return '';
  return segments.slice(safeRootIndex + 2).join(path.sep);
}

function getMostSpecificRootRelativePath(filePath: string, knownRoots: string[]): string {
  const resolved = path.resolve(filePath);
  const containingRoots = uniqueResolvedPaths(knownRoots)
    .filter(root => isPathInside(root, resolved))
    .sort((left, right) => right.length - left.length);
  if (!containingRoots.length) return '';
  const relative = path.relative(containingRoots[0], resolved);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : '';
}

/**
 * Rebuild the same artifact location under the currently active workspace root.
 *
 * Example:
 * old-run/plots/figure.png -> current-run/plots/figure.png
 *
 * This is intentionally path-based rather than basename-only so that unrelated
 * files such as several different plots/figure.png files are not mixed.
 */
export function getMirroredLocalOutputCandidatePaths(
  rawPath: unknown,
  primaryRoots: string[],
  knownRoots: string[],
): string[] {
  const value = String(rawPath || '').trim();
  if (!value || /^https?:\/\//i.test(value)) return [];

  const roots = uniqueResolvedPaths(primaryRoots);
  if (!roots.length) return [];

  const relativePaths: string[] = [];
  if (path.isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value)) {
    const safeWorkspaceRelative = getSafeWorkspaceRelativePath(value);
    const rootedRelative = getMostSpecificRootRelativePath(value, knownRoots);
    if (safeWorkspaceRelative) relativePaths.push(safeWorkspaceRelative);
    if (rootedRelative) relativePaths.push(rootedRelative);
  } else if (!value.includes(':') && !/[<>|]/.test(value)) {
    relativePaths.push(value);
  }

  const candidates: string[] = [];
  roots.forEach(root => {
    relativePaths.forEach(relativePath => {
      const candidate = path.resolve(root, relativePath);
      if (isPathInside(root, candidate)) candidates.push(candidate);
    });
  });
  return uniqueResolvedPaths(candidates);
}

export function pickNewestExistingLocalOutputPath(
  candidates: string[],
  allowedRoots: string[],
  allowedExtensions: ReadonlySet<string>,
): string | null {
  const roots = uniqueResolvedPaths(allowedRoots);
  let bestPath = '';
  let bestMtimeMs = -1;

  uniqueResolvedPaths(candidates).forEach(candidate => {
    if (!roots.some(root => isPathInside(root, candidate))) return;
    if (!allowedExtensions.has(path.extname(candidate).toLowerCase())) return;
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) return;
      if (stat.mtimeMs > bestMtimeMs) {
        bestPath = candidate;
        bestMtimeMs = stat.mtimeMs;
      }
    } catch {
      // Output files can be replaced atomically while candidates are checked.
    }
  });

  return bestPath || null;
}
