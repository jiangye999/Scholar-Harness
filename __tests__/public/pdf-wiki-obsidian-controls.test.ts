import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const server = readFileSync(path.resolve(__dirname, '../../src/server/local-server.ts'), 'utf-8');

describe('PDF Wiki Obsidian Vault controls', () => {
  it('keeps retired Obsidian maintenance actions out of the active sentence-level library', () => {
    const start = html.indexOf('function renderPdfWikiSentenceArgumentLibrary');
    const end = html.indexOf('function renderPdfWikiSentenceArgumentStat', start);
    const source = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(source).not.toContain('id="pdfWikiObsidianExportBtn"');
    expect(source).not.toContain('id="pdfWikiObsidianDeployBtn"');
    expect(source).not.toContain('id="pdfWikiObsidianSearchBtn"');
    expect(source).not.toContain('id="pdfWikiGalaxyViewBtn"');
  });

  it('maps every visible action to its matching local API', () => {
    const start = html.indexOf('window.exportPdfWikiObsidian = async function()');
    const end = html.indexOf('function renderPdfWikiFavoriteButton', start);
    const source = html.slice(start, end);

    expect(source).toContain("fetch('/api/pdf-wiki/export-obsidian'");
    expect(source).toContain("fetch('/api/pdf-wiki/obsidian/deploy'");
    expect(source).toContain("fetch('/api/pdf-wiki/obsidian/search?userId='");
    expect(source).toContain("fetch('/api/pdf-wiki/obsidian/galaxy-view/install'");
    expect(source).toContain("fetch('/api/pdf-wiki/obsidian/galaxy-view/open'");
    expect(source).toContain("body: JSON.stringify({ userId: currentUserId })");
    expect(source).not.toContain('部署 Obsidian');
  });

  it('keeps export, status, sync, and search routes aligned with the safe Vault path', () => {
    expect(server).toContain('app.post("/api/pdf-wiki/export-obsidian"');
    expect(server).toContain('app.get("/api/pdf-wiki/obsidian/status"');
    expect(server).toContain('app.post("/api/pdf-wiki/obsidian/deploy"');
    expect(server).toContain('app.get("/api/pdf-wiki/obsidian/search"');
    expect(server).toContain('app.post("/api/pdf-wiki/obsidian/galaxy-view/install"');
    expect(server).toContain('app.post("/api/pdf-wiki/obsidian/galaxy-view/open"');
    expect(server).toContain('const PDF_WIKI_OBSIDIAN_WORKSPACE_DIR = "obsidian-vaults"');
    expect(server).toContain('return path.join(dataDir, PDF_WIKI_OBSIDIAN_WORKSPACE_DIR');
    expect(server).toContain('assertPdfWikiObsidianVaultPathInsideDataDir(vaultDir)');
    expect(server).toContain('尚未同步内置 Obsidian Vault，请先点击“同步内置 Vault”');
    expect(server).toContain('path.join(safeVaultDir, ".obsidian", "plugins", PDF_WIKI_GALAXY_VIEW_PLUGIN_ID)');
    expect(server).toContain('await configurePdfWikiGalaxyViewVault(exportDir)');
  });
});
