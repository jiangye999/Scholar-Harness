import * as fs from 'fs';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceDirectoryPreferenceStore } from '../../../src/server/services/workspace-directory-preference-store';

const scratchRoot = path.resolve('artifacts', 'scratch');
let testRoot = '';

beforeEach(() => {
  fs.mkdirSync(scratchRoot, { recursive: true });
  testRoot = fs.mkdtempSync(path.join(scratchRoot, 'workspace-directory-preference-'));
});

afterEach(() => {
  if (testRoot && testRoot.startsWith(`${scratchRoot}${path.sep}`)) {
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('WorkspaceDirectoryPreferenceStore', () => {
  it('persists settings by project and conversation across store instances', () => {
    const store = new WorkspaceDirectoryPreferenceStore(testRoot);
    const saved = store.save('web-user', 'project-paper-a', 'conv-a', {
      enabled: true,
      path: 'D:\\paper-a',
      permission: 'workspace-write',
      aiWorkRoot: 'D:\\paper-a\\ScholarHarness_AI_Workspaces\\Conversation-conv-a',
    });

    expect(saved.updatedAt).toBeGreaterThan(0);
    const restored = new WorkspaceDirectoryPreferenceStore(testRoot)
      .get('web-user', 'project-paper-a', 'conv-a');
    expect(restored.inheritedFromConversationId).toBe('');
    expect(restored.setting).toMatchObject({
      enabled: true,
      path: 'D:\\paper-a',
      permission: 'workspace-write',
    });
    expect(store.get('web-user', 'project-paper-b', 'conv-a').setting).toBeNull();
  });

  it('returns the last project setting for a newly-created conversation', () => {
    const store = new WorkspaceDirectoryPreferenceStore(testRoot);
    store.save('web-user', 'project-paper-a', 'conv-a', {
      enabled: true,
      path: 'E:\\current-paper',
      permission: 'read-only',
      aiWorkRoot: '',
    });

    const inherited = store.get('web-user', 'project-paper-a', 'conv-new');
    expect(inherited.inheritedFromConversationId).toBe('conv-a');
    expect(inherited.setting?.path).toBe('E:\\current-paper');
  });

  it('persists an explicit cleared state instead of restoring an older path', () => {
    const store = new WorkspaceDirectoryPreferenceStore(testRoot);
    store.save('web-user', '', 'conv-a', {
      enabled: true,
      path: 'D:\\old-paper',
      permission: 'workspace-write',
      aiWorkRoot: '',
    });
    store.save('web-user', '', 'conv-a', {
      enabled: false,
      path: '',
      permission: 'read-only',
      aiWorkRoot: '',
    });

    expect(store.get('web-user', '', 'conv-a').setting).toMatchObject({
      enabled: false,
      path: '',
      permission: 'read-only',
    });
  });
});
