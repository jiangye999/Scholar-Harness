import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';

/**
 * Project-level conclusion memory (P1).
 *
 * The file workspace is conversation-scoped (one COW copy per conversation), so
 * "what did we figure out last time" used to be trapped inside a dead
 * conversation. This service persists a small, append-only conclusion log per
 * user workspace root, keyed by a hash of that root, so a NEW conversation in
 * the same project can inherit the prior conclusions as its first context.
 *
 * Storage: <dataDir>/workspace-memory/<sha256(root)[:20]>/conclusions.jsonl
 */

export interface ProjectConclusionEntry {
  /** ISO timestamp when the conclusion was recorded. */
  ts: string;
  /** Conversation id that produced the conclusion. */
  conversationId: string;
  /** The user task, truncated. */
  task: string;
  /** The final assistant answer / conclusion, truncated. */
  summary: string;
}

const MAX_CONCLUSION_LINES = 200;
const MAX_INJECTED_CONCLUSIONS = 6;
const MAX_TASK_CHARS = 200;
const MAX_SUMMARY_CHARS = 700;
/** 注入到系统提示的短清单上限：压缩后每轮只携带少量条目，完整内容按需读取。 */
const MAX_COMPACT_INJECTED_CONCLUSIONS = 3;
const MAX_COMPACT_SUMMARY_CHARS = 200;
const MAX_COMPACT_INJECTED_RECENT_FILES = 4;
const MAX_COMPACT_RECENT_FILE_SUMMARY_CHARS = 80;

function memoryGroupKey(workspaceRoot: string): string {
  return createHash('sha256')
    .update(path.resolve(workspaceRoot).toLowerCase())
    .digest('hex')
    .slice(0, 20);
}

export function resolveProjectMemoryDir(workspaceRoot: string): string {
  return path.join(getDataDir(), 'workspace-memory', memoryGroupKey(workspaceRoot));
}

function conclusionsFilePath(workspaceRoot: string): string {
  return path.join(resolveProjectMemoryDir(workspaceRoot), 'conclusions.jsonl');
}

function truncate(value: string, max: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function buildProjectConclusion(
  conversationId: string,
  task: string,
  summary: string,
  now: Date = new Date(),
): ProjectConclusionEntry {
  return {
    ts: now.toISOString(),
    conversationId: String(conversationId || '').slice(0, 120),
    task: truncate(task, MAX_TASK_CHARS),
    summary: truncate(summary, MAX_SUMMARY_CHARS),
  };
}

async function readRawConclusions(workspaceRoot: string): Promise<ProjectConclusionEntry[]> {
  const filePath = conclusionsFilePath(workspaceRoot);
  let raw = '';
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const entries: ProjectConclusionEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ProjectConclusionEntry;
      if (parsed && typeof parsed.ts === 'string' && typeof parsed.summary === 'string') {
        entries.push(parsed);
      }
    } catch {
      // Skip corrupt lines; the log is best-effort.
    }
  }
  return entries;
}

export async function appendProjectConclusion(
  workspaceRoot: string,
  entry: ProjectConclusionEntry,
): Promise<void> {
  if (!workspaceRoot || !entry.summary) return;
  const dir = resolveProjectMemoryDir(workspaceRoot);
  try {
    await fs.mkdir(dir, { recursive: true });
    const filePath = conclusionsFilePath(workspaceRoot);
    const existing = await readRawConclusions(workspaceRoot);
    // Keep the log bounded: drop oldest entries beyond the cap.
    const keep = existing.slice(-(MAX_CONCLUSION_LINES - 1));
    keep.push(entry);
    await fs.writeFile(filePath, keep.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf-8');
  } catch (error) {
    // Memory is best-effort and must never break the main run.
    logger.warn(`[ProjectMemory] failed to append conclusion for ${workspaceRoot}: ${(error as Error).message}`);
  }
}

/**
 * Read the most recent conclusions across conversations, newest first, with at
 * most one entry per conversation (the latest). Used to seed a new turn.
 */
export async function readRecentProjectConclusions(
  workspaceRoot: string,
  limit = MAX_INJECTED_CONCLUSIONS,
): Promise<ProjectConclusionEntry[]> {
  if (!workspaceRoot) return [];
  try {
    const entries = await readRawConclusions(workspaceRoot);
    const latestByConversation = new Map<string, ProjectConclusionEntry>();
    for (const entry of entries) {
      const key = entry.conversationId || entry.ts;
      const current = latestByConversation.get(key);
      if (!current || entry.ts >= current.ts) latestByConversation.set(key, entry);
    }
    return Array.from(latestByConversation.values())
      .sort((a, b) => (b.ts || '').localeCompare(a.ts || ''))
      .slice(0, Math.max(1, Math.floor(limit)));
  } catch (error) {
    logger.warn(`[ProjectMemory] failed to read conclusions for ${workspaceRoot}: ${(error as Error).message}`);
    return [];
  }
}

/** Render conclusions as a prompt block for injection (compact = 短清单，完整走按需读取)。 */
export function formatProjectConclusionsForPrompt(
  entries: ProjectConclusionEntry[],
  compact = false,
): string {
  if (!entries.length) return '';
  const selected = compact ? entries.slice(0, MAX_COMPACT_INJECTED_CONCLUSIONS) : entries;
  const lines = selected.map(entry => {
    const when = entry.ts ? entry.ts.slice(0, 16).replace('T', ' ') : '';
    const summary = compact && entry.summary.length > MAX_COMPACT_SUMMARY_CHARS
      ? `${entry.summary.slice(0, MAX_COMPACT_SUMMARY_CHARS)}…`
      : entry.summary;
    const task = compact && entry.task.length > 80 ? `${entry.task.slice(0, 80)}…` : entry.task;
    return `- [${when}] 任务：${task || '(未记录)'} → 结论：${summary}`;
  });
  const more = compact && entries.length > selected.length
    ? `（另有 ${entries.length - selected.length} 条更早结论，完整清单可用 read_workspace_rule(key=project_legacy) 读取）`
    : '';
  return [
    '以下是本工作目录在此前会话中已经得出的结论（按时间倒序）。先复用它，避免重复推导；如果与当前事实冲突，以当前事实为准。',
    ...lines,
    more,
  ].join('\n');
}

/**
 * Recent-file memory (conversation legacy).
 *
 * 每次会话记录最近读取/修改过的文件路径与名称（按工作目录分组），并在后续
 * 会话的系统提示中注入一份紧凑清单。AI 据此直接定位“刚处理过的文件”，
 * 减少 file_search / list_dir 检索轮次。
 *
 * Storage: <dataDir>/workspace-memory/<sha256(root)[:20]>/recent-files.json
 */

export interface RecentWorkspaceFileEntry {
  /** 相对工作目录的展示路径。 */
  path: string;
  /** 文件名。 */
  name: string;
  /** 文件类型（code/data/image/word/excel/pdf/other）。 */
  kind: string;
  /** 最近一次动作。 */
  lastAction: 'read' | 'write' | 'edit' | 'move' | 'copy';
  /** ISO 时间戳，最新在前。 */
  lastUsedAt: string;
  /** AI 在会话结束时生成的文件资源摘要（用途/内容要点/当前状态），供下一次对话直接定位。 */
  summary?: string;
}

const MAX_RECENT_FILES = 30;
const MAX_INJECTED_RECENT_FILES = 12;

function recentFilesFilePath(workspaceRoot: string): string {
  return path.join(resolveProjectMemoryDir(workspaceRoot), 'recent-files.json');
}

export async function readRecentWorkspaceFiles(
  workspaceRoot: string,
  limit = MAX_INJECTED_RECENT_FILES,
): Promise<RecentWorkspaceFileEntry[]> {
  if (!workspaceRoot) return [];
  try {
    const raw = await fs.readFile(recentFilesFilePath(workspaceRoot), 'utf-8');
    const parsed = JSON.parse(raw) as RecentWorkspaceFileEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(item => item && typeof item.path === 'string' && item.path.trim())
      .slice(0, Math.max(1, Math.floor(limit)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    logger.warn(`[ProjectMemory] failed to read recent files for ${workspaceRoot}: ${(error as Error).message}`);
    return [];
  }
}

export async function appendRecentWorkspaceFiles(
  workspaceRoot: string,
  files: Array<Partial<RecentWorkspaceFileEntry> & { path: string }>,
): Promise<void> {
  if (!workspaceRoot || !Array.isArray(files) || files.length === 0) return;
  try {
    const dir = resolveProjectMemoryDir(workspaceRoot);
    await fs.mkdir(dir, { recursive: true });
    const filePath = recentFilesFilePath(workspaceRoot);
    const existing = await readRecentWorkspaceFiles(workspaceRoot, MAX_RECENT_FILES);
    const now = new Date().toISOString();
    const merged = new Map<string, RecentWorkspaceFileEntry>();
    for (const entry of existing) merged.set(entry.path, entry);
    for (const file of files) {
      const cleanPath = String(file.path || '').trim();
      if (!cleanPath) continue;
      merged.set(cleanPath, {
        path: cleanPath,
        name: String(file.name || cleanPath.split(/[\\/]/).pop() || cleanPath),
        kind: String(file.kind || 'other'),
        lastAction: file.lastAction || 'read',
        lastUsedAt: String(file.lastUsedAt || now),
      });
    }
    const ordered = Array.from(merged.values())
      .sort((a, b) => (b.lastUsedAt || '').localeCompare(a.lastUsedAt || ''))
      .slice(0, MAX_RECENT_FILES);
    await fs.writeFile(filePath, JSON.stringify(ordered, null, 1), 'utf-8');
  } catch (error) {
    logger.warn(`[ProjectMemory] failed to append recent files for ${workspaceRoot}: ${(error as Error).message}`);
  }
}

/** Render recent files as a prompt block for injection (compact = 短清单，完整走按需读取)。 */
export function formatRecentWorkspaceFilesForPrompt(
  entries: RecentWorkspaceFileEntry[],
  compact = false,
): string {
  if (!entries.length) return '';
  const selected = compact ? entries.slice(0, MAX_COMPACT_INJECTED_RECENT_FILES) : entries;
  const lines = selected.map(entry => {
    const when = entry.lastUsedAt ? entry.lastUsedAt.slice(0, 16).replace('T', ' ') : '';
    const summary = entry.summary && compact && entry.summary.length > MAX_COMPACT_RECENT_FILE_SUMMARY_CHARS
      ? `${entry.summary.slice(0, MAX_COMPACT_RECENT_FILE_SUMMARY_CHARS)}…`
      : entry.summary;
    return `- [${when}] ${entry.lastAction || 'read'} ${entry.path}${entry.name && entry.name !== entry.path ? `（${entry.name}）` : ''}${summary ? `：${summary}` : ''}`;
  });
  const more = compact && entries.length > selected.length
    ? `（另有 ${entries.length - selected.length} 个更早文件，完整清单可用 read_workspace_rule(key=project_legacy) 读取）`
    : '';
  return [
    '对话遗产——本工作目录最近处理过的文件及 AI 生成的资源摘要（按时间倒序，最新的一般是刚修改的权威版本）。优先继承上次对话的文件路径遗产：先看摘要判断哪些文件与当前任务相关，有就直接 read_file，不要先做 file_search；清单里没有匹配项或内容不相关时，再做 file_search / list_dir 检索。',
    ...lines,
    more,
  ].join('\n');
}

/**
 * 完整对话遗产（按需读取用）：最近文件（≤30 条）+ 历史结论（≤20 条）的全文。
 * 由 read_workspace_rule(key=project_legacy) 提供，避免每轮把全部摘要注入系统提示。
 */
export function formatFullProjectLegacyForPrompt(
  recentFiles: RecentWorkspaceFileEntry[],
  conclusions: ProjectConclusionEntry[],
): string {
  const blocks: string[] = [];
  if (recentFiles.length > 0) {
    const lines = recentFiles.map(entry => {
      const when = entry.lastUsedAt ? entry.lastUsedAt.slice(0, 16).replace('T', ' ') : '';
      return `- [${when}] ${entry.lastAction || 'read'} ${entry.path}${entry.name && entry.name !== entry.path ? `（${entry.name}）` : ''}${entry.summary ? `：${entry.summary}` : ''}`;
    });
    blocks.push([
      '## 完整对话遗产：最近处理过的文件（按时间倒序）',
      ...lines,
    ].join('\n'));
  }
  if (conclusions.length > 0) {
    const lines = conclusions.map(entry => {
      const when = entry.ts ? entry.ts.slice(0, 16).replace('T', ' ') : '';
      return `- [${when}] 任务：${entry.task || '(未记录)'} → 结论：${entry.summary}`;
    });
    blocks.push([
      '## 完整对话遗产：历史会话结论（按时间倒序）',
      ...lines,
    ].join('\n'));
  }
  return blocks.join('\n\n');
}
