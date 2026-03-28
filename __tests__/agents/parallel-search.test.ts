import { describe, it, expect, beforeAll } from 'vitest';
import { SentenceChunker } from '../../agents/sentence-chunker';
import { ParagraphAgent, LitPaper } from '../../agents/paragraph-agent';
import { ParallelSearchOrchestrator } from '../../agents/parallel-search-orchestrator';
import * as fs from 'fs';
import * as path from 'path';

describe('Parallel Search Architecture', () => {
  let literaturePapers: LitPaper[] = [];
  let chunker: SentenceChunker;

  beforeAll(() => {
    chunker = new SentenceChunker();
    
    const litFile = path.join(process.cwd(), 'data/uploads/web-user/literature.json');
    if (fs.existsSync(litFile)) {
      const data = fs.readFileSync(litFile, 'utf-8');
      literaturePapers = JSON.parse(data);
      console.log(`Loaded ${literaturePapers.length} papers for testing`);
    } else {
      console.warn('Literature file not found, using mock data');
      literaturePapers = [
        {
          citationId: 1,
          title: 'Heavy rainfall stimulates more N2O emissions from wheat',
          author: 'Wang, J; Liu, Q',
          journal: 'AGRICULTURE ECOSYSTEMS & ENVIRONMENT',
          year: '2024',
          abstract: 'Extreme precipitation events have become increasingly prevalent globally...',
          keywords: 'Rainfall, Nitrous oxide, Nitrogen',
        },
        {
          citationId: 2,
          title: 'Soil N2O emissions under different fertilization regimes',
          author: 'Zhang, L; Li, M',
          journal: 'SOIL BIOLOGY & BIOCHEMISTRY',
          year: '2023',
          abstract: 'Nitrous oxide emissions from agricultural soils...',
          keywords: 'N2O, fertilizer, soil, emission',
        },
        {
          citationId: 3,
          title: 'Temperature effects on denitrification in paddy fields',
          author: 'Chen, X; Wang, Y',
          journal: 'GEODERMA',
          year: '2022',
          abstract: 'Temperature is a key factor affecting denitrification...',
          keywords: 'temperature, denitrification, paddy soil',
        },
      ];
    }
  });

  describe('SentenceChunker', () => {
    it('should chunk chapter plan into sentences', () => {
      const chapterPlan = {
        writingFocus: '华北平原N2O排放的温度效应',
        keyPoints: [
          '温度升高增加土壤N2O排放',
          '高温促进反硝化作用',
          '温度与湿度交互作用显著',
        ],
      };

      const chunks = chunker.chunkChapter(chapterPlan, 'introduction');

      expect(chunks.length).toBeGreaterThan(0);
      expect(chunks[0]).toHaveProperty('id');
      expect(chunks[0]).toHaveProperty('searchQuery');
      expect(chunks[0]).toHaveProperty('expectedCitations');
      
      console.log(`Generated ${chunks.length} chunks:`);
      chunks.forEach(c => console.log(`  [${c.id}] ${c.searchQuery}`));
    });

    it('should extract proper search keywords', () => {
      const outline = '华北平原小麦种植区的N2O排放特征研究表明，温度是主要影响因素。施肥管理也会显著改变排放通量。';
      
      const chunks = chunker.chunkUserOutline(outline);
      
      expect(chunks.length).toBe(2);
      expect(chunks[0].searchQuery).toContain('华北');
      expect(chunks[0].searchQuery).toContain('N2O');
    });
  });

  describe('ParagraphAgent', () => {
    it('should search for relevant papers for a single sentence', async () => {
      const agent = new ParagraphAgent(
        literaturePapers,
        'https://modelgate.cn/v1',
        '',
        'text-embedding-3-small',
        2
      );

      const result = await agent.searchLocal(1, '华北平原 N2O 排放 温度');

      expect(result).toHaveProperty('sentenceId', 1);
      expect(result).toHaveProperty('papers');
      expect(result).toHaveProperty('searchTime');
      expect(result.papers.length).toBeLessThanOrEqual(2);
      
      console.log(`Found ${result.papers.length} papers in ${result.searchTime}ms`);
      result.papers.forEach((p, i) => {
        console.log(`  [${i + 1}] ${p.paper.title} (score: ${p.score.toFixed(2)})`);
      });
    }, 10000);

    it('should handle empty results gracefully', async () => {
      const agent = new ParagraphAgent(
        literaturePapers,
        'https://modelgate.cn/v1',
        '',
        'text-embedding-3-small',
        2
      );

      const result = await agent.searchLocal(1, 'xyzabc123456789');

      expect(result.papers.length).toBe(0);
    });
  });

  describe('ParallelSearchOrchestrator', () => {
    it('should execute parallel search for multiple sentences', async () => {
      const sentences = [
        { id: 1, content: '温度影响', searchQuery: '温度 N2O 排放', wordCount: 50, expectedCitations: 2 },
        { id: 2, content: '施肥效应', searchQuery: '施肥 土壤 N2O', wordCount: 60, expectedCitations: 2 },
        { id: 3, content: '降雨作用', searchQuery: '降雨 降水 影响', wordCount: 40, expectedCitations: 1 },
      ];

      const orchestrator = new ParallelSearchOrchestrator(
        literaturePapers,
        'https://modelgate.cn/v1',
        '',
        'text-embedding-3-small',
        3
      );

      const result = await orchestrator.executeParallelSearch(sentences);

      expect(result.totalSentences).toBe(3);
      expect(result.results.length).toBe(3);
      expect(result.totalTime).toBeGreaterThan(0);
      
      console.log(`\nParallel search completed in ${result.totalTime}ms`);
      console.log(`Unique papers found: ${result.uniquePapers.size}`);
      
      const context = orchestrator.buildContextForWriting(result);
      expect(context).toContain('文献检索结果汇总');
      expect(context).toContain('可用文献列表');
    }, 30000);
  });

  describe('Integration Test', () => {
    it('should complete full workflow: chunk -> parallel search -> build context', async () => {
      const chapterPlan = {
        writingFocus: '华北平原农业土壤N2O排放的调控机制',
        keyPoints: [
          '温度升高促进N2O排放',
          '施肥量增加排放通量',
          '土壤湿度影响反硝化',
        ],
      };

      const chunks = chunker.chunkChapter(chapterPlan, 'introduction');
      console.log(`\nChapter chunked into ${chunks.length} sentences`);

      const orchestrator = new ParallelSearchOrchestrator(
        literaturePapers,
        'https://modelgate.cn/v1',
        '',
        'text-embedding-3-small',
        5
      );

      const searchResult = await orchestrator.executeParallelSearch(chunks);
      console.log(`Search completed in ${searchResult.totalTime}ms`);

      const context = orchestrator.buildContextForWriting(searchResult);
      
      expect(context.length).toBeGreaterThan(100);
      expect(context).toContain('可用文献列表');
      expect(context).toContain('引用约束');
      
      console.log('\n=== Generated Context Preview ===');
      console.log(context.substring(0, 800) + '...');
    }, 60000);
  });
});
