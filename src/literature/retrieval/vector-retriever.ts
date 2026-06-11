import * as fs from 'fs';
import * as path from 'path';
import type { UnifiedLiterature, VectorConfig } from '../../types/literature';

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

  updateApiConfig(apiConfig?: { url?: string; key?: string }): void {
    this.apiUrl = apiConfig?.url;
    this.apiKey = apiConfig?.key;
  }

  async addDocument(lit: UnifiedLiterature): Promise<void> {
    const text = `${lit.title || ''} ${Array.isArray(lit.keywords) ? lit.keywords.join(' ') : (lit.keywords || '')} ${lit.abstract || ''}`;
    
    const doc: VectorDocument = {
      id: lit.id,
      text,
    };

    // 如果文献已有 embedding，直接使用，不再重新计算
    if (lit.embedding && lit.embedding.length > 0) {
      doc.embedding = lit.embedding;
    } else if (this.apiUrl && this.apiKey) {
      const embedding = await this.getEmbedding(text);
      if (embedding) {
        doc.embedding = embedding;
      }
    } else {
      doc.embedding = this.simpleEmbedding(text);
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
    
    let queryEmbedding: number[] | null;
    
    if (this.apiUrl && this.apiKey) {
      queryEmbedding = await this.getEmbedding(query);
    } else {
      queryEmbedding = this.simpleEmbedding(query);
    }

    if (!queryEmbedding) {
      return [];
    }

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

  private async getEmbedding(text: string): Promise<number[] | null> {
    if (!this.apiUrl || !this.apiKey) {
      return this.simpleEmbedding(text);
    }

    try {
      // 构建 API 请求体，包含 dimensions 参数（如果模型支持）
      const requestBody: Record<string, unknown> = {
        model: this.config.model,
        input: text.slice(0, 8000),
      };
      
      // 对于支持自定义维度的模型（如 text-embedding-v3/v4），传递 dimensions 参数
      // 注意：dimensions 必须在模型支持的范围内
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

      const data = await response.json() as { data?: Array<{ embedding: number[] }> };
      const embedding = data.data?.[0]?.embedding;
      
      if (!embedding) {
        console.log('[VectorRetriever] No embedding in response');
        return null;
      }
      
      // 验证返回的 embedding 维度是否与期望一致
      if (embedding.length !== this.config.dimensions) {
        console.log(`[VectorRetriever] Warning: API returned ${embedding.length} dimensions, expected ${this.config.dimensions}`);
        // 仍然使用返回的 embedding，相似度计算会自动处理维度差异
      }
      
      return embedding;
    } catch (error) {
      console.log('[VectorRetriever] Embedding API call failed:', error);
      return null;
    }
  }

  private simpleEmbedding(text: string): number[] {
    const normalized = text.toLowerCase().replace(/[^\w\s\u4e00-\u9fa5]/g, ' ');
    const tokens = normalized.split(/\s+/).filter(t => t.length > 1);
    
    const dimensions = this.config.dimensions;
    const embedding: number[] = new Array(dimensions).fill(0);
    
    const tokenSet = new Set(tokens);
    
    for (const token of tokenSet) {
      let hash = 0;
      for (let i = 0; i < token.length; i++) {
        hash = ((hash << 5) - hash) + token.charCodeAt(i);
        hash = hash & hash;
      }
      
      const index = Math.abs(hash) % dimensions;
      const tf = tokens.filter(t => t === token).length / tokens.length;
      embedding[index] = tf;
    }
    
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    
    if (magnitude > 0) {
      return embedding.map(val => val / magnitude);
    }
    
    return embedding;
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
  }

  /**
   * 保存向量索引到文件
   * @param indexPath 索引文件路径
   */
  saveIndex(indexPath: string): void {
    const indexData = {
      version: 1,
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

      if (indexData.version !== 1) {
        console.log(`[VectorRetriever] Unsupported index version: ${indexData.version}`);
        return false;
      }

      // 恢复配置
      if (indexData.config) {
        this.config = { ...this.config, ...indexData.config };
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

      console.log(`[VectorRetriever] Loaded index from ${indexPath} (${this.documents.size} documents, timestamp: ${new Date(indexData.timestamp).toLocaleString()})`);
      return true;
    } catch (error) {
      console.error(`[VectorRetriever] Failed to load index:`, error);
      return false;
    }
  }
}
