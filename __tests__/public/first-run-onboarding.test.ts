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

  it('tracks the three first-use destinations and closes after all are visited', () => {
    expect(html).toContain("var FIRST_RUN_ONBOARDING_STEPS = ['secondary', 'embedding', 'plugins']");
    expect(html).toContain('function markFirstRunOnboardingStepVisited(step)');
    expect(html).toContain("state.status = hasCompletedFirstRunOnboardingSteps(state.visited) ? 'completed' : 'in-progress'");
    expect(html).toContain('配置 Little corse');
    expect(html).toContain('配置 Embedding');
    expect(html).toContain('配置插件');
    expect(html).toContain('访问第三个入口后自动关闭');
    expect(html).toContain('removeFirstRunOnboardingBubble()');
  });

  it('detects existing runtimes and can enable Codex without manual path entry', () => {
    expect(html).toContain("fetchFirstRunStatus('/api/chat-bridge/codex/status')");
    expect(html).toContain("fetchFirstRunStatus('/api/r-code/plugin/auto-detect', { method: 'POST' })");
    expect(html).toContain("fetchFirstRunStatus('/api/python-plugin/auto-detect', { method: 'POST' })");
    expect(html).toContain("fetchFirstRunStatus('/api/office-plugin/auto-detect', { method: 'POST' })");
    expect(html).toContain('async function enableFirstRunCodex()');
    expect(html).toContain("setComposerChatProvider('codex')");
  });

  it('keeps the full guide reachable from settings and opens existing config pages', () => {
    expect(html).toContain("configCenterButton('AI 配置与使用向导'");
    expect(html).toContain('window.showFirstRunOnboardingDialog = showFirstRunOnboardingDialog');
    expect(html).toContain('window.openFirstRunOnboardingStep = openFirstRunOnboardingStep');
    expect(html).toContain('openFirstRunAiConfig()');
    expect(html).toContain('openFirstRunEmbeddingConfig()');
    expect(html).toContain('showRuntimePluginConfigDialog()');
    expect(html).toContain("guidedConfigState.returnTarget = 'onboarding'");
  });

  it('allows manual dismissal without marking unfinished steps complete', () => {
    expect(html).toContain('className = \'first-run-onboarding-bubble\'');
    expect(html).toContain('onclick="dismissFirstRunOnboarding()"');
    expect(html).toContain("saveFirstRunOnboardingState('dismissed', state.visited)");
    expect(html).toContain('removeFirstRunOnboardingBubble()');
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
