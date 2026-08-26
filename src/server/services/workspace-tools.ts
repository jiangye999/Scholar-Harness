import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import mammoth = require('mammoth');

import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';
import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';
import {
  appendOfficeCliProps,
  ensureOfficeCliAvailable,
  isOfficeCliOutputPath,
  isOfficeDocumentPath,
  runOfficeCliProcess,
  writeJsonTempFile,
  type OfficeCliProcessResult,
} from './office-cli-service';
import type {
  WorkspaceDirectoryContext,
  WorkspaceDirectoryPermission,
} from './workspace-directory';
import {
  assertPathAuthorizedByWorkspaceRoot,
  isPathWithinRoot,
} from './workspace-path-authorization';
import {
  publishWorkspaceOutputFiles,
  type WorkspaceOutputMirrorResult,
} from './workspace-output-mirror';
import {
  synchronizeSourceFileToAiWorkspace,
} from './workspace-source-sync';
import {
  AI_SOURCE_COPY_DIRECTORY_NAME,
  AI_WORKING_FILES_DIRECTORY_NAME,
  AI_WORKBENCH_OUTPUT_DIRECTORIES,
  USER_VIEW_DIRECTORY_NAME,
  resolveAiSourceCopyPath,
  resolveAiWorkingFilePath,
  type WorkspaceWorkbenchProgress,
} from './workspace-workbench';
import {
  shouldSkipWorkspaceSourceDirectory,
  shouldSkipWorkspaceSourceFile,
} from './workspace-source-policy';
import {
  buildIntegratedDocx,
  importSourceWorkspaceAssets,
} from './workspace-artifact-layout';
import {
  formatFullProjectLegacyForPrompt,
  readRecentProjectConclusions,
  readRecentWorkspaceFiles,
} from './project-memory';
import { getWorkspaceRuleContent } from './workspace-rule-index';

interface FileSnapshot {
  mtimeMs: number;
  size: number;
}

interface GeneratedWorkspaceFile {
  path: string;
  size: number;
  mtimeMs: number;
  kind: 'directory' | 'image' | 'pdf' | 'data' | 'word' | 'presentation' | 'code' | 'text' | 'archive' | 'file';
}

/** Which logical namespace a search hit belongs to. */
type WorkspaceEntryOrigin = 'source' | 'current' | 'archive';

/** Scoped search mode for file_search / grep_files / list_dir. */
export type WorkspaceSearchScope = 'current' | 'archive' | 'all';

interface WorkspaceTreeEntry {
  path: string;
  kind: 'directory' | 'file';
  origin: WorkspaceEntryOrigin;
  /** For archive entries: the archived conversation folder name. */
  originDetail?: string;
}

interface WorkspaceTreeScan {
  entries: WorkspaceTreeEntry[];
  truncated: boolean;
}

interface WalkWorkspaceTreeOptions {
  maxEntries?: number;
  /** Lowercased absolute directory paths to skip entirely during traversal. */
  excludeDirs?: Set<string>;
  origin?: WorkspaceEntryOrigin;
  originDetail?: string;
}

export interface WorkspaceNativeToolResult {
  ok: boolean;
  toolName: string;
  target?: string;
  summary: string;
  data?: unknown;
  error?: string;
}

export interface WorkspaceNativeToolEvent {
  phase: 'start' | 'success' | 'error';
  toolName: string;
  target?: string;
  summary: string;
}

const GENERATED_ATTACHMENT_SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'scholarharness_ai_workspaces',
  '.scholar-harness-workspaces',
  'node_modules',
  'dist',
  'dist-electron',
  '.next',
  '.turbo',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '.tox',
  'coverage',
  'logs',
  'tmp',
  'temp',
  '__pycache__',
  '.venv',
  'venv',
]);

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.xml', '.svg',
  '.py', '.r', '.rmd', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php',
  '.sh', '.bat', '.cmd', '.ps1', '.sql', '.csv', '.tsv', '.bib', '.ris', '.tex', '.log',
]);

const GENERATED_ATTACHMENT_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.svg',
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx', '.csv', '.tsv',
  '.ppt', '.pptx',
  '.r', '.rmd', '.py', '.ipynb', '.js', '.jsx', '.ts', '.tsx', '.ps1', '.sh',
  '.qmd', '.json', '.jsonl', '.yaml', '.yml', '.bib', '.tex', '.html', '.htm',
  '.rds', '.rda', '.rdata', '.sav', '.dta', '.parquet', '.feather', '.ods',
  '.txt', '.md', '.markdown',
  '.zip',
]);

const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_FILES = 100_000;
const MAX_READ_LINES = 500;
const DEFAULT_READ_LINES = 220;
const MAX_TOOL_CONTENT_CHARS = 45_000;
/** read_file 单次返回内容字符上限：防止大文件一次性撑爆对话历史。 */
const READ_FILE_CONTENT_MAX_CHARS = 20_000;
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_CHARS = 32_000;
const MAX_GENERATED_ATTACHMENT_SCAN_FILES = 30_000;
const MAX_GENERATED_ATTACHMENT_RESULTS = 24;
const MAX_OFFICECLI_OUTPUT_CHARS = 45_000;
const OFFICECLI_DEFAULT_TIMEOUT_MS = 60_000;
const OFFICECLI_MAX_TIMEOUT_MS = 180_000;
const SAFE_WORKSPACE_DIR_NAME = 'ScholarHarness_AI_Workspaces';
const SAFE_WORKSPACE_README = 'README_ScholarHarness_AI_Workspace.md';
const TOOL_FILE_KIND_ORDER: GeneratedWorkspaceFile['kind'][] = ['directory', 'word', 'data', 'presentation', 'pdf', 'image', 'code', 'text', 'archive', 'file'];
const GENERIC_CJK_SEARCH_TERMS = new Set([
  '一个',
  '这个',
  '那个',
  '文件',
  '文档',
  '路径',
  '目录',
  '里面',
  '下面',
  '当前',
  '工作',
  '工作目录',
  '找一下',
  '看一下',
  '帮我',
  '帮忙',
  '查看',
  '搜索',
  '查找',
  '定位',
  '打开',
  '读取',
]);

interface WorkspaceEditBackupMeta {
  version: 1;
  backupId: string;
  root: string;
  originalPath: string;
  displayPath: string;
  existed: boolean;
  action: 'write_file' | 'edit_file';
  createdAt: string;
  backupPath?: string;
  aiWorkRoot?: string;
  mirrorPath?: string;
  mirrorExisted?: boolean;
  mirrorBackupPath?: string;
}

export interface WorkspaceSafeWorkInfo {
  enabled: boolean;
  root?: string;
  relativeRoot?: string;
}

export interface WorkspaceSafePreparationOptions {
  signal?: AbortSignal;
  onProgress?: (progress: WorkspaceWorkbenchProgress) => void;
}

function truncateText(text: string, maxChars = MAX_TOOL_CONTENT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} chars omitted]`;
}

/**
 * Enrich tool failures with actionable guidance so the agent converges instead
 * of guessing. ENOENT on read_file was the main driver of runaway loops (the
 * model kept inventing file paths).
 */
function enhanceToolError(toolName: string, error: unknown): string {
  const message = (error as Error)?.message || String(error || 'unknown error');
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  if (code === 'ENOENT') {
    if (toolName === 'read_file') {
      return `${message}。文件不存在：不要猜测路径，先调用 list_dir 或 file_search 确认真实存在的路径和文件名；若连续失败，read_file 会被停用。`;
    }
    return `${message}。目标不存在：先用 list_dir 或 file_search 确认真实路径，不要猜测。`;
  }
  return message;
}

function getWorkspaceBackupRoot(): string {
  return path.join(getDataDir(), 'workspace-edit-backups');
}

function getWorkspaceBackupGroup(root: string): string {
  return createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 20);
}

function createSafeWorkspaceFolderName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `SH-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function sanitizeBackupId(value: unknown): string {
  const id = String(value || '').trim();
  if (!/^[a-f0-9]{20}__[0-9TZ.-]+__[a-f0-9-]+$/i.test(id)) {
    throw new Error('无效的工作目录备份 ID');
  }
  return id;
}

async function findBackupMetaPath(backupId: string): Promise<string> {
  const safeBackupId = sanitizeBackupId(backupId);
  const group = safeBackupId.split('__')[0];
  const metaPath = path.join(getWorkspaceBackupRoot(), group, `${safeBackupId}.json`);
  const stat = await fs.stat(metaPath).catch(() => null);
  if (!stat?.isFile()) throw new Error('工作目录备份不存在或已被清理');
  return metaPath;
}

function buildUnifiedDiff(displayPath: string, before: string, after: string): string {
  if (before === after) return '';
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  let prefix = 0;
  while (prefix < beforeLines.length && prefix < afterLines.length && beforeLines[prefix] === afterLines[prefix]) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix + prefix < beforeLines.length
    && suffix + prefix < afterLines.length
    && beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const context = 4;
  const beforeStart = Math.max(0, prefix - context);
  const afterStart = Math.max(0, prefix - context);
  const beforeEnd = Math.min(beforeLines.length, beforeLines.length - suffix + context);
  const afterEnd = Math.min(afterLines.length, afterLines.length - suffix + context);
  const beforeChangedStart = prefix;
  const beforeChangedEnd = beforeLines.length - suffix;
  const afterChangedStart = prefix;
  const afterChangedEnd = afterLines.length - suffix;
  const lines: string[] = [
    `--- ${displayPath}`,
    `+++ ${displayPath}`,
    `@@ -${beforeStart + 1},${Math.max(0, beforeEnd - beforeStart)} +${afterStart + 1},${Math.max(0, afterEnd - afterStart)} @@`,
  ];

  for (let index = beforeStart; index < beforeChangedStart; index += 1) {
    lines.push(` ${beforeLines[index] ?? ''}`);
  }
  for (let index = beforeChangedStart; index < beforeChangedEnd; index += 1) {
    lines.push(`-${beforeLines[index] ?? ''}`);
  }
  for (let index = afterChangedStart; index < afterChangedEnd; index += 1) {
    lines.push(`+${afterLines[index] ?? ''}`);
  }
  for (let index = Math.max(beforeChangedEnd, beforeEnd - context); index < beforeEnd; index += 1) {
    lines.push(` ${beforeLines[index] ?? ''}`);
  }

  return truncateText(lines.join('\n'), MAX_DIFF_CHARS);
}

function isSubPath(parent: string, child: string): boolean {
  return isPathWithinRoot(parent, child);
}

function normalizeRelativePath(value: unknown): string {
  const input = typeof value === 'string' ? value.trim() : '';
  return input.replace(/^["']|["']$/g, '').replace(/\\/g, path.sep);
}

function isLikelyTextPath(filePath: string): boolean {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function getGeneratedFileKind(filePath: string): GeneratedWorkspaceFile['kind'] {
  const ext = path.extname(filePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tif', '.tiff', '.svg'].includes(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (['.xls', '.xlsx', '.csv', '.tsv'].includes(ext)) return 'data';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  if (['.ppt', '.pptx'].includes(ext)) return 'presentation';
  if (['.r', '.rmd', '.json', '.tex', '.html', '.htm'].includes(ext)) return 'code';
  if (['.txt', '.md', '.markdown'].includes(ext)) return 'text';
  if (ext === '.zip') return 'archive';
  return 'file';
}

function lineNumberedSlice(content: string, startLine: number, maxLines: number): {
  content: string;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  nextStartLine?: number;
} {
  const lines = content.split(/\r?\n/);
  const safeStart = Math.max(1, Math.floor(startLine || 1));
  const safeMax = Math.min(MAX_READ_LINES, Math.max(1, Math.floor(maxLines || DEFAULT_READ_LINES)));
  const startIndex = safeStart - 1;
  const selected = lines.slice(startIndex, startIndex + safeMax);
  const endLine = startIndex + selected.length;
  const truncated = endLine < lines.length;
  return {
    content: selected.map((line, index) => `${safeStart + index}: ${line}`).join('\n'),
    endLine,
    totalLines: lines.length,
    truncated,
    nextStartLine: truncated ? endLine + 1 : undefined,
  };
}

/**
 * 限制 read_file 返回内容的字符量（行号前缀保留）。超过上限时截断并在末尾
 * 注明剩余字符数与继续读取方式，避免大文件/长行一次性撑爆对话历史。
 */
function capReadFileContent(content: string): { content: string; charTruncated: boolean } {
  if (content.length <= READ_FILE_CONTENT_MAX_CHARS) return { content, charTruncated: false };
  return {
    content: `${content.slice(0, READ_FILE_CONTENT_MAX_CHARS)}\n\n[read_file 内容已截断：共 ${content.length} 字符，仅保留前 ${READ_FILE_CONTENT_MAX_CHARS}；如需剩余内容，请用 start_line/max_lines 行窗口继续读取]`,
    charTruncated: true,
  };
}

function parseToolArguments(raw: string): Record<string, unknown> {
  const trimmed = (raw || '').trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Some providers return arguments with relaxed JSON only when the model misbehaves.
  }
  throw new Error(`工具参数不是合法 JSON: ${trimmed.slice(0, 200)}`);
}

function summarizeShellCommand(command: string): string {
  const oneLine = command.replace(/\s+/g, ' ').trim();
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}...` : oneLine;
}

export function isDangerousShellCommand(command: string): boolean {
  const normalized = command.toLowerCase().replace(/\s+/g, ' ').trim();
  const dangerousPatterns = [
    /\brm\s+-rf\s+([/\\]|[a-z]:\\)/i,
    /\brm\b/i,
    /\bdel\b/i,
    /\berase\b/i,
    /\bdel\s+\/[sq]\b/i,
    /\brmdir\b/i,
    /\brmdir\s+\/[sq]\b/i,
    /\bremove-item\b/i,
    /\bremove-item\b[\s\S]*\b-recurse\b[\s\S]*\b-force\b/i,
    // Formatting a disk/volume, NOT the PowerShell Format-Table cmdlet.
    /\bformat\s+(?:[a-z]:|volume|drive|[/\\]\s*[a-z]:)/i,
    /\bshutdown\b/i,
    /\brestart-computer\b/i,
    /\bstop-computer\b/i,
    /\breg\s+delete\b/i,
    /\bgit\s+push\b/i,
    /\bnpm\s+publish\b/i,
    /\bcurl\b[\s\S]*\|\s*(sh|bash|pwsh|powershell|iex)\b/i,
    /\binvoke-webrequest\b[\s\S]*\|\s*(iex|invoke-expression)\b/i,
  ];
  return dangerousPatterns.some((pattern) => pattern.test(normalized));
}

function isReadOnlyShellCommand(command: string): boolean {
  const normalized = command.trim();
  if (/;|&&|\|\||`/.test(normalized)) return false;
  const writePatterns = [
    />/,
    /\b(set-content|add-content|out-file|new-item|remove-item|rename-item|move-item|copy-item)\b/i,
    /\b(mkdir|md|touch|rm|del|erase|rmdir|mv|cp|npm\s+install|pnpm\s+add|yarn\s+add)\b/i,
  ];
  if (writePatterns.some((pattern) => pattern.test(normalized))) return false;
  return /^(dir|ls|pwd|tree|rg|grep|find|type|cat|where|Get-ChildItem|Get-Content|Select-String|git\s+(status|diff|log|show|grep|ls-files)\b)/i.test(normalized);
}

function getShellCompatibilityError(command: string): string | null {
  if (process.platform !== 'win32') return null;
  const normalized = command.trim();
  if (/\|\||&&|\b2>nul\b/i.test(normalized)) {
    return [
      '当前 exec_shell 使用 Windows PowerShell，不支持这条命令里的 bash/cmd 写法。',
      '请改用 PowerShell 语法：文件存在检查用 Test-Path；递归找文件用 Get-ChildItem -Recurse -Filter "*.ext"；多步逻辑用 if (...) { ... } else { ... }。',
    ].join(' ');
  }
  return null;
}

async function readTextFile(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath);
  if (buffer.includes(0)) {
    throw new Error('文件像是二进制文件，不能作为文本读取');
  }
  return buffer.toString('utf-8');
}

interface ReadableWorkspaceFileContent {
  content: string;
  contentType: 'text' | 'docx-text';
  extractionMethod: 'utf-8' | 'mammoth';
  extractionWarnings?: string[];
}

async function readWorkspaceFileContent(filePath: string): Promise<ReadableWorkspaceFileContent> {
  if (path.extname(filePath).toLowerCase() !== '.docx') {
    return {
      content: await readTextFile(filePath),
      contentType: 'text',
      extractionMethod: 'utf-8',
    };
  }

  try {
    const buffer = await fs.readFile(filePath);
    const extracted = await mammoth.extractRawText({ buffer });
    const content = String(extracted.value || '').replace(/\r\n?/g, '\n');
    if (!content.trim()) {
      throw new Error('DOCX 中没有可提取的正文文本');
    }
    return {
      content,
      contentType: 'docx-text',
      extractionMethod: 'mammoth',
      extractionWarnings: extracted.messages
        .map(message => String(message.message || '').trim())
        .filter(Boolean)
        .slice(0, 20),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`DOCX 纯文本提取失败: ${message}`);
  }
}

async function walkWorkspaceTree(
  root: string,
  startDir: string,
  options: WalkWorkspaceTreeOptions = {}
): Promise<WorkspaceTreeScan> {
  const maxEntries = options.maxEntries ?? MAX_SEARCH_FILES;
  const excludeDirs = options.excludeDirs;
  const origin = options.origin ?? 'source';
  const originDetail = options.originDetail;
  const entriesFound: WorkspaceTreeEntry[] = [];
  const pendingDirectories = [startDir];
  let directoryCursor = 0;
  let truncated = false;

  while (directoryCursor < pendingDirectories.length && entriesFound.length < maxEntries) {
    const current = pendingDirectories[directoryCursor];
    directoryCursor += 1;
    let entries: Array<import('fs').Dirent>;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const absolutePath = path.join(current, entry.name);
      const relativePath = (path.relative(root, absolutePath) || entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        // Skip excluded directories (e.g. the AI workspace container when walking
        // the source tree, or the current conversation folder when walking archives).
        if (
          excludeDirs?.has(absolutePath.toLowerCase())
          || shouldSkipWorkspaceSourceDirectory(entry.name)
        ) continue;
        entriesFound.push({ path: relativePath, kind: 'directory', origin, originDetail });
        pendingDirectories.push(absolutePath);
        if (entriesFound.length >= maxEntries) {
          truncated = entryIndex < entries.length - 1 || directoryCursor < pendingDirectories.length;
          break;
        }
        continue;
      }
      if (entry.isFile()) {
        if (shouldSkipWorkspaceSourceFile(entry.name)) continue;
        entriesFound.push({ path: relativePath, kind: 'file', origin, originDetail });
        if (entriesFound.length >= maxEntries) {
          truncated = entryIndex < entries.length - 1 || directoryCursor < pendingDirectories.length;
          break;
        }
      }
      // Symbolic links and junction-like entries are deliberately not followed:
      // their real target may be outside the user-authorized root.
    }
  }

  if (directoryCursor < pendingDirectories.length) {
    truncated = true;
  }
  return { entries: entriesFound, truncated };
}

function scorePathMatch(relativePath: string, query: string): number {
  const target = relativePath.toLowerCase();
  const basename = path.basename(target);
  const needle = query.toLowerCase();
  if (target === needle) return 1000;
  if (basename === needle) return 900;
  if (target.includes(needle)) return 700 - target.indexOf(needle);
  const queryParts = extractPathSearchParts(query);
  if (queryParts.length > 0) {
    const matchedParts = queryParts.filter((part) => target.includes(part));
    if (matchedParts.length === queryParts.length) {
      return 520 + matchedParts.length * 20;
    }
    if (matchedParts.length > 0) {
      return 180 + matchedParts.length * 30;
    }
  }
  if (/(?:word|docx?|文档|word文件)/i.test(query) && /\.(docx?|rtf)$/i.test(relativePath)) {
    return 120;
  }
  if (/(?:草稿|稿件|manuscript|draft)/i.test(query)) {
    if (/(?:草稿|稿件|manuscript|draft|paper|article)/i.test(basename)) return 180;
    if (/\.(?:docx?|rtf|txt|md|markdown|tex)$/i.test(relativePath)) return 80;
  }
  let cursor = 0;
  let fuzzyScore = 0;
  for (const char of needle) {
    const foundAt = target.indexOf(char, cursor);
    if (foundAt === -1) return 0;
    fuzzyScore += foundAt === cursor ? 3 : 1;
    cursor = foundAt + 1;
  }
  return fuzzyScore;
}

function getRequestedToolFileKinds(query: string): GeneratedWorkspaceFile['kind'][] {
  const kinds: GeneratedWorkspaceFile['kind'][] = [];
  const text = String(query || '');
  if (/(?:文件夹|子目录|目录|folder|director(?:y|ies))/i.test(text)) kinds.push('directory');
  if (/(?:word|docx?|rtf|文档|word文件|草稿|稿件|manuscript|draft)/i.test(text)) kinds.push('word');
  if (/(?:excel|xlsx?|csv|tsv|表格|数据表|sheet)/i.test(text)) kinds.push('data');
  if (/(?:pptx?|powerpoint|幻灯片|演示文稿)/i.test(text)) kinds.push('presentation');
  if (/(?:pdf|论文|文献)/i.test(text)) kinds.push('pdf');
  if (/(?:png|jpe?g|tiff?|svg|图片|图像|截图|figure|fig)/i.test(text)) kinds.push('image');
  if (/(?:代码|脚本|r语言|python|\\.r\\b|\\.py\\b|script|code)/i.test(text)) kinds.push('code');
  return Array.from(new Set(kinds));
}

function getToolFileKindSortIndex(kind: GeneratedWorkspaceFile['kind'], requestedKinds: GeneratedWorkspaceFile['kind'][]): number {
  const requestedIndex = requestedKinds.indexOf(kind);
  if (requestedIndex >= 0) return requestedIndex;
  const defaultIndex = TOOL_FILE_KIND_ORDER.indexOf(kind);
  return requestedKinds.length + (defaultIndex >= 0 ? defaultIndex : TOOL_FILE_KIND_ORDER.length);
}

function requestsNewestToolFile(query: string): boolean {
  return /(?:最新|最近|最后修改|最新版|刚生成|新生成|最新生成|刚修改|newest|latest|most\s+recent|last\s+modified|newly\s+(?:created|generated))/i.test(String(query || ''));
}

function requestsCreatedToolFile(query: string): boolean {
  return /(?:生成时间|创建时间|刚生成|新生成|最新生成|creation\s+time|created\s+at|newly\s+(?:created|generated))/i.test(String(query || ''));
}

function requestsModifiedToolFile(query: string): boolean {
  return /(?:修改时间|最后修改|最近修改|刚修改|最新版|modification\s+time|last\s+modified|recently\s+(?:modified|updated))/i.test(String(query || ''));
}

function cleanCjkSearchTerm(raw: string): string {
  return String(raw || '')
    .replace(/^(?:请|帮我|帮忙|麻烦|找一下|找下|找找|查一下|查找|搜索|定位|打开|读取|查看|看一下|看下|看看)+/g, '')
    .replace(/(?:这个|那个|一个|一下|文件|文档|路径|目录|在哪里|在哪|哪里|里面|下面)+$/g, '')
    .trim();
}

function extractPathSearchParts(query: string): string[] {
  const content = String(query || '').toLowerCase();
  const parts = new Set<string>();
  const latinMatches = content.match(/[a-z0-9][a-z0-9_.-]{1,}/g) || [];
  for (const raw of latinMatches) {
    const token = raw.replace(/^[._-]+|[._-]+$/g, '');
    if (token.length >= 2 && !/^(?:word|doc|file|path|find|search|open|read|the|and|for|with)$/.test(token)) {
      parts.add(token);
    }
  }
  const cjkMatches = content.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const raw of cjkMatches) {
    const token = cleanCjkSearchTerm(raw);
    if (token.length >= 2 && !GENERIC_CJK_SEARCH_TERMS.has(token)) {
      parts.add(token);
    }
  }
  return Array.from(parts);
}

function normalizeOfficeCliMode(value: unknown, fallback = 'outline'): string {
  const mode = String(value || fallback).trim().toLowerCase();
  const allowed = new Set([
    'outline',
    'stats',
    'issues',
    'text',
    'annotated',
    'html',
    'screenshot',
    'svg',
    'pdf',
    'forms',
  ]);
  return allowed.has(mode) ? mode : fallback;
}

function normalizeOfficeCliOperation(value: unknown): string {
  const operation = String(value || '').trim().toLowerCase();
  const allowed = new Set([
    'create',
    'set',
    'add',
    'remove',
    'move',
    'swap',
    'batch',
    'save',
    'close',
    'validate',
    'dump',
  ]);
  if (!allowed.has(operation)) {
    throw new Error(`不支持的 OfficeCLI 操作: ${operation || '(empty)'}`);
  }
  return operation;
}

function getOfficeCliSelector(value: unknown, fallback = '/'): string {
  const selector = String(value || '').trim();
  return selector || fallback;
}

function appendOfficeCliBooleanFlag(args: string[], flag: string, enabled: unknown): void {
  if (enabled === true) args.push(flag);
}

function appendOfficeCliNumberFlag(args: string[], flag: string, value: unknown): void {
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) {
    args.push(flag, String(Math.floor(number)));
  }
}

function appendOfficeCliStringFlag(args: string[], flag: string, value: unknown): void {
  const text = String(value || '').trim();
  if (text) args.push(flag, text);
}

export class WorkspaceToolRuntime {
  private root: string;
  private permission: WorkspaceDirectoryPermission;
  private readSnapshots = new Map<string, FileSnapshot>();
  private safeWorkRoot: string | null;
  /** The conversation AI work folder even when read-only (safeWorkRoot is nulled for read-only). */
  private conversationWorkRoot: string | null;
  private safeWorkInitialized = false;

  constructor(workspace: WorkspaceDirectoryContext) {
    this.root = path.resolve(workspace.root);
    this.permission = workspace.permission;
    const requestedSafeWorkRoot = String(workspace.safeWorkRoot || workspace.aiWorkRoot || '').trim();
    const resolvedRequestedSafeWorkRoot = requestedSafeWorkRoot ? path.resolve(requestedSafeWorkRoot) : '';
    const rootIsSafeWorkspaceContainer = path.basename(this.root).toLowerCase() === SAFE_WORKSPACE_DIR_NAME.toLowerCase();
    let validRequestedSafeWorkRoot = !!resolvedRequestedSafeWorkRoot
      && isSubPath(this.root, resolvedRequestedSafeWorkRoot)
      && (
        rootIsSafeWorkspaceContainer
        || path.relative(this.root, resolvedRequestedSafeWorkRoot).toLowerCase().split(/[\\/]+/).includes(SAFE_WORKSPACE_DIR_NAME.toLowerCase())
      );
    if (validRequestedSafeWorkRoot) {
      try {
        assertPathAuthorizedByWorkspaceRoot(this.root, resolvedRequestedSafeWorkRoot);
      } catch {
        validRequestedSafeWorkRoot = false;
      }
    }
    this.conversationWorkRoot = validRequestedSafeWorkRoot ? resolvedRequestedSafeWorkRoot : null;
    this.safeWorkRoot = workspace.permission === 'read-only'
      ? null
      : (validRequestedSafeWorkRoot
          ? resolvedRequestedSafeWorkRoot
          : path.join(
              rootIsSafeWorkspaceContainer ? this.root : path.join(this.root, SAFE_WORKSPACE_DIR_NAME),
              createSafeWorkspaceFolderName()
            ));
  }

  getRoot(): string {
    return this.root;
  }

  getPermission(): WorkspaceDirectoryPermission {
    return this.permission;
  }

  getSafeWorkInfo(): WorkspaceSafeWorkInfo {
    if (!this.safeWorkRoot) {
      return { enabled: false };
    }
    return {
      enabled: true,
      root: this.safeWorkRoot,
      relativeRoot: this.displayPath(this.safeWorkRoot),
    };
  }

  async prepareSafeWorkspace(options: WorkspaceSafePreparationOptions = {}): Promise<WorkspaceSafeWorkInfo> {
    if (this.safeWorkRoot) {
      await this.ensureSafeWorkspace(options);
    }
    return this.getSafeWorkInfo();
  }

  getToolDefinitions(): LLMToolDefinition[] {
    const shellName = process.platform === 'win32' ? 'Windows PowerShell' : 'POSIX /bin/sh';
    const definitions: LLMToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'list_dir',
          description: '递归列出目录及其后代文件/文件夹，不读全文；recursive=false 只看直接子项。scope=current（默认）覆盖用户源目录与当前会话 AI 工作区；archive 为其他历史会话。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的目录路径；空字符串表示根目录。' },
              max_entries: { type: 'number', description: '最多返回多少项，默认 200，最大 500。' },
              recursive: { type: 'boolean', description: '是否递归列出全部后代目录和文件，默认 true。' },
              scope: { type: 'string', description: '检索范围：current（默认，源目录+当前会话工作区）、archive（仅其他历史会话归档）、all（全部）。' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_archived_sessions',
          description: '列出其他历史会话的 AI 工作区（归档）。默认检索不覆盖这些目录；复用旧会话产物时先调用本工具，再用 scope=archive 精确检索。',
          parameters: {
            type: 'object',
            properties: {},
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_search',
          description: '按文件名/路径关键词递归搜索候选文件，结果同时返回 createdAt（生成/创建时间）、modifiedAt（最后修改时间）、origin 与文本预览。用户未精确指定文件时，默认优先相关候选中的最新文件；“刚生成/新生成”按 createdAt，“最新版/最近修改”按 modifiedAt。scope=current（默认）覆盖用户源目录与当前会话 AI 工作区；archive 为其他历史会话。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '要查找的文件名、图名、函数名或路径关键词。' },
              path: { type: 'string', description: '可选：限制在某个子目录及其全部后代目录内搜索。' },
              limit: { type: 'number', description: '最多返回候选数量，默认 50。' },
              scope: { type: 'string', description: '检索范围：current（默认，源目录+当前会话工作区）、archive（仅其他历史会话归档）、all（全部）。' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'grep_files',
          description: '递归搜索文本文件内容，适合查找变量名、函数调用和代码片段，结果带 origin。scope=current（默认）覆盖用户源目录与当前会话 AI 工作区；archive 为其他历史会话。',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: '关键词或 JavaScript 正则表达式。' },
              path: { type: 'string', description: '可选：限制在某个子目录及其全部后代目录内搜索。' },
              include: { type: 'string', description: '可选：文件扩展名或 glob-like 片段，例如 .R、.Rmd、genes。' },
              case_insensitive: { type: 'boolean', description: '是否忽略大小写，默认 true。' },
              context_lines: { type: 'number', description: '每个命中前后返回多少行上下文，默认 1，最大 5。' },
              max_results: { type: 'number', description: '最多返回命中条数，默认 80。' },
              scope: { type: 'string', description: '检索范围：current（默认，源目录+当前会话工作区）、archive（仅其他历史会话归档）、all（全部）。' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取文本文件或 .docx 正文的指定行窗口（默认 220 行，超大内容按字符截断）。用户源目录只读；文件首次明确读取时才按需同步到“源文件副本”，继续修改时优先读取“工作文件”中的最新派生版本。批量读多个文件用 paths 数组。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的文件路径。' },
              paths: { type: 'array', items: { type: 'string' }, description: '可选：相对工作目录的多个文件路径，一次批量读取，最多 20 个。与 path 二选一。' },
              start_line: { type: 'number', description: '起始行号，默认 1。' },
              max_lines: { type: 'number', description: '每个文件最多读取行数，默认 220，最大 500。' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'workspace_overview',
          description: '返回整个工作区目录结构与文本文件预览（每文件前几行），用于快速定位关键文件，适合任务开始时调用。',
          parameters: {
            type: 'object',
            properties: {
              scope: { type: 'string', enum: ['current', 'archive', 'all'], description: '扫描范围，默认 all。' },
              max_entries: { type: 'number', description: '最多返回的文件数，默认 100，最大 200。' },
              preview_lines: { type: 'number', description: '每个文本文件预览前几行，默认 5，最大 10。' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'copy_file_to_workspace',
          description: '把工作目录内文件复制到 AI 工作文件夹，供 Excel/图片/PDF/二进制等不能直接 read_file 的依赖使用；原始文件不改动。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的源文件路径。' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'office_help',
          description: '读取 OfficeCLI 的帮助和 schema。用于不确定 Word/Excel/PPT 元素名、属性名或命令写法时先查帮助。示例 topic: "docx paragraph"、"xlsx cell"、"pptx slide"、"docx set paragraph"。',
          parameters: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: '可选帮助主题；空字符串表示完整 help。' },
              json: { type: 'boolean', description: '是否返回 JSON schema，默认 false。' },
              timeout_ms: { type: 'number', description: '超时时间，默认 60000，最大 180000。' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'office_view',
          description: '用 OfficeCLI 读取或渲染 .docx/.xlsx/.pptx。适合提取文本、查看结构、检查格式问题、生成 HTML/PNG/PDF 预览。不会直接修改原始文件；有 output_path 时输出到安全工作区。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的 .docx/.xlsx/.pptx 文件路径。' },
              mode: { type: 'string', description: 'view 模式：outline/stats/issues/text/annotated/html/screenshot/svg/pdf/forms，默认 outline。' },
              output_path: { type: 'string', description: '可选：HTML/PNG/PDF/SVG/JSON/TXT 输出路径。' },
              page: { type: 'number', description: '可选：页码或幻灯片页码。' },
              start: { type: 'number', description: '可选：起始页/行。' },
              end: { type: 'number', description: '可选：结束页/行。' },
              max_lines: { type: 'number', description: '可选：text 模式最大行数。' },
              json: { type: 'boolean', description: '是否追加 --json，默认 false。' },
              publish: { type: 'boolean', description: '兼容字段；有效输出会自动更新“用户查看”快捷方式，预览和 QA 临时输出仍会过滤。' },
              timeout_ms: { type: 'number', description: '超时时间，默认 60000，最大 180000。' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'office_get',
          description: '用 OfficeCLI get 获取 Word/Excel/PPT 的一个 DOM 节点及子节点，默认返回 JSON。适合修改前确认选择器和结构。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的 .docx/.xlsx/.pptx 文件路径。' },
              selector: { type: 'string', description: 'OfficeCLI 路径选择器，例如 /body/p[1]、/Sheet1/A1、/slide[1]/shape[1]。默认 /。' },
              depth: { type: 'number', description: '子节点深度，默认 2。' },
              json: { type: 'boolean', description: '是否追加 --json，默认 true。' },
              timeout_ms: { type: 'number', description: '超时时间，默认 60000，最大 180000。' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'office_query',
          description: '用 OfficeCLI query 查询 Word/Excel/PPT DOM。适合查找包含某段文字、某类元素、某个单元格或形状的节点，默认返回 JSON。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的 .docx/.xlsx/.pptx 文件路径。' },
              query: { type: 'string', description: 'OfficeCLI 查询表达式，例如 "run:contains(TODO)"。' },
              json: { type: 'boolean', description: '是否追加 --json，默认 true。' },
              timeout_ms: { type: 'number', description: '超时时间，默认 60000，最大 180000。' },
            },
            required: ['path', 'query'],
          },
        },
      },
    ];

    if (this.permission !== 'read-only') {
      definitions.push(
        {
          type: 'function',
          function: {
            name: 'write_file',
          description: '新建或完整替换文本文件，支持 files 数组一次写多个。用户源目录始终只读；已有源文件先复制到 AI 工作台的工作文件区再修改。publish=true 只更新“用户查看”快捷方式，不覆盖源文件。',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '（单文件）目标文件路径。workspace-write 权限下必须位于工作目录内。' },
                content: { type: 'string', description: '（单文件）完整文件内容。' },
                publish: { type: 'boolean', description: '是否在用户目录的“用户查看”文件夹更新该产物快捷方式；默认 false。' },
                files: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      path: { type: 'string', description: '目标文件路径。' },
                      content: { type: 'string', description: '完整文件内容。' },
                    },
                    required: ['path', 'content'],
                  },
                  description: '可选：一次写多个文件；与 path/content 二选一，最多 20 个。',
                },
              },
              required: [],
            },
          },
        },
        {
          type: 'function',
        function: {
          name: 'edit_file',
          description: '对已读取且未变化的 AI 工作文件做唯一字符串替换；edits 数组可一次多处修改。源文件不会被覆盖，修改结果保存在工作文件区并更新“用户查看”快捷方式。',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '目标文件路径。' },
                search: { type: 'string', description: '（单处替换）要替换的原文片段，必须唯一出现。' },
                replace: { type: 'string', description: '（单处替换）替换后的文本。' },
                publish: { type: 'boolean', description: '是否立即更新“用户查看”中的快捷方式。' },
                edits: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      search: { type: 'string', description: '要替换的原文片段，必须唯一出现。' },
                      replace: { type: 'string', description: '替换后的文本。' },
                    },
                    required: ['search', 'replace'],
                  },
                  description: '可选：同一文件的多处替换，按顺序应用；与 search/replace 二选一，最多 20 处。',
                },
              },
              required: ['path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'move_file',
            description: '在已授权工作目录内移动单个文件。目标可以是完整文件路径，也可以是已存在的目录；不会覆盖已有文件。适合扁平化 code/data/images 等子目录、整理图表与数据文件。操作会同步更新用户配置目录和当前会话 AI 工作目录。',
            parameters: {
              type: 'object',
              properties: {
                source: { type: 'string', description: '源文件路径，必须位于已授权工作目录内。' },
                destination: { type: 'string', description: '目标文件路径，或一个已存在的目标目录。必须位于已授权工作目录内。' },
              },
              required: ['source', 'destination'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'remove_empty_directory',
            description: '删除已授权工作目录内一个确认为空的目录。不会递归删除，也不会删除工作目录根、AI 工作目录根或任何仍含文件的目录。适合在 move_file 搬完文件后清理空的 code/data/images 子目录。',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '要删除的空目录路径，必须位于已授权工作目录内。' },
              },
              required: ['path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'office_apply',
            description: '用 OfficeCLI 结构化修改或创建 .docx/.xlsx/.pptx。已有文件先从用户源目录刷新到安全工作区，再在副本上修改并安全发布；不会基于旧副本覆盖用户新版本。修改前优先 office_view/office_get/office_query 确认选择器。',
            parameters: {
              type: 'object',
              properties: {
                operation: { type: 'string', description: '操作：create/set/add/remove/move/swap/batch/save/close/validate/dump。' },
                path: { type: 'string', description: '目标 Office 文件路径。create 时是新文件路径；其他操作是已有文件路径。' },
                selector: { type: 'string', description: 'DOM 选择器，例如 /body/p[1]、/Sheet1/A1、/slide[1]。add 默认 /，其他操作按需填写。' },
                element_type: { type: 'string', description: 'add 操作的元素类型，例如 paragraph、slide、shape、chart、sheet、cell。' },
                props: { type: 'object', description: 'set/add 操作的属性对象，会转为多个 --prop key=value。' },
                commands: { type: 'array', description: 'batch 操作的命令数组，写入临时 JSON 后执行。' },
                output_path: { type: 'string', description: 'dump 操作输出 JSON 路径。' },
                to: { type: 'string', description: 'move 操作目标选择器。' },
                index: { type: 'number', description: 'move 操作插入位置。' },
                with_selector: { type: 'string', description: 'swap 操作交换目标选择器。' },
                json: { type: 'boolean', description: '是否追加 --json，默认 true。' },
              publish: { type: 'boolean', description: 'create/dump 等生成新文件时，是否更新“用户查看”快捷方式；不会覆盖源文档。' },
                timeout_ms: { type: 'number', description: '超时时间，默认 60000，最大 180000。' },
              },
              required: ['operation', 'path'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'import_workspace_assets',
          description: '把源文件按 figureN/tableN/drafts 归类复制到 AI 工作区规范结构；源文件只读，幂等追加。配置工作目录后应调用一次，产生新图表后再次调用。',
            parameters: {
              type: 'object',
              properties: {
                dry_run: { type: 'boolean', description: '只预览将复制哪些文件，不实际写入，默认 false。' },
                build_docx: { type: 'boolean', description: '归类后是否同步重新生成整合 Word（figures_tables.docx），默认 true。' },
              },
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'build_figures_tables_docx',
            description: '生成/刷新三个主要 Word 之一的正文图表文件 figures_tables.docx。系统先累计同一项目全部历史会话的 figures_tables/，再生成完整 Word，禁止只保留当前会话图表。每个图片/表格必须有标题、图注/表注和源文件位置；不得删除或改名该稳定文件。caption/note 可按 figureN/tableN 覆盖。',
            parameters: {
              type: 'object',
              properties: {
                captions: { type: 'object', description: '可选：按 figureN/tableN 覆盖标题与注解，如 {"figure1": {"caption": "标题", "note": "注解"}}。' },
              },
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'build_supplementary_docx',
            description: '生成/刷新三个主要 Word 之一的补充材料 supplementary-materials.docx。读取 supplementary/ 下的 figureN/tableN 子文件夹；每项必须有标题、图注/表注和源文件位置。补充图片或表格发生变化后必须调用；不得删除或改名该稳定文件。',
            parameters: {
              type: 'object',
              properties: {
                captions: { type: 'object', description: '可选：按 figureN/tableN 覆盖标题与注解，如 {"figure1": {"caption": "Supplementary Figure S1", "note": "图注"}}。' },
              },
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'publish_workspace_artifacts',
            description: '为当前会话 AI 工作目录中已确认的最终交付物更新“用户查看”快捷方式。不会复制或覆盖用户源文件；临时脚本、日志、缓存、逐页预览和中间文件不得发布。',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '单个文件相对于当前会话 AI 工作目录的路径。' },
                paths: { type: 'array', items: { type: 'string' }, description: '多个待发布文件，最多 50 个；与 path 二选一。' },
              },
              required: [],
            },
          },
        },
      );
    }

    definitions.push({
      type: 'function',
        function: {
          name: 'exec_shell',
        description: `在 AI 工作台内执行必要的 shell 命令，是一级效率工具：可以把“定位文件→读取→修改→运行→验证”合并进一个命令或脚本一次完成。当前 shell：${shellName}。用户源目录和“源文件副本”只读；修改写入“工作文件”或规范输出目录。最终交付物用 publish_workspace_artifacts 更新“用户查看”快捷方式，不复制回源目录。如果用户已配置 R/Python/OfficeCLI 插件，Rscript、Python、officecli 会自动加入 PATH，并提供 RSCRIPT_PATH/R_HOME/PYTHON_PATH/OFFICECLI_PATH。read-only 权限只允许只读命令；写命令需要 workspace-write 或 danger-full-access；高风险命令会被拦截。`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令。可以是一条批处理命令或脚本（如 python 脚本），把多个步骤一次完成；只读检查优先 rg、dir/Get-ChildItem、git status/diff 等可审计命令。' },
            cwd: { type: 'string', description: '可选：相对工作目录的执行目录。默认工作目录根。' },
            timeout_ms: { type: 'number', description: '超时时间，默认 30000，最大 120000。' },
          },
          required: ['command'],
        },
      },
    });

    definitions.push({
      type: 'function',
      function: {
        name: 'read_workspace_rule',
        description: '按需读取工作目录操作细则或完整对话遗产（key=project_legacy）。系统提示只常驻安全底线；遇到 scope 语义、office_apply、docx 字体、遗产文件定位等场景时调用，不要凭猜测执行。',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '细则键，例如 workspace_scope、safe_workspace、office_tools、docx_fonts、read_file_window、powershell_syntax、search_followup、legacy_block、project_legacy。' },
          },
          required: ['key'],
        },
      },
    });

    return definitions;
  }

  async executeToolCall(call: LLMToolCall): Promise<WorkspaceNativeToolResult> {
    const toolName = call.function.name;
    const args = parseToolArguments(call.function.arguments);
    try {
      switch (toolName) {
        case 'list_dir':
          return await this.listDir(args);
        case 'workspace_overview':
          return await this.workspaceOverview(args);
        case 'file_search':
          return await this.fileSearch(args);
        case 'grep_files':
          return await this.grepFiles(args);
        case 'list_archived_sessions':
          return await this.listArchivedSessions(args);
        case 'read_file':
          return await this.readFile(args);
        case 'copy_file_to_workspace':
          return await this.copyFileToWorkspace(args);
        case 'office_help':
          return await this.officeHelp(args);
        case 'office_view':
          return await this.officeView(args);
        case 'office_get':
          return await this.officeGet(args);
        case 'office_query':
          return await this.officeQuery(args);
        case 'write_file':
          return await this.writeFile(args);
        case 'edit_file':
          return await this.editFile(args);
        case 'move_file':
          return await this.moveFile(args);
        case 'remove_empty_directory':
          return await this.removeEmptyDirectory(args);
        case 'office_apply':
          return await this.officeApply(args);
        case 'import_workspace_assets':
          return await this.importWorkspaceAssets(args);
        case 'build_figures_tables_docx':
          return await this.buildFiguresTablesDocx(args);
        case 'build_supplementary_docx':
          return await this.buildSupplementaryDocx(args);
        case 'publish_workspace_artifacts':
          return await this.publishWorkspaceArtifacts(args);
        case 'exec_shell':
          return await this.execShell(args);
        case 'read_workspace_rule':
          return await this.workspaceRule(args);
        default:
          throw new Error(`未知工作目录工具: ${toolName}`);
      }
    } catch (error) {
      logger.warn(`[WorkspaceToolRuntime] ${toolName} failed: ${(error as Error).message}`);
      return {
        ok: false,
        toolName,
        summary: `${toolName} 执行失败`,
        error: enhanceToolError(toolName, error),
      };
    }
  }

  private async workspaceRule(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const key = String(args.key || '').trim();
    if (!key) throw new Error('read_workspace_rule 需要 key 参数（细则键，如 workspace_scope）');
    if (key === 'project_legacy') {
      // 动态键：完整对话遗产（最近文件 + 历史结论全文），供模型按需读取。
      const [recentFiles, conclusions] = await Promise.all([
        readRecentWorkspaceFiles(this.root, 30),
        readRecentProjectConclusions(this.root, 20),
      ]);
      const content = formatFullProjectLegacyForPrompt(recentFiles, conclusions);
      return {
        ok: true,
        toolName: 'read_workspace_rule',
        target: 'project_legacy',
        summary: `已读取完整对话遗产：${recentFiles.length} 个最近文件、${conclusions.length} 条历史结论`,
        data: {
          key: 'project_legacy',
          content: content || '当前工作目录还没有可用的对话遗产。',
        },
      };
    }
    const content = getWorkspaceRuleContent(key);
    if (!content) {
      throw new Error(`未知细则键: ${key}；可用键见系统提示中的工作目录细则索引`);
    }
    return {
      ok: true,
      toolName: 'read_workspace_rule',
      target: key,
      summary: `已读取工作目录细则 ${key}`,
      data: { key, content },
    };
  }

  private resolveWorkspacePath(inputPath: unknown, expected?: 'file' | 'directory'): string {
    const relativeInput = normalizeRelativePath(inputPath);
    const candidate = path.isAbsolute(relativeInput)
      ? path.resolve(relativeInput)
      : path.resolve(this.root, relativeInput || '.');

    if (this.permission !== 'danger-full-access' && !isSubPath(this.root, candidate)) {
      throw new Error(`路径超出工作目录授权范围: ${relativeInput}`);
    }
    if (this.permission !== 'danger-full-access') {
      assertPathAuthorizedByWorkspaceRoot(this.root, candidate);
    }
    if (expected === 'directory' && path.basename(candidate) && /\.[^\\/]+$/.test(candidate) && !relativeInput.endsWith(path.sep)) {
      // Only a hint: actual stat below is authoritative.
    }
    return candidate;
  }

  private displayPath(absolutePath: string): string {
    return isSubPath(this.root, absolutePath)
      ? (path.relative(this.root, absolutePath) || '.')
      : absolutePath;
  }

  private displaySafeWorkspacePath(): string {
    return this.safeWorkRoot ? this.displayPath(this.safeWorkRoot) : '.';
  }

  private isInSafeWorkspace(absolutePath: string): boolean {
    return !!this.safeWorkRoot && isSubPath(this.safeWorkRoot, absolutePath);
  }

  private async sourceCounterpartForSafeFile(filePath: string): Promise<string | null> {
    if (!this.safeWorkRoot || !this.isInSafeWorkspace(filePath)) return null;
    const sourceCopyRoot = path.join(this.safeWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME);
    if (!isSubPath(sourceCopyRoot, filePath)) return null;
    const relativePath = path.relative(sourceCopyRoot, filePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
    const sourcePath = path.resolve(this.root, relativePath);
    if (!isSubPath(this.root, sourcePath) || this.isInAiWorkspaceContainer(sourcePath)) return null;
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    return sourceStat?.isFile() ? sourcePath : null;
  }

  private async tryRunGit(args: string[], signal?: AbortSignal): Promise<void> {
    if (!this.safeWorkRoot) return;
    if (signal?.aborted) {
      const error = new Error('工作目录准备已取消');
      error.name = 'AbortError';
      throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: this.safeWorkRoot as string,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', handleAbort);
        resolve();
      };
      const handleAbort = (): void => {
        if (settled) return;
        settled = true;
        child.kill();
        signal?.removeEventListener('abort', handleAbort);
        const error = new Error('工作目录准备已取消');
        error.name = 'AbortError';
        reject(error);
      };
      signal?.addEventListener('abort', handleAbort, { once: true });
      child.on('error', finish);
      child.on('close', finish);
    });
  }

  private async ensureSafeGitRepository(signal?: AbortSignal): Promise<void> {
    if (!this.safeWorkRoot) return;
    const gitDirectory = await fs.stat(path.join(this.safeWorkRoot, '.git')).catch(() => null);
    if (gitDirectory?.isDirectory()) return;
    await this.tryRunGit(['init'], signal);
    await this.tryRunGit(['config', 'user.name', 'Scholar Harness'], signal);
    await this.tryRunGit(['config', 'user.email', 'scholar-harness@local'], signal);
    await this.tryRunGit(['commit', '--allow-empty', '-m', 'Initialize Scholar Harness AI workspace'], signal);
  }

  private async ensureSafeWorkspace(options: WorkspaceSafePreparationOptions = {}): Promise<string> {
    if (!this.safeWorkRoot) return this.root;
    if (this.safeWorkInitialized) return this.safeWorkRoot;

    await fs.mkdir(this.safeWorkRoot, { recursive: true });
    this.safeWorkInitialized = true;

    return this.safeWorkRoot;
  }

  private safePathForOriginal(originalPath: string): string {
    if (!this.safeWorkRoot) return originalPath;
    if (this.isInSafeWorkspace(originalPath)) return originalPath;
    if (!isSubPath(this.root, originalPath)) {
      throw new Error('安全工作区只能复制工作目录内文件');
    }
    return resolveAiSourceCopyPath(this.root, this.safeWorkRoot, originalPath);
  }

  private workingPathForOriginal(originalPath: string): string {
    if (!this.safeWorkRoot) return originalPath;
    return resolveAiWorkingFilePath(this.root, this.safeWorkRoot, originalPath);
  }

  private generatedPathForOriginal(originalPath: string): string {
    if (!this.safeWorkRoot) return originalPath;
    const relativePath = path.relative(this.root, originalPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      throw new Error('AI 生成文件必须位于用户配置目录的逻辑范围内');
    }
    const firstSegment = relativePath.split(/[\\/]+/)[0].toLowerCase();
    const canonicalDirs = [
      AI_WORKING_FILES_DIRECTORY_NAME,
      ...Object.values(AI_WORKBENCH_OUTPUT_DIRECTORIES),
    ];
    const canonical = canonicalDirs.find(item => item.toLowerCase() === firstSegment);
    if (canonical) return path.resolve(this.safeWorkRoot, relativePath);

    const baseName = path.basename(relativePath);
    const extension = path.extname(baseName).toLowerCase();
    let outputDirectory: string = AI_WORKBENCH_OUTPUT_DIRECTORIES.other;
    if (/(?:framework|outline|结构|框架|提纲)/i.test(baseName)) {
      outputDirectory = AI_WORKBENCH_OUTPUT_DIRECTORIES.framework;
    } else if (/(?:draft|manuscript|正文|草稿)/i.test(baseName) || ['.doc', '.docx', '.rtf'].includes(extension)) {
      outputDirectory = AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts;
    } else if (
      /(?:figure|fig|table|plot|chart|图|表)/i.test(baseName)
      || ['.png', '.jpg', '.jpeg', '.svg', '.tif', '.tiff'].includes(extension)
    ) {
      outputDirectory = AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables;
    } else if (/(?:supp|supplement|appendix|补充|附录)/i.test(baseName)) {
      outputDirectory = AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary;
    }
    return path.resolve(this.safeWorkRoot, outputDirectory, relativePath);
  }

  private async ensureSafeCopyForFile(originalPath: string): Promise<string> {
    if (!this.safeWorkRoot || this.isInSafeWorkspace(originalPath)) return originalPath;
    const safeRoot = await this.ensureSafeWorkspace();
    const safePath = this.safePathForOriginal(originalPath);
    const originalStat = await fs.stat(originalPath).catch(() => null);
    if (!originalStat?.isFile()) return safePath;
    const synced = await synchronizeSourceFileToAiWorkspace(originalPath, safePath, {
      verifyContentWhenMetadataEqual: true,
    });
    if (synced.copied) {
      await this.ensureSafeGitRepository();
      await this.tryRunGit(['add', path.relative(safeRoot, safePath)]);
      await this.tryRunGit(['commit', '-m', `Refresh source file ${this.displayPath(originalPath)}`]);
    }
    return safePath;
  }

  private async ensureWorkingCopyForFile(originalPath: string): Promise<string> {
    if (!this.safeWorkRoot) return originalPath;
    const sourceCopy = await this.ensureSafeCopyForFile(originalPath);
    const workingPath = this.workingPathForOriginal(originalPath);
    const workingStat = await fs.stat(workingPath).catch(() => null);
    if (!workingStat?.isFile()) {
      const sourceCopyStat = await fs.stat(sourceCopy).catch(() => null);
      if (!sourceCopyStat?.isFile()) return workingPath;
      await fs.mkdir(path.dirname(workingPath), { recursive: true });
      await fs.copyFile(sourceCopy, workingPath);
    }
    return workingPath;
  }

  private async resolveReadableFilePath(filePath: string): Promise<{ sourcePath: string; readPath: string }> {
    if (!this.safeWorkRoot) {
      return { sourcePath: filePath, readPath: filePath };
    }
    if (this.isInSafeWorkspace(filePath)) {
      const sourcePath = await this.sourceCounterpartForSafeFile(filePath);
      if (!sourcePath) return { sourcePath: filePath, readPath: filePath };
      const readPath = await this.ensureWorkingCopyForFile(sourcePath);
      return { sourcePath, readPath };
    }
    // A file inside the AI workspace container but OUTSIDE the current
    // conversation folder is another session's AI artifact. Read it in place
    // instead of copying it into the current safe work root — copying produced
    // a nested "ScholarHarness_AI_Workspaces/<old-conversation>/..." path that
    // made the agent search the same file over and over in a loop.
    if (this.isInAiWorkspaceContainer(filePath)) {
      return { sourcePath: filePath, readPath: filePath };
    }
    const workingPath = await this.ensureWorkingCopyForFile(filePath);
    return { sourcePath: filePath, readPath: workingPath };
  }

  private isInAiWorkspaceContainer(filePath: string): boolean {
    const container = path.join(this.root, SAFE_WORKSPACE_DIR_NAME);
    return isSubPath(container, filePath);
  }

  private async resolveWritableFilePath(filePath: string): Promise<{ sourcePath: string; writePath: string; safeRedirected: boolean }> {
    this.assertWritable(filePath);
    if (!this.safeWorkRoot) {
      return { sourcePath: filePath, writePath: filePath, safeRedirected: false };
    }
    if (this.isInSafeWorkspace(filePath)) {
      const sourcePath = await this.sourceCounterpartForSafeFile(filePath);
      if (!sourcePath) return { sourcePath: filePath, writePath: filePath, safeRedirected: false };
      const writePath = await this.ensureWorkingCopyForFile(sourcePath);
      return { sourcePath, writePath, safeRedirected: true };
    }
    const sourceStat = await fs.stat(filePath).catch(() => null);
    const writePath = sourceStat?.isFile()
      ? await this.ensureWorkingCopyForFile(filePath)
      : this.generatedPathForOriginal(filePath);
    return { sourcePath: filePath, writePath, safeRedirected: true };
  }

  private async resolveShellCwd(requestedCwd: string): Promise<{ originalCwd: string; cwd: string; safeRedirected: boolean }> {
    if (!this.safeWorkRoot) {
      return { originalCwd: requestedCwd, cwd: requestedCwd, safeRedirected: false };
    }
    if (this.isInSafeWorkspace(requestedCwd)) {
      return { originalCwd: requestedCwd, cwd: requestedCwd, safeRedirected: false };
    }
    const safeRoot = await this.ensureSafeWorkspace();
    const safeCwd = safeRoot;
    if (!isSubPath(safeRoot, safeCwd)) {
      throw new Error('安全工作区 cwd 无效');
    }
    await fs.mkdir(safeCwd, { recursive: true });
    return { originalCwd: requestedCwd, cwd: safeCwd, safeRedirected: true };
  }

  private async commitSafeWorkspaceChange(message: string): Promise<void> {
    if (!this.safeWorkRoot) return;
    await this.ensureSafeGitRepository();
    await this.tryRunGit(['add', '-A']);
    await this.tryRunGit(['commit', '-m', message.slice(0, 180)]);
  }

  private async publishOutputsToConfiguredRoot(filePaths: string[]): Promise<WorkspaceOutputMirrorResult[]> {
    if (!this.safeWorkRoot || filePaths.length === 0) return [];
    const results = await publishWorkspaceOutputFiles(filePaths, this.root, this.safeWorkRoot);
    results
      .filter(result => !result.mirrored)
      .forEach(result => logger.warn(
        `[WorkspaceToolRuntime] Failed to publish output ${result.sourcePath} -> ${result.targetPath}: ${result.error || 'unknown error'}`
      ));
    return results;
  }

  private async publishWorkspaceArtifacts(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    if (!this.safeWorkRoot) {
      throw new Error('当前会话没有可发布的 AI 工作目录');
    }
    const rawPaths = Array.isArray(args.paths)
      ? args.paths
      : (typeof args.path === 'string' ? [args.path] : []);
    const selectedPaths = rawPaths
      .slice(0, 50)
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => {
        const candidate = path.isAbsolute(value)
          ? path.resolve(value)
          : path.resolve(this.safeWorkRoot as string, value);
        if (!this.isInSafeWorkspace(candidate)) {
          throw new Error(`只允许发布当前会话 AI 工作目录内的文件: ${value}`);
        }
        return candidate;
      });
    if (!selectedPaths.length) {
      throw new Error('请提供 path 或 paths');
    }
    const invalidPath = await Promise.all(selectedPaths.map(async filePath => {
      const stat = await fs.stat(filePath).catch(() => null);
      return stat?.isFile() ? '' : filePath;
    })).then(values => values.find(Boolean));
    if (invalidPath) {
      throw new Error(`发布目标不是文件或不存在: ${this.displayPath(invalidPath)}`);
    }
    const published = await this.publishOutputsToConfiguredRoot(selectedPaths);
    const failed = published.filter(result => !result.mirrored);
    if (failed.length) {
      throw new Error(`有 ${failed.length} 个文件发布失败: ${failed[0].error || failed[0].relativePath}`);
    }
    return {
      ok: true,
      toolName: 'publish_workspace_artifacts',
      target: `${published.length} 个文件`,
      summary: `已在“用户查看”中更新 ${published.length} 个交付物快捷方式`,
      data: {
        published,
        count: published.length,
        safeWorkspaceRoot: this.displaySafeWorkspacePath(),
      },
    };
  }

  /**
   * P0 (scoped retrieval): the AI workspace container is NOT part of the user's
   * source tree. Searching it by default is what made the agent chase N stale
   * copies of the same file across old conversations. Default scope therefore
   * covers ONLY (a) the user source tree minus the container, and (b) the
   * CURRENT conversation's AI work folder. Other conversations are an archive
   * namespace reachable via scope=archive / scope=all or list_archived_sessions.
   */
  private aiWorkspaceContainerRoot(): string {
    return path.basename(this.root).toLowerCase() === SAFE_WORKSPACE_DIR_NAME.toLowerCase()
      ? this.root
      : path.join(this.root, SAFE_WORKSPACE_DIR_NAME);
  }

  private currentConversationRoot(): string | null {
    return this.safeWorkRoot || this.conversationWorkRoot;
  }

  private isContainerRoot(): boolean {
    return path.basename(this.root).toLowerCase() === SAFE_WORKSPACE_DIR_NAME.toLowerCase();
  }

  private archiveOriginDetail(relativePath: string): string {
    const segments = relativePath.split('/');
    const containerIdx = segments.findIndex(segment => segment.toLowerCase() === SAFE_WORKSPACE_DIR_NAME.toLowerCase());
    const folderIdx = containerIdx >= 0 ? containerIdx + 1 : 0;
    return segments[folderIdx] || '';
  }

  private normalizeScope(value: unknown): WorkspaceSearchScope {
    const raw = String(value || 'current').trim().toLowerCase();
    if (raw === 'archive' || raw === 'all') return raw;
    return 'current';
  }

  private async getScopedSearchEntries(startDir: string, scope: WorkspaceSearchScope): Promise<WorkspaceTreeScan> {
    const containerRoot = this.aiWorkspaceContainerRoot();
    const containerIsRoot = this.isContainerRoot();
    const currentRoot = this.currentConversationRoot();
    const collected: WorkspaceTreeEntry[] = [];
    let truncated = false;
    const merge = (scan: WorkspaceTreeScan): void => {
      collected.push(...scan.entries);
      truncated = truncated || scan.truncated;
    };

    const includeSource = scope === 'current' || scope === 'all';
    const includeArchive = scope === 'archive' || scope === 'all';

    if (includeSource) {
      const exclude = new Set<string>();
      if (!containerIsRoot) exclude.add(containerRoot.toLowerCase());
      exclude.add(path.join(this.root, USER_VIEW_DIRECTORY_NAME).toLowerCase());
      merge(await walkWorkspaceTree(this.root, this.root, { excludeDirs: exclude, origin: 'source' }));
      if (currentRoot) {
        merge(await walkWorkspaceTree(this.root, currentRoot, { origin: 'current' }));
      }
    }

    if (includeArchive) {
      const exclude = new Set<string>();
      if (currentRoot) exclude.add(path.resolve(currentRoot).toLowerCase());
      const scan = await walkWorkspaceTree(this.root, containerRoot, { excludeDirs: exclude, origin: 'archive' });
      for (const entry of scan.entries) {
        entry.originDetail = this.archiveOriginDetail(entry.path);
      }
      merge(scan);
    }

    // Respect an explicit startDir restriction (default startDir is the root).
    if (path.resolve(startDir).toLowerCase() !== path.resolve(this.root).toLowerCase()) {
      const startRelative = path.relative(this.root, startDir).replace(/\\/g, '/');
      const kept = collected.filter(entry =>
        entry.path === startRelative || entry.path.startsWith(`${startRelative}/`));
      return { entries: kept, truncated };
    }
    return { entries: collected, truncated };
  }

  private async getScopedSearchFiles(startDir: string, scope: WorkspaceSearchScope): Promise<{ files: string[]; truncated: boolean }> {
    const scan = await this.getScopedSearchEntries(startDir, scope);
    return {
      files: scan.entries.filter(entry => entry.kind === 'file').map(entry => entry.path),
      truncated: scan.truncated,
    };
  }

  private originRank(entry: { origin: WorkspaceEntryOrigin }): number {
    if (entry.origin === 'current') return 0;
    if (entry.origin === 'source') return 1;
    return 2;
  }

  private async snapshot(filePath: string): Promise<FileSnapshot> {
    const stat = await fs.stat(filePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  }

  private async snapshotGeneratedAttachmentFiles(): Promise<Map<string, FileSnapshot>> {
    const snapshot = new Map<string, FileSnapshot>();
    let scanned = 0;

    const walk = async (dir: string): Promise<void> => {
      if (scanned >= MAX_GENERATED_ATTACHMENT_SCAN_FILES) return;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (scanned >= MAX_GENERATED_ATTACHMENT_SCAN_FILES) break;
        if (entry.isDirectory()) {
          if (GENERATED_ATTACHMENT_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
          if (
            this.safeWorkRoot
            && path.resolve(dir, entry.name) === path.resolve(this.safeWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME)
          ) continue;
          await walk(path.join(dir, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        scanned += 1;
        const absolutePath = path.join(dir, entry.name);
        if (!GENERATED_ATTACHMENT_EXTENSIONS.has(path.extname(absolutePath).toLowerCase())) continue;
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat?.isFile()) continue;
        snapshot.set(absolutePath, {
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        });
      }
    };

    const scanRoot = this.safeWorkRoot && (await fs.stat(this.safeWorkRoot).catch(() => null))?.isDirectory()
      ? this.safeWorkRoot
      : this.root;
    await walk(scanRoot);
    return snapshot;
  }

  private diffGeneratedAttachmentFiles(
    before: Map<string, FileSnapshot>,
    after: Map<string, FileSnapshot>
  ): GeneratedWorkspaceFile[] {
    const changed: GeneratedWorkspaceFile[] = [];
    for (const [absolutePath, next] of after.entries()) {
      const previous = before.get(absolutePath);
      if (previous && previous.mtimeMs === next.mtimeMs && previous.size === next.size) continue;
      changed.push({
        path: this.displayPath(absolutePath),
        size: next.size,
        mtimeMs: next.mtimeMs,
        kind: getGeneratedFileKind(absolutePath),
      });
    }
    return changed
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_GENERATED_ATTACHMENT_RESULTS);
  }

  private async createEditBackup(
    filePath: string,
    displayPath: string,
    existed: boolean,
    beforeContent: string,
    action: WorkspaceEditBackupMeta['action']
  ): Promise<WorkspaceEditBackupMeta> {
    const group = getWorkspaceBackupGroup(this.root);
    const backupId = `${group}__${new Date().toISOString().replace(/[:]/g, '-')}__${randomUUID()}`;
    const backupDir = path.join(getWorkspaceBackupRoot(), group);
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = existed ? path.join(backupDir, `${backupId}.bak`) : undefined;
    if (backupPath) {
      await fs.writeFile(backupPath, beforeContent, 'utf-8');
    }
    const meta: WorkspaceEditBackupMeta = {
      version: 1,
      backupId,
      root: this.root,
      originalPath: filePath,
      displayPath,
      existed,
      action,
      createdAt: new Date().toISOString(),
      backupPath,
      aiWorkRoot: this.safeWorkRoot || undefined,
    };
    await fs.writeFile(path.join(backupDir, `${backupId}.json`), JSON.stringify(meta, null, 2), 'utf-8');
    return meta;
  }

  private async noteRead(filePath: string): Promise<void> {
    this.readSnapshots.set(filePath, await this.snapshot(filePath));
  }

  private async assertFreshRead(filePath: string): Promise<void> {
    const before = this.readSnapshots.get(filePath);
    if (!before) {
      throw new Error('修改文件前必须先 read_file 读取该文件，避免盲改');
    }
    const now = await this.snapshot(filePath);
    if (before.mtimeMs !== now.mtimeMs || before.size !== now.size) {
      throw new Error('文件在读取后发生变化，请重新 read_file 后再编辑');
    }
  }

  private assertWritable(filePath: string): void {
    if (this.permission === 'read-only') {
      throw new Error('当前工作目录权限为 read-only，不能写入或修改文件');
    }
    if (this.permission === 'workspace-write' && !isSubPath(this.root, filePath)) {
      throw new Error('workspace-write 权限只能修改工作目录内文件');
    }
  }

  private assertAuthorizedMutationPath(targetPath: string): void {
    this.assertWritable(targetPath);
    if (!isSubPath(this.root, targetPath)) {
      throw new Error('文件移动和目录清理只能作用于已授权工作目录内的路径');
    }
    assertPathAuthorizedByWorkspaceRoot(this.root, targetPath);
  }

  private async listArchivedSessions(_args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const containerRoot = this.aiWorkspaceContainerRoot();
    const currentRoot = this.currentConversationRoot();
    const entries = await fs.readdir(containerRoot, { withFileTypes: true }).catch(() => []);
    const sessions: Array<{ name: string; path: string; modifiedAt: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const absolutePath = path.join(containerRoot, entry.name);
      if (currentRoot && path.resolve(absolutePath).toLowerCase() === path.resolve(currentRoot).toLowerCase()) continue;
      const stat = await fs.stat(absolutePath).catch(() => null);
      sessions.push({
        name: entry.name,
        path: this.displayPath(absolutePath),
        modifiedAt: stat?.mtime.toISOString() || '',
      });
    }
    sessions.sort((a, b) => (b.modifiedAt || '').localeCompare(a.modifiedAt || ''));
    return {
      ok: true,
      toolName: 'list_archived_sessions',
      target: this.displayPath(containerRoot),
      summary: `归档会话 ${sessions.length} 个（其他历史会话的工作区，默认检索不覆盖）`,
      data: { sessions },
    };
  }

  private async listDir(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const dirPath = this.resolveWorkspacePath(args.path, 'directory');
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`不是目录: ${this.displayPath(dirPath)}`);
    }
    const scope = this.normalizeScope(args.scope);
    const maxEntries = Math.min(MAX_LIST_ENTRIES, Math.max(1, Number(args.max_entries) || 200));
    const recursive = args.recursive !== false;
    if (recursive) {
      const scan = await this.getScopedSearchEntries(dirPath, scope);
      const selected = scan.entries
        .slice()
        .sort((a, b) => this.originRank(a) - this.originRank(b) || (Number(b.kind === 'directory') - Number(a.kind === 'directory')) || a.path.localeCompare(b.path))
        .slice(0, maxEntries);
      const rows = await Promise.all(selected.map(async entry => {
        const absolutePath = path.resolve(this.root, entry.path);
        if (entry.kind === 'directory') {
          return {
            name: path.basename(entry.path),
            path: entry.path,
            kind: 'directory',
            origin: entry.origin,
            ...(entry.originDetail ? { originDetail: entry.originDetail } : {}),
          };
        }
        const fileStat = await fs.stat(absolutePath).catch(() => null);
        return {
          name: path.basename(entry.path),
          path: entry.path,
          kind: isLikelyTextPath(absolutePath) ? 'text' : 'binary',
          size: fileStat?.size ?? null,
          origin: entry.origin,
          ...(entry.originDetail ? { originDetail: entry.originDetail } : {}),
        };
      }));
      const truncated = scan.truncated || scan.entries.length > rows.length;
      return {
        ok: true,
        toolName: 'list_dir',
        target: this.displayPath(dirPath),
        summary: `递归列出 ${this.displayPath(dirPath)}：返回 ${rows.length} 个目录或文件${truncated ? '，结果已截断' : ''}`,
        data: {
          path: this.displayPath(dirPath),
          recursive: true,
          scope,
          entries: rows,
          truncated,
        },
      };
    }

    const entries = (await fs.readdir(dirPath, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() || entry.isFile());
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    const rows = await Promise.all(entries.slice(0, maxEntries).map(async (entry) => {
      const absolutePath = path.join(dirPath, entry.name);
      const relative = this.displayPath(absolutePath);
      if (entry.isDirectory()) {
        return { name: entry.name, path: relative, kind: 'directory' };
      }
      const fileStat = await fs.stat(absolutePath).catch(() => null);
      return {
        name: entry.name,
        path: relative,
        kind: isLikelyTextPath(absolutePath) ? 'text' : 'binary',
        size: fileStat?.size ?? null,
      };
    }));
    const truncated = entries.length > rows.length;
    return {
      ok: true,
      toolName: 'list_dir',
      target: this.displayPath(dirPath),
      summary: `列出 ${this.displayPath(dirPath)}：${rows.length}/${entries.length} 项`,
      data: { path: this.displayPath(dirPath), recursive: false, entries: rows, truncated },
    };
  }

  private async workspaceOverview(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const scope = this.normalizeScope(args.scope ?? 'all');
    const maxEntries = Math.min(200, Math.max(1, Number(args.max_entries) || 100));
    const previewLines = Math.min(10, Math.max(1, Number(args.preview_lines) || 5));
    const scan = await this.getScopedSearchEntries(this.root, scope);

    const directories = scan.entries.filter(entry => entry.kind === 'directory');
    const files = scan.entries.filter(entry => entry.kind !== 'directory');
    const sortedFiles = files
      .slice()
      .sort((a, b) => this.originRank(a) - this.originRank(b) || a.path.localeCompare(b.path))
      .slice(0, maxEntries);

    const fileRows: Array<Record<string, unknown>> = [];
    for (const entry of sortedFiles) {
      const absolutePath = path.resolve(this.root, entry.path);
      const fileStat = await fs.stat(absolutePath).catch(() => null);
      const isText = isLikelyTextPath(absolutePath);
      let preview = '';
      if (isText && fileStat) {
        try {
          const text = await readTextFile(absolutePath).catch(() => '');
          preview = text.split(/\r?\n/).slice(0, previewLines).join('\n');
          if (preview.length > 600) preview = `${preview.slice(0, 600)}…`;
        } catch {
          preview = '';
        }
      }
      fileRows.push({
        name: path.basename(entry.path),
        path: entry.path,
        kind: isText ? 'text' : 'binary',
        size: fileStat?.size ?? null,
        origin: entry.origin,
        ...(entry.originDetail ? { originDetail: entry.originDetail } : {}),
        ...(preview ? { preview } : {}),
      });
    }

    const dirRows = directories
      .slice(0, 60)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(entry => ({ name: path.basename(entry.path) || entry.path, path: entry.path, origin: entry.origin }));

    return {
      ok: true,
      toolName: 'workspace_overview',
      target: this.displayPath(this.root),
      summary: `工作区概览：${directories.length} 个目录、${files.length} 个文件；预览 ${fileRows.length} 个文本文件`,
      data: {
        root: this.displayPath(this.root),
        directoryCount: directories.length,
        fileCount: files.length,
        truncated: scan.truncated,
        directories: dirRows,
        files: fileRows,
      },
    };
  }

  private async fileSearch(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    const startDir = this.resolveWorkspacePath(args.path || '.', 'directory');
    const scope = this.normalizeScope(args.scope);
    const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
    const scan = await this.getScopedSearchEntries(startDir, scope);
    const requestedKinds = getRequestedToolFileKinds(query);
    const newestRequested = requestsNewestToolFile(query);
    const preferCreated = requestsCreatedToolFile(query);
    const preferModified = requestsModifiedToolFile(query);
    const candidates = scan.entries
      .map((entry) => ({
        path: entry.path,
        kind: entry.kind === 'directory' ? 'directory' as const : getGeneratedFileKind(entry.path),
        origin: entry.origin,
        originDetail: entry.originDetail,
        score: scorePathMatch(entry.path, query),
      }))
      .filter((item) => item.score > 0);
    // 始终附带创建时间与修改时间，让 Agent 能区分“刚生成”和“刚更新”。
    // 用户未精确指定文件时，相关性相同的候选也默认由最新文件优先。
    const scored = await Promise.all(candidates.map(async (item) => {
      const stat = await fs.stat(path.resolve(this.root, item.path)).catch(() => null);
      const birthtimeMs = stat && stat.birthtimeMs > 0 ? stat.birthtimeMs : (stat?.mtimeMs || 0);
      return {
        ...item,
        birthtimeMs,
        mtimeMs: stat?.mtimeMs || 0,
        createdAt: stat ? new Date(birthtimeMs).toISOString() : '',
        modifiedAt: stat ? stat.mtime.toISOString() : '',
      };
    }));
    scored.sort((a, b) => {
        const originDelta = this.originRank(a) - this.originRank(b);
        if (originDelta !== 0) return originDelta;
        const kindDelta = getToolFileKindSortIndex(a.kind, requestedKinds) - getToolFileKindSortIndex(b.kind, requestedKinds);
        if (kindDelta !== 0) return kindDelta;
        if (newestRequested) {
          const aRecency = preferCreated ? a.birthtimeMs : (preferModified ? a.mtimeMs : Math.max(a.birthtimeMs, a.mtimeMs));
          const bRecency = preferCreated ? b.birthtimeMs : (preferModified ? b.mtimeMs : Math.max(b.birthtimeMs, b.mtimeMs));
          if (bRecency !== aRecency) return bRecency - aRecency;
        }
        const scoreDelta = b.score - a.score;
        if (scoreDelta !== 0) return scoreDelta;
        const aRecency = preferCreated ? a.birthtimeMs : (preferModified ? a.mtimeMs : Math.max(a.birthtimeMs, a.mtimeMs));
        const bRecency = preferCreated ? b.birthtimeMs : (preferModified ? b.mtimeMs : Math.max(b.birthtimeMs, b.mtimeMs));
        if (bRecency !== aRecency) return bRecency - aRecency;
        return a.path.localeCompare(b.path);
      });
    const ranked = scored.slice(0, limit);
    // 给靠前的文本文件候选附加内容预览和大小，减少后续 read_file 轮次。
    const previewBudget = Math.min(12, ranked.length);
    const rankedWithPreview = await Promise.all(ranked.map(async (item, index) => {
      if (index >= previewBudget || item.kind === 'directory') return item;
      const absolutePath = path.resolve(this.root, item.path);
      if (!isLikelyTextPath(absolutePath)) return item;
      try {
        const stat = await fs.stat(absolutePath);
        if (stat.size > MAX_GREP_FILE_BYTES) return { ...item, size: stat.size };
        const content = await readTextFile(absolutePath);
        const preview = content.split(/\r?\n/).slice(0, 5).join('\n').trim().slice(0, 500);
        return { ...item, size: stat.size, ...(preview ? { preview } : {}) };
      } catch {
        return item;
      }
    }));
    const groupCounts = rankedWithPreview.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] || 0) + 1;
      return acc;
    }, {});
    const groupSummary = Object.entries(groupCounts).map(([kind, count]) => `${kind} ${count}`).join('，');

    return {
      ok: true,
      toolName: 'file_search',
      target: query,
      summary: `递归搜索 "${query}" 命中 ${rankedWithPreview.length} 个目录或文件候选${groupSummary ? `（按类型分组：${groupSummary}）` : ''}${scan.truncated ? '；目录树扫描达到安全上限' : ''}`,
      data: {
        query,
        scope,
        results: rankedWithPreview,
        entriesSearched: scan.entries.length,
        filesSearched: scan.entries.filter(entry => entry.kind === 'file').length,
        directoriesSearched: scan.entries.filter(entry => entry.kind === 'directory').length,
        scanTruncated: scan.truncated,
        truncated: scan.truncated || scored.length > ranked.length,
      },
    };
  }

  private async grepFiles(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const pattern = String(args.pattern || '').trim();
    if (!pattern) throw new Error('pattern 不能为空');
    const startDir = this.resolveWorkspacePath(args.path || '.', 'directory');
    const scope = this.normalizeScope(args.scope);
    const include = typeof args.include === 'string' ? args.include.trim().toLowerCase() : '';
    const caseInsensitive = args.case_insensitive !== false;
    const contextLines = Math.min(5, Math.max(0, Number(args.context_lines) || 1));
    const maxResults = Math.min(500, Math.max(1, Number(args.max_results) || 80));
    const regex = new RegExp(pattern, caseInsensitive ? 'i' : undefined);
    const searchable = await this.getScopedSearchFiles(startDir, scope);
    const files = searchable.files;
    const scanEntries = (await this.getScopedSearchEntries(startDir, scope)).entries;
    const originByPath = new Map<string, WorkspaceEntryOrigin>();
    const originDetailByPath = new Map<string, string>();
    for (const entry of scanEntries) {
      originByPath.set(entry.path, entry.origin);
      if (entry.originDetail) originDetailByPath.set(entry.path, entry.originDetail);
    }
    const results: Array<{
      path: string;
      origin: WorkspaceEntryOrigin;
      originDetail?: string;
      line_number: number;
      line: string;
      context_before: string[];
      context_after: string[];
    }> = [];
    let filesSearched = 0;

    for (const relativePath of files) {
      if (results.length >= maxResults) break;
      if (include && !relativePath.toLowerCase().includes(include)) continue;
      const absolutePath = path.resolve(this.root, relativePath);
      if (!isLikelyTextPath(absolutePath)) continue;
      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat || stat.size > MAX_GREP_FILE_BYTES) continue;
      let content = '';
      try {
        content = await readTextFile(absolutePath);
      } catch {
        continue;
      }
      filesSearched += 1;
      const lines = content.split(/\r?\n/);
      const origin = originByPath.get(relativePath) || 'source';
      const originDetail = originDetailByPath.get(relativePath);
      for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
        regex.lastIndex = 0;
        if (!regex.test(lines[index])) continue;
        results.push({
          path: relativePath,
          origin,
          ...(originDetail ? { originDetail } : {}),
          line_number: index + 1,
          line: lines[index],
          context_before: lines.slice(Math.max(0, index - contextLines), index),
          context_after: lines.slice(index + 1, index + 1 + contextLines),
        });
      }
    }

    return {
      ok: true,
      toolName: 'grep_files',
      target: pattern,
      summary: `全文搜索 "${pattern}" 命中 ${results.length} 条`,
      data: {
        pattern,
        scope,
        results,
        filesSearched,
        candidateFiles: files.length,
        scanTruncated: searchable.truncated,
        truncated: searchable.truncated || results.length >= maxResults,
      },
    };
  }

  private async readFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const batchPaths = Array.isArray(args.paths)
      ? args.paths.map(p => String(p || '').trim()).filter(Boolean)
      : [];
    if (batchPaths.length > 0) {
      return this.readFileBatch(batchPaths, args);
    }
    if (!args.path) throw new Error('请提供 path 或 paths（批量）之一');
    const filePath = this.resolveWorkspacePath(args.path, 'file');
    const resolved = await this.resolveReadableFilePath(filePath);
    const stat = await fs.stat(resolved.readPath);
    if (!stat.isFile()) {
      throw new Error(`不是文件: ${this.displayPath(filePath)}`);
    }
    const readable = await readWorkspaceFileContent(resolved.readPath);
    const content = readable.content;
    await this.noteRead(resolved.readPath);
    const slice = lineNumberedSlice(content, Number(args.start_line) || 1, Number(args.max_lines) || DEFAULT_READ_LINES);
    const capped = capReadFileContent(slice.content);
    const copiedSummary = resolved.readPath !== resolved.sourcePath
      ? `；已复制到安全工作区 ${this.displayPath(resolved.readPath)}`
      : '';
    return {
      ok: true,
      toolName: 'read_file',
      target: this.displayPath(filePath),
      summary: `读取 ${this.displayPath(filePath)} 第 ${Number(args.start_line) || 1}-${slice.endLine} 行${copiedSummary}${capped.charTruncated ? '（内容已按字符数截断）' : ''}`,
      data: {
        path: this.displayPath(resolved.sourcePath),
        safePath: resolved.readPath !== resolved.sourcePath ? this.displayPath(resolved.readPath) : undefined,
        startLine: Number(args.start_line) || 1,
        endLine: slice.endLine,
        totalLines: slice.totalLines,
        truncated: slice.truncated,
        nextStartLine: slice.nextStartLine,
        charTruncated: capped.charTruncated,
        content: capped.content,
        contentType: readable.contentType,
        extractionMethod: readable.extractionMethod,
        extractionWarnings: readable.extractionWarnings,
      },
    };
  }

  private async readFileBatch(paths: string[], args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const startLine = Number(args.start_line) || 1;
    const maxLines = Number(args.max_lines) || DEFAULT_READ_LINES;
    const files: Array<Record<string, unknown>> = [];
    const errors: Array<{ path: string; error: string }> = [];
    for (const rawPath of paths.slice(0, 20)) {
      try {
        const filePath = this.resolveWorkspacePath(rawPath, 'file');
        const resolved = await this.resolveReadableFilePath(filePath);
        const stat = await fs.stat(resolved.readPath);
        if (!stat.isFile()) throw new Error(`不是文件: ${this.displayPath(filePath)}`);
        const readable = await readWorkspaceFileContent(resolved.readPath);
        await this.noteRead(resolved.readPath);
        const slice = lineNumberedSlice(readable.content, startLine, maxLines);
        const capped = capReadFileContent(slice.content);
        files.push({
          path: this.displayPath(resolved.sourcePath),
          safePath: resolved.readPath !== resolved.sourcePath ? this.displayPath(resolved.readPath) : undefined,
          startLine,
          endLine: slice.endLine,
          totalLines: slice.totalLines,
          truncated: slice.truncated,
          nextStartLine: slice.nextStartLine,
          charTruncated: capped.charTruncated,
          content: capped.content,
          contentType: readable.contentType,
          extractionMethod: readable.extractionMethod,
          extractionWarnings: readable.extractionWarnings,
        });
      } catch (error) {
        errors.push({ path: rawPath, error: (error as Error).message });
      }
    }
    return {
      ok: files.length > 0,
      toolName: 'read_file',
      target: `${files.length} 个文件`,
      summary: `批量读取 ${files.length} 个文件（每个前 ${maxLines} 行）${errors.length ? `，${errors.length} 个失败` : ''}`,
      data: {
        files,
        count: files.length,
        ...(errors.length ? { errors } : {}),
      },
    };
  }

  private async copyFileToWorkspace(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    if (!this.safeWorkRoot) {
      throw new Error('当前权限未启用 AI 工作文件夹，不能复制文件到工作区');
    }
    const filePath = this.resolveWorkspacePath(args.path, 'file');
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error(`不是文件: ${this.displayPath(filePath)}`);
    }
    const safePath = await this.ensureSafeCopyForFile(filePath);
    await this.commitSafeWorkspaceChange(`AI copy data file ${this.displayPath(safePath)}`);
    return {
      ok: true,
      toolName: 'copy_file_to_workspace',
      target: this.displayPath(filePath),
      summary: `已复制 ${this.displayPath(filePath)} 到 AI 工作文件夹 ${this.displayPath(safePath)}；原始文件未改`,
      data: {
        path: this.displayPath(filePath),
        safePath: this.displayPath(safePath),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: safePath !== filePath,
        size: stat.size,
      },
    };
  }

  private getOfficeCliTimeout(args: Record<string, unknown>): number {
    return Math.min(
      OFFICECLI_MAX_TIMEOUT_MS,
      Math.max(5_000, Number(args.timeout_ms) || OFFICECLI_DEFAULT_TIMEOUT_MS)
    );
  }

  private parseOfficeCliJson(stdout: string): unknown {
    const trimmed = stdout.trim();
    if (!trimmed || !/^[\[{]/.test(trimmed)) return undefined;
    try {
      return JSON.parse(trimmed);
    } catch {
      return undefined;
    }
  }

  private async runOfficeCli(args: string[], cwd: string, timeoutMs: number): Promise<OfficeCliProcessResult> {
    const executable = await ensureOfficeCliAvailable();
    return runOfficeCliProcess(executable, args, cwd, timeoutMs);
  }

  private assertOfficeDocument(filePath: string): void {
    if (!isOfficeDocumentPath(filePath)) {
      throw new Error('OfficeCLI 目前只处理 .docx/.xlsx/.pptx 文件');
    }
  }

  private assertOfficeOutput(filePath: string): void {
    if (!isOfficeCliOutputPath(filePath)) {
      throw new Error('OfficeCLI 输出路径只允许 .html/.htm/.png/.jpg/.jpeg/.svg/.pdf/.json/.txt');
    }
  }

  private async resolveOfficeReadablePath(inputPath: unknown): Promise<{ sourcePath: string; readPath: string }> {
    const filePath = this.resolveWorkspacePath(inputPath, 'file');
    this.assertOfficeDocument(filePath);
    const resolved = await this.resolveReadableFilePath(filePath);
    const stat = await fs.stat(resolved.readPath);
    if (!stat.isFile()) {
      throw new Error(`不是文件: ${this.displayPath(filePath)}`);
    }
    return resolved;
  }

  private async resolveOfficeWritablePath(inputPath: unknown): Promise<{ sourcePath: string; writePath: string; safeRedirected: boolean }> {
    const filePath = this.resolveWorkspacePath(inputPath, 'file');
    this.assertOfficeDocument(filePath);
    return this.resolveWritableFilePath(filePath);
  }

  private async resolveOfficeOutputPath(inputPath: unknown): Promise<{ sourcePath: string; writePath: string; safeRedirected: boolean }> {
    const outputPath = this.resolveWorkspacePath(inputPath, 'file');
    this.assertOfficeOutput(outputPath);
    return this.resolveWritableFilePath(outputPath);
  }

  private async officeHelp(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const topic = String(args.topic || '').trim();
    const cliArgs = ['help', ...topic.split(/\s+/).filter(Boolean)];
    appendOfficeCliBooleanFlag(cliArgs, '--json', args.json === true);
    const output = await this.runOfficeCli(cliArgs, this.root, this.getOfficeCliTimeout(args));
    const stdout = truncateText(output.stdout, MAX_OFFICECLI_OUTPUT_CHARS);
    const stderr = truncateText(output.stderr, 10_000);
    return {
      ok: output.exitCode === 0,
      toolName: 'office_help',
      target: topic || 'help',
      summary: `OfficeCLI help ${topic || ''}`.trim() + ` 退出码 ${output.exitCode ?? 'unknown'}`,
      data: {
        topic,
        exitCode: output.exitCode,
        stdout,
        stderr,
        parsedJson: this.parseOfficeCliJson(output.stdout),
      },
      error: output.exitCode === 0 ? undefined : truncateText(output.stderr || output.stdout || 'officecli help failed', 2_000),
    };
  }

  private async officeView(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const resolved = await this.resolveOfficeReadablePath(args.path);
    const mode = normalizeOfficeCliMode(args.mode, 'outline');
    const cliArgs = ['view', resolved.readPath, mode];
    appendOfficeCliNumberFlag(cliArgs, '--page', args.page);
    appendOfficeCliNumberFlag(cliArgs, '--start', args.start);
    appendOfficeCliNumberFlag(cliArgs, '--end', args.end);
    appendOfficeCliNumberFlag(cliArgs, '--max-lines', args.max_lines);
    appendOfficeCliBooleanFlag(cliArgs, '--json', args.json === true);

    let outputPath: { sourcePath: string; writePath: string; safeRedirected: boolean } | null = null;
    if (typeof args.output_path === 'string' && args.output_path.trim()) {
      outputPath = await this.resolveOfficeOutputPath(args.output_path);
      cliArgs.push('-o', outputPath.writePath);
    }

    const beforeGeneratedFiles = outputPath || this.permission !== 'read-only'
      ? await this.snapshotGeneratedAttachmentFiles().catch(() => new Map<string, FileSnapshot>())
      : new Map<string, FileSnapshot>();
    const output = await this.runOfficeCli(cliArgs, path.dirname(resolved.readPath), this.getOfficeCliTimeout(args));
    const generatedFiles = this.permission === 'read-only'
      ? []
      : this.diffGeneratedAttachmentFiles(
          beforeGeneratedFiles,
          await this.snapshotGeneratedAttachmentFiles().catch(() => new Map<string, FileSnapshot>())
        );
    const mirroredOutputs = output.exitCode === 0 && outputPath
      ? await this.publishOutputsToConfiguredRoot([outputPath.writePath])
      : [];

    const copiedSummary = resolved.readPath !== resolved.sourcePath
      ? `；已使用安全副本 ${this.displayPath(resolved.readPath)}`
      : '';
    const outputSummary = outputPath
      ? `；输出 ${this.displayPath(outputPath.writePath)}`
      : '';
    const mirrorSummary = mirroredOutputs.some(result => result.mirrored)
      ? '；已更新“用户查看”快捷方式'
      : '';
    return {
      ok: output.exitCode === 0,
      toolName: 'office_view',
      target: `${this.displayPath(resolved.sourcePath)} ${mode}`,
      summary: `OfficeCLI view ${mode}：${this.displayPath(resolved.sourcePath)} 退出码 ${output.exitCode ?? 'unknown'}${copiedSummary}${outputSummary}${mirrorSummary}`,
      data: {
        path: this.displayPath(resolved.sourcePath),
        safePath: resolved.readPath !== resolved.sourcePath ? this.displayPath(resolved.readPath) : undefined,
        mode,
        outputPath: outputPath ? this.displayPath(outputPath.writePath) : undefined,
        generatedFiles,
        mirroredOutputs,
        exitCode: output.exitCode,
        stdout: truncateText(output.stdout, MAX_OFFICECLI_OUTPUT_CHARS),
        stderr: truncateText(output.stderr, 10_000),
        parsedJson: this.parseOfficeCliJson(output.stdout),
      },
      error: output.exitCode === 0 ? undefined : truncateText(output.stderr || output.stdout || 'officecli view failed', 2_000),
    };
  }

  private async officeGet(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const resolved = await this.resolveOfficeReadablePath(args.path);
    const selector = getOfficeCliSelector(args.selector, '/');
    const cliArgs = ['get', resolved.readPath, selector];
    appendOfficeCliNumberFlag(cliArgs, '--depth', args.depth || 2);
    if (args.json !== false) cliArgs.push('--json');
    const output = await this.runOfficeCli(cliArgs, path.dirname(resolved.readPath), this.getOfficeCliTimeout(args));
    return {
      ok: output.exitCode === 0,
      toolName: 'office_get',
      target: `${this.displayPath(resolved.sourcePath)} ${selector}`,
      summary: `OfficeCLI get：${this.displayPath(resolved.sourcePath)} ${selector} 退出码 ${output.exitCode ?? 'unknown'}`,
      data: {
        path: this.displayPath(resolved.sourcePath),
        safePath: resolved.readPath !== resolved.sourcePath ? this.displayPath(resolved.readPath) : undefined,
        selector,
        exitCode: output.exitCode,
        stdout: truncateText(output.stdout, MAX_OFFICECLI_OUTPUT_CHARS),
        stderr: truncateText(output.stderr, 10_000),
        parsedJson: this.parseOfficeCliJson(output.stdout),
      },
      error: output.exitCode === 0 ? undefined : truncateText(output.stderr || output.stdout || 'officecli get failed', 2_000),
    };
  }

  private async officeQuery(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    const resolved = await this.resolveOfficeReadablePath(args.path);
    const cliArgs = ['query', resolved.readPath, query];
    if (args.json !== false) cliArgs.push('--json');
    const output = await this.runOfficeCli(cliArgs, path.dirname(resolved.readPath), this.getOfficeCliTimeout(args));
    return {
      ok: output.exitCode === 0,
      toolName: 'office_query',
      target: `${this.displayPath(resolved.sourcePath)} ${query}`,
      summary: `OfficeCLI query：${this.displayPath(resolved.sourcePath)} "${query}" 退出码 ${output.exitCode ?? 'unknown'}`,
      data: {
        path: this.displayPath(resolved.sourcePath),
        safePath: resolved.readPath !== resolved.sourcePath ? this.displayPath(resolved.readPath) : undefined,
        query,
        exitCode: output.exitCode,
        stdout: truncateText(output.stdout, MAX_OFFICECLI_OUTPUT_CHARS),
        stderr: truncateText(output.stderr, 10_000),
        parsedJson: this.parseOfficeCliJson(output.stdout),
      },
      error: output.exitCode === 0 ? undefined : truncateText(output.stderr || output.stdout || 'officecli query failed', 2_000),
    };
  }

  private async officeApply(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const operation = normalizeOfficeCliOperation(args.operation);
    const writable = await this.resolveOfficeWritablePath(args.path);
    const cliArgs: string[] = [];
    let tempInputPath = '';
    let outputPath: { sourcePath: string; writePath: string; safeRedirected: boolean } | null = null;

    if (operation !== 'create') {
      const stat = await fs.stat(writable.writePath).catch(() => null);
      if (!stat?.isFile()) {
        throw new Error(`Office 文件不存在: ${this.displayPath(writable.writePath)}`);
      }
    }

    switch (operation) {
      case 'create':
        cliArgs.push('create', writable.writePath);
        break;
      case 'set':
        cliArgs.push('set', writable.writePath, getOfficeCliSelector(args.selector));
        appendOfficeCliProps(cliArgs, args.props);
        break;
      case 'add': {
        const elementType = String(args.element_type || '').trim();
        if (!elementType) throw new Error('add 操作必须提供 element_type');
        cliArgs.push('add', writable.writePath, getOfficeCliSelector(args.selector), '--type', elementType);
        appendOfficeCliProps(cliArgs, args.props);
        break;
      }
      case 'remove':
        cliArgs.push('remove', writable.writePath, getOfficeCliSelector(args.selector));
        break;
      case 'move':
        cliArgs.push('move', writable.writePath, getOfficeCliSelector(args.selector));
        appendOfficeCliStringFlag(cliArgs, '--to', args.to);
        appendOfficeCliNumberFlag(cliArgs, '--index', args.index);
        break;
      case 'swap':
        cliArgs.push('swap', writable.writePath, getOfficeCliSelector(args.selector));
        appendOfficeCliStringFlag(cliArgs, '--with', args.with_selector);
        break;
      case 'batch':
        if (!Array.isArray(args.commands) || !args.commands.length) {
          throw new Error('batch 操作必须提供 commands 数组');
        }
        tempInputPath = await writeJsonTempFile(path.dirname(writable.writePath), 'officecli-batch', args.commands);
        cliArgs.push('batch', writable.writePath, '--input', tempInputPath, '--stop-on-error');
        break;
      case 'save':
        cliArgs.push('save', writable.writePath);
        break;
      case 'close':
        cliArgs.push('close', writable.writePath);
        break;
      case 'validate':
        cliArgs.push('validate', writable.writePath);
        break;
      case 'dump':
        cliArgs.push('dump', writable.writePath);
        if (typeof args.selector === 'string' && args.selector.trim()) {
          cliArgs.push(args.selector.trim());
        }
        if (typeof args.output_path === 'string' && args.output_path.trim()) {
          outputPath = await this.resolveOfficeOutputPath(args.output_path);
          cliArgs.push('-o', outputPath.writePath);
        }
        break;
      default:
        throw new Error(`未实现 OfficeCLI 操作: ${operation}`);
    }

    if (args.json !== false) cliArgs.push('--json');
    const beforeGeneratedFiles = await this.snapshotGeneratedAttachmentFiles().catch(() => new Map<string, FileSnapshot>());
    const output = await this.runOfficeCli(cliArgs, path.dirname(writable.writePath), this.getOfficeCliTimeout(args));
    const generatedFiles = this.diffGeneratedAttachmentFiles(
      beforeGeneratedFiles,
      await this.snapshotGeneratedAttachmentFiles().catch(() => new Map<string, FileSnapshot>())
    );
    const publishCandidates = [
      writable.writePath,
      ...(outputPath ? [outputPath.writePath] : []),
    ];
    const mirroredOutputs = output.exitCode === 0
      ? await this.publishOutputsToConfiguredRoot(publishCandidates)
      : [];
    if (output.exitCode === 0) {
      await this.commitSafeWorkspaceChange(`AI office ${operation} ${this.displayPath(writable.writePath)}`);
    }
    const safeNote = mirroredOutputs.some(result => result.mirrored)
      ? '；已更新“用户查看”快捷方式'
      : (writable.safeRedirected ? '；结果保留在当前会话 AI 工作目录' : '');
    const generatedSummary = generatedFiles.length
      ? `；生成/更新文件：${generatedFiles.map(file => file.path).slice(0, 6).join('、')}${generatedFiles.length > 6 ? ' 等' : ''}`
      : '';
    return {
      ok: output.exitCode === 0,
      toolName: 'office_apply',
      target: `${operation} ${this.displayPath(writable.writePath)}`,
      summary: `OfficeCLI ${operation}：${this.displayPath(writable.writePath)} 退出码 ${output.exitCode ?? 'unknown'}${safeNote}${generatedSummary}`,
      data: {
        operation,
        path: this.displayPath(writable.writePath),
        originalPath: this.displayPath(writable.sourcePath),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: writable.safeRedirected,
        outputPath: outputPath ? this.displayPath(outputPath.writePath) : undefined,
        tempInputPath: tempInputPath ? this.displayPath(tempInputPath) : undefined,
        generatedFiles,
        mirroredOutputs,
        exitCode: output.exitCode,
        stdout: truncateText(output.stdout, MAX_OFFICECLI_OUTPUT_CHARS),
        stderr: truncateText(output.stderr, 10_000),
        parsedJson: this.parseOfficeCliJson(output.stdout),
      },
      error: output.exitCode === 0 ? undefined : truncateText(output.stderr || output.stdout || 'officecli operation failed', 2_000),
    };
  }

  /**
   * import_workspace_assets: review the user workspace source root and copy
   * its figure/table assets and Word drafts into the canonical AI work
   * structure. Source files are never modified (copy-only, idempotent).
   */
  private async importWorkspaceAssets(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    if (!this.safeWorkRoot) {
      throw new Error('当前工作目录是只读模式，无法导入产物');
    }
    const dryRun = args.dry_run === true;
    const buildDocx = args.build_docx !== false;

    const importResult = await importSourceWorkspaceAssets(this.root, this.safeWorkRoot, {
      mode: dryRun ? 'dry-run' : 'copy',
    });

    let docx: Awaited<ReturnType<typeof buildIntegratedDocx>> | null = null;
    if (buildDocx) {
      docx = await buildIntegratedDocx(this.safeWorkRoot, {});
    }
    const importedArtifactPaths = dryRun
      ? []
      : importResult.imported.map(item => path.resolve(this.safeWorkRoot as string, item.to));
    const mirroredOutputs = await this.publishOutputsToConfiguredRoot([
      ...importedArtifactPaths,
      ...(docx ? [docx.docxPath] : []),
    ]);

    const importedCount = importResult.imported.length;
    const skippedCount = importResult.skipped.length;
    const unclassifiedCount = importResult.unclassified.length;
    const entries = importResult.layout.entries;

    return {
      ok: true,
      toolName: 'import_workspace_assets',
      target: this.displaySafeWorkspacePath(),
      summary: `${dryRun ? '预览' : '导入'}: 复制归类 ${importedCount} 个文件${skippedCount ? `，跳过已存在 ${skippedCount} 个` : ''}${unclassifiedCount ? `，无法识别编号 ${unclassifiedCount} 个` : ''}；当前图表条目 ${entries.length} 个${docx ? '，整合 Word 已刷新' : ''}`,
      data: {
        dryRun,
        imported: importResult.imported,
        skipped: importResult.skipped,
        unclassified: importResult.unclassified,
        entries: entries.map(entry => ({
          key: entry.key,
          kind: entry.kind,
          assets: entry.assets.map(asset => ({
            role: asset.role,
            path: asset.relativePath,
            canonical: asset.canonical,
          })),
        })),
        docx: docx
          ? {
              path: this.displayPath(docx.docxPath),
              included: docx.included.length,
              skipped: docx.skipped,
            }
          : null,
        mirroredOutputs,
      },
    };
  }

  /**
   * build_figures_tables_docx: regenerate the integrated Word document from
   * the project-cumulative canonical figures_tables/ structure.
   */
  private async buildFiguresTablesDocx(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    if (!this.safeWorkRoot) {
      throw new Error('当前工作目录是只读模式，无法生成整合 Word');
    }
    const captionsInput = (args.captions && typeof args.captions === 'object' && !Array.isArray(args.captions))
      ? args.captions as Record<string, { caption?: string; note?: string }>
      : {};
    const docx = await buildIntegratedDocx(this.safeWorkRoot, captionsInput);
    const mirroredOutputs = await this.publishOutputsToConfiguredRoot([docx.docxPath]);
    return {
      ok: true,
      toolName: 'build_figures_tables_docx',
      target: this.displayPath(docx.docxPath),
      summary: `生成/刷新整合 Word：${this.displayPath(docx.docxPath)}，包含 ${docx.included.length} 个图表${docx.skipped.length ? `；跳过 ${docx.skipped.length} 个（${docx.skipped.map(item => item.key).slice(0, 5).join('、')}）` : ''}`,
      data: {
        path: this.displayPath(docx.docxPath),
        included: docx.included,
        skipped: docx.skipped,
        mirroredOutputs,
      },
    };
  }

  /** Refresh the stable supplementary-materials.docx from supplementary/. */
  private async buildSupplementaryDocx(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    if (!this.safeWorkRoot) {
      throw new Error('当前工作目录是只读模式，无法生成补充材料 Word');
    }
    const captionsInput = (args.captions && typeof args.captions === 'object' && !Array.isArray(args.captions))
      ? args.captions as Record<string, { caption?: string; note?: string }>
      : {};
    const docx = await buildIntegratedDocx(this.safeWorkRoot, captionsInput, { collection: 'supplementary' });
    const mirroredOutputs = await this.publishOutputsToConfiguredRoot([docx.docxPath]);
    return {
      ok: true,
      toolName: 'build_supplementary_docx',
      target: this.displayPath(docx.docxPath),
      summary: `生成/刷新补充材料 Word：${this.displayPath(docx.docxPath)}，包含 ${docx.included.length} 个图表${docx.skipped.length ? `；跳过 ${docx.skipped.length} 个（${docx.skipped.map(item => item.key).slice(0, 5).join('、')}）` : ''}`,
      data: {
        path: this.displayPath(docx.docxPath),
        included: docx.included,
        skipped: docx.skipped,
        mirroredOutputs,
      },
    };
  }

  private async writeSingleFile(rawPath: string, content: string, _publishRequested = false): Promise<{ target: string; summary: string; data: Record<string, unknown> }> {
    const filePath = this.resolveWorkspacePath(rawPath, 'file');
    const writable = await this.resolveWritableFilePath(filePath);
    await fs.mkdir(path.dirname(writable.writePath), { recursive: true });
    const existed = await fs.stat(writable.writePath).then((stat) => stat.isFile()).catch(() => false);
    const beforeContent = existed ? await readTextFile(writable.writePath) : '';
    const backup = await this.createEditBackup(writable.writePath, this.displayPath(writable.writePath), existed, beforeContent, 'write_file');
    const tempPath = `${writable.writePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, writable.writePath);
    await this.noteRead(writable.writePath);
    await this.commitSafeWorkspaceChange(`AI write ${this.displayPath(writable.writePath)}`);
    const mirroredOutputs = await this.publishOutputsToConfiguredRoot([writable.writePath]);
    const diff = buildUnifiedDiff(this.displayPath(writable.writePath), beforeContent, content);
    const safeNote = mirroredOutputs.some(result => result.mirrored)
      ? '；已更新“用户查看”快捷方式'
      : (writable.safeRedirected ? '；新文件保留在当前会话 AI 工作目录' : '');
    return {
      target: this.displayPath(writable.writePath),
      summary: `${existed ? '替换' : '新建'} ${this.displayPath(writable.writePath)}，${content.length} 字符；已备份 ${backup.backupId}${safeNote}`,
      data: {
        path: this.displayPath(writable.writePath),
        originalPath: this.displayPath(writable.sourcePath),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: writable.safeRedirected,
        mirroredOutputs,
        action: existed ? 'replaced' : 'created',
        bytes: Buffer.byteLength(content, 'utf-8'),
        lines: content.split(/\r?\n/).length,
        diff,
        backupId: backup.backupId,
        rollbackAvailable: true,
      },
    };
  }

  private async writeFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    // 批量：一次写多个文件，减少来回轮次。
    if (Array.isArray(args.files) && args.files.length > 0) {
      const entries = args.files.slice(0, 20).map(item => ({
        path: String((item as Record<string, unknown>)?.path ?? '').trim(),
        content: String((item as Record<string, unknown>)?.content ?? ''),
      })).filter(entry => entry.path);
      if (!entries.length) throw new Error('files 数组为空或缺少 path');
      const written: Array<Record<string, unknown>> = [];
      const errors: Array<{ path: string; error: string }> = [];
      for (const entry of entries) {
        try {
          const single = await this.writeSingleFile(entry.path, entry.content, args.publish === true);
          written.push({ path: entry.path, ...single.data });
        } catch (error) {
          errors.push({ path: entry.path, error: (error as Error).message });
        }
      }
      return {
        ok: written.length > 0,
        toolName: 'write_file',
        target: `${written.length} 个文件`,
        summary: `批量写入 ${written.length} 个文件${errors.length ? `，${errors.length} 个失败` : ''}`,
        data: {
          files: written,
          count: written.length,
          ...(errors.length ? { errors } : {}),
        },
      };
    }
    if (!args.path) throw new Error('请提供 path/content 或 files 数组');
    const single = await this.writeSingleFile(String(args.path), String(args.content ?? ''), args.publish === true);
    return {
      ok: true,
      toolName: 'write_file',
      target: single.target,
      summary: single.summary,
      data: single.data,
    };
  }

  private async editFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const filePath = this.resolveWorkspacePath(args.path, 'file');
    const writable = await this.resolveWritableFilePath(filePath);
    await this.assertFreshRead(writable.writePath);
    const before = await readTextFile(writable.writePath);

    // 支持一次调用做多处替换（edits 数组），按顺序应用到同一文件；
    // 兼容旧的单处 search/replace 形式。
    let edits: Array<{ search: string; replace: string }> = [];
    if (Array.isArray(args.edits) && args.edits.length > 0) {
      edits = args.edits.slice(0, 20).map(edit => ({
        search: String((edit as Record<string, unknown>)?.search ?? ''),
        replace: String((edit as Record<string, unknown>)?.replace ?? ''),
      }));
    } else {
      edits = [{ search: String(args.search ?? ''), replace: String(args.replace ?? '') }];
    }
    if (!edits.length || edits.some(edit => !edit.search)) {
      throw new Error('请提供 edits 数组或 search/replace，且 search 不能为空');
    }

    let content = before;
    for (const edit of edits) {
      const first = content.indexOf(edit.search);
      if (first === -1) throw new Error(`search 片段未在文件中找到: ${edit.search.slice(0, 80)}`);
      const second = content.indexOf(edit.search, first + edit.search.length);
      if (second !== -1) throw new Error(`search 片段出现多次，不能安全替换: ${edit.search.slice(0, 80)}；请提供更长的唯一片段`);
      content = `${content.slice(0, first)}${edit.replace}${content.slice(first + edit.search.length)}`;
    }

    const backup = await this.createEditBackup(writable.writePath, this.displayPath(writable.writePath), true, before, 'edit_file');
    const tempPath = `${writable.writePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, content, 'utf-8');
    await fs.rename(tempPath, writable.writePath);
    await this.noteRead(writable.writePath);
    await this.commitSafeWorkspaceChange(`AI edit ${this.displayPath(writable.writePath)}`);
    const mirroredOutputs = await this.publishOutputsToConfiguredRoot([writable.writePath]);
    const diff = buildUnifiedDiff(this.displayPath(writable.writePath), before, content);
    const replacedChars = edits.reduce((sum, edit) => sum + edit.search.length, 0);
    const insertedChars = edits.reduce((sum, edit) => sum + edit.replace.length, 0);
    const safeNote = mirroredOutputs.some(result => result.mirrored)
      ? '；已更新“用户查看”快捷方式'
      : (writable.safeRedirected ? '；修改保留在当前会话 AI 工作目录' : '');
    return {
      ok: true,
      toolName: 'edit_file',
      target: this.displayPath(writable.writePath),
      summary: `编辑 ${this.displayPath(writable.writePath)}：${edits.length} 处替换（-${replacedChars} +${insertedChars} 字符）；已备份 ${backup.backupId}${safeNote}`,
      data: {
        path: this.displayPath(writable.writePath),
        originalPath: this.displayPath(writable.sourcePath),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: writable.safeRedirected,
        mirroredOutputs,
        editCount: edits.length,
        replacedChars,
        insertedChars,
        diff,
        backupId: backup.backupId,
        rollbackAvailable: true,
      },
    };
  }

  private async moveFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const sourcePath = this.resolveWorkspacePath(args.source, 'file');
    let destinationPath = this.resolveWorkspacePath(args.destination, 'file');
    this.assertAuthorizedMutationPath(sourcePath);
    this.assertAuthorizedMutationPath(destinationPath);

    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isFile()) {
      throw new Error(`源路径不是文件或不存在: ${this.displayPath(sourcePath)}`);
    }

    const requestedDestinationStat = await fs.stat(destinationPath).catch(() => null);
    if (requestedDestinationStat?.isDirectory()) {
      destinationPath = path.join(destinationPath, path.basename(sourcePath));
      this.assertAuthorizedMutationPath(destinationPath);
    }

    if (path.resolve(sourcePath) === path.resolve(destinationPath)) {
      throw new Error('源文件和目标文件是同一路径');
    }
    const destinationStat = await fs.stat(destinationPath).catch(() => null);
    if (destinationStat) {
      throw new Error(`目标路径已存在，不会覆盖: ${this.displayPath(destinationPath)}`);
    }

    const safeSourcePath = this.isInSafeWorkspace(sourcePath)
      ? sourcePath
      : await this.ensureWorkingCopyForFile(sourcePath);
    const safeDestinationPath = this.safeWorkRoot && !this.isInSafeWorkspace(destinationPath)
      ? this.generatedPathForOriginal(destinationPath)
      : destinationPath;
    const safeDestinationStat = await fs.stat(safeDestinationPath).catch(() => null);
    if (safeDestinationStat) {
      throw new Error(`AI 工作目录中的目标路径已存在，不会覆盖: ${this.displayPath(safeDestinationPath)}`);
    }

    await fs.mkdir(path.dirname(safeDestinationPath), { recursive: true });
    try {
      await fs.rename(safeSourcePath, safeDestinationPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EXDEV') {
        throw error;
      }
      await fs.copyFile(safeSourcePath, safeDestinationPath);
      await fs.unlink(safeSourcePath);
    }

    const mirroredOutputs = await this.publishOutputsToConfiguredRoot([safeDestinationPath]);

    this.readSnapshots.delete(sourcePath);
    await this.noteRead(safeDestinationPath);
    await this.commitSafeWorkspaceChange(
      `AI move ${this.displayPath(sourcePath)} to ${this.displayPath(destinationPath)}`
    );
    return {
      ok: true,
      toolName: 'move_file',
      target: `${this.displayPath(sourcePath)} -> ${this.displayPath(destinationPath)}`,
      summary: `已在 AI 工作台移动 ${this.displayPath(safeSourcePath)} 到 ${this.displayPath(safeDestinationPath)}；用户源文件未改动，并更新“用户查看”快捷方式`,
      data: {
        source: this.displayPath(sourcePath),
        destination: this.displayPath(destinationPath),
        safeWorkspaceSource: this.displayPath(safeSourcePath),
        safeWorkspaceDestination: this.displayPath(safeDestinationPath),
        mirroredOutputs,
      },
    };
  }

  private async removeEmptyDirectory(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const directoryPath = this.resolveWorkspacePath(args.path, 'directory');
    this.assertAuthorizedMutationPath(directoryPath);
    if (this.safeWorkRoot && !this.isInSafeWorkspace(directoryPath)) {
      throw new Error('用户源目录只读；只能清理当前会话 AI 工作台内的空目录');
    }
    if (path.resolve(directoryPath) === path.resolve(this.root)) {
      throw new Error('不能删除工作目录根');
    }
    if (this.safeWorkRoot && path.resolve(directoryPath) === path.resolve(this.safeWorkRoot)) {
      throw new Error('不能删除当前会话 AI 工作目录根');
    }

    const directoryStat = await fs.stat(directoryPath).catch(() => null);
    if (!directoryStat?.isDirectory()) {
      throw new Error(`路径不是目录或不存在: ${this.displayPath(directoryPath)}`);
    }
    const originalEntries = await fs.readdir(directoryPath);
    if (originalEntries.length > 0) {
      throw new Error(`目录不是空目录，拒绝删除: ${this.displayPath(directoryPath)}`);
    }

    const safeDirectoryPath = this.safeWorkRoot && !this.isInSafeWorkspace(directoryPath)
      ? this.safePathForOriginal(directoryPath)
      : directoryPath;
    if (safeDirectoryPath !== directoryPath) {
      const safeDirectoryStat = await fs.stat(safeDirectoryPath).catch(() => null);
      if (safeDirectoryStat) {
        if (!safeDirectoryStat.isDirectory()) {
          throw new Error(`AI 工作目录中的对应路径不是目录: ${this.displayPath(safeDirectoryPath)}`);
        }
        const safeEntries = await fs.readdir(safeDirectoryPath);
        if (safeEntries.length > 0) {
          throw new Error(`AI 工作目录中的对应目录不是空目录，拒绝删除: ${this.displayPath(safeDirectoryPath)}`);
        }
        await fs.rmdir(safeDirectoryPath);
      }
    }
    await fs.rmdir(directoryPath);
    await this.commitSafeWorkspaceChange(`AI remove empty directory ${this.displayPath(directoryPath)}`);
    return {
      ok: true,
      toolName: 'remove_empty_directory',
      target: this.displayPath(directoryPath),
      summary: `已删除空目录 ${this.displayPath(directoryPath)}；未执行递归删除`,
      data: {
        path: this.displayPath(directoryPath),
        safeWorkspacePath: this.displayPath(safeDirectoryPath),
        recursive: false,
      },
    };
  }

  private async execShell(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const command = String(args.command || '').trim();
    if (!command) throw new Error('command 不能为空');
    const compatibilityError = getShellCompatibilityError(command);
    if (compatibilityError) {
      return {
        ok: false,
        toolName: 'exec_shell',
        target: summarizeShellCommand(command),
        summary: '命令语法不适用于当前 shell',
        data: {
          command,
          shell: 'Windows PowerShell',
          hint: compatibilityError,
        },
        error: compatibilityError,
      };
    }
    if (isDangerousShellCommand(command)) {
      throw new Error('命令包含高风险操作，已拦截');
    }
    if (this.permission === 'read-only' && !isReadOnlyShellCommand(command)) {
      throw new Error('read-only 权限下 exec_shell 只允许只读查询命令');
    }
    const requestedCwd = this.resolveWorkspacePath(args.cwd || '.', 'directory');
    if (this.permission !== 'danger-full-access' && !isSubPath(this.root, requestedCwd)) {
      throw new Error('cwd 超出工作目录授权范围');
    }
    const shellCwd = await this.resolveShellCwd(requestedCwd);
    const cwd = shellCwd.cwd;
    const stat = await fs.stat(cwd);
    if (!stat.isDirectory()) {
      throw new Error(`cwd 不是目录: ${this.displayPath(cwd)}`);
    }
    const timeoutMs = Math.min(120_000, Math.max(1_000, Number(args.timeout_ms) || 30_000));
    const shellEnv: NodeJS.ProcessEnv = {
      ...buildToolRuntimeEnv(process.env),
      SCHOLAR_HARNESS_ORIGINAL_WORKSPACE: this.root,
      SCHOLAR_HARNESS_SAFE_WORKSPACE: this.safeWorkRoot || '',
    };
    const beforeGeneratedFiles = this.permission === 'read-only'
      ? new Map<string, FileSnapshot>()
      : await this.snapshotGeneratedAttachmentFiles().catch(() => new Map<string, FileSnapshot>());
    const output = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
      const executable = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
      const shellArgs = process.platform === 'win32'
        ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command]
        : ['-lc', command];
      const child = spawn(executable, shellArgs, {
        cwd,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: shellEnv,
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`命令超时 (${timeoutMs}ms)`));
      }, timeoutMs);
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
    const generatedFiles = this.permission === 'read-only'
      ? []
      : this.diffGeneratedAttachmentFiles(
          beforeGeneratedFiles,
          await this.snapshotGeneratedAttachmentFiles().catch(() => new Map<string, FileSnapshot>())
        );
    // Every user-facing generated/updated file gets a refreshed shortcut.
    // The publication filter still excludes logs, caches and QA intermediates.
    const generatedAbsolutePaths = generatedFiles.map(file => path.resolve(this.root, file.path));
    const mirroredOutputs: WorkspaceOutputMirrorResult[] = output.code === 0
      ? await this.publishOutputsToConfiguredRoot(generatedAbsolutePaths)
      : [];
    await this.commitSafeWorkspaceChange(`AI shell ${summarizeShellCommand(command)}`);
    const generatedSummary = generatedFiles.length
      ? `；生成/更新文件：${generatedFiles.map(file => file.path).slice(0, 8).join('、')}${generatedFiles.length > 8 ? ' 等' : ''}`
      : '';
    const safeCwdSummary = shellCwd.safeRedirected ? `；命令已在安全工作区 ${this.displayPath(cwd)} 执行` : '';
    return {
      ok: output.code === 0,
      toolName: 'exec_shell',
      target: summarizeShellCommand(command),
      summary: `执行命令 "${summarizeShellCommand(command)}" 退出码 ${output.code ?? 'unknown'}${safeCwdSummary}${generatedSummary}`,
      data: {
        command,
        cwd: this.displayPath(cwd),
        requestedCwd: this.displayPath(shellCwd.originalCwd),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: shellCwd.safeRedirected && !mirroredOutputs.some(result => result.mirrored),
        // 命令真实执行完成（退出码非零也算）：调用级成功，结果级失败。
        // 供工具循环区分“脚本报错（任务中间状态）”与“工具调用本身失败”。
        executed: true,
        exitCode: output.code,
        generatedFiles,
        mirroredOutputs,
        rscriptPath: shellEnv.SCHOLAR_HARNESS_RSCRIPT || shellEnv.RSCRIPT_PATH || undefined,
        pythonPath: shellEnv.SCHOLAR_HARNESS_PYTHON || shellEnv.PYTHON_PATH || undefined,
        officeCliPath: shellEnv.SCHOLAR_HARNESS_OFFICECLI || shellEnv.OFFICECLI_PATH || undefined,
        stdout: truncateText(output.stdout, 25_000),
        stderr: truncateText(output.stderr, 10_000),
      },
      error: output.code === 0 ? undefined : truncateText(output.stderr || output.stdout || 'command failed', 2_000),
    };
  }
}

export function createWorkspaceToolRuntime(workspace: WorkspaceDirectoryContext): WorkspaceToolRuntime {
  return new WorkspaceToolRuntime(workspace);
}

export function formatWorkspaceToolResult(result: WorkspaceNativeToolResult): string {
  return truncateText(JSON.stringify(result, null, 2));
}

export async function restoreWorkspaceEditBackup(backupId: string): Promise<{
  backupId: string;
  restoredPath: string;
  action: 'restored' | 'deleted-created-file';
}> {
  const safeBackupId = sanitizeBackupId(backupId);
  const metaPath = await findBackupMetaPath(safeBackupId);
  const meta = JSON.parse(await fs.readFile(metaPath, 'utf-8')) as WorkspaceEditBackupMeta;
  if (meta.backupId !== safeBackupId || meta.version !== 1) {
    throw new Error('工作目录备份元数据无效');
  }
  const targetPath = path.resolve(meta.originalPath);
  const root = path.resolve(meta.root);
  if (!isSubPath(root, targetPath)) {
    throw new Error('备份目标路径不在原工作目录内，已拒绝回滚');
  }

  const restoreMirror = async (): Promise<void> => {
    if (!meta.mirrorPath) return;
    const mirrorPath = path.resolve(meta.mirrorPath);
    if (!isSubPath(root, mirrorPath)) {
      throw new Error('镜像备份目标路径不在原工作目录内，已拒绝回滚');
    }
    if (!meta.mirrorExisted) {
      await fs.rm(mirrorPath, { force: true });
      return;
    }
    if (!meta.mirrorBackupPath) {
      throw new Error('镜像备份文件缺失，无法完整回滚双目录输出');
    }
    await fs.mkdir(path.dirname(mirrorPath), { recursive: true });
    await fs.copyFile(meta.mirrorBackupPath, mirrorPath);
  };

  const refreshWorkbenchAfterRestore = async (): Promise<void> => {
    if (!meta.aiWorkRoot) return;
    const aiWorkRoot = path.resolve(meta.aiWorkRoot);
    if (!isSubPath(root, aiWorkRoot) || !isSubPath(aiWorkRoot, targetPath)) return;
    await publishWorkspaceOutputFiles([targetPath], root, aiWorkRoot);
  };

  if (!meta.existed) {
    await fs.rm(targetPath, { force: true });
    await restoreMirror();
    await refreshWorkbenchAfterRestore();
    return {
      backupId: safeBackupId,
      restoredPath: meta.displayPath || targetPath,
      action: 'deleted-created-file',
    };
  }

  if (!meta.backupPath) {
    throw new Error('备份文件缺失，无法回滚');
  }
  const backupContent = await fs.readFile(meta.backupPath, 'utf-8');
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.restore.tmp`;
  await fs.writeFile(tempPath, backupContent, 'utf-8');
  await fs.rename(tempPath, targetPath);
  await restoreMirror();
  await refreshWorkbenchAfterRestore();
  return {
    backupId: safeBackupId,
    restoredPath: meta.displayPath || targetPath,
    action: 'restored',
  };
}
