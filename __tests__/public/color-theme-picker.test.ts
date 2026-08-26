import { describe, expect, it } from 'vitest';

import { readPublicAppSource, readPublicStyleSource } from '../helpers/public-app-source';

const app = readPublicAppSource();
const themeCss = readPublicStyleSource('styles/color-theme.css');

describe('color theme picker', () => {
  it('replaces the former black-white toggle with a persistent palette picker', () => {
    expect(app).toContain('id="colorThemePicker"');
    expect(app).toContain("var COLOR_THEME_KEY = 'scholarharness_color_theme'");
    expect(app).toContain('function applyColorTheme(theme, persist)');
    expect(app).toContain('function selectColorTheme(theme, event)');
    expect(app).toContain("document.documentElement.setAttribute('data-color-theme', normalized)");
    expect(app).toContain("localStorage.setItem(COLOR_THEME_KEY, normalized)");
  });

  it('offers a neutral default and multiple color families including pink', () => {
    for (const theme of [
      'ink',
      'pink',
      'ocean',
      'teal',
      'violet',
      'clay',
      'amber',
      'aurora',
      'crimson',
      'mountain',
      'magenta',
      'cocoa',
      'midnight',
      'royal',
      'orange',
      'peacock',
      'jade',
      'fluorescent',
      'pomegranate',
      'honey',
      'deepsea',
      'charcoal',
      'sweetpink',
      'ji-green',
      'lingxiao',
      'shanzhi',
      'wanxiang',
      'pinegreen',
      'fochi',
      'mogreen',
      'mossgreen',
      'oubi',
      'landy',
      'calyxgreen',
      'true-red',
      'liuli',
      'yuzi',
      'xungreen',
      'greentea',
      'inkgreen',
      'greenshen',
      'headdress-red',
      'tea',
      'goldred',
      'qinglu',
      'titian',
      'tiffany',
      'bordeaux',
      'botanical',
      'blackoak',
      'capri',
      'scarlet',
      'ink-teal',
      'chestnut-red',
      'berry',
      'blaze-orange',
      'electric-blue',
      'lime-green',
      'oak-blue',
      'dai-blue',
      'lang-green',
      'elegant-yellow',
      'kelai',
      'yin-red',
      'red-gold',
    ]) {
      expect(app).toContain(`data-color-theme-option="${theme}"`);
      expect(themeCss).toContain(`data-color-theme="${theme}"`);
    }
    expect(app).toContain('樱粉');
    expect(app).toContain('粉色 / 淡粉灰');
    expect(app).toContain('中国红');
    expect(app).toContain('山茶蓝');
    expect(app).toContain('午夜蓝');
    expect(app).toContain('克莱因蓝');
    expect(app).toContain('爱马仕橙');
    expect(app).toContain('马尔斯绿');
    expect(app).toContain('提香红');
    expect(app).toContain('蒂芙尼蓝');
    expect(app).toContain('波尔多红');
    expect(app).toContain('草木绿');
    expect(app).toContain('黑橡');
    expect(app).toContain('卡布里蓝');
    expect(app).toContain('绯红');
    expect(app).toContain('墨青');
    expect(app).toContain('栗红');
    expect(app).toContain('莓果红');
    expect(app).toContain('炽橙');
    expect(app).toContain('电光蓝');
    expect(app).toContain('青柠绿');
    expect(app).toContain('鹤顶');
    expect(app).toContain('橡兰');
    expect(app).toContain('黛蓝');
    expect(app).toContain('榔绿');
    expect(app).toContain('雅黄');
    expect(app).toContain("kelai: { label: '克菜'");
    expect(app).toContain('殷红');
    expect(app).toContain('赤金');
    expect(themeCss).toContain('--theme-primary: #0b3289;');
    expect(themeCss).toContain('--theme-primary: #ff8a00;');
    expect(themeCss).toContain('--theme-primary: #008c8d;');
    expect(themeCss).toContain('--theme-primary: #b05b24;');
    expect(themeCss).toContain('--theme-primary: #81cac4;');
    expect(themeCss).toContain('--theme-primary: #4a010a;');
    expect(themeCss).toContain('--theme-primary: #8ab04d;');
    expect(themeCss).toContain('--theme-primary: #202f39;');
    expect(themeCss).toContain('--theme-primary: #015697;');
    expect(themeCss).toContain('--theme-primary: #00e08e;');
    expect(themeCss).toContain('--theme-primary: #c23738;');
    expect(themeCss).toContain('--theme-primary: #034342;');
    expect(themeCss).toContain('--theme-primary: #8c4643;');
    expect(themeCss).toContain('--theme-primary: #d81e5b;');
    expect(themeCss).toContain('--theme-primary: #ff5f00;');
    expect(themeCss).toContain('--theme-primary: #0099ff;');
    expect(themeCss).toContain('--theme-primary: #bfff00;');
    expect(themeCss).toContain('--theme-primary: #bc3823;');
    expect(themeCss).toContain('--theme-primary: #212f3a;');
    expect(themeCss).toContain('--theme-primary: #584c5e;');
    expect(themeCss).toContain('--theme-primary: #555b37;');
    expect(themeCss).toContain('--theme-primary: #ffd217;');
    expect(themeCss).toContain('--theme-primary: #002e9f;');
    expect(themeCss).toContain('--theme-primary: #be002f;');
    expect(themeCss).toContain('--theme-primary: #f2be1d;');
    expect(app).toContain('royal|orange|peacock|jade|fluorescent');
    expect(app).toContain('titian|tiffany|bordeaux|botanical|blackoak|capri');
    expect(app).toContain('scarlet|ink-teal|chestnut-red|berry|blaze-orange');
    expect(app).toContain('oak-blue|dai-blue|lang-green|elegant-yellow|kelai|yin-red|red-gold');
  });

  it('removes the retired pale palettes and falls saved legacy values back to ink', () => {
    const retiredThemes = [
      'ice',
      'cloud',
      'mist',
      'mistpeach',
      'softmilk',
      'yingpink',
      'cranepink',
      'ancientwhite',
      'shallowcloud',
      'yellowwhite',
      'gao',
      'frost',
      'lychee',
      'aiqing',
      'beige',
      'shadowceladon',
      'bluewhite',
      'fuguang',
      'fishbelly',
    ];
    const retiredLabels = [
      '莹白',
      '乳白',
      '茶白',
      '雾粉桃',
      '柔奶白',
      '盈粉',
      '鹤粉',
      '古白',
      '浅云',
      '黄白游',
      '缟',
      '霜色',
      '荔枝白',
      '艾青绿',
      '米色',
      '影青',
      '青白',
      '扶光',
      '鱼肚白',
    ];
    for (const theme of retiredThemes) {
      expect(app).not.toContain(`data-color-theme-option="${theme}"`);
      expect(themeCss).not.toContain(`data-color-theme="${theme}"`);
    }
    for (const label of retiredLabels) {
      expect(app).not.toContain(`label: '${label}'`);
      expect(app).not.toContain(`<strong>${label}</strong>`);
    }
    expect(app).toContain("return Object.prototype.hasOwnProperty.call(COLOR_THEMES, theme) ? theme : 'ink';");
  });

  it('keeps the expanded picker concise without redundant explanatory copy', () => {
    expect(app).not.toContain('白色底面保持不变，黑色主元素和灰阶会切换为同一色系。');
    expect(app).not.toContain('id="colorThemeCurrentLabel"');
    expect(themeCss).toContain('max-height: min(388px, calc(100vh - 92px));');
  });

  it('keeps white surfaces white while deriving gray levels from the theme', () => {
    expect(themeCss).toContain('--bg-primary: #ffffff;');
    expect(themeCss).toContain('--bg-sidebar: #ffffff;');
    expect(themeCss).toContain('--modal-bg: #ffffff;');
    expect(themeCss).toContain('--bg-secondary: var(--theme-softer);');
    expect(themeCss).toContain('--bg-tertiary: var(--theme-soft);');
    expect(themeCss).toContain('--border-color: var(--theme-border);');
    expect(themeCss).toContain('--text-primary: var(--theme-ink);');
    expect(themeCss).toContain('--accent-color: var(--theme-primary);');
  });

  it('themes AI borders and user query bubbles with deep and pale palette tones', () => {
    expect(themeCss).toContain('.message.bot > .content');
    expect(themeCss).toContain('border-color: var(--theme-ink) !important;');
    expect(themeCss).toContain('.message.user > .content');
    expect(themeCss).toContain('color-mix(in srgb, var(--theme-softer) 54%, transparent)');
    expect(themeCss).toContain('backdrop-filter: blur(18px) saturate(145%) contrast(1.03)');
  });

  it('keeps the theme picker wide enough for two readable option columns', () => {
    expect(themeCss).toContain('width: min(720px, calc(100vw - 24px));');
    expect(themeCss).toContain('width: min(360px, calc(100vw - 20px)) !important;');
  });

  it('themes the homepage welcome title and greeting', () => {
    expect(themeCss).toContain('--brand-title-color: var(--theme-primary);');
    expect(themeCss).toContain('.empty-state .brand-title');
    expect(themeCss).toContain('color: var(--brand-title-color) !important;');
    expect(themeCss).toContain('.empty-state .typing-greeting');
    expect(themeCss).toContain('color: var(--theme-mid) !important;');
  });

  it('uses the exact primary color for titlebar and composer controls', () => {
    expect(themeCss).toContain('.app-titlebar-brand,');
    expect(themeCss).toContain('.app-chrome-icon-btn,');
    expect(themeCss).toContain('.input-area-container .upload-experiment-btn,');
    expect(themeCss).toContain('.input-area-container .main-context-source-trigger.composer-context-btn,');
    expect(themeCss).toContain('.composer-provider-current-model {');
    expect(themeCss).toContain('.app-chrome svg * {');
    expect(themeCss).toContain('.input-area-container .composer-left-actions svg *');
  });

  it('defines a visible swatch color for every legacy theme option', () => {
    for (const theme of [
      'ink',
      'pink',
      'ocean',
      'teal',
      'violet',
      'clay',
      'amber',
      'aurora',
      'crimson',
      'mountain',
      'magenta',
      'cocoa',
      'midnight',
      'royal',
      'orange',
      'peacock',
      'jade',
    ]) {
      expect(themeCss).toContain(`.color-theme-swatch-${theme} { --swatch-color:`);
    }
  });

  it('themes the user message copy icon and its copied checkmark', () => {
    expect(app).toContain("btn.classList.add('is-copied')");
    expect(app).toContain('stroke="currentColor" stroke-width="3"');
    expect(app).toContain('.user-message-copy-btn.is-copied');
    expect(app).toContain('color: var(--theme-mid) !important;');
    expect(app).toContain('color: var(--theme-ink) !important;');
  });

  it('maps the major black status and action surfaces to the selected primary color', () => {
    expect(themeCss).toContain('#mainChatPiQueuePanel.pi-queue-panel');
    expect(themeCss).toContain('.agent-transcript.is-running .agent-transcript-header');
    expect(themeCss).toContain('.message.bot .agent-transcript');
    expect(themeCss).toContain('border-color: var(--theme-ink) !important;');
    expect(themeCss).toContain('#pdfPaperChatReturnBar .pdf-paper-chat-return-btn');
    expect(themeCss).toContain('.mcp-market-search .mcp-online-search-btn');
    expect(themeCss).toContain('background: var(--theme-primary) !important;');
    expect(themeCss).toContain('background: var(--theme-primary-hover) !important;');
  });

  it('themes every query navigation dot instead of only the active dot', () => {
    expect(themeCss).toContain('.query-nav-dot::before {');
    // Every dot keeps one theme color; hover/current state is size-only.
    expect(themeCss).toContain('background: var(--theme-primary) !important;');
    expect(themeCss).not.toContain('.query-nav-dot.active-neighbor::before');
    expect(themeCss).not.toContain('.query-nav-dot.active-second-neighbor::before');
    expect(themeCss).not.toContain('.query-nav-dot.active-third-neighbor::before');
    expect(themeCss).not.toContain('.query-nav-dot.hover-neighbor::before');
    expect(themeCss).not.toContain('.query-nav-dot:hover::before,');
    expect(themeCss).not.toContain('.query-nav-dot.hover-focus::before {\n  background:');
    expect(themeCss).not.toContain('.query-nav-dot.active::before');
  });

  it('themes homepage and Meta composer buttons in idle and running states', () => {
    expect(themeCss).toContain('.input-area-container .send-btn.sending');
    expect(themeCss).toContain('.input-area-container .send-btn.can-stop');
    expect(themeCss).toContain('.input-area-container .send-btn.sending.queue-ready');
    expect(themeCss).toContain('#modalOverlay.meta-analysis-shared-composer-overlay #metaAiPlanBtn.sending');
    expect(themeCss).toContain('border-color: var(--theme-primary) !important;');
    expect(themeCss).toContain('stroke: currentColor !important;');
  });
});
