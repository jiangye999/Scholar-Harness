import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const chatBridgeRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');
const pack = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../skill-packs/scholar-harness-core/pack.json'), 'utf-8'),
);

describe('Scholar Harness configuration agent guide', () => {
  it('registers the bundled configuration skill and auto-loads it for configuration intent', () => {
    expect(pack.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'scholar-harness-configuration',
        entry: 'skills/configuration/scholar-harness-configuration/SKILL.md',
      }),
    ]));
    expect(chatBridgeRoute).toContain("const configurationSkillId = 'scholar-harness-core:scholar-harness-configuration'");
    expect(chatBridgeRoute).toContain('shouldLoadConfigurationSkill');
  });

  it('starts with the secondary agent and exposes precise safe configuration actions', () => {
    expect(html).toContain("function startAiConfigurationAssistant(focus)");
    expect(html).toContain("setComposerChatProvider('secondary')");
    expect(html).toContain("{ id: 'open_primary_config', label: '打开 Grass OpenRouter 配置' }");
    expect(html).toContain("{ id: 'open_embedding_config', label: '打开 Embedding 安全配置' }");
    expect(html).toContain("{ id: 'open_codex_config', label: '打开 Codex 配置并展开' }");
    expect(html).toContain("{ id: 'set_persistent_skills', label: '用户确认后把 skill_ids 中的 Skill 加入持续使用' }");
    expect(html).toContain("{ id: 'upload_literature', label: '打开 RIS、TXT、BibTeX 文献题录上传' }");
    expect(html).toContain("{ id: 'upload_pdf_wiki', label: '打开 PDF Wiki 上传' }");
  });

  it('keeps API keys in password inputs and resumes the guide after secondary setup', () => {
    expect(html).toContain('id="guidedApiKey" type="password"');
    expect(html).toContain("guidedConfigState.returnTarget = 'ai-configuration'");
    expect(html).toContain("setTimeout(function() { startAiConfigurationAssistant('all'); }, 120)");
  });
});
