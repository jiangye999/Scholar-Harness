/**
 * 统一聊天路由 - 整合 NiceAIGC 和 API Flow
 * 智能路由到最适合的处理流程
 */

import { Router, Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { NiceAIGCBridgeAdapter } from '../../bridge/niceaigc/niceaigc-bridge';
import { ScholarClawOrchestrator, ProcessingMode } from '../../orchestrator/task-orchestrator';

const router = Router();
let orchestrator: ScholarClawOrchestrator | null = null;
let niceaigcAdapter: NiceAIGCBridgeAdapter | null = null;

export function initializeUnifiedChatRoutes(adapter: NiceAIGCBridgeAdapter): void {
  niceaigcAdapter = adapter;
  orchestrator = new ScholarClawOrchestrator(adapter);
  logger.info('[UnifiedChat] Routes initialized with orchestrator');
}

/**
 * POST /api/unified/chat
 * 统一聊天接口 - 自动选择最佳处理流程
 */
router.post('/chat', async (req: Request, res: Response) => {
  try {
    if (!orchestrator || !niceaigcAdapter) {
      res.status(503).json({ 
        success: false, 
        error: 'Unified chat not initialized' 
      });
      return;
    }

    const {
      message,
      userId,
      history = [],
      // API Flow 配置
      apiUrl,
      apiKey,
      model,
      // 上下文数据（由前端或API Flow准备）
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

    logger.info(`[UnifiedChat] Received message from ${userId}: ${message.substring(0, 50)}...`);

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
      case ProcessingMode.NICEAIGC_ONLY:
        // 纯 NiceAIGC 模式 - 直接调用
        logger.info('[UnifiedChat] Using NiceAIGC only mode');
        response = await niceaigcAdapter.chat({
          messages: [{ role: 'user', content: message }],
        });
        break;

      case ProcessingMode.HYBRID:
        // 混合模式 - API准备 + NiceAIGC生成
        logger.info('[UnifiedChat] Using Hybrid mode');
        const hybridResult = await orchestrator.processHybrid(
          message,
          {
            memoryContext,
            literatureContext,
            journalStyle,
            writingProgress,
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
        // API 模式 - 转发到标准 API 流程
        logger.info('[UnifiedChat] Using API only mode');
        // 这里应该调用原有的 /api/chat 逻辑
        // 为了简化，返回提示信息
        response = '[系统] 已切换到标准 API 模式，请使用 /api/chat 端点';
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
 * 先由 API Flow 准备上下文，再由 NiceAIGC 生成
 */
router.post('/chat-with-context', async (req: Request, res: Response) => {
  try {
    if (!orchestrator || !niceaigcAdapter) {
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
      useLiterature = true,
      useJournalStyle = true,
      useWebSearch = false,  // NiceAIGC 自带搜索
    } = req.body;

    logger.info(`[UnifiedChat] Context-rich request from ${userId}`);

    // TODO: 在这里调用 API Flow 的功能准备上下文
    // - loadUserMemory(userId)
    // - retrieveLiterature(userId, message)
    // - loadJournalStyle(userId)
    // - 等等

    // 模拟准备上下文
    const context = {
      memoryContext: useMemory ? '用户记忆内容...' : undefined,
      literatureContext: useLiterature ? '相关文献摘要...' : undefined,
      journalStyle: useJournalStyle ? '期刊风格要求...' : undefined,
      writingProgress: '当前写作进度...',
    };

    // 执行混合处理
    const result = await orchestrator.processHybrid(
      message,
      context,
      async (enrichedPrompt) => enrichedPrompt
    );

    // TODO: API Flow 后处理
    // - 更新记忆
    // - 保存草稿
    // - 提取引用

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
