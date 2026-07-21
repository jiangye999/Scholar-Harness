import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceDirectoryContext } from '../../../src/server/services/workspace-directory';
import {
  createWorkspaceToolRuntime,
  restoreWorkspaceEditBackup,
} from '../../../src/server/services/workspace-tools';
import { mirrorWorkspaceOutputFile } from '../../../src/server/services/workspace-output-mirror';

const tempRoots: string[] = [];

function createWorkspace(): { root: string; aiWorkRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-dual-output-'));
  tempRoots.push(root);
  const aiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'conversation-a');
  fs.mkdirSync(aiWorkRoot, { recursive: true });
  return { root, aiWorkRoot };
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('workspace dual output mirroring', () => {
  it('preserves the relative path when mirroring an AI output to the configured directory', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const sourcePath = path.join(aiWorkRoot, 'plots', 'latest-figure.png');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'latest image');

    const result = await mirrorWorkspaceOutputFile(sourcePath, root, aiWorkRoot);
    const configuredPath = path.join(root, 'plots', 'latest-figure.png');

    expect(result).toMatchObject({
      mirrored: true,
      sourcePath,
      targetPath: configuredPath,
      relativePath: path.join('plots', 'latest-figure.png'),
    });
    expect(fs.readFileSync(configuredPath, 'utf-8')).toBe('latest image');
  });

  it('does not mirror sequential page screenshots created for document QA', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const sourcePath = path.join(aiWorkRoot, 'review_v9', 'page1.png');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'temporary page render');

    const result = await mirrorWorkspaceOutputFile(sourcePath, root, aiWorkRoot);

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(root, 'review_v9', 'page1.png'))).toBe(false);
  });

  it('makes write_file create the same file in both configured and AI work directories', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const workspace: WorkspaceDirectoryContext = {
      available: true,
      root,
      permission: 'workspace-write',
      aiWorkRoot,
      safeWorkRoot: aiWorkRoot,
      generatedAt: new Date().toISOString(),
      fileCount: 0,
      omittedCount: 0,
      tree: '',
      files: [],
      contextMarkdown: '',
    };
    const runtime = createWorkspaceToolRuntime(workspace);

    const result = await runtime.executeToolCall({
      id: 'dual-write',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({
          path: 'reports/meta-summary.md',
          content: '# Meta summary\n',
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(aiWorkRoot, 'reports', 'meta-summary.md'), 'utf-8')).toBe('# Meta summary\n');
    expect(fs.readFileSync(path.join(root, 'reports', 'meta-summary.md'), 'utf-8')).toBe('# Meta summary\n');
    expect(result.data).toEqual(expect.objectContaining({
      originalUntouched: false,
      mirroredOutputs: expect.arrayContaining([
        expect.objectContaining({
          mirrored: true,
          targetPath: path.join(root, 'reports', 'meta-summary.md'),
        }),
      ]),
    }));

    const backupId = String((result.data as { backupId?: string }).backupId || '');
    await restoreWorkspaceEditBackup(backupId);
    expect(fs.existsSync(path.join(aiWorkRoot, 'reports', 'meta-summary.md'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'reports', 'meta-summary.md'))).toBe(false);
  }, 15_000);
});
