import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { clearPathCache, getMemoryDir, getUploadDir } from '../../src/utils/paths';
import {
  resolveProjectRuntimeContext,
  runWithProjectRuntimeContext,
} from '../../src/utils/project-runtime-context';

describe('project runtime context', () => {
  let dataDir = '';
  let previousDataDir: string | undefined;

  beforeEach(() => {
    previousDataDir = process.env.DATA_DIR;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-project-runtime-'));
    process.env.DATA_DIR = dataDir;
    clearPathCache();
    for (const projectId of ['project-20260819000100-aaaaaa', 'project-20260819000200-bbbbbb']) {
      const projectRoot = path.join(dataDir, 'projects', projectId);
      fs.mkdirSync(projectRoot, { recursive: true });
      fs.writeFileSync(path.join(projectRoot, 'project.json'), JSON.stringify({ projectId }), 'utf-8');
    }
  });

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previousDataDir;
    clearPathCache();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('keeps concurrent async tasks bound to their launch project', async () => {
    const projectA = resolveProjectRuntimeContext(dataDir, 'project-20260819000100-aaaaaa');
    const projectB = resolveProjectRuntimeContext(dataDir, 'project-20260819000200-bbbbbb');

    const [pathsA, pathsB] = await Promise.all([
      runWithProjectRuntimeContext(projectA, async () => {
        await Promise.resolve();
        return [getMemoryDir(), getUploadDir()];
      }),
      runWithProjectRuntimeContext(projectB, async () => {
        await Promise.resolve();
        return [getMemoryDir(), getUploadDir()];
      }),
    ]);

    expect(pathsA[0]).toBe(path.join(projectA!.projectRoot, 'memory'));
    expect(pathsA[1]).toBe(path.join(projectA!.projectRoot, 'uploads'));
    expect(pathsB[0]).toBe(path.join(projectB!.projectRoot, 'memory'));
    expect(pathsB[1]).toBe(path.join(projectB!.projectRoot, 'uploads'));
    expect(pathsA).not.toEqual(pathsB);
  });
});
