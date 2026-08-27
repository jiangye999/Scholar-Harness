import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Router } from 'express';
import {
  detectPdfMarkerStatus,
  getPdfMarkerInstallRoot,
  getPdfMarkerPythonPath,
  getPdfMarkerVenvDir,
} from '../../utils/pdf-marker';
import { logger } from '../../utils/logger';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';

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

interface MarkerInstallJob {
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

let currentMarkerInstallJob: MarkerInstallJob | null = null;

function updateMarkerInstallJob(update: Partial<MarkerInstallJob>): void {
  if (!currentMarkerInstallJob) return;
  currentMarkerInstallJob = {
    ...currentMarkerInstallJob,
    ...update,
    updatedAt: new Date().toISOString(),
  };
}

function getPythonCandidates(): PythonCandidate[] {
  const explicit = String(process.env.PDF_MARKER_PYTHON || process.env.PYTHON_EXE || '').trim().replace(/^['"]|['"]$/g, '');
  const candidates: PythonCandidate[] = [];
  if (explicit) candidates.push({ executable: explicit, argsPrefix: [], display: explicit });
  if (process.platform === 'win32') {
    candidates.push({ executable: 'py.exe', argsPrefix: ['-3.12'], display: 'py -3.12' });
    candidates.push({ executable: 'py.exe', argsPrefix: ['-3.13'], display: 'py -3.13' });
    candidates.push({ executable: 'py.exe', argsPrefix: ['-3.11'], display: 'py -3.11' });
    candidates.push({ executable: 'py.exe', argsPrefix: ['-3.10'], display: 'py -3.10' });
    candidates.push({ executable: 'py.exe', argsPrefix: ['-3'], display: 'py -3' });
    candidates.push({ executable: 'python.exe', argsPrefix: [], display: 'python' });
  } else {
    candidates.push({ executable: 'python3', argsPrefix: [], display: 'python3' });
    candidates.push({ executable: 'python', argsPrefix: [], display: 'python' });
  }
  return candidates;
}

async function findPythonForMarker(): Promise<PythonCandidate> {
  for (const candidate of getPythonCandidates()) {
    try {
      const result = await runProcess(candidate.executable, [...candidate.argsPrefix, '--version'], process.cwd(), 10_000);
      const match = /Python\s+(\d+)\.(\d+)/i.exec(result.stdout || result.stderr);
      const supported = !!match && Number(match[1]) === 3 && Number(match[2]) >= 10;
      if (result.exitCode === 0 && !result.timedOut && supported) return candidate;
    } catch {
      // Try next candidate.
    }
  }
  throw new Error('未检测到 Python 3.10+。请先安装 Python，或设置 PDF_MARKER_PYTHON/PYTHON_EXE 后重试。');
}

async function runMarkerInstallJob(): Promise<void> {
  if (!currentMarkerInstallJob) return;
  const installRoot = getPdfMarkerInstallRoot();
  const venvDir = getPdfMarkerVenvDir();
  const venvPython = getPdfMarkerPythonPath();

  try {
    updateMarkerInstallJob({
      stage: 'detect',
      progress: 5,
      message: '正在检测本机 Marker 和 Python...',
      installRoot,
      venvDir,
    });
    const existing = await detectPdfMarkerStatus();
    if (existing.available) {
      updateMarkerInstallJob({
        status: 'complete',
        stage: 'complete',
        progress: 100,
        message: '已检测到 Marker，可直接使用。',
        executable: existing.executable,
      });
      return;
    }

    await fs.mkdir(installRoot, { recursive: true });
    const python = await findPythonForMarker();
    updateMarkerInstallJob({
      stage: 'venv',
      progress: 15,
      message: `正在使用 ${python.display} 创建 Marker 独立虚拟环境...`,
    });
    if (!existsSync(venvPython)) {
      const venvResult = await runProcess(python.executable, [...python.argsPrefix, '-m', 'venv', venvDir], installRoot, 5 * 60_000);
      if (venvResult.exitCode !== 0 || venvResult.timedOut) {
        throw new Error(venvResult.timedOut
          ? '创建 Marker 虚拟环境超时'
          : `创建 Marker 虚拟环境失败，退出码 ${venvResult.exitCode}: ${venvResult.stderr || venvResult.stdout}`);
      }
    }
    if (!existsSync(venvPython)) {
      throw new Error(`虚拟环境已创建，但未找到 Python：${venvPython}`);
    }

    updateMarkerInstallJob({
      stage: 'pip',
      progress: 35,
      message: '正在升级 pip、setuptools、wheel...',
    });
    const pipUpgrade = await runProcess(
      venvPython,
      ['-m', 'pip', 'install', '--retries', '5', '--timeout', '60', '--upgrade', 'pip', 'setuptools', 'wheel'],
      installRoot,
      10 * 60_000,
    );
    if (pipUpgrade.exitCode !== 0 || pipUpgrade.timedOut) {
      throw new Error(pipUpgrade.timedOut
        ? 'pip 基础工具升级超时'
        : `pip 基础工具升级失败，退出码 ${pipUpgrade.exitCode}: ${pipUpgrade.stderr || pipUpgrade.stdout}`);
    }

    updateMarkerInstallJob({
      stage: 'marker',
      progress: 55,
      message: '正在安装 marker-pdf。首次安装会下载 PyTorch/模型依赖，耗时较长。',
    });
    const markerInstall = await runProcess(
      venvPython,
      ['-m', 'pip', 'install', '--retries', '5', '--timeout', '60', 'marker-pdf==2.0.0'],
      installRoot,
      60 * 60_000,
    );
    if (markerInstall.exitCode !== 0 || markerInstall.timedOut) {
      throw new Error(markerInstall.timedOut
        ? 'marker-pdf 安装超时'
        : `marker-pdf 安装失败，退出码 ${markerInstall.exitCode}: ${markerInstall.stderr || markerInstall.stdout}`);
    }

    updateMarkerInstallJob({
      stage: 'verify',
      progress: 90,
      message: '正在验证 marker_single 命令...',
    });
    const status = await detectPdfMarkerStatus();
    if (!status.available) {
      throw new Error(status.error || 'marker-pdf 已安装，但 marker_single 仍不可用。');
    }

    updateMarkerInstallJob({
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'Marker 已安装完成，可作为 PDF Wiki 高精度外部解析器使用。',
      executable: status.executable,
      stdout: markerInstall.stdout.slice(-4000),
      stderr: markerInstall.stderr.slice(-4000),
    });
  } catch (error) {
    updateMarkerInstallJob({
      status: 'failed',
      stage: 'failed',
      progress: currentMarkerInstallJob?.progress || 0,
      message: 'Marker 安装失败',
      error: (error as Error).message,
    });
    logger.error('[PdfMarker] Install job failed:', error);
  }
}

router.get('/status', async (req, res) => {
  try {
    const status = await detectPdfMarkerStatus();
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('[PdfMarker] Status error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/install', async (req, res) => {
  try {
    if (currentMarkerInstallJob?.status === 'running') {
      return res.json({ success: true, data: currentMarkerInstallJob });
    }
    currentMarkerInstallJob = {
      id: randomUUID(),
      status: 'running',
      stage: 'start',
      progress: 1,
      message: 'Marker 一键安装任务已启动',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      installRoot: getPdfMarkerInstallRoot(),
      venvDir: getPdfMarkerVenvDir(),
    };
    void runMarkerInstallJob();
    res.json({ success: true, data: currentMarkerInstallJob });
  } catch (error) {
    logger.error('[PdfMarker] Install start error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/install/status', (req, res) => {
  res.json({
    success: true,
    data: currentMarkerInstallJob || {
      status: 'idle',
      stage: 'idle',
      progress: 0,
      message: '暂无 Marker 安装任务',
      installRoot: getPdfMarkerInstallRoot(),
      venvDir: getPdfMarkerVenvDir(),
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
      env: buildToolRuntimeEnv({
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
      }),
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
