import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

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

  it('removes both flex width and overlay inset when the sidebar closes', () => {
    expect(html).toContain('--active-left-sidebar-width: var(--left-sidebar-width);');
    expect(html).toContain('body.left-sidebar-collapsed .sidebar {');
    expect(html).toContain('flex: 0 0 0 !important;');
    expect(html).toContain("root.style.setProperty(\n          '--active-left-sidebar-width'");
    expect(html).toContain("shouldCollapse ? '0px' : 'var(--left-sidebar-width)'");
    expect(html).toContain("sidebar.style.setProperty('flex', '0 0 0px', 'important');");
    expect(html).toContain('left: var(--active-left-sidebar-width) !important;');
  });

  it('keeps the top application menu above the sidebar', () => {
    expect(cssZIndex('.app-chrome {')).toBeGreaterThan(cssZIndex('.sidebar {'));
  });

  it('keeps vertical navigation scrolling without exposing a horizontal scrollbar', () => {
    expect(html).toContain('.sidebar-panels {');
    expect(html).toContain('width: 100%;');
    expect(html).toContain('min-width: 0;');
    expect(html).toContain('overflow-y: auto;');
    expect(html).toContain('overflow-x: hidden;');
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

  it('keeps the Meta overlay edge synchronized with the resized sidebar', () => {
    expect(html).toContain('body.right-sidebar-resizing .modal-overlay.meta-analysis-shared-composer-overlay');
    expect(html).toContain('transition: none !important;');
    expect(html).toContain("document.body.classList.add('right-sidebar-resizing');");
    expect(html).toContain("document.body.classList.remove('right-sidebar-resizing');");
  });
});
