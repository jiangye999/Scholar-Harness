// 仅在开发环境加载 .env 文件
// Electron 打包时会设置 ELECTRON_RUN_AS_NODE 环境变量，此时跳过 dotenv
// 生产环境通过系统环境变量配置 API_URL、API_KEY 等
if (process.env.NODE_ENV !== 'production' && !process.env.ELECTRON_RUN_AS_NODE) {
  try {
    require('dotenv/config');
  } catch (e) {
    // dotenv 模块不存在时忽略（打包后的环境）
  }
}
import express, { Request, Response, Express, NextFunction } from "express";
import * as https from "https";
import * as http from "http";
import { spawn } from "child_process";
import { logger } from "../utils/logger";
import { callChatCompletion, createLLMApiClient } from "../utils/llm-client";
import { sendWordDraftDocx } from "../utils/word-draft-docx";
import {
  PROJECT_WRITING_PROFILES,
  getProjectWritingProfile,
  normalizeProjectWritingProfileId,
  type ProjectWritingProfile,
  type ProjectWritingProfileId,
} from "../config/project-writing-profiles";
import { AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL, AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING } from "../config/auto-research-paper-topic-skill";
import {
  REFERENCE_RELEVANCE_AUDIT_RULES,
  REFERENCE_RELEVANCE_WRITING_RULES,
} from "../config/reference-relevance-constraint-skill";
import { DOING_META_GUIDE_KNOWLEDGE, DOING_META_GUIDE_SOURCE } from "../config/doing-meta-guide-knowledge";
import { CloudPromptClient } from "../utils/cloud-prompt-client";
import {
  anchorPromptWithCurrentRequest,
  buildAnchoredUserMessage,
  getPromptAnchorDiagnostics,
} from "../utils/prompt-request-anchor";
import { SessionStore, sanitizeDraftChapterName } from "../storage/session-store";
import { BackupManager } from "../utils/backup-manager";
import { ProjectManager } from "../utils/project-manager";
import { AutoResearchManager } from "../utils/autoresearch-manager";
import { PdfWikiManager, type PdfWikiEntry, type PdfWikiReference, type PdfWikiSentencePoint, type PdfWikiSourcePdf, type PdfWikiStore, type PdfWikiViewpoint } from "../utils/pdf-wiki-manager";
import { getLibraryFavoriteSet, removeLibraryFavorites, toggleLibraryFavorite } from "../utils/library-favorites";
import {
  assignPdfWikiPdfGroup,
  assignPdfWikiPdfGroups,
  createPdfWikiPdfGroup,
  deletePdfWikiPdfGroup,
  loadPdfWikiPdfManagement,
  renamePdfWikiPdfGroup,
  removePdfWikiPdfAssignments,
} from "../utils/pdf-wiki-pdf-management";
import {
  getDataDir,
  getUploadDir,
  getSessionDir,
  getMemoryDir,
  getUserUploadDir,
  getIndexCacheDir,
  getUserLiteraturePath,
  getUserLiteratureTxtPath,
  sanitizeUserId,
} from "../utils/paths";
import { detectPdfFastTextStatus, isPdfFastTextAvailable } from "../utils/pdf-fast-text";
import { extractPdfTextWithLiteParse, isLiteParseAvailable } from "../utils/pdf-liteparse";
import { isPdfMarkerAvailable } from "../utils/pdf-marker";
import { decrypt } from "../utils/encryption";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import * as crypto from "crypto";
import multer from "multer";
import archiver from "archiver";
import type { ChatOptions, Message } from "../types";
import type { UnifiedLiterature } from "../types/literature";
import { ConversationFlow } from "../../workflows/conversation-flow";
import { HybridRetrievalEngine } from "../literature/retrieval";
import { setRetrievalEngine } from "./routes/literature";
import chatBridgeRoutes, { initializeChatBridgeRoutes } from "./routes/chat-bridge";
import memoryRoutes, {
  loadUserMemory,
  saveUserMemory,
  saveMemoryToFiles,
  // Bug #5 修复补充：从 memory.ts 导入（避免循环依赖）
  extractKeyContent,
  generateStructuredSummaries,
  // Bug fix: 导入已删除键检查函数
  isKeyDeleted,
  autoRestoreDeletedKeyIfEmpty,
  removeFromDeletedKeys,
  applyUserScopedMemoryGuards,
  getStructuredPreferredMemoryEntries,
} from "./routes/memory";
import unifiedChatRoutes, { initializeUnifiedChatRoutes } from "./routes/unified-chat";
import userSkillsRoutes from "./routes/user-skills";
import experimentResultsRoutes from "./routes/experiment-results";
import rCodeRoutes from "./routes/r-code";
import dataAnalysisRoutes from "./routes/data-analysis";
import { createDraftAssetsRouter, loadDraftFigureAssetsForUser } from "./routes/draft-assets";
import ocrRoutes from "./routes/ocr";
import pptMasterRoutes from "./routes/ppt-master";
import pdfMarkerRoutes from "./routes/pdf-marker";
import pdfFastTextRoutes from "./routes/pdf-fast-text";
import {
  createMetaAnalysisRouter,
  type MetaAnalysisAssistantInput,
  type MetaAnalysisAssistantResult,
} from "./routes/meta-analysis";
import academicResearchRoutes from "./routes/academic-research";
import projectMemoryRoutes from "./routes/project-memory";
import { createResearchSessionRouter } from "./routes/research-session";
import {
  createBibliometricsRouter,
  importBibliometricPlainTextForUser,
  isWosBibliometricPlainText,
} from "./routes/bibliometrics";
import { createAutoResearchRouter } from "./routes/autoresearch";
import {
  runAcademicResearchSkill,
  type AcademicResearchMode,
  type AcademicResearchRunResult,
} from "./services/academic-research-skills";
import { BUILT_IN_OA_DOWNLOAD_SOURCE_LABEL, createEmbeddingLibraryRouter, downloadInstitutionalPaperByDoi, downloadOpenAccessPaperByDoi, parseDownloadConcurrency, runConcurrent } from "./routes/embedding-library";
import { chatBridge } from "../bridge/chat-bridge/chat-bridge";
import { parseUserSkillInvocation } from "./services/user-skills";
import { AgentCollaborationWorkflow } from "../../agents/agent-collaboration-workflow";
import { CowAgent, type CowAgentResult } from "../../agents/cow-agent";
import { 
  initializeUnifiedChatProcessor, 
  processUnifiedChatMessage,
  type ChatProcessorConfig 
} from "./unified-chat-processor";
// 导入统一的文献处理工具（解决 C1, D1, D2 问题）
import {
  generateLiteratureId,
  parseAuthorsToString as unifiedParseAuthors,
  authorsToString,
  parseKeywords,
  inferSourceType,
  normalizeLiterature,
} from "../utils/literature-helpers";
import {
  buildBilingualRetrievalQueries,
  formatRetrievalQueryVariants,
  type RetrievalQueryVariant,
} from "../literature/retrieval/semantic-query";
// 导入多用户检索引擎管理器（解决 C5 问题）
import {
  RetrievalEngineManager,
  initRetrievalEngineManager,
  getRetrievalEngineManager,
} from "../utils/retrieval-engine-manager";
import {
  researchSessionManager,
  type ResearchSourceReference,
} from "../research/research-session-manager";
import {
  expandCitations,
  searchOpenAlex,
  stylePass,
  verifyDois,
  type CitationExpansionResult,
  type DoiVerificationResult,
  type OpenAlexWorkHit,
} from "../research/literature-review-tools";
// 导入统一的解析器工厂（解决 C3 问题）
import { ParserFactory } from "../literature/parsers";
import {
  manualMergeKeywords,
  sanitizeOuterTagsConfig,
  type LiteratureRecord,
  type OuterTagsConfig,
} from "../literature/keyword-library";
// 导入认证守卫（用户认证与订阅验证）
import { createAuthGuard, authGuardMiddleware } from "./auth-guard";
// Bug 修复：导入 authGuard 单例初始化函数
import { initAuthGuardSingleton } from "./auth-guard-singleton";

// 使用统一的路径管理模块获取数据目录
const dataDir = getDataDir();
const publicDir = process.env.PUBLIC_DIR || path.resolve(__dirname, "..", "public");
logger.info('[Server] Public dir:', publicDir);
logger.info('[Server] Checking index.html:', path.join(publicDir, 'index.html'));
logger.info('[Server] index.html exists:', fs.existsSync(path.join(publicDir, 'index.html')));

// 使用统一的路径管理模块获取各目录
const uploadDir = getUploadDir();
const sessionStore = new SessionStore(getSessionDir());
const memoryDir = getMemoryDir();

const backupManager = new BackupManager(dataDir, 10);
const projectManager = new ProjectManager(dataDir);
const pdfWikiManager = new PdfWikiManager(dataDir);
const autoResearchManager = new AutoResearchManager(dataDir);
researchSessionManager.setProjectContextProvider(() => ({
  projectId: projectManager.getCurrentProject().projectId || "current-workspace",
}));
backupManager.initialize().catch(err => {
  logger.error('[Server] Failed to initialize backup manager:', err);
});

function getSkillDir(): string {
  // 优先使用环境变量
  if (process.env.SKILL_DIR) {
    return process.env.SKILL_DIR;
  }
  
  // pkg 打包模式
  const isPkg = !!(process as any).pkg;
  if (isPkg) {
    return path.join(path.dirname(process.execPath), 'sci_writing_skills');
  }
  
  // Electron 打包模式
  if (process.env.ELECTRON_RUN_AS_NODE || (process as any).resourcesPath) {
    return path.join(path.dirname(process.execPath), 'sci_writing_skills');
  }
  
  // 开发模式：使用项目根目录
  // __dirname 在编译后是 dist/src/server，需要往上走三层才能到项目根目录
  const projectRoot = path.resolve(__dirname, "..", "..", "..");
  return path.join(projectRoot, "sci_writing_skills");
}

const skillDir = getSkillDir();
if (!fs.existsSync(skillDir)) {
  logger.warn("[Skill] Writing skill directory not found:", skillDir);
} else {
  logger.info("[Skill] Writing skills loaded from:", skillDir);
}

interface MemoryEntry {
  key: string;
  value: string;
  source: string;
  timestamp: string;
}

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
}

interface Conversation {
  id: string;
  userId: string;
  messages: ConversationMessage[];
  summary: string;
  keyTopics: string[];
  createdAt: string;
  updatedAt: string;
}

interface ConversationSummary {
  id: string;
  title: string;
  summary: string;
  keyTopics: string[];
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

interface UserMemory {
  userId: string;
  entries: MemoryEntry[];
  conversations: ConversationSummary[];
  updatedAt: string;
}

// 逐句撰写状态
interface SentenceWritingState {
  chapter: string;           // 当前章节
  totalSentences: number;    // 总句数
  currentSentence: number;   // 当前句子索引（从1开始）
  sentences: Array<{
    id: string;              // S1, S2, S3...
    content?: string;        // 撰写内容
    searchQuery?: string;    // 检索词
    citations?: string[];    // 引用的文献
    status: 'pending' | 'searching' | 'writing' | 'completed';
  }>;
  updatedAt: string;
}

// 存储逐句撰写状态
const sentenceWritingStates = new Map<string, SentenceWritingState>();

// Embedding 进度状态
interface EmbeddingProgress {
  status: 'idle' | 'processing' | 'completed' | 'error';
  total: number;
  processed: number;
  currentBatch: number;
  totalBatches: number;
  message: string;
  startTime?: number;
  endTime?: number;
}
let embeddingProgress: EmbeddingProgress = {
  status: 'idle',
  total: 0,
  processed: 0,
  currentBatch: 0,
  totalBatches: 0,
  message: ''
};

// APIClient 实现
function createAPIClient(apiUrl: string, apiKey: string) {
  return createLLMApiClient({
    apiUrl,
    apiKey,
    defaultTemperature: 0.7,
    label: "LocalServer",
  });
}

function extractKeywords(sentence: string): string[] {
  const words = sentence
    .replace(/[，。,.!?！？;；:]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !/^(的 | 是 | 了 | 在 | 和 | 与 | 及 | 或 | 等 | 一个 | 这种 | 这个|that|the|and|or|is|are|was|were)$/i.test(w));
  
  const enKeywords = words.filter(w => /^[a-zA-Z]/.test(w));
  const cnKeywords = words.filter(w => /[\u4e00-\u9fa5]/.test(w));
  
  const result = [...cnKeywords, ...enKeywords.slice(0, 8)];
  return result.slice(0, 10);
}

/**
 * 计算两个文本的相似度（用于草稿重复检测）
 * 使用词频向量计算余弦相似度
 * @param text1 第一个文本
 * @param text2 第二个文本
 * @returns 相似度分数（0-1之间）
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1;
  
  // 提取关键词并转换为词频向量
  const keywords1 = extractKeywords(text1);
  const keywords2 = extractKeywords(text2);
  
  // 合并所有关键词作为词表
  const allKeywords = new Set([...keywords1, ...keywords2]);
  if (allKeywords.size === 0) return 0;
  
  // 计算词频向量
  const freq1: Record<string, number> = {};
  const freq2: Record<string, number> = {};
  
  for (const kw of keywords1) {
    freq1[kw] = (freq1[kw] || 0) + 1;
  }
  for (const kw of keywords2) {
    freq2[kw] = (freq2[kw] || 0) + 1;
  }
  
  // 计算余弦相似度
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;
  
  for (const kw of allKeywords) {
    const v1 = freq1[kw] || 0;
    const v2 = freq2[kw] || 0;
    dotProduct += v1 * v2;
    norm1 += v1 * v1;
    norm2 += v2 * v2;
  }
  
  if (norm1 === 0 || norm2 === 0) return 0;
  
  const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  
  // 同时计算长度相似度（防止长度差异大的文本被误判）
  const len1 = text1.length;
  const len2 = text2.length;
  const lengthSimilarity = Math.min(len1, len2) / Math.max(len1, len2);
  
  // 综合相似度：70% 内容相似度 + 30% 长度相似度
  const combinedSimilarity = 0.7 * similarity + 0.3 * lengthSimilarity;
  
  return combinedSimilarity;
}

/**
 * 检测草稿是否需要用户确认
 * @param existingContent 已有内容
 * @param newContent 新内容
 * @param threshold 相似度阈值（默认0.6）
 * @returns 是否需要确认 + 相似度信息
 */
function detectDraftDuplicate(
  existingContent: string, 
  newContent: string, 
  threshold: number = 0.6
): { needsConfirmation: boolean; similarity: number; reason: string } {
  const similarity = calculateTextSimilarity(existingContent, newContent);
  
  if (similarity >= threshold) {
    return {
      needsConfirmation: true,
      similarity,
      reason: `检测到内容高度相似（${Math.round(similarity * 100)}%），可能是同一章节的更新版本`
    };
  }
  
  // 检查是否包含相同的章节标题（另一个重复信号）
  const sectionPattern = /\\section\{|##\s+/;
  const existingSections = existingContent.match(sectionPattern);
  const newSections = newContent.match(sectionPattern);
  
  if (existingSections && newSections && similarity > 0.3) {
    return {
      needsConfirmation: true,
      similarity,
      reason: `检测到相同的章节结构，可能是同一章节的内容`
    };
  }
  
  return {
    needsConfirmation: false,
    similarity,
    reason: `内容差异较大（相似度 ${Math.round(similarity * 100)}%），建议增量追加`
  };
}

function getMemoryFile(userId: string): string {
  const userMemoryDir = path.join(memoryDir, userId);
  if (!fs.existsSync(userMemoryDir)) {
    fs.mkdirSync(userMemoryDir, { recursive: true });
  }
  return path.join(userMemoryDir, "memory.json");
}

function getConversationFile(userId: string, conversationId: string): string {
  const conversationsDir = path.join(memoryDir, userId, "conversations");
  if (!fs.existsSync(conversationsDir)) {
    fs.mkdirSync(conversationsDir, { recursive: true });
  }
  return path.join(conversationsDir, `${conversationId}.json`);
}

// loadUserMemory、saveUserMemory、saveMemoryToFiles 已从 routes/memory.ts 导入
// 避免重复定义，直接使用导入的函数

function loadConversation(userId: string, conversationId: string): Conversation | null {
  const conversationFile = getConversationFile(userId, conversationId);
  if (fs.existsSync(conversationFile)) {
    try {
      return JSON.parse(fs.readFileSync(conversationFile, 'utf-8'));
    } catch (e) {
      logger.warn("[Memory] Failed to load conversation:", e);
    }
  }
  return null;
}

function saveConversation(conversation: Conversation): void {
  const conversationFile = getConversationFile(conversation.userId, conversation.id);
  conversation.updatedAt = new Date().toISOString();
  fs.writeFileSync(conversationFile, JSON.stringify(conversation, null, 2), 'utf-8');
}

async function searchConversations(userId: string, query: string): Promise<ConversationSummary[]> {
  const memory = await loadUserMemory(userId);
  const queryLower = query.toLowerCase();
  
  return memory.conversations.filter(conv => {
    if (conv.title.toLowerCase().includes(queryLower)) return true;
    if (conv.summary.toLowerCase().includes(queryLower)) return true;
    if (conv.keyTopics.some((topic: string) => topic.toLowerCase().includes(queryLower))) return true;
    return false;
  });
}

function extractKeyInfo(userMessage: string, aiResponse: string, history: Array<{ role: string; content: string }>): MemoryEntry[] {
  const entries: MemoryEntry[] = [];
  
  const combinedText = `用户问题: ${userMessage}\n\nAI回复: ${aiResponse}`;
  
  const yearMatch = combinedText.match(/(20\d{2})/g);
  if (yearMatch) {
    const years = [...new Set(yearMatch)];
    entries.push({
      key: "years_mentioned",
      value: years.join(", "),
      source: "auto-extracted",
      timestamp: new Date().toISOString()
    });
  }
  
  const journalMatch = combinedText.match(/期刊[:\s]+([^，。,\n]+)/g);
  if (journalMatch) {
    const journals = [...new Set(journalMatch.map(m => m.replace(/期刊[:\s]+/, '').trim()))];
    entries.push({
      key: "journals_mentioned",
      value: journals.join(", "),
      source: "auto-extracted",
      timestamp: new Date().toISOString()
    });
  }
  
  const topicMatch = userMessage.match(/(?:关于|研究|探讨|分析)([^，。,\n]+)/);
  if (topicMatch) {
    entries.push({
      key: "research_topic",
      value: topicMatch[1].trim(),
      source: "user-message",
      timestamp: new Date().toISOString()
    });
  }
  
  return entries;
}

async function updateMemoryWithAI(userId: string, conversationId: string, userMessage: string, aiResponse: string, history: Array<{ role: string; content: string }>, apiUrl: string, apiKey: string, model: string): Promise<void> {
  const memory = await loadUserMemory(userId);
  const currentWritingProfile = getProjectWritingProfile(projectManager.getCurrentProject().writingProfileId);
  const isPaperLikeProfile = currentWritingProfile.id === 'paper-writing' || currentWritingProfile.id === 'thesis-writing';
  const materialSummaryLabel = isPaperLikeProfile
    ? '实验资料总结'
    : `${currentWritingProfile.shortLabel}资料总结`;
  const resultSummaryLabel = isPaperLikeProfile
    ? '数据详细总结'
    : `${currentWritingProfile.shortLabel}要点总结`;
  
  // 获取现有的记忆内容（用于智能合并）
  const existingExperimentSummary = memory.entries.find(e => e.key === 'experiment_summary')?.value || '';
  const existingDataSummary = memory.entries.find(e => e.key === 'data_summary')?.value || '';
  const existingWritingProgress = memory.entries.find(e => e.key === 'writing_progress')?.value || '';
  const existingCompletedChapters = memory.entries.find(e => e.key === 'completed_chapters')?.value || '';
  
  const extractPrompt = `请分析以下对话，提取关键研究信息和写作进度。

【用户消息】
${userMessage.substring(0, 1500)}

【AI 回复】
${aiResponse.substring(0, 2500)}

【输出格式 - 请严格按以下格式返回】
研究主题：[一句话概括]
目标期刊：[期刊名称]
关键概念：[关键词 1, 关键词 2]
重要发现：[发现 1；发现 2]
实验设计：[设计概述]
数据状态：[有/无]
用户偏好：[特殊要求]
实验资料总结：[作为“${materialSummaryLabel}”使用；从对话中提取与当前项目主题“${currentWritingProfile.label}”相关的背景、目的、约束、材料来源、方法/方案、结果/结论/需求等信息，写成一段话；论文写作项目如包含试验地土壤物理、化学、生物指标则必须保留；非论文项目不要硬套实验术语]
数据详细总结：[作为“${resultSummaryLabel}”使用；从对话中提取所有数据、统计结果、市场/技术/评审/功能/商业要点、对比分析和关键发现等，写成一段话]
写作进度：[描述当前写作进展，如"已完成引言和方法，正在写结果部分"或"尚未开始写作"]
已完成章节：[列出已完成的章节名称及其核心内容摘要，每个章节 50 字以内，用分号分隔]
待完成章节：[列出待完成的章节名称及写作重点，用分号分隔]

【重要】
- ${materialSummaryLabel}和${resultSummaryLabel}必须填写；内部字段名仍使用“实验资料总结/数据详细总结”，但内容必须符合当前项目主题“${currentWritingProfile.label}”
- 研究主题、目标期刊、写作进度、已完成章节、待完成章节：只能从“用户消息”中明确表达的内容提取；AI 回复中的建议、评价、计划、示例和标题标签不能写入这些字段
- 已完成章节只能填写完整章节名称，不要把“前两段内容/第三段建议/结构安排”等段落级内容当作已完成章节
- 如果用户没有明确设置这些状态类字段，填"无"
- 直接写成连贯的文字段落，不要分点
- 保留所有具体数值
- 论文写作项目中试验地土壤物化生指标有则填写，没有就留空；其他项目不要编造实验指标或科研数据`;

  // 智能合并提示词：用于将新提取的内容与现有记忆合并
  const mergePrompt = (existingMemory: string, newExtract: string, fieldName: string) => {
    return `你是一个研究数据管理助手。你的任务是将新对话中提取的信息与现有的记忆进行智能合并。

## 现有记忆
${existingMemory ? existingMemory : '（暂无现有记忆）'}

## 新对话中提取的信息
${newExtract}

## 你的任务
请将上述两部分信息合并成一个完整、简洁的"${fieldName}"。

## 合并原则
1. **去重**：如果新信息与现有记忆重复，保留一份即可，不要重复
2. **补充**：如果新信息是现有记忆的补充（新的实验细节、新的数据等），将其自然融入到现有内容中
3. **更新**：如果新信息与现有记忆冲突（如修正了之前的数据），以新信息为准
4. **简洁**：合并后的内容应该简洁连贯，不要有冗余的过渡语句
5. **完整**：确保所有重要信息都被保留，形成一个完整的${fieldName}

## 输出要求
- 输出一个连贯的文字段落
- 不要使用"新增"、"补充"、"更新"等过渡词
- 直接输出合并后的完整内容，不要解释
- 保留所有具体数值和关键细节

## 输出格式
直接输出合并后的完整${fieldName}内容，不要有其他文字。`;
  };
  
  // 写作进度合并提示词
  const mergeWritingProgressPrompt = (existingProgress: string, newProgress: string) => {
    return `你是一个写作进度管理助手。请合并以下写作进度信息：

## 现有进度
${existingProgress}

## 新进度
${newProgress}

## 合并要求
1. 如果有新完成的章节，更新进度
2. 保持简洁，只描述当前整体进展状态
3. 不要重复信息
4. 输出一个连贯的进度描述

直接输出合并后的写作进度，不要其他文字。`;
  };
  
  // 已完成章节合并提示词
  const mergeChaptersPrompt = (existingChapters: string, newChapters: string) => {
    return `你是一个论文章节管理助手。请合并以下已完成章节信息：

## 现有已完成章节
${existingChapters}

## 新增已完成章节
${newChapters}

## 合并要求
1. 去重：如果章节已存在，更新其内容摘要
2. 补充：新完成的章节添加到列表中
3. 保持简洁：每个章节 50 字以内
4. 格式：章节名：内容摘要；章节名：内容摘要

直接输出合并后的章节列表，不要其他文字。`;
  };

  try {
    logger.info("[Memory] Extracting key info from conversation...");
    const response = await fetch(apiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "system", content: extractPrompt }],
        temperature: 0.3,
        max_tokens: MAX_LLM_OUTPUT_TOKENS,
      }),
    });
    
    let extracted: any = {};
    let content = "";
    
    if (response.ok) {
      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      content = data.choices?.[0]?.message?.content || "";
      
      logger.info("[Memory] AI extraction response:");
      logger.info("Content preview:", content.substring(0, 500));
      logger.info("Full content length:", content.length);
      
      try {
        extracted = parseExtractedContent(content);
        
        logger.info("[Memory] Parsed research_topic:", extracted.research_topic ? "✓" : "✗");
        logger.info("[Memory] Parsed experiment_summary:", extracted.experiment_summary ? "✓ (" + extracted.experiment_summary.length + " chars)" : "✗");
        logger.info("[Memory] Parsed data_summary:", extracted.data_summary ? "✓ (" + extracted.data_summary.length + " chars)" : "✗");
      } catch (e) {
        logger.warn("[Memory] Failed to parse extracted info:", e);
        logger.warn("[Memory] Content was:", content.substring(0, 300));
      }
    } else {
      logger.warn("[Memory] API call failed, cannot extract memory");
    }

    // 状态/设定类字段只允许从用户原文明示内容更新，避免 AI 回复中的建议句污染长期记忆。
    const guardedStatusFields = applyUserScopedMemoryGuards({
      paper_topic: extracted.research_topic || "",
      research_topic: extracted.research_topic || "",
      target_journal: extracted.target_journal || "",
      writing_progress: extracted.writing_progress || "",
      completed_chapters: extracted.completed_chapters || "",
      pending_chapters: extracted.pending_chapters || "",
    }, userMessage, 'local-server AI');
    extracted.research_topic = guardedStatusFields.paper_topic || guardedStatusFields.research_topic || "";
    extracted.target_journal = guardedStatusFields.target_journal || "";
    extracted.writing_progress = guardedStatusFields.writing_progress || "";
    extracted.completed_chapters = guardedStatusFields.completed_chapters || "";
    extracted.pending_chapters = guardedStatusFields.pending_chapters || "";
    
    // 如果AI提取失败，直接返回，不进行后续操作
    if (!extracted.experiment_summary || extracted.experiment_summary.length < 10) {
      logger.warn("[Memory] AI extraction failed for experiment_summary, skipping memory update");
      return;
    }
    
    if (!extracted.data_summary || extracted.data_summary.length < 10) {
      logger.warn("[Memory] AI extraction failed for data_summary, skipping memory update");
      return;
    }
    
    // 智能合并：将新提取的信息与现有记忆合并（仅 experiment_summary 和 data_summary）
    if (existingExperimentSummary && extracted.experiment_summary) {
      try {
        logger.info("[Memory] Merging experiment_summary with existing memory...");
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: "你是一个研究数据管理助手。" },
              { role: "user", content: mergePrompt(existingExperimentSummary, extracted.experiment_summary, '实验资料总结') }
            ],
            temperature: 0.3,
            max_tokens: MAX_LLM_OUTPUT_TOKENS,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 10) {
            extracted.experiment_summary = mergedContent.trim();
            logger.info("[Memory] experiment_summary merged successfully, length:", extracted.experiment_summary.length);
          } else {
            logger.warn("[Memory] Merge response content too short, keeping original");
          }
        } else {
          const errorText = await mergeResponse.text();
          logger.warn("[Memory] Merge API failed with status:", mergeResponse.status, "-", errorText.substring(0, 200));
        }
      } catch (e) {
        logger.warn("[Memory] Merge failed, keeping original extracted content:", (e as Error).message);
      }
    } else {
      logger.info("[Memory] No existing experiment_summary to merge with, using extracted content directly");
    }
    
    if (existingDataSummary && extracted.data_summary) {
      try {
        logger.info("[Memory] Merging data_summary with existing memory...");
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: "system", content: "你是一个研究数据管理助手。" },
              { role: "user", content: mergePrompt(existingDataSummary, extracted.data_summary, '数据详细总结') }
            ],
            temperature: 0.3,
            max_tokens: MAX_LLM_OUTPUT_TOKENS,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 10) {
            extracted.data_summary = mergedContent.trim();
            logger.info("[Memory] data_summary merged successfully, length:", extracted.data_summary.length);
          } else {
            logger.warn("[Memory] Merge response content too short, keeping original");
          }
        } else {
          const errorText = await mergeResponse.text();
          logger.warn("[Memory] Merge API failed with status:", mergeResponse.status, "-", errorText.substring(0, 200));
        }
      } catch (e) {
        logger.warn("[Memory] Merge failed, keeping original extracted content:", (e as Error).message);
      }
    } else {
      logger.info("[Memory] No existing data_summary to merge with, using extracted content directly");
    }
    
    // 智能合并写作进度
    if (existingWritingProgress && extracted.writing_progress && extracted.writing_progress !== "无") {
      try {
        logger.info("[Memory] Merging writing_progress with existing memory...");
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "system", content: mergeWritingProgressPrompt(existingWritingProgress, extracted.writing_progress) }],
            temperature: 0.3,
            max_tokens: MAX_LLM_OUTPUT_TOKENS,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 5) {
            extracted.writing_progress = mergedContent.trim();
            logger.info("[Memory] writing_progress merged successfully, length:", extracted.writing_progress.length);
          }
        } else {
          logger.warn("[Memory] Writing progress merge API failed with status:", mergeResponse.status);
        }
      } catch (e) {
        logger.warn("[Memory] Writing progress merge failed:", (e as Error).message);
      }
    }
    
    // 智能合并已完成章节
    if (existingCompletedChapters && extracted.completed_chapters && extracted.completed_chapters !== "无") {
      try {
        logger.info("[Memory] Merging completed_chapters with existing memory...");
        const mergeResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "system", content: mergeChaptersPrompt(existingCompletedChapters, extracted.completed_chapters) }],
            temperature: 0.3,
            max_tokens: MAX_LLM_OUTPUT_TOKENS,
          }),
        });
        
        if (mergeResponse.ok) {
          const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const mergedContent = mergeData.choices?.[0]?.message?.content;
          if (mergedContent && mergedContent.length > 5) {
            extracted.completed_chapters = mergedContent.trim();
            logger.info("[Memory] completed_chapters merged successfully, length:", extracted.completed_chapters.length);
          }
        } else {
          logger.warn("[Memory] Completed chapters merge API failed with status:", mergeResponse.status);
        }
      } catch (e) {
        logger.warn("[Memory] Completed chapters merge failed:", (e as Error).message);
      }
    }
    
    logger.info("[Memory] experiment_summary final length:", extracted.experiment_summary.length);
    logger.info("[Memory] data_summary final length:", extracted.data_summary.length);
    logger.info("[Memory] writing_progress:", extracted.writing_progress || "未提取");
    logger.info("[Memory] completed_chapters:", extracted.completed_chapters || "未提取");
    
    const entriesToUpdate = [
      { key: "research_topic", value: extracted.research_topic },
      { key: "target_journal", value: extracted.target_journal },
      { key: "key_concepts", value: extracted.key_concepts },
      { key: "important_findings", value: extracted.important_findings },
      { key: "experimental_design", value: extracted.experimental_design },
      { key: "data_status", value: extracted.data_status },
      { key: "user_preferences", value: extracted.user_preferences },
      { key: "experiment_summary", value: extracted.experiment_summary },
      { key: "data_summary", value: extracted.data_summary },
      { key: "writing_progress", value: extracted.writing_progress },
      { key: "completed_chapters", value: extracted.completed_chapters },
      { key: "pending_chapters", value: extracted.pending_chapters }
    ];
    
    for (const item of entriesToUpdate) {
      // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
      autoRestoreDeletedKeyIfEmpty(memory, item.key);
      
      // Bug fix: 检查该键是否已被用户删除，如果是则跳过写入
      if (isKeyDeleted(memory, item.key)) {
        logger.info(`[Memory] SKIP "${item.key}" - user has deleted this key (protected from auto-restore)`);
        continue;
      }
      
      const mustSave = item.key === "experiment_summary" || item.key === "data_summary";
      const isValid = item.value && item.value !== "未提供" && item.value.length > 5;
      
      if (mustSave) {
        logger.info(`[Memory] ${item.key}: MUST SAVE, length=${item.value?.length || 0}`);
      } else {
        logger.info(`[Memory] ${item.key}: isValid=${isValid}, length=${item.value?.length || 0}`);
      }
      
      if (isValid || mustSave) {
        const existingIndex = memory.entries.findIndex(e => e.key === item.key);
        const newEntry: MemoryEntry = {
          key: item.key,
          value: item.value,
          source: "ai-extracted",
          timestamp: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
          // 智能合并：已在上游完成，这里直接覆盖
          memory.entries[existingIndex] = newEntry;
          logger.info(`[Memory] Updated existing entry: ${item.key}`);
        } else {
          memory.entries.push(newEntry);
          logger.info(`[Memory] Added new entry: ${item.key}`);
        }
      }
    }
    
    await saveUserMemory(memory);
    logger.info("[Memory] Final entries count:", memory.entries.length);
    logger.info("[Memory] Entry keys:", memory.entries.map(e => e.key));
    
    // ========== 写入 .txt 文件（非结构化内容即时写入）==========
    // 立即写入 experiment_summary 和 data_summary 的原始内容到 .txt 文件
    await saveMemoryToFiles(userId, memory);
    logger.info("[Memory] Memory files saved (raw content) for user:", userId);
    
    // ========== 自动生成结构化总结（使用用户配置的小牛马模型）=========
    // 在后台异步生成结构化总结，不阻塞主流程
    const secondaryModelForSummary = currentSecondaryModel || 'gpt-4o-mini';
    generateStructuredSummaries(userId, memory.entries, apiUrl, apiKey, secondaryModelForSummary).catch(e => {
      logger.warn("[Memory] Failed to generate structured summaries:", e);
    });
    // ======================================
    
    const conversationSummary = {
      summary: extracted.research_topic ? `讨论了${extracted.research_topic}` : "新对话",
      keyTopics: extracted.key_concepts ? extracted.key_concepts.split(/[,，]/).map((s: string) => s.trim()).filter((s: string) => s) : []
    };
    
    const conversation: Conversation = {
      id: conversationId,
      userId: userId,
      messages: [
        ...history.map(h => ({ 
          role: (h.role === 'bot' ? 'assistant' : h.role) as 'user' | 'assistant' | 'system', 
          content: h.content, 
          timestamp: new Date().toISOString() 
        })),
        { role: 'user' as const, content: userMessage, timestamp: new Date().toISOString() },
        { role: 'assistant' as const, content: aiResponse, timestamp: new Date().toISOString() }
      ],
      summary: conversationSummary.summary,
      keyTopics: conversationSummary.keyTopics,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    saveConversation(conversation);
    logger.info("[Memory] Saved full conversation to file:", conversationId);
    
  } catch (e) {
    logger.error("[Memory] Failed to extract key info:", e);
  }
}

function parseExtractedContent(content: string) {
  const result: any = {
    research_topic: "",
    target_journal: "",
    key_concepts: "",
    important_findings: "",
    experimental_design: "",
    data_status: "",
    user_preferences: "",
    experiment_summary: "",
    data_summary: "",
    writing_progress: "",
    completed_chapters: "",
    pending_chapters: ""
  };
  
  // 所有字段使用同样的单行提取方式
  const allFields = [
    { key: "research_topic", label: "研究主题：" },
    { key: "target_journal", label: "目标期刊：" },
    { key: "key_concepts", label: "关键概念：" },
    { key: "important_findings", label: "重要发现：" },
    { key: "experimental_design", label: "实验设计：" },
    { key: "data_status", label: "数据状态：" },
    { key: "user_preferences", label: "用户偏好：" },
    { key: "experiment_summary", label: "实验资料总结：" },
    { key: "data_summary", label: "数据详细总结：" },
    { key: "writing_progress", label: "写作进度：" },
    { key: "completed_chapters", label: "已完成章节：" },
    { key: "pending_chapters", label: "待完成章节：" }
  ];
  
  for (const field of allFields) {
    const pattern = field.label + '(.+?)(?=\n(?:研究主题|目标期刊|关键概念|重要发现|实验设计|数据状态|用户偏好|实验资料总结|数据详细总结)：|$)';
    const regex = new RegExp(pattern);
    const match = content.match(regex);
    if (match) {
      (result as any)[field.key] = match[1].trim();
    }
  }
  
  return result;
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const userDir = getUserUploadDir(userId);
    cb(null, userDir);
  },
  filename: function (req, file, cb) {
    cb(null, `${Date.now()}-${sanitizeUploadFileName(file.originalname)}`);
  }
});

const ALLOWED_UPLOAD_EXTENSIONS = new Set(['.pdf', '.txt', '.ris', '.bib', '.csv']);
const MAX_UPLOAD_FILE_SIZE_BYTES = 100 * 1024 * 1024;

function sanitizeUploadFileName(fileName: string): string {
  const ext = path.extname(fileName || '').toLowerCase();
  const base = path.basename(fileName || 'upload', ext)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'upload';
  return `${base}${ext || '.dat'}`;
}

const upload = multer({
  storage,
  limits: {
    files: 50,
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const mimetype = String(file.mimetype || '').toLowerCase();
    if (ALLOWED_UPLOAD_EXTENSIONS.has(ext) || mimetype.includes('pdf')) {
      cb(null, true);
      return;
    }
    cb(new Error('仅支持 PDF、TXT、RIS、BIB、CSV 文件'));
  },
});
const uploadLiteratureFiles = upload.array("files", 50);

function handleLiteratureUpload(req: Request, res: Response, next: NextFunction): void {
  uploadLiteratureFiles(req, res, (error?: unknown) => {
    if (!error) {
      next();
      return;
    }

    const message = error instanceof multer.MulterError
      ? (error.code === 'LIMIT_FILE_SIZE'
          ? `单个文件不能超过 ${Math.floor(MAX_UPLOAD_FILE_SIZE_BYTES / 1024 / 1024)}MB`
          : error.message)
      : (error as Error).message || '文件上传失败';
    res.status(400).json({ success: false, error: message });
  });
}

const chatUpload = multer({ storage: multer.memoryStorage() });

const app: Express = express();

function isAllowedLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (origin === 'null' || origin.startsWith('file://')) return true;

  const configured = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (configured.includes(origin)) return true;

  try {
    const parsed = new URL(origin);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isSensitiveLocalWrite(req: Request): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
    && (
      req.path === '/api/upload'
      || req.path.startsWith('/api/pdf-wiki')
      || req.path.startsWith('/api/autoresearch')
      || req.path.startsWith('/api/research-session')
      || req.path.startsWith('/api/review-writer')
      || req.path.startsWith('/api/flowchart-maker')
      || req.path.startsWith('/api/cloud-prompts')
      || req.path === '/api/embedding/config'
    );
}

function shouldScheduleOverviewRefreshForRequest(req: Request): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return false;
  const p = req.path;
  if (p.startsWith('/api/overview')) return false;
  if (p === '/api/upload') return true;
  return [
    '/api/memory',
    '/api/pdf-wiki',
    '/api/meta-analysis',
    '/api/bibliometrics',
    '/api/data-analysis',
    '/api/autoresearch',
    '/api/projects',
    '/api/research-session',
    '/api/experiment-results',
    '/api/project-memory',
    '/api/embedding-library',
    '/api/chat-bridge',
    '/api/unified',
  ].some(prefix => p.startsWith(prefix));
}

function resolveOverviewRefreshUserId(req: Request): string {
  const body = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const query = req.query && typeof req.query === 'object' ? req.query as Record<string, unknown> : {};
  return sanitizeUserId(
    body.userId
    || body.userID
    || query.userId
    || query.userID
    || 'web-user'
  );
}

// CORS 中间件：允许同机 Web/Electron 页面访问 localhost API，拒绝跨站写操作
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigin = typeof origin === 'string' ? origin : undefined;
  const originAllowed = isAllowedLocalOrigin(allowedOrigin);
  if (allowedOrigin && originAllowed) {
    res.header('Access-Control-Allow-Origin', allowedOrigin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(originAllowed ? 204 : 403);
  }
  if (!originAllowed && isSensitiveLocalWrite(req)) {
    return res.status(403).json({ success: false, error: '跨来源请求被拒绝' });
  }
  next();
});

// 增加 body parser 限制，支持学术论文长文本上下文（文献、写作技能、历史记忆等）
// 默认 100kb 不够，设置为 50mb
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  if (!shouldScheduleOverviewRefreshForRequest(req)) {
    next();
    return;
  }
  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      scheduleOverviewCacheRefresh(resolveOverviewRefreshUserId(req), `${req.method} ${req.path}`);
    }
  });
  next();
});

const port = parseInt(process.env.PORT || "18789", 10);

// 创建认证守卫实例
const authGuard = createAuthGuard(path.join(dataDir, '.session'));
const cloudPromptClient = new CloudPromptClient({
  cloudApiUrl: authGuard.getCloudApiUrl(),
  cacheDir: path.join(dataDir, 'cloud-prompt-cache'),
  getAccessToken: async () => {
    const session = await authGuard.getSession();
    return session?.accessToken || null;
  },
  getCacheKeyMaterial: async () => {
    const session = await authGuard.getSession();
    const userKey = session?.userId || session?.email || 'anonymous';
    const activationKey = session?.activation?.device_id || '';
    const hardwareKey = crypto
      .createHash('sha256')
      .update(`${os.hostname()}:${os.platform()}:${os.cpus()[0]?.model || 'unknown-cpu'}`)
      .digest('hex');
    return `${userKey}:${activationKey}:${hardwareKey}`;
  },
  enabled: process.env.CLOUD_PROMPTS_DISABLED !== '1',
  strict: process.env.CLOUD_PROMPTS_STRICT === '1',
});
autoResearchManager.setCorePromptProvider(cloudPromptClient);

async function consumeCloudQuota(usageType: string, amount: number, metadata: Record<string, unknown> = {}): Promise<void> {
  const session = await authGuard.getSession();
  if (!session?.accessToken) {
    throw new Error('未登录，无法执行云端额度校验');
  }
  const deviceId = session.activation?.device_id || crypto
    .createHash('sha256')
    .update(`${os.hostname()}:${os.platform()}:${os.cpus()[0]?.model || 'unknown-cpu'}`)
    .digest('hex')
    .slice(0, 32);
  const payload = {
    usage_type: usageType,
    amount,
    device_id: deviceId,
    metadata,
  };
  const postUsage = async (accessToken: string) => fetch(`${authGuard.getCloudApiUrl()}/usage/report`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  let response = await postUsage(session.accessToken);
  if (response.status === 401) {
    logger.warn(`[CloudQuota] Usage report returned 401 for ${usageType}; refreshing token and retrying once`);
    const refreshed = await authGuard.refreshToken();
    const refreshedSession = refreshed ? await authGuard.getSession() : null;
    if (refreshedSession?.accessToken) {
      response = await postUsage(refreshedSession.accessToken);
    }
  }

  if (!response.ok) {
    let message = `云端额度扣减失败 (${response.status})`;
    let detail = '';
    try {
      const data = await response.json() as { message?: string; error?: string; remaining?: number };
      message = data.message || data.error || message;
      detail = JSON.stringify(data);
    } catch {
      detail = await response.text().catch(() => '');
    }
    logger.error(`[CloudQuota] Usage report failed: status=${response.status}, type=${usageType}, amount=${amount}, body=${detail || '<empty>'}`);
    throw new Error(message);
  }
}

// Bug 修复：初始化 authGuard 单例，供其他路由模块使用
// 确保所有路由都能从 session 获取真实 userId
initAuthGuardSingleton();
logger.info('[Server] AuthGuard singleton initialized for session-based userId resolution');

let currentApiUrl = process.env.API_URL || "";
let currentApiKey = process.env.API_KEY || "";
let currentModel = process.env.PRIMARY_MODEL || "qwen3.5-plus";
const MAX_LLM_OUTPUT_TOKENS = 32000;
let currentWebSearchKey = process.env.TAVILY_API_KEY || process.env.EXA_API_KEY || "";
// 小牛马模型配置（用户可在 UI 设置）
let currentSecondaryModel = process.env.SECONDARY_MODEL || "gpt-4o";

// Persisted settings file path
const userSettingsPath = path.join(dataDir, 'user-settings.json');
const pdfWikiLlmConfigPath = path.join(dataDir, 'pdf-wiki-llm-config.json');
const DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL = 'qwen-long';
const DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL = 'qwen-max';
const DEFAULT_PDF_WIKI_QWEN_OCR_MODEL = 'qwen-vl-ocr';
const DEFAULT_PDF_WIKI_QWEN_VISION_MODEL = 'qwen-vl-max';
const DEFAULT_PDF_WIKI_QWEN_MODEL = DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL;

interface PdfWikiLlmUserConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  jsonApiUrl?: string;
  jsonApiKey?: string;
  jsonModel?: string;
  ocrModel?: string;
  visionModel?: string;
  textInApiUrl?: string;
  textInAppId?: string;
  textInSecretCode?: string;
  textInParseMode?: string;
  dedicated?: boolean;
  textExtractionEngine?: 'auto' | 'codex' | 'liteparse' | 'marker' | 'fast-text' | 'qwen-long' | 'pdf-parse';
  metadataEngine?: 'auto' | 'api' | 'local';
  claimExtractionEngine?: 'auto' | 'codex' | 'qwen-long' | 'api';
  sentenceReferenceMatchingEngine?: 'auto' | 'api' | 'local';
  groupingEngine?: 'auto' | 'codex' | 'api' | 'local';
  metaAnalysisEnabled?: boolean;
  metaAnalysisEngine?: 'auto' | 'codex' | 'api' | 'off';
  metaAnalysisUserRequirements?: string;
}

type PdfWikiTaskConfig = Pick<PdfWikiLlmUserConfig,
  'textExtractionEngine' | 'metadataEngine' | 'claimExtractionEngine' | 'sentenceReferenceMatchingEngine' | 'groupingEngine' | 'metaAnalysisEnabled' | 'metaAnalysisEngine' | 'metaAnalysisUserRequirements'
>;

function pickPdfWikiTaskChoice<T extends string>(
  body: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  fallback: T
): T {
  const value = typeof body[field] === 'string' ? body[field].trim().toLowerCase() : '';
  return (allowed as readonly string[]).includes(value) ? value as T : fallback;
}

function parsePdfWikiTaskConfigFromBody(body: Record<string, unknown>): PdfWikiTaskConfig {
  return {
    textExtractionEngine: pickPdfWikiTaskChoice(body, 'pdfWikiTextExtractionEngine', ['auto', 'codex', 'liteparse', 'marker', 'fast-text', 'qwen-long', 'pdf-parse'] as const, 'auto'),
    metadataEngine: pickPdfWikiTaskChoice(body, 'pdfWikiMetadataEngine', ['auto', 'api', 'local'] as const, 'auto'),
    claimExtractionEngine: pickPdfWikiTaskChoice(body, 'pdfWikiClaimExtractionEngine', ['auto', 'codex', 'qwen-long', 'api'] as const, 'auto'),
    sentenceReferenceMatchingEngine: pickPdfWikiTaskChoice(body, 'pdfWikiSentenceReferenceMatchingEngine', ['auto', 'api', 'local'] as const, 'auto'),
    groupingEngine: pickPdfWikiTaskChoice(body, 'pdfWikiGroupingEngine', ['auto', 'codex', 'api', 'local'] as const, 'auto'),
    metaAnalysisEnabled: body.pdfWikiMetaAnalysisEnabled !== false && body.pdfWikiMetaAnalysisEnabled !== 'false',
    metaAnalysisEngine: pickPdfWikiTaskChoice(body, 'pdfWikiMetaAnalysisEngine', ['auto', 'codex', 'api', 'off'] as const, 'auto'),
    metaAnalysisUserRequirements: typeof body.pdfWikiMetaAnalysisUserRequirements === 'string'
      ? body.pdfWikiMetaAnalysisUserRequirements.trim().slice(0, 5000)
      : '',
  };
}

function syncPdfWikiRequestConfig(body: Record<string, unknown>): void {
  const requestPdfWikiApiUrl = typeof body.pdfWikiApiUrl === 'string' ? body.pdfWikiApiUrl.trim() : '';
  const requestPdfWikiApiKey = typeof body.pdfWikiApiKey === 'string' ? body.pdfWikiApiKey.trim() : '';
  const requestTextInApiUrl = typeof body.pdfWikiTextInApiUrl === 'string' ? body.pdfWikiTextInApiUrl.trim() : '';
  const requestTextInAppId = typeof body.pdfWikiTextInAppId === 'string' ? body.pdfWikiTextInAppId.trim() : '';
  const requestTextInSecretCode = typeof body.pdfWikiTextInSecretCode === 'string' ? body.pdfWikiTextInSecretCode.trim() : '';
  const requestTextInParseMode = typeof body.pdfWikiTextInParseMode === 'string' ? body.pdfWikiTextInParseMode.trim() : '';
  if (
    !requestPdfWikiApiUrl && !requestPdfWikiApiKey
    && !requestTextInApiUrl && !requestTextInAppId && !requestTextInSecretCode && !requestTextInParseMode
  ) {
    return;
  }

  currentPdfWikiLlmConfig = {
    apiUrl: requestPdfWikiApiUrl || currentPdfWikiLlmConfig.apiUrl || '',
    apiKey: requestPdfWikiApiKey || currentPdfWikiLlmConfig.apiKey || '',
    model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
    jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
    ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
    visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    textInApiUrl: requestTextInApiUrl || currentPdfWikiLlmConfig.textInApiUrl || 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
    textInAppId: requestTextInAppId || currentPdfWikiLlmConfig.textInAppId || '',
    textInSecretCode: requestTextInSecretCode || currentPdfWikiLlmConfig.textInSecretCode || '',
    textInParseMode: requestTextInParseMode || currentPdfWikiLlmConfig.textInParseMode || 'auto',
  };
  persistPdfWikiLlmConfig();
  logger.info(`[PdfWikiConfig] Synced request PDF Wiki config: model=${currentPdfWikiLlmConfig.model}; textIn=${currentPdfWikiLlmConfig.textInAppId ? 'configured' : 'empty'}`);
}

function buildPdfWikiRuntimeTaskConfig(
  runtime: ReturnType<typeof getPdfWikiLlmRuntimeConfig>,
  taskConfig: PdfWikiTaskConfig
): PdfWikiLlmUserConfig {
  return {
    apiUrl: runtime.apiUrl,
    apiKey: runtime.apiKey,
    model: runtime.model,
    jsonApiUrl: runtime.jsonApiUrl,
    jsonApiKey: runtime.jsonApiKey,
    jsonModel: runtime.jsonModel,
    ocrModel: runtime.ocrModel,
    visionModel: runtime.visionModel,
    textInApiUrl: runtime.textInApiUrl,
    textInAppId: runtime.textInAppId,
    textInSecretCode: runtime.textInSecretCode,
    textInParseMode: runtime.textInParseMode,
    dedicated: runtime.dedicated,
    textExtractionEngine: taskConfig.textExtractionEngine,
    metadataEngine: taskConfig.metadataEngine,
    claimExtractionEngine: taskConfig.claimExtractionEngine,
    sentenceReferenceMatchingEngine: taskConfig.sentenceReferenceMatchingEngine,
    groupingEngine: taskConfig.groupingEngine,
    metaAnalysisEnabled: taskConfig.metaAnalysisEnabled,
    metaAnalysisEngine: taskConfig.metaAnalysisEnabled ? taskConfig.metaAnalysisEngine : 'off',
    metaAnalysisUserRequirements: taskConfig.metaAnalysisUserRequirements || '',
  };
}

// ChatBridge 配置文件路径（包含大牛马和小牛马配置）
const chatBridgeConfigPath = path.join(dataDir, 'chat-bridge-config.json');

/**
 * 加载 ChatBridge 配置（包含大牛马/小牛马的模型配置）
 * 优先级：用户 UI 配置 > 环境变量 > 默认值
 */
function loadChatBridgeModelConfig(): { primaryModel: string; secondaryModel: string } {
  try {
    // 尝试加载 src/bridge/chat-bridge/config.json
    const defaultConfigPath = path.join(__dirname, '..', 'bridge', 'chat-bridge', 'config.json');
    let config: any = {};
    
    // 先加载默认配置
    if (fs.existsSync(defaultConfigPath)) {
      config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
    }
    
    // 再加载用户持久化配置（覆盖默认配置）
    if (fs.existsSync(chatBridgeConfigPath)) {
      const userConfig = JSON.parse(fs.readFileSync(chatBridgeConfigPath, 'utf-8'));
      config = { ...config, ...userConfig };
    }
    
    const primaryModel = config.primary?.model || process.env.PRIMARY_MODEL || 'claude-sonnet-4-5';
    const secondaryModel = config.secondary?.model || process.env.SECONDARY_MODEL || 'gpt-4o';
    
    logger.info(`[ModelConfig] Loaded: primary=${primaryModel}, secondary=${secondaryModel}`);
    return { primaryModel, secondaryModel };
  } catch (e) {
    logger.warn('[ModelConfig] Failed to load chat-bridge config, using defaults:', e);
    return {
      primaryModel: process.env.PRIMARY_MODEL || 'claude-sonnet-4-5',
      secondaryModel: process.env.SECONDARY_MODEL || 'gpt-4o'
    };
  }
}

function loadChatBridgeMergedConfig(): Record<string, any> {
  const defaultConfigPath = path.join(__dirname, '..', 'bridge', 'chat-bridge', 'config.json');
  let defaults: Record<string, any> = {};
  let saved: Record<string, any> = {};
  try {
    if (fs.existsSync(defaultConfigPath)) {
      defaults = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
    }
  } catch (error) {
    logger.warn('[ChatBridge] Failed to load default config:', error);
  }
  try {
    if (fs.existsSync(chatBridgeConfigPath)) {
      saved = JSON.parse(fs.readFileSync(chatBridgeConfigPath, 'utf-8'));
    }
  } catch (error) {
    logger.warn('[ChatBridge] Failed to load persisted config:', error);
  }
  return {
    ...defaults,
    ...saved,
    primary: {
      ...(defaults.primary || {}),
      ...(saved.primary || {}),
    },
    secondary: {
      ...(defaults.secondary || {}),
      ...(saved.secondary || {}),
    },
    codex: {
      ...(defaults.codex || {}),
      ...(saved.codex || {}),
    },
  };
}

function loadPersistedChatBridgeConfig(): Record<string, any> {
  try {
    if (fs.existsSync(chatBridgeConfigPath)) {
      const parsed = JSON.parse(fs.readFileSync(chatBridgeConfigPath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (error) {
    logger.warn('[ChatBridge] Failed to load persisted config:', error);
  }
  return {};
}

function loadPersistedUserSettingsRecord(): Record<string, any> {
  try {
    if (fs.existsSync(userSettingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(userSettingsPath, 'utf-8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
  } catch (error) {
    logger.warn('[Settings] Failed to load persisted user settings for secondary API:', error);
  }
  return {};
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function getDeepAnalysisSecondaryRuntimeConfig(): { configured: boolean; apiUrl: string; apiKey: string; model: string; label: string } {
  const savedChatBridgeConfig = loadPersistedChatBridgeConfig();
  const savedSecondary = (savedChatBridgeConfig.secondary || {}) as Record<string, unknown>;
  const chatBridgeApiUrl = firstNonEmptyString(savedSecondary.api_url);
  const chatBridgeApiKeyRaw = firstNonEmptyString(savedSecondary.api_key);
  const chatBridgeApiKey = chatBridgeApiKeyRaw ? decrypt(chatBridgeApiKeyRaw).trim() : '';
  const chatBridgeModel = firstNonEmptyString(savedSecondary.model);
  if (chatBridgeApiUrl && chatBridgeApiKey && chatBridgeModel) {
    return {
      configured: true,
      apiUrl: chatBridgeApiUrl,
      apiKey: chatBridgeApiKey,
      model: chatBridgeModel,
      label: `小牛马 API (${chatBridgeModel})`,
    };
  }

  const savedSettings = loadPersistedUserSettingsRecord();
  const settingsApiUrl = firstNonEmptyString(savedSettings.apiUrl);
  const settingsApiKey = firstNonEmptyString(savedSettings.apiKey);
  const settingsModel = firstNonEmptyString(savedSettings.secondaryModel, savedSettings.model);
  if (settingsApiUrl && settingsApiKey && settingsModel) {
    return {
      configured: true,
      apiUrl: settingsApiUrl,
      apiKey: settingsApiKey,
      model: settingsModel,
      label: `小牛马 API (${settingsModel})`,
    };
  }

  return {
    configured: false,
    apiUrl: chatBridgeApiUrl || settingsApiUrl,
    apiKey: chatBridgeApiKey || settingsApiKey,
    model: chatBridgeModel || settingsModel,
    label: '小牛马 API（缺少 API 地址、Key 或模型名）',
  };
}

function getPrimaryRuntimeConfig(): { configured: boolean; apiUrl: string; apiKey: string; model: string; label: string; source: string } {
  const savedChatBridgeConfig = loadPersistedChatBridgeConfig();
  const savedPrimary = (savedChatBridgeConfig.primary || {}) as Record<string, unknown>;
  const chatBridgeApiUrl = firstNonEmptyString(savedPrimary.api_url);
  const chatBridgeApiKeyRaw = firstNonEmptyString(savedPrimary.api_key);
  const chatBridgeApiKey = chatBridgeApiKeyRaw ? decrypt(chatBridgeApiKeyRaw).trim() : '';
  const chatBridgeModel = firstNonEmptyString(savedPrimary.model);
  if (chatBridgeApiUrl && chatBridgeApiKey && chatBridgeModel) {
    return {
      configured: true,
      apiUrl: chatBridgeApiUrl,
      apiKey: chatBridgeApiKey,
      model: chatBridgeModel,
      label: `大牛马 API (${chatBridgeModel})`,
      source: 'chat-bridge-primary',
    };
  }

  const settingsApiUrl = firstNonEmptyString(currentApiUrl, process.env.API_URL);
  const settingsApiKey = firstNonEmptyString(currentApiKey, process.env.API_KEY);
  const settingsModel = firstNonEmptyString(currentModel, process.env.PRIMARY_MODEL);
  if (settingsApiUrl && settingsApiKey && settingsModel) {
    return {
      configured: true,
      apiUrl: settingsApiUrl,
      apiKey: settingsApiKey,
      model: settingsModel,
      label: `大牛马 API (${settingsModel})`,
      source: currentApiUrl && currentApiKey ? 'settings-primary' : 'env-primary',
    };
  }

  return {
    configured: false,
    apiUrl: chatBridgeApiUrl || settingsApiUrl,
    apiKey: chatBridgeApiKey || settingsApiKey,
    model: chatBridgeModel || settingsModel,
    label: '大牛马 API（缺少 API 地址、Key 或模型名）',
    source: chatBridgeApiUrl || chatBridgeModel ? 'chat-bridge-primary' : (settingsApiUrl || settingsModel ? 'settings-primary' : 'missing'),
  };
}

function loadPdfWikiLlmConfig(): PdfWikiLlmUserConfig {
  const envConfig: PdfWikiLlmUserConfig = {
    apiUrl: process.env.PDF_WIKI_API_URL || process.env.QWEN_VL_MAX_API_URL || process.env.QWEN_LONG_API_URL || '',
    apiKey: process.env.PDF_WIKI_API_KEY || process.env.QWEN_VL_MAX_API_KEY || process.env.QWEN_LONG_API_KEY || '',
    model: process.env.PDF_WIKI_TEXT_MODEL || process.env.PDF_WIKI_MODEL || process.env.QWEN_LONG_MODEL || DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
    jsonModel: process.env.PDF_WIKI_STRUCTURE_MODEL || process.env.PDF_WIKI_JSON_MODEL || process.env.QWEN_MAX_MODEL || DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
    ocrModel: process.env.PDF_WIKI_OCR_MODEL || process.env.QWEN_VL_OCR_MODEL || DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
    visionModel: process.env.PDF_WIKI_VISION_MODEL || process.env.QWEN_VL_MAX_MODEL || DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    textInApiUrl: process.env.PDF_WIKI_TEXTIN_API_URL || process.env.TEXTIN_API_URL || 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
    textInAppId: process.env.PDF_WIKI_TEXTIN_APP_ID || process.env.TEXTIN_APP_ID || '',
    textInSecretCode: process.env.PDF_WIKI_TEXTIN_SECRET_CODE || process.env.TEXTIN_SECRET_CODE || '',
    textInParseMode: process.env.PDF_WIKI_TEXTIN_PARSE_MODE || process.env.TEXTIN_PARSE_MODE || 'auto',
  };

  try {
    if (fs.existsSync(pdfWikiLlmConfigPath)) {
      const saved = JSON.parse(fs.readFileSync(pdfWikiLlmConfigPath, 'utf-8'));
      return {
        apiUrl: saved.apiUrl || envConfig.apiUrl,
        apiKey: saved.apiKey || envConfig.apiKey,
        model: envConfig.model,
        jsonModel: envConfig.jsonModel,
        ocrModel: envConfig.ocrModel,
        visionModel: envConfig.visionModel,
        textInApiUrl: saved.textInApiUrl || envConfig.textInApiUrl,
        textInAppId: saved.textInAppId || envConfig.textInAppId,
        textInSecretCode: saved.textInSecretCode || envConfig.textInSecretCode,
        textInParseMode: saved.textInParseMode || envConfig.textInParseMode,
      };
    }
  } catch (e) {
    logger.warn('[PdfWikiConfig] Failed to load PDF Wiki LLM config:', e);
  }

  return envConfig;
}

let currentPdfWikiLlmConfig = loadPdfWikiLlmConfig();

function persistPdfWikiLlmConfig(): void {
  try {
    const dir = path.dirname(pdfWikiLlmConfigPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(pdfWikiLlmConfigPath, JSON.stringify(currentPdfWikiLlmConfig, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('[PdfWikiConfig] Failed to persist PDF Wiki LLM config:', e);
  }
}

function dedupePdfWikiMetaTemplateColumns(columns: string[]): string[] {
  const seen = new Map<string, number>();
  const result: string[] = [];
  for (const column of columns) {
    const base = String(column || '').trim();
    if (!base) continue;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    result.push(count > 0 ? `${base}_${count + 1}` : base);
  }
  return result;
}

interface PdfWikiMetaTemplateSheetPreview {
  name: string;
  headerRowIndex: number;
  columns: string[];
  previewRows: string[][];
  rowCount: number;
}

interface PdfWikiMetaTemplateParseResult {
  columns: string[];
  sheetName: string;
  headerRowIndex: number;
  sheets: PdfWikiMetaTemplateSheetPreview[];
}

async function parsePdfWikiMetaTemplateColumns(fileName: string, buffer: Buffer): Promise<PdfWikiMetaTemplateParseResult> {
  const ext = path.extname(fileName || '').toLowerCase();
  if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
    throw new Error('请上传 .xlsx、.xls 或 .csv 格式的 Meta 数据库模板');
  }
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(buffer, { type: "buffer", raw: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('模板文件中没有可读取的工作表');
  }

  const sheets = workbook.SheetNames.map((name): PdfWikiMetaTemplateSheetPreview | null => {
    const sheet = workbook.Sheets[name];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }) as unknown[][];
    const normalizedRows = rows.map(row => Array.isArray(row) ? row.map(cell => String(cell ?? '').trim()) : []);
    const headerRowIndex = Math.max(0, normalizedRows.findIndex(row => row.filter(Boolean).length >= 2));
    const headerRow = normalizedRows[headerRowIndex] || [];
    const columns = dedupePdfWikiMetaTemplateColumns(headerRow);
    if (columns.length === 0) return null;
    return {
      name,
      headerRowIndex: headerRowIndex + 1,
      columns,
      previewRows: normalizedRows.slice(headerRowIndex + 1).filter(row => row.some(Boolean)).slice(0, 8),
      rowCount: normalizedRows.filter(row => row.some(Boolean)).length,
    };
  }).filter((sheet): sheet is PdfWikiMetaTemplateSheetPreview => !!sheet);

  if (sheets.length === 0) {
    throw new Error('模板文件中没有可用表头');
  }

  const primary = sheets[0];
  return {
    columns: primary.columns,
    sheetName: primary.name,
    headerRowIndex: primary.headerRowIndex,
    sheets,
  };
}

function normalizeCodexCliCommandForPdfWiki(value: unknown): string {
  return String(value || '').trim().replace(/^[\s"'`]+|[\s"'`]+$/g, '');
}

function loadCodexConfigForPdfWiki(): { command: string; model: string; reasoningEffort: string; prefer: boolean } {
  let savedCodex: Record<string, unknown> = {};
  try {
    if (fs.existsSync(chatBridgeConfigPath)) {
      const parsed = JSON.parse(fs.readFileSync(chatBridgeConfigPath, 'utf-8')) as { codex?: Record<string, unknown> };
      savedCodex = parsed.codex || {};
    }
  } catch (error) {
    logger.warn('[PdfWikiConfig] Failed to load Codex config for PDF Wiki:', error);
  }

  return {
    prefer: savedCodex.enabled !== false && savedCodex.prefer === true,
    command: normalizeCodexCliCommandForPdfWiki(
      process.env.PDF_WIKI_CODEX_COMMAND
      || process.env.CODEX_CLI_PATH
      || process.env.CODEX_BINARY
      || savedCodex.command
    ),
    model: String(process.env.PDF_WIKI_CODEX_MODEL || savedCodex.model || 'gpt-5.5').trim() || 'gpt-5.5',
    reasoningEffort: String(process.env.PDF_WIKI_CODEX_REASONING_EFFORT || savedCodex.reasoning_effort || 'xhigh').trim() || 'xhigh',
  };
}

function getCodexCliCandidatesForPdfWiki(commandOverride?: string): string[] {
  const candidates: string[] = [];
  const add = (value?: string): void => {
    const normalized = normalizeCodexCliCommandForPdfWiki(value);
    if (normalized) candidates.push(normalized);
  };

  add(commandOverride);
  add(process.env.PDF_WIKI_CODEX_COMMAND);
  add(process.env.CODEX_CLI_PATH);
  add(process.env.CODEX_BINARY);

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const scoop = process.env.SCOOP || path.join(os.homedir(), 'scoop');
    candidates.push(
      path.join(appData, 'npm', 'codex.cmd'),
      path.join(appData, 'npm', 'codex.exe'),
      path.join(appData, 'npm', 'codex.bat'),
      path.join(appData, 'npm', 'codex.ps1'),
      path.join(localAppData, 'pnpm', 'codex.cmd'),
      path.join(localAppData, 'Volta', 'bin', 'codex.cmd'),
      path.join(localAppData, 'Programs', 'nodejs', 'codex.cmd'),
      path.join(programFiles, 'nodejs', 'codex.cmd'),
      path.join(scoop, 'shims', 'codex.cmd'),
    );
  } else {
    candidates.push('/usr/local/bin/codex', '/opt/homebrew/bin/codex', '/usr/bin/codex');
  }

  const pathExts = process.platform === 'win32'
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD;.PS1').split(';').filter(Boolean)
    : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    if (process.platform === 'win32') {
      for (const ext of pathExts) {
        candidates.push(path.join(dir, `codex${ext.toLowerCase()}`));
      }
    } else {
      candidates.push(path.join(dir, 'codex'));
    }
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function isCodexCliLikelyAvailableForPdfWiki(): boolean {
  if (/^(false|0|off)$/i.test(String(process.env.PDF_WIKI_CODEX_ENABLED || ''))) {
    return false;
  }
  if (/^(true|1|on)$/i.test(String(process.env.PDF_WIKI_CODEX_ENABLED || ''))) {
    return true;
  }
  const codex = loadCodexConfigForPdfWiki();
  return getCodexCliCandidatesForPdfWiki(codex.command).some(candidate => fs.existsSync(candidate));
}

function isCodexCliPreferredForPdfWiki(): boolean {
  const override = String(process.env.PDF_WIKI_CODEX_ENABLED || '');
  if (/^(false|0|off)$/i.test(override)) return false;
  if (/^(true|1|on)$/i.test(override)) return true;
  return loadCodexConfigForPdfWiki().prefer;
}

function getPdfWikiLlmRuntimeConfig(): {
  configured: boolean;
  dedicated: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
  jsonApiUrl?: string;
  jsonApiKey?: string;
  jsonModel?: string;
  ocrModel?: string;
  visionModel?: string;
  textInApiUrl?: string;
  textInAppId?: string;
  textInSecretCode?: string;
  textInParseMode?: string;
  textInConfigured: boolean;
  liteParseAvailable: boolean;
  markerAvailable: boolean;
  fastTextAvailable: boolean;
  codexAvailable: boolean;
  codexModel?: string;
  codexReasoningEffort?: string;
  label: string;
} {
  const textInConfigured = !!currentPdfWikiLlmConfig.textInAppId && !!currentPdfWikiLlmConfig.textInSecretCode;
  const liteParseAvailable = isLiteParseAvailable();
  const markerAvailable = isPdfMarkerAvailable();
  const fastTextAvailable = isPdfFastTextAvailable();
  const codexConfig = loadCodexConfigForPdfWiki();
  const codexAvailable = isCodexCliLikelyAvailableForPdfWiki();
  const codexPreferred = isCodexCliPreferredForPdfWiki();
  if (currentPdfWikiLlmConfig.apiUrl && currentPdfWikiLlmConfig.apiKey) {
    return {
      configured: true,
      dedicated: true,
      apiUrl: currentPdfWikiLlmConfig.apiUrl,
      apiKey: currentPdfWikiLlmConfig.apiKey,
      model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
      jsonApiUrl: currentPdfWikiLlmConfig.apiUrl,
      jsonApiKey: currentPdfWikiLlmConfig.apiKey,
      jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
      ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
      visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
      textInApiUrl: currentPdfWikiLlmConfig.textInApiUrl,
      textInAppId: currentPdfWikiLlmConfig.textInAppId,
      textInSecretCode: currentPdfWikiLlmConfig.textInSecretCode,
      textInParseMode: currentPdfWikiLlmConfig.textInParseMode || 'auto',
      textInConfigured,
      liteParseAvailable,
      markerAvailable,
      fastTextAvailable,
      codexAvailable,
      codexModel: codexConfig.model,
      codexReasoningEffort: codexConfig.reasoningEffort,
      label: codexAvailable && codexPreferred
        ? `Codex CLI 优先 (${codexConfig.model}/${codexConfig.reasoningEffort}) + LiteParse + 千问国内预设降级（文本 ${DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL}/${DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL}，OCR ${DEFAULT_PDF_WIKI_QWEN_OCR_MODEL}，视觉 ${DEFAULT_PDF_WIKI_QWEN_VISION_MODEL}）`
        : `${liteParseAvailable ? 'LiteParse 本地解析 + ' : ''}${markerAvailable ? 'Marker 外部工具 + ' : ''}${fastTextAvailable ? 'pdf-marker-md 快速文本 + ' : ''}千问国内预设（文本 ${DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL}/${DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL}，OCR ${DEFAULT_PDF_WIKI_QWEN_OCR_MODEL}，视觉 ${DEFAULT_PDF_WIKI_QWEN_VISION_MODEL}）`,
    };
  }

  if (currentApiUrl && currentApiKey) {
    return {
      configured: true,
      dedicated: false,
      apiUrl: currentApiUrl,
      apiKey: currentApiKey,
      model: currentSecondaryModel || currentModel,
      jsonApiUrl: currentApiUrl,
      jsonApiKey: currentApiKey,
      jsonModel: currentSecondaryModel || currentModel,
      ocrModel: currentSecondaryModel || currentModel,
      visionModel: currentSecondaryModel || currentModel,
      textInApiUrl: currentPdfWikiLlmConfig.textInApiUrl,
      textInAppId: currentPdfWikiLlmConfig.textInAppId,
      textInSecretCode: currentPdfWikiLlmConfig.textInSecretCode,
      textInParseMode: currentPdfWikiLlmConfig.textInParseMode || 'auto',
      textInConfigured,
      liteParseAvailable,
      markerAvailable,
      fastTextAvailable,
      codexAvailable,
      codexModel: codexConfig.model,
      codexReasoningEffort: codexConfig.reasoningEffort,
      label: codexAvailable && codexPreferred
        ? `Codex CLI 优先 (${codexConfig.model}/${codexConfig.reasoningEffort}) + LiteParse 本地解析${markerAvailable ? ' + Marker 外部工具' : ''}${fastTextAvailable ? ' + pdf-marker-md 快速文本' : ''} + 小牛马 API 降级 (${currentSecondaryModel || currentModel})`
        : `${liteParseAvailable ? 'LiteParse 本地解析 + ' : ''}${markerAvailable ? 'Marker 外部工具 + ' : ''}${fastTextAvailable ? 'pdf-marker-md 快速文本 + ' : ''}小牛马 API (${currentSecondaryModel || currentModel})`,
    };
  }

  return {
    configured: codexAvailable,
    dedicated: false,
    apiUrl: '',
    apiKey: '',
    model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
    jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
    ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
    visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    textInApiUrl: currentPdfWikiLlmConfig.textInApiUrl,
    textInAppId: currentPdfWikiLlmConfig.textInAppId,
    textInSecretCode: currentPdfWikiLlmConfig.textInSecretCode,
    textInParseMode: currentPdfWikiLlmConfig.textInParseMode || 'auto',
    textInConfigured,
    liteParseAvailable,
    markerAvailable,
    fastTextAvailable,
    codexAvailable,
    codexModel: codexConfig.model,
    codexReasoningEffort: codexConfig.reasoningEffort,
    label: codexAvailable && codexPreferred
      ? `Codex CLI 优先 (${codexConfig.model}/${codexConfig.reasoningEffort})，现有 API 未配置时作为默认 PDF Wiki 引擎`
      : (liteParseAvailable || markerAvailable || fastTextAvailable
        ? `${liteParseAvailable ? 'LiteParse 本地解析可用' : ''}${liteParseAvailable && (markerAvailable || fastTextAvailable) ? '，' : ''}${markerAvailable ? 'Marker 外部工具可用' : ''}${markerAvailable && fastTextAvailable ? '，' : ''}${fastTextAvailable ? 'pdf-marker-md 快速文本可用' : ''}${codexAvailable ? '，Codex CLI 可用但未设为默认优先' : ''}，但未配置可用于论点抽取的 LLM API`
        : '未配置 Codex CLI、LiteParse、Marker、pdf-marker-md 快速文本或 PDF Wiki 千问 API'),
  };
}

async function generateMetaAnalysisAiPlan(input: MetaAnalysisAssistantInput): Promise<MetaAnalysisAssistantResult> {
  const attempts: string[] = [];
  let llmPrompt: string | null = null;

  if (isCodexCliPreferredForPdfWiki() && isCodexCliLikelyAvailableForPdfWiki()) {
    try {
      const prompt = await buildMetaAnalysisAiAssistantPrompt(input, {
        includeUserQuery: true,
        includeRecentContext: false,
        includeLongTermMemory: false,
      });
      const rawText = await callMetaAnalysisCodexAssistant(input, prompt);
      const parsed = parseMetaAnalysisAssistantJson(rawText);
      return {
        ...parsed,
        provider: `Codex CLI (${loadCodexConfigForPdfWiki().model})`,
        rawText,
        fallbackChain: ['codex'],
      };
    } catch (error) {
      const message = (error as Error).message || String(error);
      attempts.push(`Codex失败：${message}`);
      logger.warn('[MetaAnalysisAI] Codex assistant failed:', error);
    }
  } else {
    attempts.push('Codex未启用或不可用');
  }

  const secondaryRuntime = getDeepAnalysisSecondaryRuntimeConfig();
  if (secondaryRuntime.configured) {
    try {
      llmPrompt = llmPrompt || await buildMetaAnalysisAiAssistantPrompt(input, {
        includeUserQuery: true,
        includeRecentContext: true,
        includeLongTermMemory: true,
      });
      const rawText = await callMetaAnalysisLlmAssistant(secondaryRuntime, llmPrompt);
      const parsed = parseMetaAnalysisAssistantJson(rawText);
      return {
        ...parsed,
        provider: secondaryRuntime.label,
        rawText,
        fallbackChain: ['codex', 'secondary'],
      };
    } catch (error) {
      const message = (error as Error).message || String(error);
      attempts.push(`小牛马失败：${message}`);
      logger.warn('[MetaAnalysisAI] Secondary assistant failed:', error);
    }
  } else {
    attempts.push('小牛马未配置');
  }

  const primaryRuntime = getPrimaryRuntimeConfig();
  if (primaryRuntime.configured) {
    try {
      llmPrompt = llmPrompt || await buildMetaAnalysisAiAssistantPrompt(input, {
        includeUserQuery: true,
        includeRecentContext: true,
        includeLongTermMemory: true,
      });
      const rawText = await callMetaAnalysisLlmAssistant(primaryRuntime, llmPrompt);
      const parsed = parseMetaAnalysisAssistantJson(rawText);
      return {
        ...parsed,
        provider: primaryRuntime.label,
        rawText,
        fallbackChain: ['codex', 'secondary', 'primary'],
      };
    } catch (error) {
      const message = (error as Error).message || String(error);
      attempts.push(`大牛马失败：${message}`);
      logger.warn('[MetaAnalysisAI] Primary assistant failed:', error);
    }
  } else {
    attempts.push('大牛马未配置');
  }

  throw new Error(attempts.join('；') || '没有可用的 Meta AI 规划模型');
}

async function buildMetaAnalysisAiMemoryContext(userId: string): Promise<Record<string, unknown>> {
  try {
    const memory = await loadReviewMemoryWithFallback(userId);
    const preferredEntries = getStructuredPreferredMemoryEntries(memory.entries || []);
    const priorityKeys = new Set([
      'experiment_summary',
      'experiment_summary_structured',
      'data_summary',
      'data_summary_structured',
      'research_topic',
      'target_journal',
      'experimental_design',
      'key_concepts',
      'important_findings',
      'user_preferences',
      'writing_progress',
    ]);
    const priorityEntries = preferredEntries.filter(entry => priorityKeys.has(entry.key));
    const otherEntries = preferredEntries.filter(entry => !priorityKeys.has(entry.key)).slice(-30);
    const recentConversations = (memory.conversations || []).slice(-10);
    const recentFullConversations = recentConversations
      .map(summary => {
        const loaded = loadConversation(memory.userId || userId, summary.id);
        return loaded
          ? {
              id: loaded.id,
              summary: loaded.summary,
              keyTopics: loaded.keyTopics,
              messages: (loaded.messages || []).slice(-10),
              updatedAt: loaded.updatedAt,
            }
          : summary;
      });

    return {
      userId: memory.userId || userId,
      updatedAt: memory.updatedAt,
      dimensions: {
        priorityEntries,
        otherEntries,
        recentConversationSummaries: recentConversations,
        recentConversationMessages: recentFullConversations,
      },
    };
  } catch (error) {
    logger.warn('[MetaAnalysisAI] Failed to load long-term memory:', error);
    return { error: 'long-term memory loading failed' };
  }
}

async function buildMetaAnalysisAiAssistantPrompt(
  input: MetaAnalysisAssistantInput,
  options?: {
    includeUserQuery?: boolean;
    includeRecentContext?: boolean;
    includeLongTermMemory?: boolean;
  },
): Promise<string> {
  const includeUserQuery = options?.includeUserQuery !== false;
  const includeRecentContext = options?.includeRecentContext !== false;
  const includeLongTermMemory = options?.includeLongTermMemory !== false;
  const memoryContext = includeLongTermMemory
    ? await buildMetaAnalysisAiMemoryContext(input.userId)
    : { omitted: 'codex_prompt_uses_excel_json_packet_only' };
  const payload = {
    userConfirmedAnalysisRules: Boolean(input.confirmedByUser),
    userRequest: includeUserQuery
      ? (input.query || '请根据当前 Meta 分析编码表，帮助我配置科学、可运行的 Meta 分析。')
      : '请基于当前 excelJsonPacket 自动判断列角色、CK/control、treatment、合并/拆分/换算列，并输出副本整理方案。',
    chatHistoryLast10Turns: includeRecentContext ? (input.chatHistory || []) : [],
    recentUserQueriesLast10: includeRecentContext ? (input.recentUserQueries || []) : [],
    crossSessionLongTermMemory: memoryContext,
    methodGuide: {
      source: DOING_META_GUIDE_SOURCE,
      embeddedKnowledge: DOING_META_GUIDE_KNOWLEDGE,
      meanOnlyFallback: {
        name: 'Mean-only response ratio / mean difference with non-parametric bootstrap',
        useWhen: 'Use only when treatment/control means are available but SD/SE/variance is unavailable or unreliable.',
        sources: [
          'Adams, Gurevitch & Rosenberg 1997 Ecology: https://rosenberglab.net/Adams1997Ecology.html',
          'DOI: https://doi.org/10.1890/0012-9658(1997)078[1277:RTFMAO]2.0.CO;2',
          'Meta-Analysis for Ecology & Natural Sciences effect sizes: https://metaanalysis.ecology.uga.edu/effect-sizes/',
          'Meta-Analysis for Ecology & Natural Sciences weighting: https://metaanalysis.ecology.uga.edu/weighting-effect-sizes/',
        ],
        steps: [
          'Compute study-level effect sizes from means only: lnRR = log(treatmentMean/controlMean) when both means are positive, or MD = treatmentMean - controlMean when raw-unit differences are biologically meaningful and units are harmonized.',
          'Do not compute or impute inverse-variance weights from missing SD/SE.',
          'Pool effects using the unweighted mean unless the user explicitly configures a justified non-variance weight.',
          'Use non-parametric bootstrap/resampling of study-level effect sizes, default 9999 iterations, to estimate confidence intervals.',
          'Report that Q, I2 and tau2 from inverse-variance models are not applicable for pure mean-only bootstrap results.',
          'Use subgroup bootstrap summaries descriptively when subgroup levels have enough effect sizes.',
          'For subgroup analysis, pool all effect sizes with the same subgroup level into one subgroup-level pooled effect; for example, all rows with the same Crop value become one Crop subgroup estimate.',
        ],
      },
    },
    workspace: {
      id: input.workspace.id,
      copyStoragePath: input.workspace.copyStoragePath,
      excelJsonPath: input.workspace.excelJsonPath,
      excelJsonSummary: input.workspace.excelJsonSummary,
      sourcePdfIds: input.workspace.sourcePdfIds,
      dataset: input.workspace.dataset,
    },
    excelJsonPacket: input.excelJsonPacket || input.workspace.excelJsonPacket || null,
    columns: input.workspace.columns,
    variables: input.variables,
    candidateOutcomes: input.candidateOutcomes,
    moderatorCandidates: input.moderatorCandidates.slice(0, 30),
    recommendedConfig: input.recommendedConfig,
    warnings: input.warnings,
    sampleRows: input.workspace.sampleRows,
  };

  return `你是 Scholar Harness 的聊天式 Meta 分析数据工程代理。你的第一目标不是直接跑模型，而是和用户聊天澄清需求，并根据用户需求整理 Meta 数据库 Excel 的副本，使副本满足后续 Meta 分析要求。

输入方式说明：
- 用户的 Excel 编码表已经由后端转换为结构化 JSON 数据包 excelJsonPacket。你应该优先阅读 excelJsonPacket，而不是假设自己直接读取原始 Excel。
- excelJsonPacket 中包含 sheets、columns、column stats、sampleRows、candidateOutcomes、candidateRoles 和 warnings。
- Excel 只作为用户编辑/展示/导出的载体；你的判断和规划必须基于 JSON 数据包，然后输出可执行的数据整理方案。

硬性规则：
1. 只在副本工作区上规划和整理，不要要求或暗示直接修改原始 Meta 编码表。
2. 输出必须是一个 JSON 对象，不能使用 Markdown 代码块，不能输出解释性前后缀。
3. 不要在用户确认“副本数据没问题/可以分析/开始分析”之前要求系统运行 Meta 分析或 R 出图。
3a. 如果 userConfirmedAnalysisRules=true，说明用户已经确认或回答完确认问题；不要再输出 await_user_confirmation，不要重复询问同一批问题，应输出 workflowStage="ready_for_analysis"，questions 只保留新的阻断性问题。
4. 当前阶段应优先输出：你理解的用户需求、需要整理的 Excel 副本内容、拟执行的数据清洗/拆列/换算/分组/筛行/补列操作、需要用户确认的问题。
5. 你必须先自己判断哪些列是因变量/结果变量，哪些列是自变量、亚组变量、调节变量或处理描述变量；不能一开始要求用户手动配置下拉框。
6. 你必须根据列名、样例值、单位、candidateOutcomes、recommendedConfig、CK/control/对照/blank 等信号判断哪些处理是 CK/control，哪些处理是 treatment。
7. 你必须判断哪些列需要合并为同一个因变量、哪些列需要拆分、哪些列需要单位换算、哪些列需要标签标准化。
8. 如果均值列中含有 “均值 ± SD/SE” 这种混合文本，应在 operations 和 dataUnderstanding.mergeCandidates 中提出 split_mean_sd 或 convert_se_to_sd 的副本整理操作。
9. 如果单位不统一，应在 operations 中提出 unit_convert，并说明目标单位。
10. 如果值是范围，应提出 range_midpoint 或 range_group 操作；范围分组使用 { "column": "...", "type": "rangeGroups", "spec": "0-30=短期;30-90=中期;>90=长期" }。
11. 如果只有处理组/对照组均值，没有可用 SD/SE/n，不要伪造方差；应建议 mean-only response ratio 或 mean-only mean difference + non-parametric bootstrap/resampling。lnRR_mean_only 只要求 treatmentMean/controlMean 且均值大于 0；MD_mean_only 只要求 treatmentMean/controlMean。该方案不使用 SD/SE 逆方差权重，I²/tau² 不适用。
12. 亚组分析必须针对“合并效应值”进行：如果某列参与亚组分析，例如 Crop/作物，则同一个作物水平下的所有效应量必须先合并成一个该作物的 pooled subgroup effect，再用于亚组图和表；不要把每个 PDF/每行数据当作亚组结果。
13. suggestedConfig 只作为“后续分析草案”，不是现在就运行的指令。若字段尚不可靠，可以为空或只填高置信部分。
14. 必须利用 crossSessionLongTermMemory、chatHistoryLast10Turns、recentUserQueriesLast10 理解用户偏好、研究背景、常用指标和前文约束。
15. 如果自动判断不够可靠，把低置信假设和需要用户确认的问题放到 questions，不要编造不存在的字段。

JSON Schema：
{
  "workflowStage": "chat_requirements|prepare_copy|await_user_confirmation|ready_for_analysis",
  "assistantMessage": "给用户看的简短说明",
  "dataUnderstanding": {
    "dependentVariables": [
      {
        "label": "因变量名称",
        "measure": "lnRR|MD|SMD|lnRR_mean_only|MD_mean_only",
        "columns": {
          "treatmentMean": "列名",
          "treatmentSd": "列名",
          "treatmentN": "列名",
          "controlMean": "列名",
          "controlSd": "列名",
          "controlN": "列名"
        },
        "reason": "为什么这些列是一组因变量效应量字段",
        "confidence": 0.0
      }
    ],
    "independentVariables": [
      {
        "column": "列名",
        "type": "subgroup|moderator|subgroup_or_moderator|treatment_descriptor|study_descriptor|possible_covariate",
        "reason": "为什么这是自变量/亚组/调节变量",
        "confidence": 0.0
      }
    ],
    "controlGroups": [
      {
        "column": "处理或分组列名",
        "values": ["CK", "Control"],
        "reason": "为什么这些值是 CK/control",
        "confidence": 0.0
      }
    ],
    "treatmentGroups": [
      {
        "column": "处理或分组列名",
        "values": ["Treatment A"],
        "reason": "为什么这些值是 treatment",
        "confidence": 0.0
      }
    ],
    "mergeCandidates": [
      {
        "operation": "merge_columns|split_mean_sd|convert_se_to_sd|unit_convert|normalize_labels|effect_size_bundle|mean_only_bootstrap",
        "target": "目标列或目标因变量",
        "columns": ["相关列"],
        "reason": "为什么需要合并/拆分/换算/标准化",
        "confidence": 0.0
      }
    ],
    "columnRoleMap": [
      {
        "column": "列名",
        "role": "dependent|independent|treatment_group|treatmentMean|treatmentSd|treatmentN|controlMean|controlSd|controlN|unit|source_or_trace|ignore|unclassified",
        "reason": "判断依据",
        "confidence": 0.0
      }
    ],
    "lowConfidenceQuestions": []
  },
  "operations": [
    {
      "id": "stable-id",
      "type": "copy_workspace|inspect_columns|map_effect_size|split_mean_sd|convert_se_to_sd|unit_convert|range_midpoint|filter_rows|delete_columns|add_columns|range_group|configure_subgroups|configure_moderators|mean_only_bootstrap|await_confirmation",
      "title": "操作标题",
      "rationale": "为什么需要这个操作",
      "params": {},
      "requiresConfirmation": true
    }
  ],
  "rPlan": {
    "packages": ["metafor", "meta", "clubSandwich"],
    "plots": ["forest", "funnel", "leave_one_out", "baujat", "subgroup_forest", "mean_only_effect_plot"],
    "diagnostics": [],
    "notes": []
  },
  "suggestedConfig": {
    "model": "random|fixed|mixed",
    "method": "REML",
    "studyIdColumn": "Study#",
    "clusterBy": "Study#",
    "moderatorColumns": [],
    "subgroupColumns": [],
    "columnPreprocess": [],
    "minCompleteRows": 2,
    "outcomes": [
      {
        "id": "outcome_id",
        "label": "因变量名称",
        "measure": "lnRR|MD|SMD|lnRR_mean_only|MD_mean_only",
        "treatmentMean": "处理组均值列",
        "controlMean": "对照组均值列",
        "treatmentSd": "标准模式才需要",
        "treatmentN": "标准模式才需要",
        "controlSd": "标准模式才需要",
        "controlN": "标准模式才需要",
        "direction": 1
      }
    ]
  },
  "questions": [],
  "warnings": []
}

当前输入 JSON：
${JSON.stringify(payload, null, 2)}`;
}

async function callMetaAnalysisLlmAssistant(
  runtime: { apiUrl: string; apiKey: string; model: string; label: string },
  prompt: string,
): Promise<string> {
  return callChatCompletion(
    {
      apiUrl: runtime.apiUrl,
      apiKey: runtime.apiKey,
      defaultModel: runtime.model,
      defaultTemperature: 0.1,
      label: runtime.label,
    },
    {
      model: runtime.model,
      messages: [
        { role: 'system', content: '你是严格输出 JSON 的 Meta 分析工程助手。' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      maxTokens: 8000,
    },
  );
}

function extractMetaAnalysisCodexSessionId(output: string): string | null {
  const text = String(output || '');
  const jsonMatch = text.match(/"session[_-]?id"\s*:\s*"([^"]+)"/i);
  if (jsonMatch && jsonMatch[1]) return jsonMatch[1].trim();
  const labelMatch = text.match(/session\s+id\s*:\s*([0-9a-fA-F-]{24,})/i);
  if (labelMatch && labelMatch[1]) return labelMatch[1].trim();
  return null;
}

function readMetaAnalysisCodexSessionId(sessionPath: string): string | null {
  try {
    if (!fs.existsSync(sessionPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(sessionPath, 'utf-8')) as { sessionId?: unknown };
    const sessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId.trim() : '';
    return sessionId || null;
  } catch (error) {
    logger.warn('[MetaAnalysisAI] Failed to read Codex session metadata:', error);
    return null;
  }
}

async function callMetaAnalysisCodexAssistant(input: MetaAnalysisAssistantInput, prompt: string): Promise<string> {
  const codexConfig = loadCodexConfigForPdfWiki();
  const executable = getCodexCliCandidatesForPdfWiki(codexConfig.command).find(candidate => fs.existsSync(candidate))
    || normalizeCodexCliCommandForPdfWiki(codexConfig.command)
    || 'codex';
  const taskDir = path.join(getUserUploadDir(input.userId), 'meta-analysis', 'ai-assistant', input.workspace.id);
  await fs.promises.mkdir(taskDir, { recursive: true });
  const lastMessagePath = path.join(taskDir, 'codex_last_message.txt');
  const stdoutPath = path.join(taskDir, 'codex_stdout.txt');
  const stderrPath = path.join(taskDir, 'codex_stderr.txt');
  const sessionPath = path.join(taskDir, 'codex_session.json');
  const promptPath = path.join(taskDir, 'TASK_PROMPT.md');
  await fs.promises.writeFile(promptPath, prompt, 'utf-8');
  const existingSessionId = readMetaAnalysisCodexSessionId(sessionPath);

  const args = existingSessionId
    ? [
        'exec',
        'resume',
        '--skip-git-repo-check',
        '--output-last-message',
        lastMessagePath,
      ]
    : [
        'exec',
        '--cd',
        taskDir,
        '--sandbox',
        'danger-full-access',
        '--skip-git-repo-check',
        '--output-last-message',
        lastMessagePath,
      ];
  if (codexConfig.model) args.push('-m', codexConfig.model);
  if (codexConfig.reasoningEffort) args.push('-c', `model_reasoning_effort="${codexConfig.reasoningEffort}"`);
  if (existingSessionId) args.push(existingSessionId);
  args.push('-');

  logger.info(`[MetaAnalysisAI] Codex assistant: command=${executable}; model=${codexConfig.model}; workspace=${input.workspace.id}; mode=${existingSessionId ? 'resume' : 'new'}`);
  return new Promise<string>((resolve, reject) => {
    const child = spawnCodexCliProcessForPdfWiki(executable, args);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('Codex CLI Meta 分析规划超时'));
    }, 900000);

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
    child.on('close', async code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        await fs.promises.writeFile(stdoutPath, stdout || '', 'utf-8');
        await fs.promises.writeFile(stderrPath, stderr || '', 'utf-8');
        const parsedSessionId = extractMetaAnalysisCodexSessionId(`${stdout}\n${stderr}`) || existingSessionId;
        if (parsedSessionId) {
          await fs.promises.writeFile(sessionPath, JSON.stringify({
            sessionId: parsedSessionId,
            conversationId: input.conversationId || input.workspace.id,
            workspaceId: input.workspace.id,
            updatedAt: new Date().toISOString(),
          }, null, 2), 'utf-8');
        }
        const lastMessage = fs.existsSync(lastMessagePath)
          ? fs.readFileSync(lastMessagePath, 'utf-8').trim()
          : '';
        const content = lastMessage || stdout.trim();
        if (code !== 0) {
          const output = (stderr || stdout || 'no output').trim();
          const preview = output.length > 1600 ? output.slice(-1600) : output;
          reject(new Error(`Codex CLI exited with code ${code}: ${preview}`));
          return;
        }
        if (!content) {
          reject(new Error('Codex CLI 返回空内容'));
          return;
        }
        resolve(content);
      } catch (error) {
        reject(error);
      }
    });

    child.stdin?.write(`${prompt}\n\n最终只输出 JSON 对象。`);
    child.stdin?.end();
  });
}

function spawnCodexCliProcessForPdfWiki(executable: string, args: string[]): ReturnType<typeof spawn> {
  const isWindowsPowerShellScript = process.platform === 'win32' && /\.ps1$/i.test(executable);
  if (isWindowsPowerShellScript) {
    return spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', executable, ...args], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env: process.env,
    });
  }

  const isWindowsBatchScript = process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable);
  if (isWindowsBatchScript) {
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', executable, ...args], {
      cwd: process.cwd(),
      shell: false,
      windowsHide: true,
      env: process.env,
    });
  }

  return spawn(executable, args, {
    cwd: process.cwd(),
    shell: false,
    windowsHide: true,
    env: process.env,
  });
}

function parseMetaAnalysisAssistantJson(rawText: string): MetaAnalysisAssistantResult {
  const parsed = extractMetaAnalysisAssistantJsonObject(rawText);
  if (!parsed) {
    throw new Error('AI 输出不是合法 JSON');
  }
  return parsed as unknown as MetaAnalysisAssistantResult;
}

function extractMetaAnalysisAssistantJsonObject(rawText: string): Record<string, unknown> | null {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const direct = tryParseMetaAnalysisJson(text);
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseMetaAnalysisJson(fenced[1]);
    if (parsed) return parsed;
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return tryParseMetaAnalysisJson(text.slice(start, end + 1));
  }
  return null;
}

function tryParseMetaAnalysisJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

// Load persisted settings (overrides .env defaults)
function loadPersistedSettings(): void {
  try {
    if (fs.existsSync(userSettingsPath)) {
      const saved = JSON.parse(fs.readFileSync(userSettingsPath, 'utf-8'));
      if (saved.apiUrl) currentApiUrl = saved.apiUrl;
      if (saved.apiKey) currentApiKey = saved.apiKey;
      if (saved.model) currentModel = saved.model;
      if (saved.webSearchKey) currentWebSearchKey = saved.webSearchKey;
      if (saved.secondaryModel) currentSecondaryModel = saved.secondaryModel;
      logger.info(`[Settings] Loaded persisted settings: apiUrl=${currentApiUrl}, model=${currentModel}, secondaryModel=${currentSecondaryModel}`);
    }
    
    // 加载 ChatBridge 配置中的模型设置
    const modelConfig = loadChatBridgeModelConfig();
    if (currentModel === process.env.PRIMARY_MODEL || !currentModel) {
      currentModel = modelConfig.primaryModel;
    }
    if (currentSecondaryModel === process.env.SECONDARY_MODEL || !currentSecondaryModel) {
      currentSecondaryModel = modelConfig.secondaryModel;
    }
  } catch (e) {
    logger.warn('[Settings] Failed to load persisted settings, using .env defaults');
  }
}

// Save current settings to file
function persistSettings(): void {
  try {
    const dir = path.dirname(userSettingsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(userSettingsPath, JSON.stringify({
      apiUrl: currentApiUrl,
      apiKey: currentApiKey,
      model: currentModel,
      secondaryModel: currentSecondaryModel,
      webSearchKey: currentWebSearchKey,
    }, null, 2), 'utf-8');
  } catch (e) {
    logger.warn('[Settings] Failed to persist settings:', e);
  }
}

loadPersistedSettings();

const apiUrl = process.env.API_URL || "";
const apiKey = process.env.API_KEY || "";
const primaryModel = process.env.PRIMARY_MODEL || "qwen3.5-plus";
const exaApiKey = process.env.EXA_API_KEY || "";

function extractTextFromFile(file: Express.Multer.File): string {
  const ext = path.extname(file.originalname).toLowerCase();
  let content: string;
  
  if (file.buffer) {
    content = file.buffer.toString('utf-8');
  } else {
    content = fs.readFileSync(file.path, 'utf-8');
  }
  
  // 移除 BOM 字符（WoS 导出文件常见）
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }
  
  // WoS 文件：直接返回原始内容（让后续解析函数处理）
  if (content.includes('Clarivate Analytics Web of Science') || 
      content.includes('Web of Science') ||
      content.match(/^FN\s+Clarivate/m) ||
      (content.match(/^ER\s*$/m) && content.match(/^TI\s+/m))) {
    return content;
  }
  
  if (ext === '.txt' || ext === '.md') {
    return content;
  }
  
  if (ext === '.json') {
    return content;
  }
  
  if (ext === '.ris') {
    return parseRisContent(content);
  }
  
  if (ext === '.bib') {
    return parseBibContent(content);
  }
  
  // PDF 文件：直接返回原始内容让 AI 处理
  if (ext === '.pdf') {
    return `[PDF Document: ${file.originalname}]\n\n${content}`;
  }
  
  return `[File: ${file.originalname}]\n${content.slice(0, 5000)}]`;
}

/**
 * Load SCI writing skill by chapter type
 * @param chapterType - Type of chapter: introduction, methods, results, discussion, etc.
 * @returns Skill content or empty string if not found
 */
function normalizeSkillChapterType(chapterType: string): string {
  const normalized = (chapterType || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    'title': 'title',
    '标题': 'title',
    '题目': 'title',
    'abstract': 'abstract',
    'summary': 'abstract',
    '摘要': 'abstract',
    'introduction': 'introduction',
    'intro': 'introduction',
    '引言': 'introduction',
    '绪论': 'introduction',
    'methods': 'methods',
    'method': 'methods',
    'methodology': 'methods',
    'materials': 'methods',
    '材料与方法': 'methods',
    '方法': 'methods',
    'results': 'results',
    'result': 'results',
    '结果': 'results',
    'figures': 'figures',
    'tables': 'tables',
    '图表': 'figures',
    'discussion': 'discussion',
    '讨论': 'discussion',
    'conclusion': 'conclusion',
    'conclusions': 'conclusion',
    '结论': 'conclusion',
    'additional': 'additional',
    'statement': 'additional',
    'reference': 'reference-relevance',
    'references': 'reference-relevance',
    'citation': 'reference-relevance',
    'citation-integrity': 'reference-relevance',
    'reference-relevance': 'reference-relevance',
    '参考文献相关性': 'reference-relevance',
    '引用相关性': 'reference-relevance'
  };
  return aliases[normalized] || normalized;
}

function loadWritingSkill(chapterType: string): string {
  const skillMap: Record<string, string> = {
    'title': '01_title_skill.md',
    'abstract': '02_abstract_skill.md',
    'introduction': '03_introduction_skill.md',
    'intro': '03_introduction_skill.md',
    'methods': '04_methods_skill.md',
    'method': '04_methods_skill.md',
    'methodology': '04_methods_skill.md',
    'materials': '04_methods_skill.md',
    'results': '05_results_skill.md',
    'result': '05_results_skill.md',
    'figures': '06_figures_tables_skill.md',
    'tables': '06_figures_tables_skill.md',
    'discussion': '07_discussion_skill.md',
    'conclusion': '08_conclusion_skill.md',
    'conclusions': '08_conclusion_skill.md',
    'additional': '09_additional_statements_skill.md',
    'statement': '09_additional_statements_skill.md',
    'reference-relevance': '10_reference_relevance_constraint_skill.md'
  };
  
  const normalizedChapterType = normalizeSkillChapterType(chapterType);
  const skillFile = skillMap[normalizedChapterType];
  if (!skillFile) {
    logger.info(`[Skill] No skill found for chapter type: ${chapterType}`);
    return '';
  }
  
  const skillPath = path.join(skillDir, skillFile);
  if (!fs.existsSync(skillPath)) {
    logger.warn(`[Skill] Skill file not found: ${skillPath}`);
    return '';
  }
  
  try {
    const skillContent = fs.readFileSync(skillPath, 'utf-8');
    logger.info(`[Skill] Loaded skill: ${skillFile} for chapter: ${normalizedChapterType}`);
    return skillContent;
  } catch (e) {
    logger.error(`[Skill] Failed to load skill: ${skillPath}`, e);
    return '';
  }
}

function loadMultipleSkills(skillTypes: string[]): string {
  const parts: string[] = [];
  
  for (const skillType of skillTypes) {
    const content = loadWritingSkill(skillType);
    if (content) {
      parts.push(`### ${skillType.toUpperCase()}\n\n${content}`);
    }
  }
  
  return parts.join('\n\n---\n\n');
}

/**
 * Detect chapter type from user message and conversation context
 * @param message - User's current message
 * @param history - Recent conversation history
 * @returns Detected chapter type or null
 */
function detectChapterType(message: string, history?: Array<{ role: string; content: string }>): string | null {
  const messageLower = message.toLowerCase();
  
  // ========== 1. 先检测用户当前消息中的明确章节提及 ==========
  
  // 检测明确的章节动词："写"、"开始写"、"生成" 等
  const explicitWriteActions = [
    '写', '开始写', '开始', '生成', '帮我', '给我', 
    'write', 'start writing', 'begin', 'generate', 'draft'
  ];
  
  const hasWriteAction = explicitWriteActions.some(action => 
    messageLower.includes(action)
  );
  
  // 如果消息包含写作动作，优先检测章节类型
  if (hasWriteAction) {
    if (messageLower.includes('引言') || messageLower.includes('introduction') || 
        messageLower.includes('intro')) {
      return 'introduction';
    }
    
    if (messageLower.includes('方法') || messageLower.includes('methods') || 
        messageLower.includes('methodology') || messageLower.includes('材料')) {
      return 'methods';
    }
    
    if (messageLower.includes('结果') || messageLower.includes('results') || 
        messageLower.includes('数据')) {
      return 'results';
    }
    
    if (messageLower.includes('讨论') || messageLower.includes('discussion') || 
        messageLower.includes('discuss')) {
      return 'discussion';
    }
    
    if (messageLower.includes('结论') || messageLower.includes('conclusion') || 
        messageLower.includes('总结')) {
      return 'conclusion';
    }
    
    if (messageLower.includes('摘要') || messageLower.includes('abstract')) {
      return 'abstract';
    }
    
    if (messageLower.includes('标题') || messageLower.includes('title')) {
      return 'title';
    }
    
    if (messageLower.includes('图表') || messageLower.includes('figures') || 
        messageLower.includes('tables') || messageLower.includes('图') || messageLower.includes('表')) {
      return 'figures';
    }
  }
  
  // ========== 2. 检测模糊的写作请求（无明确章节） ==========
  
  // 模糊写作请求关键词
  const vagueWriteRequests = [
    '按这个结构写', '按照这个结构', '开始写吧', '开始写作', 
    '可以写了', '帮我写', '给我写', '写吧', '写',
    'write this', 'follow this structure', 'start writing', 'go ahead'
  ];
  
  const isVagueWriteRequest = vagueWriteRequests.some(req => 
    messageLower.includes(req)
  );
  
  // 如果是模糊写作请求，检查历史消息寻找讨论中的章节
  if (isVagueWriteRequest && history && history.length > 0) {
    logger.info("[Skill] Detected vague write request, searching conversation context for chapter type");
    
    // 检查最近的 AI 回复和用户消息（最多 5 轮）
    const recentContext = history.slice(-10);
    
    for (let i = recentContext.length - 1; i >= 0; i--) {
      const msg = recentContext[i].content.toLowerCase();
      
      // 检测 AI 回复中提到的章节（AI 可能说过"您的结果部分应该包含..."）
      if (msg.includes('结果部分') || msg.includes('results section')) {
        logger.info(`[Skill] Found 'results' in conversation context at message ${i}`);
        return 'results';
      }
      
      if (msg.includes('讨论部分') || msg.includes('discussion section')) {
        logger.info(`[Skill] Found 'discussion' in conversation context at message ${i}`);
        return 'discussion';
      }
      
      if (msg.includes('引言部分') || msg.includes('introduction section')) {
        logger.info(`[Skill] Found 'introduction' in conversation context at message ${i}`);
        return 'introduction';
      }
      
      if (msg.includes('方法部分') || msg.includes('methods section')) {
        logger.info(`[Skill] Found 'methods' in conversation context at message ${i}`);
        return 'methods';
      }
      
      if (msg.includes('结论部分') || msg.includes('conclusion section')) {
        logger.info(`[Skill] Found 'conclusion' in conversation context at message ${i}`);
        return 'conclusion';
      }
    }
  }
  
  // ========== 3. 检查最近提到的章节（通过记忆） ==========
  
  // 如果用户最近讨论过某个章节，应该继续该章节
  
  if (history && history.length > 0) {
    const recentContext = history.slice(-5);
    const contextText = recentContext.map(msg => msg.content).join(' ').toLowerCase();
    
    // 统计每个章节在上下文中出现的频率
    const chapterMentions = {
      'introduction': (contextText.match(/引言 |introduction|intro/g) || []).length,
      'methods': (contextText.match(/方法|methods|methodology/g) || []).length,
      'results': (contextText.match(/结果|results|数据/g) || []).length,
      'discussion': (contextText.match(/讨论|discussion/g) || []).length,
      'conclusion': (contextText.match(/结论|conclusion/g) || []).length
    };
    
    // 找出最频繁提到的章节
    let maxMentions = 0;
    let detectedChapter: string | null = null;
    
    for (const [chapter, count] of Object.entries(chapterMentions)) {
      if (count > maxMentions) {
        maxMentions = count;
        detectedChapter = chapter;
      }
    }
    
    // 如果某个章节被提到 2 次以上，认为这是当前讨论的章节
    if (detectedChapter && maxMentions >= 2) {
      logger.info(`[Skill] Inferred chapter '${detectedChapter}' from context (${maxMentions} mentions)`);
      return detectedChapter;
    }
  }
  
  // 未检测到章节
  return null;
}

/**
 * @deprecated 已废弃，请使用 ParserFactory.parseContent() 代替
 * 该函数将在未来版本中移除
 */
function parseWosContent(content: string): string {
  const papers: string[] = [];
  
  // 修复 1: 支持多种 ER 结尾格式（ER\n, ER \n, \nER\n）
  const records = content.split(/^ER\s*$/m);
  
  for (const record of records) {
    // 修复 2: 检查记录是否有效（必须有 TI 字段且不是空记录）
    if (!record.trim() || !record.match(/^TI\s/m)) continue;
    
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    const authors: string[] = [];
    const keywordsArr: string[] = [];
    
    const lines = record.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      // 跳过空行和元数据行（FN, VR 等）
      if (!trimmed || trimmed.startsWith('FN ') || trimmed.startsWith('VR ') || trimmed.startsWith('PT ')) {
        continue;
      }
      
      // 标题 (TI)
      if (line.startsWith('TI ')) {
        title = line.replace('TI ', '').trim();
        // 处理续行（以 3 个空格开头的续行）
        let j = i + 1;
        while (j < lines.length && lines[j].match(/^   \S/)) {
          title += ' ' + lines[j].trim();
          j++;
        }
        i = j - 1;
      }
      
      // 作者 (AU) - 每行一个作者
      else if (line.startsWith('AU ')) {
        const au = line.replace('AU ', '').trim();
        if (au && !authors.includes(au)) {
          authors.push(au);
        }
      }
      
      // 期刊 (SO)
      else if (line.startsWith('SO ')) {
        journal = line.replace('SO ', '').trim();
      }
      
      // 出版年份 (PY)
      else if (line.startsWith('PY ')) {
        const pyMatch = line.match(/PY\s+(\d{4})/);
        if (pyMatch) {
          year = pyMatch[1];
        }
      }
      
      // 出版日期 (PD) - 备用年份来源
      else if (line.startsWith('PD ') && !year) {
        const pdMatch = line.match(/(\d{4})/);
        if (pdMatch) {
          year = pdMatch[1];
        }
      }
      
      // 摘要 (AB)
      else if (line.startsWith('AB ')) {
        const abs: string[] = [];
        abs.push(line.replace('AB ', '').trim());
        // 处理续行（以 3 个空格开头，直到遇到新字段）
        let j = i + 1;
        while (j < lines.length && lines[j].match(/^   \S/) && !lines[j].match(/^   [A-Z][A-Z] /)) {
          const cont = lines[j].trim();
          if (cont && !cont.startsWith('RI ') && !cont.startsWith('OI ') && !cont.startsWith('C1 ')) {
            abs.push(cont);
          }
          j++;
        }
        abstract = abs.join(' ');
        i = j - 1;
      }
      
      // 关键词 (DE - Author Keywords)
      else if (line.startsWith('DE ')) {
        const kw = line.replace('DE ', '').trim();
        if (kw) {
          keywordsArr.push(...kw.split(/;/).map(k => k.trim()).filter(k => k));
        }
      }
      
      // 关键词 (ID - Keywords Plus)
      else if (line.startsWith('ID ')) {
        const kw = line.replace('ID ', '').trim();
        if (kw) {
          keywordsArr.push(...kw.split(/;/).map(k => k.trim()).filter(k => k));
        }
      }
      
      // DOI (DI) - 可选信息
      else if (line.startsWith('DI ')) {
        // DOI 可用于验证，但不在输出中显示
      }
      
      // UT (Unique Identifier) - WoS ID
      else if (line.startsWith('UT ')) {
        // WoS ID 可用于验证
      }
    }
    
    author = authors.join('; ');
    keywords = keywordsArr.join('; ');
    
    // 只添加有标题的记录
    if (title) {
      papers.push(`【文献 ${papers.length + 1}】
标题：${title}
作者：${author}
期刊：${journal}
年份：${year}
摘要：${abstract}
关键词：${keywords}`);
    }
  }
  
  logger.info('[WoS Parse] Parsed', papers.length, 'papers');
  return papers.join('\n\n');
}

function parseRisContent(content: string): string {
  const papers: string[] = [];
  const entries = content.split('\n\n');
  
  for (const entry of entries) {
    if (!entry.trim()) continue;
    
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    
    const lines = entry.split('\n');
    for (const line of lines) {
      const parts = line.match(/^([A-Z][A-Z0-9])  - (.*)$/);
      if (!parts) continue;
      
      const tag = parts[1];
      const value = parts[2];
      
      switch (tag) {
        case 'TI': title = value; break;
        case 'AU': author += (author ? '; ' : '') + value; break;
        case 'JO': case 'JF': journal = value; break;
        case 'PY': case 'Y1': year = value.split('/')[0]; break;
        case 'AB': abstract = value; break;
        case 'KW': keywords += (keywords ? '; ' : '') + value; break;
      }
    }
    
    if (title) {
      papers.push(`【文献 ${papers.length + 1}】
标题: ${title}
作者: ${author}
期刊: ${journal}
年份: ${year}
摘要: ${abstract}
关键词: ${keywords}`);
    }
  }
  
  return papers.join('\n\n');
}

function parseBibContent(content: string): string {
  const papers: string[] = [];
  const entries = content.split('@');
  
  for (let i = 1; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry.trim()) continue;
    
    let title = '', author = '', journal = '', year = '', abstract = '';
    
    const matches = entry.matchAll(/(\w+)\s*=\s*\{([^}]+)\}/g);
    for (const match of matches) {
      const key = match[1].toLowerCase();
      const value = match[2];
      
      switch (key) {
        case 'title': title = value; break;
        case 'author': author = value.replace(/ and /g, '; '); break;
        case 'journal': case 'booktitle': journal = value; break;
        case 'year': year = value; break;
        case 'abstract': abstract = value; break;
      }
    }
    
    if (title) {
      papers.push(`【文献 ${papers.length + 1}】
标题: ${title}
作者: ${author}
期刊: ${journal}
年份: ${year}
摘要: ${abstract}`);
    }
  }
  
  return papers.join('\n\n');
}

/**
 * Strip LaTeX formatting and convert to plain text
 * Removes LaTeX commands, keeps text content, handles superscripts/subscripts
 */
function stripLatexFormatting(latexContent: string): string {
  // Remove LaTeX document preamble (documentclass, usepackage, etc.)
  let text = latexContent;
  
  // Remove preamble (everything before \begin{document})
  if (text.includes('\\begin{document}')) {
    const parts = text.split('\\begin{document}');
    text = parts.length > 1 ? parts[1] : text;
  }
  
  // Remove \end{document} and everything after
  if (text.includes('\\end{document}')) {
    text = text.split('\\end{document}')[0];
  }
  
  // Remove maketitle, abstract environment
  text = text.replace(/\\maketitle/g, '');
  text = text.replace(/\\begin{abstract}.*?\\end{abstract}/gs, '');
  
  // Convert section commands to headings
  text = text.replace(/\\section\{([^}]+)\}/g, '<h1>$1</h1>');
  text = text.replace(/\\subsection\{([^}]+)\}/g, '<h2>$1</h2>');
  text = text.replace(/\\subsubsection\{([^}]+)\}/g, '<h3>$1</h3>');
  
  // Handle text formatting commands (extract content)
  text = text.replace(/\\textbf\{([^}]+)\}/g, '$1');
  text = text.replace(/\\textit\{([^}]+)\}/g, '$1');
  text = text.replace(/\\emph\{([^}]+)\}/g, '$1');
  text = text.replace(/\\underline\{([^}]+)\}/g, '$1');
  text = text.replace(/\\text\{([^}]+)\}/g, '$1');
  
  // Handle superscripts and subscripts - keep as plain text
  // $\^{}$ superscript → just the content
  text = text.replace(/\$\^([^}]+)\}/g, '$1');
  text = text.replace(/\\textsuperscript\{([^}]+)\}/g, '$1');
  // $_{}$ subscript → just the content
  text = text.replace(/\$_([^}]+)\}/g, '$1');
  text = text.replace(/\\textsubscript\{([^}]+)\}/g, '$1');
  
  // Handle inline math - convert to plain representation
  text = text.replace(/\$([^$]+)\$/g, '$1');
  text = text.replace(/\\begin{equation}.*?\\end{equation}/gs, '[公式]');
  text = text.replace(/\\begin{align}.*?\\end{align}/gs, '[公式]');
  text = text.replace(/\\begin{eqnarray}.*?\\end{eqnarray}/gs, '[公式]');
  
  // Handle citations - keep citation key as text reference
  text = text.replace(/\\cite\{([^}]+)\}/g, '[$1]');
  text = text.replace(/\\citep\{([^}]+)\}/g, '[$1]');
  text = text.replace(/\\citet\{([^}]+)\}/g, '[$1]');
  text = text.replace(/\\ref\{([^}]+)\}/g, '[$1]');
  
  // Handle figures and tables - keep caption
  text = text.replace(/\\begin{figure}.*?\\caption\{([^}]+)\}.*?\\end{figure}/gs, '[图: $1]');
  text = text.replace(/\\begin{table}.*?\\caption\{([^}]+)\}.*?\\end{table}/gs, '[表: $1]');
  
  // Remove remaining LaTeX environments
  text = text.replace(/\\begin{[^}]+}/g, '');
  text = text.replace(/\\end{[^}]+}/g, '');
  
  // Remove remaining LaTeX commands (keep content)
  text = text.replace(/\\[a-zA-Z]+\{([^}]+)\}/g, '$1');
  text = text.replace(/\\[a-zA-Z]+/g, '');
  
  // Remove remaining braces
  text = text.replace(/[{}]/g, '');
  
  // Clean up multiple spaces and newlines
  text = text.replace(/\s{2,}/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  
  // Split paragraphs and wrap in <p> tags
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  text = paragraphs.map(p => `<p>${p.trim()}</p>`).join('\n');
  
  // Escape any remaining HTML special characters in non-HTML parts
  // (we already converted section headers and added paragraph tags)
  
  return text;
}


interface LitPaper {
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

/**
 * 将任意结构的文献数据归一化为 LitPaper 标准格式。
 * 兼容 author(string) / authors(array) / keywords(string|array) / year(undefined)
 */
function normalizePaper(raw: Record<string, unknown>): LitPaper {
  // 归一化 author：优先 string.author > array.authors 拼接 > 'Unknown'
  let author = '';
  if (typeof raw['author'] === 'string' && (raw['author'] as string).trim()) {
    author = (raw['author'] as string).trim();
  } else if (Array.isArray(raw['authors'])) {
    author = (raw['authors'] as Array<unknown>)
      .map((a: unknown) => typeof a === 'string' ? a : ((a as Record<string, unknown>)['name'] as string || ''))
      .filter((s: string) => s)
      .join(', ');
  }
  if (!author) author = 'Unknown';

  // 归一化 keywords：string | string[] → string
  let keywords = '';
  const rawKw = raw['keywords'];
  if (typeof rawKw === 'string') {
    keywords = rawKw;
  } else if (Array.isArray(rawKw)) {
    keywords = (rawKw as Array<unknown>).map(String).join('; ');
  }

  // 归一化 year：确保为 string
  const rawYear = raw['year'];
  const year = rawYear != null ? String(rawYear) : '';

  return {
    citationId: typeof raw['citationId'] === 'number' ? raw['citationId'] : undefined,
    title: typeof raw['title'] === 'string' ? (raw['title'] as string).trim() : '',
    author,
    journal: typeof raw['journal'] === 'string' ? (raw['journal'] as string).trim() : '',
    year,
    abstract: typeof raw['abstract'] === 'string' ? (raw['abstract'] as string).trim() : '',
    keywords,
    doi: typeof raw['doi'] === 'string' ? (raw['doi'] as string).trim() : undefined,
    embedding: Array.isArray(raw['embedding']) ? (raw['embedding'] as number[]) : undefined,
    raw: typeof raw['raw'] === 'string' ? (raw['raw'] as string) : undefined,
  };
}

function normalizePapers(papers: Array<unknown>): LitPaper[] {
  return papers.map((p) => normalizePaper(p as Record<string, unknown>));
}

async function generateEmbeddingForPaper(
  paper: LitPaper, 
  apiUrl: string, 
  apiKey: string, 
  model: string = 'text-embedding-v4',
  maxRetries: number = 3
): Promise<number[]> {
  const kws = paper.keywords;
  const kwsStr = Array.isArray(kws) ? kws.join(' ') : (typeof kws === 'string' ? kws : '');
  const text = `${paper.title} ${kwsStr} ${paper.abstract}`.slice(0, 8000);
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30_000);
      
      let response;
      try {
        response = await fetch(`${apiUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model,
            input: text,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) {
        const data = await response.json() as { data?: Array<{ embedding: number[] }> };
        return data.data?.[0]?.embedding || [];
      }

      if (response.status === 429) {
        const delay = Math.pow(2, attempt) * 1000;
        logger.warn(`[Embedding] Rate limited (429), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      logger.warn(`[Embedding] API failed for paper "${paper.title.slice(0, 50)}...", status: ${response.status}`);
      return [];
    } catch (error: any) {
      const errMsg = error?.name === 'AbortError' ? '请求超时 (30s)' : error?.message;
      if (attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 500;
        logger.warn(`[Embedding] Error (${errMsg}), retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.error(`[Embedding] Failed after ${maxRetries} attempts for "${paper.title.slice(0, 50)}...":`, errMsg);
        return [];
      }
    }
  }
  
  return [];
}

async function generateEmbeddingsForPapers(
  papers: LitPaper[], 
  apiUrl: string, 
  apiKey: string, 
  model: string = 'text-embedding-v4'
): Promise<LitPaper[]> {
  if (!apiUrl || !apiKey) {
    logger.warn('[Embedding] No API config provided, skipping embedding generation');
    return papers;
  }

  logger.info(`[Embedding] Generating embeddings for ${papers.length} papers...`);
  
  // 初始化进度状态
  const totalBatches = Math.ceil(papers.length / 10);
  embeddingProgress = {
    status: 'processing',
    total: papers.length,
    processed: 0,
    currentBatch: 0,
    totalBatches: totalBatches,
    message: `开始生成 ${papers.length} 篇文献的向量嵌入...`,
    startTime: Date.now()
  };
  
  const papersWithEmbeddings: LitPaper[] = [];
  const batchSize = 10;
  const delayBetweenRequests = 200;
  
  for (let i = 0; i < papers.length; i += batchSize) {
    const batch = papers.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    
    // 更新进度
    embeddingProgress.currentBatch = batchNum;
    embeddingProgress.message = `正在处理第 ${batchNum}/${totalBatches} 批 (共 ${papers.length} 篇文献)`;
    logger.info(`[Embedding] Processing batch ${batchNum}/${totalBatches} (${batch.length} papers)`);
    
    for (const paper of batch) {
      const embedding = await generateEmbeddingForPaper(paper, apiUrl, apiKey, model);
      papersWithEmbeddings.push({ ...paper, embedding });
      embeddingProgress.processed++;
      
      await new Promise(resolve => setTimeout(resolve, delayBetweenRequests));
    }
  }
  
  const successCount = papersWithEmbeddings.filter(p => p.embedding && p.embedding.length > 0).length;
  logger.info(`[Embedding] Generated embeddings for ${successCount}/${papers.length} papers`);
  
  // 完成进度
  embeddingProgress.status = 'completed';
  embeddingProgress.endTime = Date.now();
  embeddingProgress.message = `完成！成功生成 ${successCount}/${papers.length} 篇文献的向量嵌入`;
  
  return papersWithEmbeddings;
}

async function mergePapersWithExisting(
  newPapers: LitPaper[],
  existingPapers: LitPaper[]
): Promise<LitPaper[]> {
  const merged = new Map<string, LitPaper>();
  
  for (const paper of existingPapers) {
    const key = `${paper.title}_${paper.year}`.toLowerCase();
    merged.set(key, paper);
  }
  
  for (const paper of newPapers) {
    const key = `${paper.title}_${paper.year}`.toLowerCase();
    const existing = merged.get(key);
    
    if (existing && existing.embedding && existing.embedding.length > 0) {
      merged.set(key, { ...paper, embedding: existing.embedding });
    } else {
      merged.set(key, paper);
    }
  }
  
  return Array.from(merged.values());
}

// 使用统一的 parseAuthors 函数（解决 C1: Author 字段格式不一致）
// 为了向后兼容，保留这个函数签名，但内部使用统一版本
function parseAuthors(authorStr: string): Array<{ name: string }> {
  const authors = unifiedParseAuthors(authorStr);
  // 确保返回格式与旧代码兼容
  return authors.map(a => ({ name: a.name }));
}

function parseLiteratureToStructured(content: string): LitPaper[] {
  // 通用字段映射表：各种格式 → 标准字段
  const FIELD_MAP: Record<string, {title: string[], author: string[], journal: string[], year: string[], abstract: string[], keywords: string[]}> = {
    // Web of Science 格式
    'wos': {
      title: ['TI  ', 'TI-'],
      author: ['AU  ', 'AU-', 'AF  ', 'AF-'],
      journal: ['SO  ', 'SO-', 'J9  ', 'J9-'],
      year: ['PY  ', 'PY-', 'Y1  ', 'Y1-'],
      abstract: ['AB  ', 'AB-'],
      keywords: ['DE  ', 'DE-', 'ID  ', 'ID-']
    },
    // CNKI 格式
    'cnki': {
      title: ['T1 ', 'TI '],
      author: ['A1 ', 'AU ', 'A3 '],
      journal: ['PB ', 'JO ', 'JF ', 'SO '],
      year: ['YR ', 'PY ', 'Y1 '],
      abstract: ['AB '],
      keywords: ['K1 ', 'KW ']
    },
    // RefWorks/EndNote 格式
    'refworks': {
      title: ['TI  -', 'T1  -'],
      author: ['AU  -', 'A1  -', 'AF  -'],
      journal: ['SO  -', 'JO  -', 'JF  -'],
      year: ['PY  -', 'Y1  -'],
      abstract: ['AB  -', 'N2  -'],
      keywords: ['KW  -', 'K1  -']
    }
  };
  
  const papers: LitPaper[] = [];
  
  // 分割记录：支持多种分隔方式
  const separators = [
    /^ER\s*$/m,           // WoS: ER 单独一行（修复：支持 ER\n, ER \n）
    /(?=^RT\s)/m,         // CNKI: RT 开头
    /(?=%\s*\d)/,         // RefWorks: % 数字
    /(?=^TY\s*-\s*JOUR)/m // RefWorks: TY  - JOUR
  ];
  
  let entries: string[] = [];
  for (const sep of separators) {
    if (content.match(sep)) {
      entries = content.split(sep);
      break;
    }
  }
  
  // 如果没有找到分隔符，尝试按空行分割
  if (entries.length <= 1) {
    entries = content.split(/\n\s*\n/).filter(e => e.trim().length > 10);
  }
  
    for (const entry of entries) {
      if (!entry.trim() || entry.length < 20) continue;
      
      const lines = entry.split('\n');
      let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
      const authors: string[] = [];
      const keywordsArr: string[] = [];
      let currentField: 'author' | null = null;
      
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        // 检查是否是续行（缩进但不是新字段）
        const isContinuation = line.match(/^\s{3,}/) && !trimmed.includes('  -');
        
        // 标题
        if (trimmed.startsWith('TI ') || trimmed.startsWith('TI-') || trimmed.startsWith('T1 ')) {
          title = trimmed.replace(/^(TI|T1)\s*-?\s*/, '').trim();
          let j = lineIndex + 1;
          while (j < lines.length && lines[j].match(/^   \S/)) {
            title += ' ' + lines[j].trim();
            j++;
          }
          lineIndex = j - 1;
          currentField = null;
        }
        // 作者
        else if (trimmed.startsWith('AU ') || trimmed.startsWith('AU-') || 
                 trimmed.startsWith('A1 ') || trimmed.startsWith('AF ') || trimmed.startsWith('AF-')) {
          const au = trimmed.replace(/^(AU|A1|AF)\s*-?\s*/, '').trim();
          if (au && !authors.includes(au)) authors.push(au);
          currentField = 'author';
        }
        // 其他作者 (CNKI A3 或 WoS 续行)
        else if (trimmed.startsWith('A3 ')) {
          const aus = trimmed.replace(/^A3\s*/, '').trim();
          if (aus) {
            authors.push(...aus.split(/[;]/).map(a => a.trim()).filter(a => a));
          }
          currentField = 'author';
        }
        // 续行处理：如果是作者字段的续行
        else if (isContinuation && currentField === 'author') {
          // WoS 格式：续行是作者名的 continuation
          const cont = trimmed.replace(/^,\s*/, '').trim();
          if (cont && authors.length > 0) {
            // 追加到最后一个作者
            const lastAuthor = authors[authors.length - 1];
            authors[authors.length - 1] = lastAuthor + ' ' + cont;
          }
        }
        // 期刊
        else if (trimmed.startsWith('SO ') || trimmed.startsWith('SO-') || 
                 trimmed.startsWith('PB ') || trimmed.startsWith('JO ') || trimmed.startsWith('JF ')) {
          if (!journal) {
            journal = trimmed.replace(/^(SO|PB|JO|JF)\s*-?\s*/, '').trim();
          }
          currentField = null;
        }
        // 年份
        else if (trimmed.startsWith('PY ') || trimmed.startsWith('PY-') || 
                 trimmed.startsWith('YR ') || trimmed.startsWith('Y1 ')) {
          if (!year) {
            year = trimmed.replace(/^(PY|YR|Y1)\s*-?\s*/, '').trim().substring(0, 4);
          }
          currentField = null;
        }
        // 摘要
        else if (trimmed.startsWith('AB ') || trimmed.startsWith('AB-')) {
          if (!abstract) {
            abstract = trimmed.replace(/^AB\s*-?\s*/, '').trim();
          }
          currentField = null;
        }
        // 关键词
        else if (trimmed.startsWith('DE ') || trimmed.startsWith('DE-') || 
                 trimmed.startsWith('ID ') || trimmed.startsWith('ID-') ||
                 trimmed.startsWith('KW ') || trimmed.startsWith('K1 ')) {
          const kw = trimmed.replace(/^(DE|ID|KW|K1)\s*-?\s*/, '').trim();
          if (kw) {
            // 支持分号或逗号分隔的多个关键词
            keywordsArr.push(...kw.split(/[;,,]/).map(k => k.trim()).filter(k => k));
          }
          currentField = null;
        }
        else {
          currentField = null;
        }
      }
      
      // 只添加有标题的记录
      if (title && !title.startsWith('FN ') && !title.startsWith('VR ') && !title.startsWith('ER')) {
        papers.push({
          title,
          author: authors.join(', '),
          journal,
          year,
          abstract,
          keywords: keywordsArr.join(', '),
          raw: entry
        });
      }
    }
  
  logger.info('[Parse] Parsed', papers.length, 'papers');
  return papers;
}

// Web of Science 格式解析
function parseWoSFormat(content: string): LitPaper[] {
  const papers: LitPaper[] = [];
  const entries = content.split(/\nER\s*\n/);
  
  for (const entry of entries) {
    if (!entry.trim() || !entry.includes('TI  -')) continue;
    
    const lines = entry.split('\n');
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    let authors: string[] = [];
    let keywordsArr: string[] = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('TI  -')) {
        title = line.replace(/^TI\s*-\s*/, '').trim();
      } else if (line.startsWith('AU  -')) {
        const au = line.replace(/^AU\s*-\s*/, '').trim();
        if (au) authors.push(au);
      } else if (line.startsWith('AF  -')) {
        const af = line.replace(/^AF\s*-\s*/, '').trim();
        if (af && !authors.includes(af)) authors.push(af);
      } else if (line.startsWith('SO  -')) {
        journal = line.replace(/^SO\s*-\s*/, '').trim();
      } else if (line.startsWith('PY  -')) {
        year = line.replace(/^PY\s*-\s*/, '').trim().substring(0, 4);
      } else if (line.startsWith('AB  -')) {
        abstract = line.replace(/^AB\s*-\s*/, '').trim();
        // 多行摘要
        let j = i + 1;
        while (j < lines.length && lines[j].startsWith('   ')) {
          abstract += ' ' + lines[j].trim();
          j++;
        }
      } else if (line.startsWith('DE  -') || line.startsWith('ID  -')) {
        const kw = line.replace(/^(DE|ID)\s*-\s*/, '').trim();
        if (kw) keywordsArr.push(kw);
      }
    }
    
    author = authors.join(', ');
    keywords = keywordsArr.join(', ');
    
    if (title) {
      papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
    }
  }
  
  return papers;
}

// CNKI/RefWorks 格式解析（知网导出格式）
// 支持两种格式:
// 1. 标准 RefWorks: TY  -, AU  -, TI  -, AB  -
// 2. CNKI 专用：RT, A1, A3, T1, K1, YR, PB, DS CNKI
function parseCNKIFormat(content: string): LitPaper[] {
  const papers: LitPaper[] = [];
  
  // 检测是否为 CNKI 专用格式（有 RT 和 DS CNKI 标识）
  if (content.includes('DS CNKI') || content.includes('DS cnki')) {
    // CNKI 专用格式：按 RT (Reference Type) 分割记录
    const entries = content.split(/(?=^RT\s)/m);
    
    for (const entry of entries) {
      if (!entry.trim() || (!entry.includes('T1 ') && !entry.includes('TI '))) continue;
      
      const lines = entry.split('\n');
      let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
      let authors: string[] = [];
      let keywordsArr: string[] = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        // 标题
        if (trimmed.startsWith('T1 ') || trimmed.startsWith('TI ')) {
          title = trimmed.replace(/^(T1|TI)\s*/, '').trim();
        }
        // 第一作者
        else if (trimmed.startsWith('A1 ')) {
          const au = trimmed.replace(/^A1\s*/, '').trim();
          if (au) authors.push(au);
        }
        // 其他作者
        else if (trimmed.startsWith('A3 ')) {
          const aus = trimmed.replace(/^A3\s*/, '').trim();
          if (aus) {
            authors.push(...aus.split(/[;]/).map(a => a.trim()).filter(a => a));
          }
        }
        // 期刊/出版社
        else if (trimmed.startsWith('PB ') || trimmed.startsWith('JO ') || trimmed.startsWith('JF ')) {
          journal = trimmed.replace(/^(PB|JO|JF)\s*/, '').trim();
        }
        // 年份
        else if (trimmed.startsWith('YR ') || trimmed.startsWith('PY ')) {
          year = trimmed.replace(/^(YR|PY)\s*/, '').trim().substring(0, 4);
        }
        // 摘要
        else if (trimmed.startsWith('AB ')) {
          abstract = trimmed.replace(/^AB\s*/, '').trim();
        }
        // 关键词（K1 可能有多个，用分号分隔）
        else if (trimmed.startsWith('K1 ')) {
          const kw = trimmed.replace(/^K1\s*/, '').trim();
          if (kw) {
            keywordsArr.push(...kw.split(/[;]/).map(k => k.trim()).filter(k => k));
          }
        }
      }
      
      author = authors.join(', ');
      keywords = keywordsArr.join(', ');
      
      if (title) {
        papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
      }
    }
  } else {
    // 标准 RefWorks 格式
    const entries = content.split(/(?=%\s*\d)|(?=^TY\s*-\s*JOUR)|(?=^TY\s*-\s*CONF)/m);
    
    for (const entry of entries) {
      if (!entry.trim() || !entry.includes('TI  -')) continue;
      
      const lines = entry.split('\n');
      let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
      let authors: string[] = [];
      let keywordsArr: string[] = [];
      
      for (const line of lines) {
        const trimmed = line.trim();
        
        if (trimmed.startsWith('TI  -') || trimmed.startsWith('T1  -')) {
          title = trimmed.replace(/^(TI|T1)\s*-\s*/, '').trim();
        } else if (trimmed.startsWith('AU  -') || trimmed.startsWith('A1  -')) {
          const au = trimmed.replace(/^(AU|A1)\s*-\s*/, '').trim();
          if (au) authors.push(au);
        } else if (trimmed.startsWith('AF  -')) {
          const af = trimmed.replace(/^AF\s*-\s*/, '').trim();
          if (af && !authors.includes(af)) authors.push(af);
        } else if (trimmed.startsWith('SO  -') || trimmed.startsWith('JO  -') || trimmed.startsWith('JF  -')) {
          journal = trimmed.replace(/^(SO|JO|JF)\s*-\s*/, '').trim();
        } else if (trimmed.startsWith('PY  -') || trimmed.startsWith('Y1  -')) {
          year = trimmed.replace(/^(PY|Y1)\s*-\s*/, '').trim().substring(0, 4);
        } else if (trimmed.startsWith('AB  -') || trimmed.startsWith('N2  -')) {
          abstract = trimmed.replace(/^(AB|N2)\s*-\s*/, '').trim();
        } else if (trimmed.startsWith('KW  -') || trimmed.startsWith('K1  -')) {
          const kw = trimmed.replace(/^(KW|K1)\s*-\s*/, '').trim();
          if (kw) keywordsArr.push(kw);
        }
      }
      
      author = authors.join(', ');
      keywords = keywordsArr.join(', ');
      
      if (title) {
        papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
      }
    }
  }
  
  return papers;
}

// 原有中文格式解析（保持兼容）
function parseChineseFormat(content: string): LitPaper[] {
  const papers: LitPaper[] = [];
  const entries = content.split('  [文献');
  
  for (const entry of entries) {
    if (!entry.trim()) continue;
    
    const lines = entry.split('\n');
    let title = '', author = '', journal = '', year = '', abstract = '', keywords = '';
    
    for (const line of lines) {
      if (line.startsWith('标题:')) title = line.replace('标题:', '').trim();
      else if (line.startsWith('作者:')) author = line.replace('作者:', '').trim();
      else if (line.startsWith('期刊:')) journal = line.replace('期刊:', '').trim();
      else if (line.startsWith('年份:')) year = line.replace('年份:', '').trim();
      else if (line.startsWith('摘要:')) abstract = line.replace('摘要:', '').trim();
      else if (line.startsWith('关键词:')) keywords = line.replace('关键词:', '').trim();
    }
    
    if (title) {
      papers.push({ title, author, journal, year, abstract, keywords, raw: entry });
    }
  }
  
  return papers;
}

interface LitInfo {
  count: number;
  years: string[];
  journals: string[];
  keywords: string[];
}

function getLitSummary(content: string): LitInfo {
  const years: string[] = [];
  const journals: string[] = [];
  const keywords: string[] = [];
  let count = 0;
  
  const separators = [/^ER\s*$/m, /(?=^RT\s)/m, /(?=%\s*\d)/, /(?=^TY\s*-\s*JOUR)/m];
  let entries: string[] = [];
  
  for (const sep of separators) {
    if (content.match(sep)) {
      entries = content.split(sep);
      break;
    }
  }
  
  if (entries.length <= 1) {
    entries = content.split(/\n\s*\n/).filter(e => e.trim().length > 10);
  }
  
  for (const entry of entries) {
    if (!entry.trim() || entry.length < 20) continue;
    
    const hasTitle = entry.match(/^(TI|T1)\s*-?\s*/m);
    if (!hasTitle) continue;
    
    count++;
    
    const yearMatch = entry.match(/^(PY|YR|Y1)\s*-?\s*(\d{4})/m);
    if (yearMatch) years.push(yearMatch[2]);
    
    const journalMatch = entry.match(/^(SO|PB|JO|JF)\s*-?\s*([^\n]+)/m);
    if (journalMatch) {
      const j = journalMatch[2].trim();
      if (j && j.length < 100 && !journals.includes(j)) journals.push(j);
    }
    
    const kwMatches = entry.match(/^(DE|ID|KW|K1)\s*-?\s*([^\n]+)/gm);
    if (kwMatches) {
      for (const kw of kwMatches) {
        const cleaned = kw.replace(/^(DE|ID|KW|K1)\s*-?\s*/, '').trim();
        if (cleaned) {
          keywords.push(...cleaned.split(/[;,,]/).map(k => k.trim()).filter(k => k));
        }
      }
    }
  }
  
  return {
    count,
    years: [...new Set(years)].sort(),
    journals: [...new Set(journals)].slice(0, 10),
    keywords: [...new Set(keywords)].slice(0, 20)
  };
}

interface SearchResult {
  paper: LitPaper;
  score: number;
  vectorScore: number;
  lexicalScore: number;
  matchFields: string[];
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  const length = Math.min(a.length, b.length);
  
  for (let i = 0; i < length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function simpleEmbedding(text: string, dimensions: number = 1536): number[] {
  const normalized = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
  const tokens = normalized.split(/\s+/).filter(t => t.length > 1);
  
  const embedding: number[] = new Array(dimensions).fill(0);
  const tokenSet = new Set(tokens);
  
  for (const token of tokenSet) {
    let hash = 0;
    for (let i = 0; i < token.length; i++) {
      hash = ((hash << 5) - hash) + token.charCodeAt(i);
      hash = hash & hash;
    }
    
    const index = Math.abs(hash) % dimensions;
    const tf = tokens.filter(t => t === token).length / tokens.length;
    embedding[index] = tf;
  }
  
  const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
  
  if (magnitude > 0) {
    return embedding.map(val => val / magnitude);
  }
  
  return embedding;
}

interface CitationInfo {
  author: string;
  year: string;
  fullMatch: string;
}

function extractCitations(content: string): CitationInfo[] {
  const citations: CitationInfo[] = [];
  const seen = new Set<string>();
  
  const regex = /\(([A-Z][a-zA-Z]+(?:\s+et\s+al\.)?),?\s*(\d{4})[a-z]?\)/g;
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    const author = match[1].trim();
    const year = match[2];
    const key = `${author}_${year}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ author, year, fullMatch: match[0] });
    }
  }
  
  return citations;
}

function findPaperByCitation(citation: CitationInfo, papers: LitPaper[]): LitPaper | undefined {
  const authorName = citation.author.toLowerCase().replace(' et al.', '');
  
  for (const paper of papers) {
    const paperAuthors = (paper.author || '').toLowerCase();
    const paperYear = String(paper.year || '');
    
    if (paperAuthors.includes(authorName) && paperYear === citation.year) {
      return paper;
    }
  }
  
  return undefined;
}

function formatReference(paper: LitPaper, index: number): string {
  const authors = paper.author || 'Unknown';
  const year = paper.year || 'n.d.';
  const title = paper.title || 'Untitled';
  const journal = paper.journal || '';
  const doi = paper.doi || '';
  
  let ref = `\\bibitem{ref${index}} ${authors} (${year}). ${title}.`;
  
  if (journal) {
    ref += ` \\textit{${journal}}`;
  }
  
  if (doi) {
    ref += `, ${doi}`;
  }
  
  return ref;
}

function generateBibliography(content: string, papers: LitPaper[]): { bibliography: string; stats: { totalCitations: number; matched: number; unmatched: number } } {
  const citations = extractCitations(content);
  
  if (citations.length === 0) {
    return { bibliography: '', stats: { totalCitations: 0, matched: 0, unmatched: 0 } };
  }
  
  const matchedPapers: LitPaper[] = [];
  const unmatchedCitations: CitationInfo[] = [];
  
  for (const citation of citations) {
    const paper = findPaperByCitation(citation, papers);
    if (paper) {
      matchedPapers.push(paper);
    } else {
      unmatchedCitations.push(citation);
    }
  }
  
  if (matchedPapers.length === 0) {
    logger.warn(`[Bibliography] No matched papers found for ${citations.length} citations`);
    return { bibliography: '', stats: { totalCitations: citations.length, matched: 0, unmatched: citations.length } };
  }
  
  let bibliography = '\\section*{References}\n\\begin{thebibliography}{99}\n\n';
  
  matchedPapers.forEach((paper, index) => {
    bibliography += formatReference(paper, index + 1) + '\n\n';
  });
  
  bibliography += '\\end{thebibliography}';
  
  const stats = {
    totalCitations: citations.length,
    matched: matchedPapers.length,
    unmatched: unmatchedCitations.length
  };
  
  logger.info(`[Bibliography] Generated with ${stats.matched}/${stats.totalCitations} citations matched`);
  
  if (unmatchedCitations.length > 0) {
    logger.warn(`[Bibliography] Unmatched citations: ${unmatchedCitations.map(c => `${c.author} ${c.year}`).join(', ')}`);
  }
  
  return { bibliography, stats };
}

function searchLiterature(query: string, papers: LitPaper[], maxResults: number = 10): SearchResult[] {
  const queryLower = query.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(w => w.length > 1);

  const results: SearchResult[] = [];
  
  for (const paper of papers) {
    let lexicalScore = 0;
    const matchFields: string[] = [];
    
    const titleLower = (paper.title || '').toLowerCase();
    const abstractLower = (paper.abstract || '').toLowerCase();
    const keywordsLower = Array.isArray(paper.keywords) ? paper.keywords.join(' ').toLowerCase() : (paper.keywords || '').toLowerCase();
    const authorLower = (paper.author || '').toLowerCase();
    const journalLower = (paper.journal || '').toLowerCase();
    
    for (const word of queryWords) {
      if (titleLower.includes(word)) {
        lexicalScore += 10;
        if (!matchFields.includes('title')) matchFields.push('title');
      }
      if (keywordsLower.includes(word)) {
        lexicalScore += 8;
        if (!matchFields.includes('keywords')) matchFields.push('keywords');
      }
      if (abstractLower.includes(word)) {
        lexicalScore += 5;
        if (!matchFields.includes('abstract')) matchFields.push('abstract');
      }
      if (authorLower.includes(word)) {
        lexicalScore += 3;
        if (!matchFields.includes('author')) matchFields.push('author');
      }
      if (journalLower.includes(word)) {
        lexicalScore += 2;
        if (!matchFields.includes('journal')) matchFields.push('journal');
      }
    }
    
    const yearMatch = query.match(/\d{4}/);
    if (yearMatch && (paper.year || '').includes(yearMatch[0])) {
      lexicalScore += 4;
      matchFields.push('year');
    }
    
    const vectorScore = 0;
    const combinedScore = lexicalScore;
    
    if (combinedScore > 0) {
      results.push({ 
        paper, 
        score: combinedScore, 
        vectorScore,
        lexicalScore,
        matchFields 
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, maxResults);
}

// 代码直接控制：检索文献并格式化为标准引用格式
function getReferencesForWriting(
  query: string, 
  papers: LitPaper[], 
  maxResults: number = 10
): { 
  references: string; 
  papers: SearchResult[];
  formattedCitations: string[];
} {
  const searchResults = searchLiterature(query, papers, maxResults);
  
  if (searchResults.length === 0) {
    return { references: "", papers: [], formattedCitations: [] };
  }
  
  const formattedCitations: string[] = [];
  
  searchResults.forEach((result) => {
    const paper = result.paper;
    const rawAuthors = ((paper as unknown) as Record<string, unknown>)['authors'];
    const authorStr = paper.author
      || (Array.isArray(rawAuthors) ? (rawAuthors as Array<unknown>).map((a: unknown) => typeof a === 'string' ? a : ((a as Record<string, unknown>)['name'] || '')).join(', ') : '')
      || 'Unknown';
    const authors = authorStr.split(/[,;]/).map((a: string) => a.trim()).filter((a: string) => a);
    const firstAuthor = authors[0] || 'Unknown';
    const authorLastName = firstAuthor.split(/\s+/).pop() || firstAuthor;
    
    let citationText = "";
    if (authors.length >= 2) {
      citationText = `(${authorLastName} et al., ${paper.year || 'n.d.'})`;
    } else {
      citationText = `(${authorLastName}, ${paper.year || 'n.d.'})`;
    }
    
    formattedCitations.push(citationText);
  });
  
  let referencesText = `【代码自动检索的前${searchResults.length}篇相关文献】\n\n`;
  referencesText += `**检索关键词：** ${query}\n`;
  referencesText += `**文献总数：** ${searchResults.length} 篇（按相关度排序）\n\n`;
  referencesText += `**可用的引用格式（必须严格使用）：**\n`;
  formattedCitations.forEach((c, i) => {
    referencesText += `${i + 1}. ${c}\n`;
  });
  referencesText += `\n**文献详细信息（AI撰写时必须参考）：**\n\n`;
  
  searchResults.forEach((result, index) => {
    const paper = result.paper;
    referencesText += `文献 ${index + 1}（相关度：${result.score.toFixed(2)}）：\n`;
    referencesText += `  标题：${paper.title}\n`;
    referencesText += `  作者：${paper.author}\n`;
    referencesText += `  年份：${paper.year}\n`;
    referencesText += `  期刊：${paper.journal}\n`;
    referencesText += `  DOI：${paper.doi || 'N/A'}\n`;
    referencesText += `  关键词：${paper.keywords}\n`;
    referencesText += `  摘要：${paper.abstract || '无'}\n`;
    referencesText += `  引用格式：${formattedCitations[index]}\n\n`;
  });
  
  referencesText += `**⚠️ 严格要求：**\n`;
  referencesText += `- AI只能使用上述列表中的文献\n`;
  referencesText += `- 必须保持作者、年份、标题完全一致\n`;
  referencesText += `- 严禁自行编造或修改任何信息\n`;
  referencesText += `- 摘要可用于理解内容，但不得编造原文中不存在的细节\n`;
  referencesText += `- 引用时必须使用指定的引用格式\n`;
  
  logger.info(`[References] Auto-generated ${searchResults.length} references for query: ${query}`);
  
  return { references: referencesText, papers: searchResults, formattedCitations };
}

// 从用户消息中提取需要检索的句子
function extractSentencesFromMessage(message: string): string[] {
  const sentences: string[] = [];
  
  // 模式1: 引号中的内容 "xxx" 或 "xxx"
  const quotePatterns = [
    /[""]([^""]+)[""]/g,
    /[""]([^""]+)[""]/g,
  ];
  
  for (const pattern of quotePatterns) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length > 5) {
        sentences.push(match[1].trim());
      }
    }
  }
  
  // 模式2: 数字编号列表 1. xxx 2. xxx
  const numberedPattern = /\d+[.．、]\s*([^\n]+)/g;
  const numberedMatches = message.matchAll(numberedPattern);
  for (const match of numberedMatches) {
    if (match[1] && match[1].length > 5) {
      sentences.push(match[1].trim());
    }
  }
  
  // 模式3: 换行分隔的句子（长度>10的独立行）
  const lines = message.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 10 && trimmed.length < 200 && !trimmed.startsWith('#')) {
      // 检查是否已经是引号内容（避免重复）
      if (!sentences.includes(trimmed)) {
        sentences.push(trimmed);
      }
    }
  }
  
  // 去重并返回
  return [...new Set(sentences)].slice(0, 10); // 最多10个句子
}

async function retrieveBilingualDocuments(
  engine: HybridRetrievalEngine,
  sentence: string,
  topK = 5,
  topic?: string
): Promise<any[]> {
  const variants = buildBilingualRetrievalQueries({
    sentence,
    topic,
    keywordsEn: [sentence, topic || ''].filter(Boolean),
    keywordsCn: [sentence, topic || ''].filter(value => /[\u4e00-\u9fff]/.test(value)),
  });
  const groups: any[][] = [];
  for (const variant of variants) {
    const queryResults = await engine.retrieve({
      query: variant.query,
      topK: Math.min(80, Math.max(topK * 4, 20)),
      searchMode: 'hybrid',
    });
    const mapped = queryResults.results.map(doc => ({
      ...doc,
      retrievalPath: variant.label,
      retrievalLanguage: variant.language,
      retrievalQuery: variant.query,
    }));
    groups.push(filterRetrievedResultsForLanguage(mapped, variant.language, topK));
  }

  return interleaveRetrievedResultGroups(groups, topK);
}

function buildRetrievedResultKey(item: any): string {
  return String(item?.doi || item?.title || item?.id || '').trim().toLowerCase();
}

function inferRetrievedDocumentLanguage(item: any): 'en' | 'zh' | 'mixed' | 'unknown' {
  const source = String(item?.source || '').toLowerCase();
  if (/cnki|中文|china national knowledge/.test(source)) return 'zh';
  if (/wos|web of science|pubmed|scopus|crossref|openalex|semantic/.test(source)) return 'en';

  const text = [
    item?.title,
    item?.abstract,
    item?.journal,
    Array.isArray(item?.keywords) ? item.keywords.join(' ') : item?.keywords,
  ].filter(Boolean).join(' ');
  const chineseCount = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latinWordCount = (text.match(/[a-zA-Z]{3,}/g) || []).length;
  if (chineseCount > 0 && latinWordCount > 0) {
    return chineseCount >= latinWordCount ? 'zh' : 'en';
  }
  if (chineseCount > 0) return 'zh';
  if (latinWordCount > 0) return 'en';
  return 'unknown';
}

function filterRetrievedResultsForLanguage(items: any[], language: 'en' | 'zh', limit: number): any[] {
  const preferred = items.filter(item => {
    const inferred = inferRetrievedDocumentLanguage(item);
    return language === 'zh' ? inferred === 'zh' : inferred === 'en';
  });
  if (preferred.length > 0) return preferred.slice(0, Math.max(limit, 1));

  // 如果该语言路径确实没有匹配文献，保留少量原结果作为兜底，同时让 retrievalLanguage 标记真实路径。
  return items.slice(0, Math.max(limit, 1));
}

function interleaveRetrievedResultGroups(groups: any[][], limit: number): any[] {
  const safeLimit = Math.max(0, Math.floor(limit || 0));
  if (safeLimit <= 0) return [];
  const seen = new Set<string>();
  const output: any[] = [];
  const sortedGroups = groups
    .map(group => group.slice().sort((a, b) => Number(b.combinedScore || b.score || 0) - Number(a.combinedScore || a.score || 0)))
    .filter(group => group.length > 0);
  const maxLength = Math.max(0, ...sortedGroups.map(group => group.length));

  for (let index = 0; index < maxLength && output.length < safeLimit; index++) {
    for (const group of sortedGroups) {
      const item = group[index];
      if (!item) continue;
      const key = buildRetrievedResultKey(item);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      output.push(item);
      if (output.length >= safeLimit) break;
    }
  }

  if (output.length >= safeLimit) return output;
  const fillItems = sortedGroups
    .flat()
    .sort((a, b) => Number(b.combinedScore || 0) - Number(a.combinedScore || 0))
    .filter(item => {
      const key = buildRetrievedResultKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, safeLimit - output.length);
  return output.concat(fillItems);
}

async function webSearch(query: string, numResults: number = 10, customUrl?: string, customKey?: string): Promise<string> {
  const apiKey = customKey || exaApiKey;
  
  if (!apiKey) {
    logger.warn("[WebSearch] No API key configured");
    return '';
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: query,
        max_results: numResults,
        include_answer: true,
        include_raw_content: true,
      }),
    });

    if (!response.ok) {
      logger.error("[WebSearch] Tavily API error:", response.status);
      return '';
    }

    const data = await response.json() as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        raw_content?: string;
        score?: number;
      }>;
    };

    if (!data.results || data.results.length === 0) {
      return '';
    }

    let context = '=== Web Search Results ===\n\n';
    for (let i = 0; i < Math.min(data.results.length, 10); i++) {
      const r = data.results[i];
      const content = r.raw_content || r.content || 'N/A';
      context += `[${i + 1}] ${r.title}\n`;
      context += `URL: ${r.url}\n`;
      context += `Content: ${content}\n\n`;
    }

    logger.info("[WebSearch] Found", data.results.length, "results for:", query);
    return context;
  } catch (e) {
    logger.error("[WebSearch] Error:", e);
    return '';
  }
}

async function processChatMessage(userId: string, userMessage: string, externalHistory?: Array<{ role: string; content: string }>): Promise<string> {
  // 统一用户 ID：所有用户（飞书 + Web UI）共用同一个 "web-user" ID
  // 这样飞书和 Web UI 用户可以共享记忆、文献库、写作进度等所有数据
  const unifiedUserId = sanitizeUserId(userId || "web-user");
  const userSkillInvocation = await parseUserSkillInvocation(unifiedUserId, userMessage);
  const messageForTask = userSkillInvocation.cleanMessage || userMessage;
  const userSkillPrompt = userSkillInvocation.promptBlock;
  
  const model = currentModel;
  const webSearchKey = currentWebSearchKey;
  const useApiUrl = currentApiUrl;
  const useApiKey = currentApiKey;
  
  // 同步最新 API 配置到 ConversationFlow（解决打包后前端改配置不生效的问题）
  if (globalConversationFlow) {
    globalConversationFlow.updateApiConfig(useApiUrl, useApiKey);
  }
  
  logger.info(`[ChatProcessor] Processing for ${userId} (unified: ${unifiedUserId}): ${messageForTask.substring(0, 50)}...`);
  if (userSkillInvocation.invokedSkills.length > 0) {
    logger.info(`[UserSkills] Local chat invoked skills: ${userSkillInvocation.invokedSkills.map(skill => `/${skill.trigger}`).join(', ')}`);
  }
  logger.info(`[ChatProcessor] Using API: ${useApiUrl}, Model: ${model}`);
  
  // 如果传入了外部历史，使用它；否则使用内部状态
  const history = externalHistory || conversationHistory.get(unifiedUserId) || [];
  if (externalHistory) {
    logger.info(`[ChatProcessor] Using external history: ${externalHistory.length} messages`);
  }
  
  const userMemory = await loadUserMemory(unifiedUserId);
  let memoryContext = "";
  let writingProgressContext = "";
  
  if (userMemory.entries.length > 0) {
    const writingProgressEntry = userMemory.entries.find(e => e.key === 'writing_progress');
    const completedChaptersEntry = userMemory.entries.find(e => e.key === 'completed_chapters');
    const pendingChaptersEntry = userMemory.entries.find(e => e.key === 'pending_chapters');
    
    if (writingProgressEntry || completedChaptersEntry || pendingChaptersEntry) {
      writingProgressContext = "\n## 📝 当前写作进度\n";
      if (writingProgressEntry?.value && writingProgressEntry.value !== "无") {
        writingProgressContext += `**整体进度**: ${writingProgressEntry.value}\n`;
      }
      if (completedChaptersEntry?.value && completedChaptersEntry.value !== "无") {
        writingProgressContext += `**已完成章节**: ${completedChaptersEntry.value}\n`;
      }
      if (pendingChaptersEntry?.value && pendingChaptersEntry.value !== "无") {
        writingProgressContext += `**待完成章节**: ${pendingChaptersEntry.value}\n`;
      }
    }

    memoryContext = "\n## 🧠 跨会话长期记忆（完整）\n";
    for (const entry of userMemory.entries) {
      if (!['writing_progress', 'completed_chapters', 'pending_chapters'].includes(entry.key)) {
        memoryContext += `- ${entry.key}: ${entry.value}\n`;
      }
    }
  }

  // 使用统一的路径管理模块获取用户文献路径
  const userDir = getUserUploadDir(unifiedUserId);
  const litFile = getUserLiteratureTxtPath(unifiedUserId);
  const litJsonFile = getUserLiteraturePath(unifiedUserId);
  
  let literaturePapers: LitPaper[] = [];
  let literatureSummary = "";
  let hasLiterature = false;
  
  if (fs.existsSync(litFile)) {
    hasLiterature = true;
    if (fs.existsSync(litJsonFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
        // literature.json may be a raw array or wrapped as { papers: [...] }
        const rawPapers = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.papers) ? parsed.papers : []);
        literaturePapers = normalizePapers(rawPapers);
      } catch (e) {
        const litContent = fs.readFileSync(litFile, 'utf-8');
        literaturePapers = parseLiteratureToStructured(litContent);
      }
    } else {
      const litContent = fs.readFileSync(litFile, 'utf-8');
      literaturePapers = parseLiteratureToStructured(litContent);
    }
    
    const summary = getLitSummary(fs.readFileSync(litFile, 'utf-8'));
    literatureSummary = `文献总数: ${summary.count} 篇, 年份: ${summary.years.join(", ")}, 期刊: ${summary.journals.slice(0, 5).join(", ")}`;
    
    // 将文献索引到用户检索引擎（仅在尚未索引时）
    if (literaturePapers.length > 0 && globalRetrievalEngine.getDocumentCount() === 0) {
      try {
        // 使用统一的规范化函数（解决 C1, C2, D1）
        const unifiedLiteratures = literaturePapers.map((paper, index) => {
          // LitPaper 转 Record<string, unknown>
          const paperRecord: Record<string, unknown> = {
            title: paper.title,
            author: paper.author,
            year: paper.year,
            abstract: paper.abstract,
            keywords: paper.keywords,
            doi: paper.doi,
            embedding: paper.embedding,
            citationId: paper.citationId,
          };
          const sourceType = inferSourceType(paperRecord.source as string || '', paper.abstract);
          const source = sourceType === 'unknown' ? 'wos' : sourceType;
          return normalizeLiterature(paperRecord, index, source as 'wos' | 'cnki' | 'ris' | 'bib');
        });
        
        // 获取用户检索引擎（解决 C5）
        const userEngine = await retrievalEngineManager.getEngine(unifiedUserId);
        
        // Use addDocuments (incremental) instead of index (destructive clear+rebuild)
        await userEngine.addDocuments(unifiedLiteratures);
        logger.info(`[ChatProcessor] Indexed ${unifiedLiteratures.length} papers for user ${unifiedUserId}`);
        
        // 更新全局引用（向后兼容 web-user）
        if (unifiedUserId === 'web-user') {
          globalRetrievalEngine = userEngine;
        }
        
        // 使用统一的路径管理模块获取缓存目录
        const cacheDir = getIndexCacheDir(unifiedUserId);
        userEngine.saveIndex(cacheDir);
        logger.info(`[ChatProcessor] Saved index cache`);
      } catch (indexError) {
        logger.warn('[ChatProcessor] Failed to index papers to retrieval engine:', indexError);
      }
    } else if (literaturePapers.length > 0) {
      logger.info(`[ChatProcessor] Retrieval engine already has ${globalRetrievalEngine.getDocumentCount()} documents, skipping re-index`);
    }
  }
  
  let journalStyleContent = "";
  let journalStyleHint = "";
  const journalStyleDir = path.join(userDir, "journal-styles");
  if (fs.existsSync(journalStyleDir)) {
    const styleFiles = fs.readdirSync(journalStyleDir);
    if (styleFiles.length > 0) {
      const latestStyle = styleFiles.sort().pop();
      if (latestStyle) {
        const stylePath = path.join(journalStyleDir, latestStyle, "style.json");
        if (fs.existsSync(stylePath)) {
          try {
            const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
            journalStyleContent = "\n## 目标期刊风格指南\n";
            journalStyleContent += `已分析 ${styleData.length} 篇论文的写作风格。\n\n`;
            for (let i = 0; i < Math.min(styleData.length, 2); i++) {
              const paper = styleData[i];
              journalStyleContent += `### 文献 ${i + 1}: ${paper.paper_title}\n`;
              journalStyleContent += `期刊：${paper.journal}, 年份：${paper.year}\n`;
              if (paper.overall_style) {
                journalStyleContent += `风格：${paper.overall_style.formality || ''}, 语气：${paper.overall_style.argument_tone || ''}\n`;
              }
              if (paper.transferable_rules && paper.transferable_rules.length > 0) {
                journalStyleContent += `规则：${paper.transferable_rules.slice(0, 3).join('; ')}\n`;
              }
              journalStyleContent += "\n";
            }
            journalStyleHint = "\n你需要参考上述目标期刊的写作风格。\n";
          } catch (e) {
            logger.warn("[ChatProcessor] Failed to load journal style:", e);
          }
        }
      }
    }
  }
  
  const decisionPrompt = `你是一个专业的学术论文写作助手。

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleHint}

## 用户问题
"${messageForTask}"

## 你的任务
分析用户的问题，做出决策：
1. 是否需要联网搜索最新信息？
2. 用户想要做什么？（回答问题/写讨论/写引言/逐句检索/其他）

## 决策规则
- 如果问题涉及最新研究成果（2024-2026）、实时数据，**必须联网搜索**
- 如果用户要求"逐句检索"、"为这句话找文献"、"检索支撑文献"等，**task_type = "逐句检索"**
- 如果用户要求写某个章节（引言/讨论/方法等），**task_type = "写XX"**
- 普通问答，**task_type = "回答问题"**

## 输出格式
返回以下 JSON 格式：
{
  "need_web_search": true/false,
  "web_search_query": "联网搜索关键词",
  "task_type": "回答问题/写讨论/写引言/逐句检索/其他",
  "reason": "判断理由"
}

只返回 JSON，不要有其他文字。`;

  let needWebSearch = false;
  let webSearchQuery = "";
  let taskType = "回答问题";
  
  try {
    const decisionText = await callChatCompletion(
      {
        apiUrl: useApiUrl,
        apiKey: useApiKey,
        label: "LocalChatDecision",
        defaultModel: model,
      },
      {
        model,
        messages: [
          { role: "system", content: decisionPrompt },
          { role: "user", content: buildAnchoredUserMessage(messageForTask, { source: "local-chat-decision" }) }
        ],
        temperature: 0.3,
        maxTokens: MAX_LLM_OUTPUT_TOKENS,
      }
    );

    const jsonMatch = decisionText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision = JSON.parse(jsonMatch[0]);
      needWebSearch = decision.need_web_search === true;
      webSearchQuery = decision.web_search_query || messageForTask;
      taskType = decision.task_type || "回答问题";
      logger.info(`[ChatProcessor] Decision: web=${needWebSearch}, task=${taskType}`);
    }
  } catch (e) {
    logger.warn("[ChatProcessor] Decision API failed:", e);
  }
  
  // ========== 🚀 写作任务检测：使用 ConversationFlow 完整流程 ==========
  const isWritingTask = taskType.includes('写') || 
                        taskType.includes('写作') || 
                        taskType.includes('撰写') ||
                        taskType.includes('逐句检索') ||
                        taskType.includes('检索文献') ||
                        /(introduction|discussion|methods|results|conclusion|abstract)/i.test(taskType);
  
  if (isWritingTask && globalConversationFlow) {
    logger.info(`[ChatProcessor] Detected writing task: ${taskType}, delegating to ConversationFlow`);
    try {
      // 将请求转发到 ConversationFlow，使用完整流程（包含逐句检索）
      const flowMessage = userSkillPrompt
        ? `${userSkillPrompt}\n\n---\n\n用户请求：${messageForTask}`
        : messageForTask;
      const flowResponse = await globalConversationFlow.processMessage(unifiedUserId, flowMessage);
      logger.info(`[ChatProcessor] ConversationFlow completed writing task`);
      return flowResponse;
    } catch (flowError) {
      logger.error(`[ChatProcessor] ConversationFlow error:`, flowError);
      // ConversationFlow 失败时，降级到原有流程
      logger.info(`[ChatProcessor] Falling back to standard chat flow`);
    }
  }
  
  // ========== 🚀 逐句检索任务：直接调用检索引擎 ==========
  if (taskType.includes('逐句检索') || taskType.includes('检索支撑文献')) {
    logger.info(`[ChatProcessor] Detected sentence-level retrieval task`);
    try {
      // 从用户消息中提取句子
      const sentences = extractSentencesFromMessage(messageForTask);
      
      // 如果没有提取到句子，询问用户提供具体论点
      if (sentences.length === 0) {
        return `好的，我来帮您逐句检索文献支撑。

请提供您需要检索的具体论点或句子，支持以下格式：

**格式1 - 引号包裹：**
"干预A显著降低目标风险"
"方法B提高模型预测准确性"

**格式2 - 编号列表：**
1. 干预A显著降低目标风险
2. 方法B提高模型预测准确性
3. 政策工具促进资源配置效率

**格式3 - 直接提供（每行一个）：**
干预A通过抑制关键过程降低目标风险
方法B在多场景数据中提高预测稳定性
政策工具可能促进资源配置效率

请发送您需要检索的具体内容，我将为每句话检索最相关的文献。`;
      }
      
      // 使用全局检索引擎进行逐句检索
      const results: Record<string, any[]> = {};
      
      for (const sentence of sentences) {
        const docs = await retrieveBilingualDocuments(globalRetrievalEngine, sentence, 5);

        results[sentence] = docs.map(doc => ({
          title: doc.title,
          author: doc.authors.map((a: { name?: string }) => a.name).join(', '),
          year: doc.year,
          journal: doc.journal,
          doi: doc.doi,
          abstract: doc.abstract,
          score: doc.combinedScore,
          retrievalPath: doc.retrievalPath,
          retrievalQuery: doc.retrievalQuery,
          citation: `(${doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown'} et al., ${doc.year})`
        }));
      }
      
      // 格式化返回结果
      let response = `## 逐句检索结果\n\n`;
      response += `已为 **${sentences.length}** 个句子检索文献支撑\n\n`;
      
      for (const [sentence, papers] of Object.entries(results)) {
        response += `### 「${sentence}」\n\n`;
        if (papers.length === 0) {
          response += `*未找到相关文献*\n\n`;
        } else {
          papers.forEach((paper, idx) => {
            response += `${idx + 1}. **${paper.title}**\n`;
            response += `   ${paper.citation}\n`;
            if (paper.retrievalPath) response += `   ${paper.retrievalPath}: ${paper.retrievalQuery || ''}\n`;
            response += `   *${paper.journal}*\n`;
            response += `   ${paper.abstract?.substring(0, 150)}...\n\n`;
          });
        }
      }
      
      response += `---\n`;
      response += `**使用建议**：\n`;
      response += `- 相关度 ≥ 0.5 的文献可以直接引用\n`;
      response += `- 相关度 0.3-0.5 的文献需要验证内容匹配度\n`;
      response += `- 相关度 < 0.3 的文献建议重新检索或使用其他关键词\n`;
      
      return response;
    } catch (retrievalError) {
      logger.error(`[ChatProcessor] Sentence retrieval error:`, retrievalError);
      return `逐句检索时出现错误：${(retrievalError as Error).message}。请稍后重试。`;
    }
  }
  
  // ========== 🚀 自动加载 SCI 写作技能（增强上下文检测） ==========
  let writingSkillContent = "";
  
  // 获取对话历史用于上下文检测
  const contextHistory = conversationHistory.get(unifiedUserId) || [];
  const detectedChapter = detectChapterType(messageForTask, contextHistory);
  
  if (detectedChapter) {
    writingSkillContent = loadWritingSkill(detectedChapter);
    if (writingSkillContent) {
      logger.info(`[Skill] Auto-loaded ${detectedChapter} skill for writing task (context-aware)`);
    }
  } else {
    logger.info("[Skill] No chapter type detected, skipping skill load");
  }
  
  let relevantLiterature = "";
  
  // 注：文献由用户自行从对话框发送，不再自动检索塞进系统提示词
  // if (literaturePapers.length > 0) {
  //   const { references } = getReferencesForWriting(userMessage, literaturePapers, 10);
  //   relevantLiterature = references;
  // }
  
  let webSearchContext = "";
  if (needWebSearch && webSearchKey) {
    try {
      logger.info("[ChatProcessor] Web searching for:", webSearchQuery);
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
        webSearchContext = "\n【网络搜索结果】\n";
        for (let i = 0; i < Math.min(searchData.results.length, 5); i++) {
          const r = searchData.results[i];
          const content = r.raw_content || r.content || '';
          webSearchContext += `${i + 1}. ${r.title}\n   ${r.url || ''}\n   ${content}\n\n`;
        }
        logger.info("[ChatProcessor] Web search found", searchData.results.length, "results");
      }
    } catch (e) {
      logger.error("[ChatProcessor] Web search error:", e);
    }
  }
  
  let taskHint = "";
  if (taskType === "写讨论") {
    taskHint = "\n## 写作任务\n用户想要写 Discussion。请根据用户在对话中提供的文献和材料进行撰写。\n";
  } else if (taskType === "写引言") {
    taskHint = "\n## 写作任务\n用户想要写 Introduction。请根据用户在对话中提供的文献和材料进行撰写。\n";
  }
  
  let memoryIntro = "";
  if (userMemory.entries.length > 0) {
    memoryIntro = "\n## 跨会话长久记忆（完整）\n系统已记录您之前分享的信息：\n";
    for (const entry of userMemory.entries) {
      memoryIntro += `- **${entry.key}**: ${entry.value}\n`;
    }
  } else {
    memoryIntro = "\n## 跨会话长久记忆\n本对话结束后，系统将自动提取重要信息并保存。\n";
  }
  
  // 🚀 注入写作技能指导
  let writingSkillSection = "";
  if (writingSkillContent) {
    writingSkillSection = `\n\n## ✨ SCI写作技能指导\n\n系统已自动加载 **${detectedChapter}** 章节的写作技能指南。\n请严格按照以下技能要求指导用户写作：\n\n${writingSkillContent}\n\n---\n`;
  }
  
  const finalSystemPrompt = `你是一个专业的学术论文写作助手。${soulContent ? "\n" + soulContent : ""}
${memoryIntro}
${memoryContext}
${writingProgressContext}
${userSkillPrompt ? `\n${userSkillPrompt}\n` : ''}

## 你的能力
1. **用户自带文献**：用户会自行在对话中提供需要参考的文献内容
2. **联网搜索**：搜索互联网最新研究（仅用于背景信息，**不能用于参考文献**）
3. **写作指导**：结合用户提供材料、长期记忆、期刊风格进行回答

${writingSkillSection}

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${webSearchContext}
${taskHint}

## 回答要求
1. 回答必须有文献依据
2. **文内引用**：必须使用 "(作者，年份)" 格式引用文献，如 "(Wang et al., 2023)"
3. **文末尾注**：文末必须列出所有参考文献的完整尾注信息，包含：作者、年份、标题、期刊、卷号、页码、DOI，格式如下：
   - "[序号] 作者全名. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx"
   - 示例："[1] Smith, J. et al. (2023). Intervention effects on target outcomes in applied research. Journal of Applied Research, 12(3), 101-115. DOI: 10.0000/example.2023.001"
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
- [序号] 作者全名. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx
- 示例：[1] Smith, J. et al. (2023). Intervention effects on target outcomes in applied research. Journal of Applied Research, 12(3), 101-115. DOI: 10.0000/example.2023.001
\`\`\`

**重要**：references 字段必须列出本章节引用的所有文献完整信息，包括作者、年份、标题、期刊、卷号、页码、DOI。

## 写作流程要求
不要一次性生成整个章节！采用渐进式写作：
1. 先询问写作重点
2. 建议章节结构，等用户确认
3. 分段写作，逐段确认`;
  const anchoredSystemPrompt = anchorPromptWithCurrentRequest(finalSystemPrompt, messageForTask, {
    source: "local-chat-system",
    taskType
  });

  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: anchoredSystemPrompt }
  ];
  
  // 使用前面定义的 history 变量（支持外部传入）
  for (const msg of history.slice(-5)) {
    messages.push(msg);
  }
  
  const anchoredUserMessage = buildAnchoredUserMessage(messageForTask, {
    source: "local-chat-user",
    taskType
  });
  messages.push({ role: "user", content: anchoredUserMessage });
  logger.info(`[ChatProcessor] Current request anchor: ${JSON.stringify(getPromptAnchorDiagnostics(`${anchoredSystemPrompt}\n${anchoredUserMessage}`, messageForTask))}`);
  
  try {
    let aiResponse = await callChatCompletion(
      {
        apiUrl: useApiUrl,
        apiKey: useApiKey,
        label: "LocalChat",
        defaultModel: model,
      },
      {
        model,
        messages: messages as ChatOptions['messages'],
        temperature: 0.7,
      }
    );
    
    const draftMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：save_draft[\s\S]*?```/);
    if (draftMatch) {
      const draftBlock = draftMatch[0];
      const contentMatch = draftBlock.match(/content:\s*\|\s*([\s\S]*?)(?=\n\s*(?:section|references):)/);
      const sectionMatch = draftBlock.match(/section:\s*(\w+)/);
      
      if (contentMatch && sectionMatch) {
        let draftContent = contentMatch[1].trim();
        const section = sectionMatch[1];
        
        draftContent = draftContent.replace(/^```/, '').replace(/```$/,'').trim();
        
        try {
          const { bibliography, stats } = generateBibliography(draftContent, literaturePapers);
          const finalContent = bibliography 
            ? `${draftContent}\n\n${bibliography}` 
            : draftContent;
          await sessionStore.saveDraft(userId, section, finalContent);
          const bibInfo = stats.matched > 0 ? `（含参考文献: ${stats.matched}篇匹配/${stats.totalCitations}篇引用）` : '';
          logger.info(`[ChatProcessor] Draft saved: ${section} for ${unifiedUserId}${bibInfo}`);
          aiResponse = aiResponse.replace(draftMatch[0], `\n✅ 已保存到 ${section} 草稿${bibInfo}\n`);
        } catch (e) {
          logger.error("[ChatProcessor] Failed to save draft:", e);
          aiResponse = aiResponse.replace(draftMatch[0], `\n⚠️ 草稿保存失败：${(e as Error).message}\n`);
        }
      }
    }
    
    // 捕获AI的句子检索工具调用
    const sentenceSearchMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：sentence_search[\s\S]*?```/);
    if (sentenceSearchMatch) {
      const searchBlock = sentenceSearchMatch[0];
      const sentencesMatch = searchBlock.match(/sentences:\s*([\s\S]*?)(?=```|$)/);
      
      if (sentencesMatch) {
        try {
          // 解析句子列表
          const sentencesText = sentencesMatch[1].trim();
          const sentences = sentencesText
            .split('\n')
            .map(s => s.trim().replace(/^-\s*/, '').replace(/^[""']|[""']$/g, ''))
            .filter(s => s.length > 0);
          
          if (sentences.length > 0) {
            logger.info(`[ChatProcessor] AI requested sentence search for ${sentences.length} sentences`);
            
            // 执行逐句检索
            const searchResults: Record<string, any[]> = {};
            for (const sentence of sentences) {
              const docs = await retrieveBilingualDocuments(globalRetrievalEngine, sentence, 5);

              searchResults[sentence] = docs.map(doc => ({
                title: doc.title,
                author: doc.authors.map((a: { name?: string }) => a.name).join(', '),
                year: doc.year,
                journal: doc.journal,
                doi: doc.doi,
                abstract: doc.abstract,
                score: doc.combinedScore,
                retrievalPath: doc.retrievalPath,
                retrievalQuery: doc.retrievalQuery,
                citation: `(${doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown'} et al., ${doc.year})`
              }));
            }
            
            // 格式化检索结果
            let searchResultText = `\n\n## 逐句检索结果\n\n`;
            searchResultText += `已为 **${sentences.length}** 个检索词检索文献\n\n`;
            
            for (const [query, papers] of Object.entries(searchResults)) {
              searchResultText += `### 检索词：「${query}」\n\n`;
              if (papers.length === 0) {
                searchResultText += `*未找到相关文献*\n\n`;
              } else {
                papers.forEach((paper, idx) => {
                  searchResultText += `${idx + 1}. **${paper.title}**\n`;
                  searchResultText += `   ${paper.citation}\n`;
                  if (paper.retrievalPath) searchResultText += `   ${paper.retrievalPath}: ${paper.retrievalQuery || ''}\n`;
                  searchResultText += `   *${paper.journal}*\n`;
                  searchResultText += `   ${paper.abstract?.substring(0, 150)}...\n\n`;
                });
              }
            }
            
            // 将检索结果附加到AI响应
            aiResponse = aiResponse.replace(sentenceSearchMatch[0], 
              `\n✅ 已完成逐句检索，共找到 ${Object.values(searchResults).flat().length} 篇相关文献\n${searchResultText}`);
            
            logger.info(`[ChatProcessor] Sentence search completed`);
          }
        } catch (e) {
          logger.error("[ChatProcessor] Sentence search failed:", e);
          aiResponse = aiResponse.replace(sentenceSearchMatch[0], 
            `\n⚠️ 逐句检索失败：${(e as Error).message}\n`);
        }
      }
    }
    
    // 捕获AI的单句检索工具调用（sentence_search_single）
    const singleSentenceSearchMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：sentence_search_single[\s\S]*?```/);
    if (singleSentenceSearchMatch) {
      const searchBlock = singleSentenceSearchMatch[0];
      const sentenceIdMatch = searchBlock.match(/sentence_id:\s*(S\d+)/);
      const topicMatch = searchBlock.match(/topic:\s*([^\n]+)/);
      const queryMatch = searchBlock.match(/search_query:\s*([^\n]+)/);
      
      if (sentenceIdMatch && queryMatch) {
        const sentenceId = sentenceIdMatch[1];
        const topic = topicMatch ? topicMatch[1].trim() : '';
        const searchQuery = queryMatch[1].trim();
        
        try {
          logger.info(`[ChatProcessor] AI requested single sentence search: ${sentenceId} - ${searchQuery}`);
          
          // 执行单句检索
          const docs = await retrieveBilingualDocuments(globalRetrievalEngine, searchQuery, 5, topic);
          
          // 格式化检索结果
          let searchResultText = `\n\n## ${sentenceId} 文献检索结果\n\n`;
          searchResultText += `**检索词**：${searchQuery}\n`;
          searchResultText += `**主题**：${topic}\n`;
          searchResultText += `**找到 ${docs.length} 篇相关文献**：\n\n`;
          
          docs.forEach((doc, idx) => {
            const citation = `(${doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown'} et al., ${doc.year})`;
            searchResultText += `${idx + 1}. **${doc.title}**\n`;
            searchResultText += `   ${citation}\n`;
            if (doc.retrievalPath) searchResultText += `   ${doc.retrievalPath}: ${doc.retrievalQuery || ''}\n`;
            searchResultText += `   *${doc.journal}*\n`;
            searchResultText += `   ${doc.abstract?.substring(0, 150)}...\n\n`;
          });
          
          searchResultText += `---\n`;
          searchResultText += `**基于以上文献撰写 ${sentenceId} 的内容，然后自动继续下一句**\n`;
          
          // 将检索结果附加到AI响应
          aiResponse = aiResponse.replace(singleSentenceSearchMatch[0], 
            `\n✅ 已完成 ${sentenceId} 的文献检索\n${searchResultText}`);
          
          logger.info(`[ChatProcessor] Single sentence search completed: ${sentenceId}`);
        } catch (e) {
          logger.error("[ChatProcessor] Single sentence search failed:", e);
          aiResponse = aiResponse.replace(singleSentenceSearchMatch[0], 
            `\n⚠️ ${sentenceId} 检索失败：${(e as Error).message}\n`);
        }
      }
    }
    
    const currentHistory = conversationHistory.get(unifiedUserId) || [];
    currentHistory.push({ role: "user", content: userMessage });
    currentHistory.push({ role: "assistant", content: aiResponse });
    if (currentHistory.length > 20) {
      currentHistory.splice(0, currentHistory.length - 20);
    }
    conversationHistory.set(unifiedUserId, currentHistory);
    
    const conversationId = `conv-${Date.now()}`;
    updateMemoryWithAI(unifiedUserId, conversationId, messageForTask, aiResponse, history, useApiUrl, useApiKey, model).catch(e => {
      logger.warn("[ChatProcessor] Failed to update memory:", e);
    });
    
    return aiResponse;
    
  } catch (error) {
    logger.error("[ChatProcessor] Error:", error);
    return `抱歉，处理请求时出错: ${(error as Error).message}`;
  }
}

function loadSoulFile(): string {
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(dataDir, "SOUL.md"),  // 数据目录中的 SOUL.md
    path.join((process as any).resourcesPath || "", "SOUL.md"),  // Electron resources 目录
    path.join(__dirname, "..", "..", "SOUL.md"),  // 源代码目录
  ];

  for (const soulPath of possiblePaths) {
    if (fs.existsSync(soulPath)) {
      logger.info(`[SOUL] Found at: ${soulPath}`);
      return fs.readFileSync(soulPath, 'utf-8');
    }
  }

  logger.warn("[SOUL] SOUL.md not found, using default personality");
  return '';
}

const soulContent = loadSoulFile();
if (soulContent) {
  logger.info("[SOUL] Loaded AI personality file");
}

function createApiClient() {
  return createLLMApiClient({
    apiUrl,
    apiKey,
    defaultTemperature: 0.7,
    label: "LocalServer",
  });
}

const conversationHistory = new Map<
  string,
  Array<{ role: string; content: string }>
>();

function resolvePdfJsDistSubdir(subdir: "build" | "web" | "legacy/build" | "legacy/web"): string | null {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  const candidates = [
    path.resolve(process.cwd(), "node_modules", "pdfjs-dist", subdir),
    path.resolve(__dirname, "..", "..", "..", "node_modules", "pdfjs-dist", subdir),
    electronProcess.resourcesPath
      ? path.join(electronProcess.resourcesPath, "app.asar.unpacked", "node_modules", "pdfjs-dist", subdir)
      : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return candidate;
    }
  }
  return null;
}

const pdfJsBuildDir = resolvePdfJsDistSubdir("build");
const pdfJsWebDir = resolvePdfJsDistSubdir("web");
const pdfJsLegacyBuildDir = resolvePdfJsDistSubdir("legacy/build");
const pdfJsLegacyWebDir = resolvePdfJsDistSubdir("legacy/web");
if (pdfJsBuildDir && pdfJsWebDir) {
  app.use("/vendor/pdfjs/build", express.static(pdfJsBuildDir));
  app.use("/vendor/pdfjs/web", express.static(pdfJsWebDir));
  logger.info("[Server] PDF.js vendor dir:", pdfJsBuildDir);
} else {
  logger.warn("[Server] pdfjs-dist not found; internal PDF reader will fall back to browser PDF plugin.");
}
if (pdfJsLegacyBuildDir && pdfJsLegacyWebDir) {
  app.use("/vendor/pdfjs/legacy/build", express.static(pdfJsLegacyBuildDir));
  app.use("/vendor/pdfjs/legacy/web", express.static(pdfJsLegacyWebDir));
  logger.info("[Server] PDF.js legacy vendor dir:", pdfJsLegacyBuildDir);
}

app.use(express.static(publicDir));

// ==================== 认证API路由 ====================

/**
 * GET /api/auth/me
 * 获取当前登录用户信息（用于侧边栏显示和用户信息窗口）
 */
app.get("/api/auth/me", async (req: Request, res: Response) => {
  try {
    // 获取本地session（解密）
    const session = await authGuard.getSession();
    
    if (!session) {
      return res.json({ error: '未登录' });
    }
    
    let canRefreshCloudProfile = true;

    // 检查accessToken是否过期，尝试刷新。个人中心优先展示本地缓存，避免云端慢导致窗口超时。
    if (await authGuard.isAccessTokenExpired()) {
      const refreshed = await Promise.race([
        authGuard.refreshToken(),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 4000)),
      ]);
      if (!refreshed) {
        const graceSession = await authGuard.getSession();
        if (!graceSession || !await authGuard.isWithinOfflineGracePeriod()) {
          return res.json({ error: '登录已过期' });
        }
        logger.warn('[Auth] Token refresh unavailable for /api/auth/me; using local session cache');
        canRefreshCloudProfile = false;
      }
    }
    
    // 获取最新的session
    const currentSession = await authGuard.getSession();
    if (!currentSession) {
      return res.json({ error: '未登录' });
    }

    let userInfo = {
      id: currentSession.userId,
      email: currentSession.email,
      username: currentSession.username,
      avatar_url: currentSession.avatar_url,
      referral_code: currentSession.referral_code,
      role: undefined as string | undefined,
    };

    if (canRefreshCloudProfile) {
      try {
        const cloudUserResponse = await fetch(`${authGuard.getCloudApiUrl()}/auth/me`, {
          headers: {
            'Authorization': `Bearer ${currentSession.accessToken}`,
          },
          signal: AbortSignal.timeout(3500),
        });

        if (cloudUserResponse.ok) {
          const cloudUserData = await cloudUserResponse.json() as {
            user?: {
              id?: string;
              email?: string;
              username?: string;
              avatar_url?: string;
              referral_code?: string;
              role?: string;
            };
          };

          if (cloudUserData.user) {
            userInfo = {
              id: cloudUserData.user.id || userInfo.id,
              email: cloudUserData.user.email || userInfo.email,
              username: cloudUserData.user.username || userInfo.username || cloudUserData.user.email?.split('@')[0],
              avatar_url: cloudUserData.user.avatar_url || userInfo.avatar_url,
              referral_code: cloudUserData.user.referral_code || userInfo.referral_code,
              role: cloudUserData.user.role,
            };

            currentSession.userId = userInfo.id;
            currentSession.email = userInfo.email;
            currentSession.username = userInfo.username;
            currentSession.avatar_url = userInfo.avatar_url;
            currentSession.referral_code = userInfo.referral_code;
            await authGuard.saveSession(currentSession);
          }
        }
      } catch (error) {
        logger.warn('[Auth] Failed to refresh user profile from cloud, using local session:', error);
      }
    }
    
    // 返回用户信息和订阅状态
    res.json({
      user: {
        id: userInfo.id,
        email: userInfo.email,
        username: userInfo.username || userInfo.email?.split('@')[0] || '未设置',
        avatar_url: userInfo.avatar_url,
        referral_code: userInfo.referral_code,
        role: userInfo.role || 'user',
      },
      subscription: currentSession.subscription || {
        plan_type: 'free',
        status: 'active',
        quota_remaining: 0,
        quota_total: 0,
      },
    });
  } catch (error) {
    logger.error('[Auth] Get user info failed:', error);
    res.json({ error: '获取用户信息失败' });
  }
});

/**
 * GET /api/auth/validate-session
 * 验证本地session是否存在且有效
 */
app.get("/api/auth/validate-session", async (req: Request, res: Response) => {
  try {
    // 获取本地session（解密）
    const session = await authGuard.getSession();
    
    if (!session) {
      return res.json({ valid: false, reason: '未登录' });
    }
    
    // 检查accessToken是否过期
    if (await authGuard.isAccessTokenExpired()) {
      // 尝试刷新token
      const refreshed = await authGuard.refreshToken();
      if (!refreshed) {
        const graceSession = await authGuard.getSession();
        if (graceSession && await authGuard.isWithinOfflineGracePeriod()) {
          return res.json({
            valid: true,
            reason: '离线模式（宽限期内）',
            user: {
              id: graceSession.userId,
              email: graceSession.email,
              username: graceSession.username,
              referral_code: graceSession.referral_code,
            },
            subscription: graceSession.subscription,
          });
        }
        return res.json({ valid: false, reason: '登录已过期，请重新登录' });
      }
    }
    
    // 获取最新的session
    const currentSession = await authGuard.getSession();
    if (!currentSession) {
      return res.json({ valid: false, reason: '未登录' });
    }
    
    // 验证云端订阅状态
    const validation = await authGuard.validateSession(currentSession.accessToken);
    
    res.json({
      valid: validation.valid,
      reason: validation.reason,
      user: {
        id: currentSession.userId,
        email: currentSession.email,
        username: currentSession.username,
        referral_code: currentSession.referral_code,
      },
      subscription: validation.subscription,
    });
  } catch (error) {
    logger.error('[Auth] Validate session failed:', error);
    res.status(500).json({ valid: false, reason: '验证失败' });
  }
});

/**
 * POST /api/auth/login
 * 用户登录（转发到云端API并保存本地session）
 */
app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password, beta_code } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '邮箱和密码不能为空',
      });
    }
    
    logger.info(`[Auth] Login request for: ${email}${beta_code ? ' with beta_code' : ''}`);
    
    // authGuard.login() 会自动保存加密的session到本地
    const result = await authGuard.login(email, password, beta_code);
    
    if (result.success) {
      logger.info(`[Auth] Login successful: ${email}, session saved`);
      
      res.json({
        message: 'Login successful',
        user: result.user,
        tokens: result.tokens, // 返回tokens供前端使用
        trial_info: result.trial_info, // 内测码激活信息
        referral_trial_info: result.referral_trial_info, // 邀请试用领取信息
      });
    } else {
      logger.warn(`[Auth] Login failed: ${email} - ${result.error}`);
      
      res.status(401).json({
        error: 'Unauthorized',
        message: result.error || '登录失败',
      });
    }
  } catch (error) {
    logger.error('[Auth] Login failed:', error);
    const errorMessage = (error as Error)?.message || String(error || '');
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: errorMessage && errorMessage !== '[object Object]' ? `登录失败：${errorMessage}` : '登录失败',
    });
  }
});

/**
 * POST /api/auth/logout
 * 用户登出
 */
app.post("/api/auth/logout", async (req: Request, res: Response) => {
  try {
    // 使用 authGuard.clearSession() 清除本地加密session
    await authGuard.clearSession();
    logger.info('[Auth] Session cleared');
    
    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    logger.error('[Auth] Logout failed:', error);
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: '登出失败',
    });
  }
});

/**
 * GET /api/auth/token
 * 获取当前用户的 accessToken（用于内测码激活等需要认证的操作）
 * 正确解密本地 session 并返回有效的 access token
 */
app.get("/api/auth/token", async (req: Request, res: Response) => {
  try {
    // 获取本地 session（正确解密）
    const session = await authGuard.getSession();
    
    if (!session) {
      return res.json({ error: '未登录', hasToken: false });
    }
    
    // 检查 accessToken 是否过期，尝试刷新
    if (await authGuard.isAccessTokenExpired()) {
      const refreshed = await authGuard.refreshToken();
      if (!refreshed) {
        return res.json({ error: '登录已过期，请重新登录', hasToken: false });
      }
    }
    
    // 获取最新的 session（刷新后的）
    const currentSession = await authGuard.getSession();
    if (!currentSession) {
      return res.json({ error: '未登录', hasToken: false });
    }
    
    // 返回 accessToken
    res.json({
      hasToken: true,
      accessToken: currentSession.accessToken,
      userId: currentSession.userId,
      email: currentSession.email,
    });
  } catch (error) {
    logger.error('[Auth] Get token failed:', error);
    res.json({ error: '获取认证信息失败', hasToken: false });
  }
});

function cleanFeedbackText(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, maxLength);
}

/**
 * POST /api/feedback
 * 本地接收用户反馈并转发到云端，避免前端直接跨域请求云服务器。
 */
app.post("/api/feedback", async (req: Request, res: Response) => {
  try {
    const content = cleanFeedbackText(req.body.content, 10000);
    if (!content) {
      res.status(400).json({ success: false, error: "请填写反馈内容" });
      return;
    }

    let currentSession = await authGuard.getSession();
    if (currentSession && await authGuard.isAccessTokenExpired()) {
      await authGuard.refreshToken();
      currentSession = await authGuard.getSession();
    }

    const cloudApiUrl = authGuard.getCloudApiUrl();
    const payload = {
      title: cleanFeedbackText(req.body.title, 200) || content.slice(0, 60) || "用户反馈",
      category: cleanFeedbackText(req.body.category, 40) || "suggestion",
      content,
      contact: cleanFeedbackText(req.body.contact, 255) || currentSession?.email || "",
      userId: currentSession?.userId || cleanFeedbackText(req.body.userId, 80),
      userEmail: currentSession?.email || cleanFeedbackText(req.body.userEmail, 255),
      username: currentSession?.username || cleanFeedbackText(req.body.username, 100),
      source: "desktop",
      appVersion: process.env.npm_package_version || "1.0.0",
      machineId: os.hostname(),
      metadata: {
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        localUserAgent: cleanFeedbackText(req.headers["user-agent"], 500),
      },
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (currentSession?.accessToken) {
      headers.Authorization = `Bearer ${currentSession.accessToken}`;
    }

    const response = await fetch(`${cloudApiUrl}/feedback`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error((data as { message?: string; error?: string }).message || (data as { error?: string }).error || `云端反馈接口错误 ${response.status}`);
    }

    res.json({ success: true, feedback: (data as { feedback?: unknown }).feedback || null });
  } catch (error) {
    logger.error("[Feedback] Submit failed:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "反馈提交失败" });
  }
});

async function validateBetaCodeProxy(req: Request, res: Response): Promise<Response | void> {
  try {
    const { code } = req.body;
    
    if (!code) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '内测码不能为空',
      });
    }
    
    logger.info(`[BetaCodes] Validate request for: ${code}`);
    
    // 转发到云端API
    const cloudApiUrl = authGuard.getCloudApiUrl();
    const response = await fetch(`${cloudApiUrl}/beta-codes/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
    });
    
    const data = await response.json();
    
    logger.info(`[BetaCodes] Validate result: ${JSON.stringify(data)}`);
    
    res.json(data);
  } catch (error) {
    logger.error('[BetaCodes] Validate failed:', error);
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: '验证失败，请稍后重试',
    });
  }
}

/**
 * POST /api/v1/beta-codes/validate
 * 验证内测码（转发到云端API）
 */
app.post("/api/v1/beta-codes/validate", validateBetaCodeProxy);

/**
 * POST /api/beta-codes/validate
 * 兼容登录页旧路径，避免本地和云端授权码验证路径不一致。
 */
app.post("/api/beta-codes/validate", validateBetaCodeProxy);

/**
 * GET /api/auth/check-quota
 * 检查额度是否足够
 */
app.get("/api/auth/check-quota", async (req: Request, res: Response) => {
  try {
    const { amount } = req.query;
    const requiredAmount = parseInt(amount as string, 10) || 0;
    
    // 优先从本地session获取accessToken
    const session = await authGuard.getSession();
    
    if (!session) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '未登录',
      });
    }
    
    const hasEnough = await authGuard.hasEnoughQuota(session.accessToken, requiredAmount);
    
    res.json({ 
      hasEnough,
      quota_remaining: session.subscription?.quota_remaining,
      quota_total: session.subscription?.quota_total,
    });
  } catch (error) {
    logger.error('[Auth] Check quota failed:', error);
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: '检查额度失败',
    });
  }
});

/**
 * GET /api/usage/daily-stats
 * 获取用量统计（最近30天，用于用户信息界面柱状图）
 */
app.get("/api/usage/daily-stats", async (req: Request, res: Response) => {
  try {
    const session = await authGuard.getSession();
    
    if (!session) {
      return res.json({ error: '未登录' });
    }
    
    // 检查accessToken是否过期
    if (await authGuard.isAccessTokenExpired()) {
      const refreshed = await authGuard.refreshToken();
      if (!refreshed) {
        return res.json({ error: '登录已过期' });
      }
    }
    
    const currentSession = await authGuard.getSession();
    if (!currentSession) {
      return res.json({ error: '未登录' });
    }
    
    // 转发到云端API获取用量统计
    const response = await fetch(`${authGuard.getCloudApiUrl()}/usage/daily-stats`, {
      headers: {
        'Authorization': `Bearer ${currentSession.accessToken}`,
      },
    });
    
    if (!response.ok) {
      // 云端API不可用时，返回本地模拟数据
      logger.warn('[Usage] Cloud API unavailable, returning mock data');
      
      // 生成最近30天的空数据
      const dailyStats = [];
      for (let i = 29; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dailyStats.push({
          date: date.toISOString().split('T')[0],
          word_count: 0,
          file_count: 0,
        });
      }
      
      return res.json({
        daily_stats: dailyStats,
        subscription: currentSession.subscription || {
          plan_type: 'free',
          quota_remaining: 0,
          quota_total: 0,
        },
      });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('[Usage] Get daily stats failed:', error);
    
    // 出错时返回模拟数据
    const dailyStats = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      dailyStats.push({
        date: date.toISOString().split('T')[0],
        word_count: 0,
        file_count: 0,
      });
    }
    
    res.json({
      daily_stats: dailyStats,
      error: '获取用量统计失败，显示空数据',
    });
  }
});

/**
 * GET /api/subscription/status
 * 获取用户订阅状态（转发到云端API）
 */
app.get("/api/subscription/status", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const accessToken = authHeader?.replace('Bearer ', '');
    
    if (!accessToken) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: '未登录',
      });
    }
    
    // 转发到云端API
    const response = await fetch(`${authGuard.getCloudApiUrl()}/subscription/me`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    if (response.ok) {
      const data = await response.json() as any;
      res.json(data);
    } else {
      res.status(response.status).json({
        error: 'Failed to get subscription',
        message: '获取订阅信息失败',
      });
    }
  } catch (error) {
    logger.error('[Auth] Get subscription status failed:', error);
    
    res.status(500).json({
      error: 'Internal Server Error',
      message: '获取订阅信息失败',
    });
  }
});

logger.info('[Auth] Authentication routes initialized');

// ==================== 结束认证API路由 ====================

// 商业版本地 API 保护：认证路由之后、核心业务路由之前统一挂载。
// 具体保护范围由 authGuardMiddleware 内的 protectedRoutes 控制，避免只靠 Electron 窗口入口拦截。
app.use(authGuardMiddleware(authGuard));

app.get('/api/cloud-prompts/status', async (_req: Request, res: Response) => {
  const session = await authGuard.getSession();
  res.json({
    success: true,
    enabled: process.env.CLOUD_PROMPTS_DISABLED !== '1',
    strict: process.env.CLOUD_PROMPTS_STRICT === '1',
    cloudApiUrl: authGuard.getCloudApiUrl(),
    loggedIn: !!session,
    userId: session?.userId,
    subscriptionStatus: session?.subscription?.status,
    cacheMode: 'encrypted-device-user-bound',
    modelCostMode: 'user-api-direct',
  });
});

app.post('/api/cloud-prompts/prefetch', async (req: Request, res: Response) => {
  try {
    const bundleId = typeof req.body?.bundleId === 'string' && req.body.bundleId.trim()
      ? req.body.bundleId.trim()
      : 'paper-writing-full';
    const promptIds = Array.isArray(req.body?.promptIds)
      ? req.body.promptIds.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : undefined;
    await consumeCloudQuota('cloud_prompt_bundle', 100, { bundleId, promptCount: promptIds?.length || 0 });
    const bundle = await cloudPromptClient.getBundle(bundleId, promptIds);
    res.json({
      success: true,
      bundleId: bundle.bundleId,
      version: bundle.version,
      promptCount: bundle.prompts.length,
      missingIds: bundle.missingIds || [],
      source: bundle.source,
      cacheExpiry: bundle.cacheExpiry,
      staleUntil: bundle.staleUntil,
    });
  } catch (error) {
    logger.error('[CloudPrompts] Prefetch failed:', error);
    res.status(502).json({
      success: false,
      error: (error as Error).message || '云端核心 Prompt 预取失败',
    });
  }
});

// 使用模块导出的单例 chatBridge，避免重复实例化导致多个 openclaw 进程
chatBridge.loadConfig().then(() => {
  initializeChatBridgeRoutes(chatBridge, {
    saveDraft: async (userId, section, content) => {
      await sessionStore.saveDraft(userId, section, content);
    },
    getDraftContext: getOrdinaryDraftContextForChat,
  });
  // 初始化 unified-chat 路由
  initializeUnifiedChatRoutes(chatBridge, {
    getDraftContext: getOrdinaryDraftContextForChat,
  });
  logger.info('[ChatBridge] Adapter initialized (singleton)');
  logger.info('[UnifiedChat] Routes initialized');
}).catch((err: Error) => {
  logger.error('[ChatBridge] Failed to initialize:', err);
});

app.use("/api/chat-bridge", chatBridgeRoutes);
app.use("/api/memory", chatUpload.none(), memoryRoutes);
app.use("/api/user-skills", chatUpload.none(), userSkillsRoutes);
app.use("/api/unified", unifiedChatRoutes);
app.use("/api/experiment-results", experimentResultsRoutes);
app.use("/api/r-code", rCodeRoutes);
app.use("/api/data-analysis", dataAnalysisRoutes);
app.use("/api/draft-assets", createDraftAssetsRouter({ sessionStore }));
app.use("/api/ocr", ocrRoutes);
app.use("/api/ppt-master", pptMasterRoutes);
app.use("/api/pdf-wiki/marker", pdfMarkerRoutes);
app.use("/api/pdf-wiki/fast-text", pdfFastTextRoutes);
app.use("/api/meta-analysis", createMetaAnalysisRouter({
  getIntegratedDataTablesForExport: (userId, pdfIds) => pdfWikiManager.getIntegratedDataTablesForExport(userId, pdfIds),
  generateAiPlan: generateMetaAnalysisAiPlan,
}));
app.use("/api/academic-research", academicResearchRoutes);
app.use("/api/project-memory", projectMemoryRoutes);
app.use("/api/research-session", createResearchSessionRouter({
  loadUserMemory,
  getPdfWikiStatus: (userId: string) => pdfWikiManager.getStatus(userId) as unknown as Promise<Record<string, unknown>>,
  readUserLiteratureRecords,
  getCurrentProject: () => projectManager.getCurrentProject() as unknown as Record<string, unknown>,
}));
app.use("/api/bibliometrics", createBibliometricsRouter({
  readUserLiteratureRecords,
  loadOuterTagsConfigForUser,
}));
app.use("/api/autoresearch", createAutoResearchRouter({
  manager: autoResearchManager,
  pdfWikiManager,
  projectManager,
  readUserLiteratureRecords,
  loadOuterTagsConfigForUser,
  saveOuterTagsConfigForUser,
  refreshOuterTagCounts,
  consumeCloudQuota,
}));

type OverviewModuleStatus = "ready" | "running" | "empty" | "warning" | "error";

interface OverviewModule {
  id: string;
  name: string;
  status: OverviewModuleStatus;
  statusText: string;
  count: number;
  metrics: Array<{ label: string; value: string | number }>;
  note: string;
  action: string;
}

interface OverviewStatusPayload {
  userId: string;
  generatedAt: string;
  project: ReturnType<ProjectManager["getCurrentProject"]>;
  modules: OverviewModule[];
  model: {
    primaryConfigured: boolean;
    primaryModel: string;
    primaryLabel: string;
    primarySource: string;
    secondaryConfigured: boolean;
    secondaryModel: string;
    secondaryLabel: string;
    embeddingEnabled: boolean;
    embeddingConfigured: boolean;
    embeddingModel: string;
    codexPreferred: boolean;
    codexAvailable: boolean;
    liteParseAvailable: boolean;
    markerAvailable: boolean;
    pdfMarkerMdAvailable: boolean;
  };
  literature: {
    total: number;
    embedded: number;
    abstractCount: number;
    keywordCount: number;
    recent: Array<Record<string, string | number | boolean>>;
  };
  pdfWiki: {
    pdfCount: number;
    entryCount: number;
    sentencePointCount: number;
    referenceCount: number;
    processedPdfCount: number;
    figureCount: number;
    status: Record<string, unknown>;
  };
  meta: {
    pdfCount: number;
    rowCount: number;
    columnCount: number;
    referenceCount: number;
    latestRunAvailable: boolean;
  };
  bibliometrics: {
    available: boolean;
    recordCount: number;
    datasetId: string;
    updatedAt: string;
    outputCount: number;
  };
  dataAnalysis: {
    available: boolean;
    datasetFileName: string;
    sheetName: string;
    rowCount: number;
    columnCount: number;
    variableCount: number;
    numericVariableCount: number;
    categoricalVariableCount: number;
    methods: string[];
    methodLabels: string[];
    updatedAt: string;
    resultTitle: string;
    warningCount: number;
    researchSessionId: string;
  };
  autoResearch: {
    taskTitle: string;
    topic: string;
    status: string;
    currentStageId: string;
    stageDoneCount: number;
    stageTotalCount: number;
    evidenceObjectCount: number;
    literatureNodeCount: number;
    finalReportCount: number;
    paperDraftCount: number;
    completedTaskCount: number;
    operationCount: number;
    latestReportTitle: string;
  };
  drafts: {
    count: number;
    chapters: Array<{ chapterName: string; savedAt: string; length: number }>;
    legacyExists: boolean;
    legacyLength: number;
  };
  memory: {
    entryCount: number;
    conversationCount: number;
    updatedAt: string;
    keys: string[];
  };
  cache?: {
    status: "fresh" | "cached" | "refreshing";
    cachedAt?: string;
    reason?: string;
  };
}

interface OverviewCacheFile {
  version: 1;
  userId: string;
  projectId: string;
  cachedAt: string;
  reason: string;
  overview: OverviewStatusPayload;
}

const OVERVIEW_CACHE_VERSION = 1;
const OVERVIEW_CACHE_STALE_MS = 6 * 60 * 60 * 1000;
const overviewRefreshTimers = new Map<string, NodeJS.Timeout>();
const overviewRefreshJobs = new Map<string, Promise<OverviewStatusPayload>>();

function cleanOverviewText(value: unknown, maxLength = 1200): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, Math.max(0, maxLength));
}

function readOverviewJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch (error) {
    logger.warn(`[Overview] Failed to read JSON file: ${filePath}`, error);
    return null;
  }
}

function getOverviewArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getOverviewRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getOverviewString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : (typeof value === "number" && Number.isFinite(value) ? String(value) : "");
}

function formatOverviewAuthors(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map(item => {
      if (typeof item === "string") return item;
      const record = getOverviewRecord(item);
      return getOverviewString(record, "name") || getOverviewString(record, "fullName") || getOverviewString(record, "displayName");
    })
    .filter(Boolean)
    .join(", ");
}

function getOverviewNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return 0;
}

function countOverviewDirectoryFiles(dirPath: string): number {
  try {
    if (!fs.existsSync(dirPath)) return 0;
    return fs.readdirSync(dirPath, { withFileTypes: true }).filter(entry => entry.isFile()).length;
  } catch {
    return 0;
  }
}

function resolveOverviewProjectContext(): {
  projectId: string;
  projectName: string;
  writingProfileId?: ProjectWritingProfileId;
  writingProfileLabel?: string;
} {
  const currentProject = projectManager.getCurrentProject();
  return {
    projectId: currentProject.projectId || "current-workspace",
    projectName: currentProject.name || "当前工作区",
    writingProfileId: currentProject.writingProfileId,
    writingProfileLabel: currentProject.writingProfileLabel,
  };
}

function sanitizeOverviewCacheSegment(value: unknown): string {
  return String(value || "current-workspace")
    .trim()
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 120) || "current-workspace";
}

function getOverviewCacheProjectId(): string {
  return sanitizeOverviewCacheSegment(resolveOverviewProjectContext().projectId || "current-workspace");
}

function getOverviewRefreshKey(userId: string): string {
  return `${sanitizeUserId(userId || "web-user")}:${getOverviewCacheProjectId()}`;
}

function getOverviewBibliometricsStatus(userId: string): OverviewStatusPayload["bibliometrics"] {
  const bibliometricsDir = path.join(getUserUploadDir(userId), "bibliometrics");
  const dataset = readOverviewJsonFile(path.join(bibliometricsDir, "current-dataset.json"));
  const records = getOverviewArray(dataset?.records);
  const outputsRoot = path.join(bibliometricsDir, "datasets");
  let outputCount = 0;
  try {
    if (fs.existsSync(outputsRoot)) {
      for (const datasetDir of fs.readdirSync(outputsRoot, { withFileTypes: true })) {
        if (!datasetDir.isDirectory()) continue;
        outputCount += countOverviewDirectoryFiles(path.join(outputsRoot, datasetDir.name, "outputs"));
      }
    }
  } catch {
    outputCount = 0;
  }
  return {
    available: !!dataset && records.length > 0,
    recordCount: getOverviewNumber(dataset || {}, "recordCount") || records.length,
    datasetId: getOverviewString(dataset || {}, "id") || getOverviewString(dataset || {}, "datasetId"),
    updatedAt: getOverviewString(dataset || {}, "updatedAt") || getOverviewString(dataset || {}, "generatedAt"),
    outputCount,
  };
}

function getOverviewDataAnalysisStatus(userId: string): OverviewStatusPayload["dataAnalysis"] {
  const status = readOverviewJsonFile(path.join(getUserUploadDir(userId), "data-analysis", "latest-analysis.json"));
  const dataset = getOverviewRecord(status?.dataset);
  const result = getOverviewRecord(status?.result);
  const researchSession = getOverviewRecord(status?.researchSession);
  const methods = getOverviewArray(status?.methods).map(item => String(item || "").trim()).filter(Boolean);
  const methodLabels = getOverviewArray(status?.methodLabels).map(item => String(item || "").trim()).filter(Boolean);
  return {
    available: !!status,
    datasetFileName: getOverviewString(dataset, "filename"),
    sheetName: getOverviewString(dataset, "sheetName"),
    rowCount: getOverviewNumber(dataset, "rowCount"),
    columnCount: getOverviewNumber(dataset, "columnCount"),
    variableCount: getOverviewNumber(dataset, "variableCount"),
    numericVariableCount: getOverviewNumber(dataset, "numericVariableCount"),
    categoricalVariableCount: getOverviewNumber(dataset, "categoricalVariableCount"),
    methods,
    methodLabels,
    updatedAt: getOverviewString(status || {}, "updatedAt"),
    resultTitle: getOverviewString(result, "title"),
    warningCount: getOverviewNumber(result, "warningCount"),
    researchSessionId: getOverviewString(researchSession, "sessionId"),
  };
}

async function getOverviewDraftStatus(userId: string): Promise<OverviewStatusPayload["drafts"]> {
  const drafts = await sessionStore.listDrafts(userId);
  const chapters = await Promise.all(drafts.map(async draft => {
    const data = await sessionStore.loadDraft(userId, draft.chapterName);
    return {
      chapterName: draft.chapterName,
      savedAt: draft.savedAt,
      length: data?.content?.length || 0,
    };
  }));
  const legacyDraftPath = path.join(getUserUploadDir(userId), "paper-draft.tex");
  let legacyLength = 0;
  if (fs.existsSync(legacyDraftPath)) {
    try {
      legacyLength = fs.statSync(legacyDraftPath).size;
    } catch {
      legacyLength = 0;
    }
  }
  return {
    count: chapters.length + (legacyLength > 0 ? 1 : 0),
    chapters,
    legacyExists: legacyLength > 0,
    legacyLength,
  };
}

const ORDINARY_DRAFT_CHAPTER_ORDER = ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];

function sortOrdinaryDrafts<T extends { chapterName: string; savedAt: string }>(drafts: T[]): T[] {
  return [...drafts].sort((a, b) => {
    const indexA = ORDINARY_DRAFT_CHAPTER_ORDER.indexOf(a.chapterName.toLowerCase());
    const indexB = ORDINARY_DRAFT_CHAPTER_ORDER.indexOf(b.chapterName.toLowerCase());
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
  });
}

function estimateDraftWordCount(content: string): number {
  const compact = String(content || '').replace(/\s+/g, '');
  return compact.length;
}

function trimDraftContextForChat(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[普通草稿内容已按上下文长度截断：已提供前 ${maxChars} 字符，完整草稿仍保存在本地。]`;
}

function formatDraftFigureAssetsForContext(figures: Awaited<ReturnType<typeof loadDraftFigureAssetsForUser>>): string {
  if (!figures.length) return '';
  const lines = figures
    .slice()
    .sort((a, b) =>
      a.chapterKey.localeCompare(b.chapterKey, 'zh-CN', { numeric: true })
      || a.subsectionKey.localeCompare(b.subsectionKey, 'zh-CN', { numeric: true })
      || a.figureLabel.localeCompare(b.figureLabel, 'zh-CN', { numeric: true })
    )
    .map(figure => {
      const subsection = [figure.subsectionId, figure.subsectionTitle].filter(Boolean).join(' ');
      return `- ${figure.figureLabel}: ${figure.caption || '无图注'}；章节=${figure.chapterKey}${subsection ? `；小节=${subsection}` : ''}；文件=${figure.relativePath}`;
    });
  return ['## 已归档章节图件', ...lines].join('\n');
}

function isDraftProgressRequest(request: string): boolean {
  const text = String(request || '').toLowerCase();
  return [
    /写作进度/,
    /写到哪[了里]?/,
    /写到什么程度/,
    /完成到哪/,
    /完成了哪些/,
    /还差哪些/,
    /还有哪些没写/,
    /草稿进度/,
    /论文进度/,
    /writing progress/,
  ].some(pattern => pattern.test(text));
}

async function loadOrdinaryDraftContextForSingleUser(safeUserId: string, maxContentChars: number, sourceScope: string) {
  try {
    const drafts = sortOrdinaryDrafts(await sessionStore.listDrafts(safeUserId));
    const chapterBlocks: string[] = [];
    const chapterSummaries: string[] = [];
    const chapterNames: string[] = [];
    let latestSavedAt = '';
    let totalContent = '';

    for (const draft of drafts) {
      const draftData = await sessionStore.loadDraft(safeUserId, draft.chapterName);
      const content = draftData?.content || '';
      if (!content.trim()) continue;

      const savedAt = draftData?.savedAt || draft.savedAt;
      if (!latestSavedAt || new Date(savedAt).getTime() > new Date(latestSavedAt).getTime()) {
        latestSavedAt = savedAt;
      }

      const chapterTitle = draft.chapterName.charAt(0).toUpperCase() + draft.chapterName.slice(1);
      chapterNames.push(draft.chapterName);
      chapterSummaries.push(`- ${draft.chapterName}: ${estimateDraftWordCount(content)} 字符，保存于 ${savedAt}`);
      chapterBlocks.push(`\\section{${chapterTitle}}\n${content}`);
      totalContent += `\n${content}`;
    }

    if (chapterBlocks.length > 0) {
      const combinedContent = chapterBlocks.join('\n\n');
      const completedChapterNames = chapterNames.filter(Boolean);
      const figureContext = formatDraftFigureAssetsForContext(await loadDraftFigureAssetsForUser(safeUserId));
      const statusBlock = [
        '# 普通论文草稿状态',
        `- 来源：分章节草稿 sessionStore（${sourceScope}）`,
        '- 优先级：这是当前普通草稿的真实状态，必须优先于长期记忆中的旧写作进度。',
        `- 已保存章节数：${chapterNames.length}`,
        `- 已保存章节：${chapterNames.join(', ')}`,
        completedChapterNames.length > 0 ? `- 进度判断：${completedChapterNames.join(', ')} 已经进入普通草稿；回答写作进度时不要说这些章节“尚未正式成稿”。` : '',
        latestSavedAt ? `- 最近保存时间：${latestSavedAt}` : '',
        `- 总字符估算：${estimateDraftWordCount(totalContent)}`,
        '',
        '## 章节明细',
        chapterSummaries.join('\n'),
        figureContext,
        '',
        '## 草稿内容',
        trimDraftContextForChat(combinedContent, maxContentChars),
      ].filter(Boolean).join('\n');

      return {
        available: true,
        source: `sessionStore:${sourceScope}`,
        chapters: chapterNames,
        updatedAt: latestSavedAt,
        wordCount: estimateDraftWordCount(totalContent),
        content: statusBlock,
      };
    }
  } catch (error) {
    logger.warn(`[Draft] Failed to build ordinary draft context from sessionStore for ${safeUserId}:`, error);
  }

  const legacyDraftPath = path.join(getUserUploadDir(safeUserId), "paper-draft.tex");
  if (fs.existsSync(legacyDraftPath)) {
    try {
      const content = fs.readFileSync(legacyDraftPath, 'utf-8');
      if (content.trim()) {
        const stat = fs.statSync(legacyDraftPath);
        return {
          available: true,
          source: `paper-draft.tex:${sourceScope}`,
          chapters: [],
          updatedAt: stat.mtime.toISOString(),
          wordCount: estimateDraftWordCount(content),
          content: [
            '# 普通论文草稿状态',
            `- 来源：旧版整篇草稿 paper-draft.tex（${sourceScope}）`,
            '- 优先级：这是当前普通草稿的真实状态，必须优先于长期记忆中的旧写作进度。',
            `- 最近修改时间：${stat.mtime.toISOString()}`,
            `- 总字符估算：${estimateDraftWordCount(content)}`,
            '',
            '## 草稿内容',
            trimDraftContextForChat(content, maxContentChars),
          ].join('\n'),
        };
      }
    } catch (error) {
      logger.warn(`[Draft] Failed to read legacy paper draft for ${safeUserId}:`, error);
    }
  }

  return null;
}

async function getOrdinaryDraftContextForChat(userId: string, request: string) {
  const safeUserId = sanitizeUserId(userId || "web-user");
  const progressRequest = isDraftProgressRequest(request);
  const maxContentChars = progressRequest ? 18000 : 24000;
  const candidateUserIds = safeUserId === "web-user" ? ["web-user"] : [safeUserId, "web-user"];

  for (const candidateUserId of candidateUserIds) {
    const sourceScope = candidateUserId === safeUserId
      ? `current-user:${candidateUserId}`
      : `fallback:${candidateUserId}`;
    const draftContext = await loadOrdinaryDraftContextForSingleUser(candidateUserId, maxContentChars, sourceScope);
    if (draftContext?.available) {
      if (candidateUserId !== safeUserId) {
        logger.info(`[Draft] Ordinary draft context fell back from ${safeUserId} to ${candidateUserId}`);
      }
      return draftContext;
    }
  }

  return {
    available: false,
    reason: '未找到普通论文草稿',
  };
}

function buildOverviewModule(
  id: string,
  name: string,
  status: OverviewModuleStatus,
  statusText: string,
  count: number,
  metrics: Array<{ label: string; value: string | number }>,
  note: string,
  action: string
): OverviewModule {
  return { id, name, status, statusText, count, metrics, note, action };
}

async function computeOverviewStatus(userId: string): Promise<OverviewStatusPayload> {
  const safeUserId = sanitizeUserId(userId || "web-user");
  const now = new Date().toISOString();
  const project = projectManager.getCurrentProject();
  const literatureRecords = readUserLiteratureRecords(safeUserId);
  const pdfWikiStatus = await pdfWikiManager.getStatus(safeUserId);
  const pdfWikiStore = await pdfWikiManager.getStore(safeUserId);
  const metaDatabase = await pdfWikiManager.getMetaDatabase(safeUserId, { includeDetails: false });
  const autoResearchState = await autoResearchManager.getState(safeUserId, resolveOverviewProjectContext());
  const drafts = await getOverviewDraftStatus(safeUserId);
  const memory = await loadReviewMemoryWithFallback(safeUserId);
  const bibliometrics = getOverviewBibliometricsStatus(safeUserId);
  const dataAnalysis = getOverviewDataAnalysisStatus(safeUserId);
  const primaryRuntime = getPrimaryRuntimeConfig();
  const runtime = getDeepAnalysisSecondaryRuntimeConfig();
  const codexConfig = loadCodexConfigForPdfWiki();
  const stageDoneCount = (autoResearchState.task.stages || []).filter(stage => stage.status === "done").length;
  const metaRowCount = metaDatabase.items.reduce((sum, item) => sum + (item.dataTable?.rowCount || 0), 0);
  const metaColumnSet = new Set<string>();
  metaDatabase.items.forEach(item => (item.dataTable?.columns || []).forEach((column: string) => metaColumnSet.add(column)));
  const figureCount = pdfWikiStore.pdfs.reduce((sum, pdf) => sum + countOverviewDirectoryFiles(path.join(getPdfWikiCodexExtractDir(safeUserId, pdf.id), "figures")), 0);
  const embeddedCount = literatureRecords.filter(record => Array.isArray(record.embedding) && record.embedding.length > 0).length;
  const abstractCount = literatureRecords.filter(record => cleanOverviewText(record.abstract, 1)).length;
  const keywordCount = literatureRecords.reduce((sum, record) => {
    const keywords = Array.isArray(record.keywords) ? record.keywords : String(record.keywords || "").split(/[;,，；]/);
    return sum + keywords.filter(item => String(item || "").trim()).length;
  }, 0);
  const latestFinalReport = autoResearchState.finalReports[0];
  const latestAutoDraft = autoResearchState.paperDrafts[0];
  const completedAutoResearchTaskCount = autoResearchState.completedTaskRecords?.length || autoResearchState.finalReports.length;
  const modules: OverviewModule[] = [
    buildOverviewModule(
      "literature",
      "Embedding文献库",
      literatureRecords.length > 0 ? "ready" : "empty",
      literatureRecords.length > 0 ? "已导入" : "未导入",
      literatureRecords.length,
      [
        { label: "带 embedding", value: embeddedCount },
        { label: "有摘要", value: abstractCount },
      ],
      literatureRecords.length > 0 ? "可用于摘要级检索、Auto Research 和一键写论文。" : "先上传文献摘要或 WoS/RIS/BibTeX 数据。",
      "showEmbeddingLibrary"
    ),
    buildOverviewModule(
      "pdfWiki",
      "PDF句子级Wiki论点库",
      pdfWikiStatus.status === "processing" ? "running" : ((pdfWikiStore.sentenceCloud?.points?.length || pdfWikiStore.entries.length) > 0 ? "ready" : "empty"),
      pdfWikiStatus.status === "processing" ? "生成中" : ((pdfWikiStore.sentenceCloud?.points?.length || pdfWikiStore.entries.length) > 0 ? "已生成" : "未生成"),
      pdfWikiStore.sentenceCloud?.points?.length || pdfWikiStore.entries.length,
      [
        { label: "PDF", value: pdfWikiStore.pdfs.length },
        { label: "参考文献", value: pdfWikiStore.referenceIndex.length },
      ],
      String(pdfWikiStatus.message || "PDF 深入分析后会形成句子级论点库。"),
      "showPdfWikiViewer"
    ),
    buildOverviewModule(
      "pdfManager",
      "PDF管理",
      pdfWikiStore.pdfs.length > 0 ? "ready" : "empty",
      pdfWikiStore.pdfs.length > 0 ? "有 PDF" : "无 PDF",
      pdfWikiStore.pdfs.length,
      [
        { label: "已处理", value: pdfWikiStore.pdfs.filter(pdf => !!pdf.processedAt).length },
        { label: "图片", value: figureCount },
      ],
      "管理 PDF 原文、重新识别、深入分析、阅读原文和 AI 聊论文。",
      "showPdfWikiPdfManager"
    ),
    buildOverviewModule(
      "meta",
      "Meta分析",
      metaDatabase.items.length > 0 ? "ready" : "empty",
      metaDatabase.items.length > 0 ? "已有编码表" : "未提取",
      metaDatabase.items.length,
      [
        { label: "行", value: metaRowCount },
        { label: "列", value: metaColumnSet.size },
      ],
      metaDatabase.items.length > 0 ? "可继续编辑编码表、运行效应量和 R 图。" : "上传或提取 Meta 分析 PDF 数据后会显示。",
      "showPdfWikiMetaDatabase"
    ),
    buildOverviewModule(
      "bibliometrics",
      "文献计量分析",
      bibliometrics.available ? "ready" : "empty",
      bibliometrics.available ? "已有数据集" : "未上传",
      bibliometrics.recordCount,
      [
        { label: "输出文件", value: bibliometrics.outputCount },
        { label: "数据集", value: bibliometrics.datasetId || "-" },
      ],
      bibliometrics.available ? "可查看年度趋势、关键词、网络、Excel 和图表。" : "上传 WoS Plain Text 后自动形成文献计量结果。",
      "showBibliometricsDialog"
    ),
    buildOverviewModule(
      "dataAnalysis",
      "数据统计分析",
      dataAnalysis.available ? "ready" : "empty",
      dataAnalysis.available ? "已有分析" : "未分析",
      dataAnalysis.available ? dataAnalysis.rowCount : 0,
      [
        { label: "变量", value: dataAnalysis.variableCount },
        { label: "方法", value: dataAnalysis.methodLabels.slice(0, 2).join(" + ") || "-" },
      ],
      dataAnalysis.available
        ? `${dataAnalysis.datasetFileName || "数据集"}：${dataAnalysis.resultTitle || "统计分析结果"}`
        : "上传 Excel/CSV 后可做描述性统计、显著性检验、相关/回归和 R 作图联动。",
      "showDataAnalysisDialog"
    ),
    buildOverviewModule(
      "autoResearch",
      "Auto Research",
      completedAutoResearchTaskCount > 0 ? "ready" : (autoResearchState.task.status === "active" ? "running" : "empty"),
      completedAutoResearchTaskCount > 0 ? "已有任务记录" : (autoResearchState.task.status === "active" ? "任务中" : "未运行"),
      completedAutoResearchTaskCount,
      [
        { label: "阶段", value: `${stageDoneCount}/${autoResearchState.task.stages.length}` },
        { label: "证据", value: autoResearchState.evidenceLibrary.objects.length + autoResearchState.literatureMap.nodes.length },
      ],
      latestFinalReport?.title || "自动调研会整合文献库、PDF Wiki、写作蓝图和引用审计。",
      "showAutoResearchMode"
    ),
    buildOverviewModule(
      "paperWriting",
      "一键写论文/讨论式写作",
      drafts.count > 0 || latestAutoDraft ? "ready" : "empty",
      drafts.count > 0 || latestAutoDraft ? "已有草稿" : "未生成",
      drafts.count + (latestAutoDraft ? 1 : 0),
      [
        { label: "章节草稿", value: drafts.chapters.length },
        { label: "Auto草稿", value: latestAutoDraft ? 1 : 0 },
      ],
      "可调用 Auto Research、文献计量、Meta 分析、PDF Wiki 和长期记忆继续写作。",
      "showReviewWriterDialog"
    ),
    buildOverviewModule(
      "memory",
      "长期记忆",
      memory.entries.length > 0 || memory.conversations.length > 0 ? "ready" : "empty",
      memory.entries.length > 0 || memory.conversations.length > 0 ? "已记录" : "为空",
      memory.entries.length,
      [
        { label: "会话", value: memory.conversations.length },
        { label: "更新", value: memory.updatedAt ? new Date(memory.updatedAt).toLocaleDateString("zh-CN") : "-" },
      ],
      "全局 AI 会把长期记忆作为用户研究背景、实验资料和偏好上下文。",
      "showClearMemoryDialog"
    ),
  ];

  return {
    userId: safeUserId,
    generatedAt: now,
    project,
    modules,
    model: {
      primaryConfigured: primaryRuntime.configured,
      primaryModel: primaryRuntime.model || "",
      primaryLabel: primaryRuntime.label,
      primarySource: primaryRuntime.source,
      secondaryConfigured: runtime.configured,
      secondaryModel: runtime.model || "",
      secondaryLabel: runtime.label,
      embeddingEnabled: currentEmbeddingConfig.enabled,
      embeddingConfigured: !!(currentEmbeddingConfig.enabled && currentEmbeddingConfig.url && currentEmbeddingConfig.key),
      embeddingModel: currentEmbeddingConfig.model,
      codexPreferred: codexConfig.prefer,
      codexAvailable: isCodexCliLikelyAvailableForPdfWiki(),
      liteParseAvailable: isLiteParseAvailable(),
      markerAvailable: isPdfMarkerAvailable(),
      pdfMarkerMdAvailable: isPdfFastTextAvailable(),
    },
    literature: {
      total: literatureRecords.length,
      embedded: embeddedCount,
      abstractCount,
      keywordCount,
      recent: literatureRecords.slice(-8).reverse().map(record => ({
        title: cleanOverviewText(record.title, 180),
        author: cleanOverviewText(record.author || formatOverviewAuthors(record.authors), 160),
        year: cleanOverviewText(record.year, 20),
        journal: cleanOverviewText(record.journal, 120),
        hasEmbedding: Array.isArray(record.embedding) && record.embedding.length > 0,
      })),
    },
    pdfWiki: {
      pdfCount: pdfWikiStore.pdfs.length,
      entryCount: pdfWikiStore.entries.length,
      sentencePointCount: pdfWikiStore.sentenceCloud?.points?.length || 0,
      referenceCount: pdfWikiStore.referenceIndex.length,
      processedPdfCount: pdfWikiStore.pdfs.filter(pdf => !!pdf.processedAt).length,
      figureCount,
      status: pdfWikiStatus as unknown as Record<string, unknown>,
    },
    meta: {
      pdfCount: metaDatabase.items.length,
      rowCount: metaRowCount,
      columnCount: metaColumnSet.size,
      referenceCount: metaDatabase.referenceCount,
      latestRunAvailable: !!readOverviewJsonFile(path.join(getUserUploadDir(safeUserId), "meta-analysis", "writing-context.json")),
    },
    bibliometrics,
    dataAnalysis,
    autoResearch: {
      taskTitle: autoResearchState.task.title,
      topic: autoResearchState.task.topic || autoResearchState.task.goal,
      status: autoResearchState.task.status,
      currentStageId: autoResearchState.task.currentStageId,
      stageDoneCount,
      stageTotalCount: autoResearchState.task.stages.length,
      evidenceObjectCount: autoResearchState.evidenceLibrary.objects.length,
      literatureNodeCount: autoResearchState.literatureMap.nodes.length,
      finalReportCount: autoResearchState.finalReports.length,
      paperDraftCount: autoResearchState.paperDrafts.length,
      completedTaskCount: autoResearchState.completedTaskRecords?.length || 0,
      operationCount: autoResearchState.operations.length,
      latestReportTitle: latestFinalReport?.title || "",
    },
    drafts,
    memory: {
      entryCount: memory.entries.length,
      conversationCount: memory.conversations.length,
      updatedAt: memory.updatedAt,
      keys: memory.entries.map(entry => entry.key).slice(0, 40),
    },
  };
}

function getOverviewCacheDir(userId: string): string {
  return path.join(getDataDir(), 'overview-cache', sanitizeUserId(userId || 'web-user'), getOverviewCacheProjectId());
}

function getOverviewCachePath(userId: string): string {
  return path.join(getOverviewCacheDir(userId), 'status.json');
}

function readOverviewCache(userId: string): OverviewCacheFile | null {
  try {
    const filePath = getOverviewCachePath(userId);
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<OverviewCacheFile>;
    if (!parsed || parsed.version !== OVERVIEW_CACHE_VERSION || !parsed.overview) return null;
    if (parsed.projectId && parsed.projectId !== getOverviewCacheProjectId()) return null;
    return parsed as OverviewCacheFile;
  } catch (error) {
    logger.warn(`[Overview] Failed to read status cache for ${sanitizeUserId(userId)}:`, error);
    return null;
  }
}

function writeOverviewCache(userId: string, overview: OverviewStatusPayload, reason: string): void {
  const safeUserId = sanitizeUserId(userId || 'web-user');
  const cachedAt = new Date().toISOString();
  const cacheFile: OverviewCacheFile = {
    version: OVERVIEW_CACHE_VERSION,
    userId: safeUserId,
    projectId: getOverviewCacheProjectId(),
    cachedAt,
    reason,
    overview: {
      ...overview,
      cache: {
        status: 'fresh',
        cachedAt,
        reason,
      },
    },
  };
  const cachePath = getOverviewCachePath(safeUserId);
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(cacheFile, null, 2), 'utf-8');
}

async function refreshOverviewCacheNow(userId: string, reason: string): Promise<OverviewStatusPayload> {
  const safeUserId = sanitizeUserId(userId || 'web-user');
  const refreshKey = getOverviewRefreshKey(safeUserId);
  const existing = overviewRefreshJobs.get(refreshKey);
  if (existing) return existing;

  const job = (async () => {
    const overview = await computeOverviewStatus(safeUserId);
    writeOverviewCache(safeUserId, overview, reason);
    logger.info(`[Overview] Refreshed status cache for ${safeUserId}; reason=${reason}`);
    return {
      ...overview,
      cache: {
        status: 'fresh' as const,
        cachedAt: new Date().toISOString(),
        reason,
      },
    };
  })().finally(() => {
    overviewRefreshJobs.delete(refreshKey);
  });

  overviewRefreshJobs.set(refreshKey, job);
  return job;
}

function scheduleOverviewCacheRefresh(userId: string, reason: string, delayMs = 1800): void {
  const safeUserId = sanitizeUserId(userId || 'web-user');
  const refreshKey = getOverviewRefreshKey(safeUserId);
  const existingTimer = overviewRefreshTimers.get(refreshKey);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    overviewRefreshTimers.delete(refreshKey);
    refreshOverviewCacheNow(safeUserId, reason).catch(error => {
      logger.warn(`[Overview] Background status cache refresh failed for ${safeUserId}:`, error);
    });
  }, delayMs);
  overviewRefreshTimers.set(refreshKey, timer);
}

async function buildOverviewStatus(
  userId: string,
  options: { forceRefresh?: boolean; reason?: string } = {},
): Promise<OverviewStatusPayload> {
  const safeUserId = sanitizeUserId(userId || 'web-user');
  if (options.forceRefresh) {
    return refreshOverviewCacheNow(safeUserId, options.reason || 'manual-refresh');
  }

  const cached = readOverviewCache(safeUserId);
  if (cached?.overview) {
    const refreshKey = getOverviewRefreshKey(safeUserId);
    const ageMs = Date.now() - new Date(cached.cachedAt).getTime();
    if (ageMs > OVERVIEW_CACHE_STALE_MS) {
      scheduleOverviewCacheRefresh(safeUserId, 'stale-cache');
    }
    return {
      ...cached.overview,
      cache: {
        status: overviewRefreshJobs.has(refreshKey) ? 'refreshing' : 'cached',
        cachedAt: cached.cachedAt,
        reason: cached.reason,
      },
    };
  }

  return refreshOverviewCacheNow(safeUserId, options.reason || 'cache-miss');
}

async function buildOverviewAiContext(userId: string, status: OverviewStatusPayload): Promise<string> {
  const safeUserId = sanitizeUserId(userId || "web-user");
  const [memory, autoResearchState, pdfWikiStore, metaDatabase] = await Promise.all([
    loadReviewMemoryWithFallback(safeUserId),
    autoResearchManager.getState(safeUserId, resolveOverviewProjectContext()),
    pdfWikiManager.getStore(safeUserId),
    pdfWikiManager.getMetaDatabase(safeUserId, { includeDetails: true }),
  ]);
  const literatureRecords = readUserLiteratureRecords(safeUserId);
  const bibliometrics = getOverviewBibliometricsStatus(safeUserId);
  const dataAnalysis = getOverviewDataAnalysisStatus(safeUserId);
  const drafts = await getOverviewDraftStatus(safeUserId);
  const draftPreviews = await Promise.all(drafts.chapters.slice(0, 12).map(async draft => {
    const data = await sessionStore.loadDraft(safeUserId, draft.chapterName);
    return {
      chapterName: draft.chapterName,
      savedAt: draft.savedAt,
      contentPreview: cleanOverviewText(data?.content, 3000),
    };
  }));
  const context = {
    instruction: "这是 Scholar Harness 当前用户的全局状态与可用信息摘要。AI 回答必须基于这些信息，不能编造不存在的文件、结果或统计。",
    status,
    longTermMemory: {
      userId: memory.userId,
      updatedAt: memory.updatedAt,
      entries: memory.entries.map(entry => ({
        key: entry.key,
        value: cleanOverviewText(entry.value, 9000),
        source: entry.source,
        timestamp: entry.timestamp,
      })),
      recentConversations: memory.conversations.slice(-12).map(conv => ({
        title: conv.title,
        summary: cleanOverviewText(conv.summary, 2200),
        keyTopics: conv.keyTopics || [],
        updatedAt: conv.updatedAt,
      })),
    },
    literatureLibrary: literatureRecords.slice(0, 120).map(record => ({
      title: cleanOverviewText(record.title, 300),
      author: cleanOverviewText(record.author || formatOverviewAuthors(record.authors), 240),
      year: cleanOverviewText(record.year, 40),
      journal: cleanOverviewText(record.journal, 180),
      doi: cleanOverviewText(record.doi, 140),
      keywords: Array.isArray(record.keywords) ? record.keywords.slice(0, 12) : cleanOverviewText(record.keywords, 400),
      abstract: cleanOverviewText(record.abstract, 1600),
      hasEmbedding: Array.isArray(record.embedding) && record.embedding.length > 0,
    })),
    pdfWiki: {
      generatedAt: pdfWikiStore.generatedAt,
      pdfs: pdfWikiStore.pdfs.slice(0, 80).map(pdf => ({
        id: pdf.id,
        title: cleanOverviewText(pdf.title || pdf.originalName, 300),
        authors: cleanOverviewText(pdf.authors, 240),
        year: cleanOverviewText(pdf.year, 40),
        journal: cleanOverviewText(pdf.journal, 180),
        doi: cleanOverviewText(pdf.doi, 140),
        textLength: pdf.textLength || 0,
        processedAt: pdf.processedAt || "",
      })),
      entries: pdfWikiStore.entries.slice(0, 120).map(entry => ({
        claim: cleanOverviewText(entry.displayClaimZh || entry.normalizedClaim || entry.claim, 500),
        sourcePdfNames: entry.sourcePdfNames || [],
        proCount: entry.pro.length,
        neutralCount: entry.neutral.length,
        conCount: entry.con.length,
        snippets: (entry.evidenceSnippets || []).slice(0, 4).map(item => cleanOverviewText(item, 500)),
      })),
      sentencePoints: (pdfWikiStore.sentenceCloud?.points || []).slice(0, 120).map(point => ({
        claim: cleanOverviewText(point.claimText || point.sentence, 500),
        sentence: cleanOverviewText(point.sentence, 600),
        sourcePdfTitle: cleanOverviewText(point.sourcePdfTitle || point.sourcePdfName, 260),
        section: cleanOverviewText(point.section, 80),
      })),
    },
    metaAnalysis: {
      generatedAt: metaDatabase.generatedAt,
      pdfCount: metaDatabase.pdfCount,
      referenceCount: metaDatabase.referenceCount,
      tables: metaDatabase.items.slice(0, 50).map(item => ({
        pdfTitle: cleanOverviewText(item.title || item.originalName, 260),
        rowCount: item.dataTable?.rowCount || 0,
        columns: (item.dataTable?.columns || []).slice(0, 80),
        sampleRows: (item.dataTable?.rows || []).slice(0, 8),
      })),
    },
    bibliometrics,
    dataAnalysis,
    autoResearch: {
      task: autoResearchState.task,
      projectMemory: autoResearchState.projectMemory.slice(0, 80),
      latestFinalReport: autoResearchState.finalReports[0] || null,
      latestPaperDraft: autoResearchState.paperDrafts[0]
        ? {
            title: autoResearchState.paperDrafts[0].title,
            generatedAt: autoResearchState.paperDrafts[0].generatedAt,
            markdownPreview: cleanOverviewText(autoResearchState.paperDrafts[0].editedMarkdown || autoResearchState.paperDrafts[0].markdown, 8000),
          }
        : null,
      latestEvaluation: autoResearchState.evaluations[0] || null,
      latestAudit: autoResearchState.auditReports[0] || null,
      completedTaskRecords: (autoResearchState.completedTaskRecords || []).slice(0, 20),
      operations: autoResearchState.operations.slice(0, 60),
    },
    drafts: draftPreviews,
  };
  const raw = JSON.stringify(context, null, 2);
  if (raw.length <= 120000) return raw;
  return `${raw.slice(0, 85000)}\n\n[中间部分因上下文长度限制已省略，回答时不要把省略部分当作依据。]\n\n${raw.slice(-25000)}`;
}

function cleanOverviewChatHistory(value: unknown): Message[] {
  return getOverviewArray(value)
    .slice(-10)
    .map((item): Message | null => {
      const record = getOverviewRecord(item);
      const role = record.role === "assistant" ? "assistant" : (record.role === "user" ? "user" : null);
      const content = cleanOverviewText(record.content, 5000);
      return role && content ? { role, content } : null;
    })
    .filter((item): item is Message => !!item);
}

app.get("/api/overview/status", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const forceRefresh = req.query.refresh === "1" || req.query.force === "1";
    const overview = await buildOverviewStatus(userId, {
      forceRefresh,
      reason: forceRefresh ? "manual-status-refresh" : "status-read",
    });
    res.json({ success: true, overview });
  } catch (error) {
    logger.error("[Overview] Status route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "读取全局概览失败" });
  }
});

app.post("/api/overview/chat", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const query = cleanOverviewText(req.body?.query, 5000);
    const history = cleanOverviewChatHistory(req.body?.history);
    if (!query) {
      res.status(400).json({ success: false, error: "请输入要咨询 Overview AI 的问题" });
      return;
    }
    const runtime = getDeepAnalysisSecondaryRuntimeConfig();
    if (!runtime.configured || !runtime.apiUrl || !runtime.apiKey || !runtime.model) {
      res.status(400).json({
        success: false,
        error: "请先在配置里填写小牛马 API 地址、Key 和模型名",
      });
      return;
    }

    const status = await buildOverviewStatus(userId);
    const context = await buildOverviewAiContext(userId, status);
    const messages: Message[] = [
      {
        role: "system",
        content: [
          "你是 Scholar Harness 的全局 Overview AI 助手。",
          "你的任务是基于当前用户在 Scholar Harness 中已有的全部可用信息，帮助用户判断工具内已经有什么、状态如何、下一步应该做什么，以及如何把 Auto Research、一键写论文、文献计量、数据统计、PDF Wiki、Meta 分析、草稿和长期记忆衔接起来。",
          "必须区分：已存在的数据、正在运行的任务、缺失的数据、你的推断。不要编造没有上传或没有分析的结果。",
          "回答“大牛马是否配置”时只能看全局上下文 JSON 里的 status.model.primaryConfigured；不要因为存在默认主模型名就说大牛马已配置。",
          "回答“小牛马是否配置”时只能看全局上下文 JSON 里的 status.model.secondaryConfigured。",
          "回答使用中文，直接、具体、可执行。涉及论文事实或统计结果时，必须说明来自哪个模块或哪类证据。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "以下是当前用户的全局 Overview 上下文。请优先基于这些内容回答后续问题。",
          "",
          context,
        ].join("\n"),
      },
      ...history,
      {
        role: "user",
        content: `用户问题：${query}`,
      },
    ];

    const result = await callChatCompletion(
      {
        apiUrl: runtime.apiUrl,
        apiKey: runtime.apiKey,
        defaultModel: runtime.model,
        defaultTemperature: 0.2,
        label: runtime.label,
      },
      {
        model: runtime.model,
        temperature: 0.2,
        maxTokens: 2800,
        messages,
      }
    );

    res.json({
      success: true,
      result,
      model: runtime.model,
      label: runtime.label,
      context: {
        sentContextLength: context.length,
        historyMessages: history.length,
        moduleCount: status.modules.length,
      },
    });
  } catch (error) {
    logger.error("[Overview] Chat route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "Overview AI 交流失败" });
  }
});

type FlowchartMaterialInfo = {
  source: string;
  label: string;
  parser: string;
  length: number;
  error?: string;
};

const FLOWCHART_SOURCE_LABELS: Record<string, string> = {
  overview: "全局 Overview",
  memory: "长期记忆",
  literature: "Embedding 文献库",
  pdfWiki: "PDF句子级Wiki论点库",
  meta: "Meta 分析编码表",
  bibliometrics: "文献计量分析结果",
  autoResearch: "Auto Research 结果",
  drafts: "一键写论文草稿",
};

function parseFlowchartSelectedSources(value: unknown): string[] {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => String(item || "").trim())
      .filter(item => !!FLOWCHART_SOURCE_LABELS[item]);
  } catch {
    return String(raw || "")
      .split(",")
      .map(item => item.trim())
      .filter(item => !!FLOWCHART_SOURCE_LABELS[item]);
  }
}

function createFlowchartMarkdownSection(title: string, content: unknown, maxLength = 30000): string {
  const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  return `# ${title}\n\n${cleanOverviewText(text, maxLength)}`.trim();
}

function sanitizeFlowchartDslFromAi(content: string): string {
  const raw = cleanOverviewText(content, 20000);
  const fenceMatch = raw.match(/```(?:mermaid)?\s*([\s\S]*?)```/i);
  const source = fenceMatch ? fenceMatch[1] : raw;
  const lines = source
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^(```|mermaid\s*$)/i.test(line));
  const graphIndex = lines.findIndex(line => /^graph\s+(TD|LR|TB|BT|RL)\b/i.test(line));
  const selected = graphIndex >= 0 ? lines.slice(graphIndex) : lines;
  const dslLines: string[] = [];
  for (const line of selected) {
    if (/^graph\s+(TD|LR|TB|BT|RL)\b/i.test(line)) {
      dslLines.push(line.replace(/^graph\s+TB\b/i, "graph TD"));
      continue;
    }
    if (/^[A-Za-z][A-Za-z0-9_]*[\[\(\{<].+[\]\)\}>]\s*--?>\s*(?:\|[^|]{1,40}\|\s*)?[A-Za-z][A-Za-z0-9_]*[\[\(\{<].+[\]\)\}>]/.test(line)
      || /^[A-Za-z][A-Za-z0-9_]*\s*--?>\s*(?:\|[^|]{1,40}\|\s*)?[A-Za-z][A-Za-z0-9_]*/.test(line)
      || /^[A-Za-z][A-Za-z0-9_]*[\[\(\{<].+[\]\)\}>]\s*$/.test(line)
      || /^subgraph\b/i.test(line)
      || /^end$/i.test(line)
      || /^classDef\b/i.test(line)
      || /^class\s+/i.test(line)) {
      dslLines.push(line.replace(/；/g, ";"));
    }
  }
  if (!dslLines.some(line => /^graph\s+/i.test(line))) {
    dslLines.unshift("graph TD");
  }
  return dslLines.join("\n").trim();
}

function compactFlowchartMaterialsForAi(markdown: string, maxLength = 26000): string {
  const source = cleanOverviewText(markdown, 160000);
  if (source.length <= maxLength) return source;

  const sections = source
    .split(/\n\s*---\s*\n/g)
    .map(section => section.trim())
    .filter(Boolean);
  if (!sections.length) return cleanOverviewText(source, maxLength);

  const sectionBudget = Math.max(1800, Math.floor(maxLength / Math.max(1, sections.length)));
  const priorityPattern = /(title|name|caption|summary|objective|method|result|finding|conclusion|stage|step|figure|table|图|表|研究|问题|目标|实验|处理|样品|数据|变量|模型|统计|降低|增加|促进|抑制|机制|结果|结论|输出)/i;
  const compactSections = sections.map(section => {
    const lines = section
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const title = lines.find(line => /^#/.test(line)) || lines[0] || "";
    const priority = lines.filter(line => priorityPattern.test(line));
    const fallback = lines.filter(line => !priorityPattern.test(line));
    const merged: string[] = [];
    if (title) merged.push(title);
    for (const line of priority.slice(0, 42)) {
      if (!merged.includes(line)) merged.push(line);
    }
    for (const line of fallback.slice(0, 10)) {
      if (!merged.includes(line)) merged.push(line);
    }
    return cleanOverviewText(merged.join("\n"), sectionBudget);
  });

  return cleanOverviewText(compactSections.join("\n\n---\n\n"), maxLength);
}

function isFlowchartAiLengthError(error: unknown): boolean {
  const message = (error as Error)?.message || String(error || "");
  return /finish_reason\s*=\s*length|empty response|maximum context|context length|too many tokens|max_tokens/i.test(message);
}

function appendFlowchartMaterial(
  parts: string[],
  materials: FlowchartMaterialInfo[],
  source: string,
  label: string,
  parser: string,
  content: unknown,
  maxLength = 30000
): void {
  const section = createFlowchartMarkdownSection(label, content, maxLength);
  if (!section.trim()) return;
  parts.push(section);
  materials.push({
    source,
    label,
    parser,
    length: section.length,
  });
}

async function buildFlowchartInternalMaterials(userId: string, selectedSources: string[]): Promise<{ markdown: string; materials: FlowchartMaterialInfo[] }> {
  const safeUserId = sanitizeUserId(userId || "web-user");
  const parts: string[] = [];
  const materials: FlowchartMaterialInfo[] = [];
  const selected = new Set(selectedSources);

  if (selected.has("overview")) {
    const status = await buildOverviewStatus(safeUserId);
    appendFlowchartMaterial(parts, materials, "overview", FLOWCHART_SOURCE_LABELS.overview, "overview-status", {
      project: status.project,
      modules: status.modules,
      model: status.model,
      generatedAt: status.generatedAt,
    }, 26000);
  }

  if (selected.has("memory")) {
    const memory = await loadReviewMemoryWithFallback(safeUserId);
    appendFlowchartMaterial(parts, materials, "memory", FLOWCHART_SOURCE_LABELS.memory, "memory-json", {
      entries: memory.entries.map(entry => ({
        key: entry.key,
        value: cleanOverviewText(entry.value, 5000),
        updatedAt: entry.timestamp,
      })),
      recentConversations: memory.conversations.slice(-12).map(conv => ({
        title: conv.title,
        summary: cleanOverviewText(conv.summary, 1800),
        keyTopics: conv.keyTopics || [],
        updatedAt: conv.updatedAt,
      })),
    }, 36000);
  }

  if (selected.has("literature")) {
    const records = readUserLiteratureRecords(safeUserId);
    appendFlowchartMaterial(parts, materials, "literature", FLOWCHART_SOURCE_LABELS.literature, "literature-json", {
      total: records.length,
      records: records.slice(0, 100).map(record => ({
        title: cleanOverviewText(record.title, 260),
        author: cleanOverviewText(record.author || formatOverviewAuthors(record.authors), 220),
        year: cleanOverviewText(record.year, 40),
        journal: cleanOverviewText(record.journal, 160),
        keywords: Array.isArray(record.keywords) ? record.keywords.slice(0, 12) : cleanOverviewText(record.keywords, 300),
        abstract: cleanOverviewText(record.abstract, 1200),
      })),
    }, 42000);
  }

  if (selected.has("pdfWiki")) {
    const store = await pdfWikiManager.getStore(safeUserId);
    appendFlowchartMaterial(parts, materials, "pdfWiki", FLOWCHART_SOURCE_LABELS.pdfWiki, "pdf-wiki-store", {
      pdfs: store.pdfs.slice(0, 80).map(pdf => ({
        title: cleanOverviewText(pdf.title || pdf.originalName, 280),
        authors: cleanOverviewText(pdf.authors, 220),
        year: cleanOverviewText(pdf.year, 40),
        journal: cleanOverviewText(pdf.journal, 160),
        textLength: pdf.textLength || 0,
      })),
      claims: store.entries.slice(0, 120).map(entry => ({
        claim: cleanOverviewText(entry.displayClaimZh || entry.normalizedClaim || entry.claim, 500),
        sourcePdfNames: entry.sourcePdfNames || [],
        snippets: (entry.evidenceSnippets || []).slice(0, 3).map(item => cleanOverviewText(item, 420)),
      })),
      sentencePoints: (store.sentenceCloud?.points || []).slice(0, 120).map(point => ({
        sentence: cleanOverviewText(point.sentence || point.claimText, 500),
        sourcePdfTitle: cleanOverviewText(point.sourcePdfTitle || point.sourcePdfName, 240),
        section: cleanOverviewText(point.section, 80),
      })),
    }, 50000);
  }

  if (selected.has("meta")) {
    const metaDatabase = await pdfWikiManager.getMetaDatabase(safeUserId, { includeDetails: true });
    appendFlowchartMaterial(parts, materials, "meta", FLOWCHART_SOURCE_LABELS.meta, "meta-database", {
      generatedAt: metaDatabase.generatedAt,
      pdfCount: metaDatabase.pdfCount,
      referenceCount: metaDatabase.referenceCount,
      tables: metaDatabase.items.slice(0, 60).map(item => ({
        pdfTitle: cleanOverviewText(item.title || item.originalName, 260),
        rowCount: item.dataTable?.rowCount || 0,
        columns: (item.dataTable?.columns || []).slice(0, 80),
        sampleRows: (item.dataTable?.rows || []).slice(0, 8),
      })),
    }, 46000);
  }

  if (selected.has("bibliometrics")) {
    const bibliometrics = getOverviewBibliometricsStatus(safeUserId);
    appendFlowchartMaterial(parts, materials, "bibliometrics", FLOWCHART_SOURCE_LABELS.bibliometrics, "bibliometrics-status", bibliometrics, 22000);
  }

  if (selected.has("autoResearch")) {
    const state = await autoResearchManager.getState(safeUserId, resolveOverviewProjectContext());
    appendFlowchartMaterial(parts, materials, "autoResearch", FLOWCHART_SOURCE_LABELS.autoResearch, "autoresearch-state", {
      task: state.task,
      latestFinalReport: state.finalReports[0] || null,
      latestPaperDraft: state.paperDrafts[0]
        ? {
            title: state.paperDrafts[0].title,
            generatedAt: state.paperDrafts[0].generatedAt,
            markdownPreview: cleanOverviewText(state.paperDrafts[0].editedMarkdown || state.paperDrafts[0].markdown, 10000),
          }
        : null,
      completedTaskRecords: (state.completedTaskRecords || []).slice(0, 20),
      operations: state.operations.slice(0, 80),
      literatureMap: {
        nodes: state.literatureMap.nodes.slice(0, 80),
        tags: state.literatureMap.tags.slice(0, 80),
        snapshots: state.literatureMap.snapshots.slice(0, 12),
      },
    }, 56000);
  }

  if (selected.has("drafts")) {
    const draftStatus = await getOverviewDraftStatus(safeUserId);
    const draftPreviews = await Promise.all(draftStatus.chapters.slice(0, 16).map(async draft => {
      const data = await sessionStore.loadDraft(safeUserId, draft.chapterName);
      return {
        chapterName: draft.chapterName,
        savedAt: draft.savedAt,
        contentPreview: cleanOverviewText(data?.content, 3500),
      };
    }));
    appendFlowchartMaterial(parts, materials, "drafts", FLOWCHART_SOURCE_LABELS.drafts, "draft-store", {
      count: draftStatus.count,
      drafts: draftPreviews,
    }, 42000);
  }

  return {
    markdown: parts.join("\n\n---\n\n"),
    materials,
  };
}

async function extractFlowchartUploadedMaterial(userId: string, file: Express.Multer.File, index: number): Promise<{ markdown: string; material: FlowchartMaterialInfo }> {
  const safeUserId = sanitizeUserId(userId || "web-user");
  const originalName = sanitizeUploadFileName(file.originalname || `upload-${index + 1}.dat`);
  const ext = path.extname(originalName).toLowerCase();
  const uploadRoot = path.join(getDataDir(), "flowchart-maker", safeUserId, "uploads");
  await fs.promises.mkdir(uploadRoot, { recursive: true });
  const storedPath = path.join(uploadRoot, `${Date.now()}-${index + 1}-${originalName}`);
  await fs.promises.writeFile(storedPath, file.buffer);

  if (ext === ".pdf" || String(file.mimetype || "").toLowerCase().includes("pdf")) {
    const outputDir = path.join(getDataDir(), "flowchart-maker", safeUserId, "liteparse");
    const parsed = await extractPdfTextWithLiteParse(storedPath, {
      outputDir,
      label: originalName,
      timeoutMs: 300000,
    });
    const markdown = createFlowchartMarkdownSection(`上传 PDF：${originalName}`, parsed.markdown, 60000);
    return {
      markdown,
      material: {
        source: "upload",
        label: originalName,
        parser: `liteparse-md/pages-${parsed.pageCount || 0}`,
        length: markdown.length,
      },
    };
  }

  const text = file.buffer.toString("utf-8");
  const markdown = createFlowchartMarkdownSection(`上传文件：${originalName}`, text, 60000);
  return {
    markdown,
    material: {
      source: "upload",
      label: originalName,
      parser: "utf-8-text",
      length: markdown.length,
    },
  };
}

app.post("/api/flowchart-maker/materials", chatUpload.array("files", 16), async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const selectedSources = parseFlowchartSelectedSources(req.body?.selectedSources);
    const manualText = cleanOverviewText(req.body?.manualText, 60000);
    const skillInvocation = await parseUserSkillInvocation(userId, manualText);
    const invokedUserSkills = skillInvocation.invokedSkills || [];
    const sourceResult = await buildFlowchartInternalMaterials(userId, selectedSources);
    const parts: string[] = [];
    const materials: FlowchartMaterialInfo[] = [];
    if (sourceResult.markdown) {
      parts.push(sourceResult.markdown);
      materials.push(...sourceResult.materials);
    }
    if (skillInvocation.promptBlock) {
      const section = createFlowchartMarkdownSection("用户调用的流程图 Skill", skillInvocation.promptBlock, 26000);
      parts.push(section);
      materials.push({
        source: "userSkill",
        label: `用户 Skill：${invokedUserSkills.map(skill => `/${skill.trigger}`).join("、")}`,
        parser: "user-skill",
        length: section.length,
      });
      logger.info(`[UserSkills] Flowchart Maker invoked skills: ${invokedUserSkills.map(skill => `/${skill.trigger}`).join(", ")}`);
    }
    const manualTextForMaterial = invokedUserSkills.length > 0 && /^\/[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,32}$/u.test(manualText.trim())
      ? ""
      : cleanOverviewText(skillInvocation.cleanMessage || manualText, 60000);
    if (manualTextForMaterial) {
      const section = createFlowchartMarkdownSection("用户手动输入材料", manualTextForMaterial, 60000);
      parts.push(section);
      materials.push({
        source: "manual",
        label: "用户手动输入材料",
        parser: "manual-text",
        length: section.length,
      });
    }

    const files = (req.files || []) as Express.Multer.File[];
    for (let i = 0; i < files.length; i += 1) {
      try {
        const extracted = await extractFlowchartUploadedMaterial(userId, files[i], i);
        if (extracted.markdown) parts.push(extracted.markdown);
        materials.push(extracted.material);
      } catch (error) {
        const label = sanitizeUploadFileName(files[i]?.originalname || `upload-${i + 1}.dat`);
        materials.push({
          source: "upload",
          label,
          parser: path.extname(label).toLowerCase() === ".pdf" ? "liteparse-md" : "file",
          length: 0,
          error: (error as Error).message || String(error),
        });
      }
    }

    const markdown = parts.join("\n\n---\n\n").trim();
    res.json({
      success: true,
      data: {
        markdown,
        materials,
        selectedSources,
        invokedUserSkills,
        liteParseAvailable: isLiteParseAvailable(),
      },
    });
  } catch (error) {
    logger.error("[FlowchartMaker] Material aggregation route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "整理流程图材料失败" });
  }
});

app.post("/api/flowchart-maker/ai-generate", async (req: Request, res: Response) => {
  try {
    const markdown = compactFlowchartMaterialsForAi(cleanOverviewText(req.body?.markdown, 120000), 26000);
    const currentDsl = cleanOverviewText(req.body?.currentDsl, 5000);
    const userInstruction = cleanOverviewText(req.body?.instruction, 4000);
    const flowchartType = cleanOverviewText(req.body?.flowchartType, 80) || "research-route";
    const detailLevel = cleanOverviewText(req.body?.detailLevel, 80) || "detailed";
    if (!markdown.trim()) {
      res.status(400).json({ success: false, error: "请先整理材料，再使用 AI 生成流程图。" });
      return;
    }
    const typeInstructionMap: Record<string, string> = {
      "research-route": "生成科研技术路线图：突出研究问题、材料/数据来源、实验或分析方法、关键结果、论文输出之间的逻辑关系。",
      "paper-logic": "生成论文逻辑图：突出引言科学问题、方法证据、结果链条、讨论机制和结论之间的论证路径。",
      "experiment-design": "生成实验设计图：突出试验对象、处理设置、采样/测定指标、统计分析和结果输出。",
      "analysis-workflow": "生成数据分析流程图：突出数据导入、清洗、变量/分组、模型/统计、图表和结论输出。",
      "software-module": "生成软件模块流程图：突出输入、解析、检索/AI/分析引擎、存储、可视化和导出。"
    };
    const detailInstructionMap: Record<string, string> = {
      compact: "输出 5-7 个节点，保留必要分支。",
      standard: "输出 7-10 个节点，至少包含 1 个分支或判断节点。",
      detailed: "输出 8-12 个节点，至少包含 1-2 条并行路径和 1 个判断节点。"
    };

    const buildPrompt = (materialText: string, retryCompact = false) => [
      "你是学术研究流程图规划专家。请基于用户整理好的真实材料，规划一张可编辑流程图。",
      typeInstructionMap[flowchartType] || typeInstructionMap["research-route"],
      retryCompact ? "本次必须输出紧凑版本：5-8 个节点，不要展开解释。" : (detailInstructionMap[detailLevel] || detailInstructionMap.detailed),
      "任务要求：",
      "1. 必须从材料中的研究对象、方法、实验处理、数据来源、分析步骤、关键结果、图表说明或项目模块中抽取节点。",
      "2. 不要输出“整合输入材料、对齐用户研究背景、归纳关键模块与先后关系、输出可编辑流程图”等空泛节点。",
      "3. 节点必须是材料里有依据的具体内容，不要编造材料没有的结果、变量、处理、机制或结论。",
      "4. 优先体现因果、时间、分析或工作流先后关系；不要只生成一条直线，能分支就分支。",
      "5. 每个节点文字尽量短，中文 8-22 字或英文 4-10 words；长标题可以概括但不能改变含义。",
      "6. 只输出 Mermaid 语法，不要解释，不要 Markdown 围栏。",
      "7. 第一行必须是 graph TD 或 graph LR。",
      "8. 只使用本系统支持的 Mermaid 子集：graph TD/LR、A[过程节点]、A(起止节点)、D{判断节点}、A --> B、D -->|是| E。不要输出 subgraph、classDef、style、click。",
      "9. 推荐结构：研究目标/问题 -> 数据或材料来源（可并行） -> 方法/处理（可并行） -> 分析/模型 -> 判断节点 -> 结果/图表/论文输出。",
      "10. 如果材料中有多个数据来源、图表、分析方法或结果类型，必须拆成并行节点，不要合并成一个笼统节点。",
      "",
      userInstruction ? `用户额外要求：${userInstruction}` : "",
      currentDsl ? ["当前流程图草稿，可参考但不要被空泛节点限制：", currentDsl].join("\n") : "",
      "",
      "整理后的材料：",
      materialText,
    ].filter(Boolean).join("\n");

    const callFlowchartAi = (materialText: string, retryCompact = false) => chatBridge.chat({
      forceProvider: "secondary",
      temperature: 0.1,
      maxTokens: retryCompact ? 2200 : 4200,
      messages: [{ role: "user", content: buildPrompt(materialText, retryCompact) }],
    });

    let content = "";
    let usedRetry = false;
    try {
      content = await callFlowchartAi(markdown, false);
    } catch (error) {
      if (!isFlowchartAiLengthError(error)) throw error;
      usedRetry = true;
      logger.warn(`[FlowchartMaker] AI output/context was truncated, retrying with compact materials: ${(error as Error).message}`);
      content = await callFlowchartAi(compactFlowchartMaterialsForAi(markdown, 14000), true);
    }
    const dsl = sanitizeFlowchartDslFromAi(content);
    if (!/^graph\s+/i.test(dsl) || dsl.split(/\r?\n/).length < 3) {
      res.status(502).json({ success: false, error: "AI 返回的流程图语法为空或不可用，请减少材料长度后重试。" });
      return;
    }
    res.json({
      success: true,
      data: {
        dsl,
        raw: cleanOverviewText(content, 8000),
        usedRetry,
        sentMaterialLength: markdown.length,
      },
    });
  } catch (error) {
    logger.error("[FlowchartMaker] AI generation route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "AI 生成流程图失败" });
  }
});

// ============ 文献上传 API ============
app.post("/api/upload", handleLiteratureUpload, async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.body.userId || "web-user");
  const userDir = getUserUploadDir(userId);
  
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  
  const files = req.files as Express.Multer.File[];
  if (!files || files.length === 0) {
    res.json({ success: false, error: "请上传文献文件" });
    return;
  }
  
  logger.info(`[Upload] Processing ${files.length} files for user ${userId}`);
  
  // 重置 embedding 进度（避免残留上次上传的状态）
  embeddingProgress = {
    status: 'idle',
    total: 0,
    processed: 0,
    currentBatch: 0,
    totalBatches: 0,
    message: ''
  };
  
  // Embedding 配置 - 合并前端传来的和服务器保存的
  let embeddingUrl = req.body.embeddingUrl || "";
  let embeddingKey = req.body.embeddingKey || "";
  let embeddingModel = req.body.embeddingModel || "";
  let embeddingDimensions = parseInt(req.body.embeddingDimensions) || 0;
  
  // embeddingEnabled 的判断：
  // - 如果前端传了 "true"，则为 true
  // - 如果前端传了 "false"，则为 false
  // - 如果前端没传（undefined），使用服务器配置
  let embeddingEnabled: boolean;
  if (req.body.embeddingEnabled === "true") {
    embeddingEnabled = true;
  } else if (req.body.embeddingEnabled === "false") {
    embeddingEnabled = false;
  } else {
    // 前端没传，使用服务器配置
    embeddingEnabled = currentEmbeddingConfig.enabled;
  }
  
  // 用服务器配置补充缺失的部分
  if (currentEmbeddingConfig.enabled) {
    if (!embeddingUrl) embeddingUrl = currentEmbeddingConfig.url;
    if (!embeddingKey) embeddingKey = currentEmbeddingConfig.key;
    if (!embeddingModel) embeddingModel = currentEmbeddingConfig.model;
    if (!embeddingDimensions) embeddingDimensions = currentEmbeddingConfig.dimensions || 1024;
  }
  
  // 默认模型和维度
  if (!embeddingModel) embeddingModel = "text-embedding-v4";
  if (!embeddingDimensions) embeddingDimensions = 1024;
  
  logger.info(`[Upload] Embedding config: enabled=${embeddingEnabled}, url=${embeddingUrl ? '已配置' : '空'}, key=${embeddingKey ? '已配置' : '空'}, model=${embeddingModel}, dimensions=${embeddingDimensions}`);

  const requestPdfWikiApiUrl = typeof req.body.pdfWikiApiUrl === 'string' ? req.body.pdfWikiApiUrl.trim() : '';
  const requestPdfWikiApiKey = typeof req.body.pdfWikiApiKey === 'string' ? req.body.pdfWikiApiKey.trim() : '';
  const requestTextInApiUrl = typeof req.body.pdfWikiTextInApiUrl === 'string' ? req.body.pdfWikiTextInApiUrl.trim() : '';
  const requestTextInAppId = typeof req.body.pdfWikiTextInAppId === 'string' ? req.body.pdfWikiTextInAppId.trim() : '';
  const requestTextInSecretCode = typeof req.body.pdfWikiTextInSecretCode === 'string' ? req.body.pdfWikiTextInSecretCode.trim() : '';
  const requestTextInParseMode = typeof req.body.pdfWikiTextInParseMode === 'string' ? req.body.pdfWikiTextInParseMode.trim() : '';
  const requestPdfWikiTaskConfig = parsePdfWikiTaskConfigFromBody(req.body as Record<string, unknown>);
  const pdfUploadMode = typeof req.body.pdfUploadMode === 'string' ? req.body.pdfUploadMode.trim() : '';
  const isPdfManagerLiteUpload = pdfUploadMode === 'manager-lite';
  if (
    requestPdfWikiApiUrl || requestPdfWikiApiKey
    || requestTextInApiUrl || requestTextInAppId || requestTextInSecretCode || requestTextInParseMode
  ) {
    currentPdfWikiLlmConfig = {
      apiUrl: requestPdfWikiApiUrl || currentPdfWikiLlmConfig.apiUrl || '',
      apiKey: requestPdfWikiApiKey || currentPdfWikiLlmConfig.apiKey || '',
      model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
      jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
      ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
      visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
      textInApiUrl: requestTextInApiUrl || currentPdfWikiLlmConfig.textInApiUrl || 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
      textInAppId: requestTextInAppId || currentPdfWikiLlmConfig.textInAppId || '',
      textInSecretCode: requestTextInSecretCode || currentPdfWikiLlmConfig.textInSecretCode || '',
      textInParseMode: requestTextInParseMode || currentPdfWikiLlmConfig.textInParseMode || 'auto',
    };
    persistPdfWikiLlmConfig();
    logger.info(`[PdfWikiConfig] Synced request PDF Wiki config: model=${currentPdfWikiLlmConfig.model}; textIn=${currentPdfWikiLlmConfig.textInAppId ? 'configured' : 'empty'}`);
  }
  
  try {
    const allPapers: any[] = [];
    const processedFiles: string[] = [];
    const pdfFilesForWiki: Express.Multer.File[] = [];
    const bibliometricPlainTextFiles: Array<{ fileName: string; content: string }> = [];
    let bibliometricsImportResult: ReturnType<typeof importBibliometricPlainTextForUser> | null = null;
    let bibliometricsImportError = '';
    let pdfManagerLiteResult: Awaited<ReturnType<typeof pdfWikiManager.registerUploadedPdfsWithLiteParse>> | null = null;
    
    for (const file of files) {
      try {
        const ext = path.extname(file.originalname).toLowerCase();
        const isPdfUpload = ext === '.pdf' || String(file.mimetype || '').toLowerCase().includes('pdf');
        let content = "";
        let papersFromFile: any[] = [];

        // PDF 必须优先处理，避免二进制内容误触发 RIS/WoS 等文本格式检测。
        if (isPdfUpload) {
          pdfFilesForWiki.push(file);
          papersFromFile.push({
            title: file.originalname,
            authors: [],
            year: '',
            journal: '',
            abstract: '[PDF文件需要进一步解析]',
            keywords: [],
            source: file.originalname,
            isPdf: true,
            filePath: file.path || path.join(userDir, Date.now() + '-' + sanitizeUploadFileName(file.originalname))
          });

          if (!file.path && file.buffer) {
            const pdfPath = path.join(userDir, Date.now() + '-' + sanitizeUploadFileName(file.originalname));
            fs.writeFileSync(pdfPath, file.buffer);
            papersFromFile[0].filePath = pdfPath;
          }

          allPapers.push(...papersFromFile);
          processedFiles.push(file.originalname);
          logger.info(`[Upload] File ${file.originalname}: ${papersFromFile.length} PDF queued for PDF Wiki`);
          continue;
        }
        
        // 读取文件内容
        if (file.buffer) {
          content = file.buffer.toString('utf-8');
          logger.info(`[Upload] File ${file.originalname} read from buffer (${content.length} chars)`);
        } else if (file.path) {
          content = fs.readFileSync(file.path, 'utf-8');
          logger.info(`[Upload] File ${file.originalname} read from path (${content.length} chars)`);
        } else {
          logger.warn(`[Upload] File ${file.originalname} has no buffer or path, cannot read content`);
        }
        
        // 移除 BOM 字符
        if (content.charCodeAt(0) === 0xFEFF) {
          content = content.slice(1);
          logger.info(`[Upload] Removed BOM from ${file.originalname}`);
        }
        
        // 检查内容是否为空
        if (!content || content.trim().length === 0) {
          logger.warn(`[Upload] File ${file.originalname} has empty content, skipping`);
          continue;
        }
        
        // 根据文件类型解析
        
        // 使用统一的 ParserFactory 解析（解决 C3: 重复的解析逻辑）
        // 支持 WoS, CNKI, RIS, BIB 格式
        // 注意：知网 RIS 格式使用 RT Journal Article 开头，不是标准的 TY - JOUR
        const isRISContent = content.match(/^TY\s*-/m);
        const isCNKIRISContent = content.match(/^RT\s+(Journal|Book|Conference|Thesis)/im);
        const isCNKICustomContent = content.includes('【题');
        const isBibTeXContent = content.match(/^@\w+\{/m);
        const isBibliometricPlainTextContent = isWosBibliometricPlainText(content);
        const isWoSContent = isBibliometricPlainTextContent || content.includes('Web of Science') || content.match(/^TI\s/m);
        const hasValidExt = ['.txt', '.ris', '.bib', '.csv'].includes(ext);
        
        if (isBibliometricPlainTextContent) {
          bibliometricPlainTextFiles.push({
            fileName: file.originalname || 'savedrecs.txt',
            content,
          });
        }
        
        logger.info(`[Upload] Format detection for ${file.originalname}: ext=${ext}, RIS=${!!isRISContent}, CNKI-RIS=${!!isCNKIRISContent}, CNKI-custom=${!!isCNKICustomContent}, BibTeX=${!!isBibTeXContent}, WoS=${!!isWoSContent}, WoS-bibliometrics-plain-text=${!!isBibliometricPlainTextContent}, content-preview=${content.substring(0, 50).replace(/\n/g, '\\n')}`);
        
        // 记录是否进入解析分支
        const shouldParse = hasValidExt || isWoSContent || isBibTeXContent || isRISContent || isCNKIRISContent || isCNKICustomContent;
        logger.info(`[Upload] Should parse ${file.originalname}: ${shouldParse} (hasValidExt=${hasValidExt})`);
        
        if (shouldParse) {
          try {
            // 使用 ParserFactory 自动检测格式并解析
            logger.info(`[Upload] Calling ParserFactory.parseContent for ${file.originalname}...`);
            const parsed = ParserFactory.parseContent(content, file.originalname);
            logger.info(`[Upload] ParserFactory returned ${parsed.length} papers for ${file.originalname}`);
            
            if (parsed.length === 0) {
              logger.warn(`[Upload] ParserFactory returned 0 papers for ${file.originalname}, content may be malformed`);
            }
            
            papersFromFile = parsed.map(lit => ({
              id: lit.id,
              title: lit.title,
              authors: lit.authors?.map(a => a.name) || [],
              author: lit.author,
              year: String(lit.year),
              journal: lit.journal,
              abstract: lit.abstract,
              keywords: lit.keywords,
              doi: lit.doi,
              source: file.originalname,
            }));
            logger.info(`[Upload] Parsed ${file.originalname} using ParserFactory (${papersFromFile.length} papers)`);
          } catch (parseError) {
            // 如果自动检测失败，尝试简单文本解析
            logger.warn(`[Upload] ParserFactory failed for ${file.originalname}, trying simple parse:`, parseError);
            
            // 简单文本文件（每行一篇文献的标题）
            const lines = content.split('\n').filter(l => l.trim());
            for (const line of lines) {
              const parts = line.split(/[,;\t]/).map(p => p.trim()).filter(p => p);
              if (parts.length > 0) {
                papersFromFile.push({
                  title: parts[0],
                  authors: parts.slice(1, 4),
                  year: parts.find(p => /^\d{4}$/.test(p)) || '',
                  journal: parts[parts.length - 1] || '',
                  abstract: '',
                  keywords: [],
                  source: file.originalname
                });
              }
            }
          }
        }
        
        allPapers.push(...papersFromFile);
        processedFiles.push(file.originalname);
        logger.info(`[Upload] File ${file.originalname}: ${papersFromFile.length} papers extracted`);
        
      } catch (fileError) {
        logger.warn(`[Upload] Failed to process ${file.originalname}:`, fileError);
        processedFiles.push(file.originalname + " (解析失败)");
      }
    }

    if (bibliometricPlainTextFiles.length > 0) {
      try {
        bibliometricsImportResult = importBibliometricPlainTextForUser({
          userId,
          sourceFiles: bibliometricPlainTextFiles,
          mode: 'append',
        });
        logger.info(`[Upload] Imported ${bibliometricPlainTextFiles.length} WoS Plain Text file(s) into bibliometrics database for ${userId}; records=${bibliometricsImportResult.dataset.recordCount || 0}`);
      } catch (error) {
        bibliometricsImportError = (error as Error).message || String(error);
        logger.warn(`[Upload] Failed to import WoS Plain Text into bibliometrics database for ${userId}:`, error);
      }
    }
    
    // 保存文献数据
    const literatureFile = path.join(userDir, "literature.json");
    const literatureTxtFile = path.join(userDir, "literature.txt");
    
    // 合并已有文献
    let existingPapers: any[] = [];
    if (fs.existsSync(literatureFile)) {
      try {
        const existingData = JSON.parse(fs.readFileSync(literatureFile, 'utf-8'));
        existingPapers = Array.isArray(existingData) ? existingData : (existingData.papers || []);
      } catch (e) {
        logger.warn("[Upload] Failed to read existing literature:", e);
      }
    }
    
    // 合并新文献（去重）- 记录真正新增的文献
    const mergedPapers = [...existingPapers];
    const existingTitles = new Set(existingPapers.map(p => p.title?.toLowerCase()));
    const newPapersToAdd: any[] = [];  // 记录真正新增的文献
    
    for (const paper of allPapers) {
      if (!existingTitles.has(paper.title?.toLowerCase())) {
        mergedPapers.push(paper);
        newPapersToAdd.push(paper);  // 只有真正新增的才加入这个列表
      }
    }
    
    // 统计新增文献数量
    const newPaperCount = newPapersToAdd.length;
    const newEmbeddablePapers = newPapersToAdd.filter((paper: any) => {
      const title = String(paper.title || '').trim();
      const abstract = String(paper.abstract || '').trim();
      return !paper.isPdf && title && abstract !== '[PDF文件需要进一步解析]';
    });
    const duplicateCount = allPapers.length - newPaperCount;
    logger.info(`[Upload] Dedup result: ${newPaperCount} new papers (${newEmbeddablePapers.length} embeddable), ${duplicateCount} duplicates skipped, ${mergedPapers.length} total`);
    
    fs.writeFileSync(literatureFile, JSON.stringify({ papers: mergedPapers }, null, 2), 'utf-8');
    
    // 生成文本摘要
    let txtContent = "";
    for (const paper of mergedPapers) {
      if (!paper.isPdf) {
        txtContent += `【${paper.title}】\n`;
        const authors = paper.authors || paper.author || '';
        if (Array.isArray(authors) && authors.length > 0) {
          txtContent += `作者: ${authors.join(', ')}\n`;
        } else if (typeof authors === 'string' && authors) {
          txtContent += `作者: ${authors}\n`;
        }
        if (paper.year) txtContent += `年份: ${paper.year}\n`;
        if (paper.journal) txtContent += `期刊: ${paper.journal}\n`;
        if (paper.abstract) txtContent += `摘要: ${paper.abstract}\n`;
        const kws = paper.keywords;
        if (Array.isArray(kws) && kws.length > 0) {
          txtContent += `关键词: ${kws.join(', ')}\n`;
        } else if (typeof kws === 'string' && kws) {
          txtContent += `关键词: ${kws}\n`;
        }
        txtContent += "\n---\n\n";
      }
    }
    fs.writeFileSync(literatureTxtFile, txtContent, 'utf-8');
    
    logger.info(`[Upload] Saved ${mergedPapers.length} papers for user ${userId}`);
    
    // 统计信息
    const years = [...new Set(mergedPapers.map(p => p.year).filter(y => y))].sort() as string[];
    const journals = [...new Set(mergedPapers.map(p => p.journal).filter(j => j))].slice(0, 20) as string[];
    const keywords = [...new Set(mergedPapers.flatMap(p => {
      const kws = p.keywords;
      if (Array.isArray(kws)) return kws;
      if (typeof kws === 'string' && kws) return kws.split(/[,;]/).map((k: string) => k.trim()).filter((k: string) => k);
      return [];
    }).filter(k => k))].slice(0, 30) as string[];
    
    // 如果配置了 embedding，启动后台生成任务
    logger.info(`[Upload] Embedding check: enabled=${embeddingEnabled}, url=${embeddingUrl ? '已配置' : '空'}, key=${embeddingKey ? '已配置' : '空'}`);
    
    if (embeddingEnabled && embeddingUrl && embeddingKey) {
      // 只有新增的非 PDF 摘要文献才需要生成 embedding；PDF 只进入 LLM Wiki 流程
      if (newEmbeddablePapers.length > 0) {
        logger.info("[Upload] Starting embedding generation in background...");
        logger.info(`[Upload] Papers to embed: ${newEmbeddablePapers.length} NEW non-PDF papers (skipped ${duplicateCount} duplicates), ${mergedPapers.length} total papers`);
        
        // 使用真正新增的非 PDF 文献，而不是全部上传的文献
        generateEmbeddingsInBackground(userId, newEmbeddablePapers, embeddingUrl, embeddingKey, embeddingModel, embeddingDimensions).catch(e => {
          logger.error("[Upload] Embedding generation failed:", e);
          embeddingProgress.status = 'error';
          embeddingProgress.endTime = Date.now();
          embeddingProgress.message = '向量嵌入生成失败：' + (e?.message || '未知错误');
        });
      } else {
        // 没有新增的非 PDF 摘要文献需要处理
        logger.info(`[Upload] No NEW non-PDF papers to embed (uploaded=${allPapers.length}, pdfs=${pdfFilesForWiki.length}, duplicates=${duplicateCount})`);
        const noEmbeddingMessage = pdfFilesForWiki.length > 0 && newPapersToAdd.length > 0
          ? (isPdfManagerLiteUpload ? 'PDF 文件已进入 PDF 管理 LiteParse 识别，不进入摘要向量嵌入' : 'PDF 文件不进入摘要向量嵌入，已转入 PDF Wiki 生成流程')
          : '所有上传的文献均已存在，无需重新生成向量嵌入';
        embeddingProgress = {
          status: 'completed',
          total: 0,
          processed: 0,
          currentBatch: 0,
          totalBatches: 0,
          message: noEmbeddingMessage,
          startTime: Date.now(),
          endTime: Date.now()
        };
      }
    } else {
      // 如果没有配置 embedding，立即索引新文献并保存缓存
      logger.info("[Upload] No embedding configured, indexing NEW papers only...");
      
      // 只有新增的非 PDF 摘要文献才需要进入摘要检索索引；PDF 只进入 LLM Wiki 流程
      if (newEmbeddablePapers.length > 0) {
        try {
          // 获取用户的检索引擎（解决 C5: 多用户数据隔离）
          const userEngine = await retrievalEngineManager.getEngine(userId);
          
          // 使用统一的规范化函数（解决 C1, C2, D1 问题）
          // 使用真正新增的非 PDF 文献，而不是全部上传的文献
          const newLiteratures = newEmbeddablePapers.map((paper: any, index: number) => {
            const inferredSource = inferSourceType(paper.source || '', paper.abstract);
            // 'unknown' 类型默认为 'wos'（兼容旧数据）
            const sourceType = inferredSource === 'unknown' ? 'wos' : inferredSource;
            return normalizeLiterature(paper, index, sourceType as 'wos' | 'cnki' | 'ris' | 'bib');
          });
          
          // 使用增量索引，只添加新文献
          await userEngine.addDocuments(newLiteratures);
          logger.info(`[Upload] Indexed ${newLiteratures.length} NEW papers for user ${userId} (skipped ${duplicateCount} duplicates, total: ${userEngine.getDocumentCount()})`);
          
          // 更新全局引用（向后兼容 web-user）
          if (userId === 'web-user') {
            globalRetrievalEngine = userEngine;
            if (globalConversationFlow) {
              globalConversationFlow.setRetrievalEngine(userEngine);
            }
          }
          
          // 异步保存索引，不阻塞响应
          const cacheDir = path.join(userDir, "index-cache");
          setImmediate(() => {
            try {
              userEngine.saveIndex(cacheDir);
              logger.info(`[Upload] Saved index cache to ${cacheDir}`);
            } catch (e) {
              logger.error('[Upload] Failed to save index cache:', e);
            }
          });
          
        } catch (indexError) {
          logger.error('[Upload] Failed to index papers:', indexError);
        }
      } else {
        logger.info(`[Upload] No NEW non-PDF papers to index (uploaded=${allPapers.length}, pdfs=${pdfFilesForWiki.length}, duplicates=${duplicateCount})`);
      }
    }

    if (pdfFilesForWiki.length > 0) {
      if (isPdfManagerLiteUpload) {
        pdfManagerLiteResult = await pdfWikiManager.registerUploadedPdfsWithLiteParse(userId, pdfFilesForWiki);
        logger.info(`[PdfWiki] LiteParse registered ${pdfFilesForWiki.length} PDF(s) for PDF manager; parsed=${pdfManagerLiteResult.parsedCount}, failed=${pdfManagerLiteResult.failedCount}, figures=${pdfManagerLiteResult.figureCount}`);
      } else {
        const pdfWikiLlm = getPdfWikiLlmRuntimeConfig();
        pdfWikiManager.processUploadedPdfs(
          userId,
          pdfFilesForWiki,
          buildPdfWikiRuntimeTaskConfig(pdfWikiLlm, requestPdfWikiTaskConfig)
        ).catch(error => {
          logger.error('[PdfWiki] Background build failed:', error);
        });
        logger.info(`[PdfWiki] Queued ${pdfFilesForWiki.length} PDF(s) for user ${userId}; apiConfigured=${pdfWikiLlm.configured}; source=${pdfWikiLlm.label}`);
      }
    }
    
    res.json({
      success: true,
      files: processedFiles,
      embeddingStarted: embeddingEnabled && !!embeddingUrl && !!embeddingKey && newEmbeddablePapers.length > 0,
      pdfUploadMode: isPdfManagerLiteUpload ? 'manager-lite' : 'full',
      pdfManagerLiteProcessed: isPdfManagerLiteUpload && pdfFilesForWiki.length > 0,
      pdfManagerLite: pdfManagerLiteResult,
      bibliometricsImported: !!bibliometricsImportResult,
      bibliometricsImportError: bibliometricsImportError || undefined,
      bibliometrics: bibliometricsImportResult ? {
        uploadedFiles: bibliometricsImportResult.uploadedFiles,
        mergedFromExisting: bibliometricsImportResult.mergedFromExisting,
        dataset: bibliometricsImportResult.dataset,
        quality: {
          recordCount: bibliometricsImportResult.quality.recordCount,
          citedReferenceCount: bibliometricsImportResult.quality.citedReferenceCount,
          uniqueReferenceCount: bibliometricsImportResult.quality.uniqueReferenceCount,
        },
      } : null,
      pdfWikiStarted: !isPdfManagerLiteUpload && pdfFilesForWiki.length > 0 && getPdfWikiLlmRuntimeConfig().configured,
      pdfWikiQueued: !isPdfManagerLiteUpload && pdfFilesForWiki.length > 0,
      pdfWikiLlm: (() => {
        if (isPdfManagerLiteUpload) return null;
        const runtime = getPdfWikiLlmRuntimeConfig();
        return {
          configured: runtime.configured,
          dedicated: runtime.dedicated,
          model: runtime.model,
          label: runtime.label,
          textInConfigured: runtime.textInConfigured,
          liteParseAvailable: runtime.liteParseAvailable,
          markerAvailable: runtime.markerAvailable,
          codexAvailable: runtime.codexAvailable,
          codexModel: runtime.codexModel,
          codexReasoningEffort: runtime.codexReasoningEffort,
          taskConfig: requestPdfWikiTaskConfig,
        };
      })(),
      summary: {
        count: mergedPapers.length,
        newCount: newPapersToAdd.length,        // 真正新增的文献数量
        newEmbeddableCount: newEmbeddablePapers.length, // 真正进入摘要 embedding/索引的文献数量
        duplicateCount: duplicateCount,         // 被去重跳过的文献数量
        uploadedCount: allPapers.length,        // 本次上传的文献总数
        pdfCount: pdfFilesForWiki.length,
        years,
        journals,
        keywords
      }
    });
    
  } catch (error) {
    logger.error("[Upload] Error:", error);
    res.json({ success: false, error: (error as Error).message });
  }
});

/**
 * @deprecated 已废弃，请使用 ParserFactory.parseContent() 代替
 * 该函数将在未来版本中移除
 */
// 辅助函数：将 RIS 解析为结构化数据
function parseRisToStructured(content: string): any[] {
  const papers: any[] = [];
  const records = content.split(/^ER\s*$/m);
  
  for (const record of records) {
    if (!record.trim()) continue;
    
    const lines = record.split('\n');
    let title = '', year = '', journal = '', abstract = '';
    const authors: string[] = [];
    const keywords: string[] = [];
    
    for (const line of lines) {
      const match = line.match(/^([A-Z0-9]{2})\s*-\s*(.*)$/);
      if (!match) continue;
      
      const [_, tag, value] = match;
      
      if (tag === 'TI' || tag === 'T1') title = value.trim();
      else if (tag === 'AU' || tag === 'A1') authors.push(value.trim());
      else if (tag === 'SO' || tag === 'JF') journal = value.trim();
      else if (tag === 'PY' || tag === 'Y1') {
        const yMatch = value.match(/(\d{4})/);
        if (yMatch) year = yMatch[1];
      }
      else if (tag === 'AB' || tag === 'N2') abstract = value.trim();
      else if (tag === 'KW') keywords.push(value.trim());
    }
    
    if (title) {
      papers.push({ title, authors, year, journal, abstract, keywords });
    }
  }
  
  return papers;
}

/**
 * @deprecated 已废弃，请使用 ParserFactory.parseContent() 代替
 * 该函数将在未来版本中移除
 */
// 辅助函数：将 BIB 解析为结构化数据
function parseBibToStructured(content: string): any[] {
  const papers: any[] = [];
  const entries = content.split(/^@/m).filter(e => e.trim());
  
  for (const entry of entries) {
    const typeMatch = entry.match(/^(\w+)\s*\{/);
    if (!typeMatch) continue;
    
    const lines = entry.split('\n');
    let title = '', year = '', journal = '';
    const authors: string[] = [];
    
    for (const line of lines) {
      const titleMatch = line.match(/title\s*=\s*[{\"](.+?)[}\"]/i);
      if (titleMatch) title = titleMatch[1].trim();
      
      const authorMatch = line.match(/author\s*=\s*[{\"](.+?)[}\"]/i);
      if (authorMatch) {
        const authorStr = authorMatch[1];
        authors.push(...authorStr.split(/[,; and]/).map(a => a.trim()).filter(a => a));
      }
      
      const yearMatch = line.match(/year\s*=\s*[{\"](\d{4})[}\"]/i);
      if (yearMatch) year = yearMatch[1];
      
      const journalMatch = line.match(/journal\s*=\s*[{\"](.+?)[}\"]/i);
      if (journalMatch) journal = journalMatch[1].trim();
    }
    
    if (title) {
      papers.push({ title, authors, year, journal, abstract: '', keywords: [] });
    }
  }
  
  return papers;
}

/**
 * 使用 http/https 模块调用 embedding API，确保超时可靠（不受 undici 影响）
 */
function callEmbeddingApi(
  apiUrl: string,
  apiKey: string,
  model: string,
  texts: string[],
  dimensions: number = 1024,
  timeoutMs: number = 30_000
): Promise<Array<{ embedding?: number[] }> | null> {
  return new Promise((resolve) => {
    const parsedUrl = new URL(apiUrl + "/embeddings");
    const isHttps = parsedUrl.protocol === 'https:';
    const lib = isHttps ? https : http;
    
    // 构建请求体，包含 dimensions 参数
    const requestBody: Record<string, unknown> = { model, input: texts };
    if (dimensions > 0) {
      requestBody.dimensions = dimensions;
    }
    const bodyStr = JSON.stringify(requestBody);
    
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + (parsedUrl.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    
    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: string | Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            const parsed = JSON.parse(data);
            resolve(parsed.data || null);
          } catch {
            logger.warn('[Embedding] Failed to parse API response');
            resolve(null);
          }
        } else {
          logger.warn(`[Embedding] API returned status ${res.statusCode}: ${data.slice(0, 200)}`);
          resolve(null);
        }
      });
    });
    
    req.on('error', (err: Error) => {
      logger.warn('[Embedding] Request error:', err.message);
      resolve(null);
    });
    
    req.on('timeout', () => {
      logger.warn(`[Embedding] Request timed out after ${timeoutMs}ms`);
      req.destroy();
      resolve(null);
    });
    
    req.setTimeout(timeoutMs);
    req.write(bodyStr);
    req.end();
  });
}

async function generateEmbeddingsInBackground(
  userId: string, 
  papers: any[], 
  embeddingUrl: string, 
  embeddingKey: string, 
  embeddingModel: string,
  embeddingDimensions: number = 1024
): Promise<void> {
  try {
    logger.info(`[Embedding] Starting background generation for ${papers.length} papers`);
    
    // 为每篇论文生成唯一 ID（解决 D2: Embedding 匹配使用 Title）
    // 同时推断来源类型（解决 C2: source 字段硬编码）
    const papersWithIds = papers
      .filter(p => !p.isPdf && p.title)
      .map((p, index) => {
        // 如果已有 ID，使用已有的；否则生成新 ID
        if (!p.id) {
          const sourceType = inferSourceType(p.source || '', p.abstract);
          const authors = unifiedParseAuthors(p.author || p.authors);
          p.id = generateLiteratureId(p.title, p.year, authors, p.doi);
        }
        return p;
      });
    
    const papersToEmbed = papersWithIds;
    logger.info(`[Embedding] Papers to embed after filtering: ${papersToEmbed.length} (filtered out ${papers.length - papersToEmbed.length} PDFs or empty titles)`);
    
    if (papersToEmbed.length === 0) {
      logger.warn('[Embedding] No papers to embed, skipping');
      embeddingProgress = {
        status: 'completed',
        total: 0,
        processed: 0,
        currentBatch: 0,
        totalBatches: 0,
        message: '没有需要生成嵌入的文献',
        startTime: Date.now(),
        endTime: Date.now()
      };
      return;
    }
    
    // 重置进度
    const batchSize = 5;
    embeddingProgress = {
      status: 'processing',
      total: papersToEmbed.length,
      processed: 0,
      currentBatch: 0,
      totalBatches: Math.ceil(papersToEmbed.length / batchSize),
      message: '开始生成向量嵌入...',
      startTime: Date.now()
    };
    
    logger.info(`[Embedding] Progress initialized: total=${papersToEmbed.length}, batches=${embeddingProgress.totalBatches}`);
    
    const embeddings: any[] = [];
    let failedBatches = 0;
    
    for (let i = 0; i < papersToEmbed.length; i += batchSize) {
      const batch = papersToEmbed.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      embeddingProgress.currentBatch = batchNum;
      
      logger.info(`[Embedding] Processing batch ${batchNum}/${embeddingProgress.totalBatches} (${batch.length} papers)`);
      
      try {
        const texts = batch.map(p => {
          const kws = p.keywords;
          const kwsStr = Array.isArray(kws) ? kws.join(' ') : (typeof kws === 'string' ? kws : '');
          return `${p.title}\n${p.abstract || ''}\n${kwsStr}`;
        });
        
        logger.info(`[Embedding] Calling API: ${embeddingUrl}/embeddings with model ${embeddingModel} (${texts.length} texts)`);
        
        // 使用 http/https 模块发送请求，确保超时可靠
        const data = await callEmbeddingApi(embeddingUrl, embeddingKey, embeddingModel, texts, embeddingDimensions);
        
        if (data) {
          for (let j = 0; j < batch.length && j < data.length; j++) {
            if (data[j]?.embedding) {
              embeddings.push({
                paperId: batch[j].id || batch[j].title, // 优先使用 ID（解决 D2）
                embedding: data[j].embedding
              });
            }
          }
          logger.info(`[Embedding] Batch ${batchNum} success, got ${data.length} embeddings`);
        } else {
          failedBatches++;
          logger.warn(`[Embedding] Batch ${batchNum} returned no data`);
        }
        
        embeddingProgress.processed = Math.min(i + batchSize, papersToEmbed.length);
        embeddingProgress.message = `已处理 ${embeddingProgress.processed}/${embeddingProgress.total} 篇文献`;
        
        // 批次间暂停 500ms，避免限流
        if (i + batchSize < papersToEmbed.length) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
      } catch (e: any) {
        failedBatches++;
        const errMsg = e?.message || '未知错误';
        logger.warn("[Embedding] Batch error:", errMsg);
        embeddingProgress.processed = Math.min(i + batchSize, papersToEmbed.length);
        embeddingProgress.message = `已处理 ${embeddingProgress.processed}/${embeddingProgress.total} 篇文献 (部分失败: ${errMsg})`;
      }
    }
    
    // 先更新进度为"完成"，让前端能看到结果
    const totalEmbeddings = embeddings.length;
    const totalFailed = failedBatches;
    
    if (totalEmbeddings === 0 && papersToEmbed.length > 0) {
      embeddingProgress.status = 'error';
      embeddingProgress.endTime = Date.now();
      embeddingProgress.message = `向量嵌入生成失败：所有 ${papersToEmbed.length} 篇文献均未成功生成嵌入。请检查 Embedding API 配置是否正确。`;
      logger.error(`[Embedding] All ${papersToEmbed.length} papers failed to embed`);
      return;
    } else if (totalFailed > 0) {
      embeddingProgress.status = 'completed';
      embeddingProgress.endTime = Date.now();
      embeddingProgress.message = `向量嵌入生成完成（部分失败）：成功 ${totalEmbeddings}/${papersToEmbed.length} 篇`;
      logger.warn(`[Embedding] Completed with ${totalFailed} failed batches, ${totalEmbeddings}/${papersToEmbed.length} succeeded`);
    } else {
      embeddingProgress.status = 'completed';
      embeddingProgress.endTime = Date.now();
      embeddingProgress.message = `向量嵌入生成完成：成功 ${totalEmbeddings}/${papersToEmbed.length} 篇`;
    }
    
    // 保存和索引操作完全异步，不阻塞事件循环
    (async () => {
      try {
        if (totalEmbeddings > 0) {
          const userDir = getUserUploadDir(userId);
          const embeddingFile = path.join(userDir, "embeddings.json");
          
          // 异步写 embeddings 文件
          await fs.promises.writeFile(embeddingFile, JSON.stringify(embeddings, null, 2), 'utf-8');
          logger.info(`[Embedding] Saved ${totalEmbeddings} embeddings for user ${userId}`);
          
          // 让事件循环喘口气
          await new Promise(r => setTimeout(r, 50));
          
          const literatureFile = path.join(userDir, "literature.json");
          if (fs.existsSync(literatureFile)) {
            try {
              // 异步读取 literature.json
              const litContent = await fs.promises.readFile(literatureFile, 'utf-8');
              const litData = JSON.parse(litContent);
              const litPapers = Array.isArray(litData) ? litData : (litData.papers || []);
              
              // 创建 embedding 映射（使用 ID 匹配，解决 D2）
              const embeddingMap = new Map<string, number[]>();
              for (const emb of embeddings) {
                embeddingMap.set(emb.paperId, emb.embedding);
              }
              
              // 合并 embedding 到文献数据
              let mergedCount = 0;
              for (const paper of litPapers) {
                // 优先用 ID 匹配，其次用 title 匹配（向后兼容）
                const paperId = paper.id || generateLiteratureId(
                  paper.title,
                  paper.year,
                  unifiedParseAuthors(paper.author || paper.authors),
                  paper.doi
                );
                
                // 确保论文有 ID
                if (!paper.id) {
                  paper.id = paperId;
                }
                
                if (embeddingMap.has(paperId)) {
                  paper.embedding = embeddingMap.get(paperId);
                  mergedCount++;
                } else if (paper.title && embeddingMap.has(paper.title)) {
                  // 向后兼容：使用 title 匹配
                  paper.embedding = embeddingMap.get(paper.title);
                  mergedCount++;
                }
              }
              
              // 让事件循环喘口气再写大文件
              await new Promise(r => setTimeout(r, 50));
              
              // 异步写 literature.json
              await fs.promises.writeFile(literatureFile, JSON.stringify({ papers: litPapers }, null, 2), 'utf-8');
              logger.info(`[Embedding] Merged ${mergedCount} embeddings into literature.json`);
              
              // 获取用户的检索引擎（解决 C5: 多用户数据隔离）
              const userEngine = await retrievalEngineManager.getEngine(userId);
              
              // 索引到用户检索引擎
              const papersWithNewEmbedding = litPapers.filter((p: any) => p.embedding && p.embedding.length > 0);
              if (papersWithNewEmbedding.length > 0) {
                // 使用统一的规范化函数（解决 C1, C2, D1）
                const literaturesToIndex: UnifiedLiterature[] = [];
                const indexBatchSize = 100;
                
                for (let bi = 0; bi < papersWithNewEmbedding.length; bi += indexBatchSize) {
                  const batch = papersWithNewEmbedding.slice(bi, bi + indexBatchSize);
                  const normalizedBatch = batch.map((paper: any, idx: number) => {
                    const sourceType = inferSourceType(paper.source || '', paper.abstract);
                    const source = sourceType === 'unknown' ? 'wos' : sourceType;
                    return normalizeLiterature(paper, bi + idx, source as 'wos' | 'cnki' | 'ris' | 'bib');
                  });
                  literaturesToIndex.push(...normalizedBatch);
                  await new Promise(r => setTimeout(r, 10));
                }
                
                await userEngine.addDocuments(literaturesToIndex);
                logger.info(`[Embedding] Updated ${literaturesToIndex.length} papers with embeddings for user ${userId} (total: ${userEngine.getDocumentCount()})`);
                
                // 更新全局引用（向后兼容 web-user）
                if (userId === 'web-user') {
                  globalRetrievalEngine = userEngine;
                  if (globalConversationFlow) {
                    globalConversationFlow.setRetrievalEngine(userEngine);
                  }
                }
                
                // 保存索引缓存
                const cacheDir = path.join(userDir, "index-cache");
                await new Promise(r => setTimeout(r, 50));
                userEngine.saveIndex(cacheDir);
                logger.info(`[Embedding] Saved index cache to ${cacheDir}`);
              }
              
            } catch (mergeError) {
              logger.error('[Embedding] Failed to merge embeddings:', mergeError);
            }
          }
        }
      } catch (saveError) {
        logger.error('[Embedding] Failed to save embeddings:', saveError);
      }
    })();
    
  } catch (topLevelError) {
    // 顶层异常捕获，设置 error 状态
    logger.error('[Embedding] Fatal error in generateEmbeddingsInBackground:', topLevelError);
    embeddingProgress.status = 'error';
    embeddingProgress.endTime = Date.now();
    embeddingProgress.message = '向量嵌入生成异常：' + ((topLevelError as Error).message || '未知错误');
  }
}

app.get("/", (req: Request, res: Response) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

const LOCAL_PREVIEW_IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".tif",
  ".tiff",
  ".svg",
]);

function isPathInside(parentDir: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentDir), path.resolve(childPath));
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function getLocalPreviewAllowedRoots(): string[] {
  const roots = [
    dataDir,
    process.cwd(),
    path.join(os.homedir(), "Documents", "Codex"),
    path.join(os.homedir(), "Desktop"),
  ];
  return Array.from(new Set(roots.map(root => path.resolve(root))));
}

function resolveLocalPreviewImagePath(rawPath: unknown): string | null {
  const value = String(rawPath || "").trim();
  if (!value || value.length > 2048 || /^https?:\/\//i.test(value)) return null;
  const resolved = path.resolve(value);
  const ext = path.extname(resolved).toLowerCase();
  if (!LOCAL_PREVIEW_IMAGE_EXTENSIONS.has(ext)) return null;
  if (!getLocalPreviewAllowedRoots().some(root => isPathInside(root, resolved))) return null;
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;
  return resolved;
}

app.get("/api/local-file/preview", (req: Request, res: Response) => {
  try {
    const filePath = resolveLocalPreviewImagePath(req.query.path);
    if (!filePath) {
      res.status(404).json({ success: false, error: "文件不存在或不允许预览" });
      return;
    }
    res.setHeader("Cache-Control", "private, max-age=60");
    res.sendFile(filePath);
  } catch (error) {
    logger.warn("[LocalFile] Preview failed", error);
    res.status(500).json({ success: false, error: "本地图片预览失败" });
  }
});

app.get("/api/model", (req: Request, res: Response) => {
  res.json({ model: primaryModel });
});

app.post("/api/models", async (req: Request, res: Response) => {
  const customApiUrl = (req.body.apiUrl || apiUrl || '').trim().replace(/\/+$/, '');
  const customApiKey = req.body.apiKey || apiKey;

  try {
    const response = await fetch(customApiUrl + "/models", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + customApiKey,
      },
    });

    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }

    const data = await response.json() as {
      data?: Array<{ id: string; owned_by?: string }>;
    };

    const modelIds = (data.data || [])
      .map((m) => m.id)
      .filter((id) => id && !id.includes(":"))
      .sort();

    res.json({ models: modelIds, success: true });
  } catch (error) {
    res.json({
      models: [],
      success: false,
      error: (error as Error).message
    });
  }
});

app.post("/api/settings", (req: Request, res: Response) => {
  const { apiUrl: newApiUrl, apiKey: newApiKey, model: newModel, secondaryModel: newSecondaryModel, webSearchKey: newWebSearchKey } = req.body;
  
  if (newApiUrl) {
    currentApiUrl = newApiUrl;
    logger.info(`[Settings] API URL updated: ${newApiUrl}`);
  }
  if (newApiKey) {
    currentApiKey = newApiKey;
    logger.info(`[Settings] API Key updated`);
  }
  if (newModel) {
    currentModel = newModel;
    logger.info(`[Settings] Primary Model updated: ${newModel}`);
  }
  if (newSecondaryModel) {
    currentSecondaryModel = newSecondaryModel;
    logger.info(`[Settings] Secondary Model updated: ${newSecondaryModel}`);
  }
  if (newWebSearchKey !== undefined) {
    currentWebSearchKey = newWebSearchKey;
    logger.info(`[Settings] Web Search Key updated`);
  }
  
  // Persist settings to file so they survive server restarts
  persistSettings();
  
  res.json({ 
    success: true, 
    settings: {
      apiUrl: currentApiUrl,
      model: currentModel,
      secondaryModel: currentSecondaryModel,
      hasApiKey: !!currentApiKey,
      hasWebSearchKey: !!currentWebSearchKey
    }
  });
});

app.get("/api/settings", (req: Request, res: Response) => {
  res.json({
    apiUrl: currentApiUrl,
    apiKey: currentApiKey,  // 本地应用，返回 apiKey 以便前端同步
    model: currentModel,
    secondaryModel: currentSecondaryModel,
    hasApiKey: !!currentApiKey,
    hasWebSearchKey: !!currentWebSearchKey
  });
});

app.get("/api/pdf-wiki/config", (req: Request, res: Response) => {
  const runtime = getPdfWikiLlmRuntimeConfig();
  const fastTextStatus = detectPdfFastTextStatus();
  res.json({
    success: true,
    apiUrl: currentPdfWikiLlmConfig.apiUrl,
    model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
    qwenModels: {
      textStructure: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
      jsonStructure: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
      ocr: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
      visionFallback: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    },
    textInApiUrl: currentPdfWikiLlmConfig.textInApiUrl || 'https://api.textin.com/ai/service/v1/pdf_to_markdown',
    textInAppId: currentPdfWikiLlmConfig.textInAppId || '',
    textInParseMode: currentPdfWikiLlmConfig.textInParseMode || 'auto',
    hasApiKey: !!currentPdfWikiLlmConfig.apiKey,
    hasTextInSecretCode: !!currentPdfWikiLlmConfig.textInSecretCode,
    configured: runtime.configured,
    dedicated: runtime.dedicated,
    activeModel: runtime.model,
    activeLabel: runtime.label,
    activeQwenModels: {
      textStructure: runtime.model,
      jsonStructure: runtime.jsonModel || DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
      ocr: runtime.ocrModel || DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
      visionFallback: runtime.visionModel || DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    },
    textInConfigured: runtime.textInConfigured,
    liteParseAvailable: runtime.liteParseAvailable,
    markerAvailable: runtime.markerAvailable,
    fastTextAvailable: runtime.fastTextAvailable,
    liteParseStatus: {
      available: runtime.liteParseAvailable,
      bundled: true,
      packageName: '@llamaindex/liteparse',
      note: runtime.liteParseAvailable ? 'LiteParse 是 npm 依赖，随 Electron 安装包的 node_modules 一起提供。' : '未检测到 @llamaindex/liteparse，请检查安装包依赖。',
    },
    fastTextStatus,
    codexAvailable: runtime.codexAvailable,
    codexModel: runtime.codexModel,
    codexReasoningEffort: runtime.codexReasoningEffort,
  });
});

app.post("/api/pdf-wiki/config", (req: Request, res: Response) => {
  const apiUrlValue = typeof req.body.apiUrl === 'string' ? req.body.apiUrl.trim() : currentPdfWikiLlmConfig.apiUrl;
  const requestedApiKey = typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : undefined;
  const keepApiKey = req.body.keepApiKey === true || req.body.keepApiKey === 'true';
  const apiKeyValue = apiUrlValue
    ? (keepApiKey && requestedApiKey === '' ? currentPdfWikiLlmConfig.apiKey : (requestedApiKey ?? currentPdfWikiLlmConfig.apiKey))
    : '';
  const textInApiUrlValue = typeof req.body.textInApiUrl === 'string' && req.body.textInApiUrl.trim()
    ? req.body.textInApiUrl.trim()
    : 'https://api.textin.com/ai/service/v1/pdf_to_markdown';
  const textInAppIdValue = typeof req.body.textInAppId === 'string' ? req.body.textInAppId.trim() : currentPdfWikiLlmConfig.textInAppId || '';
  const requestedTextInSecretCode = typeof req.body.textInSecretCode === 'string' ? req.body.textInSecretCode.trim() : undefined;
  const keepTextInSecretCode = req.body.keepTextInSecretCode === true || req.body.keepTextInSecretCode === 'true';
  const textInSecretCodeValue = textInAppIdValue
    ? (keepTextInSecretCode && requestedTextInSecretCode === '' ? currentPdfWikiLlmConfig.textInSecretCode || '' : (requestedTextInSecretCode ?? (currentPdfWikiLlmConfig.textInSecretCode || '')))
    : '';
  const textInParseModeValue = typeof req.body.textInParseMode === 'string' && req.body.textInParseMode.trim()
    ? req.body.textInParseMode.trim()
    : 'auto';

  currentPdfWikiLlmConfig = {
    apiUrl: apiUrlValue,
    apiKey: apiKeyValue,
    model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
    jsonModel: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
    ocrModel: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
    visionModel: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    textInApiUrl: textInApiUrlValue,
    textInAppId: textInAppIdValue,
    textInSecretCode: textInSecretCodeValue,
    textInParseMode: textInParseModeValue,
  };
  persistPdfWikiLlmConfig();

  const runtime = getPdfWikiLlmRuntimeConfig();
  const fastTextStatus = detectPdfFastTextStatus();
  res.json({
    success: true,
    apiUrl: currentPdfWikiLlmConfig.apiUrl,
    model: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
    qwenModels: {
      textStructure: DEFAULT_PDF_WIKI_QWEN_TEXT_MODEL,
      jsonStructure: DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
      ocr: DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
      visionFallback: DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    },
    textInApiUrl: currentPdfWikiLlmConfig.textInApiUrl,
    textInAppId: currentPdfWikiLlmConfig.textInAppId,
    textInParseMode: currentPdfWikiLlmConfig.textInParseMode,
    hasApiKey: !!currentPdfWikiLlmConfig.apiKey,
    hasTextInSecretCode: !!currentPdfWikiLlmConfig.textInSecretCode,
    configured: runtime.configured,
    dedicated: runtime.dedicated,
    activeModel: runtime.model,
    activeLabel: runtime.label,
    activeQwenModels: {
      textStructure: runtime.model,
      jsonStructure: runtime.jsonModel || DEFAULT_PDF_WIKI_QWEN_STRUCTURE_MODEL,
      ocr: runtime.ocrModel || DEFAULT_PDF_WIKI_QWEN_OCR_MODEL,
      visionFallback: runtime.visionModel || DEFAULT_PDF_WIKI_QWEN_VISION_MODEL,
    },
    textInConfigured: runtime.textInConfigured,
    liteParseAvailable: runtime.liteParseAvailable,
    markerAvailable: runtime.markerAvailable,
    fastTextAvailable: runtime.fastTextAvailable,
    liteParseStatus: {
      available: runtime.liteParseAvailable,
      bundled: true,
      packageName: '@llamaindex/liteparse',
      note: runtime.liteParseAvailable ? 'LiteParse 是 npm 依赖，随 Electron 安装包的 node_modules 一起提供。' : '未检测到 @llamaindex/liteparse，请检查安装包依赖。',
    },
    fastTextStatus,
    codexAvailable: runtime.codexAvailable,
    codexModel: runtime.codexModel,
    codexReasoningEffort: runtime.codexReasoningEffort,
  });
});

app.get("/api/pdf-wiki/meta-template", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const template = await pdfWikiManager.getMetaAnalysisTemplate(userId);
    res.json({ success: true, ...template });
  } catch (error) {
    logger.error("[PdfWiki] Failed to read Meta template:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta-template", chatUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = (req as Request & { file?: { originalname: string; buffer: Buffer } }).file;
    if (!file || !file.buffer) {
      res.status(400).json({ success: false, error: "请先选择 Meta 数据库 Excel/CSV 模板文件" });
      return;
    }
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const templateStructure = await parsePdfWikiMetaTemplateColumns(file.originalname, file.buffer);
    const template = await pdfWikiManager.saveMetaAnalysisTemplate(userId, {
      filename: file.originalname,
      ...templateStructure,
    });
    res.json({ success: true, ...template });
  } catch (error) {
    logger.error("[PdfWiki] Failed to save Meta template:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.delete("/api/pdf-wiki/meta-template", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const template = await pdfWikiManager.clearMetaAnalysisTemplate(userId);
    res.json({ success: true, ...template });
  } catch (error) {
    logger.error("[PdfWiki] Failed to clear Meta template:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

const DEFAULT_EMBEDDING_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v4';
const DEFAULT_EMBEDDING_DIMENSIONS = 1024;

function normalizeEmbeddingApiUrl(value: unknown): string {
  const url = typeof value === 'string' ? value.trim() : '';
  if (!url || url === 'https://scholarharness.com/api/v1' || url === 'https://scholarharness.com/api/v1/') {
    return DEFAULT_EMBEDDING_API_URL;
  }
  return url;
}

function normalizeEmbeddingModel(value: unknown): string {
  const model = typeof value === 'string' ? value.trim() : '';
  if (!model || model === 'text-embedding-3-small') {
    return DEFAULT_EMBEDDING_MODEL;
  }
  return model;
}

// Embedding API 配置 - 从用户配置文件加载，不使用环境变量
function loadEmbeddingConfig(): { url: string; key: string; model: string; dimensions: number; enabled: boolean } {
  const configPath = path.join(dataDir, 'embedding-config.json');
  try {
    if (fs.existsSync(configPath)) {
      const savedConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      logger.info('[Embedding] 加载用户配置:', { 
        url: savedConfig.url || '(空)', 
        model: savedConfig.model || '(默认)',
        dimensions: savedConfig.dimensions || 1024,
        enabled: savedConfig.enabled,
        hasKey: !!savedConfig.key
      });
      return {
        url: normalizeEmbeddingApiUrl(savedConfig.url),
        key: savedConfig.key || '',
        model: normalizeEmbeddingModel(savedConfig.model),
        dimensions: savedConfig.dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
        enabled: savedConfig.enabled !== false
      };
    }
  } catch (e) {
    logger.warn('[Embedding] 加载配置文件失败:', e);
  }
  // 默认预填千问 Embedding 兼容地址，等待用户补充 API Key
  return {
    url: DEFAULT_EMBEDDING_API_URL,
    key: '',
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    enabled: true
  };
}

let currentEmbeddingConfig = loadEmbeddingConfig();

app.post("/api/embedding/config", (req: Request, res: Response) => {
  const { url, key, model, dimensions, enabled } = req.body;
  
  logger.info('[Embedding] 收到配置保存请求:', { 
    url: url || '(空)', 
    key: key ? '(已填写)' : '(空)', 
    model: model || '(默认)',
    dimensions: dimensions || 1024,
    enabled: enabled
  });
  
  currentEmbeddingConfig = {
    url: normalizeEmbeddingApiUrl(url),
    key: key || '',
    model: normalizeEmbeddingModel(model),
    dimensions: dimensions || DEFAULT_EMBEDDING_DIMENSIONS,
    enabled: enabled !== false
  };
  
  // 持久化保存到文件
  const configPath = path.join(dataDir, 'embedding-config.json');
  try {
    fs.writeFileSync(configPath, JSON.stringify(currentEmbeddingConfig, null, 2), 'utf-8');
    logger.info('[Embedding] 配置已保存到文件:', configPath);
  } catch (e) {
    logger.error('[Embedding] 保存配置文件失败:', e);
  }
  
  logger.info('[Embedding] 配置已保存:', { 
    url: currentEmbeddingConfig.url, 
    model: currentEmbeddingConfig.model, 
    dimensions: currentEmbeddingConfig.dimensions,
    enabled: currentEmbeddingConfig.enabled,
    hasKey: !!currentEmbeddingConfig.key
  });

  retrievalEngineManager.clearAll();
  retrievalEngineManager.updateApiConfig({
    url: currentEmbeddingConfig.enabled ? currentEmbeddingConfig.url : undefined,
    key: currentEmbeddingConfig.enabled ? currentEmbeddingConfig.key : undefined,
    model: currentEmbeddingConfig.model,
    dimensions: currentEmbeddingConfig.dimensions,
  });
  pdfWikiManager.clearAllEngines();
  
  // 更新检索引擎的 API 配置和维度配置
    if (currentEmbeddingConfig.enabled && currentEmbeddingConfig.url && currentEmbeddingConfig.key) {
    // 需要重新创建 VectorRetriever 以更新维度配置
    globalRetrievalEngine = new HybridRetrievalEngine({
      vector: {
        model: currentEmbeddingConfig.model,
        dimensions: currentEmbeddingConfig.dimensions,
        topN: 50,
        similarity: 'cosine',
      }
    }, {
      url: currentEmbeddingConfig.url,
      key: currentEmbeddingConfig.key
    });
    setRetrievalEngine(globalRetrievalEngine);
    if (globalConversationFlow) {
      globalConversationFlow.setRetrievalEngine(globalRetrievalEngine);
    }
    logger.info('[Embedding] 已更新检索引擎的 API 配置和维度');
  }
  
  if (currentEmbeddingConfig.enabled && (!currentEmbeddingConfig.url || !currentEmbeddingConfig.key)) {
    logger.warn('[Embedding] 启用了语义搜索但 API 配置不完整');
    res.json({ 
      success: true, 
      config: {
        url: currentEmbeddingConfig.url,
        model: currentEmbeddingConfig.model,
        dimensions: currentEmbeddingConfig.dimensions,
        enabled: currentEmbeddingConfig.enabled
      },
      warning: '已保存配置，但未填写完整的API信息。系统将使用词汇搜索。'
    });
    return;
  }
  
  logger.info('[Embedding] 配置保存成功');
  res.json({ 
    success: true, 
    config: {
      url: currentEmbeddingConfig.url,
      model: currentEmbeddingConfig.model,
      dimensions: currentEmbeddingConfig.dimensions,
      enabled: currentEmbeddingConfig.enabled
    }
  });
});

app.get("/api/embedding/config", (req: Request, res: Response) => {
  res.json({
    url: currentEmbeddingConfig.url,
    model: currentEmbeddingConfig.model,
    dimensions: currentEmbeddingConfig.dimensions,
    enabled: currentEmbeddingConfig.enabled,
    hasKey: !!currentEmbeddingConfig.key
  });
});

// 获取 embedding 进度
app.get("/api/embedding/progress", (req: Request, res: Response) => {
  res.json(embeddingProgress);
});

// SSE 端点：实时推送 embedding 进度
app.get("/api/embedding/progress/stream", (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const sendProgress = () => {
    res.write(`data: ${JSON.stringify(embeddingProgress)}\n\n`);
    
    if (embeddingProgress.status === 'completed' || embeddingProgress.status === 'error') {
      res.end();
      return;
    }
  };
  
  sendProgress();
  
  const interval = setInterval(() => {
    if (embeddingProgress.status === 'completed' || embeddingProgress.status === 'error') {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify(embeddingProgress)}\n\n`);
      res.end();
      return;
    }
    sendProgress();
  }, 500);
  
  req.on('close', () => {
    clearInterval(interval);
  });
});

app.get("/api/pdf-wiki/status", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const status = await pdfWikiManager.getStatus(userId);
    res.json({ success: true, ...status });
  } catch (error) {
    logger.error("[PdfWiki] Status route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/entries", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const [status, store] = await Promise.all([
      pdfWikiManager.getStatus(userId),
      pdfWikiManager.getStore(userId),
    ]);
    const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
    const favoriteEntryIds = getLibraryFavoriteSet(userId, "pdfWiki");

    const entries = store.entries
      .slice()
      .sort((a, b) => (a.displayClaimZh || a.normalizedClaim || a.claim).localeCompare(b.displayClaimZh || b.normalizedClaim || b.claim, "zh-CN"))
      .map(entry => {
        const sourceDocuments = buildPdfWikiSourceDocuments(entry, pdfById);
        return {
          ...entry,
          favorite: favoriteEntryIds.has(entry.id),
          sourceDocuments,
          supportReferenceCount: countPdfWikiReferences(entry.pro),
          opposeReferenceCount: countPdfWikiReferences(entry.con),
          neutralReferenceCount: countPdfWikiReferences(entry.neutral),
          supportDocumentCount: countPdfWikiSourceDocuments(entry.pro, sourceDocuments),
          opposeDocumentCount: countPdfWikiSourceDocuments(entry.con, sourceDocuments),
          neutralDocumentCount: countPdfWikiSourceDocuments(entry.neutral, sourceDocuments),
        };
      });

    res.json({
      success: true,
      status,
      generatedAt: store.generatedAt,
      pdfCount: store.pdfs.length,
      entryCount: entries.length,
      sentenceCloud: store.sentenceCloud || { generatedAt: store.generatedAt, points: [], clouds: [] },
      entries,
      favoriteEntryIds: Array.from(favoriteEntryIds),
    });
  } catch (error) {
    logger.error("[PdfWiki] Entries route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/export-obsidian", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || req.query.userId || "web-user");
    const store = await pdfWikiManager.getStore(userId);
    const result = await exportPdfWikiObsidianVault(userId, store);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Obsidian export route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/obsidian/status", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const status = await getPdfWikiObsidianVaultStatus(userId);
    res.json({ success: true, ...status });
  } catch (error) {
    logger.error("[PdfWiki] Obsidian status route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/obsidian/deploy", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || req.query.userId || "web-user");
    const store = await pdfWikiManager.getStore(userId);
    const result = await deployPdfWikiObsidianVault(userId, store);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Obsidian deploy route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/obsidian/search", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const query = String(req.query.q || "");
    const limit = Math.max(1, Math.min(80, parseInt(String(req.query.limit || "30"), 10) || 30));
    const result = await searchPdfWikiObsidianVault(userId, query, limit);
    res.json({ success: true, query, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Obsidian search route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/entries/delete", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const entryIds = Array.isArray(req.body.entryIds) ? req.body.entryIds.map(String) : [];
    const result = await pdfWikiManager.deleteEntries(userId, entryIds);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Delete entries route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/entries/merge", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const entryIds = Array.isArray(req.body.entryIds) ? req.body.entryIds.map(String) : [];
    const normalizedClaim = typeof req.body.normalizedClaim === "string" ? req.body.normalizedClaim : undefined;
    const result = await pdfWikiManager.mergeEntries(userId, entryIds, normalizedClaim);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Merge entries route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/entries/favorite", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const entryId = String(req.body.entryId || "").trim();
    const favorite = req.body.favorite !== false;
    const store = await pdfWikiManager.getStore(userId);
    if (!store.entries.some(entry => entry.id === entryId)) {
      res.status(404).json({ success: false, error: "未找到该论点" });
      return;
    }

    res.json({
      success: true,
      entryId,
      ...toggleLibraryFavorite(userId, "pdfWiki", entryId, favorite),
    });
  } catch (error) {
    logger.error("[PdfWiki] Favorite entry route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

interface PdfWikiSourceDocument {
  id: string;
  sourcePdfId: string;
  sourcePdfName: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
}

function buildPdfWikiSourceDocuments(entry: PdfWikiEntry, pdfById: Map<string, PdfWikiSourcePdf>): PdfWikiSourceDocument[] {
  const docs: PdfWikiSourceDocument[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < entry.sourcePdfIds.length; index++) {
    const pdfId = entry.sourcePdfIds[index];
    const pdf = pdfById.get(pdfId);
    const doc = pdf
      ? serializePdfWikiSourcePdf(pdf)
      : serializePdfWikiSourceName(pdfId, entry.sourcePdfNames[index] || pdfId);
    if (!seen.has(doc.sourcePdfId)) {
      seen.add(doc.sourcePdfId);
      docs.push(doc);
    }
  }

  for (const sourceName of entry.sourcePdfNames) {
    const key = sourceName.toLowerCase();
    if (!Array.from(seen).some(id => id.toLowerCase() === key) && !docs.some(doc => doc.sourcePdfName === sourceName)) {
      docs.push(serializePdfWikiSourceName(sourceName, sourceName));
    }
  }

  return docs;
}

function countPdfWikiSourceDocuments(viewpoints: PdfWikiViewpoint[], sourceDocuments: PdfWikiSourceDocument[]): number {
  if (viewpoints.length === 0) return 0;
  const seen = new Set<string>();
  for (const viewpoint of viewpoints) {
    const key = String(viewpoint.sourcePdfId || viewpoint.sourcePdfName || '').trim();
    if (key) seen.add(key);
  }
  if (seen.size === 0) return sourceDocuments.length;
  return sourceDocuments.filter(doc => seen.has(doc.sourcePdfId) || seen.has(doc.sourcePdfName)).length;
}

function serializePdfWikiSourcePdf(pdf: PdfWikiSourcePdf): PdfWikiSourceDocument {
  const inferred = inferPdfWikiSourceName(pdf.originalName);
  return {
    id: pdf.id,
    sourcePdfId: pdf.id,
    sourcePdfName: pdf.originalName,
    title: pdf.title || inferred.title || pdf.originalName,
    authors: pdf.authors || inferred.authors || '未解析',
    year: pdf.year || inferred.year || '未解析',
    journal: pdf.journal || inferred.journal || '未解析',
    doi: normalizePdfWikiDoi(pdf.doi || inferred.doi || ''),
  };
}

function serializePdfWikiSourceName(sourcePdfId: string, sourcePdfName: string): PdfWikiSourceDocument {
  const inferred = inferPdfWikiSourceName(sourcePdfName);
  return {
    id: sourcePdfId,
    sourcePdfId,
    sourcePdfName,
    title: inferred.title || sourcePdfName,
    authors: inferred.authors || '未解析',
    year: inferred.year || '未解析',
    journal: inferred.journal || '未解析',
    doi: normalizePdfWikiDoi(inferred.doi || ''),
  };
}

function inferPdfWikiSourceName(sourcePdfName: string): Partial<PdfWikiSourceDocument> {
  const fileBase = path.basename(String(sourcePdfName || ''), path.extname(String(sourcePdfName || '')) || '.pdf').trim();
  const cleanName = fileBase.replace(/^[a-f0-9]{16}-/, '');
  const year = cleanName.match(/\b(19|20)\d{2}\b/)?.[0] || '';
  const parts = cleanName.split(/\s+-\s+/).map(part => part.trim()).filter(Boolean);
  const yearIndex = parts.findIndex(part => /\b(19|20)\d{2}\b/.test(part));

  if (yearIndex >= 0 && yearIndex < parts.length - 1) {
    return {
      authors: yearIndex > 0 ? parts.slice(0, yearIndex).join(' - ') : '',
      year,
      title: parts.slice(yearIndex + 1).join(' - '),
    };
  }

  return { title: cleanName, year };
}

function countPdfWikiReferences(viewpoints: PdfWikiViewpoint[]): number {
  const seen = new Set<string>();
  for (const viewpoint of viewpoints) {
    for (const ref of viewpoint.references || []) {
      const key = getPdfWikiReferenceKey(ref);
      if (key) seen.add(key);
    }
  }
  return seen.size;
}

function getPdfWikiReferenceKey(ref: PdfWikiReference): string {
  return String(ref.doi || ref.title || ref.raw || ref.id || '').trim().toLowerCase();
}

function normalizePdfWikiDoi(doi: string): string {
  return String(doi || '')
    .trim()
    .replace(/^doi:\s*/i, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/[),.;\]]+$/g, '')
    .trim();
}

interface PdfWikiObsidianExportResult {
  exportDir: string;
  fileCount: number;
  sentencePointCount: number;
  entryCount: number;
  topicCount: number;
  pdfCount: number;
}

interface PdfWikiObsidianExportOptions {
  exportDir?: string;
  clean?: boolean;
}

interface PdfWikiObsidianDeployResult extends PdfWikiObsidianExportResult {
  vaultDir: string;
  deployedAt: string;
}

interface PdfWikiObsidianSearchResult {
  title: string;
  relativePath: string;
  type: string;
  snippet: string;
  score: number;
}

interface PdfWikiObsidianTopicRecord {
  key: string;
  label: string;
  pointIds: string[];
}

const PDF_WIKI_OBSIDIAN_ROOT_NAME = "PDF句子级Wiki论点库";
const PDF_WIKI_OBSIDIAN_SENTENCE_DIR = "句子论点";
const PDF_WIKI_OBSIDIAN_PDF_DIR = "PDF来源";
const PDF_WIKI_OBSIDIAN_TOPIC_DIR = "主题";
const PDF_WIKI_OBSIDIAN_ENTRY_DIR = "兼容论点组";
const PDF_WIKI_OBSIDIAN_WORKSPACE_DIR = "obsidian-vaults";
const PDF_WIKI_OBSIDIAN_MANIFEST_FILE = ".scholar-harness-obsidian.json";

async function exportPdfWikiObsidianVault(userId: string, store: PdfWikiStore, options: PdfWikiObsidianExportOptions = {}): Promise<PdfWikiObsidianExportResult> {
  const points = sortPdfWikiSentencePointsForObsidian(store.sentenceCloud?.points || []);
  const entries = Array.isArray(store.entries) ? store.entries.slice() : [];
  if (points.length === 0 && entries.length === 0) {
    throw new Error("当前还没有可导出的 PDF Wiki 句子级论点库。");
  }

  const timestamp = formatPdfWikiObsidianTimestamp(new Date());
  const exportDir = options.exportDir
    ? path.resolve(options.exportDir)
    : path.join(
      fs.existsSync(path.join(os.homedir(), "Desktop")) ? path.join(os.homedir(), "Desktop") : os.homedir(),
      "Scholar Harness Obsidian",
      `${PDF_WIKI_OBSIDIAN_ROOT_NAME}-${timestamp}`
    );
  if (options.clean) {
    await cleanPdfWikiObsidianVaultDir(exportDir);
  }
  await fs.promises.mkdir(exportDir, { recursive: true });

  let fileCount = 0;
  async function writeNote(relativePath: string, content: string): Promise<void> {
    const absolutePath = path.join(exportDir, ...relativePath.split("/"));
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, content, "utf-8");
    fileCount += 1;
  }

  const pointNoteNameById = new Map<string, string>();
  const usedPointNames = new Set<string>();
  points.forEach((point, index) => {
    const code = `句${shortPdfWikiObsidianHash(point.id || `${point.sourcePdfName}-${point.sentenceIndex}-${index}`).toUpperCase()}`;
    const title = point.claimText || point.sentence;
    pointNoteNameById.set(point.id, reservePdfWikiObsidianNoteName(`${code} - ${title}`, code, usedPointNames, 86));
  });

  const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
  const sourceDocs = collectPdfWikiObsidianSourceDocuments(store, points, entries, pdfById);
  const pdfNoteNameByAlias = new Map<string, string>();
  const usedPdfNames = new Set<string>();
  for (const doc of sourceDocs) {
    const noteName = reservePdfWikiObsidianNoteName(doc.title || doc.sourcePdfName || doc.sourcePdfId, "PDF来源", usedPdfNames, 82);
    [doc.sourcePdfId, doc.sourcePdfName, doc.title].filter(Boolean).forEach(alias => {
      pdfNoteNameByAlias.set(String(alias), noteName);
      pdfNoteNameByAlias.set(String(alias).toLowerCase(), noteName);
    });
  }

  const topics = collectPdfWikiObsidianTopics(store, points);
  const topicNoteNameByAlias = new Map<string, string>();
  const usedTopicNames = new Set<string>();
  topics.forEach(topic => {
    const noteName = reservePdfWikiObsidianNoteName(topic.label || topic.key, "主题", usedTopicNames, 72);
    [topic.key, topic.label].filter(Boolean).forEach(alias => {
      topicNoteNameByAlias.set(String(alias), noteName);
      topicNoteNameByAlias.set(String(alias).toLowerCase(), noteName);
    });
  });

  const entryNoteNameById = new Map<string, string>();
  const entryIdsByPointId = new Map<string, string[]>();
  const usedEntryNames = new Set<string>();
  for (const entry of entries) {
    entryNoteNameById.set(
      entry.id,
      reservePdfWikiObsidianNoteName(entry.displayClaimZh || entry.normalizedClaim || entry.claim, "兼容论点组", usedEntryNames, 86)
    );
    for (const pointId of collectPdfWikiEntryEvidenceSentenceIds(entry)) {
      const list = entryIdsByPointId.get(pointId) || [];
      list.push(entry.id);
      entryIdsByPointId.set(pointId, list);
    }
  }

  for (const point of points) {
    const noteName = pointNoteNameById.get(point.id);
    if (!noteName) continue;
    await writeNote(
      `${PDF_WIKI_OBSIDIAN_SENTENCE_DIR}/${noteName}.md`,
      buildPdfWikiObsidianSentenceNote(point, {
        pdfNoteNameByAlias,
        topicNoteNameByAlias,
        entryNoteNameById,
        entryIdsByPointId,
      })
    );
  }

  for (const entry of entries) {
    const noteName = entryNoteNameById.get(entry.id);
    if (!noteName) continue;
    await writeNote(
      `${PDF_WIKI_OBSIDIAN_ENTRY_DIR}/${noteName}.md`,
      buildPdfWikiObsidianEntryNote(entry, {
        pdfNoteNameByAlias,
        pointNoteNameById,
      })
    );
  }

  for (const topic of topics) {
    const noteName = topicNoteNameByAlias.get(topic.key) || topicNoteNameByAlias.get(topic.label);
    if (!noteName) continue;
    await writeNote(
      `${PDF_WIKI_OBSIDIAN_TOPIC_DIR}/${noteName}.md`,
      buildPdfWikiObsidianTopicNote(topic, points, pointNoteNameById)
    );
  }

  for (const doc of sourceDocs) {
    const noteName = pdfNoteNameByAlias.get(doc.sourcePdfId) || pdfNoteNameByAlias.get(doc.sourcePdfName) || pdfNoteNameByAlias.get(doc.title);
    if (!noteName) continue;
    await writeNote(
      `${PDF_WIKI_OBSIDIAN_PDF_DIR}/${noteName}.md`,
      buildPdfWikiObsidianPdfNote(doc, points, entries, {
        pointNoteNameById,
        entryNoteNameById,
      })
    );
  }

  await writeNote(
    `${PDF_WIKI_OBSIDIAN_ROOT_NAME}.md`,
    buildPdfWikiObsidianIndexNote({
      userId,
      generatedAt: store.generatedAt,
      exportedAt: new Date().toISOString(),
      points,
      entries,
      topics,
      sourceDocs,
      pointNoteNameById,
      topicNoteNameByAlias,
      pdfNoteNameByAlias,
      entryNoteNameById,
    })
  );

  return {
    exportDir,
    fileCount,
    sentencePointCount: points.length,
    entryCount: entries.length,
    topicCount: topics.length,
    pdfCount: sourceDocs.length,
  };
}

function getPdfWikiObsidianVaultDir(userId: string): string {
  return path.join(dataDir, PDF_WIKI_OBSIDIAN_WORKSPACE_DIR, sanitizeUserId(userId || "web-user"), PDF_WIKI_OBSIDIAN_ROOT_NAME);
}

function assertPdfWikiObsidianVaultPathInsideDataDir(vaultDir: string): string {
  const resolvedVaultDir = path.resolve(vaultDir);
  const resolvedDataDir = path.resolve(dataDir);
  if (resolvedVaultDir !== resolvedDataDir && !resolvedVaultDir.startsWith(resolvedDataDir + path.sep)) {
    throw new Error("Obsidian vault 路径不在 Scholar Harness 数据目录内");
  }
  return resolvedVaultDir;
}

async function cleanPdfWikiObsidianVaultDir(vaultDir: string): Promise<void> {
  const safeVaultDir = assertPdfWikiObsidianVaultPathInsideDataDir(vaultDir);
  await fs.promises.mkdir(safeVaultDir, { recursive: true });
  const ownedNames = [
    PDF_WIKI_OBSIDIAN_SENTENCE_DIR,
    PDF_WIKI_OBSIDIAN_PDF_DIR,
    PDF_WIKI_OBSIDIAN_TOPIC_DIR,
    PDF_WIKI_OBSIDIAN_ENTRY_DIR,
    `${PDF_WIKI_OBSIDIAN_ROOT_NAME}.md`,
    PDF_WIKI_OBSIDIAN_MANIFEST_FILE,
  ];
  for (const name of ownedNames) {
    await fs.promises.rm(path.join(safeVaultDir, name), { recursive: true, force: true });
  }
}

async function deployPdfWikiObsidianVault(userId: string, store: PdfWikiStore): Promise<PdfWikiObsidianDeployResult> {
  const vaultDir = getPdfWikiObsidianVaultDir(userId);
  const deployedAt = new Date().toISOString();
  const result = await exportPdfWikiObsidianVault(userId, store, { exportDir: vaultDir, clean: true });
  await fs.promises.writeFile(
    path.join(vaultDir, PDF_WIKI_OBSIDIAN_MANIFEST_FILE),
    JSON.stringify({
      type: "scholar_harness_obsidian_vault",
      userId: sanitizeUserId(userId || "web-user"),
      rootName: PDF_WIKI_OBSIDIAN_ROOT_NAME,
      deployedAt,
      fileCount: result.fileCount,
      sentencePointCount: result.sentencePointCount,
      entryCount: result.entryCount,
      topicCount: result.topicCount,
      pdfCount: result.pdfCount,
    }, null, 2),
    "utf-8"
  );
  return { ...result, vaultDir, deployedAt };
}

async function getPdfWikiObsidianVaultStatus(userId: string): Promise<Record<string, unknown>> {
  const vaultDir = getPdfWikiObsidianVaultDir(userId);
  const manifestPath = path.join(vaultDir, PDF_WIKI_OBSIDIAN_MANIFEST_FILE);
  const indexPath = path.join(vaultDir, `${PDF_WIKI_OBSIDIAN_ROOT_NAME}.md`);
  if (!fs.existsSync(manifestPath) || !fs.existsSync(indexPath)) {
    return { deployed: false, vaultDir };
  }
  let manifest: Record<string, unknown> = {};
  try {
    manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    manifest = {};
  }
  return {
    deployed: true,
    vaultDir,
    indexPath,
    ...manifest,
  };
}

async function listPdfWikiObsidianMarkdownFiles(rootDir: string, currentDir = rootDir, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolutePath = path.join(currentDir, entry.name);
    const resolved = path.resolve(absolutePath);
    const root = path.resolve(rootDir);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) continue;
    if (entry.isDirectory()) {
      files.push(...await listPdfWikiObsidianMarkdownFiles(rootDir, absolutePath, depth + 1));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(absolutePath);
    }
  }
  return files;
}

function inferPdfWikiObsidianNoteType(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith(`${PDF_WIKI_OBSIDIAN_SENTENCE_DIR}/`)) return "句子论点";
  if (normalized.startsWith(`${PDF_WIKI_OBSIDIAN_PDF_DIR}/`)) return "PDF来源";
  if (normalized.startsWith(`${PDF_WIKI_OBSIDIAN_TOPIC_DIR}/`)) return "主题";
  if (normalized.startsWith(`${PDF_WIKI_OBSIDIAN_ENTRY_DIR}/`)) return "兼容论点组";
  return "索引";
}

function buildPdfWikiObsidianSearchSnippet(content: string, query: string): string {
  const compact = content.replace(/^---[\s\S]*?---\s*/m, "").replace(/\s+/g, " ").trim();
  if (!compact) return "";
  const lower = compact.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const firstIndex = lower.indexOf(lowerQuery);
  const index = firstIndex >= 0 ? firstIndex : 0;
  const start = Math.max(0, index - 56);
  const end = Math.min(compact.length, index + Math.max(80, query.length + 72));
  return `${start > 0 ? "..." : ""}${compact.slice(start, end)}${end < compact.length ? "..." : ""}`;
}

async function searchPdfWikiObsidianVault(userId: string, rawQuery: string, limit = 30): Promise<{ vaultDir: string; results: PdfWikiObsidianSearchResult[] }> {
  const query = cleanPdfWikiMarkdownLine(rawQuery).toLowerCase();
  if (!query) throw new Error("请输入检索关键词");
  const vaultDir = getPdfWikiObsidianVaultDir(userId);
  const indexPath = path.join(vaultDir, `${PDF_WIKI_OBSIDIAN_ROOT_NAME}.md`);
  if (!fs.existsSync(indexPath)) {
    throw new Error("尚未部署内置 Obsidian 知识库，请先点击“部署 Obsidian”。");
  }
  const files = await listPdfWikiObsidianMarkdownFiles(vaultDir);
  const terms = query.split(/\s+/).map(term => term.trim()).filter(Boolean);
  const results: PdfWikiObsidianSearchResult[] = [];
  for (const filePath of files) {
    let content = "";
    try {
      content = await fs.promises.readFile(filePath, "utf-8");
    } catch (error) {
      continue;
    }
    const relativePath = path.relative(vaultDir, filePath).replace(/\\/g, "/");
    const title = path.basename(filePath, ".md");
    const haystack = `${relativePath}\n${content}`.toLowerCase();
    let score = haystack.includes(query) ? 12 : 0;
    for (const term of terms) {
      if (!term) continue;
      let pos = haystack.indexOf(term);
      while (pos >= 0) {
        score += term.length >= 2 ? 2 : 1;
        pos = haystack.indexOf(term, pos + term.length);
      }
    }
    if (score <= 0) continue;
    results.push({
      title,
      relativePath,
      type: inferPdfWikiObsidianNoteType(relativePath),
      snippet: buildPdfWikiObsidianSearchSnippet(content, rawQuery),
      score,
    });
  }
  results.sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath, "zh-CN"));
  return { vaultDir, results: results.slice(0, Math.max(1, Math.min(80, limit))) };
}

function sortPdfWikiSentencePointsForObsidian(points: PdfWikiSentencePoint[]): PdfWikiSentencePoint[] {
  const sectionOrder: Record<string, number> = { Introduction: 1, Discussion: 2, Conclusion: 3 };
  return points.slice().sort((a, b) =>
    String(a.sourcePdfName || "").localeCompare(String(b.sourcePdfName || ""), "zh-CN")
    || (sectionOrder[a.section] || 9) - (sectionOrder[b.section] || 9)
    || Number(a.sentenceIndex || 0) - Number(b.sentenceIndex || 0)
  );
}

function collectPdfWikiObsidianSourceDocuments(
  store: PdfWikiStore,
  points: PdfWikiSentencePoint[],
  entries: PdfWikiEntry[],
  pdfById: Map<string, PdfWikiSourcePdf>
): PdfWikiSourceDocument[] {
  const docs: PdfWikiSourceDocument[] = [];
  const seen = new Set<string>();
  const addDoc = (doc: PdfWikiSourceDocument): void => {
    const aliases = [doc.sourcePdfId, doc.sourcePdfName, doc.title].map(value => String(value || "").trim()).filter(Boolean);
    if (aliases.length === 0) return;
    const duplicate = aliases.some(alias => seen.has(alias.toLowerCase()));
    if (duplicate) return;
    aliases.forEach(alias => seen.add(alias.toLowerCase()));
    docs.push(doc);
  };

  store.pdfs.forEach(pdf => addDoc(serializePdfWikiSourcePdf(pdf)));
  points.forEach(point => {
    const pdf = pdfById.get(point.sourcePdfId);
    addDoc(pdf ? serializePdfWikiSourcePdf(pdf) : serializePdfWikiSourceName(point.sourcePdfId || point.sourcePdfName, point.sourcePdfName || point.sourcePdfId));
  });
  entries.forEach(entry => buildPdfWikiSourceDocuments(entry, pdfById).forEach(addDoc));
  return docs.sort((a, b) => String(a.title || a.sourcePdfName).localeCompare(String(b.title || b.sourcePdfName), "zh-CN"));
}

function collectPdfWikiObsidianTopics(store: PdfWikiStore, points: PdfWikiSentencePoint[]): PdfWikiObsidianTopicRecord[] {
  const topics = new Map<string, PdfWikiObsidianTopicRecord>();
  for (const cloud of store.sentenceCloud?.clouds || []) {
    const key = String(cloud.topicKey || cloud.id || cloud.label || "").trim();
    if (!key) continue;
    topics.set(key, { key, label: String(cloud.label || key), pointIds: [] });
  }
  for (const point of points) {
    const key = String(point.topicKey || point.topicLabel || "未分类").trim() || "未分类";
    const topic = topics.get(key) || { key, label: String(point.topicLabel || key), pointIds: [] };
    topic.pointIds.push(point.id);
    topics.set(key, topic);
  }
  return Array.from(topics.values()).sort((a, b) => b.pointIds.length - a.pointIds.length || a.label.localeCompare(b.label, "zh-CN"));
}

function buildPdfWikiObsidianSentenceNote(
  point: PdfWikiSentencePoint,
  context: {
    pdfNoteNameByAlias: Map<string, string>;
    topicNoteNameByAlias: Map<string, string>;
    entryNoteNameById: Map<string, string>;
    entryIdsByPointId: Map<string, string[]>;
  }
): string {
  const title = point.claimText || point.sentence || "句子论点";
  const refs = dedupePdfWikiReferences(point.references || []);
  const citations = Array.isArray(point.citations) ? point.citations.filter(Boolean) : [];
  const entryLinks = (context.entryIdsByPointId.get(point.id) || [])
    .map(entryId => {
      const noteName = context.entryNoteNameById.get(entryId);
      return noteName ? obsidianWikiLink(PDF_WIKI_OBSIDIAN_ENTRY_DIR, noteName) : "";
    })
    .filter(Boolean);
  const pdfLink = getPdfWikiObsidianPdfLink(point.sourcePdfId, point.sourcePdfName, context.pdfNoteNameByAlias);
  const topicLink = getPdfWikiObsidianTopicLink(point.topicKey, point.topicLabel, context.topicNoteNameByAlias);
  const frontmatter = formatPdfWikiObsidianFrontmatter({
    id: point.id,
    type: "pdf_wiki_sentence_claim",
    source_pdf: point.sourcePdfName || point.sourcePdfId,
    section: point.section,
    sentence_index: point.sentenceIndex,
    claim_candidate: point.claimCandidate,
    claim_type: point.claimType,
    topic: point.topicLabel || point.topicKey,
    confidence: point.confidence,
    match_method: point.matchMethod,
    citations,
    reference_count: refs.length,
    tags: [
      "pdf-wiki",
      "sentence-claim",
      `claim-${sanitizePdfWikiObsidianTag(point.claimType || "unknown")}`,
      `section-${sanitizePdfWikiObsidianTag(point.section || "unknown")}`,
    ],
  });

  return [
    frontmatter,
    `# ${cleanPdfWikiMarkdownLine(title)}`,
    "",
    `> ${cleanPdfWikiMarkdownBlockquote(point.sentence || "")}`,
    "",
    "## 论点",
    cleanPdfWikiMarkdownText(point.claimText || point.sentence || ""),
    "",
    "## 来源",
    `- PDF：${pdfLink}`,
    `- 章节：${cleanPdfWikiMarkdownLine(point.section || "未解析")} S${point.sentenceIndex ?? ""}`,
    `- 主题：${topicLink}`,
    `- 论点类型：${cleanPdfWikiMarkdownLine(point.claimType || "unknown")}`,
    `- 匹配方式：${cleanPdfWikiMarkdownLine(point.matchMethod || "unknown")}`,
    "",
    "## 论点判断",
    cleanPdfWikiMarkdownText(point.claimReason || "系统根据句子表达、章节位置和引用关系判定为可作论点。"),
    "",
    "## 文中引用",
    citations.length ? citations.map(item => `- ${cleanPdfWikiMarkdownLine(item)}`).join("\n") : "- 无",
    "",
    "## 兼容论点组",
    entryLinks.length ? entryLinks.map(link => `- ${link}`).join("\n") : "- 暂无反链到兼容论点组",
    "",
    "## 参考文献",
    refs.length ? refs.map((ref, index) => formatPdfWikiObsidianReference(ref, index)).join("\n") : "- 该句未匹配到 References 条目",
    "",
  ].join("\n");
}

function buildPdfWikiObsidianEntryNote(
  entry: PdfWikiEntry,
  context: {
    pdfNoteNameByAlias: Map<string, string>;
    pointNoteNameById: Map<string, string>;
  }
): string {
  const claim = entry.displayClaimZh || entry.normalizedClaim || entry.claim || "兼容论点组";
  const evidenceSentenceIds = collectPdfWikiEntryEvidenceSentenceIds(entry);
  const sentenceLinks = evidenceSentenceIds
    .map(pointId => {
      const noteName = context.pointNoteNameById.get(pointId);
      return noteName ? obsidianWikiLink(PDF_WIKI_OBSIDIAN_SENTENCE_DIR, noteName) : "";
    })
    .filter(Boolean);
  const sourceLinks = (entry.sourcePdfIds || []).map((pdfId, index) =>
    getPdfWikiObsidianPdfLink(pdfId, entry.sourcePdfNames?.[index] || pdfId, context.pdfNoteNameByAlias)
  );
  const frontmatter = formatPdfWikiObsidianFrontmatter({
    id: entry.id,
    type: "pdf_wiki_compatible_claim_group",
    source_pdfs: entry.sourcePdfNames || [],
    sections: entry.sections || [],
    updated_at: entry.updatedAt,
    tags: ["pdf-wiki", "compatible-claim-group"],
  });

  return [
    frontmatter,
    `# ${cleanPdfWikiMarkdownLine(claim)}`,
    "",
    "## 来源 PDF",
    sourceLinks.length ? Array.from(new Set(sourceLinks)).map(link => `- ${link}`).join("\n") : "- 未解析",
    "",
    "## 句子证据",
    sentenceLinks.length ? sentenceLinks.map(link => `- ${link}`).join("\n") : "- 暂无句子级证据反链",
    "",
    "## 支持观点",
    formatPdfWikiObsidianViewpoints(entry.pro),
    "",
    "## 中性观点",
    formatPdfWikiObsidianViewpoints(entry.neutral),
    "",
    "## 反对观点",
    formatPdfWikiObsidianViewpoints(entry.con),
    "",
    "## 参考文献",
    dedupePdfWikiReferences(entry.references || []).map((ref, index) => formatPdfWikiObsidianReference(ref, index)).join("\n") || "- 未解析",
    "",
  ].join("\n");
}

function buildPdfWikiObsidianTopicNote(
  topic: PdfWikiObsidianTopicRecord,
  points: PdfWikiSentencePoint[],
  pointNoteNameById: Map<string, string>
): string {
  const pointById = new Map(points.map(point => [point.id, point]));
  const linkedPoints = topic.pointIds
    .map(pointId => {
      const point = pointById.get(pointId);
      const noteName = pointNoteNameById.get(pointId);
      if (!point || !noteName) return "";
      return `- ${obsidianWikiLink(PDF_WIKI_OBSIDIAN_SENTENCE_DIR, noteName)} · ${cleanPdfWikiMarkdownLine(point.sourcePdfName || "")} · ${cleanPdfWikiMarkdownLine(point.section || "")} S${point.sentenceIndex ?? ""}`;
    })
    .filter(Boolean);
  const frontmatter = formatPdfWikiObsidianFrontmatter({
    type: "pdf_wiki_topic",
    topic_key: topic.key,
    sentence_count: linkedPoints.length,
    tags: ["pdf-wiki", "topic"],
  });

  return [
    frontmatter,
    `# ${cleanPdfWikiMarkdownLine(topic.label || topic.key)}`,
    "",
    "## 句子论点",
    linkedPoints.length ? linkedPoints.join("\n") : "- 暂无句子",
    "",
  ].join("\n");
}

function buildPdfWikiObsidianPdfNote(
  doc: PdfWikiSourceDocument,
  points: PdfWikiSentencePoint[],
  entries: PdfWikiEntry[],
  context: {
    pointNoteNameById: Map<string, string>;
    entryNoteNameById: Map<string, string>;
  }
): string {
  const aliases = new Set([doc.sourcePdfId, doc.sourcePdfName, doc.title].map(value => String(value || "").toLowerCase()).filter(Boolean));
  const pointLinks = points
    .filter(point => aliases.has(String(point.sourcePdfId || "").toLowerCase()) || aliases.has(String(point.sourcePdfName || "").toLowerCase()))
    .map(point => {
      const noteName = context.pointNoteNameById.get(point.id);
      return noteName ? `- ${obsidianWikiLink(PDF_WIKI_OBSIDIAN_SENTENCE_DIR, noteName)} · ${cleanPdfWikiMarkdownLine(point.section || "")} S${point.sentenceIndex ?? ""}` : "";
    })
    .filter(Boolean);
  const entryLinks = entries
    .filter(entry => (entry.sourcePdfIds || []).some(id => aliases.has(String(id || "").toLowerCase())) || (entry.sourcePdfNames || []).some(name => aliases.has(String(name || "").toLowerCase())))
    .map(entry => {
      const noteName = context.entryNoteNameById.get(entry.id);
      return noteName ? `- ${obsidianWikiLink(PDF_WIKI_OBSIDIAN_ENTRY_DIR, noteName)}` : "";
    })
    .filter(Boolean);
  const frontmatter = formatPdfWikiObsidianFrontmatter({
    type: "pdf_wiki_source_pdf",
    source_pdf_id: doc.sourcePdfId,
    source_pdf_name: doc.sourcePdfName,
    title: doc.title,
    authors: doc.authors,
    year: doc.year,
    journal: doc.journal,
    doi: doc.doi,
    tags: ["pdf-wiki", "source-pdf"],
  });

  return [
    frontmatter,
    `# ${cleanPdfWikiMarkdownLine(doc.title || doc.sourcePdfName || "PDF来源")}`,
    "",
    "## 元数据",
    `- 文件：${cleanPdfWikiMarkdownLine(doc.sourcePdfName || "")}`,
    `- 作者：${cleanPdfWikiMarkdownLine(doc.authors || "未解析")}`,
    `- 年份：${cleanPdfWikiMarkdownLine(doc.year || "未解析")}`,
    `- 期刊：${cleanPdfWikiMarkdownLine(doc.journal || "未解析")}`,
    `- DOI：${cleanPdfWikiMarkdownLine(doc.doi || "未解析")}`,
    "",
    "## 句子论点",
    pointLinks.length ? pointLinks.join("\n") : "- 暂无句子级论点",
    "",
    "## 兼容论点组",
    entryLinks.length ? Array.from(new Set(entryLinks)).join("\n") : "- 暂无兼容论点组",
    "",
  ].join("\n");
}

function buildPdfWikiObsidianIndexNote(context: {
  userId: string;
  generatedAt: string;
  exportedAt: string;
  points: PdfWikiSentencePoint[];
  entries: PdfWikiEntry[];
  topics: PdfWikiObsidianTopicRecord[];
  sourceDocs: PdfWikiSourceDocument[];
  pointNoteNameById: Map<string, string>;
  topicNoteNameByAlias: Map<string, string>;
  pdfNoteNameByAlias: Map<string, string>;
  entryNoteNameById: Map<string, string>;
}): string {
  const candidateCount = context.points.length;
  const topicLinks = context.topics
    .slice(0, 80)
    .map(topic => {
      const noteName = context.topicNoteNameByAlias.get(topic.key) || context.topicNoteNameByAlias.get(topic.label);
      return noteName ? `- ${obsidianWikiLink(PDF_WIKI_OBSIDIAN_TOPIC_DIR, noteName)} · ${topic.pointIds.length} 条` : "";
    })
    .filter(Boolean);
  const pdfLinks = context.sourceDocs
    .slice(0, 120)
    .map(doc => {
      const noteName = context.pdfNoteNameByAlias.get(doc.sourcePdfId) || context.pdfNoteNameByAlias.get(doc.sourcePdfName) || context.pdfNoteNameByAlias.get(doc.title);
      return noteName ? `- ${obsidianWikiLink(PDF_WIKI_OBSIDIAN_PDF_DIR, noteName, doc.title || doc.sourcePdfName)}` : "";
    })
    .filter(Boolean);
  const frontmatter = formatPdfWikiObsidianFrontmatter({
    type: "pdf_wiki_obsidian_export_index",
    user_id: context.userId,
    generated_at: context.generatedAt,
    exported_at: context.exportedAt,
    sentence_count: context.points.length,
    candidate_claim_count: candidateCount,
    entry_count: context.entries.length,
    topic_count: context.topics.length,
    pdf_count: context.sourceDocs.length,
    tags: ["pdf-wiki", "index"],
  });

  return [
    frontmatter,
    `# ${PDF_WIKI_OBSIDIAN_ROOT_NAME}`,
    "",
    "## 概览",
    `- 句子：${context.points.length}`,
    `- 可作为论点：${candidateCount}`,
    `- 兼容论点组：${context.entries.length}`,
    `- 主题：${context.topics.length}`,
    `- PDF：${context.sourceDocs.length}`,
    "",
    "## 主题入口",
    topicLinks.length ? topicLinks.join("\n") : "- 暂无主题",
    "",
    "## PDF 来源",
    pdfLinks.length ? pdfLinks.join("\n") : "- 暂无 PDF 来源",
    "",
    "## 文件夹",
    `- \`${PDF_WIKI_OBSIDIAN_SENTENCE_DIR}/\`：句子级论点 note`,
    `- \`${PDF_WIKI_OBSIDIAN_TOPIC_DIR}/\`：主题聚合 note`,
    `- \`${PDF_WIKI_OBSIDIAN_PDF_DIR}/\`：PDF 来源 note`,
    `- \`${PDF_WIKI_OBSIDIAN_ENTRY_DIR}/\`：旧版兼容论点组 note`,
    "",
  ].join("\n");
}

function collectPdfWikiEntryEvidenceSentenceIds(entry: PdfWikiEntry): string[] {
  const ids = new Set<string>();
  (entry.evidenceSentenceIds || []).forEach(id => {
    if (id) ids.add(id);
  });
  [...(entry.pro || []), ...(entry.neutral || []), ...(entry.con || [])].forEach(viewpoint => {
    (viewpoint.evidenceSentenceIds || []).forEach(id => {
      if (id) ids.add(id);
    });
  });
  return Array.from(ids);
}

function dedupePdfWikiReferences(references: PdfWikiReference[]): PdfWikiReference[] {
  const seen = new Set<string>();
  const result: PdfWikiReference[] = [];
  for (const ref of references) {
    const key = getPdfWikiReferenceKey(ref);
    const normalizedKey = key || JSON.stringify(ref);
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    result.push(ref);
  }
  return result;
}

function formatPdfWikiObsidianViewpoints(viewpoints: PdfWikiViewpoint[]): string {
  if (!Array.isArray(viewpoints) || viewpoints.length === 0) return "- 未解析";
  return viewpoints.map((viewpoint, index) => {
    const refs = dedupePdfWikiReferences(viewpoint.references || []);
    const lines = [
      `${index + 1}. ${cleanPdfWikiMarkdownLine(viewpoint.summary || viewpoint.evidence || "未命名观点")}`,
      viewpoint.evidence ? `   - 证据：${cleanPdfWikiMarkdownLine(viewpoint.evidence)}` : "",
      viewpoint.sourcePdfName ? `   - 来源：${cleanPdfWikiMarkdownLine(viewpoint.sourcePdfName)}` : "",
      viewpoint.section || viewpoint.location ? `   - 位置：${cleanPdfWikiMarkdownLine([viewpoint.section, viewpoint.location].filter(Boolean).join(" · "))}` : "",
      refs.length ? `   - 参考文献：${refs.map(ref => cleanPdfWikiMarkdownLine(ref.title || ref.raw || ref.doi || ref.id || "")).filter(Boolean).join("; ")}` : "",
    ].filter(Boolean);
    return lines.join("\n");
  }).join("\n");
}

function formatPdfWikiObsidianReference(ref: PdfWikiReference, index: number): string {
  const title = ref.title || ref.raw || ref.id || "未解析参考文献";
  const parts = [
    ref.authors,
    ref.year ? `(${ref.year})` : "",
    title,
    ref.journal,
    ref.doi ? `DOI: ${normalizePdfWikiDoi(ref.doi)}` : "",
  ].filter(Boolean).map(cleanPdfWikiMarkdownLine);
  return `${index + 1}. ${parts.join(". ")}`;
}

function getPdfWikiObsidianPdfLink(sourcePdfId: string | undefined, sourcePdfName: string | undefined, pdfNoteNameByAlias: Map<string, string>): string {
  const aliases = [sourcePdfId, sourcePdfName].map(value => String(value || "").trim()).filter(Boolean);
  for (const alias of aliases) {
    const noteName = pdfNoteNameByAlias.get(alias) || pdfNoteNameByAlias.get(alias.toLowerCase());
    if (noteName) return obsidianWikiLink(PDF_WIKI_OBSIDIAN_PDF_DIR, noteName, sourcePdfName || sourcePdfId || noteName);
  }
  return cleanPdfWikiMarkdownLine(sourcePdfName || sourcePdfId || "未解析 PDF");
}

function getPdfWikiObsidianTopicLink(topicKey: string | undefined, topicLabel: string | undefined, topicNoteNameByAlias: Map<string, string>): string {
  const aliases = [topicKey, topicLabel].map(value => String(value || "").trim()).filter(Boolean);
  for (const alias of aliases) {
    const noteName = topicNoteNameByAlias.get(alias) || topicNoteNameByAlias.get(alias.toLowerCase());
    if (noteName) return obsidianWikiLink(PDF_WIKI_OBSIDIAN_TOPIC_DIR, noteName, topicLabel || topicKey || noteName);
  }
  return cleanPdfWikiMarkdownLine(topicLabel || topicKey || "未分类");
}

function obsidianWikiLink(folder: string, noteName: string, alias?: string): string {
  const target = `${folder}/${noteName}`.replace(/\\/g, "/");
  const cleanAlias = sanitizePdfWikiObsidianLinkAlias(alias || "");
  if (cleanAlias && cleanAlias !== noteName) return `[[${target}|${cleanAlias}]]`;
  return `[[${target}]]`;
}

function sanitizePdfWikiObsidianLinkAlias(value: string): string {
  return String(value || "").replace(/[\]\|]/g, " ").replace(/\s+/g, " ").trim();
}

function reservePdfWikiObsidianNoteName(rawValue: string, fallback: string, usedNames: Set<string>, maxLength: number): string {
  const base = sanitizePdfWikiObsidianFilename(rawValue, fallback, maxLength);
  let candidate = base;
  let counter = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    const suffix = `-${counter}`;
    candidate = `${base.slice(0, Math.max(12, maxLength - suffix.length)).trim()}${suffix}`;
    counter += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

function sanitizePdfWikiObsidianFilename(value: string, fallback: string, maxLength: number): string {
  const compact = String(value || "").replace(/\s+/g, " ").trim() || fallback;
  let clean = compact
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/[. ]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) clean = fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(clean)) clean = `${clean}-note`;
  if (clean.length > maxLength) clean = clean.slice(0, maxLength).trim();
  return clean || fallback;
}

function sanitizePdfWikiObsidianTag(value: string): string {
  return String(value || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function formatPdfWikiObsidianFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) {
      const cleanItems = value.map(item => String(item || "").trim()).filter(Boolean);
      if (cleanItems.length === 0) {
        lines.push(`${key}: []`);
      } else {
        lines.push(`${key}:`);
        cleanItems.forEach(item => lines.push(`  - ${formatPdfWikiObsidianYamlScalar(item)}`));
      }
      continue;
    }
    lines.push(`${key}: ${formatPdfWikiObsidianYamlScalar(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function formatPdfWikiObsidianYamlScalar(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return JSON.stringify(String(value ?? ""));
}

function cleanPdfWikiMarkdownLine(value: unknown): string {
  return String(value || "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPdfWikiMarkdownText(value: unknown): string {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanPdfWikiMarkdownBlockquote(value: unknown): string {
  const text = cleanPdfWikiMarkdownText(value);
  return text.split("\n").map(line => line.trim()).filter(Boolean).join("\n> ");
}

function shortPdfWikiObsidianHash(value: string): string {
  return crypto.createHash("sha1").update(String(value || "pdf-wiki")).digest("hex").slice(0, 8);
}

function formatPdfWikiObsidianTimestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

const PDF_WIKI_FIGURE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".svg"]);

interface PdfWikiFigurePreview {
  name: string;
  url: string;
  number: string;
  title: string;
  caption: string;
  page: string;
  size: number;
  scope: "pdf" | "meta";
}

function getPdfWikiCodexExtractDir(userId: string, pdfId: string): string {
  return path.join(dataDir, "uploads", sanitizeUserId(userId), "pdf-wiki", "codex-extract", pdfId);
}

function getPdfWikiFigureScopeDirName(scope: unknown): "figures" | "meta-figures" {
  return String(scope || "").toLowerCase() === "meta" ? "meta-figures" : "figures";
}

function readPdfWikiFigureJson(jsonPath: string): Record<string, unknown> {
  try {
    if (!fs.existsSync(jsonPath)) return {};
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch (error) {
    logger.warn(`[PdfWiki] Failed to read figure metadata ${jsonPath}:`, error);
    return {};
  }
}

function firstPdfWikiString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function asPdfWikiRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function compactPdfWikiPlainText(value: unknown, maxChars = 0): string {
  const text = firstPdfWikiString(value)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[#>*_`~|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!maxChars || text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}...`;
}

function getPdfWikiAbstractFromSections(sections: unknown): string {
  if (!Array.isArray(sections)) return "";
  for (const item of sections) {
    const section = asPdfWikiRecord(item);
    const heading = compactPdfWikiPlainText(
      firstPdfWikiString(section.heading, section.title, section.name, section.section, section.inferred_section)
    ).toLowerCase();
    if (!heading) continue;
    if (!/(^abstract$|摘要|summary|概述)/i.test(heading)) continue;
    const text = firstPdfWikiString(section.text, section.content, section.markdown, section.summary, section.body);
    if (text) return text;
  }
  return "";
}

function extractPdfWikiAbstractFromText(text: unknown): string {
  const raw = firstPdfWikiString(text).replace(/\r/g, "\n");
  if (!raw.trim()) return "";
  const match = raw.match(/(?:^|\n)\s*(?:abstract|摘要)\s*[:：]?\s*([\s\S]{120,2400}?)(?=\n\s*(?:key\s*words?|keywords|关键词|introduction|1\s+introduction|引言|materials?|methods?|方法)\b|$)/i);
  return match ? match[1] : "";
}

function getPdfWikiMetaAbstract(metaData: unknown): string {
  const meta = asPdfWikiRecord(metaData);
  const direct = firstPdfWikiString(
    meta.abstract,
    meta.abstractText,
    meta.abstract_text,
    meta.paperAbstract,
    meta.paper_abstract,
    meta.summaryAbstract,
    meta.abstractCn,
    meta.abstract_cn,
    meta.abstractEn,
    meta.abstract_en,
    meta["摘要"]
  );
  return direct || getPdfWikiAbstractFromSections(meta.sections);
}

function buildPdfWikiManagedPdfAbstractPreview(
  pdf: PdfWikiSourcePdf,
  deepAnalysis?: Awaited<ReturnType<PdfWikiManager["getPdfDeepAnalysis"]>>
): string {
  const deep = asPdfWikiRecord(deepAnalysis);
  const deepMetadata = asPdfWikiRecord(deep.metadata);
  const abstractText = getPdfWikiMetaAbstract(pdf.metaData)
    || getPdfWikiMetaAbstract(deepMetadata)
    || extractPdfWikiAbstractFromText(deep.textPreview)
    || firstPdfWikiString(deep.textPreview, deep.summaryMarkdown);
  return compactPdfWikiPlainText(abstractText, 1600);
}

function isPdfWikiGarbledDisplayText(value: unknown): boolean {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!text) return false;
  if (/(?:Thffi|Thffifl|ffl'|GoFf|B9B6)/i.test(text)) return true;
  const visible = text.replace(/\s/g, "");
  if (visible.length < 12) return false;
  const controlCount = (text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
  const replacementCount = (text.match(/[\uFFFD□�]/g) || []).length;
  if (controlCount + replacementCount >= 2) return true;
  const readableCount = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  const suspiciousCount = (text.match(/[^\p{L}\p{N}\s.,;:!?'"()[\]{}<>/\\\-–—+±=%&·•°_]/gu) || []).length;
  if ((controlCount + replacementCount + suspiciousCount) / Math.max(visible.length, 1) > 0.18) return true;
  return readableCount / Math.max(visible.length, 1) < 0.35 && suspiciousCount >= 4;
}

function firstReadablePdfWikiText(...values: unknown[]): string {
  for (const value of values) {
    const text = compactPdfWikiPlainText(firstPdfWikiString(value), 2000);
    if (text && !isPdfWikiGarbledDisplayText(text)) return text;
  }
  return "";
}

function isPdfWikiNonScientificFigureRecord(record: Record<string, unknown>, fileName = ""): boolean {
  const text = [
    fileName,
    record.id,
    record.number,
    record.label,
    record.name,
    record.title,
    record.caption,
    record.description,
    record.note,
    record.ocr_text,
    record.ocrText,
    record.source,
    record.type,
  ].map(value => String(value || "")).join(" ").replace(/\s+/g, " ").toLowerCase();
  if (!text.trim()) return false;

  if (/(elsevier|springer|wiley|mdpi|frontiers|sciencedirect|publisher)\s+(logo|mark|brand)/i.test(text)) return true;
  if (/(logo|decorative|decoration|ornament|placeholder|misembedded|cover\s+page|journal\s+cover|front\s+cover|cover\s+image)/i.test(text)) return true;
  if (/(not\s+(?:a\s+)?scientific\s+figure|not\s+the\s+actual\s+figure|not\s+a\s+data\s+figure|not\s+.*with\s+data)/i.test(text)) return true;
  if (/(no\s+(?:axes|axis|labels?|numerical\s+data|numeric\s+data|data\s+visible|chart|graph|table\s+content)|cannot\s+extract\s+meaningful\s+data|no\s+meaningful\s+data)/i.test(text)) return true;

  const page = firstPdfWikiString(record.page, record.pages, record.page_number, record.pageNumber).toLowerCase();
  const isFirstPage = /^(?:p\.?\s*)?1$|^page\s*1$/.test(page);
  return isFirstPage && /(cover|logo|publisher|decorative|placeholder|sciencedirect|elsevier)/i.test(text);
}

function ensurePdfWikiMetaFigurePreviewCopies(userId: string, pdf: PdfWikiSourcePdf): void {
  const taskDir = getPdfWikiCodexExtractDir(userId, pdf.id);
  const sourceDir = path.join(taskDir, "figures");
  const targetDir = path.join(taskDir, "meta-figures");
  if (!fs.existsSync(sourceDir)) return;

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!PDF_WIKI_FIGURE_EXTENSIONS.has(ext) && ext !== ".json") continue;
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (fs.existsSync(targetPath)) continue;
      fs.copyFileSync(sourcePath, targetPath);
    }
  } catch (error) {
    logger.warn(`[PdfWiki] Failed to prepare meta figure copies for ${pdf.id}:`, error);
  }
}

function getPdfWikiFigurePreviews(userId: string, pdf: PdfWikiSourcePdf, scope: "pdf" | "meta" = "pdf"): PdfWikiFigurePreview[] {
  const figureDirName = getPdfWikiFigureScopeDirName(scope);
  const figureDir = path.join(getPdfWikiCodexExtractDir(userId, pdf.id), figureDirName);
  if (scope === "meta") {
    ensurePdfWikiMetaFigurePreviewCopies(userId, pdf);
  }
  if (!fs.existsSync(figureDir)) return [];

  try {
    return fs.readdirSync(figureDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && PDF_WIKI_FIGURE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN", { numeric: true }))
      .map(entry => {
        const filePath = path.join(figureDir, entry.name);
        const stat = fs.statSync(filePath);
        const baseName = entry.name.replace(/\.[^.]+$/, "");
        const meta = readPdfWikiFigureJson(path.join(figureDir, `${baseName}.json`));
        if (
          entry.name.toLowerCase() === "000_overview_diagram.svg"
          || firstPdfWikiString(meta.id) === "overview_diagram"
          || meta.is_overview_diagram === true
          || firstPdfWikiString(meta.is_overview_diagram).toLowerCase() === "true"
          || isPdfWikiNonScientificFigureRecord(meta, entry.name)
        ) {
          return null;
        }
        return {
          name: entry.name,
          url: `/api/pdf-wiki/pdfs/${encodeURIComponent(pdf.id)}/figures/${encodeURIComponent(entry.name)}?userId=${encodeURIComponent(userId)}${scope === "meta" ? "&scope=meta" : ""}`,
          number: firstPdfWikiString(meta.number, baseName),
          title: firstPdfWikiString(meta.title),
          caption: firstPdfWikiString(meta.caption),
          page: firstPdfWikiString(meta.page),
          size: stat.size,
          scope,
        };
      })
      .filter((item): item is PdfWikiFigurePreview => item !== null);
  } catch (error) {
    logger.warn(`[PdfWiki] Failed to list figures for ${pdf.id}:`, error);
    return [];
  }
}

interface BundledGetDataStatus {
  available: boolean;
  executable: string;
  bundledDir: string;
  installDir: string;
  candidates: string[];
  platform: NodeJS.Platform;
  officialDownloadUrl: string;
  downloadUrl: string;
  message: string;
}

const GETDATA_OFFICIAL_DOWNLOAD_URL = "https://getdata-graph-digitizer.com/download.html";
const GETDATA_DOWNLOAD_URL = "https://getdata-graph-digitizer.software.informer.com/download/";

function getElectronResourcesPath(): string {
  const electronProcess = process as NodeJS.Process & { resourcesPath?: string };
  return typeof electronProcess.resourcesPath === "string" && electronProcess.resourcesPath.trim()
    ? electronProcess.resourcesPath
    : "";
}

function getBundledGetDataDir(): string {
  const resourcesPath = getElectronResourcesPath();
  return resourcesPath
    ? path.join(resourcesPath, "tools", "getdata")
    : path.join(process.cwd(), "tools", "getdata");
}

function getWritableGetDataDir(): string {
  return path.join(dataDir, "tools", "getdata");
}

function getWritableGetDataSessionDir(userId: string): string {
  return path.join(getWritableGetDataDir(), "sessions", sanitizeUserId(userId));
}

function launchGetDataProcess(status: BundledGetDataStatus, args: string[]): void {
  const child = spawn(status.executable, args, {
    cwd: path.dirname(status.executable),
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

function getBundledGetDataCandidates(): string[] {
  const candidates = new Set<string>();
  const addExe = (value: unknown) => {
    if (typeof value === "string" && value.trim()) candidates.add(path.resolve(value.trim()));
  };
  const addDir = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    const dir = path.resolve(value.trim());
    candidates.add(path.join(dir, "GetData.exe"));
    candidates.add(path.join(dir, "GetData Graph Digitizer.exe"));
    candidates.add(path.join(dir, "GetDataGraphDigitizer.exe"));
  };

  addExe(process.env.GETDATA_EXE);
  addDir(getWritableGetDataDir());
  addDir(getBundledGetDataDir());
  addDir(path.join(process.cwd(), "tools", "getdata"));
  addDir(process.env.GETDATA_HOME);

  for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]) {
    if (!root) continue;
    addDir(path.join(root, "GetData Graph Digitizer"));
    addDir(path.join(root, "GetData"));
  }

  return Array.from(candidates);
}

function getBundledGetDataStatus(): BundledGetDataStatus {
  const bundledDir = getBundledGetDataDir();
  const installDir = getWritableGetDataDir();
  const candidates = getBundledGetDataCandidates();
  const executable = candidates.find(candidate => {
    try {
      return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
    } catch {
      return false;
    }
  }) || "";

  return {
    available: !!executable,
    executable,
    bundledDir,
    installDir,
    candidates,
    platform: process.platform,
    officialDownloadUrl: GETDATA_OFFICIAL_DOWNLOAD_URL,
    downloadUrl: GETDATA_DOWNLOAD_URL,
    message: executable
      ? "已检测到 GetData.exe，可从图像数字化复核界面直接启动。"
      : "未检测到 GetData.exe。GetData 官网安装包链接当前不可用，请点击“打开可用下载页”下载，安装后点击“选择 GetData.exe”复制到本软件目录；系统会自动重新检测。",
  };
}

function openSystemTarget(target: string, mode: "url" | "folder"): void {
  let command = "";
  let args: string[] = [];
  if (process.platform === "win32") {
    if (mode === "url") {
      command = "rundll32.exe";
      args = ["url.dll,FileProtocolHandler", target];
    } else {
      command = "explorer.exe";
      args = [target];
    }
  } else if (process.platform === "darwin") {
    command = "open";
    args = [target];
  } else {
    command = "xdg-open";
    args = [target];
  }
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
  child.unref();
}

function resolveGetDataImagePathFromBody(body: Record<string, unknown>): string {
  const userId = sanitizeUserId(body.userId || "web-user");
  let pdfId = typeof body.pdfId === "string" ? body.pdfId.trim() : "";
  let fileName = typeof body.figureFileName === "string" ? body.figureFileName.trim() : "";
  let scope = typeof body.scope === "string" ? body.scope.trim().toLowerCase() : "";
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl.trim() : "";

  if (imageUrl && (!pdfId || !fileName)) {
    try {
      const parsed = new URL(imageUrl, "http://localhost");
      const match = parsed.pathname.match(/^\/api\/pdf-wiki\/pdfs\/([^/]+)\/figures\/([^/]+)$/);
      if (match) {
        pdfId = decodeURIComponent(match[1]);
        fileName = decodeURIComponent(match[2]);
        scope = parsed.searchParams.get("scope") || scope;
      }
    } catch {
      // Ignore invalid URLs; caller can still launch GetData without an image.
    }
  }

  fileName = path.basename(fileName);
  if (!pdfId || !fileName || !PDF_WIKI_FIGURE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) return "";
  const figureDir = path.resolve(path.join(getPdfWikiCodexExtractDir(userId, pdfId), getPdfWikiFigureScopeDirName(scope)));
  const target = path.resolve(path.join(figureDir, fileName));
  if (target !== figureDir && !target.startsWith(`${figureDir}${path.sep}`)) return "";
  try {
    return fs.existsSync(target) && fs.statSync(target).isFile() ? target : "";
  } catch {
    return "";
  }
}

function serializePdfWikiManagedPdf(
  userId: string,
  pdf: PdfWikiSourcePdf,
  groupIds: string[] | undefined,
  deepAnalysis?: Awaited<ReturnType<PdfWikiManager["getPdfDeepAnalysis"]>>,
  favorite = false
): Record<string, unknown> {
  const inferred = inferPdfWikiSourceName(pdf.originalName);
  const normalizedGroupIds = Array.isArray(groupIds) ? groupIds : [];
  const title = firstReadablePdfWikiText(pdf.title, inferred.title, pdf.originalName) || pdf.originalName;
  const authors = firstReadablePdfWikiText(pdf.authors, inferred.authors);
  const journal = firstReadablePdfWikiText(pdf.journal, inferred.journal);
  const rawAbstractPreview = buildPdfWikiManagedPdfAbstractPreview(pdf, deepAnalysis);
  const abstractPreview = isPdfWikiGarbledDisplayText(rawAbstractPreview) ? "" : rawAbstractPreview;
  const searchText = compactPdfWikiPlainText([title, abstractPreview].filter(Boolean).join("\n"), 7000);
  return {
    id: pdf.id,
    originalName: pdf.originalName,
    fileName: pdf.fileName,
    size: pdf.size,
    title,
    authors,
    year: pdf.year || inferred.year || '',
    journal,
    doi: normalizePdfWikiDoi(pdf.doi || inferred.doi || ''),
    favorite,
    groupId: normalizedGroupIds[0] || '',
    groupIds: normalizedGroupIds,
    textLength: pdf.textLength || 0,
    parsedTextCachedAt: pdf.parsedTextCachedAt || '',
    processedAt: pdf.processedAt || '',
    sourceUrl: `/api/pdf-wiki/pdfs/${encodeURIComponent(pdf.id)}/source?userId=${encodeURIComponent(userId)}`,
    figurePreviews: getPdfWikiFigurePreviews(userId, pdf),
    abstractPreview,
    searchText,
    deepAnalysis: deepAnalysis || null,
  };
}

app.get("/api/pdf-wiki/pdfs", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const [status, store] = await Promise.all([
      pdfWikiManager.getStatus(userId),
      pdfWikiManager.getStore(userId),
    ]);
    const management = loadPdfWikiPdfManagement(dataDir, userId);
    const favoritePdfIds = getLibraryFavoriteSet(userId, "pdfWikiPdf");
    const validPdfIds = new Set(store.pdfs.map(pdf => pdf.id));
    const assignments = Object.fromEntries(
      Object.entries(management.assignments).filter(([pdfId]) => validPdfIds.has(pdfId))
    );
    const sortedPdfs = store.pdfs
      .slice()
      .sort((a, b) => a.originalName.localeCompare(b.originalName, "zh-CN"));
    const pdfs = await Promise.all(sortedPdfs.map(async pdf =>
      serializePdfWikiManagedPdf(
        userId,
        pdf,
        assignments[pdf.id],
        await pdfWikiManager.getPdfDeepAnalysis(userId, pdf.id),
        favoritePdfIds.has(pdf.id)
      )
    ));

    res.json({
      success: true,
      status,
      generatedAt: store.generatedAt,
      groups: management.groups,
      pdfs,
      pdfCount: pdfs.length,
      favoritePdfIds: Array.from(favoritePdfIds).filter(pdfId => validPdfIds.has(pdfId)),
    });
  } catch (error) {
    logger.error("[PdfWiki] PDF manager route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/getdata/status", async (_req: Request, res: Response) => {
  try {
    res.json({ success: true, data: getBundledGetDataStatus() });
  } catch (error) {
    logger.error("[PdfWiki] GetData status route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/pdfs/:pdfId/source", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const pdfId = String(req.params.pdfId || "").trim();
    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }

    const store = await pdfWikiManager.getStore(userId);
    const pdf = store.pdfs.find(item => item.id === pdfId);
    if (!pdf) {
      res.status(404).json({ success: false, error: "未找到该 PDF" });
      return;
    }
    if (!pdf.filePath || !fs.existsSync(pdf.filePath)) {
      res.status(404).json({ success: false, error: "PDF 原文件不存在，请重新上传" });
      return;
    }

    const originalFileName = path.basename(pdf.originalName || pdf.fileName || "source.pdf").replace(/["\r\n]/g, "");
    const asciiFileName = originalFileName.replace(/[^\x20-\x7E]+/g, "_").replace(/[\\/:*?"<>|]+/g, "_") || "source.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${asciiFileName}"; filename*=UTF-8''${encodeURIComponent(originalFileName)}`);
    res.sendFile(path.resolve(pdf.filePath));
  } catch (error) {
    logger.error("[PdfWiki] Source PDF route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

function cleanPdfReaderSelectedText(value: unknown, maxLength = 12000): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, maxLength);
}

function loadPdfReaderAssistantSoul(): string {
  const candidates = [
    path.join(process.cwd(), "configs", "souls", "pdf-reader-assistant.soul.md"),
    path.join(__dirname, "..", "..", "configs", "souls", "pdf-reader-assistant.soul.md"),
    path.join(__dirname, "..", "..", "..", "configs", "souls", "pdf-reader-assistant.soul.md"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, "utf-8").trim();
      }
    } catch {
      // Try next path.
    }
  }
  return [
    "你是 Scholar Harness 的论文阅读助手。",
    "请基于当前论文全文、当前选中文本和近 10 轮对话回答用户问题。",
    "必须严谨区分论文明确依据与推断，不要编造论文中没有的信息。",
    "输出中文，必要时保留英文术语并解释。",
  ].join("\n");
}

function loadPdfPaperAnalysisExpertSoul(): string {
  const candidates = [
    path.join(process.cwd(), "configs", "souls", "pdf-paper-analysis-expert.soul.md"),
    path.join(__dirname, "..", "..", "configs", "souls", "pdf-paper-analysis-expert.soul.md"),
    path.join(__dirname, "..", "..", "..", "configs", "souls", "pdf-paper-analysis-expert.soul.md"),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return fs.readFileSync(candidate, "utf-8").trim();
      }
    } catch {
      // Try next path.
    }
  }
  return loadPdfReaderAssistantSoul();
}

function cleanPdfReaderChatHistory(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-20)
    .map((item): Message | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = record.role === "assistant" ? "assistant" : (record.role === "user" ? "user" : null);
      if (!role) return null;
      const content = cleanPdfReaderSelectedText(record.content, 3000);
      if (!content) return null;
      return { role, content };
    })
    .filter((item): item is Message => !!item)
    .slice(-20);
}

type PdfReaderChatProvider = "secondary" | "primary" | "codex";

function normalizePdfReaderChatProvider(value: unknown): PdfReaderChatProvider {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "primary" || normalized === "大牛马" || normalized === "chatbridge" || normalized === "chat-bridge") return "primary";
  if (normalized === "codex" || normalized === "codex-cli" || normalized === "codex cli") return "codex";
  return "secondary";
}

function parsePdfReaderChatProviderMention(query: string, fallback: PdfReaderChatProvider): {
  provider: PdfReaderChatProvider;
  cleanedQuery: string;
  mention?: string;
} {
  const raw = String(query || "");
  const match = raw.match(/@(小牛马|大牛马|codex(?:\s*cli)?|Codex(?:\s*CLI)?|CODEX(?:\s*CLI)?|chatbridge|ChatBridge|chat-bridge|api|API)\s*/i);
  if (!match) {
    return { provider: fallback, cleanedQuery: raw.trim() };
  }
  const mention = match[1];
  const normalized = mention.toLowerCase().replace(/\s+/g, " ");
  let provider: PdfReaderChatProvider = fallback;
  if (normalized.startsWith("codex")) {
    provider = "codex";
  } else if (mention === "大牛马" || normalized === "chatbridge" || normalized === "chat-bridge") {
    provider = "primary";
  } else if (mention === "小牛马" || normalized === "api") {
    provider = "secondary";
  }
  return {
    provider,
    cleanedQuery: raw.replace(match[0], "").trim(),
    mention,
  };
}

function getPdfReaderChatProviderLabel(provider: PdfReaderChatProvider, model = ""): string {
  if (provider === "primary") return `大牛马${model ? ` (${model})` : ""}`;
  if (provider === "codex") return `Codex CLI${model ? ` (${model})` : ""}`;
  return `小牛马${model ? ` (${model})` : ""}`;
}

function truncatePdfReaderFullText(text: string, maxLength = 80000): string {
  const cleaned = cleanPdfReaderSelectedText(text, Math.max(maxLength * 2, maxLength));
  if (cleaned.length <= maxLength) return cleaned;
  const headLength = Math.floor(maxLength * 0.68);
  const tailLength = Math.floor(maxLength * 0.22);
  return [
    cleaned.slice(0, headLength),
    "\n\n[中间部分因上下文长度限制已省略，回答时不要把省略部分当作依据。]\n\n",
    cleaned.slice(-tailLength),
  ].join("");
}

async function loadPdfReaderLongTermMemoryContext(userId: string): Promise<string> {
  try {
    let memory = await loadUserMemory(userId);
    if (memory.entries.length === 0 && memory.conversations.length === 0 && userId !== "web-user") {
      const fallbackMemory = await loadUserMemory("web-user");
      if (fallbackMemory.entries.length > 0 || fallbackMemory.conversations.length > 0) {
        memory = fallbackMemory;
      }
    }

    const entries = getStructuredPreferredMemoryEntries(memory.entries)
      .filter(entry => cleanPdfReaderSelectedText(entry.value, 1));
    const entryByKey = new Map(entries.map(entry => [entry.key, entry]));
    const pickEntry = (keys: string[]) => {
      for (const key of keys) {
        const entry = entryByKey.get(key);
        if (entry && cleanPdfReaderSelectedText(entry.value, 1)) return entry;
      }
      return null;
    };
    const experimentSummary = pickEntry(["experiment_summary_structured", "experiment_summary"]);
    const dataSummary = pickEntry(["data_summary_structured", "data_summary"]);
    const priorityKeys = new Set([
      "experiment_summary_structured",
      "experiment_summary",
      "data_summary_structured",
      "data_summary",
    ]);
    const additionalEntries = entries
      .filter(entry => !priorityKeys.has(entry.key))
      .slice(0, 14)
      .map(entry => ({
        key: entry.key,
        value: cleanPdfReaderSelectedText(entry.value, 2600),
        source: entry.source,
        timestamp: entry.timestamp,
      }));
    const conversations = (memory.conversations || [])
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8)
      .map(conv => ({
        title: conv.title,
        summary: cleanPdfReaderSelectedText(conv.summary, 1200),
        keyTopics: conv.keyTopics || [],
        updatedAt: conv.updatedAt,
      }));

    if (!experimentSummary && !dataSummary && additionalEntries.length === 0 && conversations.length === 0) {
      return "当前用户暂无跨会话长期记录。";
    }

    return truncatePdfReaderFullText(JSON.stringify({
      userId: memory.userId || userId,
      updatedAt: memory.updatedAt,
      priorityResearchMemory: {
        instruction: "这两项是回答 PDF 论文与用户现有研究关系时的最高优先级长期记忆。",
        experimentSummary: experimentSummary
          ? {
              key: experimentSummary.key,
              value: cleanPdfReaderSelectedText(experimentSummary.value, 12000),
              source: experimentSummary.source,
              timestamp: experimentSummary.timestamp,
            }
          : null,
        dataSummary: dataSummary
          ? {
              key: dataSummary.key,
              value: cleanPdfReaderSelectedText(dataSummary.value, 12000),
              source: dataSummary.source,
              timestamp: dataSummary.timestamp,
            }
          : null,
      },
      additionalLongTermMemory: {
        instruction: "如用户问题涉及写作进度、目标期刊、研究主题、关键词、已完成章节等，可按需参考这些跨会话长期记忆。",
        entries: additionalEntries,
      },
      recentConversationSummaries: conversations,
    }, null, 2), 45000);
  } catch (error) {
    logger.warn("[PdfWikiReader] Failed to load long-term memory:", error);
    return "跨会话长期记录读取失败，本次回答不要假设其内容。";
  }
}

app.post("/api/pdf-wiki/reader/ai-read", async (req: Request, res: Response) => {
  try {
    const selectedText = cleanPdfReaderSelectedText(req.body.selectedText);
    if (!selectedText) {
      res.status(400).json({ success: false, error: "请先选中或粘贴需要 AI 阅读的原文" });
      return;
    }

    const pdfTitle = cleanPdfReaderSelectedText(req.body.pdfTitle, 300);
    const note = cleanPdfReaderSelectedText(req.body.note, 1200);
    const runtime = getDeepAnalysisSecondaryRuntimeConfig();
    if (!runtime.configured || !runtime.apiUrl || !runtime.apiKey || !runtime.model) {
      res.status(400).json({
        success: false,
        error: "请先在配置里填写小牛马 API 地址、Key 和模型名",
      });
      return;
    }

    const content = await callChatCompletion(
      {
        apiUrl: runtime.apiUrl,
        apiKey: runtime.apiKey,
        defaultModel: runtime.model,
        defaultTemperature: 0.2,
        label: runtime.label || "小牛马 API",
      },
      {
        model: runtime.model,
        maxTokens: 1800,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: [
              "你是严谨的学术 PDF 阅读助手。",
              "用户会提供 PDF 中选中的一段原文。",
              "请只基于这段文字工作，不要补充原文没有的信息。",
              "输出中文，结构固定为：",
              "## 翻译",
              "## 总结",
              "## 关键点",
              "## 术语/变量",
              "如果原文已经是中文，则“翻译”部分改为“中文整理”。",
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              pdfTitle ? `PDF 标题：${pdfTitle}` : "",
              note ? `用户备注：${note}` : "",
              "选中文本：",
              selectedText,
            ].filter(Boolean).join("\n\n"),
          },
        ],
      }
    );

    res.json({
      success: true,
      model: runtime.model,
      label: runtime.label,
      result: content,
    });
  } catch (error) {
    logger.error("[PdfWikiReader] AI read failed:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "AI 阅读失败" });
  }
});

app.get("/api/pdf-wiki/reader/chat-session", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const pdfId = String(req.query.pdfId || "").trim();
    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }

    const session = await pdfWikiManager.getPdfReaderChatSession(userId, pdfId);
    res.json({
      success: true,
      session,
      messageCount: session.messages.length,
    });
  } catch (error) {
    logger.error("[PdfWikiReader] Load AI chat session failed:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "读取 AI 会话历史失败" });
  }
});

app.post("/api/pdf-wiki/reader/chat", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfId = String(req.body?.pdfId || "").trim();
    const rawQuery = cleanPdfReaderSelectedText(req.body?.query, 4000);
    const selectedProvider = normalizePdfReaderChatProvider(req.body?.forceProvider || req.body?.provider || "secondary");
    const providerDecision = parsePdfReaderChatProviderMention(rawQuery, selectedProvider);
    const query = cleanPdfReaderSelectedText(providerDecision.cleanedQuery || rawQuery, 4000);
    const selectedText = cleanPdfReaderSelectedText(req.body?.selectedText, 12000);
    const history = cleanPdfReaderChatHistory(req.body?.history);

    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }
    if (!query) {
      res.status(400).json({ success: false, error: "请输入要追问的问题" });
      return;
    }
    const userSkillInvocation = await parseUserSkillInvocation(userId, query);
    const queryForTask = userSkillInvocation.cleanMessage || query;
    if (userSkillInvocation.invokedSkills.length > 0) {
      logger.info(`[UserSkills] PDF reader invoked skills: ${userSkillInvocation.invokedSkills.map(skill => `/${skill.trigger}`).join(", ")}`);
    }

    const runtime = getDeepAnalysisSecondaryRuntimeConfig();
    if (providerDecision.provider === "secondary" && (!runtime.configured || !runtime.apiUrl || !runtime.apiKey || !runtime.model)) {
      res.status(400).json({
        success: false,
        error: "请先在配置里填写小牛马 API 地址、Key 和模型名",
      });
      return;
    }

    const fullText = await pdfWikiManager.getPdfReaderFullText(userId, pdfId);
    if (!fullText) {
      res.status(404).json({ success: false, error: "未找到当前 PDF，请先上传并处理 PDF" });
      return;
    }

    const pdf = fullText.pdf;
    const soul = loadPdfPaperAnalysisExpertSoul();
    const paperText = truncatePdfReaderFullText(fullText.text, 90000);
    const longTermMemoryContext = await loadPdfReaderLongTermMemoryContext(userId);
    const paperInfo = [
      `标题：${pdf.title || pdf.originalName || ""}`,
      pdf.authors ? `作者：${pdf.authors}` : "",
      pdf.year ? `年份：${pdf.year}` : "",
      pdf.journal ? `期刊：${pdf.journal}` : "",
      pdf.doi ? `DOI：${pdf.doi}` : "",
      `全文来源：${fullText.parser}`,
      `全文字符数：${fullText.text.length}`,
    ].filter(Boolean).join("\n");

    const messages: Message[] = [
      {
        role: "system",
        content: soul,
      },
      {
        role: "user",
        content: [
          "以下是当前论文阅读上下文。后续回答必须优先基于这些内容。",
          "",
          "## 当前论文信息",
          paperInfo,
          "",
          "## 当前选中文本",
          selectedText || "用户当前没有选中特定文本。",
          "",
          "## 用户跨会话长期记录",
          longTermMemoryContext,
          "",
          userSkillInvocation.promptBlock ? "## 本轮自定义 Skill" : "",
          userSkillInvocation.promptBlock,
          userSkillInvocation.promptBlock ? "" : "",
          "## 当前论文全文/正文摘录",
          paperText || "当前没有可用正文文本。",
        ].join("\n"),
      },
      ...history,
      {
        role: "user",
        content: [
          "用户当前追问：",
          queryForTask,
          "",
          "请作为论文阅读助手回答。若回答依赖当前选中文本，请说明；若依赖全文上下文，也请说明。不要编造论文没有的信息。",
        ].join("\n"),
      },
    ];

    const chatBridgeConfig = loadChatBridgeMergedConfig();
    const primaryModel = firstNonEmptyString(chatBridgeConfig.primary?.model, process.env.PRIMARY_MODEL, currentModel);
    const codexModel = firstNonEmptyString(chatBridgeConfig.codex?.model, process.env.PDF_WIKI_CODEX_MODEL, process.env.CODEX_MODEL, "codex");
    const requestedModel = providerDecision.provider === "primary"
      ? primaryModel
      : (providerDecision.provider === "codex" ? codexModel : runtime.model);
    const content = await chatBridge.chat({
      model: providerDecision.provider === "codex" ? runtime.model : requestedModel,
      maxTokens: 2600,
      temperature: 0.2,
      messages,
      forceProvider: providerDecision.provider,
      apiUrl: providerDecision.provider === "secondary" || providerDecision.provider === "codex" ? runtime.apiUrl : undefined,
      apiKey: providerDecision.provider === "secondary" || providerDecision.provider === "codex" ? runtime.apiKey : undefined,
    });

    let savedSession: Awaited<ReturnType<PdfWikiManager["appendPdfReaderChatTurn"]>> | null = null;
    let chatSaveError = "";
    try {
      savedSession = await pdfWikiManager.appendPdfReaderChatTurn(userId, pdfId, queryForTask, content);
    } catch (saveError) {
      chatSaveError = (saveError as Error).message || String(saveError);
      logger.warn("[PdfWikiReader] Failed to persist AI chat session:", saveError);
    }

    res.json({
      success: true,
      model: requestedModel,
      label: getPdfReaderChatProviderLabel(providerDecision.provider, requestedModel),
      provider: providerDecision.provider,
      providerMention: providerDecision.mention || "",
      cleanedQuery: queryForTask,
      result: content,
      session: savedSession,
      chatSaved: !!savedSession,
      chatSaveError,
      context: {
        historyMessages: history.length,
        fullTextLength: fullText.text.length,
        sentTextLength: paperText.length,
        parser: fullText.parser,
        longTermMemoryLength: longTermMemoryContext.length,
        savedChatMessages: savedSession?.messages.length || 0,
      },
    });
  } catch (error) {
    logger.error("[PdfWikiReader] AI chat failed:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "AI 交流失败" });
  }
});

app.post("/api/pdf-wiki/reader/save-sentence-claim", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfId = String(req.body?.pdfId || "").trim();
    const sentence = cleanPdfReaderSelectedText(req.body?.sentence, 4000);
    const claimText = cleanPdfReaderSelectedText(req.body?.claimText, 1200);
    const pageNumber = Number(req.body?.pageNumber || 0);
    const rawSection = String(req.body?.section || "").trim();
    const section = rawSection === "Introduction" || rawSection === "Discussion" || rawSection === "Conclusion"
      ? rawSection
      : undefined;
    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }
    if (!sentence) {
      res.status(400).json({ success: false, error: "请先选中一句需要保存到论点库的原文" });
      return;
    }

    const result = await pdfWikiManager.addManualSentenceClaim(userId, pdfId, {
      sentence,
      claimText,
      pageNumber: Number.isFinite(pageNumber) && pageNumber > 0 ? pageNumber : undefined,
      section,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWikiReader] Save sentence claim failed:", error);
    res.status(500).json({ success: false, error: (error as Error).message || "保存到论点库失败" });
  }
});

app.post("/api/pdf-wiki/getdata/open-download-page", async (_req: Request, res: Response) => {
  try {
    openSystemTarget(GETDATA_DOWNLOAD_URL, "url");
    res.json({
      success: true,
      downloadUrl: GETDATA_DOWNLOAD_URL,
      officialDownloadUrl: GETDATA_OFFICIAL_DOWNLOAD_URL,
      message: "已打开 GetData Graph Digitizer 可用下载页。下载/安装完成后，点击“选择 GetData.exe”导入，系统会自动重新检测。",
      data: getBundledGetDataStatus(),
    });
  } catch (error) {
    logger.error("[PdfWiki] GetData download page route error:", error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      downloadUrl: GETDATA_DOWNLOAD_URL,
      officialDownloadUrl: GETDATA_OFFICIAL_DOWNLOAD_URL,
    });
  }
});

app.post("/api/pdf-wiki/getdata/open-folder", async (_req: Request, res: Response) => {
  try {
    const installDir = getWritableGetDataDir();
    fs.mkdirSync(installDir, { recursive: true });
    openSystemTarget(installDir, "folder");
    res.json({
      success: true,
      installDir,
      message: "已打开本软件的 GetData 目录。可将 GetData.exe 放入该目录，系统会自动重新检测。",
      data: getBundledGetDataStatus(),
    });
  } catch (error) {
    logger.error("[PdfWiki] GetData folder route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/getdata/import-exe", chatUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ success: false, error: "请选择已安装的 GetData.exe 文件" });
      return;
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (ext !== ".exe") {
      res.status(400).json({ success: false, error: "请选择 .exe 文件" });
      return;
    }
    const installDir = getWritableGetDataDir();
    fs.mkdirSync(installDir, { recursive: true });
    const target = path.join(installDir, "GetData.exe");
    fs.writeFileSync(target, file.buffer);
    const status = getBundledGetDataStatus();
    res.json({
      success: true,
      installDir,
      executable: target,
      data: status,
      message: "已把 GetData.exe 复制到本软件目录，后续会自动检测并启动。",
    });
  } catch (error) {
    logger.error("[PdfWiki] GetData exe import route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/getdata/launch", async (req: Request, res: Response) => {
  try {
    const status = getBundledGetDataStatus();
    if (!status.available || !status.executable) {
      res.status(404).json({ success: false, error: status.message, data: status });
      return;
    }

    const args: string[] = [];
    const imagePath = typeof req.body?.imagePath === "string" ? req.body.imagePath.trim() : "";
    if (imagePath) {
      const resolvedImagePath = path.resolve(imagePath);
      if (fs.existsSync(resolvedImagePath) && fs.statSync(resolvedImagePath).isFile()) {
        args.push(resolvedImagePath);
      }
    } else {
      const resolvedFromUrl = resolveGetDataImagePathFromBody(req.body as Record<string, unknown>);
      if (resolvedFromUrl) args.push(resolvedFromUrl);
    }

    launchGetDataProcess(status, args);

    res.json({
      success: true,
      data: { ...status, args },
      message: args.length
        ? "GetData 已启动，并已把当前图像路径传入。请在 GetData 中完成坐标轴校准和数据提取，导出 CSV/TXT/XLSX 后回填。"
        : "GetData 已启动。当前图像未能自动定位，请在 GetData 中手动打开左侧图片或下载后的图片。",
    });
  } catch (error) {
    logger.error("[PdfWiki] GetData launch route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/getdata/launch-image", chatUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const status = getBundledGetDataStatus();
    if (!status.available || !status.executable) {
      res.status(404).json({ success: false, error: status.message, data: status });
      return;
    }

    const file = req.file;
    if (!file || !file.buffer) {
      res.status(400).json({ success: false, error: "缺少需要交给 GetData 的当前图像" });
      return;
    }

    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const sessionDir = getWritableGetDataSessionDir(userId);
    fs.mkdirSync(sessionDir, { recursive: true });
    const label = sanitizeUploadFileName(String(req.body?.figureLabel || "current-figure.jpg")).replace(/\.[^.]+$/, "");
    const target = path.join(sessionDir, `${Date.now()}-${label}.jpg`);
    fs.writeFileSync(target, file.buffer);

    const args = [target];
    launchGetDataProcess(status, args);

    res.json({
      success: true,
      data: { ...status, args, imagePath: target },
      imagePath: target,
      message: "GetData 已打开当前复核图片。请在 GetData 中校准坐标轴，按处理/系列完成数据提取并导出 CSV/TXT/XLSX。",
    });
  } catch (error) {
    logger.error("[PdfWiki] GetData launch-image route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/pdfs/:pdfId/figures/:fileName", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const pdfId = String(req.params.pdfId || "").trim();
    const fileName = path.basename(String(req.params.fileName || ""));
    if (!pdfId || !fileName || fileName !== req.params.fileName) {
      res.status(400).json({ success: false, error: "图片路径无效" });
      return;
    }
    if (!PDF_WIKI_FIGURE_EXTENSIONS.has(path.extname(fileName).toLowerCase())) {
      res.status(400).json({ success: false, error: "不支持的图片格式" });
      return;
    }

    const store = await pdfWikiManager.getStore(userId);
    if (!store.pdfs.some(pdf => pdf.id === pdfId)) {
      res.status(404).json({ success: false, error: "未找到该 PDF" });
      return;
    }

    const figureDir = path.resolve(path.join(getPdfWikiCodexExtractDir(userId, pdfId), getPdfWikiFigureScopeDirName(req.query.scope)));
    const target = path.resolve(path.join(figureDir, fileName));
    if (target !== figureDir && !target.startsWith(`${figureDir}${path.sep}`)) {
      res.status(400).json({ success: false, error: "图片路径越界" });
      return;
    }
    if (!fs.existsSync(target)) {
      res.status(404).json({ success: false, error: "未找到该图片" });
      return;
    }
    res.sendFile(target);
  } catch (error) {
    logger.error("[PdfWiki] Figure file route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/pdf-wiki/meta", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || "web-user");
    const pdfId = typeof req.query.pdfId === "string" ? req.query.pdfId.trim() : "";
    const summaryOnly = req.query.summary === "1" || req.query.summaryOnly === "true";
    const [status, metaDatabase, store] = await Promise.all([
      pdfWikiManager.getStatus(userId),
      pdfWikiManager.getMetaDatabase(userId, {
        includeDetails: pdfId ? true : !summaryOnly,
        pdfIds: pdfId ? [pdfId] : undefined,
      }),
      pdfWikiManager.getStore(userId),
    ]);
    const pdfById = new Map(store.pdfs.map(pdf => [pdf.id, pdf]));
    metaDatabase.items = metaDatabase.items.map(item => {
      const pdf = pdfById.get(item.pdfId);
      return {
        ...item,
        figurePreviews: pdf ? getPdfWikiFigurePreviews(userId, pdf, "meta") : [],
      } as typeof item & { figurePreviews: PdfWikiFigurePreview[] };
    });
    res.json({
      success: true,
      status,
      ...metaDatabase,
      metaCount: metaDatabase.items.length,
    });
  } catch (error) {
    logger.error("[PdfWiki] Meta database route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/upload", handleLiteratureUpload, async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const files = (req.files as Express.Multer.File[] || []).filter(file => {
      const ext = path.extname(file.originalname || "").toLowerCase();
      return ext === ".pdf" || String(file.mimetype || "").toLowerCase().includes("pdf");
    });
    if (files.length === 0) {
      res.status(400).json({ success: false, error: "请上传 PDF 文件" });
      return;
    }

    syncPdfWikiRequestConfig(req.body as Record<string, unknown>);
    const pdfWikiLlm = getPdfWikiLlmRuntimeConfig();
    const taskConfig = parsePdfWikiTaskConfigFromBody({
      ...(req.body as Record<string, unknown>),
      pdfWikiMetaAnalysisEnabled: "true",
      pdfWikiMetaAnalysisEngine: req.body.pdfWikiMetaAnalysisEngine || "auto",
    });
    pdfWikiManager.processUploadedPdfsForMetaAnalysis(
      userId,
      files,
      buildPdfWikiRuntimeTaskConfig(pdfWikiLlm, {
        ...taskConfig,
        metaAnalysisEnabled: true,
        metaAnalysisEngine: taskConfig.metaAnalysisEngine === "off" ? "auto" : taskConfig.metaAnalysisEngine,
      }),
      { force: req.body.force === true || req.body.force === "true" }
    ).catch(error => {
      logger.error("[PdfWiki] Meta upload extraction failed:", error);
    });

    res.json({
      success: true,
      queuedCount: files.length,
      message: `已开始后台批量提取 ${files.length} 个 PDF 的 Meta 分析数据`,
      pdfWikiLlm: {
        configured: pdfWikiLlm.configured,
        label: pdfWikiLlm.label,
        codexAvailable: pdfWikiLlm.codexAvailable,
        textInConfigured: pdfWikiLlm.textInConfigured,
        liteParseAvailable: pdfWikiLlm.liteParseAvailable,
        markerAvailable: pdfWikiLlm.markerAvailable,
        fastTextAvailable: pdfWikiLlm.fastTextAvailable,
      },
    });
  } catch (error) {
    logger.error("[PdfWiki] Meta upload route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/extract", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfIds = Array.isArray(req.body?.pdfIds)
      ? req.body.pdfIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    if (pdfIds.length === 0) {
      res.status(400).json({ success: false, error: "请先选择需要批量提取 Meta 数据的 PDF" });
      return;
    }

    syncPdfWikiRequestConfig(req.body as Record<string, unknown>);
    const pdfWikiLlm = getPdfWikiLlmRuntimeConfig();
    const taskConfig = parsePdfWikiTaskConfigFromBody({
      ...(req.body as Record<string, unknown>),
      pdfWikiMetaAnalysisEnabled: "true",
      pdfWikiMetaAnalysisEngine: req.body?.pdfWikiMetaAnalysisEngine || "auto",
    });
    pdfWikiManager.extractMetaAnalysisForPdfs(
      userId,
      pdfIds,
      buildPdfWikiRuntimeTaskConfig(pdfWikiLlm, {
        ...taskConfig,
        metaAnalysisEnabled: true,
        metaAnalysisEngine: taskConfig.metaAnalysisEngine === "off" ? "auto" : taskConfig.metaAnalysisEngine,
      }),
      { force: req.body?.force === true || req.body?.force === "true" }
    ).catch(error => {
      logger.error("[PdfWiki] Meta batch extraction failed:", error);
    });

    res.json({
      success: true,
      queuedCount: pdfIds.length,
      message: `已开始后台批量提取 ${pdfIds.length} 个 PDF 的 Meta 分析数据`,
      pdfWikiLlm: {
        configured: pdfWikiLlm.configured,
        label: pdfWikiLlm.label,
        codexAvailable: pdfWikiLlm.codexAvailable,
        textInConfigured: pdfWikiLlm.textInConfigured,
        liteParseAvailable: pdfWikiLlm.liteParseAvailable,
        markerAvailable: pdfWikiLlm.markerAvailable,
        fastTextAvailable: pdfWikiLlm.fastTextAvailable,
      },
    });
  } catch (error) {
    logger.error("[PdfWiki] Meta batch extraction route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/figures/digitization/import", chatUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfId = String(req.body?.pdfId || "").trim();
    const file = req.file;
    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }
    if (!file || !file.buffer) {
      res.status(400).json({ success: false, error: "请上传 GetData 导出的 CSV/TXT/XLSX 文件" });
      return;
    }
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (![".csv", ".txt", ".tsv", ".xls", ".xlsx"].includes(ext)) {
      res.status(400).json({ success: false, error: "仅支持 CSV、TXT、TSV、XLS、XLSX 格式的 GetData 导出文件" });
      return;
    }

    let parameters: Record<string, unknown> = {};
    if (typeof req.body?.parameters === "string" && req.body.parameters.trim()) {
      try {
        const parsed = JSON.parse(req.body.parameters);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          parameters = parsed as Record<string, unknown>;
        }
      } catch {
        parameters = { raw: req.body.parameters };
      }
    }

    const result = await pdfWikiManager.importFigureDigitizationData(userId, pdfId, {
      fileName: file.originalname || `getdata-export${ext || ".csv"}`,
      buffer: file.buffer,
      figureKey: String(req.body?.figureKey || "").trim(),
      figureLabel: String(req.body?.figureLabel || "").trim(),
      tool: String(req.body?.tool || "GetData Graph Digitizer").trim(),
      notes: String(req.body?.notes || "").trim(),
      parameters,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Figure digitization import route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/delete", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfIds = Array.isArray(req.body?.pdfIds)
      ? req.body.pdfIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    if (pdfIds.length === 0) {
      res.status(400).json({ success: false, error: "请先勾选需要删除的 Meta 数据库条目" });
      return;
    }
    const result = await pdfWikiManager.deleteMetaDatabaseItems(userId, pdfIds);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Meta database delete route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/coding-table/delete", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfId = String(req.body?.pdfId || "").trim();
    const rowIndexes = Array.isArray(req.body?.rowIndexes)
      ? req.body.rowIndexes.map((index: unknown) => Number(index)).filter((index: number) => Number.isInteger(index) && index >= 0)
      : [];
    const columns = Array.isArray(req.body?.columns)
      ? req.body.columns.map((column: unknown) => String(column || "").trim()).filter(Boolean)
      : [];
    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }
    if (rowIndexes.length === 0 && columns.length === 0) {
      res.status(400).json({ success: false, error: "请先选择需要删除的行或列" });
      return;
    }
    const result = await pdfWikiManager.deleteMetaAnalysisCodingTableSelection(userId, pdfId, { rowIndexes, columns });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Meta coding table delete route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/coding-table/save", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfId = String(req.body?.pdfId || "").trim();
    const columns = Array.isArray(req.body?.columns)
      ? req.body.columns.map((column: unknown) => String(column || ""))
      : [];
    const rows = Array.isArray(req.body?.rows)
      ? req.body.rows.map((row: unknown) => row && typeof row === "object" && !Array.isArray(row)
        ? row as Record<string, unknown>
        : {})
      : [];
    if (!pdfId) {
      res.status(400).json({ success: false, error: "缺少 PDF ID" });
      return;
    }
    const result = await pdfWikiManager.saveMetaAnalysisCodingTable(userId, pdfId, { columns, rows });
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error("[PdfWiki] Meta coding table save route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/coding-table/columns", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const column = String(req.body?.column || "").trim();
    const afterColumn = String(req.body?.afterColumn || req.body?.beforeColumn || "").trim();
    if (!column) {
      res.status(400).json({ success: false, error: "请输入需要新建的列名" });
      return;
    }
    const template = await pdfWikiManager.addMetaAnalysisCodingColumn(userId, column, afterColumn);
    res.json({ success: true, column, afterColumn, template });
  } catch (error) {
    logger.error("[PdfWiki] Meta coding table column route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/meta/tables/export", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body?.userId || "web-user");
    const pdfIds = Array.isArray(req.body?.pdfIds)
      ? req.body.pdfIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    const tableIds = Array.isArray(req.body?.tableIds)
      ? req.body.tableIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];

    if (pdfIds.length > 0) {
      const dataTables = await pdfWikiManager.getIntegratedDataTablesForExport(userId, pdfIds);
      const readableTables = dataTables.filter(table => table.rows.length > 0);
      if (readableTables.length === 0) {
        res.status(404).json({ success: false, error: "未找到可导出的 PDF 整合数据表" });
        return;
      }

      const mainColumns = Array.from(new Set(readableTables.flatMap(table => table.columns)));
      const mainRows: unknown[][] = [
        mainColumns,
        ...readableTables.flatMap(table => table.rows.map(row => mainColumns.map(column => row[column] ?? ""))),
      ];
      const xlsx = await import("xlsx");
      const workbook = xlsx.utils.book_new();
      const sheet = xlsx.utils.aoa_to_sheet(mainRows);
      sheet["!cols"] = mainColumns.map(column => ({
        wch: Math.min(44, Math.max(12, String(column).length + 6)),
      }));
      xlsx.utils.book_append_sheet(workbook, sheet, "Meta分析数据库");

      const evidenceTables = await pdfWikiManager.getMetaEvidenceTablesForExport(userId, pdfIds);
      const readableEvidenceTables = evidenceTables.filter(table => table.rows.length > 0);
      if (readableEvidenceTables.length > 0) {
        const maxOriginalColumns = Math.max(1, ...readableEvidenceTables.flatMap(table => table.rows.map(row => Array.isArray(row) ? row.length : 1)));
        const evidenceHeader = [
          "PDF标题",
          "PDF文件名",
          "PDF ID",
          "表格ID",
          "表格标题",
          "页码",
          "表内行号",
          ...Array.from({ length: maxOriginalColumns }, (_, index) => `原表列${index + 1}`),
        ];
        const evidenceRows: unknown[][] = [evidenceHeader];
        for (const table of readableEvidenceTables) {
          table.rows.forEach((row, rowIndex) => {
            const originalCells = Array.isArray(row) ? row : [row];
            evidenceRows.push([
              table.pdfTitle || "",
              table.pdfName || "",
              table.pdfId || "",
              table.tableKey || table.id,
              table.title || table.label || "",
              table.page || "",
              rowIndex + 1,
              ...originalCells,
            ]);
          });
        }

        const evidenceSheet = xlsx.utils.aoa_to_sheet(evidenceRows);
        evidenceSheet["!cols"] = [
          { wch: 34 },
          { wch: 32 },
          { wch: 24 },
          { wch: 18 },
          { wch: 36 },
          { wch: 12 },
          { wch: 10 },
          ...Array.from({ length: maxOriginalColumns }, () => ({ wch: 18 })),
        ];
        xlsx.utils.book_append_sheet(workbook, evidenceSheet, "原始证据表");
      }

      const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
      const filename = `pdf-wiki-meta-analysis-data-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(buffer);
      return;
    }

    if (tableIds.length === 0) {
      res.status(400).json({ success: false, error: "请先勾选需要导出的 PDF 整合数据表" });
      return;
    }

    const tables = await pdfWikiManager.getMetaTablesForExport(userId, tableIds);
    const readableTables = tables.filter(table => table.rows.length > 0);
    if (readableTables.length === 0) {
      res.status(404).json({ success: false, error: "未找到可导出的表格数据。请确认 PDF 已经通过 Codex 提取出 tables/*.csv 或 tables/*.json" });
      return;
    }

    const maxOriginalColumns = Math.max(1, ...readableTables.flatMap(table => table.rows.map(row => Array.isArray(row) ? row.length : 1)));
    const header = [
      "PDF标题",
      "PDF文件名",
      "PDF ID",
      "表格ID",
      "表格标题",
      "页码",
      "表内行号",
      ...Array.from({ length: maxOriginalColumns }, (_, index) => `原表列${index + 1}`),
    ];
    const rows: unknown[][] = [header];
    for (const table of readableTables) {
      table.rows.forEach((row, rowIndex) => {
        const originalCells = Array.isArray(row) ? row : [row];
        rows.push([
          table.pdfTitle || "",
          table.pdfName || "",
          table.pdfId || "",
          table.tableKey || table.id,
          table.title || table.label || "",
          table.page || "",
          rowIndex + 1,
          ...originalCells,
        ]);
      });
    }

    const xlsx = await import("xlsx");
    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.aoa_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 34 },
      { wch: 32 },
      { wch: 24 },
      { wch: 18 },
      { wch: 36 },
      { wch: 12 },
      { wch: 10 },
      ...Array.from({ length: maxOriginalColumns }, () => ({ wch: 18 })),
    ];
    xlsx.utils.book_append_sheet(workbook, sheet, "PDF表格汇总");
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const filename = `pdf-wiki-tables-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);
  } catch (error) {
    logger.error("[PdfWiki] Meta table export route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdf-groups", (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const name = String(req.body.name || "").trim();
    const management = createPdfWikiPdfGroup(dataDir, userId, name);
    res.json({ success: true, groups: management.groups, assignments: management.assignments });
  } catch (error) {
    logger.error("[PdfWiki] Create PDF group route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.patch("/api/pdf-wiki/pdf-groups/:groupId", (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const name = String(req.body.name || "").trim();
    const management = renamePdfWikiPdfGroup(dataDir, userId, req.params.groupId, name);
    res.json({ success: true, groups: management.groups, assignments: management.assignments });
  } catch (error) {
    logger.error("[PdfWiki] Rename PDF group route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.delete("/api/pdf-wiki/pdf-groups/:groupId", (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.query.userId || req.body?.userId || "web-user");
    const management = deletePdfWikiPdfGroup(dataDir, userId, req.params.groupId);
    res.json({ success: true, groups: management.groups, assignments: management.assignments });
  } catch (error) {
    logger.error("[PdfWiki] Delete PDF group route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdfs/:pdfId/group", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const groupId = typeof req.body.groupId === "string" ? req.body.groupId : "";
    const rawGroupIds = Array.isArray(req.body.groupIds) ? req.body.groupIds : null;
    const store = await pdfWikiManager.getStore(userId);
    if (!store.pdfs.some(pdf => pdf.id === req.params.pdfId)) {
      res.status(404).json({ success: false, error: "未找到该 PDF" });
      return;
    }

    const management = rawGroupIds
      ? assignPdfWikiPdfGroups(dataDir, userId, req.params.pdfId, rawGroupIds.map((item: unknown) => String(item || "")))
      : assignPdfWikiPdfGroup(dataDir, userId, req.params.pdfId, groupId);
    res.json({ success: true, groups: management.groups, assignments: management.assignments });
  } catch (error) {
    logger.error("[PdfWiki] Assign PDF group route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdfs/:pdfId/groups", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const groupIds = Array.isArray(req.body.groupIds)
      ? req.body.groupIds.map((item: unknown) => String(item || ""))
      : [];
    const store = await pdfWikiManager.getStore(userId);
    if (!store.pdfs.some(pdf => pdf.id === req.params.pdfId)) {
      res.status(404).json({ success: false, error: "未找到该 PDF" });
      return;
    }

    const management = assignPdfWikiPdfGroups(dataDir, userId, req.params.pdfId, groupIds);
    res.json({ success: true, groups: management.groups, assignments: management.assignments });
  } catch (error) {
    logger.error("[PdfWiki] Assign PDF group route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdfs/:pdfId/favorite", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const pdfId = String(req.params.pdfId || "").trim();
    const favorite = req.body.favorite !== false;
    const store = await pdfWikiManager.getStore(userId);
    if (!store.pdfs.some(pdf => pdf.id === pdfId)) {
      res.status(404).json({ success: false, error: "未找到该 PDF" });
      return;
    }

    res.json({
      success: true,
      pdfId,
      ...toggleLibraryFavorite(userId, "pdfWikiPdf", pdfId, favorite),
    });
  } catch (error) {
    logger.error("[PdfWiki] Favorite PDF route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdfs/delete", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const pdfIds = Array.isArray(req.body.pdfIds)
      ? req.body.pdfIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    const result = await pdfWikiManager.deletePdfs(userId, pdfIds);
    const management = removePdfWikiPdfAssignments(dataDir, userId, pdfIds);
    const favorites = removeLibraryFavorites(userId, "pdfWikiPdf", pdfIds);
    res.json({
      success: true,
      ...result,
      groups: management.groups,
      assignments: management.assignments,
      favoritePdfIds: favorites.favoriteIds,
    });
  } catch (error) {
    logger.error("[PdfWiki] Delete PDFs route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdfs/:pdfId/reidentify", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const result = await pdfWikiManager.reidentifyPdfWithLiteParse(userId, req.params.pdfId);
    const management = loadPdfWikiPdfManagement(dataDir, userId);
    const favoritePdfIds = getLibraryFavoriteSet(userId, "pdfWikiPdf");
    res.json({
      success: true,
      message: result.message,
      pdf: serializePdfWikiManagedPdf(
        userId,
        result.pdf,
        management.assignments[result.pdf.id],
        await pdfWikiManager.getPdfDeepAnalysis(userId, result.pdf.id),
        favoritePdfIds.has(result.pdf.id)
      ),
      parser: result.parser,
      textLength: result.textLength,
      referenceCount: result.referenceCount,
      figureCount: result.figureCount,
      figureError: result.figureError || "",
    });
  } catch (error) {
    logger.error("[PdfWiki] Reidentify PDF route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/pdf-wiki/pdfs/:pdfId/deep-analysis", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const pdfWikiLlm = getPdfWikiLlmRuntimeConfig();
    const secondaryRuntime = getDeepAnalysisSecondaryRuntimeConfig();
    const codexDirectPdf = pdfWikiLlm.codexAvailable && isCodexCliPreferredForPdfWiki();

    if (!codexDirectPdf && !secondaryRuntime.configured) {
      res.status(400).json({ success: false, error: "请先启用 Codex CLI 优先，或在小牛马配置中填写 API 地址、Key 和模型名后再进行 PDF 深入分析" });
      return;
    }

    const result = await pdfWikiManager.analyzePdfDeep(userId, req.params.pdfId, {
      apiUrl: secondaryRuntime.configured ? secondaryRuntime.apiUrl : "",
      apiKey: secondaryRuntime.configured ? secondaryRuntime.apiKey : "",
      model: secondaryRuntime.model,
      textInApiUrl: pdfWikiLlm.textInApiUrl,
      textInAppId: pdfWikiLlm.textInAppId,
      textInSecretCode: pdfWikiLlm.textInSecretCode,
      textInParseMode: pdfWikiLlm.textInParseMode,
      dedicated: false,
      textExtractionEngine: "liteparse",
      deepAnalysisEngine: codexDirectPdf ? "auto" : "api",
    }, {
      force: req.body.force === true || req.body.force === "true",
    });
    const { pdf, ...analysisPayload } = result;
    const management = loadPdfWikiPdfManagement(dataDir, userId);
    const favoritePdfIds = getLibraryFavoriteSet(userId, "pdfWikiPdf");
    const researchSession = await recordPdfWikiDeepAnalysisResearchProvenance({
      userId,
      sessionId: cleanOptionalResearchSessionId(req.body.researchSessionId),
      pdfId: req.params.pdfId,
      pdf,
      analysisPayload,
    }).catch((error) => {
      logger.warn("[ResearchSession] Failed to record PDF Wiki deep-analysis provenance:", error);
      return undefined;
    });
    res.json({
      success: true,
      ...analysisPayload,
      pdf: serializePdfWikiManagedPdf(
        userId,
        pdf,
        management.assignments[pdf.id],
        analysisPayload,
        favoritePdfIds.has(pdf.id)
      ),
      researchSession,
    });
  } catch (error) {
    logger.error("[PdfWiki] Deep analysis route error:", error);
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

async function recordPdfWikiDeepAnalysisResearchProvenance(input: {
  userId: string;
  sessionId?: string;
  pdfId: string;
  pdf: PdfWikiSourcePdf;
  analysisPayload: Record<string, unknown>;
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactId: string; reviewerReportId: string }> {
  const pdfName = String(input.pdf.originalName || input.pdf.fileName || input.pdf.id || input.pdfId);
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.sessionId,
    sessionTitle: `PDF Wiki：${pdfName}`,
    targetType: 'pdf-wiki',
    targetId: input.pdfId,
    operation: 'pdf-wiki.deep-analysis',
    sourceModule: 'pdf-wiki',
    input: {
      pdfId: input.pdfId,
      pdfName,
    },
    output: input.analysisPayload,
    sources: [{
      id: input.pdfId,
      sourceType: 'pdf-wiki',
      title: pdfName,
      path: input.pdf.filePath,
      metadata: {
        status: input.analysisPayload.status,
        referenceCount: input.analysisPayload.referenceCount,
        figureCount: input.analysisPayload.figureCount,
      },
    }],
    metadata: {
      pdfId: input.pdfId,
      pdfName,
    },
  });
  const artifact = await researchSessionManager.appendArtifact({
    userId: input.userId,
    sessionId: provenance.session.id,
    kind: 'pdf-wiki',
    name: `${pdfName} deep analysis`,
    content: JSON.stringify(input.analysisPayload, null, 2),
    contentType: 'application/json',
    input: {
      pdfId: input.pdfId,
      pdfName,
    },
    provenanceRecordIds: [provenance.record.id],
    metadata: {
      pdfId: input.pdfId,
      pdfName,
    },
  });
  const review = await researchSessionManager.runReviewer(input.userId, provenance.session.id, artifact.artifact.id);
  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
    artifactId: artifact.artifact.id,
    reviewerReportId: review.report.id,
  };
}

app.post("/api/pdf-wiki/rebuild", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.body.userId || "web-user");
    const pdfWikiLlm = getPdfWikiLlmRuntimeConfig();
    const taskConfig = parsePdfWikiTaskConfigFromBody(req.body as Record<string, unknown>);

    if (!pdfWikiLlm.configured) {
      res.status(400).json({ success: false, error: "请先配置可用于论点抽取的 LLM API（千问 API 或小牛马 API），再重建 PDF Wiki" });
      return;
    }

    pdfWikiManager.rebuildFromSources(userId, buildPdfWikiRuntimeTaskConfig(pdfWikiLlm, taskConfig)).catch(error => {
      logger.error("[PdfWiki] Rebuild failed:", error);
    });

    res.json({ success: true, message: `PDF Wiki 已开始后台重建，将使用 ${pdfWikiLlm.label}` });
  } catch (error) {
    logger.error("[PdfWiki] Rebuild route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    model: primaryModel,
    dataDir,
  });
});

app.post("/api/reset", (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  conversationHistory.delete(userId);
  res.json({ ok: true });
});

app.get("/api/project-writing-profiles", (req: Request, res: Response) => {
  res.json({
    success: true,
    defaultProfileId: "paper-writing",
    profiles: PROJECT_WRITING_PROFILES.map((profile) => ({
      id: profile.id,
      label: profile.label,
      shortLabel: profile.shortLabel,
      topicLabel: profile.topicLabel,
      requirementLabel: profile.requirementLabel,
      oneClickTitle: profile.oneClickTitle,
      oneClickAction: profile.oneClickAction,
      documentType: profile.documentType,
      sections: profile.sections,
    })),
  });
});

app.post("/api/projects/new", async (req: Request, res: Response) => {
  try {
    const userId = String(req.body.userId || "web-user");
    const name = typeof req.body.name === "string" ? req.body.name : undefined;
    const writingProfileId = normalizeProjectWritingProfileId(req.body.writingProfileId);
    const clientState = req.body.clientState;

    const result = projectManager.createNewProject({ userId, name, writingProfileId, clientState });

    conversationHistory.delete(userId);
    await globalConversationFlow.resetUserSession(userId);
    retrievalEngineManager.clearAll();
    pdfWikiManager.clearAllEngines();
    globalRetrievalEngine = new HybridRetrievalEngine({
      vector: {
        model: currentEmbeddingConfig.model,
        dimensions: currentEmbeddingConfig.dimensions,
        topN: 50,
        similarity: 'cosine',
      }
    }, {
      url: currentEmbeddingConfig.url,
      key: currentEmbeddingConfig.key
    });
    globalConversationFlow.setRetrievalEngine(globalRetrievalEngine);
    setRetrievalEngine(globalRetrievalEngine);

    logger.info(`[Project] New clean workspace created for ${userId}; archived=${result.projectId}`);

    res.json({
      success: true,
      archivedProjectId: result.projectId,
      projectDir: result.projectDir,
      archivedPaths: result.archivedPaths,
      clearedPaths: result.clearedPaths,
      savedExistingProjectId: result.savedExistingProjectId,
      savedExistingProjectName: result.savedExistingProjectName,
      currentProject: projectManager.getCurrentProject(),
    });
  } catch (error) {
    logger.error("[Project] Failed to create new project:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

function resetActiveProjectRuntime(userId: string): void {
  conversationHistory.delete(userId);
  retrievalEngineManager.clearAll();
  pdfWikiManager.clearAllEngines();
  globalRetrievalEngine = new HybridRetrievalEngine({
    vector: {
      model: currentEmbeddingConfig.model,
      dimensions: currentEmbeddingConfig.dimensions,
      topN: 50,
      similarity: 'cosine',
    }
  }, {
    url: currentEmbeddingConfig.url,
    key: currentEmbeddingConfig.key
  });
  globalConversationFlow.setRetrievalEngine(globalRetrievalEngine);
  setRetrievalEngine(globalRetrievalEngine);
}

app.get("/api/projects", (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      projects: projectManager.listProjects(),
      currentProject: projectManager.getCurrentProject(),
    });
  } catch (error) {
    logger.error("[Project] Failed to list projects:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/projects/current", (req: Request, res: Response) => {
  try {
    res.json({ success: true, currentProject: projectManager.getCurrentProject() });
  } catch (error) {
    logger.error("[Project] Failed to resolve current project:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/projects/current/profile", (req: Request, res: Response) => {
  try {
    const writingProfileId = normalizeProjectWritingProfileId(req.body.writingProfileId);
    const currentProject = projectManager.setCurrentProjectWritingProfile(writingProfileId);
    res.json({ success: true, currentProject });
  } catch (error) {
    logger.error("[Project] Failed to update current project profile:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/projects/:projectId/open", async (req: Request, res: Response) => {
  try {
    const userId = String(req.body.userId || "web-user");
    const name = typeof req.body.name === "string" ? req.body.name : undefined;
    const skipBackup = req.body.skipBackup === true;
    const clientState = req.body.clientState;
    const result = projectManager.openProject(req.params.projectId, {
      userId,
      name,
      skipBackup,
      clientState,
    });

    await globalConversationFlow.resetUserSession(userId);
    resetActiveProjectRuntime(userId);

    res.json({
      success: true,
      projectId: result.projectId,
      projectDir: result.projectDir,
      backupProjectId: result.backupProjectId,
      backupProjectDir: result.backupProjectDir,
      savedCurrentProjectId: result.savedCurrentProjectId,
      savedCurrentProjectName: result.savedCurrentProjectName,
      restoredPaths: result.restoredPaths,
      clientState: result.clientState,
      currentProject: projectManager.getCurrentProject(),
    });
  } catch (error) {
    logger.error("[Project] Failed to open project:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.patch("/api/projects/:projectId", (req: Request, res: Response) => {
  try {
    const name = typeof req.body.name === "string" ? req.body.name : "";
    const project = projectManager.renameProject(req.params.projectId, name);
    res.json({ success: true, project });
  } catch (error) {
    logger.error("[Project] Failed to rename project:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.delete("/api/projects/:projectId", (req: Request, res: Response) => {
  try {
    projectManager.deleteProject(req.params.projectId);
    res.json({ success: true });
  } catch (error) {
    logger.error("[Project] Failed to delete project:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

function readUserLiteratureRecords(userId: string): LiteratureRecord[] {
  const litJsonFile = getUserLiteraturePath(userId);
  if (!fs.existsSync(litJsonFile)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8')) as unknown;
  const papers = Array.isArray(parsed)
    ? parsed
    : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { papers?: unknown }).papers)
      ? (parsed as { papers: unknown[] }).papers
      : []);

  return papers as LiteratureRecord[];
}

function getOuterTagsConfigPath(userId: string): string {
  return path.join(getUserUploadDir(userId), 'outer-tags-config.json');
}

function loadOuterTagsConfigForUser(userId: string): OuterTagsConfig {
  const configPath = getOuterTagsConfigPath(userId);
  if (!fs.existsSync(configPath)) {
    return { mergedTags: [], promotedTags: [] };
  }

  try {
    return sanitizeOuterTagsConfig(JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown);
  } catch (error) {
    logger.warn(`[EmbeddingLibrary] Failed to load outer tags config for ${userId}:`, error);
    return { mergedTags: [], promotedTags: [] };
  }
}

function saveOuterTagsConfigForUser(userId: string, config: OuterTagsConfig): OuterTagsConfig {
  const sanitized = sanitizeOuterTagsConfig(config);
  fs.writeFileSync(getOuterTagsConfigPath(userId), JSON.stringify(sanitized, null, 2), 'utf-8');
  return sanitized;
}

function refreshOuterTagCounts(papers: LiteratureRecord[], config: OuterTagsConfig): OuterTagsConfig {
  const refreshed = sanitizeOuterTagsConfig(config);
  for (const tag of refreshed.mergedTags) {
    const result = manualMergeKeywords(papers, tag.originalKeywords, tag.name);
    tag.count = result.count;
    tag.literatureIds = result.literatureIds;
  }
  return refreshed;
}

app.use("/api/embedding-library", createEmbeddingLibraryRouter({
  readUserLiteratureRecords,
  loadOuterTagsConfigForUser,
  saveOuterTagsConfigForUser,
  refreshOuterTagCounts,
}));

app.post("/api/oa-paper-download", async (req: Request, res: Response) => {
  try {
    const rawDois: unknown[] = Array.isArray(req.body?.dois)
      ? req.body.dois
      : [req.body?.doi];
    const dois: string[] = Array.from(new Set<string>(rawDois
      .map((doi: unknown) => String(doi || "").trim())
      .filter((doi): doi is string => !!doi)));
    if (dois.length === 0) {
      res.status(400).json({ success: false, error: "请提供 doi 或 dois" });
      return;
    }

    const downloadConcurrency = parseDownloadConcurrency(
      req.body?.downloadConcurrency ?? req.body?.concurrency ?? process.env.OA_PAPER_DOWNLOAD_CONCURRENCY,
      4
    );
    let results = await runConcurrent(dois, downloadConcurrency, async (doi) => downloadOpenAccessPaperByDoi(doi));
    const useInstitutionalDownload = req.body?.useInstitutionalDownload === true || req.body?.institutionalDownload === true || req.body?.institutionalAccess === true;
    if (useInstitutionalDownload) {
      const fallbackIndexes = results
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.status !== "downloaded");
      const fallbackResults = await runConcurrent(fallbackIndexes, Math.min(2, parseDownloadConcurrency(req.body?.institutionalConcurrency, 1)), async ({ item }) => {
        return downloadInstitutionalPaperByDoi(item.doi, {}, item.link || "");
      });
      fallbackResults.forEach((fallback, fallbackIndex) => {
        const targetIndex = fallbackIndexes[fallbackIndex]?.index;
        if (targetIndex === undefined) return;
        const current = results[targetIndex];
        if (fallback.status === "downloaded") {
          results[targetIndex] = fallback;
          return;
        }
        results[targetIndex] = {
          ...current,
          source: [current.source, fallback.source].filter(Boolean).join("; "),
          message: [current.message, fallback.message].filter(Boolean).join(" | 机构网络兜底："),
        };
      });
    }

    if (dois.length === 1 && req.query.format === "pdf") {
      const result = results[0];
      if (result.status !== "downloaded" || !result.buffer) {
        res.status(404).json({ success: false, error: result.message || "未找到开放获取 PDF", result });
        return;
      }
      const filename = `${String(result.doi || "paper").replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")}.pdf`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
      res.send(result.buffer);
      return;
    }

    res.json({
      success: true,
      source: BUILT_IN_OA_DOWNLOAD_SOURCE_LABEL,
      count: results.length,
      concurrency: downloadConcurrency,
      institutionalDownloadEnabled: useInstitutionalDownload,
      downloadedCount: results.filter(result => result.status === "downloaded").length,
      linkedCount: results.filter(result => result.status === "linked").length,
      failedCount: results.filter(result => result.status === "failed").length,
      results: results.map(result => ({
        doi: result.doi,
        status: result.status,
        link: result.link,
        source: result.source,
        message: result.message,
      })),
    });
  } catch (error) {
    logger.error("[OA Paper Download] Route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});


app.get("/api/literature", async (req: Request, res: Response) => {
  try {
    const userId = String(req.query.userId || "web-user");
    const litJsonFile = getUserLiteraturePath(userId);

    if (!fs.existsSync(litJsonFile)) {
      res.json({ success: false, papers: [], summary: null });
      return;
    }

    const parsed = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
    const papers = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.papers) ? parsed.papers : []);
    const years = [...new Set(papers.map((p: any) => p.year).filter(Boolean))].sort();
    const journals = [...new Set(papers.map((p: any) => p.journal).filter(Boolean))].slice(0, 10);
    const keywords = [...new Set(papers.flatMap((p: any): string[] => {
      const kw = p.keywords;
      if (Array.isArray(kw)) return kw.map(String);
      return String(kw || '').split(/[,;；，]/).map(k => k.trim()).filter(Boolean);
    }))].slice(0, 20);

    res.json({
      success: true,
      papers: papers.slice(0, 100),
      summary: {
        count: papers.length,
        years: years.map(String),
        journals,
        keywords,
      },
    });
  } catch (error) {
    logger.error("[Literature] Query route error:", error);
    res.json({ success: false, papers: [], summary: null, error: (error as Error).message });
  }
});

app.post("/api/literature/search", async (req: Request, res: Response) => {
  try {
    const userId = req.body.userId || "web-user";
    const query = req.body.query || "";
    const topK = Number(req.body.topK || 10);
    const mode = req.body.mode || "hybrid";

    if (!query || typeof query !== "string") {
      res.status(400).json({ success: false, error: "Query is required" });
      return;
    }

    const userEngine = await retrievalEngineManager.getEngine(userId);
    const variants = mode === "hybrid"
      ? buildBilingualRetrievalQueries({ sentence: query, keywordsEn: [query], keywordsCn: [query] })
      : [];
    if (variants.length > 1) {
      const settled = await Promise.all(variants.map(variant => userEngine.retrieve({
        query: variant.query,
        topK: Math.min(80, Math.max(topK * 4, 20)),
        searchMode: mode,
      })));
      const resultGroups = settled.map((item, index) => {
        const variant = variants[index];
        const mapped = item.results.map(doc => ({
          ...doc,
          retrievalPath: variant.label,
          retrievalLanguage: variant.language,
          retrievalQuery: variant.query,
        }));
        return filterRetrievedResultsForLanguage(mapped, variant.language, topK);
      });
      const results = interleaveRetrievedResultGroups(resultGroups, topK)
        .map((doc, index) => ({ ...doc, rank: index + 1 }));
      res.json({
        success: true,
        data: {
          query: formatRetrievalQueryVariants(variants),
          queryVariants: variants,
          languageGroups: variants.map((variant, index) => ({
            language: variant.language,
            label: variant.label,
            query: variant.query,
            totalCount: settled[index]?.totalCount || settled[index]?.results.length || 0,
            returned: resultGroups[index]?.length || 0,
            rawReturned: settled[index]?.results.length || 0,
            filteredOut: Math.max(0, (settled[index]?.results.length || 0) - (resultGroups[index]?.length || 0)),
            semanticUsed: (resultGroups[index] || []).some(item => Number(item.vectorScore || 0) > 0),
          })),
          totalCount: results.length,
          results,
          timing: {
            bm25Ms: settled.reduce((sum, item) => sum + item.timing.bm25Ms, 0),
            vectorMs: settled.reduce((sum, item) => sum + item.timing.vectorMs, 0),
            rerankMs: settled.reduce((sum, item) => sum + item.timing.rerankMs, 0),
            totalMs: settled.reduce((sum, item) => sum + item.timing.totalMs, 0),
          },
        },
      });
      return;
    }

    const result = await userEngine.retrieve({
      query: variants[0]?.query || query,
      topK,
      searchMode: mode,
    });

    res.json({ success: true, data: result });
  } catch (error) {
    logger.error("[Literature] Search route error:", error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

app.get("/api/literature/:userId", async (req: Request, res: Response) => {
  let userId = req.params.userId;
  // 使用统一的路径管理模块
  let litFile = getUserLiteratureTxtPath(userId);
  
  if (!fs.existsSync(litFile)) {
    const webUserLitFile = getUserLiteratureTxtPath('web-user');
    const webUserLitJsonFile = getUserLiteraturePath('web-user');
    if (fs.existsSync(webUserLitFile)) {
      const newUserDir = getUserUploadDir(userId);
      fs.copyFileSync(webUserLitFile, litFile);
      if (fs.existsSync(webUserLitJsonFile)) {
        const litJsonFile = getUserLiteraturePath(userId);
        fs.copyFileSync(webUserLitJsonFile, litJsonFile);
        logger.info("[Literature] Copied literature.json from web-user to " + userId);
      }
      logger.info("[Literature] Copied literature from web-user to " + userId);
    }
  }
  
  if (!fs.existsSync(litFile)) {
    const dirs = fs.readdirSync(uploadDir);
    for (const dir of dirs) {
      if (dir.startsWith("web-") && dir !== "web-user") {
        const oldLit = getUserLiteratureTxtPath(dir);
        const oldLitJson = getUserLiteraturePath(dir);
        if (fs.existsSync(oldLit)) {
          const newUserDir = getUserUploadDir(userId);
          fs.copyFileSync(oldLit, litFile);
          if (fs.existsSync(oldLitJson)) {
            const litJsonFile = getUserLiteraturePath(userId);
            fs.copyFileSync(oldLitJson, litJsonFile);
            logger.info("[Literature] Migrated literature.json from " + dir + " to " + userId);
          }
          logger.info("[Literature] Migrated literature from " + dir + " to " + userId);
          break;
        }
      }
    }
  }
  
  const userDir = getUserUploadDir(userId);
  const journalStyleDir = path.join(userDir, "journal-styles");
  let journalStyles: string[] = [];
  
  if (fs.existsSync(journalStyleDir)) {
    const styleFolders = fs.readdirSync(journalStyleDir);
    for (const folder of styleFolders) {
      const stylePath = path.join(journalStyleDir, folder, "style.json");
      if (fs.existsSync(stylePath)) {
        try {
          const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
          if (Array.isArray(styleData) && styleData.length > 0) {
            const journalName = styleData[0]?.journal || folder;
            journalStyles.push(`${journalName} (${styleData.length}篇)`);
          }
        } catch (e) {
          logger.warn("[Literature] Failed to read style:", folder);
        }
      }
    }
  }
  
  if (journalStyles.length === 0 && userId !== "web-user") {
    const webUserStyleDir = path.join(getUserUploadDir('web-user'), "journal-styles");
    if (fs.existsSync(webUserStyleDir)) {
      const styleFolders = fs.readdirSync(webUserStyleDir);
      for (const folder of styleFolders) {
        const stylePath = path.join(webUserStyleDir, folder, "style.json");
        if (fs.existsSync(stylePath)) {
          try {
            const styleData = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
            if (Array.isArray(styleData) && styleData.length > 0) {
              const journalName = styleData[0]?.journal || folder;
              journalStyles.push(`${journalName} (${styleData.length}篇)`);
            }
          } catch (e) {
            logger.warn("[Literature] Failed to read style from web-user:", folder);
          }
        }
      }
    }
  }
  
  if (!fs.existsSync(litFile)) {
    if (journalStyles.length > 0) {
      res.json({ 
        exists: false, 
        summary: { count: 0, years: [], journals: [], keywords: [] },
        content: '',
        journalStyles 
      });
    } else {
      res.json({ exists: false });
    }
    return;
  }
  
  let content = '';
  let summary = { count: 0, years: [] as string[], journals: [] as string[], keywords: [] as string[] };
  
  if (fs.existsSync(litFile)) {
    content = fs.readFileSync(litFile, 'utf-8');
    summary = getLitSummary(content);
  }
  
  const litJsonFile = getUserLiteraturePath(userId);
  if (fs.existsSync(litJsonFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(litJsonFile, 'utf-8'));
      const litData = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.papers) ? parsed.papers : []);
      if (litData.length > 0) {
        summary.count = litData.length;
        const years = [...new Set(litData.map((p: any) => p.year).filter(Boolean))].sort();
        const journals = [...new Set(litData.map((p: any) => p.journal).filter(Boolean))];
        const keywords = [...new Set(litData.flatMap((p: any): string[] => {
          const kw = p.keywords;
          if (Array.isArray(kw)) return kw as string[];
          return (kw || '').split(/[,;]/).map((k: string) => k.trim()).filter(Boolean) as string[];
        }))] as string[];
        summary.years = years.map(String) as string[];
        summary.journals = journals.slice(0, 10) as string[];
        summary.keywords = keywords.slice(0, 20) as string[];
        
        if (!content) {
          content = `文献库: ${litData.length} 篇文献`;
        }
      }
    } catch (e) {
      logger.warn("[Literature] Failed to parse literature.json:", e);
    }
  }
  
  res.json({ exists: true, summary, content, journalStyles });
});

app.get("/api/backups/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  try {
    const backups = await backupManager.listBackups(userId);
    res.json({ success: true, backups });
  } catch (error) {
    logger.error(`[Backups] Failed to list backups for ${userId}:`, error);
    res.status(500).json({ success: false, error: 'Failed to list backups' });
  }
});

app.post("/api/backups/create/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  try {
    const backupPath = await backupManager.createBackup(userId);
    if (backupPath) {
      res.json({ success: true, message: 'Backup created successfully', path: backupPath });
    } else {
      res.status(400).json({ success: false, error: 'No data to backup' });
    }
  } catch (error) {
    logger.error(`[Backups] Failed to create backup for ${userId}:`, error);
    res.status(500).json({ success: false, error: 'Failed to create backup' });
  }
});

app.post("/api/backups/restore", async (req: Request, res: Response) => {
  const { backupName, userId } = req.body;
  try {
    const success = await backupManager.restoreBackup(backupName, userId);
    if (success) {
      res.json({ success: true, message: 'Backup restored successfully' });
    } else {
      res.status(400).json({ success: false, error: 'Failed to restore backup' });
    }
  } catch (error) {
    logger.error(`[Backups] Failed to restore backup ${backupName}:`, error);
    res.status(500).json({ success: false, error: 'Failed to restore backup' });
  }
});

app.post("/api/chat", chatUpload.none(), async (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const userMessage = req.body.message || "";
  const history = JSON.parse(req.body.history || "[]");
  
  // Override API config from frontend if provided (per-request)
  if (req.body.apiUrl) currentApiUrl = req.body.apiUrl;
  if (req.body.apiKey) currentApiKey = req.body.apiKey;
  if (req.body.model) currentModel = req.body.model;
  if (req.body.webSearchKey) currentWebSearchKey = req.body.webSearchKey;
  
  try {
    // 传递外部历史给 processChatMessage
    const response = await processChatMessage(userId, userMessage, history.length > 0 ? history : undefined);
    const conversationId = req.body.conversationId || `conv-${Date.now()}`;
    res.json({ response, conversationId });
  } catch (error) {
    logger.error("[Chat] Error:", error);
    res.json({ error: "处理请求时出错: " + (error as Error).message });
  }
});

app.get("/api/memory/:userId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const memory = await loadUserMemory(userId);
  res.json({ 
    success: true,
    memory: {
      entries: memory.entries,
      conversations: memory.conversations,
      count: memory.conversations.length
    }
  });
});

app.get("/api/memory/:userId/search", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const query = req.query.q as string;
  
  if (!query) {
    res.json({ results: [] });
    return;
  }
  
  const results = searchConversations(userId, query);
  res.json({ results, query });
});

app.get("/api/memory/:userId/conversation/:conversationId", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const conversationId = req.params.conversationId;
  const conversation = loadConversation(userId, conversationId);
  
  if (!conversation) {
    res.status(404).json({ error: 'Conversation not found' });
    return;
  }
  
  res.json({ success: true, conversation });
});

app.get("/api/skill/:chapterType", (req: Request, res: Response) => {
  const chapterType = req.params.chapterType;
  const normalizedChapterType = normalizeSkillChapterType(chapterType);
  const skillContent = loadWritingSkill(normalizedChapterType);
  
  if (!skillContent) {
    res.status(404).json({ error: 'Skill not found', chapterType });
    return;
  }
  
  res.json({ 
    success: true, 
    chapterType: normalizedChapterType,
    content: skillContent,
    length: skillContent.length
  });
});

app.get("/api/skills", (req: Request, res: Response) => {
  const skills = [
    { type: 'title', file: '01_title_skill.md' },
    { type: 'abstract', file: '02_abstract_skill.md' },
    { type: 'introduction', file: '03_introduction_skill.md' },
    { type: 'methods', file: '04_methods_skill.md' },
    { type: 'results', file: '05_results_skill.md' },
    { type: 'figures', file: '06_figures_tables_skill.md' },
    { type: 'discussion', file: '07_discussion_skill.md' },
    { type: 'conclusion', file: '08_conclusion_skill.md' },
    { type: 'additional', file: '09_additional_statements_skill.md' },
    { type: 'reference-relevance', file: '10_reference_relevance_constraint_skill.md' }
  ];
  
  res.json({ success: true, skills });
});

const JOURNAL_STYLES_DIR = path.join(getUserUploadDir('web-user'), "journal-styles");

interface JournalStyleListEntry {
  id: string;
  name: string;
  path: string;
  paperCount: number;
  updatedAt: string;
  updatedAtMs: number;
  sourceUserId: string;
}

function normalizeJournalStyleUserId(value: unknown): string {
  const userId = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  return userId || "web-user";
}

function isSafeJournalStyleId(value: string): boolean {
  return !!value
    && value.length <= 120
    && value !== "."
    && value !== ".."
    && !value.includes("..")
    && !/[\\/:*?"<>|\x00-\x1F]/.test(value);
}

function getJournalStyleDirsForUser(userId: string): Array<{ dir: string; sourceUserId: string }> {
  const dirs = [
    { dir: path.join(getUserUploadDir(userId), "journal-styles"), sourceUserId: userId },
  ];
  if (userId !== "web-user") {
    dirs.push({ dir: JOURNAL_STYLES_DIR, sourceUserId: "web-user" });
  }

  const seen = new Set<string>();
  return dirs.filter((item) => {
    const key = path.resolve(item.dir).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function listJournalStyleEntries(userId = "web-user"): JournalStyleListEntry[] {
  const entries: JournalStyleListEntry[] = [];
  const seenIds = new Set<string>();

  for (const source of getJournalStyleDirsForUser(userId)) {
    if (!fs.existsSync(source.dir)) continue;
    const names = fs.readdirSync(source.dir).filter((name) => {
      if (!isSafeJournalStyleId(name)) return false;
      const fullPath = path.join(source.dir, name);
      try {
        return fs.statSync(fullPath).isDirectory();
      } catch {
        return false;
      }
    });

    for (const id of names) {
      if (seenIds.has(id)) continue;
      const folderPath = path.join(source.dir, id);
      const stylePath = path.join(folderPath, "style.json");
      if (!fs.existsSync(stylePath)) continue;
      try {
        const stat = fs.statSync(folderPath);
        const rawContent = fs.readFileSync(stylePath, "utf-8");
        const styleData = JSON.parse(rawContent) as any[];
        const materialCount = Array.isArray(styleData) ? styleData.length : 0;
        const paperCount = Array.isArray(styleData)
          ? styleData.filter((item) => cleanReviewText(item?.paper_title, '')).length
          : 0;
        const hasSubmissionRequirements = Array.isArray(styleData)
          && styleData.some((item) => item?.submission_materials?.has_author_guidelines || item?.submission_materials?.has_cover_letter_requirements);
        const journalName = Array.isArray(styleData) && styleData.length > 0
          ? cleanReviewText(styleData[0]?.journal, id.replace(/_/g, " "))
          : id.replace(/_/g, " ");
        seenIds.add(id);
        entries.push({
          id,
          name: paperCount > 0
            ? `${journalName} (${paperCount}篇${hasSubmissionRequirements ? '+投稿规范' : ''})`
            : `${journalName} (${hasSubmissionRequirements ? '投稿规范' : `${materialCount}项材料`})`,
          path: stylePath,
          paperCount,
          updatedAt: stat.mtime.toISOString(),
          updatedAtMs: stat.mtimeMs,
          sourceUserId: source.sourceUserId,
        });
      } catch (error) {
        logger.warn("[JournalStyle] Failed to list style:", id, error);
      }
    }
  }

  return entries.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}

function findJournalStyleEntry(userId: string, journalStyleId: string): JournalStyleListEntry | null {
  const id = String(journalStyleId || "").trim();
  if (!isSafeJournalStyleId(id)) return null;
  return listJournalStyleEntries(userId).find((item) => item.id === id) || null;
}

app.get("/api/journal-styles/list", (req: Request, res: Response) => {
  try {
    const userId = normalizeJournalStyleUserId(req.query.userId);
    const journals = listJournalStyleEntries(userId);
    res.json({ success: true, journals });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to list journal styles' });
  }
});

app.get("/api/journal-styles/:journal/:section", (req: Request, res: Response) => {
  const { journal, section } = req.params;
  const userId = normalizeJournalStyleUserId(req.query.userId);
  const styleEntry = findJournalStyleEntry(userId, journal);
  
  if (!styleEntry || !fs.existsSync(styleEntry.path)) {
    res.status(404).json({ success: false, error: 'Journal style not found' });
    return;
  }
  
  try {
    const content = fs.readFileSync(styleEntry.path, 'utf-8');
    const styles = JSON.parse(content) as any[];
    
    const sectionStyles: any[] = [];
    
    for (const paper of styles) {
      const extracted: any = {
        journal: paper.journal,
        section: section
      };
      
      const sectionLength = getFirstJournalStyleSectionValue(paper.structure_features?.section_lengths, section);
      if (sectionLength) extracted.length = sectionLength;
      
      const commonVerbs = getFirstJournalStyleSectionValue(paper.lexical_patterns?.common_verbs, section);
      const sectionDetail = getFirstJournalStyleSectionValue(paper.section_features, section);
      if (commonVerbs || sectionDetail?.common_verbs) {
        extracted.common_verbs = commonVerbs || sectionDetail.common_verbs;
      }
      
      const commonPhrases = getFirstJournalStyleSectionValue(paper.lexical_patterns?.common_phrases, section);
      if (commonPhrases || sectionDetail?.common_phrases) {
        extracted.common_phrases = commonPhrases || sectionDetail.common_phrases;
      }
      
      if (paper.argument_pattern) {
        if (section.toLowerCase() === 'introduction' && paper.argument_pattern.introduction_flow) {
          extracted.flow = paper.argument_pattern.introduction_flow;
        }
        if (section.toLowerCase() === 'results' && paper.argument_pattern.results_presentation) {
          extracted.presentation = paper.argument_pattern.results_presentation;
        }
        if (section.toLowerCase() === 'discussion' && paper.argument_pattern.discussion_emphasis) {
          extracted.emphasis = paper.argument_pattern.discussion_emphasis;
        }
      }
      
      if (paper.overall_style) {
        extracted.style = paper.overall_style;
      }
      
      const toneFeatures = normalizeJournalStyleToneFeatures(paper);
      if (toneFeatures) {
        extracted.tone = toneFeatures;
      }
      
      sectionStyles.push(extracted);
    }
    
    const styleGuide = generateSectionStyleGuide(section, styles, content);
    
    res.json({ 
      success: true, 
      journal: styleEntry.id,
      journalName: styleEntry.name,
      section,
      styleGuide,
      rawStyles: sectionStyles
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to parse journal style' });
  }
});

const JOURNAL_STYLE_SECTION_ALIASES: Record<string, string[]> = {
  abstract: ['abstract'],
  introduction: ['introduction', 'intro'],
  methods: ['methods', 'materials_and_methods', 'materials_and_methods_section', 'methodology'],
  results: ['results', 'result'],
  discussion: ['discussion'],
  conclusion: ['conclusion', 'conclusions'],
};

function getJournalStyleSectionKeys(section: string): string[] {
  const normalized = String(section || '').trim().toLowerCase();
  return JOURNAL_STYLE_SECTION_ALIASES[normalized] || [normalized];
}

function getFirstJournalStyleSectionValue(container: any, section: string): any {
  if (!container || typeof container !== 'object') return null;
  for (const key of getJournalStyleSectionKeys(section)) {
    if (container[key] !== undefined && container[key] !== null) {
      return container[key];
    }
  }
  return null;
}

function normalizeJournalStyleToneFeatures(paper: any): any {
  const tone = paper?.tone_features;
  if (!tone || typeof tone !== 'object') return null;
  if (tone.tone_features && typeof tone.tone_features === 'object') {
    return {
      ...tone.tone_features,
      common_hedging_words: tone.tone_features.common_hedging_words || tone.common_hedging_words,
    };
  }
  return tone;
}

function normalizeJournalStyleSyntaxFeatures(paper: any): any {
  if (paper?.syntax_features && typeof paper.syntax_features === 'object') {
    return paper.syntax_features;
  }
  const nestedSyntax = paper?.tone_features?.syntax_features;
  return nestedSyntax && typeof nestedSyntax === 'object' ? nestedSyntax : null;
}

function addJournalStyleStringArrayValues(target: Set<string>, values: unknown): void {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    const cleaned = String(value || '').trim();
    if (cleaned) target.add(cleaned);
  }
}

function generateSectionStyleGuide(section: string, styles: any[], rawContent: string): string {
  if (styles.length === 0) return '暂无风格数据';
  
  const parts: string[] = [`# ${section.toUpperCase()} 章节写作风格指南\n\n`];
  const allVerbs = new Set<string>();
  const allPhrases = new Set<string>();
  const allRules: string[] = [];
  const allHedgingWords = new Set<string>();
  const allTransitionWords = new Set<string>();
  
  let sectionDetail: any = null;
  let overallStyle: any = null;
  let toneFeatures: any = null;
  let syntaxFeatures: any = null;
  let tenseDist: any = null;
  let voiceDist: any = null;
  let argumentPattern: any = null;
  let citationFormat: any = null;
  let structureFeatures: any = null;
  let authorGuidelines: any = null;
  let coverLetterRequirements: any = null;
  
  const parsed = JSON.parse(rawContent) as any[];
  
  for (const paper of parsed) {
    const paperSectionDetail = getFirstJournalStyleSectionValue(paper.section_features, section);
    const paperToneFeatures = normalizeJournalStyleToneFeatures(paper);
    const paperSyntaxFeatures = normalizeJournalStyleSyntaxFeatures(paper);

    if (paperSectionDetail && !sectionDetail) sectionDetail = paperSectionDetail;
    if (paper.overall_style && !overallStyle) overallStyle = paper.overall_style;
    if (paperToneFeatures && !toneFeatures) toneFeatures = paperToneFeatures;
    if (paperSyntaxFeatures && !syntaxFeatures) syntaxFeatures = paperSyntaxFeatures;
    if (!tenseDist) tenseDist = getFirstJournalStyleSectionValue(paper.tense_distribution, section);
    if (!voiceDist) voiceDist = getFirstJournalStyleSectionValue(paper.voice_distribution, section);
    if (paper.argument_pattern && !argumentPattern) argumentPattern = paper.argument_pattern;
    if (paper.citation_format && !citationFormat) citationFormat = paper.citation_format;
    if (paper.structure_features && !structureFeatures) structureFeatures = paper.structure_features;
    if (paper.author_guidelines && !authorGuidelines) authorGuidelines = paper.author_guidelines;
    if (paper.cover_letter_requirements && !coverLetterRequirements) coverLetterRequirements = paper.cover_letter_requirements;
    if (paper.transferable_rules && allRules.length === 0) allRules.push(...paper.transferable_rules);
    
    addJournalStyleStringArrayValues(allVerbs, getFirstJournalStyleSectionValue(paper.lexical_patterns?.common_verbs, section));
    addJournalStyleStringArrayValues(allVerbs, paperSectionDetail?.common_verbs);
    addJournalStyleStringArrayValues(allPhrases, getFirstJournalStyleSectionValue(paper.lexical_patterns?.common_phrases, section));
    addJournalStyleStringArrayValues(allPhrases, paperSectionDetail?.common_phrases);
    addJournalStyleStringArrayValues(allHedgingWords, paperToneFeatures?.common_hedging_words);
    if (paper.lexical_patterns?.transition_words) {
      paper.lexical_patterns.transition_words.forEach((w: string) => allTransitionWords.add(w));
    }
  }
  
  if (overallStyle) {
    parts.push('## 📋 整体风格\n');
    if (overallStyle.formality) parts.push(`- **正式程度**: ${overallStyle.formality}\n`);
    if (overallStyle.argument_tone) parts.push(`- **论证基调**: ${overallStyle.argument_tone}\n`);
    if (overallStyle.hedging_frequency) parts.push(`- **模糊限制词频率**: ${overallStyle.hedging_frequency}\n`);
    if (overallStyle.summary) parts.push(`\n**风格概述**: ${overallStyle.summary}\n`);
    parts.push('\n');
  }
  
  if (sectionDetail) {
    if (sectionDetail.purpose) parts.push(`## 🎯 章节目的\n${sectionDetail.purpose}\n\n`);
    if (sectionDetail.typical_moves && sectionDetail.typical_moves.length > 0) {
      parts.push('## 📝 典型结构步骤\n');
      sectionDetail.typical_moves.forEach((move: string, i: number) => parts.push(`${i + 1}. **${move}**\n`));
      parts.push('\n');
    }
  }
  
  const sectionLength = getFirstJournalStyleSectionValue(structureFeatures?.section_lengths, section);
  if (sectionLength) parts.push(`## 📏 建议长度\n${sectionLength}\n\n`);
  if (sectionDetail?.sentence_style) parts.push(`## ✍️ 句子风格\n${sectionDetail.sentence_style}\n\n`);
  if (sectionDetail?.tense) parts.push(`## ⏰ 时态要求\n${sectionDetail.tense}\n\n`);
  if (sectionDetail?.voice) parts.push(`## 🔊 语态要求\n${sectionDetail.voice}\n\n`);
  
  if (tenseDist) {
    parts.push('## 📊 时态分布\n');
    const tenses = [['present', '一般现在时'], ['past', '一般过去时'], ['future', '一般将来时'], ['present_perfect', '现在完成时']];
    tenses.forEach(([key, label]) => {
      if (tenseDist[key]) parts.push(`- **${label}**: ${tenseDist[key]}%\n`);
    });
    parts.push('\n');
  }
  
  if (voiceDist) {
    parts.push('## 📊 语态分布\n');
    if (voiceDist.active) parts.push(`- **主动语态**: ${voiceDist.active}%\n`);
    if (voiceDist.passive) parts.push(`- **被动语态**: ${voiceDist.passive}%\n`);
    parts.push('\n');
  }
  
  if (allVerbs.size > 0) parts.push('## 🔤 常用动词\n' + Array.from(allVerbs).map(v => `\`${v}\``).join(', ') + '\n\n');
  if (allPhrases.size > 0) {
    parts.push('## 💬 常用句式\n');
    Array.from(allPhrases).forEach(p => parts.push(`- ${p}\n`));
    parts.push('\n');
  }
  if (allHedgingWords.size > 0) parts.push('## ⚠️ 模糊限制词（学术谨慎表达）\n' + Array.from(allHedgingWords).map(w => `\`${w}\``).join(', ') + '\n\n');
  if (allTransitionWords.size > 0) parts.push('## 🔗 过渡词\n' + Array.from(allTransitionWords).map(w => `\`${w}\``).join(', ') + '\n\n');
  
  if (section === 'introduction' && argumentPattern?.introduction_flow) parts.push(`## 🔄 引言结构流程\n${argumentPattern.introduction_flow}\n\n`);
  if (section === 'results' && argumentPattern?.results_presentation) parts.push(`## 📊 结果呈现方式\n${argumentPattern.results_presentation}\n\n`);
  if (section === 'discussion' && argumentPattern?.discussion_emphasis) {
    parts.push('## 💡 讨论重点\n');
    argumentPattern.discussion_emphasis.forEach((item: string) => parts.push(`- ${item}\n`));
    parts.push('\n');
  }
  
  if (syntaxFeatures) {
    parts.push('## 📐 句法特征\n');
    if (syntaxFeatures.average_sentence_length) parts.push(`- **平均句长**: ${syntaxFeatures.average_sentence_length}\n`);
    if (syntaxFeatures.sentence_complexity) {
      const comps = [];
      if (syntaxFeatures.sentence_complexity.simple) comps.push(`简单句 ${syntaxFeatures.sentence_complexity.simple}%`);
      if (syntaxFeatures.sentence_complexity.compound) comps.push(`并列句 ${syntaxFeatures.sentence_complexity.compound}%`);
      if (syntaxFeatures.sentence_complexity.complex) comps.push(`复合句 ${syntaxFeatures.sentence_complexity.complex}%`);
      parts.push(`- **句子复杂度**: ${comps.join(', ')}\n`);
    }
    if (syntaxFeatures.frequent_structures) parts.push(`- **常见结构**: ${syntaxFeatures.frequent_structures.join('、')}\n`);
    if (syntaxFeatures.information_density) parts.push(`- **信息密度**: ${syntaxFeatures.information_density}\n`);
    parts.push('\n');
  }
  
  if (toneFeatures) {
    parts.push('## 🎭 语气特征\n');
    if (toneFeatures.objectivity_level) parts.push(`- **客观程度**: ${toneFeatures.objectivity_level}\n`);
    if (toneFeatures.confidence_level) parts.push(`- **信心程度**: ${toneFeatures.confidence_level}\n`);
    if (toneFeatures.emphasis_pattern) parts.push(`- **强调模式**: ${toneFeatures.emphasis_pattern}\n`);
    parts.push('\n');
  }
  
  if (citationFormat) {
    parts.push('## 📚 引用格式\n');
    if (citationFormat.in_text_style) parts.push(`- **文内引用**: ${citationFormat.in_text_style}\n`);
    if (citationFormat.reference_example || citationFormat.example) parts.push(`- **示例**: \`${citationFormat.reference_example || citationFormat.example}\`\n`);
    if (citationFormat.reference_style) parts.push(`- **参考文献格式**: ${citationFormat.reference_style}\n`);
    if (citationFormat.citation_frequency) parts.push(`- **引用频率**: ${citationFormat.citation_frequency}\n`);
    parts.push('\n');
  }

  if (authorGuidelines) {
    parts.push('## 🧾 期刊官网 Author Guidelines\n');
    if (authorGuidelines.source_url) parts.push(`- **来源 URL**: ${authorGuidelines.source_url}\n`);
    if (authorGuidelines.article_type) parts.push(`- **文章类型**: ${authorGuidelines.article_type}\n`);
    if (authorGuidelines.word_limit) parts.push(`- **字数限制**: ${authorGuidelines.word_limit}\n`);
    const titleAbstractKeywords = Array.isArray(authorGuidelines.title_abstract_keywords_requirements)
      ? authorGuidelines.title_abstract_keywords_requirements
      : [];
    if (titleAbstractKeywords.length > 0) {
      parts.push('- **标题/摘要/关键词要求**:\n');
      titleAbstractKeywords.slice(0, 8).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    const sectionRequirements = getFirstJournalStyleSectionValue(authorGuidelines.section_requirements, section);
    if (Array.isArray(sectionRequirements) && sectionRequirements.length > 0) {
      parts.push(`- **${section} 章节要求**:\n`);
      sectionRequirements.slice(0, 8).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (Array.isArray(authorGuidelines.formatting_requirements) && authorGuidelines.formatting_requirements.length > 0) {
      parts.push('- **格式要求**:\n');
      authorGuidelines.formatting_requirements.slice(0, 10).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (Array.isArray(authorGuidelines.figure_table_requirements) && authorGuidelines.figure_table_requirements.length > 0) {
      parts.push('- **图表要求**:\n');
      authorGuidelines.figure_table_requirements.slice(0, 8).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (Array.isArray(authorGuidelines.reference_requirements) && authorGuidelines.reference_requirements.length > 0) {
      parts.push('- **参考文献要求**:\n');
      authorGuidelines.reference_requirements.slice(0, 8).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (Array.isArray(authorGuidelines.data_ethics_reporting_requirements) && authorGuidelines.data_ethics_reporting_requirements.length > 0) {
      parts.push('- **数据/伦理/声明要求**:\n');
      authorGuidelines.data_ethics_reporting_requirements.slice(0, 8).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (Array.isArray(authorGuidelines.submission_checklist) && authorGuidelines.submission_checklist.length > 0) {
      parts.push('- **提交前检查项**:\n');
      authorGuidelines.submission_checklist.slice(0, 8).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (authorGuidelines.source_text_excerpt && !authorGuidelines.article_type && !authorGuidelines.word_limit) {
      parts.push(`- **官网指南摘录**: ${String(authorGuidelines.source_text_excerpt).slice(0, 1200)}\n`);
    }
    parts.push('\n');
  }

  if (coverLetterRequirements) {
    parts.push('## ✉️ Cover Letter 要求\n');
    if (coverLetterRequirements.required !== undefined && coverLetterRequirements.required !== null) {
      parts.push(`- **是否需要**: ${coverLetterRequirements.required ? '需要' : '未明确要求'}\n`);
    }
    if (coverLetterRequirements.tone) parts.push(`- **语气**: ${coverLetterRequirements.tone}\n`);
    if (coverLetterRequirements.length_or_format) parts.push(`- **长度/格式**: ${coverLetterRequirements.length_or_format}\n`);
    if (coverLetterRequirements.editor_addressing) parts.push(`- **编辑称呼**: ${coverLetterRequirements.editor_addressing}\n`);
    if (coverLetterRequirements.novelty_fit_statement) parts.push(`- **创新性/期刊适配性**: ${coverLetterRequirements.novelty_fit_statement}\n`);
    if (Array.isArray(coverLetterRequirements.required_elements) && coverLetterRequirements.required_elements.length > 0) {
      parts.push('- **必须包含**:\n');
      coverLetterRequirements.required_elements.slice(0, 10).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (Array.isArray(coverLetterRequirements.declarations) && coverLetterRequirements.declarations.length > 0) {
      parts.push('- **声明项**:\n');
      coverLetterRequirements.declarations.slice(0, 10).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (coverLetterRequirements.suggested_reviewers_policy) {
      parts.push(`- **推荐/回避审稿人政策**: ${coverLetterRequirements.suggested_reviewers_policy}\n`);
    }
    if (Array.isArray(coverLetterRequirements.template_points) && coverLetterRequirements.template_points.length > 0) {
      parts.push('- **Cover Letter 可用要点**:\n');
      coverLetterRequirements.template_points.slice(0, 10).forEach((item: string) => parts.push(`  - ${item}\n`));
    }
    if (coverLetterRequirements.raw_requirements && !Array.isArray(coverLetterRequirements.required_elements)) {
      parts.push(`- **用户提供要求摘录**: ${String(coverLetterRequirements.raw_requirements).slice(0, 1200)}\n`);
    }
    parts.push('\n');
  }
  
  if (allRules.length > 0) {
    parts.push('## ✅ 写作规则（可迁移）\n');
    allRules.forEach((rule, i) => parts.push(`${i + 1}. ${rule}\n`));
    parts.push('\n');
  }
  
  return parts.join('');
}

app.post("/api/memory/:userId/update", async (req: Request, res: Response) => {
  const userId = req.params.userId;
  const { experimentSummary, dataSummary, merge = true, append = false } = req.body;
  
  try {
    const memory = await await loadUserMemory(userId);
    const existingExperimentSummary = memory.entries.find(e => e.key === 'experiment_summary')?.value || '';
    const existingDataSummary = memory.entries.find(e => e.key === 'data_summary')?.value || '';
    
    const mergePrompt = (existingMemory: string, newContent: string, fieldName: string) => {
      return `你是一个研究数据管理助手。你的任务是将用户提供的新信息与现有的记忆进行智能合并。\n\n## 现有记忆\n${existingMemory ? existingMemory : '（暂无现有记忆）'}\n\n## 用户提供的新信息\n${newContent}\n\n## 你的任务\n请将上述两部分信息合并成一个完整、简洁的"${fieldName}"。\n\n## 合并原则\n1. **去重**：如果新信息与现有记忆重复，保留一份即可，不要重复\n2. **补充**：如果新信息是现有记忆的补充（新的实验细节、新的数据等），将其自然融入到现有内容中\n3. **更新**：如果新信息与现有记忆冲突（如修正了之前的数据），以新信息为准\n4. **简洁**：合并后的内容应该简洁连贯，不要有冗余的过渡语句\n5. **完整**：确保所有重要信息都被保留，形成一个完整的${fieldName}\n\n## 输出要求\n- 输出一个连贯的文字段落\n- 不要使用"新增"、"补充"、"更新"等过渡词\n- 直接输出合并后的完整内容，不要解释\n- 保留所有具体数值和关键细节\n\n## 输出格式\n直接输出合并后的完整${fieldName}内容，不要有其他文字。`;
    };
    
    const simpleAppend = (existing: string, newContent: string): string => {
      if (!existing) return newContent;
      if (!newContent) return existing;
      return existing + '\n\n' + newContent;
    };
    
    let finalExperimentSummary = experimentSummary;
    let finalDataSummary = dataSummary;
    
    if (experimentSummary) {
      if (append) {
        finalExperimentSummary = simpleAppend(existingExperimentSummary, experimentSummary);
      } else if (merge && existingExperimentSummary) {
        const apiUrl = process.env.API_URL || "";
        const apiKey = process.env.API_KEY || "";
        const model = process.env.PRIMARY_MODEL || "qwen3.5-plus";
        
        try {
          const mergeResponse = await fetch(apiUrl + "/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "system", content: mergePrompt(existingExperimentSummary, experimentSummary, '实验资料总结') }],
              temperature: 0.3,
              max_tokens: MAX_LLM_OUTPUT_TOKENS,
            }),
          });
          
          if (mergeResponse.ok) {
            const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
            const mergedContent = mergeData.choices?.[0]?.message?.content;
            if (mergedContent && mergedContent.length > 10) finalExperimentSummary = mergedContent.trim();
          }
        } catch (e) {
          logger.warn("[Memory] Merge failed, using original content:", (e as Error).message);
        }
      }
    }
    
    if (dataSummary) {
      if (append) {
        finalDataSummary = simpleAppend(existingDataSummary, dataSummary);
      } else if (merge && existingDataSummary) {
        const apiUrl = process.env.API_URL || "";
        const apiKey = process.env.API_KEY || "";
        const model = process.env.PRIMARY_MODEL || "qwen3.5-plus";
        
        try {
          const mergeResponse = await fetch(apiUrl + "/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + apiKey,
            },
            body: JSON.stringify({
              model,
              messages: [{ role: "system", content: mergePrompt(existingDataSummary, dataSummary, '数据详细总结') }],
              temperature: 0.3,
              max_tokens: MAX_LLM_OUTPUT_TOKENS,
            }),
          });
          
          if (mergeResponse.ok) {
            const mergeData = await mergeResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
            const mergedContent = mergeData.choices?.[0]?.message?.content;
            if (mergedContent && mergedContent.length > 10) finalDataSummary = mergedContent.trim();
          }
        } catch (e) {
          logger.warn("[Memory] Merge failed, using original content:", (e as Error).message);
        }
      }
    }
    
    if (finalExperimentSummary) {
      const existingIndex = memory.entries.findIndex(e => e.key === 'experiment_summary');
      const newEntry: MemoryEntry = {
        key: 'experiment_summary',
        value: finalExperimentSummary,
        source: 'user-updated',
        timestamp: new Date().toISOString()
      };
      if (existingIndex >= 0) memory.entries[existingIndex] = newEntry;
      else memory.entries.push(newEntry);
    }
    
    if (finalDataSummary) {
      const existingIndex = memory.entries.findIndex(e => e.key === 'data_summary');
      const newEntry: MemoryEntry = {
        key: 'data_summary',
        value: finalDataSummary,
        source: 'user-updated',
        timestamp: new Date().toISOString()
      };
      if (existingIndex >= 0) memory.entries[existingIndex] = newEntry;
      else memory.entries.push(newEntry);
    }
    
    await saveUserMemory(memory);
    logger.info("[Memory] Manual update completed for user:", userId);
    res.json({ success: true, message: "记忆已更新", merged: merge });
  } catch (e) {
    logger.error("[Memory] Manual update failed:", e);
    res.json({ success: false, error: "更新失败：" + (e as Error).message });
  }
});

// SSE 进度事件接口
interface JournalStyleProgress {
  type: 'start' | 'progress' | 'paper_complete' | 'complete' | 'error';
  current?: number;
  total?: number;
  paperName?: string;
  message?: string;
  result?: {
    journal_name: string;
    papers_count: number;
    materials_count?: number;
    sections: string[];
    folder: string;
    has_author_guidelines?: boolean;
    has_cover_letter_requirements?: boolean;
  };
  error?: string;
}

interface JournalStyleSupplementalRequirements {
  journalName: string;
  authorGuidelinesUrl: string;
  authorGuidelinesText: string;
  fetchedAuthorGuidelinesText: string;
  crawledAuthorGuidelinesText: string;
  crawledCoverLetterText: string;
  crawlSources: JournalGuidelineCrawlSource[];
  coverLetterRequirements: string;
  styleExtractionMode?: string;
  extractionFocus?: string;
}

interface JournalGuidelineCrawlSource {
  url: string;
  title: string;
  kind: 'author-guidelines' | 'cover-letter' | 'submission-guidelines';
  score: number;
  text: string;
}

function normalizeJournalStyleInputText(value: unknown, maxChars = 60000): string {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxChars);
}

function stripHtmlForJournalGuidelines(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(p|div|section|article|h[1-6]|li|tr|table|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function fetchJournalAuthorGuidelinesText(rawUrl: string): Promise<string> {
  const urlText = String(rawUrl || '').trim();
  if (!urlText) return '';
  let parsed: URL;
  try {
    parsed = new URL(urlText);
  } catch {
    throw new Error('Author Guidelines URL 格式不正确');
  }
  if (!/^https?:$/i.test(parsed.protocol)) {
    throw new Error('Author Guidelines URL 只支持 http/https');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Scholar-Harness/1.0 journal-style-analyzer',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.8,*/*;q=0.5',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Author Guidelines 获取失败：HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    const rawText = await response.text();
    const text = /html|xml/i.test(contentType) || /<html|<body|<article/i.test(rawText)
      ? stripHtmlForJournalGuidelines(rawText)
      : rawText;
    return normalizeJournalStyleInputText(text, 100000);
  } finally {
    clearTimeout(timeout);
  }
}

function isBlockedJournalCrawlerHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'localhost'
    || host.endsWith('.localhost')
    || host === '0.0.0.0'
    || host === '::1'
    || /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

function normalizeJournalCrawlerUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    if (isBlockedJournalCrawlerHost(parsed.hostname)) return null;
    parsed.hash = '';
    return parsed;
  } catch {
    return null;
  }
}

function classifyJournalGuidelineUrl(url: string, label = ''): JournalGuidelineCrawlSource['kind'] {
  const text = `${url} ${label}`.toLowerCase();
  if (/cover[-_\s]?letter|covering[-_\s]?letter|submission[-_\s]?letter/.test(text)) return 'cover-letter';
  if (/submission|submit|checklist|manuscript[-_\s]?preparation|prepare[-_\s]?manuscript/.test(text)) return 'submission-guidelines';
  return 'author-guidelines';
}

function scoreJournalGuidelineCandidate(url: string, label = ''): number {
  const text = `${url} ${label}`.toLowerCase();
  let score = 0;
  const strong = [
    /guide[-_\s]?for[-_\s]?authors/,
    /author[-_\s]?guidelines?/,
    /instructions?[-_\s]?for[-_\s]?authors?/,
    /submission[-_\s]?guidelines?/,
    /manuscript[-_\s]?preparation/,
    /prepare[-_\s]?your[-_\s]?manuscript/,
    /cover[-_\s]?letter/,
  ];
  strong.forEach((pattern) => { if (pattern.test(text)) score += 8; });
  if (/authors?|submission|submit|manuscript|journal|article|guidelines?|instructions?|cover|letter|checklist/.test(text)) score += 3;
  if (/pdf|docx?|zip|login|account|cart|subscribe|privacy|cookie|advertis|news|press|issue|volume|article\/\d/i.test(text)) score -= 3;
  if (/facebook|twitter|linkedin|youtube|wechat|weibo|mailto:|javascript:/i.test(text)) score -= 10;
  return score;
}

function extractJournalCrawlerTitle(html: string, fallbackUrl: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]
    || /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1]
    || fallbackUrl;
  return stripHtmlForJournalGuidelines(title).replace(/\s+/g, ' ').slice(0, 180) || fallbackUrl;
}

function extractJournalGuidelineLinks(html: string, baseUrl: string, sameOriginOnly: boolean): Array<{ url: string; label: string; score: number }> {
  const base = normalizeJournalCrawlerUrl(baseUrl);
  if (!base) return [];
  const links: Array<{ url: string; label: string; score: number }> = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const href = match[1] || '';
    const label = stripHtmlForJournalGuidelines(match[2] || '').replace(/\s+/g, ' ').slice(0, 240);
    let parsed: URL;
    try {
      parsed = new URL(href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/i.test(parsed.protocol)) continue;
    if (isBlockedJournalCrawlerHost(parsed.hostname)) continue;
    if (sameOriginOnly && parsed.hostname !== base.hostname) continue;
    parsed.hash = '';
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    const score = scoreJournalGuidelineCandidate(url, label);
    if (score >= 4) links.push({ url, label, score });
  }
  return links.sort((a, b) => b.score - a.score).slice(0, 12);
}

async function fetchJournalCrawlerPage(rawUrl: string): Promise<{ url: string; title: string; text: string; html: string; contentType: string }> {
  const parsed = normalizeJournalCrawlerUrl(rawUrl);
  if (!parsed) throw new Error('URL 不安全或格式不支持');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 18000);
  try {
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      headers: {
        'User-Agent': 'Scholar-Harness/1.0 journal-guideline-crawler',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/pdf;q=0.7,*/*;q=0.3',
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const rawText = (await response.text()).slice(0, 500000);
    const isHtml = /html|xml/i.test(contentType) || /<html|<body|<article/i.test(rawText);
    return {
      url: response.url || parsed.toString(),
      title: isHtml ? extractJournalCrawlerTitle(rawText, response.url || parsed.toString()) : path.basename(parsed.pathname) || parsed.hostname,
      text: normalizeJournalStyleInputText(isHtml ? stripHtmlForJournalGuidelines(rawText) : rawText, 100000),
      html: isHtml ? rawText : '',
      contentType,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseDuckDuckGoResultUrls(html: string): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const hrefPattern = /href=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = hrefPattern.exec(html)) !== null) {
    let href = match[1] || '';
    if (href.includes('uddg=')) {
      try {
        const parsed = new URL(href, 'https://duckduckgo.com');
        href = decodeURIComponent(parsed.searchParams.get('uddg') || href);
      } catch {
        // keep original href
      }
    }
    const parsed = normalizeJournalCrawlerUrl(href);
    if (!parsed) continue;
    const url = parsed.toString();
    if (seen.has(url)) continue;
    seen.add(url);
    if (scoreJournalGuidelineCandidate(url) >= 3) urls.push(url);
  }
  return urls.slice(0, 10);
}

async function searchJournalGuidelineUrls(journalName: string): Promise<string[]> {
  const name = normalizeJournalStyleInputText(journalName, 200);
  if (!name) return [];
  const query = `${name} author guidelines instructions for authors cover letter submission guidelines`;
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const page = await fetchJournalCrawlerPage(searchUrl);
    return parseDuckDuckGoResultUrls(page.html || page.text)
      .filter((url) => !/duckduckgo\.com/i.test(url))
      .slice(0, 8);
  } catch (error) {
    logger.warn('[JournalStyleCrawler] Search failed:', error);
    return [];
  }
}

async function crawlJournalGuidelineSources(input: {
  journalName: string;
  seedUrl: string;
  maxPages?: number;
}): Promise<JournalGuidelineCrawlSource[]> {
  const maxPages = Math.max(1, Math.min(8, input.maxPages || 6));
  const queue: Array<{ url: string; label: string; score: number; sameOriginOnly: boolean }> = [];
  const seed = normalizeJournalCrawlerUrl(input.seedUrl);
  if (seed) {
    queue.push({ url: seed.toString(), label: 'seed author guidelines URL', score: 10, sameOriginOnly: true });
  }
  if (!seed && input.journalName) {
    const searchResults = await searchJournalGuidelineUrls(input.journalName);
    searchResults.forEach((url, index) => queue.push({
      url,
      label: input.journalName,
      score: 8 - index * 0.2,
      sameOriginOnly: false,
    }));
  }

  const sources: JournalGuidelineCrawlSource[] = [];
  const visited = new Set<string>();
  while (queue.length > 0 && sources.length < maxPages) {
    const candidate = queue.sort((a, b) => b.score - a.score).shift();
    if (!candidate || visited.has(candidate.url)) continue;
    visited.add(candidate.url);
    try {
      const page = await fetchJournalCrawlerPage(candidate.url);
      const pageScore = Math.max(candidate.score, scoreJournalGuidelineCandidate(page.url, `${candidate.label} ${page.title} ${page.text.slice(0, 800)}`));
      if (page.text.length > 400 && pageScore >= 4) {
        sources.push({
          url: page.url,
          title: page.title,
          kind: classifyJournalGuidelineUrl(page.url, `${candidate.label} ${page.title}`),
          score: pageScore,
          text: page.text.slice(0, 60000),
        });
      }
      if (page.html && (candidate.sameOriginOnly || sources.length < 2)) {
        for (const link of extractJournalGuidelineLinks(page.html, page.url, candidate.sameOriginOnly)) {
          if (!visited.has(link.url)) {
            queue.push({
              ...link,
              sameOriginOnly: candidate.sameOriginOnly,
            });
          }
        }
      }
    } catch (error) {
      logger.warn(`[JournalStyleCrawler] Failed to crawl ${candidate.url}:`, error);
    }
  }
  return sources
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPages);
}

function buildJournalStyleSupplementalContext(input: JournalStyleSupplementalRequirements): string {
  const authorText = normalizeJournalStyleInputText([
    input.fetchedAuthorGuidelinesText,
    input.crawledAuthorGuidelinesText,
    input.authorGuidelinesText,
  ].filter(Boolean).join('\n\n'), 100000);
  const coverText = normalizeJournalStyleInputText([
    input.crawledCoverLetterText,
    input.coverLetterRequirements,
  ].filter(Boolean).join('\n\n'), 60000);
  const parts: string[] = [];
  if (authorText || input.authorGuidelinesUrl) {
    parts.push([
      'OFFICIAL_AUTHOR_GUIDELINES',
      input.authorGuidelinesUrl ? `Source URL: ${input.authorGuidelinesUrl}` : '',
      input.crawlSources.length > 0 ? `Crawler sources:\n${input.crawlSources.map((source, index) => `${index + 1}. ${source.title} <${source.url}> (${source.kind})`).join('\n')}` : '',
      authorText ? `Text:\n${authorText}` : 'Text: 未获取到正文；仅保留 URL 供后续人工复核。',
    ].filter(Boolean).join('\n'));
  }
  if (coverText) {
    parts.push([
      'COVER_LETTER_REQUIREMENTS',
      coverText,
    ].join('\n'));
  }
  return parts.join('\n\n---\n\n').slice(0, 130000);
}

function attachJournalSubmissionRequirements(
  styleGuide: Record<string, any>,
  supplemental: JournalStyleSupplementalRequirements
): Record<string, any> {
  const authorText = normalizeJournalStyleInputText([
    supplemental.fetchedAuthorGuidelinesText,
    supplemental.crawledAuthorGuidelinesText,
    supplemental.authorGuidelinesText,
  ].filter(Boolean).join('\n\n'), 50000);
  const coverText = normalizeJournalStyleInputText([
    supplemental.crawledCoverLetterText,
    supplemental.coverLetterRequirements,
  ].filter(Boolean).join('\n\n'), 30000);

  if (authorText || supplemental.authorGuidelinesUrl) {
    styleGuide.author_guidelines = {
      ...(styleGuide.author_guidelines && typeof styleGuide.author_guidelines === 'object' ? styleGuide.author_guidelines : {}),
      source_url: supplemental.authorGuidelinesUrl || styleGuide.author_guidelines?.source_url || null,
      source_text_excerpt: authorText ? authorText.slice(0, 12000) : styleGuide.author_guidelines?.source_text_excerpt || null,
      crawl_sources: supplemental.crawlSources.map((source) => ({
        url: source.url,
        title: source.title,
        kind: source.kind,
        score: source.score,
      })),
      source: supplemental.crawledAuthorGuidelinesText ? 'crawler' : supplemental.fetchedAuthorGuidelinesText ? 'official-url' : supplemental.authorGuidelinesText ? 'user-pasted' : 'url-only',
    };
  }

  if (coverText) {
    styleGuide.cover_letter_requirements = {
      ...(styleGuide.cover_letter_requirements && typeof styleGuide.cover_letter_requirements === 'object' ? styleGuide.cover_letter_requirements : {}),
      required: styleGuide.cover_letter_requirements?.required ?? true,
      raw_requirements: coverText.slice(0, 12000),
    };
  }

  styleGuide.submission_materials = {
    ...(styleGuide.submission_materials && typeof styleGuide.submission_materials === 'object' ? styleGuide.submission_materials : {}),
    has_author_guidelines: Boolean(authorText || supplemental.authorGuidelinesUrl),
    has_cover_letter_requirements: Boolean(coverText),
    journal_name_query: supplemental.journalName || null,
    author_guidelines_url: supplemental.authorGuidelinesUrl || null,
    crawl_sources: supplemental.crawlSources.map((source) => ({
      url: source.url,
      title: source.title,
      kind: source.kind,
      score: source.score,
    })),
    updated_at: new Date().toISOString(),
  };

  if (supplemental.styleExtractionMode || supplemental.extractionFocus) {
    styleGuide.extraction_profile = {
      mode: supplemental.styleExtractionMode || 'default',
      focus: supplemental.extractionFocus || null,
      updated_at: new Date().toISOString(),
    };
  }

  return styleGuide;
}

function createJournalRequirementOnlyStyleGuide(supplemental: JournalStyleSupplementalRequirements): Record<string, any> {
  const urlHost = (() => {
    try {
      return supplemental.authorGuidelinesUrl ? new URL(supplemental.authorGuidelinesUrl).hostname.replace(/^www\./, '') : '';
    } catch {
      return '';
    }
  })();

  return attachJournalSubmissionRequirements({
    journal: supplemental.journalName || urlHost || '目标期刊',
    paper_title: null,
    year: null,
    citation_format: {
      reference_style: null,
      in_text_style: null,
      reference_example: null,
      citation_frequency: null,
    },
    structure_features: {
      section_lengths: {
        abstract: null,
        introduction: null,
        methods: null,
        results: null,
        discussion: null,
        conclusion: null,
      },
    },
    lexical_patterns: {
      common_verbs: {},
      common_phrases: {},
      transition_words: [],
    },
    overall_style: {
      formality: null,
      argument_tone: null,
      hedging_frequency: null,
      summary: '仅基于 Author Guidelines / Cover Letter 要求生成，未上传样例论文时不推断具体论文写作风格。',
    },
    section_features: {},
    argument_pattern: {},
    tone_features: {},
    syntax_features: {},
    tense_distribution: {},
    voice_distribution: {},
    transferable_rules: [
      '优先遵守期刊官网 Author Guidelines 中的文章类型、结构、字数、图表、参考文献和提交材料要求。',
      'Cover Letter 必须覆盖期刊明确要求的声明、创新性说明、投稿适配性、利益冲突和审稿人政策。',
    ],
  }, supplemental);
}

app.post("/api/analyze-journal-style", upload.array("files", 10), async (req: Request, res: Response) => {
  const userId = req.body.userId || "web-user";
  const apiUrl = req.body.apiUrl || process.env.API_URL || "";
  const apiKey = req.body.apiKey || process.env.API_KEY || "";
  const model = req.body.model || currentModel || "qwen3.5-plus";
  const userDir = getUserUploadDir(userId);
  
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
  
  const files = ((req.files as Express.Multer.File[]) || []).filter(Boolean);
  const journalName = normalizeJournalStyleInputText(req.body.journalName, 300);
  const authorGuidelinesUrl = normalizeJournalStyleInputText(req.body.authorGuidelinesUrl, 1000);
  const autoCrawlGuidelines = req.body.autoCrawlGuidelines !== 'false';
  const authorGuidelinesText = normalizeJournalStyleInputText(req.body.authorGuidelinesText, 60000);
  const coverLetterRequirements = normalizeJournalStyleInputText(req.body.coverLetterRequirements, 40000);
  const styleExtractionMode = normalizeJournalStyleInputText(req.body.styleExtractionMode, 80);
  const extractionFocus = normalizeJournalStyleInputText(req.body.extractionFocus, 12000);
  const isBibliometricsStyleExtraction = styleExtractionMode === 'bibliometrics';
  if (files.length === 0 && !journalName && !authorGuidelinesUrl && !authorGuidelinesText && !coverLetterRequirements) {
    res.json({ success: false, error: "请上传目标期刊文献，或填写期刊名、Author Guidelines / Cover Letter 要求" });
    return;
  }
  
  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  
  // 发送 SSE 进度事件的辅助函数
  const sendProgress = (progress: JournalStyleProgress) => {
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
  };
  
  const totalPapers = Math.min(files.length, 5);
  const hasSupplementalRequirements = Boolean(journalName || authorGuidelinesUrl || authorGuidelinesText || coverLetterRequirements);
  logger.info(`[JournalStyle] Starting analysis of ${totalPapers} papers with model: ${model}; supplemental=${hasSupplementalRequirements}; mode=${styleExtractionMode || 'default'}`);
  
  // 发送开始事件
  sendProgress({
    type: 'start',
    total: totalPapers,
    message: `开始分析 ${totalPapers} 篇期刊论文${hasSupplementalRequirements ? '，并整合投稿规范...' : '...'}`
  });
  
  try {
    const allStyleGuides: any[] = [];
    let fetchedAuthorGuidelinesText = '';
    let crawlSources: JournalGuidelineCrawlSource[] = [];

    if (authorGuidelinesUrl) {
      sendProgress({
        type: 'progress',
        current: 0,
        total: Math.max(1, totalPapers),
        message: '正在读取期刊官网 Author Guidelines...'
      });
      try {
        fetchedAuthorGuidelinesText = await fetchJournalAuthorGuidelinesText(authorGuidelinesUrl);
        sendProgress({
          type: 'paper_complete',
          current: 0,
          total: Math.max(1, totalPapers),
          paperName: 'Author Guidelines',
          message: fetchedAuthorGuidelinesText
            ? `✅ 已读取 Author Guidelines：${fetchedAuthorGuidelinesText.length} 字符`
            : '⚠️ Author Guidelines URL 未读取到正文，仅保留 URL'
        });
      } catch (error) {
        logger.warn('[JournalStyle] Failed to fetch author guidelines:', error);
        sendProgress({
          type: 'paper_complete',
          current: 0,
          total: Math.max(1, totalPapers),
          paperName: 'Author Guidelines',
          message: `⚠️ Author Guidelines 获取失败：${(error as Error).message}；将继续使用手动粘贴内容或 URL`
        });
      }
    }

    if (autoCrawlGuidelines && (journalName || authorGuidelinesUrl)) {
      sendProgress({
        type: 'progress',
        current: 0,
        total: Math.max(1, totalPapers),
        message: journalName
          ? `正在爬取 ${journalName} 的 Author Guidelines / Cover Letter 要求...`
          : '正在从期刊官网爬取 Author Guidelines / Cover Letter 要求...'
      });
      try {
        crawlSources = await crawlJournalGuidelineSources({
          journalName,
          seedUrl: authorGuidelinesUrl,
          maxPages: 6,
        });
        sendProgress({
          type: 'paper_complete',
          current: 0,
          total: Math.max(1, totalPapers),
          paperName: 'Journal crawler',
          message: crawlSources.length > 0
            ? `✅ 爬取到 ${crawlSources.length} 个期刊规范页面：${crawlSources.slice(0, 3).map((source) => source.title).join('；')}`
            : '⚠️ 未爬取到高置信度期刊规范页面，可手动粘贴 Author Guidelines 或 Cover Letter 要求'
        });
      } catch (error) {
        logger.warn('[JournalStyleCrawler] Crawl failed:', error);
        sendProgress({
          type: 'paper_complete',
          current: 0,
          total: Math.max(1, totalPapers),
          paperName: 'Journal crawler',
          message: `⚠️ 期刊规范爬取失败：${(error as Error).message}`
        });
      }
    }

    const supplemental: JournalStyleSupplementalRequirements = {
      journalName,
      authorGuidelinesUrl,
      authorGuidelinesText,
      fetchedAuthorGuidelinesText,
      crawledAuthorGuidelinesText: crawlSources
        .filter((source) => source.kind !== 'cover-letter')
        .map((source) => `Source: ${source.title}\nURL: ${source.url}\n${source.text}`)
        .join('\n\n---\n\n'),
      crawledCoverLetterText: crawlSources
        .filter((source) => source.kind === 'cover-letter' || /cover\s+letter/i.test(source.text.slice(0, 4000)))
        .map((source) => `Source: ${source.title}\nURL: ${source.url}\n${source.text}`)
        .join('\n\n---\n\n'),
      crawlSources,
      coverLetterRequirements,
      styleExtractionMode,
      extractionFocus,
    };
    const supplementalContext = buildJournalStyleSupplementalContext(supplemental);
    const specializedExtractionInstruction = isBibliometricsStyleExtraction ? [
      '',
      '文献计量论文专门提取要求：',
      '- 本次输入优先用于提取“文献计量分析文章的写作套路”，不是普通实验论文风格。',
      '- 请重点抽取：选题切口、引言套路、数据与方法写法、结果顺序、讨论套路、图表配置和可复用句式。',
      '- 如果样例文章不是文献计量文章，请在 bibliometric_article_pattern.limitations 中说明不适用，不要硬凑。',
      '- 图表配置要写成“图/表类型 + 使用数据 + 图后解释方式”，方便后续自动写作直接调用。',
      extractionFocus ? `\n用户指定提取维度：\n${extractionFocus}` : '',
    ].filter(Boolean).join('\n') : '';
    const specializedJsonSchemaBlock = isBibliometricsStyleExtraction ? `  "bibliometric_article_pattern": {
    "topic_rationale": {
      "why_this_field_needs_bibliometrics": "为什么该领域适合/需要文献计量分析",
      "research_gap_framing": "如何表述缺少系统知识图谱或演化分析",
      "contribution_statement_pattern": "本文贡献通常如何写"
    },
    "introduction_routine": ["背景问题", "文献增长", "缺少系统知识图谱", "本文贡献"],
    "data_methods_routine": {
      "database_reporting": ["数据库、索引和记录类型写法"],
      "search_strategy_reporting": ["检索式、时间范围、检索日期写法"],
      "screening_rule_reporting": ["纳入排除标准、去重、清洗写法"],
      "software_and_indicators": ["软件、算法、指标和参数写法"],
      "reproducibility_details": ["可复现细节写法"]
    },
    "results_sequence": ["年度发文", "国家/机构/作者/期刊", "高被引文献", "关键词共现", "聚类", "突现", "演化"],
    "discussion_routine": ["热点解释", "阶段变化", "研究缺口", "未来方向"],
    "figure_table_configuration": [
      {
        "section": "结果小节名称",
        "figure_or_table": "图/表类型",
        "data_used": "调用的数据或指标",
        "interpretation_move": "图后通常如何解释"
      }
    ],
    "reusable_sentence_patterns": {
      "abstract": ["摘要常用句式"],
      "introduction": ["引言常用句式"],
      "methods": ["方法常用句式"],
      "results": ["结果常用句式"],
      "discussion": ["讨论常用句式"]
    },
    "limitations": ["该套路适用边界或样例不足说明"]
  },
` : '';
    
    for (let i = 0; i < totalPapers; i++) {
      const file = files[i];
      const ext = path.extname(file.originalname).toLowerCase();
      const paperName = file.originalname;
      
      // 发送进度事件
      sendProgress({
        type: 'progress',
        current: i + 1,
        total: totalPapers,
        paperName: paperName,
        message: `正在分析第 ${i + 1}/${totalPapers} 篇: ${paperName.slice(0, 30)}...`
      });
      
      logger.info(`[JournalStyle] Processing paper ${i + 1}/${totalPapers}: ${paperName}`);
      
      let paperContent = '';
      if (file.buffer) {
        const base64 = file.buffer.toString('base64');
        paperContent = `文件名：${paperName}\n文件类型：${ext}\n文件内容（base64）：${base64.slice(0, 50000)}`;
      } else {
        const content = fs.readFileSync(file.path);
        const base64 = content.toString('base64');
        paperContent = `文件名：${paperName}\n文件类型：${ext}\n文件内容（base64）：${base64.slice(0, 50000)}`;
      }
      
      const singlePaperPrompt = `你是一名学术写作风格分析专家。你的任务不是总结论文内容，也不是评价研究质量，而是从输入论文中提取"可用于模仿写作"的风格特征。

请严格基于提供的论文全文，分析其写作风格，并输出为**合法 JSON**。不要输出 Markdown，不要输出解释，不要输出 JSON 之外的任何文字。

分析目标说明：
- 如果输入只有一篇论文，请将结果理解为"该论文代表的写作风格特征"，不要过度泛化为整个期刊的统一风格。
- 如果论文文本不足以支持某项判断，请填写 null，不要猜测，不要编造。
- 所有百分比字段必须填写 0–100 的整数，不带 % 符号。
- 同一分布中的比例总和必须为 100；若无法可靠判断则填写估计值，但仍需保证总和为 100。
- 所有 section_lengths 均以"词数（word count）"估计。
- average_sentence_length 以"每句平均单词数"估计。
- 如果论文没有某个独立章节（如 conclusion），对应字段填 null。
- 如果 results 和 discussion 合并，尽量按功能区分；无法区分则填 null。
- 不要根据期刊常识补充信息，所有判断必须来自输入文本本身。
- 不要总结研究内容，只提取写作风格、表达模式、结构习惯和语言特征。
${specializedExtractionInstruction}
${supplementalContext ? `\n补充材料说明：\n以下 OFFICIAL_AUTHOR_GUIDELINES 和 COVER_LETTER_REQUIREMENTS 来自用户填写的期刊官网指南、投稿规范或 cover letter 要求。请只从这些补充材料中提取投稿格式、author guidelines、cover letter、声明、图表、参考文献、数据/伦理/利益冲突等要求；不要把它们当作样例论文正文风格。\n\n${supplementalContext}\n` : ''}

高频项提取规则：
- common_verbs：每个章节提取 3–8 个高频或代表性动词
- common_phrases：每个章节提取 3–8 个高频或代表性短语
- transition_words：提取 5–15 个常见过渡词
- transferable_rules：提取 5–10 条可迁移写作规则，必须是"可直接模仿"的写法规则，而不是空泛建议

输出要求：
- 必须输出合法 JSON
- 字段名必须与下方结构完全一致，不能新增、删除或改名
- 所有字符串值必须使用标准 JSON 双引号
- 数字字段必须为数字，不要写成字符串
- 数组字段必须填写具体内容，不能留空字符串占位
- 如果信息缺失，请使用 null

请严格按照以下 JSON 结构输出：

{
  "journal": "期刊名称或null",
  "paper_title": "论文标题或null",
  "year": "发表年份或null",
  "citation_format": {
    "reference_style": "参考文献风格",
    "in_text_style": "文内引用风格",
    "reference_example": "参考文献示例",
    "citation_frequency": "引用频率描述"
  },
  "author_guidelines": {
    "source_url": "Author Guidelines URL或null",
    "article_type": "适用文章类型或null",
    "word_limit": "总字数/正文/摘要限制或null",
    "title_abstract_keywords_requirements": ["要求1", "要求2"],
    "section_requirements": {
      "abstract": ["要求1"],
      "introduction": ["要求1"],
      "methods": ["要求1"],
      "results": ["要求1"],
      "discussion": ["要求1"],
      "conclusion": ["要求1"]
    },
    "formatting_requirements": ["格式要求1", "格式要求2"],
    "figure_table_requirements": ["图表要求1", "图表要求2"],
    "reference_requirements": ["参考文献要求1", "参考文献要求2"],
    "data_ethics_reporting_requirements": ["数据、伦理、CRediT、COI等要求"],
    "submission_checklist": ["提交前检查项1", "提交前检查项2"],
    "notes": ["其他注意事项"]
  },
  "cover_letter_requirements": {
    "required": true,
    "required_elements": ["必须包含的内容1", "必须包含的内容2"],
    "tone": "投稿信语气要求",
    "length_or_format": "长度或格式要求",
    "editor_addressing": "编辑称呼要求或null",
    "novelty_fit_statement": "创新性和期刊适配性陈述要求",
    "declarations": ["原创性声明", "未一稿多投声明", "利益冲突声明"],
    "suggested_reviewers_policy": "推荐/回避审稿人政策或null",
    "template_points": ["可直接用于cover letter的要点1", "要点2"],
    "notes": ["其他注意事项"]
  },
  "structure_features": {
    "section_lengths": {
      "abstract": 0,
      "introduction": 0,
      "methods": 0,
      "results": 0,
      "discussion": 0,
      "conclusion": 0
    }
  },
  "lexical_patterns": {
    "common_verbs": {
      "abstract": ["动词1", "动词2", "动词3"],
      "introduction": ["动词1", "动词2", "动词3"],
      "methods": ["动词1", "动词2", "动词3"],
      "results": ["动词1", "动词2", "动词3"],
      "discussion": ["动词1", "动词2", "动词3"],
      "conclusion": ["动词1", "动词2", "动词3"]
    },
    "common_phrases": {
      "abstract": ["短语1", "短语2", "短语3"],
      "introduction": ["短语1", "短语2", "短语3"],
      "methods": ["短语1", "短语2", "短语3"],
      "results": ["短语1", "短语2", "短语3"],
      "discussion": ["短语1", "短语2", "短语3"],
      "conclusion": ["短语1", "短语2", "短语3"]
    },
    "transition_words": ["however", "therefore", "in addition", "moreover", "thus"]
  },
  "overall_style": {
    "formality": "高/中/低",
    "argument_tone": "客观/批判/建设性/谨慎等",
    "hedging_frequency": "高/中/低",
    "summary": "一句话概括整体风格"
  },
  "section_features": {
    "abstract": {
      "purpose": "摘要的章节目的",
      "typical_moves": ["步骤1", "步骤2", "步骤3"],
      "sentence_style": "句子风格描述",
      "tense": "主要时态",
      "voice": "主要语态"
    },
    "introduction": {
      "purpose": "引言的章节目的",
      "typical_moves": ["步骤1", "步骤2", "步骤3"],
      "sentence_style": "句子风格描述",
      "tense": "主要时态",
      "voice": "主要语态"
    },
    "methods": {
      "purpose": "方法的章节目的",
      "typical_moves": ["步骤1", "步骤2", "步骤3"],
      "sentence_style": "句子风格描述",
      "tense": "主要时态",
      "voice": "主要语态"
    },
    "results": {
      "purpose": "结果的章节目的",
      "typical_moves": ["步骤1", "步骤2", "步骤3"],
      "sentence_style": "句子风格描述",
      "tense": "主要时态",
      "voice": "主要语态"
    },
    "discussion": {
      "purpose": "讨论的章节目的",
      "typical_moves": ["步骤1", "步骤2", "步骤3"],
      "sentence_style": "句子风格描述",
      "tense": "主要时态",
      "voice": "主要语态"
    },
    "conclusion": {
      "purpose": "结论的章节目的",
      "typical_moves": ["步骤1", "步骤2", "步骤3"],
      "sentence_style": "句子风格描述",
      "tense": "主要时态",
      "voice": "主要语态"
    }
  },
  "argument_pattern": {
    "introduction_flow": "引言的结构流程描述",
    "results_presentation": "结果的呈现方式描述",
    "discussion_emphasis": ["重点1", "重点2", "重点3"]
  },
${specializedJsonSchemaBlock}  "tone_features": {
    "objectivity_level": "高/中/低",
    "confidence_level": "高/中/低",
    "emphasis_pattern": "强调模式描述",
    "common_hedging_words": ["may", "suggest", "appear", "indicate"]
  },
  "syntax_features": {
    "average_sentence_length": 0,
    "sentence_complexity": {
      "simple": 0,
      "compound": 0,
      "complex": 0
    },
    "frequent_structures": ["句式结构1", "句式结构2", "句式结构3"],
    "information_density": "信息密度描述"
  },
  "tense_distribution": {
    "abstract": { "present": 0, "past": 0, "future": 0, "present_perfect": 0 },
    "introduction": { "present": 0, "past": 0, "future": 0, "present_perfect": 0 },
    "methods": { "present": 0, "past": 0, "future": 0, "present_perfect": 0 },
    "results": { "present": 0, "past": 0, "future": 0, "present_perfect": 0 },
    "discussion": { "present": 0, "past": 0, "future": 0, "present_perfect": 0 },
    "conclusion": { "present": 0, "past": 0, "future": 0, "present_perfect": 0 }
  },
  "voice_distribution": {
    "abstract": { "active": 0, "passive": 0 },
    "introduction": { "active": 0, "passive": 0 },
    "methods": { "active": 0, "passive": 0 },
    "results": { "active": 0, "passive": 0 },
    "discussion": { "active": 0, "passive": 0 },
    "conclusion": { "active": 0, "passive": 0 }
  },
  "transferable_rules": [
    "规则1",
    "规则2",
    "规则3",
    "规则4",
    "规则5"
  ]
}

输入论文全文如下：
${paperContent}`;
      
      try {
        const apiEndpoint = apiUrl.endsWith('/chat/completions') 
          ? apiUrl 
          : apiUrl.replace(/\/$/, '') + '/chat/completions';
        
        const response = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: model,
            messages: [{ role: "user", content: singlePaperPrompt }],
            temperature: 0.3,
            max_tokens: MAX_LLM_OUTPUT_TOKENS,
          }),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          logger.warn(`[JournalStyle] Paper ${i + 1} failed: ${response.status} - ${errorText.slice(0, 200)}`);
          sendProgress({
            type: 'paper_complete',
            current: i + 1,
            total: totalPapers,
            paperName: paperName,
            message: `⚠️ 第 ${i + 1} 篇分析失败: ${response.status}`
          });
          continue;
        }
        
        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content || "";
        
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const styleGuide = attachJournalSubmissionRequirements(JSON.parse(jsonMatch[0]), supplemental);
            allStyleGuides.push(styleGuide);
            logger.info(`[JournalStyle] Paper ${i + 1} analyzed successfully`);
            
            // 发送论文分析完成事件
            sendProgress({
              type: 'paper_complete',
              current: i + 1,
              total: totalPapers,
              paperName: paperName,
              message: `✅ 第 ${i + 1} 篇分析完成: ${styleGuide.journal || paperName.slice(0, 20)}`
            });
          } else {
            logger.warn(`[JournalStyle] Paper ${i + 1} no JSON found`);
            sendProgress({
              type: 'paper_complete',
              current: i + 1,
              total: totalPapers,
              paperName: paperName,
              message: `⚠️ 第 ${i + 1} 篇分析失败: 无法解析JSON`
            });
          }
        } catch (e) {
          logger.warn(`[JournalStyle] Paper ${i + 1} parse error:`, e);
          sendProgress({
            type: 'paper_complete',
            current: i + 1,
            total: totalPapers,
            paperName: paperName,
            message: `⚠️ 第 ${i + 1} 篇解析失败`
          });
        }
      } catch (e) {
        logger.warn(`[JournalStyle] Paper ${i + 1} request error:`, e);
        sendProgress({
          type: 'paper_complete',
          current: i + 1,
          total: totalPapers,
          paperName: paperName,
          message: `⚠️ 第 ${i + 1} 篇请求失败: ${(e as Error).message}`
        });
      }
    }
    const hasRequirementMaterial = Boolean(
      supplemental.authorGuidelinesUrl
      || supplemental.authorGuidelinesText
      || supplemental.fetchedAuthorGuidelinesText
      || supplemental.crawledAuthorGuidelinesText
      || supplemental.crawledCoverLetterText
      || supplemental.coverLetterRequirements
    );

    if (allStyleGuides.length === 0 && totalPapers === 0 && hasRequirementMaterial) {
      allStyleGuides.push(createJournalRequirementOnlyStyleGuide(supplemental));
      sendProgress({
        type: 'paper_complete',
        current: 1,
        total: 1,
        paperName: 'Author Guidelines / Cover Letter',
        message: '✅ 已保存 Author Guidelines / Cover Letter 要求'
      });
    }

    if (allStyleGuides.length === 0) {
      sendProgress({
        type: 'error',
        error: totalPapers === 0
          ? "未爬取到可用期刊规范，请填写更准确的 Author Guidelines URL，或手动粘贴官网指南/Cover Letter 要求"
          : "所有论文分析失败，请检查 API 配置或文献内容"
      });
      res.end();
      return;
    }
    
    const resolvedJournalName = allStyleGuides[0]?.journal || journalName || "未知期刊";
    const safeName = resolvedJournalName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_').slice(0, 50);
    const styleDir = path.join(userDir, "journal-styles", safeName);
    
    if (!fs.existsSync(styleDir)) fs.mkdirSync(styleDir, { recursive: true });
    
    const styleFile = path.join(styleDir, "style.json");
    fs.writeFileSync(styleFile, JSON.stringify(allStyleGuides, null, 2), 'utf-8');
    
    logger.info("[JournalStyle] Saved styles for:", resolvedJournalName, "Papers:", allStyleGuides.length);
    
    // 发送完成事件
    sendProgress({
      type: 'complete',
      result: {
        journal_name: resolvedJournalName,
        papers_count: totalPapers,
        materials_count: allStyleGuides.length,
        sections: ["abstract", "introduction", "methods", "results", "discussion", "conclusion"],
        folder: "journal-styles/" + safeName,
        has_author_guidelines: Boolean(supplemental.authorGuidelinesUrl || supplemental.authorGuidelinesText || supplemental.fetchedAuthorGuidelinesText || supplemental.crawledAuthorGuidelinesText),
        has_cover_letter_requirements: Boolean(supplemental.coverLetterRequirements || supplemental.crawledCoverLetterText)
      },
      message: `✅ 期刊风格分析完成！成功分析 ${totalPapers} 篇论文${hasSupplementalRequirements ? '，并整合投稿规范' : ''}`
    });
    
    res.end();
  } catch (e) {
    logger.error("[JournalStyle] Error:", e);
    sendProgress({
      type: 'error',
      error: "分析失败：" + (e as Error).message
    });
    res.end();
  }
});

// ============ 论文草稿管理 ============

const EDITABLE_DRAFT_CHAPTER_ALIASES: Record<string, string> = {
  title: "title",
  abstract: "abstract",
  摘要: "abstract",
  introduction: "introduction",
  intro: "introduction",
  引言: "introduction",
  methods: "methods",
  method: "methods",
  "materials-and-methods": "methods",
  "materials-methods": "methods",
  "materials-and-method": "methods",
  "material-and-methods": "methods",
  方法: "methods",
  材料与方法: "methods",
  材料和方法: "methods",
  results: "results",
  result: "results",
  结果: "results",
  discussion: "discussion",
  讨论: "discussion",
  conclusion: "conclusion",
  conclusions: "conclusion",
  结论: "conclusion",
  references: "references",
  reference: "references",
  参考文献: "references",
};

function normalizeEditedDraftChapterName(rawTitle: string, index: number): string {
  const title = rawTitle.trim();
  const compactTitle = title.toLowerCase();
  const directAlias = EDITABLE_DRAFT_CHAPTER_ALIASES[compactTitle];
  if (directAlias) return directAlias;

  const slug = compactTitle
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return EDITABLE_DRAFT_CHAPTER_ALIASES[slug] || slug || `section-${index + 1}`;
}

function splitEditedDraftSections(content: string): Array<{ chapterName: string; content: string }> {
  const sectionRegex = /\\section\{([^}]+)\}\s*/g;
  const matches = Array.from(content.matchAll(sectionRegex));

  if (matches.length === 0) return [];

  const firstSectionIndex = matches[0].index ?? 0;
  if (content.slice(0, firstSectionIndex).trim()) {
    return [];
  }

  const usedChapterNames = new Map<string, number>();
  const sections: Array<{ chapterName: string; content: string }> = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const nextMatch = matches[i + 1];
    const start = (match.index ?? 0) + match[0].length;
    const end = nextMatch ? (nextMatch.index ?? content.length) : content.length;
    const body = content.slice(start, end).trim();

    if (!body) continue;

    const baseChapterName = normalizeEditedDraftChapterName(match[1], i);
    const usedCount = usedChapterNames.get(baseChapterName) || 0;
    usedChapterNames.set(baseChapterName, usedCount + 1);

    sections.push({
      chapterName: usedCount === 0 ? baseChapterName : `${baseChapterName}-${usedCount + 1}`,
      content: body,
    });
  }

  return sections;
}

function writeDraftSnapshot(userId: string, content: string, reason: string): void {
  const userDir = getUserUploadDir(userId);
  const draftDir = path.join(userDir, "drafts");
  const draftFile = path.join(userDir, "paper-draft.tex");

  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(draftDir)) {
    fs.mkdirSync(draftDir, { recursive: true });
  }

  fs.writeFileSync(draftFile, content, "utf-8");

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const backupFile = path.join(draftDir, `draft-${reason}-${timestamp}.tex`);
  fs.writeFileSync(backupFile, content, "utf-8");
}

app.get("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const userDir = getUserUploadDir(userId);
  const draftFile = path.join(userDir, "paper-draft.tex");
  const journalStyleDir = path.join(userDir, "journal-styles");
  
  let journalName = "";
  if (fs.existsSync(journalStyleDir)) {
    const styleFolders = fs.readdirSync(journalStyleDir);
    if (styleFolders.length > 0) journalName = styleFolders[0].replace(/_/g, ' ');
  }
  
  try {
    const drafts = await sessionStore.listDrafts(userId);
    if (drafts.length > 0) {
      const chapterOrder = ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
      const sortedDrafts = drafts.sort((a, b) => {
        const indexA = chapterOrder.indexOf(a.chapterName.toLowerCase());
        const indexB = chapterOrder.indexOf(b.chapterName.toLowerCase());
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
      });
      
      let combinedContent = '';
      for (const draft of sortedDrafts) {
        const draftData = await sessionStore.loadDraft(userId, draft.chapterName);
        if (draftData) {
          combinedContent += `\\section{${draft.chapterName.charAt(0).toUpperCase() + draft.chapterName.slice(1)}}\n`;
          combinedContent += draftData.content + '\n\n';
        }
      }
      
      if (combinedContent.length > 0) {
        logger.info(`[Draft] Loaded ${drafts.length} chapters from sessionStore for user ${userId}`);
        res.json({
          exists: true,
          content: combinedContent,
          journal_style: journalName || '目标期刊',
          filename: `paper-draft-${userId}`,
          chapters: drafts.map(d => d.chapterName),
          source: 'sessionStore'
        });
        return;
      }
    }
  } catch (error) {
    logger.warn(`[Draft] Failed to load from sessionStore: ${error}`);
  }
  
  if (fs.existsSync(draftFile)) {
    const content = fs.readFileSync(draftFile, 'utf-8');
    res.json({
      exists: true,
      content,
      journal_style: journalName || '目标期刊',
      filename: `paper-draft-${userId}`,
      source: 'legacy'
    });
  } else {
    res.json({
      exists: false,
      journal_style: journalName || '目标期刊'
    });
  }
});

// 下载草稿（支持多格式）
app.get("/api/draft/:userId/download", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const format = req.query.format as string || 'tex';
  
  try {
    // 获取草稿内容
    const userDir = getUserUploadDir(userId);
    const draftFile = path.join(userDir, "paper-draft.tex");
    
    let content = "";
    
    // 优先从 sessionStore 读取
    try {
      const drafts = await sessionStore.listDrafts(userId);
      if (drafts.length > 0) {
        const chapterOrder = ['title', 'abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
        const sortedDrafts = drafts.sort((a, b) => {
          const indexA = chapterOrder.indexOf(a.chapterName.toLowerCase());
          const indexB = chapterOrder.indexOf(b.chapterName.toLowerCase());
          if (indexA !== -1 && indexB !== -1) return indexA - indexB;
          if (indexA !== -1) return -1;
          if (indexB !== -1) return 1;
          return new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime();
        });
        
        for (const draft of sortedDrafts) {
          const draftData = await sessionStore.loadDraft(userId, draft.chapterName);
          if (draftData) {
            content += `\\section{${draft.chapterName.charAt(0).toUpperCase() + draft.chapterName.slice(1)}}\n`;
            content += draftData.content + '\n\n';
          }
        }
      }
    } catch (error) {
      logger.warn(`[Draft Download] Failed to load from sessionStore: ${error}`);
    }
    
    // 回退到文件
    if (!content && fs.existsSync(draftFile)) {
      content = fs.readFileSync(draftFile, 'utf-8');
    }
    
    if (!content) {
      res.status(404).json({ success: false, error: '草稿不存在' });
      return;
    }
    
    // 根据格式返回
    if (format === 'tex') {
      res.setHeader('Content-Type', 'application/x-tex');
      res.setHeader('Content-Disposition', 'attachment; filename="paper-draft.tex"');
      res.send(content);
    } else if (format === 'txt') {
      // 移除 LaTeX 标记，转为纯文本
      const plainText = content
        .replace(/\\[a-z]+\{([^}]*)\}/gi, '$1')
        .replace(/\\[a-z]+/gi, '')
        .replace(/[{}]/g, '')
        .replace(/\n{3,}/g, '\n\n');
      
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="paper-draft.txt"');
      res.send(plainText);
    } else if (format === 'zip') {
      // 创建 ZIP 文件
      const archive = archiver('zip', { zlib: { level: 9 } });
      
      // 添加错误处理
      archive.on('error', (err: Error) => {
        logger.error('[ZIP] Archive error:', err);
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: 'ZIP 创建失败' });
        }
      });
      
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="paper-draft.zip"');
      
      archive.pipe(res);
      archive.append(content, { name: 'paper-draft.tex' });
      
      // 添加一个简单的 README
      const readme = `# 论文草稿

## 使用说明

1. 将 paper-draft.tex 上传到 Overleaf
2. 选择 XeLaTeX 编译器 (Menu → Compiler → XeLaTeX)
3. 编译查看结果

## 格式说明

- 文件格式: LaTeX
- 编译器: XeLaTeX (支持中文)
- 创建时间: ${new Date().toLocaleString('zh-CN')}
`;
      archive.append(readme, { name: 'README.md' });
      
      archive.finalize();
    } else if (format === 'docx') {
      sendWordDraftDocx(res, content);
    } else {
      res.status(400).json({ success: false, error: '不支持的格式' });
    }
  } catch (error) {
    logger.error('[Draft Download] Error:', error);
    res.status(500).json({ success: false, error: '下载失败' });
  }
});

// 保存/更新论文草稿
app.post("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const { content, section, append = true } = req.body;
  const draftSection = sanitizeDraftChapterName(section || 'section');
  
  if (!content) {
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const userDir = getUserUploadDir(userId);
  const draftDir = path.join(userDir, "drafts");
  const draftFile = path.join(userDir, "paper-draft.tex");
  
  // 确保目录存在
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }
  if (!fs.existsSync(draftDir)) {
    fs.mkdirSync(draftDir, { recursive: true });
  }
  
  try {
    // 获取期刊风格信息（用于 LaTeX 格式）
    const journalStyleDir = path.join(userDir, "journal-styles");
    let latexStyle = "article";
    let citationStyle = "apalike";
    
    if (fs.existsSync(journalStyleDir)) {
      const styleFolders = fs.readdirSync(journalStyleDir);
      if (styleFolders.length > 0) {
        const styleFile = path.join(journalStyleDir, styleFolders[0], "style.json");
        if (fs.existsSync(styleFile)) {
          const styleData = JSON.parse(fs.readFileSync(styleFile, 'utf-8'));
          const citationFormat = styleData[0]?.citation_format;
          
          if (citationFormat) {
            if (citationFormat.reference_style === 'APA' || citationFormat.in_text_style === '作者年份制') {
              citationStyle = "apalike";
            } else if (citationFormat.reference_style === 'IEEE') {
              citationStyle = "ieeetr";
            } else if (citationFormat.reference_style === 'Nature') {
              citationStyle = "nature";
            } else if (citationFormat.reference_style === 'Chicago') {
              citationStyle = "chicago";
            }
          }
        }
      }
    }
    
    let existingContent = "";
    if (fs.existsSync(draftFile)) {
      existingContent = fs.readFileSync(draftFile, 'utf-8');
    }
    
    // 如果是第一个章节，需要添加 LaTeX 导言区
    if (!existingContent.includes("\\section{")) {
      const preamble = `\\documentclass[${latexStyle === 'nature' ? 'nature' : '12pt'}]{${latexStyle}}
\\usepackage{ctex}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{natbib}
\\usepackage{hyperref}
\\usepackage{setspace}
\\doublespacing

\\title{学术论文草稿}
\\author{作者}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
摘要内容待填写...
\\end{abstract}

`;
      
      existingContent = preamble;
    }
    
    let newContent = "";
    if (append && existingContent) {
      // 追加模式：在 \\end{document} 之前插入
      if (existingContent.includes("\\end{document}")) {
        const parts = existingContent.split("\\end{document}");
        newContent = parts[0] + content + "\n\n\\end{document}";
      } else {
        newContent = existingContent + "\n\n" + content;
      }
    } else {
      // 覆盖模式
      newContent = content;
    }
    
    fs.writeFileSync(draftFile, newContent, 'utf-8');
    
    // 同时保存一个备份（带时间戳）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const backupFile = path.join(draftDir, `draft-${draftSection}-${timestamp}.tex`);
    fs.writeFileSync(backupFile, newContent, 'utf-8');
    
    logger.info(`[Draft] Saved draft for user ${userId}, section: ${draftSection}`);
    
    res.json({
      success: true,
      message: "草稿已保存",
      filename: `paper-draft-${userId}.tex`
    });
    
  } catch (e) {
    logger.error("[Draft] Error:", e);
    res.json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

// 覆盖保存编辑后的论文草稿
app.put("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const content = req.body?.content;

  if (typeof content !== "string") {
    res.status(400).json({ success: false, error: "草稿内容格式无效" });
    return;
  }

  if (!content.trim()) {
    res.status(400).json({ success: false, error: "内容为空" });
    return;
  }

  try {
    writeDraftSnapshot(userId, content, "edited");

    const existingDrafts = await sessionStore.listDrafts(userId);
    for (const draft of existingDrafts) {
      await sessionStore.deleteDraft(userId, draft.chapterName);
    }

    const editedSections = splitEditedDraftSections(content);
    for (const section of editedSections) {
      await sessionStore.saveDraft(userId, section.chapterName, section.content);
    }

    logger.info(
      `[Draft] Edited draft saved for user ${userId}, sections: ${editedSections.length}, source: ${editedSections.length > 0 ? "sessionStore" : "legacy"}`
    );

    res.json({
      success: true,
      message: "草稿已更新",
      filename: `paper-draft-${userId}.tex`,
      source: editedSections.length > 0 ? "sessionStore" : "legacy",
      chapters: editedSections.map(section => section.chapterName),
    });
  } catch (e) {
    logger.error("[Draft] Edit save error:", e);
    res.status(500).json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

// 保存单个章节草稿到主草稿存储，供右侧文章结构面板实时编辑使用
app.post("/api/draft/:userId/chapter", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const chapter = sanitizeDraftChapterName(req.body?.chapter || "section");
  const content = req.body?.content;

  if (typeof content !== "string") {
    res.status(400).json({ success: false, error: "章节内容格式无效" });
    return;
  }

  try {
    await sessionStore.saveDraft(userId, chapter, content);

    const memory = await loadUserMemory(userId);
    let draftProgressEntry = memory.entries.find(e => e.key === "draft_progress");
    const value = `最后更新：${new Date().toLocaleString("zh-CN")} - 章节 ${chapter}，长度 ${content.length} 字符`;
    if (draftProgressEntry) {
      draftProgressEntry.value = value;
      draftProgressEntry.timestamp = new Date().toISOString();
      draftProgressEntry.source = "user-updated";
    } else {
      memory.entries.push({
        key: "draft_progress",
        value,
        source: "user-updated",
        timestamp: new Date().toISOString(),
      });
    }
    await saveUserMemory(memory);

    res.json({
      success: true,
      chapter,
      length: content.length,
      savedAt: new Date().toISOString(),
    });
  } catch (e) {
    logger.error("[Draft] Chapter save error:", e);
    res.status(500).json({ success: false, error: "保存章节失败：" + (e as Error).message });
  }
});

// ============ AI 智能草稿处理 ============

// AI 智能处理草稿保存
app.post("/api/draft/:userId/smart-save", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const { content, context } = req.body;
  
  if (!content || !content.trim()) {
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  logger.info(`[SmartDraft] Processing draft for user ${userId}, content length: ${content.length}`);
  
  // ====== 关键修改：优先使用请求中传递的API配置，确保使用用户页面配置的API ======
  const requestApiUrl = req.body.apiUrl || req.body.api_config?.url;
  const requestApiKey = req.body.apiKey || req.body.api_config?.key;
  const requestModel = req.body.model || req.body.api_config?.model;
  
  // 优先使用请求中的配置，其次是服务器当前配置，最后是环境变量
  const smartSaveApiUrl = requestApiUrl || currentApiUrl || process.env.API_URL || '';
  const smartSaveApiKey = requestApiKey || currentApiKey || process.env.API_KEY || '';
  const smartSaveModel = requestModel || currentModel || process.env.PRIMARY_MODEL || 'qwen3.5-plus';
  
  logger.info(`[SmartDraft] API Config - URL: ${smartSaveApiUrl ? '已配置' : '未配置'}, Key: ${smartSaveApiKey ? '已配置' : '未配置'}, Model: ${smartSaveModel}`);
  logger.info(`[SmartDraft] Source - Request: ${requestApiUrl ? '是' : '否'}, Current: ${currentApiUrl ? '是' : '否'}, Env: ${process.env.API_URL ? '是' : '否'}`);
  
  if (!smartSaveApiUrl || !smartSaveApiKey) {
    res.json({ 
      success: false, 
      error: "请先配置 API 设置（左下角 ⚙️ API 设置）",
      details: {
        requestHasUrl: !!requestApiUrl,
        requestHasKey: !!requestApiKey,
        currentHasUrl: !!currentApiUrl,
        currentHasKey: !!currentApiKey,
        envHasUrl: !!process.env.API_URL,
        envHasKey: !!process.env.API_KEY
      }
    });
    return;
  }

  try {
    // 构建AI提示词
    const systemPrompt = `你是一个学术论文写作助手。你的任务是分析对话内容，提取论文草稿并保存到正确的章节。

## 你需要做的事情：
1. **识别章节**：判断内容属于哪个章节（摘要、引言、材料和方法、结果、讨论、结论）
2. **整理内容**：
   - 删除无关的对话内容（如"好的"、"我明白了"等）
   - 删除重复内容
   - 保留所有学术论文内容
   - 正文中的引用必须统一为作者-年份格式，例如 (Zhang et al., 2026)
   - 如果原文是 [1]、[2-5] 等编号引用，请根据参考文献信息转换为作者-年份格式
3. **提取并格式化参考文献**：
   - 从对话内容中识别所有被引用的参考文献
   - 按照 GB/T 7714-2015 格式规范排列
   - 与正文引用标注一一对应

## 章节判断规则：
- 摘要/Abstract：包含研究目的、方法、主要结果、结论的概述
- 引言/Introduction：研究背景、文献综述、研究目的、假设
- 材料和方法/Methods：实验设计、材料、实验步骤、数据分析方法
- 结果/Results：实验数据、统计结果、图表描述
- 讨论/Discussion：结果解释、与已有研究对比、研究意义、局限性
- 结论/Conclusion：主要发现总结、未来研究方向

## 参考文献格式规范（GB/T 7714-2015）：
### 期刊论文 [J]：
作者. 题名[J]. 刊名, 年, 卷(期): 起止页码. DOI(如有).
示例：张三, 李四, 王五. 氮氧化物排放研究[J]. 环境科学, 2020, 41(3): 456-462. DOI: 10.xxxx/xxx.

### 书籍 [M]：
作者. 书名[M]. 出版地: 出版社, 年: 起止页码.
示例：Smith J. Climate Change[M]. London: Academic Press, 2019: 100-120.

### 学位论文 [D]：
作者. 题名[D]. 城市: 学校名称, 年.
示例：王明. 土壤碳排放研究[D]. 北京: 中国农业大学, 2021.

### 会议论文 [C]：
作者. 题名[C]//会议名称. 城市, 年: 赴止页码.

### 重要规则：
- 3位及以下作者全部列出
- 4位及以上作者列出前3位后加"等"或"et al."
- 中文作者姓前名后，外文作者姓前名缩写
- 参考文献按正文引用顺序编号排列

## 输出格式（JSON）：
\`\`\`json
{
  "section": "章节英文名（abstract/introduction/methods/results/discussion/conclusion）",
  "sectionName": "章节中文名",
  "content": "整理后的内容（正文引用统一使用作者-年份格式，如 (Zhang et al., 2026)）",
  "references": "格式化后的参考文献列表（按GB/T 7714格式，每条一行，含编号）"
}
\`\`\`

## 参考文献输出示例：
[1] Smith J, Jones M. Nitrogen cycling in soils[J]. Nature, 2020, 580(7803): 234-240.
[2] 张三, 李四. 农田温室气体排放研究[J]. 农业环境科学学报, 2019, 38(2): 300-310.

重要：只输出JSON，不要有其他内容。参考文献必须和正文引用一一对应。`;

    const userPrompt = `请分析以下对话内容，提取论文草稿：

---
${content}
---

请：
1. 识别章节
2. 整理内容（正文引用统一改为作者-年份格式，如 (Zhang et al., 2026)）
3. 提取参考文献并按 GB/T 7714 格式排列
4. 以JSON格式输出（参考文献和内容必须一起输出）`;

    let aiResponse: string = '';
    
    try {
      // 拼接正确的 API endpoint
      const apiEndpoint = smartSaveApiUrl.endsWith('/chat/completions') 
        ? smartSaveApiUrl 
        : smartSaveApiUrl.replace(/\/$/, '') + '/chat/completions';
      logger.info(`[SmartDraft] Using user-configured API: ${smartSaveApiUrl}, model: ${smartSaveModel}`);
      
      const apiResponse = await fetch(apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${smartSaveApiKey}`,
        },
        body: JSON.stringify({
          model: smartSaveModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.3,
        }),
      });
      
      const data = await apiResponse.json() as any;
      aiResponse = data.choices?.[0]?.message?.content || '';
      logger.info(`[SmartDraft] API response received, length: ${aiResponse.length}`);
    } catch (e) {
      logger.error('[SmartDraft] API call failed:', e);
      res.json({ success: false, error: "API 调用失败：" + (e as Error).message });
      return;
    }
    
    if (!aiResponse) {
      res.json({ success: false, error: "AI 响应为空，请检查 API 配置" });
      return;
    }
    
    // 解析 AI 响应
    let parsedResult: {
      section: string;
      sectionName: string;
      content: string;
      references?: string;
    };
    
    try {
      // 尝试提取 JSON
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                        aiResponse.match(/\{[\s\S]*\}/);
      
      if (jsonMatch) {
        parsedResult = JSON.parse(jsonMatch[1] || jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (e) {
      logger.error('[SmartDraft] Failed to parse AI response:', e);
      res.json({ 
        success: false, 
        error: "AI 响应解析失败",
        rawResponse: aiResponse.substring(0, 500)
      });
      return;
    }
    
    // 验证章节
    const validSections = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
    if (!validSections.includes(parsedResult.section)) {
      parsedResult.section = 'introduction'; // 默认章节
    }
    
    // 保存草稿 - 使用 SessionStore 确保与论文草稿按钮读取路径一致
    // SessionStore 保存路径: {dataDir}/{userId}/drafts/{section}.json
    // 这样左上角"📝 论文草稿"按钮能正确读取
    const userDir = getUserUploadDir(userId);
    
    // 追加模式：先读取已有内容
    let existingDraft = await sessionStore.loadDraft(userId, parsedResult.section);
    
    // 构建最终内容：章节内容 + 参考文献（一起保存到草稿）
    let chapterContent = parsedResult.content;
    
    // 如果有参考文献，附加到章节内容后面
    if (parsedResult.references && parsedResult.references.trim()) {
      // 添加参考文献标题和列表
      chapterContent = chapterContent + '\n\n## 参考文献\n\n' + parsedResult.references;
      logger.info(`[SmartDraft] References attached to content - length: ${parsedResult.references.length}`);
    }
    
    let finalContent = chapterContent;
    
    // 检查是否有强制操作模式（用户已确认后的第二次请求）
    const forceAction = req.body.forceAction as 'overwrite' | 'append' | undefined;
    
    if (existingDraft && existingDraft.content) {
      // ====== 智能重复检测 ======
      // 如果用户已经确认了操作，直接执行
      if (forceAction === 'overwrite') {
        logger.info(`[SmartDraft] User confirmed: OVERWRITE mode for ${parsedResult.section}`);
        finalContent = chapterContent;
      } else if (forceAction === 'append') {
        logger.info(`[SmartDraft] User confirmed: APPEND mode for ${parsedResult.section}`);
        // 检查是否已有参考文献部分，避免重复
        const existingHasRefs = existingDraft.content.includes('## 参考文献');
        const newHasRefs = parsedResult.references && parsedResult.references.trim();
        
        if (existingHasRefs && newHasRefs) {
          const newContentWithoutRefs = parsedResult.content;
          const newRefsOnly = parsedResult.references;
          finalContent = existingDraft.content + '\n\n' + newContentWithoutRefs + '\n\n' + newRefsOnly;
        } else {
          finalContent = existingDraft.content + '\n\n' + chapterContent;
        }
      } else {
        // 用户未确认，进行智能检测
        const duplicateDetection = detectDraftDuplicate(existingDraft.content, chapterContent);
        logger.info(`[SmartDraft] Duplicate detection for ${parsedResult.section}: similarity=${Math.round(duplicateDetection.similarity * 100)}%, needsConfirmation=${duplicateDetection.needsConfirmation}`);
        
        if (duplicateDetection.needsConfirmation) {
          // 需要用户确认，返回特殊响应
          res.json({
            success: false,
            needsConfirmation: true,
            section: parsedResult.section,
            sectionName: parsedResult.sectionName,
            existingContentPreview: existingDraft.content.substring(0, 300) + (existingDraft.content.length > 300 ? '...' : ''),
            existingContentLength: existingDraft.content.length,
            existingSavedAt: existingDraft.savedAt,
            newContentPreview: chapterContent.substring(0, 300) + (chapterContent.length > 300 ? '...' : ''),
            newContentLength: chapterContent.length,
            similarity: duplicateDetection.similarity,
            reason: duplicateDetection.reason,
            message: `⚠️ 检测到「${parsedResult.sectionName}」章节已有内容。请选择处理方式：`,
            options: [
              { action: 'overwrite', label: '覆盖原有内容', description: '删除旧版本，保存新版本' },
              { action: 'append', label: '增量追加', description: '保留旧内容，追加新内容' }
            ]
          });
          return;
        }
        
        // 不需要确认，自动选择追加模式（内容差异较大）
        const existingHasRefs = existingDraft.content.includes('## 参考文献');
        const newHasRefs = parsedResult.references && parsedResult.references.trim();
        
        if (existingHasRefs && newHasRefs) {
          const newContentWithoutRefs = parsedResult.content;
          const newRefsOnly = parsedResult.references;
          finalContent = existingDraft.content + '\n\n' + newContentWithoutRefs + '\n\n' + newRefsOnly;
          logger.info(`[SmartDraft] Auto-append (low similarity) - refs merged`);
        } else {
          finalContent = existingDraft.content + '\n\n' + chapterContent;
          logger.info(`[SmartDraft] Auto-append (low similarity) - existing length: ${existingDraft.content.length}, new length: ${chapterContent.length}`);
        }
      }
    }
    
    // 使用 SessionStore 保存（内容已包含参考文献）
    await sessionStore.saveDraft(userId, parsedResult.section, finalContent);
    
    // 同时保存参考文献到独立的 references.bib 文件（作为备份，供 LaTeX 编译使用）
    if (parsedResult.references && parsedResult.references.trim()) {
      const refFile = path.join(userDir, "references.bib");
      const existingRefs = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf-8') : '';
      
      // 去重保存：检查新参考文献是否已存在
      const newRefLines = parsedResult.references.split('\n').filter(line => line.trim());
      const existingRefLines = existingRefs.split('\n').filter(line => line.trim());
      
      // 只追加不存在的新文献
      const uniqueNewRefs = newRefLines.filter(newLine => 
        !existingRefLines.some(existingLine => 
          existingLine.includes(newLine.substring(0, 50)) // 比较前50字符判断重复
        )
      );
      
      if (uniqueNewRefs.length > 0) {
        fs.writeFileSync(refFile, existingRefs + '\n' + uniqueNewRefs.join('\n'), 'utf-8');
        logger.info(`[SmartDraft] References saved to ${refFile} (${uniqueNewRefs.length} new entries)`);
      } else {
        logger.info(`[SmartDraft] No new unique references to save to references.bib`);
      }
    }
    
    logger.info(`[SmartDraft] Save completed via SessionStore - final length: ${finalContent.length}, section: ${parsedResult.section}`);
    
    res.json({
      success: true,
      section: parsedResult.section,
      sectionName: parsedResult.sectionName,
      content: parsedResult.content,
      references: parsedResult.references || '',
      hasReferences: !!parsedResult.references && parsedResult.references.trim().length > 0,
      message: parsedResult.references && parsedResult.references.trim()
        ? `已智能保存到「${parsedResult.sectionName}」章节（含参考文献，按 GB/T 7714 格式）`
        : `已智能保存到「${parsedResult.sectionName}」章节`,
      apiUsed: {
        url: smartSaveApiUrl.replace(/\/\/([^@]+)@/, '//***@'), // 隐藏密钥
        model: smartSaveModel
      }
    });
    
  } catch (e) {
    logger.error("[SmartDraft] Error:", e);
    res.json({ success: false, error: "处理失败：" + (e as Error).message });
  }
});

// 清空草稿
app.delete("/api/draft/:userId", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const userDir = getUserUploadDir(userId);
  const draftFile = path.join(userDir, "paper-draft.tex");
  
  try {
    if (fs.existsSync(draftFile)) {
      fs.unlinkSync(draftFile);
    }

    const drafts = await sessionStore.listDrafts(userId);
    for (const draft of drafts) {
      await sessionStore.deleteDraft(userId, draft.chapterName);
    }

    logger.info(`[Draft] Deleted draft for user ${userId}, chapters: ${drafts.length}`);
    res.json({ success: true });
  } catch (e) {
    logger.error("[Draft] Delete error:", e);
    res.status(500).json({ success: false, error: "删除失败：" + (e as Error).message });
  }
});

// ============ 草稿确认操作（覆盖/追加） ============

/**
 * 确认草稿操作接口
 * 当用户选择覆盖或追加后，调用此接口执行实际操作
 * 
 * @param userId - 用户ID
 * @param section - 章节名称（如 results, introduction）
 * @param action - 用户选择的操作：'overwrite' 或 'append'
 * @param content - 新内容
 * @param references - 参考文献（可选）
 */
app.post("/api/draft/:userId/confirm-action", async (req: Request, res: Response) => {
  const userId = sanitizeUserId(req.params.userId);
  const { section, action, content, references } = req.body;
  const draftSection = sanitizeDraftChapterName(section);
  
  logger.info(`[DraftConfirm] User ${userId} confirmed action: ${action} for section: ${draftSection}`);
  
  if (!section || !content) {
    res.json({ success: false, error: "缺少必要参数：section 或 content" });
    return;
  }
  
  if (action !== 'overwrite' && action !== 'append') {
    res.json({ success: false, error: "无效操作类型：必须为 'overwrite' 或 'append'" });
    return;
  }
  
  try {
    // 构建章节内容（包含参考文献）
    let chapterContent = content;
    if (references && references.trim()) {
      chapterContent = content + '\n\n## 参考文献\n\n' + references;
    }
    
    let finalContent = chapterContent;
    
    // 读取已有草稿
    const existingDraft = await sessionStore.loadDraft(userId, draftSection);
    
    if (action === 'overwrite') {
      // 覆盖模式：直接替换
      finalContent = chapterContent;
      logger.info(`[DraftConfirm] OVERWRITE: replacing ${draftSection} with new content (${chapterContent.length} chars)`);
    } else if (action === 'append' && existingDraft && existingDraft.content) {
      // 追加模式：合并内容
      const existingHasRefs = existingDraft.content.includes('## 参考文献');
      const newHasRefs = references && references.trim();
      
      if (existingHasRefs && newHasRefs) {
        // 已有参考文献，只追加新内容（不含参考文献标题）
        finalContent = existingDraft.content + '\n\n' + content + '\n\n' + references;
        logger.info(`[DraftConfirm] APPEND with refs merge`);
      } else {
        // 直接追加完整内容
        finalContent = existingDraft.content + '\n\n' + chapterContent;
        logger.info(`[DraftConfirm] APPEND: ${existingDraft.content.length} + ${chapterContent.length} chars`);
      }
    }
    
    // 保存草稿
    await sessionStore.saveDraft(userId, draftSection, finalContent);
    
    // 同时更新 references.bib（如果有新的参考文献）
    if (references && references.trim()) {
      const userDir = getUserUploadDir(userId);
      const refFile = path.join(userDir, "references.bib");
      const existingRefs = fs.existsSync(refFile) ? fs.readFileSync(refFile, 'utf-8') : '';
      
      // 去重保存
      const newRefLines = references.split('\n').filter((line: string) => line.trim());
      const existingRefLines = existingRefs.split('\n').filter((line: string) => line.trim());
      
      const uniqueNewRefs = newRefLines.filter((newLine: string) => 
        !existingRefLines.some((existingLine: string) => 
          existingLine.includes(newLine.substring(0, 50))
        )
      );
      
      if (uniqueNewRefs.length > 0) {
        fs.writeFileSync(refFile, existingRefs + '\n' + uniqueNewRefs.join('\n'), 'utf-8');
        logger.info(`[DraftConfirm] References saved (${uniqueNewRefs.length} new entries)`);
      }
    }
    
    logger.info(`[DraftConfirm] SUCCESS: ${action} completed for ${draftSection}`);
    
    res.json({
      success: true,
      action: action,
      section: draftSection,
      contentLength: finalContent.length,
      message: action === 'overwrite' 
        ? `✅ 已覆盖「${draftSection}」章节内容` 
        : `✅ 已追加到「${draftSection}」章节（内容长度：${finalContent.length}字）`
    });
    
  } catch (e) {
    logger.error("[DraftConfirm] Error:", e);
    res.json({ success: false, error: "操作失败：" + (e as Error).message });
  }
});

// ============ 章节草稿管理（使用 SessionStore） ============

// 保存章节草稿（支持追加模式）
app.post("/api/chapter-draft/:userId", async (req: Request, res: Response) => {
  try {
    const { chapter, content, append = false } = req.body;
    const userId = sanitizeUserId(req.params.userId);
    const draftChapter = sanitizeDraftChapterName(chapter);

    if (!String(chapter || '').trim() || typeof content !== 'string') {
      res.status(400).json({ success: false, error: "缺少必要参数：chapter 或 content" });
      return;
    }
    
    const draftDir = path.join(dataDir, 'output', 'chapters', userId);
    if (!fs.existsSync(draftDir)) {
      fs.mkdirSync(draftDir, { recursive: true });
    }
    
    const filePath = path.join(draftDir, `${draftChapter}.md`);
    
    // 如果是追加模式，读取现有内容并追加
    let finalContent = content;
    if (append && fs.existsSync(filePath)) {
      const existingContent = fs.readFileSync(filePath, 'utf-8');
      finalContent = existingContent + '\n\n' + content;
      logger.info(`[ChapterDraft] Appended for user ${userId}, chapter ${draftChapter}`);
    } else {
      logger.info(`[ChapterDraft] Created/Overwritten for user ${userId}, chapter ${draftChapter}`);
    }
    
    fs.writeFileSync(filePath, finalContent, 'utf-8');
    
    // 同时保存到 memory.json 中的 draft_progress
    // 记录最新更新时间
    const memory = await await loadUserMemory(userId);
    const draftProgressEntry = memory.entries.find(e => e.key === 'draft_progress');
    if (draftProgressEntry) {
      draftProgressEntry.value = `最后更新：${new Date().toLocaleString('zh-CN')} - 章节 ${draftChapter}`;
      draftProgressEntry.timestamp = new Date().toISOString();
    } else {
      memory.entries.push({
        key: 'draft_progress',
        value: `最后更新：${new Date().toLocaleString('zh-CN')} - 章节 ${draftChapter}`,
        source: 'ai-extracted',
        timestamp: new Date().toISOString()
      });
    }
    await saveUserMemory(memory);
    
    res.json({ success: true, filePath, mode: append ? 'append' : 'overwrite' });
  } catch (e) {
    logger.error("[ChapterDraft] Save failed:", e);
    res.json({ success: false, error: "保存失败：" + (e as Error).message });
  }
});

app.delete("/api/chapter-draft/:userId/:chapter", async (req: Request, res: Response) => {
  try {
    const userId = sanitizeUserId(req.params.userId);
    const chapter = sanitizeDraftChapterName(req.params.chapter);
    
    const filePath = path.join(dataDir, 'output', 'chapters', userId, `${chapter}.md`);
    
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    logger.info(`[ChapterDraft] Deleted for user ${userId}, chapter ${chapter}`);
    res.json({ success: true });
  } catch (e) {
    logger.error("[ChapterDraft] Delete failed:", e);
    res.json({ success: false, error: "删除失败：" + (e as Error).message });
  }
});

// 1. 保存实验资料总结（专用接口）
app.post("/api/research-material/save", async (req: Request, res: Response) => {
  const { content, append = true, apiKey, apiUrl, model } = req.body;
  const userId = "web-user";
  
  const useApiKey = apiKey || process.env.API_KEY || "";
  const useApiUrl = apiUrl || process.env.API_URL || "";
  const useModel = model || currentModel || "qwen3.5-plus";
  
  logger.info(`[ResearchMaterial] API called - userId: ${userId}, content length: ${content?.length || 0}, append: ${append}`);
  logger.info(`[ResearchMaterial] Using API URL: ${useApiUrl}, API Key provided: ${useApiKey ? 'YES' : 'NO (using env)'}`);
  
  if (!content) {
    logger.warn(`[ResearchMaterial] Rejected - empty content`);
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const memory = await loadUserMemory(userId);
  let existingEntry = memory.entries.find(e => e.key === 'experiment_summary');
  
  if (!existingEntry) {
    logger.info(`[ResearchMaterial] Creating new entry for experiment_summary`);
    existingEntry = {
      key: 'experiment_summary',
      value: '',
      source: 'user-updated',
      timestamp: new Date().toISOString()
    };
    memory.entries.push(existingEntry);
  } else {
    logger.info(`[ResearchMaterial] Found existing entry - current length: ${existingEntry.value?.length || 0}`);
  }
  
  let finalContent = content;
  if (append && existingEntry.value) {
    logger.info(`[ResearchMaterial] Append mode - merging with existing content`);
    try {
      const mergeStartTime = Date.now();
      const mergedResponse = await fetch(useApiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + useApiKey,
        },
        body: JSON.stringify({
          model: useModel,
          messages: [
            { role: "system", content: "You are a research data management expert. Merge new experimental content with existing content. Remove duplicates, organize logically, and output the complete merged document without explanations or markers like '新增' or '补充'." },
            { role: "user", content: `Existing content:\n${existingEntry.value.substring(0, 28000)}\n\nNew content:\n${content.substring(0, 8000)}\n\nPlease merge these two experimental materials into a coherent document.` }
          ],
          temperature: 0.2,
          max_tokens: MAX_LLM_OUTPUT_TOKENS,
        }),
      });
      
      const mergeDuration = Date.now() - mergeStartTime;
      logger.info(`[ResearchMaterial] AI merge request completed in ${mergeDuration}ms - status: ${mergedResponse.status}`);
      
      if (mergedResponse.ok) {
        const data = await mergedResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = data.choices?.[0]?.message?.content;
        if (merged && merged.length > 10) {
          finalContent = merged.trim();
          logger.info(`[ResearchMaterial] AI merge successful - merged content length: ${finalContent.length}`);
        } else {
          logger.warn(`[ResearchMaterial] AI merge returned empty or invalid content, using simple append`);
          finalContent = existingEntry.value + "\n\n---\n\n" + content;
        }
      } else {
        const errorText = await mergedResponse.text();
        logger.error(`[ResearchMaterial] AI merge failed - status: ${mergedResponse.status}, error: ${errorText}`);
        finalContent = existingEntry.value + "\n\n---\n\n" + content;
      }
    } catch (e) {
      logger.error(`[ResearchMaterial] AI merge exception: ${(e as Error).message}, using simple append`);
      finalContent = existingEntry.value + "\n\n---\n\n" + content;
    }
  } else {
    logger.info(`[ResearchMaterial] Overwrite mode or no existing content - saving new content directly`);
  }
  
  existingEntry.value = finalContent;
  existingEntry.timestamp = new Date().toISOString();
  saveUserMemory(memory);
  
  logger.info(`[ResearchMaterial] Save completed - final length: ${finalContent.length}, saved to memory.json`);
  
  res.json({ 
    success: true, 
    length: finalContent.length,
    characters: finalContent.length
  });
});

// 2. 保存数据详细总结（专用接口）
app.post("/api/data-summary/save", async (req: Request, res: Response) => {
  const { content, append = true, apiKey, apiUrl, model } = req.body;
  const userId = "web-user";
  
  const useApiKey = apiKey || process.env.API_KEY || "";
  const useApiUrl = apiUrl || process.env.API_URL || "";
  const useModel = model || currentModel || "qwen3.5-plus";
  
  logger.info(`[DataSummary] API called - userId: ${userId}, content length: ${content?.length || 0}, append: ${append}`);
  logger.info(`[DataSummary] Using API URL: ${useApiUrl}, API Key provided: ${useApiKey ? 'YES' : 'NO (using env)'}`);
  
  if (!content) {
    logger.warn(`[DataSummary] Rejected - empty content`);
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const memory = await loadUserMemory(userId);
  let existingEntry = memory.entries.find(e => e.key === 'data_summary');
  
  if (!existingEntry) {
    logger.info(`[DataSummary] Creating new entry for data_summary`);
    existingEntry = {
      key: 'data_summary',
      value: '',
      source: 'user-updated',
      timestamp: new Date().toISOString()
    };
    memory.entries.push(existingEntry);
  } else {
    logger.info(`[DataSummary] Found existing entry - current length: ${existingEntry.value?.length || 0}`);
  }
  
  let finalContent = content;
  if (append && existingEntry.value) {
    logger.info(`[DataSummary] Append mode - merging with existing content`);
    try {
      const mergeStartTime = Date.now();
      const mergedResponse = await fetch(useApiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + useApiKey,
        },
        body: JSON.stringify({
          model: useModel,
          messages: [
            { role: "system", content: "You are a research data management expert. Merge new data analysis with existing data. Preserve all numerical values, statistics, and results. Remove duplicates, organize logically, and output the complete merged document without explanations." },
            { role: "user", content: `Existing data:\n${existingEntry.value.substring(0, 28000)}\n\nNew data:\n${content.substring(0, 8000)}\n\nPlease merge these data analyses into a coherent document.` }
          ],
          temperature: 0.2,
          max_tokens: MAX_LLM_OUTPUT_TOKENS,
        }),
      });
      
      const mergeDuration = Date.now() - mergeStartTime;
      logger.info(`[DataSummary] AI merge request completed in ${mergeDuration}ms - status: ${mergedResponse.status}`);
      
      if (mergedResponse.ok) {
        const data = await mergedResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = data.choices?.[0]?.message?.content;
        if (merged && merged.length > 10) {
          finalContent = merged.trim();
          logger.info(`[DataSummary] AI merge successful - merged content length: ${finalContent.length}`);
        } else {
          logger.warn(`[DataSummary] AI merge returned empty or invalid content, using simple append`);
          finalContent = existingEntry.value + "\n\n---\n\n" + content;
        }
      } else {
        const errorText = await mergedResponse.text();
        logger.error(`[DataSummary] AI merge failed - status: ${mergedResponse.status}, error: ${errorText}`);
        finalContent = existingEntry.value + "\n\n---\n\n" + content;
      }
    } catch (e) {
      logger.error(`[DataSummary] AI merge exception: ${(e as Error).message}, using simple append`);
      finalContent = existingEntry.value + "\n\n---\n\n" + content;
    }
  } else {
    logger.info(`[DataSummary] Overwrite mode or no existing content - saving new content directly`);
  }
  
  existingEntry.value = finalContent;
  existingEntry.timestamp = new Date().toISOString();
  saveUserMemory(memory);
  
  logger.info(`[DataSummary] Save completed - final length: ${finalContent.length}, saved to memory.json`);
  
  res.json({ 
    success: true, 
    length: finalContent.length,
    characters: finalContent.length
  });
});

// 3. 保存论文草稿（专用接口）
app.post("/api/paper-draft/save", async (req: Request, res: Response) => {
  const { content, append = true, apiKey, apiUrl, model, section = "main" } = req.body;
  const userId = "web-user";
  
  const useApiKey = apiKey || process.env.API_KEY || "";
  const useApiUrl = apiUrl || process.env.API_URL || "";
  const useModel = model || currentModel || "qwen3.5-plus";
  
  logger.info(`[PaperDraft] API called - userId: ${userId}, section: ${section}, content length: ${content?.length || 0}, append: ${append}`);
  logger.info(`[PaperDraft] Using API URL: ${useApiUrl}, API Key provided: ${useApiKey ? 'YES' : 'NO (using env)'}`);
  
  if (!content) {
    logger.warn(`[PaperDraft] Rejected - empty content`);
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  const memory = await loadUserMemory(userId);
  let existingEntry = memory.entries.find(e => e.key === 'draft_progress');
  
  if (!existingEntry) {
    logger.info(`[PaperDraft] Creating new entry for draft_progress`);
    existingEntry = {
      key: 'draft_progress',
      value: '',
      source: 'ai-extracted',
      timestamp: new Date().toISOString()
    };
    memory.entries.push(existingEntry);
  } else {
    logger.info(`[PaperDraft] Found existing entry - current length: ${existingEntry.value?.length || 0}`);
  }
  
  let finalContent = content;
  if (append && existingEntry.value) {
    logger.info(`[PaperDraft] Append mode - merging with existing content`);
    try {
      const mergeStartTime = Date.now();
      const mergedResponse = await fetch(useApiUrl + "/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + useApiKey,
        },
        body: JSON.stringify({
          model: useModel,
          messages: [
            { role: "system", content: "You are an academic writing expert. Merge new draft content with existing draft. Maintain coherence, consistent style and terminology. Insert new content at appropriate positions, not just at the end. Output the complete merged academic paper without explanations." },
            { role: "user", content: `Existing draft:\n${existingEntry.value.substring(0, 28000)}\n\nNew content:\n${content.substring(0, 8000)}\n\nPlease merge these into a coherent academic paper draft.` }
          ],
          temperature: 0.2,
          max_tokens: MAX_LLM_OUTPUT_TOKENS,
        }),
      });
      
      const mergeDuration = Date.now() - mergeStartTime;
      logger.info(`[PaperDraft] AI merge request completed in ${mergeDuration}ms - status: ${mergedResponse.status}`);
      
      if (mergedResponse.ok) {
        const data = await mergedResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
        const merged = data.choices?.[0]?.message?.content;
        if (merged && merged.length > 10) {
          finalContent = merged.trim();
          logger.info(`[PaperDraft] AI merge successful - merged content length: ${finalContent.length}`);
        } else {
          logger.warn(`[PaperDraft] AI merge returned empty or invalid content, using simple append`);
          finalContent = existingEntry.value + "\n\n---\n\n" + content;
        }
      } else {
        const errorText = await mergedResponse.text();
        logger.error(`[PaperDraft] AI merge failed - status: ${mergedResponse.status}, error: ${errorText}`);
        finalContent = existingEntry.value + "\n\n---\n\n" + content;
      }
    } catch (e) {
      logger.error(`[PaperDraft] AI merge exception: ${(e as Error).message}, using simple append`);
      finalContent = existingEntry.value + "\n\n---\n\n" + content;
    }
  } else {
    logger.info(`[PaperDraft] Overwrite mode or no existing content - saving new content directly`);
  }
  
  existingEntry.value = finalContent;
  existingEntry.timestamp = new Date().toISOString();
  saveUserMemory(memory);
  
  logger.info(`[PaperDraft] Save completed - final length: ${finalContent.length}, saved to memory.json`);
  
  res.json({ 
    success: true, 
    length: finalContent.length,
    characters: finalContent.length,
    section: section
  });
});

// ============ 全局共享组件（飞书和 Web UI 共用） ============

// 多用户检索引擎管理器 - 每个用户独立的文献索引（解决 C5: 多用户数据隔离）
// 注意：使用 Embedding API 配置，而不是聊天 API 配置
const retrievalEngineManager = initRetrievalEngineManager({
  apiUrl: currentEmbeddingConfig.url,
  apiKey: currentEmbeddingConfig.key,
  embeddingModel: currentEmbeddingConfig.model,
  embeddingDimensions: currentEmbeddingConfig.dimensions,
  maxEngines: 20, // 最多缓存 20 个用户的引擎
  idleTimeoutMs: 30 * 60 * 1000, // 30 分钟空闲超时
});

// 为向后兼容，保留全局检索引擎引用
// 注意：新代码应该使用 await retrievalEngineManager.getEngine(userId)
// 这里先创建一个空实例，在 initializeLiteratureIndex 中会被正确的用户引擎替换
let globalRetrievalEngine = new HybridRetrievalEngine({
  vector: {
    model: currentEmbeddingConfig.model,
    dimensions: currentEmbeddingConfig.dimensions,
    topN: 50,
    similarity: 'cosine',
  }
}, {
  url: currentEmbeddingConfig.url,
  key: currentEmbeddingConfig.key
});

// 启动时初始化文献索引 - 加载 web-user 的文献数据
// 使用 setImmediate 确保不阻塞事件循环，让 /health 端点可以响应
async function initializeLiteratureIndex(): Promise<void> {
  // 立即让出事件循环，确保 HTTP 服务器可以响应
  await new Promise(resolve => setImmediate(resolve));
  
  try {
    // 使用多用户管理器获取 web-user 的引擎
    // 管理器会自动加载 literature.json 和缓存
    const engine = await retrievalEngineManager.getEngine('web-user');
    
    // 更新全局引用（向后兼容）
    globalRetrievalEngine = engine;
    if (globalConversationFlow) {
      globalConversationFlow.setRetrievalEngine(engine);
    }
    
    // 设置文献路由使用全局引擎
    setRetrievalEngine(engine);
    
    const docCount = engine.getDocumentCount();
    if (docCount > 0) {
      logger.info(`[Startup] Initialized literature index for web-user (${docCount} papers)`);
    } else {
      logger.info('[Startup] Literature index initialized (empty)');
    }
  } catch (error) {
    logger.error('[Startup] Failed to initialize literature index:', error);
  }
}

// 全局消息处理器 - 用于飞书和 Web UI
const globalMessageHandler = {
  async send(userId: string, message: string): Promise<void> {
    // Web UI 的 send 实现（通过 HTTP 响应）
    logger.info(`[GlobalHandler] Message to ${userId}: ${message.substring(0, 50)}...`);
  },
  async handle(userId: string, message: string): Promise<string> {
    return await processChatMessage(userId, message);
  },
};

// 全局 ConversationFlow - 管理所有用户的会话状态
const globalConversationFlow = new ConversationFlow(
  globalMessageHandler,
  sessionStore,
  { 
    apiUrl: currentApiUrl, 
    apiKey: currentApiKey,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
    maxConcurrency: 5,
    promptClient: cloudPromptClient,
    useCloudPrompt: process.env.CLOUD_PROMPTS_DISABLED !== '1',
  },
  globalRetrievalEngine  // 传入共享的检索引擎实例
);

function createCurrentLLMApiClient(defaultTemperature: number, label: string) {
  return {
    async chat(options: ChatOptions): Promise<string> {
      const client = createLLMApiClient({
        apiUrl: currentApiUrl,
        apiKey: currentApiKey,
        defaultTemperature,
        label,
      });
      return client.chat(options);
    },
  };
}

// 全局 Agent 协作流程 - 大牛马和小牛马协作
const globalCollaborationWorkflow = new AgentCollaborationWorkflow(
  createCurrentLLMApiClient(0.7, "CollaborationWorkflow"),
  globalRetrievalEngine,
  {
    primaryModel: primaryModel,
    apiUrl: currentApiUrl,
    apiKey: currentApiKey,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-v4',
    promptClient: cloudPromptClient,
    useCloudPrompt: process.env.CLOUD_PROMPTS_DISABLED !== '1',
  }
);

// 全局小牛马 Agent - 自动检索文献
const globalCowAgent = new CowAgent(
  createCurrentLLMApiClient(0.3, "CowAgent"),
  globalRetrievalEngine,
  process.env.SECONDARY_MODEL || "gpt-4o"
);

// 初始化统一聊天处理器
initializeUnifiedChatProcessor({
  sessionStore,
  retrievalEngine: globalRetrievalEngine,
  cowAgent: globalCowAgent,
  collaborationWorkflow: globalCollaborationWorkflow,
  soulContent
});
logger.info('[Startup] Unified chat processor initialized');

// ============ 飞书配置（支持运行时动态更新） ============

// ============ AI 总结生成 API ============

// 生成结构化实验资料总结
app.post("/api/summary/generate", async (req: Request, res: Response) => {
  const { content, type, apiKey, apiUrl, model = "qwen3.5-plus" } = req.body;
  
  // 必须使用用户提供的 API 配置
  if (!apiKey || !apiUrl) {
    res.json({ success: false, error: "未配置 API，请在左下角设置 API 地址和密钥" });
    return;
  }
  
  const useApiKey = apiKey;
  const useApiUrl = apiUrl;
  
  if (!content) {
    res.json({ success: false, error: "内容为空" });
    return;
  }
  
  if (!type || !['experiment', 'data'].includes(type)) {
    res.json({ success: false, error: "类型无效，应为 'experiment' 或 'data'" });
    return;
  }
  
  try {
    logger.info(`[Summary] Generating ${type} summary, content length: ${content.length}`);
    
    const isExperiment = type === 'experiment';
    const summaryProfile = getProjectWritingProfile(projectManager.getCurrentProject().writingProfileId);
    const isPaperProfile = summaryProfile.id === 'paper-writing' || summaryProfile.id === 'thesis-writing';
    const summaryPrompt = isExperiment && !isPaperProfile
      ? `请对以下“${summaryProfile.label}”项目资料进行结构化总结，生成一份清晰、简洁的项目资料总结。

## 原始项目资料
${content.substring(0, 15000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📋 项目背景
[一句话概括项目背景和写作目标]

### 🎯 核心目标
[明确该文稿/项目要解决的问题、目标或交付要求]

### 🧩 关键材料
- 资料来源：[用户提供了哪些材料]
- 核心对象：[基金项目/技术方案/软件系统/商业项目/待审稿件等]
- 约束条件：[格式、受众、时间、范围、合规或提交要求]

### 🔬 方法或方案
- 主要思路：[技术路线、商业模式、申报逻辑、审阅框架或写作方案]
- 关键步骤：[可执行步骤或章节组织]

### 📊 关键要点
- [要点1]
- [要点2]
- [要点3]

### 💡 核心结论
[一句话总结当前资料对后续写作的支撑价值]

### 📝 待确认事项
[仍缺少或需要用户确认的信息]

要求：
1. 不要硬套实验设计、试验地、处理组、土壤指标等论文实验术语。
2. 保留所有关键数值、名称、限制条件和用户明确要求。
3. 结构清晰，便于后续${summaryProfile.shortLabel}使用。
4. 总字数控制在800-1500字`
      : isExperiment 
      ? `请对以下实验资料进行结构化总结，生成一份清晰、简洁的实验资料全面总结。

## 原始实验资料
${content.substring(0, 15000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📋 研究背景
[一句话概括研究背景和意义]

### 🎯 实验目的
[明确实验的主要目标]

### 📍 实验地点、对象与环境
- 地点或来源：[具体地点、机构、样本来源或数据来源]
- 环境条件：[温度、湿度、时间、场景、平台或其他背景条件]
- 研究对象/材料属性：[对象类型、样本特征、材料性质或系统参数]
- 基础指标：[用户提供的物理、化学、生物、人口学、技术或运行指标；有就填，没有就留空]

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

### 📝 补充说明
[其他重要信息，如年际变异、特殊情况等]

要求：
1. 保留所有关键数值（环境条件、样本/材料属性、基础指标、实验参数等）
2. 结构清晰，层次分明
3. 语言简洁专业
4. 总字数控制在800-1500字`
      : !isPaperProfile
        ? `请对以下“${summaryProfile.label}”项目数据和关键要点进行结构化总结，生成一份清晰、简洁的结果/要点总结。

## 原始资料
${content.substring(0, 15000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📊 信息概览
- 资料类型：[市场数据/技术指标/评审问题/功能清单/财务假设/其他]
- 数据或要点范围：[覆盖哪些方面]
- 完整性：[是否充足，缺什么]

### 🔎 关键发现
- [关键发现1]
- [关键发现2]
- [关键发现3]

### 📈 对比与判断
- 对比对象：[竞品、现有技术、评审标准、申报要求或用户目标]
- 主要差异：[差异和风险]

### 🧩 写作可用要点
- [可直接进入文稿的要点1]
- [可直接进入文稿的要点2]

### ⚠️ 风险与待确认
- [需要用户确认的数据、假设或证据]

要求：
1. 不要硬套实验数据、环境条件或统计分析格式。
2. 保留所有关键数值、名称、金额、比例、时间和限制条件。
3. 结论要克制，区分已确认事实和待确认假设。
4. 总字数控制在800-1500字`
        : `请对以下实验数据进行结构化总结，生成一份清晰、简洁的数据详细总结。

## 原始数据资料
${content.substring(0, 15000)}

## 输出要求
请按以下结构生成总结（使用Markdown格式）：

### 📊 数据概览
- 数据年份：[包含哪些年份的数据]
- 数据类型：[观测数据/实验数据/模型数据等]
- 数据量：[样本数量、观测频次等]

### 🌡️ 环境/样本/实验条件数据
- 背景条件：[温度、湿度、时间、地点、平台、场景或其他背景变量]
- 样本或对象属性：[样本量、来源、分组、材料性质、系统参数等]
- 基础指标：[用户提供的物理、化学、生物、人口学、技术或运行指标；没有就留空]

### 📈 结果/测量数据
- 主要指标：[用户提供的核心结果、效应量、性能指标或测量数据范围]
- 峰值特征：[峰值出现条件、数值范围]
- 累积/总量/综合指标：[各组、各阶段或各方案的累积值、总量或综合指标对比]

### 🔬 统计分析结果
- 处理间差异：[显著性水平、差异幅度]
- 年际变异：[不同年份数据对比]
- 关键比值或指数：[用户提供的比值、指数、标准化指标或派生指标]

### 🧬 微生物数据（如有）
- 功能基因丰度：[关键基因丰度变化]
- 群落结构：[主要微生物类群]

### 💡 数据解读要点
- [数据反映的关键规律]
- [与预期的差异]
- [数据质量和局限性说明]

要求：
1. 保留所有具体数值和单位
2. 突出数据间的对比关系
3. 结构清晰，便于查阅
4. 总字数控制在800-1500字`;
    
    const response = await fetch(useApiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + useApiKey,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: "你是一个专业的学术数据分析和总结助手。" },
          { role: "user", content: summaryPrompt }
        ],
        temperature: 0.3,
        max_tokens: MAX_LLM_OUTPUT_TOKENS,
      }),
    });
    
    if (response.ok) {
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const summary = data.choices?.[0]?.message?.content || "";
      
      if (summary.length > 50) {
        logger.info(`[Summary] Generated successfully, length: ${summary.length}`);
        res.json({ 
          success: true, 
          summary: summary.trim(),
          type: type,
          originalLength: content.length,
          summaryLength: summary.length
        });
      } else {
        logger.warn(`[Summary] Generated content too short: ${summary.length}`);
        res.json({ 
          success: false, 
          error: "生成的总结过短，请检查原始内容" 
        });
      }
    } else {
      const errorText = await response.text();
      logger.error(`[Summary] API failed: ${response.status} - ${errorText}`);
      res.json({ 
        success: false, 
        error: `AI 服务返回错误 (${response.status})` 
      });
    }
  } catch (error) {
    logger.error("[Summary] Error:", error);
    res.json({ 
      success: false, 
      error: "生成失败：" + (error as Error).message 
    });
  }
});

// ============ 自动检索 API ============

interface RetrievalPoint {
  sentence: string;
  keywords_en: string[];
  keywords_cn: string[];
}

interface PdfWikiRetrievalResult {
  entry: PdfWikiEntry;
  score: number;
  keyword: string;
  sentence: string;
}

interface RetrievalDetectionResult {
  need_retrieval: boolean;
  reason: string;
  points: RetrievalPoint[];
}

interface RetrievalSearchStat {
  sentence: string;
  keyword: string;
  found: number;
  selected: number;
}

type ClaimEvidenceRelation = 'supports' | 'contradicts' | 'related' | 'irrelevant' | 'unchecked';

interface ClaimEvidenceJudgment {
  relation: ClaimEvidenceRelation;
  confidence: number;
  reason: string;
  evidenceSnippets: string[];
  checked: boolean;
  adjustedScore?: number;
}

interface ClaimEvidenceQualityGate {
  passed: boolean;
  semanticScore: number;
  threshold: number;
  label: "high" | "reference" | "hidden";
  reason: string;
}

interface RetrievedReferenceSourceItem {
  id: string;
  file: string;
  path: string;
  excerpt: string;
}

function normalizeClaimEvidenceRelation(value: unknown): ClaimEvidenceRelation {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'supports' || normalized === 'support' || normalized === 'supported') return 'supports';
  if (normalized === 'contradicts' || normalized === 'contradict' || normalized === 'opposes' || normalized === 'opposite') return 'contradicts';
  if (normalized === 'related' || normalized === 'partial' || normalized === 'partially_related') return 'related';
  if (normalized === 'irrelevant' || normalized === 'unrelated' || normalized === 'not_relevant') return 'irrelevant';
  return 'unchecked';
}

function clampClaimEvidenceConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function buildUncheckedClaimEvidenceJudgment(reason: string): ClaimEvidenceJudgment {
  return {
    relation: 'unchecked',
    confidence: 0,
    reason,
    evidenceSnippets: [],
    checked: false,
  };
}

function cleanClaimEvidenceText(value: unknown, limit = 1200): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);
}

function parseClaimEvidenceJsonItems(content: string): Array<Record<string, unknown>> {
  const jsonMatch = String(content || '').match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  const parsed = JSON.parse(jsonMatch[0]) as { items?: unknown };
  return Array.isArray(parsed.items)
    ? parsed.items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    : [];
}

function buildClaimEvidenceCandidateId(item: any, index: number): string {
  return String(item?.id || item?.doi || item?.title || `doc-${index + 1}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180) || `doc-${index + 1}`;
}

function normalizeClaimEvidenceSnippets(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : (value ? [value] : []);
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const clean = cleanClaimEvidenceText(item, 500);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(clean);
    if (snippets.length >= 3) break;
  }
  return snippets;
}

async function judgeClaimEvidenceForRetrievedReferences(
  sentence: string,
  items: any[],
  config?: { apiUrl?: string; apiKey?: string; model?: string; label?: string }
): Promise<any[]> {
  if (items.length === 0) return items;

  const useApiUrl = config?.apiUrl || currentApiUrl || process.env.API_URL;
  const useApiKey = config?.apiKey || currentApiKey || process.env.API_KEY;
  const model = config?.model || currentSecondaryModel || currentModel || process.env.MODEL || "gpt-4o";
  if (!useApiUrl || !useApiKey) {
    const unchecked = buildUncheckedClaimEvidenceJudgment('未配置 LLM API，未执行证据支持判断。');
    return items.map(item => ({ ...item, claimSupport: unchecked }));
  }

  const candidates = items.map((item, index) => ({
    id: buildClaimEvidenceCandidateId(item, index),
    title: cleanClaimEvidenceText(item?.title, 320),
    year: cleanClaimEvidenceText(item?.year, 20),
    journal: cleanClaimEvidenceText(item?.journal, 180),
    keywords: Array.isArray(item?.keywords)
      ? item.keywords.slice(0, 12).map((keyword: unknown) => cleanClaimEvidenceText(keyword, 80)).filter(Boolean).join('; ')
      : cleanClaimEvidenceText(item?.keywords, 320),
    abstract: cleanClaimEvidenceText(item?.abstract, 1400),
  }));
  const candidateIds = new Set(candidates.map(candidate => candidate.id));

  const prompt = `你是通用科研证据匹配判别器。请判断每篇候选文献的题名、摘要、关键词是否能支持用户论点。

用户论点：
${sentence}

候选文献 JSON：
${JSON.stringify(candidates, null, 2)}

只允许根据候选文献的 title、abstract、keywords 判断，不要使用外部知识，不要预设学科领域，也不要补充候选文本中没有的信息。

relation 定义：
- supports：候选文献直接支持用户论点中的核心关系、方向或结论。
- contradicts：候选文献与用户论点的方向、关系或结论相反。
- related：候选文献主题相关，但不能直接支持该论点，或方向/对象/结论不够明确。
- irrelevant：候选文献与该论点基本无关。

输出严格 JSON，不要 markdown：
{
  "items": [
    {
      "id": "必须使用候选文献中的 id",
      "relation": "supports|contradicts|related|irrelevant",
      "confidence": 0.0,
      "reason": "一句话说明为什么",
      "evidenceSnippets": ["从 title/abstract/keywords 中摘出的原文短句，不能编造"]
    }
  ]
}`;

  try {
    const content = await callChatCompletion(
      {
        apiUrl: useApiUrl,
        apiKey: useApiKey,
        label: config?.label || "SentenceClaimEvidence",
        defaultModel: model,
      },
      {
        model,
        temperature: 0,
        maxTokens: 5000,
        messages: [
          {
            role: "system",
            content: "你是严格的科研证据支持关系判别器。只输出 JSON；没有直接证据时必须标为 related 或 irrelevant，不能把主题相关误判为 supports。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }
    );

    const parsedItems = parseClaimEvidenceJsonItems(content);
    const judgments = new Map<string, ClaimEvidenceJudgment>();
    for (const parsed of parsedItems) {
      const id = cleanClaimEvidenceText(parsed.id, 180);
      if (!candidateIds.has(id)) continue;
      const relation = normalizeClaimEvidenceRelation(parsed.relation);
      judgments.set(id, {
        relation,
        confidence: clampClaimEvidenceConfidence(parsed.confidence),
        reason: cleanClaimEvidenceText(parsed.reason, 260) || '模型未提供判断理由。',
        evidenceSnippets: normalizeClaimEvidenceSnippets((parsed as Record<string, unknown>).evidenceSnippets || (parsed as Record<string, unknown>).evidence_snippets),
        checked: relation !== 'unchecked',
      });
    }

    return items.map((item, index) => {
      const candidate = candidates[index];
      const judgment = judgments.get(candidate.id)
        || buildUncheckedClaimEvidenceJudgment('证据支持判断未返回该候选文献。');
      return { ...item, claimSupport: judgment };
    });
  } catch (error) {
    logger.warn("[SentenceClaimEvidence] 判断失败，保留原检索排序:", error);
    const unchecked = buildUncheckedClaimEvidenceJudgment(`证据支持判断失败：${(error as Error).message}`);
    return items.map(item => ({ ...item, claimSupport: unchecked }));
  }
}

function getClaimEvidenceRelationDelta(relation: ClaimEvidenceRelation | undefined): number {
  switch (relation) {
    case 'supports':
      return 0.35;
    case 'related':
      return 0.06;
    case 'unchecked':
      return 0;
    case 'contradicts':
      return -0.18;
    case 'irrelevant':
      return -0.42;
    default:
      return 0;
  }
}

function rankClaimEvidenceJudgedResults(items: any[], limit: number): any[] {
  return items
    .map(item => {
      const baseScore = Number(item?.combinedScore || item?.score || 0);
      const support = (item?.claimSupport || buildUncheckedClaimEvidenceJudgment('未执行证据支持判断。')) as ClaimEvidenceJudgment;
      const adjustedScore = Math.max(0, baseScore + getClaimEvidenceRelationDelta(support.relation) + (support.confidence || 0) * 0.08);
      return {
        ...item,
        originalCombinedScore: Number.isFinite(baseScore) ? baseScore : 0,
        combinedScore: adjustedScore,
        claimSupport: {
          ...support,
          adjustedScore,
        },
      };
    })
    .sort((a, b) => {
      const scoreDiff = Number(b.combinedScore || 0) - Number(a.combinedScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return Number(b.vectorScore || 0) - Number(a.vectorScore || 0);
    })
    .slice(0, Math.max(1, Math.floor(limit || 1)));
}

function summarizeClaimEvidenceJudgments(items: any[]): Record<ClaimEvidenceRelation, number> {
  const summary: Record<ClaimEvidenceRelation, number> = {
    supports: 0,
    contradicts: 0,
    related: 0,
    irrelevant: 0,
    unchecked: 0,
  };
  for (const item of items) {
    const relation = normalizeClaimEvidenceRelation(item?.claimSupport?.relation);
    summary[relation] += 1;
  }
  return summary;
}

function normalizeClaimEvidenceScore(value: unknown): number {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) return 0;
  if (score <= 1) return score;
  if (score <= 100) return Math.min(1, score / 100);
  return 1;
}

function getClaimEvidenceSemanticScore(item: any): number {
  const semanticCandidates = [
    item?.vectorScore,
    item?.semanticScore,
    item?.rerankScore,
  ].map(normalizeClaimEvidenceScore);
  const semantic = Math.max(0, ...semanticCandidates);
  if (semantic > 0) return semantic;
  return Math.max(
    normalizeClaimEvidenceScore(item?.originalCombinedScore),
    normalizeClaimEvidenceScore(item?.combinedScore),
    normalizeClaimEvidenceScore(item?.score)
  );
}

function computeClaimEvidenceSemanticThreshold(items: any[]): { threshold: number; topScore: number } {
  const scores = items
    .map(getClaimEvidenceSemanticScore)
    .filter(score => Number.isFinite(score) && score > 0)
    .sort((a, b) => b - a);
  const topScore = scores[0] || 0;
  if (topScore <= 0) return { threshold: 0, topScore: 0 };

  const medianScore = scores[Math.floor(scores.length / 2)] || topScore;
  const relaxedForSparseScores = topScore < 0.35
    ? Math.max(0.12, topScore * 0.65)
    : Math.max(0.35, Math.min(0.78, Math.max(topScore * 0.62, topScore - 0.2, medianScore * 0.95)));
  return {
    threshold: Math.min(topScore, relaxedForSparseScores),
    topScore,
  };
}

function buildClaimEvidenceQualityReason(
  relation: ClaimEvidenceRelation,
  confidence: number,
  semanticScore: number,
  threshold: number,
  passed: boolean
): string {
  const relationLabel: Record<ClaimEvidenceRelation, string> = {
    supports: "证据支持",
    contradicts: "方向相反",
    related: "主题相关",
    irrelevant: "无关",
    unchecked: "未核查",
  };
  const semanticText = threshold > 0
    ? `语义 ${semanticScore.toFixed(3)} / 门槛 ${threshold.toFixed(3)}`
    : `语义 ${semanticScore.toFixed(3)}`;
  if (passed) {
    return `${relationLabel[relation]}，置信度 ${Math.round(confidence * 100)}%，${semanticText}。`;
  }
  if (relation === "irrelevant") return `证据判断为无关，已隐藏；${semanticText}。`;
  return `未通过动态质量门控，已隐藏；${relationLabel[relation]}，置信度 ${Math.round(confidence * 100)}%，${semanticText}。`;
}

function applyClaimEvidenceQualityGate<T extends Record<string, any>>(items: T[]): T[] {
  const { threshold, topScore } = computeClaimEvidenceSemanticThreshold(items);
  return items.map((item, index) => {
    const support = (item.claimSupport || buildUncheckedClaimEvidenceJudgment("未执行证据支持判断。")) as ClaimEvidenceJudgment;
    const relation = normalizeClaimEvidenceRelation(support.relation);
    const confidence = clampClaimEvidenceConfidence(support.confidence);
    const semanticScore = getClaimEvidenceSemanticScore(item);
    const hasEvidenceSnippet = Array.isArray(support.evidenceSnippets) && support.evidenceSnippets.some(snippet => cleanClaimEvidenceText(snippet, 120));
    const semanticPassed = threshold <= 0 || semanticScore >= threshold;
    const closeToTop = topScore <= 0 || semanticScore >= topScore * 0.55;
    let passed = false;

    if (relation === "supports" || relation === "contradicts") {
      passed = confidence >= 0.45 && (semanticPassed || hasEvidenceSnippet || closeToTop);
    } else if (relation === "related") {
      passed = confidence >= 0.35 && semanticPassed;
    } else if (relation === "unchecked") {
      passed = semanticPassed && index < 6;
    }

    const label: ClaimEvidenceQualityGate["label"] = passed
      ? (relation === "supports" || relation === "contradicts" ? "high" : "reference")
      : "hidden";

    return {
      ...item,
      qualityGate: {
        passed,
        semanticScore,
        threshold,
        label,
        reason: buildClaimEvidenceQualityReason(relation, confidence, semanticScore, threshold, passed),
      },
    };
  });
}

function isClaimEvidenceVisibleByQualityGate(item: any): boolean {
  const relation = normalizeClaimEvidenceRelation(item?.claimSupport?.relation);
  if (relation === "irrelevant") return false;
  return item?.qualityGate?.passed !== false;
}

function countClaimEvidenceHiddenByQualityGate(items: any[]): number {
  return items.filter(item => {
    const relation = normalizeClaimEvidenceRelation(item?.claimSupport?.relation);
    return relation !== "irrelevant" && item?.qualityGate?.passed === false;
  }).length;
}

function selectVisibleClaimEvidenceResults<T extends Record<string, any>>(items: T[], limit: number): T[] {
  return items
    .filter(item => isClaimEvidenceVisibleByQualityGate(item))
    .slice(0, Math.max(1, Math.floor(limit || 1)));
}

function buildRetrievalPointQueryVariants(point: RetrievalPoint): RetrievalQueryVariant[] {
  const variants = buildBilingualRetrievalQueries({
    sentence: point.sentence,
    keywordsEn: point.keywords_en,
    keywordsCn: point.keywords_cn,
  });
  if (variants.length > 0) return variants;
  const fallback = (point.keywords_en?.[0] || point.keywords_cn?.[0] || point.sentence || '').trim();
  return fallback
    ? [{ language: 'en', label: '英文检索', query: fallback }]
    : [];
}

function normalizeRetrievalKeywordArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    const clean = String(item || '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
  }
  return output.slice(0, 4);
}

function buildFallbackRetrievalPoint(sentence: string): RetrievalPoint {
  const clean = String(sentence || '').trim();
  return {
    sentence: clean,
    keywords_en: [clean].filter(Boolean),
    keywords_cn: /[\u4e00-\u9fff]/.test(clean) ? [clean] : [],
  };
}

async function parseSentenceClaimRetrievalPoint(sentence: string): Promise<{
  point: RetrievalPoint;
  parser: 'ai' | 'fallback';
  reason: string;
  warning?: string;
}> {
  const cleanSentence = String(sentence || '').trim();
  const fallback = buildFallbackRetrievalPoint(cleanSentence);
  const useApiUrl = currentApiUrl || process.env.API_URL;
  const useApiKey = currentApiKey || process.env.API_KEY;
  const model = currentModel || process.env.MODEL || "gpt-4o";

  if (!useApiUrl || !useApiKey) {
    return {
      point: fallback,
      parser: 'fallback',
      reason: '未配置 LLM API，使用原句构建规则检索式。',
      warning: 'query 解析未调用 AI；中文句子可能缺少英文翻译检索式。',
    };
  }

  const prompt = `你是句子级文献检索 query 解析器。请把用户输入的一个科研论点/句子解析成中英文两条检索路径，供后端先 BM25 关键词筛选，再在 BM25 候选池内做 embedding 语义相似度重排。

用户句子：
${cleanSentence}

输出 JSON：
{
  "sentence": "原句",
  "keywords_en": ["英文组合检索式"],
  "keywords_cn": ["中文组合检索式"],
  "reason": "简短说明"
}

要求：
- keywords_en 和 keywords_cn 各输出 1-2 条组合检索式。
- 英文用 AND 连接核心概念；中文可用 AND 或空格连接核心短语。
- 必须保留并翻译方向性动词和关系词：下降/降低/reduce/decrease、增加/increase、促进/promote、抑制/inhibit、显著/significant、正相关/positive association、负相关/negative association。
- 不要只提取名词；检索式必须体现“谁影响谁、方向是什么”。
- 不要预设任何学科领域、研究对象或主图方向。
- 只返回 JSON，不要 markdown。`;

  try {
    const response = await fetch(useApiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + useApiKey,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 1200,
      }),
    });
    if (!response.ok) {
      return {
        point: fallback,
        parser: 'fallback',
        reason: 'query 解析 API 返回异常，已使用原句规则检索。',
        warning: `query parser API failed: ${response.status}`,
      };
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        point: fallback,
        parser: 'fallback',
        reason: 'query 解析未返回 JSON，已使用原句规则检索。',
        warning: 'query parser returned non-JSON content',
      };
    }
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const point: RetrievalPoint = {
      sentence: String(parsed.sentence || cleanSentence).trim() || cleanSentence,
      keywords_en: normalizeRetrievalKeywordArray(parsed.keywords_en),
      keywords_cn: normalizeRetrievalKeywordArray(parsed.keywords_cn),
    };
    if (point.keywords_en.length === 0 && point.keywords_cn.length === 0) {
      return {
        point: fallback,
        parser: 'fallback',
        reason: 'query 解析未给出有效检索词，已使用原句规则检索。',
        warning: 'query parser returned empty keywords',
      };
    }
    return {
      point,
      parser: 'ai',
      reason: String(parsed.reason || '已解析为中英文两条检索路径。'),
    };
  } catch (error) {
    return {
      point: fallback,
      parser: 'fallback',
      reason: 'query 解析失败，已使用原句规则检索。',
      warning: (error as Error).message,
    };
  }
}

interface RetrievalExecutionResult {
  success: true;
  librarySource: "abstract" | "pdfWiki" | "combined";
  librarySources?: Array<"abstract" | "pdfWiki">;
  sourceLabel: string;
  filePath: string;
  fileName: string;
  totalFound: number;
  uniqueCount: number;
  searchStats: RetrievalSearchStat[];
  preview: string;
  fullContent: string;
  evidenceSources?: ResearchSourceReference[];
  results?: RetrievalExecutionResult[];
}

app.post("/api/retrieval/detect", async (req: Request, res: Response) => {
  try {
    const { message, context, userId } = req.body;
    
    if (!message) {
      res.json({ success: false, error: "消息不能为空" });
      return;
    }
    
    const unifiedUserId = sanitizeUserId(userId || "web-user");
    
    const useApiUrl = currentApiUrl || process.env.API_URL;
    const useApiKey = currentApiKey || process.env.API_KEY;
    const model = currentModel || process.env.MODEL || "gpt-4o";
    
    logger.info(`[Retrieval] Detect request - API configured: ${!!useApiUrl && !!useApiKey}, model: ${model}`);
    
    if (!useApiUrl || !useApiKey) {
      logger.warn('[Retrieval] API not configured - URL:', !!useApiUrl, 'Key:', !!useApiKey);
      res.json({ success: false, error: "API未配置，请在左下角设置 API 地址和密钥" });
      return;
    }
    
    const detectionPrompt = `你是一个文献检索助手。分析以下对话内容，判断是否需要文献检索支撑。

## 对话内容
${message}

## 上下文
${context || '无额外上下文'}

## 判断标准
需要检索的情况：
1. 包含需要文献支撑的科学论点或观点
2. 提到需要引用、参考文献、文献支撑
3. 在讨论具体的学术论文写作内容（引言/讨论/方法等）
4. 包含具体的科学事实陈述，可以被引用

不需要检索的情况：
1. 简单的问候或闲聊
2. 纯粹的格式修改或语言润色
3. 询问操作方法或软件使用
4. 已经有足够文献支撑的内容

## 输出格式
返回 JSON：
{
  "need_retrieval": true/false,
  "reason": "判断理由",
  "points": [
    {
      "sentence": "需要文献支撑的句子原文",
      "keywords_en": ["keyword1 AND keyword2 AND keyword3"],
      "keywords_cn": ["中文描述"]
    }
  ]
}

## ⚠️ 关键要求：按论点组合检索词
- **每个论点必须同时提供 ONE 个英文组合检索词和 ONE 个中文组合检索词**，分别放入 keywords_en 和 keywords_cn
- 英文组合检索词用 AND 连接多个关键词；中文组合检索词用空格或 AND 连接核心中文短语
- 例如：论点"干预A显著降低目标风险"
  - ✅ 正确：keywords_en: ["intervention A AND reduce AND target risk"]
  - ✅ 正确：keywords_cn: ["干预A AND 降低 AND 目标风险"]
  - ❌ 错误：keywords_en: ["intervention A", "risk", "effect"]
- 这样可以确保检索到的文献同时包含所有关键词，真正支撑该论点
- 检索词要具体，能准确定位相关文献
- 动词和方向词必须保留并翻译到另一种语言，例如：下降/降低/reduce/decrease、增加/increase、促进/promote、抑制/inhibit、显著/significant、正相关/positive association、负相关/negative association
- 不要只提取名词；如果论点说“降低/促进/抑制/增加”，检索词必须体现这个方向关系
- points 最多提取5个论点
- 只返回JSON，不要其他文字`;

    const response = await fetch(useApiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + useApiKey
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: "system", content: detectionPrompt },
          { role: "user", content: "请分析上面的对话内容" }
        ],
        temperature: 0.3,
        max_tokens: MAX_LLM_OUTPUT_TOKENS
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.error(`[Retrieval] API call failed: ${response.status} ${response.statusText}`, errorText);
      res.json({ success: false, error: `API调用失败: ${response.status} ${response.statusText}` });
      return;
    }
    
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || "";
    
    logger.debug(`[Retrieval] AI response: ${content.substring(0, 200)}...`);
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('[Retrieval] No JSON found in response:', content.substring(0, 500));
      res.json({ success: false, error: "AI 返回格式错误，请重试", need_retrieval: false });
      return;
    }
    
    const result: RetrievalDetectionResult = JSON.parse(jsonMatch[0]);
    
    // 获取文献数量 - 使用实际的 userId
    let literatureCount = 0;
    const litJsonFile = getUserLiteraturePath(unifiedUserId);
    if (fs.existsSync(litJsonFile)) {
      try {
        const litContent = fs.readFileSync(litJsonFile, 'utf-8');
        const litData = JSON.parse(litContent);
        const papers = Array.isArray(litData) ? litData : (litData.papers || []);
        literatureCount = papers.filter((paper: any) => {
          const abstract = String(paper.abstract || '').trim();
          return !paper.isPdf && abstract && abstract !== '[PDF文件需要进一步解析]';
        }).length;
      } catch (e) {
        logger.warn(`[Retrieval] Failed to read literature file for user ${unifiedUserId}:`, e);
      }
    }
    const pdfWikiStatus = await pdfWikiManager.getStatus(unifiedUserId);
    const pdfWikiSentencePointCount = Number(pdfWikiStatus.sentencePointCount || 0);
    const pdfWikiCount = pdfWikiStatus.status === 'completed' ? Math.max(pdfWikiSentencePointCount, pdfWikiStatus.entryCount) : 0;
    
    logger.info(`[Retrieval] Detection result: need=${result.need_retrieval}, points=${result.points?.length || 0}, literatureCount=${literatureCount}, pdfWikiCount=${pdfWikiCount}`);
    
    // 如果不需要检索，记录原因
    if (!result.need_retrieval) {
      logger.info(`[Retrieval] AI 判断不需要检索，原因: ${result.reason}`);
    }
    
    res.json({ 
      success: true, 
      need_retrieval: result.need_retrieval,
      reason: result.reason,
      points: result.points || [],
      literatureCount: literatureCount,
      pdfWikiCount,
      libraries: {
        abstract: {
          available: literatureCount > 0,
          count: literatureCount,
          label: "摘要文献库",
        },
        pdfWiki: {
          available: pdfWikiStatus.status === 'completed' && pdfWikiCount > 0,
          count: pdfWikiCount,
          sentencePointCount: pdfWikiSentencePointCount,
          entryCount: pdfWikiStatus.entryCount,
          status: pdfWikiStatus.status,
          message: pdfWikiStatus.message,
          label: "PDF 论点库",
        },
      },
    });
    
  } catch (error) {
    logger.error("[Retrieval] Detect error:", error);
    res.json({ success: false, error: (error as Error).message });
  }
});

app.post("/api/retrieval/execute", async (req: Request, res: Response) => {
  try {
    const { points, userId } = req.body;
    const rawSources = Array.isArray(req.body.librarySources)
      ? req.body.librarySources
      : [req.body.librarySource];
    const requestedSources = rawSources
      .map((source: unknown) => String(source || ""))
      .filter((source: string): source is "abstract" | "pdfWiki" =>
        source === "abstract" || source === "pdfWiki"
      );
    const librarySources = Array.from(new Set(requestedSources.length > 0 ? requestedSources : ["abstract"])) as Array<"abstract" | "pdfWiki">;
    
    if (!points || points.length === 0) {
      res.json({ success: false, error: "没有检索点" });
      return;
    }
    
    const unifiedUserId = sanitizeUserId(userId || "web-user");
    const results: RetrievalExecutionResult[] = [];

    for (const source of librarySources) {
      const result = source === "pdfWiki"
        ? await runPdfWikiRetrieval(points, unifiedUserId)
        : await runAbstractRetrieval(points, unifiedUserId);
      results.push(result);
    }

    const responsePayload = results.length === 1
      ? results[0]
      : combineRetrievalResults(points, unifiedUserId, results)
    ;
    const researchSession = await recordRetrievalResearchProvenance({
      userId: unifiedUserId,
      sessionId: cleanOptionalResearchSessionId(req.body.researchSessionId),
      points,
      librarySources,
      result: responsePayload,
    }).catch((error) => {
      logger.warn("[ResearchSession] Failed to record retrieval provenance:", error);
      return undefined;
    });

    res.json({
      ...responsePayload,
      researchSession,
    });
    
  } catch (error) {
    logger.error("[Retrieval] Execute error:", error);
    res.json({ success: false, error: (error as Error).message });
  }
});

async function runAbstractRetrieval(points: RetrievalPoint[], userId: string): Promise<RetrievalExecutionResult> {
  userId = sanitizeUserId(userId);
  const userEngine = await retrievalEngineManager.getEngine(userId);

  if (userId === 'web-user') {
    globalRetrievalEngine = userEngine;
  }

  const stats = userEngine.getStatistics();
  logger.info(`[Retrieval] Engine stats for user ${userId}: ${stats.totalCount} documents`);

  const userDir = getUserUploadDir(userId);
  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  const retrievalDir = path.join(userDir, "retrieval_results");
  if (!fs.existsSync(retrievalDir)) {
    fs.mkdirSync(retrievalDir, { recursive: true });
  }

  const allResults: any[] = [];
  const searchStats: RetrievalSearchStat[] = [];

  for (const point of points) {
    const variants = buildRetrievalPointQueryVariants(point);
    if (variants.length === 0) continue;

    const sentence = point.sentence || variants[0].query;
    logger.info(`[Retrieval] 检索论点：${sentence}`);
    logger.info(`[Retrieval] 双语检索路径：${formatRetrievalQueryVariants(variants)}`);

    for (const variant of variants) {
      try {
        const queryResults = await userEngine.retrieve({
          query: variant.query,
          topK: 15,
          searchMode: 'hybrid'
        });

        const initialResults = queryResults.results;
        logger.info(`[Retrieval] ${variant.label} 检索到 ${initialResults.length} 篇文献，开始 AI 筛选...`);

        const selectedResults = await aiSelectPapers(
          initialResults,
          `${sentence}\n检索路径：${variant.label}\n检索词：${variant.query}`,
          4,
          currentApiUrl,
          currentApiKey
        );

        logger.info(`[Retrieval] ${variant.label} AI 筛选出 ${selectedResults.length} 篇最相关文献`);

        const resultsWithMeta = selectedResults.map(doc => ({
          title: doc.title,
          authors: doc.authors,
          author: doc.author,
          year: doc.year,
          journal: doc.journal,
          doi: doc.doi,
          abstract: doc.abstract,
          score: doc.combinedScore,
          keyword: `${variant.label}: ${variant.query}`,
          retrievalLanguage: variant.language,
          sentence,
          relevanceScore: (doc as any).relevanceScore || Math.round((doc.combinedScore || 0.5) * 100),
          qualityScore: (doc as any).qualityScore || Math.round((doc.combinedScore || 0.5) * 100),
        }));

        allResults.push(...resultsWithMeta);
        searchStats.push({
          sentence: `${variant.label}｜${sentence}`,
          keyword: variant.query,
          found: initialResults.length,
          selected: selectedResults.length
        });
      } catch (e) {
        logger.warn(`[Retrieval] ${variant.label} 论点检索失败:`, e);
      }
    }
  }

  const uniqueResults = deduplicateByTitle(allResults);
  logger.info(`[Retrieval] 去重后剩余 ${uniqueResults.length} 篇文献`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fileName = `retrieval_${timestamp}.txt`;
  const filePath = path.join(retrievalDir, fileName);

  const fileContent = formatRetrievalResultsForFile(points, uniqueResults, searchStats);
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  logger.info(`[Retrieval] Saved ${uniqueResults.length} papers to ${filePath}`);

  return {
    success: true,
    librarySource: "abstract",
    sourceLabel: "Embedding 文献库",
    filePath,
    fileName,
    totalFound: allResults.length,
    uniqueCount: uniqueResults.length,
    searchStats,
    preview: fileContent.substring(0, 2000),
    fullContent: fileContent,
    evidenceSources: uniqueResults.map((paper: any) => ({
      id: paper.doi || paper.title,
      sourceType: 'embedding' as const,
      title: paper.title,
      authors: paper.author || paper.authors,
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
      query: paper.keyword,
      score: Number(paper.score || 0) || undefined,
      evidenceSnippet: paper.abstract,
      metadata: {
        sentence: paper.sentence,
        relevanceScore: paper.relevanceScore,
        qualityScore: paper.qualityScore,
      },
    })),
  };
}

function combineRetrievalResults(
  points: RetrievalPoint[],
  userId: string,
  results: RetrievalExecutionResult[]
): RetrievalExecutionResult {
  userId = sanitizeUserId(userId);
  const userDir = getUserUploadDir(userId);
  const retrievalDir = path.join(userDir, "retrieval_results");
  if (!fs.existsSync(retrievalDir)) {
    fs.mkdirSync(retrievalDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fileName = `retrieval_combined_${timestamp}.txt`;
  const filePath = path.join(retrievalDir, fileName);
  const sourceLabel = results.map(result => result.sourceLabel).join(" + ");
  const searchStats = results.flatMap(result =>
    result.searchStats.map(stat => ({
      ...stat,
      sentence: `[${result.sourceLabel}] ${stat.sentence}`,
    }))
  );
  const fullContent = formatCombinedRetrievalResultsForFile(points, results);
  fs.writeFileSync(filePath, fullContent, 'utf-8');

  return {
    success: true,
    librarySource: "combined",
    librarySources: results
      .map(result => result.librarySource)
      .filter((source): source is "abstract" | "pdfWiki" => source === "abstract" || source === "pdfWiki"),
    sourceLabel,
    filePath,
    fileName,
    totalFound: results.reduce((sum, result) => sum + result.totalFound, 0),
    uniqueCount: results.reduce((sum, result) => sum + result.uniqueCount, 0),
    searchStats,
    preview: fullContent.substring(0, 2000),
    fullContent,
    evidenceSources: results.flatMap(result => result.evidenceSources || []),
    results,
  };
}

function cleanOptionalResearchSessionId(value: unknown): string | undefined {
  const cleaned = String(value || '').trim();
  return cleaned ? cleaned : undefined;
}

async function recordRetrievalResearchProvenance(input: {
  userId: string;
  sessionId?: string;
  points: RetrievalPoint[];
  librarySources: ReviewWriterLibrarySource[] | Array<"abstract" | "pdfWiki">;
  result: RetrievalExecutionResult;
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactId: string }> {
  const sourceRefs = input.result.evidenceSources && input.result.evidenceSources.length > 0
    ? input.result.evidenceSources
    : buildRetrievalResearchSourceRefs(input.result);
  const literatureReviewTrace = await buildLiteratureReviewToolTrace(sourceRefs, { maxVerify: 12, maxExpand: 3 });
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.sessionId,
    sessionTitle: input.points[0]?.sentence ? `论点检索：${input.points[0].sentence.slice(0, 60)}` : '论点检索科研会话',
    sessionTopic: input.points[0]?.sentence,
    targetType: 'retrieval',
    targetId: input.result.fileName,
    operation: 'retrieval.execute',
    sourceModule: 'retrieval',
    input: {
      points: input.points,
      librarySources: input.librarySources,
    },
    output: {
      fileName: input.result.fileName,
      filePath: input.result.filePath,
      sourceLabel: input.result.sourceLabel,
      totalFound: input.result.totalFound,
      uniqueCount: input.result.uniqueCount,
      searchStats: input.result.searchStats,
    },
    query: input.result.searchStats.map(stat => `${stat.sentence}: ${stat.keyword}`).join('\n'),
    sources: sourceRefs,
    metadata: {
      preview: input.result.preview,
      resultSource: input.result.librarySource,
      resultSources: input.result.librarySources,
      literatureReviewTrace,
    },
  });
  const artifact = await researchSessionManager.appendArtifact({
    userId: input.userId,
    sessionId: provenance.session.id,
    kind: 'retrieval',
    name: input.result.fileName,
    filePath: input.result.filePath,
    content: input.result.fullContent,
    contentType: 'text/plain',
    input: input.points,
    provenanceRecordIds: [provenance.record.id],
    metadata: {
      sourceLabel: input.result.sourceLabel,
      totalFound: input.result.totalFound,
      uniqueCount: input.result.uniqueCount,
      doiVerification: literatureReviewTrace.doiVerification,
      citationExpansion: literatureReviewTrace.citationExpansion,
    },
  });
  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
    artifactId: artifact.artifact.id,
  };
}

function buildRetrievalResearchSourceRefs(result: RetrievalExecutionResult): ResearchSourceReference[] {
  return result.searchStats.map((stat, index) => {
    const isPdfWiki = result.librarySource === 'pdfWiki' || stat.sentence.includes('PDF 论点库');
    const isEmbedding = result.librarySource === 'abstract' || stat.sentence.includes('Embedding 文献库');
    return {
      id: `${result.fileName || 'retrieval'}#${index + 1}`,
      sourceType: isPdfWiki ? 'pdf-wiki' : isEmbedding ? 'embedding' : 'other',
      title: stat.sentence,
      query: stat.keyword,
      location: result.filePath,
      metadata: {
        found: stat.found,
        selected: stat.selected,
        sourceLabel: result.sourceLabel,
      },
    };
  });
}

async function buildLiteratureReviewToolTrace(
  sources: ResearchSourceReference[],
  options: { maxVerify?: number; maxExpand?: number; queries?: string[]; maxOpenAlexQueries?: number } = {}
): Promise<{
  doiVerification: Record<string, DoiVerificationResult>;
  citationExpansion: CitationExpansionResult[];
  openAlexSearches: Array<{ query: string; hits: OpenAlexWorkHit[] }>;
}> {
  const dois = Array.from(new Set(
    sources
      .flatMap(source => [source.doi, source.metadata?.doi])
      .map(value => String(value || '').trim())
      .filter(value => /^10\.\d{4,9}\//i.test(value))
  ));
  const verifyList = dois.slice(0, options.maxVerify || 12);
  const expandList = dois.slice(0, options.maxExpand || 3);
  const doiVerification = verifyList.length > 0
    ? await verifyDois(verifyList, { maxDois: verifyList.length, timeoutMs: 5000 }).catch(error => {
        logger.warn("[LiteratureReviewTools] DOI verification trace failed:", error);
        return {};
      })
    : {};
  const citationExpansion: CitationExpansionResult[] = [];
  for (const doi of expandList) {
    try {
      citationExpansion.push(await expandCitations(doi, 8, 5, 5000));
    } catch (error) {
      logger.warn(`[LiteratureReviewTools] Citation expansion failed for ${doi}:`, error);
      citationExpansion.push({ doi, references: [], citedBy: [] });
    }
  }
  const rawQueries = [
    ...(options.queries || []),
    ...sources.map(source => source.query || '').filter(Boolean),
  ];
  const queries = Array.from(new Set(rawQueries.map(query => String(query || '').trim()).filter(Boolean)))
    .slice(0, options.maxOpenAlexQueries || 3);
  const openAlexSearches: Array<{ query: string; hits: OpenAlexWorkHit[] }> = [];
  for (const query of queries) {
    try {
      openAlexSearches.push({ query, hits: await searchOpenAlex(query, 5, '', 5000) });
    } catch (error) {
      logger.warn(`[LiteratureReviewTools] OpenAlex search failed for "${query.slice(0, 80)}":`, error);
      openAlexSearches.push({ query, hits: [] });
    }
  }
  return { doiVerification, citationExpansion, openAlexSearches };
}

async function executePdfWikiRetrieval(points: RetrievalPoint[], userId: string, res: Response): Promise<void> {
  try {
    res.json(await runPdfWikiRetrieval(points, sanitizeUserId(userId)));
  } catch (error) {
    res.json({ success: false, error: (error as Error).message });
  }
}

async function runPdfWikiRetrieval(points: RetrievalPoint[], userId: string): Promise<RetrievalExecutionResult> {
  userId = sanitizeUserId(userId);
  const status = await pdfWikiManager.getStatus(userId);
  const pdfWikiCount = Math.max(Number(status.sentencePointCount || 0), Number(status.entryCount || 0));
  if (status.status !== 'completed' || pdfWikiCount === 0) {
    throw new Error(status.status === 'processing'
      ? `PDF Wiki 正在生成中：${status.message}`
      : `PDF Wiki 文献库不可用：${status.message || '请先上传 PDF 并等待 Wiki 生成完成'}`
    );
  }

  const wikiEngine = await pdfWikiManager.getEngine(userId, {
    apiUrl: currentEmbeddingConfig.enabled ? currentEmbeddingConfig.url : undefined,
    apiKey: currentEmbeddingConfig.enabled ? currentEmbeddingConfig.key : undefined,
    model: currentEmbeddingConfig.model,
    dimensions: currentEmbeddingConfig.dimensions,
  });
  const entryMap = await pdfWikiManager.getEntryMap(userId);
  const userDir = getUserUploadDir(userId);
  const retrievalDir = path.join(userDir, "retrieval_results");
  if (!fs.existsSync(retrievalDir)) {
    fs.mkdirSync(retrievalDir, { recursive: true });
  }

  const allResults: PdfWikiRetrievalResult[] = [];
  const searchStats: RetrievalSearchStat[] = [];

  for (const point of points) {
    const variants = buildRetrievalPointQueryVariants(point);
    if (variants.length === 0) continue;
    const sentence = point.sentence || variants[0].query;
    logger.info(`[PdfWikiRetrieval] 检索论点：${sentence}`);
    logger.info(`[PdfWikiRetrieval] 双语检索路径：${formatRetrievalQueryVariants(variants)}`);

    for (const variant of variants) {
      try {
        const queryResults = await wikiEngine.retrieve({
          query: variant.query,
          topK: 12,
          searchMode: 'hybrid',
        });
        const selected: Array<{ doc: { id: string; combinedScore?: number }; entry: PdfWikiEntry }> = [];
        for (const doc of queryResults.results) {
          const entry = entryMap.get(doc.id);
          if (entry) selected.push({ doc, entry });
          if (selected.length >= 4) break;
        }

        for (const item of selected) {
          allResults.push({
            entry: item.entry,
            score: item.doc.combinedScore || 0,
            keyword: `${variant.label}: ${variant.query}`,
            sentence,
          });
        }

        searchStats.push({
          sentence: `${variant.label}｜${sentence}`,
          keyword: variant.query,
          found: queryResults.results.length,
          selected: selected.length,
        });
      } catch (error) {
        logger.warn(`[PdfWikiRetrieval] ${variant.label} 论点检索失败:`, error);
      }
    }
  }

  const uniqueResults = deduplicatePdfWikiResults(allResults);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const fileName = `retrieval_pdf_wiki_${timestamp}.txt`;
  const filePath = path.join(retrievalDir, fileName);
  const fileContent = formatPdfWikiRetrievalResultsForFile(points, uniqueResults, searchStats);
  fs.writeFileSync(filePath, fileContent, 'utf-8');

  return {
    success: true,
    librarySource: "pdfWiki",
    sourceLabel: "PDF 论点库",
    filePath,
    fileName,
    totalFound: allResults.length,
    uniqueCount: uniqueResults.length,
    searchStats,
    preview: fileContent.substring(0, 2000),
    fullContent: fileContent,
    evidenceSources: uniqueResults.flatMap(item => {
      const references = dedupePdfWikiReferences(item.entry.references || []);
      if (references.length > 0) {
        return references.map(ref => ({
          id: ref.id || ref.doi || ref.title,
          sourceType: 'pdf-wiki' as const,
          title: ref.title || item.entry.claim,
          authors: ref.authors,
          year: ref.year,
          journal: ref.journal,
          doi: ref.doi,
          query: item.keyword,
          score: item.score,
          evidenceSnippet: item.entry.evidenceSnippets?.[0] || item.entry.claim,
          metadata: {
            sentence: item.sentence,
            entryId: item.entry.id,
            sourcePdfId: ref.sourcePdfId,
            sourcePdfName: ref.sourcePdfName,
          },
        }));
      }
      return [{
        id: item.entry.id,
        sourceType: 'pdf-wiki' as const,
        title: item.entry.claim,
        authors: undefined,
        year: undefined,
        journal: undefined,
        doi: undefined,
        query: item.keyword,
        score: item.score,
        evidenceSnippet: item.entry.evidenceSnippets?.[0] || item.entry.claim,
        metadata: {
          sentence: item.sentence,
          entryId: item.entry.id,
          sourcePdfId: undefined,
          sourcePdfName: undefined,
        },
      }];
    }),
  };
}

async function aiSelectPapers(
  papers: any[],
  sentence: string,
  targetCount: number,
  apiUrl: string,
  apiKey: string,
  model?: string
): Promise<any[]> {
  if (papers.length === 0) return [];
  if (papers.length <= targetCount) return papers;

  const useModel = model || currentModel || "gpt-4o";
  const papersForAnalysis = papers.slice(0, 12);

  const prompt = `筛选文献支撑以下论点：

论点：${sentence}

检索到的文献（${papersForAnalysis.length} 篇）:
${papersForAnalysis.map((p, i) =>
`[${i + 1}] ${p.title}
作者：${p.author}
年份：${p.year}
期刊：${p.journal || '未知'}
相关度：${(p.combinedScore || 0).toFixed(3)}
摘要：${p.abstract?.substring(0, 500) || '无摘要'}`
).join('\n\n')}

筛选标准:
1. 摘要内容直接支撑该论点
2. 优先 2020 年后文献
3. 优先高相关度文献

请选择最相关的 ${targetCount} 篇文献，JSON 输出:
{
  "selected": [
    {"index": 1, "reason": "摘要直接证明了论点"}
  ]
}`;

  try {
    const response = await fetch(apiUrl + "/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: useModel,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: MAX_LLM_OUTPUT_TOKENS,
      }),
    });

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content || "";
    
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const selected: any[] = [];

      for (const item of parsed.selected || []) {
        const paper = papersForAnalysis[item.index - 1];
        if (paper) {
          selected.push({
            ...paper,
            relevanceScore: item.relevanceScore || 85,
            qualityScore: item.qualityScore || 80,
          });
        }
      }

      if (selected.length > 0) {
        logger.info(`[AI筛选] 从 ${papers.length} 篇中筛选出 ${selected.length} 篇`);
        return selected;
      }
    }
  } catch (error) {
    logger.warn('[AI筛选] 失败，使用 top 结果', error);
  }

  return papers.slice(0, targetCount).map(p => ({
    ...p,
    relevanceScore: Math.round((p.combinedScore || 0.5) * 100),
    qualityScore: Math.round((p.combinedScore || 0.5) * 100),
  }));
}

function deduplicateByTitle(results: any[]): any[] {
  const seen = new Set<string>();
  const unique: any[] = [];
  
  for (const result of results) {
    const normalizedTitle = (result.title || '').toLowerCase().trim();
    if (normalizedTitle && !seen.has(normalizedTitle)) {
      seen.add(normalizedTitle);
      unique.push(result);
    }
  }
  
  return unique.sort((a, b) => (b.score || 0) - (a.score || 0));
}

function deduplicatePdfWikiResults(results: PdfWikiRetrievalResult[]): PdfWikiRetrievalResult[] {
  const seen = new Set<string>();
  const unique: PdfWikiRetrievalResult[] = [];

  for (const result of results) {
    if (!seen.has(result.entry.id)) {
      seen.add(result.entry.id);
      unique.push(result);
    }
  }

  return unique.sort((a, b) => b.score - a.score);
}

function formatPdfWikiRetrievalResultsForFile(
  points: RetrievalPoint[],
  results: PdfWikiRetrievalResult[],
  stats: { sentence: string; keyword: string; found: number; selected: number }[]
): string {
  let content = `# PDF Wiki 文献检索结果\n`;
  content += `# 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
  content += `# 检索句子数量: ${stats.length}\n`;
  content += `# 筛选后 PDF Wiki 证据对象: ${results.length} 个\n\n`;

  content += `## 检索统计\n\n`;
  for (const stat of stats) {
    content += `### 检索句子: ${stat.sentence}\n`;
    content += `- 检索词: ${stat.keyword}\n`;
    content += `- 检索到: ${stat.found} 个 PDF Wiki 证据对象\n`;
    content += `- 筛选: ${stat.selected} 个\n\n`;
  }
  content += `\n---\n\n`;

  content += `## 对应论点\n\n`;
  for (const point of points) {
    content += `**句子**: ${point.sentence}\n`;
    content += `**英文检索词**: ${point.keywords_en.join(', ')}\n`;
    if (point.keywords_cn && point.keywords_cn.length > 0) {
      content += `**中文检索词**: ${point.keywords_cn.join(', ')}\n`;
    }
    content += `\n`;
  }
  content += `---\n\n`;

  content += `## PDF Wiki 句子证据梳理\n\n`;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const entry = result.entry;
    content += `### [${i + 1}] ${entry.normalizedClaim || entry.claim}\n\n`;
    content += `**来源 PDF**: ${entry.sourcePdfNames.join('; ') || 'Unknown'}\n`;
    content += `**章节**: ${entry.sections.join('; ') || '未解析到'}\n`;
    content += `**对应检索论点**: ${result.sentence}\n`;
    content += `**检索词**: ${result.keyword}\n`;
    content += `**相关度**: ${(result.score * 100).toFixed(1)}%\n\n`;

    content += `**正向/支持观点**:\n`;
    if (entry.pro.length > 0) {
      entry.pro.forEach((view, idx) => {
        content += `${idx + 1}. ${view.summary}\n`;
        if (view.evidence) content += `   - 证据: ${view.evidence}\n`;
        if (view.inTextCitations.length > 0) content += `   - 文中引用: ${view.inTextCitations.join('; ')}\n`;
      });
    } else {
      content += `未在 PDF 中解析到明确正向观点\n`;
    }

    content += `\n**反向/限制性观点**:\n`;
    if (entry.con.length > 0) {
      entry.con.forEach((view, idx) => {
        content += `${idx + 1}. ${view.summary}\n`;
        if (view.evidence) content += `   - 证据: ${view.evidence}\n`;
        if (view.inTextCitations.length > 0) content += `   - 文中引用: ${view.inTextCitations.join('; ')}\n`;
      });
    } else {
      content += `未在 PDF 中解析到明确反向观点\n`;
    }

    if (entry.neutral.length > 0) {
      content += `\n**中性背景/机制解释**:\n`;
      entry.neutral.forEach((view, idx) => {
        content += `${idx + 1}. ${view.summary}\n`;
      });
    }

    content += `\n**证据摘录**:\n`;
    if (entry.evidenceSnippets.length > 0) {
      entry.evidenceSnippets.forEach((snippet, idx) => {
        content += `${idx + 1}. ${snippet}\n`;
      });
    } else {
      content += `未在 PDF 中解析到证据摘录\n`;
    }

    content += `\n**文中引用**: ${entry.inTextCitations.length > 0 ? entry.inTextCitations.join('; ') : '未解析到'}\n\n`;
    content += `**参考文献详细信息**:\n`;
    if (entry.references.length > 0) {
      entry.references.forEach((ref, idx) => {
        content += `${idx + 1}. ${formatPdfWikiReference(ref)}\n`;
      });
    } else {
      content += `未在 PDF 中解析到完整参考文献信息\n`;
    }

    content += `\n---\n\n`;
  }

  return content;
}

function formatPdfWikiReference(ref: { title?: string; authors?: string; year?: string; journal?: string; doi?: string; raw?: string }): string {
  const parts = [
    ref.authors,
    ref.year ? `(${ref.year})` : undefined,
    ref.title,
    ref.journal,
    ref.doi ? `DOI: ${ref.doi}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('. ') : (ref.raw || '未在 PDF 中解析到完整参考文献信息');
}

function formatCombinedRetrievalResultsForFile(
  points: RetrievalPoint[],
  results: RetrievalExecutionResult[]
): string {
  let content = `# 双文献库检索结果\n`;
  content += `# 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
  content += `# 检索库: ${results.map(result => result.sourceLabel).join(' + ')}\n`;
  content += `# 论点数量: ${points.length}\n`;
  content += `# 合计检索命中: ${results.reduce((sum, result) => sum + result.totalFound, 0)}\n`;
  content += `# 合计筛选结果: ${results.reduce((sum, result) => sum + result.uniqueCount, 0)}\n\n`;

  content += `## 对应论点\n\n`;
  for (const point of points) {
    content += `**句子**: ${point.sentence}\n`;
    content += `**英文检索词**: ${point.keywords_en.join(', ')}\n`;
    if (point.keywords_cn && point.keywords_cn.length > 0) {
      content += `**中文检索词**: ${point.keywords_cn.join(', ')}\n`;
    }
    content += `\n`;
  }
  content += `---\n\n`;

  for (const result of results) {
    content += `# ${result.sourceLabel}\n\n`;
    content += result.fullContent.trim();
    content += `\n\n---\n\n`;
  }

  return content;
}

function formatRetrievalResultsForFile(
  points: RetrievalPoint[], 
  results: any[], 
  stats: RetrievalSearchStat[]
): string {
  let content = `# 文献检索结果\n`;
  content += `# 生成时间: ${new Date().toLocaleString('zh-CN')}\n`;
  content += `# 论点数量: ${stats.length}\n`;
  content += `# 筛选后文献: ${results.length} 篇\n\n`;
  
  content += `## 检索统计\n\n`;
  for (const stat of stats) {
    content += `### 论点: ${stat.sentence}\n`;
    content += `- 检索词: ${stat.keyword}\n`;
    content += `- 检索到: ${stat.found} 篇\n`;
    content += `- AI筛选: ${stat.selected} 篇\n\n`;
  }
  content += `\n---\n\n`;
  
  content += `## 对应论点\n\n`;
  for (const point of points) {
    content += `**句子**: ${point.sentence}\n`;
    content += `**英文检索词**: ${point.keywords_en.join(', ')}\n`;
    if (point.keywords_cn && point.keywords_cn.length > 0) {
      content += `**中文检索词**: ${point.keywords_cn.join(', ')}\n`;
    }
    content += `\n`;
  }
  content += `---\n\n`;
  
  content += `## 检索到的文献\n\n`;
  
  for (let i = 0; i < results.length; i++) {
    const paper = results[i];
    const authors = Array.isArray(paper.authors) 
      ? paper.authors.map((a: any) => a.name || a).join(', ')
      : paper.author || 'Unknown';
    const firstAuthor = Array.isArray(paper.authors) && paper.authors.length > 0
      ? (paper.authors[0].name || paper.authors[0]).split(/\s+/).pop() || 'Unknown'
      : (paper.author || 'Unknown').split(',')[0].trim().split(/\s+/).pop() || 'Unknown';
    
    content += `### [${i + 1}] ${paper.title || 'Unknown Title'}\n\n`;
    content += `**引用格式**: (${firstAuthor} et al., ${paper.year || 'n.d.'})\n`;
    content += `**作者**: ${authors}\n`;
    content += `**年份**: ${paper.year || 'Unknown'}\n`;
    content += `**期刊**: ${paper.journal || 'Unknown'}\n`;
    if (paper.doi) {
      content += `**DOI**: ${paper.doi}\n`;
    }
    if (paper.abstract) {
      content += `**摘要**: ${paper.abstract}\n`;
    }
    content += `**相关度**: ${(paper.score * 100).toFixed(1)}%\n`;
    if (paper.relevanceScore) {
      content += `**AI评分**: 相关度 ${paper.relevanceScore}/100, 质量 ${paper.qualityScore || 80}/100\n`;
    }
    content += `**检索词**: ${paper.keyword}\n`;
    content += `**对应论点**: ${paper.sentence || '未知'}\n`;
    content += `\n---\n\n`;
  }
  
  return content;
}

// ============ 一键写论文 API ============

interface ReviewWriterLlmConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
}

interface ReviewWriterSentencePlan {
  id: string;
  purpose: string;
  plannedContent: string;
  searchKeywords: string[];
  targetWords?: number;
  searchQuery?: string;
  writtenSentence?: string;
  candidateEvidenceCount?: number;
  evidenceCount?: number;
}

interface ReviewWriterParagraphPlan {
  id: string;
  title: string;
  purpose: string;
  targetWords?: number;
  sentences: ReviewWriterSentencePlan[];
  text?: string;
}

interface ReviewWriterSectionPlan {
  id: string;
  title: string;
  skillName: string;
  targetWords?: number;
  paragraphs: ReviewWriterParagraphPlan[];
  text?: string;
}

interface ReviewWriterOutline {
  title: string;
  topic: string;
  sections: ReviewWriterSectionPlan[];
}

interface ReviewWriterEvidence {
  id: string;
  source: "abstract" | "pdfWiki";
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi?: string;
  abstract: string;
  score: number;
  citation: string;
  referenceRaw?: string;
  referenceNumber?: number;
  traceSnippets?: ReviewWriterEvidenceTraceSnippet[];
  claimSupport?: ClaimEvidenceJudgment;
  qualityGate?: ClaimEvidenceQualityGate;
  originalScore?: number;
}

interface ReviewWriterEvidenceTraceSnippet {
  code: string;
  text: string;
  source: "abstract" | "pdfWiki";
  sourceLabel: string;
}

interface ReviewWriterSentenceProvenance {
  sectionId: string;
  sectionTitle: string;
  paragraphId: string;
  paragraphTitle: string;
  sentenceId: string;
  plannedContent: string;
  purpose: string;
  searchQuery: string;
  writtenSentence: string;
  evidence: ReviewWriterEvidence[];
}

type ReviewWriterLibrarySource = "abstract" | "pdfWiki";
type ReviewWriterCitationStyle = "authorYear" | "numeric" | "custom";
type ReviewWriterArsReportKey = "pipelineGate" | "researchPlan" | "citationIntegrity" | "multiReview";

interface ReviewWriterArsReportSummary {
  mode: AcademicResearchMode;
  provider: AcademicResearchRunResult["provider"];
  fallbackAttempts: string[];
  contentPreview: string;
}

type ReviewWriterArsReports = Partial<Record<ReviewWriterArsReportKey, ReviewWriterArsReportSummary>>;
type ReviewWriterArsRawReports = Partial<Record<ReviewWriterArsReportKey, AcademicResearchRunResult>>;

interface ReviewWriterGenerationInput {
  writingProfileId: ProjectWritingProfileId;
  topic: string;
  userRequirements: string;
  userId: string;
  config: ReviewWriterLlmConfig;
  wordCount: number;
  language: string;
  topK: number;
  librarySources: ReviewWriterLibrarySource[];
  useCodexCli: boolean;
  useLongTermMemory: boolean;
  useExperimentMaterials: boolean;
  useAutoResearchContext: boolean;
  referenceFormat: string;
  citationStyle: ReviewWriterCitationStyle;
  customCitationFormat: string;
  inTextCitationFormat: string;
  journalStyleIds: string[];
}

interface ReviewWriterGenerationResult {
  success: true;
  writingProfileId: ProjectWritingProfileId;
  writingProfileLabel: string;
  outline: ReviewWriterOutline;
  content: string;
  fileName: string;
  filePath: string;
  totalSentences: number;
  referenceCount: number;
  wordCount: number;
  warnings: string[];
  qualityReview?: ReviewWriterQualityReviewResult;
  arsReports?: ReviewWriterArsReports;
  researchSession?: {
    sessionId: string;
    writingArtifactId: string;
    paragraphProvenanceRecordIds: string[];
    citationProvenanceRecordIds: string[];
    reviewerReportId: string;
  };
}

interface ReviewWriterQualityReviewResult {
  passed: boolean;
  score: number;
  verdict: string;
  rounds: number;
  reportMarkdown: string;
  targetScore?: number;
  bestScore?: number;
  topProblems?: string[];
  revisionInstructions?: string[];
  affectedSections?: string[];
  doNotChangeSections?: string[];
  stoppedReason?: string;
  paperType?: string;
  diagnosis?: string;
  recommendedTitle?: string;
  titleOptions?: string[];
  figureTableSuggestions?: string[];
  modificationNotes?: string[];
  missingInformation?: string[];
}

interface ReviewWriterJob {
  jobId: string;
  userId: string;
  writingProfileId?: ProjectWritingProfileId;
  writingProfileLabel?: string;
  topic: string;
  userRequirements?: string;
  wordCount: number;
  librarySources?: ReviewWriterLibrarySource[];
  useCodexCli?: boolean;
  useLongTermMemory?: boolean;
  useExperimentMaterials?: boolean;
  useAutoResearchContext?: boolean;
  referenceFormat?: string;
  citationStyle?: ReviewWriterCitationStyle;
  inTextCitationFormat?: string;
  journalStyleIds?: string[];
  status: "queued" | "running" | "completed" | "error" | "stopped";
  stopRequested?: boolean;
  progress: number;
  step: string;
  message: string;
  logs: string[];
  startedAt: string;
  updatedAt: string;
  result?: ReviewWriterGenerationResult;
  error?: string;
}

const reviewWriterJobs = new Map<string, ReviewWriterJob>();
const reviewWriterJobInputs = new Map<string, ReviewWriterGenerationInput>();

class ReviewWriterStoppedError extends Error {
  constructor(message = "一键写作任务已停止") {
    super(message);
    this.name = "ReviewWriterStoppedError";
  }
}

const REVIEW_WRITER_QUALITY_GATE_PROMPT = `你现在不是普通写作助手，而是“学术论文质量控制编辑 + 严格综述写作代理”。

你的任务是帮助写作、改写或扩展一篇学术综述/论文。但必须把质量控制放在写作之前。不要为了让文章看起来完整而堆砌文献、编造逻辑、扩大结论或使用不匹配的引用。

总原则：
1. 优先保证论题范围一致、每个事实性论断都有真实直接相关证据支撑、引用与句子含义严格对应、综述体现机制/矛盾/条件/证据强度的综合，不把间接证据写成直接证据，不把其他地区/对象/体系/方法的证据直接外推成本文主题结论，不使用夸张或 AI 化空泛表达。
2. 证据不足时必须降级表述，例如“表明”改为“提示”，“证明”改为“支持这一可能性”，“导致”改为“在某些条件下可能导致”。如果直接证据有限，必须明确写出。
3. 不得虚构文献、DOI、数据、结论或实验结果。PDF Wiki 句子级证据必须使用证据包里给出的句子级编号作为正文标记，例如（句子证XXXXXX）；如果无法确认其直接支持某句话，在同一编号后补充“需核查”。embedding 文献库证据只使用正常文内引用，例如 (Zhang et al., 2026)，不要加 R编号或句子证编号。
4. 写作前和写作中持续执行质量门控：论题锁定、关键概念定义、证据等级分类、引用—论断匹配、综述深度、语言风险检查。
5. 引用证据等级：A 类直接证据；B 类相邻证据；C 类机制证据；D 类背景证据；E 类弱相关或不相关证据。写作必须优先使用 A/B，C/D 必须说明外推限制，E 不得使用。
6. 每个主体段落至少包含机制解释、条件边界、文献比较、证据强度、知识缺口、研究/模型/方法启示中的两类，禁止写成“研究 A 发现……研究 B 发现……因此很重要”的文献堆砌。
7. 避免无具体对象、机制、证据或操作方案支撑的空泛表达，如 is urgently needed, plays a crucial role, provides important insights, has attracted increasing attention, robust predictions, comprehensive understanding, key research gaps, future research should, significant implications。
8. 结构优先采用“问题—机制—证据—矛盾—解释—缺口”，而不是“文献 A—文献 B—文献 C”。
9. 修改优先级：先修引用不支撑正文、证据外推未说明、主题范围漂移、关键概念未定义、结论超过证据；再修缺少综合框架、段落像文献罗列、缺少矛盾解释、缺少条件边界；最后做语言润色和格式统一。
10. 如果 Auto Research 提供 contentEnhancementReport，必须把它作为硬约束：提纲和正文应纳入正向发现、Evidence Matrix、Variable-Mechanism-Outcome Matrix、Quantitative Result Summary（无数值则写 NR）、Indicator Boundary Check、Conceptual Framework 和 Evidence Strength Heatmap；不得只写“建议增加图表”而不生成表格/图示结构。
11. 避免把论文写成只有“证据不足/不能推广”的防守型报告。必须优先总结当前材料能支持的条件性正向发现，再说明边界、弱证据和未来验证。

${REFERENCE_RELEVANCE_WRITING_RULES}

在自动写作管线中，你必须把上述质量控制作为内部硬约束执行。除非当前任务明确要求输出质量控制表，否则不要把质量控制表混入正文。`;

const REVIEW_WRITER_SENTENCE_QUALITY_RULES = `短版质量规则：
1. 只写当前证据能直接或相邻支持的内容，不得编造文献、数据、DOI、机制或结论。
2. 间接证据必须降级表述，例如 use "may", "suggests", "is consistent with"，不能写成证明或确定因果。
3. 引用必须和句子含义匹配；PDF Wiki 句子级证据直接使用证据包给出的（句子证XXXXXX）编号，正文不要写“PDF Wiki”等工具字样；证据不确定时在编号后补充“需核查”。embedding 文献库证据直接使用正常文内引用，例如 (Zhang et al., 2026)，不要加 R编号或句子证编号。
4. 句子要服务于本文范围，避免空泛套话、文献罗列和过度概括。
5. 正文只输出普通文字和普通数字，不使用上下角标。

${REFERENCE_RELEVANCE_WRITING_RULES}`;

const REVIEW_WRITER_SECTION_REVIEW_PROMPT = `你是严格的章节级学术质量编辑。只审查并修正当前章节，不重写全文。
重点处理：范围漂移、引用不支撑论断、间接证据被写成直接证据、文献罗列、缺少机制/条件边界/矛盾解释、过度确定和 AI 化空话。
修改必须受给定证据约束，不得新增证据包中没有的引用、DOI、数据或结论。

${REFERENCE_RELEVANCE_AUDIT_RULES}`;

const REVIEW_WRITER_FINAL_COMPACT_AUDIT_PROMPT = `你是严格的终稿风险审查与局部修订编辑。此前章节已做过局部质控，本轮只做全局一致性和高风险问题检查。
优先检查：论题范围漂移、核心概念缺失、章节之间逻辑断裂、引用明显错配、证据外推未说明、结论超过证据、参考文献格式异常。
如果未达到目标分数，只返回最关键的 1-3 个章节修改稿；不要重写全文，不要修改 References，不要新增证据包中没有的引用。

${REFERENCE_RELEVANCE_AUDIT_RULES}`;

const REVIEW_WRITER_FINAL_MANUSCRIPT_OPTIMIZATION_PROMPT = `终稿级论文质量控制规范：
你必须同时扮演严格学术编辑、审稿人和领域专家。目标不是简单润色，而是把现有初稿优化为更接近可投稿状态的正式论文稿。

一、先判断论文类型，并按类型选择审查标准：
- 原创研究论文、综述论文、系统综述、Meta 分析、研究方案、政策/技术报告或其他类型。
- 原创研究重点审查方法、结果、讨论和结论是否受数据支撑。
- 综述重点审查综合框架、证据比较、机制解释和知识缺口。
- 系统综述/Meta 分析重点审查检索策略、纳排标准、数据提取、偏倚风险、统计模型、异质性和发表偏倚。

二、彻底删除 AI 或工具痕迹：
- 删除“根据用户资料”“根据PDF”“AI生成”“模型认为”“系统提示”“一键生成”“PDF Wiki”“embedding library”“文件名”“解析结果”“未解析”等工具痕迹。
- 删除乱码、占位符、模板残留、无意义小标题、重复句和无证据的泛泛表达。
- 任何不确定信息必须写成“需要作者补充”，不得伪装成已知事实。

三、重建论文主线：
- 背景 -> 科学问题 -> 研究目的 -> 方法/分析路径 -> 结果或证据 -> 机制解释 -> 学术/应用意义 -> 局限与未来工作。
- 每个主体段落都必须围绕一个明确科学问题展开，避免“文献 A 发现、文献 B 发现”的罗列。
- 结论必须来自正文证据，不能扩大为证据外推。

四、题目、摘要和关键词：
- 必须提出 3 个题目选项：稳妥型、创新型、投稿型，并推荐其中一个。
- 摘要按论文类型重写：原创研究包含背景、目的、方法、关键结果、结论；综述包含背景、综述范围、主要观点、知识缺口、未来方向；Meta 分析包含问题、检索/纳排、效应量/模型、主要结果、异质性/偏倚、结论。
- 关键词 4-6 个，具体、学术、避免过宽泛。

五、正文结构优化：
- 引言建议 4-5 段：研究背景、现有认识、关键不足、本文目的/假设/综述范围、研究意义。
- 方法部分不得编造实验、检索、统计或软件细节；缺失信息写“需要作者补充”。
- 结果部分只呈现结果或证据，不提前过度解释；结果组织应按变量、机制、研究问题或证据类别展开。
- 讨论部分必须解释主要发现、与既有文献比较、说明机制、应用意义、局限和未来研究；使用克制表达。
- 结论 2-4 段，突出核心发现、贡献、适用范围和后续工作。

六、证据和引用：
- 不得编造数据、实验结果、统计结果、参考文献、DOI 或检索过程。
- 引用必须支撑对应句子；PDF Wiki 句子级证据保留（句子证XXXXXX）编号，证据无法确认时在编号后补充“需核查”；正文不要写“PDF Wiki”等工具字样。embedding 文献库证据只保留正常文内引用，例如 (Zhang et al., 2026)，不要加 R编号或句子证编号。
- 删除或降级不受证据支持的强断言，避免“证明”“必然导致”“显著提高”等超出证据的表述。
- 必须执行参考文献相关性约束：把每条文献先分为 Direct、System-specific、Adjacent、Mechanistic、Background 或 Excluded；Excluded 不得进入正文引用，Adjacent/Mechanistic/Background 不得被写成直接证据。

七、图表和语言：
- 如果 Auto Research 或用户材料已经给出证据矩阵、变量-机制-结果矩阵、量化结果表、指标边界表、概念框架图或证据强度热力图，必须把这些内容实际整合进正文结构或建议图表清单；不得只泛泛说“建议增加图表”。
- 无法确认数值时写 NR 或“需要作者补充”，不得虚构真实数据、统计结果、效应量或 P 值。
- 语言应正式、克制、逻辑清晰，减少 AI 化套话和空泛形容词。

普通报告模式的输出格式应包含：
第一部分：论文整体诊断；第二部分：优化后的论文题目；第三部分：优化后的完整论文稿；第四部分：建议增加的图表；第五部分：主要修改说明。

自动化 JSON 质量门控模式适配：
- 不要把“整体诊断/题目选项/图表建议/修改说明”混入最终论文正文。
- 在 JSON 中用 paperType、titleOptions、recommendedTitle、qualityControlSummary 承载诊断类内容。
- revisedSections 只返回需要替换进论文正文的章节；References 不要改写，除非只是标注需核查。
- 如果正文中出现 AI/工具痕迹、乱码、占位符或“未解析”，必须作为高优先级问题处理。`;

const REVIEW_WRITER_FINAL_AUDIT_PROMPT = `你现在是一名非常严格的学术期刊审稿人和论文质量评估专家。

请评估下面这篇已经完成的学术综述/论文。你的任务不是判断选题是否重要，也不是单纯润色语言，而是检查这篇文章是否达到了合格学术论文的质量标准。

${REVIEW_WRITER_FINAL_MANUSCRIPT_OPTIMIZATION_PROMPT}

重点检查：
1. 论题范围是否一致；2. 是否存在范围漂移；3. 核心概念是否有清晰定义；4. 文献是否真正支持对应论断；5. 是否存在引用和正文错配；6. 是否把间接证据写成直接证据；7. 是否不恰当地外推其他地区、对象、系统或方法证据；8. 是否只是罗列文献而没有综合判断；9. 是否解释了不同研究之间的矛盾；10. 是否说明结论成立的条件边界；11. 是否过度确定或过度概括；12. 参考文献是否可靠、相关、格式规范；13. 语言是否有 AI 化、空泛化、模板化痕迹；14. 结论和未来展望是否具体、克制、可执行；15. 是否有正向发现、证据矩阵、变量-机制-结果链、指标边界、概念框架和真实可用的图表结构，而不是只有限制和图表建议。

${REFERENCE_RELEVANCE_AUDIT_RULES}

评估原则：不要泛泛表扬。发现问题必须指出问题位置、问题类型、为什么是问题、学术风险、修改方法。无法确认引用是否真正支持正文时，标记“需核查引用原文”。题目或摘要看似相关但正文论断不匹配时，标记“高风险引用错配”。间接证据当作直接证据使用时，标记“证据外推未说明”。

必须输出以下内容：
1. 一句话诊断：概括最大质量风险。
2. 范围一致性检查表：位置、原始问题、问题类型、严重程度、修改建议。
3. 引用—论断抽样审计：至少 15 个带引用关键论断，分别判断每个引用是否直接支持。证据等级只能用 A 直接证据、B 相邻证据、C 机制类比、D 背景证据、E 弱相关/不相关。建议处理只能用保留、降级表述、更换引用、删除引用、删除句子、标记需核查。
4. 综述深度评估表：每个主体章节是否像综述而不是罗列，缺少哪些综合维度。
5. 定义和概念框架检查表：核心研究对象、关键术语、事件/变量定义、空间范围、时间尺度、证据纳入边界、机制框架、结论适用条件。
6. 过度断言和外推检查：列出原表达、问题、建议替代表述。
7. 参考文献质量检查：弱相关、错用、信息不完整、DOI/格式异常、来源可疑、重复、不统一、不应作为正式来源、题目与正文论断不匹配、过多间接文献。
8. 语言和风格检查：列出 10 个最需要改写的句子。
9. 100 分制评分表：论题范围一致性 15，引用—论断匹配度 25，综述综合深度 20，概念定义和框架 10，结论克制性和条件边界 10，结构逻辑 10，参考文献质量 5，语言质量 5，总分 100。严格评分，不因语言流畅给高分。如果引用—论断匹配度低于 18/25，即使总分较高也判定需要大修。发现疑似虚构文献、来源异常、引用明显不支撑正文，必须判定不可直接提交。
10. 最终判定：可以提交 / 小修后可提交 / 大修后再评估 / 不建议提交，需重构。列出最优先修改的 10 个问题，并给出一句最重要的修改建议。

为了自动化质量门控，最后必须追加一个 JSON 对象，放在 <QUALITY_JSON> 与 </QUALITY_JSON> 标签之间，格式如下：
<QUALITY_JSON>{"score":0,"verdict":"大修后再评估","passed":false,"paperType":"综述论文","titleOptions":["稳妥型题目","创新型题目","投稿型题目"],"recommendedTitle":"推荐题目","topProblems":["问题1"],"revisionInstructions":["定向修改建议1"],"affectedSections":["Introduction"],"doNotChangeSections":["References"],"qualityControlSummary":{"diagnosis":"整体诊断","figureTableSuggestions":["建议图表1"],"modificationNotes":["主要修改1"],"missingInformation":["需要作者补充的信息"]}}</QUALITY_JSON>

affectedSections 必须只列最需要局部返修的章节标题或章节关键词，最多 3 个。doNotChangeSections 列不应修改的章节。`;

const reviewWriterCloudPromptCache = new Map<string, string | null>();

async function getReviewWriterCloudPrompt(promptId: string, fallback: string): Promise<string> {
  if (process.env.CLOUD_PROMPTS_DISABLED === '1') return fallback;
  if (reviewWriterCloudPromptCache.has(promptId)) {
    return reviewWriterCloudPromptCache.get(promptId) || fallback;
  }
  try {
    const prompt = await cloudPromptClient.getCorePrompt(promptId);
    reviewWriterCloudPromptCache.set(promptId, prompt.content);
    logger.info(`[ReviewWriter] Loaded cloud prompt ${promptId} v${prompt.version}`);
    return prompt.content || fallback;
  } catch (error) {
    reviewWriterCloudPromptCache.set(promptId, null);
    logger.warn(`[ReviewWriter] Cloud prompt ${promptId} unavailable, using local fallback`, error);
    return fallback;
  }
}

function clampReviewInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function cleanReviewText(value: unknown, fallback = ""): string {
  const text = typeof value === "string" ? value : fallback;
  return text.replace(/\s+/g, " ").trim();
}

function cleanReviewMultilineText(value: unknown, fallback = "", maxLength = 3000): string {
  const text = typeof value === "string" ? value : fallback;
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxLength);
}

function cleanReviewTitle(value: unknown, fallback: string): string {
  const text = cleanReviewText(value, fallback)
    .replace(/[{}\\]/g, "")
    .trim();
  return text || fallback;
}

function parseReviewBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") {
    return /^(true|1|yes|on|checked)$/i.test(value.trim());
  }
  return false;
}

function parseReviewJournalStyleIds(value: unknown): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(",") : []);
  const ids = rawItems
    .map((item) => String(item || "").trim())
    .filter((item) => isSafeJournalStyleId(item));
  return [...new Set(ids)].slice(0, 6);
}

function parseReviewLibrarySources(value: unknown): ReviewWriterLibrarySource[] {
  if (value === undefined || value === null) return ["abstract", "pdfWiki"];
  const rawValues = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(/[,;，；]/) : []);
  const normalized = rawValues
    .map((item) => String(item || "").trim())
    .map((item) => {
      if (/^(abstract|embedding|embedding-library|embeddingLibrary)$/i.test(item)) return "abstract";
      if (/^(pdfWiki|pdf-wiki|wiki|pdf)$/i.test(item)) return "pdfWiki";
      return "";
    })
    .filter((item): item is ReviewWriterLibrarySource => item === "abstract" || item === "pdfWiki");
  return [...new Set(normalized)];
}

function formatReviewLibrarySourcesForUser(sources: ReviewWriterLibrarySource[]): string {
  return sources
    .map((source) => source === "pdfWiki" ? "PDF 论点库" : "Embedding 文献库")
    .join(" + ");
}

function parseReviewCitationStyle(value: unknown): ReviewWriterCitationStyle {
  const text = cleanReviewText(value, "authorYear");
  if (/^(numeric|number|numbered|\[1\]|gb|ieee|vancouver)$/i.test(text)) return "numeric";
  if (/^(custom|other|自定义|其他)$/i.test(text)) return "custom";
  return "authorYear";
}

function buildReviewCitationFormatInstruction(style: ReviewWriterCitationStyle, customCitationFormat: string): string {
  if (style === "numeric") {
    return "[1] numeric bracket citations; use the exact bracket number assigned to each evidence item, such as [1] or [1,2].";
  }
  if (style === "custom") {
    return customCitationFormat || "User-defined in-text citation style.";
  }
  return "(Zhang et al., 2026) author-year citations.";
}

function isReviewEmptyResponseError(error: unknown): boolean {
  return /empty response/i.test((error as Error)?.message || String(error));
}

function isReviewCodexUnavailableError(error: unknown): boolean {
  const message = (error as Error)?.message || String(error || "");
  return /not found|enoent|未在常见路径|找不到|不是内部或外部命令|not recognized|no such file/i.test(message);
}

function throwIfReviewWriterStopped(shouldStop?: () => boolean): void {
  if (shouldStop?.()) {
    throw new ReviewWriterStoppedError();
  }
}

function estimateReviewTokenCount(text: string): number {
  const cjkChars = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const nonCjkChars = Math.max(0, text.length - cjkChars);
  return cjkChars + Math.ceil(nonCjkChars / 4);
}

function getReviewMessagesSize(messages: Array<{ content: string }>): { chars: number; estimatedTokens: number } {
  const text = messages.map((message) => message.content || "").join("\n\n");
  return {
    chars: text.length,
    estimatedTokens: estimateReviewTokenCount(text),
  };
}

type ReviewWriterLlmTaskKind = "outline" | "sentence" | "reference" | "sectionReview" | "qualityAudit" | "qualityRevision" | "default";

function getReviewOutputTokenBudget(kind: ReviewWriterLlmTaskKind): number {
  const defaults: Record<ReviewWriterLlmTaskKind, number> = {
    outline: 9000,
    sentence: 1200,
    reference: 9000,
    sectionReview: 8000,
    qualityAudit: 12000,
    qualityRevision: 12000,
    default: MAX_LLM_OUTPUT_TOKENS,
  };
  const envKeys: Record<ReviewWriterLlmTaskKind, string> = {
    outline: "REVIEW_WRITER_OUTLINE_MAX_TOKENS",
    sentence: "REVIEW_WRITER_SENTENCE_MAX_TOKENS",
    reference: "REVIEW_WRITER_REFERENCE_MAX_TOKENS",
    sectionReview: "REVIEW_WRITER_SECTION_REVIEW_MAX_TOKENS",
    qualityAudit: "REVIEW_WRITER_QUALITY_AUDIT_MAX_TOKENS",
    qualityRevision: "REVIEW_WRITER_QUALITY_REVISION_MAX_TOKENS",
    default: "REVIEW_WRITER_DEFAULT_MAX_TOKENS",
  };
  return clampReviewInteger(process.env[envKeys[kind]], defaults[kind], 512, MAX_LLM_OUTPUT_TOKENS);
}

function getReviewContextCharBudget(kind: "outline" | "sentence" | "sectionReview"): number {
  const defaults = {
    outline: 24000,
    sentence: 6000,
    sectionReview: 10000,
  };
  const envKeys = {
    outline: "REVIEW_WRITER_OUTLINE_CONTEXT_MAX_CHARS",
    sentence: "REVIEW_WRITER_SENTENCE_CONTEXT_MAX_CHARS",
    sectionReview: "REVIEW_WRITER_SECTION_CONTEXT_MAX_CHARS",
  };
  return clampReviewInteger(process.env[envKeys[kind]], defaults[kind], 1000, 120000);
}

function buildReviewScopedSupplementalContext(
  context: string,
  maxChars: number,
  focusTerms: string[] = []
): string {
  const cleaned = cleanReviewMultilineText(context, "", Math.max(context.length, maxChars));
  if (!cleaned || cleaned.length <= maxChars) return cleaned;

  const terms = focusTerms
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9\u3400-\u9fff+_-]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3)
    .slice(0, 60);
  const chunks = cleaned
    .split(/\n{2,}|(?<=。)|(?<=\.)\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);
  const scored = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0);
    return { chunk, index, score };
  });
  const selected = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const fallback = scored.slice(0, 12);
  const candidates = selected.length > 0 ? selected : fallback;
  const parts: string[] = [
    "## Scoped supplemental context",
    "The full long-term memory / experimental materials remain stored locally. This call receives only the most relevant excerpts to avoid context overflow.",
  ];
  let total = parts.join("\n").length;
  for (const item of candidates) {
    const next = item.chunk.slice(0, Math.min(1800, Math.max(400, maxChars - total - 200)));
    if (!next || total + next.length + 2 > maxChars) break;
    parts.push(next);
    total += next.length + 2;
  }
  return parts.join("\n\n").slice(0, maxChars);
}

async function callReviewWriterLlm(
  args: {
    label: string;
    config: ReviewWriterLlmConfig;
    messages: ChatOptions["messages"];
    temperature: number;
    maxTokens: number;
    useCodexCli: boolean;
  }
): Promise<string> {
  if (args.useCodexCli) {
    const codexTimeoutMs = clampReviewInteger(process.env.REVIEW_WRITER_CODEX_TIMEOUT_MS, 1800000, 300000, 3600000);
    let lastCodexError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        logger.info(`[ReviewWriter] ${args.label}: using Codex CLI attempt ${attempt}/2, no secondary fallback, timeout=${codexTimeoutMs}ms`);
        return await chatBridge.chat({
          model: args.config.model,
          messages: args.messages,
          temperature: args.temperature,
          maxTokens: args.maxTokens,
          forceProvider: "codex",
          disableFallback: true,
          codexTimeoutMs,
          apiUrl: args.config.apiUrl,
          apiKey: args.config.apiKey,
        });
      } catch (error) {
        lastCodexError = error;
        logger.warn(`[ReviewWriter] ${args.label}: Codex CLI attempt ${attempt}/2 failed: ${(error as Error).message}`);
        if (isReviewCodexUnavailableError(error)) {
          break;
        }
      }
    }

    if (!isReviewCodexUnavailableError(lastCodexError)) {
      throw new Error(
        `${args.label} Codex CLI 调用失败，已按一键写论文设置禁止自动降级小牛马；` +
        `请检查 Codex CLI 日志或降低论文长度后重试。Last error: ${(lastCodexError as Error)?.message || String(lastCodexError || "unknown")}`
      );
    }

    logger.warn(`[ReviewWriter] ${args.label}: Codex CLI 未检测到，按配置降级使用小牛马`);
  }

  return callChatCompletion(
    {
      apiUrl: args.config.apiUrl,
      apiKey: args.config.apiKey,
      defaultModel: args.config.model,
      defaultTemperature: args.temperature,
      label: args.label,
    },
    {
      model: args.config.model,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      messages: args.messages,
    }
  );
}

async function loadReviewMemoryWithFallback(userId: string): Promise<Awaited<ReturnType<typeof loadUserMemory>>> {
  let memory = await loadUserMemory(userId);
  if (memory.entries.length === 0 && memory.conversations.length === 0 && userId !== "web-user") {
    const fallbackMemory = await loadUserMemory("web-user");
    if (fallbackMemory.entries.length > 0 || fallbackMemory.conversations.length > 0) {
      memory = fallbackMemory;
    }
  }
  return memory;
}

async function buildReviewLongTermMemoryContext(userId: string): Promise<string> {
  try {
    const memory = await loadReviewMemoryWithFallback(userId);
    if (memory.entries.length === 0 && memory.conversations.length === 0) {
      return "No cross-session long-term memory is currently stored for this user.";
    }

    return `## Cross-session long-term memory (complete, untruncated)
The user explicitly enabled this memory for the one-click paper task. Use it as user-specific background, constraints, and project context. Do not ignore it when it is relevant, but keep evidence-based scientific claims grounded in the selected literature evidence.

${JSON.stringify({
  userId: memory.userId,
  updatedAt: memory.updatedAt,
  entries: memory.entries,
  conversations: memory.conversations,
}, null, 2)}`;
  } catch (error) {
    logger.warn("[ReviewWriter] Failed to load long-term memory:", error);
    return "Long-term memory was requested, but loading it failed.";
  }
}

async function buildReviewExperimentMaterialsContext(
  userId: string,
  profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")
): Promise<string> {
  try {
    const memory = await loadReviewMemoryWithFallback(userId);
    const experimentKeys = new Set([
      "experiment_summary",
      "experiment_summary_structured",
      "research_method",
      "experimental_design",
    ]);
    const experimentEntries = memory.entries.filter((entry) =>
      experimentKeys.has(entry.key) ||
      /experiment|experimental|research_method|method|design|试验|实验/i.test(entry.key)
    );

    const textFilePath = path.join(getMemoryDir(), memory.userId || userId, "试验资料总结.txt");
    const syncedFileContent = fs.existsSync(textFilePath)
      ? fs.readFileSync(textFilePath, "utf-8")
      : "";

    if (experimentEntries.length === 0 && !syncedFileContent.trim()) {
      return "No experimental materials are currently stored for this user.";
    }

    return `## ${profile.shortLabel} project materials (complete, untruncated)
The user explicitly enabled project materials for this ${profile.documentType} task. Use these materials as user-provided background, requirements, design/plan context, methods, assumptions, and result context according to the current project type (${profile.label}). Do not cite this block as literature evidence; cite only selected literature evidence.

${JSON.stringify({
  userId: memory.userId,
  updatedAt: memory.updatedAt,
  entries: experimentEntries,
  syncedFile: syncedFileContent
    ? {
        path: textFilePath,
        content: syncedFileContent,
      }
    : null,
}, null, 2)}`;
  } catch (error) {
    logger.warn("[ReviewWriter] Failed to load experimental materials:", error);
    return "Experimental materials were requested, but loading them failed.";
  }
}

async function buildReviewAutoResearchContext(userId: string): Promise<string> {
  try {
    const currentProject = projectManager.getCurrentProject();
    const state = await autoResearchManager.getState(sanitizeUserId(userId), {
      projectId: currentProject.projectId || "current-workspace",
      projectName: currentProject.name || "当前工作区",
      writingProfileId: currentProject.writingProfileId,
      writingProfileLabel: currentProject.writingProfileLabel,
    });
    const finalReport = Array.isArray(state.finalReports) ? state.finalReports[0] : undefined;
    const draft = Array.isArray(state.paperDrafts) ? state.paperDrafts[0] : undefined;
    const audit = Array.isArray(state.auditReports) ? state.auditReports[0] : undefined;
    const contentEnhancement = finalReport?.contentEnhancementReport;
    const wiki = state.researchWiki || { nodes: [], edges: [], queryPack: "" };
    const evidenceObjects = state.evidenceLibrary?.objects || [];
    const literatureNodes = state.literatureMap?.nodes || [];
    const hasUsefulContext = Boolean(
      finalReport ||
      draft ||
      audit ||
      wiki.queryPack ||
      (Array.isArray(wiki.nodes) && wiki.nodes.length > 0) ||
      evidenceObjects.length > 0 ||
      literatureNodes.length > 0
    );
    if (!hasUsefulContext) return "";

    const topicReviewBlock = finalReport?.paperTopicReview ? [
      "## Auto Research paper topic and content pre-writing review",
      `Paper type: ${finalReport.paperTopicReview.paperType || ""}`,
      `Topic risk level: ${finalReport.paperTopicReview.topicRiskLevel || ""}`,
      `Evidence readiness: ${finalReport.paperTopicReview.evidenceReadiness || ""}`,
      `Go to writing stage: ${finalReport.paperTopicReview.goToWritingStage || ""}`,
      `Topic scope diagnosis: ${finalReport.paperTopicReview.topicScopeDiagnosis || ""}`,
      `Actual evidence scope: ${finalReport.paperTopicReview.actualEvidenceScope || ""}`,
      Array.isArray(finalReport.paperTopicReview.mismatchPoints) && finalReport.paperTopicReview.mismatchPoints.length
        ? `Mismatch points:\n${finalReport.paperTopicReview.mismatchPoints.slice(0, 8).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(finalReport.paperTopicReview.optimizedScientificQuestions) && finalReport.paperTopicReview.optimizedScientificQuestions.length
        ? `Optimized scientific questions:\n${finalReport.paperTopicReview.optimizedScientificQuestions.slice(0, 6).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(finalReport.paperTopicReview.highRiskIssues) && finalReport.paperTopicReview.highRiskIssues.length
        ? `High-risk issues:\n${finalReport.paperTopicReview.highRiskIssues.slice(0, 10).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      `Research boundary:\n${JSON.stringify(finalReport.paperTopicReview.recommendedBoundary || {}, null, 2)}`,
    ].filter(Boolean).join("\n\n") : "";

    const blueprintBlock = finalReport?.paperWritingBlueprint ? [
      "## Auto Research paper writing blueprint - hard guidance for one-click writing",
      `Paper type: ${finalReport.paperWritingBlueprint.paperType || ""}`,
      `Recommended title: ${finalReport.paperWritingBlueprint.recommendedTitle || ""}`,
      `Core research object: ${finalReport.paperWritingBlueprint.coreResearchObject || ""}`,
      `Central argument: ${finalReport.paperWritingBlueprint.centralArgument || ""}`,
      Array.isArray(finalReport.paperWritingBlueprint.coreScientificQuestions) && finalReport.paperWritingBlueprint.coreScientificQuestions.length
        ? `Core scientific questions:\n${finalReport.paperWritingBlueprint.coreScientificQuestions.slice(0, 8).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(finalReport.paperWritingBlueprint.supportedClaims) && finalReport.paperWritingBlueprint.supportedClaims.length
        ? `Supported claims:\n${finalReport.paperWritingBlueprint.supportedClaims.slice(0, 10).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(finalReport.paperWritingBlueprint.claimsToAvoid) && finalReport.paperWritingBlueprint.claimsToAvoid.length
        ? `Claims to avoid:\n${finalReport.paperWritingBlueprint.claimsToAvoid.slice(0, 12).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      `Evidence hierarchy:\n${JSON.stringify(finalReport.paperWritingBlueprint.evidenceHierarchy || {}, null, 2)}`,
      Array.isArray(finalReport.paperWritingBlueprint.requiredFiguresTables) && finalReport.paperWritingBlueprint.requiredFiguresTables.length
        ? `Required figures and tables:\n${finalReport.paperWritingBlueprint.requiredFiguresTables.slice(0, 8).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(finalReport.paperWritingBlueprint.writingWarnings) && finalReport.paperWritingBlueprint.writingWarnings.length
        ? `Writing warnings:\n${finalReport.paperWritingBlueprint.writingWarnings.slice(0, 8).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n") : "";

    const contentEnhancementBlock = contentEnhancement ? [
      "## Auto Research content synthesis and argument enhancement - hard guidance for one-click writing",
      `Decision: ${contentEnhancement.goNoGoDecision?.decision || ""}`,
      `Decision reason: ${contentEnhancement.goNoGoDecision?.reason || ""}`,
      contentEnhancement.paperPositionDiagnosis
        ? `Paper position diagnosis: ${JSON.stringify(contentEnhancement.paperPositionDiagnosis, null, 2)}`
        : "",
      Array.isArray(contentEnhancement.mainContentProblems) && contentEnhancement.mainContentProblems.length
        ? `Main content problems:\n${contentEnhancement.mainContentProblems.slice(0, 8).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(contentEnhancement.positiveFindings) && contentEnhancement.positiveFindings.length
        ? `Positive findings to emphasize:\n${contentEnhancement.positiveFindings.slice(0, 8).map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
      Array.isArray(contentEnhancement.coreEvidenceDependencyCheck) && contentEnhancement.coreEvidenceDependencyCheck.length
        ? `Core evidence dependency check:\n${JSON.stringify(contentEnhancement.coreEvidenceDependencyCheck.slice(0, 8), null, 2)}`
        : "",
      Array.isArray(contentEnhancement.evidenceMatrix) && contentEnhancement.evidenceMatrix.length
        ? `Evidence Matrix rows:\n${JSON.stringify(contentEnhancement.evidenceMatrix.slice(0, 12), null, 2)}`
        : "",
      Array.isArray(contentEnhancement.variableMechanismOutcomeMatrix) && contentEnhancement.variableMechanismOutcomeMatrix.length
        ? `Variable-Mechanism-Outcome Matrix rows:\n${JSON.stringify(contentEnhancement.variableMechanismOutcomeMatrix.slice(0, 10), null, 2)}`
        : "",
      Array.isArray(contentEnhancement.quantitativeResultSummary) && contentEnhancement.quantitativeResultSummary.length
        ? `Quantitative Result Summary rows:\n${JSON.stringify(contentEnhancement.quantitativeResultSummary.slice(0, 10), null, 2)}`
        : "Quantitative Result Summary: NR unless the retrieved evidence explicitly reports numbers.",
      Array.isArray(contentEnhancement.indicatorBoundaryCheck) && contentEnhancement.indicatorBoundaryCheck.length
        ? `Indicator Boundary Check:\n${JSON.stringify(contentEnhancement.indicatorBoundaryCheck.slice(0, 8), null, 2)}`
        : "",
      contentEnhancement.innovationFramework
        ? `Innovation Framework:\n${JSON.stringify(contentEnhancement.innovationFramework, null, 2)}`
        : "",
      contentEnhancement.proposedConceptualFigure
        ? `Proposed Conceptual Figure:\n${contentEnhancement.proposedConceptualFigure.caption || ""}\n${contentEnhancement.proposedConceptualFigure.mermaid || ""}`
        : "",
      Array.isArray(contentEnhancement.evidenceStrengthHeatmap) && contentEnhancement.evidenceStrengthHeatmap.length
        ? `Evidence Strength Heatmap:\n${JSON.stringify(contentEnhancement.evidenceStrengthHeatmap.slice(0, 10), null, 2)}`
        : "",
      contentEnhancement.finalWritingBlueprint
        ? `Final content-enhanced writing blueprint:\n${JSON.stringify(contentEnhancement.finalWritingBlueprint, null, 2)}`
        : "",
      Array.isArray(contentEnhancement.qualityChecklist) && contentEnhancement.qualityChecklist.length
        ? `Content enhancement quality checklist:\n${JSON.stringify(contentEnhancement.qualityChecklist, null, 2)}`
        : "",
      Array.isArray(contentEnhancement.goNoGoDecision?.requiredActionsBeforeWriting) && contentEnhancement.goNoGoDecision.requiredActionsBeforeWriting.length
        ? `Required actions before writing:\n${contentEnhancement.goNoGoDecision.requiredActionsBeforeWriting.map((item: string, index: number) => `${index + 1}. ${item}`).join("\n")}`
        : "",
    ].filter(Boolean).join("\n\n") : "";

    const finalReportBlock = finalReport ? [
      `## Latest Auto Research final report`,
      `Title: ${finalReport.title || ""}`,
      `Generated at: ${finalReport.generatedAt || ""}`,
      `Executive summary: ${finalReport.executiveSummary || ""}`,
      topicReviewBlock,
      blueprintBlock,
      contentEnhancementBlock,
      finalReport.literatureOverview?.length ? `Literature overview:\n${finalReport.literatureOverview.slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      finalReport.evidenceSynthesis?.length ? `Evidence synthesis:\n${finalReport.evidenceSynthesis.slice(0, 10).map((item, index) => `${index + 1}. ${item.claim} | support=${item.supportCount}, neutral=${item.neutralCount}, oppose=${item.opposeCount}. ${item.summary}`).join("\n")}` : "",
      finalReport.hypotheses?.length ? `Hypotheses:\n${finalReport.hypotheses.slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      finalReport.knowledgeGaps?.length ? `Knowledge gaps:\n${finalReport.knowledgeGaps.slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join("\n")}` : "",
      finalReport.reviewSummary ? `Review summary: ${finalReport.reviewSummary}` : "",
    ].filter(Boolean).join("\n\n") : "";

    const wikiBlock = wiki.queryPack
      ? `## Auto Research Wiki query pack\n${wiki.queryPack}`
      : Array.isArray(wiki.nodes) && wiki.nodes.length
        ? `## Auto Research Wiki summary\nNodes: ${wiki.nodes.length}; edges: ${Array.isArray(wiki.edges) ? wiki.edges.length : 0}\n${wiki.nodes.slice(0, 30).map((node: any, index: number) => `${index + 1}. [${node.type || "node"}] ${node.title || ""} - ${node.summary || ""}`).join("\n")}`
        : "";

    const auditBlock = audit ? [
      "## Auto Research citation and claim audit",
      `Verdict: ${String(audit.verdict || "").toUpperCase()}; score=${Math.round(Number(audit.overallScore || 0) * 100)}`,
      audit.summary || "",
      Array.isArray(audit.findings) && audit.findings.length
        ? audit.findings.slice(0, 10).map((finding: any, index: number) => `${index + 1}. [${finding.level || ""}/${finding.category || ""}] ${finding.message || ""} - ${finding.detail || ""}`).join("\n")
        : "",
    ].filter(Boolean).join("\n\n") : "";

    const draftBlock = draft?.markdown
      ? `## Auto Research generated paper draft preview\n${compactReviewWriterArsText(draft.editedMarkdown || draft.markdown, 6000)}`
      : "";

    const evidenceBlock = evidenceObjects.length ? [
      "## Auto Research traceable evidence objects",
      evidenceObjects.slice(0, 24).map((item: any, index: number) => {
        const refs = Array.isArray(item.references)
          ? item.references.map((ref: any) => ref.doi || ref.title || ref.raw || ref.id).filter(Boolean).slice(0, 3).join("; ")
          : "";
        return `${index + 1}. ${item.claim || ""} | stance=${item.stance || ""} | source=${item.sourcePdfTitle || item.sourcePdfName || ""}${refs ? ` | refs=${refs}` : ""}\n${cleanReviewMultilineText(item.evidenceText || item.viewpointSummary || "", "", 700)}`;
      }).join("\n\n"),
    ].join("\n\n") : "";

    return cleanReviewMultilineText([
      "## Auto Research upstream context",
      "The user enabled Auto Research context for this one-click writing task. Use all Auto Research results as upstream structure, synthesis, gap analysis, evidence risk audit, paper topic review, paper writing blueprint, and draft scaffolding. Do not invent facts beyond this context and the retrieved literature evidence. Use retrieved evidence for formal citations; use Auto Research audit findings and the writing blueprint to keep claims cautious and traceable.",
      `## Required integration rule\n${AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING}`,
      `Task: ${state.task?.title || ""}`,
      `Topic: ${state.task?.topic || state.task?.goal || ""}`,
      `Counts: literature=${literatureNodes.length}, evidence=${evidenceObjects.length}, wikiNodes=${Array.isArray(wiki.nodes) ? wiki.nodes.length : 0}, wikiEdges=${Array.isArray(wiki.edges) ? wiki.edges.length : 0}`,
      finalReportBlock,
      wikiBlock,
      auditBlock,
      evidenceBlock,
      draftBlock,
    ].filter(Boolean).join("\n\n"), "", 26000);
  } catch (error) {
    logger.warn("[ReviewWriter] Failed to load AutoResearch context:", error);
    return "";
  }
}

function parseReviewJsonObject(content: string): any | null {
  const cleaned = content
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const direct = cleaned.startsWith("{") ? cleaned : "";
  const candidates = [direct, (cleaned.match(/\{[\s\S]*\}/) || [])[0]]
    .filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue to the next candidate.
    }
  }
  return null;
}

function normalizeReviewKeywordList(value: unknown, fallback: string[]): string[] {
  const items = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(/[;,，、]/) : fallback);
  const normalized = items
    .map((item) => cleanReviewText(item))
    .filter(Boolean)
    .slice(0, 8);
  return normalized.length > 0 ? normalized : fallback.slice(0, 5);
}

function clampReviewTargetWords(value: unknown, fallback: number): number {
  return clampReviewInteger(value, fallback, 20, 90);
}

function inferReviewSkillName(title: string, index: number, total: number, profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")): string {
  const normalizedTitle = title.toLowerCase();
  for (const section of profile.sections) {
    const id = section.id.toLowerCase();
    const profileTitle = section.title.toLowerCase();
    if (normalizedTitle.includes(id) || normalizedTitle.includes(profileTitle)) {
      return section.id;
    }
  }
  if (profile.id !== "paper-writing") {
    return profile.sections[Math.min(index, profile.sections.length - 1)]?.id || profile.sections[0]?.id || "discussion";
  }
  const lower = title.toLowerCase();
  if (index === 0 || /introduction|background|概述|引言|背景/.test(lower)) return "introduction";
  if (index === total - 1 || /conclusion|future|perspective|summary|结论|展望|总结/.test(lower)) return "conclusion";
  if (/method|approach|framework|方法/.test(lower)) return "methods";
  if (/result|evidence|finding|effect|结果|发现|证据/.test(lower)) return "results";
  return "discussion";
}

function getReviewStructureFallback(wordCount: number): {
  sectionCount: number;
  paragraphsPerSection: number;
  sentencesPerParagraph: number;
  maxSections: number;
  maxParagraphsPerSection: number;
  maxSentencesPerParagraph: number;
  maxTotalSentences: number;
} {
  const estimatedSentences = clampReviewInteger(Math.round(wordCount / 45), 12, 12, 90);
  const sectionCount = clampReviewInteger(Math.round(estimatedSentences / 14), 4, 3, 7);
  const paragraphsPerSection = clampReviewInteger(Math.ceil(estimatedSentences / sectionCount / 4), 2, 2, 5);
  const sentencesPerParagraph = clampReviewInteger(
    Math.ceil(estimatedSentences / sectionCount / paragraphsPerSection),
    3,
    2,
    6
  );
  return {
    sectionCount,
    paragraphsPerSection,
    sentencesPerParagraph,
    maxSections: 8,
    maxParagraphsPerSection: 6,
    maxSentencesPerParagraph: 8,
    maxTotalSentences: 96,
  };
}

function countReviewSentences(outline: ReviewWriterOutline): number {
  return outline.sections.reduce((sectionSum, section) =>
    sectionSum + section.paragraphs.reduce((paragraphSum, paragraph) =>
      paragraphSum + paragraph.sentences.length, 0
    ), 0);
}

function trimReviewOutlineToSentenceCap(outline: ReviewWriterOutline, maxTotalSentences: number): ReviewWriterOutline {
  let seen = 0;
  for (const section of outline.sections) {
    for (const paragraph of section.paragraphs) {
      if (seen >= maxTotalSentences) {
        paragraph.sentences = [];
        continue;
      }
      const available = maxTotalSentences - seen;
      paragraph.sentences = paragraph.sentences.slice(0, available);
      seen += paragraph.sentences.length;
    }
    section.paragraphs = section.paragraphs.filter((paragraph) => paragraph.sentences.length > 0);
  }
  outline.sections = outline.sections.filter((section) => section.paragraphs.length > 0);
  return outline;
}

function normalizeReviewOutline(
  raw: any,
  topic: string,
  wordCount: number,
  profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")
): ReviewWriterOutline {
  const structure = getReviewStructureFallback(wordCount);
  const fallback = buildFallbackReviewOutline(
    topic,
    structure.sectionCount,
    structure.paragraphsPerSection,
    structure.sentencesPerParagraph,
    wordCount,
    profile
  );
  if (!raw || typeof raw !== "object") return fallback;

  const rawSections = Array.isArray(raw.sections) ? raw.sections : [];
  const sections = rawSections.slice(0, structure.maxSections).map((section: any, sectionIndex: number) => {
    const sectionTitle = cleanReviewTitle(section?.title, fallback.sections[sectionIndex]?.title || `Section ${sectionIndex + 1}`);
    const rawParagraphs = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
    const paragraphs = rawParagraphs.slice(0, structure.maxParagraphsPerSection).map((paragraph: any, paragraphIndex: number) => {
      const paragraphTitle = cleanReviewTitle(paragraph?.title, `Paragraph ${paragraphIndex + 1}`);
      const rawSentences = Array.isArray(paragraph?.sentences) ? paragraph.sentences : [];
      const sentences = rawSentences.slice(0, structure.maxSentencesPerParagraph).map((sentence: any, sentenceIndex: number) => {
        const plannedContent = cleanReviewText(
          sentence?.plannedContent || sentence?.content || sentence?.claim,
          `${topic} related evidence for ${sectionTitle}`
        );
        const purpose = cleanReviewText(sentence?.purpose, plannedContent);
        return {
          id: `s${sectionIndex + 1}-${paragraphIndex + 1}-${sentenceIndex + 1}`,
          purpose,
          plannedContent,
          searchKeywords: normalizeReviewKeywordList(
            sentence?.searchKeywords || sentence?.keywords || sentence?.queries,
            [topic, sectionTitle, plannedContent]
          ),
          targetWords: clampReviewTargetWords(sentence?.targetWords || sentence?.wordCount, 45),
        };
      });
      const finalSentences = sentences.length > 0
        ? sentences
        : fallback.sections[sectionIndex]?.paragraphs[paragraphIndex]?.sentences || [];

      return {
        id: `p${sectionIndex + 1}-${paragraphIndex + 1}`,
        title: paragraphTitle,
        purpose: cleanReviewText(paragraph?.purpose, paragraphTitle),
        targetWords: clampReviewInteger(paragraph?.targetWords || paragraph?.wordCount, 0, 0, wordCount),
        sentences: finalSentences.length > 0 ? finalSentences : fallback.sections[sectionIndex]?.paragraphs[paragraphIndex]?.sentences || [],
      };
    });
    const finalParagraphs = paragraphs.length > 0
      ? paragraphs
      : fallback.sections[sectionIndex]?.paragraphs || [];
    const inferredSkillName = inferReviewSkillName(sectionTitle, sectionIndex, rawSections.length || structure.sectionCount, profile);
    const rawSkillName = cleanReviewText(section?.skillName, inferredSkillName).toLowerCase();
    const validSkillNames = new Set([
      "introduction",
      "methods",
      "results",
      "discussion",
      "conclusion",
      ...profile.sections.map((item) => item.id),
    ]);

    return {
      id: `section-${sectionIndex + 1}`,
      title: sectionTitle,
      skillName: validSkillNames.has(rawSkillName) ? rawSkillName : inferredSkillName,
      targetWords: clampReviewInteger(section?.targetWords || section?.wordCount, 0, 0, wordCount),
      paragraphs: finalParagraphs.length > 0 ? finalParagraphs : fallback.sections[sectionIndex]?.paragraphs || [],
    };
  }).filter((section: ReviewWriterSectionPlan) => section.paragraphs.length > 0);

  return trimReviewOutlineToSentenceCap({
    title: cleanReviewTitle(raw.title, fallback.title),
    topic,
    sections: sections.length > 0 ? sections : fallback.sections,
  }, structure.maxTotalSentences);
}

function buildFallbackReviewOutline(
  topic: string,
  sectionCount: number,
  paragraphsPerSection: number,
  sentencesPerParagraph: number,
  wordCount: number,
  profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")
): ReviewWriterOutline {
  const baseTitles = profile.sections.length > 0
    ? profile.sections.map((section) => section.title)
    : [
        `Overview of ${topic}`,
        `Core mechanisms and evidence on ${topic}`,
        `Current debates and limitations in ${topic}`,
        `Future directions for ${topic}`,
      ];

  const sections: ReviewWriterSectionPlan[] = [];
  const totalSentences = Math.max(1, sectionCount * paragraphsPerSection * sentencesPerParagraph);
  const targetWordsPerSentence = clampReviewTargetWords(Math.round(wordCount / totalSentences), 45);
  for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex++) {
    const title = baseTitles[sectionIndex] || `Section ${sectionIndex + 1} on ${topic}`;
    const sectionPurpose = profile.sections[sectionIndex]?.purpose || `Develop ${title}`;
    const paragraphs: ReviewWriterParagraphPlan[] = [];
    for (let paragraphIndex = 0; paragraphIndex < paragraphsPerSection; paragraphIndex++) {
      const sentences: ReviewWriterSentencePlan[] = [];
      for (let sentenceIndex = 0; sentenceIndex < sentencesPerParagraph; sentenceIndex++) {
        const plannedContent = `${title}: ${sectionPurpose}; evidence point ${sentenceIndex + 1} for ${topic}`;
        sentences.push({
          id: `s${sectionIndex + 1}-${paragraphIndex + 1}-${sentenceIndex + 1}`,
          purpose: plannedContent,
          plannedContent,
          searchKeywords: [topic, title, `evidence point ${sentenceIndex + 1}`],
          targetWords: targetWordsPerSentence,
        });
      }
      paragraphs.push({
        id: `p${sectionIndex + 1}-${paragraphIndex + 1}`,
        title: `Paragraph ${paragraphIndex + 1}`,
        purpose: `Develop ${title}`,
        targetWords: targetWordsPerSentence * sentencesPerParagraph,
        sentences,
      });
    }
    sections.push({
      id: `section-${sectionIndex + 1}`,
      title,
      skillName: inferReviewSkillName(title, sectionIndex, sectionCount, profile),
      targetWords: Math.round(wordCount / sectionCount),
      paragraphs,
    });
  }

  return {
    title: `${profile.shortLabel}: ${topic}`,
    topic,
    sections,
  };
}

async function generateReviewOutline(
  topic: string,
  config: ReviewWriterLlmConfig,
  wordCount: number,
  language: string,
  librarySources: ReviewWriterLibrarySource[],
  useCodexCli: boolean,
  userRequirements = "",
  longTermMemoryContext = "",
  profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")
): Promise<ReviewWriterOutline> {
  const structure = getReviewStructureFallback(wordCount);
  const scopedSupplementalContext = buildReviewScopedSupplementalContext(
    longTermMemoryContext,
    getReviewContextCharBudget("outline"),
    [topic, userRequirements]
  );
  const qualityGatePrompt = [
    await getReviewWriterCloudPrompt('review_writer_quality_gate', REVIEW_WRITER_QUALITY_GATE_PROMPT),
    REFERENCE_RELEVANCE_WRITING_RULES,
  ].join("\n\n");
  const messages = [
    {
      role: "system" as const,
      content: `You are an expert ${profile.documentType} planner. Return valid JSON only, with no markdown fences or explanations.

${qualityGatePrompt}`,
    },
    {
      role: "user" as const,
      content: `Project type: ${profile.label}
Document type: ${profile.documentType}
Topic: ${topic}
Writing language: ${language === "zh" ? "Chinese" : "English"}
Target length: about ${wordCount} ${language === "zh" ? "Chinese characters" : "English words"}
Selected literature libraries: ${formatReviewLibrarySourcesForUser(librarySources)}
Retrieval focus: ${profile.retrievalFocus}
Profile outline rule: ${profile.outlineInstruction}
Profile quality rule: ${profile.qualityInstruction}
Recommended section templates:
${profile.sections.map((section, index) => `${index + 1}. ${section.title} (${section.id}): ${section.purpose}`).join("\n")}
${userRequirements ? `
User requirements:
${userRequirements}
` : ""}
${scopedSupplementalContext ? `
${scopedSupplementalContext}
` : ""}

Create a ${profile.documentType} outline. You decide how many sections, paragraphs, and sentence plans are needed for the target length, topic complexity, profile template, and user requirements.

Before planning, apply the quality gate internally:
- lock the topic scope in one sentence;
- ensure the project-type-specific acceptance criteria, evidence boundary, key concepts, deliverable structure, and user requirements are represented in the outline;
- avoid plans that would create literature listing paragraphs;
- ensure every sentence plan can be supported by provided materials, retrieval evidence, or clearly marked user-supplied assumptions.

Hard limits:
- sections: 3-${structure.maxSections}
- paragraphs per section: 1-${structure.maxParagraphsPerSection}
- sentence plans per paragraph: 2-${structure.maxSentencesPerParagraph}
- total sentence plans: no more than ${structure.maxTotalSentences}

For every sentence plan, provide:
- purpose: what this sentence contributes to the paragraph argument
- plannedContent: the specific claim or synthesis the sentence should write
- searchKeywords: 4-8 concise English retrieval keywords or phrases suitable for the selected literature libraries
- targetWords: the approximate length of this sentence, usually 25-60 English words or equivalent Chinese characters

For every section and paragraph, provide targetWords too. Make the sum approximately match the target length.

Return this JSON shape exactly:
{
  "title": "review title",
  "sections": [
    {
      "title": "section title",
              "skillName": "${profile.sections.map((section) => section.id).join("|") || "introduction|methods|results|discussion|conclusion"}",
      "targetWords": 800,
      "paragraphs": [
        {
          "title": "paragraph title",
          "purpose": "paragraph purpose",
          "targetWords": 250,
          "sentences": [
            {
              "purpose": "sentence purpose",
              "plannedContent": "specific sentence content plan",
              "searchKeywords": ["keyword phrase"],
              "targetWords": 40
            }
          ]
        }
      ]
    }
  ]
}`,
    },
  ];

  const promptSize = getReviewMessagesSize(messages);
  logger.info(`[ReviewWriter] Outline prompt size: ${promptSize.chars} chars, ~${promptSize.estimatedTokens} tokens, supplemental=${longTermMemoryContext.length}->${scopedSupplementalContext.length} chars`);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await callReviewWriterLlm({
        label: "Paper Writer outline",
        config,
        messages,
        temperature: attempt === 1 ? 0.2 : 0.1,
        maxTokens: getReviewOutputTokenBudget("outline"),
        useCodexCli,
      });

      return normalizeReviewOutline(
        parseReviewJsonObject(response),
        topic,
        wordCount,
        profile
      );
    } catch (error) {
      lastError = error;
      if (!isReviewEmptyResponseError(error) || attempt === 2) break;
      logger.warn("[ReviewWriter] Empty outline response, retrying once:", error);
    }
  }

  const lastMessage = (lastError as Error)?.message || String(lastError || "unknown error");
  throw new Error(
    "Paper Writer outline API returned empty response after retry. " +
    "这通常表示模型/API 没有生成 message.content；常见原因是模型上下文不足、API 偶发空返回、或服务商返回格式异常。 " +
    `Last error: ${lastMessage}`
  );
}

function getReviewSkillFile(skillName: string): string {
  const key = skillName.toLowerCase();
  const map: Record<string, string> = {
    title: "01_title_skill.md",
    abstract: "02_abstract_skill.md",
    introduction: "03_introduction_skill.md",
    methods: "04_methods_skill.md",
    results: "05_results_skill.md",
    figures: "06_figures_tables_skill.md",
    discussion: "07_discussion_skill.md",
    conclusion: "08_conclusion_skill.md",
    additional: "09_additional_statements_skill.md",
    "reference-relevance": "10_reference_relevance_constraint_skill.md",
  };
  return map[key] || map.discussion;
}

function loadReviewWritingSkill(skillName: string, profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")): string {
  if (profile.id !== "paper-writing") {
    const section = profile.sections.find((item) => item.id === skillName);
    return [
      `# ${profile.label} Skill`,
      `文稿类型：${profile.documentType}`,
      `当前章节：${section?.title || skillName}`,
      section?.purpose ? `章节目的：${section.purpose}` : "",
      `检索/材料重点：${profile.retrievalFocus}`,
      `结构规则：${profile.outlineInstruction}`,
      `质量规则：${profile.qualityInstruction}`,
      profile.skillGuide,
      "写作要求：保持项目架构不变，仍按逐句检索、证据筛选、章节审查、终稿审查执行；但正文结构、语气、验收标准必须服从当前项目主题。",
    ].filter(Boolean).join("\n\n").slice(0, 7000);
  }
  const skillPath = path.join(skillDir, getReviewSkillFile(skillName));
  try {
    if (fs.existsSync(skillPath)) {
      return fs.readFileSync(skillPath, "utf-8").slice(0, 7000);
    }
  } catch (error) {
    logger.warn("[ReviewWriter] Failed to load writing skill:", error);
  }
  return "";
}

async function loadReviewWritingSkillCloudFirst(
  skillName: string,
  profile: ProjectWritingProfile = getProjectWritingProfile("paper-writing")
): Promise<string> {
  const localSkill = loadReviewWritingSkill(skillName, profile);
  if (process.env.CLOUD_PROMPTS_DISABLED === '1' || profile.id !== "paper-writing") {
    return localSkill;
  }
  const skillId = getReviewSkillFile(skillName).replace(/\.md$/i, "");
  try {
    const prompt = await cloudPromptClient.getSkill(skillId);
    logger.info(`[ReviewWriter] Loaded cloud writing skill ${skillId} v${prompt.version}`);
    if (skillId === "07_discussion_skill" && localSkill) {
      return [
        prompt.content.slice(0, 7000),
        "## Local Discussion Auto Research Supplement",
        localSkill,
      ].filter(Boolean).join("\n\n").slice(0, 12000);
    }
    return prompt.content.slice(0, 12000) || localSkill;
  } catch (error) {
    logger.warn(`[ReviewWriter] Cloud writing skill ${skillId} unavailable, using local fallback`, error);
    return localSkill;
  }
}

function loadReviewJournalStyleGuide(sectionName: string, userId = "web-user", selectedStyleIds: string[] = []): string {
  try {
    const availableStyles = listJournalStyleEntries(userId);
    if (availableStyles.length === 0) return "";

    const selectedIdSet = new Set(selectedStyleIds);
    let selectedStyles = selectedStyleIds.length > 0
      ? availableStyles.filter((item) => selectedIdSet.has(item.id))
      : availableStyles.slice(0, 1);
    if (selectedStyles.length === 0) {
      selectedStyles = availableStyles.slice(0, 1);
    }
    if (selectedStyles.length === 0) return "";

    const totalLimit = 12000;
    const perGuideLimit = Math.max(2500, Math.floor(totalLimit / Math.max(1, selectedStyles.length)));
    const guides: string[] = [];
    for (const item of selectedStyles) {
      try {
        const rawContent = fs.readFileSync(item.path, "utf-8");
        const styles = JSON.parse(rawContent) as any[];
        guides.push(`Target journal style source: ${item.name}

${generateSectionStyleGuide(sectionName, styles, rawContent).slice(0, perGuideLimit)}`);
      } catch (error) {
        logger.warn("[ReviewWriter] Failed to load selected journal style:", item.id, error);
      }
    }
    return guides.join("\n\n---\n\n").slice(0, totalLimit);
  } catch (error) {
    logger.warn("[ReviewWriter] Failed to load journal style guide:", error);
    return "";
  }
}

function buildReviewSearchQueries(sentence: ReviewWriterSentencePlan, topic: string): RetrievalQueryVariant[] {
  const keywords = normalizeReviewKeywordList(sentence.searchKeywords, [topic, sentence.plannedContent]);
  const englishKeywords = keywords.filter(keyword => /[A-Za-z]/.test(keyword));
  const chineseKeywords = keywords.filter(keyword => /[\u4e00-\u9fff]/.test(keyword));
  const variants = buildBilingualRetrievalQueries({
    sentence: [sentence.purpose, sentence.plannedContent].filter(Boolean).join(" "),
    topic,
    keywordsEn: englishKeywords.length ? englishKeywords : keywords,
    keywordsCn: chineseKeywords,
  });
  if (variants.length > 0) return variants;
  const fallback = [...new Set([...keywords, topic])]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
  return fallback ? [{ language: "en", label: "英文检索", query: fallback }] : [];
}

function buildReviewCitation(authors: string, year: string): string {
  const cleanedAuthors = cleanReviewText(authors, "Unknown");
  const firstAuthor = cleanedAuthors.split(/[,;，；]|\band\b/)[0]?.trim() || "Unknown";
  const surname = firstAuthor.split(/\s+/).filter(Boolean).pop() || firstAuthor;
  const suffix = /[,;，；]|\band\b|et al/i.test(cleanedAuthors) ? " et al." : "";
  return `(${surname}${suffix}, ${year || "n.d."})`;
}

function buildReviewEvidenceTraceCode(seed: string): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const digest = crypto.createHash("sha1").update(seed || "review-evidence").digest();
  let code = "";
  for (let index = 0; index < 6; index++) {
    code += alphabet[digest[index] % alphabet.length];
  }
  return `证${code}`;
}

function splitReviewEvidenceTraceSentences(text: string, limit = 4): string[] {
  const clean = cleanReviewMultilineText(text, "", 3000);
  if (!clean) return [];
  const sentences = clean
    .split(/(?<=[.!?。！？])\s+|[；;]\s+/)
    .map(item => cleanReviewText(item).slice(0, 700))
    .filter(item => item.length >= 20);
  return (sentences.length ? sentences : [clean.slice(0, 700)]).slice(0, limit);
}

function buildReviewTraceSnippets(
  seedPrefix: string,
  source: ReviewWriterEvidenceTraceSnippet["source"],
  sourceLabel: string,
  snippets: string[]
): ReviewWriterEvidenceTraceSnippet[] {
  return snippets
    .map((snippet, index) => {
      const text = cleanReviewMultilineText(snippet, "", 900);
      if (!text) return null;
      return {
        code: buildReviewEvidenceTraceCode(`${seedPrefix}|${index}|${text}`),
        text,
        source,
        sourceLabel,
      };
    })
    .filter((item): item is ReviewWriterEvidenceTraceSnippet => Boolean(item));
}

function getPrimaryPdfWikiTraceSnippet(item: ReviewWriterEvidence): ReviewWriterEvidenceTraceSnippet | undefined {
  return (item.traceSnippets || []).find(snippet => snippet.source === "pdfWiki");
}

function formatPdfWikiSentenceCitationLabel(item: ReviewWriterEvidence): string {
  const snippet = getPrimaryPdfWikiTraceSnippet(item);
  return snippet ? `（句子${snippet.code}）` : item.citation;
}

function getReviewCitationAuthorLabel(authors: string): string {
  const cleanedAuthors = cleanReviewText(authors, "Unknown");
  const firstAuthor = cleanedAuthors.split(/[,;，；]|\band\b/)[0]?.trim() || "Unknown";
  const surname = firstAuthor.split(/\s+/).filter(Boolean).pop() || firstAuthor;
  const suffix = /[,;，；]|\band\b|et al/i.test(cleanedAuthors) ? " et al." : "";
  return `${surname}${suffix}`;
}

function getReviewEvidenceKey(item: ReviewWriterEvidence): string {
  return `${item.title.toLowerCase()}|${item.year}|${item.source}`;
}

function formatReviewInTextCitation(
  item: ReviewWriterEvidence,
  style: ReviewWriterCitationStyle,
  customCitationFormat: string,
  referenceNumber: number
): string {
  const author = getReviewCitationAuthorLabel(item.authors);
  const year = item.year || "n.d.";
  if (style === "numeric") return `[${referenceNumber}]`;
  if (style === "custom") {
    const custom = customCitationFormat.trim();
    if (/\{(?:n|number|ref|referenceNumber)\}/i.test(custom) || /\[1\]|编号|数字|numeric|上标|superscript/i.test(custom)) {
      return `[${referenceNumber}]`;
    }
    if (/\{author(?:s)?\}|\{year\}/i.test(custom)) {
      return custom
        .replace(/\{author(?:s)?\}/gi, author)
        .replace(/\{year\}/gi, year)
        .replace(/\{(?:n|number|ref|referenceNumber)\}/gi, String(referenceNumber));
    }
    if (/Zhang\s+et\s+al\.?,\s*2026|作者[,，]\s*年份|author\s*,\s*year/i.test(custom)) {
      return `${author}, ${year}`;
    }
    if (/Zhang\s+et\s+al\.?\s*\(2026\)|作者.*年份|author.*year/i.test(custom) && !/,\s*2026/.test(custom)) {
      return `${author} (${year})`;
    }
    if (/\(Zhang\s+et\s+al\.?\s+2026\)|\(author\s+year\)/i.test(custom)) {
      return `(${author} ${year})`;
    }
  }
  return `(${author}, ${year})`;
}

function assignReviewEvidenceCitations(
  evidence: ReviewWriterEvidence[],
  citationRegistry: Map<string, number>,
  style: ReviewWriterCitationStyle,
  customCitationFormat: string
): ReviewWriterEvidence[] {
  return evidence.map((item) => {
    const key = getReviewEvidenceKey(item);
    let number = citationRegistry.get(key);
    if (!number) {
      number = citationRegistry.size + 1;
      citationRegistry.set(key, number);
    }
    return {
      ...item,
      referenceNumber: number,
      citation: formatReviewInTextCitation(item, style, customCitationFormat, number),
    };
  });
}

function mapRetrievedDocumentToReviewEvidence(doc: any, source: "abstract" | "pdfWiki"): ReviewWriterEvidence {
  const authors = Array.isArray(doc.authors)
    ? doc.authors.map((author: any) => author?.name || String(author)).filter(Boolean).join(", ")
    : cleanReviewText(doc.author, "Unknown");
  const year = doc.year ? String(doc.year) : "n.d.";
  const title = cleanReviewText(doc.title, "Untitled");
  const abstract = cleanReviewText(doc.abstract, "").slice(0, 1600);
  const referenceRaw = Array.isArray(doc.references) && doc.references.length > 0
    ? cleanReviewMultilineText(doc.references[0], "", 1200)
    : "";
  return {
    id: `${source}:${doc.id || doc.title || Math.random().toString(36).slice(2)}`,
    source,
    title,
    authors,
    year,
    journal: cleanReviewText(doc.journal, source === "pdfWiki" ? "PDF Wiki" : ""),
    doi: cleanReviewText(doc.doi),
    abstract,
    score: Number(doc.combinedScore || doc.score || 0),
    citation: buildReviewCitation(authors, year),
    referenceRaw,
    traceSnippets: [],
  };
}

function mapPdfWikiEntryToReviewEvidence(doc: any, entry?: PdfWikiEntry): ReviewWriterEvidence {
  if (!entry) return mapRetrievedDocumentToReviewEvidence(doc, "pdfWiki");
  const firstReference = entry.references[0];
  const authors = cleanReviewText(firstReference?.authors, entry.sourcePdfNames.join(", ") || "PDF Wiki");
  const year = cleanReviewText(firstReference?.year, "n.d.");
  const title = cleanReviewText(entry.displayClaimZh || entry.normalizedClaim || entry.claim || firstReference?.title, "PDF Wiki evidence");
  const evidenceText = [
    `Claim: ${entry.displayClaimZh || entry.normalizedClaim || entry.claim}`,
    entry.pro.length > 0 ? `Support: ${entry.pro.map((view) => view.summary).join("; ")}` : "",
    entry.con.length > 0 ? `Counterpoints: ${entry.con.map((view) => view.summary).join("; ")}` : "",
    entry.neutral.length > 0 ? `Mechanisms: ${entry.neutral.map((view) => view.summary).join("; ")}` : "",
    entry.evidenceSnippets.length > 0 ? `Evidence snippets: ${entry.evidenceSnippets.slice(0, 4).join("; ")}` : "",
  ].filter(Boolean).join("\n");

  return {
    id: `pdfWiki:${entry.id}`,
    source: "pdfWiki",
    title,
    authors,
    year,
    journal: cleanReviewText(firstReference?.journal, "PDF Wiki"),
    doi: cleanReviewText(firstReference?.doi),
    abstract: evidenceText.slice(0, 1800),
    score: Number(doc.combinedScore || doc.score || 0),
    citation: buildReviewCitation(authors, year),
    referenceRaw: firstReference?.raw,
    traceSnippets: buildReviewTraceSnippets(
      `pdfWiki:${entry.id}`,
      "pdfWiki",
      entry.sourcePdfNames.join("; ") || firstReference?.title || "PDF Wiki",
      entry.evidenceSnippets.length > 0
        ? entry.evidenceSnippets.slice(0, 6)
        : [
            ...entry.pro.map((view) => view.summary),
            ...entry.con.map((view) => view.summary),
            ...entry.neutral.map((view) => view.summary),
          ].slice(0, 6)
    ),
  };
}

async function retrieveReviewAbstractEvidence(
  query: string,
  userId: string,
  topK: number
): Promise<ReviewWriterEvidence[]> {
  const engine = await retrievalEngineManager.getEngine(userId);
  if (engine.getDocumentCount() === 0) return [];
  const result = await engine.retrieve({
    query,
    topK,
    searchMode: "hybrid",
  });
  return result.results.map((doc) => mapRetrievedDocumentToReviewEvidence(doc, "abstract"));
}

async function retrieveReviewPdfWikiEvidence(
  query: string,
  userId: string,
  topK: number
): Promise<ReviewWriterEvidence[]> {
  const status = await pdfWikiManager.getStatus(userId);
  if (status.status !== "completed" || Math.max(Number(status.sentencePointCount || 0), Number(status.entryCount || 0)) === 0) return [];
  const engine = await pdfWikiManager.getEngine(userId, {
    apiUrl: currentEmbeddingConfig.enabled ? currentEmbeddingConfig.url : undefined,
    apiKey: currentEmbeddingConfig.enabled ? currentEmbeddingConfig.key : undefined,
    model: currentEmbeddingConfig.model,
    dimensions: currentEmbeddingConfig.dimensions,
  });
  const entryMap = await pdfWikiManager.getEntryMap(userId);
  const result = await engine.retrieve({
    query,
    topK,
    searchMode: "hybrid",
  });
  return result.results.map((doc) => mapPdfWikiEntryToReviewEvidence(doc, entryMap.get(doc.id)));
}

function deduplicateReviewEvidence(items: ReviewWriterEvidence[]): ReviewWriterEvidence[] {
  const seen = new Set<string>();
  const unique: ReviewWriterEvidence[] = [];
  for (const item of items) {
    const key = getReviewEvidenceKey(item);
    if (!item.title || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort((a, b) => b.score - a.score);
}

function deduplicateReviewEvidenceInUseOrder(items: ReviewWriterEvidence[]): ReviewWriterEvidence[] {
  const seen = new Set<string>();
  const unique: ReviewWriterEvidence[] = [];
  for (const item of items) {
    const key = getReviewEvidenceKey(item);
    if (!item.title || seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.sort((a, b) => (a.referenceNumber || 999999) - (b.referenceNumber || 999999));
}

function getReviewEvidenceSupportPriority(item: ReviewWriterEvidence): number {
  const relation = normalizeClaimEvidenceRelation(item.claimSupport?.relation);
  switch (relation) {
    case "supports":
      return 5;
    case "related":
      return 3;
    case "unchecked":
      return 2;
    case "contradicts":
      return 1;
    case "irrelevant":
      return 0;
    default:
      return 2;
  }
}

function rankReviewEvidenceByClaimSupport(items: ReviewWriterEvidence[]): ReviewWriterEvidence[] {
  return deduplicateReviewEvidence(items)
    .map((item) => ({
      ...item,
      originalScore: item.originalScore ?? item.score,
    }))
    .sort((a, b) => {
      const priorityDiff = getReviewEvidenceSupportPriority(b) - getReviewEvidenceSupportPriority(a);
      if (priorityDiff !== 0) return priorityDiff;
      const confidenceDiff = Number(b.claimSupport?.confidence || 0) - Number(a.claimSupport?.confidence || 0);
      if (confidenceDiff !== 0) return confidenceDiff;
      return Number(b.score || 0) - Number(a.score || 0);
    });
}

function selectReviewEvidenceForSentence(candidates: ReviewWriterEvidence[]): ReviewWriterEvidence[] {
  const ranked = applyClaimEvidenceQualityGate(rankReviewEvidenceByClaimSupport(candidates)) as ReviewWriterEvidence[];
  const visible = ranked
    .filter((item) => {
      const relation = normalizeClaimEvidenceRelation(item.claimSupport?.relation);
      return relation !== "contradicts" && relation !== "irrelevant" && item.qualityGate?.passed !== false;
    });
  if (visible.length <= 3) return visible;

  const topScore = Number.isFinite(visible[0]?.score) ? visible[0].score : 0;
  const selected = visible.slice(0, 3).filter((item, index) => {
    if (index === 0) return true;
    if (topScore <= 0) return false;
    return item.score >= topScore * 0.65;
  });

  return (selected.length > 0 ? selected : visible.slice(0, 1)).slice(0, 3);
}

async function judgeReviewWriterEvidenceForClaim(
  claimText: string,
  candidates: ReviewWriterEvidence[],
  config?: ReviewWriterLlmConfig
): Promise<ReviewWriterEvidence[]> {
  const cleanClaim = cleanReviewMultilineText(claimText, "", 1600);
  if (!cleanClaim || candidates.length === 0) return candidates;
  const candidateLimit = Math.min(30, Math.max(10, candidates.length));
  const judged = await judgeClaimEvidenceForRetrievedReferences(
    cleanClaim,
    candidates.slice(0, candidateLimit),
    config
      ? {
          apiUrl: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
          label: "Paper Writer evidence support",
        }
      : undefined
  ) as ReviewWriterEvidence[];
  return rankReviewEvidenceByClaimSupport(judged);
}

function normalizeReviewRetrievalQueryVariants(query: string | RetrievalQueryVariant[]): RetrievalQueryVariant[] {
  if (Array.isArray(query)) return query.filter(item => item.query.trim());
  const variants = buildBilingualRetrievalQueries({ sentence: query, keywordsEn: [query] });
  return variants.length > 0 ? variants : [{ language: "en", label: "英文检索", query }];
}

async function retrieveReviewEvidence(
  query: string | RetrievalQueryVariant[],
  userId: string,
  topK: number,
  librarySources: ReviewWriterLibrarySource[],
  claimText = "",
  config?: ReviewWriterLlmConfig
): Promise<{ evidence: ReviewWriterEvidence[]; warnings: string[] }> {
  const warnings: string[] = [];
  const selectedSources: ReviewWriterLibrarySource[] = librarySources.length > 0 ? librarySources : ["abstract", "pdfWiki"];
  const queryVariants = normalizeReviewRetrievalQueryVariants(query);
  const retrievalTasks = selectedSources.flatMap(source => queryVariants.map(async (variant) => ({
    source,
    variant,
    evidence: source === "pdfWiki"
      ? await retrieveReviewPdfWikiEvidence(variant.query, userId, topK)
      : await retrieveReviewAbstractEvidence(variant.query, userId, topK),
  })));
  const settled = await Promise.allSettled(retrievalTasks);

  const evidenceBuckets: ReviewWriterEvidence[][] = [];

  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      evidenceBuckets.push(result.value.evidence);
      return;
    }
    const taskIndex = Math.floor(index / Math.max(1, queryVariants.length));
    const variantIndex = index % Math.max(1, queryVariants.length);
    const source = selectedSources[taskIndex] || "abstract";
    const variant = queryVariants[variantIndex];
    const label = source === "pdfWiki" ? "PDF Wiki retrieval" : "Embedding retrieval";
    warnings.push(`${label} ${variant?.label || ""} failed: ${result.reason?.message || result.reason}`);
  });

  const interleaved: ReviewWriterEvidence[] = [];
  for (let i = 0; i < topK; i++) {
    for (const bucket of evidenceBuckets) {
      const item = bucket[i];
      if (item) interleaved.push(item);
    }
  }

  const merged = deduplicateReviewEvidence(interleaved);
  const judged = claimText
    ? await judgeReviewWriterEvidenceForClaim(claimText, merged, config)
    : merged;

  return {
    evidence: rankReviewEvidenceByClaimSupport(judged).slice(0, topK),
    warnings,
  };
}

function formatReviewEvidenceForPrompt(evidence: ReviewWriterEvidence[]): string {
  if (evidence.length === 0) return "No evidence was retrieved for this sentence.";
  return evidence.map((item, index) => {
    const sourceLabel = item.source === "pdfWiki" ? "PDF Wiki" : "Embedding abstract library";
    const evidenceId = `R${item.referenceNumber || index + 1}`;
    const citationLabel = item.source === "pdfWiki" ? formatPdfWikiSentenceCitationLabel(item) : item.citation;
    const formalCitationLabel = item.source === "pdfWiki" && citationLabel !== item.citation
      ? `\nFormal source citation: ${item.citation}`
      : "";
    const support = item.claimSupport || buildUncheckedClaimEvidenceJudgment("未执行证据支持判断。");
    const traceLines = (item.traceSnippets || []).slice(0, 5)
      .map(snippet => `- ${snippet.code}: ${snippet.text}`)
      .join("\n");
    const supportSnippets = (support.evidenceSnippets || []).slice(0, 3)
      .map(snippet => `- ${snippet}`)
      .join("\n");
return `[${index + 1}] Source: ${sourceLabel}
Evidence ID: ${evidenceId}
Citation: ${citationLabel}${formalCitationLabel}
Evidence relation to planned sentence: ${support.relation} (confidence ${Math.round((support.confidence || 0) * 100)}%)
Evidence relation reason: ${support.reason || "NR"}
Evidence relation snippets:
${supportSnippets || "- NR"}
Title: ${item.title}
Authors: ${item.authors}
Year: ${item.year}
Journal: ${item.journal || "Unknown"}
DOI: ${item.doi || "N/A"}
Traceable evidence sentences:
${traceLines || "- NR: no sentence-level trace snippet available"}
Evidence: ${item.abstract}`;
  }).join("\n\n");
}

function formatReviewEvidenceForAudit(
  references: ReviewWriterEvidence[],
  options: { maxRefs?: number; maxEvidenceChars?: number; maxTotalChars?: number } = {}
): string {
  const maxRefs = options.maxRefs ?? clampReviewInteger(process.env.REVIEW_WRITER_AUDIT_EVIDENCE_MAX_REFS, 80, 10, 140);
  const maxEvidenceChars = options.maxEvidenceChars ?? clampReviewInteger(process.env.REVIEW_WRITER_AUDIT_EVIDENCE_CHARS_PER_REF, 900, 200, 2400);
  const maxTotalChars = options.maxTotalChars ?? clampReviewInteger(process.env.REVIEW_WRITER_AUDIT_EVIDENCE_MAX_CHARS, 70000, 12000, 160000);
  const selected = deduplicateReviewEvidenceInUseOrder(references).slice(0, maxRefs);
  if (selected.length === 0) {
    return "No cited reference evidence pack is available. Audit citation-claim matching conservatively and mark uncertain citations as requiring source-text verification.";
  }

  const blocks: string[] = [];
  let total = 0;
  for (const item of selected) {
    const sourceLabel = item.source === "pdfWiki" ? "PDF Wiki argument/evidence library" : "Embedding abstract library";
    const evidenceText = cleanReviewMultilineText(item.abstract || item.referenceRaw || "", "", maxEvidenceChars);
    const evidenceId = `R${item.referenceNumber || blocks.length + 1}`;
    const citationLabel = item.source === "pdfWiki" ? formatPdfWikiSentenceCitationLabel(item) : item.citation;
    const formalCitationLine = item.source === "pdfWiki" && citationLabel !== item.citation
      ? `\nFormal source citation: ${item.citation || ""}`
      : "";
    const support = item.claimSupport || buildUncheckedClaimEvidenceJudgment("未执行证据支持判断。");
    const supportSnippets = (support.evidenceSnippets || []).slice(0, 4)
      .map(snippet => `- ${cleanReviewMultilineText(snippet, "", 500)}`)
      .join("\n");
    const traceLines = (item.traceSnippets || []).slice(0, 6)
      .map(snippet => `- ${snippet.code} (${snippet.sourceLabel}): ${cleanReviewMultilineText(snippet.text, "", 500)}`)
      .join("\n");
    const block = `[${item.referenceNumber || blocks.length + 1}] ${citationLabel || ""}
Evidence ID: ${evidenceId}
Source: ${sourceLabel}
Title: ${item.title}
Authors: ${item.authors}
Year: ${item.year}
Journal: ${item.journal || "Unknown"}
DOI: ${item.doi || "N/A"}
${formalCitationLine ? formalCitationLine.trimStart() : ""}
Original reference: ${cleanReviewMultilineText(item.referenceRaw || "", "", 500)}
Evidence relation to generated claim: ${support.relation} (confidence ${Math.round((support.confidence || 0) * 100)}%)
Evidence relation reason: ${support.reason || "NR"}
Evidence relation snippets:
${supportSnippets || "- NR"}
Traceable evidence sentences:
${traceLines || "- NR: no sentence-level trace snippet available"}
Abstract / evidence excerpt:
${evidenceText || "No abstract/evidence excerpt available."}`;
    if (total + block.length > maxTotalChars && blocks.length > 0) break;
    blocks.push(block);
    total += block.length;
  }
  return blocks.join("\n\n---\n\n");
}

function cleanReviewSentenceOutput(content: string): string {
  return content
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/```$/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/^#+\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function writeReviewSentence(
  args: {
    topic: string;
    userRequirements: string;
    sectionTitle: string;
    paragraphTitle: string;
    sentence: ReviewWriterSentencePlan;
    evidence: ReviewWriterEvidence[];
    skillGuide: string;
    journalStyleGuide: string;
    longTermMemoryContext: string;
    language: string;
    config: ReviewWriterLlmConfig;
    useCodexCli: boolean;
    inTextCitationFormat: string;
  }
): Promise<string> {
  const scopedSupplementalContext = buildReviewScopedSupplementalContext(
    args.longTermMemoryContext,
    getReviewContextCharBudget("sentence"),
    [
      args.topic,
      args.userRequirements,
      args.sectionTitle,
      args.paragraphTitle,
      args.sentence.purpose,
      args.sentence.plannedContent,
      ...(args.sentence.searchKeywords || []),
    ]
  );
  const sentenceQualityRules = [
    await getReviewWriterCloudPrompt('review_writer_sentence_quality_rules', REVIEW_WRITER_SENTENCE_QUALITY_RULES),
    REFERENCE_RELEVANCE_WRITING_RULES,
  ].join("\n\n");
  const messages = [
    {
      role: "system" as const,
      content: `You write one evidence-grounded sentence for an academic paper. Use only the provided evidence for factual support. Do not invent citations, titles, authors, data, or mechanisms.

${sentenceQualityRules}`,
    },
    {
      role: "user" as const,
      content: `Article topic: ${args.topic}
Section: ${args.sectionTitle}
Paragraph: ${args.paragraphTitle}
Writing language: ${args.language === "zh" ? "Chinese" : "English"}
${args.userRequirements ? `
User requirements:
${args.userRequirements}
` : ""}
${scopedSupplementalContext ? `
${scopedSupplementalContext}
` : ""}

Sentence purpose:
${args.sentence.purpose}

Planned content:
${args.sentence.plannedContent}

Approximate target length for this sentence:
${args.sentence.targetWords || 40} ${args.language === "zh" ? "Chinese characters" : "English words"}

Search query used:
${args.sentence.searchQuery || ""}

Section writing skill excerpt:
${args.skillGuide || "No skill guide available."}

Target journal style guide:
${args.journalStyleGuide || "No target journal style guide available."}

Required in-text citation style:
${args.inTextCitationFormat}

Selected evidence for this sentence (1-3 most relevant items chosen from the retrieved TOP20 candidates):
${formatReviewEvidenceForPrompt(args.evidence)}

Write exactly one polished academic sentence, aiming for the target length while staying readable and following the user requirements. Apply the quality gate before writing: if the selected item is from PDF Wiki, cite it with the exact sentence-code Citation label shown above, such as （句子证A1B2C3）; do not replace that PDF Wiki sentence-code citation with the formal author-year source citation in the body. If a PDF Wiki traceable sentence is indirect or uncertain, use cautious language and add 需核查 immediately after the same sentence-code marker. If the selected item is from the Embedding abstract library, cite it only with the normal Citation label shown above, such as (Zhang et al., 2026), and do not add any R编号 or 句子证 marker. Do not use a bare [需核查引用是否直接支持] marker. Use only the selected evidence shown above for citations and scientific factual support. If supplemental user context is provided, use it for user/project context and experimental context, but do not cite it as literature evidence. When citing a selected evidence item, use the exact Citation label shown for that item and follow the required in-text citation style. Do not cite sources that are not listed above. Return the sentence only, with no markdown, no bullet, no explanation, and no reference list.`,
    },
  ];

  const promptSize = getReviewMessagesSize(messages);
  logger.info(`[ReviewWriter] Sentence ${args.sentence.id} prompt size: ${promptSize.chars} chars, ~${promptSize.estimatedTokens} tokens, supplemental=${args.longTermMemoryContext.length}->${scopedSupplementalContext.length} chars, skill=${args.skillGuide.length}, style=${args.journalStyleGuide.length}, evidence=${args.evidence.length}`);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await callReviewWriterLlm({
        label: "Paper Writer sentence",
        config: args.config,
        messages,
        temperature: attempt === 1 ? 0.25 : 0.1,
        maxTokens: getReviewOutputTokenBudget("sentence"),
        useCodexCli: args.useCodexCli,
      });
      const sentence = cleanReviewSentenceOutput(response);
      if (sentence) return sentence;
      lastError = new Error("Paper Writer sentence API returned content that became empty after cleanup");
    } catch (error) {
      lastError = error;
      if (!isReviewEmptyResponseError(error) || attempt === 2) break;
      logger.warn(`[ReviewWriter] Empty sentence response, retrying once for ${args.sentence.id}:`, error);
    }
  }

  const lastMessage = (lastError as Error)?.message || String(lastError || "unknown error");
  throw new Error(
    "Paper Writer sentence API returned empty response after retry. " +
    "这通常表示模型/API 没有生成 message.content；常见原因是本次提示词仍超过模型上下文、服务商返回空 choices，或 Codex CLI 长任务超时。 " +
    `Last error: ${lastMessage}`
  );
}

async function reviewAndReviseReviewSection(
  args: {
    topic: string;
    userRequirements: string;
    sectionTitle: string;
    sectionText: string;
    evidence: ReviewWriterEvidence[];
    journalStyleGuide: string;
    supplementalContext: string;
    language: string;
    config: ReviewWriterLlmConfig;
    useCodexCli: boolean;
  }
): Promise<{ text: string; score: number; issues: string[] }> {
  const evidencePack = formatReviewEvidenceForAudit(args.evidence, {
    maxRefs: 24,
    maxEvidenceChars: 650,
    maxTotalChars: 18000,
  });
  const scopedSupplementalContext = buildReviewScopedSupplementalContext(
    args.supplementalContext,
    getReviewContextCharBudget("sectionReview"),
    [args.topic, args.userRequirements, args.sectionTitle, args.sectionText.slice(0, 2000)]
  );
  const sectionReviewPrompt = [
    await getReviewWriterCloudPrompt('review_writer_section_review', REVIEW_WRITER_SECTION_REVIEW_PROMPT),
    REFERENCE_RELEVANCE_AUDIT_RULES,
  ].join("\n\n");
  const messages = [
    {
      role: "system" as const,
      content: `${sectionReviewPrompt}

Return valid JSON only. Do not include markdown fences or explanations.`,
    },
    {
      role: "user" as const,
      content: `Paper topic:
${args.topic}

Section title:
${args.sectionTitle}

Writing language:
${args.language === "zh" ? "Chinese" : "English"}

User requirements:
${args.userRequirements || "None"}

${scopedSupplementalContext ? `Supplemental user context excerpts:
${scopedSupplementalContext}
` : ""}

Target journal style excerpt:
${args.journalStyleGuide || "No target journal style guide available."}

Cited evidence used by this section:
${evidencePack}

Current section text:
${args.sectionText}

Revise this section only when needed. Make the section more synthetic, cautious, and evidence-aligned while preserving its citations where possible.

Hard rules:
- Do not add a citation unless it appears in the evidence pack.
- If PDF Wiki sentence-level evidence is used, preserve its sentence-code citation label, such as （句子证A1B2C3）. If support is indirect or uncertain, downgrade wording and add 需核查 after that same sentence-code marker. For Embedding abstract library evidence, use the normal citation label only, such as (Zhang et al., 2026), and do not add R编号 or 句子证 markers.
- Improve mechanism, condition boundary, contradiction explanation, and evidence strength.
- Remove AI-like empty phrases and literature-listing patterns.
- Keep normal text and normal digits only; no superscript/subscript.
- Return exactly this JSON shape and nothing else:
{"score":0,"issues":["brief issue"],"revisedText":"revised section body only, without section heading"}`,
    },
  ];
  const promptSize = getReviewMessagesSize(messages);
  logger.info(`[ReviewWriter] Section review "${args.sectionTitle}" prompt size: ${promptSize.chars} chars, ~${promptSize.estimatedTokens} tokens, evidence=${args.evidence.length}, supplemental=${args.supplementalContext.length}->${scopedSupplementalContext.length}`);

  const response = await callReviewWriterLlm({
    label: `Paper Writer section quality pass: ${args.sectionTitle}`,
    config: args.config,
    messages,
    temperature: 0.08,
    maxTokens: getReviewOutputTokenBudget("sectionReview"),
    useCodexCli: args.useCodexCli,
  });
  const payload = parseReviewJsonObject(response) as Record<string, unknown> | null;
  const revisedText = cleanReviewMultilineText(payload?.revisedText || payload?.text, "", 120000);
  const score = Number(payload?.score);
  return {
    text: revisedText || args.sectionText,
    score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0,
    issues: parseReviewStringArray(payload?.issues),
  };
}

function stripReviewReferenceNumberPrefix(value: string): string {
  return cleanReviewText(value)
    .replace(/^[-*]\s*/, "")
    .replace(/^(\[\d+\]|\d+[.、])\s*/, "")
    .trim();
}

function formatReviewReferenceFromTemplate(item: ReviewWriterEvidence, template: string): string | null {
  if (!/\{(?:authors|author|year|title|journal|doi|number|n|citation)\}/i.test(template)) return null;
  const value = template
    .replace(/\{authors?\}/gi, item.authors || "Unknown")
    .replace(/\{year\}/gi, item.year || "n.d.")
    .replace(/\{title\}/gi, item.title || "Untitled")
    .replace(/\{journal\}/gi, item.journal || "")
    .replace(/\{doi\}/gi, item.doi || "")
    .replace(/\{(?:number|n)\}/gi, String(item.referenceNumber || ""))
    .replace(/\{citation\}/gi, item.citation || "");
  return cleanReviewText(value).trim() || null;
}

function formatReviewReference(item: ReviewWriterEvidence, input?: Pick<ReviewWriterGenerationInput, "referenceFormat" | "citationStyle">): string {
  if (item.source === "pdfWiki" && /^来源\s*PDF[:：]/i.test(cleanReviewText(item.referenceRaw))) {
    const fallbackSource = stripReviewReferenceNumberPrefix(cleanReviewText(item.referenceRaw));
    if (input?.citationStyle === "numeric" && item.referenceNumber) {
      return `[${item.referenceNumber}] ${fallbackSource}`.trim();
    }
    return fallbackSource;
  }
  const templateFormatted = input?.referenceFormat
    ? formatReviewReferenceFromTemplate(item, input.referenceFormat)
    : null;
  if (templateFormatted) return templateFormatted;

  const parts = [
    `${item.authors || "Unknown"} (${item.year || "n.d."}).`,
    `${item.title || "Untitled"}.`,
    item.journal ? `${item.journal}.` : "",
    item.doi ? `doi: ${item.doi}` : "",
  ].filter(Boolean);
  const normalized = stripReviewReferenceNumberPrefix(parts.join(" "));
  const fallback = normalized || stripReviewReferenceNumberPrefix(cleanReviewText(item.referenceRaw));
  if (input?.citationStyle === "numeric" && item.referenceNumber) {
    return `[${item.referenceNumber}] ${fallback}`.trim();
  }
  return fallback;
}

function parseReviewReferenceListResponse(content: string): string[] {
  const parsed = parseReviewJsonObject(content);
  const rawItems = Array.isArray(parsed?.references)
    ? parsed.references
    : (Array.isArray(parsed) ? parsed : content.split(/\n+/));
  return rawItems
    .map((item: unknown) => cleanReviewMultilineText(item, "", 1200))
    .map((item: string) => item.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
}

async function formatReviewReferencesForOutput(
  references: ReviewWriterEvidence[],
  input: ReviewWriterGenerationInput
): Promise<string[]> {
  const fallback = references.map((reference) => formatReviewReference(reference, input)).filter(Boolean);
  if (!input.referenceFormat.trim() || references.length === 0) return fallback;

  try {
    const sources = references.slice(0, 120).map((reference, index) => {
      const sourcePdfFallback = reference.source === "pdfWiki" && /^来源\s*PDF[:：]/i.test(cleanReviewText(reference.referenceRaw));
      const sourcePdfTitle = sourcePdfFallback
        ? cleanReviewText(reference.referenceRaw).replace(/^来源\s*PDF[:：]\s*/i, "")
        : "";
      return {
        number: reference.referenceNumber || index + 1,
        inTextCitation: reference.citation,
        authors: reference.authors,
        year: reference.year,
        title: sourcePdfTitle || reference.title,
        journal: sourcePdfFallback ? "Source PDF" : reference.journal,
        doi: sourcePdfFallback ? "" : reference.doi,
        source: reference.source,
        originalReference: reference.referenceRaw || "",
      };
    });

    const response = await callReviewWriterLlm({
      label: "Paper Writer reference formatter",
      config: input.config,
      temperature: 0.05,
      maxTokens: getReviewOutputTokenBudget("reference"),
      useCodexCli: input.useCodexCli,
      messages: [
        {
          role: "system" as const,
          content: "You format bibliography entries for an academic paper. Return valid JSON only.",
        },
        {
          role: "user" as const,
          content: `Format the following bibliography entries strictly according to the user's target journal reference format.
If a source's originalReference starts with "来源 PDF：", the PDF sentence had no matched following citation. Cite the source PDF itself; do not use the sentence claim as the bibliography title.

Target journal reference format or example:
${input.referenceFormat}

Required in-text citation style:
${input.inTextCitationFormat}

Rules:
- Preserve the supplied authors, year, title, journal, and DOI. Do not invent missing fields.
- Use normal text and normal digits only; do not use superscript or subscript formatting.
- If the target reference format explicitly includes reference numbers, use the supplied "number" for each source.
- If the target reference format does not include reference numbers, do not add numbering.
- Return exactly this JSON shape and nothing else: {"references":["formatted reference 1","formatted reference 2"]}

Sources:
${JSON.stringify(sources, null, 2)}`,
        },
      ],
    });
    const formatted = parseReviewReferenceListResponse(response);
    if (formatted.length === references.length) return formatted;
    logger.warn(`[ReviewWriter] Reference formatter returned ${formatted.length}/${references.length} entries; using local fallback`);
  } catch (error) {
    logger.warn("[ReviewWriter] Reference formatter failed; using local fallback:", error);
  }

  return fallback;
}

function buildReviewWriterDocument(outline: ReviewWriterOutline, references: string[]): string {
  const parts: string[] = [`\\title{${cleanReviewTitle(outline.title, "论文草稿")}}`];
  for (const section of outline.sections) {
    parts.push(`\\section{${cleanReviewTitle(section.title, "未命名章节")}}`);
    if (section.text?.trim()) {
      parts.push(section.text.trim());
    } else {
      for (const paragraph of section.paragraphs) {
        const text = paragraph.text || paragraph.sentences.map((sentence) => sentence.writtenSentence).filter(Boolean).join(" ");
        if (text) parts.push(text);
      }
    }
  }

  if (references.length > 0) {
    parts.push("\\section*{References}");
    references.slice(0, 120).forEach((reference) => {
      parts.push(reference);
    });
  }

  return parts.join("\n\n").trim();
}

function sanitizeReviewWriterDownloadFilename(value: string, fallback = "paper-draft"): string {
  const cleaned = String(value || "")
    .replace(/[\\/:*?"<>|\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 90);
  return cleaned || fallback;
}

function setReviewWriterTextDownloadHeaders(res: Response, contentType: string, filename: string): void {
  const asciiFilename = filename.replace(/[^\x20-\x7E]+/g, "_").replace(/[\\/:*?"<>|]+/g, "_") || "paper-draft.txt";
  res.setHeader("Content-Type", `${contentType}; charset=utf-8`);
  res.setHeader("Content-Disposition", `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
}

function convertReviewWriterLatexToMarkdown(content: string): string {
  return String(content || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\title\{([^}]*)\}/g, "# $1\n")
    .replace(/\\section\*\{([^}]*)\}/g, "\n## $1\n")
    .replace(/\\section\{([^}]*)\}/g, "\n## $1\n")
    .replace(/\\subsection\{([^}]*)\}/g, "\n### $1\n")
    .replace(/\\subsubsection\{([^}]*)\}/g, "\n#### $1\n")
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, "$1")
    .replace(/\\[a-zA-Z]+\*?/g, "")
    .replace(/[{}]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertReviewWriterLatexToPlainText(content: string): string {
  return convertReviewWriterLatexToMarkdown(content)
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ReviewCitationVerificationNote {
  code: string;
  sentence: string;
  marker: string;
  references: ReviewWriterEvidence[];
  snippets: ReviewWriterEvidenceTraceSnippet[];
  uncertain?: boolean;
}

function annotateReviewCitationVerificationMarkers(
  content: string,
  references: ReviewWriterEvidence[]
): { content: string; notes: ReviewCitationVerificationNote[] } {
  const markerPattern = /\[(需核查引用是否直接支持|需核查引用原文|reference details need verification)(?:\s*[:：]\s*([^\]]+))?\]|(来源(?:Wiki论点库|文献级证据)[:：]\s*(?:句子)?(证[A-Z0-9]{6}|R\d+)（需核查）)/gi;
  const notes: ReviewCitationVerificationNote[] = [];
  let matchIndex = 0;
  const annotated = content.replace(markerPattern, (marker, label, rawIds, readableMarker, readableId, offset) => {
    matchIndex += 1;
    const rawCodeText = rawIds || readableId || "";
    const sentence = findReviewVerificationSentence(content, offset);
    const matchedReferences = findReviewReferencesForVerification(sentence, rawCodeText, references);
    const snippets = matchedReferences.flatMap(reference => reference.traceSnippets || []);
    const explicitCodes = parseReviewTraceCodes(rawCodeText);
    const wikiSnippets = snippets.filter(snippet => snippet.source === "pdfWiki");
    const explicitSentenceCode = explicitCodes.find(code =>
      /^证[A-Z0-9]{6}$/i.test(code)
      && wikiSnippets.some(snippet => snippet.code.toLowerCase() === code.toLowerCase())
    );
    const code = explicitSentenceCode
      || wikiSnippets[0]?.code
      || "";
    if (!code) {
      return "";
    }
    notes.push({
      code,
      sentence: cleanReviewMultilineText(sentence, "", 1400),
      marker,
      references: matchedReferences.slice(0, 6),
      snippets: wikiSnippets.slice(0, 8),
      uncertain: /需核查|verification|核查/i.test(marker),
    });
    return formatReviewVerificationMarker(code, snippets);
  });
  return { content: annotated, notes };
}

function normalizeReviewSentenceTraceCode(value: string): string {
  const match = String(value || "").match(/证([A-Z0-9]{6})/i);
  return match ? `证${match[1].toUpperCase()}` : "";
}

function parseReviewTraceCodes(value: string): string[] {
  return Array.from(String(value || "").matchAll(/证[A-Z0-9]{6}|R\d+/gi))
    .map(match => {
      const token = match[0];
      const sentenceCode = normalizeReviewSentenceTraceCode(token);
      return sentenceCode || token.replace(/^r/i, "R");
    })
    .slice(0, 10);
}

function formatReviewVerificationMarker(code: string, snippets: ReviewWriterEvidenceTraceSnippet[]): string {
  if (/^证[A-Z0-9]{6}$/i.test(code)) {
    const hasPdfWikiSnippet = snippets.some(snippet => snippet.source === "pdfWiki" && snippet.code.toLowerCase() === code.toLowerCase());
    return hasPdfWikiSnippet ? `句子${code}（需核查）` : "";
  }
  return "";
}

function findReviewVerificationSentence(content: string, offset: number): string {
  const paragraphStart = content.lastIndexOf("\n\n", offset);
  const paragraphEnd = content.indexOf("\n\n", offset + 1);
  const start = Math.max(paragraphStart >= 0 ? paragraphStart + 2 : 0, offset - 900);
  const end = paragraphEnd >= 0 && paragraphEnd <= offset + 1200
    ? paragraphEnd
    : Math.min(content.length, offset + 500);
  return cleanReviewMultilineText(content.slice(start, end), "", 1800);
}

function findReviewReferencesForVerification(
  sentence: string,
  rawIds: string,
  references: ReviewWriterEvidence[]
): ReviewWriterEvidence[] {
  const explicitCodes = parseReviewTraceCodes(rawIds);
  const numericRefs = new Set<number>();
  explicitCodes.forEach(code => {
    const match = code.match(/^R(\d+)$/i);
    if (match) numericRefs.add(Number(match[1]));
  });
  Array.from(sentence.matchAll(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g)).forEach(match => {
    match[1].split(/[,;]/).forEach(value => {
      const number = Number(value.trim());
      if (Number.isFinite(number)) numericRefs.add(number);
    });
  });

  const normalizedSentence = normalizeReviewCitationText(sentence);
  const matched = references.filter(reference => {
    if (reference.referenceNumber && numericRefs.has(reference.referenceNumber)) return true;
    if (reference.traceSnippets?.some(snippet => explicitCodes.includes(snippet.code))) return true;
    const citation = normalizeReviewCitationText(reference.citation || "");
    if (citation && normalizedSentence.includes(citation)) return true;
    const author = normalizeReviewCitationText(getReviewCitationAuthorLabel(reference.authors));
    const year = normalizeReviewCitationText(reference.year || "");
    return Boolean(author && year && normalizedSentence.includes(author) && normalizedSentence.includes(year));
  });
  return deduplicateReviewEvidenceInUseOrder(matched).slice(0, 8);
}

function normalizeReviewCitationText(value: string): string {
  return cleanReviewText(value)
    .toLowerCase()
    .replace(/[()，,.;；:：\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deduplicateReviewTraceSnippets(snippets: ReviewWriterEvidenceTraceSnippet[]): ReviewWriterEvidenceTraceSnippet[] {
  const seen = new Set<string>();
  const unique: ReviewWriterEvidenceTraceSnippet[] = [];
  for (const snippet of snippets) {
    const key = `${snippet.source}|${snippet.code.toLowerCase()}|${snippet.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(snippet);
  }
  return unique;
}

function findReviewReferencesByTraceCode(
  code: string,
  references: ReviewWriterEvidence[]
): ReviewWriterEvidence[] {
  const normalizedCode = normalizeReviewSentenceTraceCode(code);
  if (!normalizedCode) return [];
  return deduplicateReviewEvidenceInUseOrder(
    references.filter(reference =>
      (reference.traceSnippets || []).some(snippet =>
        snippet.source === "pdfWiki" && normalizeReviewSentenceTraceCode(snippet.code) === normalizedCode
      )
    )
  );
}

function collectReviewWikiArgumentNotes(
  content: string,
  references: ReviewWriterEvidence[],
  existingNotes: ReviewCitationVerificationNote[] = []
): ReviewCitationVerificationNote[] {
  const notesByCode = new Map<string, ReviewCitationVerificationNote>();
  const addNote = (note: ReviewCitationVerificationNote) => {
    const code = normalizeReviewSentenceTraceCode(note.code);
    if (!code) return;
    const existing = notesByCode.get(code);
    if (!existing) {
      notesByCode.set(code, {
        ...note,
        code,
        references: deduplicateReviewEvidenceInUseOrder(note.references),
        snippets: deduplicateReviewTraceSnippets(note.snippets),
      });
      return;
    }
    notesByCode.set(code, {
      ...existing,
      sentence: existing.sentence || note.sentence,
      marker: existing.marker || note.marker,
      uncertain: Boolean(existing.uncertain || note.uncertain),
      references: deduplicateReviewEvidenceInUseOrder([...existing.references, ...note.references]),
      snippets: deduplicateReviewTraceSnippets([...existing.snippets, ...note.snippets]),
    });
  };

  existingNotes.forEach(addNote);

  const markerPattern = /(?:来源Wiki论点库[:：]\s*)?(?:句子)?(证[A-Z0-9]{6})(?:[（(]\s*需核查\s*[）)])?/gi;
  for (const match of content.matchAll(markerPattern)) {
    const rawCode = match[1] || match[0];
    const code = normalizeReviewSentenceTraceCode(rawCode);
    if (!code) continue;
    const offset = typeof match.index === "number" ? match.index : 0;
    const contextAfter = content.slice(offset, offset + Math.max(24, match[0].length + 12));
    const sentence = findReviewVerificationSentence(content, offset);
    const explicitRefs = findReviewReferencesByTraceCode(code, references);
    const sentenceRefs = findReviewReferencesForVerification(sentence, code, references);
    const matchedReferences = deduplicateReviewEvidenceInUseOrder([...explicitRefs, ...sentenceRefs]).slice(0, 8);
    const snippets = deduplicateReviewTraceSnippets(
      matchedReferences.flatMap(reference => reference.traceSnippets || [])
        .filter(snippet => snippet.source === "pdfWiki" && normalizeReviewSentenceTraceCode(snippet.code) === code)
    );
    addNote({
      code,
      sentence: cleanReviewMultilineText(sentence, "", 1400),
      marker: match[0],
      references: matchedReferences,
      snippets,
      uncertain: /需核查/.test(match[0]) || /需核查/.test(contextAfter),
    });
  }

  return Array.from(notesByCode.values())
    .sort((a, b) => content.indexOf(a.code) - content.indexOf(b.code));
}

function appendReviewCitationVerificationNotes(
  content: string,
  notes: ReviewCitationVerificationNote[]
): string {
  if (notes.length === 0) return content;
  const lines: string[] = [
    "\\section*{PDF Wiki 论点尾注}",
    "以下条目用于把正文中的句子证编号对应回 PDF Wiki 句子级论点。正文只保留编号；尾注列出编号、论点句和来源线索。",
  ];
  notes.forEach((note, index) => {
    const primarySnippet = note.snippets.find(snippet => normalizeReviewSentenceTraceCode(snippet.code) === note.code) || note.snippets[0];
    const evidenceSentence = cleanReviewMultilineText(primarySnippet?.text || note.sentence, "", 1600);
    lines.push(`${index + 1}. ${note.code}${note.uncertain ? "（需核查）" : ""}：${evidenceSentence || "未找到对应证据句"}`);
    if (primarySnippet?.sourceLabel) {
      lines.push(`来源：${primarySnippet.sourceLabel}`);
    }
    if (note.references.length > 0) {
      lines.push("对应文献：");
      note.references.forEach(reference => {
        const refNo = reference.referenceNumber ? `R${reference.referenceNumber}` : "R?";
        lines.push(`- ${refNo} ${reference.citation || ""} ${reference.title || ""}${reference.doi ? ` DOI: ${reference.doi}` : ""}`);
      });
    } else {
      lines.push("对应文献：未能从正文句中自动匹配到已登记引用，请人工回到该 PDF 论点附近核查。");
    }
    if (note.sentence && !evidenceSentence.includes(note.sentence)) {
      lines.push(`正文上下文：${note.sentence}`);
    }
  });

  const section = lines.join("\n\n");
  const referencesMatch = content.match(/\\section\*?\{References\}/i);
  if (!referencesMatch || referencesMatch.index === undefined) {
    return `${content.trim()}\n\n${section}`;
  }
  return `${content.slice(0, referencesMatch.index).trim()}\n\n${section}\n\n${content.slice(referencesMatch.index).trim()}`;
}

interface ReviewDocumentSectionBlock {
  title: string;
  heading: string;
  body: string;
  start: number;
  end: number;
}

function parseReviewDocumentSections(content: string): ReviewDocumentSectionBlock[] {
  const matches = Array.from(content.matchAll(/\\section\*?\{([^}]+)\}/g));
  return matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? matches[index + 1].index ?? content.length : content.length;
    const heading = match[0];
    return {
      title: cleanReviewTitle(match[1], `Section ${index + 1}`),
      heading,
      body: content.slice(start + heading.length, end).trim(),
      start,
      end,
    };
  });
}

function normalizeReviewSectionName(value: string): string {
  return cleanReviewText(value)
    .toLowerCase()
    .replace(/^references$/i, "references")
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "");
}

function selectReviewTargetSections(content: string, audit: ReviewWriterQualityReviewResult): ReviewDocumentSectionBlock[] {
  const sections = parseReviewDocumentSections(content).filter(section => !/^references$/i.test(section.title));
  if (sections.length === 0) return [];

  const requested = new Set((audit.affectedSections || []).map(normalizeReviewSectionName).filter(Boolean));
  const doNotChange = new Set((audit.doNotChangeSections || []).map(normalizeReviewSectionName).filter(Boolean));
  const selected: ReviewDocumentSectionBlock[] = [];
  const addSection = (section: ReviewDocumentSectionBlock): void => {
    const key = normalizeReviewSectionName(section.title);
    if (doNotChange.has(key) || selected.some(item => item.title === section.title)) return;
    selected.push(section);
  };

  if (requested.size > 0) {
    for (const section of sections) {
      const key = normalizeReviewSectionName(section.title);
      if (Array.from(requested).some(item => key.includes(item) || item.includes(key))) {
        addSection(section);
      }
    }
  }

  if (selected.length === 0) {
    const auditText = normalizeReviewSectionName([
      audit.reportMarkdown,
      ...(audit.topProblems || []),
      ...(audit.revisionInstructions || []),
    ].join(" "));
    for (const section of sections) {
      const key = normalizeReviewSectionName(section.title);
      if (key && auditText.includes(key)) {
        addSection(section);
      }
    }
  }

  if (selected.length === 0) {
    const preferred = sections.filter(section => /introduction|discussion|mechanism|evidence|引言|讨论|机制|证据/i.test(section.title));
    (preferred.length > 0 ? preferred : sections).slice(0, 2).forEach(addSection);
  }

  return selected.slice(0, 3);
}

function replaceReviewDocumentSections(
  content: string,
  replacements: Map<string, string>
): string {
  const sections = parseReviewDocumentSections(content);
  if (sections.length === 0 || replacements.size === 0) return content;

  let output = "";
  let cursor = 0;
  for (const section of sections) {
    output += content.slice(cursor, section.start);
    const replacement = replacements.get(normalizeReviewSectionName(section.title));
    if (replacement) {
      const cleaned = replacement
        .replace(/^```[a-z]*\s*/i, "")
        .replace(/```$/g, "")
        .replace(new RegExp(`^\\\\section\\*?\\{${section.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\}\\s*`, "i"), "")
        .trim();
      output += `${section.heading}\n\n${cleaned}`;
    } else {
      output += content.slice(section.start, section.end);
    }
    cursor = section.end;
  }
  output += content.slice(cursor);
  return output.trim();
}

function replaceReviewDocumentTitle(content: string, title: string): string {
  const cleaned = cleanReviewTitle(title, "");
  if (!cleaned) return content;
  if (/\\title\{[^}]*\}/.test(content)) {
    return content.replace(/\\title\{[^}]*\}/, `\\title{${cleaned}}`);
  }
  return `\\title{${cleaned}}\n\n${content}`.trim();
}

function extractReviewQualityJson(content: string): Record<string, unknown> {
  const tagged = content.match(/<QUALITY_JSON>\s*([\s\S]*?)\s*<\/QUALITY_JSON>/i)?.[1];
  const parsed = tagged ? parseReviewJsonObject(tagged) : parseReviewJsonObject(content);
  return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
}

function parseReviewQualityScore(content: string, payload: Record<string, unknown>): number {
  const direct = Number(payload.score ?? payload.totalScore ?? payload.overallScore);
  if (Number.isFinite(direct)) return Math.max(0, Math.min(100, direct));
  const patterns = [
    /总分\s*\|\s*100\s*\|\s*(\d{1,3}(?:\.\d+)?)/,
    /总分[^0-9]{0,20}(\d{1,3}(?:\.\d+)?)\s*\/\s*100/i,
    /score[^0-9]{0,20}(\d{1,3}(?:\.\d+)?)\s*\/\s*100/i,
    /"score"\s*:\s*(\d{1,3}(?:\.\d+)?)/i,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return Math.max(0, Math.min(100, value));
    }
  }
  return 0;
}

function parseReviewStringArray(value: unknown, fallback: string[] = []): string[] {
  const rawItems = Array.isArray(value)
    ? value
    : (typeof value === "string" ? value.split(/\n|;|；/) : fallback);
  return rawItems
    .map((item) => cleanReviewText(item))
    .filter(Boolean)
    .slice(0, 12);
}

function getReviewQualitySummary(payload: Record<string, unknown>): Record<string, unknown> {
  const summary = payload.qualityControlSummary;
  return summary && typeof summary === "object" && !Array.isArray(summary)
    ? summary as Record<string, unknown>
    : {};
}

function parseReviewQualitySummaryArray(
  payload: Record<string, unknown>,
  key: string,
  fallback: string[] = []
): string[] {
  const summary = getReviewQualitySummary(payload);
  return parseReviewStringArray(payload[key] ?? summary[key], fallback);
}

function parseReviewQualitySummaryText(payload: Record<string, unknown>, key: string, fallback = ""): string {
  const summary = getReviewQualitySummary(payload);
  return cleanReviewText(payload[key] ?? summary[key], fallback);
}

function isUsableReviewRecommendedTitle(title: string): boolean {
  const cleaned = cleanReviewText(title);
  if (!cleaned) return false;
  return !/^(推荐题目|推荐用于|稳妥型题目|创新型题目|投稿型题目|recommended title|title option)$/i.test(cleaned);
}

function isReviewBlockingVerdict(verdict: string): boolean {
  return /不可直接提交|不建议提交|需重构|reject/i.test(verdict);
}

async function auditReviewWriterContent(
  content: string,
  input: ReviewWriterGenerationInput,
  round: number,
  usedReferences: ReviewWriterEvidence[] = []
): Promise<ReviewWriterQualityReviewResult> {
  const evidencePack = formatReviewEvidenceForAudit(usedReferences);
  const finalAuditPrompt = [
    await getReviewWriterCloudPrompt('review_writer_final_audit', REVIEW_WRITER_FINAL_AUDIT_PROMPT),
    REFERENCE_RELEVANCE_AUDIT_RULES,
  ].join("\n\n");
  const response = await callReviewWriterLlm({
    label: `Paper Writer quality audit round ${round}`,
    config: input.config,
    temperature: 0.05,
    maxTokens: getReviewOutputTokenBudget("qualityAudit"),
    useCodexCli: input.useCodexCli,
    messages: [
      {
        role: "system" as const,
        content: "You are a very strict academic journal reviewer and paper quality evaluation expert. You must find hard problems, not flatter the manuscript.",
      },
      {
        role: "user" as const,
        content: `${finalAuditPrompt}

论文主题：
${input.topic}

用户要求：
${input.userRequirements || "无"}

用于审查的实际引用证据包：
下面是本文实际使用过的参考文献及其摘要、PDF Wiki 论点证据摘录、文中引用标签和参考文献信息。审查“引用—论断匹配”时必须优先依据该证据包判断。
如果证据包只是摘要或摘录，不能因为没有全文就默认判定引用不支持；PDF Wiki 句子级证据应保留正文里的（句子证XXXXXX）编号，明显超出原句时在该编号后补充“需核查”或建议降级表述；embedding 文献库证据只使用正常作者-年份或数字引用，不要输出 R编号或句子证编号。
如果正文引用了证据包中不存在的来源，应标记为“高风险引用错配”。

${evidencePack}

待审查论文：
${content}`,
      },
    ],
  });

  const payload = extractReviewQualityJson(response);
  const score = parseReviewQualityScore(response, payload);
  const verdict = cleanReviewText(payload.verdict, cleanReviewText(response.match(/最终判定[:：]\s*([^\n]+)/)?.[1], "大修后再评估"));
  return {
    passed: score >= 95 && !isReviewBlockingVerdict(verdict),
    score,
    verdict,
    rounds: round,
    reportMarkdown: response.trim(),
    topProblems: parseReviewStringArray(payload.topProblems),
    revisionInstructions: parseReviewStringArray(payload.revisionInstructions),
    affectedSections: parseReviewStringArray(payload.affectedSections).slice(0, 3),
    doNotChangeSections: parseReviewStringArray(payload.doNotChangeSections),
    paperType: cleanReviewText(payload.paperType),
    diagnosis: parseReviewQualitySummaryText(payload, "diagnosis"),
    recommendedTitle: cleanReviewText(payload.recommendedTitle),
    titleOptions: parseReviewStringArray(payload.titleOptions),
    figureTableSuggestions: parseReviewQualitySummaryArray(payload, "figureTableSuggestions"),
    modificationNotes: parseReviewQualitySummaryArray(payload, "modificationNotes"),
    missingInformation: parseReviewQualitySummaryArray(payload, "missingInformation"),
  };
}

async function reviseReviewWriterContentFromAudit(
  content: string,
  audit: ReviewWriterQualityReviewResult,
  input: ReviewWriterGenerationInput,
  round: number,
  usedReferences: ReviewWriterEvidence[] = []
): Promise<string> {
  const targetSections = selectReviewTargetSections(content, audit);
  const sectionOutline = parseReviewDocumentSections(content)
    .map((section, index) => `${index + 1}. ${section.title}`)
    .join("\n");
  const evidencePack = formatReviewEvidenceForAudit(usedReferences, {
    maxRefs: 60,
    maxEvidenceChars: 800,
    maxTotalChars: 45000,
  });
  const qualityGatePrompt = [
    await getReviewWriterCloudPrompt('review_writer_quality_gate', REVIEW_WRITER_QUALITY_GATE_PROMPT),
    REFERENCE_RELEVANCE_AUDIT_RULES,
  ].join("\n\n");
  const finalOptimizationPrompt = [
    await getReviewWriterCloudPrompt('review_writer_final_manuscript_optimization', REVIEW_WRITER_FINAL_MANUSCRIPT_OPTIMIZATION_PROMPT),
    REFERENCE_RELEVANCE_AUDIT_RULES,
  ].join("\n\n");

  if (targetSections.length > 0) {
    try {
      const response = await callReviewWriterLlm({
        label: `Paper Writer targeted quality revision round ${round}`,
        config: input.config,
        temperature: 0.1,
        maxTokens: getReviewOutputTokenBudget("qualityRevision"),
        useCodexCli: input.useCodexCli,
        messages: [
          {
            role: "system" as const,
            content: `${qualityGatePrompt}

${finalOptimizationPrompt}

You revise only the specified manuscript sections based on strict reviewer audit reports. Do not rewrite untouched sections. Do not invent new references, DOI, data, or results. Return valid JSON only.`,
          },
          {
            role: "user" as const,
            content: `The manuscript scored ${audit.score}/100. Revise only the target sections below.

Paper topic:
${input.topic}

Full section outline:
${sectionOutline}

Target sections for this revision:
${targetSections.map((section, index) => `## TARGET ${index + 1}: ${section.title}\n${section.body}`).join("\n\n---\n\n")}

Reviewer top problems:
${(audit.topProblems || []).slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join("\n") || audit.reportMarkdown.slice(0, 6000)}

Targeted revision instructions:
${(audit.revisionInstructions || []).slice(0, 8).map((item, index) => `${index + 1}. ${item}`).join("\n") || "Fix scope drift, missing definitions, citation-claim mismatch, evidence overextension, literature-listing paragraphs, overconfident statements, and AI-like empty language."}

Cited reference evidence pack for checking and revising only the target sections:
${evidencePack}

Hard rules:
- Revise only listed target sections.
- Preserve existing citation labels where possible; only add a citation if it is present in the evidence pack and directly supports the revised sentence.
- If PDF Wiki support is used, preserve the sentence-code citation label from the evidence pack, such as （句子证A1B2C3）. If support is indirect or uncertain, downgrade the wording and add 需核查 after that same marker. For embedding evidence, keep the normal citation label and do not add R编号 or 句子证 markers.
- Strengthen mechanism, condition boundary, evidence strength, and contradiction synthesis.
- Remove or rewrite literature-listing sentences.
- Keep normal text and normal digits only; no superscript/subscript.
- Return exactly this JSON shape and nothing else:
{"sections":[{"title":"exact target section title","content":"revised section body without \\\\section heading"}]}`,
          },
        ],
      });
      const parsed = parseReviewJsonObject(response);
      const rawSections = Array.isArray(parsed?.sections) ? parsed.sections : [];
      const replacements = new Map<string, string>();
      for (const item of rawSections) {
        const title = cleanReviewTitle(item?.title, "");
        const replacement = cleanReviewMultilineText(item?.content, "", 120000);
        if (title && replacement) replacements.set(normalizeReviewSectionName(title), replacement);
      }
      const revised = replaceReviewDocumentSections(content, replacements);
      if (revised !== content) return revised;
      logger.warn("[ReviewWriter] Targeted revision returned no usable section replacements; falling back to full-manuscript revision");
    } catch (error) {
      logger.warn("[ReviewWriter] Targeted revision failed; falling back to full-manuscript revision:", error);
    }
  }

  const response = await callReviewWriterLlm({
    label: `Paper Writer fallback full quality revision round ${round}`,
    config: input.config,
    temperature: 0.12,
    maxTokens: getReviewOutputTokenBudget("qualityRevision"),
    useCodexCli: input.useCodexCli,
    messages: [
      {
        role: "system" as const,
        content: `${qualityGatePrompt}

${finalOptimizationPrompt}

You revise full academic manuscripts based on strict reviewer audit reports. Preserve the manuscript format, title, section structure, citations, and references unless the audit explicitly requires removal or downgrade. Do not invent new references, DOI, data, or results.`,
      },
      {
        role: "user" as const,
        content: `The manuscript scored ${audit.score}/100 and cannot be released until it reaches at least 95/100.

Revise the manuscript directly and targetedly according to the audit below.

Hard rules:
- Fix scope drift, missing definitions, citation-claim mismatch, evidence overextension, literature-listing paragraphs, overconfident statements, and AI-like empty language first.
- If a PDF Wiki citation cannot be verified as directly supporting a sentence, preserve its sentence-code citation label, downgrade the sentence, and add 需核查 after that same marker. For embedding evidence, keep the normal citation label and do not add R编号 or 句子证 markers.
- Do not add uncited factual claims.
- Keep normal text and normal digits only; do not use superscript/subscript.
- Return the complete revised manuscript only. No explanations, no markdown fences, no audit report.

Audit report:
${audit.reportMarkdown.slice(0, 18000)}

Cited reference evidence pack:
${evidencePack}

Original manuscript:
${content}`,
      },
    ],
  });
  return response
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/g, "")
    .trim();
}

async function auditAndReviseReviewWriterContent(
  content: string,
  input: ReviewWriterGenerationInput,
  round: number,
  targetScore: number,
  usedReferences: ReviewWriterEvidence[] = []
): Promise<{ review: ReviewWriterQualityReviewResult; revisedContent?: string }> {
  const evidencePack = formatReviewEvidenceForAudit(usedReferences, {
    maxRefs: clampReviewInteger(process.env.REVIEW_WRITER_FINAL_AUDIT_MAX_REFS, 45, 10, 90),
    maxEvidenceChars: clampReviewInteger(process.env.REVIEW_WRITER_FINAL_AUDIT_EVIDENCE_CHARS_PER_REF, 550, 200, 1400),
    maxTotalChars: clampReviewInteger(process.env.REVIEW_WRITER_FINAL_AUDIT_EVIDENCE_MAX_CHARS, 30000, 8000, 80000),
  });
  const sectionOutline = parseReviewDocumentSections(content)
    .map((section, index) => `${index + 1}. ${section.title}`)
    .join("\n");
  const compactAuditPrompt = [
    await getReviewWriterCloudPrompt('review_writer_final_compact_audit', REVIEW_WRITER_FINAL_COMPACT_AUDIT_PROMPT),
    REFERENCE_RELEVANCE_AUDIT_RULES,
  ].join("\n\n");
  const finalOptimizationPrompt = [
    await getReviewWriterCloudPrompt('review_writer_final_manuscript_optimization', REVIEW_WRITER_FINAL_MANUSCRIPT_OPTIMIZATION_PROMPT),
    REFERENCE_RELEVANCE_AUDIT_RULES,
  ].join("\n\n");
  const response = await callReviewWriterLlm({
    label: `Paper Writer audit-and-revise round ${round}`,
    config: input.config,
    temperature: 0.06,
    maxTokens: getReviewOutputTokenBudget("qualityAudit"),
    useCodexCli: input.useCodexCli,
    messages: [
      {
        role: "system" as const,
        content: `${compactAuditPrompt}

${finalOptimizationPrompt}

You are a very strict academic journal reviewer and manuscript revision editor.
You must first evaluate the manuscript quality, then directly revise the existing manuscript sections yourself when the score is below the target.
Do not hand the audit to another assistant. Do not invent new references, DOI, data, or results. Return valid JSON only.`,
      },
      {
        role: "user" as const,
        content: `本轮目标：
- 当前自动精修目标分数：${targetScore}/100。
- 你必须先执行终稿级质量控制：判断论文类型，删除 AI/工具痕迹，重建论文主线，检查题目、摘要、关键词、引言、方法、结果、讨论、结论、引用、图表和语言。
- 如果低于目标分数，直接基于现有正文和证据包修改最需要修改的章节。
- 只返回最关键的 1-3 个问题章节修改稿；不要整篇盲改；不要改 References。
- 修改必须受证据包约束。不能新增证据包中没有的引用。PDF Wiki 句子级证据必须保留证据包中的（句子证XXXXXX）编号；证据不足时降级表述，并在该编号后补充“需核查”。embedding 文献库证据只保留正常引用，不要输出 R编号或句子证编号。
- 不需要输出长表格，不需要抽查 15 条引用；诊断、题目选项、图表建议和修改说明必须放入 JSON 字段，不要混入论文正文。

论文主题：
${input.topic}

用户要求：
${input.userRequirements || "无"}

全文章节列表：
${sectionOutline || "未解析到章节"}

实际引用证据包：
下面是本文实际使用过的参考文献及其摘要、PDF Wiki 论点证据摘录、文中引用标签和参考文献信息。判断引用是否支撑正文、以及修改正文时，都必须优先依据该证据包。

${evidencePack}

待审查并可直接修改的论文：
${content}

返回要求：
只返回一个 JSON 对象，不要 Markdown，不要解释，格式如下：
{
  "score": 0,
  "verdict": "大修后再评估",
  "passed": false,
  "paperType": "原创研究论文/综述论文/系统综述/Meta分析/研究方案/政策或技术报告/其他",
  "titleOptions": ["稳妥型题目", "创新型题目", "投稿型题目"],
  "recommendedTitle": "推荐用于 \\title{} 的题目",
  "topProblems": ["最关键问题"],
  "revisionInstructions": ["你刚才据此执行的修改原则"],
  "affectedSections": ["需要替换的原章节标题，必须与全文章节列表一致"],
  "doNotChangeSections": ["References"],
  "qualityControlSummary": {
    "diagnosis": "论文整体诊断，说明最大质量风险",
    "figureTableSuggestions": ["建议增加的图表或概念框架图"],
    "modificationNotes": ["主要修改说明"],
    "missingInformation": ["需要作者补充的信息"]
  },
  "revisedSections": [
    {
      "title": "必须与原章节标题完全一致",
      "content": "修改后的章节正文，不要包含 \\\\section 标题，不要包含 References"
    }
  ]
}

如果 score >= ${targetScore}，revisedSections 返回空数组。`,
      },
    ],
  });

  const payload = extractReviewQualityJson(response);
  const score = parseReviewQualityScore(response, payload);
  const verdict = cleanReviewText(payload.verdict, cleanReviewText(response.match(/最终判定[:：]\s*([^\n]+)/)?.[1], "大修后再评估"));
  const review: ReviewWriterQualityReviewResult = {
    passed: score >= targetScore && !isReviewBlockingVerdict(verdict),
    score,
    verdict,
    rounds: round,
    reportMarkdown: response.trim(),
    targetScore,
    topProblems: parseReviewStringArray(payload.topProblems),
    revisionInstructions: parseReviewStringArray(payload.revisionInstructions),
    affectedSections: parseReviewStringArray(payload.affectedSections).slice(0, 3),
    doNotChangeSections: parseReviewStringArray(payload.doNotChangeSections),
    paperType: cleanReviewText(payload.paperType),
    diagnosis: parseReviewQualitySummaryText(payload, "diagnosis"),
    recommendedTitle: cleanReviewText(payload.recommendedTitle),
    titleOptions: parseReviewStringArray(payload.titleOptions),
    figureTableSuggestions: parseReviewQualitySummaryArray(payload, "figureTableSuggestions"),
    modificationNotes: parseReviewQualitySummaryArray(payload, "modificationNotes"),
    missingInformation: parseReviewQualitySummaryArray(payload, "missingInformation"),
  };

  const revisedSections = Array.isArray(payload.revisedSections)
    ? payload.revisedSections
    : (Array.isArray(payload.sections) ? payload.sections : []);
  const replacements = new Map<string, string>();
  for (const item of revisedSections) {
    const title = cleanReviewTitle((item as Record<string, unknown>)?.title, "");
    const replacement = cleanReviewMultilineText((item as Record<string, unknown>)?.content, "", 120000);
    if (title && replacement) replacements.set(normalizeReviewSectionName(title), replacement);
  }
  let revisedContent = replaceReviewDocumentSections(content, replacements);
  if (isUsableReviewRecommendedTitle(review.recommendedTitle || "")) {
    revisedContent = replaceReviewDocumentTitle(revisedContent, review.recommendedTitle || "");
  }
  return {
    review,
    revisedContent: revisedContent !== content ? revisedContent : undefined,
  };
}

async function runReviewWriterQualityGate(
  content: string,
  input: ReviewWriterGenerationInput,
  usedReferences: ReviewWriterEvidence[] = [],
  onProgress?: (message: string, progress: number, step: string) => void,
  shouldStop?: () => boolean
): Promise<{ content: string; review: ReviewWriterQualityReviewResult }> {
  const maxRounds = clampReviewInteger(process.env.REVIEW_WRITER_QUALITY_MAX_ROUNDS, 3, 1, 10);
  const targetScore = clampReviewInteger(process.env.REVIEW_WRITER_QUALITY_TARGET_SCORE, 85, 60, 95);
  const minImprovement = clampReviewInteger(process.env.REVIEW_WRITER_QUALITY_MIN_IMPROVEMENT, 2, 0, 20);
  let currentContent = content;
  let latestReview: ReviewWriterQualityReviewResult | null = null;
  let bestContent = content;
  let bestReview: ReviewWriterQualityReviewResult | null = null;
  let stoppedReason = "";

  for (let round = 1; round <= maxRounds; round++) {
    throwIfReviewWriterStopped(shouldStop);
    onProgress?.(`终稿级质量控制第 ${round}/${maxRounds} 轮：评审 AI 正在判断论文类型、检查证据和工具痕迹，并生成问题章节修改稿（自动精修目标 ${targetScore}/100，95 为高质量参考）`, 95, "quality-audit");
    const auditRevision = await auditAndReviseReviewWriterContent(currentContent, input, round, targetScore, usedReferences);
    latestReview = {
      ...auditRevision.review,
      targetScore,
    };
    latestReview.passed = latestReview.score >= targetScore && !isReviewBlockingVerdict(latestReview.verdict);
    throwIfReviewWriterStopped(shouldStop);
    const previousBestScore = bestReview?.score ?? -1;
    const improved = latestReview.score > previousBestScore;
    if (improved) {
      bestContent = currentContent;
      bestReview = {
        ...latestReview,
        bestScore: latestReview.score,
      };
    }

    if (latestReview.passed) {
      return { content: bestContent, review: bestReview || latestReview };
    }

    if (!improved && bestReview) {
      stoppedReason = `第 ${round} 轮得分 ${latestReview.score}/100 低于当前最高分 ${bestReview.score}/100，已回滚到最高分版本并停止盲改`;
      onProgress?.(stoppedReason, 96, "quality-rollback");
      break;
    }

    if (round > 1 && bestReview && latestReview.score - previousBestScore < minImprovement) {
      stoppedReason = `第 ${round} 轮仅提升 ${Math.max(0, latestReview.score - previousBestScore)} 分，低于最小提升 ${minImprovement} 分，已保留最高分版本`;
      onProgress?.(stoppedReason, 96, "quality-stagnant");
      break;
    }

    if (round >= maxRounds) break;

    const revised = auditRevision.revisedContent;
    if (!revised?.trim()) {
      stoppedReason = "评审 AI 未返回可用修改稿，已保留当前最高分版本";
      onProgress?.(stoppedReason, 96, "quality-revision-empty");
      break;
    }
    onProgress?.(`终稿级质量控制第 ${round} 轮得分 ${latestReview.score}/100，最高 ${(bestReview || latestReview).score}/100，评审 AI 已直接完成局部修改，准备复评`, 95, "quality-revision");
    currentContent = revised;
  }

  const finalReview = bestReview || latestReview || {
    passed: false,
    score: 0,
    verdict: "未完成质量审查",
    rounds: 0,
    reportMarkdown: "",
  };
  return {
    content: bestContent,
    review: {
      ...finalReview,
      passed: false,
      targetScore,
      bestScore: finalReview.score,
      stoppedReason: stoppedReason || `自动精修已结束，最高得分 ${finalReview.score}/100，未达到目标 ${targetScore}/100，已保留最高分版本`,
    },
  };
}

function parseReviewWriterGenerationInput(body: any): { input?: ReviewWriterGenerationInput; error?: string } {
  const writingProfileId = normalizeProjectWritingProfileId(body.writingProfileId || projectManager.getCurrentProject().writingProfileId);
  const profile = getProjectWritingProfile(writingProfileId);
  const topic = cleanReviewText(body.topic);
  const useAutoResearchContext = body.useAutoResearchContext === undefined ? true : parseReviewBoolean(body.useAutoResearchContext);
  if (!topic && !useAutoResearchContext) return { error: `请填写${profile.topicLabel}，或勾选“使用 Auto Research 结果”` };

  const config: ReviewWriterLlmConfig = {
    apiUrl: cleanReviewText(body.apiUrl, currentApiUrl || process.env.API_URL || ""),
    apiKey: cleanReviewText(body.apiKey, currentApiKey || process.env.API_KEY || ""),
    model: cleanReviewText(body.model, currentSecondaryModel || currentModel || "qwen3.5-plus"),
  };
  if (!config.apiUrl || !config.apiKey) {
    return { error: "请先在配置界面填写可用的 AI API" };
  }
  const librarySources = parseReviewLibrarySources(body.librarySources);
  if (librarySources.length === 0) {
    return { error: "请至少选择一个文献库" };
  }
  const citationStyle = parseReviewCitationStyle(body.citationStyle || body.inTextCitationStyle);
  const customCitationFormat = cleanReviewMultilineText(
    body.customCitationFormat || body.customInTextCitationFormat || body.inTextCitationFormat,
    "",
    1000
  );
  if (citationStyle === "custom" && !customCitationFormat) {
    return { error: "请选择“其他/自定义”文中引用格式后，填写想要的文中引用格式" };
  }
  const referenceFormat = cleanReviewMultilineText(body.referenceFormat || body.targetReferenceFormat, "", 3000);
  const inTextCitationFormat = buildReviewCitationFormatInstruction(citationStyle, customCitationFormat);
  const journalStyleIds = parseReviewJournalStyleIds(body.journalStyleIds || body.targetJournalStyleIds);

  return {
    input: {
      writingProfileId,
      topic,
      userRequirements: cleanReviewText(body.userRequirements),
      config,
      userId: cleanReviewText(body.userId, "web-user") || "web-user",
      wordCount: clampReviewInteger(body.wordCount, 4000, 800, 20000),
      language: cleanReviewText(body.language, "en") === "zh" ? "zh" : "en",
      topK: clampReviewInteger(body.topK, 20, 5, 20),
      librarySources,
      useCodexCli: body.useCodexCli === undefined ? true : parseReviewBoolean(body.useCodexCli),
      useLongTermMemory: parseReviewBoolean(body.useLongTermMemory),
      useExperimentMaterials: parseReviewBoolean(body.useExperimentMaterials),
      useAutoResearchContext,
      referenceFormat,
      citationStyle,
      customCitationFormat,
      inTextCitationFormat,
      journalStyleIds,
    },
  };
}

async function hydrateReviewWriterInputFromAutoResearch(input: ReviewWriterGenerationInput): Promise<ReviewWriterGenerationInput> {
  if (input.topic.trim() || !input.useAutoResearchContext) return input;
  const currentProject = projectManager.getCurrentProject();
  const state = await autoResearchManager.getState(sanitizeUserId(input.userId), {
    projectId: currentProject.projectId || "current-workspace",
    projectName: currentProject.name || "当前工作区",
    writingProfileId: currentProject.writingProfileId,
    writingProfileLabel: currentProject.writingProfileLabel,
  });
  const latestReport = Array.isArray(state.finalReports) ? state.finalReports[0] : undefined;
  const blueprint = latestReport?.paperWritingBlueprint;
  const topic = cleanReviewText(
    latestReport?.topic
    || blueprint?.recommendedTitle
    || state.task?.topic
    || state.task?.goal
    || state.task?.title
  ).slice(0, 500);
  if (!topic) {
    throw new Error("已勾选使用 Auto Research 结果，但没有找到可用的 Auto Research 主题或最终报告；请先运行 Auto Research，或手动填写主题");
  }
  const blueprintRequirements = blueprint
    ? [
        "使用 Auto Research 论文写作蓝图作为硬约束：",
        `推荐题目：${blueprint.recommendedTitle || ""}`,
        `推荐论文类型：${blueprint.paperType || ""}`,
        `中心论点：${blueprint.centralArgument || ""}`,
        blueprint.coreScientificQuestions?.length ? `核心科学问题：${blueprint.coreScientificQuestions.join("；")}` : "",
        blueprint.supportedClaims?.length ? `可支持结论：${blueprint.supportedClaims.join("；")}` : "",
        blueprint.claimsToAvoid?.length ? `不能写的结论：${blueprint.claimsToAvoid.join("；")}` : "",
        blueprint.requiredFiguresTables?.length ? `必须增加的图表：${blueprint.requiredFiguresTables.join("；")}` : "",
      ].filter(Boolean).join("\n")
    : "";
  return {
    ...input,
    topic,
    userRequirements: [input.userRequirements, blueprintRequirements].filter(Boolean).join("\n\n"),
  };
}

function updateReviewWriterJob(
  job: ReviewWriterJob,
  patch: Partial<Pick<ReviewWriterJob, "status" | "progress" | "step" | "message" | "error" | "result">>
): void {
  Object.assign(job, patch);
  job.updatedAt = new Date().toISOString();
  if (patch.message) {
    job.logs.push(`${new Date().toLocaleTimeString("zh-CN", { hour12: false })} ${patch.message}`);
    job.logs = job.logs.slice(-60);
  }
}

function serializeReviewWriterJob(job: ReviewWriterJob): ReviewWriterJob {
  return {
    ...job,
    logs: [...job.logs],
  };
}

function createReviewWriterJob(input: ReviewWriterGenerationInput): ReviewWriterJob {
  const now = new Date().toISOString();
  const jobId = `review_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const profile = getProjectWritingProfile(input.writingProfileId);
  const job: ReviewWriterJob = {
    jobId,
    userId: input.userId,
    writingProfileId: profile.id,
    writingProfileLabel: profile.label,
    topic: input.topic,
    userRequirements: input.userRequirements,
    wordCount: input.wordCount,
    librarySources: input.librarySources,
    useCodexCli: input.useCodexCli,
    useLongTermMemory: input.useLongTermMemory,
    useExperimentMaterials: input.useExperimentMaterials,
    useAutoResearchContext: input.useAutoResearchContext,
    referenceFormat: input.referenceFormat,
    citationStyle: input.citationStyle,
    inTextCitationFormat: input.inTextCitationFormat,
    journalStyleIds: [...input.journalStyleIds],
    status: "queued",
    progress: 0,
    step: "queued",
    message: `任务已创建，等待开始规划${profile.shortLabel}`,
    logs: [],
    startedAt: now,
    updatedAt: now,
  };
  reviewWriterJobs.set(jobId, job);
  reviewWriterJobInputs.set(jobId, input);
  updateReviewWriterJob(job, { message: job.message });
  return job;
}

function getLatestReviewWriterJob(userId: string): ReviewWriterJob | null {
  const jobs = Array.from(reviewWriterJobs.values())
    .filter((job) => job.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return jobs[0] || null;
}

function getReviewWriterArsReportKey(mode: AcademicResearchMode): ReviewWriterArsReportKey | null {
  switch (mode) {
    case "pipeline-gate":
      return "pipelineGate";
    case "research-plan":
      return "researchPlan";
    case "citation-integrity":
      return "citationIntegrity";
    case "multi-review":
      return "multiReview";
    default:
      return null;
  }
}

function compactReviewWriterArsText(value: string, maxLength = 1200): string {
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}\n...[truncated]` : cleaned;
}

function summarizeReviewWriterArsReport(result: AcademicResearchRunResult): ReviewWriterArsReportSummary {
  return {
    mode: result.mode,
    provider: result.provider,
    fallbackAttempts: result.fallbackAttempts.slice(0, 3),
    contentPreview: compactReviewWriterArsText(result.content, 1600),
  };
}

function buildReviewWriterArsInstruction(input: ReviewWriterGenerationInput): string {
  const profile = getProjectWritingProfile(input.writingProfileId);
  return [
    `项目主题: ${profile.label}`,
    `文稿类型: ${profile.documentType}`,
    input.userRequirements,
    `一键写作目标字数: ${input.wordCount}`,
    `语言: ${input.language}`,
    `文献库来源: ${formatReviewLibrarySourcesForUser(input.librarySources)}`,
    `Auto Research 上游结果: ${input.useAutoResearchContext ? "enabled" : "disabled"}`,
    `文中引用格式: ${input.inTextCitationFormat}`,
    input.referenceFormat ? `文末参考文献格式要求: ${input.referenceFormat}` : "",
    input.journalStyleIds.length > 0 ? `目标期刊风格 ID: ${input.journalStyleIds.join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function buildReviewWriterArsQualityContext(reports: ReviewWriterArsRawReports): string {
  const entries = [
    reports.citationIntegrity ? `## ARS Citation Integrity\n${compactReviewWriterArsText(reports.citationIntegrity.content, 9000)}` : "",
    reports.multiReview ? `## ARS Multi-Review\n${compactReviewWriterArsText(reports.multiReview.content, 9000)}` : "",
    reports.pipelineGate ? `## ARS Pipeline Gate\n${compactReviewWriterArsText(reports.pipelineGate.content, 5000)}` : "",
  ].filter(Boolean);
  if (entries.length === 0) return "";
  return `以下是 Academic Research Skills 自动质量闸门报告。终稿审查和返修必须优先处理其中的引用完整性、强断言、范围漂移和多审稿人共识问题，但不得新增证据包中没有的引用或数据。\n\n${entries.join("\n\n")}`;
}

function buildReviewWriterArsWarnings(reports: ReviewWriterArsReports, failedModes: string[]): string[] {
  const successful = Object.values(reports)
    .filter((report): report is ReviewWriterArsReportSummary => Boolean(report))
    .map((report) => `ARS ${report.mode} 已执行：${report.provider}`);
  return [...successful, ...failedModes.map((mode) => `ARS ${mode} 执行失败，已按原一键写作流程继续`)];
}

async function runReviewWriterArsSafely(
  mode: AcademicResearchMode,
  input: ReviewWriterGenerationInput,
  extra: {
    currentPhase: string;
    supplementalContext?: string;
    content?: string;
    references?: unknown[];
  }
): Promise<AcademicResearchRunResult | undefined> {
  const key = getReviewWriterArsReportKey(mode);
  if (!key) return undefined;
  try {
    const profile = getProjectWritingProfile(input.writingProfileId);
    const researchContext = [
      `项目主题: ${profile.label}`,
      `文稿类型: ${profile.documentType}`,
      `章节模板: ${profile.sections.map((section) => `${section.title}(${section.purpose})`).join("; ")}`,
      input.userRequirements,
      extra.supplementalContext,
    ].filter(Boolean).join("\n\n").slice(0, 24000);
    const topicSkillContent = await getReviewWriterCloudPrompt('auto_research_topic_content_skill', AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL);
    const result = await runAcademicResearchSkill({
      mode,
      userId: input.userId,
      topic: input.topic,
      targetJournal: input.journalStyleIds.length > 0 ? input.journalStyleIds.join(", ") : undefined,
      paperType: profile.documentType,
      currentPhase: extra.currentPhase,
      researchContext,
      content: extra.content,
      references: extra.references,
      userInstruction: buildReviewWriterArsInstruction(input),
      topicSkillContent,
    });
    logger.info(`[ReviewWriter] ARS ${mode} completed via ${result.provider}`);
    return result;
  } catch (error) {
    const message = (error as Error)?.message || String(error);
    logger.warn(`[ReviewWriter] ARS ${mode} failed; continuing one-click writer: ${message}`);
    return undefined;
  }
}

async function runReviewWriterGeneration(
  input: ReviewWriterGenerationInput,
  onProgress?: (message: string, progress: number, step: string) => void,
  shouldStop?: () => boolean
): Promise<ReviewWriterGenerationResult> {
  const progress = (message: string, value: number, step: string) => {
    onProgress?.(message, Math.max(0, Math.min(100, Math.round(value))), step);
  };

  throwIfReviewWriterStopped(shouldStop);
  const libraryLabel = formatReviewLibrarySourcesForUser(input.librarySources);
  const writingProfile = getProjectWritingProfile(input.writingProfileId);
  const journalStyleLabel = input.journalStyleIds.length > 0 ? input.journalStyleIds.join(", ") : "latest";
  logger.info(`[ReviewWriter] Generate ${writingProfile.id} request topic="${input.topic}", user=${input.userId}, wordCount=${input.wordCount}, libraries=${libraryLabel}, journalStyles=${journalStyleLabel}, citation="${input.inTextCitationFormat}", referenceFormat=${input.referenceFormat ? "custom" : "default"}, codexFirst=${input.useCodexCli}, autoResearch=${input.useAutoResearchContext}`);
  const longTermMemoryContext = input.useLongTermMemory
    ? await buildReviewLongTermMemoryContext(input.userId)
    : "";
  const experimentMaterialsContext = input.useExperimentMaterials
    ? await buildReviewExperimentMaterialsContext(input.userId, writingProfile)
    : "";
  const autoResearchContext = input.useAutoResearchContext
    ? await buildReviewAutoResearchContext(input.userId)
    : "";
  const baseSupplementalContext = [autoResearchContext, longTermMemoryContext, experimentMaterialsContext].filter(Boolean).join("\n\n");
  const arsRawReports: ReviewWriterArsRawReports = {};
  const arsReports: ReviewWriterArsReports = {};
  const arsFailedModes: string[] = [];
  if (input.useAutoResearchContext) {
    progress(
      autoResearchContext
        ? "已启用 Auto Research 上游结果：最新报告、研究 Wiki、引用审计和证据对象会参与提纲规划、逐句写作和质量审查"
        : "已启用 Auto Research 上游结果，但当前没有可用报告/Wiki/审计；本次将按原一键写作流程继续",
      2,
      "auto-research-context"
    );
  }
  if (input.useLongTermMemory) {
    progress("已启用跨会话长期记忆：完整内容保存在本地，单次 AI 调用会按当前章节/句子自动选取相关片段以避免上下文不足", 2, "memory");
  }
  if (input.useExperimentMaterials) {
    progress(`已启用${writingProfile.shortLabel}项目资料：完整内容保存在本地，单次 AI 调用会按当前章节/句子自动选取相关片段以避免上下文不足`, 2, "experiment-materials");
  }
  if (input.useCodexCli) {
    progress("已启用 Codex CLI 优先：提纲规划和逐句写作会先调用 Codex；终稿质检/返修会启动新的 Codex CLI 长任务，只有未检测到 Codex 时才降级小牛马", 2, "codex-cli");
  }
  progress(
    input.journalStyleIds.length > 0
      ? `目标期刊风格已选择 ${input.journalStyleIds.length} 个：每个章节写作时会把对应章节 skill 和已选期刊风格一起发送给 AI`
      : "目标期刊风格未手动选择：每个章节写作时会把对应章节 skill 和最新分析的期刊风格一起发送给 AI（如有）",
    2,
    "journal-style"
  );
  progress(`引用格式已设置：文中引用 ${input.inTextCitationFormat}${input.referenceFormat ? "；文末参考文献按用户输入的目标期刊格式整理" : "；文末参考文献使用默认格式整理"}`, 2, "citation-format");
  throwIfReviewWriterStopped(shouldStop);

  const runArsForReviewWriter = async (
    mode: AcademicResearchMode,
    key: ReviewWriterArsReportKey,
    currentPhase: string,
    progressMessage: string,
    progressValue: number,
    content?: string,
    references?: unknown[]
  ) => {
    throwIfReviewWriterStopped(shouldStop);
    progress(progressMessage, progressValue, `ars-${mode}`);
    const result = await runReviewWriterArsSafely(mode, input, {
      currentPhase,
      supplementalContext: baseSupplementalContext,
      content,
      references,
    });
    throwIfReviewWriterStopped(shouldStop);
    if (result) {
      arsRawReports[key] = result;
      arsReports[key] = summarizeReviewWriterArsReport(result);
    } else {
      arsFailedModes.push(mode);
    }
  };

  await runArsForReviewWriter("pipeline-gate", "pipelineGate", "research-to-planning", `正在执行 ARS pipeline-gate：确认${writingProfile.shortLabel}是否具备进入规划和写作的条件`, 3);
  await runArsForReviewWriter("research-plan", "researchPlan", "research", "正在执行 ARS research-plan：先生成检索策略、纳排标准和文献矩阵字段，再进入逐句检索", 4);

  const arsPlanningContext = [
    arsRawReports.pipelineGate ? `## ARS Pipeline Gate\n${compactReviewWriterArsText(arsRawReports.pipelineGate.content, 6000)}` : "",
    arsRawReports.researchPlan ? `## ARS Research Plan\n${compactReviewWriterArsText(arsRawReports.researchPlan.content, 9000)}` : "",
  ].filter(Boolean).join("\n\n");
  const supplementalContext = [
    baseSupplementalContext,
    arsPlanningContext ? `以下是 Academic Research Skills 写作前规划增强信息。生成提纲、检索词和逐句写作时应优先参考，但不得编造未提供的文献或数据。\n\n${arsPlanningContext}` : "",
  ].filter(Boolean).join("\n\n");

  progress(`正在让 AI 根据 ${input.wordCount} 字目标规划${writingProfile.shortLabel}章节、段落和句子`, 5, "outline");

  const outline = await generateReviewOutline(
    input.topic,
    input.config,
    input.wordCount,
    input.language,
    input.librarySources,
    input.useCodexCli,
    input.userRequirements,
    supplementalContext,
    writingProfile
  );
  throwIfReviewWriterStopped(shouldStop);

  const plannedSentences = countReviewSentences(outline);
  progress(`提纲已生成：${outline.sections.length} 个章节，${plannedSentences} 个逐句检索写作单元`, 10, "outline-ready");

  const allReferences: ReviewWriterEvidence[] = [];
  const citationRegistry = new Map<string, number>();
  const retrievalWarnings: string[] = [];
  const sectionQualityNotes: string[] = [];
  const sentenceProvenanceLedger: ReviewWriterSentenceProvenance[] = [];
  let totalSentences = 0;
  const safeTotal = Math.max(1, plannedSentences);

  for (let sectionIndex = 0; sectionIndex < outline.sections.length; sectionIndex++) {
    const section = outline.sections[sectionIndex];
    section.skillName = section.skillName || inferReviewSkillName(section.title, sectionIndex, outline.sections.length, writingProfile);
    progress(`正在加载「${section.title}」对应的写作 skill 和目标风格`, 10 + (totalSentences / safeTotal) * 80, "section-style");
    const skillGuide = await loadReviewWritingSkillCloudFirst(section.skillName, writingProfile);
    const journalStyleGuide = loadReviewJournalStyleGuide(section.skillName, input.userId, input.journalStyleIds);
    const sectionReferences: ReviewWriterEvidence[] = [];

    for (let paragraphIndex = 0; paragraphIndex < section.paragraphs.length; paragraphIndex++) {
      const paragraph = section.paragraphs[paragraphIndex];
      const writtenSentences: string[] = [];
      for (let sentenceIndex = 0; sentenceIndex < paragraph.sentences.length; sentenceIndex++) {
        throwIfReviewWriterStopped(shouldStop);
        const sentence = paragraph.sentences[sentenceIndex];
        const sentenceNo = totalSentences + 1;
        const baseProgress = 12 + (totalSentences / safeTotal) * 78;
        const queryVariants = buildReviewSearchQueries(sentence, input.topic);
        const query = formatRetrievalQueryVariants(queryVariants);
        sentence.searchQuery = query;
        progress(
          `第 ${sentenceNo}/${safeTotal} 句：正在生成检索词并检索 ${libraryLabel}\n检索词：${query}`,
          baseProgress,
          "retrieval"
        );

        const evidenceClaimText = [
          sentence.purpose,
          sentence.plannedContent,
        ].filter(Boolean).join("\n");
        const retrieval = await retrieveReviewEvidence(
          queryVariants,
          input.userId,
          Math.max(input.topK, 12),
          input.librarySources,
          evidenceClaimText,
          input.config
        );
        throwIfReviewWriterStopped(shouldStop);
        const selectedEvidence = assignReviewEvidenceCitations(
          selectReviewEvidenceForSentence(retrieval.evidence),
          citationRegistry,
          input.citationStyle,
          input.customCitationFormat
        );
        retrievalWarnings.push(...retrieval.warnings);
        sentence.candidateEvidenceCount = retrieval.evidence.length;
        sentence.evidenceCount = selectedEvidence.length;
        const supportSummary = summarizeClaimEvidenceJudgments(retrieval.evidence as unknown as any[]);
        const hiddenByQualityGate = countClaimEvidenceHiddenByQualityGate(retrieval.evidence as unknown as any[]);
        allReferences.push(...selectedEvidence);
        sectionReferences.push(...selectedEvidence);
        progress(
          `第 ${sentenceNo}/${safeTotal} 句：已检索到 ${retrieval.evidence.length} 条候选证据，证据支持判断：支持 ${supportSummary.supports}、仅相关 ${supportSummary.related}、反向 ${supportSummary.contradicts}、无关 ${supportSummary.irrelevant}；动态质量门控隐藏 ${hiddenByQualityGate} 条，筛选出 ${selectedEvidence.length} 篇用于写句`,
          baseProgress + 2,
          "sentence-writing"
        );

        sentence.writtenSentence = await writeReviewSentence({
          topic: input.topic,
          userRequirements: input.userRequirements,
          sectionTitle: section.title,
          paragraphTitle: paragraph.title,
          sentence,
          evidence: selectedEvidence,
          skillGuide,
          journalStyleGuide,
          longTermMemoryContext: supplementalContext,
          language: input.language,
          config: input.config,
          useCodexCli: input.useCodexCli,
          inTextCitationFormat: input.inTextCitationFormat,
        });
        sentenceProvenanceLedger.push({
          sectionId: section.id,
          sectionTitle: section.title,
          paragraphId: paragraph.id,
          paragraphTitle: paragraph.title,
          sentenceId: sentence.id,
          plannedContent: sentence.plannedContent,
          purpose: sentence.purpose,
          searchQuery: sentence.searchQuery || query,
          writtenSentence: sentence.writtenSentence,
          evidence: selectedEvidence,
        });
        throwIfReviewWriterStopped(shouldStop);
        writtenSentences.push(sentence.writtenSentence);
        totalSentences++;
        progress(
          `第 ${totalSentences}/${safeTotal} 句完成：${sentence.writtenSentence.slice(0, 160)}`,
          12 + (totalSentences / safeTotal) * 78,
          "sentence-done"
        );
      }
      paragraph.text = writtenSentences.join(" ");
      progress(
        `已完成「${section.title}」第 ${paragraphIndex + 1}/${section.paragraphs.length} 段`,
        12 + (totalSentences / safeTotal) * 78,
        "paragraph-done"
      );
    }
    section.text = section.paragraphs.map((paragraph) => paragraph.text || "").filter(Boolean).join("\n\n");
    if (section.text.trim()) {
      throwIfReviewWriterStopped(shouldStop);
      progress(`正在对「${section.title}」做章节级小审查，只发送本章节和本章节引用证据`, 12 + (totalSentences / safeTotal) * 78, "section-quality");
      try {
        const sectionReview = await reviewAndReviseReviewSection({
          topic: input.topic,
          userRequirements: input.userRequirements,
          sectionTitle: section.title,
          sectionText: section.text,
          evidence: deduplicateReviewEvidenceInUseOrder(sectionReferences),
          journalStyleGuide,
          supplementalContext,
          language: input.language,
          config: input.config,
          useCodexCli: input.useCodexCli,
        });
        section.text = sectionReview.text;
        if (sectionReview.score > 0) {
          sectionQualityNotes.push(`${section.title}: ${sectionReview.score}/100${sectionReview.issues.length ? `，${sectionReview.issues.slice(0, 2).join("；")}` : ""}`);
          progress(`「${section.title}」章节级小审查完成：${sectionReview.score}/100`, 12 + (totalSentences / safeTotal) * 78, "section-quality-done");
        }
      } catch (error) {
        const message = (error as Error)?.message || String(error);
        logger.warn(`[ReviewWriter] Section quality pass failed for ${section.title}: ${message}`);
        sectionQualityNotes.push(`${section.title}: 章节级小审查失败，已保留原章节`);
        progress(`「${section.title}」章节级小审查失败，已保留原章节继续生成`, 12 + (totalSentences / safeTotal) * 78, "section-quality-failed");
      }
    }
  }

  throwIfReviewWriterStopped(shouldStop);
  progress("论文正文逐句生成完成，正在整理参考文献并准备质量审查", 94, "finalizing");
  const uniqueReferences = deduplicateReviewEvidenceInUseOrder(allReferences);
  const formattedReferences = await formatReviewReferencesForOutput(uniqueReferences, input);
  let content = buildReviewWriterDocument(outline, formattedReferences);
  await runArsForReviewWriter(
    "citation-integrity",
    "citationIntegrity",
    "integrity",
    "正在执行 ARS citation-integrity：检查文内引用、参考文献和关键论断是否匹配",
    94,
    content,
    uniqueReferences
  );
  await runArsForReviewWriter(
    "multi-review",
    "multiReview",
    "review",
    "正在执行 ARS multi-review：模拟方法学、领域、逻辑挑战者和主编多视角审稿",
    95,
    content,
    uniqueReferences
  );
  const qualityTargetScore = clampReviewInteger(process.env.REVIEW_WRITER_QUALITY_TARGET_SCORE, 85, 60, 95);
  const arsQualityContext = buildReviewWriterArsQualityContext(arsRawReports);
  const qualityInput: ReviewWriterGenerationInput = arsQualityContext
    ? {
        ...input,
        userRequirements: [input.userRequirements, arsQualityContext].filter(Boolean).join("\n\n"),
      }
    : input;
  progress(`正在执行终稿级质量控制；系统会判断论文类型、清理 AI/工具痕迹、检查引用证据和论文主线，低于 ${qualityTargetScore} 分时直接返回问题章节修改稿`, 95, "quality-gate");
  const qualityGate = await runReviewWriterQualityGate(content, qualityInput, uniqueReferences, progress, shouldStop);
  content = qualityGate.content;
  const citationVerification = annotateReviewCitationVerificationMarkers(content, uniqueReferences);
  const wikiArgumentNotes = collectReviewWikiArgumentNotes(
    citationVerification.content,
    uniqueReferences,
    citationVerification.notes
  );
  content = appendReviewCitationVerificationNotes(citationVerification.content, wikiArgumentNotes);
  const finalStylePass = stylePass(content);
  if (!finalStylePass.ok) {
    qualityGate.review.modificationNotes = [
      ...(qualityGate.review.modificationNotes || []),
      ...finalStylePass.issues.map(issue => `style_pass ${issue.code}: ${issue.note}`),
    ].slice(0, 20);
  }
  const userDir = getUserUploadDir(input.userId);
  const draftDir = path.join(userDir, "drafts");
  if (!fs.existsSync(draftDir)) fs.mkdirSync(draftDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  const fileName = `paper_${timestamp}.tex`;
  const filePath = path.join(draftDir, fileName);
  fs.writeFileSync(filePath, content, "utf-8");

  const result: ReviewWriterGenerationResult = {
    success: true,
    writingProfileId: writingProfile.id,
    writingProfileLabel: writingProfile.label,
    outline,
    content,
    fileName,
    filePath,
    totalSentences,
    referenceCount: uniqueReferences.length,
    wordCount: input.wordCount,
    warnings: Array.from(new Set([
        ...retrievalWarnings,
        ...sectionQualityNotes,
        ...buildReviewWriterArsWarnings(arsReports, arsFailedModes),
        finalStylePass.ok
          ? "Literature Review style_pass 通过：未发现明显过程说明、长标题或 DOI markdown 风险"
          : `Literature Review style_pass 提示 ${finalStylePass.issues.length} 个风格/结构问题，已写入 qualityReview.modificationNotes`,
        input.useAutoResearchContext && autoResearchContext ? "已调用 Auto Research 最新报告、研究 Wiki、引用审计和证据对象作为上游写作上下文" : "",
        qualityGate.review.passed
          ? `终稿质量审查达到自动精修目标：${qualityGate.review.score}/100；判定：${qualityGate.review.verdict}`
          : `终稿质量审查未达到自动精修目标，已保留最高分版本：${qualityGate.review.bestScore || qualityGate.review.score}/100；${qualityGate.review.stoppedReason || qualityGate.review.verdict}`,
        citationVerification.notes.length > 0
          ? `已生成 ${citationVerification.notes.length} 条引用核查编号，并在文末追加“引用核查清单”`
          : "",
      ].filter((item): item is string => typeof item === "string" && item.trim().length > 0))).slice(0, 18),
    qualityReview: qualityGate.review,
    arsReports,
  };
  const researchSession = await recordReviewWriterResearchSession(
    input,
    result,
    sentenceProvenanceLedger,
    uniqueReferences
  ).catch((error) => {
    logger.warn("[ResearchSession] Failed to record review-writer provenance:", error);
    return undefined;
  });
  if (researchSession) {
    result.researchSession = researchSession;
  }
  progress(
    qualityGate.review.passed
      ? `论文已完成并达到自动精修目标：${qualityGate.review.score}/100；${outline.sections.length} 个章节，${totalSentences} 个逐句检索写作单元`
      : `论文已完成，自动精修未达目标但已保留最高分版本：${qualityGate.review.bestScore || qualityGate.review.score}/100；${outline.sections.length} 个章节，${totalSentences} 个逐句检索写作单元`,
    100,
    "completed"
  );
  return result;
}

async function recordReviewWriterResearchSession(
  input: ReviewWriterGenerationInput,
  result: ReviewWriterGenerationResult,
  sentenceLedger: ReviewWriterSentenceProvenance[],
  references: ReviewWriterEvidence[]
): Promise<NonNullable<ReviewWriterGenerationResult["researchSession"]>> {
  const uniqueReviewReferences = deduplicateReviewEvidenceInUseOrder(references);
  const literatureReviewTrace = await buildLiteratureReviewToolTrace(
    uniqueReviewReferences.map(mapReviewEvidenceToResearchSource),
    {
      maxVerify: 30,
      maxExpand: 6,
      queries: sentenceLedger.map(item => item.searchQuery).filter(Boolean),
      maxOpenAlexQueries: 6,
    }
  );
  const paragraphGroups = new Map<string, ReviewWriterSentenceProvenance[]>();
  for (const item of sentenceLedger) {
    const key = `${item.sectionId}::${item.paragraphId}`;
    const current = paragraphGroups.get(key) || [];
    current.push(item);
    paragraphGroups.set(key, current);
  }

  const paragraphRecordIds: string[] = [];
  for (const [key, items] of paragraphGroups) {
    const first = items[0];
    const paragraphText = items.map(item => item.writtenSentence).filter(Boolean).join(" ");
    const sources = deduplicateReviewWriterResearchSources(items.flatMap(item => item.evidence.map(mapReviewEvidenceToResearchSource)));
    const citations = deduplicateReviewWriterResearchCitations(items.flatMap(item => item.evidence.map(mapReviewEvidenceToResearchCitation)));
    const provenance = await researchSessionManager.appendProvenance({
      userId: input.userId,
      sessionTitle: `一键写作：${input.topic}`,
      sessionTopic: input.topic,
      targetType: 'paragraph',
      targetId: key,
      operation: 'review-writer.write-paragraph',
      sourceModule: 'review-writer',
      input: {
        sectionTitle: first.sectionTitle,
        paragraphTitle: first.paragraphTitle,
        sentencePlans: items.map(item => ({
          sentenceId: item.sentenceId,
          purpose: item.purpose,
          plannedContent: item.plannedContent,
          searchQuery: item.searchQuery,
        })),
      },
      output: {
        paragraphText,
        writtenSentences: items.map(item => item.writtenSentence),
      },
      query: items.map(item => item.searchQuery).filter(Boolean).join('\n'),
      model: input.config.model,
      sources,
      citations,
      metadata: {
        sectionId: first.sectionId,
        sectionTitle: first.sectionTitle,
        paragraphId: first.paragraphId,
        paragraphTitle: first.paragraphTitle,
        evidenceCount: sources.length,
        citationCount: citations.length,
      },
    });
    paragraphRecordIds.push(provenance.record.id);
  }

  const citationRecordIds: string[] = [];
  for (const ref of uniqueReviewReferences) {
    const provenance = await researchSessionManager.appendProvenance({
      userId: input.userId,
      targetType: 'citation',
      targetId: ref.id || ref.citation || ref.title,
      operation: 'review-writer.bind-citation',
      sourceModule: 'review-writer',
      input: {
        topic: input.topic,
        citationStyle: input.citationStyle,
        inTextCitationFormat: input.inTextCitationFormat,
      },
      output: {
        citation: ref.citation,
        referenceNumber: ref.referenceNumber,
        title: ref.title,
        doi: ref.doi,
      },
      model: input.config.model,
      sources: [mapReviewEvidenceToResearchSource(ref)],
      citations: [mapReviewEvidenceToResearchCitation(ref)],
      metadata: {
        source: ref.source,
        qualityGate: ref.qualityGate,
        traceSnippets: ref.traceSnippets,
        doiVerification: ref.doi ? literatureReviewTrace.doiVerification[ref.doi] : undefined,
        citationExpansion: ref.doi
          ? literatureReviewTrace.citationExpansion.find(item => item.doi === ref.doi)
          : undefined,
      },
    });
    citationRecordIds.push(provenance.record.id);
  }

  const writingArtifact = await researchSessionManager.appendArtifact({
    userId: input.userId,
    kind: 'writing',
    name: result.fileName,
    filePath: result.filePath,
    content: result.content,
    contentType: 'application/x-tex',
    input: {
      topic: input.topic,
      userRequirements: input.userRequirements,
      wordCount: input.wordCount,
      language: input.language,
      librarySources: input.librarySources,
      useLongTermMemory: input.useLongTermMemory,
      useExperimentMaterials: input.useExperimentMaterials,
      useAutoResearchContext: input.useAutoResearchContext,
      outline: result.outline,
    },
    provenanceRecordIds: [...paragraphRecordIds, ...citationRecordIds],
    metadata: {
      writingProfileId: result.writingProfileId,
      writingProfileLabel: result.writingProfileLabel,
      referenceCount: result.referenceCount,
      totalSentences: result.totalSentences,
      warnings: result.warnings,
      qualityReview: result.qualityReview,
      arsReports: result.arsReports,
      literatureReviewTrace,
    },
  });
  const review = await researchSessionManager.runReviewer(input.userId, writingArtifact.session.id, writingArtifact.artifact.id);
  return {
    sessionId: writingArtifact.session.id,
    writingArtifactId: writingArtifact.artifact.id,
    paragraphProvenanceRecordIds: paragraphRecordIds,
    citationProvenanceRecordIds: citationRecordIds,
    reviewerReportId: review.report.id,
  };
}

function mapReviewEvidenceToResearchSource(evidence: ReviewWriterEvidence): ResearchSourceReference {
  const support = evidence.claimSupport || buildUncheckedClaimEvidenceJudgment('未记录证据支持判断。');
  return {
    id: evidence.id,
    sourceType: evidence.source === 'pdfWiki' ? 'pdf-wiki' : 'embedding',
    title: evidence.title,
    authors: evidence.authors,
    year: evidence.year,
    journal: evidence.journal,
    doi: evidence.doi,
    query: evidence.traceSnippets?.map(item => item.code || item.text).filter(Boolean).join('; '),
    score: evidence.score,
    supportRelation: support.relation,
    supportConfidence: support.confidence,
    evidenceSnippet: support.evidenceSnippets?.[0] || evidence.abstract,
    metadata: {
      citation: evidence.citation,
      referenceNumber: evidence.referenceNumber,
      source: evidence.source,
      qualityGate: evidence.qualityGate,
      originalScore: evidence.originalScore,
    },
  };
}

function mapReviewEvidenceToResearchCitation(evidence: ReviewWriterEvidence) {
  const support = evidence.claimSupport || buildUncheckedClaimEvidenceJudgment('未记录证据支持判断。');
  return {
    citationText: evidence.citation || `${evidence.authors} ${evidence.year}`,
    referenceId: evidence.id,
    title: evidence.title,
    doi: evidence.doi,
    supportRelation: support.relation,
    supportConfidence: support.confidence,
    evidenceSnippet: support.evidenceSnippets?.[0],
    metadata: {
      referenceNumber: evidence.referenceNumber,
      source: evidence.source,
    },
  };
}

function deduplicateReviewWriterResearchSources(sources: ResearchSourceReference[]): ResearchSourceReference[] {
  const seen = new Set<string>();
  const result: ResearchSourceReference[] = [];
  for (const source of sources) {
    const key = [source.sourceType, source.id, source.doi, source.title].filter(Boolean).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function deduplicateReviewWriterResearchCitations(citations: ReturnType<typeof mapReviewEvidenceToResearchCitation>[]): ReturnType<typeof mapReviewEvidenceToResearchCitation>[] {
  const seen = new Set<string>();
  const result: ReturnType<typeof mapReviewEvidenceToResearchCitation>[] = [];
  for (const citation of citations) {
    const key = [citation.citationText, citation.referenceId, citation.doi].filter(Boolean).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(citation);
  }
  return result;
}

function startReviewWriterBackgroundJob(job: ReviewWriterJob, input: ReviewWriterGenerationInput): void {
  setImmediate(() => {
    const currentJob = reviewWriterJobs.get(job.jobId);
    if (!currentJob) return;
    if (currentJob.stopRequested) {
      updateReviewWriterJob(currentJob, {
        status: "stopped",
        step: "stopped",
        message: "一键写作任务已停止",
      });
      return;
    }
    updateReviewWriterJob(currentJob, {
      status: "running",
      progress: 1,
      step: "start",
      message: "一键写论文任务已启动",
    });
    runReviewWriterGeneration(input, (message, progress, step) => {
      if (currentJob.stopRequested) return;
      updateReviewWriterJob(currentJob, {
        status: "running",
        progress,
        step,
        message,
      });
    }, () => !!currentJob.stopRequested)
      .then((result) => {
        if (currentJob.stopRequested) {
          updateReviewWriterJob(currentJob, {
            status: "stopped",
            step: "stopped",
            message: "一键写作任务已停止",
          });
          return;
        }
        updateReviewWriterJob(currentJob, {
          status: "completed",
          progress: 100,
          step: "completed",
          message: "论文生成完成，可以下载 Word、LaTeX、Markdown 和纯文本文件",
          result,
        });
      })
      .catch((error) => {
        if (error instanceof ReviewWriterStoppedError || currentJob.stopRequested) {
          updateReviewWriterJob(currentJob, {
            status: "stopped",
            step: "stopped",
            message: "一键写作任务已停止",
          });
          return;
        }
        logger.error("[ReviewWriter] Background job error:", error);
        updateReviewWriterJob(currentJob, {
          status: "error",
          step: "error",
          message: `论文生成失败：${(error as Error).message}`,
          error: (error as Error).message,
        });
      });
  });
}

app.post("/api/review-writer/start", async (req: Request, res: Response) => {
  const parsed = parseReviewWriterGenerationInput(req.body);
  if (!parsed.input) {
    res.json({ success: false, error: parsed.error || "参数错误" });
    return;
  }

  try {
    const input = await hydrateReviewWriterInputFromAutoResearch(parsed.input);
    await consumeCloudQuota('review_writer_quality_orchestration', 2500, {
      route: 'review-writer.start',
      userId: input.userId,
      wordCount: input.wordCount,
      useAutoResearchContext: input.useAutoResearchContext,
    });
    const job = createReviewWriterJob(input);
    res.json({ success: true, job: serializeReviewWriterJob(job) });
    startReviewWriterBackgroundJob(job, input);
  } catch (error) {
    res.json({ success: false, error: (error as Error).message || "一键写作任务启动失败" });
  }
});

app.get("/api/review-writer/progress/:jobId", (req: Request, res: Response) => {
  const job = reviewWriterJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: "未找到论文任务" });
    return;
  }
  res.json({ success: true, job: serializeReviewWriterJob(job) });
});

app.post("/api/review-writer/stop/:jobId", (req: Request, res: Response) => {
  const job = reviewWriterJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: "未找到论文任务" });
    return;
  }

  if (job.status === "completed" || job.status === "error" || job.status === "stopped") {
    res.json({ success: true, job: serializeReviewWriterJob(job) });
    return;
  }

  job.stopRequested = true;
  updateReviewWriterJob(job, {
    step: "stopping",
    message: "已收到停止请求，当前 AI 请求结束后会停止任务",
  });
  res.json({ success: true, job: serializeReviewWriterJob(job) });
});

app.post("/api/review-writer/restart/:jobId", async (req: Request, res: Response) => {
  const sourceJob = reviewWriterJobs.get(req.params.jobId);
  const sourceInput = reviewWriterJobInputs.get(req.params.jobId);
  if (!sourceJob || !sourceInput) {
    res.status(404).json({ success: false, error: "未找到可重启的论文任务" });
    return;
  }

  if (sourceJob.status === "queued" || sourceJob.status === "running") {
    sourceJob.stopRequested = true;
    updateReviewWriterJob(sourceJob, {
      step: "restarting",
      message: "正在停止旧任务并启动新任务",
    });
  }

  const restartedInput: ReviewWriterGenerationInput = {
    ...sourceInput,
    config: { ...sourceInput.config },
  };
  try {
    await consumeCloudQuota('review_writer_quality_orchestration', 1500, {
      route: 'review-writer.restart',
      userId: restartedInput.userId,
      previousJobId: sourceJob.jobId,
    });
    const newJob = createReviewWriterJob(restartedInput);
    res.json({ success: true, job: serializeReviewWriterJob(newJob), previousJob: serializeReviewWriterJob(sourceJob) });
    startReviewWriterBackgroundJob(newJob, restartedInput);
  } catch (error) {
    res.json({ success: false, error: (error as Error).message || "一键写作任务重启失败" });
  }
});

app.get("/api/review-writer/latest", (req: Request, res: Response) => {
  const userId = cleanReviewText(req.query.userId, "web-user") || "web-user";
  const job = getLatestReviewWriterJob(userId);
  res.json({ success: true, job: job ? serializeReviewWriterJob(job) : null });
});

app.post("/api/review-writer/generate", async (req: Request, res: Response) => {
  const parsed = parseReviewWriterGenerationInput(req.body);
  if (!parsed.input) {
    res.json({ success: false, error: parsed.error || "参数错误" });
    return;
  }

  try {
    const input = await hydrateReviewWriterInputFromAutoResearch(parsed.input);
    await consumeCloudQuota('review_writer_quality_orchestration', 2500, {
      route: 'review-writer.generate',
      userId: input.userId,
      wordCount: input.wordCount,
      useAutoResearchContext: input.useAutoResearchContext,
    });
    res.json(await runReviewWriterGeneration(input));
  } catch (error) {
    logger.error("[ReviewWriter] Generate error:", error);
    res.json({ success: false, error: (error as Error).message || "论文生成失败" });
  }
});

app.get("/api/review-writer/download/:jobId", (req: Request, res: Response) => {
  const job = reviewWriterJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: "未找到论文任务" });
    return;
  }

  const requestedUserId = typeof req.query.userId === "string" ? sanitizeUserId(req.query.userId) : "";
  if (requestedUserId && requestedUserId !== job.userId) {
    res.status(403).json({ success: false, error: "无权下载该论文任务文件" });
    return;
  }

  if (job.status !== "completed" || !job.result?.content?.trim()) {
    res.status(409).json({ success: false, error: "论文任务尚未完成，暂无可下载文件" });
    return;
  }

  const format = String(req.query.format || "docx").toLowerCase();
  const baseName = sanitizeReviewWriterDownloadFilename(
    job.result.outline?.title || job.topic || job.result.fileName || "paper-draft"
  );
  const content = job.result.content;

  if (format === "docx") {
    sendWordDraftDocx(res, content);
    return;
  }

  if (format === "tex" || format === "latex") {
    const filename = `${baseName}.tex`;
    setReviewWriterTextDownloadHeaders(res, "application/x-tex", filename);
    res.send(content);
    return;
  }

  if (format === "md" || format === "markdown") {
    const filename = `${baseName}.md`;
    setReviewWriterTextDownloadHeaders(res, "text/markdown", filename);
    res.send(convertReviewWriterLatexToMarkdown(content));
    return;
  }

  if (format === "txt") {
    const filename = `${baseName}.txt`;
    setReviewWriterTextDownloadHeaders(res, "text/plain", filename);
    res.send(convertReviewWriterLatexToPlainText(content));
    return;
  }

  res.status(400).json({ success: false, error: "不支持的下载格式" });
});

app.post("/api/review-writer/docx", (req: Request, res: Response) => {
  const content = typeof req.body.content === "string" ? req.body.content : "";
  if (!content.trim()) {
    res.status(400).json({ success: false, error: "内容为空，无法导出 Word" });
    return;
  }
  sendWordDraftDocx(res, content);
});

app.listen(port, async () => {
  logger.info(
    "ScholarClaw running at http://localhost:" + port + " (Model: " + primaryModel + ")"
  );
  if (process.env.NODE_ENV !== 'production') {
    console.log("");
    console.log("========================================");
    console.log("     ScholarClaw - 论文写作助手");
    console.log("========================================");
    console.log(" 打开浏览器访问：http://localhost:" + port);
    console.log(" AI 模型：" + primaryModel);
    console.log("========================================");
    console.log("");
  }

  // 启动时加载文献索引缓存（不阻塞服务器响应）
  // 5400+ 篇论文的索引构建可能耗时较长，异步执行不影响 /health 检查
  initializeLiteratureIndex().catch((err) => {
    logger.error('[Startup] Background literature index failed:', err);
  });
});

process.on('SIGINT', async () => {
  logger.info('[Server] Shutting down...');
  
  // 保存检索引擎索引
  try {
    const cacheDir = getIndexCacheDir('web-user');
    const stats = globalRetrievalEngine.getStatistics();
    if (stats.totalCount > 0) {
      globalRetrievalEngine.saveIndex(cacheDir);
      logger.info(`[Server] Saved index cache (${stats.totalCount} papers)`);
    }
  } catch (e) {
    logger.error('[Server] Failed to save index cache:', e);
  }
  
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('[Server] Shutting down...');
  
  // 保存检索引擎索引
  try {
    const cacheDir = getIndexCacheDir('web-user');
    const stats = globalRetrievalEngine.getStatistics();
    if (stats.totalCount > 0) {
      globalRetrievalEngine.saveIndex(cacheDir);
      logger.info(`[Server] Saved index cache (${stats.totalCount} papers)`);
    }
  } catch (e) {
    logger.error('[Server] Failed to save index cache:', e);
  }
  
  process.exit(0);
});

export default app;

// ============ 逐句检索写作 API ============

// 句子级文献检索
app.post("/api/sentence/search", async (req: Request, res: Response) => {
  const { sentences, userId } = req.body;
  
  if (!sentences || !Array.isArray(sentences) || sentences.length === 0) {
    res.json({ success: false, error: "请提供需要检索的句子数组" });
    return;
  }
  
  try {
    const safeUserId = sanitizeUserId(userId || "web-user");
    const userEngine = await retrievalEngineManager.getEngine(safeUserId);
    const literatureCount = userEngine.getDocumentCount();

    if (literatureCount === 0) {
      res.json({ success: false, error: "文献库为空，请先上传文献" });
      return;
    }
    
    logger.info(`[SentenceSearch] Searching references for ${sentences.length} sentences`);
    
    // 为每个句子检索文献
    const results: Record<string, any[]> = {};
    
    for (const sentence of sentences) {
      if (!sentence || typeof sentence !== 'string') continue;

      const variants = buildBilingualRetrievalQueries({ sentence, keywordsEn: [sentence] });
      const groups: any[][] = [];
      for (const variant of variants) {
        const queryResults = await userEngine.retrieve({
          query: variant.query,
          topK: 20,
          searchMode: 'hybrid',
        });
        const mapped = queryResults.results.map(doc => ({
          ...doc,
          retrievalPath: variant.label,
          retrievalLanguage: variant.language,
          retrievalQuery: variant.query,
        }));
        groups.push(filterRetrievedResultsForLanguage(mapped, variant.language, 5));
      }

      const unique = interleaveRetrievedResultGroups(groups, 5);

      results[sentence] = unique.map(result => ({
        title: result.title,
        author: result.author,
        year: result.year,
        journal: result.journal,
        doi: result.doi,
        abstract: result.abstract,
        score: result.combinedScore || result.score,
        retrievalPath: result.retrievalPath,
        retrievalQuery: result.retrievalQuery,
        citation: formatCitation(result as LitPaper)
      }));

      logger.info(`[SentenceSearch] "${sentence.substring(0, 30)}..." found ${unique.length} refs via ${formatRetrievalQueryVariants(variants)}`);
    }
    
    const researchSession = await recordSentenceSearchResearchProvenance({
      userId: safeUserId,
      sessionId: cleanOptionalResearchSessionId(req.body.researchSessionId),
      operation: "sentence.search",
      rawQuery: sentences.join("\n"),
      results,
      metadata: {
        totalSentences: sentences.length,
        literatureCount,
      },
    }).catch((error) => {
      logger.warn("[ResearchSession] Failed to record sentence search provenance:", error);
      return undefined;
    });

    res.json({ 
      success: true, 
      results,
      totalSentences: sentences.length,
      literatureCount,
      researchSession,
    });
    
  } catch (error) {
    logger.error("[SentenceSearch] Error:", error);
    res.json({ success: false, error: "检索失败: " + (error as Error).message });
  }
});

app.post("/api/sentence/claim-match", async (req: Request, res: Response) => {
  try {
    const rawQuery = String(req.body.query || req.body.sentence || '').trim();
    const safeUserId = sanitizeUserId(req.body.userId || "web-user");
    const topK = Math.min(20, Math.max(1, Math.floor(Number(req.body.topK || 6))));

    if (!rawQuery) {
      res.status(400).json({ success: false, error: "请输入需要匹配参考文献的句子或论点" });
      return;
    }

    const userEngine = await retrievalEngineManager.getEngine(safeUserId);
    const literatureCount = userEngine.getDocumentCount();
    if (literatureCount === 0) {
      res.json({ success: false, error: "文献库为空，请先上传或导入参考文献" });
      return;
    }

    const extracted = extractSentencesFromMessage(rawQuery);
    const sentenceList = (extracted.length > 0 ? extracted : rawQuery.split(/\n+/))
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8);

    const results: Record<string, any[]> = {};
    const sentenceDetails: Array<Record<string, unknown>> = [];

    for (const sentence of sentenceList) {
      const parsed = await parseSentenceClaimRetrievalPoint(sentence);
      const variants = buildRetrievalPointQueryVariants(parsed.point);
      const groups: any[][] = [];
      const languageGroups: Array<Record<string, unknown>> = [];

      for (const variant of variants) {
        const queryResults = await userEngine.retrieve({
          query: variant.query,
          topK: Math.min(80, Math.max(topK * 4, 20)),
          searchMode: 'hybrid',
        });
        const rawMapped = queryResults.results.map(doc => ({
          ...doc,
          retrievalPath: variant.label,
          retrievalLanguage: variant.language,
          retrievalQuery: variant.query,
        }));
        const mapped = filterRetrievedResultsForLanguage(rawMapped, variant.language, Math.min(30, Math.max(topK * 2, topK)));
        groups.push(mapped);
        languageGroups.push({
          language: variant.language,
          label: variant.label,
          query: variant.query,
          totalCount: queryResults.totalCount,
          returned: mapped.length,
          rawReturned: queryResults.results.length,
          filteredOut: Math.max(0, rawMapped.length - mapped.length),
          semanticUsed: mapped.some(item => Number(item.vectorScore || 0) > 0),
          timing: queryResults.timing,
        });
      }

      const selectedRaw = interleaveRetrievedResultGroups(groups, Math.min(30, Math.max(topK * 2, topK)));
      const selected = selectedRaw.filter(item => !isLikelyPlaceholderReferenceRecord(item));
      const hiddenInvalidMetadataCount = selectedRaw.length - selected.length;
      const judged = await judgeClaimEvidenceForRetrievedReferences(sentence, selected);
      const ranked = applyClaimEvidenceQualityGate(rankClaimEvidenceJudgedResults(judged, Math.max(topK, judged.length)));
      const supportCounts = summarizeClaimEvidenceJudgments(ranked);
      const hiddenLowQualityCount = countClaimEvidenceHiddenByQualityGate(ranked);
      const visibleRanked = selectVisibleClaimEvidenceResults(ranked, topK);
      results[sentence] = visibleRanked.map(mapRetrievedReferenceForClient);
      sentenceDetails.push({
        sentence,
        parser: parsed.parser,
        parserReason: parsed.reason,
        parserWarning: parsed.warning || "",
        parsedPoint: parsed.point,
        queryVariants: variants,
        querySummary: formatRetrievalQueryVariants(variants),
        languageGroups,
        evidenceChecked: ranked.some(item => Boolean(item?.claimSupport?.checked)),
        supportCounts,
        hiddenIrrelevantCount: supportCounts.irrelevant,
        hiddenLowQualityCount,
        hiddenInvalidMetadataCount,
        resultCount: visibleRanked.length,
        requestedCount: topK,
      });

      logger.info(`[SentenceClaimMatch] "${sentence.substring(0, 40)}..." parser=${parsed.parser}, refs=${visibleRanked.length}, hiddenIrrelevant=${supportCounts.irrelevant}, hiddenLowQuality=${hiddenLowQualityCount}, hiddenInvalidMetadata=${hiddenInvalidMetadataCount}, supports=${supportCounts.supports}, related=${supportCounts.related}, queries=${formatRetrievalQueryVariants(variants)}`);
    }

    const researchSession = await recordSentenceSearchResearchProvenance({
      userId: safeUserId,
      sessionId: cleanOptionalResearchSessionId(req.body.researchSessionId),
      operation: "sentence.claim-match",
      rawQuery,
      results,
      sentenceDetails,
      metadata: {
        pipeline: "claim-match",
        literatureCount,
        topK,
      },
    }).catch((error) => {
      logger.warn("[ResearchSession] Failed to record claim-match provenance:", error);
      return undefined;
    });

    res.json({
      success: true,
      query: rawQuery,
      pipeline: [
        "用户句子解析为中英文组合检索式",
        "英文检索和中文检索分路评分排序",
        "BM25 关键词粗筛候选文献池",
        "在 BM25 候选池内生成用户 query embedding 并计算语义相似度",
        "LLM/NLI 风格证据支持判断：支持、反向、仅相关、无关",
        "按证据支持度、语义分数和关键词分综合排序返回",
      ],
      literatureCount,
      topK,
      sentences: sentenceDetails,
      results,
      researchSession,
    });
  } catch (error) {
    logger.error("[SentenceClaimMatch] Error:", error);
    res.json({ success: false, error: "快速句子级论点检索失败: " + (error as Error).message });
  }
});

async function recordSentenceSearchResearchProvenance(input: {
  userId: string;
  sessionId?: string;
  operation: "sentence.search" | "sentence.claim-match";
  rawQuery: string;
  results: Record<string, any[]>;
  sentenceDetails?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactId: string }> {
  const sources: ResearchSourceReference[] = [];
  const citations: Array<{ citationText: string; referenceId?: string; title?: string; doi?: string; supportRelation?: string; supportConfidence?: number; evidenceSnippet?: string; metadata?: Record<string, unknown> }> = [];

  for (const [sentence, refs] of Object.entries(input.results)) {
    for (const ref of refs || []) {
      const support = ref.claimSupport || ref.support || {};
      const citationText = String(ref.citation || ref.inTextCitation || `${ref.author || ref.authors || 'Unknown'} ${ref.year || ''}`).trim();
      const referenceId = String(ref.id || ref.doi || ref.title || '').trim() || undefined;
      sources.push({
        id: referenceId,
        sourceType: ref.source === 'pdfWiki' || ref.sourceType === 'pdf-wiki' ? 'pdf-wiki' : 'embedding',
        title: ref.title,
        authors: ref.author || ref.authors,
        year: ref.year,
        journal: ref.journal,
        doi: ref.doi,
        query: ref.retrievalQuery || ref.keyword,
        score: Number(ref.score || ref.combinedScore || ref.relevanceScore || 0) || undefined,
        supportRelation: support.relation,
        supportConfidence: typeof support.confidence === 'number' ? support.confidence : undefined,
        evidenceSnippet: Array.isArray(support.evidenceSnippets) ? support.evidenceSnippets[0] : ref.abstract,
        metadata: {
          sentence,
          retrievalPath: ref.retrievalPath,
          retrievalLanguage: ref.retrievalLanguage,
          qualityGate: ref.qualityGate,
        },
      });
      if (citationText) {
        citations.push({
          citationText,
          referenceId,
          title: ref.title,
          doi: ref.doi,
          supportRelation: support.relation,
          supportConfidence: typeof support.confidence === 'number' ? support.confidence : undefined,
          evidenceSnippet: Array.isArray(support.evidenceSnippets) ? support.evidenceSnippets[0] : undefined,
          metadata: {
            sentence,
            retrievalPath: ref.retrievalPath,
          },
        });
      }
    }
  }

  const literatureReviewTrace = await buildLiteratureReviewToolTrace(sources, { maxVerify: 12, maxExpand: 3 });
  const targetType = input.operation === "sentence.claim-match" ? "citation" : "retrieval";
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.sessionId,
    sessionTitle: input.rawQuery ? `论点检索：${input.rawQuery.slice(0, 60)}` : '句子级论点检索',
    sessionTopic: input.rawQuery,
    targetType,
    targetId: `${input.operation}:${Date.now()}`,
    operation: input.operation,
    sourceModule: 'sentence-retrieval',
    input: {
      query: input.rawQuery,
      sentenceDetails: input.sentenceDetails,
    },
    output: {
      sentenceCount: Object.keys(input.results).length,
      referenceCount: sources.length,
      results: input.results,
    },
    query: input.sentenceDetails
      ? input.sentenceDetails.map(item => String(item.querySummary || item.sentence || '')).filter(Boolean).join('\n')
      : input.rawQuery,
    sources,
    citations,
    metadata: {
      ...(input.metadata || {}),
      literatureReviewTrace,
    },
  });
  const artifact = await researchSessionManager.appendArtifact({
    userId: input.userId,
    sessionId: provenance.session.id,
    kind: 'retrieval',
    name: `${input.operation}-${new Date().toISOString()}`,
    content: JSON.stringify({ query: input.rawQuery, results: input.results, sentenceDetails: input.sentenceDetails }, null, 2),
    contentType: 'application/json',
    input: input.rawQuery,
    provenanceRecordIds: [provenance.record.id],
    metadata: {
      ...(input.metadata || {}),
      doiVerification: literatureReviewTrace.doiVerification,
      citationExpansion: literatureReviewTrace.citationExpansion,
    },
  });
  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
    artifactId: artifact.artifact.id,
  };
}

app.post("/api/sentence/claim-match/stream", async (req: Request, res: Response) => {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");

  const send = (payload: Record<string, unknown>) => {
    res.write(`${JSON.stringify(payload)}\n`);
  };

  try {
    const rawQuery = String(req.body.query || req.body.sentence || '').trim();
    const safeUserId = sanitizeUserId(req.body.userId || "web-user");
    const topK = Math.min(20, Math.max(1, Math.floor(Number(req.body.topK || 6))));

    if (!rawQuery) {
      send({ type: "error", error: "请输入需要匹配参考文献的句子或论点" });
      return;
    }

    send({ type: "log", message: "开始快速句子级论点检索。", timestamp: new Date().toISOString() });
    const userEngine = await retrievalEngineManager.getEngine(safeUserId);
    const literatureCount = userEngine.getDocumentCount();
    send({ type: "log", message: `已加载用户文献库：${literatureCount} 条记录。`, timestamp: new Date().toISOString() });
    if (literatureCount === 0) {
      send({ type: "error", error: "文献库为空，请先上传或导入参考文献" });
      return;
    }

    const extracted = extractSentencesFromMessage(rawQuery);
    const sentenceList = (extracted.length > 0 ? extracted : rawQuery.split(/\n+/))
      .map(item => String(item || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    send({ type: "log", message: `已解析待检索句子：${sentenceList.length} 条；每句最多返回 ${topK} 条。`, timestamp: new Date().toISOString() });

    const results: Record<string, any[]> = {};
    const sentenceDetails: Array<Record<string, unknown>> = [];

    for (const sentence of sentenceList) {
      send({ type: "log", message: `正在解析句子：${sentence.slice(0, 80)}`, timestamp: new Date().toISOString() });
      const parsed = await parseSentenceClaimRetrievalPoint(sentence);
      const variants = buildRetrievalPointQueryVariants(parsed.point);
      const groups: any[][] = [];
      const languageGroups: Array<Record<string, unknown>> = [];
      send({ type: "log", message: `Query 解析完成：${parsed.parser === "ai" ? "AI解析" : "规则解析"}；生成 ${variants.length} 条中英文检索路径。`, timestamp: new Date().toISOString() });

      for (const variant of variants) {
        send({ type: "log", message: `正在执行${variant.label}：BM25 粗筛 + embedding 语义重排。`, timestamp: new Date().toISOString() });
        const queryResults = await userEngine.retrieve({
          query: variant.query,
          topK: Math.min(80, Math.max(topK * 4, 20)),
          searchMode: 'hybrid',
        });
        const rawMapped = queryResults.results.map(doc => ({
          ...doc,
          retrievalPath: variant.label,
          retrievalLanguage: variant.language,
          retrievalQuery: variant.query,
        }));
        const mapped = filterRetrievedResultsForLanguage(rawMapped, variant.language, Math.min(30, Math.max(topK * 2, topK)));
        groups.push(mapped);
        languageGroups.push({
          language: variant.language,
          label: variant.label,
          query: variant.query,
          totalCount: queryResults.totalCount,
          returned: mapped.length,
          rawReturned: queryResults.results.length,
          filteredOut: Math.max(0, rawMapped.length - mapped.length),
          semanticUsed: mapped.some(item => Number(item.vectorScore || 0) > 0),
          timing: queryResults.timing,
        });
        send({ type: "log", message: `${variant.label}完成：候选 ${queryResults.totalCount} 条，语言过滤后保留 ${mapped.length} 条。`, timestamp: new Date().toISOString() });
      }

      const selectedRaw = interleaveRetrievedResultGroups(groups, Math.min(30, Math.max(topK * 2, topK)));
      const selected = selectedRaw.filter(item => !isLikelyPlaceholderReferenceRecord(item));
      const hiddenInvalidMetadataCount = selectedRaw.length - selected.length;
      send({ type: "log", message: `中英文候选整合完成：${selectedRaw.length} 条；隐藏疑似示例/占位元数据 ${hiddenInvalidMetadataCount} 条。`, timestamp: new Date().toISOString() });
      send({ type: "log", message: "正在执行证据支持判断：支持、反向、仅相关、无关。", timestamp: new Date().toISOString() });

      const judged = await judgeClaimEvidenceForRetrievedReferences(sentence, selected);
      const ranked = applyClaimEvidenceQualityGate(rankClaimEvidenceJudgedResults(judged, Math.max(topK, judged.length)));
      const supportCounts = summarizeClaimEvidenceJudgments(ranked);
      const hiddenLowQualityCount = countClaimEvidenceHiddenByQualityGate(ranked);
      const visibleRanked = selectVisibleClaimEvidenceResults(ranked, topK);
      results[sentence] = visibleRanked.map(mapRetrievedReferenceForClient);
      sentenceDetails.push({
        sentence,
        parser: parsed.parser,
        parserReason: parsed.reason,
        parserWarning: parsed.warning || "",
        parsedPoint: parsed.point,
        queryVariants: variants,
        querySummary: formatRetrievalQueryVariants(variants),
        languageGroups,
        evidenceChecked: ranked.some(item => Boolean(item?.claimSupport?.checked)),
        supportCounts,
        hiddenIrrelevantCount: supportCounts.irrelevant,
        hiddenLowQualityCount,
        hiddenInvalidMetadataCount,
        resultCount: visibleRanked.length,
        requestedCount: topK,
      });

      send({
        type: "log",
        message: `证据判断完成：支持 ${supportCounts.supports}、反向 ${supportCounts.contradicts}、仅相关 ${supportCounts.related}、无关 ${supportCounts.irrelevant}；动态质量门控隐藏 ${hiddenLowQualityCount} 条；最终展示 ${visibleRanked.length} 条。`,
        timestamp: new Date().toISOString(),
      });
      logger.info(`[SentenceClaimMatchStream] "${sentence.substring(0, 40)}..." parser=${parsed.parser}, refs=${visibleRanked.length}, hiddenIrrelevant=${supportCounts.irrelevant}, hiddenLowQuality=${hiddenLowQualityCount}, hiddenInvalidMetadata=${hiddenInvalidMetadataCount}, supports=${supportCounts.supports}, related=${supportCounts.related}, queries=${formatRetrievalQueryVariants(variants)}`);
    }

    send({ type: "log", message: "检索完成，正在渲染结果。", timestamp: new Date().toISOString() });
    send({
      type: "result",
      data: {
        success: true,
        query: rawQuery,
        pipeline: [
          "用户句子解析为中英文组合检索式",
          "英文检索和中文检索分路评分排序",
          "BM25 关键词粗筛候选文献池",
          "在 BM25 候选池内生成用户 query embedding 并计算语义相似度",
          "LLM/NLI 风格证据支持判断：支持、反向、仅相关、无关",
          "按证据支持度、语义分数和关键词分综合排序返回",
        ],
        literatureCount,
        topK,
        sentences: sentenceDetails,
        results,
      },
    });
  } catch (error) {
    logger.error("[SentenceClaimMatchStream] Error:", error);
    send({ type: "error", error: "快速句子级论点检索失败: " + (error as Error).message });
  } finally {
    res.end();
  }
});

app.post("/api/sentence/translate", async (req: Request, res: Response) => {
  try {
    const text = String(req.body.text || '').trim();
    const targetLanguage = String(req.body.targetLanguage || '中文').trim() || '中文';
    const useApiUrl = currentApiUrl || process.env.API_URL;
    const useApiKey = currentApiKey || process.env.API_KEY;
    const model = currentSecondaryModel || currentModel || process.env.MODEL || "gpt-4o";

    if (!text) {
      res.status(400).json({ success: false, error: "待翻译文本为空" });
      return;
    }
    if (!useApiUrl || !useApiKey) {
      res.status(400).json({ success: false, error: "API未配置，请先在配置中填写模型 API 地址和密钥" });
      return;
    }

    const translation = await callChatCompletion(
      {
        apiUrl: useApiUrl,
        apiKey: useApiKey,
        label: "SentenceClaimTranslate",
        defaultModel: model,
      },
      {
        model,
        temperature: 0.1,
        maxTokens: 5000,
        messages: [
          {
            role: "system",
            content: "你是学术文献摘要翻译助手。请将用户提供的摘要准确翻译为目标语言，保留专业术语、统计符号、缩写、物种名、化学式、pH、基因名、单位和引用格式。只输出译文，不要解释。",
          },
          {
            role: "user",
            content: `目标语言：${targetLanguage}\n\n待翻译摘要：\n${text.slice(0, 12000)}`,
          },
        ],
      }
    );

    res.json({ success: true, translation });
  } catch (error) {
    logger.error("[SentenceTranslate] Error:", error);
    res.json({ success: false, error: "翻译失败: " + (error as Error).message });
  }
});

// 辅助函数：格式化引用
function formatCitation(paper: LitPaper): string {
  const rawAuthors = ((paper as unknown) as Record<string, unknown>)['authors'];
  const authorStr = paper.author
    || (Array.isArray(rawAuthors) ? (rawAuthors as Array<unknown>).map((a: unknown) => typeof a === 'string' ? a : ((a as Record<string, unknown>)['name'] || '')).join(', ') : '')
    || 'Unknown';
  const authors = authorStr.split(/[,;]/).map((a: string) => a.trim()).filter((a: string) => a);
  const firstAuthor = authors[0] || 'Unknown';
  const authorLastName = firstAuthor.split(/\s+/).pop() || firstAuthor;
  
  if (authors.length >= 2) {
    return `(${authorLastName} et al., ${paper.year || 'n.d.'})`;
  } else {
    return `(${authorLastName}, ${paper.year || 'n.d.'})`;
  }
}

function getRetrievedReferenceAuthor(item: any): string {
  if (typeof item?.author === 'string' && item.author.trim()) return item.author.trim();
  if (Array.isArray(item?.authors)) {
    return item.authors
      .map((author: unknown) => typeof author === 'string' ? author : String((author as Record<string, unknown>)?.name || ''))
      .map((author: string) => author.trim())
      .filter(Boolean)
      .join(', ');
  }
  return 'Unknown';
}

function splitReferenceAuthorNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap(item => splitReferenceAuthorNames(typeof item === 'string' ? item : (item as Record<string, unknown>)?.name))
      .filter(Boolean);
  }
  return String(value || '')
    .split(/[,;，；、]|\band\b|\s+&\s+/i)
    .map(item => item.trim())
    .filter(Boolean);
}

function isLikelyPlaceholderAuthorName(name: string): boolean {
  const normalized = name.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  return /^(张三|李四|王五|赵六|孙七|周八|测试作者|示例作者|作者[甲乙丙丁ABCD]|unknown author|test author|sample author|john doe|jane doe|author [a-z])$/i.test(normalized);
}

function isLikelyPlaceholderReferenceRecord(item: any): boolean {
  const authors = [
    ...splitReferenceAuthorNames(item?.authors),
    ...splitReferenceAuthorNames(item?.author),
  ];
  const uniqueAuthors = Array.from(new Set(authors.map(author => author.trim()).filter(Boolean)));
  if (uniqueAuthors.length < 2) return false;
  const placeholderCount = uniqueAuthors.filter(isLikelyPlaceholderAuthorName).length;
  return placeholderCount >= 2 && placeholderCount / uniqueAuthors.length >= 0.5;
}

function firstReadableSentence(value: unknown, limit = 500): string {
  const clean = cleanClaimEvidenceText(value, 1800);
  if (!clean) return "";
  const sentence = clean
    .split(/(?<=[.!?。！？])\s+|[；;]\s+/)
    .map(item => item.trim())
    .find(item => item.length >= 20);
  return (sentence || clean).slice(0, limit);
}

function buildRetrievedReferenceSourceItem(item: any): RetrievedReferenceSourceItem {
  const support = item?.claimSupport as ClaimEvidenceJudgment | undefined;
  const supportSnippet = Array.isArray(support?.evidenceSnippets)
    ? support?.evidenceSnippets.find(snippet => cleanClaimEvidenceText(snippet, 120))
    : "";
  const excerpt = firstReadableSentence(supportSnippet || item?.abstract || item?.title, 650);
  const pathParts = [
    item?.journal,
    item?.year,
    item?.doi ? `DOI: ${item.doi}` : "",
    item?.retrievalPath,
  ].map(part => cleanClaimEvidenceText(part, 120)).filter(Boolean);
  return {
    id: buildClaimEvidenceCandidateId(item, 0),
    file: cleanClaimEvidenceText(item?.fileName || item?.sourcePdfName || item?.title || "Reference", 240),
    path: pathParts.join(" · "),
    excerpt,
  };
}

function mapRetrievedReferenceForClient(item: any): Record<string, unknown> {
  const author = getRetrievedReferenceAuthor(item);
  const normalized = {
    ...item,
    author,
  } as LitPaper & Record<string, unknown>;
  return {
    id: item.id || "",
    title: item.title || "Untitled",
    author,
    year: item.year || "",
    journal: item.journal || "",
    doi: item.doi || "",
    abstract: item.abstract || "",
    keywords: item.keywords || [],
    source: item.source || "",
    score: Number(item.combinedScore || item.score || 0),
    originalScore: Number(item.originalCombinedScore || item.combinedScore || item.score || 0),
    bm25Score: Number(item.bm25Score || 0),
    vectorScore: Number(item.vectorScore || 0),
    claimSupport: item.claimSupport || null,
    qualityGate: item.qualityGate || null,
    sourceItem: buildRetrievedReferenceSourceItem(item),
    retrievalPath: item.retrievalPath || "",
    retrievalLanguage: item.retrievalLanguage || "",
    retrievalQuery: item.retrievalQuery || "",
    citation: formatCitation(normalized),
  };
}
