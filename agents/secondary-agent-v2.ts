import { logger } from '../src/utils/logger';
import type { APIClient, ChapterPlan, GeneratedSkill, LiteratureReference } from '../src/types';
import { SentenceChunker, ParagraphChunk } from './sentence-chunker';
import { ParallelSearchOrchestrator, ParallelSearchResult } from './parallel-search-orchestrator';
import { LitPaper } from './paragraph-agent';

export interface SecondaryAgentConfig {
  models: Record<string, string>;
  maxConcurrency?: number;
}

export class SecondaryAgent {
  private apiClient: APIClient;
  private models: Record<string, string>;
  private maxConcurrency: number;
  private chunker: SentenceChunker;

  constructor(apiClient: APIClient, config: SecondaryAgentConfig) {
    this.apiClient = apiClient;
    this.models = config.models;
    this.maxConcurrency = config.maxConcurrency || 5;
    this.chunker = new SentenceChunker();
  }

  async writeSectionWithParallelSearch(input: {
    skill: GeneratedSkill;
    chapterPlan: ChapterPlan;
    researchContent: string;
    styleGuide?: string;
    chapterName: string;
    literaturePapers: LitPaper[];
    apiUrl: string;
    apiKey: string;
    embeddingModel: string;
  }): Promise<string> {
    const model = this.models[input.chapterName] || this.models.default || 'gpt-4o';
    logger.info(`[SecondaryAgent] Writing ${input.chapterName} with parallel search using ${model}`);

    const sectionType = this.mapChapterNameToType(input.chapterName);

    const sentences = this.chunker.chunkChapter(
      {
        writingFocus: input.chapterPlan.writingFocus,
        keyPoints: input.chapterPlan.keyPoints,
        paragraphCount: input.skill.overallStructure?.paragraphCount,
      },
      sectionType
    );

    logger.info(`[SecondaryAgent] Chapter chunked into ${sentences.length} sentences`);

    const orchestrator = new ParallelSearchOrchestrator(
      input.literaturePapers,
      input.apiUrl,
      input.apiKey,
      input.embeddingModel,
      this.maxConcurrency
    );

    const searchResult = await orchestrator.executeParallelSearch(sentences);

    if (searchResult.uniquePapers.size === 0) {
      logger.warn(`[SecondaryAgent] No relevant papers found for any sentence`);
      return `未找到相关文献。建议：\n1. 更换关键词\n2. 确认文献库中有相关文献\n3. 直接提供具体文献信息`;
    }

    const literatureContext = orchestrator.buildContextForWriting(searchResult);

    const prompt = this.buildWritingPromptWithLiterature({
      ...input,
      literatureContext,
      sentenceCount: sentences.length,
    });

    const draftContent = await this.apiClient.chat({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      maxTokens: 8000,
    });

    const validatedContent = this.validateCitations(draftContent, searchResult);

    const latexContent = this.formatLatex(validatedContent);

    logger.info(`[SecondaryAgent] Completed ${input.chapterName}: ${latexContent.length} chars, used ${searchResult.uniquePapers.size} unique papers`);
    return latexContent;
  }

  private buildWritingPromptWithLiterature(input: {
    skill: GeneratedSkill;
    chapterPlan: ChapterPlan;
    researchContent: string;
    styleGuide?: string;
    chapterName: string;
    literatureContext: string;
    sentenceCount: number;
  }): string {
    return `你是一位专业的学术论文写作者。

## 写作技能指导
${JSON.stringify(input.skill, null, 2)}

## 用户章节规划
- 写作重点: ${input.chapterPlan.writingFocus}
- 关键要点: ${input.chapterPlan.keyPoints.join(', ')}
- 特殊要求: ${input.chapterPlan.specialRequirements || '无'}

## 期刊风格指南
${input.styleGuide || '无特定期刊风格要求'}

${input.literatureContext}

## 写作要求

1. **严格使用提供的文献**：只能引用【可用文献列表】中的文献
2. **逐句写作**：根据【句子-文献对应关系】为每个句子选择合适的引用
3. **引用格式**：使用 (作者, 年份) 格式，如 (Wang et al., 2024) 或 (Zhang, 2023)
4. **引用密度要求**：
   - 引言、讨论等需要参考文献的章节：**每句话都要有参考文献支撑**（至少1篇，关键观点2-3篇）
   - 方法、结果部分：关键数据和方法需引用，一般描述可适当减少
5. **引用数量**：每个观点 1-2 篇文献，重要观点 2-3 篇，优先使用相关度高的
6. **禁止编造**：如果某个观点没有合适的文献，请明确说明"缺乏文献支持"
7. **期刊风格**：严格按照【期刊风格指南】中的引用格式要求

## 输出格式
直接输出章节内容，使用 (作者, 年份) 引用格式，每段之间用空行分隔。

请开始生成：${input.chapterName}`;
  }

  private validateCitations(content: string, searchResult: ParallelSearchResult): string {
    const citationRegex = /\(([A-Z][a-z]+(?:\s+et\s+al\.)?),?\s*(\d{4})[a-z]?\)/g;
    const citations: Array<{ author: string; year: string; full: string }> = [];
    let match;

    while ((match = citationRegex.exec(content)) !== null) {
      citations.push({
        author: match[1],
        year: match[2],
        full: match[0],
      });
    }

    if (citations.length === 0) {
      return content;
    }

    const validPapers = Array.from(searchResult.uniquePapers.values());
    const invalidCitations: string[] = [];

    for (const citation of citations) {
      let found = false;
      const authorName = citation.author.toLowerCase().replace(' et al.', '');

      for (const paperResult of validPapers) {
        const paper = paperResult.paper;
        const paperAuthors = paper.author.toLowerCase();

        if (paperAuthors.includes(authorName) && paper.year === citation.year) {
          found = true;
          break;
        }
      }

      if (!found) {
        invalidCitations.push(citation.full);
      }
    }

    if (invalidCitations.length > 0) {
      logger.warn(`[SecondaryAgent] Removing ${invalidCitations.length} invalid citations: ${invalidCitations.join(', ')}`);
      
      let cleanedContent = content;
      for (const invalidCitation of invalidCitations) {
        const escapedCitation = invalidCitation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        cleanedContent = cleanedContent.replace(new RegExp(escapedCitation, 'g'), '');
      }
      
      cleanedContent = cleanedContent
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.])/g, '$1')
        .trim();
      
      logger.info(`[SecondaryAgent] Content cleaned: removed ${invalidCitations.length} invalid citations`);
      return cleanedContent;
    }

    return content;
  }

  private mapChapterNameToType(
    chapterName: string
  ): 'introduction' | 'discussion' | 'methods' | 'results' | 'conclusion' {
    const name = chapterName.toLowerCase();
    if (name.includes('intro')) return 'introduction';
    if (name.includes('discuss')) return 'discussion';
    if (name.includes('method')) return 'methods';
    if (name.includes('result')) return 'results';
    if (name.includes('conclusion')) return 'conclusion';
    return 'introduction';
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
}

export default SecondaryAgent;
