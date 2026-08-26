import { describe, expect, it } from 'vitest';

import {
  isOpenRouterApiUrl,
  selectOpenRouterFreeModels,
} from '../../../src/server/services/openrouter-models';

describe('OpenRouter free model discovery', () => {
  it('recognizes only the official HTTPS API host', () => {
    expect(isOpenRouterApiUrl('https://openrouter.ai/api/v1')).toBe(true);
    expect(isOpenRouterApiUrl('http://openrouter.ai/api/v1')).toBe(false);
    expect(isOpenRouterApiUrl('https://openrouter.ai.example.com/api/v1')).toBe(false);
  });

  it('keeps zero-priced Agent text models including :free ids', () => {
    const models = selectOpenRouterFreeModels([
      {
        id: 'vendor/tool-model:free',
        name: 'Tool Model (free)',
        context_length: 128000,
        pricing: { prompt: '0', completion: '0.0000000' },
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['tools', 'temperature'],
      },
      {
        id: 'openrouter/free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['tools'],
      },
    ]);

    expect(models.map(model => model.id)).toEqual(['openrouter/free', 'vendor/tool-model:free']);
    expect(models[1]).toMatchObject({ contextLength: 128000, supportsTools: true });
  });

  it('removes paid and non-text generation models', () => {
    const models = selectOpenRouterFreeModels([
      { id: 'vendor/paid', pricing: { prompt: '0.1', completion: '0' } },
      {
        id: 'vendor/music-preview',
        pricing: { prompt: '0', completion: '0' },
        architecture: { output_modalities: ['audio'] },
      },
      { id: 'vendor/incomplete-price', pricing: { prompt: '0' } },
      {
        id: 'vendor/free-without-tools',
        pricing: { prompt: '0', completion: '0' },
        architecture: { output_modalities: ['text'] },
        supported_parameters: ['temperature'],
      },
    ]);

    expect(models).toEqual([]);
  });
});
