import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { ParserFactory } from '../../src/literature/parsers';

const WOS_PLAIN_TEXT_SAMPLE = `FN Clarivate Analytics Web of Science
VR 1.0
PT J
AU Smith, J
   Doe, J
   Wang, L
AF Smith, John
   Doe, Jane
   Wang, Li
TI Multi-line bibliometric parsing for climate adaptation
   and crop yield research
SO JOURNAL OF TESTING
AB This paper evaluates a lightweight parser.
   Continuation lines should remain in the abstract.
DE climate change; adaptation
   crop yield; water stress
ID remote sensing; drought
PY 2024
VL 12
IS 3
BP 10
EP 20
DI 10.1234/wos.test.2024
WC Agronomy; Environmental Sciences
CR Brown C, 2020, TEST JOURNAL, V1, P1
   Green D, 2021, ANOTHER JOURNAL, V2, P3
UT WOS:000000000000001
ER
`;

describe('WoS plain text parser', () => {
  it('keeps multi-line authors, keywords, DOI, categories and cited references', () => {
    const results = ParserFactory.parseContent(WOS_PLAIN_TEXT_SAMPLE, 'savedrecs.txt');

    expect(results).toHaveLength(1);
    const paper = results[0];
    expect(paper.title).toBe('Multi-line bibliometric parsing for climate adaptation and crop yield research');
    expect(paper.authors.map(author => author.name)).toEqual(['Smith, J', 'Doe, J', 'Wang, L']);
    expect(paper.author).toBe('Smith, J, Doe, J, Wang, L');
    expect(paper.year).toBe(2024);
    expect(paper.journal).toBe('JOURNAL OF TESTING');
    expect(paper.abstract).toContain('Continuation lines should remain');
    expect(paper.keywords).toEqual(['climate change', 'adaptation', 'crop yield', 'water stress', 'remote sensing', 'drought']);
    expect(paper.doi).toBe('10.1234/wos.test.2024');
    expect(paper.volume).toBe('12');
    expect(paper.issue).toBe('3');
    expect(paper.pages).toBe('10-20');
    expect(paper.categories).toEqual(['Agronomy', 'Environmental Sciences']);
    expect(paper.references).toEqual([
      'Brown C, 2020, TEST JOURNAL, V1, P1',
      'Green D, 2021, ANOTHER JOURNAL, V2, P3',
    ]);
  });

  it('keeps the same fields when source=wos uses the dedicated WoSParser', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wos-parser-'));
    const filePath = path.join(tempDir, 'savedrecs.txt');
    try {
      await fs.writeFile(filePath, WOS_PLAIN_TEXT_SAMPLE, 'utf-8');
      const parser = ParserFactory.create('wos');
      const results = await parser.parse(filePath);

      expect(results).toHaveLength(1);
      expect(results[0].authors.map(author => author.name)).toEqual(['Smith, J', 'Doe, J', 'Wang, L']);
      expect(results[0].keywords).toContain('crop yield');
      expect(results[0].doi).toBe('10.1234/wos.test.2024');
      expect(results[0].references).toHaveLength(2);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
