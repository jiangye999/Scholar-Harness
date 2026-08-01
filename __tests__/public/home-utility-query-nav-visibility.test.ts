import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('home utility page query navigation visibility', () => {
  it('hides the chat query rail while a utility page is open', () => {
    expect(html).toContain('body.home-utility-open .query-nav-rail');
    expect(html).toContain("document.body.classList.add('home-utility-open')");
    expect(html).toContain('hideQueryNavPreview();');
  });

  it('restores the query rail state after returning to chat', () => {
    expect(html).toContain("document.body.classList.remove('home-utility-open')");
    expect(html).toContain('scheduleQueryNavRender();');
  });
});
