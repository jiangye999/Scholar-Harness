import { execFileSync, spawn, type ChildProcess } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

function cleanCommand(value: unknown): string {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.cmd', '.exe', '.com', '.bat'] as const;

/**
 * Windows `where` can return an extensionless Unix shim before the runnable
 * `.cmd` shim (notably `C:\\Program Files\\nodejs\\npm`). Node's spawn cannot
 * execute that shim with `shell: false`, so normalize every direct and PATH
 * candidate to a Windows-runnable file before returning it.
 */
export function selectWindowsRuntimeExecutable(
  values: unknown[],
  fileExists: (candidate: string) => boolean = existsSync,
): string | null {
  const ranked = new Map<string, { path: string; priority: number; order: number }>();
  let order = 0;
  const add = (candidate: string, priority: number): void => {
    const normalized = cleanCommand(candidate);
    if (!normalized || !fileExists(normalized)) return;
    const key = normalized.toLowerCase();
    const previous = ranked.get(key);
    if (!previous || priority < previous.priority) {
      ranked.set(key, { path: normalized, priority, order: order++ });
    }
  };

  for (const value of values) {
    const candidate = cleanCommand(value);
    if (!candidate) continue;
    const extension = path.win32.extname(candidate).toLowerCase();
    const extensionIndex = WINDOWS_EXECUTABLE_EXTENSIONS.indexOf(
      extension as (typeof WINDOWS_EXECUTABLE_EXTENSIONS)[number],
    );
    if (extensionIndex >= 0) {
      add(candidate, extensionIndex);
      continue;
    }
    if (extension) continue;
    WINDOWS_EXECUTABLE_EXTENSIONS.forEach((suffix, index) => add(`${candidate}${suffix}`, index));
  }

  return Array.from(ranked.values())
    .sort((left, right) => left.priority - right.priority || left.order - right.order)[0]?.path || null;
}

function resolveWithPath(command: string): string | null {
  try {
    const locator = process.platform === 'win32' ? 'where.exe' : 'which';
    const output = execFileSync(locator, [command], {
      encoding: 'utf-8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const resolved = String(output || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    return process.platform === 'win32'
      ? selectWindowsRuntimeExecutable(resolved)
      : resolved[0] || null;
  } catch {
    return null;
  }
}

export function resolveRuntimeExecutable(configured: unknown, commands: string[]): string | null {
  const candidates = [cleanCommand(configured), ...commands.map(cleanCommand)].filter(Boolean);
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  if (process.platform === 'win32') {
    const scoopShims = path.join(os.homedir(), 'scoop', 'shims');
    for (const command of commands) {
      candidates.push(path.join(appData, 'npm', `${command}.cmd`));
      candidates.push(path.join(appData, 'npm', `${command}.exe`));
      candidates.push(path.join(scoopShims, `${command}.exe`));
      candidates.push(path.join(scoopShims, `${command}.cmd`));
    }
  }
  for (const candidate of candidates) {
    if (process.platform === 'win32') {
      const direct = selectWindowsRuntimeExecutable([candidate]);
      if (direct) return direct;
    } else if (existsSync(candidate)) {
      return candidate;
    }
    const resolved = resolveWithPath(candidate);
    if (resolved) return resolved;
  }
  return null;
}

export function resolveNpmNodeShim(executable: string): { node: string; script: string } | null {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(executable)) return null;
  try {
    const source = readFileSync(executable, 'utf-8');
    const match = source.match(/%dp0%[\\/]([^"\r\n]+?\.js)"?\s+%\*/i);
    if (!match) return null;
    const script = path.resolve(path.dirname(executable), match[1].replace(/[\\/]+/g, path.sep));
    if (!existsSync(script)) return null;
    const siblingNode = path.join(path.dirname(executable), 'node.exe');
    const node = existsSync(siblingNode)
      ? siblingNode
      : resolveWithPath('node');
    return node ? { node, script } : null;
  } catch {
    return null;
  }
}

export function spawnRuntimeExecutable(
  executable: string,
  args: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
): ChildProcess {
  const env = { ...process.env, ...(options.env || {}) };
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable)) {
    // npm-generated shims ultimately run `node cli.js %*`. Launch that target
    // directly so stdin reaches long-lived JSONL/RPC processes such as Pi.
    const nodeShim = resolveNpmNodeShim(executable);
    if (nodeShim) {
      return spawn(nodeShim.node, [nodeShim.script, ...args], {
        cwd: options.cwd,
        env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }
    // Non-npm batch files keep the compatibility path. `call` is safe for
    // short-lived commands and handles nested batch scripts correctly.
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', executable, ...args], {
      cwd: options.cwd,
      env,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  return spawn(executable, args, {
    cwd: options.cwd,
    env,
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function captureRuntimeCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawnRuntimeExecutable(executable, args, {
      cwd: options.cwd || process.cwd(),
      env: options.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Runtime command timed out after ${options.timeoutMs || 10_000}ms`));
    }, options.timeoutMs || 10_000);
    timeout.unref?.();
    child.stdout?.on('data', chunk => { stdout += String(chunk); });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, code: Number(code ?? -1) });
    });
  });
}

export function parseRuntimeModelLines(text: string): string[] {
  const models = new Set<string>();
  let providerTable = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^provider\s{2,}model(?:\s{2,}|$)/i.test(line)) {
      providerTable = true;
      continue;
    }
    if (providerTable) {
      const columns = line.split(/\s{2,}/).map(item => item.trim()).filter(Boolean);
      if (columns.length >= 2 && /^[a-z0-9][a-z0-9_.-]*$/i.test(columns[0])) {
        const provider = columns[0];
        const model = columns[1];
        if (/^[a-z0-9][a-z0-9_.:/-]*$/i.test(model)) {
          models.add(`${provider}/${model}`);
          continue;
        }
      }
      providerTable = false;
    }
    const jsonCandidate = (() => {
      try { return JSON.parse(line) as unknown; } catch { return null; }
    })();
    if (Array.isArray(jsonCandidate)) {
      jsonCandidate.forEach(item => {
        const slug = typeof item === 'string'
          ? item
          : String((item as { id?: unknown; model?: unknown })?.id || (item as { model?: unknown })?.model || '');
        if (slug.trim()) models.add(slug.trim());
      });
      continue;
    }
    const match = line.match(/(?:^|\s)([a-z0-9_.-]+\/[a-z0-9][a-z0-9_.:/-]*|[a-z0-9][a-z0-9_.-]{2,})(?:\s|$)/i);
    if (match) models.add(match[1]);
  }
  return Array.from(models);
}
