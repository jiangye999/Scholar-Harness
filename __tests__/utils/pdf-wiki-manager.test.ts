import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    async getText(): Promise<{ text: string }> {
      return { text: 'mock pdf text' };
    }

    async destroy(): Promise<void> {
      return undefined;
    }
  },
}));

function createStoreEntry(id: string, claim: string): any {
  return {
    id,
    groupId: `group-${id}`,
    claim,
    normalizedClaim: claim,
    sourcePdfIds: [`pdf-${id}`],
    sourcePdfNames: [`source-${id}.pdf`],
    sections: ['Discussion'],
    pro: [{
      stance: 'support',
      summary: `${claim} support`,
      evidence: `${claim} evidence`,
      section: 'Discussion',
      location: 'chunk-1',
      inTextCitations: [],
      references: [{
        id: `ref-${id}`,
        raw: `${claim} reference`,
        title: `${claim} reference`,
      }],
      sourcePdfId: `pdf-${id}`,
      sourcePdfName: `source-${id}.pdf`,
    }],
    con: [],
    neutral: [],
    inTextCitations: [],
    references: [{
      id: `ref-${id}`,
      raw: `${claim} reference`,
      title: `${claim} reference`,
    }],
    evidenceSnippets: [`${claim} evidence`],
    updatedAt: new Date().toISOString(),
  };
}

function createSentencePoint(id: string, topicKey: string, sourcePdfId: string): any {
  return {
    id,
    sourcePdfId,
    sourcePdfName: `${sourcePdfId}.pdf`,
    sourcePdfTitle: `Source ${sourcePdfId}`,
    section: 'Discussion',
    sentenceIndex: 1,
    sentence: `This is a sufficiently detailed source sentence for ${id} and its evidence relationship.`,
    citations: ['[1]'],
    references: [{
      id: `ref-${id}`,
      raw: `Reference for ${id}`,
      index: 1,
      matchType: 'citation',
    }],
    referenceCount: 1,
    claimCandidate: true,
    claimText: `Claim represented by ${id}`,
    claimType: 'argument',
    claimReason: 'Test claim candidate',
    topicKey,
    topicLabel: `Topic ${topicKey}`,
    keywords: [topicKey],
    x: 50,
    y: 50,
    radius: 12,
    matchMethod: 'citation',
    confidence: 0.9,
  };
}

function writeWikiStore(tempDir: string, userId: string, entries: any[], sentencePoints: any[] = []): void {
  const wikiDir = path.join(tempDir, 'uploads', userId, 'pdf-wiki');
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'wiki.json'), JSON.stringify({
    version: 1,
    userId,
    generatedAt: new Date().toISOString(),
    pdfs: [],
    referenceIndex: [],
    entries,
    sentenceCloud: {
      generatedAt: new Date().toISOString(),
      points: sentencePoints,
      clouds: [],
    },
  }, null, 2), 'utf-8');
}

async function waitForCondition(check: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (!(await check())) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('Timed out waiting for condition');
    await new Promise(resolve => setTimeout(resolve, 15));
  }
}

function mockQwenDirectPdfResponses(claim: string): Array<any> {
  return [{
    ok: true,
    json: async () => ({ id: `file-${claim.toLowerCase().replace(/\s+/g, '-')}` }),
  }, {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: [
            'PDF_METADATA',
            'Title: Direct PDF Title',
            'Authors: Jane Smith',
            'Year: 2025',
            'Journal: Global Change Biology',
            'DOI: 10.1000/direct',
            '',
            'REFERENCES_RAW',
            '1. Doe J. 2020. Carbon availability controls N2O. Soil Biology. doi:10.1000/ref',
          ].join('\n'),
        },
      }],
    }),
  }, {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: [
            'CLAIM 1',
            `Claim: ${claim}`,
            'Section: Discussion',
            'Location: page 5',
            'Support views:',
            `- Summary: ${claim} support`,
            `  Evidence: ${claim} evidence (Doe et al., 2020).`,
            '  In-text citations: Doe et al., 2020',
          ].join('\n'),
        },
      }],
    }),
  }, {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            claims: [{
              claim,
              section: 'Discussion',
              location: 'page 5',
              proViews: [{
                summary: `${claim} support`,
                evidence: `${claim} evidence (Doe et al., 2020).`,
                inTextCitations: ['Doe et al., 2020'],
              }],
              conViews: [],
              neutralViews: [],
              evidence: `${claim} evidence.`,
              inTextCitations: ['Doe et al., 2020'],
            }],
          }),
        },
      }],
    }),
  }, {
    ok: true,
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            claimTranslations: [],
            groups: [],
            similarPairs: [],
          }),
        },
      }],
    }),
  }];
}

describe('PdfWikiManager', () => {
  let tempDir: string;
  let PdfWikiManager: typeof import('../../src/utils/pdf-wiki-manager').PdfWikiManager;
  let manager: import('../../src/utils/pdf-wiki-manager').PdfWikiManager;

  beforeEach(async () => {
    vi.stubEnv('PDF_WIKI_CODEX_ENABLED', 'false');
    ({ PdfWikiManager } = await import('../../src/utils/pdf-wiki-manager'));
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-wiki-manager-'));
    manager = new PdfWikiManager(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns idle status when no wiki exists', async () => {
    const status = await manager.getStatus('web-user');

    expect(status.status).toBe('idle');
    expect(status.entryCount).toBe(0);
  });

  it('reads lightweight status without loading the complete PDF Wiki store', async () => {
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'status.json'), JSON.stringify({
      status: 'completed',
      totalPdfs: 8,
      processedPdfs: 8,
      totalChunks: 0,
      processedChunks: 0,
      entryCount: 20,
      sentencePointCount: 120,
      message: 'completed',
      updatedAt: new Date().toISOString(),
    }), 'utf-8');
    const loadStore = vi.spyOn(manager as any, 'loadStore');

    const status = await manager.getLightweightStatus('web-user');

    expect(status.status).toBe('completed');
    expect(status.totalPdfs).toBe(8);
    expect(loadStore).not.toHaveBeenCalled();
  });

  it('reads the PDF manager snapshot without normalizing or rewriting the complete wiki store', async () => {
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    const wikiPath = path.join(wikiDir, 'wiki.json');
    fs.mkdirSync(wikiDir, { recursive: true });
    const originalContent = JSON.stringify({
      version: 1,
      userId: 'web-user',
      generatedAt: '2026-07-23T00:00:00.000Z',
      pdfs: [{
        id: 'pdf-lightweight',
        originalName: 'lightweight.pdf',
        fileName: 'lightweight.pdf',
        filePath: path.join(wikiDir, 'lightweight.pdf'),
        size: 128,
        title: 'Lightweight PDF',
        authors: 'Author A',
        year: '2026',
        journal: 'Journal A',
        doi: '',
        textLength: 2048,
        referenceIndex: [],
      }],
      referenceIndex: [{ id: 'ref-one', raw: 'Reference one' }],
      entries: [createStoreEntry('entry-one', 'A stored claim')],
      sentenceCloud: {
        generatedAt: '2026-07-23T00:00:00.000Z',
        points: [createSentencePoint('point-one', 'topic-one', 'pdf-lightweight')],
        clouds: [],
      },
    }, null, 2);
    fs.writeFileSync(wikiPath, originalContent, 'utf-8');
    const loadStore = vi.spyOn(manager as any, 'loadStore');
    const saveStore = vi.spyOn(manager as any, 'saveStore');

    const snapshot = await manager.getPdfManagerStoreSnapshot('web-user');

    expect(snapshot.generatedAt).toBe('2026-07-23T00:00:00.000Z');
    expect(snapshot.pdfs).toHaveLength(1);
    expect(snapshot.pdfs[0].id).toBe('pdf-lightweight');
    expect(loadStore).not.toHaveBeenCalled();
    expect(saveStore).not.toHaveBeenCalled();
    expect(fs.readFileSync(wikiPath, 'utf-8')).toBe(originalContent);
  });

  it('reuses an unchanged PDF manager snapshot and invalidates it after wiki.json changes', async () => {
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    const wikiPath = path.join(wikiDir, 'wiki.json');
    fs.mkdirSync(wikiDir, { recursive: true });
    const makeContent = (id: string) => JSON.stringify({
      version: 1,
      userId: 'web-user',
      generatedAt: `2026-07-23T00:00:0${id === 'pdf-one' ? '1' : '2'}.000Z`,
      pdfs: [{
        id,
        originalName: `${id}.pdf`,
        fileName: `${id}.pdf`,
        filePath: path.join(wikiDir, `${id}.pdf`),
        size: 128,
        referenceIndex: [],
      }],
      referenceIndex: [],
      entries: [],
      sentenceCloud: { generatedAt: '', points: [], clouds: [] },
    });
    fs.writeFileSync(wikiPath, makeContent('pdf-one'), 'utf-8');

    const first = await manager.getPdfManagerStoreSnapshot('web-user');
    const cached = await manager.getPdfManagerStoreSnapshot('web-user');
    expect(cached).toBe(first);

    fs.writeFileSync(wikiPath, `${makeContent('pdf-two')}\n`, 'utf-8');
    const refreshed = await manager.getPdfManagerStoreSnapshot('web-user');
    expect(refreshed).not.toBe(first);
    expect(refreshed.pdfs[0].id).toBe('pdf-two');
  });

  it('persists and reuses the lightweight Meta database summary index', async () => {
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'wiki.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      generatedAt: '2026-07-22T00:00:00.000Z',
      pdfs: [{
        id: 'pdf-meta-one',
        originalName: 'meta-one.pdf',
        fileName: 'meta-one.pdf',
        filePath: path.join(wikiDir, 'meta-one.pdf'),
        size: 100,
        title: 'Meta One',
        authors: 'Author A',
        year: '2026',
        journal: 'Journal A',
        doi: '',
        textLength: 1000,
        referenceIndex: [],
        metaData: {
          title: 'Meta One',
          meta_analysis_enabled: true,
          meta_analysis_rows: [{ 'Study#': 'Meta One', Treatment: 'Control' }],
        },
      }],
      referenceIndex: [],
      entries: [],
      sentenceCloud: { generatedAt: '2026-07-22T00:00:00.000Z', points: [], clouds: [] },
      readerChatSessions: {},
    }), 'utf-8');

    const first = await manager.getMetaDatabase('web-user', { includeDetails: false });
    expect(first.items).toHaveLength(1);
    expect(first.items[0].detailLoaded).toBe(false);
    expect(fs.existsSync(path.join(wikiDir, 'meta-database-index.json'))).toBe(true);

    const reloaded = new PdfWikiManager(tempDir);
    const saveUnitRegistry = vi.spyOn(reloaded as any, 'saveMetaAnalysisUnitRegistry');
    const detail = await reloaded.getMetaDatabase('web-user', {
      includeDetails: true,
      pdfIds: ['pdf-meta-one'],
    });
    expect(detail.items).toHaveLength(1);
    expect(saveUnitRegistry).not.toHaveBeenCalled();

    const buildItem = vi.spyOn(reloaded as any, 'buildMetaDatabaseItem');
    const second = await reloaded.getMetaDatabase('web-user', { includeDetails: false });

    expect(second.items).toHaveLength(1);
    expect(buildItem).not.toHaveBeenCalled();
  });

  it('keeps stable work progress across heartbeat status writes', async () => {
    const workProgress = {
      phase: 'codex',
      phaseLabel: '核对引用并归纳结论',
      phaseIndex: 2,
      phaseCount: 3,
      completedUnits: 3,
      totalUnits: 9,
      currentPdfIndex: 2,
      currentPdfName: 'source.pdf',
      attempt: 1,
      maxAttempts: 3,
      attemptElapsedMs: 10_000,
    };
    await (manager as any).saveStatus('web-user', {
      status: 'processing',
      taskKind: 'pdf-wiki',
      totalPdfs: 4,
      processedPdfs: 1,
      failedPdfs: 0,
      totalChunks: 4,
      processedChunks: 1,
      entryCount: 0,
      message: 'Codex heartbeat',
      updatedAt: new Date().toISOString(),
      workProgress,
    });
    await (manager as any).saveStatus('web-user', {
      status: 'processing',
      taskKind: 'pdf-wiki',
      totalPdfs: 4,
      processedPdfs: 1,
      failedPdfs: 0,
      totalChunks: 4,
      processedChunks: 1,
      entryCount: 0,
      message: 'Codex heartbeat 2',
      updatedAt: new Date().toISOString(),
    });

    const status = await manager.getStatus('web-user');
    expect(status.workProgress).toEqual(workProgress);
  });

  it('never changes a running PDF Wiki task based only on elapsed time', () => {
    const runningStatus = {
      status: 'processing',
      taskKind: 'pdf-wiki',
      totalPdfs: 4,
      processedPdfs: 1,
      totalChunks: 4,
      processedChunks: 1,
      entryCount: 0,
      message: 'Codex is running',
      updatedAt: new Date(0).toISOString(),
    };
    const guarded = (manager as any).withStaleProcessingGuard(runningStatus);

    expect(guarded).toEqual(runningStatus);
  });

  it('splits mean plus-minus error cells across meta-analysis columns', () => {
    const normalized = (manager as any).normalizeMetaAnalysisRow({
      'Cum N2O (kg N2O ha-1)': '7.32 ± 0.38 d',
      N2O_n: '4',
      note: 'Values are mean ± SD; different letters indicate significant differences.',
    }, ['Cum N2O (kg N2O ha-1)', 'N2O_SD', 'N2O_n', '显著性']);

    expect(normalized['Cum N2O (kg N2O ha-1)']).toBe('7.32');
    expect(normalized.N2O_SD).toBe('0.38');
    expect(normalized.N2O_n).toBe('4');
    expect(normalized['显著性']).toBe('d');
  });

  it('converts SE to SD when target meta-analysis column requires SD', () => {
    const normalized = (manager as any).normalizeMetaAnalysisRow({
      'Yield mean': '10 ± 2',
      'Yield n': '9',
      note: 'Table values are mean ± SE.',
    }, ['Yield mean', 'Yield SD', 'Yield n']);

    expect(normalized['Yield mean']).toBe('10');
    expect(normalized['Yield SD']).toBe('6');
    expect(normalized['Yield n']).toBe('9');
  });

  it('does not assign any built-in topic when the user topic catalog is empty', () => {
    const topic = (manager as any).inferSentencePointTopic(
      'Nitrogen fertilizer management strongly affects nitrous oxide emissions in cropland systems.'
    );

    expect(topic).toEqual({ key: 'unclassified', label: '未分类', keywords: [] });
  });

  it('migrates previously stored built-in topics to unclassified when no user topics exist', async () => {
    const point = createSentencePoint('legacy-topic', 'nitrogen-management', 'pdf-legacy');
    point.topicLabel = '氮肥管理';
    point.keywords = ['nitrogen fertilizer'];
    writeWikiStore(tempDir, 'web-user', [], [point]);

    const store = await manager.getStore('web-user');
    const saved = JSON.parse(fs.readFileSync(path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'wiki.json'), 'utf-8'));

    expect(store.sentenceCloud?.points[0].topicLabel).toBe('未分类');
    expect(store.sentenceCloud?.points[0].topicKey).toBe('unclassified');
    expect(saved.sentenceCloud.points[0].topicLabel).toBe('未分类');
  });

  it('matches sentence topics only against user definitions and respects exclusion terms', () => {
    const topics = [{
      id: 'topic_extreme_rainfall',
      label: '极端降雨效应',
      description: '识别极端降雨对农田过程的影响。',
      aliases: ['extreme precipitation'],
      keywords: ['heavy rainfall', '降雨事件'],
      excludeKeywords: ['indoor rainfall simulator'],
      expandedBy: 'ai',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }];

    const matched = (manager as any).inferSentencePointTopic(
      'Heavy rainfall increased soil moisture and changed field N2O fluxes.',
      topics
    );
    const excluded = (manager as any).inferSentencePointTopic(
      'The indoor rainfall simulator produced heavy rainfall for instrument calibration.',
      topics
    );

    expect(matched.key).toBe('topic-extreme-rainfall');
    expect(matched.label).toBe('极端降雨效应');
    expect(matched.keywords).toContain('heavy rainfall');
    expect(excluded.label).toBe('未分类');
  });

  it('persists AI-expanded user topics in the per-user PDF Wiki catalog', async () => {
    vi.spyOn(manager as any, 'callJsonNormalizer').mockResolvedValue({
      topics: [{
        label: '长期施氮遗留效应',
        description: '识别长期施氮停止后仍持续存在的土壤与排放响应。',
        aliases: ['legacy effect of nitrogen fertilization'],
        keywords: ['nitrogen legacy effect', 'residual nitrogen'],
        excludeKeywords: ['short-term fertilization'],
      }],
    });

    const result = await manager.expandAndSaveTopics('web-user', [{ label: '长期施氮遗留效应' }], {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    const reloaded = new PdfWikiManager(tempDir);
    const catalog = await reloaded.getTopicCatalog('web-user');

    expect(result.catalog.topics).toHaveLength(1);
    expect(result.reclassifiedPointCount).toBe(0);
    expect(catalog.topics[0].label).toBe('长期施氮遗留效应');
    expect(catalog.topics[0].keywords).toContain('nitrogen legacy effect');
  });

  it('persists AI sentence topic annotations and skips unchanged sentences on the next run', async () => {
    const points = [
      createSentencePoint('sentence-topic-a', 'unclassified', 'pdf-a'),
      createSentencePoint('sentence-topic-b', 'unclassified', 'pdf-b'),
    ];
    writeWikiStore(tempDir, 'web-user', [], points);
    const annotateSpy = vi.spyOn(manager as any, 'callJsonNormalizer').mockResolvedValue({
      annotations: points.map((point, index) => ({
        sentenceId: point.id,
        subjectTags: index === 0 ? ['氮循环', '温室气体排放'] : ['降雨变化'],
        trendConclusionTopic: index === 0 ? '氮投入提高 N2O 排放' : '增雨改变土壤过程响应',
      })),
    });

    const started = await manager.startSentenceTopicAnnotation('web-user', {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    expect(started.status).toBe('processing');
    await waitForCondition(async () => (await manager.getSentenceTopicAnnotationStatus('web-user')).status !== 'processing');

    const completed = await manager.getSentenceTopicAnnotationStatus('web-user');
    const store = await manager.getStore('web-user');
    expect(completed.status).toBe('completed');
    expect(completed.annotatedSentences).toBe(2);
    expect(completed.pendingSentences).toBe(0);
    expect(store.sentenceCloud?.points[0].aiTopicAnnotation?.subjectTags).toContain('氮循环');
    expect(store.sentenceCloud?.points[0].aiTopicAnnotation?.trendConclusionTopic).toBe('氮投入提高 N2O 排放');
    expect(fs.existsSync(path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'sentence-topic-annotations.json'))).toBe(true);

    const secondRun = await manager.startSentenceTopicAnnotation('web-user', {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    expect(secondRun.status).toBe('completed');
    expect(secondRun.targetSentences).toBe(0);
    expect(secondRun.skippedSentences).toBe(2);
    expect(annotateSpy).toHaveBeenCalledTimes(1);

    const wikiPath = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'wiki.json');
    const changedWiki = JSON.parse(fs.readFileSync(wikiPath, 'utf-8'));
    changedWiki.sentenceCloud.points[1].sentence += ' The source sentence has changed.';
    fs.writeFileSync(wikiPath, JSON.stringify(changedWiki, null, 2), 'utf-8');
    const changedRun = await manager.startSentenceTopicAnnotation('web-user', {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    expect(changedRun.targetSentences).toBe(1);
    await waitForCondition(async () => (await manager.getSentenceTopicAnnotationStatus('web-user')).status !== 'processing');
    expect(annotateSpy).toHaveBeenCalledTimes(2);
  });

  it('accepts nested snake_case AI sentence topic annotation responses', async () => {
    const points = [
      createSentencePoint('sentence-topic-snake-a', 'unclassified', 'pdf-snake-a'),
      createSentencePoint('sentence-topic-snake-b', 'unclassified', 'pdf-snake-b'),
    ];
    writeWikiStore(tempDir, 'web-user', [], points);
    const annotateSpy = vi.spyOn(manager as any, 'callJsonNormalizer').mockResolvedValue({
      data: {
        results: points.map((point, index) => ({
          sentence_id: point.id,
          topic_tags: index === 0 ? ['氮循环', '温室气体'] : ['降雨变化'],
          trend_conclusion_topic: index === 0 ? '施氮促进 N2O 排放' : '增雨改变土壤水分响应',
        })),
      },
    });

    await manager.startSentenceTopicAnnotation('web-user', {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    await waitForCondition(async () => (await manager.getSentenceTopicAnnotationStatus('web-user')).status !== 'processing');

    const completed = await manager.getSentenceTopicAnnotationStatus('web-user');
    const store = await manager.getStore('web-user');
    expect(completed.status).toBe('completed');
    expect(completed.failedSentences).toBe(0);
    expect(store.sentenceCloud?.points[0].aiTopicAnnotation?.subjectTags).toContain('氮循环');
    expect(store.sentenceCloud?.points[1].aiTopicAnnotation?.trendConclusionTopic).toBe('增雨改变土壤水分响应');
    expect(annotateSpy).toHaveBeenCalledTimes(1);
  });

  it('retries only missing sentence topic annotations and preserves valid first-pass records', async () => {
    const points = [
      createSentencePoint('sentence-topic-retry-a', 'unclassified', 'pdf-retry-a'),
      createSentencePoint('sentence-topic-retry-b', 'unclassified', 'pdf-retry-b'),
    ];
    writeWikiStore(tempDir, 'web-user', [], points);
    const annotateSpy = vi.spyOn(manager as any, 'callJsonNormalizer')
      .mockResolvedValueOnce({
        annotations: [{
          sentenceId: points[0].id,
          subjectTags: ['氮循环'],
          trendConclusionTopic: '氮输入改变土壤氮循环',
        }],
      })
      .mockResolvedValueOnce({
        output: {
          items: [{
            point_id: points[1].id,
            labels: [{ label: '降雨变化' }, { label: '土壤过程' }],
            conclusion_topic: { text: '增雨改变土壤过程响应' },
          }],
        },
      });

    await manager.startSentenceTopicAnnotation('web-user', {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    await waitForCondition(async () => (await manager.getSentenceTopicAnnotationStatus('web-user')).status !== 'processing');

    const completed = await manager.getSentenceTopicAnnotationStatus('web-user');
    const store = await manager.getStore('web-user');
    expect(completed.status).toBe('completed');
    expect(completed.annotatedSentences).toBe(2);
    expect(completed.pendingSentences).toBe(0);
    expect(completed.failedSentences).toBe(0);
    expect(store.sentenceCloud?.points[0].aiTopicAnnotation?.trendConclusionTopic).toBe('氮输入改变土壤氮循环');
    expect(store.sentenceCloud?.points[1].aiTopicAnnotation?.subjectTags).toEqual(['降雨变化', '土壤过程']);
    expect(annotateSpy).toHaveBeenCalledTimes(2);
    expect(String(annotateSpy.mock.calls[1]?.[1] || '')).toContain(points[1].id);
    expect(String(annotateSpy.mock.calls[1]?.[1] || '')).not.toContain(points[0].id);
  });

  it('persists valid first-pass annotations when the targeted retry request fails', async () => {
    const points = [
      createSentencePoint('sentence-topic-retry-error-a', 'unclassified', 'pdf-retry-error-a'),
      createSentencePoint('sentence-topic-retry-error-b', 'unclassified', 'pdf-retry-error-b'),
    ];
    writeWikiStore(tempDir, 'web-user', [], points);
    vi.spyOn(manager as any, 'callJsonNormalizer')
      .mockResolvedValueOnce({
        annotations: [{
          sentenceId: points[0].id,
          subjectTags: ['氮循环'],
          trendConclusionTopic: '氮输入改变土壤氮循环',
        }],
      })
      .mockRejectedValueOnce(new Error('temporary retry failure'));

    await manager.startSentenceTopicAnnotation('web-user', {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
    });
    await waitForCondition(async () => (await manager.getSentenceTopicAnnotationStatus('web-user')).status !== 'processing');

    const completed = await manager.getSentenceTopicAnnotationStatus('web-user');
    const store = await manager.getStore('web-user');
    expect(completed.status).toBe('completed');
    expect(completed.annotatedSentences).toBe(1);
    expect(completed.pendingSentences).toBe(1);
    expect(completed.failedSentences).toBe(1);
    expect(store.sentenceCloud?.points[0].aiTopicAnnotation?.subjectTags).toEqual(['氮循环']);
    expect(store.sentenceCloud?.points[1].aiTopicAnnotation).toBeUndefined();
  });

  it('manually adds and edits a topic while reclassifying existing sentence points', async () => {
    const point = createSentencePoint('rainfall-point', 'unclassified', 'pdf-rainfall');
    point.sentence = 'Heavy rainfall increased soil moisture and field nitrous oxide emissions.';
    point.claimText = 'Heavy rainfall increases field nitrous oxide emissions.';
    point.topicLabel = '未分类';
    point.keywords = [];
    writeWikiStore(tempDir, 'web-user', [], [point]);

    const added = await manager.saveManualTopicDefinition('web-user', {
      label: '极端降雨效应',
      description: '识别强降雨造成的农田响应。',
      aliases: ['extreme precipitation'],
      keywords: ['heavy rainfall'],
      excludeKeywords: ['rainfall simulator'],
    });
    const edited = await manager.saveManualTopicDefinition('web-user', {
      id: added.topic.id,
      label: '极端降雨与排放',
      description: '识别强降雨对农田温室气体排放的影响。',
      aliases: ['extreme precipitation'],
      keywords: ['heavy rainfall', 'nitrous oxide emissions'],
      excludeKeywords: ['rainfall simulator'],
    });
    const store = await manager.getStore('web-user');

    expect(added.reclassifiedPointCount).toBe(1);
    expect(edited.topic.id).toBe(added.topic.id);
    expect(edited.catalog.topics).toHaveLength(1);
    expect(edited.catalog.topics[0].expandedBy).toBe('manual');
    expect(store.sentenceCloud?.points[0].topicLabel).toBe('极端降雨与排放');
    expect(store.sentenceCloud?.points[0].topicKey).toBe(added.topic.id.replace(/_/g, '-'));
  });

  it('builds sentence cloud points from introduction and discussion sentences with reference matches', () => {
    const pdf = {
      id: 'pdf-1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 100,
      title: 'Nitrogen study',
    };
    const references = [{
      id: 'ref-1',
      raw: 'Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source.pdf',
      index: 1,
      title: 'Nitrogen fertilizer and N2O emissions',
      authors: 'Smith J.',
      year: '2020',
      journal: 'Soil',
      doi: '10.1000/n2o',
    }];
    const text = [
      'Introduction',
      'Nitrogen fertilizer management strongly affects nitrous oxide emissions in cropland systems [1].',
      'This background sentence is intentionally long enough but has no citation.',
      'Methods',
      'We describe the experiment.',
      'Discussion',
      'Lower nitrate accumulation after optimized fertilization reduced denitrification potential and N2O losses [1].',
      'Conclusion',
      'Optimized nitrogen fertilizer management can mitigate cropland N2O emissions in the North China Plain [1].',
      'References',
      'Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
    ].join('\n');

    const points = (manager as any).buildSentenceCloudPointsFromText(text, pdf, references);
    const store = (manager as any).buildSentenceCloudStore(points);

    expect(points.some((point: any) => point.section === 'Introduction')).toBe(true);
    expect(points.some((point: any) => point.section === 'Discussion')).toBe(true);
    expect(points.some((point: any) => point.section === 'Conclusion')).toBe(true);
    expect(points.some((point: any) => point.references.some((ref: any) => ref.id === 'ref-1'))).toBe(true);
    expect(points.some((point: any) => point.claimCandidate && point.claimText)).toBe(true);
    expect(store.clouds.length).toBeGreaterThan(0);
    expect(store.points[0]).toHaveProperty('topicLabel');
  });

  it('keeps fast-mode sentence drafts free of locally extracted citations and reference matches', () => {
    const pdf = {
      id: 'pdf-fast-ai',
      originalName: 'fast-source.pdf',
      fileName: 'fast-source.pdf',
      filePath: 'fast-source.pdf',
      size: 100,
      title: 'Fast AI citation matching',
    };
    const text = [
      'Introduction',
      'Nitrogen fertilizer management strongly affects nitrous oxide emissions in cropland systems [12].',
      'Methods',
      'Samples were collected from the field.',
      'Discussion',
      'Optimized fertilization reduced nitrate accumulation and N2O losses (Smith et al., 2020).',
      'Conclusion',
      'Optimized management mitigated emissions.',
      'References',
      '[12] Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
    ].join('\n');

    const points = (manager as any).buildSentenceCloudDraftPointsForAi(text, pdf);
    const prompt = (manager as any).composeFastCodexSentenceWikiPrompt(pdf, points, [], [{
      id: 'ref-12',
      index: 12,
      raw: '[12] Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
      sourcePdfId: pdf.id,
      sourcePdfName: pdf.originalName,
    }]);

    expect(points.map((point: any) => point.section)).toEqual(['Introduction', 'Discussion']);
    expect(points.every((point: any) => point.citations.length === 0)).toBe(true);
    expect(points.every((point: any) => point.references.length === 0)).toBe(true);
    expect(points.every((point: any) => point.claimCandidate === false)).toBe(true);
    expect(prompt).not.toContain('detectedCitations:');
    expect(prompt).not.toContain('localReferenceIndexes:');
    expect(prompt).toContain('aiDetectedCitations: none');
    expect(prompt).toContain('来自上一阶段 AI 对原句的并发识别');
    expect(prompt).toContain('Nitrogen fertilizer management strongly affects');
    expect(prompt).toContain('[12] Smith J. 2020. Nitrogen fertilizer');
  });

  it('narrows each AI matching batch to references named by AI-detected citations', () => {
    const references = [
      { id: 'ref-1', index: 1, authors: 'Jones A.', year: '2019', raw: 'Jones A. 2019. Unrelated.' },
      { id: 'ref-12', index: 12, authors: 'Smith J.', year: '2020', raw: 'Smith J. 2020. Nitrogen emissions.' },
      { id: 'ref-13', index: 13, authors: 'Brown B.', year: '2021', raw: 'Brown B. 2021. Soil carbon.' },
    ];
    const numericPoint = {
      ...createSentencePoint('sent-numeric', 'nitrogen', 'pdf-fast'),
      citations: ['[12]'],
    };
    const authorYearPoint = {
      ...createSentencePoint('sent-author-year', 'nitrogen', 'pdf-fast'),
      citations: ['Smith et al. (2020)'],
    };

    expect((manager as any).selectReferencesForAiDetectedCitations([numericPoint], references).map((ref: any) => ref.id))
      .toEqual(['ref-12']);
    expect((manager as any).selectReferencesForAiDetectedCitations([authorYearPoint], references).map((ref: any) => ref.id))
      .toEqual(['ref-12']);
  });

  it('accepts citation detection output only when the citation is present in the source sentence', () => {
    const point = {
      ...createSentencePoint('sent-detection', 'nitrogen', 'pdf-fast'),
      sentence: 'Smith et al. (2020) reported a substantial reduction in agricultural emissions.',
      citations: [],
    };
    const detected = (manager as any).applyFastCitationDetection([point], {
      matches: [{
        pointId: point.id,
        citations: ['Smith et al. (2020)', '[99]'],
      }],
    });

    expect(detected[0].citations).toEqual(['Smith et al. (2020)']);
  });

  it('keeps only publishable argument sentences in the sentence cloud and retrieval output', () => {
    const basePoint = {
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source.pdf',
      sourcePdfTitle: 'Nitrogen study',
      section: 'Discussion',
      sentenceIndex: 1,
      citations: ['[1]'],
      references: [{
        id: 'ref-1',
        raw: 'Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
        sourcePdfId: 'pdf-1',
        sourcePdfName: 'source.pdf',
        index: 1,
        title: 'Nitrogen fertilizer and N2O emissions',
        matchType: 'citation',
      }],
      referenceCount: 1,
      topicKey: 'n2o-emission',
      topicLabel: 'N2O 排放',
      keywords: ['N2O'],
      x: 50,
      y: 50,
      radius: 13,
      matchMethod: 'citation',
      confidence: 0.95,
    };
    const publishable = {
      ...basePoint,
      id: 'sent_publishable',
      sentence: 'Optimized nitrogen fertilizer management reduced nitrate accumulation and mitigated cropland N2O emissions [1].',
      claimCandidate: true,
      claimText: 'Optimized nitrogen fertilizer management mitigates cropland N2O emissions.',
      claimType: 'result',
      claimReason: '该句表达结果判断，并有句尾显式引用。',
    };
    const reviewOnly = {
      ...basePoint,
      id: 'sent_review_only',
      sentence: 'This long contextual sentence is descriptive and should be reviewed before being used as a claim [1].',
      claimCandidate: false,
      claimText: '',
      claimType: 'non_claim',
      claimReason: '句子缺少明确判断，需要人工复核后再转为论点。',
    };
    const methodOnly = {
      ...basePoint,
      id: 'sent_method_only',
      sentence: 'Samples were measured using a static chamber method according to the experimental protocol [1].',
      claimCandidate: true,
      claimText: 'Samples were measured using a static chamber method.',
      claimType: 'method',
      claimReason: '方法描述不进入论点库。',
    };
    const fallbackOnly = {
      ...publishable,
      id: 'sent_fallback_only',
      citations: [],
      references: [{
        id: 'ref-source-pdf',
        raw: '来源 PDF：source.pdf',
        title: 'Source paper',
        fallbackSourcePdf: true,
      }],
      referenceCount: 1,
      matchMethod: 'none',
    };
    const noReference = {
      ...publishable,
      id: 'sent_no_reference',
      citations: [],
      references: [],
      referenceCount: 0,
      matchMethod: 'none',
    };

    const candidates = [publishable, reviewOnly, methodOnly, fallbackOnly, noReference];
    const store = (manager as any).buildSentenceCloudStore(candidates);
    const literatures = (manager as any).sentencePointsToLiteratures(candidates, 0);

    expect(store.points.map((point: any) => point.id)).toEqual(['sent_publishable']);
    expect(store.clouds).toHaveLength(1);
    expect(literatures.map((item: any) => item.id)).toEqual(['sent_publishable']);
    expect(literatures[0].abstract).toContain('可作论点: 是');
    expect(literatures[0].abstract).not.toContain('论点候选: 否');
    expect(literatures[0].embeddingText).toContain(publishable.sentence);
    expect(literatures[0].embeddingText).toContain(publishable.claimText);
    expect(literatures[0].evidenceAttachment).toMatchObject({
      kind: 'pdf-wiki-sentence',
      sentenceId: 'sent_publishable',
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source.pdf',
      section: 'Discussion',
      sentenceIndex: 1,
      citations: ['[1]'],
      referenceIndexes: [1],
    });
    expect(literatures[0].evidenceAttachment.references[0]).toMatchObject({
      id: 'ref-1',
      index: 1,
      title: 'Nitrogen fertilizer and N2O emissions',
    });
  });

  it('removes fallback-only compatibility entries from display and writing retrieval views', async () => {
    const verified = createStoreEntry('verified', 'Verified claim');
    const fallbackOnly = createStoreEntry('fallback', 'Fallback-only claim');
    fallbackOnly.references = [{
      id: 'ref-source-fallback',
      raw: '来源 PDF：fallback.pdf',
      title: 'Fallback source PDF',
      fallbackSourcePdf: true,
    }];
    fallbackOnly.pro[0].references = [...fallbackOnly.references];
    writeWikiStore(tempDir, 'web-user', [verified, fallbackOnly]);

    const viewerSnapshot = await manager.getViewerStoreSnapshot('web-user');
    const store = await manager.getStore('web-user');
    const literatures = (manager as any).storeToRetrievalLiteratures(store);

    expect(viewerSnapshot.entries.map(entry => entry.id)).toEqual(['verified']);
    expect(store.entries.map(entry => entry.id)).toEqual(['verified']);
    expect(literatures.map((item: any) => item.id)).toEqual(['verified']);
  });

  it('refines sentence cloud reference matches with AI when configured', async () => {
    const point = {
      id: 'sent_test',
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source.pdf',
      section: 'Discussion',
      sentenceIndex: 1,
      sentence: 'Optimized nitrogen fertilizer reduced nitrate accumulation and N2O losses in the discussion [2].',
      citations: ['[2]'],
      references: [],
      referenceCount: 0,
      topicKey: 'n2o-emission',
      topicLabel: 'N2O 排放',
      keywords: ['N2O'],
      x: 50,
      y: 50,
      radius: 8,
      matchMethod: 'none',
      confidence: 0.1,
    };
    const references = [
      {
        id: 'ref-1',
        raw: 'Unrelated paper.',
        sourcePdfId: 'pdf-1',
        sourcePdfName: 'source.pdf',
        index: 1,
        title: 'Unrelated paper',
      },
      {
        id: 'ref-2',
        raw: 'Li X. 2021. Optimized nitrogen fertilizer and N2O losses.',
        sourcePdfId: 'pdf-1',
        sourcePdfName: 'source.pdf',
        index: 2,
        title: 'Optimized nitrogen fertilizer and N2O losses',
      },
    ];
    vi.spyOn(manager as any, 'callJsonNormalizer').mockResolvedValue({
      matches: [{
        pointId: 'sent_test',
        referenceIndexes: [2],
        matchMethod: 'citation',
        confidence: 0.66,
        claimCandidate: true,
        claimText: '优化氮肥可降低 N2O 损失',
        claimType: 'result',
        claimReason: '该句表达结果判断',
        reason: '句尾编号引用 [2] 对齐到文末条目',
      }],
    });

    const refined = await (manager as any).refineSentenceCloudPointsWithAi([point], references, {
      apiUrl: 'http://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      sentenceReferenceMatchingEngine: 'api',
    });

    expect(refined[0].references.map((ref: any) => ref.id)).toEqual(['ref-2']);
    expect(refined[0].matchMethod).toBe('citation');
    expect(refined[0].topicLabel).toBe('N2O 排放');
    expect(refined[0].claimCandidate).toBe(true);
    expect(refined[0].claimText).toBe('优化氮肥可降低 N2O 损失');
    expect(refined[0].referenceCount).toBe(1);
  });

  it('does not attach semantic references to sentence cloud points without terminal citations', async () => {
    const pdf = {
      id: 'pdf-1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 100,
      title: 'Nitrogen study',
    };
    const references = [{
      id: 'ref-1',
      raw: 'Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source.pdf',
      index: 1,
      title: 'Nitrogen fertilizer and N2O emissions',
      authors: 'Smith J.',
      year: '2020',
    }];
    const text = [
      'Introduction',
      'Nitrogen fertilizer management strongly affects nitrous oxide emissions in cropland systems.',
      'Discussion',
      'Optimized fertilization reduced nitrate accumulation and N2O losses without a terminal citation.',
      'References',
      'Smith J. 2020. Nitrogen fertilizer and N2O emissions. Soil.',
    ].join('\n');

    const points = (manager as any).buildSentenceCloudPointsFromText(text, pdf, references);

    expect(points.length).toBeGreaterThan(0);
    expect(points.every((point: any) => point.references.length === 0)).toBe(true);
    expect(points.every((point: any) => point.matchMethod === 'none')).toBe(true);
  });

  it('copies uploaded PDFs and records an API configuration error', async () => {
    vi.spyOn(manager as any, 'tryExtractPdfWithLiteParse').mockResolvedValue(null);
    await manager.processUploadedPdfs('web-user', [{
      originalname: 'sample.pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
      size: 14,
    }], {
      apiUrl: '',
      apiKey: '',
      model: 'test-model',
    });

    const status = await manager.getStatus('web-user');
    const sourceDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'source-pdfs');

    expect(status.status).toBe('error');
    expect(status.error).toBe('API_NOT_CONFIGURED');
    expect(fs.readdirSync(sourceDir)).toHaveLength(1);
  });

  it('requires Codex for the fast sentence Wiki even when an API is configured', async () => {
    vi.spyOn(manager as any, 'canUseCodexCli').mockReturnValue(false);
    vi.spyOn(manager as any, 'tryExtractPdfWithLiteParse').mockResolvedValue(null);

    await manager.processUploadedPdfs('web-user', [{
      originalname: 'fast-codex-required.pdf',
      buffer: Buffer.from('%PDF-1.4\n%%EOF'),
      size: 14,
    }], {
      apiUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      processingProfile: 'fast',
      textExtractionEngine: 'liteparse',
      metadataEngine: 'local',
      claimExtractionEngine: 'off',
      sentenceReferenceMatchingEngine: 'codex',
      groupingEngine: 'local',
      metaAnalysisEnabled: false,
      metaAnalysisEngine: 'off',
    });

    const status = await manager.getStatus('web-user');
    expect(status.status).toBe('error');
    expect(status.error).toBe('CODEX_NOT_AVAILABLE');
    expect(status.message).toContain('句中/句末引用');
  });

  it('supports an explicit custom local sentence-only build when compatibility claims are disabled', async () => {
    const text = [
      'Introduction',
      'Previous studies show that optimized nitrogen management substantially reduces nitrous oxide emissions from agricultural soils [1].',
      'Discussion',
      'These results demonstrate that lower nitrogen inputs reduce gaseous nitrogen losses while maintaining crop production [1].',
      'Conclusion',
      'Optimized nitrogen inputs reduce nitrous oxide emissions without sacrificing crop production.',
      'References',
      '1. Smith J. 2020. Nitrogen management reduces nitrous oxide emissions. Soil Biology.',
    ].join('\n');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const parsedContent = {
      text,
      metadata: { title: 'Local nitrogen study' },
      references: [{
        id: 'ref-local-1',
        raw: 'Smith J. 2020. Nitrogen management reduces nitrous oxide emissions. Soil Biology.',
        sourcePdfId: 'pdf-placeholder',
        sourcePdfName: 'local-fast.pdf',
        index: 1,
        title: 'Nitrogen management reduces nitrous oxide emissions',
        authors: 'Smith J.',
        year: '2020',
      }],
      parser: 'liteparse',
    };
    vi.spyOn(manager as any, 'tryExtractPdfWithLiteParse').mockResolvedValue(parsedContent);
    vi.spyOn(manager as any, 'extractPdfContent').mockResolvedValue(parsedContent);

    await manager.processUploadedPdfs('web-user', [{
      originalname: 'local-fast.pdf',
      buffer: Buffer.from('%PDF-1.4\nlocal-fast\n%%EOF'),
      size: 27,
    }], {
      apiUrl: '',
      apiKey: '',
      model: '',
      processingProfile: 'custom',
      textExtractionEngine: 'liteparse',
      metadataEngine: 'local',
      claimExtractionEngine: 'off',
      sentenceReferenceMatchingEngine: 'local',
      groupingEngine: 'local',
      metaAnalysisEnabled: false,
      metaAnalysisEngine: 'off',
    });

    const status = await manager.getStatus('web-user');
    const store = await manager.getStore('web-user');

    expect(status.status).toBe('completed');
    expect(store.entries).toHaveLength(0);
    expect(store.sentenceCloud?.points.length).toBeGreaterThan(0);
    expect(store.pdfs[0].metaData?.meta_analysis_enabled).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists uploaded PDF jobs, runs them serially, and never stores API secrets', async () => {
    const inputDir = path.join(tempDir, 'incoming');
    fs.mkdirSync(inputDir, { recursive: true });
    const firstPath = path.join(inputDir, 'first.pdf');
    const secondPath = path.join(inputDir, 'second.pdf');
    fs.writeFileSync(firstPath, '%PDF-1.4\nfirst\n%%EOF');
    fs.writeFileSync(secondPath, '%PDF-1.4\nsecond\n%%EOF');

    let active = 0;
    let maxActive = 0;
    const processed: string[] = [];
    vi.spyOn(manager, 'processUploadedPdfs').mockImplementation(async (_userId, files) => {
      active++;
      maxActive = Math.max(maxActive, active);
      processed.push(files[0].originalname);
      await new Promise(resolve => setTimeout(resolve, 25));
      active--;
    });
    manager.setQueueRuntimeConfigProvider(() => ({ apiUrl: 'https://secret.example/v1', apiKey: 'never-persist', model: 'test' }));

    const firstEnqueue = await manager.enqueueUploadedPdfs('web-user', [{ originalname: 'first.pdf', path: firstPath, size: 20 }], {
      apiUrl: 'https://secret.example/v1', apiKey: 'never-persist', model: 'test', processingProfile: 'fast',
    });
    const secondEnqueue = await manager.enqueueUploadedPdfs('web-user', [{ originalname: 'second.pdf', path: secondPath, size: 21 }], {
      apiUrl: 'https://secret.example/v1', apiKey: 'never-persist', model: 'test', processingProfile: 'fast',
    });

    await waitForCondition(async () => (await manager.getQueueSnapshot('web-user')).completedJobs === 2);
    await (manager as any).queueWorkers.get('web-user');
    const queuePath = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'queue.json');
    const queueText = fs.readFileSync(queuePath, 'utf-8');

    expect(processed).toEqual(['first.pdf', 'second.pdf']);
    expect(maxActive).toBe(1);
    expect(firstEnqueue.addedJobIds).toHaveLength(1);
    expect(secondEnqueue.addedJobIds).toHaveLength(1);
    expect(firstEnqueue.addedJobIds?.[0]).not.toBe(secondEnqueue.addedJobIds?.[0]);
    expect(queueText).not.toContain('never-persist');
    expect(queueText).not.toContain('secret.example');
  });

  it('recovers an interrupted persistent PDF job after restart', async () => {
    const inputPath = path.join(tempDir, 'recovered.pdf');
    fs.writeFileSync(inputPath, '%PDF-1.4\nrecovered\n%%EOF');
    const queueDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(queueDir, { recursive: true });
    fs.writeFileSync(path.join(queueDir, 'queue.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      updatedAt: new Date().toISOString(),
      jobs: [{
        id: 'pdfq-interrupted',
        status: 'running',
        files: [{ originalname: 'recovered.pdf', path: inputPath, size: 24 }],
        taskConfig: { processingProfile: 'fast' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      }],
    }, null, 2));

    const recoveredManager = new PdfWikiManager(tempDir);
    const processSpy = vi.spyOn(recoveredManager, 'processUploadedPdfs').mockResolvedValue(undefined);
    recoveredManager.setQueueRuntimeConfigProvider(() => ({ apiUrl: '', apiKey: '', model: '' }));
    await recoveredManager.recoverPersistentQueues();
    await waitForCondition(async () => (await recoveredManager.getQueueSnapshot('web-user')).completedJobs === 1);
    await (recoveredManager as any).queueWorkers.get('web-user');

    expect(processSpy).toHaveBeenCalledTimes(1);
    expect(processSpy.mock.calls[0][1][0].originalname).toBe('recovered.pdf');
  });

  it('persists a whole PDF recognition batch and continues after an individual item fails', async () => {
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'wiki.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      generatedAt: new Date().toISOString(),
      pdfs: [
        { id: 'pdf-full', originalName: 'full.pdf', fileName: 'full.pdf', filePath: 'full.pdf', size: 10 },
        { id: 'pdf-images', originalName: 'images.pdf', fileName: 'images.pdf', filePath: 'images.pdf', size: 11 },
      ],
      referenceIndex: [],
      entries: [],
    }, null, 2));

    const fullSpy = vi.spyOn(manager, 'reidentifyPdfWithLiteParse')
      .mockRejectedValueOnce(new Error('broken PDF'));
    const imageSpy = vi.spyOn(manager, 'ensurePdfFiguresForManager').mockResolvedValue({
      pdf: {
        id: 'pdf-images',
        originalName: 'images.pdf',
        fileName: 'images.pdf',
        filePath: 'images.pdf',
        size: 11,
      },
      figureCount: 4,
      attempted: true,
    });

    const submitted = await manager.enqueuePdfRecognition('web-user', [
      { pdfId: 'pdf-full', mode: 'full' },
      { pdfId: 'pdf-images', mode: 'images-only' },
    ]);
    await waitForCondition(async () => {
      const snapshot = await manager.getRecognitionQueueSnapshot('web-user');
      return snapshot.completedItems + snapshot.failedItems === 2;
    });
    await (manager as any).recognitionQueueWorkers.get('web-user');

    const snapshot = await manager.getRecognitionQueueSnapshot('web-user');
    const queuePath = path.join(wikiDir, 'recognition-queue.json');
    const persisted = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));
    expect(submitted.addedItems).toBe(2);
    expect(submitted.addedJobIds).toHaveLength(1);
    expect(fullSpy).toHaveBeenCalledTimes(1);
    expect(imageSpy).toHaveBeenCalledTimes(1);
    expect(snapshot.completedItems).toBe(1);
    expect(snapshot.failedItems).toBe(1);
    expect(persisted.jobs[0].items.map((item: any) => item.status)).toEqual(['error', 'completed']);
  });

  it('restores running PDF recognition items to the persistent queue after restart', async () => {
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    const now = new Date().toISOString();
    fs.writeFileSync(path.join(wikiDir, 'recognition-queue.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      updatedAt: now,
      jobs: [{
        id: 'pdfr-interrupted',
        status: 'running',
        createdAt: now,
        updatedAt: now,
        startedAt: now,
        items: [{
          pdfId: 'pdf-recovered',
          pdfName: 'recovered.pdf',
          mode: 'images-only',
          status: 'running',
          createdAt: now,
          updatedAt: now,
          startedAt: now,
        }],
      }],
    }, null, 2));

    const recoveredManager = new PdfWikiManager(tempDir);
    const imageSpy = vi.spyOn(recoveredManager, 'ensurePdfFiguresForManager').mockResolvedValue({
      pdf: {
        id: 'pdf-recovered',
        originalName: 'recovered.pdf',
        fileName: 'recovered.pdf',
        filePath: 'recovered.pdf',
        size: 12,
      },
      figureCount: 2,
      attempted: true,
    });
    await recoveredManager.recoverPersistentQueues();
    await waitForCondition(async () => (
      await recoveredManager.getRecognitionQueueSnapshot('web-user')
    ).completedItems === 1);
    await (recoveredManager as any).recognitionQueueWorkers.get('web-user');

    expect(imageSpy).toHaveBeenCalledTimes(1);
    expect((await recoveredManager.getRecognitionQueueSnapshot('web-user')).runningItems).toBe(0);
  });

  it('matches processed and queued PDF hashes before upload', async () => {
    const processedHash = 'a'.repeat(64);
    const queuedHash = 'b'.repeat(64);
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'wiki.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      generatedAt: new Date().toISOString(),
      pdfs: [{ id: `pdf_${processedHash.slice(0, 24)}`, originalName: 'processed.pdf', fileName: 'processed.pdf', filePath: 'processed.pdf', size: 1 }],
      referenceIndex: [],
      entries: [],
    }));
    fs.writeFileSync(path.join(wikiDir, 'queue.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      updatedAt: new Date().toISOString(),
      jobs: [{
        id: 'pdfq-waiting',
        status: 'queued',
        files: [{ originalname: 'waiting.pdf', path: 'waiting.pdf', size: 1, sha256: queuedHash }],
        taskConfig: { processingProfile: 'fast' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    }));

    const result = await manager.matchUploadedPdfHashes('web-user', [
      { name: 'renamed-processed.pdf', size: 10, sha256: processedHash },
      { name: 'renamed-waiting.pdf', size: 20, sha256: queuedHash },
      { name: 'new.pdf', size: 30, sha256: 'c'.repeat(64) },
    ]);

    expect(result.duplicates.map(item => item.name)).toEqual(['renamed-processed.pdf', 'renamed-waiting.pdf']);
    expect(result.newFiles.map(item => item.name)).toEqual(['new.pdf']);
  });

  it('rejects duplicate PDF content again when adding it to the backend queue', async () => {
    const inputPath = path.join(tempDir, 'same-content.pdf');
    fs.writeFileSync(inputPath, '%PDF-1.4\nsame-content\n%%EOF');
    const hash = crypto.createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex');
    const wikiDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki');
    fs.mkdirSync(wikiDir, { recursive: true });
    fs.writeFileSync(path.join(wikiDir, 'wiki.json'), JSON.stringify({
      version: 1,
      userId: 'web-user',
      generatedAt: new Date().toISOString(),
      pdfs: [{ id: `pdf_${hash.slice(0, 24)}`, originalName: 'original.pdf', fileName: 'original.pdf', filePath: inputPath, size: 30 }],
      referenceIndex: [],
      entries: [],
    }));
    const processSpy = vi.spyOn(manager, 'processUploadedPdfs');

    const result = await manager.enqueueUploadedPdfs('web-user', [{ originalname: 'renamed.pdf', path: inputPath, size: 30 }], {
      apiUrl: '', apiKey: '', model: '', processingProfile: 'fast',
    });

    expect(result.addedPdfs).toBe(0);
    expect(result.addedJobIds).toEqual([]);
    expect(result.skippedDuplicatePdfs).toBe(1);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('keeps only Introduction and Discussion claims with citations present in the source sentence', () => {
    const reference = {
      id: 'ref-smith-2020',
      raw: 'Smith J. 2020. Nitrogen management reduces emissions. Soil Biology.',
      sourcePdfId: 'pdf-fast',
      sourcePdfName: 'fast.pdf',
      index: 1,
      title: 'Nitrogen management reduces emissions',
      authors: 'Smith J.',
      year: '2020',
    };
    const citedPoint = {
      ...createSentencePoint('sentence-cited', 'nitrogen', 'pdf-fast'),
      sentence: 'Smith et al. (2020) showed that optimized nitrogen management substantially reduces agricultural emissions.',
      citations: [],
      references: [],
      referenceCount: 0,
      matchMethod: 'none',
    };
    const uncitedPoint = {
      ...createSentencePoint('sentence-uncited', 'nitrogen', 'pdf-fast'),
      sentence: 'Optimized nitrogen management substantially reduces agricultural emissions without an explicit source.',
      citations: [],
      references: [],
      referenceCount: 0,
      matchMethod: 'none',
    };

    const points = (manager as any).applyFastCodexSentenceMatches(
      [citedPoint, uncitedPoint],
      [reference],
      {
        matches: [{
          pointId: 'sentence-cited',
          citations: ['Smith et al. (2020)'],
          referenceIndexes: [1],
          claimCandidate: true,
          claimText: '优化氮管理可降低农业排放',
          claimType: 'argument',
          topicLabel: '氮管理',
          topicKey: 'nitrogen-management',
          confidence: 0.96,
        }, {
          pointId: 'sentence-uncited',
          citations: ['Smith et al. (2020)'],
          referenceIndexes: [1],
          claimCandidate: true,
          claimText: '这条没有原文引用的句子不能进入论点库',
          claimType: 'argument',
          confidence: 0.99,
        }],
      },
    );

    expect(points).toHaveLength(1);
    expect(points[0].id).toBe('sentence-cited');
    expect(points[0].citations).toEqual(['Smith et al. (2020)']);
    expect(points[0].references).toEqual([expect.objectContaining({ id: 'ref-smith-2020', index: 1 })]);
  });

  it('reconstructs two-column References and keeps complete bibliographic details', () => {
    const columnLine = (left: string, right: string): string => left.padEnd(92, ' ') + right;
    const text = [
      'Introduction',
      'Earlier work reported a strong soil response (Aires et al., 2008).',
      'Discussion',
      'The response remained detectable across seasons (Han et al., 2017).',
      columnLine('REFERENCES', 'Han, W. J., Shi, M. M., Chang, J., and'),
      columnLine('Aires, L. M. I., Pio, C. A., Pereira, J. S., 2008. Carbon dioxide exchange', 'Y Ge 2017. Plant species diversity reduces nitrous oxide emissions.'),
      columnLine('above a Mediterranean grassland. Global Change Biology 14, 539-555.', 'Environmental Science and Pollution Research 24, 5938-5948.'),
      columnLine('https://doi.org/10.1111/gcb.2008.01507', 'https://doi.org/10.1007/s11356-016-8288-3'),
      columnLine('Bai, W. M., Wan, S. Q., 2010. Warming changes root production.', 'He, N. P., Chen, Q. S., 2012. Warming influences soil carbon.'),
    ].join('\n');

    const references = (manager as any).parseReferences(text, 'pdf-columns', 'columns.pdf');
    const aires = references.find((reference: any) => reference.authors?.includes('Aires'));
    const han = references.find((reference: any) => reference.authors?.includes('Han'));

    expect(references.length).toBeGreaterThanOrEqual(4);
    expect(aires).toMatchObject({
      year: '2008',
      doi: '10.1111/gcb.2008.01507',
    });
    expect(aires.title).toContain('Carbon dioxide exchange');
    expect(aires.raw).toContain('Global Change Biology 14, 539-555');
    expect(han).toMatchObject({
      year: '2017',
      doi: '10.1007/s11356-016-8288-3',
    });
    expect(han.raw).toContain('Environmental Science and Pollution Research');

    const matches = (manager as any).matchReferencesForCitations(
      ['(Aires et al., 2008)', '(Han et al., 2017)'],
      references,
      ['pdf-columns'],
    );
    expect(matches.map((reference: any) => reference.authors)).toEqual(expect.arrayContaining([
      expect.stringContaining('Aires'),
      expect.stringContaining('Han'),
    ]));
  });

  it('ignores the unfinished body column when References starts in the right column', () => {
    const columnLine = (left: string, right: string): string => left.padEnd(86, ' ') + right;
    const text = [
      'Discussion',
      columnLine('Brown et al. (2019) described a body-text result that is not a bibliography entry.', 'References'),
      columnLine('Lin et al. (2020) also appears in the unfinished discussion body.', 'Smith, J., Doe, R., 2020. Nitrogen management reduces emissions.'),
      columnLine('The left column continues with study interpretation and limitations.', 'Soil Biology and Biochemistry 150, 108000. https://doi.org/10.1000/smith.2020'),
      columnLine('', 'Jones, A., 2019. Soil moisture regulates denitrification. Global Change Biology 25, 10-20.'),
    ].join('\n');

    const references = (manager as any).parseReferences(text, 'pdf-right-column', 'right-column.pdf');

    expect(references).toHaveLength(2);
    expect(references[0]).toMatchObject({ authors: 'Smith, J., Doe, R', year: '2020' });
    expect(references[0].raw).toContain('Soil Biology and Biochemistry');
    expect(references.map((reference: any) => reference.raw).join(' ')).not.toContain('unfinished discussion');
    expect(references.map((reference: any) => reference.raw).join(' ')).not.toContain('Brown et al.');
  });

  it('does not locally recover an AI alignment failure from an author-year citation', () => {
    const reference = {
      id: 'ref-smith-detailed',
      raw: 'Smith, J., Doe, R., 2020. Nitrogen management reduces emissions. Soil Biology and Biochemistry 150, 108000. https://doi.org/10.1000/smith.2020',
      sourcePdfId: 'pdf-fast',
      sourcePdfName: 'fast.pdf',
      index: 1,
      title: 'Nitrogen management reduces emissions',
      authors: 'Smith, J., Doe, R.',
      year: '2020',
      journal: 'Soil Biology and Biochemistry',
      doi: '10.1000/smith.2020',
    };
    const point = {
      ...createSentencePoint('sentence-recovered', 'nitrogen', 'pdf-fast'),
      section: 'Introduction',
      sentence: 'Previous studies demonstrated that optimized nitrogen management substantially reduces agricultural emissions (Smith et al., 2020).',
      citations: ['(Smith et al., 2020)'],
      references: [],
      referenceCount: 0,
      matchMethod: 'none',
    };

    const points = (manager as any).applyFastCodexSentenceMatches([point], [reference], {
      matches: [{
        pointId: point.id,
        citations: ['(Smith et al., 2020)'],
        referenceIndexes: [],
        claimCandidate: false,
        claimText: '',
        claimType: 'non_claim',
        claimReason: '引用未对齐',
        confidence: 0.9,
      }],
    });

    expect(points).toHaveLength(0);
  });

  it('does not match a shorter surname inside a different reference author', () => {
    const references = [{
      id: 'ref-linn-2020',
      raw: 'Linn, D. M., 2020. Soil moisture and emissions.',
      sourcePdfId: 'pdf-boundary',
      sourcePdfName: 'boundary.pdf',
      index: 1,
      authors: 'Linn, D. M.',
      year: '2020',
    }];

    expect((manager as any).matchReferencesForCitations(
      ['(Lin et al., 2020)'],
      references,
      ['pdf-boundary'],
    )).toEqual([]);
  });

  it('does not treat a leading publication year as a numbered reference index', () => {
    const reference = (manager as any).parseReferenceDetails(
      '2020. Smith, J. Nitrogen management reduces emissions.',
      'pdf-year',
      'year.pdf',
      6,
    );

    expect(reference.index).toBe(7);
    expect(reference.year).toBe('2020');
    expect(reference.raw).toBe('2020. Smith, J. Nitrogen management reduces emissions.');
  });

  it('repairs a DOI split by a two-column line wrap', () => {
    const reference = (manager as any).parseReferenceDetails(
      'Bijoor, N. S., 2008. Urban nitrogen cycling. https://doi.org/10.1111/j.1365- 2486.2008.01617.x',
      'pdf-doi',
      'doi.pdf',
      0,
    );

    expect(reference.doi).toBe('10.1111/j.1365-2486.2008.01617.x');
  });

  it('reparses References when an older parsed-text cache stored an empty list', async () => {
    const parsedDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'parsed-texts');
    fs.mkdirSync(parsedDir, { recursive: true });
    const pdf = {
      id: 'pdf-empty-reference-cache',
      originalName: 'cached.pdf',
      fileName: 'cached.pdf',
      filePath: path.join(tempDir, 'cached.pdf'),
      size: 100,
      uploadedAt: new Date().toISOString(),
    };
    const textFileName = `${pdf.id}.liteparse.txt`;
    fs.writeFileSync(path.join(parsedDir, textFileName), [
      'Introduction',
      'Prior work reported lower emissions (Smith et al., 2020).',
      'References',
      'Smith, J., Doe, R., 2020. Nitrogen management reduces emissions. Soil Biology and Biochemistry 150, 108000. https://doi.org/10.1000/smith.2020',
    ].join('\n'), 'utf-8');
    fs.writeFileSync(path.join(parsedDir, `${pdf.id}.liteparse.json`), JSON.stringify({
      sourcePdfId: pdf.id,
      parser: 'liteparse',
      metadata: {},
      references: [],
      files: { text: textFileName },
    }), 'utf-8');

    const cached = await (manager as any).loadParsedTextCache('web-user', pdf);

    expect(cached.references).toHaveLength(1);
    expect(cached.references[0]).toMatchObject({
      authors: 'Smith, J., Doe, R',
      year: '2020',
      doi: '10.1000/smith.2020',
    });
  });

  it('keeps source-PDF fallback metadata but excludes it from publishable citation evidence', () => {
    const pdf = {
      id: 'pdf-source-2024',
      originalName: 'source-paper.pdf',
      fileName: 'source-paper.pdf',
      filePath: path.join(tempDir, 'source-paper.pdf'),
      size: 100,
      uploadedAt: new Date().toISOString(),
      title: 'Precision nitrogen management sustains yield',
      authors: 'Smith J.; Doe R.',
      year: '2024',
      journal: 'Global Change Biology',
      doi: '10.1000/source.2024',
    };
    const conclusionSentences = [
      'Precision nitrogen management reduced nitrous oxide emissions while maintaining grain yield across the field trials.',
      'The treatment therefore provides a practical mitigation strategy for intensive agricultural systems.',
    ];

    const points = (manager as any).buildFastCodexConclusionPoints(pdf, conclusionSentences, {
      conclusions: [{
        sourceSentenceIndexes: [1, 2],
        conclusionText: '精准氮管理在维持产量的同时降低氧化亚氮排放，并可用于集约化农业减排。',
        confidence: 0.97,
        claimType: 'result',
        topicLabel: '主要结论',
        topicKey: 'main-conclusion',
        keywords: ['nitrogen', 'N2O'],
      }],
    });

    expect(points).toHaveLength(1);
    expect(points[0].section).toBe('Conclusion');
    expect(points[0].claimText).toContain('2024');
    expect(points[0].sentence).toContain(conclusionSentences[0]);
    expect(points[0].references[0]).toMatchObject({
      sourcePdfId: 'pdf-source-2024',
      title: 'Precision nitrogen management sustains yield',
      doi: '10.1000/source.2024',
      fallbackSourcePdf: true,
    });
    expect((manager as any).getSentencePointCitationReferences(points[0])).toEqual([]);
    expect((manager as any).isPublishableSentencePoint(points[0])).toBe(false);
  });

  it('builds a focused Codex prompt from sections, references, conclusion, and source metadata', () => {
    const point = {
      ...createSentencePoint('sentence-prompt', 'soil-carbon', 'pdf-prompt'),
      sentence: 'Soil carbon availability regulates denitrification (Doe et al., 2021).',
      citations: ['(Doe et al., 2021)'],
    };
    const prompt = (manager as any).composeFastCodexSentenceWikiPrompt(
      {
        id: 'pdf-prompt',
        originalName: 'prompt.pdf',
        title: 'Source title',
        authors: 'Author A.',
        year: '2025',
        journal: 'Soil Biology',
        doi: '10.1000/prompt',
      },
      [point],
      ['The study concludes that carbon availability controls denitrification outcomes.'],
      [{ id: 'ref-doe', index: 1, raw: 'Doe J. 2021. Carbon and denitrification.' }],
    );

    expect(prompt).toContain('SECTION_SENTENCES');
    expect(prompt).toContain('CONCLUSION_SENTENCES');
    expect(prompt).toContain('SOURCE_PAPER_METADATA');
    expect(prompt).toContain('REFERENCES');
    expect(prompt).toContain('句中和句末都没有明确参考文献时');
    expect(prompt).toContain('系统会在结论后追加');
    expect(prompt).toContain('10.1000/prompt');
  });

  it('does not apply the shared Codex timeout setting to PDF Wiki tasks', () => {
    vi.stubEnv('PDF_WIKI_CODEX_TIMEOUT_MS', '300000');

    const config = (manager as any).loadPdfWikiCodexConfig();

    expect(config.timeoutMs).toBeUndefined();
  });

  it('hard-links a disk upload into the canonical PDF source directory', async () => {
    const incomingDir = path.join(tempDir, 'incoming');
    const incomingPath = path.join(incomingDir, 'linked.pdf');
    fs.mkdirSync(incomingDir, { recursive: true });
    fs.writeFileSync(incomingPath, Buffer.from('%PDF-1.4\nlinked\n%%EOF'));

    const [registered] = await (manager as any).registerPdfFiles('web-user', [{
      originalname: 'linked.pdf',
      path: incomingPath,
      size: fs.statSync(incomingPath).size,
    }]);
    const sourceStat = fs.statSync(incomingPath);
    const canonicalStat = fs.statSync(registered.filePath);

    expect(canonicalStat.dev).toBe(sourceStat.dev);
    expect(canonicalStat.ino).toBe(sourceStat.ino);
  });

  it('rejects rebuild when no PDF sources exist', async () => {
    await expect(manager.rebuildFromSources('web-user', {
      apiUrl: 'http://localhost',
      apiKey: 'key',
      model: 'test-model',
    })).rejects.toThrow('未找到已上传的 PDF 文件');
  });

  it('caches TextIn parsed markdown and normalized text', async () => {
    const pdfPath = path.join(tempDir, 'source.pdf');
    fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4\nmock\n%%EOF'));
    const markdown = [
      '# TextIn Parsed Title',
      '',
      '## Introduction',
      'Carbon availability controls N2O emissions.',
      '',
      '## References',
      'Smith, J. 2020. Carbon availability controls N2O. Soil Biology. doi:10.1000/ref',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ result: { markdown } }),
    }));

    const pdf = {
      id: 'pdf_textin_cache',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: pdfPath,
      size: 20,
    };
    const parsed = await (manager as any).tryExtractPdfWithTextIn('web-user', pdf, {
      apiUrl: 'http://llm.local',
      apiKey: 'key',
      model: 'model',
      textInAppId: 'app-id',
      textInSecretCode: 'secret-code',
    });

    const parsedDir = path.join(tempDir, 'uploads', 'web-user', 'pdf-wiki', 'parsed-texts');
    const markdownPath = path.join(parsedDir, 'pdf_textin_cache.textin.md');
    const textPath = path.join(parsedDir, 'pdf_textin_cache.textin.txt');
    const metaPath = path.join(parsedDir, 'pdf_textin_cache.textin.json');
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    expect(parsed.parser).toBe('textin');
    expect(fs.readFileSync(markdownPath, 'utf-8')).toContain('# TextIn Parsed Title');
    expect(fs.readFileSync(textPath, 'utf-8')).toContain('Carbon availability controls N2O emissions');
    expect(metadata.sourcePdfId).toBe('pdf_textin_cache');
    expect(metadata.referenceCount).toBe(1);
    expect(metadata.files.markdown).toBe('pdf_textin_cache.textin.md');
    expect(pdf.parsedMarkdownPath).toBe(markdownPath);
    expect(pdf.parsedTextPath).toBe(textPath);
  });

  it('repairs malformed LLM JSON responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '```json\n{"claims":[{"claim":"x"}\n```' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"claims":[{"claim":"x"}]}' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await (manager as any).callChatJson({
      apiUrl: 'http://localhost',
      apiKey: 'key',
      model: 'test-model',
    }, 'prompt', 1000);

    expect(result.claims[0].claim).toBe('x');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back when JSON mode is unsupported by the API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => 'response_format is not supported',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"claims":[{"claim":"fallback"}]}' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await (manager as any).callChatJson({
      apiUrl: 'http://localhost',
      apiKey: 'key',
      model: 'test-model',
    }, 'prompt', 1000);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    expect(secondBody.response_format).toBeUndefined();
    expect(result.claims[0].claim).toBe('fallback');
  });

  it('retries once without JSON mode when the API returns empty content', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '' } }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '{"claims":[{"claim":"retry success"}]}' } }],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const result = await (manager as any).callChatJson({
      apiUrl: 'http://localhost',
      apiKey: 'key',
      model: 'test-model',
    }, 'prompt', 1000);

    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    expect(secondBody.response_format).toBeUndefined();
    expect(result.claims[0].claim).toBe('retry success');
  });

  it('matches chunk-level citations against a global reference index', () => {
    const entry = {
      id: 'entry-1',
      groupId: 'group-1',
      claim: 'Carbon availability increases N2O emissions',
      normalizedClaim: 'Carbon availability increases N2O emissions',
      sourcePdfIds: ['pdf_1'],
      sourcePdfNames: ['source.pdf'],
      sections: ['Discussion'],
      pro: [{
        stance: 'support',
        summary: 'DOC promoted N2O emissions.',
        evidence: 'DOC increased cumulative N2O emissions as reported by Smith et al. (2020) and [2].',
        section: 'Discussion',
        location: 'chunk-1',
        inTextCitations: [],
        references: [],
        sourcePdfId: 'pdf_1',
        sourcePdfName: 'source.pdf',
      }],
      con: [],
      neutral: [],
      inTextCitations: [],
      references: [],
      evidenceSnippets: ['DOC increased cumulative N2O emissions.'],
      updatedAt: new Date().toISOString(),
    };

    const referenceIndex = [{
      id: 'ref_1',
      raw: 'Smith J. 2020. Carbon availability and N2O emissions. Soil Biology. doi:10.1000/a',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 1,
      title: 'Carbon availability and N2O emissions',
      authors: 'Smith J.',
      year: '2020',
      journal: 'Soil Biology',
      doi: '10.1000/a',
    }, {
      id: 'ref_2',
      raw: 'Jones A. 2021. Denitrification controls. Global Change Biology. doi:10.1000/b',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 2,
      title: 'Denitrification controls',
      authors: 'Jones A.',
      year: '2021',
      journal: 'Global Change Biology',
      doi: '10.1000/b',
    }];

    const resolved = (manager as any).attachGlobalReferences([entry], referenceIndex);

    expect(resolved[0].references.map((ref: any) => ref.title)).toContain('Carbon availability and N2O emissions');
    expect(resolved[0].references.map((ref: any) => ref.title)).toContain('Denitrification controls');
    expect(resolved[0].pro[0].references).toHaveLength(2);
  });

  it('builds sentence-level reference hints with citation and BM25 candidates', () => {
    const references = [{
      id: 'ref_1',
      raw: 'Smith J. 2020. Carbon availability controls nitrous oxide emissions. Soil Biology. doi:10.1000/a',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 1,
      title: 'Carbon availability controls nitrous oxide emissions',
      authors: 'Smith J.',
      year: '2020',
      journal: 'Soil Biology',
      doi: '10.1000/a',
    }, {
      id: 'ref_2',
      raw: 'Zhao C. 2024. Alternate wetting and drying irrigation changes methane emissions from rice fields. Agricultural Water Management. doi:10.1000/b',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 2,
      title: 'Alternate wetting and drying irrigation changes methane emissions from rice fields',
      authors: 'Zhao C.',
      year: '2024',
      journal: 'Agricultural Water Management',
      doi: '10.1000/b',
    }];
    const sectionText = [
      'Carbon availability can increase nitrous oxide emissions in croplands (Smith et al., 2020).',
      'Alternate wetting and drying irrigation changes methane emissions from rice fields.',
    ].join(' ');

    const hints = (manager as any).formatSentenceReferenceHints('Introduction', sectionText, references, 'pdf_1');

    expect(hints).toContain('S1');
    expect(hints).toContain('Smith et al., 2020');
    expect(hints).toContain('Carbon availability controls nitrous oxide emissions');
    expect(hints).toContain('match=citation');
    expect(hints).toContain('Alternate wetting and drying irrigation changes methane emissions from rice fields');
    expect(hints).toContain('match=bm25');
  });

  it('uses explicit bare numeric citation markers instead of BM25-only matches for evidence references', () => {
    const references = [{
      id: 'ref_8',
      raw: 'Reference 8. Nitrogen losses and retention in ecosystems.',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 8,
      title: 'Nitrogen losses and retention in ecosystems',
      authors: 'Allen P.',
      year: '2018',
    }, {
      id: 'ref_10',
      raw: 'Reference 10. Ecosystem nitrogen cycling and N retention.',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 10,
      title: 'Ecosystem nitrogen cycling and N retention',
      authors: 'Baker J.',
      year: '2019',
    }, {
      id: 'ref_13',
      raw: 'Reference 13. Soil nitrogen isotope signals across ecosystems.',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 13,
      title: 'Soil nitrogen isotope signals across ecosystems',
      authors: 'Chen L.',
      year: '2020',
    }, {
      id: 'ref_28',
      raw: 'Liao, K., Lai, X. & Zhu, Q. Soil δ15N is a better indicator of ecosystem nitrogen cycling than plant δ15N: a global meta-analysis. Soil 7, 733-742 (2021).',
      sourcePdfId: 'pdf_1',
      sourcePdfName: 'source.pdf',
      index: 28,
      title: 'Soil δ15N is a better indicator of ecosystem nitrogen cycling than plant δ15N',
      authors: 'Liao K.; Lai X.; Zhu Q.',
      year: '2021',
      journal: 'Soil',
    }];
    const sentence = 'While interpreting these signals requires assuming quasi-steady-state conditions and minimal recent anthropogenic disturbance, soil δ15N effectively captures the cumulative balance between inputs and losses: higher δ15N values typically indicate greater N losses relative to the ecosystem’s N pool, implying more open N cycling and lower retention capacity; lower δ15N values suggest more effective N retention and conservative cycling8,10,13.';
    const matches = (manager as any).matchSectionSentencesToReferences('Introduction', sentence, references, 'pdf_1');

    expect(matches[0].citations).toEqual(['8,10,13']);
    expect(matches[0].candidates.map((candidate: any) => candidate.ref.index)).toEqual([8, 10, 13]);

    const sentenceEvidence = (manager as any).buildSentenceEvidenceMap('Introduction', sentence, references, 'pdf_1');
    const evidence = sentenceEvidence.get('introduction-s1');
    expect(evidence.references.map((ref: any) => ref.index)).toEqual([8, 10, 13]);

    const entry = (manager as any).createEntryFromClaim({
      claim: '土壤 δ15N 可以反映生态系统氮循环开放程度',
      section: 'Introduction',
      location: 'paragraph 1',
      evidence: sentence,
      evidenceSentenceIds: ['Introduction-S1'],
      referenceIndexes: [28],
      proViews: [{
        summary: '较高的土壤 δ15N 通常表明相对于氮库有更大的氮损失。',
        evidence: sentence,
        evidenceSentenceIds: ['Introduction-S1'],
        referenceIndexes: [28],
      }],
      conViews: [],
      neutralViews: [],
    }, {
      id: 'pdf_1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 1,
    }, 0, references, sentenceEvidence);

    expect(entry).toBeTruthy();
    expect(entry.pro[0].references.map((ref: any) => ref.index)).toEqual([8, 10, 13]);
    expect(entry.references.map((ref: any) => ref.index)).toEqual([8, 10, 13]);
  });

  it('builds and sanitizes a code-drawn PDF overview diagram for deep analysis', () => {
    const diagram = (manager as any).buildCodePdfOverviewDiagram({
      id: 'pdf_1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 1,
      title: 'Nitrogen Cycling Study',
      authors: 'Smith J.',
      year: '2025',
      journal: 'Soil Biology',
    }, {
      text: 'Abstract text',
      metadata: {},
      references: [],
      parser: 'fast-text',
    }, [
      '## 核心问题',
      '氮循环开放程度如何影响土壤氮保持能力。',
      '## 研究设计/方法',
      '- 通过全球样点和同位素指标进行比较。',
      '- 采用土壤与植物 δ15N 的跨区域对照。',
      '## 数据或样本',
      '全球土壤样点。',
      '## 主要发现',
      '土壤 δ15N 可以反映氮损失与保留。',
      '## 结论',
      '土壤指标比植物指标更适合表征生态系统氮循环。',
      '## 局限性',
      '需要准稳态假设。',
    ].join('\n\n'));

    expect(diagram.engine).toBe('code');
    expect(diagram.layoutVersion).toBe(7);
    expect(diagram.svg).toContain('<svg');
    expect(diagram.svg).toContain('Nitrogen Cycling Study');
    expect(diagram.svg).toContain('准稳态');
    expect(diagram.svg).toContain('#052e2b');
    expect(diagram.svg).toContain('markerWidth="4.2"');
    expect(diagram.svg).toContain('stroke-width="1.5"');
    expect(diagram.svg).toContain('>1</text>');
    expect(diagram.svg).toContain('>2</text>');

    const sanitized = (manager as any).sanitizeOverviewSvg('<svg onload="alert(1)"><script>alert(1)</script><text>ok</text></svg>');
    expect(sanitized).toContain('<svg');
    expect(sanitized).toContain('<text>ok</text>');
    expect(sanitized).not.toContain('script');
    expect(sanitized).not.toContain('onload');
  });

  it('keeps neutral-only viewpoints neutral instead of promoting them to support', () => {
    const entry = (manager as any).createEntryFromClaim({
      claim: '背景机制会影响土壤 N2O 排放',
      section: 'Introduction',
      location: 'paragraph 2',
      neutralViews: [{
        summary: '前人研究认为碳可利用性会影响反硝化过程。',
        evidence: 'Previous studies suggested that carbon availability can affect denitrification.',
        inTextCitations: ['Smith et al., 2020'],
      }],
      evidence: 'Previous studies suggested that carbon availability can affect denitrification.',
      inTextCitations: ['Smith et al., 2020'],
    }, {
      id: 'pdf_1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 1,
    }, 0, []);

    expect(entry).toBeTruthy();
    expect(entry.pro).toHaveLength(0);
    expect(entry.neutral).toHaveLength(1);
    expect(entry.neutral[0].stance).toBe('neutral');
  });

  it('drops viewpoints that cannot be bound to a source evidence sentence when sentence evidence is available', () => {
    const sentenceEvidence = new Map([[
      'Discussion-S1',
      {
        id: 'Discussion-S1',
        sectionName: 'Discussion',
        sentenceIndex: 0,
        sentence: 'Carbon availability increased N2O emissions in the incubation experiment.',
        citations: [],
        references: [],
      },
    ]]);
    const pdf = {
      id: 'pdf_1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 1,
    };

    const boundEntry = (manager as any).createEntryFromClaim({
      claim: '碳可利用性提高 N2O 排放',
      section: 'Discussion',
      proViews: [{
        summary: '实验中碳可利用性提高了 N2O 排放。',
        evidence: 'Carbon availability increased N2O emissions in the incubation experiment.',
      }],
      evidence: 'Carbon availability increased N2O emissions in the incubation experiment.',
    }, pdf, 1, [], sentenceEvidence);
    const unboundEntry = (manager as any).createEntryFromClaim({
      claim: '灌溉方式改变甲烷排放',
      section: 'Discussion',
      proViews: [{
        summary: '无法在当前章节句子中定位的观点。',
        evidence: 'Alternate wetting and drying reduced methane emissions in rice paddies.',
      }],
      evidence: 'Alternate wetting and drying reduced methane emissions in rice paddies.',
    }, pdf, 1, [], sentenceEvidence);

    expect(boundEntry).toBeTruthy();
    expect(boundEntry.pro[0].evidenceSentenceIds).toEqual(['Discussion-S1']);
    expect(unboundEntry).toBeNull();
  });

  it('filters over-broad AI merge groups and preserves source entry traces', () => {
    const entries = [
      createStoreEntry('a', 'Carbon availability increases N2O emissions'),
      createStoreEntry('b', 'Carbon availability increases N2O emissions in soils'),
      createStoreEntry('c', 'Alternate wetting reduces methane emissions'),
    ];

    const merged = (manager as any).mergeGroups(entries, [{
      normalizedClaim: 'Carbon availability increases N2O emissions',
      displayClaimZh: '碳可利用性提高 N2O 排放',
      entryIds: ['a', 'b', 'c'],
    }], []);

    const grouped = merged.find((entry: any) => entry.sourceEntryIds?.includes('a') && entry.sourceEntryIds?.includes('b'));
    const unmerged = merged.find((entry: any) => entry.id === 'c');

    expect(grouped).toBeTruthy();
    expect(grouped.sourceEntryIds).toEqual(['a', 'b']);
    expect(grouped.sourceEntries).toHaveLength(2);
    expect(unmerged).toBeTruthy();
    expect(unmerged.sourceEntryIds).toEqual(['c']);
  });

  it('parses GROBID TEI metadata, body text, and references', () => {
    const tei = `<?xml version="1.0" encoding="UTF-8"?>
<TEI>
  <teiHeader>
    <fileDesc>
      <sourceDesc>
        <biblStruct>
          <analytic>
            <title level="a" type="main">Extreme rainfall amplifies soil N2O emissions</title>
            <author><persName><forename type="first">Jane</forename><surname>Smith</surname></persName></author>
            <author><persName><forename type="first">Bo</forename><surname>Chen</surname></persName></author>
          </analytic>
          <monogr>
            <title level="j">Global Change Biology</title>
            <imprint><date type="published" when="2025-01-01"/></imprint>
          </monogr>
          <idno type="DOI">10.1000/example</idno>
        </biblStruct>
      </sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div><head>Discussion</head><p>Extreme rainfall increased N2O emissions by increasing DOC availability.</p></div>
    </body>
    <back>
      <listBibl>
        <biblStruct xml:id="b0">
          <analytic>
            <title level="a">Carbon availability controls N2O</title>
            <author><persName><forename type="first">John</forename><surname>Doe</surname></persName></author>
          </analytic>
          <monogr><title level="j">Soil Biology</title><imprint><date when="2020"/></imprint></monogr>
          <idno type="DOI">10.1000/ref</idno>
          <note type="raw_reference">Doe J. 2020. Carbon availability controls N2O. Soil Biology.</note>
        </biblStruct>
      </listBibl>
    </back>
  </text>
</TEI>`;

    const parsed = (manager as any).parseGrobidTei(tei, {
      id: 'pdf_1',
      originalName: 'source.pdf',
      fileName: 'source.pdf',
      filePath: 'source.pdf',
      size: 1,
    });

    expect(parsed.parser).toBe('grobid');
    expect(parsed.metadata.title).toBe('Extreme rainfall amplifies soil N2O emissions');
    expect(parsed.metadata.authors).toBe('Jane Smith; Bo Chen');
    expect(parsed.metadata.year).toBe('2025');
    expect(parsed.metadata.journal).toBe('Global Change Biology');
    expect(parsed.metadata.doi).toBe('10.1000/example');
    expect(parsed.text).toContain('Discussion');
    expect(parsed.text).toContain('Extreme rainfall increased N2O emissions');
    expect(parsed.references).toHaveLength(1);
    expect(parsed.references[0].title).toBe('Carbon availability controls N2O');
    expect(parsed.references[0].authors).toBe('John Doe');
    expect(parsed.references[0].doi).toBe('10.1000/ref');
  });

  it('uses Qwen-Long direct PDF upload before text extraction', async () => {
    vi.spyOn(manager as any, 'tryExtractPdfWithLiteParse').mockResolvedValue(null);
    const responses = mockQwenDirectPdfResponses('Carbon availability increases N2O emissions');
    const fetchMock = vi.fn();
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(response);
    }
    vi.stubGlobal('fetch', fetchMock);
    const textExtractionSpy = vi.spyOn(manager as any, 'extractPdfContent');

    await manager.processUploadedPdfs('web-user', [{
      originalname: 'direct.pdf',
      buffer: Buffer.from('%PDF-1.4\nmock\n%%EOF'),
      size: 20,
    }], {
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'key',
      model: 'qwen-long',
      jsonApiUrl: 'https://small.example/v1',
      jsonApiKey: 'small-key',
      jsonModel: 'small-json-model',
    });

    const store = await manager.getStore('web-user');

    expect(fetchMock.mock.calls[0][0]).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/files');
    expect(fetchMock.mock.calls[1][0]).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(fetchMock.mock.calls[2][0]).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(fetchMock.mock.calls[3][0]).toBe('https://small.example/v1/chat/completions');
    const qwenMetadataBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    const qwenClaimsBody = JSON.parse(fetchMock.mock.calls[2][1].body);
    const jsonClaimsBody = JSON.parse(fetchMock.mock.calls[3][1].body);
    expect(qwenMetadataBody.response_format).toBeUndefined();
    expect(qwenClaimsBody.response_format).toBeUndefined();
    expect(jsonClaimsBody.response_format).toEqual({ type: 'json_object' });
    expect(jsonClaimsBody.temperature).toBe(0);
    expect(jsonClaimsBody.model).toBe('small-json-model');
    expect(textExtractionSpy).not.toHaveBeenCalled();
    expect(store.pdfs[0].title).toBe('Direct PDF Title');
    expect(store.referenceIndex[0].title).toBe('Carbon availability controls N2O');
    expect(store.entries[0].claim).toBe('Carbon availability increases N2O emissions');
    expect(store.entries[0].pro[0].summary).toBe('Carbon availability increases N2O emissions support');
  }, 15_000);

  it('rebuilds an existing PDF when its wiki entries were cleared', async () => {
    vi.spyOn(manager as any, 'tryExtractPdfWithLiteParse').mockResolvedValue(null);
    const responses = [
      ...mockQwenDirectPdfResponses('First extracted claim'),
      ...mockQwenDirectPdfResponses('Rebuilt extracted claim'),
    ];
    const fetchMock = vi.fn();
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(response);
    }
    vi.stubGlobal('fetch', fetchMock);

    const file = {
      originalname: 'direct.pdf',
      buffer: Buffer.from('%PDF-1.4\nsame-content\n%%EOF'),
      size: 27,
    };
    const config = {
      apiUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'key',
      model: 'qwen-long',
    };

    await manager.processUploadedPdfs('web-user', [file], config);
    let store = await manager.getStore('web-user');
    expect(store.entries[0].claim).toBe('First extracted claim');

    await manager.deleteEntries('web-user', [store.entries[0].id]);
    expect((await manager.getStore('web-user')).entries).toHaveLength(0);

    await manager.processUploadedPdfs('web-user', [file], config);
    store = await manager.getStore('web-user');

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].claim).toBe('Rebuilt extracted claim');
    expect((await manager.getStatus('web-user')).entryCount).toBe(1);
  }, 15_000);

  it('deletes selected wiki entries from the persistent store', async () => {
    writeWikiStore(tempDir, 'web-user', [
      createStoreEntry('entry-a', 'Claim A'),
      createStoreEntry('entry-b', 'Claim B'),
    ]);

    const result = await manager.deleteEntries('web-user', ['entry-a']);
    const store = await manager.getStore('web-user');
    const status = await manager.getStatus('web-user');

    expect(result.deletedCount).toBe(1);
    expect(result.entryCount).toBe(1);
    expect(store.entries.map(entry => entry.id)).toEqual(['entry-b']);
    expect(status.entryCount).toBe(1);
  });

  it('deletes selected sentence-level claims and rebuilds topic metadata', async () => {
    writeWikiStore(tempDir, 'web-user', [
      createStoreEntry('entry-a', 'Compatibility claim'),
    ], [
      createSentencePoint('sentence-a', 'topic-a', 'pdf-a'),
      createSentencePoint('sentence-b', 'topic-a', 'pdf-b'),
      createSentencePoint('sentence-c', 'topic-b', 'pdf-c'),
    ]);

    const result = await manager.deleteSentencePoints('web-user', [
      'sentence-a',
      'sentence-a',
      'sentence-b',
      'missing-sentence',
    ]);
    const store = await manager.getStore('web-user');
    const status = await manager.getStatus('web-user');

    expect(result).toEqual({
      deletedCount: 2,
      missingCount: 1,
      sentencePointCount: 1,
      topicCount: 1,
    });
    expect(store.entries.map(entry => entry.id)).toEqual(['entry-a']);
    expect(store.sentenceCloud?.points.map(point => point.id)).toEqual(['sentence-c']);
    expect(store.sentenceCloud?.clouds).toHaveLength(1);
    expect(store.sentenceCloud?.clouds[0]).toMatchObject({
      topicKey: 'unclassified',
      pointIds: ['sentence-c'],
      sentenceCount: 1,
      referenceCount: 1,
      pdfIds: ['pdf-c'],
    });
    expect(status.sentencePointCount).toBe(1);
  });

  it('merges selected wiki entries into a manual claim group', async () => {
    writeWikiStore(tempDir, 'web-user', [
      createStoreEntry('entry-a', 'Claim A'),
      createStoreEntry('entry-b', 'Claim B'),
    ]);

    const result = await manager.mergeEntries('web-user', ['entry-a', 'entry-b'], 'Merged Claim');
    const store = await manager.getStore('web-user');

    expect(result.mergedCount).toBe(2);
    expect(result.entryCount).toBe(1);
    expect(store.entries).toHaveLength(1);
    expect(store.entries[0].id).toMatch(/^pdfwiki_manual_/);
    expect(store.entries[0].normalizedClaim).toBe('Merged Claim');
    expect(store.entries[0].sourcePdfIds).toEqual(['pdf-entry-a', 'pdf-entry-b']);
    expect(store.entries[0].pro).toHaveLength(2);
  });

  it('adds Chinese display names and similar claim links during smart grouping', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              claimTranslations: [
                { entryId: 'entry-a', displayClaimZh: '碳有效性促进 N2O 排放' },
                { entryId: 'entry-b', displayClaimZh: '碳供应增强氧化亚氮释放' },
                { entryId: 'entry-c', displayClaimZh: '土壤水分调控 N2O 排放' },
              ],
              groups: [
                {
                  normalizedClaim: 'Carbon availability increases N2O emissions',
                  displayClaimZh: '碳有效性促进 N2O 排放',
                  entryIds: ['entry-a', 'entry-b'],
                },
              ],
              similarPairs: [
                {
                  entryIds: ['entry-a', 'entry-c'],
                  similarity: 0.76,
                  reason: '都讨论 N2O 排放调控，但机制不同',
                },
              ],
            }),
          },
        }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const grouped = await (manager as any).groupEntriesAcrossPdfs([
      createStoreEntry('entry-a', 'Carbon availability increases N2O emissions'),
      createStoreEntry('entry-b', 'Carbon supply enhances nitrous oxide release'),
      createStoreEntry('entry-c', 'Soil moisture regulates N2O emissions'),
    ], {
      apiUrl: 'https://small.example/v1',
      apiKey: 'small-key',
      model: 'small-json-model',
    });

    expect(grouped).toHaveLength(2);
    const merged = grouped.find((entry: any) => entry.displayClaimZh === '碳有效性促进 N2O 排放');
    const similar = grouped.find((entry: any) => entry.displayClaimZh === '土壤水分调控 N2O 排放');
    expect(merged.sourceEntryIds).toEqual(['entry-a', 'entry-b']);
    expect(similar.similarClaims[0].entryId).toBe(merged.id);
    expect(similar.similarClaims[0].reason).toContain('机制不同');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.temperature).toBe(0);
  });

  it('falls back when smart grouping returns an empty response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '' } }] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const grouped = await (manager as any).groupEntriesAcrossPdfs([
      createStoreEntry('entry-a', 'Carbon availability increases N2O emissions'),
      createStoreEntry('entry-b', 'Soil moisture regulates N2O emissions'),
    ], {
      apiUrl: 'https://small.example/v1',
      apiKey: 'small-key',
      model: 'small-json-model',
    });

    expect(grouped).toHaveLength(2);
    expect(grouped[0].sourceEntryIds).toEqual(['entry-a']);
    expect(grouped[1].sourceEntryIds).toEqual(['entry-b']);
  });
});
