import { describe, expect, it } from 'vitest';

import {
  identifyWordSidebarChapter,
  parseWordSidebarHtml,
} from '../../../src/server/services/word-sidebar-import';

describe('Word sidebar import parser', () => {
  it('recognizes standard English and Chinese manuscript chapters', () => {
    expect(identifyWordSidebarChapter('1. Introduction')).toEqual({
      key: 'introduction',
      title: 'Introduction',
    });
    expect(identifyWordSidebarChapter('2 材料与方法')).toEqual({
      key: 'methods',
      title: 'Materials and Methods',
    });
    expect(identifyWordSidebarChapter('Results and Discussion')).toEqual({
      key: 'results_discussion',
      title: 'Results and Discussion',
    });
    expect(identifyWordSidebarChapter('4. Discussion and implications')).toEqual({
      key: 'discussion',
      title: 'Discussion',
    });
  });

  it('recognizes a Discussion heading when Word keeps the heading and body in one paragraph', () => {
    const result = parseWordSidebarHtml([
      '<h1>Results</h1>',
      '<p>The treatment changed N2O emissions.</p>',
      '<p><strong>4. Discussion</strong>The response reflects substrate limitation.</p>',
      '<p>These findings agree with the proposed mechanism.</p>',
    ].join(''), []);

    expect(result.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'results',
        content: 'The treatment changed N2O emissions.',
      }),
      expect.objectContaining({
        key: 'discussion',
        content: expect.stringContaining('substrate limitation'),
      }),
    ]));
    expect(result.sections.find(section => section.key === 'discussion')?.content)
      .toContain('proposed mechanism');
  });

  it('builds chapter drafts and binds an embedded figure to its caption and chapter', () => {
    const result = parseWordSidebarHtml([
      '<h1>Title</h1>',
      '<p>Soil moisture controls gaseous nitrogen responses</p>',
      '<h1>Abstract</h1>',
      '<p>This study tested contrasting precipitation regimes.</p>',
      '<h1>Results</h1>',
      '<h2>3.1 Gas fluxes</h2>',
      '<p>N2O emissions increased after rewetting.</p>',
      '<p><img src="word-sidebar-image://0" /></p>',
      '<p>Figure 1-a. N2O responses across treatments.</p>',
      '<h1>Discussion</h1>',
      '<p>The pulse response was associated with substrate availability.</p>',
    ].join(''), [{
      index: 0,
      contentType: 'image/png',
      buffer: Buffer.from('png'),
    }]);

    expect(result.sections).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: 'abstract',
        content: expect.stringContaining('contrasting precipitation regimes'),
      }),
      expect.objectContaining({
        key: 'results',
        content: expect.stringContaining('\\subsection{3.1 Gas fluxes}'),
      }),
      expect.objectContaining({
        key: 'discussion',
        content: expect.stringContaining('substrate availability'),
      }),
    ]));
    expect(result.images).toHaveLength(1);
    expect(result.images[0]).toMatchObject({
      figureLabel: 'Figure 1-a',
      chapterKey: 'results',
      chapterTitle: 'Results',
    });
    expect(result.images[0].caption).toContain('N2O responses');
  });

  it('does not overwrite a chapter when no standard chapter heading is present', () => {
    const result = parseWordSidebarHtml(
      '<p>A manuscript paragraph without a recognizable section heading.</p>',
      [],
    );
    expect(result.sections).toEqual([]);
    expect(result.warnings.join(' ')).toContain('未识别到标准章节标题');
  });
});
