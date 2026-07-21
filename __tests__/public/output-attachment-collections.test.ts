import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('AI output attachment collections', () => {
  it('turns more than three output images into a flat interactive image collection', () => {
    expect(html).toContain('var OUTPUT_IMAGE_COLLECTION_THRESHOLD = 3;');
    expect(html).toContain('imagePaths.length > OUTPUT_IMAGE_COLLECTION_THRESHOLD');
    expect(html).toContain('class="workspace-image-stack output-image-collection-stack" data-layout="flat"');
    expect(html).toContain('onmousemove="handleWorkspaceImageStackPointerMove(event)"');
    expect(html).toContain('onwheel="handleWorkspaceImageStackWheel(event)"');
    expect(html).toContain('onmouseleave="resetOutputImageCollectionFocus(event)"');
    expect(html).toContain("var flatLayout = stack.dataset.layout === 'flat';");
    expect(html).toContain('var flatSpacing = Math.max(');
    expect(html).toContain('compactFlatLayout ? 58 : 90');
    expect(html).toContain('width: min(100%, 860px);');
    expect(html).toContain('var r = flatLayout ? 0 : visibleRel * 7;');
    expect(html).toContain('border-radius: 0 !important;');
    expect(html).toContain('function applyOutputImageCollectionIntrinsicSize(img)');
    expect(html).toContain('var maxWidth = compact ? 150 : 220;');
    expect(html).toContain('var maxHeight = compact ? 104 : 152;');
    expect(html).toContain('maxWidth / img.naturalWidth');
    expect(html).toContain('maxHeight / img.naturalHeight');
    expect(html).toContain('onload="handleOutputImageCollectionThumbnailLoad(this)"');
    expect(html).toContain('background: transparent !important;');
    expect(html).toContain('renderOutputImageCollection(imagePaths, workDir)');
    expect(html).toContain('图片文件操作 ');
  });

  it('keeps only three file cards visible and folds the remaining verified artifacts', () => {
    expect(html).toContain('var OUTPUT_ATTACHMENT_VISIBLE_LIMIT = 3;');
    expect(html).toContain('var visiblePaths = cardPaths.slice(0, OUTPUT_ATTACHMENT_VISIBLE_LIMIT);');
    expect(html).toContain('var hiddenPaths = cardPaths.slice(OUTPUT_ATTACHMENT_VISIBLE_LIMIT);');
    expect(html).toContain('<details class="output-attachment-overflow">');
    expect(html).toContain("renderOutputAttachmentCards(verifiedCodexArtifacts, { workspaceContextText: parts.progress || '', verified: true })");
    expect(html).toContain('生成/更新文件（已验证）');
  });

  it('removes the raw verified path block from the final prose and initializes image stacks after rendering', () => {
    expect(html).toContain(".replace(/\\[\\[SH_VERIFIED_ARTIFACTS_BEGIN\\]\\][\\s\\S]*?\\[\\[SH_VERIFIED_ARTIFACTS_END\\]\\]/g, '')");
    expect(html).toContain('initWorkspaceImageStacks(contentDiv);');
    expect(html).toContain('initWorkspaceImageStacks(div);');
    expect(html).toContain('data-thumbnail-source-url="');
  });

  it('filters page-by-page document QA screenshots out of output attachments', () => {
    expect(html).toContain('function isTransientPageQaOutputPath(filePath)');
    expect(html).toContain('function filterUserFacingOutputAttachmentPaths(filePaths)');
    expect(html).toContain('return filterUserFacingOutputAttachmentPaths(paths).slice(0, 12);');
    expect(html).toContain("review(?:[-_][^\\/]*)?");
  });
});
