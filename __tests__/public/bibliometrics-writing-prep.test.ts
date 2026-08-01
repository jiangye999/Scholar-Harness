import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src', 'public', 'bibliometrics.js'),
  'utf8'
);

describe('bibliometrics writing preparation toolbar', () => {
  it('removes the suggested-title bubble from the writing preparation UI', () => {
    const start = source.indexOf('function renderWritingPrep()');
    const end = source.indexOf('function renderWritingPrepActions()', start);
    const renderSource = source.slice(start, end);

    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(renderSource).not.toContain('prep.suggestedTitle');
    expect(renderSource).not.toContain('基于文献计量学的研究热点、主题演化与知识结构分析');
  });

  it('places prepared-data bubbles on the left and a single writing handoff on the right', () => {
    const start = source.indexOf('function renderWritingPrep()');
    const end = source.indexOf('function renderWritingPrepActions()', start);
    const renderSource = source.slice(start, end);

    expect(renderSource).toContain('data-bibliometrics-writing-bubble-toolbar');
    expect(renderSource).toContain('data-bibliometrics-writing-actions');
    expect(renderSource).toContain('justify-content:flex-end');
    expect(renderSource.indexOf("renderWritingPrepBubble('readiness'")).toBeLessThan(
      renderSource.indexOf('renderWritingPrepActions()')
    );
    expect(renderSource).not.toContain("renderWritingPrepBubble('draft'");
    expect(renderSource).toContain('margin-left:auto');
  });

  it('removes in-page drafting controls and hands writing to the main chat', () => {
    const actionsStart = source.indexOf('function renderWritingPrepActions()');
    const actionsEnd = source.indexOf('function renderPaperDraftWorkspace(', actionsStart);
    const actionsSource = source.slice(actionsStart, actionsEnd);
    const handoffStart = source.indexOf('window.startBibliometricsAssistedWriting');
    const handoffEnd = source.indexOf('function renderPaperDraftWorkspace(', handoffStart);
    const handoffSource = source.slice(handoffStart, handoffEnd);

    expect(actionsSource).toContain('startBibliometricsAssistedWriting()');
    expect(actionsSource).toContain('开始写作');
    expect(actionsSource).not.toContain('复制框架');
    expect(actionsSource).not.toContain('提取期刊风格');
    expect(actionsSource).not.toContain('生成论文草稿');
    expect(actionsSource).not.toContain('下载 MD');
    expect(handoffSource).toContain("window.activateMainAnalysisWorkflowHandoff('bibliometrics')");
    expect(handoffSource).toContain('closeBibliometricsDialog();');
    expect(source).toContain('function focusBibliometricsWritingComposer()');
    expect(source).toContain('window.expandMainContextSourceBar');
    expect(actionsSource).toContain('文献计量分析历史对话');
    expect(actionsSource).toContain('getBibliometricsConversationHistory');
    expect(actionsSource).toContain('openBibliometricsWritingConversation(this.value)');
    expect(handoffSource).toContain("window.newChat({ scope: 'bibliometrics' })");
    expect(handoffSource).toContain('window.loadConversation(normalizedConversationId)');
    expect(handoffSource.indexOf('Promise.resolve(navigationResult)')).toBeLessThan(
      handoffSource.indexOf("window.activateMainAnalysisWorkflowHandoff('bibliometrics')")
    );
  });

  it('uses the same compact height and corner radius as the action buttons', () => {
    const start = source.indexOf('function writingPrepBubbleStyle(active)');
    const end = source.indexOf('function renderWritingPrepBubble(', start);
    const styleSource = source.slice(start, end);

    expect(styleSource).toContain("'height:32px");
    expect(styleSource).toContain("';border-radius:6px");
    expect(styleSource).not.toContain('border-radius:999px');
    expect(styleSource).not.toContain('min-height:58px');
  });
});
