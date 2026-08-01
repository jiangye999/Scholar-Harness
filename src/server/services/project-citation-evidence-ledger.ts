import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../utils/logger';

export const PROJECT_CITATION_EVIDENCE_FILE_NAME = 'citation-evidence.json';
export const PROJECT_CITATION_EVIDENCE_SCHEMA_VERSION = 1;

export type ProjectCitationEvidenceWorkflow =
  | 'one-click-writing'
  | 'discussion-writing'
  | 'sentence-search'
  | 'citation-verification'
  | 'unknown';

export type ProjectCitationEvidenceSource =
  | 'embedding'
  | 'pdf-wiki'
  | 'project-ledger'
  | 'unknown';

export type ProjectCitationVerificationStatus =
  | 'pending'
  | 'reviewed'
  | 'needs-evidence'
  | 'completed'
  | 'blocked';

export interface ProjectCitationVerificationScope {
  sourceDocument?: string;
  inventoryComplete: boolean;
  targetSections: string[];
  expectedRecordCount?: number;
  supplementalPassComplete: boolean;
  updatedAt: string;
}

export interface ProjectCitationEvidenceReference {
  title: string;
  abstract: string;
  authors?: string;
  firstAuthor?: string;
  year?: string;
  journal?: string;
  doi?: string;
  citation?: string;
}

export interface ProjectCitationEvidenceSupport {
  relation?: string;
  score?: number;
  confidence?: number;
  evidenceSnippet?: string;
  reason?: string;
}

export interface ProjectCitationEvidenceRetrieval {
  query?: string;
  path?: string;
  recordId?: string;
}

export interface ProjectCitationEvidenceEntry {
  id: string;
  sentence: string;
  sentenceId?: string;
  section?: string;
  workflow: ProjectCitationEvidenceWorkflow;
  sourceLibrary: ProjectCitationEvidenceSource;
  reference: ProjectCitationEvidenceReference;
  support?: ProjectCitationEvidenceSupport;
  retrieval?: ProjectCitationEvidenceRetrieval;
  verificationStatus?: ProjectCitationVerificationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCitationEvidenceLedger {
  schemaVersion: 1;
  projectId?: string;
  projectRoot: string;
  createdAt: string;
  updatedAt: string;
  entries: ProjectCitationEvidenceEntry[];
  verificationScope?: ProjectCitationVerificationScope;
}

export interface ProjectCitationEvidenceEntryInput {
  sentence: string;
  sentenceId?: string;
  section?: string;
  workflow?: ProjectCitationEvidenceWorkflow;
  sourceLibrary?: ProjectCitationEvidenceSource;
  reference: ProjectCitationEvidenceReference;
  support?: ProjectCitationEvidenceSupport;
  retrieval?: ProjectCitationEvidenceRetrieval;
  verificationStatus?: ProjectCitationVerificationStatus;
}

interface UpsertProjectCitationEvidenceInput {
  projectRoot: string;
  projectId?: string;
  entries: ProjectCitationEvidenceEntryInput[];
}

const ledgerWriteChains = new Map<string, Promise<void>>();

function cleanSingleLine(value: unknown, maxLength = 2000): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanMultiline(value: unknown, maxLength = 30000): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function cleanOptionalNumber(value: unknown, min: number, max: number): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return undefined;
  return Math.max(min, Math.min(max, numberValue));
}

function normalizeForKey(value: unknown): string {
  return cleanSingleLine(value, 12000)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeProjectRoot(projectRoot: string): string {
  const cleaned = String(projectRoot || '').trim();
  if (!cleaned) {
    throw new Error('项目工作目录为空，无法保存项目级引用证据 JSON');
  }
  return path.resolve(cleaned);
}

function normalizeWorkflow(value: unknown): ProjectCitationEvidenceWorkflow {
  if (
    value === 'one-click-writing'
    || value === 'discussion-writing'
    || value === 'sentence-search'
    || value === 'citation-verification'
  ) {
    return value;
  }
  return 'unknown';
}

function normalizeSourceLibrary(value: unknown): ProjectCitationEvidenceSource {
  if (value === 'embedding' || value === 'pdf-wiki' || value === 'project-ledger') {
    return value;
  }
  return 'unknown';
}

function normalizeVerificationStatus(value: unknown): ProjectCitationVerificationStatus | undefined {
  if (
    value === 'pending'
    || value === 'reviewed'
    || value === 'needs-evidence'
    || value === 'completed'
    || value === 'blocked'
  ) {
    return value;
  }
  return undefined;
}

function normalizeVerificationScope(value: unknown): ProjectCitationVerificationScope | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const scope = value as Record<string, unknown>;
  const targetSections = Array.isArray(scope.targetSections)
    ? scope.targetSections.map(section => cleanSingleLine(section, 1000)).filter(Boolean)
    : [];
  return {
    sourceDocument: cleanSingleLine(scope.sourceDocument, 4000) || undefined,
    inventoryComplete: scope.inventoryComplete === true,
    targetSections: Array.from(new Set(targetSections)),
    expectedRecordCount: cleanOptionalNumber(scope.expectedRecordCount, 0, 10_000_000),
    supplementalPassComplete: scope.supplementalPassComplete === true,
    updatedAt: cleanSingleLine(scope.updatedAt, 100) || new Date().toISOString(),
  };
}

function getEntryIdentity(sentence: string, reference: ProjectCitationEvidenceReference): string {
  const referenceIdentity = normalizeForKey(reference.title)
    || normalizeForKey(reference.doi)
    || normalizeForKey(reference.citation);
  return crypto
    .createHash('sha256')
    .update(`${normalizeForKey(sentence)}\n${referenceIdentity}`)
    .digest('hex')
    .slice(0, 24);
}

function normalizeReference(reference: ProjectCitationEvidenceReference): ProjectCitationEvidenceReference {
  const title = cleanSingleLine(reference?.title, 4000);
  const abstract = cleanMultiline(reference?.abstract, 50000);
  return {
    title,
    abstract,
    authors: cleanSingleLine(reference?.authors, 4000) || undefined,
    firstAuthor: cleanSingleLine(reference?.firstAuthor, 500) || undefined,
    year: cleanSingleLine(reference?.year, 32) || undefined,
    journal: cleanSingleLine(reference?.journal, 1000) || undefined,
    doi: cleanSingleLine(reference?.doi, 500) || undefined,
    citation: cleanSingleLine(reference?.citation, 4000) || undefined,
  };
}

function normalizeEntryInput(
  input: ProjectCitationEvidenceEntryInput,
  now: string,
): ProjectCitationEvidenceEntry | null {
  const sentence = cleanMultiline(input?.sentence, 30000);
  const reference = normalizeReference(input?.reference || { title: '', abstract: '' });
  if (!sentence || !reference.title) return null;

  const support = input.support
    ? {
        relation: cleanSingleLine(input.support.relation, 100) || undefined,
        score: cleanOptionalNumber(input.support.score, 0, 100),
        confidence: cleanOptionalNumber(input.support.confidence, 0, 1),
        evidenceSnippet: cleanMultiline(input.support.evidenceSnippet, 12000) || undefined,
        reason: cleanMultiline(input.support.reason, 12000) || undefined,
      }
    : undefined;
  const retrieval = input.retrieval
    ? {
        query: cleanMultiline(input.retrieval.query, 12000) || undefined,
        path: cleanSingleLine(input.retrieval.path, 1000) || undefined,
        recordId: cleanSingleLine(input.retrieval.recordId, 1000) || undefined,
      }
    : undefined;

  return {
    id: getEntryIdentity(sentence, reference),
    sentence,
    sentenceId: cleanSingleLine(input.sentenceId, 500) || undefined,
    section: cleanSingleLine(input.section, 1000) || undefined,
    workflow: normalizeWorkflow(input.workflow),
    sourceLibrary: normalizeSourceLibrary(input.sourceLibrary),
    reference,
    support,
    retrieval,
    verificationStatus: normalizeVerificationStatus(input.verificationStatus),
    createdAt: now,
    updatedAt: now,
  };
}

function mergeDefined<T extends Record<string, unknown>>(previous: T | undefined, next: T | undefined): T | undefined {
  if (!previous && !next) return undefined;
  const merged = { ...(previous || {}), ...(next || {}) } as T;
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || value === '') {
      delete (merged as Record<string, unknown>)[key];
    }
  }
  return merged;
}

function mergeEntry(
  previous: ProjectCitationEvidenceEntry,
  next: ProjectCitationEvidenceEntry,
): ProjectCitationEvidenceEntry {
  return {
    ...previous,
    ...next,
    sentenceId: next.sentenceId || previous.sentenceId,
    section: next.section || previous.section,
    workflow: next.workflow === 'unknown' ? previous.workflow : next.workflow,
    sourceLibrary: next.sourceLibrary === 'unknown' ? previous.sourceLibrary : next.sourceLibrary,
    reference: {
      ...previous.reference,
      ...next.reference,
      title: next.reference.title || previous.reference.title,
      abstract: next.reference.abstract || previous.reference.abstract,
    },
    support: mergeDefined(
      previous.support as Record<string, unknown> | undefined,
      next.support as Record<string, unknown> | undefined,
    ) as ProjectCitationEvidenceSupport | undefined,
    retrieval: mergeDefined(
      previous.retrieval as Record<string, unknown> | undefined,
      next.retrieval as Record<string, unknown> | undefined,
    ) as ProjectCitationEvidenceRetrieval | undefined,
    verificationStatus: next.verificationStatus || previous.verificationStatus,
    createdAt: previous.createdAt || next.createdAt,
    updatedAt: next.updatedAt,
  };
}

function normalizeLoadedLedger(
  raw: unknown,
  projectRoot: string,
): ProjectCitationEvidenceLedger {
  const now = new Date().toISOString();
  const objectValue = raw && typeof raw === 'object'
    ? raw as Record<string, unknown>
    : {};
  const rawEntries = Array.isArray(objectValue.entries) ? objectValue.entries : [];
  const entries = rawEntries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const value = entry as Record<string, unknown>;
      const normalized = normalizeEntryInput({
        sentence: String(value.sentence || ''),
        sentenceId: String(value.sentenceId || ''),
        section: String(value.section || ''),
        workflow: normalizeWorkflow(value.workflow),
        sourceLibrary: normalizeSourceLibrary(value.sourceLibrary),
        reference: (value.reference || {}) as ProjectCitationEvidenceReference,
        support: value.support as ProjectCitationEvidenceSupport | undefined,
        retrieval: value.retrieval as ProjectCitationEvidenceRetrieval | undefined,
        verificationStatus: normalizeVerificationStatus(value.verificationStatus),
      }, cleanSingleLine(value.updatedAt, 100) || now);
      if (!normalized) return null;
      normalized.createdAt = cleanSingleLine(value.createdAt, 100) || normalized.createdAt;
      normalized.id = cleanSingleLine(value.id, 100) || normalized.id;
      return normalized;
    })
    .filter((entry): entry is ProjectCitationEvidenceEntry => Boolean(entry));

  return {
    schemaVersion: PROJECT_CITATION_EVIDENCE_SCHEMA_VERSION,
    projectId: cleanSingleLine(objectValue.projectId, 500) || undefined,
    projectRoot,
    createdAt: cleanSingleLine(objectValue.createdAt, 100) || now,
    updatedAt: cleanSingleLine(objectValue.updatedAt, 100) || now,
    entries,
    verificationScope: normalizeVerificationScope(objectValue.verificationScope),
  };
}

async function readLedgerFile(filePath: string, projectRoot: string): Promise<ProjectCitationEvidenceLedger> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return normalizeLoadedLedger(JSON.parse(content), projectRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return normalizeLoadedLedger({}, projectRoot);
    }
    if (error instanceof SyntaxError) {
      throw new Error(`项目级引用证据 JSON 无法解析，请先修复该文件：${filePath}`);
    }
    throw error;
  }
}

async function writeLedgerAtomic(filePath: string, ledger: ProjectCitationEvidenceLedger): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(ledger, null, 2)}\n`, 'utf-8');
  await fs.rename(temporaryPath, filePath);
}

async function withLedgerWriteLock<T>(filePath: string, action: () => Promise<T>): Promise<T> {
  const previous = ledgerWriteChains.get(filePath) || Promise.resolve();
  let release: (() => void) | undefined;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => current);
  ledgerWriteChains.set(filePath, chained);
  await previous.catch(() => undefined);
  try {
    return await action();
  } finally {
    release?.();
    void chained.finally(() => {
      if (ledgerWriteChains.get(filePath) === chained) {
        ledgerWriteChains.delete(filePath);
      }
    });
  }
}

export function getProjectCitationEvidenceLedgerPath(projectRoot: string): string {
  return path.join(normalizeProjectRoot(projectRoot), PROJECT_CITATION_EVIDENCE_FILE_NAME);
}

export async function readProjectCitationEvidenceLedger(
  projectRoot: string,
): Promise<ProjectCitationEvidenceLedger> {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  return readLedgerFile(getProjectCitationEvidenceLedgerPath(normalizedRoot), normalizedRoot);
}

export async function upsertProjectCitationEvidenceEntries(
  input: UpsertProjectCitationEvidenceInput,
): Promise<{ ledger: ProjectCitationEvidenceLedger; filePath: string; added: number; updated: number }> {
  const projectRoot = normalizeProjectRoot(input.projectRoot);
  const filePath = getProjectCitationEvidenceLedgerPath(projectRoot);
  const normalizedInputs = (Array.isArray(input.entries) ? input.entries : [])
    .map((entry) => normalizeEntryInput(entry, new Date().toISOString()))
    .filter((entry): entry is ProjectCitationEvidenceEntry => Boolean(entry));

  return withLedgerWriteLock(filePath, async () => {
    const ledger = await readLedgerFile(filePath, projectRoot);
    const byId = new Map(ledger.entries.map((entry) => [entry.id, entry]));
    let added = 0;
    let updated = 0;

    for (const entry of normalizedInputs) {
      const previous = byId.get(entry.id);
      if (previous) {
        byId.set(entry.id, mergeEntry(previous, entry));
        updated += 1;
      } else {
        byId.set(entry.id, entry);
        added += 1;
      }
    }

    const now = new Date().toISOString();
    const nextLedger: ProjectCitationEvidenceLedger = {
      schemaVersion: PROJECT_CITATION_EVIDENCE_SCHEMA_VERSION,
      projectId: cleanSingleLine(input.projectId, 500) || ledger.projectId,
      projectRoot,
      createdAt: ledger.createdAt || now,
      updatedAt: now,
      entries: Array.from(byId.values()).sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id)
      ),
      verificationScope: ledger.verificationScope,
    };
    await writeLedgerAtomic(filePath, nextLedger);
    logger.info(
      `[CitationEvidenceLedger] Saved ${normalizedInputs.length} records (${added} added, ${updated} updated) to ${filePath}`,
    );
    return { ledger: nextLedger, filePath, added, updated };
  });
}

export async function findProjectCitationEvidenceBySentence(
  projectRoot: string,
  sentence: string,
): Promise<ProjectCitationEvidenceEntry[]> {
  const normalizedSentence = normalizeForKey(sentence);
  if (!normalizedSentence) return [];
  const ledger = await readProjectCitationEvidenceLedger(projectRoot);
  return ledger.entries.filter((entry) => normalizeForKey(entry.sentence) === normalizedSentence);
}
