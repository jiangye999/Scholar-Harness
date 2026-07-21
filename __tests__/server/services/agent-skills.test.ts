import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/server/services/user-skills', () => ({
  listUserSkills: vi.fn(async () => ([
    {
      id: 'custom-discussion',
      name: '我的讨论 Skill',
      trigger: '我的讨论',
      description: '按用户自己的机制链规则写讨论。',
      prompt: '先概括结果，再解释机制，最后比较文献。',
      enabled: true,
      createdAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z',
    },
  ])),
}));

import {
  clearAgentSkillRegistryCache,
  createAgentSkillRuntime,
  deleteBundledAgentSkill,
  selectDiscussionAutoSkillIds,
} from '../../../src/server/services/agent-skills';
import { clearPathCache } from '../../../src/utils/paths';

function toolCall(name: string, args: Record<string, unknown>) {
  return {
    id: `call-${name}`,
    type: 'function' as const,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

describe('Agent Skill runtime', () => {
  let tempDataDir = '';
  const originalDataDir = process.env.DATA_DIR;

  afterEach(async () => {
    clearAgentSkillRegistryCache();
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    clearPathCache();
    if (tempDataDir) {
      await fs.rm(tempDataDir, { recursive: true, force: true });
      tempDataDir = '';
    }
  });

  it('lists bundled OpenScience skills together with enabled user skills', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    const catalog = runtime.getCatalog();

    expect(catalog).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'open-science-academic:peer-review',
        source: 'bundled',
      }),
      expect.objectContaining({
        id: 'open-science-academic:scientific-visualization',
        source: 'bundled',
      }),
      expect.objectContaining({
        id: 'scholar-harness-core:target-venue-peer-review',
        source: 'bundled',
      }),
      expect.objectContaining({
        id: 'scholar-harness-core:establish-paper-core-argument',
        source: 'bundled',
      }),
      expect.objectContaining({
        id: 'orchestra-ai-research:ai-research-skills',
        source: 'bundled',
      }),
      expect.objectContaining({
        id: 'user:custom-discussion',
        source: 'user',
        manualTrigger: '/我的讨论',
      }),
    ]));
    expect(runtime.getToolDefinitions().map(tool => tool.function.name)).toEqual([
      'load_skill',
      'read_skill_resource',
      'list_available_skills',
    ]);
  });

  it('rebuilds the catalog from newly extracted journal writing styles', async () => {
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-journal-style-'));
    process.env.DATA_DIR = tempDataDir;
    clearPathCache();
    const styleDir = path.join(tempDataDir, 'uploads', 'style-user', 'journal-styles', 'global_change_biology');
    await fs.mkdir(styleDir, { recursive: true });
    await fs.writeFile(path.join(styleDir, 'style.json'), JSON.stringify([{
      journal: 'Global Change Biology',
      argument_pattern: { discussion_emphasis: ['mechanism', 'comparison', 'limitation'] },
      overall_style: 'Mechanism-first discussion with calibrated claims.',
    }]), 'utf-8');

    const runtime = await createAgentSkillRuntime('style-user');
    const styleSkill = runtime.getCatalog().find(skill =>
      skill.id === 'journal-style:global_change_biology:discussion'
    );
    expect(styleSkill).toMatchObject({
      name: 'Global Change Biology 讨论写作风格',
      category: 'writing-style',
      source: 'user',
    });

    const loaded = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'journal-style:global_change_biology:discussion',
      reason: '用户正在撰写讨论章节',
    }));
    expect(loaded.ok).toBe(true);
    expect(loaded.content).toContain('Global Change Biology');
    expect(loaded.content).toContain('mechanism');
  });

  it('loads the paper core argument skill as a staged pre-writing dialogue', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    const result = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'scholar-harness-core:establish-paper-core-argument',
      reason: '用户准备开始写一篇小论文',
    }));

    expect(result.ok).toBe(true);
    expect(result.content).toContain('论文核心论点奠基');
    expect(result.content).toContain('一次只推进一个阶段');
    expect(result.content).toContain('核心论点—论据基调卡');
    expect(result.content).toContain('禁止写出的过度结论');
  });

  it('selects relevant downloaded skills automatically for Discussion writing', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    const selected = selectDiscussionAutoSkillIds(runtime.getCatalog());

    expect(selected).toEqual(expect.arrayContaining([
      'user:custom-discussion',
      'open-science-academic:scientific-writing',
      'open-science-academic:scientific-critical-thinking',
      'open-science-academic:citation-management',
      'open-science-academic:literature-review',
    ]));
    expect(selected).not.toContain('open-science-academic:scientific-visualization');
  });

  it('deletes a bundled skill for one user without removing its packaged files', async () => {
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-disabled-'));
    process.env.DATA_DIR = tempDataDir;
    clearPathCache();

    const skillId = 'open-science-academic:scientific-writing';
    const deleted = await deleteBundledAgentSkill('delete-bundled-user', skillId);
    const deletedUserCatalog = (await createAgentSkillRuntime('delete-bundled-user')).getCatalog();
    const otherUserCatalog = (await createAgentSkillRuntime('other-user')).getCatalog();
    const persisted = JSON.parse(await fs.readFile(
      path.join(tempDataDir, 'agent-skills', 'delete-bundled-user', 'disabled-bundled-skills.json'),
      'utf-8',
    )) as { skillIds: string[] };

    expect(deleted).toMatchObject({ id: skillId, name: 'Scientific Writing' });
    expect(deletedUserCatalog.some(skill => skill.id === skillId)).toBe(false);
    expect(otherUserCatalog.some(skill => skill.id === skillId)).toBe(true);
    expect(persisted.skillIds).toContain(skillId);
  });

  it('loads the target-venue review skill with venue evidence and severity rules', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    const result = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'scholar-harness-core:target-venue-peer-review',
      reason: '用户上传论文并要求按目标期刊标准审稿',
    }));

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Scientific-Paper-Reviewer Skill');
    expect(result.content).toContain('研究逻辑链');
    expect(result.content).toContain('Major Concern');
    expect(result.content).toContain('联网要求必须来自当前官方页面');
  });

  it('loads the Orchestra router and exposes the 98-skill index as a resource', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    const loaded = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'orchestra-ai-research:ai-research-skills',
      reason: '用户需要 AI 研究工程工作流',
    }));

    expect(loaded.ok).toBe(true);
    expect(loaded.content).toContain('AI Research SKILLs Router');
    expect(loaded.content).toContain('INDEX.md');
    expect(loaded.content).toContain('Orchestra-Research/AI-Research-SKILLs');

    const index = await runtime.executeToolCall(toolCall('read_skill_resource', {
      skill_id: 'orchestra-ai-research:ai-research-skills',
      resource_path: 'INDEX.md',
      max_lines: 220,
    }));
    expect(index.ok).toBe(true);
    expect(index.content).toContain('Skills: 98');
    expect(index.content).toContain('vendor/20-ml-paper-writing');
  });

  it('loads a bundled skill with the Scholar Harness policy overlay and resource index', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    const result = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'open-science-academic:scientific-writing',
      reason: '用户正在撰写论文方法部分',
    }));

    expect(result.ok).toBe(true);
    expect(result.content).toContain('图形摘要和额外 AI 图片不是强制项');
    expect(result.content).toContain('--- Skill 指令开始（已应用 Scholar Harness 兼容层）---');
    expect(result.content).not.toContain('Every scientific paper MUST include a graphical abstract');
    expect(result.content).toContain('references/writing_principles.md');

    const duplicate = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'open-science-academic:scientific-writing',
    }));
    expect(duplicate.data).toMatchObject({ alreadyLoaded: true });
  });

  it('reads only resources inside an already loaded bundled skill', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user');
    await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'open-science-academic:scientific-writing',
    }));

    const resource = await runtime.executeToolCall(toolCall('read_skill_resource', {
      skill_id: 'open-science-academic:scientific-writing',
      resource_path: 'references/writing_principles.md',
      max_lines: 20,
    }));
    expect(resource.ok).toBe(true);
    expect(resource.content).toContain('Skill resource:');

    const traversal = await runtime.executeToolCall(toolCall('read_skill_resource', {
      skill_id: 'open-science-academic:scientific-writing',
      resource_path: '../SKILL.md',
    }));
    expect(traversal.ok).toBe(false);
    expect(traversal.error).toContain('超出 Skill 目录');
  });

  it('keeps explicit manual skills active without loading the same prompt twice', async () => {
    const runtime = await createAgentSkillRuntime('skill-test-user', ['custom-discussion']);
    const manual = runtime.getCatalog().find(skill => skill.id === 'user:custom-discussion');
    expect(manual?.explicitlyActive).toBe(true);

    const result = await runtime.executeToolCall(toolCall('load_skill', {
      skill_id: 'user:custom-discussion',
    }));
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ alreadyActive: true });
    expect(result.content).not.toContain('先概括结果，再解释机制');
  });

  it('materializes a Codex-readable catalog and user Skill files', async () => {
    tempDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-skills-'));
    process.env.DATA_DIR = tempDataDir;
    clearPathCache();

    const runtime = await createAgentSkillRuntime('codex-skill-user');
    const context = await runtime.prepareCodexContext();
    const codexRoot = path.join(tempDataDir, 'agent-skills', 'codex-skill-user', 'codex');
    const catalog = await fs.readFile(path.join(codexRoot, 'CATALOG.md'), 'utf-8');
    const userFiles = (await fs.readdir(codexRoot)).filter(file => file !== 'CATALOG.md');

    expect(context.allowedRoots).toContain(codexRoot);
    expect(context.catalogPrompt).toContain('open-science-academic:peer-review');
    expect(catalog).toContain('user:custom-discussion');
    expect(userFiles).toHaveLength(1);
    expect(await fs.readFile(path.join(codexRoot, userFiles[0]), 'utf-8')).toContain('先概括结果，再解释机制');
  });
});
