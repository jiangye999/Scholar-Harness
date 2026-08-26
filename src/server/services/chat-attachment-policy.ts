import * as fs from 'fs';
import * as path from 'path';

import { getDataDir, sanitizeUserId } from '../../utils/paths';

export interface ChatAttachmentWorkspaceRoots {
  root?: string;
  aiWorkRoot?: string;
  safeWorkRoot?: string;
}

interface ChatAttachmentPathPolicyOptions {
  userId: string;
  workspace?: ChatAttachmentWorkspaceRoots;
  attachmentRoot?: string;
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRealPathIfPresent(targetPath: string): string | null {
  const resolved = path.resolve(targetPath);
  if (!fs.existsSync(resolved)) return null;
  return fs.realpathSync(resolved);
}

export function getAuthorizedChatAttachmentRoots(
  options: ChatAttachmentPathPolicyOptions,
): string[] {
  const uploadRoot = options.attachmentRoot
    || path.join(getDataDir(), 'chat-attachments', sanitizeUserId(options.userId));
  const roots = [
    uploadRoot,
    options.workspace?.root,
    options.workspace?.aiWorkRoot,
    options.workspace?.safeWorkRoot,
  ]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => resolveRealPathIfPresent(value) || path.resolve(value));
  return Array.from(new Set(roots));
}

/**
 * Resolve a client-referenced attachment without allowing that attachment to
 * widen the server's preview/read boundary. Existing symlinks are resolved
 * before the containment check so a link inside an allowed root cannot escape.
 */
export function resolveAuthorizedChatAttachmentPath(
  candidatePath: string,
  options: ChatAttachmentPathPolicyOptions,
): string {
  const rawPath = String(candidatePath || '').trim();
  if (!rawPath) throw new Error('附件路径为空');

  const realCandidate = resolveRealPathIfPresent(rawPath);
  if (!realCandidate) throw new Error(`附件不存在：${path.basename(rawPath) || rawPath}`);
  if (!fs.statSync(realCandidate).isFile()) {
    throw new Error(`附件不是文件：${path.basename(rawPath) || rawPath}`);
  }

  const allowed = getAuthorizedChatAttachmentRoots(options)
    .some(root => isPathInsideRoot(realCandidate, root));
  if (!allowed) {
    throw new Error(`附件不在当前用户上传目录或已授权工作目录中：${path.basename(rawPath) || rawPath}`);
  }
  return realCandidate;
}

export function resolveAuthorizedChatImagePaths(
  paths: unknown[],
  options: ChatAttachmentPathPolicyOptions,
): string[] {
  return Array.from(new Set(
    paths
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => resolveAuthorizedChatAttachmentPath(value, options)),
  ));
}
