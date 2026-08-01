import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const bridgeSource = readFileSync(path.join(repoRoot, 'src/server/routes/chat-bridge.ts'), 'utf-8');
const metaSource = readFileSync(path.join(repoRoot, 'src/server/routes/meta-analysis.ts'), 'utf-8');
const serverSource = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');

describe('Meta analysis shared homepage Agent route', () => {
  it('adds Meta tools to the same dynamic Skill, MCP and workspace tool loop', () => {
    expect(bridgeSource).toContain('const skillTools = skillRuntime.getToolDefinitions();');
    expect(bridgeSource).toContain('const userMcpTools = await getEnabledMcpToolDefinitions();');
    expect(bridgeSource).toContain('const metaAnalysisTools = getMetaAnalysisAgentToolDefinitions(options.draftContext);');
    expect(bridgeSource).toContain(
      '...skillTools, ...draftTools, ...researchEnhancementTools, ...metaAnalysisTools, ...literatureCollectionTools, ...workspaceTools, ...userMcpTools',
    );
    expect(bridgeSource).toContain('await executeMetaAnalysisAgentToolCall(');
  });

  it('makes Meta dataset work model-selected instead of request-preloaded', () => {
    expect(bridgeSource).toContain("name: 'meta_inspect_selected_dataset'");
    expect(bridgeSource).toContain("name: 'meta_run_selected_analysis'");
    expect(bridgeSource).toContain('必须先理解 CURRENT_USER_REQUEST，再决定是否调用 Meta、Skill、MCP');
    expect(metaSource).toContain('export async function executeMetaAnalysisAgentTool(');
    expect(metaSource).toContain('dataset read happens only after the model explicitly selects one of these');
  });

  it('binds shared-agent Meta results to the homepage writing conversation when available', () => {
    expect(metaSource).toContain('conversationId: writingConversationId || conversationId');
  });

  it('registers the Meta executor on the shared ChatBridge singleton', () => {
    expect(serverSource).toContain('executeMetaAnalysisTool: input => executeMetaAnalysisAgentTool(metaAnalysisRouteOptions, input)');
    expect(serverSource).toContain('createMetaAnalysisRouter(metaAnalysisRouteOptions)');
  });
});
