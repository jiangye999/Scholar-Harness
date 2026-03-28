import { logger } from '../src/utils/logger';

export interface ParagraphChunk {
  id: number;
  content: string;
  searchQuery: string;
  wordCount: number;
  expectedCitations: number;
}

export interface ChapterStructure {
  introduction?: string;
  bodyParagraphs: string[];
  conclusion?: string;
}

/**
 * 章节拆分器
 * 将章节拆分成独立的句子/段落，为并行检索做准备
 */
export class SentenceChunker {
  /**
   * 将章节规划拆分成可独立处理的段落块
   */
  chunkChapter(
    chapterPlan: {
      writingFocus: string;
      keyPoints: string[];
      paragraphCount?: number;
    },
    sectionType: 'introduction' | 'discussion' | 'methods' | 'results' | 'conclusion' = 'introduction'
  ): ParagraphChunk[] {
    logger.info(`[SentenceChunker] Chunking ${sectionType} with ${chapterPlan.keyPoints.length} key points`);

    const chunks: ParagraphChunk[] = [];
    let chunkId = 1;

    // 根据章节类型确定默认段落数和结构
    const defaultStructure = this.getDefaultStructure(sectionType);
    const targetParagraphs = chapterPlan.paragraphCount || defaultStructure.paragraphCount;

    // 1. 引言段落（如果是 Introduction）
    if (sectionType === 'introduction' && defaultStructure.hasIntro) {
      chunks.push({
        id: chunkId++,
        content: `研究背景介绍：${chapterPlan.writingFocus}`,
        searchQuery: this.generateSearchQuery(chapterPlan.writingFocus, 'background'),
        wordCount: 150,
        expectedCitations: 2,
      });
    }

    // 2. 为每个关键要点创建段落
    const pointsPerParagraph = Math.ceil(chapterPlan.keyPoints.length / (targetParagraphs - (defaultStructure.hasIntro ? 1 : 0) - (defaultStructure.hasConclusion ? 1 : 0)));
    
    for (let i = 0; i < chapterPlan.keyPoints.length; i += pointsPerParagraph) {
      const paragraphPoints = chapterPlan.keyPoints.slice(i, i + pointsPerParagraph);
      const paragraphContent = paragraphPoints.join('；');
      
      chunks.push({
        id: chunkId++,
        content: paragraphContent,
        searchQuery: this.generateSearchQuery(paragraphContent, 'content'),
        wordCount: this.estimateWordCount(paragraphPoints.length),
        expectedCitations: Math.min(paragraphPoints.length, 3),
      });
    }

    // 3. 结论段落（如果有）
    if (defaultStructure.hasConclusion) {
      chunks.push({
        id: chunkId++,
        content: `研究总结：${chapterPlan.writingFocus}`,
        searchQuery: this.generateSearchQuery(chapterPlan.writingFocus, 'conclusion'),
        wordCount: 100,
        expectedCitations: 1,
      });
    }

    logger.info(`[SentenceChunker] Generated ${chunks.length} chunks`);
    return chunks;
  }

  /**
   * 基于用户自由输入的草稿/大纲进行拆分
   */
  chunkUserOutline(outline: string): ParagraphChunk[] {
    logger.info(`[SentenceChunker] Chunking user outline`);

    const sentences = outline
      .replace(/([。！？.!?])/g, '$1\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 10);

    const chunks: ParagraphChunk[] = [];

    sentences.forEach((sentence, index) => {
      chunks.push({
        id: index + 1,
        content: sentence,
        searchQuery: this.generateSearchQuery(sentence, 'general'),
        wordCount: this.estimateWordCountFromSentence(sentence),
        expectedCitations: this.estimateCitationsNeeded(sentence),
      });
    });

    logger.info(`[SentenceChunker] Generated ${chunks.length} chunks from outline`);
    return chunks;
  }

  /**
   * 为单个句子生成最优检索关键词
   */
  private generateSearchQuery(content: string, type: 'background' | 'content' | 'conclusion' | 'general'): string {
    // 提取关键词：去除停用词，保留名词和关键动词
    const stopWords = new Set(['的', '了', '在', '是', '和', '与', '或', '对', '有', '可以', '需要', '进行', '使用', '通过', '根据', '以及', '及其', '随着', '作为', '为了', '由于', '因此', '但是', '然而', '而且', '所以', '如果', '虽然', 'the', 'and', 'of', 'in', 'to', 'a', 'is', 'for', 'with', 'as', 'on', 'by', 'from', 'at', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should']);
    
    // 分词并过滤
    const words = content
      .split(/[\s,，.。;；!！?？、]/)
      .map(w => w.trim())
      .filter(w => w.length > 1 && !stopWords.has(w.toLowerCase()));

    // 提取最重要的 3-5 个词作为检索词
    const keywords = words.slice(0, 5);
    
    if (keywords.length === 0) {
      return content.substring(0, 50);
    }

    // 根据类型优化检索词
    switch (type) {
      case 'background':
        return keywords.slice(0, 3).join(' ');
      case 'conclusion':
        return keywords.slice(-3).join(' ');
      default:
        return keywords.join(' ');
    }
  }

  /**
   * 获取默认章节结构
   */
  private getDefaultStructure(sectionType: string): { paragraphCount: number; hasIntro: boolean; hasConclusion: boolean } {
    const structures: Record<string, { paragraphCount: number; hasIntro: boolean; hasConclusion: boolean }> = {
      introduction: { paragraphCount: 4, hasIntro: false, hasConclusion: true },
      discussion: { paragraphCount: 5, hasIntro: true, hasConclusion: true },
      methods: { paragraphCount: 3, hasIntro: false, hasConclusion: false },
      results: { paragraphCount: 4, hasIntro: false, hasConclusion: false },
      conclusion: { paragraphCount: 2, hasIntro: false, hasConclusion: false },
    };

    return structures[sectionType] || { paragraphCount: 3, hasIntro: false, hasConclusion: false };
  }

  /**
   * 估计段落字数
   */
  private estimateWordCount(pointCount: number): number {
    // 每个要点约 50-80 字
    return pointCount * 60;
  }

  /**
   * 基于句子长度估计字数
   */
  private estimateWordCountFromSentence(sentence: string): number {
    // 中文字符 + 英文单词估算
    const chineseChars = (sentence.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishWords = (sentence.match(/[a-zA-Z]+/g) || []).length;
    return chineseChars + englishWords;
  }

  /**
   * 估计需要的引用数量
   */
  private estimateCitationsNeeded(sentence: string): number {
    // 如果句子包含研究性词汇，可能需要更多引用
    const researchTerms = ['研究', '表明', '发现', '显示', '证实', '证明', 'research', 'study', 'show', 'demonstrate', 'indicate'];
    const hasResearchTerms = researchTerms.some(term => sentence.toLowerCase().includes(term.toLowerCase()));
    
    if (hasResearchTerms) {
      return 2;
    }
    
    // 默认每个句子 1-2 个引用
    return Math.min(Math.ceil(sentence.length / 100), 2);
  }
}

export default SentenceChunker;
