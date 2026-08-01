import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('Codex CLI configuration save button', () => {
  it('auto-detects and saves a pasted Codex command without a separate path save button', () => {
    expect(html).not.toContain('id="configCenterCodexSaveButton"');
    expect(html).toContain('oninput="scheduleConfigCenterCodexCommandAutoSave()"');
    expect(html).toContain('onchange="flushConfigCenterCodexCommandAutoSave()"');
    expect(html).toContain('configCenterCodexCommandAutoSaveTimer = setTimeout(flushConfigCenterCodexCommandAutoSave, 500)');
    expect(html).toContain('await saveConfigCenterCodexPreference(prefer)');
  });

  it('adds a black and gold save action below the PDF Wiki concurrency explanation', () => {
    expect(html).toMatch(/PDF Wiki Codex 多开数[\s\S]*?上传多个 PDF 生成 Wiki论点库[\s\S]*?id="configCenterCodexEffortSaveButton"/);
    expect(html).toMatch(/#configCenterCodexEffortSaveButton\s*\{[\s\S]*?background:\s*#111111\s*!important;/);
    expect(html).toMatch(/#configCenterCodexEffortSaveButton\s*\{[\s\S]*?color:\s*#d6a928\s*!important;/);
    expect(html).toMatch(/#configCenterCodexEffortSaveButton\s*\{[\s\S]*?font-weight:\s*700\s*!important;/);
    expect(html).toContain("id=\"configCenterCodexEffortSaveButton\" onclick=\"saveConfigCenterCodexPreference(");
  });

  it('does not expose the manual Codex model slug entry', () => {
    expect(html).not.toContain('configCenterCodexCustomModel');
    expect(html).not.toContain('addConfigCenterCodexCustomModel');
    expect(html).not.toContain('可选：手动填写账户已获授权的模型 slug');
  });
});
