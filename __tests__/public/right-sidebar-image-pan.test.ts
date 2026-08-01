import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('right sidebar image right-button pan', () => {
  it('moves a zoomed image while either the left or right mouse button is held', () => {
    expect(html).toContain('function setupRightSidebarImageButtonPan(elements)');
    expect(html).toContain('if (event.button !== 0 && event.button !== 2) return;');
    expect(html).toContain('activeButtonMask = event.button === 2 ? 2 : 1;');
    expect(html).toContain('if ((event.buttons & activeButtonMask) !== activeButtonMask)');
    expect(html).toContain('viewport.setPointerCapture(event.pointerId)');
    expect(html).toContain('viewport.scrollLeft -= deltaX;');
    expect(html).toContain('viewport.scrollTop -= deltaY;');
    expect(html).toContain("viewport.addEventListener('contextmenu', suppressContextMenu)");
    expect(html).toContain("'is-right-panning'");
    expect(html).toContain('放大后按住左键或右键拖动');
  });

  it('removes pointer listeners whenever the image preview is rerendered or closed', () => {
    expect(html).toContain('var rightSidebarImagePanCleanup = null;');
    expect(html).toContain('rightSidebarImagePanCleanup = setupRightSidebarImageButtonPan(elements);');
    expect(html).toContain("viewport.removeEventListener('pointermove', handlePointerMove)");
    expect(html).toContain('rightSidebarImagePanCleanup();');
  });

  it('supports left- and right-button panning for PDF Manager sidebar images', () => {
    expect(html).toContain('function setupRightSidebarPdfOverviewPan()');
    expect(html).toContain('function syncRightSidebarPdfOverviewPanAffordance()');
    expect(html).toContain("if (event.button !== 0 && event.button !== 2) return;");
    expect(html).toContain('activeButtonMask = event.button === 2 ? 2 : 1;');
    expect(html).toContain('viewport.scrollLeft -= deltaX;');
    expect(html).toContain('viewport.scrollTop -= deltaY;');
    expect(html).toContain("viewport.addEventListener('contextmenu'");
    expect(html).toContain('滚轮缩放 · 左/右键拖动');
    expect(html).toContain('is-panning');
  });
});
