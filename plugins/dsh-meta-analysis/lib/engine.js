/**
 * Meta analysis engine: the single data path for the agent tools, the
 * /api/dsh-meta routes, and (indirectly) the GUI panel. Owns a MetaStore and
 * delegates every statistical computation to the pure stats module.
 */

import { MetaStore } from './store.js'
import * as stats from './stats.js'

export { MetaStore }

/** The engine: store + stats facade. */
export class MetaEngine {
  /**
   * @param options - dataRoot, userId, projectId (defaults resolved lazily).
   */
  constructor(options = {}) {
    this.store = new MetaStore({ dataRoot: options.dataRoot, userId: options.userId })
    this.projectId = options.projectId
  }

  /** Resolve the current project (auto-create the default one). */
  project() {
    return this.store.getProject(this.projectId)
  }

  /** Current project id (creating the default project when needed). */
  currentProjectId() {
    return this.project().id
  }

  // ------------------------------------------------------------ facade

  /** Project list + current id (tool-friendly). */
  overview() {
    const project = this.project()
    return {
      projectId: project.id,
      projectName: project.name,
      projects: this.store.listProjects(),
      sourceCount: (project.sources || []).length,
      analysisCount: (project.analyses || []).length,
      dataRoot: this.store.dataRoot,
    }
  }

  /** List sources with summaries. */
  listSources() {
    const project = this.project()
    return (project.sources || []).map(source => ({
      pdfId: source.pdfId,
      title: source.title,
      authors: source.authors,
      year: source.year,
      parser: source.parser,
      needsReview: !!source.needsReview,
      rowCount: source.dataTable && Array.isArray(source.dataTable.rows) ? source.dataTable.rows.length : 0,
      columnCount: source.dataTable && Array.isArray(source.dataTable.columns) ? source.dataTable.columns.length : 0,
      figureCount: Array.isArray(source.figures) ? source.figures.length : 0,
    }))
  }

  /** Build a flattened dataset from the given (or all) sources. */
  datasetFromSources(sources) {
    return stats.datasetFromSources(sources)
  }

  /** Inspect: variables, candidate outcomes, moderators, recommended config. */
  inspect(dataset, projectId, sourcePdfIds) {
    const variables = stats.inferVariables(dataset)
    const candidates = stats.inferCandidateOutcomes(dataset)
    const studyIdColumn = stats.pickExistingColumn(dataset.columns, ['Study#', 'study_id', 'Study ID', 'study', '论文ID', '研究ID', 'studyid', '研究编号', 'StudyID']) || 'Study#'
    const moderators = stats.inferModeratorCandidates(variables, candidates)
    const manualReviewColumn = stats.pickExistingColumn(dataset.columns, ['needs_manual_review', 'needsManualReview', '需人工复核', '人工复核'])
    const recommendedModerators = moderators
      .filter(item => stats.moderatorPreferenceScore(item.name) > 0)
      .slice(0, 6)
      .map(item => item.name)
    const subgroupColumns = moderators
      .filter(item => stats.moderatorPreferenceScore(item.name) > 0)
      .filter(item => item.type === 'categorical' || item.uniqueCount <= 8)
      .slice(0, 4)
      .map(item => item.name)
    const warnings = stats.buildInspectionWarnings(dataset, candidates)

    return {
      projectId,
      sourcePdfIds,
      dataset: {
        pdfCount: dataset.pdfCount,
        tableCount: dataset.tables.length,
        rowCount: dataset.rows.length,
        columnCount: dataset.columns.length,
      },
      variables,
      candidateOutcomes: candidates,
      moderatorCandidates: moderators,
      effectMeasures: stats.EFFECT_MEASURES,
      recommendedConfig: {
        model: 'random',
        method: 'REML',
        studyIdColumn,
        clusterBy: studyIdColumn,
        moderatorColumns: recommendedModerators,
        subgroupColumns,
        columnPreprocess: [],
        minCompleteRows: 2,
        controlRules: [],
        excludeManualReview: true,
        manualReviewColumn,
        outcomes: candidates.map(candidate => ({
          id: candidate.id,
          label: candidate.label,
          measure: candidate.measure,
          ...candidate.mapping,
          moderators: recommendedModerators,
          direction: 1,
        })),
      },
      warnings,
    }
  }

  /** Run the analysis and persist it into the project. */
  run(dataset, config, options = {}) {
    const normalizedConfig = normalizeRunConfig(config)
    const run = stats.runMetaAnalysisOnDataset(dataset, normalizedConfig, options)
    return run
  }

  /** List analysis summaries. */
  listAnalyses() {
    const project = this.project()
    return (project.analyses || []).map(a => ({
      analysisId: a.analysisId,
      createdAt: a.createdAt,
      dataset: a.dataset,
      effectRowCount: (a.effectRows || []).length,
      skippedCount: a.skippedCount || 0,
      summaryCount: (a.summaries || []).length,
      outcomeLabels: (a.summaries || []).map(s => s.outcomeLabel),
    }))
  }
}

/** Normalize a run config with defaults (outcome mapping cleaned). */
function normalizeRunConfig(config) {
  const outcomes = Array.isArray(config?.outcomes) ? config.outcomes : []
  return {
    outcomes: outcomes.map(outcome => ({
      id: String(outcome.id ?? ''),
      label: String(outcome.label ?? ''),
      measure: stats.normalizeEffectMeasure(outcome.measure),
      treatmentMean: String(outcome.treatmentMean ?? ''),
      treatmentSd: String(outcome.treatmentSd ?? ''),
      treatmentN: String(outcome.treatmentN ?? ''),
      controlMean: String(outcome.controlMean ?? ''),
      controlSd: String(outcome.controlSd ?? ''),
      controlN: String(outcome.controlN ?? ''),
      moderators: Array.isArray(outcome.moderators) ? outcome.moderators.map(String) : [],
      direction: Number(outcome.direction) || 1,
    })).filter(outcome => outcome.treatmentMean && outcome.controlMean),
    model: config?.model === 'fixed' || config?.model === 'mixed' ? config.model : 'random',
    method: String(config?.method ?? 'REML'),
    studyIdColumn: String(config?.studyIdColumn ?? ''),
    clusterBy: String(config?.clusterBy ?? ''),
    moderatorColumns: Array.isArray(config?.moderatorColumns) ? config.moderatorColumns.map(String).filter(Boolean) : [],
    subgroupColumns: Array.isArray(config?.subgroupColumns) ? config.subgroupColumns.map(String).filter(Boolean) : [],
    columnPreprocess: Array.isArray(config?.columnPreprocess) ? config.columnPreprocess : [],
    minCompleteRows: Number(config?.minCompleteRows) || 2,
    controlRules: Array.isArray(config?.controlRules) ? config.controlRules : [],
    excludeManualReview: !!config?.excludeManualReview,
    manualReviewColumn: String(config?.manualReviewColumn ?? ''),
  }
}
