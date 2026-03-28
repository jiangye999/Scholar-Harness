import { logger } from '../src/utils/logger';

export interface LitPaper {
  citationId?: number;
  title: string;
  author: string;
  journal: string;
  year: string;
  abstract: string;
  keywords: string;
  doi?: string;
  embedding?: number[];
}

export interface SearchResult {
  paper: LitPaper;
  score: number;
  matchFields: string[];
  vectorScore: number;
  lexicalScore: number;
}

export interface SentenceSearchResult {
  sentenceId: number;
  searchQuery: string;
  papers: SearchResult[];
  searchTime: number;
}

export class ParagraphAgent {
  private literaturePapers: LitPaper[];
  private apiUrl: string;
  private apiKey: string;
  private embeddingModel: string;
  private maxResults: number;

  constructor(
    literaturePapers: LitPaper[],
    apiUrl: string,
    apiKey: string,
    embeddingModel: string,
    maxResults: number = 2
  ) {
    this.literaturePapers = literaturePapers;
    this.apiUrl = apiUrl;
    this.apiKey = apiKey;
    this.embeddingModel = embeddingModel;
    this.maxResults = maxResults;
  }

  async searchForSentence(
    sentenceId: number,
    searchQuery: string
  ): Promise<SentenceSearchResult> {
    const startTime = Date.now();
    
    logger.info(`[ParagraphAgent-${sentenceId}] Searching sentence: "${searchQuery}"`);

    try {
      const results = await this.searchLiterature(searchQuery);
      
      logger.info(`[ParagraphAgent-${sentenceId}] Found ${results.length} papers in ${Date.now() - startTime}ms`);

      return {
        sentenceId,
        searchQuery,
        papers: results.slice(0, this.maxResults),
        searchTime: Date.now() - startTime,
      };
    } catch (error) {
      logger.error(`[ParagraphAgent-${sentenceId}] Search failed:`, error);
      return {
        sentenceId,
        searchQuery,
        papers: [],
        searchTime: Date.now() - startTime,
      };
    }
  }

  async searchLocal(
    sentenceId: number,
    searchQuery: string
  ): Promise<SentenceSearchResult> {
    const startTime = Date.now();
    
    logger.info(`[ParagraphAgent-${sentenceId}] Local search: "${searchQuery}"`);

    const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const results: SearchResult[] = [];

    for (const paper of this.literaturePapers) {
      let lexicalScore = 0;
      const matchFields: string[] = [];

      const titleLower = (paper.title || '').toLowerCase();
      const abstractLower = (paper.abstract || '').toLowerCase();
      const keywordsLower = (Array.isArray(paper.keywords) ? paper.keywords.join(', ') : (paper.keywords || '')).toLowerCase();

      for (const word of queryWords) {
        if (titleLower.includes(word)) {
          lexicalScore += 10;
          if (!matchFields.includes('title')) matchFields.push('title');
        }
        if (keywordsLower.includes(word)) {
          lexicalScore += 8;
          if (!matchFields.includes('keywords')) matchFields.push('keywords');
        }
        if (abstractLower.includes(word)) {
          lexicalScore += 5;
          if (!matchFields.includes('abstract')) matchFields.push('abstract');
        }
      }

      const yearMatch = searchQuery.match(/\d{4}/);
      if (yearMatch && paper.year.includes(yearMatch[0])) {
        lexicalScore += 4;
        matchFields.push('year');
      }

      const embeddingScore = this.calculateEmbeddingSimilarity(searchQuery, paper);
      const combinedScore = lexicalScore * 2 + embeddingScore * 100;

      if (combinedScore > 0) {
        results.push({
          paper,
          score: combinedScore,
          matchFields,
          vectorScore: embeddingScore,
          lexicalScore,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);

    logger.info(`[ParagraphAgent-${sentenceId}] Local search found ${results.length} papers`);

    return {
      sentenceId,
      searchQuery,
      papers: results.slice(0, this.maxResults),
      searchTime: Date.now() - startTime,
    };
  }

  private async searchLiterature(query: string): Promise<SearchResult[]> {
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const results: SearchResult[] = [];

    for (const paper of this.literaturePapers) {
      let lexicalScore = 0;
      const matchFields: string[] = [];

      const titleLower = (paper.title || '').toLowerCase();
      const abstractLower = (paper.abstract || '').toLowerCase();
      const keywordsLower = (Array.isArray(paper.keywords) ? paper.keywords.join(', ') : (paper.keywords || '')).toLowerCase();

      for (const word of queryWords) {
        if (titleLower.includes(word)) {
          lexicalScore += 10;
          if (!matchFields.includes('title')) matchFields.push('title');
        }
        if (keywordsLower.includes(word)) {
          lexicalScore += 8;
          if (!matchFields.includes('keywords')) matchFields.push('keywords');
        }
        if (abstractLower.includes(word)) {
          lexicalScore += 5;
          if (!matchFields.includes('abstract')) matchFields.push('abstract');
        }
      }

      const yearMatch = query.match(/\d{4}/);
      if (yearMatch && paper.year.includes(yearMatch[0])) {
        lexicalScore += 4;
        matchFields.push('year');
      }

      const vectorScore = this.calculateSimilarity(query, paper);
      const score = vectorScore * 50 + lexicalScore;

      if (score > 0) {
        results.push({
          paper,
          score,
          matchFields,
          vectorScore,
          lexicalScore,
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  private calculateEmbeddingSimilarity(query: string, paper: LitPaper): number {
    if (!paper.embedding || paper.embedding.length === 0) {
      return 0;
    }

    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const titleWords = (paper.title || '').toLowerCase().split(/\s+/);
    const abstractWords = (paper.abstract || '').toLowerCase().split(/\s+/);
    const keywordWords = Array.isArray(paper.keywords) 
      ? paper.keywords.map(w => w.trim().toLowerCase()).filter(w => w.length > 0)
      : (paper.keywords || '').toLowerCase().split(/[,;，；]/).map(w => w.trim()).filter(w => w.length > 0);
    
    let overlap = 0;
    for (const word of queryWords) {
      if (titleWords.includes(word) || abstractWords.includes(word) || keywordWords.includes(word)) {
        overlap++;
      }
    }
    
    const coverage = overlap / Math.max(queryWords.length, 1);
    return coverage;
  }

  private calculateSimilarity(query: string, paper: LitPaper): number {
    if (!paper.embedding || paper.embedding.length === 0) {
      return 0;
    }

    const queryWords = query.toLowerCase().split(/\s+/);
    const titleWords = (paper.title || '').toLowerCase().split(/\s+/);
    const abstractWords = (paper.abstract || '').toLowerCase().split(/\s+/);
    
    let overlap = 0;
    for (const word of queryWords) {
      if (titleWords.includes(word) || abstractWords.includes(word)) {
        overlap++;
      }
    }
    
    return overlap / Math.max(queryWords.length, 1);
  }
}

export default ParagraphAgent;
