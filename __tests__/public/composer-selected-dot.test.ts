import { describe, expect, it } from 'vitest';

import { readPublicAppSource, readPublicStyleSource } from '../helpers/public-app-source';

const app = readPublicAppSource();
const layoutCss = readPublicStyleSource('styles/responsive.css');

describe('composer selected item marker', () => {
  it('uses empty decorative markers instead of check glyphs for providers and agents', () => {
    expect(app).toContain('<span class="composer-provider-option-check" aria-hidden="true"></span>');
    expect(app).toContain('<span class="composer-mm-check" aria-hidden="true"></span>');
    expect(app).not.toContain('<span class="composer-mm-check">✓</span>');
  });

  it('renders the selected markers as dark theme-colored circular dots', () => {
    expect(layoutCss).toContain('#composerProviderMenu .composer-provider-option-check::before');
    expect(layoutCss).toContain('#composerCodingAgentRuntimeList .composer-provider-option-check::before');
    expect(layoutCss).toContain('.composer-mm-check::before');
    expect(layoutCss).toContain('border-radius: 50%;');
    expect(layoutCss).toContain('background: var(--theme-primary-hover, var(--theme-primary, #111827));');
    expect(layoutCss).toContain('rgb(var(--theme-shadow-rgb, 17 24 39) / 0.16)');
  });
});
