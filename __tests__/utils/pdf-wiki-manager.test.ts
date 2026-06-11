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

function writeWikiStore(tempDir: string, userId: string, entries: any[]): void {
  const wikiDir = path.join(tempDir, 'uploads', userId, 'pdf-wiki');
  fs.mkdirSync(wikiDir, { recursive: true });
  fs.writeFileSync(path.join(wikiDir, 'wiki.json'), JSON.stringify({
    version: 1,
    userId,
    generatedAt: new Date().toISOString(),
    pdfs: [],
    referenceIndex: [],
    entries,
  }, null, 2), 'utf-8');
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
        topicLabel: '氮肥减排',
        topicKey: 'nitrogen-mitigation',
        keywords: ['nitrogen fertilizer', 'N2O'],
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
    expect(refined[0].topicLabel).toBe('氮肥减排');
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
    expect(diagram.layoutVersion).toBe(5);
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
  });

  it('rebuilds an existing PDF when its wiki entries were cleared', async () => {
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
  });

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
