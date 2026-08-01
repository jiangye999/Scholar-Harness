import * as fs from 'fs/promises';
import * as path from 'path';

import { createWorkspaceToolRuntime } from './workspace-tools';
import {
  assertPathAuthorizedByWorkspaceRoot,
  isPathWithinRoot,
} from './workspace-path-authorization';

export type WorkspaceDirectoryPermission = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface WorkspaceDirectoryInput {
  path?: string;
  permission?: WorkspaceDirectoryPermission | string;
  enabled?: boolean;
  source?: 'ui' | 'message';
  safeWorkRoot?: string;
  aiWorkRoot?: string;
  conversationId?: string;
}

export interface WorkspaceDirectoryFileSummary {
  path: string;
  size: number;
  kind: 'text' | 'binary';
  included: boolean;
  excerpt?: string;
}

export type WorkspacePreviewKind =
  | 'image'
  | 'pdf'
  | 'word'
  | 'spreadsheet'
  | 'presentation'
  | 'code'
  | 'data'
  | 'text'
  | 'file';

export interface WorkspacePreviewItem {
  path: string;
  name: string;
  size: number;
  ext: string;
  kind: WorkspacePreviewKind;
  previewUrl?: string;
  thumbnailUrl?: string;
}

export interface WorkspacePreview {
  images: WorkspacePreviewItem[];
  files: WorkspacePreviewItem[];
  imageCount: number;
  fileCount: number;
  truncated: boolean;
}

export interface WorkspaceFileMentionSearchResult {
  query: string;
  files: WorkspacePreviewItem[];
  truncated: boolean;
}

interface WorkspaceFileRecord {
  absolutePath: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  textLike: boolean;
}

interface WorkspaceIndexCacheEntry {
  expiresAt: number;
  files: WorkspaceFileRecord[];
}

interface WorkspaceSearchResult {
  path: string;
  line?: number;
  preview: string;
  match: 'path' | 'content';
  kind?: WorkspacePreviewKind;
  score?: number;
  modifiedAt?: string;
}

export interface WorkspaceDirectoryContext {
  available: boolean;
  root: string;
  permission: WorkspaceDirectoryPermission;
  safeWorkRoot?: string;
  aiWorkRoot?: string;
  generatedAt: string;
  fileCount: number;
  omittedCount: number;
  tree: string;
  files: WorkspaceDirectoryFileSummary[];
  contextMarkdown: string;
  queryHintsMarkdown?: string;
  warning?: string;
}

export interface PreparedWorkspaceOutputDirectory {
  workspaceRoot: string;
  aiWorkRoot: string;
  outputRoot: string;
  permission: Exclude<WorkspaceDirectoryPermission, 'read-only'>;
}

export interface WorkspaceToolRunResult {
  processedResponse: string;
  toolResults: string[];
  executedCount: number;
}

export interface WorkspaceToolEvent {
  phase: 'start' | 'success' | 'error' | 'skip';
  action: string;
  target?: string;
  summary: string;
}

interface WorkspaceDirectoryEntry {
  path: string;
  name: string;
  kind: 'directory' | 'text' | 'binary';
  size?: number;
}

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.env',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.xml', '.svg',
  '.py', '.r', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.cs', '.php',
  '.sh', '.bat', '.cmd', '.ps1', '.sql', '.csv', '.tsv', '.bib', '.ris', '.tex',
]);

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.webp',
  '.tif',
  '.tiff',
  '.svg',
]);

const PDF_EXTENSIONS = new Set(['.pdf']);
const WORD_EXTENSIONS = new Set(['.doc', '.docx', '.rtf']);
const SPREADSHEET_EXTENSIONS = new Set(['.csv', '.tsv', '.xls', '.xlsx']);
const PRESENTATION_EXTENSIONS = new Set(['.ppt', '.pptx']);
const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.css', '.scss', '.html', '.xml',
  '.py', '.r', '.rmd', '.qmd', '.rs', '.go', '.java', '.c', '.cc', '.cpp', '.h',
  '.hpp', '.cs', '.php', '.sh', '.bat', '.cmd', '.ps1', '.sql',
]);
const DATA_EXTENSIONS = new Set(['.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini', '.bib', '.ris', '.tex']);

const PRIORITY_FILE_PATTERNS = [
  /^agents\.md$/i,
  /^readme(\.[\w-]+)?\.md$/i,
  /^package\.json$/i,
  /^tsconfig\.json$/i,
  /^vite\.config\./i,
  /^next\.config\./i,
  /^src[\\/]/i,
  /^app[\\/]/i,
  /^pages[\\/]/i,
  /^components[\\/]/i,
  /^lib[\\/]/i,
];

const MAX_WORKSPACE_FILES = 100000;
const MAX_CONTEXT_FILES = 240;
const MAX_MANIFEST_TOP_LEVEL_ENTRIES = 80;
const MAX_WORKSPACE_STAT_CONCURRENCY = 64;
const WORKSPACE_INDEX_TTL_MS = 5 * 60_000;
const AI_WORKSPACE_DIRECTORY_NAME = 'ScholarHarness_AI_Workspaces';
const MAX_CONTENT_MATCHES_PER_FILE = 5;
const MAX_CONTENT_SEARCH_FILES = 3000;
const FILE_NAME_EXTENSIONS = 'docx?|rtf|xlsx?|csv|tsv|txt|md|markdown|pdf|png|jpe?g|gif|bmp|webp|tiff?|svg|r|rmd|qmd|pptx?';
const WORKSPACE_KIND_ORDER: WorkspacePreviewKind[] = ['word', 'spreadsheet', 'presentation', 'pdf', 'image', 'code', 'data', 'text', 'file'];
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

const workspaceIndexCache = new Map<string, WorkspaceIndexCacheEntry>();

function normalizePermission(value: unknown): WorkspaceDirectoryPermission {
  const raw = String(value || '').trim();
  if (raw === 'workspace-write' || raw === 'danger-full-access' || raw === 'read-only') return raw;
  if (/写|改|edit|write/i.test(raw)) return 'workspace-write';
  if (/danger|full|完全/i.test(raw)) return 'danger-full-access';
  return 'read-only';
}

export function normalizeWorkspaceDirectoryInput(value: unknown): WorkspaceDirectoryInput | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  const root = String(input.path || input.root || input.directory || '').trim();
  if (!root) return null;
  const permission = normalizePermission(input.permission);
  const requestedAiWorkRoot = String(input.safeWorkRoot || input.aiWorkRoot || '').trim() || undefined;
  return {
    path: root,
    permission,
    enabled: input.enabled !== false,
    source: input.source === 'message' ? 'message' : 'ui',
    safeWorkRoot: permission === 'read-only' ? undefined : requestedAiWorkRoot,
    aiWorkRoot: permission === 'read-only' ? undefined : requestedAiWorkRoot,
    conversationId: String(input.conversationId || input.sessionId || '').trim() || undefined,
  };
}

function trimCandidatePath(value: string): string {
  return value
    .replace(/^["'“”‘’]+|["'“”‘’，。；;、\s]+$/g, '')
    .trim();
}

async function statPathIfExists(candidate: string): Promise<{ absolutePath: string; stat: import('fs').Stats } | null> {
  const clean = trimCandidatePath(candidate);
  if (!clean) return null;
  const absolutePath = path.resolve(clean);
  const stat = await fs.stat(absolutePath).catch(() => null);
  return stat ? { absolutePath, stat } : null;
}

async function resolveExistingPathFromLooseInput(rawPath: string): Promise<{ absolutePath: string; stat: import('fs').Stats } | null> {
  const clean = trimCandidatePath(rawPath);
  if (!clean) return null;

  const exact = await statPathIfExists(clean);
  if (exact) return exact;

  // 用户经常直接粘贴路径后继续输入中文说明。逐步寻找已存在的路径前缀，
  // 但只在被移除后缀看起来像自然语言说明时接受，避免把拼错的路径截成另一个目录。
  for (let index = clean.length - 1; index > 3; index -= 1) {
    const suffix = clean.slice(index);
    if (!/^[\s，。；;、)\]}]|^[\u4e00-\u9fff]/.test(suffix)) continue;
    const prefix = trimCandidatePath(clean.slice(0, index));
    const found = await statPathIfExists(prefix);
    if (found) return found;
  }

  return null;
}

export function extractWorkspaceDirectoryInputFromText(
  text: string,
  permission: WorkspaceDirectoryPermission = 'read-only'
): WorkspaceDirectoryInput | null {
  const content = String(text || '');
  const matches = content.match(/[A-Za-z]:[\\/][^\r\n"'<>|]+/g) || [];
  for (const match of matches) {
    const candidate = trimCandidatePath(match);
    if (!candidate) continue;
    return {
      path: candidate,
      permission,
      enabled: true,
      source: 'message',
    };
  }
  return null;
}

function isSubPath(parent: string, child: string): boolean {
  return isPathWithinRoot(parent, child);
}

function sanitizeConversationWorkspaceId(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .slice(0, 120);
}

function resolveAiWorkspaceContainerRoot(root: string): string {
  const resolvedRoot = path.resolve(root);
  return path.basename(resolvedRoot).toLowerCase() === AI_WORKSPACE_DIRECTORY_NAME.toLowerCase()
    ? resolvedRoot
    : path.join(resolvedRoot, AI_WORKSPACE_DIRECTORY_NAME);
}

function resolveConversationAiWorkRoot(root: string, input: WorkspaceDirectoryInput): string {
  if (normalizePermission(input.permission) === 'read-only') {
    return '';
  }
  const requested = String(input.safeWorkRoot || input.aiWorkRoot || '').trim();
  if (requested) {
    const resolvedRequested = path.resolve(requested);
    const relativeParts = path.relative(path.resolve(root), resolvedRequested)
      .toLowerCase()
      .split(/[\\/]+/)
      .filter(Boolean);
    if (
      isSubPath(root, resolvedRequested)
      && (
        path.basename(path.resolve(root)).toLowerCase() === AI_WORKSPACE_DIRECTORY_NAME.toLowerCase()
        || relativeParts.includes(AI_WORKSPACE_DIRECTORY_NAME.toLowerCase())
      )
    ) {
      return resolvedRequested;
    }
  }

  const conversationId = sanitizeConversationWorkspaceId(input.conversationId);
  return conversationId
    ? path.join(resolveAiWorkspaceContainerRoot(root), `Conversation-${conversationId}`)
    : '';
}

export async function resolveWorkspaceDirectoryRoot(input: WorkspaceDirectoryInput): Promise<string> {
  const rawPath = String(input.path || '').trim().replace(/^["']|["']$/g, '');
  if (!rawPath) throw new Error('工作目录路径为空');
  const resolved = await resolveExistingPathFromLooseInput(rawPath);
  if (!resolved) throw new Error('工作目录路径不存在');
  if (resolved.stat.isDirectory()) return resolved.absolutePath;
  if (resolved.stat.isFile()) return path.dirname(resolved.absolutePath);
  throw new Error('工作目录路径不是文件夹或文件');
}

/**
 * Resolve and create a workflow output directory without scanning the whole
 * workspace. This is for backend workflows (Meta/R/etc.) that must write all
 * artifacts into the same conversation-scoped directory selected in the
 * composer.
 */
export async function prepareWorkspaceOutputDirectory(
  value: unknown,
  relativeSegments: string[] = [],
): Promise<PreparedWorkspaceOutputDirectory | null> {
  const input = normalizeWorkspaceDirectoryInput(value);
  if (!input?.enabled) return null;
  const permission = normalizePermission(input.permission);
  if (permission === 'read-only') {
    throw new Error('当前工作目录是只读模式；Meta 分析需要将数据、脚本和图表保存到该目录，请将目录权限改为“可写”或“完全访问”');
  }

  const workspaceRoot = await resolveWorkspaceDirectoryRoot(input);
  const aiWorkRoot = resolveConversationAiWorkRoot(workspaceRoot, input);
  if (!aiWorkRoot) {
    throw new Error('工作目录缺少会话标识，无法建立安全的 AI 工作文件夹');
  }

  const safeSegments = relativeSegments.map(segment => String(segment || '').trim());
  if (safeSegments.some(segment => (
    !segment
    || segment === '.'
    || segment === '..'
    || path.isAbsolute(segment)
    || /[\\/]/.test(segment)
  ))) {
    throw new Error('工作流输出子目录名无效');
  }

  const outputRoot = path.resolve(aiWorkRoot, ...safeSegments);
  if (!isSubPath(aiWorkRoot, outputRoot)) {
    throw new Error('工作流输出目录超出当前会话的 AI 工作文件夹');
  }
  await fs.mkdir(outputRoot, { recursive: true });
  return {
    workspaceRoot,
    aiWorkRoot,
    outputRoot,
    permission,
  };
}

function isTextLikeFile(filePath: string, size: number): boolean {
  if (size > 1024 * 1024) return false;
  const ext = path.extname(filePath).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.basename(filePath).toLowerCase();
  return ['dockerfile', 'makefile', 'license', 'gitignore', 'gitattributes'].includes(base);
}

function classifyPreviewKind(filePath: string, textLike: boolean): WorkspacePreviewKind {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (WORD_EXTENSIONS.has(ext)) return 'word';
  if (SPREADSHEET_EXTENSIONS.has(ext)) return 'spreadsheet';
  if (PRESENTATION_EXTENSIONS.has(ext)) return 'presentation';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DATA_EXTENSIONS.has(ext)) return 'data';
  if (textLike) return 'text';
  return 'file';
}

function toWorkspacePreviewItem(file: WorkspaceFileRecord): WorkspacePreviewItem {
  const kind = classifyPreviewKind(file.absolutePath, file.textLike);
  const item: WorkspacePreviewItem = {
    path: file.relativePath,
    name: path.basename(file.relativePath),
    size: file.size,
    ext: path.extname(file.relativePath).replace(/^\./, '').toLowerCase(),
    kind,
  };
  if (kind === 'image') {
    const version = String(Math.round(file.mtimeMs || 0));
    item.previewUrl = `/api/local-file/preview?path=${encodeURIComponent(file.absolutePath)}&v=${encodeURIComponent(version)}`;
    item.thumbnailUrl = `${item.previewUrl}&thumb=1`;
  }
  return item;
}

async function walkWorkspaceFiles(root: string, maxFiles = MAX_WORKSPACE_FILES): Promise<WorkspaceFileRecord[]> {
  const files: WorkspaceFileRecord[] = [];
  async function walk(dir: string): Promise<void> {
    if (files.length >= maxFiles) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    const fileEntries = entries
      .filter(entry => entry.isFile())
      .slice(0, Math.max(0, maxFiles - files.length));
    for (let offset = 0; offset < fileEntries.length && files.length < maxFiles; offset += MAX_WORKSPACE_STAT_CONCURRENCY) {
      const batch = fileEntries.slice(offset, offset + MAX_WORKSPACE_STAT_CONCURRENCY);
      const records = await Promise.all(batch.map(async entry => {
        const absolutePath = path.join(dir, entry.name);
        const stat = await fs.stat(absolutePath).catch(() => null);
        if (!stat?.isFile()) return null;
        return {
          absolutePath,
          relativePath: path.relative(root, absolutePath).replace(/\\/g, '/'),
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          textLike: isTextLikeFile(absolutePath, stat.size),
        } satisfies WorkspaceFileRecord;
      }));
      for (const record of records) {
        if (record) files.push(record);
        if (files.length >= maxFiles) break;
      }
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) break;
      if (!entry.isDirectory() || entry.name.toLowerCase() === '.git') continue;
      await walk(path.join(dir, entry.name));
    }
  }
  await walk(root);
  return files;
}

async function getWorkspaceFiles(root: string, maxFiles = MAX_WORKSPACE_FILES, forceRefresh = false): Promise<WorkspaceFileRecord[]> {
  const key = `${path.resolve(root)}::${maxFiles}`;
  const cached = workspaceIndexCache.get(key);
  if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.files;
  }
  const files = await walkWorkspaceFiles(root, maxFiles);
  workspaceIndexCache.set(key, {
    expiresAt: Date.now() + WORKSPACE_INDEX_TTL_MS,
    files,
  });
  return files;
}

async function getWorkspaceFilesAcrossRoots(
  root: string,
  additionalRoots: string[] = [],
  maxFiles = MAX_WORKSPACE_FILES,
  forceRefresh = false
): Promise<WorkspaceFileRecord[]> {
  const primaryRoot = path.resolve(root);
  const aiWorkspaceContainerRoot = resolveAiWorkspaceContainerRoot(primaryRoot);
  const roots = [
    ...additionalRoots
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .map(value => path.resolve(value)),
    aiWorkspaceContainerRoot,
    primaryRoot,
  ];
  const seenRoots = new Set<string>();
  const seenFiles = new Set<string>();
  const files: WorkspaceFileRecord[] = [];

  for (const candidateRoot of roots) {
    const rootKey = process.platform === 'win32' ? candidateRoot.toLowerCase() : candidateRoot;
    if (seenRoots.has(rootKey)) continue;
    seenRoots.add(rootKey);
    // AI work roots are conversation-scoped children of the authorized source
    // workspace. Ignore stale or external paths rather than broadening access.
    if (!isSubPath(primaryRoot, candidateRoot)) continue;
    const stat = await fs.stat(candidateRoot).catch(() => null);
    if (!stat?.isDirectory()) continue;
    try {
      assertPathAuthorizedByWorkspaceRoot(primaryRoot, candidateRoot);
    } catch {
      continue;
    }
    // Both the current conversation folder and the complete AI workspace
    // container change during Agent work. Always read child roots from disk so
    // the five-minute source-tree cache cannot hide a just-created output or a
    // file stored in another conversation folder.
    const refreshCandidate = forceRefresh || candidateRoot !== primaryRoot;
    const discovered = await getWorkspaceFiles(candidateRoot, maxFiles, refreshCandidate);
    for (const file of discovered) {
      const fileKey = process.platform === 'win32'
        ? file.absolutePath.toLowerCase()
        : file.absolutePath;
      if (seenFiles.has(fileKey)) continue;
      seenFiles.add(fileKey);
      files.push({
        ...file,
        relativePath: path.relative(primaryRoot, file.absolutePath).replace(/\\/g, '/'),
      });
      if (files.length >= maxFiles) return files;
    }
  }
  return files;
}

function sortFilesForContext<T extends { relativePath: string; textLike: boolean; size: number }>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const aPriority = PRIORITY_FILE_PATTERNS.some(pattern => pattern.test(a.relativePath)) ? 0 : 1;
    const bPriority = PRIORITY_FILE_PATTERNS.some(pattern => pattern.test(b.relativePath)) ? 0 : 1;
    if (aPriority !== bPriority) return aPriority - bPriority;
    if (a.textLike !== b.textLike) return a.textLike ? -1 : 1;
    return a.relativePath.localeCompare(b.relativePath);
  });
}

function buildWorkspaceTopLevelManifest(files: WorkspaceFileRecord[], maxEntries = MAX_MANIFEST_TOP_LEVEL_ENTRIES): string {
  const stats = new Map<string, { count: number; bytes: number; kind: WorkspacePreviewKind }>();
  for (const file of files) {
    const topLevel = file.relativePath.split('/')[0] || file.relativePath;
    const kind = classifyPreviewKind(file.absolutePath, file.textLike);
    const current = stats.get(topLevel) || { count: 0, bytes: 0, kind };
    current.count += 1;
    current.bytes += file.size;
    if (current.kind === 'file' && kind !== 'file') current.kind = kind;
    stats.set(topLevel, current);
  }

  const rows = Array.from(stats.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(0, maxEntries)
    .map(([name, item]) => `- ${name}${item.count > 1 ? '/' : ''} (${item.kind}, ${item.count} files, ${item.bytes} bytes)`);
  if (stats.size > maxEntries) {
    rows.push(`- ... 另外 ${stats.size - maxEntries} 个顶层条目未展开`);
  }
  return rows.join('\n') || '（空目录）';
}

function buildWorkspaceFileTypeStats(files: WorkspaceFileRecord[]): string {
  const stats = new Map<string, number>();
  for (const file of files) {
    const kind = classifyPreviewKind(file.absolutePath, file.textLike);
    stats.set(kind, (stats.get(kind) || 0) + 1);
  }
  return Array.from(stats.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${kind}:${count}`)
    .join('，') || '无文件';
}

async function readExcerpt(filePath: string, maxChars: number): Promise<string> {
  const buffer = await fs.readFile(filePath);
  const text = buffer.toString('utf-8').replace(/\u0000/g, '');
  return text.slice(0, maxChars);
}

export async function buildWorkspaceDirectoryContext(input: WorkspaceDirectoryInput): Promise<WorkspaceDirectoryContext> {
  const root = await resolveWorkspaceDirectoryRoot(input);
  const permission = normalizePermission(input.permission);
  const requestedSafeRoot = resolveConversationAiWorkRoot(root, input);
  const discovered = await getWorkspaceFilesAcrossRoots(
    root,
    requestedSafeRoot ? [requestedSafeRoot] : []
  );
  const sorted = sortFilesForContext(discovered);
  const summaries: WorkspaceDirectoryFileSummary[] = sorted.slice(0, MAX_CONTEXT_FILES).map(file => ({
    path: file.relativePath,
    size: file.size,
    kind: file.textLike ? 'text' : 'binary',
    included: false,
  }));

  const tree = buildWorkspaceTopLevelManifest(discovered);
  const fileTypeStats = buildWorkspaceFileTypeStats(discovered);
  const contextParts = [
    `根目录：${root}`,
    `权限：${permission}`,
    requestedSafeRoot ? `AI工作文件夹：${requestedSafeRoot}` : '',
    `文件总数：${discovered.length}`,
    `文件类型统计：${fileTypeStats}`,
    `授权范围：根目录本身及其全部层级的普通子目录、隐藏目录和文件；目录权限自动向下继承。为防止越权，不跟随指向根目录之外的符号链接或目录联接。`,
    `说明：默认只注入轻量 Manifest，不把完整目录树或文件全文一次性塞进提示词；AI 必须通过后端原生工作目录工具按需递归 list/search/read 文件。${requestedSafeRoot ? '检索范围同时包含用户配置目录、整个 ScholarHarness_AI_Workspaces 容器及当前会话 AI 工作目录；当前会话优先，生成或更新的文件会同步保存在两处。' : ''}`,
    '',
    '### 顶层内容概览',
    tree || '（空目录）',
    '',
    '### 内容读取策略',
    '- 当前 Manifest 只说明目录概况，不代表全量文件证据。',
    '- 判断文件、目录、代码或数据列是否存在时，必须调用 list_dir、file_search、grep_files、read_file 或 office_* 工具确认；file_search/grep_files 默认递归覆盖全部后代目录。',
    '- 只有自动检索命中或用户明确要求查看目录/文件时，才把具体路径和片段加入回答依据。',
  ].filter(Boolean);

  return {
    available: true,
    root,
    permission,
    safeWorkRoot: requestedSafeRoot || undefined,
    aiWorkRoot: requestedSafeRoot || undefined,
    generatedAt: new Date().toISOString(),
    fileCount: discovered.length,
    omittedCount: Math.max(0, discovered.length - summaries.length),
    tree,
    files: summaries,
    contextMarkdown: contextParts.join('\n'),
  };
}

export async function buildWorkspacePreview(
  root: string,
  options: { maxImages?: number; maxFiles?: number; additionalRoots?: string[] } = {}
): Promise<WorkspacePreview> {
  const maxImages = Math.max(1, Math.min(options.maxImages || 24, 80));
  const maxFiles = Math.max(1, Math.min(options.maxFiles || 60, 200));
  const discovered = sortFilesForContext(await getWorkspaceFilesAcrossRoots(root, options.additionalRoots || []));
  const images: WorkspacePreviewItem[] = [];
  const files: WorkspacePreviewItem[] = [];
  let imageCount = 0;
  let fileCount = 0;

  for (const file of discovered) {
    const item = toWorkspacePreviewItem(file);
    if (item.kind === 'image') {
      imageCount += 1;
      if (images.length < maxImages) images.push(item);
      continue;
    }
    fileCount += 1;
    if (files.length < maxFiles) files.push(item);
  }

  return {
    images,
    files,
    imageCount,
    fileCount,
    truncated: imageCount > images.length || fileCount > files.length,
  };
}

export function resolveWorkspaceFilePath(root: string, targetPath: string): { absolutePath: string; relativePath: string } {
  const cleanTarget = String(targetPath || '').trim().replace(/^["']|["']$/g, '');
  if (!cleanTarget) throw new Error('文件路径为空');
  const absolutePath = path.isAbsolute(cleanTarget)
    ? path.resolve(cleanTarget)
    : path.resolve(root, cleanTarget);
  assertPathAuthorizedByWorkspaceRoot(root, absolutePath);
  return {
    absolutePath,
    relativePath: path.relative(root, absolutePath).replace(/\\/g, '/'),
  };
}

export async function listWorkspaceFiles(
  root: string,
  dirPath = '',
  maxResults = 500,
  additionalRoots: string[] = []
): Promise<{
  root: string;
  dir: string;
  recursive: true;
  files: Array<{ path: string; size?: number; kind: 'directory' | 'text' | 'binary' }>;
  truncated: boolean;
}> {
  const resolvedDir = dirPath ? resolveWorkspaceFilePath(root, dirPath).absolutePath : root;
  const stat = await fs.stat(resolvedDir);
  if (!stat.isDirectory()) throw new Error('目标不是目录');
  const limit = Math.max(1, Math.min(Number(maxResults) || 500, MAX_WORKSPACE_FILES));
  const rows: Array<{ path: string; size?: number; kind: 'directory' | 'text' | 'binary' }> = [];
  const pendingDirectories = [resolvedDir];
  let directoryCursor = 0;
  let truncated = false;

  while (directoryCursor < pendingDirectories.length && rows.length < limit) {
    const currentDir = pendingDirectories[directoryCursor];
    directoryCursor += 1;
    const entries = await fs.readdir(currentDir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
      const entry = entries[entryIndex];
      const absolutePath = path.join(currentDir, entry.name);
      const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
      if (entry.isDirectory()) {
        rows.push({ path: relativePath, kind: 'directory' });
        pendingDirectories.push(absolutePath);
      } else if (entry.isFile()) {
        const fileStat = await fs.stat(absolutePath).catch(() => null);
        if (!fileStat) continue;
        rows.push({
          path: relativePath,
          size: fileStat.size,
          kind: isTextLikeFile(absolutePath, fileStat.size) ? 'text' : 'binary',
        });
      } else {
        // Do not follow links or junctions whose canonical target may leave root.
        continue;
      }
      if (rows.length >= limit) {
        truncated = entryIndex < entries.length - 1 || directoryCursor < pendingDirectories.length;
        break;
      }
    }
  }
  if (directoryCursor < pendingDirectories.length) truncated = true;

  // additionalRoots are authorized descendants and therefore already included
  // by the recursive root walk. Keep validating them to avoid silently accepting
  // an external path supplied by an old client.
  for (const additionalRoot of additionalRoots) {
    const candidate = String(additionalRoot || '').trim();
    if (candidate) {
      try {
        assertPathAuthorizedByWorkspaceRoot(root, path.resolve(candidate));
      } catch {
        throw new Error('附加工作目录超出已授权根目录');
      }
    }
  }
  return {
    root,
    dir: path.relative(root, resolvedDir).replace(/\\/g, '/') || '.',
    recursive: true,
    files: rows,
    truncated,
  };
}

/**
 * Lightweight path-only lookup used by the composer @ file picker. It reuses
 * the workspace index and never scans file contents while the user is typing.
 */
export async function searchWorkspaceFileMentions(
  root: string,
  query = '',
  maxResults = 120,
  additionalRoots: string[] = []
): Promise<WorkspaceFileMentionSearchResult> {
  const normalizedQuery = String(query || '').trim();
  const max = Math.max(1, Math.min(Number(maxResults) || 120, 200));
  const discovered = sortFilesForContext(await getWorkspaceFilesAcrossRoots(root, additionalRoots));
  const requestedKinds = getRequestedWorkspaceKinds(normalizedQuery);
  const rankedByQuery = normalizedQuery
    ? discovered
        .map(file => ({
          file,
          score: scoreWorkspacePathMatch(file.relativePath, normalizedQuery),
          kind: classifyPreviewKind(file.absolutePath, file.textLike),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => {
          const kindDelta = getWorkspaceKindSortIndex(a.kind, requestedKinds)
            - getWorkspaceKindSortIndex(b.kind, requestedKinds);
          if (kindDelta !== 0) return kindDelta;
          return b.score - a.score || a.file.relativePath.localeCompare(b.file.relativePath, 'zh-CN', { numeric: true });
        })
    : [];
  const ranked = normalizedQuery
    ? rankedByQuery
    : interleaveWorkspaceMentionKinds(discovered.map(file => ({
      file,
      score: 0,
      kind: classifyPreviewKind(file.absolutePath, file.textLike),
    })));

  return {
    query: normalizedQuery,
    files: ranked.slice(0, max).map(item => toWorkspacePreviewItem(item.file)),
    truncated: ranked.length > max,
  };
}

function interleaveWorkspaceMentionKinds<T extends { kind: WorkspacePreviewKind }>(items: T[]): T[] {
  const groups = new Map<WorkspacePreviewKind, T[]>();
  for (const kind of WORKSPACE_KIND_ORDER) groups.set(kind, []);
  for (const item of items) {
    const kind = WORKSPACE_KIND_ORDER.includes(item.kind) ? item.kind : 'file';
    groups.get(kind)?.push(item);
  }

  const rows: T[] = [];
  let offset = 0;
  while (rows.length < items.length) {
    let added = false;
    for (const kind of WORKSPACE_KIND_ORDER) {
      const item = groups.get(kind)?.[offset];
      if (!item) continue;
      rows.push(item);
      added = true;
    }
    if (!added) break;
    offset += 1;
  }
  return rows;
}

export async function listWorkspaceDirectoryEntries(
  root: string,
  dirPath = '',
  maxResults = 300
): Promise<{ dir: string; entries: WorkspaceDirectoryEntry[]; truncated: boolean }> {
  const resolvedDir = dirPath ? resolveWorkspaceFilePath(root, dirPath).absolutePath : root;
  const stat = await fs.stat(resolvedDir);
  if (!stat.isDirectory()) throw new Error('目标不是目录');
  const entries = await fs.readdir(resolvedDir, { withFileTypes: true });
  const rows: WorkspaceDirectoryEntry[] = [];

  for (const entry of entries) {
    if (rows.length >= maxResults) break;
    const absolutePath = path.join(resolvedDir, entry.name);
    const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/') || entry.name;
    if (entry.isDirectory()) {
      rows.push({
        path: relativePath,
        name: entry.name,
        kind: 'directory',
      });
      continue;
    }
    if (!entry.isFile()) continue;
    const fileStat = await fs.stat(absolutePath).catch(() => null);
    if (!fileStat) continue;
    rows.push({
      path: relativePath,
      name: entry.name,
      kind: isTextLikeFile(absolutePath, fileStat.size) ? 'text' : 'binary',
      size: fileStat.size,
    });
  }

  rows.sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (a.kind !== 'directory' && b.kind === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });

  return {
    dir: path.relative(root, resolvedDir).replace(/\\/g, '/') || '.',
    entries: rows,
    truncated: entries.length > rows.length,
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanCjkSearchTerm(raw: string): string {
  return String(raw || '')
    .replace(/^(?:请|帮我|帮忙|麻烦|找一下|找下|找找|查一下|查找|搜索|定位|打开|读取|查看|看一下|看下|看看)+/g, '')
    .replace(/(?:这个|那个|一个|一下|文件|文档|路径|目录|在哪里|在哪|哪里|里面|下面)+$/g, '')
    .trim();
}

function addWorkspaceSearchTerm(terms: Set<string>, raw: string): void {
  const term = String(raw || '').trim().replace(/^["'“”‘’`]+|["'“”‘’`，。；;、\s]+$/g, '');
  if (!term || /^[0-9]+$/.test(term) || /^[A-Za-z]:$/i.test(term)) return;
  const cjkCleaned = /[\u3400-\u9fff]/.test(term) ? cleanCjkSearchTerm(term) : term;
  if (cjkCleaned.length < 2) return;
  if (GENERIC_CJK_SEARCH_TERMS.has(cjkCleaned)) return;
  terms.add(cjkCleaned);
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

function scoreWorkspacePathMatch(relativePath: string, query: string): number {
  const target = relativePath.toLowerCase();
  const basename = path.basename(target);
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return 0;
  if (target === needle) return 1000;
  if (basename === needle) return 900;
  if (target.includes(needle)) return 700 - Math.max(0, target.indexOf(needle));

  const parts = extractPathSearchParts(query);
  if (parts.length > 0) {
    const matchedParts = parts.filter(part => target.includes(part));
    if (matchedParts.length === parts.length) {
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

function getRequestedWorkspaceKinds(query: string): WorkspacePreviewKind[] {
  const kinds: WorkspacePreviewKind[] = [];
  const text = String(query || '');
  if (/(?:word|docx?|rtf|文档|word文件|草稿|稿件|manuscript|draft)/i.test(text)) kinds.push('word');
  if (/(?:excel|xlsx?|csv|tsv|表格|数据表|sheet)/i.test(text)) kinds.push('spreadsheet');
  if (/(?:pptx?|powerpoint|幻灯片|演示文稿)/i.test(text)) kinds.push('presentation');
  if (/(?:pdf|论文|文献)/i.test(text)) kinds.push('pdf');
  if (/(?:png|jpe?g|tiff?|svg|图片|图像|截图|figure|fig)/i.test(text)) kinds.push('image');
  if (/(?:代码|脚本|r语言|python|\\.r\\b|\\.py\\b|script|code)/i.test(text)) kinds.push('code');
  return Array.from(new Set(kinds));
}

function getWorkspaceKindSortIndex(kind: WorkspacePreviewKind | undefined, requestedKinds: WorkspacePreviewKind[]): number {
  const safeKind = kind || 'file';
  const requestedIndex = requestedKinds.indexOf(safeKind);
  if (requestedIndex >= 0) return requestedIndex;
  const defaultIndex = WORKSPACE_KIND_ORDER.indexOf(safeKind);
  return requestedKinds.length + (defaultIndex >= 0 ? defaultIndex : WORKSPACE_KIND_ORDER.length);
}

function requestsNewestWorkspaceFile(query: string): boolean {
  return /(?:最新|最近|最后修改|最新版|newest|latest|most\s+recent|last\s+modified)/i.test(String(query || ''));
}

function formatWorkspaceSearchResults(results: WorkspaceSearchResult[], limit = 20): string {
  const shown = results.slice(0, limit);
  if (shown.length === 0) return '';
  const groups = new Map<string, WorkspaceSearchResult[]>();
  for (const item of shown) {
    const kind = item.kind || 'file';
    if (!groups.has(kind)) groups.set(kind, []);
    groups.get(kind)?.push(item);
  }
  return Array.from(groups.entries())
    .map(([kind, items]) => [
      `- ${kind}`,
      ...items.map(item => `  - ${item.path}${item.line ? `:${item.line}` : ''} [${item.match}]${item.modifiedAt ? ` [modified=${item.modifiedAt}]` : ''} ${item.preview}`),
    ].join('\n'))
    .join('\n');
}

export async function searchWorkspaceFiles(
  root: string,
  query: string,
  maxResults = 80,
  additionalRoots: string[] = []
): Promise<{ query: string; results: WorkspaceSearchResult[]; truncated: boolean }> {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) throw new Error('搜索关键词为空');
  const max = Math.max(1, Math.min(maxResults, 200));
  const newestRequested = requestsNewestWorkspaceFile(normalizedQuery);
  // “最新文件”必须看磁盘当前状态；缓存可能漏掉刚由 AI/Office 保存的新版本。
  const discovered = sortFilesForContext(
    await getWorkspaceFilesAcrossRoots(root, additionalRoots, MAX_WORKSPACE_FILES, newestRequested)
  );
  const results: WorkspaceSearchResult[] = [];
  const matcher = new RegExp(escapeRegex(normalizedQuery), 'i');
  const seenResultKeys = new Set<string>();
  const requestedKinds = getRequestedWorkspaceKinds(normalizedQuery);

  const pathMatches = discovered
    .map(file => ({
      file,
      score: scoreWorkspacePathMatch(file.relativePath, normalizedQuery),
      kind: classifyPreviewKind(file.absolutePath, file.textLike),
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => {
      const kindDelta = getWorkspaceKindSortIndex(a.kind, requestedKinds) - getWorkspaceKindSortIndex(b.kind, requestedKinds);
      if (kindDelta !== 0) return kindDelta;
      const scoreDelta = b.score - a.score;
      if (scoreDelta !== 0) return scoreDelta;
      if (newestRequested) {
        const modifiedDelta = b.file.mtimeMs - a.file.mtimeMs;
        if (modifiedDelta !== 0) return modifiedDelta;
      }
      return a.file.relativePath.localeCompare(b.file.relativePath);
    });

  for (const item of pathMatches) {
    if (results.length >= max) break;
    const key = `path:${item.file.relativePath}`;
    if (seenResultKeys.has(key)) continue;
    seenResultKeys.add(key);
    results.push({
      path: item.file.relativePath,
      preview: item.file.relativePath,
      match: 'path',
      kind: item.kind,
      score: item.score,
      modifiedAt: new Date(item.file.mtimeMs).toISOString(),
    });
  }

  let contentFilesScanned = 0;
  for (const file of discovered) {
    if (results.length >= max) break;
    if (!file.textLike) continue;
    contentFilesScanned += 1;
    if (contentFilesScanned > MAX_CONTENT_SEARCH_FILES) break;
    const content = await readExcerpt(file.absolutePath, 1024 * 1024).catch(() => '');
    if (!content) continue;
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!matcher.test(line)) continue;
      const key = `content:${file.relativePath}:${index + 1}`;
      if (seenResultKeys.has(key)) continue;
      seenResultKeys.add(key);
      results.push({
        path: file.relativePath,
        line: index + 1,
        preview: line.trim().slice(0, 240),
        match: 'content',
        kind: classifyPreviewKind(file.absolutePath, file.textLike),
      });
      if (results.length >= max) break;
      const matchesForFile = results.filter(item => item.path === file.relativePath && item.match === 'content').length;
      if (matchesForFile >= MAX_CONTENT_MATCHES_PER_FILE) break;
    }
  }

  return {
    query: normalizedQuery,
    results,
    truncated: results.length >= max,
  };
}

export async function readWorkspaceFileLines(
  root: string,
  targetPath: string,
  centerLine?: number,
  before = 35,
  after = 90
): Promise<{ path: string; startLine: number; endLine: number; content: string }> {
  const resolved = resolveWorkspaceFilePath(root, targetPath);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) throw new Error('目标不是文件');
  if (!isTextLikeFile(resolved.absolutePath, stat.size)) throw new Error('目标文件不是可读文本文件或过大');

  const text = await readExcerpt(resolved.absolutePath, 1024 * 1024);
  const lines = text.split(/\r?\n/);
  const center = Number.isFinite(centerLine) && centerLine && centerLine > 0
    ? Math.min(Math.max(1, Math.floor(centerLine)), lines.length)
    : 1;
  const startLine = Math.max(1, center - before);
  const endLine = Math.min(lines.length, center + after);
  const content = lines
    .slice(startLine - 1, endLine)
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');

  return {
    path: resolved.relativePath,
    startLine,
    endLine,
    content,
  };
}

function extractWorkspaceSearchTerms(text: string): string[] {
  const content = String(text || '');
  const terms = new Set<string>();

  const fileNamePattern = new RegExp(`[^\\s，。；;、"'“”‘’<>|]+\\.(${FILE_NAME_EXTENSIONS})`, 'gi');
  const fileNameMatches = content.match(fileNamePattern) || [];
  for (const raw of fileNameMatches) {
    addWorkspaceSearchTerm(terms, path.basename(raw));
    addWorkspaceSearchTerm(terms, path.basename(raw).replace(new RegExp(`\\.(${FILE_NAME_EXTENSIONS})$`, 'i'), ''));
  }

  const quotedMatches = content.match(/[`"'“”‘’《》【】]([^`"'“”‘’《》【】]{2,80})[`"'“”‘’《》【】]/g) || [];
  for (const raw of quotedMatches) {
    addWorkspaceSearchTerm(terms, raw.replace(/^[`"'“”‘’《》【】]+|[`"'“”‘’《》【】]+$/g, ''));
  }

  const rawTerms = content.match(/[A-Za-z0-9][A-Za-z0-9_.-]{1,}/g) || [];
  for (const raw of rawTerms) {
    const term = raw.replace(/^[._-]+|[._-]+$/g, '');
    if (!term || /^[0-9]+$/.test(term)) continue;
    if (/^[A-Za-z]:$/i.test(term)) continue;
    if (term.length >= 2 && (term.includes('_') || term.includes('.') || /\d/.test(term) || /^(?:docx?|word|rtf)$/i.test(term))) {
      addWorkspaceSearchTerm(terms, term);
      const withoutExt = term.replace(new RegExp(`\\.(${FILE_NAME_EXTENSIONS})$`, 'i'), '');
      if (withoutExt && withoutExt !== term) addWorkspaceSearchTerm(terms, withoutExt);
    }
  }

  const cjkMatches = content.match(/[\u3400-\u9fff]{2,}/g) || [];
  for (const raw of cjkMatches) {
    addWorkspaceSearchTerm(terms, raw);
    const cleaned = cleanCjkSearchTerm(raw);
    if (cleaned.length > 8) {
      for (let index = 0; index < cleaned.length - 3; index += 4) {
        addWorkspaceSearchTerm(terms, cleaned.slice(index, Math.min(cleaned.length, index + 8)));
      }
    }
  }

  if (/(?:word|docx?|文档|word文件)/i.test(content)) {
    addWorkspaceSearchTerm(terms, '.docx');
  }

  return Array.from(terms).slice(0, 8);
}

export async function buildWorkspaceAgentPrelude(
  root: string,
  userMessage: string,
  onToolEvent?: (event: WorkspaceToolEvent) => void,
  additionalRoots: string[] = []
): Promise<string> {
  const sections: string[] = [];

  try {
    onToolEvent?.({
      phase: 'start',
      action: 'list',
      target: '.',
      summary: '预检根目录：.',
    });
    const rootEntries = await listWorkspaceDirectoryEntries(root, '', 120);
    const rows = rootEntries.entries
      .slice(0, 80)
      .map(entry => `- ${entry.path}${entry.kind === 'directory' ? '/' : ''} (${entry.kind}${entry.size ? `, ${entry.size} bytes` : ''})`)
      .join('\n');
    sections.push(`### 根目录直接内容\n${rows || '（空目录）'}${rootEntries.truncated ? '\n- ... 结果已截断' : ''}`);
    onToolEvent?.({
      phase: 'success',
      action: 'list',
      target: rootEntries.dir,
      summary: `根目录预检完成，直接条目 ${rootEntries.entries.length} 个${rootEntries.truncated ? '，结果已截断' : ''}`,
    });
  } catch (error) {
    onToolEvent?.({
      phase: 'error',
      action: 'list',
      target: '.',
      summary: `根目录预检失败：${(error as Error).message}`,
    });
  }

  const aiWorkspaceContainerRoot = resolveAiWorkspaceContainerRoot(root);
  if (isSubPath(root, aiWorkspaceContainerRoot) && path.resolve(aiWorkspaceContainerRoot) !== path.resolve(root)) {
    const relativeContainerRoot = path.relative(root, aiWorkspaceContainerRoot).replace(/\\/g, '/');
    try {
      const entries = await listWorkspaceDirectoryEntries(root, relativeContainerRoot, 160);
      const rows = entries.entries
        .slice(0, 120)
        .map(entry => `- ${entry.path}${entry.kind === 'directory' ? '/' : ''} (${entry.kind}${entry.size ? `, ${entry.size} bytes` : ''})`)
        .join('\n');
      sections.push([
        '### AI 工作区容器直接内容',
        `根路径：${relativeContainerRoot}`,
        '这里包含当前会话和其他会话的 AI 产物目录；后续关键词搜索会递归覆盖整个容器。',
        rows || '（目录尚未创建或为空）',
        entries.truncated ? '- ... 结果已截断' : '',
      ].filter(Boolean).join('\n'));
    } catch {
      // The container is created lazily for the first write. The recursive
      // search helper will inspect it as soon as it exists.
    }
  }

  for (const additionalRoot of additionalRoots) {
    const resolvedAdditionalRoot = path.resolve(String(additionalRoot || '').trim());
    if (!additionalRoot || !isSubPath(root, resolvedAdditionalRoot) || resolvedAdditionalRoot === path.resolve(root)) continue;
    const relativeRoot = path.relative(root, resolvedAdditionalRoot).replace(/\\/g, '/');
    try {
      const entries = await listWorkspaceDirectoryEntries(root, relativeRoot, 120);
      const rows = entries.entries
        .slice(0, 80)
        .map(entry => `- ${entry.path}${entry.kind === 'directory' ? '/' : ''} (${entry.kind}${entry.size ? `, ${entry.size} bytes` : ''})`)
        .join('\n');
      sections.push(`### 当前会话 AI 工作目录直接内容\n根路径：${relativeRoot}\n${rows || '（空目录）'}${entries.truncated ? '\n- ... 结果已截断' : ''}`);
    } catch {
      // A just-created AI work directory may not be available until the native
      // tool runtime initializes it; search tools will still inspect it later.
    }
  }

  const terms = extractWorkspaceSearchTerms(userMessage);
  for (const term of terms) {
    try {
      onToolEvent?.({
        phase: 'start',
        action: 'search',
        target: term,
        summary: `预检搜索：${term}`,
      });
      const result = await searchWorkspaceFiles(root, term, 80, additionalRoots);
      const rows = formatWorkspaceSearchResults(result.results, 20);
      const excerpts: string[] = [];
      const excerptKeys = new Set<string>();
      for (const item of result.results.filter(hit => hit.match === 'content' && hit.line).slice(0, 4)) {
        const key = `${item.path}:${item.line}`;
        if (excerptKeys.has(key)) continue;
        excerptKeys.add(key);
        onToolEvent?.({
          phase: 'start',
          action: 'lines',
          target: `${item.path}:${item.line}`,
          summary: `预检读取片段：${item.path}:${item.line}`,
        });
        const snippet = await readWorkspaceFileLines(root, item.path, item.line, 25, 80).catch(() => null);
        if (!snippet) continue;
        excerpts.push(`#### ${snippet.path}:${snippet.startLine}-${snippet.endLine}\n\`\`\`\n${snippet.content}\n\`\`\``);
        onToolEvent?.({
          phase: 'success',
          action: 'lines',
          target: `${snippet.path}:${snippet.startLine}-${snippet.endLine}`,
          summary: `片段读取完成：${snippet.path}:${snippet.startLine}-${snippet.endLine}`,
        });
      }
      sections.push(`### 自动搜索：${term}\n${rows || '未找到匹配项'}${excerpts.length ? `\n\n${excerpts.join('\n\n')}` : ''}`);
      onToolEvent?.({
        phase: 'success',
        action: 'search',
        target: term,
        summary: `预检搜索完成：${term}，命中 ${result.results.length} 条`,
      });
    } catch (error) {
      onToolEvent?.({
        phase: 'error',
        action: 'search',
        target: term,
        summary: `预检搜索失败：${term}：${(error as Error).message}`,
      });
    }
  }

  if (sections.length === 0) return '';
  return [
    '## 工作目录预检结果',
    '系统已经在模型回答前主动执行了根目录入口检查、整个 ScholarHarness_AI_Workspaces 容器检查、整棵授权目录树的递归关键词搜索和命中代码片段读取。回答时必须优先使用这些真实工具结果，不能把根目录直接条目或当前会话目录误当成完整范围。',
    ...sections,
  ].join('\n\n');
}

export async function buildWorkspaceQueryHints(
  root: string,
  userMessage: string,
  additionalRoots: string[] = []
): Promise<string> {
  const terms = extractWorkspaceSearchTerms(userMessage);
  if (terms.length === 0) return '';

  const sections: string[] = [];
  for (const term of terms) {
    const result = await searchWorkspaceFiles(root, term, 30, additionalRoots).catch(() => null);
    if (!result || result.results.length === 0) continue;
    const rows = formatWorkspaceSearchResults(result.results, 12);
    const excerpts: string[] = [];
    const excerptKeys = new Set<string>();
    for (const item of result.results.filter(hit => hit.match === 'content' && hit.line).slice(0, 4)) {
      const key = `${item.path}:${item.line}`;
      if (excerptKeys.has(key)) continue;
      excerptKeys.add(key);
      const snippet = await readWorkspaceFileLines(root, item.path, item.line, 18, 45).catch(() => null);
      if (!snippet) continue;
      excerpts.push(`##### ${snippet.path}:${snippet.startLine}-${snippet.endLine}\n\`\`\`\n${snippet.content}\n\`\`\``);
    }
    sections.push(`#### ${term}\n${rows}${excerpts.length ? `\n\n${excerpts.join('\n\n')}` : ''}`);
  }

  if (sections.length === 0) return '';
  return [
    '### 与本次用户问题相关的自动工作目录检索结果',
    '这些结果由后端按用户问题中的文件名、对象名或代码标识符，递归搜索授权根目录的全部后代目录后生成。回答查找代码/文件位置类问题时，优先引用这些命中结果；必要时再调用原生 read_file 工具读取具体文件片段。',
    ...sections,
  ].join('\n');
}

export async function readWorkspaceFile(root: string, targetPath: string, maxChars = 200000): Promise<{ path: string; content: string; truncated: boolean }> {
  const resolved = resolveWorkspaceFilePath(root, targetPath);
  const stat = await fs.stat(resolved.absolutePath);
  if (!stat.isFile()) throw new Error('目标不是文件');
  if (!isTextLikeFile(resolved.absolutePath, stat.size)) throw new Error('目标文件不是可读文本文件或过大');
  const content = await readExcerpt(resolved.absolutePath, maxChars + 1);
  return {
    path: resolved.relativePath,
    content: content.slice(0, maxChars),
    truncated: content.length > maxChars,
  };
}

export async function writeWorkspaceFile(
  root: string,
  targetPath: string,
  content: string,
  permission: WorkspaceDirectoryPermission
): Promise<{
  path: string;
  bytes: number;
  diff?: string;
  backupId?: string;
  rollbackAvailable?: boolean;
}> {
  const runtime = createWorkspaceToolRuntime({
    available: true,
    root: path.resolve(root),
    permission,
    generatedAt: new Date().toISOString(),
    fileCount: 0,
    omittedCount: 0,
    tree: '',
    files: [],
    contextMarkdown: '',
  });
  const toolResult = await runtime.executeToolCall({
    id: `legacy_workspace_write_${Date.now()}`,
    type: 'function',
    function: {
      name: 'write_file',
      arguments: JSON.stringify({ path: targetPath, content }),
    },
  });
  if (!toolResult.ok) {
    throw new Error(toolResult.error || toolResult.summary || '工作目录写入失败');
  }
  const data = toolResult.data && typeof toolResult.data === 'object'
    ? toolResult.data as Record<string, unknown>
    : {};
  workspaceIndexCache.clear();
  return {
    path: String(data.path || targetPath),
    bytes: Number(data.bytes || Buffer.byteLength(content, 'utf-8')),
    diff: typeof data.diff === 'string' ? data.diff : undefined,
    backupId: typeof data.backupId === 'string' ? data.backupId : undefined,
    rollbackAvailable: data.rollbackAvailable === true,
  };
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseWorkspaceToolBlock(block: string): { action: string; filePath: string; query: string; maxResults: number; line?: number; content: string } | null {
  const body = block.replace(/^```(?:workspace_tool)?\s*/i, '').replace(/```$/g, '').trim();
  const action = body.match(/^action:\s*([^\n]+)$/im)?.[1]?.trim().toLowerCase() || '';
  const filePath = body.match(/^path:\s*([^\n]+)$/im)?.[1]?.trim() || '';
  const query = body.match(/^query:\s*([^\n]+)$/im)?.[1]?.trim() || '';
  const maxResults = parsePositiveInt(body.match(/^maxResults:\s*([^\n]+)$/im)?.[1]?.trim(), 80);
  const line = parsePositiveInt(body.match(/^line:\s*([^\n]+)$/im)?.[1]?.trim(), 0) || undefined;
  let content = '';
  const contentMatch = body.match(/^content:\s*\|\s*\n([\s\S]*)$/im);
  if (contentMatch) {
    content = contentMatch[1].replace(/^\s{2}/gm, '').replace(/\s+$/g, '');
  }
  if (!action) return null;
  if ((action === 'read' || action === 'write' || action === 'create' || action === 'lines') && !filePath) return null;
  if (action === 'search' && !query) return null;
  return { action, filePath, query, maxResults, line, content };
}

export async function executeWorkspaceToolBlocks(
  response: string,
  workspace: WorkspaceDirectoryContext | undefined
): Promise<string> {
  return (await runWorkspaceToolBlocks(response, workspace)).processedResponse;
}

export async function runWorkspaceToolBlocks(
  response: string,
  workspace: WorkspaceDirectoryContext | undefined,
  onToolEvent?: (event: WorkspaceToolEvent) => void
): Promise<WorkspaceToolRunResult> {
  if (!workspace?.available) {
    return {
      processedResponse: response,
      toolResults: [],
      executedCount: 0,
    };
  }
  const blocks = response.match(/```workspace_tool\s*[\s\S]*?```/gi) || [];
  if (blocks.length === 0) {
    return {
      processedResponse: response,
      toolResults: [],
      executedCount: 0,
    };
  }

  let nextResponse = response;
  const toolResults: string[] = [];
  let executedCount = 0;
  for (const block of blocks) {
    const parsed = parseWorkspaceToolBlock(block);
    if (!parsed) {
      const message = '工作目录工具调用格式无效。';
      nextResponse = nextResponse.replace(block, `\n⚠️ ${message}\n`);
      toolResults.push(message);
      onToolEvent?.({ phase: 'skip', action: 'unknown', summary: message });
      continue;
    }
    try {
      const target = parsed.query || parsed.filePath || '.';
      onToolEvent?.({
        phase: 'start',
        action: parsed.action,
        target,
        summary: `调用 ${parsed.action}${target ? `：${target}` : ''}`,
      });
      if (parsed.action === 'list') {
        const result = await listWorkspaceFiles(
          workspace.root,
          parsed.filePath || '',
          parsed.maxResults,
          [workspace.aiWorkRoot || workspace.safeWorkRoot || ''].filter(Boolean)
        );
        const rows = result.files
          .map(file => `- ${file.path}${file.kind === 'directory' ? '/' : ''} (${file.kind}${typeof file.size === 'number' ? `, ${file.size} bytes` : ''})`)
          .join('\n');
        const replacement = `\n\n✅ 已列出工作目录：${result.dir}${result.truncated ? '（结果已截断）' : ''}\n\n${rows || '（空目录）'}\n`;
        nextResponse = nextResponse.replace(block, replacement);
        toolResults.push(`已列出工作目录：${result.dir}${result.truncated ? '（结果已截断）' : ''}\n${rows || '（空目录）'}`);
        onToolEvent?.({
          phase: 'success',
          action: parsed.action,
          target: result.dir,
          summary: `递归列出 ${result.dir}，返回 ${result.files.length} 个目录或文件${result.truncated ? '，结果已截断' : ''}`,
        });
        executedCount += 1;
      } else if (parsed.action === 'search') {
        const result = await searchWorkspaceFiles(
          workspace.root,
          parsed.query,
          parsed.maxResults,
          [workspace.aiWorkRoot || workspace.safeWorkRoot || ''].filter(Boolean)
        );
        const rows = formatWorkspaceSearchResults(result.results, result.results.length);
        const replacement = `\n\n✅ 已搜索工作目录：${result.query}${result.truncated ? '（结果已截断）' : ''}\n\n${rows || '未找到匹配项'}\n`;
        nextResponse = nextResponse.replace(block, replacement);
        toolResults.push(`已搜索工作目录：${result.query}${result.truncated ? '（结果已截断）' : ''}\n${rows || '未找到匹配项'}`);
        const topHits = result.results.slice(0, 5).map(item => `${item.path}${item.line ? `:${item.line}` : ''}`).join('；');
        onToolEvent?.({
          phase: 'success',
          action: parsed.action,
          target: result.query,
          summary: `搜索 ${result.query}，命中 ${result.results.length} 条${topHits ? `：${topHits}` : ''}`,
        });
        executedCount += 1;
      } else if (parsed.action === 'lines') {
        const result = await readWorkspaceFileLines(workspace.root, parsed.filePath, parsed.line);
        const replacement = `\n\n✅ 已读取工作目录文件片段：${result.path}:${result.startLine}-${result.endLine}\n\n\`\`\`\n${result.content}\n\`\`\`\n`;
        nextResponse = nextResponse.replace(block, replacement);
        toolResults.push(`已读取工作目录文件片段：${result.path}:${result.startLine}-${result.endLine}\n\`\`\`\n${result.content}\n\`\`\``);
        onToolEvent?.({
          phase: 'success',
          action: parsed.action,
          target: result.path,
          summary: `读取 ${result.path}:${result.startLine}-${result.endLine}`,
        });
        executedCount += 1;
      } else if (parsed.action === 'read') {
        const result = await readWorkspaceFile(workspace.root, parsed.filePath);
        const replacement = `\n\n✅ 已读取工作目录文件：${result.path}${result.truncated ? '（内容已截断）' : ''}\n\n\`\`\`\n${result.content}\n\`\`\`\n`;
        nextResponse = nextResponse.replace(block, replacement);
        toolResults.push(`已读取工作目录文件：${result.path}${result.truncated ? '（内容已截断）' : ''}\n\`\`\`\n${result.content}\n\`\`\``);
        onToolEvent?.({
          phase: 'success',
          action: parsed.action,
          target: result.path,
          summary: `读取 ${result.path}${result.truncated ? '，内容已截断' : ''}`,
        });
        executedCount += 1;
      } else if (parsed.action === 'write' || parsed.action === 'create') {
        const result = await writeWorkspaceFile(workspace.root, parsed.filePath, parsed.content, workspace.permission);
        const backupLine = result.backupId ? `\n↩ 可回滚备份：${result.backupId}` : '';
        const diffBlock = result.diff ? `\n\n\`\`\`diff\n${result.diff.slice(0, 12000)}\n\`\`\`` : '';
        const replacement = `\n\n✅ 已写入工作目录文件：${result.path}（${result.bytes} bytes）${backupLine}${diffBlock}\n`;
        nextResponse = nextResponse.replace(block, replacement);
        toolResults.push(`已写入工作目录文件：${result.path}（${result.bytes} bytes）${backupLine}`);
        onToolEvent?.({
          phase: 'success',
          action: parsed.action,
          target: result.path,
          summary: `写入 ${result.path}（${result.bytes} bytes）${result.backupId ? `，备份 ${result.backupId}` : ''}`,
        });
        executedCount += 1;
      } else {
        const message = `不支持的工作目录工具动作：${parsed.action}`;
        nextResponse = nextResponse.replace(block, `\n⚠️ ${message}\n`);
        toolResults.push(message);
        onToolEvent?.({ phase: 'skip', action: parsed.action, summary: message });
      }
    } catch (error) {
      const message = `工作目录工具执行失败：${(error as Error).message}`;
      nextResponse = nextResponse.replace(block, `\n⚠️ ${message}\n`);
      toolResults.push(message);
      onToolEvent?.({
        phase: 'error',
        action: parsed.action,
        target: parsed.query || parsed.filePath,
        summary: message,
      });
    }
  }
  return {
    processedResponse: nextResponse,
    toolResults,
    executedCount,
  };
}
