import { describe, expect, it } from 'vitest';

import { isNonScientificPdfFigureRecord } from '../../src/utils/pdf-wiki-figure-filter';

describe('PDF Wiki figure filtering', () => {
  it('filters uncaptioned embedded assets from the title page', () => {
    expect(isNonScientificPdfFigureRecord({
      number: 'Figure 1',
      title: 'Embedded image from PDF page 1.',
      page: 1,
      source: 'embedded-image',
      width: 1200,
      height: 800,
    }, 'figure_001.png')).toBe(true);
  });

  it('filters legacy title-page assets with a falsely associated body caption', () => {
    expect(isNonScientificPdfFigureRecord({
      number: 'Fig. 1',
      title: 'summarizes the estimated land area under conservation agriculture',
      caption: 'A body paragraph mentions Fig. 1 but is not spatially bound to this image.',
      page: 1,
      source: 'embedded-image',
    }, 'figure_001.png')).toBe(true);
  });

  it('keeps a title-page scientific figure when an explicit caption is present', () => {
    expect(isNonScientificPdfFigureRecord({
      number: 'Figure 1',
      title: 'Effects of nitrogen addition on cumulative N2O emissions',
      caption: 'Figure 1. Effects of nitrogen addition on cumulative N2O emissions.',
      page: 1,
      source: 'embedded-image',
      width: 1200,
      height: 800,
    }, 'figure_001.png')).toBe(false);
  });

  it('filters publisher covers, logos and uncaptioned tiny embedded assets', () => {
    expect(isNonScientificPdfFigureRecord({
      title: 'GEODERMA journal cover',
      page: 1,
      source: 'embedded-image',
    }, 'cover.png')).toBe(true);

    expect(isNonScientificPdfFigureRecord({
      title: 'Embedded image from PDF page 4.',
      page: 4,
      source: 'embedded-image',
      width: 400,
      height: 80,
      pageAreaRatio: 0.01,
    }, 'publisher_mark.png')).toBe(true);
  });

  it('keeps later-page data figures with real captions', () => {
    expect(isNonScientificPdfFigureRecord({
      title: 'Treatment effects by soil texture',
      caption: 'Fig. 3. Treatment effects by soil texture.',
      page: 6,
      source: 'caption-crop',
      width: 1400,
      height: 900,
    }, 'figure_003.png')).toBe(false);
  });
});
