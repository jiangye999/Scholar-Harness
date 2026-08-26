import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { DailyPaperManager } from '../../../src/server/services/daily-paper-manager';

const temporaryDirectories: string[] = [];

async function temporaryDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-daily-papers-'));
  temporaryDirectories.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

function hfPayload() {
  return [{
    paper: {
      id: '2608.10001',
      title: 'Soil microbial necromass controls persistent carbon',
      summary: 'We quantify microbial necromass contributions to persistent soil organic carbon.',
      publishedAt: '2026-08-18T00:00:00Z',
      upvotes: 12,
      authors: [{ name: 'A. Researcher' }],
    },
  }];
}

function arxivPayload() {
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
    <entry>
      <id>https://arxiv.org/abs/2608.10002v1</id>
      <published>2026-08-18T01:00:00Z</published>
      <title>Benchmarking soil carbon models across ecosystems</title>
      <summary>A benchmark of soil carbon models with cross-ecosystem evaluation.</summary>
      <author><name>B. Scientist</name></author>
      <arxiv:primary_category term="cs.LG"/>
    </entry>
  </feed>`;
}

describe('DailyPaperManager', () => {
  it('runs the source, triage and must-read note pipeline and persists one daily result', async () => {
    const dataDir = await temporaryDataDir();
    const now = new Date(2026, 7, 18, 10, 30, 0);
    const fetchImpl: typeof fetch = async input => {
      const url = String(input);
      if (url.includes('huggingface.co/api/daily_papers')) {
        return new Response(JSON.stringify(hfPayload()), { status: 200 });
      }
      if (url.includes('export.arxiv.org/api/query')) {
        return new Response(arxivPayload(), { status: 200 });
      }
      if (url.includes('arxiv.org/html/2608.10001')) {
        return new Response(`<article>${'<p>Full text evidence about microbial necromass and soil carbon experiments.</p>'.repeat(100)}</article>`, { status: 200 });
      }
      return new Response('', { status: 404 });
    };
    const manager = new DailyPaperManager({
      dataDir,
      fetchImpl,
      now: () => now,
      generateText: async ({ prompt }) => {
        if (prompt.includes('每日论文筛选器')) {
          return JSON.stringify({
            summary: '今天有一篇与土壤碳高度相关的论文。',
            trend: '微生物残体正在成为土壤碳研究的核心机制变量。',
            recommendations: [
              {
                id: '2608.10001',
                tier: 'must_read',
                abstractZh: '我们量化了微生物残体对持久性土壤有机碳的贡献。',
                reason: '直接量化微生物残体对持久性碳的贡献。',
                relevance: '对应用户的土壤碳研究方向。',
                caution: '需要核验跨土壤类型的外推边界。',
              },
              {
                id: '2608.10002',
                tier: 'worth_reading',
                abstractZh: '本研究对不同生态系统中的土壤碳模型进行了基准测试。',
                reason: '提供模型基准。',
                relevance: '可用于方法比较。',
                caution: '需要核验数据覆盖。',
              },
            ],
          });
        }
        return JSON.stringify({
          overview: '论文研究微生物残体对持久性土壤碳的贡献。',
          problem: '不同来源碳如何形成长期稳定库。',
          method: '结合组分测量与模型分析。',
          experiments: '跨样地比较并报告机制证据。',
          limitations: '长期外推仍需独立验证。',
          takeaways: ['微生物残体是关键碳源。'],
          terms: [{ name: '微生物残体', explanation: '微生物死亡后保留并进入土壤有机质的细胞组分。' }],
        });
      },
    });

    await manager.saveSettings('researcher@example.com', {
      enabled: true,
      researchFields: ['soil carbon', 'microbial necromass'],
      runTime: '08:00',
    });
    const run = await manager.run('researcher@example.com', { force: true });

    expect(run.status).toBe('completed');
    expect(run.recommendations).toHaveLength(2);
    expect(run.recommendations[0].tier).toBe('must_read');
    expect(run.recommendations[0].abstractZh).toContain('微生物残体');
    expect(run.recommendations[0].note?.evidenceLevel).toBe('full-text');
    expect(run.recommendations[0].note?.terms[0].name).toBe('微生物残体');
    expect(run.recommendations[1].note?.evidenceLevel).toBe('abstract');
    expect(await manager.getRun('researcher@example.com', '2026-08-18')).toMatchObject({ id: run.id });
    expect((await manager.getRecommendation('researcher@example.com', '2608.10001'))?.title)
      .toContain('microbial necromass');
    const libraryState = await manager.saveLibraryState('researcher@example.com', '2608.10001', 'pdf', {
      status: 'queued',
      message: 'PDF 已加入后台识别队列。',
      projectId: 'project-test-1',
      projectName: 'Selected Project',
    });
    expect(libraryState.status).toBe('queued');
    expect((await manager.getRun('researcher@example.com', '2026-08-18'))?.recommendations[0].library?.pdf)
      .toMatchObject({
        status: 'queued',
        message: 'PDF 已加入后台识别队列。',
        projectId: 'project-test-1',
        projectName: 'Selected Project',
      });
    expect(manager.getStatus('researcher@example.com').stage).toBe('completed');
    expect(await manager.runIfDue('researcher@example.com', { trigger: 'scheduled' })).toBeNull();
    const runPath = path.join(dataDir, 'daily-papers', 'researcher@example.com', 'runs', '2026-08-18.json');
    const legacyRun = JSON.parse(await fs.readFile(runPath, 'utf8')) as { recommendations: Array<Record<string, unknown>> };
    delete legacyRun.recommendations[0].abstractZh;
    await fs.writeFile(runPath, JSON.stringify(legacyRun), 'utf8');
    const migrationManager = new DailyPaperManager({
      dataDir,
      now: () => now,
      fetchImpl,
      generateText: async ({ prompt }) => prompt.includes('忠实翻译成简体中文')
        ? JSON.stringify({ translations: [{ id: '2608.10001', abstractZh: '历史摘要已自动翻译并回填。' }] })
        : '{}',
    });
    expect((await migrationManager.getRun('researcher@example.com', '2026-08-18'))?.recommendations[0].abstractZh)
      .toBe('历史摘要已自动翻译并回填。');
    expect(JSON.parse(await fs.readFile(runPath, 'utf8')).recommendations[0].abstractZh)
      .toBe('历史摘要已自动翻译并回填。');
    const restartedManager = new DailyPaperManager({
      dataDir,
      now: () => now,
      fetchImpl,
      generateText: async () => '{}',
    });
    expect((await restartedManager.getStatusSnapshot('researcher@example.com')).stage).toBe('completed');
  });

  it('does not run automatically when disabled or before the configured time', async () => {
    const dataDir = await temporaryDataDir();
    const manager = new DailyPaperManager({
      dataDir,
      now: () => new Date(2026, 7, 18, 7, 30, 0),
      fetchImpl: async () => new Response('[]', { status: 200 }),
      generateText: async () => '{}',
    });
    await manager.saveSettings('web-user', {
      enabled: true,
      researchFields: ['robot learning'],
      runTime: '08:00',
    });
    expect(await manager.runIfDue('web-user', { trigger: 'scheduled' })).toBeNull();
    await manager.saveSettings('web-user', { enabled: false });
    expect(await manager.runIfDue('web-user', { trigger: 'startup', ignoreTime: true })).toBeNull();
  });

  it('uses configured Web of Science discovery and excludes records without abstracts', async () => {
    const dataDir = await temporaryDataDir();
    const wosCalls: Array<Record<string, unknown>> = [];
    const manager = new DailyPaperManager({
      dataDir,
      now: () => new Date(2026, 7, 19, 9, 0, 0),
      fetchWosCandidates: async input => {
        wosCalls.push(input);
        return [{
          id: 'doi:10.1000/wos-daily',
          title: 'Soil carbon persistence in agricultural systems',
          authors: ['Alice Researcher'],
          abstract: 'We quantify persistent soil carbon across agricultural systems.',
          publishedAt: '2026-08-19',
          url: 'https://www.webofscience.com/wos/woscc/full-record/WOS%3ATEST',
          pdfUrl: '',
          category: 'Soil Science',
          sources: ['wos-expanded'],
          hfUpvotes: 0,
          score: 0,
          doi: '10.1000/wos-daily',
        }, {
          id: 'wos:no-abstract',
          title: 'Soil carbon title only',
          authors: ['Bob Researcher'],
          abstract: '',
          publishedAt: '2026-08-19',
          url: 'https://www.webofscience.com/',
          pdfUrl: '',
          category: 'Soil Science',
          sources: ['wos-starter'],
          hfUpvotes: 0,
          score: 0,
        }];
      },
      generateText: async ({ prompt }) => prompt.includes('每日论文筛选器')
        ? JSON.stringify({
            summary: 'WoS 找到一篇相关论文。',
            trend: '土壤碳持久性仍是重点。',
            recommendations: [{
              id: 'doi:10.1000/wos-daily',
              tier: 'worth_reading',
              abstractZh: '我们量化了农业系统中的持久性土壤碳。',
              reason: '直接匹配研究方向。',
              relevance: '涉及土壤碳持久性。',
              caution: '需核验原文。',
            }],
          })
        : '{}',
    });
    await manager.saveSettings('wos-user', {
      researchFields: ['soil carbon'],
      expandQueries: false,
      minScore: 1,
      sources: {
        wos: true,
        hfDaily: false,
        hfTrending: false,
        arxiv: false,
        openAlex: false,
        europePmc: false,
        semanticScholar: false,
      },
    });

    const run = await manager.run('wos-user', { force: true });

    expect(wosCalls).toHaveLength(1);
    expect(wosCalls[0]).toMatchObject({ userId: 'wos-user', days: 1 });
    expect(run.candidateCount).toBe(1);
    expect(run.recommendations).toHaveLength(1);
    expect(run.recommendations[0].sources).toContain('wos-expanded');
    expect(run.recommendations[0].abstractZh).toContain('农业系统');
  });

  it('does not force a must-read paper and learns from explicit relevance feedback', async () => {
    const dataDir = await temporaryDataDir();
    const manager = new DailyPaperManager({
      dataDir,
      now: () => new Date(2026, 7, 18, 11, 0, 0),
      fetchImpl: async input => String(input).includes('huggingface.co/api/daily_papers')
        ? new Response(JSON.stringify(hfPayload()), { status: 200 })
        : new Response('', { status: 404 }),
      generateText: async ({ prompt }) => prompt.includes('每日论文筛选器')
        ? JSON.stringify({
            summary: '找到一篇相关论文。',
            trend: '土壤碳机制研究持续推进。',
            recommendations: [{
              id: '2608.10001',
              tier: 'worth_reading',
              abstractZh: '微生物残体控制持久性土壤碳。',
              reason: '主题相关，但不是今天必须精读。',
              relevance: '涉及土壤碳。',
              caution: '需核验全文。',
            }],
          })
        : '{}',
    });
    await manager.saveSettings('feedback-user', {
      researchFields: ['soil carbon'],
      expandQueries: false,
      minScore: 2,
      sources: {
        hfDaily: true,
        hfTrending: false,
        arxiv: false,
        openAlex: false,
        europePmc: false,
        semanticScholar: false,
      },
    });

    const firstRun = await manager.run('feedback-user', { force: true });
    expect(firstRun.recommendations).toHaveLength(1);
    expect(firstRun.recommendations.some(item => item.tier === 'must_read')).toBe(false);

    const feedback = await manager.saveFeedback('feedback-user', '2608.10001', 'not_relevant');
    expect(feedback.decision).toBe('not_relevant');
    expect((await manager.getRun('feedback-user', '2026-08-18'))?.recommendations[0].feedback).toBe('not_relevant');

    const secondRun = await manager.run('feedback-user', { force: true });
    expect(secondRun.recommendations).toHaveLength(0);
    expect(secondRun.summary).toContain('没有发现达到当前相关性门槛');
  });

  it('excludes zero-score candidates instead of filling the recommendation quota', async () => {
    const dataDir = await temporaryDataDir();
    let reviewCalls = 0;
    const manager = new DailyPaperManager({
      dataDir,
      now: () => new Date(2026, 7, 18, 11, 0, 0),
      fetchImpl: async () => new Response(JSON.stringify(hfPayload()), { status: 200 }),
      generateText: async ({ prompt }) => {
        if (prompt.includes('每日论文筛选器')) reviewCalls += 1;
        return '{}';
      },
    });
    await manager.saveSettings('threshold-user', {
      researchFields: ['quantum optics'],
      expandQueries: false,
      minScore: 2,
      sources: {
        hfDaily: true,
        hfTrending: false,
        arxiv: false,
        openAlex: false,
        europePmc: false,
        semanticScholar: false,
      },
    });

    const run = await manager.run('threshold-user', { force: true });
    expect(run.candidateCount).toBe(0);
    expect(run.recommendations).toHaveLength(0);
    expect(reviewCalls).toBe(0);
  });

  it('sorts recommendations by relevance and creates reading notes for only the top four', async () => {
    const dataDir = await temporaryDataDir();
    const candidates = [
      ['doi:10.1000/rank-1', 'Soil carbon microbial model integration', 'Direct evidence on soil carbon.'],
      ['doi:10.1000/rank-2', 'Soil carbon microbial processes', 'Microbial evidence.'],
      ['doi:10.1000/rank-3', 'Soil carbon model comparison', 'Model evidence.'],
      ['doi:10.1000/rank-4', 'Soil carbon persistence', 'Persistence evidence.'],
      ['doi:10.1000/rank-5', 'Agricultural management practices', 'Effects on soil carbon are evaluated.'],
    ].map(([id, title, abstract]) => ({
      id,
      title,
      authors: ['Ranking Author'],
      abstract,
      publishedAt: '2026-08-25',
      url: `https://example.test/${id}`,
      pdfUrl: '',
      category: 'Soil Science',
      sources: ['wos-expanded'],
      hfUpvotes: 0,
      score: 0,
      doi: id.replace(/^doi:/, ''),
    }));
    let noteCalls = 0;
    const manager = new DailyPaperManager({
      dataDir,
      now: () => new Date(2026, 7, 25, 10, 0, 0),
      fetchWosCandidates: async () => candidates,
      generateText: async ({ prompt }) => {
        if (prompt.includes('每日论文筛选器')) {
          return JSON.stringify({
            summary: '已按相关性筛选。',
            trend: '土壤碳机制与模型受到关注。',
            recommendations: candidates.map(item => ({
              id: item.id,
              tier: 'worth_reading',
              abstractZh: `中文摘要：${item.title}`,
              reason: '与研究方向相关。',
              relevance: '匹配土壤碳研究。',
              caution: '需要核验全文。',
            })),
          });
        }
        if (prompt.includes('只依据下方材料生成中文论文精读笔记')) noteCalls += 1;
        return JSON.stringify({
          overview: '论文概览。',
          problem: '研究问题。',
          method: '研究方法。',
          experiments: '实验与证据。',
          limitations: '摘要级材料，尚未核验全文。',
          takeaways: ['主要结论。'],
          terms: [{ name: '土壤碳', explanation: '研究对象。' }],
        });
      },
    });
    await manager.saveSettings('ranking-user', {
      researchFields: ['soil carbon', 'microbial', 'model'],
      expandQueries: false,
      minScore: 1,
      sources: {
        wos: true,
        hfDaily: false,
        hfTrending: false,
        arxiv: false,
        openAlex: false,
        europePmc: false,
        semanticScholar: false,
      },
    });

    const run = await manager.run('ranking-user', { force: true });

    expect(run.recommendations).toHaveLength(4);
    expect(run.recommendations.map(item => item.relevanceRank)).toEqual([1, 2, 3, 4]);
    expect(run.recommendations.map(item => item.score)).toEqual(
      [...run.recommendations.map(item => item.score)].sort((left, right) => right - left),
    );
    expect(run.recommendations.map(item => item.id)).not.toContain('doi:10.1000/rank-5');
    expect(run.recommendations.every(item => !!item.note)).toBe(true);
    expect(noteCalls).toBe(4);
  });

  it('merges the same paper returned with different source IDs', async () => {
    const dataDir = await temporaryDataDir();
    const manager = new DailyPaperManager({
      dataDir,
      now: () => new Date(2026, 7, 25, 10, 0, 0),
      fetchWosCandidates: async () => [{
        id: 'openalex:w123',
        title: 'Soil carbon persistence across ecosystems',
        authors: ['Duplicate Author'],
        abstract: 'Short soil carbon abstract.',
        publishedAt: '2026-08-25',
        url: 'https://openalex.org/W123',
        pdfUrl: '',
        category: 'Soil Science',
        sources: ['openalex'],
        hfUpvotes: 0,
        score: 0,
      }, {
        id: 'doi:10.1000/shared-paper',
        title: 'Soil Carbon Persistence Across Ecosystems',
        authors: ['Duplicate Author', 'Second Author'],
        abstract: 'A longer soil carbon abstract with additional methodological detail.',
        publishedAt: '2026-08-25',
        url: 'https://doi.org/10.1000/shared-paper',
        pdfUrl: 'https://example.test/shared-paper.pdf',
        category: 'Soil Science',
        sources: ['wos-expanded'],
        hfUpvotes: 0,
        score: 0,
        doi: 'https://doi.org/10.1000/shared-paper',
      }],
      generateText: async ({ prompt }) => prompt.includes('每日论文筛选器')
        ? JSON.stringify({
            summary: '去重后保留一篇论文。',
            trend: '土壤碳持续受到关注。',
            recommendations: [{
              id: 'doi:10.1000/shared-paper',
              tier: 'worth_reading',
              abstractZh: '跨生态系统的土壤碳持久性。',
              reason: '高度相关。',
              relevance: '匹配土壤碳方向。',
              caution: '核验全文。',
            }],
          })
        : JSON.stringify({
            overview: '论文概览。', problem: '研究问题。', method: '研究方法。',
            experiments: '实验与证据。', limitations: '需要核验全文。', takeaways: [], terms: [],
          }),
    });
    await manager.saveSettings('dedupe-user', {
      researchFields: ['soil carbon'],
      expandQueries: false,
      minScore: 1,
      sources: {
        wos: true,
        hfDaily: false,
        hfTrending: false,
        arxiv: false,
        openAlex: false,
        europePmc: false,
        semanticScholar: false,
      },
    });

    const run = await manager.run('dedupe-user', { force: true });

    expect(run.candidateCount).toBe(1);
    expect(run.recommendations).toHaveLength(1);
    expect(run.recommendations[0]).toMatchObject({
      id: 'doi:10.1000/shared-paper',
      doi: '10.1000/shared-paper',
      pdfUrl: 'https://example.test/shared-paper.pdf',
    });
    expect(run.recommendations[0].sources).toEqual(expect.arrayContaining(['openalex', 'wos-expanded']));
    expect(run.recommendations[0].abstract).toContain('additional methodological detail');
  });

  it('does not recommend a title variant that appeared in the previous 90 days', async () => {
    const dataDir = await temporaryDataDir();
    let now = new Date(2026, 7, 24, 10, 0, 0);
    let fetchCount = 0;
    let reviewCalls = 0;
    const manager = new DailyPaperManager({
      dataDir,
      now: () => now,
      fetchWosCandidates: async () => {
        fetchCount += 1;
        return [{
          id: fetchCount === 1 ? 'openalex:history-a' : 'wos:history-b',
          title: fetchCount === 1
            ? 'Soil Carbon Dynamics: A Global Synthesis'
            : 'SOIL-CARBON DYNAMICS — A GLOBAL SYNTHESIS (Preprint v2)',
          authors: ['History Author'],
          abstract: 'A synthesis of soil carbon dynamics across ecosystems.',
          publishedAt: now.toISOString().slice(0, 10),
          url: 'https://example.test/history-paper',
          pdfUrl: '',
          category: 'Soil Science',
          sources: [fetchCount === 1 ? 'openalex' : 'wos-expanded'],
          hfUpvotes: 0,
          score: 0,
        }];
      },
      generateText: async ({ prompt }) => {
        if (prompt.includes('每日论文筛选器')) {
          reviewCalls += 1;
          const id = fetchCount === 1 ? 'openalex:history-a' : 'wos:history-b';
          return JSON.stringify({
            summary: '找到一篇相关论文。',
            trend: '土壤碳研究持续推进。',
            recommendations: [{
              id,
              tier: 'worth_reading',
              abstractZh: '土壤碳动态综述。',
              reason: '高度相关。',
              relevance: '匹配研究方向。',
              caution: '核验全文。',
            }],
          });
        }
        return JSON.stringify({
          overview: '论文概览。', problem: '研究问题。', method: '研究方法。',
          experiments: '实验与证据。', limitations: '需要核验全文。', takeaways: [], terms: [],
        });
      },
    });
    await manager.saveSettings('history-dedupe-user', {
      researchFields: ['soil carbon'],
      expandQueries: false,
      minScore: 1,
      sources: {
        wos: true,
        hfDaily: false,
        hfTrending: false,
        arxiv: false,
        openAlex: false,
        europePmc: false,
        semanticScholar: false,
      },
    });

    const firstRun = await manager.run('history-dedupe-user', { force: true });
    now = new Date(2026, 7, 25, 10, 0, 0);
    const secondRun = await manager.run('history-dedupe-user', { force: true });

    expect(firstRun.recommendations).toHaveLength(1);
    expect(secondRun.candidateCount).toBe(1);
    expect(secondRun.recommendations).toHaveLength(0);
    expect(reviewCalls).toBe(1);
  });
});
