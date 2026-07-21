import { readFileSync } from 'fs';
import path from 'path';
import * as vm from 'vm';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

function loadThumbnailCacheKeyHelper(): (img: unknown, sourceUrl: string) => string {
  const match = html.match(/function getOutputAttachmentThumbnailCacheKey\(img, sourceUrl\) \{[\s\S]*?\n    \}/);
  if (!match) throw new Error('Thumbnail cache-key helper was not found');
  const context = vm.createContext({});
  vm.runInContext(`${match[0]}\nthis.helper = getOutputAttachmentThumbnailCacheKey;`, context);
  return (context as unknown as {
    helper: (img: unknown, sourceUrl: string) => string;
  }).helper;
}

function loadConversationWorkspaceHelper(): (workspacePath: string, conversationId: string) => string {
  const match = html.match(/function buildConversationScopedAiWorkRoot\(workspacePath, conversationId\) \{[\s\S]*?\n    \}/);
  if (!match) throw new Error('Conversation workspace helper was not found');
  const context = vm.createContext({
    joinLocalRPath: (dir: string, name: string) => `${String(dir).replace(/[\\/]+$/g, '')}/${String(name).replace(/^[\\/]+/g, '')}`,
  });
  vm.runInContext(`${match[0]}\nthis.helper = buildConversationScopedAiWorkRoot;`, context);
  return (context as unknown as {
    helper: (workspacePath: string, conversationId: string) => string;
  }).helper;
}

describe('AI output attachment cache versioning', () => {
  it('uses the versioned preview URL instead of the reusable file path as cache identity', () => {
    const getCacheKey = loadThumbnailCacheKeyHelper();
    const image = {
      closest: () => ({
        getAttribute: () => 'D:\\workspace\\plots\\figure.png',
      }),
    };

    const first = getCacheKey(image, '/api/local-file/preview?path=figure.png&v=run_1');
    const second = getCacheKey(image, '/api/local-file/preview?path=figure.png&v=run_2');

    expect(first).not.toBe(second);
    expect(second).toContain('v=run_2');
  });

  it('bypasses the browser cache and carries the message workspace root to resolution', () => {
    expect(html).toContain("fetch(sourceUrl, { method: 'GET', cache: 'no-store' })");
    expect(html).toContain("fetch(state.previewUrl, { method: 'GET', cache: 'no-store' })");
    expect(html).toContain("params.set('preferLatest', '1')");
    expect(html).toContain('data-workspace-root="');
    expect(html).toContain('workspaceContextText: parts.progress ||');
  });

  it('isolates writable AI workspaces by conversation and does not reuse a mismatched pasted root', () => {
    const getWorkspaceRoot = loadConversationWorkspaceHelper();
    const first = getWorkspaceRoot('D:\\paper', 'conv-1');
    const second = getWorkspaceRoot('D:\\paper', 'conv-2');

    expect(first).not.toBe(second);
    expect(first).toContain('ScholarHarness_AI_Workspaces/Conversation-conv-1');
    expect(html).toContain("WORKSPACE_CONVERSATION_ROOTS_KEY = 'scholarharness_workspace_conversation_roots'");
    expect(html).toContain("joinLocalRPath(workspaceContainer, 'Conversation-' + safeConversationId)");
    expect(html).toContain("setting.permission === 'read-only'");
    expect(html).toContain('if (configured && isLocalPathWithinWorkspace(configured.path, pastedPath))');
    expect(html).toContain("aiWorkRoot: ''");
    expect(html).toContain("safeWorkRoot: ''");
  });
});
