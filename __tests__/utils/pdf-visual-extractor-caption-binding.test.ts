import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'scripts', 'extract-pdf-visuals.py'),
  'utf-8'
);

describe('PDF visual extractor caption binding', () => {
  it('only treats caption labels at the beginning of a text block as captions', () => {
    expect(source).toContain('match.start() <= 4');
    expect(source).toContain('if not is_caption_text(text):');
    expect(source).not.toContain('if not CAPTION_RE.search(text):');
  });

  it('requires an embedded image caption to be spatially adjacent', () => {
    expect(source).toContain('if not best or best[0] > 160:');
  });
});
