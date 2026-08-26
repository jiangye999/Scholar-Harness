import { readdirSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  readPublicAppSource,
  readPublicModuleSource,
  readPublicStyleSource
} from '../helpers/public-app-source';

const appSource = readPublicAppSource();
const moduleSource = readPublicModuleSource('app/chat-backgrounds.js');
const styleSource = readPublicStyleSource('styles/chat-backgrounds.css');
const colorThemeSource = readPublicStyleSource('styles/color-theme.css');
const shellLayoutSource = readPublicStyleSource('styles/shell-layout.css');
const backgroundDir = path.resolve(process.cwd(), 'src/public/theme-backgrounds');

describe('chat background themes', () => {
  it('offers a chat-background panel alongside the existing color themes', () => {
    expect(appSource).toContain('id="chatBackgroundTab"');
    expect(appSource).toContain('id="chatBackgroundPanel"');
    expect(appSource).toContain('id="chatBackgroundOptions"');
    expect(appSource).toContain('id="customChatBackgroundInput"');
    expect(appSource).toContain('id="chatBackgroundOpacity"');
    expect(appSource).toContain('id="chatBackgroundOpacityValue"');
    expect(appSource).toContain('背景透明度');
    expect(appSource).toContain('上传背景图片');
    expect(appSource).toContain('multiple');
  });

  it('renders the complete theme picker as a frosted-glass surface', () => {
    expect(colorThemeSource).toContain('.color-theme-picker {');
    expect(colorThemeSource).toContain('rgb(255 255 255 / 0.78)');
    expect(colorThemeSource).toContain('backdrop-filter: blur(24px) saturate(155%) contrast(1.03)');
    expect(styleSource).toContain('.chat-background-opacity-control');
    expect(styleSource).toContain('backdrop-filter: blur(16px) saturate(140%)');
    expect(styleSource).toContain('.chat-background-custom-action');
    expect(styleSource).toContain('background: rgb(255 255 255 / 0.64) !important;');
  });

  it('ships every optimized built-in background asset', () => {
    const backgrounds = readdirSync(backgroundDir)
      .filter((fileName) => /^chat-bg-\d{2,3}\.webp$/i.test(fileName))
      .sort((left, right) => {
        const leftIndex = Number(left.match(/\d+/)?.[0] || 0);
        const rightIndex = Number(right.match(/\d+/)?.[0] || 0);
        return leftIndex - rightIndex;
      });

    expect(backgrounds).toHaveLength(107);
    expect(backgrounds[0]).toBe('chat-bg-01.webp');
    expect(backgrounds[106]).toBe('chat-bg-107.webp');
    expect(moduleSource).toContain('var BUILTIN_BACKGROUND_COUNT = 107;');
    expect(moduleSource).toContain("return '/theme-backgrounds/chat-bg-'");
    expect(moduleSource).not.toContain("'内置背景 ' + padBackgroundNumber(index)");
    expect(moduleSource).toContain("(activeGroup ? activeGroup.label : '内置') + '背景'");
    expect(moduleSource).toContain('showLabel !== false');
  });

  it('paints the complete main chat workspace on an independently adjustable layer', () => {
    expect(moduleSource).toContain("document.getElementById('chatContainer')");
    expect(moduleSource).toContain("chatContainer.closest('.main-wrapper')");
    expect(moduleSource).toContain('return document.body || document.documentElement');
    expect(moduleSource).toContain("backgroundHost.classList.add('chat-background-active')");
    expect(moduleSource).toContain("backgroundHost.style.setProperty('--chat-background-image'");
    expect(moduleSource).not.toContain('document.documentElement.style');
    expect(styleSource).toContain('.chat-background-active .app::before');
    expect(styleSource).toContain('.chat-background-active .app > .main-wrapper');
    expect(styleSource).toContain('.main-wrapper.chat-background-active');
    expect(styleSource).toContain('.main-wrapper.chat-background-active::before');
    expect(styleSource).toContain('content: none');
    expect(styleSource).toContain('var(--chat-background-image)');
    expect(styleSource).toContain('opacity: var(--chat-background-opacity, 1)');
    expect(styleSource).toContain('#mainInputContainer');
    expect(styleSource).toContain('background-color: transparent !important');
  });

  it('keeps the background fixed while both sidebars use assistant-style glass', () => {
    expect(styleSource).toContain('.chat-background-active .sidebar,');
    expect(styleSource).toContain('.chat-background-active .right-sidebar');
    expect(styleSource).toContain('color-mix(in srgb, var(--theme-softer) 58%, transparent)');
    expect(styleSource).toContain('backdrop-filter: blur(18px) saturate(145%) contrast(1.03)');
    expect(styleSource).toContain('.chat-background-active .right-sidebar-header');
    expect(styleSource).toContain('.chat-background-active .sidebar-panel');
    expect(styleSource).toContain('background: transparent !important;');
    expect(styleSource).toContain('.chat-background-active .sidebar .new-chat:hover');
    expect(styleSource).toContain('background: color-mix(in srgb, var(--theme-softer) 66%, transparent) !important;');
    expect(styleSource).toContain('@media (prefers-reduced-transparency: reduce)');
  });

  it('persists background opacity in a dedicated right-aligned toolbar column', () => {
    expect(moduleSource).toContain("var CHAT_BACKGROUND_OPACITY_KEY = 'scholarharness_chat_background_opacity';");
    expect(moduleSource).toContain("if (value === null || value === undefined || value === '') return 100;");
    expect(moduleSource).toContain("backgroundHost.style.setProperty('--chat-background-opacity'");
    expect(moduleSource).toContain("mainWrapper.style.setProperty('--chat-background-opacity'");
    expect(moduleSource).toContain("localStorage.setItem(CHAT_BACKGROUND_OPACITY_KEY");
    expect(moduleSource).toContain("opacityInput.addEventListener('input'");
    expect(moduleSource).toContain("opacityInput.addEventListener('change'");
    expect(appSource).toContain('class="chat-background-toolbar"');
    expect(appSource).toContain('id="chatBackgroundOpacityControl"');
    expect(appSource).not.toContain('id="chatBackgroundOpacityTrigger"');
    expect(appSource).not.toContain('class="chat-background-opacity-icon"');
    expect(styleSource).toContain('.chat-background-opacity-control');
    expect(styleSource).toContain('.chat-background-toolbar');
    expect(styleSource).toContain('position: sticky');
    expect(styleSource).toContain('grid-template-columns: minmax(0, 1fr) 116px');
    expect(styleSource).toContain('grid-template-columns: 26px minmax(64px, 1fr)');
    expect(styleSource).toContain('min-width: 64px');
    expect(styleSource).toContain('justify-self: end');
    expect(styleSource).toContain('justify-content: flex-start');
  });

  it('uses theme-tinted frosted AI bubbles while separating transcript wrappers', () => {
    expect(colorThemeSource).toContain('.message.bot > .content:not(.agent-transcript-content)');
    expect(colorThemeSource).toContain('.message.bot .agent-transcript');
    expect(colorThemeSource).toContain('color-mix(in srgb, var(--theme-softer) 58%, transparent)');
    expect(colorThemeSource).toContain('backdrop-filter: blur(18px) saturate(145%) contrast(1.03)');
    expect(colorThemeSource).toContain('@media (prefers-reduced-transparency: reduce)');
    expect(colorThemeSource).toContain('background: var(--theme-softer) !important');
    expect(colorThemeSource).toContain('.content.agent-transcript-content');
    expect(colorThemeSource).toContain('background: transparent !important');
    expect(shellLayoutSource).toContain('margin-top: 12px');
  });

  it('uses readable frosted surfaces for AI tables and the composer', () => {
    expect(colorThemeSource).toContain('.message.bot .message-markdown-table-scroll');
    expect(colorThemeSource).toContain('color-mix(in srgb, var(--theme-softer) 48%, transparent)');
    expect(colorThemeSource).toContain('backdrop-filter: blur(16px) saturate(138%) contrast(1.02)');
    expect(colorThemeSource).toContain('.message.bot .message-markdown-table th,');
    expect(colorThemeSource).toContain('border-color: var(--theme-ink) !important;');
    expect(colorThemeSource).toContain('.input-area-container,');
    expect(colorThemeSource).toContain('color-mix(in srgb, var(--theme-softer) 78%, transparent)');
    expect(colorThemeSource).toContain('backdrop-filter: blur(20px) saturate(140%) contrast(1.03)');
  });

  it('keeps assistant footer separators on the selected theme color', () => {
    expect(colorThemeSource).toContain('.message.bot .message-footer');
    expect(colorThemeSource).toContain('border-top-color: var(--theme-primary) !important;');
  });

  it('clips scrolled messages at the top edge of the main composer', () => {
    expect(styleSource).toContain('.main-wrapper #chatContainer');
    expect(styleSource).toContain('--main-composer-clip-height');
    expect(appSource).toContain('var MAIN_CHAT_MESSAGE_CLIP_CLEARANCE_PX = 15');
    expect(appSource).toContain("inputContainer.querySelector('.input-area-container')");
    expect(appSource).toContain("main.style.setProperty('--main-composer-clip-height'");
  });

  it('hides the native main-chat scrollbar without disabling scrolling', () => {
    expect(shellLayoutSource).toContain('#chatContainer::-webkit-scrollbar');
    expect(shellLayoutSource).toContain('scrollbar-width: none');
  });

  it('persists built-in choices and multiple compressed custom backgrounds', () => {
    expect(moduleSource).toContain("var CHAT_BACKGROUND_KEY = 'scholarharness_chat_background';");
    expect(moduleSource).toContain("var CHAT_BACKGROUND_CUSTOM_KEY = 'scholarharness_chat_background_custom';");
    expect(moduleSource).toContain("var CHAT_BACKGROUND_DB_STORE = 'custom-backgrounds';");
    expect(moduleSource).toContain('database.createObjectStore(CHAT_BACKGROUND_DB_STORE');
    expect(moduleSource).toContain("label: '艺术纹理'");
    expect(moduleSource).toContain("label: '自定义'");
    expect(moduleSource.indexOf("label: '自定义'")).toBeGreaterThan(moduleSource.indexOf("label: '艺术纹理'"));
    expect(moduleSource).not.toContain("label: '推荐'");
    expect(moduleSource).toContain("canvas.toDataURL('image/webp'");
    expect(moduleSource).toContain('Array.from(input.files)');
    expect(moduleSource).toContain('await saveCustomBackgroundRecords(added)');
    expect(moduleSource).toContain('customBackgrounds = added.slice().reverse().concat(customBackgrounds)');
    expect(moduleSource).toContain('removeCustomBackgroundRecord(record.id)');
  });

  it('removes redundant secondary-model instructions from the primary-model dialog', () => {
    expect(appSource).not.toContain('小牛马配置请点击左侧');
    expect(appSource).not.toContain('在主页输入框右侧使用模型选择器切换当前模型');
  });
});
