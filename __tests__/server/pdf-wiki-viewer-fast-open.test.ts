import * as fs from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const serverSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'server', 'local-server.ts'),
  'utf-8'
);
const managerSource = fs.readFileSync(
  path.join(process.cwd(), 'src', 'utils', 'pdf-wiki-manager.ts'),
  'utf-8'
);
const publicSource = readPublicAppSource();

describe('Wiki argument library fast opening', () => {
  it('provides a bounded read-only first-screen response', () => {
    const routeStart = serverSource.indexOf('app.get("/api/pdf-wiki/entries",');
    const routeEnd = serverSource.indexOf('app.post("/api/pdf-wiki/upload/check-duplicates",', routeStart);
    const route = serverSource.slice(routeStart, routeEnd);

    expect(routeStart).toBeGreaterThanOrEqual(0);
    expect(routeEnd).toBeGreaterThan(routeStart);
    expect(route).toContain("const summaryOnly = String(req.query.summary || '') === '1'");
    expect(route).toContain('pdfWikiManager.getLightweightStatus(userId)');
    expect(route).toContain('pdfWikiManager.getViewerStoreSnapshot(userId)');
    expect(route).toContain('const pointLimit = Math.max(60, Math.min(500');
    expect(route).toContain('partial: publishablePoints.length > initialPoints.length');
  });

  it('caches the raw persisted viewer snapshot without running the full store pipeline', () => {
    expect(managerSource).toContain('private viewerStoreSnapshotCache = new Map');
    expect(managerSource).toContain('async getViewerStoreSnapshot(userId: string)');
    expect(managerSource).toContain('cached.mtimeMs === stat.mtimeMs && cached.size === stat.size');
    expect(managerSource).toContain('this.viewerStoreSnapshotCache.delete(safeUserId)');
  });

  it('renders the first screen before refreshing the complete library in the background', () => {
    expect(publicSource).toContain("url += '&summary=1&limit=240'");
    expect(publicSource).toContain('refreshPdfWikiViewerInBackground(pdfWikiActiveSentencePointId || pdfWikiActiveEntryId)');
    expect(publicSource).toContain('完整数据正在后台载入');
    expect(publicSource).toContain('pdfWikiViewerCacheScope');
  });

  it('exposes the Wiki library from PDF manager and uses the short product name', () => {
    expect(publicSource).toContain('onclick="openPdfWikiViewerFromPdfManager()"');
    expect(publicSource).toContain('>Wiki论点库</button>');
    expect(publicSource).not.toContain('PDF句子级Wiki论点库');
    expect(serverSource).toContain('"Wiki论点库"');
  });

  it('returns to the preserved PDF manager state when the library was opened there', () => {
    expect(publicSource).toContain("returnTarget: 'pdf-manager'");
    expect(publicSource).toMatch(
      /pdfWikiWorkspaceMode === 'pdf-reader' \|\| pdfWikiViewerReturnTarget === 'pdf-manager'/,
    );
    expect(publicSource).toContain('window.showPdfWikiPdfManager({');
    expect(publicSource).toContain('scrollTop: getPdfWikiPdfManagerScrollTop()');
  });
});
