import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceDirectoryContext } from '../../../src/server/services/workspace-directory';
import { createWorkspaceToolRuntime } from '../../../src/server/services/workspace-tools';
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

  it('moves a file without overwriting and mirrors the operation to both workspace roots', async () => {
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
    expect(fs.existsSync(sourcePath)).toBe(false);
    expect(fs.readFileSync(path.join(root, 'figure1', 'analysis.R'), 'utf-8')).toBe('print("ok")\n');
    expect(fs.existsSync(path.join(aiWorkRoot, 'figure1', 'code', 'analysis.R'))).toBe(false);
    expect(fs.readFileSync(path.join(aiWorkRoot, 'figure1', 'analysis.R'), 'utf-8')).toBe('print("ok")\n');
  }, 15_000);

  it('deletes only empty directories after files have been moved', async () => {
    const { root, runtime } = createWorkspace();
    const emptyDirectory = path.join(root, 'figure1', 'code');
    const nonEmptyDirectory = path.join(root, 'figure1', 'data');
    fs.mkdirSync(emptyDirectory, { recursive: true });
    fs.mkdirSync(nonEmptyDirectory, { recursive: true });
    fs.writeFileSync(path.join(nonEmptyDirectory, 'values.csv'), 'x\n1\n', 'utf-8');

    const emptyResult = await runtime.executeToolCall({
      id: 'remove-empty-code',
      type: 'function',
      function: {
        name: 'remove_empty_directory',
        arguments: JSON.stringify({ path: 'figure1/code' }),
      },
    });
    const nonEmptyResult = await runtime.executeToolCall({
      id: 'reject-non-empty-data',
      type: 'function',
      function: {
        name: 'remove_empty_directory',
        arguments: JSON.stringify({ path: 'figure1/data' }),
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
    expect(readOnlyNames).not.toContain('move_file');
    expect(readOnlyNames).not.toContain('remove_empty_directory');
  });
});
