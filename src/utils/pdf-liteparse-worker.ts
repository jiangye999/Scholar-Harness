import { extractPdfTextWithLiteParseInProcess, type PdfLiteParseOptions } from './pdf-liteparse';

interface WorkerRequest {
  pdfPath?: unknown;
  options?: PdfLiteParseOptions;
}

let started = false;

process.on('message', async (raw: WorkerRequest) => {
  if (started) return;
  started = true;
  try {
    const pdfPath = String(raw?.pdfPath || '').trim();
    if (!pdfPath) throw new Error('LiteParse Worker 缺少 PDF 路径');
    const result = await extractPdfTextWithLiteParseInProcess(pdfPath, raw?.options || {});
    process.send?.({
      success: true,
      outputPath: result.outputPath,
      jsonPath: result.jsonPath,
      textPath: result.textPath,
      pageCount: result.pageCount,
    }, () => process.exit(0));
  } catch (error) {
    process.send?.({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }, () => process.exit(1));
  }
});

process.once('disconnect', () => process.exit(1));
