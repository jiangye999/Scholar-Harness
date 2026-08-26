import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  executeUtilityAgentToolCall,
  getUtilityAgentToolDefinitions,
  UTILITY_AGENT_TOOL_NAMES,
  type UtilityAgentTransport,
} from '../../../src/server/services/utility-agent-tool-adapter';
import type { LLMToolCall } from '../../../src/utils/llm-client';

function toolCall(name: string, args: Record<string, unknown>): LLMToolCall {
  return {
    id: `test-${name}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  };
}

describe('utility Agent tool adapter', () => {
  let workspaceRoot = '';

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-utility-agent-'));
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it('exposes exactly the five backend-only utility tools without credentials in schemas', () => {
    const definitions = getUtilityAgentToolDefinitions();
    expect(definitions.map(item => item.function.name)).toEqual([...UTILITY_AGENT_TOOL_NAMES]);
    expect(JSON.stringify(definitions)).not.toContain('apiKey');
    expect(JSON.stringify(definitions)).not.toContain('apiUrl');
  });

  it('uses the shared sentence claim endpoint', async () => {
    const requests: Array<{ pathname: string; body: string }> = [];
    const transport: UtilityAgentTransport = async request => {
      requests.push({ pathname: request.pathname, body: request.body?.toString('utf8') || '' });
      return { statusCode: 200, data: { success: true, data: { matches: [] } } };
    };

    const result = await executeUtilityAgentToolCall(toolCall('utility_sentence_claim_search', {
      query: 'Extreme rainfall increases soil N2O emissions.',
      topK: 8,
    }), { userId: 'tester', workspaceRoot, transport });

    expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1);
    expect(requests[0].pathname).toBe('/api/sentence/claim-match');
    expect(JSON.parse(requests[0].body)).toMatchObject({
      query: 'Extreme rainfall increases soil N2O emissions.',
      topK: 8,
      userId: 'tester',
      projectRoot: workspaceRoot,
    });
  });

  it('uses the shared data-analysis endpoint and rejects files outside the workspace', async () => {
    const dataPath = path.join(workspaceRoot, 'analysis.csv');
    fs.writeFileSync(dataPath, 'group,value\nA,1\n', 'utf8');
    const requests: Array<{ pathname: string; contentType: string; body: string }> = [];
    const transport: UtilityAgentTransport = async request => {
      requests.push({
        pathname: request.pathname,
        contentType: request.headers?.['Content-Type'] || '',
        body: request.body?.toString('utf8') || '',
      });
      return { statusCode: 200, data: { success: true, data: { columns: ['group', 'value'] } } };
    };

    const result = await executeUtilityAgentToolCall(toolCall('utility_data_analysis', {
      action: 'inspect',
      filePath: 'analysis.csv',
    }), { userId: 'tester', workspaceRoot, transport });

    expect(result.ok).toBe(true);
    expect(requests[0].pathname).toBe('/api/data-analysis/inspect');
    expect(requests[0].contentType).toContain('multipart/form-data; boundary=');
    expect(requests[0].body).toContain('filename="analysis.csv"');

    const escaped = await executeUtilityAgentToolCall(toolCall('utility_data_analysis', {
      filePath: '..\\outside.csv',
    }), { userId: 'tester', workspaceRoot, transport });
    expect(escaped.ok).toBe(false);
    expect(escaped.error).toContain('超出当前授权工作目录');
    expect(requests).toHaveLength(1);
  });

  it('queries PPT job status through the same background-job route used by the page', async () => {
    const transport: UtilityAgentTransport = async request => {
      expect(request.method).toBe('GET');
      expect(request.pathname).toBe('/api/ppt-master/jobs/job%2F42');
      return { statusCode: 200, data: { success: true, data: { status: 'completed' } } };
    };

    const result = await executeUtilityAgentToolCall(toolCall('utility_ppt_generate', {
      operation: 'status',
      jobId: 'job/42',
    }), { userId: 'tester', workspaceRoot, transport });

    expect(result).toMatchObject({ ok: true, toolName: 'utility_ppt_generate' });
  });
});
