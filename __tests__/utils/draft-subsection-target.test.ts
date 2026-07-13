import { describe, expect, it } from 'vitest';

import {
  extractDraftSubsectionContent,
  upsertDraftSubsectionContent,
} from '../../src/utils/draft-subsection-target';

describe('draft subsection target', () => {
  const existing = [
    '\\subsection*{Observed emissions}',
    'Results paragraph that must remain unchanged.',
    '',
    '\\subsection*{Mechanistic interpretation}',
    'Old discussion paragraph.',
    '',
    '## References',
    '(Smith et al., 2024) Smith reference.',
  ].join('\n');

  it('replaces only the explicitly targeted subsection', () => {
    const updated = upsertDraftSubsectionContent(
      existing,
      'New discussion paragraph.',
      { title: 'Mechanistic interpretation', id: 'sub-discussion' },
      'replace',
    );

    expect(updated).toContain('Results paragraph that must remain unchanged.');
    expect(updated).toContain('New discussion paragraph.');
    expect(updated).not.toContain('Old discussion paragraph.');
    expect(updated.indexOf('New discussion paragraph.')).toBeLessThan(updated.indexOf('## References'));
  });

  it('inserts a new subsection before references', () => {
    const updated = upsertDraftSubsectionContent(
      existing,
      'Limitations paragraph.',
      { title: 'Limitations' },
      'merge',
    );

    expect(updated).toContain('\\subsection*{Limitations}\nLimitations paragraph.');
    expect(updated.indexOf('Limitations paragraph.')).toBeLessThan(updated.indexOf('## References'));
  });

  it('extracts only the requested subsection body', () => {
    expect(extractDraftSubsectionContent(existing, { title: 'Mechanistic interpretation' }))
      .toBe('Old discussion paragraph.');
  });
});
