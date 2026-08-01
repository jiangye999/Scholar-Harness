import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();
const manager = readFileSync(path.join(repoRoot, 'src/utils/pdf-wiki-manager.ts'), 'utf-8');

describe('PDF Wiki truthful progress reporting', () => {
  it('calculates percentage only from stable backend work units', () => {
    const start = html.indexOf('function getPdfWikiProgressMetrics');
    const end = html.indexOf('async function handleLiteratureFileInputChange', start);
    const factory = new Function(`${html.slice(start, end)}\nreturn getPdfWikiProgressMetrics;`);
    const calculate = factory() as (status: Record<string, unknown>) => Record<string, any>;

    const running = calculate({
      status: 'processing',
      totalPdfs: 4,
      processedPdfs: 1,
      failedPdfs: 0,
      workProgress: { completedUnits: 3, totalUnits: 9 },
    });
    const failed = calculate({
      status: 'error',
      totalPdfs: 4,
      processedPdfs: 1,
      failedPdfs: 0,
      workProgress: { completedUnits: 3, totalUnits: 9 },
    });
    const unknown = calculate({ status: 'processing', totalPdfs: 4, processedPdfs: 1 });
    const completed = calculate({ status: 'completed', totalPdfs: 4, processedPdfs: 3, failedPdfs: 1 });

    expect(running.percent).toBe(33);
    expect(failed.percent).toBe(33);
    expect(running.handledPdfs).toBe(1);
    expect(unknown).toMatchObject({ hasStableUnits: false, percent: 0 });
    expect(completed).toMatchObject({ percent: 100, handledPdfs: 4 });
  });

  it('does not increase progress from elapsed time or polling frequency', () => {
    const start = html.indexOf('function updatePdfWikiProgressUI');
    const end = html.indexOf("var response = await fetch('/api/upload'", start);
    const source = html.slice(start, end);

    expect(source).toContain('getPdfWikiProgressMetrics(progress)');
    expect(source).toContain('pdfWikiIndeterminateProgress');
    expect(source).toContain('真实步骤: ');
    expect(source).toContain('Codex 尝试: ');
    expect(source).not.toContain('pdfWikiProgressVisualPercent');
    expect(source).not.toContain('stage3WaitProgress');
    expect(source).not.toContain('stage1WaitProgress');
  });

  it('publishes heartbeats, attempt metadata, and stable fast-mode units', () => {
    expect(manager).toContain('workProgress?: PdfWikiWorkProgress');
    expect(manager).toContain('pdfs.length * 2 + 1');
    expect(manager).toContain("phase: 'preparing' | 'extracting' | 'codex' | 'finalizing' | 'completed'");
    expect(manager).toContain('heartbeatTimer = setInterval(emitHeartbeat, 10000)');
    expect(manager).toContain('Codex 正在处理第 ${attempt}/${maxAttempts} 次尝试');
    expect(manager).toContain('attemptElapsedMs');
  });

  it('waits for the real PDF Wiki terminal state without fixed time limits', () => {
    const textTaskStart = manager.indexOf('private async runCodexTextTask');
    const textTaskEnd = manager.indexOf('private async callCodexJsonTask', textTaskStart);
    const textTaskSource = manager.slice(textTaskStart, textTaskEnd);
    const directTaskStart = manager.indexOf('private async runCodexPdfWikiTask');
    const directTaskEnd = manager.indexOf('private async runCodexTextTask', directTaskStart);
    const directTaskSource = manager.slice(directTaskStart, directTaskEnd);
    const pollingStart = html.indexOf('if (shouldWaitForPdfWiki)');
    const pollingEnd = html.indexOf('// 仅在没有后台长任务时', pollingStart);
    const pollingSource = html.slice(pollingStart, pollingEnd);

    expect(textTaskSource).not.toContain('setTimeout(');
    expect(textTaskSource).not.toContain('timed out after');
    expect(directTaskSource).not.toContain('setTimeout(');
    expect(directTaskSource).not.toContain('timed out after');
    expect(pollingSource).not.toContain('pdfWikiWaitTimeout');
    expect(pollingSource).not.toContain('pdfWikiStartWait');
    expect(pollingSource).not.toContain('PDF Wiki wait timed out');
    expect(manager).toContain("if (status.taskKind !== 'meta-analysis') return status");
  });
});
