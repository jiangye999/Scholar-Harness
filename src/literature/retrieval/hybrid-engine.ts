import { BM25Retriever } from './bm25-retriever';
import { VectorRetriever } from './vector-retriever';
import { MetadataFilter } from './metadata-filter';
import type {
  UnifiedLiterature,
  RetrievedDocument,
  RetrievalQuery,
  RetrievalResult,
  RetrievalConfig,
} from '../../types/literature';

interface FusionResult {
  id: string;
  bm25Score: number;
  vectorScore: number;
  combinedScore: number;
}

export class HybridRetrievalEngine {
  private bm25Retriever: BM25Retriever;
  private vectorRetriever: VectorRetriever;
  private metadataFilter: MetadataFilter;
  private literatureMap: Map<string, UnifiedLiterature> = new Map();
  private config: RetrievalConfig;

  constructor(config: Partial<RetrievalConfig> = {}, apiConfig?: { url?: string; key?: string }) {
    this.config = {
      bm25: {
        topN: 50,
        k1: 1.5,
        b: 0.75,
        fieldWeights: {
          title: 3.0,
          keywords: 2.5,
          abstract: 1.5,
          authors: 0.5,
          journal: 0.3,
        },
      },
      vector: {
        topN: 50,
        model: 'text-embedding-3-small',
        dimensions: 1536,
        similarity: 'cosine',
      },
      reranker: {
        enabled: false,
        topN: 20,
      },
      maxCitationsPerParagraph: 3,
      defaultCitationStyle: 'numeric',
      defaultReferenceStyle: 'gbt7714',
      ...config,
    };

    this.bm25Retriever = new BM25Retriever(this.config.bm25);
    this.vectorRetriever = new VectorRetriever(this.config.vector, apiConfig);
    this.metadataFilter = new MetadataFilter();
  }

  async index(literatures: UnifiedLiterature[]): Promise<void> {
    this.literatureMap.clear();

    for (const lit of literatures) {
      this.literatureMap.set(lit.id, lit);
    }

    this.bm25Retriever.addDocuments(literatures);
    await this.vectorRetriever.addDocuments(literatures);
    this.metadataFilter.index(literatures);
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const { query: queryText, filters, topK = 20, searchMode = 'hybrid' } = query;

    let bm25Results: Array<{ id: string; score: number }> = [];
    let vectorResults: Array<{ id: string; score: number }> = [];

    const bm25Start = Date.now();
    if (searchMode === 'bm25' || searchMode === 'hybrid') {
      bm25Results = this.bm25Retriever.search(queryText, this.config.bm25.topN);
    }
    const bm25Ms = Date.now() - bm25Start;

    const vectorStart = Date.now();
    if (searchMode === 'vector' || searchMode === 'hybrid') {
      vectorResults = await this.vectorRetriever.search(queryText, this.config.vector.topN);
    }
    const vectorMs = Date.now() - vectorStart;

    let fused = this.fuseResults(bm25Results, vectorResults, searchMode);

    if (filters) {
      const filteredIds = this.metadataFilter.filter(filters);
      fused = fused.filter(r => filteredIds.has(r.id));
    }

    const rerankStart = Date.now();
    if (this.config.reranker.enabled) {
      fused = await this.rerank(queryText, fused);
    }
    const rerankMs = Date.now() - rerankStart;

    const finalResults = fused.slice(0, topK);

    const results: RetrievedDocument[] = finalResults.map((r, index) => {
      const lit = this.literatureMap.get(r.id);
      if (!lit) {
        throw new Error(`Literature not found: ${r.id}`);
      }

      return {
        ...lit,
        bm25Score: r.bm25Score,
        vectorScore: r.vectorScore,
        combinedScore: r.combinedScore,
        rank: index + 1,
      };
    });

    const totalMs = Date.now() - startTime;

    return {
      query: queryText,
      filters,
      totalCount: results.length,
      results,
      timing: {
        bm25Ms,
        vectorMs,
        rerankMs,
        totalMs,
      },
    };
  }

  private fuseResults(
    bm25Results: Array<{ id: string; score: number }>,
    vectorResults: Array<{ id: string; score: number }>,
    mode: string
  ): FusionResult[] {
    const scores = new Map<string, { bm25?: number; vector?: number }>();

    if (mode === 'bm25' || mode === 'hybrid') {
      const maxBm25 = Math.max(...bm25Results.map(r => r.score), 1);
      for (const r of bm25Results) {
        scores.set(r.id, { bm25: r.score / maxBm25 });
      }
    }

    if (mode === 'vector' || mode === 'hybrid') {
      const maxVector = Math.max(...vectorResults.map(r => r.score), 1);
      for (const r of vectorResults) {
        const existing = scores.get(r.id) || {};
        scores.set(r.id, { ...existing, vector: r.score / maxVector });
      }
    }

    return Array.from(scores.entries()).map(([id, s]) => ({
      id,
      bm25Score: s.bm25 || 0,
      vectorScore: s.vector || 0,
      combinedScore: this.calculateCombinedScore(s.bm25, s.vector),
    })).sort((a, b) => b.combinedScore - a.combinedScore);
  }

  private calculateCombinedScore(bm25?: number, vector?: number): number {
    if (bm25 === undefined && vector === undefined) return 0;
    if (bm25 === undefined) return vector!;
    if (vector === undefined) return bm25;
    return bm25 * 0.5 + vector * 0.5;
  }

  private async rerank(query: string, results: FusionResult[]): Promise<FusionResult[]> {
    if (!this.config.reranker.enabled) return results;

    return results.slice(0, this.config.reranker.topN);
  }

  getLiterature(id: string): UnifiedLiterature | undefined {
    return this.literatureMap.get(id);
  }

  getAllLiteratures(): UnifiedLiterature[] {
    return Array.from(this.literatureMap.values());
  }

  getStatistics() {
    return this.metadataFilter.getStatistics();
  }

  clear(): void {
    this.bm25Retriever.clear();
    this.vectorRetriever.clear();
    this.metadataFilter.clear();
    this.literatureMap.clear();
  }
}
