import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyDiscussionFrameworkProposal,
  createDiscussionFrameworkProposal,
  diffDiscussionFramework,
  extractFrameworkStructureFromText,
  loadDiscussionFrameworkRecord,
  mergeDiscussionFrameworkState,
  saveDiscussionFrameworkState,
  scanWorkspaceFrameworkStructure,
  type DiscussionFrameworkState,
  type FrameworkProjectTarget,
} from '../../../src/server/services/discussion-framework';

const temporaryRoots: string[] = [];

async function createTemporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-framework-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

function baseState(): DiscussionFrameworkState {
  return {
    version: 3,
    profileId: 'paper-writing',
    planningStatus: 'confirmed',
    planningConfirmedAt: '2026-08-20T00:00:00.000Z',
    chapters: [
      {
        id: 'chapter-introduction',
        title: 'Introduction',
        idea: '保留人工填写的研究背景与知识缺口。',
        subsections: [
          { id: 'sub-background', title: 'Research background', idea: '保留人工填写的小节目标。' },
        ],
      },
      {
        id: 'chapter-discussion',
        title: 'Discussion',
        idea: '',
        subsections: [],
      },
    ],
  };
}

describe('discussion framework extraction and persistence', () => {
  it('extracts a document title, top-level chapters and second-level subsections from Markdown', () => {
    const structure = extractFrameworkStructureFromText([
      '# Nitrogen cycling manuscript',
      '## Introduction',
      '### Research background',
      '### Knowledge gap',
      '## Materials and Methods',
      '### Experimental design',
      '## Results',
      '### Main effects',
      '## Discussion',
      '### Mechanistic interpretation',
    ].join('\n'));

    expect(structure.map(chapter => chapter.title)).toEqual([
      'Introduction',
      'Materials and Methods',
      'Results',
      'Discussion',
    ]);
    expect(structure[0].subsections.map(subsection => subsection.title)).toEqual([
      'Research background',
      'Knowledge gap',
    ]);
  });

  it('extracts LaTeX section and subsection commands', () => {
    const structure = extractFrameworkStructureFromText([
      '\\section{Introduction}',
      '\\subsection{Knowledge gap}',
      '\\section{Results}',
      '\\subsection{Greenhouse gas response}',
    ].join('\n'));

    expect(structure).toMatchObject([
      { key: 'introduction', title: 'Introduction', subsections: [{ title: 'Knowledge gap' }] },
      { key: 'results', title: 'Results', subsections: [{ title: 'Greenhouse gas response' }] },
    ]);
  });

  it('preserves manual goals while merging source structure and returns the framework to draft status', () => {
    const source = { type: 'workspace' as const, path: 'paper.md', fingerprint: 'abc', detectedAt: new Date().toISOString() };
    const merged = mergeDiscussionFrameworkState(baseState(), [
      {
        key: 'introduction',
        title: 'Introduction',
        subsections: [{ title: 'Research background' }, { title: 'Knowledge gap' }],
      },
      {
        key: 'results',
        title: 'Results',
        subsections: [{ title: 'Main effects' }],
      },
    ], source);

    expect(merged.planningStatus).toBe('draft');
    expect(merged.planningConfirmedAt).toBe('');
    expect(merged.chapters[0].id).toBe('chapter-introduction');
    expect(merged.chapters[0].idea).toContain('保留人工填写');
    expect(merged.chapters[0].subsections?.[0]).toMatchObject({
      id: 'sub-background',
      idea: '保留人工填写的小节目标。',
    });
    expect(merged.chapters.map(chapter => chapter.title)).toEqual(['Introduction', 'Results']);
  });

  it('detects AI plan changes in addition to structural changes', () => {
    const diff = diffDiscussionFramework(baseState(), [{
      key: 'introduction',
      title: 'Introduction',
      idea: '新的章节目标',
      subsections: [{ title: 'Research background', idea: '新的小节论证任务' }],
    }]);

    expect(diff.updatedChapterPlans).toEqual(['Introduction']);
    expect(diff.updatedSubsectionPlans).toEqual([{ chapter: 'Introduction', subsection: 'Research background' }]);
    expect(diff.changed).toBe(true);
  });

  it('selects the manuscript from the source workspace and ignores the AI workspace container', async () => {
    const root = await createTemporaryRoot();
    await fs.writeFile(path.join(root, 'README.md'), '# Project\n## Install\n### Windows', 'utf-8');
    await fs.writeFile(path.join(root, 'paper-manuscript.md'), '# Paper\n## Introduction\n### Gap\n## Results\n### Main finding', 'utf-8');
    await fs.mkdir(path.join(root, 'ScholarHarness_AI_Workspaces'), { recursive: true });
    await fs.writeFile(path.join(root, 'ScholarHarness_AI_Workspaces', 'newer-paper.md'), '# Paper\n## Wrong source\n### Ignore', 'utf-8');

    const scan = await scanWorkspaceFrameworkStructure({
      workspaceDirectory: { path: root, enabled: true, permission: 'read-only' },
    });

    expect(scan.selected.path).toBe('paper-manuscript.md');
    expect(scan.selected.chapters.map(chapter => chapter.title)).toEqual(['Introduction', 'Results']);
    expect(scan.candidates.some(candidate => candidate.path.includes('ScholarHarness_AI_Workspaces'))).toBe(false);
  });

  it('persists an approved proposal in the project directory with a new revision', async () => {
    const root = await createTemporaryRoot();
    const target: FrameworkProjectTarget = { projectId: 'project-test', projectDir: path.join(root, 'project-test') };
    const first = await saveDiscussionFrameworkState(target, baseState(), 'user-1');
    const proposal = await createDiscussionFrameworkProposal({
      target,
      state: first.state,
      source: { type: 'agent', detectedAt: new Date().toISOString() },
      summary: 'AI 逐章规划',
      chapters: [{
        key: 'introduction',
        title: 'Introduction',
        idea: '新的章节目标',
        subsections: [{ title: 'Research background', idea: '新的论证顺序' }],
      }],
    });

    const applied = await applyDiscussionFrameworkProposal(target, proposal.id, 'user-1');
    const stored = await loadDiscussionFrameworkRecord(target);

    expect(applied.record.revision).toBe(2);
    expect(stored?.state.planningStatus).toBe('draft');
    expect(stored?.state.chapters[0]).toMatchObject({
      id: 'chapter-introduction',
      idea: '新的章节目标',
    });
  });
});
