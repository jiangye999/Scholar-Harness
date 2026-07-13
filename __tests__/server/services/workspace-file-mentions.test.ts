import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { searchWorkspaceFileMentions } from '../../../src/server/services/workspace-directory';

describe('workspace file mentions', () => {
  const roots: string[] = [];

  afterEach(() => {
    roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  });

  it('ranks matching nested file paths without requiring content search', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-mentions-'));
    roots.push(root);
    mkdirSync(path.join(root, 'figures'), { recursive: true });
    mkdirSync(path.join(root, 'drafts'), { recursive: true });
    writeFileSync(path.join(root, 'figures', 'genes_box_2024_NH4.R'), 'plot(1)', 'utf-8');
    writeFileSync(path.join(root, 'drafts', 'abstract.txt'), 'unrelated content', 'utf-8');

    const result = await searchWorkspaceFileMentions(root, 'genes box NH4', 20);

    expect(result.files[0]).toMatchObject({
      path: 'figures/genes_box_2024_NH4.R',
      name: 'genes_box_2024_NH4.R',
      kind: 'code',
    });
  });

  it('returns a bounded initial file list for a bare @', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-mentions-'));
    roots.push(root);
    for (let index = 0; index < 6; index += 1) {
      writeFileSync(path.join(root, `file-${index}.txt`), String(index), 'utf-8');
    }

    const result = await searchWorkspaceFileMentions(root, '', 3);
    expect(result.files).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('interleaves every file kind for a bare @ instead of filling the list with text files', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-mentions-'));
    roots.push(root);
    for (let index = 0; index < 50; index += 1) {
      writeFileSync(path.join(root, `notes-${index}.txt`), String(index), 'utf-8');
    }
    writeFileSync(path.join(root, 'paper.docx'), 'docx');
    writeFileSync(path.join(root, 'measurements.xlsx'), 'xlsx');
    writeFileSync(path.join(root, 'slides.pptx'), 'pptx');
    writeFileSync(path.join(root, 'article.pdf'), 'pdf');
    writeFileSync(path.join(root, 'figure.png'), 'png');
    writeFileSync(path.join(root, 'workspace.RData'), 'binary');

    const result = await searchWorkspaceFileMentions(root, '', 20);
    const kinds = new Set(result.files.map(file => file.kind));

    expect(Array.from(kinds)).toEqual(expect.arrayContaining([
      'word',
      'spreadsheet',
      'presentation',
      'pdf',
      'image',
      'text',
      'file',
    ]));
    expect(result.files.map(file => file.name)).toContain('workspace.RData');
  });
});
