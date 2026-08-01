import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('first-run onboarding', () => {
  it('automatically opens only for users without prior use or a saved decision', () => {
    expect(html).toContain("var FIRST_RUN_ONBOARDING_KEY = 'scholarharness_first_run_onboarding_v1'");
    expect(html).toContain('function hasPriorChatUsageForOnboarding()');
    expect(html).toContain("state.status === 'completed' || state.status === 'dismissed' || hasPriorChatUsageForOnboarding()");
    expect(html).toContain('scheduleFirstRunOnboarding(0)');
  });

  it('treats one AI provider as required and local plugins as optional', () => {
    expect(html).toContain("firstRunStatusRow('小牛马'");
    expect(html).toContain("firstRunStatusRow('大牛马'");
    expect(html).toContain("firstRunStatusRow('Embedding'");
    expect(html).toContain("firstRunStatusRow('Codex CLI'");
    expect(html).toContain("firstRunStatusRow('本地运行时'");
    expect(html).toContain("firstRunStatusRow('Skill 与 MCP'");
    expect(html).toContain("tag === '可选'");
    expect(html).toContain('小牛马必需 · 其余按需');
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
    expect(html).toContain("configCenterButton('AI 配置与使用向导'");
    expect(html).toContain('window.showFirstRunOnboardingDialog = showFirstRunOnboardingDialog');
    expect(html).toContain("if (action === 'pdf')");
    expect(html).toContain("if (action === 'workspace')");
    expect(html).toContain("startAiConfigurationAssistant(\\'literature\\')");
    expect(html).toContain('WoS / CNKI / RIS / PDF 怎么导入');
    expect(html).toContain("guidedConfigState.returnTarget = 'onboarding-literature'");
    expect(html).toContain("if (action === 'literature')");
  });

  it('validates guided AI credentials before reporting a successful setup', () => {
    expect(html).toContain('async function verifyGuidedAiConnection(kind)');
    expect(html).toContain("fetch('/api/chat-bridge/models'");
    expect(html).toContain("if (!(await verifyGuidedAiConnection('secondary'))) return");
    expect(html).toContain('检测连接并');
    expect(html).toContain('if (!response.ok || !result.success)');
    expect(html).toContain('var models = Array.isArray(result.models) ? result.models : []');
  });
});
