import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LiteratureCollectionManager } from '../../src/utils/literature-collection-manager';

async function waitForJob(
  manager: LiteratureCollectionManager,
  userId: string,
  jobId: string,
): Promise<ReturnType<LiteratureCollectionManager['getJob']>> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const job = manager.getJob(userId, jobId);
    if (job && ['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for literature collection job');
}

describe('LiteratureCollectionManager', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-harness-collection-'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates a conservative local search plan when no AI runtime is configured', async () => {
    const manager = new LiteratureCollectionManager({ dataDir });
    const plan = await manager.planTopic({
      userId: 'tester',
      topic: '极端降雨与农田氧化亚氮排放',
      yearFrom: 2010,
      yearTo: 2025,
      documentTypes: ['Article', 'Review'],
    });

    expect(plan.provider).toBe('local');
    expect(plan.wosQuery).toContain('TS=(');
    expect(plan.wosQuery).toContain('PY=(2010-2025)');
    expect(plan.cnkiQuery).toContain('极端降雨');
  });

  it('persists WoS jobs, normalizes Starter records, and deduplicates repeated imports', async () => {
    const payload = {
      metadata: { total: 2, page: 1, limit: 50 },
      hits: [
        {
          uid: 'WOS:0001',
          title: 'Extreme rainfall increases agricultural nitrous oxide emissions',
          types: ['Article'],
          source: {
            sourceTitle: 'Global Change Biology',
            publishYear: 2024,
            volume: '30',
            issue: '2',
            pages: { range: '100-112' },
          },
          names: { authors: [{ displayName: 'Wang, Jie' }, { displayName: 'Li, Ming' }] },
          identifiers: { doi: '10.1000/example.1' },
          abstract: 'Field measurements showed that extreme rainfall increased soil nitrous oxide emissions.',
          keywords: {
            authorKeywords: ['extreme rainfall', 'nitrous oxide'],
            keywordsPlus: ['agriculture'],
          },
        },
        {
          uid: 'WOS:0002',
          title: 'Rainfall pulses regulate soil nitrogen cycling',
          types: ['Review'],
          source: {
            sourceTitle: 'Agriculture Ecosystems & Environment',
            publishYear: 2023,
          },
          names: { authors: [{ displayName: 'Zhang, Hua' }] },
          identifiers: { doi: '10.1000/example.2' },
          abstract: 'This review summarizes rainfall-pulse controls on agricultural nitrogen cycling.',
          keywords: { authorKeywords: ['rainfall pulse', 'nitrogen cycling'] },
        },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const manager = new LiteratureCollectionManager({ dataDir });
    manager.saveConfig('tester', {
      wosApiKey: 'test-key',
      wosMode: 'starter',
    });

    const first = manager.createJob({
      userId: 'tester',
      source: 'wos-starter',
      topic: 'rainfall and N2O',
      query: 'TS=("rainfall" AND "nitrous oxide")',
      maxRecords: 2,
      importToBibliometrics: false,
    });
    const firstResult = await waitForJob(manager, 'tester', first.id);

    expect(firstResult?.status).toBe('completed');
    expect(firstResult?.recordsFetched).toBe(2);
    expect(firstResult?.importResult?.addedRecords).toBe(2);
    expect(firstResult?.importResult?.duplicateRecords).toBe(0);

    const literaturePath = path.join(dataDir, 'uploads', 'tester', 'literature.json');
    const literature = JSON.parse(fs.readFileSync(literaturePath, 'utf-8'));
    expect(literature.papers).toHaveLength(2);
    expect(literature.papers[0]).toMatchObject({
      title: 'Extreme rainfall increases agricultural nitrous oxide emissions',
      journal: 'Global Change Biology',
      year: 2024,
      doi: '10.1000/example.1',
      volume: '30',
      issue: '2',
      pages: '100-112',
      abstract: 'Field measurements showed that extreme rainfall increased soil nitrous oxide emissions.',
    });
    expect(literature.papers[0].keywords).toEqual([
      'extreme rainfall',
      'nitrous oxide',
      'agriculture',
    ]);

    const second = manager.createJob({
      userId: 'tester',
      source: 'wos-starter',
      topic: 'rainfall and N2O repeat',
      query: 'TS=("rainfall" AND "nitrous oxide")',
      maxRecords: 2,
      importToBibliometrics: false,
    });
    const secondResult = await waitForJob(manager, 'tester', second.id);

    expect(secondResult?.status).toBe('completed');
    expect(secondResult?.importResult?.addedRecords).toBe(0);
    expect(secondResult?.importResult?.duplicateRecords).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects Starter jobs that try to enter bibliometrics', () => {
    const manager = new LiteratureCollectionManager({ dataDir });
    expect(() => manager.createJob({
      userId: 'tester',
      source: 'wos-starter',
      topic: 'starter record',
      query: 'TS=("starter record")',
      importToBibliometrics: true,
    })).toThrow(/Expanded API.*Full Record/);
  });

  it('does not import records without abstracts', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      metadata: { total: 1, page: 1, limit: 50 },
      hits: [{
        uid: 'WOS:NO-ABSTRACT',
        title: 'A basic record without an abstract',
        source: { sourceTitle: 'Example Journal', publishYear: 2025 },
        names: { authors: [{ displayName: 'Example, A' }] },
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const manager = new LiteratureCollectionManager({ dataDir });
    manager.saveConfig('tester', { wosApiKey: 'test-key' });
    const job = manager.createJob({
      userId: 'tester',
      source: 'wos-starter',
      topic: 'missing abstract',
      query: 'TS=("missing abstract")',
      maxRecords: 1,
      importToBibliometrics: false,
    });
    const result = await waitForJob(manager, 'tester', job.id);

    expect(result?.status).toBe('failed');
    expect(result?.error).toMatch(/缺少摘要|Starter/);
    expect(fs.existsSync(path.join(dataDir, 'uploads', 'tester', 'literature.json'))).toBe(false);
    expect(fs.existsSync(path.join(job.durableRoot, 'rejected-missing-abstract.json'))).toBe(true);
  });

  it('imports Expanded Full Records with abstracts into bibliometrics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      QueryResult: { RecordsFound: 1 },
      Data: {
        Records: {
          records: {
            REC: [{
              UID: 'WOS:FULL-RECORD-1',
              static_data: {
                summary: {
                  titles: {
                    title: [
                      { type: 'item', content: 'A complete Expanded API record' },
                      { type: 'source', content: 'Complete Records Journal' },
                    ],
                  },
                  names: {
                    name: [{ full_name: 'Example, Alice' }],
                  },
                  pub_info: { pubyear: 2025, vol: '12', issue: '3' },
                  doctypes: { doctype: 'Article' },
                },
                fullrecord_metadata: {
                  abstracts: {
                    abstract: {
                      abstract_text: {
                        p: 'This complete abstract makes the record eligible for both libraries.',
                      },
                    },
                  },
                  keywords: { keyword: ['full record', 'abstract'] },
                  category_info: {
                    subjects: { subject: ['Environmental Sciences'] },
                  },
                  references: {
                    reference: [{ content: 'Example A, 2020, COMPLETE RECORDS JOURNAL' }],
                  },
                },
              },
              dynamic_data: {
                cluster_related: {
                  identifiers: {
                    identifier: [{ type: 'doi', value: '10.1000/full-record' }],
                  },
                },
              },
            }],
          },
        },
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));
    let importedText = '';
    const manager = new LiteratureCollectionManager({
      dataDir,
      importWosPlainText: ({ content }) => {
        importedText = content;
      },
    });
    manager.saveConfig('tester', { wosApiKey: 'test-key', wosMode: 'expanded' });
    const job = manager.createJob({
      userId: 'tester',
      source: 'wos-expanded',
      topic: 'full records',
      query: 'TS=("full records")',
      maxRecords: 1,
    });
    const result = await waitForJob(manager, 'tester', job.id);

    expect(result?.status).toBe('completed');
    expect(result?.recordsEligible).toBe(1);
    expect(result?.missingAbstractRecords).toBe(0);
    expect(result?.importResult?.bibliometricsImported).toBe(true);
    expect(importedText).toContain('AF Example, Alice');
    expect(importedText).toContain('AB This complete abstract');
    expect(importedText).toContain('UT WOS:FULL-RECORD-1');
  });

  it('uses the configured Starter API only for bounded recent discovery', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      metadata: { total: 1 },
      hits: [{
        uid: 'WOS:RECENT-1',
        title: 'Recent soil carbon evidence',
        abstract: 'A recent abstract suitable for downstream screening.',
        source: { sourceTitle: 'Soil Biology', publishYear: 2026, publishDate: '2026-08-19' },
        names: { authors: [{ displayName: 'Researcher, A' }] },
        identifiers: { doi: '10.1000/recent-wos' },
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const manager = new LiteratureCollectionManager({ dataDir });
    manager.saveConfig('tester', { wosApiKey: 'starter-key', wosMode: 'starter' });

    const result = await manager.discoverWos({
      userId: 'tester',
      terms: ['soil carbon', 'microbial necromass'],
      dateFrom: '2026-08-18',
      dateTo: '2026-08-19',
      limit: 10,
    });

    expect(result.mode).toBe('starter');
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      sourceRecordId: 'WOS:RECENT-1',
      publishedAt: '2026-08-19',
      doi: '10.1000/recent-wos',
    });
    const requestedUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(requestedUrl.pathname).toContain('/wos-starter/v1/documents');
    expect(requestedUrl.searchParams.get('modified_time_span')).toBe('2026-08-18+2026-08-19');
    expect(requestedUrl.searchParams.get('q')).toContain('TS=(');
  });

  it('imports a WoS Full Record file into the literature library and bibliometrics hook', async () => {
    const importedFiles: string[] = [];
    const manager = new LiteratureCollectionManager({
      dataDir,
      importWosPlainText: ({ fileName }) => {
        importedFiles.push(fileName);
      },
    });
    const content = [
      'FN Clarivate Web of Science',
      'VR 1.0',
      'PT J',
      'AU Researcher, A',
      'AF Alice Researcher',
      'TI A manually exported full record',
      'SO Complete Journal',
      'AB This abstract is complete enough for recommendation and retrieval.',
      'DE soil carbon; evidence synthesis',
      'PY 2026',
      'DI 10.1000/manual-full-record',
      'UT WOS:MANUAL-FULL-1',
      'CR Example A, 2024, COMPLETE JOURNAL',
      'ER',
      'EF',
    ].join('\n');

    const result = await manager.importWosPlainTextFiles({
      userId: 'tester',
      files: [{ fileName: 'savedrecs.txt', content }],
    });

    expect(result).toMatchObject({
      filesImported: 1,
      addedRecords: 1,
      missingAbstractRecords: 0,
      bibliometricsImported: true,
    });
    expect(importedFiles).toEqual(['savedrecs.txt']);
    const library = JSON.parse(fs.readFileSync(path.join(dataDir, 'uploads', 'tester', 'literature.json'), 'utf-8'));
    expect(library.papers[0]).toMatchObject({
      title: 'A manually exported full record',
      doi: '10.1000/manual-full-record',
      abstract: 'This abstract is complete enough for recommendation and retrieval.',
    });
  });

  it('creates a CNKI assisted handoff without attempting hidden automation', () => {
    const manager = new LiteratureCollectionManager({ dataDir });
    const job = manager.createJob({
      userId: 'tester',
      source: 'cnki-assisted',
      topic: '农业面源污染',
      query: '主题=(农业面源污染 OR 农田氮损失)',
    });

    expect(job.status).toBe('awaiting-user');
    expect(job.statusMessage).toContain('用户登录');
  });
});
