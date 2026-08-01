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
  mirrorWorkspaceOutputFiles,
  type WorkspaceOutputMirrorResult,
} from './workspace-output-mirror';

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

interface WorkspaceTreeEntry {
  path: string;
  kind: 'directory' | 'file';
}

interface WorkspaceTreeScan {
  entries: WorkspaceTreeEntry[];
  truncated: boolean;
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
  mirrorPath?: string;
  mirrorExisted?: boolean;
  mirrorBackupPath?: string;
}

export interface WorkspaceSafeWorkInfo {
  enabled: boolean;
  root?: string;
  relativeRoot?: string;
}

function truncateText(text: string, maxChars = MAX_TOOL_CONTENT_CHARS): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[truncated: ${text.length - maxChars} chars omitted]`;
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

function isDangerousShellCommand(command: string): boolean {
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
    /\bformat\b/i,
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
  maxEntries = MAX_SEARCH_FILES
): Promise<WorkspaceTreeScan> {
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
        entriesFound.push({ path: relativePath, kind: 'directory' });
        pendingDirectories.push(absolutePath);
        if (entriesFound.length >= maxEntries) {
          truncated = entryIndex < entries.length - 1 || directoryCursor < pendingDirectories.length;
          break;
        }
        continue;
      }
      if (entry.isFile()) {
        entriesFound.push({ path: relativePath, kind: 'file' });
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
  return /(?:最新|最近|最后修改|最新版|newest|latest|most\s+recent|last\s+modified)/i.test(String(query || ''));
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
  private safeWorkInitialized = false;
  private safeCopiedOriginals = new Set<string>();

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

  async prepareSafeWorkspace(): Promise<WorkspaceSafeWorkInfo> {
    if (this.safeWorkRoot) {
      await this.ensureSafeWorkspace();
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
          description: '列出工作目录内某个目录及其后代目录。默认递归返回全部层级的文件夹和文件路径，但不会读取文件全文；需要只看直接子项时传 recursive=false。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的目录路径；空字符串表示根目录。' },
              max_entries: { type: 'number', description: '最多返回多少项，默认 200，最大 500。' },
              recursive: { type: 'boolean', description: '是否递归列出全部后代目录和文件，默认 true。' },
            },
            required: [],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'file_search',
          description: '递归搜索授权根目录的整棵目录树，按文件夹名、文件名、路径片段或对象名查找候选目录和文件；同时覆盖用户配置目录、整个 ScholarHarness_AI_Workspaces 容器以及当前会话和其他会话的 AI 产物子目录。适合找深层 R 脚本、图名、数据文件名、目录和最新草稿。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '要查找的文件名、图名、函数名或路径关键词。' },
              path: { type: 'string', description: '可选：限制在某个子目录及其全部后代目录内搜索。' },
              limit: { type: 'number', description: '最多返回候选数量，默认 50。' },
            },
            required: ['query'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'grep_files',
          description: '递归搜索用户配置目录和整个 ScholarHarness_AI_Workspaces 容器全部后代目录中的文本文件内容，当前会话 AI 工作目录优先。适合查找变量名、图名、函数调用和 R 代码片段。',
          parameters: {
            type: 'object',
            properties: {
              pattern: { type: 'string', description: '关键词或 JavaScript 正则表达式。' },
              path: { type: 'string', description: '可选：限制在某个子目录及其全部后代目录内搜索。' },
              include: { type: 'string', description: '可选：文件扩展名或 glob-like 片段，例如 .R、.Rmd、genes。' },
              case_insensitive: { type: 'boolean', description: '是否忽略大小写，默认 true。' },
              context_lines: { type: 'number', description: '每个命中前后返回多少行上下文，默认 1，最大 5。' },
              max_results: { type: 'number', description: '最多返回命中条数，默认 80。' },
            },
            required: ['pattern'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_file',
          description: '读取文本文件或 .docx 正文纯文本的指定行窗口。.docx 会由后端自动解析，不要把它当作二进制文件放弃，也不要改读同名旧 TXT。写权限下会先把目标文件复制到安全工作区；普通文本读取后，edit_file 才能修改同一文件，防止盲改。',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string', description: '相对工作目录的文件路径。' },
              start_line: { type: 'number', description: '起始行号，默认 1。' },
              max_lines: { type: 'number', description: '最多读取行数，默认 220，最大 500。' },
            },
            required: ['path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'copy_file_to_workspace',
          description: '把工作目录内的任意文件复制到 AI 工作文件夹。适合 Excel、图片、PDF、二进制数据、R/Python 运行依赖等不能直接 read_file 的文件。写权限下原始文件不改动；read-only 权限不可用。',
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
            description: '新建或完整替换一个文本文件。写权限下先写入当前会话 AI 工作目录，再按相对路径同步到用户配置目录。仅在用户明确要求创建/保存/重写文件时使用。',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '目标文件路径。workspace-write 权限下必须位于工作目录内。' },
                content: { type: 'string', description: '完整文件内容。' },
              },
              required: ['path', 'content'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'edit_file',
            description: '在已经读取过且未变化的文本文件中做唯一字符串替换。写权限下在当前会话 AI 工作目录编辑，并同步更新用户配置目录中的对应文件。search 必须唯一命中。',
            parameters: {
              type: 'object',
              properties: {
                path: { type: 'string', description: '目标文件路径。' },
                search: { type: 'string', description: '要替换的原文片段，必须在文件中唯一出现。' },
                replace: { type: 'string', description: '替换后的文本。' },
              },
              required: ['path', 'search', 'replace'],
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
            description: '用 OfficeCLI 结构化修改或创建 .docx/.xlsx/.pptx。实际写入安全工作区副本，原始文件不直接改动。修改前优先 office_view/office_get/office_query 确认选择器。',
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
                timeout_ms: { type: 'number', description: '超时时间，默认 60000，最大 180000。' },
              },
              required: ['operation', 'path'],
            },
          },
        },
      );
    }

    definitions.push({
      type: 'function',
      function: {
        name: 'exec_shell',
        description: `在工作目录内执行必要的 shell 命令。当前 shell：${shellName}。写权限下命令默认在当前会话 AI 工作目录执行，检测到的生成/更新文件会按相对路径同步到用户配置目录。如果用户已配置 R/Python/OfficeCLI 插件，Rscript、Python、officecli 会自动加入 PATH，并提供 RSCRIPT_PATH/R_HOME/PYTHON_PATH/OFFICECLI_PATH。read-only 权限只允许只读命令；写命令需要 workspace-write 或 danger-full-access。`,
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: '要执行的命令。优先使用 rg、dir/Get-ChildItem、git status/diff 等可审计命令。' },
            cwd: { type: 'string', description: '可选：相对工作目录的执行目录。默认工作目录根。' },
            timeout_ms: { type: 'number', description: '超时时间，默认 30000，最大 120000。' },
          },
          required: ['command'],
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
        case 'file_search':
          return await this.fileSearch(args);
        case 'grep_files':
          return await this.grepFiles(args);
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
        case 'exec_shell':
          return await this.execShell(args);
        default:
          throw new Error(`未知工作目录工具: ${toolName}`);
      }
    } catch (error) {
      logger.warn(`[WorkspaceToolRuntime] ${toolName} failed: ${(error as Error).message}`);
      return {
        ok: false,
        toolName,
        summary: `${toolName} 执行失败`,
        error: (error as Error).message,
      };
    }
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

  private async tryRunGit(args: string[]): Promise<void> {
    if (!this.safeWorkRoot) return;
    await new Promise<void>((resolve) => {
      const child = spawn('git', args, {
        cwd: this.safeWorkRoot as string,
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
      });
      child.on('error', () => resolve());
      child.on('close', () => resolve());
    });
  }

  private async ensureSafeWorkspace(): Promise<string> {
    if (!this.safeWorkRoot) return this.root;
    if (this.safeWorkInitialized) return this.safeWorkRoot;

    await fs.mkdir(this.safeWorkRoot, { recursive: true });
    const readmePath = path.join(this.safeWorkRoot, SAFE_WORKSPACE_README);
    const readme = [
      '# Scholar Harness AI Workspace',
      '',
      'This folder is the conversation-scoped AI workspace created before AI file changes.',
      `Original workspace: ${this.root}`,
      '',
      'Rules:',
      '- The configured root authorization covers every ordinary descendant directory and file.',
      '- File and content search recurse through the full configured workspace tree and this AI workspace.',
      '- Symbolic links and junctions are not followed outside the authorized root.',
      '- Source files are copied here before edits.',
      '- AI writes and shell commands operate here first.',
      '- Generated and updated outputs are mirrored to the configured workspace with the same relative path.',
      '',
    ].join('\n');
    await fs.writeFile(readmePath, readme, { encoding: 'utf-8', flag: 'wx' }).catch(() => undefined);
    this.safeWorkInitialized = true;

    await this.tryRunGit(['init']);
    await this.tryRunGit(['config', 'user.name', 'Scholar Harness']);
    await this.tryRunGit(['config', 'user.email', 'scholar-harness@local']);
    await this.tryRunGit(['add', SAFE_WORKSPACE_README]);
    await this.tryRunGit(['commit', '-m', 'Initialize Scholar Harness AI workspace']);

    return this.safeWorkRoot;
  }

  private safePathForOriginal(originalPath: string): string {
    if (!this.safeWorkRoot) return originalPath;
    if (this.isInSafeWorkspace(originalPath)) return originalPath;
    if (!isSubPath(this.root, originalPath)) {
      throw new Error('安全工作区只能复制工作目录内文件');
    }
    const relativePath = path.relative(this.root, originalPath);
    const targetPath = path.resolve(this.safeWorkRoot, relativePath || path.basename(originalPath));
    if (!isSubPath(this.safeWorkRoot, targetPath)) {
      throw new Error('安全工作区目标路径无效');
    }
    return targetPath;
  }

  private async ensureSafeCopyForFile(originalPath: string): Promise<string> {
    if (!this.safeWorkRoot || this.isInSafeWorkspace(originalPath)) return originalPath;
    const safeRoot = await this.ensureSafeWorkspace();
    const safePath = this.safePathForOriginal(originalPath);
    const originalStat = await fs.stat(originalPath).catch(() => null);
    if (!originalStat?.isFile()) return safePath;
    if (!this.safeCopiedOriginals.has(originalPath)) {
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      const safeStat = await fs.stat(safePath).catch(() => null);
      if (!safeStat?.isFile()) {
        await fs.copyFile(originalPath, safePath);
      }
      this.safeCopiedOriginals.add(originalPath);
      await this.tryRunGit(['add', path.relative(safeRoot, safePath)]);
      await this.tryRunGit(['commit', '-m', `Copy source file ${this.displayPath(originalPath)}`]);
    }
    return safePath;
  }

  private async resolveReadableFilePath(filePath: string): Promise<{ sourcePath: string; readPath: string }> {
    if (!this.safeWorkRoot || this.isInSafeWorkspace(filePath)) {
      return { sourcePath: filePath, readPath: filePath };
    }
    const safePath = this.safePathForOriginal(filePath);
    const safeStat = await fs.stat(safePath).catch(() => null);
    if (safeStat?.isFile()) {
      return { sourcePath: filePath, readPath: safePath };
    }
    const copiedPath = await this.ensureSafeCopyForFile(filePath);
    return { sourcePath: filePath, readPath: copiedPath };
  }

  private async resolveWritableFilePath(filePath: string): Promise<{ sourcePath: string; writePath: string; safeRedirected: boolean }> {
    this.assertWritable(filePath);
    if (!this.safeWorkRoot || this.isInSafeWorkspace(filePath)) {
      return { sourcePath: filePath, writePath: filePath, safeRedirected: false };
    }
    const writePath = await this.ensureSafeCopyForFile(filePath);
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
    const relativePath = isSubPath(this.root, requestedCwd) ? path.relative(this.root, requestedCwd) : '';
    const safeCwd = path.resolve(safeRoot, relativePath || '.');
    if (!isSubPath(safeRoot, safeCwd)) {
      throw new Error('安全工作区 cwd 无效');
    }
    await fs.mkdir(safeCwd, { recursive: true });
    return { originalCwd: requestedCwd, cwd: safeCwd, safeRedirected: true };
  }

  private async commitSafeWorkspaceChange(message: string): Promise<void> {
    if (!this.safeWorkRoot) return;
    await this.tryRunGit(['add', '-A']);
    await this.tryRunGit(['commit', '-m', message.slice(0, 180)]);
  }

  private async mirrorOutputsToBothRoots(filePaths: string[]): Promise<WorkspaceOutputMirrorResult[]> {
    if (!this.safeWorkRoot || filePaths.length === 0) return [];
    const results = await mirrorWorkspaceOutputFiles(filePaths, this.root, this.safeWorkRoot);
    results
      .filter(result => !result.mirrored)
      .forEach(result => logger.warn(
        `[WorkspaceToolRuntime] Failed to mirror output ${result.sourcePath} -> ${result.targetPath}: ${result.error || 'unknown error'}`
      ));
    return results;
  }

  private getSearchableEntries(startDir: string): Promise<WorkspaceTreeScan> {
    return walkWorkspaceTree(this.root, startDir);
  }

  private async getSearchableFiles(startDir: string): Promise<{ files: string[]; truncated: boolean }> {
    const scan = await this.getSearchableEntries(startDir);
    return {
      files: scan.entries.filter(entry => entry.kind === 'file').map(entry => entry.path),
      truncated: scan.truncated,
    };
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
    let mirrorPath: string | undefined;
    let mirrorExisted = false;
    let mirrorBackupPath: string | undefined;
    if (this.safeWorkRoot && isSubPath(this.safeWorkRoot, filePath)) {
      const relativePath = path.relative(this.safeWorkRoot, filePath);
      const candidate = path.resolve(this.root, relativePath);
      if (relativePath && isSubPath(this.root, candidate) && !isSubPath(this.safeWorkRoot, candidate)) {
        mirrorPath = candidate;
        const mirrorStat = await fs.stat(candidate).catch(() => null);
        mirrorExisted = !!mirrorStat?.isFile();
        if (mirrorExisted) {
          mirrorBackupPath = path.join(backupDir, `${backupId}.mirror.bak`);
          await fs.copyFile(candidate, mirrorBackupPath);
        }
      }
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
      mirrorPath,
      mirrorExisted,
      mirrorBackupPath,
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

  private async listDir(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const dirPath = this.resolveWorkspacePath(args.path, 'directory');
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error(`不是目录: ${this.displayPath(dirPath)}`);
    }
    const maxEntries = Math.min(MAX_LIST_ENTRIES, Math.max(1, Number(args.max_entries) || 200));
    const recursive = args.recursive !== false;
    if (recursive) {
      const scan = await walkWorkspaceTree(this.root, dirPath, maxEntries + 1);
      const selected = scan.entries.slice(0, maxEntries);
      const rows = await Promise.all(selected.map(async entry => {
        const absolutePath = path.resolve(this.root, entry.path);
        if (entry.kind === 'directory') {
          return {
            name: path.basename(entry.path),
            path: entry.path,
            kind: 'directory',
          };
        }
        const fileStat = await fs.stat(absolutePath).catch(() => null);
        return {
          name: path.basename(entry.path),
          path: entry.path,
          kind: isLikelyTextPath(absolutePath) ? 'text' : 'binary',
          size: fileStat?.size ?? null,
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

  private async fileSearch(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const query = String(args.query || '').trim();
    if (!query) throw new Error('query 不能为空');
    const startDir = this.resolveWorkspacePath(args.path || '.', 'directory');
    const limit = Math.min(200, Math.max(1, Number(args.limit) || 50));
    const scan = await this.getSearchableEntries(startDir);
    const requestedKinds = getRequestedToolFileKinds(query);
    const newestRequested = requestsNewestToolFile(query);
    const candidates = scan.entries
      .map((entry) => ({
        path: entry.path,
        kind: entry.kind === 'directory' ? 'directory' as const : getGeneratedFileKind(entry.path),
        score: scorePathMatch(entry.path, query),
      }))
      .filter((item) => item.score > 0);
    const scored = await Promise.all(candidates.map(async (item) => {
      if (!newestRequested) return { ...item, mtimeMs: 0, modifiedAt: '' };
      const stat = await fs.stat(path.resolve(this.root, item.path)).catch(() => null);
      return {
        ...item,
        mtimeMs: stat?.mtimeMs || 0,
        modifiedAt: stat ? stat.mtime.toISOString() : '',
      };
    }));
    scored.sort((a, b) => {
        const kindDelta = getToolFileKindSortIndex(a.kind, requestedKinds) - getToolFileKindSortIndex(b.kind, requestedKinds);
        if (kindDelta !== 0) return kindDelta;
        const scoreDelta = b.score - a.score;
        if (scoreDelta !== 0) return scoreDelta;
        if (newestRequested && b.mtimeMs !== a.mtimeMs) return b.mtimeMs - a.mtimeMs;
        return a.path.localeCompare(b.path);
      });
    const ranked = scored.slice(0, limit);
    const groupCounts = ranked.reduce<Record<string, number>>((acc, item) => {
      acc[item.kind] = (acc[item.kind] || 0) + 1;
      return acc;
    }, {});
    const groupSummary = Object.entries(groupCounts).map(([kind, count]) => `${kind} ${count}`).join('，');

    return {
      ok: true,
      toolName: 'file_search',
      target: query,
      summary: `递归搜索 "${query}" 命中 ${ranked.length} 个目录或文件候选${groupSummary ? `（按类型分组：${groupSummary}）` : ''}${scan.truncated ? '；目录树扫描达到安全上限' : ''}`,
      data: {
        query,
        scope: 'recursive',
        results: ranked,
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
    const include = typeof args.include === 'string' ? args.include.trim().toLowerCase() : '';
    const caseInsensitive = args.case_insensitive !== false;
    const contextLines = Math.min(5, Math.max(0, Number(args.context_lines) || 1));
    const maxResults = Math.min(500, Math.max(1, Number(args.max_results) || 80));
    const regex = new RegExp(pattern, caseInsensitive ? 'i' : undefined);
    const searchable = await this.getSearchableFiles(startDir);
    const files = searchable.files;
    const results: Array<{
      path: string;
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
      for (let index = 0; index < lines.length && results.length < maxResults; index += 1) {
        regex.lastIndex = 0;
        if (!regex.test(lines[index])) continue;
        results.push({
          path: relativePath,
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
        results,
        filesSearched,
        candidateFiles: files.length,
        scanTruncated: searchable.truncated,
        truncated: searchable.truncated || results.length >= maxResults,
      },
    };
  }

  private async readFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
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
    const copiedSummary = resolved.readPath !== resolved.sourcePath
      ? `；已复制到安全工作区 ${this.displayPath(resolved.readPath)}`
      : '';
    return {
      ok: true,
      toolName: 'read_file',
      target: this.displayPath(filePath),
      summary: `读取 ${this.displayPath(filePath)} 第 ${Number(args.start_line) || 1}-${slice.endLine} 行${copiedSummary}`,
      data: {
        path: this.displayPath(resolved.sourcePath),
        safePath: resolved.readPath !== resolved.sourcePath ? this.displayPath(resolved.readPath) : undefined,
        startLine: Number(args.start_line) || 1,
        endLine: slice.endLine,
        totalLines: slice.totalLines,
        truncated: slice.truncated,
        nextStartLine: slice.nextStartLine,
        content: slice.content,
        contentType: readable.contentType,
        extractionMethod: readable.extractionMethod,
        extractionWarnings: readable.extractionWarnings,
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
    const mirroredOutputs = output.exitCode === 0
      ? await this.mirrorOutputsToBothRoots([
          ...(outputPath ? [outputPath.writePath] : []),
          ...generatedFiles.map(file => path.resolve(this.root, file.path)),
        ])
      : [];

    const copiedSummary = resolved.readPath !== resolved.sourcePath
      ? `；已使用安全副本 ${this.displayPath(resolved.readPath)}`
      : '';
    const outputSummary = outputPath
      ? `；输出 ${this.displayPath(outputPath.writePath)}`
      : '';
    const mirrorSummary = mirroredOutputs.some(result => result.mirrored)
      ? '；已同步到用户目录和 AI 工作目录'
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
    const mirroredOutputs = output.exitCode === 0
      ? await this.mirrorOutputsToBothRoots([
          writable.writePath,
          ...(outputPath ? [outputPath.writePath] : []),
          ...generatedFiles.map(file => path.resolve(this.root, file.path)),
        ])
      : [];
    if (output.exitCode === 0) {
      await this.commitSafeWorkspaceChange(`AI office ${operation} ${this.displayPath(writable.writePath)}`);
    }
    const safeNote = writable.safeRedirected
      ? `；已同时更新用户目录和 AI 工作目录中的 ${this.displayPath(writable.writePath)}`
      : '';
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
        originalUntouched: writable.safeRedirected && !mirroredOutputs.some(result => result.mirrored),
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

  private async writeFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const filePath = this.resolveWorkspacePath(args.path, 'file');
    const content = String(args.content ?? '');
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
    const mirroredOutputs = await this.mirrorOutputsToBothRoots([writable.writePath]);
    const diff = buildUnifiedDiff(this.displayPath(writable.writePath), beforeContent, content);
    const safeNote = writable.safeRedirected
      ? '；已同步写入用户目录和 AI 工作目录'
      : '';
    return {
      ok: true,
      toolName: 'write_file',
      target: this.displayPath(writable.writePath),
      summary: `${existed ? '替换' : '新建'} ${this.displayPath(writable.writePath)}，${content.length} 字符；已备份 ${backup.backupId}${safeNote}`,
      data: {
        path: this.displayPath(writable.writePath),
        originalPath: this.displayPath(writable.sourcePath),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: writable.safeRedirected && !mirroredOutputs.some(result => result.mirrored),
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

  private async editFile(args: Record<string, unknown>): Promise<WorkspaceNativeToolResult> {
    const filePath = this.resolveWorkspacePath(args.path, 'file');
    const search = String(args.search ?? '');
    const replace = String(args.replace ?? '');
    if (!search) throw new Error('search 不能为空');
    const writable = await this.resolveWritableFilePath(filePath);
    await this.assertFreshRead(writable.writePath);
    const content = await readTextFile(writable.writePath);
    const first = content.indexOf(search);
    if (first === -1) throw new Error('search 片段未在文件中找到');
    const second = content.indexOf(search, first + search.length);
    if (second !== -1) throw new Error('search 片段出现多次，不能安全替换；请提供更长的唯一片段');
    const next = `${content.slice(0, first)}${replace}${content.slice(first + search.length)}`;
    const backup = await this.createEditBackup(writable.writePath, this.displayPath(writable.writePath), true, content, 'edit_file');
    const tempPath = `${writable.writePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, next, 'utf-8');
    await fs.rename(tempPath, writable.writePath);
    await this.noteRead(writable.writePath);
    await this.commitSafeWorkspaceChange(`AI edit ${this.displayPath(writable.writePath)}`);
    const mirroredOutputs = await this.mirrorOutputsToBothRoots([writable.writePath]);
    const diff = buildUnifiedDiff(this.displayPath(writable.writePath), content, next);
    const safeNote = writable.safeRedirected
      ? '；已同步更新用户目录和 AI 工作目录'
      : '';
    return {
      ok: true,
      toolName: 'edit_file',
      target: this.displayPath(writable.writePath),
      summary: `编辑 ${this.displayPath(writable.writePath)}：-${search.length} +${replace.length} 字符；已备份 ${backup.backupId}${safeNote}`,
      data: {
        path: this.displayPath(writable.writePath),
        originalPath: this.displayPath(writable.sourcePath),
        safeWorkspaceRoot: this.safeWorkRoot ? this.displaySafeWorkspacePath() : undefined,
        originalUntouched: writable.safeRedirected && !mirroredOutputs.some(result => result.mirrored),
        mirroredOutputs,
        replacedChars: search.length,
        insertedChars: replace.length,
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

    const safeSourcePath = await this.ensureSafeCopyForFile(sourcePath);
    const safeDestinationPath = this.safeWorkRoot && !this.isInSafeWorkspace(destinationPath)
      ? this.safePathForOriginal(destinationPath)
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

    let mirroredOutputs: WorkspaceOutputMirrorResult[] = [];
    if (safeSourcePath !== sourcePath) {
      mirroredOutputs = await this.mirrorOutputsToBothRoots([safeDestinationPath]);
      const mirroredDestination = mirroredOutputs.find(result =>
        result.mirrored && path.resolve(result.targetPath) === path.resolve(destinationPath)
      );
      if (!mirroredDestination) {
        await fs.rename(safeDestinationPath, safeSourcePath).catch(() => undefined);
        throw new Error('目标文件未能同步到用户配置目录，已保留源文件');
      }
      await fs.unlink(sourcePath);
    }

    this.readSnapshots.delete(sourcePath);
    await this.noteRead(safeDestinationPath);
    await this.commitSafeWorkspaceChange(
      `AI move ${this.displayPath(sourcePath)} to ${this.displayPath(destinationPath)}`
    );
    return {
      ok: true,
      toolName: 'move_file',
      target: `${this.displayPath(sourcePath)} -> ${this.displayPath(destinationPath)}`,
      summary: `已移动 ${this.displayPath(sourcePath)} 到 ${this.displayPath(destinationPath)}；未覆盖任何已有文件`,
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
    const mirroredOutputs = output.code === 0
      ? await this.mirrorOutputsToBothRoots(
          generatedFiles.map(file => path.resolve(this.root, file.path))
        )
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

  if (!meta.existed) {
    await fs.rm(targetPath, { force: true });
    await restoreMirror();
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
  return {
    backupId: safeBackupId,
    restoredPath: meta.displayPath || targetPath,
    action: 'restored',
  };
}
