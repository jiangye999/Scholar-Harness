/**
 * Agent tools: the DSH-native counterpart of the Scholar Harness codex-plugin
 * MCP server. Every tool talks to the same local Scholar Harness service the
 * GUI panel uses, so data seen by the agent matches the panel exactly.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** One text content block (the only render shape these tools emit). */
function text(value) {
  return [{ type: 'text', text: value }]
}

/** Render the normalized health view. */
function renderHealth(value) {
  if (!value.reachable) return `Scholar Harness 服务不可达：${value.error ?? 'unknown'}`
  const r = value.rPlugin
    ? `R 插件：${rPluginLabel(value.rPlugin)}`
    : 'R 插件状态未知'
  return `Scholar Harness 服务可达\n当前用户：${value.activeUserId}\n${r}`
}

function rPluginLabel(r) {
  if (!r) return 'unknown'
  if (r.label) return r.label
  return r.available === true ? 'available' : 'unavailable'
}

/** Render literature library: summary line + paper rows. */
function renderLiterature(value) {
  if (!value.success) return '文献库读取失败'
  const summary = value.summary
  const head = summary?.count !== undefined
    ? `文献库共 ${summary.count} 篇；年份 ${summary.years?.join(',') ?? '-'}；期刊 ${summary.journals?.slice(0, 5).join(', ') ?? '-'}；关键词 ${summary.keywords?.slice(0, 8).join(', ') ?? '-'}`
    : `文献库返回 ${value.count} 条记录`
  if (value.papers.length === 0) return head
  const rows = value.papers.slice(0, 30).map((p) => {
    const parts = [
      p.title ?? '(无标题)',
      p.year ? String(p.year) : '',
      p.journal ?? '',
      Array.isArray(p.authors) && p.authors.length > 0 ? p.authors.slice(0, 3).join(', ') : '',
    ]
    return parts.filter(Boolean).join(' | ')
  })
  return [head, '--- | --- | --- | ---', ...rows].join('\n')
}

/** Render hybrid retrieval results. */
function renderSearch(value) {
  if (!value.success) return `检索失败：${value.error ?? 'unknown'}`
  const strategy = value.strategy ? `（策略：${value.strategy}）` : ''
  if (value.results.length === 0) return `检索「${value.query}」无结果${strategy}`
  const rows = value.results.slice(0, 20).map((r) => {
    const title = typeof r.title === 'string' ? r.title : '(无标题)'
    const year = typeof r.year === 'number' || typeof r.year === 'string' ? String(r.year) : ''
    const journal = typeof r.journal === 'string' ? r.journal : ''
    const score = typeof r.combinedScore === 'number' ? ` score=${r.combinedScore.toFixed(3)}` : ''
    return [title, year, journal].filter(Boolean).join(' | ') + score
  })
  return [`检索「${value.query}」共 ${value.totalCount} 条候选，返回 ${value.results.length} 条${strategy}`, '--- | --- | --- | ---', ...rows].join('\n')
}

/** Render PDF Wiki status. */
function renderPdfWikiStatus(value) {
  if (!value.success) return `PDF Wiki 状态读取失败：${value.error ?? 'unknown'}`
  const parts = [
    `状态：${value.status ?? 'unknown'}`,
    `PDF：${value.processedPdfs ?? 0}/${value.totalPdfs ?? 0}`,
    `论点组：${value.entryCount ?? 0}`,
    `句子级论点：${value.sentencePointCount ?? 0}`,
  ]
  if (value.message) parts.push(`信息：${value.message}`)
  if (value.updatedAt) parts.push(`更新：${value.updatedAt}`)
  const queue = [
    value.queuedJobs !== undefined ? `排队 ${value.queuedJobs}` : '',
    value.runningJobs !== undefined ? `运行 ${value.runningJobs}` : '',
    value.completedJobs !== undefined ? `完成 ${value.completedJobs}` : '',
    value.failedJobs !== undefined ? `失败 ${value.failedJobs}` : '',
  ].filter(Boolean).join(' / ')
  if (queue) parts.push(`队列：${queue}`)
  return parts.join('\n')
}

/** Render PDF Wiki topic catalog. */
function renderTopics(value) {
  if (!value.success) return `PDF Wiki 主题读取失败：${value.error ?? 'unknown'}`
  if (value.topics.length === 0) return '暂无 PDF Wiki 主题'
  const rows = value.topics.map((t) => {
    const parts = [t.label ?? '(无标签)']
    if (t.expandedBy) parts.push(`[${t.expandedBy}]`)
    if (t.description) parts.push(t.description.slice(0, 80))
    return parts.join(' ')
  })
  return [`PDF Wiki 主题 ${value.topics.length} 个${value.updatedAt ? `（更新 ${value.updatedAt}）` : ''}`, ...rows].join('\n')
}

/** Render Meta database summary. */
function renderMeta(value) {
  if (!value.success) return `Meta 数据库读取失败：${value.error ?? 'unknown'}`
  const head = [
    `Meta 数据库：${value.pdfCount ?? 0} 篇 PDF，${value.referenceCount ?? 0} 条参考文献`,
    value.generatedAt ? `生成：${value.generatedAt}` : '',
    value.userId ? `用户：${value.userId}` : '',
  ].filter(Boolean).join('\n')
  if (value.items.length === 0) return head
  const rows = value.items.slice(0, 20).map((item) => {
    const name = typeof item.originalName === 'string' ? item.originalName : String(item.pdfId ?? '(无名称)')
    const year = typeof item.year === 'number' ? String(item.year) : ''
    const count = typeof item.codingCount === 'number' ? `编码 ${item.codingCount}` : ''
    return [name, year, count].filter(Boolean).join(' | ')
  })
  return [head, '--- | --- | ---', ...rows].join('\n')
}

/** The service-health tool. */
export function scholarHealthTool(engine) {
  return defineTool({
    name: 'scholar_health',
    description: 'Check whether the local Scholar Harness desktop service is reachable, which user is active, and whether the R plugin is available. ' +
      'Triggers: Scholar Harness status, check local academic service, PDF Wiki/Meta 可用性.',
    parameters: {
      userId: { type: 'string', description: 'Optional user id (defaults to the active user, then web-user).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          reachable: { type: 'boolean', required: true },
          activeUserId: { type: 'string', required: true },
          rPlugin: {
            type: 'object',
            additionalProperties: false,
            properties: {
              available: { type: 'boolean' },
              label: { type: 'string' },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(renderHealth(value)),
    },
    async execute(args) {
      return engine.health()
    },
  })
}

/** The literature-list tool. */
export function scholarLiteratureListTool(engine) {
  return defineTool({
    name: 'scholar_literature_list',
    description: 'List the local Scholar Harness literature library (papers + year/journal/keyword summary, up to 100 papers). ' +
      'Triggers: literature list, 文献库, my papers, library overview.',
    parameters: {
      userId: { type: 'string', description: 'Optional user id (defaults to the active user, then web-user).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          count: { type: 'integer', required: true },
          papers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                year: { type: 'integer' },
                journal: { type: 'string' },
                doi: { type: 'string' },
              },
            },
          },
          summary: {
            type: 'object',
            additionalProperties: false,
            properties: {
              count: { type: 'integer' },
              years: { type: 'array', items: { type: 'integer' } },
              journals: { type: 'array', items: { type: 'string' } },
              keywords: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => text(renderLiterature(value)),
    },
    async execute(args) {
      return engine.literature(args.userId)
    },
  })
}

/** The literature-search tool. */
export function scholarLiteratureSearchTool(engine) {
  return defineTool({
    name: 'scholar_literature_search',
    description: 'Hybrid retrieval (BM25 + vector + rerank) over the local Scholar Harness literature library. ' +
      'Triggers: search literature, 检索文献, find papers about, hybrid search.',
    parameters: {
      query: { type: 'string', required: true, description: 'The retrieval query.' },
      topK: { type: 'integer', description: 'Max results (default 10).' },
      mode: { type: 'string', enum: ['bm25', 'vector', 'hybrid'], description: 'Search mode (default hybrid).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          query: { type: 'string', required: true },
          totalCount: { type: 'integer', required: true },
          results: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true,
              properties: {
                title: { type: 'string' },
                year: { type: 'integer' },
                journal: { type: 'string' },
                combinedScore: { type: 'number' },
              },
            },
          },
          strategy: { type: 'string' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(renderSearch(value)),
    },
    async execute(args) {
      return engine.literatureSearch({ query: args.query, topK: args.topK, mode: args.mode })
    },
  })
}

/** The PDF Wiki status tool. */
export function scholarPdfWikiStatusTool(engine) {
  return defineTool({
    name: 'scholar_pdf_wiki_status',
    description: 'Show the sentence-level PDF Wiki evidence library status: processed PDFs, entry groups, sentence points, and queue counters. ' +
      'Triggers: PDF Wiki status, 证据库状态, wiki 构建状态.',
    parameters: {
      userId: { type: 'string', description: 'Optional user id (defaults to the active user, then web-user).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          status: { type: 'string' },
          totalPdfs: { type: 'integer' },
          processedPdfs: { type: 'integer' },
          entryCount: { type: 'integer' },
          sentencePointCount: { type: 'integer' },
          message: { type: 'string' },
          updatedAt: { type: 'string' },
          queuedJobs: { type: 'integer' },
          runningJobs: { type: 'integer' },
          completedJobs: { type: 'integer' },
          failedJobs: { type: 'integer' },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(renderPdfWikiStatus(value)),
    },
    async execute(args) {
      return engine.pdfWikiStatus(args.userId)
    },
  })
}

/** The PDF Wiki topics tool. */
export function scholarPdfWikiTopicsTool(engine) {
  return defineTool({
    name: 'scholar_pdf_wiki_topics',
    description: 'List the PDF Wiki topic catalog (sentence-level evidence grouped under research topics). ' +
      'Triggers: PDF Wiki topics, 主题目录, 证据主题.',
    parameters: {
      userId: { type: 'string', description: 'Optional user id (defaults to the active user, then web-user).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          updatedAt: { type: 'string' },
          topics: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                description: { type: 'string' },
                expandedBy: { type: 'string' },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(renderTopics(value)),
    },
    async execute(args) {
      return engine.pdfWikiTopics(args.userId)
    },
  })
}

/** The Meta database summary tool. */
export function scholarMetaSourcesTool(engine) {
  return defineTool({
    name: 'scholar_meta_sources',
    description: 'Show the Meta analysis database summary: PDF sources, reference count, and per-PDF coding counts. ' +
      'Triggers: Meta 分析数据, meta sources, 编码表来源.',
    parameters: {
      userId: { type: 'string', description: 'Optional user id (defaults to the active user, then web-user).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          success: { type: 'boolean', required: true },
          userId: { type: 'string' },
          generatedAt: { type: 'string' },
          pdfCount: { type: 'integer' },
          referenceCount: { type: 'integer' },
          items: { type: 'array', items: { type: 'object', additionalProperties: true } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => text(renderMeta(value)),
    },
    async execute(args) {
      return engine.metaDatabase(args.userId)
    },
  })
}
