import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceDirectoryContext } from '../../../src/server/services/workspace-directory';
import { createWorkspaceToolRuntime } from '../../../src/server/services/workspace-tools';
import {
  AI_SOURCE_COPY_DIRECTORY_NAME,
  AI_WORKING_FILES_DIRECTORY_NAME,
  USER_VIEW_DIRECTORY_NAME,
  USER_VIEW_OUTPUT_DIRECTORIES,
  prepareWorkspaceWorkbench,
} from '../../../src/server/services/workspace-workbench';

const roots: string[] = [];

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-source-authority-'));
  roots.push(root);
  const aiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Conversation-current');
  fs.mkdirSync(aiWorkRoot, { recursive: true });
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
  return { root, aiWorkRoot, runtime: createWorkspaceToolRuntime(workspace) };
}

function call(
  runtime: ReturnType<typeof createWorkspaceToolRuntime>,
  name: string,
  args: Record<string, unknown>,
) {
  return runtime.executeToolCall({
    id: `source-authority-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('user source file authority', () => {
  it('refreshes the source snapshot but continues editing the user-visible working copy', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    const sourcePath = path.join(root, 'notes.txt');
    const sourceCopyPath = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME, 'notes.txt');
    const workingPath = path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, 'notes.txt');
    fs.writeFileSync(sourcePath, 'user version one\n');

    const firstRead = await call(runtime, 'read_file', { path: 'notes.txt' });
    expect(firstRead.ok).toBe(true);
    expect((firstRead.data as { content: string }).content).toContain('user version one');
    expect(fs.readFileSync(sourceCopyPath, 'utf-8')).toBe('user version one\n');
    expect(fs.readFileSync(workingPath, 'utf-8')).toBe('user version one\n');

    // Same-length saves are intentionally covered: content verification must
    // not rely only on size or a coarse filesystem timestamp.
    const firstSourceStat = fs.statSync(sourcePath);
    fs.writeFileSync(sourcePath, 'user version two\n');
    fs.utimesSync(sourcePath, firstSourceStat.atime, firstSourceStat.mtime);
    const secondRead = await call(runtime, 'read_file', { path: 'notes.txt' });
    expect((secondRead.data as { content: string }).content).toContain('user version one');
    expect(fs.readFileSync(sourceCopyPath, 'utf-8')).toBe('user version two\n');

    const edited = await call(runtime, 'edit_file', {
      path: 'notes.txt',
      search: 'one',
      replace: 'one plus AI',
    });
    expect(edited.ok).toBe(true);
    expect(fs.readFileSync(workingPath, 'utf-8')).toBe('user version one plus AI\n');
    expect(fs.readFileSync(sourcePath, 'utf-8')).toBe('user version two\n');
  }, 15_000);

  it('keeps a concurrent source save separate from the Agent working copy', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    const sourcePath = path.join(root, 'draft.txt');
    const workingPath = path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, 'draft.txt');
    fs.writeFileSync(sourcePath, 'before user save\n');

    await call(runtime, 'read_file', { path: 'draft.txt' });
    fs.writeFileSync(sourcePath, 'after user save!\n');
    const edited = await call(runtime, 'edit_file', {
      path: 'draft.txt',
      search: 'before',
      replace: 'AI',
    });

    expect(edited.ok).toBe(true);
    expect(fs.readFileSync(sourcePath, 'utf-8')).toBe('after user save!\n');
    expect(fs.readFileSync(workingPath, 'utf-8')).toBe('AI user save\n');
  }, 15_000);

  it('refreshes every source file before an Agent turn without touching AI-only outputs', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const sourcePath = path.join(root, 'paper.docx');
    const sourceCopyPath = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME, 'paper.docx');
    const aiOnlyPath = path.join(aiWorkRoot, 'new-analysis.md');
    fs.writeFileSync(sourcePath, 'latest user document');
    fs.writeFileSync(aiOnlyPath, 'AI-only result');

    const result = await prepareWorkspaceWorkbench(root, aiWorkRoot);

    expect(result.scanned).toBe(1);
    expect(result.copied).toBe(1);
    expect(fs.readFileSync(sourceCopyPath, 'utf-8')).toBe('latest user document');
    expect(fs.readFileSync(aiOnlyPath, 'utf-8')).toBe('AI-only result');
  });

  it('copies a newly created source file only when the Agent explicitly reads it', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    fs.writeFileSync(path.join(root, 'existing.txt'), 'existing');
    await runtime.prepareSafeWorkspace();
    const newSourcePath = path.join(root, 'new-after-prepare.txt');
    const newSourceCopyPath = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME, 'new-after-prepare.txt');
    fs.writeFileSync(newSourcePath, 'new source content');

    expect(fs.existsSync(newSourceCopyPath)).toBe(false);
    const read = await call(runtime, 'read_file', { path: 'new-after-prepare.txt' });

    expect(read.ok).toBe(true);
    expect((read.data as { content: string }).content).toContain('new source content');
    expect(fs.readFileSync(newSourceCopyPath, 'utf-8')).toBe('new source content');
  });

  it('publishes a CLI-edited workbench file only as a latest shortcut', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    const sourcePath = path.join(root, 'manuscript.txt');
    const sourceCopyPath = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME, 'manuscript.txt');
    const workingPath = path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, 'manuscript.txt');
    fs.writeFileSync(sourcePath, 'source at turn start\n');

    await runtime.prepareSafeWorkspace();
    expect(fs.existsSync(sourceCopyPath)).toBe(false);
    const initialRead = await call(runtime, 'read_file', { path: 'manuscript.txt' });
    expect(initialRead.ok).toBe(true);
    expect(fs.readFileSync(sourceCopyPath, 'utf-8')).toBe('source at turn start\n');
    fs.mkdirSync(path.dirname(workingPath), { recursive: true });
    fs.copyFileSync(sourceCopyPath, workingPath);
    const turnStartStat = fs.statSync(sourcePath);

    // Simulate Codex/Pi/OpenCode editing through its own CLI inside cwd while
    // the user saves the visible source file during the same turn.
    fs.writeFileSync(workingPath, 'Agent result\n');
    fs.writeFileSync(sourcePath, 'user concurrent save\n');
    fs.utimesSync(sourcePath, turnStartStat.atime, turnStartStat.mtime);
    const published = await call(runtime, 'publish_workspace_artifacts', {
      path: path.relative(aiWorkRoot, workingPath),
    });

    expect(published.ok).toBe(true);
    expect(fs.readFileSync(sourcePath, 'utf-8')).toBe('user concurrent save\n');
    expect(fs.readFileSync(workingPath, 'utf-8')).toBe('Agent result\n');
    const shortcutRelative = path.join(USER_VIEW_OUTPUT_DIRECTORIES.other, `manuscript.txt${process.platform === 'win32' ? '.lnk' : ''}`);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, shortcutRelative))).toBe(true);
  }, 15_000);
});
