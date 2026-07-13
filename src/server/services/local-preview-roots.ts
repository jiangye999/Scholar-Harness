import * as path from 'path';

const authorizedLocalPreviewRoots = new Set<string>();

export function authorizeLocalPreviewRoot(rootPath: unknown): void {
  const raw = String(rootPath || '').trim();
  if (!raw) return;
  authorizedLocalPreviewRoots.add(path.resolve(raw));
}

export function getAuthorizedLocalPreviewRoots(): string[] {
  return Array.from(authorizedLocalPreviewRoots);
}
