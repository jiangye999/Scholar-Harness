import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  getMirroredLocalOutputCandidatePaths,
  pickNewestExistingLocalOutputPath,
} from '../../../src/server/services/local-output-path-candidates';

const tempRoots: string[] = [];
const imageExtensions = new Set(['.png']);

function createTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-output-path-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  while (tempRoots.length) {
    const root = tempRoots.pop();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('local output path candidates', () => {
  it('maps an artifact from a historical safe workspace to the active safe workspace', () => {
    const projectRoot = createTempRoot();
    const oldRoot = path.join(projectRoot, 'ScholarHarness_AI_Workspaces', 'run-old');
    const activeRoot = path.join(projectRoot, 'ScholarHarness_AI_Workspaces', 'run-active');
    const oldImage = path.join(oldRoot, 'plots', 'figure.png');
    const activeImage = path.join(activeRoot, 'plots', 'figure.png');
    fs.mkdirSync(path.dirname(oldImage), { recursive: true });
    fs.mkdirSync(path.dirname(activeImage), { recursive: true });
    fs.writeFileSync(oldImage, 'old-image');
    fs.writeFileSync(activeImage, 'new-image');
    fs.utimesSync(oldImage, new Date(1_700_000_000_000), new Date(1_700_000_000_000));
    fs.utimesSync(activeImage, new Date(1_800_000_000_000), new Date(1_800_000_000_000));

    const mirrored = getMirroredLocalOutputCandidatePaths(
      oldImage,
      [activeRoot],
      [projectRoot, oldRoot, activeRoot],
    );

    expect(mirrored).toContain(path.resolve(activeImage));
    expect(pickNewestExistingLocalOutputPath(
      [oldImage, ...mirrored],
      [projectRoot],
      imageExtensions,
    )).toBe(path.resolve(activeImage));
  });

  it('preserves the relative subdirectory instead of guessing by basename', () => {
    const projectRoot = createTempRoot();
    const oldRoot = path.join(projectRoot, 'ScholarHarness_AI_Workspaces', 'run-old');
    const activeRoot = path.join(projectRoot, 'ScholarHarness_AI_Workspaces', 'run-active');
    const oldImage = path.join(oldRoot, 'analysis-a', 'figure.png');
    fs.mkdirSync(path.dirname(oldImage), { recursive: true });
    fs.mkdirSync(activeRoot, { recursive: true });
    fs.writeFileSync(oldImage, 'old-image');

    const mirrored = getMirroredLocalOutputCandidatePaths(
      oldImage,
      [activeRoot],
      [projectRoot, oldRoot],
    );

    expect(mirrored).toContain(path.join(activeRoot, 'analysis-a', 'figure.png'));
    expect(mirrored).not.toContain(path.join(activeRoot, 'figure.png'));
  });

  it('rejects candidates outside the allowed roots', () => {
    const allowedRoot = createTempRoot();
    const outsideRoot = createTempRoot();
    const outsideImage = path.join(outsideRoot, 'figure.png');
    fs.writeFileSync(outsideImage, 'outside');

    expect(pickNewestExistingLocalOutputPath(
      [outsideImage],
      [allowedRoot],
      imageExtensions,
    )).toBeNull();
  });
});
