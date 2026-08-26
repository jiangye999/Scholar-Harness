import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveProjectCumulativeArtifactRoot,
  WORKSPACE_ARTIFACT_LAYOUT,
} from '../../../src/server/services/workspace-artifact-layout';
import {
  AI_SOURCE_COPY_DIRECTORY_NAME,
  AI_WORKBENCH_OUTPUT_DIRECTORIES,
  AI_WORKING_FILES_DIRECTORY_NAME,
  PRIMARY_WORD_DELIVERABLES,
  PROJECT_PRIMARY_DELIVERABLES_DIRECTORY_NAME,
  USER_VIEW_DIRECTORY_NAME,
  USER_VIEW_OUTPUT_DIRECTORIES,
  finalizeWorkspaceWorkbench,
  prepareWorkspaceWorkbench,
  prepareWorkspaceWorkbenchForAgentTurn,
  reconcileWorkspaceProjectUserView,
  reconcileWorkspaceUserView,
  synchronizeUserViewShortcuts,
} from '../../../src/server/services/workspace-workbench';

const roots: string[] = [];

function createWorkspace(): { root: string; aiWorkRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-workbench-'));
  roots.push(root);
  const aiWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Project-p', 'Conversation-c');
  fs.mkdirSync(aiWorkRoot, { recursive: true });
  return { root, aiWorkRoot };
}

afterEach(() => {
  while (roots.length) {
    const root = roots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('three-layer workspace workbench', () => {
  it('excludes dependency, cache, bytecode, log, temporary, and live env files from the source snapshot', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const files = [
      ['src/main.py', 'print("ok")'],
      ['.env.example', 'API_KEY=replace-me'],
      ['.env', 'API_KEY=secret'],
      ['.mypy_cache/3.14/cache.json', '{}'],
      ['.pytest_cache/v/cache/nodeids', '[]'],
      ['.ruff_cache/state', '{}'],
      ['backend/__pycache__/service.pyc', 'bytecode'],
      ['logs/runtime.log', 'log'],
      ['node_modules/pkg/index.js', 'dependency'],
      ['tmp/intermediate.txt', 'temporary'],
    ];
    for (const [relativePath, content] of files) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }

    const result = await prepareWorkspaceWorkbench(root, aiWorkRoot);
    const sourceCopyRoot = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME);

    expect(result.scanned).toBe(2);
    expect(fs.existsSync(path.join(sourceCopyRoot, 'src', 'main.py'))).toBe(true);
    expect(fs.existsSync(path.join(sourceCopyRoot, '.env.example'))).toBe(true);
    expect(fs.existsSync(path.join(sourceCopyRoot, '.env'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, '.mypy_cache'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, '.pytest_cache'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, '.ruff_cache'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, 'backend', '__pycache__'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, 'logs'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, 'node_modules'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, 'tmp'))).toBe(false);
  });

  it('uses one shared initial preparation and only refreshes recorded files on later Agent turns', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    fs.writeFileSync(path.join(root, 'paper.txt'), 'version one');

    const [first, joined] = await Promise.all([
      prepareWorkspaceWorkbenchForAgentTurn(root, aiWorkRoot),
      prepareWorkspaceWorkbenchForAgentTurn(root, aiWorkRoot),
    ]);
    expect(joined).toBe(first);
    expect(first.mode).toBe('initial');

    fs.writeFileSync(path.join(root, 'paper.txt'), 'version two');
    fs.writeFileSync(path.join(root, 'new-source.txt'), 'discover on demand');
    const incremental = await prepareWorkspaceWorkbenchForAgentTurn(root, aiWorkRoot);
    const sourceCopyRoot = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME);

    expect(incremental.mode).toBe('incremental');
    expect(incremental.scanned).toBe(1);
    expect(incremental.copied).toBe(1);
    expect(fs.readFileSync(path.join(sourceCopyRoot, 'paper.txt'), 'utf-8')).toBe('version two');
    expect(fs.existsSync(path.join(sourceCopyRoot, 'new-source.txt'))).toBe(false);
  });

  it('cancels a shared workspace preparation when its final waiter aborts', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    for (let index = 0; index < 500; index += 1) {
      const filePath = path.join(root, 'src', `file-${String(index).padStart(4, '0')}.txt`);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, String(index));
    }
    const controller = new AbortController();

    const preparation = prepareWorkspaceWorkbenchForAgentTurn(root, aiWorkRoot, {
      signal: controller.signal,
      onProgress: progress => {
        if (progress.phase === 'scanning' && Number(progress.scanned || 0) >= 1) {
          controller.abort();
        }
      },
    });

    await expect(preparation).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('backfills existing canonical artifacts without refreshing the source snapshot', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const artifactPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'legacy-paper.docx');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, 'legacy AI output');
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    const reconciled = await reconcileWorkspaceUserView(root, aiWorkRoot, { shortcutWriter });
    const shortcutPath = path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.other,
      `legacy-paper.docx${process.platform === 'win32' ? '.lnk' : ''}`,
    );

    expect(reconciled.artifactCount).toBe(1);
    expect(fs.existsSync(shortcutPath)).toBe(true);
    expect(fs.existsSync(path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME))).toBe(false);
  });

  it('backfills the newest artifact across every conversation in the current project', async () => {
    const { root, aiWorkRoot: olderRoot } = createWorkspace();
    const latestRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Project-p', 'Conversation-latest');
    const relativeArtifact = path.join(AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'paper.docx');
    const olderArtifact = path.join(olderRoot, relativeArtifact);
    const latestArtifact = path.join(latestRoot, relativeArtifact);
    fs.mkdirSync(path.dirname(olderArtifact), { recursive: true });
    fs.mkdirSync(path.dirname(latestArtifact), { recursive: true });
    fs.writeFileSync(olderArtifact, 'older');
    fs.writeFileSync(latestArtifact, 'latest');
    const now = new Date();
    fs.utimesSync(olderArtifact, new Date(now.getTime() - 10_000), new Date(now.getTime() - 10_000));
    fs.utimesSync(latestArtifact, now, now);
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    const reconciled = await reconcileWorkspaceProjectUserView(root, latestRoot, { shortcutWriter });
    const shortcutPath = path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.other,
      `paper.docx${process.platform === 'win32' ? '.lnk' : ''}`,
    );

    expect(reconciled.workbenchCount).toBe(2);
    expect(reconciled.artifactCount).toBe(1);
    expect(fs.readFileSync(shortcutPath, 'utf-8')).toBe(latestArtifact);
  });

  it('refreshes a complete read-only source snapshot and maintains the canonical workbench layout', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'paper.docx'), 'source paper');
    fs.writeFileSync(path.join(root, 'data', 'results.csv'), 'x\n1\n');
    fs.mkdirSync(path.join(root, USER_VIEW_DIRECTORY_NAME), { recursive: true });
    fs.writeFileSync(path.join(root, USER_VIEW_DIRECTORY_NAME, 'old.lnk'), 'not source');
    fs.writeFileSync(path.join(aiWorkRoot, 'old-output.md'), 'AI output');
    const existingDraft = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'existing.docx');
    fs.mkdirSync(path.dirname(existingDraft), { recursive: true });
    fs.writeFileSync(existingDraft, 'existing AI draft');
    let shortcutWrites = 0;
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      shortcutWrites += 1;
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    const first = await prepareWorkspaceWorkbench(root, aiWorkRoot, { shortcutWriter });
    const sourceCopyRoot = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME);

    expect(first.scanned).toBe(2);
    expect(fs.readFileSync(path.join(sourceCopyRoot, 'paper.docx'), 'utf-8')).toBe('source paper');
    expect(fs.readFileSync(path.join(sourceCopyRoot, 'data', 'results.csv'), 'utf-8')).toBe('x\n1\n');
    expect(fs.existsSync(path.join(sourceCopyRoot, USER_VIEW_DIRECTORY_NAME, 'old.lnk'))).toBe(false);
    expect(fs.existsSync(path.join(sourceCopyRoot, 'ScholarHarness_AI_Workspaces'))).toBe(false);
    expect(fs.existsSync(path.join(aiWorkRoot, AI_WORKING_FILES_DIRECTORY_NAME))).toBe(true);
    Object.values(AI_WORKBENCH_OUTPUT_DIRECTORIES).forEach(directory => {
      expect(fs.existsSync(path.join(aiWorkRoot, directory))).toBe(true);
    });
    Object.values(USER_VIEW_OUTPUT_DIRECTORIES).forEach(directory => {
      expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, directory))).toBe(true);
    });
    const existingDraftShortcut = path.join(
      root,
      USER_VIEW_DIRECTORY_NAME,
      USER_VIEW_OUTPUT_DIRECTORIES.other,
      `existing.docx${process.platform === 'win32' ? '.lnk' : ''}`,
    );
    expect(fs.existsSync(existingDraftShortcut)).toBe(false);
    expect(shortcutWrites).toBe(0);

    fs.rmSync(existingDraftShortcut, { force: true });
    await prepareWorkspaceWorkbench(root, aiWorkRoot, { shortcutWriter });
    expect(fs.existsSync(existingDraftShortcut)).toBe(false);
    expect(shortcutWrites).toBe(0);

    const readme = fs.readFileSync(first.readmePath, 'utf-8');
    expect(readme).toContain('用户源目录只读');
    expect(readme).toContain(`${AI_SOURCE_COPY_DIRECTORY_NAME}/`);
    expect(readme).toContain(`${AI_WORKING_FILES_DIRECTORY_NAME}/`);
    expect(readme).toContain('old-output.md');

    fs.writeFileSync(path.join(root, 'paper.docx'), 'new source paper');
    fs.rmSync(path.join(root, 'data', 'results.csv'));
    const second = await prepareWorkspaceWorkbench(root, aiWorkRoot, { shortcutWriter });
    expect(second.copied).toBe(1);
    expect(second.removed).toBe(1);
    expect(fs.readFileSync(path.join(sourceCopyRoot, 'paper.docx'), 'utf-8')).toBe('new source paper');
    expect(fs.existsSync(path.join(sourceCopyRoot, 'data', 'results.csv'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'paper.docx'), 'utf-8')).toBe('new source paper');
  });

  it('overwrites managed shortcuts so every entry keeps targeting the latest AI workbench file', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    await prepareWorkspaceWorkbench(root, aiWorkRoot);
    const artifactPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'paper.docx');
    const sourceCopyPath = path.join(aiWorkRoot, AI_SOURCE_COPY_DIRECTORY_NAME, 'source.docx');
    fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
    fs.writeFileSync(artifactPath, 'version one');
    fs.writeFileSync(sourceCopyPath, 'source only');

    let writes = 0;
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      writes += 1;
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };
    const first = await synchronizeUserViewShortcuts(root, aiWorkRoot, [artifactPath, sourceCopyPath], { shortcutWriter });
    expect(first).toHaveLength(1);
    expect(first[0].created).toBe(true);
    expect(fs.readFileSync(first[0].shortcutPath, 'utf-8')).toBe(artifactPath);
    expect(first[0].shortcutPath).toContain(USER_VIEW_DIRECTORY_NAME);

    fs.writeFileSync(artifactPath, 'version two');
    const second = await synchronizeUserViewShortcuts(root, aiWorkRoot, [artifactPath], { shortcutWriter });
    expect(second[0].shortcutPath).toBe(first[0].shortcutPath);
    expect(fs.readFileSync(second[0].shortcutPath, 'utf-8')).toBe(artifactPath);
    expect(fs.readFileSync(artifactPath, 'utf-8')).toBe('version two');
    // The target path is stable, so rewriting the artifact itself does not
    // require recreating the .lnk; opening it still resolves the latest file.
    expect(writes).toBe(1);

    fs.rmSync(artifactPath);
    await finalizeWorkspaceWorkbench(root, aiWorkRoot, [], { shortcutWriter });
    expect(fs.existsSync(first[0].shortcutPath)).toBe(false);
  });

  it('does not let an older conversation delete a same-name shortcut owned by the latest conversation', async () => {
    const { root, aiWorkRoot: oldWorkRoot } = createWorkspace();
    const latestWorkRoot = path.join(root, 'ScholarHarness_AI_Workspaces', 'Project-p', 'Conversation-latest');
    await prepareWorkspaceWorkbench(root, oldWorkRoot);
    await prepareWorkspaceWorkbench(root, latestWorkRoot);
    const oldArtifact = path.join(oldWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'paper.docx');
    const latestArtifact = path.join(latestWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'paper.docx');
    fs.writeFileSync(oldArtifact, 'old conversation');
    fs.writeFileSync(latestArtifact, 'latest conversation');
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    const [oldShortcut] = await synchronizeUserViewShortcuts(root, oldWorkRoot, [oldArtifact], { shortcutWriter });
    await synchronizeUserViewShortcuts(root, latestWorkRoot, [latestArtifact], { shortcutWriter });
    expect(fs.readFileSync(oldShortcut.shortcutPath, 'utf-8')).toBe(latestArtifact);

    fs.rmSync(oldArtifact);
    await finalizeWorkspaceWorkbench(root, oldWorkRoot, [], { shortcutWriter });
    expect(fs.readFileSync(oldShortcut.shortcutPath, 'utf-8')).toBe(latestArtifact);
  });

  it('publishes figure support files, framework, supplementary, and other outputs into dedicated directories', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const figurePath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables, 'figure1', 'result.png');
    const captionPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables, 'figure1', 'caption.txt');
    const codePath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables, 'figure1', 'plot.R');
    const dataPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables, 'figure1', 'data.xlsx');
    const frameworkPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.framework, 'paper-framework.json');
    const supplementaryPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary, 'appendix.txt');
    const otherDocumentPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, 'notes.docx');
    [figurePath, captionPath, codePath, dataPath, frameworkPath, supplementaryPath, otherDocumentPath].forEach(filePath => {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, path.basename(filePath));
    });
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    const finalized = await finalizeWorkspaceWorkbench(aiWorkRoot, aiWorkRoot, [
      figurePath,
      captionPath,
      codePath,
      dataPath,
      frameworkPath,
      supplementaryPath,
      otherDocumentPath,
    ], {
      shortcutWriter,
    });
    const suffix = process.platform === 'win32' ? '.lnk' : '';

    expect(finalized.userViewRoot).toBe(path.join(root, USER_VIEW_DIRECTORY_NAME));
    expect(fs.existsSync(path.join(aiWorkRoot, USER_VIEW_DIRECTORY_NAME))).toBe(false);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.figures, 'figure1', `result.png${suffix}`))).toBe(true);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.figures, 'figure1', `caption.txt${suffix}`))).toBe(true);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.figures, 'figure1', `plot.R${suffix}`))).toBe(true);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.figures, 'figure1', `data.xlsx${suffix}`))).toBe(true);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.framework, `paper-framework.json${suffix}`))).toBe(true);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.supplementary, `appendix.txt${suffix}`))).toBe(true);
    expect(fs.existsSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.other, `notes.docx${suffix}`))).toBe(true);
    expect(fs.readdirSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.drafts))).toEqual([
      `figures_tables.docx${suffix}`,
    ]);
  });

  it('keeps the three primary Word deliverables in stable project storage when a later turn has no replacements', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const draftPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.drafts, PRIMARY_WORD_DELIVERABLES.draft);
    const mainPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.figuresTables, PRIMARY_WORD_DELIVERABLES.mainFiguresTables);
    const supplementaryPath = path.join(aiWorkRoot, AI_WORKBENCH_OUTPUT_DIRECTORIES.supplementary, PRIMARY_WORD_DELIVERABLES.supplementary);
    for (const [filePath, content] of [[draftPath, 'draft-v1'], [mainPath, 'main-v1'], [supplementaryPath, 'supp-v1']]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content);
    }
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    await finalizeWorkspaceWorkbench(root, aiWorkRoot, [draftPath, mainPath, supplementaryPath], { shortcutWriter });
    const stableRoot = path.join(
      root,
      'ScholarHarness_AI_Workspaces',
      'Project-p',
      PROJECT_PRIMARY_DELIVERABLES_DIRECTORY_NAME,
    );
    for (const fileName of Object.values(PRIMARY_WORD_DELIVERABLES)) {
      expect(fs.existsSync(path.join(stableRoot, fileName))).toBe(true);
    }

    fs.rmSync(draftPath);
    fs.rmSync(mainPath);
    fs.rmSync(supplementaryPath);
    await finalizeWorkspaceWorkbench(root, aiWorkRoot, [], { shortcutWriter });
    const suffix = process.platform === 'win32' ? '.lnk' : '';
    for (const fileName of Object.values(PRIMARY_WORD_DELIVERABLES)) {
      const stablePath = path.join(stableRoot, fileName);
      const shortcutPath = path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.drafts, `${fileName}${suffix}`);
      expect(fs.existsSync(stablePath)).toBe(true);
      expect(fs.readFileSync(shortcutPath, 'utf-8')).toBe(stablePath);
    }
    expect(fs.readdirSync(path.join(root, USER_VIEW_DIRECTORY_NAME, USER_VIEW_OUTPUT_DIRECTORIES.drafts)).sort()).toEqual(
      Object.values(PRIMARY_WORD_DELIVERABLES).map(fileName => `${fileName}${suffix}`).sort(),
    );
  });

  it('does not rebuild cumulative Word deliverables while merely preparing the next Agent turn', async () => {
    const { root, aiWorkRoot } = createWorkspace();
    const cumulativeRoot = resolveProjectCumulativeArtifactRoot(aiWorkRoot);
    const figureDirectory = path.join(cumulativeRoot, WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir, 'figure1');
    const mainDocxPath = path.join(
      cumulativeRoot,
      WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir,
      WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName,
    );
    fs.mkdirSync(figureDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(figureDirectory, 'figure1.png'),
      Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    );
    fs.writeFileSync(path.join(figureDirectory, 'figure1_caption.txt'), 'Figure 1. Stable caption.');
    fs.writeFileSync(mainDocxPath, 'existing cumulative Word must survive an ordinary follow-up');
    const shortcutWriter = async (shortcutPath: string, targetPath: string): Promise<void> => {
      fs.mkdirSync(path.dirname(shortcutPath), { recursive: true });
      fs.writeFileSync(shortcutPath, targetPath, 'utf-8');
    };

    await prepareWorkspaceWorkbench(root, aiWorkRoot, { shortcutWriter });

    expect(fs.readFileSync(mainDocxPath, 'utf-8')).toBe('existing cumulative Word must survive an ordinary follow-up');
  });
});
