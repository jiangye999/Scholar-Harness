/**
 * Agent tools: dsh_meta_* — the DSH-native face of the Meta analysis engine.
 * Every tool talks to the same local store the GUI panel uses.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** One text content block. */
function text(value) {
  return [{ type: 'text', text: value }]
}

/** Compact render of the engine overview. */
function renderOverview(value) {
  return [
    `Meta 分析插件：数据目录 ${value.dataRoot}`,
    `当前项目：${value.projectName}（${value.projectId}）`,
    `研究来源 ${value.sourceCount} 个，历史分析 ${value.analysisCount} 次`,
    value.projects.length > 1 ? `项目数：${value.projects.length}` : '',
  ].filter(Boolean).join('\n')
}

/** Render source list. */
function renderSources(sources) {
  if (!sources.length) return '暂无研究来源。请在 GUI「Meta 分析」面板添加来源并填写编码表。'
  const rows = sources.map(s => [
    s.title || '(未命名)',
    s.year ? String(s.year) : '',
    s.authors || '',
    `${s.rowCount} 行/${s.columnCount} 列`,
    s.needsReview ? '需核查' : '',
  ].filter(Boolean).join(' | '))
  return [`研究来源 ${sources.length} 个`, '--- | --- | --- | ---', ...rows].join('\n')
}

/** Render inspect result compactly. */
function renderInspect(value) {
  const lines = [
    `预检：${value.dataset.pdfCount} 篇 / ${value.dataset.rowCount} 行 / ${value.dataset.columnCount} 列`,
  ]
  if (value.warnings.length) {
    lines.push('警告：')
    value.warnings.forEach(warning => lines.push(`- ${warning}`))
  }
  if (value.candidateOutcomes.length) {
    lines.push('自动识别的候选结果：')
    value.candidateOutcomes.forEach(candidate => {
      lines.push(`- ${candidate.label}（${candidate.measure}，完整行 ${candidate.completeRows}/${candidate.totalRows}）`)
      candidate.warnings.forEach(warning => lines.push(`  ⚠ ${warning}`))
    })
  } else {
    lines.push('未自动识别到完整的结果映射，请在向导中手动指定处理组/对照组均值、SD、n 列。')
  }
  if (value.recommendedConfig?.outcomes?.length) {
    lines.push('推荐配置（可直接用于 run）：')
    lines.push(JSON.stringify({
      model: value.recommendedConfig.model,
      method: value.recommendedConfig.method,
      studyIdColumn: value.recommendedConfig.studyIdColumn,
      subgroupColumns: value.recommendedConfig.subgroupColumns,
      outcomes: value.recommendedConfig.outcomes.map(o => ({ id: o.id, label: o.label, measure: o.measure })),
    }, null, 2))
  }
  return lines.join('\n')
}

/** Render run result compactly. */
function renderRun(value) {
  const lines = [
    `分析完成：${value.analysisId}`,
    `数据：${value.dataset.pdfCount} 篇 / ${value.dataset.rowCount} 行；效应量 ${value.effectRows.length} 行，跳过 ${value.skippedCount} 行`,
  ]
  if (value.quality?.warnings?.length) {
    value.quality.warnings.forEach(warning => lines.push(`⚠ ${warning}`))
  }
  if (value.summaries.length) {
    lines.push('合并效应量（随机效应）：')
    value.summaries.forEach(summary => {
      const est = summary.random
      const ci = Number.isFinite(est.ciLower)
        ? `95% CI [${est.ciLower.toFixed(3)}, ${est.ciUpper.toFixed(3)}]`
        : 'CI 不可用'
      lines.push(`- ${summary.outcomeLabel}（${summary.measure}，k=${summary.k}）：估计 ${Number.isFinite(est.estimate) ? est.estimate.toFixed(3) : '-'}，${ci}`)
      const het = summary.heterogeneity
      if (Number.isFinite(het.q)) {
        lines.push(`  异质性 Q=${het.q.toFixed(2)}，I²=${het.i2.toFixed(1)}%，τ²=${het.tau2.toFixed(4)}`)
      } else {
        lines.push('  异质性：mean-only bootstrap 模型不计算 Q/I²/τ²')
      }
    })
  } else {
    lines.push('无可汇总的结果（请检查效应量映射与数据完整性）。')
  }
  if (value.subgroups?.length) {
    lines.push(`亚组分析 ${value.subgroups.length} 组`)
  }
  return lines.join('\n')
}

/** The health tool. */
export function dshMetaHealthTool(engine) {
  return defineTool({
    name: 'dsh_meta_health',
    description: 'Check the local Meta analysis data root, current project, and counts. ' +
      'Triggers: Meta 分析状态, meta health, 检查 Meta 插件, 当前项目.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectId: { type: 'string', required: true },
          projectName: { type: 'string', required: true },
          dataRoot: { type: 'string', required: true },
          sourceCount: { type: 'integer', required: true },
          analysisCount: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => text(renderOverview(value)),
    },
    async execute() {
      return engine.overview()
    },
  })
}

/** The sources tool. */
export function dshMetaSourcesTool(engine) {
  return defineTool({
    name: 'dsh_meta_sources',
    description: 'List Meta analysis research sources (title, year, authors, coding-table size). ' +
      'Triggers: 研究来源, meta sources, 编码表来源, 纳入研究列表.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sources: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                pdfId: { type: 'string' },
                title: { type: 'string' },
                authors: { type: 'string' },
                year: { type: 'integer' },
                rowCount: { type: 'integer' },
                columnCount: { type: 'integer' },
                needsReview: { type: 'boolean' },
              },
            },
          },
        },
      },
      render: (_args, value) => text(renderSources(value.sources)),
    },
    async execute() {
      return { sources: engine.listSources() }
    },
  })
}

/** The inspect tool. */
export function dshMetaInspectTool(engine) {
  return defineTool({
    name: 'dsh_meta_inspect',
    description: 'Inspect the coding tables: infer variables, candidate outcomes, moderators, and a recommended run config. ' +
      'Call before dsh_meta_run. Triggers: 预检, meta inspect, 变量推断, 候选结果, 推荐配置.',
    parameters: {
      pdfIds: { type: 'array', items: { type: 'string' }, description: 'Optional source pdfIds to include (default all).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          dataset: { type: 'object', additionalProperties: true },
          candidateOutcomes: { type: 'array', items: { type: 'object', additionalProperties: true } },
          moderatorCandidates: { type: 'array', items: { type: 'object', additionalProperties: true } },
          recommendedConfig: { type: 'object', additionalProperties: true },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => text(renderInspect(value)),
    },
    async execute(args) {
      const project = engine.project()
      const sources = (project.sources || []).filter(s => !(args.pdfIds?.length) || args.pdfIds.includes(s.pdfId))
      const dataset = engine.datasetFromSources(sources)
      if (dataset.rows.length === 0) {
        return {
          dataset: { pdfCount: 0, rowCount: 0, columnCount: 0 },
          candidateOutcomes: [],
          moderatorCandidates: [],
          recommendedConfig: null,
          warnings: ['未找到可分析的编码表数据行，请先在 GUI 面板添加研究来源并填写编码表。'],
        }
      }
      return engine.inspect(dataset, project.id, sources.map(s => s.pdfId))
    },
  })
}

/** The run tool. */
export function dshMetaRunTool(engine) {
  return defineTool({
    name: 'dsh_meta_run',
    description: 'Run the Meta analysis with an explicit config (outcome effect-size mappings, model, subgroups). ' +
      'Requires coding-table data. Triggers: 运行分析, meta run, 效应量计算, 异质性, 亚组分析, R 脚本生成.',
    parameters: {
      pdfIds: { type: 'array', items: { type: 'string' }, description: 'Optional source pdfIds (default all).' },
      config: {
        type: 'object',
        additionalProperties: true,
        description: 'Run config. Recommended shape from dsh_meta_inspect: { model, method, studyIdColumn, subgroupColumns, outcomes: [{ id, label, measure, treatmentMean, treatmentSd, treatmentN, controlMean, controlSd, controlN, direction }] }.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          analysisId: { type: 'string', required: true },
          dataset: { type: 'object', additionalProperties: true },
          effectRows: { type: 'array', items: { type: 'object', additionalProperties: true } },
          skippedCount: { type: 'integer' },
          summaries: { type: 'array', items: { type: 'object', additionalProperties: true } },
          subgroups: { type: 'array', items: { type: 'object', additionalProperties: true } },
          quality: { type: 'object', additionalProperties: true },
          markdown: { type: 'string' },
          rCode: { type: 'string' },
        },
      },
      render: (_args, value) => text(renderRun(value)),
    },
    async execute(args) {
      const project = engine.project()
      const sources = (project.sources || []).filter(s => !(args.pdfIds?.length) || args.pdfIds.includes(s.pdfId))
      const dataset = engine.datasetFromSources(sources)
      const run = engine.run(dataset, args.config || {}, { sourcePdfIds: sources.map(s => s.pdfId) })
      engine.store.updateProject(project.id, project => {
        project.analyses = [...(project.analyses || []), run]
      })
      return run
    },
  })
}

/** The analyses tool. */
export function dshMetaAnalysesTool(engine) {
  return defineTool({
    name: 'dsh_meta_analyses',
    description: 'List historical Meta analysis runs (id, time, dataset size, effect-row count). ' +
      'Triggers: 历史分析, meta analyses, 查看既往结果.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          analyses: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                analysisId: { type: 'string' },
                createdAt: { type: 'string' },
                effectRowCount: { type: 'integer' },
                skippedCount: { type: 'integer' },
                summaryCount: { type: 'integer' },
                outcomeLabels: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      render: (_args, value) => {
        if (!value.analyses.length) return '暂无历史分析'
        const rows = value.analyses.map(a => [
          a.analysisId,
          a.createdAt,
          `${a.effectRowCount} 效应量`,
          `跳过 ${a.skippedCount}`,
          (a.outcomeLabels || []).join(','),
        ].join(' | '))
        return ['历史分析 ' + value.analyses.length + ' 次', '--- | --- | --- | ---', ...rows].join('\n')
      },
    },
    async execute() {
      return { analyses: engine.listAnalyses() }
    },
  })
}

/** The writing-context tool. */
export function dshMetaWritingContextTool(engine) {
  return defineTool({
    name: 'dsh_meta_writing_context',
    description: 'Get the structured writing context of a completed Meta analysis: dataset, config, summaries, subgroups, quality, effect rows, CSV, R script, report markdown, and a paper-ready context markdown. ' +
      'Use after dsh_meta_run to feed a paper-writing workflow. Triggers: 写作上下文, writing context, meta 结果用于写作.',
    parameters: {
      analysisId: { type: 'string', required: true, description: 'Analysis id from dsh_meta_analyses.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          analysisId: { type: 'string', required: true },
          available: { type: 'boolean', required: true },
          status: { type: 'string' },
          summaries: { type: 'array', items: { type: 'object', additionalProperties: true } },
          subgroups: { type: 'array', items: { type: 'object', additionalProperties: true } },
          contextMarkdown: { type: 'string' },
          markdown: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => {
        if (!value.available) return `写作上下文不可用：${value.error || 'unknown'}`
        const lines = [
          `写作上下文：${value.analysisId}（${value.status}）`,
          '--- contextMarkdown ---',
          value.contextMarkdown || '(空)',
        ]
        return text(lines.join('\n'))
      },
    },
    async execute(args) {
      const project = engine.project()
      const analysis = (project.analyses || []).find(a => a.analysisId === args.analysisId)
      if (!analysis || !analysis.writingContext) {
        return { analysisId: args.analysisId, available: false, status: 'missing', error: 'analysis or writing context not found' }
      }
      const context = analysis.writingContext
      return {
        analysisId: context.analysisId,
        available: true,
        status: context.status || 'completed',
        summaries: context.summaries,
        subgroups: context.subgroups,
        contextMarkdown: context.contextMarkdown,
        markdown: context.markdown,
      }
    },
  })
}
