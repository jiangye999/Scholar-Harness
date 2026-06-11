import { Router } from 'express';
import { ChatBridgeAdapter } from '../../bridge/chat-bridge/chat-bridge';
import { logger } from '../../utils/logger';
import { maskEmail } from '../../utils/sanitize';
import {
  anchorPromptWithCurrentRequest,
  getPromptAnchorDiagnostics,
} from '../../utils/prompt-request-anchor';
import { loadUserMemory, saveUserMemory, saveMemoryToFiles, withMemoryLock, MemoryEntry, UserMemory, generateStructuredSummaries, extractKeyContent, isKeyDeleted, autoRestoreDeletedKeyIfEmpty, removeFromDeletedKeys, extractMemoryByRules, aiMergeMemoryContent, getStructuredPreferredMemoryEntries } from './memory';
import {
  validate,
  chatRequestSchema,
  controlRequestSchema,
  openPageRequestSchema,
  saveConfigSchema,
  sanitizeUrl,
  sanitizeString,
} from '../../bridge/chat-bridge/validation';
import { csrfProtectionLite } from '../middleware/csrf';
import { getDataDir, getMemoryDir } from '../../utils/paths';
import { getRetrievalEngine } from './literature';
import { decrypt, isEncrypted } from '../../utils/encryption';
import * as path from 'path';
import * as fs from 'fs';
// Bug 修复：从 session 获取 userId，避免账号数据混淆
import { resolveUserId, getUserIdFromSession } from '../auth-guard-singleton';
import { getBibliometricWritingContextForUser } from './bibliometrics';
import { getMetaAnalysisWritingContextForUser } from './meta-analysis';

const router = Router();

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
  const lines = referencesText.split('\n').filter(line => line.trim().length > 0);
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

    // 尝试匹配多种格式：
    // 1. [Song et al., 2022] Song, X. T. et al. (2022)...
    // 2. Song et al. (2022)...
    // 3. (Song et al., 2022)
    
    let author = '';
    let year = '';
    
    // 格式1: [作者, 年份]
    const bracketMatch = trimmedLine.match(/\[([^,]+),\s*(\d{4}[a-z]?)\]/);
    if (bracketMatch) {
      author = bracketMatch[1].trim();
      year = bracketMatch[2].trim();
    }
    
    // 格式2: 作者 (年份) 或 作者, 年份
    if (!author) {
      const authorYearMatch = trimmedLine.match(/^([A-Z][a-z]+(?:\s+et\s+al\.?|\s+[A-Z][a-z]+)*),?\s*(?:\()(\d{4}[a-z]?)(?:\))/);
      if (authorYearMatch) {
        author = authorYearMatch[1].trim();
        year = authorYearMatch[2].trim();
      }
    }
    
    // 格式3: 文中包含 (作者, 年份) 或 (作者 et al., 年份)
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

    // 构建 authorYear 标识
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
  const authorYearLetters = new Map<string, string[]>(); // 存储已使用的字母
  
  for (const ref of refs) {
    const count = authorYearCounts.get(ref.authorYear) || 0;
    authorYearCounts.set(ref.authorYear, count + 1);
  }

  // 对重复的添加字母标注
  const processedRefs: string[] = [];
  const seenAuthorYears = new Map<string, number>(); // 记录每个 authorYear 出现的次数

  for (const ref of refs) {
    const count = authorYearCounts.get(ref.authorYear) || 1;
    
    if (count > 1) {
      // 有重复，需要添加字母
      const occurrence = (seenAuthorYears.get(ref.authorYear) || 0) + 1;
      seenAuthorYears.set(ref.authorYear, occurrence);
      
      // 字母序列：a, b, c, d...
      const letter = String.fromCharCode(97 + occurrence - 1); // 'a' = 97
      
      // 更新年份（添加字母）
      const newYear = ref.year.replace(/[a-z]$/, '') + letter;
      const newAuthorYear = `${ref.author}, ${newYear}`;
      
      // 更新原文中的年份引用
      let updatedLine = ref.original;
      
      // 更新 [作者, 年份] 格式
      if (updatedLine.includes(`[${ref.author}, ${ref.year}]`)) {
        updatedLine = updatedLine.replace(`[${ref.author}, ${ref.year}]`, `[${ref.author}, ${newYear}]`);
      }
      
      // 更新 (年份) 格式
      if (updatedLine.includes(`(${ref.year})`)) {
        updatedLine = updatedLine.replace(`(${ref.year})`, `(${newYear})`);
      }
      
      // 更新年份本身
      if (updatedLine.includes(ref.year) && !updatedLine.includes(newYear)) {
        updatedLine = updatedLine.replace(new RegExp(`\\b${ref.year}\\b`, 'g'), newYear);
      }
      
      logger.info(`[References] Dedup: "${ref.authorYear}" -> "${newAuthorYear}" (letter: ${letter})`);
      processedRefs.push(updatedLine);
    } else {
      // 无重复，直接使用
      processedRefs.push(ref.original);
    }
  }

  const dedupedText = processedRefs.join('\n');
  logger.info(`[References] Deduplicated: ${refs.length} refs -> ${processedRefs.length} refs`);
  
  return dedupedText;
}

// 对修改操作应用 CSRF 保护
router.use('/config', csrfProtectionLite);
router.use('/control', csrfProtectionLite);
router.use('/open-page', csrfProtectionLite);

let chatBridgeAdapter: ChatBridgeAdapter | null = null;
let saveDraftForUser: ((userId: string, section: string, content: string) => Promise<void>) | null = null;
let compatibleBridgeState = {
  serviceRunning: false,
  paused: false,
  currentUrl: null as string | null,
  hasActivePage: false,
};

// 服务端会话状态跟踪 - 用于判断是否为首条消息
// key: `${userId}:${conversationId}`, value: messageCount
const sessionMessageCount = new Map<string, number>();

// 使用统一的路径管理模块（确保 Electron/pkg 打包后路径一致）
const dataDir = getDataDir();
const memoryDir = getMemoryDir();

// 配置文件路径（保存到用户数据目录，确保打包后可写）
const userDataDir = getDataDir();
const configPath = path.join(userDataDir, 'chat-bridge-config.json');

// 确保配置目录存在
if (!fs.existsSync(userDataDir)) {
  fs.mkdirSync(userDataDir, { recursive: true });
}

const CODEX_REASONING_LEVELS = [
  { effort: 'low', description: 'Fast responses with lighter reasoning' },
  { effort: 'medium', description: 'Balances speed and reasoning depth for everyday tasks' },
  { effort: 'high', description: 'Greater reasoning depth for complex problems' },
  { effort: 'xhigh', description: 'Extra high reasoning depth for complex problems' },
];

const CODEX_FALLBACK_MODELS = [
  {
    slug: 'gpt-5.5',
    displayName: 'GPT-5.5',
    description: 'Frontier model for complex coding, research, and real-world work.',
    defaultReasoningLevel: 'medium',
    supportedReasoningLevels: CODEX_REASONING_LEVELS,
  },
  {
    slug: 'gpt-5.4',
    displayName: 'GPT-5.4',
    description: 'Strong model for everyday coding.',
    defaultReasoningLevel: 'medium',
    supportedReasoningLevels: CODEX_REASONING_LEVELS,
  },
  {
    slug: 'gpt-5.4-mini',
    displayName: 'GPT-5.4-Mini',
    description: 'Small, fast, and cost-efficient model for simpler coding tasks.',
    defaultReasoningLevel: 'medium',
    supportedReasoningLevels: CODEX_REASONING_LEVELS,
  },
  {
    slug: 'gpt-5.3-codex',
    displayName: 'GPT-5.3-Codex',
    description: 'Coding-optimized model.',
    defaultReasoningLevel: 'medium',
    supportedReasoningLevels: CODEX_REASONING_LEVELS,
  },
  {
    slug: 'gpt-5.3-codex-spark',
    displayName: 'GPT-5.3-Codex-Spark',
    description: 'Ultra-fast coding model.',
    defaultReasoningLevel: 'high',
    supportedReasoningLevels: CODEX_REASONING_LEVELS,
  },
  {
    slug: 'gpt-5.2',
    displayName: 'GPT-5.2',
    description: 'Optimized for professional work and long-running agents.',
    defaultReasoningLevel: 'medium',
    supportedReasoningLevels: CODEX_REASONING_LEVELS,
  },
];

function getCodexModelsCachePath(): string {
  const codexHome = process.env.CODEX_HOME
    || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
  return path.join(codexHome, 'models_cache.json');
}

function normalizeCodexModelCacheItem(item: any) {
  const slug = sanitizeString(item?.slug || item?.id || item?.model || '');
  if (!slug) return null;
  const supportedReasoningLevels = Array.isArray(item?.supported_reasoning_levels)
    ? item.supported_reasoning_levels
      .map((level: any) => ({
        effort: sanitizeString(level?.effort || ''),
        description: sanitizeString(level?.description || ''),
      }))
      .filter((level: any) => ['low', 'medium', 'high', 'xhigh'].includes(level.effort))
    : CODEX_REASONING_LEVELS;

  return {
    slug,
    displayName: sanitizeString(item?.display_name || item?.name || slug),
    description: sanitizeString(item?.description || ''),
    defaultReasoningLevel: sanitizeString(item?.default_reasoning_level || 'medium'),
    supportedReasoningLevels: supportedReasoningLevels.length > 0 ? supportedReasoningLevels : CODEX_REASONING_LEVELS,
    priority: Number(item?.priority || 0),
  };
}

function loadCodexAvailableModels() {
  const cachePath = getCodexModelsCachePath();
  try {
    if (!fs.existsSync(cachePath)) {
      return { source: 'fallback', models: CODEX_FALLBACK_MODELS };
    }
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
    const models = Array.isArray(parsed?.models)
      ? parsed.models
        .filter((item: any) => !item?.visibility || item.visibility === 'list')
        .map(normalizeCodexModelCacheItem)
        .filter(Boolean)
        .sort((a: any, b: any) => Number(a.priority || 0) - Number(b.priority || 0))
        .map(({ priority, ...model }: any) => model)
      : [];
    return {
      source: models.length > 0 ? 'cache' : 'fallback',
      cachePath,
      clientVersion: sanitizeString(parsed?.client_version || ''),
      fetchedAt: sanitizeString(parsed?.fetched_at || ''),
      models: models.length > 0 ? models : CODEX_FALLBACK_MODELS,
    };
  } catch (error) {
    logger.warn('[ChatBridge] Failed to read Codex models cache, using fallback:', error);
    return { source: 'fallback', cachePath, models: CODEX_FALLBACK_MODELS };
  }
}

// MemoryEntry 和 UserMemory 已从 memory.ts 导入，避免重复定义

function decryptConfigSecret(value?: string): string {
  if (!value) return '';
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch (error) {
    logger.warn('[ChatBridge] Failed to decrypt memory extraction API key, using raw value');
    return value;
  }
}

function resolveMemoryExtractionConfig(apiUrl?: string, apiKey?: string, secondaryModel?: string): {
  apiUrl?: string;
  apiKey?: string;
  secondaryModel?: string;
} {
  if (apiUrl && apiKey) {
    return { apiUrl, apiKey, secondaryModel };
  }

  try {
    if (!fs.existsSync(configPath)) {
      return { apiUrl, apiKey, secondaryModel };
    }

    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const savedSecondary = parsed.secondary || {};
    const savedChat = parsed.chat || {};
    return {
      apiUrl: apiUrl || savedSecondary.api_url || savedChat.api_url,
      apiKey: apiKey || decryptConfigSecret(savedSecondary.api_key || savedChat.api_key),
      secondaryModel: secondaryModel || savedSecondary.model || 'gpt-4o',
    };
  } catch (error) {
    logger.warn('[ChatBridge] Failed to resolve saved memory extraction config:', error);
    return { apiUrl, apiKey, secondaryModel };
  }
}

/**
 * 规范化布尔标志值
 * 支持 true/false、"true"/"false"、1/0、"1"/"0"、undefined/null
 */
function normalizeBooleanFlag(value: any): boolean {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0' || value === undefined || value === null) return false;
  return Boolean(value);
}

function shouldAutoAttachBibliometricsContext(message: string): boolean {
  return /文献计量|计量学|知识图谱|共现|共被引|文献耦合|突现词|主题演化|合作网络|bibliometric|bibliometrics|scientometric|scientometrics|citespace|vosviewer/i.test(message || '');
}

function shouldAutoAttachMetaAnalysisContext(message: string): boolean {
  return /meta分析|meta 分析|荟萃分析|整合分析|效应量|森林图|漏斗图|异质性|发表偏倚|egger|baujat|leave-one-out|leave1out|metafor|meta-analysis|meta analysis|effect size|forest plot|funnel plot/i.test(message || '');
}

/**
 * 验证并清理 userId
 * 防止路径遍历攻击和特殊字符注入
 */
function validateUserId(userId: string): string {
  // 默认值
  if (!userId || typeof userId !== 'string') {
    return 'web-user';
  }
  
  // 移除危险字符
  const sanitized = userId
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '') // 移除文件系统危险字符
    .replace(/\.\./g, '') // 防止路径遍历
    .trim();
  
  // 长度限制
  if (sanitized.length > 64) {
    return sanitized.substring(0, 64);
  }
  
  // 空字符串回退到默认值
  return sanitized || 'web-user';
}

export function initializeChatBridgeRoutes(
  adapter: ChatBridgeAdapter,
  options?: {
    saveDraft?: (userId: string, section: string, content: string) => Promise<void>;
  }
): void {
  chatBridgeAdapter = adapter;
  saveDraftForUser = options?.saveDraft || null;
}

router.post('/chat', async (req, res) => {
  try {
    logger.info('[ChatBridge Route] POST /chat received');
    
    if (!chatBridgeAdapter) {
      logger.error('[ChatBridge Route] chatBridgeAdapter is null - not initialized!');
      res.status(503).json({ success: false, error: 'ChatBridge not initialized' });
      return;
    }

    // 输入验证
    const validation = validate(chatRequestSchema, req.body);
    if (!validation.success) {
      logger.error('[ChatBridge Route] Validation failed:', validation.error);
      logger.error('[ChatBridge Route] Request body:', JSON.stringify(req.body, null, 2).substring(0, 1000));
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    const { message, context = {}, options = {}, stream: rawStream = false, newPage: rawNewPage = false, history = [], forceProvider, apiUrl, apiKey, model, secondaryModel } = validation.data;

    // 规范化 boolean 字段（处理可能的 string 输入）
    const stream = typeof rawStream === 'boolean' ? rawStream : rawStream === 'true' || rawStream === '1';
    const newPage = typeof rawNewPage === 'boolean' ? rawNewPage : rawNewPage === 'true' || rawNewPage === '1';

    logger.info(`[ChatBridge Route] Received chat request`);
    logger.info(`[ChatBridge Route] USER MESSAGE (${message.length} chars): "${message.substring(0, 200)}..."`);
    logger.info(`[ChatBridge Route] newPage: ${newPage}`);
    logger.info(`[ChatBridge Route] forceProvider: ${forceProvider || 'auto'}`);
    if (forceProvider === 'api' && apiUrl) {
      logger.info(`[ChatBridge Route] 小牛马使用前端 API 配置: ${apiUrl}`);
    }
    logger.info(`[ChatBridge Route] context.isFirstMessage: ${context.isFirstMessage}`);
    logger.info(`[ChatBridge Route] history length: ${history.length}`);
    
    // Bug 修复：从 session 获取 userId（优先级：session > req.body.userId > 'web-user'）
    // 不再使用 validateUserId 清理，而是使用 resolveUserId 从 session 获取真实用户 ID
    const userId = await resolveUserId(req.body.userId);
    logger.info(`[ChatBridge Route] User ID: ${userId} (source: session-priority)`);
    
    const persistentMemory = await loadUserMemory(userId);
    logger.info(`[ChatBridge Route] Loaded persistent memory: ${persistentMemory.entries.length} entries, ${persistentMemory.conversations.length} conversations`);
    
    // 结构化总结存在时，只保留 _structured key，避免同一份内容用 raw key 再发一遍。
    const enhancedEntries = getStructuredPreferredMemoryEntries(persistentMemory.entries);
    
    const debugMemory = {
      experiment_summary_structured: enhancedEntries.find(e => e.key === 'experiment_summary_structured')?.value?.substring(0, 100),
      data_summary_structured: enhancedEntries.find(e => e.key === 'data_summary_structured')?.value?.substring(0, 100),
      writing_progress: enhancedEntries.find(e => e.key === 'writing_progress')?.value?.substring(0, 100),
      paper_topic: enhancedEntries.find(e => e.key === 'paper_topic')?.value || enhancedEntries.find(e => e.key === 'research_topic')?.value?.substring(0, 100),
      target_journal: enhancedEntries.find(e => e.key === 'target_journal')?.value?.substring(0, 100),
      pending_chapters: enhancedEntries.find(e => e.key === 'pending_chapters')?.value?.substring(0, 100),
      conversations_count: persistentMemory.conversations.length
    };
    logger.info(`[Debug] Enhanced memory key fields:`, JSON.stringify(debugMemory, null, 2));
    
    // Bug fix: 避免空数组覆盖前端传来的记忆数据
    // enhancedEntries 为空时（如新会话无后端记忆），应保留前端 context.memory?.other
    const memoryOther = enhancedEntries.length > 0
      ? enhancedEntries.map(e => ({ key: e.key, value: e.value }))
      : (context.memory?.other || []);

    const mergedContext = {
      ...context,
      memory: {
        ...context.memory,
        conversations: persistentMemory.conversations || context.memory?.conversations || [],
        other: memoryOther,
        writingProgress: enhancedEntries.find(e => e.key === 'writing_progress')?.value || context.memory?.writingProgress,
        completedChapters: enhancedEntries.find(e => e.key === 'completed_chapters')?.value || context.memory?.completedChapters,
        pendingChapters: enhancedEntries.find(e => e.key === 'pending_chapters')?.value || context.memory?.pendingChapters,
        paperTopic: enhancedEntries.find(e => e.key === 'paper_topic' || e.key === 'research_topic')?.value || context.memory?.paperTopic,
        targetJournal: enhancedEntries.find(e => e.key === 'target_journal')?.value || context.memory?.targetJournal,
      }
    };

    const contextForPrompt: any = { ...mergedContext };
    if (!contextForPrompt.bibliometrics && shouldAutoAttachBibliometricsContext(message)) {
      try {
        const bibliometricContext = getBibliometricWritingContextForUser(userId);
        if (bibliometricContext) {
          contextForPrompt.bibliometrics = {
            generatedAt: bibliometricContext.generatedAt,
            source: bibliometricContext.source,
            available: bibliometricContext.available,
            dataset: bibliometricContext.dataset,
            figures: bibliometricContext.figures,
            tables: bibliometricContext.tables,
            exports: bibliometricContext.exports,
            contextMarkdown: bibliometricContext.contextMarkdown,
          };
          contextForPrompt.bibliometricsExplicit = false;
          logger.info('[ChatBridge Route] Auto-attached bibliometrics context on backend');
        }
      } catch (error) {
        logger.warn('[ChatBridge Route] Backend bibliometrics auto-attach failed:', error);
      }
    }

    if (!contextForPrompt.metaAnalysis && shouldAutoAttachMetaAnalysisContext(message)) {
      try {
        const metaAnalysisContext = getMetaAnalysisWritingContextForUser(userId);
        if (metaAnalysisContext) {
          contextForPrompt.metaAnalysis = {
            generatedAt: metaAnalysisContext.generatedAt,
            source: metaAnalysisContext.source,
            available: metaAnalysisContext.available,
            dataset: metaAnalysisContext.dataset,
            config: metaAnalysisContext.config,
            summaries: metaAnalysisContext.summaries,
            quality: metaAnalysisContext.quality,
            effectRows: metaAnalysisContext.effectRows,
            skippedRows: metaAnalysisContext.skippedRows,
            skippedCount: metaAnalysisContext.skippedCount,
            markdown: metaAnalysisContext.markdown,
            rArtifacts: metaAnalysisContext.rArtifacts,
            exports: metaAnalysisContext.exports,
            contextMarkdown: metaAnalysisContext.contextMarkdown,
          };
          contextForPrompt.metaAnalysisExplicit = false;
          logger.info('[ChatBridge Route] Auto-attached Meta analysis context on backend');
        }
      } catch (error) {
        logger.warn('[ChatBridge Route] Backend Meta analysis auto-attach failed:', error);
      }
    }
    
    logger.info('[Debug] Context received:', {
      hasSystemPrompt: !!contextForPrompt.systemPrompt,
      systemPromptLength: contextForPrompt.systemPrompt?.length,
      hasMemory: !!contextForPrompt.memory,
      memoryConversations: contextForPrompt.memory?.conversations?.length,
      memoryEntries: contextForPrompt.memory?.other?.length,
      hasLiterature: !!contextForPrompt.literature,
      hasJournalStyle: !!contextForPrompt.journalStyle,
      hasWritingSkill: !!contextForPrompt.writingSkill,
      hasBibliometrics: !!contextForPrompt.bibliometrics,
      bibliometricsExplicit: !!contextForPrompt.bibliometricsExplicit,
      bibliometricsPinned: !!contextForPrompt.bibliometricsPinned,
      hasMetaAnalysis: !!contextForPrompt.metaAnalysis,
      metaAnalysisExplicit: !!contextForPrompt.metaAnalysisExplicit,
      metaAnalysisPinned: !!contextForPrompt.metaAnalysisPinned,
      hasAutoResearch: !!contextForPrompt.autoResearch,
      autoResearchPinned: !!contextForPrompt.autoResearchPinned,
      isFirstMessage: contextForPrompt.isFirstMessage,
      isFirstMessageType: typeof contextForPrompt.isFirstMessage,
      isFirstMessageValue: JSON.stringify(contextForPrompt.isFirstMessage),
      historyLength: history.length
    });

    // 日志记录：当前对话状态（用于调试）
    logger.info(`[Debug] history.length=${history.length}, isFirstMessage=${normalizeBooleanFlag(contextForPrompt.isFirstMessage)}`);
    
    logger.info(`[Debug] Message to buildEnrichedMessage: "${message}" (${message?.length || 0} chars)`);
    
    // 策略：每次请求都发送完整上下文，确保跨会话长期记忆完整进入模型提示词。
    const enrichedMessage = buildEnrichedMessage(message, contextForPrompt, history);
    logger.info(`[Debug] Memory strategy: ALWAYS FULL context (history.length=${history.length})`);
    logger.info(`[Debug] FINAL enrichedMessage (${enrichedMessage.length} chars):`);
    logger.info(`[Debug] === START ===`);
    logger.info(enrichedMessage.substring(0, 500));
    logger.info(`[Debug] === END ===`);
    
    // 简化消息构建：每次只发送一条消息
    // enrichedMessage 已包含完整内容：核心上下文、长期记忆、历史对话、用户请求、重要要求
    const messagesForChat: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = [
      { role: 'user', content: enrichedMessage }
    ];
    
    logger.info(`[ChatBridge Route] Single message with full context (${enrichedMessage.length} chars, history=${history?.length || 0} msgs embedded)`);

    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      const onProgress = (chunk: string) => {
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      };
      
      try {
        let response = await chatBridgeAdapter.chat({
          model: model || 'unknown',
          messages: messagesForChat,
          ...options,
          onProgress,
          newPage,
          forceProvider,
          // 小牛马 API 配置（来自前端 ⚙️ API 设置）
          apiUrl,
          apiKey,
        });
        
        response = await postProcessResponse(response, userId, message, contextForPrompt, apiUrl, apiKey, model, secondaryModel);
        
        res.write(`data: ${JSON.stringify({ type: 'complete', content: response, provider: 'chat-bridge' })}\n\n`);
        res.end();
      } catch (error) {
        logger.error('[ChatBridge Route] Stream error:', error);
        const errorMsg = (error as Error)?.message || 'Unknown error';
        res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
        res.end();
      }
    } else {
      let response = await chatBridgeAdapter.chat({
        model: model || 'unknown',
        messages: messagesForChat,
        ...options,
        newPage,
        forceProvider,
        // 小牛马 API 配置（来自前端 ⚙️ API 设置）
        apiUrl,
        apiKey,
      });
      
      response = await postProcessResponse(response, userId, message, contextForPrompt, apiUrl, apiKey, model, secondaryModel);

      res.json({
        success: true,
        response,
        provider: 'chat-bridge',
      });
    }
  } catch (error) {
    logger.error('[ChatBridge Route] Chat error:', error);
    res.status(500).json({
      success: false,
      error: 'Chat request failed',
    });
  }
});

async function postProcessResponse(
  aiResponse: string,
  userId: string,
  userMessage: string,
  context: any,
  apiUrl?: string,
  apiKey?: string,
  model?: string,
  secondaryModel?: string
): Promise<string> {
  
  const draftMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：save_draft[\s\S]*?```/);
  if (draftMatch) {
    const draftBlock = draftMatch[0];
    const contentMatch = draftBlock.match(/content:\s*\|\s*([\s\S]*?)(?=\n\s*(?:section|references):)/);
    const sectionMatch = draftBlock.match(/section:\s*(\w+)/);
    const referencesMatch = draftBlock.match(/references:\s*\|\s*([\s\S]*?)(?=```|$)/);
    
    if (contentMatch && sectionMatch) {
      let draftContent = contentMatch[1].trim();
      const section = sectionMatch[1];
      let referencesContent = '';
      
      // 提取参考文献内容
      if (referencesMatch) {
        const rawReferences = referencesMatch[1].trim();
        // 去重并添加字母标注
        referencesContent = deduplicateReferences(rawReferences);
        logger.info(`[ChatBridge] Extracted references: ${referencesContent.length} chars (after dedup)`);
      }
      
      draftContent = draftContent.replace(/^```/, '').replace(/```$/,'').trim();
      
      // 将参考文献附加到内容末尾（如果有）
      const finalContent = referencesContent 
        ? `${draftContent}\n\n\\section*{References}\n${referencesContent}`
        : draftContent;
      
      try {
        if (saveDraftForUser) {
          await saveDraftForUser(userId, section, finalContent);
        } else {
          const userDir = path.join(memoryDir, userId);
          if (!fs.existsSync(userDir)) {
            fs.mkdirSync(userDir, { recursive: true });
          }
          const fallbackFile = path.join(userDir, `draft_${section}.tex`);
          fs.writeFileSync(fallbackFile, finalContent, 'utf-8');
        }
        
        const refsInfo = referencesContent ? `（含参考文献）` : '';
        logger.info(`[ChatBridge] Draft saved: ${section} for ${userId}${refsInfo}`);
        aiResponse = aiResponse.replace(draftMatch[0], `\n✅ 已保存到 ${section} 草稿${refsInfo}\n`);
      } catch (e) {
        logger.error("[ChatBridge] Failed to save draft:", e);
        aiResponse = aiResponse.replace(draftMatch[0], `\n⚠️ 草稿保存失败：${(e as Error).message}\n`);
      }
    }
  }
  
  const sentenceSearchMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：sentence_search[\s\S]*?```/);
  if (sentenceSearchMatch) {
    const searchBlock = sentenceSearchMatch[0];
    const sentencesMatch = searchBlock.match(/sentences:\s*([\s\S]*?)(?=```|$)/);
    
    if (sentencesMatch) {
      const sentences = sentencesMatch[1]
        .split('\n')
        .map(s => s.trim().replace(/^-\s*/, '').replace(/^[""']|[""']$/g, ''))
        .filter(s => s.length > 0);
      
      if (sentences.length > 0) {
        logger.info(`[ChatBridge] Sentence search requested for ${sentences.length} sentences`);
        
        let searchResultText = `\n\n## 逐句检索结果\n\n`;
        searchResultText += `已为 **${sentences.length}** 个检索词检索文献\n\n`;
        const retrievalEngine = getRetrievalEngine();
        
        for (const sentence of sentences) {
          searchResultText += `### 「${sentence}」\n\n`;
          try {
            const queryResults = await retrievalEngine.retrieve({
              query: sentence,
              topK: 5,
              searchMode: 'hybrid',
            });

            if (queryResults.results.length === 0) {
              searchResultText += `*未找到相关文献*\n\n`;
            } else {
              queryResults.results.forEach((doc, index) => {
                const firstAuthor = doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown';
                searchResultText += `${index + 1}. **${doc.title}**\n`;
                searchResultText += `   (${firstAuthor} et al., ${doc.year})\n`;
                if (doc.journal) searchResultText += `   *${doc.journal}*\n`;
                if (doc.abstract) searchResultText += `   ${doc.abstract.substring(0, 180)}...\n`;
                searchResultText += `\n`;
              });
            }
          } catch (error) {
            logger.warn(`[ChatBridge] Sentence search failed for "${sentence}":`, error);
            searchResultText += `*检索失败：${(error as Error).message}*\n\n`;
          }
        }
        
        aiResponse = aiResponse.replace(sentenceSearchMatch[0], searchResultText);
      }
    }
  }
  
  const singleSentenceMatch = aiResponse.match(/```[\s\S]*?🔧 调用工具：sentence_search_single[\s\S]*?```/);
  if (singleSentenceMatch) {
    const searchBlock = singleSentenceMatch[0];
    const sentenceIdMatch = searchBlock.match(/sentence_id:\s*(S\d+)/);
    const queryMatch = searchBlock.match(/search_query:\s*([^\n]+)/);
    
    if (sentenceIdMatch && queryMatch) {
      const sentenceId = sentenceIdMatch[1];
      const searchQuery = queryMatch[1].trim();
      
      logger.info(`[ChatBridge] Single sentence search: ${sentenceId} - ${searchQuery}`);
      
      let searchResultText = `\n\n## ${sentenceId} 文献检索结果\n\n`;
      searchResultText += `**检索词**：${searchQuery}\n\n`;
      try {
        const queryResults = await getRetrievalEngine().retrieve({
          query: searchQuery,
          topK: 5,
          searchMode: 'hybrid',
        });

        if (queryResults.results.length === 0) {
          searchResultText += `*未找到相关文献*\n\n`;
        } else {
          queryResults.results.forEach((doc, index) => {
            const firstAuthor = doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown';
            searchResultText += `${index + 1}. **${doc.title}**\n`;
            searchResultText += `   (${firstAuthor} et al., ${doc.year})\n`;
            if (doc.journal) searchResultText += `   *${doc.journal}*\n`;
            if (doc.abstract) searchResultText += `   ${doc.abstract.substring(0, 180)}...\n`;
            searchResultText += `\n`;
          });
        }
      } catch (error) {
        logger.warn(`[ChatBridge] Single sentence search failed for "${searchQuery}":`, error);
        searchResultText += `*检索失败：${(error as Error).message}*\n\n`;
      }
      
      aiResponse = aiResponse.replace(singleSentenceMatch[0], searchResultText);
    }
  }
  
  const memoryConfig = resolveMemoryExtractionConfig(apiUrl, apiKey, secondaryModel);
  updateMemoryAsync(userId, userMessage, aiResponse, memoryConfig.apiUrl, memoryConfig.apiKey, model, memoryConfig.secondaryModel).catch(e => {
    logger.warn('[ChatBridge] Failed to update memory:', e);
  });
  
  return aiResponse;
}

/**
 * 更新用户记忆（规则提取 + AI 智能提取）
 * 添加 AI 提取 experiment_summary 和 data_summary 的逻辑
 */
async function updateMemoryAsync(
  userId: string, 
  userMessage: string, 
  aiResponse: string,
  apiUrl?: string,
  apiKey?: string,
  model?: string,
  secondaryModel?: string
): Promise<void> {
  try {
    await withMemoryLock(userId, async () => {
    const memory = await loadUserMemory(userId);
    
    // 1. 规则提取（快速提取写作进度、期刊等）
    const extractedInfo = extractMemoryByRules(userMessage, aiResponse);
    
    for (const [key, value] of Object.entries(extractedInfo)) {
      // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
      autoRestoreDeletedKeyIfEmpty(memory, key);
      
      // Bug fix: 检查该键是否已被用户删除，如果是则跳过写入
      if (isKeyDeleted(memory, key)) {
        logger.info(`[ChatBridge] SKIP "${key}" - user has deleted this key (protected from auto-restore)`);
        continue;
      }
      
      // Bug fix: 确保 value 是字符串类型
      if (value && typeof value === 'string' && value.trim()) {
        const existingIndex = memory.entries.findIndex(e => e.key === key);
        const entry: MemoryEntry = {
          key,
          value: value.trim(),
          source: 'chat-bridge-conversation',
          timestamp: new Date().toISOString()
        };
        
        if (existingIndex >= 0) {
          memory.entries[existingIndex] = entry;
        } else {
          memory.entries.push(entry);
        }
      }
    }
    
    // 2. AI 智能提取 experiment_summary 和 data_summary（需要 API 配置）
    // 使用用户配置的小牛马模型进行记忆提取（而非主模型）
    const effectiveSecondaryModel = secondaryModel || process.env.SECONDARY_MODEL || 'gpt-4o-mini';
    
    if (apiUrl && apiKey && effectiveSecondaryModel) {
      try {
        logger.info(`[ChatBridge] Starting AI memory extraction with SecondaryAgent model: ${effectiveSecondaryModel}`);
        
        // 获取现有记忆（用于智能合并）
        const existingExperimentSummary = memory.entries.find(e => e.key === 'experiment_summary')?.value || '';
        const existingDataSummary = memory.entries.find(e => e.key === 'data_summary')?.value || '';
        
        // AI 提取 prompt
        const extractPrompt = `请分析以下对话，提取关键研究信息。

【用户消息】
${userMessage.substring(0, 1500)}

【AI 回复】
${aiResponse.substring(0, 2500)}

【输出格式 - 请严格按以下格式返回】
实验资料总结：[从对话中提取所有实验背景、目的、方法、结果、结论等信息，写成一段话；如果包含试验地土壤物理、化学、生物指标，如pH、有机质/有机碳、全氮、有效氮/磷/钾、容重、质地、含水量/WFPS、微生物量、酶活性、微生物群落等，必须保留；没有则留空或不写。如果没有相关内容，填"未提供"]
数据详细总结：[从对话中提取所有数据、统计结果、对比分析等，写成一段话。如果没有相关内容，填"未提供"]

【重要】
- 如果对话内容不涉及实验资料或数据，填"未提供"
- 直接写成连贯的文字段落，不要分点
- 保留所有具体数值
- 试验地土壤物化生指标有则填写，没有就留空，不要编造`;

        // 使用小牛马模型进行信息提取
        const extractResponse = await fetch(apiUrl + "/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model: effectiveSecondaryModel,  // 使用小牛马模型而非主模型
            messages: [{ role: "system", content: extractPrompt }],
            temperature: 0.3,
            max_tokens: 32000,
          }),
        });
        
        if (extractResponse.ok) {
          const extractData = await extractResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
          const extractContent = extractData.choices?.[0]?.message?.content || "";
          
          // 解析提取内容
          const experimentMatch = extractContent.match(/实验资料总结[：:]\s*(.+?)(?:\n|数据详细总结|$)/s);
          const dataMatch = extractContent.match(/数据详细总结[：:]\s*(.+?)$/s);
          
          let experimentSummary = experimentMatch ? experimentMatch[1].trim() : '';
          let dataSummary = dataMatch ? dataMatch[1].trim() : '';
          
          // 智能合并（如果已有现有记忆且新内容不是"未提供"）
          if (experimentSummary && experimentSummary !== '未提供' && experimentSummary.length > 10) {
            if (existingExperimentSummary && existingExperimentSummary !== '未提供') {
              // 使用共享的 AI 智能整合函数
              experimentSummary = await aiMergeMemoryContent(
                existingExperimentSummary,
                experimentSummary,
                'experiment_summary',
                apiUrl,
                apiKey,
                effectiveSecondaryModel
              );
            }
            
            // 更新 experiment_summary
            // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
            autoRestoreDeletedKeyIfEmpty(memory, 'experiment_summary');
            
            // Bug fix: 检查该键是否已被用户删除
            if (isKeyDeleted(memory, 'experiment_summary')) {
              logger.info(`[ChatBridge] SKIP "experiment_summary" - user has deleted this key`);
            } else {
              // ========== 新增：长度限制和智能压缩 ==========
              const MAX_MEMORY_LENGTH = 10000;
              let finalExperimentSummary = experimentSummary;
              
              if (experimentSummary.length > MAX_MEMORY_LENGTH) {
                logger.warn(`[ChatBridge] experiment_summary exceeds ${MAX_MEMORY_LENGTH} chars (${experimentSummary.length}), triggering compression`);
                
                // 调用 AI 压缩
                const compressPrompt = `以下实验资料总结过长，请压缩为精简版本，保留核心信息。

## 原内容（${experimentSummary.length} 字）
${experimentSummary.substring(0, 8000)}

## 压缩要求
1. 保留所有关键实验细节（地点、方法、处理）
2. 保留关键数值和对比结果
3. 删除冗余描述和重复内容
4. 目标长度：约 6000 字以内
5. 使用连贯的学术语言

直接输出压缩后的完整内容：`;

                try {
                  const compressResponse = await fetch(apiUrl + "/chat/completions", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: "Bearer " + apiKey,
                    },
                    body: JSON.stringify({
                      model: effectiveSecondaryModel,
                      messages: [{ role: "user", content: compressPrompt }],
                      temperature: 0.3,
                      max_tokens: 32000,
                    }),
                  });
                  
                  if (compressResponse.ok) {
                    const compressData = await compressResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
                    const compressed = compressData.choices?.[0]?.message?.content?.trim();
                    if (compressed && compressed.length > 100) {
                      finalExperimentSummary = compressed;
                      logger.info(`[ChatBridge] experiment_summary compressed: ${experimentSummary.length} → ${compressed.length} chars`);
                    }
                  }
                } catch (compressError) {
                  logger.warn('[ChatBridge] Compression failed, keeping original:', compressError);
                  // 压缩失败，截取前 MAX_MEMORY_LENGTH 字符作为 fallback
                  finalExperimentSummary = experimentSummary.substring(0, MAX_MEMORY_LENGTH);
                }
              }
              
              const existingExpIndex = memory.entries.findIndex(e => e.key === 'experiment_summary');
              const expEntry: MemoryEntry = {
                key: "experiment_summary",
                value: finalExperimentSummary,
                source: 'ai-extracted',
                timestamp: new Date().toISOString()
              };
              if (existingExpIndex >= 0) {
                memory.entries[existingExpIndex] = expEntry;
              } else {
                memory.entries.push(expEntry);
              }
              logger.info(`[ChatBridge] experiment_summary updated: ${finalExperimentSummary.length} chars`);
            }
          }
          
          if (dataSummary && dataSummary !== '未提供' && dataSummary.length > 10) {
            if (existingDataSummary && existingDataSummary !== '未提供') {
              // 使用共享的 AI 智能整合函数
              dataSummary = await aiMergeMemoryContent(
                existingDataSummary,
                dataSummary,
                'data_summary',
                apiUrl,
                apiKey,
                effectiveSecondaryModel
              );
            }
            
            // 更新 data_summary
            // Bug fix: 如果字段被删除但值为空，自动恢复，允许重新提取
            autoRestoreDeletedKeyIfEmpty(memory, 'data_summary');
            
            // Bug fix: 检查该键是否已被用户删除
            if (isKeyDeleted(memory, 'data_summary')) {
              logger.info(`[ChatBridge] SKIP "data_summary" - user has deleted this key`);
            } else {
              // ========== 新增：长度限制和智能压缩 ==========
              const MAX_MEMORY_LENGTH = 10000;
              let finalDataSummary = dataSummary;
              
              if (dataSummary.length > MAX_MEMORY_LENGTH) {
                logger.warn(`[ChatBridge] data_summary exceeds ${MAX_MEMORY_LENGTH} chars (${dataSummary.length}), triggering compression`);
                
                // 调用 AI 压缩
                const compressPrompt = `以下数据详细总结过长，请压缩为精简版本，保留核心数据。

## 原内容（${dataSummary.length} 字）
${dataSummary.substring(0, 8000)}

## 压缩要求
1. 保留所有关键数值和统计结果
2. 保留处理对比数据
3. 删除冗余解释和重复内容
4. 目标长度：约 6000 字以内
5. 使用连贯的学术语言

直接输出压缩后的完整内容：`;

                try {
                  const compressResponse = await fetch(apiUrl + "/chat/completions", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: "Bearer " + apiKey,
                    },
                    body: JSON.stringify({
                      model: effectiveSecondaryModel,
                      messages: [{ role: "user", content: compressPrompt }],
                      temperature: 0.3,
                      max_tokens: 32000,
                    }),
                  });
                  
                  if (compressResponse.ok) {
                    const compressData = await compressResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
                    const compressed = compressData.choices?.[0]?.message?.content?.trim();
                    if (compressed && compressed.length > 100) {
                      finalDataSummary = compressed;
                      logger.info(`[ChatBridge] data_summary compressed: ${dataSummary.length} → ${compressed.length} chars`);
                    }
                  }
                } catch (compressError) {
                  logger.warn('[ChatBridge] Compression failed, keeping original:', compressError);
                  finalDataSummary = dataSummary.substring(0, MAX_MEMORY_LENGTH);
                }
              }
              
              const existingDataIndex = memory.entries.findIndex(e => e.key === 'data_summary');
              const dataEntry: MemoryEntry = {
                key: "data_summary",
                value: finalDataSummary,
                source: 'ai-extracted',
                timestamp: new Date().toISOString()
              };
              if (existingDataIndex >= 0) {
                memory.entries[existingDataIndex] = dataEntry;
              } else {
                memory.entries.push(dataEntry);
              }
              logger.info(`[ChatBridge] data_summary updated: ${finalDataSummary.length} chars`);
            }
          }
        }
      } catch (aiError) {
        logger.warn('[ChatBridge] AI extraction failed, using rules only:', aiError);
      }
    } else {
      logger.info('[ChatBridge] No API config provided, skipping AI memory extraction');
    }
    
    const entriesForStructuredSummaries = memory.entries.map(entry => ({ ...entry }));
    const hasExpSummary = entriesForStructuredSummaries.some(e => e.key === 'experiment_summary' && e.value && e.value.length > 10);
    const hasDataSummary = entriesForStructuredSummaries.some(e => e.key === 'data_summary' && e.value && e.value.length > 10);

    memory.updatedAt = new Date().toISOString();
    await saveUserMemory(memory);
    
    // 3. 触发结构化总结生成（后台异步，使用用户配置的小牛马模型）
    if (apiUrl && apiKey) {
      // 使用前面已定义的 effectiveSecondaryModel
      if (hasExpSummary || hasDataSummary) {
        generateStructuredSummaries(userId, entriesForStructuredSummaries, apiUrl, apiKey, effectiveSecondaryModel).catch(e => {
          logger.warn('[ChatBridge] Failed to generate structured summaries:', e);
        });
        logger.info(`[ChatBridge] Triggered structured summary generation (SecondaryAgent model: ${effectiveSecondaryModel})`);
        
        // 写入 .txt 文件
        await saveMemoryToFiles(userId, memory);
        logger.info('[ChatBridge] Memory files saved');
      }
    }
    
    logger.info(`[ChatBridge] Memory updated for ${userId}`);
    });
  } catch (e) {
    logger.error('[ChatBridge] Memory update failed:', e);
  }
}

/**
 * 构建最小后续提示词
 * 非首条消息时至少带上最小系统约束块，避免页面重开后丢上下文
 */
function buildMinimalFollowupPrompt(message: string, context: any, history?: Array<{ role: string; content: string }>): string {
  logger.info(`[Debug] buildMinimalFollowupPrompt: message="${message.substring(0, 100)}..."`);
  
  let prompt = '';
  
  // 1. systemPrompt 摘要（如果存在）
  if (context.systemPrompt) {
    const systemSummary = context.systemPrompt.substring(0, 500);
    prompt += `【系统约束】${systemSummary}${context.systemPrompt.length > 500 ? '...' : ''}\n\n`;
  }
  
  // 2. 写作进度信息（如果存在）
  if (context.memory?.writingProgress || context.memory?.paperTopic || context.memory?.targetJournal) {
    prompt += `【当前状态】\n`;
    if (context.memory?.paperTopic) {
      prompt += `- 论文主题: ${context.memory.paperTopic}\n`;
    }
    if (context.memory?.writingProgress) {
      prompt += `- 写作进度: ${context.memory.writingProgress}\n`;
    }
    if (context.memory?.targetJournal) {
      prompt += `- 目标期刊: ${context.memory.targetJournal}\n`;
    }
    prompt += '\n';
  }
  
  // 3. 参考文献部分（区分句子级检索和普通检索）
  if (context.relevantLiterature) {
    // 判断是否为句子级检索结果
    const isSentenceRetrieval = context.isSentenceRetrieval === true || 
                                  context.sentenceRetrieval === true ||
                                  (typeof context.relevantLiterature === 'string' && 
                                   context.relevantLiterature.includes('句子级检索') ||
                                   context.relevantLiterature.includes('sentence retrieval'));
    
    if (isSentenceRetrieval) {
      // 句子级检索结果：完整发送，不截断
      const litContent = typeof context.relevantLiterature === 'string' 
        ? context.relevantLiterature 
        : JSON.stringify(context.relevantLiterature);
      prompt += `【参考文献-句子级检索结果】\n${litContent}\n\n`;
      logger.info(`[Debug] Sentence retrieval literature: full content (${litContent.length} chars), no truncation`);
    } else {
      // 普通检索结果：完整发送，避免摘要或参考文献信息被截断
      const litContent = typeof context.relevantLiterature === 'string'
        ? context.relevantLiterature
        : JSON.stringify(context.relevantLiterature);
      prompt += `【参考文献】${litContent}\n\n`;
    }
  }
  
  // 4. 当前对话历史（近10条）
  if (history && history.length > 0) {
    prompt += `【当前对话历史】\n`;
    const maxHistoryToShow = 10;
    const recentHistory = history.slice(-maxHistoryToShow);
    for (const msg of recentHistory) {
      const roleLabel = msg.role === 'user' ? '用户' : 'AI';
      prompt += `${roleLabel}: ${msg.content || ''}\n\n`;
    }
    prompt += `---\n\n`;
  }

  // 5. 重要要求（固定）
  prompt += `【重要要求】\n`;
  prompt += `1. **文献引用（文内）**：必须使用 "(作者, 年份)" 格式，如 "(Wang et al., 2023)"\n`;
  prompt += `2. **文献引用（文末）**：文末必须列出所有参考文献的完整尾注信息，格式如下：\n`;
  prompt += `   - 格式："[序号] 作者全名. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx"\n`;
  prompt += `   - 示例："[1] Song, X. T. et al. (2022). Soil oxygen depletion and corresponding nitrous oxide production at hot moments in an agricultural soil. Environmental Pollution, 315, 120440. DOI: 10.1016/j.envpol.2022.120440"\n`;
  prompt += `   - 必须包含：作者、年份、标题、期刊、卷号、页码、DOI（如有）\n`;
  prompt += `3. **专业表达**：使用学术英语，结构清晰，逻辑严密\n`;
  prompt += `4. **禁止编造**：严禁编造不存在的文献或细节\n`;
  prompt += `5. **写作思路后询问**：当给用户提供某段的写作思路后，必须询问用户是否需要生成逐句的检索词\n`;
  prompt += `6. **段落参考文献列表**：生成某章节段落时，必须在段落下方列出参考文献完整信息\n`;
  prompt += `   - 格式："[作者, 年份] 作者全名. (年份). 论文标题. 期刊名, 卷号, 页码. DOI: xxx"\n`;
  prompt += `   - 示例："[Song et al., 2022] Song, X. T. et al. (2022). Soil oxygen depletion... Environmental Pollution, 315, 120440. DOI: 10.1016/j.envpol.2022.120440"\n\n`;
  
  // 6. 用户请求（检测是否为检索结果消息）
  const isRetrievalResultMessage = message.includes('🔍 文献检索结果') || 
                                     message.includes('检索论点') ||
                                     message.includes('文献检索结果（自动检索）');
  
  if (isRetrievalResultMessage) {
    // 检索结果消息：这是用户发送的参考文献列表，请使用消息中的引用格式
    prompt += `【用户请求-参考文献列表】\n`;
    prompt += `⚠️ 用户发送的内容是**文献检索结果列表**，包含检索到的参考文献。\n`;
    prompt += `**引用规则**：\n`;
    prompt += `- 直接使用消息中每篇文献的「引用格式」字段（如 "引用格式: (Song et al., 2024)"）\n`;
    prompt += `- 不要将文献信息描述为「Pasted ~N lines」，这是错误格式\n`;
    prompt += `- 在文中引用时使用 "(作者 et al., 年份)" 格式\n`;
    prompt += `- 在段落下方列出参考文献时使用消息中提供的完整信息\n\n`;
    prompt += `${message}`;
  } else {
    prompt += `【用户请求】\n${message}`;
  }
  
  const anchoredPrompt = anchorPromptWithCurrentRequest(prompt, message, {
    source: 'chat-bridge-minimal'
  });
  logger.info(`[Debug] buildMinimalFollowupPrompt: result length=${anchoredPrompt.length} (anchored, no truncation)`);
  
  return anchoredPrompt;
}

/**
 * 构建增强消息（包含所有上下文）
 * 每次都发送完整内容：核心上下文、长期记忆、历史对话、用户请求、重要要求
 * 
 * @param message 用户请求
 * @param context 上下文信息（长期记忆、写作进度等）
 * @param history 当前对话的历史消息（可选）
 */
function resolveAnalysisContextSourceLabel(pinned: unknown, explicit: unknown): string {
  if (pinned) return '输入框上方已选';
  if (explicit) return '手动选择';
  return '自动识别';
}

function buildEnrichedMessage(message: string, context: any, history?: Array<{ role: string; content: string }>): string {
  
  logger.info(`[Debug] buildEnrichedMessage: message="${message.substring(0, 100)}...", history=${history?.length || 0} msgs`);

  let enrichedPrompt = '';

  // 1. 系统提示词
  if (context.systemPrompt) {
    enrichedPrompt += `${context.systemPrompt}\n\n`;
  } else {
    enrichedPrompt += `你是一个专业的学术论文写作助手。

## 文献引用要求
1. **文内引用**：必须使用 "(作者, 年份)" 格式，如 "(Wang et al., 2023)"
2. **文末尾注**：文末必须列出所有参考文献的完整尾注信息，包含：作者、年份、标题、期刊、卷号、页码、DOI，格式如下：
   - "[序号] 作者全名. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx"
   - 示例："[1] Song, X. T. et al. (2022). Soil oxygen depletion and corresponding nitrous oxide production at hot moments in an agricultural soil. Environmental Pollution, 315, 120440. DOI: 10.1016/j.envpol.2022.120440"

`;
  }

  // 2. 用户自定义灵魂
  if (context.soulContent) {
    enrichedPrompt += `## 👤 用户自定义设定\n${context.soulContent}\n\n`;
  }

  // 3. 写作任务类型
  if (context.taskType) {
    enrichedPrompt += `## 🎯 写作任务\n${context.taskType}\n\n`;
  }

  // 4. 写作进度
  if (context.memory?.writingProgress) {
    enrichedPrompt += `## 📝 当前写作进度\n${context.memory.writingProgress}\n\n`;
  }

  // 5. 已完成章节
  if (context.memory?.completedChapters) {
    enrichedPrompt += `## ✅ 已完成章节\n${context.memory.completedChapters}\n\n`;
  }

  // 6. 待完成章节
  if (context.memory?.pendingChapters) {
    enrichedPrompt += `## 📋 待完成章节\n${context.memory.pendingChapters}\n\n`;
  }

  // 7. 跨会话长久记忆
  if (context.memory?.conversations && context.memory.conversations.length > 0) {
    enrichedPrompt += `## 🧠 跨会话长久记忆\n`;
    enrichedPrompt += `系统已记录您之前分享的信息：\n`;
    
    let remainingHistoricalMessages = 10;
    for (const conv of context.memory.conversations) {
      if (remainingHistoricalMessages <= 0) {
        break;
      }
      if (conv.messages && conv.messages.length > 0) {
        const recentMessages = conv.messages.slice(-remainingHistoricalMessages);
        enrichedPrompt += `\n### ${conv.title || '对话'}\n`;
        for (const msg of recentMessages) {
          const role = msg.role === 'user' ? '用户' : 'AI';
          enrichedPrompt += `**${role}**: ${msg.content || ''}\n`;
        }
        remainingHistoricalMessages -= recentMessages.length;
      } else if (conv.summary) {
        enrichedPrompt += `- **${conv.title || '对话'}**: ${conv.summary}\n`;
      }
    }
    enrichedPrompt += '\n';
  }

  // 8. 历史记忆
  if (context.memory?.other && context.memory.other.length > 0) {
    enrichedPrompt += `## 🧠 跨会话长期记忆（完整）\n`;
    for (const entry of context.memory.other) {
      if (entry.key && entry.value) {
        const value = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
        enrichedPrompt += `- **${entry.key}**: ${value}\n`;
      }
    }
    enrichedPrompt += '\n';
  }

  // 9. 文献计量分析上下文
  if (context.bibliometrics) {
    const bibliometricsSourceLabel = resolveAnalysisContextSourceLabel(context.bibliometricsPinned, context.bibliometricsExplicit);
    enrichedPrompt += `## 文献计量分析结果与图片（${bibliometricsSourceLabel}）\n`;
    if (context.bibliometrics.contextMarkdown) {
      enrichedPrompt += `${context.bibliometrics.contextMarkdown}\n\n`;
    } else {
      enrichedPrompt += '```json\n';
      enrichedPrompt += `${JSON.stringify(context.bibliometrics, null, 2)}\n`;
      enrichedPrompt += '```\n\n';
    }
  }

  // 10. Meta 分析结果上下文
  if (context.metaAnalysis) {
    const metaAnalysisSourceLabel = resolveAnalysisContextSourceLabel(context.metaAnalysisPinned, context.metaAnalysisExplicit);
    enrichedPrompt += `## Meta 分析结果与效应量数据（${metaAnalysisSourceLabel}）\n`;
    if (context.metaAnalysis.contextMarkdown) {
      enrichedPrompt += `${context.metaAnalysis.contextMarkdown}\n\n`;
    } else {
      enrichedPrompt += '```json\n';
      enrichedPrompt += `${JSON.stringify(context.metaAnalysis, null, 2)}\n`;
      enrichedPrompt += '```\n\n';
    }
  }

  // 11. Auto Research 结果上下文
  if (context.autoResearch) {
    const autoResearchSourceLabel = resolveAnalysisContextSourceLabel(context.autoResearchPinned, context.autoResearchExplicit);
    enrichedPrompt += `## Auto Research 调研结果与写作蓝图（${autoResearchSourceLabel}）\n`;
    if (context.autoResearch.contextMarkdown) {
      enrichedPrompt += `${context.autoResearch.contextMarkdown}\n\n`;
    } else {
      enrichedPrompt += '```json\n';
      enrichedPrompt += `${JSON.stringify(context.autoResearch, null, 2)}\n`;
      enrichedPrompt += '```\n\n';
    }
  }

  // 12. 联网搜索结果
  if (context.webSearchContext) {
    enrichedPrompt += `## 🌐 联网搜索结果\n`;
    enrichedPrompt += `${context.webSearchContext}\n\n`;
  }

  // 13. 当前对话历史（每次都发送）
  if (history && history.length > 0) {
    enrichedPrompt += `## 💭 当前对话历史\n`;
    enrichedPrompt += `以下是本次对话中之前的交流内容：\n\n`;
    
    // 限制历史长度，避免过长
    const maxHistoryToShow = 10;
    const recentHistory = history.slice(-maxHistoryToShow);
    
    for (const msg of recentHistory) {
      const roleLabel = msg.role === 'user' ? '👤 用户' : '🤖 AI';
      enrichedPrompt += `${roleLabel}: ${msg.content || ''}\n\n`;
    }
    enrichedPrompt += `---\n\n`;
  }

  // 13. 回答要求（包含长期记忆中的用户相关要求）
  enrichedPrompt += `## ⚠️ 重要要求\n`;
  enrichedPrompt += `1. **文献引用（文内）**：必须使用 "(作者, 年份)" 格式，如 "(Wang et al., 2023)"\n`;
  enrichedPrompt += `2. **文献引用（文末尾注）**：文末必须列出所有参考文献的完整尾注信息，包含：作者、年份、标题、期刊、卷号、页码、DOI，格式如下：\n`;
  enrichedPrompt += `   - "[序号] 作者全名. (年份). 论文标题. 期刊名, 卷号(期号), 页码. DOI: xxx"\n`;
  enrichedPrompt += `   - 示例："[1] Song, X. T. et al. (2022). Soil oxygen depletion and corresponding nitrous oxide production at hot moments in an agricultural soil. Environmental Pollution, 315, 120440. DOI: 10.1016/j.envpol.2022.120440"\n`;
  enrichedPrompt += `3. **专业表达**：使用学术英语，结构清晰，逻辑严密\n`;
  enrichedPrompt += `4. **禁止编造**：严禁编造不存在的文献或细节\n`;
  enrichedPrompt += `5. **写作思路后询问**：当给用户提供某段的写作思路后，必须询问用户是否需要生成逐句的检索词（用于从文献库检索支撑该句的文献）\n`;
  enrichedPrompt += `6. **段落参考文献列表**：当生成某章节的某个段落时，必须在段落下方列出参考文献的完整信息，格式为：\n`;
  enrichedPrompt += `   - "[作者, 年份] 作者全名. (年份). 论文标题. 期刊名, 卷号, 页码. DOI: xxx"\n`;
  enrichedPrompt += `   - 示例："[Song et al., 2022] Song, X. T. et al. (2022). Soil oxygen depletion and corresponding nitrous oxide production at hot moments in an agricultural soil. Environmental Pollution, 315, 120440. DOI: 10.1016/j.envpol.2022.120440"\n`;
  
  // 从长期记忆中提取用户的所有相关要求
  const userRequirements: string[] = [];
  if (context.memory?.other && context.memory.other.length > 0) {
    for (const entry of context.memory.other) {
      if (entry.key && entry.value) {
        // 检测是否是要求类型的内容
        const keyLower = entry.key.toLowerCase();
        const valueStr = typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value);
        
        // 筛选与写作要求相关的key
        if (keyLower.includes('要求') || 
            keyLower.includes('requirement') ||
            keyLower.includes('偏好') || 
            keyLower.includes('preference') ||
            keyLower.includes('风格') || 
            keyLower.includes('style') ||
            keyLower.includes('格式') || 
            keyLower.includes('format') ||
            keyLower.includes('约束') || 
            keyLower.includes('constraint') ||
            keyLower.includes('注意') || 
            keyLower.includes('note') ||
            keyLower.includes('限制') || 
            keyLower.includes('limit') ||
            keyLower.includes('期刊') ||
            keyLower.includes('journal')) {
          userRequirements.push(`- **${entry.key}**: ${valueStr}`);
        }
      }
    }
  }
  
  // 添加用户自定义要求
  if (userRequirements.length > 0) {
    enrichedPrompt += `\n### 📋 用户自定义要求（来自长期记忆）\n`;
    enrichedPrompt += `以下要求由用户在之前的对话中提出，请严格遵守：\n`;
    enrichedPrompt += `${userRequirements.join('\n')}\n`;
  }
  enrichedPrompt += '\n';

  // 15. 论文草稿功能说明
  enrichedPrompt += `## 📝 论文草稿功能\n`;
  enrichedPrompt += `当用户要求"保存到草稿"时，请在回复最后包含以下格式的触发指令：\n`;
  enrichedPrompt += '```\n';
  enrichedPrompt += '🔧 调用工具：save_draft\n';
  enrichedPrompt += 'content: |\n';
  enrichedPrompt += '[LaTeX格式的章节内容]\n';
  enrichedPrompt += 'section: [章节名，如 introduction, methods]\n';
  enrichedPrompt += 'references: |\n';
  enrichedPrompt += '[参考文献完整列表，格式如下]\n';
  enrichedPrompt += '- [作者, 年份] 作者全名. (年份). 论文标题. 期刊名, 卷号, 页码.\n';
  enrichedPrompt += '- 示例：[Song et al., 2022] Song, X. T. et al. (2022). Soil oxygen depletion... Environmental Pollution, 315, 120440.\n';
  enrichedPrompt += '```\n\n';
  enrichedPrompt += `**重要**：references 字段必须列出本章节引用的所有文献的完整信息，不要遗漏。\n\n`;

  // 16. 用户请求（检测是否为检索结果消息）
  const isRetrievalResultMessage = message.includes('🔍 文献检索结果') || 
                                     message.includes('检索论点') ||
                                     message.includes('文献检索结果（自动检索）');
  
  if (isRetrievalResultMessage) {
    // 检索结果消息：这是用户发送的参考文献列表，请使用消息中的引用格式
    enrichedPrompt += `## 💬 用户请求-参考文献列表\n`;
    enrichedPrompt += `⚠️ 用户发送的内容是**文献检索结果列表**，包含检索到的参考文献。\n`;
    enrichedPrompt += `**引用规则**：\n`;
    enrichedPrompt += `- 直接使用消息中每篇文献的「引用格式」字段（如 "**引用格式**: (Song et al., 2024)"）\n`;
    enrichedPrompt += `- 不要将文献信息描述为「Pasted ~N lines」，这是错误格式\n`;
    enrichedPrompt += `- 在文中引用时使用 "(作者 et al., 年份)" 格式\n`;
    enrichedPrompt += `- 在段落下方列出参考文献时使用消息中提供的完整信息\n\n`;
    enrichedPrompt += `${message}`;
  } else {
    enrichedPrompt += `## 💬 用户请求\n${message}`;
  }

  const anchoredPrompt = anchorPromptWithCurrentRequest(enrichedPrompt, message, {
    source: 'chat-bridge-enriched',
    taskType: context.taskType
  });
  const anchorDiagnostics = getPromptAnchorDiagnostics(anchoredPrompt, message);

  // 不再截断，完整发送
  logger.info(`[Debug] Final enriched message length: ${anchoredPrompt.length} characters (anchored, no truncation)`);
  logger.info(`[Debug] Current request anchor: ${JSON.stringify(anchorDiagnostics)}`);
  logger.info('[Debug] Message START (first 300 chars):', anchoredPrompt.substring(0, 300));
  logger.info('[Debug] Message END (last 300 chars):', anchoredPrompt.substring(anchoredPrompt.length - 300));

  return anchoredPrompt;
}

/**
 * 智能截断提示词
 * 优先级：用户请求 > 重要要求 > 论文草稿 > 网络搜索 > 写作进度 > 长期记忆
 */
function truncatePrompt(prompt: string, userMessage: string, maxLength: number): string {
  logger.warn(`[Truncate] Prompt too long (${prompt.length} chars), truncating to ${maxLength} chars`);
  
  const sections = prompt.split('\n## ');
  const priorityOrder = [
    '💬 用户请求',
    '⚠️ 重要要求',
    '📝 论文草稿功能',
    '🌐 联网搜索结果',
    '📋 待完成章节',
    '✅ 已完成章节',
    '📝 当前写作进度',
    '🧠 跨会话长久记忆',
    '🧠 历史记忆',
    '🧠 跨会话长期记忆',
    '📖 系统提示',
    '👤 用户自定义设定',
    '🎯 写作任务'
  ];
  
  const sortedSections: (string | undefined)[] = new Array(priorityOrder.length);
  const otherSections: string[] = [];
  
  for (const section of sections) {
    if (!section.trim()) continue;
    const sectionTitle = section.split('\n')[0];
    const priorityIndex = priorityOrder.findIndex(p => sectionTitle.includes(p));
    if (priorityIndex >= 0) {
      sortedSections[priorityIndex] = section;
    } else {
      otherSections.push(section);
    }
  }
  
  let result = '';
  const addedSections: string[] = [];
  
  // 先添加系统提示（第一部分，通常是系统提示）
  if (sections[0] && !sections[0].startsWith('##')) {
    result = sections[0];
    addedSections.push('system');
  }
  
  // 按优先级添加其他section
  for (let i = 0; i < sortedSections.length; i++) {
    const section = sortedSections[i];
    if (!section) continue;
    
    const sectionWithHeader = result && !section.startsWith(result.split('\n')[0]) ? '\n## ' + section : (result ? section : section);
    
    if ((result + '\n## ' + section).length <= maxLength - 200) {
      if (result && !result.endsWith(section)) {
        result += '\n## ' + section;
      } else if (!result) {
        result = section;
      }
      addedSections.push(section.split('\n')[0]);
    } else {
      break;
    }
  }
  
  // 如果还有空间，添加其他 section
  if (result.length < maxLength - 200 && otherSections.length > 0) {
    for (const section of otherSections) {
      if (!section.trim()) continue;
      const tryAdd = result ? '\n## ' + section : section;
      if ((result + tryAdd).length <= maxLength - 100) {
        result += tryAdd;
        addedSections.push(section.split('\n')[0]);
      } else {
        break;
      }
    }
  }
  
  // 添加截断提示
  const truncatedCount = sections.length - addedSections.filter(s => s !== 'system').length;
  if (truncatedCount > 0) {
    result += '\n\n[⚠️ 提示：部分内容因长度限制已省略。]';
  }
  
  logger.info(`[Truncate] Truncated to ${result.length} chars, kept sections: ${addedSections.join(', ')}`);
  return result;
}

// ========== 浏览器桥接服务路由已注释（已弃用，使用纯API模式）==========
// 以下路由端点使用已弃用的浏览器桥接服务方法，现已注释

// /test 路由 - 测试连接 [已注释]
// router.get('/test', async (req, res) => {
//   try {
//     if (!chatBridgeAdapter) {
//       res.status(503).json({ error: 'ChatBridge not initialized' });
//       return;
//     }
//     const connected = await chatBridgeAdapter.testConnection();
//     if (connected) {
//       res.json({ success: true, message: 'ChatBridge connection successful' });
//     } else {
//       res.status(500).json({ success: false, message: 'ChatBridge connection failed' });
//     }
//   } catch (error) {
//     logger.error('[ChatBridge Route] Test error:', error);
//     res.status(500).json({ success: false, error: 'Connection test failed' });
//   }
// });

// /control 路由 - 控制操作 [已注释]
// router.post('/control', async (req, res) => {
//   try {
//     if (!chatBridgeAdapter) {
//       res.status(503).json({ success: false, error: 'ChatBridge not initialized' });
//       return;
//     }
//     const validation = validate(controlRequestSchema, req.body);
//     if (!validation.success) {
//       res.status(400).json({ success: false, error: validation.error });
//       return;
//     }
//     const { action } = validation.data;
//     switch (action) {
//       case 'newchat': await chatBridgeAdapter.newChat(); break;
//       case 'pause': await chatBridgeAdapter.pause(); break;
//       case 'resume': await chatBridgeAdapter.resume(); break;
//       case 'refresh': await chatBridgeAdapter.refreshCurrentPage(); break;
//     }
//     const state = await chatBridgeAdapter.getState();
//     res.json({ success: true, action, state });
//   } catch (error) {
//     logger.error('[ChatBridge Route] Control error:', error);
//     res.status(500).json({ success: false, error: 'Control operation failed' });
//   }
// });

// /state 路由 - 获取状态 [已注释]
// router.get('/state', async (_req, res) => {
//   try {
//     if (!chatBridgeAdapter) {
//       res.status(503).json({ success: false, error: 'ChatBridge not initialized' });
//       return;
//     }
//     const state = await chatBridgeAdapter.getState();
//     res.json({ success: true, state });
//   } catch (error) {
//     logger.error('[ChatBridge Route] State error:', error);
//     res.status(500).json({ success: false, error: 'Failed to get state' });
//   }
// });

// /open-page 路由 - 打开桥接页面 [已注释]
// router.post('/open-page', async (req, res) => {
//   try {
//     if (!chatBridgeAdapter) {
//       res.status(503).json({ success: false, error: 'ChatBridge not initialized' });
//       return;
//     }
//     const validation = validate(openPageRequestSchema, req.body);
//     if (!validation.success) {
//       res.status(400).json({ success: false, error: validation.error });
//       return;
//     }
//     const url = sanitizeUrl(validation.data.url);
//     await chatBridgeAdapter.openBridgePage(url);
//     const state = await chatBridgeAdapter.getState();
//     res.json({ success: true, message: '桥接页面已打开，请在浏览器中完成登录', state });
//   } catch (error) {
//     logger.error('[ChatBridge Route] Open page error:', error);
//     res.status(500).json({ success: false, error: 'Failed to open bridge page' });
//   }
// });

// ========== 浏览器桥接服务路由注释结束 ==========

router.post('/control', async (req, res) => {
  try {
    const validation = validate(controlRequestSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    const { action } = validation.data;
    switch (action) {
      case 'newchat':
        compatibleBridgeState.paused = false;
        break;
      case 'pause':
        compatibleBridgeState.paused = true;
        break;
      case 'resume':
        compatibleBridgeState.paused = false;
        break;
      case 'refresh':
        break;
    }

    res.json({ success: true, action, state: compatibleBridgeState });
  } catch (error) {
    logger.error('[ChatBridge Route] Control error:', error);
    res.status(500).json({ success: false, error: 'Control operation failed' });
  }
});

router.get('/state', async (_req, res) => {
  try {
    res.json({ success: true, state: compatibleBridgeState });
  } catch (error) {
    logger.error('[ChatBridge Route] State error:', error);
    res.status(500).json({ success: false, error: 'Failed to get state' });
  }
});

router.get('/codex/status', async (req, res) => {
  try {
    if (!chatBridgeAdapter) {
      res.status(503).json({ success: false, available: false, error: 'ChatBridge not initialized' });
      return;
    }
    const command = typeof req.query.command === 'string' ? req.query.command : undefined;
    const status = await chatBridgeAdapter.getCodexCliStatus(command);
    res.json({ success: true, ...status });
  } catch (error) {
    logger.error('[ChatBridge Route] Codex status error:', error);
    res.status(500).json({
      success: false,
      available: false,
      error: (error as Error).message || 'Failed to detect Codex CLI',
    });
  }
});

router.get('/codex/models', (_req, res) => {
  try {
    const result = loadCodexAvailableModels();
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('[ChatBridge Route] Codex models error:', error);
    res.status(500).json({
      success: false,
      source: 'fallback',
      models: CODEX_FALLBACK_MODELS,
      error: (error as Error).message || 'Failed to load Codex models',
    });
  }
});

router.post('/open-page', async (req, res) => {
  try {
    const validation = validate(openPageRequestSchema, req.body);
    if (!validation.success) {
      res.status(400).json({ success: false, error: validation.error });
      return;
    }

    const url = sanitizeUrl(validation.data.url);
    compatibleBridgeState = {
      serviceRunning: false,
      paused: false,
      currentUrl: url || null,
      hasActivePage: false,
    };
    res.json({ success: true, message: '当前版本使用 API 桥接模式，无需打开浏览器桥接页面', state: compatibleBridgeState });
  } catch (error) {
    logger.error('[ChatBridge Route] Open page error:', error);
    res.status(500).json({ success: false, error: 'Failed to open bridge page' });
  }
});

/**
   * POST /api/chat-bridge/config
   * 保存 ChatBridge 配置
   */
  router.post('/config', async (req, res) => {
    try {
      // 输入验证
      const validation = validate(saveConfigSchema, req.body);
      if (!validation.success) {
        res.status(400).json({ success: false, error: validation.error });
        return;
      }

      const data = validation.data;
      // 旧的浏览器模式字段（向后兼容）
      const chatUrl = data.chatUrl;
      const enabled = data.enabled;
      const credentials = data.credentials;
      const mode = data.mode;
      const apiUrl = data.apiUrl;
      const apiKey = data.apiKey;
      const loginUrl = data.loginUrl;
      const bridgeSecret = data.bridgeSecret;
      // 新的双 Agent 配置
      const primaryConfig = data.primary;
      const secondaryConfig = data.secondary;
      const codexConfig = data.codex;
      
      const defaultConfig = {
        mode: 'api',  // 默认改为 API 模式
        chat: {
          api_key: '',
          api_url: '',
          login_url: '',
          chat_url: '',
          credentials: {
            email: '',
            password: '',
          },
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
        // 新的双 Agent 默认配置
        primary: {
          api_url: '',
          api_key: '',
          model: 'claude-sonnet-4-5',
          description: '大牛马 - 规划、Skill生成、质量检查',
        },
        secondary: {
          api_url: '',
          api_key: '',
          model: 'gpt-4o',
          vision_model: 'gpt-4o',
          description: '小牛马 - 执行写作、引用验证',
        },
        codex: {
          enabled: false,
          prefer: false,
          command: '',
          model: 'gpt-5.5',
          reasoning_effort: 'xhigh',
          sandbox: 'workspace-write',
          pdf_wiki_sandbox: 'danger-full-access',
          timeout_ms: 300000,
          pdf_wiki_concurrency: 1,
        },
      };
      
      let config: any = { ...defaultConfig };
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(configData);
        config = {
          ...defaultConfig,
          ...parsed,
          chat: {
            ...defaultConfig.chat,
            ...(parsed.chat || {}),
            credentials: {
              ...defaultConfig.chat.credentials,
              ...(parsed.chat?.credentials || {}),
            },
          },
          browser: {
            ...defaultConfig.browser,
            ...(parsed.browser || {}),
          },
          service: {
            ...defaultConfig.service,
            ...(parsed.service || {}),
          },
          primary: {
            ...defaultConfig.primary,
            ...(parsed.primary || {}),
          },
          secondary: {
            ...defaultConfig.secondary,
            ...(parsed.secondary || {}),
          },
          codex: {
            ...defaultConfig.codex,
            ...(parsed.codex || {}),
          },
        };
      }
      
      // ========== 处理旧字段（向后兼容） ==========
      if (enabled !== undefined) {
        config.service.enabled = Boolean(enabled);
      }
      
      if (chatUrl !== undefined) {
        config.chat.chat_url = sanitizeUrl(chatUrl);
      }
      
      if (mode !== undefined) {
        config.mode = mode;
      }
      
      if (apiUrl !== undefined) {
        config.chat.api_url = sanitizeUrl(apiUrl);
      }
      
      // 加密保存 API Key（旧字段）
      if (apiKey !== undefined && apiKey !== '') {
        const { encrypt } = await import('../../utils/encryption');
        config.chat.api_key = encrypt(sanitizeString(apiKey));
      }
      
      if (loginUrl !== undefined) {
        config.chat.login_url = sanitizeUrl(loginUrl);
      }
      
      // 加密保存凭据（增量更新）
      if (credentials !== undefined) {
        const { encrypt } = await import('../../utils/encryption');
        
        const existingEmail = config.chat.credentials?.email || '';
        const existingPassword = config.chat.credentials?.password || '';
        
        config.chat.credentials = {
          email: credentials.email !== undefined ? sanitizeString(credentials.email) : existingEmail,
          password: credentials.password ? encrypt(sanitizeString(credentials.password)) : existingPassword,
        };
      }
      
      // 加密保存 bridge_secret
      if (bridgeSecret !== undefined && bridgeSecret !== '') {
        const { encrypt } = await import('../../utils/encryption');
        config.chat.bridge_secret = encrypt(sanitizeString(bridgeSecret));
      }
      
      // ========== 处理新的双 Agent 配置 ==========
      // 处理 primary（大牛马）配置
      if (primaryConfig !== undefined) {
        const { encrypt } = await import('../../utils/encryption');
        
        config.primary = {
          ...config.primary,
          ...(primaryConfig.api_url !== undefined && { api_url: sanitizeUrl(primaryConfig.api_url) }),
          ...(primaryConfig.model !== undefined && { model: sanitizeString(primaryConfig.model) }),
          ...(primaryConfig.description !== undefined && { description: sanitizeString(primaryConfig.description) }),
        };
        
        // 加密保存 primary.api_key
        if (primaryConfig.api_key !== undefined && primaryConfig.api_key !== '') {
          config.primary.api_key = encrypt(sanitizeString(primaryConfig.api_key));
        }
      }
      
      // 处理 secondary（小牛马）配置
      if (secondaryConfig !== undefined) {
        const { encrypt } = await import('../../utils/encryption');
        
        config.secondary = {
          ...config.secondary,
          ...(secondaryConfig.api_url !== undefined && { api_url: sanitizeUrl(secondaryConfig.api_url) }),
          ...(secondaryConfig.model !== undefined && { model: sanitizeString(secondaryConfig.model) }),
          ...(secondaryConfig.vision_model !== undefined && { vision_model: sanitizeString(secondaryConfig.vision_model) }),
          ...(secondaryConfig.description !== undefined && { description: sanitizeString(secondaryConfig.description) }),
        };
        
        // 加密保存 secondary.api_key
        if (secondaryConfig.api_key !== undefined && secondaryConfig.api_key !== '') {
          config.secondary.api_key = encrypt(sanitizeString(secondaryConfig.api_key));
        }
      }

      if (codexConfig !== undefined) {
        const codexConcurrency = codexConfig.pdf_wiki_concurrency ?? codexConfig.concurrency;
        config.codex = {
          ...config.codex,
          ...(codexConfig.enabled !== undefined && { enabled: Boolean(codexConfig.enabled) }),
          ...(codexConfig.prefer !== undefined && { prefer: Boolean(codexConfig.prefer) }),
          ...(codexConfig.command !== undefined && { command: sanitizeString(codexConfig.command) }),
          ...(codexConfig.model !== undefined && { model: sanitizeString(codexConfig.model) }),
          ...(codexConfig.reasoning_effort !== undefined && { reasoning_effort: sanitizeString(codexConfig.reasoning_effort) }),
          ...(codexConfig.sandbox !== undefined && { sandbox: sanitizeString(codexConfig.sandbox) }),
          ...(codexConfig.pdf_wiki_sandbox !== undefined && { pdf_wiki_sandbox: sanitizeString(codexConfig.pdf_wiki_sandbox) }),
          ...(codexConfig.timeout_ms !== undefined && { timeout_ms: Number(codexConfig.timeout_ms) || 300000 }),
          ...(codexConcurrency !== undefined && { pdf_wiki_concurrency: Math.max(1, Math.min(6, Math.floor(Number(codexConcurrency) || 1))) }),
        };
      }
      
      // 保存配置
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      // 脱敏日志
      const hasPrimaryApiKey = !!config.primary?.api_key;
      const hasSecondaryApiKey = !!config.secondary?.api_key;
      logger.info(`[ChatBridge] Config saved: mode=${config.mode}, primary_url=${config.primary?.api_url ? 'configured' : 'empty'}, primary_model=${config.primary?.model}, secondary_url=${config.secondary?.api_url ? 'configured' : 'empty'}, secondary_model=${config.secondary?.model}, codex_prefer=${!!config.codex?.prefer}, has_primary_key=${hasPrimaryApiKey}, has_secondary_key=${hasSecondaryApiKey}`);
      
      if (chatBridgeAdapter) {
        await chatBridgeAdapter.loadConfig();
      }
      
      res.json({
        success: true,
        message: 'Configuration saved successfully',
        config: {
          mode: config.mode,
          service: config.service,
          // 新的双 Agent 配置返回
          primary: {
            api_url: config.primary?.api_url || '',
            model: config.primary?.model || 'claude-sonnet-4-5',
            has_api_key: hasPrimaryApiKey,
            description: config.primary?.description || '',
          },
          secondary: {
            api_url: config.secondary?.api_url || '',
            model: config.secondary?.model || 'gpt-4o',
            vision_model: config.secondary?.vision_model || config.secondary?.model || 'gpt-4o',
            has_api_key: hasSecondaryApiKey,
            description: config.secondary?.description || '',
          },
          codex: {
            enabled: !!config.codex?.enabled,
            prefer: !!config.codex?.prefer,
            command: config.codex?.command || '',
            model: config.codex?.model || 'gpt-5.5',
            reasoning_effort: config.codex?.reasoning_effort || 'xhigh',
            sandbox: config.codex?.sandbox || 'workspace-write',
            pdf_wiki_sandbox: config.codex?.pdf_wiki_sandbox || 'danger-full-access',
            timeout_ms: config.codex?.timeout_ms || 300000,
            pdf_wiki_concurrency: config.codex?.pdf_wiki_concurrency || (config.codex as any)?.concurrency || 1,
          },
          // 旧字段返回（向后兼容）
          chat_url: config.chat.chat_url,
          api_url: config.chat.api_url,
          login_url: config.chat.login_url,
          has_api_key: !!config.chat?.api_key,
          has_bridge_secret: !!config.chat?.bridge_secret,
          has_credentials: !!(config.chat?.credentials?.email && config.chat?.credentials?.password),
        }
      });
    } catch (error) {
      logger.error('[ChatBridge Route] Config save error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to save configuration',
      });
    }
  });

/**
 * GET /api/chat-bridge/config
 * 获取当前 ChatBridge 配置（脱敏）
 */
router.get('/config', (req, res) => {
  try {
    const defaultConfig = {
      mode: 'api',
      chat: {
        api_key: '',
        api_url: '',
        login_url: '',
        chat_url: '',
        credentials: {
          email: '',
          password: '',
        },
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
      primary: {
        api_url: '',
        api_key: '',
        model: 'claude-sonnet-4-5',
        description: '大牛马 - 规划、Skill生成、质量检查',
      },
      secondary: {
        api_url: '',
        api_key: '',
        model: 'gpt-4o',
        vision_model: 'gpt-4o',
        description: '小牛马 - 执行写作、引用验证',
      },
      codex: {
        enabled: false,
        prefer: false,
        command: '',
        model: 'gpt-5.5',
        reasoning_effort: 'xhigh',
        sandbox: 'workspace-write',
        pdf_wiki_sandbox: 'danger-full-access',
        timeout_ms: 300000,
        pdf_wiki_concurrency: 1,
      },
    };

    let config = { ...defaultConfig };
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(configData);
      config = {
        ...defaultConfig,
        ...parsed,
        chat: {
          ...defaultConfig.chat,
          ...(parsed.chat || {}),
          credentials: {
            ...defaultConfig.chat.credentials,
            ...(parsed.chat?.credentials || {}),
          },
        },
        browser: {
          ...defaultConfig.browser,
          ...(parsed.browser || {}),
        },
        service: {
          ...defaultConfig.service,
          ...(parsed.service || {}),
        },
        primary: {
          ...defaultConfig.primary,
          ...(parsed.primary || {}),
        },
        secondary: {
          ...defaultConfig.secondary,
          ...(parsed.secondary || {}),
        },
        codex: {
          ...defaultConfig.codex,
          ...(parsed.codex || {}),
        },
      };
    }

    // 脱敏返回
    const maskedEmail = maskEmail(config.chat.credentials.email);
    const hasPassword = !!config.chat.credentials.password;
    const hasApiKey = !!config.chat.api_key;
    const hasPrimaryApiKey = !!config.primary?.api_key;
    const hasSecondaryApiKey = !!config.secondary?.api_key;
    
    res.json({
      success: true,
      config: {
        mode: config.mode,
        service: config.service,
        browser: config.browser,
        // 新的双 Agent 配置返回
        primary: {
          api_url: config.primary?.api_url || '',
          model: config.primary?.model || 'claude-sonnet-4-5',
          has_api_key: hasPrimaryApiKey,
          description: config.primary?.description || '',
        },
        secondary: {
          api_url: config.secondary?.api_url || '',
          model: config.secondary?.model || 'gpt-4o',
          vision_model: config.secondary?.vision_model || config.secondary?.model || 'gpt-4o',
          has_api_key: hasSecondaryApiKey,
          description: config.secondary?.description || '',
        },
        codex: {
          enabled: !!config.codex?.enabled,
          prefer: !!config.codex?.prefer,
          command: config.codex?.command || '',
          model: config.codex?.model || 'gpt-5.5',
          reasoning_effort: config.codex?.reasoning_effort || 'xhigh',
          sandbox: config.codex?.sandbox || 'workspace-write',
          pdf_wiki_sandbox: config.codex?.pdf_wiki_sandbox || 'danger-full-access',
          timeout_ms: config.codex?.timeout_ms || 300000,
          pdf_wiki_concurrency: config.codex?.pdf_wiki_concurrency || (config.codex as any)?.concurrency || 1,
        },
        // 旧字段返回（向后兼容）
        chat_url: config.chat.chat_url,
        api_url: config.chat.api_url || '',
        has_api_key: hasApiKey,
        credentials: {
          email: config.chat.credentials.email || '',
          has_password: hasPassword,
        },
        has_credentials: !!config.chat.credentials.email,
        masked_email: maskedEmail,
      },
    });
  } catch (error) {
    logger.error('[ChatBridge Route] Config get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration',
    });
  }
});

/**
 * GET /models
 * 使用已保存的 primary/secondary API 配置获取模型列表
 * 支持前端传递临时参数（用于获取模型列表前测试）
 */
router.post('/models', async (req, res) => {
  try {
    const { agent, apiUrl, apiKey } = req.body; // 'primary' 或 'secondary'，可选的临时参数
    
    // 导入解密函数
    const { decrypt, isEncrypted } = await import('../../utils/encryption');
    
    // 优先使用前端传递的临时参数（用于测试新配置）
    let finalApiUrl = typeof apiUrl === 'string' ? apiUrl.trim().replace(/\/+$/, '') : '';
    let finalApiKey = apiKey || '';
    
    // 如果前端没有传递参数，则使用已保存的配置
    if (!finalApiUrl || !finalApiKey) {
      // 加载配置
      const defaultConfig = {
        primary: {
          api_url: '',
          api_key: '',
          model: 'claude-sonnet-4-5',
        },
        secondary: {
          api_url: '',
          api_key: '',
          model: 'gpt-4o',
          vision_model: 'gpt-4o',
        },
      };
      
      let config = { ...defaultConfig };
      if (fs.existsSync(configPath)) {
        const configData = fs.readFileSync(configPath, 'utf-8');
        const parsed = JSON.parse(configData);
        config = {
          primary: {
            ...defaultConfig.primary,
            ...(parsed.primary || {}),
          },
          secondary: {
            ...defaultConfig.secondary,
            ...(parsed.secondary || {}),
          },
        };
      }
      
      // 选择要使用的 Agent 配置
      const agentConfig = agent === 'secondary' ? config.secondary : config.primary;
      
      // 如果前端没传 URL，使用已保存的
      if (!finalApiUrl) {
        finalApiUrl = (agentConfig.api_url || '').trim().replace(/\/+$/, '');
      }
      
      // 如果前端没传 Key，使用已保存的（需要解密）
      if (!finalApiKey) {
        const encryptedApiKey = agentConfig.api_key || '';
        finalApiKey = encryptedApiKey ? (isEncrypted(encryptedApiKey) ? decrypt(encryptedApiKey) : encryptedApiKey) : '';
      }
    }
    
    logger.info('[ChatBridge] Fetching models from:', finalApiUrl);
    logger.debug('[ChatBridge] API Key length:', finalApiKey.length);
    
    if (!finalApiUrl) {
      return res.json({
        success: false,
        models: [],
        error: '请先配置 API URL',
      });
    }
    
    if (!finalApiKey) {
      return res.json({
        success: false,
        models: [],
        error: '请先配置 API Key',
      });
    }
    
    // URL 格式验证
    if (finalApiUrl.includes('/chat/completions') || finalApiUrl.includes('/models')) {
      return res.json({
        success: false,
        models: [],
        error: 'URL 格式错误：请不要包含端点路径',
      });
    }
    
    logger.info('[ChatBridge] Calling upstream API:', finalApiUrl + '/models');
    
    // 调用上游 API 获取模型列表
    const response = await fetch(finalApiUrl + '/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + finalApiKey,
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[ChatBridge] Models API error:', response.status, errorText);
      return res.json({
        success: false,
        models: [],
        error: `API 返回错误 (${response.status}): ${errorText.substring(0, 100)}`,
      });
    }
    
    const data = await response.json() as { data?: Array<{ id: string }> };
    
    const models = (data.data || [])
      .map((m) => m.id)
      .filter((id) => id && !id.includes(':'))
      .sort();
    
    logger.info('[ChatBridge] Found', models.length, 'models');
    
    res.json({
      success: true,
      models,
      agent,
    });
  } catch (error) {
    logger.error('[ChatBridge] Models fetch error:', error);
    res.json({
      success: false,
      models: [],
      error: (error as Error).message,
    });
  }
});

export default router;
