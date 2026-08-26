import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

/** Read with CRLF normalized to LF so multi-line assertions are line-ending agnostic. */
function readSource(file: string): string {
  return fs.readFileSync(file, 'utf-8').replace(/\r\n/g, '\n');
}

describe('Codex provider isolation', () => {
  it('keeps the existing API-provider tool loop separate from the Codex tool bridge', () => {
    const source = readSource(
      path.resolve(process.cwd(), 'src/server/routes/chat-bridge.ts'),
    );

    expect(source.match(/const shouldUseAgentToolLoop = !shouldUseCodexProvider/g)).toHaveLength(2);
    expect(source.match(/const shouldUseAgentToolLoop = !shouldUseCodexProvider;/g)).toHaveLength(2);
    expect(source).not.toMatch(/const shouldUseAgentToolLoop = !shouldUseCodexProvider\s*&&/);
    expect(source.match(/if \(shouldUseCodexProvider\) \{/g)).toHaveLength(2);
    expect(source.match(/chatOptions\.codexToolSet = await buildCodexBridgeToolSet/g)).toHaveLength(2);
    expect(source).not.toContain('&& !directAnswerPreferred');
    expect(source.match(/skipInitialPlan: directAnswerPreferred/g)).toHaveLength(2);
    expect(source).toContain('shouldUseAgentToolLoop\n          ? await chatWithAgentToolsLoop');
    expect(source).toContain('shouldUseAgentToolLoop\n        ? await chatWithAgentToolsLoop');
  });

  it('only enters App Server from the Codex runtime branch', () => {
    const source = readSource(
      path.resolve(process.cwd(), 'src/bridge/chat-bridge/chat-bridge.ts'),
    );
    const branchStart = source.indexOf("if (shouldTryCodingRuntime && selectedCodingRuntime === 'codex') {");
    const branchEnd = source.indexOf("if (options.forceProvider === 'primary')", branchStart);
    const codexBranch = source.slice(branchStart, branchEnd);
    expect(branchStart).toBeGreaterThan(-1);
    expect(branchEnd).toBeGreaterThan(branchStart);
    expect(codexBranch).toContain('this.runCodexAppServer(options)');
    expect(codexBranch).toContain('const codexToolRuntimeRequired = Boolean(options.codexToolSet?.definitions.length)');
    expect(codexBranch).toContain('CODEX_TOOL_RUNTIME_REQUIRED');
    expect(codexBranch).toContain('this.runCodexCli(options)');
    expect(codexBranch).not.toContain('codexToolSet: undefined');
    expect(source.indexOf('this.runCodexAppServer(options)')).toBeGreaterThan(branchStart);
  });
});
