import { existsSync, readFileSync } from 'fs';
import * as path from 'path';

import { getDataDir } from './paths';

export interface PythonPluginConfig {
  pythonPath?: string;
  installDir?: string;
  updatedAt?: string;
}

export function getPythonPluginConfigPath(): string {
  return path.join(getDataDir(), 'python-plugin-config.json');
}

export function readPythonPluginConfigSync(): PythonPluginConfig {
  try {
    const raw = readFileSync(getPythonPluginConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as PythonPluginConfig;
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

export function buildPythonRuntimeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const config = readPythonPluginConfigSync();
  const dirs = new Set<string>();
  const candidates = [
    cleanPathValue(config.pythonPath),
    cleanPathValue(baseEnv.SCHOLAR_HARNESS_PYTHON),
    cleanPathValue(baseEnv.PYTHON_PATH),
    cleanPathValue(baseEnv.PYTHON_EXECUTABLE),
    cleanPathValue(baseEnv.PYTHON),
  ].filter(Boolean);

  addExistingDir(dirs, config.installDir);

  let selectedPython = '';
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate) || existsSync(candidate)) {
      selectedPython = candidate;
      if (path.isAbsolute(candidate)) addExistingDir(dirs, path.dirname(candidate));
      break;
    }
  }

  if (selectedPython) {
    env.PYTHON_PATH = selectedPython;
    env.PYTHON_EXECUTABLE = selectedPython;
    env.SCHOLAR_HARNESS_PYTHON = selectedPython;
  }

  env.PYTHONUTF8 = env.PYTHONUTF8 || '1';
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || 'utf-8';
  prependPathDirs(env, Array.from(dirs));
  return env;
}
