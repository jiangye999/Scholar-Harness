import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const html = readPublicAppSource();

describe('PDF Wiki topic workspace navigation', () => {
  it('renders the topic catalog inside the PDF Wiki viewer instead of a standalone modal', () => {
    expect(html).toContain("renderPdfWikiTopicWorkspace('PDF Wiki 用户主题库'");
    expect(html).not.toContain("showModal('PDF Wiki 用户主题库'");
  });

  it('pauses the graph before topic editing and restores the previous PDF Wiki workspace on return', () => {
    expect(html).toContain('pausePdfWikiNetworkForTopicDialog()');
    expect(html).toContain("navigation.originWorkspaceMode === 'pdf-manager'");
    expect(html).toContain('await reloadPdfWikiViewer(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId);');
  });

  it('uses a composed topic input card with clear manual and AI loading actions', () => {
    expect(html).toContain('class="pdf-wiki-topic-composer"');
    expect(html).toContain('pdf-wiki-topic-action-primary');
    expect(html).toContain('pdf-wiki-topic-action-spinner');
    expect(html).toContain('<span>正在扩写主题</span>');
  });

  it('offers persistent incremental AI sentence tagging with visible progress', () => {
    expect(html).toContain('AI 逐句主题标注');
    expect(html).toContain('AI 标注新增句子');
    expect(html).toContain('/api/pdf-wiki/topics/annotate-sentences');
    expect(html).toContain('/api/pdf-wiki/topics/annotation-status');
    expect(html).toContain('pdfWikiSentenceTopicAnnotationProgressValue');
    expect(html).toContain('本次返回未通过校验');
  });

  it('hides unclassified graph nodes by default and removes Vault actions from the argument toolbar', () => {
    expect(html).toContain('hideUnclassified: true');
    expect(html).toContain("runtime.topicFilterIds.has('topic:unclassified')");
    expect(html).not.toContain('<button id="pdfWikiObsidianExportBtn"');
    expect(html).not.toContain('<button id="pdfWikiObsidianDeployBtn"');
    expect(html).not.toContain('<button id="pdfWikiGalaxyViewBtn"');
    expect(html).not.toContain('<button id="pdfWikiObsidianSearchBtn"');
  });

  it('uses the PDF Wiki close control as back navigation while the topic workspace is active', () => {
    expect(html).toContain('onclick="handlePdfWikiViewerClose()">关闭</button>');
    expect(html).toContain('pdfWikiTopicDialogNavigation && typeof window.finishPdfWikiTopicDialog');
    expect(html).toContain('window.finishPdfWikiTopicDialog();');
  });
});
