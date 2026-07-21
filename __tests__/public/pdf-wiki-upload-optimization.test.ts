import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readFileSync(path.join(repoRoot, 'src/public/index.html'), 'utf-8');
const server = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');
const manager = readFileSync(path.join(repoRoot, 'src/utils/pdf-wiki-manager.ts'), 'utf-8');

describe('PDF Wiki upload optimization', () => {
  it('uses the pure-code sentence-only profile for new upload settings', () => {
    const start = html.indexOf('function getDefaultPdfWikiUploadOptions()');
    const end = html.indexOf('function getSelectValue', start);
    const source = html.slice(start, end);

    expect(source).toContain("processingProfile: 'fast'");
    expect(source).toContain("textExtractionEngine: 'liteparse'");
    expect(source).toContain("metadataEngine: 'local'");
    expect(source).toContain("claimExtractionEngine: 'off'");
    expect(source).toContain("sentenceReferenceMatchingEngine: 'local'");
    expect(source).toContain("groupingEngine: 'local'");
    expect(source).toContain('metaAnalysisEnabled: false');
    expect(source).toContain("metaAnalysisEngine: 'off'");
  });

  it('offers fast, deep, and custom processing profiles and sends the choice', () => {
    expect(html).toContain('id="pdfWikiProcessingProfile"');
    expect(html).toContain('快速：只生成句子级 Wiki（推荐）');
    expect(html).toContain('深度：全文、兼容论点、表格/图片和可选 Meta');
    expect(html).toContain('自定义各阶段');
    expect(html).toContain("{ value: 'off', label: '关闭：跳过旧兼容论点");
    expect(html).toContain("formData.append('pdfWikiProcessingProfile'");
    expect(html).toContain('快速模式使用本地代码提取引言、讨论、结论和 References，并按句中/句末显式引用确定性匹配尾注');
  });

  it('normalizes fast mode to the local deterministic pipeline', () => {
    expect(server).toContain("processingProfile?: 'fast' | 'deep' | 'custom' | 'meta'");
    expect(server).toContain("['auto', 'codex', 'qwen-long', 'api', 'off'] as const");
    const start = server.indexOf("if (processingProfile === 'fast')");
    const end = server.indexOf('function isPdfWikiLocalSentenceTask', start);
    const fastProfile = server.slice(start, end);

    expect(fastProfile).toContain("claimExtractionEngine: 'off'");
    expect(fastProfile).toContain("sentenceReferenceMatchingEngine: 'local'");
    expect(fastProfile).toContain("groupingEngine: 'local'");
    expect(fastProfile).not.toContain("sentenceReferenceMatchingEngine: 'codex'");
    expect(server).toContain('function isPdfWikiLocalSentenceTask');
    expect(server).toContain('function isPdfWikiCodexSentenceTask');
    expect(server).toContain("PDF Wiki 已开始纯代码重建");
  });

  it('uses explicit-citation code matching, skips semantic guesses and heavy artifacts, and reuses PDF bytes', () => {
    expect(manager).toContain("claimExtractionEngine?: 'auto' | 'codex' | 'qwen-long' | 'api' | 'off'");
    expect(manager).toContain("const claimSections = claimExtractionEngine === 'off'");
    expect(manager).toContain('buildSentenceCloudPointsFromText');
    expect(manager).toContain('matchSectionSentencesToReferences');
    expect(manager).toContain('extractNumericReferenceIndexes');
    expect(manager).toContain('extractAuthorYearPairs');
    expect(manager).toContain('findReferenceByAuthorYear');
    expect(manager).toContain('includeSemanticCandidates: false');
    expect(manager).not.toContain('process.env.PDF_WIKI_CODEX_TIMEOUT_MS');
    expect(manager).not.toContain('Math.max(60000, Math.min(3600000');
    expect(manager).toContain('await fs.promises.link(source, target)');
    expect(manager).toContain('await this.linkOrCopyFile(pdf.filePath, sourcePdfPath)');
  });

  it('shows upload progress immediately and switches to the persisted queue snapshot', () => {
    expect(html).toContain("uploadingPdfs: selectedFiles.length");
    expect(html).toContain('文件接收完成后会立即写入持久化队列');
    expect(html).toContain("var initialQueue = data.pdfWikiQueue");
    expect(html).toContain('PDF 已写入持久化队列，后台将按顺序处理');
    expect(html).toContain("持久化队列: 处理中 ' + runningPdfs + ' 篇，等待 ' + queuedPdfs + ' 篇");
    expect(html).toContain('var usePdfUploadPipeline = containsPdfUpload');
    expect(html).toContain('for (var pipelineIndex = 0; pipelineIndex < selectedFiles.length; pipelineIndex++)');
    expect(html).toContain('createSinglePdfUploadFormData(pipelineFile)');
    expect(html).toContain("已进入持久化队列；继续上传下一篇");
    expect(html).toContain("'；已上传文件正在后台处理'");
    expect(html).toContain('var pdfWikiBatchProgressTracker = containsPdfUpload');
    expect(html).toContain('jobIds: new Set()');
    expect(html).toContain('completedJobIds: new Set()');
    expect(html).toContain('failedJobIds: new Set()');
    expect(html).toContain('pipelineResult.pdfWikiQueue.addedJobIds');
    expect(html).toContain('function isCurrentPdfWikiBatchTerminal()');
    expect(html).toContain('var batchTerminal = isCurrentPdfWikiBatchTerminal()');
    expect(html).toContain('data-upload-progress="true"');
    expect(html).not.toContain('id="uploadProgress"');
    expect(html).toContain("job.status === 'completed'");
    expect(html).toContain("job.status === 'error'");
    expect(html).toContain('pdfWikiBatchProgressTracker.processedPdfs = Math.max');
    expect(html).toContain('pdfWikiBatchProgressTracker.failedPdfs = Math.max');
    expect(html).toContain("'文件处理进度: '");
    expect(html).toContain("'当前正在处理: ' + currentPdfName");
    expect(html).toContain('completedUnits / totalUnits * 100');
    expect(html).toContain('上传及 PDF Wiki 处理完成');
  });

  it('filters processed PDF hashes before building the upload request', () => {
    expect(html).toContain('async function calculateBrowserFileSha256');
    expect(html).toContain('async function filterPreviouslyUploadedPdfFiles');
    expect(html).toContain("'/api/pdf-wiki/upload/check-duplicates'");
    expect(html).toContain('selectedFiles = duplicatePreflight.files');
    expect(html).toContain('所选 PDF 均已处理或已在队列中，无需重复上传。');
    expect(server).toContain('app.post("/api/pdf-wiki/upload/check-duplicates"');
    expect(server).toContain('pdfWikiManager.matchUploadedPdfHashes');
    expect(manager).toContain('async matchUploadedPdfHashes');
    expect(manager).toContain('skippedDuplicatePdfs');
  });

  it('keeps large PDF Wiki graphs responsive and locks clicked details', () => {
    expect(html).not.toContain('var maxSentenceNodes =');
    expect(html).not.toContain('var maxReferenceNodes =');
    expect(html).toContain('var points = allPoints.slice();');
    expect(html).toContain('var entries = [];');
    expect(html).toContain('omittedSentenceCount: 0');
    expect(html).toContain('omittedReferenceCount: 0');
    expect(html).toContain("完整展示 ' + counts.sentence + ' 条论点句");
    expect(html).toContain('canvasOnly: graphData.nodes.length > 360');
    expect(html).toContain('largeGraph: graphData.nodes.length > 520');
    expect(html).toContain('ultraLargeGraph: graphData.nodes.length > 2400');
    expect(html).toContain('if (runtime.canvasOnly)');
    expect(html).toContain("node.type === 'topic' ? 12.5 + degreeBoost");
    expect(html).toContain("node.type === 'topic' ? 16 : 9");
    expect(html).toContain('function enforcePdfWikiTopicClearance(runtime, nodes)');
    expect(html).toContain('var clearance = 4 / Math.max(0.45, Number(runtime.scale || 1))');
    expect(html).toContain('enforcePdfWikiTopicClearance(runtime, nodes)');
    expect(html).toContain('function applyPdfWikiTopicClusterSpacing(runtime, nodes, alpha, delta)');
    expect(html).toContain('applyPdfWikiTopicClusterSpacing(runtime, nodes, alpha, delta)');
    expect(html).toContain('runtime.clusterLayoutScale');
    expect(html).toContain("pdfWikiNetworkHash(topicKey + '|' + refIdentity)");
    expect(html).toContain('clusterTopicId: topicNodeId');
    expect(html).toContain('id="pdfWikiNetworkTopicFilter"');
    expect(html).toContain('window.filterPdfWikiNetworkTopic = function(value)');
    expect(html).toContain('topicFilterIds: new Set()');
    expect(html).toContain('window.togglePdfWikiNetworkTopic = function(value, checked)');
    expect(html).toContain('data-pdf-wiki-topic-choice');
    expect(html).toContain("summary.textContent = '已选 ' + runtime.topicFilterIds.size + ' 个主题'");
    expect(html).toContain('runtime.topicFilterIds.forEach(function(topicId)');
    expect(html).toContain("relatedNode.type === 'reference' || relatedNode.type === 'pdf'");
    expect(html).toContain('只看这个主题的网状图');
    expect(html).toContain('var viewMinX = -runtime.translateX / runtime.scale - viewPadding');
    expect(html).toContain("renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected')");
    expect(html).toContain("renderPdfWikiNetworkSidebar(runtime, nodeId, 'selected')");
    expect(html).toContain("dragActivated: mode === 'node'");
    expect(html).toContain('Math.hypot(totalClientDx, totalClientDy) > 3');
    expect(html).toContain('node.fx = pointer.startNodeX + totalClientDx * ratioX / runtime.scale');
    expect(html).toContain("pointer.mode === 'node' && pointer.dragActivated");
    expect(html).not.toContain("pointer.mode === 'node' && !pointer.moved");
    expect(html).not.toContain("reheatPdfWikiNetworkGraph(runtime, pointer.moved ? 0.38 : 0.2)");
    expect(html).toContain('var motionInterval = runtime.ultraLargeGraph ? 26 : 16');
    expect(html).toContain('var renderInterval = runtime.ultraLargeGraph ? 32');
    expect(html).toContain('runtime.alpha += (0.045 - runtime.alpha)');
    expect(html).toContain("runtime.animationFrame = requestAnimationFrame(runPdfWikiNetworkSimulationFrame)");
    expect(html).toContain("state === 'ambient' ? '持续动态'");
    expect(html).toContain("lockedNodeId: ''");
    expect(html).toContain('runtime.lockedNodeId = nodeId');
    expect(html).toContain("runtime.lockedNodeId && (displayMode !== 'selected' || nodeId !== runtime.lockedNodeId)");
    expect(html).toContain("renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected')");
    expect(html).toContain("canvas.addEventListener('contextmenu'");
    expect(html).toContain('if (nodeId) selectPdfWikiNetworkNode(nodeId, true)');
    expect(html).toContain('draggedNode.fx = draggedNode.x');
    expect(html).not.toContain('reheatPdfWikiNetworkGraph(runtime, 0.28)');
    expect(html).toContain('reheatPdfWikiNetworkGraph(runtime, 0.34)');
    expect(html).toContain('reheatPdfWikiNetworkGraph(runtime, 0.38)');
    expect(html).toContain('id="pdfWikiNetworkSettings"');
    expect(html).toContain('data-network-setting="centerForce"');
    expect(html).toContain('data-network-setting="repelForce"');
    expect(html).toContain('data-network-setting="linkForce"');
    expect(html).toContain('data-network-setting="linkDistance"');
    expect(html).toContain("focusNode.type === 'topic'");
    expect(html).toContain("secondHopNode.type === 'reference'");
    expect(html).toContain('!!focusNodeIds[item.edge.source] && !!focusNodeIds[item.edge.target]');
    expect(html).toContain('runtime.lockedNodeId !== nodeId && replaceLockedNode !== true');
    expect(html).not.toContain('>取消固定</button>');
    expect(html).toContain("typeVisibility: { pdf: false, topic: true, sentence: true, reference: true, entry: false }");
    expect(html).toContain('runtime.motionPaused = false');
  });
});
