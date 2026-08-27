import { existsSync, statSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';

import { Router } from 'express';
import { z } from 'zod';

import { logger } from '../../utils/logger';
import {
  getOfficeCliRuntimeRoot,
  getOfficeCliPluginConfigPath,
  normalizeOfficeCliExecutable,
  readOfficeCliPluginConfigSync,
  type OfficeCliPluginConfig,
} from '../../utils/office-runtime-env';
import { getDataDir } from '../../utils/paths';
import {
  getOfficeCliStatus,
  runOfficeCliProcess,
} from '../services/office-cli-service';
import {
  downloadFileWithRetry,
  requestJsonWithRetry,
  requestTextWithRetry,
} from '../services/resilient-download';

const router = Router();

const officeCliPathSchema = z.object({
  officeCliPath: z.string().min(1).max(1000),
});

interface OfficeCliInstallJob {
  id: string;
  status: 'idle' | 'running' | 'complete' | 'failed';
  stage: string;
  progress: number;
  message: string;
  startedAt?: string;
  updatedAt?: string;
  version?: string;
  assetName?: string;
  downloadUrl?: string;
  installDir?: string;
  officeCliPath?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
  size?: number;
}

interface GitHubReleasePayload {
  tag_name?: string;
  assets?: GitHubReleaseAsset[];
}

let currentOfficeCliInstallJob: OfficeCliInstallJob | null = null;

async function writeOfficeCliPluginConfig(config: OfficeCliPluginConfig): Promise<void> {
  const next = {
    ...readOfficeCliPluginConfigSync(),
    ...config,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(getOfficeCliPluginConfigPath(), JSON.stringify(next, null, 2), 'utf-8');
}

function normalizeOfficeCliPathInput(value: string): string {
  const normalized = normalizeOfficeCliExecutable(value);
  if (!normalized) return '';
  try {
    if (existsSync(normalized) && statSync(normalized).isDirectory()) {
      return path.join(normalized, process.platform === 'win32' ? 'officecli.exe' : 'officecli');
    }
  } catch {
    // Let validation report the actual process error.
  }
  return normalized;
}

function updateOfficeCliInstallJob(patch: Partial<OfficeCliInstallJob>): void {
  if (!currentOfficeCliInstallJob) return;
  currentOfficeCliInstallJob = {
    ...currentOfficeCliInstallJob,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

function getOfficeCliRuntimeBinDir(): string {
  return path.join(getOfficeCliRuntimeRoot(), 'bin');
}

function getOfficeCliInstalledExecutablePath(): string {
  return path.join(getOfficeCliRuntimeBinDir(), process.platform === 'win32' ? 'officecli.exe' : 'officecli');
}

function getOfficeCliAssetName(): string {
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'officecli-win-arm64.exe' : 'officecli-win-x64.exe';
  }
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'officecli-mac-arm64' : 'officecli-mac-x64';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'officecli-linux-arm64' : 'officecli-linux-x64';
  }
  throw new Error(`当前平台暂不支持一键安装 OfficeCLI: ${process.platform}/${process.arch}`);
}

async function fetchLatestOfficeCliRelease(): Promise<GitHubReleasePayload> {
  return requestJsonWithRetry<GitHubReleasePayload>(
    'https://api.github.com/repos/iOfficeAI/OfficeCLI/releases/latest',
    {
      label: '读取 OfficeCLI Release',
      timeoutMs: 30_000,
      maxAttempts: 4,
      headers: {
        'User-Agent': 'ScholarHarness',
        'Accept': 'application/vnd.github+json',
      },
    },
  );
}

async function fetchText(url: string): Promise<string> {
  return requestTextWithRetry(url, {
    label: '读取 OfficeCLI SHA256SUMS',
    timeoutMs: 30_000,
    maxAttempts: 4,
    headers: { 'User-Agent': 'ScholarHarness' },
  });
}

function parseSha256FromSums(sumsText: string, assetName: string): string {
  const escaped = assetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`^([a-f0-9]{64})\\s+\\*?${escaped}\\s*$`, 'im');
  const match = sumsText.match(regex);
  return match ? match[1].toLowerCase() : '';
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  const buffer = await fs.readFile(filePath);
  hash.update(buffer);
  return hash.digest('hex').toLowerCase();
}

async function runOfficeCliInstallJob(): Promise<void> {
  if (!currentOfficeCliInstallJob) return;
  try {
    updateOfficeCliInstallJob({ stage: 'detect', progress: 3, message: '正在检测已安装的 OfficeCLI...' });
    const existingStatus = await getOfficeCliStatus();
    if (existingStatus.available && existingStatus.path) {
      await writeOfficeCliPluginConfig({
        officeCliPath: existingStatus.path,
        installDir: path.isAbsolute(existingStatus.path) ? path.dirname(existingStatus.path) : undefined,
      });
      updateOfficeCliInstallJob({
        status: 'complete',
        stage: 'complete',
        progress: 100,
        message: '检测到本机已有 OfficeCLI，已写入全局配置。',
        officeCliPath: existingStatus.path,
        version: existingStatus.version,
      });
      return;
    }

    updateOfficeCliInstallJob({ stage: 'release', progress: 5, message: '正在解析 OfficeCLI 最新 Release...' });
    const assetName = getOfficeCliAssetName();
    const release = await fetchLatestOfficeCliRelease();
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const asset = assets.find(item => item.name === assetName);
    if (!asset?.browser_download_url) {
      throw new Error(`OfficeCLI Release 中未找到当前平台资产：${assetName}`);
    }
    const sumsAsset = assets.find(item => item.name === 'SHA256SUMS');

    const runtimeRoot = getOfficeCliRuntimeRoot();
    const binDir = getOfficeCliRuntimeBinDir();
    const downloadDir = path.join(runtimeRoot, 'downloads');
    await fs.mkdir(binDir, { recursive: true });
    await fs.mkdir(downloadDir, { recursive: true });

    const downloadedAssetPath = path.join(downloadDir, assetName);
    updateOfficeCliInstallJob({
      stage: 'download',
      progress: 8,
      message: `正在下载 ${assetName}...`,
      assetName,
      downloadUrl: asset.browser_download_url,
      version: release.tag_name || '',
      installDir: binDir,
    });
    await downloadFileWithRetry({
      url: asset.browser_download_url,
      destination: downloadedAssetPath,
      label: '下载 OfficeCLI',
      headers: { 'User-Agent': 'ScholarHarness' },
      maxAttempts: 4,
      timeoutMs: 120_000,
      onProgress: progress => {
        const percent = Math.min(75, Math.max(8, 8 + Math.round(progress.percent * 0.67)));
        const resumed = progress.resumed ? '（断点续传）' : '';
        updateOfficeCliInstallJob({
          progress: percent,
          message: `正在下载 OfficeCLI ${Math.round(progress.downloadedBytes / 1024 / 1024)}MB/${Math.round(progress.totalBytes / 1024 / 1024)}MB${resumed}`,
        });
      },
      onRetry: (attempt, maxAttempts, error) => {
        updateOfficeCliInstallJob({
          message: `OfficeCLI 下载连接中断，正在进行第 ${attempt}/${maxAttempts} 次尝试：${error.message}`,
        });
      },
    });

    if (sumsAsset?.browser_download_url) {
      updateOfficeCliInstallJob({ stage: 'verify', progress: 78, message: '正在校验 OfficeCLI SHA256...' });
      const sumsText = await fetchText(sumsAsset.browser_download_url);
      const expectedHash = parseSha256FromSums(sumsText, assetName);
      if (expectedHash) {
        const actualHash = await sha256File(downloadedAssetPath);
        if (actualHash !== expectedHash) {
          await fs.rm(downloadedAssetPath, { force: true });
          throw new Error(`OfficeCLI SHA256 校验失败：expected ${expectedHash}, actual ${actualHash}`);
        }
      } else {
        logger.warn(`[OfficePlugin] SHA256SUMS did not contain ${assetName}; continuing without hash verification.`);
      }
    }

    updateOfficeCliInstallJob({ stage: 'install', progress: 84, message: '正在部署 OfficeCLI 到软件数据目录...' });
    const officeCliPath = getOfficeCliInstalledExecutablePath();
    await fs.copyFile(downloadedAssetPath, officeCliPath);
    if (process.platform !== 'win32') {
      await fs.chmod(officeCliPath, 0o755);
    }

    updateOfficeCliInstallJob({ stage: 'verify', progress: 92, message: '正在验证 OfficeCLI 可运行...' });
    const result = await runOfficeCliProcess(officeCliPath, ['--version'], process.cwd(), 20_000);
    const versionText = (result.stdout || result.stderr).trim();
    if (result.exitCode !== 0 || result.timedOut || !versionText) {
      throw new Error(result.timedOut
        ? 'OfficeCLI 验证超时'
        : `OfficeCLI 验证失败，退出码 ${result.exitCode}: ${result.stderr || result.stdout}`);
    }

    await writeOfficeCliPluginConfig({
      officeCliPath,
      installDir: binDir,
    });
    updateOfficeCliInstallJob({
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'OfficeCLI 插件已部署完成，可直接处理 Word/Excel/PPT。',
      officeCliPath,
      installDir: binDir,
      version: versionText,
      stdout: result.stdout.slice(-4000),
      stderr: result.stderr.slice(-4000),
    });
  } catch (error) {
    const detail = (error as Error).message;
    const actionableDetail = /下载|Release|SHA256SUMS|ECONN|ETIMEDOUT|ENOTFOUND/i.test(detail)
      ? `${detail}。请检查 GitHub 网络访问或设置 HTTPS_PROXY；也可以手动下载 OfficeCLI 后保存可执行文件路径。`
      : detail;
    updateOfficeCliInstallJob({
      status: 'failed',
      stage: 'failed',
      progress: currentOfficeCliInstallJob?.progress || 0,
      message: 'OfficeCLI 插件安装失败',
      error: actionableDetail,
    });
    logger.error('[OfficePlugin] Install job failed:', error);
  }
}

router.get('/status', async (req, res) => {
  try {
    const command = typeof req.query.command === 'string' ? req.query.command : undefined;
    const status = await getOfficeCliStatus(command);
    res.json({
      success: true,
      data: {
        ...status,
        configPath: getOfficeCliPluginConfigPath(),
        runtimeRoot: getOfficeCliRuntimeRoot(),
      },
    });
  } catch (error) {
    logger.error('[OfficePlugin] Status error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/auto-detect', async (_req, res) => {
  try {
    const status = await getOfficeCliStatus();
    if (status.available && status.path) {
      await writeOfficeCliPluginConfig({
        officeCliPath: status.path,
        installDir: path.isAbsolute(status.path) ? path.dirname(status.path) : undefined,
      });
    }
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('[OfficePlugin] Auto-detect error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/path', async (req, res) => {
  try {
    const parsed = officeCliPathSchema.parse(req.body || {});
    const officeCliPath = normalizeOfficeCliPathInput(parsed.officeCliPath);
    const result = await runOfficeCliProcess(officeCliPath, ['--version'], process.cwd(), 10_000);
    const versionText = (result.stdout || result.stderr).trim();
    if (result.exitCode !== 0 || result.timedOut || !versionText) {
      return res.status(400).json({
        success: false,
        error: result.timedOut
          ? 'OfficeCLI 路径检测超时'
          : `该路径无法运行 OfficeCLI：${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
      });
    }
    await writeOfficeCliPluginConfig({
      officeCliPath,
      installDir: path.isAbsolute(officeCliPath) ? path.dirname(officeCliPath) : undefined,
    });
    res.json({
      success: true,
      data: {
        available: true,
        path: officeCliPath,
        version: versionText,
      },
    });
  } catch (error) {
    logger.error('[OfficePlugin] Save path error:', error);
    const message = error instanceof z.ZodError
      ? error.errors.map(item => item.message).join('; ')
      : (error as Error).message;
    res.status(400).json({ success: false, error: message || '保存 OfficeCLI 路径失败' });
  }
});

router.post('/install', async (_req, res) => {
  try {
    if (currentOfficeCliInstallJob?.status === 'running') {
      return res.json({ success: true, data: currentOfficeCliInstallJob });
    }
    currentOfficeCliInstallJob = {
      id: randomUUID(),
      status: 'running',
      stage: 'start',
      progress: 1,
      message: 'OfficeCLI 插件安装任务已启动',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    void runOfficeCliInstallJob();
    res.json({ success: true, data: currentOfficeCliInstallJob });
  } catch (error) {
    logger.error('[OfficePlugin] Install start error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/install/status', (_req, res) => {
  res.json({
    success: true,
    data: currentOfficeCliInstallJob || {
      status: 'idle',
      stage: 'idle',
      progress: 0,
      message: '暂无 OfficeCLI 插件安装任务',
    },
  });
});

export default router;
