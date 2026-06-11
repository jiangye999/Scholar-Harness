import * as fs from 'fs';
import * as path from 'path';
import type { UnifiedLiterature, BM25Config } from '../../types/literature';

interface BM25Document {
  id: string;
  tokens: string[];
  termFreq: Map<string, number>;
  docLength: number;
  fieldLengths: Record<string, number>;
}

interface SearchResult {
  id: string;
  score: number;
}

export class BM25Retriever {
  private documents: Map<string, BM25Document> = new Map();
  private idf: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private config: BM25Config;
  private docCount: number = 0;

  constructor(config: Partial<BM25Config> = {}) {
    this.config = {
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
      ...config,
    };
  }

  addDocument(lit: UnifiedLiterature): void {
    const fields = {
      title: lit.title,
      keywords: [...(lit.keywords || []), ...(lit.aiKeywords || [])].join(' '),
      abstract: lit.abstract || '',
      authors: (lit.authors || []).map(a => a.name).join(' '),
      journal: lit.journal || '',
    };

    const tokens: string[] = [];
    const termFreq = new Map<string, number>();
    const fieldLengths: Record<string, number> = {};
    let totalWeightedLength = 0;

    for (const [fieldName, content] of Object.entries(fields)) {
      const weight = this.config.fieldWeights[fieldName as keyof typeof this.config.fieldWeights] || 1;
      const fieldTokens = this.tokenize(content);
      fieldLengths[fieldName] = fieldTokens.length;
      
      const weightedTokens: string[] = [];
      for (let i = 0; i < weight; i++) {
        weightedTokens.push(...fieldTokens);
      }
      
      tokens.push(...weightedTokens);
      totalWeightedLength += fieldTokens.length * weight;

      for (const token of fieldTokens) {
        termFreq.set(token, (termFreq.get(token) || 0) + weight);
      }
    }

    this.documents.set(lit.id, {
      id: lit.id,
      tokens,
      termFreq,
      docLength: tokens.length,
      fieldLengths,
    });

    this.docCount++;
    this.updateStats();
  }

  addDocuments(literatures: UnifiedLiterature[]): void {
    for (const lit of literatures) {
      this.addDocument(lit);
    }
  }

  search(query: string, topN?: number): SearchResult[] {
    const limit = topN || this.config.topN;
    const queryTokens = this.tokenize(query);
    const scores: SearchResult[] = [];

    for (const [id, doc] of this.documents) {
      let score = 0;

      for (const term of queryTokens) {
        const tf = doc.termFreq.get(term) || 0;
        
        if (tf === 0) continue;

        const idf = this.idf.get(term) || 0;
        
        const numerator = tf * (this.config.k1 + 1);
        const denominator = tf + this.config.k1 * (
          1 - this.config.b + this.config.b * (doc.docLength / this.avgDocLength)
        );

        if (denominator > 0) {
          score += idf * (numerator / denominator);
        }
      }

      if (score > 0) {
        scores.push({ id, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private tokenize(text: string): string[] {
    if (!text) return [];
    
    return text.toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  private updateStats(): void {
    const totalLength = Array.from(this.documents.values())
      .reduce((sum: number, doc: BM25Document) => sum + doc.docLength, 0);
    
    this.avgDocLength = this.docCount > 0 
      ? totalLength / this.docCount 
      : 0;

    const termDocCount = new Map<string, number>();

    for (const doc of this.documents.values()) {
      const uniqueTerms = new Set(doc.tokens);
      for (const term of uniqueTerms) {
        termDocCount.set(term, (termDocCount.get(term) || 0) + 1);
      }
    }

    for (const [term, count] of termDocCount) {
      this.idf.set(term, Math.log((this.docCount - count + 0.5) / (count + 0.5) + 1));
    }
  }

  getDocumentCount(): number {
    return this.docCount;
  }

  clear(): void {
    this.documents.clear();
    this.idf.clear();
    this.avgDocLength = 0;
    this.docCount = 0;
  }

  /**
   * 保存 BM25 索引到文件
   */
  saveIndex(indexPath: string): void {
    const indexData = {
      version: 1,
      timestamp: Date.now(),
      config: this.config,
      avgDocLength: this.avgDocLength,
      docCount: this.docCount,
      idf: Array.from(this.idf.entries()),
      documents: Array.from(this.documents.entries()).map(([id, doc]) => ({
        id,
        tokens: doc.tokens,
        termFreq: Array.from(doc.termFreq.entries()),
        docLength: doc.docLength,
        fieldLengths: doc.fieldLengths,
      })),
    };

    const dir = path.dirname(indexPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(indexPath, JSON.stringify(indexData), 'utf-8');
    console.log(`[BM25Retriever] Saved index to ${indexPath} (${this.documents.size} documents)`);
  }

  /**
   * 从文件加载 BM25 索引
   */
  loadIndex(indexPath: string): boolean {
    if (!fs.existsSync(indexPath)) {
      console.log(`[BM25Retriever] Index file not found: ${indexPath}`);
      return false;
    }

    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      const indexData = JSON.parse(content);

      if (indexData.version !== 1) {
        console.log(`[BM25Retriever] Unsupported index version: ${indexData.version}`);
        return false;
      }

      this.config = { ...this.config, ...indexData.config };
      this.avgDocLength = indexData.avgDocLength;
      this.docCount = indexData.docCount;

      this.idf.clear();
      for (const [term, score] of indexData.idf) {
        this.idf.set(term, score);
      }

      this.documents.clear();
      for (const docData of indexData.documents) {
        const termFreq = new Map<string, number>();
        for (const [term, freq] of docData.termFreq) {
          termFreq.set(term, freq);
        }
        this.documents.set(docData.id, {
          id: docData.id,
          tokens: docData.tokens,
          termFreq,
          docLength: docData.docLength,
          fieldLengths: docData.fieldLengths,
        });
      }

      console.log(`[BM25Retriever] Loaded index from ${indexPath} (${this.documents.size} documents, timestamp: ${new Date(indexData.timestamp).toLocaleString()})`);
      return true;
    } catch (error) {
      console.error(`[BM25Retriever] Failed to load index:`, error);
      return false;
    }
  }
}
