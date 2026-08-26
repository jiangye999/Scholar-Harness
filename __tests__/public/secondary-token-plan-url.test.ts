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
    expect(appSource).toContain("{ id: 'tokenplan', name: '阿里云 Token Plan'");
    expect(appSource).toContain("secondary: { title: '🐄 Little corse 文本' }");
    expect(appSource).toContain("secondary_vision: { title: '🐄 Little corse 视觉' }");
    expect(appSource).toContain("providerOptions += '<option value=\"' + escapeAttr(p.id)");
  });

  it('resolves and saves the selected preset URL through the model-pool config path', () => {
    expect(appSource).toContain("var preset = presetById(m.provider)");
    expect(appSource).toContain("api_url: m.api_url || (preset ? preset.url : '')");
    expect(appSource).toContain("body[provider] = { pool: collectProviderSection(provider) }");
    expect(appSource).toContain("fetch('/api/chat-bridge/config'");
  });
});
