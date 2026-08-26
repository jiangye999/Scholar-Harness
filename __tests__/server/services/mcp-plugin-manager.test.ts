import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  getMcpGatewayToolDefinitions,
  isMcpGatewayToolName,
  McpStdioSession,
  type McpPluginRecord,
} from '../../../src/server/services/mcp-plugin-manager';

describe('McpStdioSession', () => {
  it('exposes a constant-size lazy gateway instead of every user MCP schema', () => {
    const definitions = getMcpGatewayToolDefinitions();
    expect(definitions.map(item => item.function.name)).toEqual([
      'list_user_mcp_tools',
      'invoke_user_mcp_tool',
    ]);
    expect(definitions).toHaveLength(2);
    expect(isMcpGatewayToolName('list_user_mcp_tools')).toBe(true);
    expect(isMcpGatewayToolName('user_mcp__memory__read_graph')).toBe(false);
  });

  it('discovers and calls newline-delimited stdio MCP tools', async () => {
    const plugin: McpPluginRecord = {
      id: 'fake',
      name: 'Fake MCP',
      description: 'Test MCP',
      command: process.execPath,
      args: [path.resolve(__dirname, '../../fixtures/fake-mcp-server.cjs')],
      env: {},
      enabled: true,
      source: 'custom',
      risk: 'read',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'unchecked',
      tools: [],
    };
    const session = new McpStdioSession(plugin);
    try {
      await session.start();
      const tools = await session.listTools();
      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe('echo');
      const result = await session.callTool('echo', { text: 'Scholar Harness' });
      expect(result).toMatchObject({
        structuredContent: { echoed: 'Scholar Harness' },
        isError: false,
      });
    } finally {
      session.close();
    }
  });

  it('discovers and calls Content-Length framed stdio MCP tools', async () => {
    const plugin: McpPluginRecord = {
      id: 'fake-framed',
      name: 'Fake Framed MCP',
      description: 'Test framed MCP',
      command: process.execPath,
      args: [path.resolve(__dirname, '../../fixtures/fake-content-length-mcp-server.mjs')],
      env: {},
      enabled: true,
      source: 'custom',
      risk: 'read',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'unchecked',
      tools: [],
    };
    const session = new McpStdioSession(plugin);
    try {
      await session.start();
      const tools = await session.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['echo_framed']);
      await expect(session.callTool('echo_framed', { text: 'framed' })).resolves.toMatchObject({
        structuredContent: { text: 'framed' },
        isError: false,
      });
    } finally {
      session.close();
    }
  });

  it('ignores non-protocol logger lines written to MCP stdout', async () => {
    const plugin: McpPluginRecord = {
      id: 'fake-noisy',
      name: 'Fake Noisy MCP',
      description: 'Test MCP with logger output on stdout',
      command: process.execPath,
      args: [path.resolve(__dirname, '../../fixtures/fake-noisy-mcp-server.cjs')],
      env: {},
      enabled: true,
      source: 'custom',
      risk: 'read',
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'unchecked',
      tools: [],
    };
    const session = new McpStdioSession(plugin, {
      initializeMs: 2_000,
      listToolsMs: 2_000,
    });
    try {
      await session.start();
      const tools = await session.listTools();
      expect(tools.map(tool => tool.name)).toEqual(['echo_noisy']);
      await expect(session.callTool('echo_noisy', { text: 'still works' })).resolves.toMatchObject({
        structuredContent: { echoed: 'still works' },
        isError: false,
      });
    } finally {
      session.close();
    }
  });
});
