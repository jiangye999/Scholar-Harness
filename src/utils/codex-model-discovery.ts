import * as fs from 'fs';
import * as path from 'path';

const MODEL_SLUG_PATTERN = /^gpt-\d+(?:\.\d+)+(?:-[a-z0-9][a-z0-9._-]*)?$/i;

function addModelSlug(target: Map<string, number>, value: unknown): void {
  const slug = String(value || '').trim().toLowerCase();
  if (!MODEL_SLUG_PATTERN.test(slug)) return;
  target.set(slug, (target.get(slug) || 0) + 1);
}

export function extractCodexConfiguredModelSlugs(text: string): string[] {
  const counts = new Map<string, number>();
  const content = String(text || '');
  let match: RegExpExecArray | null;

  const tomlModel = /^\s*model\s*=\s*"([^"]+)"\s*$/gim;
  while ((match = tomlModel.exec(content)) !== null) addModelSlug(counts, match[1]);

  const availabilityEntry = /^\s*"(gpt-[^"]+)"\s*=\s*\d+\s*$/gim;
  while ((match = availabilityEntry.exec(content)) !== null) addModelSlug(counts, match[1]);

  return Array.from(counts.keys());
}

export function extractCodexSessionModelCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const content = String(text || '');
  let match: RegExpExecArray | null;
  const jsonModel = /"model"\s*:\s*"([^"]+)"/gi;
  while ((match = jsonModel.exec(content)) !== null) addModelSlug(counts, match[1]);
  return counts;
}

function readFileEdges(filePath: string, maxBytes = 512 * 1024): string {
  const stat = fs.statSync(filePath);
  if (stat.size <= maxBytes * 2) return fs.readFileSync(filePath, 'utf-8');
  const handle = fs.openSync(filePath, 'r');
  try {
    const first = Buffer.alloc(maxBytes);
    const last = Buffer.alloc(maxBytes);
    const firstLength = fs.readSync(handle, first, 0, maxBytes, 0);
    const lastLength = fs.readSync(handle, last, 0, maxBytes, Math.max(0, stat.size - maxBytes));
    return first.subarray(0, firstLength).toString('utf-8') + '\n' + last.subarray(0, lastLength).toString('utf-8');
  } finally {
    fs.closeSync(handle);
  }
}

function listRecentSessionFiles(root: string, maxFiles: number): string[] {
  if (!fs.existsSync(root)) return [];
  const files: Array<{ filePath: string; mtimeMs: number }> = [];
  const stack = [root];
  let visited = 0;
  while (stack.length > 0 && visited < 6000) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      visited += 1;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.jsonl')) {
        try {
          files.push({ filePath: fullPath, mtimeMs: fs.statSync(fullPath).mtimeMs });
        } catch {
          // Ignore files removed while the directory is being scanned.
        }
      }
      if (visited >= 6000) break;
    }
  }
  return files
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, maxFiles)
    .map(item => item.filePath);
}

export function discoverCodexLocalModelSlugs(codexHome: string): string[] {
  const configured = new Set<string>();
  const configPath = path.join(codexHome, 'config.toml');
  try {
    extractCodexConfiguredModelSlugs(fs.readFileSync(configPath, 'utf-8')).forEach(slug => configured.add(slug));
  } catch {
    // A missing config is valid for a fresh Codex installation.
  }

  const sessionCounts = new Map<string, number>();
  const sessionFiles = [
    ...listRecentSessionFiles(path.join(codexHome, 'sessions'), 100),
    ...listRecentSessionFiles(path.join(codexHome, 'archived_sessions'), 30),
  ];
  for (const filePath of sessionFiles) {
    try {
      for (const [slug, count] of extractCodexSessionModelCounts(readFileEdges(filePath))) {
        sessionCounts.set(slug, (sessionCounts.get(slug) || 0) + count);
      }
    } catch {
      // Ignore a session that is being written or rotated.
    }
  }

  for (const [slug, count] of sessionCounts) {
    if (count >= 2) configured.add(slug);
  }
  return Array.from(configured).sort();
}
