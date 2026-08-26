import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('Codex workspace and fallback policy', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../src/bridge/chat-bridge/chat-bridge.ts'),
    'utf8',
  );

  it('uses current conversation scope by default and makes archives explicit', () => {
    expect(source).toContain('其他会话子目录属于归档');
    expect(source).toContain('list_archived_sessions + scope=archive');
    expect(source).not.toContain('当前会话和其他会话的 AI 产物目录');
    expect(source).not.toContain('including other conversation subfolders');
  });

  it('fails closed when App Server tools cannot be preserved by exec fallback', () => {
    expect(source).toContain('const codexToolRuntimeRequired = Boolean(options.codexToolSet?.definitions.length)');
    expect(source).toContain('CODEX_TOOL_RUNTIME_REQUIRED');
    expect(source).not.toContain('runCodexCli({ ...options, codexToolSet: undefined })');
  });
});
