import { logger } from '../src/utils/logger';
import type { APIClient, ChapterPlan, GeneratedSkill, LiteratureReference } from '../src/types';
import { SentenceChunker, ParagraphChunk } from './sentence-chunker';
import { ParallelSearchOrchestrator, ParallelSearchResult } from './parallel-search-orchestrator';
import { LitPaper } from './paragraph-agent';
import type { JournalStyleConfig } from './primary-agent';

// 云端 Prompt 客户端（可选）
import type { PromptClient } from '../src/utils/cloud-prompt-client';

/**
 * AI生成内容标识水印 - 合规要求
 * 根据《互联网信息服务深度合成管理规定》和《生成式人工智能服务管理暂行办法》
 */
const AI_CONTENT_WATERMARK = '\n\n---\n[本内容由 Scholar Harness AI 辅助生成，仅供参考]';

/**
 * AI生成元数据标识
 */
interface AIGenerationMetadata {
  ai_generated: boolean;
  generated_at: string;
  model_used: string;
  tool_name: string;
  version: string;
  disclaimer: string;
}

/**
 * 当前版本号
 */
const TOOL_VERSION = '1.0.0';

/**
 * 章节名标准化映射（中文 -> 英文标准名）
 */
const CHAPTER_NAME_MAP: Record<string, string> = {
  '引言': 'introduction',
  'Introduction': 'introduction',
  'introduction': 'introduction',
  '方法': 'methods',
  'Methods': 'methods',
  'methods': 'methods',
  'Methodology': 'methods',
  'methodology': 'methods',
  '结果': 'results',
  'Results': 'results',
  'results': 'results',
  '讨论': 'discussion',
  'Discussion': 'discussion',
  'discussion': 'discussion',
  '结论': 'conclusion',
  'Conclusion': 'conclusion',
  'conclusion': 'conclusion',
  '摘要': 'abstract',
  'Abstract': 'abstract',
  'abstract': 'abstract',
};

/**
 * 标准化章节名（支持中文/英文输入）
 */
export function normalizeChapterName(chapterName: string): string {
  // 直接匹配
  if (CHAPTER_NAME_MAP[chapterName]) {
    return CHAPTER_NAME_MAP[chapterName];
  }
  
  // 小写匹配
  const lowerName = chapterName.toLowerCase();
  if (CHAPTER_NAME_MAP[lowerName]) {
    return CHAPTER_NAME_MAP[lowerName];
  }
  
  // 包含关键词匹配
  for (const [key, value] of Object.entries(CHAPTER_NAME_MAP)) {
    if (chapterName.includes(key) || lowerName.includes(key.toLowerCase())) {
      return value;
    }
  }
  
  // 无法识别，返回小写原名
  return lowerName;
}

export interface SecondaryAgentConfig {
  models: Record<string, string>;
  maxConcurrency?: number;
  promptClient?: PromptClient;  // 云端 Prompt 客户端（可选）
}

export class SecondaryAgent {
  private apiClient: APIClient;
  private models: Record<string, string>;
  private maxConcurrency: number;
  private chunker: SentenceChunker;
  private promptClient?: PromptClient;

  constructor(apiClient: APIClient, config: SecondaryAgentConfig) {
    this.apiClient = apiClient;
    this.models = config.models;
    this.maxConcurrency = config.maxConcurrency || 5;
    this.chunker = new SentenceChunker();
    this.promptClient = config.promptClient;
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
      logger.info(`[SecondaryAgent] Fetched cloud skill: ${skillId}`);
      return content;
    } catch (error) {
      logger.warn(`[SecondaryAgent] Failed to fetch cloud skill: ${skillId}`, error);
      return null;
    }
  }

  async writeSectionWithParallelSearch(input: {
    skill: GeneratedSkill;
    chapterPlan: ChapterPlan;
    researchContent: string;
    chapterName: string;
    literaturePapers: LitPaper[];
    apiUrl: string;
    apiKey: string;
    embeddingModel: string;
    longTermMemory?: string;
    userSkillContent?: string;
    journalStyleConfig?: JournalStyleConfig;
    useCloudPrompt?: boolean;  // 是否使用云端 Prompt
  }): Promise<{ content: string; metadata: AIGenerationMetadata }> {
    // 标准化章节名（支持中文输入）
    const normalizedChapter = normalizeChapterName(input.chapterName);
    const model = this.models[normalizedChapter] || this.models.default || 'gpt-4o';
    logger.info(`[SecondaryAgent] Writing ${input.chapterName} (normalized: ${normalizedChapter}) with model ${model}`);

    // 尝试从云端获取 Skill（如果启用）
    let skillContent = input.userSkillContent;
    if (input.useCloudPrompt && this.promptClient) {
      const cloudSkill = await this.fetchCloudSkill(input.chapterName);
      if (cloudSkill) {
        skillContent = cloudSkill;
        logger.info(`[SecondaryAgent] Using cloud skill for ${input.chapterName}`);
      }
    }

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
      return {
        content: `未找到相关文献。建议：\n1. 更换关键词\n2. 确认文献库中有相关文献\n3. 直接提供具体文献信息`,
        metadata: this.generateMetadata(model, false),
      };
    }

    const literatureContext = orchestrator.buildContextForWriting(searchResult);

    const prompt = this.buildWritingPromptWithLiterature({
      ...input,
      userSkillContent: skillContent,  // 使用云端或本地 Skill
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

    // 添加AI生成标识水印 - 合规要求
    const contentWithWatermark = validatedContent + AI_CONTENT_WATERMARK;

    const latexContent = this.formatLatex(contentWithWatermark);

    // 生成AI内容元数据
    const metadata = this.generateMetadata(model, true);

    logger.info(`[SecondaryAgent] Completed ${input.chapterName}: ${latexContent.length} chars, used ${searchResult.uniquePapers.size} unique papers | AI标识已添加`);
    return { content: latexContent, metadata };
  }

  /**
   * 生成AI内容元数据标识
   */
  private generateMetadata(model: string, success: boolean): AIGenerationMetadata {
    return {
      ai_generated: true,
      generated_at: new Date().toISOString(),
      model_used: model,
      tool_name: 'Scholar Harness',
      version: TOOL_VERSION,
      disclaimer: '本内容由AI辅助生成，仅供参考。用户需自行验证内容的准确性和学术合规性。',
    };
  }

  private buildWritingPromptWithLiterature(input: {
    skill: GeneratedSkill;
    chapterPlan: ChapterPlan;
    researchContent: string;
    chapterName: string;
    literatureContext: string;
    sentenceCount: number;
    longTermMemory?: string;
    userSkillContent?: string;
    journalStyleConfig?: JournalStyleConfig;
  }): string {
    // 根据期刊风格确定引用格式
    const citationFormat = this.getCitationFormatInstruction(input.journalStyleConfig);
    
    let prompt = `你是一位专业的学术论文写作者（二级AI/小牛马）。

## ⚠️ 重要：严格执行原则
1. **必须严格按照用户上传的 Skill（写作技能）执行**
2. **必须遵循用户上传的期刊风格指南**
3. **一级AI生成的写作指导是最高优先级**
`;

    if (input.userSkillContent && input.userSkillContent.trim()) {
      prompt += `
## 📋 用户上传的写作技能（Skill）
**必须严格按照此 Skill 执行！**

${input.userSkillContent}
`;
    }

    prompt += `
## 写作技能指导（来自大牛马）
${JSON.stringify(input.skill, null, 2)}

## 用户章节规划（核心指导）
- 写作重点: ${input.chapterPlan.writingFocus}
- 关键要点: ${input.chapterPlan.keyPoints.join(', ')}
- 特殊要求: ${input.chapterPlan.specialRequirements || '无'}
`;

    // 添加期刊风格配置
    if (input.journalStyleConfig) {
      const submissionRequirements = {
        author_guidelines: input.journalStyleConfig.author_guidelines || null,
        cover_letter_requirements: input.journalStyleConfig.cover_letter_requirements || null,
      };
      prompt += `
## 📰 期刊风格配置
- **期刊名称**: ${input.journalStyleConfig.journal || '未指定'}
${citationFormat}
${input.journalStyleConfig.author_guidelines || input.journalStyleConfig.cover_letter_requirements ? `- **投稿规范 / Cover Letter 要求**: ${JSON.stringify(submissionRequirements).slice(0, 3000)}` : ''}
`;
    }

    if (input.longTermMemory && input.longTermMemory.trim()) {
      prompt += `
## 🧠 跨会话长期记忆（完整）
${input.longTermMemory}
`;
    }

    prompt += `
${input.literatureContext}

## 写作要求

1. **核心指导**: 以用户的"写作重点"为最高原则
2. **覆盖要点**: 确保包含所有"关键要点"
3. **严格引用**: 只能引用上述【可用文献列表】中的文献
4. **引用格式**: ${citationFormat.includes('数字') ? '使用数字引用格式 [1], [2]' : '使用 (作者, 年份) 格式'}
5. **禁止编造**: 不得虚构未提供的文献
6. **写作思路后询问**: 当给用户提供某段的写作思路后，必须询问用户是否需要生成逐句的检索词（用于从文献库检索支撑该句的文献）
7. **段落参考文献列表**: 当生成某章节的某个段落时，必须在段落下方列出参考文献的完整信息，格式为：
   - "[作者, 年份] 作者全名. (年份). 论文标题. 期刊名, 卷号, 页码."
   - 示例："[Song et al., 2022] Song, X. T. et al. (2022). Soil oxygen depletion and corresponding nitrous oxide production at hot moments in an agricultural soil. Environmental Pollution, 315, 120440."

## ⚠️ AI生成内容标识（合规要求）

根据《互联网信息服务深度合成管理规定》，AI生成内容需要明确标识。请在生成的内容末尾不要添加任何标识，系统会自动添加AI辅助生成声明。用户在提交论文时需自行声明AI辅助使用情况。

## 输出格式
直接输出章节内容，使用 LaTeX 格式。每个段落完成后，紧接着列出该段落引用的参考文献完整信息。

请开始生成 ${input.chapterName} 章节：`;

    return prompt;
  }

  /**
   * 根据期刊风格配置获取引用格式说明
   */
  private getCitationFormatInstruction(config?: JournalStyleConfig): string {
    if (!config?.citation_format) {
      return `- **引用风格**: 未指定（默认使用作者-年份制）`;
    }
    
    const { reference_style, in_text_style } = config.citation_format;
    
    let instruction = `- **引用风格**: ${reference_style || '未指定'}\n`;
    
    if (in_text_style) {
      if (in_text_style.includes('数字') || in_text_style.includes('Number')) {
        instruction += `- **文内引用**: 使用数字制，如 [1], [2], [3]\n`;
      } else if (in_text_style.includes('作者') || in_text_style.includes('Author')) {
        instruction += `- **文内引用**: 使用作者-年份制，如 (Smith, 2020) 或 Smith (2020)\n`;
      } else {
        instruction += `- **文内引用**: ${in_text_style}\n`;
      }
    }
    
    return instruction;
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
    // 使用标准化映射
    const normalized = normalizeChapterName(chapterName);
    
    // 验证是否为有效类型
    const validTypes = ['introduction', 'discussion', 'methods', 'results', 'conclusion', 'abstract'];
    if (validTypes.includes(normalized)) {
      return normalized as 'introduction' | 'discussion' | 'methods' | 'results' | 'conclusion';
    }
    
    // 无法识别，默认返回 introduction
    logger.warn(`[SecondaryAgent] Unknown chapter name: ${chapterName}, defaulting to introduction`);
    return 'introduction';
  }

  private formatLatex(content: string): string {
    // 添加AI生成内容注释标识 - LaTeX格式
    const aiComment = `
% ========================================
% AI生成内容标识（合规要求）
% 工具: Scholar Harness v${TOOL_VERSION}
% 生成时间: ${new Date().toISOString()}
% 声明: 本内容由AI辅助生成，仅供参考
% 用户需自行声明AI辅助使用情况
% ========================================
`;
    
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
