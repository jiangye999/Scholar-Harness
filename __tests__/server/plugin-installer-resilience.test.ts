import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const source = (relativePath: string): string => fs.readFileSync(path.join(root, relativePath), 'utf-8');

describe('plugin installer resilience contracts', () => {
  it('uses the shared retrying and resumable downloader for OfficeCLI and R', () => {
    const office = source('src/server/routes/office-plugin.ts');
    const rCode = source('src/server/routes/r-code.ts');
    [office, rCode].forEach(route => {
      expect(route).toContain('downloadFileWithRetry');
      expect(route).toContain('maxAttempts: 4');
      expect(route).toContain('onRetry:');
    });
    expect(office).toContain('requestJsonWithRetry');
    expect(office).toContain('requestTextWithRetry');
    expect(rCode).toContain('requestTextWithRetry');
  });

  it('bounds system package-manager installs and gives pip explicit retry policy', () => {
    const python = source('src/server/routes/python-plugin.ts');
    const marker = source('src/server/routes/pdf-marker.ts');
    const fastText = source('src/server/routes/pdf-fast-text.ts');
    expect(python).not.toContain('process.cwd(), null');
    expect(python).toContain('30 * 60_000');
    expect(marker).toContain("'marker-pdf==2.0.0'");
    expect(marker).toContain("'--retries', '5', '--timeout', '60'");
    expect(fastText).toContain("'pdftext==0.6.3'");
    expect(fastText).toContain("'--retries', '5', '--timeout', '60'");
  });

  it('keeps all curated MCP npm launchers on exact versions', () => {
    const manager = source('src/server/services/mcp-plugin-manager.ts');
    expect(manager).not.toContain('@playwright/mcp@latest');
    expect(manager).not.toContain('@smithery/cli@latest');
    expect(manager).toContain('@modelcontextprotocol/server-filesystem@2026.7.10');
    expect(manager).toContain('@modelcontextprotocol/server-memory@2026.7.4');
    expect(manager).toContain('@modelcontextprotocol/server-sequential-thinking@2026.7.4');
    expect(manager).toContain('@modelcontextprotocol/server-github@2025.4.8');
  });

  it('pins and retries the Obsidian Galaxy View plugin assets', () => {
    const server = source('src/server/local-server.ts');
    expect(server).toContain('PDF_WIKI_GALAXY_VIEW_VERSION = "0.6.1"');
    expect(server).toContain('requestTextWithRetry(url');
    expect(server).toContain('label: `下载 Galaxy View ${fileName}`');
  });

  it('pins and bounds the Reasonix one-click installer', () => {
    const constructorAgent = source('src/server/services/constructor-agent.ts');
    expect(constructorAgent).toContain("['install', '-g', 'reasonix@1.31.4']");
    expect(constructorAgent).toContain('timeoutMs: 15 * 60_000');
    expect(constructorAgent).toContain("spawn('taskkill.exe'");
  });

  it('pins Coding Agent runtime installers that are exposed as one-click deployments', () => {
    const installer = source('src/bridge/agent-runtime/installer.ts');
    expect(installer).toContain('@openai/codex@0.149.1');
    expect(installer).toContain('@earendil-works/pi-coding-agent@0.84.3');
    expect(installer).toContain('opencode-ai@1.18.23');
  });
});
