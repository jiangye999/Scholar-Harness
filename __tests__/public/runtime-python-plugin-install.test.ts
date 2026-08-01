import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const route = readFileSync(path.resolve(__dirname, '../../src/server/routes/python-plugin.ts'), 'utf-8');

describe('Python runtime plugin installer', () => {
  it('shows a real one-click install action beside automatic detection', () => {
    expect(html).toContain('onclick="installPythonPlugin()">一键安装</button>');
    expect(html).toContain("fetch('/api/python-plugin/install', { method: 'POST' })");
    expect(html).toContain("fetch('/api/python-plugin/install/status')");
  });

  it('runs installation as a background job and saves the detected runtime', () => {
    expect(route).toContain("router.post('/install'");
    expect(route).toContain("router.get('/install/status'");
    expect(route).toContain('void runPythonInstallJob()');
    expect(route).toContain('await writePythonPluginConfig({');
    expect(route).toContain("'Python.Python.3.14'");
  });
});
