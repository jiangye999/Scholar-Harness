import { describe, expect, it } from 'vitest';
import {
  buildDraftFigureFileStem,
  buildFigureDraftBlock,
  insertFigureBlockIntoDraft,
  normalizeDraftAssetChapterKey,
  removeFigureBlockFromDraft,
  sortDraftFigureAssetsForDisplay,
  type DraftFigureAsset,
} from '../../src/server/routes/draft-assets';

describe('draft figure assets', () => {
  it('normalizes common chapter names to existing draft keys', () => {
    expect(normalizeDraftAssetChapterKey('Results')).toBe('results');
    expect(normalizeDraftAssetChapterKey('讨论')).toBe('discussion');
    expect(normalizeDraftAssetChapterKey('../自定义章节')).toBe('_自定义章节');
  });

  it('builds a stable paper figure file name from user metadata', () => {
    expect(buildDraftFigureFileStem('Figure 2(a)', 'Seasonal N2O flux', '')).toBe('Figure_2(a)_Seasonal_N2O_flux');
    expect(buildDraftFigureFileStem('Figure 2', 'ignored', 'spring maize: N2O?.png')).toBe('spring_maize_N2O_');
  });

  it('inserts a figure block into an existing subsection', () => {
    const block = buildFigureDraftBlock({
      id: 'fig_test123',
      figureLabel: 'Figure 3',
      caption: 'N2O flux by treatment.',
      filePath: 'E:/project/data/uploads/web-user/draft-assets/results/3.2/fig_test123.png',
    });

    const draft = [
      '\\subsection{3.1 Site conditions}',
      'Site text.',
      '',
      '\\subsection{3.2 Treatment effects}',
      'Result text.',
      '',
      '\\subsection{3.3 Mechanisms}',
      'Mechanism text.',
    ].join('\n');

    const next = insertFigureBlockIntoDraft(draft, block, '3.2', 'Treatment effects');

    expect(next).toContain('% scholar-figure:fig_test123');
    expect(next.indexOf('% scholar-figure:fig_test123')).toBeGreaterThan(next.indexOf('\\subsection{3.2 Treatment effects}'));
    expect(next.indexOf('% scholar-figure:fig_test123')).toBeLessThan(next.indexOf('\\subsection{3.3 Mechanisms}'));
  });

  it('creates a subsection when the target subsection is missing', () => {
    const block = buildFigureDraftBlock({
      id: 'fig_new123',
      figureLabel: 'Figure 4',
      caption: 'Seasonal trend.',
      filePath: 'E:/project/data/uploads/web-user/draft-assets/results/3.4/fig_new123.png',
    });

    const next = insertFigureBlockIntoDraft('Existing results text.', block, '3.4', 'Seasonal dynamics');

    expect(next).toContain('\\subsection{3.4 Seasonal dynamics}');
    expect(next).toContain('% scholar-figure:fig_new123');
  });

  it('removes only the selected figure block from a chapter draft', () => {
    const firstBlock = buildFigureDraftBlock({
      id: 'fig_remove123',
      figureLabel: 'Figure 5',
      caption: 'Figure to remove.',
      filePath: 'E:/project/fig_remove123.png',
    });
    const secondBlock = buildFigureDraftBlock({
      id: 'fig_keep456',
      figureLabel: 'Figure 6',
      caption: 'Figure to keep.',
      filePath: 'E:/project/fig_keep456.png',
    });
    const draft = ['Results text.', firstBlock, secondBlock, 'Closing text.'].join('\n\n');

    const next = removeFigureBlockFromDraft(draft, 'fig_remove123');

    expect(next).not.toContain('scholar-figure:fig_remove123');
    expect(next).not.toContain('Figure to remove.');
    expect(next).toContain('scholar-figure:fig_keep456');
    expect(next).toContain('Figure to keep.');
    expect(next).toContain('Results text.');
    expect(next).toContain('Closing text.');
  });

  it('keeps figures from the same Word import in document order', () => {
    const makeAsset = (
      id: string,
      figureLabel: string,
      figureIndex: number | undefined,
      createdAt: string,
    ): DraftFigureAsset => ({
      id,
      userId: 'web-user',
      chapterName: 'Results',
      chapterKey: 'results',
      subsectionKey: 'word-import',
      figureLabel,
      title: figureLabel,
      caption: figureLabel,
      originalFileName: `${id}.png`,
      fileName: `${id}.png`,
      filePath: `E:/project/${id}.png`,
      relativePath: `${id}.png`,
      url: `/api/draft-assets/figure/web-user/${id}`,
      source: {
        kind: 'word-import',
        documentName: 'paper.docx',
        importId: 'word_import_1',
        figureIndex,
      },
      draftLinked: false,
      createdAt,
    });
    const figures = [
      makeAsset('figure-3', 'Figure 3', 2, '2026-07-29T10:00:03.000Z'),
      makeAsset('figure-1', 'Figure 1', 0, '2026-07-29T10:00:01.000Z'),
      makeAsset('figure-2', 'Figure 2', 1, '2026-07-29T10:00:02.000Z'),
    ];

    expect(sortDraftFigureAssetsForDisplay(figures).map(asset => asset.figureLabel))
      .toEqual(['Figure 1', 'Figure 2', 'Figure 3']);
  });

  it('repairs the order of legacy Word figures without a stored figure index', () => {
    const base = {
      userId: 'web-user',
      chapterName: 'Results',
      chapterKey: 'results',
      subsectionKey: 'word-import',
      title: '',
      caption: '',
      originalFileName: '',
      fileName: '',
      filePath: '',
      relativePath: '',
      url: '',
      source: {
        kind: 'word-import' as const,
        documentName: 'legacy.docx',
        importId: 'legacy-import',
      },
      draftLinked: false,
    };
    const figures: DraftFigureAsset[] = [
      { ...base, id: 'f10', figureLabel: 'Figure 10', createdAt: '2026-07-29T10:00:10.000Z' },
      { ...base, id: 'f2', figureLabel: 'Figure 2', createdAt: '2026-07-29T10:00:02.000Z' },
      { ...base, id: 'f1', figureLabel: 'Figure 1', createdAt: '2026-07-29T10:00:01.000Z' },
    ];

    expect(sortDraftFigureAssetsForDisplay(figures).map(asset => asset.figureLabel))
      .toEqual(['Figure 1', 'Figure 2', 'Figure 10']);
  });
});
