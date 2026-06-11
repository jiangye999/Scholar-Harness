// ScholarClaw - Literature Search Agent (小牛马 - 文献检索与筛选)
// 负责：从用户文献库检索、质量筛选、按论点分类文献

import { logger } from '../src/utils/logger';
import type { APIClient } from '../src/types';
import type { RetrievedDocument } from '../src/types/literature';
import { HybridRetrievalEngine } from '../src/literature/retrieval';

export interface SearchQueryPrompt {
  queryId: string;
  topic: string;
  keywords: string[];
  argumentContext: string;
  targetCount: number;
  filters?: {
    yearFrom?: number;
    yearTo?: number;
    journals?: string[];
  };
}

export interface SelectedLiterature {
  id: string;
  rank: number;
  title: string;
  authors: string;
  year: number;
  journal?: string;
  doi?: string;
  abstract: string;
  keywords?: string[];
  embedding?: number[];
  citationId?: number;
  qualityScore: number;
  relevanceScore: number;
  argumentCategory: string;
  argumentDescription: string;
  citationRecommendation: string;
  combinedScore?: number;
}

export interface CategorizedLiteratures {
  category: string;
  description: string;
  papers: SelectedLiterature[];
}

export interface SearchAndSelectionResult {
  queryPrompt: SearchQueryPrompt;
  totalFound: number;
  selectedCount: number;
  categories: CategorizedLiteratures[];
  qualityMetrics: {
    avgQualityScore: number;
    avgRelevanceScore: number;
    avgCitations: number;
    yearRange: { min: number; max: number };
  };
  contextForPrimaryAgent: string;
}

export class LiteratureSearchAgent {
  private apiClient: APIClient;
  private model: string;
  private retrievalEngine: HybridRetrievalEngine;

  constructor(
    apiClient: APIClient,
    retrievalEngine: HybridRetrievalEngine,
    model: string = 'gpt-4o'
  ) {
    this.apiClient = apiClient;
    this.retrievalEngine = retrievalEngine;
    this.model = model;
  }

  async executeSearchPipeline(
    queryPrompt: SearchQueryPrompt
  ): Promise<SearchAndSelectionResult> {
    const startTime = Date.now();
    logger.info(`[LiteratureSearchAgent] 开始检索: ${queryPrompt.topic}`);

    const searchResult = await this.retrievalEngine.retrieve({
      query: `${queryPrompt.topic} ${queryPrompt.keywords.join(' ')}`,
      filters: queryPrompt.filters ? {
        yearFrom: queryPrompt.filters.yearFrom,
        yearTo: queryPrompt.filters.yearTo,
        journals: queryPrompt.filters.journals,
      } : undefined,
      topK: 20,
      searchMode: 'hybrid',
    });

    logger.info(`[LiteratureSearchAgent] 检索到 ${searchResult.results.length} 篇文献`);

    const selectedPapers = await this.selectHighQualityPapers(
      searchResult.results,
      queryPrompt.argumentContext,
      queryPrompt.targetCount
    );

    logger.info(`[LiteratureSearchAgent] 筛选出 ${selectedPapers.length} 篇高质量文献`);

    const categorized = await this.categorizeByArgument(
      selectedPapers,
      queryPrompt.argumentContext
    );

    const contextForPrimaryAgent = this.buildContextForPrimaryAgent(
      queryPrompt,
      categorized
    );

    const totalTime = Date.now() - startTime;
    logger.info(`[LiteratureSearchAgent] 检索流程完成，耗时 ${totalTime}ms`);

    const qualityMetrics = this.calculateQualityMetrics(selectedPapers);

    return {
      queryPrompt,
      totalFound: searchResult.results.length,
      selectedCount: selectedPapers.length,
      categories: categorized,
      qualityMetrics,
      contextForPrimaryAgent,
    };
  }

  private async selectHighQualityPapers(
    searchResults: RetrievedDocument[],
    argumentContext: string,
    targetCount: number
  ): Promise<SelectedLiterature[]> {
    if (searchResults.length === 0) {
      return [];
    }

    const selectionPrompt = this.buildSelectionPrompt(
      searchResults,
      argumentContext,
      targetCount
    );

    const aiResponse = await this.apiClient.chat({
      model: this.model,
      messages: [{ role: 'user', content: selectionPrompt }],
      temperature: 0.3,
      maxTokens: 4000,
    });

    const selected = this.parseSelectionResponse(aiResponse, searchResults);
    
    if (selected.length === 0) {
      return this.fallbackSelection(searchResults, targetCount);
    }

    return selected;
  }

  private buildSelectionPrompt(
    searchResults: RetrievedDocument[],
    argumentContext: string,
    targetCount: number
  ): string {
    const papersList = searchResults.map((p, i) => ({
      index: i + 1,
      title: p.title,
      authors: p.author,
      year: p.year,
      journal: p.journal || '未知',
      keywords: p.keywords || [],
      combinedScore: p.combinedScore?.toFixed(3) || 'N/A',
      abstractPreview: p.abstract.slice(0, 500) + (p.abstract.length > 500 ? '...' : ''),
    }));

    return `你是文献筛选专家（小牛马）。从检索结果中筛选出 ${targetCount} 篇最相关、最高质量的文献。

## 论点背景
${argumentContext}

## 检索到的文献（共 ${searchResults.length} 篇，已按相关度排序）
${JSON.stringify(papersList, null, 2)}

## 筛选标准
1. 相关度：摘要内容与论点背景高度相关
2. 时效性：优先选择近年文献（2020年后）
3. 完整性：摘要必须完整且有意义
4. 权威性：优先选择知名期刊

## 输出要求
输出 JSON 格式：
{
  "selected": [
    {
      "index": 1,
      "qualityScore": 85,
      "relevanceScore": 90,
      "reason": "筛选理由"
    }
  ],
  "argumentCategories": [
    {
      "name": "论点类别",
      "papers": [1, 2]
    }
  ]
}

只输出 JSON。`;
  }

  private parseSelectionResponse(
    response: string,
    searchResults: RetrievedDocument[]
  ): SelectedLiterature[] {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return [];

      const parsed = JSON.parse(jsonMatch[0]);
      const selected: SelectedLiterature[] = [];

      for (const item of parsed.selected || []) {
        const paper = searchResults[item.index - 1];
        if (!paper) continue;

        selected.push({
          id: paper.id,
          rank: selected.length + 1,
          title: paper.title,
          authors: paper.author,
          year: paper.year,
          journal: paper.journal,
          doi: paper.doi,
          abstract: paper.abstract,
          keywords: paper.keywords,
          embedding: paper.embedding,
          citationId: paper.citationId,
          qualityScore: item.qualityScore || Math.round((paper.combinedScore || 0.5) * 100),
          relevanceScore: item.relevanceScore || Math.round((paper.combinedScore || 0.5) * 100),
          argumentCategory: '',
          argumentDescription: item.reason || '',
          citationRecommendation: '',
          combinedScore: paper.combinedScore,
        });
      }

      return selected;
    } catch (error) {
      logger.error('[LiteratureSearchAgent] 解析筛选响应失败', error);
      return [];
    }
  }

  private fallbackSelection(
    searchResults: RetrievedDocument[],
    targetCount: number
  ): SelectedLiterature[] {
    return searchResults.slice(0, targetCount).map((paper, i) => ({
      id: paper.id,
      rank: i + 1,
      title: paper.title,
      authors: paper.author,
      year: paper.year,
      journal: paper.journal,
      doi: paper.doi,
      abstract: paper.abstract,
      keywords: paper.keywords,
      embedding: paper.embedding,
      citationId: paper.citationId,
      qualityScore: Math.round((paper.combinedScore || 0.5) * 100),
      relevanceScore: Math.round((paper.combinedScore || 0.5) * 100),
      argumentCategory: '',
      argumentDescription: `相关度评分: ${(paper.combinedScore || 0).toFixed(3)}`,
      citationRecommendation: '',
      combinedScore: paper.combinedScore,
    }));
  }

  private async categorizeByArgument(
    selectedPapers: SelectedLiterature[],
    argumentContext: string
  ): Promise<CategorizedLiteratures[]> {
    if (selectedPapers.length === 0) {
      return [];
    }

    const categorizePrompt = `根据论点背景，将筛选出的文献按论点分类。

## 论点背景
${argumentContext}

## 筛选出的文献
${selectedPapers.map(p => `
文献 ${p.rank}: ${p.title}
作者: ${p.authors}
年份: ${p.year}
摘要: ${p.abstract}
`).join('\n')}

## 输出格式
{
  "categories": [
    {
      "name": "论点类别",
      "description": "论点描述",
      "papers": [1, 2],
      "citationRecommendation": "引用建议"
    }
  ]
}

只输出 JSON。`;

    const aiResponse = await this.apiClient.chat({
      model: this.model,
      messages: [{ role: 'user', content: categorizePrompt }],
      temperature: 0.3,
      maxTokens: 2000,
    });

    try {
      const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return [{
          category: '主要论点',
          description: argumentContext,
          papers: selectedPapers,
        }];
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const categories: CategorizedLiteratures[] = [];

      for (const cat of parsed.categories || []) {
        const papers = cat.papers
          .map((idx: number) => selectedPapers.find(p => p.rank === idx))
          .filter(Boolean) as SelectedLiterature[];

        papers.forEach(p => {
          p.argumentCategory = cat.name;
          p.citationRecommendation = cat.citationRecommendation;
        });

        categories.push({
          category: cat.name,
          description: cat.description,
          papers,
        });
      }

      return categories;
    } catch (error) {
      logger.error('[LiteratureSearchAgent] 分类解析失败', error);
      return [{
        category: '主要论点',
        description: argumentContext,
        papers: selectedPapers,
      }];
    }
  }

  private buildContextForPrimaryAgent(
    queryPrompt: SearchQueryPrompt,
    categories: CategorizedLiteratures[]
  ): string {
    let context = `## 文献检索筛选结果（小牛马完成）\n\n`;
    context += `检索主题: ${queryPrompt.topic}\n`;
    context += `关键词: ${queryPrompt.keywords.join(', ')}\n`;
    context += `筛选数量: ${categories.reduce((sum, c) => sum + c.papers.length, 0)} 篇高质量文献\n\n`;

    for (const category of categories) {
      context += `### 论点: ${category.category}\n`;
      context += `${category.description}\n\n`;

      for (const paper of category.papers) {
        context += `#### 文献 ${paper.rank}: ${paper.title}\n`;
        context += `- **作者**: ${paper.authors}\n`;
        context += `- **年份**: ${paper.year}\n`;
        context += `- **期刊**: ${paper.journal || '未知'}\n`;
        context += `- **DOI**: ${paper.doi || '无'}\n`;
        if (paper.keywords && paper.keywords.length > 0) {
          context += `- **关键词**: ${paper.keywords.join(', ')}\n`;
        }
        context += `- **相关度**: ${((paper.combinedScore || 0) * 100).toFixed(1)}%\n\n`;
        
        context += `**完整摘要**:\n${paper.abstract}\n\n`;
        
        context += `**引用建议**: ${paper.citationRecommendation || '直接引用支撑该论点'}\n\n`;
        context += `---\n\n`;
      }
    }

    context += `## 引用约束\n`;
    context += `1. 只能引用上述筛选出的文献\n`;
    context += `2. 引用格式: (作者, 年份)\n`;
    context += `3. 每个论点至少1篇文献支撑\n`;
    context += `4. 重要观点需要2-3篇文献佐证\n`;
    context += `5. 禁止编造未提供的文献\n\n`;

    return context;
  }

  private calculateQualityMetrics(papers: SelectedLiterature[]): {
    avgQualityScore: number;
    avgRelevanceScore: number;
    avgCitations: number;
    yearRange: { min: number; max: number };
  } {
    if (papers.length === 0) {
      return {
        avgQualityScore: 0,
        avgRelevanceScore: 0,
        avgCitations: 0,
        yearRange: { min: 0, max: 0 },
      };
    }

    const avgQuality = papers.reduce((s, p) => s + p.qualityScore, 0) / papers.length;
    const avgRelevance = papers.reduce((s, p) => s + p.relevanceScore, 0) / papers.length;
    const years = papers.map(p => p.year);

    return {
      avgQualityScore: Math.round(avgQuality),
      avgRelevanceScore: Math.round(avgRelevance),
      avgCitations: 0,
      yearRange: {
        min: Math.min(...years),
        max: Math.max(...years),
      },
    };
  }
}

export default LiteratureSearchAgent;
