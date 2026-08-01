import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();
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
    expect(html).toContain('var recentIntentHistorySource = (Array.isArray(routingInput.history) ? routingInput.history : []).slice(-8);');
    expect(html).toContain('history: recentIntentHistory');
    expect(html).toContain('workspaceFileMentions: workspaceFileMentions');
    expect(html).toContain('chatBridgeContext.queryIntent');
    expect(html).toContain('var intentTimeoutMs = 23000;');
    expect(html).toContain('任务意图识别超时，已切换本地安全路由并继续执行...');
    expect(route).toContain('const QUERY_INTENT_CLASSIFIER_TIMEOUT_MS = 20_000;');
    expect(route).toContain('shouldUseAiQueryIntentClassifier(classifierInput)');
    expect(route).not.toContain("provider: 'local-rules'");
    expect(html).toContain('contextItems: contextItems');
    expect(html).toContain("type: 'selected_context_sources'");
    expect(html).toContain("type: 'selected_skills'");
    expect(html).toContain("type: 'latest_assistant_result'");
    expect(route).toContain('waitForQueryIntentClassifier');
    expect(html).toContain('var queryIntent = await classifyMainChatQueryIntent(intentMessage, routingInput, onProgress);');
  });

  it('leaves literature retrieval and page reads to the formal Agent tool loop', () => {
    const prepareStart = html.indexOf('async function prepareChatBridgeContext(');
    const prepareEnd = html.indexOf('async function loadBibliometricsWritingContext(', prepareStart);
    const prepare = html.slice(prepareStart, prepareEnd);

    expect(prepare).toContain('正式 Agent 决定何时检索，不预取论文或摘要');
    expect(prepare).toContain('文献检索由正式 Agent 在工具循环中按需调用');
    expect(prepare).not.toContain('await runAutonomousRetrievalForMessage(');
    expect(route).toContain("name: 'search_local_literature'");
    expect(route).toContain("name: 'read_page_context'");
    expect(route).toContain('用户勾选资源表示授权可用，不表示每轮必须读取');
    expect(retrievalServer).toContain('searchLocalLiterature: async');
    expect(retrievalServer).toContain('loadPageContextResource: async');
  });

  it('validates the intent again on the main endpoint and supplies it to every provider', () => {
    expect(route).toContain("router.post('/query-intent'");
    expect(route).toContain('parseQueryIntentResponse(JSON.stringify(submittedQueryIntent), queryIntentInput)');
    expect(route).toContain('buildQueryIntentPromptBlock(context.queryIntent)');
    expect(systemPrompt).toContain('workspace_file、literature_collection 与 literature_retrieval 必须严格区分');
    expect(systemPrompt).toContain('primaryIntent=literature_collection 时，主页聊天输入框暂不开放 WoS/CNKI 外部采集');
    expect(route).toContain('const MAIN_CHAT_EXTERNAL_LITERATURE_COLLECTION_ENABLED = false');
    expect(route).toContain('verifiedCollectionIntent');
    expect(route).toContain('MAIN_CHAT_EXTERNAL_LITERATURE_COLLECTION_ENABLED');
    expect(route).toContain("contextForPrompt.queryIntent?.primaryIntent === 'literature_collection'");
    expect(codexBridge).toContain('function buildCodexQueryIntentSummary(options: ChatOptions)');
    expect(codexBridge).toContain("primaryIntent === 'literature_collection'");
    expect(codexBridge).toContain('queryIntentSummary');
    expect(legacyLocalChat).toContain("taskType = '外部文献采集'");
    expect(unifiedProcessor).toContain("taskType = '外部文献采集'");
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

  it('keeps an explicitly configured workspace available while the model decides whether to use it', () => {
    expect(route).toContain('const workspaceContext = configuredWorkspaceContext;');
    expect(route).toContain('if (context?.workspaceDirectory)');
    expect(route).toContain('because no configured workspace is available');
  });
});
