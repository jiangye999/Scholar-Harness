// ScholarClaw - 对话工作流管理器
// 管理整个论文写作的对话流程

import { logger } from '../src/utils/logger';
import { SessionStore } from '../src/storage/session-store';
import type { MessageHandler, UserState as UserStateType, ChapterPlan as ChapterPlanType, SectionProgress as SectionProgressType } from '../src/types';
import type { RetrievedDocument, UnifiedLiterature } from '../src/types/literature';
import { SecondaryAgent } from '../agents/secondary-agent-v2';
import { HybridRetrievalEngine } from '../src/literature/retrieval';
import { ParagraphGenerator } from '../src/literature/generation';
import { SentenceLevelRetriever } from '../src/literature/retrieval/sentence-retriever';
import * as fs from 'fs';
import * as path from 'path';

// 对话阶段
export type ConversationPhase = 
  | 'greeting'      // 问候
  | 'topic'         // 了解主题
  | 'journal'       // 确认期刊
  | 'upload'        // 上传材料
  | 'planning'      // 章节规划
  | 'writing'       // 写作执行
  | 'complete';     // 完成

// 使用类型别名
export type UserState = UserStateType;
export type ChapterPlan = ChapterPlanType;
export type SectionProgress = SectionProgressType;

export class ConversationFlow {
  private messageHandler: MessageHandler;
  private sessions: Map<string, UserStateType>;
  private sessionStore: SessionStore;
  private apiUrl: string;
  private apiKey: string;
  private embeddingModel: string;
  private maxConcurrency: number;
  private retrievalEngine: HybridRetrievalEngine;

  constructor(
    messageHandler: MessageHandler,
    sessionStore?: SessionStore,
    apiConfig?: { apiUrl: string; apiKey: string; embeddingModel?: string; maxConcurrency?: number },
    retrievalEngine?: HybridRetrievalEngine
  ) {
    this.messageHandler = messageHandler;
    this.sessions = new Map();
    this.sessionStore = sessionStore || new SessionStore('./data/sessions');
    this.apiUrl = apiConfig?.apiUrl || process.env.API_URL || '';
    this.apiKey = apiConfig?.apiKey || process.env.API_KEY || '';
    this.embeddingModel = apiConfig?.embeddingModel || process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
    this.maxConcurrency = apiConfig?.maxConcurrency || 5;
    this.retrievalEngine = retrievalEngine || new HybridRetrievalEngine({}, { url: this.apiUrl, key: this.apiKey });
  }

  async getSession(userId: string): Promise<UserStateType> {
    if (!this.sessions.has(userId)) {
      const savedState = await this.sessionStore.load(userId);
      if (savedState) {
        this.sessions.set(userId, savedState);
      } else {
        const now = new Date();
        this.sessions.set(userId, {
          id: userId,
          phase: 'greeting',
          chapterPlans: new Map(),
          writingProgress: new Map(),
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return this.sessions.get(userId)!;
  }

  async processMessage(userId: string, message: string): Promise<string> {
    const session = await this.getSession(userId);
    logger.info(`[Flow] Processing message in phase: ${session.phase}`);

    // 检测是否为直接写作请求（跳过阶段流程）
    const isDirectWritingRequest = this.detectWritingRequest(message);
    if (isDirectWritingRequest && session.phase !== 'writing') {
      logger.info(`[Flow] Detected direct writing request: ${isDirectWritingRequest}`);
      // 初始化写作阶段所需的上下文
      if (!session.paperTopic) {
        session.paperTopic = '未指定主题';
      }
      if (!session.targetJournal) {
        session.targetJournal = '未指定期刊';
      }
      session.phase = 'writing';
      
      // 解析用户请求中的章节信息
      const chapterInfo = this.parseChapterFromMessage(message);
      if (chapterInfo) {
        session.chapterPlans.set(chapterInfo.chapter, {
          chapterName: chapterInfo.chapter,
          enabled: true,
          writingFocus: chapterInfo.focus || message,
          keyPoints: [],
        });
        session.currentChapter = chapterInfo.chapter;
      }
      
      // 直接进入写作阶段
      return await this.handleWriting(message, session);
    }

    switch (session.phase) {
      case 'greeting':
        return this.handleGreeting(message, session);
      case 'topic':
        return this.handleTopic(message, session);
      case 'journal':
        return this.handleJournal(message, session);
      case 'upload':
        return this.handleUpload(message, session);
      case 'planning':
        return this.handlePlanning(message, session);
      case 'writing':
        return await this.handleWriting(message, session);
      case 'complete':
        return await this.handleComplete(message, session);
      default:
        return this.handleGreeting(message, session);
    }
  }

  /**
   * 检测是否为直接写作请求
   */
  private detectWritingRequest(message: string): string | null {
    const writingPatterns = [
      /帮我写([一二三四五六七八九十\d]+)?[.\s]*([引言方法结果讨论结论摘要])/i,
      /写([一二三四五六七八九十\d]+)?[.\s]*([引言方法结果讨论结论摘要])/i,
      /撰写([一二三四五六七八九十\d]+)?[.\s]*([引言方法结果讨论结论摘要])/i,
      /生成([一二三四五六七八九十\d]+)?[.\s]*([引言方法结果讨论结论摘要])/i,
      /写\s*introduction/i,
      /写\s*discussion/i,
      /写\s*methods/i,
      /写\s*results/i,
      /写\s*conclusion/i,
      /写\s*abstract/i,
      /撰写\s*introduction/i,
      /撰写\s*discussion/i,
      /撰写\s*methods/i,
      /撰写\s*results/i,
      /撰写\s*conclusion/i,
      /撰写\s*abstract/i,
    ];
    
    for (const pattern of writingPatterns) {
      const match = message.match(pattern);
      if (match) {
        return match[0];
      }
    }
    return null;
  }

  /**
   * 从消息中解析章节信息
   */
  private parseChapterFromMessage(message: string): { chapter: string; focus?: string } | null {
    const chapterMap: Record<string, string> = {
      '引言': 'introduction',
      '方法': 'methods',
      '结果': 'results',
      '讨论': 'discussion',
      '结论': 'conclusion',
      '摘要': 'abstract',
      'introduction': 'introduction',
      'methods': 'methods',
      'results': 'results',
      'discussion': 'discussion',
      'conclusion': 'conclusion',
      'abstract': 'abstract',
    };
    
    const lowerMsg = message.toLowerCase();
    for (const [cn, en] of Object.entries(chapterMap)) {
      if (lowerMsg.includes(cn) || lowerMsg.includes(en)) {
        return { chapter: en, focus: message };
      }
    }
    return null;
  }

  // 问候阶段
  private handleGreeting(message: string, session: UserState): string {
    session.phase = 'topic';
    return `你好！我是学术论文写作助手 🎓

我可以帮助你完成学术论文的写作，包括：
• 根据你的研究内容生成论文
• 按照目标期刊的风格要求
• 智能引用相关文献
• 生成 LaTeX 格式的文档

请告诉我你的论文主题是什么？`;
  }

  // 主题阶段
  private handleTopic(message: string, session: UserState): string {
    session.paperTopic = message;
    session.phase = 'journal';
    return `很好！主题是：**${message}**

接下来请问：
1. 你的目标期刊是哪个？（如 Nature Climate Change, GCB 等）
2. 或者你更关注某个具体的研究领域？
3. 如果没有特定期刊，我可以帮你推荐合适的期刊`;
  }

  // 期刊阶段
  private handleJournal(message: string, session: UserState): string {
    session.targetJournal = message;
    session.phase = 'upload';
    return `收到！你希望发表在 **${message}**

现在我需要一些材料来开始写作：

📄 **必需**：
   - 你的研究内容（Word 文档，包含实验设计、结果等）

📄 **推荐**：
   - 目标期刊的范文 PDF（1-3 篇，帮助我学习期刊风格）
   - 文献数据库（Web of Science 导出文件，帮助智能引用）

请先上传你的研究内容文档。
（你可以直接粘贴文本内容，或者描述你的研究内容）`;
  }

  // 上传阶段
  private handleUpload(message: string, session: UserState): string {
    session.researchContent = message;
    session.phase = 'planning';
    return `收到你的研究内容！让我分析一下...

（分析研究中...）

✅ 分析完成！

接下来我们可以开始规划论文了。

我想了解一下你对各章节的写作重点。我们从**引言**开始：

📝 **引言 (Introduction)**
   你想重点阐述什么？（例如：研究背景、已有研究、研究问题、你的创新点）

请用 1-2 句话描述你的引言写作重点。`;
  }

  // 规划阶段 - 处理各章节的规划
  private handlePlanning(message: string, session: UserState): string {
    // 收集章节规划
    // 完成后进入写作阶段
    const chapter = session.currentChapter || 'introduction';
    
    session.chapterPlans.set(chapter, {
      chapterName: chapter,
      enabled: true,
      writingFocus: message,
      keyPoints: [],
    });

    // 询问下一个章节
    const nextChapter = this.getNextChapter(chapter);
    if (nextChapter) {
      session.currentChapter = nextChapter;
      return this.askAboutChapter(nextChapter);
    } else {
      // 规划完成，确认规划
      session.phase = 'writing';
      return this.confirmPlans(session);
    }
  }

  // 写作阶段
  private async handleWriting(message: string, session: UserState): Promise<string> {
    if (message.includes('确认') || message.includes('开始')) {
      return await this.startWriting(session);
    }
    return `好的，请问你想：
1. 查看某个章节的内容？
2. 修改某个章节的规划？
3. 开始/继续写作？`;
  }

  private async handleComplete(message: string, session: UserState): Promise<string> {
    if (message.includes('新的') || message.includes('重置')) {
      const userId = session.id;
      this.sessions.delete(userId);
      await this.sessionStore.delete(userId);
      return this.handleGreeting('', session);
    }
    return `你的论文已经完成！

📁 文件位置：output/final/

请问还需要什么帮助？
- 查看某个章节
- 修改内容
- 开始新论文`;
  }

  // 获取下一个章节
  private getNextChapter(current: string): string | null {
    const order = ['introduction', 'methods', 'results', 'discussion', 'abstract', 'conclusion'];
    const idx = order.indexOf(current);
    return idx < order.length - 1 ? order[idx + 1] : null;
  }

  // 询问特定章节的规划
  private askAboutChapter(chapter: string): string {
    const prompts: Record<string, string> = {
      methods: `📝 **方法 (Methods)**
请描述你方法部分的写作重点（如：实验设计、数据来源、分析方法等）

请用 1-2 句话描述。`,
      results: `📝 **结果 (Results)**
请描述你结果部分的写作重点（如：主要发现、数据呈现、图表说明等）

请用 1-2 句话描述。`,
      discussion: `📝 **讨论 (Discussion)**
请描述你讨论部分的写作重点（如：结果解释、与文献对比、研究意义、局限性等）

请用 1-2 句话描述。`,
      abstract: `📝 **摘要 (Abstract)**
请描述你摘要的写作重点（研究背景、方法、主要发现、结论）

请用 1-2 句话描述。`,
      conclusion: `📝 **结论 (Conclusion)**
请描述你结论的写作重点（主要发现、研究贡献、未来展望）

请用 1-2 句话描述。`,
    };
    return prompts[chapter] || '';
  }

  // 确认所有规划
  private confirmPlans(session: UserState): string {
    let planText = '好的！让我确认一下你的章节规划：\n\n';
    
    for (const [name, plan] of session.chapterPlans) {
      planText += `📋 **${name}**: ${plan.writingFocus}\n`;
    }

    planText += `
是否需要修改某个章节的规划？
确认后我将开始写作。`;

    return planText;
  }

  // 开始写作
  private async startWriting(session: UserState): Promise<string> {
    if (!this.apiKey || !this.apiUrl) {
      return '错误：未配置 API 密钥。请先设置 API_URL 和 API_KEY。';
    }

    // 检查是否有索引的文献
    const stats = this.retrievalEngine.getStatistics();
    if (stats.totalCount === 0) {
      logger.warn('[Flow] No literature indexed');
      return '错误：未找到文献库。请先上传文献。';
    }
    
    logger.info(`[Flow] Using retrieval system with ${stats.totalCount} papers`);

    // 创建 API 客户端
    const apiClient = {
      chat: async (options: { model: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number }) => {
        const response = await fetch(`${this.apiUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages: options.messages,
            temperature: options.temperature || 0.2,
            max_tokens: options.maxTokens || 4000,
          }),
        });
        
        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }
        
        const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        return data.choices?.[0]?.message?.content || '';
      },
    };

    // 准备写作任务
    const chapters = Array.from(session.chapterPlans.entries());
    let output = '好的！开始写作。\n\n';
    
    for (const [chapterName, chapterPlan] of chapters) {
      output += `\n📝 正在写作：${chapterName}\n`;
      output += `   写作重点：${chapterPlan.writingFocus}\n`;
      output += `   关键要点：${chapterPlan.keyPoints?.length || 0} 个\n\n`;

      try {
        output += `\n🔍 正在分析并生成检索策略...\n`;
        
        // 1. AI生成多个检索词
        const searchQueries = await this.generateSearchQueries(apiClient, chapterPlan, session);
        logger.info(`[Flow] Generated ${searchQueries.length} search queries for ${chapterName}: ${searchQueries.join(', ')}`);
        output += `   生成 ${searchQueries.length} 个检索词: ${searchQueries.slice(0, 3).join(', ')}${searchQueries.length > 3 ? '...' : ''}\n`;
        
        // 2. 使用多个检索词分次检索
        const allRetrievedDocs: RetrievedDocument[] = [];
        const seenDocIds = new Set<string>();
        
        for (const query of searchQueries) {
          const queryResults = await this.retrievalEngine.retrieve({
            query,
            topK: 10,
            searchMode: 'hybrid',
          });
          
          // 合并结果，去重
          for (const doc of queryResults.results) {
            if (!seenDocIds.has(doc.id)) {
              seenDocIds.add(doc.id);
              allRetrievedDocs.push(doc);
            }
          }
          
          logger.info(`[Flow] Query "${query}" retrieved ${queryResults.results.length} papers`);
        }
        
        // 按综合分数排序
        allRetrievedDocs.sort((a: RetrievedDocument, b: RetrievedDocument) => (b.combinedScore || 0) - (a.combinedScore || 0));
        
        // 限制总数
        const finalDocs = allRetrievedDocs.slice(0, 30);
        
        logger.info(`[Flow] Total unique papers retrieved for ${chapterName}: ${finalDocs.length}`);
        output += `   共检索到 ${finalDocs.length} 篇相关文献\n\n`;

        // 创建段落生成器
        const generator = new ParagraphGenerator(apiClient, {
          maxCitationsPerParagraph: 3,
          citationStyle: 'numeric',
          referenceStyle: 'gbt7714',
          requireEvidence: true,
          allowParaphrasing: true,
        });

        // 设置文献映射
        const literatureMap = new Map<string, UnifiedLiterature>(finalDocs.map((r: RetrievedDocument) => [r.id, r as UnifiedLiterature]));
        generator.setLiteratures(literatureMap);

        // 生成段落
        const writingOutput = await generator.generate(
          chapterPlan.writingFocus,
          finalDocs,
          chapterPlan.keyPoints?.length || 3
        );

        // 构建完整内容
        let content = writingOutput.generatedText;
        
        // 添加参考文献
        if (writingOutput.references.length > 0) {
          content += '\n\n## 参考文献\n\n';
          writingOutput.references.forEach((ref, idx) => {
            content += `[${idx + 1}] ${ref.formatted}\n`;
          });
        }

        output += `✅ ${chapterName} 写作完成！\n`;
        output += `   内容长度：${content.length} 字符\n`;
        output += `   引用文献：${writingOutput.statistics.uniqueReferences} 篇\n\n`;
        
        // 保存到 session
        if (!session.writingProgress) {
          session.writingProgress = new Map();
        }
        session.writingProgress.set(chapterName, {
          status: 'completed',
          skillGenerated: true,
          content,
          wordCount: content.length,
        });

      } catch (error) {
        logger.error(`[Flow] Writing failed for ${chapterName}:`, error);
        output += `❌ ${chapterName} 写作失败：${(error as Error).message}\n\n`;
      }
    }

    output += '\n🎉 写作完成！\n';
    output += `共完成 ${chapters.length} 个章节\n`;
    output += '所有引用均来自您的文献库，确保真实性和准确性。\n';

    session.phase = 'complete';
    await this.saveProgress(session.id);

    return output;
  }

  private async generateSearchQueries(
    apiClient: { chat: (options: { model: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number }) => Promise<string> },
    chapterPlan: ChapterPlan,
    session: UserState
  ): Promise<string[]> {
    const prompt = `你是一位专业的学术文献检索专家。请根据以下章节写作规划，生成3-5个最优的英文检索词/短语，用于在文献数据库中检索相关文献。

## 章节信息
- 章节名称: ${chapterPlan.chapterName}
- 写作重点: ${chapterPlan.writingFocus}
- 关键要点: ${chapterPlan.keyPoints?.join(', ') || '未指定'}

## 论文主题
${session.paperTopic || '未指定'}

## 研究内容摘要
${session.researchContent?.slice(0, 500) || '未提供'}

## 要求
1. 每个检索词应该是3-5个英文单词组成的短语
2. 检索词应该覆盖不同的子主题和角度
3. 优先使用学术领域常用的专业术语
4. 避免过于宽泛的词汇（如"study", "research"）

## 输出格式
每行一个检索词，不要编号，不要其他说明。例如：
N2O emission agricultural soil
nitrous oxide climate change
greenhouse gas mitigation strategy

请生成检索词：`;

    try {
      const response = await apiClient.chat({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        maxTokens: 500,
      });

      const queries = response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('-') && !line.match(/^\d+\./))
        .slice(0, 5);

      if (queries.length === 0) {
        return [chapterPlan.writingFocus];
      }

      return queries;
    } catch (error) {
      logger.error('[Flow] Failed to generate search queries:', error);
      return [chapterPlan.writingFocus];
    }
  }

  async saveProgress(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      await this.sessionStore.save(userId, session);
      logger.info(`[Flow] Saved progress for user: ${userId}, phase: ${session.phase}`);
    }
  }

  async loadProgress(userId: string): Promise<UserState | null> {
    return this.sessionStore.load(userId);
  }
}

export default ConversationFlow;
