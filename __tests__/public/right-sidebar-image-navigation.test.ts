import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('right sidebar image navigation', () => {
  it('collects image siblings and keeps their index in preview state', () => {
    expect(html).toContain('function collectOutputImageNavigationContext(button)');
    expect(html).toContain("root.querySelectorAll('.output-image-collection-thumb')");
    expect(html).toContain("messageContent.querySelectorAll('.message-image-preview-link')");
    expect(html).toContain('imageNavigationItems: imageNavigationContext ? imageNavigationContext.items : []');
    expect(html).toContain('imageNavigationIndex: imageNavigationContext ? Number(imageNavigationContext.index || 0) : 0');
  });

  it('renders bounded previous and next arrows over the image viewport', () => {
    expect(html).toContain('class="right-sidebar-file-preview-image-nav previous"');
    expect(html).toContain('class="right-sidebar-file-preview-image-nav next"');
    expect(html).toContain('onclick="navigateRightSidebarImage(-1)"');
    expect(html).toContain('onclick="navigateRightSidebarImage(1)"');
    expect(html).toContain('title="上一张图片"');
    expect(html).toContain('title="下一张图片"');
    expect(html).toContain('function navigateRightSidebarImage(direction)');
    expect(html).toContain('.right-sidebar-file-preview-image-nav:active {');
    expect(html).toContain('transform: translateY(-50%) !important;');
    expect(html).toContain('.right-sidebar-file-preview-image-nav:hover:not(:disabled)');
    expect(html).toContain('color: #f2c94c !important;');
  });
});
