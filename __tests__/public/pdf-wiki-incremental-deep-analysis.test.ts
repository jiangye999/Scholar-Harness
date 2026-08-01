import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();
const server = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');

describe('PDF Wiki incremental deep analysis', () => {
  it('classifies only PDFs without a completed local recognition as pending recognition', () => {
    const start = html.indexOf('function isPdfWikiPdfRecognized');
    const end = html.indexOf('function renderPdfWikiPdfManagerHeaderToolbar', start);
    const factory = new Function(
      'pdfWikiPdfManagerData',
      `${html.slice(start, end)}\nreturn getUnrecognizedPdfWikiPdfIds;`
    );
    const getPending = factory({
      pdfs: [
        { id: 'flagged', recognitionComplete: true },
        { id: 'cached', parsedTextCachedAt: '2026-07-23T00:00:00.000Z' },
        {
          id: 'legacy',
          processedAt: '2026-07-23T00:00:00.000Z',
          extractionParser: 'liteparse',
          textLength: 1200,
        },
        { id: 'pending' },
      ],
    }) as () => string[];

    expect(getPending()).toEqual(['pending']);
  });

  it('queues both unrecognized PDFs and recognized PDFs without extracted images', () => {
    const start = html.indexOf('function isPdfWikiPdfRecognized');
    const end = html.indexOf('function renderPdfWikiPdfManagerHeaderToolbar', start);
    const factory = new Function(
      'pdfWikiPdfManagerData',
      `${html.slice(start, end)}\nreturn getPdfWikiPdfsNeedingLocalRecognitionIds;`
    );
    const getQueue = factory({
      pdfs: [
        { id: 'complete-with-images', recognitionComplete: true, figureCount: 3 },
        { id: 'complete-with-previews', recognitionComplete: true, figurePreviews: [{ url: '/figure.png' }] },
        { id: 'recognized-no-images', recognitionComplete: true, figureCount: 0 },
        { id: 'pending' },
      ],
    }) as () => string[];

    expect(getQueue()).toEqual(['recognized-no-images', 'pending']);
  });

  it('exposes a one-click local recognition action and reports recognition separately from deep analysis', () => {
    expect(html).toContain('id="pdfWikiRecognizePendingPdfBtn"');
    expect(html).toContain('onclick="recognizeUnrecognizedPdfWikiPdfs()"');
    expect(html).toContain("'识别未识别/无图片 PDF（' + recognitionQueueCount + '）'");
    expect(html).toContain("' 个 PDF，已识别 ' + recognizedPdfCount + ' 个，待识别 ' + unrecognizedPdfCount + ' 个，无图片 ' + noImagePdfCount + ' 个，深入分析 ' + deepAnalyzedPdfCount");
    expect(html).toContain('window.recognizeUnrecognizedPdfWikiPdfs = function()');
    expect(html).toContain('runPdfWikiReidentifyBatch(ids, {');
    expect(html).not.toContain('window.runUnanalyzedPdfWikiDeepAnalysis = function()');
    expect(html).toContain('class="pdf-wiki-manager-filter-row"');
    expect(html).toContain('class="pdf-wiki-manager-action-row"');
    expect(html).toContain('class="pdf-wiki-manager-header-toolbar"');
    expect(html).toContain('setPdfWikiViewerContextActions(');
    expect(html).toContain('renderPdfWikiPdfManagerHeaderToolbar(searchTerm, selectedPdfCount, recognitionQueueCount, allVisibleSelected, visiblePdfs.length)');
    expect(html).toContain('height: 36px !important;');
    expect(html).toContain('min-height: 36px !important;');
    expect(html).toMatch(/#pdfWikiViewerContextActions\.pdf-wiki-manager-context-actions\s*\{[^}]*flex-wrap:\s*nowrap\s*!important;/);
    expect(html).toMatch(/\.pdf-wiki-manager-header-toolbar\s*\{[^}]*justify-content:\s*flex-start;/);
    expect(html).not.toContain('display:flex;gap:8px;align-items:flex-end;justify-content:space-between;');
    const toolbarHtml = html.match(/function renderPdfWikiPdfManagerHeaderToolbar[\s\S]*?\n\s*function renderPdfWikiPdfManager\(/)?.[0] || '';
    expect(toolbarHtml).not.toContain('选中重新识别');
    expect(toolbarHtml).not.toContain('选中提取Meta');
    expect(toolbarHtml).not.toContain('批量深入分析');
    expect(toolbarHtml).not.toContain('>主题库</button>');
    expect(toolbarHtml).not.toContain('runUnanalyzedPdfWikiDeepAnalysis');
    expect(toolbarHtml).not.toContain('/deep-analysis');
    expect(toolbarHtml).not.toContain('clearPdfWikiPdfManagerSearch()');
    expect(toolbarHtml).toContain('onclick="toggleSelectVisiblePdfWikiPdfs()"');
    expect(toolbarHtml).toContain("(allVisibleSelected ? '取消全选' : '全选')");
    expect(toolbarHtml).toContain('>清空</button>');
    expect(toolbarHtml).toContain('>删除</button>');
    expect(html).toContain('window.toggleSelectVisiblePdfWikiPdfs = function()');
  });

  it('submits pending recognition once to the persistent backend queue instead of looping in the renderer', () => {
    const start = html.indexOf('async function submitPdfWikiRecognitionBatch');
    const submitEnd = html.indexOf('async function requestPdfWikiReidentify', start);
    const recognitionSource = html.slice(start, submitEnd);
    const batchSource = html.slice(start, html.indexOf('async function requestPdfWikiDeepAnalysis', start));

    expect(recognitionSource).toContain("fetch('/api/pdf-wiki/recognition-queue'");
    expect(recognitionSource).toContain("readPdfWikiMetaJsonResponse(response, '提交 PDF 识别队列')");
    expect(recognitionSource).not.toContain('await response.json()');
    expect(recognitionSource).toContain("mode: imagesOnly ? 'images-only' : 'full'");
    expect(recognitionSource).not.toContain('for (var i = 0; i < ids.length; i++)');
    expect(recognitionSource).not.toContain('requestPdfWikiReidentify(pdfId');
    expect(recognitionSource).not.toContain('requestPdfWikiDeepAnalysis');
    expect(recognitionSource).not.toContain('/deep-analysis');
    expect(batchSource).toContain('imagesOnlyWhenRecognizedMissingImages: true');
    expect(server).toContain('app.post("/api/pdf-wiki/recognition-queue"');
    expect(server).toContain('pdfWikiManager.enqueuePdfRecognition(userId, items)');
    expect(server).toContain('app.get("/api/pdf-wiki/recognition-queue"');
    expect(server).toContain('code: "API_ROUTE_NOT_FOUND"');
    expect(server).toContain('const recognitionComplete = Boolean(');
    expect(server).toContain("extractionParser: pdf.extractionParser || ''");
    expect(server).toContain('const imagesOnly = req.body.imagesOnly === true || req.body.imagesOnly === "true"');
    expect(server).toContain('pdfWikiManager.ensurePdfFiguresForManager(userId, req.params.pdfId, { force: true })');
    expect(server).toContain('pdfWikiManager.reidentifyPdfWithLiteParse(userId, req.params.pdfId)');
    expect(server).toContain('const deepAnalysis = await pdfWikiManager.getPdfDeepAnalysisSnapshot(userId, pdf.id)');
    expect(server).toContain('deepAnalysisAvailable: !!deepAnalysis');
  });

  it('sends an explicit skip guard and keeps failures isolated per PDF', () => {
    expect(html).toContain('skipIfAnalyzed: !!skipIfAnalyzed');
    expect(html).toContain('requestPdfWikiDeepAnalysis(pdfId, false, options.skipIfAnalyzed === true)');
    expect(html).toContain('if (result && result.skipped)');
    expect(html).toContain("console.warn('[PdfWiki] 批量深入分析失败:'");
  });

  it('checks the server-side analysis cache before provider validation or analysis execution', () => {
    const start = server.indexOf('app.post("/api/pdf-wiki/pdfs/:pdfId/deep-analysis"');
    const end = server.indexOf('async function recordPdfWikiDeepAnalysisResearchProvenance', start);
    const source = server.slice(start, end);
    const skipGuard = source.indexOf('hasPdfDeepAnalysisSnapshot');
    const providerConfig = source.indexOf('getPdfWikiLlmRuntimeConfig');
    const analyzeCall = source.indexOf('pdfWikiManager.analyzePdfDeep');

    expect(skipGuard).toBeGreaterThanOrEqual(0);
    expect(providerConfig).toBeGreaterThan(skipGuard);
    expect(analyzeCall).toBeGreaterThan(providerConfig);
    expect(source).toContain('skipReason: "already-analyzed"');
    expect(source).toContain('detailsLoaded: false');
    expect(source).toContain('existingDeepAnalysis?.wikiSync');
    expect(source).toContain('existingDeepAnalysis.wikiSync.itemCount > 0');
  });

  it('loads cached deep-analysis text on demand and exposes a visible expand action', () => {
    expect(html).toContain("onclick=\"openPdfWikiDeepAnalysisDetails(\\'");
    expect(html).toContain("'查看分析'");
    expect(html).toContain("'展开分析'");
    expect(html).toContain("'折叠分析'");
    expect(html).toContain("fetch('/api/pdf-wiki/pdfs/' + encodeURIComponent(pdfId) + '/deep-analysis?userId='");
    expect(html).toContain("readPdfWikiMetaJsonResponse(response, '读取深入分析结果')");
    expect(html).toContain('pdfWikiDeepAnalysisCollapsed[pdfId] = false;');
    expect(server).toContain('app.get("/api/pdf-wiki/pdfs/:pdfId/deep-analysis"');
    expect(server).toContain('pdfWikiManager.getPdfDeepAnalysisSnapshot(userId, pdfId)');
    expect(server).toContain('code: "PDF_DEEP_ANALYSIS_NOT_FOUND"');
  });

  it('renders research-ready Wiki evidence items with provenance and support boundaries', () => {
    expect(html).toContain('function renderPdfWikiDeepAnalysisUsableItems(analysis)');
    expect(html).toContain('可用于当前研究的 Wiki 条目');
    expect(html).toContain('<strong>原文证据：</strong>');
    expect(html).toContain('<strong>支撑范围：</strong>');
    expect(html).toContain('<strong>使用边界：</strong>');
    expect(html).toContain('renderPdfWikiDeepAnalysisUsableItems(analysis)');
  });
});
