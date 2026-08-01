import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const validation = readFileSync(
  path.resolve(__dirname, '../../src/bridge/chat-bridge/validation.ts'),
  'utf-8',
);
const chatBridge = readFileSync(
  path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
  'utf-8',
);
const chatBridgeRoute = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'),
  'utf-8',
);
const metaRoute = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/meta-analysis.ts'),
  'utf-8',
);
const localServer = readFileSync(
  path.resolve(__dirname, '../../src/server/local-server.ts'),
  'utf-8',
);

describe('composer Codex model and reasoning selection', () => {
  it('renders model and reasoning controls inside the shared composer menu', () => {
    expect(html).toContain('id="composerCodexModelSelect"');
    expect(html).toContain('id="composerCodexEffortSelect"');
    expect(html).toContain('Reasoning Effort');
    expect(html).toContain("fetch('/api/chat-bridge/codex/models?_='");
    expect(html).toContain("selectComposerCodexProvider(event)");
    expect(html).toContain("selector.classList.toggle('codex-flyout-open'");
    expect(html).not.toContain('.composer-provider-selector.open.codex-flyout-open #composerProviderMenu');
    expect(html).toContain('var composerCodexFlyoutOpen = false;');
    expect(html).toContain("&& composerCodexFlyoutOpen");
    expect(html).toContain("var shouldOpen = !selector.classList.contains('open');");
    expect(html).toContain('composerCodexFlyoutOpen = true;');
    expect(html).not.toContain('function positionComposerProviderMenuForCodexFlyout()');
    expect(html).toContain('width: min(272px, calc(100vw - 32px));');
    expect(html).toContain('left: 0;');
    expect(html).toContain('bottom: 0;');
    expect(html).toContain('class="composer-provider-main-page"');
    expect(html).toContain('class="composer-codex-back-btn"');
    expect(html).toContain('onclick="backToComposerProviderMenu(event)"');
    expect(html).toContain("menu.classList.toggle('codex-page-open', expanded)");
    expect(html).toContain('function backToComposerProviderMenu(event)');
    expect(html).toContain('function dedupeComposerCodexModels(models)');
    expect(html).toContain('composerCodexModels = dedupeComposerCodexModels(data.models);');
    expect(html).toContain('aliases.indexOf(normalizedModel) !== -1');
  });

  it('persists the selection and includes it in homepage and Meta requests', () => {
    expect(html).toContain('function flushComposerCodexSelectionSave()');
    expect(html).toContain('chatBridgeRequestBody.codexModel = composerCodexSelection.model');
    expect(html).toContain('chatBridgeRequestBody.codexReasoningEffort = composerCodexSelection.reasoningEffort');
    expect(html).toContain('requestBody.codexModel = composerCodexSelection.model');
    expect(html).toContain('requestBody.codexReasoningEffort = composerCodexSelection.reasoningEffort');
  });

  it('validates and applies per-request Codex overrides end to end', () => {
    expect(validation).toContain('codexModel: z.string().max(200).optional()');
    expect(validation).toContain("codexReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional()");
    expect(chatBridgeRoute).toContain('codexModel,');
    expect(chatBridgeRoute).toContain('codexReasoningEffort,');
    expect(chatBridge).toContain("const codexModel = String(options.codexModel || codexConfig.model || '').trim()");
    expect(chatBridge).toContain('const codexReasoningEffort = options.codexReasoningEffort || codexConfig.reasoning_effort');
    expect(metaRoute).toContain('codexModel: codexModel || undefined');
    expect(localServer).toContain('codexModel: input.codexModel');
    expect(localServer).toContain('codexReasoningEffort: input.codexReasoningEffort');
  });
});
