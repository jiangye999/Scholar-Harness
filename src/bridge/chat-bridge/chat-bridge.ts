import { spawn } from 'child_process';
import { readFile, writeFile, mkdir, unlink, mkdtemp, rmdir } from 'fs/promises';
import * as path from 'path';
import { join } from 'path';
import * as os from 'os';
import http from 'http';
import { existsSync, writeFileSync, readFileSync, unlinkSync, readdirSync, renameSync, statSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import { logger } from '../../utils/logger';
import { maskEmail, maskSecret } from '../../utils/sanitize';
import { decrypt, isEncrypted } from '../../utils/encryption';
import {
  callChatCompletion,
  callChatCompletionWithTools,
  type LLMToolChatResult,
  type LLMToolDefinition,
  type LLMToolMessage,
} from '../../utils/llm-client';
import type { ChatOptions, Message } from '../../types';
import {
  CodexTurnCancelledError,
  codexAppServerManager,
  isCodexTurnCancelledError,
  type CodexAppServerTurnResult,
  type CodexToolGatewayConnection,
} from './codex-app-server';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';
import { isDraftSaveRequest } from '../../utils/draft-save-block';
import { extractExplicitWorkspaceFileWriteIntent } from '../../utils/workspace-file-intent';
import { writeWordDraftDocx } from '../../utils/word-draft-docx';
import { getDataDir, sanitizeUserId as sanitizePathUserId } from '../../utils/paths';
import { mirrorWorkspaceOutputFiles } from '../../server/services/workspace-output-mirror';
import { filterUserFacingWorkspaceOutputPaths } from '../../server/services/workspace-output-artifacts';
import {
  budgetAgentPrompt,
  type AgentContextProfile,
} from '../../orchestrator/agent-context-budget';

// PID 文件路径（用于防止 openclaw serve 多开）
const OPENCLAW_PID_FILE = 'openclaw-serve.pid';
const codexSessionByConversation = new Map<string, string>();
const codexCliRuntimeSignatureByConversation = new Map<string, string>();
const codexSafeWorkspaceByConversation = new Map<string, string>();
const codexLastUsageByConversation = new Map<string, CodexUsageSnapshot>();
const codexLastAnswerByConversation = new Map<string, string>();
const CODEX_SAFE_WORKSPACE_DIR_NAME = 'ScholarHarness_AI_Workspaces';
const CODEX_SAFE_WORKSPACE_README = 'README_ScholarHarness_AI_Workspace.md';
const CODEX_AUTO_COMPACT_INPUT_TOKEN_THRESHOLD = 2_000_000;
const CODEX_MAX_MIRRORED_ARTIFACTS = 2_000;
const CODEX_MAX_VERIFIED_ARTIFACT_PATHS = 48;
const CODEX_ARTIFACT_SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'coverage', '__pycache__']);
const CODEX_TRANSIENT_QA_ARTIFACT_RULE = 'Office/PDF 逐页排版截图（例如 review_v9/page1.png、page2.png）仅供内部视觉 QA：不要把它们列为最终文件或用户附件；只报告真正交付的 DOCX、PDF、表格、代码和论文图。如果临时渲染页面，复核后不要复制到用户目录。';
export const CODEX_VERIFIED_ARTIFACTS_BEGIN = '[[SH_VERIFIED_ARTIFACTS_BEGIN]]';
export const CODEX_VERIFIED_ARTIFACTS_END = '[[SH_VERIFIED_ARTIFACTS_END]]';

function repairLegacyCodexModelsCache(): void {
  const codexHome = String(process.env.CODEX_HOME || join(os.homedir(), '.codex')).trim();
  const cachePath = join(codexHome, 'models_cache.json');
  if (!existsSync(cachePath)) return;
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8')) as {
      models?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.models)) return;
    let repaired = 0;
    for (const model of parsed.models) {
      if (Object.prototype.hasOwnProperty.call(model, 'supports_reasoning_summaries')) continue;
      model.supports_reasoning_summaries = false;
      repaired += 1;
    }
    if (repaired === 0) return;
    const temporaryPath = `${cachePath}.scholar-harness-${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf-8');
    renameSync(temporaryPath, cachePath);
    logger.info(`[ChatBridge] Repaired ${repaired} legacy Codex model cache entries before App Server startup.`);
  } catch (error) {
    logger.warn(`[ChatBridge] Unable to repair legacy Codex models cache: ${(error as Error).message}`);
  }
}

interface CodexArtifactSnapshotItem {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
}

interface CodexArtifactSnapshotOptions {
  skipAiWorkspaceContainer?: boolean;
}

function snapshotCodexArtifactFiles(
  root: string,
  maxFiles = 10_000,
  options: CodexArtifactSnapshotOptions = {},
): Map<string, CodexArtifactSnapshotItem> {
  const snapshot = new Map<string, CodexArtifactSnapshotItem>();
  if (!root || !existsSync(root)) return snapshot;
  const visit = (dir: string): void => {
    if (snapshot.size >= maxFiles) return;
    let entries: import('fs').Dirent[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (snapshot.size >= maxFiles) return;
      if (entry.isDirectory() && CODEX_ARTIFACT_SKIP_DIRS.has(entry.name.toLowerCase())) continue;
      if (
        entry.isDirectory()
        && options.skipAiWorkspaceContainer
        && entry.name.toLowerCase() === CODEX_SAFE_WORKSPACE_DIR_NAME.toLowerCase()
      ) {
        continue;
      }
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const stat = statSync(absolutePath);
        snapshot.set(absolutePath, {
          size: stat.size,
          mtimeMs: stat.mtimeMs,
          ctimeMs: stat.ctimeMs,
        });
      } catch {
        // Files may disappear while the snapshot is being collected.
      }
    }
  };
  visit(root);
  return snapshot;
}

function collectChangedCodexArtifacts(
  root: string,
  before: Map<string, CodexArtifactSnapshotItem>,
  maxFiles = 12,
  options: CodexArtifactSnapshotOptions = {},
): string[] {
  if (!root || !existsSync(root)) return [];
  const after = snapshotCodexArtifactFiles(root, 10_000, options);
  const changedEntries = Array.from(after.entries())
    .filter(([filePath, current]) => {
      if (path.basename(filePath) === CODEX_SAFE_WORKSPACE_README) return false;
      const previous = before.get(filePath);
      return !previous
        || previous.size !== current.size
        || previous.mtimeMs !== current.mtimeMs
        || previous.ctimeMs !== current.ctimeMs;
    })
    .sort((left, right) => right[1].mtimeMs - left[1].mtimeMs);
  const userFacingPaths = new Set(
    filterUserFacingWorkspaceOutputPaths(changedEntries.map(([filePath]) => filePath))
      .map(filePath => process.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath))
  );
  return changedEntries
    .filter(([filePath]) => userFacingPaths.has(
      process.platform === 'win32' ? path.resolve(filePath).toLowerCase() : path.resolve(filePath)
    ))
    .slice(0, maxFiles)
    .map(([filePath]) => filePath);
}

export function filterChangedCodexSourceArtifacts(
  filePaths: string[],
  workspaceRoot: string,
  evidenceText: string,
  explicitTarget = '',
): string[] {
  if (!workspaceRoot || !filePaths.length) return [];
  const resolvedRoot = path.resolve(workspaceRoot);
  const normalizedEvidence = String(evidenceText || '').replace(/\\/g, '/').toLowerCase();
  const normalizedTarget = path.basename(String(explicitTarget || '').trim()).toLowerCase();
  const normalizedTargetStem = path.basename(normalizedTarget, path.extname(normalizedTarget));
  const seen = new Set<string>();

  return filterUserFacingWorkspaceOutputPaths(filePaths).filter(filePath => {
    const resolvedPath = path.resolve(String(filePath || '').trim());
    const compareKey = process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
    if (!filePath || seen.has(compareKey) || !isSubPath(resolvedRoot, resolvedPath)) return false;
    if (!existsSync(resolvedPath)) return false;
    try {
      if (!statSync(resolvedPath).isFile()) return false;
    } catch {
      return false;
    }

    const normalizedPath = resolvedPath.replace(/\\/g, '/').toLowerCase();
    const baseName = path.basename(resolvedPath).toLowerCase();
    const baseStem = path.basename(baseName, path.extname(baseName));
    const mentionedByTurn = normalizedEvidence.includes(normalizedPath)
      || normalizedEvidence.includes(baseName);
    const matchesExplicitTarget = !!normalizedTarget && (
      baseName === normalizedTarget
      || baseStem === normalizedTargetStem
      || baseName.includes(normalizedTarget)
      || normalizedTarget.includes(baseName)
    );
    if (!mentionedByTurn && !matchesExplicitTarget) return false;
    seen.add(compareKey);
    return true;
  });
}

async function mirrorCodexWorkspaceArtifacts(
  filePaths: string[],
  workspaceRoot: string,
  aiWorkRoot: string | null,
): Promise<{ mirroredPaths: string[]; warning: string }> {
  if (!workspaceRoot || !aiWorkRoot || filePaths.length === 0) {
    return { mirroredPaths: [], warning: '' };
  }
  const results = await mirrorWorkspaceOutputFiles(filePaths, workspaceRoot, aiWorkRoot);
  const mirroredPaths = results
    .filter(result => result.mirrored)
    .map(result => result.targetPath);
  const failed = results.filter(result => !result.mirrored);
  failed.forEach(result => logger.warn(
    `[ChatBridge] Failed to mirror Codex artifact ${result.sourcePath} -> ${result.targetPath}: ${result.error || 'unknown error'}`
  ));
  return {
    mirroredPaths,
    warning: failed.length
      ? `⚠️ 有 ${failed.length} 个文件未能同步到用户配置目录，请使用 AI 工作目录中的版本。`
      : '',
  };
}

export function isCodexDraftWordExportRequest(value: string): boolean {
  const text = String(value || '').trim();
  if (!text || !/(?:\bword\b|\.docx\b|word\s*文档)/i.test(text)) return false;
  if (!/(?:草稿|章节|论文|全文|manuscript|draft|chapter)/i.test(text)) return false;
  return /(?:整合|合并|汇总|导出|生成|写入|保存|制作|combine|merge|export|generate|write)/i.test(text);
}

export function isCodexFileMutationRequest(value: string): boolean {
  const text = String(value || '').trim();
  if (!text) return false;
  const hasMutation = /(?:修改|改写|更新|写入|生成|新建|创建|导出|保存|整合|合并|重算|重绘|edit|update|write|create|generate|export|save|merge)/i.test(text);
  const hasFileTarget = /(?:文件|文档|图片|图像|图表|代码|脚本|草稿|word|docx|excel|xlsx|pptx|pdf|\.\w{1,8}\b)/i.test(text);
  return hasMutation && hasFileTarget;
}

export function buildCodexVerifiedArtifactBlock(filePaths: string[]): string {
  const verifiedPaths = Array.from(new Set(
    filterUserFacingWorkspaceOutputPaths(filePaths)
  ));
  if (verifiedPaths.length === 0) return '';
  return [
    CODEX_VERIFIED_ARTIFACTS_BEGIN,
    '生成/更新文件（已验证）：',
    ...verifiedPaths.map(filePath => `- ${filePath}`),
    CODEX_VERIFIED_ARTIFACTS_END,
  ].join('\n');
}

function getCodexDraftWordExportContent(options: ChatOptions): string {
  const ordinaryDraft = (options.draftContext as Record<string, unknown> | undefined)?.ordinaryDraft as Record<string, unknown> | undefined;
  const exportContent = String(ordinaryDraft?.exportContent || '').trim();
  if (exportContent) return exportContent;

  const contextContent = String(ordinaryDraft?.content || '');
  const contentMarker = '## 草稿内容';
  const markerIndex = contextContent.indexOf(contentMarker);
  return markerIndex >= 0
    ? contextContent.slice(markerIndex + contentMarker.length).trim()
    : '';
}

export function sanitizeCodexFinalAnswer(value: string): string {
  let text = String(value || '').trim();
  text = text.replace(/\[([^\]]+)\]\(<\/mnt\/data\?>\)/gi, '$1');
  const leakagePattern = /\s+(?:hmm need proper Windows absolute\?|Need provide \[|Need include exact path\.|Final answer desired oververbosity|Let's final\.|Wait our final text|Oops I think I wrote|As ChatGPT I need)/i;
  const leakage = leakagePattern.exec(text);
  if (leakage && leakage.index >= 20) {
    text = text.slice(0, leakage.index).trim();
  }
  return text;
}

function clearCodexThreadState(conversationKey: string): void {
  codexSessionByConversation.delete(conversationKey);
  codexCliRuntimeSignatureByConversation.delete(conversationKey);
  codexLastUsageByConversation.delete(conversationKey);
  codexLastAnswerByConversation.delete(conversationKey);
}

interface CodexUsageSnapshot {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  observedAt: string;
}

function sanitizeCodexSessionKeyPart(value: unknown): string {
  return String(value || '').trim().replace(/[^\w.@:-]+/g, '_').slice(0, 180) || 'default';
}

function buildCodexConversationKey(options: ChatOptions, workspaceRoot: string): string {
  const userId = sanitizeCodexSessionKeyPart(options.userId || 'web-user');
  const conversationId = sanitizeCodexSessionKeyPart(options.conversationId || 'default-conversation');
  const workspaceKey = workspaceRoot
    ? createHash('sha256').update(path.resolve(workspaceRoot).toLowerCase()).digest('hex').slice(0, 16)
    : 'no-workspace';
  return `${userId}:${conversationId}:${workspaceKey}`;
}

function buildCodexRuntimeSignature(cwd: string, sandbox: string): string {
  const resolvedCwd = path.resolve(String(cwd || process.cwd()));
  return JSON.stringify({
    cwd: process.platform === 'win32' ? resolvedCwd.toLowerCase() : resolvedCwd,
    sandbox: String(sandbox || ''),
  });
}

function buildCodexConversationKeyPrefix(userId: unknown, conversationId: unknown): string {
  return `${sanitizeCodexSessionKeyPart(userId || 'web-user')}:${sanitizeCodexSessionKeyPart(conversationId || 'default-conversation')}:`;
}

function throwIfCodexCancelled(options: Pick<ChatOptions, 'isCancelled' | 'abortSignal'>): void {
  if (options.abortSignal?.aborted || options.isCancelled?.()) {
    throw new CodexTurnCancelledError();
  }
}

async function terminateCodexProcessTree(child: ReturnType<typeof spawn>): Promise<boolean> {
  if (!child.pid) return child.kill();
  if (process.platform !== 'win32') return child.kill('SIGTERM');
  return new Promise<boolean>(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
    });
    timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 3_000);
    timer.unref?.();
    killer.once('error', () => {
      child.kill();
      finish(false);
    });
    killer.once('close', code => finish(code === 0));
  });
}

function createCodexSafeWorkspaceName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `Codex-${timestamp}-${randomUUID().slice(0, 8)}`;
}

function isSubPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function prepareCodexSafeWorkspace(workspaceRoot: string, conversationKey: string, preferredSafeRoot?: string): Promise<string | null> {
  if (!workspaceRoot || !existsSync(workspaceRoot)) return null;
  const existing = codexSafeWorkspaceByConversation.get(conversationKey);
  if (existing && existsSync(existing)) return existing;

  const requestedSafeRoot = String(preferredSafeRoot || '').trim();
  const resolvedRequestedSafeRoot = requestedSafeRoot ? path.resolve(requestedSafeRoot) : '';
  const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
  const rootIsSafeWorkspaceContainer = path.basename(resolvedWorkspaceRoot).toLowerCase() === CODEX_SAFE_WORKSPACE_DIR_NAME.toLowerCase();
  const safeRoot = resolvedRequestedSafeRoot
    && isSubPath(resolvedWorkspaceRoot, resolvedRequestedSafeRoot)
    && (
      rootIsSafeWorkspaceContainer
      || path.relative(resolvedWorkspaceRoot, resolvedRequestedSafeRoot).toLowerCase().split(/[\\/]+/).includes(CODEX_SAFE_WORKSPACE_DIR_NAME.toLowerCase())
    )
    ? resolvedRequestedSafeRoot
    : join(
        rootIsSafeWorkspaceContainer ? resolvedWorkspaceRoot : join(resolvedWorkspaceRoot, CODEX_SAFE_WORKSPACE_DIR_NAME),
        createCodexSafeWorkspaceName()
      );
  await mkdir(safeRoot, { recursive: true });
  const readmePath = join(safeRoot, CODEX_SAFE_WORKSPACE_README);
  const readme = [
    '# Scholar Harness Codex Workspace',
    '',
    'This folder is the conversation-scoped AI workspace for Codex tasks.',
    `Original workspace: ${workspaceRoot}`,
    '',
    'Authorization for the configured workspace applies recursively to every ordinary descendant directory and file. Codex should search the full configured workspace tree and the complete ScholarHarness_AI_Workspaces container (including other conversation subfolders), not only top-level files or the current AI workspace.',
    'Codex should copy any source files it needs into this folder before editing or running code.',
    'Generated and updated output files are mirrored to the configured workspace with the same relative path.',
    CODEX_TRANSIENT_QA_ARTIFACT_RULE,
    '',
  ].join('\n');
  try {
    await writeFile(readmePath, readme, { encoding: 'utf-8', flag: 'wx' });
  } catch {
    // Existing README is fine.
  }
  await new Promise<void>((resolve) => {
    const child = spawn('git', ['init'], {
      cwd: safeRoot,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    child.on('error', () => resolve());
    child.on('close', () => resolve());
  });
  codexSafeWorkspaceByConversation.set(conversationKey, safeRoot);
  return safeRoot;
}

function getImageMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'image/png';
}

function buildLocalImageDataUrl(filePath: string): string | null {
  const resolved = path.resolve(String(filePath || '').trim());
  if (!resolved || !existsSync(resolved)) return null;
  const buffer = readFileSync(resolved);
  return `data:${getImageMimeType(resolved)};base64,${buffer.toString('base64')}`;
}

export function attachVisionImagesToMessages(
  inputMessages: Array<Message | LLMToolMessage>,
  inputImagePaths: string[],
  requiresVision: boolean,
): Array<Message | LLMToolMessage> {
  const imagePaths = inputImagePaths
    .map(imagePath => String(imagePath || '').trim())
    .filter(imagePath => imagePath && existsSync(imagePath));
  if (!requiresVision || imagePaths.length === 0 || inputMessages.length === 0) {
    return inputMessages;
  }
  const imageParts = imagePaths
    .map(imagePath => buildLocalImageDataUrl(imagePath))
    .filter((url): url is string => !!url)
    .map(url => ({
      type: 'image_url' as const,
      image_url: {
        url,
        detail: 'high' as const,
      },
    }));
  if (imageParts.length === 0) return inputMessages;

  const messages = inputMessages.slice();
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) return messages;
  const lastUserMessage = messages[lastUserIndex];
  messages[lastUserIndex] = {
    ...lastUserMessage,
    content: [
      { type: 'text', text: stringifyMessageContent(lastUserMessage.content) },
      ...imageParts,
    ],
  } as unknown as LLMToolMessage;
  return messages;
}

function stringifyMessageContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text || '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return String(content || '');
}

/**
 * 安全创建临时目录
 * 使用系统临时目录 + 随机子目录名
 */
async function createSecureTempDir(): Promise<string> {
  const tmpDir = await mkdtemp(join(os.tmpdir(), 'chat-bridge-'));
  return tmpDir;
}

/**
 * 安全写入临时文件
 * 设置权限为仅所有者可读写 (0o600)
 */
async function writeSecureTempFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { mode: 0o600 });
}

function stringifyCodexEventValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (Array.isArray(value)) {
    if (value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) {
      return value.map(item => String(item)).join(' ');
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateCodexEventText(value: unknown, maxChars = 12000): string {
  const text = stringifyCodexEventValue(value).trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated ${text.length - maxChars} chars]`;
}

function stringifyCodexCommand(value: unknown): string {
  if (Array.isArray(value)) return value.map(item => String(item)).join(' ');
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const raw = value as Record<string, unknown>;
    const nested = raw.command || raw.cmd || raw.args || raw.argv || raw.input;
    if (nested && nested !== value) return stringifyCodexCommand(nested);
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value ?? '').trim();
}

function pickCodexTextEvent(event: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = event[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (Array.isArray(value)) {
      const joined = value.map(item => typeof item === 'string' ? item : '').filter(Boolean).join('');
      if (joined.trim()) return joined;
    }
  }
  const item = event.item;
  if (item && typeof item === 'object') {
    const rawItem = item as Record<string, unknown>;
    for (const key of keys) {
      const value = rawItem[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return '';
}

function getCodexItem(event: Record<string, unknown>): Record<string, unknown> | null {
  const item = event.item;
  return item && typeof item === 'object' ? item as Record<string, unknown> : null;
}

function formatCodexUsage(value: unknown): string {
  const usage = parseCodexUsage(value);
  if (!usage) return '';
  const parts: string[] = [];
  if (usage.inputTokens > 0) parts.push(`输入 ${usage.inputTokens}`);
  if (usage.outputTokens > 0) parts.push(`输出 ${usage.outputTokens}`);
  if (usage.reasoningTokens > 0) parts.push(`推理 ${usage.reasoningTokens}`);
  return parts.length ? `（tokens：${parts.join(' / ')}）` : '';
}

function parseCodexUsage(value: unknown): CodexUsageSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const usage = value as Record<string, unknown>;
  const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
  const reasoningTokens = Number(usage.reasoning_output_tokens ?? usage.reasoningOutputTokens ?? 0);
  if (!Number.isFinite(inputTokens) || inputTokens <= 0) return null;
  return {
    inputTokens,
    outputTokens: Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0,
    reasoningTokens: Number.isFinite(reasoningTokens) && reasoningTokens > 0 ? reasoningTokens : 0,
    observedAt: new Date().toISOString(),
  };
}

function parseCodexUsageFromJsonLine(line: string): CodexUsageSnapshot | null {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(event.type || event.event || event.kind || '').toLowerCase();
    const isTurnCompleted = type === 'turn.completed'
      || type === 'turn_completed'
      || (type.includes('turn') && (type.includes('completed') || type.includes('complete')));
    return isTurnCompleted ? parseCodexUsage(event.usage) : null;
  } catch {
    return null;
  }
}

function shouldAutoCompactCodexSession(usage?: CodexUsageSnapshot | null): boolean {
  return !!usage && usage.inputTokens > CODEX_AUTO_COMPACT_INPUT_TOKEN_THRESHOLD;
}

function formatCodexUsageSnapshot(usage: CodexUsageSnapshot): string {
  const parts = [`输入 ${usage.inputTokens}`];
  if (usage.outputTokens > 0) parts.push(`输出 ${usage.outputTokens}`);
  if (usage.reasoningTokens > 0) parts.push(`推理 ${usage.reasoningTokens}`);
  return parts.join(' / ');
}

function extractCurrentUserRequestFromPrompt(prompt: string): string {
  const text = String(prompt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const anchorMatch = text.match(/<CURRENT_USER_REQUEST\b[^>]*>\n?([\s\S]*?)\n?<\/CURRENT_USER_REQUEST>/i);
  if (anchorMatch?.[1]?.trim()) {
    return anchorMatch[1].trim();
  }
  const markdownMarkers = [
    '## 💬 用户请求-参考文献列表\n',
    '## 💬 用户请求\n',
  ];
  for (const marker of markdownMarkers) {
    const index = text.lastIndexOf(marker);
    if (index >= 0) {
      return text.slice(index + marker.length).trim();
    }
  }
  const bracketMarkers = [
    '【用户请求-参考文献列表】\n',
    '【用户请求】\n',
  ];
  for (const marker of bracketMarkers) {
    const index = text.lastIndexOf(marker);
    if (index >= 0) {
      return text.slice(index + marker.length).trim();
    }
  }
  return text;
}

function extractCodexCurrentRequest(options: ChatOptions): string {
  const envelopeText = String(options.queryEnvelope?.text || '').trim();
  if (envelopeText) return envelopeText;
  const lastUserMessage = [...options.messages].reverse().find(message => message.role === 'user');
  return extractCurrentUserRequestFromPrompt(stringifyMessageContent(lastUserMessage?.content || ''));
}

function buildCodexQueryEnvelopeSummary(options: ChatOptions): string {
  const envelope = options.queryEnvelope;
  if (!envelope) return '';
  const parts = Array.isArray(envelope.parts) ? envelope.parts : [];
  const partLines = parts
    .map((rawPart) => {
      const part = rawPart && typeof rawPart === 'object' ? rawPart as Record<string, unknown> : {};
      const type = String(part.type || '').trim();
      if (!type) return '';
      if (type === 'workspace') {
        return `- workspace: ${part.root || part.path || envelope.workspace?.root || ''} (${part.permission || envelope.workspace?.permission || 'read-only'})`;
      }
      if (type === 'workspace_file') {
        return `- workspace_file: ${part.path || part.name || part.label || ''}（用户通过 @ 明确选择，优先读取）`;
      }
      if (type === 'file' || type === 'image') {
        return `- ${type}: ${part.path || part.name || part.label || ''}`;
      }
      if (type === 'slash') {
        return `- slash: ${part.command || part.name || part.label || ''}`;
      }
      if (type === 'context') {
        return `- context: ${part.key || part.label || ''}`;
      }
      if (type === 'reference_format') {
        return `- reference_format: ${part.content || part.label || ''}`;
      }
      return `- ${type}: ${part.content || part.name || part.label || ''}`;
    })
    .filter(Boolean)
    .slice(0, 40);
  return [
    '## 当前用户 Query Envelope（轻量）',
    `- queryId: ${envelope.id || ''}`,
    `- provider: ${envelope.provider || 'codex'}`,
    `- delivery: ${envelope.delivery || 'steer'}`,
    partLines.length ? `- 显式结构化输入：\n${partLines.join('\n')}` : '',
  ].filter(Boolean).join('\n');
}

function buildCodexQueryIntentSummary(options: ChatOptions): string {
  const rawIntent = options.draftContext?.queryIntent;
  if (!rawIntent || typeof rawIntent !== 'object') return '';
  const intent = rawIntent as Record<string, unknown>;
  const primaryIntent = String(intent.primaryIntent || '').trim();
  const resolvedQuery = String(intent.resolvedQuery || '').trim().slice(0, 12000);
  if (!primaryIntent || !resolvedQuery) return '';
  const referencedFiles = Array.isArray(intent.referencedFiles)
    ? intent.referencedFiles.map(item => String(item || '').trim()).filter(Boolean).slice(0, 30)
    : [];
  const excludedFiles = Array.isArray(intent.excludedFiles)
    ? intent.excludedFiles.map(item => String(item || '').trim()).filter(Boolean).slice(0, 20)
    : [];
  return [
    '## 统一 AI Query 意图（本轮路由）',
    `- primaryIntent: ${primaryIntent}`,
    `- action: ${String(intent.action || 'other')}`,
    `- needsWorkspaceSearch: ${intent.needsWorkspaceSearch === true}`,
    `- needsWebSearch: ${intent.needsWebSearch === true}`,
    `- needsLiteratureRetrieval: ${intent.needsLiteratureRetrieval === true}`,
    `- resolvedQuery: ${resolvedQuery}`,
    referencedFiles.length ? `- referencedFiles: ${referencedFiles.join('；')}` : '',
    excludedFiles.length ? `- excludedFiles: ${excludedFiles.join('；')}` : '',
    primaryIntent === 'workspace_file'
      ? '- 文件名、扩展名、“除了这个/还有呢/下一个”属于工作目录任务；递归搜索原始工作目录全部后代目录与 AI 工作目录，按真实 mtime 核对，不能只查根目录，也不能改判为文献检索。'
      : '',
    primaryIntent === 'literature_collection'
      ? '- 本轮是外部新文献采集，但主页聊天输入框暂不开放 WoS/CNKI 外部采集。不得调用 collect_literature_by_topic，也不得改走 Embedding 文献库或 PDF Wiki；简洁说明该入口暂未开放。'
      : '',
    intent.needsLiteratureRetrieval === false
      ? '- 本轮不得仅因英文、科研术语或文件名触发文献检索。'
      : '',
    intent.needsWebSearch === false
      ? '- 本轮不得仅因 latest/newest/recent、英文或历史消息触发联网搜索。'
      : '',
  ].filter(Boolean).join('\n');
}

function truncateCodexHandoffContent(value: string, maxChars = 20_000): string {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const headLength = Math.floor(maxChars * 0.7);
  const tailLength = maxChars - headLength;
  return `${text.slice(0, headLength)}\n...[中间内容已压缩]...\n${text.slice(-tailLength)}`;
}

export function buildCodexConversationHandoff(options: Pick<ChatOptions, 'conversationHandoff'>): string {
  const messages = Array.isArray(options.conversationHandoff)
    ? options.conversationHandoff.slice(-20)
    : [];
  if (messages.length === 0) return '';

  const selected: Array<{ role: string; content: string }> = [];
  let remainingChars = 100_000;
  for (let index = messages.length - 1; index >= 0 && remainingChars > 0; index--) {
    const message = messages[index];
    const content = truncateCodexHandoffContent(String(message?.content || ''), Math.min(20_000, remainingChars));
    if (!content) continue;
    selected.unshift({ role: String(message?.role || 'user'), content });
    remainingChars -= content.length;
  }
  if (selected.length === 0) return '';

  return [
    '## Scholar Harness 最近可见对话（跨 Provider 交接）',
    '以下消息来自当前软件界面，可能包含 Codex 失败后由小牛马/大牛马生成、因而不在 Codex thread 内的回答。',
    '解析“方案 A / 第二个方案 / 继续 / 按刚才的”等指代时，必须优先查这里最近的助手回答；不要要求用户重复粘贴已经出现的定义。',
    ...selected.map((message, index) => [
      `### 可见消息 ${index + 1}（${message.role === 'assistant' ? 'assistant' : (message.role === 'system' ? 'system' : 'user')}）`,
      message.content,
    ].join('\n')),
  ].join('\n\n');
}

function buildCodexDraftSaveReminder(options: ChatOptions, currentRequest: string): string {
  if (extractExplicitWorkspaceFileWriteIntent(currentRequest) || !isDraftSaveRequest(currentRequest)) return '';
  const rawWritingTarget = options.draftContext?.articleWritingProgress?.activeTarget;
  const writingTargetChapter = String(rawWritingTarget?.chapterKey || '').trim();
  const hasNativeDraftTool = !!options.codexToolSet?.definitions.some(tool => tool.function.name === 'save_draft');
  if (hasNativeDraftTool) {
    return [
      '## Scholar Harness 草稿写入协议（本轮请求涉及章节 TXT）',
      '读取来源文件和保存应用章节是两个动作：可以先读取工作目录文件，但最终章节内容必须调用 scholar_harness MCP 的 save_draft 工具写入右侧文章写作进度。',
      '禁止只在回答文本中声称已经保存，也不要在安全工作副本里新建同名 TXT 来代替应用草稿。',
      writingTargetChapter
        ? `页面已锁定顶级章节 ${writingTargetChapter}；save_draft 的 section 必须服从该目标。`
        : '页面未锁定章节；请根据最新用户请求、正文标题和内容功能选择现有顶级章节，必要时由 save_draft 创建新的顶级章节 TXT。',
      '只有 save_draft 返回 ok=true 后，最终回答才能告诉用户保存成功，并应保留工具返回的具体章节和 .txt 文件名。',
    ].join('\n');
  }
  return [
    '## Scholar Harness 草稿写入协议（本轮请求涉及章节 TXT）',
    '读取来源文件和保存应用章节是两个动作：可以先读取工作目录文件，但最终章节内容必须通过 save_draft 写入右侧文章写作进度。',
    '不要只在安全工作副本里新建同名 TXT，也不要只口头声称“已保存”。必须在回答末尾输出以下可执行块：',
    '```text',
    '🔧 调用工具：save_draft',
    'content: |',
    '[最终要保存的章节正文]',
    writingTargetChapter
      ? `section: ${writingTargetChapter}`
      : 'section: [根据用户要求选择或创建有意义的顶级章节 key，例如 title、literature_review、implications]',
    'references: |',
    '[本章节实际引用的完整参考文献；没有则留空]',
    '```',
  ].join('\n');
}

function buildCodexDraftWordExportReminder(options: ChatOptions, currentRequest: string): string {
  if (!isCodexDraftWordExportRequest(currentRequest)) return '';
  const hasCanonicalDraft = !!getCodexDraftWordExportContent(options);
  return [
    '## Scholar Harness Word 草稿导出协议',
    hasCanonicalDraft
      ? '- 已附带右侧“文章写作进度”的规范章节 TXT；Scholar Harness 会在本轮结束前用内置 DOCX 生成器真实重建 paper-draft.docx。'
      : '- 当前没有可用的规范章节 TXT；不得声称 Word 已写入或已更新。',
    '- 生成或更新论文草稿 DOCX 时，正文、标题、表格、图注和参考文献统一使用 Times New Roman；除非用户明确指定其他字体。',
    '- 你可以检查章节顺序和指出内容问题，但不要把“准备写入”或仅提及文件名表述成已经完成。',
    '- 只有 Scholar Harness 返回“生成/更新文件（已验证）”回执后，文件写入才算成功。',
  ].join('\n');
}

function finalizeCodexProviderPrompt(
  rawPrompt: string,
  options: ChatOptions,
  profile: AgentContextProfile = 'main-chat',
): string {
  const currentRequest = extractCodexCurrentRequest(options);
  const requestAnchor = [
    '<CURRENT_USER_REQUEST priority="highest">',
    truncateCodexHandoffContent(currentRequest || '(empty request)', 24_000),
    '</CURRENT_USER_REQUEST>',
  ].join('\n');
  const reserveChars = requestAnchor.length + 2;
  const budget = budgetAgentPrompt(rawPrompt, {
    profile,
    maxChars: Math.max(32_000, 150_000 - reserveChars),
  });
  const prompt = budget.prompt.includes('<CURRENT_USER_REQUEST priority="highest">')
    ? budget.prompt
    : `${budget.prompt}\n\n${requestAnchor}`;
  if (
    budget.diagnostics.beforeChars !== budget.diagnostics.afterChars
    || budget.diagnostics.deduplicatedSectionCount > 0
  ) {
    logger.warn('[PromptBudget] Codex provider prompt normalized:', {
      ...budget.diagnostics,
      finalChars: prompt.length,
      includedSections: budget.diagnostics.includedSections.slice(0, 20),
      omittedSections: budget.diagnostics.omittedSections.slice(0, 20),
    });
  }
  return prompt;
}

export function buildCodexResumePrompt(options: ChatOptions, workspaceRoot: string, codexSafeWorkspace: string | null, workspaceSandbox: string): string {
  const currentRequest = extractCodexCurrentRequest(options);
  const queryEnvelopeSummary = buildCodexQueryEnvelopeSummary(options);
  const queryIntentSummary = buildCodexQueryIntentSummary(options);
  const conversationHandoff = buildCodexConversationHandoff(options);
  const explicitFileWriteIntent = extractExplicitWorkspaceFileWriteIntent(currentRequest);
  const writingProgress = options.draftContext?.articleWritingProgress;
  const rawWritingTarget = writingProgress?.activeTarget;
  const writingTargetChapter = String(rawWritingTarget?.chapterKey || '').trim();
  const writingTargetTitle = String(rawWritingTarget?.chapterTitle || writingTargetChapter).trim();
  const writingTargetSubsection = String(rawWritingTarget?.subsectionTitle || '').trim();
  const writingProgressSummary = writingProgress?.available
    ? [
        '## 文章写作进度（本轮页面实时状态）',
        `- 已完成章节：${Number(writingProgress.completedChapterCount || 0)}/${Number(writingProgress.totalChapterCount || 0)}`,
        `- 小节总数：${Number(writingProgress.totalSubsectionCount || 0)}`,
        writingTargetChapter
          ? (explicitFileWriteIntent
              ? `- 页面当前“正在写”：${writingTargetTitle}${writingTargetSubsection ? ` / ${writingTargetSubsection}` : ''}（${writingTargetChapter}.txt）；本轮用户显式指定工作目录文件“${explicitFileWriteIntent.target}”，该状态仅作内容参考，不能改变写入目标。`
              : `- 本轮手动锁定目标：${writingTargetTitle}${writingTargetSubsection ? ` / ${writingTargetSubsection}` : ''}（${writingTargetChapter}.txt）；不得自行改章。`)
          : (explicitFileWriteIntent
              ? `- 本轮用户显式指定工作目录文件“${explicitFileWriteIntent.target}”，不进入章节草稿自动识别。`
              : '- 本轮为自动识别模式：保存时根据最新 query、论文结构、正文标题和内容功能选择现有章节，或创建新的顶级章节 TXT。'),
      ].join('\n')
    : '';
  const explicitFileWriteSummary = explicitFileWriteIntent
    ? [
        '## 本轮显式工作目录文件目标（最高优先级）',
        `- 目标：${explicitFileWriteIntent.target}`,
        '- 递归搜索用户配置目录的全部后代目录和整个 ScholarHarness_AI_Workspaces 容器并解析实际文件；当前会话优先，但不能漏掉其他会话子目录；用户可能省略扩展名。',
        '- 使用文件/Office 工具在 AI 工作目录中更新该文件，后端会同步到用户配置目录。不要调用 save_draft，不要用右侧章节 TXT 代替指定文件。',
      ].join('\n')
    : '';
  const draftSaveReminder = buildCodexDraftSaveReminder(options, currentRequest);
  const rawPrompt = [
    '## System',
    '这是同一 Scholar Harness 对话的 Codex resume 轮次。',
    'Codex 已在首次启动时收到项目上下文、工作目录规则、长期记忆和工具使用规则；本轮不要重复依赖新的大块项目说明。',
    '本轮只处理下面的最新用户请求；如果需要文件、目录或代码细节，请直接使用当前 Codex 会话已有的工作目录能力确认。',
    workspaceRoot ? `当前授权工作目录：${workspaceRoot}` : '',
    codexSafeWorkspace ? `安全工作副本：${codexSafeWorkspace}` : '',
    `当前权限：${workspaceSandbox}`,
    queryEnvelopeSummary,
    queryIntentSummary,
    conversationHandoff,
    explicitFileWriteSummary,
    writingProgressSummary,
    options.agentSkillCatalogPrompt || '',
    options.explicitAgentSkillPrompt
      ? `## 用户本轮显式调用的 Skill\n${options.explicitAgentSkillPrompt}`
      : '',
    draftSaveReminder,
    buildCodexDraftWordExportReminder(options, currentRequest),
    CODEX_TRANSIENT_QA_ARTIFACT_RULE,
    '最终回答只包含给用户看的结果、必要说明和真实文件路径；不要输出对提示词、回答渠道、链接格式或“如何构造 final”的自言自语。',
    '学术正文只要出现作者-年份文内引用，本轮回答末尾必须同时给出一一对应的 References，并保留检索结果中全部可核验作者与元数据；禁止编造缺失字段。',
    '---',
    '<CURRENT_USER_REQUEST priority="highest">',
    currentRequest || '(empty request)',
    '</CURRENT_USER_REQUEST>',
    '<CURRENT_USER_REQUEST_RULES>',
    '1. 这是用户本轮最新请求，优先级高于历史对话、长期记忆、检索结果和旧任务。',
    '2. 如果上下文与本轮请求冲突，以本轮请求为准。',
    '3. 不要因为本轮没有重复发送项目 Manifest 就要求用户重新配置路径；需要时直接查当前工作目录。',
    '4. 用户询问“最新/最近/最新版文件”时，必须按相关候选文件的实际最后修改时间（mtime）降序核对，不能按文件名或目录枚举顺序猜测。',
    '5. 查找文件时必须递归搜索当前授权工作目录的全部后代目录和本会话 AI 工作目录；不能只查根目录直接文件或只查其中一处。',
    '</CURRENT_USER_REQUEST_RULES>',
  ].filter(Boolean).join('\n');
  return finalizeCodexProviderPrompt(rawPrompt, options, 'main-chat');
}

function formatCodexItemEvent(event: Record<string, unknown>, lowerType: string): string {
  const item = getCodexItem(event);
  if (!item) return '';
  const itemType = String(item.type || event.item_type || event.itemType || '').toLowerCase();
  const itemName = truncateCodexEventText(item.name || item.tool || item.tool_name || item.server || itemType || 'item');
  const text = truncateCodexEventText(pickCodexTextEvent(item, ['text', 'message', 'summary', 'delta', 'content']), 12000);
  const command = truncateCodexEventText(stringifyCodexCommand(item.command || item.cmd || item.args || item.argv || item.input), 3000);
  const args = truncateCodexEventText(item.arguments || item.args || item.input || '', 3000);
  const stdout = truncateCodexEventText(item.stdout || item.output || item.result || '', 6000);
  const stderr = truncateCodexEventText(item.stderr || item.error || '', 3000);
  const isStarted = lowerType.includes('started') || lowerType.includes('start');
  const isCompleted = lowerType.includes('completed') || lowerType.includes('complete');

  if (itemType === 'agent_message' || itemType === 'assistant_message' || itemType === 'message') {
    if (isStarted && !text) return `\n→ Codex 正在生成回答\n`;
    return text ? `${text}` : '';
  }

  if (itemType.includes('reasoning') || itemType.includes('thought')) {
    if (isStarted && !text) return `\n思考：Codex 正在推理\n`;
    return text ? `\n思考：${text}\n` : '';
  }

  if (itemType.includes('exec') || itemType.includes('command') || itemType.includes('shell')) {
    if (isStarted) return command ? `\n→ exec_shell: ${command}\n` : `\n→ exec_shell\n`;
    if (isCompleted) {
      const chunks = [`\n✓ exec_shell 完成${command ? `: ${command}` : ''}`];
      if (stdout) chunks.push(`stdout:\n${stdout}`);
      if (stderr) chunks.push(`stderr:\n${stderr}`);
      return `${chunks.join('\n')}\n`;
    }
    return command ? `\nexec_shell: ${command}\n` : '';
  }

  if (itemType.includes('tool') || itemType.includes('mcp') || itemType.includes('function')) {
    if (isStarted) {
      return `\n→ tool: ${itemName || 'unknown'}${args ? `\n${args}` : ''}\n`;
    }
    if (isCompleted) {
      return `\n✓ tool 完成: ${itemName || 'unknown'}${stdout ? `\n${stdout}` : ''}${stderr ? `\n${stderr}` : ''}\n`;
    }
    return `\ntool: ${itemName || 'unknown'}${args ? `\n${args}` : ''}\n`;
  }

  if (text) return `\n${text}\n`;
  if (isStarted) return `\n→ ${itemName || 'Codex item'} 开始\n`;
  if (isCompleted) return `\n✓ ${itemName || 'Codex item'} 完成\n`;
  return '';
}

function formatCodexJsonEvent(line: string, onThreadId?: (threadId: string) => void): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(event.type || event.event || event.kind || '').trim();
    const lowerType = type.toLowerCase();

    if (lowerType === 'thread.started' || lowerType === 'thread_started') {
      const threadId = truncateCodexEventText(event.thread_id || event.threadId || '');
      if (threadId) onThreadId?.(threadId);
      return `\nCodex 会话已启动${threadId ? `，thread：${threadId}` : ''}\n`;
    }

    if (lowerType === 'turn.started' || lowerType === 'turn_started') {
      return `\n→ Codex 开始一轮推理\n`;
    }

    if (lowerType === 'turn.completed' || lowerType === 'turn_completed') {
      return `\n✓ Codex 本轮推理完成${formatCodexUsage(event.usage)}\n`;
    }

    if (lowerType.startsWith('item.') || lowerType.startsWith('item_')) {
      const itemEvent = formatCodexItemEvent(event, lowerType);
      if (itemEvent) return itemEvent;
    }

    if (lowerType === 'session_configured' || lowerType === 'session_started') {
      const model = truncateCodexEventText(event.model || event.model_slug || '');
      const sessionId = truncateCodexEventText(event.session_id || event.sessionId || '');
      return `\nCodex 会话已启动${model ? `，模型：${model}` : ''}${sessionId ? `，session：${sessionId}` : ''}\n`;
    }

    if (lowerType.includes('reasoning') || lowerType.includes('thought')) {
      const text = truncateCodexEventText(pickCodexTextEvent(event, ['text', 'message', 'summary', 'delta', 'content']));
      return text ? `\n思考：${text}\n` : '';
    }

    if (lowerType.includes('agent_message') || lowerType.includes('assistant_message') || lowerType === 'message') {
      const text = truncateCodexEventText(pickCodexTextEvent(event, ['message', 'text', 'delta', 'content']));
      return text ? `${text}` : '';
    }

    if (lowerType.includes('exec') || lowerType.includes('command') || lowerType.includes('shell')) {
      const command = truncateCodexEventText(stringifyCodexCommand(event.command || event.cmd || event.args || event.argv || event.input));
      const exitCode = event.exit_code ?? event.exitCode ?? event.code;
      const stdout = truncateCodexEventText(event.stdout, 6000);
      const stderr = truncateCodexEventText(event.stderr, 3000);
      if (lowerType.includes('begin') || lowerType.includes('start') || lowerType.includes('call')) {
        return command ? `\n→ exec_shell: ${command}\n` : `\n→ exec_shell\n`;
      }
      if (lowerType.includes('end') || lowerType.includes('finish') || lowerType.includes('complete') || exitCode !== undefined) {
        const chunks = [`\n✓ exec_shell 完成${exitCode !== undefined ? `，退出码 ${exitCode}` : ''}`];
        if (stdout) chunks.push(`stdout:\n${stdout}`);
        if (stderr) chunks.push(`stderr:\n${stderr}`);
        return `${chunks.join('\n')}\n`;
      }
      return command ? `\nexec_shell: ${command}\n` : '';
    }

    if (lowerType.includes('tool') || lowerType.includes('mcp')) {
      const name = truncateCodexEventText(event.name || event.tool || event.tool_name || event.server || '');
      const args = truncateCodexEventText(event.arguments || event.args || event.input || '', 3000);
      const output = truncateCodexEventText(event.output || event.result || event.content || '', 5000);
      if (lowerType.includes('begin') || lowerType.includes('start') || lowerType.includes('call')) {
        return `\n→ tool: ${name || 'unknown'}${args ? `\n${args}` : ''}\n`;
      }
      if (lowerType.includes('end') || lowerType.includes('finish') || lowerType.includes('complete')) {
        return `\n✓ tool 完成: ${name || 'unknown'}${output ? `\n${output}` : ''}\n`;
      }
      return `\ntool: ${name || 'unknown'}${output ? `\n${output}` : ''}\n`;
    }

    if (lowerType.includes('error')) {
      const text = truncateCodexEventText(event.message || event.error || event.detail || trimmed, 5000);
      return `\n! Codex error: ${text}\n`;
    }

    return '';
  } catch {
    return `${line}\n`;
  }
}

function consumeCodexJsonEventState(
  line: string,
  handlers: {
    onThreadId?: (threadId: string) => void;
    onAgentText?: (text: string) => void;
  }
): void {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(event.type || event.event || event.kind || '').trim();
    const lowerType = type.toLowerCase();

    if (lowerType === 'thread.started' || lowerType === 'thread_started') {
      const threadId = truncateCodexEventText(event.thread_id || event.threadId || '');
      if (threadId) handlers.onThreadId?.(threadId);
      return;
    }

    const item = getCodexItem(event);
    if (item) {
      const itemType = String(item.type || event.item_type || event.itemType || '').toLowerCase();
      if (itemType === 'agent_message' || itemType === 'assistant_message' || itemType === 'message') {
        const text = truncateCodexEventText(pickCodexTextEvent(item, ['text', 'message', 'summary', 'delta', 'content']), 12000);
        if (text) handlers.onAgentText?.(text);
      }
      return;
    }

    if (lowerType.includes('agent_message') || lowerType.includes('assistant_message') || lowerType === 'message') {
      const text = truncateCodexEventText(pickCodexTextEvent(event, ['message', 'text', 'delta', 'content']), 12000);
      if (text) handlers.onAgentText?.(text);
    }
  } catch {
    // Codex can print non-JSON lines in edge cases. They are ignored in compact mode.
  }
}

function isCodexAssistantMessageEventLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const type = String(event.type || event.event || event.kind || '').toLowerCase();
    const item = getCodexItem(event);
    const itemType = item
      ? String(item.type || event.item_type || event.itemType || '').toLowerCase()
      : '';
    return itemType === 'agent_message'
      || itemType === 'assistant_message'
      || itemType === 'message'
      || type.includes('agent_message')
      || type.includes('assistant_message')
      || type === 'message';
  } catch {
    return false;
  }
}

/**
 * 获取 PID 文件路径
 */
function getPidFilePath(): string {
  const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  return join(dataDir, OPENCLAW_PID_FILE);
}

/**
 * 检查进程是否在运行
 */
function isProcessRunning(pid: number): boolean {
  try {
    // 发送信号 0（不实际终止进程，仅检查进程是否存在）
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 读取 PID 文件
 */
function readPidFile(): number | null {
  try {
    const pidFile = getPidFilePath();
    if (!existsSync(pidFile)) {
      return null;
    }
    const pidStr = readFileSync(pidFile, 'utf-8').trim();
    const pid = parseInt(pidStr, 10);
    return isNaN(pid) ? null : pid;
  } catch (e) {
    return null;
  }
}

/**
 * 写入 PID 文件
 */
function writePidFile(pid: number): void {
  try {
    const pidFile = getPidFilePath();
    const pidDir = join(pidFile, '..');
    if (!existsSync(pidDir)) {
      mkdir(pidDir, { recursive: true });
    }
    writeFileSync(pidFile, String(pid), 'utf-8');
    logger.info(`[ChatBridge] PID 文件已写入: ${pid}`);
  } catch (e) {
    logger.error(`[ChatBridge] 写入 PID 文件失败: ${(e as Error).message}`);
  }
}

/**
 * 删除 PID 文件
 */
function removePidFile(): void {
  try {
    const pidFile = getPidFilePath();
    if (existsSync(pidFile)) {
      unlinkSync(pidFile);
      logger.info(`[ChatBridge] PID 文件已删除`);
    }
  } catch (e) {
    logger.warn(`[ChatBridge] 删除 PID 文件失败: ${(e as Error).message}`);
  }
}

// 获取 openclaw 目录路径
function getOpenclawPath(): string {
  if (process.env.OPENCLAW_DIR) {
    return process.env.OPENCLAW_DIR;
  }
  
  const resPath = (process as any).resourcesPath;
  if (resPath && typeof resPath === 'string') {
    const packagedPath = join(resPath, 'openclaw');
    if (existsSync(packagedPath)) {
      logger.debug(`[ChatBridge] Using packaged openclaw path: ${packagedPath}`);
      return packagedPath;
    }
  }
  
  return join(process.cwd(), 'openclaw');
}

/**
 * 解析主配置路径（统一优先级）
 * 第一优先级：CHAT_BRIDGE_CONFIG_PATH
 * 第二优先级：DATA_DIR/chat-bridge-config.json
 * 第三优先级（仅开发兜底）：默认 config.json
 */
function resolvePrimaryConfigPath(): string {
  // 第一优先级：显式传入的环境变量
  const explicitPath = process.env.CHAT_BRIDGE_CONFIG_PATH;
  if (explicitPath) {
    logger.info(`[ChatBridge] 显式配置路径: ${explicitPath}`);
    return explicitPath;
  }
  
  // 第二优先级：用户数据目录
  const userDataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
  const userConfigPath = join(userDataDir, 'chat-bridge-config.json');
  
  if (existsSync(userConfigPath)) {
    logger.info(`[ChatBridge] 用户配置路径: ${userConfigPath}`);
    return userConfigPath;
  }
  
  // 第三优先级：开发环境默认 config.json（仅当前两者都不存在时）
  const devFallback = join(process.cwd(), 'config.json');
  if (existsSync(devFallback)) {
    logger.info(`[ChatBridge] 开发兜底配置路径: ${devFallback} (仅 fallback)`);
    return devFallback;
  }
  
  // 最终兜底：openclaw 目录下的 config.json
  const openclawConfig = join(getOpenclawPath(), 'config.json');
  logger.info(`[ChatBridge] 最终兜底: ${openclawConfig}`);
  return openclawConfig;
}

export interface ChatBridgeConfig {
  mode: 'browser' | 'api' | 'auto';
  chat: {
    api_key?: string;
    api_url?: string;
    login_url?: string;
    chat_url: string;
    credentials?: {
      email: string;
      password: string;
    };
    bridge_secret?: string;
  };
  browser: {
    profile: string;
    timeout_ms: number;
    wait_for_response_ms: number;
  };
  service?: {
    enabled: boolean;
    port: number;
  };
  // ========== 新的双 Agent API 配置 ==========
  // 大牛马 API 配置（规划、Skill生成、质量检查）
  primary?: {
    api_url?: string;
    api_key?: string;
    model?: string;
    description?: string;
  };
  // 小牛马 API 配置（执行写作、引用验证）
  secondary?: {
    api_url?: string;
    api_key?: string;
    model?: string;
    vision_model?: string;
    description?: string;
  };
  secondary_vision?: {
    api_url?: string;
    api_key?: string;
    model?: string;
    description?: string;
  };
  codex?: {
    enabled?: boolean;
    prefer?: boolean;
    command?: string;
    model?: string;
    reasoning_effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
    sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
    timeout_ms?: number;
    pdf_wiki_concurrency?: number;
    concurrency?: number;
    app_server_enabled?: boolean;
    app_server_fallback_exec?: boolean;
    app_server_turn_timeout_ms?: number;
  };
}

export interface ChatBridgeChatOptions {
  model?: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatBridgeChatResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ChatBridgeState {
  serviceRunning: boolean;
  paused: boolean;
  currentUrl: string | null;
  hasActivePage: boolean;
}

export class ChatBridgeAdapter {
  private configPath: string;
  private config: ChatBridgeConfig | null = null;
  private selectors: {
    inputBox: string | null;
    sendButton: string | null;
    responseArea: string | null;
  } = {
    inputBox: null,
    sendButton: null,
    responseArea: null,
  };
  private openclawServiceProcess: ReturnType<typeof spawn> | null = null;
  private readonly activeCodexExecProcesses = new Map<string, ReturnType<typeof spawn>>();
  private paused = false;
  private serviceStarting = false;  // 互斥锁，防止并发启动

  constructor(configPath?: string) {
    if (configPath) {
      this.configPath = configPath;
      logger.info(`[ChatBridge] 使用传入配置路径: ${configPath}`);
    } else {
      this.configPath = resolvePrimaryConfigPath();
      logger.info(`[ChatBridge] 解析配置路径: ${this.configPath}`);
    }
  }

  async loadConfig(): Promise<ChatBridgeConfig> {
    try {
      // 默认配置模板
      const defaults: ChatBridgeConfig = {
        mode: 'api',  // 默认改为 API 模式
        chat: {
          chat_url: '',
          credentials: { email: '', password: '' },
        },
        browser: {
          profile: 'chrome',
          timeout_ms: 300000,
          wait_for_response_ms: 240000,
        },
        service: {
          enabled: true,
          port: 19222,
        },
        // 默认的双 Agent 配置
        primary: {
          api_url: '',
          api_key: '',
          model: 'claude-sonnet-4-5',
          description: '大牛马 - 规划、Skill生成、写作',
        },
        secondary: {
          api_url: '',
          api_key: '',
          model: 'gpt-4o',
          vision_model: 'gpt-4o',
          description: '小牛马 - 引用验证、更新记忆',
        },
        secondary_vision: {
          api_url: '',
          api_key: '',
          model: 'gpt-4o',
          description: '小牛马视觉 - 图片、图表截图、多模态输入',
        },
        codex: {
          enabled: false,
          prefer: false,
          command: '',
          model: 'gpt-5.5',
          reasoning_effort: 'xhigh',
          sandbox: 'workspace-write',
          timeout_ms: 300000,
          pdf_wiki_concurrency: 1,
          app_server_enabled: true,
          app_server_fallback_exec: true,
          app_server_turn_timeout_ms: 1800000,
        },
      };
      
      // 检查配置文件是否存在
      if (!existsSync(this.configPath)) {
        logger.info(`[ChatBridge] 配置文件不存在，创建默认空白配置: ${this.configPath}`);
        
        // 确保目录存在
        const configDir = join(this.configPath, '..');
        if (!existsSync(configDir)) {
          await mkdir(configDir, { recursive: true });
        }
        
        // 写入默认空白配置
        await writeFile(this.configPath, JSON.stringify(defaults, null, 2), 'utf-8');
        logger.info('[ChatBridge] 默认空白配置已创建，请在前端配置 AI 桥接');
        
        this.config = defaults;
        return this.config;
      }
      
      // 文件存在，读取并解析
      const configData = await readFile(this.configPath, 'utf-8');
      const parsed = JSON.parse(configData);
      
      this.config = {
        ...defaults,
        ...parsed,
        chat: { ...defaults.chat, ...parsed.chat },
        browser: { ...defaults.browser, ...(parsed.browser || {}) },
        service: { ...defaults.service, ...(parsed.service || {}) },
        primary: { ...defaults.primary, ...(parsed.primary || {}) },
        secondary: { ...defaults.secondary, ...(parsed.secondary || {}) },
        secondary_vision: { ...defaults.secondary_vision, ...(parsed.secondary_vision || {}) },
        codex: { ...defaults.codex, ...(parsed.codex || {}) },
      } as ChatBridgeConfig;
      
      // 解密加密字段 - chat 配置
      if (this.config.chat?.api_key && isEncrypted(this.config.chat.api_key)) {
        try {
          this.config.chat.api_key = decrypt(this.config.chat.api_key);
          logger.info('[ChatBridge] chat.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt chat.api_key, using as-is');
        }
      }
      
      if (this.config.chat?.credentials?.password && isEncrypted(this.config.chat.credentials.password)) {
        try {
          this.config.chat.credentials.password = decrypt(this.config.chat.credentials.password);
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt password, using as-is');
        }
      }
      
      if (this.config.chat?.bridge_secret && isEncrypted(this.config.chat.bridge_secret)) {
        try {
          this.config.chat.bridge_secret = decrypt(this.config.chat.bridge_secret);
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt bridge_secret, using as-is');
        }
      }
      
      // 解密加密字段 - primary 配置
      if (this.config.primary?.api_key && isEncrypted(this.config.primary.api_key)) {
        try {
          this.config.primary.api_key = decrypt(this.config.primary.api_key);
          logger.info('[ChatBridge] primary.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt primary.api_key, using as-is');
        }
      }
      
      // 解密加密字段 - secondary 配置
      if (this.config.secondary?.api_key && isEncrypted(this.config.secondary.api_key)) {
        try {
          this.config.secondary.api_key = decrypt(this.config.secondary.api_key);
          logger.info('[ChatBridge] secondary.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt secondary.api_key, using as-is');
        }
      }

      // 解密加密字段 - secondary_vision 配置
      if (this.config.secondary_vision?.api_key && isEncrypted(this.config.secondary_vision.api_key)) {
        try {
          this.config.secondary_vision.api_key = decrypt(this.config.secondary_vision.api_key);
          logger.info('[ChatBridge] secondary_vision.api_key decrypted successfully');
        } catch (e) {
          logger.warn('[ChatBridge] Failed to decrypt secondary_vision.api_key, using as-is');
        }
      }
      
      const maskedEmail = maskEmail(this.config.chat?.credentials?.email);
      const hasPrimaryConfig = !!this.config.primary?.api_url && !!this.config.primary?.api_key;
      const hasSecondaryConfig = !!this.config.secondary?.api_url && !!this.config.secondary?.api_key;
      const hasSecondaryVisionConfig = !!this.config.secondary_vision?.api_url && !!this.config.secondary_vision?.api_key;
      const codexPreferred = this.config.codex?.enabled !== false && !!this.config.codex?.prefer;
      logger.info(`[ChatBridge] 配置加载完成 | mode=${this.config.mode} | primary_valid=${hasPrimaryConfig} | secondary_valid=${hasSecondaryConfig} | secondary_vision_valid=${hasSecondaryVisionConfig} | codex_prefer=${codexPreferred ? 'enabled' : 'disabled'} | primary_model=${this.config.primary?.model} | secondary_model=${this.config.secondary?.model} | secondary_vision_model=${this.config.secondary_vision?.model || this.config.secondary?.vision_model}`);
      
      return this.config;
    } catch (error) {
      logger.error(`[ChatBridge] 配置加载失败：${(error as Error).message}`);
      throw error;
    }
  }

  private resolveCodexCliExecutable(): string {
    const found = this.findCodexCliExecutable();
    if (found) return found;
    return 'codex';
  }

  private resolveCodexNativeExecutable(): string {
    const configured = this.findCodexCliExecutable();
    if (configured && /\.exe$/i.test(configured)) return configured;
    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming');
      const npmRoot = configured && /\.(?:cmd|bat|ps1)$/i.test(configured)
        ? path.dirname(configured)
        : join(appData, 'npm');
      const nativeCandidates = [
        join(npmRoot, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'),
        join(npmRoot, 'node_modules', '@openai', 'codex', 'node_modules', '@openai', 'codex-win32-arm64', 'vendor', 'aarch64-pc-windows-msvc', 'bin', 'codex.exe'),
      ];
      const native = nativeCandidates.find(candidate => existsSync(candidate));
      if (native) return native;
    }
    return configured || 'codex';
  }

  private resolveCodexMcpServerScript(): string {
    const candidates = [
      join(__dirname, 'codex-mcp-stdio.js'),
      path.resolve(process.cwd(), 'dist', 'src', 'bridge', 'chat-bridge', 'codex-mcp-stdio.js'),
    ];
    const script = candidates.find(candidate => existsSync(candidate));
    if (!script) {
      throw new Error('Codex MCP bridge has not been built; run npm run build first');
    }
    return script;
  }

  private spawnCodexAppServer(
    executable: string,
    mcpScript: string,
    connection: CodexToolGatewayConnection,
  ): ReturnType<typeof spawn> {
    repairLegacyCodexModelsCache();
    const tomlString = (value: string): string => JSON.stringify(value.replace(/\\/g, '/'));
    const args = [
      '-c', 'mcp_servers.notion.enabled=false',
      '-c', 'mcp_servers.node_repl.enabled=false',
      '-c', 'sandbox_workspace_write.network_access=true',
      '-c', `mcp_servers.scholar_harness.command=${tomlString(process.execPath)}`,
      '-c', `mcp_servers.scholar_harness.args=[${tomlString(mcpScript)}]`,
      '-c', 'mcp_servers.scholar_harness.env_vars=["ELECTRON_RUN_AS_NODE","SCHOLAR_HARNESS_CODEX_GATEWAY_URL","SCHOLAR_HARNESS_CODEX_GATEWAY_TOKEN","SCHOLAR_HARNESS_CODEX_SESSION_KEY"]',
      '-c', 'mcp_servers.scholar_harness.startup_timeout_sec=20',
      '-c', 'mcp_servers.scholar_harness.tool_timeout_sec=1800',
      'app-server',
    ];
    const env = {
      ...buildToolRuntimeEnv(process.env),
      ELECTRON_RUN_AS_NODE: '1',
      SCHOLAR_HARNESS_CODEX_GATEWAY_URL: connection.url,
      SCHOLAR_HARNESS_CODEX_GATEWAY_TOKEN: connection.token,
      SCHOLAR_HARNESS_CODEX_SESSION_KEY: connection.sessionKey,
    };
    const isWindowsScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    if (isWindowsScript) {
      return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', executable, ...args], {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env,
      });
    }
    return spawn(executable, args, {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env,
    });
  }

  private normalizeCodexCliCommand(value?: string): string {
    return String(value || '').trim().replace(/^["']|["']$/g, '');
  }

  private findCodexCliExecutable(commandOverride?: string): string | null {
    const candidates: string[] = [];
    const override = this.normalizeCodexCliCommand(commandOverride);
    const configured = this.normalizeCodexCliCommand(this.config?.codex?.command);
    const envPath = this.normalizeCodexCliCommand(process.env.CODEX_CLI_PATH);
    if (override) candidates.push(override);
    if (configured) candidates.push(configured);
    if (envPath) candidates.push(envPath);

    if (process.platform === 'win32') {
      const appData = process.env.APPDATA || join(os.homedir(), 'AppData', 'Roaming');
      const localAppData = process.env.LOCALAPPDATA || join(os.homedir(), 'AppData', 'Local');
      candidates.push(
        join(appData, 'npm', 'codex.cmd'),
        join(appData, 'npm', 'codex.exe'),
        join(appData, 'npm', 'codex.ps1'),
        join(localAppData, 'Programs', 'codex', 'codex.exe')
      );
    } else {
      candidates.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', '/usr/bin/codex');
    }

    const pathExts = process.platform === 'win32'
      ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map(ext => ext.toLowerCase())
      : [''];
    for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
      if (process.platform === 'win32') {
        for (const ext of pathExts) {
          candidates.push(join(dir, `codex${ext.toLowerCase()}`));
        }
      } else {
        candidates.push(join(dir, 'codex'));
      }
    }

    const uniqueCandidates = [...new Set(candidates.filter(Boolean))];
    return uniqueCandidates.find(candidate => existsSync(candidate)) || null;
  }

  private spawnCodexProcess(executable: string, args: string[]): ReturnType<typeof spawn> {
    const env = buildToolRuntimeEnv(process.env);
    const isWindowsPowerShellScript = process.platform === 'win32' && /\.ps1$/i.test(executable);
    if (isWindowsPowerShellScript) {
      return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args], {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env,
      });
    }

    const isWindowsBatchScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
    if (!isWindowsBatchScript) {
      return spawn(executable, args, {
        cwd: process.cwd(),
        shell: false,
        windowsHide: true,
        env,
      });
    }

    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', executable, ...args], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env,
    });
  }

  async getCodexCliStatus(commandOverride?: string): Promise<{ available: boolean; path: string; version?: string; error?: string }> {
    if (!this.config) {
      await this.loadConfig();
    }
    const executable = this.findCodexCliExecutable(commandOverride);
    if (!executable) {
      return { available: false, path: '', error: '未在常见路径或 PATH 中找到 codex 命令' };
    }

    try {
      const version = await new Promise<string>((resolve, reject) => {
        const child = this.spawnCodexProcess(executable, ['--version']);
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill();
          reject(new Error('Codex CLI version check timed out'));
        }, 10000);
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
            reject(new Error(stderr || stdout || `Codex CLI exited with code ${code}`));
            return;
          }
          resolve((stdout || stderr).trim());
        });
      });
      return { available: true, path: executable, version };
    } catch (error) {
      return { available: false, path: executable, error: (error as Error).message };
    }
  }

  private buildApiMessages(options: ChatOptions): Message[] {
    const messages = attachVisionImagesToMessages(
      options.messages,
      options.visionImages || [],
      !!options.requiresVision,
    ) as Message[];
    if (messages !== options.messages) {
      logger.info(`[ChatBridge] Attached vision image(s) to the last user API message`);
    }
    return messages;
  }

  private buildCodexPrompt(options: ChatOptions): string {
    return options.messages
      .map((message) => {
        const role = message.role === 'system'
          ? 'System'
          : (message.role === 'assistant' ? 'Assistant' : 'User');
        return `## ${role}\n${stringifyMessageContent(message.content)}`;
      })
      .join('\n\n');
  }

  private async runCodexAppServer(options: ChatOptions): Promise<string> {
    throwIfCodexCancelled(options);
    const codexConfig = this.config?.codex || {};
    const codexModel = String(options.codexModel || codexConfig.model || '').trim();
    const codexReasoningEffort = options.codexReasoningEffort || codexConfig.reasoning_effort;
    const executable = this.resolveCodexNativeExecutable();
    const mcpScript = this.resolveCodexMcpServerScript();
    const workspaceRoot = String(options.workspaceDirectory?.root || options.workspaceDirectory?.path || '').trim();
    const workspaceSandbox = options.workspaceDirectory?.permission || codexConfig.sandbox || 'workspace-write';
    const preferredSafeWorkspace = String(
      options.workspaceDirectory?.aiWorkRoot
      || options.workspaceDirectory?.safeWorkRoot
      || ''
    ).trim();
    const conversationKey = buildCodexConversationKey(options, workspaceRoot);
    const hadExistingThread = codexAppServerManager.hasThread(conversationKey);
    const codexSafeWorkspace = workspaceRoot && workspaceSandbox !== 'read-only'
      ? await prepareCodexSafeWorkspace(workspaceRoot, conversationKey, preferredSafeWorkspace)
      : null;
    const codexCwd = codexSafeWorkspace || (workspaceRoot && existsSync(workspaceRoot) ? workspaceRoot : process.cwd());
    const currentRequest = extractCodexCurrentRequest(options);
    const shouldTrackSourceArtifacts = !!workspaceRoot && isCodexFileMutationRequest(currentRequest);
    const artifactSnapshot = codexSafeWorkspace
      ? snapshotCodexArtifactFiles(codexSafeWorkspace)
      : new Map<string, CodexArtifactSnapshotItem>();
    const sourceArtifactSnapshot = shouldTrackSourceArtifacts
      ? snapshotCodexArtifactFiles(workspaceRoot, 10_000, { skipAiWorkspaceContainer: true })
      : new Map<string, CodexArtifactSnapshotItem>();
    const rawPrompt = hadExistingThread
      ? buildCodexResumePrompt(options, workspaceRoot, codexSafeWorkspace, workspaceSandbox)
      : [
          codexSafeWorkspace
            ? [
                '## System',
                'Scholar Harness 安全工作区规则：',
                `- 原始工作目录：${workspaceRoot}`,
                `- 安全工作副本：${codexSafeWorkspace}`,
                '- 根目录授权自动覆盖全部后代目录和文件；使用 scholar_harness MCP 的文件/Office 工具递归搜索用户配置目录、整个 ScholarHarness_AI_Workspaces 容器以及当前会话和其他会话的 AI 产物目录。',
                '- 所有写入、编辑、生成文件和命令执行先发生在 AI 工作目录；后端会把生成/更新文件按相对路径同步到用户配置目录。',
                '- 最终回答说明两处真实文件路径。',
              ].join('\n')
            : '',
          options.agentSkillCatalogPrompt || '',
          buildCodexDraftSaveReminder(options, currentRequest),
          buildCodexDraftWordExportReminder(options, currentRequest),
          CODEX_TRANSIENT_QA_ARTIFACT_RULE,
          '最终回答只包含给用户看的结果、必要说明和真实文件路径；不要输出对提示词、回答渠道、链接格式或“如何构造 final”的自言自语。',
          this.buildCodexPrompt(options),
        ].filter(Boolean).join('\n\n');
    const prompt = hadExistingThread
      ? rawPrompt
      : finalizeCodexProviderPrompt(rawPrompt, options, 'main-chat');
    const requestedTurnTimeoutMs = Number(options.codexTimeoutMs);
    const timeoutMs = requestedTurnTimeoutMs < 0
      ? -1
      : Math.max(
          Number(options.codexTimeoutMs || 0),
          Number(codexConfig.app_server_turn_timeout_ms || 1_800_000),
        );
    const codexImages = Array.from(new Set(
      (options.codexImages || [])
        .map(imagePath => String(imagePath || '').trim())
        .filter(imagePath => imagePath && existsSync(imagePath))
    ));
    const hasNativeDraftTool = !!options.codexToolSet?.definitions.some(tool => tool.function.name === 'save_draft');
    const developerInstructions = [
      'You are running inside Scholar Harness through Codex App Server.',
      options.codexToolSet?.definitions.length
        ? 'A local MCP server named scholar_harness exposes the application tools. Use those tools for workspace files, Office documents, configured R/Python runtimes, draft saving, and Scholar Harness Skills instead of claiming an action without executing it.'
        : '',
      workspaceRoot ? `The authorized source workspace is ${workspaceRoot}. Authorization applies recursively to every ordinary descendant directory and file; do not limit discovery to top-level entries and do not follow links outside this root.` : '',
      codexSafeWorkspace ? `Run mutations and shell commands in the AI work directory ${codexSafeWorkspace}; Scholar Harness mirrors generated and updated files to ${workspaceRoot}. For discovery, recursively search the full source tree and the complete ScholarHarness_AI_Workspaces container, including other conversation subfolders inside the authorized root.` : '',
      'On Windows, shell commands run in PowerShell. Do not use bash operators such as ||, &&, 2>nul, grep, or ls -la.',
      hasNativeDraftTool
        ? 'When the user asks to save or update the article draft, call scholar_harness.save_draft and only report success after it returns ok=true.'
        : '',
      isCodexDraftWordExportRequest(currentRequest)
        ? 'For manuscript DOCX output, set all body text, headings, tables, captions, and references to Times New Roman unless the user explicitly requests another font.'
        : '',
      CODEX_TRANSIENT_QA_ARTIFACT_RULE,
      'Use real tool results and verified paths. Never fabricate file writes, draft saves, command output, references, or artifact links.',
    ].filter(Boolean).join('\n');

    let visibleTranscript = '';
    const emitProgress = (message: string): void => {
      if (!message) return;
      visibleTranscript += message;
      try {
        options.onProgress?.(message);
      } catch {
        // UI progress callbacks must not break the Codex turn.
      }
    };
    const startedAt = Date.now();
    emitProgress([
      'Codex Agent 已启动，正在处理当前问题。',
      hadExistingThread ? `复用 Codex App Server thread：${codexAppServerManager.getThreadId(conversationKey)}` : '新建持久 Codex App Server 会话。',
      workspaceRoot ? `工作目录：${workspaceRoot}` : '',
      codexSafeWorkspace ? `安全工作副本：${codexSafeWorkspace}` : '',
      `权限：${workspaceSandbox}`,
      options.codexToolSet?.definitions.length ? `Scholar Harness 原生工具：${options.codexToolSet.definitions.length} 个` : '',
      '',
    ].filter(Boolean).join('\n'));
    const heartbeatTimer = setInterval(() => {
      const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      try {
        options.onProgress?.(`[[SH_STATUS:codex-running:${elapsedSeconds}]]`);
      } catch {
        // Status updates are best effort.
      }
    }, 5_000);

    try {
      throwIfCodexCancelled(options);
      const result: CodexAppServerTurnResult = await codexAppServerManager.runTurn({
        conversationKey,
        cwd: codexCwd,
        prompt,
        model: codexModel || undefined,
        reasoningEffort: codexReasoningEffort,
        sandbox: workspaceSandbox,
        timeoutMs,
        compactInputTokenThreshold: CODEX_AUTO_COMPACT_INPUT_TOKEN_THRESHOLD,
        developerInstructions,
        imagePaths: codexImages,
        skillRoots: options.agentSkillRoots || [],
        toolSet: options.codexToolSet,
        isCancelled: options.isCancelled,
        takeSteeringMessages: options.piSession?.takeSteeringMessages,
        markSteeringApplied: options.piSession?.markSteeringApplied,
        requeueSteeringMessage: options.piSession?.requeueSteeringMessage,
        spawnAppServer: connection => this.spawnCodexAppServer(executable, mcpScript, connection),
        onProgress: emitProgress,
      });
      codexSessionByConversation.set(conversationKey, result.threadId);
      if (result.usage) {
        codexLastUsageByConversation.set(conversationKey, {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          reasoningTokens: result.usage.reasoningTokens,
          observedAt: new Date().toISOString(),
        });
      }

      let answer = sanitizeCodexFinalAnswer(result.answer);
      const draftReceipts = result.receipts.filter(receipt => receipt.name === 'save_draft' && receipt.ok);
      for (const receipt of draftReceipts) {
        const toolResult = receipt.result && typeof receipt.result === 'object'
          ? receipt.result as { ok?: boolean; summary?: string }
          : {};
        if (toolResult.ok === false) continue;
        const summary = String(toolResult.summary || '').trim();
        if (summary) {
          const authoritativeReceipt = `✅ ${summary}，并同步整篇导出文件。`;
          if (!answer.includes(authoritativeReceipt)) answer += `\n\n${authoritativeReceipt}`;
        }
      }

      let deterministicDraftWordPath = '';
      let deterministicDraftWordError = '';
      if (isCodexDraftWordExportRequest(currentRequest)) {
        const draftContent = getCodexDraftWordExportContent(options);
        if (!draftContent) {
          deterministicDraftWordError = '未读取到右侧文章写作进度中的规范章节 TXT';
        } else {
          const draftOutputRoot = codexSafeWorkspace || join(
            getDataDir(),
            'exports',
            sanitizePathUserId(options.userId || 'web-user')
          );
          deterministicDraftWordPath = join(draftOutputRoot, 'paper-draft.docx');
          emitProgress('\n→ Scholar Harness 正在用规范章节 TXT 重建 Word 草稿\n');
          try {
            await writeWordDraftDocx(deterministicDraftWordPath, draftContent);
            emitProgress(`✓ Word 草稿已真实写入并校验路径：${deterministicDraftWordPath}\n`);
          } catch (error) {
            deterministicDraftWordError = (error as Error).message || 'Word 文件写入失败';
            deterministicDraftWordPath = '';
          }
        }
      }

      const changedSafeArtifacts = codexSafeWorkspace
        ? collectChangedCodexArtifacts(codexSafeWorkspace, artifactSnapshot, CODEX_MAX_MIRRORED_ARTIFACTS)
        : [];
      if (deterministicDraftWordPath && !changedSafeArtifacts.includes(deterministicDraftWordPath)) {
        changedSafeArtifacts.unshift(deterministicDraftWordPath);
      }
      const changedSourceCandidates = shouldTrackSourceArtifacts
        ? collectChangedCodexArtifacts(
            workspaceRoot,
            sourceArtifactSnapshot,
            CODEX_MAX_MIRRORED_ARTIFACTS,
            { skipAiWorkspaceContainer: true },
          )
        : [];
      const explicitFileTarget = extractExplicitWorkspaceFileWriteIntent(currentRequest)?.target || '';
      const receiptEvidence = result.receipts.map(receipt => {
        try {
          return JSON.stringify(receipt);
        } catch {
          return `${receipt.name}:${receipt.ok}`;
        }
      }).join('\n');
      const changedSourceArtifacts = filterChangedCodexSourceArtifacts(
        changedSourceCandidates,
        workspaceRoot,
        [answer, visibleTranscript, currentRequest, receiptEvidence].join('\n'),
        explicitFileTarget,
      );
      if (workspaceSandbox === 'read-only' && changedSourceArtifacts.length > 0) {
        logger.warn(
          `[ChatBridge] Detected ${changedSourceArtifacts.length} verified source-workspace change(s) `
          + `during a read-only Codex turn; preserving the real artifacts for the UI`
        );
      }
      const mirroredArtifacts = await mirrorCodexWorkspaceArtifacts(
        changedSafeArtifacts,
        workspaceRoot,
        codexSafeWorkspace
      );
      const verifiedArtifacts = [
        ...changedSafeArtifacts,
        ...changedSourceArtifacts,
        ...mirroredArtifacts.mirroredPaths.slice(0, CODEX_MAX_VERIFIED_ARTIFACT_PATHS / 2),
      ].slice(0, CODEX_MAX_VERIFIED_ARTIFACT_PATHS);
      const artifactBlock = buildCodexVerifiedArtifactBlock(verifiedArtifacts);
      const verificationWarning = verifiedArtifacts.length === 0 && isCodexFileMutationRequest(currentRequest)
        && draftReceipts.length === 0
        ? '⚠️ Scholar Harness 未检测到本轮真实文件变更，因此没有把 Codex 的“已写入/已生成”表述认定为完成。'
        : '';
      const draftWordWarning = deterministicDraftWordError
        ? `⚠️ Word 草稿未导出：${deterministicDraftWordError}。`
        : '';
      const answerWithArtifacts = [answer, artifactBlock, mirroredArtifacts.warning, draftWordWarning, verificationWarning]
        .filter(Boolean)
        .join('\n\n')
        .trim();
      codexLastAnswerByConversation.set(conversationKey, truncateCodexEventText(answerWithArtifacts, 4000));
      logger.info(`[ChatBridge] Codex App Server turn completed | thread=${result.threadId} | turn=${result.turnId} | resumed=${result.resumed} | compacted=${result.compacted} | tools=${result.receipts.length}`);
      const transcript = visibleTranscript.trim();
      return options.onProgress && transcript
        ? `${transcript}\n\n## Codex 最终回答\n\n${answerWithArtifacts}`
        : answerWithArtifacts;
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async runCodexCli(options: ChatOptions): Promise<string> {
    throwIfCodexCancelled(options);
    const codexConfig = this.config?.codex || {};
    const codexModel = String(options.codexModel || codexConfig.model || '').trim();
    const codexReasoningEffort = options.codexReasoningEffort || codexConfig.reasoning_effort;
    const executable = this.resolveCodexCliExecutable();
    const outputDir = await createSecureTempDir();
    const outputFile = join(outputDir, 'codex-last-message.txt');
    const requestedCliTimeoutMs = Number(options.codexTimeoutMs);
    const timeoutMs = requestedCliTimeoutMs < 0
      ? -1
      : Number(options.codexTimeoutMs || codexConfig.timeout_ms || 300000);
    const workspaceRoot = String(options.workspaceDirectory?.root || options.workspaceDirectory?.path || '').trim();
    const workspaceSandbox = options.workspaceDirectory?.permission || codexConfig.sandbox || 'workspace-write';
    const preferredSafeWorkspace = String(
      (options.workspaceDirectory as any)?.aiWorkRoot
      || (options.workspaceDirectory as any)?.safeWorkRoot
      || ''
    ).trim();
    const conversationKey = buildCodexConversationKey(options, workspaceRoot);
    let resumeThreadId = codexSessionByConversation.get(conversationKey) || '';
    const previousUsage = codexLastUsageByConversation.get(conversationKey);
    const shouldAutoCompact = !!resumeThreadId && shouldAutoCompactCodexSession(previousUsage);
    const compactedThreadId = shouldAutoCompact ? resumeThreadId : '';
    const compactHandoff = shouldAutoCompact ? (codexLastAnswerByConversation.get(conversationKey) || '') : '';
    if (shouldAutoCompact) {
      codexSessionByConversation.delete(conversationKey);
      resumeThreadId = '';
      if (previousUsage) {
        logger.warn(`[ChatBridge] Codex auto compact triggered | conversation=${conversationKey} | oldThread=${compactedThreadId} | usage=${formatCodexUsageSnapshot(previousUsage)}`);
      }
    }
    const codexSafeWorkspace = workspaceRoot && workspaceSandbox !== 'read-only'
      ? await prepareCodexSafeWorkspace(workspaceRoot, conversationKey, preferredSafeWorkspace)
      : null;
    const codexCwd = codexSafeWorkspace || (workspaceRoot && existsSync(workspaceRoot) ? workspaceRoot : process.cwd());
    const runtimeSignature = buildCodexRuntimeSignature(codexCwd, workspaceSandbox);
    const previousRuntimeSignature = codexCliRuntimeSignatureByConversation.get(conversationKey) || '';
    const runtimeChanged = !!resumeThreadId
      && !!previousRuntimeSignature
      && previousRuntimeSignature !== runtimeSignature;
    if (runtimeChanged) {
      logger.info(
        `[ChatBridge] Codex CLI cwd/sandbox changed; starting a new runtime `
        + `while preserving visible conversation handoff | conversation=${conversationKey}`
      );
      codexSessionByConversation.delete(conversationKey);
      resumeThreadId = '';
    }
    codexCliRuntimeSignatureByConversation.set(conversationKey, runtimeSignature);
    const currentRequest = extractCodexCurrentRequest(options);
    const shouldTrackSourceArtifacts = !!workspaceRoot && isCodexFileMutationRequest(currentRequest);
    const artifactSnapshot = codexSafeWorkspace
      ? snapshotCodexArtifactFiles(codexSafeWorkspace)
      : new Map<string, CodexArtifactSnapshotItem>();
    const sourceArtifactSnapshot = shouldTrackSourceArtifacts
      ? snapshotCodexArtifactFiles(workspaceRoot, 10_000, { skipAiWorkspaceContainer: true })
      : new Map<string, CodexArtifactSnapshotItem>();
    const args = resumeThreadId
      ? [
          'exec',
          'resume',
          '--skip-git-repo-check',
          '--json',
          '--output-last-message',
          outputFile,
        ]
      : [
          'exec',
          '--skip-git-repo-check',
          '--json',
          '--color',
          'never',
          '--cd',
          codexCwd,
          '--sandbox',
          workspaceSandbox,
          '--output-last-message',
          outputFile,
        ];
    if (!resumeThreadId && workspaceRoot && existsSync(workspaceRoot)) {
      args.push('--add-dir', workspaceRoot);
    }
    if (!resumeThreadId) {
      const seenSkillRoots = new Set<string>();
      for (const rawRoot of options.agentSkillRoots || []) {
        const skillRoot = path.resolve(String(rawRoot || '').trim());
        const key = process.platform === 'win32' ? skillRoot.toLowerCase() : skillRoot;
        if (!skillRoot || !existsSync(skillRoot) || seenSkillRoots.has(key)) continue;
        seenSkillRoots.add(key);
        args.push('--add-dir', skillRoot);
      }
    }
    if (codexModel) {
      args.push('-m', codexModel);
    }
    args.push('-c', 'sandbox_workspace_write.network_access=true');
    if (codexReasoningEffort) {
      args.push('-c', `model_reasoning_effort="${codexReasoningEffort}"`);
    }
    const codexImages = (options.codexImages || [])
      .map(imagePath => String(imagePath || '').trim())
      .filter(imagePath => imagePath && existsSync(imagePath));
    Array.from(new Set(codexImages.map(imagePath => path.dirname(imagePath)))).forEach(dir => {
      if (dir && existsSync(dir)) args.push('--add-dir', dir);
    });
    codexImages.forEach(imagePath => {
      args.push('-i', imagePath);
    });
    if (resumeThreadId) {
      args.push(resumeThreadId);
    }
    args.push('-');

    const rawPrompt = resumeThreadId
      ? buildCodexResumePrompt(options, workspaceRoot, codexSafeWorkspace, workspaceSandbox)
      : [
      shouldAutoCompact && previousUsage
        ? [
            '## System',
            'Codex 自动 compact：',
            `- 上一轮 Codex tokens ${formatCodexUsageSnapshot(previousUsage)}，input tokens 超过阈值 ${CODEX_AUTO_COMPACT_INPUT_TOKEN_THRESHOLD}。`,
            compactedThreadId ? `- 已停止 resume 旧 thread：${compactedThreadId}` : '',
            '- 本轮新建干净 Codex session，避免旧线程上下文继续滚雪球。',
            '- 请基于本轮 Scholar Harness 提供的当前上下文、工作目录能力和最新用户请求继续。',
            compactHandoff ? `- 上一轮最终回答摘录：\n${truncateCodexEventText(compactHandoff, 3000)}` : '',
          ].filter(Boolean).join('\n')
        : '',
      codexSafeWorkspace
        ? [
            '## System',
            'Scholar Harness 安全工作区规则：',
            `- 原始工作目录：${workspaceRoot}`,
            `- 安全工作副本：${codexSafeWorkspace}`,
            '- 根目录授权覆盖全部层级；查找文件时递归搜索用户配置目录的全部后代目录和整个 ScholarHarness_AI_Workspaces 容器（包括其他会话子目录）。在修改、生成、运行 R/Python/脚本之前，把需要使用的原始文件复制到当前会话 AI 工作目录中。',
            '- 如果用户要求处理 .docx/.xlsx/.pptx，优先使用已配置的 OfficeCLI（officecli 命令）读取、校验、渲染或修改 Office 文档。',
            '- 所有写入、编辑、生成文件和命令执行先发生在 AI 工作目录；后端会把生成/更新文件按相对路径同步到用户配置目录。',
            '- 最终回答说明两处真实文件路径。',
          ].join('\n')
        : '',
      options.agentSkillCatalogPrompt || '',
      buildCodexDraftSaveReminder(options, currentRequest),
      buildCodexDraftWordExportReminder(options, currentRequest),
      CODEX_TRANSIENT_QA_ARTIFACT_RULE,
      '最终回答只包含给用户看的结果、必要说明和真实文件路径；不要输出对提示词、回答渠道、链接格式或“如何构造 final”的自言自语。',
      this.buildCodexPrompt(options),
    ].filter(Boolean).join('\n\n');
    const prompt = resumeThreadId
      ? rawPrompt
      : finalizeCodexProviderPrompt(rawPrompt, options, 'main-chat');
    logger.info(`[ChatBridge] Codex CLI 调用 | command=${executable} | mode=${resumeThreadId ? 'resume-lite' : 'new'} | autoCompact=${shouldAutoCompact ? 'yes' : 'no'} | thread=${resumeThreadId || 'new'} | oldThread=${compactedThreadId || 'none'} | previousUsage=${previousUsage ? formatCodexUsageSnapshot(previousUsage) : 'none'} | model=${codexModel || 'default'} | effort=${codexReasoningEffort || 'default'} | prompt=${prompt.length} chars | images=${codexImages.length} | workspace=${workspaceRoot || 'none'} | safeWorkspace=${codexSafeWorkspace || 'none'} | sandbox=${workspaceSandbox} | conversation=${options.conversationId || 'none'}`);

    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    const codexStartedAt = Date.now();
    let visibleTranscript = '';
    const emitCodexProgress = (message: string): void => {
      if (!message) return;
      if (!options.onProgress) return;
      try {
        options.onProgress(message);
      } catch {
        // Progress callbacks must not fail the Codex run.
      }
    };
    const emitCodexTranscript = (message: string): void => {
      if (!message) return;
      visibleTranscript += message;
      emitCodexProgress(message);
    };

    try {
      emitCodexTranscript([
        `Codex CLI 已启动，正在处理当前问题。`,
        shouldAutoCompact && previousUsage
          ? `Codex 自动 compact：上一轮 ${formatCodexUsageSnapshot(previousUsage)} 超过阈值，已切换为新 Codex 会话。`
          : '',
        runtimeChanged ? '工作目录或权限已变化，已按新权限启动 Codex 运行环境；最近可见对话仍会继续交接。' : '',
        resumeThreadId ? `复用 Codex 会话：${resumeThreadId}；本轮附带最近可见对话交接，不重复发送大块项目上下文。` : '新建 Codex 会话：本轮会记录 thread，后续同一对话继续使用。',
        workspaceRoot ? `工作目录：${workspaceRoot}` : '',
        codexSafeWorkspace ? `安全工作副本：${codexSafeWorkspace}` : '',
        codexSafeWorkspace ? 'Codex 将同时检索用户目录和整个 ScholarHarness_AI_Workspaces 容器，生成/更新文件会同步保存到用户目录与当前会话 AI 工作目录。' : '',
        `权限：${workspaceSandbox}`,
        'Codex CLI 会实时显示公开工具事件；无新事件时仅刷新顶部运行时间。',
        '',
      ].filter(Boolean).join('\n'));

      heartbeatTimer = setInterval(() => {
        const elapsedSeconds = Math.max(1, Math.floor((Date.now() - codexStartedAt) / 1000));
        emitCodexProgress(`[[SH_STATUS:codex-running:${elapsedSeconds}]]`);
      }, 5_000);

      const content = await new Promise<string>((resolve, reject) => {
        throwIfCodexCancelled(options);
        const child = this.spawnCodexProcess(executable, args);
        this.activeCodexExecProcesses.set(conversationKey, child);

        let stdout = '';
        let stderr = '';
        let stdoutLineBuffer = '';
        let settled = false;
        let notionMcpWarningEmitted = false;
        let windowsSandboxWarningEmitted = false;
        let observedThreadId = resumeThreadId || '';
        let fallbackAgentText = '';
        let latestTurnUsage: CodexUsageSnapshot | null = null;
        const cancellationTimer = setInterval(() => {
          if (!options.isCancelled?.() || settled) return;
          settled = true;
          clearTimeout(timeout);
          this.activeCodexExecProcesses.delete(conversationKey);
          void terminateCodexProcessTree(child);
          reject(new CodexTurnCancelledError());
        }, 200);
        cancellationTimer.unref?.();
        const consumeCodexJsonLine = (line: string): void => {
          const usage = parseCodexUsageFromJsonLine(line);
          if (usage) {
            latestTurnUsage = usage;
          }
          consumeCodexJsonEventState(line, {
            onThreadId: (threadId) => {
              observedThreadId = threadId;
            },
            onAgentText: (text) => {
              fallbackAgentText = fallbackAgentText ? `${fallbackAgentText}\n${text}` : text;
            },
          });
          if (!isCodexAssistantMessageEventLine(line)) {
            const formattedEvent = formatCodexJsonEvent(line);
            if (formattedEvent) {
              emitCodexTranscript(formattedEvent);
            }
          }
        };
        const timeout = timeoutMs > 0
          ? setTimeout(() => {
              if (settled) return;
              settled = true;
              clearInterval(cancellationTimer);
              this.activeCodexExecProcesses.delete(conversationKey);
              void terminateCodexProcessTree(child);
              reject(new Error(`Codex CLI timed out after ${timeoutMs}ms`));
            }, timeoutMs)
          : undefined;

        child.stdout?.on('data', (chunk) => {
          const text = chunk.toString();
          stdout += text;
          stdoutLineBuffer += text;
          const lines = stdoutLineBuffer.split(/\r?\n/);
          stdoutLineBuffer = lines.pop() || '';
          for (const line of lines) {
            consumeCodexJsonLine(line);
          }
        });
        child.stderr?.on('data', (chunk) => {
          const text = chunk.toString();
          stderr += text;
          const trimmed = text.trim();
          if (trimmed) {
            if (/mcp\.notion\.com|Transport channel closed/i.test(trimmed)) {
              if (!notionMcpWarningEmitted) {
                notionMcpWarningEmitted = true;
                logger.warn('[ChatBridge] Codex MCP Notion connection failed; hidden from user-visible transcript.');
              }
              return;
            }
            if (/windows sandbox:\s*spawn setup refresh/i.test(trimmed)) {
              if (!windowsSandboxWarningEmitted) {
                windowsSandboxWarningEmitted = true;
                logger.warn('[ChatBridge] Codex Windows shell sandbox initialization failed; hidden from user-visible transcript.');
              }
              return;
            }
            logger.warn(`[ChatBridge] Codex stderr: ${truncateCodexEventText(trimmed, 5000)}`);
          }
        });
        child.on('error', (error) => {
          if (this.activeCodexExecProcesses.get(conversationKey) === child) {
            this.activeCodexExecProcesses.delete(conversationKey);
          }
          clearInterval(cancellationTimer);
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          reject(error);
        });
        child.on('close', async (code) => {
          if (this.activeCodexExecProcesses.get(conversationKey) === child) {
            this.activeCodexExecProcesses.delete(conversationKey);
          }
          clearInterval(cancellationTimer);
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          if (stdoutLineBuffer.trim()) {
            consumeCodexJsonLine(stdoutLineBuffer);
            stdoutLineBuffer = '';
          }
          if (code !== 0) {
            clearCodexThreadState(conversationKey);
            reject(new Error(`Codex CLI exited with code ${code}: ${stderr || stdout || 'no output'}`));
            return;
          }

          try {
            const finalMessage = existsSync(outputFile)
              ? (await readFile(outputFile, 'utf-8')).trim()
              : '';
            const rawStdout = stdout.trim();
            const fallbackOutput = fallbackAgentText.trim() || (rawStdout.startsWith('{') ? '' : rawStdout);
            const answer = sanitizeCodexFinalAnswer(finalMessage || fallbackOutput);
            if (!answer) {
              reject(new Error('Codex CLI returned empty response'));
              return;
            }
            if (observedThreadId) {
              codexSessionByConversation.set(conversationKey, observedThreadId);
            }
            if (latestTurnUsage) {
              codexLastUsageByConversation.set(conversationKey, latestTurnUsage);
            }
            let deterministicDraftWordPath = '';
            let deterministicDraftWordError = '';
            if (isCodexDraftWordExportRequest(currentRequest)) {
              const draftContent = getCodexDraftWordExportContent(options);
              if (!draftContent) {
                deterministicDraftWordError = '未读取到右侧文章写作进度中的规范章节 TXT';
              } else {
                const draftOutputRoot = codexSafeWorkspace || join(
                  getDataDir(),
                  'exports',
                  sanitizePathUserId(options.userId || 'web-user')
                );
                deterministicDraftWordPath = join(draftOutputRoot, 'paper-draft.docx');
                emitCodexTranscript('\n→ Scholar Harness 正在用规范章节 TXT 重建 Word 草稿\n');
                try {
                  await writeWordDraftDocx(deterministicDraftWordPath, draftContent);
                  emitCodexTranscript(`✓ Word 草稿已真实写入并校验路径：${deterministicDraftWordPath}\n`);
                } catch (error) {
                  deterministicDraftWordError = (error as Error).message || 'Word 文件写入失败';
                  deterministicDraftWordPath = '';
                }
              }
            }

            const changedSafeArtifacts = codexSafeWorkspace
              ? collectChangedCodexArtifacts(codexSafeWorkspace, artifactSnapshot, CODEX_MAX_MIRRORED_ARTIFACTS)
              : [];
            if (deterministicDraftWordPath && !changedSafeArtifacts.includes(deterministicDraftWordPath)) {
              changedSafeArtifacts.unshift(deterministicDraftWordPath);
            }
            const changedSourceCandidates = shouldTrackSourceArtifacts
              ? collectChangedCodexArtifacts(
                  workspaceRoot,
                  sourceArtifactSnapshot,
                  CODEX_MAX_MIRRORED_ARTIFACTS,
                  { skipAiWorkspaceContainer: true },
                )
              : [];
            const explicitFileTarget = extractExplicitWorkspaceFileWriteIntent(currentRequest)?.target || '';
            const changedSourceArtifacts = filterChangedCodexSourceArtifacts(
              changedSourceCandidates,
              workspaceRoot,
              [answer, visibleTranscript, currentRequest, stdout].join('\n'),
              explicitFileTarget,
            );
            if (workspaceSandbox === 'read-only' && changedSourceArtifacts.length > 0) {
              logger.warn(
                `[ChatBridge] Detected ${changedSourceArtifacts.length} verified source-workspace change(s) `
                + `during a read-only Codex CLI turn; preserving the real artifacts for the UI`
              );
            }
            const mirroredArtifacts = await mirrorCodexWorkspaceArtifacts(
              changedSafeArtifacts,
              workspaceRoot,
              codexSafeWorkspace
            );
            const verifiedArtifacts = [
              ...changedSafeArtifacts,
              ...changedSourceArtifacts,
              ...mirroredArtifacts.mirroredPaths.slice(0, CODEX_MAX_VERIFIED_ARTIFACT_PATHS / 2),
            ].slice(0, CODEX_MAX_VERIFIED_ARTIFACT_PATHS);
            const artifactBlock = buildCodexVerifiedArtifactBlock(verifiedArtifacts);
            const verificationWarning = verifiedArtifacts.length === 0 && isCodexFileMutationRequest(currentRequest)
              ? '⚠️ Scholar Harness 未检测到本轮真实文件变更，因此没有把 Codex 的“已写入/已生成”表述认定为完成。'
              : '';
            const draftWordWarning = deterministicDraftWordError
              ? `⚠️ Word 草稿未导出：${deterministicDraftWordError}。`
              : '';
            const answerWithArtifacts = [answer, artifactBlock, mirroredArtifacts.warning, draftWordWarning, verificationWarning]
              .filter(Boolean)
              .join('\n\n')
              .trim();
            codexLastAnswerByConversation.set(conversationKey, truncateCodexEventText(answerWithArtifacts, 4000));
            resolve(answerWithArtifacts);
          } catch (error) {
            reject(error);
          }
        });

        child.stdin?.write(prompt);
        child.stdin?.end();
      });

      const transcript = visibleTranscript.trim();
      return options.onProgress && transcript
        ? `${transcript}\n\n## Codex 最终回答\n\n${content}`
        : content;
    } catch (error) {
      clearCodexThreadState(conversationKey);
      logger.warn(`[ChatBridge] Cleared unusable Codex thread after failed run | conversation=${conversationKey}`);
      throw error;
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      try {
        if (existsSync(outputFile)) await unlink(outputFile);
        await rmdir(outputDir);
      } catch {
        // best-effort cleanup
      }
    }
  }

  private async chatWithSecondaryFallback(options: ChatOptions, reason: string): Promise<string> {
    logger.warn(`[ChatBridge] ${reason}，降级使用小牛马`);
    const fallbackNotice = '⚠️ Codex CLI 本轮执行失败，已自动切换到小牛马。本轮回答不会写入 Codex thread，后续 Codex 将通过最近可见对话继续。';
    if (options.onProgress) {
      try {
        options.onProgress(`\n\n${fallbackNotice}\n\n`);
      } catch {
        // A UI progress callback must not block provider fallback.
      }
    }
    const useVisionSecondary = !!options.requiresVision && !!this.config?.secondary_vision?.api_url && !!this.config?.secondary_vision?.api_key;
    const secondaryConfig = useVisionSecondary ? this.config?.secondary_vision : this.config?.secondary;
    const secondaryApiUrl = (options.requiresVision ? options.visionApiUrl : '') || options.apiUrl || secondaryConfig?.api_url || '';
    const secondaryApiKey = (options.requiresVision ? options.visionApiKey : '') || options.apiKey || secondaryConfig?.api_key || '';
    const secondaryModel = (options.requiresVision ? options.visionModel : '') || options.model || secondaryConfig?.model || this.config?.secondary?.vision_model || 'gpt-4o';
    const primaryApiUrl = this.config?.primary?.api_url || '';
    const primaryApiKey = this.config?.primary?.api_key || '';
    const primaryModel = this.config?.primary?.model || 'claude-sonnet-4-5';
    const attempts: string[] = [reason];

    if (secondaryApiUrl && secondaryApiKey) {
      try {
        const content = await callChatCompletion(
          {
            apiUrl: secondaryApiUrl,
            apiKey: secondaryApiKey,
            label: useVisionSecondary ? 'ChatBridge Secondary Vision Fallback' : 'ChatBridge Secondary Fallback',
            defaultModel: secondaryModel,
          },
          {
            model: secondaryModel,
            messages: this.buildApiMessages(options),
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: !!options.onProgress,
            onProgress: options.onProgress,
            signal: options.abortSignal,
          }
        );
        return options.onProgress ? content : `${fallbackNotice}\n\n${content}`;
      } catch (error) {
        throwIfCodexCancelled(options);
        attempts.push(`小牛马 API: ${(error as Error).message}`);
        logger.warn(`[ChatBridge] 小牛马降级失败，继续尝试大牛马: ${(error as Error).message}`);
      }
    } else {
      attempts.push('小牛马 API: 未配置');
    }

    if (primaryApiUrl && primaryApiKey) {
      const content = await callChatCompletion(
        {
          apiUrl: primaryApiUrl,
          apiKey: primaryApiKey,
          label: 'ChatBridge Primary Fallback',
          defaultModel: primaryModel,
        },
        {
          model: primaryModel,
          messages: this.buildApiMessages(options),
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          stream: !!options.onProgress,
          onProgress: options.onProgress,
          signal: options.abortSignal,
        }
      );
      return options.onProgress ? content : `${fallbackNotice}\n\n${content}`;
    }

    attempts.push('大牛马 API: 未配置');
    throw new Error(attempts.join('；'));
  }

  async shouldUseCodex(options: Pick<ChatOptions, 'forceProvider'>): Promise<boolean> {
    if (!this.config) {
      await this.loadConfig();
    }
    const preferCodex = this.config?.codex?.enabled !== false && !!this.config?.codex?.prefer;
    return options.forceProvider === 'codex'
      || ((!options.forceProvider || options.forceProvider === 'primary') && preferCodex);
  }

  async interruptCodexConversation(userId: string, conversationId: string): Promise<{
    appServerMatched: number;
    appServerInterrupted: number;
    execMatched: number;
    execInterrupted: number;
  }> {
    const prefix = buildCodexConversationKeyPrefix(userId, conversationId);
    const appServerResult = await codexAppServerManager.interruptConversationsByPrefix(prefix);
    const execEntries = Array.from(this.activeCodexExecProcesses.entries())
      .filter(([conversationKey]) => conversationKey.startsWith(prefix));
    let execInterrupted = 0;
    await Promise.all(execEntries.map(async ([conversationKey, child]) => {
      this.activeCodexExecProcesses.delete(conversationKey);
      if (await terminateCodexProcessTree(child)) execInterrupted += 1;
    }));
    logger.info('[ChatBridge] Codex cancellation requested:', {
      userId,
      conversationId,
      appServerMatched: appServerResult.matched,
      appServerInterrupted: appServerResult.interrupted,
      execMatched: execEntries.length,
      execInterrupted,
    });
    return {
      appServerMatched: appServerResult.matched,
      appServerInterrupted: appServerResult.interrupted,
      execMatched: execEntries.length,
      execInterrupted,
    };
  }

  async chatWithTools(
    options: Omit<ChatOptions, 'messages'> & { messages: Array<Message | LLMToolMessage> },
    tools: LLMToolDefinition[]
  ): Promise<LLMToolChatResult> {
    if (!this.config) {
      await this.loadConfig();
    }

    if (options.forceProvider === 'codex') {
      throw new Error('Codex CLI 不走 OpenAI tool_calls；请直接使用 Codex CLI 工作目录能力。');
    }

    const requiresVision = !!options.requiresVision;
    const secondaryVisionConfigured = !!this.config?.secondary_vision?.api_url && !!this.config?.secondary_vision?.api_key;
    const savedSecondaryForRequest = requiresVision && secondaryVisionConfigured
      ? this.config?.secondary_vision
      : this.config?.secondary;
    const savedSecondaryVisionModel = this.config?.secondary_vision?.model || this.config?.secondary?.vision_model || this.config?.secondary?.model || 'gpt-4o';
    let selectedApiUrl = '';
    let selectedApiKey = '';
    let selectedModel = '';

    if (options.forceProvider === 'primary') {
      selectedApiUrl = this.config?.primary?.api_url || '';
      selectedApiKey = this.config?.primary?.api_key || '';
      selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
    } else if (options.forceProvider === 'secondary') {
      selectedApiUrl = (requiresVision ? options.visionApiUrl : '') || options.apiUrl || savedSecondaryForRequest?.api_url || '';
      selectedApiKey = (requiresVision ? options.visionApiKey : '') || options.apiKey || savedSecondaryForRequest?.api_key || '';
      selectedModel = (requiresVision ? options.visionModel : '') || options.model || (requiresVision ? savedSecondaryVisionModel : savedSecondaryForRequest?.model) || 'gpt-4o';
    } else if (options.forceProvider === 'api') {
      selectedApiUrl = (requiresVision ? options.visionApiUrl : '') || options.apiUrl || savedSecondaryForRequest?.api_url || this.config?.chat?.api_url || '';
      selectedApiKey = (requiresVision ? options.visionApiKey : '') || options.apiKey || savedSecondaryForRequest?.api_key || this.config?.chat?.api_key || '';
      selectedModel = (requiresVision ? options.visionModel : '') || options.model || (requiresVision ? savedSecondaryVisionModel : savedSecondaryForRequest?.model) || 'gpt-4o';
    } else if (options.forceProvider === 'browser') {
      logger.warn('[ChatBridge] chatWithTools 收到 browser provider，回退到 primary API 配置');
      selectedApiUrl = this.config?.primary?.api_url || '';
      selectedApiKey = this.config?.primary?.api_key || '';
      selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
    } else {
      selectedApiUrl = (requiresVision ? options.visionApiUrl : '') || options.apiUrl || savedSecondaryForRequest?.api_url || '';
      selectedApiKey = (requiresVision ? options.visionApiKey : '') || options.apiKey || savedSecondaryForRequest?.api_key || '';
      selectedModel = (requiresVision ? options.visionModel : '') || options.model || (requiresVision ? savedSecondaryVisionModel : savedSecondaryForRequest?.model) || 'gpt-4o';
      if (!selectedApiUrl || !selectedApiKey) {
        selectedApiUrl = this.config?.primary?.api_url || '';
        selectedApiKey = this.config?.primary?.api_key || '';
        selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
      }
    }

    if (!selectedApiUrl || !selectedApiKey) {
      throw new Error('未配置可用于工具调用的 API。请配置小牛马/大牛马的 OpenAI-compatible API URL 和 Key。');
    }

    logger.info(`[ChatBridge] 使用 API tool_calls 模式 | url: ${selectedApiUrl} | model: ${selectedModel} | tools: ${tools.length}`);
    return callChatCompletionWithTools(
      {
        apiUrl: selectedApiUrl,
        apiKey: selectedApiKey,
        label: 'ChatBridge Tools',
        defaultModel: selectedModel,
      },
      {
        model: selectedModel,
        messages: this.buildApiMessages({
          ...options,
          messages: options.messages as Message[],
        }),
        temperature: options.temperature,
        maxTokens: options.maxTokens,
        tools,
        toolChoice: 'auto',
        parallelToolCalls: false,
        signal: options.abortSignal,
      }
    );
  }

  async chat(options: ChatOptions): Promise<string> {
    if (!this.config) {
      await this.loadConfig();
    }

    // ========== 注释掉浏览器桥接服务同步（已弃用，使用纯API模式）==========
    // await this.syncCredentialsToOpenClaw();

    const lastMessage = options.messages[options.messages.length - 1];
    const message = stringifyMessageContent(lastMessage.content);

    logger.info(`[ChatBridge] 发送消息 | 长度：${message.length} 字符`);
    logger.debug('[ChatBridge] 消息正文预览已禁用，避免日志记录用户内容');
    
    const hasFullPrompt = message.includes('## 🎯 核心职责') || 
                          message.includes('## ⚠️ 重要：代码控制参考文献') ||
                          message.length > 5000;
    logger.info(`[ChatBridge] 是否完整提示词：${hasFullPrompt} (长度>5000=${message.length > 5000})`);

    try {
      // ========== 新的双 Agent Provider 选择逻辑 ==========
      // forceProvider 选择：
      // - 'primary': 使用大牛马 API 配置（规划、Skill生成）
      // - 'secondary': 使用小牛马 API 配置（执行写作）
      // - 'codex': 使用本机 Codex CLI
      // - 'api': 使用前端传入的配置（向后兼容）
      // - 'browser': 已弃用，回退到 primary
      
      let selectedApiUrl: string;
      let selectedApiKey: string;
      let selectedModel: string;
      const preferCodex = this.config?.codex?.enabled !== false && !!this.config?.codex?.prefer;
      const requiresVision = !!options.requiresVision;
      const secondaryVisionConfigured = !!this.config?.secondary_vision?.api_url && !!this.config?.secondary_vision?.api_key;
      const savedSecondaryForRequest = requiresVision && secondaryVisionConfigured
        ? this.config?.secondary_vision
        : this.config?.secondary;
      const savedSecondaryVisionModel = this.config?.secondary_vision?.model || this.config?.secondary?.vision_model || this.config?.secondary?.model || 'gpt-4o';
      const shouldTryCodex =
        options.forceProvider === 'codex' ||
        (!options.bypassCodexPreference && (
          (!options.forceProvider && preferCodex) ||
          (options.forceProvider === 'primary' && preferCodex)
        ));

      if (shouldTryCodex) {
        try {
          throwIfCodexCancelled(options);
          let content: string;
          if (this.config?.codex?.app_server_enabled !== false) {
            try {
              content = await this.runCodexAppServer(options);
              logger.info(`[ChatBridge] Codex App Server 模式成功 | 响应长度: ${content.length}`);
            } catch (appServerError) {
              if (options.isCancelled?.() || isCodexTurnCancelledError(appServerError)) {
                throw new CodexTurnCancelledError((appServerError as Error).message);
              }
              const appServerMessage = (appServerError as Error).message || String(appServerError);
              logger.warn(`[ChatBridge] Codex App Server 执行失败: ${appServerMessage}`);
              if (this.config?.codex?.app_server_fallback_exec === false) {
                throw appServerError;
              }
              try {
                options.onProgress?.(`\n! Codex App Server 暂时不可用，切换到兼容的 Codex exec 模式：${appServerMessage}\n`);
              } catch {
                // Progress warnings are best effort.
              }
              content = await this.runCodexCli({ ...options, codexToolSet: undefined });
              logger.info(`[ChatBridge] Codex exec 兼容模式成功 | 响应长度: ${content.length}`);
            }
          } else {
            content = await this.runCodexCli({ ...options, codexToolSet: undefined });
            logger.info(`[ChatBridge] Codex exec 模式成功 | 响应长度: ${content.length}`);
          }
          return content;
        } catch (codexError) {
          if (options.isCancelled?.() || isCodexTurnCancelledError(codexError)) {
            throw new CodexTurnCancelledError((codexError as Error).message);
          }
          const message = (codexError as Error).message || String(codexError);
          logger.warn(`[ChatBridge] Codex CLI 不可用或执行失败: ${message}`);
          if (options.disableFallback) {
            throw codexError;
          }
          if (options.forceProvider === 'codex' || (!options.forceProvider && preferCodex)) {
            return this.chatWithSecondaryFallback(options, `Codex CLI 不可用或执行失败：${message}`);
          }
          logger.warn('[ChatBridge] Codex CLI failed; continuing with the configured primary API');
        }
      }
      
      if (options.forceProvider === 'primary') {
        // 大牛马：使用 primary 配置
        selectedApiUrl = this.config?.primary?.api_url || '';
        selectedApiKey = this.config?.primary?.api_key || '';
        selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
        logger.info(`[ChatBridge] forceProvider=primary，使用大牛马配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error('大牛马 API 未配置。请在 AI 桥接设置中配置大牛马的 API URL 和 Key。');
        }
      } else if (options.forceProvider === 'secondary') {
        // 小牛马：纯文本走 secondary；视觉输入优先走 secondary_vision
        selectedApiUrl = (requiresVision ? options.visionApiUrl : '') || options.apiUrl || savedSecondaryForRequest?.api_url || '';
        selectedApiKey = (requiresVision ? options.visionApiKey : '') || options.apiKey || savedSecondaryForRequest?.api_key || '';
        selectedModel = (requiresVision ? options.visionModel : '') || options.model || (requiresVision ? savedSecondaryVisionModel : savedSecondaryForRequest?.model) || 'gpt-4o';
        logger.info(`[ChatBridge] forceProvider=secondary，使用小牛马${requiresVision ? '视觉' : '文本'}配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error(requiresVision
            ? '小牛马视觉 API 未配置。请在小牛马配置中填写“视觉多模态 API”。'
            : '小牛马文本 API 未配置。请在前端 ⚙️ API 设置或 AI 桥接设置中配置小牛马的 API。');
        }
      } else if (options.forceProvider === 'api') {
        // 向后兼容：纯文本使用前端传入配置；视觉输入优先使用前端视觉配置或 secondary_vision
        selectedApiUrl = (requiresVision ? options.visionApiUrl : '') || options.apiUrl || savedSecondaryForRequest?.api_url || this.config?.chat?.api_url || '';
        selectedApiKey = (requiresVision ? options.visionApiKey : '') || options.apiKey || savedSecondaryForRequest?.api_key || this.config?.chat?.api_key || '';
        selectedModel = (requiresVision ? options.visionModel : '') || options.model || (requiresVision ? savedSecondaryVisionModel : savedSecondaryForRequest?.model) || 'gpt-4o';
        logger.info(`[ChatBridge] forceProvider=api，使用${requiresVision ? '视觉' : '文本'} API 配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error(requiresVision
            ? '视觉 API 未配置。请在小牛马配置中填写“视觉多模态 API”。'
            : 'API 未配置。请在前端 ⚙️ API 设置中配置 API URL 和 Key。');
        }
      } else if (options.forceProvider === 'codex') {
        return this.chatWithSecondaryFallback(options, 'Codex CLI 不可用或执行失败');
      } else if (options.forceProvider === 'browser') {
        // 浏览器模式已弃用，回退到 primary
        logger.warn('[ChatBridge] forceProvider=browser 已弃用，回退到 primary API 配置');
        selectedApiUrl = this.config?.primary?.api_url || '';
        selectedApiKey = this.config?.primary?.api_key || '';
        selectedModel = options.model || this.config?.primary?.model || 'claude-sonnet-4-5';
        
        if (!selectedApiUrl || !selectedApiKey) {
          throw new Error('大牛马 API 未配置。请在 AI 桥接设置中配置大牛马的 API URL 和 Key。');
        }
      } else {
        // 自动选择：纯文本默认使用 secondary；视觉输入优先使用 secondary_vision
        selectedApiUrl = (requiresVision ? options.visionApiUrl : '') || options.apiUrl || savedSecondaryForRequest?.api_url || '';
        selectedApiKey = (requiresVision ? options.visionApiKey : '') || options.apiKey || savedSecondaryForRequest?.api_key || '';
        selectedModel = (requiresVision ? options.visionModel : '') || options.model || (requiresVision ? savedSecondaryVisionModel : savedSecondaryForRequest?.model) || 'gpt-4o';
        logger.info(`[ChatBridge] 自动选择小牛马${requiresVision ? '视觉' : '文本'}配置 | url: ${selectedApiUrl} | model: ${selectedModel}`);
        
        if (!selectedApiUrl || !selectedApiKey) {
          // 回退到 primary
          selectedApiUrl = this.config?.primary?.api_url || '';
          selectedApiKey = this.config?.primary?.api_key || '';
          selectedModel = this.config?.primary?.model || 'claude-sonnet-4-5';
          logger.info(`[ChatBridge] secondary 未配置，回退到大牛马配置 | url: ${selectedApiUrl}`);
          
          if (!selectedApiUrl || !selectedApiKey) {
            throw new Error('未配置任何 API。请在 AI 桥接设置中配置大牛马和小牛马的 API URL 和 Key。');
          }
        }
      }
      
      // ========== API 模式统一处理 ==========
      logger.info(`[ChatBridge] 使用 API 模式 | url: ${selectedApiUrl} | model: ${selectedModel}`);
      
      try {
        const content = await callChatCompletion(
          {
            apiUrl: selectedApiUrl,
            apiKey: selectedApiKey,
            label: 'ChatBridge',
            defaultModel: selectedModel,
          },
          {
            model: selectedModel,
            messages: this.buildApiMessages(options),
            temperature: options.temperature,
            maxTokens: options.maxTokens,
            stream: !!options.onProgress,
            onProgress: options.onProgress,
            signal: options.abortSignal,
          }
        );

        logger.info(`[ChatBridge] API 模式成功 | 响应长度: ${content.length}`);
        
        return content;
      } catch (apiError) {
        logger.error(`[ChatBridge] API 模式失败: ${(apiError as Error).message}`);
        throw apiError;
      }
    } catch (error) {
      logger.error(`[ChatBridge] 错误：${(error as Error).message}`);
      throw error;
    }
  }

  // ========== 浏览器桥接服务代码已注释（已弃用，使用纯API模式）==========
  // 以下代码用于启动 openclaw serve 子进程和SSE流式传输，现已弃用
  // 大牛马和小牛马使用纯API模式，无需浏览器桥接服务

  /**
   * 同步凭据到 OpenClaw 配置 [已注释 - 弃用]
   */
  // private async syncCredentialsToOpenClaw(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 确保 openclaw serve 进程在运行 [已注释 - 弃用]
   */
  // private async ensureServiceRunning(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 检查 openclaw serve 健康状态 [已注释 - 弃用]
   */
  // private checkServiceHealth(): Promise<boolean> {
  //   ... 已注释 ...
  // }

  /**
   * 启动 openclaw serve 子进程 [已注释 - 弃用]
   */
  // private async startOpenclawService(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 停止 openclaw serve 子进程 [已注释 - 弃用]
   */
  // private stopOpenclawService(): void {
  //   ... 已注释 ...
  // }

  /**
   * SSE 流式传输通过浏览器服务 [已注释 - 弃用]
   */
  // private async sendViaService(
  //   message: string,
  //   onProgress?: (chunk: string) => void,
  //   newPage?: boolean
  // ): Promise<string> {
  //   ... 已注释 ...
  // }

  /**
   * 浏览器模式发送消息 [已注释 - 弃用]
   */
  // private async sendViaBrowser(
  //   message: string, 
  //   onProgress?: (chunk: string) => void,
  //   newPage?: boolean,
  //   isRetry?: boolean
  // ): Promise<string> {
  //   ... 已注释 ...
  // }

  /**
   * 发送控制请求到浏览器服务 [已注释 - 弃用]
   */
  // private async sendControlRequest<T = any>(path: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
  //   ... 已注释 ...
  // }

  /**
   * 创建新会话 [已注释 - 弃用]
   */
  // async newChat(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 刷新当前页面 [已注释 - 弃用]
   */
  // async refreshCurrentPage(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 打开桥接页面 [已注释 - 弃用]
   */
  // async openBridgePage(url?: string): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 暂停桥接 [已注释 - 弃用]
   */
  // async pause(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 恢复桥接 [已注释 - 弃用]
   */
  // async resume(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 获取状态 [已注释 - 弃用]
   */
  // async getState(): Promise<ChatBridgeState> {
  //   ... 已注释 ...
  // }

  /**
   * 刷新页面 [已注释 - 弃用]
   */
  // async refreshPage(): Promise<void> {
  //   ... 已注释 ...
  // }

  /**
   * 测试连接 [已注释 - 弃用]
   */
  // async testConnection(): Promise<boolean> {
  //   ... 已注释 ...
  // }

  // ========== 浏览器桥接服务代码注释结束 ==========

  // ========== 浏览器辅助函数 [已注释 - 弃用] ==========
  // 注意：使用单行注释避免正则表达式中的 */ 关闭注释块
  
  // extractCleanResponse - 提取清理响应 [已注释]
  // private extractCleanResponse(stdout: string): string {
  //   const lines = stdout.split('\n').filter(line => line.trim());
  //   let fullContent = '';
  //   let doneContent = '';  // 优先使用 done 事件内容
  //   
  //   for (const line of lines) {
  //     try {
  //       const parsed = JSON.parse(line);
  //       if (parsed.type === 'start') {
  //         if (parsed.content && parsed.content.trim()) {
  //           fullContent = parsed.content;
  //         }
  //       } else if (parsed.type === 'chunk') {
  //         fullContent += parsed.content || '';
  //       } else if (parsed.type === 'done') {
  //         if (parsed.content) {
  //           doneContent = parsed.content;
  //         }
  //       }
  //     } catch (e) {
  //       // 非 JSON 行，忽略
  //     }
  //   }
  //   
  //   // 优先使用 doneContent
  //   const result = (doneContent || fullContent).trim();
  //   
  //   // 清理噪音
  //   const cleaned = result
  //     .replace(/^思考中\.\.\./gm, '')
  //     .replace(/^已思考\s*\d+\s*秒?\n/mg, '')  // 注意：正则中的星号改用 \n 匹配
  //     .replace(/^已思考若干秒\n/mg, '')
  //     .replace(/^大模型\s*说：/gm, '')
  //     .trim();
  //   
  //   return cleaned;
  // }

  // identifyElements - 识别页面元素 [已注释]
  // private async identifyElements(): Promise<void> {
  //   ... 已注释 ...
  // }

  // extractResponse - 提取响应 [已注释]
  // private async extractResponse(): Promise<string> {
  //   ... 已注释 ...
  // }

// runCommand - 安全执行 openclaw 命令 [已注释]
  /**
   * 安全执行 openclaw 命令 [已注释 - 弃用]
   * @param args 命令参数数组（安全，不会触发 shell 解析）
   * @param timeout 超时时间（毫秒）
   * @param onChunk 流式回调
   */
  /*
  private async runCommand(
    args: string[], 
    timeout: number = 60000,
    onChunk?: (chunk: string, type: 'start' | 'chunk' | 'end' | 'error') => void
  ): Promise<{ stdout: string; stderr: string }> {
    // 参数验证：确保所有参数都是字符串
    const safeArgs = args.map(arg => {
      if (typeof arg !== 'string') {
        logger.warn(`[ChatBridge] Non-string argument detected: ${typeof arg}, converting to string`);
        return String(arg);
      }
      return arg;
    });
    
    logger.debug(`[ChatBridge] Executing with args: ${safeArgs.join(' ')}`);
    
    const openclawPath = getOpenclawPath();
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', ['index.js', ...safeArgs], {
        cwd: openclawPath,
        timeout: timeout,
        shell: false,  // 安全：禁用 shell 解析
      });
      
      let stdout = '';
      let stderr = '';
      let buffer = '';
      let lastOutputTime = Date.now();
      let hasOutput = false;
      let stallCheckTimer: NodeJS.Timeout | null = null;
      let hasRefreshed = false;
      
      // stall 检测：仅在 onChunk 模式下启用，至少 25 秒无有效输出才触发
      const startStallCheck = () => {
        if (stallCheckTimer) clearInterval(stallCheckTimer);
        stallCheckTimer = setInterval(async () => {
          const elapsed = Date.now() - lastOutputTime;
          if (hasOutput && elapsed > 25000 && !hasRefreshed) {
            logger.warn(`[ChatBridge] 检测到输出卡住 ${elapsed}ms，触发刷新`);
            hasRefreshed = true;
            onChunk?.('【系统检测到页面卡住，正在自动刷新...】', 'chunk');
            await this.refreshPage();
            onChunk?.('【页面已刷新，继续等待响应...】', 'chunk');
            hasRefreshed = false;
          }
        }, 5000);
      };
      
      const stopStallCheck = () => {
        if (stallCheckTimer) {
          clearInterval(stallCheckTimer);
          stallCheckTimer = null;
        }
      };
      
      if (onChunk) {
        startStallCheck();
      }
      
      child.stdout?.on('data', (data) => {
        lastOutputTime = Date.now();
        const text = data.toString();
        stdout += text;
        
        if (onChunk) {
          hasOutput = true;
          buffer += text;
          
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            if (!line.trim()) continue;
            
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === 'start') {
                onChunk(parsed.content || '', 'start');
              } else if (parsed.type === 'chunk') {
                onChunk(parsed.content || '', 'chunk');
              } else if (parsed.type === 'end') {
                onChunk('', 'end');
              }
            } catch (e) {
              if (line.trim()) {
                onChunk(line.trim(), 'chunk');
              }
            }
          }
        }
      });
      
      child.stderr?.on('data', (data) => {
        const line = data.toString().trim();
        if (line) {
          stderr += data.toString();
          if (line.includes('[Phase:') || line.includes('[STREAM')) {
            logger.info(`[ChatBridge-Debug] ${line}`);
          }
        }
      });
      
      child.on('close', (code) => {
        if (onChunk && buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer.trim());
            if (parsed.type === 'start') {
              onChunk(parsed.content || '', 'start');
            } else if (parsed.type === 'chunk') {
              onChunk(parsed.content || '', 'chunk');
            } else if (parsed.type === 'end') {
              onChunk('', 'end');
            }
          } catch (e) {
            onChunk(buffer.trim(), 'chunk');
          }
        }
        stopStallCheck();
        if (code === 0 || code === null) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(`Process exited with code ${code}`));
        }
      });
      
      child.on('error', (err) => {
        stopStallCheck();
        if (onChunk) {
          onChunk(err.message, 'error');
        }
        reject(err);
      });
    });
  }
  */

  // sendControlRequest - 发送控制请求到浏览器服务 [已注释]
  /*
  private async sendControlRequest<T = any>(path: string, method: 'GET' | 'POST' = 'GET', payload?: Record<string, unknown>, timeoutMs?: number): Promise<T> {
    if (!this.config) {
      await this.loadConfig();
    }

    await this.ensureServiceRunning();
    const port = this.config?.service?.port || 19222;

    // 根据操作类型设置不同的超时时间
    const timeout = timeoutMs || (path === '/open' ? 60000 : 15000);

    return new Promise<T>((resolve, reject) => {
      const body = payload ? JSON.stringify(payload) : undefined;
      const req = http.request(
        {
          hostname: 'localhost',
          port,
          path,
          method,
          headers: body
            ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body),
              }
            : undefined,
          timeout,
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk.toString());
          res.on('end', () => {
            const statusCode = res.statusCode || 500;
            try {
              const parsed = data ? JSON.parse(data) : {};
              if (statusCode >= 200 && statusCode < 300) {
                resolve(parsed as T);
              } else {
                reject(new Error((parsed as { error?: string }).error || `控制请求失败 (${statusCode})`));
              }
            } catch {
              if (statusCode >= 200 && statusCode < 300) {
                resolve({} as T);
              } else {
                reject(new Error(`控制请求失败 (${statusCode})`));
              }
            }
          });
        }
      );

      req.on('error', (error) => reject(new Error(`控制请求失败：${error.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`控制请求超时 (${timeout/1000}秒)`));
      });

      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
  */

  // newChat - 创建新会话 [已注释]
  /*
  async newChat(): Promise<void> {
    await this.sendControlRequest('/newchat');
    this.paused = false;
    logger.info('[ChatBridge] 已创建新会话页面');
  }
  */

  // refreshCurrentPage - 刷新当前页面 [已注释]
  /*
  async refreshCurrentPage(): Promise<void> {
    await this.sendControlRequest('/refresh');
    logger.info('[ChatBridge] 已通过服务刷新当前页面');
  }
  */

  // openBridgePage - 打开桥接页面 [已注释]
  /*
  async openBridgePage(url?: string): Promise<void> {
    if (!this.config) {
      await this.loadConfig();
    }

    const targetUrl = url?.trim() || this.config?.chat?.chat_url;
    if (!targetUrl || !targetUrl.trim()) {
      throw new Error('未配置 AI 桥接页面 URL，请先在设置中保存有效 URL');
    }

    await this.ensureServiceRunning();
    await this.sendControlRequest('/open', 'POST', { url: targetUrl });
    this.paused = false;
    logger.info(`[ChatBridge] 已打开桥接页面: ${targetUrl}`);
  }
  */

  // pause - 暂停桥接 [已注释]
  /*
  async pause(): Promise<void> {
    this.paused = true;
    await this.sendControlRequest('/pause', 'POST');
    logger.info('[ChatBridge] 已暂停桥接发送');
  }
  */

  // resume - 恢复桥接 [已注释]
  /*
  async resume(): Promise<void> {
    await this.sendControlRequest('/resume', 'POST');
    this.paused = false;
    logger.info('[ChatBridge] 已恢复桥接发送');
  }
  */

  // getState - 获取状态 [已注释]
  /*
  async getState(): Promise<ChatBridgeState> {
    const serviceState = await this.sendControlRequest<{
      paused?: boolean;
      currentUrl?: string | null;
      hasActivePage?: boolean;
    }>('/state');

    return {
      serviceRunning: true,
      paused: serviceState.paused ?? this.paused,
      currentUrl: serviceState.currentUrl ?? null,
      hasActivePage: serviceState.hasActivePage ?? false,
    };
  }
  */

  // refreshPage - 刷新页面 [已注释]
  /*
  async refreshPage(): Promise<void> {
    try {
      await this.refreshCurrentPage();
    } catch (error) {
      logger.warn(`[ChatBridge] 服务刷新失败，回退到浏览器打开：${(error as Error).message}`);
      if (!this.config) {
        await this.loadConfig();
      }
      
      const chatUrl = this.config!.chat.chat_url;
      const profile = this.config!.browser.profile;
      
      try {
        await this.runCommand(
          ['browser', '--action', 'open', '--url', chatUrl, '--profile', profile, '--keep-alive'],
          15000
        );
        logger.info('[ChatBridge] 页面刷新成功');
      } catch (fallbackError) {
        logger.error(`[ChatBridge] 页面刷新失败：${(fallbackError as Error).message}`);
      }
    }
  }
  */

  // sleep - 等待函数 [已注释]
  /*
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
  */

  // testConnection - 测试连接 [已注释]
  /*
  async testConnection(): Promise<boolean> {
    try {
      if (this.paused) {
        throw new Error('ChatBridge 当前已暂停，请先恢复后再发送消息。');
      }

      if (!this.config) {
        await this.loadConfig();
      }

      const chatUrl = this.config!.chat.chat_url;
      
      if (!chatUrl || chatUrl.trim() === '') {
        logger.error('[ChatBridge] 连接测试失败：未配置聊天 URL');
        return false;
      }

      logger.info(`[ChatBridge] 测试连接... URL: ${chatUrl}`);
      
      await this.runCommand(
        ['browser', '--action', 'open', '--url', chatUrl, '--profile', this.config!.browser.profile, '--keep-alive'],
        15000
      );

      logger.info('[ChatBridge] 连接测试成功');
      return true;
    } catch (error) {
      logger.error(`[ChatBridge] 连接测试失败：${(error as Error).message}`);
      return false;
    }
  }
  */

  // ========== 浏览器桥接辅助函数注释结束 ==========
}

export const chatBridge = new ChatBridgeAdapter();
