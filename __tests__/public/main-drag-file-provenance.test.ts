import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const preload = readFileSync(path.resolve(__dirname, '../../electron/preload.ts'), 'utf-8');
const chatBridgeRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');
const experimentRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/experiment-results.ts'), 'utf-8');

describe('main page dragged file provenance', () => {
  it('resolves the native file path through the Electron preload bridge', () => {
    expect(preload).toContain("webUtils } from 'electron'");
    expect(preload).toContain('webUtils.getPathForFile(file)');
    expect(html).toContain('function getLocalPathForUploadedFile(file)');
    expect(html).toContain('originalName: file.name');
    expect(html).toContain('lastModified: Number(file.lastModified || 0)');
    expect(html).toContain("inputSource: source === 'drop' ? 'drop' : 'file-picker'");
  });

  it('shows and uploads the original name and path', () => {
    expect(html).toContain("'原始路径：' + fileInfo.originalPath");
    expect(html).toContain("formData.append('sourceMetadata'");
    expect(html).toContain("formData.append('sourceFilePath'");
    expect(html).toContain('pathsRecorded: pathsRecorded');
  });

  it('preserves provenance in both backend upload flows and AI context', () => {
    expect(chatBridgeRoute).toContain('parseChatAttachmentSourceMetadata');
    expect(chatBridgeRoute).toContain('originalPath: source.originalPath');
    expect(chatBridgeRoute).toContain('lastModified: Number(source.lastModified || 0)');
    expect(chatBridgeRoute).toContain('originalPath: truncateForQueryEnvelope(attachment.originalPath');
    expect(chatBridgeRoute).toContain('原始本地路径=${originalPath}');
    expect(experimentRoute).toContain('const sourceFilePath = readUploadText');
    expect(experimentRoute).toContain('用户提供时的原始本地路径');
    expect(experimentRoute).toContain("originalPath: f.originalPath || ''");
  });

  it('keeps a concrete attachment question on the selected AI provider path', () => {
    expect(html).toContain('if (allPendingFilesAreImages && raw) return true;');
    expect(html).toContain('if (hasExperimentUploadIntent(raw)) return false;');
    expect(html).toContain('if (raw) return true;');
    expect(html).toContain('附件只是本轮 query 的材料');
  });

  it('keeps a reference image and workspace data in the same multimodal turn', () => {
    expect(html).toContain('function hasWorkspaceBackedVisualReferenceIntent(text)');
    expect(html).toContain('工作路径|工作目录|当前目录|本地路径|项目目录');
    expect(html).toContain('var requiresVisionForChat = hasVisionInputForMainChat() || hasChatAttachmentVision(pendingChatAttachments);');
    expect(html).toContain('chatBridgeRequestBody.requiresVision = true;');
    expect(html).toContain('chatBridgeRequestBody.workspaceDirectory = activeWorkspaceDirectory;');
    expect(html).toContain('chatBridgeRequestBody.codexImages = chatAttachmentImagePaths;');
  });
});
