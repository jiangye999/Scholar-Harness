import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const html = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');

describe('Meta AI composer', () => {
  it('uses the same composer primitives as the main chat input', () => {
    const start = html.indexOf('<div class="meta-analysis-ai-panel meta-analysis-ai-input-panel">');
    const end = html.indexOf('<div class="meta-analysis-wizard-footer">', start);
    const source = html.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain('input-area-container meta-analysis-ai-composer');
    expect(source).toContain('class="chat-input meta-analysis-ai-input"');
    expect(source).toContain('class="composer-provider-selector"');
    expect(source).toContain('class="send-btn"');
    expect(source).toContain('triggerPdfWikiMetaUpload()');
    expect(source).not.toContain('模型顺序：Codex');
  });

  it('supports model selection, autosizing and stopping an active request', () => {
    expect(html).toContain('window.setPdfWikiMetaProvider = function(provider)');
    expect(html).toContain('window.autoResizePdfWikiMetaAiInput = function(input)');
    expect(html).toContain('window.stopPdfWikiMetaAnalysisAiPlan = function()');
    expect(html).toContain('signal: abortController.signal');
    expect(html).toContain('forceProvider: getComposerChatProvider()');
    expect(html).toContain("input.value = '';");
  });

  it('centers the single-line input and keeps the running control visually active', () => {
    expect(html).toContain('min-height: 48px !important;');
    expect(html).toContain('.meta-analysis-ai-composer .meta-analysis-ai-input:placeholder-shown');
    expect(html).toContain('padding-top: 18px !important;');
    expect(html).toContain('padding-bottom: 8px !important;');
    expect(html).toContain("input.style.height = '48px';");
    expect(html).toContain('.meta-analysis-ai-composer .composer-provider-option.active');
    expect(html).toContain('.meta-analysis-ai-composer .send-btn.can-stop:hover');
    expect(html).toContain('background: #111111;');
  });
});
