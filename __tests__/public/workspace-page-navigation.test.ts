import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync(path.resolve(__dirname, '../../src/public/index.html'), 'utf-8');
const embeddingLibrary = readFileSync(path.resolve(__dirname, '../../src/public/embedding-library.js'), 'utf-8');
const bibliometrics = readFileSync(path.resolve(__dirname, '../../src/public/bibliometrics.js'), 'utf-8');

describe('workspace child page navigation', () => {
  it('opens the embedding library through the single child-page surface', () => {
    expect(embeddingLibrary).toContain("prepareStandaloneWorkspaceSurface('embeddingLibraryModal')");
    expect(embeddingLibrary).toContain("modal.className = 'app-secondary-overlay custom-fullscreen-overlay'");
    expect(indexHtml).toContain("'embeddingLibraryModal'");
  });

  it('opens bibliometrics through the same single child-page surface', () => {
    expect(bibliometrics).toContain("prepareStandaloneWorkspaceSurface('bibliometricsModal')");
    expect(bibliometrics).toContain("modal.className = 'app-secondary-overlay custom-fullscreen-overlay'");
    expect(indexHtml).toContain("'bibliometricsModal'");
  });

  it('cleans up nested dialogs together with their parent child pages', () => {
    expect(indexHtml).toContain("'embeddingDownloadDialog'");
    expect(indexHtml).toContain("'bibliometricsJournalStyleModal'");
    expect(embeddingLibrary).toContain("document.getElementById('embeddingDownloadDialog')");
    expect(embeddingLibrary).toContain("dialog.className = 'app-secondary-overlay app-tertiary-overlay'");
    expect(bibliometrics).toContain('closeBibliometricsJournalStyleDialog();');
    expect(bibliometrics).toContain("modal.className = 'app-secondary-overlay app-tertiary-overlay'");
  });

  it('closes the active child page before creating a new conversation', () => {
    const newChatStart = indexHtml.indexOf('function newChat()');
    const newChatEnd = indexHtml.indexOf('window.newChat = newChat;', newChatStart);
    const newChatSource = indexHtml.slice(newChatStart, newChatEnd);

    expect(newChatStart).toBeGreaterThan(-1);
    expect(newChatSource).toContain("prepareStandaloneWorkspaceSurface('')");
    expect(newChatSource.indexOf("prepareStandaloneWorkspaceSurface('')"))
      .toBeLessThan(newChatSource.indexOf('currentConversationId = createConversationId()'));
  });

  it('does not repeat academic workflow navigation inside the research enhancement page', () => {
    const start = indexHtml.indexOf('function showResearchEnhancementWorkspace(options)');
    const end = indexHtml.indexOf('window.showResearchEnhancementWorkspace = showResearchEnhancementWorkspace;', start);
    const source = indexHtml.slice(start, end);

    expect(start).toBeGreaterThan(-1);
    expect(source).toContain('科研增强工具');
    expect(source).not.toContain("renderAcademicWorkflowTopActions('research-enhancements')");
  });
});
