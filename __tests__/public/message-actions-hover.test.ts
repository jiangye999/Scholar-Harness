import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const themeCss = readFileSync(
  path.resolve(__dirname, '../../src/public/styles/color-theme.css'),
  'utf-8',
);

describe('message action icon hover', () => {
  it('keeps footer action buttons transparent in normal, hover and focus states', () => {
    expect(themeCss).toContain('.message .msg-actions button:hover');
    expect(themeCss).toContain('.message .msg-actions button:focus-visible');
    expect(themeCss).toMatch(/\.message \.msg-actions button:focus-visible[\s\S]{0,240}background: transparent !important;/);
    expect(themeCss).toMatch(/\.message \.msg-actions button:focus-visible[\s\S]{0,320}box-shadow: none !important;/);
  });
});
