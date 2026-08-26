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
import {
  AI_WORKBENCH_OUTPUT_DIRECTORIES,
  AI_WORKING_FILES_DIRECTORY_NAME,
  USER_VIEW_DIRECTORY_NAME,
  USER_VIEW_OUTPUT_DIRECTORIES,
} from '../../../src/server/services/workspace-workbench';

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

describe('workspace output publication', () => {
  it('publishes a figure under the dedicated user-view figure directory', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const sourcePath = path.join(aiWorkRoot, 'plots', 'latest-figure.png');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'latest image');

    const result = await mirrorWorkspaceOutputFile(sourcePath, root, aiWorkRoot);
    const shortcutPath = path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.figures,
      'plots',
      `latest-figure.png${process.platform === 'win32' ? '.lnk' : ''}`,
    );

    expect(result).toMatchObject({
      mirrored: true,
      sourcePath,
      targetPath: shortcutPath,
      relativePath: 'plots/latest-figure.png',
    });
    expect(fs.existsSync(shortcutPath)).toBe(true);
    expect(fs.existsSync(path.join(root, 'plots', 'latest-figure.png'))).toBe(false);
  }, 15_000);

  it('does not mirror sequential page screenshots created for document QA', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const sourcePath = path.join(aiWorkRoot, 'review_v9', 'page1.png');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'temporary page render');

    const result = await mirrorWorkspaceOutputFile(sourcePath, root, aiWorkRoot);

    expect(result).toBeNull();
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, 'review_v9'))).toBe(false);
  });

  it('does not publish logs or files from generic temporary directories', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const logPath = path.join(aiWorkRoot, 'run.log');
    const tempPath = path.join(aiWorkRoot, 'tmp', 'result.csv');
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    fs.writeFileSync(logPath, 'runtime log');
    fs.writeFileSync(tempPath, 'intermediate data');

    expect(await mirrorWorkspaceOutputFile(logPath, root, aiWorkRoot)).toBeNull();
    expect(await mirrorWorkspaceOutputFile(tempPath, root, aiWorkRoot)).toBeNull();
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, 'run.log'))).toBe(false);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, 'tmp', 'result.csv'))).toBe(false);
  });

  it('keeps a new write_file artifact in the AI workspace and automatically exposes its shortcut', async () => {
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
    const artifactPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.other, 'reports', 'meta-summary.md');
    const shortcutPath = path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.other,
      'reports',
      `meta-summary.md${process.platform === 'win32' ? '.lnk' : ''}`,
    );
    expect(fs.readFileSync(artifactPath, 'utf-8')).toBe('# Meta summary\n');
    expect(fs.existsSync(path.join(root, 'reports', 'meta-summary.md'))).toBe(false);
    expect(result.data).toEqual(expect.objectContaining({
      originalUntouched: true,
    }));
    expect(fs.existsSync(shortcutPath)).toBe(true);

    const published = await runtime.executeToolCall({
      id: 'publish-write',
      type: 'function',
      function: {
        name: 'publish_workspace_artifacts',
        arguments: JSON.stringify({ paths: [path.relative(aiWorkRoot, artifactPath)] }),
      },
    });

    expect(published.ok).toBe(true);
    expect(fs.existsSync(shortcutPath)).toBe(true);
    expect(fs.existsSync(path.join(root, 'reports', 'meta-summary.md'))).toBe(false);
    expect(published.data).toEqual(expect.objectContaining({ count: 1 }));

    const backupId = String((result.data as { backupId?: string }).backupId || '');
    await restoreWorkspaceEditBackup(backupId);
    expect(fs.existsSync(artifactPath)).toBe(false);
    expect(fs.existsSync(shortcutPath)).toBe(false);
  }, 15_000);

  it('edits an existing source file only in the working area and refreshes its shortcut', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    fs.writeFileSync(path.join(root, 'notes.txt'), 'before\n');
    const runtime = createWorkspaceToolRuntime({
      available: true,
      root,
      permission: 'workspace-write',
      aiWorkRoot,
      safeWorkRoot: aiWorkRoot,
      generatedAt: new Date().toISOString(),
      fileCount: 1,
      omittedCount: 0,
      tree: '',
      files: [],
      contextMarkdown: '',
    });

    await runtime.executeToolCall({
      id: 'read-existing',
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path: 'notes.txt' }) },
    });
    const edited = await runtime.executeToolCall({
      id: 'edit-existing',
      type: 'function',
      function: {
        name: 'edit_file',
        arguments: JSON.stringify({ path: 'notes.txt', search: 'before', replace: 'after' }),
      },
    });

    expect(edited.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'notes.txt'), 'utf-8')).toBe('before\n');
    expect(fs.readFileSync(path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, 'notes.txt'), 'utf-8')).toBe('after\n');
    expect(fs.existsSync(path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.other,
      `notes.txt${process.platform === 'win32' ? '.lnk' : ''}`,
    ))).toBe(true);
  }, 15_000);

  it('keeps generic shell outputs out of the configured root', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const runtime = createWorkspaceToolRuntime({
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
    });
    const command = process.platform === 'win32'
      ? "Set-Content -LiteralPath 'shell-temp.log' -Value 'temporary'"
      : "printf 'temporary' > shell-temp.log";
    const result = await runtime.executeToolCall({
      id: 'shell-output',
      type: 'function',
      function: { name: 'exec_shell', arguments: JSON.stringify({ command }) },
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(aiWorkRoot, 'shell-temp.log'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'shell-temp.log'))).toBe(false);
  }, 15_000);
});
