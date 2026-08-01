import { readFileSync } from 'fs';
import path from 'path';
import * as vm from 'vm';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

type WorkspaceSetting = {
  enabled: boolean;
  path: string;
  permission: string;
  aiWorkRoot: string;
};

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null;
    },
    setItem(key: string, value: string) {
      values.set(key, String(value));
    },
    removeItem(key: string) {
      values.delete(key);
    },
    key(index: number) {
      return Array.from(values.keys())[index] || null;
    },
    get length() {
      return values.size;
    },
  };
}

function loadWorkspaceDirectoryHelpers() {
  const start = html.indexOf("var WORKSPACE_DIRECTORY_KEY = 'scholarharness_workspace_directory'");
  const end = html.indexOf('function loadWorkspaceConversationRoots()', start);
  if (start < 0 || end < 0) throw new Error('Conversation workspace helper block was not found');

  const storage = createStorage({
    scholarharness_workspace_directory: JSON.stringify({
      enabled: true,
      path: 'D:\\legacy-paper',
      permission: 'workspace-write',
      aiWorkRoot: 'D:\\legacy-paper\\AI',
    }),
  });
  const context = vm.createContext({
    localStorage: storage,
    currentUserId: 'web-user',
    currentConversationId: 'conv-a',
    getHistory: () => [{ id: 'conv-a' }, { id: 'conv-b' }],
    clearWorkspacePreviewSelections: () => {},
    renderWorkspaceDirectoryPreview: () => {},
    renderWorkspaceDirectoryUi: () => {},
    Map,
    Date,
  });
  vm.runInContext(
    `${html.slice(start, end)}
     this.workspaceApi = {
       load: loadWorkspaceDirectorySetting,
       save: saveWorkspaceDirectorySetting,
       initialize: initializeWorkspaceDirectoryForConversation,
       markActive: markWorkspaceDirectoryConversationActive,
       activate: activateWorkspaceDirectoryConversation
     };`,
    context,
  );
  return {
    api: (context as unknown as {
      workspaceApi: {
        load: (conversationId: string) => WorkspaceSetting;
        save: (setting: WorkspaceSetting, conversationId: string) => void;
        initialize: (conversationId: string, previousConversationId?: string) => WorkspaceSetting;
        markActive: (conversationId: string) => void;
        activate: (conversationId: string) => void;
      };
    }).workspaceApi,
    storage,
  };
}

describe('conversation-scoped workspace directories', () => {
  it('migrates the old global setting and keeps later conversation changes isolated', () => {
    const { api, storage } = loadWorkspaceDirectoryHelpers();

    expect(api.load('conv-a').path).toBe('D:\\legacy-paper');
    expect(api.load('conv-b').path).toBe('D:\\legacy-paper');
    expect(storage.getItem('scholarharness_workspace_directory')).toBeNull();

    api.save(
      {
        enabled: true,
        path: 'D:\\paper-a',
        permission: 'workspace-write',
        aiWorkRoot: 'D:\\paper-a\\AI',
      },
      'conv-a',
    );
    api.initialize('conv-new', 'conv-a');
    expect(api.load('conv-new').path).toBe('D:\\paper-a');

    api.save(
      {
        enabled: true,
        path: 'E:\\paper-new',
        permission: 'danger-full-access',
        aiWorkRoot: 'E:\\paper-new\\AI',
      },
      'conv-new',
    );

    expect(api.load('conv-a').path).toBe('D:\\paper-a');
    expect(api.load('conv-b').path).toBe('D:\\legacy-paper');
    expect(api.load('conv-new').path).toBe('E:\\paper-new');

    api.save(
      {
        enabled: false,
        path: '',
        permission: 'read-only',
        aiWorkRoot: '',
      },
      'conv-new',
    );
    expect(api.load('conv-new').enabled).toBe(false);
    expect(api.load('conv-a').path).toBe('D:\\paper-a');
  });

  it('uses the last active conversation when creating a startup conversation', () => {
    const { api } = loadWorkspaceDirectoryHelpers();
    api.save(
      {
        enabled: true,
        path: 'D:\\last-active',
        permission: 'workspace-write',
        aiWorkRoot: '',
      },
      'conv-a',
    );
    api.markActive('conv-a');

    api.initialize('conv-startup');

    expect(api.load('conv-startup').path).toBe('D:\\last-active');
    expect(api.load('conv-a').path).toBe('D:\\last-active');
  });

  it('inherits the last configured workspace when opening a legacy history without an entry', () => {
    const { api } = loadWorkspaceDirectoryHelpers();
    api.save(
      {
        enabled: true,
        path: 'D:\\configured-paper',
        permission: 'workspace-write',
        aiWorkRoot: '',
      },
      'conv-a',
    );
    api.markActive('conv-a');

    api.activate('legacy-history');

    expect(api.load('legacy-history').path).toBe('D:\\configured-paper');
    expect(api.load('legacy-history').permission).toBe('workspace-write');
  });

  it('wires inheritance, switching, deletion, payloads, and project archives to conversation state', () => {
    expect(html).toMatch(
      /currentConversationId = chatOptions\.scope === 'bibliometrics'[\s\S]*?: createConversationId\(\);[\s\S]*?initializeWorkspaceDirectoryForConversation\(currentConversationId, oldConvId\);/,
    );
    const loadConversationStart = html.indexOf('async function loadConversation(convId)');
    const loadConversationEnd = html.indexOf('async function deleteConversation', loadConversationStart);
    const loadConversationSource = html.slice(loadConversationStart, loadConversationEnd);
    expect(loadConversationStart).toBeGreaterThan(-1);
    expect(loadConversationSource).toContain('currentConversationId = convId;');
    expect(loadConversationSource).toContain('activateWorkspaceDirectoryConversation(convId);');
    expect(loadConversationSource.indexOf('currentConversationId = convId;'))
      .toBeLessThan(loadConversationSource.indexOf('activateWorkspaceDirectoryConversation(convId);'));
    expect(html).toContain('deleteWorkspaceDirectorySetting(convId);');
    expect(html).toContain('initializeWorkspaceDirectoryForConversation(id);');
    expect(html).toContain('workspaceDirectoryStore: loadWorkspaceDirectoryStore(currentConversationId)');
    expect(html).toContain('workspaceConversationRoots: loadWorkspaceConversationRoots()');
    expect(html).toContain('var inspectionConversationId = ensureCurrentConversationId();');
    expect(html).toContain('if (inspectionConversationId !== currentConversationId) return;');
    expect(html).toMatch(
      /function getWorkspaceDirectoryPayload\(conversationId\) \{\s*var setting = loadWorkspaceDirectorySetting\(conversationId\);/,
    );
    expect(html).not.toContain("setting.permission === 'read-only') return ''");
    expect(html).toContain('aiWorkRoot: conversationAiWorkRoot');
    expect(html).toContain("conversationId: String(conversationId || currentConversationId || '').trim()");
    expect(html).toContain('onchange="handleWorkspaceDirectoryPermissionChange()"');
    expect(html).toContain('当前运行任务仍使用“');
    expect(html).toContain('新设置从下一轮任务生效');
    expect(html).toMatch(
      /activeMainChatWorkspaceSnapshot = activeWorkspaceDirectory\s*\?\s*Object\.assign\(\{\}, activeWorkspaceDirectory\)/,
    );
  });

  it('closes the workspace panel when clicking outside without closing for panel interactions', () => {
    expect(html).toContain('aria-controls="workspaceDirectoryPanel" aria-expanded="false"');
    expect(html).toContain("document.addEventListener('click', handleWorkspaceDirectoryOutsideClick);");
    expect(html).toContain("if (!panel || !panel.classList.contains('open')) return;");
    expect(html).toContain('panel.contains(target)');
    expect(html).toContain('button && button.contains(target)');
    expect(html).toContain('closeWorkspaceDirectoryPanel();');
  });
});
