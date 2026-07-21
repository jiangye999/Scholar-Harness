/**
 * ScholarClaw 智能任务协调器
 * 负责整合 ChatBridge (大脑) 和 API Flow (手脚)
 */

import { logger } from '../utils/logger';
import { anchorPromptWithCurrentRequest, getPromptAnchorDiagnostics } from '../utils/prompt-request-anchor';
import { ChatBridgeAdapter } from '../bridge/chat-bridge/chat-bridge';
import {
  classifyQueryIntentFallback,
  type QueryIntent,
  type QueryIntentHistoryMessage,
} from './query-intent';

export enum ProcessingMode {
  CHATBRIDGE_ONLY = 'chatbridge_only',      // 仅使用 ChatBridge
  API_ONLY = 'api_only',                // 仅使用 API
  HYBRID = 'hybrid',                    // 混合模式：API准备 + ChatBridge生成
  SMART = 'smart',                      // 智能选择
}

export interface TaskAnalysis {
  mode: ProcessingMode;
  requiresWebSearch: boolean;
  requiresLiterature: boolean;
  requiresMemory: boolean;
  requiresCreativity: boolean;
  complexity: number;                   // 0-1
  estimatedTime: number;                // 预估秒数
  reason: string;
  queryIntent: QueryIntent;
}

interface TaskHistoryItem {
  role?: string;
  content?: string;
}

export interface HybridContext {
  // API Flow 准备的数据
  memoryContext?: string;
  literatureContext?: string;
  journalStyle?: string;
  writingProgress?: string;
  userPreferences?: Record<string, string>;
  
  // ChatBridge 配置
  targetModel?: string;
  temperature?: number;
}

export class ScholarClawOrchestrator {
  private chatBridgeAdapter: ChatBridgeAdapter;
  
  constructor(chatBridgeAdapter: ChatBridgeAdapter) {
    this.chatBridgeAdapter = chatBridgeAdapter;
  }
  
  /**
   * 分析用户消息，决定处理模式
   */
  async analyzeTask(message: string, history: TaskHistoryItem[]): Promise<TaskAnalysis> {
    const safeHistory = (Array.isArray(history) ? history : [])
      .filter(item => item && typeof item.content === 'string')
      .map((item): QueryIntentHistoryMessage => ({
        role: item.role === 'assistant' || item.role === 'system' ? item.role : 'user',
        content: String(item.content || ''),
      }))
      .slice(-20);
    const queryIntent = classifyQueryIntentFallback({
      message,
      history: safeHistory,
    });

    const specializedIntents = new Set<QueryIntent['primaryIntent']>([
      'academic_writing',
      'data_analysis',
      'r_plot',
      'meta_analysis',
      'bibliometrics',
      'pdf_wiki',
      'multimodal_task',
      'skill_or_tool',
      'project_management',
    ]);
    const creativeIntents = new Set<QueryIntent['primaryIntent']>([
      'academic_writing',
      'multimodal_task',
    ]);
    const conversationDepth = safeHistory.length;
    const averageMessageLength = safeHistory.reduce(
      (sum, item) => sum + item.content.length,
      0
    ) / Math.max(conversationDepth, 1);

    let complexity = 0.35;
    if (specializedIntents.has(queryIntent.primaryIntent)) complexity += 0.25;
    if (queryIntent.needsToolExecution) complexity += 0.15;
    if (queryIntent.needsWorkspaceSearch) complexity += 0.1;
    if (queryIntent.needsLiteratureRetrieval || queryIntent.needsWebSearch) complexity += 0.15;
    if (conversationDepth > 10 || averageMessageLength > 400 || message.length > 800) complexity += 0.1;
    complexity = Math.min(complexity, 1);

    const common = {
      requiresWebSearch: queryIntent.needsWebSearch,
      requiresLiterature: queryIntent.needsLiteratureRetrieval,
      requiresMemory: queryIntent.isContextualFollowUp || conversationDepth > 0,
      requiresCreativity: creativeIntents.has(queryIntent.primaryIntent),
      complexity,
      queryIntent,
    };

    const isShortGeneralChat = queryIntent.primaryIntent === 'general_chat'
      && message.trim().length <= 80
      && !queryIntent.needsToolExecution;
    if (isShortGeneralChat) {
      return {
        ...common,
        mode: ProcessingMode.API_ONLY,
        estimatedTime: 3,
        reason: '结构化意图为短普通对话，不需要检索或工具执行。',
      };
    }

    if (queryIntent.primaryIntent === 'academic_writing' && complexity >= 0.6
        && !queryIntent.needsWorkspaceSearch && !queryIntent.needsWebSearch) {
      return {
        ...common,
        mode: ProcessingMode.CHATBRIDGE_ONLY,
        estimatedTime: 25,
        reason: '结构化意图为学术写作，交由 ChatBridge 高质量生成。',
      };
    }

    return {
      ...common,
      mode: ProcessingMode.HYBRID,
      estimatedTime: complexity >= 0.8 ? 30 : 20,
      reason: '结构化意图需要上下文或工具协作，使用混合模式。',
    };
  }
  
  /**
   * 执行混合模式处理
   * 1. API Flow 准备上下文
   * 2. ChatBridge 生成高质量响应
   * 3. API Flow 后处理
   */
  async processHybrid(
    message: string,
    context: HybridContext,
    apiProcessor: (enrichedPrompt: string) => Promise<string>
  ): Promise<{
    response: string;
    metadata: {
      mode: ProcessingMode;
      preparationTime: number;
      generationTime: number;
      postProcessingTime: number;
    }
  }> {
    const startTime = Date.now();
    logger.info('[Orchestrator] Starting HYBRID mode processing');
    
    // 步骤 1: API Flow 准备（手脚层）
    const prepStart = Date.now();
    const enrichedPrompt = this.buildEnrichedPrompt(message, context);
    const preparationTime = Date.now() - prepStart;
    logger.info(`[Orchestrator] Context preparation took ${preparationTime}ms`);
    
    // 步骤 2: ChatBridge 生成（大脑层）
    const genStart = Date.now();
    const chatBridgeResponse = await this.chatBridgeAdapter.chat({
      messages: [{ role: 'user', content: enrichedPrompt }],
    });
    const generationTime = Date.now() - genStart;
    logger.info(`[Orchestrator] ChatBridge generation took ${generationTime}ms`);
    
    // 步骤 3: 后处理
    const postStart = Date.now();
    const processedResponse = await this.postProcess(chatBridgeResponse, context);
    const postProcessingTime = Date.now() - postStart;
    logger.info(`[Orchestrator] Post-processing took ${postProcessingTime}ms`);
    
    const totalTime = Date.now() - startTime;
    logger.info(`[Orchestrator] HYBRID processing completed in ${totalTime}ms`);
    
    return {
      response: processedResponse,
      metadata: {
        mode: ProcessingMode.HYBRID,
        preparationTime,
        generationTime,
        postProcessingTime,
      }
    };
  }
  
  /**
   * 构建增强提示词
   * 整合所有上下文信息
   */
  buildEnrichedPrompt(message: string, context: HybridContext): string {
    let enrichedPrompt = '';
    
    // 添加写作进度上下文
    if (context.writingProgress) {
      enrichedPrompt += `\n${context.writingProgress}\n`;
    }
    
    // 添加历史记忆
    if (context.memoryContext) {
      enrichedPrompt += `\n${context.memoryContext}\n`;
    }
    
    // 添加文献上下文
    if (context.literatureContext) {
      enrichedPrompt += `\n## 📚 相关文献\n${context.literatureContext}\n`;
    }
    
    // 添加期刊风格要求
    if (context.journalStyle) {
      enrichedPrompt += `\n## 📝 期刊风格要求\n${context.journalStyle}\n`;
    }
    
    // 添加用户偏好
    if (context.userPreferences) {
      enrichedPrompt += `\n## 👤 用户偏好\n`;
      for (const [key, value] of Object.entries(context.userPreferences)) {
        enrichedPrompt += `- ${key}: ${value}\n`;
      }
    }
    
    // 添加用户消息
    enrichedPrompt += `\n## 💬 用户请求\n${message}`;
    
    const anchoredPrompt = anchorPromptWithCurrentRequest(enrichedPrompt, message, {
      source: 'task-orchestrator-hybrid'
    });
    logger.info(`[Orchestrator] Current request anchor: ${JSON.stringify(getPromptAnchorDiagnostics(anchoredPrompt, message))}`);
    return anchoredPrompt;
  }
  
  /**
   * 后处理 ChatBridge 响应
   */
  private async postProcess(response: string, context: HybridContext): Promise<string> {
    let processed = response;
    
    // 格式化引用
    processed = this.formatCitations(processed);
    
    // 应用期刊风格格式
    if (context.journalStyle) {
      processed = this.applyJournalFormatting(processed, context.journalStyle);
    }
    
    return processed;
  }
  
  /**
   * 格式化引用
   */
  private formatCitations(text: string): string {
    // 匹配 [1], [2,3] 等引用格式
    return text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (match, cites) => {
      return `[${cites}]`;
    });
  }
  
  /**
   * 应用期刊格式
   */
  private applyJournalFormatting(text: string, style: string): string {
    // 根据期刊风格应用不同格式
    // 这里可以实现具体的格式转换逻辑
    return text;
  }
}

export default ScholarClawOrchestrator;
