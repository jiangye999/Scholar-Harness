/**
 * The /api/dsh-meta route family: project/source/coding-table CRUD, figure
 * digitization import, inspect, run, results. Data lives in the local store —
 * zero connection to Scholar Harness. Every route carries a loopback-only
 * trust fence (plus browser same-origin markers).
 */

/** Cap on JSON request bodies. */
const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024

/** Loopback literal check plus browser same-origin markers (mirrors dsh-ssh's fence). */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

/** Read a JSON request body (undefined when too large or unparseable). */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

/** URL query helper (first value, decoded). */
function queryParam(url, name) {
  const value = url.searchParams.get(name)
  return value === null ? undefined : value
}

/** Normalize a JSON string field. */
function str(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

/** Normalize a JSON array of strings. */
function strArray(value) {
  return Array.isArray(value) ? value.map(v => str(v)).filter(Boolean) : []
}

/** Build a fenced handler wrapper. */
function fenced(handler) {
  return async (req, res) => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'loopback only' })
      return
    }
    try {
      await handler(req, res)
    } catch (error) {
      writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

/** One GET route. */
function get(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: fenced(async (req, res) => {
      await handler(req, res, new URL(req.url ?? '/', 'http://x'))
    }),
  }
}

/** One POST route. */
function post(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: fenced(async (req, res) => {
      const body = await readJsonBody(req)
      await handler(req, res, body)
    }),
  }
}

/** Build the /api/dsh-meta route list. */
export function makeMetaRoutes(deps) {
  const { store, engine } = deps

  // ------------------------------------------------------------ projects
  return [
    // The webServer route contract has no HTTP method: one (kind, path) slot
    // owns every verb, so GET and POST share a handler and branch on req.method.
    {
      kind: 'exact',
      path: '/api/dsh-meta/projects',
      handler: fenced(async (req, res) => {
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const project = store.createProject({ name: str(body?.name) })
          writeJson(res, 200, { project })
          return
        }
        writeJson(res, 200, { projects: store.listProjects() })
      }),
    },

    post('/api/dsh-meta/projects/rename', async (_req, res, body) => {
      const project = store.renameProject(str(body?.projectId), str(body?.name))
      if (!project) { writeJson(res, 404, { error: 'project not found' }); return }
      writeJson(res, 200, { project })
    }),

    post('/api/dsh-meta/projects/delete', async (_req, res, body) => {
      const ok = store.deleteProject(str(body?.projectId))
      writeJson(res, 200, { ok })
    }),

    // ------------------------------------------------------------- status
    get('/api/dsh-meta/status', async (_req, res, url) => {
      const projectId = queryParam(url, 'projectId')
      const project = store.getProject(projectId)
      writeJson(res, 200, {
        project: {
          id: project.id,
          name: project.name,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          sourceCount: (project.sources || []).length,
          analysisCount: (project.analyses || []).length,
        },
      })
    }),

    // ------------------------------------------------------------- sources
    get('/api/dsh-meta/sources', async (_req, res, url) => {
      const project = store.getProject(queryParam(url, 'projectId'))
      writeJson(res, 200, {
        sources: (project.sources || []).map(source => ({
          pdfId: source.pdfId,
          title: source.title,
          authors: source.authors,
          year: source.year,
          parser: source.parser,
          needsReview: !!source.needsReview,
          rowCount: source.dataTable && Array.isArray(source.dataTable.rows) ? source.dataTable.rows.length : 0,
          columnCount: source.dataTable && Array.isArray(source.dataTable.columns) ? source.dataTable.columns.length : 0,
          figureCount: Array.isArray(source.figures) ? source.figures.length : 0,
        })),
      })
    }),

    get('/api/dsh-meta/sources/detail', async (_req, res, url) => {
      const project = store.getProject(queryParam(url, 'projectId'))
      const pdfId = str(queryParam(url, 'pdfId'))
      const source = (project.sources || []).find(s => s.pdfId === pdfId)
      if (!source) { writeJson(res, 404, { error: 'source not found' }); return }
      writeJson(res, 200, { source })
    }),

    post('/api/dsh-meta/sources/add', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const project = store.updateProject(projectId, project => {
        const now = new Date().toISOString()
        const source = {
          pdfId: `src_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
          title: str(body?.title) || `研究来源 ${(project.sources || []).length + 1}`,
          authors: str(body?.authors),
          year: Number(body?.year) || undefined,
          parser: str(body?.parser) || 'manual',
          needsReview: !!body?.needsReview,
          createdAt: now,
          dataTable: {
            columns: Array.isArray(body?.columns) ? strArray(body.columns) : [],
            rows: Array.isArray(body?.rows) ? body.rows : [],
            rowCount: Array.isArray(body?.rows) ? body.rows.length : 0,
          },
          figures: [],
        }
        project.sources = [...(project.sources || []), source]
        return source
      })
      writeJson(res, 200, { source: project })
    }),

    post('/api/dsh-meta/sources/delete', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfIds = new Set(strArray(body?.pdfIds))
      store.updateProject(projectId, project => {
        project.sources = (project.sources || []).filter(s => !pdfIds.has(s.pdfId))
      })
      writeJson(res, 200, { ok: true })
    }),

    // -------------------------------------------------------- coding table
    post('/api/dsh-meta/coding/columns/add', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfId = str(body?.pdfId)
      const column = str(body?.column)
      const afterColumn = str(body?.afterColumn)
      if (!column) { writeJson(res, 400, { error: 'column name required' }); return }
      const source = store.updateProject(projectId, project => {
        const s = (project.sources || []).find(item => item.pdfId === pdfId)
        if (!s) return null
        if (!Array.isArray(s.dataTable.columns)) s.dataTable.columns = []
        if (s.dataTable.columns.includes(column)) return s
        if (afterColumn && s.dataTable.columns.includes(afterColumn)) {
          const index = s.dataTable.columns.indexOf(afterColumn)
          s.dataTable.columns.splice(index + 1, 0, column)
        } else {
          s.dataTable.columns.push(column)
        }
        s.dataTable.rows = (s.dataTable.rows || []).map(row => ({ ...row, [column]: '' }))
        s.dataTable.rowCount = s.dataTable.rows.length
        return s
      })
      if (!source) { writeJson(res, 404, { error: 'source not found' }); return }
      writeJson(res, 200, { source })
    }),

    post('/api/dsh-meta/coding/rows/add', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfId = str(body?.pdfId)
      const source = store.updateProject(projectId, project => {
        const s = (project.sources || []).find(item => item.pdfId === pdfId)
        if (!s) return null
        if (!Array.isArray(s.dataTable.rows)) s.dataTable.rows = []
        const row = {}
        for (const column of s.dataTable.columns || []) row[column] = ''
        s.dataTable.rows.push(row)
        s.dataTable.rowCount = s.dataTable.rows.length
        return s
      })
      if (!source) { writeJson(res, 404, { error: 'source not found' }); return }
      writeJson(res, 200, { source })
    }),

    post('/api/dsh-meta/coding/save', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfId = str(body?.pdfId)
      const columns = strArray(body?.columns)
      const rows = Array.isArray(body?.rows) ? body.rows : []
      const source = store.updateProject(projectId, project => {
        const s = (project.sources || []).find(item => item.pdfId === pdfId)
        if (!s) return null
        s.dataTable.columns = columns
        s.dataTable.rows = rows
        s.dataTable.rowCount = rows.length
        return s
      })
      if (!source) { writeJson(res, 404, { error: 'source not found' }); return }
      writeJson(res, 200, { source })
    }),

    post('/api/dsh-meta/coding/delete', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfId = str(body?.pdfId)
      const rowIndexes = Array.isArray(body?.rowIndexes) ? body.rowIndexes.map(Number).filter(Number.isInteger) : []
      const columns = strArray(body?.columns)
      const source = store.updateProject(projectId, project => {
        const s = (project.sources || []).find(item => item.pdfId === pdfId)
        if (!s) return null
        const rows = Array.isArray(s.dataTable.rows) ? s.dataTable.rows : []
        if (rowIndexes.length) {
          const toDelete = new Set(rowIndexes)
          s.dataTable.rows = rows.filter((_, index) => !toDelete.has(index))
          s.dataTable.rowCount = s.dataTable.rows.length
        }
        if (columns.length) {
          const toDelete = new Set(columns)
          s.dataTable.columns = (s.dataTable.columns || []).filter(column => !toDelete.has(column))
          s.dataTable.rows = (s.dataTable.rows || []).map(row => {
            const next = { ...row }
            for (const column of toDelete) delete next[column]
            return next
          })
        }
        return s
      })
      if (!source) { writeJson(res, 404, { error: 'source not found' }); return }
      writeJson(res, 200, { source })
    }),

    // ------------------------------------------------- digitization import
    post('/api/dsh-meta/digitization/import', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfId = str(body?.pdfId)
      const figureId = str(body?.figureId)
      const figureLabel = str(body?.figureLabel) || '图件'
      const columns = strArray(body?.columns)
      const rows = Array.isArray(body?.rows) ? body.rows : []
      if (!columns.length || !rows.length) {
        writeJson(res, 400, { error: 'columns and rows required' })
        return
      }
      const source = store.updateProject(projectId, project => {
        const s = (project.sources || []).find(item => item.pdfId === pdfId)
        if (!s) return null
        if (!Array.isArray(s.figures)) s.figures = []
        const figure = s.figures.find(f => f.id === figureId) || {
          id: figureId || `fig_${Date.now()}`,
          label: figureLabel,
          needsDigitization: true,
        }
        figure.digitized = { columns, rows, importedAt: new Date().toISOString() }
        figure.needsDigitization = false
        if (!s.figures.some(f => f.id === figure.id)) s.figures.push(figure)
        return s
      })
      if (!source) { writeJson(res, 404, { error: 'source not found' }); return }
      writeJson(res, 200, { source })
    }),

    // ------------------------------------------------------------- inspect
    post('/api/dsh-meta/inspect', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfIds = strArray(body?.pdfIds)
      const project = store.getProject(projectId)
      const sources = (project.sources || []).filter(s => pdfIds.length === 0 || pdfIds.includes(s.pdfId))
      const dataset = engine.datasetFromSources(sources)
      if (dataset.rows.length === 0) {
        writeJson(res, 404, { error: '未找到可分析的编码表数据行，请先填写编码表' })
        return
      }
      const result = engine.inspect(dataset, projectId, sources.map(s => s.pdfId))
      writeJson(res, 200, { result })
    }),

    // ---------------------------------------------------------------- run
    post('/api/dsh-meta/run', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const pdfIds = strArray(body?.pdfIds)
      const config = body?.config && typeof body.config === 'object' ? body.config : {}
      const project = store.getProject(projectId)
      const sources = (project.sources || []).filter(s => pdfIds.length === 0 || pdfIds.includes(s.pdfId))
      const dataset = engine.datasetFromSources(sources)
      const run = engine.run(dataset, config, { sourcePdfIds: sources.map(s => s.pdfId) })
      store.updateProject(projectId, project => {
        project.analyses = [...(project.analyses || []), run]
      })
      writeJson(res, 200, { run })
    }),

    get('/api/dsh-meta/analyses', async (_req, res, url) => {
      const project = store.getProject(queryParam(url, 'projectId'))
      const analyses = (project.analyses || []).map(a => ({
        analysisId: a.analysisId,
        createdAt: a.createdAt,
        dataset: a.dataset,
        effectRowCount: (a.effectRows || []).length,
        skippedCount: a.skippedCount || 0,
        summaryCount: (a.summaries || []).length,
      }))
      writeJson(res, 200, { analyses })
    }),

    get('/api/dsh-meta/analyses/detail', async (_req, res, url) => {
      const project = store.getProject(queryParam(url, 'projectId'))
      const analysisId = str(queryParam(url, 'analysisId'))
      const analysis = (project.analyses || []).find(a => a.analysisId === analysisId)
      if (!analysis) { writeJson(res, 404, { error: 'analysis not found' }); return }
      writeJson(res, 200, { analysis })
    }),

    get('/api/dsh-meta/analyses/writing-context', async (_req, res, url) => {
      const project = store.getProject(queryParam(url, 'projectId'))
      const analysisId = str(queryParam(url, 'analysisId'))
      const analysis = (project.analyses || []).find(a => a.analysisId === analysisId)
      if (!analysis || !analysis.writingContext) { writeJson(res, 404, { error: 'writing context not found' }); return }
      const context = analysis.writingContext
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="meta-writing-context-${context.analysisId}.json"`,
        'referrer-policy': 'no-referrer',
      })
      res.end(JSON.stringify(context, null, 2))
    }),

    post('/api/dsh-meta/analyses/delete', async (_req, res, body) => {
      const projectId = str(body?.projectId)
      const analysisId = str(body?.analysisId)
      store.updateProject(projectId, project => {
        project.analyses = (project.analyses || []).filter(a => a.analysisId !== analysisId)
      })
      writeJson(res, 200, { ok: true })
    }),
  ]
}
