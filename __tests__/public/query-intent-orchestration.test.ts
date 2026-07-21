import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readFileSync(path.join(repoRoot, 'src/public/index.html'), 'utf-8');
const route = readFileSync(path.join(repoRoot, 'src/server/routes/chat-bridge.ts'), 'utf-8');
const retrievalServer = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');
const systemPrompt = readFileSync(path.join(repoRoot, 'src/server/services/chat-system-prompt.ts'), 'utf-8');
const codexBridge = readFileSync(path.join(repoRoot, 'src/bridge/chat-bridge/chat-bridge.ts'), 'utf-8');
const legacyLocalChat = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');
const unifiedProcessor = readFileSync(path.join(repoRoot, 'src/server/unified-chat-processor.ts'), 'utf-8');
const taskOrchestrator = readFileSync(path.join(repoRoot, 'src/orchestrator/task-orchestrator.ts'), 'utf-8');

describe('unified main-chat query intent orchestration', () => {
  it('classifies against conversation and workspace context before preparing the main request', () => {
    expect(html).toContain('async function classifyMainChatQueryIntent(message, routingInput, onProgress)');
    expect(html).toContain("fetch('/api/chat-bridge/query-intent'");
    expect(html).toContain('var recentIntentHistory = (Array.isArray(routingInput.history) ? routingInput.history : [])');
    expect(html).toContain('history: recentIntentHistory');
    expect(html).toContain('workspaceFileMentions: workspaceFileMentions');
    expect(html).toContain('chatBridgeContext.queryIntent');
    expect(
      html.indexOf('var queryIntent = await classifyMainChatQueryIntent(intentMessage, routingInput, onProgress);')
    ).toBeLessThan(html.indexOf('var autonomousRetrieval = await runAutonomousRetrievalForMessage('));
  });

  it('only runs autonomous literature retrieval when the unified intent explicitly permits it', () => {
    expect(html).toContain('queryIntent.needsLiteratureRetrieval !== true');
    expect(html).toContain('queryIntent && queryIntent.needsLiteratureRetrieval === true');
    expect(html).toContain('queryIntent: queryIntent');
    expect(retrievalServer).toContain('routedIntentRecord?.needsLiteratureRetrieval !== true');
    expect(retrievalServer).toContain("detectionProvider: 'query-intent-router'");
    expect(html).not.toContain('async function detectAndTriggerRetrieval(');
  });

  it('validates the intent again on the main endpoint and supplies it to every provider', () => {
    expect(route).toContain("router.post('/query-intent'");
    expect(route).toContain('parseQueryIntentResponse(JSON.stringify(submittedQueryIntent), queryIntentInput)');
    expect(route).toContain('buildQueryIntentPromptBlock(context.queryIntent)');
    expect(systemPrompt).toContain('workspace_file 与 literature_retrieval 必须严格区分');
    expect(codexBridge).toContain('function buildCodexQueryIntentSummary(options: ChatOptions)');
    expect(codexBridge).toContain('queryIntentSummary');
  });

  it('has no independent broad search-keyword classifier in legacy chat entry points', () => {
    expect(legacyLocalChat).not.toContain('LocalChatDecision');
    expect(legacyLocalChat).not.toContain('"need_web_search"');
    expect(unifiedProcessor).not.toContain('UnifiedChatDecision');
    expect(unifiedProcessor).not.toContain('"need_web_search"');
    expect(taskOrchestrator).not.toContain('hasSearchKeywords');
    expect(taskOrchestrator).toContain('queryIntent.needsWebSearch');
  });

  it('enforces literature authorization again at tool-execution boundaries', () => {
    expect(route).toContain('function isLiteratureRetrievalAuthorized(context: any)');
    expect(route).toContain('Blocked sentence_search because verified Query Intent');
    expect(legacyLocalChat).toContain('!queryIntent.needsLiteratureRetrieval');
    expect(unifiedProcessor).toContain('allowLiteratureRetrieval: queryIntent.needsLiteratureRetrieval');
    expect(unifiedProcessor).toContain('!llmConfig.allowLiteratureRetrieval');
  });

  it('fails closed before exposing or executing workspace tools', () => {
    expect(route).toContain("contextForPrompt.queryIntent?.needsWorkspaceSearch === true");
    expect(route).toContain("context?.queryIntent?.needsWorkspaceSearch === true");
    expect(route).toContain('did not authorize workspace access');
  });
});
