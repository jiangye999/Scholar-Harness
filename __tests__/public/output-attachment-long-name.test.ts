import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('output attachment long file names', () => {
  it('constrains image metadata to the space beside the preview', () => {
    expect(html).toContain('.output-attachment-card-combined .output-attachment-info');
    expect(html).toContain('align-items: stretch;');
    expect(html).toContain('.output-attachment-text-stack');
    expect(html).toContain('max-width: 100%;');
    expect(html).toContain('text-overflow: ellipsis;');
  });

  it('exposes the full file name as a tooltip', () => {
    expect(html).toContain('class="output-attachment-name" title="');
  });
});
