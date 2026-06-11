import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import { Router } from 'express';
import {
  detectPdfFastTextStatus,
  getPdfFastTextInstallRoot,
  getPdfFastTextPythonPath,
  getPdfFastTextVenvDir,
} from '../../utils/pdf-fast-text';
import { logger } from '../../utils/logger';

const router = Router();

interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface PythonCandidate {
  executable: string;
  argsPrefix: string[];
  display: string;
}

interface FastTextInstallJob {
  id: string;
  status: 'running' | 'complete' | 'failed';
  stage: string;
  progress: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
  installRoot?: string;
  venvDir?: string;
  executable?: string;
  stdout?: string;
  stderr?: string;
}

let currentFastTextInstallJob: FastTextInstallJob | null = null;

function updateFastTextInstallJob(update: Partial<FastTextInstallJob>): void {
  if (!currentFastTextInstallJob) return;
  currentFastTextInstallJob = {
    ...currentFastTextInstallJob,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

function getPythonCandidates(): PythonCandidate[] {
  const explicit = String(process.env.PDF_FAST_TEXT_PYTHON || process.env.PYTHON_EXE || '').trim().replace(/^['"]|['"]$/g, '');
  const candidates: PythonCandidate[] = [];
  if (explicit) candidates.push({ executable: explicit, argsPrefix: [], display: explicit });
  if (process.platform === 'win32') {
    candidates.push({ executable: 'py.exe', argsPrefix: ['-3'], display: 'py -3' });
    candidates.push({ executable: 'python.exe', argsPrefix: [], display: 'python' });
  } else {
    candidates.push({ executable: 'python3', argsPrefix: [], display: 'python3' });
    candidates.push({ executable: 'python', argsPrefix: [], display: 'python' });
  }
  return candidates;
}

async function findPythonForFastText(): Promise<PythonCandidate> {
  for (const candidate of getPythonCandidates()) {
    try {
      const result = await runProcess(candidate.executable, [...candidate.argsPrefix, '--version'], process.cwd(), 10_000);
      if (result.exitCode === 0 && !result.timedOut) return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('未检测到 Python 3。请先安装 Python，或设置 PDF_FAST_TEXT_PYTHON/PYTHON_EXE 后重试。');
}

function getPdfFastTextPackages(): string[] {
  const configured = String(process.env.PDF_FAST_TEXT_PIP_PACKAGES || '').trim();
  if (configured) {
    return configured.split(/\s+/).map(item => item.trim()).filter(Boolean);
  }
  return ['pdftext==0.6.3'];
}

async function runFastTextInstallJob(): Promise<void> {
  if (!currentFastTextInstallJob) return;
  const installRoot = getPdfFastTextInstallRoot();
  const venvDir = getPdfFastTextVenvDir();
  const venvPython = getPdfFastTextPythonPath();

  try {
    updateFastTextInstallJob({
      stage: 'detect',
      progress: 5,
      message: '正在检测 pdf-marker-md 快速文本工具和 Python...',
      installRoot,
      venvDir,
    });
    const existing = detectPdfFastTextStatus();
    if (existing.available) {
      updateFastTextInstallJob({
        status: 'complete',
        stage: 'complete',
        progress: 100,
        message: '已检测到 pdf-marker-md 快速文本工具，可直接使用。',
        executable: existing.executable,
      });
      return;
    }

    await fs.mkdir(installRoot, { recursive: true });
    const python = await findPythonForFastText();
    updateFastTextInstallJob({
      stage: 'venv',
      progress: 15,
      message: `正在使用 ${python.display} 创建 pdf-marker-md 快速文本独立虚拟环境...`,
    });
    if (!existsSync(venvPython)) {
      const venvResult = await runProcess(python.executable, [...python.argsPrefix, '-m', 'venv', venvDir], installRoot, 5 * 60_000);
      if (venvResult.exitCode !== 0 || venvResult.timedOut) {
        throw new Error(venvResult.timedOut
          ? '创建 pdf-marker-md 快速文本虚拟环境超时'
          : `创建 pdf-marker-md 快速文本虚拟环境失败，退出码 ${venvResult.exitCode}: ${venvResult.stderr || venvResult.stdout}`);
      }
    }
    if (!existsSync(venvPython)) {
      throw new Error(`虚拟环境已创建，但未找到 Python：${venvPython}`);
    }

    updateFastTextInstallJob({
      stage: 'pip',
      progress: 35,
      message: '正在升级 pip、setuptools、wheel...',
    });
    const pipUpgrade = await runProcess(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'setuptools', 'wheel'], installRoot, 10 * 60_000);
    if (pipUpgrade.exitCode !== 0 || pipUpgrade.timedOut) {
      throw new Error(pipUpgrade.timedOut
        ? 'pip 基础工具升级超时'
        : `pip 基础工具升级失败，退出码 ${pipUpgrade.exitCode}: ${pipUpgrade.stderr || pipUpgrade.stdout}`);
    }

    const packages = getPdfFastTextPackages();
    updateFastTextInstallJob({
      stage: 'pdftext',
      progress: 55,
      message: `正在安装 ${packages.join(' ')}，用于提供 pdftext.exe。`,
    });
    const installResult = await runProcess(venvPython, ['-m', 'pip', 'install', ...packages], installRoot, 30 * 60_000);
    if (installResult.exitCode !== 0 || installResult.timedOut) {
      throw new Error(installResult.timedOut
        ? 'pdftext 安装超时'
        : `pdftext 安装失败，退出码 ${installResult.exitCode}: ${installResult.stderr || installResult.stdout}`);
    }

    updateFastTextInstallJob({
      stage: 'verify',
      progress: 90,
      message: '正在验证 pdftext 命令...',
    });
    const status = detectPdfFastTextStatus();
    if (!status.available) {
      throw new Error(status.error || 'pdftext 已安装，但命令仍不可用。');
    }

    updateFastTextInstallJob({
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'pdf-marker-md 快速文本工具已安装完成，可用于 PDF Wiki 快速读取文字层。',
      executable: status.executable,
      stdout: installResult.stdout.slice(-4000),
      stderr: installResult.stderr.slice(-4000),
    });
  } catch (error) {
    updateFastTextInstallJob({
      status: 'failed',
      stage: 'failed',
      progress: currentFastTextInstallJob?.progress || 0,
      message: 'pdf-marker-md 快速文本安装失败',
      error: (error as Error).message,
    });
    logger.error('[PdfFastText] Install job failed:', error);
  }
}

router.get('/status', (req, res) => {
  try {
    const status = detectPdfFastTextStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('[PdfFastText] Status error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/install', (req, res) => {
  try {
    if (currentFastTextInstallJob?.status === 'running') {
      return res.json({ success: true, data: currentFastTextInstallJob });
    }
    currentFastTextInstallJob = {
      id: randomUUID(),
      status: 'running',
      stage: 'start',
      progress: 1,
      message: 'pdf-marker-md 快速文本一键安装任务已启动',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      installRoot: getPdfFastTextInstallRoot(),
      venvDir: getPdfFastTextVenvDir(),
    };
    void runFastTextInstallJob();
    res.json({ success: true, data: currentFastTextInstallJob });
  } catch (error) {
    logger.error('[PdfFastText] Install start error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/install/status', (req, res) => {
  res.json({
    success: true,
    data: currentFastTextInstallJob || {
      status: 'idle',
      stage: 'idle',
      progress: 0,
      message: '暂无 pdf-marker-md 快速文本安装任务',
      installRoot: getPdfFastTextInstallRoot(),
      venvDir: getPdfFastTextVenvDir(),
    },
  });
});

async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({ exitCode: null, timedOut: true, stdout, stderr });
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
      resolve({ exitCode: code, timedOut: false, stdout, stderr });
    });
  });
}

export default router;
