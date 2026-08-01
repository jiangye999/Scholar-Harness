import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const serverSource = readFileSync(
  path.resolve(__dirname, '../../src/server/local-server.ts'),
  'utf-8',
);

describe('literature summary startup route', () => {
  it('supports a persistent summary-only response without returning the full library', () => {
    expect(serverSource).toContain('interface LiteratureSummaryCache');
    expect(serverSource).toContain('"literature-summary.json"');
    expect(serverSource).toContain('const summaryOnly = req.query.summaryOnly === "1"');
    expect(serverSource).toContain('content: summaryOnly ? "" : content');
    expect(serverSource).toContain('writeLiteratureSummaryCache(userId, litFile, litJsonFile, summary)');
  });
});
