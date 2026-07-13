import { existsSync, readFileSync, readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getDataDir } from './paths';

interface RPluginConfig {
  rscriptPath?: string;
  installDir?: string;
  packageInstallAt?: string;
  updatedAt?: string;
}

export function getRRuntimeRoot(): string {
  return path.join(getDataDir(), 'r-runtime');
}

export function getRPluginConfigPath(): string {
  return path.join(getDataDir(), 'r-plugin-config.json');
}

export function readRPluginConfigSync(): RPluginConfig {
  try {
    const raw = readFileSync(getRPluginConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw) as RPluginConfig;
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

function addRInstallDir(dirs: Set<string>, installDir: unknown): void {
  const dir = cleanPathValue(installDir);
  if (!dir) return;
  addExistingDir(dirs, path.join(dir, 'bin'));
  addExistingDir(dirs, path.join(dir, 'bin', 'x64'));
}

function addRuntimeRInstallDirs(dirs: Set<string>): void {
  const runtimeRoot = getRRuntimeRoot();
  addRInstallDir(dirs, runtimeRoot);
  addRInstallDir(dirs, path.join(runtimeRoot, 'R'));
  try {
    for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^R-/i.test(entry.name)) continue;
      addRInstallDir(dirs, path.join(runtimeRoot, entry.name));
    }
  } catch {
    // The portable R runtime is optional.
  }
}

function inferRHomeFromRscriptPath(rscriptPath: string): string {
  if (!rscriptPath || !path.isAbsolute(rscriptPath)) return '';
  const scriptDir = path.dirname(rscriptPath);
  const scriptDirName = path.basename(scriptDir).toLowerCase();
  const parentDir = path.dirname(scriptDir);
  const parentName = path.basename(parentDir).toLowerCase();
  if ((scriptDirName === 'x64' || scriptDirName === 'i386') && parentName === 'bin') {
    return path.dirname(parentDir);
  }
  if (scriptDirName === 'bin') {
    return parentDir;
  }
  return '';
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

function getDefaultRUserLibrary(env: NodeJS.ProcessEnv): string {
  if (process.platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || process.env.LOCALAPPDATA;
    if (localAppData) return path.join(localAppData, 'ScholarHarness', 'R-library');
  }
  return path.join(os.homedir(), '.scholarharness', 'R-library');
}

export function buildRRuntimeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  const config = readRPluginConfigSync();
  const dirs = new Set<string>();
  const rscriptCandidates = [
    cleanPathValue(config.rscriptPath),
    cleanPathValue(baseEnv.RSCRIPT_PATH),
  ].filter(Boolean);

  addRInstallDir(dirs, config.installDir);
  addRInstallDir(dirs, baseEnv.R_HOME);
  addRuntimeRInstallDirs(dirs);

  let selectedRscript = '';
  for (const candidate of rscriptCandidates) {
    if (!candidate) continue;
    if (!path.isAbsolute(candidate) || existsSync(candidate)) {
      selectedRscript = candidate;
      if (path.isAbsolute(candidate)) addExistingDir(dirs, path.dirname(candidate));
      break;
    }
  }

  if (selectedRscript) {
    env.RSCRIPT_PATH = selectedRscript;
    env.SCHOLAR_HARNESS_RSCRIPT = selectedRscript;
    const inferredRHome = inferRHomeFromRscriptPath(selectedRscript);
    if (inferredRHome && existsSync(inferredRHome)) {
      env.R_HOME = inferredRHome;
      addRInstallDir(dirs, inferredRHome);
    }
  }

  const rUserLibrary = cleanPathValue(baseEnv.R_LIBS_USER) || getDefaultRUserLibrary(env);
  if (rUserLibrary) {
    env.R_LIBS_USER = rUserLibrary;
  }

  prependPathDirs(env, Array.from(dirs));
  return env;
}
