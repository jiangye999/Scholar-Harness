import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  importUserSkillFromGitHubUrl,
  listUserSkills,
} from '../../../src/server/services/user-skills';
import { clearPathCache } from '../../../src/utils/paths';

const originalDataDir = process.env.DATA_DIR;
let tempDataDir = '';

function jsonResponse(payload: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...(headers || {}) },
  });
}

beforeEach(async () => {
  tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'user-skill-import-'));
  process.env.DATA_DIR = tempDataDir;
  clearPathCache();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  clearPathCache();
  if (tempDataDir) await fs.rm(tempDataDir, { recursive: true, force: true });
  tempDataDir = '';
});

describe('GitHub user Skill import', () => {
  it('imports every nested SKILL.md from a repository and updates them idempotently', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === 'https://api.github.com/repos/acme/research-skills') {
        return jsonResponse({ default_branch: 'main' });
      }
      if (url.includes('/git/trees/main?recursive=1')) {
        return jsonResponse({
          truncated: false,
          tree: [
            { type: 'blob', path: 'writing/paper/SKILL.md' },
            { type: 'blob', path: 'training/peft/SKILL.md' },
            { type: 'blob', path: 'README.md' },
          ],
        });
      }
      if (url.endsWith('/writing/paper/SKILL.md')) {
        return new Response('---\nname: paper-writing\ndescription: Write an ML paper.\n---\n# Paper Writing\n\nFull instructions.');
      }
      if (url.endsWith('/training/peft/SKILL.md')) {
        return new Response('---\nname: peft\ndescription: Fine-tune with PEFT.\n---\n# PEFT\n\nFull instructions.');
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = await importUserSkillFromGitHubUrl('github-user', {
      url: 'https://github.com/acme/research-skills',
    });
    expect(first.source.importMode).toBe('collection');
    expect(first.skills).toHaveLength(2);
    expect(first.createdCount).toBe(2);
    expect(first.updatedCount).toBe(0);
    expect(first.skills.map(skill => skill.name)).toEqual(['peft', 'paper-writing']);
    expect(first.skills[0].source).toMatchObject({
      repository: 'acme/research-skills',
      path: 'training/peft/SKILL.md',
    });

    const second = await importUserSkillFromGitHubUrl('github-user', {
      url: 'https://github.com/acme/research-skills',
    });
    expect(second.createdCount).toBe(0);
    expect(second.updatedCount).toBe(2);
    expect(await listUserSkills('github-user')).toHaveLength(2);
  });

  it('keeps a direct SKILL.md link as a single import', async () => {
    const longInstructions = 'x'.repeat(130_000);
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/single/SKILL.md')) {
        return new Response(`---\nname: single-skill\ndescription: One skill.\n---\n# Single Skill\n\n${longInstructions}`);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const result = await importUserSkillFromGitHubUrl('single-user', {
      url: 'https://github.com/acme/research-skills/blob/main/single/SKILL.md',
    });
    expect(result.source.importMode).toBe('single');
    expect(result.skills).toHaveLength(1);
    expect(result.skill.name).toBe('single-skill');
    expect(result.skill.prompt.length).toBeGreaterThan(120_000);
  });

  it('returns a useful message when the GitHub API rate limit is exhausted', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(
      { message: 'API rate limit exceeded' },
      403,
      { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1893456000' },
    )));

    await expect(importUserSkillFromGitHubUrl('limited-user', {
      url: 'https://github.com/acme/research-skills',
    })).rejects.toThrow('GitHub API 访问频率已受限');
  });
});
