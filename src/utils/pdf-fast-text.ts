import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { logger } from './logger';
import { getDataDir } from './paths';

export interface PdfFastTextResult {
  markdown: string;
  text: string;
  outputPath: string;
  executable: string;
}

export interface PdfFastTextOptions {
  outputDir?: string;
  pageRange?: string;
  timeoutMs?: number;
  label?: string;
}

export interface PdfFastTextStatus {
  available: boolean;
  executable: string;
  installRoot: string;
  venvDir: string;
  installCommand: string;
  source: 'env' | 'user-data' | 'bundled' | 'dev' | 'path' | 'missing';
  bundled: boolean;
  error?: string;
}

function normalizeExtractedText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(item => item.trim()).filter(Boolean))];
}

export function getPdfFastTextInstallRoot(): string {
  return path.join(getDataDir(), 'external-tools', 'pdf-fast-text');
}

export function getPdfFastTextVenvDir(): string {
  return path.join(getPdfFastTextInstallRoot(), '.venv');
}

export function getPdfFastTextPythonPath(): string {
  return process.platform === 'win32'
    ? path.join(getPdfFastTextVenvDir(), 'Scripts', 'python.exe')
    : path.join(getPdfFastTextVenvDir(), 'bin', 'python');
}

export function getPdfFastTextInstallCommand(): string {
  const venvDir = getPdfFastTextVenvDir();
  const python = getPdfFastTextPythonPath();
  if (process.platform === 'win32') {
    return `python -m venv "${venvDir}" && "${python}" -m pip install --upgrade pip setuptools wheel && "${python}" -m pip install pdftext==0.6.3`;
  }
  return `python3 -m venv "${venvDir}" && "${python}" -m pip install --upgrade pip setuptools wheel && "${python}" -m pip install pdftext==0.6.3`;
}

function getElectronResourcesPath(): string {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resourcesPath === 'string' && resourcesPath.trim() ? resourcesPath.trim() : '';
}

function getPdfTextExecutableName(): string {
  return process.platform === 'win32' ? 'pdftext.exe' : 'pdftext';
}

function resolveFromPath(command: string): string {
  const pathValue = process.env.PATH || '';
  if (!pathValue) return '';
  const extensions = process.platform === 'win32'
    ? unique(['', ...(process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';')])
    : [''];
  for (const dir of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const ext of extensions) {
      const candidate = path.join(dir, command.endsWith(ext) ? command : `${command}${ext}`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return '';
}

function getFastTextCandidateRoots(): Array<{ root: string; source: PdfFastTextStatus['source'] }> {
  const resourcesPath = getElectronResourcesPath();
  return [
    { root: getPdfFastTextInstallRoot(), source: 'user-data' },
    { root: resourcesPath ? path.join(resourcesPath, 'tools', 'pdf-fast-text') : '', source: 'bundled' },
    { root: path.join(process.cwd(), 'tools', 'pdf-fast-text'), source: 'bundled' },
    { root: process.env.PDF_MARKER_MD_DIR || '', source: 'env' },
    { root: process.env.PDF_FAST_TEXT_ROOT || '', source: 'env' },
    { root: path.resolve(process.cwd(), '..', 'pdf-marker-md'), source: 'dev' },
    { root: 'E:\\AI_projects\\pdf-marker-md', source: 'dev' },
  ];
}

function getPdfTextCandidates(): Array<{ executable: string; source: PdfFastTextStatus['source'] }> {
  const executableName = getPdfTextExecutableName();
  const explicit = String(process.env.PDF_FAST_TEXT_EXE || process.env.PDFTEXT_EXE || '').trim().replace(/^['"]|['"]$/g, '');
  const candidates: Array<{ executable: string; source: PdfFastTextStatus['source'] }> = [];
  if (explicit) candidates.push({ executable: explicit, source: 'env' });

  for (const item of getFastTextCandidateRoots()) {
    if (!item.root) continue;
    const venvBinDir = process.platform === 'win32' ? 'Scripts' : 'bin';
    candidates.push({
      executable: path.join(item.root, '.venv-fast', venvBinDir, executableName),
      source: item.source,
    });
    candidates.push({
      executable: path.join(item.root, '.venv', venvBinDir, executableName),
      source: item.source,
    });
  }

  const pathExecutable = resolveFromPath(executableName);
  if (pathExecutable) candidates.push({ executable: pathExecutable, source: 'path' });
  return candidates;
}

export function resolvePdfFastTextExecutable(): string {
  for (const candidate of getPdfTextCandidates()) {
    if (path.isAbsolute(candidate.executable) && fs.existsSync(candidate.executable)) {
      return candidate.executable;
    }
  }

  return getPdfTextExecutableName();
}

export function isPdfFastTextAvailable(): boolean {
  const executable = resolvePdfFastTextExecutable();
  return path.isAbsolute(executable) && fs.existsSync(executable);
}

export function detectPdfFastTextStatus(): PdfFastTextStatus {
  const executable = resolvePdfFastTextExecutable();
  const candidate = getPdfTextCandidates().find(item => item.executable === executable);
  const available = path.isAbsolute(executable) && fs.existsSync(executable);
  const installRoot = getPdfFastTextInstallRoot();
  return {
    available,
    executable,
    installRoot,
    venvDir: getPdfFastTextVenvDir(),
    installCommand: getPdfFastTextInstallCommand(),
    source: available ? (candidate?.source || 'path') : 'missing',
    bundled: available && (candidate?.source === 'bundled'),
    error: available ? undefined : '未检测到 pdftext。可点击一键安装，安装到本机数据目录。',
  };
}

export async function extractPdfTextWithFastText(
  pdfPath: string,
  options: PdfFastTextOptions = {}
): Promise<PdfFastTextResult> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF 文件不存在：${pdfPath}`);
  }

  const executable = resolvePdfFastTextExecutable();
  if (path.isAbsolute(executable) && !fs.existsSync(executable)) {
    throw new Error(`未找到 pdf-marker-md 快速文本工具：${executable}`);
  }

  const timeoutMs = Number(options.timeoutMs || process.env.PDF_FAST_TEXT_TIMEOUT_MS || 300000);
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 1000 ? timeoutMs : 300000;
  const outputDir = options.outputDir || path.join(process.cwd(), 'tmp', 'pdf-fast-text');
  await fs.promises.mkdir(outputDir, { recursive: true });

  const baseName = path.basename(pdfPath, path.extname(pdfPath))
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .slice(0, 120) || `pdf-${crypto.randomUUID()}`;
  const outputPath = path.join(outputDir, `${baseName}-${crypto.randomBytes(4).toString('hex')}.md`);
  const args = [pdfPath, '--out_path', outputPath];
  if (options.pageRange && options.pageRange.trim()) {
    args.push('--page_range', options.pageRange.trim());
  }

  logger.info(`[PdfFastText] Extracting ${options.label || path.basename(pdfPath)} with ${executable}`);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
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
      reject(new Error(`pdf-marker-md 快速文本提取超时（${safeTimeoutMs}ms）`));
    }, safeTimeoutMs);

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
      if (code !== 0) {
        reject(new Error(`pdf-marker-md 快速文本提取失败，退出码 ${code}: ${(stderr || stdout).slice(0, 600)}`));
        return;
      }
      resolve();
    });
  });

  const markdown = await fs.promises.readFile(outputPath, 'utf-8');
  const text = normalizeExtractedText(markdown);
  if (!text) {
    throw new Error('pdf-marker-md 快速文本提取结果为空，可能是扫描件或没有文字层');
  }

  return {
    markdown,
    text,
    outputPath,
    executable,
  };
}
