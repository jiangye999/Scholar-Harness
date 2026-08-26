/**
 * dsh-meta-analysis — host half. Mounts the Meta analysis engine (local JSON
 * storage + pure-JS statistics), the /api/dsh-meta route family, the agent
 * tools (dsh_meta_health, dsh_meta_sources, dsh_meta_inspect, dsh_meta_run,
 * dsh_meta_analyses), and a system-prompt announcement. Data lives entirely
 * under $DSH_HOME/meta-analysis — zero connection to Scholar Harness.
 */

import { MetaEngine } from './engine.js'
import { makeMetaRoutes } from './routes.js'
import {
  dshMetaAnalysesTool,
  dshMetaHealthTool,
  dshMetaInspectTool,
  dshMetaRunTool,
  dshMetaSourcesTool,
  dshMetaWritingContextTool,
} from './tools.js'

/** Stable cordis plugin name. */
export const name = 'meta-analysis'

/** Services required before the Meta surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const META_GUIDANCE =
  '本机已安装 dsh-meta-analysis 插件（独立 Meta 分析，复刻 Scholar Harness Meta 模块，数据存 DSH 本地、与 Scholar Harness 服务零关联）：侧边栏「Meta 分析」入口。' +
  '能力：dsh_meta_health 检查本地数据与项目、dsh_meta_sources 研究来源/编码表、dsh_meta_inspect 变量与候选结果预检、dsh_meta_run 运行分析（lnRR/MD/SMD、固定/随机效应、异质性、亚组、mean-only bootstrap、R 脚本与报告）、dsh_meta_analyses 历史结果。' +
  '流程：先在 GUI 面板添加研究来源并填写编码表（处理组/对照组均值、SD、n 等列），再 inspect → 配置效应量映射 → run → 查看结果与导出。' +
  '限制：效应量与汇总统计为本地计算；R/metafor 脚本与 CSV 报告生成后可在任何 R 环境执行；数据只存在于 DSH 本地用户目录。用户提到「Meta 分析/编码表/效应量/异质性/亚组」时即指本插件，请据此协作。'

/**
 * Mount the engine, routes, tools, and announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (composition entry values; no schema).
 */
export function apply(ctx, config = {}) {
  const enabled = config.enabled !== false
  const engine = new MetaEngine({
    dataRoot: config.dataRoot,
    userId: config.userId,
    projectId: config.projectId,
  })

  const tools = [
    dshMetaHealthTool(engine),
    dshMetaSourcesTool(engine),
    dshMetaInspectTool(engine),
    dshMetaRunTool(engine),
    dshMetaAnalysesTool(engine),
    dshMetaWritingContextTool(engine),
  ]
  const routes = makeMetaRoutes({ store: engine.store, engine })

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
        name: 'plugin:dsh-meta-analysis',
        order: SECTION_ORDER,
        text: META_GUIDANCE,
      })
    }
    disposeRoutes = ctx.effect(
      () => {
        const disposers = routes.map(route => ctx.webServer.register(route))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-meta-analysis: routes',
    )
    disposeTools = ctx.effect(
      () => {
        const disposers = tools.map(tool => ctx.tools.register(tool))
        return () => { for (const dispose of disposers) dispose() }
      },
      'dsh-meta-analysis: tools',
    )
  }

  sync()
  ctx.on('dispose', () => { if (disposeSection) disposeSection(); if (disposeRoutes) disposeRoutes(); if (disposeTools) disposeTools() })
}
