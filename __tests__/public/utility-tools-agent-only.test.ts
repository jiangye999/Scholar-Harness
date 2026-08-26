import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('utility tools navigation', () => {
  const html = fs.readFileSync(path.resolve('src/public/index.html'), 'utf8');
  const runtime = fs.readFileSync(path.resolve('src/public/app/constructor-agent.js'), 'utf8');

  it('removes the five built-in utility entries while retaining the runtime tools host', () => {
    expect(html).toContain('data-sidebar-collapse-key="tools"');
    expect(html).not.toContain('onclick="showSentenceClaimSearchDialog()"');
    expect(html).not.toContain('onclick="showDataAnalysisDialog()"');
    expect(html).not.toContain('onclick="showRPlotDialog()"');
    expect(html).not.toContain('onclick="showFlowchartMakerDialog()"');
    expect(html).not.toContain('onclick="showPptMasterDialog()"');
  });

  it('keeps runtime feature navigation so the text-to-speech entry can still be injected', () => {
    expect(runtime).toContain("var section = item.section === 'view' ? 'view' : 'tools';");
    expect(runtime).toContain(".sidebar-panel[data-sidebar-collapse-key=\"");
    expect(runtime).toContain('body.appendChild(constructorFeatureButton(feature, item))');
  });
});
