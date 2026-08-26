import { describe, expect, it } from 'vitest';

import { readPublicAppSource, readPublicStyleSource } from '../helpers/public-app-source';

const app = readPublicAppSource();
const layoutCss = readPublicStyleSource('styles/responsive.css');

describe('frameless Electron window controls', () => {
  it('detects Electron independently of the preload bridge timing', () => {
    expect(app).toContain("/\\bElectron\\//i.test(String(navigator.userAgent || ''))");
    expect(app).toContain("classList.toggle('browser-runtime', !isElectronWindow)");
  });

  it('keeps minimize, maximize and close controls in the app chrome', () => {
    expect(app).toContain("handleWindowControl('minimize')");
    expect(app).toContain("handleWindowControl('maximize')");
    expect(app).toContain("handleWindowControl('close')");
  });

  it('fails open for the frameless desktop window and only hides controls in a browser', () => {
    const defaultRule = layoutCss.match(/(?:^|\n)\s*\.app-window-controls\s*\{([^}]*)\}/);
    expect(defaultRule?.[1]).toContain('display: inline-flex;');
    expect(defaultRule?.[1]).toContain('flex: 0 0 auto;');
    expect(defaultRule?.[1]).not.toContain('display: none;');
    expect(layoutCss).toMatch(/\.browser-runtime \.app-window-controls\s*\{[^}]*display:\s*none;/s);
  });
});
