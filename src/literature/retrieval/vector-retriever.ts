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
      model: 'text-embedding-3-small',
      dimensions: 1536,
      similarity: 'cosine',
      ...config,
    };
    this.apiUrl = apiConfig?.url;
    this.apiKey = apiConfig?.key;
  }

  async addDocument(lit: UnifiedLiterature): Promise<void> {
    const text = `${lit.title} ${lit.keywords.join(' ')} ${lit.abstract}`;
    
    const doc: VectorDocument = {
      id: lit.id,
      text,
    };

    // 如果文献已有 embedding，直接使用，不再重新计算
    if (lit.embedding && lit.embedding.length > 0) {
      doc.embedding = lit.embedding;
    } else if (this.apiUrl && this.apiKey) {
      doc.embedding = await this.getEmbedding(text);
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
    
    let queryEmbedding: number[];
    
    if (this.apiUrl && this.apiKey) {
      queryEmbedding = await this.getEmbedding(query);
    } else {
      queryEmbedding = this.simpleEmbedding(query);
    }

    const scores: SearchResult[] = [];

    for (const [id, doc] of this.documents) {
      if (!doc.embedding) continue;

      const score = this.config.similarity === 'cosine'
        ? this.cosineSimilarity(queryEmbedding, doc.embedding)
        : this.dotProduct(queryEmbedding, doc.embedding);

      scores.push({ id, score });
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.apiUrl || !this.apiKey) {
      return this.simpleEmbedding(text);
    }

    try {
      const response = await fetch(`${this.apiUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          input: text.slice(0, 8000),
        }),
      });

      if (!response.ok) {
        return this.simpleEmbedding(text);
      }

      const data = await response.json() as { data?: Array<{ embedding: number[] }> };
      return data.data?.[0]?.embedding || this.simpleEmbedding(text);
    } catch {
      return this.simpleEmbedding(text);
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
}
