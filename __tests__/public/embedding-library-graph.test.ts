import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const embeddingLibrary = readFileSync(path.resolve(__dirname, '../../src/public/embedding-library.js'), 'utf-8');
const indexHtml = readPublicAppSource();
const electronMain = readFileSync(path.resolve(__dirname, '../../electron/main.ts'), 'utf-8');
const packageJson = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

describe('embedding library Obsidian graph', () => {
  it('exposes the graph tab and requests a bounded graph payload', () => {
    expect(embeddingLibrary).toContain("renderEmbeddingLibraryTab('graph', '网状图')");
    expect(embeddingLibrary).toContain("fetch('/api/embedding-library/graph'");
    expect(embeddingLibrary).toContain('includeAll: true');
  });

  it('keeps graph interactions consistent with the Obsidian views', () => {
    expect(embeddingLibrary).toContain("canvas.addEventListener('contextmenu'");
    expect(embeddingLibrary).toContain("canvas.addEventListener('wheel'");
    expect(embeddingLibrary).toContain("canvas.addEventListener('dblclick'");
    expect(embeddingLibrary).toContain('requestAnimationFrame(function(nextTime)');
    expect(embeddingLibrary).toContain('largeGraph: graph.nodes.length > 900');
    expect(embeddingLibrary).not.toContain('Math.max(1, keywordCount)');
    expect(embeddingLibrary).toContain('minimumScreenRadius');
    expect(embeddingLibrary).toContain('maxKeywordDegree');
    expect(embeddingLibrary).toContain('keywordConnectionCount');
    expect(embeddingLibrary).toContain('keywordSizeRatio');
    expect(embeddingLibrary).toContain('getEmbeddingObsidianCollisionRadius');
    expect(embeddingLibrary).toContain('maximumCollisionRadius');
    expect(embeddingLibrary).toContain('exclusionKeywords');
    expect(embeddingLibrary).toContain('minimumDistance');
    expect(embeddingLibrary).toContain('data-motion-effect="wave"');
    expect(embeddingLibrary).toContain('data-motion-effect="vortex"');
    expect(embeddingLibrary).toContain('data-motion-effect="breathe"');
    expect(embeddingLibrary).toContain('data-control-group="motion"');
    expect(embeddingLibrary).toContain('embeddingObsidianMotionSummaryText');
    expect(embeddingLibrary).toContain('getEmbeddingObsidianMotionFrame');
    expect(embeddingLibrary).toContain("motionFrame.effect === 'vortex'");
    expect(embeddingLibrary).toContain('motionScreenScale');
    expect(embeddingLibrary).toContain('motionSpeedLimit');
    expect(embeddingLibrary).toContain('motionScreenSpeedLimit');
    expect(embeddingLibrary).toContain('normalizedWaveDistance');
    expect(embeddingLibrary).toContain('wavePhase');
    expect(embeddingLibrary).toContain('cycleDurations');
    expect(embeddingLibrary).toContain('wave: 30000');
    expect(embeddingLibrary).toContain('breathe: 30000');
    expect(embeddingLibrary).toContain('runtime.motionEffect === effect');
    expect(embeddingLibrary).not.toContain('motionEffectEndsAt');
    expect(embeddingLibrary).not.toContain('data-motion-effect="pulse"');
    expect(indexHtml).toContain('.embedding-obsidian-motion-action.active');
    expect(embeddingLibrary).toContain("embeddingGraphSeed(node.id + ':paper-orbit')");
    expect(embeddingLibrary).toContain('point.ringRadius - radialDistance');
    expect(embeddingLibrary).toContain('isEmbeddingUntaggedKeywordNode');
    expect(embeddingLibrary).toContain("label === '未标注关键词'");
    expect(embeddingLibrary).toContain("node.type !== 'paper' || connectedGraphNodeIds");
    expect(embeddingLibrary).toContain('sourceDegreeScale');
    expect(embeddingLibrary).toContain("embeddingGraphSeed(node.id + ':secondary')");
    expect(embeddingLibrary).not.toContain('Math.PI * 2 * index / count');
    expect(indexHtml).toContain('.embedding-obsidian-layout');
    expect(indexHtml).toContain('.embedding-obsidian-motion-dot');
  });

  it('drives a local-only voice motion effect and restricts desktop media permission to audio', () => {
    expect(embeddingLibrary).toContain('data-motion-effect="voice"');
    expect(embeddingLibrary).toContain('navigator.mediaDevices.getUserMedia');
    expect(embeddingLibrary).toContain('audioContext.createAnalyser()');
    expect(embeddingLibrary).toContain('getByteTimeDomainData');
    expect(embeddingLibrary).toContain('getByteFrequencyData');
    expect(embeddingLibrary).toContain('track.stop()');
    expect(embeddingLibrary).toContain("motionFrame.effect === 'voice'");
    expect(embeddingLibrary).toContain('audioWaveHistory.unshift');
    expect(embeddingLibrary).toContain('normalizedWaveX');
    expect(embeddingLibrary).toContain('delayedVoiceIndex');
    expect(embeddingLibrary).toContain('voiceWavePhase');
    expect(embeddingLibrary).toContain('point.vy += Math.sin(voiceWavePhase)');
    expect(embeddingLibrary).not.toContain('voiceRadialStrength');
    expect(indexHtml).toContain('[data-motion-effect="voice"].active::before');
    expect(electronMain).toContain('mainSession.setPermissionRequestHandler');
    expect(electronMain).toContain("permission === 'media'");
    expect(electronMain).toContain("mediaTypes.includes('audio')");
    expect(electronMain).toContain("!mediaTypes.includes('video')");
    expect(packageJson.build.mac.extendInfo.NSMicrophoneUsageDescription).toContain('不录音或上传音频');
  });

  it('morphs the graph points themselves into a black-hole silhouette', () => {
    expect(embeddingLibrary).toContain('data-shape-effect="blackhole"');
    expect(embeddingLibrary).toContain('data-shape-effect="circle"');
    expect(embeddingLibrary).toContain('data-control-group="shape"');
    expect(embeddingLibrary).toContain('embeddingObsidianShapeSummaryText');
    expect(embeddingLibrary).toContain('selectEmbeddingObsidianShape');
    expect(embeddingLibrary).toContain('circle: true');
    expect(embeddingLibrary).not.toContain("runtime.shapeMode = runtime.shapeMode === shape ? 'circle' : shape");
    expect(embeddingLibrary).toContain('toggleEmbeddingObsidianBlackHoleShape');
    expect(embeddingLibrary).toContain('assignEmbeddingObsidianBlackHoleTargets');
    expect(embeddingLibrary).toContain("runtime.shapeMode === 'blackhole'");
    expect(embeddingLibrary).toContain("point.blackHoleZone = zone");
    expect(embeddingLibrary).toContain("zone === 'photon'");
    expect(embeddingLibrary).toContain("zone === 'star'");
    expect(embeddingLibrary).toContain('shapeTransitionStartedAt');
    expect(embeddingLibrary).toContain('shapeEase');
    expect(embeddingLibrary).toContain('point.blackHoleColor');
    expect(embeddingLibrary).toContain('var diskRadius = diskBaseRadius * 4');
    expect(embeddingLibrary).toContain('var horizonRadius = minimumWorldSize * 0.16');
    expect(embeddingLibrary).toContain('var sceneHalfWidth = Math.max');
    expect(embeddingLibrary).toContain('if (zoneSeed < 0.20)');
    expect(embeddingLibrary).toContain("embeddingGraphScatterSeed(node.id + ':black-hole-star-x')");
    expect(embeddingLibrary).toContain("blackhole: '#000000'");
    expect(embeddingLibrary).not.toContain('spaceGlow.addColorStop');
    expect(embeddingLibrary).not.toContain('runtime.blackHoleHorizonRadius');
    expect(embeddingLibrary).not.toContain("context.fillStyle = '#010205'");
    expect(embeddingLibrary).toContain("point.blackHoleZone !== 'star'");
    expect(embeddingLibrary).not.toContain('drawEmbeddingObsidianBlackHoleBackdrop');
    expect(embeddingLibrary).not.toContain('diskGradient.addColorStop');
    expect(indexHtml).toContain('.embedding-obsidian-shape-action.active');
    expect(indexHtml).toContain('.embedding-obsidian-control-menu');
  });

  it('morphs graph points into a layered Saturn and ring silhouette', () => {
    expect(embeddingLibrary).toContain('data-shape-effect="saturn"');
    expect(embeddingLibrary).toContain("saturn: '土星'");
    expect(embeddingLibrary).toContain('assignEmbeddingObsidianSaturnTargets');
    expect(embeddingLibrary).toContain("zone = 'planet'");
    expect(embeddingLibrary).toContain("zone = isFrontRing ? 'ring-front' : 'ring-back'");
    expect(embeddingLibrary).toContain("star: 0");
    expect(embeddingLibrary).toContain("'ring-back': 1");
    expect(embeddingLibrary).toContain("planet: 2");
    expect(embeddingLibrary).toContain("'ring-front': 3");
    expect(embeddingLibrary).toContain("saturn: '#05070c'");
    expect(indexHtml).toContain('[data-shape-effect="saturn"]::before');
  });

  it('uses a random Saturn starfield with twinkling stars and moving meteors', () => {
    expect(embeddingLibrary).toContain("node.id + ':saturn-star-x'");
    expect(embeddingLibrary).toContain("node.id + ':saturn-star-y'");
    const saturnStart = embeddingLibrary.indexOf('function assignEmbeddingObsidianSaturnTargets');
    const saturnEnd = embeddingLibrary.indexOf('function assignEmbeddingObsidianStarfieldTargets', saturnStart);
    const saturnBlock = embeddingLibrary.slice(saturnStart, saturnEnd);
    expect(saturnBlock).not.toContain('ringClearRadius');
    expect(saturnBlock).not.toContain('starPush');
    expect(embeddingLibrary).toContain('drawEmbeddingObsidianSaturnMeteors');
    expect(embeddingLibrary).toContain('var cycleDuration = 12000');
    expect(embeddingLibrary).toContain('var twinklePhase');
    expect(embeddingLibrary).toContain('radius *= 0.72 + saturnTwinkle * 0.78');
  });

  it('adds a broad cloud-like galaxy layout with a distinct palette', () => {
    expect(embeddingLibrary).toContain('data-shape-effect="galaxy"');
    expect(embeddingLibrary).toContain('assignEmbeddingObsidianGalaxyTargets');
    expect(embeddingLibrary).toContain('cloudLeft');
    expect(embeddingLibrary).toContain('cloudMiddle');
    expect(embeddingLibrary).toContain('cloudRight');
    expect(embeddingLibrary).toContain('cloudProbability');
    expect(embeddingLibrary).toContain("zone = zoneSeed < cloudProbability * 0.18 ? 'dust' : 'nebula-cloud'");
    expect(embeddingLibrary).toContain("embeddingGraphScatterSeed(node.id + ':galaxy-star-x')");
    expect(embeddingLibrary).not.toContain('bandThickness');
    expect(embeddingLibrary).toContain('point.cosmicShapeColor');
    expect(embeddingLibrary).toContain("runtime.shapeMode !== 'circle'");
    expect(indexHtml).toContain('[data-shape-effect="galaxy"]');
    expect(embeddingLibrary).not.toContain('data-shape-effect="pillars"');
    expect(embeddingLibrary).not.toContain('assignEmbeddingObsidianPillarsTargets');
    expect(indexHtml).not.toContain('[data-shape-effect="pillars"]');
  });

  it('adds a full-canvas deterministic starfield layout', () => {
    expect(embeddingLibrary).toContain('data-shape-effect="starfield"');
    expect(embeddingLibrary).toContain('assignEmbeddingObsidianStarfieldTargets');
    expect(embeddingLibrary).toContain('function embeddingGraphScatterSeed');
    expect(embeddingLibrary).toContain("embeddingGraphScatterSeed(node.id + ':starfield-x')");
    expect(embeddingLibrary).toContain("embeddingGraphScatterSeed(node.id + ':starfield-brightness')");
    expect(embeddingLibrary).toContain('maximumConnectionCount');
    expect(embeddingLibrary).toContain('Math.log1p(connectionCount) / maximumConnectionLog');
    expect(embeddingLibrary).toContain('connectionSizeRatio * 2.86');
    expect(embeddingLibrary).toContain('point.starfieldConnectionCount = connectionCount');
    expect(embeddingLibrary).toContain("runtime.shapeMode === 'starfield'");
    expect(embeddingLibrary).toContain('point.x = point.shapeTargetX');
    expect(embeddingLibrary).toContain('requestAnimationFrame(fitSelectedShape)');
    expect(embeddingLibrary).toContain("point.cosmicShapeZone = isBrightStar ? 'star-bright' : 'star'");
    expect(embeddingLibrary).toContain("starfield: '#020611'");
    expect(indexHtml).toContain('[data-shape-effect="starfield"]');
  });

  it('adds deterministic point-cloud layouts derived from the three artwork references', () => {
    expect(embeddingLibrary).toContain('data-shape-effect="starrynight"');
    expect(embeddingLibrary).toContain('data-shape-effect="painted-eye"');
    expect(embeddingLibrary).toContain('data-shape-effect="cubist-face"');
    expect(embeddingLibrary).toContain("starrynight: '星月夜'");
    expect(embeddingLibrary).toContain("'painted-eye': '油画之眼'");
    expect(embeddingLibrary).toContain("'cubist-face': '抽象人像'");

    expect(embeddingLibrary).toContain('assignEmbeddingObsidianStarryNightTargets');
    expect(embeddingLibrary).toContain("node.id + ':starry-night-zone'");
    expect(embeddingLibrary).toContain("zone = 'cypress'");
    expect(embeddingLibrary).toContain("zone = radialSeed > 0.76 ? 'moon-halo' : 'moon'");

    expect(embeddingLibrary).toContain('assignEmbeddingObsidianPaintedEyeTargets');
    expect(embeddingLibrary).toContain("node.id + ':painted-eye-zone'");
    expect(embeddingLibrary).toContain("zone = detailSeed > 0.88 ? 'eye-glint' : 'pupil'");
    expect(embeddingLibrary).toContain("zone = isUpperLid ? 'upper-lid' : 'lower-lid'");

    expect(embeddingLibrary).toContain('assignEmbeddingObsidianCubistFaceTargets');
    expect(embeddingLibrary).toContain("node.id + ':cubist-face-zone'");
    expect(embeddingLibrary).toContain("zone = 'face-panel-' + panelIndex");
    expect(embeddingLibrary).toContain("zone = isRightEye ? 'right-eye' : 'left-eye'");
    expect(embeddingLibrary).toContain('setEmbeddingObsidianArtworkPoint');

    expect(embeddingLibrary).toContain("starrynight: '#071632'");
    expect(embeddingLibrary).toContain("'painted-eye': '#101820'");
    expect(embeddingLibrary).toContain("'cubist-face': '#171310'");
    expect(indexHtml).toContain('[data-shape-effect="starrynight"]::before');
    expect(indexHtml).toContain('[data-shape-effect="painted-eye"]::before');
    expect(indexHtml).toContain('[data-shape-effect="cubist-face"]::before');
  });

  it('switches point palettes independently from shape and motion', () => {
    expect(embeddingLibrary).toContain('data-control-group="color"');
    expect(embeddingLibrary).toContain('embeddingObsidianColorSummaryText');
    expect(embeddingLibrary).toContain('selectEmbeddingObsidianColorPalette');
    expect(embeddingLibrary).toContain("colorPalette: 'original'");
    expect(embeddingLibrary).toContain('getEmbeddingObsidianPointColor');
    expect(embeddingLibrary).toContain("ice: ['#38bdf8'");
    expect(embeddingLibrary).toContain("nebula: ['#7c6cff'");
    expect(embeddingLibrary).toContain("gold: ['#d97706'");
    expect(embeddingLibrary).toContain("emerald: ['#059669'");
    expect(embeddingLibrary).toContain('context.fillStyle = pointColor');
    expect(indexHtml).toContain('.embedding-obsidian-color-action.active');
  });

  it('keeps linked-paper cards dark and uses gold text on hover', () => {
    expect(indexHtml).toContain(
      '.embedding-obsidian-paper-list > button:hover'
    );
    expect(indexHtml).toContain('background: #1d1f23 !important;');
    expect(indexHtml).toContain('color: #f6c453 !important;');
  });

  it('returns from linked-paper details without rebuilding the graph', () => {
    expect(embeddingLibrary).toContain('detailReturnState: null');
    expect(embeddingLibrary).toContain('captureEmbeddingLiteratureDetailReturnState');
    expect(embeddingLibrary).toContain('renderEmbeddingLiteratureDetailLayer');
    expect(embeddingLibrary).toContain("layer.id = 'embeddingLibraryDetailLayer'");
    expect(embeddingLibrary).toContain('returnState.activeElement.focus({ preventScroll: true })');
    expect(indexHtml).toContain('.embedding-library-detail-layer');

    const renderStart = embeddingLibrary.indexOf('function renderEmbeddingLibrary()');
    const renderEnd = embeddingLibrary.indexOf('function renderEmbeddingLibraryTab', renderStart);
    const renderBlock = embeddingLibrary.slice(renderStart, renderEnd);
    const detailBranchEnd = renderBlock.indexOf('var data = embeddingLibraryState.data;');
    const detailBranch = renderBlock.slice(0, detailBranchEnd);
    expect(detailBranch).toContain('renderEmbeddingLiteratureDetailLayer();');
    expect(detailBranch).not.toContain('destroyEmbeddingObsidianGraph();');

    const backStart = embeddingLibrary.indexOf('window.backToEmbeddingLibrary = function()');
    const backEnd = embeddingLibrary.indexOf('function renderEmbeddingLiteratureDetail()', backStart);
    const backBlock = embeddingLibrary.slice(backStart, backEnd);
    expect(backBlock).not.toContain('renderEmbeddingLibrary();');
  });
});
