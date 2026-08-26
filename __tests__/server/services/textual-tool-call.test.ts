import { describe, expect, it } from 'vitest';

import type { LLMToolDefinition } from '../../../src/utils/llm-client';
import {
  partitionTextualToolProgress,
  looksLikeTextualToolCallPrefix,
  recoverTextualToolCalls,
} from '../../../src/server/services/textual-tool-call';

const tools: LLMToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'read_page_context',
      description: 'Read page context',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'file_search',
      description: 'Search files',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          path: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
];

describe('textual tool-call recovery', () => {
  it('recovers the OpenRouter free-model format instead of rendering it as an answer', () => {
    const calls = recoverTextualToolCalls([
      '调用工具： read_page_context',
      '',
      'resourceId: "memory"',
      '',
      'detailLevel: "full"',
    ].join('\n'), tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'memory',
      detailLevel: 'full',
    });
  });

  it('recovers the tool_calls array envelope emitted by Little corse and Grass', () => {
    const content = JSON.stringify({
      tool_calls: [
        {
          id: 'call_read_title',
          name: 'read_page_context',
          arguments: {
            resourceId: 'ordinary-draft',
            detailLevel: 'full',
            query: 'Title 章节标题草稿内容',
          },
        },
        {
          id: 'call_read_memory',
          name: 'read_page_context',
          arguments: {
            resourceId: 'memory',
            detailLevel: 'full',
            query: 'writing_progress pending_chapters 当前标题相关记忆',
          },
        },
      ],
    });

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.id)).toEqual(['call_read_title', 'call_read_memory']);
    expect(calls.map(call => call.function.name)).toEqual(['read_page_context', 'read_page_context']);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
      focus: 'Title 章节标题草稿内容',
    });
  });

  it('holds a tool_calls array envelope out of streamed chat text', () => {
    const content = '我先读取标题。\n{"tool_calls":[{"id":"call_title","name":"read_page_context","arguments":{"resourceId":"ordinary-draft"}}]}';
    const partition = partitionTextualToolProgress(content, tools);

    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toBe('我先读取标题。\n');
    expect(partition.pending).toContain('"tool_calls"');
  });

  it('does not execute unknown or example tool_calls array envelopes', () => {
    expect(recoverTextualToolCalls(
      '{"tool_calls":[{"name":"delete_everything","arguments":{"path":"/"}}]}',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '下面是示例：\n{"tool_calls":[{"name":"read_page_context","arguments":{"resourceId":"memory"}}]}',
      tools,
    )).toEqual([]);
  });

  it('recovers the repeated ScholarHarness line format without rendering it', () => {
    const content = [
      '我来读取当前论文的标题草稿。',
      'ScholarHarness read_page_context resourceId=discussion-framework detailLevel=full',
      'ScholarHarness read_page_context resourceId=memory detailLevel=full',
      'ScholarHarness read_page_context resourceId=ordinary-draft detailLevel=full',
    ].join('\n');

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(3);
    expect(calls.every(call => call.function.name === 'read_page_context')).toBe(true);
    expect(calls.map(call => JSON.parse(call.function.arguments))).toEqual([
      { resourceId: 'discussion-framework', detailLevel: 'full' },
      { resourceId: 'memory', detailLevel: 'full' },
      { resourceId: 'ordinary-draft', detailLevel: 'full' },
    ]);
  });

  it('recovers an inline Chinese tool label glued to its parameters', () => {
    const content = '我来帮您查看当前的论文标题。根据项目状态，Title 章节已有草稿，让我读取一下当前的标调用工具: read_page_context参数: {"resourceId":"ordinary-draft","detailLevel":"full","keys":["title"]}';

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
      focus: 'title',
    });
  });

  it('recovers the newline format after a let-me-read narrative', () => {
    const content = [
      '让我读取当前 Title 章节的草稿内容。',
      '调用工具: read_page_context',
      '参数: {"resourceId":"ordinary-draft","keys":["title"],"detailLevel":"full"}',
    ].join('\n');

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
      focus: 'title',
    });
  });

  it('recovers the reported parenthesized call and normalizes invented aliases', () => {
    const content = '我来为您读取当前论文标题章节的草稿内容。调用工具: read_page_context(resourceId="ordinary-draft", detailLevel="full", sectionKey="title")';

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
      focus: 'title',
    });
  });

  it('recovers the exact Little corse/Grass title lookup reported by the user', () => {
    const content = '我来帮您查看当前论文的标题。根据上下文显示，Title 章节已有草稿，让我读取一下当前的标题内容。调用工具: read_page_context(resourceId="ordinary-draft", detailLevel="full")';

    const calls = recoverTextualToolCalls(content, tools);
    const partition = partitionTextualToolProgress(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
    });
    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).not.toContain('调用工具');
    expect(partition.pending).toContain('read_page_context');
  });

  it('recovers a title lookup carrying a nested options object', () => {
    const content = '我来为您读取当前论文标题章节的草稿内容。调用工具: read_page_context(resourceId="ordinary-draft", detailLevel="full", options={"chapterKey": "title"})';
    const calls = recoverTextualToolCalls(content, tools);
    const partition = partitionTextualToolProgress(content, tools);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
      focus: 'title',
    });
    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).not.toContain('调用工具');
    expect(partition.pending).toContain('read_page_context');
  });

  it('recovers a prose-glued tool_calls envelope for the discussion framework', () => {
    const content = '我来帮您查看当前论文的标题。根据框架显示，Title 章节已有草稿，让我读取一下具体{"tool_calls": [{"id": "call_1", "name": "read_page_context", "arguments": {"resourceId": "discussion-framework", "detailLevel": "full"}}]}';

    const calls = recoverTextualToolCalls(content, tools);
    const partition = partitionTextualToolProgress(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].id).toBe('call_1');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'discussion-framework',
      detailLevel: 'full',
    });
    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).not.toContain('tool_calls');
    expect(partition.pending).toContain('tool_calls');
  });

  it('recovers, hides, and deduplicates repeated dot-tool-call envelopes', () => {
    const readFramework = '.tool_call:{"name":"read_page_context","arguments":{"resourceId":"discussion-framework","detailLevel":"full"}}';
    const searchTitle = '.tool_call:{"name":"file_search","arguments":{"pattern":"title","scope":"current"}}';
    const content = [
      '我来帮您查看当前论文的标题。首先让我读取项目的框架资源和现有的标题草稿。',
      readFramework,
      searchTitle,
      readFramework,
      '工具调用已发送，等待结果...',
      searchTitle,
    ].join('');

    const calls = recoverTextualToolCalls(content, tools);
    const partition = partitionTextualToolProgress(content, tools);

    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.function.name)).toEqual(['read_page_context', 'file_search']);
    expect(JSON.parse(calls[1].function.arguments)).toEqual({
      query: 'title',
      scope: 'current',
    });
    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).not.toContain('.tool_call:');
    expect(partition.pending).toContain('.tool_call:');
  });

  it('bounds dot-tool-call batches and rejects unknown or example envelopes', () => {
    const manyCalls = Array.from({ length: 24 }, (_, index) =>
      `.tool_call:{"name":"read_page_context","arguments":{"resourceId":"memory","focus":"item-${index}"}}`,
    ).join('');

    expect(recoverTextualToolCalls(`我来读取需要的项目上下文。${manyCalls}`, tools)).toHaveLength(16);
    expect(recoverTextualToolCalls(
      '我来执行。.tool_call:{"name":"delete_everything","arguments":{"path":"/"}}',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '下面是示例：.tool_call:{"name":"read_page_context","arguments":{"resourceId":"memory"}}',
      tools,
    )).toEqual([]);
  });

  it('holds parenthesized registered calls out of streamed chat text', () => {
    const content = '我来读取当前标题。调用工具: read_page_context(resourceId="ordinary-draft", detailLevel="full")';
    const partition = partitionTextualToolProgress(content, tools);

    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toBe('我来读取当前标题。');
    expect(partition.pending).toContain('调用工具: read_page_context(');
  });

  it('recovers direct function syntax and named JSON/XML envelopes', () => {
    const direct = recoverTextualToolCalls(
      'read_page_context(resourceId="ordinary-draft", focus="title, abstract")',
      tools,
    );
    const envelope = recoverTextualToolCalls(
      '<tool_call>{"name":"read_page_context","arguments":{"resourceId":"memory","detailLevel":"full"}}</tool_call>',
      tools,
    );

    expect(JSON.parse(direct[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      focus: 'title, abstract',
    });
    expect(JSON.parse(envelope[0].function.arguments)).toEqual({
      resourceId: 'memory',
      detailLevel: 'full',
    });
  });

  it('hides a prose-glued tagged tool call before executing it', () => {
    const content = '我来读取当前草稿。<tool_call>{"name":"read_page_context","arguments":{"resourceId":"ordinary-draft","detailLevel":"full"}}</tool_call>';
    const calls = recoverTextualToolCalls(content, tools);
    const partition = partitionTextualToolProgress(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toBe('我来读取当前草稿。');
    expect(partition.pending).toContain('<tool_call>');
  });

  it('rejects parenthesized examples, unknown tools, and malformed arguments', () => {
    expect(recoverTextualToolCalls(
      '例如：read_page_context(resourceId="memory")',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '我来执行。delete_everything(path="/")',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '我来读取。read_page_context(resourceId="memory", broken)',
      tools,
    )).toEqual([]);
  });

  it('recovers the reported function/parameter tag protocol', () => {
    const content = '我来为您查看当前论文的标题草稿。<function=read_page_context><parameter=resourceId>ordinary-draft</parameter><parameter=detailLevel>full</parameter><parameter=keys>["title"]</parameter></function>';

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(1);
    expect(calls[0].function.name).toBe('read_page_context');
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      detailLevel: 'full',
      focus: 'title',
    });
  });

  it('holds function/parameter tags out of streamed chat text', () => {
    const content = '我来查看标题。<function=read_page_context><parameter=resourceId>ordinary-draft</parameter></function>';
    const partition = partitionTextualToolProgress(content, tools);

    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toBe('我来查看标题。');
    expect(partition.pending).toContain('<function=read_page_context>');
  });

  it('supports attribute-style tags and multiple registered calls', () => {
    const content = [
      '我来读取需要的上下文。',
      '<function name="read_page_context"><parameter name="resourceId">ordinary-draft</parameter><parameter name="focus">title &amp; abstract</parameter></function>',
      '<function=read_page_context><parameter=resourceId>memory</parameter><parameter=detailLevel>full</parameter></function>',
    ].join('');

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      resourceId: 'ordinary-draft',
      focus: 'title & abstract',
    });
    expect(JSON.parse(calls[1].function.arguments)).toEqual({
      resourceId: 'memory',
      detailLevel: 'full',
    });
  });

  it('rejects tagged examples, unknown functions, and malformed parameters', () => {
    expect(recoverTextualToolCalls(
      '例如：<function=read_page_context><parameter=resourceId>memory</parameter></function>',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '我来执行。<function=delete_everything><parameter=path>/</parameter></function>',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '我来读取。<function=read_page_context><parameter=resourceId>memory</function>',
      tools,
    )).toEqual([]);
  });

  it('holds an inline Chinese tool label out of streamed chat text', () => {
    const content = '我来帮您查看当前的论文标题。调用工具: read_page_context参数: {"resourceId":"ordinary-draft","detailLevel":"full"}';
    const partition = partitionTextualToolProgress(content, tools);

    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toBe('我来帮您查看当前的论文标题。');
    expect(partition.pending).toContain('调用工具: read_page_context参数:');
  });

  it('does not execute an inline Chinese tool-call example', () => {
    expect(recoverTextualToolCalls(
      '下面是示例：调用工具: read_page_context参数: {"resourceId":"memory"}',
      tools,
    )).toEqual([]);
  });

  it('holds ScholarHarness tool lines out of streamed chat text', () => {
    const content = '我来读取当前论文的标题草稿。\nScholarHarness read_page_context resourceId=memory detailLevel=full';
    const partition = partitionTextualToolProgress(content, tools);

    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toBe('我来读取当前论文的标题草稿。\n');
    expect(partition.pending).toContain('ScholarHarness read_page_context');
  });

  it('does not execute narrative text or unknown tools', () => {
    expect(recoverTextualToolCalls('我建议调用工具：read_page_context。', tools)).toEqual([]);
    expect(recoverTextualToolCalls('调用工具： delete_everything\npath: "/"', tools)).toEqual([]);
  });

  it('holds only a possible tool-call prefix while streaming', () => {
    expect(looksLikeTextualToolCallPrefix('调')).toBe(true);
    expect(looksLikeTextualToolCallPrefix('调用工具： read_page_context')).toBe(true);
    expect(looksLikeTextualToolCallPrefix('当前项目的进度如下')).toBe(false);
  });

  it('recovers adjacent JSON tool envelopes emitted after action prose', () => {
    const content = [
      '我来在工作目录中查找 Figure 2 的作图代码。',
      '{',
      '  "file_search": {',
      '    "pattern": "figure2|fig2|Figure2|Fig2",',
      '    "path": "."',
      '  }',
      '}',
      '{"file_search":{"pattern":".*\\\\.(R|r|py|ipynb)$","path":"."}}',
    ].join('\n');

    const calls = recoverTextualToolCalls(content, tools);

    expect(calls).toHaveLength(2);
    expect(calls.map(call => call.function.name)).toEqual(['file_search', 'file_search']);
    expect(JSON.parse(calls[0].function.arguments)).toEqual({
      query: 'figure2|fig2|Figure2|Fig2',
      path: '.',
    });
    expect(JSON.parse(calls[1].function.arguments)).toEqual({
      query: '.*\\.(R|r|py|ipynb)$',
      path: '.',
    });
  });

  it('holds registered JSON tool envelopes out of streamed chat text', () => {
    const content = [
      '我来在工作目录中查找 Figure 2 的作图代码。',
      '{',
      '  "file_search": {"pattern":"figure2","path":"."}',
      '}',
    ].join('\n');

    const partition = partitionTextualToolProgress(content, tools);

    expect(partition.holdingToolArtifact).toBe(true);
    expect(partition.visible).toContain('我来在工作目录中查找');
    expect(partition.visible).not.toContain('file_search');
    expect(partition.pending).toContain('file_search');
  });

  it('keeps an action-prose prefix provisional until a tool envelope appears', () => {
    const partition = partitionTextualToolProgress('我来查找相关文件。', tools);

    expect(partition.visible).toBe('');
    expect(partition.pending).toBe('我来查找相关文件。');
    expect(partition.holdingToolArtifact).toBe(false);
  });

  it('does not execute JSON examples, unknown tools, or incomplete arguments', () => {
    expect(recoverTextualToolCalls(
      '下面是示例：\n{"file_search":{"query":"figure2"}}',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '我来执行。\n{"delete_everything":{"path":"/"}}',
      tools,
    )).toEqual([]);
    expect(recoverTextualToolCalls(
      '我来查找文件。\n{"file_search":{"path":"."}}',
      tools,
    )).toEqual([]);
  });
});
