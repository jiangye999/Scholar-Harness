import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

describe('homepage AI UI action policy', () => {
  it('enforces the turn-visible action allowlist before execution', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/public/app/chat-history.js'),
      'utf8',
    );
    expect(source).toContain('getAvailableFrontendUiActionIds().has(action)');
    expect(source).toContain('Rejected UI action outside current availableActions');
  });

  it('requires explicit confirmation before persisting Skills', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../src/public/app/chat-history.js'),
      'utf8',
    );
    expect(source).toContain("action === 'set_persistent_skills'");
    expect(source).toContain('window.confirm(');
    expect(source).toContain('这会影响之后每一轮主对话');
  });
});
