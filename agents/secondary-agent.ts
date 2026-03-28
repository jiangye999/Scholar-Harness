import { logger } from '../src/utils/logger';
import type { APIClient, ChapterPlan, GeneratedSkill, LiteratureReference } from '../src/types';

export interface SecondaryAgentConfig {
  models: Record<string, string>;
}

export class SecondaryAgent {
  private apiClient: APIClient;
  private models: Record<string, string>;

  constructor(apiClient: APIClient, config: SecondaryAgentConfig) {
    this.apiClient = apiClient;
    this.models = config.models;
  }

  async writeSection(input: {
    skill: GeneratedSkill;
    chapterPlan: ChapterPlan;
    researchContent: string;
    styleGuide?: string;
    chapterName: string;
  }): Promise<string> {
    const model = this.models[input.chapterName] || this.models.default || 'gpt-4o';
    logger.info(`[SecondaryAgent] Writing ${input.chapterName} using ${model}`);

    const prompt = this.buildWritingPrompt(input);

    const draftContent = await this.apiClient.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      maxTokens: 8000,
    });

    const contentWithCitations = await this.addCitations(draftContent, input);

    const latexContent = this.formatLatex(contentWithCitations);

    logger.info(`[SecondaryAgent] Completed ${input.chapterName}: ${latexContent.length} chars`);
    return latexContent;
  }

  private buildWritingPrompt(input: {
    skill: GeneratedSkill;
    chapterPlan: ChapterPlan;
    researchContent: string;
    styleGuide?: string;
  }): string {
    return `你是一位专业的学术论文写作者。

## 写作技能指导 (来自一级 AI)
${JSON.stringify(input.skill, null, 2)}

## 用户章节规划
- 写作重点: ${input.chapterPlan.writingFocus}
- 关键要点: ${input.chapterPlan.keyPoints.join(', ')}
- 特殊要求: ${input.chapterPlan.specialRequirements || '无'}
- 字数目标: ${input.chapterPlan.wordCountTarget || '根据内容自然决定'}

## 期刊风格指南
${input.styleGuide || '无特定期刊风格要求'}

## 研究内容
${input.researchContent.slice(0, 5000)}

## 任务要求

请严格按照以下要求生成章节内容：

1. **核心指导**: 以用户的"写作重点"为最高原则
2. **覆盖要点**: 确保包含所有"关键要点"
3. **遵循结构**: 按照 skill 中的"整体结构"和"段落详情"组织
4. **执行指令**: 严格遵守 skill 中的"执行指令"
5. **风格一致**: 遵循期刊风格指南的语言规范
6. **满足特殊要求**: 如有特殊要求，必须满足

## 输出格式
直接输出章节内容（LaTeX格式），不需要任何额外说明。

请开始生成：`;
  }

  private async addCitations(
    content: string,
    input: { chapterPlan: ChapterPlan; researchContent: string }
  ): Promise<string> {
    const citationNeeds = this.analyzeCitationNeeds(content);
    
    if (citationNeeds.length === 0) {
      return content;
    }

    logger.info(`[SecondaryAgent] Found ${citationNeeds.length} citation opportunities`);

    return content;
  }

  private analyzeCitationNeeds(content: string): string[] {
    const patterns = [
      /研究显示/gi,
      /表明/gi,
      /证实/gi,
      /发现/gi,
      /根据/gi,
      /已有研究表明/gi,
    ];

    const needs: string[] = [];
    for (const pattern of patterns) {
      const matches = content.match(pattern);
      if (matches) {
        needs.push(...matches);
      }
    }

    return needs;
  }

  private formatLatex(content: string): string {
    return content
      .replace(/^# /gm, '\\section{')
      .replace(/^## /gm, '\\subsection{')
      .replace(/^### /gm, '\\subsubsection{')
      .replace(/\*\*(.*?)\*\*/g, '\\textbf{$1}')
      .replace(/\*(.*?)\*/g, '\\textit{$1}')
      .trim();
  }

  async searchLiterature(query: string): Promise<LiteratureReference[]> {
    logger.info(`[SecondaryAgent] Searching literature: ${query}`);
    return [];
  }
}

export default SecondaryAgent;
