import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { HybridRetrievalEngine } from '../../src/literature/retrieval/hybrid-engine';
import type { UnifiedLiterature } from '../../src/types/literature';

function makeLiterature(
  id: string,
  abstract: string,
  embeddingText: string
): UnifiedLiterature {
  return {
    id,
    title: `Extreme rainfall and N2O ${id}`,
    authors: [{ name: 'Tester' }],
    author: 'Tester',
    year: 2024,
    abstract,
    keywords: ['extreme rainfall', 'N2O'],
    journal: 'Test Journal',
    documentType: 'article',
    source: 'wos',
    embeddingText,
    evidenceAttachment: {
      kind: 'pdf-wiki-sentence',
      sentenceId: id,
      sentence: abstract,
      sourcePdfId: `pdf-${id}`,
      sourcePdfName: `${id}.pdf`,
      section: 'Discussion',
      sentenceIndex: 1,
      citations: ['[1]'],
      referenceIndexes: [1],
      references: [{ id: `ref-${id}`, index: 1, title: `Reference ${id}` }],
    },
  };
}

describe('HybridRetrievalEngine cascade retrieval', () => {
  const originalFetch = globalThis.fetch;
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('runs BM25 coarse screening before lazily embedding and reranking candidates', async () => {
    const embeddedInputs: string[] = [];
    let embeddingRequest = 0;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      embeddingRequest += 1;
      const body = JSON.parse(String(init?.body || '{}')) as { input?: string[] };
      const inputs = Array.isArray(body.input) ? body.input : [];
      embeddedInputs.push(...inputs);
      const data = inputs.map((text, index) => {
        if (embeddingRequest === 1) return { index, embedding: [1, 0] };
        if (text.includes('strong-semantic-candidate')) return { index, embedding: [0.99, 0.01] };
        return { index, embedding: [0.05, 0.99] };
      });
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as typeof fetch;

    const engine = new HybridRetrievalEngine({
      bm25: {
        topN: 2,
        k1: 1.5,
        b: 0.75,
        fieldWeights: {
          title: 3,
          keywords: 2.5,
          abstract: 1.5,
          authors: 0.5,
          journal: 0.3,
        },
      },
      vector: {
        topN: 2,
        model: 'test-embedding',
        dimensions: 2,
        similarity: 'cosine',
      },
      reranker: {
        enabled: true,
        topN: 2,
        candidateTopN: 2,
      },
    }, {
      url: 'https://embedding.test/v1',
      key: 'test-key',
    });

    const weak = makeLiterature(
      'weak',
      'Extreme rainfall and N2O are mentioned without a direct result.',
      'weak-semantic-candidate'
    );
    const strong = makeLiterature(
      'strong',
      'Extreme rainfall increased cropland N2O emissions.',
      'strong-semantic-candidate'
    );
    const excluded = {
      ...makeLiterature('excluded', 'Unrelated biodiversity observation.', 'must-not-be-embedded'),
      title: 'Unrelated biodiversity observation',
      keywords: ['biodiversity'],
    };

    await engine.index([weak, strong, excluded]);
    expect(globalThis.fetch).not.toHaveBeenCalled();

    const cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'hybrid-cascade-'));
    temporaryDirectories.push(cacheDirectory);
    engine.setPersistenceDirectory(cacheDirectory);

    const result = await engine.retrieve({
      query: 'extreme rainfall increases N2O emissions',
      topK: 2,
      searchMode: 'hybrid',
    });

    expect(result.results[0].id).toBe('strong');
    expect(result.results[0].vectorScore).toBeGreaterThan(result.results[1].vectorScore || 0);
    expect(result.results[0].bm25Score).toBeDefined();
    expect(result.results[0].rerankScore).toBeDefined();
    expect(result.results[0].evidenceAttachment?.sourcePdfName).toBe('strong.pdf');
    expect(result.pipeline).toMatchObject({
      strategy: 'bm25-embedding-reranker',
      bm25CandidateCount: 2,
      vectorCandidateCount: 2,
      embeddingConfigured: true,
    });
    expect(embeddedInputs).toContain('strong-semantic-candidate');
    expect(embeddedInputs).toContain('weak-semantic-candidate');
    expect(embeddedInputs).not.toContain('must-not-be-embedded');

    const vectorIndex = JSON.parse(
      fs.readFileSync(path.join(cacheDirectory, 'vector-index.json'), 'utf-8')
    ) as { version: number; documents: Array<{ id: string; embedding?: number[] }> };
    expect(vectorIndex.version).toBe(3);
    expect(vectorIndex.documents.find(document => document.id === 'strong')?.embedding).toEqual([0.99, 0.01]);

    const reloaded = new HybridRetrievalEngine({
      vector: {
        topN: 2,
        model: 'test-embedding',
        dimensions: 2,
        similarity: 'cosine',
      },
    }, {
      url: 'https://embedding.test/v1',
      key: 'test-key',
    });
    expect(reloaded.loadIndex(cacheDirectory)).toBe(true);
    expect(reloaded.getLiterature('strong')?.evidenceAttachment).toMatchObject({
      sentenceId: 'strong',
      sourcePdfName: 'strong.pdf',
      referenceIndexes: [1],
    });
  });

  it('falls back to BM25 without creating fake vectors when the Embedding API is absent', async () => {
    globalThis.fetch = vi.fn() as typeof fetch;
    const engine = new HybridRetrievalEngine({
      reranker: {
        enabled: true,
        topN: 5,
        candidateTopN: 5,
      },
    });
    await engine.index([
      makeLiterature('bm25', 'Extreme rainfall increased N2O emissions.', 'candidate'),
    ]);

    const result = await engine.retrieve({
      query: 'extreme rainfall N2O',
      topK: 1,
      searchMode: 'hybrid',
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0].id).toBe('bm25');
    expect(result.results[0].vectorScore).toBe(0);
    expect(result.pipeline).toMatchObject({
      strategy: 'bm25-fallback',
      embeddingConfigured: false,
      fallbackReason: 'embedding-not-configured',
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
