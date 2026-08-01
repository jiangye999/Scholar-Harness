import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('secondary model configuration layout', () => {
  it('keeps the cancel and save actions in the normal form flow', () => {
    expect(html).toContain('<div class="btns secondary-config-actions">');
    expect(html).toContain('.modal .btns.secondary-config-actions {');
    expect(html).toContain('position: static;');
    expect(html).toContain('bottom: auto;');
  });
});
