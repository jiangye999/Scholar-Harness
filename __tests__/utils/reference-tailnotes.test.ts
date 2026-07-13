import { describe, expect, it } from 'vitest';

import { appendVerifiedReferenceTailnotes } from '../../src/utils/reference-tailnotes';

describe('reference tailnotes', () => {
  const retrieval = [
    '### [1] Linking NO and N2O emission pulses with the mobilization of mineral and organic N upon rewetting dry soils',
    '',
    '**引用格式**: (Leitner et al., 2017)',
    '**作者**: Leitner, S; Homyak, PM; Blankinship, JC; Eberwein, J; Jenerette, GD; Zechmeister-Boltenstern, S; Schimel, JP',
    '**年份**: 2017',
    '**期刊**: Soil Biology & Biochemistry',
    '**DOI**: 10.1016/j.soilbio.2017.09.005',
  ].join('\n');

  it('appends a full verified tailnote when Codex returns only an in-text citation', () => {
    const result = appendVerifiedReferenceTailnotes(
      'Rewetting can trigger short-lived N-gas pulses (Leitner et al., 2017).',
      [retrieval],
    );

    expect(result).toContain('## References');
    expect(result).toContain('Leitner, S; Homyak, PM; Blankinship, JC');
    expect(result).toContain('DOI: 10.1016/j.soilbio.2017.09.005');
    expect(result).not.toContain('- (Leitner et al., 2017)');
    expect(result).toContain('- Leitner, S; Homyak, PM');
  });

  it('does not duplicate an existing reference section', () => {
    const content = 'Claim (Leitner et al., 2017).\n\n## References\n\nExisting entry.';
    expect(appendVerifiedReferenceTailnotes(content, [retrieval])).toBe(content);
  });

  it('does not invent tailnotes when no verified record is available', () => {
    const content = 'Claim (Unknown et al., 2024).';
    expect(appendVerifiedReferenceTailnotes(content, [retrieval])).toBe(content);
  });
});
