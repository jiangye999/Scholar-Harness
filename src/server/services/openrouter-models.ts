export interface UpstreamModelRecord {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: {
    prompt?: unknown;
    completion?: unknown;
  };
  architecture?: {
    output_modalities?: unknown;
  };
  supported_parameters?: unknown;
}

export interface OpenRouterFreeModel {
  id: string;
  name: string;
  contextLength: number | null;
  supportsTools: boolean;
}

function hasZeroPrice(value: unknown): boolean {
  if (value === '' || value === null || value === undefined) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed === 0;
}

function outputsText(model: UpstreamModelRecord): boolean {
  const modalities = model.architecture?.output_modalities;
  if (!Array.isArray(modalities)) return true;
  return modalities.some(modality => String(modality).toLowerCase() === 'text');
}

function supportsAgentTools(model: UpstreamModelRecord): boolean {
  return Array.isArray(model.supported_parameters)
    && model.supported_parameters.some(parameter => String(parameter) === 'tools');
}

export function isOpenRouterApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.toLowerCase() === 'openrouter.ai';
  } catch {
    return false;
  }
}

export function selectOpenRouterFreeModels(models: UpstreamModelRecord[]): OpenRouterFreeModel[] {
  return models
    .filter(model => {
      const id = typeof model.id === 'string' ? model.id.trim() : '';
      return Boolean(id)
        && hasZeroPrice(model.pricing?.prompt)
        && hasZeroPrice(model.pricing?.completion)
        && outputsText(model)
        && supportsAgentTools(model);
    })
    .map(model => {
      const supportedParameters = Array.isArray(model.supported_parameters)
        ? model.supported_parameters.map(value => String(value))
        : [];
      const contextLength = Number(model.context_length);
      return {
        id: String(model.id).trim(),
        name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : String(model.id).trim(),
        contextLength: Number.isFinite(contextLength) && contextLength > 0 ? contextLength : null,
        supportsTools: supportedParameters.includes('tools'),
      };
    })
    .sort((left, right) => {
      if (left.id === 'openrouter/free') return -1;
      if (right.id === 'openrouter/free') return 1;
      if (left.supportsTools !== right.supportsTools) return left.supportsTools ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
}
