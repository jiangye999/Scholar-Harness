import { describe, expect, it } from 'vitest';

import {
  extractCodexConfiguredModelSlugs,
  extractCodexSessionModelCounts,
} from '../../src/utils/codex-model-discovery';

describe('codex model discovery', () => {
  it('reads the configured model and model availability entries', () => {
    const input = [
      'model = "gpt-5.6-luna"',
      '[tui.model_availability_nux]',
      '"gpt-5.6-sol" = 4',
    ].join('\n');
    expect(extractCodexConfiguredModelSlugs(input)).toEqual(['gpt-5.6-luna', 'gpt-5.6-sol']);
  });

  it('counts models from real Codex session settings', () => {
    const input = [
      '{"thread_settings":{"model":"gpt-5.6-terra"}}',
      '{"payload":{"model":"gpt-5.6-terra"}}',
      '{"payload":{"model":"not-a-model"}}',
    ].join('\n');
    expect(extractCodexSessionModelCounts(input).get('gpt-5.6-terra')).toBe(2);
    expect(extractCodexSessionModelCounts(input).has('not-a-model')).toBe(false);
  });
});
