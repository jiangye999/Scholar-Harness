import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  chatRequestSchema,
  saveConfigSchema,
  runtimeInstallRequestSchema,
  validate,
} from '../../src/bridge/chat-bridge/validation';
import { readPublicAppSource } from '../helpers/public-app-source';

const publicSource = readPublicAppSource();
const indexSource = readFileSync(
  path.resolve(__dirname, '../../src/public/index.html'),
  'utf-8',
);
const configCenterSource = readFileSync(
  path.resolve(__dirname, '../../src/public/app/skill-config.js'),
  'utf-8',
);
const routeSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'),
  'utf-8',
);
const bridgeSource = readFileSync(
  path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
  'utf-8',
);

describe('unified Coding Agent runtime contract', () => {
  it.each(['codex', 'pi', 'opencode'] as const)('accepts %s as an explicit chat runtime', runtimeId => {
    const result = validate(chatRequestSchema, {
      message: '检查并修复当前工作区。',
      projectId: 'project-20260819000100-aaaaaa',
      forceProvider: runtimeId,
      agentRuntime: runtimeId,
      agentRuntimeModel: 'provider/model',
      agentRuntimeReasoningEffort: 'high',
      agentRuntimeTimeoutMs: 120_000,
    });

    expect(result.success).toBe(true);
  });

  it('isolates Codex, Pi and OpenCode runtime sessions by project and conversation', () => {
    expect(bridgeSource).toContain("options.projectId || 'current-workspace'");
    expect(bridgeSource).toContain('`${userId}:${projectId}:${conversationId}:${workspaceKey}`');
    expect(bridgeSource).toContain('buildCodexConversationIdentityKey(options, workspaceRoot)');
    expect(routeSource).toContain("router.get('/pi/runs'");
    expect(routeSource).toContain('piAgentSessionManager.listActiveStates(userId)');
  });

  it('validates persisted Pi and OpenCode runtime settings', () => {
    const result = validate(saveConfigSchema, {
      mode: 'api',
      agent_runtimes: {
        default: 'pi',
        codex: {
          enabled: true,
          command: 'codex',
          model: 'gpt-5.5',
          reasoning_effort: 'xhigh',
          sandbox: 'workspace-write',
          timeout_ms: 300_000,
        },
        pi: {
          enabled: true,
          command: 'pi',
          model: 'openai/gpt-5.5',
          reasoning_effort: 'high',
          sandbox: 'workspace-write',
          timeout_ms: 120_000,
        },
        opencode: {
          enabled: true,
          command: 'opencode',
          model: 'openai/gpt-5.5',
          sandbox: 'read-only',
          auto_approve: true,
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it('connects composer choice, request overrides, routes and the runtime registry', () => {
    expect(publicSource).toContain('data-provider="codex"');
    expect(publicSource).toContain('data-provider="pi"');
    expect(publicSource).toContain('data-provider="opencode"');
    expect(publicSource).toContain('chatBridgeRequestBody.agentRuntime = explicitProvider');
    expect(publicSource).toContain('function getComposerCodingRuntimeSelection(provider)');
    expect(publicSource).toContain('function selectComposerPortableRuntimeProvider(runtimeId, event)');
    expect(publicSource).toContain('function loadComposerPortableRuntimeModels(runtimeId, forceRefresh)');
    expect(publicSource).toContain('body: JSON.stringify({ agent_runtimes: runtimePayload })');
    expect(publicSource).toContain('Agent 容器');
    expect(indexSource).not.toContain('编程 Agent');
    expect(publicSource).toContain(".replace(/Pi 编程 Agent/g, 'Pi Agent')");
    expect(publicSource).toContain(".replace(/Codex 编程 Agent/g, 'Codex')");
    expect(publicSource).toContain(".replace(/OpenCode 编程 Agent/g, 'OpenCode')");
    expect(publicSource).toContain("fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/status'");
    expect(publicSource).toContain("fetch('/api/chat-bridge/agent-runtimes/' + runtimeId + '/models'");
    expect(routeSource).toContain("router.get('/agent-runtimes'");
    expect(routeSource).toContain("router.get('/agent-runtimes/:runtimeId/status'");
    expect(routeSource).toContain("router.get('/agent-runtimes/:runtimeId/models'");
    expect(routeSource).toContain("router.post('/agent-runtimes/:runtimeId/models'");
    expect(routeSource).toContain("router.post('/agent-runtimes/:runtimeId/login'");
    expect(routeSource).toContain("router.get('/agent-runtimes/:runtimeId/providers'");
    expect(routeSource).toContain("router.post('/agent-runtimes/:runtimeId/install'");
    expect(routeSource).toContain('maskCodingAgentRuntimesForClient(config.agent_runtimes)');
    expect(routeSource).not.toContain('agent_runtimes: config.agent_runtimes');
    expect(configCenterSource).toContain('function installConfigCenterRuntime(runtimeId)');
    expect(configCenterSource).toContain('function renderConfigCenterRuntimeModels(runtimeId, models)');
    expect(configCenterSource).toContain('function openConfigCenterRuntimeLogin(runtimeId)');
    expect(configCenterSource).toContain('type="password"');
    expect(configCenterSource).toContain("@earendil-works/pi-coding-agent");
    expect(configCenterSource).toContain("opencode-ai");
    expect(bridgeSource).toContain('this.runtimeRegistry.register(new CodexAppServerRuntimeAdapter');
    expect(bridgeSource).toContain('this.runtimeRegistry.register(new PiRpcRuntimeAdapter());');
    expect(bridgeSource).toContain('this.runtimeRegistry.register(new OpenCodeJsonRuntimeAdapter());');
    expect(bridgeSource).toContain("'Codex 已启动，正在处理当前问题。'");
    expect(bridgeSource).toContain("runtimeId === 'pi' ? 'Pi Agent' : 'OpenCode'");
    expect(bridgeSource).toContain('runtimeDisplayName,');
    expect(bridgeSource).not.toContain('`**${runtimeDisplayName}**`');
    expect(bridgeSource).not.toContain('编程 Agent');
  });

  it('uses one-time bootstrap prompts, lazy tools and one final usage snapshot', () => {
    expect(bridgeSource).toContain('buildPortableAgentResumePrompt(');
    expect(bridgeSource).toContain('resumePrompt,');
    expect(bridgeSource).toContain('const finalRuntimeUsage = result.usage || latestRuntimeUsage;');
    expect(bridgeSource).toContain('if (finalRuntimeUsage) options.onUsage?.(finalRuntimeUsage);');
    expect(bridgeSource).not.toContain('if (result.usage) options.onUsage?.(result.usage);');
    expect(bridgeSource).toContain('CODEX_AUTO_COMPACT_INPUT_TOKEN_THRESHOLD = 120_000');
    expect(bridgeSource).toContain("PORTABLE_AGENT_BOOTSTRAP_VERSION = '2026-08-26-query-first-v3'");
    expect(bridgeSource).toContain('`${runtimeId}:${PORTABLE_AGENT_BOOTSTRAP_VERSION}:${buildCodexConversationIdentityKey(options, workspaceRoot)}`');
    expect(bridgeSource).toContain('this.runtimeRegistry.dispose(runtimeId, previousConversationKey);');
    expect(bridgeSource).toContain('isCodingAgentContextOverflowError(error)');
    expect(bridgeSource).toContain('await this.runtimeRegistry.resetContext(runtimeId, conversationKey);');
    expect(bridgeSource).toContain('resumePrompt: undefined');
    expect(routeSource).toContain('const userMcpGatewayTools = userMcpTools.length > 0 ? getMcpGatewayToolDefinitions() : [];');
    expect(routeSource).toContain('先调用 list_user_mcp_tools 按任务发现工具');
    expect(routeSource).toContain('getListHarnessCapabilitiesToolDefinition()');
    expect(routeSource).toContain('isAgentCapabilityInventoryRequest(input.userMessage)');
    expect(routeSource).toContain('agentCapabilitySignature,');
    expect(bridgeSource).toContain("options.agentCapabilitySignature || 'tool-free'");
    expect(routeSource).toContain('if (shouldUseCodexProvider)');
    expect(routeSource).toContain('skipInitialPlan: directAnswerPreferred');
  });

  it('groups Codex, Pi and OpenCode under one composer and config container', () => {
    const mainPageStart = indexSource.indexOf('<div class="composer-provider-main-page">');
    const runtimePageStart = indexSource.indexOf('<div class="composer-codex-options" id="composerCodexOptions"');
    const mainPage = indexSource.slice(mainPageStart, runtimePageStart);
    const runtimePageEnd = indexSource.indexOf('<div class="composer-codex-options" id="composerMainChatOptions"', runtimePageStart);
    const runtimePage = indexSource.slice(runtimePageStart, runtimePageEnd);

    expect(mainPage).toContain('data-provider="coding-agent"');
    expect(mainPage).not.toContain('data-provider="codex"');
    expect(mainPage).not.toContain('data-provider="pi"');
    expect(mainPage).not.toContain('data-provider="opencode"');
    expect(runtimePage).toContain('data-provider="codex"');
    expect(runtimePage).toContain('data-provider="pi"');
    expect(runtimePage).toContain('data-provider="opencode"');
    expect(publicSource).toContain('function openComposerCodingAgentContainer(event)');
    expect(configCenterSource).toContain('function configCenterCodexRuntimeHtml(');
    expect(configCenterSource).toContain('configCenterCodexRuntimeHtml(currentCodexModel, currentCodexEffort, currentCodexConcurrency)');
    expect(configCenterSource).not.toContain('<strong>Codex CLI</strong>');
    expect(configCenterSource).toContain('agent_runtimes: payload');
    expect(routeSource).toContain('agentRuntimesConfig.codex');
  });

  it('rejects unknown runtime identifiers before they reach process spawning', () => {
    const result = validate(chatRequestSchema, {
      message: 'run',
      agentRuntime: 'shell-template',
    });

    expect(result.success).toBe(false);
  });

  it('requires an explicit confirmation before deploying a CLI', () => {
    expect(validate(runtimeInstallRequestSchema, { confirmed: true }).success).toBe(true);
    expect(validate(runtimeInstallRequestSchema, { confirmed: false }).success).toBe(false);
    expect(validate(runtimeInstallRequestSchema, {}).success).toBe(false);
  });
});
