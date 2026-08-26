import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  searchWorkspaceFiles,
  type WorkspaceDirectoryContext,
} from '../../../src/server/services/workspace-directory';
import { createWorkspaceToolRuntime } from '../../../src/server/services/workspace-tools';
import {
  AI_WORKBENCH_OUTPUT_DIRECTORIES,
  USER_VIEW_DIRECTORY_NAME,
  USER_VIEW_OUTPUT_DIRECTORIES,
} from '../../../src/server/services/workspace-workbench';

describe('recursive workspace authorization', () => {
  const roots: string[] = [];

  afterEach(() => {
    roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  });

  function createWorkspace(permission: WorkspaceDirectoryContext['permission'] = 'read-only') {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-recursive-'));
    roots.push(root);
    const deepDir = path.join(root, 'level-1', 'level-2', 'target-folder');
    const dependencyDir = path.join(root, 'node_modules', 'example-package', 'lib');
    mkdirSync(deepDir, { recursive: true });
    mkdirSync(dependencyDir, { recursive: true });
    writeFileSync(path.join(deepDir, 'deep-evidence.txt'), 'nested evidence marker', 'utf-8');
    writeFileSync(path.join(dependencyDir, 'dependency-source.js'), 'export const marker = 42;', 'utf-8');
    const workspace: WorkspaceDirectoryContext = {
      available: true,
      root,
      permission,
      generatedAt: new Date().toISOString(),
      fileCount: 2,
      omittedCount: 0,
      tree: '',
      files: [],
      contextMarkdown: '',
    };
    return { root, deepDir, workspace };
  }

  it('searches ordinary descendant directories without entering dependency trees', async () => {
    const { root } = createWorkspace();

    const deepResult = await searchWorkspaceFiles(root, 'deep-evidence', 20);
    const dependencyResult = await searchWorkspaceFiles(root, 'dependency-source', 20);

    expect(deepResult.results[0]?.path).toBe('level-1/level-2/target-folder/deep-evidence.txt');
    expect(dependencyResult.results).toEqual([]);
  });

  it('recursively lists directories and files by default', async () => {
    const { workspace } = createWorkspace();
    const runtime = createWorkspaceToolRuntime(workspace);

    const result = await runtime.executeToolCall({
      id: 'recursive-list',
      type: 'function',
      function: {
        name: 'list_dir',
        arguments: JSON.stringify({ max_entries: 100 }),
      },
    });
    const data = result.data as {
      recursive: boolean;
      entries: Array<{ path: string; kind: string }>;
    };

    expect(result.ok).toBe(true);
    expect(data.recursive).toBe(true);
    expect(data.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'level-1/level-2/target-folder', kind: 'directory' }),
      expect.objectContaining({
        path: 'level-1/level-2/target-folder/deep-evidence.txt',
        kind: 'text',
      }),
    ]));
  });

  it('searches directory names as well as deeply nested file names', async () => {
    const { workspace } = createWorkspace();
    const runtime = createWorkspaceToolRuntime(workspace);

    const result = await runtime.executeToolCall({
      id: 'recursive-search',
      type: 'function',
      function: {
        name: 'file_search',
        arguments: JSON.stringify({ query: 'target-folder', limit: 20 }),
      },
    });
    const data = result.data as {
      scope: string;
      results: Array<{ path: string; kind: string }>;
      directoriesSearched: number;
      filesSearched: number;
    };

    expect(result.ok).toBe(true);
    expect(data.scope).toBe('current');
    expect(data.directoriesSearched).toBeGreaterThan(0);
    expect(data.filesSearched).toBeGreaterThan(0);
    expect(data.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: 'level-1/level-2/target-folder',
        kind: 'directory',
      }),
      expect.objectContaining({
        path: 'level-1/level-2/target-folder/deep-evidence.txt',
      }),
    ]));
  });

  it('inherits read and write permissions into nested folders but rejects paths outside the root', async () => {
    const readOnly = createWorkspace('read-only');
    const readRuntime = createWorkspaceToolRuntime(readOnly.workspace);
    const readResult = await readRuntime.executeToolCall({
      id: 'nested-read',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({
          path: 'level-1/level-2/target-folder/deep-evidence.txt',
        }),
      },
    });
    expect(readResult.ok).toBe(true);

    const writable = createWorkspace('workspace-write');
    const writeRuntime = createWorkspaceToolRuntime(writable.workspace);
    const writeResult = await writeRuntime.executeToolCall({
      id: 'nested-write',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({
          path: 'level-1/level-2/target-folder/generated-result.txt',
          content: 'generated in nested folder',
        }),
      },
    });
    expect(writeResult.ok).toBe(true);
    const safeWorkRoot = writeRuntime.getSafeWorkInfo().root as string;
    const generatedRelativePath = path.join(
      AI_WORKBENCH_OUTPUT_DIRECTORIES.other,
      'level-1',
      'level-2',
      'target-folder',
      'generated-result.txt',
    );
    expect(readFileSync(
      path.join(safeWorkRoot, generatedRelativePath),
      'utf-8'
    )).toBe('generated in nested folder');
    expect(() => readFileSync(
      path.join(writable.root, 'level-1', 'level-2', 'target-folder', 'generated-result.txt'),
      'utf-8'
    )).toThrow();

    const publishResult = await writeRuntime.executeToolCall({
      id: 'nested-publish',
      type: 'function',
      function: {
        name: 'publish_workspace_artifacts',
        arguments: JSON.stringify({
          paths: [generatedRelativePath],
        }),
      },
    });
    expect(publishResult.ok).toBe(true);
    expect(() => readFileSync(
      path.join(writable.root, 'level-1', 'level-2', 'target-folder', 'generated-result.txt'),
      'utf-8'
    )).toThrow();
    expect(existsSync(path.join(
      writable.root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.other,
      'level-1',
      'level-2',
      'target-folder',
      `generated-result.txt${process.platform === 'win32' ? '.lnk' : ''}`,
    ))).toBe(true);

    const outsideResult = await readRuntime.executeToolCall({
      id: 'outside-read',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ path: '../outside.txt' }),
      },
    });
    expect(outsideResult.ok).toBe(false);
    expect(outsideResult.error).toContain('授权范围');
  }, 15_000);
});
