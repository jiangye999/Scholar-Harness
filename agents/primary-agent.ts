// ScholarClaw - Primary Agent (一级 AI)
// 负责：理解需求、生成 skill、质量检查、生成检索提示词
// 支持：云端 Prompt 获取（可选）

import { z } from 'zod';
import { logger } from '../src/utils/logger';
import type { APIClient } from '../src/types';
import type { SearchQueryPrompt } from './literature-search-agent';
import { runAcademicResearchSkill } from '../src/server/services/academic-research-skills';

// 云端 Prompt 客户端（可选）
import type { PromptClient } from '../src/utils/cloud-prompt-client';
import { normalizeChapterName } from './secondary-agent-v2';

// 期刊风格配置接口
export interface JournalStyleConfig {
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

// 输入验证
export const ChapterPlanSchema = z.object({
  chapterName: z.string(),
  writingFocus: z.string(),
  keyPoints: z.array(z.string()),
  specialRequirements: z.string().optional(),
  wordCountTarget: z.number().optional(),
});

export const SkillGenerationInputSchema = z.object({
  chapterName: z.string(),
  userPlan: ChapterPlanSchema,
  researchContent: z.string(),
  longTermMemory: z.string().optional(),
  userSkillContent: z.string().optional(),
  experimentSummary: z.string().optional(),
  dataSummary: z.string().optional(),
  userPreferences: z.string().optional(),
  targetJournal: z.string().optional(),
  writingProgress: z.string().optional(),
  journalStyleConfig: z.custom<JournalStyleConfig>().optional(),
  useCloudPrompt: z.boolean().optional(),  // 是否使用云端 Prompt
});

export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type SkillGenerationInput = z.infer<typeof SkillGenerationInputSchema>;

// Skill 输出格式
export interface GeneratedSkill {
  sectionName: string;
  userWritingFocus: string;
  userKeyPoints: string[];
  specialRequirements?: string;
  overallStructure: {
    paragraphCount: number;
    mainSections: string[];
    transitionStrategy: string;
  };
  paragraphDetails: Array<{
    paragraphId: number;
    title: string;
    purpose: string;
    contentOutline: string[];
    wordCountEstimate: number;
  }>;
  executionInstructions: string[];
}

export class PrimaryAgent {
  private apiClient: APIClient;
  private model: string;
  private promptClient?: PromptClient;  // 云端 Prompt 客户端（可选）

  constructor(apiClient: APIClient, model: string = 'claude-sonnet-4-5', promptClient?: PromptClient) {
    this.apiClient = apiClient;
    this.model = model;
    this.promptClient = promptClient;
  }

  /**
   * 章节名映射到云端 Skill ID
   */
  private mapChapterToSkillId(chapterName: string): string {
    const normalized = normalizeChapterName(chapterName);
    const skillIdMap: Record<string, string> = {
      'introduction': '03_introduction_skill',
      'discussion': '07_discussion_skill',
      'methods': '04_methods_skill',
      'results': '05_results_skill',
      'abstract': '02_abstract_skill',
      'conclusion': '08_conclusion_skill',
      'title': '01_title_skill',
    };
    return skillIdMap[normalized] || '03_introduction_skill';
  }

  /**
   * 从云端获取 Skill 内容（如果 promptClient 可用）
   */
  async fetchCloudSkill(chapterName: string): Promise<string | null> {
    if (!this.promptClient) {
      return null;
    }

    const skillId = this.mapChapterToSkillId(chapterName);
    try {
      const { content } = await this.promptClient.getSkill(skillId);
      logger.info(`[PrimaryAgent] Fetched cloud skill: ${skillId}`);
      return content;
    } catch (error) {
      logger.warn(`[PrimaryAgent] Failed to fetch cloud skill: ${skillId}`, error);
      return null;
    }
  }

  /**
   * 根据用户规划生成写作 skill
   * 支持云端 Prompt 获取（如果配置了 promptClient）
   */
  async generateSkill(input: SkillGenerationInput): Promise<GeneratedSkill> {
    logger.info(`[PrimaryAgent] Generating skill for ${input.chapterName}`);

    // 尝试从云端获取 Skill（如果启用）
    let skillContent = input.userSkillContent;
    if (input.useCloudPrompt && this.promptClient) {
      const cloudSkill = await this.fetchCloudSkill(input.chapterName);
      if (cloudSkill) {
        skillContent = cloudSkill;
        logger.info(`[PrimaryAgent] Using cloud skill for ${input.chapterName}`);
      }
    }

    const prompt = this.buildSkillGenerationPrompt({
      ...input,
      userSkillContent: skillContent,
    });

    const response = await this.apiClient.chat({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 4000,
    });

    const skill = this.parseSkillResponse(response);
    logger.info(`[PrimaryAgent] Skill generated for ${input.chapterName}`);

    return skill;
  }

  /**
   * 质量检查
   */
  async qualityCheck(
    content: string,
    chapterPlanOrStyleGuide: ChapterPlan | string,
    maybeChapterPlan?: ChapterPlan
  ): Promise<string> {
    logger.info(`[PrimaryAgent] Running quality check`);
    const chapterPlan = maybeChapterPlan || (chapterPlanOrStyleGuide as ChapterPlan);
    const keyPoints = Array.isArray(chapterPlan.keyPoints) ? chapterPlan.keyPoints : [];
    let multiReviewReport = '';

    try {
      const review = await runAcademicResearchSkill({
        mode: 'multi-review',
        chapterName: chapterPlan.chapterName,
        topic: chapterPlan.writingFocus,
        chapterPlan,
        content,
        userInstruction: chapterPlan.specialRequirements,
      });
      multiReviewReport = review.content;
      logger.info(`[PrimaryAgent] ARS multi-review completed with ${review.provider}`);
    } catch (error) {
      logger.warn('[PrimaryAgent] ARS multi-review failed, continuing legacy quality check', error);
    }

    const prompt = `你是一级 AI 质量检查专家。请根据以下标准检查论文内容：

## 章节规划
- 写作重点: ${chapterPlan.writingFocus}
- 关键要点: ${keyPoints.join(', ')}
- 特殊要求: ${chapterPlan.specialRequirements || '无'}

${multiReviewReport ? `## ARS 多审稿人质量检查报告
以下报告来自 Academic Research Skills 接入层，已默认执行：

${multiReviewReport}

请优先修复其中 Critical/Major 问题，但不要把审稿报告本身写进正文。
` : ''}

## 待检查内容
${content}

请检查以下方面：
1. 是否覆盖了所有关键要点？
2. 逻辑是否连贯、表达是否清晰？
3. 是否存在方法学、领域贡献、逻辑链、过度外推或期刊契合度问题？
4. 是否有需要调整的表达？

如果需要调整，请直接修改内容并返回。如果不需要调整，请返回原文。`;

    const response = await this.apiClient.chat({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      maxTokens: 8000,
    });

    return response;
  }

  /**
   * 构建 skill 生成提示词
   */
  private buildSkillGenerationPrompt(input: SkillGenerationInput): string {
    let prompt = `你是一级AI写作指导专家（大牛马）。你的任务是将用户规划的章节写作重点、关键要点整合成一个完整的写作指导，直接发送给二级AI。

## ⚠️ 重要：严格执行原则
1. **必须严格按照用户上传的 Skill（写作技能）执行**
2. **必须遵循用户上传的期刊风格指南**
3. **用户提供的指导是最高优先级**

## 章节类型
${input.chapterName}

## 用户章节规划（核心指导）
- **写作重点**: ${input.userPlan.writingFocus}
- **关键要点**: 
${input.userPlan.keyPoints.map(p => `- ${p}`).join('\n')}
- **特殊要求**: ${input.userPlan.specialRequirements || '无'}
- **字数目标**: ${input.userPlan.wordCountTarget || '根据内容自然决定'}
`;

    if (input.userSkillContent && input.userSkillContent.trim()) {
      prompt += `
## 📋 用户上传的写作技能（Skill）
**必须严格按照此 Skill 执行！**

${input.userSkillContent}
`;
    }

    if (input.targetJournal && input.targetJournal.trim()) {
      prompt += `
## 🎯 目标期刊
${input.targetJournal}
`;
    }

    // 添加期刊风格配置（包括引用风格）
    if (input.journalStyleConfig) {
      prompt += `
## 📰 期刊风格配置（从期刊范文分析得出）
`;
      if (input.journalStyleConfig.journal) {
        prompt += `- **期刊名称**: ${input.journalStyleConfig.journal}\n`;
      }
      if (input.journalStyleConfig.citation_format) {
        prompt += `- **引用风格**: ${input.journalStyleConfig.citation_format.reference_style || '未指定'}\n`;
        if (input.journalStyleConfig.citation_format.in_text_style) {
          prompt += `- **文内引用**: ${input.journalStyleConfig.citation_format.in_text_style}\n`;
        }
        if (input.journalStyleConfig.citation_format.reference_example) {
          prompt += `- **参考文献示例**: ${input.journalStyleConfig.citation_format.reference_example}\n`;
        }
      }
      if (input.journalStyleConfig.word_count) {
        prompt += `- **字数限制**: ${JSON.stringify(input.journalStyleConfig.word_count)}\n`;
      }
      if (input.journalStyleConfig.writing_style) {
        prompt += `- **写作风格**: ${JSON.stringify(input.journalStyleConfig.writing_style)}\n`;
      }
      if (input.journalStyleConfig.author_guidelines) {
        prompt += `- **Author Guidelines / 投稿规范**: ${JSON.stringify(input.journalStyleConfig.author_guidelines).slice(0, 2500)}\n`;
      }
      if (input.journalStyleConfig.cover_letter_requirements) {
        prompt += `- **Cover Letter 要求**: ${JSON.stringify(input.journalStyleConfig.cover_letter_requirements).slice(0, 2000)}\n`;
      }
    }

    if (input.userPreferences && input.userPreferences.trim()) {
      prompt += `
## 👤 用户偏好
${input.userPreferences}
`;
    }

    if (input.writingProgress && input.writingProgress.trim()) {
      prompt += `
## 📝 写作进度
${input.writingProgress}
`;
    }

    if (input.experimentSummary && input.experimentSummary.trim()) {
      prompt += `
## 🧪 实验资料总结（完整）
以下是用户完整的实验资料，请仔细参考：

${input.experimentSummary}
`;
    }

    if (input.dataSummary && input.dataSummary.trim()) {
      prompt += `
## 📊 数据详细总结（完整）
以下是用户完整的数据总结，请仔细参考：

${input.dataSummary}
`;
    }

    if (input.longTermMemory && input.longTermMemory.trim()) {
      prompt += `
## 🧠 跨会话长期记忆（完整）
以下是用户的历史偏好和背景信息，请参考：

${input.longTermMemory}
`;
    }

    prompt += `
## 用户研究内容（完整）
${input.researchContent}

## 你的任务
基于用户的章节规划和写作技能，生成一个JSON格式的写作指导（skill）。

## 输出格式
{
  "section_name": "${input.chapterName}",
  "user_writing_focus": "${input.userPlan.writingFocus}",
  "user_key_points": ${JSON.stringify(input.userPlan.keyPoints)},
  "special_requirements": "${input.userPlan.specialRequirements || '无'}",
  "word_count_target": ${input.userPlan.wordCountTarget || 'null'},
  "overall_structure": {
    "paragraph_count": "段落数量",
    "main_sections": ["主要部分1", "主要部分2"],
    "transition_strategy": "段落过渡策略"
  },
  "paragraph_details": [
    {
      "paragraph_id": 1,
      "title": "段落标题",
      "purpose": "段落目的",
      "content_outline": ["要点1", "要点2"],
      "word_count_estimate": "字数"
    }
  ],
  "execution_instructions": [
    "严格按照用户上传的 Skill 执行",
    "严格按照用户的写作重点进行写作",
    "确保覆盖用户的所有关键要点"
  ]
}

## 重要提醒
- **用户上传的 Skill 是最高指导原则，必须严格执行**
- **必须将用户的写作重点作为核心指导**
- **确保 JSON 格式有效**
- 二级AI将直接阅读此skill来生成内容

输出纯JSON，不要其他内容。`;

    return prompt;
  }

  /**
   * 解析 AI 响应
   */
  private parseSkillResponse(response: string): GeneratedSkill {
    try {
      // 提取 JSON
      const jsonStart = response.indexOf('{');
      const jsonEnd = response.lastIndexOf('}') + 1;
      const jsonContent = response.slice(jsonStart, jsonEnd);
      
      return JSON.parse(jsonContent) as GeneratedSkill;
    } catch (error) {
      logger.error('[PrimaryAgent] Failed to parse skill response', error);
      // 返回默认 skill
      return this.getDefaultSkill();
    }
  }

  /**
   * 生成检索提示词（给小牛马使用）
   * 根据写作规划和章节内容，生成精确的检索关键词
   */
  async generateSearchQueries(input: {
    chapterName: string;
    writingFocus: string;
    keyPoints: string[];
    researchContext: string;
    longTermMemory?: string;
    targetCount?: number;
  }): Promise<SearchQueryPrompt[]> {
    logger.info(`[PrimaryAgent] Generating search queries for ${input.chapterName}`);

    const prompt = this.buildSearchQueryPrompt(input, input.targetCount ?? 4);

    const response = await this.apiClient.chat({
      model: this.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      maxTokens: 3000,
    });

    const queries = this.parseSearchQueryResponse(response, input.targetCount ?? 4);
    logger.info(`[PrimaryAgent] Generated ${queries.length} search queries`);

    return queries;
  }

  private buildSearchQueryPrompt(input: {
    chapterName: string;
    writingFocus: string;
    keyPoints: string[];
    researchContext: string;
    longTermMemory?: string;
  }, targetCount: number = 4): string {
    let prompt = `你是一级 AI 写作专家（大牛马）。你的任务是根据章节规划生成检索提示词，供二级 AI（小牛马）从用户上传的文献库中检索文献。

## ⚠️ 重要：严格执行原则
1. **必须严格按照用户上传的 Skill（写作技能）执行**
2. **用户提供的指导是最高优先级**

## 章节类型
${input.chapterName}

## 写作重点
${input.writingFocus}

## 关键要点
${input.keyPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}
`;

    if (input.longTermMemory && input.longTermMemory.trim()) {
      prompt += `
## 🧠 跨会话长期记忆（完整）
${input.longTermMemory}
`;
    }

    prompt += `
## 研究背景（完整）
${input.researchContext}

## 你的任务
为每个关键要点生成一个检索提示词，用于从文献库中检索最相关的文献。

## 输出格式（JSON）
{
  "queries": [
    {
      "topic": "主检索词（2-5个关键词组合）",
      "keywords": ["关键词1", "关键词2"],
      "argumentContext": "该论点的背景说明（为什么需要这个文献）",
      "targetCount": ${targetCount}
    }
  ]
}

## 要求
1. topic 应该是核心概念组合，便于语义检索
2. keywords 应该是可能出现在文献标题/摘要中的词
3. argumentContext 要说明该论点需要什么类型的证据
4. 每个关键要点生成一个检索词
5. 只输出 JSON，不要其他内容`;

    return prompt;
  }

  private parseSearchQueryResponse(
    response: string,
    defaultTargetCount: number
  ): SearchQueryPrompt[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getDefaultSearchQueries(defaultTargetCount);
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const queries: SearchQueryPrompt[] = [];

      for (let i = 0; i < (parsed.queries?.length || 0); i++) {
        const q = parsed.queries[i];
        queries.push({
          queryId: `query-${i + 1}-${Date.now()}`,
          topic: q.topic || '',
          keywords: q.keywords || [],
          argumentContext: q.argumentContext || '',
          targetCount: q.targetCount || defaultTargetCount,
        });
      }

      return queries.length > 0 ? queries : this.getDefaultSearchQueries(defaultTargetCount);
    } catch (error) {
      logger.error('[PrimaryAgent] Failed to parse search query response', error);
      return this.getDefaultSearchQueries(defaultTargetCount);
    }
  }

  private getDefaultSearchQueries(targetCount: number): SearchQueryPrompt[] {
    return [{
      queryId: `query-default-${Date.now()}`,
      topic: 'research methodology',
      keywords: ['method', 'approach', 'study'],
      argumentContext: 'Default search query for general research context',
      targetCount,
    }];
  }

  /**
   * 获取默认 skill
   */
  private getDefaultSkill(): GeneratedSkill {
    return {
      sectionName: 'unknown',
      userWritingFocus: '',
      userKeyPoints: [],
      overallStructure: {
        paragraphCount: 3,
        mainSections: ['introduction', 'body', 'conclusion'],
        transitionStrategy: 'flowing',
      },
      paragraphDetails: [
        {
          paragraphId: 1,
          title: 'Introduction',
          purpose: 'Introduce the topic',
          contentOutline: ['Background', 'Problem statement'],
          wordCountEstimate: 200,
        },
      ],
      executionInstructions: [
        'Follow user writing focus',
        'Cover all key points',
      ],
    };
  }
}

export default PrimaryAgent;
