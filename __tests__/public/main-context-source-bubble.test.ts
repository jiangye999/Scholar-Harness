import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

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
    expect(html).toContain('showMainContextSkillDialog()');
    expect(html).toContain('collapseMainContextSourceBar();showRuntimePluginConfigDialog()');
    expect(html).toContain('<span>插件</span>');
  });

  it('collapses on outside pointer interaction and Escape', () => {
    expect(html).toContain("document.addEventListener('pointerdown'");
    expect(html).toContain('bar.contains(event.target)');
    expect(html).toContain("event.key === 'Escape'");
    expect(html).toContain('collapseMainContextSourceBar();');
  });
});
