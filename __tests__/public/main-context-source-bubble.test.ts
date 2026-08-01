import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const chatBridgeRoute = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'),
  'utf-8'
);

describe('collapsed persistent-context bubble', () => {
  it('starts collapsed and expands on hover without requiring a click', () => {
    expect(html).toContain('var mainContextSourceBarExpanded = false;');
    expect(html).toContain('class="main-context-source-trigger composer-context-btn"');
    expect(html).toContain('onmouseenter="expandMainContextSourceBar()"');
    expect(html).toContain('onmouseleave="handleMainContextSourceBarPointerLeave()"');
    expect(html).not.toContain('onclick="toggleMainContextSourceBar(event)"');
    expect(html).toContain('function setMainContextSourceBarExpanded(expanded)');
    expect(html).toContain('.main-context-model-pill {');
    expect(html).toContain('border: 1px solid var(--border-color);');
    expect(html).toContain('class="main-context-source-options"');
    expect(html).toContain('.main-context-source-bar.expanded .main-context-source-options');
    const renderStart = html.indexOf('function renderMainContextSourceBar()');
    const renderEnd = html.indexOf('function toggleMainContextSourceBar(event)', renderStart);
    expect(html.slice(renderStart, renderEnd)).not.toContain("uiIcon('chevronRight'");
  });

  it('preserves selections and displays the number of active persistent contexts', () => {
    expect(html).toContain('var selectedCount = MAIN_CONTEXT_SOURCE_DEFS.reduce');
    expect(html).toContain('class="main-context-source-count"');
    expect(html).toContain('toggleMainContextSource(this.dataset.mainContextSource)');
    expect(html).toContain('function setMainContextSourceSelected(sourceId, selected)');
    expect(html).toContain('window.setMainContextSourceSelected = setMainContextSourceSelected;');
    expect(html).toContain('showMainContextSkillDialog()');
    expect(html).not.toContain('collapseMainContextSourceBar();showRuntimePluginConfigDialog()');
  });

  it('uses all extracted Meta tables for a manual homepage selection and preserves scoped Meta-page handoffs', () => {
    expect(html).toContain('function selectAllMainMetaAnalysisData()');
    expect(html).toContain("mode: 'all'");
    expect(html).toContain('function selectMainMetaAnalysisPdfData(pdfIds)');
    expect(html).toContain("mode: 'selected'");
    expect(html).toContain("if (sourceId === 'metaAnalysis')");
    expect(html).toContain('if (nextSelected)');
    expect(html).toContain('selectAllMainMetaAnalysisData();');
    expect(html).toContain('async function loadMainMetaAnalysisDatasetContext(workspaceDirectory)');
    expect(html).toContain("fetch('/api/pdf-wiki/meta?userId='");
    expect(html).toContain('context.metaAnalysisAgent = metaAnalysisDatasetContext');
    expect(html).toContain('async function syncMainMetaAnalysisInputPlaceholder()');
    expect(html).toContain(
      "'默认使用 Meta 分析数据库中 ' + rowCount +\n            ' 条数据（所有数据），请描述要对已选数据执行的 Meta 分析'"
    );
    expect(html).toContain(
      "'请描述要对已选 ' + scope.pdfIds.length + ' 篇文献的提取数据执行的 Meta 分析'"
    );
  });

  it('shows a left-aligned return action only for Meta-page handoffs', () => {
    expect(html).toContain('id="metaAnalysisChatReturnBar"');
    expect(html).toContain('function setMainMetaAnalysisReturnContext(value)');
    expect(html).toContain('<span>返回 Meta 分析</span>');
    expect(html).toMatch(
      /\.meta-analysis-chat-return-bar\s*\{[\s\S]*?left:\s*clamp\(18px,\s*3vw,\s*36px\);[\s\S]*?justify-content:\s*flex-start;/
    );
    expect(html).toContain('window.returnToMainMetaAnalysisSource = async function()');
    expect(html).toContain('await window.showPdfWikiMetaDatabase');
  });

  it('fully disables the Meta dataset context when the persistent source is unchecked', () => {
    expect(html).toContain('function clearMainMetaAnalysisDataScope()');
    expect(html).toContain('clearMainMetaAnalysisDataScope();');
    expect(html).toContain('setMainMetaAnalysisReturnContext(null);');
    expect(html).toContain('restoreDefaultMainChatInputPlaceholder();');
    expect(html).not.toContain('else if (shouldAttachMetaAnalysisContext(message))');
  });

  it('copies the Meta homepage handoff lifecycle to bibliometrics and Auto Research', () => {
    expect(html).toContain('id="analysisWorkflowChatReturnBar"');
    expect(html).toContain('function setMainAnalysisWorkflowReturnContext(value)');
    expect(html).toContain("window.activateMainAnalysisWorkflowHandoff = async function(sourceId)");
    expect(html).toContain("sourceId !== 'bibliometrics' && sourceId !== 'autoResearch'");
    expect(html).toContain("'返回文献计量分析'");
    expect(html).toContain("'返回 Auto Research'");
    expect(html).toContain('window.returnToMainAnalysisWorkflowSource = async function()');
    expect(html).toContain('await window.showBibliometricsDialog({});');
    expect(html).toContain('await window.showAutoResearchMode({});');
    expect(html).toContain('async function syncMainBibliometricsInputPlaceholder()');
    expect(html).toContain('async function syncMainAutoResearchInputPlaceholder()');
    expect(html).toContain('默认使用文献计量数据库中 ');
    expect(html).toContain('默认使用 Auto Research 中 ');
    expect(html).toContain("data-autoresearch-action=\"continue-home\"");
    expect(html).toContain('window.startAutoResearchAssistedWriting = async function()');
    expect(html).toContain("window.activateMainAnalysisWorkflowHandoff('autoResearch')");
  });

  it('only attaches bibliometrics and Auto Research after an explicit persistent selection', () => {
    expect(html).toContain('} else if (selectedContextSources.bibliometrics) {');
    expect(html).toContain('if (selectedContextSources.autoResearch) {');
    expect(html).not.toContain('shouldAttachBibliometricsContext(message)');
    expect(html).not.toContain('isBibliometricsContextActive()');
    expect(html).toContain("sourceId === 'bibliometrics' || sourceId === 'autoResearch'");
    expect(html).toContain('setMainAnalysisWorkflowReturnContext(null);');
  });

  it('keeps every selected analysis source active in a combined turn', () => {
    expect(html).toContain('var selectedSourceIds = MAIN_CONTEXT_SOURCE_DEFS');
    expect(html).toContain('if (selectedSourceIds.length > 1)');
    expect(html).toContain("mode: 'combined'");
    expect(html).toContain("'本轮将同时调用 ' + selectedLabels.join('、')");
    expect(html).toContain('} else if (selectedContextSources.bibliometrics) {');
    expect(html).toContain('} else if (selectedContextSources.metaAnalysis) {');
    expect(html).toContain('if (selectedContextSources.autoResearch) {');
    expect(chatBridgeRoute).toContain('if (attached.length > 1)');
    expect(chatBridgeRoute).toContain('必须把这些来源共同纳入任务判断、分析和写作');
  });

  it('collapses on outside pointer interaction and Escape', () => {
    expect(html).toContain("document.addEventListener('pointerdown'");
    expect(html).toContain('bar.contains(event.target)');
    expect(html).toContain("event.key === 'Escape'");
    expect(html).toContain('collapseMainContextSourceBar();');
  });
});
