import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  activateSkillOptimizationCandidate,
  addSkillOptimizationCase,
  evaluateSkillOptimizationCandidate,
  generateSkillOptimizationCandidate,
  getSkillOptimizationLab,
  recordSkillOptimizationTrajectories,
  rollbackSkillOptimizationVersion,
  type SkillOptimizationModelExecutor,
} from '../../../src/server/services/skill-optimization';
import { createUserSkill, listUserSkills } from '../../../src/server/services/user-skills';
import { clearPathCache } from '../../../src/utils/paths';

const originalDataDir = process.env.DATA_DIR;
let tempDataDir = '';

beforeEach(async () => {
  tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-optimization-'));
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

describe('Skill optimization lab', () => {
  it('records trajectories, gates a candidate, activates it, and rolls back safely', async () => {
    const userId = 'skillopt-user';
    const skill = await createUserSkill(userId, {
      name: '文件检索回答',
      trigger: 'latest-file',
      description: '找到最新文件并回答用户问题',
      prompt: 'Inspect the available files and explain what you found.',
      enabled: true,
    });

    const recorded = await recordSkillOptimizationTrajectories({
      userId,
      skillIds: [skill.id],
      query: '哪个 Word 草稿最新？',
      response: '我分析了上传的文件。',
      provider: 'codex',
      conversationId: 'conversation-1',
    });
    expect(recorded).toBe(1);

    await addSkillOptimizationCase(userId, skill.id, {
      query: '判断哪个 Word 草稿最新，并直接回答。',
      response: '旧版本只分析了附件，没有回答。',
      provider: 'secondary',
      outcome: 'failure',
      expectedTerms: ['latest.docx', 'direct answer'],
      forbiddenTerms: ['analysis only'],
      notes: '必须先回答 query，再补充文件分析。',
      source: 'manual',
      conversationId: '',
    });

    const executeModel = vi.fn<SkillOptimizationModelExecutor>(async (_provider, messages) => {
      const system = String(messages[0]?.content || '');
      if (system.includes('optimize reusable Scholar Harness')) {
        return JSON.stringify({
          candidatePrompt: 'Inspect files. DIRECT ANSWER RULE: answer the query first and name latest.docx.',
          rationale: 'The prior skill analyzed attachments without answering the query.',
          editSummary: ['Answer the user query before describing file analysis.'],
        });
      }
      if (system.includes('DIRECT ANSWER RULE')) return 'direct answer: latest.docx';
      return 'analysis only';
    });

    const candidate = await generateSkillOptimizationCandidate(
      userId,
      skill.id,
      { optimizerProvider: 'primary', targetProvider: 'secondary' },
      executeModel,
    );
    expect(candidate.status).toBe('pending');

    const evaluated = await evaluateSkillOptimizationCandidate(
      userId,
      skill.id,
      candidate.id,
      { targetProvider: 'secondary' },
      executeModel,
    );
    expect(evaluated.status).toBe('validated');
    expect(evaluated.evaluation).toMatchObject({
      accepted: true,
      baselineScore: 0,
      candidateScore: 100,
      improvement: 100,
    });

    await activateSkillOptimizationCandidate(userId, skill.id, candidate.id);
    let savedSkill = (await listUserSkills(userId)).find(item => item.id === skill.id);
    expect(savedSkill?.prompt).toContain('DIRECT ANSWER RULE');

    const lab = await getSkillOptimizationLab(userId, skill.id);
    expect(lab.stats.totalTrajectories).toBe(2);
    expect(lab.stats.validationCases).toBe(1);
    expect(lab.versions).toHaveLength(2);
    const baselineVersion = lab.versions.find(version => version.source === 'baseline');
    expect(baselineVersion).toBeTruthy();

    await rollbackSkillOptimizationVersion(userId, skill.id, baselineVersion!.id);
    savedSkill = (await listUserSkills(userId)).find(item => item.id === skill.id);
    expect(savedSkill?.prompt).toBe('Inspect the available files and explain what you found.');
  });

  it('rejects a candidate that does not strictly improve the held-out score', async () => {
    const userId = 'skillopt-reject-user';
    const skill = await createUserSkill(userId, {
      name: '引用格式',
      trigger: 'citation',
      description: '',
      prompt: 'Always output (Zhang et al., 2026).',
      enabled: true,
    });
    await addSkillOptimizationCase(userId, skill.id, {
      query: '给出文中引用。',
      response: '',
      provider: 'secondary',
      outcome: 'success',
      expectedTerms: ['(Zhang et al., 2026)'],
      forbiddenTerms: [],
      notes: '保留当前正确行为。',
      source: 'manual',
      conversationId: '',
    });
    const executeModel = vi.fn<SkillOptimizationModelExecutor>(async (_provider, messages) => {
      const system = String(messages[0]?.content || '');
      if (system.includes('optimize reusable Scholar Harness')) {
        return JSON.stringify({
          candidatePrompt: 'Always output (Zhang et al., 2026). Add a short explanation.',
          rationale: 'Adds explanation.',
          editSummary: ['Add explanation.'],
        });
      }
      return '(Zhang et al., 2026)';
    });
    const candidate = await generateSkillOptimizationCandidate(
      userId,
      skill.id,
      { optimizerProvider: 'primary', targetProvider: 'secondary' },
      executeModel,
    );
    const evaluated = await evaluateSkillOptimizationCandidate(
      userId,
      skill.id,
      candidate.id,
      { targetProvider: 'secondary' },
      executeModel,
    );
    expect(evaluated.status).toBe('rejected');
    expect(evaluated.evaluation?.accepted).toBe(false);
    await expect(activateSkillOptimizationCandidate(userId, skill.id, candidate.id))
      .rejects.toThrow('尚未通过严格验证门');
  });
});
