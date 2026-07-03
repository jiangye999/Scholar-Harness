import { describe, expect, it } from 'vitest';
import { buildFigureDraftBlock, insertFigureBlockIntoDraft, normalizeDraftAssetChapterKey } from '../../src/server/routes/draft-assets';

describe('draft figure assets', () => {
  it('normalizes common chapter names to existing draft keys', () => {
    expect(normalizeDraftAssetChapterKey('Results')).toBe('results');
    expect(normalizeDraftAssetChapterKey('讨论')).toBe('discussion');
    expect(normalizeDraftAssetChapterKey('../自定义章节')).toBe('_自定义章节');
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
});
