import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const routeSource = readFileSync(path.join(repoRoot, 'src/server/routes/meta-analysis.ts'), 'utf-8');
const serverSource = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');

describe('Meta analysis Pi Agent integration', () => {
  it('wraps every Meta AI plan in the shared persistent Agent execution kernel', () => {
    expect(routeSource).toContain("import { AgentExecutionKernel } from '../services/agent-execution-kernel';");
    expect(routeSource).toContain("import { piAgentSessionManager } from '../services/pi-agent-session';");
    expect(routeSource).toContain('const executionKernel = new AgentExecutionKernel({');
    expect(routeSource).toContain('executionKernel.begin(userId, conversationId');
    expect(routeSource).toContain('executionKernel.complete(');
    expect(routeSource).toContain('executionKernel.settle();');
    expect(routeSource).toContain('executionKernel.detachTransport(');
    expect(routeSource).not.toContain("cancelActiveRun('client-disconnected')");
    expect(routeSource).toContain('piAgentSessionManager.validateContinuationClaim(');
    expect(routeSource).toContain('.takeSteeringMessages(userId, conversationId, takeOptions)');
    expect(routeSource).toContain("piAgentSessionManager.markApplied(userId, conversationId, messageId, 'steered')");
  });

  it('uses the persistent ChatBridge/Codex App Server execution path', () => {
    expect(serverSource).toContain('async function callMetaAnalysisPiAgent(');
    expect(serverSource).toContain('return chatBridge.chat({');
    expect(serverSource).toContain('piSession: input.piSession');
    expect(serverSource).toContain('isCancelled: input.isCancelled');
    expect(serverSource).toContain('codexTimeoutMs: -1');
    expect(serverSource).toContain('provider: `Codex App Server (${codexConfig.model})`');
  });

  it('connects Meta stop requests to the same backend Agent interruptor', () => {
    expect(routeSource).toContain('interruptAiConversation?: (userId: string, conversationId: string) => Promise<void>');
    expect(serverSource).toContain('interruptAiConversation: async (userId: string, conversationId: string) => {');
    expect(serverSource).toContain('await chatBridge.interruptCodexConversation(userId, conversationId);');
  });
});
