import { describe, expect, it } from 'vitest';
import {
  computeKeywordTags,
  filterLiteraturesByKeywords,
  manualMergeKeywords,
  paginateKeywordTags,
  summarizeEmbeddingLibrary,
  type LiteratureRecord,
  type OuterTagsConfig,
} from '../../src/literature/keyword-library';

const papers: LiteratureRecord[] = [
  {
    id: 'p1',
    title: 'N2O emissions from maize soils',
    author: 'A',
    year: 2024,
    journal: 'Soil Biology',
    abstract: 'Nitrous oxide emissions increased under fertilization.',
    keywords: ['N2O emissions', 'maize', 'fertilization'],
    embedding: [0.1, 0.2],
  },
  {
    id: 'p2',
    title: 'Nitrous oxide mitigation in wheat',
    author: 'B',
    year: 2023,
    journal: 'Agriculture',
    abstract: 'Nitrification inhibitors reduced nitrous oxide.',
    keywords: ['nitrous oxide', 'wheat', 'nitrification inhibitor'],
  },
  {
    id: 'p3',
    title: 'Yield response to irrigation',
    author: 'C',
    year: 2020,
    journal: 'Field Crops',
    abstract: 'Irrigation improved yield.',
    keywords: ['yield', 'irrigation'],
  },
];

describe('keyword-library', () => {
  it('counts keywords once per paper', () => {
    const tags = computeKeywordTags(papers);
    expect(tags.totalKeywords).toBeGreaterThan(5);
    expect(tags.tags.find(tag => tag.keyword === 'maize')?.count).toBe(1);
  });

  it('filters with quick AND semantics', () => {
    const result = filterLiteraturesByKeywords(papers, {
      keywords: ['N2O emissions', 'maize'],
      mode: 'AND',
    });
    expect(result.total).toBe(1);
    expect(result.papers[0].id).toBe('p1');
  });

  it('paginates filtered literature results', () => {
    const firstPage = filterLiteraturesByKeywords(papers, { limit: 2, offset: 0 });
    const secondPage = filterLiteraturesByKeywords(papers, { limit: 2, offset: 2 });

    expect(firstPage.total).toBe(3);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.papers.map(p => p.id)).toEqual(['p1', 'p2']);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.papers.map(p => p.id)).toEqual(['p3']);
  });

  it('paginates keyword tags after server-side query filtering', () => {
    const tags = computeKeywordTags(papers).tags;
    const page = paginateKeywordTags(tags, { query: 'nit', limit: 1, offset: 0 });

    expect(page.totalKeywords).toBe(2);
    expect(page.hasMore).toBe(true);
    expect(page.tags).toHaveLength(1);
  });

  it('matches merged tags by original keyword aliases', () => {
    const config: OuterTagsConfig = {
      mergedTags: [{
        name: 'nitrous oxide',
        originalKeywords: ['N2O emissions', 'nitrous oxide'],
        count: 2,
        literatureIds: ['p1', 'p2'],
      }],
      promotedTags: [],
    };

    const result = filterLiteraturesByKeywords(papers, {
      keywords: ['nitrous oxide'],
      mode: 'OR',
    }, config);

    expect(result.total).toBe(2);
    expect(result.papers.map(p => p.id)).toEqual(['p1', 'p2']);
  });

  it('combines merged tags with additional selected keywords using AND semantics', () => {
    const config: OuterTagsConfig = {
      mergedTags: [{
        name: 'nitrogen gas',
        originalKeywords: ['N2O emissions', 'nitrous oxide'],
        count: 2,
        literatureIds: ['p1', 'p2'],
      }],
      promotedTags: [],
    };

    const result = filterLiteraturesByKeywords(papers, {
      keywords: ['nitrogen gas', 'maize'],
      mode: 'AND',
    }, config);

    expect(result.total).toBe(1);
    expect(result.papers[0].id).toBe('p1');
  });

  it('returns merge metadata for selected keywords', () => {
    const result = manualMergeKeywords(papers, ['N2O emissions', 'nitrous oxide'], 'nitrous oxide');
    expect(result.count).toBe(2);
    expect(result.literatureIds.sort()).toEqual(['p1', 'p2']);
  });

  it('summarizes embedding and abstract coverage', () => {
    const summary = summarizeEmbeddingLibrary(papers);
    expect(summary.count).toBe(3);
    expect(summary.abstractCount).toBe(3);
    expect(summary.embeddingCount).toBe(1);
  });
});
