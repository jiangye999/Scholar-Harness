import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { computeKeywordTags, getPaperKeywords, normalizeKeyword, splitKeywordInput, type LiteratureRecord, type OuterTagsConfig } from '../literature/keyword-library';
import { AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING } from '../config/auto-research-paper-topic-skill';
import { logger } from './logger';
import { sanitizeUserId } from './paths';
import type { PdfWikiEntry, PdfWikiReference, PdfWikiStore, PdfWikiViewpoint } from './pdf-wiki-manager';

export const AUTO_RESEARCH_STAGE_IDS = [
  'topic',
  'literature_map',
  'hypothesis',
  'evidence_library',
  'experiment_plan',
  'draft',
  'review',
  'revision',
] as const;

export type AutoResearchStageId = typeof AUTO_RESEARCH_STAGE_IDS[number];
export type AutoResearchStageStatus = 'pending' | 'active' | 'done' | 'blocked';
export type AutoResearchTaskStatus = 'active' | 'paused' | 'completed';
export type AutoResearchActor = 'user' | 'primary' | 'secondary' | 'codex' | 'system';
export type AutoResearchOperationStatus = 'started' | 'completed' | 'failed';
export type AutoResearchMemoryKind = 'finding' | 'hypothesis' | 'failure' | 'decision' | 'method' | 'constraint' | 'evidence' | 'todo';
export type AutoResearchEvidenceStance = 'support' | 'oppose' | 'neutral';
export type AutoResearchEvaluationLevel = 'pass' | 'warn' | 'fail';
export type AutoResearchWikiNodeType = 'paper' | 'claim' | 'idea' | 'experiment' | 'gap';
export type AutoResearchWikiEdgeType =
  | 'supports'
  | 'opposes'
  | 'neutral_about'
  | 'cites'
  | 'derived_from'
  | 'addresses_gap'
  | 'tested_by'
  | 'invalidates'
  | 'inspired_by';
export type AutoResearchAuditVerdict = 'pass' | 'warn' | 'fail';

export interface AutoResearchProjectContext {
  projectId?: string;
  projectName?: string;
  writingProfileId?: string;
  writingProfileLabel?: string;
}

export interface AutoResearchStage {
  id: AutoResearchStageId;
  title: string;
  status: AutoResearchStageStatus;
  notes: string[];
  artifacts: string[];
  updatedAt: string;
}

export interface AutoResearchTask {
  id: string;
  title: string;
  topic: string;
  goal: string;
  status: AutoResearchTaskStatus;
  currentStageId: AutoResearchStageId;
  stages: AutoResearchStage[];
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchMemoryItem {
  id: string;
  kind: AutoResearchMemoryKind;
  content: string;
  source: string;
  tags: string[];
  evidenceObjectIds: string[];
  operationIds: string[];
  confidence?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchFailureLesson {
  id: string;
  summary: string;
  cause: string;
  prevention: string;
  relatedOperationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchEvidenceReference {
  id: string;
  raw: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  sourcePdfId?: string;
  sourcePdfName?: string;
  index?: number;
}

export interface AutoResearchEvidenceTrace {
  sourceType: 'pdf-wiki' | 'embedding-library';
  sourceUri: string;
  pdfWikiEntryId?: string;
  literatureNodeId?: string;
  literatureRecordKey?: string;
  viewpointIndex?: number;
  stance: AutoResearchEvidenceStance;
  sentenceIds: string[];
  referenceIds: string[];
  storeGeneratedAt?: string;
}

export interface AutoResearchEvidenceObject {
  id: string;
  claimId: string;
  claim: string;
  stance: AutoResearchEvidenceStance;
  viewpointSummary: string;
  evidenceText: string;
  evidenceSentenceIds: string[];
  evidenceSentences: string[];
  inTextCitations: string[];
  references: AutoResearchEvidenceReference[];
  sourcePdfId: string;
  sourcePdfName: string;
  sourcePdfTitle: string;
  section: string;
  location: string;
  groundingScore: number;
  trace: AutoResearchEvidenceTrace;
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchEvidenceSnapshot {
  id: string;
  source: 'pdf-wiki';
  importedAt: string;
  sourceGeneratedAt: string;
  entryCount: number;
  evidenceObjectCount: number;
  referenceCount: number;
  checksum: string;
  added: number;
  updated: number;
  removed: number;
}

export interface AutoResearchEvidenceLibraryState {
  objects: AutoResearchEvidenceObject[];
  snapshots: AutoResearchEvidenceSnapshot[];
  lastSyncedAt?: string;
  sourceGeneratedAt?: string;
}

export type AutoResearchLiteratureTagKind = 'keyword' | 'aiKeyword' | 'mergedTag' | 'journal' | 'year' | 'documentType';

export interface AutoResearchLiteratureTrace {
  sourceType: 'embedding-library';
  sourceUri: string;
  literatureRecordKey: string;
}

export interface AutoResearchLiteratureNode {
  id: string;
  key: string;
  title: string;
  authors: string;
  year: string;
  journal: string;
  doi: string;
  abstract: string;
  keywords: string[];
  aiKeywords: string[];
  documentType: string;
  categories: string[];
  hasEmbedding: boolean;
  embeddingDimension: number;
  trace: AutoResearchLiteratureTrace;
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchLiteratureTag {
  id: string;
  name: string;
  kind: AutoResearchLiteratureTagKind;
  count: number;
  literatureIds: string[];
  sourceKeywords?: string[];
}

export interface AutoResearchLiteratureSnapshot {
  id: string;
  source: 'embedding-library';
  importedAt: string;
  literatureCount: number;
  embeddingCount: number;
  keywordCount: number;
  mergedTagCount: number;
  checksum: string;
  added: number;
  updated: number;
  removed: number;
}

export interface AutoResearchLiteratureMapState {
  nodes: AutoResearchLiteratureNode[];
  tags: AutoResearchLiteratureTag[];
  snapshots: AutoResearchLiteratureSnapshot[];
  lastSyncedAt?: string;
}

export interface AutoResearchOperation {
  id: string;
  kind: string;
  stageId?: AutoResearchStageId;
  actor: AutoResearchActor;
  status: AutoResearchOperationStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolResults: Array<Record<string, unknown>>;
  model?: string;
  startedAt: string;
  completedAt?: string;
  error?: string;
  inputHash: string;
  outputHash?: string;
  version: {
    app: string;
    schema: number;
    node: string;
  };
  replayFile?: string;
}

export interface AutoResearchEvaluationMetric {
  id: 'citation_alignment' | 'evidence_sufficiency' | 'novelty' | 'reproducibility';
  label: string;
  score: number;
  level: AutoResearchEvaluationLevel;
  summary: string;
  checks: Array<{
    label: string;
    passed: boolean;
    detail: string;
  }>;
}

export interface AutoResearchSelfEvaluationReport {
  id: string;
  generatedAt: string;
  overallScore: number;
  metrics: AutoResearchEvaluationMetric[];
  issues: string[];
  recommendations: string[];
}

export interface AutoResearchWikiNode {
  id: string;
  type: AutoResearchWikiNodeType;
  title: string;
  summary: string;
  sourceUri?: string;
  tags: string[];
  evidenceObjectIds: string[];
  literatureNodeIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchWikiEdge {
  id: string;
  type: AutoResearchWikiEdgeType;
  fromId: string;
  toId: string;
  evidence: string;
  sourceUri?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutoResearchWikiState {
  nodes: AutoResearchWikiNode[];
  edges: AutoResearchWikiEdge[];
  queryPack: string;
  updatedAt?: string;
}

export interface AutoResearchAuditFinding {
  id: string;
  level: AutoResearchAuditVerdict;
  category: 'citation' | 'claim' | 'evidence' | 'reproducibility';
  message: string;
  targetId?: string;
  detail: string;
}

export interface AutoResearchAuditReport {
  id: string;
  generatedAt: string;
  verdict: AutoResearchAuditVerdict;
  overallScore: number;
  summary: string;
  findings: AutoResearchAuditFinding[];
  trace: {
    evaluationId?: string;
    evidenceObjectCount: number;
    referenceCount: number;
    operationCount: number;
    wikiNodeCount: number;
    wikiEdgeCount: number;
  };
}

export interface AutoResearchPaperTopicReview {
  paperType: string;
  notRecommendedTypes: string[];
  topicRiskLevel: 'low' | 'medium' | 'high' | 'not-recommended';
  evidenceReadiness: 'direct' | 'adjacent' | 'mechanistic' | 'insufficient';
  topicScopeDiagnosis: string;
  actualEvidenceScope: string;
  mismatchPoints: string[];
  recommendedBoundary: {
    region: string;
    system: string;
    object: string;
    treatments: string[];
    indicators: string[];
    mechanisms: string[];
    timeScale: string;
    excludedScope: string[];
  };
  optimizedScientificQuestions: string[];
  highRiskIssues: string[];
  goToWritingStage: '可以进入写作' | '修改选题后进入写作' | '需要补充文献后再写' | '需要补充数据后再写' | '暂不建议写作';
}

export interface AutoResearchPaperWritingBlueprint {
  paperType: string;
  titleOptions: {
    conservative: string;
    innovative: string;
    submissionReady: string;
  };
  recommendedTitle: string;
  coreResearchObject: string;
  coreScientificQuestions: string[];
  centralArgument: string;
  supportedClaims: string[];
  claimsToAvoid: string[];
  evidenceHierarchy: {
    directEvidence: string[];
    adjacentEvidence: string[];
    mechanisticEvidence: string[];
  };
  innovationPoints: string[];
  mechanismChain: string[];
  recommendedStructure: string[];
  requiredFiguresTables: string[];
  writingWarnings: string[];
  goToWritingStage: AutoResearchPaperTopicReview['goToWritingStage'];
}

export type AutoResearchContentEvidenceClass =
  | 'Direct'
  | 'System-specific'
  | 'Adjacent'
  | 'Mechanistic'
  | 'Background'
  | 'Insufficient';

export type AutoResearchContentEvidenceStrength = 'Strong' | 'Medium' | 'Weak';
export type AutoResearchContentWritingDecision = 'Go' | 'Conditional Go' | 'Revise Before Writing' | 'No-Go';

export interface AutoResearchEvidenceMatrixRow {
  studyOrDataSource: string;
  objectPopulationSystem: string;
  contextRegionScenario: string;
  variableInterventionExposure: string;
  outcomeIndicator: string;
  quantitativeResult: string;
  mechanismIndicator: string;
  evidenceClass: AutoResearchContentEvidenceClass;
  evidenceStrength: AutoResearchContentEvidenceStrength;
  supportedClaim: string;
  claimToAvoid: string;
}

export interface AutoResearchEvidenceDependencyRow {
  coreClaim: string;
  primaryEvidence: string;
  overDependsOnSingleSource: boolean;
  evidencePathToAdd: string;
}

export interface AutoResearchVariableMechanismOutcomeRow {
  variableInterventionPhenomenon: string;
  directEffect: string;
  intermediateMechanism: string;
  primaryOutcome: string;
  secondaryOutcomeTradeoff: string;
  evidenceClass: AutoResearchContentEvidenceClass;
  evidenceStrength: AutoResearchContentEvidenceStrength;
  boundaryCondition: string;
  uncertainty: string;
}

export interface AutoResearchQuantitativeResultRow {
  source: string;
  objectGroup: string;
  treatmentVariable: string;
  indicator: string;
  baselineControl: string;
  reportedValueOrChange: string;
  direction: 'Increase' | 'Decrease' | 'No clear change' | 'Mixed' | 'NR';
  statisticalInformation: string;
  interpretation: string;
  limitation: string;
}

export interface AutoResearchIndicatorBoundaryRow {
  indicator: string;
  whatItCanSupport: string;
  whatItCannotSupport: string;
  needsSeparationFrom: string;
}

export interface AutoResearchInnovationFramework {
  frameworkName: string;
  coreLogic: string;
  components: string[];
  whatItExplains: string[];
  whatItDoesNotExplain: string[];
  testableHypothesesOrFutureQuestions: string[];
  practicalOrTheoreticalValue: string[];
}

export interface AutoResearchConceptualFigure {
  title: string;
  caption: string;
  mermaid: string;
}

export interface AutoResearchEvidenceStrengthHeatmapRow {
  pathwayTopic: string;
  directEvidence: 'High' | 'Medium' | 'Low';
  systemSpecificEvidence: 'High' | 'Medium' | 'Low';
  adjacentEvidence: 'High' | 'Medium' | 'Low';
  mechanisticEvidence: 'High' | 'Medium' | 'Low';
  overallConfidence: 'High' | 'Medium' | 'Low';
}

export interface AutoResearchReferenceCleaningNotes {
  coreEvidenceToRetain: string[];
  mechanisticEvidenceToRetain: string[];
  backgroundEvidenceToRetain: string[];
  referencesRequiringVerification: string[];
  referencesToRemoveOrExclude: string[];
}

export interface AutoResearchContentEnhancementReport {
  id: string;
  generatedAt: string;
  paperPositionDiagnosis: {
    currentManuscriptType: string;
    targetPaperType: string;
    consistent: boolean;
    mainDeviation: string;
    needsReconstruction: boolean;
  };
  mainContentProblems: string[];
  coreEvidenceDependencyCheck: AutoResearchEvidenceDependencyRow[];
  evidenceMatrix: AutoResearchEvidenceMatrixRow[];
  positiveFindings: string[];
  variableMechanismOutcomeMatrix: AutoResearchVariableMechanismOutcomeRow[];
  quantitativeResultSummary: AutoResearchQuantitativeResultRow[];
  indicatorBoundaryCheck: AutoResearchIndicatorBoundaryRow[];
  innovationFramework: AutoResearchInnovationFramework;
  proposedConceptualFigure: AutoResearchConceptualFigure;
  evidenceStrengthHeatmap: AutoResearchEvidenceStrengthHeatmapRow[];
  revisedResultsStructure: string[];
  revisedDiscussionStructure: string[];
  revisedConclusionLogic: string[];
  referenceCleaningNotes: AutoResearchReferenceCleaningNotes;
  finalWritingBlueprint: {
    paperType: string;
    recommendedTitleDirection: string;
    coreProblem: string;
    centralArgument: string;
    positiveFindingsToEmphasize: string[];
    evidenceHierarchy: AutoResearchPaperWritingBlueprint['evidenceHierarchy'];
    keyVariablesInterventionsPhenomena: string[];
    mechanismPathways: string[];
    quantitativeResultsAvailable: string[];
    indicatorsToKeepSeparate: string[];
    innovationFramework: string;
    requiredTables: string[];
    requiredFigures: string[];
    claimsAllowed: string[];
    claimsToAvoid: string[];
    discussionLogic: string[];
    conclusionLogic: string[];
    referencesToRetain: string[];
    referencesToVerify: string[];
    referencesToRemove: string[];
    writingWarnings: string[];
  };
  goNoGoDecision: {
    decision: AutoResearchContentWritingDecision;
    reason: string;
    requiredActionsBeforeWriting: string[];
  };
  qualityChecklist: Array<{
    item: string;
    passed: boolean;
    detail: string;
  }>;
}

export interface AutoResearchFinalReport {
  id: string;
  generatedAt: string;
  editedAt?: string;
  topic: string;
  title: string;
  editedMarkdown?: string;
  executiveSummary: string;
  paperTopicReview?: AutoResearchPaperTopicReview;
  paperWritingBlueprint?: AutoResearchPaperWritingBlueprint;
  contentEnhancementReport?: AutoResearchContentEnhancementReport;
  literatureOverview: string[];
  evidenceSynthesis: Array<{
    claim: string;
    supportCount: number;
    neutralCount: number;
    opposeCount: number;
    summary: string;
    evidenceObjectIds: string[];
  }>;
  hypotheses: string[];
  knowledgeGaps: string[];
  experimentPlan: string[];
  draftOutline: string[];
  reviewSummary: string;
  limitations: string[];
  nextSteps: string[];
  trace: {
    literatureSnapshotId?: string;
    evidenceSnapshotId?: string;
    evaluationId?: string;
    totalLiteratureNodeCount: number;
    literatureNodeCount: number;
    relevantLiteratureNodeIds: string[];
    evidenceObjectCount: number;
    pdfWikiEvidenceObjectCount?: number;
    embeddingEvidenceObjectCount?: number;
    operationCount: number;
  };
}

export interface AutoResearchPaperDraft {
  id: string;
  reportId: string;
  generatedAt: string;
  editedAt?: string;
  topic: string;
  title: string;
  markdown: string;
  editedMarkdown?: string;
  wordCountEstimate: number;
  referenceCount: number;
  trace: {
    finalReportId: string;
    evaluationId?: string;
    totalLiteratureNodeCount: number;
    literatureNodeCount: number;
    evidenceObjectCount: number;
    pdfWikiEvidenceObjectCount: number;
    embeddingEvidenceObjectCount: number;
  };
}

export interface AutoResearchCompletedTaskRecord {
  id: string;
  taskId: string;
  title: string;
  topic: string;
  goal: string;
  projectId: string;
  projectName: string;
  completedAt: string;
  finalReportId: string;
  finalReportTitle: string;
  paperDraftId?: string;
  paperDraftTitle?: string;
  paperDraftGeneratedAt?: string;
  stageDoneCount: number;
  stageTotalCount: number;
  literatureNodeCount: number;
  evidenceObjectCount: number;
  pdfWikiEvidenceObjectCount: number;
  embeddingEvidenceObjectCount: number;
  operationCount: number;
  evaluationId?: string;
  auditReportId?: string;
  auditVerdict?: AutoResearchAuditVerdict;
  auditScore?: number;
  createdAt: string;
  updatedAt: string;
}

interface AutoResearchEvidenceContext {
  allLiteratureNodes: AutoResearchLiteratureNode[];
  literatureNodes: AutoResearchLiteratureNode[];
  pdfWikiEvidenceObjects: AutoResearchEvidenceObject[];
  embeddingEvidenceObjects: AutoResearchEvidenceObject[];
  evidenceObjects: AutoResearchEvidenceObject[];
}

export interface AutoResearchState {
  version: 1;
  userId: string;
  projectId: string;
  projectName: string;
  createdAt: string;
  updatedAt: string;
  task: AutoResearchTask;
  projectMemory: AutoResearchMemoryItem[];
  failureLessons: AutoResearchFailureLesson[];
  evidenceLibrary: AutoResearchEvidenceLibraryState;
  literatureMap: AutoResearchLiteratureMapState;
  researchWiki: AutoResearchWikiState;
  operations: AutoResearchOperation[];
  evaluations: AutoResearchSelfEvaluationReport[];
  auditReports: AutoResearchAuditReport[];
  finalReports: AutoResearchFinalReport[];
  paperDrafts: AutoResearchPaperDraft[];
  completedTaskRecords: AutoResearchCompletedTaskRecord[];
}

export interface StartAutoResearchTaskInput {
  title?: string;
  topic?: string;
  goal?: string;
  project?: AutoResearchProjectContext;
}

export interface UpdateAutoResearchStageInput {
  stageId: AutoResearchStageId;
  status?: AutoResearchStageStatus;
  note?: string;
  artifact?: string;
  project?: AutoResearchProjectContext;
}

export interface UpsertAutoResearchMemoryInput {
  kind: AutoResearchMemoryKind;
  content: string;
  source?: string;
  tags?: string[];
  evidenceObjectIds?: string[];
  operationIds?: string[];
  confidence?: number;
  project?: AutoResearchProjectContext;
}

export interface RecordAutoResearchOperationInput {
  kind: string;
  stageId?: AutoResearchStageId;
  actor?: AutoResearchActor;
  status?: AutoResearchOperationStatus;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  toolResults?: Array<Record<string, unknown>>;
  model?: string;
  error?: string;
  project?: AutoResearchProjectContext;
}

export interface UpdateAutoResearchFinalReportMarkdownInput {
  reportId: string;
  markdown: string;
  project?: AutoResearchProjectContext;
}

export interface GenerateAutoResearchPaperDraftInput {
  reportId: string;
  project?: AutoResearchProjectContext;
}

export interface UpdateAutoResearchPaperDraftMarkdownInput {
  draftId: string;
  markdown: string;
  project?: AutoResearchProjectContext;
}

export interface DeleteAutoResearchCompletedTaskRecordsInput {
  recordIds: string[];
  project?: AutoResearchProjectContext;
}

const STAGE_TITLES: Record<AutoResearchStageId, string> = {
  topic: '选题',
  literature_map: '文献图谱',
  hypothesis: '假设',
  evidence_library: '证据库',
  experiment_plan: '实验/数据计划',
  draft: '草稿',
  review: '审稿式自检',
  revision: '修订',
};

const DEFAULT_TASK_TITLE = 'AutoResearch 长期任务';
const SCHEMA_VERSION = 1;

export interface AutoResearchCorePromptProvider {
  getCorePrompt(promptId: string): Promise<{ content: string; version?: number; source?: string }>;
}

export class AutoResearchManager {
  private autoResearchWritingSkillContent?: string | null;

  constructor(
    private readonly dataDir: string,
    private corePromptProvider?: AutoResearchCorePromptProvider
  ) {}

  setCorePromptProvider(provider: AutoResearchCorePromptProvider): void {
    this.corePromptProvider = provider;
    this.autoResearchWritingSkillContent = undefined;
  }

  private async loadAutoResearchWritingSkill(): Promise<string> {
    if (!this.corePromptProvider) return AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING;
    if (this.autoResearchWritingSkillContent !== undefined) {
      return this.autoResearchWritingSkillContent || AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING;
    }
    try {
      const prompt = await this.corePromptProvider.getCorePrompt('auto_research_topic_content_skill_for_writing');
      this.autoResearchWritingSkillContent = prompt.content;
      logger.info(`[AutoResearch] Loaded cloud writing skill v${prompt.version || 'unknown'} (${prompt.source || 'cloud'})`);
      return prompt.content;
    } catch (error) {
      logger.warn('[AutoResearch] Failed to load cloud writing skill, using local fallback', error);
      this.autoResearchWritingSkillContent = null;
      return AUTO_RESEARCH_PAPER_TOPIC_CONTENT_SKILL_FOR_WRITING;
    }
  }

  async getState(userId: string, project?: AutoResearchProjectContext): Promise<AutoResearchState> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const nextState = this.applyProjectContext(state, project);
    if (nextState.updatedAt !== state.updatedAt || nextState.projectId !== state.projectId || nextState.projectName !== state.projectName) {
      await this.saveState(safeUserId, nextState);
    }
    return nextState;
  }

  async startTask(userId: string, input: StartAutoResearchTaskInput): Promise<AutoResearchState> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    state.task.title = this.cleanText(input.title, 160) || state.task.title || DEFAULT_TASK_TITLE;
    state.task.topic = this.cleanText(input.topic, 500) || state.task.topic;
    state.task.goal = this.cleanText(input.goal, 1000) || state.task.goal;
    state.task.status = 'active';
    state.task.currentStageId = state.task.currentStageId || 'topic';
    state.task.stages = this.ensureStages(state.task.stages, now);
    state.task.stages = state.task.stages.map(stage =>
      stage.id === state.task.currentStageId && stage.status === 'pending'
        ? { ...stage, status: 'active', updatedAt: now }
        : stage
    );
    state.task.updatedAt = now;
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.start',
      stageId: state.task.currentStageId,
      actor: 'user',
      status: 'completed',
      input: {
        title: input.title || '',
        topic: input.topic || '',
        goal: input.goal || '',
      },
      output: {
        taskId: state.task.id,
        currentStageId: state.task.currentStageId,
      },
      toolResults: [],
    }, now);
    await this.saveState(safeUserId, state);
    return state;
  }

  async updateStage(userId: string, input: UpdateAutoResearchStageInput): Promise<AutoResearchState> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== input.stageId) return stage;
      const notes = input.note ? this.uniqueStrings([...stage.notes, this.cleanText(input.note, 2000)]) : stage.notes;
      const artifacts = input.artifact ? this.uniqueStrings([...stage.artifacts, this.cleanText(input.artifact, 1000)]) : stage.artifacts;
      return {
        ...stage,
        status: input.status || stage.status,
        notes: notes.filter(Boolean),
        artifacts: artifacts.filter(Boolean),
        updatedAt: now,
      };
    });
    state.task.currentStageId = input.stageId;
    state.task.updatedAt = now;
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.stage.update',
      stageId: input.stageId,
      actor: 'user',
      status: 'completed',
      input: {
        stageId: input.stageId,
        status: input.status || '',
        note: input.note || '',
        artifact: input.artifact || '',
      },
      output: {
        currentStageId: state.task.currentStageId,
      },
      toolResults: [],
    }, now);
    await this.saveState(safeUserId, state);
    return state;
  }

  async upsertMemoryItem(userId: string, input: UpsertAutoResearchMemoryInput): Promise<AutoResearchState> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    const content = this.cleanText(input.content, 4000);
    if (!content) {
      throw new Error('项目记忆内容不能为空');
    }
    const id = `mem_${this.hash({ kind: input.kind, content }).slice(0, 16)}`;
    const existingIndex = state.projectMemory.findIndex(item => item.id === id);
    const item: AutoResearchMemoryItem = {
      id,
      kind: input.kind,
      content,
      source: this.cleanText(input.source, 200) || 'manual',
      tags: this.uniqueStrings(input.tags || []).slice(0, 20),
      evidenceObjectIds: this.uniqueStrings(input.evidenceObjectIds || []).slice(0, 50),
      operationIds: this.uniqueStrings(input.operationIds || []).slice(0, 50),
      confidence: typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : undefined,
      createdAt: existingIndex >= 0 ? state.projectMemory[existingIndex].createdAt : now,
      updatedAt: now,
    };
    if (existingIndex >= 0) state.projectMemory[existingIndex] = item;
    else state.projectMemory.unshift(item);
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.memory.upsert',
      actor: 'user',
      status: 'completed',
      input: {
        kind: input.kind,
        content,
        source: item.source,
      },
      output: {
        memoryId: item.id,
      },
      toolResults: [],
    }, now);
    await this.saveState(safeUserId, state);
    return state;
  }

  async recordOperation(userId: string, input: RecordAutoResearchOperationInput): Promise<AutoResearchState> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: this.cleanText(input.kind, 160) || 'autoresearch.operation',
      stageId: input.stageId,
      actor: input.actor || 'system',
      status: input.status || 'completed',
      input: input.input || {},
      output: input.output || {},
      toolResults: input.toolResults || [],
      model: input.model,
      error: input.error,
    }, now);
    await this.saveState(safeUserId, state);
    return state;
  }

  async deleteCompletedTaskRecords(
    userId: string,
    input: DeleteAutoResearchCompletedTaskRecordsInput
  ): Promise<{ state: AutoResearchState; deletedCount: number; deletedRecordIds: string[] }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    const recordIds = this.uniqueStrings(input.recordIds || [])
      .map(id => this.cleanText(id, 160))
      .filter(Boolean)
      .slice(0, 100);
    if (!recordIds.length) {
      throw new Error('请选择要删除的已完成任务记录');
    }

    const recordIdSet = new Set(recordIds);
    const existingRecordIdSet = new Set(state.completedTaskRecords.map(record => record.id));
    const beforeCount = state.completedTaskRecords.length;
    state.completedTaskRecords = state.completedTaskRecords.filter(record => !recordIdSet.has(record.id));
    const deletedRecordIds = recordIds.filter(id => existingRecordIdSet.has(id) && !state.completedTaskRecords.some(record => record.id === id));
    const deletedCount = beforeCount - state.completedTaskRecords.length;

    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.completed_task_records.delete',
      stageId: 'revision',
      actor: 'user',
      status: 'completed',
      input: {
        recordIds,
      },
      output: {
        deletedCount,
        deletedRecordIds,
        retainedRecordCount: state.completedTaskRecords.length,
      },
      toolResults: [],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, deletedCount, deletedRecordIds };
  }

  async syncPdfWikiStore(
    userId: string,
    store: PdfWikiStore,
    project?: AutoResearchProjectContext
  ): Promise<{ state: AutoResearchState; snapshot: AutoResearchEvidenceSnapshot }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const now = new Date().toISOString();
    const previousById = new Map(state.evidenceLibrary.objects.map(item => [item.id, item]));
    const rawObjects = this.buildEvidenceObjectsFromPdfWiki(store, now);
    const objects = rawObjects.map(item => {
      const previous = previousById.get(item.id);
      if (!previous) return item;
      const changed = this.evidenceFingerprint(previous) !== this.evidenceFingerprint(item);
      return {
        ...item,
        createdAt: previous.createdAt,
        updatedAt: changed ? now : previous.updatedAt,
      };
    });
    const nextById = new Map(objects.map(item => [item.id, item]));
    const added = objects.filter(item => !previousById.has(item.id)).length;
    const updated = objects.filter(item => {
      const previous = previousById.get(item.id);
      return previous ? this.evidenceFingerprint(previous) !== this.evidenceFingerprint(item) : false;
    }).length;
    const removed = state.evidenceLibrary.objects.filter(item => !nextById.has(item.id)).length;
    const snapshot: AutoResearchEvidenceSnapshot = {
      id: `evsnap_${this.hash({ userId: safeUserId, generatedAt: store.generatedAt, now }).slice(0, 18)}`,
      source: 'pdf-wiki',
      importedAt: now,
      sourceGeneratedAt: store.generatedAt || '',
      entryCount: Array.isArray(store.entries) ? store.entries.length : 0,
      evidenceObjectCount: objects.length,
      referenceCount: Array.isArray(store.referenceIndex) ? store.referenceIndex.length : 0,
      checksum: this.hash(objects),
      added,
      updated,
      removed,
    };

    state.evidenceLibrary.objects = objects;
    state.evidenceLibrary.snapshots.unshift(snapshot);
    state.evidenceLibrary.snapshots = state.evidenceLibrary.snapshots.slice(0, 50);
    state.evidenceLibrary.lastSyncedAt = now;
    state.evidenceLibrary.sourceGeneratedAt = store.generatedAt || '';
    const sourcePdfCount = Array.isArray(store.pdfs) ? store.pdfs.length : 0;
    const entryCount = Array.isArray(store.entries) ? store.entries.length : 0;
    const emptyStoreNote = sourcePdfCount === 0
      ? 'PDF Wiki 尚未生成：未找到已登记 PDF，请先在 PDF 管理上传 PDF 并完成深入分析。'
      : entryCount === 0
        ? `PDF Wiki 已登记 ${sourcePdfCount} 个 PDF，但尚未生成论点组；请先运行深入分析或重建 PDF Wiki。`
        : '';
    const embeddingEvidenceCount = this.buildEmbeddingEvidenceObjects(
      this.selectTopicRelevantLiteratureNodes(state.task.topic || state.task.goal, state.literatureMap.nodes || [], 120),
      now,
      120
    ).length;
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== 'evidence_library') return stage;
      return {
        ...stage,
        status: objects.length > 0 || embeddingEvidenceCount > 0 ? 'done' : 'blocked',
        notes: this.uniqueStrings([
          emptyStoreNote,
          `PDF Wiki 同步：${objects.length} 个可追溯证据对象，新增 ${added}，更新 ${updated}，移除 ${removed}`,
          embeddingEvidenceCount > 0 ? `Embedding 摘要证据可用：${embeddingEvidenceCount} 个论文级证据对象` : '',
          ...stage.notes,
        ].filter(Boolean)).slice(0, 20),
        artifacts: this.uniqueStrings([`pdf-wiki-snapshot:${snapshot.id}`, ...stage.artifacts]).slice(0, 50),
        updatedAt: now,
      };
    });
    state.task.currentStageId = 'evidence_library';
    state.task.updatedAt = now;
    this.upsertSystemMemory(state, {
      kind: 'evidence',
      content: `PDF Wiki 证据库已同步：${objects.length} 个 evidence objects，覆盖 ${snapshot.entryCount} 个论点组。`,
      source: 'pdf-wiki-sync',
      tags: ['pdf-wiki', 'evidence-library'],
      evidenceObjectIds: objects.slice(0, 30).map(item => item.id),
      now,
    });
    this.touchState(state, project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.pdf_wiki.sync',
      stageId: 'evidence_library',
      actor: 'system',
      status: 'completed',
      input: {
        userId: safeUserId,
        pdfCount: Array.isArray(store.pdfs) ? store.pdfs.length : 0,
        entryCount: snapshot.entryCount,
        generatedAt: store.generatedAt || '',
      },
      output: {
        snapshotId: snapshot.id,
        evidenceObjectCount: snapshot.evidenceObjectCount,
        added,
        updated,
        removed,
      },
      toolResults: [{
        tool: 'pdfWikiManager.getStore',
        success: true,
        referenceCount: snapshot.referenceCount,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, snapshot };
  }

  async syncEmbeddingLibrary(
    userId: string,
    papers: LiteratureRecord[],
    outerTags: OuterTagsConfig = { mergedTags: [], promotedTags: [] },
    project?: AutoResearchProjectContext
  ): Promise<{ state: AutoResearchState; snapshot: AutoResearchLiteratureSnapshot }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const now = new Date().toISOString();
    const visiblePapers = (Array.isArray(papers) ? papers : []).filter(paper => !(paper as { isPdf?: unknown }).isPdf);
    const previousById = new Map(state.literatureMap.nodes.map(item => [item.id, item]));
    const rawNodes = this.buildLiteratureNodesFromEmbeddingLibrary(safeUserId, visiblePapers, now);
    const nodes = rawNodes.map(item => {
      const previous = previousById.get(item.id);
      if (!previous) return item;
      const changed = this.literatureFingerprint(previous) !== this.literatureFingerprint(item);
      return {
        ...item,
        createdAt: previous.createdAt,
        updatedAt: changed ? now : previous.updatedAt,
      };
    });
    const nextById = new Map(nodes.map(item => [item.id, item]));
    const added = nodes.filter(item => !previousById.has(item.id)).length;
    const updated = nodes.filter(item => {
      const previous = previousById.get(item.id);
      return previous ? this.literatureFingerprint(previous) !== this.literatureFingerprint(item) : false;
    }).length;
    const removed = state.literatureMap.nodes.filter(item => !nextById.has(item.id)).length;
    const tags = this.buildLiteratureTags(visiblePapers, nodes, outerTags);
    const keywordStats = computeKeywordTags(visiblePapers);
    const snapshot: AutoResearchLiteratureSnapshot = {
      id: `litsnap_${this.hash({ userId: safeUserId, now, nodes, tags }).slice(0, 18)}`,
      source: 'embedding-library',
      importedAt: now,
      literatureCount: nodes.length,
      embeddingCount: nodes.filter(item => item.hasEmbedding).length,
      keywordCount: keywordStats.totalKeywords,
      mergedTagCount: Array.isArray(outerTags.mergedTags) ? outerTags.mergedTags.length : 0,
      checksum: this.hash({ nodes, tags }),
      added,
      updated,
      removed,
    };

    state.literatureMap.nodes = nodes;
    state.literatureMap.tags = tags;
    state.literatureMap.snapshots.unshift(snapshot);
    state.literatureMap.snapshots = state.literatureMap.snapshots.slice(0, 50);
    state.literatureMap.lastSyncedAt = now;
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== 'literature_map') return stage;
      return {
        ...stage,
        status: nodes.length > 0 ? 'done' : 'active',
        notes: this.uniqueStrings([
          `Embedding 文献库同步：${nodes.length} 篇文献，${snapshot.embeddingCount} 篇带向量，新增 ${added}，更新 ${updated}，移除 ${removed}`,
          ...stage.notes,
        ]).slice(0, 20),
        artifacts: this.uniqueStrings([`embedding-library-snapshot:${snapshot.id}`, ...stage.artifacts]).slice(0, 50),
        updatedAt: now,
      };
    });
    state.task.currentStageId = 'literature_map';
    state.task.updatedAt = now;
    this.upsertSystemMemory(state, {
      kind: 'finding',
      content: this.buildLiteratureMapMemoryContent(nodes, tags, snapshot),
      source: 'embedding-library-sync',
      tags: ['embedding-library', 'literature-map'],
      evidenceObjectIds: [],
      now,
    });
    this.touchState(state, project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.embedding_library.sync',
      stageId: 'literature_map',
      actor: 'system',
      status: 'completed',
      input: {
        userId: safeUserId,
        literatureCount: visiblePapers.length,
        mergedTagCount: snapshot.mergedTagCount,
      },
      output: {
        snapshotId: snapshot.id,
        literatureCount: snapshot.literatureCount,
        embeddingCount: snapshot.embeddingCount,
        added,
        updated,
        removed,
      },
      toolResults: [{
        tool: 'embedding-library.readUserLiteratureRecords',
        success: true,
        keywordCount: snapshot.keywordCount,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, snapshot };
  }

  async evaluate(userId: string, project?: AutoResearchProjectContext): Promise<{ state: AutoResearchState; report: AutoResearchSelfEvaluationReport }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const now = new Date().toISOString();
    const report = this.buildSelfEvaluationReport(state, now);
    const evidenceContext = this.buildEvidenceContext(state, now, 200);
    state.evaluations.unshift(report);
    state.evaluations = state.evaluations.slice(0, 50);
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== 'review') return stage;
      return {
        ...stage,
        status: report.overallScore >= 0.72 ? 'done' : 'active',
        notes: this.uniqueStrings([`自评 ${Math.round(report.overallScore * 100)} 分：${report.issues[0] || '暂无主要阻断项'}`, ...stage.notes]).slice(0, 20),
        artifacts: this.uniqueStrings([`self-evaluation:${report.id}`, ...stage.artifacts]).slice(0, 50),
        updatedAt: now,
      };
    });
    state.task.currentStageId = 'review';
    state.task.updatedAt = now;
    this.touchState(state, project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.self_evaluation',
      stageId: 'review',
      actor: 'system',
      status: 'completed',
      input: {
        evidenceObjectCount: evidenceContext.evidenceObjects.length,
        pdfWikiEvidenceObjectCount: evidenceContext.pdfWikiEvidenceObjects.length,
        embeddingEvidenceObjectCount: evidenceContext.embeddingEvidenceObjects.length,
        memoryCount: state.projectMemory.length,
        operationCount: state.operations.length,
      },
      output: {
        reportId: report.id,
        overallScore: report.overallScore,
        issueCount: report.issues.length,
      },
      toolResults: [{
        tool: 'AutoResearchManager.evaluate',
        success: true,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, report };
  }

  async rebuildResearchWiki(userId: string, project?: AutoResearchProjectContext): Promise<{ state: AutoResearchState; wiki: AutoResearchWikiState }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const now = new Date().toISOString();
    const wiki = this.buildResearchWikiState(state, now);
    state.researchWiki = wiki;
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== 'literature_map') return stage;
      return {
        ...stage,
        status: wiki.nodes.length > 0 ? 'done' : stage.status,
        notes: this.uniqueStrings([
          `研究 Wiki 已重建：${wiki.nodes.length} 个节点，${wiki.edges.length} 条关系`,
          ...stage.notes,
        ]).slice(0, 20),
        artifacts: this.uniqueStrings([`research-wiki:${now}`, ...stage.artifacts]).slice(0, 50),
        updatedAt: now,
      };
    });
    this.touchState(state, project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.research_wiki.rebuild',
      stageId: 'literature_map',
      actor: 'system',
      status: 'completed',
      input: {
        literatureNodeCount: state.literatureMap.nodes.length,
        evidenceObjectCount: state.evidenceLibrary.objects.length,
      },
      output: {
        wikiNodeCount: wiki.nodes.length,
        wikiEdgeCount: wiki.edges.length,
        queryPackLength: wiki.queryPack.length,
      },
      toolResults: [{
        tool: 'AutoResearchManager.rebuildResearchWiki',
        success: true,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, wiki };
  }

  async runAudit(userId: string, project?: AutoResearchProjectContext): Promise<{ state: AutoResearchState; report: AutoResearchAuditReport }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const now = new Date().toISOString();
    const wiki = this.buildResearchWikiState(state, now);
    state.researchWiki = wiki;
    const report = this.buildAuditReport(state, wiki, now);
    state.auditReports.unshift(report);
    state.auditReports = state.auditReports.slice(0, 30);
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== 'review') return stage;
      return {
        ...stage,
        status: report.verdict === 'pass' ? 'done' : 'active',
        notes: this.uniqueStrings([
          `引用-论据审计：${report.verdict.toUpperCase()}，${Math.round(report.overallScore * 100)} 分；${report.summary}`,
          ...stage.notes,
        ]).slice(0, 20),
        artifacts: this.uniqueStrings([`audit-report:${report.id}`, ...stage.artifacts]).slice(0, 50),
        updatedAt: now,
      };
    });
    state.task.currentStageId = 'review';
    state.task.updatedAt = now;
    this.touchState(state, project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.audit',
      stageId: 'review',
      actor: 'system',
      status: 'completed',
      input: {
        evidenceObjectCount: report.trace.evidenceObjectCount,
        referenceCount: report.trace.referenceCount,
        wikiNodeCount: report.trace.wikiNodeCount,
      },
      output: {
        reportId: report.id,
        verdict: report.verdict,
        overallScore: report.overallScore,
        findingCount: report.findings.length,
      },
      toolResults: [{
        tool: 'AutoResearchManager.runAudit',
        success: true,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, report };
  }

  async generateFinalReport(userId: string, project?: AutoResearchProjectContext): Promise<{ state: AutoResearchState; report: AutoResearchFinalReport }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, project);
    const now = new Date().toISOString();
    const report = this.buildFinalReport(state, now, await this.loadAutoResearchWritingSkill());
    state.finalReports.unshift(report);
    state.finalReports = state.finalReports.slice(0, 20);
    state.task.status = 'completed';
    state.task.currentStageId = 'revision';
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id === 'hypothesis') {
        return this.completeStage(stage, now, `生成 ${report.hypotheses.length} 条研究假设`, `final-report:${report.id}`);
      }
      if (stage.id === 'experiment_plan') {
        return this.completeStage(stage, now, `生成 ${report.experimentPlan.length} 条实验/数据计划`, `final-report:${report.id}`);
      }
      if (stage.id === 'draft') {
        return this.completeStage(stage, now, `生成 ${report.draftOutline.length} 条草稿结构`, `final-report:${report.id}`);
      }
      if (stage.id === 'revision') {
        return this.completeStage(stage, now, 'AutoResearch 自动运行完成，已生成最终结果', `final-report:${report.id}`);
      }
      return stage;
    });
    state.task.updatedAt = now;
    this.upsertCompletedTaskRecord(state, this.buildCompletedTaskRecord(state, report, now));
    this.upsertSystemMemory(state, {
      kind: 'finding',
      content: report.executiveSummary,
      source: 'autoresearch-final-report',
      tags: ['autoresearch', 'final-report'],
      evidenceObjectIds: report.evidenceSynthesis.flatMap(item => item.evidenceObjectIds).slice(0, 30),
      now,
    });
    for (const hypothesis of report.hypotheses.slice(0, 5)) {
      this.upsertSystemMemory(state, {
        kind: 'hypothesis',
        content: hypothesis,
        source: 'autoresearch-final-report',
        tags: ['autoresearch', 'hypothesis'],
        evidenceObjectIds: [],
        now,
      });
    }
    this.touchState(state, project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.final_report',
      stageId: 'revision',
      actor: 'system',
      status: 'completed',
      input: {
        topic: state.task.topic,
        literatureNodeCount: state.literatureMap.nodes.length,
        evidenceObjectCount: report.trace.evidenceObjectCount,
        pdfWikiEvidenceObjectCount: report.trace.pdfWikiEvidenceObjectCount || 0,
        embeddingEvidenceObjectCount: report.trace.embeddingEvidenceObjectCount || 0,
        evaluationCount: state.evaluations.length,
      },
      output: {
        reportId: report.id,
        hypothesisCount: report.hypotheses.length,
        knowledgeGapCount: report.knowledgeGaps.length,
        nextStepCount: report.nextSteps.length,
      },
      toolResults: [{
        tool: 'AutoResearchManager.generateFinalReport',
        success: true,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, report };
  }

  async updateFinalReportMarkdown(
    userId: string,
    input: UpdateAutoResearchFinalReportMarkdownInput
  ): Promise<{ state: AutoResearchState; report: AutoResearchFinalReport }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    const reportId = this.cleanText(input.reportId, 160);
    const reportIndex = state.finalReports.findIndex(report => report.id === reportId);
    if (reportIndex < 0) {
      throw new Error('未找到 AutoResearch 最终报告');
    }
    const markdown = this.cleanMarkdown(input.markdown, 200000);
    if (!markdown) {
      throw new Error('报告内容不能为空');
    }
    const report: AutoResearchFinalReport = {
      ...state.finalReports[reportIndex],
      editedMarkdown: markdown,
      editedAt: now,
    };
    state.finalReports[reportIndex] = report;
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.final_report.edit',
      stageId: 'revision',
      actor: 'user',
      status: 'completed',
      input: {
        reportId,
        markdownLength: markdown.length,
      },
      output: {
        reportId,
        editedAt: now,
      },
      toolResults: [],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, report };
  }

  async generatePaperDraft(
    userId: string,
    input: GenerateAutoResearchPaperDraftInput
  ): Promise<{ state: AutoResearchState; draft: AutoResearchPaperDraft }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    const reportId = this.cleanText(input.reportId, 160);
    const report = state.finalReports.find(item => item.id === reportId);
    if (!report) {
      throw new Error('未找到 AutoResearch 最终报告，无法写论文');
    }

    const evidenceContext = this.buildEvidenceContext(state, now, 200);
    const markdown = this.buildPaperDraftMarkdown(report, state, evidenceContext, await this.loadAutoResearchWritingSkill());
    const draft: AutoResearchPaperDraft = {
      id: `paper_${this.hash({ userId: safeUserId, reportId, now, markdown }).slice(0, 18)}`,
      reportId,
      generatedAt: now,
      topic: report.topic,
      title: `论文草稿：${report.topic}`,
      markdown,
      wordCountEstimate: this.estimateWordCount(markdown),
      referenceCount: this.collectPaperDraftReferences(evidenceContext.evidenceObjects).length,
      trace: {
        finalReportId: report.id,
        evaluationId: report.trace.evaluationId,
        totalLiteratureNodeCount: evidenceContext.allLiteratureNodes.length,
        literatureNodeCount: evidenceContext.literatureNodes.length,
        evidenceObjectCount: evidenceContext.evidenceObjects.length,
        pdfWikiEvidenceObjectCount: evidenceContext.pdfWikiEvidenceObjects.length,
        embeddingEvidenceObjectCount: evidenceContext.embeddingEvidenceObjects.length,
      },
    };

    state.paperDrafts.unshift(draft);
    state.paperDrafts = state.paperDrafts.slice(0, 20);
    this.attachPaperDraftToCompletedTaskRecord(state, report, draft, now);
    state.task.stages = this.ensureStages(state.task.stages, now).map(stage => {
      if (stage.id !== 'draft') return stage;
      return this.completeStage(stage, now, `一键写论文已生成草稿：${draft.wordCountEstimate} 字估算`, `paper-draft:${draft.id}`);
    });
    state.task.currentStageId = 'draft';
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.paper_draft',
      stageId: 'draft',
      actor: 'system',
      status: 'completed',
      input: {
        reportId,
        topic: report.topic,
        evidenceObjectCount: evidenceContext.evidenceObjects.length,
      },
      output: {
        draftId: draft.id,
        wordCountEstimate: draft.wordCountEstimate,
        referenceCount: draft.referenceCount,
      },
      toolResults: [{
        tool: 'AutoResearchManager.generatePaperDraft',
        success: true,
      }],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, draft };
  }

  async updatePaperDraftMarkdown(
    userId: string,
    input: UpdateAutoResearchPaperDraftMarkdownInput
  ): Promise<{ state: AutoResearchState; draft: AutoResearchPaperDraft }> {
    const safeUserId = sanitizeUserId(userId);
    const state = await this.loadState(safeUserId, input.project);
    const now = new Date().toISOString();
    const draftId = this.cleanText(input.draftId, 160);
    const draftIndex = state.paperDrafts.findIndex(draft => draft.id === draftId);
    if (draftIndex < 0) {
      throw new Error('未找到 AutoResearch 论文草稿');
    }
    const markdown = this.cleanMarkdown(input.markdown, 400000);
    if (!markdown) {
      throw new Error('论文草稿内容不能为空');
    }
    const draft: AutoResearchPaperDraft = {
      ...state.paperDrafts[draftIndex],
      editedMarkdown: markdown,
      editedAt: now,
      wordCountEstimate: this.estimateWordCount(markdown),
    };
    state.paperDrafts[draftIndex] = draft;
    this.touchState(state, input.project, now);
    await this.appendOperation(safeUserId, state, {
      kind: 'autoresearch.paper_draft.edit',
      stageId: 'draft',
      actor: 'user',
      status: 'completed',
      input: {
        draftId,
        markdownLength: markdown.length,
      },
      output: {
        draftId,
        editedAt: now,
        wordCountEstimate: draft.wordCountEstimate,
      },
      toolResults: [],
    }, now);
    await this.saveState(safeUserId, state);
    return { state, draft };
  }

  private buildCompletedTaskRecord(
    state: AutoResearchState,
    report: AutoResearchFinalReport,
    now: string
  ): AutoResearchCompletedTaskRecord {
    const latestAudit = state.auditReports[0];
    const stageTotalCount = state.task.stages.length;
    const stageDoneCount = state.task.stages.filter(stage => stage.status === 'done').length;
    return {
      id: `completed_${this.hash({ taskId: state.task.id, reportId: report.id, now }).slice(0, 18)}`,
      taskId: state.task.id,
      title: this.cleanText(state.task.title, 180) || report.title || DEFAULT_TASK_TITLE,
      topic: this.cleanText(report.topic || state.task.topic, 600),
      goal: this.cleanText(state.task.goal, 1200),
      projectId: state.projectId,
      projectName: state.projectName,
      completedAt: now,
      finalReportId: report.id,
      finalReportTitle: report.title,
      stageDoneCount,
      stageTotalCount,
      literatureNodeCount: report.trace.literatureNodeCount || 0,
      evidenceObjectCount: report.trace.evidenceObjectCount || 0,
      pdfWikiEvidenceObjectCount: report.trace.pdfWikiEvidenceObjectCount || 0,
      embeddingEvidenceObjectCount: report.trace.embeddingEvidenceObjectCount || 0,
      operationCount: report.trace.operationCount || state.operations.length,
      evaluationId: report.trace.evaluationId,
      auditReportId: latestAudit?.id,
      auditVerdict: latestAudit?.verdict,
      auditScore: latestAudit?.overallScore,
      createdAt: now,
      updatedAt: now,
    };
  }

  private upsertCompletedTaskRecord(state: AutoResearchState, record: AutoResearchCompletedTaskRecord): void {
    const records = Array.isArray(state.completedTaskRecords) ? state.completedTaskRecords : [];
    const existing = records.find(item => item.finalReportId === record.finalReportId || item.id === record.id);
    const nextRecord: AutoResearchCompletedTaskRecord = {
      ...(existing || record),
      ...record,
      id: existing?.id || record.id,
      createdAt: existing?.createdAt || record.createdAt,
      updatedAt: record.updatedAt,
    };
    state.completedTaskRecords = [
      nextRecord,
      ...records.filter(item => item.id !== nextRecord.id && item.finalReportId !== nextRecord.finalReportId),
    ].slice(0, 50);
  }

  private attachPaperDraftToCompletedTaskRecord(
    state: AutoResearchState,
    report: AutoResearchFinalReport,
    draft: AutoResearchPaperDraft,
    now: string
  ): void {
    if (!Array.isArray(state.completedTaskRecords)) state.completedTaskRecords = [];
    let record = state.completedTaskRecords.find(item => item.finalReportId === report.id);
    if (!record) {
      record = this.buildCompletedTaskRecord(state, report, report.generatedAt || now);
      state.completedTaskRecords.unshift(record);
    }
    record.paperDraftId = draft.id;
    record.paperDraftTitle = draft.title;
    record.paperDraftGeneratedAt = draft.generatedAt;
    record.updatedAt = now;
    state.completedTaskRecords = [
      record,
      ...state.completedTaskRecords.filter(item => item.id !== record!.id && item.finalReportId !== record!.finalReportId),
    ].slice(0, 50);
  }

  private deriveCompletedTaskRecordFromReport(
    state: AutoResearchState,
    report: AutoResearchFinalReport
  ): AutoResearchCompletedTaskRecord {
    const draft = state.paperDrafts.find(item => item.reportId === report.id);
    const now = report.generatedAt || new Date().toISOString();
    const record = this.buildCompletedTaskRecord(state, report, now);
    if (draft) {
      record.paperDraftId = draft.id;
      record.paperDraftTitle = draft.title;
      record.paperDraftGeneratedAt = draft.generatedAt;
      record.updatedAt = draft.editedAt || draft.generatedAt || now;
    }
    return record;
  }

  private buildResearchWikiState(state: AutoResearchState, now: string): AutoResearchWikiState {
    const evidenceContext = this.buildEvidenceContext(state, now, 200);
    const nodes = new Map<string, AutoResearchWikiNode>();
    const edges = new Map<string, AutoResearchWikiEdge>();
    const literatureNodeIdBySourceKey = new Map<string, string>();

    const addNode = (node: AutoResearchWikiNode): void => {
      const existing = nodes.get(node.id);
      if (!existing) {
        nodes.set(node.id, node);
        return;
      }
      nodes.set(node.id, {
        ...existing,
        title: existing.title || node.title,
        summary: existing.summary || node.summary,
        sourceUri: existing.sourceUri || node.sourceUri,
        tags: this.uniqueStrings([...existing.tags, ...node.tags]).slice(0, 30),
        evidenceObjectIds: this.uniqueStrings([...existing.evidenceObjectIds, ...node.evidenceObjectIds]).slice(0, 200),
        literatureNodeIds: this.uniqueStrings([...existing.literatureNodeIds, ...node.literatureNodeIds]).slice(0, 200),
        updatedAt: now,
      });
    };
    const addEdge = (edge: AutoResearchWikiEdge): void => {
      if (!edge.fromId || !edge.toId || edge.fromId === edge.toId) return;
      edges.set(edge.id, edge);
    };

    for (const literature of evidenceContext.literatureNodes.slice(0, 200)) {
      const nodeId = `wiki_paper_${literature.id}`;
      const node: AutoResearchWikiNode = {
        id: nodeId,
        type: 'paper',
        title: this.cleanText(literature.title, 240) || 'Untitled literature',
        summary: this.cleanText(literature.abstract || `${literature.authors} ${literature.year} ${literature.journal}`, 900),
        sourceUri: literature.trace?.sourceUri,
        tags: this.uniqueStrings([
          ...literature.keywords,
          ...literature.aiKeywords,
          literature.journal,
          literature.year ? `year:${literature.year}` : '',
        ]).slice(0, 18),
        evidenceObjectIds: [],
        literatureNodeIds: [literature.id],
        createdAt: now,
        updatedAt: now,
      };
      addNode(node);
      for (const key of this.getLiteratureSourceKeys(literature)) {
        if (key) literatureNodeIdBySourceKey.set(key, nodeId);
      }
    }

    const claimMap = this.groupEvidenceByClaim(evidenceContext.evidenceObjects);
    const claimNodeIdByClaim = new Map<string, string>();
    for (const [claimKey, items] of claimMap) {
      const title = this.cleanText(items[0]?.claim || claimKey, 240) || '未命名论点';
      const supportCount = items.filter(item => item.stance === 'support').length;
      const neutralCount = items.filter(item => item.stance === 'neutral').length;
      const opposeCount = items.filter(item => item.stance === 'oppose').length;
      const nodeId = `wiki_claim_${this.hash({ claim: claimKey }).slice(0, 18)}`;
      claimNodeIdByClaim.set(claimKey, nodeId);
      addNode({
        id: nodeId,
        type: 'claim',
        title,
        summary: this.cleanText([
          `支持 ${supportCount} 条，中性 ${neutralCount} 条，反对 ${opposeCount} 条。`,
          ...items.slice(0, 3).map(item => item.viewpointSummary || item.evidenceText),
        ].filter(Boolean).join(' '), 1000),
        tags: this.buildWikiTagsFromText(title),
        evidenceObjectIds: items.map(item => item.id),
        literatureNodeIds: this.uniqueStrings(items.map(item => item.trace?.literatureNodeId || '').filter(Boolean)),
        createdAt: now,
        updatedAt: now,
      });
    }

    for (const evidence of evidenceContext.evidenceObjects) {
      const claimNodeId = claimNodeIdByClaim.get(this.normalizeClaim(evidence.claim || evidence.claimId));
      if (!claimNodeId) continue;
      let paperNodeId = '';
      for (const key of this.getEvidenceSourceKeys(evidence)) {
        const matched = literatureNodeIdBySourceKey.get(key);
        if (matched) {
          paperNodeId = matched;
          break;
        }
      }
      if (!paperNodeId) {
        const ref = evidence.references[0];
        const sourceTitle = this.cleanText(evidence.sourcePdfTitle || ref?.title || evidence.sourcePdfName || '未命名来源', 240);
        const sourceKey = evidence.sourcePdfId || evidence.sourcePdfName || ref?.doi || ref?.title || sourceTitle || evidence.id;
        paperNodeId = `wiki_paper_pdf_${this.hash({ sourceKey }).slice(0, 18)}`;
        addNode({
          id: paperNodeId,
          type: 'paper',
          title: sourceTitle || '未命名来源',
          summary: this.cleanText([
            ref?.authors,
            ref?.year,
            ref?.journal,
            ref?.doi ? `DOI: ${ref.doi}` : '',
            evidence.location,
          ].filter(Boolean).join(' · '), 800),
          sourceUri: evidence.trace?.sourceUri,
          tags: this.uniqueStrings(['pdf-wiki', evidence.section, ref?.journal || '', ref?.year ? `year:${ref.year}` : '']).slice(0, 12),
          evidenceObjectIds: [evidence.id],
          literatureNodeIds: this.uniqueStrings([evidence.trace?.literatureNodeId || ''].filter(Boolean)),
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const existing = nodes.get(paperNodeId);
        if (existing) {
          addNode({
            ...existing,
            evidenceObjectIds: [...existing.evidenceObjectIds, evidence.id],
            literatureNodeIds: this.uniqueStrings([...existing.literatureNodeIds, evidence.trace?.literatureNodeId || ''].filter(Boolean)),
            updatedAt: now,
          });
        }
      }
      const type: AutoResearchWikiEdgeType = evidence.stance === 'oppose'
        ? 'opposes'
        : evidence.stance === 'neutral'
          ? 'neutral_about'
          : 'supports';
      addEdge({
        id: `wiki_edge_${this.hash({ from: paperNodeId, to: claimNodeId, evidenceId: evidence.id, type }).slice(0, 20)}`,
        type,
        fromId: paperNodeId,
        toId: claimNodeId,
        evidence: this.cleanText(evidence.evidenceText || evidence.viewpointSummary, 700),
        sourceUri: evidence.trace?.sourceUri,
        createdAt: now,
        updatedAt: now,
      });
    }

    const gapTexts = this.uniqueStrings([
      ...((state.finalReports[0]?.knowledgeGaps || []).slice(0, 12)),
      ...((state.evaluations[0]?.issues || []).filter(item => /缺口|不足|缺少|补充|无法检查/.test(item)).slice(0, 8)),
      ...((state.evaluations[0]?.recommendations || []).slice(0, 6)),
    ]).slice(0, 12);
    const gapNodeIds: string[] = [];
    for (const gap of gapTexts) {
      const nodeId = `wiki_gap_${this.hash({ gap }).slice(0, 18)}`;
      gapNodeIds.push(nodeId);
      addNode({
        id: nodeId,
        type: 'gap',
        title: this.cleanText(gap, 180),
        summary: this.cleanText(gap, 700),
        tags: this.buildWikiTagsFromText(gap),
        evidenceObjectIds: [],
        literatureNodeIds: [],
        createdAt: now,
        updatedAt: now,
      });
    }

    const claimNodes = Array.from(nodes.values()).filter(node => node.type === 'claim');
    for (const gapNodeId of gapNodeIds) {
      const gapNode = nodes.get(gapNodeId);
      if (!gapNode) continue;
      let linkedCount = 0;
      for (const claimNode of claimNodes) {
        if (linkedCount >= 4) break;
        if (!this.hasWikiTermOverlap(claimNode.title + ' ' + claimNode.summary, gapNode.title + ' ' + gapNode.summary)) continue;
        addEdge({
          id: `wiki_edge_${this.hash({ from: claimNode.id, to: gapNode.id, type: 'addresses_gap' }).slice(0, 20)}`,
          type: 'addresses_gap',
          fromId: claimNode.id,
          toId: gapNode.id,
          evidence: `该论点可用于补充或界定知识缺口：${this.cleanText(gapNode.title, 220)}`,
          createdAt: now,
          updatedAt: now,
        });
        linkedCount += 1;
      }
    }

    const wiki: AutoResearchWikiState = {
      nodes: Array.from(nodes.values()).sort((a, b) => a.type.localeCompare(b.type) || a.title.localeCompare(b.title, 'zh-CN')).slice(0, 500),
      edges: Array.from(edges.values()).sort((a, b) => a.type.localeCompare(b.type) || a.fromId.localeCompare(b.fromId)).slice(0, 1200),
      queryPack: '',
      updatedAt: now,
    };
    wiki.queryPack = this.buildResearchWikiQueryPack(state, wiki, evidenceContext);
    return wiki;
  }

  private buildAuditReport(state: AutoResearchState, wiki: AutoResearchWikiState, now: string): AutoResearchAuditReport {
    const evidenceContext = this.buildEvidenceContext(state, now, 200);
    const evidenceObjects = evidenceContext.evidenceObjects;
    const claimMap = this.groupEvidenceByClaim(evidenceObjects);
    const totalEvidence = evidenceObjects.length;
    const citedEvidence = evidenceObjects.filter(item => item.references.length > 0 || item.inTextCitations.length > 0).length;
    const sourceLinkedEvidence = evidenceObjects.filter(item => item.trace?.sourceUri || item.sourcePdfId || item.sourcePdfName || item.references.length > 0).length;
    const weakGroundingEvidence = evidenceObjects.filter(item => Number(item.groundingScore || 0) < 0.45).length;
    const supportedClaimCount = Array.from(claimMap.values()).filter(items => items.some(item => item.stance === 'support')).length;
    const contrastedClaimCount = Array.from(claimMap.values()).filter(items => items.some(item => item.stance === 'oppose' || item.stance === 'neutral')).length;
    const unsupportedClaims = Array.from(claimMap.entries()).filter(([, items]) => !items.some(item => item.stance === 'support'));
    const referenceCount = this.uniqueStrings(evidenceObjects.flatMap(item => item.references.map(ref => ref.doi || ref.title || ref.raw || ref.id))).length;
    const completedOperations = state.operations.filter(operation => operation.status === 'completed');
    const replayableOperations = completedOperations.filter(operation => operation.replayFile && operation.inputHash).length;
    const operationReplayRatio = completedOperations.length === 0 ? 0 : replayableOperations / completedOperations.length;
    const citationScore = totalEvidence === 0 ? 0 : citedEvidence / totalEvidence;
    const sourceScore = totalEvidence === 0 ? 0 : sourceLinkedEvidence / totalEvidence;
    const groundingScore = totalEvidence === 0 ? 0 : 1 - weakGroundingEvidence / totalEvidence;
    const supportScore = claimMap.size === 0 ? 0 : supportedClaimCount / claimMap.size;
    const contrastScore = claimMap.size === 0 ? 0 : contrastedClaimCount / claimMap.size;
    const replayScore = completedOperations.length === 0 ? 0 : operationReplayRatio;
    const wikiScore = wiki.nodes.length > 0 && wiki.edges.length > 0 ? 1 : wiki.nodes.length > 0 ? 0.55 : 0;
    const overallScore = this.roundScore(
      citationScore * 0.22
      + sourceScore * 0.14
      + groundingScore * 0.18
      + supportScore * 0.2
      + contrastScore * 0.1
      + replayScore * 0.08
      + wikiScore * 0.08
    );
    const findings: AutoResearchAuditFinding[] = [];
    findings.push(this.buildAuditFinding(
      citationScore >= 0.85 ? 'pass' : citationScore >= 0.6 ? 'warn' : 'fail',
      'citation',
      totalEvidence > 0 ? `引用覆盖 ${citedEvidence}/${totalEvidence}` : '暂无可审计证据对象',
      undefined,
      totalEvidence > 0 ? `${totalEvidence - citedEvidence} 个证据对象缺少 reference 或文中引文。` : '请先同步 PDF Wiki 或 embedding 文献库。'
    ));
    findings.push(this.buildAuditFinding(
      sourceScore >= 0.95 ? 'pass' : sourceScore >= 0.75 ? 'warn' : 'fail',
      'evidence',
      totalEvidence > 0 ? `来源追溯 ${sourceLinkedEvidence}/${totalEvidence}` : '暂无来源追溯',
      undefined,
      '证据对象应能回到 PDF Wiki、文献库或参考文献元数据。'
    ));
    findings.push(this.buildAuditFinding(
      groundingScore >= 0.85 ? 'pass' : groundingScore >= 0.65 ? 'warn' : 'fail',
      'evidence',
      `弱证据 ${weakGroundingEvidence}/${totalEvidence}`,
      undefined,
      'groundingScore 低于 0.45 的证据需要回到原文句子、页码或参考文献重新核验。'
    ));
    findings.push(this.buildAuditFinding(
      supportScore >= 0.95 ? 'pass' : supportScore >= 0.65 ? 'warn' : 'fail',
      'claim',
      claimMap.size > 0 ? `支持证据覆盖 ${supportedClaimCount}/${claimMap.size} 个论点` : '暂无论点组',
      unsupportedClaims[0]?.[0],
      unsupportedClaims.length ? `缺少支持证据的论点示例：${this.cleanText(unsupportedClaims[0][0], 160)}` : '每个论点组均有支持材料。'
    ));
    findings.push(this.buildAuditFinding(
      contrastScore >= 0.35 ? 'pass' : contrastScore >= 0.15 ? 'warn' : 'fail',
      'claim',
      claimMap.size > 0 ? `中性/反对材料覆盖 ${contrastedClaimCount}/${claimMap.size} 个论点` : '暂无可比较论点',
      undefined,
      '综述写作需要保留边界条件、相反结论和中性材料，避免只写支持性证据。'
    ));
    findings.push(this.buildAuditFinding(
      replayScore >= 0.9 ? 'pass' : replayScore >= 0.6 ? 'warn' : 'fail',
      'reproducibility',
      completedOperations.length > 0 ? `可回放操作 ${replayableOperations}/${completedOperations.length}` : '暂无已完成操作',
      undefined,
      '关键自动化步骤应带输入哈希、输出哈希和 replay 文件。'
    ));
    findings.push(this.buildAuditFinding(
      wikiScore >= 0.9 ? 'pass' : wikiScore >= 0.5 ? 'warn' : 'fail',
      'evidence',
      `研究 Wiki ${wiki.nodes.length} 个节点 / ${wiki.edges.length} 条关系`,
      undefined,
      '研究 Wiki 用于把文献、论点和缺口组成可被一键写论文调用的上下文包。'
    ));
    const hasFail = findings.some(item => item.level === 'fail');
    const hasWarn = findings.some(item => item.level === 'warn');
    const verdict: AutoResearchAuditVerdict = hasFail || overallScore < 0.45 ? 'fail' : hasWarn || overallScore < 0.75 ? 'warn' : 'pass';
    return {
      id: `audit_${this.hash({ userId: state.userId, now, overallScore, findings }).slice(0, 18)}`,
      generatedAt: now,
      verdict,
      overallScore,
      summary: `证据 ${totalEvidence} 个，论点 ${claimMap.size} 个，引用覆盖 ${citedEvidence}/${totalEvidence}，研究 Wiki ${wiki.nodes.length} 个节点。`,
      findings,
      trace: {
        evaluationId: state.evaluations[0]?.id,
        evidenceObjectCount: totalEvidence,
        referenceCount,
        operationCount: state.operations.length,
        wikiNodeCount: wiki.nodes.length,
        wikiEdgeCount: wiki.edges.length,
      },
    };
  }

  private buildPaperDraftMarkdown(
    report: AutoResearchFinalReport,
    state: AutoResearchState,
    evidenceContext: AutoResearchEvidenceContext,
    autoResearchWritingSkill: string
  ): string {
    const topic = this.cleanText(report.topic || state.task.topic, 500) || '未命名研究主题';
    const evidenceObjects = evidenceContext.evidenceObjects;
    const references = this.collectPaperDraftReferences(evidenceObjects);
    const latestAudit = state.auditReports[0];
    const topicReview = report.paperTopicReview;
    const blueprint = report.paperWritingBlueprint;
    const contentEnhancement = report.contentEnhancementReport;
    const citationByReferenceId = new Map(references.map((ref, index) => [ref.id, `[${index + 1}]`]));
    const citeForEvidence = (evidenceIds: string[]): string => {
      const ids = new Set(evidenceIds);
      const citations = this.uniqueStrings(evidenceObjects
        .filter(item => ids.has(item.id))
        .flatMap(item => item.references.map(ref => citationByReferenceId.get(ref.id) || ''))
        .filter(Boolean));
      return citations.slice(0, 4).join('');
    };
    const citeTop = (limit: number): string => references.slice(0, limit).map((_, index) => `[${index + 1}]`).join('');
    const firstHypothesis = report.hypotheses[0] || `围绕“${topic}”形成可检验机制假设。`;
    const evidenceLines = (report.evidenceSynthesis || []).slice(0, 8).map((item, index) => {
      const citation = citeForEvidence(item.evidenceObjectIds || []);
      return `${index + 1}. ${item.claim}${citation}：${item.summary || '该论点仍需补充证据摘要。'} 支持证据 ${item.supportCount} 条，中性证据 ${item.neutralCount} 条，反对证据 ${item.opposeCount} 条。`;
    });
    const hypothesisLines = (report.hypotheses || []).slice(0, 6).map((item, index) => `${index + 1}. ${item}`);
    const gapLines = (report.knowledgeGaps || []).slice(0, 6).map((item, index) => `${index + 1}. ${item}`);
    const planLines = (report.experimentPlan || []).slice(0, 6).map(item => item.replace(/^\d+\.\s*/, ''));
    const methodSource = evidenceContext.pdfWikiEvidenceObjects.length > 0 && evidenceContext.embeddingEvidenceObjects.length > 0
      ? `本研究同时使用 PDF句子级Wiki论点库和 embedding 文献库，并按 1:1 权重交错纳入证据；PDF Wiki 提供原文句级证据，embedding 文献库提供标题、摘要、作者、年份、期刊和 DOI 的论文级证据。`
      : evidenceContext.pdfWikiEvidenceObjects.length > 0
        ? `本研究使用 PDF句子级Wiki论点库生成的句级证据对象；当前 embedding 文献库未提供可用摘要证据。`
        : `由于当前 PDF Wiki 句级证据不足，本研究使用 embedding 文献库中的标题、摘要、作者、年份、期刊和 DOI 构建论文级证据对象。`;
    const evidenceQuality = `当前等权纳入证据对象 ${evidenceContext.evidenceObjects.length} 个；原始可用 PDF Wiki 句级证据 ${evidenceContext.pdfWikiEvidenceObjects.length} 个，embedding 摘要证据 ${evidenceContext.embeddingEvidenceObjects.length} 个；主题相关文献 ${evidenceContext.literatureNodes.length}/${evidenceContext.allLiteratureNodes.length} 篇。`;
    const keywords = this.uniqueStrings([
      ...this.buildTopicSearchTerms(topic).slice(0, 6),
      ...this.buildLiteratureTagsFromNodes(evidenceContext.literatureNodes)
        .filter(tag => tag.kind === 'keyword' || tag.kind === 'aiKeyword')
        .slice(0, 6)
        .map(tag => tag.name),
    ]).slice(0, 8);
    const title = blueprint?.recommendedTitle || this.buildPaperDraftTitle(topic);
    const lines: string[] = [];
    lines.push(`# ${title}`);
    lines.push('');
    if (topicReview || blueprint) {
      lines.push('## AutoResearch 写作蓝图');
      if (autoResearchWritingSkill.trim()) {
        lines.push('- 写作控制：已接入 AutoResearch 论文选题与内容 Skill，正文必须遵守证据边界、不能写结论和质量控制约束。');
      }
      if (topicReview) {
        lines.push(`- 推荐论文类型：${topicReview.paperType}`);
        lines.push(`- 选题风险：${topicReview.topicRiskLevel}；写作判定：${topicReview.goToWritingStage}`);
        lines.push(`- 实际证据范围：${topicReview.actualEvidenceScope}`);
      }
      if (blueprint) {
        lines.push(`- 核心研究对象：${blueprint.coreResearchObject}`);
        lines.push(`- 中心论点：${blueprint.centralArgument}`);
        if (blueprint.coreScientificQuestions.length) {
          lines.push(`- 核心科学问题：${blueprint.coreScientificQuestions.join('；')}`);
        }
        if (blueprint.claimsToAvoid.length) {
          lines.push(`- 写作禁止越界：${blueprint.claimsToAvoid.slice(0, 5).join('；')}`);
        }
      }
      if (contentEnhancement) {
        lines.push(`- 内容增强判定：${contentEnhancement.goNoGoDecision.decision}；${contentEnhancement.goNoGoDecision.reason}`);
        if (contentEnhancement.positiveFindings.length) {
          lines.push(`- 正向发现主线：${contentEnhancement.positiveFindings.slice(0, 3).join('；')}`);
        }
      }
      lines.push('');
    }
    lines.push('## 摘要');
    lines.push(`围绕“${topic}”，本文基于 AutoResearch 的选题前置审查、文献图谱、PDF Wiki/embedding 证据库和证据分级蓝图构建论文框架。${report.executiveSummary || ''} ${blueprint?.centralArgument || `结果显示，${firstHypothesis}${citeTop(Math.min(3, references.length))}。`} 当前证据仍需进一步补充中性和反对材料，尤其需要把摘要级证据推进到 PDF 原文句级定位。`);
    lines.push('');
    lines.push(`**关键词**：${keywords.length ? keywords.join('；') : topic}`);
    lines.push('');
    lines.push('## 1. 引言');
    lines.push(`${topic} 是连接研究对象、证据边界和机制解释的综合性问题。AutoResearch 前置审查提示，本稿应优先围绕“${blueprint?.coreResearchObject || topic}”展开，并明确哪些结论可由直接证据支持、哪些只能作为相邻或机制证据使用${citeTop(Math.min(4, references.length))}。然而，不同研究之间常因研究区域、作物制度、土壤条件、处理方式和观测尺度不同而产生结论差异。`);
    lines.push('');
    lines.push(`本文的目标是将 AutoResearch 形成的文献图谱和证据库转化为可写作的论文草稿：首先筛选主题相关文献，其次抽取或派生论点级证据，再对引用对齐、证据充分性、创新性和可复现性进行审稿式自检，最后提出研究假设、知识缺口和后续分析计划。`);
    lines.push('');
    lines.push('## 2. 文献与证据来源');
    lines.push(`${methodSource}${evidenceQuality}`);
    if (blueprint) {
      lines.push('');
      lines.push('本稿写作遵循 AutoResearch 论文蓝图：直接证据用于支撑核心结论，相邻证据用于比较和界定适用条件，机制证据用于解释可能过程；蓝图标记为“不能写”的结论不进入正文强结论。');
    }
    if (report.literatureOverview.length > 0) {
      lines.push('');
      lines.push(report.literatureOverview.slice(0, 4).join(' '));
    }
    lines.push('');
    lines.push('## 3. 研究方法');
    lines.push('本文采用自动化证据综合流程：第一步，依据研究主题对 embedding 文献库进行主题相关性筛选；第二步，从 PDF Wiki 或文献摘要中生成论点级 evidence object；第三步，检查每个证据对象是否包含引用、来源和可追溯信息；第四步，按照支持、中性和反对立场组织证据；第五步，依据自检结果修订研究假设与写作框架。');
    if (planLines.length > 0) {
      lines.push('');
      lines.push('后续实证或 Meta 分析可按以下计划展开：');
      planLines.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }
    lines.push('');
    lines.push('## 4. 结果');
    if (evidenceLines.length > 0) {
      lines.push('### 4.1 证据综合');
      evidenceLines.forEach(line => lines.push(line));
    } else {
      lines.push('### 4.1 证据综合');
      lines.push('当前尚未形成足够的论点级证据综合。需要先扩充 embedding 文献库或运行 PDF Wiki 深入分析。');
    }
    if (contentEnhancement) {
      this.appendContentEnhancementResultSections(lines, contentEnhancement);
    }
    if (hypothesisLines.length > 0) {
      lines.push('');
      lines.push(contentEnhancement ? '### 4.7 研究假设' : '### 4.2 研究假设');
      hypothesisLines.forEach(line => lines.push(line));
    }
    lines.push('');
    lines.push('## 5. 讨论');
    lines.push('现有结果表明，论文写作应避免直接把单篇文献摘要等同于最终结论。摘要级证据可以支持快速形成论文结构和初步引用对齐，但关键结论仍需要回到 PDF 原文、页码、证据句和参考文献编号进行核验。');
    if (contentEnhancement) {
      this.appendContentEnhancementDiscussionSections(lines, contentEnhancement);
    }
    if (gapLines.length > 0) {
      lines.push('');
      lines.push('主要知识缺口包括：');
      gapLines.forEach(line => lines.push(line));
    }
    if (report.reviewSummary) {
      lines.push('');
      lines.push(`审稿式自检显示：${report.reviewSummary}`);
    }
    if (latestAudit) {
      const riskLines = latestAudit.findings
        .filter(item => item.level !== 'pass')
        .slice(0, 4)
        .map(item => `${item.message}（${item.detail}）`);
      lines.push('');
      lines.push('### 5.1 引用与证据审计提示');
      lines.push(`自动审计结论为 ${latestAudit.verdict.toUpperCase()}，得分 ${Math.round(latestAudit.overallScore * 100)}。${latestAudit.summary}`);
      if (riskLines.length > 0) {
        riskLines.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
      }
    }
    lines.push('');
    lines.push('## 6. 结论');
    if (contentEnhancement) {
      contentEnhancement.revisedConclusionLogic.slice(0, 4).forEach(item => {
        lines.push(this.cleanText(item, 700));
        lines.push('');
      });
      lines.push(`AutoResearch 内容增强判定为 ${contentEnhancement.goNoGoDecision.decision}：${contentEnhancement.goNoGoDecision.reason}`);
    } else {
      lines.push(`本文基于 AutoResearch 流程形成了关于“${topic}”的论文草稿。当前版本已经具备主题文献图谱、论文级证据、研究假设、前置选题审查和写作蓝图，但仍需进一步补齐 PDF 原文证据、反对/中性材料和可复现实证分析。下一步应优先围绕核心科学问题建立数据表和编码规则，并将摘要级证据逐步替换或校准为句级证据。`);
    }
    lines.push('');
    lines.push('## 参考文献');
    if (references.length === 0) {
      lines.push('暂无可格式化参考文献。');
    } else {
      references.forEach((ref, index) => lines.push(`[${index + 1}] ${this.formatEvidenceReferenceForPaper(ref)}`));
    }
    lines.push('');
    lines.push('## AutoResearch 追溯');
    lines.push(`- 最终报告：${report.id}`);
    lines.push(`- 自评报告：${report.trace.evaluationId || '未记录'}`);
    lines.push(`- 等权纳入证据：${evidenceContext.evidenceObjects.length}`);
    lines.push(`- PDF Wiki 句级证据原始数量：${evidenceContext.pdfWikiEvidenceObjects.length}`);
    lines.push(`- Embedding 摘要证据原始数量：${evidenceContext.embeddingEvidenceObjects.length}`);
    lines.push('- 说明：本草稿为自动生成的论文初稿，需要人工核验关键事实、统计结果、引用格式和目标期刊规范。');
    lines.push('');
    return lines.join('\n');
  }

  private appendContentEnhancementResultSections(lines: string[], report: AutoResearchContentEnhancementReport): void {
    lines.push('');
    lines.push('### 4.2 正向发现');
    if (report.positiveFindings.length === 0) {
      lines.push('当前材料尚未支持明确正向发现；需要先补充可追溯证据对象。');
    } else {
      report.positiveFindings.slice(0, 6).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }

    lines.push('');
    lines.push('### 4.3 Table 1. Evidence Matrix');
    this.appendMarkdownTable(lines, [
      'Study / Data source',
      'Object / System',
      'Context',
      'Variable / Intervention',
      'Outcome / Indicator',
      'Quantitative result',
      'Mechanism indicator',
      'Evidence class',
      'Evidence strength',
      'Supported claim',
      'Claim to avoid',
    ], report.evidenceMatrix.slice(0, 12).map(row => [
      row.studyOrDataSource,
      row.objectPopulationSystem,
      row.contextRegionScenario,
      row.variableInterventionExposure,
      row.outcomeIndicator,
      row.quantitativeResult,
      row.mechanismIndicator,
      row.evidenceClass,
      row.evidenceStrength,
      row.supportedClaim,
      row.claimToAvoid,
    ]));

    lines.push('');
    lines.push('### 4.4 Table 2. Variable-Mechanism-Outcome Matrix');
    this.appendMarkdownTable(lines, [
      'Variable / Intervention / Phenomenon',
      'Direct effect',
      'Intermediate mechanism',
      'Primary outcome',
      'Secondary outcome / Trade-off',
      'Evidence class',
      'Evidence strength',
      'Boundary condition',
      'Uncertainty',
    ], report.variableMechanismOutcomeMatrix.slice(0, 12).map(row => [
      row.variableInterventionPhenomenon,
      row.directEffect,
      row.intermediateMechanism,
      row.primaryOutcome,
      row.secondaryOutcomeTradeoff,
      row.evidenceClass,
      row.evidenceStrength,
      row.boundaryCondition,
      row.uncertainty,
    ]));

    lines.push('');
    lines.push('### 4.5 Table 3. Quantitative Result Summary');
    if (report.quantitativeResultSummary.length === 0) {
      lines.push('NR: 当前材料未提供可安全提取的量化结果；不得编造效应量、P 值、置信区间或实验统计。');
    } else {
      this.appendMarkdownTable(lines, [
        'Source',
        'Object / Group',
        'Treatment / Variable',
        'Indicator',
        'Baseline / Control',
        'Reported value or change',
        'Direction',
        'Statistical information',
        'Interpretation',
        'Limitation',
      ], report.quantitativeResultSummary.slice(0, 12).map(row => [
        row.source,
        row.objectGroup,
        row.treatmentVariable,
        row.indicator,
        row.baselineControl,
        row.reportedValueOrChange,
        row.direction,
        row.statisticalInformation,
        row.interpretation,
        row.limitation,
      ]));
    }

    lines.push('');
    lines.push('### 4.6 Indicator Boundary Check');
    this.appendMarkdownTable(lines, [
      'Indicator',
      'What it can support',
      'What it cannot support',
      'Needs separation from',
    ], report.indicatorBoundaryCheck.slice(0, 10).map(row => [
      row.indicator,
      row.whatItCanSupport,
      row.whatItCannotSupport,
      row.needsSeparationFrom,
    ]));
  }

  private appendContentEnhancementDiscussionSections(lines: string[], report: AutoResearchContentEnhancementReport): void {
    lines.push('');
    lines.push('### 5.1 Innovation Framework');
    lines.push(`**Framework name**: ${report.innovationFramework.frameworkName}`);
    lines.push('');
    lines.push(report.innovationFramework.coreLogic);
    if (report.innovationFramework.components.length > 0) {
      lines.push('');
      lines.push('Components:');
      report.innovationFramework.components.slice(0, 8).forEach((item, index) => lines.push(`${index + 1}. ${item}`));
    }

    lines.push('');
    lines.push('### 5.2 Figure 1. Conceptual Framework');
    lines.push(report.proposedConceptualFigure.caption);
    lines.push('');
    lines.push('```mermaid');
    lines.push(report.proposedConceptualFigure.mermaid);
    lines.push('```');

    lines.push('');
    lines.push('### 5.3 Figure 2. Evidence Strength Heatmap');
    this.appendMarkdownTable(lines, [
      'Pathway / Topic',
      'Direct evidence',
      'System-specific evidence',
      'Adjacent evidence',
      'Mechanistic evidence',
      'Overall confidence',
    ], report.evidenceStrengthHeatmap.slice(0, 10).map(row => [
      row.pathwayTopic,
      row.directEvidence,
      row.systemSpecificEvidence,
      row.adjacentEvidence,
      row.mechanisticEvidence,
      row.overallConfidence,
    ]));

    lines.push('');
    lines.push('### 5.4 Revised Discussion Logic');
    report.revisedDiscussionStructure.slice(0, 6).forEach((item, index) => lines.push(`${index + 1}. ${item}`));

    lines.push('');
    lines.push('### 5.5 Reference Cleaning Notes');
    lines.push(`- Core evidence to retain: ${report.referenceCleaningNotes.coreEvidenceToRetain.join('；') || 'NR'}`);
    lines.push(`- Mechanistic evidence to retain: ${report.referenceCleaningNotes.mechanisticEvidenceToRetain.join('；') || 'NR'}`);
    lines.push(`- Background evidence to retain: ${report.referenceCleaningNotes.backgroundEvidenceToRetain.join('；') || 'NR'}`);
    lines.push(`- References requiring verification: ${report.referenceCleaningNotes.referencesRequiringVerification.join('；') || 'NR'}`);
    lines.push(`- References to remove or exclude: ${report.referenceCleaningNotes.referencesToRemoveOrExclude.join('；') || 'NR'}`);
  }

  private appendMarkdownTable(lines: string[], headers: string[], rows: string[][]): void {
    if (rows.length === 0) {
      lines.push('暂无可填充行。');
      return;
    }
    lines.push(`| ${headers.map(header => this.escapeMarkdownTableCell(header)).join(' | ')} |`);
    lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
    rows.forEach(row => {
      const cells = headers.map((_, index) => this.escapeMarkdownTableCell(row[index] || 'NR'));
      lines.push(`| ${cells.join(' | ')} |`);
    });
  }

  private escapeMarkdownTableCell(value: string): string {
    return this.cleanText(value, 500).replace(/\|/g, '/').replace(/\n/g, ' ');
  }

  private buildPaperDraftTitle(topic: string): string {
    if (/氮肥|n2o|氧化亚氮|nitrous oxide/i.test(topic)) {
      return `不同氮肥管理措施对农田 N2O 排放的影响及其机理：基于 AutoResearch 证据链的综述草稿`;
    }
    return `${topic}：基于 AutoResearch 证据链的论文草稿`;
  }

  private buildWikiTagsFromText(text: string): string[] {
    const terms = this.extractWikiTerms(text);
    return this.uniqueStrings(terms).slice(0, 12);
  }

  private extractWikiTerms(text: string): string[] {
    const clean = this.normalizeSearchText(text);
    const latin = clean.match(/[a-z][a-z0-9+-]{2,}/g) || [];
    const chinese = clean.match(/[\u4e00-\u9fff]{2,8}/g) || [];
    const stopWords = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', '研究', '证据', '论点', '缺少', '不足', '无法检查']);
    return this.uniqueStrings([...latin, ...chinese].filter(term => !stopWords.has(term))).slice(0, 40);
  }

  private hasWikiTermOverlap(left: string, right: string): boolean {
    const leftTerms = new Set(this.extractWikiTerms(left).map(normalizeKeyword).filter(term => term.length >= 2));
    const rightTerms = this.extractWikiTerms(right).map(normalizeKeyword).filter(term => term.length >= 2);
    if (leftTerms.size === 0 || rightTerms.length === 0) return false;
    let overlap = 0;
    for (const term of rightTerms) {
      if (leftTerms.has(term)) overlap += 1;
      if (overlap >= 2) return true;
    }
    return false;
  }

  private buildResearchWikiQueryPack(
    state: AutoResearchState,
    wiki: AutoResearchWikiState,
    evidenceContext: AutoResearchEvidenceContext
  ): string {
    const claimMap = this.groupEvidenceByClaim(evidenceContext.evidenceObjects);
    const topTags = (state.literatureMap.tags || [])
      .filter(tag => tag.kind === 'mergedTag' || tag.kind === 'keyword' || tag.kind === 'aiKeyword')
      .slice(0, 12)
      .map(tag => `${tag.name}(${tag.count})`);
    const claimLines = Array.from(claimMap.entries()).slice(0, 24).map(([claim, items], index) => {
      const supportCount = items.filter(item => item.stance === 'support').length;
      const neutralCount = items.filter(item => item.stance === 'neutral').length;
      const opposeCount = items.filter(item => item.stance === 'oppose').length;
      const refs = this.uniqueStrings(items.flatMap(item => item.references.map(ref => ref.doi || ref.title || ref.raw || ref.id))).slice(0, 3);
      return `${index + 1}. ${this.cleanText(items[0]?.claim || claim, 180)} | support=${supportCount}, neutral=${neutralCount}, oppose=${opposeCount}${refs.length ? ` | refs=${refs.join('; ')}` : ''}`;
    });
    const gapLines = wiki.nodes
      .filter(node => node.type === 'gap')
      .slice(0, 12)
      .map((node, index) => `${index + 1}. ${node.title}`);
    const latestAudit = state.auditReports[0];
    const lines = [
      'AutoResearch Research Wiki Query Pack',
      `Project: ${state.projectName || ''}`,
      `Topic: ${state.task.topic || state.task.goal || ''}`,
      `Literature nodes: ${evidenceContext.literatureNodes.length}/${evidenceContext.allLiteratureNodes.length}`,
      `Evidence objects: ${evidenceContext.evidenceObjects.length} equal-weight selected (PDF Wiki raw ${evidenceContext.pdfWikiEvidenceObjects.length}, embedding abstracts raw ${evidenceContext.embeddingEvidenceObjects.length})`,
      `Wiki graph: ${wiki.nodes.length} nodes, ${wiki.edges.length} edges`,
      topTags.length ? `Top tags: ${topTags.join(', ')}` : '',
      latestAudit ? `Latest audit: ${latestAudit.verdict}, score ${Math.round(latestAudit.overallScore * 100)}. ${latestAudit.summary}` : '',
      '',
      'Core claims:',
      ...(claimLines.length ? claimLines : ['No claim-level evidence yet.']),
      '',
      'Knowledge gaps and writing risks:',
      ...(gapLines.length ? gapLines : ['No gap nodes yet. Run self-evaluation/final report to produce gaps.']),
    ].filter(Boolean);
    return this.cleanText(lines.join('\n'), 8000);
  }

  private buildAuditFinding(
    level: AutoResearchAuditVerdict,
    category: AutoResearchAuditFinding['category'],
    message: string,
    targetId: string | undefined,
    detail: string
  ): AutoResearchAuditFinding {
    return {
      id: `audit_find_${this.hash({ level, category, message, targetId, detail }).slice(0, 14)}`,
      level,
      category,
      message: this.cleanText(message, 220),
      targetId: targetId ? this.cleanText(targetId, 160) : undefined,
      detail: this.cleanText(detail, 900),
    };
  }

  private collectPaperDraftReferences(evidenceObjects: AutoResearchEvidenceObject[]): AutoResearchEvidenceReference[] {
    const seen = new Set<string>();
    const references: AutoResearchEvidenceReference[] = [];
    for (const evidence of evidenceObjects) {
      for (const ref of evidence.references || []) {
        const key = normalizeKeyword(ref.doi) || normalizeKeyword(ref.title) || normalizeKeyword(ref.raw) || ref.id;
        if (!key || seen.has(key)) continue;
        seen.add(key);
        references.push(ref);
      }
    }
    return references.slice(0, 80);
  }

  private formatEvidenceReferenceForPaper(ref: AutoResearchEvidenceReference): string {
    const parts = [
      ref.authors || 'Unknown author',
      ref.year ? `(${ref.year})` : '',
      ref.title || ref.raw || 'Untitled',
      ref.journal || '',
      ref.doi ? `DOI: ${ref.doi}` : '',
    ].filter(Boolean);
    return parts.join('. ').replace(/\.\s*\./g, '.');
  }

  private estimateWordCount(markdown: string): number {
    const text = markdown
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*_>`\-[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latinWords = (text.replace(/[\u4e00-\u9fff]/g, ' ').match(/[a-zA-Z0-9]+(?:[-'][a-zA-Z0-9]+)*/g) || []).length;
    return chineseChars + latinWords;
  }

  private buildEvidenceObjectsFromPdfWiki(store: PdfWikiStore, now: string): AutoResearchEvidenceObject[] {
    const pdfById = new Map((store.pdfs || []).map(pdf => [pdf.id, pdf]));
    const objects: AutoResearchEvidenceObject[] = [];
    for (const entry of store.entries || []) {
      const groups: Array<{ stance: AutoResearchEvidenceStance; viewpoints: PdfWikiViewpoint[] }> = [
        { stance: 'support', viewpoints: Array.isArray(entry.pro) ? entry.pro : [] },
        { stance: 'oppose', viewpoints: Array.isArray(entry.con) ? entry.con : [] },
        { stance: 'neutral', viewpoints: Array.isArray(entry.neutral) ? entry.neutral : [] },
      ];
      for (const group of groups) {
        group.viewpoints.forEach((viewpoint, viewpointIndex) => {
          const references = this.uniqueReferences(viewpoint.references || []).map(ref => this.toEvidenceReference(ref));
          const sourcePdf = pdfById.get(viewpoint.sourcePdfId);
          const evidenceSentences = this.uniqueStrings([
            ...(Array.isArray(viewpoint.evidenceSentences) ? viewpoint.evidenceSentences : []),
            viewpoint.evidence || '',
          ]).filter(Boolean);
          const evidenceText = this.cleanText(evidenceSentences.join('\n'), 8000);
          const claim = this.cleanText(entry.displayClaimZh || entry.normalizedClaim || entry.claim, 4000);
          const id = `evo_${this.hash({
            entryId: entry.id,
            stance: group.stance,
            viewpointIndex,
            summary: viewpoint.summary,
            evidenceText,
            sourcePdfId: viewpoint.sourcePdfId,
            referenceIds: references.map(ref => ref.id || ref.doi || ref.title),
          }).slice(0, 24)}`;
          objects.push({
            id,
            claimId: entry.id,
            claim,
            stance: group.stance,
            viewpointSummary: this.cleanText(viewpoint.summary, 3000),
            evidenceText,
            evidenceSentenceIds: this.uniqueStrings(Array.isArray(viewpoint.evidenceSentenceIds) ? viewpoint.evidenceSentenceIds : []),
            evidenceSentences,
            inTextCitations: this.uniqueStrings(Array.isArray(viewpoint.inTextCitations) ? viewpoint.inTextCitations : []),
            references,
            sourcePdfId: viewpoint.sourcePdfId || sourcePdf?.id || '',
            sourcePdfName: viewpoint.sourcePdfName || sourcePdf?.originalName || '',
            sourcePdfTitle: sourcePdf?.title || viewpoint.sourcePdfName || '',
            section: viewpoint.section || '',
            location: viewpoint.location || '',
            groundingScore: this.calculateGroundingScore(viewpoint, references),
            trace: {
              sourceType: 'pdf-wiki',
              sourceUri: `pdf-wiki://${store.userId}/entries/${entry.id}`,
              pdfWikiEntryId: entry.id,
              viewpointIndex,
              stance: group.stance,
              sentenceIds: this.uniqueStrings(Array.isArray(viewpoint.evidenceSentenceIds) ? viewpoint.evidenceSentenceIds : []),
              referenceIds: references.map(ref => ref.id).filter(Boolean),
              storeGeneratedAt: store.generatedAt || '',
            },
            createdAt: now,
            updatedAt: now,
          });
        });
      }
    }
    return objects.sort((a, b) => {
      const claimCompare = a.claim.localeCompare(b.claim, 'zh-CN');
      if (claimCompare !== 0) return claimCompare;
      return a.stance.localeCompare(b.stance);
    });
  }

  private buildLiteratureNodesFromEmbeddingLibrary(userId: string, papers: LiteratureRecord[], now: string): AutoResearchLiteratureNode[] {
    const nodesById = new Map<string, AutoResearchLiteratureNode>();
    for (const paper of papers) {
      const key = this.getLiteratureRecordKey(paper);
      if (!key) continue;
      const id = `lit_${this.hash({ key }).slice(0, 18)}`;
      if (nodesById.has(id)) continue;
      const embeddingDimension = Array.isArray(paper.embedding) ? paper.embedding.length : 0;
      nodesById.set(id, {
        id,
        key,
        title: this.cleanText(paper.title, 500) || 'Untitled literature',
        authors: this.cleanText(paper.author, 500) || this.formatAuthors(paper.authors),
        year: this.cleanText(paper.year, 40),
        journal: this.cleanText(paper.journal, 240),
        doi: this.cleanText(paper.doi, 240),
        abstract: this.cleanText(paper.abstract, 4000),
        keywords: this.uniqueStrings(splitKeywordInput(paper.keywords)).slice(0, 60),
        aiKeywords: this.uniqueStrings(splitKeywordInput(paper.aiKeywords)).slice(0, 60),
        documentType: this.cleanText(paper.documentType, 120),
        categories: this.extractLiteratureCategories(paper).slice(0, 60),
        hasEmbedding: embeddingDimension > 0,
        embeddingDimension,
        trace: {
          sourceType: 'embedding-library',
          sourceUri: `embedding-library://${userId}/literature/${encodeURIComponent(key)}`,
          literatureRecordKey: key,
        },
        createdAt: now,
        updatedAt: now,
      });
    }
    return Array.from(nodesById.values()).sort((a, b) => {
      const yearCompare = Number(b.year || 0) - Number(a.year || 0);
      if (yearCompare !== 0) return yearCompare;
      return a.title.localeCompare(b.title, 'zh-CN');
    });
  }

  private buildLiteratureTags(
    papers: LiteratureRecord[],
    nodes: AutoResearchLiteratureNode[],
    outerTags: OuterTagsConfig
  ): AutoResearchLiteratureTag[] {
    const nodeIdByKey = new Map(nodes.map(node => [node.key, node.id]));
    const keywordMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    const aiKeywordMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    const journalMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    const yearMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    const documentTypeMap = new Map<string, { name: string; literatureIds: Set<string> }>();

    for (const paper of papers) {
      const nodeId = nodeIdByKey.get(this.getLiteratureRecordKey(paper));
      if (!nodeId) continue;
      this.addLiteratureTags(keywordMap, getPaperKeywords(paper), nodeId);
      this.addLiteratureTags(aiKeywordMap, splitKeywordInput(paper.aiKeywords), nodeId);
      this.addLiteratureTags(journalMap, [this.cleanText(paper.journal, 240)], nodeId);
      this.addLiteratureTags(yearMap, [this.cleanText(paper.year, 40)], nodeId);
      this.addLiteratureTags(documentTypeMap, [this.cleanText(paper.documentType, 120)], nodeId);
    }

    const tags: AutoResearchLiteratureTag[] = [
      ...this.toLiteratureTags('keyword', keywordMap),
      ...this.toLiteratureTags('aiKeyword', aiKeywordMap),
      ...this.toLiteratureTags('journal', journalMap),
      ...this.toLiteratureTags('year', yearMap),
      ...this.toLiteratureTags('documentType', documentTypeMap),
      ...this.buildMergedLiteratureTags(papers, nodes, outerTags),
    ];
    return tags
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh-CN'))
      .slice(0, 400);
  }

  private buildEvidenceContext(
    state: AutoResearchState,
    now: string,
    literatureLimit = 160
  ): AutoResearchEvidenceContext {
    const allLiteratureNodes = state.literatureMap.nodes || [];
    const literatureNodes = this.selectTopicRelevantLiteratureNodes(state.task.topic || state.task.goal, allLiteratureNodes, literatureLimit);
    const pdfWikiEvidenceObjects = state.evidenceLibrary.objects || [];
    const embeddingEvidenceObjects = this.buildEmbeddingEvidenceObjects(
      literatureNodes,
      now,
      Math.max(20, literatureLimit)
    );
    const evidenceObjects = this.mergeEvidenceObjectsEqualWeight(
      pdfWikiEvidenceObjects,
      embeddingEvidenceObjects,
      Math.max(20, literatureLimit)
    );
    return {
      allLiteratureNodes,
      literatureNodes,
      pdfWikiEvidenceObjects,
      embeddingEvidenceObjects,
      evidenceObjects,
    };
  }

  private mergeEvidenceObjectsEqualWeight(
    pdfWikiEvidenceObjects: AutoResearchEvidenceObject[],
    embeddingEvidenceObjects: AutoResearchEvidenceObject[],
    limit: number
  ): AutoResearchEvidenceObject[] {
    const safeLimit = Math.max(0, Math.floor(limit || 0));
    if (safeLimit <= 0) return [];

    const pdfRanked = this.rankEvidenceObjectsForAutoResearch(pdfWikiEvidenceObjects);
    const embeddingRanked = this.rankEvidenceObjectsForAutoResearch(embeddingEvidenceObjects);
    if (pdfRanked.length === 0) return embeddingRanked.slice(0, safeLimit);
    if (embeddingRanked.length === 0) return pdfRanked.slice(0, safeLimit);

    const pdfQuota = Math.ceil(safeLimit / 2);
    const embeddingQuota = Math.floor(safeLimit / 2);
    const selectedPdf = pdfRanked.slice(0, pdfQuota);
    const selectedEmbedding = embeddingRanked.slice(0, embeddingQuota);
    const merged: AutoResearchEvidenceObject[] = [];
    const seen = new Set<string>();
    const push = (item?: AutoResearchEvidenceObject) => {
      if (!item || seen.has(item.id) || merged.length >= safeLimit) return;
      seen.add(item.id);
      merged.push(item);
    };

    const pairedLength = Math.max(selectedPdf.length, selectedEmbedding.length);
    for (let index = 0; index < pairedLength; index += 1) {
      push(selectedPdf[index]);
      push(selectedEmbedding[index]);
    }

    if (merged.length < safeLimit) {
      for (const item of [...pdfRanked.slice(selectedPdf.length), ...embeddingRanked.slice(selectedEmbedding.length)]) {
        push(item);
        if (merged.length >= safeLimit) break;
      }
    }

    return merged;
  }

  private rankEvidenceObjectsForAutoResearch(objects: AutoResearchEvidenceObject[]): AutoResearchEvidenceObject[] {
    return [...objects].sort((a, b) => {
      const scoreDiff = this.scoreEvidenceObjectForAutoResearch(b) - this.scoreEvidenceObjectForAutoResearch(a);
      if (Math.abs(scoreDiff) > 0.000001) return scoreDiff;
      return a.id.localeCompare(b.id, 'zh-CN');
    });
  }

  private scoreEvidenceObjectForAutoResearch(item: AutoResearchEvidenceObject): number {
    return (Number.isFinite(item.groundingScore) ? item.groundingScore : 0)
      + Math.min(4, item.evidenceSentences.length) * 0.04
      + Math.min(3, item.references.length) * 0.05
      + Math.min(2, item.inTextCitations.length) * 0.04
      + (item.evidenceText.length >= 120 ? 0.08 : item.evidenceText.length >= 40 ? 0.04 : 0)
      + (item.trace?.sourceUri ? 0.03 : 0);
  }

  private buildEmbeddingEvidenceObjects(
    literatureNodes: AutoResearchLiteratureNode[],
    now: string,
    limit: number
  ): AutoResearchEvidenceObject[] {
    const objects: AutoResearchEvidenceObject[] = [];
    for (const node of literatureNodes) {
      if (objects.length >= limit) break;
      const title = this.cleanText(node.title, 1000);
      const abstract = this.cleanText(node.abstract, 8000);
      if (!title && !abstract) continue;

      const evidenceSentences = this.splitAbstractEvidenceSentences(abstract || title);
      const reference = this.toEvidenceReferenceFromLiterature(node);
      const citation = this.buildLiteratureInTextCitation(node);
      const sentenceIds = evidenceSentences.map((_, index) => `abstract:${node.id}:s${index + 1}`);
      const id = `evo_lit_${this.hash({
        nodeId: node.id,
        key: node.key,
        title,
        doi: node.doi,
        abstract,
      }).slice(0, 20)}`;

      objects.push({
        id,
        claimId: `litclaim_${node.id}`,
        claim: title || this.cleanText(abstract, 240),
        stance: 'support',
        viewpointSummary: abstract
          ? this.cleanText(`摘要支持该论文题名/核心发现：${abstract}`, 3000)
          : this.cleanText(`文献题名可作为论文级论点：${title}`, 3000),
        evidenceText: abstract || title,
        evidenceSentenceIds: sentenceIds,
        evidenceSentences,
        inTextCitations: citation ? [citation] : [],
        references: [reference],
        sourcePdfId: '',
        sourcePdfName: node.journal || 'Embedding 文献库',
        sourcePdfTitle: title,
        section: 'Abstract',
        location: 'Embedding 文献库 · 摘要',
        groundingScore: this.roundScore(
          0.18
          + (abstract.length >= 80 ? 0.32 : abstract.length >= 30 ? 0.2 : 0)
          + (reference.title ? 0.12 : 0)
          + (reference.authors || reference.year ? 0.12 : 0)
          + (reference.doi ? 0.08 : 0)
          + (citation ? 0.08 : 0)
          + (node.trace?.sourceUri ? 0.1 : 0)
        ),
        trace: {
          sourceType: 'embedding-library',
          sourceUri: node.trace?.sourceUri || `embedding-library://${node.id}`,
          literatureNodeId: node.id,
          literatureRecordKey: node.trace?.literatureRecordKey || node.key,
          stance: 'support',
          sentenceIds,
          referenceIds: [reference.id],
        },
        createdAt: now,
        updatedAt: now,
      });
    }
    return objects;
  }

  private splitAbstractEvidenceSentences(text: string): string[] {
    const clean = this.cleanText(text, 8000);
    if (!clean) return [];
    const sentences = clean
      .replace(/([。！？!?])\s*/g, '$1\n')
      .replace(/([.])\s+(?=[A-Z0-9])/g, '$1\n')
      .split(/\n+/)
      .map(sentence => this.cleanText(sentence, 1200))
      .filter(sentence => sentence.length >= 12);
    return (sentences.length ? sentences : [clean]).slice(0, 4);
  }

  private toEvidenceReferenceFromLiterature(node: AutoResearchLiteratureNode): AutoResearchEvidenceReference {
    const rawParts = [
      node.authors,
      node.year,
      node.title,
      node.journal,
      node.doi ? `DOI: ${node.doi}` : '',
    ].filter(Boolean);
    return {
      id: `litref_${this.hash({ id: node.id, key: node.key, doi: node.doi, title: node.title }).slice(0, 18)}`,
      raw: rawParts.join('. '),
      title: node.title || '',
      authors: node.authors || '',
      year: node.year || '',
      journal: node.journal || '',
      doi: node.doi || '',
    };
  }

  private buildLiteratureInTextCitation(node: AutoResearchLiteratureNode): string {
    const year = this.cleanText(node.year, 20);
    const authors = this.cleanText(node.authors, 500);
    const firstAuthor = authors
      .split(/;|；|,|，|\band\b|&/i)
      .map(author => author.trim())
      .find(Boolean);
    if (firstAuthor && year) return `${firstAuthor}, ${year}`;
    if (year) return `${this.cleanText(node.title, 80)}, ${year}`;
    return node.doi || this.cleanText(node.title, 120);
  }

  private getEvidenceSourceKeys(item: AutoResearchEvidenceObject): string[] {
    return this.uniqueStrings([
      ...item.references.flatMap(ref => [normalizeKeyword(ref.doi), normalizeKeyword(ref.title)]),
      normalizeKeyword(item.sourcePdfTitle),
      normalizeKeyword(item.claim),
    ]).filter(Boolean);
  }

  private getLiteratureSourceKeys(node: AutoResearchLiteratureNode): string[] {
    return this.uniqueStrings([
      normalizeKeyword(node.doi),
      normalizeKeyword(node.title),
      normalizeKeyword(node.key),
    ]).filter(Boolean);
  }

  private buildFinalReport(state: AutoResearchState, now: string, autoResearchWritingSkill: string): AutoResearchFinalReport {
    const topic = this.cleanText(state.task.topic || state.task.goal, 500) || '未命名研究主题';
    const {
      allLiteratureNodes,
      literatureNodes,
      pdfWikiEvidenceObjects,
      embeddingEvidenceObjects,
      evidenceObjects,
    } = this.buildEvidenceContext(state, now, 120);
    const literatureTags = this.buildLiteratureTagsFromNodes(literatureNodes);
    const latestEvaluation = state.evaluations[0];
    const latestAudit = state.auditReports[0];
    const hasEvidence = evidenceObjects.length > 0;
    const hasPdfWikiEvidence = pdfWikiEvidenceObjects.length > 0;
    const hasEmbeddingEvidence = embeddingEvidenceObjects.length > 0;
    const topTags = literatureTags
      .filter(tag => tag.kind === 'keyword' || tag.kind === 'aiKeyword')
      .slice(0, 8);
    const topJournals = literatureTags
      .filter(tag => tag.kind === 'journal')
      .slice(0, 5);
    const recentPapers = literatureNodes.slice(0, 6);
    const evidenceSynthesis = this.buildEvidenceSynthesis(evidenceObjects).slice(0, 8);
    const hypotheses = this.buildHypotheses(topic, topTags, evidenceSynthesis, literatureNodes);
    const knowledgeGaps = this.buildKnowledgeGaps(topic, literatureNodes, evidenceObjects, latestEvaluation);
    const experimentPlan = this.buildExperimentPlan(topic, hypotheses, knowledgeGaps);
    const draftOutline = this.buildDraftOutline(topic, hypotheses, evidenceSynthesis);
    const limitations = this.buildFinalReportLimitations(literatureNodes, evidenceObjects, latestEvaluation);
    const nextSteps = this.buildFinalReportNextSteps(knowledgeGaps, latestEvaluation);
    const paperTopicReview = this.buildPaperTopicReview(
      topic,
      literatureNodes,
      pdfWikiEvidenceObjects,
      embeddingEvidenceObjects,
      evidenceObjects,
      evidenceSynthesis,
      hypotheses,
      knowledgeGaps,
      latestEvaluation,
      latestAudit
    );
    const paperWritingBlueprint = this.buildPaperWritingBlueprint(
      topic,
      paperTopicReview,
      evidenceSynthesis,
      hypotheses,
      knowledgeGaps,
      experimentPlan,
      literatureTags,
      autoResearchWritingSkill
    );
    const contentEnhancementReport = this.buildContentEnhancementReport(
      topic,
      paperTopicReview,
      paperWritingBlueprint,
      literatureNodes,
      evidenceObjects,
      evidenceSynthesis,
      hypotheses,
      knowledgeGaps,
      experimentPlan,
      latestEvaluation,
      latestAudit,
      now
    );
    const literatureOverview = this.uniqueStrings([
      `全库 ${allLiteratureNodes.length} 篇文献中，初步筛出 ${literatureNodes.length} 篇与本主题高度相关的文献，其中 ${literatureNodes.filter(item => item.hasEmbedding).length} 篇带 embedding。`,
      topTags.length ? `主要主题簇：${topTags.map(tag => `${tag.name}(${tag.count})`).join('、')}。` : '',
      topJournals.length ? `主要来源期刊/来源：${topJournals.map(tag => `${tag.name}(${tag.count})`).join('、')}。` : '',
      recentPapers.length ? `代表性/近期文献：${recentPapers.map(item => `${item.title}${item.year ? `(${item.year})` : ''}`).join('；')}。` : '',
    ]).filter(Boolean);
    const executiveSummary = this.cleanText([
      hasPdfWikiEvidence && hasEmbeddingEvidence
        ? `围绕“${topic}”，AutoResearch 已完成主题文献筛选、PDF Wiki 证据同步、自评检查和结果汇总；本次推理同时使用 PDF句子级Wiki论点库和 embedding 文献库，并按 1:1 权重纳入证据。`
        : hasPdfWikiEvidence
          ? `围绕“${topic}”，AutoResearch 已完成主题文献筛选、PDF Wiki 证据同步、自评检查和结果汇总；当前主要使用 PDF句子级Wiki论点库。`
          : hasEmbeddingEvidence
            ? `围绕“${topic}”，AutoResearch 已完成主题文献筛选，并使用 embedding 文献库摘要构建论文级证据；由于 PDF Wiki 证据库为空，结果仍属于摘要级预分析。`
            : `围绕“${topic}”，AutoResearch 已完成主题文献筛选和自评检查；但 PDF Wiki 证据库和摘要级证据均为空，因此本结果只能作为预分析。`,
      `当前全库包含 ${allLiteratureNodes.length} 篇文献，主题相关文献 ${literatureNodes.length} 篇，等权纳入证据对象 ${evidenceObjects.length} 个；原始可用 PDF Wiki 句级证据 ${pdfWikiEvidenceObjects.length} 个、embedding 摘要证据 ${embeddingEvidenceObjects.length} 个。`,
      latestEvaluation ? `审稿式自检总分为 ${Math.round(latestEvaluation.overallScore * 100)}，主要建议是：${latestEvaluation.recommendations.slice(0, 2).join('；') || '继续完善证据链'}。` : '尚未形成自评报告，结果应作为初步研究框架使用。',
      latestAudit ? `引用-论据审计结果为 ${latestAudit.verdict.toUpperCase()}，得分 ${Math.round(latestAudit.overallScore * 100)}；${latestAudit.summary}` : '',
    ].join(' '), 1200);
    return {
      id: `final_${this.hash({ userId: state.userId, topic, now }).slice(0, 18)}`,
      generatedAt: now,
      topic,
      title: `${hasPdfWikiEvidence ? 'AutoResearch 结果' : hasEvidence ? 'AutoResearch 摘要证据分析' : 'AutoResearch 预分析'}：${topic}`,
      executiveSummary,
      paperTopicReview,
      paperWritingBlueprint,
      contentEnhancementReport,
      literatureOverview,
      evidenceSynthesis,
      hypotheses,
      knowledgeGaps,
      experimentPlan,
      draftOutline,
      reviewSummary: latestEvaluation
        ? `自检总分 ${Math.round(latestEvaluation.overallScore * 100)}。${latestEvaluation.issues.length ? `主要问题：${latestEvaluation.issues.slice(0, 4).join('；')}。` : '暂无主要阻断项。'}${latestAudit ? ` 引用-论据审计：${latestAudit.verdict.toUpperCase()}，${Math.round(latestAudit.overallScore * 100)} 分；${latestAudit.findings.filter(item => item.level !== 'pass').slice(0, 3).map(item => item.message).join('；') || '暂无主要风险'}。` : ''}`
        : latestAudit
          ? `尚未运行审稿式自检。引用-论据审计：${latestAudit.verdict.toUpperCase()}，${Math.round(latestAudit.overallScore * 100)} 分；${latestAudit.summary}`
        : '尚未运行自检。',
      limitations,
      nextSteps,
      trace: {
        literatureSnapshotId: state.literatureMap.snapshots[0]?.id,
        evidenceSnapshotId: state.evidenceLibrary.snapshots[0]?.id,
        evaluationId: latestEvaluation?.id,
        totalLiteratureNodeCount: allLiteratureNodes.length,
        literatureNodeCount: literatureNodes.length,
        relevantLiteratureNodeIds: literatureNodes.map(item => item.id),
        evidenceObjectCount: evidenceObjects.length,
        pdfWikiEvidenceObjectCount: pdfWikiEvidenceObjects.length,
        embeddingEvidenceObjectCount: embeddingEvidenceObjects.length,
        operationCount: state.operations.length,
      },
    };
  }

  private buildPaperTopicReview(
    topic: string,
    literatureNodes: AutoResearchLiteratureNode[],
    pdfWikiEvidenceObjects: AutoResearchEvidenceObject[],
    embeddingEvidenceObjects: AutoResearchEvidenceObject[],
    evidenceObjects: AutoResearchEvidenceObject[],
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    hypotheses: string[],
    knowledgeGaps: string[],
    latestEvaluation?: AutoResearchSelfEvaluationReport,
    latestAudit?: AutoResearchAuditReport
  ): AutoResearchPaperTopicReview {
    const paperType = this.inferPaperTypeForTopicSkill(topic, literatureNodes, evidenceObjects);
    const topicRiskLevel = this.inferTopicRiskLevel(literatureNodes, pdfWikiEvidenceObjects, embeddingEvidenceObjects, evidenceObjects, latestEvaluation, latestAudit);
    const evidenceReadiness = pdfWikiEvidenceObjects.length >= 5
      ? 'direct'
      : embeddingEvidenceObjects.length >= 5
        ? 'adjacent'
        : evidenceObjects.some(item => /mechanism|机制|nitrification|denitrification|microbial|enzyme|gene/i.test(`${item.claim} ${item.evidenceText} ${item.viewpointSummary}`))
          ? 'mechanistic'
          : 'insufficient';
    const topClaims = evidenceSynthesis.slice(0, 4).map(item => this.cleanText(item.claim, 180));
    const terms = this.buildTopicSearchTerms(topic).slice(0, 8);
    const mismatchPoints = this.uniqueStrings([
      literatureNodes.length < 20 ? `主题相关文献仅 ${literatureNodes.length} 篇，题目不宜写成大范围综述。` : '',
      evidenceObjects.length === 0 ? '缺少可追溯证据对象，不能直接进入强结论写作。' : '',
      pdfWikiEvidenceObjects.length === 0 && embeddingEvidenceObjects.length > 0 ? '当前主要是摘要级证据，缺少 PDF 原文句级证据和页码定位。' : '',
      evidenceSynthesis.some(item => item.opposeCount > 0 || item.neutralCount > 0) ? '部分论点存在中性或反对材料，写作时必须保留条件边界。' : '',
      latestAudit && latestAudit.verdict !== 'pass' ? `引用-论据审计未通过：${latestAudit.summary}` : '',
      latestEvaluation && latestEvaluation.overallScore < 0.72 ? `自评得分偏低：${latestEvaluation.recommendations.slice(0, 2).join('；')}` : '',
    ]).slice(0, 8);
    const highRiskIssues = this.uniqueStrings([
      topicRiskLevel === 'high' || topicRiskLevel === 'not-recommended' ? '题目可能大于当前证据范围。' : '',
      evidenceReadiness === 'insufficient' ? '证据不足，容易生成看似完整但无法支撑的论文。' : '',
      evidenceReadiness === 'adjacent' ? '摘要级或相邻证据不能直接写成确定结论。' : '',
      evidenceReadiness === 'mechanistic' ? '机制证据只能作为可能解释，不能写成田间应用效果。' : '',
      evidenceSynthesis.length === 0 ? '尚未形成观点-证据链矩阵。' : '',
      topClaims.length < 2 ? '核心科学问题和主论点仍需进一步收敛。' : '',
      ...knowledgeGaps.slice(0, 3),
    ]).slice(0, 10);
    const goToWritingStage: AutoResearchPaperTopicReview['goToWritingStage'] =
      topicRiskLevel === 'not-recommended'
        ? '暂不建议写作'
        : topicRiskLevel === 'high'
          ? (literatureNodes.length < 10 ? '需要补充文献后再写' : '修改选题后进入写作')
          : evidenceObjects.length === 0
            ? '需要补充文献后再写'
            : topicRiskLevel === 'medium'
              ? '修改选题后进入写作'
              : '可以进入写作';

    return {
      paperType,
      notRecommendedTypes: this.inferNotRecommendedPaperTypes(paperType, evidenceObjects, pdfWikiEvidenceObjects),
      topicRiskLevel,
      evidenceReadiness,
      topicScopeDiagnosis: this.cleanText(
        topicRiskLevel === 'low'
          ? `当前题目与可用证据基本匹配，可围绕“${topic}”形成边界清晰的论文。`
          : topicRiskLevel === 'medium'
            ? `当前题目略大，建议把“${topic}”收窄到证据最集中的对象、指标和机制。`
            : topicRiskLevel === 'high'
              ? `当前题目明显大于证据，进入写作前必须重构题目边界。`
              : `当前证据严重不足，暂不建议直接写作。`,
        600
      ),
      actualEvidenceScope: this.cleanText(`主题相关文献 ${literatureNodes.length} 篇；等权纳入证据对象 ${evidenceObjects.length} 个；原始可用 PDF Wiki 句级证据 ${pdfWikiEvidenceObjects.length} 个、embedding 摘要证据 ${embeddingEvidenceObjects.length} 个；核心论点 ${evidenceSynthesis.length} 个。`, 700),
      mismatchPoints,
      recommendedBoundary: {
        region: this.inferBoundaryValue(topic, terms, /华北|north china/i, '围绕用户主题中明确出现的区域；若未明确，写作中不要扩大到全球或全国结论。'),
        system: this.inferBoundaryValue(topic, terms, /农田|cropland|farmland|field|soil|土壤|作物/i, '以当前文献和证据中出现频率最高的作物/生态系统为准。'),
        object: this.cleanText(topClaims[0] || topic, 220),
        treatments: this.extractBoundaryTerms(topic, terms, ['氮肥', '施肥', 'fertilization', 'nitrogen fertilizer', 'biochar', 'irrigation', 'tillage']).slice(0, 8),
        indicators: this.extractBoundaryTerms(topic, terms, ['n2o', 'nitrous oxide', '氧化亚氮', 'emission', 'yield', '产量', 'efficiency', 'soil']).slice(0, 8),
        mechanisms: this.extractBoundaryTerms(`${topic} ${hypotheses.join(' ')}`, terms, ['nitrification', 'denitrification', 'microbial', 'amoa', 'nosz', '硝化', '反硝化', '微生物']).slice(0, 8),
        timeScale: '以当前文献/数据实际覆盖的观测期、年份和尺度为准；缺失时标注需要作者补充。',
        excludedScope: this.uniqueStrings([
          '未被当前证据覆盖的区域、作物、系统和管理措施。',
          '没有产量证据时，不写稳产或增产结论。',
          '没有效率指标时，不写提高资源利用效率结论。',
          '室内、模型或机制证据不能直接外推为田间确定结论。',
        ]),
      },
      optimizedScientificQuestions: this.uniqueStrings([
        topClaims[0] ? `在当前研究边界内，${topClaims[0]}是否有直接证据支持，证据强度和边界条件是什么？` : '',
        hypotheses[0] ? `哪些机制或情境可能解释：${this.cleanText(hypotheses[0], 220)}` : '',
        evidenceSynthesis.some(item => item.opposeCount > 0 || item.neutralCount > 0) ? '不同研究结论不一致时，差异来自区域、作物、处理、测量方法还是时间尺度？' : '',
        '当前证据可以支持哪些克制结论，哪些结论必须避免或标注为待验证？',
      ]).slice(0, 4),
      highRiskIssues,
      goToWritingStage,
    };
  }

  private buildPaperWritingBlueprint(
    topic: string,
    review: AutoResearchPaperTopicReview,
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    hypotheses: string[],
    knowledgeGaps: string[],
    experimentPlan: string[],
    literatureTags: AutoResearchLiteratureTag[],
    autoResearchWritingSkill: string
  ): AutoResearchPaperWritingBlueprint {
    const keywords = literatureTags
      .filter(tag => tag.kind === 'keyword' || tag.kind === 'aiKeyword')
      .slice(0, 4)
      .map(tag => tag.name);
    const supportedClaims = evidenceSynthesis
      .filter(item => item.supportCount > 0)
      .slice(0, 6)
      .map(item => `${this.cleanText(item.claim, 180)}（支持 ${item.supportCount}，中性 ${item.neutralCount}，反对 ${item.opposeCount}）`);
    const claimsToAvoid = this.uniqueStrings([
      ...review.highRiskIssues,
      ...review.recommendedBoundary.excludedScope,
      evidenceSynthesis.some(item => item.opposeCount > 0) ? '不要把存在反对证据的论点写成无条件确定结论。' : '',
      review.evidenceReadiness !== 'direct' ? '不要把摘要级、相邻或机制证据写成直接实验证据。' : '',
    ]).slice(0, 8);
    const titleOptions = {
      conservative: this.cleanText(`Evidence boundaries and research gaps in ${topic}`, 220),
      innovative: this.cleanText(`Reframing ${topic} through evidence hierarchy, mechanisms, and boundary conditions`, 220),
      submissionReady: this.cleanText(`${topic}: evidence synthesis, mechanism boundaries, and research priorities`, 220),
    };
    const recommendedTitle = review.topicRiskLevel === 'low'
      ? titleOptions.submissionReady
      : titleOptions.conservative;
    return {
      paperType: review.paperType,
      titleOptions,
      recommendedTitle,
      coreResearchObject: review.recommendedBoundary.object,
      coreScientificQuestions: review.optimizedScientificQuestions,
      centralArgument: this.cleanText(
        supportedClaims[0]
          ? `本文应围绕“${supportedClaims[0]}”展开，同时把直接证据、相邻证据和机制证据分层使用，避免超出当前证据边界。`
          : `本文应先把“${topic}”收窄为可被当前文献和证据对象支持的科学问题，再进入正文写作。`,
        700
      ),
      supportedClaims,
      claimsToAvoid,
      evidenceHierarchy: {
        directEvidence: review.evidenceReadiness === 'direct'
          ? supportedClaims.slice(0, 4)
          : ['当前直接证据不足；需要优先补充 PDF 原文句级证据、页码和数据来源。'],
        adjacentEvidence: review.evidenceReadiness === 'adjacent' || review.evidenceReadiness === 'direct'
          ? evidenceSynthesis.slice(0, 5).map(item => this.cleanText(item.summary, 220)).filter(Boolean)
          : ['相邻证据可用于比较和启发，但不能直接支撑强结论。'],
        mechanisticEvidence: this.uniqueStrings([
          ...hypotheses.filter(item => /mechanism|机制|硝化|反硝化|microbial|process/i.test(item)).slice(0, 4),
          '机制证据只能解释可能路径，除非有直接实验或田间证据支撑。',
        ]).slice(0, 5),
      },
      innovationPoints: this.uniqueStrings([
        '把论文主题拆解为证据分级、机制边界和不能写结论的组合框架。',
        keywords.length ? `围绕 ${keywords.slice(0, 3).join('、')} 形成更具体的问题空间。` : '',
        evidenceSynthesis.some(item => item.neutralCount > 0 || item.opposeCount > 0) ? '保留中性/反对证据，用于构建边界条件和争议解释。' : '',
      ]).slice(0, 5),
      mechanismChain: this.uniqueStrings([
        review.recommendedBoundary.treatments[0] || '管理措施/处理',
        review.recommendedBoundary.mechanisms[0] || '土壤/生物/环境过程',
        review.recommendedBoundary.indicators[0] || '目标指标',
        '结果响应',
        '产量、效率或环境权衡（仅在有证据时写）',
      ]),
      recommendedStructure: [
        'Title',
        'Abstract',
        'Keywords',
        'Introduction',
        'Methods / Analytical Approach',
        'Results / Evidence Synthesis with evidence matrix, positive findings, and quantitative summary',
        'Discussion with mechanism pathways, indicator boundaries, and innovation framework',
        'Conclusion with positive finding, conditional interpretation, framework contribution, and future direction',
        'References',
      ],
      requiredFiguresTables: this.uniqueStrings([
        '研究边界表：区域、系统、处理、指标、机制和排除范围。',
        'Table 1. Evidence Matrix：来源、对象/系统、变量/措施、结果指标、量化结果、证据等级、可支持结论和不能写结论。',
        'Table 2. Variable-Mechanism-Outcome Matrix：变量/措施、直接效应、中间机制、主要结果、权衡、边界和不确定性。',
        'Table 3. Quantitative Result Summary：已有数值结果、方向、统计信息、解释和限制；没有数值时写 NR。',
        'Figure 1. Conceptual Framework：研究边界 -> 证据分级 -> 正向发现 -> 机制路径 -> 指标解释 -> 可写/不可写结论。',
        'Figure 2. Evidence Strength Heatmap：按路径/主题展示直接、系统特异、相邻和机制证据强度。',
        evidenceSynthesis.length ? '核心论点证据分布图：支持、中性和反对证据数量。' : '',
      ]).slice(0, 6),
      writingWarnings: this.uniqueStrings([
        autoResearchWritingSkill,
        '不能只输出“证据不足”；必须优先提炼当前材料可以支持的正向发现，并同时写清边界。',
        'Results 必须呈现证据矩阵、正向发现、变量-机制-结果关系和可用量化结果，不能写成文献罗列。',
        ...claimsToAvoid,
        ...knowledgeGaps.slice(0, 4),
        ...experimentPlan.slice(0, 3),
      ]).slice(0, 12),
      goToWritingStage: review.goToWritingStage,
    };
  }

  private buildContentEnhancementReport(
    topic: string,
    review: AutoResearchPaperTopicReview,
    blueprint: AutoResearchPaperWritingBlueprint,
    literatureNodes: AutoResearchLiteratureNode[],
    evidenceObjects: AutoResearchEvidenceObject[],
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    hypotheses: string[],
    knowledgeGaps: string[],
    experimentPlan: string[],
    latestEvaluation: AutoResearchSelfEvaluationReport | undefined,
    latestAudit: AutoResearchAuditReport | undefined,
    now: string
  ): AutoResearchContentEnhancementReport {
    const evidenceMatrix = this.buildContentEvidenceMatrix(topic, review, evidenceObjects, evidenceSynthesis);
    const positiveFindings = this.buildContentPositiveFindings(topic, review, evidenceSynthesis, evidenceMatrix);
    const dependencyCheck = this.buildContentEvidenceDependencyCheck(evidenceSynthesis, evidenceObjects);
    const vmoMatrix = this.buildVariableMechanismOutcomeMatrix(topic, review, evidenceMatrix, hypotheses);
    const quantitativeResultSummary = this.buildQuantitativeResultSummary(evidenceMatrix);
    const indicatorBoundaryCheck = this.buildIndicatorBoundaryCheck(topic, review, evidenceMatrix);
    const innovationFramework = this.buildInnovationFramework(topic, blueprint, evidenceMatrix, positiveFindings, hypotheses);
    const proposedConceptualFigure = this.buildConceptualFigure(topic, innovationFramework);
    const evidenceStrengthHeatmap = this.buildEvidenceStrengthHeatmap(evidenceSynthesis, evidenceObjects);
    const referenceCleaningNotes = this.buildReferenceCleaningNotes(evidenceMatrix, evidenceObjects);
    const goNoGoDecision = this.buildContentGoNoGoDecision(review, evidenceMatrix, positiveFindings, latestEvaluation, latestAudit);
    const mainContentProblems = this.uniqueStrings([
      evidenceObjects.length === 0 ? '缺少可追溯 evidence object，当前无法形成真正的证据矩阵。' : '',
      evidenceMatrix.length < 5 ? `证据矩阵仅 ${evidenceMatrix.length} 行，论文内容厚度不足，容易写成很薄的证据边界报告。` : '',
      positiveFindings.length < 3 ? '可强调的正向发现少于 3 条，需要继续从证据矩阵中提炼条件性发现。' : '',
      dependencyCheck.some(item => item.overDependsOnSingleSource) ? '部分核心结论过度依赖单一来源，需要补充同对象、同机制、同指标或相反立场证据。' : '',
      quantitativeResultSummary.length === 0 ? '当前没有可整理的数值结果；涉及效应大小、增减幅度或统计显著性时必须标注 NR 或需要作者补充。' : '',
      indicatorBoundaryCheck.length === 0 ? '核心指标边界不清，容易混用短期/长期、总量/效率、相关/因果等不同指标。' : '',
      latestAudit && latestAudit.verdict !== 'pass' ? `引用-论据审计仍有风险：${latestAudit.summary}` : '',
      latestEvaluation && latestEvaluation.overallScore < 0.72 ? `审稿式自评偏低：${latestEvaluation.recommendations.slice(0, 2).join('；')}` : '',
    ]).slice(0, 10);
    const revisedResultsStructure = [
      '3.1 Evidence distribution across pathways or themes',
      '3.2 Directly supported positive findings',
      '3.3 System-specific or condition-dependent findings',
      '3.4 Mechanism-linked findings',
      '3.5 Quantitative response patterns and NR fields',
      '3.6 Indicator boundaries and trade-offs',
      '3.7 Summary of positive findings with evidence limits',
    ];
    const revisedDiscussionStructure = [
      'From evidence boundary to conditional synthesis',
      'Main explanatory framework and why evidence differs',
      'Mechanism pathways linking variables/interventions to outcomes',
      'Indicator separation, trade-offs, and practical implications',
      'Testable future directions that can strengthen weak links',
    ];
    const revisedConclusionLogic = [
      positiveFindings[0] || '先给出当前证据能够支持的正向发现，而不是只说证据不足。',
      '说明该发现成立的对象、场景、指标和证据等级边界。',
      `总结“${innovationFramework.frameworkName}”如何连接分散证据、机制路径和可写结论。`,
      '提出下一步最需要验证或补充的数据、文献和统计信息。',
    ];
    const requiredTables = [
      'Table 1. Evidence Matrix',
      'Table 2. Variable-Mechanism-Outcome Matrix',
      'Table 3. Quantitative Result Summary',
      'Indicator Boundary Check table',
    ];
    const requiredFigures = [
      'Figure 1. Conceptual Framework',
      'Figure 2. Evidence Strength Heatmap',
    ];
    const qualityChecklist = this.buildContentQualityChecklist(
      evidenceMatrix,
      vmoMatrix,
      quantitativeResultSummary,
      positiveFindings,
      referenceCleaningNotes,
      goNoGoDecision,
      latestAudit
    );

    return {
      id: `content_enh_${this.hash({ topic, now, evidenceRows: evidenceMatrix.length, positiveFindings }).slice(0, 18)}`,
      generatedAt: now,
      paperPositionDiagnosis: {
        currentManuscriptType: evidenceObjects.length >= 5 ? '证据综合型论文草稿/范围综述' : '证据审查报告或预分析报告',
        targetPaperType: review.paperType,
        consistent: evidenceObjects.length >= 5 && positiveFindings.length >= 2,
        mainDeviation: evidenceObjects.length >= 5 && positiveFindings.length >= 2
          ? '当前材料已具备从证据审查报告升级为内容综合型论文的基础，但仍需把矩阵、图示和结论边界写入正文。'
          : '当前材料更像证据边界审查，正向发现、机制链条、量化整理或图表支撑不足。',
        needsReconstruction: evidenceObjects.length < 5 || positiveFindings.length < 2 || dependencyCheck.some(item => item.overDependsOnSingleSource),
      },
      mainContentProblems,
      coreEvidenceDependencyCheck: dependencyCheck,
      evidenceMatrix,
      positiveFindings,
      variableMechanismOutcomeMatrix: vmoMatrix,
      quantitativeResultSummary,
      indicatorBoundaryCheck,
      innovationFramework,
      proposedConceptualFigure,
      evidenceStrengthHeatmap,
      revisedResultsStructure,
      revisedDiscussionStructure,
      revisedConclusionLogic,
      referenceCleaningNotes,
      finalWritingBlueprint: {
        paperType: blueprint.paperType,
        recommendedTitleDirection: blueprint.recommendedTitle,
        coreProblem: review.optimizedScientificQuestions[0] || topic,
        centralArgument: blueprint.centralArgument,
        positiveFindingsToEmphasize: positiveFindings,
        evidenceHierarchy: blueprint.evidenceHierarchy,
        keyVariablesInterventionsPhenomena: this.uniqueStrings(vmoMatrix.map(item => item.variableInterventionPhenomenon)).slice(0, 8),
        mechanismPathways: this.uniqueStrings(vmoMatrix.map(item => `${item.variableInterventionPhenomenon} -> ${item.intermediateMechanism} -> ${item.primaryOutcome}`)).slice(0, 8),
        quantitativeResultsAvailable: quantitativeResultSummary.length
          ? quantitativeResultSummary.map(item => `${item.source}: ${item.indicator} = ${item.reportedValueOrChange}`).slice(0, 8)
          : ['NR: 当前材料未提供可安全提取的量化结果。'],
        indicatorsToKeepSeparate: indicatorBoundaryCheck.map(item => item.indicator).slice(0, 8),
        innovationFramework: `${innovationFramework.frameworkName}: ${innovationFramework.coreLogic}`,
        requiredTables,
        requiredFigures,
        claimsAllowed: this.uniqueStrings([...positiveFindings, ...blueprint.supportedClaims]).slice(0, 10),
        claimsToAvoid: blueprint.claimsToAvoid,
        discussionLogic: revisedDiscussionStructure,
        conclusionLogic: revisedConclusionLogic,
        referencesToRetain: [
          ...referenceCleaningNotes.coreEvidenceToRetain,
          ...referenceCleaningNotes.mechanisticEvidenceToRetain,
          ...referenceCleaningNotes.backgroundEvidenceToRetain,
        ].slice(0, 12),
        referencesToVerify: referenceCleaningNotes.referencesRequiringVerification,
        referencesToRemove: referenceCleaningNotes.referencesToRemoveOrExclude,
        writingWarnings: this.uniqueStrings([
          ...blueprint.writingWarnings,
          ...mainContentProblems,
          ...knowledgeGaps.slice(0, 4),
          ...experimentPlan.slice(0, 3),
        ]).slice(0, 12),
      },
      goNoGoDecision,
      qualityChecklist,
    };
  }

  private buildContentEvidenceMatrix(
    topic: string,
    review: AutoResearchPaperTopicReview,
    evidenceObjects: AutoResearchEvidenceObject[],
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis']
  ): AutoResearchEvidenceMatrixRow[] {
    const topClaims = new Set(evidenceSynthesis.slice(0, 12).flatMap(item => item.evidenceObjectIds));
    const rankedEvidence = this.rankEvidenceObjectsForAutoResearch(evidenceObjects)
      .filter(item => topClaims.size === 0 || topClaims.has(item.id))
      .slice(0, 24);
    const fallbackEvidence = rankedEvidence.length ? rankedEvidence : this.rankEvidenceObjectsForAutoResearch(evidenceObjects).slice(0, 24);
    return fallbackEvidence.map(item => {
      const text = `${item.claim} ${item.viewpointSummary} ${item.evidenceText}`;
      const evidenceClass = this.inferContentEvidenceClass(item, text);
      const evidenceStrength = this.inferContentEvidenceStrength(item, evidenceClass);
      const quantitativeResult = this.extractQuantitativeResult(text);
      return {
        studyOrDataSource: this.formatContentEvidenceSource(item),
        objectPopulationSystem: this.cleanText(review.recommendedBoundary.object || review.recommendedBoundary.system || topic, 220),
        contextRegionScenario: this.inferContentContext(review, item, text),
        variableInterventionExposure: this.inferContentVariable(review, text),
        outcomeIndicator: this.inferContentOutcomeIndicator(review, text),
        quantitativeResult,
        mechanismIndicator: this.inferContentMechanism(review, text),
        evidenceClass,
        evidenceStrength,
        supportedClaim: this.cleanText(item.claim || item.viewpointSummary || item.evidenceText, 260),
        claimToAvoid: this.buildClaimToAvoidForEvidence(item, evidenceClass, evidenceStrength),
      };
    });
  }

  private buildContentEvidenceDependencyCheck(
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    evidenceObjects: AutoResearchEvidenceObject[]
  ): AutoResearchEvidenceDependencyRow[] {
    const evidenceById = new Map(evidenceObjects.map(item => [item.id, item]));
    return evidenceSynthesis.slice(0, 8).map(item => {
      const linkedEvidence = item.evidenceObjectIds.map(id => evidenceById.get(id)).filter((value): value is AutoResearchEvidenceObject => Boolean(value));
      const sourceKeys = this.uniqueStrings(linkedEvidence.map(evidence => this.getPrimaryContentSourceKey(evidence)));
      const primaryEvidence = linkedEvidence
        .slice()
        .sort((a, b) => this.scoreEvidenceObjectForAutoResearch(b) - this.scoreEvidenceObjectForAutoResearch(a))
        .slice(0, 3)
        .map(evidence => this.formatContentEvidenceSource(evidence));
      const supportCount = linkedEvidence.filter(evidence => evidence.stance === 'support').length;
      const overDependsOnSingleSource = sourceKeys.length <= 1 || supportCount <= 1;
      return {
        coreClaim: this.cleanText(item.claim, 240),
        primaryEvidence: primaryEvidence.join('；') || 'NR',
        overDependsOnSingleSource,
        evidencePathToAdd: overDependsOnSingleSource
          ? '补充同一对象/系统的其他来源、相同机制的独立证据、相反或中性材料，以及同指标的量化结果。'
          : '继续保留支持、中性和反对证据的对照结构，避免把单一来源写成领域共识。',
      };
    });
  }

  private buildContentPositiveFindings(
    topic: string,
    review: AutoResearchPaperTopicReview,
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    evidenceMatrix: AutoResearchEvidenceMatrixRow[]
  ): string[] {
    const matrixByClaim = new Map(evidenceMatrix.map(row => [this.normalizeClaim(row.supportedClaim), row]));
    const findings = evidenceSynthesis
      .filter(item => item.supportCount > 0)
      .slice(0, 6)
      .map(item => {
        const row = matrixByClaim.get(this.normalizeClaim(item.claim));
        const boundary = row?.contextRegionScenario || review.recommendedBoundary.system || review.recommendedBoundary.object || topic;
        const strength = row?.evidenceStrength ? `证据强度为 ${row.evidenceStrength}` : `支持 ${item.supportCount} 条，中性 ${item.neutralCount} 条，反对 ${item.opposeCount} 条`;
        return this.cleanText(`当前证据支持在“${boundary}”范围内讨论“${item.claim}”；${strength}，应作为条件性正向发现而非无边界推广。`, 360);
      });
    return this.uniqueStrings([
      ...findings,
      evidenceMatrix.length > 0 && findings.length === 0
        ? `当前材料至少可以形成关于“${topic}”证据分布、证据强度和可写边界的正向发现，但不能写成确定效果结论。`
        : '',
    ]).slice(0, 6);
  }

  private buildVariableMechanismOutcomeMatrix(
    topic: string,
    review: AutoResearchPaperTopicReview,
    evidenceMatrix: AutoResearchEvidenceMatrixRow[],
    hypotheses: string[]
  ): AutoResearchVariableMechanismOutcomeRow[] {
    const rows = evidenceMatrix.slice(0, 10).map(row => ({
      variableInterventionPhenomenon: row.variableInterventionExposure || review.recommendedBoundary.treatments[0] || topic,
      directEffect: row.supportedClaim || '需要作者补充直接效应描述',
      intermediateMechanism: row.mechanismIndicator || 'hypothesized mechanism: 需要进一步原文证据验证',
      primaryOutcome: row.outcomeIndicator || review.recommendedBoundary.indicators[0] || '需要作者补充主要结果指标',
      secondaryOutcomeTradeoff: '产量、效率、成本、风险或环境权衡仅在证据矩阵中有直接材料时写入正文。',
      evidenceClass: row.evidenceClass,
      evidenceStrength: row.evidenceStrength,
      boundaryCondition: row.contextRegionScenario || review.recommendedBoundary.timeScale,
      uncertainty: row.evidenceClass === 'Direct' && row.evidenceStrength !== 'Weak'
        ? '仍需说明样本、区域、方法和指标边界。'
        : 'requires direct validation; 不能写成已证实机制或无条件效果。',
    }));
    if (rows.length > 0) return rows;
    return hypotheses.slice(0, 3).map(hypothesis => ({
      variableInterventionPhenomenon: review.recommendedBoundary.treatments[0] || topic,
      directEffect: this.cleanText(hypothesis, 260),
      intermediateMechanism: review.recommendedBoundary.mechanisms[0] || 'hypothesized mechanism: 需要作者补充',
      primaryOutcome: review.recommendedBoundary.indicators[0] || '需要作者补充',
      secondaryOutcomeTradeoff: 'NR',
      evidenceClass: 'Insufficient' as const,
      evidenceStrength: 'Weak' as const,
      boundaryCondition: review.recommendedBoundary.timeScale,
      uncertainty: '当前仅有假设或问题表述，缺少可追溯证据对象。',
    }));
  }

  private buildQuantitativeResultSummary(evidenceMatrix: AutoResearchEvidenceMatrixRow[]): AutoResearchQuantitativeResultRow[] {
    return evidenceMatrix
      .filter(row => row.quantitativeResult !== 'NR')
      .slice(0, 12)
      .map(row => ({
        source: row.studyOrDataSource,
        objectGroup: row.objectPopulationSystem,
        treatmentVariable: row.variableInterventionExposure,
        indicator: row.outcomeIndicator,
        baselineControl: 'NR',
        reportedValueOrChange: row.quantitativeResult,
        direction: this.inferQuantitativeDirection(`${row.supportedClaim} ${row.quantitativeResult}`),
        statisticalInformation: /p\s*[<=>]|ci|confidence interval|se\b|sd\b|显著|置信/i.test(row.supportedClaim)
          ? 'Text mentions statistical information; verify exact statistic in original source.'
          : 'NR',
        interpretation: row.supportedClaim,
        limitation: row.claimToAvoid,
      }));
  }

  private buildIndicatorBoundaryCheck(
    topic: string,
    review: AutoResearchPaperTopicReview,
    evidenceMatrix: AutoResearchEvidenceMatrixRow[]
  ): AutoResearchIndicatorBoundaryRow[] {
    const indicators = this.uniqueStrings([
      ...review.recommendedBoundary.indicators,
      ...evidenceMatrix.map(row => row.outcomeIndicator),
    ]).filter(item => item && !/需要作者补充/.test(item)).slice(0, 8);
    const fallback = indicators.length ? indicators : [topic];
    return fallback.map(indicator => ({
      indicator,
      whatItCanSupport: `可支持与“${indicator}”直接相关的方向、边界或证据强度判断。`,
      whatItCannotSupport: '不能自动支持不同时间尺度、不同系统、不同统计口径或未报告指标的结论。',
      needsSeparationFrom: '短期 vs 长期；总量 vs 效率；相关 vs 因果；中间变量 vs 最终结果；模型/摘要证据 vs 原文直接证据。',
    }));
  }

  private buildInnovationFramework(
    topic: string,
    blueprint: AutoResearchPaperWritingBlueprint,
    evidenceMatrix: AutoResearchEvidenceMatrixRow[],
    positiveFindings: string[],
    hypotheses: string[]
  ): AutoResearchInnovationFramework {
    const frameworkName = this.cleanText(`Evidence-hierarchy and mechanism-boundary framework for ${topic}`, 220);
    const mechanismComponents = this.uniqueStrings(evidenceMatrix.map(row => row.mechanismIndicator).filter(item => item !== 'NR')).slice(0, 4);
    return {
      frameworkName,
      coreLogic: this.cleanText(`该框架把证据来源先分为直接、系统特异、相邻和机制证据，再把可支持的正向发现连接到变量、机制、指标和不可外推边界。它的创新不是简单增加文献，而是把“能写什么”和“不能写什么”转化为可执行的论文结构。`, 700),
      components: this.uniqueStrings([
        'Evidence hierarchy: direct, system-specific, adjacent, mechanistic, background, insufficient.',
        'Positive findings extracted from supported evidence rather than only limitations.',
        'Variable-Mechanism-Outcome pathways with boundary conditions.',
        'Indicator boundary rules for separating outcomes and avoiding overgeneralization.',
        ...mechanismComponents,
      ]).slice(0, 8),
      whatItExplains: this.uniqueStrings([
        positiveFindings[0] || `当前证据在多大范围内支持“${topic}”相关发现。`,
        '为什么不同研究结果可能因对象、场景、机制、指标或时间尺度不同而不一致。',
        '哪些结论可以作为条件性发现，哪些只能作为待验证假设。',
      ]).slice(0, 5),
      whatItDoesNotExplain: [
        '未提供原始数据或统计结果时，不能解释精确效应量、显著性或因果强度。',
        '未被证据矩阵覆盖的区域、对象、处理和指标不能由该框架外推。',
      ],
      testableHypothesesOrFutureQuestions: this.uniqueStrings([
        ...hypotheses,
        ...blueprint.coreScientificQuestions,
      ]).slice(0, 6),
      practicalOrTheoreticalValue: [
        '把分散文献转化为可审计的观点-证据-机制-边界链条。',
        '帮助一键写论文在大纲、结果、讨论和结论中保留内容厚度与证据边界。',
      ],
    };
  }

  private buildConceptualFigure(topic: string, framework: AutoResearchInnovationFramework): AutoResearchConceptualFigure {
    return {
      title: 'Figure 1. Conceptual Framework',
      caption: this.cleanText(`${framework.frameworkName}：从研究边界出发，先进行证据分级，再提炼正向发现，连接机制路径和指标解释，最后限定可写结论与需避免结论。`, 500),
      mermaid: [
        'flowchart LR',
        `A["Research boundary: ${this.escapeMermaidLabel(topic, 70)}"] --> B["Evidence hierarchy"]`,
        'B --> C["Positive findings"]',
        'C --> D["Variable-Mechanism-Outcome pathways"]',
        'D --> E["Indicator boundary and quantitative summary"]',
        'E --> F["Claims allowed"]',
        'E --> G["Claims to avoid"]',
      ].join('\n'),
    };
  }

  private buildEvidenceStrengthHeatmap(
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    evidenceObjects: AutoResearchEvidenceObject[]
  ): AutoResearchEvidenceStrengthHeatmapRow[] {
    const evidenceById = new Map(evidenceObjects.map(item => [item.id, item]));
    return evidenceSynthesis.slice(0, 8).map(item => {
      const linkedEvidence = item.evidenceObjectIds.map(id => evidenceById.get(id)).filter((value): value is AutoResearchEvidenceObject => Boolean(value));
      const classes = linkedEvidence.map(evidence => this.inferContentEvidenceClass(evidence, `${evidence.claim} ${evidence.evidenceText} ${evidence.viewpointSummary}`));
      const directCount = classes.filter(value => value === 'Direct').length;
      const systemCount = classes.filter(value => value === 'System-specific').length;
      const adjacentCount = classes.filter(value => value === 'Adjacent').length;
      const mechanismCount = classes.filter(value => value === 'Mechanistic').length;
      const confidenceScore = directCount * 3 + systemCount * 2 + adjacentCount + mechanismCount;
      return {
        pathwayTopic: this.cleanText(item.claim, 180),
        directEvidence: this.toHeatmapLevel(directCount),
        systemSpecificEvidence: this.toHeatmapLevel(systemCount),
        adjacentEvidence: this.toHeatmapLevel(adjacentCount),
        mechanisticEvidence: this.toHeatmapLevel(mechanismCount),
        overallConfidence: confidenceScore >= 6 ? 'High' : confidenceScore >= 3 ? 'Medium' : 'Low',
      };
    });
  }

  private buildReferenceCleaningNotes(
    evidenceMatrix: AutoResearchEvidenceMatrixRow[],
    evidenceObjects: AutoResearchEvidenceObject[]
  ): AutoResearchReferenceCleaningNotes {
    const rowBySource = new Map(evidenceMatrix.map(row => [this.normalizeClaim(row.studyOrDataSource), row]));
    const coreEvidenceToRetain: string[] = [];
    const mechanisticEvidenceToRetain: string[] = [];
    const backgroundEvidenceToRetain: string[] = [];
    const referencesRequiringVerification: string[] = [];
    const referencesToRemoveOrExclude: string[] = [];
    for (const evidence of evidenceObjects.slice(0, 40)) {
      const source = this.formatContentEvidenceSource(evidence);
      const row = rowBySource.get(this.normalizeClaim(source));
      const className = row?.evidenceClass || this.inferContentEvidenceClass(evidence, `${evidence.claim} ${evidence.evidenceText} ${evidence.viewpointSummary}`);
      const hasReference = evidence.references.length > 0 || evidence.inTextCitations.length > 0;
      if ((className === 'Direct' || className === 'System-specific') && hasReference) coreEvidenceToRetain.push(source);
      else if (className === 'Mechanistic' && hasReference) mechanisticEvidenceToRetain.push(source);
      else if (className === 'Background' && hasReference) backgroundEvidenceToRetain.push(source);
      if (!hasReference || row?.evidenceStrength === 'Weak') referencesRequiringVerification.push(source);
      if (className === 'Insufficient') referencesToRemoveOrExclude.push(source);
    }
    return {
      coreEvidenceToRetain: this.uniqueStrings(coreEvidenceToRetain).slice(0, 8),
      mechanisticEvidenceToRetain: this.uniqueStrings(mechanisticEvidenceToRetain).slice(0, 8),
      backgroundEvidenceToRetain: this.uniqueStrings(backgroundEvidenceToRetain).slice(0, 8),
      referencesRequiringVerification: this.uniqueStrings(referencesRequiringVerification).slice(0, 10),
      referencesToRemoveOrExclude: this.uniqueStrings(referencesToRemoveOrExclude).slice(0, 8),
    };
  }

  private buildContentGoNoGoDecision(
    review: AutoResearchPaperTopicReview,
    evidenceMatrix: AutoResearchEvidenceMatrixRow[],
    positiveFindings: string[],
    latestEvaluation?: AutoResearchSelfEvaluationReport,
    latestAudit?: AutoResearchAuditReport
  ): AutoResearchContentEnhancementReport['goNoGoDecision'] {
    const hasFailingAudit = latestAudit?.verdict === 'fail';
    const lowEvaluation = Boolean(latestEvaluation && latestEvaluation.overallScore < 0.45);
    const hasMinimumContent = evidenceMatrix.length >= 5 && positiveFindings.length >= 2;
    const decision: AutoResearchContentWritingDecision =
      review.goToWritingStage === '暂不建议写作' || evidenceMatrix.length === 0
        ? 'No-Go'
        : hasFailingAudit || lowEvaluation || review.goToWritingStage === '需要补充数据后再写'
          ? 'Revise Before Writing'
          : hasMinimumContent && review.goToWritingStage === '可以进入写作'
            ? 'Go'
            : 'Conditional Go';
    const requiredActionsBeforeWriting = this.uniqueStrings([
      evidenceMatrix.length < 5 ? '补充可追溯证据对象，使 Evidence Matrix 至少覆盖 5 条关键来源。' : '',
      positiveFindings.length < 2 ? '从证据矩阵中提炼至少 2-3 条有边界的正向发现。' : '',
      latestAudit && latestAudit.verdict !== 'pass' ? '优先处理引用-论据审计中的 warn/fail 项。' : '',
      latestEvaluation && latestEvaluation.overallScore < 0.72 ? '根据审稿式自评建议补齐证据充分性、引用对齐或可复现记录。' : '',
      '写作前确认 Table 1-3 和 Figure 1-2 都已进入大纲或正文。'
    ]).slice(0, 8);
    return {
      decision,
      reason: decision === 'Go'
        ? '当前证据矩阵、正向发现和写作边界足以支撑进入正式写作。'
        : decision === 'Conditional Go'
          ? '可以进入受限写作，但必须保留证据边界并补齐图表/矩阵。'
          : decision === 'Revise Before Writing'
            ? '进入正式写作前需要先修复证据、审计或数据结构问题。'
            : '当前缺少可追溯证据或选题审查不建议写作。',
      requiredActionsBeforeWriting,
    };
  }

  private buildContentQualityChecklist(
    evidenceMatrix: AutoResearchEvidenceMatrixRow[],
    vmoMatrix: AutoResearchVariableMechanismOutcomeRow[],
    quantitativeResultSummary: AutoResearchQuantitativeResultRow[],
    positiveFindings: string[],
    referenceCleaningNotes: AutoResearchReferenceCleaningNotes,
    goNoGoDecision: AutoResearchContentEnhancementReport['goNoGoDecision'],
    latestAudit?: AutoResearchAuditReport
  ): AutoResearchContentEnhancementReport['qualityChecklist'] {
    const items: AutoResearchContentEnhancementReport['qualityChecklist'] = [
      {
        item: '是否避免单一证据支撑全文',
        passed: evidenceMatrix.length >= 5,
        detail: `Evidence Matrix 当前 ${evidenceMatrix.length} 行。`,
      },
      {
        item: '是否生成 Evidence Matrix',
        passed: evidenceMatrix.length > 0,
        detail: evidenceMatrix.length > 0 ? '已生成。' : '缺少可追溯证据对象。',
      },
      {
        item: '是否生成 Variable-Mechanism-Outcome Matrix',
        passed: vmoMatrix.length > 0,
        detail: vmoMatrix.length > 0 ? `已生成 ${vmoMatrix.length} 行。` : '缺少变量/机制/结果链条。',
      },
      {
        item: '是否生成 Quantitative Result Summary',
        passed: quantitativeResultSummary.length > 0,
        detail: quantitativeResultSummary.length > 0 ? `已提取 ${quantitativeResultSummary.length} 条含数值材料。` : '当前材料未提供可安全提取的数值结果，正文必须写 NR 或需要作者补充。',
      },
      {
        item: '是否提炼正向发现',
        passed: positiveFindings.length > 0,
        detail: positiveFindings.length > 0 ? `已提炼 ${positiveFindings.length} 条。` : '不能只输出限制，需要补充正向发现。',
      },
      {
        item: '是否提出解释型创新框架',
        passed: true,
        detail: '已生成证据分级-机制边界框架和概念图。',
      },
      {
        item: '是否清理无关参考文献和工具痕迹',
        passed: referenceCleaningNotes.referencesToRemoveOrExclude.length === 0,
        detail: referenceCleaningNotes.referencesToRemoveOrExclude.length
          ? `需移除或排除 ${referenceCleaningNotes.referencesToRemoveOrExclude.length} 条不足证据来源。`
          : '未发现必须移除的不足证据来源；仍需核查弱证据和无引用来源。',
      },
      {
        item: '是否避免编造数据和文献',
        passed: true,
        detail: '缺失量化信息统一保留 NR，不生成未报告数值。',
      },
      {
        item: '是否给出 Go / No-Go 判断',
        passed: Boolean(goNoGoDecision.decision),
        detail: goNoGoDecision.decision,
      },
      {
        item: '引用-论据审计是否通过',
        passed: !latestAudit || latestAudit.verdict === 'pass',
        detail: latestAudit ? `${latestAudit.verdict}: ${latestAudit.summary}` : '尚未运行审计。',
      },
    ];
    return items;
  }

  private inferContentEvidenceClass(item: AutoResearchEvidenceObject, text: string): AutoResearchContentEvidenceClass {
    const lower = this.normalizeSearchText(text);
    if ((item.references.length === 0 && item.inTextCitations.length === 0) || Number(item.groundingScore || 0) < 0.25) return 'Insufficient';
    if (/mechanism|pathway|process|mediated|microbial|enzyme|gene|硝化|反硝化|机制|机理|路径|过程/.test(lower)) return 'Mechanistic';
    if (item.trace?.sourceType === 'pdf-wiki' && Number(item.groundingScore || 0) >= 0.65) return 'Direct';
    if (item.trace?.sourceType === 'pdf-wiki') return 'System-specific';
    if (item.trace?.sourceType === 'embedding-library') return 'Adjacent';
    return 'Background';
  }

  private inferContentEvidenceStrength(
    item: AutoResearchEvidenceObject,
    evidenceClass: AutoResearchContentEvidenceClass
  ): AutoResearchContentEvidenceStrength {
    if (evidenceClass === 'Insufficient') return 'Weak';
    const score = this.scoreEvidenceObjectForAutoResearch(item);
    if (score >= 0.95 && item.references.length > 0) return 'Strong';
    if (score >= 0.55 && (item.references.length > 0 || item.inTextCitations.length > 0)) return 'Medium';
    return 'Weak';
  }

  private formatContentEvidenceSource(item: AutoResearchEvidenceObject): string {
    const ref = item.references[0];
    const label = [
      ref?.authors || '',
      ref?.year ? `(${ref.year})` : '',
      ref?.title || item.sourcePdfTitle || item.sourcePdfName || item.claim || '',
      ref?.journal || '',
      ref?.doi ? `DOI: ${ref.doi}` : '',
    ].filter(Boolean).join(' ');
    return this.cleanText(label || item.id, 260);
  }

  private getPrimaryContentSourceKey(item: AutoResearchEvidenceObject): string {
    const ref = item.references[0];
    return normalizeKeyword(ref?.doi || ref?.title || item.sourcePdfTitle || item.sourcePdfName || item.trace?.sourceUri || item.id);
  }

  private inferContentContext(review: AutoResearchPaperTopicReview, item: AutoResearchEvidenceObject, text: string): string {
    const terms = this.uniqueStrings([
      review.recommendedBoundary.region,
      review.recommendedBoundary.system,
      item.section,
      item.location,
      this.extractBoundaryTerms(text, this.buildTopicSearchTerms(text), ['north china', 'north china plain', 'field', 'laboratory', 'model', 'greenhouse', '华北', '田间', '室内', '模型']).join('；'),
    ]).filter(Boolean);
    return this.cleanText(terms.join('；') || 'NR: context not reported in available material', 260);
  }

  private inferContentVariable(review: AutoResearchPaperTopicReview, text: string): string {
    const terms = this.uniqueStrings([
      ...review.recommendedBoundary.treatments,
      ...this.extractBoundaryTerms(text, this.buildTopicSearchTerms(text), ['nitrogen fertilizer', 'fertilization', 'nitrogen rate', 'biochar', 'irrigation', 'tillage', 'urea', '氮肥', '施肥', '灌溉', '耕作']),
    ]).filter(Boolean);
    return this.cleanText(terms.join('；') || 'NR: variable/intervention not explicitly reported', 240);
  }

  private inferContentOutcomeIndicator(review: AutoResearchPaperTopicReview, text: string): string {
    const terms = this.uniqueStrings([
      ...review.recommendedBoundary.indicators,
      ...this.extractBoundaryTerms(text, this.buildTopicSearchTerms(text), ['n2o', 'nitrous oxide', 'emission', 'yield', 'efficiency', 'soil', 'biomass', '氧化亚氮', '排放', '产量', '效率', '土壤']),
    ]).filter(Boolean);
    return this.cleanText(terms.join('；') || 'NR: outcome indicator not explicitly reported', 240);
  }

  private inferContentMechanism(review: AutoResearchPaperTopicReview, text: string): string {
    const terms = this.uniqueStrings([
      ...review.recommendedBoundary.mechanisms,
      ...this.extractBoundaryTerms(text, this.buildTopicSearchTerms(text), ['nitrification', 'denitrification', 'microbial', 'enzyme', 'gene', 'amoa', 'nosz', '硝化', '反硝化', '微生物', '酶', '基因']),
    ]).filter(Boolean);
    return this.cleanText(terms.join('；') || 'NR', 240);
  }

  private extractQuantitativeResult(text: string): string {
    const matches = this.uniqueStrings((text.match(/[-+]?\d+(?:\.\d+)?\s*(?:%|‰|mg|g|kg|t|ha|m2|m-2|yr|year|d|day|h|mol|mmol|μmol|umol|ppm|ppb|fold|times|倍)?/gi) || [])
      .map(item => item.trim())
      .filter(item => {
        if (!item) return false;
        if (/^(19|20)\d{2}$/.test(item)) return false;
        return /\d/.test(item);
      }));
    return matches.length ? matches.slice(0, 6).join('; ') : 'NR';
  }

  private inferQuantitativeDirection(text: string): AutoResearchQuantitativeResultRow['direction'] {
    const lower = this.normalizeSearchText(text);
    const hasIncrease = /increase|increased|higher|enhance|rise|positive|增|提高|升高|促进/.test(lower);
    const hasDecrease = /decrease|decreased|lower|reduce|reduction|decline|negative|降低|减少|抑制|下降/.test(lower);
    if (hasIncrease && hasDecrease) return 'Mixed';
    if (hasIncrease) return 'Increase';
    if (hasDecrease) return 'Decrease';
    if (/no significant|not significant|unchanged|无显著|不显著|无明显/.test(lower)) return 'No clear change';
    return 'NR';
  }

  private buildClaimToAvoidForEvidence(
    item: AutoResearchEvidenceObject,
    evidenceClass: AutoResearchContentEvidenceClass,
    evidenceStrength: AutoResearchContentEvidenceStrength
  ): string {
    if (evidenceClass === 'Insufficient') return '不能作为正式结论支撑；需核查来源、引用和原文证据。';
    if (evidenceClass === 'Adjacent') return '不能把摘要级或相邻证据写成本文对象的直接实验证据。';
    if (evidenceClass === 'Mechanistic') return '不能把机制解释写成已证实的应用效果或总体结论。';
    if (evidenceStrength === 'Weak') return '不能写成强结论；需降级为提示性或条件性表述。';
    if (item.stance === 'oppose') return '不能忽略相反证据，必须写入边界或争议解释。';
    if (item.stance === 'neutral') return '不能把中性材料写成支持性证据。';
    return '不能超出来源对象、区域、方法、指标和时间尺度外推。';
  }

  private toHeatmapLevel(count: number): 'High' | 'Medium' | 'Low' {
    if (count >= 3) return 'High';
    if (count >= 1) return 'Medium';
    return 'Low';
  }

  private escapeMermaidLabel(value: string, maxLength: number): string {
    return this.cleanText(value, maxLength).replace(/["[\]{}<>|]/g, ' ');
  }

  private inferPaperTypeForTopicSkill(
    topic: string,
    literatureNodes: AutoResearchLiteratureNode[],
    evidenceObjects: AutoResearchEvidenceObject[]
  ): string {
    if (/meta|荟萃|整合分析/i.test(topic)) return 'Meta 分析';
    if (/systematic|系统综述/i.test(topic)) return '系统综述';
    if (/review|综述|进展/i.test(topic)) return literatureNodes.length >= 30 ? '叙述性综述/范围综述' : '范围综述';
    if (evidenceObjects.length >= 8 && literatureNodes.length >= 20) return '范围综述/证据综合论文';
    if (literatureNodes.length >= 10) return '范围综述';
    return '研究方案或预分析报告';
  }

  private inferNotRecommendedPaperTypes(
    paperType: string,
    evidenceObjects: AutoResearchEvidenceObject[],
    pdfWikiEvidenceObjects: AutoResearchEvidenceObject[]
  ): string[] {
    const items: string[] = [];
    if (!/Meta 分析/i.test(paperType)) items.push('Meta 分析（除非补充效应值提取、纳排标准和统计模型）');
    if (pdfWikiEvidenceObjects.length < 10) items.push('系统综述（当前缺少完整检索、筛选和原文级证据链）');
    if (evidenceObjects.length < 5) items.push('原创研究论文（当前缺少原始实验数据或统计结果）');
    return items;
  }

  private inferTopicRiskLevel(
    literatureNodes: AutoResearchLiteratureNode[],
    pdfWikiEvidenceObjects: AutoResearchEvidenceObject[],
    embeddingEvidenceObjects: AutoResearchEvidenceObject[],
    evidenceObjects: AutoResearchEvidenceObject[],
    latestEvaluation?: AutoResearchSelfEvaluationReport,
    latestAudit?: AutoResearchAuditReport
  ): AutoResearchPaperTopicReview['topicRiskLevel'] {
    if (literatureNodes.length === 0 && evidenceObjects.length === 0) return 'not-recommended';
    let risk = 0;
    if (literatureNodes.length < 10) risk += 2;
    else if (literatureNodes.length < 25) risk += 1;
    if (evidenceObjects.length < 5) risk += 2;
    else if (evidenceObjects.length < 15) risk += 1;
    if (pdfWikiEvidenceObjects.length === 0 && embeddingEvidenceObjects.length > 0) risk += 1;
    if (latestEvaluation && latestEvaluation.overallScore < 0.45) risk += 2;
    else if (latestEvaluation && latestEvaluation.overallScore < 0.72) risk += 1;
    if (latestAudit?.verdict === 'fail') risk += 2;
    else if (latestAudit?.verdict === 'warn') risk += 1;
    if (risk >= 5) return 'high';
    if (risk >= 2) return 'medium';
    return 'low';
  }

  private inferBoundaryValue(topic: string, terms: string[], pattern: RegExp, fallback: string): string {
    if (pattern.test(topic)) return this.cleanText(topic.match(pattern)?.[0] || '', 120) || fallback;
    const hit = terms.find(term => pattern.test(term));
    return hit || fallback;
  }

  private extractBoundaryTerms(topic: string, terms: string[], candidates: string[]): string[] {
    const text = `${topic} ${terms.join(' ')}`.toLowerCase();
    return this.uniqueStrings(candidates.filter(candidate => text.includes(candidate.toLowerCase())));
  }

  private selectTopicRelevantLiteratureNodes(topic: string, nodes: AutoResearchLiteratureNode[], limit: number): AutoResearchLiteratureNode[] {
    const terms = this.buildTopicSearchTerms(topic);
    if (terms.length === 0) return nodes.slice(0, limit);
    return nodes
      .map(node => ({ node, score: this.scoreLiteratureNodeForTopic(node, terms) }))
      .filter(item => item.score >= 8)
      .sort((a, b) => b.score - a.score || Number(b.node.year || 0) - Number(a.node.year || 0) || a.node.title.localeCompare(b.node.title, 'zh-CN'))
      .slice(0, limit)
      .map(item => item.node);
  }

  private buildTopicSearchTerms(topic: string): string[] {
    const raw = this.cleanText(topic, 500);
    const lower = raw.toLowerCase().replace(/[₂]/g, '2');
    const terms: string[] = [];
    const add = (...values: string[]) => values.forEach(value => {
      const clean = this.cleanText(value, 120).toLowerCase().replace(/[₂]/g, '2');
      if (clean) terms.push(clean);
    });

    add(...(lower.match(/[a-z][a-z0-9+-]{1,}/g) || []));
    const domainPhrases = ['氮肥', '华北', '华北农田', '华北平原', '农田', '氧化亚氮', '排放', '减排', '管理措施', '施肥', '机理'];
    for (const phrase of domainPhrases) {
      if (raw.includes(phrase)) add(phrase);
    }
    if (/\bn2o\b|氧化亚氮|nitrous oxide/i.test(raw)) {
      add('n2o', 'nitrous oxide', '氧化亚氮');
    }
    if (/氮肥|施肥|fertil/i.test(raw)) {
      add('nitrogen fertilizer', 'nitrogen fertilization', 'fertilization', 'nitrogen application', 'nitrogen rate', 'urea', '氮肥', '施肥');
    }
    if (/华北|north china/i.test(raw)) {
      add('north china', 'north china plain', '华北', '华北平原');
    }
    if (/农田|cropland|farmland|field/i.test(raw)) {
      add('cropland', 'farmland', 'agricultural soil', 'field experiment', '农田');
    }
    if (/排放|emission/i.test(raw)) {
      add('n2o emission', 'n2o emissions', 'nitrous oxide emission', 'nitrous oxide emissions', 'greenhouse gas emission', '排放');
    }
    if (/机理|mechanism|过程/i.test(raw)) {
      add('mechanism', 'nitrification', 'denitrification', 'microbial', 'amoa', 'nosz', '硝化', '反硝化', '微生物');
    }
    return this.uniqueStrings(terms).filter(term => !['农业', 'agriculture', '影响', 'effect', 'effects', 'different'].includes(term));
  }

  private scoreLiteratureNodeForTopic(node: AutoResearchLiteratureNode, terms: string[]): number {
    const title = this.normalizeSearchText(node.title);
    const journal = this.normalizeSearchText(node.journal);
    const keywords = this.normalizeSearchText([...node.keywords, ...node.aiKeywords, ...node.categories].join(' '));
    const abstract = this.normalizeSearchText(node.abstract);
    const documentType = this.normalizeSearchText(node.documentType);
    let score = 0;
    for (const term of terms) {
      const normalizedTerm = this.normalizeSearchText(term);
      if (!normalizedTerm) continue;
      if (title.includes(normalizedTerm)) score += 6;
      if (keywords.includes(normalizedTerm)) score += 4;
      if (abstract.includes(normalizedTerm)) score += 2;
      if (journal.includes(normalizedTerm)) score += 1;
    }
    const combined = `${title} ${keywords} ${abstract}`;
    if (/\bn2o\b|nitrous oxide|氧化亚氮/.test(combined)) score += 6;
    if (/nitrogen fertil|fertilization|nitrogen application|氮肥|施肥/.test(combined)) score += 4;
    if (/north china|north china plain|华北|华北平原/.test(combined)) score += 4;
    if (/nitrification|denitrification|硝化|反硝化|microbial|微生物/.test(combined)) score += 2;
    if (node.hasEmbedding) score += 0.5;
    if (/article|review|论文|期刊/.test(documentType)) score += 0.5;
    if (/日报|商报|导报|新闻|会议开启|行动计划|解读|青年|工厂|newspaper|news/i.test(`${node.journal} ${node.title}`)) score -= 7;
    return score;
  }

  private buildLiteratureTagsFromNodes(nodes: AutoResearchLiteratureNode[]): AutoResearchLiteratureTag[] {
    const keywordMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    const aiKeywordMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    const journalMap = new Map<string, { name: string; literatureIds: Set<string> }>();
    for (const node of nodes) {
      this.addLiteratureTags(keywordMap, node.keywords, node.id);
      this.addLiteratureTags(aiKeywordMap, node.aiKeywords, node.id);
      this.addLiteratureTags(journalMap, [node.journal], node.id);
    }
    return [
      ...this.toLiteratureTags('keyword', keywordMap),
      ...this.toLiteratureTags('aiKeyword', aiKeywordMap),
      ...this.toLiteratureTags('journal', journalMap),
    ].sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name, 'zh-CN'));
  }

  private buildSelfEvaluationReport(state: AutoResearchState, now: string): AutoResearchSelfEvaluationReport {
    const {
      allLiteratureNodes,
      literatureNodes,
      pdfWikiEvidenceObjects,
      embeddingEvidenceObjects,
      evidenceObjects,
    } = this.buildEvidenceContext(state, now, 200);
    const literatureSnapshots = state.literatureMap.snapshots || [];
    const totalEvidence = evidenceObjects.length;
    const citedEvidence = evidenceObjects.filter(item => item.references.length > 0 || item.inTextCitations.length > 0).length;
    const sourceLinkedEvidence = evidenceObjects.filter(item => item.sourcePdfId || item.sourcePdfName || item.references.length > 0).length;
    const textEvidence = evidenceObjects.filter(item => item.evidenceText.length >= 30).length;
    const traceLinkedEvidence = evidenceObjects.filter(item => item.trace?.sourceUri && (item.trace.pdfWikiEntryId || item.trace.literatureNodeId)).length;
    const claimMap = this.groupEvidenceByClaim(evidenceObjects);
    const supportedClaims = Array.from(claimMap.values()).filter(items => items.some(item => item.stance === 'support')).length;
    const contrastedClaims = Array.from(claimMap.values()).filter(items => items.some(item => item.stance === 'oppose' || item.stance === 'neutral')).length;
    const uniqueSources = new Set(evidenceObjects.map(item => item.sourcePdfId || item.sourcePdfName || item.references[0]?.doi || item.references[0]?.title).filter(Boolean)).size;
    const duplicateClaimCount = this.countDuplicateClaims(evidenceObjects);
    const replayableOperations = state.operations.filter(operation => operation.replayFile && operation.inputHash).length;
    const embeddedLiterature = literatureNodes.filter(item => item.hasEmbedding).length;
    const uniqueJournals = new Set(literatureNodes.map(item => item.journal).filter(Boolean)).size;
    const uniqueLiteratureTags = new Set((state.literatureMap.tags || []).map(tag => `${tag.kind}:${normalizeKeyword(tag.name)}`).filter(Boolean)).size;
    const hasEvidenceSnapshot = state.evidenceLibrary.snapshots.length > 0 || (embeddingEvidenceObjects.length > 0 && literatureSnapshots.length > 0);

    const citationScore = totalEvidence === 0
      ? 0
      : this.clamp01((citedEvidence / totalEvidence) * 0.55 + (sourceLinkedEvidence / totalEvidence) * 0.25 + (traceLinkedEvidence / totalEvidence) * 0.2);
    const sufficiencyScore = claimMap.size === 0
      ? 0
      : this.clamp01((supportedClaims / claimMap.size) * 0.45 + (contrastedClaims / claimMap.size) * 0.25 + Math.min(1, totalEvidence / Math.max(1, claimMap.size * 2)) * 0.3);
    const noveltyScore = this.clamp01(
      Math.min(1, claimMap.size / 12) * 0.25
      + Math.min(1, uniqueSources / 8) * 0.18
      + Math.min(1, literatureNodes.length / 50) * 0.18
      + Math.min(1, uniqueJournals / 12) * 0.09
      + Math.min(1, uniqueLiteratureTags / 30) * 0.08
      + (duplicateClaimCount === 0 ? 0.14 : Math.max(0, 0.14 - duplicateClaimCount * 0.03))
      + Math.min(0.08, state.projectMemory.filter(item => item.kind === 'hypothesis' || item.kind === 'finding').length * 0.02)
    );
    const reproducibilityScore = this.clamp01(
      (hasEvidenceSnapshot ? 0.2 : 0)
      + (literatureSnapshots.length > 0 ? 0.15 : 0)
      + (state.operations.length > 0 ? 0.2 : 0)
      + Math.min(0.2, replayableOperations / Math.max(1, state.operations.length) * 0.2)
      + (state.projectMemory.length > 0 ? 0.15 : 0)
      + (state.evaluations.length > 0 ? 0.1 : 0)
    );

    const metrics: AutoResearchEvaluationMetric[] = [
      {
        id: 'citation_alignment',
        label: '引用对齐',
        score: citationScore,
        level: this.metricLevel(citationScore),
        summary: totalEvidence > 0
          ? `${citedEvidence}/${totalEvidence} 个等权纳入证据对象带有引用或文中引文，${sourceLinkedEvidence}/${totalEvidence} 个绑定来源；原始可用 PDF Wiki 句级证据 ${pdfWikiEvidenceObjects.length} 个、embedding 摘要证据 ${embeddingEvidenceObjects.length} 个。`
          : '暂无证据对象，无法检查引用对齐。',
        checks: [
          { label: '证据对象有引用', passed: totalEvidence > 0 && citedEvidence / Math.max(1, totalEvidence) >= 0.8, detail: totalEvidence > 0 ? `${citedEvidence}/${totalEvidence}` : '无证据对象' },
          { label: '证据对象有来源', passed: totalEvidence > 0 && sourceLinkedEvidence / Math.max(1, totalEvidence) >= 0.95, detail: totalEvidence > 0 ? `${sourceLinkedEvidence}/${totalEvidence}` : '无证据对象' },
          { label: '证据对象可追溯', passed: totalEvidence > 0 && traceLinkedEvidence / Math.max(1, totalEvidence) >= 0.95, detail: totalEvidence > 0 ? `${traceLinkedEvidence}/${totalEvidence}` : '无证据对象' },
        ],
      },
      {
        id: 'evidence_sufficiency',
        label: '证据充分性',
        score: sufficiencyScore,
        level: this.metricLevel(sufficiencyScore),
        summary: claimMap.size > 0
          ? `${claimMap.size} 个论点组，${supportedClaims} 个有支持证据，${contrastedClaims} 个有中性或反对材料。`
          : '暂无论点组，无法检查证据充分性。',
        checks: [
          { label: '每个论点有支持材料', passed: claimMap.size > 0 && supportedClaims === claimMap.size, detail: claimMap.size > 0 ? `${supportedClaims}/${claimMap.size}` : '无论点组' },
          { label: '论点有对照材料', passed: claimMap.size > 0 && contrastedClaims / Math.max(1, claimMap.size) >= 0.35, detail: claimMap.size > 0 ? `${contrastedClaims}/${claimMap.size}` : '无论点组' },
          { label: '证据文本可核查', passed: totalEvidence > 0 && textEvidence / Math.max(1, totalEvidence) >= 0.9, detail: totalEvidence > 0 ? `${textEvidence}/${totalEvidence}` : '无证据对象' },
        ],
      },
      {
        id: 'novelty',
        label: '创新性',
        score: noveltyScore,
        level: this.metricLevel(noveltyScore),
        summary: `覆盖 ${claimMap.size} 个论点、${uniqueSources} 个证据来源、${literatureNodes.length} 篇主题相关文献（全库 ${allLiteratureNodes.length} 篇），疑似重复论点 ${duplicateClaimCount} 个。`,
        checks: [
          { label: '论点数量形成问题空间', passed: claimMap.size >= 8, detail: `${claimMap.size} 个论点` },
          { label: '来源覆盖度', passed: uniqueSources >= 5, detail: `${uniqueSources} 个来源` },
          { label: '主题文献覆盖度', passed: literatureNodes.length >= 20, detail: `${literatureNodes.length} 篇主题相关文献，${uniqueJournals} 个期刊` },
          { label: '向量文献可检索', passed: literatureNodes.length > 0 && embeddedLiterature / Math.max(1, literatureNodes.length) >= 0.8, detail: `${embeddedLiterature}/${literatureNodes.length}` },
          { label: '重复论点较少', passed: duplicateClaimCount <= Math.max(1, Math.floor(claimMap.size * 0.1)), detail: `${duplicateClaimCount} 个疑似重复` },
        ],
      },
      {
        id: 'reproducibility',
        label: '可复现性',
        score: reproducibilityScore,
        level: this.metricLevel(reproducibilityScore),
        summary: `${state.operations.length} 条操作记录，${state.evidenceLibrary.snapshots.length} 个证据快照，${literatureSnapshots.length} 个文献图谱快照，${replayableOperations} 条带回放文件。`,
        checks: [
          { label: '证据库/摘要证据有版本快照', passed: hasEvidenceSnapshot, detail: `${state.evidenceLibrary.snapshots.length} 个 PDF 证据快照，${literatureSnapshots.length} 个文献快照` },
          { label: '文献图谱有版本快照', passed: literatureSnapshots.length > 0, detail: `${literatureSnapshots.length} 个快照` },
          { label: 'Agent 操作有记录', passed: state.operations.length > 0, detail: `${state.operations.length} 条记录` },
          { label: '操作可回放', passed: state.operations.length > 0 && replayableOperations / Math.max(1, state.operations.length) >= 0.9, detail: `${replayableOperations}/${state.operations.length}` },
        ],
      },
    ];

    const issues = this.buildEvaluationIssues(metrics, evidenceObjects, claimMap);
    const recommendations = this.buildEvaluationRecommendations(metrics);
    return {
      id: `eval_${this.hash({ userId: state.userId, now, scores: metrics.map(metric => metric.score) }).slice(0, 18)}`,
      generatedAt: now,
      overallScore: this.roundScore(metrics.reduce((sum, metric) => sum + metric.score, 0) / metrics.length),
      metrics: metrics.map(metric => ({ ...metric, score: this.roundScore(metric.score) })),
      issues,
      recommendations,
    };
  }

  private buildEvaluationIssues(
    metrics: AutoResearchEvaluationMetric[],
    evidenceObjects: AutoResearchEvidenceObject[],
    claimMap: Map<string, AutoResearchEvidenceObject[]>
  ): string[] {
    const issues: string[] = [];
    for (const metric of metrics) {
      for (const check of metric.checks) {
        if (!check.passed) issues.push(`${metric.label}：${check.label}不足（${check.detail}）`);
      }
    }
    const uncited = evidenceObjects.filter(item => item.references.length === 0 && item.inTextCitations.length === 0).slice(0, 5);
    for (const item of uncited) {
      issues.push(`证据缺少引用：${this.cleanText(item.claim, 80)} / ${this.cleanText(item.evidenceText, 100)}`);
    }
    const unsupported = Array.from(claimMap.entries())
      .filter(([, items]) => !items.some(item => item.stance === 'support'))
      .slice(0, 5);
    for (const [claim] of unsupported) {
      issues.push(`论点缺少支持证据：${this.cleanText(claim, 120)}`);
    }
    return this.uniqueStrings(issues).slice(0, 20);
  }

  private buildEvaluationRecommendations(metrics: AutoResearchEvaluationMetric[]): string[] {
    const recommendations: string[] = [];
    if (metrics.find(metric => metric.id === 'citation_alignment')?.level !== 'pass') {
      recommendations.push('优先补齐证据句的文中引用、参考文献编号、来源 PDF 位置或 embedding 文献元数据。');
    }
    if (metrics.find(metric => metric.id === 'evidence_sufficiency')?.level !== 'pass') {
      recommendations.push('为核心论点补充支持、反对和中性材料，避免只保留单一立场。');
    }
    if (metrics.find(metric => metric.id === 'novelty')?.level !== 'pass') {
      recommendations.push('合并重复论点，并把发现整理成更明确的研究假设或知识缺口。');
    }
    if (metrics.find(metric => metric.id === 'reproducibility')?.level !== 'pass') {
      recommendations.push('所有关键 Agent 输出都记录输入、输出、工具结果和版本，保留可回放文件。');
    }
    return recommendations.length > 0 ? recommendations : ['当前闭环基础良好，可进入草稿生成和审稿式修订。'];
  }

  private groupEvidenceByClaim(evidenceObjects: AutoResearchEvidenceObject[]): Map<string, AutoResearchEvidenceObject[]> {
    const map = new Map<string, AutoResearchEvidenceObject[]>();
    for (const item of evidenceObjects) {
      const key = this.normalizeClaim(item.claim || item.claimId);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
    return map;
  }

  private countDuplicateClaims(evidenceObjects: AutoResearchEvidenceObject[]): number {
    const claimIdsByNormalizedClaim = new Map<string, Set<string>>();
    for (const item of evidenceObjects) {
      const key = this.normalizeClaim(item.claim);
      const claimIds = claimIdsByNormalizedClaim.get(key) || new Set<string>();
      claimIds.add(item.claimId);
      claimIdsByNormalizedClaim.set(key, claimIds);
    }
    return Array.from(claimIdsByNormalizedClaim.values()).filter(claimIds => claimIds.size > 1).length;
  }

  private buildEvidenceSynthesis(evidenceObjects: AutoResearchEvidenceObject[]): AutoResearchFinalReport['evidenceSynthesis'] {
    const claimMap = this.groupEvidenceByClaim(evidenceObjects);
    return Array.from(claimMap.entries()).map(([claim, items]) => {
      const displayClaim = items.find(item => item.claim)?.claim || claim;
      const support = items.filter(item => item.stance === 'support');
      const neutral = items.filter(item => item.stance === 'neutral');
      const oppose = items.filter(item => item.stance === 'oppose');
      const bestEvidence = items
        .slice()
        .sort((a, b) => b.groundingScore - a.groundingScore)
        .slice(0, 3)
        .map(item => this.cleanText(item.viewpointSummary || item.evidenceText, 160))
        .filter(Boolean);
      return {
        claim: displayClaim,
        supportCount: support.length,
        neutralCount: neutral.length,
        opposeCount: oppose.length,
        summary: bestEvidence.length
          ? bestEvidence.join('；')
          : `该论点下有 ${items.length} 条材料，但证据摘要仍需补齐。`,
        evidenceObjectIds: items.map(item => item.id),
      };
    }).sort((a, b) =>
      (b.supportCount + b.neutralCount + b.opposeCount) - (a.supportCount + a.neutralCount + a.opposeCount)
      || b.supportCount - a.supportCount
      || a.claim.localeCompare(b.claim, 'zh-CN')
    );
  }

  private buildHypotheses(
    topic: string,
    topTags: AutoResearchLiteratureTag[],
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis'],
    literatureNodes: AutoResearchLiteratureNode[]
  ): string[] {
    const topicLower = topic.toLowerCase();
    const themeNames = topTags.slice(0, 5).map(tag => tag.name);
    const claimNames = evidenceSynthesis.slice(0, 4).map(item => item.claim);
    const recentYears = literatureNodes
      .map(item => Number(item.year))
      .filter(year => Number.isFinite(year) && year > 0)
      .sort((a, b) => b - a)
      .slice(0, 3);
    const domainHypotheses = /氮肥|n2o|nitrous oxide|氧化亚氮/i.test(topicLower)
      ? [
          '不同施氮量、肥料类型和施肥时期/方式可能通过改变土壤 NH4+、NO3- 供应以及硝化/反硝化过程，影响农田 N2O 排放强度。',
          '华北农田的降雨、灌溉、土壤含水量和作物生育期可能调节氮肥管理措施的 N2O 减排效果。',
          '缓释肥、硝化抑制剂、深施或分次施肥等措施的效果可能取决于土壤温度、有机碳、pH 和微生物功能基因等边界条件。',
        ]
      : [];
    return this.uniqueStrings([
      ...domainHypotheses,
      themeNames.length && domainHypotheses.length === 0 ? `在“${topic}”中，${themeNames.slice(0, 2).join('与')}可能是解释核心结果差异的重要机制或调控路径。` : '',
      claimNames.length ? `现有证据最集中指向“${this.cleanText(claimNames[0], 120)}”，可作为主论点或主效应路径。` : '',
      evidenceSynthesis.length === 0
        ? `当前缺少可追溯证据对象，因此这些假设只能作为待验证方向，不能作为已证实结论。`
        : (evidenceSynthesis.some(item => item.opposeCount > 0 || item.neutralCount > 0)
          ? `不同研究间的中性/反对证据可能来自研究对象、测量指标、时空尺度或处理条件差异。`
          : `当前证据对照不足，需要主动寻找边界条件和反例来验证结论稳健性。`),
      recentYears.length ? `${recentYears[0]} 年前后的主题相关研究可能代表新方法或新证据，应优先核查其数据与方法贡献。` : '',
      `若要形成可发表论文，需要把“${topic}”拆成可检验变量、可追溯证据链和可复现实验/数据分析流程。`,
    ]).slice(0, 6);
  }

  private buildKnowledgeGaps(
    topic: string,
    literatureNodes: AutoResearchLiteratureNode[],
    evidenceObjects: AutoResearchEvidenceObject[],
    latestEvaluation?: AutoResearchSelfEvaluationReport
  ): string[] {
    const embeddedCount = literatureNodes.filter(item => item.hasEmbedding).length;
    const claimMap = this.groupEvidenceByClaim(evidenceObjects);
    const contrastedClaims = Array.from(claimMap.values()).filter(items => items.some(item => item.stance === 'oppose' || item.stance === 'neutral')).length;
    const pdfWikiEvidenceCount = evidenceObjects.filter(item => item.trace?.sourceType === 'pdf-wiki').length;
    const embeddingEvidenceCount = evidenceObjects.filter(item => item.trace?.sourceType === 'embedding-library').length;
    return this.uniqueStrings([
      literatureNodes.length < 20 ? `文献覆盖不足：当前仅有 ${literatureNodes.length} 篇文献，建议继续扩充“${topic}”相关文献。` : '',
      literatureNodes.length > 0 && embeddedCount / Math.max(1, literatureNodes.length) < 0.8 ? `向量化不足：${embeddedCount}/${literatureNodes.length} 篇文献带 embedding，语义检索覆盖还不完整。` : '',
      evidenceObjects.length === 0 ? '证据库为空：需要先同步 embedding 文献库，或从 PDF Wiki 生成可追溯证据句、引用和来源位置。' : '',
      pdfWikiEvidenceCount === 0 && embeddingEvidenceCount > 0 ? `当前使用 ${embeddingEvidenceCount} 条 embedding 摘要证据，仍缺少 PDF Wiki 句级证据、页码和原文定位。` : '',
      claimMap.size > 0 && contrastedClaims / Math.max(1, claimMap.size) < 0.35 ? '对照证据不足：多数论点缺少中性或反对材料，容易形成单边论证。' : '',
      latestEvaluation?.issues.length ? latestEvaluation.issues.slice(0, 4).join('；') : '',
      `研究缺口应进一步收敛为：哪些机制、指标或情境会改变“${topic}”的结论方向和效应大小。`,
    ]).slice(0, 8);
  }

  private buildExperimentPlan(topic: string, hypotheses: string[], knowledgeGaps: string[]): string[] {
    return this.uniqueStrings([
      `1. 明确研究对象、处理/暴露变量、响应变量和控制变量，使“${topic}”从主题变成可检验问题。`,
      `2. 围绕首要假设设计数据表：每行对应样本/研究/实验单元，每列包含处理、环境、方法、结果和不确定性指标。`,
      `3. 对文献证据做编码：记录支持/中性/反对立场、证据句、页码/章节、DOI、研究类型和关键限制。`,
      `4. 若有原始数据，先做描述统计、缺失值检查、异常值检查，再选择回归、方差分析、Meta 分析或混合效应模型。`,
      `5. 针对知识缺口做敏感性分析：按研究区域、年份、方法、样本类型或指标定义分组比较。`,
      hypotheses[0] ? `6. 优先验证：${this.cleanText(hypotheses[0], 220)}` : '',
      knowledgeGaps[0] ? `7. 优先补证：${this.cleanText(knowledgeGaps[0], 220)}` : '',
    ]).slice(0, 8);
  }

  private buildDraftOutline(
    topic: string,
    hypotheses: string[],
    evidenceSynthesis: AutoResearchFinalReport['evidenceSynthesis']
  ): string[] {
    return this.uniqueStrings([
      `题目方向：围绕“${topic}”提出机制、证据链或方法学评估。`,
      `摘要：交代背景、研究缺口、数据/文献来源、核心发现和可复现贡献。`,
      `引言：从研究背景进入主要矛盾，归纳已有证据，提出 ${hypotheses.length ? '核心假设' : '待检验问题'}。`,
      `方法：说明文献库、PDF Wiki 证据库、筛选/编码规则、统计或综合分析方法。`,
      evidenceSynthesis[0] ? `结果1：围绕“${this.cleanText(evidenceSynthesis[0].claim, 140)}”呈现支持、中性和反对证据。` : '',
      evidenceSynthesis[1] ? `结果2：比较“${this.cleanText(evidenceSynthesis[1].claim, 140)}”相关证据的边界条件。` : '',
      `讨论：解释一致与不一致结果，指出机制、方法、样本或尺度带来的差异。`,
      `结论：给出对“${topic}”的结论、应用意义、限制和后续研究计划。`,
    ]).slice(0, 9);
  }

  private buildFinalReportLimitations(
    literatureNodes: AutoResearchLiteratureNode[],
    evidenceObjects: AutoResearchEvidenceObject[],
    latestEvaluation?: AutoResearchSelfEvaluationReport
  ): string[] {
    const pdfWikiEvidenceCount = evidenceObjects.filter(item => item.trace?.sourceType === 'pdf-wiki').length;
    const embeddingEvidenceCount = evidenceObjects.filter(item => item.trace?.sourceType === 'embedding-library').length;
    return this.uniqueStrings([
      literatureNodes.length === 0 ? '尚未筛出主题相关的 embedding 文献，需检查研究主题或扩充文献库。' : '',
      evidenceObjects.length === 0 ? '尚未接入 PDF Wiki 证据库或 embedding 摘要证据，无法核验论点对应的来源。' : '',
      pdfWikiEvidenceCount === 0 && embeddingEvidenceCount > 0 ? '当前证据主要来自 embedding 文献摘要，可做论文级引用对齐；尚不能替代 PDF 原文页码、章节和句级证据核验。' : '',
      latestEvaluation && latestEvaluation.overallScore < 0.72 ? `自评未达到通过阈值：${latestEvaluation.recommendations.slice(0, 3).join('；')}` : '',
      '自动报告基于当前本地文献库和 PDF Wiki 证据库生成，不等同于完整人工系统综述。',
    ]).slice(0, 6);
  }

  private buildFinalReportNextSteps(
    knowledgeGaps: string[],
    latestEvaluation?: AutoResearchSelfEvaluationReport
  ): string[] {
    return this.uniqueStrings([
      knowledgeGaps[0] ? `优先处理：${this.cleanText(knowledgeGaps[0], 220)}` : '',
      latestEvaluation?.recommendations[0] ? `自检建议：${latestEvaluation.recommendations[0]}` : '',
      '补充文献后重新运行 AutoResearch，使文献图谱、证据库和自评报告形成新版本快照。',
      '把最终假设转成可执行的数据分析任务或论文段落写作任务。',
    ]).slice(0, 6);
  }

  private buildLiteratureMapMemoryContent(
    nodes: AutoResearchLiteratureNode[],
    tags: AutoResearchLiteratureTag[],
    snapshot: AutoResearchLiteratureSnapshot
  ): string {
    const topTags = tags
      .filter(tag => tag.kind === 'mergedTag' || tag.kind === 'keyword' || tag.kind === 'aiKeyword')
      .slice(0, 6)
      .map(tag => `${tag.name}(${tag.count})`)
      .join('、');
    const embeddedRatio = snapshot.literatureCount > 0
      ? `${Math.round(snapshot.embeddingCount / snapshot.literatureCount * 100)}%`
      : '0%';
    return `Embedding 文献库已同步：${nodes.length} 篇文献，${snapshot.embeddingCount} 篇带向量（${embeddedRatio}），关键词 ${snapshot.keywordCount} 个。${topTags ? `主要主题：${topTags}。` : ''}`;
  }

  private addLiteratureTags(
    tagMap: Map<string, { name: string; literatureIds: Set<string> }>,
    values: string[],
    literatureId: string
  ): void {
    const seenInPaper = new Set<string>();
    for (const value of values) {
      const name = this.cleanText(value, 160);
      const key = normalizeKeyword(name);
      if (!key || seenInPaper.has(key)) continue;
      seenInPaper.add(key);
      const entry = tagMap.get(key) || { name, literatureIds: new Set<string>() };
      entry.literatureIds.add(literatureId);
      tagMap.set(key, entry);
    }
  }

  private toLiteratureTags(
    kind: AutoResearchLiteratureTagKind,
    tagMap: Map<string, { name: string; literatureIds: Set<string> }>
  ): AutoResearchLiteratureTag[] {
    return Array.from(tagMap.values())
      .map(entry => {
        const literatureIds = Array.from(entry.literatureIds).sort();
        return {
          id: `ltag_${this.hash({ kind, name: normalizeKeyword(entry.name) }).slice(0, 16)}`,
          name: entry.name,
          kind,
          count: literatureIds.length,
          literatureIds,
        };
      })
      .filter(tag => tag.count > 0);
  }

  private buildMergedLiteratureTags(
    papers: LiteratureRecord[],
    nodes: AutoResearchLiteratureNode[],
    outerTags: OuterTagsConfig
  ): AutoResearchLiteratureTag[] {
    if (!outerTags || !Array.isArray(outerTags.mergedTags)) return [];
    const nodeByKey = new Map(nodes.map(node => [node.key, node]));
    const nodeIdByRawKey = new Map<string, string>();
    for (const node of nodes) {
      for (const rawKey of [node.key, normalizeKeyword(node.key), normalizeKeyword(node.doi), normalizeKeyword(node.title)]) {
        if (rawKey) nodeIdByRawKey.set(rawKey, node.id);
      }
    }
    return outerTags.mergedTags.map(tag => {
      const sourceKeywords = this.uniqueStrings(splitKeywordInput(tag.originalKeywords).map(normalizeKeyword));
      let literatureIds = this.uniqueStrings((Array.isArray(tag.literatureIds) ? tag.literatureIds : [])
        .map(item => nodeIdByRawKey.get(String(item)) || nodeIdByRawKey.get(normalizeKeyword(String(item))) || ''));
      if (literatureIds.length === 0 && sourceKeywords.length > 0) {
        literatureIds = this.uniqueStrings(papers.map(paper => {
          const node = nodeByKey.get(this.getLiteratureRecordKey(paper));
          if (!node) return '';
          const paperKeywords = getPaperKeywords(paper).map(normalizeKeyword);
          return paperKeywords.some(keyword => sourceKeywords.includes(keyword)) ? node.id : '';
        }));
      }
      const cleanName = this.cleanText(tag.name, 160);
      return {
        id: `ltag_${this.hash({ kind: 'mergedTag', name: normalizeKeyword(cleanName), sourceKeywords }).slice(0, 16)}`,
        name: cleanName,
        kind: 'mergedTag' as const,
        count: literatureIds.length,
        literatureIds,
        sourceKeywords,
      };
    }).filter(tag => tag.name && tag.count > 0);
  }

  private getLiteratureRecordKey(paper: LiteratureRecord): string {
    return this.cleanText(paper.id, 240)
      || this.cleanText(paper.doi, 240)
      || this.cleanText(paper.title, 500);
  }

  private formatAuthors(authors: LiteratureRecord['authors']): string {
    if (!Array.isArray(authors)) return '';
    return authors
      .map(author => typeof author === 'string' ? author : this.cleanText(author.name, 160))
      .filter(Boolean)
      .join(', ')
      .slice(0, 500);
  }

  private extractLiteratureCategories(paper: LiteratureRecord): string[] {
    const record = paper as Record<string, unknown>;
    return this.uniqueStrings([
      ...splitKeywordInput(record.categories),
      ...splitKeywordInput(record.documentCategories),
      ...splitKeywordInput(record.category),
    ]);
  }

  private metricLevel(score: number): AutoResearchEvaluationLevel {
    if (score >= 0.75) return 'pass';
    if (score >= 0.45) return 'warn';
    return 'fail';
  }

  private calculateGroundingScore(viewpoint: PdfWikiViewpoint, references: AutoResearchEvidenceReference[]): number {
    let score = 0;
    if (viewpoint.evidence && viewpoint.evidence.trim().length >= 30) score += 0.28;
    if (Array.isArray(viewpoint.evidenceSentences) && viewpoint.evidenceSentences.length > 0) score += 0.24;
    if (references.length > 0) score += 0.24;
    if (Array.isArray(viewpoint.inTextCitations) && viewpoint.inTextCitations.length > 0) score += 0.14;
    if (viewpoint.sourcePdfId || viewpoint.sourcePdfName) score += 0.1;
    return this.roundScore(score);
  }

  private toEvidenceReference(ref: PdfWikiReference): AutoResearchEvidenceReference {
    return {
      id: ref.id || this.hash(ref).slice(0, 16),
      raw: ref.raw || '',
      title: ref.title || '',
      authors: ref.authors || '',
      year: ref.year || '',
      journal: ref.journal || '',
      doi: ref.doi || '',
      sourcePdfId: ref.sourcePdfId,
      sourcePdfName: ref.sourcePdfName,
      index: ref.index,
    };
  }

  private evidenceFingerprint(item: AutoResearchEvidenceObject): string {
    const { createdAt, updatedAt, ...stable } = item;
    void createdAt;
    void updatedAt;
    return this.hash(stable);
  }

  private literatureFingerprint(item: AutoResearchLiteratureNode): string {
    const { createdAt, updatedAt, ...stable } = item;
    void createdAt;
    void updatedAt;
    return this.hash(stable);
  }

  private uniqueReferences(references: PdfWikiReference[]): PdfWikiReference[] {
    const seen = new Set<string>();
    const result: PdfWikiReference[] = [];
    for (const ref of references) {
      const key = String(ref.doi || ref.title || ref.raw || ref.id || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      result.push(ref);
    }
    return result;
  }

  private async loadState(userId: string, project?: AutoResearchProjectContext): Promise<AutoResearchState> {
    const statePath = this.getStatePath(userId);
    try {
      const parsed = JSON.parse(await fs.readFile(statePath, 'utf-8')) as Partial<AutoResearchState>;
      return this.normalizeState(parsed, userId, project);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[AutoResearch] Failed to load state for ${userId}:`, error);
      }
      return this.createEmptyState(userId, project);
    }
  }

  private async saveState(userId: string, state: AutoResearchState): Promise<void> {
    const statePath = this.getStatePath(userId);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  private async appendOperation(
    userId: string,
    state: AutoResearchState,
    input: Omit<AutoResearchOperation, 'id' | 'startedAt' | 'completedAt' | 'inputHash' | 'outputHash' | 'version' | 'replayFile'>,
    now: string
  ): Promise<AutoResearchOperation> {
    const operationInput = input.input || {};
    const operationOutput = input.output || {};
    const operation: AutoResearchOperation = {
      ...input,
      input: operationInput,
      output: operationOutput,
      toolResults: input.toolResults || [],
      id: `run_${now.replace(/[-:.TZ]/g, '')}_${this.hash({ input, now }).slice(0, 10)}`,
      startedAt: now,
      completedAt: input.status === 'started' ? undefined : now,
      inputHash: this.hash(operationInput),
      outputHash: this.hash(operationOutput),
      version: {
        app: this.getAppVersion(),
        schema: SCHEMA_VERSION,
        node: process.version,
      },
    };
    operation.replayFile = await this.writeOperationRun(userId, operation);
    state.operations.unshift(operation);
    state.updatedAt = now;
    return operation;
  }

  private async writeOperationRun(userId: string, operation: AutoResearchOperation): Promise<string> {
    const relativePath = path.join('runs', `${operation.id}.json`);
    const runPath = path.join(this.getUserDir(userId), relativePath);
    await fs.mkdir(path.dirname(runPath), { recursive: true });
    await fs.writeFile(runPath, JSON.stringify(operation, null, 2), 'utf-8');
    return relativePath.replace(/\\/g, '/');
  }

  private normalizeState(parsed: Partial<AutoResearchState>, userId: string, project?: AutoResearchProjectContext): AutoResearchState {
    const now = new Date().toISOString();
    const base = this.createEmptyState(userId, project);
    const task = parsed.task || base.task;
    const hasCompletedTaskRecords = Array.isArray(parsed.completedTaskRecords);
    const normalized: AutoResearchState = {
      version: 1,
      userId,
      projectId: this.cleanText(parsed.projectId, 160) || base.projectId,
      projectName: this.cleanText(parsed.projectName, 240) || base.projectName,
      createdAt: parsed.createdAt || now,
      updatedAt: parsed.updatedAt || now,
      task: {
        ...base.task,
        ...task,
        stages: this.ensureStages(Array.isArray(task.stages) ? task.stages : [], now),
        currentStageId: AUTO_RESEARCH_STAGE_IDS.includes(task.currentStageId as AutoResearchStageId)
          ? task.currentStageId as AutoResearchStageId
          : base.task.currentStageId,
      },
      projectMemory: Array.isArray(parsed.projectMemory) ? parsed.projectMemory : [],
      failureLessons: Array.isArray(parsed.failureLessons) ? parsed.failureLessons : [],
      evidenceLibrary: {
        objects: Array.isArray(parsed.evidenceLibrary?.objects) ? parsed.evidenceLibrary.objects : [],
        snapshots: Array.isArray(parsed.evidenceLibrary?.snapshots) ? parsed.evidenceLibrary.snapshots : [],
        lastSyncedAt: parsed.evidenceLibrary?.lastSyncedAt,
        sourceGeneratedAt: parsed.evidenceLibrary?.sourceGeneratedAt,
      },
      literatureMap: {
        nodes: Array.isArray(parsed.literatureMap?.nodes) ? parsed.literatureMap.nodes : [],
        tags: Array.isArray(parsed.literatureMap?.tags) ? parsed.literatureMap.tags : [],
        snapshots: Array.isArray(parsed.literatureMap?.snapshots) ? parsed.literatureMap.snapshots : [],
        lastSyncedAt: parsed.literatureMap?.lastSyncedAt,
      },
      researchWiki: {
        nodes: Array.isArray(parsed.researchWiki?.nodes) ? parsed.researchWiki.nodes : [],
        edges: Array.isArray(parsed.researchWiki?.edges) ? parsed.researchWiki.edges : [],
        queryPack: this.cleanText(parsed.researchWiki?.queryPack, 8000),
        updatedAt: parsed.researchWiki?.updatedAt,
      },
      operations: Array.isArray(parsed.operations) ? parsed.operations : [],
      evaluations: Array.isArray(parsed.evaluations) ? parsed.evaluations : [],
      auditReports: Array.isArray(parsed.auditReports) ? parsed.auditReports : [],
      finalReports: Array.isArray(parsed.finalReports) ? parsed.finalReports : [],
      paperDrafts: Array.isArray(parsed.paperDrafts) ? parsed.paperDrafts : [],
      completedTaskRecords: hasCompletedTaskRecords ? parsed.completedTaskRecords as AutoResearchCompletedTaskRecord[] : [],
    };
    if (!hasCompletedTaskRecords && normalized.finalReports.length) {
      normalized.completedTaskRecords = normalized.finalReports
        .map(report => this.deriveCompletedTaskRecordFromReport(normalized, report))
        .slice(0, 50);
    }
    return this.applyProjectContext(normalized, project);
  }

  private createEmptyState(userId: string, project?: AutoResearchProjectContext): AutoResearchState {
    const now = new Date().toISOString();
    const projectId = this.cleanText(project?.projectId, 160) || 'current-workspace';
    const projectName = this.cleanText(project?.projectName, 240) || '当前工作区';
    return {
      version: 1,
      userId,
      projectId,
      projectName,
      createdAt: now,
      updatedAt: now,
      task: {
        id: `task_${this.hash({ userId, projectId, now }).slice(0, 18)}`,
        title: DEFAULT_TASK_TITLE,
        topic: '',
        goal: '选题 → 文献图谱 → 假设 → 证据库 → 实验/数据计划 → 草稿 → 审稿式自检 → 修订',
        status: 'active',
        currentStageId: 'topic',
        stages: this.ensureStages([], now),
        createdAt: now,
        updatedAt: now,
      },
      projectMemory: [],
      failureLessons: [],
      evidenceLibrary: {
        objects: [],
        snapshots: [],
      },
      literatureMap: {
        nodes: [],
        tags: [],
        snapshots: [],
      },
      researchWiki: {
        nodes: [],
        edges: [],
        queryPack: '',
      },
      operations: [],
      evaluations: [],
      auditReports: [],
      finalReports: [],
      paperDrafts: [],
      completedTaskRecords: [],
    };
  }

  private ensureStages(stages: Partial<AutoResearchStage>[], now: string): AutoResearchStage[] {
    const byId = new Map(stages.map(stage => [stage.id, stage]));
    return AUTO_RESEARCH_STAGE_IDS.map((id, index) => {
      const existing = byId.get(id);
      return {
        id,
        title: STAGE_TITLES[id],
        status: existing?.status || (index === 0 ? 'active' : 'pending'),
        notes: Array.isArray(existing?.notes) ? existing!.notes.filter(Boolean).map(String) : [],
        artifacts: Array.isArray(existing?.artifacts) ? existing!.artifacts.filter(Boolean).map(String) : [],
        updatedAt: existing?.updatedAt || now,
      };
    });
  }

  private completeStage(stage: AutoResearchStage, now: string, note: string, artifact: string): AutoResearchStage {
    return {
      ...stage,
      status: 'done',
      notes: this.uniqueStrings([note, ...stage.notes]).slice(0, 20),
      artifacts: this.uniqueStrings([artifact, ...stage.artifacts]).slice(0, 50),
      updatedAt: now,
    };
  }

  private applyProjectContext(state: AutoResearchState, project?: AutoResearchProjectContext): AutoResearchState {
    const projectId = this.cleanText(project?.projectId, 160);
    const projectName = this.cleanText(project?.projectName, 240);
    if (!projectId && !projectName) return state;
    const nextProjectId = projectId || state.projectId;
    const nextProjectName = projectName || state.projectName;
    if (nextProjectId === state.projectId && nextProjectName === state.projectName) return state;
    return {
      ...state,
      projectId: nextProjectId,
      projectName: nextProjectName,
      updatedAt: new Date().toISOString(),
    };
  }

  private touchState(state: AutoResearchState, project: AutoResearchProjectContext | undefined, now: string): void {
    const projectId = this.cleanText(project?.projectId, 160);
    const projectName = this.cleanText(project?.projectName, 240);
    if (projectId) state.projectId = projectId;
    if (projectName) state.projectName = projectName;
    state.updatedAt = now;
  }

  private upsertSystemMemory(
    state: AutoResearchState,
    input: {
      kind: AutoResearchMemoryKind;
      content: string;
      source: string;
      tags: string[];
      evidenceObjectIds: string[];
      now: string;
    }
  ): void {
    const id = `mem_${this.hash({ kind: input.kind, content: input.content, source: input.source }).slice(0, 16)}`;
    const existing = state.projectMemory.findIndex(item => item.id === id);
    const item: AutoResearchMemoryItem = {
      id,
      kind: input.kind,
      content: input.content,
      source: input.source,
      tags: input.tags,
      evidenceObjectIds: input.evidenceObjectIds,
      operationIds: [],
      createdAt: existing >= 0 ? state.projectMemory[existing].createdAt : input.now,
      updatedAt: input.now,
    };
    if (existing >= 0) state.projectMemory[existing] = item;
    else state.projectMemory.unshift(item);
  }

  private getStatePath(userId: string): string {
    return path.join(this.getUserDir(userId), 'state.json');
  }

  private getUserDir(userId: string): string {
    return path.join(this.dataDir, 'autoresearch', sanitizeUserId(userId));
  }

  private getAppVersion(): string {
    return process.env.npm_package_version || '1.0.0';
  }

  private uniqueStrings(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const clean = this.cleanText(value, 4000);
      const key = clean.toLowerCase();
      if (!clean || seen.has(key)) continue;
      seen.add(key);
      result.push(clean);
    }
    return result;
  }

  private normalizeClaim(value: string): string {
    return this.cleanText(value, 500)
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.,;:，。；：()[\]{}]/g, '')
      .trim();
  }

  private normalizeSearchText(value: string): string {
    return this.cleanText(value, 8000)
      .toLowerCase()
      .replace(/[₂]/g, '2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private cleanText(value: unknown, maxLength: number): string {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
  }

  private cleanMarkdown(value: unknown, maxLength: number): string {
    return String(value || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim()
      .slice(0, maxLength);
  }

  private roundScore(value: number): number {
    return Math.round(this.clamp01(value) * 1000) / 1000;
  }

  private clamp01(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(1, value));
  }

  private hash(value: unknown): string {
    return crypto.createHash('sha256').update(this.stableStringify(value)).digest('hex');
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => this.stableStringify(item)).join(',')}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(',')}}`;
  }
}

export default AutoResearchManager;
