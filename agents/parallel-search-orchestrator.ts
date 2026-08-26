import { logger } from '../src/utils/logger';
import { ParagraphAgent, SearchResult, LitPaper } from './paragraph-agent';

export interface SentenceChunk {
  id: number;
  content: string;
  searchQuery: string;
  wordCount: number;
  expectedCitations: number;
}

export interface SentenceSearchResult {
  sentenceId: number;
  searchQuery: string;
  papers: SearchResult[];
  searchTime: number;
  /** P1-5: present when this sentence's search failed; papers will be empty. */
  error?: string;
}

export interface ParallelSearchResult {
  totalSentences: number;
  results: SentenceSearchResult[];
  totalTime: number;
  uniquePapers: Map<string, SearchResult>;
}

export class ParallelSearchOrchestrator {
  private literaturePapers: LitPaper[];
  private apiUrl: string;
  private apiKey: string;
  private embeddingModel: string;
  private maxConcurrency: number;

  constructor(
    literaturePapers: LitPaper[],
    apiUrl: string,
    apiKey: string,
    embeddingModel: string,
    maxConcurrency: number = 5
  ) {
    this.literaturePapers = literaturePapers;
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.embeddingModel = embeddingModel;
    this.maxConcurrency = maxConcurrency;
  }

  async executeParallelSearch(sentences: SentenceChunk[]): Promise<ParallelSearchResult> {
    const startTime = Date.now();
    logger.info(`[Orchestrator] Starting parallel search for ${sentences.length} sentences with max concurrency ${this.maxConcurrency}`);

    const results: SentenceSearchResult[] = [];
    const uniquePapers = new Map<string, SearchResult>();

    for (let i = 0; i < sentences.length; i += this.maxConcurrency) {
      const batch = sentences.slice(i, i + this.maxConcurrency);
      logger.info(`[Orchestrator] Processing batch ${Math.floor(i / this.maxConcurrency) + 1}: sentences ${i + 1}-${Math.min(i + this.maxConcurrency, sentences.length)}`);

      const batchPromises = batch.map(sentence => (
        // P1-5: per-item failure isolation — one failed sentence search must
        // not abort the whole batch (Promise.all would reject everything).
        this.searchSingleSentence(sentence).catch(error => ({
          sentenceId: sentence.id,
          searchQuery: sentence.searchQuery,
          papers: [],
          searchTime: 0,
          error: (error as Error)?.message || String(error || 'unknown search error'),
        } as SentenceSearchResult))
      ));
      const batchResults = await Promise.all(batchPromises);

      for (const result of batchResults) {
        results.push(result);
        
        for (const paper of result.papers) {
          const paperId = paper.paper.citationId
            ? String(paper.paper.citationId)
            : `${paper.paper.doi || ''}|${paper.paper.title || ''}|${paper.paper.year || ''}`.toLowerCase();
          if (!uniquePapers.has(paperId)) {
            uniquePapers.set(paperId, paper);
          }
        }
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(`[Orchestrator] Completed parallel search in ${totalTime}ms, found ${uniquePapers.size} unique papers`);

    return {
      totalSentences: sentences.length,
      results,
      totalTime,
      uniquePapers,
    };
  }

  private async searchSingleSentence(sentence: SentenceChunk): Promise<SentenceSearchResult> {
    const agent = new ParagraphAgent(
      this.literaturePapers,
      this.apiUrl,
      this.apiKey,
      this.embeddingModel,
      2
    );

    return await agent.searchLocal(sentence.id, sentence.searchQuery);
  }

  buildContextForWriting(result: ParallelSearchResult): string {
    let context = `## 文献检索结果汇总\n\n`;
    context += `共检索 ${result.totalSentences} 个句子，找到 ${result.uniquePapers.size} 篇相关文献\n\n`;

    context += `### 可用文献列表\n\n`;
    const papers = Array.from(result.uniquePapers.values()).sort((a, b) => b.score - a.score);
    
    papers.forEach((paperResult, index) => {
      const paper = paperResult.paper;
      context += `文献 ${index + 1}: ${paper.title}\n`;
      context += `  作者: ${paper.author}\n`;
      context += `  年份: ${paper.year}\n`;
      context += `  期刊: ${paper.journal}\n`;
      context += `  相关度: ${paperResult.score.toFixed(2)}\n`;
      context += `  摘要: ${paper.abstract || '无'}\n\n`;
    });

    context += `### 句子-文献对应关系\n\n`;
    result.results.forEach(sentenceResult => {
      if (sentenceResult.papers.length > 0) {
        context += `句子 ${sentenceResult.sentenceId}: "${sentenceResult.searchQuery.substring(0, 50)}..."\n`;
        context += `  推荐引用: ${sentenceResult.papers.map(p => p.paper.citationId || '?').join(', ')}\n\n`;
      }
    });

    context += `### 引用约束\n\n`;
    context += `1. 只能引用上述【可用文献列表】中的文献\n`;
    context += `2. **引言、讨论章节：每句话都应有参考文献支撑**（方法、结果章节关键处引用）\n`;
    context += `3. 每个观点 1-2 篇文献，重要观点 2-3 篇\n`;
    context += `4. 引用格式: (作者, 年份)，如 (Wang et al., 2024)\n`;
    context += `5. 严格按照目标期刊的引用风格\n`;
    context += `6. 绝对禁止编造未提供的文献\n\n`;

    return context;
  }

  getPapersForSentence(sentenceId: number, result: ParallelSearchResult): SearchResult[] {
    const sentenceResult = result.results.find(r => r.sentenceId === sentenceId);
    return sentenceResult ? sentenceResult.papers : [];
  }
}

export default ParallelSearchOrchestrator;
