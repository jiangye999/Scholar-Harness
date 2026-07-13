import { spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';
import {
  getPythonPluginConfigPath,
  readPythonPluginConfigSync,
  type PythonPluginConfig,
} from '../../utils/python-runtime-env';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';

const router = Router();

const pythonPathSchema = z.object({
  pythonPath: z.string().min(1).max(1000),
});

interface PythonStatus {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function cleanPathValue(value: unknown): string {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

function normalizePythonExecutable(value: string): string {
  const cleaned = cleanPathValue(value);
  if (!cleaned) return '';
  try {
    if (existsSync(cleaned) && statSync(cleaned).isDirectory()) {
      return path.join(cleaned, process.platform === 'win32' ? 'python.exe' : 'python');
    }
  } catch {
    // Keep original path and let validation return the real error.
  }
  return cleaned;
}

async function writePythonPluginConfig(config: PythonPluginConfig): Promise<void> {
  const next = {
    ...readPythonPluginConfigSync(),
    ...config,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(getPythonPluginConfigPath(), JSON.stringify(next, null, 2), 'utf-8');
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: buildToolRuntimeEnv(process.env),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
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
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });
  });
}

async function listWhereCandidates(command: string): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  try {
    const result = await runProcess('where.exe', [command], process.cwd(), 10_000);
    if (result.exitCode !== 0) return [];
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function listWindowsPythonSearchRoots(): Promise<string[]> {
  const roots = new Set<string>();
  const envRoots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : '',
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Python') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Python') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'Python') : '',
    'C:\\',
  ].filter(Boolean);
  envRoots.forEach(item => roots.add(item));
  return Array.from(roots);
}

async function listPythonCandidates(): Promise<string[]> {
  const config = readPythonPluginConfigSync();
  const candidates = new Set<string>();
  [
    config.pythonPath,
    process.env.SCHOLAR_HARNESS_PYTHON,
    process.env.PYTHON_PATH,
    process.env.PYTHON_EXECUTABLE,
    process.env.PYTHON,
  ].map(cleanPathValue).filter(Boolean).forEach(item => candidates.add(normalizePythonExecutable(item)));

  candidates.add(process.platform === 'win32' ? 'python.exe' : 'python3');
  candidates.add('python');
  candidates.add('python3');
  if (process.platform === 'win32') {
    candidates.add('py.exe');
    const wherePython = await listWhereCandidates('python.exe');
    const wherePython3 = await listWhereCandidates('python3.exe');
    const wherePy = await listWhereCandidates('py.exe');
    [...wherePython, ...wherePython3, ...wherePy].forEach(item => candidates.add(item));

    for (const root of await listWindowsPythonSearchRoots()) {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        entries
          .filter(entry => entry.isDirectory() && /^Python\d+/i.test(entry.name))
          .map(entry => path.join(root, entry.name, 'python.exe'))
          .forEach(item => candidates.add(item));
      } catch {
        // Common Python search root does not exist.
      }
    }
  } else {
    ['/usr/local/bin/python3', '/usr/bin/python3', '/opt/homebrew/bin/python3'].forEach(item => candidates.add(item));
  }
  return Array.from(candidates).filter(Boolean);
}

async function getPythonStatus(): Promise<PythonStatus> {
  const candidates = await listPythonCandidates();
  let lastError = '未找到 Python。请安装 Python，或在配置中心设置 python.exe/python3 路径。';
  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate) && !existsSync(candidate)) continue;
      const result = await runProcess(candidate, ['--version'], process.cwd(), 10_000);
      const versionText = (result.stdout || result.stderr).trim();
      if (result.exitCode === 0 && /Python\s+\d+/i.test(versionText)) {
        return {
          available: true,
          path: candidate,
          version: versionText,
        };
      }
      lastError = (result.stderr || result.stdout || `Python exited with code ${result.exitCode}`).trim();
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  return { available: false, path: candidates[0] || '', error: lastError };
}

router.get('/status', async (_req, res) => {
  try {
    const status = await getPythonStatus();
    res.json({
      success: true,
      data: {
        ...status,
        configPath: getPythonPluginConfigPath(),
      },
    });
  } catch (error) {
    logger.error('[PythonPlugin] Status error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/auto-detect', async (_req, res) => {
  try {
    const status = await getPythonStatus();
    if (status.available && status.path) {
      await writePythonPluginConfig({ pythonPath: status.path });
    }
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('[PythonPlugin] Auto-detect error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/path', async (req, res) => {
  try {
    const parsed = pythonPathSchema.parse(req.body || {});
    const pythonPath = normalizePythonExecutable(parsed.pythonPath);
    const result = await runProcess(pythonPath, ['--version'], process.cwd(), 10_000);
    const versionText = (result.stdout || result.stderr).trim();
    if (result.exitCode !== 0 || result.timedOut || !/Python\s+\d+/i.test(versionText)) {
      return res.status(400).json({
        success: false,
        error: result.timedOut
          ? 'Python 路径检测超时'
          : `该路径无法运行 Python：${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
      });
    }
    await writePythonPluginConfig({
      pythonPath,
      installDir: path.isAbsolute(pythonPath) ? path.dirname(pythonPath) : undefined,
    });
    res.json({
      success: true,
      data: {
        available: true,
        path: pythonPath,
        version: versionText,
      },
    });
  } catch (error) {
    logger.error('[PythonPlugin] Save path error:', error);
    const message = error instanceof z.ZodError
      ? error.errors.map(item => item.message).join('; ')
      : (error as Error).message;
    res.status(400).json({ success: false, error: message || '保存 Python 路径失败' });
  }
});

export default router;
