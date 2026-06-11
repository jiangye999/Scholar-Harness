import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { getDataDir } from './paths';
import { logger } from './logger';

export interface PdfMarkerResult {
  markdown: string;
  text: string;
  outputPath: string;
  outputDir: string;
  executable: string;
}

export interface PdfMarkerOptions {
  outputDir?: string;
  pageRange?: string;
  timeoutMs?: number;
  label?: string;
  useLlm?: boolean;
  forceOcr?: boolean;
}

export interface PdfMarkerStatus {
  available: boolean;
  executable: string;
  installRoot: string;
  venvDir: string;
  installCommand: string;
  version?: string;
  error?: string;
}

interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
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

function cleanPath(value: string): string {
  return String(value || '').trim().replace(/^['"]|['"]$/g, '');
}

export function getPdfMarkerInstallRoot(): string {
  return path.join(getDataDir(), 'external-tools', 'marker');
}

export function getPdfMarkerVenvDir(): string {
  return path.join(getPdfMarkerInstallRoot(), '.venv');
}

export function getPdfMarkerPythonPath(): string {
  return process.platform === 'win32'
    ? path.join(getPdfMarkerVenvDir(), 'Scripts', 'python.exe')
    : path.join(getPdfMarkerVenvDir(), 'bin', 'python');
}

export function getPdfMarkerInstallCommand(): string {
  const venvDir = getPdfMarkerVenvDir();
  const python = getPdfMarkerPythonPath();
  if (process.platform === 'win32') {
    return `python -m venv "${venvDir}" && "${python}" -m pip install --upgrade pip setuptools wheel && "${python}" -m pip install marker-pdf`;
  }
  return `python3 -m venv "${venvDir}" && "${python}" -m pip install --upgrade pip setuptools wheel && "${python}" -m pip install marker-pdf`;
}

function markerExecutableCandidates(): string[] {
  const explicit = cleanPath(process.env.PDF_MARKER_EXE || process.env.PDF_MARKER_COMMAND || process.env.MARKER_EXE || '');
  const venvDir = getPdfMarkerVenvDir();
  const scriptsDir = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts')
    : path.join(venvDir, 'bin');
  const names = process.platform === 'win32'
    ? ['marker_single.exe', 'marker_single.cmd', 'marker_single.bat', 'marker_single']
    : ['marker_single'];
  return unique([
    explicit,
    ...names.map(name => path.join(scriptsDir, name)),
    ...names,
  ]);
}

function findExecutableOnPath(command: string): string {
  if (!command || path.isAbsolute(command)) return '';
  const exts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const names = path.extname(command)
      ? [command]
      : exts.map(ext => `${command}${ext.toLowerCase()}`);
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return '';
}

export function resolvePdfMarkerExecutable(): string {
  for (const candidate of markerExecutableCandidates()) {
    if (!candidate) continue;
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) return candidate;
    if (!path.isAbsolute(candidate)) {
      const onPath = findExecutableOnPath(candidate);
      if (onPath) return onPath;
    }
  }
  return process.platform === 'win32' ? 'marker_single.exe' : 'marker_single';
}

export function isPdfMarkerAvailable(): boolean {
  const executable = resolvePdfMarkerExecutable();
  return path.isAbsolute(executable) ? fs.existsSync(executable) : !!findExecutableOnPath(executable);
}

export async function detectPdfMarkerStatus(): Promise<PdfMarkerStatus> {
  const executable = resolvePdfMarkerExecutable();
  const base: PdfMarkerStatus = {
    available: false,
    executable,
    installRoot: getPdfMarkerInstallRoot(),
    venvDir: getPdfMarkerVenvDir(),
    installCommand: getPdfMarkerInstallCommand(),
  };
  if (!isPdfMarkerAvailable()) {
    return {
      ...base,
      error: '未检测到 marker_single。可点击一键安装，安装到本机数据目录。',
    };
  }
  try {
    const result = await runProcess(executable, ['--help'], process.cwd(), 20_000);
    const output = (result.stdout || result.stderr || '').trim();
    return {
      ...base,
      available: result.exitCode === 0 && !result.timedOut,
      version: output.split(/\r?\n/).find(Boolean)?.slice(0, 180),
      error: result.exitCode === 0 ? undefined : (result.stderr || result.stdout || `exit ${result.exitCode}`).slice(0, 500),
    };
  } catch (error) {
    return {
      ...base,
      error: (error as Error).message,
    };
  }
}

export async function extractPdfTextWithMarker(
  pdfPath: string,
  options: PdfMarkerOptions = {}
): Promise<PdfMarkerResult> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF 文件不存在：${pdfPath}`);
  }

  const executable = resolvePdfMarkerExecutable();
  if (!isPdfMarkerAvailable()) {
    throw new Error('未检测到 Marker 外部工具。请先在 PDF Wiki 配置中一键安装 Marker。');
  }

  const timeoutMs = Number(options.timeoutMs || process.env.PDF_MARKER_TIMEOUT_MS || 30 * 60_000);
  const safeTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 1000 ? timeoutMs : 30 * 60_000;
  const outputRoot = options.outputDir || path.join(process.cwd(), 'tmp', 'pdf-marker');
  await fs.promises.mkdir(outputRoot, { recursive: true });

  const baseName = path.basename(pdfPath, path.extname(pdfPath))
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .slice(0, 120) || `pdf-${crypto.randomUUID()}`;
  const runOutputDir = path.join(outputRoot, `${baseName}-${crypto.randomBytes(4).toString('hex')}.marker`);
  await fs.promises.mkdir(runOutputDir, { recursive: true });

  const args = [
    pdfPath,
    '--output_dir',
    runOutputDir,
    '--output_format',
    'markdown',
  ];
  if (options.pageRange && options.pageRange.trim()) {
    args.push('--page_range', options.pageRange.trim());
  }
  const useLlm = options.useLlm ?? /^(1|true|yes)$/i.test(String(process.env.PDF_MARKER_USE_LLM || ''));
  const forceOcr = options.forceOcr ?? /^(1|true|yes)$/i.test(String(process.env.PDF_MARKER_FORCE_OCR || ''));
  if (useLlm) args.push('--use_llm');
  if (forceOcr) args.push('--force_ocr');

  logger.info(`[PdfMarker] Extracting ${options.label || path.basename(pdfPath)} with ${executable}`);
  const result = await runProcess(executable, args, process.cwd(), safeTimeoutMs);
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(result.timedOut
      ? `Marker 解析超时（${safeTimeoutMs}ms）`
      : `Marker 解析失败，退出码 ${result.exitCode}: ${(result.stderr || result.stdout).slice(0, 1000)}`);
  }

  const outputPath = await findBestMarkdownOutput(runOutputDir, baseName);
  if (!outputPath) {
    throw new Error(`Marker 没有生成 Markdown 输出：${runOutputDir}`);
  }
  const markdown = await fs.promises.readFile(outputPath, 'utf-8');
  const text = normalizeExtractedText(markdown);
  if (!text) {
    throw new Error('Marker 提取结果为空，可能是扫描件、加密 PDF 或模型未正确安装');
  }

  return {
    markdown,
    text,
    outputPath,
    outputDir: runOutputDir,
    executable,
  };
}

async function findBestMarkdownOutput(root: string, baseName: string): Promise<string> {
  const files = await listFilesRecursive(root);
  const markdownFiles = files.filter(file => file.toLowerCase().endsWith('.md'));
  if (!markdownFiles.length) return '';
  const normalizedBase = baseName.toLowerCase();
  const ranked = markdownFiles.map(file => {
    const name = path.basename(file, '.md').toLowerCase();
    const score = name === normalizedBase ? 0 : (name.includes(normalizedBase) ? 1 : 2);
    const stat = fs.statSync(file);
    return { file, score, mtime: stat.mtimeMs };
  });
  ranked.sort((a, b) => a.score - b.score || b.mtime - a.mtime);
  return ranked[0]?.file || '';
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const result: string[] = [];
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      result.push(...await listFilesRecursive(fullPath));
    } else if (entry.isFile()) {
      result.push(fullPath);
    }
  }
  return result;
}

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
