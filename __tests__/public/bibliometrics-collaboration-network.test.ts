import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'bibliometrics.js'),
  'utf8'
);

describe('bibliometrics collaboration networks', () => {
  it('renders one selectable Obsidian collaboration workspace at a time', () => {
    expect(source).toContain(
      "return kind === 'author' || kind === 'institution' || kind === 'country'"
    );
    expect(source).toContain("activeCollaborationKind: 'author'");
    expect(source).toContain(
      "renderCollaborationNetworkChoice('author', '作者合作网络', activeKind)"
    );
    expect(source).toContain(
      "renderCollaborationNetworkChoice('institution', '机构合作网络', activeKind)"
    );
    expect(source).toContain(
      "renderCollaborationNetworkChoice('country', '国家/地区合作网络', activeKind)"
    );
    expect(source).toContain(
      'renderCollaborationNetworkWorkspace(activeKind, config.title, config.emptyHint)'
    );
    expect(source).toContain('Obsidian 图谱');
  });

  it('stops the hidden graph animation while preserving each graph layout state', () => {
    expect(source).toContain('window.setBibliometricsCollaborationNetwork = function(kind)');
    expect(source).toContain('var previousLayout = getActiveObsidianNetworkLayout(previousKind)');
    expect(source).toContain('cancelAnimationFrame(previousLayout.animationFrame)');
    expect(source).toContain('bibliometricsState.activeCollaborationKind = kind');
    expect(source).toContain('renderBibliometrics()');
  });

  it('uses the remaining workspace height instead of leaving an empty white region', () => {
    expect(source).toContain(
      'data-bibliometrics-collaboration-workspace style="height:100%;min-height:600px;display:flex;flex-direction:column;min-width:0;"'
    );
    expect(source).toContain(
      'class="bibliometrics-keyword-network" style="height:100%;min-height:560px;flex:1 1 auto;"'
    );
  });

  it('renders all collaboration choices with black fills and white text', () => {
    expect(source).toContain('class="bibliometrics-collaboration-choice"');
    expect(source).toContain(
      "';border-radius:6px;background:#111111;color:#ffffff;font-size:11px;font-weight:'"
    );
    expect(source).toContain("(active ? '#2de2e6' : '#111111')");
    expect(source).toContain(
      '#bibliometricsModal .bibliometrics-collaboration-choice{background:#111111!important;color:#ffffff!important;border-color:#111111!important;}'
    );
    expect(source).toContain(
      '#bibliometricsModal .bibliometrics-collaboration-choice[aria-selected="true"]{background:#111111!important;color:#ffffff!important;border-color:#2de2e6!important;}'
    );
  });

  it('routes all three networks through the continuous force-directed renderer', () => {
    expect(source).toContain(
      "if (kind === 'keyword' || isCollaborationNetworkKind(kind))"
    );
    expect(source).toContain('drawObsidianStyleNetworkCanvas(canvas, kind)');
    expect(source).toContain('layout.kind = kind');
    expect(source).toContain('ensureKeywordNetworkAnimation(layout)');
    expect(source).toContain('stepKeywordNetworkSimulation(layout, delta)');
  });

  it('supports drag, pan, wheel zoom and persistent right-click selection', () => {
    expect(source).toContain("mode: hit ? 'node' : 'pan'");
    expect(source).toContain("canvas.addEventListener('wheel'");
    expect(source).toContain("canvas.addEventListener('contextmenu'");
    expect(source).toContain(
      "window.fitBibliometricsObsidianNetwork(layout.kind || 'keyword')"
    );
    expect(source).toContain(
      "renderObsidianNetworkDetail(layout, nodeId, 'selected')"
    );
  });

  it('gives the selected graph independent motion, search and detail controls', () => {
    expect(source).toContain('data-bibliometrics-network-motion-dot="');
    expect(source).toContain('data-bibliometrics-network-search="');
    expect(source).toContain('data-bibliometrics-network-detail="');
    expect(source).toContain('window.toggleBibliometricsObsidianNetworkMotion');
    expect(source).toContain('window.filterBibliometricsObsidianNetwork');
    expect(source).toContain('window.clearBibliometricsObsidianNetworkSelection');
  });

  it('limits persistent labels and reveals other nodes on hover', () => {
    expect(source).toContain('var defaultLabelCount = Math.min(');
    expect(source).toContain(
      'if (labeledIds[id] || isFocus || isSelected || (searchTerm && searchMatchIds[id]))'
    );
    expect(source).toContain(
      'var labelFontFamily = labeledIds[id] ? \'"Times New Roman", Times, serif\' : \'sans-serif\''
    );
  });

  it('uses the electric spectrum consistently across all collaboration networks', () => {
    expect(source).toContain(
      "var collaborationPalette = ['#2de2e6', '#4f7cff', '#7c5cfc', '#c15cff', '#00d9a5', '#00a6fb', '#ff4d8d', '#ffc857']"
    );
    expect(source).toContain('if (isCollaborationNetworkKind(kind)) palette = collaborationPalette');
  });
});
