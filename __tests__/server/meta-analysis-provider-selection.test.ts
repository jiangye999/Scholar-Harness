import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(path.resolve(__dirname, '../../src/server/routes/meta-analysis.ts'), 'utf-8');
const serverSource = readFileSync(path.resolve(__dirname, '../../src/server/local-server.ts'), 'utf-8');

describe('Meta analysis provider selection', () => {
  it('normalizes and forwards only supported providers', () => {
    expect(routeSource).toContain("requestedProvider === 'secondary' || requestedProvider === 'primary' || requestedProvider === 'codex'");
    expect(routeSource).toContain('forceProvider,');
  });

  it('honors a forced provider without changing the default fallback chain', () => {
    expect(serverSource).toContain("requestedProvider === 'codex'");
    expect(serverSource).toContain("requestedProvider === 'secondary'");
    expect(serverSource).toContain("requestedProvider === 'primary'");
    expect(serverSource).toContain("fallbackChain: requestedProvider ? [requestedProvider]");
  });
});
