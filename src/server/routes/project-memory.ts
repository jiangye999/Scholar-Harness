import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { Router, Request, Response } from 'express';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import mammoth = require('mammoth');
import { PDFParse } from 'pdf-parse';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import { logger } from '../../utils/logger';
import { getDataDir, getMemoryDir, sanitizeUserId } from '../../utils/paths';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';
import type { ChatOptions } from '../../types';
import { resolveUserId } from '../auth-guard-singleton';
import {
  loadUserMemory,
  removeFromDeletedKeys,
  saveMemoryToFiles,
  saveUserMemory,
  withMemoryLock,
  type MemoryEntry,
} from './memory';

const router = Router();

const PROJECT_IMPORT_EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'dist-electron',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.cache',
  '.turbo',
  '.vite',
  'target',
  'vendor',
  'venv',
  '.venv',
  'env',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
]);

const PROJECT_IMPORT_TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonl', '.md', '.mdx', '.txt',
  '.html', '.htm', '.css', '.scss', '.sass', '.less',
  '.vue', '.svelte',
  '.py', '.r', '.R', '.rmd', '.qmd', '.ipynb',
  '.tex', '.bib', '.ris', '.csv',
  '.java', '.kt', '.kts', '.go', '.rs',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp',
  '.cs', '.php', '.rb', '.swift',
  '.sql', '.graphql', '.gql',
  '.yaml', '.yml', '.toml', '.ini', '.env.example',
  '.xml', '.svg',
  '.sh', '.bash', '.ps1', '.bat', '.cmd',
  '.dockerfile', '.gitignore', '.gitattributes',
]);

const PROJECT_IMPORT_DOCUMENT_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);

const PROJECT_IMPORT_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.bmp',
  '.tif',
  '.tiff',
]);

const PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES = 25_000_000;
const PROJECT_IMPORT_PREVIEW_ROWS = 50;
const PROJECT_IMPORT_PREVIEW_SHEETS = 8;
const PROJECT_IMPORT_PREVIEW_SLIDES = 80;

const PROJECT_IMPORT_IMPORTANT_NAMES = new Set([
  'AGENTS.md',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'Dockerfile',
  'docker-compose.yml',
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vitest.config.ts',
  'next.config.js',
  'pyproject.toml',
  'requirements.txt',
  'Cargo.toml',
  'go.mod',
]);

const PROJECT_IMPORT_SENSITIVE_FILE_PATTERNS = [
  /^\.env$/i,
  /^\.env\.(?!example$).+/i,
  /(^|[._-])secret(s)?([._-]|$)/i,
  /(^|[._-])token(s)?([._-]|$)/i,
  /(^|[._-])credential(s)?([._-]|$)/i,
  /(^|[._-])private([._-]|$)/i,
  /\.(pem|key|p12|pfx|crt|cer)$/i,
  /^id_rsa$/i,
  /^id_dsa$/i,
  /^id_ed25519$/i,
];

const projectImportSchema = z.object({
  userId: z.string().optional(),
  address: z.string().min(1).max(3000),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  maxFiles: z.coerce.number().int().min(10).max(1200).optional(),
  maxBytesPerFile: z.coerce.number().int().min(4096).max(800_000).optional(),
  maxTotalBytes: z.coerce.number().int().min(100_000).max(5_000_000).optional(),
});

interface ProjectFileSnapshot {
  relativePath: string;
  absolutePath: string;
  size: number;
  extension: string;
  kind: 'text' | 'pdf' | 'word' | 'spreadsheet' | 'presentation' | 'image' | 'binary';
  extractionMethod: string;
  extractionNote?: string;
  content: string;
  truncated: boolean;
}

interface ProjectSkippedFile {
  relativePath: string;
  reason: string;
  size?: number;
}

interface ProjectCollectResult {
  rootPath: string;
  projectName: string;
  files: ProjectFileSnapshot[];
  skipped: ProjectSkippedFile[];
  totalBytesRead: number;
  totalSupportedFiles: number;
}

type ProjectImportProvider = 'codex-cli' | 'secondary-api' | 'primary-api' | 'local-fallback';

interface ProjectAiResult {
  provider: ProjectImportProvider;
  content: string;
  attempts: string[];
}

interface ProjectExtractionResult {
  kind: ProjectFileSnapshot['kind'];
  extractionMethod: string;
  extractionNote?: string;
  content: string;
  truncated: boolean;
  bytesRead: number;
}

let XLSX: typeof import('xlsx') | null = null;

async function getXLSX(): Promise<typeof import('xlsx')> {
  if (!XLSX) {
    XLSX = await import('xlsx');
  }
  return XLSX;
}

function cleanProjectAddress(value: string): string {
  let cleaned = String(value || '').trim();
  cleaned = cleaned.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (/^file:\/\//i.test(cleaned)) {
    try {
      cleaned = decodeURIComponent(new URL(cleaned).pathname);
      if (process.platform === 'win32') cleaned = cleaned.replace(/^\/([a-zA-Z]:\/)/, '$1');
    } catch {
      cleaned = cleaned.replace(/^file:\/+/i, '');
    }
  }
  return cleaned;
}

function isSupportedGitUrl(address: string): boolean {
  return /^https?:\/\/(?:www\.)?github\.com\/[^/\s]+\/[^/\s]+(?:\.git)?\/?$/i.test(address)
    || /^https?:\/\/[^/\s]+\/[^/\s]+\/[^/\s]+\.git$/i.test(address);
}

function safeProjectImportName(value: string): string {
  return String(value || 'project')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'project';
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
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
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout?.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
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
      if (code === 0) resolve();
      else reject(new Error((stderr || stdout || `${command} exited with code ${code}`).slice(0, 2000)));
    });
  });
}

async function resolveProjectSource(address: string, userId: string): Promise<{ rootPath: string; displayAddress: string; sourceType: 'local' | 'git' }> {
  const cleaned = cleanProjectAddress(address);
  if (isSupportedGitUrl(cleaned)) {
    const repoName = safeProjectImportName(cleaned.replace(/\.git$/i, '').split('/').filter(Boolean).slice(-2).join('_'));
    const cloneRoot = path.join(getDataDir(), 'project-imports', sanitizeUserId(userId), `${Date.now()}_${repoName}`);
    await fs.mkdir(path.dirname(cloneRoot), { recursive: true });
    await runProcess('git', ['clone', '--depth', '1', cleaned, cloneRoot], getDataDir(), 180_000);
    return { rootPath: cloneRoot, displayAddress: cleaned, sourceType: 'git' };
  }

  const rootPath = path.resolve(cleaned);
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) {
    throw new Error('项目地址必须是一个本地文件夹路径，或可 git clone 的仓库 URL');
  }
  return { rootPath, displayAddress: rootPath, sourceType: 'local' };
}

function shouldSkipDirectory(name: string): boolean {
  return PROJECT_IMPORT_EXCLUDED_DIRS.has(name);
}

function isSensitiveProjectFile(name: string): boolean {
  return PROJECT_IMPORT_SENSITIVE_FILE_PATTERNS.some(pattern => pattern.test(name));
}

function isTextProjectFile(filePath: string): boolean {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  if (PROJECT_IMPORT_IMPORTANT_NAMES.has(base)) return true;
  if (PROJECT_IMPORT_TEXT_EXTENSIONS.has(ext)) return true;
  return PROJECT_IMPORT_TEXT_EXTENSIONS.has(base.toLowerCase());
}

function getProjectFileKind(filePath: string): ProjectFileSnapshot['kind'] | null {
  const base = path.basename(filePath);
  const ext = path.extname(base).toLowerCase();
  if (ext === '.csv' || ext === '.xls' || ext === '.xlsx') return 'spreadsheet';
  if (isTextProjectFile(filePath)) return 'text';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.doc' || ext === '.docx') return 'word';
  if (ext === '.ppt' || ext === '.pptx') return 'presentation';
  if (PROJECT_IMPORT_IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PROJECT_IMPORT_DOCUMENT_EXTENSIONS.has(ext)) return 'binary';
  return null;
}

function looksBinary(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, 8192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) return true;
  }
  return false;
}

function normalizeProjectExtractedText(value: string): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function truncateUtf8(value: string, maxBytes: number): { content: string; truncated: boolean; bytesRead: number } {
  const normalized = String(value || '');
  const full = Buffer.from(normalized, 'utf-8');
  if (full.length <= maxBytes) {
    return { content: normalized, truncated: false, bytesRead: full.length };
  }
  let content = full.subarray(0, Math.max(0, maxBytes)).toString('utf-8');
  content = content.replace(/\uFFFD+$/g, '').trimEnd();
  return { content, truncated: true, bytesRead: Buffer.byteLength(content, 'utf-8') };
}

async function readFileHead(filePath: string, bytesToRead: number): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const readResult = await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, readResult.bytesRead);
  } finally {
    await handle.close();
  }
}

function buildMetadataOnlyContent(input: {
  absolutePath: string;
  size: number;
  kind: ProjectFileSnapshot['kind'];
  reason: string;
  extraLines?: string[];
}): string {
  return [
    `[${input.kind} 文件元数据]`,
    `路径：${input.absolutePath}`,
    `大小：${input.size} bytes`,
    `说明：${input.reason}`,
    ...(input.extraLines || []),
  ].join('\n');
}

async function extractTextProjectFile(filePath: string, stat: fsSync.Stats, maxBytes: number): Promise<ProjectExtractionResult> {
  const bytesToRead = Math.min(stat.size, maxBytes);
  const data = await readFileHead(filePath, bytesToRead);
  if (looksBinary(data)) {
    return {
      kind: 'binary',
      extractionMethod: 'metadata-only',
      extractionNote: '文件扩展名看起来是文本，但内容含二进制字节，未按文本导入。',
      content: buildMetadataOnlyContent({
        absolutePath: filePath,
        size: stat.size,
        kind: 'binary',
        reason: '文件内容疑似二进制，已避免写入乱码。',
      }),
      truncated: false,
      bytesRead: data.length,
    };
  }

  const text = normalizeProjectExtractedText(data.toString('utf-8'));
  return {
    kind: 'text',
    extractionMethod: 'utf8-head',
    content: text,
    truncated: stat.size > bytesToRead,
    bytesRead: data.length,
  };
}

async function extractPdfProjectFile(filePath: string, stat: fsSync.Stats, maxBytes: number): Promise<ProjectExtractionResult> {
  if (stat.size > PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'pdf',
      reason: `PDF 超过 ${PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES} bytes，本次只保存元数据。`,
    });
    return { kind: 'pdf', extractionMethod: 'metadata-only', extractionNote: 'PDF 文件过大，未抽取正文。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }

  try {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = normalizeProjectExtractedText(String(result.text || ''));
      if (!text) {
        const content = buildMetadataOnlyContent({
          absolutePath: filePath,
          size: stat.size,
          kind: 'pdf',
          reason: 'PDF 文本为空，可能是扫描件、图片型 PDF 或加密 PDF。',
        });
        return { kind: 'pdf', extractionMethod: 'metadata-only', extractionNote: 'PDF 未抽取到可用正文。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
      }
      const truncated = truncateUtf8(text, maxBytes);
      return {
        kind: 'pdf',
        extractionMethod: 'pdf-parse',
        content: truncated.content,
        truncated: truncated.truncated,
        bytesRead: truncated.bytesRead,
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'pdf',
      reason: `PDF 正文抽取失败：${(error as Error).message}`,
    });
    return { kind: 'pdf', extractionMethod: 'metadata-only', extractionNote: 'PDF 解析失败。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
}

async function extractWordProjectFile(filePath: string, stat: fsSync.Stats, maxBytes: number): Promise<ProjectExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.docx') {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'word',
      reason: '旧版 .doc 二进制格式暂不抽正文；请转换为 .docx、txt 或 md 后可完整导入。',
    });
    return { kind: 'word', extractionMethod: 'metadata-only', extractionNote: '旧版 .doc 暂不支持正文抽取。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
  if (stat.size > PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'word',
      reason: `Word 文件超过 ${PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES} bytes，本次只保存元数据。`,
    });
    return { kind: 'word', extractionMethod: 'metadata-only', extractionNote: 'Word 文件过大，未抽取正文。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }

  try {
    const buffer = await fs.readFile(filePath);
    const result = await mammoth.extractRawText({ buffer });
    const text = normalizeProjectExtractedText(result.value);
    const warningText = result.messages.length > 0 ? result.messages.map(item => item.message).join('; ').slice(0, 500) : undefined;
    if (!text) {
      const content = buildMetadataOnlyContent({
        absolutePath: filePath,
        size: stat.size,
        kind: 'word',
        reason: 'Word 文档未抽取到可用正文。',
      });
      return { kind: 'word', extractionMethod: 'metadata-only', extractionNote: warningText || 'Word 未抽取到可用正文。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
    }
    const truncated = truncateUtf8(text, maxBytes);
    return {
      kind: 'word',
      extractionMethod: 'mammoth',
      extractionNote: warningText,
      content: truncated.content,
      truncated: truncated.truncated,
      bytesRead: truncated.bytesRead,
    };
  } catch (error) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'word',
      reason: `Word 正文抽取失败：${(error as Error).message}`,
    });
    return { kind: 'word', extractionMethod: 'metadata-only', extractionNote: 'Word 解析失败。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
}

function stringifySpreadsheetCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

async function extractSpreadsheetProjectFile(filePath: string, stat: fsSync.Stats, maxBytes: number): Promise<ProjectExtractionResult> {
  if (stat.size > PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'spreadsheet',
      reason: `表格文件超过 ${PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES} bytes，本次只保存元数据。`,
    });
    return { kind: 'spreadsheet', extractionMethod: 'metadata-only', extractionNote: '表格文件过大，未抽取内容。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }

  try {
    const xlsx = await getXLSX();
    const buffer = await fs.readFile(filePath);
    const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: true, raw: false });
    const lines: string[] = [
      `[spreadsheet 表格预览]`,
      `工作簿：${filePath}`,
      `Sheet 数：${workbook.SheetNames.length}`,
    ];
    for (const sheetName of workbook.SheetNames.slice(0, PROJECT_IMPORT_PREVIEW_SHEETS)) {
      const sheet = workbook.Sheets[sheetName];
      const rows = (xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][])
        .slice(0, PROJECT_IMPORT_PREVIEW_ROWS);
      lines.push(`\n## Sheet: ${sheetName}`);
      lines.push(`预览行数：${rows.length}${rows.length >= PROJECT_IMPORT_PREVIEW_ROWS ? '（已截断）' : ''}`);
      for (const row of rows) {
        lines.push(row.map(stringifySpreadsheetCell).join('\t').trimEnd());
      }
    }
    if (workbook.SheetNames.length > PROJECT_IMPORT_PREVIEW_SHEETS) {
      lines.push(`\n[注意：只预览前 ${PROJECT_IMPORT_PREVIEW_SHEETS} 个 Sheet。]`);
    }
    const truncated = truncateUtf8(normalizeProjectExtractedText(lines.join('\n')), maxBytes);
    return {
      kind: 'spreadsheet',
      extractionMethod: 'xlsx-preview',
      content: truncated.content,
      truncated: truncated.truncated,
      bytesRead: truncated.bytesRead,
    };
  } catch (error) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'spreadsheet',
      reason: `表格内容抽取失败：${(error as Error).message}`,
    });
    return { kind: 'spreadsheet', extractionMethod: 'metadata-only', extractionNote: '表格解析失败。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function requireOptionalJsZip(): { loadAsync(buffer: Buffer): Promise<{ files: Record<string, { dir?: boolean; async(type: 'string'): Promise<string> }> }> } | null {
  try {
    return require('jszip');
  } catch {
    return null;
  }
}

async function extractPresentationProjectFile(filePath: string, stat: fsSync.Stats, maxBytes: number): Promise<ProjectExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  if (ext !== '.pptx') {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'presentation',
      reason: '旧版 .ppt 二进制格式暂不抽正文；请转换为 .pptx 后可提取幻灯片文字。',
    });
    return { kind: 'presentation', extractionMethod: 'metadata-only', extractionNote: '旧版 .ppt 暂不支持正文抽取。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
  if (stat.size > PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'presentation',
      reason: `PPTX 超过 ${PROJECT_IMPORT_BINARY_PARSE_MAX_BYTES} bytes，本次只保存元数据。`,
    });
    return { kind: 'presentation', extractionMethod: 'metadata-only', extractionNote: 'PPTX 文件过大，未抽取正文。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }

  const JSZip = requireOptionalJsZip();
  if (!JSZip) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'presentation',
      reason: '未找到 JSZip，无法读取 PPTX 内部幻灯片 XML。',
    });
    return { kind: 'presentation', extractionMethod: 'metadata-only', extractionNote: 'PPTX 解析依赖不可用。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }

  try {
    const buffer = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(buffer);
    const slideNames = Object.keys(zip.files)
      .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
      .sort((a, b) => {
        const aIndex = Number(a.match(/slide(\d+)\.xml/i)?.[1] || 0);
        const bIndex = Number(b.match(/slide(\d+)\.xml/i)?.[1] || 0);
        return aIndex - bIndex;
      });
    const lines: string[] = [
      `[presentation 幻灯片文字预览]`,
      `文件：${filePath}`,
      `幻灯片数：${slideNames.length}`,
    ];
    for (const slideName of slideNames.slice(0, PROJECT_IMPORT_PREVIEW_SLIDES)) {
      const xml = await zip.files[slideName].async('string');
      const parts = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
        .map(match => decodeXmlText(match[1]).trim())
        .filter(Boolean);
      if (parts.length > 0) {
        const slideIndex = Number(slideName.match(/slide(\d+)\.xml/i)?.[1] || 0);
        lines.push(`\n## Slide ${slideIndex}`);
        lines.push(parts.join('\n'));
      }
    }
    if (slideNames.length > PROJECT_IMPORT_PREVIEW_SLIDES) {
      lines.push(`\n[注意：只预览前 ${PROJECT_IMPORT_PREVIEW_SLIDES} 张幻灯片。]`);
    }
    const text = normalizeProjectExtractedText(lines.join('\n'));
    const truncated = truncateUtf8(text || buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'presentation',
      reason: 'PPTX 未抽取到可用文字。',
    }), maxBytes);
    return {
      kind: 'presentation',
      extractionMethod: 'pptx-xml-preview',
      content: truncated.content,
      truncated: truncated.truncated,
      bytesRead: truncated.bytesRead,
    };
  } catch (error) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind: 'presentation',
      reason: `PPTX 文字抽取失败：${(error as Error).message}`,
    });
    return { kind: 'presentation', extractionMethod: 'metadata-only', extractionNote: 'PPTX 解析失败。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
}

function detectImageDimensions(buffer: Buffer, ext: string): { width: number; height: number } | null {
  if (ext === '.png' && buffer.length >= 24 && buffer.subarray(1, 4).toString('ascii') === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if ((ext === '.gif') && buffer.length >= 10 && buffer.subarray(0, 3).toString('ascii') === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (ext === '.bmp' && buffer.length >= 26 && buffer.subarray(0, 2).toString('ascii') === 'BM') {
    return { width: Math.abs(buffer.readInt32LE(18)), height: Math.abs(buffer.readInt32LE(22)) };
  }
  if ((ext === '.jpg' || ext === '.jpeg') && buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      offset += 2 + Math.max(length, 2);
    }
  }
  if (ext === '.webp' && buffer.length >= 30 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buffer.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buffer.length >= 30) {
      const width = 1 + buffer[24] + (buffer[25] << 8) + (buffer[26] << 16);
      const height = 1 + buffer[27] + (buffer[28] << 8) + (buffer[29] << 16);
      return { width, height };
    }
  }
  return null;
}

async function extractImageProjectFile(filePath: string, stat: fsSync.Stats): Promise<ProjectExtractionResult> {
  const ext = path.extname(filePath).toLowerCase();
  const head = await readFileHead(filePath, Math.min(stat.size, 512_000));
  const dimensions = detectImageDimensions(head, ext);
  const content = buildMetadataOnlyContent({
    absolutePath: filePath,
    size: stat.size,
    kind: 'image',
    reason: '图片已作为可追溯文件对象进入项目记忆；当前项目地址导入不做 OCR，不会臆测图片内容。',
    extraLines: [
      `格式：${ext || 'unknown'}`,
      dimensions ? `尺寸：${dimensions.width} x ${dimensions.height}` : '尺寸：未识别',
      '后续建议：接入 OCR/视觉模型后可自动提取图中文字、图表结构和实验照片语义。',
    ],
  });
  return {
    kind: 'image',
    extractionMethod: 'image-metadata',
    extractionNote: '图片仅保存元数据，未 OCR。',
    content,
    truncated: false,
    bytesRead: Buffer.byteLength(content),
  };
}

async function extractProjectFileContent(filePath: string, kind: ProjectFileSnapshot['kind'], stat: fsSync.Stats, maxBytes: number): Promise<ProjectExtractionResult> {
  if (maxBytes <= 0) {
    const content = buildMetadataOnlyContent({
      absolutePath: filePath,
      size: stat.size,
      kind,
      reason: '本次导入已达到总读取量上限，未继续抽取内容。',
    });
    return { kind, extractionMethod: 'metadata-only', extractionNote: '达到总读取量上限。', content, truncated: false, bytesRead: Buffer.byteLength(content) };
  }
  if (kind === 'text') return extractTextProjectFile(filePath, stat, maxBytes);
  if (kind === 'pdf') return extractPdfProjectFile(filePath, stat, maxBytes);
  if (kind === 'word') return extractWordProjectFile(filePath, stat, maxBytes);
  if (kind === 'spreadsheet') return extractSpreadsheetProjectFile(filePath, stat, maxBytes);
  if (kind === 'presentation') return extractPresentationProjectFile(filePath, stat, maxBytes);
  if (kind === 'image') return extractImageProjectFile(filePath, stat);
  const content = buildMetadataOnlyContent({
    absolutePath: filePath,
    size: stat.size,
    kind,
    reason: '该文件类型只保存元数据。',
  });
  return { kind, extractionMethod: 'metadata-only', content, truncated: false, bytesRead: Buffer.byteLength(content) };
}

async function collectProjectFiles(rootPath: string, options: {
  maxFiles: number;
  maxBytesPerFile: number;
  maxTotalBytes: number;
}): Promise<ProjectCollectResult> {
  const files: ProjectFileSnapshot[] = [];
  const skipped: ProjectSkippedFile[] = [];
  let totalBytesRead = 0;
  let totalSupportedFiles = 0;
  const rootReal = await fs.realpath(rootPath);
  const stack = [rootReal];

  while (stack.length > 0) {
    const currentDir = stack.pop() as string;
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));

    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(rootReal, absolutePath).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) {
        skipped.push({ relativePath, reason: '跳过符号链接' });
        continue;
      }
      if (entry.isDirectory()) {
        if (shouldSkipDirectory(entry.name)) {
          skipped.push({ relativePath, reason: '跳过依赖、版本库或构建目录' });
          continue;
        }
        stack.push(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (isSensitiveProjectFile(entry.name)) {
        skipped.push({ relativePath, reason: '跳过疑似密钥/凭据文件' });
        continue;
      }
      const kind = getProjectFileKind(absolutePath);
      if (!kind) {
        skipped.push({ relativePath, reason: '跳过不支持的文件类型' });
        continue;
      }

      totalSupportedFiles += 1;
      const stat = await fs.stat(absolutePath);
      if (files.length >= options.maxFiles) {
        skipped.push({ relativePath, reason: `超过本次读取文件数上限 ${options.maxFiles}`, size: stat.size });
        continue;
      }
      if (totalBytesRead >= options.maxTotalBytes) {
        skipped.push({ relativePath, reason: `超过本次读取总量上限 ${options.maxTotalBytes} bytes`, size: stat.size });
        continue;
      }

      const maxBytesForFile = Math.min(options.maxBytesPerFile, options.maxTotalBytes - totalBytesRead);
      try {
        const extracted = await extractProjectFileContent(absolutePath, kind, stat, maxBytesForFile);
        files.push({
          relativePath,
          absolutePath,
          size: stat.size,
          extension: path.extname(entry.name).toLowerCase(),
          kind: extracted.kind,
          extractionMethod: extracted.extractionMethod,
          extractionNote: extracted.extractionNote,
          content: extracted.content,
          truncated: extracted.truncated,
        });
        totalBytesRead += extracted.bytesRead;
      } catch (error) {
        skipped.push({
          relativePath,
          reason: `文件读取/解析失败：${(error as Error).message}`,
          size: stat.size,
        });
      }
    }
  }

  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN', { numeric: true }));
  return {
    rootPath: rootReal,
    projectName: path.basename(rootReal),
    files,
    skipped,
    totalBytesRead,
    totalSupportedFiles,
  };
}

function formatFileBlock(file: ProjectFileSnapshot): string {
  const truncated = file.truncated ? '\n[注意：该文件只读取了前半部分，因单文件或总读取量限制被截断。]' : '';
  return [
    `----- FILE: ${file.relativePath} -----`,
    `absolute_path: ${file.absolutePath}`,
    `size_bytes: ${file.size}`,
    `extension: ${file.extension || '(none)'}`,
    `kind: ${file.kind}`,
    `extraction_method: ${file.extractionMethod}`,
    file.extractionNote ? `extraction_note: ${file.extractionNote}` : '',
    truncated,
    file.content,
    `----- END FILE: ${file.relativePath} -----`,
  ].filter(Boolean).join('\n');
}

function splitFilesIntoChunks(files: ProjectFileSnapshot[], maxChars: number): ProjectFileSnapshot[][] {
  const chunks: ProjectFileSnapshot[][] = [];
  let current: ProjectFileSnapshot[] = [];
  let currentLength = 0;
  for (const file of files) {
    const blockLength = formatFileBlock(file).length + 2;
    if (current.length > 0 && currentLength + blockLength > maxChars) {
      chunks.push(current);
      current = [];
      currentLength = 0;
    }
    current.push(file);
    currentLength += blockLength;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function buildChunkPrompt(input: {
  projectName: string;
  rootPath: string;
  chunkIndex: number;
  chunkCount: number;
  files: ProjectFileSnapshot[];
}): string {
  const fileBlocks = input.files.map(formatFileBlock).join('\n\n');
  return `你是 Scholar Harness 的“项目地址导入长期记忆”分析器。请阅读下面这一组项目文件，并把每个文件中对跨会话记忆有价值的内容提取出来。

要求：
1. 只基于文件内容输出，不要编造。
2. 必须覆盖本组中的每个文件：说明文件用途、关键类/函数/配置/数据结构、与项目流程的关系。
3. 重点提取后续协作会反复用到的信息，例如入口、命令、路由、数据目录、状态机、核心算法、依赖、测试方式、限制。
4. 输出中文 Markdown，结构清晰，紧凑但不要漏掉关键事实。

项目名：${input.projectName}
项目根目录：${input.rootPath}
文件组：${input.chunkIndex + 1}/${input.chunkCount}

${fileBlocks}`;
}

function buildFinalPrompt(input: {
  projectName: string;
  rootPath: string;
  displayAddress: string;
  sourceType: string;
  collected: ProjectCollectResult;
  chunkSummaries: string[];
}): string {
  const manifest = input.collected.files.map(file =>
    `- ${file.relativePath} (${file.kind}, ${file.extractionMethod}, ${file.size} bytes${file.truncated ? ', truncated' : ''})`
  ).join('\n');
  const skippedSummary = input.collected.skipped.slice(0, 160).map(item =>
    `- ${item.relativePath}: ${item.reason}${item.size ? ` (${item.size} bytes)` : ''}`
  ).join('\n');

  return `你是 Scholar Harness 的项目级长期记忆整合器。下面是对同一个项目所有已读取文件的分组摘要。请把它们合成为可长期保存、下次会话可直接使用的项目记忆。

输出要求：
1. 中文 Markdown。
2. 结构必须包含：项目定位、技术栈/运行命令、目录与关键文件、核心功能流程、数据/记忆/配置位置、跨文件关系、后续开发注意事项、文件级索引。
3. 文件级索引要覆盖已读取文件，按目录归并；每个文件 1-2 句说明。
4. 明确哪些内容是从文件中确认的，哪些是待确认。
5. 不要输出客套话，不要编造未出现在材料里的功能。

项目信息：
- 项目名：${input.projectName}
- 来源地址：${input.displayAddress}
- 来源类型：${input.sourceType}
- 项目根目录：${input.rootPath}
- 已读取文件：${input.collected.files.length}
- 支持文件总数：${input.collected.totalSupportedFiles}
- 读取字节数：${input.collected.totalBytesRead}
- 跳过项：${input.collected.skipped.length}

已读取文件清单：
${manifest || '无'}

跳过项摘要：
${skippedSummary || '无'}

分组摘要：
${input.chunkSummaries.map((summary, index) => `\n## 文件组 ${index + 1}\n${summary}`).join('\n\n')}`;
}

async function runProjectImportAi(
  prompt: string,
  options: { apiUrl?: string; apiKey?: string; model?: string; disabledProviders: Set<string> }
): Promise<ProjectAiResult> {
  const attempts: string[] = [];
  const base: Omit<ChatOptions, 'forceProvider'> = {
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.15,
    maxTokens: 7000,
    codexTimeoutMs: 300000,
    apiUrl: options.apiUrl,
    apiKey: options.apiKey,
    model: options.model,
  };

  const providers: Array<{ forceProvider: ChatOptions['forceProvider']; label: ProjectImportProvider; display: string; disableFallback?: boolean }> = [
    { forceProvider: 'codex', label: 'codex-cli', display: 'Codex CLI', disableFallback: true },
    { forceProvider: 'secondary', label: 'secondary-api', display: '小牛马 API' },
    { forceProvider: 'primary', label: 'primary-api', display: '大牛马 API' },
  ];

  for (const provider of providers) {
    if (options.disabledProviders.has(provider.label)) continue;
    try {
      const content = await chatBridge.chat({
        ...base,
        forceProvider: provider.forceProvider,
        disableFallback: provider.disableFallback,
      });
      return { provider: provider.label, content, attempts };
    } catch (error) {
      const message = `${provider.display}: ${(error as Error).message}`;
      attempts.push(message);
      options.disabledProviders.add(provider.label);
      logger.warn(`[ProjectMemory] ${message}`);
    }
  }

  throw new Error(attempts.join('；') || '所有 AI 引擎都不可用');
}

function buildLocalProjectMemory(input: ProjectCollectResult): string {
  const fileLines = input.files.map(file =>
    `- ${file.relativePath}: ${file.kind}/${file.extractionMethod}；${file.content.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 140) || '文件对象'}${file.truncated ? '（已截断）' : ''}`
  ).join('\n');
  return `# 项目记忆：${input.projectName}

## 项目文件概览
- 根目录：${input.rootPath}
- 已读取文件：${input.files.length}
- 支持文件总数：${input.totalSupportedFiles}
- 读取字节数：${input.totalBytesRead}
- 跳过项：${input.skipped.length}

## 文件级索引
${fileLines || '无可读取文件。'}

## 待确认
AI 引擎不可用，本次只保存了本地文件索引和已抽取内容摘要；建议配置 Codex CLI、小牛马或大牛马后重新导入以生成更完整的语义记忆。`;
}

function truncateMemoryValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[内容过长，已截断。完整版本保存在项目记忆 Markdown 文件中。]`;
}

async function saveProjectImportArtifacts(input: {
  userId: string;
  projectId: string;
  collected: ProjectCollectResult;
  summaryMarkdown: string;
  chunkSummaries: string[];
  address: string;
  sourceType: string;
  provider: ProjectImportProvider;
  attempts: string[];
}): Promise<{ artifactDir: string; summaryPath: string; manifestPath: string; excerptsPath: string }> {
  const artifactDir = path.join(getMemoryDir(), sanitizeUserId(input.userId), 'project-imports', input.projectId);
  await fs.mkdir(artifactDir, { recursive: true });
  const manifestPath = path.join(artifactDir, 'manifest.json');
  const summaryPath = path.join(artifactDir, 'project-memory.md');
  const excerptsPath = path.join(artifactDir, 'file-excerpts.md');
  const manifest = {
    projectId: input.projectId,
    address: input.address,
    sourceType: input.sourceType,
    provider: input.provider,
    attempts: input.attempts,
    generatedAt: new Date().toISOString(),
    rootPath: input.collected.rootPath,
    projectName: input.collected.projectName,
    totalBytesRead: input.collected.totalBytesRead,
    totalSupportedFiles: input.collected.totalSupportedFiles,
    files: input.collected.files.map(file => ({
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      size: file.size,
      extension: file.extension,
      kind: file.kind,
      extractionMethod: file.extractionMethod,
      extractionNote: file.extractionNote,
      truncated: file.truncated,
    })),
    skipped: input.collected.skipped,
  };
  const excerpts = input.collected.files.map(file => formatFileBlock(file)).join('\n\n');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  await fs.writeFile(summaryPath, input.summaryMarkdown, 'utf-8');
  await fs.writeFile(excerptsPath, excerpts, 'utf-8');
  await fs.writeFile(path.join(artifactDir, 'chunk-summaries.md'), input.chunkSummaries.map((summary, index) => `# 文件组 ${index + 1}\n\n${summary}`).join('\n\n---\n\n'), 'utf-8');
  return { artifactDir, summaryPath, manifestPath, excerptsPath };
}

function upsertMemoryEntry(entries: MemoryEntry[], entry: MemoryEntry): void {
  const index = entries.findIndex(item => item.key === entry.key);
  if (index >= 0) entries[index] = entry;
  else entries.push(entry);
}

async function writeProjectMemoryEntries(input: {
  userId: string;
  projectId: string;
  projectName: string;
  address: string;
  summaryMarkdown: string;
  collected: ProjectCollectResult;
  artifactDir: string;
  provider: ProjectImportProvider;
}): Promise<string[]> {
  const now = new Date().toISOString();
  const projectKey = `project_memory_${input.projectId}`;
  const fileIndexKey = `project_files_${input.projectId}`;
  const indexKey = 'project_imports_index';
  const memoryKeys = [projectKey, fileIndexKey, indexKey];

  await withMemoryLock(input.userId, async () => {
    const memory = await loadUserMemory(input.userId);
    memory.userId = input.userId;
    for (const key of memoryKeys) removeFromDeletedKeys(memory, key);

    const fileIndex = input.collected.files.map(file =>
      `- ${file.relativePath} (${file.kind}, ${file.extractionMethod}, ${file.size} bytes${file.truncated ? ', truncated' : ''})`
    ).join('\n');

    const existingIndex = memory.entries.find(entry => entry.key === indexKey)?.value || '';
    const indexLine = `- ${input.projectName}｜${input.address}｜${input.collected.files.length} files｜${now}｜key=${projectKey}`;
    const nextIndex = [
      `# 已导入项目索引`,
      indexLine,
      ...existingIndex.split(/\r?\n/).filter(line => line.trim().startsWith('- ') && !line.includes(`key=${projectKey}`)).slice(0, 40),
    ].join('\n');

    upsertMemoryEntry(memory.entries, {
      key: projectKey,
      value: truncateMemoryValue(`${input.summaryMarkdown}\n\n---\n\n完整项目记忆文件夹：${input.artifactDir}`, 80_000),
      source: `project-import:${input.provider}`,
      timestamp: now,
    });
    upsertMemoryEntry(memory.entries, {
      key: fileIndexKey,
      value: truncateMemoryValue(`# ${input.projectName} 文件级索引\n\n${fileIndex || '无'}\n\n完整文件摘录：${path.join(input.artifactDir, 'file-excerpts.md')}`, 50_000),
      source: 'project-import:file-index',
      timestamp: now,
    });
    upsertMemoryEntry(memory.entries, {
      key: indexKey,
      value: nextIndex,
      source: 'project-import:index',
      timestamp: now,
    });

    await saveUserMemory(memory);
    await saveMemoryToFiles(input.userId, memory);
  });

  return memoryKeys;
}

router.post('/import', async (req: Request, res: Response) => {
  try {
    const parsed = projectImportSchema.parse(req.body || {});
    const userId = await resolveUserId(parsed.userId || 'web-user');
    const source = await resolveProjectSource(parsed.address, userId);
    const collected = await collectProjectFiles(source.rootPath, {
      maxFiles: parsed.maxFiles || 500,
      maxBytesPerFile: parsed.maxBytesPerFile || 220_000,
      maxTotalBytes: parsed.maxTotalBytes || 1_800_000,
    });

    if (collected.files.length === 0) {
      res.status(400).json({
        success: false,
        error: '没有找到可读取的项目文件。请确认路径是项目根目录，且不是只有依赖目录、密钥文件或暂不支持的二进制格式。',
        skipped: collected.skipped.slice(0, 80),
      });
      return;
    }

    const disabledProviders = new Set<string>();
    const allAttempts: string[] = [];
    let provider: ProjectImportProvider = 'local-fallback';
    let summaryMarkdown = '';
    let chunkSummaries: string[] = [];
    const chunks = splitFilesIntoChunks(collected.files, 120_000);

    try {
      for (let index = 0; index < chunks.length; index += 1) {
        const result = await runProjectImportAi(buildChunkPrompt({
          projectName: collected.projectName,
          rootPath: collected.rootPath,
          chunkIndex: index,
          chunkCount: chunks.length,
          files: chunks[index],
        }), {
          apiUrl: parsed.apiUrl,
          apiKey: parsed.apiKey,
          model: parsed.model,
          disabledProviders,
        });
        provider = result.provider;
        allAttempts.push(...result.attempts);
        chunkSummaries.push(result.content);
      }

      const finalResult = await runProjectImportAi(buildFinalPrompt({
        projectName: collected.projectName,
        rootPath: collected.rootPath,
        displayAddress: source.displayAddress,
        sourceType: source.sourceType,
        collected,
        chunkSummaries,
      }), {
        apiUrl: parsed.apiUrl,
        apiKey: parsed.apiKey,
        model: parsed.model,
        disabledProviders,
      });
      provider = finalResult.provider;
      allAttempts.push(...finalResult.attempts);
      summaryMarkdown = finalResult.content;
    } catch (error) {
      allAttempts.push((error as Error).message);
      logger.warn('[ProjectMemory] AI project import failed, using local fallback:', error);
      summaryMarkdown = buildLocalProjectMemory(collected);
      chunkSummaries = [];
      provider = 'local-fallback';
    }

    const projectId = createHash('sha1')
      .update(`${source.displayAddress}\n${collected.rootPath}\n${Date.now()}\n${randomUUID()}`)
      .digest('hex')
      .slice(0, 12);
    const artifacts = await saveProjectImportArtifacts({
      userId,
      projectId,
      collected,
      summaryMarkdown,
      chunkSummaries,
      address: source.displayAddress,
      sourceType: source.sourceType,
      provider,
      attempts: allAttempts,
    });
    const memoryKeys = await writeProjectMemoryEntries({
      userId,
      projectId,
      projectName: collected.projectName,
      address: source.displayAddress,
      summaryMarkdown,
      collected,
      artifactDir: artifacts.artifactDir,
      provider,
    });

    res.json({
      success: true,
      projectId,
      projectName: collected.projectName,
      sourceType: source.sourceType,
      rootPath: collected.rootPath,
      address: source.displayAddress,
      provider,
      attempts: allAttempts,
      fileCount: collected.files.length,
      supportedFileCount: collected.totalSupportedFiles,
      skippedCount: collected.skipped.length,
      totalBytesRead: collected.totalBytesRead,
      truncatedCount: collected.files.filter(file => file.truncated).length,
      memoryKeys,
      artifactDir: artifacts.artifactDir,
      summaryPath: artifacts.summaryPath,
      manifestPath: artifacts.manifestPath,
      excerptsPath: artifacts.excerptsPath,
      summaryMarkdown,
      skippedPreview: collected.skipped.slice(0, 30),
    });
  } catch (error) {
    logger.error('[ProjectMemory] Import failed:', error);
    const message = error instanceof z.ZodError
      ? error.errors.map(item => item.message).join('; ')
      : (error as Error).message;
    res.status(400).json({ success: false, error: message || '项目导入失败' });
  }
});

export default router;
