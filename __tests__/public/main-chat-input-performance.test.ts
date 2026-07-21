import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(
  path.resolve(__dirname, '../../src/public/index.html'),
  'utf-8',
);

describe('main chat input responsiveness', () => {
  it('keeps native IME composition off synchronous layout work', () => {
    expect(html).toContain("userInput.addEventListener('compositionstart'");
    expect(html).toContain("userInput.addEventListener('compositionend'");
    expect(html).toContain("userInput.addEventListener('beforeinput', markMainChatInputPriority, true)");
    expect(html).toContain("userInput.addEventListener('keydown', markMainChatInputPriority, true)");
    expect(html).toContain('mainChatInputComposing || e.isComposing || e.keyCode === 229');
    expect(html).toContain('spellcheck="false"');
    expect(html).not.toContain('field-sizing: content');
  });

  it('defers textarea measurement until after the committed character can paint', () => {
    expect(html).toContain('MAIN_CHAT_INPUT_RESIZE_DELAY_MS = 48');
    expect(html).toContain('scheduleMainChatInputHeight(MAIN_CHAT_INPUT_RESIZE_DELAY_MS)');
    expect(html).toContain("userInput.style.height = '24px'");
    expect(html).toContain('if (mainChatInputNeedsShrinkMeasurement)');
    expect(html).toContain("userInput.style.overflowY = contentHeight > 128 ? 'auto' : 'hidden'");
  });

  it('does not rerender the Pi queue for each typed character', () => {
    expect(html).toContain('updateMainChatQueueButtonState({ renderQueue: false })');
    expect(html).toContain('if (options.renderQueue !== false)');
    expect(html).toContain('renderMainChatPiQueue(mainChatPiState)');
  });

  it('avoids global relational selectors and redundant autocomplete DOM writes', () => {
    expect(html).not.toContain(':has(');
    expect(html).toContain('.message.message-has-local-file-link');
    expect(html).toContain('function syncMessageLocalFileVisibilityClass(messageElement)');
    expect(html).toContain('if (mainChatInputComposing || (event && event.isComposing)) return;');
    expect(html).toContain("mentionDropdown.style.display !== 'block'");
    expect(html).toContain("slashDropdown.style.display !== 'block'");
  });

  it('isolates the composer from long transcript layout and tracks only height changes', () => {
    expect(html).toMatch(/\.main\s*\{[\s\S]*?position:\s*relative;[\s\S]*?contain:\s*layout style;/);
    expect(html).toMatch(/\.input-container\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?contain:\s*layout style;/);
    expect(html).toContain('--main-composer-overlay-height');
    expect(html).toContain('initMainChatComposerRenderIsland()');
    expect(html).toContain('mainChatComposerResizeObserver = new ResizeObserver');
    expect(html).toContain("nextHeight === mainChatComposerOverlayHeight");
  });

  it('coalesces streaming output and gives active typing priority', () => {
    expect(html).toContain('MAIN_CHAT_INPUT_PRIORITY_WINDOW_MS = 140');
    expect(html).toContain('MAIN_CHAT_FINAL_RENDER_QUIET_WINDOW_MS = 320');
    expect(html).toContain('renderedText = targetText');
    expect(html).toContain('inputQuietFor < inputPriorityWindow');
    expect(html).toContain("document.activeElement === userInput");
    expect(html).not.toContain('timer = setTimeout(tick, finalizing ? 8 : 14)');
    expect(html).not.toContain('targetText.slice(0, renderedText.length + step)');
  });

  it('uses stable text nodes while streaming and performs rich Markdown rendering only once at completion', () => {
    expect(html).toContain('function renderLightweightPlainText()');
    expect(html).toContain('function renderLightweightAgentTranscript()');
    expect(html).toContain("plain.className = 'streaming-message-text'");
    expect(html).toContain("logText.className = 'agent-transcript-stream-text'");
    expect(html).toContain('var maxLogCharacters = 24000');
    expect(html).toContain('if (isFinalRender)');
    expect(html).toContain('contentDiv.replaceChildren()');
  });

  it('grows the Codex transcript by content until the scroll-height cap is reached', () => {
    const bodyRule = html.match(
      /\.agent-transcript\.has-scroll-log\s+\.agent-transcript-body\s*\{([^}]*)\}/,
    )?.[1] || '';
    const declarations = bodyRule
      .split(';')
      .map((declaration) => declaration.trim())
      .filter(Boolean);

    expect(declarations).toContain('height: auto');
    expect(declarations).toContain('max-height: min(320px, 42vh)');
    expect(declarations).not.toContain('height: min(320px, 42vh)');
    expect(html).toMatch(
      /\.agent-transcript-stream-text\s*\{[\s\S]*?min-height:\s*0;/,
    );
  });

  it('does not let document-level Space navigation process textarea keystrokes', () => {
    expect(html).toContain(
      "target.closest('textarea, input, select, [contenteditable]:not([contenteditable=\"false\"]), [role=\"textbox\"]')",
    );
  });

  it('exposes passive Chromium input and long-task measurements for regression diagnosis', () => {
    expect(html).toContain("eventObserver.observe({ type: 'event', buffered: true, durationThreshold: 16 })");
    expect(html).toContain("longTaskObserver.observe({ type: 'longtask', buffered: false })");
    expect(html).toContain('window.getMainChatPerformanceSnapshot = getMainChatPerformanceSnapshot');
    expect(html).toContain('recordMainChatStreamRender(renderFinishedAt - renderStartedAt, renderedText.length)');
  });
});
