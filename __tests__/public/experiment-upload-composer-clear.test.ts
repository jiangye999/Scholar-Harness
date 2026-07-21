import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readFileSync(path.join(repoRoot, 'src/public/index.html'), 'utf-8');

function sourceBetween(startMarker: string, endMarker: string): string {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

describe('experiment upload composer cleanup', () => {
  it('removes chat attachments from the composer before awaiting upload and restores them on failure', () => {
    const source = sourceBetween(
      'async function uploadPendingFilesAsChatAttachments()',
      'function isTabularExperimentFile',
    );

    expect(source).toContain('detachPendingExperimentFilesForSend(files);');
    expect(source.indexOf('detachPendingExperimentFilesForSend(files);')).toBeLessThan(
      source.indexOf("await fetch('/api/chat-bridge/attachments'"),
    );
    expect(source).toContain('restorePendingExperimentFilesAfterFailure(files);');
    expect(source).not.toContain('pendingExperimentFiles = [];');
  });

  it('hides the image-planning panel before long experiment analysis starts', () => {
    const source = sourceBetween(
      'async function uploadAndAnalyzeExperimentResultsCore(labels)',
      'function displayExperimentAnalysisResults',
    );

    expect(source).toContain('detachPendingExperimentFilesForSend(queuedFiles);');
    expect(source.indexOf('detachPendingExperimentFilesForSend(queuedFiles);')).toBeLessThan(
      source.indexOf('await uploadSingleExperimentResultFile'),
    );
    expect(source).toContain('completedFileCount = i + 1;');
    expect(source).toContain('restorePendingExperimentFilesAfterFailure(queuedFiles.slice(completedFileCount));');
    expect(source).not.toContain('pendingExperimentFiles = queuedFiles.slice(i + 1);');
  });
});
