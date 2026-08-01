import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createLiteratureCollectionRouter,
  executeLiteratureCollectionAgentToolCall,
  getLiteratureCollectionAgentToolDefinitions,
} from '../../src/server/routes/literature-collection';

describe('literature collection Agent tool', () => {
  let dataDir = '';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-literature-agent-'));
    createLiteratureCollectionRouter({
      dataDir,
      getPlannerRuntime: () => ({
        configured: false,
        apiUrl: '',
        apiKey: '',
        model: '',
        label: 'unconfigured',
      }),
    });
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('exposes one-click topic collection to the main Agent', async () => {
    const definitions = getLiteratureCollectionAgentToolDefinitions();
    expect(definitions.map(item => item.function.name)).toContain('collect_literature_by_topic');

    const result = await executeLiteratureCollectionAgentToolCall({
      id: 'collect-topic-test',
      type: 'function',
      function: {
        name: 'collect_literature_by_topic',
        arguments: JSON.stringify({
          topic: '极端降雨对农田土壤 N2O 排放及氮循环微生物的影响',
        }),
      },
    }, 'tester', {
      verifiedPrimaryIntent: 'literature_collection',
      userMessage: '帮我采集极端降雨对农田土壤 N2O 排放及氮循环微生物影响的文献',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('configuration-required');
    expect(result.jobCreated).toBe(false);
    expect(result.job).toBeUndefined();
    expect(result.summary).toContain('尚未创建');
    expect(result.wosQuery).toContain('TS=(');
    expect(result.actionRequired).toContain('尚未创建');
  });

  it('blocks the collection tool when unified Query Intent did not authorize it', async () => {
    const result = await executeLiteratureCollectionAgentToolCall({
      id: 'unauthorized-collection',
      type: 'function',
      function: {
        name: 'collect_literature_by_topic',
        arguments: JSON.stringify({ topic: '华北平原玉米相关研究' }),
      },
    }, 'tester', {
      verifiedPrimaryIntent: 'general_chat',
      userMessage: '介绍一下华北平原玉米研究',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('QUERY_INTENT_BLOCKED');
  });

  it('does not let the Agent silently switch a generic collection request from WoS to CNKI', async () => {
    const result = await executeLiteratureCollectionAgentToolCall({
      id: 'attempted-cnki-fallback',
      type: 'function',
      function: {
        name: 'collect_literature_by_topic',
        arguments: JSON.stringify({
          topic: '华北平原玉米相关研究',
          source: 'cnki',
        }),
      },
    }, 'tester', {
      verifiedPrimaryIntent: 'literature_collection',
      userMessage: '给我去采集华北平原玉米相关的研究',
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('configuration-required');
    expect(result.job).toBeUndefined();
  });

  it('uses CNKI only when the current user request explicitly names CNKI or 知网', async () => {
    const result = await executeLiteratureCollectionAgentToolCall({
      id: 'explicit-cnki-collection',
      type: 'function',
      function: {
        name: 'collect_literature_by_topic',
        arguments: JSON.stringify({
          topic: '华北平原玉米相关研究',
          source: 'auto',
        }),
      },
    }, 'tester', {
      verifiedPrimaryIntent: 'literature_collection',
      userMessage: '从知网采集华北平原玉米相关研究',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('awaiting-user');
    expect(result.job).toMatchObject({ source: 'cnki-assisted' });
  });

  it('blocks a second collection-tool invocation in the same Agent turn', async () => {
    const result = await executeLiteratureCollectionAgentToolCall({
      id: 'duplicate-collection',
      type: 'function',
      function: {
        name: 'collect_literature_by_topic',
        arguments: JSON.stringify({ topic: '华北平原玉米相关研究' }),
      },
    }, 'tester', {
      verifiedPrimaryIntent: 'literature_collection',
      userMessage: '给我去采集华北平原玉米相关的研究',
      duplicateAttempt: true,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe('blocked');
    expect(result.code).toBe('DUPLICATE_COLLECTION_BLOCKED');
  });
});
