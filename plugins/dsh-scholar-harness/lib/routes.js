/**
 * The /api/dsh-scholar route family: health, literature, literature search,
 * PDF Wiki status/topics, and Meta database summary. Every route carries a
 * loopback-only trust fence (plus browser same-origin markers) — these
 * endpoints surface the user's local academic workspace, so LAN-exposed dsh
 * web deployments must not serve them.
 */

/** Cap on JSON request bodies (search payloads are small). */
const MAX_JSON_BODY_BYTES = 64 * 1024

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

/** Read a small JSON request body (undefined when too large or unparseable). */
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

/** Build a loopback-fenced GET route. */
function get(path, handler) {
  return {
    kind: 'exact',
    path,
    handler: async (req, res) => {
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { error: 'loopback only' })
        return
      }
      try {
        await handler(req, res, new URL(req.url ?? '/', 'http://x'))
      } catch (error) {
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}

/**
 * Build the /api/dsh-scholar route list.
 * @param deps - { engine } the ScholarHarnessClient the routes read through.
 * @returns the WebRoute list to register.
 */
export function makeScholarRoutes(deps) {
  const { engine } = deps
  return [
    get('/api/dsh-scholar/health', async (_req, res) => {
      writeJson(res, 200, { result: await engine.health() })
    }),

    get('/api/dsh-scholar/literature', async (_req, res, url) => {
      const userId = queryParam(url, 'userId')
      writeJson(res, 200, { result: await engine.literature(userId) })
    }),

    {
      kind: 'exact',
      path: '/api/dsh-scholar/literature/search',
      handler: async (req, res) => {
        if (!isLoopbackRequest(req)) {
          writeJson(res, 403, { error: 'loopback only' })
          return
        }
        const body = await readJsonBody(req)
        const query = typeof body?.query === 'string' ? body.query.trim() : ''
        if (!query) {
          writeJson(res, 400, { error: 'query is required' })
          return
        }
        const topK = typeof body?.topK === 'number' ? body.topK : 10
        const mode = body?.mode === 'bm25' || body?.mode === 'vector' ? body.mode : 'hybrid'
        try {
          writeJson(res, 200, { result: await engine.literatureSearch({ query, topK, mode }) })
        } catch (error) {
          writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    },

    get('/api/dsh-scholar/pdf-wiki/status', async (_req, res, url) => {
      const userId = queryParam(url, 'userId')
      writeJson(res, 200, { result: await engine.pdfWikiStatus(userId) })
    }),

    get('/api/dsh-scholar/pdf-wiki/topics', async (_req, res, url) => {
      const userId = queryParam(url, 'userId')
      writeJson(res, 200, { result: await engine.pdfWikiTopics(userId) })
    }),

    get('/api/dsh-scholar/meta', async (_req, res, url) => {
      const userId = queryParam(url, 'userId')
      writeJson(res, 200, { result: await engine.metaDatabase(userId) })
    }),
  ]
}
