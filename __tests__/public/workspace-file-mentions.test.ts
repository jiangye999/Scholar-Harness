import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('composer workspace file mentions', () => {
  it('loads workspace files after @ and inserts a quoted relative path', () => {
    expect(html).toContain("fetch('/api/chat-bridge/workspace/mentions'");
    expect(html).toContain("maxResults: 120");
    expect(html).toContain("var insert = '@\"' + cleanPath + '\" '");
    expect(html).toContain("type: 'workspace_file'");
    expect(html).toContain('composer-workspace-mention');
  });

  it('uses the composer selector instead of model @ mentions', () => {
    expect(html).not.toContain('data-mention="小牛马"');
    expect(html).not.toContain('data-mention="大牛马"');
    expect(html).not.toContain('data-mention="codex"');
    expect(html).not.toContain('var mentionMatch = message.match');
    expect(html).toContain('var explicitProvider = getComposerChatProvider();');
  });
});
