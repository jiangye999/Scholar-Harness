import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('Meta digitization review UI', () => {
  it('keeps point calculations, the digitizer and coding table without legacy panels', () => {
    const start = html.indexOf('window.openPdfWikiDigitizationReview = function');
    const end = html.indexOf('window.startPdfWikiDigitizationImport = function', start);
    const source = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain('id="pdfWikiDigitizerCanvas"');
    expect(source).toContain('renderPdfWikiDigitizationCodingTablePanel(item)');
    expect(source).toContain('id="digitizationAggregationMode"');
    expect(source).toContain('id="digitizationCalculateBtn"');
    expect(source).toContain('calculateInternalDigitizerPoints()');
    expect(source).toContain('class="pdf-wiki-inline-control-row"');
    expect(source).toContain('data-digitizer-calibration-toolbar="1"');
    expect(source).toContain('data-digitizer-calibration-row="1"');
    expect(source).toContain('data-digitizer-point-row="1"');
    expect(source).toContain('grid-template-columns:repeat(4,minmax(52px,1fr))');
    expect(source).toContain('grid-template-columns:repeat(3,minmax(52px,1fr))');
    expect(source).toContain('id="pdfWikiInternalDigitizerPointsList" style="margin-top:6px;height:200px');
    expect(source).toContain('white-space:nowrap');
    expect(source).not.toContain('采点后计算');
    expect(source).not.toContain('外部导出 / 证据归档');
    expect(source).not.toContain('读数归属');
    expect(source).not.toContain('digitizationTreatmentPreset');
  });

  it('runs the selected calculation and publishes pending coding values', () => {
    expect(html).toContain('window.calculateInternalDigitizerPoints = function()');
    expect(html).toContain('window.useInternalDigitizerCsv({ silent: true })');
    expect(html).toContain('setPdfWikiDigitizationPendingValues(pendingValues)');
    expect(html).toContain('每个计算组至少需要 2 个采点');
    expect(html).toContain('#modalContent .pdf-wiki-inline-control-row > select');
    expect(html).toContain('id="pdfWikiDigitizationAddColumnBtn"');
  });

  it('selects a coding cell in place without rebuilding the table', () => {
    const start = html.indexOf('window.selectPdfWikiDigitizationTargetCell = function');
    const end = html.indexOf('window.togglePdfWikiDigitizationFrozenColumn', start);
    const source = html.slice(start, end);

    expect(source).toContain("button.classList.toggle('pdf-wiki-digitization-target-button', selected)");
    expect(source).toContain("cell.classList.toggle('pdf-wiki-digitization-target-cell', selected)");
    expect(source).toContain("document.getElementById('pdfWikiDigitizationTargetSummary')");
    expect(source).not.toContain('updatePdfWikiDigitizationCodingTablePanel()');
  });

  it('fills selected values vertically with incremental table updates', () => {
    const selectionStart = html.indexOf('function getPdfWikiDigitizationSelectedPendingValues()');
    const selectionEnd = html.indexOf('function renderPdfWikiDigitizationPendingValuesHtml()', selectionStart);
    const selectionSource = html.slice(selectionStart, selectionEnd);
    const fillStart = html.indexOf('function fillPdfWikiDigitizationCellValues(batch)');
    const fillEnd = html.indexOf('window.fillPdfWikiDigitizationAllRows', fillStart);
    const fillSource = html.slice(fillStart, fillEnd);

    expect(selectionSource).not.toContain('selected.length ? selected');
    expect(fillSource).toContain('var writeValues = batch ? values : values.slice(0, 1)');
    expect(fillSource).toContain('var rowIndex = startRow + offset');
    expect(fillSource).toContain('syncPdfWikiDigitizationCodingTableDom()');
    expect(fillSource).toContain('向下填入');
  });

  it('updates common coding controls without replacing the whole table', () => {
    expect(html).toContain('function syncPdfWikiDigitizationPendingSelectionDom()');
    expect(html).toContain('function syncPdfWikiDigitizationFrozenColumnsDom()');
    expect(html).toContain('function setPdfWikiDigitizationColumnVisibilityDom(');
    expect(html).toContain('function insertPdfWikiDigitizationColumnDom(');
    expect(html).toContain('function removePdfWikiDigitizationColumnsDom(');
  });
});
