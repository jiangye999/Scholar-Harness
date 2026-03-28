import type { RetrievedDocument } from '../../types/literature';

/**
 * 句子级写作规划
 */
export interface SentencePlan {
  sentenceId: string;
  intent: string;
  keywords: string[];
  expectedCitations: number;
  retrievedDocs?: RetrievedDocument[];
}

/**
 * SentencePlanner - 句子级写作规划器
 * 
 * 将段落分解为多个句子，每个句子有明确的写作意图和检索关键词
 */
export class SentencePlanner {
  /**
   * 创建句子级写作规划
   * @param paragraphTopic 段落主题
   * @param paragraphIntent 段落写作意图
   * @returns 句子规划数组
   */
  createSentencePlan(paragraphTopic: string, paragraphIntent: string): SentencePlan[] {
    // 根据主题和意图生成句子规划
    // 这里使用简单的模板生成，实际可由 AI 生成更精细的规划
    
    const plans: SentencePlan[] = [];
    
    // 第一句：研究背景/重要性
    plans.push({
      sentenceId: `${paragraphTopic}-s1`,
      intent: `介绍研究背景：${paragraphTopic}的重要性`,
      keywords: this.extractKeywords(paragraphTopic, ['background', 'importance', 'significance']),
      expectedCitations: 2
    });
    
    // 第二句：现有研究状况
    plans.push({
      sentenceId: `${paragraphTopic}-s2`,
      intent: `综述现有研究：${paragraphTopic}的研究进展`,
      keywords: this.extractKeywords(paragraphTopic, ['review', 'research', 'study']),
      expectedCitations: 2
    });
    
    // 第三句：研究空白/问题
    plans.push({
      sentenceId: `${paragraphTopic}-s3`,
      intent: `指出研究空白：当前研究的不足之处`,
      keywords: this.extractKeywords(paragraphTopic, ['gap', 'limitation', 'challenge']),
      expectedCitations: 1
    });
    
    // 第四句：本研究目标
    plans.push({
      sentenceId: `${paragraphTopic}-s4`,
      intent: `阐述本研究目标：${paragraphIntent}`,
      keywords: this.extractKeywords(paragraphIntent, ['objective', 'aim', 'purpose']),
      expectedCitations: 1
    });
    
    return plans;
  }
  
  /**
   * 将检索到的文献合并到句子规划中
   * @param sentencePlans 句子规划数组
   * @param allDocs 所有检索到的文献
   * @returns 更新后的句子规划
   */
  mergeRetrievedDocs(
    sentencePlans: SentencePlan[],
    allDocs: RetrievedDocument[]
  ): SentencePlan[] {
    return sentencePlans.map(plan => {
      // 根据关键词匹配度为每个句子分配文献
      const relevantDocs = allDocs.filter(doc => {
        const docText = `${doc.title} ${doc.abstract} ${doc.keywords.join(' ')}`.toLowerCase();
        const matchScore = plan.keywords.reduce((score, keyword) => {
          return score + (docText.includes(keyword.toLowerCase()) ? 1 : 0);
        }, 0);
        return matchScore > 0;
      });
      
      // 按匹配度排序
      relevantDocs.sort((a, b) => {
        const scoreA = this.calculateMatchScore(a, plan.keywords);
        const scoreB = this.calculateMatchScore(b, plan.keywords);
        return scoreB - scoreA;
      });
      
      return {
        ...plan,
        retrievedDocs: relevantDocs.slice(0, plan.expectedCitations + 2)
      };
    });
  }
  
  /**
   * 去重并收集所有文献
   * @param sentencePlans 句子规划数组
   * @returns 去重后的文献列表
   */
  deduplicateDocuments(sentencePlans: SentencePlan[]): RetrievedDocument[] {
    const seen = new Set<string>();
    const uniqueDocs: RetrievedDocument[] = [];
    
    for (const plan of sentencePlans) {
      if (plan.retrievedDocs) {
        for (const doc of plan.retrievedDocs) {
          if (!seen.has(doc.id)) {
            seen.add(doc.id);
            uniqueDocs.push(doc);
          }
        }
      }
    }
    
    return uniqueDocs;
  }
  
  /**
   * 提取关键词
   * @param text 文本
   * @param additionalKeywords 额外关键词
   * @returns 关键词数组
   */
  private extractKeywords(text: string, additionalKeywords: string[] = []): string[] {
    // 简单的关键词提取：使用文本中的名词和额外关键词
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3);
    
    const uniqueWords = [...new Set(words)];
    return [...uniqueWords.slice(0, 5), ...additionalKeywords];
  }
  
  /**
   * 计算文档与关键词的匹配分数
   */
  private calculateMatchScore(doc: RetrievedDocument, keywords: string[]): number {
    const docText = `${doc.title} ${doc.abstract} ${doc.keywords.join(' ')}`.toLowerCase();
    return keywords.reduce((score, keyword) => {
      return score + (docText.includes(keyword.toLowerCase()) ? 1 : 0);
    }, 0);
  }
}

export default SentencePlanner;
