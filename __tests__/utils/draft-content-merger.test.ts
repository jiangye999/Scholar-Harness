import { describe, expect, it } from 'vitest';

import {
  extractEmbeddedTitleFromAbstractDraft,
  mergeDraftBodyUnique,
  mergeDraftChapterContent,
} from '../../src/utils/draft-content-merger';

describe('draft content merger', () => {
  it('keeps references at the end when adding a new paragraph', () => {
    const existing = [
      'Existing discussion paragraph.',
      '',
      '## References',
      '(Smith et al., 2024) Smith reference.',
    ].join('\n');
    const incoming = [
      'New mechanism paragraph.',
      '',
      '## References',
      '(Jones et al., 2025) Jones reference.',
    ].join('\n');

    const merged = mergeDraftChapterContent(existing, incoming, 'merge');
    expect(merged.indexOf('New mechanism paragraph.')).toBeLessThan(merged.indexOf('## References'));
    expect(merged).toContain('(Smith et al., 2024) Smith reference.');
    expect(merged).toContain('(Jones et al., 2025) Jones reference.');
    expect(merged.match(/## References/g)).toHaveLength(1);
  });

  it('replaces a chapter only when replace mode is explicit', () => {
    expect(mergeDraftChapterContent('Old chapter.', 'New chapter.', 'replace')).toBe('New chapter.');
    expect(mergeDraftChapterContent('Old chapter.', 'New paragraph.', 'merge')).toContain('Old chapter.');
  });

  it('does not duplicate content already contained in a complete revision', () => {
    expect(mergeDraftBodyUnique('Paragraph one.', 'Paragraph one.\n\nParagraph two.'))
      .toBe('Paragraph one.\n\nParagraph two.');
  });

  it('separates an embedded Title block from an Abstract draft', () => {
    expect(extractEmbeddedTitleFromAbstractDraft([
      'Title',
      '',
      'Soil moisture trajectories regulate nitrogen loss',
      '',
      'Abstract',
      '',
      'Changing precipitation regimes alter soil nitrogen emissions.',
    ].join('\n'))).toEqual({
      title: 'Soil moisture trajectories regulate nitrogen loss',
      abstract: 'Changing precipitation regimes alter soil nitrogen emissions.',
    });
  });
});
