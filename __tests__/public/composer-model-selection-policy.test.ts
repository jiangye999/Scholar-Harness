import vm from 'node:vm';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const appSource = readPublicAppSource();

describe('composer model selection policy', () => {
  it('uses the requested English provider names throughout the composer', () => {
    expect(appSource).toContain("secondary: 'Little corse'");
    expect(appSource).toContain("primary: 'Free corse'");
    expect(appSource).toContain('composer-provider-option-role">Little corse</strong>');
    expect(appSource).toContain('composer-provider-option-role">Free corse</strong>');
    expect(appSource).toContain('composer-provider-option-role">Agent corse</strong>');
  });

  it('renders complete provider model controls in the model-pool editor', () => {
    expect(appSource).toContain('class="mp-model-input"');
    expect(appSource).toContain('class="mp-fetch-models"');
    expect(appSource).toContain('class="mp-model-select"');
    expect(appSource).toContain('class="mp-fetch-result"');
  });

  it('renders Grass with OpenRouter free-model discovery', () => {
    expect(appSource).toContain('Grass · OpenRouter 免费模型');
    expect(appSource).toContain("modelHint: 'openrouter/free'");
    expect(appSource).toContain('apiUrl: OPENROUTER_API_URL');
    expect(appSource).toContain('粘贴 OpenRouter API Key 后会自动加载并筛选支持 Agent 工具的免费模型');
    expect(appSource).toContain("data.freeOnly");
    expect(appSource).toContain("e.target.classList.contains('mp-api-key')");
  });

  it('offers separate text and vision provider/model selection for the secondary agent', () => {
    expect(appSource).toContain('文本厂商 / 模型');
    expect(appSource).toContain('视觉厂商 / 模型');
    expect(appSource).toContain("composerMainChatView = 'providers'");
    expect(appSource).toContain('openComposerMainChatVendorModels');
  });

  it('binds the selected pool entry to the chat request and waits for persistence', () => {
    expect(appSource).toContain('chatBridgeRequestBody.modelId = composerPoolSelection.id');
    expect(appSource).toContain('await window.flushComposerMainChatSelectionSave()');
    expect(appSource).toContain('if (!hasBridgeSecondaryConfig && apiConfig.url && apiConfig.key)');
    expect(appSource).not.toContain('if (apiConfig.url && apiConfig.key) {\n                chatBridgeRequestBody.apiUrl = apiConfig.url;');
  });

  it('uses a configured model pool before legacy display state for the secondary label', () => {
    const functionStart = appSource.indexOf('function getConfiguredSecondaryModelLabel()');
    const functionEnd = appSource.indexOf('function getConfiguredPrimaryModelLabel()', functionStart);
    const source = appSource.slice(functionStart, functionEnd);
    expect(source.indexOf('getComposerPoolActive(textConfig.pool)')).toBeGreaterThan(-1);
    expect(source).toContain('isComposerApiEntryConfigured(textActive, textConfig)');
    expect(source).toContain("if (!textModel && !visionModel) return '未配置'");
    expect(source).not.toContain("|| currentModel || 'qwen3.5-plus'");
  });

  it('does not present compatibility fallback models as user configuration', () => {
    expect(appSource).toContain('function isComposerApiEntryConfigured(entry, config)');
    expect(appSource).toContain("return String(model || '').trim() || '未配置'");
    expect(appSource).toContain("if (codex.enabled !== true) return '未配置'");
    expect(appSource).toContain("runtime && String(runtime.model || '').trim()");
    expect(appSource).toContain('v=1.0.9-composer-unconfigured-state');
  });

  it('computes unconfigured and hydrated provider labels from real configuration state', () => {
    const labelsStart = appSource.indexOf('function getConfiguredSecondaryModelLabel()');
    const labelsEnd = appSource.indexOf("var COMPOSER_PROVIDER_KEY =", labelsStart);
    const poolsStart = appSource.indexOf('function getComposerPoolModels(pool)');
    const poolsEnd = appSource.indexOf('function composerModelDisplayName', poolsStart);
    const context = {
      chatBridgeConfig: {
        primary: { apiUrl: 'https://openrouter.ai/api/v1', hasApiKey: false, model: 'openrouter/free' },
        secondary: { apiUrl: '', hasApiKey: false, model: 'gpt-4o' },
        secondaryVision: { apiUrl: '', hasApiKey: false, model: 'gpt-4o' },
        codex: { enabled: false, model: 'gpt-5.5', reasoning_effort: 'xhigh' },
      },
      apiConfig: { url: '', key: '', model: 'gpt-4o' },
    };
    vm.runInNewContext(
      `${appSource.slice(poolsStart, poolsEnd)}\n${appSource.slice(labelsStart, labelsEnd)}\n`
        + 'this.getLabels = function() { return {'
        + 'secondary: getConfiguredSecondaryModelLabel(), '
        + 'primary: getConfiguredPrimaryModelLabel(), '
        + 'codex: getConfiguredCodexModelLabel() }; };',
      context,
    );

    expect((context as any).getLabels()).toEqual({
      secondary: '未配置',
      primary: '未配置',
      codex: '未配置',
    });

    context.chatBridgeConfig = {
      primary: {
        apiUrl: 'https://openrouter.ai/api/v1',
        hasApiKey: true,
        model: 'vendor/free-model:free',
        pool: {
          active_model_id: 'grassland-1',
          models: [{ id: 'grassland-1', model: 'vendor/free-model:free', api_url: 'https://openrouter.ai/api/v1', has_api_key: true }],
        },
      },
      secondary: {
        apiUrl: 'https://provider.example/v1',
        hasApiKey: true,
        model: 'configured-text-model',
        pool: {
          active_model_id: 'secondary-1',
          models: [{ id: 'secondary-1', model: 'configured-text-model', api_url: 'https://provider.example/v1', has_api_key: true }],
        },
      },
      secondaryVision: {},
      codex: { enabled: true, model: 'configured-codex-model', reasoning_effort: 'high' },
    };
    expect((context as any).getLabels()).toEqual({
      secondary: 'configured-text-model',
      primary: 'vendor/free-model:free',
      codex: 'configured-codex-model high',
    });
  });

  it('hydrates the complete saved model configuration before the cold-start request and repaints afterward', () => {
    const loadStart = appSource.indexOf('async function loadChatBridgeConfig()');
    const loadEnd = appSource.indexOf('function updateChatBridgeButton()', loadStart);
    const loadSource = appSource.slice(loadStart, loadEnd);
    expect(appSource).toContain('function hydrateChatBridgeConfigFromStorage()');
    expect(appSource).toContain('function persistChatBridgeConfigSnapshot()');
    expect(loadSource.indexOf('hydrateChatBridgeConfigFromStorage();')).toBeGreaterThan(-1);
    expect(loadSource.indexOf("fetch('/api/chat-bridge/config', { cache: 'no-store' })"))
      .toBeGreaterThan(loadSource.indexOf('hydrateChatBridgeConfigFromStorage();'));
    expect(loadSource).toContain('if (loadedServerConfig) persistChatBridgeConfigSnapshot();');
    const initStart = appSource.indexOf('function initApp()');
    const recoverStart = appSource.indexOf('recoverLocalConversationsIntoHistory();', initStart);
    const bootstrapStart = appSource.indexOf('var composerConfigBootstrap = Promise.resolve(loadChatBridgeConfig())', initStart);
    expect(bootstrapStart).toBeGreaterThan(initStart);
    expect(bootstrapStart).toBeLessThan(recoverStart);
    expect(appSource).toContain('window.composerConfigBootstrap = composerConfigBootstrap;');
    expect(appSource).toContain('v=1.0.9-composer-bootstrap-first');
  });
});
