import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'bibliometrics.js'),
  'utf-8'
);

describe('bibliometrics Wiki-style keyword network', () => {
  it('renders the keyword network as a dedicated graph workspace', () => {
    expect(source).toContain("if (kind === 'keyword') return renderKeywordNetworkWorkspace(cfg)");
    expect(source).toContain('id="bibliometricsKeywordNetworkCanvas"');
    expect(source).toContain('Wiki 图谱机制');
    expect(source).toContain('id="bibliometricsKeywordNetworkDetail"');
    expect(source).toContain('renderKeywordMergePanel(');
  });

  it('keeps the force layout moving until the user pauses it', () => {
    expect(source).toContain('function ensureKeywordNetworkAnimation(layout)');
    expect(source).toContain('stepKeywordNetworkSimulation(layout, delta)');
    expect(source).toContain('layout.animationFrame = requestAnimationFrame(frame)');
    expect(source).toContain('window.toggleBibliometricsKeywordNetworkMotion');
    expect(source).toContain("layout.motionPaused = !layout.motionPaused");
  });

  it('supports Wiki graph navigation and persistent right-click selection', () => {
    expect(source).toContain("canvas.addEventListener('pointerdown'");
    expect(source).toContain("mode: hit ? 'node' : 'pan'");
    expect(source).toContain("canvas.addEventListener('wheel'");
    expect(source).toContain("canvas.addEventListener('contextmenu'");
    expect(source).toContain('layout.lockedId = nodeId');
    expect(source).toContain("renderObsidianNetworkDetail(layout, nodeId, 'selected')");
    expect(source).toContain('window.fitBibliometricsKeywordNetwork');
    expect(source).toContain('window.zoomBibliometricsKeywordNetwork');
  });

  it('uses topic clusters for colors and keeps backend graph artifacts intact', () => {
    expect(source).toContain('function assignKeywordTopicGroups(nodes, edges)');
    expect(source).toContain('bibliometricsState.analysis.topicClusters');
    expect(source).toContain('bibliometricsState.artifacts = data.artifacts || null');
    expect(source).toContain("action: 'downloadBibliometricsNetworkJson'");
  });

  it('renders circular nodes without white outlines or a background grid', () => {
    const drawStart = source.indexOf('function drawKeywordNetworkFrame(layout)');
    const drawEnd = source.indexOf('function attachKeywordNetworkHandlers', drawStart);
    const drawSource = source.slice(drawStart, drawEnd);

    expect(drawStart).toBeGreaterThanOrEqual(0);
    expect(drawEnd).toBeGreaterThan(drawStart);
    expect(drawSource).toContain('ctx.arc(point.x, point.y, radius, 0, Math.PI * 2)');
    expect(drawSource).not.toContain('for (var gridX');
    expect(drawSource).not.toContain('for (var gridY');
    expect(drawSource).not.toContain("ctx.strokeStyle = 'rgba(255,255,255,0.9)'");
  });

  it('uses a high-contrast electric spectrum for keyword topic groups', () => {
    expect(source).toContain(
      "var keywordPalette = ['#2de2e6', '#4f7cff', '#7c5cfc', '#c15cff', '#00d9a5', '#00a6fb', '#ff4d8d', '#ffc857']"
    );
  });

  it('keeps most keyword labels hidden until direct interaction', () => {
    expect(source).toContain('var defaultLabelCount = Math.min(');
    expect(source).toContain('Math.max(6, Math.min(14, Math.round(Math.sqrt(rankedIds.length) * 1.5)))');
    expect(source).toContain('searchMatchIds[id] = true');
    expect(source).toContain(
      'if (labeledIds[id] || isFocus || isSelected || (searchTerm && searchMatchIds[id]))'
    );
    expect(source).toContain('var maxLabelLength = isFocus || isSelected ? 42 : 26');
    expect(source).not.toContain('rankedIds.slice(0, 28)');
  });

  it('uses Times New Roman for persistent high-frequency labels only', () => {
    expect(source).toContain(
      'var labelFontFamily = labeledIds[id] ? \'"Times New Roman", Times, serif\' : \'sans-serif\''
    );
    expect(source).toContain(
      "ctx.font = (isFocus || isSelected ? '750 ' : '650 ') + '11px ' + labelFontFamily"
    );
  });
});
