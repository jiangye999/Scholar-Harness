import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  BROWSER_ASSIST_PLUGIN_ID,
  MCP_PLUGIN_MARKETPLACE,
  PLAYWRIGHT_MCP_VERSION,
  filterMcpToolsForPlugin,
  validateMcpPluginToolCallPolicy,
  type McpDiscoveredTool,
} from '../../src/server/services/mcp-plugin-manager';

const tool = (name: string): McpDiscoveredTool => ({
  name,
  description: name,
  inputSchema: { type: 'object', properties: {} },
});

describe('Browser Assist MCP', () => {
  it('ships as a curated visible-browser MCP with a persistent profile', () => {
    const plugin = MCP_PLUGIN_MARKETPLACE.find(item => item.id === BROWSER_ASSIST_PLUGIN_ID);
    expect(plugin).toBeDefined();
    expect(plugin?.command).toBe('npx');
    expect(plugin?.args).toContain(`@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`);
    expect(plugin?.args).not.toContain('--output-mode');
    expect(plugin?.args).toContain('--user-data-dir');
    expect(plugin?.args).toContain('${pluginDataDir}/profile');
    expect(plugin?.description).toContain('用户人工接管');
  });

  it('pins every curated npm launcher so upstream latest releases cannot break installs', () => {
    const packageSpecs = MCP_PLUGIN_MARKETPLACE.flatMap(plugin => plugin.args)
      .filter(arg => arg.startsWith('@'));
    expect(packageSpecs.length).toBeGreaterThan(0);
    packageSpecs.forEach(spec => {
      expect(spec).not.toMatch(/@latest$/);
      expect(spec).toMatch(/@[^@]+$/);
    });
  });

  it('exposes navigation and interaction but removes code execution and browser installation', () => {
    const filtered = filterMcpToolsForPlugin(
      { id: BROWSER_ASSIST_PLUGIN_ID },
      [
        tool('browser_navigate'),
        tool('browser_snapshot'),
        tool('browser_click'),
        tool('browser_run_code'),
        tool('browser_evaluate'),
        tool('browser_install'),
      ],
    );
    expect(filtered.map(item => item.name)).toEqual([
      'browser_navigate',
      'browser_snapshot',
      'browser_click',
    ]);
  });

  it('blocks CAPTCHA automation and non-web URL schemes', () => {
    expect(() => validateMcpPluginToolCallPolicy(
      { id: BROWSER_ASSIST_PLUGIN_ID },
      'browser_click',
      { element: 'Click the CAPTCHA checkbox', ref: 'e12' },
    )).toThrow(/亲自完成验证/);

    expect(() => validateMcpPluginToolCallPolicy(
      { id: BROWSER_ASSIST_PLUGIN_ID },
      'browser_navigate',
      { url: 'file:///C:/secret.txt' },
    )).toThrow(/HTTP\(S\)/);
  });

  it('allows ordinary scholarly navigation', () => {
    expect(() => validateMcpPluginToolCallPolicy(
      { id: BROWSER_ASSIST_PLUGIN_ID },
      'browser_navigate',
      { url: 'https://www.sciencedirect.com/journal/journal-of-environmental-management' },
    )).not.toThrow();
  });

  it('is promoted to a dedicated one-click runtime plugin card', () => {
    const root = path.resolve(__dirname, '../..');
    const frontend = fs.readFileSync(path.join(root, 'src/public/app/analysis-tools.js'), 'utf-8');
    const route = fs.readFileSync(path.join(root, 'src/server/routes/mcp-plugins.ts'), 'utf-8');
    expect(frontend).toContain('Browser Assist MCP / 可见浏览器');
    expect(frontend).toContain('/api/mcp-plugins/browser-assist/install');
    expect(frontend).toContain('installBrowserAssistPluginBtn');
    expect(route).toContain("router.post('/browser-assist/install'");
    expect(route).toContain('installBrowserAssistMcpPlugin');
  });
});
