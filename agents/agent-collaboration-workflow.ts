import { logger } from '../src/utils/logger';
import { PrimaryAgent, type GeneratedSkill, type JournalStyleConfig } from './primary-agent';
import { SecondaryAgent, type SecondaryAgentConfig } from './secondary-agent-v2';
import { LiteratureSearchAgent, type SearchQueryPrompt, type SearchAndSelectionResult, type SelectedLiterature } from './literature-search-agent';
import { HybridRetrievalEngine } from '../src/literature/retrieval';
import type { APIClient, ChapterPlan } from '../src/types';
import type { LitPaper } from './paragraph-agent';
import type { PromptClient } from '../src/utils/cloud-prompt-client';
import {
  runAcademicResearchSkill,
  type AcademicResearchMode,
  type AcademicResearchRunResult,
} from '../src/server/services/academic-research-skills';

export interface CollaborationContext {
  userId: string;
  chapterName: string;
  chapterPlan: ChapterPlan;
  researchContext: string;
  longTermMemory?: string;
  userSkillContent?: string;
  experimentSummary?: string;
  dataSummary?: string;
  userPreferences?: string;
  targetJournal?: string;
  writingProgress?: string;
  journalStyleConfig?: JournalStyleConfig;
  // SecondaryAgent 所需配置
  apiUrl?: string;
  apiKey?: string;
  embeddingModel?: string;
}

export interface CollaborationResult {
  skill: GeneratedSkill;
  literatureContext: string;
  searchResults: SearchAndSelectionResult[];
  finalPrompt: string;
  writtenContent?: string;  // 新增：小牛马写作输出
  aiMetadata?: {            // 新增：AI生成元数据标识
    ai_generated: boolean;
    generated_at: string;
    model_used: string;
    tool_name: string;
    version: string;
    disclaimer: string;
  };
  arsReports?: {
    pipelineGate?: AcademicResearchRunResult;
    socraticPlan?: AcademicResearchRunResult;
    researchPlan?: AcademicResearchRunResult;
    citationIntegrity?: AcademicResearchRunResult;
  };
}

export class AgentCollaborationWorkflow {
  private primaryAgent: PrimaryAgent;
  private secondaryAgent: SecondaryAgent;
  private literatureSearchAgent: LiteratureSearchAgent;
  private retrievalEngine: HybridRetrievalEngine;
  private apiUrl: string;
  private apiKey: string;
  private embeddingModel: string;
  private promptClient?: PromptClient;
  private useCloudPrompt: boolean;
  private cloudTopicSkillContent?: string | null;

  constructor(
    apiClient: APIClient,
    retrievalEngine: HybridRetrievalEngine,
    config?: {
      primaryModel?: string;
      secondaryModels?: Record<string, string>;
      apiUrl?: string;
      apiKey?: string;
      embeddingModel?: string;
      promptClient?: PromptClient;
      useCloudPrompt?: boolean;
    }
  ) {
    this.retrievalEngine = retrievalEngine;
    this.apiUrl = config?.apiUrl || process.env.API_URL || '';
    this.apiKey = config?.apiKey || process.env.API_KEY || '';
    this.embeddingModel = config?.embeddingModel || process.env.EMBEDDING_MODEL || 'text-embedding-v4';
    this.promptClient = config?.promptClient;
    this.useCloudPrompt = config?.useCloudPrompt !== false;

    // 大牛马：规划、Skill生成、质量检查
    const primaryModel = config?.primaryModel || 'claude-sonnet-4-5';
    this.primaryAgent = new PrimaryAgent(apiClient, primaryModel, this.promptClient);

    // 小牛马：执行写作（按章节分配模型）
    const defaultSecondaryModels: Record<string, string> = {
      introduction: 'gpt-4o',
      methods: 'gpt-4o',
      results: 'gpt-4o',
      discussion: 'claude-sonnet-4-5',
      abstract: 'gpt-4o',
      conclusion: 'claude-sonnet-4-5',
      default: 'gpt-4o',
    };
    const secondaryModels = config?.secondaryModels || defaultSecondaryModels;
    const secondaryConfig: SecondaryAgentConfig = {
      models: secondaryModels,
      maxConcurrency: 5,
      promptClient: this.promptClient,
    };
    this.secondaryAgent = new SecondaryAgent(apiClient, secondaryConfig);

    // 文献检索 Agent（使用小牛马默认模型）
    const secondaryModel = secondaryModels.default || 'gpt-4o';
    this.literatureSearchAgent = new LiteratureSearchAgent(apiClient, retrievalEngine, secondaryModel);
  }

  async execute(context: CollaborationContext): Promise<CollaborationResult> {
    const startTime = Date.now();
    logger.info(`[Collaboration] 开始大牛马-小牛马协作流程: ${context.chapterName}`);
    const arsReports: CollaborationResult['arsReports'] = {};

    // ARS 默认阶段闸门：写作前先判断当前材料是否适合进入写作。
    arsReports.pipelineGate = await this.runArsSafely('pipeline-gate', {
      context,
      content: context.writingProgress,
    });

    // 步骤1: 大牛马生成检索提示词
    logger.info('[Collaboration] 步骤1: 大牛马生成检索提示词');
    let searchQueries = await this.primaryAgent.generateSearchQueries({
      chapterName: context.chapterName,
      writingFocus: context.chapterPlan.writingFocus,
      keyPoints: context.chapterPlan.keyPoints,
      researchContext: context.researchContext,
      longTermMemory: context.longTermMemory,
      targetCount: 4,
    });

    if (this.shouldRunResearchPlan(context.chapterName)) {
      // ARS deep-research 前置规划：Introduction/Discussion 检索前生成检索策略、纳排标准、文献矩阵。
      arsReports.researchPlan = await this.runArsSafely('research-plan', { context });
      searchQueries = this.mergeArsSearchQueries(searchQueries, arsReports.researchPlan);
    }

    logger.info(`[Collaboration] 生成了 ${searchQueries.length} 个检索提示词`);

    // 步骤2: 小牛马并行检索筛选文献
    logger.info('[Collaboration] 步骤2: 小牛马并行检索筛选文献');
    const searchResults = await Promise.all(
      searchQueries.map(query => this.literatureSearchAgent.executeSearchPipeline(query))
    );

    logger.info(`[Collaboration] 检索完成，共筛选出 ${searchResults.reduce((s, r) => s + r.selectedCount, 0)} 篇文献`);

    // 步骤3: 合并文献上下文
    logger.info('[Collaboration] 步骤3: 合并文献上下文');
    const literatureContext = this.mergeLiteratureContexts(searchResults);

    // 步骤4: 大牛马生成写作指导 Skill
    logger.info('[Collaboration] 步骤4: 大牛马生成写作指导 Skill');
    const skill = await this.primaryAgent.generateSkill({
      chapterName: context.chapterName,
      userPlan: context.chapterPlan,
      researchContent: context.researchContext,
      longTermMemory: context.longTermMemory,
      userSkillContent: context.userSkillContent,
      experimentSummary: context.experimentSummary,
      dataSummary: context.dataSummary,
      userPreferences: context.userPreferences,
      targetJournal: context.targetJournal,
      writingProgress: context.writingProgress,
      journalStyleConfig: context.journalStyleConfig,
      useCloudPrompt: this.useCloudPrompt,
    });

    // 步骤5: 小牛马执行写作 ← 新增
    logger.info('[Collaboration] 步骤5: 小牛马执行写作');
    
    // 将检索结果转换为 LitPaper 格式
    const literaturePapers = this.convertToLitPapers(searchResults);
    
    // 检查是否有 API 配置
    const apiUrl = context.apiUrl || this.apiUrl;
    const apiKey = context.apiKey || this.apiKey;
    const embeddingModel = context.embeddingModel || this.embeddingModel;
    
    if (!apiUrl || !apiKey) {
      logger.warn('[Collaboration] Missing API config, skipping SecondaryAgent execution');
      const finalPrompt = this.buildFinalPrompt(skill, literatureContext, context);
      return {
        skill,
        literatureContext,
        searchResults,
        finalPrompt,
        writtenContent: undefined,  // 未执行写作
        arsReports,
      };
    }
    
    if (literaturePapers.length === 0) {
      logger.warn('[Collaboration] No literature papers found, skipping SecondaryAgent execution');
      const finalPrompt = this.buildFinalPrompt(skill, literatureContext, context);
      return {
        skill,
        literatureContext,
        searchResults,
        finalPrompt,
        writtenContent: `未找到相关文献。建议：\n1. 更换关键词\n2. 确认文献库中有相关文献\n3. 直接提供具体文献信息`,
        arsReports,
      };
    }
    
    // 调用小牛马执行写作
    const writeResult = await this.secondaryAgent.writeSectionWithParallelSearch({
      skill,
      chapterPlan: context.chapterPlan,
      researchContent: context.researchContext,
      chapterName: context.chapterName,
      literaturePapers,
      apiUrl,
      apiKey,
      embeddingModel,
      longTermMemory: context.longTermMemory,
      userSkillContent: context.userSkillContent,
      journalStyleConfig: context.journalStyleConfig,
      useCloudPrompt: this.useCloudPrompt,
    });

    // 提取内容和元数据（secondary-agent-v2 返回 { content, metadata })
    const writtenContent = writeResult.content;
    const aiMetadata = writeResult.metadata;

    // ARS citation-check + integrity gate：章节写完后检查引用存在性、元数据风险、claim-reference alignment。
    arsReports.citationIntegrity = await this.runArsSafely('citation-integrity', {
      context,
      content: writtenContent,
      references: literaturePapers,
    });

    const finalPrompt = this.buildFinalPrompt(skill, literatureContext, context);

    const totalTime = Date.now() - startTime;
    logger.info(`[Collaboration] 协作流程完成，耗时 ${totalTime}ms，输出 ${writtenContent.length} 字符`);
    logger.info(`[Collaboration] AI生成标识: 模型=${aiMetadata.model_used}, 时间=${aiMetadata.generated_at}`);

    return {
      skill,
      literatureContext,
      searchResults,
      finalPrompt,
      writtenContent,
      aiMetadata, // 新增 AI 元数据
      arsReports,
    };
  }

  private async runArsSafely(
    mode: AcademicResearchMode,
    input: {
      context: CollaborationContext;
      content?: string;
      references?: unknown[];
    }
  ): Promise<AcademicResearchRunResult | undefined> {
    try {
      const result = await runAcademicResearchSkill({
        mode,
        userId: input.context.userId,
        chapterName: input.context.chapterName,
        topic: input.context.chapterPlan.writingFocus,
        targetJournal: input.context.targetJournal,
        currentPhase: mode === 'pipeline-gate' ? 'writing' : undefined,
        researchContext: input.context.researchContext,
        chapterPlan: input.context.chapterPlan,
        content: input.content,
        references: input.references,
        userInstruction: input.context.userPreferences,
        topicSkillContent: await this.getCloudTopicSkillContent(),
      });
      logger.info(`[Collaboration] ARS ${mode} 完成，provider=${result.provider}`);
      return result;
    } catch (error) {
      logger.warn(`[Collaboration] ARS ${mode} failed, continuing main workflow`, error);
      return undefined;
    }
  }

  private async getCloudTopicSkillContent(): Promise<string | undefined> {
    if (!this.useCloudPrompt || !this.promptClient?.getCorePrompt) return undefined;
    if (this.cloudTopicSkillContent !== undefined) {
      return this.cloudTopicSkillContent || undefined;
    }
    try {
      const prompt = await this.promptClient.getCorePrompt('auto_research_topic_content_skill');
      this.cloudTopicSkillContent = prompt.content;
      return prompt.content;
    } catch (error) {
      logger.warn('[Collaboration] Failed to load cloud Auto Research topic skill', error);
      this.cloudTopicSkillContent = null;
      return undefined;
    }
  }

  private shouldRunResearchPlan(chapterName: string): boolean {
    const normalized = chapterName.toLowerCase();
    return /intro|引言|discussion|讨论|literature|文献/.test(normalized);
  }

  private mergeArsSearchQueries(
    baseQueries: SearchQueryPrompt[],
    researchPlan?: AcademicResearchRunResult
  ): SearchQueryPrompt[] {
    if (!researchPlan?.content) return baseQueries;
    const parsed = this.extractJsonObject(researchPlan.content);
    const arsQueries = Array.isArray(parsed?.searchQueries)
      ? parsed.searchQueries
      : Array.isArray(parsed?.queries)
        ? parsed.queries
        : [];
    if (arsQueries.length === 0) return baseQueries;

    const merged = [...baseQueries];
    const seen = new Set(baseQueries.map(query => `${query.topic}::${query.keywords.join(',')}`.toLowerCase()));
    for (const query of arsQueries.slice(0, 6)) {
      const topic = String(query.topic || '').trim();
      const keywords = Array.isArray(query.keywords)
        ? query.keywords.map((keyword: unknown) => String(keyword).trim()).filter(Boolean)
        : [];
      if (!topic && keywords.length === 0) continue;
      const key = `${topic}::${keywords.join(',')}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        queryId: `ars-${merged.length + 1}-${Date.now()}`,
        topic: topic || keywords.join(' '),
        keywords,
        argumentContext: String(query.argumentContext || query.rationale || 'ARS deep-research 前置检索规划生成的补充证据需求'),
        targetCount: Number(query.targetCount || 4),
        filters: query.filters,
      });
    }

    logger.info(`[Collaboration] ARS research-plan merged ${merged.length - baseQueries.length} extra search queries`);
    return merged;
  }

  private extractJsonObject(content: string): any | null {
    const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidates = [
      fenced?.[1],
      content.match(/\{[\s\S]*\}/)?.[0],
    ].filter((value): value is string => !!value);

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch {
        // Try next candidate.
      }
    }
    return null;
  }

  /**
   * 将检索结果转换为 LitPaper 格式（供 SecondaryAgent 使用）
   */
  private convertToLitPapers(searchResults: SearchAndSelectionResult[]): LitPaper[] {
    const allPapers = new Map<string, SelectedLiterature>();
    
    for (const result of searchResults) {
      for (const category of result.categories) {
        for (const paper of category.papers) {
          if (!allPapers.has(paper.id)) {
            allPapers.set(paper.id, paper);
          }
        }
      }
    }
    
    const litPapers: LitPaper[] = [];
    for (const paper of allPapers.values()) {
      litPapers.push({
        citationId: paper.citationId,
        title: paper.title,
        author: paper.authors,
        journal: paper.journal || '',
        year: String(paper.year),
        abstract: paper.abstract,
        keywords: (paper.keywords || []).join(', '),
        doi: paper.doi,
        embedding: paper.embedding,
      });
    }
    
    logger.info(`[Collaboration] Converted ${litPapers.length} unique papers to LitPaper format`);
    return litPapers;
  }

  private mergeLiteratureContexts(searchResults: SearchAndSelectionResult[]): string {
    let merged = `## 文献检索汇总\n\n`;
    
    const allPapers = new Map<string, typeof searchResults[0]['categories'][0]['papers'][0]>();
    
    for (const result of searchResults) {
      merged += `### 检索主题: ${result.queryPrompt.topic}\n`;
      merged += `检索到 ${result.totalFound} 篇，筛选出 ${result.selectedCount} 篇高质量文献\n\n`;
      
      for (const category of result.categories) {
        for (const paper of category.papers) {
          if (!allPapers.has(paper.id)) {
            allPapers.set(paper.id, paper);
          }
        }
      }
    }

    merged += `### 筛选出的高质量文献（共 ${allPapers.size} 篇）\n\n`;
    
    const sortedPapers = Array.from(allPapers.values())
      .sort((a, b) => (b.combinedScore || 0) - (a.combinedScore || 0));

    for (const paper of sortedPapers) {
      merged += `#### ${paper.title}\n`;
      merged += `- **作者**: ${paper.authors}\n`;
      merged += `- **年份**: ${paper.year}\n`;
      merged += `- **期刊**: ${paper.journal || '未知'}\n`;
      if (paper.keywords && paper.keywords.length > 0) {
        merged += `- **关键词**: ${paper.keywords.join(', ')}\n`;
      }
      merged += `- **相关度**: ${((paper.combinedScore || 0) * 100).toFixed(1)}%\n`;
      merged += `- **论点分类**: ${paper.argumentCategory || '综合'}\n\n`;
      merged += `**完整摘要**:\n${paper.abstract}\n\n`;
      merged += `**引用建议**: ${paper.citationRecommendation || '直接引用支撑论点'}\n\n`;
      merged += `---\n\n`;
    }

    merged += `### 引用约束\n`;
    merged += `1. 只能引用上述筛选出的文献\n`;
    merged += `2. 引用格式: (作者, 年份)\n`;
    merged += `3. 每个论点至少1篇文献支撑\n`;
    merged += `4. 重要观点需要2-3篇文献佐证\n`;
    merged += `5. 禁止编造未提供的文献\n\n`;

    return merged;
  }

  private buildFinalPrompt(
    skill: GeneratedSkill,
    literatureContext: string,
    context: CollaborationContext
  ): string {
    let prompt = `# 写作任务: ${context.chapterName}\n\n`;

    prompt += `## ⚠️ 重要：严格执行原则\n\n`;
    prompt += `1. **必须严格按照用户上传的 Skill（写作技能）执行**\n`;
    prompt += `2. **必须遵循用户上传的期刊风格指南**\n`;
    prompt += `3. **以下写作指导是最高优先级**\n\n`;

    if (context.userSkillContent && context.userSkillContent.trim()) {
      prompt += `## 📋 用户上传的写作技能（Skill）\n\n`;
      prompt += `**必须严格按照此 Skill 执行！**\n\n`;
      prompt += `${context.userSkillContent}\n\n`;
      prompt += `---\n\n`;
    }

    if (context.targetJournal && context.targetJournal.trim()) {
      prompt += `## 🎯 目标期刊\n\n`;
      prompt += `${context.targetJournal}\n\n`;
      prompt += `---\n\n`;
    }

    if (context.userPreferences && context.userPreferences.trim()) {
      prompt += `## 👤 用户偏好\n\n`;
      prompt += `${context.userPreferences}\n\n`;
      prompt += `---\n\n`;
    }

    if (context.writingProgress && context.writingProgress.trim()) {
      prompt += `## 📝 写作进度\n\n`;
      prompt += `${context.writingProgress}\n\n`;
      prompt += `---\n\n`;
    }

    if (context.experimentSummary && context.experimentSummary.trim()) {
      prompt += `## 🧪 实验资料总结（完整）\n\n`;
      prompt += `${context.experimentSummary}\n\n`;
      prompt += `---\n\n`;
    }

    if (context.dataSummary && context.dataSummary.trim()) {
      prompt += `## 📊 数据详细总结（完整）\n\n`;
      prompt += `${context.dataSummary}\n\n`;
      prompt += `---\n\n`;
    }

    if (context.longTermMemory && context.longTermMemory.trim()) {
      prompt += `## 🧠 跨会话长期记忆（完整）\n\n`;
      prompt += `${context.longTermMemory}\n\n`;
      prompt += `---\n\n`;
    }

    prompt += `## 写作指导（来自大牛马）\n\n`;
    prompt += `### 核心要点\n`;
    prompt += `- 写作重点: ${skill.userWritingFocus}\n`;
    prompt += `- 关键要点: ${skill.userKeyPoints.join(', ')}\n`;
    if (skill.specialRequirements) {
      prompt += `- 特殊要求: ${skill.specialRequirements}\n`;
    }
    prompt += `\n`;

    prompt += `### 结构规划\n`;
    prompt += `- 段落数: ${skill.overallStructure.paragraphCount}\n`;
    prompt += `- 主要部分: ${skill.overallStructure.mainSections.join(', ')}\n`;
    prompt += `- 过渡策略: ${skill.overallStructure.transitionStrategy}\n\n`;

    prompt += `### 段落详情\n`;
    for (const para of skill.paragraphDetails) {
      prompt += `#### 段落 ${para.paragraphId}: ${para.title}\n`;
      prompt += `- 目的: ${para.purpose}\n`;
      prompt += `- 内容要点: ${para.contentOutline.join(', ')}\n`;
      prompt += `- 预估字数: ${para.wordCountEstimate}\n\n`;
    }

    prompt += `---\n\n`;
    prompt += literatureContext;

    prompt += `---\n\n`;
    prompt += `## 执行指令\n`;
    for (const instruction of skill.executionInstructions) {
      prompt += `- ${instruction}\n`;
    }

    return prompt;
  }

  async quickSearch(
    topic: string,
    keywords: string[],
    argumentContext: string,
    targetCount: number = 4
  ): Promise<string> {
    const query: SearchQueryPrompt = {
      queryId: `quick-${Date.now()}`,
      topic,
      keywords,
      argumentContext,
      targetCount,
    };

    const result = await this.literatureSearchAgent.executeSearchPipeline(query);
    return result.contextForPrimaryAgent;
  }
}

export default AgentCollaborationWorkflow;
