// ScholarClaw - Primary Agent (一级 AI)
// 负责：理解需求、生成 skill、质量检查

import { z } from 'zod';
import { logger } from '../src/utils/logger';
import type { APIClient } from '../src/types';

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
  styleGuide: z.string().optional(),
  researchContent: z.string(),
});

export type ChapterPlan = z.infer<typeof ChapterPlanSchema>;
export type SkillGenerationInput = z.infer<typeof SkillGenerationInputSchema>;

// Skill 输出格式
export interface GeneratedSkill {
  sectionName: string;
  userWritingFocus: string;
  userKeyPoints: string[];
  specialRequirements?: string;
  styleGuideContent: string;
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

  constructor(apiClient: APIClient, model: string = 'claude-sonnet-4-5') {
    this.apiClient = apiClient;
    this.model = model;
  }

  /**
   * 根据用户规划生成写作 skill
   */
  async generateSkill(input: SkillGenerationInput): Promise<GeneratedSkill> {
    logger.info(`[PrimaryAgent] Generating skill for ${input.chapterName}`);

    const prompt = this.buildSkillGenerationPrompt(input);

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
    styleGuide: string,
    chapterPlan: ChapterPlan
  ): Promise<string> {
    logger.info(`[PrimaryAgent] Running quality check`);

    const prompt = `你是一级 AI 质量检查专家。请根据以下标准检查论文内容：

## 章节规划
- 写作重点: ${chapterPlan.writingFocus}
- 关键要点: ${chapterPlan.keyPoints.join(', ')}
- 特殊要求: ${chapterPlan.specialRequirements || '无'}

## 期刊风格指南
${styleGuide}

## 待检查内容
${content}

请检查以下方面：
1. 是否覆盖了所有关键要点？
2. 语言风格是否符合期刊要求？
3. 是否有需要调整的表达？

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
    return `你是一级AI写作指导专家。你的任务是将用户规划的章节写作重点、关键要点与期刊风格指南整合成一个完整的写作指导，直接发送给二级AI。

## 章节类型
${input.chapterName}

## 用户章节规划（核心指导）
- **写作重点**: ${input.userPlan.writingFocus}
- **关键要点**: 
${input.userPlan.keyPoints.map(p => `- ${p}`).join('\n')}
- **特殊要求**: ${input.userPlan.specialRequirements || '无'}
- **字数目标**: ${input.userPlan.wordCountTarget || '根据内容自然决定'}

## 期刊风格指南
${input.styleGuide || '无特定期刊风格要求'}

## 用户研究内容
${input.researchContent.slice(0, 3000)}...（内容已截断）

## 你的任务
基于用户的章节规划和期刊风格指南，生成一个JSON格式的写作指导（skill）。

## 输出格式
{
  "section_name": "${input.chapterName}",
  "user_writing_focus": "${input.userPlan.writingFocus}",
  "user_key_points": ${JSON.stringify(input.userPlan.keyPoints)},
  "special_requirements": "${input.userPlan.specialRequirements || '无'}",
  "word_count_target": ${input.userPlan.wordCountTarget || 'null'},
  "style_guide_content": "完整的期刊风格指南内容",
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
    "严格按照用户的写作重点进行写作",
    "确保覆盖用户的所有关键要点",
    "遵循期刊风格指南中的语言规范"
  ]
}

## 重要提醒
- **必须将用户的写作重点作为核心指导**
- **确保 JSON 格式有效**
- 二级AI将直接阅读此skill来生成内容

输出纯JSON，不要其他内容。`;
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
   * 获取默认 skill
   */
  private getDefaultSkill(): GeneratedSkill {
    return {
      sectionName: 'unknown',
      userWritingFocus: '',
      userKeyPoints: [],
      styleGuideContent: '',
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
