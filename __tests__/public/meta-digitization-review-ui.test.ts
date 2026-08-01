import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

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
    expect(source).toContain('border:1px solid #111827 !important');
    expect(source).toContain('background:#111827 !important;color:#ffffff !important');
    expect(source).toContain('calculateInternalDigitizerPoints()');
    expect(source).toContain('class="pdf-wiki-inline-control-row"');
    expect(source).toContain("headerControls.id = 'pdfWikiDigitizerHeaderControls'");
    expect(source).toContain("modalHeader.insertBefore(headerControls, modalHeaderActions)");
    expect(source).toContain("overlayClass: 'app-secondary-overlay app-tertiary-overlay'");
    expect(source).toContain("preserveStandaloneSurfaceId: 'pdfWikiViewerModal'");
    expect(html).toContain('.pdf-wiki-digitizer-header-controls button');
    expect(html).toContain('border: 1px solid #aeb5bf;');
    expect(source.match(/border:1px solid #9ca3af !important/g)?.length).toBe(3);
    expect(source).toContain("modalClass: 'modal-digitization-review'");
    expect(source).toContain("preserveStandaloneSurfaceId: 'pdfWikiViewerModal'");
    expect(source).not.toContain('data-digitizer-point-row="1"');
    expect(source).not.toContain('data-digitizer-calibration-row="1"');
    expect(source).not.toContain('onclick="setInternalDigitizerMode(\'xMin\')"');
    expect(source).not.toContain('onclick="setInternalDigitizerMode(\'xMax\')"');
    expect(source).not.toContain('onclick="setInternalDigitizerMode(\'yMin\')"');
    expect(source).not.toContain('onclick="setInternalDigitizerMode(\'yMax\')"');
    expect(source).toContain('style="min-width:0;display:flex;flex-direction:column;flex:1;min-height:0;"');
    expect(source).toContain('id="pdfWikiInternalDigitizerPointsList" style="margin-top:6px;flex:1;min-height:200px;height:auto');
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
    expect(html).toContain('#modalContent .pdf-wiki-inline-control-row > button');
    expect(html).toContain('align-items: stretch !important');
    expect(html).toContain('align-self: stretch !important');
    expect(html).toContain('id="pdfWikiDigitizationAddColumnBtn"');
    expect(html).toContain('justify-content:center;border:1px solid #111827 !important;background:#111827 !important;color:#ffffff !important;">新建列</button>');
    expect(html).toContain('padding:10px 12px;border-bottom:1px solid var(--border-color);');
    expect(html).toContain('justify-content:flex-start;gap:10px;overflow-x:auto;');
    expect(html).toContain('id="pdfWikiMetaCodingTableSummary"');
    expect(html).toContain('margin-top:6px;font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow-x:auto;">当前 PDF 共 ');
    expect(html).toContain('id="pdfWikiMetaCodingToolbar"');
    expect(html).toContain('#pdfWikiMetaCodingToolbar button');
    expect(html).toContain('border-color: #cbd5e1 !important;');
    expect(html).toContain('background: transparent !important;');
    expect(html).toContain('color: #111827 !important;');
    expect(html).not.toContain('选择当前PDF整合表');
    expect(html).not.toContain('全选预览行');
    expect(html).not.toContain('togglePdfWikiMetaVisibleCodingRows');
    expect(html).toContain('window.togglePdfWikiMetaAllCodingRows = function(checked)');
    expect(html).toContain('rows.forEach(function(_, index)');
    expect(html).toContain('onchange="togglePdfWikiMetaAllCodingRows(this.checked)"');
    expect(html).toContain('<span>行</span>');
    expect(html).toContain('function isPdfWikiMetaStudyCodingColumn(column)');
    expect(html).toContain('width:15ch;min-width:15ch;max-width:15ch;overflow:hidden;');
    expect(html).toContain('text-overflow:ellipsis;white-space:nowrap;');
    expect(html).toContain("'<div title=\"' + escapeHtml(value)");
    expect(html).toContain("togglePdfWikiMetaDigitizationPanel(\\'' + escapeHtml(selected.pdfId || '') + '\\')\" style=\"padding:7px 10px;border:1px solid #111827 !important");
    expect(html).toContain("+ index + ')\" style=\"padding:7px 10px;border:1px solid #111827 !important");
    expect(html).not.toContain('>打开复核台</button>');
  });

  it('returns every digitization close path to the Meta workspace', () => {
    expect(html).toContain("closeStandaloneWorkspaceSurfaces(modalOptions.preserveStandaloneSurfaceId || 'modalOverlay')");
    expect(html).toContain("var closingPdfWikiDigitizationReview = title === '图像数字化复核'");
    expect(html).toContain("var returnToPdfWikiMeta = closingPdfWikiDigitizationReview || title === 'AI Meta 分析工作区'");
    expect(html).toContain("setPdfWikiWorkspaceMode('meta')");
    expect(html).toContain("setPdfWikiViewerWorkflowActions('meta-analysis')");
    expect(html).toContain("window.showPdfWikiMetaDatabase().catch");
  });

  it('uses one Meta coding delete action for selected rows, columns, or both', () => {
    const renderStart = html.indexOf('function renderPdfWikiIntegratedDataTable(selected)');
    const renderEnd = html.indexOf('function getPdfWikiDigitizationCurrentItem()', renderStart);
    const renderSource = html.slice(renderStart, renderEnd);
    const deleteStart = html.indexOf('window.deleteSelectedPdfWikiMetaCodingSelection = function()');
    const deleteEnd = html.indexOf('window.triggerPdfWikiMetaUpload = function()', deleteStart);
    const deleteSource = html.slice(deleteStart, deleteEnd);

    expect(renderSource).toContain('onclick="deleteSelectedPdfWikiMetaCodingSelection()"');
    expect(renderSource).toContain('>删除</button>');
    expect(renderSource).not.toContain('>撤销</button>');
    expect(renderSource).not.toContain('>清空</button>');
    expect(renderSource).not.toContain('>删行</button>');
    expect(renderSource).not.toContain('>删列</button>');
    expect(renderSource).not.toContain('>进行meta分析</button>');
    expect(renderSource).not.toContain('>导出选中PDF</button>');
    expect(deleteSource).toContain('{ rowIndexes: rowIndexes, columns: columns }');
    expect(deleteSource).toContain("rowIndexes.length === 0 && columns.length === 0");
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
