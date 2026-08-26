import { describe, expect, it } from 'vitest';

import {
  getResearchEnhancementToolDefinitions,
  RESEARCH_ENHANCEMENT_AGENT_GUIDANCE,
} from '../../../src/server/routes/chat-bridge';

describe('ChatBridge research enhancement MCP tools', () => {
  it('exposes the complete research enhancement tool catalogue', () => {
    const names = getResearchEnhancementToolDefinitions().map(tool => tool.function.name);

    expect(names).toEqual([
      'research_build_evidence_ledger',
      'research_run_reviewer',
      'research_export_reproducibility_bundle',
      'research_sync_obsidian',
      'research_search_obsidian',
      'research_prepare_submission',
    ]);
  });

  it('requires the identifying inputs for knowledge search and submission preparation', () => {
    const tools = getResearchEnhancementToolDefinitions();
    const search = tools.find(tool => tool.function.name === 'research_search_obsidian');
    const submission = tools.find(tool => tool.function.name === 'research_prepare_submission');

    expect(search?.function.parameters?.required).toEqual(['query']);
    expect(submission?.function.parameters?.required).toEqual(['targetJournal']);
  });

  it('asks for confirmation before starting optional post-writing analyses', () => {
    expect(RESEARCH_ENHANCEMENT_AGENT_GUIDANCE).toContain('必须先询问并得到用户同意');
    expect(RESEARCH_ENHANCEMENT_AGENT_GUIDANCE).toContain('再调用 invoke_capability');
    expect(RESEARCH_ENHANCEMENT_AGENT_GUIDANCE).toContain('禁止把 research_* 名称当作直接 tool call 输出');
    expect(RESEARCH_ENHANCEMENT_AGENT_GUIDANCE).toContain('结果会自动保存并显示在“科研增强工具”界面');
    expect(RESEARCH_ENHANCEMENT_AGENT_GUIDANCE).toContain('只有工具返回 ok=true');
  });
});
