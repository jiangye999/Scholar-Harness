import type { RetrievedDocument } from '../../types/literature';
import { HybridRetrievalEngine } from './hybrid-engine';

/**
 * SentenceLevelRetriever - 句子级文献检索器
 * 
 * 为每个句子单独检索文献，然后合并去重
 */
export class SentenceLevelRetriever {
  private retrievalEngine: HybridRetrievalEngine;
  
  constructor(retrievalEngine: HybridRetrievalEngine) {
    this.retrievalEngine = retrievalEngine;
  }
  
  /**
   * 为多个句子检索文献
   * @param sentenceQueries 句子查询数组（每个句子的关键词或意图）
   * @param topKPerSentence 每个句子返回的文献数量
   * @returns Map<sentenceQuery, RetrievedDocument[]>
   */
  async retrieveForSentences(
    sentenceQueries: string[],
    topKPerSentence: number = 5
  ): Promise<Map<string, RetrievedDocument[]>> {
    const results = new Map<string, RetrievedDocument[]>();
    const batchSize = 3; // 每批处理3个句子，避免并行过多
    
    console.log(`[SentenceLevelRetriever] Retrieving for ${sentenceQueries.length} sentences, ${topKPerSentence} docs each`);
    
    for (let i = 0; i < sentenceQueries.length; i += batchSize) {
      const batch = sentenceQueries.slice(i, i + batchSize);
      
      // 并行检索一批句子
      const batchPromises = batch.map(async (query) => {
        try {
          const result = await this.retrievalEngine.retrieve({
            query,
            topK: topKPerSentence,
            searchMode: 'hybrid'
          });
          return { query, docs: result.results };
        } catch (error) {
          console.error(`[SentenceLevelRetriever] Error retrieving for "${query}":`, error);
          return { query, docs: [] };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      for (const { query, docs } of batchResults) {
        results.set(query, docs);
      }
      
      console.log(`[SentenceLevelRetriever] Processed ${Math.min(i + batchSize, sentenceQueries.length)}/${sentenceQueries.length} sentences`);
    }
    
    return results;
  }
  
  /**
   * 合并并去重检索结果
   * @param results Map<sentenceQuery, RetrievedDocument[]>
   * @returns 去重后的文献和句子-文献映射
   */
  mergeAndDeduplicate(
    results: Map<string, RetrievedDocument[]>
  ): { uniqueDocs: RetrievedDocument[]; sentenceDocMap: Map<string, string[]> } {
    const seen = new Map<string, RetrievedDocument>();
    const sentenceDocMap = new Map<string, string[]>();
    
    for (const [sentenceQuery, docs] of results) {
      const docIds: string[] = [];
      
      for (const doc of docs) {
        docIds.push(doc.id);
        
        if (!seen.has(doc.id)) {
          seen.set(doc.id, doc);
        }
      }
      
      sentenceDocMap.set(sentenceQuery, docIds);
    }
    
    const uniqueDocs = Array.from(seen.values());
    
    console.log(`[SentenceLevelRetriever] Merged ${results.size} sentences into ${uniqueDocs.length} unique documents`);
    
    return { uniqueDocs, sentenceDocMap };
  }
  
  /**
   * 根据多句子相关性重新排序文献
   * @param uniqueDocs 去重后的文献
   * @param sentenceDocMap 句子-文献映射
   * @returns 重新排序的文献
   */
  rankByRelevance(
    uniqueDocs: RetrievedDocument[],
    sentenceDocMap: Map<string, string[]>
  ): RetrievedDocument[] {
    // 计算每个文档被多少句子引用
    const docCitationCount = new Map<string, number>();
    
    for (const docIds of sentenceDocMap.values()) {
      for (const docId of docIds) {
        docCitationCount.set(docId, (docCitationCount.get(docId) || 0) + 1);
      }
    }
    
    // 按引用次数（多句子相关性）排序
    return uniqueDocs.sort((a, b) => {
      const countA = docCitationCount.get(a.id) || 0;
      const countB = docCitationCount.get(b.id) || 0;
      return countB - countA;
    });
  }
}

export default SentenceLevelRetriever;
