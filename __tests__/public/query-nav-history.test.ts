import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('historical conversation query navigation', () => {
  it('stores the original user query independently of rendered layout', () => {
    expect(html).toContain("div.setAttribute('data-query-nav-text', normalizeQueryNavText(text));");
    expect(html).not.toContain("div.setAttribute('data-query-nav-text', normalizeQueryNavText(displayText));");
    expect(html).toContain("div.setAttribute('data-query-nav-text', normalizeQueryNavText(queueItem.message));");
    expect(html).toContain("element.setAttribute('data-query-nav-text', normalizeQueryNavText(queueItem.message));");
  });

  it('does not use innerText for offscreen history messages', () => {
    expect(html).toContain("messageEl.getAttribute('data-query-nav-text')");
    expect(html).toContain("normalizeQueryNavText(contentClone.textContent || '')");
    expect(html).not.toContain('content ? content.innerText : messageEl.innerText');
  });

  it('removes queue controls and message chrome from legacy fallback text', () => {
    expect(html).toContain("contentClone.querySelectorAll('.queued-query-meta, .message-footer, .msg-actions, .ai-disclaimer')");
    expect(html).toContain("messageEl.setAttribute('data-query-nav-text', fallbackText);");
  });

  it('keeps the navigation hover transparent and renders five active distance levels', () => {
    expect(html).toMatch(/\.query-nav-track\s*\{[^}]*gap:\s*2px;/);
    expect(html).toContain('background: transparent !important;');
    expect(html).toContain('.query-nav-dot.active-neighbor::before');
    expect(html).toContain('transform: translate(-50%, -50%) scale(2.1);');
    expect(html).toContain('.query-nav-dot.active-second-neighbor::before');
    expect(html).toContain('transform: translate(-50%, -50%) scale(1.68);');
    expect(html).toContain('.query-nav-dot.active-third-neighbor::before');
    expect(html).toContain('transform: translate(-50%, -50%) scale(1.4);');
    expect(html).toContain('.query-nav-dot.active::before');
    expect(html).toContain('transform: translate(-50%, -50%) scale(2.8);');
    expect(html).toContain("dotButtons[activeDotIndex - 1].classList.add('active-neighbor')");
    expect(html).toContain("dotButtons[activeDotIndex + 1].classList.add('active-neighbor')");
    expect(html).toContain("dotButtons[activeDotIndex - 2].classList.add('active-second-neighbor')");
    expect(html).toContain("dotButtons[activeDotIndex + 2].classList.add('active-second-neighbor')");
    expect(html).toContain("dotButtons[activeDotIndex - 3].classList.add('active-third-neighbor')");
    expect(html).toContain("dotButtons[activeDotIndex + 3].classList.add('active-third-neighbor')");
    expect(html).toMatch(/\.query-nav-dot::before\s*\{[\s\S]*?background:\s*var\(--theme-primary\) !important;/);
    expect(html).toMatch(/\.query-nav-dot\.active-third-neighbor::before,[\s\S]*?var\(--theme-primary\) 72%, #ffffff/);
    expect(html).toMatch(/\.query-nav-dot\.active-second-neighbor::before,[\s\S]*?var\(--theme-primary\) 50%, #ffffff/);
    expect(html).toMatch(/\.query-nav-dot\.active-neighbor::before,[\s\S]*?var\(--theme-primary\) 28%, #ffffff/);
    expect(html).toMatch(/\.query-nav-dot:hover::before,[\s\S]*?background:\s*#ffffff !important;/);
  });

  it('tracks the latest query against the composer edge instead of the old center threshold', () => {
    expect(html).toContain("document.getElementById('mainInputContainer')");
    expect(html).toContain('visibleBottom = Math.min(visibleBottom, composerRect.top)');
    expect(html).toContain('return Math.max(containerRect.top + 32, visibleBottom - 16)');
    expect(html).not.toContain('containerRect.height * 0.42');
    expect(html).toContain('queryNavPinnedMessageId = ensureQueryNavMessageId(div)');
  });

  it('uses five distance levels while previewing a hovered dot', () => {
    expect(html).toContain('.query-nav-dot.hover-focus::before');
    expect(html).toContain('.query-nav-dot.hover-neighbor::before');
    expect(html).toContain('.query-nav-dot.hover-second-neighbor::before');
    expect(html).toContain('.query-nav-dot.hover-third-neighbor::before');
    expect(html).toContain("button.classList.add('hover-focus')");
    expect(html).toContain("dotButtons[hoveredIndex - 1].classList.add('hover-neighbor')");
    expect(html).toContain("dotButtons[hoveredIndex + 1].classList.add('hover-neighbor')");
    expect(html).toContain("dotButtons[hoveredIndex - 2].classList.add('hover-second-neighbor')");
    expect(html).toContain("dotButtons[hoveredIndex + 2].classList.add('hover-second-neighbor')");
    expect(html).toContain("dotButtons[hoveredIndex - 3].classList.add('hover-third-neighbor')");
    expect(html).toContain("dotButtons[hoveredIndex + 3].classList.add('hover-third-neighbor')");
    expect(html).toContain('clearQueryNavHoverState()');
  });
});
