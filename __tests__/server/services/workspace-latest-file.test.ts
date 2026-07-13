import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import { searchWorkspaceFiles, type WorkspaceDirectoryContext } from '../../../src/server/services/workspace-directory';
import { createWorkspaceToolRuntime } from '../../../src/server/services/workspace-tools';

describe('workspace latest file ranking', () => {
  const roots: string[] = [];

  afterEach(() => {
    roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  });

  function createWordVersions(): string {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-latest-'));
    roots.push(root);
    const oldPath = path.join(root, 'paper-draft-final.docx');
    const newPath = path.join(root, 'paper-draft-revised.docx');
    writeFileSync(oldPath, 'old');
    writeFileSync(newPath, 'new');
    utimesSync(oldPath, new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'));
    utimesSync(newPath, new Date('2026-07-12T00:00:00.000Z'), new Date('2026-07-12T00:00:00.000Z'));
    return root;
  }

  it('ranks same-kind Word candidates by modification time for newest queries', async () => {
    const root = createWordVersions();

    const result = await searchWorkspaceFiles(root, '找一下最新的 Word 草稿文件', 20);

    expect(result.results[0]).toMatchObject({
      path: 'paper-draft-revised.docx',
      kind: 'word',
      modifiedAt: '2026-07-12T00:00:00.000Z',
    });
  });

  it('refreshes the workspace index so a newly saved Word version is visible immediately', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-latest-refresh-'));
    roots.push(root);
    const oldPath = path.join(root, 'draft.docx');
    writeFileSync(oldPath, 'old');
    utimesSync(oldPath, new Date('2026-07-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'));
    await searchWorkspaceFiles(root, 'Word 文件', 20);

    const newPath = path.join(root, 'draft-revised.docx');
    writeFileSync(newPath, 'new');
    utimesSync(newPath, new Date('2026-07-13T00:00:00.000Z'), new Date('2026-07-13T00:00:00.000Z'));
    const result = await searchWorkspaceFiles(root, '最新 Word 文件', 20);

    expect(result.results[0]?.path).toBe('draft-revised.docx');
  });

  it('returns modification metadata in the native file_search tool', async () => {
    const root = createWordVersions();
    const workspace: WorkspaceDirectoryContext = {
      available: true,
      root,
      permission: 'read-only',
      generatedAt: new Date().toISOString(),
      fileCount: 2,
      omittedCount: 0,
      tree: '',
      files: [],
      contextMarkdown: '',
    };
    const runtime = createWorkspaceToolRuntime(workspace);

    const result = await runtime.executeToolCall({
      id: 'latest-word',
      type: 'function',
      function: {
        name: 'file_search',
        arguments: JSON.stringify({ query: '最新的 Word 文件', limit: 20 }),
      },
    });
    const data = result.data as { results: Array<{ path: string; modifiedAt: string }> };

    expect(result.ok).toBe(true);
    expect(data.results[0]).toEqual(expect.objectContaining({
      path: 'paper-draft-revised.docx',
      modifiedAt: '2026-07-12T00:00:00.000Z',
    }));
  });
});
