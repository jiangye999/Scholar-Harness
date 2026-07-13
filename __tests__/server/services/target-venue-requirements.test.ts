import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildTargetVenueRequirementQueries,
  researchTargetVenueRequirements,
  targetVenueRequirementSchema,
} from '../../../src/server/services/user-skills';

const originalGitHubToken = process.env.GITHUB_TOKEN;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalGitHubToken === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = originalGitHubToken;
});

describe('target venue requirement research', () => {
  it('builds official requirement queries across scope, format, review, and policy', () => {
    const queries = buildTargetVenueRequirementQueries('ICML 2026', 'Main Track');

    expect(queries).toHaveLength(4);
    expect(queries.join('\n')).toContain('official author guidelines');
    expect(queries.join('\n')).toContain('official aims scope article types');
    expect(queries.join('\n')).toContain('word page limit');
    expect(queries.join('\n')).toContain('data code reproducibility ethics AI policy');
    expect(queries[0]).toContain('"Main Track"');
  });

  it('requires a concrete target and bounds source count', () => {
    expect(() => targetVenueRequirementSchema.parse({ venue: '' })).toThrow('请填写目标期刊或会议');
    expect(targetVenueRequirementSchema.parse({ venue: 'Nature', maxSources: 7 })).toMatchObject({
      venue: 'Nature',
      articleType: '',
      maxSources: 7,
    });
    expect(() => targetVenueRequirementSchema.parse({ venue: 'Nature', maxSources: 20 })).toThrow();
  });

  it('never sends a GitHub token to venue search providers', async () => {
    process.env.GITHUB_TOKEN = 'secret-token-for-test';
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      expect(headers?.Authorization).toBeUndefined();
      return new Response('', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await researchTargetVenueRequirements({ venue: 'Example Journal', maxSources: 3 });
    expect(result.sources).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });
});
