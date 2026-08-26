import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { clearPathCache } from '../../../src/utils/paths';
import {
  appendProjectConclusion,
  appendRecentWorkspaceFiles,
  buildProjectConclusion,
  formatProjectConclusionsForPrompt,
  formatRecentWorkspaceFilesForPrompt,
  readRecentProjectConclusions,
  readRecentWorkspaceFiles,
  resolveProjectMemoryDir,
} from '../../../src/server/services/project-memory';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-project-memory-'));

beforeAll(() => {
  // Point the data dir at a throwaway location so the test never touches the
  // real dev/production data directory.
  process.env.DATA_DIR = tempDir;
  clearPathCache();
});

afterAll(() => {
  delete process.env.DATA_DIR;
  clearPathCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('project-level conclusion memory (P1)', () => {
  it('round-trips conclusions and de-duplicates by conversation (latest wins, newest first)', async () => {
    const root = path.join(os.tmpdir(), 'project-a');
    await appendProjectConclusion(root, buildProjectConclusion('conv-1', 'task A', '结论 A 第一版', new Date('2026-01-01T00:00:00Z')));
    await appendProjectConclusion(root, buildProjectConclusion('conv-2', 'task B', '结论 B', new Date('2026-01-02T00:00:00Z')));
    await appendProjectConclusion(root, buildProjectConclusion('conv-1', 'task A', '结论 A 最终版', new Date('2026-01-03T00:00:00Z')));

    const recent = await readRecentProjectConclusions(root, 10);
    // conv-1 collapses to its latest entry, conv-2 keeps its only entry.
    const conv1 = recent.find(item => item.conversationId === 'conv-1');
    const conv2 = recent.find(item => item.conversationId === 'conv-2');
    expect(recent.length).toBe(2);
    expect(conv1?.summary).toContain('最终版');
    expect(conv2?.summary).toContain('结论 B');
    // Newest first.
    expect(recent[0].conversationId).toBe('conv-1');
  });

  it('formats conclusions into a compact prompt block', () => {
    const block = formatProjectConclusionsForPrompt([
      buildProjectConclusion('conv-1', '查 figure5 标签', '双标签，右侧图例残留'),
    ]);
    expect(block).toContain('figure5');
    expect(block).toContain('双标签');
  });

  it('reads nothing for a workspace with no recorded conclusions', async () => {
    const root = path.join(os.tmpdir(), 'project-empty');
    const recent = await readRecentProjectConclusions(root, 10);
    expect(recent).toEqual([]);
  });

  it('keeps the conclusion log bounded', async () => {
    const root = path.join(os.tmpdir(), 'project-bounded');
    const dir = resolveProjectMemoryDir(root);
    for (let i = 0; i < 205; i += 1) {
      await appendProjectConclusion(root, buildProjectConclusion(`conv-${i % 10}`, `task ${i}`, `summary ${i}`));
    }
    const filePath = path.join(dir, 'conclusions.jsonl');
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(line => line.trim());
    expect(lines.length).toBeLessThanOrEqual(200);
  }, 15000);
});

describe('recent workspace files memory (conversation legacy)', () => {
  it('round-trips recent files newest-first and de-duplicates by path', async () => {
    const root = path.join(os.tmpdir(), 'project-recent');
    await appendRecentWorkspaceFiles(root, [
      { path: 'figure5/diag_v33.py', name: 'diag_v33.py', kind: 'code', lastAction: 'write', lastUsedAt: '2026-08-16T10:00:00.000Z' },
      { path: 'QZ-field-paper-GCB.R', name: 'QZ-field-paper-GCB.R', kind: 'code', lastAction: 'read', lastUsedAt: '2026-08-16T11:00:00.000Z' },
    ]);
    await appendRecentWorkspaceFiles(root, [
      { path: 'QZ-field-paper-GCB.R', name: 'QZ-field-paper-GCB.R', kind: 'code', lastAction: 'edit', lastUsedAt: '2026-08-16T12:00:00.000Z' },
    ]);

    const recent = await readRecentWorkspaceFiles(root, 10);
    expect(recent.length).toBe(2);
    expect(recent[0].path).toBe('QZ-field-paper-GCB.R');
    expect(recent[0].lastAction).toBe('edit');
    expect(recent[1].path).toBe('figure5/diag_v33.py');
  });

  it('formats a compact prompt block for injection', () => {
    const text = formatRecentWorkspaceFilesForPrompt([
      { path: 'figure5/a.R', name: 'a.R', kind: 'code', lastAction: 'edit', lastUsedAt: '2026-08-16T12:00:00.000Z' },
    ]);
    expect(text).toContain('最近处理过的文件');
    expect(text).toContain('优先继承上次对话');
    expect(text).toContain('figure5/a.R');
    expect(text).toContain('edit');
  });

  it('includes the AI-generated file resource summary when present', () => {
    const text = formatRecentWorkspaceFilesForPrompt([
      { path: 'figure5/QZ-field-paper-GCB.R', name: 'QZ-field-paper-GCB.R', kind: 'code', lastAction: 'edit', lastUsedAt: '2026-08-16T12:00:00.000Z', summary: '生成 figure5 的 R 源码，已修改误差条与角标位置' },
    ]);
    expect(text).toContain('已修改误差条与角标位置');
    expect(text).toContain('资源摘要');
  });

  it('returns empty for missing root or missing file', async () => {
    expect(await readRecentWorkspaceFiles('')).toEqual([]);
    expect(await readRecentWorkspaceFiles(path.join(os.tmpdir(), 'no-such-recent-dir'))).toEqual([]);
  });
});
