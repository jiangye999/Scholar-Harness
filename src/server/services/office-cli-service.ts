import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  normalizeOfficeCliExecutable,
  readOfficeCliPluginConfigSync,
} from '../../utils/office-runtime-env';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';

export interface OfficeCliStatus {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

export interface OfficeCliProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

export function cleanOfficeCliPathValue(value: unknown): string {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

export function isOfficeDocumentPath(filePath: string): boolean {
  return ['.docx', '.xlsx', '.pptx'].includes(path.extname(filePath).toLowerCase());
}

export function isOfficeCliOutputPath(filePath: string): boolean {
  return ['.html', '.htm', '.png', '.jpg', '.jpeg', '.svg', '.pdf', '.json', '.txt'].includes(path.extname(filePath).toLowerCase());
}

export function formatOfficeCliPropValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export function appendOfficeCliProps(args: string[], props: unknown): void {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return;
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (!key || value === undefined) continue;
    args.push('--prop', `${key}=${formatOfficeCliPropValue(value)}`);
  }
}

function findPathEnvKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
}

function commandExists(command: string): boolean {
  if (!command) return false;
  if (!path.isAbsolute(command)) return true;
  return existsSync(command);
}

function resolveCommandFromPath(command: string): string | null {
  if (!command) return null;
  if (path.isAbsolute(command)) return existsSync(command) ? command : null;

  const env = buildToolRuntimeEnv(process.env);
  const pathKey = findPathEnvKey(env);
  const pathExts = process.platform === 'win32'
    ? (env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const candidates = (env[pathKey] || '')
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((dir) => {
      if (process.platform !== 'win32' || /\.[a-z0-9]+$/i.test(command)) {
        return [path.join(dir, command)];
      }
      return pathExts.map(ext => path.join(dir, `${command}${ext.toLowerCase()}`));
    });
  return candidates.find(candidate => existsSync(candidate)) || (commandExists(command) ? command : null);
}

export async function runOfficeCliProcess(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  input?: string
): Promise<OfficeCliProcessResult> {
  const executable = resolveCommandFromPath(command) || command;
  return new Promise((resolve, reject) => {
    const env = buildToolRuntimeEnv(process.env);
    const isWindowsPowerShellScript = process.platform === 'win32' && /\.ps1$/i.test(executable);
    const isWindowsBatchScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    const spawnCommand = isWindowsPowerShellScript
      ? 'powershell.exe'
      : (isWindowsBatchScript ? (process.env.ComSpec || 'cmd.exe') : executable);
    const spawnArgs = isWindowsPowerShellScript
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args]
      : (isWindowsBatchScript ? ['/d', '/c', 'call', executable, ...args] : args);
    const child = spawn(spawnCommand, spawnArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });
    if (input) {
      child.stdin?.write(input);
    }
    child.stdin?.end();
  });
}

async function listWhereCandidates(command: string): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  try {
    const result = await runOfficeCliProcess('where.exe', [command], process.cwd(), 10_000);
    if (result.exitCode !== 0) return [];
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function listOfficeCliCandidates(commandOverride?: string): Promise<string[]> {
  const config = readOfficeCliPluginConfigSync();
  const candidates = new Set<string>();
  [
    commandOverride,
    config.officeCliPath,
    process.env.SCHOLAR_HARNESS_OFFICECLI,
    process.env.OFFICECLI_PATH,
    process.env.OFFICECLI_EXECUTABLE,
  ].map(cleanOfficeCliPathValue).filter(Boolean).forEach(item => candidates.add(normalizeOfficeCliExecutable(item)));

  if (process.platform === 'win32') {
    candidates.add('officecli.exe');
    candidates.add('officecli.cmd');
    candidates.add('officecli');
    const appData = process.env.APPDATA || '';
    const localAppData = process.env.LOCALAPPDATA || '';
    const programFiles = process.env.ProgramFiles || '';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || '';
    [
      appData ? path.join(appData, 'npm', 'officecli.cmd') : '',
      appData ? path.join(appData, 'npm', 'officecli.exe') : '',
      localAppData ? path.join(localAppData, 'Programs', 'officecli', 'officecli.exe') : '',
      programFiles ? path.join(programFiles, 'OfficeCLI', 'officecli.exe') : '',
      programFilesX86 ? path.join(programFilesX86, 'OfficeCLI', 'officecli.exe') : '',
    ].filter(Boolean).forEach(item => candidates.add(item));
    const whereOfficeCli = await listWhereCandidates('officecli');
    const whereOfficeCliExe = await listWhereCandidates('officecli.exe');
    [...whereOfficeCli, ...whereOfficeCliExe].forEach(item => candidates.add(item));
  } else {
    candidates.add('officecli');
    ['/usr/local/bin/officecli', '/opt/homebrew/bin/officecli', '/usr/bin/officecli'].forEach(item => candidates.add(item));
  }
  return Array.from(candidates).filter(Boolean);
}

export async function getOfficeCliStatus(commandOverride?: string): Promise<OfficeCliStatus> {
  const candidates = await listOfficeCliCandidates(commandOverride);
  let lastError = '未找到 OfficeCLI。请安装 officecli，或在配置中心设置 officecli 可执行文件路径。';
  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate)) {
        if (!existsSync(candidate)) continue;
        const stat = statSync(candidate);
        if (stat.isDirectory()) continue;
      }
      const result = await runOfficeCliProcess(candidate, ['--version'], process.cwd(), 10_000);
      const versionText = (result.stdout || result.stderr).trim();
      if (result.exitCode === 0 && versionText) {
        return {
          available: true,
          path: candidate,
          version: versionText,
        };
      }
      lastError = (result.stderr || result.stdout || `OfficeCLI exited with code ${result.exitCode}`).trim();
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  return { available: false, path: candidates[0] || '', error: lastError };
}

export async function ensureOfficeCliAvailable(): Promise<string> {
  const status = await getOfficeCliStatus();
  if (!status.available || !status.path) {
    throw new Error(status.error || 'OfficeCLI 不可用，请先在配置中心配置 OfficeCLI 插件。');
  }
  return status.path;
}

export async function writeJsonTempFile(dir: string, prefix: string, payload: unknown): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
  return filePath;
}
