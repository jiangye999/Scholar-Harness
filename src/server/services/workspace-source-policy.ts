import * as path from 'path';

/**
 * Directories that are generated, dependency-owned, or otherwise unsuitable
 * for the read-only source snapshot and ordinary Agent file discovery.
 *
 * Keep this policy shared between snapshot preparation and workspace search so
 * a directory excluded from the mirror cannot still dominate file_search.
 */
export const WORKSPACE_SOURCE_SKIP_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  '.turbo',
  '.next',
  '.venv',
  '__pycache__',
  'build',
  'coverage',
  'dist',
  'dist-electron',
  'logs',
  'node_modules',
  'temp',
  'tmp',
  'venv',
]);

const WORKSPACE_SOURCE_SKIP_FILE_NAMES = new Set([
  '.ds_store',
  'thumbs.db',
]);

const WORKSPACE_SOURCE_SKIP_EXTENSIONS = new Set([
  '.log',
  '.pyc',
  '.pyo',
  '.tmp',
]);

export function shouldSkipWorkspaceSourceDirectory(name: string): boolean {
  return WORKSPACE_SOURCE_SKIP_DIRECTORIES.has(String(name || '').trim().toLowerCase());
}

export function shouldSkipWorkspaceSourceFile(name: string): boolean {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) return true;
  if (WORKSPACE_SOURCE_SKIP_FILE_NAMES.has(normalized)) return true;
  if (WORKSPACE_SOURCE_SKIP_EXTENSIONS.has(path.extname(normalized))) return true;
  // Keep documented templates such as .env.example, but never mirror live
  // environment files that may contain credentials.
  if (normalized === '.env' || /^\.env\.(?!example$|sample$|template$)/i.test(normalized)) return true;
  return false;
}

export function shouldSkipWorkspaceSourceRelativePath(relativePath: string): boolean {
  const normalized = String(relativePath || '').replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (!segments.length) return true;
  if (segments.slice(0, -1).some(shouldSkipWorkspaceSourceDirectory)) return true;
  return shouldSkipWorkspaceSourceFile(segments[segments.length - 1]);
}
