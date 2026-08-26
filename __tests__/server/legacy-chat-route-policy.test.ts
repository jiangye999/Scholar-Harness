import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('legacy chat route policy', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/server/local-server.ts'),
    'utf8',
  );

  it('disables legacy chat entry points by default behind one compatibility flag', () => {
    expect(source).toContain("SCHOLAR_HARNESS_ENABLE_LEGACY_CHAT_ROUTES === '1'");
    expect(source).toContain("code: 'LEGACY_CHAT_ROUTE_DISABLED'");
    expect(source).toContain('请使用 /api/chat-bridge/chat');
  });

  it('marks compatibility responses as deprecated when explicitly enabled', () => {
    expect(source).toContain("res.setHeader('Deprecation', 'true')");
    expect(source).toContain('rel="successor-version"');
  });
});
