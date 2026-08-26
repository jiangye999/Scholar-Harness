import { describe, expect, it } from 'vitest';

import { readPublicAppSource, readPublicModuleSource } from '../helpers/public-app-source';

const app = readPublicAppSource();
const constructorAgent = readPublicModuleSource('app/constructor-agent.js');

describe('constructor runtime feature theme bridge', () => {
  it('responds to a runtime feature theme request with current host variables', () => {
    expect(constructorAgent).toContain("if (message.type === 'theme.request')");
    expect(constructorAgent).toContain('buildConstructorFeatureThemePayload()');
    expect(constructorAgent).toContain("'--feature-primary': primary");
    expect(constructorAgent).toContain("'--tts-primary': primary");
  });

  it('broadcasts color changes to every active runtime feature frame', () => {
    expect(constructorAgent).toContain('function broadcastConstructorFeatureTheme()');
    expect(constructorAgent).toContain("window.addEventListener('scholarharness:color-theme-change', broadcastConstructorFeatureTheme)");
    expect(app).toContain("window.dispatchEvent(new CustomEvent('scholarharness:color-theme-change'");
  });

  it('keeps legacy generated packages compatible while defining a canonical host response', () => {
    expect(constructorAgent).toContain("source: 'scholar-harness-host'");
    expect(constructorAgent).toContain("source: 'scholar-harness-feature'");
    expect(constructorAgent).toContain('response.ok = true');
    expect(constructorAgent).toContain('response.ok = false');
  });
});
