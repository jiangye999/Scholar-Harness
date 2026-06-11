/**
 * 统一聊天路由 - 整合 ChatBridge 和 API Flow
 * 智能路由到最适合的处理流程
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { anchorPromptWithCurrentRequest } from '../../utils/prompt-request-anchor';
import { ChatBridgeAdapter } from '../../bridge/chat-bridge/chat-bridge';
import { ScholarClawOrchestrator, ProcessingMode } from '../../orchestrator/task-orchestrator';
import { loadUserMemory } from './memory';
import { getRetrievalEngine } from './literature';
import { getUploadDir, getMemoryDir, getDataDir } from '../../utils/paths';
import { 
  processUnifiedChatMessage, 
  type ChatProcessorConfig,
  type ConversationHistoryItem 
} from '../unified-chat-processor';
import * as path from 'path';
import * as fs from 'fs';
// Bug 修复：从 session 获取 userId，避免账号数据混淆
import { resolveUserId, getUserIdFromSession } from '../auth-guard-singleton';

const router = Router();
let orchestrator: ScholarClawOrchestrator | null = null;
let chatBridgeAdapter: ChatBridgeAdapter | null = null;

// 使用统一的路径管理模块（确保 Electron/pkg 打包后路径一致）
const dataDir = getDataDir();
const uploadDir = getUploadDir();

// 技能目录
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
  // __dirname 在编译后是 dist/src/server/routes，需要往上走四层才能到项目根目录
  const projectRoot = path.resolve(__dirname, "..", "..", "..", "..");
  return path.join(projectRoot, "sci_writing_skills");
}

const skillDir = getSkillDir();

export function initializeUnifiedChatRoutes(adapter: ChatBridgeAdapter): void {
  chatBridgeAdapter = adapter;
  orchestrator = new ScholarClawOrchestrator(adapter);
  logger.info('[UnifiedChat] Routes initialized with orchestrator');
}

/**
 * POST /api/unified/chat
 * 统一聊天接口 - 自动选择最佳处理流程
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    if (!orchestrator || !chatBridgeAdapter) {
      res.status(503).json({ 
        success: false, 
        error: 'Unified chat not initialized' 
      });
      return;
    }

    const {
      message,
      userId: bodyUserId, // Bug 修复：改名避免与 session 解析的 userId 冲突
      history = [],
      // API Flow 配置
      apiUrl,
      apiKey,
      model,
      // 上下文数据（由前端或 API Flow准备）
      memoryContext,
      literatureContext,
      journalStyle,
      writingProgress,
      // 强制模式（可选）
      forceMode,
    } = req.body;

    if (!message) {
      res.status(400).json({ 
        success: false, 
        error: 'Message is required' 
      });
      return;
    }

    // Bug 修复：从 session 获取 userId（优先级：session > req.body.userId > 'web-user'）
    const userId = await resolveUserId(bodyUserId);
    logger.info(`[UnifiedChat] Received message from ${userId}: ${message.substring(0, 50)}... (source: session-priority)`);
    
    // 步骤 0: 服务端加载记忆（确保所有模式都能获取记忆）
    // 修复：之前 HYBRID 和 CHATBRIDGE_ONLY 模式依赖前端传递 memoryContext，现在改为服务端加载
    let serverMemoryContext = memoryContext;  // 优先使用前端传递的（如果有）
    let serverWritingProgress = writingProgress;
    
    if (!serverMemoryContext && userId) {
      try {
        const userMemory = await loadUserMemory(userId);
        if (userMemory.entries && userMemory.entries.length > 0) {
          // 格式化记忆上下文
          const memoryLines = userMemory.entries
            .filter(e => !['writing_progress', 'completed_chapters', 'pending_chapters'].includes(e.key))
            .map(e => `- ${e.key}: ${e.value}`)
            .join('\n');
          serverMemoryContext = `## 🧠 跨会话长期记忆\n${memoryLines}`;
          
          // 格式化写作进度
          const writingProgressEntry = userMemory.entries.find(e => e.key === 'writing_progress');
          const completedChaptersEntry = userMemory.entries.find(e => e.key === 'completed_chapters');
          const pendingChaptersEntry = userMemory.entries.find(e => e.key === 'pending_chapters');
          
          if (writingProgressEntry || completedChaptersEntry || pendingChaptersEntry) {
            serverWritingProgress = '\n## 📝 当前写作进度\n';
            if (writingProgressEntry?.value && writingProgressEntry.value !== '无') {
              serverWritingProgress += `**整体进度**: ${writingProgressEntry.value}\n`;
            }
            if (completedChaptersEntry?.value && completedChaptersEntry.value !== '无') {
              serverWritingProgress += `**已完成章节**: ${completedChaptersEntry.value}\n`;
            }
            if (pendingChaptersEntry?.value && pendingChaptersEntry.value !== '无') {
              serverWritingProgress += `**待完成章节**: ${pendingChaptersEntry.value}\n`;
            }
          }
          
          logger.info(`[UnifiedChat] Server loaded ${userMemory.entries.length} memory entries for ${userId}`);
        }
      } catch (error) {
        logger.warn(`[UnifiedChat] Failed to load memory for ${userId}:`, error);
      }
    }

    // 步骤 1: 分析任务，决定处理模式
    let mode: ProcessingMode;
    let analysis;

    if (forceMode) {
      mode = forceMode as ProcessingMode;
      logger.info(`[UnifiedChat] Using forced mode: ${mode}`);
    } else {
      analysis = await orchestrator.analyzeTask(message, history);
      mode = analysis.mode;
      logger.info(`[UnifiedChat] Analysis result: ${mode}, reason: ${analysis.reason}`);
    }

    let response: string;
    let metadata: any = { mode };

    // 步骤 2: 根据模式执行处理
    switch (mode) {
      case ProcessingMode.CHATBRIDGE_ONLY:
        // 纯 ChatBridge 模式 - 将记忆上下文拼接到用户消息
        logger.info('[UnifiedChat] Using ChatBridge only mode');
        let chatBridgeMessage = message;
        if (serverMemoryContext) {
          chatBridgeMessage = `${serverMemoryContext}\n\n${serverWritingProgress || ''}\n\n---\n\n用户问题：${message}`;
          logger.info('[UnifiedChat] ChatBridge mode: memory context injected');
        }
        chatBridgeMessage = anchorPromptWithCurrentRequest(chatBridgeMessage, message, {
          source: 'unified-route-chatbridge-only'
        });
        response = await chatBridgeAdapter.chat({
          messages: [{ role: 'user', content: chatBridgeMessage }],
        });
        break;

      case ProcessingMode.HYBRID:
        // 混合模式 - API准备 + ChatBridge生成
        logger.info('[UnifiedChat] Using Hybrid mode');
        const hybridResult = await orchestrator.processHybrid(
          message,
          {
            memoryContext: serverMemoryContext || memoryContext,
            literatureContext,
            journalStyle,
            writingProgress: serverWritingProgress || writingProgress,
          },
          async (enrichedPrompt) => {
            // 这里可以插入 API 的预处理逻辑
            return enrichedPrompt;
          }
        );
        response = hybridResult.response;
        metadata = { ...metadata, ...hybridResult.metadata };
        break;

      case ProcessingMode.API_ONLY:
      default:
        // API 模式 - 使用统一的聊天处理器
        logger.info('[UnifiedChat] Using API only mode');
        try {
          // 构建处理器配置（使用统一路径管理，避免 pkg/Electron 打包后路径不一致）
          const processorConfig: ChatProcessorConfig = {
            apiUrl: apiUrl || process.env.API_URL || '',
            apiKey: apiKey || process.env.API_KEY || '',
            model: model || process.env.PRIMARY_MODEL || 'gpt-4o',
            webSearchKey: process.env.TAVILY_API_KEY || process.env.EXA_API_KEY || '',
            uploadDir: getUploadDir(),
            memoryDir: getMemoryDir(),
            skillDir: skillDir,
          };
          
          // 调用统一的聊天处理器（userId 已从 session 获取）
          const result = await processUnifiedChatMessage(
            userId, // 使用已从 session 解析的 userId
            message, 
            processorConfig,
            { history }
          );
          response = result.response;
          metadata.provider = 'api';
          metadata.taskType = result.metadata?.taskType;
        } catch (apiError) {
          logger.error('[UnifiedChat] API call failed:', apiError);
          throw new Error(`API mode failed: ${(apiError as Error).message}`);
        }
        break;
    }

    // 步骤 3: 返回结果
    res.json({
      success: true,
      response,
      metadata: {
        mode,
        processingTime: metadata.generationTime || 0,
        ...metadata,
      },
    });

    logger.info('[UnifiedChat] Response sent successfully');

  } catch (error) {
    logger.error('[UnifiedChat] Error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /api/unified/chat-with-context
 * 带完整上下文的混合处理接口
 * 先由 API Flow 准备上下文，再由 ChatBridge 生成
 */
router.post('/chat-with-context', async (req: Request, res: Response) => {
  try {
    if (!orchestrator || !chatBridgeAdapter) {
      res.status(503).json({ 
        success: false, 
        error: 'Unified chat not initialized' 
      });
      return;
    }

    const {
      message,
      userId,
      // 是否启用各功能
      useMemory = true,
      useLiterature = false,
      useJournalStyle = true,
      useWebSearch = false,  // ChatBridge 自带搜索
    } = req.body;

    logger.info(`[UnifiedChat] Context-rich request from ${userId}`);
    const automaticLiteratureRetrievalEnabled = process.env.AUTO_LITERATURE_RETRIEVAL === '1';

    // Bug 修复：从 session 获取 userId
    const resolvedUserId = await resolveUserId(userId);
    logger.info(`[UnifiedChat] Resolved userId: ${resolvedUserId} (source: session-priority)`);
    
    // 准备上下文
    const context: {
      memoryContext?: string;
      literatureContext?: string;
      journalStyle?: string;
      writingProgress?: string;
    } = {};

    // 加载用户记忆（使用 resolvedUserId）
    if (useMemory) {
      try {
        const userMemory = await loadUserMemory(resolvedUserId);
        if (userMemory.entries && userMemory.entries.length > 0) {
          const memoryLines = userMemory.entries.map(e => `- ${e.key}: ${e.value}`).join('\n');
          context.memoryContext = `## 👤 用户跨会话记忆\n${memoryLines}`;
          logger.info(`[UnifiedChat] Loaded ${userMemory.entries.length} memory entries for ${resolvedUserId}`);
        }
      } catch (error) {
        logger.warn(`[UnifiedChat] Failed to load memory for ${userId}:`, error);
      }
    }

    // 自动文献摘要检索默认禁用：文献检索主要由用户在界面中手动触发
    if (useLiterature && !automaticLiteratureRetrievalEnabled) {
      logger.info('[UnifiedChat] Automatic literature retrieval is disabled; skipping literature context injection');
    }

    if (automaticLiteratureRetrievalEnabled && useLiterature) {
      try {
        const retrievalEngine = getRetrievalEngine();
        const retrieveResult = await retrievalEngine.retrieve({
          query: message,
          topK: 10,
          searchMode: 'hybrid'
        });

        if (retrieveResult.results && retrieveResult.results.length > 0) {
          const litLines = retrieveResult.results.slice(0, 8).map((doc, idx) => {
            const authors = doc.authors.map(a => a.name).join(', ');
            const firstAuthor = doc.authors[0]?.name?.split(/\s+/).pop() || 'Unknown';
            const citation = `(${firstAuthor} et al., ${doc.year})`;
            
            return `[${idx + 1}] ${doc.title}\n    引用格式: ${citation}\n    ${doc.journal ? `期刊: ${doc.journal}\n    ` : ''}摘要片段: ${doc.abstract?.substring(0, 200) || 'N/A'}...`;
          }).join('\n\n');
          
          context.literatureContext = `## 📚 相关文献（自动检索）\n\n共检索到 ${retrieveResult.results.length} 篇相关文献，以下是前 ${Math.min(8, retrieveResult.results.length)} 篇：\n\n${litLines}`;
          logger.info(`[UnifiedChat] Retrieved ${retrieveResult.results.length} literature documents for context`);
        } else {
          context.literatureContext = '';
          logger.info('[UnifiedChat] No relevant literature found');
        }
      } catch (error) {
        logger.warn(`[UnifiedChat] Literature retrieval failed:`, error);
        context.literatureContext = '';
      }
    }

    // 真实实现期刊风格加载（使用 resolvedUserId）
    if (useJournalStyle) {
      try {
        const journalStylesDir = path.join(uploadDir, resolvedUserId, 'journal-styles');
        
        if (fs.existsSync(journalStylesDir)) {
          const journals = fs.readdirSync(journalStylesDir)
            .filter(name => fs.statSync(path.join(journalStylesDir, name)).isDirectory());
          
          if (journals.length > 0) {
            // 读取第一个期刊的风格（或可以扩展为根据用户偏好选择）
            const stylePath = path.join(journalStylesDir, journals[0], 'style.json');
            
            if (fs.existsSync(stylePath)) {
              const styleContent = JSON.parse(fs.readFileSync(stylePath, 'utf-8'));
              
              // 提取风格信息
              let styleText = `## 📋 期刊风格参考（${journals[0].replace(/_/g, ' ')}）\n\n`;
              
              if (Array.isArray(styleContent) && styleContent.length > 0) {
                const firstPaper = styleContent[0];
                
                if (firstPaper.structure_features?.section_lengths) {
                  const sections = Object.entries(firstPaper.structure_features.section_lengths)
                    .map(([section, length]) => `- ${section}: ${length} 字`)
                    .join('\n');
                  styleText += `段落长度建议：\n${sections}\n\n`;
                }
                
                if (firstPaper.lexical_patterns?.common_verbs) {
                  const verbs = Object.entries(firstPaper.lexical_patterns.common_verbs)
                    .flatMap(([section, v]) => Array.isArray(v) ? v.slice(0, 5) : [])
                    .slice(0, 10);
                  if (verbs.length > 0) {
                    styleText += `常用动词：${verbs.join(', ')}\n\n`;
                  }
                }
                
                if (firstPaper.lexical_patterns?.common_phrases) {
                  const phrases = Object.entries(firstPaper.lexical_patterns.common_phrases)
                    .flatMap(([section, p]) => Array.isArray(p) ? p.slice(0, 3) : [])
                    .slice(0, 5);
                  if (phrases.length > 0) {
                    styleText += `常用短语：${phrases.join('; ')}\n\n`;
                  }
                }
                
                context.journalStyle = styleText;
                logger.info(`[UnifiedChat] Loaded journal style: ${journals[0]}`);
              }
            }
          }
        }
        
        if (!context.journalStyle) {
          context.journalStyle = '';
        }
      } catch (error) {
        logger.warn(`[UnifiedChat] Journal style loading failed:`, error);
        context.journalStyle = '';
      }
    }

    // 执行混合处理
    const result = await orchestrator.processHybrid(
      message,
      context,
      async (enrichedPrompt) => enrichedPrompt
    );

    // API Flow 后处理 - 更新记忆（使用 resolvedUserId）
    try {
      const memoryUpdateUrl = `http://localhost:${process.env.PORT || 18789}/api/memory/update`;
      await fetch(memoryUpdateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: resolvedUserId, // 使用从 session 解析的 userId
          userMessage: message,
          aiResponse: result.response,
          apiUrl: req.body.apiUrl || process.env.API_URL || '',
          apiKey: req.body.apiKey || process.env.API_KEY || '',
          model: req.body.model || 'gpt-4o'
        })
      });
      logger.info(`[UnifiedChat] Memory update triggered for ${resolvedUserId}`);
    } catch (memError) {
      logger.warn(`[UnifiedChat] Memory update failed: ${(memError as Error).message}`);
      // 不影响主流程，继续返回结果
    }

    res.json({
      success: true,
      response: result.response,
      metadata: result.metadata,
    });

  } catch (error) {
    logger.error('[UnifiedChat] Context chat error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /api/unified/chat-stream
 * SSE 流式聊天接口 - 支持实时流式输出
 */
router.post('/chat-stream', async (req: Request, res: Response) => {
  if (!orchestrator || !chatBridgeAdapter) {
    res.status(503).json({ success: false, error: 'Unified chat not initialized' });
    return;
  }

  const {
    message,
    userId: bodyUserId, // Bug 修复：改名避免与 session 解析的 userId 冲突
    history = [],
    useMemory = true,
    useLiterature = false,
    useJournalStyle = false,
  } = req.body;

  if (!message) {
    res.status(400).json({ success: false, error: 'Message is required' });
    return;
  }

  // Bug 修复：从 session 获取 userId
  const userId = await resolveUserId(bodyUserId);
  logger.info(`[UnifiedChat] Stream request from ${userId}: ${message.substring(0, 50)}... (source: session-priority)`);

  // 设置 SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 发送连接建立信号
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  try {
    // 准备上下文
    const context: {
      memoryContext?: string;
      literatureContext?: string;
      journalStyle?: string;
      writingProgress?: string;
    } = {};

    if (useMemory) {
      try {
        const userMemory = await loadUserMemory(userId); // userId 已从 session 解析
        if (userMemory.entries && userMemory.entries.length > 0) {
          const memoryLines = userMemory.entries.map(e => `- ${e.key}: ${e.value}`).join('\n');
          context.memoryContext = `## 👤 用户跨会话记忆\n${memoryLines}`;
        }
      } catch (error) {
        logger.warn(`[UnifiedChat] Failed to load memory for ${userId}:`, error);
      }
    }

    // 构建增强提示词
    const enrichedPrompt = orchestrator.buildEnrichedPrompt(message, context);

    // 发送开始信号
    res.write(`data: ${JSON.stringify({ type: 'start' })}\n\n`);

    // 使用流式接口
    let fullResponse = '';
    await chatBridgeAdapter.chat({
      messages: [{ role: 'user', content: enrichedPrompt }],
      onProgress: (chunk: string) => {
        fullResponse += chunk;
        res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`);
      },
    });

    // 发送完成信号
    res.write(`data: ${JSON.stringify({ type: 'end', content: fullResponse })}\n\n`);
    res.end();

    logger.info(`[UnifiedChat] Stream completed, total ${fullResponse.length} chars`);

  } catch (error) {
    logger.error('[UnifiedChat] Stream error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', error: (error as Error).message })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/unified/analyze
 * 分析任务类型和推荐处理模式
 */
router.post('/analyze', async (req: Request, res: Response) => {
  try {
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not initialized' });
      return;
    }

    const { message, history = [] } = req.body;

    const analysis = await orchestrator.analyzeTask(message, history);

    res.json({
      success: true,
      analysis: {
        mode: analysis.mode,
        complexity: analysis.complexity,
        estimatedTime: analysis.estimatedTime,
        reason: analysis.reason,
        features: {
          needsWebSearch: analysis.requiresWebSearch,
          needsLiterature: analysis.requiresLiterature,
          needsMemory: analysis.requiresMemory,
          needsCreativity: analysis.requiresCreativity,
        },
      },
    });

  } catch (error) {
    logger.error('[UnifiedChat] Analyze error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

export default router;
