import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('formal utility Agent tool registration', () => {
  const routeSource = fs.readFileSync(path.resolve('src/server/routes/chat-bridge.ts'), 'utf8');
  const utilitySource = fs.readFileSync(path.resolve('src/server/services/utility-agent-tool-adapter.ts'), 'utf8');

  it('registers and dispatches the shared utility adapter in both Agent execution paths', () => {
    expect(routeSource).toContain("from '../services/utility-agent-tool-adapter'");
    // 数据分析和 R 作图是核心能力，默认常驻；其余低频工具仍受 MAIN_CHAT_UTILITY_TOOLS_ENABLED 开关控制。
    expect(routeSource.match(/getUtilityCoreAgentToolDefinitions\(\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(routeSource.match(/MAIN_CHAT_UTILITY_TOOLS_ENABLED \? getUtilityExtendedAgentToolDefinitions\(\)/g)).toHaveLength(2);
    expect(routeSource.match(/const utilityToolNames = new Set\(utilityTools\.map/g)).toHaveLength(2);
    expect(routeSource.match(/executeUtilityAgentToolCall\(/g)?.length).toBeGreaterThanOrEqual(2);
    // 成本护栏：utility 指导块按本轮意图裁剪（data_analysis / r_plot /
    // bibliometrics / meta_analysis 相关轮次才注入），工具仍可经
    // read_capabilities + invoke_capability 发现与调用。
    expect(routeSource).toContain('utilityTools.length && isUtilityTurn ? UTILITY_AGENT_TOOL_GUIDANCE');
    expect(routeSource).toContain('isUtilityTurn = loopIntentMatch');
    expect(utilitySource).toContain('再调用 invoke_capability');
    expect(utilitySource).toContain('禁止把 utility_* 名称当作直接 tool call 输出');
  });
});
