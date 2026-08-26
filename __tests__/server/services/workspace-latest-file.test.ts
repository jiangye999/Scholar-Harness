import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  buildWorkspaceAgentPrelude,
  buildWorkspaceDirectoryContext,
  normalizeWorkspaceDirectoryInput,
  searchWorkspaceFiles,
  type WorkspaceDirectoryContext,
} from '../../../src/server/services/workspace-directory';
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
      createdAt: expect.any(String),
      modifiedAt: '2026-07-12T00:00:00.000Z',
    });
  });

  it('defaults to the freshest relevant candidate when the user omits the word latest', async () => {
    const root = createWordVersions();

    const result = await searchWorkspaceFiles(root, 'Word 草稿文件', 20);

    expect(result.results[0]).toEqual(expect.objectContaining({
      path: 'paper-draft-revised.docx',
      createdAt: expect.any(String),
      modifiedAt: '2026-07-12T00:00:00.000Z',
    }));
  });

  it('distinguishes newly generated files from recently modified files', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-file-times-'));
    roots.push(root);
    const olderCreatedPath = path.join(root, 'figure-analysis-a.txt');
    const newerCreatedPath = path.join(root, 'figure-analysis-b.txt');
    writeFileSync(olderCreatedPath, 'created first');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30);
    writeFileSync(newerCreatedPath, 'created second');
    utimesSync(olderCreatedPath, new Date('2026-08-21T00:00:00.000Z'), new Date('2026-08-21T00:00:00.000Z'));
    utimesSync(newerCreatedPath, new Date('2026-08-20T00:00:00.000Z'), new Date('2026-08-20T00:00:00.000Z'));

    const generated = await searchWorkspaceFiles(root, '最新生成的 figure analysis 文件', 20);
    const modified = await searchWorkspaceFiles(root, '最近修改的 figure analysis 文件', 20);

    expect(generated.results[0]?.path).toBe('figure-analysis-b.txt');
    expect(modified.results[0]?.path).toBe('figure-analysis-a.txt');
    expect(generated.results[0]).toEqual(expect.objectContaining({
      createdAt: expect.any(String),
      modifiedAt: '2026-08-20T00:00:00.000Z',
    }));
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
    const data = result.data as { results: Array<{ path: string; createdAt: string; modifiedAt: string }> };

    expect(result.ok).toBe(true);
    expect(data.results[0]).toEqual(expect.objectContaining({
      path: 'paper-draft-revised.docx',
      createdAt: expect.any(String),
      modifiedAt: '2026-07-12T00:00:00.000Z',
    }));
  });

  it('searches the current conversation AI work directory together with the configured root', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-dual-search-'));
    roots.push(root);
    const aiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'conversation-current');
    mkdirSync(aiWorkRoot, { recursive: true });
    writeFileSync(path.join(root, 'configured-notes.txt'), 'configured root');
    const aiDraftPath = path.join(aiWorkRoot, 'latest-manuscript-draft.docx');
    writeFileSync(aiDraftPath, 'AI work draft');
    utimesSync(aiDraftPath, new Date('2026-07-16T10:00:00.000Z'), new Date('2026-07-16T10:00:00.000Z'));

    const routeSearch = await searchWorkspaceFiles(
      root,
      '找一下工作目录下最新的草稿',
      20,
      [aiWorkRoot],
    );
    expect(routeSearch.results[0]).toEqual(expect.objectContaining({
      path: 'ScholarHarness_AI_Workspaces/conversation-current/latest-manuscript-draft.docx',
      kind: 'word',
    }));

    const runtime = createWorkspaceToolRuntime({
      available: true,
      root,
      permission: 'read-only',
      aiWorkRoot,
      safeWorkRoot: aiWorkRoot,
      generatedAt: new Date().toISOString(),
      fileCount: 2,
      omittedCount: 0,
      tree: '',
      files: [],
      contextMarkdown: '',
    });
    const toolSearch = await runtime.executeToolCall({
      id: 'dual-root-latest-draft',
      type: 'function',
      function: {
        name: 'file_search',
        arguments: JSON.stringify({ query: '最新草稿', limit: 20 }),
      },
    });
    const toolData = toolSearch.data as { results: Array<{ path: string }> };
    expect(toolSearch.ok).toBe(true);
    expect(toolData.results[0]?.path).toBe(
      'ScholarHarness_AI_Workspaces/conversation-current/latest-manuscript-draft.docx'
    );
  });

  it('derives a stable conversation AI work directory when older clients omit it', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-conversation-root-'));
    roots.push(root);

    const context = await buildWorkspaceDirectoryContext({
      enabled: true,
      path: root,
      permission: 'workspace-write',
      conversationId: 'conv-123',
    });

    expect(context.aiWorkRoot).toBe(path.join(
      root,
      'ScholarHarness_AI_Workspaces',
      'Conversation-conv-123',
    ));
    expect(context.safeWorkRoot).toBe(context.aiWorkRoot);
  });

  it('defers the duplicate manifest scan for native Agent turns', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-deferred-manifest-'));
    roots.push(root);
    writeFileSync(path.join(root, 'large-project-file.txt'), 'source');

    const context = await buildWorkspaceDirectoryContext({
      enabled: true,
      path: root,
      permission: 'workspace-write',
      conversationId: 'conv-deferred',
    }, { deferDiscovery: true });

    expect(context.discoveryDeferred).toBe(true);
    expect(context.fileCount).toBe(0);
    expect(context.files).toEqual([]);
    expect(context.contextMarkdown).toContain('避免在同一轮递归扫描两次');
  });

  it('isolates the same conversation workspace between projects', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-project-root-'));
    roots.push(root);

    const projectA = await buildWorkspaceDirectoryContext({
      enabled: true,
      path: root,
      permission: 'workspace-write',
      projectId: 'project-a',
      conversationId: 'shared-conversation',
    });
    const projectB = await buildWorkspaceDirectoryContext({
      enabled: true,
      path: root,
      permission: 'workspace-write',
      projectId: 'project-b',
      conversationId: 'shared-conversation',
    });

    expect(projectA.aiWorkRoot).toBe(path.join(
      root,
      'ScholarHarness_AI_Workspaces',
      'Project-project-a',
      'Conversation-shared-conversation',
    ));
    expect(projectB.aiWorkRoot).not.toBe(projectA.aiWorkRoot);
  });

  it('does not advertise or create a conversation AI work directory in read-only mode', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-read-only-root-'));
    roots.push(root);
    const advertisedRoot = path.join(
      root,
      'ScholarHarness_AI_Workspaces',
      'Conversation-conv-read-only',
    );

    const normalized = normalizeWorkspaceDirectoryInput({
      enabled: true,
      path: root,
      permission: 'read-only',
      conversationId: 'conv-read-only',
      aiWorkRoot: advertisedRoot,
      safeWorkRoot: advertisedRoot,
    });
    expect(normalized?.aiWorkRoot).toBeUndefined();
    expect(normalized?.safeWorkRoot).toBeUndefined();

    const context = await buildWorkspaceDirectoryContext(normalized!);

    expect(context.aiWorkRoot).toBeUndefined();
    expect(context.safeWorkRoot).toBeUndefined();
    expect(context.contextMarkdown).not.toContain(advertisedRoot);
  });

  it('refreshes a conversation AI work directory after the Agent creates a file', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-ai-refresh-'));
    roots.push(root);
    const aiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Conversation-conv-refresh');
    mkdirSync(aiWorkRoot, { recursive: true });

    await searchWorkspaceFiles(root, 'generated-evidence', 20, [aiWorkRoot]);
    writeFileSync(
      path.join(aiWorkRoot, 'generated-evidence.txt'),
      'evidence created after the first cached scan',
      'utf-8',
    );

    const result = await searchWorkspaceFiles(root, 'generated-evidence', 20, [aiWorkRoot]);

    expect(result.results[0]?.path).toBe(
      'ScholarHarness_AI_Workspaces/Conversation-conv-refresh/generated-evidence.txt',
    );
  });

  it('does not surface another conversation output in scoped preflight search by default', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-ai-container-refresh-'));
    roots.push(root);
    const containerRoot = path.join(root, 'ScholarHarness_AI_Workspaces');
    const currentAiWorkRoot = path.join(containerRoot, 'Conversation-current');
    const previousAiWorkRoot = path.join(containerRoot, 'Conversation-previous');
    mkdirSync(currentAiWorkRoot, { recursive: true });
    mkdirSync(previousAiWorkRoot, { recursive: true });
    writeFileSync(path.join(currentAiWorkRoot, 'current-note.txt'), 'current conversation', 'utf-8');

    await searchWorkspaceFiles(root, 'historical-analysis-output', 20, [currentAiWorkRoot]);
    writeFileSync(
      path.join(previousAiWorkRoot, 'historical-analysis-output.md'),
      'N2O seasonal response evidence',
      'utf-8',
    );

    // P0 scoped retrieval: the previous conversation is an archive and must not
    // appear in the default (source + current conversation) search.
    const result = await searchWorkspaceFiles(
      root,
      'historical-analysis-output',
      20,
      [currentAiWorkRoot],
    );
    expect(result.results.some(item => item.path.includes('Conversation-previous'))).toBe(false);
  });

  it('shows the AI workspace container and its conversation folders in the automatic preflight context', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-ai-preflight-'));
    roots.push(root);
    const currentAiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Conversation-current');
    const previousAiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Conversation-previous');
    mkdirSync(currentAiWorkRoot, { recursive: true });
    mkdirSync(previousAiWorkRoot, { recursive: true });
    writeFileSync(path.join(previousAiWorkRoot, 'previous-result.txt'), 'previous output', 'utf-8');

    const prelude = await buildWorkspaceAgentPrelude(
      root,
      '找一下之前 AI 输出里的相关内容',
      undefined,
      [currentAiWorkRoot],
    );

    expect(prelude).toContain('### AI 工作区容器直接内容');
    expect(prelude).toContain('ScholarHarness_AI_Workspaces/Conversation-previous/');
    expect(prelude).toContain('归档');
  });

  it('does not create a duplicated AI workspace container when the configured root is the container itself', async () => {
    const parent = mkdtempSync(path.join(os.tmpdir(), 'sh-workspace-ai-root-'));
    roots.push(parent);
    const containerRoot = path.join(parent, 'ScholarHarness_AI_Workspaces');
    mkdirSync(containerRoot, { recursive: true });

    const context = await buildWorkspaceDirectoryContext({
      enabled: true,
      path: containerRoot,
      permission: 'workspace-write',
      conversationId: 'conv-container-root',
    });

    expect(context.aiWorkRoot).toBe(path.join(containerRoot, 'Conversation-conv-container-root'));
    expect(context.aiWorkRoot).not.toContain(
      path.join('ScholarHarness_AI_Workspaces', 'ScholarHarness_AI_Workspaces'),
    );
  });
});
