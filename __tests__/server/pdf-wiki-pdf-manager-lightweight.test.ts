import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const serverSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'server', 'local-server.ts'),
  'utf-8'
);
const publicSource = readPublicAppSource();

function routeSource(startMarker: string, endMarker: string): string {
  const start = serverSource.indexOf(startMarker);
  const end = serverSource.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return serverSource.slice(start, end);
}

describe('PDF Wiki PDF manager lightweight loading', () => {
  it('keeps the list endpoint read-only and free of per-PDF deep-analysis or figure work', () => {
    const source = routeSource(
      'app.get("/api/pdf-wiki/pdfs",',
      'app.get("/api/pdf-wiki/pdfs/:pdfId/details",'
    );

    expect(source).toContain('getLightweightStatus(userId)');
    expect(source).toContain('getPdfManagerStoreSnapshot(userId)');
    expect(source).toContain('hasPdfDeepAnalysisSnapshot(userId, pdf.id)');
    expect(source).not.toContain('getStatus(userId)');
    expect(source).not.toContain('getStore(userId)');
    expect(source).not.toContain('getPdfDeepAnalysis(');
    expect(source).not.toContain('getPdfWikiFigurePreviews(');
  });

  it('loads expensive deep-analysis and figure details only for the selected PDF', () => {
    const source = routeSource(
      'app.get("/api/pdf-wiki/pdfs/:pdfId/details",',
      'app.get("/api/pdf-wiki/getdata/status",'
    );

    expect(source).toContain('getPdfDeepAnalysisSnapshot(userId, pdfId)');
    expect(source).toContain('ensurePdfFiguresForManager(userId, pdfId)');
    expect(source).toContain('includeFigurePreviews: true');
    expect(source).toContain('detailsLoaded: true');
  });

  it('renders cached manager data and stored figure previews immediately', () => {
    expect(publicSource).toContain('renderPdfWikiPdfManager(pdfWikiPdfManagerData);');
    expect(publicSource).toContain('reloadPdfWikiPdfManager({ scrollTop: getPdfWikiPdfManagerScrollTop() })');
    expect(serverSource).toContain(
      'const lightweightFigurePreviews = getPdfWikiLightweightFigurePreviews(userId, pdf, storedFigures)',
    );
    expect(serverSource).toContain(': lightweightFigurePreviews;');
    expect(serverSource).toContain('fs.readdirSync(figureDir, { withFileTypes: true })');
    expect(publicSource).toContain('renderPdfWikiPdfTitleImages(pdf, analysis)');
    expect(publicSource).not.toContain('window.togglePdfWikiPdfManagerDetails');
  });

  it('filters non-scientific and duplicate cached images before rendering previews', () => {
    expect(serverSource).toContain('isNonScientificPdfFigureRecord(record, fileName)');
    expect(serverSource).toContain('getPdfWikiFigureQuickFingerprint(filePath)');
    expect(serverSource).toContain('const seenFingerprints = new Set<string>()');
    expect(serverSource).toContain('seenFingerprints.has(fingerprint)');
    expect(serverSource).toContain('index < 3');
    expect(serverSource).toContain('readPdfWikiFigureJson(path.join(figureDir');
  });
});
