import { describe, expect, it } from 'vitest';

import {
  CAPABILITIES_MANIFEST,
  buildHarnessCapabilitySignature,
  formatHarnessCapabilityInventory,
  getInvokeCapabilityToolDefinition,
  getListHarnessCapabilitiesToolDefinition,
  getReadCapabilitiesToolDefinition,
  isListHarnessCapabilitiesToolName,
  isReadCapabilitiesToolName,
  rewriteInvokeCapabilityCall,
} from '../../../src/server/services/agent-capabilities';
import type { LLMToolCall } from '../../../src/utils/llm-client';

function makeCall(name: string, args: string): LLMToolCall {
  return { id: `call-${name}`, type: 'function', function: { name, arguments: args } } as LLMToolCall;
}

describe('agent capabilities manifest', () => {
  it('exposes a compact read_capabilities + invoke_capability entry pair', () => {
    const list = getListHarnessCapabilitiesToolDefinition();
    const read = getReadCapabilitiesToolDefinition();
    const invoke = getInvokeCapabilityToolDefinition();
    expect(list.function.name).toBe('list_harness_capabilities');
    expect(isListHarnessCapabilitiesToolName('list_harness_capabilities')).toBe(true);
    expect(read.function.name).toBe('read_capabilities');
    expect(invoke.function.name).toBe('invoke_capability');
    expect(isReadCapabilitiesToolName('read_capabilities')).toBe(true);
    expect(isReadCapabilitiesToolName('invoke_capability')).toBe(false);
  });

  it('formats a real-time inventory and changes its signature with user configuration', () => {
    const inventory = {
      skills: [{
        id: 'user:review',
        name: 'Review',
        description: 'Review a manuscript',
        category: 'writing',
        source: 'user' as const,
        sourceLabel: 'User Skill',
        manualTrigger: 'review',
      }],
      mcpPlugins: [{
        id: 'browser-assist',
        name: 'Browser Assist MCP',
        description: 'Visible browser',
        enabled: true,
        status: 'ready' as const,
        risk: 'network' as const,
        updatedAt: '2026-08-18T00:00:00.000Z',
        tools: [{ name: 'browser_navigate', description: 'Navigate' }],
      }],
    };
    const formatted = formatHarnessCapabilityInventory(inventory);
    expect(formatted.content).toContain('user:review');
    expect(formatted.content).toContain('Browser Assist MCP');
    expect(formatted.content).toContain('list_user_mcp_tools');
    const firstSignature = buildHarnessCapabilitySignature(inventory);
    const timestampOnlySignature = buildHarnessCapabilitySignature({
      ...inventory,
      mcpPlugins: inventory.mcpPlugins.map(plugin => ({
        ...plugin,
        updatedAt: '2099-01-01T00:00:00.000Z',
      })),
    });
    const changedSignature = buildHarnessCapabilitySignature({
      ...inventory,
      mcpPlugins: inventory.mcpPlugins.map(plugin => ({ ...plugin, enabled: false })),
    });
    expect(firstSignature).toMatch(/^[a-f0-9]{20}$/);
    expect(timestampOnlySignature).toBe(firstSignature);
    expect(changedSignature).not.toBe(firstSignature);
  });

  it('manifests the specialized domain capabilities as readable text', () => {
    [
      'utility_sentence_claim_search',
      'utility_data_analysis',
      'utility_r_plot',
      'utility_flowchart_generate',
      'utility_ppt_generate',
      'meta_inspect_selected_dataset',
      'meta_run_selected_analysis',
      'research_build_evidence_ledger',
      'research_run_reviewer',
      'research_export_reproducibility_bundle',
      'research_sync_obsidian',
      'research_search_obsidian',
      'research_prepare_submission',
      'search_local_literature',
      'read_page_context',
      'search_email_database',
      'read_email_message',
      'query_email_knowledge_graph',
      'collect_literature_by_topic',
    ].forEach(capability => expect(CAPABILITIES_MANIFEST).toContain(capability));
  });

  it('rewrites invoke_capability into the target tool call', () => {
    const rewritten = rewriteInvokeCapabilityCall(makeCall(
      'invoke_capability',
      JSON.stringify({ capability: 'utility_r_plot', args: { filePath: 'data.csv', chartType: 'boxplot' } }),
    ));
    expect(rewritten).not.toBeNull();
    expect(rewritten!.function.name).toBe('utility_r_plot');
    expect(JSON.parse(rewritten!.function.arguments)).toEqual({ filePath: 'data.csv', chartType: 'boxplot' });
  });

  it('leaves non-invoke calls untouched and rejects malformed capability calls', () => {
    const plain = rewriteInvokeCapabilityCall(makeCall('read_file', '{"path":"a.txt"}'));
    expect(plain!.function.name).toBe('read_file');
    expect(rewriteInvokeCapabilityCall(makeCall('invoke_capability', 'not-json'))).toBeNull();
    expect(rewriteInvokeCapabilityCall(makeCall('invoke_capability', '{"args":{}}'))).toBeNull();
  });
});
