import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('historical conversation query navigation', () => {
  it('stores the original user query independently of rendered layout', () => {
    expect(html).toContain("div.setAttribute('data-query-nav-text', normalizeQueryNavText(displayText));");
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
});
