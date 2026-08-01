import * as fs from 'fs';
import * as path from 'path';
import type { UnifiedLiterature, VectorConfig } from '../../types/literature';
import { buildSemanticRetrievalQuery } from './semantic-query';

interface VectorDocument {
  id: string;
  text: string;
  embedding?: number[];
}

interface SearchResult {
  id: string;
  score: number;
}

export class VectorRetriever {
  private documents: Map<string, VectorDocument> = new Map();
  private config: VectorConfig;
  private apiUrl?: string;
  private apiKey?: string;
  private dirtyEmbeddings = false;

  constructor(config: Partial<VectorConfig> = {}, apiConfig?: { url?: string; key?: string }) {
    this.config = {
      topN: 50,
      model: 'text-embedding-v4',
      dimensions: 1536,
      similarity: 'cosine',
      ...config,
    };
    this.apiUrl = apiConfig?.url;
    this.apiKey = apiConfig?.key;
  }

  updateApiConfig(apiConfig?: { url?: string; key?: string; model?: string; dimensions?: number }): void {
    this.apiUrl = apiConfig?.url;
    this.apiKey = apiConfig?.key;
    if (apiConfig?.model) this.config.model = apiConfig.model;
    if (apiConfig?.dimensions && Number.isFinite(apiConfig.dimensions)) {
      this.config.dimensions = apiConfig.dimensions;
    }
  }

  hasApiConfig(): boolean {
    return Boolean(this.apiUrl && this.apiKey);
  }

  async addDocument(lit: UnifiedLiterature): Promise<void> {
    const text = String(
      lit.embeddingText
      || `${lit.title || ''} ${Array.isArray(lit.keywords) ? lit.keywords.join(' ') : (lit.keywords || '')} ${lit.abstract || ''}`
    ).trim();
    
    const doc: VectorDocument = {
      id: lit.id,
      text,
    };

    // 文献索引只使用已有 embedding。查询时才调用 embedding API，避免启动重建索引时逐篇请求模型。
    if (lit.embedding && lit.embedding.length > 0) {
      doc.embedding = lit.embedding;
    }

    this.documents.set(lit.id, doc);
  }

  async addDocuments(literatures: UnifiedLiterature[]): Promise<void> {
    const batchSize = 200;
    console.log(`[VectorRetriever] Indexing ${literatures.length} documents in batches of ${batchSize}`);
    
    for (let i = 0; i < literatures.length; i += batchSize) {
      const batch = literatures.slice(i, i + batchSize);
      await Promise.all(batch.map(lit => this.addDocument(lit)));
      
      if ((i + batchSize) % 500 === 0 || i + batchSize >= literatures.length) {
        console.log(`[VectorRetriever] Indexed ${Math.min(i + batchSize, literatures.length)}/${literatures.length} documents`);
      }
    }
    
    console.log(`[VectorRetriever] Finished indexing ${this.documents.size} documents`);
  }

  async search(query: string, topN?: number): Promise<SearchResult[]> {
    const limit = topN || this.config.topN;
    if (!this.apiUrl || !this.apiKey) return [];
    const queryEmbedding = await this.getEmbedding(buildSemanticRetrievalQuery(query));

    if (!queryEmbedding) {
      return [];
    }

    await this.ensureDocumentEmbeddings(Array.from(this.documents.keys()));
    const scores: SearchResult[] = [];

    for (const [id, doc] of this.documents) {
      if (!doc.embedding) continue;

      const score = this.config.similarity === 'cosine'
        ? this.cosineSimilarity(queryEmbedding, doc.embedding)
        : this.dotProduct(queryEmbedding, doc.embedding);

      if (score > 0) {
        scores.push({ id, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async searchWithin(query: string, candidateIds: string[], topN?: number): Promise<SearchResult[]> {
    const limit = topN || this.config.topN;
    if (!this.apiUrl || !this.apiKey || candidateIds.length === 0) return [];

    const queryEmbedding = await this.getEmbedding(buildSemanticRetrievalQuery(query));
    if (!queryEmbedding) return [];

    await this.ensureDocumentEmbeddings(candidateIds);
    const scores: SearchResult[] = [];
    const seen = new Set<string>();
    for (const id of candidateIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = this.documents.get(id);
      if (!doc?.embedding || doc.embedding.length === 0) continue;

      const score = this.config.similarity === 'cosine'
        ? this.cosineSimilarity(queryEmbedding, doc.embedding)
        : this.dotProduct(queryEmbedding, doc.embedding);

      if (score > 0) scores.push({ id, score });
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async getEmbedding(text: string): Promise<number[] | null> {
    const embeddings = await this.getEmbeddings([text]);
    return embeddings?.[0] || null;
  }

  /**
   * 只为 BM25 粗筛后的候选生成向量。已有向量直接复用，新增向量会标记为待持久化。
   */
  private async ensureDocumentEmbeddings(candidateIds: string[]): Promise<void> {
    const missing: VectorDocument[] = [];
    const seen = new Set<string>();
    for (const id of candidateIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const doc = this.documents.get(id);
      if (doc && (!doc.embedding || doc.embedding.length === 0) && doc.text) {
        missing.push(doc);
      }
    }

    const batchSize = 24;
    for (let offset = 0; offset < missing.length; offset += batchSize) {
      const batch = missing.slice(offset, offset + batchSize);
      const embeddings = await this.getEmbeddings(batch.map(doc => doc.text));
      if (!embeddings || embeddings.length !== batch.length) continue;
      batch.forEach((doc, index) => {
        const embedding = embeddings[index];
        if (!embedding || embedding.length === 0) return;
        doc.embedding = embedding;
        this.dirtyEmbeddings = true;
      });
    }
  }

  /**
   * Proactively prepare embeddings for a bounded set of documents.
   *
   * Normal retrieval keeps embeddings lazy and only vectorizes BM25 candidates.
   * PDF deep analysis is different: the user explicitly asked to publish newly
   * derived evidence into the Wiki, so those new evidence records should be
   * searchable semantically as soon as the analysis finishes.
   */
  async prepareDocumentEmbeddings(candidateIds: string[]): Promise<{
    requestedCount: number;
    embeddedCount: number;
  }> {
    const ids = Array.from(new Set(candidateIds.map(id => String(id || '').trim()).filter(Boolean)))
      .filter(id => this.documents.has(id));
    if (ids.length === 0 || !this.hasApiConfig()) {
      return { requestedCount: ids.length, embeddedCount: 0 };
    }

    await this.ensureDocumentEmbeddings(ids);
    return {
      requestedCount: ids.length,
      embeddedCount: ids.filter(id => {
        const embedding = this.documents.get(id)?.embedding;
        return Array.isArray(embedding) && embedding.length > 0;
      }).length,
    };
  }

  private async getEmbeddings(texts: string[]): Promise<number[][] | null> {
    if (!this.apiUrl || !this.apiKey || texts.length === 0) return null;
    try {
      const requestBody: Record<string, unknown> = {
        model: this.config.model,
        input: texts.map(text => text.slice(0, 8000)),
      };

      if (this.config.dimensions) {
        requestBody.dimensions = this.config.dimensions;
      }

      const response = await fetch(`${this.apiUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[VectorRetriever] Embedding API error: ${response.status} - ${errorText.slice(0, 200)}`);
        return null;
      }

      const data = await response.json() as { data?: Array<{ embedding: number[]; index?: number }> };
      const rows = data.data || [];
      if (rows.length !== texts.length) {
        console.log(`[VectorRetriever] Embedding response count mismatch: ${rows.length}/${texts.length}`);
        return null;
      }

      const ordered = rows.some(row => typeof row.index === 'number')
        ? [...rows].sort((a, b) => Number(a.index || 0) - Number(b.index || 0))
        : rows;
      const embeddings = ordered.map(row => row.embedding);
      if (embeddings.some(embedding => !Array.isArray(embedding) || embedding.length === 0)) {
        console.log('[VectorRetriever] No embedding in response');
        return null;
      }
      const unexpected = embeddings.find(embedding => embedding.length !== this.config.dimensions);
      if (unexpected) {
        console.log(`[VectorRetriever] Warning: API returned ${unexpected.length} dimensions, expected ${this.config.dimensions}`);
      }

      return embeddings;
    } catch (error) {
      console.log('[VectorRetriever] Embedding API call failed:', error);
      return null;
    }
  }

  hasDirtyEmbeddings(): boolean {
    return this.dirtyEmbeddings;
  }

  markEmbeddingsPersisted(): void {
    this.dirtyEmbeddings = false;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    const length = Math.min(a.length, b.length);
    
    for (let i = 0; i < length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  private dotProduct(a: number[], b: number[]): number {
    const length = Math.min(a.length, b.length);
    let sum = 0;
    
    for (let i = 0; i < length; i++) {
      sum += a[i] * b[i];
    }
    
    return sum;
  }

  getDocumentCount(): number {
    return this.documents.size;
  }

  clear(): void {
    this.documents.clear();
    this.dirtyEmbeddings = false;
  }

  /**
   * 保存向量索引到文件
   * @param indexPath 索引文件路径
   */
  saveIndex(indexPath: string): void {
    const indexData = {
      version: 3,
      timestamp: Date.now(),
      config: this.config,
      documents: Array.from(this.documents.entries()).map(([id, doc]) => ({
        id,
        text: doc.text,
        embedding: doc.embedding,
      })),
    };

    const dir = path.dirname(indexPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(indexPath, JSON.stringify(indexData), 'utf-8');
    this.markEmbeddingsPersisted();
    console.log(`[VectorRetriever] Saved index to ${indexPath} (${this.documents.size} documents)`);
  }

  /**
   * 从文件加载向量索引
   * @param indexPath 索引文件路径
   * @returns 是否加载成功
   */
  loadIndex(indexPath: string): boolean {
    if (!fs.existsSync(indexPath)) {
      console.log(`[VectorRetriever] Index file not found: ${indexPath}`);
      return false;
    }

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const indexData = JSON.parse(content);

      if (indexData.version !== 3) {
        console.log(`[VectorRetriever] Unsupported index version: ${indexData.version}`);
        return false;
      }

      if (
        indexData.config
        && (
          indexData.config.model !== this.config.model
          || Number(indexData.config.dimensions) !== Number(this.config.dimensions)
        )
      ) {
        console.log('[VectorRetriever] Embedding model config changed, will rebuild vector index');
        return false;
      }

      // 恢复文档
      this.documents.clear();
      for (const doc of indexData.documents) {
        this.documents.set(doc.id, {
          id: doc.id,
          text: doc.text,
          embedding: doc.embedding,
        });
      }
      this.dirtyEmbeddings = false;

      console.log(`[VectorRetriever] Loaded index from ${indexPath} (${this.documents.size} documents, timestamp: ${new Date(indexData.timestamp).toLocaleString()})`);
      return true;
    } catch (error) {
      console.error(`[VectorRetriever] Failed to load index:`, error);
      return false;
    }
  }
}
