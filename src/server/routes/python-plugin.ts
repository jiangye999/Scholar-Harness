import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
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

interface PythonInstallJob {
  id: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
  stage: string;
  progress: number;
  message: string;
  startedAt?: string;
  updatedAt?: string;
  packageManager?: string;
  pythonPath?: string;
  version?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

let currentPythonInstallJob: PythonInstallJob | null = null;

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

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number | null): Promise<ProcessResult> {
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
    const timeout = timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
        if (settled) return;
        timedOut = true;
        child.kill();
      }, timeoutMs)
      : null;

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });
  });
}

function updatePythonInstallJob(patch: Partial<PythonInstallJob>): void {
  if (!currentPythonInstallJob) return;
  currentPythonInstallJob = {
    ...currentPythonInstallJob,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

async function findAvailableCommand(candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    try {
      const result = await runProcess(candidate, ['--version'], process.cwd(), 10_000);
      if (result.exitCode === 0) return candidate;
    } catch {
      // Try the next package-manager candidate.
    }
  }
  return '';
}

async function installPythonWithSystemPackageManager(): Promise<ProcessResult> {
  if (process.platform === 'win32') {
    const winget = await findAvailableCommand(['winget.exe', 'winget']);
    if (!winget) {
      throw new Error('未检测到 Windows 程序包管理器 winget。请先在 Microsoft Store 安装“应用安装程序”，再重试一键安装。');
    }
    updatePythonInstallJob({
      stage: 'install',
      progress: 18,
      message: '正在通过 winget 安装 Python（安装过程可在后台继续）...',
      packageManager: 'winget',
    });
    const packageIds = ['Python.Python.3.12', 'Python.Python.3.13', 'Python.Python.3.14'];
    const failures: string[] = [];
    for (const packageId of packageIds) {
      updatePythonInstallJob({
        message: `正在通过 winget 安装 ${packageId.replace('Python.Python.', 'Python ')}（安装过程可在后台继续）...`,
      });
      const result = await runProcess(winget, [
        'install',
        '--id', packageId,
        '--exact',
        '--source', 'winget',
        '--scope', 'user',
        '--silent',
        '--accept-package-agreements',
        '--accept-source-agreements',
        '--disable-interactivity',
      ], process.cwd(), 30 * 60_000);
      if (result.exitCode === 0 && !result.timedOut) return result;
      failures.push(`${packageId}: ${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
    }
    return {
      exitCode: 1,
      timedOut: false,
      stdout: '',
      stderr: failures.join('\n\n').slice(-12_000),
    };
  }

  if (process.platform === 'darwin') {
    const brew = await findAvailableCommand(['/opt/homebrew/bin/brew', '/usr/local/bin/brew', 'brew']);
    if (!brew) {
      throw new Error('未检测到 Homebrew。请先安装 Homebrew，或从 python.org 安装 Python 后点击“自动检测”。');
    }
    updatePythonInstallJob({
      stage: 'install',
      progress: 18,
      message: '正在通过 Homebrew 安装 Python（安装过程可在后台继续）...',
      packageManager: 'Homebrew',
    });
    return await runProcess(brew, ['install', 'python'], process.cwd(), 30 * 60_000);
  }

  throw new Error(`当前平台暂不支持一键安装 Python：${process.platform}。请使用系统包管理器安装后点击“自动检测”。`);
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

async function runPythonInstallJob(): Promise<void> {
  if (!currentPythonInstallJob) return;
  try {
    updatePythonInstallJob({
      stage: 'detect',
      progress: 4,
      message: '正在检测本机已有的 Python...',
    });
    const existingStatus = await getPythonStatus();
    if (existingStatus.available && existingStatus.path) {
      await writePythonPluginConfig({
        pythonPath: existingStatus.path,
        installDir: path.isAbsolute(existingStatus.path) ? path.dirname(existingStatus.path) : undefined,
      });
      updatePythonInstallJob({
        status: 'complete',
        stage: 'complete',
        progress: 100,
        message: '检测到本机已有 Python，已自动写入插件配置。',
        pythonPath: existingStatus.path,
        version: existingStatus.version,
      });
      return;
    }

    const installResult = await installPythonWithSystemPackageManager();
    if (installResult.exitCode !== 0 || installResult.timedOut) {
      throw new Error(
        installResult.timedOut
          ? 'Python 安装进程意外超时'
          : `系统包管理器安装失败（退出码 ${installResult.exitCode}）：${installResult.stderr || installResult.stdout || '未返回错误详情'}`
      );
    }

    updatePythonInstallJob({
      stage: 'verify',
      progress: 86,
      message: 'Python 安装完成，正在自动定位并验证 python 可执行文件...',
      stdout: installResult.stdout.slice(-8000),
      stderr: installResult.stderr.slice(-8000),
    });
    const installedStatus = await getPythonStatus();
    if (!installedStatus.available || !installedStatus.path) {
      throw new Error('系统包管理器已完成安装，但暂未定位到 Python。请重启 Scholar Harness 后点击“自动检测”。');
    }

    await writePythonPluginConfig({
      pythonPath: installedStatus.path,
      installDir: path.isAbsolute(installedStatus.path) ? path.dirname(installedStatus.path) : undefined,
    });
    updatePythonInstallJob({
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'Python 插件已安装并完成自动配置。',
      pythonPath: installedStatus.path,
      version: installedStatus.version,
    });
  } catch (error) {
    updatePythonInstallJob({
      status: 'failed',
      stage: 'failed',
      progress: currentPythonInstallJob?.progress || 0,
      message: 'Python 插件安装失败',
      error: (error as Error).message,
    });
    logger.error('[PythonPlugin] Install job failed:', error);
  }
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

router.post('/install', async (_req, res) => {
  try {
    if (currentPythonInstallJob?.status === 'running') {
      return res.json({ success: true, data: currentPythonInstallJob });
    }
    currentPythonInstallJob = {
      id: randomUUID(),
      status: 'running',
      stage: 'start',
      progress: 1,
      message: 'Python 插件安装任务已启动',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    void runPythonInstallJob();
    res.json({ success: true, data: currentPythonInstallJob });
  } catch (error) {
    logger.error('[PythonPlugin] Install start error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/install/status', (_req, res) => {
  res.json({
    success: true,
    data: currentPythonInstallJob || {
      status: 'idle',
      stage: 'idle',
      progress: 0,
      message: '暂无 Python 插件安装任务',
    },
  });
});

export default router;
