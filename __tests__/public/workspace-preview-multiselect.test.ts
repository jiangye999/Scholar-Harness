import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();
const chatBridgeRoute = readFileSync(path.resolve(__dirname, '../../src/server/routes/chat-bridge.ts'), 'utf-8');

describe('workspace preview multi-select', () => {
  it('places the AI work folder on its own left-aligned status line', () => {
    expect(html).toContain('text-align: left;');
    expect(html).toContain('white-space: pre-line;');
    expect(html).toContain("'\\n当前会话 AI 工作文件夹：' + scopedAiWorkRoot");
  });

  it('renders selectable image and file cards with persistent selection state', () => {
    expect(html).toContain('workspacePreviewSelectedFiles = new Map()');
    expect(html).toContain('function renderWorkspacePreviewSelectionToggle(');
    expect(html).toContain('function toggleWorkspacePreviewSelection(');
    expect(html).toContain('role="checkbox"');
    expect(html).toContain('已选 ');
    expect(html).toContain('.workspace-image-card .workspace-preview-select-toggle');
    expect(html).toContain('width: 10px;');
  });

  it('adds selected paths to the query envelope and queue item', () => {
    expect(html).toContain('function mergeWorkspaceFileMentions(');
    expect(html).toContain('workspaceFileMentions: queuedWorkspaceFiles');
    expect(html).toContain('mergeWorkspaceFileMentions(extractWorkspaceFileMentions(message), selectedWorkspaceFiles)');
    expect(html).toContain("source: file.source || 'composer-workspace-mention'");
  });

  it('attaches selected images to vision processing', () => {
    expect(html).toContain('function mergeWorkspaceSelectedImageAttachments(');
    expect(html).toContain("source: 'workspace-preview-selection'");
    expect(html).toContain('pendingChatAttachments = mergeWorkspaceSelectedImageAttachments(');
  });

  it('requires the agent to read files selected by either UI route', () => {
    expect(chatBridgeRoute).toContain('用户通过 @ 或工作目录多选明确选择');
    expect(chatBridgeRoute).toContain('必须调用 read_file/office_view 等工具读取');
  });
});
