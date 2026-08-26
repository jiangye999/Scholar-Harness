import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('programming Agent container save behavior', () => {
  it('auto-detects and saves a pasted Codex command through the unified container', () => {
    expect(html).not.toContain('id="configCenterCodexSaveButton"');
    expect(html).toContain('oninput="scheduleConfigCenterCodexCommandAutoSave()"');
    expect(html).toContain('onchange="flushConfigCenterCodexCommandAutoSave()"');
    expect(html).toContain('configCenterCodexCommandAutoSaveTimer = setTimeout(flushConfigCenterCodexCommandAutoSave, 500)');
    expect(html).toContain('await saveConfigCenterAgentRuntimes()');
  });

  it('uses one black and gold save action for Codex, Pi, and OpenCode', () => {
    expect(html).toContain('<strong>Agent 容器</strong>');
    expect(html).toContain("configCenterCodexRuntimeHtml(currentCodexModel, currentCodexEffort, currentCodexConcurrency)");
    expect(html).toContain("configCenterRuntimeCard('pi', 'Pi'");
    expect(html).toContain("configCenterRuntimeCard('opencode', 'OpenCode'");
    expect(html).toContain('onclick="saveConfigCenterAgentRuntimes()"');
    expect(html).toContain('background:#111;color:#d6a928');
    expect(html).not.toContain('id="configCenterCodexEffortSaveButton"');
  });

  it('does not expose the manual Codex model slug entry', () => {
    expect(html).not.toContain('configCenterCodexCustomModel');
    expect(html).not.toContain('addConfigCenterCodexCustomModel');
    expect(html).not.toContain('可选：手动填写账户已获授权的模型 slug');
  });
});
