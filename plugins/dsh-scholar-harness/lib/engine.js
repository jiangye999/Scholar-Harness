/**
 * Scholar Harness HTTP engine — the single data path for both the agent tools
 * and the /api/dsh-scholar GUI routes. Talks to the local Scholar Harness
 * desktop service (default http://127.0.0.1:18789) with a bounded timeout,
 * resolves the active user id like the codex-plugin MCP server does
 * (active-user endpoint, then 'web-user' fallback), and returns normalized
 * JSON or throws ScholarHarnessError with the service message.
 */

/** Default base URL of the local Scholar Harness service. */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:18789'

/** Default per-request timeout (ms). */
export const DEFAULT_TIMEOUT_MS = 30_000

/** Error carrying the service's message and the failing endpoint. */
export class ScholarHarnessError extends Error {
  /**
   * @param message - the failure message.
   * @param endpoint - the failing API path.
   * @param status - optional HTTP status.
   */
  constructor(message, endpoint, status) {
    super(message)
    this.name = 'ScholarHarnessError'
    this.endpoint = endpoint
    this.status = status
  }
}

/** The engine: a small fetch wrapper bound to one Scholar Harness base URL. */
export class ScholarHarnessClient {
  /**
   * @param options - baseUrl (default DEFAULT_BASE_URL) and timeoutMs.
   */
  constructor(options = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  /** GET/POST JSON helper; throws ScholarHarnessError on any failure. */
  async json(endpoint, init = {}) {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response
    try {
      response = await fetch(url, {
        ...init,
        signal: controller.signal,
        headers: { accept: 'application/json', ...(init.headers ?? {}) },
      })
    } catch (error) {
      clearTimeout(timer)
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ScholarHarnessError(`Scholar Harness 请求超时（${this.timeoutMs}ms）`, endpoint)
      }
      throw new ScholarHarnessError(
        `无法连接 Scholar Harness 本地服务（${this.baseUrl}）：${error instanceof Error ? error.message : String(error)}`,
        endpoint,
      )
    }
    clearTimeout(timer)
    const text = await response.text()
    let body
    try {
      body = text === '' ? null : JSON.parse(text)
    } catch {
      throw new ScholarHarnessError(`Scholar Harness 返回非 JSON 响应（HTTP ${response.status}）`, endpoint, response.status)
    }
    if (!response.ok) {
      const message = body && typeof body === 'object' && typeof body.message === 'string'
        ? body.message
        : `HTTP ${response.status}`
      throw new ScholarHarnessError(message, endpoint, response.status)
    }
    return body
  }

  /** Resolve the active user id: explicit > env > active-user endpoint > 'web-user'. */
  async activeUserId(supplied) {
    const explicit = typeof supplied === 'string' ? supplied.trim() : ''
    if (explicit) return explicit
    const env = process.env.SCHOLAR_HARNESS_USER_ID?.trim() ?? ''
    if (env) return env
    try {
      const response = await this.json('/api/meta-analysis/active-user')
      const userId = response?.data?.userId
      if (typeof userId === 'string' && userId.trim()) return userId.trim()
    } catch {
      // The health tool reports availability; keep the legacy fallback.
    }
    return 'web-user'
  }

  /** Health probe: service reachable + active user + R plugin status. */
  async health() {
    try {
      const activeUserId = await this.activeUserId()
      let rPlugin
      try {
        const r = await this.json('/api/r-code/plugin/status')
        rPlugin = {
          available: typeof r?.data?.available === 'boolean' ? r.data.available : undefined,
          label: typeof r?.data?.label === 'string' ? r.data.label : undefined,
        }
      } catch {
        // R plugin status is informational; service health is the real gate.
      }
      return { reachable: true, activeUserId, rPlugin }
    } catch (error) {
      return {
        reachable: false,
        activeUserId: 'web-user',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** List the user's literature library with its summary. */
  async literature(userId) {
    const resolved = await this.activeUserId(userId)
    const data = await this.json(`/api/literature/${encodeURIComponent(resolved)}`)
    const papers = Array.isArray(data.papers)
      ? data.papers.map((p) => ({ ...p, authors: Array.isArray(p.authors) ? p.authors : [] }))
      : []
    return {
      success: data.success !== false,
      count: papers.length,
      papers,
      summary: data.summary && typeof data.summary === 'object' ? data.summary : null,
    }
  }

  /** Hybrid retrieval over the literature library. */
  async literatureSearch(options) {
    try {
      const data = await this.json('/api/literature/search', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: options.query,
          topK: options.topK ?? 10,
          mode: options.mode ?? 'hybrid',
        }),
      })
      const retrieval = data?.data
      return {
        success: data?.success !== false,
        query: options.query,
        totalCount: typeof retrieval?.totalCount === 'number' ? retrieval.totalCount : 0,
        results: Array.isArray(retrieval?.results) ? retrieval.results : [],
        strategy: typeof retrieval?.pipeline?.strategy === 'string' ? retrieval.pipeline.strategy : undefined,
      }
    } catch (error) {
      return {
        success: false,
        query: options.query,
        totalCount: 0,
        results: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** PDF Wiki build status (queue summarized to counters). */
  async pdfWikiStatus(userId) {
    const resolved = await this.activeUserId(userId)
    try {
      const data = await this.json(`/api/pdf-wiki/status?userId=${encodeURIComponent(resolved)}`)
      const queue = data.queue && typeof data.queue === 'object' ? data.queue : {}
      return {
        success: data.success !== false,
        status: typeof data.status === 'string' ? data.status : undefined,
        totalPdfs: typeof data.totalPdfs === 'number' ? data.totalPdfs : undefined,
        processedPdfs: typeof data.processedPdfs === 'number' ? data.processedPdfs : undefined,
        entryCount: typeof data.entryCount === 'number' ? data.entryCount : undefined,
        sentencePointCount: typeof data.sentencePointCount === 'number' ? data.sentencePointCount : undefined,
        message: typeof data.message === 'string' ? data.message : undefined,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
        queuedJobs: typeof queue.queuedJobs === 'number' ? queue.queuedJobs : undefined,
        runningJobs: typeof queue.runningJobs === 'number' ? queue.runningJobs : undefined,
        completedJobs: typeof queue.completedJobs === 'number' ? queue.completedJobs : undefined,
        failedJobs: typeof queue.failedJobs === 'number' ? queue.failedJobs : undefined,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /** PDF Wiki topic catalog. */
  async pdfWikiTopics(userId) {
    const resolved = await this.activeUserId(userId)
    try {
      const data = await this.json(`/api/pdf-wiki/topics?userId=${encodeURIComponent(resolved)}`)
      const topics = Array.isArray(data.topics) ? data.topics : []
      return {
        success: data.success !== false,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
        topics: topics.map((t) => ({
          id: typeof t.id === 'string' ? t.id : undefined,
          label: typeof t.label === 'string' ? t.label : undefined,
          description: typeof t.description === 'string' ? t.description : undefined,
          expandedBy: typeof t.expandedBy === 'string' ? t.expandedBy : undefined,
        })),
      }
    } catch (error) {
      return { success: false, topics: [], error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** Meta analysis database summary. */
  async metaDatabase(userId) {
    const resolved = await this.activeUserId(userId)
    try {
      const data = await this.json(`/api/pdf-wiki/meta?userId=${encodeURIComponent(resolved)}&summary=1`)
      return {
        success: data.success !== false,
        userId: typeof data.userId === 'string' ? data.userId : undefined,
        generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : undefined,
        pdfCount: typeof data.pdfCount === 'number' ? data.pdfCount : undefined,
        referenceCount: typeof data.referenceCount === 'number' ? data.referenceCount : undefined,
        items: Array.isArray(data.items) ? data.items : [],
      }
    } catch (error) {
      return { success: false, items: [], error: error instanceof Error ? error.message : String(error) }
    }
  }
}
