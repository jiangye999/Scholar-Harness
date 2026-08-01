import fs from 'fs';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  addPdfWikiPdfGroupToPdfs,
  addPdfWikiPdfGroupsToPdfs,
  assignPdfWikiPdfGroups,
  createPdfWikiPdfGroup,
  matchesPdfWikiPdfGroupQuery,
} from '../../src/utils/pdf-wiki-pdf-management';

const tempDirs: string[] = [];

afterEach(() => {
  tempDirs.splice(0).forEach(dir => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-wiki-groups-'));
  tempDirs.push(dir);
  return dir;
}

describe('PDF Wiki PDF group management', () => {
  it('matches group names against title and abstract text with AND/OR rules', () => {
    const searchText = 'Biochar application reduced N2O emissions in agricultural soil.';

    expect(matchesPdfWikiPdfGroupQuery(searchText, 'biochar')).toBe(true);
    expect(matchesPdfWikiPdfGroupQuery(searchText, 'biochar AND N2O')).toBe(true);
    expect(matchesPdfWikiPdfGroupQuery(searchText, 'microplastic OR agricultural soil')).toBe(true);
    expect(matchesPdfWikiPdfGroupQuery(searchText, 'biochar AND methane')).toBe(false);
  });

  it('adds an automatically matched group without overwriting existing labels', () => {
    const dataDir = makeTempDir();
    const userId = 'test-user';
    const firstStore = createPdfWikiPdfGroup(dataDir, userId, 'Existing');
    const existingGroupId = firstStore.groups[0].id;
    const secondStore = createPdfWikiPdfGroup(dataDir, userId, 'N2O');
    const autoGroupId = secondStore.groups[1].id;

    assignPdfWikiPdfGroups(dataDir, userId, 'pdf-1', [existingGroupId]);
    const result = addPdfWikiPdfGroupToPdfs(
      dataDir,
      userId,
      autoGroupId,
      ['pdf-1', 'pdf-2', 'pdf-2'],
    );

    expect(result.assignments['pdf-1']).toEqual([existingGroupId, autoGroupId]);
    expect(result.assignments['pdf-2']).toEqual([autoGroupId]);
  });

  it('adds multiple matched groups in one persistent update and remains idempotent', () => {
    const dataDir = makeTempDir();
    const userId = 'batch-user';
    const firstStore = createPdfWikiPdfGroup(dataDir, userId, 'N2O');
    const n2oGroupId = firstStore.groups[0].id;
    const secondStore = createPdfWikiPdfGroup(dataDir, userId, 'north china plain');
    const regionGroupId = secondStore.groups[1].id;

    const firstResult = addPdfWikiPdfGroupsToPdfs(dataDir, userId, {
      'pdf-1': [n2oGroupId, regionGroupId],
      'pdf-2': [n2oGroupId],
    });
    const secondResult = addPdfWikiPdfGroupsToPdfs(dataDir, userId, {
      'pdf-1': [n2oGroupId, regionGroupId],
      'pdf-2': [n2oGroupId],
    });

    expect(firstResult.assignments['pdf-1']).toEqual([n2oGroupId, regionGroupId]);
    expect(firstResult.assignments['pdf-2']).toEqual([n2oGroupId]);
    expect(secondResult.assignments).toEqual(firstResult.assignments);
  });
});
