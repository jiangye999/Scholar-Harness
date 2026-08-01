import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('AI output attachment collections', () => {
  it('renders more than three output images as non-overlapping responsive cards', () => {
    const renderStart = html.indexOf('function renderOutputImageCollection(imagePaths, workspaceRoot)');
    const renderEnd = html.indexOf('function renderOutputAttachmentCards', renderStart);
    const renderSource = html.slice(renderStart, renderEnd);

    expect(html).toContain('var OUTPUT_IMAGE_COLLECTION_THRESHOLD = 3;');
    expect(html).toContain('imagePaths.length > OUTPUT_IMAGE_COLLECTION_THRESHOLD');
    expect(renderSource).toContain('class="output-image-collection-grid"');
    expect(renderSource).toContain('张 · 并排展示');
    expect(renderSource).not.toContain('data-layout="flat"');
    expect(renderSource).not.toContain('onmousemove="handleWorkspaceImageStackPointerMove(event)"');
    expect(renderSource).not.toContain('onwheel="handleWorkspaceImageStackWheel(event)"');
    expect(renderSource).not.toContain('onmouseleave="resetOutputImageCollectionFocus(event)"');
    expect(html).toContain('.output-image-collection-grid {');
    expect(html).toContain('grid-template-columns: repeat(auto-fill, minmax(min(180px, 100%), 1fr));');
    expect(html).toContain('gap: 12px;');
    expect(html).toContain('aspect-ratio: 4 / 3;');
    expect(html).toContain('border-radius: 8px !important;');
    expect(html).not.toContain('function applyOutputImageCollectionIntrinsicSize(img)');
    expect(html).toContain('onload="handleOutputImageCollectionThumbnailLoad(this)"');
    expect(html).toContain('transform: translateY(-2px) !important;');
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

  it('does not turn save_draft receipts into workspace attachment cards', () => {
    expect(html).toContain('function isAgentDraftSaveReceiptLine(line)');
    expect(html).toContain('if (isAgentDraftSaveReceiptLine(line)) return;');
    expect(html).toContain('save_draft persists an application chapter draft');
  });

  it('rejects prose sentences as relative attachment names and verifies untrusted cards', () => {
    expect(html).toContain('function collectDeclaredWorkspaceRelativeCandidates(line, extPattern)');
    expect(html).toContain('the sentence itself can never become the filename.');
    expect(html).toContain('var proseTokenPattern = new RegExp(tokenPatternSource');
    expect(html).toContain('data-output-verified="');
    expect(html).toContain('async function validateOutputAttachmentCards(root)');
    expect(html).toContain("resolveOutputAttachmentLocalPath(node, { requireExisting: true })");
    expect(html).toContain("return options.requireExisting ? '' : target;");
    expect(html).not.toContain("!/(?:生成|写入|新建|保存|输出|图片|图像|文件|附件|artifact|figure|plot|export|saved|created|wrote|written)/i.test(line)");
  });

  it('detects the real image format and falls back to the original image when bitmap decoding is unsupported', () => {
    expect(html).toContain('function detectOutputAttachmentImageMime(arrayBuffer, declaredMime)');
    expect(html).toContain("return 'image/svg+xml';");
    expect(html).toContain("return mimeType === 'image/svg+xml' || mimeType === 'image/gif';");
    expect(html).toContain('Thumbnail optimization failed; using original image');
    expect(html).toContain('Image optimization failed; using original image');
    expect(html).toContain('服务端返回的内容不是图片');
  });

  it('shows only one card for PNG/SVG variants and mirrored copies of the same figure', () => {
    expect(html).toContain('function getOutputImageVariantDedupeKey(filePath)');
    expect(html).toContain('function dedupeOutputImageVariants(filePaths)');
    expect(html).toContain('function dedupeMirroredOutputAttachmentPaths(filePaths)');
    expect(html).toContain("normalized.indexOf('/scholarharness_ai_workspaces/') >= 0 ? 0 : 1000");
    expect(html).toContain('svg: 60');
    expect(html).toContain('png: 50');
    expect(html).toContain('return dedupeMirroredOutputAttachmentPaths(dedupeOutputImageVariants(filtered));');
  });
});
