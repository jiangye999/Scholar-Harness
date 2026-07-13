import { describe, expect, it } from 'vitest';

import {
  normalizeAuthorYearCitationText,
  stripBibliographyAuthorYearPrefixes,
} from '../../src/utils/citation-format';

describe('normalizeAuthorYearCitationText', () => {
  it('uses the full first-author surname and round brackets', () => {
    const input = [
      'The response increased after wetting (S et al., 2017; EW et al., 2021).',
      'references:',
      '- [S et al., 2017] Leitner, J. (2017). Linking NO and N2O emission pulses.',
      '- [EW et al., 2021] Slessarev, E.W. (2021). High resolution measurements.',
    ].join('\n');

    const output = normalizeAuthorYearCitationText(input);

    expect(output).toContain('(Leitner et al., 2017; Slessarev et al., 2021)');
    expect(output).toContain('- Leitner, J. (2017).');
    expect(output).toContain('- Slessarev, E.W. (2021).');
    expect(output).not.toContain('- (Leitner et al., 2017)');
  });

  it('preserves a multi-word surname', () => {
    const input = '- [A et al., 2006] del Prado, A. (2006). N2O and NO emissions.';
    expect(normalizeAuthorYearCitationText(input)).toContain('del Prado, A. (2006).');
  });

  it('normalizes an already meaningful square-bracket author-year label', () => {
    expect(normalizeAuthorYearCitationText('[Zhang et al., 2026]')).toBe('(Zhang et al., 2026)');
  });

  it('removes a duplicated in-text label from a bibliography entry', () => {
    const input = '(Yang et al., 2024) Yang, X., Li, S., Du, T., Kang, S. (2024). Greenhouse gas emissions. Sustainable Production and Consumption, 50, 416-430. DOI: 10.1016/j.spc.2024.08.013.';
    const output = stripBibliographyAuthorYearPrefixes(input);

    expect(output).toBe('Yang, X., Li, S., Du, T., Kang, S. (2024). Greenhouse gas emissions. Sustainable Production and Consumption, 50, 416-430. DOI: 10.1016/j.spc.2024.08.013.');
  });

  it('does not remove a normal citation at the start of a prose list item', () => {
    const input = '- (Smith et al., 2020) reported a strong response after rewetting.';
    expect(stripBibliographyAuthorYearPrefixes(input)).toBe(input);
  });
});
