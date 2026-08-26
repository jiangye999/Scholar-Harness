/**
 * Meta analysis statistics engine. Faithful port of the Scholar Harness
 * meta-analysis route's core algorithms (effect sizes, fixed/random pooling,
 * heterogeneity, subgroups, mean-only bootstrap, R script and report
 * generation). Pure JS — no external runtime needed.
 */

import { createHash } from 'node:crypto'

// ---------------------------------------------------------------- types

export const EFFECT_MEASURES = [
  { id: 'lnRR', name: 'lnRR（响应比，需 SD/n）' },
  { id: 'MD', name: 'MD（均值差，需 SD/n）' },
  { id: 'SMD', name: 'SMD（标准化均值差，Hedges g）' },
  { id: 'lnRR_mean_only', name: 'lnRR（仅均值，等权重聚类 bootstrap）' },
  { id: 'MD_mean_only', name: 'MD（仅均值，等权重聚类 bootstrap）' },
]

/** Statistical role keys in the outcome mapping. */
export const STAT_ROLE_KEYS = [
  'treatmentMean', 'treatmentSd', 'treatmentN',
  'controlMean', 'controlSd', 'controlN',
]

/** Suffix patterns for auto-detecting stat columns (Scholar Harness ports). */
export const STAT_SUFFIXES = {
  treatmentMean: ['_tmean', '_t_mean', '_mean_t', '_treat_mean', '_treatment_mean', '_TMean', '_TreatmentMean', '处理组均值', '处理均值', 't均值'],
  treatmentSd: ['_tsd', '_t_sd', '_sd_t', '_treat_sd', '_treatment_sd', '_TSd', '_TreatmentSD', '处理组SD', '处理SD', 'tSD'],
  treatmentN: ['_tn', '_t_n', '_n_t', '_treat_n', '_treatment_n', '_TN', '_TreatmentN', '处理组n', '处理n', 'tN', '处理组样本量'],
  controlMean: ['_cmean', '_ckmean', '_ck_mean', '_c_mean', '_mean_c', '_control_mean', '_CKMean', '_ControlMean', '对照组均值', '对照均值', 'ck均值'],
  controlSd: ['_csd', '_cksd', '_ck_sd', '_c_sd', '_sd_c', '_control_sd', '_CKSD', '_ControlSD', '对照组SD', '对照SD', 'ckSD'],
  controlN: ['_cn', '_ckn', '_ck_n', '_c_n', '_n_c', '_control_n', '_CKN', '_ControlN', '对照组n', '对照n', 'ckN', '对照组样本量'],
}

export const ROLE_LABELS = {
  treatmentMean: '处理组均值',
  treatmentSd: '处理组SD',
  treatmentN: '处理组n',
  controlMean: '对照组均值',
  controlSd: '对照组SD',
  controlN: '对照组n',
}

const STUDY_ID_CANDIDATES = ['Study#', 'study_id', 'Study ID', 'study', '论文ID', '研究ID', 'studyid', '研究编号', 'StudyID']

const TRACE_COLUMNS = new Set([
  'PDF ID', 'PDF标题', 'PDF文件名', 'PDFID', '_table_id', '_row_index',
  'meta_ai_match_key', 'meta_ai_contrast_id', 'meta_ai_contrast_label',
  'control_for_contrast', 'controlForContrast', 'Obs#', 'obs_id', 'ObsID', '_row_index',
])

const META_SUBGROUP_MIN_EFFECTS = 3
const META_SUBGROUP_MIN_STUDIES = 2
const META_SUBGROUP_MAX_PLOT_LEVELS = 12
const MEAN_ONLY_BOOTSTRAP_ITERATIONS = 9999

// ---------------------------------------------------------------- helpers

export function isMeanOnlyMeasure(measure) {
  return measure === 'lnRR_mean_only' || measure === 'MD_mean_only'
}

export function getRequiredOutcomeRoles(measure) {
  if (isMeanOnlyMeasure(measure)) return ['treatmentMean', 'controlMean']
  return ['treatmentMean', 'treatmentSd', 'treatmentN', 'controlMean', 'controlSd', 'controlN']
}

export function normalizeEffectMeasure(value) {
  const v = String(value ?? '').trim()
  if (EFFECT_MEASURES.some(m => m.id === v)) return v
  if (v === 'lnRR_mean-only' || v === 'lnrr_mean_only') return 'lnRR_mean_only'
  if (v === 'MD_mean-only' || v === 'md_mean_only') return 'MD_mean_only'
  return 'lnRR'
}

function normalizeColumnForMatching(column) {
  return String(column ?? '').trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
}

function parseNumeric(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN
  if (value === null || value === undefined) return Number.NaN
  const text = String(value).trim()
  if (!text) return Number.NaN
  const cleaned = text.replace(/,/g, '').replace(/[±±]/g, '')
  const num = Number(cleaned)
  if (Number.isFinite(num)) return num
  // Tolerate "1.23 ± 0.45" style: take the first number.
  const match = /-?\d+(?:\.\d+)?/.exec(text)
  if (match) {
    const first = Number(match[0])
    if (Number.isFinite(first)) return first
  }
  return Number.NaN
}

function isBlank(value) {
  return value === null || value === undefined || String(value).trim() === ''
}

function stringifyCell(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = stringifyCell(value)
    if (text) return text
  }
  return undefined
}

function mean(values) {
  const finite = values.filter(v => Number.isFinite(v))
  if (!finite.length) return Number.NaN
  return finite.reduce((sum, v) => sum + v, 0) / finite.length
}

function sampleSd(values) {
  const finite = values.filter(v => Number.isFinite(v))
  if (finite.length < 2) return Number.NaN
  const avg = mean(finite)
  const variance = finite.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / (finite.length - 1)
  return variance >= 0 ? Math.sqrt(variance) : Number.NaN
}

function quantileSorted(sortedValues, probability) {
  if (!sortedValues.length) return Number.NaN
  if (sortedValues.length === 1) return sortedValues[0]
  const position = (sortedValues.length - 1) * probability
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  if (lower === upper) return sortedValues[lower]
  const weight = position - lower
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight
}

function normalCdf(z) {
  // Abramowitz & Stegun approximation.
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989422804014327 * Math.exp((-z * z) / 2)
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  if (z > 0) return 1 - p
  return p
}

function createSeededRandom(values) {
  let seed = 2166136261
  values.forEach(value => {
    const scaled = Math.floor(Math.abs(value) * 1000000)
    seed ^= scaled
    seed = Math.imul(seed, 16777619)
  })
  return () => {
    seed += 0x6D2B79F5
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function bootstrapMeans(values, iterations) {
  if (!values.length) return []
  if (values.length === 1) return Array.from({ length: Math.max(1, iterations) }, () => values[0])
  const rng = createSeededRandom(values)
  const results = []
  for (let i = 0; i < iterations; i += 1) {
    let total = 0
    for (let j = 0; j < values.length; j += 1) {
      const index = Math.floor(rng() * values.length)
      total += values[Math.max(0, Math.min(values.length - 1, index))]
    }
    results.push(total / values.length)
  }
  return results.sort((a, b) => a - b)
}

// ---------------------------------------------------------------- dataset

export function flattenIntegratedTables(tables) {
  const rows = []
  const columns = new Set()
  const pdfIds = new Set()

  for (const table of tables || []) {
    if (table.isPlaceholder) continue
    pdfIds.add(table.pdfId)
    for (const column of table.columns || []) columns.add(column)
    columns.add('PDF ID')
    columns.add('PDF标题')
    columns.add('PDF文件名')

    ;(table.rows || []).forEach((row, index) => {
      const merged = {
        ...row,
        'PDF ID': firstNonEmpty(row['PDF ID'], row.PDFID, table.pdfId),
        PDF标题: firstNonEmpty(row.PDF标题, row['Study#'], table.pdfTitle),
        PDF文件名: firstNonEmpty(row.PDF文件名, table.pdfName),
        _table_id: table.id,
        _row_index: index + 1,
      }
      Object.keys(merged).forEach(column => columns.add(column))
      rows.push(merged)
    })
  }

  return {
    tables,
    rows,
    columns: Array.from(columns),
    pdfCount: pdfIds.size,
  }
}

/** Build a flattened dataset from the store's sources. */
export function datasetFromSources(sources) {
  const tables = (sources || []).map(source => {
    const table = source.dataTable && typeof source.dataTable === 'object' ? source.dataTable : { columns: [], rows: [] }
    return {
      id: source.pdfId,
      pdfId: source.pdfId,
      pdfName: source.title || source.originalName || source.pdfId,
      pdfTitle: source.title || source.originalName || source.pdfId,
      columns: Array.isArray(table.columns) ? table.columns : [],
      rows: Array.isArray(table.rows) ? table.rows : [],
      rowCount: Array.isArray(table.rows) ? table.rows.length : 0,
      isPlaceholder: !!(table.isPlaceholder || (!table.columns?.length && !table.rows?.length)),
    }
  })
  return flattenIntegratedTables(tables)
}

// ---------------------------------------------------------------- inspect

export function inferVariables(dataset) {
  return dataset.columns.map(column => {
    const rawValues = dataset.rows.map(row => row[column])
    const nonMissingValues = rawValues.filter(value => !isBlank(value))
    const numericValues = nonMissingValues.map(parseNumeric).filter(v => Number.isFinite(v))
    const sampleValues = Array.from(new Set(nonMissingValues.map(stringifyCell).filter(Boolean))).slice(0, 6)
    const uniqueCount = new Set(nonMissingValues.map(stringifyCell)).size
    const numericRatio = nonMissingValues.length > 0 ? numericValues.length / nonMissingValues.length : 0
    const type = nonMissingValues.length === 0 ? 'empty' : (numericRatio >= 0.75 ? 'numeric' : 'categorical')
    return {
      name: column,
      type,
      nonMissingCount: nonMissingValues.length,
      missingCount: rawValues.length - nonMissingValues.length,
      numericCount: numericValues.length,
      uniqueCount,
      sampleValues,
    }
  })
}

function matchStatColumn(column) {
  const normalized = normalizeColumnForMatching(column)
  for (const role of STAT_ROLE_KEYS) {
    for (const suffix of STAT_SUFFIXES[role]) {
      const normalizedSuffix = normalizeColumnForMatching(suffix)
      if (!normalized.endsWith(normalizedSuffix)) continue
      const rawPrefix = column.slice(0, Math.max(0, column.length - suffix.length)).replace(/[_\s-]+$/g, '')
      const normalizedPrefix = normalized.slice(0, normalized.length - normalizedSuffix.length).replace(/[_\s-]+$/g, '')
      if (!normalizedPrefix) continue
      return { prefix: normalizedPrefix, rawPrefix: rawPrefix || normalizedPrefix, role }
    }
  }
  return null
}

function hasCompleteOutcomeValues(row, mapping, measure) {
  const required = getRequiredOutcomeRoles(measure)
  return required.every(role => {
    const column = mapping[role]
    if (!column) return false
    return Number.isFinite(parseNumeric(row[column]))
  })
}

export function inferCandidateOutcomes(dataset) {
  const bucket = new Map()
  for (const column of dataset.columns) {
    const match = matchStatColumn(column)
    if (!match) continue
    const existing = bucket.get(match.prefix) || { rawPrefix: match.rawPrefix }
    existing[match.role] = column
    bucket.set(match.prefix, existing)
  }

  const candidates = []
  for (const [prefix, mapping] of bucket.entries()) {
    if (!STAT_ROLE_KEYS.every(role => typeof mapping[role] === 'string' && !!mapping[role].trim())) continue
    const cleanMapping = mapping
    const completeRows = dataset.rows.filter(row => hasCompleteOutcomeValues(row, cleanMapping, 'MD')).length
    const positiveRows = dataset.rows.filter(row => hasCompleteOutcomeValues(row, cleanMapping, 'lnRR')).length
    const label = normalizeOutcomeLabel(mapping.rawPrefix || prefix)
    const warnings = []
    if (completeRows < 3) warnings.push('完整均值/SD/n 行数少于 3，Meta 模型稳定性不足')
    if (positiveRows < completeRows) warnings.push('部分行均值非正，lnRR 会自动跳过这些行')

    candidates.push({
      id: normalizeOutcomeId(prefix),
      label,
      measure: positiveRows >= Math.max(3, Math.ceil(completeRows * 0.8)) ? 'lnRR' : 'SMD',
      mapping: cleanMapping,
      completeRows,
      totalRows: dataset.rows.length,
      warnings,
    })
  }

  return candidates.sort((a, b) => b.completeRows - a.completeRows || a.label.localeCompare(b.label, 'zh-CN'))
}

function normalizeOutcomeId(prefix) {
  return String(prefix ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'outcome'
}

function normalizeOutcomeLabel(prefix) {
  return String(prefix ?? '').trim().replace(/[_\s]+/g, ' ').slice(0, 60) || '结果变量'
}

export function inferModeratorCandidates(variables, outcomes) {
  const statColumns = new Set()
  outcomes.forEach(outcome => {
    STAT_ROLE_KEYS.forEach(role => statColumns.add(outcome.mapping[role]))
  })

  return variables
    .filter(variable => {
      if (variable.type === 'empty') return false
      if (statColumns.has(variable.name)) return false
      if (TRACE_COLUMNS.has(variable.name)) return false
      if (isMetaAnalysisStructuralVariable(variable.name)) return false
      if (/证据|原文|abstract|全文|标题|filename|file|pdf/i.test(variable.name)) return false
      if (/mean|sd|se|sem|n$|_n$|ck|control|treat|tmean|tsd|ckmean|cksd/i.test(variable.name)) return false
      if (variable.nonMissingCount < 2) return false
      if (variable.type === 'categorical') return variable.uniqueCount >= 2 && variable.uniqueCount <= Math.max(20, Math.ceil(variable.nonMissingCount * 0.7))
      return variable.uniqueCount >= 2
    })
    .sort((a, b) => {
      const preferredA = moderatorPreferenceScore(a.name)
      const preferredB = moderatorPreferenceScore(b.name)
      if (preferredA !== preferredB) return preferredB - preferredA
      return b.nonMissingCount - a.nonMissingCount
    })
    .slice(0, 40)
}

export function moderatorPreferenceScore(name) {
  const text = name.toLowerCase()
  let score = 0
  if (/处理|treatment|fertili|施肥|作物|crop|soil|texture|气候|climate|experiment/.test(text)) score += 5
  if (/n input|nitrogen|减氮|period|持续|天数|temp|温|rain|precip|ph|soc|som|tn|cn|c\/n|wfps|whc|bulk|lat|long/.test(text)) score += 4
  if (/study|obs/.test(text)) score -= 5
  return score
}

function isMetaAnalysisStructuralVariable(name) {
  const compact = String(name || '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '')
  if (!compact) return true
  return [
    'rowindex', 'index', 'obs', 'obsid', 'study', 'studyid', 'pdfid', 'id',
    '序号', '行号', '编号', '观测编号', '研究编号',
  ].includes(compact)
}

export function buildInspectionWarnings(dataset, candidates) {
  const warnings = []
  if (dataset.rows.length < 3) warnings.push('整合数据行数少于 3，通常不足以完成稳健 Meta 分析。')
  if (candidates.length === 0) warnings.push('未自动识别到完整的处理组/对照组均值、SD 和 n 字段，请在向导中手动映射。')
  candidates.forEach(candidate => {
    candidate.warnings.forEach(warning => warnings.push(`${candidate.label}: ${warning}`))
  })
  return Array.from(new Set(warnings))
}

export function pickExistingColumn(columns, candidates) {
  for (const candidate of candidates) {
    if (columns.includes(candidate)) return candidate
  }
  return undefined
}

// ---------------------------------------------------------------- effect rows

function normalizeDirection(direction) {
  const num = Number(direction)
  return Number.isFinite(num) && num < 0 ? -1 : 1
}

function parseOutcomeNumbers(row, outcome, measure) {
  const values = {}
  const requiredRoles = getRequiredOutcomeRoles(measure)
  for (const role of STAT_ROLE_KEYS) {
    const column = outcome[role]
    if (!column) {
      if (requiredRoles.includes(role)) return { ok: false, reason: `${ROLE_LABELS[role]}未映射` }
      continue
    }
    const value = parseNumeric(row[column])
    if (!Number.isFinite(value)) {
      if (requiredRoles.includes(role)) return { ok: false, reason: `${ROLE_LABELS[role]}缺失或不是数值` }
      continue
    }
    values[role] = value
  }

  if (!Number.isFinite(values.treatmentMean) || !Number.isFinite(values.controlMean)) {
    return { ok: false, reason: '处理组或对照组均值缺失' }
  }
  if (!isMeanOnlyMeasure(measure)) {
    if ((values.treatmentN || 0) < 2 || (values.controlN || 0) < 2) return { ok: false, reason: '处理组或对照组 n 小于 2' }
    if ((values.treatmentSd || 0) < 0 || (values.controlSd || 0) < 0) return { ok: false, reason: 'SD 不能为负数' }
  }
  return { ok: true, values }
}

export function calculateEffectSize(values, measure, direction) {
  const tm = values.treatmentMean
  const tsd = values.treatmentSd ?? Number.NaN
  const tn = values.treatmentN ?? Number.NaN
  const cm = values.controlMean
  const csd = values.controlSd ?? Number.NaN
  const cn = values.controlN ?? Number.NaN

  if (measure === 'lnRR_mean_only') {
    if (tm <= 0 || cm <= 0) return { ok: false, reason: 'mean-only lnRR 要求处理组和对照组均值均大于 0' }
    return { ok: true, yi: direction * Math.log(tm / cm), vi: Number.NaN }
  }

  if (measure === 'MD_mean_only') {
    return { ok: true, yi: direction * (tm - cm), vi: Number.NaN }
  }

  if (measure === 'lnRR') {
    if (tm <= 0 || cm <= 0) return { ok: false, reason: 'lnRR 要求处理组和对照组均值均大于 0' }
    const yi = direction * Math.log(tm / cm)
    const vi = (tsd * tsd) / (tn * tm * tm) + (csd * csd) / (cn * cm * cm)
    if (!Number.isFinite(vi) || vi <= 0) return { ok: false, reason: 'lnRR 方差无效，请检查 SD/n/均值' }
    return { ok: true, yi, vi }
  }

  if (measure === 'MD') {
    const yi = direction * (tm - cm)
    const vi = (tsd * tsd) / tn + (csd * csd) / cn
    if (!Number.isFinite(vi) || vi <= 0) return { ok: false, reason: 'MD 方差无效，请检查 SD/n' }
    return { ok: true, yi, vi }
  }

  // SMD (Hedges' g)
  const df = tn + cn - 2
  if (df <= 0) return { ok: false, reason: 'SMD 自由度无效' }
  const pooledVariance = (((tn - 1) * tsd * tsd) + ((cn - 1) * csd * csd)) / df
  if (!Number.isFinite(pooledVariance) || pooledVariance <= 0) return { ok: false, reason: 'SMD 合并标准差无效' }
  const d = (tm - cm) / Math.sqrt(pooledVariance)
  const correction = 1 - (3 / (4 * df - 1))
  const yi = direction * correction * d
  const vi = (tn + cn) / (tn * cn) + (yi * yi) / (2 * (tn + cn - 2))
  if (!Number.isFinite(vi) || vi <= 0) return { ok: false, reason: 'SMD 方差无效' }
  return { ok: true, yi, vi }
}

function formatEffectLabel(measure, yi) {
  const value = Number.isFinite(yi) ? yi.toFixed(3) : 'NaN'
  const names = { lnRR: 'lnRR', MD: 'MD', SMD: 'SMD (Hedges g)', lnRR_mean_only: 'lnRR(仅均值)', MD_mean_only: 'MD(仅均值)' }
  return `${names[measure] || measure} = ${value}`
}

function applyColumnPreprocess(value, preprocess) {
  if (!preprocess || preprocess.type !== 'rangeGroups') return undefined
  const num = parseNumeric(value)
  if (!Number.isFinite(num)) return undefined
  for (const group of preprocess.groups || []) {
    let inside = true
    if (group.min !== undefined) inside = inside && (group.includeMin ? num >= group.min : num > group.min)
    if (group.max !== undefined) inside = inside && (group.includeMax ? num <= group.max : num < group.max)
    if (inside) return group.label
  }
  return preprocess.unmatchedLabel || `其他`
}

export function buildEffectRows(dataset, config) {
  const effectRows = []
  const skippedRows = []
  const preprocessByColumn = new Map((config.columnPreprocess || []).map(item => [item.column, item]))

  dataset.rows.forEach((row, rowIndex) => {
    if (config.excludeManualReview && config.manualReviewColumn && isManualReviewRequired(row[config.manualReviewColumn])) {
      config.outcomes.forEach(outcome => {
        skippedRows.push({
          outcomeId: outcome.id || '',
          rowIndex: rowIndex + 1,
          studyId: stringifyCell(firstNonEmpty(row[config.studyIdColumn], row['Study#'], row.PDF标题, row.PDF文件名, row['PDF ID'])) || `Study_${rowIndex + 1}`,
          reason: `${config.manualReviewColumn}=true，已按主分析规则排除`,
        })
      })
      return
    }
    for (const outcome of config.outcomes) {
      const measure = normalizeEffectMeasure(outcome.measure || 'lnRR')
      const studyId = stringifyCell(firstNonEmpty(row[config.studyIdColumn], row['Study#'], row.PDF标题, row.PDF文件名, row['PDF ID'])) || `Study_${rowIndex + 1}`
      const clusterId = stringifyCell(firstNonEmpty(row[config.clusterBy], row.meta_ai_match_key, studyId)) || studyId
      const parsed = parseOutcomeNumbers(row, outcome, measure)
      if (!parsed.ok) {
        skippedRows.push({ outcomeId: outcome.id || '', rowIndex: rowIndex + 1, studyId, reason: parsed.reason })
        continue
      }

      const calculated = calculateEffectSize(parsed.values, measure, normalizeDirection(outcome.direction))
      if (!calculated.ok) {
        skippedRows.push({ outcomeId: outcome.id || '', rowIndex: rowIndex + 1, studyId, reason: calculated.reason })
        continue
      }

      const moderatorNames = Array.from(new Set([
        ...(config.moderatorColumns || []),
        ...(config.subgroupColumns || []),
        ...(outcome.moderators || []),
      ]))
      const moderators = {}
      moderatorNames.forEach(column => {
        if (!column) return
        const processed = applyColumnPreprocess(row[column], preprocessByColumn.get(column))
        if (processed !== undefined) {
          moderators[column] = processed
          return
        }
        const numeric = parseNumeric(row[column])
        moderators[column] = Number.isFinite(numeric) ? numeric : stringifyCell(row[column])
      })

      effectRows.push({
        outcome_id: outcome.id || normalizeOutcomeId(outcome.label || outcome.treatmentMean),
        outcome_label: outcome.label || normalizeOutcomeLabel(outcome.id || outcome.treatmentMean),
        measure,
        study_id: studyId,
        cluster_id: clusterId,
        contrast_id: stringifyCell(row.meta_ai_contrast_id) || 'default',
        contrast_label: stringifyCell(row.meta_ai_contrast_label || row.control_for_contrast || row.controlForContrast) || '默认对照',
        pdf_id: stringifyCell(row['PDF ID']),
        pdf_title: stringifyCell(row.PDF标题),
        pdf_file: stringifyCell(row.PDF文件名),
        row_index: rowIndex + 1,
        obs_id: stringifyCell(firstNonEmpty(row['Obs#'], row.obs_id, row.ObsID, row._row_index)) || String(rowIndex + 1),
        yi: calculated.yi,
        vi: calculated.vi,
        sei: Number.isFinite(calculated.vi) && calculated.vi > 0 ? Math.sqrt(calculated.vi) : Number.NaN,
        weight: Number.isFinite(calculated.vi) && calculated.vi > 0 ? 1 / calculated.vi : 1,
        treatment_mean: parsed.values.treatmentMean,
        treatment_sd: parsed.values.treatmentSd ?? Number.NaN,
        treatment_n: parsed.values.treatmentN ?? Number.NaN,
        control_mean: parsed.values.controlMean,
        control_sd: parsed.values.controlSd ?? Number.NaN,
        control_n: parsed.values.controlN ?? Number.NaN,
        effect_label: formatEffectLabel(measure, calculated.yi),
        source: stringifyCell(row.数据来源),
        location: stringifyCell(row['页码/位置']),
        evidence: stringifyCell(row.证据原文),
        moderators,
      })
    }
  })

  return { effectRows, skippedRows }
}

function isManualReviewRequired(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) return false
  return text === 'true' || text === '1' || text === 'yes' || text === 'y' || text === '需要' || text === '是'
}

// ---------------------------------------------------------------- summaries

export function summarizeEffects(effectRows) {
  const byOutcome = new Map()
  effectRows.forEach(row => {
    const key = row.outcome_id
    byOutcome.set(key, [...(byOutcome.get(key) || []), row])
  })
  return Array.from(byOutcome.entries())
    .map(([outcomeId, rows]) => summarizeEffectGroup(outcomeId, rows))
    .sort((a, b) => b.k - a.k)
}

export function summarizeSubgroups(effectRows, subgroupColumns) {
  const selectedColumns = Array.from(new Set((subgroupColumns || []).filter(Boolean)))
  if (selectedColumns.length === 0) return []
  const summaries = []
  const byOutcome = new Map()
  effectRows.forEach(row => {
    byOutcome.set(row.outcome_id, [...(byOutcome.get(row.outcome_id) || []), row])
  })

  byOutcome.forEach((outcomeRows, outcomeId) => {
    selectedColumns.forEach(column => {
      const byLevel = new Map()
      outcomeRows.forEach(row => {
        const raw = row.moderators ? row.moderators[column] : undefined
        const level = stringifyCell(raw)
        if (!level) return
        byLevel.set(level, [...(byLevel.get(level) || []), row])
      })
      if (byLevel.size < 2) return
      byLevel.forEach((rows, level) => {
        const studyCount = new Set(rows.map(row => row.study_id)).size
        if (rows.length < META_SUBGROUP_MIN_EFFECTS || studyCount < META_SUBGROUP_MIN_STUDIES) return
        summaries.push({
          ...summarizeEffectGroup(outcomeId, rows),
          subgroupColumn: column,
          subgroupLevel: level,
        })
      })
    })
  })

  return summaries.sort((a, b) => {
    if (a.outcomeLabel !== b.outcomeLabel) return a.outcomeLabel.localeCompare(b.outcomeLabel)
    if (a.subgroupColumn !== b.subgroupColumn) return a.subgroupColumn.localeCompare(b.subgroupColumn)
    return b.k - a.k
  })
}

export function summarizeEffectGroup(outcomeId, rows) {
  const meanOnly = rows.length > 0 && rows.every(row => isMeanOnlyMeasure(row.measure) || !Number.isFinite(row.vi) || row.vi <= 0)
  if (meanOnly) {
    const bootstrap = estimatePooledMeanOnly(rows, MEAN_ONLY_BOOTSTRAP_ITERATIONS)
    return {
      outcomeId,
      outcomeLabel: rows[0]?.outcome_label || outcomeId,
      measure: rows[0]?.measure || 'lnRR_mean_only',
      k: rows.length,
      fixed: bootstrap,
      random: bootstrap,
      heterogeneity: {
        q: Number.NaN,
        df: Math.max(0, rows.length - 1),
        i2: Number.NaN,
        tau2: Number.NaN,
      },
    }
  }
  const fixed = estimatePooled(rows, 0)
  const q = rows.reduce((sum, row) => sum + (1 / row.vi) * Math.pow(row.yi - fixed.estimate, 2), 0)
  const df = Math.max(0, rows.length - 1)
  const weights = rows.map(row => 1 / row.vi)
  const sumW = weights.reduce((sum, item) => sum + item, 0)
  const sumW2 = weights.reduce((sum, item) => sum + item * item, 0)
  const c = sumW > 0 ? sumW - (sumW2 / sumW) : 0
  const tau2 = c > 0 ? Math.max(0, (q - df) / c) : 0
  const random = estimatePooled(rows, tau2)
  const i2 = q > 0 ? Math.max(0, ((q - df) / q) * 100) : 0
  return {
    outcomeId,
    outcomeLabel: rows[0]?.outcome_label || outcomeId,
    measure: rows[0]?.measure || 'lnRR',
    k: rows.length,
    fixed,
    random,
    heterogeneity: { q, df, i2, tau2 },
  }
}

function estimatePooledMeanOnly(rows, iterations) {
  const clusterValues = new Map()
  rows.forEach((row, index) => {
    if (!Number.isFinite(row.yi)) return
    const clusterId = stringifyCell(row.cluster_id || row.study_id) || `cluster_${index + 1}`
    clusterValues.set(clusterId, [...(clusterValues.get(clusterId) || []), row.yi])
  })
  const values = Array.from(clusterValues.values())
    .map(items => mean(items.filter(v => Number.isFinite(v))))
    .filter(v => Number.isFinite(v))
  const estimate = mean(values)
  const bootstrap = bootstrapMeans(values, iterations)
  const se = sampleSd(bootstrap)
  const ciLower = quantileSorted(bootstrap, 0.025)
  const ciUpper = quantileSorted(bootstrap, 0.975)
  const z = se > 0 ? estimate / se : Number.NaN
  const p = Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : Number.NaN
  return {
    estimate,
    se,
    ciLower,
    ciUpper,
    z,
    p,
    method: 'mean-only equal-cluster non-parametric bootstrap',
    bootstrapIterations: iterations,
    clusterCount: values.length,
  }
}

function estimatePooled(rows, tau2) {
  const weights = rows.map(row => 1 / (row.vi + tau2))
  const sumW = weights.reduce((sum, item) => sum + item, 0)
  const estimate = sumW > 0
    ? rows.reduce((sum, row, index) => sum + weights[index] * row.yi, 0) / sumW
    : Number.NaN
  const se = sumW > 0 ? Math.sqrt(1 / sumW) : Number.NaN
  const z = se > 0 ? estimate / se : Number.NaN
  const p = Number.isFinite(z) ? 2 * (1 - normalCdf(Math.abs(z))) : Number.NaN
  return {
    estimate,
    se,
    ciLower: estimate - 1.96 * se,
    ciUpper: estimate + 1.96 * se,
    z,
    p,
  }
}

// ---------------------------------------------------------------- quality

export function buildRunQualityReport(dataset, effectRows, skippedRows, config) {
  const warnings = []
  const checks = []

  if (dataset.rows.length < 3) warnings.push('整合数据行数少于 3，模型稳定性不足')
  if (effectRows.length < 3) warnings.push('有效效应量行数少于 3，Meta 模型稳定性不足')
  if (skippedRows.length > 0) warnings.push(`${skippedRows.length} 行被跳过（缺均值/SD/n、均值非正或人工复核排除）`)

  const byOutcome = new Map()
  effectRows.forEach(row => {
    byOutcome.set(row.outcome_id, [...(byOutcome.get(row.outcome_id) || []), row])
  })
  byOutcome.forEach((rows, outcomeId) => {
    const studies = new Set(rows.map(row => row.study_id)).size
    checks.push({
      label: `结果「${rows[0]?.outcome_label || outcomeId}」`,
      status: rows.length >= 3 && studies >= 2 ? 'ok' : 'warn',
      message: `${rows.length} 个效应量、${studies} 个研究`,
    })
  })

  if (!config.studyIdColumn) warnings.push('未配置研究 ID 列，研究间相关性可能被高估')
  return { warnings: Array.from(new Set(warnings)), checks }
}

// ---------------------------------------------------------------- csv / r / markdown

export function buildEffectRowsCsv(effectRows) {
  const header = [
    'outcome_id', 'outcome_label', 'measure', 'study_id', 'cluster_id', 'contrast_id', 'contrast_label',
    'pdf_id', 'pdf_title', 'pdf_file', 'row_index', 'obs_id', 'yi', 'vi', 'sei', 'weight',
    'treatment_mean', 'treatment_sd', 'treatment_n', 'control_mean', 'control_sd', 'control_n',
    'effect_label', 'source', 'location', 'evidence',
  ]
  const esc = value => {
    const text = String(value ?? '')
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"'
    return text
  }
  const rows = effectRows.map(row => {
    const cells = header.map(column => {
      const value = row[column]
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
      return esc(value)
    })
    // Append moderators as extra columns.
    Object.keys(row.moderators || {}).forEach(column => {
      cells.push(esc(row.moderators[column]))
    })
    return cells.join(',')
  })
  const extraHeaders = Array.from(new Set(effectRows.flatMap(row => Object.keys(row.moderators || {}))))
  return [header.concat(extraHeaders).join(','), ...rows].join('\n')
}

export function buildMetaAnalysisRCode(config, effectRows) {
  const moderatorColumns = Array.from(new Set(effectRows.flatMap(row => Object.keys(row.moderators || {}))))
  const subgroupColumns = Array.from(new Set((config.subgroupColumns || []).filter(column => moderatorColumns.includes(column))))
  const method = config.method || 'REML'
  const script = [
    '# Meta analysis workflow (dsh-meta-analysis)',
    '# Data file: meta_effect_sizes.csv',
    'options(stringsAsFactors = FALSE)',
    'options(repos = c(CRAN = "https://cloud.r-project.org"))',
    'required_packages <- c("metafor", "ggplot2")',
    'optional_packages <- c("clubSandwich")',
    'missing_packages <- required_packages[!vapply(required_packages, requireNamespace, logical(1), quietly = TRUE)]',
    'if (length(missing_packages) > 0) stop(paste("Missing R packages:", paste(missing_packages, collapse = ", ")))',
    'library(metafor)',
    'library(ggplot2)',
    'data_path <- "meta_effect_sizes.csv"',
    'dat <- read.csv(data_path, check.names = FALSE, stringsAsFactors = FALSE, fileEncoding = "UTF-8-BOM")',
    'if (!all(c("yi", "vi", "outcome_id", "study_id") %in% names(dat))) stop("Effect-size data is missing required columns.")',
    'dat$yi <- as.numeric(dat$yi)',
    'dat$vi <- as.numeric(dat$vi)',
    'if (!"cluster_id" %in% names(dat)) dat$cluster_id <- dat$study_id',
    'dat$cluster_id[is.na(dat$cluster_id) | dat$cluster_id == ""] <- dat$study_id[is.na(dat$cluster_id) | dat$cluster_id == ""]',
    'dat$cluster_id <- as.character(dat$cluster_id)',
    'dat$mean_only <- grepl("mean_only", dat$measure, ignore.case = TRUE) | !is.finite(dat$vi) | dat$vi <= 0',
    'dat$sei <- ifelse(is.finite(dat$vi) & dat$vi > 0, sqrt(dat$vi), NA_real_)',
    'dat <- dat[is.finite(dat$yi) & (dat$mean_only | (is.finite(dat$vi) & dat$vi > 0)), , drop = FALSE]',
    `meta_model_type <- ${JSON.stringify(config.model || 'random')}`,
    `meta_method <- ${JSON.stringify(method)}`,
    `moderator_cols <- c(${moderatorColumns.map(item => JSON.stringify(item)).join(', ')})`,
    'moderator_cols <- moderator_cols[moderator_cols %in% names(dat)]',
    `subgroup_cols <- c(${subgroupColumns.map(item => JSON.stringify(item)).join(', ')})`,
    'subgroup_cols <- subgroup_cols[subgroup_cols %in% names(dat)]',
    'analysis_cols <- unique(c(moderator_cols, subgroup_cols))',
    'for (mod in analysis_cols) {',
    '  numeric_try <- suppressWarnings(as.numeric(dat[[mod]]))',
    '  if (sum(is.finite(numeric_try)) >= max(3, ceiling(sum(!is.na(dat[[mod]])) * 0.7))) {',
    '    dat[[mod]] <- numeric_try',
    '  } else {',
    '    dat[[mod]] <- as.factor(dat[[mod]])',
    '  }',
    '}',
    'quote_name <- function(x) paste0("`", gsub("`", "", x), "`")',
    'fit_main_model <- function(d) {',
    '  d$effect_uid <- seq_len(nrow(d))',
    '  if (meta_model_type == "fixed") {',
    '    return(metafor::rma(yi = yi, vi = vi, data = d, method = "FE"))',
    '  }',
    '  if (meta_model_type == "mixed" || anyDuplicated(d$cluster_id)) {',
    '    return(metafor::rma.mv(yi = yi, V = vi, random = ~ 1 | cluster_id/effect_uid, data = d, method = meta_method))',
    '  }',
    '  metafor::rma(yi = yi, vi = vi, data = d, method = meta_method)',
    '}',
    `min_subgroup_k <- ${META_SUBGROUP_MIN_EFFECTS}`,
    `min_subgroup_studies <- ${META_SUBGROUP_MIN_STUDIES}`,
    `bootstrap_iterations <- ${MEAN_ONLY_BOOTSTRAP_ITERATIONS}`,
    'bootstrap_cluster_mean <- function(d, iterations = bootstrap_iterations) {',
    '  d <- d[is.finite(d$yi) & !is.na(d$cluster_id) & d$cluster_id != "", c("cluster_id", "yi"), drop = FALSE]',
    '  cluster_means <- vapply(split(d$yi, d$cluster_id), mean, numeric(1), na.rm = TRUE)',
    '  cluster_means <- cluster_means[is.finite(cluster_means)]',
    '  if (length(cluster_means) == 0) return(data.frame(estimate = NA_real_, se = NA_real_, ci_lower = NA_real_, ci_upper = NA_real_, clusters = 0))',
    '  set.seed(20260609)',
    '  boots <- replicate(iterations, mean(sample(cluster_means, size = length(cluster_means), replace = TRUE)))',
    '  data.frame(estimate = mean(cluster_means), se = stats::sd(boots), ci_lower = stats::quantile(boots, 0.025, names = FALSE), ci_upper = stats::quantile(boots, 0.975, names = FALSE), clusters = length(cluster_means))',
    '}',
    'estimate_row <- function(fit, outcome_id, outcome_label, subgroup_col, subgroup_level, k, studies, clusters) {',
    '  prediction <- try(stats::predict(fit), silent = TRUE)',
    '  pi_lower <- if (!inherits(prediction, "try-error") && !is.null(prediction$pi.lb)) as.numeric(prediction$pi.lb) else NA_real_',
    '  pi_upper <- if (!inherits(prediction, "try-error") && !is.null(prediction$pi.ub)) as.numeric(prediction$pi.ub) else NA_real_',
    '  data.frame(outcome_id = outcome_id, outcome_label = outcome_label, subgroup_column = subgroup_col, subgroup_level = subgroup_level,',
    '    k = k, studies = studies, clusters = clusters, estimate = as.numeric(fit$b), se = as.numeric(fit$se),',
    '    ci_lower = as.numeric(fit$ci.lb), ci_upper = as.numeric(fit$ci.ub), pi_lower = pi_lower, pi_upper = pi_upper,',
    '    z = as.numeric(fit$zval), p = as.numeric(fit$pval), tau2 = as.numeric(fit$tau2), method = fit$method, stringsAsFactors = FALSE)',
    '}',
    'dir.create("results", showWarnings = FALSE, recursive = TRUE)',
    'all_rows <- list()',
    'for (oid in sort(unique(dat$outcome_id))) {',
    '  d <- dat[dat$outcome_id == oid, , drop = FALSE]',
    '  cat("\\n==== Outcome:", unique(d$outcome_label)[1], "====\\n")',
    '  if (all(d$mean_only)) {',
    '    boot <- bootstrap_cluster_mean(d)',
    '    all_rows[[length(all_rows) + 1]] <- data.frame(outcome_id = oid, outcome_label = unique(d$outcome_label)[1], subgroup_column = "", subgroup_level = "", k = nrow(d), studies = length(unique(d$study_id)), clusters = boot$clusters, estimate = boot$estimate, se = boot$se, ci_lower = boot$ci_lower, ci_upper = boot$ci_upper, pi_lower = NA_real_, pi_upper = NA_real_, z = NA_real_, p = NA_real_, tau2 = NA_real_, method = "mean-only equal-cluster bootstrap", stringsAsFactors = FALSE)',
    '    next',
    '  }',
    '  fit <- fit_main_model(d)',
    '  all_rows[[length(all_rows) + 1]] <- estimate_row(fit, oid, unique(d$outcome_label)[1], "", "", nrow(d), length(unique(d$study_id)), length(unique(d$cluster_id)))',
    '  cat("Q =", fit$QE, " df =", fit$k - 1, " I2 =", round(fit$I2, 1), " tau2 =", round(fit$tau2, 4), "\\n")',
    '  for (smod in subgroup_cols) {',
    '    levels <- unique(d[[smod]])',
    '    if (length(levels) < 2) next',
    '    for (lv in levels) {',
    '      dl <- d[d[[smod]] == lv, , drop = FALSE]',
    '      if (nrow(dl) < min_subgroup_k || length(unique(dl$study_id)) < min_subgroup_studies) next',
    '      if (all(dl$mean_only)) {',
    '        boot <- bootstrap_cluster_mean(dl)',
    '        all_rows[[length(all_rows) + 1]] <- data.frame(outcome_id = oid, outcome_label = unique(d$outcome_label)[1], subgroup_column = smod, subgroup_level = as.character(lv), k = nrow(dl), studies = length(unique(dl$study_id)), clusters = boot$clusters, estimate = boot$estimate, se = boot$se, ci_lower = boot$ci_lower, ci_upper = boot$ci_upper, pi_lower = NA_real_, pi_upper = NA_real_, z = NA_real_, p = NA_real_, tau2 = NA_real_, method = "mean-only equal-cluster bootstrap", stringsAsFactors = FALSE)',
    '        next',
    '      }',
    '      fitl <- fit_main_model(dl)',
    '      all_rows[[length(all_rows) + 1]] <- estimate_row(fitl, oid, unique(d$outcome_label)[1], smod, as.character(lv), nrow(dl), length(unique(dl$study_id)), length(unique(dl$cluster_id)))',
    '    }',
    '  }',
    '  pdf(file = file.path("results", paste0("forest_", gsub("[^A-Za-z0-9_-]", "_", oid), ".pdf")), width = 7, height = max(3.2, min(24, 0.22 * nrow(d) + 1.5)))',
    '  forest_plot <- try(metafor::forest.rma(fit, slab = d$study_id, xlab = unique(d$outcome_label)[1]), silent = TRUE)',
    '  dev.off()',
    '}',
    'results_df <- do.call(rbind, all_rows)',
    'write.csv(results_df, file = "results/meta_summary.csv", row.names = FALSE)',
    'cat("\\nDone. Summary written to results/meta_summary.csv\\n")',
  ]
  return script.join('\n')
}

export function buildRunMarkdown(dataset, effectRows, skippedRows, summaries, subgroups, quality, config) {
  const lines = []
  lines.push('# Meta 分析报告')
  lines.push('')
  lines.push(`- 生成时间：${new Date().toISOString()}`)
  lines.push(`- 数据：${dataset.pdfCount} 篇 PDF / ${dataset.tables.length} 个数据表 / ${dataset.rows.length} 行 / ${dataset.columns.length} 列`)
  lines.push(`- 模型：${config.model || 'random'}（方法 ${config.method || 'REML'}）`)
  lines.push(`- 有效效应量：${effectRows.length} 行；跳过：${skippedRows.length} 行`)
  lines.push('')

  if (quality.warnings.length) {
    lines.push('## 质量警告')
    quality.warnings.forEach(warning => lines.push(`- ⚠️ ${warning}`))
    lines.push('')
  }

  lines.push('## 合并效应量')
  if (!summaries.length) {
    lines.push('无可汇总的结果。')
  }
  for (const summary of summaries) {
    lines.push(`### ${summary.outcomeLabel}（${summary.measure}，k = ${summary.k}）`)
    lines.push('')
    lines.push('| 模型 | 估计 | SE | 95% CI | z | p |')
    lines.push('|---|---|---|---|---|---|')
    for (const [label, est] of [['固定', summary.fixed], ['随机', summary.random]]) {
      const ci = Number.isFinite(est.ciLower) ? `[${est.ciLower.toFixed(3)}, ${est.ciUpper.toFixed(3)}]` : '-'
      const z = Number.isFinite(est.z) ? est.z.toFixed(3) : '-'
      const p = Number.isFinite(est.p) ? est.p.toFixed(4) : '-'
      lines.push(`| ${label} | ${Number.isFinite(est.estimate) ? est.estimate.toFixed(3) : '-'} | ${Number.isFinite(est.se) ? est.se.toFixed(3) : '-'} | ${ci} | ${z} | ${p} |`)
    }
    lines.push('')
    const het = summary.heterogeneity
    if (Number.isFinite(het.q)) {
      lines.push(`- 异质性：Q = ${het.q.toFixed(2)}，df = ${het.df}，I² = ${het.i2.toFixed(1)}%，τ² = ${het.tau2.toFixed(4)}`)
    } else {
      lines.push('- 异质性：mean-only 等权重 bootstrap 模型不计算 Q/I²/τ²')
    }
    lines.push('')
  }

  if (subgroups.length) {
    lines.push('## 亚组分析')
    for (const subgroup of subgroups) {
      const est = subgroup.random
      const ci = Number.isFinite(est.ciLower) ? `[${est.ciLower.toFixed(3)}, ${est.ciUpper.toFixed(3)}]` : '-'
      lines.push(`- **${subgroup.outcomeLabel}** / ${subgroup.subgroupColumn}=${subgroup.subgroupLevel}（k = ${subgroup.k}）：估计 ${Number.isFinite(est.estimate) ? est.estimate.toFixed(3) : '-'}，95% CI ${ci}`)
    }
    lines.push('')
  }

  if (skippedRows.length) {
    lines.push('## 跳过的行')
    lines.push('')
    lines.push('| 结果 | 行 | 研究 | 原因 |')
    lines.push('|---|---|---|---|')
    skippedRows.slice(0, 50).forEach(row => {
      lines.push(`| ${row.outcomeId} | ${row.rowIndex} | ${row.studyId} | ${row.reason} |`)
    })
    if (skippedRows.length > 50) lines.push(`| … 共 ${skippedRows.length} 行 | | | |`)
    lines.push('')
  }

  lines.push('## 方法学说明')
  lines.push('')
  lines.push('- 固定效应：逆方差加权；随机效应：DerSimonian–Laird τ² 估计后的逆方差加权。')
  lines.push('- lnRR 要求处理组与对照组均值均为正；MD/SMD 在 SD/n 完整时使用。')
  lines.push('- mean-only（无 SD/n）采用等权重聚类 bootstrap（9999 次），不报告 Q/I²/τ²。')
  lines.push('- 亚组分析要求每组 ≥ 3 个效应量且 ≥ 2 个研究。')
  lines.push('')
  return lines.join('\n')
}

// ---------------------------------------------------------------- run

export function runMetaAnalysisOnDataset(dataset, config, options = {}) {
  const analysisId = options.analysisId || `meta_run_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`
  const sourcePdfIds = options.sourcePdfIds || []
  const datasetFingerprint = buildMetaDatasetFingerprint(dataset, sourcePdfIds)
  const effectBuild = buildEffectRows(dataset, config)
  const summaries = summarizeEffects(effectBuild.effectRows)
  const subgroups = summarizeSubgroups(effectBuild.effectRows, config.subgroupColumns)
  const quality = buildRunQualityReport(dataset, effectBuild.effectRows, effectBuild.skippedRows, config)
  const csv = buildEffectRowsCsv(effectBuild.effectRows)
  const rCode = buildMetaAnalysisRCode(config, effectBuild.effectRows)
  const markdown = buildRunMarkdown(dataset, effectBuild.effectRows, effectBuild.skippedRows, summaries, subgroups, quality, config)
  const writingContext = buildWritingContext({
    analysisId,
    sourcePdfIds,
    datasetFingerprint,
    userId: options.userId || 'default',
    dataset,
    config,
    effectRows: effectBuild.effectRows,
    skippedRows: effectBuild.skippedRows,
    summaries,
    subgroups,
    quality,
    markdown,
    rCode,
    effectRowsCsv: csv,
  })

  return {
    analysisId,
    createdAt: new Date().toISOString(),
    datasetFingerprint,
    dataset: {
      pdfCount: dataset.pdfCount,
      tableCount: dataset.tables.length,
      rowCount: dataset.rows.length,
      columnCount: dataset.columns.length,
    },
    config,
    effectRows: effectBuild.effectRows,
    skippedRows: effectBuild.skippedRows.slice(0, 200),
    skippedCount: effectBuild.skippedRows.length,
    summaries,
    subgroups,
    quality,
    markdown,
    rCode,
    effectRowsCsv: csv,
    effectRowsFilename: 'meta_effect_sizes.csv',
    writingContext,
  }
}

/**
 * Build the writing-context payload: a self-contained, structured snapshot a
 * paper-writing workflow can consume directly (port of the Scholar Harness
 * MetaAnalysisWritingContext shape, minus host-specific paths).
 */
export function buildWritingContext(input) {
  const {
    analysisId, sourcePdfIds, datasetFingerprint, userId,
    dataset, config, effectRows, skippedRows, summaries, subgroups,
    quality, markdown, rCode, effectRowsCsv,
  } = input

  const contextMarkdown = [
    '# Meta 分析写作上下文',
    '',
    `> 来源：dsh-meta-analysis 运行 ${analysisId}（${new Date().toISOString()}）`,
    '',
    '## 数据集',
    '',
    `- PDF/研究来源：${dataset.pdfCount} 篇`,
    `- 编码表：${dataset.tableCount} 个，${dataset.rowCount} 行，${dataset.columnCount} 列`,
    `- 有效效应量：${effectRows.length} 行；跳过：${skippedRows.length} 行`,
    `- 模型：${config.model}（${config.method}）`,
    '',
    '## 效应量汇总',
    '',
    ...(summaries.length
      ? ['| 结果 | 效应量 | k | 随机效应估计 | 95% CI | I² | τ² |', '|---|---|---:|---:|---:|---:|---:|',
          ...summaries.map(s => {
            const est = s.random
            const het = s.heterogeneity
            return [
              escapeMarkdownCell(s.outcomeLabel),
              s.measure,
              String(s.k),
              formatNumber(est.estimate),
              `${formatNumber(est.ciLower)} to ${formatNumber(est.ciUpper)}`,
              `${formatNumber(het.i2)}%`,
              formatNumber(het.tau2),
            ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')
          })]
      : ['（无可汇总结果）']),
    '',
    ...(subgroups.length
      ? ['## 亚组分析', '',
          ...subgroups.map(s => `- ${s.outcomeLabel} / ${s.subgroupColumn}=${s.subgroupLevel}（k=${s.k}）：${formatNumber(s.random.estimate)}，95% CI ${formatNumber(s.random.ciLower)} to ${formatNumber(s.random.ciUpper)}`),
          '']
      : []),
    '## 方法说明',
    '',
    '- 固定效应：逆方差加权；随机效应：DerSimonian–Laird τ² 估计后逆方差加权。',
    '- lnRR 要求处理组与对照组均值均为正；MD/SMD 在 SD/n 完整时使用。',
    '- mean-only（无 SD/n）采用等权重聚类 bootstrap（9999 次），不报告 Q/I²/τ²。',
    '- 亚组分析要求每组 ≥ 3 个效应量且 ≥ 2 个研究。',
    '',
  ].join('\n')

  return {
    analysisId,
    source: 'meta-analysis-writing-context',
    userId,
    sourcePdfIds,
    datasetFingerprint,
    generatedAt: new Date().toISOString(),
    available: true,
    status: 'completed',
    dataset: {
      pdfCount: dataset.pdfCount,
      tableCount: dataset.tables.length,
      rowCount: dataset.rows.length,
      columnCount: dataset.columns.length,
    },
    config,
    summaries,
    subgroups,
    quality,
    effectRows,
    skippedRows: skippedRows.slice(0, 200),
    skippedCount: skippedRows.length,
    markdown,
    rCode,
    effectRowsCsv,
    effectRowsFilename: 'meta_effect_sizes.csv',
    contextMarkdown,
    exports: {
      effectSizesCsv: 'meta_effect_sizes.csv',
    },
  }
}

export function escapeMarkdownCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

export function formatNumber(value) {
  if (value === null || value === undefined) return '-'
  const num = Number(value)
  if (!Number.isFinite(num)) return '-'
  return String(Math.round(num * 1000) / 1000)
}

export function buildMetaDatasetFingerprint(dataset, sourcePdfIds) {
  return createHash('sha256')
    .update(JSON.stringify({
      sourcePdfIds: [...(sourcePdfIds || [])].sort(),
      columns: dataset.columns,
      rows: dataset.rows,
    }))
    .digest('hex')
}
