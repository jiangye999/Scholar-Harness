import { existsSync, realpathSync } from 'fs';
import * as path from 'path';

function normalizeForComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
export function isPathWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeForComparison(root);
  const normalizedCandidate = normalizeForComparison(candidate);
  return normalizedCandidate === normalizedRoot
    || normalizedCandidate.startsWith(
      normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`
    );
}

function findClosestExistingAncestor(candidate: string): string {
  let current = path.resolve(candidate);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error('无法确定目标路径的现有父目录');
    }
    current = parent;
  }
  return current;
}

/**
 * Enforces both lexical and canonical containment. The canonical check blocks
 * a path such as `<workspace>/link/outside.txt` when `link` points outside the
 * user-authorized root, while still allowing new descendants below a real
 * directory inside that root.
 */
export function assertPathAuthorizedByWorkspaceRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (!isPathWithinRoot(resolvedRoot, resolvedCandidate)) {
    throw new Error('路径超出工作目录授权范围');
  }

  let canonicalRoot: string;
  let canonicalAncestor: string;
  try {
    canonicalRoot = realpathSync.native(resolvedRoot);
    canonicalAncestor = realpathSync.native(findClosestExistingAncestor(resolvedCandidate));
  } catch {
    throw new Error('无法验证工作目录路径的真实位置');
  }
  if (!isPathWithinRoot(canonicalRoot, canonicalAncestor)) {
    throw new Error('路径通过符号链接或目录联接越出了工作目录授权范围');
  }
}
