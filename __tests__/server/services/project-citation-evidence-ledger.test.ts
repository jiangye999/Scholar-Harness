import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  PROJECT_CITATION_EVIDENCE_FILE_NAME,
  findProjectCitationEvidenceBySentence,
  readProjectCitationEvidenceLedger,
  upsertProjectCitationEvidenceEntries,
} from '../../../src/server/services/project-citation-evidence-ledger';

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scholar-citation-ledger-'));
  temporaryDirectories.push(projectRoot);
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    ),
  );
});

describe('project citation evidence ledger', () => {
  it('keeps one JSON file and merges the same sentence-reference pair', async () => {
    const projectRoot = await createProjectRoot();
    const sentence = 'Extreme rainfall can increase soil N2O emissions.';

    await upsertProjectCitationEvidenceEntries({
      projectRoot,
      projectId: 'project-1',
      entries: [{
        sentence,
        workflow: 'discussion-writing',
        sourceLibrary: 'embedding',
        reference: {
          title: 'Heavy rainfall stimulates more N2O emissions',
          abstract: 'Initial abstract.',
          doi: '10.1000/example',
        },
      }],
    });
    await upsertProjectCitationEvidenceEntries({
      projectRoot,
      projectId: 'project-1',
      entries: [{
        sentence,
        workflow: 'citation-verification',
        sourceLibrary: 'embedding',
        reference: {
          title: 'Heavy rainfall stimulates more N2O emissions',
          abstract: 'Updated abstract with evidence.',
          doi: '10.1000/example',
        },
        support: {
          relation: 'supports',
          score: 92,
          confidence: 0.91,
        },
      }],
    });

    const files = await fs.readdir(projectRoot);
    expect(files).toEqual([PROJECT_CITATION_EVIDENCE_FILE_NAME]);
    const ledger = await readProjectCitationEvidenceLedger(projectRoot);
    expect(ledger.projectId).toBe('project-1');
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].reference.abstract).toContain('Updated abstract');
    expect(ledger.entries[0].support?.score).toBe(92);
    expect(ledger.entries[0].workflow).toBe('citation-verification');
  });

  it('serializes concurrent updates without losing evidence', async () => {
    const projectRoot = await createProjectRoot();

    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        upsertProjectCitationEvidenceEntries({
          projectRoot,
          entries: [{
            sentence: `Sentence ${index + 1}`,
            workflow: 'one-click-writing',
            sourceLibrary: 'embedding',
            reference: {
              title: `Reference ${index + 1}`,
              abstract: `Abstract ${index + 1}`,
            },
          }],
        })
      ),
    );

    const ledger = await readProjectCitationEvidenceLedger(projectRoot);
    expect(ledger.entries).toHaveLength(12);
  });

  it('finds previously recorded evidence by normalized sentence text', async () => {
    const projectRoot = await createProjectRoot();
    await upsertProjectCitationEvidenceEntries({
      projectRoot,
      entries: [{
        sentence: 'Rainfall frequency altered soil nitrogen cycling.',
        workflow: 'sentence-search',
        sourceLibrary: 'embedding',
        reference: {
          title: 'Rainfall frequency and soil nitrogen',
          abstract: 'The study assessed rainfall frequency.',
        },
      }],
    });

    const matches = await findProjectCitationEvidenceBySentence(
      projectRoot,
      '  Rainfall frequency altered soil nitrogen cycling! ',
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].reference.title).toBe('Rainfall frequency and soil nitrogen');
  });

  it('updates the title-matched record when DOI and abstract are filled later', async () => {
    const projectRoot = await createProjectRoot();
    const sentence = 'Rewetting can trigger a short-lived N2O pulse.';
    const title = 'Rewetting effects on nitrous oxide emissions';

    await upsertProjectCitationEvidenceEntries({
      projectRoot,
      entries: [{
        sentence,
        workflow: 'discussion-writing',
        sourceLibrary: 'embedding',
        reference: {
          title,
          abstract: '',
        },
      }],
    });
    await upsertProjectCitationEvidenceEntries({
      projectRoot,
      entries: [{
        sentence,
        workflow: 'citation-verification',
        sourceLibrary: 'embedding',
        reference: {
          title,
          abstract: 'The experiment observed a transient N2O pulse after rewetting.',
          doi: '10.1000/rewetting',
        },
      }],
    });

    const ledger = await readProjectCitationEvidenceLedger(projectRoot);
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].reference.doi).toBe('10.1000/rewetting');
    expect(ledger.entries[0].reference.abstract).toContain('transient N2O pulse');
  });

  it('preserves exhaustive verification scope and entry status across automatic upserts', async () => {
    const projectRoot = await createProjectRoot();
    const filePath = path.join(projectRoot, PROJECT_CITATION_EVIDENCE_FILE_NAME);
    const now = new Date().toISOString();
    await fs.writeFile(filePath, JSON.stringify({
      schemaVersion: 1,
      projectRoot,
      createdAt: now,
      updatedAt: now,
      verificationScope: {
        sourceDocument: 'paper.docx',
        inventoryComplete: true,
        targetSections: ['Introduction', 'Discussion'],
        expectedRecordCount: 2,
        supplementalPassComplete: false,
        updatedAt: now,
      },
      entries: [{
        id: 'existing-entry',
        sentence: 'Sentence under review.',
        workflow: 'citation-verification',
        sourceLibrary: 'embedding',
        reference: {
          title: 'Existing reference',
          abstract: 'Existing abstract',
        },
        verificationStatus: 'needs-evidence',
        createdAt: now,
        updatedAt: now,
      }],
    }), 'utf-8');

    await upsertProjectCitationEvidenceEntries({
      projectRoot,
      entries: [{
        sentence: 'Another sentence.',
        workflow: 'discussion-writing',
        sourceLibrary: 'embedding',
        reference: {
          title: 'Another reference',
          abstract: 'Another abstract',
        },
      }],
    });

    const ledger = await readProjectCitationEvidenceLedger(projectRoot);
    expect(ledger.verificationScope).toMatchObject({
      inventoryComplete: true,
      targetSections: ['Introduction', 'Discussion'],
      expectedRecordCount: 2,
      supplementalPassComplete: false,
    });
    expect(ledger.entries.find(entry => entry.reference.title === 'Existing reference')?.verificationStatus)
      .toBe('needs-evidence');
  });
});
