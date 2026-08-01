import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const appSource = readPublicAppSource();

describe('secondary Aliyun Bailian Token Plan API preset', () => {
  it('keeps the standard Bailian URL and adds the Token Plan compatible endpoint', () => {
    expect(appSource).toContain("var QWEN_STANDARD_API_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'");
    expect(appSource).toContain("var QWEN_TOKEN_PLAN_API_URL = 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'");
    expect(appSource).toContain("name: '阿里云百炼 Token Plan'");
    expect(appSource).toContain("apiUrl: QWEN_TOKEN_PLAN_API_URL");
  });

  it('exposes Token Plan in the small-cow text and vision URL preset picker', () => {
    expect(appSource).toContain('var SECONDARY_AI_API_PROVIDERS = CHINA_AI_API_PROVIDERS.reduce');
    expect(appSource).toContain('var rows = SECONDARY_AI_API_PROVIDERS.map');
    expect(appSource).toContain('含阿里云百炼 Token Plan');
    expect(appSource).toContain("buildSecondaryProviderGuideHtml('text')");
    expect(appSource).toContain("buildSecondaryProviderGuideHtml('vision')");
  });

  it('fills and saves the selected compatible base URL through the existing secondary config path', () => {
    expect(appSource).toContain('urlInput.value = provider.apiUrl');
    expect(appSource).toContain('var url = normalizeApiBaseUrl(document.getElementById(\'apiUrl\').value)');
    expect(appSource).toContain('apiConfig.url = url');
    expect(appSource).toContain('apiUrl: url');
  });
});
