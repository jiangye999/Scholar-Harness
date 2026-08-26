import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceDirectoryContext } from '../../../src/server/services/workspace-directory';
import { createWorkspaceToolRuntime, isDangerousShellCommand } from '../../../src/server/services/workspace-tools';
import {
  AI_WORKBENCH_OUTPUT_DIRECTORIES,
  AI_WORKING_FILES_DIRECTORY_NAME,
  USER_VIEW_DIRECTORY_NAME,
  USER_VIEW_OUTPUT_DIRECTORIES,
} from '../../../src/server/services/workspace-workbench';
import { buildWordDraftDocxBuffer } from '../../../src/utils/word-draft-docx';

const tempRoots: string[] = [];

function createWorkspace(permission: WorkspaceDirectoryContext['permission'] = 'workspace-write') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-file-operations-'));
  tempRoots.push(root);
  const aiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'conversation-file-operations');
  fs.mkdirSync(aiWorkRoot, { recursive: true });
  const workspace: WorkspaceDirectoryContext = {
    available: true,
    root,
    permission,
    aiWorkRoot,
    safeWorkRoot: aiWorkRoot,
    generatedAt: new Date().toISOString(),
    fileCount: 0,
    omittedCount: 0,
    tree: '',
    files: [],
    contextMarkdown: '',
  };
  return {
    root,
    aiWorkRoot,
    runtime: createWorkspaceToolRuntime(workspace),
  };
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('workspace file organization tools', () => {
  it('extracts DOCX body text through read_file instead of rejecting it as binary', async () => {
    const { root, runtime } = createWorkspace('read-only');
    const docxPath = path.join(root, 'paper_manuscript_revised_v28.docx');
    const docx = await buildWordDraftDocxBuffer(
      '\\title{Current manuscript}\n\\section{Introduction}\nFresh v28 introduction paragraph.\n\nSecond paragraph.'
    );
    fs.writeFileSync(docxPath, docx);

    const result = await runtime.executeToolCall({
      id: 'read-v28-docx',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({
          path: 'paper_manuscript_revised_v28.docx',
          start_line: 1,
          max_lines: 100,
        }),
      },
    });

    const data = result.data as {
      content: string;
      contentType: string;
      extractionMethod: string;
    };
    expect(result.ok).toBe(true);
    expect(data.content).toContain('Fresh v28 introduction paragraph.');
    expect(data.content).toContain('Second paragraph.');
    expect(data.contentType).toBe('docx-text');
    expect(data.extractionMethod).toBe('mammoth');
  });

  it('applies multiple search/replace pairs in one edit_file call', { timeout: 15000 }, async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace('workspace-write');
    const filePath = path.join(root, 'notes.txt');
    fs.writeFileSync(filePath, 'AAA\nBBB\nCCC\n');

    // 必须先 read_file 建立“已读”状态，否则 edit_file 拒绝盲改。
    await runtime.executeToolCall({
      id: 'read-notes',
      type: 'function',
      function: { name: 'read_file', arguments: JSON.stringify({ path: 'notes.txt', max_lines: 10 }) },
    });

    const result = await runtime.executeToolCall({
      id: 'edit-notes',
      type: 'function',
      function: {
        name: 'edit_file',
        arguments: JSON.stringify({
          path: 'notes.txt',
          edits: [
            { search: 'AAA', replace: '111' },
            { search: 'CCC', replace: '333' },
          ],
        }),
      },
    });

    expect(result.ok).toBe(true);
    const data = result.data as { editCount: number };
    expect(data.editCount).toBe(2);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('AAA\nBBB\nCCC\n');
    expect(fs.readFileSync(path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, 'notes.txt'), 'utf-8')).toBe('111\nBBB\n333\n');
  });

  it('read_file batch reads multiple files via paths', { timeout: 15000 }, async () => {
    const { root, runtime } = createWorkspace('read-only');
    fs.writeFileSync(path.join(root, 'a.txt'), 'line-a\n');
    fs.writeFileSync(path.join(root, 'b.txt'), 'line-b\n');

    const result = await runtime.executeToolCall({
      id: 'read-batch',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ paths: ['a.txt', 'b.txt'], max_lines: 5 }),
      },
    });

    expect(result.ok).toBe(true);
    const data = result.data as { count: number; files: Array<{ content: string }> };
    expect(data.count).toBe(2);
    expect(data.files[0].content).toContain('line-a');
    expect(data.files[1].content).toContain('line-b');
  });

  it('write_file batch writes multiple files in one call', { timeout: 15000 }, async () => {
    const { aiWorkRoot, runtime } = createWorkspace('workspace-write');
    const result = await runtime.executeToolCall({
      id: 'write-batch',
      type: 'function',
      function: {
        name: 'write_file',
        arguments: JSON.stringify({
          files: [
            { path: 'x.txt', content: 'X content' },
            { path: 'sub/y.txt', content: 'Y content' },
          ],
        }),
      },
    });

    expect(result.ok).toBe(true);
    const data = result.data as { count: number };
    expect(data.count).toBe(2);
    expect(fs.readFileSync(path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.other, 'x.txt'), 'utf-8')).toBe('X content');
    expect(fs.readFileSync(path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.other, 'sub', 'y.txt'), 'utf-8')).toBe('Y content');
  });

  it('workspace_overview returns tree and file previews in one call', { timeout: 15000 }, async () => {
    const { root, runtime } = createWorkspace('read-only');
    fs.writeFileSync(path.join(root, 'readme.txt'), 'line one\nline two\nline three\n');
    fs.writeFileSync(path.join(root, 'data.csv'), 'a,b\n1,2\n');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'main.py'), 'print("hi")\n');

    const result = await runtime.executeToolCall({
      id: 'overview',
      type: 'function',
      function: { name: 'workspace_overview', arguments: JSON.stringify({ scope: 'all', preview_lines: 2 }) },
    });

    expect(result.ok).toBe(true);
    const data = result.data as { fileCount: number; files: Array<{ path: string; preview?: string }> };
    expect(data.fileCount).toBeGreaterThanOrEqual(3);
    const readme = data.files.find(file => file.path.includes('readme.txt'));
    expect(readme).toBeDefined();
    expect(readme?.preview).toContain('line one');
  });

  it('moves only the AI working copy and leaves the source tree untouched', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    const sourcePath = path.join(root, 'figure1', 'code', 'analysis.R');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.writeFileSync(sourcePath, 'print("ok")\n', 'utf-8');

    const result = await runtime.executeToolCall({
      id: 'move-code-file',
      type: 'function',
      function: {
        name: 'move_file',
        arguments: JSON.stringify({
          source: 'figure1/code/analysis.R',
          destination: 'figure1/analysis.R',
        }),
      },
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(sourcePath)).toBe(true);
    expect(fs.existsSync(path.join(root, 'figure1', 'analysis.R'))).toBe(false);
    expect(fs.existsSync(path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME, 'figure1', 'code', 'analysis.R'))).toBe(false);
    expect(fs.readFileSync(path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.other, 'figure1', 'analysis.R'), 'utf-8')).toBe('print("ok")\n');
    expect(fs.existsSync(path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.figures,
      'figure1',
      `analysis.R${process.platform === 'win32' ? '.lnk' : ''}`,
    ))).toBe(true);
  }, 15_000);

  it('deletes only empty directories after files have been moved', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    const emptyDirectory = path.join(aiWorkRoot, 'figure1', 'code');
    const nonEmptyDirectory = path.join(aiWorkRoot, 'figure1', 'data');
    fs.mkdirSync(emptyDirectory, { recursive: true });
    fs.mkdirSync(nonEmptyDirectory, { recursive: true });
    fs.writeFileSync(path.join(nonEmptyDirectory, 'values.csv'), 'x\n1\n', 'utf-8');

    const emptyResult = await runtime.executeToolCall({
      id: 'remove-empty-code',
      type: 'function',
      function: {
        name: 'remove_empty_directory',
        arguments: JSON.stringify({ path: path.relative(root, emptyDirectory) }),
      },
    });
    const nonEmptyResult = await runtime.executeToolCall({
      id: 'reject-non-empty-data',
      type: 'function',
      function: {
        name: 'remove_empty_directory',
        arguments: JSON.stringify({ path: path.relative(root, nonEmptyDirectory) }),
      },
    });

    expect(emptyResult.ok).toBe(true);
    expect(fs.existsSync(emptyDirectory)).toBe(false);
    expect(nonEmptyResult.ok).toBe(false);
    expect(nonEmptyResult.error).toContain('不是空目录');
    expect(fs.existsSync(nonEmptyDirectory)).toBe(true);
  }, 15_000);

  it('exposes organization tools only when the workspace is writable', () => {
    const writable = createWorkspace('workspace-write').runtime;
    const readOnly = createWorkspace('read-only').runtime;
    const writableNames = writable.getToolDefinitions().map(tool => tool.function.name);
    const readOnlyNames = readOnly.getToolDefinitions().map(tool => tool.function.name);

    expect(writableNames).toContain('move_file');
    expect(writableNames).toContain('remove_empty_directory');
    expect(writableNames).toContain('import_workspace_assets');
    expect(writableNames).toContain('build_figures_tables_docx');
    expect(readOnlyNames).not.toContain('move_file');
    expect(readOnlyNames).not.toContain('remove_empty_directory');
    expect(readOnlyNames).not.toContain('import_workspace_assets');
    expect(readOnlyNames).not.toContain('build_figures_tables_docx');
  });

  it('import_workspace_assets copies source assets into the canonical structure without touching the source', async () => {
    const { root, aiWorkRoot, runtime } = createWorkspace();
    const resultsDir = path.join(root, 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(path.join(resultsDir, 'fig1.png'), Buffer.from('fake-png'));
    fs.writeFileSync(path.join(root, 'manuscript.docx'), Buffer.from('fake-docx'));

    const result = await runtime.executeToolCall({
      id: 'import-assets',
      type: 'function',
      function: {
        name: 'import_workspace_assets',
        arguments: JSON.stringify({ dry_run: false, build_docx: false }),
      },
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(aiWorkRoot, 'figures_tables', 'figure1', 'figure1.png'))).toBe(true);
    expect(fs.existsSync(path.join(aiWorkRoot, 'drafts', 'manuscript.docx'))).toBe(true);
    // Source untouched.
    expect(fs.existsSync(path.join(resultsDir, 'fig1.png'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'manuscript.docx'))).toBe(true);

    // Idempotent second run: nothing new to import.
    const second = await runtime.executeToolCall({
      id: 'import-assets-again',
      type: 'function',
      function: {
        name: 'import_workspace_assets',
        arguments: JSON.stringify({ dry_run: false, build_docx: false }),
      },
    });
    const secondData = second.data as { imported: unknown[] };
    expect(second.ok).toBe(true);
    expect(secondData.imported.length).toBe(0);
  }, 15_000);

  it('build_figures_tables_docx generates the integrated Word document', async () => {
    const { aiWorkRoot, runtime } = createWorkspace();
    const figure1Dir = path.join(aiWorkRoot, 'figures_tables', 'figure1');
    fs.mkdirSync(figure1Dir, { recursive: true });
    fs.writeFileSync(path.join(figure1Dir, 'figure1.png'), Buffer.from('fake-png'));
    fs.writeFileSync(path.join(figure1Dir, 'figure1_caption.txt'), 'My caption\nnote text');

    const result = await runtime.executeToolCall({
      id: 'build-docx',
      type: 'function',
      function: {
        name: 'build_figures_tables_docx',
        arguments: JSON.stringify({}),
      },
    });

    expect(result.ok).toBe(true);
    expect(fs.existsSync(path.join(aiWorkRoot, 'figures_tables', 'figures_tables.docx'))).toBe(true);
    const data = result.data as { included: unknown[] };
    expect(data.included.length).toBe(1);
  }, 15_000);

  it('exec_shell allows read-only PowerShell pipelines with Format-Table (not a disk format)', async () => {
    // Pure decision test: Format-Table must NOT be treated as a disk format.
    const pipeline = 'Get-ChildItem -Path "images" -Filter "*.png" | Where-Object { $_.Name -like "clean*" } | Select-Object Name, Length | Format-Table -AutoSize';
    expect(isDangerousShellCommand(pipeline)).toBe(false);
    expect(isDangerousShellCommand('format D:')).toBe(true);
    expect(isDangerousShellCommand('rm -rf C:\\Windows')).toBe(true);
  });

  it('exec_shell still blocks real disk-format commands', async () => {
    const { runtime } = createWorkspace();
    const result = await runtime.executeToolCall({
      id: 'format-disk',
      type: 'function',
      function: {
        name: 'exec_shell',
        arguments: JSON.stringify({ command: 'format D:' }),
      },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('高风险');
  }, 15_000);

  it('read_file failure on a missing file tells the agent not to guess paths', async () => {
    const { root, runtime } = createWorkspace();
    const result = await runtime.executeToolCall({
      id: 'read-missing',
      type: 'function',
      function: {
        name: 'read_file',
        arguments: JSON.stringify({ path: 'figure5/detect_fig5_tags.py' }),
      },
    });
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('ENOENT');
    expect(String(result.error)).toContain('不要猜测路径');
  }, 15_000);
});
