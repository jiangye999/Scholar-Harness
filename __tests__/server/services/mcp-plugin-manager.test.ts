import * as path from 'path';

import { describe, expect, it } from 'vitest';

import {
  McpStdioSession,
  type McpPluginRecord,
} from '../../../src/server/services/mcp-plugin-manager';

describe('McpStdioSession', () => {
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
});
