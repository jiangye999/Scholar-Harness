import * as fs from 'fs';
import * as path from 'path';
import { BM25Retriever } from './bm25-retriever';
import { VectorRetriever } from './vector-retriever';
import { MetadataFilter } from './metadata-filter';
import { buildSemanticRetrievalQuery, tokenizeRetrievalText } from './semantic-query';
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
  rerankScore?: number;
  combinedScore: number;
}

export class HybridRetrievalEngine {
  private bm25Retriever: BM25Retriever;
  private vectorRetriever: VectorRetriever;
  private metadataFilter: MetadataFilter;
  private literatureMap: Map<string, UnifiedLiterature> = new Map();
  private config: RetrievalConfig;
  private persistenceDirectory?: string;

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
        enabled: true,
        topN: 50,
        candidateTopN: 80,
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

  async prepareDocumentEmbeddings(documentIds: string[]): Promise<{
    requestedCount: number;
    embeddedCount: number;
  }> {
    const result = await this.vectorRetriever.prepareDocumentEmbeddings(documentIds);
    if (this.persistenceDirectory && this.vectorRetriever.hasDirtyEmbeddings()) {
      this.saveIndex(this.persistenceDirectory);
    }
    return result;
  }

  async retrieve(query: RetrievalQuery): Promise<RetrievalResult> {
    const startTime = Date.now();
    const { query: queryText, filters, topK = 20, searchMode = 'hybrid' } = query;
    const semanticQueryText = buildSemanticRetrievalQuery(queryText);

    let bm25Results: Array<{ id: string; score: number }> = [];
    let vectorResults: Array<{ id: string; score: number }> = [];
    const filteredIds = filters ? this.metadataFilter.filter(filters) : null;

    const bm25Start = Date.now();
    if (searchMode === 'bm25' || searchMode === 'hybrid') {
      const bm25Limit = searchMode === 'hybrid'
        ? Math.min(
            Math.max(
              this.config.bm25.topN,
              this.config.reranker.candidateTopN || 0,
              topK * 4
            ),
            Math.max(1, this.literatureMap.size)
          )
        : this.config.bm25.topN;
      bm25Results = this.bm25Retriever.search(semanticQueryText, bm25Limit);
      if (filteredIds) {
        bm25Results = bm25Results.filter(result => filteredIds.has(result.id));
      }
    }
    const bm25Ms = Date.now() - bm25Start;

    const vectorStart = Date.now();
    if (searchMode === 'vector') {
      vectorResults = await this.vectorRetriever.search(semanticQueryText, this.config.vector.topN);
      if (filteredIds) {
        vectorResults = vectorResults.filter(result => filteredIds.has(result.id));
      }
    } else if (searchMode === 'hybrid' && bm25Results.length > 0) {
      // 严格级联：向量阶段只能处理 BM25 粗筛出的候选，禁止再做全库向量召回后加权融合。
      vectorResults = await this.vectorRetriever.searchWithin(
        semanticQueryText,
        bm25Results.map(result => result.id),
        bm25Results.length
      );
    }
    const vectorMs = Date.now() - vectorStart;

    let fused = this.buildCascadeResults(bm25Results, vectorResults, searchMode);

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
        rerankScore: r.rerankScore,
        combinedScore: r.combinedScore,
        rank: index + 1,
      };
    });

    if (this.persistenceDirectory && this.vectorRetriever.hasDirtyEmbeddings()) {
      try {
        this.saveIndex(this.persistenceDirectory);
      } catch (error) {
        console.warn('[HybridEngine] Failed to persist lazy candidate embeddings:', error);
      }
    }

    const totalMs = Date.now() - startTime;
    const embeddingConfigured = this.vectorRetriever.hasApiConfig();
    const semanticApplied = vectorResults.length > 0;
    const strategy = searchMode === 'bm25'
      ? 'bm25'
      : searchMode === 'vector'
        ? 'vector'
        : semanticApplied
          ? 'bm25-embedding-reranker'
          : 'bm25-fallback';

    return {
      query: queryText,
      filters,
      totalCount: results.length,
      results,
      pipeline: {
        strategy,
        bm25CandidateCount: bm25Results.length,
        vectorCandidateCount: vectorResults.length,
        rerankedCount: fused.length,
        embeddingConfigured,
        fallbackReason: searchMode === 'hybrid' && !semanticApplied
          ? embeddingConfigured
            ? 'embedding-empty-or-failed'
            : 'embedding-not-configured'
          : undefined,
      },
      timing: {
        bm25Ms,
        vectorMs,
        rerankMs,
        totalMs,
      },
    };
  }

  /**
   * 构造各阶段结果。hybrid 模式下 BM25 只决定候选资格，最终基础顺序完全来自候选向量相似度。
   * 如果 Embedding 未配置或调用失败，才显式降级为 BM25 顺序。
   */
  private buildCascadeResults(
    bm25Results: Array<{ id: string; score: number }>,
    vectorResults: Array<{ id: string; score: number }>,
    mode: string
  ): FusionResult[] {
    const maxBm25 = Math.max(...bm25Results.map(result => result.score), 1);
    const normalizedBm25 = new Map(
      bm25Results.map(result => [result.id, result.score / maxBm25])
    );

    if ((mode === 'hybrid' || mode === 'vector') && vectorResults.length > 0) {
      return vectorResults.map(result => ({
        id: result.id,
        bm25Score: normalizedBm25.get(result.id) || 0,
        vectorScore: result.score,
        combinedScore: result.score,
      })).sort((a, b) => b.vectorScore - a.vectorScore);
    }

    return bm25Results.map(result => ({
      id: result.id,
      bm25Score: result.score / maxBm25,
      vectorScore: 0,
      combinedScore: result.score / maxBm25,
    })).sort((a, b) => b.bm25Score - a.bm25Score);
  }

  private async rerank(query: string, results: FusionResult[]): Promise<FusionResult[]> {
    if (!this.config.reranker.enabled) return results;
    const queryTokens = this.uniqueTokens(tokenizeRetrievalText(query));
    const normalizedPhrase = this.normalizeForRerank(query);
    const reranked = results.map(result => {
      const literature = this.literatureMap.get(result.id);
      if (!literature) return { ...result, rerankScore: result.combinedScore };
      const rerankText = String(
        literature.embeddingText
        || `${literature.title || ''} ${literature.abstract || ''}`
      );
      const candidateTokens = new Set(tokenizeRetrievalText(rerankText));
      const matchedTokenCount = queryTokens.filter(token => candidateTokens.has(token)).length;
      const coverage = queryTokens.length > 0 ? matchedTokenCount / queryTokens.length : 0;
      const exactPhrase = normalizedPhrase.length >= 4
        && this.normalizeForRerank(rerankText).includes(normalizedPhrase);
      const attachment = literature.evidenceAttachment;
      const provenanceCompleteness = attachment
        ? [
            attachment.sentence,
            attachment.sourcePdfId || attachment.sourcePdfName,
            attachment.section,
            attachment.references?.length ? 'references' : '',
          ].filter(Boolean).length / 4
        : 0;

      // BM25 分数不进入重排计算。它只决定候选资格；此处在语义分数上补充
      // 精确短语、查询覆盖和证据来源完整度三个可解释特征。
      const semanticBase = result.vectorScore > 0 ? result.vectorScore : result.combinedScore;
      const rerankScore = semanticBase
        + (exactPhrase ? 0.04 : 0)
        + coverage * 0.04
        + provenanceCompleteness * 0.02;
      return {
        ...result,
        rerankScore,
        combinedScore: rerankScore,
      };
    });

    return reranked
      .sort((a, b) => Number(b.rerankScore || 0) - Number(a.rerankScore || 0))
      .slice(0, Math.max(1, this.config.reranker.topN));
  }

  private uniqueTokens(tokens: string[]): string[] {
    return Array.from(new Set(tokens.filter(token => token.length > 1)));
  }

  private normalizeForRerank(value: string): string {
    return String(value || '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\u4e00-\u9fa5]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
  updateApiConfig(apiConfig?: { url?: string; key?: string; model?: string; dimensions?: number }): void {
    this.vectorRetriever.updateApiConfig(apiConfig);
    console.log(`[HybridEngine] API config updated: url=${apiConfig?.url ? '已配置' : '空'}, key=${apiConfig?.key ? '已配置' : '空'}`);
  }

  setPersistenceDirectory(cacheDir: string): void {
    this.persistenceDirectory = cacheDir;
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
      version: 2,
      timestamp: Date.now(),
      literatures: Array.from(this.literatureMap.entries()).map(([id, lit]) => ({
        id,
        citationId: lit.citationId,
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
        documentCategories: lit.documentCategories,
        references: lit.references,
        source: lit.source,
        rawData: lit.rawData,
        embeddingText: lit.embeddingText,
        evidenceAttachment: lit.evidenceAttachment,
        chunks: lit.chunks,
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
      if (literatureMapData.version !== 2) {
        console.log(`[HybridEngine] Unsupported literature map version: ${literatureMapData.version}`);
        return false;
      }
      this.literatureMap.clear();
      for (const litData of literatureMapData.literatures) {
        this.literatureMap.set(litData.id, {
          id: litData.id,
          citationId: litData.citationId,
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
          documentCategories: litData.documentCategories,
          references: litData.references,
          source: litData.source,
          rawData: litData.rawData,
          embeddingText: litData.embeddingText,
          evidenceAttachment: litData.evidenceAttachment,
          chunks: litData.chunks,
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
