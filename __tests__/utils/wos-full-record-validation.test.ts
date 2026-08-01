import { describe, expect, it } from 'vitest';

import { assertWosFullRecordsWithAbstract } from '../../src/server/routes/bibliometrics';
import { parseWosPlainTextDataset } from '../../src/utils/wos-plain-text';

function parseRecord(body: string) {
  return parseWosPlainTextDataset(
    [
      'FN Clarivate Web of Science',
      'VR 1.0',
      'PT J',
      'AU Example, A',
      body,
      'TI Example full record',
      'SO Example Journal',
      'PY 2025',
      'UT WOS:EXAMPLE',
      'ER',
      '',
      'EF',
    ].join('\n'),
    'savedrecs.txt',
  );
}

describe('WoS bibliometrics full-record validation', () => {
  it('accepts a Full Record carrying an abstract', () => {
    const dataset = parseRecord([
      'AF Example, Alice',
      'AB This abstract is required for import.',
      'CR Example A, 2020, EXAMPLE JOURNAL',
    ].join('\n'));

    expect(() => assertWosFullRecordsWithAbstract(dataset, 'savedrecs.txt')).not.toThrow();
  });

  it('rejects records without abstracts', () => {
    const dataset = parseRecord([
      'AF Example, Alice',
      'CR Example A, 2020, EXAMPLE JOURNAL',
    ].join('\n'));

    expect(() => assertWosFullRecordsWithAbstract(dataset, 'savedrecs.txt'))
      .toThrow(/缺少摘要 1 条/);
  });

  it('rejects abbreviated/basic records without Full Record fields', () => {
    const dataset = parseRecord('AB This record has an abstract but no full author field.');

    expect(() => assertWosFullRecordsWithAbstract(dataset, 'savedrecs.txt'))
      .toThrow(/不满足 Full Record 字段要求 1 条/);
  });
});
