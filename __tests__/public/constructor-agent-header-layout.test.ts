import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve('src/public/app/constructor-agent.js'), 'utf8');
const styles = fs.readFileSync(path.resolve('src/public/styles/constructor-agent.css'), 'utf8');

describe('constructor agent compact header layout', () => {
  it('renders capability stats and the executor in the page header', () => {
    expect(source).toContain('renderConstructorPageHeader(status)');
    expect(source).toContain('constructor-header-stats');
    expect(source).toContain('constructor-header-executor');
    expect(source).not.toContain('<section class="constructor-card constructor-awareness-card">');
  });

  it('keeps capability indicators borderless and transparent', () => {
    expect(styles).toMatch(/\.constructor-header-stats span[\s\S]*?border:\s*0;/);
    expect(styles).toMatch(/\.constructor-header-stats span[\s\S]*?background:\s*transparent;/);
  });
});
