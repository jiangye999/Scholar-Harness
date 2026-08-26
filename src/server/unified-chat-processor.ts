/**
 * 统一聊天处理器 - Web UI 和其他客户端共享相同的处理逻辑
 * 
 * 核心功能：
 * 1. 用户记忆加载和更新
 * 2. 文献检索和引用
 * 3. 网络搜索
 * 4. 写作技能加载
 * 5. LLM 调用
 * 6. 记忆提取和保存
 */

import * as path from 'path';
import * as fs from 'fs';
import { logger } from '../utils/logger';
import { callChatCompletion } from '../utils/llm-client';
import { normalizeAuthorYearCitationText } from '../utils/citation-format';
import { parseDraftSaveBlocks } from '../utils/draft-save-block';
import { mergeDraftChapterContent } from '../utils/draft-content-merger';
import { createDynamicDraftChapter } from '../utils/draft-section-classifier';
import type { Message } from '../types';
import { getSessionLog, type SessionLog } from './services/session-log';
import { buildCompactionSummaryPrompt, considerAutoCompaction } from './services/compaction';
import {
  buildAnchoredUserMessage,
  getPromptAnchorDiagnostics,
} from '../utils/prompt-request-anchor';
import { AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING } from '../config/auto-research-paper-topic-skill';
import { REFERENCE_RELEVANCE_WRITING_RULES } from '../config/reference-relevance-constraint-skill';
import { SessionStore, sanitizeDraftChapterName } from '../storage/session-store';
import type { HybridRetrievalEngine } from '../literature/retrieval';
import {
  buildQueryIntentPromptBlock,
  classifyQueryIntentFallback,
  parseQueryIntentResponse,
  type QueryIntent,
  type QueryIntentHistoryMessage,
} from '../orchestrator/query-intent';
import {
  buildBilingualRetrievalQueries,
  formatRetrievalQueryVariants,
} from '../literature/retrieval/semantic-query';
// Bug #3 修复：导入统一的重复检测函数
// Bug #5 修复补充：从 memory.ts 导入结构化总结生成函数（避免循环依赖）
import {
  isDuplicateContent,
  generateStructuredSummaries,
  withMemoryLock,
  loadUserMemory,
  saveUserMemory,
  saveMemoryToFiles,
  saveConversationMessages,
  loadRecentConversationMessages,
  updateConversationSummary,
  type ConversationSummary,
  // Bug fix: 导入已删除键检查函数
  isKeyDeleted,
  autoRestoreDeletedKeyIfEmpty,
} from './routes/memory';

// ============ 脱敏工具函数 ============

/**
 * 脱敏 API Key（日志安全）
 */
function maskApiKey(key: string | undefined): string {
  if (!key) return '(not set)';
  if (key.length <= 8) return '****';
  return key.substring(0, 4) + '****' + key.substring(key.length - 4);
}

/**
 * 脱敏 Email
 */
function maskEmail(email: string | undefined): string {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.substring(0, 2)}***@${domain}`;
}

// ============ 参考文献处理 ============

/**
 * 参考文献去重和字母标注
 * - 检查作者+年份重复
 * - 对重复的添加 a, b, c 等字母
 * - 合完全相同的参考文献
 */
function deduplicateReferences(referencesText: string): string {
  if (!referencesText || referencesText.trim().length === 0) {
    return '';
  }

  // 解析参考文献列表（支持多种格式）
  const normalizedReferencesText = normalizeAuthorYearCitationText(referencesText);
  const lines = normalizedReferencesText.split('\n').filter(line => line.trim().length > 0);
  const refs: Array<{
    original: string;
    authorYear: string;
    author: string;
    year: string;
    letter: string;
    fullText: string;
  }> = [];

  // 提取每条参考文献的作者和年份
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    // 尝试匹配多种格式
    let author = '';
    let year = '';

    // 标准文末条目：Yang, X., Li, S. (2024)...，不依赖已废弃的 (Yang et al., 2024) 前缀。
    const standardReferenceMatch = trimmedLine.match(/^(?:[-*•]\s*)?(?:\[\d+\]\s*)?([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)?),[\s\S]*?\(((?:19|20)\d{2}[a-z]?)\)/i);
    if (standardReferenceMatch) {
      author = standardReferenceMatch[1].trim();
      year = standardReferenceMatch[2].trim();
    }
    
    // 格式1: [作者, 年份]
    const bracketMatch = !author ? trimmedLine.match(/\[([^,]+),\s*(\d{4}[a-z]?)\]/) : null;
    if (bracketMatch) {
      author = bracketMatch[1].trim();
      year = bracketMatch[2].trim();
    }
    
    // 格式2: 作者 (年份)
    if (!author) {
      const authorYearMatch = trimmedLine.match(/^([A-Z][a-z]+(?:\s+et\s+al\.?|\s+[A-Z][a-z]+)*),?\s*(?:\()(\d{4}[a-z]?)(?:\))/);
      if (authorYearMatch) {
        author = authorYearMatch[1].trim();
        year = authorYearMatch[2].trim();
      }
    }
    
    // 格式3: (作者, 年份)
    if (!author) {
      const inlineMatch = trimmedLine.match(/\(([A-Z][a-z]+(?:\s+et\s+al\.?|\s+[A-Z][a-z]+)*),?\s*(\d{4}[a-z]?)\)/);
      if (inlineMatch) {
        author = inlineMatch[1].trim();
        year = inlineMatch[2].trim();
      }
    }

    // 如果没有匹配到年份，尝试提取年份
    if (!year) {
      const yearMatch = trimmedLine.match(/\b(20\d{2}|19\d{2})\b/);
      if (yearMatch) {
        year = yearMatch[1];
      }
    }

    const authorYear = author && year ? `${author}, ${year}` : trimmedLine.substring(0, 50);
    
    refs.push({
      original: trimmedLine,
      authorYear,
      author,
      year,
      letter: '',
      fullText: trimmedLine
    });
  }

  // 检测重复的 authorYear
  const authorYearCounts = new Map<string, number>();
  
  for (const ref of refs) {
    const count = authorYearCounts.get(ref.authorYear) || 0;
    authorYearCounts.set(ref.authorYear, count + 1);
  }

  // 对重复的添加字母标注
  const processedRefs: string[] = [];
  const seenAuthorYears = new Map<string, number>();

  for (const ref of refs) {
    const count = authorYearCounts.get(ref.authorYear) || 1;
    
    if (count > 1) {
      // 有重复，需要添加字母
      const occurrence = (seenAuthorYears.get(ref.authorYear) || 0) + 1;
      seenAuthorYears.set(ref.authorYear, occurrence);
      
      const letter = String.fromCharCode(97 + occurrence - 1);
      const newYear = ref.year.replace(/[a-z]$/, '') + letter;
      const newAuthorYear = `${ref.author}, ${newYear}`;
      
      // 更新原文
      let updatedLine = ref.original;
      
      if (updatedLine.includes(`[${ref.author}, ${ref.year}]`)) {
        updatedLine = updatedLine.replace(`[${ref.author}, ${ref.year}]`, `[${ref.author}, ${newYear}]`);
      }
      
      if (updatedLine.includes(`(${ref.year})`)) {
        updatedLine = updatedLine.replace(`(${ref.year})`, `(${newYear})`);
      }
      
      if (updatedLine.includes(ref.year) && !updatedLine.includes(newYear)) {
        updatedLine = updatedLine.replace(new RegExp(`\\b${ref.year}\\b`, 'g'), newYear);
      }
      
      logger.info(`[References] Dedup: "${ref.authorYear}" -> "${newAuthorYear}" (letter: ${letter})`);
      processedRefs.push(updatedLine);
    } else {
      processedRefs.push(ref.original);
    }
  }

  const dedupedText = processedRefs.join('\n');
  logger.info(`[References] Deduplicated: ${refs.length} refs -> ${processedRefs.length} refs`);
  
  return normalizeAuthorYearCitationText(dedupedText);
}

// ============ 类型定义 ============

export interface ChatProcessorConfig {
  apiUrl: string;
  apiKey: string;
  model: string;          // 大牛马模型（规划、Skill生成）
  secondaryModel?: string; // 小牛马模型（执行写作、记忆更新）
  webSearchKey?: string;
  uploadDir: string;
  memoryDir: string;
  skillDir: string;
}

export interface ChatProcessorResult {
  response: string;
  conversationId: string;
  metadata?: {
    taskType?: string;
    needWebSearch?: boolean;
    literatureCount?: number;
  };
}

export interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

export interface UserMemory {
  userId: string;
  entries: MemoryEntry[];
  conversations: ConversationSummaryCompat[];
  updatedAt: string;
}

export interface LitPaper {
  citationId?: number;
  title: string;
  author: string;
  journal: string;
  year: string;
  abstract: string;
  keywords: string;
  doi?: string;
  embedding?: number[];
  raw?: string;
}

function normalizeStoredLiteraturePapers(data: unknown): LitPaper[] {
  const rawPapers = Array.isArray(data)
    ? data
    : (data && typeof data === 'object' && Array.isArray((data as { papers?: unknown }).papers)
      ? (data as { papers: unknown[] }).papers
      : []);

  return rawPapers.map((raw): LitPaper => {
    const paper = raw as Record<string, unknown>;
    const authors = paper.author || paper.authors;
    const author = typeof authors === 'string'
      ? authors
      : (Array.isArray(authors) ? authors.map(a => typeof a === 'string' ? a : String((a as Record<string, unknown>)?.name || '')).filter(Boolean).join(', ') : 'Unknown');
    const keywords = Array.isArray(paper.keywords) ? paper.keywords.map(String).join('; ') : String(paper.keywords || '');

    return {
      citationId: typeof paper.citationId === 'number' ? paper.citationId : undefined,
      title: String(paper.title || ''),
      author,
      journal: String(paper.journal || ''),
      year: String(paper.year || ''),
      abstract: String(paper.abstract || ''),
      keywords,
      doi: paper.doi ? String(paper.doi) : undefined,
      embedding: Array.isArray(paper.embedding) ? paper.embedding as number[] : undefined,
      raw: paper.raw ? String(paper.raw) : undefined,
    };
  });
}

export interface ConversationHistoryItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ConversationSummaryCompat {
  id: string;
  title: string;
  summary: string;
  keyTopics: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

// CowAgent 结果类型
export interface CowAgentResult {
  totalSentences: number;
  results: Array<{
    sentence: string;
    keywords: string[];
    totalFound: number;
    selectedPapers: Array<{
      id: string;
      rank: number;
      title: string;
      authors: string;
      year: number;
      journal?: string;
      doi?: string;
      abstract: string;
      qualityScore: number;
      relevanceScore: number;
      combinedScore?: number;
    }>;
  }>;
  contextForLLM: string;
}

// Agent 协作流程类型
export interface AgentCollaborationWorkflow {
  execute(input: unknown): Promise<unknown>;
}

// ============ 全局状态 ============

// 对话历史缓存（内存）
const conversationHistories = new Map<string, ConversationHistoryItem[]>();

// 会话存储
let sessionStore: SessionStore;
let onDraftSaved: ((userId: string, section: string, content: string) => Promise<void>) | null = null;

// 检索引擎
let retrievalEngine: HybridRetrievalEngine | null = null;

// 小牛马 Agent（使用 execute 方法）
let cowAgent: {
  execute(sentences: Array<{ sentence: string; keywords: string[] }>): Promise<CowAgentResult>;
} | null = null;

// Agent 协作流程
let collaborationWorkflow: AgentCollaborationWorkflow | null = null;

// Soul 内容
let soulContent: string = '';

function getCanonicalDraftSectionName(section: string): string {
  const sanitized = sanitizeDraftChapterName(section || 'section');
  const normalized = sanitized.toLowerCase().replace(/[.\s]+/g, '_').replace(/_+/g, '_');
  const compact = normalized.replace(/[-_]+/g, '_');
  const aliasPatterns: Array<[RegExp, string]> = [
    [/^(title|题目|标题)(?:[_-].*)?$/, 'title'],
    [/^(abstract|摘要)(?:[_-].*)?$/, 'abstract'],
    [/^(intro|introduction|绪论|引言)(?:[_-].*)?$/, 'introduction'],
    [/^(method|methods|materials_methods|materials_and_methods|材料|方法|材料与方法)(?:[_-].*)?$/, 'methods'],
    [/^(result|results|结果)(?:[_-].*)?$/, 'results'],
    [/^(discussion|讨论)(?:[_-].*)?$/, 'discussion'],
    [/^(conclusion|conclusions|结论|展望)(?:[_-].*)?$/, 'conclusion'],
  ];
  for (const [pattern, canonical] of aliasPatterns) {
    if (pattern.test(compact)) return canonical;
  }
  return sanitized;
}

// ============ 初始化函数 ============

export function initializeUnifiedChatProcessor(config: {
  sessionStore: SessionStore;
  retrievalEngine?: HybridRetrievalEngine;
  cowAgent?: { execute(sentences: Array<{ sentence: string; keywords: string[] }>): Promise<CowAgentResult> };
  collaborationWorkflow?: AgentCollaborationWorkflow;
  soulContent?: string;
  onDraftSaved?: (userId: string, section: string, content: string) => Promise<void>;
}): void {
  sessionStore = config.sessionStore;
  onDraftSaved = config.onDraftSaved || null;
  retrievalEngine = config.retrievalEngine ?? null;
  cowAgent = config.cowAgent ?? null;
  collaborationWorkflow = config.collaborationWorkflow ?? null;
  soulContent = config.soulContent || '';
  
  logger.info('[UnifiedChatProcessor] Initialized');
}

// ============ 核心处理函数 ============

/**
 * 统一聊天处理器 - Web UI 和其他客户端都调用此函数
 * 
 * @param userId 用户 ID（保留原始 ID，Web 用户使用 "web-user"）
 * @param userMessage 用户消息
 * @param config 处理器配置
 * @param options 可选参数
 */
export async function processUnifiedChatMessage(
  userId: string,
  userMessage: string,
  config: ChatProcessorConfig,
  options?: {
    history?: ConversationHistoryItem[];
    conversationId?: string;
    skills?: string[];
    requestContext?: string;
    queryIntent?: QueryIntent;
  }
): Promise<ChatProcessorResult> {
  const { apiUrl, apiKey, model, secondaryModel, webSearchKey, uploadDir, memoryDir, skillDir } = config;
  const skills = options?.skills || [];
  const conversationId = options?.conversationId || '';
  const history = options?.history || [];
  const queryIntentHistory = history
    .filter(item => item && typeof item.content === 'string')
    .map((item): QueryIntentHistoryMessage => ({
      role: item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
      content: item.content,
    }))
    .slice(-20);
  const queryIntentInput = {
    message: userMessage,
    history: queryIntentHistory,
  };
  const queryIntent = options?.queryIntent
    ? parseQueryIntentResponse(JSON.stringify(options.queryIntent), queryIntentInput)
    : classifyQueryIntentFallback(queryIntentInput);
  
  // 小牛马：每次都发送完整提示词（保持上下文）
  // 判断是否为新对话仅用于日志
  const isNewConversation = history.length <= 1;
  
  logger.info(`[UnifiedChat] Processing for ${userId}: ${userMessage.substring(0, 50)}...`);
  logger.info(`[UnifiedChat] history.length: ${history.length}, isNewConversation: ${isNewConversation} (小牛马每次发送完整提示词)`);
  logger.info(`[UnifiedChat] Skills: ${skills.join(', ') || 'none'}`);
  
  // 小牛马始终发送完整提示词，跳过简化消息逻辑
  // 直接进入完整提示词构建流程
  
  // 检查是否有未报告的记忆更新失败
  const pendingFailure = getAndClearMemoryUpdateFailure(userId);
  if (pendingFailure) {
    logger.error(`[UnifiedChat] Pending memory update failure for ${userId}: ${pendingFailure.count} failures, last: ${pendingFailure.lastError}`);
  }

  // 1. 加载用户记忆
  const userMemory = await loadUserMemory(userId);
  let memoryContext = '';
  let writingProgressContext = '';
  let conversationHistoryContext = '';  // 跨会话对话历史
  
  if (userMemory.entries.length > 0) {
    const writingProgressEntry = userMemory.entries.find(e => e.key === 'writing_progress');
    const completedChaptersEntry = userMemory.entries.find(e => e.key === 'completed_chapters');
    const pendingChaptersEntry = userMemory.entries.find(e => e.key === 'pending_chapters');
    
    if (writingProgressEntry || completedChaptersEntry || pendingChaptersEntry) {
      writingProgressContext = '\n## 📝 当前写作进度\n';
      if (writingProgressEntry?.value && writingProgressEntry.value !== '无') {
        writingProgressContext += `**整体进度**: ${writingProgressEntry.value}\n`;
      }
      if (completedChaptersEntry?.value && completedChaptersEntry.value !== '无') {
        writingProgressContext += `**已完成章节**: ${completedChaptersEntry.value}\n`;
      }
      if (pendingChaptersEntry?.value && pendingChaptersEntry.value !== '无') {
        writingProgressContext += `**待完成章节**: ${pendingChaptersEntry.value}\n`;
      }
    }
    
    memoryContext = '\n## 🧠 跨会话长期记忆\n';
    let memoryChars = 0;
    for (const entry of userMemory.entries) {
      if (['writing_progress', 'completed_chapters', 'pending_chapters'].includes(entry.key)) continue;
      const value = String(entry.value || '').trim().slice(0, 400);
      if (!value) continue;
      const line = `- ${entry.key}: ${value}\n`;
      if (memoryChars + line.length > 4_000) break;
      memoryContext += line;
      memoryChars += line.length;
    }
  }
  memoryContext = [
    buildQueryIntentPromptBlock(queryIntent),
    String(options?.requestContext || '').trim(),
    memoryContext,
  ].filter(Boolean).join('\n\n');
  
  // 1.1 加载对话摘要（conversations 数组）
  if (userMemory.conversations && userMemory.conversations.length > 0) {
    // 取最近的 5 个对话摘要
    const recentConvs = userMemory.conversations
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 5);
    
    conversationHistoryContext = '\n## 💬 近期对话摘要\n';
    for (const conv of recentConvs) {
      conversationHistoryContext += `- **${conv.title}** (${conv.messageCount} 条消息, ${new Date(conv.updatedAt).toLocaleDateString()}): ${conv.summary}\n`;
    }
    conversationHistoryContext += '\n注意：以上是您之前对话的摘要，新对话中的问题可以参考这些上下文。\n';
  }
  
  // 1.2 新会话时：加载最近的对话消息作为上下文注入
  let recentMessages: ConversationHistoryItem[] = [];
  if (isNewConversation) {
    try {
      const serverRecentMessages = await loadRecentConversationMessages(userId, 2, 10);
      if (serverRecentMessages.length > 0) {
        recentMessages = serverRecentMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        logger.info(`[UnifiedChat] Loaded ${recentMessages.length} recent messages from server for new conversation context`);
      }
    } catch (e) {
      logger.warn(`[UnifiedChat] Failed to load recent conversation messages:`, e);
    }
  }
  
  // 1.3 加载 SessionStore 状态（写作阶段等）
  let sessionStateContext = '';
  try {
    if (sessionStore) {
      const sessionState = await sessionStore.load(userId);
      if (sessionState) {
        const parts: string[] = [];
        if (sessionState.paperTopic) {
          parts.push(`**论文主题**: ${sessionState.paperTopic}`);
        }
        if (sessionState.targetJournal) {
          parts.push(`**目标期刊**: ${sessionState.targetJournal}`);
        }
        if (sessionState.currentChapter) {
          parts.push(`**当前章节**: ${sessionState.currentChapter}`);
        }
        if (sessionState.chapterPlans && sessionState.chapterPlans.size > 0) {
          parts.push('**章节规划**:');
          for (const [name, plan] of sessionState.chapterPlans) {
            parts.push(`  - ${name}: ${plan.writingFocus}`);
          }
        }
        if (sessionState.phase && sessionState.phase !== 'greeting') {
          parts.push(`**对话阶段**: ${sessionState.phase}`);
        }
        
        if (parts.length > 0) {
          sessionStateContext = '\n## 📋 当前会话状态\n' + parts.join('\n') + '\n';
          logger.info(`[UnifiedChat] Loaded session state for ${userId}: phase=${sessionState.phase}, topic=${sessionState.paperTopic}`);
        }
      }
    }
  } catch (e) {
    logger.warn(`[UnifiedChat] Failed to load session state:`, e);
  }
  
  // 2. 加载文献库（用于工具调用）
  const userDir = path.join(uploadDir, userId);
  const litFile = path.join(userDir, 'literature.txt');
  const litJsonFile = path.join(userDir, 'literature.json');
  
  let literaturePapers: LitPaper[] = [];
  
  if (fs.existsSync(litFile)) {
    if (fs.existsSync(litJsonFile)) {
      try {
        literaturePapers = normalizeStoredLiteraturePapers(JSON.parse(fs.readFileSync(litJsonFile, 'utf-8')));
      } catch (e) {
        const litContent = fs.readFileSync(litFile, 'utf-8');
        literaturePapers = parseLiteratureToStructured(litContent);
      }
    } else {
      const litContent = fs.readFileSync(litFile, 'utf-8');
      literaturePapers = parseLiteratureToStructured(litContent);
    }
  }
  
  // 4. 使用统一、已校验的 Query Intent 决定联网与任务类型。
  // 路由层只读取当前用户 query；历史、草稿和 Skill 作为独立上下文，
  // 不再交给另一个宽松的 AI 分类器二次猜测。
  const needWebSearch = queryIntent.needsWebSearch;
  const webSearchQuery = queryIntent.resolvedQuery || userMessage;
  let taskType = '回答问题';
  if (queryIntent.primaryIntent === 'literature_collection') {
    taskType = '外部文献采集';
  } else if (queryIntent.primaryIntent === 'literature_retrieval') {
    taskType = '逐句检索';
  } else if (queryIntent.primaryIntent === 'academic_writing') {
    if (/(?:讨论)|\bdiscussion\b/i.test(userMessage)) {
      taskType = '写讨论';
    } else if (/(?:引言|绪论)|\b(?:introduction|intro)\b/i.test(userMessage)) {
      taskType = '写引言';
    } else {
      taskType = '写作';
    }
  } else if (queryIntent.needsToolExecution) {
    taskType = '其他';
  }
  logger.info(
    `[UnifiedChat] Verified decision: primary=${queryIntent.primaryIntent}, web=${needWebSearch}, literature=${queryIntent.needsLiteratureRetrieval}, task=${taskType}`
  );
  
  // 5. 检测章节类型已移除
  
  // 6. 网络搜索
  let webSearchContext = '';
  
  if (needWebSearch && webSearchKey) {
    try {
      logger.info('[UnifiedChat] Web searching for:', webSearchQuery);
      const searchResponse = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: webSearchKey,
          query: webSearchQuery,
          max_results: 5,
          include_answer: true,
          include_raw_content: true,
        }),
      });
      
      const searchData = await searchResponse.json() as {
        results?: Array<{ title?: string; url?: string; content?: string; raw_content?: string }>;
      };
      
      if (searchData.results && searchData.results.length > 0) {
        webSearchContext = '\n【网络搜索结果】\n';
        for (let i = 0; i < Math.min(searchData.results.length, 5); i++) {
          const r = searchData.results[i];
          const content = r.raw_content || r.content || '';
          webSearchContext += `${i + 1}. ${r.title}\n   ${r.url}\n   ${content}\n\n`;
        }
        logger.info('[UnifiedChat] Web search found', searchData.results.length, 'results');
      }
    } catch (e) {
      logger.error('[UnifiedChat] Web search error:', e);
    }
  } else if (needWebSearch && !webSearchKey) {
    logger.warn('[UnifiedChat] Explicit web search requested but no API key configured');
  }
  
  // 8. 任务提示
  let taskHint = '';
  const wantsDiscussionSkill = taskType === '写讨论'
    || skills.some(skill => /discussion|讨论/i.test(skill))
    || /讨论|discussion/i.test(userMessage);
  if (wantsDiscussionSkill) {
    const discussionSkillContent = loadWritingSkill('discussion', skillDir || path.join(process.cwd(), 'sci_writing_skills'));
    const discussionSkillBlock = discussionSkillContent
      ? `\n## Discussion 写作 Skill\n${discussionSkillContent.slice(0, 12000)}\n`
      : '';
    taskHint = [
      '\n## 写作任务\n用户想要写 Discussion（讨论）部分。请根据用户在对话中提供的文献和材料进行撰写。',
      `## 本地文献检索要求
在正式撰写 Discussion 段落前，先为关键论点调用句子级检索工具。每次输出 2-5 个待支撑句子即可，等待系统返回“逐句检索结果”后，再基于其中标记为“支持”或“仅相关”的文献继续写作。不要引用标记为“反向”或“无关”的文献作为正向证据。

\`\`\`
🔧 调用工具：sentence_search
sentences:
- 需要文献支撑的讨论论点 1
- 需要文献支撑的讨论论点 2
\`\`\``,
      `## Auto Research / 一键论文写作硬约束\n${AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING}`,
      discussionSkillBlock,
    ].filter(Boolean).join('\n\n');
  } else if (taskType === '写引言') {
    taskHint = `\n## 写作任务\n用户想要写 Introduction（引言）部分。请根据用户在对话中提供的文献和材料进行撰写。

## 本地文献检索要求
在正式撰写 Introduction 的事实性背景、研究空白和核心论点前，先为关键论点调用句子级检索工具。等待系统返回“逐句检索结果”后，再基于其中标记为“支持”或“仅相关”的文献继续写作。

\`\`\`
🔧 调用工具：sentence_search
sentences:
- 需要文献支撑的引言论点 1
- 需要文献支撑的引言论点 2
\`\`\`
`;
  }
  
  // 9. 记忆介绍
  let memoryIntro = '';
  if (userMemory.entries.length > 0 || userMemory.conversations.length > 0) {
    memoryIntro = '\n## 跨会话长久记忆（完整）\n系统已记录您之前分享的信息：\n';
    for (const entry of userMemory.entries) {
      memoryIntro += `- **${entry.key}**: ${entry.value}\n`;
    }
    if (userMemory.conversations && userMemory.conversations.length > 0) {
      memoryIntro += `\n**历史对话**：共 ${userMemory.conversations.length} 个对话\n`;
      // 只显示最近的5个对话摘要
      const recentConvs = userMemory.conversations
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5);
      for (const conv of recentConvs) {
        memoryIntro += `- ${conv.title}: ${conv.summary || ''}\n`;
      }
    }
    memoryIntro += '\n注意：每次对话结束后，系统会自动提取本对话的重要信息并更新到长久记忆中。\n';
  } else {
    memoryIntro = '\n## 跨会话长久记忆\n本对话结束后，系统将自动提取重要信息并保存到长久记忆中。\n';
  }
  
  // 如果有未报告的记忆更新失败，在系统提示中提醒
  if (pendingFailure) {
    memoryIntro += `\n⚠️ **系统提示**：最近 ${pendingFailure.count} 次记忆保存失败（${pendingFailure.lastError}）。请检查 API 配置或磁盘空间。\n`;
  }
  
  // 10. Discussion 写作任务会在 taskHint 中注入章节 Skill 和 Auto Research 写作约束
  
  // 11. 构建系统提示词
  // 注：文献由用户自行发送，不再在系统提示词中预塞检索结果
  // Phase 1（缓存友好重构）：当前用户请求锚点只放在 user 消息（buildAnchoredUserMessage），
  // 不再把每轮变化的请求塞进 system——否则 system 前缀每轮都从第一个变化字节起全部失效。
  const finalSystemPrompt = buildSystemPrompt({
    soulContent,
    memoryIntro,
    memoryContext,
    writingProgressContext,
    conversationHistoryContext,
    sessionStateContext,
    webSearchContext,
    taskHint,
  });
  
  // 12. 构建消息历史
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: finalSystemPrompt }
  ];
  
  const historyForMessages = options?.history || conversationHistories.get(userId) || [];
  
  // Phase 2（缓存友好重构）：服务端追加式会话日志是历史的事实源；请求历史只做一次性种子。
  const logConversationId = String(options?.conversationId || '').trim() || `uc-${userId}`;
  const sessionLog = getSessionLog({ userId, conversationId: logConversationId });
  if (sessionLog.lastSeq() === 0) {
    for (const item of historyForMessages.slice(-40)) {
      const role = item.role === 'assistant' ? 'assistant' : 'user';
      const content = String(item.content || '').trim();
      if (!content) continue;
      sessionLog.append(role === 'assistant' ? { type: 'assistant', content } : { type: 'user', content });
    }
  }

  // 新会话时：注入服务端保存的近期对话消息作为上下文
  if (isNewConversation && recentMessages.length > 0) {
    // 添加分隔说明，让 LLM 知道这是之前对话的上下文
    messages.push({ 
      role: 'assistant', 
      content: '[以下是您之前对话的最近消息，供参考]' 
    });
    for (const msg of recentMessages) {
      messages.push({ role: msg.role, content: msg.content });
    }
    messages.push({ 
      role: 'assistant', 
      content: '[以上是之前的对话记录，以下是您的新问题]' 
    });
  }
  
  let derivedOverflow = false;
  const derivedHistory = sessionLog.lastSeq() > 0
    ? (() => {
        const stats = sessionLog.deriveMessagesWithStats({ maxChars: 60_000 });
        derivedOverflow = stats.droppedChars > 0;
        return stats.messages.map(derived => ({
          role: derived.role,
          content: derived.content,
        }));
      })()
    : historyForMessages.slice(-5);
  for (const msg of derivedHistory) {
    messages.push({ role: msg.role, content: msg.content });
  }
  
  const anchoredUserMessage = buildAnchoredUserMessage(userMessage, {
    source: 'unified-chat-user',
    taskType
  });
  messages.push({ role: 'user', content: anchoredUserMessage });
  const anchorDiagnostics = getPromptAnchorDiagnostics(
    `${finalSystemPrompt}\n${anchoredUserMessage}`,
    userMessage
  );
  logger.info(`[UnifiedChat] Current request anchor: ${JSON.stringify(anchorDiagnostics)}`);
  
  // 13. 调用 LLM
  try {
    logger.debug(`[UnifiedChat] Calling API with key: ${maskApiKey(apiKey)}`);

    let response = await callChatCompletion(
      {
        apiUrl,
        apiKey,
        label: 'UnifiedChat',
        defaultModel: model,
      },
      {
        model,
        messages: messages as Message[],
        temperature: 0.7,
      }
    );
    
    // 14. 处理工具调用（草稿保存、句子检索等）
    response = await processToolCalls(response, userId, literaturePapers, {
      apiUrl,
      apiKey,
      model: secondaryModel || model,
      allowLiteratureRetrieval: queryIntent.needsLiteratureRetrieval,
    }, sessionLog);
    
    // 15. 更新对话历史
    const currentHistory = conversationHistories.get(userId) || [];
    currentHistory.push({ role: 'user', content: userMessage });
    currentHistory.push({ role: 'assistant', content: response });
    if (currentHistory.length > 20) {
      currentHistory.splice(0, currentHistory.length - 20);
    }
    conversationHistories.set(userId, currentHistory);
    
    // Phase 2：本轮写入追加式会话日志（前缀稳定，重连后历史一致）
    sessionLog.append({ type: 'user', content: userMessage });
    sessionLog.append({ type: 'assistant', content: response });

    // P0-2：回合结束后自动压缩最老历史（压力阈值触发；历史预算已丢消息时强制）。
    // fire-and-forget：总结失败只保留原历史，不影响本轮响应。
    void considerAutoCompaction({
      sessionLog,
      force: derivedOverflow,
      summarize: async (rangeText) => {
        const summarizeModel = secondaryModel || model;
        const summary = await callChatCompletion(
          {
            apiUrl,
            apiKey,
            label: 'UnifiedChatCompact',
            defaultModel: summarizeModel,
          },
          {
            model: summarizeModel,
            messages: [{ role: 'user', content: buildCompactionSummaryPrompt(rangeText) }],
            temperature: 0.2,
            maxTokens: 600,
          },
        );
        return String(summary || '').trim();
      },
    }).then(result => {
      if (result.compacted) logger.info(`[UnifiedChat] Auto-compaction: ${result.reason}`);
    }).catch(error => {
      logger.warn('[UnifiedChat] Auto-compaction failed:', error);
    });

    // 16. 异步持久化对话消息到服务端 + 更新对话摘要 + 更新记忆
    const conversationId = options?.conversationId || `conv-${Date.now()}`;
    const effectiveSecondaryModel = secondaryModel || 'gpt-4o-mini';  // fallback
    
    // 16.1 持久化对话消息到服务端（不依赖 localStorage）
    const allCurrentMessages = [
      ...currentHistory.map(h => ({ role: h.role, content: h.content }))
    ];
    saveConversationMessages(userId, conversationId, allCurrentMessages).catch(e => {
      logger.warn('[UnifiedChat] Failed to persist conversation messages:', e);
    });
    
    // 16.2 更新对话摘要（conversations 数组）
    updateConversationSummary(userId, conversationId, allCurrentMessages).catch(e => {
      logger.warn('[UnifiedChat] Failed to update conversation summary:', e);
    });
    
    // 16.3 异步更新记忆（带重试机制）
    updateMemoryWithRetry(userId, conversationId, userMessage, response, history, apiUrl, apiKey, effectiveSecondaryModel, 2);
    
    return {
      response,
      conversationId,
      metadata: {
        taskType,
        needWebSearch,
        literatureCount: literaturePapers.length
      }
    };
    
  } catch (error) {
    logger.error('[UnifiedChat] Error:', error);
    return {
      response: `抱歉，处理请求时出错: ${(error as Error).message}`,
      conversationId: options?.conversationId || `conv-${Date.now()}`
    };
  }
}

// ============ 辅助函数 ============

function parseLiteratureToStructured(content: string): LitPaper[] {
  // 简化版解析，实际应使用 local-server.ts 中的完整实现
  const papers: LitPaper[] = [];
  const entries = content.split(/\n\n+/);
  
  for (const entry of entries) {
    if (!entry.trim() || entry.length < 20) continue;
    
    const titleMatch = entry.match(/标题[：:]\s*([^\n]+)/i) || entry.match(/TI\s+(.+)/i);
    const authorMatch = entry.match(/作者[：:]\s*([^\n]+)/i) || entry.match(/AU\s+(.+)/i);
    const journalMatch = entry.match(/期刊[：:]\s*([^\n]+)/i) || entry.match(/SO\s+(.+)/i);
    const yearMatch = entry.match(/年份[：:]\s*(\d{4})/i) || entry.match(/PY\s+(\d{4})/i);
    const abstractMatch = entry.match(/摘要[：:]\s*([\s\S]+?)(?=\n\n|$)/i) || entry.match(/AB\s+(.+)/is);
    const keywordsMatch = entry.match(/关键词[：:]\s*([^\n]+)/i) || entry.match(/KW\s+(.+)/i);
    
    if (titleMatch) {
      papers.push({
        title: titleMatch[1].trim(),
        author: authorMatch?.[1]?.trim() || 'Unknown',
        journal: journalMatch?.[1]?.trim() || '',
        year: yearMatch?.[1]?.trim() || '',
        abstract: abstractMatch?.[1]?.trim() || '',
        keywords: keywordsMatch?.[1]?.trim() || ''
      });
    }
  }
  
  return papers;
}

function getReferencesForWriting(message: string, papers: LitPaper[], topK: number): { references: string } {
  // 简单的关键词匹配检索
  const keywords = message.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const scored = papers.map(paper => {
    const text = `${paper.title || ''} ${paper.abstract || ''} ${Array.isArray(paper.keywords) ? paper.keywords.join(' ') : (paper.keywords || '')}`.toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) score++;
    }
    return { paper, score };
  });
  
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, topK).filter(s => s.score > 0);
  
  if (top.length === 0) {
    return { references: '' };
  }
  
  let references = '\n## 【代码自动检索的参考文献】\n\n';
  top.forEach((item, idx) => {
    const author = item.paper.author.split(/[,;]/)[0]?.trim() || 'Unknown';
    const lastName = author.split(/\s+/).pop() || author;
    const citation = `(${lastName} et al., ${item.paper.year || 'n.d.'})`;
    
    references += `### ${idx + 1}. ${item.paper.title}\n`;
    references += `**引用格式**: ${citation}\n`;
    references += `**作者**: ${item.paper.author}\n`;
    references += `**期刊**: ${item.paper.journal} (${item.paper.year})\n`;
    if (item.paper.doi) references += `**DOI**: ${item.paper.doi}\n`;
    references += `**摘要**: ${item.paper.abstract?.substring(0, 300) || '无'}...\n\n`;
  });
  
  return { references };
}

function extractKeywords(sentence: string): string[] {
  const words = sentence
    .replace(/[，。,.!?！？;；:]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^(的|是|了|在|和|与|及|或|等|一个|这种|这个|that|the|and|or|is|are|was|were)$/i.test(w));
  
  const enKeywords = words.filter(w => /^[a-zA-Z]/.test(w));
  const cnKeywords = words.filter(w => /[\u4e00-\u9fa5]/.test(w));
  
  return [...cnKeywords, ...enKeywords.slice(0, 8)].slice(0, 10);
}

function detectChapterType(message: string, history?: ConversationHistoryItem[]): string | null {
  const messageLower = message.toLowerCase();
  
  const chapterPatterns: Record<string, RegExp[]> = {
    'introduction': [/引言|introduction|intro/i],
    'methods': [/方法|methods|methodology|材料/i],
    'results': [/结果|results/i],
    'discussion': [/讨论|discussion/i],
    'conclusion': [/结论|conclusion|总结/i],
    'abstract': [/摘要|abstract/i]
  };
  
  for (const [chapter, patterns] of Object.entries(chapterPatterns)) {
    for (const pattern of patterns) {
      if (pattern.test(messageLower)) {
        return chapter;
      }
    }
  }
  
  return null;
}

function loadWritingSkill(chapterType: string, skillDir: string): string {
  const skillMap: Record<string, string> = {
    'introduction': '03_introduction_skill.md',
    'methods': '04_methods_skill.md',
    'results': '05_results_skill.md',
    'discussion': '07_discussion_skill.md',
    'conclusion': '08_conclusion_skill.md',
    'abstract': '02_abstract_skill.md'
  };
  
  const skillFile = skillMap[chapterType.toLowerCase()];
  if (!skillFile) return '';
  
  const skillPath = path.join(skillDir, skillFile);
  if (!fs.existsSync(skillPath)) return '';
  
  try {
    return fs.readFileSync(skillPath, 'utf-8');
  } catch (e) {
    logger.warn(`[UnifiedChat] Failed to load skill: ${skillPath}`, e);
    return '';
  }
}

function loadMultipleSkills(skillTypes: string[], skillDir: string): string {
  const parts: string[] = [];
  
  for (const skillType of skillTypes) {
    const content = loadWritingSkill(skillType, skillDir);
    if (content) {
      parts.push(`### ${skillType.toUpperCase()}\n\n${content}`);
    }
  }
  
  return parts.join('\n\n---\n\n');
}

function buildSystemPrompt(options: {
  soulContent: string;
  memoryIntro: string;
  memoryContext: string;
  writingProgressContext: string;
  conversationHistoryContext: string;
  sessionStateContext: string;
  webSearchContext: string;
  taskHint: string;
}): string {
  const {
    soulContent,
    memoryIntro,
    memoryContext,
    writingProgressContext,
    conversationHistoryContext,
    sessionStateContext,
    webSearchContext,
    taskHint,
  } = options;

  return `你是一个专业的学术论文写作助手。${soulContent ? '\n' + soulContent : ''}
 ${memoryIntro}
 ${memoryContext}
 ${writingProgressContext}
 ${conversationHistoryContext}
 ${sessionStateContext}

## 你的能力
1. **用户自带文献**：用户会自行在对话中提供需要参考的文献内容
2. **联网搜索**：已配置 Tavily API，可以搜索互联网最新研究（仅用于背景信息，**不能用于参考文献**）
3. **写作指导**：结合用户提供材料、长期记忆进行回答
4. **跨会话长期记忆**：系统会自动提取对话中的重要信息并保存，下次对话时可以引用

## 🧠 长期记忆更新功能
系统会在对话结束后自动提取以下信息并保存到长期记忆：
- **experiment_summary** - 试验资料总结（研究背景、实验设计、方法、发现；如有试验地土壤物化生指标则保留，没有就留空）
- **data_summary** - 数据详细总结（实验数据、统计结果、图表信息）
- **writing_progress** - 写作进度（当前阶段、已完成章节）
- **paper_topic** - 论文主题
- **target_journal** - 目标期刊
- **key_findings** - 关键发现/结论
- **research_method** - 研究方法

**用户可以主动要求保存信息**：
当用户说"保存到试验资料总结"或"记录这个数据"时，你应该在回复末尾添加：
\`\`\`
🔧 调用工具：save_memory
key: experiment_summary 或 data_summary 等
value: [要保存的内容]
\`\`\`

例如用户说"把这个保存到试验资料总结"，你回复后添加：
\`\`\`
🔧 调用工具：save_memory
key: experiment_summary
value: 本研究探讨了干预A对目标结果的影响机制...
\`\`\`

${webSearchContext}
${taskHint}

## 回答要求
1. 回答必须有文献依据
2. **文内引用**：必须使用圆括号作者-年份格式，如 "(Zhang et al., 2026)"；必须写第一作者完整姓氏，禁止方括号、数字编号以及 M、EW、JQ 等首字母作者
3. **文末参考文献**：每条直接从完整作者信息开始，再列出年份、标题、期刊、卷期页码和 DOI；不得在条目前重复添加正文使用的圆括号作者-年份标签：
   - "全部作者. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx"
   - 示例："Smith, J., Jones, M., Brown, T. (2023). Intervention effects on target outcomes in applied research. Journal of Applied Research, 12(3), 101-115. DOI: 10.0000/example.2023.001"
4. 如果用户提供了文献，必须引用；不要编造引用
5. 使用专业的学术表达
6. 结构清晰，逻辑严密

${REFERENCE_RELEVANCE_WRITING_RULES}

## 📝 论文草稿功能
当用户说"保存到草稿"时，你必须在回复最后包含：

\`\`\`
🔧 调用工具：save_draft
content: |
[LaTeX 格式内容]
section: [章节名]
references: |
[参考文献完整列表]
- 全部作者. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx
- 示例：Smith, J., Jones, M., Brown, T. (2023). Intervention effects on target outcomes in applied research. Journal of Applied Research, 12(3), 101-115. DOI: 10.0000/example.2023.001
\`\`\`

**重要**：references 字段必须列出本章节引用的所有文献完整信息，包括作者、年份、标题、期刊、卷号、页码、DOI。
普通 save_draft 按增量内容处理：应用会将本轮新段落合并进已有章节，并把 References 保持在章节末尾，不会直接清空整章。

## 写作流程要求
不要一次性生成整个章节！采用渐进式写作：
1. 先询问写作重点
2. 建议章节结构，等用户确认
3. 分段写作，逐段确认`;
}

type ChatEvidenceRelation = 'supports' | 'contradicts' | 'related' | 'irrelevant' | 'unchecked';

interface ChatEvidenceJudgment {
  relation: ChatEvidenceRelation;
  confidence: number;
  reason: string;
  evidenceSnippets: string[];
  checked: boolean;
}

function normalizeChatEvidenceRelation(value: unknown): ChatEvidenceRelation {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'supports' || normalized === 'support' || normalized === 'supported') return 'supports';
  if (normalized === 'contradicts' || normalized === 'contradict' || normalized === 'opposes' || normalized === 'opposite') return 'contradicts';
  if (normalized === 'related' || normalized === 'partial' || normalized === 'partially_related') return 'related';
  if (normalized === 'irrelevant' || normalized === 'unrelated' || normalized === 'not_relevant') return 'irrelevant';
  return 'unchecked';
}

function buildUncheckedChatEvidenceJudgment(reason: string): ChatEvidenceJudgment {
  return {
    relation: 'unchecked',
    confidence: 0,
    reason,
    evidenceSnippets: [],
    checked: false,
  };
}

function cleanChatEvidenceText(value: unknown, limit = 1200): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

function parseChatEvidenceJsonItems(content: string): Array<Record<string, unknown>> {
  const jsonMatch = String(content || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as { items?: unknown };
  return Array.isArray(parsed.items)
    ? parsed.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function normalizeChatEvidenceSnippets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : (value ? [value] : []);
  const seen = new Set<string>();
  const snippets: string[] = [];
  for (const item of raw) {
    const clean = cleanChatEvidenceText(item, 500);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(clean);
    if (snippets.length >= 3) break;
  }
  return snippets;
}

function getChatEvidenceCandidateId(item: any, index: number): string {
  return String(item?.id || item?.doi || item?.title || `doc-${index + 1}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || `doc-${index + 1}`;
}

function getChatEvidencePriority(item: any): number {
  const relation = normalizeChatEvidenceRelation(item?.claimSupport?.relation);
  if (relation === 'supports') return 5;
  if (relation === 'related') return 3;
  if (relation === 'unchecked') return 2;
  if (relation === 'contradicts') return 1;
  return 0;
}

function rankChatEvidenceResults(items: any[], limit: number): any[] {
  return items
    .slice()
    .sort((a, b) => {
      const priorityDiff = getChatEvidencePriority(b) - getChatEvidencePriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      const confidenceDiff = Number(b?.claimSupport?.confidence || 0) - Number(a?.claimSupport?.confidence || 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return Number(b?.combinedScore || b?.score || 0) - Number(a?.combinedScore || a?.score || 0);
    })
    .slice(0, Math.max(1, Math.floor(limit || 1)));
}

async function judgeChatEvidenceForSentence(
  sentence: string,
  items: any[],
  config: { apiUrl: string; apiKey: string; model: string }
): Promise<any[]> {
  if (!items.length) return items;
  if (!config.apiUrl || !config.apiKey) {
    const unchecked = buildUncheckedChatEvidenceJudgment('未配置 LLM API，未执行证据支持判断。');
    return items.map(item => ({ ...item, claimSupport: unchecked }));
  }

  const candidates = items.map((item, index) => ({
    id: getChatEvidenceCandidateId(item, index),
    title: cleanChatEvidenceText(item?.title, 320),
    year: cleanChatEvidenceText(item?.year, 20),
    journal: cleanChatEvidenceText(item?.journal, 180),
    keywords: Array.isArray(item?.keywords)
      ? item.keywords.slice(0, 12).map((keyword: unknown) => cleanChatEvidenceText(keyword, 80)).filter(Boolean).join('; ')
      : cleanChatEvidenceText(item?.keywords, 320),
    abstract: cleanChatEvidenceText(item?.abstract, 1400),
  }));
  const candidateIds = new Set(candidates.map(candidate => candidate.id));

  const prompt = `你是通用科研证据匹配判别器。请判断每篇候选文献的题名、摘要、关键词是否能支持用户正在写作或检索的句子。

用户句子：
${sentence}

候选文献 JSON：
${JSON.stringify(candidates, null, 2)}

只允许根据候选文献的 title、abstract、keywords 判断，不要使用外部知识，不要预设学科领域，也不要补充候选文本中没有的信息。

relation 定义：
- supports：候选文献直接支持用户句子中的核心关系、方向或结论。
- contradicts：候选文献与用户句子的方向、关系或结论相反。
- related：候选文献主题相关，但不能直接支持该句，或方向/对象/结论不够明确。
- irrelevant：候选文献与该句基本无关。

输出严格 JSON，不要 markdown：
{"items":[{"id":"必须使用候选文献中的 id","relation":"supports|contradicts|related|irrelevant","confidence":0.0,"reason":"一句话说明为什么","evidenceSnippets":["从 title/abstract/keywords 中摘出的原文短句，不能编造"]}]}`;

  try {
    const content = await callChatCompletion(
      {
        apiUrl: config.apiUrl,
        apiKey: config.apiKey,
        label: 'UnifiedChat evidence support',
        defaultModel: config.model,
      },
      {
        model: config.model,
        messages: [
          {
            role: 'system',
            content: '你是严格的科研证据支持关系判别器。只输出 JSON；没有直接证据时必须标为 related 或 irrelevant，不能把主题相关误判为 supports。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0,
        maxTokens: 5000,
      }
    );
    const parsedItems = parseChatEvidenceJsonItems(content);
    const judgments = new Map<string, ChatEvidenceJudgment>();
    for (const parsed of parsedItems) {
      const id = cleanChatEvidenceText(parsed.id, 180);
      if (!candidateIds.has(id)) continue;
      const relation = normalizeChatEvidenceRelation(parsed.relation);
      judgments.set(id, {
        relation,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason: cleanChatEvidenceText(parsed.reason, 260) || '模型未提供判断理由。',
        evidenceSnippets: normalizeChatEvidenceSnippets(parsed.evidenceSnippets || parsed.evidence_snippets),
        checked: relation !== 'unchecked',
      });
    }
    return items.map((item, index) => {
      const candidate = candidates[index];
      return {
        ...item,
        claimSupport: judgments.get(candidate.id) || buildUncheckedChatEvidenceJudgment('证据支持判断未返回该候选文献。'),
      };
    });
  } catch (error) {
    logger.warn('[UnifiedChat] Evidence support judge failed, keeping retrieval order:', error);
    const unchecked = buildUncheckedChatEvidenceJudgment(`证据支持判断失败：${(error as Error).message}`);
    return items.map(item => ({ ...item, claimSupport: unchecked }));
  }
}

function formatChatEvidenceRelationForUser(support: ChatEvidenceJudgment | undefined): string {
  const relation = normalizeChatEvidenceRelation(support?.relation);
  const labels: Record<ChatEvidenceRelation, string> = {
    supports: '支持',
    contradicts: '反向',
    related: '仅相关',
    irrelevant: '无关',
    unchecked: '未核查',
  };
  return labels[relation] || labels.unchecked;
}

async function processToolCalls(
  response: string,
  userId: string,
  literaturePapers: LitPaper[],
  llmConfig: {
    apiUrl: string;
    apiKey: string;
    model: string;
    allowLiteratureRetrieval: boolean;
  },
  sessionLog?: SessionLog | null,
): Promise<string> {
  // 处理记忆保存（新增）
  const memorySaveMatch = response.match(/```[\s\S]*?🔧 调用工具：save_memory[\s\S]*?```/);
  if (memorySaveMatch) {
    const memoryBlock = memorySaveMatch[0];
    const keyMatch = memoryBlock.match(/key:\s*(\w+)/);
    const valueMatch = memoryBlock.match(/value:\s*\|?[\s\S]*?(?=```|$)/);
    
    if (keyMatch && valueMatch) {
      const key = keyMatch[1].trim();
      let value = valueMatch[0].replace(/value:\s*\|?\s*/, '').trim();
      value = value.replace(/```$/, '').trim();
      
      try {
        const memory = await loadUserMemory(userId);
        
        // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
        autoRestoreDeletedKeyIfEmpty(memory, key);
        
        // Bug fix: 检查该键是否已被用户删除
        if (isKeyDeleted(memory, key)) {
          logger.info(`[UnifiedChat] SKIP save_memory tool for "${key}" - user has deleted this key`);
          response = response.replace(memoryBlock, `\n⚠️ 无法保存：用户已删除该记忆项\n`);
        } else {
          const existingIndex = memory.entries.findIndex(e => e.key === key);
          const entry: MemoryEntry = {
            key,
            value,
            source: 'user-request',
            timestamp: new Date().toISOString()
          };
          
          if (existingIndex >= 0) {
            memory.entries[existingIndex] = entry;
          } else {
            memory.entries.push(entry);
          }
          
          await saveUserMemory(memory);
          response = response.replace(memoryBlock, `\n✅ 已保存到长期记忆：${key}\n`);
          logger.info(`[UnifiedChat] Memory saved via tool: ${key} for ${userId}`);
          sessionLog?.append({ type: 'tool', name: 'save_memory', output: `key=${key}`, ok: true });
        }
      } catch (e) {
        logger.error('[UnifiedChat] Failed to save memory via tool:', e);
        response = response.replace(memoryBlock, `\n⚠️ 记忆保存失败：${(e as Error).message}\n`);
        sessionLog?.append({ type: 'tool', name: 'save_memory', output: String((e as Error).message || '').slice(0, 1000), ok: false });
      }
    }
  }
  
  // 处理草稿保存
  const draftSaveParseResult = parseDraftSaveBlocks(response);
  if (sessionStore) {
    for (const draftBlock of draftSaveParseResult.blocks) {
      let draftContent = draftBlock.content;
      const rawSection = sanitizeDraftChapterName(draftBlock.section);
      const section = createDynamicDraftChapter(getCanonicalDraftSectionName(rawSection))?.key || '';
      let referencesContent = '';
      
      // 提取参考文献内容
      if (draftBlock.references) {
        const rawReferences = draftBlock.references;
        // 去重并添加字母标注
        referencesContent = deduplicateReferences(rawReferences);
        logger.info(`[UnifiedChat] Extracted references: ${referencesContent.length} chars (after dedup)`);
      }
      
      draftContent = normalizeAuthorYearCitationText(
        draftContent.replace(/^```/, '').replace(/```$/,'').trim()
      );
      
      // 将参考文献附加到内容末尾（如果有）
      const finalContent = referencesContent 
        ? `${draftContent}\n\n\\section*{References}\n${referencesContent}`
        : draftContent;

      if (!section) {
        logger.warn(`[UnifiedChat] AI requested an invalid top-level draft chapter: ${rawSection}`);
        response = response.replace(
          draftBlock.raw,
          `\n⚠️ 未保存草稿：${rawSection} 不是有效的顶级章节名称。\n`
        );
        sessionLog?.append({ type: 'tool', name: 'save_draft', output: `invalid-section=${rawSection}`, ok: false });
      } else try {
        const savedDraft = await sessionStore.updateDraft(userId, section, current => (
          mergeDraftChapterContent(current?.content || '', finalContent, 'merge')
        ));
        const contentToSave = savedDraft.content;
        if (onDraftSaved) {
          await onDraftSaved(userId, section, contentToSave);
        }
        const refsInfo = referencesContent ? '（含参考文献）' : '';
        response = response.replace(draftBlock.raw, `\n✅ 已保存到 ${section} 草稿 ${section}.txt${refsInfo}\n`);
        logger.info(`[UnifiedChat] Draft saved: ${section} for ${userId}${refsInfo}`);
        sessionLog?.append({ type: 'tool', name: 'save_draft', output: `section=${section}${refsInfo}`, ok: true });
      } catch (e) {
        logger.error('[UnifiedChat] Failed to save draft:', e);
        response = response.replace(draftBlock.raw, `\n⚠️ 草稿保存失败：${(e as Error).message}\n`);
        sessionLog?.append({ type: 'tool', name: 'save_draft', output: String((e as Error).message || '').slice(0, 1000), ok: false });
      }
    }
    if (draftSaveParseResult.markerCount > 0 && draftSaveParseResult.blocks.length === 0) {
      response += '\n\n⚠️ 未保存草稿：检测到 save_draft 标记，但 content 或 section 字段缺失。';
    }
  }
  
  // 处理句子检索
  const sentenceSearchMatch = response.match(/```[\s\S]*?🔧 调用工具：sentence_search(?!_single)\b[\s\S]*?```/);
  if (sentenceSearchMatch && !llmConfig.allowLiteratureRetrieval) {
    logger.warn('[UnifiedChat] Blocked sentence_search because verified Query Intent did not authorize literature retrieval');
    response = response.replace(
      sentenceSearchMatch[0],
      '\n[系统未执行文献检索：本轮经过校验的 Query Intent 未授权文献检索。]\n'
    );
    sessionLog?.append({ type: 'tool', name: 'sentence_search', ok: false, output: 'blocked-by-query-intent' });
  } else if (sentenceSearchMatch && retrievalEngine) {
    const searchBlock = sentenceSearchMatch[0];
    const sentencesMatch = searchBlock.match(/sentences:\s*([\s\S]*?)(?=```|$)/);
    
    if (sentencesMatch) {
      try {
        const sentencesText = sentencesMatch[1].trim();
        const sentences = sentencesText
          .split('\n')
          .map(s => s.trim().replace(/^-\s*/, '').replace(/^[""']|[""']$/g, ''))
          .filter(s => s.length > 0);
        
        if (sentences.length > 0) {
          logger.info(`[UnifiedChat] Sentence search for ${sentences.length} sentences`);
          
          const searchResults: Record<string, any[]> = {};
          for (const sentence of sentences) {
            const variants = buildBilingualRetrievalQueries({ sentence, keywordsEn: [sentence] });
            const groupedResults: any[][] = [];
            for (const variant of variants) {
              const queryResults = await retrievalEngine.retrieve({
                query: variant.query,
                topK: 20,
                searchMode: 'hybrid'
              });
              groupedResults.push(queryResults.results.map(result => ({
                ...result,
                retrievalPath: variant.label,
                retrievalLanguage: variant.language,
                retrievalQuery: variant.query,
              })));
            }

            const seen = new Set<string>();
            const selected: any[] = [];
            const sortedGroups = groupedResults
              .map(group => group.slice().sort((a, b) => Number(b.combinedScore || 0) - Number(a.combinedScore || 0)))
              .filter(group => group.length > 0);
            const maxLength = Math.max(0, ...sortedGroups.map(group => group.length));
            for (let index = 0; index < maxLength && selected.length < 10; index++) {
              for (const group of sortedGroups) {
                const item = group[index];
                if (!item) continue;
                const key = String(item.doi || item.title || item.id || '').toLowerCase();
                if (!key || seen.has(key)) continue;
                seen.add(key);
                selected.push(item);
                if (selected.length >= 10) break;
              }
            }
            const judged = await judgeChatEvidenceForSentence(sentence, selected, llmConfig);
            searchResults[sentence] = rankChatEvidenceResults(judged, 5);
          }
          
          let searchResultText = `\n\n## 逐句检索结果\n\n`;
          for (const [query, papers] of Object.entries(searchResults)) {
            searchResultText += `### 「${query}」\n`;
            if (papers.length === 0) {
              searchResultText += `*未找到相关文献*\n\n`;
            } else {
              papers.slice(0, 5).forEach((paper: any, idx: number) => {
                const support = paper.claimSupport as ChatEvidenceJudgment | undefined;
                const snippets = Array.isArray(support?.evidenceSnippets) ? support!.evidenceSnippets.slice(0, 2) : [];
                searchResultText += `${idx + 1}. **${paper.title}** (${paper.year})\n`;
                if (paper.retrievalPath) {
                  searchResultText += `   - ${paper.retrievalPath}: ${paper.retrievalQuery || ''}\n`;
                }
                searchResultText += `   - 证据关系: ${formatChatEvidenceRelationForUser(support)}${support?.confidence ? ` (${Math.round(support.confidence * 100)}%)` : ''}\n`;
                if (support?.reason) {
                  searchResultText += `   - 判断理由: ${support.reason}\n`;
                }
                if (snippets.length > 0) {
                  searchResultText += `   - 依据片段: ${snippets.join('；')}\n`;
                }
              });
            }
          }
          
          response = response.replace(sentenceSearchMatch[0], searchResultText);
          sessionLog?.append({
            type: 'tool',
            name: 'sentence_search',
            output: `${sentences.length} sentences, ${Object.keys(searchResults).length} result groups`,
            ok: true,
          });
        }
      } catch (e) {
        logger.error('[UnifiedChat] Sentence search failed:', e);
        sessionLog?.append({ type: 'tool', name: 'sentence_search', output: String((e as Error).message || '').slice(0, 1000), ok: false });
      }
    }
  }
  
  return response;
}

/**
 * 记录记忆更新失败，供后续对话提醒用户
 */
const memoryUpdateFailures = new Map<string, { count: number; lastError: string; timestamp: number }>();

export function recordMemoryUpdateFailure(userId: string, error: string): void {
  const existing = memoryUpdateFailures.get(userId);
  memoryUpdateFailures.set(userId, {
    count: (existing?.count || 0) + 1,
    lastError: error,
    timestamp: Date.now(),
  });
}

export function getAndClearMemoryUpdateFailure(userId: string): { count: number; lastError: string } | null {
  const failure = memoryUpdateFailures.get(userId);
  if (failure) {
    memoryUpdateFailures.delete(userId);
    return { count: failure.count, lastError: failure.lastError };
  }
  return null;
}

/**
 * 带重试机制的记忆更新
 * @param maxRetries 最大重试次数（默认 2）
 */
function updateMemoryWithRetry(
  userId: string,
  conversationId: string,
  userMessage: string,
  aiResponse: string,
  history: ConversationHistoryItem[],
  apiUrl: string,
  apiKey: string,
  secondaryModel: string,
  maxRetries: number = 2
): void {
  // 非阻塞执行，带重试
  (async () => {
    let lastError: string = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await updateMemoryWithAI(userId, conversationId, userMessage, aiResponse, history, apiUrl, apiKey, secondaryModel);
        return; // 成功，退出
      } catch (e) {
        lastError = (e as Error).message;
        if (attempt < maxRetries) {
          logger.warn(`[UnifiedChat] Memory update attempt ${attempt + 1} failed, retrying... Error: ${lastError}`);
          // 等待 1 秒后重试
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    // 所有重试都失败
    logger.error(`[UnifiedChat] Memory update failed after ${maxRetries + 1} attempts for ${userId}: ${lastError}`);
    recordMemoryUpdateFailure(userId, lastError);
  })();
}

async function updateMemoryWithAI(
  userId: string,
  _conversationId: string,
  userMessage: string,
  aiResponse: string,
  history: ConversationHistoryItem[],
  apiUrl: string,
  apiKey: string,
  secondaryModel: string
): Promise<void> {
  logger.info(`[UnifiedChat] Memory update for ${userId} (using SecondaryAgent model: ${secondaryModel})`);
  
  await withMemoryLock(userId, async () => {
    const memory = await loadUserMemory(userId);
    
    // 构建完整对话内容用于 AI 提取
    const fullConversation = history.slice(-10).map(h => `${h.role}: ${h.content}`).join('\n') + 
      `\nuser: ${userMessage}\nassistant: ${aiResponse}`;
    
    // 使用 AI 智能提取记忆信息（小牛马配置的模型）
    const extractedInfo = await extractMemoryWithAI(
      fullConversation,
      apiUrl,
      apiKey,
      secondaryModel
    );
    
    // 提取对话关键主题（用于 conversation summary）
    const extractedTopics = Object.keys(extractedInfo).filter(
      k => extractedInfo[k] && extractedInfo[k].trim() !== '无' && extractedInfo[k].trim() !== '未提及'
    );
    
    // 更新对话摘要的 keyTopics
    if (extractedTopics.length > 0 && _conversationId) {
      try {
        const convSummary = memory.conversations.find(c => c.id === _conversationId);
        if (convSummary) {
          convSummary.keyTopics = [...new Set([...convSummary.keyTopics, ...extractedTopics])];
        }
      } catch (e) {
        logger.warn('[UnifiedChat] Failed to update conversation keyTopics:', e);
      }
    }
    
    // 增量更新记忆条目（合并而非覆盖）
    const updatedKeys: string[] = [];
    for (const [key, value] of Object.entries(extractedInfo)) {
      // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
      autoRestoreDeletedKeyIfEmpty(memory, key);
      
      // Bug fix: 检查该键是否已被用户删除，如果是则跳过写入
      if (isKeyDeleted(memory, key)) {
        logger.info(`[UnifiedChat] SKIP "${key}" - user has deleted this key (protected from auto-restore)`);
        continue;
      }
      
      if (value && value.trim() && value.trim() !== '无' && value.trim() !== '未提及') {
        const existingIndex = memory.entries.findIndex(e => e.key === key);
        const existing = existingIndex >= 0 ? memory.entries[existingIndex] : null;
        
        // 增量合并：检查是否已有相同内容，避免重复
        let mergedValue = value.trim();
        if (existing && existing.value) {
          // 对于长文本字段（experiment_summary, data_summary），增量追加
          if (['experiment_summary', 'experiment_summary_structured', 'data_summary', 'data_summary_structured', 'key_findings'].includes(key)) {
            // Bug #3 修复统一：使用 isDuplicateContent 替代简单 includes
            if (!isDuplicateContent(existing.value, value.trim())) {
              // 增量追加：新内容追加到旧内容后面，用换行分隔
              mergedValue = existing.value + '\n\n---\n\n' + value.trim();
              logger.info(`[UnifiedChat] Incremental merge for ${key}: +${value.length} chars`);
            } else {
              // 内容已存在，跳过
              logger.info(`[UnifiedChat] Skip duplicate content for ${key}`);
              continue;
            }
          } else {
            // 状态类字段（writing_progress等），直接更新（不追加）
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
          memory.entries[existingIndex] = entry;
        } else {
          memory.entries.push(entry);
        }
        updatedKeys.push(key);
        logger.info(`[UnifiedChat] Updated memory key: ${key}`);
      }
    }
    
    // 保存 memory.json
    if (updatedKeys.length > 0) {
      await saveUserMemory(memory);
      logger.info(`[UnifiedChat] Saved ${updatedKeys.length} memory entries for ${userId}: ${updatedKeys.join(', ')}`);
      
      // 同时写入具体文件（试验资料总结.txt、数据详细总结.txt）
      await saveMemoryToFiles(userId, memory);
      
      // Bug #5 修复补充：触发结构化总结生成（后台异步执行，不阻塞主流程）
      if (updatedKeys.includes('experiment_summary') || updatedKeys.includes('data_summary')) {
        generateStructuredSummaries(userId, memory.entries, apiUrl, apiKey, secondaryModel).catch(e => {
          logger.warn('[UnifiedChat] Failed to generate structured summaries:', e);
        });
        logger.info(`[UnifiedChat] Triggered structured summary generation (SecondaryAgent model: ${secondaryModel})`);
      }
    }
  });
}

/**
 * 使用 AI 从对话中提取记忆信息（使用小牛马配置的模型）
 */
async function extractMemoryWithAI(
  conversation: string,
  apiUrl: string,
  apiKey: string,
  secondaryModel: string
): Promise<Record<string, string>> {
  const extracted: Record<string, string> = {};
  
  if (!apiUrl || !apiKey) {
    logger.warn('[UnifiedChat] No API configured for memory extraction');
    return extracted;
  }
  
  // 使用用户配置的小牛马模型（不再写死）
  const model = secondaryModel || 'gpt-4o-mini';  // fallback 到轻量级模型
  
  const prompt = `你是一个信息提取助手（小牛马）。请从以下对话中提取关键信息，用于更新用户画像。

## 需要提取的字段（根据对话内容选择性提取）

1. **experiment_summary** - 试验资料总结：研究背景、实验设计、实验方法、主要发现、环境/样本/系统基础指标等（用户提供了研究材料时提取；相关基础指标有就填，没有就留空）
2. **experiment_summary_structured** - 试验资料总结（结构化）：AI整理的结构化实验信息，必须保留用户提供的环境、样本、材料、系统、设备、参数、物理/化学/生物/人口学/技术指标等基础信息；没有就留空
3. **data_summary** - 数据详细总结：实验数据、统计结果、图表信息等（用户提供了数据时提取）
4. **data_summary_structured** - 数据详细总结（结构化）：AI整理的结构化数据信息
5. **writing_progress** - 写作整体进度（如"引言撰写中"、"讨论已完成"等）
6. **completed_chapters** - 已完成的章节列表
7. **pending_chapters** - 待完成的章节列表
8. **paper_topic** - 论文主题（如果用户明确提及）
9. **target_journal** - 目标期刊（如果用户明确提及）
10. **key_findings** - 关键发现/研究结论
11. **research_method** - 研究方法

## 对话内容

${conversation}

## 输出格式
只返回 JSON 格式，例如：
{
  "experiment_summary": "本研究探讨了...",
  "writing_progress": "引言已完成，正在写方法部分",
  "paper_topic": "干预A对目标结果的影响机制"
}

如果没有相关信息，**不要编造**，直接省略该字段或填"未提及"。

只返回 JSON，不要有其他文字。`;

  try {
    const content = await callChatCompletion(
      {
        apiUrl,
        apiKey,
        label: 'UnifiedChatMemoryExtraction',
        defaultModel: secondaryModel,
      },
      {
        model: secondaryModel,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3
      }
    );

    // 解析 JSON
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        Object.assign(extracted, parsed);
        logger.info('[UnifiedChat] AI memory extraction successful:', Object.keys(parsed));
      }
    } catch (e) {
      logger.warn('[UnifiedChat] Failed to parse AI extraction response:', content.substring(0, 200));
    }
  } catch (e) {
    logger.warn('[UnifiedChat] Memory extraction error:', e);
  }
  
  return extracted;
}

// 导出对话历史管理函数
export function getConversationHistory(userId: string): ConversationHistoryItem[] {
  return conversationHistories.get(userId) || [];
}

export function setConversationHistory(userId: string, history: ConversationHistoryItem[]): void {
  conversationHistories.set(userId, history);
}

export function clearConversationHistory(userId: string): void {
  conversationHistories.delete(userId);
}
