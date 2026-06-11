/**
 * ScholarClaw 智能任务协调器
 * 负责整合 ChatBridge (大脑) 和 API Flow (手脚)
 */

import { logger } from '../utils/logger';
import { anchorPromptWithCurrentRequest, getPromptAnchorDiagnostics } from '../utils/prompt-request-anchor';
import { ChatBridgeAdapter } from '../bridge/chat-bridge/chat-bridge';

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
  async analyzeTask(message: string, history: any[]): Promise<TaskAnalysis> {
    const lowerMsg = message.toLowerCase();
    
    // 关键词匹配快速决策
    const hasSearchKeywords = /搜索|查一下|最新|新闻|查询|search|find/i.test(message);
    const hasWritingKeywords = /写|撰写|写作|write|draft|compose/i.test(message);
    const hasAnalysisKeywords = /分析|深度|推理|复杂|analyze|deep|complex/i.test(message);
    const hasQuickKeywords = /你好|谢谢|bye|简单|quick|hello/i.test(message);
    
    // 基于历史对话长度判断复杂度
    const conversationDepth = history.length;
    const avgMsgLength = history.reduce((sum, h) => sum + (h.content?.length || 0), 0) / Math.max(history.length, 1);
    
    // 计算复杂度分数
    let complexity = 0.5;
    if (hasAnalysisKeywords) complexity += 0.3;
    if (hasWritingKeywords) complexity += 0.2;
    if (conversationDepth > 10) complexity += 0.1;
    if (avgMsgLength > 200) complexity += 0.1;
    
    complexity = Math.min(complexity, 1.0);
    
    // 决策逻辑
    if (complexity > 0.8 || hasSearchKeywords) {
      return {
        mode: ProcessingMode.HYBRID,
        requiresWebSearch: hasSearchKeywords,
        requiresLiterature: hasWritingKeywords,
        requiresMemory: true,
        requiresCreativity: hasWritingKeywords,
        complexity,
        estimatedTime: 30,
        reason: '复杂任务，需要 API 准备上下文 + ChatBridge 深度处理'
      };
    }
    
    if (hasQuickKeywords && complexity < 0.4) {
      return {
        mode: ProcessingMode.API_ONLY,
        requiresWebSearch: false,
        requiresLiterature: false,
        requiresMemory: false,
        requiresCreativity: false,
        complexity,
        estimatedTime: 3,
        reason: '简单问候，API 快速响应'
      };
    }
    
    if (hasWritingKeywords && complexity > 0.6) {
      return {
        mode: ProcessingMode.CHATBRIDGE_ONLY,
        requiresWebSearch: false,
        requiresLiterature: true,
        requiresMemory: true,
        requiresCreativity: true,
        complexity,
        estimatedTime: 25,
        reason: '创意写作任务，使用 ChatBridge 高质量模型'
      };
    }
    
    // 默认使用 HYBRID
    return {
      mode: ProcessingMode.HYBRID,
      requiresWebSearch: hasSearchKeywords,
      requiresLiterature: hasWritingKeywords,
      requiresMemory: true,
      requiresCreativity: hasWritingKeywords,
      complexity,
      estimatedTime: 20,
      reason: '默认混合模式，确保质量'
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
