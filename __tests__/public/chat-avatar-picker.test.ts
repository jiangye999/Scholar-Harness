import { existsSync, readFileSync, readdirSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const root = path.resolve(__dirname, '../..');
const html = readPublicAppSource();
const localServer = readFileSync(path.join(root, 'src/server/local-server.ts'), 'utf-8');
const avatarDir = path.join(root, 'src/public/avatars');

describe('chat avatar picker', () => {
  it('opens from chat avatars in the shared right sidebar', () => {
    expect(html).toContain('id="rightSidebarAvatarTab"');
    expect(html).toContain('id="rightSidebarAvatarPage"');
    expect(html).toContain("event.target.closest('.message .avatar.bot, .message .avatar.user')");
    expect(html).toContain("document.addEventListener('click'");
    expect(html).toContain('function openChatAvatarPicker(role)');
    expect(html).toContain("rightSidebarTransientTab = 'avatar'");
  });

  it('keeps independent AI/user selections and supports local custom uploads', () => {
    expect(html).toContain("scholarharness_chat_avatar_");
    expect(html).toContain("role === 'user' ? 'user' : 'bot'");
    expect(html).toContain('用户自定义');
    expect(html).toContain('+ 上传自定义');
    expect(html).toContain("fetch('/api/chat-avatars'");
    expect(html).toContain("method: 'DELETE'");
    expect(localServer).toContain('createChatAvatarRouter({ dataDir })');
  });

  it('updates avatar selection in place without resetting the picker scroll position', () => {
    expect(html).toContain('function syncChatAvatarPickerSelection(role)');
    expect(html).toContain('syncChatAvatarPickerSelection(normalizedRole);');
    expect(html).toContain("option.classList.toggle('selected', selected)");
    expect(html).toContain('var previousScrollTop = previousScrollContainer ? previousScrollContainer.scrollTop : 0;');
    expect(html).toContain('nextScrollContainer.scrollTop = previousScrollTop;');
  });

  it('preserves the visible chat message when opening the avatar sidebar', () => {
    expect(html).toContain('function captureMainChatViewportAnchor()');
    expect(html).toContain("chat.querySelectorAll('#messages > .message')");
    expect(html).toContain('followBottom: distanceFromBottom <= 48');
    expect(html).toContain('function restoreMainChatViewportAnchor(state)');
    expect(html).toContain('chat.scrollTop += offsetDelta;');
    expect(html).toContain('scheduleMainChatViewportRestore(mainChatViewportAnchor);');
  });

  it('ships the complete built-in avatar set', () => {
    expect(existsSync(avatarDir)).toBe(true);
    const avatars = readdirSync(avatarDir).filter(name => /^avatar-\d{2,3}\.png$/.test(name));
    expect(avatars).toHaveLength(120);
    expect(html).toContain('var CHAT_AVATAR_BUILTIN_COUNT = 120;');
  });
});
