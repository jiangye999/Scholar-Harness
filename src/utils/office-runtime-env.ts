import { existsSync, readFileSync, statSync } from 'fs';
import * as path from 'path';

import { getDataDir } from './paths';

export interface OfficeCliPluginConfig {
  officeCliPath?: string;
  installDir?: string;
  updatedAt?: string;
}

export function getOfficeCliPluginConfigPath(): string {
  return path.join(getDataDir(), 'office-plugin-config.json');
}

export function getOfficeCliRuntimeRoot(): string {
  return path.join(getDataDir(), 'officecli-runtime');
}

export function readOfficeCliPluginConfigSync(): OfficeCliPluginConfig {
  try {
    const raw = readFileSync(getOfficeCliPluginConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as OfficeCliPluginConfig;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function cleanPathValue(value: unknown): string {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function addExistingDir(dirs: Set<string>, value: unknown): void {
  const dir = cleanPathValue(value);
  if (!dir) return;
  if (existsSync(dir)) dirs.add(path.resolve(dir));
}

function findPathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function prependPathDirs(env: NodeJS.ProcessEnv, dirs: string[]): void {
  if (!dirs.length) return;
  const pathKey = findPathEnvKey(env);
  const currentPath = env[pathKey] || '';
  const existingParts = currentPath.split(path.delimiter).filter(Boolean);
  const seen = new Set(existingParts.map(item => process.platform === 'win32' ? item.toLowerCase() : item));
  const nextParts: string[] = [];
  for (const dir of dirs) {
    const normalized = path.resolve(dir);
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized;
    if (seen.has(key)) continue;
    seen.add(key);
    nextParts.push(normalized);
  }
  env[pathKey] = [...nextParts, ...existingParts].join(path.delimiter);
  if (pathKey !== 'PATH') {
    delete env.PATH;
  }
}

export function normalizeOfficeCliExecutable(value: string): string {
  const cleaned = cleanPathValue(value);
  if (!cleaned) return '';
  try {
    if (existsSync(cleaned)) {
      const stat = statSync(cleaned);
      if (stat.isDirectory()) {
        return path.join(cleaned, process.platform === 'win32' ? 'officecli.exe' : 'officecli');
      }
    }
  } catch {
    // Keep original path and let status/path validation report the real error.
  }
  return cleaned;
}

export function buildOfficeCliRuntimeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const config = readOfficeCliPluginConfigSync();
  const dirs = new Set<string>();
  const candidates = [
    normalizeOfficeCliExecutable(cleanPathValue(config.officeCliPath)),
    normalizeOfficeCliExecutable(cleanPathValue(baseEnv.SCHOLAR_HARNESS_OFFICECLI)),
    normalizeOfficeCliExecutable(cleanPathValue(baseEnv.OFFICECLI_PATH)),
    normalizeOfficeCliExecutable(cleanPathValue(baseEnv.OFFICECLI_EXECUTABLE)),
  ].filter(Boolean);

  addExistingDir(dirs, config.installDir);

  let selectedOfficeCli = '';
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate) || existsSync(candidate)) {
      selectedOfficeCli = candidate;
      if (path.isAbsolute(candidate)) addExistingDir(dirs, path.dirname(candidate));
      break;
    }
  }

  if (selectedOfficeCli) {
    env.OFFICECLI_PATH = selectedOfficeCli;
    env.OFFICECLI_EXECUTABLE = selectedOfficeCli;
    env.SCHOLAR_HARNESS_OFFICECLI = selectedOfficeCli;
  }
  env.OFFICECLI_SKIP_UPDATE = env.OFFICECLI_SKIP_UPDATE || '1';

  prependPathDirs(env, Array.from(dirs));
  return env;
}
