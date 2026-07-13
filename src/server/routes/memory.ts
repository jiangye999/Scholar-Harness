/**
 * 记忆管理路由 - 手脚层功能
 * 负责根据 ChatBridge 的响应更新跨会话的长期记忆
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { researchSessionManager } from '../../research/research-session-manager';
import {
  getDataDir,
  getMemoryDir,
  getUploadDir,
} from '../../utils/paths';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import { z } from 'zod';
// Bug 修复：从 session 获取 userId，避免账号数据混淆
import { resolveUserId, getUserIdFromSession } from '../auth-guard-singleton';

/**
 * 类型守卫：判断错误是否为 NodeJS 文件系统错误
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

const router = Router();

// 使用统一的路径管理模块获取数据目录
// 这确保 Electron 打包后路径正确
const dataDir = getDataDir();
const memoryDir = getMemoryDir();
const uploadDir = getUploadDir();

// Bug #5 修复：Memory 更新锁机制，避免并发竞争
// 每个用户维护一个操作队列，确保串行执行
const memoryLocks = new Map<string, Promise<void>>();

/**
 * 获取用户内存锁，确保操作串行执行
 * @param userId 用户ID
 * @param operation 要执行的操作（异步函数）
 */
export async function withMemoryLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
  // 获取当前用户的锁队列（如果有正在执行的操作）
  const currentLock = memoryLocks.get(userId) || Promise.resolve();
  
  // 创建新的锁 promise，等待当前操作完成后执行
  let resolveLock: () => void;
  const newLock = new Promise<void>(resolve => { resolveLock = resolve; });
  
  // 将新锁放入队列
  memoryLocks.set(userId, newLock);
  
  try {
    // 等待前一个操作完成
    await currentLock;
    
    // 执行当前操作
    const result = await operation();
    
    return result;
  } finally {
    // 操作完成，释放锁
    resolveLock!();
    
    // 如果队列空了，删除锁
    if (memoryLocks.get(userId) === newLock) {
      memoryLocks.delete(userId);
    }
  }
}

export interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  keyTopics: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface UserMemory {
  userId: string;
  entries: MemoryEntry[];
  conversations: ConversationSummary[];
  updatedAt: string;
  // Bug fix: 记录用户明确删除的字段，防止自动恢复
  deletedKeys?: string[];
}

type MemoryEditAction = 'replace' | 'delete' | 'append';

export interface PendingMemoryEdit {
  id: string;
  userId: string;
  action: MemoryEditAction;
  targetKey: string;
  targetLabel: string;
  instruction: string;
  beforeValue: string;
  afterValue: string;
  summary: string;
  oldText?: string;
  newText?: string;
  createdAt: string;
  expiresAt: string;
}

export interface MemoryEditPreviewResult {
  handled: boolean;
  pendingEdit?: PendingMemoryEdit;
  message: string;
}

export interface MemoryEditApplyResult {
  applied: boolean;
  cancelled?: boolean;
  backupId?: string;
  targetKey?: string;
  targetLabel?: string;
  message: string;
}

interface MemoryCategoryDefinition {
  id: string;
  label: string;
  description: string;
}

interface MemoryDimensionDefinition {
  key: string;
  label: string;
  description: string;
  category: string;
  categoryLabel: string;
}

const MEMORY_CATEGORY_DEFINITIONS: MemoryCategoryDefinition[] = [
  { id: 'experiment', label: '实验资料记忆', description: '研究背景、实验设计、处理设置、采样测定和方法信息' },
  { id: 'data', label: '数据结果记忆', description: '数值结果、统计差异、关键发现和数据状态' },
  { id: 'paper', label: '论文设定记忆', description: '论文主题、目标期刊、关键词和投稿设定' },
  { id: 'writing', label: '写作进度记忆', description: '当前写作阶段、草稿进度、已完成和待完成章节' },
  { id: 'preference', label: '用户偏好记忆', description: '写作偏好、格式偏好和用户长期要求' },
  { id: 'other', label: '其他长期记忆', description: '历史版本或扩展模块写入的其他记忆字段' },
];

export const MEMORY_DIMENSION_DEFINITIONS: MemoryDimensionDefinition[] = [
  { key: 'experiment_summary_structured', label: '实验资料总结（结构化）', description: 'AI 整理后的结构化实验资料', category: 'experiment', categoryLabel: '实验资料记忆' },
  { key: 'research_method', label: '研究方法', description: '研究方法、技术路线和测定方法概述', category: 'experiment', categoryLabel: '实验资料记忆' },
  { key: 'experimental_design', label: '实验设计', description: '处理设置、试验设计、采样方案等实验设计信息', category: 'experiment', categoryLabel: '实验资料记忆' },

  { key: 'data_summary_structured', label: '数据详细总结（结构化）', description: 'AI 整理后的结构化数据结果', category: 'data', categoryLabel: '数据结果记忆' },
  { key: 'key_findings', label: '关键发现', description: '研究的关键发现和结论', category: 'data', categoryLabel: '数据结果记忆' },
  { key: 'important_findings', label: '重要发现', description: '历史版本写入的重要发现字段', category: 'data', categoryLabel: '数据结果记忆' },
  { key: 'data_status', label: '数据状态', description: '数据是否齐全、待补充数据和当前数据处理状态', category: 'data', categoryLabel: '数据结果记忆' },

  { key: 'paper_topic', label: '论文主题', description: '用户明确设定的论文主题和研究方向', category: 'paper', categoryLabel: '论文设定记忆' },
  { key: 'research_topic', label: '研究主题', description: '历史版本写入的研究主题字段，与论文主题等价', category: 'paper', categoryLabel: '论文设定记忆' },
  { key: 'target_journal', label: '目标期刊', description: '用户明确设定的投稿目标期刊', category: 'paper', categoryLabel: '论文设定记忆' },
  { key: 'key_concepts', label: '关键概念', description: '论文相关核心概念、关键词和变量', category: 'paper', categoryLabel: '论文设定记忆' },
  { key: 'years_mentioned', label: '涉及年份', description: '对话或材料中提到的研究年份', category: 'paper', categoryLabel: '论文设定记忆' },
  { key: 'journals_mentioned', label: '提到的期刊', description: '对话中提到但未必设为投稿目标的期刊', category: 'paper', categoryLabel: '论文设定记忆' },

  { key: 'writing_progress', label: '写作进度', description: '当前写作阶段和进度', category: 'writing', categoryLabel: '写作进度记忆' },
  { key: 'draft_progress', label: '草稿进度', description: '草稿生成、保存和修改进度', category: 'writing', categoryLabel: '写作进度记忆' },
  { key: 'completed_chapters', label: '已完成章节', description: '用户明确确认已完成的论文章节', category: 'writing', categoryLabel: '写作进度记忆' },
  { key: 'pending_chapters', label: '待完成章节', description: '用户明确确认仍需撰写或修改的章节', category: 'writing', categoryLabel: '写作进度记忆' },

  { key: 'user_preferences', label: '用户偏好', description: '用户长期写作、输出和交互偏好', category: 'preference', categoryLabel: '用户偏好记忆' },
  { key: 'writing_style', label: '写作风格偏好', description: '用户偏好的论文写作风格和表达要求', category: 'preference', categoryLabel: '用户偏好记忆' },
  { key: 'citation_preferences', label: '引用偏好', description: '引用格式、引用密度和证据使用偏好', category: 'preference', categoryLabel: '用户偏好记忆' },
];

const MEMORY_DIMENSION_BY_KEY = new Map(MEMORY_DIMENSION_DEFINITIONS.map(def => [def.key, def]));
const STRUCTURED_SUMMARY_KEY_BY_RAW_KEY: Record<string, string> = {
  experiment_summary: 'experiment_summary_structured',
  data_summary: 'data_summary_structured',
};

const MEMORY_EDIT_TARGETS: Array<{ key: string; label: string; aliases: string[] }> = [
  { key: 'experiment_summary_structured', label: '实验资料总结', aliases: ['实验资料总结', '实验资料', '试验资料总结', '试验资料', '实验总结', '研究材料'] },
  { key: 'data_summary_structured', label: '数据详细总结', aliases: ['数据详细总结', '数据总结', '数据资料', '数据结果', '图片识别内容', '图件总结', '图像识别内容'] },
  { key: 'writing_progress', label: '写作进度', aliases: ['写作进度', '当前进度', '论文进度', '进度'] },
  { key: 'completed_chapters', label: '已完成章节', aliases: ['已完成章节', '完成章节', '已经完成'] },
  { key: 'pending_chapters', label: '待完成章节', aliases: ['待完成章节', '未完成章节', '待写章节', '下一步章节'] },
  { key: 'draft_progress', label: '论文草稿进度', aliases: ['论文草稿', '草稿', '普通草稿', '草稿进度'] },
  { key: 'paper_topic', label: '论文主题', aliases: ['论文主题', '研究主题', '主题'] },
  { key: 'target_journal', label: '目标期刊', aliases: ['目标期刊', '投稿期刊', '期刊'] },
  { key: 'key_findings', label: '关键发现', aliases: ['关键发现', '主要发现', '研究结论', '核心结论'] },
  { key: 'research_method', label: '研究方法', aliases: ['研究方法', '方法', '实验方法'] },
];

const MEMORY_EDIT_CONFIRM_PATTERNS = [
  /^(确认|确定|同意|执行|应用|保存)(修改|编辑|变更|这个修改)?$/i,
  /^(确认修改|确认编辑|应用修改|保存修改|执行修改)$/i,
];

const MEMORY_EDIT_CANCEL_PATTERNS = [
  /^(取消|不要|放弃|撤销)(修改|编辑|变更)?$/i,
  /^(取消修改|放弃修改|不要修改)$/i,
];

const PROTECTED_UPLOAD_SUMMARY_MARKERS = [
  '【按图件编号整理的结构化数据总结】',
  '历史实验图片/材料上传记录同步',
];

function hasProtectedUploadSummaryBlock(value: string): boolean {
  return PROTECTED_UPLOAD_SUMMARY_MARKERS.some(marker => value.includes(marker));
}

function extractProtectedUploadSummaryBlocks(value?: string): string[] {
  const text = String(value || '').trim();
  if (!text || !hasProtectedUploadSummaryBlock(text)) return [];

  const chunks = text
    .split(/\n{2}---\n{2}/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  const protectedChunks = chunks.filter(chunk => hasProtectedUploadSummaryBlock(chunk));
  return protectedChunks.length > 0 ? protectedChunks : [text];
}

function normalizeProtectedUploadSummaryBlock(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function preserveProtectedUploadSummaryBlocks(summary: string, ...sources: Array<string | undefined>): string {
  let merged = String(summary || '').trim();
  const existingBlocks = new Set(
    extractProtectedUploadSummaryBlocks(merged).map(normalizeProtectedUploadSummaryBlock)
  );

  for (const source of sources) {
    for (const block of extractProtectedUploadSummaryBlocks(source)) {
      const normalized = normalizeProtectedUploadSummaryBlock(block);
      if (!normalized || existingBlocks.has(normalized)) continue;
      merged = merged ? `${merged}\n\n---\n\n${block}` : block;
      existingBlocks.add(normalized);
    }
  }

  return merged;
}

const USER_SCOPED_MEMORY_KEYS = new Set([
  'paper_topic',
  'research_topic',
  'target_journal',
  'writing_progress',
  'completed_chapters',
  'pending_chapters',
]);

const PLACEHOLDER_VALUES = new Set([
  '无',
  '暂无',
  '未提及',
  '未指定',
  '未知',
  'none',
  'unknown',
  'not specified',
  'target journal',
  'journal',
  'paper topic',
  'research topic',
  '目标期刊',
  '论文主题',
  '研究主题',
]);

function getMemoryDimensionDefinition(key: string): MemoryDimensionDefinition {
  return MEMORY_DIMENSION_BY_KEY.get(key) || {
    key,
    label: key,
    description: '扩展模块或历史版本写入的长期记忆字段',
    category: 'other',
    categoryLabel: '其他长期记忆',
  };
}

export function getStructuredPreferredMemoryEntries(entries: MemoryEntry[]): MemoryEntry[] {
  const keys = new Set(entries
    .filter(entry => {
      const value = entry.value?.trim() || '';
      return value && !isPlaceholderMemoryValue(value);
    })
    .map(entry => entry.key));
  return entries.filter(entry => {
    const structuredKey = STRUCTURED_SUMMARY_KEY_BY_RAW_KEY[entry.key];
    return !(structuredKey && keys.has(structuredKey));
  });
}

export function foldRawSummariesIntoStructured(memory: UserMemory): string[] {
  const removedKeys: string[] = [];

  for (const [rawKey, structuredKey] of Object.entries(STRUCTURED_SUMMARY_KEY_BY_RAW_KEY)) {
    const rawEntry = memory.entries.find(entry => entry.key === rawKey);
    const structuredEntry = memory.entries.find(entry => entry.key === structuredKey);

    if (!rawEntry || !structuredEntry) {
      continue;
    }

    const rawValue = rawEntry.value?.trim();
    const structuredValue = structuredEntry.value?.trim() || '';
    if (!structuredValue || isPlaceholderMemoryValue(structuredValue)) {
      continue;
    }

    if (rawValue && !isDuplicateContent(structuredValue, rawValue)) {
      structuredEntry.value = `${structuredValue}\n\n---\n\n### 补充资料（自动并入，待结构化整理）\n${rawValue}`;
      structuredEntry.source = structuredEntry.source || 'structured-primary';
      structuredEntry.timestamp = new Date().toISOString();
      logger.info(`[Memory] Folded ${rawKey} into ${structuredKey} before save`);
    }

    memory.entries = memory.entries.filter(entry => entry.key !== rawKey);
    removedKeys.push(rawKey);
  }

  return removedKeys;
}

function normalizeMemoryCandidate(value: string): string {
  return value
    .replace(/[“”"]/g, '')
    .replace(/^[\s:：,，;；。]+|[\s,，;；。]+$/g, '')
    .trim();
}

function isPlaceholderMemoryValue(value: string): boolean {
  const normalized = normalizeMemoryCandidate(value).toLowerCase();
  return PLACEHOLDER_VALUES.has(normalized);
}

function firstCapture(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match?.[1]) {
      return match[1];
    }
  }
  return null;
}

function cutAtFirstMarker(value: string, markers: string[]): string {
  let result = value;
  for (const marker of markers) {
    const index = result.indexOf(marker);
    if (index > 0) {
      result = result.slice(0, index).trim();
    }
  }
  return result;
}

function cleanPaperTopicValue(value: string): string {
  let cleaned = normalizeMemoryCandidate(value);
  const parenMatch = cleaned.match(/^[（(]\s*([^）)]+)\s*[）)]/);
  if (parenMatch?.[1]) {
    cleaned = parenMatch[1].trim();
  }
  cleaned = cutAtFirstMarker(cleaned, ['与该期刊', '和该期刊', '高度契合', '契合', '建议', '按照', '应聚焦', '应该']);
  return normalizeMemoryCandidate(cleaned);
}

function cleanTargetJournalValue(value: string): string {
  let cleaned = normalizeMemoryCandidate(value);
  cleaned = cleaned.replace(/^(?:is|to|in|是|为)\s*/i, '').trim();
  cleaned = cutAtFirstMarker(cleaned, ['，', '。', '；', ';', ' because ', ' if ', ' with ', ' 的风格', ' 格式', ' 收稿范围', ' 高度契合', ' 建议']);
  return normalizeMemoryCandidate(cleaned);
}

function isSuggestionLikeMemoryValue(value: string): boolean {
  return /(建议|应该|应当|可以|按照|以下结构|前两段|第三段|收稿范围|高度契合|该期刊|风格|格式)/i.test(value);
}

function isValidPaperTopic(value: string): boolean {
  return value.length >= 5 &&
    value.length <= 120 &&
    !value.includes('http') &&
    !isPlaceholderMemoryValue(value) &&
    !isSuggestionLikeMemoryValue(value);
}

function isValidTargetJournal(value: string): boolean {
  return value.length >= 3 &&
    value.length <= 100 &&
    !value.includes('http') &&
    !isPlaceholderMemoryValue(value) &&
    !isSuggestionLikeMemoryValue(value) &&
    /[a-zA-Z\u4e00-\u9fa5]/.test(value);
}

function isPartialChapterStatus(value: string): boolean {
  return /(段|paragraph|前两段|后两段|开头|草稿|提纲|outline|大纲|结构|建议|第三段|部分内容)/i.test(value);
}

function extractChapterNames(value: string): string[] {
  const chapters = [
    { label: '题目', pattern: /(题目|标题|title)/i },
    { label: '摘要', pattern: /(摘要|abstract)/i },
    { label: '引言', pattern: /(引言|introduction)/i },
    { label: '方法', pattern: /(方法|材料与方法|methods?|materials\s+and\s+methods)/i },
    { label: '结果', pattern: /(结果|results?)/i },
    { label: '图表', pattern: /(图表|图|表|figures?|tables?)/i },
    { label: '讨论', pattern: /(讨论|discussion)/i },
    { label: '结论', pattern: /(结论|conclusion)/i },
    { label: '声明', pattern: /(声明|致谢|基金|利益冲突|additional\s+statements?|acknowledg)/i },
  ];

  return chapters
    .filter(chapter => chapter.pattern.test(value))
    .map(chapter => chapter.label);
}

function extractUserScopedMemoryByRules(userMessage: string): Record<string, string> {
  const extracted: Record<string, string> = {};
  const userText = userMessage.trim();
  if (!userText) {
    return extracted;
  }
  const userLower = userText.toLowerCase();

  const progressValue = firstCapture(userText, [
    /(?:当前|现在|目前)?(?:写作)?(?:进度|阶段)\s*(?:是|为|:|：)\s*([^\n。；;!?！？]{2,80})/i,
    /(?:正在|目前正在|现在正在|开始|继续)\s*([^\n。；;!?！？]{2,80}(?:写作|撰写|修改|润色|整理)[^\n。；;!?！？]{0,20})/i,
  ]);
  if (progressValue) {
    const cleanedProgress = normalizeMemoryCandidate(progressValue);
    if (cleanedProgress.length >= 2 && cleanedProgress.length <= 80 && !isSuggestionLikeMemoryValue(cleanedProgress)) {
      extracted.writing_progress = cleanedProgress;
    }
  } else if ((userLower.includes('引言') || userLower.includes('introduction')) && /(正在|开始|继续|撰写|写作|修改|润色)/i.test(userText)) {
    extracted.writing_progress = '引言撰写中';
  }

  const completedValue = firstCapture(userText, [
    /(?:已完成|完成了|finished|completed)(?:的)?(?:章节|章|sections?|chapters?)?[：:\s]*([^\n。；;!?！？]{2,120})/i,
    /(?:章节|sections?|chapters?)[^\n。；;!?！？]{0,20}(?:已完成|completed)[：:\s]*([^\n。；;!?！？]{2,120})/i,
  ]);
  if (completedValue) {
    const cleanedCompleted = normalizeMemoryCandidate(completedValue);
    const completedChapters = extractChapterNames(cleanedCompleted);
    if (completedChapters.length > 0 && !isPartialChapterStatus(cleanedCompleted)) {
      extracted.completed_chapters = [...new Set(completedChapters)].join('、');
    }
  }

  const pendingValue = firstCapture(userText, [
    /(?:待完成|待撰写|还要写|还需要写|接下来写|下一步写|pending|todo)[：:\s]*([^\n。；;!?！？]{2,120})/i,
  ]);
  if (pendingValue) {
    const cleanedPending = normalizeMemoryCandidate(pendingValue);
    const pendingChapters = extractChapterNames(cleanedPending);
    if (pendingChapters.length > 0 && !isPartialChapterStatus(cleanedPending)) {
      extracted.pending_chapters = [...new Set(pendingChapters)].join('、');
    }
  }

  const journalValue = firstCapture(userText, [
    /(?:我的目标期刊|目标期刊|投稿目标|目标投稿期刊)\s*(?:是|为|:|：)\s*([^\n。；;!?！？]{3,100})/i,
    /(?:我想投|我要投|准备投|打算投|投到|提交到|发表在|发在|投给)\s*([^\n。；;!?！？]{3,100})/i,
    /(?:target\s+journal|submit\s+to|publish\s+in|aiming\s+for|planning\s+to\s+submit|will\s+submit)\s*(?:is|to|in|:|：)\s*([^\n.。；;!?！？]{3,100})/i,
  ]);
  if (journalValue) {
    const cleanedJournal = cleanTargetJournalValue(journalValue);
    if (isValidTargetJournal(cleanedJournal)) {
      extracted.target_journal = cleanedJournal;
    }
  }

  const topicValue = firstCapture(userText, [
    /(?:我的论文主题|论文主题|研究主题|论文题目|研究题目|研究方向|研究内容)\s*(?:是|为|:|：)\s*([^\n。；;!?！？]{5,120})/i,
    /(?:我的论文主题|论文主题|研究主题|论文题目|研究题目)\s*[（(]\s*([^）)\n]{5,120})\s*[）)]/i,
    /(?:我要写一篇关于|帮我写关于|写一篇关于|论文关于)\s*([^\n。；;!?！？]{5,120})/i,
    /(?:my\s+research\s+topic|paper\s+topic|thesis\s+topic|research\s+focus|study\s+focus)\s*(?:is|:|：)\s*([^\n.。；;!?！？]{5,120})/i,
  ]);
  if (topicValue) {
    const cleanedTopic = cleanPaperTopicValue(topicValue);
    if (isValidPaperTopic(cleanedTopic)) {
      extracted.paper_topic = cleanedTopic;
    }
  }

  return extracted;
}

export function applyUserScopedMemoryGuards(extracted: Record<string, string>, userMessage: string, source: string): Record<string, string> {
  const guarded: Record<string, string> = { ...extracted };
  const explicitUserScoped = extractUserScopedMemoryByRules(userMessage);

  for (const key of USER_SCOPED_MEMORY_KEYS) {
    if (guarded[key] && !explicitUserScoped[key]) {
      logger.info(`[Memory] Dropped ${source} extraction for "${key}" - no explicit user evidence`);
      delete guarded[key];
    }
  }

  return {
    ...guarded,
    ...explicitUserScoped,
  };
}

/**
 * POST /api/memory/update
 * 根据对话内容更新用户记忆
 * Bug #5 修复：使用锁机制避免并发竞争
 */
router.post('/update', async (req: Request, res: Response) => {
  try {
    // Bug 修复：从 session 获取 userId（优先级：session > req.body.userId > 'web-user'）
    const userId = await resolveUserId(req.body.userId);
    
    logger.info(`[Memory] Updating memory for user: ${userId} (source: session-priority)`);
    const userMessage = req.body.userMessage || '';
    const aiResponse = req.body.aiResponse || '';
    const apiUrl = req.body.apiUrl || process.env.API_URL || '';
    const apiKey = req.body.apiKey || process.env.API_KEY || '';
    const model = req.body.model || 'gpt-3.5-turbo';

    // Bug #5 修复：使用锁机制确保串行更新
    const result = await withMemoryLock(userId, async () => {
      // 加载现有记忆
      const userMemory = await loadUserMemory(userId);
      
      // 提取需要更新的记忆键值对（使用用户配置的小牛马模型）
      const secondaryModel = req.body.secondaryModel || process.env.SECONDARY_MODEL || 'gpt-4o-mini';
      const extractedInfo = await extractMemoryFromConversation(
        userMessage,
        aiResponse,
        apiUrl,
        apiKey,
        secondaryModel
      );

      // 更新记忆（增量合并）
      const updatedKeys: string[] = [];
      for (const [key, value] of Object.entries(extractedInfo)) {
        // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
        autoRestoreDeletedKeyIfEmpty(userMemory, key);
        
        // Bug fix: 检查该键是否已被用户删除，如果是则跳过写入
        if (isKeyDeleted(userMemory, key)) {
          logger.info(`[Memory] SKIP "${key}" - user has deleted this key (protected from auto-restore)`);
          continue;
        }
        
        // Bug fix: 确保 value 是字符串类型，避免 .trim() 报错
        if (value && typeof value === 'string' && value.trim() && value.trim() !== '无' && value.trim() !== '未提及') {
          // 查找是否已存在
          const existingIndex = userMemory.entries.findIndex(e => e.key === key);
          const existing = existingIndex >= 0 ? userMemory.entries[existingIndex] : null;
          
          // 增量合并：检查是否已有相同内容，避免重复
          let mergedValue = value.trim();
          if (existing && existing.value) {
            // ========== AI 智能整合策略：长文本字段不再直接替换 ==========
            // 使用 aiMergeMemoryContent 进行智能合并，保留旧版本内容的同时融入新信息
            if (['experiment_summary', 'experiment_summary_structured', 'data_summary', 'data_summary_structured', 'key_findings'].includes(key)) {
              const MAX_MEMORY_LENGTH = 10000;  // 单字段最大长度
              
              // 检查重复：如果新内容与旧内容相似，跳过
              if (isDuplicateContent(existing.value, value.trim())) {
                logger.info(`[Memory] Skip duplicate content for ${key}`);
                continue;
              }
              
              const oldLen = existing.value.length;
              const newLen = value.trim().length;
              
              // 优先使用 AI 智能整合，避免直接替换导致旧内容丢失
              if (apiUrl && apiKey) {
                mergedValue = await aiMergeMemoryContent(
                  existing.value,
                  value.trim(),
                  key as 'experiment_summary' | 'data_summary' | 'key_findings',
                  apiUrl,
                  apiKey,
                  secondaryModel
                );
                logger.info(`[Memory] AI merged ${key}: ${oldLen} + ${newLen} → ${mergedValue.length} chars`);
              } else {
                // 无 API 配置时 fallback 到直接替换（无法调用 AI 整合）
                mergedValue = value.trim();
                logger.info(`[Memory] No API config, fallback replace ${key}: ${oldLen} → ${newLen} chars`);
              }
              
              // 如果超过长度限制，触发压缩
              if (mergedValue.length > MAX_MEMORY_LENGTH) {
                logger.warn(`[Memory] ${key} exceeds ${MAX_MEMORY_LENGTH} chars (${mergedValue.length}), will need compression`);
                // 不在这里压缩，保持完整内容，由调用方决定是否需要压缩
              }
            } 
            // Bug fix: 对关键状态字段添加保护机制，防止意外替换
            else if (['target_journal', 'paper_topic', 'writing_progress'].includes(key)) {
              // 检查是否真的是用户想要更新
              // 只有当新值与旧值明显不同（不是同义词、缩写）才更新
              const existingValue = existing.value.trim().toLowerCase();
              const newValue = value.trim().toLowerCase();
              
              // 判断是否是实质性的改变（而非简单的格式差异）
              const isSubstantiveChange = !isSimilarValue(existingValue, newValue);
              
              if (isSubstantiveChange) {
                // 记录旧值和新值，方便追溯
                logger.info(`[Memory] Protected field ${key} updated: "${existing.value}" → "${value.trim()}"`);
                mergedValue = value.trim();
              } else {
                // 值相似，不更新（保护现有设置）
                logger.info(`[Memory] Skip similar value for protected field ${key}: existing="${existing.value}", new="${value.trim()}"`);
                continue;
              }
            }
            else {
              // 其他状态类字段，直接更新
              mergedValue = value.trim();
            }
          }
          
          const entry: MemoryEntry = {
            key,
            value: mergedValue,
            source: 'conversation',
            timestamp: new Date().toISOString()
          };

          if (existingIndex >= 0) {
            userMemory.entries[existingIndex] = entry;
          } else {
            userMemory.entries.push(entry);
          }
          updatedKeys.push(key);
          logger.info(`[Memory] Updated ${key} for user: ${userId}`);
        }
      }

      // 保存记忆
      userMemory.updatedAt = new Date().toISOString();
      await saveUserMemory(userMemory);
      
      // 同时写入具体文件
      await saveMemoryToFiles(userId, userMemory);

      return { updatedKeys, message: `Memory updated: ${updatedKeys.join(', ')}` };
    });

    const researchSession = await recordMemoryResearchProvenance({
      userId,
      researchSessionId: typeof req.body.researchSessionId === 'string' ? req.body.researchSessionId : undefined,
      userMessage,
      aiResponse,
      updatedKeys: result.updatedKeys,
    }).catch((error) => {
      logger.warn('[ResearchSession] Failed to record memory provenance:', error);
      return undefined;
    });

    res.json({
      success: true,
      ...result,
      researchSession,
    });

  } catch (error) {
    logger.error('[Memory] Update error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * 从对话中提取记忆信息（使用小牛马配置的模型）
 */
export async function extractMemoryFromConversation(
  userMessage: string,
  aiResponse: string,
  apiUrl: string,
  apiKey: string,
  secondaryModel: string
): Promise<Record<string, string>> {
  let extracted: Record<string, string> = {};

  // 如果没有配置 API，使用简单的规则提取
  if (!apiUrl || !apiKey) {
    logger.info('[Memory] No API configured, using rule-based extraction');
    return extractMemoryByRules(userMessage, aiResponse);
  }

  // 使用用户配置的小牛马模型（不再写死）
  const model = secondaryModel || 'gpt-4o-mini';  // fallback 到轻量级模型

  // 使用 API 进行智能提取
  try {
    const prompt = `你是一个信息提取助手（小牛马）。请从以下对话中提取关键信息，用于更新用户画像。

## 需要提取的字段（根据对话内容选择性提取）

### 📋 实验资料类（描述性信息）
**experiment_summary** - 试验资料总结：专门用于提取**描述性信息**
- 适用内容：研究背景、实验目的、实验设计、实验方法、采样方案、测定方法、研究意义等
- 典型内容：实验地点描述、处理设置说明、采样装置介绍、测定方法说明、研究背景阐述、试验地土壤物化生指标
- 试验地土壤物化生指标：如pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、含水量/WFPS、微生物量、酶活性、微生物群落等，有就提取，没有就留空，不要编造
- 触发条件：用户描述实验过程、方法、设计、背景、目的等非数值性内容

### 📊 数据结果类（数值型信息）
**data_summary** - 数据详细总结：专门用于提取**数值型结果**
- 适用内容：具体数值、表格数据、统计结果、排放量/通量数据、环境指标数值、对比数据
- 典型内容：
  - 表格中的数值（如：处理A排放量 1.77 kg N ha⁻¹，处理B 4.86 kg N ha⁻¹）
  - 统计指标（如：显著性 p<0.05，标准差 ±0.23，均值 15.2）
  - 环境数值（如：温度 25.3℃，降水 550mm，WFPS 45%）
  - 时间序列数据点、峰值数值、累积排放量
- 触发条件：对话中出现具体数值、表格、统计结果、数据对比

  ### 其他字段
  - **writing_progress** - 写作整体进度。只能从“用户”段落中明确表达的进度提取，不能从 AI 回复的建议、计划或总结中提取。
  - **completed_chapters** - 已完成的章节列表。只能记录完整章节名称，不能把“前两段内容/第三段建议/结构安排”等段落级内容写入。
  - **pending_chapters** - 待完成的章节列表。只能从用户明确说出的待完成章节提取。
  - **paper_topic** - 论文主题。只能从用户明确声明的论文主题/研究主题提取，不能从 AI 回复中的评价句、建议句或期刊契合度判断中提取。
  - **target_journal** - 目标期刊。只能从用户明确设置的投稿目标提取，不能把“Target journal/目标期刊”等标签词或 AI 回复中的期刊风格说明当作值。
  - **key_findings** - 关键发现/研究结论
  - **research_method** - 研究方法概述

## ⚠️ 重要区分规则

**experiment_summary 与 data_summary 必须区分**：
1. 纯文字描述 → experiment_summmary（如："实验采用静态箱法测定N2O排放"）
2. 包含数值 → data_summmary（如："Sum_O处理累积排放4.86 kg N ha⁻¹"）
3. 表格/图表数据 → data_summmary
4. 方法说明 → experiment_summmary（不含数值的方法描述）
5. 结果数值 → data_summmary（带具体数值的结果）

**混合内容处理**：
- 如果一段内容同时包含描述和数值，则：
  - 描述部分 → experiment_summmary
  - 数值部分 → data_summmary
- 例如："采用静态箱法采样（描述），测得排放量1.77 kg N ha⁻¹（数值）"
  - experiment_summmary: "采用静态箱法采样..."
  - data_summmary: "排放量1.77 kg N ha⁻¹..."

## 对话内容

用户: ${userMessage}

AI: ${aiResponse}

## 输出格式
只返回 JSON 格式，例如：
{
  "experiment_summary": "本研究采用静态箱法在曲周试验站测定N2O排放...",
  "data_summary": "2021年Spr_O累积排放1.77 kg N ha⁻¹，Sum_O为4.86 kg N ha⁻¹，差异显著(p<0.05)",
  "paper_topic": "华北平原N2O排放机制"
}

如果没有相关信息，**不要编造**，直接省略该字段或填"未提及"。

只返回 JSON，不要有其他文字。`;

    const response = await fetch(apiUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: secondaryModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
        // 不设置 max_tokens，使用模型默认最大输出长度
      })
    });

    if (response.ok) {
      const data: any = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // 解析 JSON
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          for (const [key, value] of Object.entries(parsed)) {
            if (typeof value === 'string') {
              extracted[key] = value;
            }
          }
          logger.info('[Memory] AI extraction successful:', Object.keys(parsed));
        }
      } catch (e) {
        logger.warn('[Memory] Failed to parse AI response:', content);
      }
    }
  } catch (e) {
    logger.warn('[Memory] AI extraction failed, falling back to rules:', e);
  }

  // 用户设定/进度类字段必须有用户原文证据，避免 AI 回复建议句误入长期记忆。
  extracted = applyUserScopedMemoryGuards(extracted, userMessage, 'AI');

  // 如果 AI 提取失败或被守卫规则全部过滤，使用规则提取
  if (Object.keys(extracted).length === 0) {
    return extractMemoryByRules(userMessage, aiResponse);
  }

  // ========== AI 提取后验证补充机制 ==========
  // 检查 AI 是否遗漏了应该提取的数据内容
  const combined = userMessage + ' ' + aiResponse;
  
  // 1. 如果 AI 没有提取 data_summary，但对话中有数值数据，强制补充
  if (!extracted.data_summary || extracted.data_summary === '未提及') {
    const numericPatterns = [
      /[\d]+\.?\d*\s*(kg|ha|mm|℃|°C|g|mg|%|N|P|K|ppm|pH|排放|通量|flux|emission)/gi,
      /(p\s*[<>=]\s*0\.?\d*|显著|significant)/gi,
    ];
    
    let hasNumeric = false;
    for (const pattern of numericPatterns) {
      if (pattern.test(combined)) {
        hasNumeric = true;
        break;
      }
    }
    
    if (hasNumeric) {
      // 提取包含数值的句子
      const sentences = combined.split(/[。\n;；]/);
      const dataSentences: string[] = [];
      
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length < 15) continue;
        
        const hasNumber = /[\d]+\.?\d*\s*(kg|ha|mm|℃|%|N|P|K|ppm|排放|通量|flux|p\s*[<>=])/gi.test(trimmed);
        if (hasNumber) {
          dataSentences.push(trimmed);
        }
      }
      
      if (dataSentences.length > 0) {
        extracted.data_summary = dataSentences.join('\n');
        logger.info('[Memory] Post-AI validation: forced data_summary extraction (numeric content detected)');
      }
    }
  }
  
  // 2. 如果 AI 提取了 experiment_summary 但其中混入了数值数据，分离到 data_summary
  if (extracted.experiment_summary && extracted.experiment_summary !== '未提及') {
    const expContent = extracted.experiment_summary;
    const hasNumericInExp = /[\d]+\.?\d*\s*(kg|ha|mm|℃|%|N|P|K|ppm|排放|通量|flux|p\s*[<>=])/gi.test(expContent);
    
    if (hasNumericInExp && (!extracted.data_summary || extracted.data_summary === '未提及')) {
      // 分离数值内容到 data_summary
      const sentences = expContent.split(/[。\n]/);
      const expSentences: string[] = [];
      const dataSentences: string[] = [];
      
      for (const sentence of sentences) {
        const trimmed = sentence.trim();
        if (trimmed.length < 15) continue;
        
        const hasNumber = /[\d]+\.?\d*\s*(kg|ha|mm|℃|%|N|P|K|ppm|排放|通量|flux|p\s*[<>=])/gi.test(trimmed);
        if (hasNumber) {
          dataSentences.push(trimmed);
        } else {
          expSentences.push(trimmed);
        }
      }
      
      if (dataSentences.length > 0) {
        extracted.data_summary = dataSentences.join('\n');
        logger.info('[Memory] Post-AI validation: separated numeric content from experiment_summary to data_summary');
      }
      
      if (expSentences.length > 0) {
        extracted.experiment_summary = expSentences.join('\n');
      }
    }
  }

  return extracted;
}

/**
 * 基于规则的简单记忆提取（增强版）
 * 
 * 强制触发机制：
 * 1. 数值检测：当对话中出现数值+单位模式时，强制提取到 data_summary
 * 2. 关键词触发：用户使用特定关键词时，优先提取到对应字段
 */
export function extractMemoryByRules(userMessage: string, aiResponse: string): Record<string, string> {
  const extracted: Record<string, string> = {};
  const combined = userMessage + ' ' + aiResponse;
  const combinedLower = combined.toLowerCase();

  // ========== 强制触发机制：数值检测 ==========
  // 检测数值+单位模式，强制提取到 data_summary
  const numericPatterns = [
    // 科学数值模式（数值 + 单位）
    /[\d]+\.?\d*\s*(kg|ha|mm|℃|°C|g|mg|%|N|P|K|ppm|pH|cm|m|yr|year|ha⁻¹|ha-1|µg|mg|ng|L|mL|d|天|周|月|季|年)/gi,
    // 排放量/通量数值（关键指标）
    /[\d]+\.?\d*\s*(kg\s*N|排放|通量|flux|emission)/gi,
    // 统计显著性
    /(p\s*[<>=]\s*0\.?\d*|显著|significant|差异)/gi,
    // 表格数据标识
    /(Table|表|Fig|图|Figure)\s*[\d]+[\s:：]*[^\n]{0,500}/gi,
    // 数值对比模式
    /[\d]+\.?\d*\s*(vs|对比|高于|低于|差异|增加|减少|提升|下降)/gi,
    // 累积/总量数值
    /(累积|累计|总量|total|cumulative|annual)[\s:：]*[\d]+\.?\d*/gi,
  ];

  const numericMatches: string[] = [];
  for (const pattern of numericPatterns) {
    const matches = combined.match(pattern);
    if (matches) {
      numericMatches.push(...matches);
    }
  }

  // 如果检测到数值模式，强制提取到 data_summary
  if (numericMatches.length >= 2) {
    // 提取包含数值的完整句子/段落
    const dataSentences: string[] = [];
    const sentences = combined.split(/[。\n;；]/);
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      if (trimmed.length < 15) continue;
      
      // 检查是否包含数值
      const hasNumeric = /[\d]+\.?\d*\s*(kg|ha|mm|℃|%|N|P|K|ppm|排放|通量|flux|emission|p\s*[<>=]|显著)/gi.test(trimmed);
      if (hasNumeric) {
        dataSentences.push(trimmed);
      }
    }
    
    if (dataSentences.length > 0) {
      extracted.data_summary = dataSentences.join('\n');
      logger.info(`[Memory] Rule-based extraction: data_summary (${numericMatches.length} numeric patterns detected)`);
    }
  }

  // ========== 强制触发机制：关键词检测 ==========
  // 用户使用数据相关关键词时，优先提取到 data_summary
  const dataKeywords = ['数据', '表格', '统计', '数值', '结果', '排放量', '通量', '测定值', '测量值', '含量', '浓度', '温度', '降水', '产量'];
  const experimentKeywords = ['方法', '实验', '试验', '设计', '采样', '测定方法', '处理', '背景', '目的', '方案'];
  
  let hasDataKeywords = false;
  let hasExperimentKeywords = false;
  
  for (const keyword of dataKeywords) {
    if (combinedLower.includes(keyword)) {
      hasDataKeywords = true;
      break;
    }
  }
  
  for (const keyword of experimentKeywords) {
    if (combinedLower.includes(keyword)) {
      hasExperimentKeywords = true;
      break;
    }
  }

  // 根据关键词优先级提取
  if (hasDataKeywords && !extracted.data_summary) {
    // 提取相关段落到 data_summary
    const sentences = combined.split(/[。\n]/);
    const dataSentences: string[] = [];
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      for (const keyword of dataKeywords) {
        if (trimmed.toLowerCase().includes(keyword) && trimmed.length > 20) {
          dataSentences.push(trimmed);
          break;
        }
      }
    }
    
    if (dataSentences.length > 0) {
      extracted.data_summary = dataSentences.join('\n');
      logger.info(`[Memory] Rule-based extraction: data_summary (keyword triggered)`);
    }
  }

  if (hasExperimentKeywords && !extracted.experiment_summary) {
    // 提取相关段落到 experiment_summary
    const sentences = combined.split(/[。\n]/);
    const experimentSentences: string[] = [];
    
    for (const sentence of sentences) {
      const trimmed = sentence.trim();
      for (const keyword of experimentKeywords) {
        if (trimmed.toLowerCase().includes(keyword) && trimmed.length > 20) {
          // 检查是否包含数值（数值应该放到 data_summary）
          const hasNumeric = /[\d]+\.?\d*\s*(kg|ha|mm|℃|%|N|P|K|ppm|排放|通量)/gi.test(trimmed);
          if (!hasNumeric) {
            experimentSentences.push(trimmed);
          }
          break;
        }
      }
    }
    
    if (experimentSentences.length > 0) {
      extracted.experiment_summary = experimentSentences.join('\n');
      logger.info(`[Memory] Rule-based extraction: experiment_summary (keyword triggered)`);
    }
  }

  // 用户设定/写作进度类字段只看用户原文，不从 AI 回复中提取，避免建议句或标签词误入库。
  const userScopedInfo = extractUserScopedMemoryByRules(userMessage);
  for (const [key, value] of Object.entries(userScopedInfo)) {
    logger.info(`[Memory] Rule-based extraction: ${key} (explicit user evidence): "${value.substring(0, 60)}"`);
  }
  Object.assign(extracted, userScopedInfo);

  return extracted;
}

/**
 * AI 智能整合记忆内容（共享函数）
 * 用于长文本字段（experiment_summary, data_summary 等）的智能合并，避免直接替换导致旧内容丢失
 * 
 * @param existingContent 现有记忆内容
 * @param newContent 新提取的内容
 * @param contentType 内容类型标识（用于 prompt 区分）
 * @param apiUrl API 地址
 * @param apiKey API Key
 * @param model 使用的模型
 * @returns 整合后的内容
 */
export async function aiMergeMemoryContent(
  existingContent: string,
  newContent: string,
  contentType: 'experiment_summary' | 'data_summary' | 'key_findings',
  apiUrl: string,
  apiKey: string,
  model: string
): Promise<string> {
  if (!existingContent || existingContent.trim().length === 0) {
    return newContent.trim();
  }
  
  if (!newContent || newContent.trim().length === 0) {
    return existingContent.trim();
  }
  
  // 如果内容完全包含，直接返回
  if (existingContent.includes(newContent.trim())) {
    logger.info(`[Memory] aiMerge: new content fully contained in existing, keeping existing`);
    return existingContent.trim();
  }
  
  const typeLabel = contentType === 'experiment_summary' 
    ? '实验资料总结' 
    : contentType === 'data_summary' 
      ? '数据详细总结' 
      : '关键发现';
  
  const mergePrompt = `你是一个研究数据管理助手。请将新提取的信息与现有记忆智能整合。

## 现有记忆（${typeLabel}）
${existingContent}

## 新提取的信息（${typeLabel}）
${newContent}

## 整合要求
1. 去重：重复信息保留一份，不要重复
2. 补充：新信息自然融入现有内容，不要简单拼接
3. 更新：如果新旧信息有冲突，以新信息为准
4. 连贯：整合后的内容应是一段连贯的文字，逻辑流畅
5. 完整：不要遗漏任何关键信息（实验细节、数值、统计结果等）
6. 精炼：删除冗余描述，保持简洁

直接输出整合后的完整内容，不要其他文字。`;

  try {
    const response = await fetch(apiUrl + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: mergePrompt }],
        temperature: 0.3,
        max_tokens: 32000,
      })
    });
    
    if (response.ok) {
      const data: any = await response.json();
      const merged = data.choices?.[0]?.message?.content?.trim();
      
      if (merged && merged.length > 10) {
        logger.info(`[Memory] aiMerge: ${typeLabel} merged successfully (${existingContent.length} + ${newContent.length} → ${merged.length} chars)`);
        return merged;
      }
    }
    
    logger.warn(`[Memory] aiMerge: API call failed or returned empty, falling back to append`);
  } catch (e) {
    logger.warn(`[Memory] aiMerge: error during merge, falling back to append:`, e);
  }
  
  // Fallback: 保留现有内容，在末尾追加新内容的关键差异部分
  // 尝试去除重复后追加
  const newLines = newContent.split(/[。\n]/).map(s => s.trim()).filter(s => s.length > 10);
  const uniqueNewLines = newLines.filter(line => !existingContent.includes(line));
  
  if (uniqueNewLines.length > 0) {
    const appended = existingContent.trim() + '\n\n【补充信息】\n' + uniqueNewLines.join('。');
    logger.info(`[Memory] aiMerge: fallback append (${uniqueNewLines.length} unique sentences)`);
    return appended;
  }
  
  return existingContent.trim();
}

/**
 * Zod Schema for memory.json validation
 */
const ConversationSummarySchema = z.object({
  id: z.string(),
  title: z.string().default(''),
  summary: z.string().default(''),
  keyTopics: z.array(z.string()).default([]),
  messageCount: z.number().default(0),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

const UserMemorySchema = z.object({
  userId: z.string().default(''),
  entries: z.array(z.object({
    key: z.string(),
    value: z.string(),
    source: z.string(),
    timestamp: z.string(),
  })).default([]),
  conversations: z.array(ConversationSummarySchema).default([]),
  updatedAt: z.string().default(() => new Date().toISOString()),
  // 兼容旧版本 memory.json。当前不再使用 deletedKeys 阻止 AI 自动更新。
  deletedKeys: z.array(z.string()).default([]),
});

async function writeTextFileAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fsp.mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);

  await fsp.writeFile(tempPath, content, 'utf-8');
  await fsp.rename(tempPath, filePath).catch(async (error) => {
    await fsp.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  });
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  const content = JSON.stringify(value, null, 2);
  JSON.parse(content);
  await writeTextFileAtomic(filePath, content);
}

function parseSyncedMemoryFile(content: string, fallbackKey: string): { key: string; value: string; timestamp: string } | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^【[^】]+】\s+更新时间:\s*([^\n]+)\s+来源:\s*([^\n]+)\s+([\s\S]*)$/);
  if (match?.[3]?.trim()) {
    return {
      key: match[2].trim() || fallbackKey,
      value: match[3].trim(),
      timestamp: match[1].trim() || new Date().toISOString(),
    };
  }

  return {
    key: fallbackKey,
    value: trimmed,
    timestamp: new Date().toISOString(),
  };
}

async function recoverMemoryFromSyncedFiles(userId: string): Promise<UserMemory | null> {
  const userMemoryDir = path.join(memoryDir, userId);
  const candidates: Array<{ fileName: string; fallbackKey: string }> = [
    { fileName: '试验资料总结.txt', fallbackKey: 'experiment_summary_structured' },
    { fileName: '数据详细总结.txt', fallbackKey: 'data_summary_structured' },
  ];
  const entries: MemoryEntry[] = [];

  for (const candidate of candidates) {
    const filePath = path.join(userMemoryDir, candidate.fileName);
    try {
      const content = await fsp.readFile(filePath, 'utf-8');
      const parsed = parseSyncedMemoryFile(content, candidate.fallbackKey);
      if (!parsed || parsed.value.length <= 10) continue;
      entries.push({
        key: parsed.key,
        value: parsed.value,
        source: 'recovered-sync-file',
        timestamp: parsed.timestamp,
      });
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        logger.warn(`[Memory] Failed to read synced memory file for recovery: ${filePath}`, error);
      }
    }
  }

  if (entries.length === 0) return null;
  const recovered: UserMemory = {
    userId,
    entries,
    conversations: [],
    updatedAt: new Date().toISOString(),
    deletedKeys: [],
  };
  logger.warn(`[Memory] Recovered ${entries.length} memory entries for ${userId} from synced txt files`);
  return recovered;
}

function compactPreview(value: string, maxChars = 900): string {
  const text = String(value || '').trim();
  if (text.length <= maxChars) return text;
  const half = Math.floor(maxChars / 2);
  return `${text.slice(0, half)}\n\n...\n\n${text.slice(-half)}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPendingMemoryEditPath(userId: string): string {
  return path.join(memoryDir, userId, 'pending-memory-edit.json');
}

function getMemoryEditBackupDir(userId: string): string {
  return path.join(memoryDir, userId, 'edit-backups');
}

function normalizeEditInstruction(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function matchAnyPattern(value: string, patterns: RegExp[]): boolean {
  const text = normalizeEditInstruction(value);
  return patterns.some(pattern => pattern.test(text));
}

export function isMemoryEditConfirmation(message: string): boolean {
  return matchAnyPattern(message, MEMORY_EDIT_CONFIRM_PATTERNS);
}

export function isMemoryEditCancellation(message: string): boolean {
  return matchAnyPattern(message, MEMORY_EDIT_CANCEL_PATTERNS);
}

export async function getPendingMemoryEdit(userId: string): Promise<PendingMemoryEdit | null> {
  const pendingPath = getPendingMemoryEditPath(userId);
  try {
    const content = await fsp.readFile(pendingPath, 'utf-8');
    const pending = JSON.parse(content) as PendingMemoryEdit;
    if (!pending?.id || !pending?.targetKey) return null;
    if (pending.expiresAt && Date.now() > new Date(pending.expiresAt).getTime()) {
      await fsp.rm(pendingPath, { force: true }).catch(() => undefined);
      return null;
    }
    return pending;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      logger.warn(`[MemoryEdit] Failed to read pending edit for ${userId}:`, error);
    }
    return null;
  }
}

async function savePendingMemoryEdit(edit: PendingMemoryEdit): Promise<void> {
  await writeJsonFileAtomic(getPendingMemoryEditPath(edit.userId), edit);
}

async function clearPendingMemoryEdit(userId: string): Promise<void> {
  await fsp.rm(getPendingMemoryEditPath(userId), { force: true }).catch(() => undefined);
}

export function isLikelyMemoryEditInstruction(message: string): boolean {
  const text = normalizeEditInstruction(message);
  if (text.length < 4) return false;
  const hasEditVerb = /(修改|更改|改成|改为|替换|替换为|删除|清空|移除|删掉|补充|追加|添加|合并|更新|设为|设置为)/.test(text);
  const hasMemoryScope = /(长期记忆|跨会话|记忆|数据详细总结|实验资料总结|试验资料总结|写作进度|论文草稿|草稿进度|目标期刊|论文主题|已完成章节|待完成章节|关键发现)/.test(text);
  return hasEditVerb && hasMemoryScope;
}

function detectMemoryEditTarget(instruction: string): { key: string; label: string } | null {
  const text = normalizeEditInstruction(instruction).toLowerCase();
  let best: { key: string; label: string; score: number } | null = null;
  for (const target of MEMORY_EDIT_TARGETS) {
    let score = 0;
    for (const alias of target.aliases) {
      if (text.includes(alias.toLowerCase())) {
        score = Math.max(score, alias.length);
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { key: target.key, label: target.label, score };
    }
  }
  return best ? { key: best.key, label: best.label } : null;
}

function detectMemoryEditAction(instruction: string): MemoryEditAction {
  const text = normalizeEditInstruction(instruction);
  if (/(删除|清空|移除|删掉)/.test(text)) return 'delete';
  if (/(补充|追加|添加|合并|加入)/.test(text)) return 'append';
  return 'replace';
}

function stripTargetPrefix(value: string): string {
  return value
    .replace(/^(?:把|将)?(?:跨会话)?(?:长期)?记忆(?:里|中|里面|中的)?/i, '')
    .replace(/^(?:把|将)?(?:实验资料总结|试验资料总结|数据详细总结|数据总结|写作进度|论文草稿|草稿进度|论文主题|目标期刊|已完成章节|待完成章节|关键发现)(?:里|中|里面|中的)?/i, '')
    .replace(/^(?:修改|更改|更新|设置|设为|改成|改为|替换为|补充|追加|添加|删除|清空|移除|删掉)[：:\s]*/i, '')
    .trim();
}

function parseReplacePair(instruction: string): { oldText?: string; newText?: string } {
  const text = normalizeEditInstruction(instruction);
  const patterns = [
    /(?:把|将)(.+?)(?:改成|改为|替换为)(.+)$/i,
    /(.+?)(?:改成|改为|替换为)(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[2]) continue;
    const oldText = stripTargetPrefix(match[1]).replace(/^(?:里|中|里面|中的)/, '').trim();
    const newText = match[2].trim();
    if (newText) return { oldText: oldText || undefined, newText };
  }

  const setMatch = text.match(/(?:设为|设置为|更新为|修改为)[：:\s]*(.+)$/i);
  if (setMatch?.[1]) {
    return { newText: setMatch[1].trim() };
  }
  return {};
}

function parseDeleteNeedle(instruction: string): string | undefined {
  const text = normalizeEditInstruction(instruction);
  const match = text.match(/(?:删除|清空|移除|删掉)[：:\s]*(.+)$/i);
  if (!match?.[1]) return undefined;
  const candidate = stripTargetPrefix(match[1]).trim();
  if (!candidate || MEMORY_EDIT_TARGETS.some(target => target.aliases.includes(candidate))) return undefined;
  return candidate;
}

function parseAppendText(instruction: string): string | undefined {
  const text = normalizeEditInstruction(instruction);
  const match = text.match(/(?:补充|追加|添加|合并|加入)[：:\s]*(.+)$/i);
  if (!match?.[1]) return undefined;
  return stripTargetPrefix(match[1]).trim() || undefined;
}

function applyMemoryEditOperation(input: {
  action: MemoryEditAction;
  beforeValue: string;
  instruction: string;
  oldText?: string;
  newText?: string;
  appendText?: string;
  deleteNeedle?: string;
}): { afterValue: string; summary: string; oldText?: string; newText?: string } {
  const before = input.beforeValue || '';
  if (input.action === 'delete') {
    if (input.deleteNeedle && before.includes(input.deleteNeedle)) {
      const after = before.replace(new RegExp(escapeRegExp(input.deleteNeedle), 'g'), '').replace(/\n{3,}/g, '\n\n').trim();
      return { afterValue: after, summary: `删除字段内匹配文本：${input.deleteNeedle}`, oldText: input.deleteNeedle };
    }
    return { afterValue: '', summary: '清空该长期记忆字段' };
  }

  if (input.action === 'append') {
    const appendText = (input.appendText || stripTargetPrefix(input.instruction)).trim();
    const block = `【用户补充修改】\n${appendText}`;
    const after = before.trim() ? `${before.trim()}\n\n---\n\n${block}` : appendText;
    return { afterValue: after, summary: `向字段末尾补充 ${appendText.length} 字`, newText: appendText };
  }

  const newText = input.newText?.trim();
  const oldText = input.oldText?.trim();
  if (oldText && newText && before.includes(oldText)) {
    return {
      afterValue: before.replace(new RegExp(escapeRegExp(oldText), 'g'), newText).trim(),
      summary: `替换字段内文本：“${oldText}” -> “${newText}”`,
      oldText,
      newText,
    };
  }
  if (newText && !oldText) {
    return {
      afterValue: newText,
      summary: '将该长期记忆字段整体更新为用户指定内容',
      newText,
    };
  }

  const fallbackText = stripTargetPrefix(input.instruction);
  return {
    afterValue: fallbackText,
    summary: '未识别到明确旧文本，预览为整体更新；请确认后再写入',
    newText: fallbackText,
  };
}

function findEntryValue(memory: UserMemory, key: string): string {
  const entry = memory.entries.find(item => item.key === key);
  if (entry?.value) return entry.value;
  const rawKey = Object.entries(STRUCTURED_SUMMARY_KEY_BY_RAW_KEY).find(([, structuredKey]) => structuredKey === key)?.[0];
  if (rawKey) {
    return memory.entries.find(item => item.key === rawKey)?.value || '';
  }
  return '';
}

function formatMemoryEditPreview(edit: PendingMemoryEdit): string {
  return [
    '已识别到一条长期记忆编辑指令，先生成预览，尚未写入。',
    '',
    `- 编辑对象：${edit.targetLabel}（${edit.targetKey}）`,
    `- 操作类型：${edit.action === 'delete' ? '删除/清空' : edit.action === 'append' ? '补充/合并' : '替换/更新'}`,
    `- 修改摘要：${edit.summary}`,
    '',
    '修改前预览：',
    '```text',
    compactPreview(edit.beforeValue || '（当前为空）', 1000),
    '```',
    '',
    '修改后预览：',
    '```text',
    compactPreview(edit.afterValue || '（将清空该字段）', 1000),
    '```',
    '',
    `确认写入请回复：确认修改`,
    `取消请回复：取消修改`,
    `编辑编号：${edit.id}`,
  ].join('\n');
}

async function inferMemoryEditWithAi(input: {
  instruction: string;
  detectedTarget?: { key: string; label: string } | null;
  action: MemoryEditAction;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<{ targetKey?: string; action?: MemoryEditAction; oldText?: string; newText?: string; appendText?: string; deleteNeedle?: string; summary?: string } | null> {
  if (!input.apiUrl || !input.apiKey) return null;
  const targetList = MEMORY_EDIT_TARGETS.map(target => `- ${target.key}: ${target.label}（别名：${target.aliases.join('、')}）`).join('\n');
  const prompt = `你是长期记忆编辑指令解析器。请只输出 JSON，不要解释。

可编辑字段：
${targetList}

用户指令：
${input.instruction}

请判断：
- targetKey: 最匹配字段 key
- action: replace/delete/append
- oldText: 如果是把 A 改成 B，填 A；如果是整体设置，留空
- newText: replace 的新内容或整体设置内容
- appendText: append 的追加内容
- deleteNeedle: delete 时如果只删除字段内某段文本，填该文本；如果清空整个字段，留空
- summary: 20字以内中文摘要

输出 JSON 示例：
{"targetKey":"data_summary_structured","action":"replace","oldText":"Figure 2d（a）","newText":"Figure 2d","summary":"修正图件编号"}`;

  try {
    const response = await fetch(`${input.apiUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: 800,
      }),
    });
    if (!response.ok) return null;
    const data: any = await response.json();
    const content = String(data.choices?.[0]?.message?.content || '').trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    logger.warn('[MemoryEdit] AI instruction parse failed, using rules:', error);
    return null;
  }
}

export async function createMemoryEditPreview(input: {
  userId: string;
  instruction: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
}): Promise<MemoryEditPreviewResult> {
  const instruction = normalizeEditInstruction(input.instruction);
  if (!isLikelyMemoryEditInstruction(instruction)) {
    return { handled: false, message: '' };
  }

  const ruleTarget = detectMemoryEditTarget(instruction);
  const ruleAction = detectMemoryEditAction(instruction);
  const ai = await inferMemoryEditWithAi({
    instruction,
    detectedTarget: ruleTarget,
    action: ruleAction,
    apiUrl: input.apiUrl,
    apiKey: input.apiKey,
    model: input.model,
  });

  const targetKey = String(ai?.targetKey || ruleTarget?.key || '').trim();
  const target = MEMORY_EDIT_TARGETS.find(item => item.key === targetKey) || ruleTarget;
  if (!target) {
    return {
      handled: true,
      message: '我识别到你想修改长期记忆，但没有定位到具体字段。请明确说明要修改“实验资料总结、数据详细总结、写作进度、论文草稿进度、论文主题、目标期刊”等哪个部分。',
    };
  }

  const memory = await loadUserMemory(input.userId);
  const beforeValue = findEntryValue(memory, target.key);
  const parsedPair = parseReplacePair(instruction);
  const action = (['replace', 'delete', 'append'].includes(String(ai?.action)) ? ai?.action : ruleAction) as MemoryEditAction;
  const operation = applyMemoryEditOperation({
    action,
    beforeValue,
    instruction,
    oldText: String(ai?.oldText || parsedPair.oldText || '').trim() || undefined,
    newText: String(ai?.newText || parsedPair.newText || '').trim() || undefined,
    appendText: String(ai?.appendText || parseAppendText(instruction) || '').trim() || undefined,
    deleteNeedle: String(ai?.deleteNeedle || parseDeleteNeedle(instruction) || '').trim() || undefined,
  });

  const edit: PendingMemoryEdit = {
    id: `memedit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: input.userId,
    action,
    targetKey: target.key,
    targetLabel: target.label,
    instruction,
    beforeValue,
    afterValue: operation.afterValue,
    summary: String(ai?.summary || operation.summary || '长期记忆编辑').trim(),
    oldText: operation.oldText,
    newText: operation.newText,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };
  await savePendingMemoryEdit(edit);
  return {
    handled: true,
    pendingEdit: edit,
    message: formatMemoryEditPreview(edit),
  };
}

async function createMemoryEditBackup(userId: string, edit: PendingMemoryEdit): Promise<string> {
  const backupId = `backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${edit.id}`;
  const backupDir = path.join(getMemoryEditBackupDir(userId), backupId);
  await fsp.mkdir(backupDir, { recursive: true });
  const userMemoryDir = path.join(memoryDir, userId);
  const files = ['memory.json', '试验资料总结.txt', '数据详细总结.txt', 'pending-memory-edit.json'];
  for (const fileName of files) {
    const source = path.join(userMemoryDir, fileName);
    const target = path.join(backupDir, fileName);
    try {
      await fsp.copyFile(source, target);
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        logger.warn(`[MemoryEdit] Failed to back up ${source}:`, error);
      }
    }
  }
  await writeJsonFileAtomic(path.join(backupDir, 'metadata.json'), {
    backupId,
    userId,
    edit,
    createdAt: new Date().toISOString(),
  });
  return backupId;
}

async function removeSyncedFileForMemoryKey(userId: string, key: string): Promise<void> {
  const fileName = key === 'experiment_summary_structured' || key === 'experiment_summary'
    ? '试验资料总结.txt'
    : key === 'data_summary_structured' || key === 'data_summary'
      ? '数据详细总结.txt'
      : '';
  if (!fileName) return;
  await fsp.rm(path.join(memoryDir, userId, fileName), { force: true }).catch(() => undefined);
}

export async function applyPendingMemoryEdit(userId: string): Promise<MemoryEditApplyResult> {
  const pending = await getPendingMemoryEdit(userId);
  if (!pending) {
    return { applied: false, message: '没有待确认的长期记忆修改。' };
  }

  return withMemoryLock(userId, async () => {
    const currentPending = await getPendingMemoryEdit(userId);
    if (!currentPending || currentPending.id !== pending.id) {
      return { applied: false, message: '待确认的长期记忆修改已变化或过期，请重新发起修改。' };
    }

    const memory = await loadUserMemory(userId);
    const backupId = await createMemoryEditBackup(userId, currentPending);
    const existingIndex = memory.entries.findIndex(entry => entry.key === currentPending.targetKey);
    if (currentPending.afterValue.trim()) {
      const entry: MemoryEntry = {
        key: currentPending.targetKey,
        value: currentPending.afterValue.trim(),
        source: 'user-memory-edit',
        timestamp: new Date().toISOString(),
      };
      if (existingIndex >= 0) {
        memory.entries[existingIndex] = entry;
      } else {
        memory.entries.push(entry);
      }
    } else if (existingIndex >= 0) {
      memory.entries.splice(existingIndex, 1);
      await removeSyncedFileForMemoryKey(userId, currentPending.targetKey);
    }

    await saveUserMemory(memory);
    await saveMemoryToFiles(userId, memory);
    await clearPendingMemoryEdit(userId);
    return {
      applied: true,
      backupId,
      targetKey: currentPending.targetKey,
      targetLabel: currentPending.targetLabel,
      message: `已写入长期记忆：${currentPending.targetLabel}。已创建备份：${backupId}`,
    };
  });
}

export async function cancelPendingMemoryEdit(userId: string): Promise<MemoryEditApplyResult> {
  const pending = await getPendingMemoryEdit(userId);
  await clearPendingMemoryEdit(userId);
  return {
    applied: false,
    cancelled: true,
    targetKey: pending?.targetKey,
    targetLabel: pending?.targetLabel,
    message: pending ? `已取消长期记忆修改：${pending.targetLabel}` : '没有待取消的长期记忆修改。',
  };
}

export async function rollbackMemoryEdit(userId: string, backupId?: string): Promise<{ success: boolean; message: string; backupId?: string }> {
  const backupRoot = getMemoryEditBackupDir(userId);
  let selectedBackupId = backupId;
  if (!selectedBackupId) {
    try {
      const backups = (await fsp.readdir(backupRoot, { withFileTypes: true }))
        .filter(item => item.isDirectory())
        .map(item => item.name)
        .sort()
        .reverse();
      selectedBackupId = backups[0];
    } catch (error) {
      return { success: false, message: '没有可回滚的长期记忆备份。' };
    }
  }
  if (!selectedBackupId) {
    return { success: false, message: '没有可回滚的长期记忆备份。' };
  }

  const backupDir = path.join(backupRoot, selectedBackupId);
  const userMemoryDir = path.join(memoryDir, userId);
  const memoryBackup = path.join(backupDir, 'memory.json');
  if (!fs.existsSync(memoryBackup)) {
    return { success: false, backupId: selectedBackupId, message: '备份缺少 memory.json，无法回滚。' };
  }

  await fsp.mkdir(userMemoryDir, { recursive: true });
  for (const fileName of ['memory.json', '试验资料总结.txt', '数据详细总结.txt']) {
    const source = path.join(backupDir, fileName);
    const target = path.join(userMemoryDir, fileName);
    if (fs.existsSync(source)) {
      await fsp.copyFile(source, target);
    }
  }
  await clearPendingMemoryEdit(userId);
  return { success: true, backupId: selectedBackupId, message: `已回滚长期记忆到备份：${selectedBackupId}` };
}

/**
 * 检查某个 memory 键是否已被用户删除（不应自动恢复）
 * @param memory 用户记忆对象
 * @param key 要检查的键名
 * @returns true 表示已被删除，不应自动写入
 */
/**
 * 旧版本会用 deletedKeys 阻止 AI 自动写入。
 * 当前产品逻辑要求长期记忆始终允许 AI 更新，因此这里始终返回 false。
 */
export function isKeyDeleted(memory: UserMemory, key: string): boolean {
  void memory;
  void key;
  return false;
}

/**
 * 清理旧版本遗留的 deletedKeys 标记。
 * 现在删除记忆只代表清空当前内容，不再禁止 AI 后续自动提取和保存。
 * 
 * @returns true 表示移除了遗留标记
 */
export function autoRestoreDeletedKeyIfEmpty(memory: UserMemory, key: string): boolean {
  if (!memory.deletedKeys?.includes(key)) {
    return false;
  }

  removeFromDeletedKeys(memory, key);
  logger.info(`[Memory] Removed legacy deletedKeys marker for "${key}" (AI updates are allowed)`);
  return true;
}

/**
 * 从已删除列表中移除某个键（当用户明确设置新值时）
 * @param memory 用户记忆对象
 * @param key 要移除的键名
 */
export function removeFromDeletedKeys(memory: UserMemory, key: string): void {
  if (memory.deletedKeys) {
    const index = memory.deletedKeys.indexOf(key);
    if (index >= 0) {
      memory.deletedKeys.splice(index, 1);
      logger.info(`[Memory] Removed "${key}" from deletedKeys (user set new value)`);
    }
  }
}

/**
 * 加载用户记忆（异步 + Zod 验证）
 * 
 * Bug fix: 添加 web-user fallback 机制
 * 当指定 userId 无数据时，自动检查 web-user 的数据（兼容匿名用户数据迁移）
 */
export async function loadUserMemory(userId: string): Promise<UserMemory> {
  const userMemoryDir = path.join(memoryDir, userId);
  await fsp.mkdir(userMemoryDir, { recursive: true });
  
  const memoryFile = path.join(userMemoryDir, 'memory.json');
  
  try {
    const content = await fsp.readFile(memoryFile, 'utf-8');
    if (!content.trim()) {
      const recovered = await recoverMemoryFromSyncedFiles(userId);
      if (recovered) {
        await saveUserMemory(recovered);
        return recovered;
      }
      throw new Error('memory.json is empty');
    }
    const parsed = JSON.parse(content);
    const validated = UserMemorySchema.parse(parsed);
    return {
      userId: validated.userId || userId,
      entries: validated.entries,
      conversations: validated.conversations,
      updatedAt: validated.updatedAt,
      deletedKeys: validated.deletedKeys || [],
    };
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') {
      // 文件不存在
      const recovered = await recoverMemoryFromSyncedFiles(userId);
      if (recovered) {
        await saveUserMemory(recovered);
        return recovered;
      }
      // Bug fix: 如果不是 web-user，尝试 fallback 到 web-user 的数据
      if (userId !== 'web-user') {
        try {
          const webUserFile = path.join(memoryDir, 'web-user', 'memory.json');
          const webContent = await fsp.readFile(webUserFile, 'utf-8');
          const webParsed = JSON.parse(webContent);
          const webValidated = UserMemorySchema.parse(webParsed);
          logger.info(`[Memory] Fallback: loaded web-user data for ${userId} (${webValidated.entries.length} entries)`);
          return {
            userId,  // 保持传入的 userId，确保后续 save 保存到正确的位置
            entries: webValidated.entries,
            conversations: webValidated.conversations,
            updatedAt: webValidated.updatedAt,
            deletedKeys: webValidated.deletedKeys || [],
          };
        } catch (webError) {
          // web-user 也不存在，返回空记忆
          if (isNodeError(webError) && webError.code === 'ENOENT') {
            // 正常情况，继续返回空记忆
          } else {
            logger.warn(`[Memory] Failed to load web-user fallback for ${userId}:`, webError);
          }
        }
      }
      
      // 返回空记忆
      return {
        userId,
        entries: [],
        conversations: [],
        updatedAt: new Date().toISOString(),
        deletedKeys: [],
      };
    }
    logger.warn(`[Memory] Failed to load memory for ${userId}:`, e);
    const recovered = await recoverMemoryFromSyncedFiles(userId);
    if (recovered) {
      await saveUserMemory(recovered);
      return recovered;
    }
  }
  
  return {
    userId,
    entries: [],
    conversations: [],
    updatedAt: new Date().toISOString(),
    deletedKeys: [],
  };
}

/**
 * 保存用户记忆（异步）
 */
export async function saveUserMemory(memory: UserMemory): Promise<void> {
  const userMemoryDir = path.join(memoryDir, memory.userId);
  await fsp.mkdir(userMemoryDir, { recursive: true });
  
  const memoryFile = path.join(userMemoryDir, 'memory.json');
  const removedRawKeys = foldRawSummariesIntoStructured(memory);
  if (removedRawKeys.length > 0) {
    logger.info(`[Memory] Removed raw summary keys covered by structured memory: ${removedRawKeys.join(', ')}`);
  }
  memory.updatedAt = new Date().toISOString();
  
  try {
    await writeJsonFileAtomic(memoryFile, memory);
    logger.info(`[Memory] Saved memory for user: ${memory.userId}`);
  } catch (e) {
    logger.error(`[Memory] Failed to save memory for ${memory.userId}:`, e);
    throw e;
  }
}

/**
 * 将记忆内容写入到具体文件（增量追加）
 */
/**
 * Bug #3 修复：统一的重复检测函数（三层策略）
 * 使用三层检测策略：完整匹配 → 关键句子匹配 → 多片段匹配
 * 避免误判（开头相似但内容不同）和漏检（只匹配少量片段）
 * @param existingContent 现有内容
 * @param newContent 新内容
 * @returns true 表示内容已存在（跳过），false 表示内容不存在（需要写入）
 */
export function isDuplicateContent(existingContent: string, newContent: string): boolean {
  if (!existingContent || existingContent.length === 0) return false;
  if (!newContent || newContent.length === 0) return true;
  
  // 策略1：完整内容匹配（最高优先级，最精确）
  if (existingContent.includes(newContent)) {
    logger.info('[Memory] Duplicate check: full content match (100%)');
    return true;
  }
  
  // 策略2：关键句子检查（提取包含数值、年份等关键信息的句子）
  const keySentencePatterns = [
    /[\d]+\.?\d*\s*(kg|ha|mm|℃|°C|g|mg|%|N|P|K|ppm)/gi,  // 数值+单位
    /(20\d{2})年?/g,                                       // 年份
    /[\u4e00-\u9fa5]+[:：][\s]*[\d]+\.?\d*/g,              // 中文标签+数值
    /(处理|组|小区|重复|样本)[^\n。]*[\d]+/g,                // 实验设置描述
  ];
  
  const keySentences: string[] = [];
  const newLines = newContent.split(/[。\n;；]/);
  
  for (const line of newLines) {
    const trimmedLine = line.trim();
    if (trimmedLine.length < 15) continue;
    
    for (const pattern of keySentencePatterns) {
      if (pattern.test(trimmedLine)) {
        keySentences.push(trimmedLine);
        break;
      }
    }
  }
  
  if (keySentences.length >= 3) {
    const matchedSentences = keySentences.filter(s => existingContent.includes(s));
    const matchRatio = matchedSentences.length / keySentences.length;
    
    if (matchRatio >= 0.8) {
      logger.info(`[Memory] Duplicate check: key sentences matched ${matchedSentences.length}/${keySentences.length} (${Math.round(matchRatio * 100)}%)`);
      return true;
    }
  }
  
  // 策略3：多片段细粒度检查
  const contentLen = newContent.length;
  const fragmentCount = 5;
  const fragmentLength = Math.min(120, Math.floor(contentLen / fragmentCount));
  
  if (fragmentLength < 20) return false;
  
  const fragments: string[] = [];
  for (let i = 0; i < fragmentCount; i++) {
    const start = Math.floor(i * contentLen / fragmentCount);
    const fragment = newContent.substring(start, start + fragmentLength).trim();
    if (fragment.length > 20) fragments.push(fragment);
  }
  
  const matchedFragments = fragments.filter(f => existingContent.includes(f));
  
  if (fragments.length > 0 && matchedFragments.length / fragments.length >= 0.6) {
    logger.info(`[Memory] Duplicate check: fragments matched ${matchedFragments.length}/${fragments.length} (${Math.round(matchedFragments.length / fragments.length * 100)}%)`);
    return true;
  }
  
  logger.info('[Memory] Duplicate check: no significant overlap detected, content is new');
  return false;
}

/**
 * Bug fix: 判断两个状态值是否相似（用于保护关键字段不被意外替换）
 * 
 * 用于 target_journal、paper_topic 等关键字段的保护机制：
 * - 如果新值与旧值相似（大小写差异、缩写、同义表达），则不更新
 * - 只有实质性改变才允许更新
 * 
 * @param existingValue 已存在的值（已转为小写）
 * @param newValue 新值（已转为小写）
 * @returns true 表示相似（应跳过更新），false 表示不同（应更新）
 */
export function isSimilarValue(existingValue: string, newValue: string): boolean {
  if (!existingValue || !newValue) return false;
  
  // 完全相同（忽略大小写已在调用前处理）
  if (existingValue === newValue) return true;
  
  // 去除空格后比较
  const existingTrimmed = existingValue.replace(/\s+/g, ' ').trim();
  const newTrimmed = newValue.replace(/\s+/g, ' ').trim();
  if (existingTrimmed === newTrimmed) return true;
  
  // ========== 期刊名称相似性判断 ==========
  // 常见期刊缩写/别名映射
  const journalAliases: Record<string, string[]> = {
    'nature': ['nat', 'nature journal', 'nature杂志'],
    'science': ['sci', 'science journal', 'science杂志'],
    'cell': ['cell journal', 'cell杂志'],
    'nature communications': ['nat commun', 'nature comm', 'nature communications'],
    'nature biology': ['nat biol', 'nature bio'],
    'global change biology': ['gcb', 'global change bio', 'glob change biol'],
    'journal of environmental management': ['jem', 'j environ manage', 'j. environ. manage'],
    'agricultural ecosystem': ['agri eco', 'agric ecosystem'],
    'environmental science': ['env sci', 'environ sci', 'env science'],
    'agriculture ecosystems & environment': ['aee', 'agee'],
  };
  
  // 检查是否是同一期刊的不同表达
  for (const [canonical, aliases] of Object.entries(journalAliases)) {
    const allVariants = [canonical, ...aliases];
    const existingIsVariant = allVariants.some(v => existingValue.includes(v.toLowerCase()));
    const newIsVariant = allVariants.some(v => newValue.includes(v.toLowerCase()));
    
    if (existingIsVariant && newIsVariant) {
      // 两者都是同一期刊的不同表达
      logger.info(`[Memory] Similar value detected: both refer to "${canonical}"`);
      return true;
    }
  }
  
  // ========== 主题相似性判断 ==========
  // 简单的关键词重叠检查
  const existingKeywords = existingValue.split(/[\s,，、]+/).filter(w => w.length > 2);
  const newKeywords = newValue.split(/[\s,，、]+/).filter(w => w.length > 2);
  
  if (existingKeywords.length > 0 && newKeywords.length > 0) {
    const overlap = existingKeywords.filter(k => newKeywords.includes(k));
    const overlapRatio = overlap.length / Math.max(existingKeywords.length, newKeywords.length);
    
    // 如果关键词重叠超过70%，认为是相似主题
    if (overlapRatio >= 0.7) {
      logger.info(`[Memory] Similar value detected: keyword overlap ${Math.round(overlapRatio * 100)}%`);
      return true;
    }
  }
  
  // ========== 长度相似性判断 ==========
  // 如果新值只是旧值的部分（例如从 "Nature Communications" 变成 "Nature"）
  // 或旧值是新值的部分（例如从 "Nature" 变成 "Nature Communications"）
  // 这是实质性改变，不应被视为相似
  
  // 短值包含在长值中（可能是缩写 → 全名，或全名 → 缩写）
  // 这种情况我们认为是不同的（用户可能确实想更改）
  const shorterValue = existingValue.length < newValue.length ? existingValue : newValue;
  const longerValue = existingValue.length < newValue.length ? newValue : existingValue;
  
  // 但如果短值只是长值的开头几个单词（可能是用户简化表达）
  // 且长度差异小于50%，则认为是相似
  if (longerValue.startsWith(shorterValue) && 
      Math.abs(existingValue.length - newValue.length) < shorterValue.length * 0.5) {
    logger.info(`[Memory] Similar value detected: one is prefix of another`);
    return true;
  }
  
  // 默认：认为是不同的值
  logger.info(`[Memory] Values are different: "${existingValue}" vs "${newValue}"`);
  return false;
}

/**
 * 将记忆内容写入到具体文件（试验资料总结.txt、数据详细总结.txt）
 * 以 memory.json 中的当前内容为准，直接覆盖写入，确保与 UI 显示一致
 * 
 * 优先级：_structured 版本 > 原始版本
 */
export async function saveMemoryToFiles(userId: string, memory: UserMemory): Promise<void> {
  const userMemoryDir = path.join(memoryDir, userId);
  await fsp.mkdir(userMemoryDir, { recursive: true });

  // 1. 试验资料总结.txt - 优先使用 _structured 版本
  const experimentStructured = memory.entries.find(e => e.key === 'experiment_summary_structured');
  const experimentRaw = memory.entries.find(e => e.key === 'experiment_summary');

  const experimentSummary = (experimentStructured && experimentStructured.value && experimentStructured.value.length > 100)
    ? experimentStructured
    : experimentRaw;

  if (experimentSummary && experimentSummary.value && experimentSummary.value.length > 10) {
    const summaryFile = path.join(userMemoryDir, '试验资料总结.txt');

    // 以 memory.json 中的当前内容为准，直接覆盖写入
    const finalContent = '【试验资料总结】\n\n更新时间: ' + experimentSummary.timestamp + '\n来源: ' + experimentSummary.key + '\n\n' + experimentSummary.value;

    await writeTextFileAtomic(summaryFile, finalContent);
    logger.info(`[Memory] Synced 试验资料总结.txt for ${userId} (${experimentSummary.value.length} chars, source: ${experimentSummary.key})`);
  }

  // 2. 数据详细总结.txt - 优先使用 _structured 版本
  const dataStructured = memory.entries.find(e => e.key === 'data_summary_structured');
  const dataRaw = memory.entries.find(e => e.key === 'data_summary');

  const dataSummary = (dataStructured && dataStructured.value && dataStructured.value.length > 100)
    ? dataStructured
    : dataRaw;

  if (dataSummary && dataSummary.value && dataSummary.value.length > 10) {
    const dataFile = path.join(userMemoryDir, '数据详细总结.txt');

    // 以 memory.json 中的当前内容为准，直接覆盖写入
    const finalContent = '【数据详细总结】\n\n更新时间: ' + dataSummary.timestamp + '\n来源: ' + dataSummary.key + '\n\n' + dataSummary.value;

    await writeTextFileAtomic(dataFile, finalContent);
    logger.info(`[Memory] Synced 数据详细总结.txt for ${userId} (${dataSummary.value.length} chars, source: ${dataSummary.key})`);
  }
}

/**
 * GET /api/memory/detail/:userId
 * 获取用户记忆详细内容（用于选择性清空）
 * 注意：此路由必须在 /:userId 之前定义，否则会被 /:userId 匹配
 * 
 * Bug fix: 用户登录云端账号后，userId 可能与本地数据目录不匹配
 * 解决方案：对于 storageDimensions，同时检查当前 userId 和 web-user 目录
 */
router.get('/detail/:userId', async (req: Request, res: Response) => {
  try {
    // Bug 修复：优先从 session 获取 userId，URL 参数作为备用
    const sessionUserId = await getUserIdFromSession();
    const userId = sessionUserId || req.params.userId || 'web-user';
    
    logger.info(`[Memory] Detail request for user: ${userId} (session: ${sessionUserId ? 'yes' : 'no'})`);
    
    // ========== Bug fix: 同时加载当前用户和 web-user 的记忆数据 ==========
    // 如果云端用户目录没有数据，fallback 使用 web-user 的数据
    let memory = await loadUserMemory(userId);
    
    // 检查云端用户是否有数据
    const hasCloudMemory = memory.entries.length > 0 || memory.conversations.length > 0;
    
    // 如果云端用户没有数据，尝试加载 web-user 的数据（数据迁移前的遗留）
    if (!hasCloudMemory && userId !== 'web-user') {
      logger.info(`[Memory] Cloud user ${userId} has no data, checking web-user fallback`);
      const webUserMemory = await loadUserMemory('web-user');
      if (webUserMemory.entries.length > 0 || webUserMemory.conversations.length > 0) {
        // 使用 web-user 的数据
        memory = webUserMemory;
        logger.info(`[Memory] Using web-user memory data (${memory.entries.length} entries)`);
      }
    }
    
    // 解析记忆条目，按完整维度目录分类展示。memoryEntries 保持向后兼容，仅包含已有内容；
    // memoryDimensions 包含所有已知长期记忆维度，空维度也会返回给前端展示。
    const memoryDetails: {
      key: string;
      label: string;
      description: string;
      category: string;
      categoryLabel: string;
      value: string;
      source: string;
      wordCount: number;
      timestamp: string;
    }[] = [];

    const displayEntries = getStructuredPreferredMemoryEntries(memory.entries);
    const entryByKey = new Map<string, MemoryEntry>();
    for (const entry of displayEntries) {
      entryByKey.set(entry.key, entry);
    }
    const knownDimensionKeys = new Set(MEMORY_DIMENSION_DEFINITIONS.map(def => def.key));
    const memoryDimensions = MEMORY_DIMENSION_DEFINITIONS.map(def => {
      const entry = entryByKey.get(def.key);
      const value = entry?.value || '';
      return {
        ...def,
        exists: !!entry,
        value,
        source: entry?.source || '',
        wordCount: value.length,
        timestamp: entry?.timestamp || '',
      };
    });

    for (const entry of displayEntries) {
      if (knownDimensionKeys.has(entry.key)) {
        continue;
      }
      const def = getMemoryDimensionDefinition(entry.key);
      memoryDimensions.push({
        ...def,
        exists: true,
        // 直接返回 memory.json 中的真实完整值，前端负责展示和滚动。
        value: entry.value,
        source: entry.source,
        wordCount: entry.value.length,
        timestamp: entry.timestamp,
      });
    }

    for (const dimension of memoryDimensions) {
      if (!dimension.exists) {
        continue;
      }
      memoryDetails.push({
        key: dimension.key,
        label: dimension.label,
        description: dimension.description,
        category: dimension.category,
        categoryLabel: dimension.categoryLabel,
        value: dimension.value,
        source: dimension.source,
        wordCount: dimension.wordCount,
        timestamp: dimension.timestamp,
      });
    }
    
    // 检查其他存储维度
    // ========== Bug fix: 同时检查云端用户目录和 web-user 目录 ==========
    // 用户登录云端账号后，数据可能仍在 web-user 目录（迁移前的遗留）
    // 需要检查两个位置，合并结果
    
    const storageDimensions: {
      id: string;
      label: string;
      description: string;
      exists: boolean;
      size?: number;
      itemCount?: number;
      path: string;
      sourceUserId?: string;  // 新增：标记数据来源的用户 ID
    }[] = [];
    
    /**
     * 辅助函数：检查路径是否存在，如果不存在则检查 web-user 的对应路径
     * @param primaryPath 主要检查路径
     * @param webUserPath web-user 的 fallback 路径
     * @returns 找到的路径和来源信息
     */
    const checkPathWithFallback = (primaryPath: string, webUserPath: string): { 
      foundPath: string | null; 
      exists: boolean;
      sourceUserId: string;
    } => {
      if (fs.existsSync(primaryPath)) {
        return { foundPath: primaryPath, exists: true, sourceUserId: userId };
      }
      // 如果云端用户目录不存在，检查 web-user 目录
      if (userId !== 'web-user' && fs.existsSync(webUserPath)) {
        logger.info(`[Memory] Using web-user data for path check: ${webUserPath}`);
        return { foundPath: webUserPath, exists: true, sourceUserId: 'web-user' };
      }
      return { foundPath: primaryPath, exists: false, sourceUserId: userId };
    };
    
    // 1. 会话状态
    const sessionFile = path.join(dataDir, 'sessions', `${userId}.json`);
    const webUserSessionFile = path.join(dataDir, 'sessions', 'web-user.json');
    const sessionCheck = checkPathWithFallback(sessionFile, webUserSessionFile);
    
    if (sessionCheck.exists) {
      const stats = fs.statSync(sessionCheck.foundPath!);
      storageDimensions.push({
        id: 'session',
        label: '会话状态',
        description: '当前对话状态、章节规划等',
        exists: true,
        size: stats.size,
        path: sessionCheck.foundPath!,
        sourceUserId: sessionCheck.sourceUserId
      });
    } else {
      storageDimensions.push({
        id: 'session',
        label: '会话状态',
        description: '当前对话状态、章节规划等',
        exists: false,
        path: sessionFile
      });
    }
    
    // 2. 论文草稿
    const draftsDir = path.join(dataDir, 'sessions', userId, 'drafts');
    const draftsCheck = {
      foundPath: draftsDir,
      exists: fs.existsSync(draftsDir),
      sourceUserId: userId,
    };
    
    if (draftsCheck.exists) {
      const directoryFiles = fs.readdirSync(draftsCheck.foundPath!);
      const txtFiles = directoryFiles.filter(file => file.toLowerCase().endsWith('.txt'));
      const files = txtFiles.length > 0
        ? txtFiles
        : directoryFiles.filter(file => file.toLowerCase().endsWith('.json'));
      let totalSize = 0;
      for (const file of files) {
        const filePath = path.join(draftsCheck.foundPath!, file);
        try {
          totalSize += fs.statSync(filePath).size;
        } catch {}
      }
      storageDimensions.push({
        id: 'drafts',
        label: '论文草稿',
        description: `共 ${files.length} 个章节草稿`,
        exists: true,
        size: totalSize,
        itemCount: files.length,
        path: draftsCheck.foundPath!,
        sourceUserId: draftsCheck.sourceUserId
      });
    } else {
      storageDimensions.push({
        id: 'drafts',
        label: '论文草稿',
        description: '暂无草稿',
        exists: false,
        path: draftsDir
      });
    }
    
    // 3. 文献数据库 - 这是用户反馈的核心问题
    const literatureFile = path.join(uploadDir, userId, 'literature.json');
    const webUserLiteratureFile = path.join(uploadDir, 'web-user', 'literature.json');
    const litCheck = checkPathWithFallback(literatureFile, webUserLiteratureFile);
    
    if (litCheck.exists) {
      try {
        const litData = JSON.parse(fs.readFileSync(litCheck.foundPath!, 'utf-8'));
        const litCount = Array.isArray(litData) ? litData.length : (litData.literature?.length || 0);
        const stats = fs.statSync(litCheck.foundPath!);
        storageDimensions.push({
          id: 'literature',
          label: '文献数据库',
          description: `共 ${litCount} 篇文献`,
          exists: true,
          size: stats.size,
          itemCount: litCount,
          path: litCheck.foundPath!,
          sourceUserId: litCheck.sourceUserId
        });
      } catch {
        storageDimensions.push({
          id: 'literature',
          label: '文献数据库',
          description: '文献数据',
          exists: true,
          path: litCheck.foundPath!,
          sourceUserId: litCheck.sourceUserId
        });
      }
    } else {
      storageDimensions.push({
        id: 'literature',
        label: '文献数据库',
        description: '暂无文献',
        exists: false,
        path: literatureFile
      });
    }
    
    // 4. 索引缓存
    const indexCacheDir = path.join(uploadDir, userId, 'index-cache');
    const webUserIndexCacheDir = path.join(uploadDir, 'web-user', 'index-cache');
    const indexCacheCheck = checkPathWithFallback(indexCacheDir, webUserIndexCacheDir);
    
    if (indexCacheCheck.exists) {
      const files = fs.readdirSync(indexCacheCheck.foundPath!, { recursive: true }) as string[];
      let totalSize = 0;
      for (const file of files) {
        const filePath = path.join(indexCacheCheck.foundPath!, file);
        try {
          if (fs.statSync(filePath).isFile()) {
            totalSize += fs.statSync(filePath).size;
          }
        } catch {}
      }
      storageDimensions.push({
        id: 'indexCache',
        label: '索引缓存',
        description: '文献检索索引（BM25、向量索引）',
        exists: true,
        size: totalSize,
        itemCount: files.length,
        path: indexCacheCheck.foundPath!,
        sourceUserId: indexCacheCheck.sourceUserId
      });
    } else {
      storageDimensions.push({
        id: 'indexCache',
        label: '索引缓存',
        description: '文献检索索引',
        exists: false,
        path: indexCacheDir
      });
    }
    
    // 5. 期刊风格文件
    const journalStylesDir = path.join(uploadDir, userId, 'journal-styles');
    const webUserJournalStylesDir = path.join(uploadDir, 'web-user', 'journal-styles');
    const journalStylesCheck = checkPathWithFallback(journalStylesDir, webUserJournalStylesDir);
    
    if (journalStylesCheck.exists) {
      const journals = fs.readdirSync(journalStylesCheck.foundPath!).filter(name => {
        const journalPath = path.join(journalStylesCheck.foundPath!, name);
        return fs.statSync(journalPath).isDirectory() && fs.existsSync(path.join(journalPath, 'style.json'));
      });
      let totalSize = 0;
      for (const journal of journals) {
        const styleFile = path.join(journalStylesCheck.foundPath!, journal, 'style.json');
        try {
          totalSize += fs.statSync(styleFile).size;
        } catch {}
      }
      storageDimensions.push({
        id: 'journalStyles',
        label: '期刊风格文件',
        description: `共 ${journals.length} 个期刊风格`,
        exists: journals.length > 0,
        size: totalSize,
        itemCount: journals.length,
        path: journalStylesCheck.foundPath!,
        sourceUserId: journalStylesCheck.sourceUserId
      });
    } else {
      storageDimensions.push({
        id: 'journalStyles',
        label: '期刊风格文件',
        description: '期刊写作风格模板',
        exists: false,
        path: journalStylesDir
      });
    }
    
    res.json({
      success: true,
      userId,
      // ========== Bug fix: 添加清晰说明，区分记忆内容和存储维度 ==========
      // 记忆内容：用户真正关心的 AI 提取的信息（实验总结、数据总结等）
      memoryEntries: memoryDetails,
      memoryDimensions,
      memoryCategories: MEMORY_CATEGORY_DEFINITIONS,
      memoryUpdatedAt: memory.updatedAt,
      memorySourceFile: path.join(memoryDir, memory.userId || userId, 'memory.json'),
      
      // 存储维度：辅助数据文件/目录（文件存储、索引缓存等）
      // 注意：这些只是"物理文件/目录"的存在状态，不代表记忆内容是否丢失
      // 即使这些显示"不存在"，您的记忆内容（memoryEntries）可能仍然完好
      storageDimensions,
      
      // 当前不再启用“删除后保护”机制：删除只清空当前内容，AI 后续仍可自动更新。
      deletedKeys: [],
      
      // 添加说明字段，帮助前端理解两类数据的区别
      _meta: {
        memoryEntriesNote: '这是您的核心记忆内容，由 AI 从对话中自动提取。包括实验总结、数据总结、目标期刊等。',
        storageDimensionsNote: '这些是辅助存储文件/目录的状态。如果显示"不存在"，只是表示相关文件尚未创建，不代表记忆内容丢失。',
        hasMemoryContent: memoryDetails.length > 0,
        totalMemoryEntries: memoryDetails.length,
        totalMemoryDimensions: memoryDimensions.length,
        totalStorageDimensions: storageDimensions.length
      }
    });
    
  } catch (error) {
    logger.error('[Memory] Detail error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * GET /api/memory/storage-info/:userId
 * 获取用户长期记忆存储信息（用于显示占用空间等）
 */
router.get('/storage-info/:userId', async (req: Request, res: Response) => {
  try {
    // Bug 修复：优先从 session 获取 userId，URL 参数作为备用
    const sessionUserId = await getUserIdFromSession();
    const userId = sessionUserId || req.params.userId || 'web-user';
    
    logger.info(`[Memory] Storage info for user: ${userId} (session: ${sessionUserId ? 'yes' : 'no'})`);
    const storageInfo: { path: string; exists: boolean; size?: number; itemCount?: number }[] = [];

    // 检查各存储路径
    const pathsToCheck = [
      { name: '记忆数据', path: path.join(memoryDir, userId) },
      { name: '会话状态', path: path.join(dataDir, 'sessions', `${userId}.json`) },
      { name: '草稿目录', path: path.join(dataDir, 'sessions', userId, 'drafts') },
      { name: '文献数据', path: path.join(uploadDir, userId, 'literature.json') },
      { name: '索引缓存', path: path.join(uploadDir, userId, 'index-cache') },
    ];

    for (const item of pathsToCheck) {
      if (fs.existsSync(item.path)) {
        const stats = fs.statSync(item.path);
        if (stats.isDirectory()) {
          const files = fs.readdirSync(item.path, { recursive: true }) as string[];
          let totalSize = 0;
          for (const file of files) {
            const filePath = path.join(item.path, file);
            try {
              if (fs.statSync(filePath).isFile()) {
                totalSize += fs.statSync(filePath).size;
              }
            } catch {}
          }
          storageInfo.push({ 
            path: item.name, 
            exists: true, 
            size: totalSize,
            itemCount: files.length 
          });
        } else {
          storageInfo.push({ 
            path: item.name, 
            exists: true, 
            size: stats.size 
          });
        }
      } else {
        storageInfo.push({ path: item.name, exists: false });
      }
    }

    // 计算总大小
    const totalSize = storageInfo
      .filter(s => s.exists && s.size)
      .reduce((sum, s) => sum + (s.size || 0), 0);

    res.json({
      success: true,
      userId,
      storageInfo,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize)
    });

  } catch (error) {
    logger.error('[Memory] Storage info error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /api/memory/clear-selected/:userId
 * 选择性清空用户记忆
 * 
 * Request body:
 * {
 *   memoryKeys: string[],      // 要删除的记忆键，如 ['experiment_summary', 'data_summary']
 *   storageDimensions: string[] // 要清空的存储维度，如 ['drafts', 'literature', 'indexCache', 'session']
 * }
 */
router.post('/clear-selected/:userId', async (req: Request, res: Response) => {
  try {
    // Bug 修复：优先从 session 获取 userId
    const sessionUserId = await getUserIdFromSession();
    let userId = sessionUserId || req.params.userId || 'web-user';

    logger.info(`[Memory] Clear selected for user: ${userId} (session: ${sessionUserId ? 'yes' : 'no'})`);
    const { memoryKeys = [], storageDimensions = [] } = req.body;

    // Bug fix: 检测数据实际存储位置（与 /detail 接口保持一致）
    // 如果当前用户没有记忆数据，但 web-user 有，说明数据在 web-user 目录（迁移前遗留）
    const currentMemory = await loadUserMemory(userId);
    const hasCurrentMemory = currentMemory.entries.length > 0 || currentMemory.conversations.length > 0;
    if (!hasCurrentMemory && userId !== 'web-user') {
      const webUserMemory = await loadUserMemory('web-user');
      if (webUserMemory.entries.length > 0 || webUserMemory.conversations.length > 0) {
        userId = 'web-user';
        logger.info(`[Memory] Fallback to web-user for clear-selected, effectiveUserId: ${userId}`);
      }
    }

    // P0 修复：使用锁机制避免并发竞争（删除操作也需串行）
    const result = await withMemoryLock(userId, async () => {
    
    // ========== 诊断日志：记录收到的请求参数 ==========
    logger.info(`[Memory] Received memoryKeys: ${JSON.stringify(memoryKeys)} (count: ${memoryKeys.length})`);
    logger.info(`[Memory] Received storageDimensions: ${JSON.stringify(storageDimensions)} (count: ${storageDimensions.length})`);
    
    const results: { 
      type: 'memory' | 'storage';
      key?: string;
      dimension?: string;
      status: 'deleted' | 'not_found' | 'error';
      error?: string;
    }[] = [];
    
    // 1. 删除选中的记忆键
    if (memoryKeys.length > 0) {
      const memory = await loadUserMemory(userId);
      const originalCount = memory.entries.length;
      
      // 诊断日志：记录当前 memory 中的所有 key
      const existingKeys = memory.entries.map(e => e.key);
      logger.info(`[Memory] Current memory keys: ${JSON.stringify(existingKeys)} (total: ${originalCount})`);
      
      // Bug fix: paper_topic 和 research_topic 混用问题
      // 当用户删除其中一个时，另一个也应被视为删除目标
      const topicAliasKeys = ['paper_topic', 'research_topic'];
      const isDeletingTopic = memoryKeys.some((k: string) => topicAliasKeys.includes(k));
      let effectiveDeleteKeys = isDeletingTopic
        ? [...new Set([...memoryKeys, ...topicAliasKeys])]
        : memoryKeys;

      // 删除实验/数据总结时，同时删除对应结构化版本；但不再加入保护名单。
      const structuredDeleteLinkage: Record<string, string> = {
        'experiment_summary': 'experiment_summary_structured',
        'data_summary': 'data_summary_structured',
      };
      for (const [baseKey, structuredKey] of Object.entries(structuredDeleteLinkage)) {
        if (effectiveDeleteKeys.includes(baseKey) && !effectiveDeleteKeys.includes(structuredKey)) {
          effectiveDeleteKeys.push(structuredKey);
        }
      }
      effectiveDeleteKeys = [...new Set(effectiveDeleteKeys)];
      logger.info(`[Memory] Effective delete keys: ${JSON.stringify(effectiveDeleteKeys)}`);

      // 过滤掉要删除的键
      const filteredEntries = memory.entries.filter(entry => !effectiveDeleteKeys.includes(entry.key));
      const wouldDeleteCount = originalCount - filteredEntries.length;
      logger.info(`[Memory] Would delete ${wouldDeleteCount} entries after filter`);

      memory.entries = filteredEntries;
      if (memory.deletedKeys?.length) {
        logger.info(`[Memory] Clearing ${memory.deletedKeys.length} legacy deletedKeys marker(s); AI memory updates remain enabled`);
        memory.deletedKeys = [];
      }
      
      if (memory.entries.length < originalCount) {
        await saveUserMemory(memory);
        const deletedCount = originalCount - memory.entries.length;
        memoryKeys.forEach((key: string) => {
          results.push({ type: 'memory', key, status: 'deleted' });
        });
        logger.info(`[Memory] Deleted ${deletedCount} memory keys for user: ${userId}`);
        
        // ========== Bug fix: 同时清理 session.json 中对应的字段 ==========
        // 当用户删除 memory 中的特定字段时，session.json 中的对应字段也应该被清理
        // 否则下次发送消息时，conversation-flow.ts 会把旧值写回 memory
        // P0 修复：补全 SESSION_FIELD_MAPPING，覆盖所有可能被 conversation-flow / chat-bridge 回写的字段
        const SESSION_FIELD_MAPPING: Record<string, string> = {
          'paper_topic': 'paperTopic',
          'target_journal': 'targetJournal',
          'research_topic': 'paperTopic',  // research_topic 和 paper_topic 对应同一个 session 字段
          'writing_progress': 'writingProgress',
          'data_summary': 'dataSummary',
          'experiment_summary': 'researchContent',  // 实验资料总结对应研究内容字段
          'completed_chapters': 'completedChapters', // 前端/bridge 中可能存在的对应字段
          'pending_chapters': 'pendingChapters',     // 前端/bridge 中可能存在的对应字段
        };
        
        const keysToCleanFromSession = memoryKeys.filter((key: string) => SESSION_FIELD_MAPPING[key]);
        if (keysToCleanFromSession.length > 0) {
          const sessionFile = path.join(dataDir, 'sessions', `${userId}.json`);
          try {
            if (fs.existsSync(sessionFile)) {
              const sessionContent = fs.readFileSync(sessionFile, 'utf-8');
              const sessionData = JSON.parse(sessionContent);
              
              for (const memoryKey of keysToCleanFromSession) {
                const sessionField = SESSION_FIELD_MAPPING[memoryKey];
                if (sessionField && sessionData[sessionField]) {
                  delete sessionData[sessionField];
                  logger.info(`[Memory] Cleaned session field "${sessionField}" for deleted memory key "${memoryKey}"`);
                }
              }
              
              fs.writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2), 'utf-8');
              logger.info(`[Memory] Session file updated for user: ${userId}`);
            }
          } catch (e) {
            logger.warn(`[Memory] Failed to clean session fields for user: ${userId}`, e);
            // 不阻塞删除流程，只是记录警告
          }
        }
        
        logger.info('[Memory] Deleted keys are not protected; AI can automatically extract and update them again');

        // P1 修复：同步清理对应的 .txt 辅助文件，避免磁盘与 memory.json 不一致
        const userMemoryDir = path.join(memoryDir, userId);
        const txtFilesToClean: Record<string, string> = {
          'experiment_summary': path.join(userMemoryDir, '试验资料总结.txt'),
          'experiment_summary_structured': path.join(userMemoryDir, '试验资料总结.txt'),
          'data_summary': path.join(userMemoryDir, '数据详细总结.txt'),
          'data_summary_structured': path.join(userMemoryDir, '数据详细总结.txt'),
        };
        for (const key of memoryKeys) {
          const txtPath = txtFilesToClean[key];
          if (txtPath && fs.existsSync(txtPath)) {
            try {
              fs.unlinkSync(txtPath);
              logger.info(`[Memory] Deleted auxiliary txt file for deleted key "${key}": ${txtPath}`);
            } catch (e) {
              logger.warn(`[Memory] Failed to delete auxiliary txt file: ${txtPath}`, e);
            }
          }
        }
      }
    }

    // 2. 清空选中的存储维度
    for (const dimension of storageDimensions) {
      switch (dimension) {
        case 'session': {
          // 清空会话状态
          const sessionFile = path.join(dataDir, 'sessions', `${userId}.json`);
          try {
            if (fs.existsSync(sessionFile)) {
              fs.unlinkSync(sessionFile);
              results.push({ type: 'storage', dimension: 'session', status: 'deleted' });
              logger.info(`[Memory] Deleted session file: ${sessionFile}`);
            } else {
              results.push({ type: 'storage', dimension: 'session', status: 'not_found' });
            }
          } catch (e) {
            results.push({ 
              type: 'storage', 
              dimension: 'session', 
              status: 'error', 
              error: (e as Error).message 
            });
          }
          break;
        }
        
        case 'drafts': {
          // 清空论文草稿
          const draftsDir = path.join(dataDir, 'sessions', userId, 'drafts');
          try {
            if (fs.existsSync(draftsDir)) {
              fs.rmSync(draftsDir, { recursive: true, force: true });
              results.push({ type: 'storage', dimension: 'drafts', status: 'deleted' });
              logger.info(`[Memory] Deleted drafts directory: ${draftsDir}`);
            } else {
              results.push({ type: 'storage', dimension: 'drafts', status: 'not_found' });
            }
          } catch (e) {
            results.push({ 
              type: 'storage', 
              dimension: 'drafts', 
              status: 'error', 
              error: (e as Error).message 
            });
          }
          break;
        }
        
        case 'literature': {
          // 清空文献数据库
          const literatureFile = path.join(uploadDir, userId, 'literature.json');
          try {
            if (fs.existsSync(literatureFile)) {
              fs.unlinkSync(literatureFile);
              results.push({ type: 'storage', dimension: 'literature', status: 'deleted' });
              logger.info(`[Memory] Deleted literature file: ${literatureFile}`);
            } else {
              results.push({ type: 'storage', dimension: 'literature', status: 'not_found' });
            }
          } catch (e) {
            results.push({ 
              type: 'storage', 
              dimension: 'literature', 
              status: 'error', 
              error: (e as Error).message 
            });
          }
          break;
        }
        
        case 'indexCache': {
          // 清空索引缓存
          const indexCacheDir = path.join(uploadDir, userId, 'index-cache');
          try {
            if (fs.existsSync(indexCacheDir)) {
              fs.rmSync(indexCacheDir, { recursive: true, force: true });
              results.push({ type: 'storage', dimension: 'indexCache', status: 'deleted' });
              logger.info(`[Memory] Deleted index cache directory: ${indexCacheDir}`);
            } else {
              results.push({ type: 'storage', dimension: 'indexCache', status: 'not_found' });
            }
          } catch (e) {
            results.push({ 
              type: 'storage', 
              dimension: 'indexCache', 
              status: 'error', 
              error: (e as Error).message 
            });
          }
          break;
        }
        
        case 'journalStyles': {
          // 清空期刊风格文件
          const journalStylesDir = path.join(uploadDir, userId, 'journal-styles');
          try {
            if (fs.existsSync(journalStylesDir)) {
              fs.rmSync(journalStylesDir, { recursive: true, force: true });
              results.push({ type: 'storage', dimension: 'journalStyles', status: 'deleted' });
              logger.info(`[Memory] Deleted journal styles directory: ${journalStylesDir}`);
            } else {
              results.push({ type: 'storage', dimension: 'journalStyles', status: 'not_found' });
            }
          } catch (e) {
            results.push({ 
              type: 'storage', 
              dimension: 'journalStyles', 
              status: 'error', 
              error: (e as Error).message 
            });
          }
          break;
        }
        
        case 'memoryDir': {
          // 清空用户记忆目录（仅 data/memory/{userId}/，不包含 session/drafts 等）
          const userMemoryDir = path.join(memoryDir, userId);
          try {
            if (fs.existsSync(userMemoryDir)) {
              fs.rmSync(userMemoryDir, { recursive: true, force: true });
              results.push({ type: 'storage', dimension: 'memoryDir', status: 'deleted' });
              logger.info(`[Memory] Deleted memory directory: ${userMemoryDir}`);
            } else {
              results.push({ type: 'storage', dimension: 'memoryDir', status: 'not_found' });
            }
          } catch (e) {
            results.push({
              type: 'storage',
              dimension: 'memoryDir',
              status: 'error',
              error: (e as Error).message
            });
          }
          break;
        }
      }
    }
    
    // 统计结果
    const deletedCount = results.filter(r => r.status === 'deleted').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return {
      success: errorCount === 0,
      message: errorCount === 0
        ? `已成功清空 ${deletedCount} 项`
        : `清空完成，${deletedCount} 个成功，${errorCount} 个失败`,
      results,
      summary: {
        memoryKeysDeleted: results.filter(r => r.type === 'memory' && r.status === 'deleted').length,
        storageCleared: results.filter(r => r.type === 'storage' && r.status === 'deleted').length,
        errors: errorCount
      }
    };
    }); // withMemoryLock end

    res.json(result);

  } catch (error) {
    logger.error('[Memory] Clear selected error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /api/memory/restore-keys/:userId
 * 清理旧版本 deletedKeys 标记。
 * 当前 AI 默认允许自动提取和更新长期记忆。
 * 
 * Request body:
 * {
 *   keys: string[]  // 要清理旧标记的键，如 ['experiment_summary', 'data_summary']
 * }
 */
router.post('/restore-keys/:userId', async (req: Request, res: Response) => {
  try {
    const sessionUserId = await getUserIdFromSession();
    let userId = sessionUserId || req.params.userId || 'web-user';
    
    logger.info(`[Memory] Restore keys for user: ${userId} (session: ${sessionUserId ? 'yes' : 'no'})`);
    
    const { keys = [] } = req.body;
    
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供要清理旧标记的键名数组'
      });
    }
    
    // Bug fix: 检测数据实际存储位置
    const currentMemory = await loadUserMemory(userId);
    const hasCurrentMemory = currentMemory.entries.length > 0 || currentMemory.conversations.length > 0;
    if (!hasCurrentMemory && userId !== 'web-user') {
      const webUserMemory = await loadUserMemory('web-user');
      if (webUserMemory.entries.length > 0 || webUserMemory.conversations.length > 0) {
        userId = 'web-user';
        logger.info(`[Memory] Fallback to web-user for restore-keys, effectiveUserId: ${userId}`);
      }
    }
    
    const memory = await loadUserMemory(userId);
    
    if (!memory.deletedKeys || memory.deletedKeys.length === 0) {
      return res.json({
        success: true,
        message: '没有旧版本记忆锁定标记',
        restoredKeys: [],
        remainingProtectedKeys: []
      });
    }
    
    const restoredKeys: string[] = [];
    const remainingProtectedKeys: string[] = [];
    
    // 从 deletedKeys 中移除指定的键
    for (const key of keys) {
      const index = memory.deletedKeys.indexOf(key);
      if (index >= 0) {
        memory.deletedKeys.splice(index, 1);
        restoredKeys.push(key);
        logger.info(`[Memory] Restored key "${key}" for user: ${userId} (removed from deletedKeys)`);
      }
    }
    
    // 同时移除关联的 _structured 版本
    const structuredLinkage: Record<string, string> = {
      'experiment_summary': 'experiment_summary_structured',
      'data_summary': 'data_summary_structured',
    };
    for (const [baseKey, structuredKey] of Object.entries(structuredLinkage)) {
      if (restoredKeys.includes(baseKey)) {
        const structIndex = memory.deletedKeys.indexOf(structuredKey);
        if (structIndex >= 0) {
          memory.deletedKeys.splice(structIndex, 1);
          restoredKeys.push(structuredKey);
          logger.info(`[Memory] Auto-restored linked key "${structuredKey}" for user: ${userId}`);
        }
      }
    }
    
    // 保存更新后的 memory
    if (restoredKeys.length > 0) {
      await saveUserMemory(memory);
    }
    
    remainingProtectedKeys.push(...memory.deletedKeys);
    
    res.json({
      success: true,
      message: `已清理 ${restoredKeys.length} 个旧版本记忆锁定标记`,
      restoredKeys,
      remainingProtectedKeys
    });
    
  } catch (error) {
    logger.error('[Memory] Restore keys error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * DELETE /api/memory/clear/:userId
 * 清空用户所有长期记忆（全量清空）
 * 
 * 清空内容：
 * 1. data/memory/{userId}/ - 用户记忆和对话历史
 * 2. data/sessions/{userId}.json - 用户会话状态
 * 3. data/sessions/{userId}/drafts/ - 论文草稿
 * 4. data/uploads/{userId}/literature.json - 文献数据库
 * 5. data/uploads/{userId}/index-cache/ - 索引缓存
 * 6. data/uploads/{userId}/journal-styles/ - 期刊风格文件
 */
router.delete('/clear/:userId', async (req: Request, res: Response) => {
  try {
    // Bug 修复：优先从 session 获取 userId
    const sessionUserId = await getUserIdFromSession();
    let userId = sessionUserId || req.params.userId || 'web-user';

    logger.info(`[Memory] Clear all for user: ${userId} (session: ${sessionUserId ? 'yes' : 'no'})`);

    // Bug fix: 检测数据实际存储位置（与 /detail 接口保持一致）
    const currentMemory = await loadUserMemory(userId);
    const hasCurrentMemory = currentMemory.entries.length > 0 || currentMemory.conversations.length > 0;
    if (!hasCurrentMemory && userId !== 'web-user') {
      const webUserMemory = await loadUserMemory('web-user');
      if (webUserMemory.entries.length > 0 || webUserMemory.conversations.length > 0) {
        userId = 'web-user';
        logger.info(`[Memory] Fallback to web-user for clear-all, effectiveUserId: ${userId}`);
      }
    }

    // P0 修复：使用锁机制避免并发竞争（全量删除也需串行）
    const result = await withMemoryLock(userId, async () => {
    const results: { path: string; status: 'deleted' | 'not_found' | 'error'; error?: string }[] = [];

    // 1. 清空用户记忆目录 (data/memory/{userId}/)
    const userMemoryDir = path.join(memoryDir, userId);
    try {
      if (fs.existsSync(userMemoryDir)) {
        fs.rmSync(userMemoryDir, { recursive: true, force: true });
        results.push({ path: userMemoryDir, status: 'deleted' });
        logger.info(`[Memory] Deleted memory directory: ${userMemoryDir}`);
      } else {
        results.push({ path: userMemoryDir, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: userMemoryDir, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete memory directory: ${userMemoryDir}`, e);
    }

    // 2. 清空用户会话文件 (data/sessions/{userId}.json)
    const sessionFile = path.join(dataDir, 'sessions', `${userId}.json`);
    try {
      if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        results.push({ path: sessionFile, status: 'deleted' });
        logger.info(`[Memory] Deleted session file: ${sessionFile}`);
      } else {
        results.push({ path: sessionFile, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: sessionFile, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete session file: ${sessionFile}`, e);
    }

    // 3. 清空用户草稿目录 (data/sessions/{userId}/drafts/)
    const draftsDir = path.join(dataDir, 'sessions', userId, 'drafts');
    try {
      if (fs.existsSync(draftsDir)) {
        fs.rmSync(draftsDir, { recursive: true, force: true });
        results.push({ path: draftsDir, status: 'deleted' });
        logger.info(`[Memory] Deleted drafts directory: ${draftsDir}`);
      } else {
        results.push({ path: draftsDir, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: draftsDir, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete drafts directory: ${draftsDir}`, e);
    }

    // 4. 清空用户文献数据库 (data/uploads/{userId}/literature.json)
    const literatureFile = path.join(uploadDir, userId, 'literature.json');
    try {
      if (fs.existsSync(literatureFile)) {
        fs.unlinkSync(literatureFile);
        results.push({ path: literatureFile, status: 'deleted' });
        logger.info(`[Memory] Deleted literature file: ${literatureFile}`);
      } else {
        results.push({ path: literatureFile, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: literatureFile, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete literature file: ${literatureFile}`, e);
    }

    // 5. 清空索引缓存 (data/uploads/{userId}/index-cache/)
    const indexCacheDir = path.join(uploadDir, userId, 'index-cache');
    try {
      if (fs.existsSync(indexCacheDir)) {
        fs.rmSync(indexCacheDir, { recursive: true, force: true });
        results.push({ path: indexCacheDir, status: 'deleted' });
        logger.info(`[Memory] Deleted index cache directory: ${indexCacheDir}`);
      } else {
        results.push({ path: indexCacheDir, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: indexCacheDir, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete index cache: ${indexCacheDir}`, e);
    }

    // 6. 清空期刊风格文件 (data/uploads/{userId}/journal-styles/)
    const journalStylesDir = path.join(uploadDir, userId, 'journal-styles');
    try {
      if (fs.existsSync(journalStylesDir)) {
        fs.rmSync(journalStylesDir, { recursive: true, force: true });
        results.push({ path: journalStylesDir, status: 'deleted' });
        logger.info(`[Memory] Deleted journal styles directory: ${journalStylesDir}`);
      } else {
        results.push({ path: journalStylesDir, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: journalStylesDir, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete journal styles directory: ${journalStylesDir}`, e);
    }

    // 7. 清空用户整个会话子目录 (data/sessions/{userId}/)
    const userSessionDir = path.join(dataDir, 'sessions', userId);
    try {
      if (fs.existsSync(userSessionDir)) {
        fs.rmSync(userSessionDir, { recursive: true, force: true });
        results.push({ path: userSessionDir, status: 'deleted' });
        logger.info(`[Memory] Deleted user session directory: ${userSessionDir}`);
      } else {
        results.push({ path: userSessionDir, status: 'not_found' });
      }
    } catch (e) {
      const errorMsg = (e as Error).message;
      results.push({ path: userSessionDir, status: 'error', error: errorMsg });
      logger.error(`[Memory] Failed to delete user session directory: ${userSessionDir}`, e);
    }

    // 统计结果
    const deletedCount = results.filter(r => r.status === 'deleted').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    return {
      success: errorCount === 0,
      message: errorCount === 0
        ? `已成功清空 ${deletedCount} 个长期记忆存储位置`
        : `清空完成，${deletedCount} 个成功，${errorCount} 个失败`,
      results,
      summary: {
        total: results.length,
        deleted: deletedCount,
        notFound: results.filter(r => r.status === 'not_found').length,
        errors: errorCount
      }
    };
    }); // withMemoryLock end

    res.json(result);

  } catch (error) {
    logger.error('[Memory] Clear all memory error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * POST /api/memory/edit/preview/:userId
 * 根据自然语言生成长期记忆修改预览；不会直接写入。
 */
router.post('/edit/preview/:userId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveUserId(req.params.userId || req.body.userId || 'web-user');
    const { instruction, apiUrl, apiKey, model } = req.body || {};
    if (!instruction || typeof instruction !== 'string') {
      return res.status(400).json({ success: false, error: '请提供长期记忆修改指令' });
    }

    const result = await createMemoryEditPreview({
      userId,
      instruction,
      apiUrl,
      apiKey,
      model,
    });
    res.json({ success: true, userId, ...result });
  } catch (error) {
    logger.error('[MemoryEdit] Preview route error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/memory/edit/confirm/:userId
 * 确认写入最近一次长期记忆修改预览。
 */
router.post('/edit/confirm/:userId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveUserId(req.params.userId || req.body.userId || 'web-user');
    const result = await applyPendingMemoryEdit(userId);
    res.json({ success: result.applied, userId, ...result });
  } catch (error) {
    logger.error('[MemoryEdit] Confirm route error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/memory/edit/cancel/:userId
 * 取消最近一次长期记忆修改预览。
 */
router.post('/edit/cancel/:userId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveUserId(req.params.userId || req.body.userId || 'web-user');
    const result = await cancelPendingMemoryEdit(userId);
    res.json({ success: true, userId, ...result });
  } catch (error) {
    logger.error('[MemoryEdit] Cancel route error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/memory/edit/rollback/:userId
 * 回滚到指定备份；未指定 backupId 时回滚最近一次备份。
 */
router.post('/edit/rollback/:userId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveUserId(req.params.userId || req.body.userId || 'web-user');
    const result = await rollbackMemoryEdit(userId, req.body?.backupId);
    res.json({ userId, ...result });
  } catch (error) {
    logger.error('[MemoryEdit] Rollback route error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/memory/:userId
 * 获取用户记忆数据（前端 showExperimentSummary/showDataSummary 使用）
 * 注意：此路由必须在所有特定路由之后定义，否则会先匹配通用的 /:userId
 * 
 * Bug fix: 使用 resolveUserId 解析 userId，确保与写入路径一致
 */
router.get('/:userId', async (req: Request, res: Response) => {
  try {
    // Bug fix: 使用 resolveUserId 解析，优先级：session > req.params.userId > 'web-user'
    const userId = await resolveUserId(req.params.userId);
    let memory = await loadUserMemory(userId);
    
    // Bug fix: 如果解析后的 userId（如 session user）无数据，fallback 检查 web-user
    if (memory.entries.length === 0 && userId !== 'web-user') {
      logger.info(`[Memory] No data for resolved userId ${userId}, checking web-user fallback`);
      const webUserMemory = await loadUserMemory('web-user');
      if (webUserMemory.entries.length > 0) {
        memory = webUserMemory;
        logger.info(`[Memory] Using web-user fallback data (${memory.entries.length} entries)`);
      }
    }
    
    const entries = getStructuredPreferredMemoryEntries(memory.entries);

    res.json({
      success: true,
      userId,
      memory: {
        userId: memory.userId,
        entries,
        conversations: memory.conversations,
        updatedAt: memory.updatedAt
      },
      entries  // 兼容前端两种访问方式
    });
    
  } catch (error) {
    logger.error('[Memory] Get memory error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * 格式化字节数为可读字符串
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * POST /api/memory/regenerate-structured/:userId
 * Bug #4 修复：手动触发重新生成结构化总结
 * 用于前端重试按钮调用
 */
router.post('/regenerate-structured/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const { apiUrl, apiKey, model, type } = req.body;
    
    // type: 'experiment' | 'data' | 'both'
    const targetType = type || 'both';
    
    logger.info(`[Memory] Regenerating structured summary for ${userId}, type: ${targetType}`);
    
    const memory = await loadUserMemory(userId);
    
    // 检查是否有原始内容
    const experimentRaw = memory.entries.find(e => e.key === 'experiment_summary');
    const dataRaw = memory.entries.find(e => e.key === 'data_summary');
    
    if (targetType === 'experiment' && !experimentRaw?.value) {
      return res.json({
        success: false,
        error: '没有实验资料原始内容，无法生成结构化总结'
      });
    }
    
    if (targetType === 'data' && !dataRaw?.value) {
      return res.json({
        success: false,
        error: '没有数据资料原始内容，无法生成结构化总结'
      });
    }
    
    // 如果没有配置API，返回错误
    if (!apiUrl || !apiKey) {
      return res.json({
        success: false,
        error: '请先配置API设置'
      });
    }
    
    // 调用生成函数（这里需要从 local-server 导入，暂时返回需要手动操作的提示）
    // 实际实现：返回一个 SSE 流，前端监听进度
    
    res.json({
      success: true,
      message: '请在聊天中发送消息，系统会自动更新结构化总结',
      hasExperimentContent: !!experimentRaw?.value,
      hasDataContent: !!dataRaw?.value,
      experimentContentLength: experimentRaw?.value?.length || 0,
      dataContentLength: dataRaw?.value?.length || 0
    });
    
  } catch (error) {
    logger.error('[Memory] Regenerate structured error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

/**
 * GET /api/memory/summary-status/:userId
 * Bug #4 修复：获取结构化总结的状态信息
 */
router.get('/summary-status/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const memory = await loadUserMemory(userId);
    
    const experimentRaw = memory.entries.find(e => e.key === 'experiment_summary');
    const experimentStructured = memory.entries.find(e => e.key === 'experiment_summary_structured');
    const dataRaw = memory.entries.find(e => e.key === 'data_summary');
    const dataStructured = memory.entries.find(e => e.key === 'data_summary_structured');
    
    // 计算状态
    // - 'none': 无原始内容
    // - 'pending': 有原始内容但无结构化
    // - 'generating': 正在生成（无法直接判断，需要前端状态）
    // - 'complete': 有结构化内容
    const experimentStatus = 
      !experimentRaw?.value ? 'none' :
      !experimentStructured?.value ? 'pending' :
      experimentStructured.value.length < 100 ? 'failed' : 'complete';
    
    const dataStatus = 
      !dataRaw?.value ? 'none' :
      !dataStructured?.value ? 'pending' :
      dataStructured.value.length < 100 ? 'failed' : 'complete';
    
    res.json({
      success: true,
      userId,
      experimentSummary: {
        status: experimentStatus,
        hasRawContent: !!experimentRaw?.value,
        rawContentLength: experimentRaw?.value?.length || 0,
        hasStructuredContent: !!experimentStructured?.value,
        structuredContentLength: experimentStructured?.value?.length || 0,
        lastUpdated: experimentStructured?.timestamp || experimentRaw?.timestamp || null
      },
      dataSummary: {
        status: dataStatus,
        hasRawContent: !!dataRaw?.value,
        rawContentLength: dataRaw?.value?.length || 0,
        hasStructuredContent: !!dataStructured?.value,
        structuredContentLength: dataStructured?.value?.length || 0,
        lastUpdated: dataStructured?.timestamp || dataRaw?.timestamp || null
      }
    });
    
  } catch (error) {
    logger.error('[Memory] Summary status error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message
    });
  }
});

// ============ Bug #5 修复补充：结构化总结生成函数 ============
// 移到 memory.ts 以避免循环依赖

/**
 * Bug #2 辅助函数：智能提取关键内容（用于超长文本）
 * 提取包含数值、方法、结果等关键信息的段落
 */
export function extractKeyContent(content: string): string {
  // 关键段落模式（包含数值、方法、结果等）
  // P2 修复：移除全局标志 g，避免 .test() 在循环中修改 lastIndex 导致漏判
  const keyPatterns = [
    /[\d]+\.?\d*\s*(kg|ha|mm|℃|°C|g|mg|%|N|P|K|ppm|pH|cm|m|yr|year)/i,  // 数值+单位
    /(处理|组|小区|重复|样本|实验|试验|方法|测定|采样|测量)[^\n。]{0,200}/i,  // 实验方法描述
    /(结果|发现|结论|表明|显示|显著|差异)[^\n。]{0,200}/i,  // 结果描述
    /(202\d|201\d|200\d)年?[^\n]{0,150}/i,  // 年份相关内容
    /(土壤|气候|温度|降水|水分|排放|排放量|通量)[^\n。]{0,200}/i,  // 关键变量
  ];
  
  const keyParagraphs: string[] = [];
  const paragraphs = content.split(/\n\n+/);
  
  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (trimmedPara.length < 30) continue; // 跳过过短段落
    
    // 检查是否包含关键信息
    for (const pattern of keyPatterns) {
      if (pattern.test(trimmedPara)) {
        keyParagraphs.push(trimmedPara);
        break; // 每个段落只添加一次
      }
    }
    
    // 限制提取内容总长度
    if (keyParagraphs.join('\n\n').length > 30000) {
      logger.info('[extractKeyContent] Reached content limit, stopping extraction');
      break;
    }
  }
  
  const result = keyParagraphs.join('\n\n');
  logger.info(`[extractKeyContent] Extracted ${keyParagraphs.length} key paragraphs, ${result.length} chars from ${content.length} chars original`);
  return result || content.substring(0, 15000); // 如果提取失败，返回前15000字符
}

/**
 * 自动生成结构化总结（从对话中提取后触发，使用用户配置的小牛马模型）
 * Bug #2: 移除硬截断，使用智能分块
 * Bug #5: 移到 memory.ts 避免循环依赖
 * 
 * ========== 新增：检查 deletedKeys，防止删除后又被生成 ==========
 */
export async function generateStructuredSummaries(
  userId: string, 
  entries: MemoryEntry[], 
  apiUrl: string, 
  apiKey: string,
  secondaryModel?: string
): Promise<void> {
  // 使用用户配置的小牛马模型（不再写死）
  const model = secondaryModel || process.env.SECONDARY_MODEL || 'gpt-4o-mini';
  
  // ========== 关键修复：检查 deletedKeys ==========
  // 加载用户记忆以获取 deletedKeys
  const memory = await loadUserMemory(userId);
  
  // 如果用户已删除相关字段，跳过生成
  const isExperimentDeleted = isKeyDeleted(memory, 'experiment_summary') || 
                               isKeyDeleted(memory, 'experiment_summary_structured');
  const isDataDeleted = isKeyDeleted(memory, 'data_summary') || 
                        isKeyDeleted(memory, 'data_summary_structured');
  
  if (isExperimentDeleted && isDataDeleted) {
    logger.info('[StructuredSummary] Both experiment_summary and data_summary are deleted, skipping generation');
    return;
  }
  
  // 获取现有总结内容
  const experimentEntry = entries.find(e => e.key === 'experiment_summary');
  const dataEntry = entries.find(e => e.key === 'data_summary');
  
  const experimentContent = experimentEntry?.value || '';
  const dataContent = dataEntry?.value || '';
  
  if (!experimentContent && !dataContent) {
    logger.info('[StructuredSummary] No content to summarize');
    return;
  }
  
  // 获取已有的结构化总结（用于智能合并）
  const existingStructuredExperiment = entries.find(e => e.key === 'experiment_summary_structured')?.value || '';
  const existingStructuredData = entries.find(e => e.key === 'data_summary_structured')?.value || '';
  
  // 生成实验资料结构化总结
  if (experimentContent && !isExperimentDeleted) {
    try {
      logger.info('[StructuredSummary] Generating structured experiment summary...');
      
      // Bug #2 修复：使用智能分段处理代替硬截断
      const MAX_CONTENT_LENGTH = 50000;
      let effectiveExperimentContent = experimentContent;
      
      if (experimentContent.length > MAX_CONTENT_LENGTH) {
        logger.info(`[StructuredSummary] Content too long (${experimentContent.length} chars), using smart chunking`);
        effectiveExperimentContent = extractKeyContent(experimentContent);
      }
      
      const experimentPrompt = existingStructuredExperiment 
        ? `请基于已有的结构化总结和新收集的实验资料，生成一份更新、更完整的实验资料全面总结。

## 已有的结构化总结
${existingStructuredExperiment}

## 新收集的实验资料
${effectiveExperimentContent}

## 任务要求
请将新资料中的信息智能整合到已有总结中：
1. 补充缺失的信息（如新的实验细节、方法参数等）
2. 更新冲突的信息（以新资料为准）
3. 保持原有结构完整
4. 确保所有具体数值都被保留

请按以下结构输出（使用Markdown格式）：

### 📋 研究背景
[一句话概括]

### 🎯 实验目的
[明确目标]

### 📍 实验地点与环境
- 地理位置：[具体地点]
- 气候条件：[年均温、降水量]
- 土壤性质：[土壤类型、理化性质]
- 试验地土壤物化生指标：[pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、含水量/WFPS、微生物量、酶活性、微生物群落等；有就填，没有就留空]

### 🔬 实验设计
- 处理设置：[各处理组]
- 采样方法：[装置、频率、时间]
- 测定方法：[各指标方法]

### 📊 主要结果
- [关键发现1]
- [关键发现2]
- [关键发现3]

### 💡 核心结论
[一句话总结]`
        : `请对以下实验资料进行结构化总结，生成一份清晰、完整的实验资料全面总结。

## 原始实验资料
${effectiveExperimentContent}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📋 研究背景
[一句话概括研究背景和意义]

### 🎯 实验目的
[明确实验的主要目标]

### 📍 实验地点与环境
- 地理位置：[具体地点和坐标]
- 气候条件：[年均温、降水量等]
- 土壤性质：[土壤类型、基本理化性质]
- 试验地土壤物化生指标：[pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、含水量/WFPS、微生物量、酶活性、微生物群落等；有就填，没有就留空]

### 🔬 实验设计
- 处理设置：[各处理组名称及设置]
- 采样方法：[采样装置、频率、时间]
- 测定方法：[各指标测定方法]

### 📊 主要结果
- [关键发现1]
- [关键发现2]
- [关键发现3]

### 💡 核心结论
[一句话总结核心结论]

要求：
1. 保留所有关键数值（温度、降水、土壤性质、土壤物化生指标等）
2. 结构清晰，层次分明
3. 语言简洁专业`;

      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: "你是一个专业的学术实验资料分析和总结助手（小牛马）。请确保保留所有具体数值和关键细节。" },
            { role: "user", content: experimentPrompt }
          ],
          temperature: 0.3,
          max_tokens: 32000,
        }),
      });
      
      if (response.ok) {
        const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const summary = result.choices?.[0]?.message?.content || "";
        
        if (summary.length > 100) {
          await withMemoryLock(userId, async () => {
            const memory = await loadUserMemory(userId);
            if (isKeyDeleted(memory, 'experiment_summary') || isKeyDeleted(memory, 'experiment_summary_structured')) {
              logger.info('[StructuredSummary] Experiment summary was deleted before save, skipping write');
              return;
            }

            const existingIndex = memory.entries.findIndex(e => e.key === 'experiment_summary_structured');
            const newEntry: MemoryEntry = {
              key: "experiment_summary_structured",
              value: summary.trim(),
              source: existingStructuredExperiment ? "ai-merged" : "ai-structured",
              timestamp: new Date().toISOString()
            };
            
            if (existingIndex >= 0) {
              memory.entries[existingIndex] = newEntry;
            } else {
              memory.entries.push(newEntry);
            }
            await saveUserMemory(memory);
          });
          logger.info(`[StructuredSummary] Experiment summary ${existingStructuredExperiment ? 'merged' : 'generated'}: ${summary.length} chars`);
        }
      }
    } catch (error) {
      logger.warn('[StructuredSummary] Failed to generate experiment summary:', error);
    }
  }
  
  // 生成数据详细结构化总结
  if (dataContent && !isDataDeleted) {
    try {
      logger.info('[StructuredSummary] Generating structured data summary...');
      
      // Bug #2 修复：数据总结也使用智能分段处理
      const MAX_DATA_LENGTH = 50000;
      let effectiveDataContent = dataContent;
      
      if (dataContent.length > MAX_DATA_LENGTH) {
        logger.info(`[StructuredSummary] Data content too long (${dataContent.length} chars), using smart chunking`);
        effectiveDataContent = extractKeyContent(dataContent);
      }
      
      const dataPrompt = existingStructuredData
        ? `请基于已有的结构化数据总结和新收集的数据资料，生成一份更新、更完整的数据详细总结。

## 已有的结构化总结
${existingStructuredData}

## 新收集的数据资料
${effectiveDataContent}

## 任务要求
请将新资料中的数据智能整合到已有总结中：
1. 补充缺失的数据（如新的年份、新的指标等）
2. 更新冲突的数据（以新资料为准）
3. 保持原有结构完整
4. 确保所有具体数值都被保留

请按以下结构输出（使用Markdown格式）：

### 📊 数据概览
- 数据年份：[年份范围]
- 数据类型：[观测/实验/模型]
- 数据量：[样本数量]

### 🌡️ 环境条件数据
- 温度数据：[年均温、变化]
- 降水数据：[年降水量、分布]
- 土壤条件：[WFPS等；如有pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、微生物量、酶活性、微生物群落等也保留，没有就留空]

### 📈 排放/测量数据
- 主要指标：[数据范围]
- 峰值特征：[条件、数值]
- 累积排放：[处理对比]

### 🔬 统计分析结果
- 处理间差异：[显著性、幅度]
- 年际变异：[年份对比]
- 关键比值：[如NO/N2O]

### 💡 数据解读要点
- [关键规律]
- [数据特点]`
        : `请对以下实验数据进行结构化总结，生成一份清晰、完整的数据详细总结。

## 原始数据资料
${effectiveDataContent}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📊 数据概览
- 数据年份：[包含哪些年份的数据]
- 数据类型：[观测数据/实验数据/模型数据等]
- 数据量：[样本数量、观测频次等]

### 🌡️ 环境条件数据
- 温度数据：[年均温、季节变化、年际变异等]
- 降水数据：[年降水量、季节分布、年际变异等]
- 土壤条件：[水分含量、WFPS等关键指标；如有pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、微生物量、酶活性、微生物群落等也保留，没有就留空]

### 📈 排放/测量数据
- 主要指标：[N2O、NO等排放数据范围]
- 峰值特征：[峰值出现条件、数值范围]
- 累积排放：[各处理累积排放量对比]

### 🔬 统计分析结果
- 处理间差异：[显著性水平、差异幅度]
- 年际变异：[不同年份数据对比]
- 关键比值：[如NO/N2O比值等]

### 💡 数据解读要点
- [数据反映的关键规律]
- [与预期的差异]

要求：
1. 保留所有具体数值和单位
2. 突出数据间的对比关系
3. 结构清晰，便于查阅`;

      const response = await fetch(apiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + apiKey,
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: "你是一个专业的学术数据分析和总结助手（小牛马）。请确保保留所有具体数值和关键细节。" },
            { role: "user", content: dataPrompt }
          ],
          temperature: 0.3,
          max_tokens: 32000,
        }),
      });
      
      if (response.ok) {
        const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const summary = result.choices?.[0]?.message?.content || "";
        
        if (summary.length > 100) {
          await withMemoryLock(userId, async () => {
            const memory = await loadUserMemory(userId);
            if (isKeyDeleted(memory, 'data_summary') || isKeyDeleted(memory, 'data_summary_structured')) {
              logger.info('[StructuredSummary] Data summary was deleted before save, skipping write');
              return;
            }

            const existingIndex = memory.entries.findIndex(e => e.key === 'data_summary_structured');
            const currentStructuredData = memory.entries.find(e => e.key === 'data_summary_structured')?.value || '';
            const protectedSummary = preserveProtectedUploadSummaryBlocks(
              summary.trim(),
              existingStructuredData,
              currentStructuredData,
              dataContent
            );
            const newEntry: MemoryEntry = {
              key: "data_summary_structured",
              value: protectedSummary,
              source: existingStructuredData ? "ai-merged" : "ai-structured",
              timestamp: new Date().toISOString()
            };
            
            if (existingIndex >= 0) {
              memory.entries[existingIndex] = newEntry;
            } else {
              memory.entries.push(newEntry);
            }
            await saveUserMemory(memory);
          });
          logger.info(`[StructuredSummary] Data summary ${existingStructuredData ? 'merged' : 'generated'}: ${summary.length} chars`);
        }
      }
    } catch (error) {
      logger.warn('[StructuredSummary] Failed to generate data summary:', error);
    }
  }
  
  // ========== 写入 .txt 文件 ==========
  // 在结构化总结生成完成后，同步写入试验资料总结.txt和数据详细总结.txt
  const finalMemory = await loadUserMemory(userId);
  await saveMemoryToFiles(userId, finalMemory);
  logger.info('[StructuredSummary] Memory files saved for user:', userId);
}

/**
 * 保存对话消息到服务端文件（持久化，而非仅 localStorage）
 * 每个对话存为 data/memory/{userId}/conversations/{conversationId}.json
 */
export async function saveConversationMessages(
  userId: string,
  conversationId: string,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  const convDir = path.join(memoryDir, userId, 'conversations');
  await fsp.mkdir(convDir, { recursive: true });
  
  const convFile = path.join(convDir, `${conversationId}.json`);
  const data = {
    id: conversationId,
    userId,
    messages,
    messageCount: messages.length,
    updatedAt: new Date().toISOString(),
  };
  
  await fsp.writeFile(convFile, JSON.stringify(data, null, 2), 'utf-8');
  logger.info(`[Memory] Saved conversation ${conversationId} for ${userId} (${messages.length} messages)`);
}

/**
 * 加载对话消息（从服务端文件）
 */
export async function loadConversationMessages(
  userId: string,
  conversationId: string
): Promise<Array<{ role: string; content: string }>> {
  const convFile = path.join(memoryDir, userId, 'conversations', `${conversationId}.json`);
  
  try {
    const content = await fsp.readFile(convFile, 'utf-8');
    const data = JSON.parse(content);
    return data.messages || [];
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

/**
 * 列出用户所有已保存的对话（按更新时间倒序）
 */
export async function listConversations(
  userId: string,
  limit?: number
): Promise<Array<{ id: string; messageCount: number; updatedAt: string }>> {
  const convDir = path.join(memoryDir, userId, 'conversations');
  
  try {
    const files = await fsp.readdir(convDir);
    const conversations: Array<{ id: string; messageCount: number; updatedAt: string }> = [];
    
    for (const file of files.filter(f => f.endsWith('.json'))) {
      try {
        const filePath = path.join(convDir, file);
        const content = await fsp.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        conversations.push({
          id: data.id || file.replace('.json', ''),
          messageCount: data.messageCount || 0,
          updatedAt: data.updatedAt || new Date().toISOString(),
        });
      } catch {
        // 跳过损坏的文件
      }
    }
    
    // 按更新时间倒序
    conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const safeLimit = Number.isFinite(limit) && Number(limit) > 0 ? Math.floor(Number(limit)) : 0;
    return safeLimit > 0 ? conversations.slice(0, safeLimit) : conversations;
  } catch (e) {
    if (isNodeError(e) && e.code === 'ENOENT') {
      return [];
    }
    throw e;
  }
}

/**
 * 加载最近 N 个对话的消息（用于新会话注入上下文）
 * 返回最近的对话消息，按时间正序排列
 */
export async function loadRecentConversationMessages(
  userId: string,
  recentCount: number = 2,
  maxMessagesPerConv: number = 10
): Promise<Array<{ role: string; content: string }>> {
  const conversations = await listConversations(userId, recentCount);
  
  const allMessages: Array<{ role: string; content: string }> = [];
  
  for (const conv of conversations) {
    const messages = await loadConversationMessages(userId, conv.id);
    // 取每个对话最近的 N 条消息
    const recentMessages = messages.slice(-maxMessagesPerConv);
    allMessages.push(...recentMessages);
  }
  
  return allMessages;
}

/**
 * 更新 memory.conversations 摘要数组
 * 在对话结束时调用，生成对话摘要并保存
 */
export async function updateConversationSummary(
  userId: string,
  conversationId: string,
  messages: Array<{ role: string; content: string }>,
  extractedTopics?: string[]
): Promise<void> {
  const memory = await loadUserMemory(userId);
  
  // 查找或创建摘要
  const existingIdx = memory.conversations.findIndex(c => c.id === conversationId);
  
  // 生成标题：取第一条用户消息的前30个字符
  const firstUserMsg = messages.find(m => m.role === 'user');
  const title = firstUserMsg 
    ? firstUserMsg.content.substring(0, 30).replace(/\n/g, ' ') + (firstUserMsg.content.length > 30 ? '...' : '')
    : '新对话';
  
  // 生成简要摘要：取前2轮对话的内容
  const summaryMessages = messages.slice(0, 4);
  const summary = summaryMessages
    .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content.substring(0, 100).replace(/\n/g, ' ')}`)
    .join(' | ');
  
  const convSummary: ConversationSummary = {
    id: conversationId,
    title,
    summary: summary.substring(0, 500),
    keyTopics: extractedTopics || [],
    messageCount: messages.length,
    createdAt: existingIdx >= 0 ? memory.conversations[existingIdx].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  if (existingIdx >= 0) {
    memory.conversations[existingIdx] = convSummary;
  } else {
    memory.conversations.push(convSummary);
  }
  
  memory.conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  
  await saveUserMemory(memory);
  logger.info(`[Memory] Updated conversation summary for ${userId}: ${conversationId} (${messages.length} messages)`);
}

/**
 * POST /api/memory/save-conversation
 * 保存对话消息到服务端（前端调用）
 */
router.post('/save-conversation', async (req: Request, res: Response) => {
  try {
    const { userId, conversationId, messages } = req.body;
    
    if (!userId || !conversationId || !messages) {
      res.status(400).json({ success: false, error: 'Missing required fields: userId, conversationId, messages' });
      return;
    }
    
    await saveConversationMessages(userId, conversationId, messages);
    
    // 同时更新对话摘要
    await updateConversationSummary(userId, conversationId, messages);
    
    res.json({ success: true, messageCount: messages.length });
  } catch (error) {
    logger.error('[Memory] Save conversation error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/memory/conversations/:userId
 * 获取用户的对话列表（摘要）
 */
router.get('/conversations/:userId', async (req: Request, res: Response) => {
  try {
    const userId = req.params.userId;
    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    
    const conversations = await listConversations(userId, limit);
    const memory = await loadUserMemory(userId);
    
    res.json({
      success: true,
      userId,
      conversations: memory.conversations,
      recentConversations: conversations,
    });
  } catch (error) {
    logger.error('[Memory] List conversations error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/memory/conversation/:userId/:conversationId
 * 获取特定对话的消息
 */
router.get('/conversation/:userId/:conversationId', async (req: Request, res: Response) => {
  try {
    const { userId, conversationId } = req.params;
    const messages = await loadConversationMessages(userId, conversationId);
    
    res.json({
      success: true,
      userId,
      conversationId,
      messages,
      messageCount: messages.length,
    });
  } catch (error) {
    logger.error('[Memory] Load conversation error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

async function recordMemoryResearchProvenance(input: {
  userId: string;
  researchSessionId?: string;
  userMessage: string;
  aiResponse: string;
  updatedKeys: string[];
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactId?: string }> {
  const memory = await loadUserMemory(input.userId);
  const updatedEntries = memory.entries.filter(entry => input.updatedKeys.includes(entry.key));
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.researchSessionId,
    sessionTitle: updatedEntries[0]?.value ? `长期记忆：${updatedEntries[0].key}` : '跨会话长期记忆',
    targetType: 'memory',
    targetId: `memory-update-${Date.now()}`,
    operation: 'memory.update',
    sourceModule: 'memory',
    input: {
      userMessagePreview: input.userMessage.slice(0, 1000),
      aiResponsePreview: input.aiResponse.slice(0, 1000),
    },
    output: {
      updatedKeys: input.updatedKeys,
      updatedEntries: updatedEntries.map(entry => ({
        key: entry.key,
        source: entry.source,
        timestamp: entry.timestamp,
        valuePreview: entry.value.slice(0, 1000),
      })),
      memoryUpdatedAt: memory.updatedAt,
    },
    sources: updatedEntries.map(entry => ({
      id: entry.key,
      sourceType: 'memory' as const,
      title: entry.key,
      evidenceSnippet: entry.value.slice(0, 500),
      metadata: {
        source: entry.source,
        timestamp: entry.timestamp,
      },
    })),
    metadata: {
      updatedKeyCount: input.updatedKeys.length,
    },
  });

  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
  };
}

export default router;
