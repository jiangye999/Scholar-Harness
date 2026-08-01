import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const managerSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/utils/pdf-wiki-manager.ts'),
  'utf-8',
);

function sourceBetween(start: string, end: string): string {
  const startIndex = managerSource.indexOf(start);
  const endIndex = managerSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return managerSource.slice(startIndex, endIndex);
}

describe('PDF Wiki upload auto grouping flow', () => {
  it('matches recognized title and abstract against existing groups without AI', () => {
    const helperSource = sourceBetween(
      'private async autoAssignExistingPdfGroups(',
      'async processUploadedPdfs(',
    );

    expect(helperSource).toContain('loadPdfWikiPdfManagement');
    expect(helperSource).toContain('matchesPdfWikiPdfGroupQuery(searchText, group.name)');
    expect(helperSource).toContain('addPdfWikiPdfGroupsToPdfs');
    expect(helperSource).toContain('pdf.title');
    expect(helperSource).toContain('abstractText');
  });

  it('runs after persistent queue processing, quick upload recognition, and re-identification', () => {
    const queueFlow = sourceBetween(
      'async processUploadedPdfs(',
      'async enqueueUploadedPdfs(',
    );
    const liteFlow = sourceBetween(
      'async registerUploadedPdfsWithLiteParse(',
      'async reidentifyPdfWithLiteParse(',
    );
    const reidentifyFlow = sourceBetween(
      'async reidentifyPdfWithLiteParse(',
      'async processUploadedPdfsForMetaAnalysis(',
    );

    expect(queueFlow.indexOf('await this.buildWiki')).toBeLessThan(
      queueFlow.indexOf('await this.autoAssignExistingPdfGroups'),
    );
    expect(liteFlow.indexOf('await this.saveStore')).toBeLessThan(
      liteFlow.indexOf('await this.autoAssignExistingPdfGroups'),
    );
    expect(liteFlow).toContain('autoGroupMatch,');
    expect(reidentifyFlow.indexOf('await this.saveStore')).toBeLessThan(
      reidentifyFlow.indexOf('await this.autoAssignExistingPdfGroups'),
    );
    expect(reidentifyFlow).toContain('autoGroupMatch,');
  });
});
