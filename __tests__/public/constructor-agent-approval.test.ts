import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(path.resolve('src/public/app/constructor-agent.js'), 'utf8');

describe('constructor agent approval UI', () => {
  it('uses an in-page confirmation panel instead of Electron-unsupported prompt()', () => {
    expect(source).not.toContain('window.prompt(');
    expect(source).toContain('constructor-inline-approval');
    expect(source).toContain('submitConstructorApproval');
  });

  it('keeps the exact two-stage backend confirmation phrases', () => {
    expect(source).toContain("'批准重大修改'");
    expect(source).toContain("'应用并保留回滚点'");
    expect(source).toContain('confirmation: phrase');
  });
});
