import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

import { readPublicAppSource } from '../helpers/public-app-source';

const repoRoot = path.resolve(__dirname, '..', '..');
const html = readPublicAppSource();
const server = readFileSync(path.join(repoRoot, 'src/server/local-server.ts'), 'utf-8');

describe('PDF Wiki automatic group matching', () => {
  it('runs backend matching after creating and renaming a group', () => {
    const createStart = server.indexOf('app.post("/api/pdf-wiki/pdf-groups"');
    const renameStart = server.indexOf('app.patch("/api/pdf-wiki/pdf-groups/:groupId"');
    const deleteStart = server.indexOf('app.delete("/api/pdf-wiki/pdf-groups/:groupId"');
    const createSource = server.slice(createStart, renameStart);
    const renameSource = server.slice(renameStart, deleteStart);

    expect(createSource).toContain('autoAssignPdfWikiGroupByName');
    expect(createSource).toContain('matchedCount: matchedPdfIds.length');
    expect(renameSource).toContain('autoAssignPdfWikiGroupByName');
    expect(renameSource).toContain('matchedCount: matchedPdfIds.length');
  });

  it('shows a non-blocking match count and explains additive rename behavior', () => {
    expect(html).toContain('setPdfWikiPdfManagerAutoGroupNotice(name, result.autoMatch);');
    expect(html).toContain('已按标题和摘要自动匹配');
    expect(html).toContain('已有标签不会被移除或覆盖');
  });
});
