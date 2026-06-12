import * as fs from 'fs';
import * as path from 'path';
import { BM25Retriever } from './bm25-retriever';
import { VectorRetriever } from './vector-retriever';
import { MetadataFilter } from './metadata-filter';
import { buildSemanticRetrievalQuery } from './semantic-query';
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
        model: 'text-embedding-v4',
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

  /**
   * 全量索引（清空后重新索引）
   */
  async index(literatures: UnifiedLiterature[]): Promise<void> {
    this.clear();

    for (const lit of literatures) {
      this.literatureMap.set(lit.id, lit);
    }

    this.bm25Retriever.addDocuments(literatures);
    await this.vectorRetriever.addDocuments(literatures);
    this.metadataFilter.index(literatures);
  }

  /**
   * 增量索引（只添加新文献，不清空已有索引）
   */
  async addDocuments(literatures: UnifiedLiterature[]): Promise<void> {
    // 只添加新文献
    const newLiteratures: UnifiedLiterature[] = [];
    for (const lit of literatures) {
      if (!this.literatureMap.has(lit.id)) {
        this.literatureMap.set(lit.id, lit);
        newLiteratures.push(lit);
      }
    }

    if (newLiteratures.length === 0) {
      console.log(`[HybridEngine] No new documents to add`);
      return;
    }

    console.log(`[HybridEngine] Adding ${newLiteratures.length} new documents (total: ${this.literatureMap.size})`);

    this.bm25Retriever.addDocuments(newLiteratures);
    await this.vectorRetriever.addDocuments(newLiteratures);
    this.metadataFilter.index(newLiteratures);
  }

  /**
   * 获取当前索引的文献数量
   */
  getDocumentCount(): number {
    return this.literatureMap.size;
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const { query: queryText, filters, topK = 20, searchMode = 'hybrid' } = query;
    const semanticQueryText = buildSemanticRetrievalQuery(queryText);

    let bm25Results: Array<{ id: string; score: number }> = [];
    let vectorResults: Array<{ id: string; score: number }> = [];

    const bm25Start = Date.now();
    if (searchMode === 'bm25' || searchMode === 'hybrid') {
      const bm25Limit = searchMode === 'hybrid'
        ? Math.min(
            Math.max(this.config.bm25.topN, topK * 8, 80),
            Math.max(1, this.literatureMap.size)
          )
        : this.config.bm25.topN;
      bm25Results = this.bm25Retriever.search(semanticQueryText, bm25Limit);
    }
    const bm25Ms = Date.now() - bm25Start;

    const vectorStart = Date.now();
    if (searchMode === 'vector') {
      vectorResults = await this.vectorRetriever.search(semanticQueryText, this.config.vector.topN);
    } else if (searchMode === 'hybrid' && bm25Results.length > 0) {
      const vectorCandidateLimit = Math.max(this.config.vector.topN, topK * 8, 80);
      const vectorWithinResults = await this.vectorRetriever.searchWithin(
        semanticQueryText,
        bm25Results.map(result => result.id),
        vectorCandidateLimit
      );
      const vectorGlobalResults = await this.vectorRetriever.search(
        semanticQueryText,
        Math.max(this.config.vector.topN, topK * 4, 40)
      );
      vectorResults = this.mergeVectorResults(vectorWithinResults, vectorGlobalResults, vectorCandidateLimit);
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
    const semanticAvailable = mode === 'hybrid' && vectorResults.length > 0;

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
      combinedScore: this.calculateCombinedScore(s.bm25, s.vector, semanticAvailable),
    })).sort((a, b) => b.combinedScore - a.combinedScore);
  }

  private mergeVectorResults(
    primary: Array<{ id: string; score: number }>,
    secondary: Array<{ id: string; score: number }>,
    limit: number
  ): Array<{ id: string; score: number }> {
    const merged = new Map<string, number>();
    for (const result of [...primary, ...secondary]) {
      const current = merged.get(result.id) || 0;
      if (result.score > current) merged.set(result.id, result.score);
    }
    return Array.from(merged.entries())
      .map(([id, score]) => ({ id, score }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));
  }

  private calculateCombinedScore(bm25?: number, vector?: number, semanticAvailable = false): number {
    if (bm25 === undefined && vector === undefined) return 0;
    if (semanticAvailable) {
      return (bm25 || 0) * 0.22 + (vector || 0) * 0.78;
    }
    if (bm25 === undefined) return vector!;
    if (vector === undefined) return bm25;
    // BM25 只负责粗召回和兜底；真正有向量相似度时由上面的 semanticAvailable 分支主导排序。
    return bm25 * 0.35 + vector * 0.65;
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

  /**
   * 更新 API 配置（用于运行时更新 Embedding API 配置）
   */
  updateApiConfig(apiConfig?: { url?: string; key?: string }): void {
    this.vectorRetriever.updateApiConfig(apiConfig);
    console.log(`[HybridEngine] API config updated: url=${apiConfig?.url ? '已配置' : '空'}, key=${apiConfig?.key ? '已配置' : '空'}`);
  }

  /**
   * 保存所有索引到目录
   */
  saveIndex(cacheDir: string): void {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const literatureMapPath = path.join(cacheDir, 'literature-map.json');
    const literatureMapData = {
      version: 1,
      timestamp: Date.now(),
      literatures: Array.from(this.literatureMap.entries()).map(([id, lit]) => ({
        id,
        title: lit.title,
        authors: lit.authors,
        author: lit.author,
        year: lit.year,
        abstract: lit.abstract,
        keywords: lit.keywords,
        aiKeywords: lit.aiKeywords,
        journal: lit.journal,
        volume: lit.volume,
        issue: lit.issue,
        pages: lit.pages,
        doi: lit.doi,
        documentType: lit.documentType,
        categories: lit.categories,
        source: lit.source,
        embedding: lit.embedding,
      })),
    };
    fs.writeFileSync(literatureMapPath, JSON.stringify(literatureMapData), 'utf-8');

    this.bm25Retriever.saveIndex(path.join(cacheDir, 'bm25-index.json'));
    this.vectorRetriever.saveIndex(path.join(cacheDir, 'vector-index.json'));

    console.log(`[HybridEngine] Saved all indexes to ${cacheDir}`);
  }

  /**
   * 从目录加载所有索引
   */
  loadIndex(cacheDir: string): boolean {
    const literatureMapPath = path.join(cacheDir, 'literature-map.json');
    const bm25Path = path.join(cacheDir, 'bm25-index.json');
    const vectorPath = path.join(cacheDir, 'vector-index.json');

    if (!fs.existsSync(literatureMapPath) || !fs.existsSync(bm25Path) || !fs.existsSync(vectorPath)) {
      console.log(`[HybridEngine] Cache files not found, will rebuild index`);
      return false;
    }

    try {
      const literatureMapData = JSON.parse(fs.readFileSync(literatureMapPath, 'utf-8'));
      this.literatureMap.clear();
      for (const litData of literatureMapData.literatures) {
        this.literatureMap.set(litData.id, {
          id: litData.id,
          title: litData.title,
          authors: litData.authors,
          author: litData.author,
          year: litData.year,
          abstract: litData.abstract,
          keywords: litData.keywords,
          aiKeywords: litData.aiKeywords,
          journal: litData.journal,
          volume: litData.volume,
          issue: litData.issue,
          pages: litData.pages,
          doi: litData.doi,
          documentType: litData.documentType,
          categories: litData.categories,
          source: litData.source,
          embedding: litData.embedding,
        });
      }

      const bm25Loaded = this.bm25Retriever.loadIndex(bm25Path);
      const vectorLoaded = this.vectorRetriever.loadIndex(vectorPath);

      if (!bm25Loaded || !vectorLoaded) {
        console.log(`[HybridEngine] Failed to load sub-indexes, will rebuild`);
        return false;
      }

      // 恢复 metadataFilter（用 literatureMap 数据重新索引）
      this.metadataFilter.index(Array.from(this.literatureMap.values()));

      console.log(`[HybridEngine] Loaded all indexes from ${cacheDir} (${this.literatureMap.size} documents)`);
      return true;
    } catch (error) {
      console.error(`[HybridEngine] Failed to load indexes:`, error);
      return false;
    }
  }
}
