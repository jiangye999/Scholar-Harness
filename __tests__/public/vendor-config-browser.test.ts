import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const electronMain = readFileSync(path.resolve(__dirname, '../../electron/main.ts'), 'utf-8');
const preload = readFileSync(path.resolve(__dirname, '../../electron/preload.ts'), 'utf-8');
const configurationSkill = readFileSync(
  path.resolve(
    __dirname,
    '../../skill-packs/scholar-harness-core/skills/configuration/scholar-harness-configuration/SKILL.md',
  ),
  'utf-8',
);

describe('trusted vendor configuration browser', () => {
  it('opens a dedicated right-sidebar vendor page from guided configuration', () => {
    expect(html).toContain('id="rightSidebarVendorConfigTab"');
    expect(html).toContain('id="vendorConfigBrowserHost"');
    expect(html).toContain("openVendorConfigBrowser(provider.id)");
    expect(html).toContain("action === 'open_vendor_config'");
  });

  it('accepts vendor IDs instead of arbitrary URLs', () => {
    expect(html).toContain("{ id: 'open_vendor_config'");
    expect(configurationSkill).toContain('不得把任意网址放进动作参数');
    expect(configurationSkill).toContain('vendor_id="deepseek"');
    expect(electronMain).toContain('const VENDOR_CONFIG_SITES = {');
    expect(electronMain).toContain("return { success: false, error: '不支持的模型厂商' }");
  });

  it('uses an isolated Electron WebContentsView with safe fallback controls', () => {
    expect(electronMain).toContain('new WebContentsView({');
    expect(electronMain).toContain('nodeIntegration: false');
    expect(electronMain).toContain('contextIsolation: true');
    expect(electronMain).toContain('sandbox: true');
    expect(electronMain).toContain("partition: 'persist:scholar-harness-vendor-config'");
    expect(preload).toContain("ipcRenderer.invoke('vendor-config-browser-open'");
    expect(html).toContain("vendorConfigBrowserCommand('external')");
  });
});
