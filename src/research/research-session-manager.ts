import * as crypto from 'crypto';
import * as path from 'path';
import { promises as fsp } from 'fs';
import { logger } from '../utils/logger';
import { getDataDir, sanitizeUserId } from '../utils/paths';
import { getProjectRuntimeContext } from '../utils/project-runtime-context';
import {
  extractDois,
  stylePass,
  verifyDois,
  type DoiVerificationResult,
  type StylePassResult,
} from './literature-review-tools';

export type ResearchSessionStatus = 'active' | 'completed' | 'archived';
export type ResearchProjectContextProvider = () => string | { projectId?: unknown } | null | undefined;
export type ResearchProvenanceTargetType =
  | 'paragraph'
  | 'figure'
  | 'table'
  | 'citation'
  | 'retrieval'
  | 'data-analysis'
  | 'r-code'
  | 'pdf-wiki'
  | 'memory'
  | 'writing'
  | 'review'
  | 'other';
export type ResearchArtifactKind =
  | 'writing'
  | 'paragraph'
  | 'figure'
  | 'table'
  | 'retrieval'
  | 'data-analysis'
  | 'r-code'
  | 'pdf-wiki'
  | 'memory'
  | 'review'
  | 'bundle'
  | 'other';
export type ResearchReviewSeverity = 'critical' | 'major' | 'minor' | 'info';

export interface ResearchSourceReference {
  id?: string;
  sourceType: 'embedding' | 'pdf-wiki' | 'memory' | 'data-file' | 'r-code' | 'manual' | 'autoresearch' | 'other';
  title?: string;
  authors?: string;
  year?: string | number;
  journal?: string;
  doi?: string;
  path?: string;
  location?: string;
  query?: string;
  score?: number;
  supportRelation?: string;
  supportConfidence?: number;
  evidenceSnippet?: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchCitationReference {
  citationText: string;
  referenceId?: string;
  title?: string;
  doi?: string;
  supportRelation?: string;
  supportConfidence?: number;
  evidenceSnippet?: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchDataReference {
  id?: string;
  label: string;
  filePath?: string;
  sheetName?: string;
  columns?: string[];
  rowCount?: number;
  statistic?: string;
  value?: string | number;
  pValue?: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchCodeReference {
  language: 'R' | 'Python' | 'Shell' | 'TypeScript' | 'Other';
  filePath?: string;
  contentHash?: string;
  command?: string;
  packageSnapshot?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ResearchProvenanceRecord {
  id: string;
  sessionId: string;
  userId: string;
  projectId: string;
  targetType: ResearchProvenanceTargetType;
  targetId: string;
  operation: string;
  sourceModule: string;
  version: number;
  createdAt: string;
  input?: unknown;
  output?: unknown;
  query?: string;
  model?: string;
  promptHash?: string;
  inputHash?: string;
  outputHash?: string;
  sources: ResearchSourceReference[];
  citations: ResearchCitationReference[];
  dataRefs: ResearchDataReference[];
  codeRefs: ResearchCodeReference[];
  artifactIds: string[];
  metadata?: Record<string, unknown>;
}

export interface ResearchArtifact {
  id: string;
  sessionId: string;
  userId: string;
  projectId: string;
  kind: ResearchArtifactKind;
  name: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  filePath?: string;
  contentType?: string;
  contentHash?: string;
  inputHash?: string;
  provenanceRecordIds: string[];
  reviewerReportIds: string[];
  metadata?: Record<string, unknown>;
}

export interface ResearchReviewFinding {
  id: string;
  severity: ResearchReviewSeverity;
  targetType: ResearchProvenanceTargetType | ResearchArtifactKind | 'session';
  targetId: string;
  message: string;
  recommendation?: string;
  provenanceRecordIds?: string[];
}

export interface ResearchReviewerReport {
  id: string;
  sessionId: string;
  userId: string;
  projectId: string;
  scope: 'session' | 'artifact';
  artifactId?: string;
  status: 'passed' | 'warnings' | 'failed';
  score: number;
  createdAt: string;
  checkedRecordCount: number;
  checkedArtifactCount: number;
  findings: ResearchReviewFinding[];
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchSessionSourceSnapshot {
  embeddingLibrary?: Record<string, unknown>;
  pdfWiki?: Record<string, unknown>;
  longTermMemory?: Record<string, unknown>;
  dataAnalysis?: Record<string, unknown>;
  rCode?: Record<string, unknown>;
  reviewWriter?: Record<string, unknown>;
  autoResearch?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ResearchSession {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  topic?: string;
  goal?: string;
  status: ResearchSessionStatus;
  createdAt: string;
  updatedAt: string;
  sources: ResearchSessionSourceSnapshot;
  provenance: ResearchProvenanceRecord[];
  artifacts: ResearchArtifact[];
  reviewerReports: ResearchReviewerReport[];
  metadata?: Record<string, unknown>;
}

export interface AppendResearchProvenanceInput {
  userId: string;
  projectId?: string;
  sessionId?: string;
  sessionTitle?: string;
  sessionTopic?: string;
  targetType: ResearchProvenanceTargetType;
  targetId?: string;
  operation: string;
  sourceModule: string;
  input?: unknown;
  output?: unknown;
  query?: string;
  model?: string;
  prompt?: string;
  sources?: ResearchSourceReference[];
  citations?: ResearchCitationReference[];
  dataRefs?: ResearchDataReference[];
  codeRefs?: ResearchCodeReference[];
  artifactIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface AppendResearchArtifactInput {
  userId: string;
  projectId?: string;
  sessionId?: string;
  sessionTitle?: string;
  sessionTopic?: string;
  kind: ResearchArtifactKind;
  name: string;
  filePath?: string;
  content?: string;
  contentType?: string;
  input?: unknown;
  provenanceRecordIds?: string[];
  reviewerReportIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface ResearchSessionSummary {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  topic?: string;
  status: ResearchSessionStatus;
  createdAt: string;
  updatedAt: string;
  provenanceCount: number;
  artifactCount: number;
  reviewerReportCount: number;
  latestReviewStatus?: ResearchReviewerReport['status'];
  latestReviewScore?: number;
}

export interface ReproducibleResearchBundle {
  schemaVersion: 1;
  exportedAt: string;
  userId: string;
  projectId: string;
  session: ResearchSession;
  reproducibilityIndex: {
    artifactId: string;
    artifactName: string;
    kind: ResearchArtifactKind;
    version: number;
    filePath?: string;
    contentHash?: string;
    provenance: Array<{
      recordId: string;
      targetType: ResearchProvenanceTargetType;
      operation: string;
      sourceModule: string;
      query?: string;
      model?: string;
      sourceCount: number;
      citationCount: number;
      dataRefCount: number;
      codeRefCount: number;
      createdAt: string;
    }>;
  }[];
  reviewerReports: ResearchReviewerReport[];
}

export interface ResearchEvidenceLedgerClaim {
  id: string;
  sessionId: string;
  targetType: ResearchProvenanceTargetType;
  targetId: string;
  operation: string;
  sourceModule: string;
  query?: string;
  model?: string;
  sourceCount: number;
  citationCount: number;
  artifactIds: string[];
  evidenceSnippets: string[];
  outputPreview?: string;
  createdAt: string;
}

export interface ResearchEvidenceLedgerDataItem {
  id: string;
  sessionId: string;
  targetType: ResearchProvenanceTargetType;
  targetId: string;
  operation: string;
  sourceModule: string;
  dataRefs: ResearchDataReference[];
  codeRefs: ResearchCodeReference[];
  artifactIds: string[];
  outputPreview?: string;
  createdAt: string;
}

export interface ResearchEvidenceLedgerArtifactItem {
  id: string;
  sessionId: string;
  kind: ResearchArtifactKind;
  name: string;
  version: number;
  filePath?: string;
  contentHash?: string;
  provenanceRecordIds: string[];
  reviewerReportIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ResearchEvidenceLedgerFindingItem extends ResearchReviewFinding {
  sessionId: string;
  reviewerReportId: string;
  reviewerStatus: ResearchReviewerReport['status'];
  reviewerScore: number;
  createdAt: string;
}

export interface ResearchEvidenceLedger {
  schemaVersion: 1;
  userId: string;
  projectId: string;
  generatedAt: string;
  sessionCount: number;
  recordCount: number;
  artifactCount: number;
  reviewerReportCount: number;
  sessions: ResearchSessionSummary[];
  claims: ResearchEvidenceLedgerClaim[];
  figuresAndData: ResearchEvidenceLedgerDataItem[];
  artifacts: ResearchEvidenceLedgerArtifactItem[];
  reviewerFindings: ResearchEvidenceLedgerFindingItem[];
}

interface SessionFileIndex {
  activeSessionId?: string;
  sessions: ResearchSessionSummary[];
}

const SESSION_SCHEMA_VERSION = 1;

export class ResearchSessionManager {
  private readonly rootDir: string;
  private readonly locks = new Map<string, Promise<void>>();
  private projectContextProvider?: ResearchProjectContextProvider;

  constructor(rootDir = path.join(getDataDir(), 'research-sessions')) {
    this.rootDir = rootDir;
  }

  setProjectContextProvider(provider: ResearchProjectContextProvider): void {
    this.projectContextProvider = provider;
  }

  async createSession(
    userId: string,
    input: { projectId?: string; title?: string; topic?: string; goal?: string; sources?: ResearchSessionSourceSnapshot; metadata?: Record<string, unknown> } = {}
  ): Promise<ResearchSession> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const projectId = this.resolveProjectId(input.projectId);
    return this.withUserLock(safeUserId, async () => {
      const session = await this.createSessionUnlocked(safeUserId, { ...input, projectId });
      logger.info(`[ResearchSession] Created session ${session.id} for ${safeUserId}`);
      return session;
    });
  }

  async getSession(userId: string, sessionId: string, projectId?: string): Promise<ResearchSession | null> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const file = this.getSessionPath(safeUserId, sessionId);
    try {
      const parsed = JSON.parse(await fsp.readFile(file, 'utf-8')) as ResearchSession & { schemaVersion?: number };
      return normalizeResearchSession(parsed, safeUserId, sessionId, resolvedProjectId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      logger.warn(`[ResearchSession] Failed to load session ${sessionId} for ${safeUserId}:`, error);
      return null;
    }
  }

  async getActiveSession(userId: string, projectId?: string): Promise<ResearchSession | null> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const index = await this.readIndex(safeUserId);
    if (!index.activeSessionId) return null;
    const session = await this.getSession(safeUserId, index.activeSessionId, resolvedProjectId);
    return session?.projectId === resolvedProjectId ? session : null;
  }

  async getOrCreateSession(
    userId: string,
    input: { projectId?: string; sessionId?: string; title?: string; topic?: string; goal?: string; sources?: ResearchSessionSourceSnapshot } = {}
  ): Promise<ResearchSession> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const projectId = this.resolveProjectId(input.projectId);
    return this.withUserLock(safeUserId, () => this.getOrCreateSessionUnlocked(safeUserId, { ...input, projectId }));
  }

  private async getOrCreateSessionUnlocked(
    safeUserId: string,
    input: { projectId: string; sessionId?: string; title?: string; topic?: string; goal?: string; sources?: ResearchSessionSourceSnapshot }
  ): Promise<ResearchSession> {
    if (input.sessionId) {
      const existing = await this.getSession(safeUserId, input.sessionId, input.projectId);
      if (existing && existing.projectId === input.projectId) return existing;
    }
    const active = await this.getActiveSession(safeUserId, input.projectId);
    if (active) return active;
    return this.createSessionUnlocked(safeUserId, input);
  }

  async listSessions(userId: string, projectId?: string): Promise<ResearchSessionSummary[]> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const sessions = await this.loadSessionsForProject(safeUserId, resolvedProjectId);
    return sessions.map(summarizeSession).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async updateSources(userId: string, sessionId: string, sources: ResearchSessionSourceSnapshot, projectId?: string): Promise<ResearchSession> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    return this.withUserLock(safeUserId, async () => {
      const session = await this.getSession(safeUserId, sessionId, resolvedProjectId);
      if (!session) throw new Error(`科研 session 不存在：${sessionId}`);
      if (session.projectId !== resolvedProjectId) throw new Error(`科研 session 不属于当前项目：${sessionId}`);
      session.sources = mergeSourceSnapshots(session.sources, sources);
      session.updatedAt = new Date().toISOString();
      await this.saveSessionUnlocked(session);
      await this.writeIndexUnlocked(safeUserId, session.id, resolvedProjectId);
      return session;
    });
  }

  async appendProvenance(input: AppendResearchProvenanceInput): Promise<{ session: ResearchSession; record: ResearchProvenanceRecord }> {
    const safeUserId = sanitizeUserId(input.userId || 'web-user');
    const projectId = this.resolveProjectId(input.projectId);
    return this.withUserLock(safeUserId, async () => {
      const session = await this.getOrCreateSessionUnlocked(safeUserId, {
        projectId,
        sessionId: input.sessionId,
        title: input.sessionTitle,
        topic: input.sessionTopic,
      });
      const targetId = input.targetId || this.createId(input.targetType.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
      const version = session.provenance.filter(record => record.targetType === input.targetType && record.targetId === targetId).length + 1;
      const record: ResearchProvenanceRecord = {
        id: this.createId('rp'),
        sessionId: session.id,
        userId: safeUserId,
        projectId: session.projectId,
        targetType: input.targetType,
        targetId,
        operation: input.operation,
        sourceModule: input.sourceModule,
        version,
        createdAt: new Date().toISOString(),
        input: input.input,
        output: input.output,
        query: cleanOptionalString(input.query),
        model: cleanOptionalString(input.model),
        promptHash: input.prompt ? hashString(input.prompt) : undefined,
        inputHash: input.input === undefined ? undefined : hashUnknown(input.input),
        outputHash: input.output === undefined ? undefined : hashUnknown(input.output),
        sources: input.sources || [],
        citations: input.citations || [],
        dataRefs: input.dataRefs || [],
        codeRefs: input.codeRefs || [],
        artifactIds: input.artifactIds || [],
        metadata: input.metadata,
      };
      session.provenance.push(record);
      session.updatedAt = record.createdAt;
      await this.saveSessionUnlocked(session);
      await this.writeIndexUnlocked(safeUserId, session.id, session.projectId);
      return { session, record };
    });
  }

  async appendArtifact(input: AppendResearchArtifactInput): Promise<{ session: ResearchSession; artifact: ResearchArtifact }> {
    const safeUserId = sanitizeUserId(input.userId || 'web-user');
    const projectId = this.resolveProjectId(input.projectId);
    return this.withUserLock(safeUserId, async () => {
      const session = await this.getOrCreateSessionUnlocked(safeUserId, {
        projectId,
        sessionId: input.sessionId,
        title: input.sessionTitle,
        topic: input.sessionTopic,
      });
      const now = new Date().toISOString();
      const existingVersions = session.artifacts.filter(item => item.name === input.name && item.kind === input.kind).length;
      const artifact: ResearchArtifact = {
        id: this.createId('ra'),
        sessionId: session.id,
        userId: safeUserId,
        projectId: session.projectId,
        kind: input.kind,
        name: input.name,
        version: existingVersions + 1,
        createdAt: now,
        updatedAt: now,
        filePath: cleanOptionalString(input.filePath),
        contentType: cleanOptionalString(input.contentType),
        contentHash: input.content !== undefined
          ? hashString(input.content)
          : input.filePath
            ? await hashFileIfExists(input.filePath)
            : undefined,
        inputHash: input.input === undefined ? undefined : hashUnknown(input.input),
        provenanceRecordIds: input.provenanceRecordIds || [],
        reviewerReportIds: input.reviewerReportIds || [],
        metadata: input.metadata,
      };
      session.artifacts.push(artifact);
      this.linkArtifactToProvenance(session, artifact.id, artifact.provenanceRecordIds);
      session.updatedAt = now;
      await this.saveSessionUnlocked(session);
      await this.writeIndexUnlocked(safeUserId, session.id, session.projectId);
      return { session, artifact };
    });
  }

  async runReviewer(userId: string, sessionId?: string, artifactId?: string, projectId?: string): Promise<{ session: ResearchSession; report: ResearchReviewerReport }> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    return this.withUserLock(safeUserId, async () => {
      const session = await this.getOrCreateSessionUnlocked(safeUserId, { sessionId, projectId: resolvedProjectId });
      const report = await buildReviewerReport(session, artifactId);
      session.reviewerReports.push(report);
      if (artifactId) {
        const artifact = session.artifacts.find(item => item.id === artifactId);
        if (artifact && !artifact.reviewerReportIds.includes(report.id)) {
          artifact.reviewerReportIds.push(report.id);
          artifact.updatedAt = report.createdAt;
        }
      }
      session.updatedAt = report.createdAt;
      await this.saveSessionUnlocked(session);
      await this.writeIndexUnlocked(safeUserId, session.id, session.projectId);
      return { session, report };
    });
  }

  async buildBundle(userId: string, sessionId: string, projectId?: string): Promise<ReproducibleResearchBundle> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const session = await this.getSession(safeUserId, sessionId, resolvedProjectId);
    if (!session) throw new Error(`科研 session 不存在：${sessionId}`);
    if (session.projectId !== resolvedProjectId) throw new Error(`科研 session 不属于当前项目：${sessionId}`);
    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      userId: safeUserId,
      projectId: session.projectId,
      session,
      reproducibilityIndex: session.artifacts.map(artifact => {
        const provenance = artifact.provenanceRecordIds
          .map(recordId => session.provenance.find(record => record.id === recordId))
          .filter((record): record is ResearchProvenanceRecord => Boolean(record))
          .map(record => ({
            recordId: record.id,
            targetType: record.targetType,
            operation: record.operation,
            sourceModule: record.sourceModule,
            query: record.query,
            model: record.model,
            sourceCount: record.sources.length,
            citationCount: record.citations.length,
            dataRefCount: record.dataRefs.length,
            codeRefCount: record.codeRefs.length,
            createdAt: record.createdAt,
          }));
        return {
          artifactId: artifact.id,
          artifactName: artifact.name,
          kind: artifact.kind,
          version: artifact.version,
          filePath: artifact.filePath,
          contentHash: artifact.contentHash,
          provenance,
        };
      }),
      reviewerReports: session.reviewerReports,
    };
  }

  async writeBundle(userId: string, sessionId: string, projectId?: string): Promise<{ bundle: ReproducibleResearchBundle; filePath: string }> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const bundle = await this.buildBundle(safeUserId, sessionId, resolvedProjectId);
    const bundleDir = path.join(this.getUserDir(safeUserId), 'bundles');
    await fsp.mkdir(bundleDir, { recursive: true });
    const filePath = path.join(bundleDir, `${sanitizeFileStem(resolvedProjectId)}-${sessionId}-reproducibility-bundle.json`);
    await writeJsonAtomic(filePath, bundle);
    await this.appendArtifact({
      userId: safeUserId,
      projectId: resolvedProjectId,
      sessionId,
      kind: 'bundle',
      name: `Reproducibility bundle ${sessionId}`,
      filePath,
      content: JSON.stringify(bundle),
      metadata: {
        artifactCount: bundle.session.artifacts.length,
        provenanceCount: bundle.session.provenance.length,
        reviewerReportCount: bundle.session.reviewerReports.length,
      },
    });
    return { bundle, filePath };
  }

  async buildEvidenceLedger(userId: string, projectId?: string): Promise<ResearchEvidenceLedger> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const sessions = await this.loadSessionsForProject(safeUserId, resolvedProjectId);
    const provenance = sessions.flatMap(session => session.provenance);
    const artifacts = sessions.flatMap(session => session.artifacts);
    const reviewerReports = sessions.flatMap(session => session.reviewerReports);
    const claimTargetTypes: ResearchProvenanceTargetType[] = ['paragraph', 'citation', 'writing', 'retrieval', 'pdf-wiki', 'memory'];
    const dataTargetTypes: ResearchProvenanceTargetType[] = ['figure', 'table', 'data-analysis', 'r-code'];

    return {
      schemaVersion: SESSION_SCHEMA_VERSION,
      userId: safeUserId,
      projectId: resolvedProjectId,
      generatedAt: new Date().toISOString(),
      sessionCount: sessions.length,
      recordCount: provenance.length,
      artifactCount: artifacts.length,
      reviewerReportCount: reviewerReports.length,
      sessions: sessions.map(summarizeSession),
      claims: provenance
        .filter(record => claimTargetTypes.includes(record.targetType))
        .map(record => ({
          id: record.id,
          sessionId: record.sessionId,
          targetType: record.targetType,
          targetId: record.targetId,
          operation: record.operation,
          sourceModule: record.sourceModule,
          query: record.query,
          model: record.model,
          sourceCount: record.sources.length,
          citationCount: record.citations.length,
          artifactIds: record.artifactIds,
          evidenceSnippets: collectEvidenceSnippets(record),
          outputPreview: previewUnknown(record.output, 1200),
          createdAt: record.createdAt,
        })),
      figuresAndData: provenance
        .filter(record => dataTargetTypes.includes(record.targetType))
        .map(record => ({
          id: record.id,
          sessionId: record.sessionId,
          targetType: record.targetType,
          targetId: record.targetId,
          operation: record.operation,
          sourceModule: record.sourceModule,
          dataRefs: record.dataRefs,
          codeRefs: record.codeRefs,
          artifactIds: record.artifactIds,
          outputPreview: previewUnknown(record.output, 1200),
          createdAt: record.createdAt,
        })),
      artifacts: artifacts.map(artifact => ({
        id: artifact.id,
        sessionId: artifact.sessionId,
        kind: artifact.kind,
        name: artifact.name,
        version: artifact.version,
        filePath: artifact.filePath,
        contentHash: artifact.contentHash,
        provenanceRecordIds: artifact.provenanceRecordIds,
        reviewerReportIds: artifact.reviewerReportIds,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
      })),
      reviewerFindings: reviewerReports.flatMap(report =>
        report.findings.map(finding => ({
          ...finding,
          sessionId: report.sessionId,
          reviewerReportId: report.id,
          reviewerStatus: report.status,
          reviewerScore: report.score,
          createdAt: report.createdAt,
        }))
      ),
    };
  }

  async writeEvidenceLedger(userId: string, projectId?: string): Promise<{ ledger: ResearchEvidenceLedger; filePath: string }> {
    const safeUserId = sanitizeUserId(userId || 'web-user');
    const resolvedProjectId = this.resolveProjectId(projectId);
    const ledger = await this.buildEvidenceLedger(safeUserId, resolvedProjectId);
    const ledgerDir = path.join(this.getUserDir(safeUserId), 'ledgers');
    await fsp.mkdir(ledgerDir, { recursive: true });
    const filePath = path.join(ledgerDir, `${sanitizeFileStem(resolvedProjectId)}-evidence-ledger.json`);
    await writeJsonAtomic(filePath, ledger);
    return { ledger, filePath };
  }

  private linkArtifactToProvenance(session: ResearchSession, artifactId: string, provenanceRecordIds: string[]): void {
    for (const record of session.provenance) {
      if (provenanceRecordIds.includes(record.id) && !record.artifactIds.includes(artifactId)) {
        record.artifactIds.push(artifactId);
      }
    }
  }

  private async readIndex(userId: string): Promise<SessionFileIndex> {
    const indexPath = this.getIndexPath(userId);
    try {
      const parsed = JSON.parse(await fsp.readFile(indexPath, 'utf-8')) as SessionFileIndex;
      return {
        activeSessionId: cleanOptionalString(parsed.activeSessionId),
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { sessions: [] };
      }
      logger.warn(`[ResearchSession] Failed to read index for ${userId}:`, error);
      return { sessions: [] };
    }
  }

  private async writeIndexUnlocked(userId: string, activeSessionId?: string, projectId?: string): Promise<void> {
    const userDir = this.getUserDir(userId);
    await fsp.mkdir(userDir, { recursive: true });
    const resolvedProjectId = this.resolveProjectId(projectId);
    const files = await fsp.readdir(userDir).catch(() => []);
    const summaries: ResearchSessionSummary[] = [];
    for (const file of files.filter(item => item.endsWith('.json') && item !== 'index.json')) {
      const sessionId = file.replace(/\.json$/, '');
      const session = await this.getSession(userId, sessionId, resolvedProjectId);
      if (session) summaries.push(summarizeSession(session));
    }
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const existing = await this.readIndex(userId);
    await writeJsonAtomic(this.getIndexPath(userId), {
      activeSessionId: activeSessionId || existing.activeSessionId || summaries[0]?.id,
      sessions: summaries,
    });
  }

  private async saveSessionUnlocked(session: ResearchSession): Promise<void> {
    const userDir = this.getUserDir(session.userId);
    await fsp.mkdir(userDir, { recursive: true });
    await writeJsonAtomic(this.getSessionPath(session.userId, session.id), {
      schemaVersion: SESSION_SCHEMA_VERSION,
      ...session,
    });
  }

  private async createSessionUnlocked(
    safeUserId: string,
    input: { projectId: string; title?: string; topic?: string; goal?: string; sources?: ResearchSessionSourceSnapshot; metadata?: Record<string, unknown> }
  ): Promise<ResearchSession> {
    const now = new Date().toISOString();
    const session: ResearchSession = {
      id: this.createId('rs'),
      userId: safeUserId,
      projectId: input.projectId,
      title: cleanSessionTitle(input.title || input.topic || '科研会话'),
      topic: cleanOptionalString(input.topic),
      goal: cleanOptionalString(input.goal),
      status: 'active',
      createdAt: now,
      updatedAt: now,
      sources: input.sources || {},
      provenance: [],
      artifacts: [],
      reviewerReports: [],
      metadata: input.metadata,
    };
    await this.saveSessionUnlocked(session);
    await this.writeIndexUnlocked(safeUserId, session.id, session.projectId);
    return session;
  }

  private async loadSessionsForProject(userId: string, projectId: string): Promise<ResearchSession[]> {
    const userDir = this.getUserDir(userId);
    const files = await fsp.readdir(userDir).catch(() => []);
    const sessions: ResearchSession[] = [];
    for (const file of files.filter(item => item.endsWith('.json') && item !== 'index.json')) {
      const sessionId = file.replace(/\.json$/, '');
      const session = await this.getSession(userId, sessionId, projectId);
      if (session && session.projectId === projectId) {
        sessions.push(session);
      }
    }
    return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  private getUserDir(userId: string): string {
    const projectRoot = getProjectRuntimeContext()?.projectRoot;
    const rootDir = projectRoot ? path.join(projectRoot, 'research-sessions') : this.rootDir;
    return path.join(rootDir, sanitizeUserId(userId || 'web-user'));
  }

  private getSessionPath(userId: string, sessionId: string): string {
    return path.join(this.getUserDir(userId), sanitizeFileStem(sessionId) + '.json');
  }

  private getIndexPath(userId: string): string {
    return path.join(this.getUserDir(userId), 'index.json');
  }

  private createId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
  }

  private resolveProjectId(projectId?: string): string {
    const explicit = normalizeProjectId(projectId);
    if (explicit) return explicit;
    const runtimeProjectId = normalizeProjectId(getProjectRuntimeContext()?.projectId);
    if (runtimeProjectId) return runtimeProjectId;
    if (!this.projectContextProvider) return 'current-workspace';
    try {
      const value = this.projectContextProvider();
      if (typeof value === 'string') {
        return normalizeProjectId(value) || 'current-workspace';
      }
      if (value && typeof value === 'object') {
        return normalizeProjectId(value.projectId) || 'current-workspace';
      }
    } catch (error) {
      logger.warn('[ResearchSession] Failed to resolve project context:', error);
    }
    return 'current-workspace';
  }

  private async withUserLock<T>(userId: string, operation: () => Promise<T>): Promise<T> {
    const current = this.locks.get(userId) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });
    this.locks.set(userId, next);
    try {
      await current;
      return await operation();
    } finally {
      release();
      if (this.locks.get(userId) === next) {
        this.locks.delete(userId);
      }
    }
  }
}

export const researchSessionManager = new ResearchSessionManager();

export function summarizeSession(session: ResearchSession): ResearchSessionSummary {
  const latestReview = session.reviewerReports[session.reviewerReports.length - 1];
  return {
    id: session.id,
    userId: session.userId,
    projectId: session.projectId,
    title: session.title,
    topic: session.topic,
    status: session.status,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    provenanceCount: session.provenance.length,
    artifactCount: session.artifacts.length,
    reviewerReportCount: session.reviewerReports.length,
    latestReviewStatus: latestReview?.status,
    latestReviewScore: latestReview?.score,
  };
}

async function buildReviewerReport(session: ResearchSession, artifactId?: string): Promise<ResearchReviewerReport> {
  const createdAt = new Date().toISOString();
  const targetArtifacts = artifactId
    ? session.artifacts.filter(item => item.id === artifactId)
    : session.artifacts;
  const targetRecordIds = new Set(targetArtifacts.flatMap(item => item.provenanceRecordIds));
  const records = artifactId
    ? session.provenance.filter(record => targetRecordIds.has(record.id))
    : session.provenance;
  const findings: ResearchReviewFinding[] = [];
  const doiCandidates = new Map<string, string[]>();

  for (const record of records) {
    collectRecordDois(record, doiCandidates);
    if ((record.targetType === 'paragraph' || record.targetType === 'citation') && record.sources.length === 0 && record.citations.length === 0) {
      findings.push({
        id: makeFindingId(),
        severity: record.targetType === 'citation' ? 'critical' : 'major',
        targetType: record.targetType,
        targetId: record.targetId,
        message: record.targetType === 'citation'
          ? '引用记录缺少来源文献或引用判定，无法复核该引用。'
          : '段落记录缺少来源文献或引用判定，无法追踪段落证据。',
        recommendation: '为该段落或引用补充检索词、来源文献、证据支持关系和引用判定。',
        provenanceRecordIds: [record.id],
      });
    }
    if ((record.targetType === 'figure' || record.targetType === 'table' || record.targetType === 'data-analysis') && record.dataRefs.length === 0) {
      findings.push({
        id: makeFindingId(),
        severity: 'major',
        targetType: record.targetType,
        targetId: record.targetId,
        message: '图表/数据分析记录缺少数据来源引用，无法复核数据一致性。',
        recommendation: '记录原始数据文件、sheet、列名、样本量和统计量。',
        provenanceRecordIds: [record.id],
      });
    }
    if ((record.targetType === 'figure' || record.targetType === 'r-code') && record.codeRefs.length === 0) {
      findings.push({
        id: makeFindingId(),
        severity: 'minor',
        targetType: record.targetType,
        targetId: record.targetId,
        message: '图表/R 作图记录缺少代码引用或代码哈希，复现性不完整。',
        recommendation: '保存 R/Python 脚本路径、代码哈希和运行命令。',
        provenanceRecordIds: [record.id],
      });
    }
    const unsupported = record.citations.filter(citation => {
      const relation = String(citation.supportRelation || '').toLowerCase();
      return relation === 'irrelevant' || relation === 'contradicts';
    });
    if (unsupported.length > 0) {
      findings.push({
        id: makeFindingId(),
        severity: 'critical',
        targetType: record.targetType,
        targetId: record.targetId,
        message: `发现 ${unsupported.length} 条引用被标记为反向或无关，不能作为正向证据。`,
        recommendation: '移除这些引用，或将正文改写为反向/不确定证据表述。',
        provenanceRecordIds: [record.id],
      });
    }
  }

  for (const artifact of targetArtifacts) {
    const artifactText = await readArtifactTextForReview(artifact);
    for (const doi of extractDois(artifactText)) {
      addDoiCandidate(doiCandidates, doi, `artifact:${artifact.id}`);
    }
    appendStylePassFindings(findings, artifact, artifactText);
    if (artifact.provenanceRecordIds.length === 0 && artifact.kind !== 'bundle') {
      findings.push({
        id: makeFindingId(),
        severity: 'major',
        targetType: artifact.kind,
        targetId: artifact.id,
        message: 'artifact 没有关联 provenance 记录，无法复现生成过程。',
        recommendation: '将该 artifact 与检索、数据、代码或写作记录绑定。',
      });
    }
    if ((artifact.kind === 'figure' || artifact.kind === 'table' || artifact.kind === 'writing') && !artifact.contentHash && !artifact.filePath) {
      findings.push({
        id: makeFindingId(),
        severity: 'minor',
        targetType: artifact.kind,
        targetId: artifact.id,
        message: 'artifact 缺少文件路径或内容哈希，版本追踪不完整。',
        recommendation: '保存文件路径或内容哈希，后续修改时递增版本。',
      });
    }
  }

  const doiVerification = await verifyDoiCandidatesForReviewer(doiCandidates);
  appendDoiVerificationFindings(findings, doiVerification, records, targetArtifacts);

  if (!artifactId && session.provenance.length === 0 && session.artifacts.length === 0) {
    findings.push({
      id: makeFindingId(),
      severity: 'info',
      targetType: 'session',
      targetId: session.id,
      message: '当前科研 session 还没有 provenance 或 artifact。',
      recommendation: '完成一次检索、写作、数据分析或作图后再运行审查。',
    });
  }

  const score = calculateReviewScore(findings);
  const status: ResearchReviewerReport['status'] = findings.some(item => item.severity === 'critical')
    ? 'failed'
    : findings.some(item => item.severity === 'major' || item.severity === 'minor')
      ? 'warnings'
      : 'passed';
  return {
    id: `rr_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    sessionId: session.id,
    userId: session.userId,
    projectId: session.projectId,
    scope: artifactId ? 'artifact' : 'session',
    artifactId,
    status,
    score,
    createdAt,
    checkedRecordCount: records.length,
    checkedArtifactCount: targetArtifacts.length,
    findings,
    summary: buildReviewSummary(status, score, findings),
    metadata: {
      reviewer: 'local-research-reviewer-agent',
      rulesetVersion: SESSION_SCHEMA_VERSION,
      doiVerification,
      stylePassCheckedArtifactCount: targetArtifacts.filter(item => item.kind === 'writing' || item.kind === 'paragraph').length,
    },
  };
}

function collectRecordDois(record: ResearchProvenanceRecord, doiCandidates: Map<string, string[]>): void {
  for (const source of record.sources) {
    if (source.doi) addDoiCandidate(doiCandidates, source.doi, `provenance:${record.id}:source`);
    for (const doi of extractDois([source.title, source.evidenceSnippet, source.metadata ? JSON.stringify(source.metadata) : ''].filter(Boolean).join('\n'))) {
      addDoiCandidate(doiCandidates, doi, `provenance:${record.id}:source-text`);
    }
  }
  for (const citation of record.citations) {
    if (citation.doi) addDoiCandidate(doiCandidates, citation.doi, `provenance:${record.id}:citation`);
    for (const doi of extractDois([citation.citationText, citation.evidenceSnippet, citation.metadata ? JSON.stringify(citation.metadata) : ''].filter(Boolean).join('\n'))) {
      addDoiCandidate(doiCandidates, doi, `provenance:${record.id}:citation-text`);
    }
  }
  if (record.output) {
    for (const doi of extractDois(JSON.stringify(record.output).slice(0, 200_000))) {
      addDoiCandidate(doiCandidates, doi, `provenance:${record.id}:output`);
    }
  }
}

function addDoiCandidate(doiCandidates: Map<string, string[]>, rawDoi: string, location: string): void {
  const doi = rawDoi.trim();
  if (!doi) return;
  const current = doiCandidates.get(doi) || [];
  if (!current.includes(location)) current.push(location);
  doiCandidates.set(doi, current);
}

async function verifyDoiCandidatesForReviewer(doiCandidates: Map<string, string[]>): Promise<Record<string, DoiVerificationResult & { locations: string[] }>> {
  const dois = Array.from(doiCandidates.keys()).slice(0, 60);
  if (dois.length === 0) return {};
  const verified = await verifyDois(dois, { maxDois: 60, timeoutMs: 8000 }).catch(error => {
    logger.warn('[ResearchSession] DOI verification failed:', error);
    return {};
  });
  return Object.fromEntries(
    Object.entries(verified).map(([doi, result]) => [doi, { ...result, locations: doiCandidates.get(doi) || [] }])
  );
}

function appendDoiVerificationFindings(
  findings: ResearchReviewFinding[],
  doiVerification: Record<string, DoiVerificationResult & { locations: string[] }>,
  records: ResearchProvenanceRecord[],
  artifacts: ResearchArtifact[]
): void {
  const allTargets = [
    ...records.map(record => ({ id: record.id, targetId: record.targetId, targetType: record.targetType })),
    ...artifacts.map(artifact => ({ id: artifact.id, targetId: artifact.id, targetType: artifact.kind })),
  ];
  for (const [doi, result] of Object.entries(doiVerification)) {
    const target = allTargets.find(item => result.locations.some(location => location.includes(item.id)));
    const targetId = target?.targetId || doi;
    const targetType = target?.targetType || 'citation';
    if (result.ok === false) {
      findings.push({
        id: makeFindingId(),
        severity: 'critical',
        targetType,
        targetId,
        message: `DOI 无法解析或疑似错误：${doi}`,
        recommendation: '用 CrossRef/OpenAlex 重新查找该文献 DOI；找不到时移除 DOI 或改为未带 DOI 的真实来源记录。',
      });
    } else if (result.ok === null) {
      findings.push({
        id: makeFindingId(),
        severity: 'minor',
        targetType,
        targetId,
        message: `DOI 暂未完成网络验证：${doi}`,
        recommendation: '保留为待核查，不要把它当作已验证来源。',
      });
    }
    if (result.retracted === true) {
      findings.push({
        id: makeFindingId(),
        severity: 'critical',
        targetType,
        targetId,
        message: `引用文献存在撤稿风险：${doi}${result.title ? `（${result.title}）` : ''}`,
        recommendation: '不要把撤稿文献作为正向证据；如必须讨论，应明确标注撤稿或证据失败背景。',
      });
    }
  }
}

async function readArtifactTextForReview(artifact: ResearchArtifact): Promise<string> {
  if (!artifact.filePath || !['writing', 'paragraph', 'review', 'bundle', 'r-code', 'data-analysis'].includes(artifact.kind)) {
    return '';
  }
  try {
    const stat = await fsp.stat(artifact.filePath);
    if (!stat.isFile() || stat.size > 2_000_000) return '';
    return await fsp.readFile(artifact.filePath, 'utf-8');
  } catch {
    return '';
  }
}

function appendStylePassFindings(findings: ResearchReviewFinding[], artifact: ResearchArtifact, artifactText: string): void {
  if (!artifactText || (artifact.kind !== 'writing' && artifact.kind !== 'paragraph')) return;
  const result: StylePassResult = stylePass(artifactText);
  for (const issue of result.issues) {
    findings.push({
      id: makeFindingId(),
      severity: issue.code === 'PROCNOTE' || issue.code === 'PARENDOI' ? 'major' : 'minor',
      targetType: artifact.kind,
      targetId: artifact.id,
      message: `综述风格检查 ${issue.code}: ${issue.note}`,
      recommendation: '按 Literature Review skill 的规则做一次人工编辑：正文开门见山、去掉过程说明、缩短标题、修复 DOI markdown。',
    });
  }
}

function calculateReviewScore(findings: ResearchReviewFinding[]): number {
  const penalty = findings.reduce((sum, finding) => {
    if (finding.severity === 'critical') return sum + 25;
    if (finding.severity === 'major') return sum + 14;
    if (finding.severity === 'minor') return sum + 6;
    return sum + 0;
  }, 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

function buildReviewSummary(status: ResearchReviewerReport['status'], score: number, findings: ResearchReviewFinding[]): string {
  const critical = findings.filter(item => item.severity === 'critical').length;
  const major = findings.filter(item => item.severity === 'major').length;
  const minor = findings.filter(item => item.severity === 'minor').length;
  if (status === 'passed') {
    return `Reviewer agent passed: score ${score}/100; provenance, citations, data and code links are traceable.`;
  }
  return `Reviewer agent ${status}: score ${score}/100; critical=${critical}, major=${major}, minor=${minor}.`;
}

function normalizeResearchSession(raw: ResearchSession, userId: string, sessionId: string, projectId?: string): ResearchSession {
  const resolvedProjectId = normalizeProjectId(raw.projectId) || normalizeProjectId(projectId) || 'current-workspace';
  return {
    id: cleanOptionalString(raw.id) || sessionId,
    userId: sanitizeUserId(raw.userId || userId),
    projectId: resolvedProjectId,
    title: cleanSessionTitle(raw.title || '科研会话'),
    topic: cleanOptionalString(raw.topic),
    goal: cleanOptionalString(raw.goal),
    status: raw.status === 'completed' || raw.status === 'archived' ? raw.status : 'active',
    createdAt: cleanOptionalString(raw.createdAt) || new Date().toISOString(),
    updatedAt: cleanOptionalString(raw.updatedAt) || new Date().toISOString(),
    sources: raw.sources || {},
    provenance: Array.isArray(raw.provenance)
      ? raw.provenance.map(record => ({ ...record, projectId: normalizeProjectId(record.projectId) || resolvedProjectId }))
      : [],
    artifacts: Array.isArray(raw.artifacts)
      ? raw.artifacts.map(artifact => ({ ...artifact, projectId: normalizeProjectId(artifact.projectId) || resolvedProjectId }))
      : [],
    reviewerReports: Array.isArray(raw.reviewerReports)
      ? raw.reviewerReports.map(report => ({ ...report, projectId: normalizeProjectId(report.projectId) || resolvedProjectId }))
      : [],
    metadata: raw.metadata,
  };
}

function mergeSourceSnapshots(a: ResearchSessionSourceSnapshot, b: ResearchSessionSourceSnapshot): ResearchSessionSourceSnapshot {
  return {
    ...a,
    ...b,
    metadata: {
      ...(a.metadata || {}),
      ...(b.metadata || {}),
    },
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
  await fsp.rename(tmpPath, filePath);
}

async function hashFileIfExists(filePath: string): Promise<string | undefined> {
  try {
    const data = await fsp.readFile(filePath);
    return crypto.createHash('sha256').update(data).digest('hex');
  } catch {
    return undefined;
  }
}

function hashUnknown(value: unknown): string {
  return hashString(JSON.stringify(value, stableJsonReplacer));
}

function hashString(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJsonReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = (value as Record<string, unknown>)[key];
        return acc;
      }, {});
  }
  return value;
}

function normalizeProjectId(value: unknown): string | undefined {
  const cleaned = String(value || '')
    .trim()
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/^\.+/, '')
    .replace(/[^a-zA-Z0-9._@-]/g, '_')
    .slice(0, 160);
  return cleaned || undefined;
}

function collectEvidenceSnippets(record: ResearchProvenanceRecord): string[] {
  const snippets = [
    ...record.sources.map(source => cleanOptionalString(source.evidenceSnippet)),
    ...record.citations.map(citation => cleanOptionalString(citation.evidenceSnippet)),
  ].filter((item): item is string => Boolean(item));
  return Array.from(new Set(snippets)).slice(0, 20);
}

function previewUnknown(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, stableJsonReplacer);
    const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) return undefined;
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength)}...` : cleaned;
  } catch {
    return undefined;
  }
}

function cleanSessionTitle(value: string): string {
  const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned.slice(0, 160) : '科研会话';
}

function cleanOptionalString(value: unknown): string | undefined {
  const cleaned = String(value || '').trim();
  return cleaned ? cleaned : undefined;
}

function sanitizeFileStem(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180) || 'session';
}

function makeFindingId(): string {
  return `rf_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}
