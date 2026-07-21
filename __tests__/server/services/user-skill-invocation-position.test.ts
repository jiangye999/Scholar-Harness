import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserSkill,
  parseUserSkillInvocation,
} from '../../../src/server/services/user-skills';
import { clearPathCache } from '../../../src/utils/paths';

const originalDataDir = process.env.DATA_DIR;
let tempDataDir = '';

beforeEach(async () => {
  tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-invocation-position-'));
  process.env.DATA_DIR = tempDataDir;
  clearPathCache();
});

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  clearPathCache();
  if (tempDataDir) await fs.rm(tempDataDir, { recursive: true, force: true });
  tempDataDir = '';
});

describe('user Skill invocation position', () => {
  it('invokes a Skill only when its slash command is the first non-whitespace token', async () => {
    const userId = 'invocation-position-user';
    const skill = await createUserSkill(userId, {
      name: '位置规则测试',
      trigger: 'position-only-test',
      description: '验证斜杠命令的位置规则',
      prompt: 'Apply the position-only test rule.',
      enabled: true,
    });

    const leading = await parseUserSkillInvocation(
      userId,
      `  /${skill.trigger} 请检查这段内容`,
    );
    expect(leading.invokedSkills.map(item => item.id)).toContain(skill.id);
    expect(leading.cleanMessage).toBe('请检查这段内容');

    const inline = await parseUserSkillInvocation(
      userId,
      `请使用 /${skill.trigger} 检查这段内容`,
    );
    expect(inline.invokedSkills).toHaveLength(0);
    expect(inline.cleanMessage).toBe(`请使用 /${skill.trigger} 检查这段内容`);

    const laterLine = await parseUserSkillInvocation(
      userId,
      `请先查看内容\n/${skill.trigger}`,
    );
    expect(laterLine.invokedSkills).toHaveLength(0);
    expect(laterLine.cleanMessage).toBe(`请先查看内容\n/${skill.trigger}`);
  });

  it('does not skip an unknown leading command to invoke a later command', async () => {
    const userId = 'invocation-position-order-user';
    const skill = await createUserSkill(userId, {
      name: '顺序规则测试',
      trigger: 'second-command-test',
      description: '',
      prompt: 'This command must be first.',
      enabled: true,
    });

    const result = await parseUserSkillInvocation(
      userId,
      `/unknown-command /${skill.trigger} 请检查`,
    );

    expect(result.invokedSkills).toHaveLength(0);
    expect(result.cleanMessage).toBe(`/unknown-command /${skill.trigger} 请检查`);
  });
});
