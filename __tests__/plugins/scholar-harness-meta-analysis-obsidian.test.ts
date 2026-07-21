import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const pluginRoot = path.resolve(__dirname, '../../plugins/scholar-harness-meta-analysis');
const server = readFileSync(path.join(pluginRoot, 'src/server.ts'), 'utf-8');
const manifest = JSON.parse(
  readFileSync(path.join(pluginRoot, '.codex-plugin/plugin.json'), 'utf-8'),
) as {
  version: string;
  interface: { displayName: string; defaultPrompt: string[] };
};
const workflow = readFileSync(
  path.join(pluginRoot, 'skills/pdf-wiki-obsidian-workflow/SKILL.md'),
  'utf-8',
);

describe('Scholar Harness Codex plugin PDF Wiki Obsidian tools', () => {
  it('publishes the four Vault tools in plugin version 1.1.0', () => {
    expect(manifest.version).toBe('1.1.0');
    expect(manifest.interface.displayName).toContain('PDF Wiki');
    expect(manifest.interface.defaultPrompt).toContain('把当前 PDF Wiki 一键同步为 Obsidian Vault。');

    expect(server).toContain("name: 'pdfwiki_obsidian_status'");
    expect(server).toContain("name: 'pdfwiki_obsidian_sync'");
    expect(server).toContain("name: 'pdfwiki_obsidian_search'");
    expect(server).toContain("name: 'pdfwiki_obsidian_export'");
  });

  it('bridges each tool to the shared Scholar Harness PDF Wiki API', () => {
    expect(server).toContain('/api/pdf-wiki/obsidian/status?userId=');
    expect(server).toContain("postJson('/api/pdf-wiki/obsidian/deploy', { userId })");
    expect(server).toContain('/api/pdf-wiki/obsidian/search?userId=');
    expect(server).toContain("postJson('/api/pdf-wiki/export-obsidian', { userId })");
    expect(server).toContain("sourceOfTruth: 'Scholar Harness PDF Wiki'");
    expect(server).toContain('installsObsidianClient: false');
  });

  it('documents the generated-view and citation-safety boundaries', () => {
    expect(workflow).toContain('Scholar Harness PDF Wiki is the source of truth');
    expect(workflow).toContain('Never infer a reference number');
    expect(workflow).toContain('not as a bidirectional database');
    expect(workflow).toContain('does not install, start, configure, or control the Obsidian desktop client');
  });
});
