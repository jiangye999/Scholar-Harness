import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

function cssZIndex(selector: string): number {
  const start = html.indexOf(selector);
  expect(start).toBeGreaterThan(-1);
  const block = html.slice(start, html.indexOf('}', start));
  const match = block.match(/z-index:\s*(\d+)/);
  expect(match).not.toBeNull();
  return Number(match?.[1]);
}

describe('left sidebar layout state', () => {
  it('synchronizes the collapsed state onto body for secondary pages', () => {
    expect(html).toContain("document.body.classList.toggle('left-sidebar-collapsed', shouldCollapse);");
    expect(html).toContain('body.left-sidebar-collapsed .app-secondary-overlay');
    expect(html).toContain('left: 0 !important;');
  });

  it('keeps the top application menu above the sidebar', () => {
    expect(cssZIndex('.app-chrome {')).toBeGreaterThan(cssZIndex('.sidebar {'));
  });
});

describe('right sidebar resize affordance', () => {
  it('animates the divider on hover and keeps it highlighted while dragging', () => {
    expect(html).toContain('.right-sidebar-resizer:hover::after');
    expect(html).toContain('.right-sidebar.resizing .right-sidebar-resizer::after');
    expect(html).toContain('transform: scaleY(0.22);');
    expect(html).toContain('transform: scaleY(1);');
    expect(html).toContain('prefers-reduced-motion: reduce');
  });
});
