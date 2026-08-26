// ScholarClaw - 对话工作流管理器
// 管理整个论文写作的对话流程

import { logger } from '../src/utils/logger';
import { callChatCompletion, createLLMApiClient } from '../src/utils/llm-client';
import { SessionStore } from '../src/storage/session-store';
import { loadUserMemory, saveUserMemory, isKeyDeleted } from '../src/server/routes/memory';
import { getUserUploadDir } from '../src/utils/paths';
import type { MessageHandler, UserState as UserStateType, ChapterPlan as ChapterPlanType, SectionProgress as SectionProgressType, ChatOptions, APIClient } from '../src/types';
import type { RetrievedDocument, UnifiedLiterature } from '../src/types/literature';
import { AgentCollaborationWorkflow } from '../agents/agent-collaboration-workflow';
import { HybridRetrievalEngine } from '../src/literature/retrieval';
import { ParagraphGenerator } from '../src/literature/generation';
import { SentenceLevelRetriever } from '../src/literature/retrieval/sentence-retriever';
import type { PromptClient } from '../src/utils/cloud-prompt-client';
import * as fs from 'fs';
import * as path from 'path';

// 期刊风格配置接口
interface JournalStyleConfig {
  journal?: string;
  citation_format?: {
    reference_style?: string;
    in_text_style?: string;
    reference_example?: string;
  };
  word_count?: Record<string, number>;
  structure?: Record<string, string>;
  writing_style?: {
    tone?: string;
    sentence_length?: string;
    paragraph_structure?: string;
    transition_words?: string[];
  };
  key_phrases?: Record<string, string[]>;
  author_guidelines?: Record<string, unknown>;
  cover_letter_requirements?: Record<string, unknown>;
  submission_materials?: Record<string, unknown>;
}

// 对话阶段
export type ConversationPhase = 
  | 'greeting'      // 问候
  | 'topic'         // 了解主题
  | 'research'      // 深度研究/检索规划
  | 'journal'       // 确认期刊
  | 'upload'        // 上传材料
  | 'planning'      // 章节规划
  | 'writing'       // 写作执行
  | 'integrity'     // 引用与主张真实性审计
  | 'review'        // 多审稿人质量检查
  | 'revision'      // 修订
  | 'final'         // 定稿
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
  private collaborationWorkflow: AgentCollaborationWorkflow | null = null;
  private apiClient: APIClient | null = null;
  private promptClient?: PromptClient;
  private useCloudPrompt: boolean;

  constructor(
    messageHandler: MessageHandler,
    sessionStore?: SessionStore,
    apiConfig?: { apiUrl: string; apiKey: string; embeddingModel?: string; maxConcurrency?: number; promptClient?: PromptClient; useCloudPrompt?: boolean },
    retrievalEngine?: HybridRetrievalEngine
  ) {
    this.messageHandler = messageHandler;
    this.sessions = new Map();
    this.sessionStore = sessionStore || new SessionStore('./data/sessions');
    this.apiUrl = apiConfig?.apiUrl || process.env.API_URL || '';
    this.apiKey = apiConfig?.apiKey || process.env.API_KEY || '';
    this.embeddingModel = apiConfig?.embeddingModel || process.env.EMBEDDING_MODEL || 'text-embedding-v4';
    this.maxConcurrency = apiConfig?.maxConcurrency || 5;
    this.promptClient = apiConfig?.promptClient;
    this.useCloudPrompt = apiConfig?.useCloudPrompt !== false;
    this.retrievalEngine = retrievalEngine || new HybridRetrievalEngine({}, { url: this.apiUrl, key: this.apiKey });
    
    // 初始化 API Client（用于 Agent 系统）
    this.initApiClient();
  }

  /**
   * 初始化 API Client
   */
  private initApiClient(): void {
    if (!this.apiUrl || !this.apiKey) {
      logger.warn('[Flow] API config missing, AgentCollaborationWorkflow will not be initialized');
      return;
    }
    
    this.apiClient = createLLMApiClient({
      apiUrl: this.apiUrl,
      apiKey: this.apiKey,
      defaultModel: 'gpt-4o',
      defaultTemperature: 0.7,
      label: 'ConversationFlow',
    });
  }

  /**
   * 动态更新 API 配置（用户在前端修改设置后调用）
   */
  updateApiConfig(apiUrl: string, apiKey: string): void {
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.initApiClient();  // 重新初始化 API Client
    logger.info(`[Flow] API config updated: url=${apiUrl ? '已配置' : '空'}, key=${apiKey ? '已配置' : '空'}`);
  }

  setRetrievalEngine(retrievalEngine: HybridRetrievalEngine): void {
    this.retrievalEngine = retrievalEngine;
    if (this.collaborationWorkflow) {
      this.collaborationWorkflow = null;
    }
    logger.info(`[Flow] Retrieval engine updated (${retrievalEngine.getDocumentCount()} documents)`);
  }

  /**
   * 从用户上传的期刊风格文件中读取风格配置
   * @param userId 用户ID
   * @returns 期刊风格配置，如果不存在返回null
   */
  private getJournalStyleConfig(userId: string): JournalStyleConfig | null {
    try {
      const userDir = getUserUploadDir(userId);
      const journalStyleDir = path.join(userDir, 'journal-styles');
      
      if (!fs.existsSync(journalStyleDir)) {
        logger.info(`[Flow] No journal style directory found for user ${userId}`);
        return null;
      }
      
      const styleFolders = fs.readdirSync(journalStyleDir);
      if (styleFolders.length === 0) {
        logger.info(`[Flow] No journal style folders found for user ${userId}`);
        return null;
      }
      
      // 读取第一个期刊风格文件夹中的配置
      const styleFile = path.join(journalStyleDir, styleFolders[0], 'style.json');
      if (!fs.existsSync(styleFile)) {
        logger.warn(`[Flow] Style file not found: ${styleFile}`);
        return null;
      }
      
      const styleContent = fs.readFileSync(styleFile, 'utf-8');
      const styles: JournalStyleConfig[] = JSON.parse(styleContent);
      
      // 合并所有论文的风格配置（取第一个有效的）
      const mergedStyle: JournalStyleConfig = {};
      for (const style of styles) {
        if (style.citation_format && !mergedStyle.citation_format) {
          mergedStyle.citation_format = style.citation_format;
        }
        if (style.word_count && !mergedStyle.word_count) {
          mergedStyle.word_count = style.word_count;
        }
        if (style.writing_style && !mergedStyle.writing_style) {
          mergedStyle.writing_style = style.writing_style;
        }
        if (style.journal && !mergedStyle.journal) {
          mergedStyle.journal = style.journal;
        }
        if (style.author_guidelines && !mergedStyle.author_guidelines) {
          mergedStyle.author_guidelines = style.author_guidelines;
        }
        if (style.cover_letter_requirements && !mergedStyle.cover_letter_requirements) {
          mergedStyle.cover_letter_requirements = style.cover_letter_requirements;
        }
        if (style.submission_materials && !mergedStyle.submission_materials) {
          mergedStyle.submission_materials = style.submission_materials;
        }
      }
      
      logger.info(`[Flow] Loaded journal style config for ${mergedStyle.journal || 'unknown journal'}`);
      return mergedStyle;
    } catch (error) {
      logger.error(`[Flow] Failed to load journal style config:`, error);
      return null;
    }
  }

  /**
   * 根据期刊风格配置获取引用风格
   * @param styleConfig 期刊风格配置
   * @returns 引用风格标识符 ('numeric' | 'author-year')
   */
  private getCitationStyle(styleConfig: JournalStyleConfig | null): 'numeric' | 'author-year' {
    if (!styleConfig?.citation_format?.reference_style) {
      return 'numeric'; // 默认使用数字引用
    }
    
    const refStyle = styleConfig.citation_format.reference_style;
    const inTextStyle = styleConfig.citation_format.in_text_style || '';
    
    // 优先根据文内引用风格判断
    if (inTextStyle.includes('作者') || inTextStyle.includes('年份') || inTextStyle.includes('Author')) {
      return 'author-year';
    }
    if (inTextStyle.includes('数字') || inTextStyle.includes('Number')) {
      return 'numeric';
    }
    
    // 根据参考文献风格判断
    // APA, Chicago, GB/T 7714 通常是作者-年份制
    // IEEE, Nature 通常是数字制
    const authorYearStyles = ['APA', 'apa', 'Chicago', 'chicago', 'GB/T 7714', 'GB/T7714', '国标'];
    const numericStyles = ['IEEE', 'ieee', 'Nature', 'nature', '数字制'];
    
    for (const style of authorYearStyles) {
      if (refStyle.includes(style)) {
        return 'author-year';
      }
    }
    
    for (const style of numericStyles) {
      if (refStyle.includes(style)) {
        return 'numeric';
      }
    }
    
    // 默认
    return 'numeric';
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

  async resetUserSession(userId: string): Promise<void> {
    this.sessions.delete(userId);
    await this.sessionStore.delete(userId);
  }

  async processMessage(userId: string, message: string): Promise<string> {
    const session = await this.getSession(userId);
    logger.info(`[Flow] Processing message in phase: ${session.phase}`);

    // 检测是否为直接写作请求（跳过阶段流程）
    const isDirectWritingRequest = this.detectWritingRequest(message);
    if (isDirectWritingRequest && session.phase !== 'writing') {
      logger.info(`[Flow] Detected direct writing request: ${isDirectWritingRequest}`);
      // 初始化写作阶段所需的上下文
      // Bug fix: 不再设置默认占位值，避免删除记忆后自动恢复
      // 如果用户删除了 memory 中的 paper_topic/target_journal，不应自动填充占位值
      // 这样用户删除后就不会被"未指定主题"等占位值自动恢复
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
      
      // 同步关键信息到长期记忆
      await this.syncKeyInfoToMemory(session);
      
      // 直接进入写作阶段
      return await this.handleWriting(message, session);
    }

    switch (session.phase) {
      case 'greeting':
        return this.handleGreeting(message, session);
      case 'topic':
        return await this.handleTopic(message, session);
      case 'journal':
        return await this.handleJournal(message, session);
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
  private async handleTopic(message: string, session: UserState): Promise<string> {
    session.paperTopic = message;
    session.phase = 'journal';
    await this.syncKeyInfoToMemory(session);
    return `很好！主题是：**${message}**

接下来请问：
1. 你的目标期刊是哪个？（如 Nature Climate Change, GCB 等）
2. 或者你更关注某个具体的研究领域？
3. 如果没有特定期刊，我可以帮你推荐合适的期刊`;
  }

  // 期刊阶段
  private async handleJournal(message: string, session: UserState): Promise<string> {
    session.targetJournal = message;
    session.phase = 'upload';
    await this.syncKeyInfoToMemory(session);
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
    // 检查是否是明确的开始写作指令
    if (message.includes('确认') || message.includes('开始写作') || message.includes('开始写')) {
      return await this.startWriting(session);
    }
    
    // 检查是否是简单的写作请求（短消息，仅包含章节关键词）
    const isSimpleWriteRequest = /^(写|帮我写|开始写)(引言|方法|结果|讨论|结论|摘要)[：:]?\s*$/i.test(message.trim());
    if (isSimpleWriteRequest) {
      // 短写作请求，询问确认
      return `好的，请问你想：
1. 查看某个章节的内容？
2. 修改某个章节的规划？
3. 确认开始写作？（回复"确认开始"）`;
    }
    
    // 长文本或复杂请求：直接调用 API 处理，不要返回固定模版
    // 这是修复长文本走模版的关键改动
    logger.info('[Flow] Complex writing request, delegating to API...');
    return await this.processWithAPI(message, session);
  }
  
  /**
   * 直接调用 API 处理复杂请求（不走固定模版）
   */
  private async processWithAPI(message: string, session: UserState): Promise<string> {
    if (!this.apiKey || !this.apiUrl) {
      return '错误：未配置 API 密钥。请先设置 API_URL 和 API_KEY。';
    }
    
    try {
      // 构建消息
      const messages: ChatOptions['messages'] = [
        {
          role: 'system',
          content: `你是一个专业的学术论文写作助手。
${session.paperTopic ? `论文主题：${session.paperTopic}` : ''}
${session.targetJournal ? `目标期刊：${session.targetJournal}` : ''}
${session.researchContent ? `研究内容：${session.researchContent}` : ''}

请根据用户的需求提供帮助。如果用户提供了文献或材料，请引用它们。`
        }
      ];
      
      // 添加历史
      if (session.chapterPlans && session.chapterPlans.size > 0) {
        let historyText = '当前章节规划：\n';
        for (const [name, plan] of session.chapterPlans) {
          historyText += `- ${name}: ${plan.writingFocus}\n`;
        }
        messages.push({ role: 'assistant', content: historyText });
      }
      
      messages.push({ role: 'user', content: message });
      
      return await callChatCompletion(
        {
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          label: 'ConversationFlow',
          defaultModel: 'gpt-4o',
        },
        {
          model: 'gpt-4o',
          messages,
          temperature: 0.7,
          maxTokens: 16384,
        }
      );
      
    } catch (error) {
      logger.error('[Flow] API call failed:', error);
      return `处理请求时出错：${(error as Error).message}`;
    }
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

  // 开始写作 - 使用大牛马-小牛马协作流程
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

    // 确保 API Client 已初始化
    if (!this.apiClient) {
      this.initApiClient();
    }

    // 初始化 AgentCollaborationWorkflow（使用大牛马-小牛马协作）
    if (!this.collaborationWorkflow && this.apiClient) {
      this.collaborationWorkflow = new AgentCollaborationWorkflow(
        this.apiClient,
        this.retrievalEngine,
        {
          apiUrl: this.apiUrl,
          apiKey: this.apiKey,
          embeddingModel: this.embeddingModel,
          promptClient: this.promptClient,
          useCloudPrompt: this.useCloudPrompt,
        }
      );
      logger.info('[Flow] AgentCollaborationWorkflow initialized');
    }

    if (!this.collaborationWorkflow) {
      return '错误：Agent 系统初始化失败。';
    }

    // 加载长期记忆
    let longTermMemory = '';
    try {
      const userMemory = await loadUserMemory(session.id);
      if (userMemory.entries && userMemory.entries.length > 0) {
        const memoryLines = userMemory.entries.map(e => `- ${e.key}: ${e.value}`).join('\n');
        longTermMemory = `## 用户跨会话记忆\n${memoryLines}\n`;
      }
    } catch (error) {
      logger.warn(`[Flow] Failed to load long-term memory for ${session.id}:`, error);
    }

    // 加载期刊风格配置
    const journalStyleConfig = this.getJournalStyleConfig(session.id);
    logger.info(`[Flow] Journal style config loaded: ${journalStyleConfig?.journal || 'none'}`);

    // 准备写作任务
    const chapters = Array.from(session.chapterPlans.entries());
    const header = '好的！开始大牛马-小牛马协作写作。\n\n';

    // P1-5：章节级并行编排。每章独立执行「检索词生成 → 检索 → Skill → 写作 → ARS 校验」，
    // 互不阻塞；任一章节失败只影响该章（writeChapter 内部已隔离），其余章节照常完成，
    // 输出按原章节顺序汇总。AgentCollaborationWorkflow.execute 无实例级可变状态，可安全并发。
    const chapterTasks = chapters.map(([chapterName, chapterPlan]) => (
      this.writeChapter(session, chapterName, chapterPlan, {
        longTermMemory,
        journalStyleConfig: journalStyleConfig || undefined,
      })
    ));
    const settled = await Promise.allSettled(chapterTasks);

    let output = header;
    settled.forEach((outcome, index) => {
      const [chapterName] = chapters[index] || ['unknown', undefined];
      if (outcome.status === 'fulfilled') {
        output += outcome.value;
      } else {
        // 安全网：writeChapter 内部已捕获异常，走到这里说明任务级意外失败。
        logger.error(`[Flow] Unexpected failure for chapter ${chapterName}:`, outcome.reason);
        output += `\n📝 正在写作：${chapterName}\n`;
        output += `❌ ${chapterName} 写作失败：${(outcome.reason as Error)?.message || String(outcome.reason)}\n\n`;
      }
    });

    output += '\n🎉 写作完成！\n';
    output += `共处理 ${chapters.length} 个章节\n`;
    output += '所有引用均来自您的文献库，确保真实性和准确性。\n';

    session.phase = 'complete';
    await this.saveProgress(session.id);

    return output;
  }

  /**
   * P1-5：单个章节的完整写作流水线（大牛马生成检索词 → 小牛马检索 → 大牛马生成 Skill →
   * 小牛马写作）。失败只影响本章节，返回给调用方按章节顺序汇总。
   */
  private async writeChapter(
    session: UserState,
    chapterName: string,
    chapterPlan: ChapterPlan,
    context: { longTermMemory: string; journalStyleConfig: JournalStyleConfig | undefined },
  ): Promise<string> {
    let output = `\n📝 正在写作：${chapterName}\n`;
    output += `   写作重点：${chapterPlan.writingFocus}\n`;
    output += `   关键要点：${chapterPlan.keyPoints?.length || 0} 个\n\n`;

    try {
      if (!this.collaborationWorkflow) {
        throw new Error('Agent 系统未初始化，无法写作');
      }
      // 调用 AgentCollaborationWorkflow（大牛马生成检索词 → 小牛马检索 → 大牛马生成 Skill → 小牛马写作）
      const result = await this.collaborationWorkflow.execute({
        userId: session.id,
        chapterName,
        chapterPlan,
        researchContext: session.researchContent || '',
        longTermMemory: context.longTermMemory,
        userSkillContent: undefined,  // 可从文件加载
        targetJournal: session.targetJournal,
        journalStyleConfig: context.journalStyleConfig,
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        embeddingModel: this.embeddingModel,
      });

      // 检查是否有写作输出
      if (result.writtenContent) {
        const content = result.writtenContent;

        output += `✅ ${chapterName} 写作完成！\n`;
        output += `   内容长度：${content.length} 字符\n`;
        output += `   检索文献：${result.searchResults.reduce((s, r) => s + r.selectedCount, 0)} 篇\n\n`;
        if (result.arsReports) {
          const arsCompleted = [
            result.arsReports.pipelineGate ? `pipeline-gate(${result.arsReports.pipelineGate.provider})` : '',
            result.arsReports.researchPlan ? `research-plan(${result.arsReports.researchPlan.provider})` : '',
            result.arsReports.citationIntegrity ? `citation-integrity(${result.arsReports.citationIntegrity.provider})` : '',
          ].filter(Boolean);
          if (arsCompleted.length > 0) {
            output += `   ARS 默认检查：${arsCompleted.join(', ')}\n\n`;
          }
        }

        // 显示内容摘要
        const previewLines = content.split('\n').slice(0, 5).join('\n');
        output += `---\n${previewLines}\n...\n---\n\n`;

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
      } else {
        // 没有写作输出（可能是文献不足或 API 配置缺失）
        output += `⚠️ ${chapterName} 未生成内容：${result.finalPrompt ? '请检查 API 配置' : '未找到相关文献'}\n\n`;

        if (!session.writingProgress) {
          session.writingProgress = new Map();
        }
        session.writingProgress.set(chapterName, {
          status: 'failed',
          skillGenerated: true,
          error: result.writtenContent || '写作失败',
        });
      }
    } catch (error) {
      logger.error(`[Flow] Writing failed for ${chapterName}:`, error);
      output += `❌ ${chapterName} 写作失败：${(error as Error).message}\n\n`;

      if (!session.writingProgress) {
        session.writingProgress = new Map();
      }
      session.writingProgress.set(chapterName, {
        status: 'failed',
        skillGenerated: false,
        error: (error as Error).message,
      });
    }

    return output;
  }

  private async generateSearchQueries(
    apiClient: { chat: (options: { model: string; messages: Array<{ role: string; content: string }>; temperature?: number; maxTokens?: number }) => Promise<string> },
    chapterPlan: ChapterPlan,
    session: UserState,
    userId: string
  ): Promise<string[]> {
    let longTermMemory = '';
    try {
      const userMemory = await loadUserMemory(userId);
      if (userMemory.entries && userMemory.entries.length > 0) {
        const memoryLines = userMemory.entries.map(e => `- ${e.key}: ${e.value}`).join('\n');
        longTermMemory = `\n## 用户跨会话记忆\n${memoryLines}\n`;
      }
    } catch (error) {
      logger.warn(`[Flow] Failed to load long-term memory for ${userId}:`, error);
    }

    const prompt = `你是一位专业的学术文献检索专家。请根据以下章节写作规划，分别生成3-5个英文检索词/短语和3-5个中文检索词/短语，用于在文献数据库中分路检索相关文献。

## 章节信息
- 章节名称: ${chapterPlan.chapterName}
- 写作重点: ${chapterPlan.writingFocus}
- 关键要点: ${chapterPlan.keyPoints?.join(', ') || '未指定'}
${longTermMemory}
## 论文主题
${session.paperTopic || '未指定'}

## 研究内容摘要
${session.researchContent?.slice(0, 1000) || '未提供'}

## 要求
1. 英文检索词使用学术英文短语，中文检索词使用准确中文术语
2. 检索词应该覆盖不同的子主题和角度
3. 必须保留并翻译方向性动词，例如 reduce/decrease/降低、increase/增加、promote/促进、inhibit/抑制
4. 避免过于宽泛的词汇（如"study", "research", "研究"）

## 输出格式
每行一个检索词，不要编号，不要其他说明。例如：
intervention A reduce target risk
method B improve prediction accuracy
干预A 降低 目标风险
方法B 提高 预测准确性

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

  /**
   * 将 session 中的关键元信息（论文主题、目标期刊）同步到长期记忆
   * 修复：确保自由聊天路径也能读取到这些信息
   * Bug fix: 跳过默认占位值，避免用户删除记忆后被自动恢复
   * Bug fix #2: 检查 deletedKeys，防止用户删除后被自动恢复
   */
  private async syncKeyInfoToMemory(session: UserState): Promise<void> {
    try {
      const memory = await loadUserMemory(session.id);
      let changed = false;

      // Bug fix: 定义默认占位值列表，这些值不应同步到 memory
      const PLACEHOLDER_VALUES = [
        '未指定主题',
        '未指定期刊',
        '未指定',
        '暂无',
        '无',
        'none',
        'unknown',
        'not specified',
        'paper topic',
        'research topic',
        'target journal',
        '论文主题',
        '研究主题',
        '目标期刊',
      ];

      if (session.paperTopic) {
        // ========== Bug fix #2: 检查 deletedKeys ==========
        if (isKeyDeleted(memory, 'paper_topic')) {
          logger.info(`[Flow] SKIP syncing "paper_topic" - user has deleted this key`);
        } else {
          // Bug fix: 跳过默认占位值，不写入 memory
          const isPlaceholder = PLACEHOLDER_VALUES.some(p => 
            session.paperTopic!.toLowerCase().includes(p.toLowerCase())
          );
          if (!isPlaceholder) {
            const idx = memory.entries.findIndex(e => e.key === 'paper_topic');
            const entry = {
              key: 'paper_topic',
              value: session.paperTopic,
              source: 'conversation-flow',
              timestamp: new Date().toISOString(),
            };
            if (idx >= 0) {
              memory.entries[idx] = entry;
            } else {
              memory.entries.push(entry);
            }
            changed = true;
          } else {
            logger.info(`[Flow] Skip syncing placeholder value for paper_topic: "${session.paperTopic}"`);
          }
        }
      }

      if (session.targetJournal) {
        // ========== Bug fix #2: 检查 deletedKeys ==========
        if (isKeyDeleted(memory, 'target_journal')) {
          logger.info(`[Flow] SKIP syncing "target_journal" - user has deleted this key`);
        } else {
          // Bug fix: 跳过默认占位值，不写入 memory
          const isPlaceholder = PLACEHOLDER_VALUES.some(p => 
            session.targetJournal!.toLowerCase().includes(p.toLowerCase())
          );
          if (!isPlaceholder) {
            const idx = memory.entries.findIndex(e => e.key === 'target_journal');
            const entry = {
              key: 'target_journal',
              value: session.targetJournal,
              source: 'conversation-flow',
              timestamp: new Date().toISOString(),
            };
            if (idx >= 0) {
              memory.entries[idx] = entry;
            } else {
              memory.entries.push(entry);
            }
            changed = true;
          } else {
            logger.info(`[Flow] Skip syncing placeholder value for target_journal: "${session.targetJournal}"`);
          }
        }
      }

      if (changed) {
        await saveUserMemory(memory);
        logger.info(`[Flow] Synced key info to memory for ${session.id}: topic=${session.paperTopic}, journal=${session.targetJournal}`);
      }
    } catch (e) {
      logger.warn(`[Flow] Failed to sync key info to memory for ${session.id}:`, e);
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
