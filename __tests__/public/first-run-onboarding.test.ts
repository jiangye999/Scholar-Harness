import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('first-run onboarding', () => {
  it('automatically opens only for users without prior use or a saved decision', () => {
    expect(html).toContain("var FIRST_RUN_ONBOARDING_KEY = 'scholarharness_first_run_onboarding_v1'");
    expect(html).toContain('function hasPriorChatUsageForOnboarding()');
    expect(html).toContain("state.status === 'completed' || state.status === 'dismissed' || hasPriorChatUsageForOnboarding()");
    expect(html).toContain('scheduleFirstRunOnboarding(0)');
  });

  it('treats one AI provider as required and local plugins as optional', () => {
    expect(html).toContain("firstRunStatusRow('AI 引擎'");
    expect(html).toContain("firstRunStatusRow('R 作图'");
    expect(html).toContain("firstRunStatusRow('Python 数据处理'");
    expect(html).toContain("firstRunStatusRow('Office 文档'");
    expect(html).toContain("tag === '可选'");
    expect(html).toContain('必需 1 项 · 其余可选');
  });

  it('detects existing runtimes and can enable Codex without manual path entry', () => {
    expect(html).toContain("fetchFirstRunStatus('/api/chat-bridge/codex/status')");
    expect(html).toContain("fetchFirstRunStatus('/api/r-code/plugin/auto-detect', { method: 'POST' })");
    expect(html).toContain("fetchFirstRunStatus('/api/python-plugin/auto-detect', { method: 'POST' })");
    expect(html).toContain("fetchFirstRunStatus('/api/office-plugin/auto-detect', { method: 'POST' })");
    expect(html).toContain('async function enableFirstRunCodex()');
    expect(html).toContain("setComposerChatProvider('codex')");
  });

  it('keeps the guide reachable from settings and exposes concrete first tasks', () => {
    expect(html).toContain("configCenterButton('新手配置向导'");
    expect(html).toContain('window.showFirstRunOnboardingDialog = showFirstRunOnboardingDialog');
    expect(html).toContain("if (action === 'pdf')");
    expect(html).toContain("if (action === 'workspace')");
    expect(html).toContain("applyFirstRunRecommendedConfig(\\'literature\\')");
    expect(html).toContain('上传 WoS/CNKI 导出文件，建立 Embedding 知识库');
    expect(html).toContain("guidedConfigState.returnTarget = 'onboarding-literature'");
    expect(html).toContain("if (action === 'literature')");
  });

  it('validates guided AI credentials before reporting a successful setup', () => {
    expect(html).toContain('async function verifyGuidedAiConnection(kind)');
    expect(html).toContain("fetch('/api/chat-bridge/models'");
    expect(html).toContain("if (!(await verifyGuidedAiConnection('secondary'))) return");
    expect(html).toContain('检测连接并');
    expect(html).toContain('开始前会验证模型服务连接');
  });
});
