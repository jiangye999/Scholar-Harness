import { logger } from '../src/utils/logger';
import type { APIClient } from '../src/types';
import type { RetrievedDocument } from '../src/types/literature';
import { HybridRetrievalEngine } from '../src/literature/retrieval';

export interface CowSentensePoint {
  sentence: string;
  keywords: string[];
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
  qualityScore: number;
  relevanceScore: number;
  combinedScore?: number;
}

export interface ArgumentLiteratureResult {
  sentence: string;
  keywords: string[];
  totalFound: number;
  selectedPapers: SelectedLiterature[];
}

export interface CowAgentResult {
  totalSentences: number;
  results: ArgumentLiteratureResult[];
  contextForLLM: string;
}

export class CowAgent {
  private apiClient: APIClient;
  private retrievalEngine: HybridRetrievalEngine;
  private model: string;

  constructor(
    apiClient: APIClient,
    retrievalEngine: HybridRetrievalEngine,
    model: string = 'gpt-4o'
  ) {
    this.apiClient = apiClient;
    this.retrievalEngine = retrievalEngine;
    this.model = model;
  }

  async execute(
    sentences: CowSentensePoint[]
  ): Promise<CowAgentResult> {
    const startTime = Date.now();
    logger.info(`[CowAgent] 执行检索流程，共 ${sentences.length} 个句子`);

    const results = await Promise.all(
      sentences.map(point => this.searchSentence(point))
    );

    const contextForLLM = this.buildContext(results);

    const totalTime = Date.now() - startTime;
    logger.info(`[CowAgent] 完成，耗时 ${totalTime}ms`);

    return {
      totalSentences: results.length,
      results,
      contextForLLM,
    };
  }

  private async searchSentence(
    point: CowSentensePoint
  ): Promise<ArgumentLiteratureResult> {
    logger.info(`[CowAgent] 检索句子：${point.sentence}`);

    const query = point.keywords.join(' ');
    const searchResult = await this.retrievalEngine.retrieve({
      query,
      topK: 20,
      searchMode: 'hybrid',
    });

    logger.info(`[CowAgent] 检索到 ${searchResult.results.length} 篇文献`);

    const selectedPapers = await this.selectPapers(
      searchResult.results,
      point.sentence,
      4
    );

    return {
      sentence: point.sentence,
      keywords: point.keywords,
      totalFound: searchResult.results.length,
      selectedPapers,
    };
  }

  private async selectPapers(
    searchResults: RetrievedDocument[],
    sentence: string,
    targetCount: number
  ): Promise<SelectedLiterature[]> {
    if (searchResults.length === 0) return [];

    const prompt = `筛选文献支撑以下论点：

论点：${sentence}

检索到的文献（${searchResults.length} 篇）:
${searchResults.slice(0, 15).map((p, i) => 
`[${i + 1}] ${p.title}
作者：${p.author}
年份：${p.year}
期刊：${p.journal || '未知'}
相关度：${(p.combinedScore || 0).toFixed(3)}
摘要：${p.abstract}`
).join('\n\n')}

筛选标准:
1. 摘要直接支撑该论点
2. 优先 2020 年后文献
3. 优先知名期刊

JSON 输出:
{
  "selected": [
    {"index": 1, "qualityScore": 85, "relevanceScore": 90}
  ]
}`;

    try {
      const response = await this.apiClient.chat({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        maxTokens: 2000,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
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
            qualityScore: item.qualityScore || Math.round((paper.combinedScore || 0.5) * 100),
            relevanceScore: item.relevanceScore || Math.round((paper.combinedScore || 0.5) * 100),
            combinedScore: paper.combinedScore,
          });
        }

        if (selected.length > 0) return selected;
      }
    } catch (error) {
      logger.error('[CowAgent] AI 筛选失败，使用 fallback', error);
    }

    return searchResults.slice(0, targetCount).map((p, i) => ({
      id: p.id,
      rank: i + 1,
      title: p.title,
      authors: p.author,
      year: p.year,
      journal: p.journal,
      doi: p.doi,
      abstract: p.abstract,
      qualityScore: Math.round((p.combinedScore || 0.5) * 100),
      relevanceScore: Math.round((p.combinedScore || 0.5) * 100),
      combinedScore: p.combinedScore,
    }));
  }

  private buildContext(results: ArgumentLiteratureResult[]): string {
    let ctx = '\n\n## 文献检索结果 (代码自动检索)\n\n';
    ctx += `检索句子数：${results.length}\n\n`;

    for (const result of results) {
      ctx += `---\n`;
      ctx += `论点：${result.sentence}\n`;
      ctx += `检索词：${result.keywords.join(', ')}\n`;
      ctx += `检索到 ${result.totalFound} 篇，筛选 ${result.selectedPapers.length} 篇\n\n`;

      for (const paper of result.selectedPapers) {
        ctx += `【文献${paper.rank}】${paper.title}\n`;
        ctx += `作者：${paper.authors}\n`;
        ctx += `年份：${paper.year}\n`;
        ctx += `期刊：${paper.journal || '未知'}\n`;
        ctx += `DOI: ${paper.doi || '无'}\n`;
        ctx += `相关度：${((paper.combinedScore || 0) * 100).toFixed(0)}%\n\n`;
        ctx += `完整摘要:\n${paper.abstract}\n\n`;
      }
      ctx += '\n';
    }

    ctx += `引用规则:\n`;
    ctx += `1. 只能用上述文献\n`;
    ctx += `2. 格式：(作者，年份)\n`;
    ctx += `3. 每论点至少 1 篇引用\n`;
    ctx += `4. 禁止编造文献\n\n`;

    return ctx;
  }
}
