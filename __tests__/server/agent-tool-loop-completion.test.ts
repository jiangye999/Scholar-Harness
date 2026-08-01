import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const routeSource = fs.readFileSync(
  path.resolve(process.cwd(), 'src/server/routes/chat-bridge.ts'),
  'utf-8',
);

function readAgentToolLoopSource(): string {
  const start = routeSource.indexOf('async function chatWithAgentToolsLoop(');
  const end = routeSource.indexOf('\nfunction normalizePiConversationId', start);
  if (start < 0 || end < 0) {
    throw new Error('Unable to locate chatWithAgentToolsLoop source');
  }
  return routeSource.slice(start, end);
}

describe('completion-driven Agent tool loop', () => {
  const loopSource = readAgentToolLoopSource();

  it('does not stop after a fixed number of tool cycles', () => {
    expect(routeSource).not.toContain('WORKSPACE_TOOL_MAX_TURNS');
    expect(routeSource).not.toContain('Agent 工具已达到最大执行轮次');
    expect(loopSource).toContain('while (true)');
    expect(loopSource).not.toMatch(/for\s*\(\s*let\s+turn\b/);
  });

  it('finishes on a model final response and remains user-cancellable', () => {
    expect(loopSource).toContain('if (!result.toolCalls.length)');
    expect(loopSource).toContain('return finalAnswer');
    expect(loopSource).toContain('assertAgentLoopActive()');
    expect(loopSource).toContain('options.isCancelled?.()');
  });

  it('recovers from identical failed calls without terminating the task', () => {
    expect(loopSource).toContain('IDENTICAL_FAILED_TOOL_RETRY_LIMIT');
    expect(loopSource).toContain('<AGENT_LOOP_RECOVERY>');
    expect(loopSource).toContain('这不会结束 Agent 任务');
    expect(loopSource).toContain('继续推理直至任务完成');
  });
});
