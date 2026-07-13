import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('Codex provider isolation', () => {
  it('keeps the existing API-provider tool loop separate from the Codex tool bridge', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/server/routes/chat-bridge.ts'),
      'utf-8',
    );

    expect(source.match(/const shouldUseAgentToolLoop = !shouldUseCodexProvider/g)).toHaveLength(2);
    expect(source.match(/if \(shouldUseCodexProvider\) \{\s*chatOptions\.codexToolSet = await buildCodexBridgeToolSet/g)).toHaveLength(2);
    expect(source).toContain('shouldUseAgentToolLoop\n          ? await chatWithAgentToolsLoop');
    expect(source).toContain('shouldUseAgentToolLoop\n        ? await chatWithAgentToolsLoop');
  });

  it('only enters App Server from the Codex provider branch', () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), 'src/bridge/chat-bridge/chat-bridge.ts'),
      'utf-8',
    );
    const branchStart = source.indexOf('if (shouldTryCodex) {');
    const branchEnd = source.indexOf("if (options.forceProvider === 'primary')", branchStart);
    const codexBranch = source.slice(branchStart, branchEnd);
    expect(codexBranch).toContain('this.runCodexAppServer(options)');
    expect(codexBranch).toContain('this.runCodexCli({ ...options, codexToolSet: undefined })');
    expect(source.indexOf('this.runCodexAppServer(options)')).toBeGreaterThan(source.indexOf('if (shouldTryCodex) {'));
  });
});
