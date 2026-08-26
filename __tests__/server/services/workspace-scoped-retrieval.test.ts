import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceDirectoryContext } from '../../../src/server/services/workspace-directory';
import { createWorkspaceToolRuntime } from '../../../src/server/services/workspace-tools';

const tempRoots: string[] = [];

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-scoped-'));
  tempRoots.push(root);
  const container = path.join(root, 'ScholarHarness_AI_Workspaces');
  const currentRoot = path.join(container, 'Conversation-current');
  const oldRoot = path.join(container, 'Conversation-old');

  // Source tree (authoritative).
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'main.R'), 'x <- 1\n');
  fs.writeFileSync(path.join(root, 'figure5_plot_gcb.R'), '# source script\n');

  // Current conversation workspace.
  fs.mkdirSync(path.join(currentRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(currentRoot, 'figure5_plot_gcb.R'), '# current copy\n');
  fs.writeFileSync(path.join(currentRoot, 'work', 'note.md'), 'current note\n');

  // An archived (old) conversation workspace — must NOT appear by default.
  fs.mkdirSync(path.join(oldRoot, 'work'), { recursive: true });
  fs.writeFileSync(path.join(oldRoot, 'figure5_plot_gcb.R'), '# old copy\n');
  fs.writeFileSync(path.join(oldRoot, 'work', 'prepare_clean_panels.py'), '# old diag\n');

  const workspace: WorkspaceDirectoryContext = {
    available: true,
    root,
    permission: 'workspace-write',
    safeWorkRoot: currentRoot,
    aiWorkRoot: currentRoot,
    generatedAt: new Date().toISOString(),
    fileCount: 0,
    omittedCount: 0,
    tree: '',
    files: [],
    contextMarkdown: '',
  };
  return { root, currentRoot, oldRoot, runtime: createWorkspaceToolRuntime(workspace) };
}

function call(runtime: ReturnType<typeof createWorkspaceToolRuntime>, name: string, args: Record<string, unknown>) {
  return runtime.executeToolCall({
    id: `call-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('workspace scoped retrieval (P0)', () => {
  it('file_search default scope returns source + current, not archived sessions', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'file_search', { query: 'figure5_plot_gcb' });
    expect(result.ok).toBe(true);
    const results = (result.data as any).results as Array<{ path: string; origin: string }>;
    const origins = results.map(item => item.origin).sort();
    // source copy + current copy only; the archived "old" copy must be absent.
    expect(origins).toEqual(['current', 'source']);
    expect(results.some(item => item.path.includes('Conversation-old'))).toBe(false);
  });

  it('file_search scope=archive returns only archived sessions', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'file_search', { query: 'figure5_plot_gcb', scope: 'archive' });
    const results = (result.data as any).results as Array<{ path: string; origin: string; originDetail?: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(item => item.origin === 'archive')).toBe(true);
    expect(results.some(item => (item.originDetail || '').includes('Conversation-old'))).toBe(true);
  });

  it('file_search scope=all returns every namespace with origin labels', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'file_search', { query: 'figure5_plot_gcb', scope: 'all' });
    const results = (result.data as any).results as Array<{ origin: string }>;
    const origins = new Set(results.map(item => item.origin));
    expect(origins).toEqual(new Set(['source', 'current', 'archive']));
  });

  it('grep_files default scope does not match content inside archived sessions', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'grep_files', { pattern: 'old diag' });
    const results = (result.data as any).results as Array<{ path: string }>;
    expect(results.length).toBe(0);
  });

  it('grep_files scope=archive finds content only in archived sessions', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'grep_files', { pattern: 'old diag', scope: 'archive' });
    const results = (result.data as any).results as Array<{ path: string; origin: string }>;
    expect(results.length).toBe(1);
    expect(results[0].origin).toBe('archive');
  });

  it('list_archived_sessions lists other conversations but not the current one', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'list_archived_sessions', {});
    const sessions = (result.data as any).sessions as Array<{ name: string }>;
    const names = sessions.map(item => item.name);
    expect(names).toContain('Conversation-old');
    expect(names).not.toContain('Conversation-current');
  });

  it('list_dir recursive default scope omits the AI workspace container entries', async () => {
    const { runtime } = makeWorkspace();
    const result = await call(runtime, 'list_dir', { path: '', recursive: true });
    const entries = (result.data as any).entries as Array<{ path: string }>;
    const paths = entries.map(item => item.path);
    // The archived conversation folder must not be surfaced by default.
    expect(paths.some(p => p.includes('Conversation-old'))).toBe(false);
    // Current conversation entries may appear (current scope includes it).
    expect(paths.some(p => p.includes('src/main.R'))).toBe(true);
  });
});
