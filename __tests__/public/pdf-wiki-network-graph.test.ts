import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('PDF Wiki built-in network graph', () => {
  it('exposes the graph from the sentence-level argument library', () => {
    const libraryStart = html.indexOf('function renderPdfWikiSentenceArgumentLibrary');
    const libraryEnd = html.indexOf('function renderPdfWikiSentenceArgumentStat', libraryStart);
    const librarySource = html.slice(libraryStart, libraryEnd);

    expect(librarySource).toContain('id="pdfWikiNetworkGraphBtn"');
    expect(librarySource).toContain('onclick="showPdfWikiSentenceNetworkGraph()"');
    expect(librarySource).toContain('>网状图</button>');
    expect(html).toContain("var pdfWikiSentenceViewMode = 'list'");
    expect(html).toContain("if (pdfWikiSentenceViewMode === 'graph')");
    expect(html).toContain('window.showPdfWikiSentenceList = function(pointId)');
  });

  it('builds Obsidian-style nodes and links from existing PDF Wiki data', () => {
    const start = html.indexOf('function buildPdfWikiNetworkGraphData');
    const end = html.indexOf('function appendPdfWikiNetworkUnique', start);
    const source = html.slice(start, end);

    expect(source).toContain("type: 'pdf'");
    expect(source).toContain("type: 'topic'");
    expect(source).toContain("type: 'sentence'");
    expect(source).toContain("type: 'reference'");
    expect(source).toContain("type: 'entry'");
    expect(source).toContain("addEdge(pdfNodeId, sentenceNodeId, 'pdf-sentence')");
    expect(source).toContain("addEdge(topicNodeId, sentenceNodeId, 'topic-sentence')");
    expect(source).toContain("addEdge(sentenceNodeId, referenceNodeId, 'sentence-reference')");
    expect(source).toContain("addEdge(entryNode.id, pdfNodeId, 'entry-pdf')");
  });

  it('uses the exact legend color for every node type', () => {
    const colorStart = html.indexOf('function getPdfWikiNetworkTypeColor');
    const colorEnd = html.indexOf('function getPdfWikiNetworkNodeRadius', colorStart);
    const factory = new Function(`${html.slice(colorStart, colorEnd)}\nreturn { getPdfWikiNetworkTypeColor, getPdfWikiNetworkNodeColor };`);
    const colors = factory() as {
      getPdfWikiNetworkTypeColor: (type: string) => string;
      getPdfWikiNetworkNodeColor: (node: Record<string, unknown>) => string;
    };
    const expected = {
      pdf: '#0f766e',
      topic: '#d97706',
      sentence: '#16a34a',
      reference: '#2563eb',
      entry: '#475569',
    };

    Object.entries(expected).forEach(([type, color]) => {
      expect(colors.getPdfWikiNetworkTypeColor(type)).toBe(color);
      expect(colors.getPdfWikiNetworkNodeColor({ type, point: { claimType: 'limitation' } })).toBe(color);
      if (type === 'entry') {
        expect(html).not.toContain(`typeControl('${type}',`);
      } else {
        expect(html).toContain(`typeControl('${type}',`);
      }
      expect(html).toContain(`getPdfWikiNetworkTypeColor('${type}')`);
    });
  });

  it('deduplicates shared references and keeps every edge attached to a node', () => {
    const publishableStart = html.indexOf('function isPdfWikiPublishableSentencePoint');
    const publishableEnd = html.indexOf('function renderPdfWikiViewer', publishableStart);
    const graphStart = html.indexOf('function buildPdfWikiNetworkGraphData');
    const graphEnd = html.indexOf('function getPdfWikiNetworkTypeLabel', graphStart);
    const factory = new Function(
      `${html.slice(publishableStart, publishableEnd)}\n${html.slice(graphStart, graphEnd)}\nreturn buildPdfWikiNetworkGraphData;`,
    );
    const buildGraph = factory() as (data: Record<string, unknown>) => any;
    const sharedReference = { id: 'ref-1', doi: '10.1000/shared', title: 'Shared reference' };
    const point = (id: string, topicKey: string) => ({
      id,
      sourcePdfId: 'pdf-1',
      sourcePdfName: 'source.pdf',
      sourcePdfTitle: 'Source paper',
      section: 'Discussion',
      sentenceIndex: 1,
      sentence: `A sufficiently detailed sentence for ${id} demonstrates an evidence-backed result.`,
      claimCandidate: true,
      claimType: 'result',
      claimText: `Claim ${id}`,
      topicKey,
      topicLabel: `Topic ${topicKey}`,
      references: [sharedReference],
      referenceCount: 1,
      confidence: 0.9,
    });
    const graph = buildGraph({
      sentenceCloud: { points: [point('s1', 'a'), point('s2', 'b')], clouds: [] },
      entries: [{
        id: 'entry-1',
        claim: 'Compatible claim',
        sourcePdfIds: ['pdf-1'],
        sourcePdfNames: ['source.pdf'],
      }],
    });

    expect(graph.counts).toEqual({ pdf: 1, topic: 2, sentence: 2, reference: 2, entry: 0 });
    expect(graph.nodes).toHaveLength(7);
    expect(graph.edges).toHaveLength(6);
    expect(graph.excludedEntryCount).toBe(1);
    expect(graph.edges.every((edge: any) => graph.nodeById[edge.source] && graph.nodeById[edge.target])).toBe(true);
  });

  it('supports search, type filters, zooming, panning, node dragging, and details', () => {
    expect(html).toContain('id="pdfWikiNetworkSvg"');
    expect(html).toContain('id="pdfWikiNetworkSearch"');
    expect(html).toContain("typeControl('reference', '参考文献'");
    expect(html).toContain('window.togglePdfWikiNetworkType = function(type, visible)');
    expect(html).toContain('window.filterPdfWikiNetworkGraph = function(value)');
    expect(html).toContain('window.zoomPdfWikiNetworkGraph = function(direction)');
    expect(html).toContain('window.fitPdfWikiNetworkGraph = function()');
    expect(html).toContain("startPdfWikiNetworkPointer(event, 'node', node.id)");
    expect(html).toContain('runtime.translateX += dx');
    expect(html).toContain('node.fx = pointer.startNodeX + totalClientDx * ratioX / runtime.scale');
    expect(html).toContain("canvas.addEventListener('contextmenu'");
    expect(html).toContain('if (nodeId) selectPdfWikiNetworkNode(nodeId, true)');
    expect(html).not.toContain("if (pointer.mode === 'node' && !pointer.moved) selectPdfWikiNetworkNode");
    expect(html).toContain('function renderPdfWikiNetworkNodeDetail');
    expect(html).toContain('在论点列表中查看');
  });

  it('runs a force-directed simulation that pulls connected nodes together', () => {
    const hashStart = html.indexOf('function pdfWikiNetworkHash');
    const hashEnd = html.indexOf('function getPdfWikiNetworkTypeLabel', hashStart);
    const radiusStart = html.indexOf('function getPdfWikiNetworkNodeRadius');
    const radiusEnd = html.indexOf('function initializePdfWikiNetworkGraph', radiusStart);
    const linkStart = html.indexOf('function getPdfWikiNetworkLinkLength');
    const linkEnd = html.indexOf('function preparePdfWikiNetworkSimulation', linkStart);
    const stepStart = html.indexOf('function stepPdfWikiNetworkSimulation');
    const stepEnd = html.indexOf('function updatePdfWikiNetworkMotionStatus', stepStart);
    const factory = new Function(
      `var pdfWikiNetworkRuntime = null;\n${html.slice(hashStart, hashEnd)}\n${html.slice(radiusStart, radiusEnd)}\n${html.slice(linkStart, linkEnd)}\n${html.slice(stepStart, stepEnd)}\nreturn stepPdfWikiNetworkSimulation;`,
    );
    const stepSimulation = factory() as (runtime: Record<string, any>, delta: number) => void;
    const source = { id: 'source', type: 'topic', degree: 1, x: 100, y: 250, vx: 0, vy: 0, fx: null, fy: null, mass: 1 };
    const target = { id: 'target', type: 'sentence', degree: 1, x: 900, y: 250, vx: 0, vy: 0, fx: null, fy: null, mass: 1 };
    const edge = { source: source.id, target: target.id, type: 'topic-sentence' };
    const runtime = {
      width: 1000,
      height: 500,
      alpha: 1,
      tickCount: 0,
      visibleNodes: [source, target],
      visibleEdges: [edge],
      topicFilterIds: new Set(),
      graphData: { nodeById: { source, target } },
    };
    const initialDistance = target.x - source.x;

    for (let index = 0; index < 45; index += 1) {
      stepSimulation(runtime, 1);
      runtime.tickCount += 1;
      runtime.alpha *= 0.985;
    }

    expect(target.x - source.x).toBeLessThan(initialDistance * 0.72);
    expect([source.x, source.y, target.x, target.y].every(Number.isFinite)).toBe(true);
  });

  it('animates only the hovered node while the graph keeps moving', () => {
    const hitTestStart = html.indexOf('function getPdfWikiNetworkEventPosition');
    const trackingStart = html.indexOf('function trackPdfWikiNetworkHover');
    const trackingEnd = html.indexOf('function startPdfWikiNetworkPointer', trackingStart);
    const hitTestSource = html.slice(hitTestStart, trackingStart);
    const trackingSource = html.slice(trackingStart, trackingEnd);
    const hoverStart = html.indexOf('function activatePdfWikiNetworkHover');
    const hoverEnd = html.indexOf('function renderPdfWikiSentenceCloudViewerLegacy', hoverStart);
    const hoverSource = html.slice(hoverStart, hoverEnd);
    const focusStart = html.indexOf('function updatePdfWikiNetworkFocus');
    const focusEnd = html.indexOf('window.selectPdfWikiNetworkNode', focusStart);
    const focusSource = html.slice(focusStart, focusEnd);

    expect(html).toContain("hitArea.setAttribute('r', String(radius + 8))");
    expect(html).not.toContain("group.addEventListener('pointerenter'");
    expect(html).toContain("group.style.cursor = 'grab'");
    expect(hitTestSource).toContain("var keepRadius = getPdfWikiNetworkNodeRadius(keepNode) + (keepNode.type === 'topic' ? 20 : 14)");
    expect(hitTestSource).toContain('(runtime.visibleNodes || []).forEach');
    expect(trackingSource).toContain('activatePdfWikiNetworkHover(event, nearestNodeId)');
    expect(trackingSource).toContain('clearPdfWikiNetworkHover(runtime.hoveredNodeId)');
    expect(hoverSource).not.toContain('node.fx = node.x');
    expect(hoverSource).not.toContain('node.fy = node.y');
    expect(hoverSource).not.toContain('cancelAnimationFrame(runtime.animationFrame)');
    expect(hoverSource).toContain('setPdfWikiNetworkHoverAnimation(runtime, nodeId, true)');
    expect(hoverSource).not.toContain("updatePdfWikiNetworkMotionStatus(runtime, 'hover')");
    expect(hoverSource).toContain('runtime.hoverHideTimer = setTimeout');
    expect(hoverSource).toContain("renderPdfWikiNetworkSidebar(runtime, runtime.lockedNodeId, 'selected')");
    expect(hoverSource).toContain("renderPdfWikiNetworkSidebar(runtime, nodeId, 'hover')");
    expect(hoverSource).not.toContain('pdfWikiNetworkTooltip');
    expect(html).not.toContain('id="pdfWikiNetworkTooltip"');
    expect(hoverSource).not.toContain('updatePdfWikiNetworkFocus(runtime)');
    expect(focusSource).not.toContain('drop-shadow');
    expect(focusSource).toContain('var focusId = runtime.selectedNodeId');
    expect(focusSource).not.toContain('runtime.hoveredNodeId || runtime.selectedNodeId');
    expect(focusSource).not.toContain("item.circle.setAttribute('r'");
    expect(focusSource).not.toContain("item.circle.setAttribute('stroke'");
    expect(focusSource).toContain("item.halo.style.display = isFocus ? '' : 'none'");
    expect(html).not.toContain('circle.style.transition =');
    expect(html).not.toContain('halo.style.transition =');
    const simulationStart = html.indexOf('function reheatPdfWikiNetworkGraph');
    const simulationEnd = html.indexOf('function stepPdfWikiNetworkSimulation', simulationStart);
    const simulationSource = html.slice(simulationStart, simulationEnd);
    expect(simulationSource).not.toContain('runtime.motionPaused || runtime.hoveredNodeId');
    expect(simulationSource).not.toContain("runtime.hoveredNodeId ? 'hover'");
  });

  it('uses geometric hover hysteresis instead of moving SVG boundaries', () => {
    const radiusStart = html.indexOf('function getPdfWikiNetworkNodeRadius');
    const radiusEnd = html.indexOf('function initializePdfWikiNetworkGraph', radiusStart);
    const trackingStart = html.indexOf('function getPdfWikiNetworkEventPosition');
    const trackingEnd = html.indexOf('function startPdfWikiNetworkPointer', trackingStart);
    const factory = new Function('runtime', 'callbacks', `
      var pdfWikiNetworkRuntime = runtime;
      function activatePdfWikiNetworkHover(event, nodeId) { callbacks.activated.push(nodeId); }
      function clearPdfWikiNetworkHover(nodeId) { callbacks.hidden.push(nodeId); }
      ${html.slice(radiusStart, radiusEnd)}
      ${html.slice(trackingStart, trackingEnd)}
      return trackPdfWikiNetworkHover;
    `);
    const current = { id: 'current', type: 'topic', degree: 2, x: 100, y: 100, simulationVisible: true };
    const nearby = { id: 'nearby', type: 'sentence', degree: 1, x: 210, y: 100, simulationVisible: true };
    const runtime = {
      width: 400,
      height: 300,
      scale: 1,
      translateX: 0,
      translateY: 0,
      hoveredNodeId: current.id,
      pointer: null,
      hoverHideTimer: null,
      visibleNodes: [current, nearby],
      graphData: { nodeById: { current, nearby } },
      svg: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
    };
    const callbacks = { moved: 0, activated: [] as string[], hidden: [] as string[] };
    const trackHover = factory(runtime, callbacks) as (event: { clientX: number; clientY: number }) => void;

    trackHover({ clientX: 126, clientY: 100 });
    expect(callbacks.moved).toBe(0);
    expect(callbacks.activated).toEqual([]);
    expect(callbacks.hidden).toEqual([]);

    trackHover({ clientX: 210, clientY: 100 });
    expect(callbacks.activated).toEqual(['nearby']);
  });

  it('renders hover previews in the right sidebar and makes clicks visibly persistent', () => {
    const selectionStart = html.indexOf('function selectPdfWikiNetworkNode');
    const selectionEnd = html.indexOf('function renderPdfWikiNetworkEmptyDetail', selectionStart);
    const selectionSource = html.slice(selectionStart, selectionEnd);
    const detailStart = html.indexOf('function renderPdfWikiNetworkNodeDetail');
    const detailEnd = html.indexOf('function activatePdfWikiNetworkHover', detailStart);
    const detailSource = html.slice(detailStart, detailEnd);
    const pointerStart = html.indexOf('function movePdfWikiNetworkPointer');
    const pointerEnd = html.indexOf('function wheelPdfWikiNetworkGraph', pointerStart);
    const pointerSource = html.slice(pointerStart, pointerEnd);

    expect(html).toContain('id="pdfWikiNetworkDetail"');
    expect(html).toContain('aria-label="网状图节点信息"');
    expect(html).toContain('悬停预览，右键固定');
    expect(selectionSource).toContain("renderPdfWikiNetworkSidebar(runtime, nodeId, 'selected')");
    expect(selectionSource).toContain("detail.dataset.displayMode = normalizedMode");
    expect(selectionSource).toContain('detail.scrollTop = 0');
    expect(selectionSource).toContain('window.clearPdfWikiNetworkSelection');
    expect(detailSource).toContain("displayMode === 'selected'");
    expect(detailSource).toContain('已固定');
    expect(detailSource).toContain('悬停预览');
    expect(detailSource).toContain('右键其他节点可切换');
    expect(detailSource).toContain('来源论文');
    expect(detailSource).toContain('参考来源（');
    expect(pointerSource).toContain('Math.hypot(totalClientDx, totalClientDy) > 3');
    expect(pointerSource).not.toContain("if (pointer.mode === 'node' && !pointer.moved) selectPdfWikiNetworkNode");
    expect(html).toContain("canvas.addEventListener('contextmenu'");
  });

  it('provides motion controls and respects reduced-motion preferences', () => {
    expect(html).toContain('id="pdfWikiNetworkMotionButton"');
    expect(html).toContain('window.togglePdfWikiNetworkMotion = function()');
    expect(html).toContain('window.restartPdfWikiNetworkLayout = function()');
    expect(html).toContain("window.matchMedia('(prefers-reduced-motion: reduce)')");
    expect(html).toContain('requestAnimationFrame(runPdfWikiNetworkSimulationFrame)');
  });

  it('restores one-shot canvas hover motion without an infinite pulse', () => {
    const animationStart = html.indexOf('function setPdfWikiNetworkHoverAnimation');
    const animationEnd = html.indexOf('function drawPdfWikiNetworkCanvas', animationStart);
    const animationSource = html.slice(animationStart, animationEnd);
    const factory = new Function('runtime', 'callbacks', `
      var pdfWikiNetworkRuntime = runtime;
      function requestAnimationFrame(callback) { callbacks.next = callback; return 1; }
      function drawPdfWikiNetworkCanvas() { callbacks.draws += 1; }
      ${animationSource}
      return { setPdfWikiNetworkHoverAnimation, runPdfWikiNetworkHoverAnimationFrame };
    `);
    const runtime = {
      hoverVisualNodeId: '',
      hoverVisualProgress: 0,
      hoverVisualTarget: 0,
      hoverVisualLastFrameAt: 0,
      visualAnimationFrame: null,
      reducedMotion: false,
    };
    const callbacks = { next: null as null | ((timestamp: number) => void), draws: 0 };
    const animation = factory(runtime, callbacks) as {
      setPdfWikiNetworkHoverAnimation: (runtime: Record<string, any>, nodeId: string, visible: boolean) => void;
    };

    animation.setPdfWikiNetworkHoverAnimation(runtime, 'sentence:1', true);
    let timestamp = 0;
    for (let index = 0; index < 28 && callbacks.next; index += 1) {
      const frame = callbacks.next;
      callbacks.next = null;
      timestamp += 16.67;
      frame(timestamp);
    }
    expect(runtime.hoverVisualNodeId).toBe('sentence:1');
    expect(runtime.hoverVisualProgress).toBe(1);
    expect(callbacks.next).toBeNull();

    animation.setPdfWikiNetworkHoverAnimation(runtime, 'sentence:1', false);
    for (let index = 0; index < 28 && callbacks.next; index += 1) {
      const frame = callbacks.next;
      callbacks.next = null;
      timestamp += 16.67;
      frame(timestamp);
    }
    expect(runtime.hoverVisualProgress).toBe(0);
    expect(runtime.hoverVisualNodeId).toBe('');
    expect(callbacks.next).toBeNull();
    expect(callbacks.draws).toBeGreaterThan(2);
  });

  it('renders visible nodes on one canvas layer instead of composited SVG circles', () => {
    const drawStart = html.indexOf('function drawPdfWikiNetworkCanvas');
    const drawEnd = html.indexOf('function getPdfWikiNetworkEventPosition', drawStart);
    const drawSource = html.slice(drawStart, drawEnd);

    expect(html).toContain('id="pdfWikiNetworkCanvas"');
    expect(html).toContain('id="pdfWikiNetworkRendererBadge"');
    expect(html).toContain('Canvas 稳定动效');
    expect(html).toContain('runtime.canvas = canvas');
    expect(html).toContain('runtime.svg = canvas');
    expect(html).toContain('visibility:hidden;pointer-events:none;');
    expect(drawSource).toContain("canvas.getContext('2d'");
    expect(drawSource).toContain('context.arc(node.x, node.y, renderRadius');
    expect(drawSource).toContain('var hoverEase = 1 - Math.pow(1 - hoverProgress, 3)');
    expect(drawSource).toContain('var renderRadius = currentRadius * (1 + (isHovered ? 0.17 * hoverEase : 0))');
    expect(drawSource).toContain('currentRadius + 3 + hoverEase * 7');
    expect(drawSource).not.toContain('hoverNeighbors');
    expect(drawSource).not.toContain('hoverNodeAlpha');
    expect(drawSource).not.toContain('hoverAlpha');
    expect(drawSource).toContain('context.globalAlpha = baseAlpha');
    expect(drawSource).toContain('var nodeAlpha = baseNodeAlpha');
    expect(drawSource).toContain('context.fillStyle = getPdfWikiNetworkNodeColor(node)');
    expect(drawSource).toContain('Object.keys(runtime.nodeElements).forEach');
    expect(html).toContain("canvas.addEventListener('pointerdown'");
    expect(html).toContain('findPdfWikiNetworkNodeAtEvent(runtime, event)');
  });

  it('cleans up graph state and adapts to narrow windows', () => {
    expect(html).toContain('function cleanupPdfWikiNetworkGraph()');
    expect(html).toContain('window.closePdfWikiViewer = function()');
    expect(html).toContain('cleanupPdfWikiNetworkGraph();');
    expect(html).toContain('cancelAnimationFrame(runtime.animationFrame)');
    expect(html).toContain('cancelAnimationFrame(runtime.visualAnimationFrame)');
    expect(html).toContain('@media(max-width:980px)');
    expect(html).not.toContain('d3.forceSimulation');
  });
});
