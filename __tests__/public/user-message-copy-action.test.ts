import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('user message bubble actions', () => {
  it('keeps AI bubbles wide while user bubbles shrink to content and stay right-aligned', () => {
    expect(html).toContain('--main-content-max-width: 900px;');
    expect(html).toContain('--chat-message-width-trim: 20px;');
    expect(html).toContain('--chat-message-avatar-outset: 57px;');
    expect(html).toContain('#messages {');
    expect(html).toContain('.input-wrapper { max-width: var(--main-content-max-width);');
    expect(html).toMatch(/\.message \{[\s\S]*?width: calc\(100% - var\(--chat-message-width-trim\)\);[\s\S]*?margin-right: auto;[\s\S]*?margin-left: auto;[\s\S]*?overflow: visible;/);
    expect(html).toMatch(/\.message > \.avatar\.bot,[\s\S]*?\.message > \.avatar\.user \{[\s\S]*?position: absolute;/);
    expect(html).toContain('left: calc(-1 * var(--chat-message-avatar-outset));');
    expect(html).toContain('right: calc(-1 * var(--chat-message-avatar-outset));');
    expect(html).toMatch(/\.message\.user \{[\s\S]*?justify-content: flex-end;/);
    expect(html).toMatch(/\.message\.user \.content \{[\s\S]*?flex: 0 1 auto;[\s\S]*?width: fit-content;[\s\S]*?max-width: 100%;[\s\S]*?margin-left: auto;/);
    expect(html).toMatch(/\.message\.bot:not\(\.pi-agent-message\) > \.content \{[\s\S]*?width: 100% !important;[\s\S]*?max-width: 100% !important;/);
    expect(html).toMatch(/\.message\.bot \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;/);
    expect(html).toMatch(/\.content \{[\s\S]*?min-height: var\(--chat-message-avatar-size\);[\s\S]*?padding: 7px 14px;/);
    expect(html).toMatch(/@media \(max-width: 720px\) \{[\s\S]*?\.message \.content \{[\s\S]*?padding-top: 4px;[\s\S]*?padding-bottom: 4px;/);
    expect(html).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(html).not.toContain('max-width: min(76%, 720px);');
    expect(html).not.toContain('width: calc(100% - 52px) !important;');
    expect(html).not.toContain('messageRect.width - 52');
    expect(html).toContain('var expectedWidth = Math.max(0, messageRect.width);');
    expect(html).toMatch(/\.agent-transcript-answer \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?box-sizing: border-box;/);
    expect(html).toContain("content.style.setProperty('width', '100%', 'important');");
    expect(html).toContain("content.style.setProperty('max-width', '100%', 'important');");
  });

  it('uses a borderless light-gray bubble with a bottom-right copy action', () => {
    expect(html).toContain('.message.user .content {');
    expect(html).toContain('border: 0 !important;');
    expect(html).toContain('background: #f3f4f6;');
    expect(html).toContain('.message.user .message-footer.user-message-footer');
    expect(html).toContain('top: calc(100% + 3px);');
    expect(html).toContain('right: 0;');
    expect(html).toContain('margin-bottom: 24px;');
    expect(html).toContain('function renderUserMessageFooter()');
    expect(html).toContain('class="user-message-copy-btn"');
    expect(html).toContain('.message.user .user-message-copy-btn:hover');
    expect(html).toContain('background: transparent !important;');
    expect(html).toContain('onclick="copyMessage(this)"');
    expect(html).toContain('aria-label="复制消息"');
    expect(html).toContain('stroke="currentColor" stroke-width="3"');
  });

  it('adds the copy action to shared, historical, and queued user messages', () => {
    expect(html).toContain(': renderUserMessageFooter();');
    expect(html.match(/formatMessage\(queueItem\.message\) \+\s*renderUserMessageFooter\(\)/g)?.length).toBe(2);
  });
});
