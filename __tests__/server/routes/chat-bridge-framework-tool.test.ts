import { describe, expect, it } from 'vitest';

import {
  executeAgentFrameworkProposalTool,
  getAgentFrameworkProposalToolDefinitions,
  isAgentFrameworkProposalToolName,
} from '../../../src/server/routes/chat-bridge';

describe('ChatBridge framework proposal tool', () => {
  it('is only exposed when a project-scoped framework is available', () => {
    expect(getAgentFrameworkProposalToolDefinitions({})).toEqual([]);
    const definitions = getAgentFrameworkProposalToolDefinitions({
      discussionFramework: {
        available: true,
        projectId: 'project-20260820-test',
        planningStatus: 'draft',
        chapters: [],
      },
    });

    expect(definitions.map(definition => definition.function.name)).toEqual(['propose_discussion_framework_update']);
    expect(definitions[0].function.description).toContain('待确认建议');
    expect(definitions[0].function.description).toContain('不会直接覆盖');
  });

  it('recognizes provider namespace variants', () => {
    expect(isAgentFrameworkProposalToolName('propose_discussion_framework_update')).toBe(true);
    expect(isAgentFrameworkProposalToolName('scholar_harness.propose_discussion_framework_update')).toBe(true);
    expect(isAgentFrameworkProposalToolName('save_draft')).toBe(false);
  });

  it('refuses to create a proposal without project framework context', async () => {
    const result = await executeAgentFrameworkProposalTool({
      id: 'framework-call-1',
      type: 'function',
      function: {
        name: 'propose_discussion_framework_update',
        arguments: JSON.stringify({
          summary: '更新框架',
          chapters: [{ title: 'Introduction', subsections: [] }],
        }),
      },
    }, 'user-1', {});

    expect(result).toMatchObject({ ok: false, summary: '论文框架建议未提交' });
  });
});
