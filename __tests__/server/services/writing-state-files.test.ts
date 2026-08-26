import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CHAPTER_WRITING_PROGRESS_FILE,
  GLOBAL_WRITING_REQUIREMENTS_FILE,
  syncWritingStateFiles,
  type WritingRequirementsFile,
} from '../../../src/server/services/writing-state-files';

describe('writing state JSON files', () => {
  let testRoot = '';

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-writing-state-'));
  });

  afterEach(async () => {
    if (testRoot) await fs.rm(testRoot, { recursive: true, force: true });
  });

  it('writes project progress and categorized global requirements into the workspace', async () => {
    const workspaceRoot = path.join(testRoot, 'workspace');
    const globalRequirementsPath = path.join(testRoot, 'global', GLOBAL_WRITING_REQUIREMENTS_FILE);
    await fs.mkdir(workspaceRoot, { recursive: true });
    const context = {
      discussionFramework: { available: true, planningStatus: 'draft' },
      articleWritingProgress: {
        available: true,
        totalChapterCount: 3,
        chapters: [{
          key: 'results',
          title: 'Results',
          drafted: true,
          draftChars: 3200,
          fileName: 'results.txt',
          storagePath: 'drafts/results.txt',
        }],
      },
    };

    const result = await syncWritingStateFiles({
      userId: 'user-1',
      projectId: 'project-1',
      context,
      requirements: [
        { source: 'memory', label: '目标期刊', text: '目标期刊为 Global Change Biology。' },
        { source: 'recent-user-message', label: '近期用户原话', text: '所有关键论断必须提供可核验引用。' },
      ],
      globalRequirementsPath,
      workspaceRoot,
      workspaceWritable: true,
      now: '2026-08-20T08:00:00.000Z',
    });

    expect(result.progressPath).toBe(path.join(workspaceRoot, CHAPTER_WRITING_PROGRESS_FILE));
    const progress = JSON.parse(await fs.readFile(result.progressPath!, 'utf-8')) as Record<string, any>;
    expect(progress.effectiveStage).toBe('drafting');
    expect(progress.summary.draftedChapterCount).toBe(1);
    expect(progress.chapters[0].storagePath).toBe('drafts/results.txt');

    const mirrored = JSON.parse(await fs.readFile(
      path.join(workspaceRoot, GLOBAL_WRITING_REQUIREMENTS_FILE),
      'utf-8',
    )) as WritingRequirementsFile;
    expect(mirrored.scope).toBe('global');
    expect(mirrored.categories.research_and_target.items).toHaveLength(1);
    expect(mirrored.categories.citations_and_evidence.items).toHaveLength(1);
    await expect(fs.readFile(globalRequirementsPath, 'utf-8')).resolves.toContain('Global Change Biology');
  });

  it('carries global requirements into a different project workspace', async () => {
    const globalRequirementsPath = path.join(testRoot, 'global', GLOBAL_WRITING_REQUIREMENTS_FILE);
    const firstWorkspace = path.join(testRoot, 'workspace-a');
    const secondWorkspace = path.join(testRoot, 'workspace-b');
    await fs.mkdir(firstWorkspace, { recursive: true });
    await fs.mkdir(secondWorkspace, { recursive: true });
    await syncWritingStateFiles({
      userId: 'user-1', projectId: 'project-a', context: {},
      requirements: [{ source: 'memory', label: '写作风格', text: '全文使用简洁的学术英语。' }],
      globalRequirementsPath, workspaceRoot: firstWorkspace, workspaceWritable: true,
      now: '2026-08-20T08:00:00.000Z',
    });

    const result = await syncWritingStateFiles({
      userId: 'user-1', projectId: 'project-b', context: {}, requirements: [],
      globalRequirementsPath, workspaceRoot: secondWorkspace, workspaceWritable: true,
      now: '2026-08-20T09:00:00.000Z',
    });

    expect(result.requirements.map(item => item.text)).toContain('全文使用简洁的学术英语。');
    await expect(fs.readFile(
      path.join(secondWorkspace, GLOBAL_WRITING_REQUIREMENTS_FILE),
      'utf-8',
    )).resolves.toContain('全文使用简洁的学术英语。');
  });
});
