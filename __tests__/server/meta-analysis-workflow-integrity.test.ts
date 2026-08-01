import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const routeSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/meta-analysis.ts'),
  'utf-8',
);
const serverSource = readFileSync(
  path.resolve(__dirname, '../../src/server/local-server.ts'),
  'utf-8',
);
const rCodeRouteSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/r-code.ts'),
  'utf-8',
);
const publicHtml = readPublicAppSource();
const pluginSource = readFileSync(
  path.resolve(__dirname, '../../plugins/scholar-harness-meta-analysis/src/server.ts'),
  'utf-8',
);
const pluginSkill = readFileSync(
  path.resolve(__dirname, '../../plugins/scholar-harness-meta-analysis/skills/meta-analysis-workflow/SKILL.md'),
  'utf-8',
);

describe('Meta analysis workflow integrity', () => {
  it('honors the confirmed MD/lnRR measure and only applies the positive-mean rule to lnRR', () => {
    expect(routeSource).toContain('resolveAutoOutcomeMeasure(spec, result, input)');
    expect(routeSource).toContain("measureByOutcome.get(spec.key) || 'lnRR_mean_only'");
    expect(routeSource).toContain(
      "(measure === 'lnRR' || measure === 'lnRR_mean_only') && (treatmentMean <= 0 || controlMean <= 0)",
    );
    expect(routeSource).toContain("return 'MD_mean_only'");
    expect(routeSource).toContain('controlRules: MetaControlRule[]');
    expect(serverSource).toContain('不同科学问题必须建立不同 controlRules');
  });

  it('uses equal study/cluster bootstrap rather than resampling dependent effect rows', () => {
    expect(routeSource).toContain('const clusterValues = new Map<string, number[]>()');
    expect(routeSource).toContain("method: 'mean-only equal-cluster non-parametric bootstrap'");
    expect(routeSource).toContain('bootstrap_cluster_mean <- function(d');
    expect(routeSource).toContain('cluster_means <- vapply(split(d$yi, d$cluster_id), mean');
    expect(routeSource).not.toContain('boots <- replicate(iterations, mean(sample(x, size = length(x), replace = TRUE)))');
    expect(pluginSkill).toContain('Never treat effect rows');
  });

  it('binds writing context and R artifacts to exact analysis and conversation versions', () => {
    expect(routeSource).toContain("path.join(getMetaAnalysisWritingContextDir(userId, storageRoot), 'runs'");
    expect(routeSource).toContain("path.join(getMetaAnalysisWritingContextDir(userId, storageRoot), 'conversations'");
    expect(routeSource).toContain('datasetFingerprint');
    expect(publicHtml).toContain("params.set('conversationId', currentConversationId)");
    expect(publicHtml).toContain('analysisId: pdfWikiMetaAnalysisLastRun');
    expect(publicHtml).toContain("conversationId: currentConversationId || ''");
  });

  it('generates standard-model study-level diagnostics but blocks invalid mean-only diagnostics', () => {
    expect(routeSource).toContain('_study_cluster_forest');
    expect(routeSource).toContain('_study_cluster_funnel');
    expect(routeSource).toContain('_leave_one_study_out.csv');
    expect(routeSource).toContain('_study_cluster_baujat');
    expect(routeSource).toContain('length(unique(d$cluster_id))');
    expect(routeSource).toContain('pi_lower = pi_lower');
    expect(routeSource).toContain('Funnel, Egger, Baujat and conventional heterogeneity diagnostics are not applicable to mean-only data');
  });

  it('reports evidence-quality coverage without equating significance with certainty', () => {
    expect(routeSource).toContain('偏倚风险评价');
    expect(routeSource).toContain('证据确定性（GRADE）');
    expect(routeSource).toContain('不要把统计显著性直接解释为高确定性证据');
  });

  it('keeps the Codex plugin on the active desktop user and exact analysis run', () => {
    expect(pluginSource).toContain("apiJson('/api/meta-analysis/active-user')");
    expect(pluginSource).toContain("params.set('analysisId', args.analysisId.trim())");
    expect(pluginSource).toContain('analysisId: run.analysisId');
    expect(pluginSource).toContain('conversationId: run.conversationId');
  });

  it('serves Meta figure previews without reopening the complete PDF Wiki store', () => {
    const start = serverSource.indexOf('app.get("/api/pdf-wiki/pdfs/:pdfId/figures/:fileName"');
    const end = serverSource.indexOf('app.get("/api/pdf-wiki/meta"', start);
    const figureRoute = serverSource.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(figureRoute).toContain('const extractRoot = path.resolve');
    expect(figureRoute).toContain('/^[a-zA-Z0-9_-]{1,120}$/.test(pdfId)');
    expect(figureRoute).not.toContain('pdfWikiManager.getStore');
  });

  it('renders the merged Meta cache after refreshing the summary list', () => {
    const start = publicHtml.indexOf('async function reloadPdfWikiMetaDatabase');
    const end = publicHtml.indexOf('function formatPdfWikiMetaDate', start);
    const reloadSource = publicHtml.slice(start, end);

    expect(reloadSource).toContain('pdfWikiMetaDatabaseData = mergePdfWikiMetaCachedDetails(data)');
    expect(reloadSource).toContain('renderPdfWikiMetaDatabase(pdfWikiMetaDatabaseData)');
  });

  it('places Meta list actions beside the viewer title instead of in the sidebar', () => {
    const helperStart = publicHtml.indexOf('function renderPdfWikiMetaHeaderActions()');
    const renderStart = publicHtml.indexOf('function renderPdfWikiMetaDatabase(data)');
    const renderEnd = publicHtml.indexOf('window.selectPdfWikiMetaPdf', renderStart);
    const helperSource = publicHtml.slice(helperStart, renderStart);
    const renderSource = publicHtml.slice(renderStart, renderEnd);

    expect(publicHtml).toContain('id="pdfWikiViewerContextActions"');
    expect(publicHtml).toContain('justify-content:flex-start');
    expect(helperSource).toContain('上传PDF批量提取');
    expect(helperSource).not.toContain('批量提取选中');
    expect(helperSource).not.toContain('全选当前列表');
    expect(helperSource).not.toContain('清空选择');
    expect(helperSource).toContain('>导出</button>');
    expect(helperSource).toContain('>删除</button>');
    expect(helperSource).toContain('进行meta分析');
    expect(helperSource.indexOf('>删除</button>')).toBeLessThan(helperSource.indexOf('进行meta分析'));
    expect(helperSource).toContain('border:1px solid #111827 !important;background:#111827 !important;color:#d4a017 !important;font-weight:700 !important;');
    expect(renderSource).not.toContain('返回论点库');
    expect(renderSource).not.toContain('onclick="triggerPdfWikiMetaUpload()"');
    expect(renderSource).not.toContain('>导出表格</button>');
    expect(renderSource).not.toContain('>进行meta分析</button>');
    expect(renderSource).toContain('id="pdfWikiMetaDatabaseSummary"');
    expect(renderSource).toContain('id="pdfWikiMetaVisibleSelectAll"');
    expect(renderSource).toContain('onchange="togglePdfWikiMetaVisiblePdfDataSelection(this.checked)"');
    expect(renderSource).toContain('<span>选择</span>');
    expect(renderSource).toContain('visibleSelectAll.indeterminate = someVisibleItemsSelected && !allVisibleItemsSelected');
    expect(publicHtml).toContain("if (checked) {");
    expect(publicHtml).toContain("delete pdfWikiMetaSelectedDataPdfIds[item.pdfId]");
    expect(renderSource.indexOf('renderPdfWikiMetaTemplateControlsPanel(true)')).toBeLessThan(
      renderSource.indexOf('id="pdfWikiMetaDatabaseSummary"'),
    );
    expect(renderSource).toContain("if (subtitle) subtitle.textContent = '';");
  });

  it('keeps the Meta template upload action in the black primary-button theme', () => {
    expect(publicHtml).toContain('id="pdfWikiMetaTemplateUploadBtn"');
    expect(publicHtml).toContain('border:1px solid #111827 !important;border-radius:6px;background:#111827 !important;color:#ffffff !important;');
  });

  it('requires at least two explicitly selected PDFs before handing Meta data to the homepage', () => {
    const targetStart = publicHtml.indexOf('function getPdfWikiMetaAnalysisTargetPdfIds()');
    const targetEnd = publicHtml.indexOf('function showPdfWikiMetaAnalysisWizardModal', targetStart);
    const targetSource = publicHtml.slice(targetStart, targetEnd);
    const openStart = publicHtml.indexOf('window.openPdfWikiMetaAnalysisWizard = async function()');
    const openEnd = publicHtml.indexOf('window.runPdfWikiMetaAnalysis = async function()', openStart);
    const openSource = publicHtml.slice(openStart, openEnd);

    expect(targetSource).toContain('return getPdfWikiMetaSelectedDataPdfIds()');
    expect(targetSource).not.toContain('pdfWikiMetaSelectedPdfId');
    expect(openSource).toContain('if (pdfIds.length < 2)');
    expect(openSource).toContain('勾选至少 2 篇文献的提取数据');
    expect(openSource).toContain('selectMainMetaAnalysisPdfData(pdfIds)');
    expect(openSource).toContain("setMainContextSourceSelected('metaAnalysis', true)");
    expect(openSource).toContain('prepareSelectedAnalysisWorkspaceFolders');
    expect(openSource).toContain('window.closePdfWikiViewer');
    expect(openSource).not.toContain("fetch('/api/meta-analysis/inspect'");
  });

  it('keeps the Meta database mounted beneath the wizard and restores it on close', () => {
    const modalStart = publicHtml.indexOf('function showPdfWikiMetaAnalysisWizardModal(content)');
    const modalEnd = publicHtml.indexOf('function renderMetaAnalysisColumnOptions', modalStart);
    const modalSource = publicHtml.slice(modalStart, modalEnd);

    expect(modalSource).toContain("overlayClass: 'app-secondary-overlay app-tertiary-overlay meta-analysis-shared-composer-overlay'");
    expect(modalSource).toContain("preserveStandaloneSurfaceId: 'pdfWikiViewerModal'");
    expect(publicHtml).toContain("var returnToPdfWikiMeta = closingPdfWikiDigitizationReview || title === 'AI Meta 分析工作区'");
    expect(publicHtml).toContain("if (!returnToPdfWikiMeta) {");
  });

  it('places compact Meta dataset statistics beside the wizard title without a manual-mode header button', () => {
    const renderStart = publicHtml.indexOf('function renderPdfWikiMetaAnalysisWizard(data, pdfIds)');
    const renderEnd = publicHtml.indexOf('function collectPdfWikiMetaAnalysisConfig()', renderStart);
    const renderSource = publicHtml.slice(renderStart, renderEnd);

    expect(publicHtml).toContain('.meta-analysis-header-stats {');
    expect(publicHtml).toContain('width: max-content;');
    expect(publicHtml).toContain("header.insertBefore(stats, actions)");
    expect(renderSource).toContain('installPdfWikiMetaAnalysisHeaderStats(pdfIds.length, dataset.rowCount || 0, dataset.columnCount || 0)');
    expect(renderSource).not.toContain("renderPdfWikiMetaField('纳入PDF'");
    expect(publicHtml).not.toContain("['候选因变量', outcomeCount]");
    expect(publicHtml).not.toContain('专家手动模式');
    expect(publicHtml).not.toContain('metaManualModeHeaderBtn');
  });

  it('aligns Meta conversation controls beside the workspace title without exposing the conversation id', () => {
    const renderStart = publicHtml.indexOf('function renderPdfWikiMetaAnalysisWizard(data, pdfIds)');
    const renderEnd = publicHtml.indexOf('function collectPdfWikiMetaAnalysisConfig()', renderStart);
    const renderSource = publicHtml.slice(renderStart, renderEnd);

    expect(renderSource).toContain('id="metaAiConversationControls" class="meta-analysis-header-conversation-controls"');
    expect(renderSource).toContain('id="metaAiHistorySelect"');
    expect(renderSource).toContain('<option value="" disabled hidden selected>历史对话</option>');
    expect(publicHtml).toContain("var options = ['<option value=\"\" disabled hidden'");
    expect(publicHtml).not.toContain('<option value="">历史对话</option>');
    expect(renderSource).toContain('id="metaAiNewConversationBtn"');
    expect(publicHtml).toContain("if (conversationControls) stats.appendChild(conversationControls)");
    expect(publicHtml).toContain('#modalOverlay.meta-analysis-shared-composer-overlay #modalTitle');
    expect(publicHtml).toContain('width: 176px !important;');
    expect(publicHtml).toContain('margin: 0 !important;');
    expect(publicHtml).toContain('align-self: center;');
    expect(renderSource).not.toContain('metaAnalysisAiConversationLabel');
    expect(publicHtml).not.toContain('item.title || item.id.slice(-8)');
    expect(publicHtml).not.toContain("'\u5f53\u524d\u5bf9\u8bdd ' + id.slice(-8)");
  });

  it('reuses the complete homepage composer in the Meta wizard and hides the top inspection warning', () => {
    const renderStart = publicHtml.indexOf('function renderPdfWikiMetaAnalysisWizard(data, pdfIds)');
    const renderEnd = publicHtml.indexOf('function collectPdfWikiMetaAnalysisConfig()', renderStart);
    const renderSource = publicHtml.slice(renderStart, renderEnd);
    const sharedStart = publicHtml.indexOf('function installPdfWikiMetaSharedComposer()');
    const sharedEnd = publicHtml.indexOf('function renderMetaAnalysisColumnOptions', sharedStart);
    const sharedSource = publicHtml.slice(sharedStart, sharedEnd);

    expect(renderSource).toContain('input-wrapper meta-analysis-ai-input-wrapper');
    expect(renderSource).toContain('class="composer-bottom-row"');
    expect(renderSource).toContain('id="metaAnalysisComposerLeftActions" class="composer-left-actions"');
    expect(renderSource).toContain('id="metaAnalysisComposerProviderSlot"');
    expect(renderSource).toContain('installPdfWikiMetaSharedComposer()');
    expect(renderSource).not.toContain('metaAiProviderSelector');
    expect(renderSource).not.toContain('triggerPdfWikiMetaUpload()');
    expect(renderSource).not.toContain('warningHtml');
    expect(sharedSource).toContain("['uploadExperimentBtn', 'metaAnalysisComposerLeftActions']");
    expect(sharedSource).toContain("['mainContextSourceBar', 'metaAnalysisComposerLeftActions']");
    expect(sharedSource).toContain("['articleWritingProgressBtn', 'metaAnalysisComposerLeftActions']");
    expect(sharedSource).toContain("['workspaceDirectoryBtn', 'metaAnalysisComposerLeftActions']");
    expect(sharedSource).toContain("['composerProviderSelector', 'metaAnalysisComposerProviderSlot']");
    expect(publicHtml).toContain('meta-analysis-shared-composer-overlay');
    expect(publicHtml).toContain("if (typeof restorePdfWikiMetaSharedComposer === 'function')");
    expect(publicHtml).toContain('body.meta-analysis-right-sidebar-layer-open .right-sidebar');
    expect(publicHtml).toContain('body.meta-analysis-right-sidebar-layer-open .modal-overlay.meta-analysis-shared-composer-overlay');
    expect(publicHtml).toContain('right: var(--active-right-sidebar-width, 37.5vw) !important;');
    expect(publicHtml).toContain('z-index: 22000;');
    expect(publicHtml).toContain('syncPdfWikiMetaSharedComposerRightSidebarLayer()');
    expect(publicHtml).not.toContain('body:not(.right-sidebar-collapsed) .modal-overlay.meta-analysis-shared-composer-overlay');
    expect(publicHtml).toContain('#modalContent .meta-analysis-ai-composer .composer-left-actions button');
    expect(publicHtml).toContain('#modalContent .meta-analysis-ai-composer .composer-provider-option');
    expect(publicHtml).toContain('border: 0 !important;');
  });

  it('passes the unified composer workspace and attachment context to the Meta agent', () => {
    expect(publicHtml).toContain('metaChatAttachments = await uploadPendingFilesAsChatAttachments()');
    expect(publicHtml).toContain(': getSelectedWorkspacePreviewFiles();');
    expect(publicHtml).toContain('sharedContext.metaAnalysisAgent = buildPdfWikiMetaAgentPageContext(');
    expect(publicHtml).toContain('selectedContextSources: loadMainContextSourceSelection()');
    expect(publicHtml).toContain('selectedSkills: loadMainContextSkillSelection()');
    expect(publicHtml).toContain('workspaceFiles: Array.isArray(workspaceFiles) ? workspaceFiles.slice(0, 20) : []');
    expect(routeSource).toContain('normalizeMetaAssistantSupplementalContext(req.body?.supplementalContext)');
    expect(serverSource).toContain('composerContext: input.supplementalContext');
  });

  it('binds Meta data, scripts and R artifacts to the configured composer directory', () => {
    expect(publicHtml).toContain('workspaceDirectory: metaWorkspaceDirectory');
    expect(publicHtml).toContain("workspaceOutputType: 'meta-analysis'");
    expect(publicHtml).toContain("workspaceOutputId: pdfWikiMetaAnalysisLastRun.analysisId || ''");
    expect(routeSource).toContain("alreadyScopedToMeta ? [] : ['Meta分析']");
    expect(routeSource).toContain("path.join(outputDirectory, 'meta_effect_sizes.csv')");
    expect(routeSource).toContain("path.join(outputDirectory, 'meta_analysis.R')");
    expect(routeSource).toContain("path.join(outputDirectory, 'meta_analysis_report.md')");
    expect(serverSource).toContain("path.join(input.workspace.storageRoot, 'ai-assistant', input.workspace.id)");
    expect(rCodeRouteSource).toContain("['Meta分析', 'runs', outputId, 'R图表']");
    expect(rCodeRouteSource).toContain('rememberRJobLocation(userId, jobId, jobDir)');
  });

  it('returns from configuration pages to the active Meta wizard with its UI state restored', () => {
    const utilityStart = publicHtml.indexOf("var activeHomeUtilityPage = '';");
    const utilityEnd = publicHtml.indexOf('function filterHomeConfigurationItems', utilityStart);
    const utilitySource = publicHtml.slice(utilityStart, utilityEnd);
    const snapshotStart = publicHtml.indexOf('function snapshotPdfWikiMetaAnalysisWizardState()');
    const snapshotEnd = publicHtml.indexOf('function renderPdfWikiMetaAnalysisWizard', snapshotStart);
    const snapshotSource = publicHtml.slice(snapshotStart, snapshotEnd);

    expect(utilitySource).toContain('var homeUtilityReturnContext = null;');
    expect(utilitySource).toContain("type: 'meta-analysis-wizard'");
    expect(utilitySource).toContain('homeUtilityReturnContext = captureHomeUtilityReturnContext()');
    expect(utilitySource).toContain('renderPdfWikiMetaAnalysisWizard(pdfWikiMetaAnalysisInspectData, pdfWikiMetaAnalysisTargetPdfIds)');
    expect(utilitySource).toContain('inputDraft: input ? String(input.value || \'\') : \'\'');
    expect(utilitySource).toContain('if (returnContext && restoreHomeUtilityReturnContext(returnContext)) return;');
    expect(snapshotSource).toContain('pdfWikiMetaAnalysisInspectData.recommendedConfig = Object.assign');
    expect(snapshotSource).toContain('uiEnabled: !enabled || !!enabled.checked');
    expect(publicHtml).toContain("closeHomeUtilityPage({ skipReturn: true })");
  });

  it('keeps only the latest Meta AI activity in a bubble while rendering older log rows as plain text', () => {
    const stepStyleStart = publicHtml.indexOf('.meta-analysis-ai-pending-step {');
    const stepStyleEnd = publicHtml.indexOf('.meta-analysis-ai-pending-time {', stepStyleStart);
    const stepStyles = publicHtml.slice(stepStyleStart, stepStyleEnd);

    expect(stepStyles).toContain('border: 0 !important;');
    expect(stepStyles).toContain('background: transparent !important;');
    expect(stepStyles).toContain('box-shadow: none !important;');
    expect(publicHtml).toContain('<div class="meta-analysis-ai-pending-current">');
  });

  it('does not duplicate the latest user instruction above the Meta AI processing log', () => {
    expect(publicHtml).not.toContain('最近一次指令');
    expect(publicHtml).not.toContain('已收到指令，等待 AI 返回分析结果。');
    expect(publicHtml).not.toContain('id="metaAnalysisLatestUserMessage"');
    expect(publicHtml).not.toContain('消息、结果和文件按主页聊天方式展示，并保存在历史对话中。');
  });
});
