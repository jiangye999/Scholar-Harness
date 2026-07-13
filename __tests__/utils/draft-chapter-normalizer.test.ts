import { describe, expect, it } from 'vitest';

import {
  isNumberedDraftSubsection,
  normalizeDraftChapterContent,
  normalizeNestedDraftSectionMarkup,
} from '../../src/utils/draft-chapter-normalizer';

describe('draft chapter hierarchy normalizer', () => {
  it('recognizes dotted subsection numbers but not top-level chapter numbers', () => {
    expect(isNumberedDraftSubsection('3.3 Summer maize emissions')).toBe(true);
    expect(isNumberedDraftSubsection('3.3.1 Peak response')).toBe(true);
    expect(isNumberedDraftSubsection('3. Results')).toBe(false);
    expect(isNumberedDraftSubsection('Results')).toBe(false);
  });

  it('demotes numbered nested sections without changing a top-level section', () => {
    const content = [
      '\\section{Results}',
      'Overview.',
      '\\section{3.3 Summer maize emissions}',
      'Subsection body.',
    ].join('\n');

    expect(normalizeNestedDraftSectionMarkup(content)).toBe([
      '\\section{Results}',
      'Overview.',
      '\\subsection*{3.3 Summer maize emissions}',
      'Subsection body.',
    ].join('\n'));
  });

  it('keeps only the latest revision of each numbered subsection and sorts them', () => {
    const content = [
      'Results overview.',
      '\\section{3.4 Cross-system comparison}',
      'Old 3.4 text.',
      '\\section*{3.3 Summer maize emissions}',
      'Current 3.3 text.',
      '\\section{3.4 Cross-system comparison revised}',
      'Current 3.4 text.',
    ].join('\n');

    const normalized = normalizeDraftChapterContent(content);
    expect(normalized).toContain('Results overview.');
    expect(normalized).toContain('\\subsection*{3.3 Summer maize emissions}');
    expect(normalized).toContain('Current 3.3 text.');
    expect(normalized).toContain('\\subsection*{3.4 Cross-system comparison revised}');
    expect(normalized).toContain('Current 3.4 text.');
    expect(normalized).not.toContain('Old 3.4 text.');
    expect(normalized.indexOf('3.3 Summer')).toBeLessThan(normalized.indexOf('3.4 Cross-system'));
  });

  it('recovers unrelated chapter body that was appended behind an older subsection revision', () => {
    const currentSubsection = 'Current concise 3.5 result paragraph with enough text to identify the revision.';
    const embeddedBody = 'Soil water-filled pore space dynamics remained part of the main Results body and must not be discarded during migration.';
    const content = [
      '\\section*{3.5 Short-cycle dynamics}',
      currentSubsection,
      '',
      embeddedBody,
      '\\section{3.5 Short-cycle dynamics}',
      currentSubsection,
    ].join('\n');

    const normalized = normalizeDraftChapterContent(content);
    expect(normalized).toContain(embeddedBody);
    expect(normalized.match(/3\.5 Short-cycle dynamics/g)).toHaveLength(1);
    expect(normalized.match(/Current concise 3\.5 result paragraph/g)).toHaveLength(1);
  });

  it('does not duplicate recovered body that already exists in the chapter prefix', () => {
    const prefix = 'Main Results body with water-filled pore space observations that must appear once.';
    const currentSubsection = 'Current 3.5 subsection revision with a stable body for comparison.';
    const content = [
      prefix,
      '\\subsection*{3.5 Short-cycle dynamics}',
      currentSubsection,
      '',
      prefix,
      '\\subsection*{3.5 Short-cycle dynamics}',
      currentSubsection,
    ].join('\n');

    const normalized = normalizeDraftChapterContent(content);
    expect(normalized.match(/Main Results body with water-filled pore space/g)).toHaveLength(1);
  });
});
