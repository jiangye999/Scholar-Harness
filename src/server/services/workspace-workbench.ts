import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../utils/logger';
import {
  buildIntegratedDocx,
  resolveProjectCumulativeArtifactRoot,
  WORKSPACE_ARTIFACT_LAYOUT,
} from './workspace-artifact-layout';
import { filterUserFacingWorkspaceOutputPaths } from './workspace-output-artifacts';
import { synchronizeSourceFileToAiWorkspace } from './workspace-source-sync';
import {
  shouldSkipWorkspaceSourceDirectory,
  shouldSkipWorkspaceSourceFile,
  shouldSkipWorkspaceSourceRelativePath,
} from './workspace-source-policy';

export const USER_VIEW_DIRECTORY_NAME = '用户查看';
export const AI_SOURCE_COPY_DIRECTORY_NAME = '源文件副本';
export const AI_WORKING_FILES_DIRECTORY_NAME = '工作文件';
export const AI_WORKSPACE_README_NAME = 'README_ScholarHarness_AI_Workspace.md';
export const AI_WORKSPACE_CONTAINER_NAME = 'ScholarHarness_AI_Workspaces';
export const PROJECT_PRIMARY_DELIVERABLES_DIRECTORY_NAME = '项目交付物';

export const PRIMARY_WORD_DELIVERABLES = {
  draft: 'paper-draft.docx',
  mainFiguresTables: 'figures_tables.docx',
  supplementary: 'supplementary-materials.docx',
} as const;

export const AI_WORKBENCH_OUTPUT_DIRECTORIES = {
  framework: 'framework',
  drafts: 'drafts',
  figuresTables: 'figures_tables',
  supplementary: 'supplementary',
  other: 'other_outputs',
} as const;

export const USER_VIEW_OUTPUT_DIRECTORIES = {
  figures: 'figure',
  drafts: 'drafts',
  framework: 'framework',
  supplementary: 'supplementary',
  other: 'other_outputs',
} as const;

const PRIMARY_WORD_DELIVERABLE_NAMES = new Set<string>(Object.values(PRIMARY_WORD_DELIVERABLES));
const USER_VIEW_FIGURE_SUPPORT_EXTENSIONS = new Set([
  '.bmp', '.csv', '.dat', '.do', '.gif', '.ipynb', '.jpeg', '.jpg', '.json', '.m',
  '.pdf', '.png', '.py', '.qmd', '.r', '.rmd', '.sas', '.sps', '.spss', '.svg',
  '.tif', '.tiff', '.tsv', '.txt', '.webp', '.xls', '.xlsx',
]);

const WORKBENCH_MANIFEST_NAME = '.scholar-harness-workbench.json';
const USER_VIEW_MANIFEST_NAME = '.scholar-harness-user-view.json';
const DEFAULT_MAX_SOURCE_FILES = 50_000;
const DEFAULT_SOURCE_SYNC_CONCURRENCY = 8;
const userViewManifestLocks = new Map<string, Promise<void>>();
const agentTurnPreparationEntries = new Map<string, SharedAgentTurnPreparation>();

interface WorkbenchManifest {
  version: 1;
  sourceFiles: string[];
  shortcuts: Array<{ artifact: string; shortcut: string }>;
  preparedAt?: string;
  finalizedAt?: string;
}

interface UserViewManifest {
  version: 1;
  entries: Array<{
    shortcut: string;
    target: string;
    aiWorkRoot: string;
    updatedAt: string;
  }>;
}

export interface WorkspaceWorkbenchPrepareResult {
  sourceRoot: string;
  aiWorkRoot: string;
  sourceCopyRoot: string;
  copied: number;
  unchanged: number;
  removed: number;
  scanned: number;
  truncated: boolean;
  readmePath: string;
  mode?: 'initial' | 'incremental';
}

export interface WorkspaceWorkbenchProgress {
  phase: 'scanning' | 'synchronizing' | 'cleaning' | 'finalizing';
  message: string;
  scanned?: number;
  total?: number;
  copied?: number;
  unchanged?: number;
  removed?: number;
  mode?: 'initial' | 'incremental';
}

export interface WorkspaceWorkbenchPrepareOptions {
  maxSourceFiles?: number;
  shortcutWriter?: WorkspaceShortcutWriter;
  sourceSyncConcurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: WorkspaceWorkbenchProgress) => void;
}

interface SharedAgentTurnPreparation {
  controller: AbortController;
  promise: Promise<WorkspaceWorkbenchPrepareResult>;
  waiters: Set<symbol>;
  progressListeners: Map<symbol, (progress: WorkspaceWorkbenchProgress) => void>;
  settled: boolean;
}

export interface UserViewShortcutResult {
  sourcePath: string;
  shortcutPath: string;
  relativePath: string;
  created: boolean;
  error?: string;
}

export interface WorkspaceWorkbenchFinalizeResult {
  readmePath: string;
  userViewRoot: string;
  shortcuts: UserViewShortcutResult[];
}

export interface WorkspaceUserViewReconcileResult extends WorkspaceWorkbenchFinalizeResult {
  artifactCount: number;
}

export interface WorkspaceProjectUserViewReconcileResult {
  userViewRoot: string;
  artifactCount: number;
  shortcuts: UserViewShortcutResult[];
  workbenchCount: number;
}

export type WorkspaceShortcutWriter = (shortcutPath: string, targetPath: string) => Promise<void>;

function isSubPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelative(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function createWorkspaceAbortError(): Error {
  const error = new Error('工作目录同步已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfWorkspacePreparationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createWorkspaceAbortError();
}

function reportWorkspaceProgress(
  options: WorkspaceWorkbenchPrepareOptions,
  progress: WorkspaceWorkbenchProgress,
): void {
  try {
    options.onProgress?.(progress);
  } catch (error) {
    logger.warn('[WorkspaceWorkbench] Progress listener failed:', error);
  }
}

function stripWorkbenchCategory(relativePath: string): string {
  const parts = normalizeRelative(relativePath).split('/').filter(Boolean);
  const first = String(parts[0] || '').toLowerCase();
  const removable = new Set([
    AI_WORKING_FILES_DIRECTORY_NAME.toLowerCase(),
    AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts.toLowerCase(),
    AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables.toLowerCase(),
    AI_WORKBENCH_OUTPUT_DIRECTORIES.framework.toLowerCase(),
    AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary.toLowerCase(),
    AI_WORKBENCH_OUTPUT_DIRECTORIES.other.toLowerCase(),
  ]);
  if (removable.has(first)) parts.shift();
  return parts.join('/');
}

export function resolveUserViewArtifactRelativePath(aiWorkRoot: string, sourcePath: string): string {
  const relativePath = normalizeRelative(path.relative(path.resolve(aiWorkRoot), path.resolve(sourcePath)));
  if (!relativePath || relativePath.startsWith('../')) return '';
  const extension = path.extname(relativePath).toLowerCase();
  const lowerRelative = relativePath.toLowerCase();
  const firstSegment = lowerRelative.split('/')[0] || '';
  const fileName = path.basename(relativePath).toLowerCase();
  const figureHint = /(^|\/)(figure|fig|plot|chart)[-_\s]*\d*([^/]*)?(\/|$)/i.test(lowerRelative);
  const categoryRelative = stripWorkbenchCategory(relativePath) || path.basename(relativePath);

  if (PRIMARY_WORD_DELIVERABLE_NAMES.has(fileName)) {
    return normalizeRelative(path.join(USER_VIEW_OUTPUT_DIRECTORIES.drafts, fileName));
  }
  if (firstSegment === AI_WORKBENCH_OUTPUT_DIRECTORIES.framework.toLowerCase()) {
    return normalizeRelative(path.join(USER_VIEW_OUTPUT_DIRECTORIES.framework, categoryRelative));
  }
  if (firstSegment === AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary.toLowerCase()) {
    return normalizeRelative(path.join(USER_VIEW_OUTPUT_DIRECTORIES.supplementary, categoryRelative));
  }
  if (
    firstSegment === AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables.toLowerCase()
    || (figureHint && USER_VIEW_FIGURE_SUPPORT_EXTENSIONS.has(extension))
  ) {
    return normalizeRelative(path.join(USER_VIEW_OUTPUT_DIRECTORIES.figures, categoryRelative));
  }
  return normalizeRelative(path.join(USER_VIEW_OUTPUT_DIRECTORIES.other, categoryRelative));
}

function manifestPath(aiWorkRoot: string): string {
  return path.join(aiWorkRoot, WORKBENCH_MANIFEST_NAME);
}

async function readManifest(aiWorkRoot: string): Promise<WorkbenchManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath(aiWorkRoot), 'utf-8')) as Partial<WorkbenchManifest>;
    return {
      version: 1,
      sourceFiles: Array.isArray(parsed.sourceFiles) ? parsed.sourceFiles.map(normalizeRelative).filter(Boolean) : [],
      shortcuts: Array.isArray(parsed.shortcuts)
        ? parsed.shortcuts
            .map(item => ({
              artifact: normalizeRelative(String(item?.artifact || '')),
              shortcut: normalizeRelative(String(item?.shortcut || '')),
            }))
            .filter(item => item.artifact && item.shortcut)
        : [],
      preparedAt: parsed.preparedAt,
      finalizedAt: parsed.finalizedAt,
    };
  } catch {
    return { version: 1, sourceFiles: [], shortcuts: [] };
  }
}

async function writeManifest(aiWorkRoot: string, manifest: WorkbenchManifest): Promise<void> {
  const target = manifestPath(aiWorkRoot);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
}

export function resolveUserViewHostRoot(sourceRoot: string, aiWorkRoot: string): string {
  const root = path.resolve(sourceRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  let cursor = aiRoot;
  while (true) {
    if (path.basename(cursor).toLowerCase() === AI_WORKSPACE_CONTAINER_NAME.toLowerCase()) {
      const containerParent = path.dirname(cursor);
      if (isSubPath(root, aiRoot) || isSubPath(aiRoot, root)) return containerParent;
      break;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (path.basename(root).toLowerCase() === AI_WORKSPACE_CONTAINER_NAME.toLowerCase()) {
    return path.dirname(root);
  }
  return root;
}

function userViewManifestPath(userViewHostRoot: string): string {
  return path.join(path.resolve(userViewHostRoot), AI_WORKSPACE_CONTAINER_NAME, USER_VIEW_MANIFEST_NAME);
}

async function ensureUserViewLayout(userViewHostRoot: string): Promise<string> {
  const userViewRoot = path.join(path.resolve(userViewHostRoot), USER_VIEW_DIRECTORY_NAME);
  await Promise.all([
    fs.mkdir(userViewRoot, { recursive: true }),
    ...Object.values(USER_VIEW_OUTPUT_DIRECTORIES)
      .map(directory => fs.mkdir(path.join(userViewRoot, directory), { recursive: true })),
  ]);
  return userViewRoot;
}

async function readUserViewManifest(sourceRoot: string): Promise<UserViewManifest> {
  try {
    const parsed = JSON.parse(await fs.readFile(userViewManifestPath(sourceRoot), 'utf-8')) as Partial<UserViewManifest>;
    return {
      version: 1,
      entries: Array.isArray(parsed.entries)
        ? parsed.entries.map(item => ({
            shortcut: normalizeRelative(String(item?.shortcut || '')),
            target: String(item?.target || '').trim(),
            aiWorkRoot: String(item?.aiWorkRoot || '').trim(),
            updatedAt: String(item?.updatedAt || ''),
          })).filter(item => item.shortcut && item.target && item.aiWorkRoot).map(item => ({
            ...item,
            target: path.resolve(item.target),
            aiWorkRoot: path.resolve(item.aiWorkRoot),
          }))
        : [],
    };
  } catch {
    return { version: 1, entries: [] };
  }
}

async function writeUserViewManifest(sourceRoot: string, manifest: UserViewManifest): Promise<void> {
  const target = userViewManifestPath(sourceRoot);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  await fs.rm(target, { force: true });
  await fs.rename(temporary, target);
}

async function withUserViewManifestLock<T>(sourceRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(sourceRoot).toLowerCase();
  const previous = userViewManifestLocks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const queued = previous.then(() => current);
  userViewManifestLocks.set(key, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (userViewManifestLocks.get(key) === queued) userViewManifestLocks.delete(key);
  }
}

async function listSourceFiles(
  sourceRoot: string,
  maxFiles: number,
  options: WorkspaceWorkbenchPrepareOptions = {},
): Promise<{ files: Array<{ absolutePath: string; relativePath: string }>; truncated: boolean }> {
  const root = path.resolve(sourceRoot);
  const excluded = new Set([
    path.resolve(root, AI_WORKSPACE_CONTAINER_NAME).toLowerCase(),
    path.resolve(root, USER_VIEW_DIRECTORY_NAME).toLowerCase(),
  ]);
  const files: Array<{ absolutePath: string; relativePath: string }> = [];
  const pending = [root];
  let truncated = false;

  while (pending.length && files.length < maxFiles) {
    throwIfWorkspacePreparationAborted(options.signal);
    const directory = pending.shift()!;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      throwIfWorkspacePreparationAborted(options.signal);
      if (files.length >= maxFiles) {
        truncated = true;
        break;
      }
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          shouldSkipWorkspaceSourceDirectory(entry.name)
          || excluded.has(path.resolve(absolutePath).toLowerCase())
        ) continue;
        pending.push(absolutePath);
      } else if (entry.isFile()) {
        if (shouldSkipWorkspaceSourceFile(entry.name)) continue;
        files.push({
          absolutePath,
          relativePath: normalizeRelative(path.relative(root, absolutePath)),
        });
        if (files.length === 1 || files.length % 250 === 0) {
          reportWorkspaceProgress(options, {
            phase: 'scanning',
            message: `正在扫描工作目录：已发现 ${files.length} 个项目文件…`,
            scanned: files.length,
            mode: 'initial',
          });
        }
      }
    }
  }
  if (pending.length) truncated = true;
  return { files, truncated };
}

async function forEachWithConcurrency<T>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(items.length || 1, concurrency));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      throwIfWorkspacePreparationAborted(signal);
      const item = items[nextIndex];
      nextIndex += 1;
      await operation(item);
    }
  }));
}

async function pruneEmptyParents(start: string, stop: string): Promise<void> {
  let current = path.resolve(start);
  const boundary = path.resolve(stop);
  while (current !== boundary && isSubPath(boundary, current)) {
    const entries = await fs.readdir(current).catch(() => null);
    if (!entries || entries.length > 0) return;
    await fs.rmdir(current).catch(() => undefined);
    current = path.dirname(current);
  }
}

async function listWorkbenchArtifacts(aiWorkRoot: string, maxFiles = 10_000): Promise<string[]> {
  const root = path.resolve(aiWorkRoot);
  const sourceCopyRoot = path.join(root, AI_SOURCE_COPY_DIRECTORY_NAME);
  const files: string[] = [];
  const pending = [root];
  while (pending.length && files.length < maxFiles) {
    const directory = pending.shift()!;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (
          entry.name === '.git'
          || path.resolve(absolutePath) === path.resolve(sourceCopyRoot)
          || entry.name === 'node_modules'
        ) continue;
        pending.push(absolutePath);
      } else if (
        entry.isFile()
        && entry.name !== AI_WORKSPACE_README_NAME
        && entry.name !== WORKBENCH_MANIFEST_NAME
      ) {
        files.push(absolutePath);
      }
      if (files.length >= maxFiles) break;
    }
  }
  return filterUserFacingWorkspaceOutputPaths(files);
}

function isCanonicalWorkbenchArtifact(aiWorkRoot: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(aiWorkRoot), path.resolve(filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  const firstSegment = relative.split(/[\\/]+/)[0].toLowerCase();
  return [
    AI_WORKING_FILES_DIRECTORY_NAME,
    ...Object.values(AI_WORKBENCH_OUTPUT_DIRECTORIES),
  ].some(directory => directory.toLowerCase() === firstSegment);
}

function assertValidWorkspaceWorkbenchRoot(sourceRoot: string, aiWorkRoot: string): void {
  const root = path.resolve(sourceRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  if (!isSubPath(root, aiRoot) || !path.relative(root, aiRoot).split(/[\\/]+/).some(
    segment => segment.toLowerCase() === AI_WORKSPACE_CONTAINER_NAME.toLowerCase(),
  )) {
    throw new Error('AI 工作台必须位于用户目录的 ScholarHarness_AI_Workspaces 容器内');
  }
}

async function writeWorkbenchReadme(
  sourceRoot: string,
  aiWorkRoot: string,
  sourceFileCount: number,
  artifacts: string[],
  shortcutCount: number,
): Promise<string> {
  const readmePath = path.join(aiWorkRoot, AI_WORKSPACE_README_NAME);
  const artifactRows = artifacts
    .slice(0, 80)
    .map(filePath => `- ${normalizeRelative(path.relative(aiWorkRoot, filePath))}`);
  const content = [
    '# Scholar Harness AI 工作台',
    '',
    `更新时间：${new Date().toISOString()}`,
    `用户源目录：${path.resolve(sourceRoot)}`,
    `本轮源文件副本：${sourceFileCount} 个`,
    `用户查看快捷方式：${shortcutCount} 个`,
    '',
    '## 三层文件规则',
    '',
    `1. 用户源目录只读。AI 不得修改、移动或删除源文件。`,
    `2. ${AI_SOURCE_COPY_DIRECTORY_NAME}/ 首次建立经过缓存/临时文件过滤的源文件副本；后续回合只增量刷新已记录文件，新文件在 Agent 明确读取时按需复制。`,
    `3. ${AI_WORKING_FILES_DIRECTORY_NAME}/ 保存从源文件派生的可继续修改版本；用户通过与 ${AI_WORKSPACE_CONTAINER_NAME}/ 平行的“${USER_VIEW_DIRECTORY_NAME}”打开最新文件。`,
    `4. “${USER_VIEW_DIRECTORY_NAME}/${USER_VIEW_OUTPUT_DIRECTORIES.drafts}”只放 paper-draft.docx、figures_tables.docx、supplementary-materials.docx；“${USER_VIEW_DIRECTORY_NAME}/${USER_VIEW_OUTPUT_DIRECTORIES.figures}”放正文图表及其 PNG/PDF/R/Python/Excel/TXT 等配套文件；“${USER_VIEW_DIRECTORY_NAME}/${USER_VIEW_OUTPUT_DIRECTORIES.framework}”放论文框架；“${USER_VIEW_DIRECTORY_NAME}/${USER_VIEW_OUTPUT_DIRECTORIES.supplementary}”放补充材料；其余文件进入 ${USER_VIEW_OUTPUT_DIRECTORIES.other}/。`,
    '5. 修改科研图片必须修改源数据或生成代码并重新运行出图；禁止直接在 PNG/JPG/TIFF 成品图上涂改、拼贴、覆盖文字、擦除元素或补丁式 P 图。视觉检查只用于诊断与复核。',
    '6. 查找文件时同时比较创建时间和最后修改时间；用户没有精确指定文件名时，默认使用相关候选中的最新文件，不能按文件名或目录顺序猜测。',
    '7. 面向用户持续维护三个主要 Word：paper-draft.docx（论文草稿）、figures_tables.docx（正文图表）、supplementary-materials.docx（补充材料）。有相关内容变化就更新；某轮没有相关变化时保留已有版本，禁止删除、改名或用临时文件替代。figures_tables.docx 必须从项目全部历史会话累计的 figureN/tableN 源资产生成，禁止只用当前会话图表覆盖历史内容。',
    '8. figures_tables.docx 与 supplementary-materials.docx 中每个图片/表格都必须有标题、图注/表注，并写明对应源文件位置。',
    '',
    '## 规范输出目录',
    '',
    `- ${AI_WORKBENCH_OUTPUT_DIRECTORIES.framework}/：正文与章节框架`,
    `- ${AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts}/：论文草稿与 Word 正文`,
    `- ${AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables}/：图片、表格、作图代码与数据`,
    `- ${AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary}/：补充文件与补充 Word`,
    `- ${AI_WORKBENCH_OUTPUT_DIRECTORIES.other}/：其他最终产物`,
    '',
    '## 当前工作台产物',
    '',
    ...(artifactRows.length ? artifactRows : ['- 暂无']),
    '',
    '临时日志、缓存和逐页 QA 图片不会进入“用户查看”。',
    '',
  ].join('\n');
  await fs.writeFile(readmePath, content, 'utf-8');
  return readmePath;
}

export function resolveAiSourceCopyPath(sourceRoot: string, aiWorkRoot: string, sourcePath: string): string {
  const root = path.resolve(sourceRoot);
  const source = path.resolve(sourcePath);
  if (!isSubPath(root, source)) throw new Error('源文件超出用户配置目录');
  const target = path.resolve(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME, path.relative(root, source));
  if (!isSubPath(path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME), target)) {
    throw new Error('源文件副本目标超出 AI 工作台');
  }
  return target;
}

export function resolveAiWorkingFilePath(sourceRoot: string, aiWorkRoot: string, sourcePath: string): string {
  const root = path.resolve(sourceRoot);
  const source = path.resolve(sourcePath);
  if (!isSubPath(root, source)) throw new Error('工作文件来源超出用户配置目录');
  const target = path.resolve(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, path.relative(root, source));
  if (!isSubPath(path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME), target)) {
    throw new Error('工作文件目标超出 AI 工作台');
  }
  return target;
}

export function resolveProjectPrimaryDeliverablesRoot(aiWorkRoot: string): string {
  const resolved = path.resolve(aiWorkRoot);
  const projectRoot = path.basename(resolved).toLowerCase().startsWith('conversation-')
    ? path.dirname(resolved)
    : resolved;
  return path.join(projectRoot, PROJECT_PRIMARY_DELIVERABLES_DIRECTORY_NAME);
}

function primaryWordSourceCandidates(aiWorkRoot: string): Array<{ name: string; candidates: string[] }> {
  return [
    {
      name: PRIMARY_WORD_DELIVERABLES.draft,
      candidates: [
        path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, PRIMARY_WORD_DELIVERABLES.draft),
        path.join(aiWorkRoot, PRIMARY_WORD_DELIVERABLES.draft),
      ],
    },
    {
      name: PRIMARY_WORD_DELIVERABLES.mainFiguresTables,
      candidates: [
        path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables, PRIMARY_WORD_DELIVERABLES.mainFiguresTables),
      ],
    },
    {
      name: PRIMARY_WORD_DELIVERABLES.supplementary,
      candidates: [
        path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary, PRIMARY_WORD_DELIVERABLES.supplementary),
      ],
    },
  ];
}

async function refreshChangedFigureTableWords(aiWorkRoot: string, changedArtifacts: string[]): Promise<string[]> {
  const refreshed: string[] = [];
  const collections = [
    {
      directory: AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables,
      outputName: WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName,
      collection: 'main' as const,
    },
    {
      directory: AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary,
      outputName: WORKSPACE_ARTIFACT_LAYOUT.supplementaryDocxName,
      collection: 'supplementary' as const,
    },
  ];

  for (const item of collections) {
    const collectionRoot = path.join(aiWorkRoot, item.directory);
    const relevantChange = changedArtifacts.some(filePath => {
      const resolved = path.resolve(filePath);
      return isSubPath(collectionRoot, resolved)
        && path.basename(resolved).toLowerCase() !== item.outputName.toLowerCase();
    });
    if (!relevantChange) continue;
    try {
      const result = await buildIntegratedDocx(aiWorkRoot, {}, { collection: item.collection });
      const stat = await fs.stat(result.docxPath).catch(() => null);
      if (stat?.isFile()) refreshed.push(result.docxPath);
    } catch (error) {
      logger.warn(`[WorkspaceWorkbench] Unable to refresh ${item.outputName}`, error);
    }
  }
  return refreshed;
}

async function refreshProjectCumulativeFigureTableWords(aiWorkRoot: string): Promise<string[]> {
  const refreshed: string[] = [];
  for (const collection of ['main', 'supplementary'] as const) {
    try {
      const result = await buildIntegratedDocx(aiWorkRoot, {}, { collection });
      const stat = await fs.stat(result.docxPath).catch(() => null);
      if (stat?.isFile()) refreshed.push(result.docxPath);
    } catch (error) {
      logger.warn(`[WorkspaceWorkbench] Unable to reconcile cumulative ${collection} Word`, error);
    }
  }
  return refreshed;
}

async function synchronizeProjectCumulativeUserView(
  userViewHostRoot: string,
  aiWorkRoot: string,
  shortcutWriter?: WorkspaceShortcutWriter,
): Promise<UserViewShortcutResult[]> {
  const cumulativeRoot = resolveProjectCumulativeArtifactRoot(aiWorkRoot);
  if (path.resolve(cumulativeRoot) === path.resolve(aiWorkRoot)) return [];
  const stat = await fs.stat(cumulativeRoot).catch(() => null);
  if (!stat?.isDirectory()) return [];
  const artifacts = (await listWorkbenchArtifacts(cumulativeRoot))
    .filter(filePath => isCanonicalWorkbenchArtifact(cumulativeRoot, filePath));
  if (!artifacts.length) return [];
  return synchronizeUserViewShortcuts(userViewHostRoot, cumulativeRoot, artifacts, { shortcutWriter });
}

async function mirrorPrimaryWordDeliverables(aiWorkRoot: string): Promise<string[]> {
  const stableRoot = resolveProjectPrimaryDeliverablesRoot(aiWorkRoot);
  await fs.mkdir(stableRoot, { recursive: true });
  const mirrored: string[] = [];

  for (const deliverable of primaryWordSourceCandidates(aiWorkRoot)) {
    const existingSources = await Promise.all(deliverable.candidates.map(async candidate => ({
      path: candidate,
      stat: await fs.stat(candidate).catch(() => null),
    })));
    const latestSource = existingSources
      .filter((item): item is { path: string; stat: import('fs').Stats } => !!item.stat?.isFile())
      .sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs)[0];
    const stablePath = path.join(stableRoot, deliverable.name);
    if (latestSource) {
      const stableStat = await fs.stat(stablePath).catch(() => null);
      if (!stableStat?.isFile() || latestSource.stat.mtimeMs > stableStat.mtimeMs) {
        const temporary = `${stablePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.copyFile(latestSource.path, temporary);
        await fs.rm(stablePath, { force: true });
        await fs.rename(temporary, stablePath);
      }
    }
    const stableStat = await fs.stat(stablePath).catch(() => null);
    if (stableStat?.isFile()) mirrored.push(stablePath);
  }
  return mirrored;
}

export async function prepareWorkspaceWorkbench(
  sourceRoot: string,
  aiWorkRoot: string,
  options: WorkspaceWorkbenchPrepareOptions = {},
): Promise<WorkspaceWorkbenchPrepareResult> {
  throwIfWorkspacePreparationAborted(options.signal);
  const root = path.resolve(sourceRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  const userViewHostRoot = resolveUserViewHostRoot(root, aiRoot);
  assertValidWorkspaceWorkbenchRoot(root, aiRoot);
  const sourceCopyRoot = path.join(aiRoot, AI_SOURCE_COPY_DIRECTORY_NAME);
  await Promise.all([
    fs.mkdir(sourceCopyRoot, { recursive: true }),
    fs.mkdir(path.join(aiRoot, AI_WORKING_FILES_DIRECTORY_NAME), { recursive: true }),
    ...Object.values(AI_WORKBENCH_OUTPUT_DIRECTORIES).map(name => fs.mkdir(path.join(aiRoot, name), { recursive: true })),
    ensureUserViewLayout(userViewHostRoot),
  ]);

  reportWorkspaceProgress(options, {
    phase: 'scanning',
    message: '首次准备工作目录：正在排除缓存和临时文件…',
    scanned: 0,
    mode: 'initial',
  });
  const manifest = await readManifest(aiRoot);
  const maxFiles = Math.max(1, Math.min(100_000, Number(options.maxSourceFiles) || DEFAULT_MAX_SOURCE_FILES));
  const discovered = await listSourceFiles(root, maxFiles, options);
  const currentFiles = new Set(discovered.files.map(file => file.relativePath));
  let copied = 0;
  let unchanged = 0;
  let synchronized = 0;
  const sourceSyncConcurrency = Math.max(
    1,
    Math.min(16, Number(options.sourceSyncConcurrency) || DEFAULT_SOURCE_SYNC_CONCURRENCY),
  );
  await forEachWithConcurrency(discovered.files, sourceSyncConcurrency, async file => {
    throwIfWorkspacePreparationAborted(options.signal);
    const target = path.join(sourceCopyRoot, file.relativePath);
    const result = await synchronizeSourceFileToAiWorkspace(file.absolutePath, target, {
      // The synchronized copy receives the source mtime and size. Treat equal
      // metadata as the fast unchanged path; hashing every large PDF/DOCX/image
      // pair made every Agent follow-up scale with the whole project size.
      verifyContentWhenMetadataEqual: false,
    });
    if (result.copied) copied += 1;
    else unchanged += 1;
    synchronized += 1;
    if (synchronized === 1 || synchronized % 100 === 0 || synchronized === discovered.files.length) {
      reportWorkspaceProgress(options, {
        phase: 'synchronizing',
        message: `首次准备工作目录：已处理 ${synchronized}/${discovered.files.length} 个项目文件…`,
        scanned: synchronized,
        total: discovered.files.length,
        copied,
        unchanged,
        mode: 'initial',
      });
    }
  }, options.signal);

  let removed = 0;
  reportWorkspaceProgress(options, {
    phase: 'cleaning',
    message: '正在清理失效的派生副本…',
    total: manifest.sourceFiles.length,
    mode: 'initial',
  });
  for (const relativePath of manifest.sourceFiles) {
    throwIfWorkspacePreparationAborted(options.signal);
    if (currentFiles.has(relativePath)) continue;
    const stalePath = path.resolve(sourceCopyRoot, relativePath);
    if (!isSubPath(sourceCopyRoot, stalePath)) continue;
    const stat = await fs.stat(stalePath).catch(() => null);
    if (!stat?.isFile()) continue;
    await fs.rm(stalePath, { force: true });
    await pruneEmptyParents(path.dirname(stalePath), sourceCopyRoot);
    removed += 1;
  }

  manifest.sourceFiles = Array.from(currentFiles).sort();
  manifest.preparedAt = new Date().toISOString();
  throwIfWorkspacePreparationAborted(options.signal);
  await writeManifest(aiRoot, manifest);
  // Agent submission must not wait for a project-wide rebuild of Windows
  // shortcuts. Existing outputs are only indexed here for the README; each
  // newly generated/published artifact updates its own user-facing entry.
  const artifacts = await listWorkbenchArtifacts(aiRoot);
  throwIfWorkspacePreparationAborted(options.signal);
  const readmePath = await writeWorkbenchReadme(
    root,
    aiRoot,
    manifest.sourceFiles.length,
    artifacts,
    manifest.shortcuts.length,
  );
  reportWorkspaceProgress(options, {
    phase: 'finalizing',
    message: `工作目录首次准备完成：${discovered.files.length} 个项目文件，已跳过缓存和临时文件。`,
    scanned: discovered.files.length,
    total: discovered.files.length,
    copied,
    unchanged,
    removed,
    mode: 'initial',
  });
  logger.info('[WorkspaceWorkbench] Prepared three-layer workspace', {
    sourceRoot: root,
    aiWorkRoot: aiRoot,
    copied,
    unchanged,
    removed,
  });
  return {
    sourceRoot: root,
    aiWorkRoot: aiRoot,
    sourceCopyRoot,
    copied,
    unchanged,
    removed,
    scanned: discovered.files.length,
    truncated: discovered.truncated,
    readmePath,
    mode: 'initial',
  };
}

async function refreshWorkspaceWorkbenchIncrementally(
  sourceRoot: string,
  aiWorkRoot: string,
  options: WorkspaceWorkbenchPrepareOptions,
): Promise<WorkspaceWorkbenchPrepareResult> {
  throwIfWorkspacePreparationAborted(options.signal);
  const root = path.resolve(sourceRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  assertValidWorkspaceWorkbenchRoot(root, aiRoot);
  const sourceCopyRoot = path.join(aiRoot, AI_SOURCE_COPY_DIRECTORY_NAME);
  await fs.mkdir(sourceCopyRoot, { recursive: true });
  const manifest = await readManifest(aiRoot);
  if (!manifest.preparedAt) {
    return prepareWorkspaceWorkbench(root, aiRoot, options);
  }

  const recordedFiles = Array.from(new Set(manifest.sourceFiles.map(normalizeRelative).filter(Boolean)));
  const sourceSyncConcurrency = Math.max(
    1,
    Math.min(16, Number(options.sourceSyncConcurrency) || DEFAULT_SOURCE_SYNC_CONCURRENCY),
  );
  const retainedFiles = new Set<string>();
  let processed = 0;
  let copied = 0;
  let unchanged = 0;
  let removed = 0;
  reportWorkspaceProgress(options, {
    phase: 'scanning',
    message: `正在检查 ${recordedFiles.length} 个已记录项目文件的变化…`,
    scanned: 0,
    total: recordedFiles.length,
    mode: 'incremental',
  });

  await forEachWithConcurrency(recordedFiles, sourceSyncConcurrency, async relativePath => {
    throwIfWorkspacePreparationAborted(options.signal);
    const target = path.resolve(sourceCopyRoot, relativePath);
    if (!isSubPath(sourceCopyRoot, target)) return;
    const sourcePath = path.resolve(root, relativePath);
    const sourceStat = isSubPath(root, sourcePath)
      ? await fs.stat(sourcePath).catch(() => null)
      : null;
    if (shouldSkipWorkspaceSourceRelativePath(relativePath) || !sourceStat?.isFile()) {
      const targetStat = await fs.stat(target).catch(() => null);
      if (targetStat?.isFile()) {
        await fs.rm(target, { force: true });
        await pruneEmptyParents(path.dirname(target), sourceCopyRoot);
        removed += 1;
      }
    } else {
      const result = await synchronizeSourceFileToAiWorkspace(sourcePath, target, {
        verifyContentWhenMetadataEqual: false,
      });
      retainedFiles.add(relativePath);
      if (result.copied) copied += 1;
      else unchanged += 1;
    }
    processed += 1;
    if (processed === 1 || processed % 100 === 0 || processed === recordedFiles.length) {
      reportWorkspaceProgress(options, {
        phase: 'synchronizing',
        message: `正在增量同步工作目录：${processed}/${recordedFiles.length}，更新 ${copied} 个…`,
        scanned: processed,
        total: recordedFiles.length,
        copied,
        unchanged,
        removed,
        mode: 'incremental',
      });
    }
  }, options.signal);

  throwIfWorkspacePreparationAborted(options.signal);
  manifest.sourceFiles = Array.from(retainedFiles).sort();
  manifest.preparedAt = new Date().toISOString();
  await writeManifest(aiRoot, manifest);
  const readmePath = path.join(aiRoot, AI_WORKSPACE_README_NAME);
  reportWorkspaceProgress(options, {
    phase: 'finalizing',
    message: `工作目录增量同步完成：检查 ${processed} 个，更新 ${copied} 个，清理 ${removed} 个。`,
    scanned: processed,
    total: recordedFiles.length,
    copied,
    unchanged,
    removed,
    mode: 'incremental',
  });
  logger.info('[WorkspaceWorkbench] Incremental source snapshot refreshed', {
    sourceRoot: root,
    aiWorkRoot: aiRoot,
    scanned: processed,
    copied,
    unchanged,
    removed,
  });
  return {
    sourceRoot: root,
    aiWorkRoot: aiRoot,
    sourceCopyRoot,
    copied,
    unchanged,
    removed,
    scanned: processed,
    truncated: false,
    readmePath,
    mode: 'incremental',
  };
}

async function prepareAgentTurnWorkspaceInternal(
  sourceRoot: string,
  aiWorkRoot: string,
  options: WorkspaceWorkbenchPrepareOptions,
): Promise<WorkspaceWorkbenchPrepareResult> {
  const manifest = await readManifest(path.resolve(aiWorkRoot));
  return manifest.preparedAt
    ? refreshWorkspaceWorkbenchIncrementally(sourceRoot, aiWorkRoot, options)
    : prepareWorkspaceWorkbench(sourceRoot, aiWorkRoot, options);
}

/**
 * Prepare an Agent turn without repeating a full source-tree mirror.
 * Concurrent callers for the same source/workbench pair share one operation;
 * the shared operation is cancelled only after every waiter has cancelled.
 */
export async function prepareWorkspaceWorkbenchForAgentTurn(
  sourceRoot: string,
  aiWorkRoot: string,
  options: WorkspaceWorkbenchPrepareOptions = {},
): Promise<WorkspaceWorkbenchPrepareResult> {
  throwIfWorkspacePreparationAborted(options.signal);
  const root = path.resolve(sourceRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  const key = `${root.toLowerCase()}\u0000${aiRoot.toLowerCase()}`;
  let entry = agentTurnPreparationEntries.get(key);
  if (!entry) {
    const controller = new AbortController();
    entry = {
      controller,
      promise: Promise.resolve(null as unknown as WorkspaceWorkbenchPrepareResult),
      waiters: new Set(),
      progressListeners: new Map(),
      settled: false,
    };
    const sharedEntry = entry;
    const sharedOptions: WorkspaceWorkbenchPrepareOptions = {
      ...options,
      signal: controller.signal,
      onProgress: progress => {
        for (const listener of sharedEntry.progressListeners.values()) {
          try {
            listener(progress);
          } catch (error) {
            logger.warn('[WorkspaceWorkbench] Shared progress listener failed:', error);
          }
        }
      },
    };
    entry.promise = Promise.resolve()
      .then(() => prepareAgentTurnWorkspaceInternal(root, aiRoot, sharedOptions))
      .finally(() => {
        sharedEntry.settled = true;
        if (agentTurnPreparationEntries.get(key) === sharedEntry) {
          agentTurnPreparationEntries.delete(key);
        }
      });
    agentTurnPreparationEntries.set(key, entry);
  }

  const waiter = Symbol('workspace-preparation-waiter');
  entry.waiters.add(waiter);
  if (options.onProgress) entry.progressListeners.set(waiter, options.onProgress);
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    entry!.waiters.delete(waiter);
    entry!.progressListeners.delete(waiter);
    if (!entry!.settled && entry!.waiters.size === 0) entry!.controller.abort();
  };

  if (!options.signal) {
    try {
      return await entry.promise;
    } finally {
      release();
    }
  }

  return await new Promise<WorkspaceWorkbenchPrepareResult>((resolve, reject) => {
    const handleAbort = (): void => {
      release();
      reject(createWorkspaceAbortError());
    };
    options.signal!.addEventListener('abort', handleAbort, { once: true });
    if (options.signal!.aborted) {
      handleAbort();
      return;
    }
    entry!.promise.then(resolve, reject).finally(() => {
      options.signal!.removeEventListener('abort', handleAbort);
      release();
    });
  });
}

/**
 * Rebuild the user-facing shortcut view without refreshing the potentially
 * large source snapshot. Safe to call when the app opens or switches chats.
 */
export async function reconcileWorkspaceUserView(
  sourceRoot: string,
  aiWorkRoot: string,
  options: {
    artifacts?: string[];
    publishArtifacts?: string[];
    shortcutWriter?: WorkspaceShortcutWriter;
    refreshCumulativeWords?: boolean;
  } = {},
): Promise<WorkspaceUserViewReconcileResult> {
  const root = path.resolve(sourceRoot);
  const aiRoot = path.resolve(aiWorkRoot);
  const userViewHostRoot = resolveUserViewHostRoot(root, aiRoot);
  assertValidWorkspaceWorkbenchRoot(root, aiRoot);
  await ensureUserViewLayout(userViewHostRoot);
  const artifacts = options.artifacts || await listWorkbenchArtifacts(aiRoot);
  const candidates = (options.publishArtifacts || artifacts)
    .filter(filePath => isCanonicalWorkbenchArtifact(aiRoot, filePath));
  const shortcuts = await synchronizeUserViewShortcuts(root, aiRoot, candidates, {
    shortcutWriter: options.shortcutWriter,
  });
  if (options.refreshCumulativeWords !== false) {
    await refreshProjectCumulativeFigureTableWords(aiRoot);
  }
  shortcuts.push(...await synchronizeProjectCumulativeUserView(
    userViewHostRoot,
    aiRoot,
    options.shortcutWriter,
  ));
  const stableArtifacts = await mirrorPrimaryWordDeliverables(aiRoot);
  if (stableArtifacts.length > 0) {
    shortcuts.push(...await synchronizeUserViewShortcuts(
      userViewHostRoot,
      resolveProjectPrimaryDeliverablesRoot(aiRoot),
      stableArtifacts,
      { shortcutWriter: options.shortcutWriter },
    ));
  }
  const manifest = await readManifest(aiRoot);
  const readmePath = await writeWorkbenchReadme(
    root,
    aiRoot,
    manifest.sourceFiles.length,
    artifacts,
    manifest.shortcuts.length,
  );
  return {
    readmePath,
    userViewRoot: path.join(userViewHostRoot, USER_VIEW_DIRECTORY_NAME),
    shortcuts,
    artifactCount: candidates.length,
  };
}

/**
 * Reconcile every historical conversation under the current project. When
 * conversations contain the same relative deliverable, only the newest
 * on-disk version owns the user-facing shortcut.
 */
export async function reconcileWorkspaceProjectUserView(
  sourceRoot: string,
  currentAiWorkRoot: string,
  options: { shortcutWriter?: WorkspaceShortcutWriter } = {},
): Promise<WorkspaceProjectUserViewReconcileResult> {
  const root = path.resolve(sourceRoot);
  const currentRoot = path.resolve(currentAiWorkRoot);
  const userViewHostRoot = resolveUserViewHostRoot(root, currentRoot);
  assertValidWorkspaceWorkbenchRoot(root, currentRoot);
  const projectRoot = path.basename(currentRoot).toLowerCase().startsWith('conversation-')
    ? path.dirname(currentRoot)
    : currentRoot;
  const entries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const workbenchRoots = entries
    .filter(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith('conversation-'))
    .map(entry => path.join(projectRoot, entry.name));
  const existingCurrent = await fs.stat(currentRoot).catch(() => null);
  if (existingCurrent?.isDirectory() && !workbenchRoots.some(item => path.resolve(item) === currentRoot)) {
    workbenchRoots.push(currentRoot);
  }

  const artifactsByRoot = new Map<string, string[]>();
  const newestByRelative = new Map<string, { aiWorkRoot: string; filePath: string; mtimeMs: number }>();
  for (const aiWorkRoot of workbenchRoots) {
    const artifacts = await listWorkbenchArtifacts(aiWorkRoot);
    artifactsByRoot.set(aiWorkRoot, artifacts);
    for (const filePath of artifacts.filter(item => isCanonicalWorkbenchArtifact(aiWorkRoot, item))) {
      const relativePath = normalizeRelative(path.relative(aiWorkRoot, filePath));
      const stat = await fs.stat(filePath).catch(() => null);
      if (!stat?.isFile()) continue;
      const existing = newestByRelative.get(relativePath);
      if (!existing || stat.mtimeMs > existing.mtimeMs) {
        newestByRelative.set(relativePath, { aiWorkRoot, filePath, mtimeMs: stat.mtimeMs });
      }
    }
  }

  const selectedByRoot = new Map<string, string[]>();
  newestByRelative.forEach(item => {
    const selected = selectedByRoot.get(item.aiWorkRoot) || [];
    selected.push(item.filePath);
    selectedByRoot.set(item.aiWorkRoot, selected);
  });
  const shortcuts: UserViewShortcutResult[] = [];
  for (const [aiWorkRoot, publishArtifacts] of selectedByRoot.entries()) {
    const result = await reconcileWorkspaceUserView(root, aiWorkRoot, {
      artifacts: artifactsByRoot.get(aiWorkRoot) || publishArtifacts,
      publishArtifacts,
      shortcutWriter: options.shortcutWriter,
    });
    shortcuts.push(...result.shortcuts);
  }
  const stableRoot = resolveProjectPrimaryDeliverablesRoot(currentRoot);
  const stableArtifacts = Object.values(PRIMARY_WORD_DELIVERABLES)
    .map(fileName => path.join(stableRoot, fileName));
  const existingStableArtifacts: string[] = [];
  for (const filePath of stableArtifacts) {
    const stat = await fs.stat(filePath).catch(() => null);
    if (stat?.isFile()) existingStableArtifacts.push(filePath);
  }
  if (existingStableArtifacts.length > 0) {
    shortcuts.push(...await synchronizeUserViewShortcuts(userViewHostRoot, stableRoot, existingStableArtifacts, {
      shortcutWriter: options.shortcutWriter,
    }));
  }
  if (selectedByRoot.size === 0) await ensureUserViewLayout(userViewHostRoot);
  return {
    userViewRoot: path.join(userViewHostRoot, USER_VIEW_DIRECTORY_NAME),
    artifactCount: newestByRelative.size + existingStableArtifacts.length,
    shortcuts,
    workbenchCount: workbenchRoots.length,
  };
}

async function defaultShortcutWriter(shortcutPath: string, targetPath: string): Promise<void> {
  if (process.platform !== 'win32') {
    await fs.rm(shortcutPath, { force: true });
    await fs.symlink(targetPath, shortcutPath, 'file');
    return;
  }
  const script = [
    "$shortcutPath = [Environment]::GetEnvironmentVariable('SCHOLAR_HARNESS_SHORTCUT_PATH')",
    "$targetPath = [Environment]::GetEnvironmentVariable('SCHOLAR_HARNESS_SHORTCUT_TARGET')",
    '$shell = New-Object -ComObject WScript.Shell',
    '$shortcut = $shell.CreateShortcut($shortcutPath)',
    '$shortcut.TargetPath = $targetPath',
    '$shortcut.WorkingDirectory = Split-Path -Parent $targetPath',
    '$shortcut.Save()',
  ].join('\r\n');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const windowsRoot = String(process.env.SystemRoot || 'C:\\Windows');
  const executable = path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        ...process.env,
        SCHOLAR_HARNESS_SHORTCUT_PATH: shortcutPath,
        SCHOLAR_HARNESS_SHORTCUT_TARGET: targetPath,
      },
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `PowerShell ${code}`)));
  });
}

export async function synchronizeUserViewShortcuts(
  sourceRoot: string,
  aiWorkRoot: string,
  artifactPaths: string[],
  options: { shortcutWriter?: WorkspaceShortcutWriter } = {},
): Promise<UserViewShortcutResult[]> {
  const aiRoot = path.resolve(aiWorkRoot);
  const userViewHostRoot = resolveUserViewHostRoot(sourceRoot, aiRoot);
  const sourceCopyRoot = path.join(aiRoot, AI_SOURCE_COPY_DIRECTORY_NAME);
  const userViewRoot = await ensureUserViewLayout(userViewHostRoot);
  const shortcutWriter = options.shortcutWriter || defaultShortcutWriter;
  const candidates = Array.from(new Set(filterUserFacingWorkspaceOutputPaths(artifactPaths)
    .map(filePath => path.resolve(String(filePath || '').trim()))
    .filter(filePath => isSubPath(aiRoot, filePath) && !isSubPath(sourceCopyRoot, filePath))));
  return withUserViewManifestLock(userViewHostRoot, async () => {
    const manifest = await readManifest(aiRoot);
    const globalManifest = await readUserViewManifest(userViewHostRoot);
    const byArtifact = new Map(manifest.shortcuts.map(item => [item.artifact, item]));
    const byShortcut = new Map(globalManifest.entries.map(item => [item.shortcut, item]));
    const results: UserViewShortcutResult[] = [];

    for (const sourcePath of candidates) {
      const stat = await fs.stat(sourcePath).catch(() => null);
      if (!stat?.isFile()) continue;
      const relativePath = normalizeRelative(path.relative(aiRoot, sourcePath));
      if (!relativePath || relativePath === AI_WORKSPACE_README_NAME || relativePath === WORKBENCH_MANIFEST_NAME) continue;
      const publishedRelativePath = resolveUserViewArtifactRelativePath(aiRoot, sourcePath);
      if (!publishedRelativePath) continue;
      const shortcutRelative = process.platform === 'win32' ? `${publishedRelativePath}.lnk` : publishedRelativePath;
      const shortcutPath = path.resolve(userViewRoot, shortcutRelative);
      if (!isSubPath(userViewRoot, shortcutPath)) continue;
      try {
        const previousArtifactEntry = byArtifact.get(relativePath);
        if (previousArtifactEntry && previousArtifactEntry.shortcut !== shortcutRelative) {
          const previousOwner = byShortcut.get(previousArtifactEntry.shortcut);
          const ownedByThisArtifact = previousOwner
            && path.resolve(previousOwner.target).toLowerCase() === sourcePath.toLowerCase()
            && path.resolve(previousOwner.aiWorkRoot).toLowerCase() === aiRoot.toLowerCase();
          if (ownedByThisArtifact) {
            const previousShortcutPath = path.resolve(userViewRoot, previousArtifactEntry.shortcut);
            if (isSubPath(userViewRoot, previousShortcutPath)) {
              await fs.rm(previousShortcutPath, { force: true }).catch(() => undefined);
              await pruneEmptyParents(path.dirname(previousShortcutPath), userViewRoot);
            }
            byShortcut.delete(previousArtifactEntry.shortcut);
          }
        }
        const currentOwner = byShortcut.get(shortcutRelative);
        const shortcutStat = await fs.stat(shortcutPath).catch(() => null);
        const alreadyCurrent = !!currentOwner
          && path.resolve(currentOwner.target).toLowerCase() === sourcePath.toLowerCase()
          && path.resolve(currentOwner.aiWorkRoot).toLowerCase() === aiRoot.toLowerCase()
          && !!shortcutStat;
        if (alreadyCurrent) {
          byArtifact.set(relativePath, { artifact: relativePath, shortcut: shortcutRelative });
          results.push({ sourcePath, shortcutPath, relativePath, created: true });
          continue;
        }
        await fs.mkdir(path.dirname(shortcutPath), { recursive: true });
        await fs.rm(shortcutPath, { force: true });
        await shortcutWriter(shortcutPath, sourcePath);
        byArtifact.set(relativePath, { artifact: relativePath, shortcut: shortcutRelative });
        byShortcut.set(shortcutRelative, {
          shortcut: shortcutRelative,
          target: sourcePath,
          aiWorkRoot: aiRoot,
          updatedAt: new Date().toISOString(),
        });
        results.push({ sourcePath, shortcutPath, relativePath, created: true });
      } catch (error) {
        results.push({
          sourcePath,
          shortcutPath,
          relativePath,
          created: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    for (const [artifact, item] of Array.from(byArtifact.entries())) {
      const targetPath = path.resolve(aiRoot, artifact);
      const targetStat = await fs.stat(targetPath).catch(() => null);
      if (targetStat?.isFile()) continue;
      const owner = byShortcut.get(item.shortcut);
      const stillOwnedByThisArtifact = owner
        && path.resolve(owner.target).toLowerCase() === targetPath.toLowerCase()
        && path.resolve(owner.aiWorkRoot).toLowerCase() === aiRoot.toLowerCase();
      if (stillOwnedByThisArtifact) {
        const shortcutPath = path.resolve(userViewRoot, item.shortcut);
        if (isSubPath(userViewRoot, shortcutPath)) await fs.rm(shortcutPath, { force: true }).catch(() => undefined);
        byShortcut.delete(item.shortcut);
      }
      byArtifact.delete(artifact);
    }
    manifest.shortcuts = Array.from(byArtifact.values()).sort((left, right) => left.artifact.localeCompare(right.artifact));
    manifest.finalizedAt = new Date().toISOString();
    globalManifest.entries = Array.from(byShortcut.values()).sort((left, right) => left.shortcut.localeCompare(right.shortcut));
    await Promise.all([
      writeManifest(aiRoot, manifest),
      writeUserViewManifest(userViewHostRoot, globalManifest),
    ]);
    return results;
  });
}

export async function finalizeWorkspaceWorkbench(
  sourceRoot: string,
  aiWorkRoot: string,
  changedArtifacts: string[],
  options: { shortcutWriter?: WorkspaceShortcutWriter } = {},
): Promise<WorkspaceWorkbenchFinalizeResult> {
  const userViewHostRoot = resolveUserViewHostRoot(sourceRoot, aiWorkRoot);
  const refreshedWords = await refreshChangedFigureTableWords(aiWorkRoot, changedArtifacts);
  const currentArtifacts = Array.from(new Set([...changedArtifacts, ...refreshedWords]));
  const shortcuts = await synchronizeUserViewShortcuts(sourceRoot, aiWorkRoot, currentArtifacts, options);
  shortcuts.push(...await synchronizeProjectCumulativeUserView(
    userViewHostRoot,
    aiWorkRoot,
    options.shortcutWriter,
  ));
  const stableArtifacts = await mirrorPrimaryWordDeliverables(aiWorkRoot);
  if (stableArtifacts.length > 0) {
    shortcuts.push(...await synchronizeUserViewShortcuts(
      userViewHostRoot,
      resolveProjectPrimaryDeliverablesRoot(aiWorkRoot),
      stableArtifacts,
      options,
    ));
  }
  const manifest = await readManifest(aiWorkRoot);
  const artifacts = await listWorkbenchArtifacts(aiWorkRoot);
  const readmePath = await writeWorkbenchReadme(
    sourceRoot,
    aiWorkRoot,
    manifest.sourceFiles.length,
    artifacts,
    manifest.shortcuts.length,
  );
  return {
    readmePath,
    userViewRoot: path.join(userViewHostRoot, USER_VIEW_DIRECTORY_NAME),
    shortcuts,
  };
}
