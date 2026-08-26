/**
 * dsh-scholar-harness — host half. Mounts the Scholar Harness HTTP engine
 * (local desktop service, default http://127.0.0.1:18789), the
 * /api/dsh-scholar route family, the agent tools (scholar_health,
 * scholar_literature_list, scholar_literature_search, scholar_pdf_wiki_status,
 * scholar_pdf_wiki_topics, scholar_meta_sources), and a system-prompt
 * announcement. The browser half (./client) renders the sidebar entry and the
 * overview/literature/PDF Wiki/Meta panel. Everything rides official DSH SDK
 * packages — no dsh source changes.
 */

import { ScholarHarnessClient } from './engine.js'
import { makeScholarRoutes } from './routes.js'
import {
  scholarHealthTool,
  scholarLiteratureListTool,
  scholarLiteratureSearchTool,
  scholarMetaSourcesTool,
  scholarPdfWikiStatusTool,
  scholarPdfWikiTopicsTool,
} from './tools.js'

/** Stable cordis plugin name. */
export const name = 'scholar-harness'

/** Services required before the Scholar Harness surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const SCHOLAR_GUIDANCE =
  '本机已安装 dsh-scholar-harness 插件（Scholar Harness 学术写作助手接入 DSH）：侧边栏「Scholar」入口（概览/文献/PDF Wiki/Meta 面板）。' +
  '能力：scholar_health 检查本地 Scholar Harness 服务、scholar_literature_list 文献库、scholar_literature_search 混合检索、' +
  'scholar_pdf_wiki_status 句子级证据库状态、scholar_pdf_wiki_topics 证据主题、scholar_meta_sources Meta 分析数据库。' +
  '限制：需要本机 Scholar Harness 桌面服务已启动（默认 http://127.0.0.1:18789）；数据与桌面软件同一用户目录；' +
  '检索/状态为只读，论文写作与 Meta 全流程仍应引导用户到 Scholar Harness 桌面端完成。用户提到「文献库/PDF Wiki/证据库/Meta 分析状态」时即指本插件，请据此协作。'

/**
 * Mount the engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (composition entry values; no schema).
 */
export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false
  const engine = new ScholarHarnessClient({
    baseUrl: config.baseUrl ?? process.env.SCHOLAR_HARNESS_URL,
    timeoutMs: config.timeoutMs,
  })

  // Build surfaces once; register (or drop) them to match config.
  const tools = [
    scholarHealthTool(engine),
    scholarLiteratureListTool(engine),
    scholarLiteratureSearchTool(engine),
    scholarPdfWikiStatusTool(engine),
    scholarPdfWikiTopicsTool(engine),
    scholarMetaSourcesTool(engine),
  ]
  const routes = makeScholarRoutes({ engine })

  let disposeSection
  let disposeRoutes
  let disposeTools

  const sync = () => {
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if (disposeRoutes !== undefined) { disposeRoutes(); disposeRoutes = undefined }
    if (disposeTools !== undefined) { disposeTools(); disposeTools = undefined }
    if (!enabled) return
    if (config.announceToAgent !== false) {
      disposeSection = ctx.systemPrompt.section({
        name: 'plugin:dsh-scholar-harness',
        order: SECTION_ORDER,
        text: SCHOLAR_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-scholar-harness: routes',
    )
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-scholar-harness: tools',
    )
  }

  sync()
  ctx.on('dispose', () => { if (disposeSection) disposeSection(); if (disposeRoutes) disposeRoutes(); if (disposeTools) disposeTools() })
}
