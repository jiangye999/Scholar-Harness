# Scholar Harness：对话架构 P0–P2 优化实现记录

> 版本：v1.0（对应 2026 年基线，代码基线 Scholar Harness 1.0.8）
> 关联文档：`docs/pi-agent-cache-and-dsh-plan.md`（Phase 0-6 已完成后的新一轮优化）
> 目标读者：接手该项目的 Agent 与开发负责人

---

## 0. 一句话目标

在上一轮 Phase 0-6（三段式 Prompt、追加式会话日志、compaction、缓存计量、强制 steering）基础上，
补齐 P0–P2 三档共 8 个优化项：**投影缓存、自动 compaction、存储归一、工具可见性、章节并行、
同域重试、请求结构诊断、Codex resume 核查**。全部为路线 C（设计移植）的延续，不引入 DSH 本体。

---

## 1. P0（一致性/性能基础）

### P0-1 ✅ SessionLog 增量投影缓存

**问题**：`deriveMessages()` 每次调用全量遍历事件 + 重建 shadowed 集合（O(n)）；写作会话每轮 50k chars、几十轮后每轮请求前都要重算。文档 B.1 规划的投影缓存未落地。

**改动**（`src/server/services/session-log.ts`）：
- 新增 `derivedCache` 内存投影缓存：`append()` 时增量追加（O(新事件)），`compact` 事件使缓存失效、下次一次性重建；
- 新增 `deriveMessagesWithStats(options?)` → `{ messages, totalHistoryChars, droppedChars, historyMessageCount }`，`deriveMessages` 委托给它（对外行为不变）；
- `droppedChars > 0` 即「预算截断发生」的溢出信号，供 P0-2 触发强制压缩。

**测试**：`__tests__/services/session-log.test.ts` 新增 4 例（统计字段、增量一致性含磁盘重载对照、compact 失效重建、queue 事件只记录不上屏）。

### P0-2 ✅ 自动 compaction 接入三条消息路径

**问题**：`runCompaction` 只有手动 `/compact` 端点；超预算时靠 `trimDerivedToBudget` **静默丢最老轮次**，信息直接丢失。

**改动**：
- `src/server/services/compaction.ts`：新增 `considerAutoCompaction`（压力阈值触发 + `force` 溢出强制触发 + per-log 并发护栏）与共享 `buildCompactionSummaryPrompt`；
- `src/server/routes/chat-bridge.ts` 主聊天：每轮完成后 fire-and-forget 触发；请求时 `deriveMessagesWithStats` 检测到 `droppedChars > 0` → 标记溢出 → 该轮结束后强制压缩（`sessionLogOverflow` WeakMap）；
- `src/server/unified-chat-processor.ts`：同上（压力 + 溢出），总结器用 secondaryModel；
- `src/server/routes/meta-analysis.ts` + `src/server/local-server.ts`：Meta 会话接入，`CreateMetaAnalysisRouterOptions` 新增可选 `summarizeConversationRange`，local-server 用 chatBridge secondary 接线。

**测试**：`__tests__/services/compaction.test.ts` 新增 5 例（低于阈值跳过、force 强制压缩、默认阈值、总结器失败不动日志、prompt 确定性有界）。

### P0-3 ✅ PI 队列 ↔ SessionLog 审计归一

**问题**：`cancelMessage`/`requeueMessage` 只改 PI 队列，SessionLog 无痕迹；「model-visible means logged」不完整。

**改动**：
- `session-log.ts` 新增 **log-only** 事件类型 `queue`（`cancelled | requeued | applied`），`sanitizeEvent` 校验、`deriveMessages` 永远不上屏；
- chat-bridge 撤回/重新排队端点与 run 内 `requeueSteeringMessage`、meta `requeueSteeringMessage` 均追加审计事件；
- **关键护栏**：审计事件只在日志已存在（`lastSeq() > 0`）时追加，绝不把空日志用纯审计事件 seed（否则会阻塞 `resolveChatSessionLog` 的历史 seed 语义）。

**测试**：session-log 新增 queue 事件测试（记录但不派生、磁盘重载保留）。

---

## 2. P1（结构性收益）

### P1-4 ✅ 工具事件可见性（完整执行轨迹）

**问题**：session-log 定义了 `tool` 事件但**没有任何地方写入**；replay/调试看不到模型执行了哪些工具。

**改动**：
- `src/server/routes/chat-bridge.ts` `chatWithAgentToolsLoop`：新增可选 `sessionLog` 参数，每个工具调用结果就绪后追加 `{ type:'tool', name, output(≤4000字符摘要), ok }`（两处调用点已接线）；
- `src/server/unified-chat-processor.ts` `processToolCalls`：save_memory / save_draft / sentence_search 三条工具路径分别落审计（成功/失败/被 query-intent 拦截）。

**说明**：工具结果对模型的可见性由工具循环自身回灌保证（不属本轮改动范围）；日志侧补齐审计轨迹供回放与诊断。

### P1-5 ✅ 章节级并行编排 + 失败隔离

**问题**：`conversation-flow.ts` 章节写作是顺序 for 循环，整章失败整章报废；`parallel-search-orchestrator` 单句检索失败 `Promise.all` 毁掉整批。

**改动**：
- `workflows/conversation-flow.ts` `startWriting`：章节任务 `Promise.allSettled` 并行执行，输出按原章节顺序汇总；每章逻辑抽为 `writeChapter()`（内部 try/catch 隔离，失败只影响该章，`writingProgress` 照常记录失败原因）；
- `agents/parallel-search-orchestrator.ts`：逐句 `.catch` 降级为空结果 + `error` 字段，单句失败不再中断整批。

**并发安全性**：已核查 `AgentCollaborationWorkflow.execute` 无实例级可变状态（仅 `cloudTopicSkillContent` 记忆化缓存，良性竞态）；检索为只读。

### P1-6 ✅ Meta provider 兜底链同域重试

**问题**：Codex→小牛马→大牛马 fallback 每次切换 provider/model 都换 LLM 缓存域，瞬态失败也直接浪费已建立的前缀。

**改动**（`src/server/local-server.ts`）：新增 `callMetaAnalysisPiAgentWithRetry`——同 provider/model 重试 1 次后再换域；三处调用点（codex/secondary/primary）全部替换。

---

## 3. P2（可观测性/稳定性）

### P2-7 ✅ 请求结构诊断

**问题**：cache-metrics 有命中率，但缺「system 是否字节稳定、历史被截多少、快照 section 哪些变化」的请求级诊断，命中率上不去时无法定位。

**改动**：
- `src/server/routes/chat-bridge.ts` 主聊天：每轮计算并发出 `prompt-structure` 诊断事件（run 事件 + 日志）：
  `systemHash`（sha256 前 16 位）、`systemStable`（跨轮对比，进程内 Map，上限 2000 条）、`historyMessageCount`、`historyTotalChars`、`historyDroppedChars`、`snapshotSections`（复用 `precomputedAgentContext.diagnostics.includedSections`）、`promptChars`；
- `scripts/cache-baseline.js`：新增 `--diagnostics` 选项，replay 每轮后读取 `/pi/sessions/:conversationId` 的 run 事件打印结构诊断行。

### P2-8 ✅ Codex resume 前缀稳定性核查

**结论**：resume 轮已不重发完整历史（`buildCodexResumePrompt` 只带当前请求 + ≤20 条 UI 可见交接消息 + 规则；App Server 线程自己保留状态），前缀稳定成立，无需结构性改动。

**改动**：`src/bridge/chat-bridge/chat-bridge.ts` `runCodexAppServer` resume 轮补一条诊断日志（thread id、resume prompt 字符数、未重发的历史消息数），使该行为可观测。

---

## 4. 验证

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 干净 |
| `npm run build`（含 check-public-js） | ✅ 通过（29 script + 11 style） |
| session-log 测试 | ✅ 12/12 |
| compaction 测试 | ✅ 12/12 |
| cache-metrics / token-meter / llm-client / orchestrator | ✅ 全绿 |
| agents + workflows（conversation-flow 改动） | ✅ 31/31 |
| meta-analysis-pi-agent / shared-agent / chat-bridge-agent-resources | ✅ 11/11 |
| 全量 vitest | 待后台作业结果（见下） |

**已知非本轮的失败**：`__tests__/public/query-intent-orchestration.test.ts:78` 断言
`MAIN_CHAT_EXTERNAL_LITERATURE_COLLECTION_ENABLED = false`，而工作区源码（会话前已有脏改动）为 `= true`
（`git show HEAD` 证实 HEAD 是 `false`）——既有脏状态不一致，与本次改动无关，未触碰。

---

## 5. 遗留操作项（需要活环境）

1. 用 `node scripts/cache-baseline.js replay --twice --diagnostics` 连真实 provider 验证：
   - 命中率 ≥40% 目标（Phase 1 遗留验收）；
   - 长会话下 `historyDroppedChars` 不再增长（自动 compaction 生效）、`systemStable=true` 持续成立。
2. 仓库既有脏改动（index.html/styles/chat-bridge 桥层、query-intent 测试断言）由仓库所有者处理。
