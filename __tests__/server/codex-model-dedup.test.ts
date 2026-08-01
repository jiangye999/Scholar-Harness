import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'),
  'utf-8',
);

describe('Codex model catalog deduplication', () => {
  it('deduplicates identical display names and favors canonical GPT slugs', () => {
    expect(routeSource).toContain('function dedupeCodexModelsByDisplayName(models: any[]): any[]');
    expect(routeSource).toContain("if (slug && slug === displayName) score += 100;");
    expect(routeSource).toContain("if (/^gpt-\\d/.test(slug)) score += 50;");
    expect(routeSource).toContain('dedupeCodexModelsByDisplayName(Array.from(modelsBySlug.values()))');
  });

  it('retains discarded internal slugs as aliases', () => {
    expect(routeSource).toContain('aliases: Array.isArray(model?.aliases) ? [...model.aliases] : []');
    expect(routeSource).toContain("sanitizeString(discarded?.slug || discarded?.id || '')");
  });
});
