import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  approveConstructorChange,
  buildReasonixProcessEnvironment,
  buildReasonixRunArgs,
  createConstructorChangePlan,
  deleteConstructorFeatureStorage,
  getConstructorFeatureAsset,
  installConstructorFeature,
  listConstructorFeatures,
  readConstructorFeatureStorage,
  resumeConstructorPipeline,
  setConstructorFeatureEnabled,
  startConstructorPipeline,
  uninstallConstructorFeature,
  writeReasonixProjectConfig,
  writeConstructorFeatureStorage,
} from '../../../src/server/services/constructor-agent';
import { clearPathCache } from '../../../src/utils/paths';

const originalDataDir = process.env.DATA_DIR;
let tempDir = '';

async function createFeaturePackage(entry = 'frontend/index.html', version = '0.1.0'): Promise<string> {
  const packageDir = path.join(
    process.env.DATA_DIR!,
    'constructor-agent',
    'alice',
    'staging',
    `package-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  await fs.mkdir(path.join(packageDir, 'frontend'), { recursive: true });
  await fs.writeFile(path.join(packageDir, 'frontend', 'index.html'), '<!doctype html><title>Test</title>', 'utf8');
  await fs.writeFile(path.join(packageDir, 'feature.json'), JSON.stringify({
    schemaVersion: 1,
    apiVersion: 1,
    id: 'test-feature',
    name: 'Test Feature',
    version,
    description: 'Constructor Agent test package',
    permissions: ['ui:page', 'ui:navigation', 'feature:storage'],
    contributions: {
      pages: [{ id: 'main', title: 'Test', subtitle: '', entry }],
      navigation: [{ id: 'main-nav', label: 'Test', pageId: 'main', section: 'tools' }],
      commands: [],
    },
    compatibility: { minAppVersion: '1.0.8' },
  }), 'utf8');
  return packageDir;
}

describe('Constructor Agent runtime feature packages', () => {
  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-constructor-agent-'));
    process.env.DATA_DIR = path.join(tempDir, 'data');
    clearPathCache();
  });

  afterEach(async () => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    clearPathCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('installs disabled, enables explicitly, and isolates private feature storage', async () => {
    const packageDir = await createFeaturePackage();
    await installConstructorFeature('alice', packageDir);

    expect(await listConstructorFeatures('alice', true)).toHaveLength(0);
    await setConstructorFeatureEnabled('alice', 'test-feature', true);

    const enabled = await listConstructorFeatures('alice', true) as Array<{ id: string }>;
    expect(enabled.map(feature => feature.id)).toEqual(['test-feature']);
    expect(await getConstructorFeatureAsset('alice', 'test-feature', 'frontend/index.html')).toContain('test-feature');

    await writeConstructorFeatureStorage('alice', 'test-feature', 'settings', { mode: 'strict' });
    expect(await readConstructorFeatureStorage('alice', 'test-feature', 'settings')).toEqual({ mode: 'strict' });
    await expect(readConstructorFeatureStorage('bob', 'test-feature', 'settings')).rejects.toThrow('功能包未启用或不存在');
    await deleteConstructorFeatureStorage('alice', 'test-feature', 'settings');
    expect(await readConstructorFeatureStorage('alice', 'test-feature', 'settings')).toBeNull();

    await uninstallConstructorFeature('alice', 'test-feature');
    expect(await listConstructorFeatures('alice')).toHaveLength(0);
  });

  it('rejects page entries that escape the feature package', async () => {
    const packageDir = await createFeaturePackage('../outside.html');
    await expect(installConstructorFeature('alice', packageDir)).rejects.toThrow();
  });

  it('preserves the enabled state when installing a new revision without an explicit enable override', async () => {
    const initialPackage = await createFeaturePackage('frontend/index.html', '0.1.0');
    await installConstructorFeature('alice', initialPackage, { enable: true });

    const revisionPackage = await createFeaturePackage('frontend/index.html', '0.1.1');
    await installConstructorFeature('alice', revisionPackage);

    const enabled = await listConstructorFeatures('alice', true) as Array<{
      id: string;
      activeVersion: string;
      enabled: boolean;
    }>;
    expect(enabled).toHaveLength(1);
    expect(enabled[0]).toMatchObject({
      id: 'test-feature',
      activeVersion: '0.1.1',
      enabled: true,
    });
  });

  it('uses the software capability map and requires approval for critical core changes', async () => {
    const plan = await createConstructorChangePlan('alice', '修改云端登录、支付授权和数据库迁移流程');

    expect(plan.mode).toBe('core-change');
    expect(plan.risk).toBe('critical');
    expect(plan.status).toBe('awaiting-plan-approval');
    expect(plan.requiresApproval).toBe(true);
    expect(plan.affectedDomains.some(domain => domain.id === 'cloud')).toBe(true);
    expect(plan.rollbackStrategy.join(' ')).toContain('备份');

    const approved = await approveConstructorChange('alice', plan.id, 'plan');
    expect(approved.status).toBe('approved-for-generation');
    expect(approved.approval?.planApprovedAt).toBeTruthy();
  });

  it('keeps isolated additions low-risk and disabled-by-default', async () => {
    const plan = await createConstructorChangePlan('alice', '新增一个实验设计检查页面并保存功能私有设置');
    expect(plan.mode).toBe('runtime-feature');
    expect(plan.risk).toBe('low');
    expect(plan.status).toBe('planned');
    expect(plan.requiresApproval).toBe(false);
  });

  it('routes changes to existing frontend behavior through governed core changes', async () => {
    const buttonPlan = await createConstructorChangePlan('alice', '把主页现有发送按钮改成主题色，并调整 hover 样式');
    expect(buttonPlan.mode).toBe('core-change');
    expect(buttonPlan.risk).toBe('high');
    expect(buttonPlan.status).toBe('awaiting-plan-approval');

    const sidebarPlan = await createConstructorChangePlan('alice', '调整侧边栏布局并去掉原来的导航按钮', 'runtime-feature');
    expect(sidebarPlan.mode).toBe('core-change');
    expect(sidebarPlan.risk).toBe('high');

    const themedBubblePlan = await createConstructorChangePlan('alice', '让文字转语音界面的气泡跟随主题颜色');
    expect(themedBubblePlan.mode).toBe('core-change');
    expect(themedBubblePlan.operation).toBe('modify-core');

    const autoResearchPlan = await createConstructorChangePlan('alice', '优化 Auto Research 的打开速度');
    expect(autoResearchPlan.mode).toBe('core-change');
    expect(autoResearchPlan.operation).toBe('modify-core');
  });

  it('matches installed feature packages before deciding to create a new feature', async () => {
    const packageDir = await createFeaturePackage();
    await installConstructorFeature('alice', packageDir, { enable: true });

    const plan = await createConstructorChangePlan('alice', '让 Test Feature 的气泡跟随主题颜色');

    expect(plan.mode).toBe('runtime-feature');
    expect(plan.risk).toBe('low');
    expect(plan.operation).toBe('modify-runtime');
    expect(plan.targetFeature).toMatchObject({ id: 'test-feature', name: 'Test Feature', version: '0.1.0' });
    expect(plan.intentSummary?.join(' ')).toContain('不创建重复入口');
    expect(plan.affectedDomains.map(domain => domain.name)).toEqual(['运行时功能包：Test Feature']);
    expect(plan.affectedDomains.map(domain => domain.name)).not.toContain('主页聊天与两级 Agent');
    expect(plan.affectedDomains.map(domain => domain.name)).not.toContain('Electron 桌面壳与安装更新');
  });

  it('bypasses an unreachable inherited loopback proxy only for the Reasonix child process', async () => {
    const result = await buildReasonixProcessEnvironment(
      'C:\\Temp\\reasonix-home',
      {
        HTTPS_PROXY: 'http://127.0.0.1:7890',
        HTTP_PROXY: 'http://127.0.0.1:7890',
        NO_PROXY: 'localhost',
      },
      async () => false,
    );

    expect(result.env.REASONIX_HOME).toBe('C:\\Temp\\reasonix-home');
    expect(result.env.HTTPS_PROXY).toBeUndefined();
    expect(result.env.HTTP_PROXY).toBeUndefined();
    expect(result.bypassedProxies).toEqual(['127.0.0.1:7890']);
  });

  it('keeps a reachable inherited loopback proxy for Reasonix', async () => {
    const result = await buildReasonixProcessEnvironment(
      'C:\\Temp\\reasonix-home',
      { HTTPS_PROXY: 'http://127.0.0.1:7890' },
      async () => true,
    );

    expect(result.env.HTTPS_PROXY).toBeUndefined();
    expect(result.bypassedProxies).toEqual([]);
  });

  it('respects an explicit request for a separate new feature even when names overlap', async () => {
    const packageDir = await createFeaturePackage();
    await installConstructorFeature('alice', packageDir, { enable: true });

    const plan = await createConstructorChangePlan('alice', '另做一个独立功能，用于扩展 Test Feature 的演示能力');

    expect(plan.operation).toBe('create-runtime');
    expect(plan.targetFeature).toBeUndefined();
  });

  it('writes a valid project-local Reasonix config without persisting the API key', async () => {
    const workspaceDir = path.join(tempDir, 'reasonix-workspace');
    const configPath = await writeReasonixProjectConfig(workspaceDir, {
      apiUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/',
      model: 'qwen3.7-plus',
    });
    const content = await fs.readFile(configPath, 'utf8');

    expect(configPath).toBe(path.join(workspaceDir, 'reasonix.toml'));
    expect(content).toContain('config_version = 5');
    expect(content).toContain('base_url = "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"');
    expect(content).toContain('model = "qwen3.7-plus"');
    expect(content).toContain('api_key_env = "SCHOLAR_HARNESS_REASONIX_API_KEY"');
    expect(content).not.toContain('api-key-secret');
  });

  it('runs unattended Reasonix builds with writer fallbacks enabled inside the isolated workspace', () => {
    const workspaceDir = path.join(tempDir, 'reasonix-workspace');
    const args = buildReasonixRunArgs(workspaceDir, 'implement the feature');

    expect(args).toEqual([
      'run',
      '--dir',
      path.resolve(workspaceDir),
      '--permission-mode',
      'auto',
      '--max-steps',
      '0',
      'implement the feature',
    ]);
  });

  it('keeps the one-click pipeline at approval when the requested change is critical', async () => {
    const result = await startConstructorPipeline('alice', '修改云端登录、支付授权和数据库迁移流程');

    expect(result.state).toBe('approval-required');
    expect(result.job).toBeUndefined();
    expect(result.plan.mode).toBe('core-change');
    expect(result.plan.status).toBe('awaiting-plan-approval');
  });

  it('does not let a failed core change bypass approval through resume', async () => {
    const result = await startConstructorPipeline('alice', '修改云端登录和支付授权');
    const changePath = path.join(
      process.env.DATA_DIR!,
      'constructor-agent',
      'alice',
      'changes',
      `${result.plan.id}.json`,
    );
    const failed = { ...result.plan, status: 'failed' };
    await fs.writeFile(changePath, JSON.stringify(failed), 'utf8');

    await expect(resumeConstructorPipeline('alice', result.plan.id)).rejects.toThrow('尚未获得生成批准');
  });
});
