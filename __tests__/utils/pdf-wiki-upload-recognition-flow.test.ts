import fs from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const managerSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/utils/pdf-wiki-manager.ts'),
  'utf-8',
);
const publicSource = readPublicAppSource();
const serverSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/local-server.ts'),
  'utf-8',
);

function sourceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('PDF upload recognition persistence', () => {
  it('keeps PDF manager upload on synchronous local recognition', () => {
    const uploadRoute = sourceBetween(
      serverSource,
      'app.post("/api/upload"',
      'function parseRisToStructured(',
    );

    expect(uploadRoute).toContain("const isPdfManagerLiteUpload = pdfUploadMode === 'manager-lite'");
    expect(uploadRoute).toContain('pdfWikiManager.registerUploadedPdfsWithLiteParse(userId, pdfFilesForWiki)');
  });

  it('persists base recognition before a PDF Wiki build and completes image recognition afterwards', () => {
    const flow = sourceBetween(
      managerSource,
      'async processUploadedPdfs(',
      'async enqueueUploadedPdfs(',
    );
    const firstRecognition = flow.indexOf('await this.recognizeAndPersistPdfsForManager(');
    const wikiBuild = flow.indexOf('await this.buildWiki(');
    const secondRecognition = flow.indexOf(
      'await this.recognizeAndPersistPdfsForManager(',
      firstRecognition + 1,
    );

    expect(firstRecognition).toBeGreaterThanOrEqual(0);
    expect(wikiBuild).toBeGreaterThan(firstRecognition);
    expect(secondRecognition).toBeGreaterThan(wikiBuild);
    expect(flow.slice(firstRecognition, wikiBuild)).toContain('{ extractFigures: false }');
    expect(flow.slice(secondRecognition)).toContain('{ extractFigures: true }');
    expect(flow.slice(wikiBuild, secondRecognition)).toContain('finally');
  });

  it('saves recognition independently from sentence-point generation', () => {
    const helper = sourceBetween(
      managerSource,
      'private async recognizeAndPersistPdfsForManager(',
      'async processUploadedPdfs(',
    );

    expect(helper).toContain('await this.recognizePdfForManager');
    expect(helper).toContain('await this.saveStore');
    expect(helper).toContain('this.mergeReferenceIndexes');
    expect(helper).toContain('failedPdfs.push');
  });

  it('persists whether figure extraction completed or failed and backfills legacy records on demand', () => {
    const backfill = sourceBetween(
      managerSource,
      'async ensurePdfFiguresForManager(',
      'async reidentifyPdfWithLiteParse(',
    );
    const detailsRoute = sourceBetween(
      serverSource,
      'app.get("/api/pdf-wiki/pdfs/:pdfId/details",',
      'app.get("/api/pdf-wiki/getdata/status",',
    );

    expect(managerSource).toContain("figureExtractionStatus?: 'completed' | 'error'");
    expect(managerSource).toContain('pdf.figureExtractionAttemptedAt = attemptedAt');
    expect(managerSource).toContain("pdf.figureExtractionStatus = result.error ? 'error' : 'completed'");
    expect(backfill).toContain('this.extractPdfFiguresForManager(safeUserId, pdf)');
    expect(backfill).toContain('this.recordPdfFigureExtraction(pdf, figureResult)');
    expect(detailsRoute).toContain('pdfWikiManager.ensurePdfFiguresForManager(userId, pdfId)');
  });

  it('shows an explicit recognition state and uses an initial-recognition button for pending PDFs', () => {
    const cardSource = sourceBetween(
      publicSource,
      'var pdfHtml = visiblePdfs.length',
      "content.innerHTML =",
    );

    expect(cardSource).toContain("var recognitionComplete = isPdfWikiPdfRecognized(pdf)");
    expect(cardSource).toContain("(recognitionComplete ? '已识别' : '待识别')");
    expect(cardSource).toContain("(recognitionComplete ? '重新识别PDF' : '识别PDF')");
  });

  it('renders extracted PDF images directly without a separate details button', () => {
    const cardSource = sourceBetween(
      publicSource,
      'var pdfHtml = visiblePdfs.length',
      "content.innerHTML =",
    );

    expect(cardSource).toContain('renderPdfWikiPdfTitleImages(pdf, analysis)');
    expect(cardSource).not.toContain('pdfWikiPdfDetailsBtn-');
    expect(cardSource).not.toContain('loadPdfWikiPdfManagerDetails');
    expect(cardSource).not.toContain('renderPdfWikiRecognitionDetailsBlock');
  });
});
