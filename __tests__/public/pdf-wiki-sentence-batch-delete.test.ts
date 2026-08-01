import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();
const server = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');
const manager = readFileSync(path.join(repoRoot, 'src/utils/pdf-wiki-manager.ts'), 'utf-8');

describe('PDF Wiki sentence claim batch deletion', () => {
  it('renders a checkbox for each sentence claim and selection controls', () => {
    expect(html).toContain('var pdfWikiSelectedSentencePointIds = {}');
    expect(html).toContain('data-sentence-argument-row="1"');
    expect(html).toContain('data-sentence-point-id="');
    expect(html).toContain('id="pdfWikiSentenceSelectAll"');
    expect(html).toContain('id="pdfWikiSentenceSelectedCount"');
    expect(html).toContain('id="pdfWikiSentenceDeleteButton"');
  });

  it('supports selecting visible filtered claims, clearing, and batch deletion', () => {
    expect(html).toContain('window.togglePdfWikiSentencePointSelection = function(pointId, selected)');
    expect(html).toContain('window.toggleAllVisiblePdfWikiSentencePoints = function(selected)');
    expect(html).toContain('window.clearPdfWikiSentencePointSelection = function()');
    expect(html).toContain('window.deleteSelectedPdfWikiSentencePoints = async function()');
    expect(html).toContain("fetch('/api/pdf-wiki/sentence-points/delete'");
    expect(html).toContain('body: JSON.stringify({ userId: currentUserId, pointIds: pointIds })');
  });

  it('connects the frontend action to a sentence-point-specific backend mutation', () => {
    expect(server).toContain('app.post("/api/pdf-wiki/sentence-points/delete"');
    expect(server).toContain('const pointIds = Array.isArray(req.body.pointIds)');
    expect(server).toContain('pdfWikiManager.deleteSentencePoints(userId, pointIds)');
    expect(manager).toContain('async deleteSentencePoints(userId: string, pointIds: string[])');
    expect(manager).toContain('store.sentenceCloud = this.buildSentenceCloudStore(retainedPoints)');
    expect(manager).toContain('await this.persistManualStoreUpdate(userId, store');
  });
});
