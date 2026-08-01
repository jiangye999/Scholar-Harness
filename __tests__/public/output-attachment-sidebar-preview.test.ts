import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const server = readFileSync(path.resolve(__dirname, '../../src/server/local-server.ts'), 'utf-8');

describe('AI output attachment sidebar preview', () => {
  it('provides a transient right-sidebar preview page without replacing draft tabs', () => {
    expect(html).toContain('id="rightSidebarFilePreviewTab"');
    expect(html).toContain('id="rightSidebarFilePreviewPage"');
    expect(html).toContain('id="rightSidebarFilePreviewPanel"');
    expect(html).toContain("rightSidebarTransientTab === 'preview'");
    expect(html).toContain("setRightSidebarTab('preview')");
    expect(html).toContain('id="rightSidebarArticleTab"');
    expect(html).toContain('id="rightSidebarFiguresTab"');
  });

  it('routes thumbnails, file buttons, message links, and cards through the sidebar opener', () => {
    expect(html).toContain('async function openOutputAttachmentInRightSidebar(button, suppliedNavigationContext)');
    expect(html).toContain('return openOutputAttachmentInRightSidebar(button);');
    expect(html).toContain('onclick="openOutputAttachmentCardInSidebar(this,event)"');
    expect(html).not.toContain("window.open(previewUrl, '_blank')");
  });

  it('keeps the preferred sidebar width when a historical attachment preview mounts', () => {
    expect(html).toContain('function getPreferredRightSidebarWidth()');
    expect(html).toContain('applyRightSidebarWidth(getPreferredRightSidebarWidth());');
    expect(html).toContain("typeof ensureRightSidebarExpandedWidth === 'function'");
    expect(html).toContain('ensureRightSidebarExpandedWidth();');
  });

  it('renders safe inline previews and keeps containing-folder behavior separate', () => {
    expect(html).toContain('right-sidebar-file-preview-image');
    expect(html).toContain('right-sidebar-file-preview-frame');
    expect(html).toContain('right-sidebar-file-preview-text');
    expect(html).toContain('onclick="openOutputAttachmentFolder(this)"');
    expect(server).toContain('function resolveLocalPreviewFilePath(');
    expect(server).toContain('LOCAL_OUTPUT_FILE_EXTENSIONS.has(ext)');
    expect(server).toContain('Content-Disposition');
    expect(server).toContain("Content-Security-Policy");
  });

  it('keeps typing responsive while a large preview is visible', () => {
    expect(html).not.toContain('field-sizing: content');
    expect(html).toContain('field-sizing: fixed');
    expect(html).toContain('MAIN_CHAT_INPUT_RESIZE_DELAY_MS = 48');
    expect(html).toContain('updateMainChatQueueButtonState({ renderQueue: false })');
    expect(html).toContain('optimizeRightSidebarImageInWorker');
    expect(html).toContain('new OffscreenCanvas(outputWidth,outputHeight)');
    expect(html).toContain('contain: strict;');
  });

  it('zooms sidebar images around the mouse position without rerendering the transcript', () => {
    expect(html).toContain("addEventListener('wheel', handleRightSidebarImageZoomWheel, { passive: false })");
    expect(html).toContain('function getRightSidebarImageZoomAnchor(image, clientX, clientY)');
    expect(html).toContain('viewport.scrollLeft = imageLeft + anchor.imageX * imageWidth - anchor.viewportX;');
    expect(html).toContain('viewport.scrollTop = imageTop + anchor.imageY * imageHeight - anchor.viewportY;');
    expect(html).toContain('function resetRightSidebarImageZoom()');
    expect(html).toContain('right-sidebar-file-preview-image-stage');
  });

  it('never decodes full-size AI output images inside the chat transcript', () => {
    expect(html).toContain("data-thumbnail-source-url=\"' + escapeHtml(previewUrl) + '\"");
    expect(html).toContain('function optimizeOutputAttachmentThumbnailInWorker(arrayBuffer, mimeType)');
    expect(html).toContain('maxEdge: 640');
    expect(html).toContain('maxPixels: 400000');
    expect(html).toContain('new IntersectionObserver(function(entries)');
    expect(html).toContain('OUTPUT_ATTACHMENT_THUMBNAIL_CACHE_LIMIT = 24');
  });

  it('invalidates overwritten image previews and resolves within the active workspace first', () => {
    expect(html).toContain("return String(sourceUrl || '').trim();");
    expect(html).toContain("cache: 'no-store'");
    expect(html).toContain("params.set('preferLatest', '1')");
    expect(html).toContain('data-workspace-root="');
    expect(server).toContain('getMirroredLocalOutputCandidatePaths');
    expect(server).toContain('"latest-workspace-match"');
    expect(server).toContain('"private, no-cache, must-revalidate"');
  });

  it('restores historical file authorization before resolving a clicked attachment', () => {
    const authorizeIndex = html.indexOf('await authorizeOutputAttachmentPreviewTargets(button);');
    const resolveIndex = html.indexOf("fetch('/api/local-file/resolve?' + params.toString()");

    expect(html).toContain('async function authorizeOutputAttachmentPreviewTargets(button)');
    expect(html).toContain("fetch('/api/chat-bridge/workspace/authorize-preview'");
    expect(html).toContain('candidates.unshift(filePath);');
    expect(html).toContain('getWorkspaceRootsForLocalFileResolve(preferredRoot)');
    expect(authorizeIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(authorizeIndex);
  });

  it('reuses multi-root resolution after a thumbnail path returns 404', () => {
    expect(html).toContain('await authorizeOutputAttachmentPreviewTargets(button);');
    expect(html).toContain('var resolvedPath = await resolveOutputAttachmentLocalPath(button);');
    expect(server).toMatch(
      /getValidatedLocalFileResolveRoots\(\s*req\.query\.workspaceRoot,\s*req\.query\.workspaceRoots,\s*\)/,
    );
  });

  it('avoids full transcript relayout while sidebars open and close', () => {
    expect(html).toContain('content-visibility: auto;');
    expect(html).toContain('contain-intrinsic-size: auto 240px;');
    const mainRules = Array.from(html.matchAll(/\.main\s*\{([^}]*)\}/g))
      .map((match) => match[1])
      .join('\n');
    expect(mainRules).not.toContain('transition: width 240ms');
  });

  it('uses format-aware read-only previews for spreadsheets, Word, and R/code files', () => {
    expect(html).toContain('/api/local-file/formatted-preview?path=');
    expect(html).toContain('supportsRightSidebarFormattedPreview(extension)');
    expect(html).toContain('sandbox=""');
    expect(server).toContain('app.get("/api/local-file/formatted-preview"');
    expect(server).toContain('buildLocalSpreadsheetPreview');
    expect(server).toContain('buildLocalWordPreview');
    expect(server).toContain('buildLocalCodePreview');
    expect(server).toContain('mammoth.convertToHtml');
  });
});
