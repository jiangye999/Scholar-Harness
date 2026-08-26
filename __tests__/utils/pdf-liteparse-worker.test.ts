import { readFileSync } from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const liteParseSource = readFileSync(path.resolve(process.cwd(), 'src/utils/pdf-liteparse.ts'), 'utf-8');
const workerSource = readFileSync(path.resolve(process.cwd(), 'src/utils/pdf-liteparse-worker.ts'), 'utf-8');
const electronMain = readFileSync(path.resolve(process.cwd(), 'electron/main.ts'), 'utf-8');
const workspaceSource = readFileSync(path.resolve(process.cwd(), 'src/public/app/pdf-wiki-workspace.js'), 'utf-8');

describe('PDF heavy-task memory containment', () => {
  it('runs LiteParse in a bounded disposable worker outside tests', () => {
    expect(liteParseSource).toContain("fork(workerPath, [], {");
    expect(liteParseSource).toContain('LITEPARSE_WORKER_HEAP_MB');
    expect(liteParseSource).toContain('`--max-old-space-size=${workerHeapMb}`');
    expect(liteParseSource).toContain("'LITEPARSE_WORKER_OOM'");
    expect(workerSource).toContain('extractPdfTextWithLiteParseInProcess');
    expect(workerSource).toContain('process.exit(0)');
  });

  it('gives the local server a memory-aware heap limit', () => {
    expect(electronMain).toContain('resolveLocalServerHeapMb()');
    expect(electronMain).toContain('SCHOLAR_HARNESS_SERVER_HEAP_MB');
    expect(electronMain).toContain('NODE_OPTIONS: withNodeHeapOption');
  });

  it('always restores per-PDF action buttons after a settled request', () => {
    expect(workspaceSource).toContain('button && button.isConnected');
    expect(workspaceSource).toContain("button.textContent = isPdfWikiPdfRecognized(currentPdf) ? '重新识别PDF' : '识别PDF'");
    expect(workspaceSource).toContain("button.textContent = isPdfWikiPdfDeepAnalyzed(currentPdf) ? '重新分析' : '深入分析'");
  });
});
