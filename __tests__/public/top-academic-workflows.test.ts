import { describe, expect, it } from 'vitest';

import { readPublicAppSource, readPublicStyleSource } from '../helpers/public-app-source';

const app = readPublicAppSource();
const layoutCss = readPublicStyleSource('styles/responsive.css');
const themeCss = readPublicStyleSource('styles/color-theme.css');

describe('top academic workflow navigation', () => {
  it('moves every academic workflow entry from the sidebar into the centered app chrome', () => {
    expect(app).toContain('<nav class="app-academic-workflows" aria-label="学术工作流">');
    expect(app).not.toContain('data-sidebar-collapse-key="workflow"');

    for (const handler of [
      'showAutoResearchMode()',
      'showThesisWritingWorkspace()',
      'showReviewWriterDialog()',
      'showBibliometricsDialog()',
      'showPdfWikiPdfManager()',
      'showPdfWikiMetaDatabase()',
      'showResearchEnhancementWorkspace()',
    ]) {
      expect(app).toContain(`onclick="${handler}"`);
    }
  });

  it('keeps the icon group centered and outside the draggable title-bar region', () => {
    expect(layoutCss).toContain('.app-academic-workflows {');
    expect(layoutCss).toContain('left: 50%;');
    expect(layoutCss).toContain('transform: translateX(-50%);');
    expect(layoutCss).toContain('-webkit-app-region: no-drag;');
  });

  it('uses the selected theme for workflow icons and interaction states', () => {
    expect(themeCss).toContain('.app-academic-workflows,');
    expect(themeCss).toContain('.app-academic-workflow-btn:hover,');
    expect(themeCss).toContain('color: var(--theme-primary) !important;');
    expect(layoutCss).toContain('background: var(--theme-softer) !important;');
    expect(layoutCss).toContain('box-shadow: inset 0 0 0 1px var(--theme-border) !important;');
  });
});
