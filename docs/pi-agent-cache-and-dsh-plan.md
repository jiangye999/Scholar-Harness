# Scholar Harness：PI Agent 缓存命中优化 + DeepSeek Harness 集成落地计划

> 版本：v1.5（Phase 0-6 + 在途功能完成，见 §15）
> 适用代码基线：Scholar Harness 1.0.8；DeepSeek Harness（dsh）开发者预览版
> 目标读者：接手该项目的 Agent 与开发负责人

---

## 0. 一句话目标

在不牺牲"AI 输出必须过引用校验、长任务必须有进度反馈、用户指令永不丢失"三条产品底线的前提下：

1. 把主聊天 / Meta AI / 论文写作链路的 LLM 前缀缓存命中率从"≈0"提升到可量化、可监控、可持续的水平；
2. 以最小风险路线评估并（按决策门）落地 DeepSeek Harness 的能力，而不是强行整体替换现有架构。

**KPI（Phase 0 建立基线后每月复核）**

| 指标 | 当前 | 目标（Phase 1 完成后） | 目标（Phase 2-3 完成后） |
|---|---|---|---|
| cacheReadTokens 占总输入 token 比例 | 未知（未计量） | ≥ 40% | ≥ 60% |
| 平均每轮真实付费 input token | 基线后测得 | 下降 ≥ 35% | 下降 ≥ 55% |
| 历史保留度（模型可见的完整消息轮数） | 4 条（handoff 压缩） | ≥ 20 条完整消息 | 无上限（靠 compaction 管理） |
| steering 注入成功率（一次 run 内被消费的 steer 消息占比） | 依赖模型自觉 | — | ≥ 95%（强制注入兜底） |
| 回归测试 | — | 全绿 | 全绿 |

**非目标**
- 不把 DSH 的 Web GUI 嵌进 Scholar Harness（需要 `window.__DSH_BOOT__`，架构上不成立）。
- 不整体替换两级 Agent / PDF Wiki / Meta / 计量管线（风险与收益不成比例）。
- 不做多进程 / 多窗口的 PI 队列并发重构（记为延后项）。

---

## 1. 现状盘点（代码事实，2026 年基线）

### 1.1 现有组件地图

| 组件 | 文件 | 角色 |
|---|---|---|
| PI 会话/队列/run 状态机 | `src/server/services/pi-agent-session.ts` | 每会话单 run、steer/follow_up 队列、事件日志、磁盘持久化 |
| Agent 运行生命周期壳 | `src/server/services/agent-execution-kernel.ts` | begin/assertActive/appendEvent/cancel/complete/settle；断线不取消 run |
| PI 队列 HTTP API | `src/server/routes/chat-bridge.ts:3227-3434` | state/interrupt/messages(POST,PATCH,DELETE)/claim/requeue/clear |
| 主聊天 run 接线 | `src/server/routes/chat-bridge.ts:3868-3903, 4513-4542` | claim 校验、begin、piSession 运行时注入、SSE 持久化 |
| Meta AI run 接线 | `src/server/routes/meta-analysis.ts:941-1229` | 同上，+自动副本整理/效应量/R 出图 |
| Meta provider 兜底链 | `src/server/local-server.ts:2002-2148` | Codex CLI → 小牛马(secondary) → 大牛马(primary) |
| Prompt 预算与组装 | `src/orchestrator/agent-context-budget.ts:482-568` | precomputeAgentContext：catalog/skill/handoff(≤4 条)/prompt 预算 |
| 当前请求锚定 | `src/utils/prompt-request-anchor.ts` | anchorPromptWithCurrentRequest 追加 CURRENT_USER_REQUEST |
| 主聊天 system prompt | `src/server/services/chat-system-prompt.ts` | buildChatSystemPrompt |
| 对话持久化（现状） | `src/server/routes/memory.ts:3852-3971` | conversations/<id>.json 全量覆写式 |
| 另一条聊天路径 | `src/server/unified-chat-processor.ts` | unified-chat 处理器，同样有内联上下文问题 |
| 前端队列 UI | `src/public/app/chat.js`、`src/public/app/meta-analysis.js`、`src/public/app/chat-context.js` | .pi-agent-message 气泡队列面板、steer/follow_up 计数 |
| 现有测试 | `__tests__/server/services/pi-agent-session.test.ts`、`__tests__/server/meta-analysis-pi-agent.test.ts`、`__tests__/public/pi-agent-queue.test.ts` | 队列与 kernel 契约 |

### 1.2 缓存失效根因（按影响排序）

1. **每轮全量重拼 user 消息**：请求 = `[system, user(enrichedMessage)]`；记忆、文献、工作区、前端状态、技能目录、4 条压缩 handoff、当前请求全部内联进同一条 user 消息。下一轮与上一轮从第 N 个 token 起就不同 → 前缀缓存近乎 0 命中。
2. **system 含动态内容**：`buildChatSystemPrompt()` 若拼接页面状态/上下文，会让 system 本身不稳定（system 是缓存前缀的第一段，最贵）。
3. **历史只有 4 条 handoff**：`agent-context-budget.ts:509-511` `slice(-4)`，既破坏缓存前缀又丢上下文。
4. **兜底链换缓存域**：Meta 分析 Codex→小牛马→大牛马 fallback，每次切换 provider/model 全量失效（DSH llm-deepseek README 明确：改 provider/model 选不同缓存域）。
5. **无 cache 计量**：chat 响应只记录 input/output tokens，不解析 `prompt_cache_hit_tokens` / `cached_tokens` → 无法迭代。
6. **序列化不确定**：工具 schema、上下文片段拼接顺序未做确定性约束（对象 key 顺序、缩进变化都会从第一个变化字节起失效）。

---

## 2. 总体路线图与决策门

```
Phase 0 可观测性（0.5-1 天）          ← 没有指标不谈优化
   │
   ▼
Phase 1 Prompt 结构重构（2-3 天）      ← 最高收益、最低风险
   │
   ▼
Phase 2 追加式会话日志（3-4 天）        ← 历史问题的根治
   │
   ▼
Phase 3 Compaction（2-3 天）
   │
   ▼
Phase 4 PI Agent 增强（2-3 天）         ← 队列/日志对齐 + steering 兜底
   │
   ├─────────────── 决策门 G1（Phase 4 后）
   │
   ▼
Phase 5 DSH 集成评估（2 天 spike + 决策）← 决策门 G2
   │
   ▼
Phase 6 回归与发布（1-2 天）
```

**决策门 G1（Phase 4 末）**：Phase 1-3 的真实缓存命中率与成本收益
- 命中率 ≥ 40% 且无回归 → 继续 Phase 4-5；
- 命中率远低于预期 → 停下查 provider 侧缓存策略（是否 DeepSeek 官方 API、是否命中自动前缀缓存），先解决 provider 问题再继续。

**决策门 G2（Phase 5 末）**：DSH 集成路线
- **路线 A**（子进程 SDK 驱动）与**路线 C**（移植设计模式）二选一，判据见 §8.4。

---

## 3. Phase 0：可观测性与基线（0.5-1 天）

**目标**：让"缓存命中率"变成可见指标，建立改造前的基线数据。

### 3.1 改动

1. **新增 `src/server/services/cache-metrics.ts`**：
   - 定义 `CacheUsage { cacheReadTokens?: number; inputTokens: number; outputTokens: number; provider: string; model?: string }`；
   - `recordCacheUsage(usage)`：按 provider/model/会话聚合，追加式写入 `<dataDir>/cache-metrics/<yyyy-mm>.jsonl`（原子写，防抖）；
   - `getCacheStats(userId?, windowMs?)`：命中率 = cacheReadTokens / (inputTokens + cacheReadTokens)。
2. **解析链路**：
   - `src/bridge/chat-bridge/chat-bridge.ts` 的 `chat()` 返回体中透出 usage（若底层 API 兼容响应含 `prompt_tokens_details.cached_tokens` 或 `prompt_cache_hit_tokens`）；
   - 主聊天 `chat-bridge.ts:4616+` 的 `recordTurnUsage` 扩展为同时调 `recordCacheUsage`；
   - Meta `local-server.ts:2002-2056` 的 `callMetaAnalysisPiAgent` 返回值同样透出并记录。
3. **前端展示（最小）**：聊天气泡完成事件里附带 `cache: { hitRatio, readTokens }`，在消息尾部小字展示；`meta-analysis.js` / `chat.js` 各加一处。

### 3.2 基线脚本

`scripts/cache-baseline.js`：用固定 3 组会话脚本（主聊天 ×10 轮、Meta 规划 ×5 轮、论文写作 ×8 轮）跑两遍（第二遍测缓存），输出每轮 cacheReadTokens/总 input/命中率表格。存入 `artifacts/cache-baseline/`。

### 3.3 验收

- 每轮请求日志含 cache 字段；基线脚本产出可复现的表格；命中率数字与预期一致（改造前应接近 0 或不可用）。

### 3.4 风险

- 某些 provider 不返回 cache 字段 → `CacheUsage` 字段可空，命中率按"未知"单独统计，不阻塞。

---

## 4. Phase 1：Prompt 结构重构（2-3 天）——最高收益

**目标**：请求变成 `[稳定 system, ...追加历史, 尾部动态快照]`，前缀字节级稳定，动态内容全部推到尾部并以"supersedes"语义追加。

### 4.1 目标消息结构（与 DSH system-prompt 设计对齐）

```
messages = [
  { role: 'system',  content: SYSTEM_PROMPT },          // 字节级稳定
  ...historyMessages,                                    // 追加式，完整轮次
  { role: 'user',    content: RUNTIME_SNAPSHOT },        // 尾部动态快照
  { role: 'user',    content: CURRENT_USER_REQUEST },    // 最后，模型最新指令
]
```

其中 RUNTIME_SNAPSHOT 的框架文案（对齐 DSH `joinContextSections` 模式）：

```
Current runtime context. This snapshot supersedes earlier runtime-context snapshots.

## Memory …  ## Literature …  ## Workspace …  ## Frontend state …
```

语义规则：
- 快照**只追加、不重写**：某块动态内容本轮没变 → 不重复出现在本轮快照里，或整个快照缺失时仅发送"无变化"占位；变了 → 该块出现在**新**快照（尾部追加），旧前缀不受影响；
- 每轮至多一个快照块集合，内容按固定 section 顺序渲染；
- CURRENT_USER_REQUEST 永远最后，保证"最高优先级"语义不变。

### 4.2 具体改动

1. **新建 `src/orchestrator/prompt-assembler.ts`**（替代分散的拼装逻辑）：
   - `assembleMessages({ systemPrompt, history, snapshotSections, currentRequest }) → Message[]`；
   - section 渲染顺序、变量插值、空白折叠全部确定性（顺序写死，不做动态排序）；
   - 单元测试断言：同样输入两次 → 字节相同；只在尾部追加 → 前缀字节相同。
2. **`src/server/routes/chat-bridge.ts` 改造**：
   - 移除 `precomputeAgentContext` 中把上下文灌进单条 user 消息的路径（保留其预算诊断能力）；
   - `systemMessage` 只保留稳定策略（`chat-system-prompt.ts` 中把页面状态、前端快照类动态内容移出）；
   - 历史改用 Phase 2 的会话日志派生（过渡期先用 `history` 参数中的最近 20 条原始消息，见 §5 时序）；
   - 动态上下文（memory/literature/workspace/frontendState/技能目录）走 `snapshotSections`。
3. **`src/server/unified-chat-processor.ts` 同步改造**：同样的三段式结构；`conversationHistoryContext`（跨会话摘要）移入快照区而非 system。
4. **`src/server/local-server.ts` 的 `callMetaAnalysisPiAgent`**：Meta 的 system 固定（"严格输出 JSON 的 Meta 分析工程 Agent"+Schema），上下文与 chatHistory 移入 history/快照区。
5. **Codex 路径**：`buildCodexResumePrompt`（`src/bridge/chat-bridge/chat-bridge.ts:867+`）保持"resume 轮不重复大块说明"的思想，但把 handoff 改为完整追加历史渲染，而不是重新拼整条 prompt。

### 4.3 验证

- `npx vitest run __tests__/agents __tests__/workflows`（写作链路回归）；
- `node scripts/check-public-js.js && npm run build`；
- 基线脚本重跑：命中率应显著上升（预期 ≥ 40%）；历史完整轮数从 4 → 20。

### 4.4 风险

- system prompt 从"动态"变"静态"可能让部分依赖页面状态的场景丢失上下文 → 过渡方案：动态状态进快照区（user 角色），模型行为不变，只是位置变了；
- 上下文变长 → 必须同步完成 Phase 3 compaction 或先设硬性尾部预算（快照区与历史区各设 maxChars，超限截尾并打日志）。

---

## 5. Phase 2：追加式会话日志（3-4 天）——历史问题的根治

**目标**：把"全量覆写 conversations/<id>.json"升级为追加式事件日志，模型历史由日志派生（对齐 DSH `core/session` 的 "model-visible means logged" 不变量）。

### 5.1 事件模型

`src/server/services/session-log.ts` 新增，事件类型（JSONL 追加写，每行一个事件）：

```ts
type SessionLogEvent =
  | { seq: number; ts: string; type: 'user';      content: string; requestId?: string }
  | { seq: number; ts: string; type: 'assistant'; content: string; usage?: CacheUsage }
  | { seq: number; ts: string; type: 'tool';      name: string; input?: unknown; output?: string; ok: boolean }
  | { seq: number; ts: string; type: 'snapshot';  sections: Record<string, string> }   // 供诊断/回放
  | { seq: number; ts: string; type: 'compact';   summary: string; shadowed: [number, number] }
```

- 存储：`<memoryDir>/<userId>/session-logs/<conversationId>.jsonl`（追加写 + fsync 策略与 pi-agent-session 对齐：普通事件立即写，chunk 类防抖）；
- `deriveMessages(sessionId, options?)`：从日志投影消息列表，**每节点只投影一次、缓存投影结果**（对齐 DSH `Session.deriveMessages` 的 O(新节点) 增量投影），`compact` 事件触发投影缓存重建；
- 迁移：`loadConversationMessages`（`memory.ts:3876`）作为一次性导入源，把旧 conversations JSON 灌成事件日志；读路径保持兼容（`loadConversationMessages` 可继续存在，但 chat-bridge 改走日志）。

### 5.2 接入点

1. `chat-bridge.ts` 主聊天：`history`/`promptHistory` 改为 `sessionLog.deriveMessages()`；每轮把 user/assistant 事件追加进日志；
2. `unified-chat-processor.ts`：同样接入；
3. Meta 会话（`meta-analysis.ts`）用独立 conversationId 命名空间，事件类型复用；
4. **PI 队列对齐**：steer/follow_up 消息在被消费时同步追加为 `user` 事件（来源标记 `steered`/`continued`），保证重连后派生历史一致。

### 5.3 验证

- 新增 `__tests__/services/session-log.test.ts`：追加写、崩溃恢复（半行截断忽略）、投影缓存正确性（compact 后重建）、`deriveMessages` 输出与日志逐节点对应；
- 手工场景：聊天 10 轮后刷新页面 → 派生历史完整；中途 kill 进程 → 日志可恢复且不丢最后已确认事件。

### 5.4 风险

- JSONL 追加与"原子性"冲突：半行写入崩溃 → 读端容忍最后一行损坏（截断忽略），并在打开时做一次 repair 扫描（对齐 DSH session `repair.ts` 思路）；
- 历史变长导致请求超预算 → 交给 Phase 3 compaction + 请求时 `maxHistoryChars` 硬截尾（截尾策略：只丢最老轮次，绝不做"中间挖洞"）。

---

## 6. Phase 3：Compaction（2-3 天）

**目标**：token 压力达到阈值时，把最老的一段历史总结成一条 user-role 检查点，替换原位，尾部不动（对齐 DSH compaction 的 surface replace 语义）。

### 6.1 组件

- **`src/server/services/token-meter.ts`**：`estimateTokens(text)`（字符/token 近似，DSH token-meter 同思路）+ 每会话滚动 token 计数；
- **`src/server/services/compaction.ts`**：
  - `compactionService.consider(sessionId, trigger: 'pressure'|'overflow')`：返回是否执行；
  - 阈值：派生历史 > 预算上限（如 110k chars）或 token 估算 > 阈值（如 60k）时触发；
  - 选区间：**只动最老区间**，`assistant` 消息与其配套 tool 事件成对切割（对齐 DSH tool-pairing 边界：区间边缘不允许悬空 tool call）；
  - 执行：调 LLM 总结 → 追加 `compact` 事件（含 summary 与 shadowed 区间）→ `deriveMessages` 投影重建，把 summary 渲染为 user-role 消息后接保留尾部；
  - 语义明确：compaction 事件**不入表面**（不给模型看），只在日志留痕（对齐 DSH `compaction/*` 事件 log-only 设计）。
- **`/compact` 用户命令**（可选 MVP）：`src/server/routes/chat-bridge.ts` 加一个手动触发端点（对齐 DSH `command-compact`）。

### 6.2 验证

- `__tests__/services/compaction.test.ts`：压力触发、区间边界不切 tool 对、崩溃恢复（start 无 end 视为孤儿锁）、替换后派生历史正确；
- 实测：超长会话首轮 token 成本下降，且最近 20 轮内无被压缩内容时命中率不受影响（compaction 只动头部）。

### 6.3 风险

- 总结丢失细节 → summary 里强制包含"可回溯的 shadowed seq 区间"，配合前端"查看被压缩内容"入口（读 JSONL 原事件）；
- 自动 compaction 与正在进行的 run 并发 → 复用 pi-agent-session 的 `activeRuns` 锁判断，run 中不触发。

---

## 7. Phase 4：PI Agent 增强（2-3 天）

### 7.1 目标

1. steering 注入从"模型自觉"升级为"强制兜底"；
2. 队列状态与 Session Log 对齐（重连后派生历史一致）；
3. 缓存指标接入队列 UI。

### 7.2 改动

1. **强制注入兜底**（`agent-execution-kernel.ts` / provider 层）：
   - provider 的 `piSession` 运行时增加 `steeringDeadlineMs`（默认 30s）：模型每轮工具循环若未调用 `takeSteeringMessages`，由宿主在下一轮**强制拼接**队列中的 steer 消息为最高优先级 user 输入（不可被模型忽略），并标记 `markSteeringApplied`；
   - `takeSteeringMessages` 返回后附带消息到达时间戳，注入前检查是否已被用户撤回（`requeueSteeringMessage` 语义保持）。
2. **队列↔日志对齐**（§5.2.4）：steer/follow_up 消费即写 `user` 事件，`completionMode` 记入事件 payload；
3. **UI**：`chat.js`/`meta-analysis.js` 队列面板显示本轮 cache 命中率小字 + "缓存命中 62%"徽标；`pi-agent-message` 样式扩展（注意 `check-public-js.js` 通过）；
4. **run 事件日志升级**：`PiPersistedRun.events` 与 Session Log 关联（runId 作为事件字段），中断重连时前端可同时恢复 run 转写与派生历史。

### 7.3 验证

- `__tests__/server/meta-analysis-pi-agent.test.ts`、`__tests__/public/pi-agent-queue.test.ts` 扩展：强制注入用例、撤回竞态用例；
- 手工：运行 Meta AI 时不发消息 → 30s 后注入空 steer 不报错；run 中发 steer → 下一轮必被消费。

---

## 8. Phase 5：DSH 集成评估（2 天 spike + 决策）

### 8.1 Spike 目标（验证可行性硬事实）

用最小 Demo 验证子进程驱动可行性（**不改产品代码**，放 `artifacts/dsh-spike/`）：

1. 用 DSH 仓库当前代码构建 headless runtime（`pnpm build` 后 `dsh --profile headless`）；
2. 写 `scripts/dsh-sdk-spike.ts`：spawn runtime → SDK client `initialize` → `session/prompt` → 订阅 `session.event`/`session.status` → 收到 assistant 输出；
3. 测量并记录：runtime 进程内存（V8 heap）、启动到可服务延迟、产物体积（打包后额外 MB）、stdin/stdout 协议吞吐；
4. 验证 **steering 等价物**：DSH 的 `agent.inject()`（文档明确"lands in the next admitted request"）能否复现 PI 的 steer 语义；
5. 验证 **缓存友好性**：DSH SDK 会话里连发 3 轮，观察 `cacheReadTokens` 是否随追加式历史增长而命中。

### 8.2 决策门 G2 判据

| 判据 | 走路线 A（SDK 子进程） | 走路线 C（移植设计） |
|---|---|---|
| Phase 1-3 已实现的缓存收益 | — | 已到手，无需再投 |
| 需要 DSH 的 subagent/workflow/goal 编排 | 需要 | 不需要 |
| 安装包体积容忍（额外 ≥50MB runtime） | 能接受 | 不能 |
| 双进程调试成本（stdio 协议、无 per-prompt 结果） | 可承担 | 不可承担 |
| 需要随 DSH 上游频繁跟进（预览期破坏性变更） | 可接受 | 不可接受 |

- 多数判据指向 **路线 C**：Phase 1-3 已把 DSH 的核心价值（追加式日志、动态快照、compaction）移植完成，路线 A 只应在"确实需要 DSH 的 subagent/workflow 编排能力"时启动。
- 若走 A：**范围锁定**——DSH 只做对话编排（PDF Wiki/Meta/R 仍走 Scholar Harness API），工具能力经 `ctx.tools` 插件注册按需接入；Electron 打包时把 runtime 放进 `resources/`，启动本地服务时 spawn，生命周期绑定主进程退出。

### 8.3 路线 A 的落地形态（若通过决策门）

```
Electron 主进程
  └─ 本地 Express（现有）
       ├─ spawn DSH headless runtime（resources/dsh-runtime/）
       │    └─ stdio JSON-RPC（dsh-sdk-client）
       │         ├─ session/prompt（每会话一个 DSH agent）
       │         ├─ session/event 订阅 → 现有 SSE 管道转发
       │         └─ inject（steer 语义映射）
       └─ 现有 API（PDF Wiki / Meta / R / 计量）不变
```

**明确不做**：DSH Web GUI 复用、`window.__DSH_BOOT__` 注入、双 Web 前端共存。

### 8.4 风险

- 预览期破坏性变更 → 锁版本 + 记录升级成本；
- stdio 协议无 per-prompt 结果 → 用现有 PI 队列的 messageId/claim 语义定义"完成"，已在设计中对齐；
- 双进程状态不一致 → DSH 侧会话由 DSH 持久化，Scholar Harness 侧只存映射（conversationId ↔ dsh sessionId）。

---

## 9. Phase 6：回归与发布（1-2 天）

### 9.1 回归清单（对齐 AGENTS.md）

```bash
npm run build
npm test
npx vitest run __tests__/agents
npx vitest run __tests__/workflows
npx vitest run __tests__/server/services/pi-agent-session.test.ts
npx vitest run __tests__/server/meta-analysis-pi-agent.test.ts
npx vitest run __tests__/public/pi-agent-queue.test.ts
npx vitest run __tests__/utils/autoresearch-manager.test.ts
node scripts/check-public-js.js
```

### 9.2 发布检查

- 缓存指标开关：默认开，但提供 `settings` 关闭入口（隐私/兼容）；
- 长会话（≥50 轮）稳定性冒烟：compaction 触发、重连恢复、steer 注入、无白屏；
- Electron 打包冒烟（若走路线 A：runtime 资源随包）。

---

## 10. 风险登记册

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | 改动 chat-bridge prompt 结构引发写作/引用回归 | 高 | Phase 1 与 Phase 2 分期、每次跑 `__tests__/agents __tests__/workflows`；先灰度 Meta 路径（独立命名空间） |
| 2 | 上下文变长超预算 | 高 | 尾部硬截尾 + Phase 3 compaction 并行推进 |
| 3 | 命中率提升依赖 provider 侧缓存策略（DeepSeek 官方 API 才有保证） | 中 | Phase 0 先确认各 provider 是否返回 cache 字段；主力模型锁定 DeepSeek |
| 4 | 历史改写引入"模型看到与用户看到不一致" | 中 | "model-visible means logged"不变量 + 前端展示派生历史来源 |
| 5 | JSONL 追加写损坏 | 低 | 尾部半行容忍 + repair 扫描（对齐 pi-agent-session 原子写经验） |
| 6 | DSH 预览期 API 变动 | 中 | 锁版本；决策门 G2 默认路线 C |
| 7 | 双进程（路线 A）调试成本 | 中 | spike 先行；stdio 日志走 stderr 分离 |

---

## 11. 时间线与里程碑（建议 3 周，单人全栈）

| 周 | 里程碑 | 交付 |
|---|---|---|
| W1 | Phase 0-1 完成 | 缓存指标上屏 + 基线表 + 三段式 prompt 上线（Meta 先行灰度） |
| W1.5 | 决策门 G1 | 命中率数据 → 继续/止损 |
| W2 | Phase 2-3 完成 | Session Log + compaction 上线，历史 ≥20 轮 |
| W3 | Phase 4-6 完成 | PI 强制注入 + 回归全绿 + 发布 |
| W3.5 | 决策门 G2（DSH spike 报告） | 路线 A/C 结论文档 |

---

## 12. 附录 A：DSH 组件 → Scholar Harness 落地点映射

| DSH 组件 | 价值 | 落地点（路线 C） | 落地点（路线 A） |
|---|---|---|---|
| `core/system-prompt`（分区注册 + supersedes 快照） | 前缀稳定 | `src/orchestrator/prompt-assembler.ts`（Phase 1） | 直接用 DSH 原生 |
| `core/session`（追加式事件日志 + deriveMessages 投影缓存） | 历史根治 | `src/server/services/session-log.ts`（Phase 2） | DSH 原生会话 + 映射表 |
| `compaction/*`（压力触发 + surface replace + tool 配对边界） | 上下文管理 | `src/server/services/compaction.ts`（Phase 3） | DSH 原生 + `/compact` |
| `llm/llm-deepseek`（cacheReadTokens 计量） | 指标 | `src/server/services/cache-metrics.ts`（Phase 0） | 沿用 DSH 适配器 |
| `sdk/*`（stdio JSON-RPC） | 进程外驱动 | 不适用 | 路线 A 核心 |
| `core/agent-loop`（turn/step 事件流） | 编排 | 已有 PI kernel 等价物 | 用 DSH 原生 |
| `goal`/`workflow`/`subagent` | 长目标编排 | 移植 design（延后） | 直接可用 |

---

## 13. 附录 B：关键接口草案

### B.1 `session-log.ts`（Phase 2 核心）

```ts
export interface SessionLog {
  append(event: Omit<SessionLogEvent, 'seq' | 'ts'>): Promise<SessionLogEvent>;
  deriveMessages(opts?: { maxChars?: number; sinceSeq?: number }): DerivedMessage[];
  compact(range: { start: number; end: number }, summary: string): Promise<void>;
  replay(): AsyncIterable<SessionLogEvent>;
}

// DerivedMessage: { role: 'user'|'assistant'|'system'; content: string; source: 'history'|'snapshot'|'compact'|'request' }
```

### B.2 `prompt-assembler.ts`（Phase 1 核心）

```ts
export function assembleMessages(input: {
  systemPrompt: string;                 // 必须字节稳定
  history: DerivedMessage[];            // 追加式
  snapshotSections: Array<{ name: string; order: number; text: string }>; // 尾部快照
  currentRequest: string;               // 永远最后
  maxChars?: number;                    // 超限截尾（只丢最老历史）
}): Message[];
```

### B.3 `cache-metrics.ts`（Phase 0 核心）

```ts
export interface CacheUsage {
  provider: 'primary' | 'secondary' | 'codex' | string;
  model?: string;
  inputTokens: number;       // 不含缓存命中
  cacheReadTokens?: number;  // 未知时为 undefined
  outputTokens: number;
}
export function recordCacheUsage(u: CacheUsage): void;
export function getCacheStats(opts?: { userId?: string; since?: Date }): CacheStats;
```

---

## 14. 执行顺序建议（给接手 Agent 的第一条指令）

1. 先做 **Phase 0**（指标 + 基线），确认当前各 provider 是否返回 cache 字段；
2. **Phase 1 只改 Meta 路径**（独立 conversationId 命名空间，风险最小），跑基线对比；
3. 对比通过后再铺开主聊天与 unified-chat；
4. Phase 2/3 并行推进（Session Log 是 compaction 的前提）；
5. Phase 5 的 DSH spike 可与 Phase 2-3 并行（spike 不碰产品代码）。

> 任何一步若与 AGENTS.md 的"容易踩坑"清单冲突（尤其 `src/public/index.html` 改动、打包图标、下载/更新链路），以 AGENTS.md 为准。

---

## 15. 进度记录

### Phase 0 ✅（已完成）

- 新增 `src/server/services/cache-metrics.ts`：`CacheUsageRecord` / `normalizeCacheUsage` / `recordCacheUsage` / `getCacheStats` / `cacheDomainKey`，JSONL 按日追加到 `<dataDir>/cache-metrics/<yyyy-mm-dd>.jsonl`，失败静默（fail-soft）。
- `src/utils/llm-client.ts`：解析 DeepSeek `prompt_tokens_details.cached_tokens` 与 `prompt_cache_hit_tokens`；按 DeepSeek 语义 `inputTokens = prompt_tokens − cache_read`；`LLMTokenUsage.cacheReadTokens` 仅在 provider 明确报告时出现。
- `src/types/index.ts`：`ChatTokenUsage` 增加 `cacheReadTokens?`。
- `src/server/routes/chat-bridge.ts`：`recordTurnUsage` 聚合 cache；`finalizeTurnUsage` 透出；新增 `persistTurnCacheUsage`（stream 与非 stream 两条完成路径都记录，provider 取 `optimizationProvider`）。
- `src/server/local-server.ts`：`callMetaAnalysisPiAgent` 收集 `onUsage` 并记录；结果 `usage` 挂到 `MetaAnalysisAssistantResult`（新增字段，经 `sanitizeMetaAssistantUsage` 消毒）。
- 前端：`src/public/app/chat-history.js` `formatAgentTokenUsage` 追加"缓存命中 N%"；`src/public/app/meta-analysis.js` 规划结果追加 Token 用量行。
- 脚本：`scripts/cache-baseline.js`（`stats` 离线聚合 / `replay` 连活服务器两遍跑基线）。
- 测试：`__tests__/services/cache-metrics.test.ts`（8 例）、`__tests__/utils/llm-client.test.ts` 新增 3 例 cache 解析；全部通过。

### Phase 1 ✅（已完成）

- 新增 `src/orchestrator/prompt-assembler.ts`：`assembleMessages` / `joinSnapshotSections` / `trimHistoryToBudget`；确定性 + 前缀稳定 + 尾部截断。测试 `__tests__/orchestrator/prompt-assembler.test.ts`（7 例）。
- **Meta 路径灰度**：`buildMetaAnalysisAiAssistantPrompt` 重构为 `buildMetaAnalysisAiPromptParts`（单一处模板）+ 两个包装；payload 键序重排为"稳定在前、易变在后"（methodGuide/workspace/excelJsonPacket/…在前，chatHistory/recentQueries/memory/userRequest 在后）；新增 `buildMetaAnalysisAiAssistantMessageParts`；`callMetaAnalysisPiAgent` 对 secondary/primary 用 `assembleMessages({system: stableHead, user: payloadBlock})`，Codex 保持单体 prompt。
- **主聊天** `chat-bridge.ts`：`buildEnrichedMessage` 移除"当前对话历史"散文块；`messagesForChat` 改为 `[system, ...最近 20 条原生历史消息, user(动态上下文+请求锚点)]`（单条仍截断 1800 字符）。Codex 首轮经 `buildCodexPrompt` 原生渲染历史；resume 轮仍走 handoff。
- **unified-chat**：当前请求锚点不再注入 system（改为仅 user 侧 `buildAnchoredUserMessage`），system 保持会话内稳定。
- 回归：`npx vitest run __tests__/agents __tests__/workflows` 16/16 通过；`__tests__/server/meta-analysis-pi-agent.test.ts` 断言随重构更新（`return chatBridge.chat({` → `await chatBridge.chat({`）；`tsc --noEmit` 干净。
- **待办（需要活环境）**：用 `scripts/cache-baseline.js replay` 对比改造前后命中率，验证 ≥40% 目标；若未达标进入决策门 G1 的止损分支。

### Phase 2 ✅（已完成）

- 新增 `src/server/services/session-log.ts`：JSONL 追加式事件日志（user/assistant/tool/snapshot/compact），seq 单调、崩溃容忍（尾部半行忽略）、`deriveMessages` 增量派生（snapshot 渲染为 supersede 快照、compact 在原位替换为摘要）、`getSessionLog` 注册表 + `clear`。测试 `__tests__/services/session-log.test.ts`（8 例）。
- 接入三处历史派生：
  - 主聊天 `chat-bridge.ts`：`resolveChatSessionLog`（空日志用请求历史一次性种子），历史源改为 `sessionLog.deriveMessages`（50k chars 预算），成功路径 `persistTurnToSessionLog` 追加 user/assistant（含 delivery 与 provider/model）。
  - unified-chat `unified-chat-processor.ts`：同样种子 + 派生（60k），完成后追加本轮。
  - Meta `meta-analysis.ts`：`chatHistory` 优先取自 `metaSessionLog.deriveMessages`，成功路径追加 user/assistant。
- 回归：Phase 0-2 相关 67 例全绿；`tsc --noEmit` 干净。

### Phase 3 ✅（已完成）

- 新增 `src/server/services/token-meter.ts`：复用 CJK-aware 估算 + `SessionTokenMeter` 滚动计数。测试 4 例。
- 新增 `src/server/services/compaction.ts`：`selectCompactionRange`（最老完整轮次、以 assistant 结尾、保留最新 N 条、≤50% 历史）+ `runCompaction`（阈值判断、注入式 summarize、失败不动日志）。测试 7 例。
- 新端点 `POST /api/chat-bridge/pi/sessions/:conversationId/compact`：手动压缩，summarizer 用 secondary provider，不可用时优雅失败。

### Phase 4 ✅（已完成）

- 强制 steering 注入：非 Codex、非工具循环的纯聊天路径（如 Meta ai-plan）在模型调用前强制 `takeSteeringMessages` 并以 `<PI_STEERING_MESSAGE>` 作为最后一条 user 输入注入（工具循环自身轮询、Codex 有 500ms 泵）。
- 队列↔日志对齐：`takeSteeringMessages` 记录 id→content，`markSteeringApplied` 时把已消费 steer 写为 `delivery:'steer'` 的 user 事件（chat-bridge 与 meta-analysis 两侧都接）。
- UI 指标：Phase 0 已落地（transcript 头部"缓存命中 N%"、Meta 规划 Token 行）；队列面板本身展示的是待处理消息，不展示单条 usage。
- 测试：`__tests__/server/pi-steering-injection.test.ts`（5 例契约断言）；PI 核心 13 例全绿。
- **已知：全量套件 11 个失败均为会话开始前已存在的仓库脏改动（尤其 `src/public/index.html` 35+/11-）所致，非本次引入**（已用 git stash 基线对比确认：基线即失败 9 个，且失败用例与本次改动的文件无交集；另有 2 个随 index.html 脏改动波动的用例）。

### Phase 5 ✅（已完成，决策门 G2 结论：暂走路线 C，路线 A 挂起）

**Spike 产物**：`artifacts/dsh-spike/spike.mjs` + `spike-report.json`（hermetic，用 DSH 自带 mock LLM 服务器，零成本零 key）。

**实测事实**：

| 指标 | 实测值 | 说明 |
|---|---|---|
| 嵌入机制 | ✅ PASS | 普通 `node` 子进程 spawn DSH runtime，stdio JSON-RPC 全程可用（initialize → session/prompt → session/event） |
| 冷启动 + 握手 + 首轮 | ~2.1-2.5s | 含插件树加载；第二轮同会话仅 30-53ms |
| runtime 工作集 | ~93-95 MB | Windows 上实测 working set |
| 会话连续性（wire 级） | ✅ | 同 sessionId 第二轮模型请求 messageCount 2→4，含第一轮 user 消息（追加式前缀稳定，与 Phase 2 设计同构） |
| 干净关停 | ~40-200ms | shutdown 握手 + dispose |
| 闭包体积 | dev 闭包 **527 MB**（pnpm deploy）；单文件 SEA exe 仅 linux/macos 有产物，**Windows 无 SEA 构建** | 对 466MB 安装包是决定性增量 |
| cacheReadTokens | mock 不返回 cache 字段（如实）；`llm-deepseek/translate.ts` 已确认映射 `prompt_tokens_details.cached_tokens`/`prompt_cache_hit_tokens`（源码证据） | 真实 DeepSeek API 下可报告 |
| 意外发现 | DSH 会话跨进程持久化（第二次运行时 resume 了上次未闭合的 turn，需清会话目录） | spike 已内置清理 |

**决策门 G2 结论**：**暂不整体嵌入（路线 A 挂起），沿用路线 C（设计移植，Phase 1-3 已完成）**。理由：
1. 527MB dev 闭包 / 无 Windows SEA 构建 → 体积成本与当前 466MB 安装包冲突，且需要 DSH 上游提供 Windows 打包链（预览期破坏性变更风险叠加）；
2. Phase 1-3 已把 DSH 的核心价值（追加式日志、supersede 快照、compaction、缓存计量）移植完毕，路线 A 的边际收益只剩 subagent/workflow/goal 编排；
3. 若未来需要 DSH 编排能力：重新评估条件 = DSH 发布稳定版本 + 提供 Windows SEA/正式 npm 产物 + Scholar Harness 接受体积增长。spike 脚本可复用于复评（`node artifacts/dsh-spike/spike.mjs`）。
4. 本次 spike 为让 DSH 仓库 node_modules 裸导入可解析，补建了 227 个 workspace junction（仅影响该 spike 环境，非产品代码）。

### Phase 6 ✅（已完成）

- `npx tsc --noEmit` 干净；`node scripts/check-public-js.js` 通过（29 script + 11 style）。
- 全量 `npx vitest run`：980 passed / 16 个唯一失败，**全部为会话开始前已存在的仓库脏改动用例**（扫描 `src/public/index.html`、styles、`src/bridge/chat-bridge/chat-bridge.ts` 这些本次从未触碰的文件；已用 git stash 基线对比确认，本轮零新增失败）。
- 本轮新增 40 个测试全部通过：cache-metrics 8、prompt-assembler 7、session-log 8、compaction 7、token-meter 4、llm-client cache 3、pi-steering-injection 5、meta-analysis-pi-agent 断言更新。

### 在途功能完成 ✅（16 个既有失败用例全部修复）

**系统性修复 — 行尾归一化**（`__tests__/helpers/public-app-source.ts` + email-workspace/codex-provider-isolation 测试的原始读取）：仓库文件以 LF 存储、Windows checkout 物化为 CRLF，导致多行 `toContain` 断言必然失败；测试应断言内容语义而非行尾字节。仅此一项修复了约 8 个用例（email-workspace 多行、ctx-bubble rowCount、sidebar-layout、pdf-wiki-overview、codex-isolation 等）。

**功能补全（真缺失，补实现）**：
1. 文献加载失败重试增加可见状态（`chat-history.js`："加载失败，正在自动重试…"，原为静默重试）。
2. 转写容器性能规则（`shell-layout.css` `.chat-container`）：`content-visibility: auto; contain-intrinsic-size: auto 240px`（侧栏开合不再全量重排）。
3. Query 导航点 hover 反馈（`shell-layout.css`）：恢复被删的 `.hover-focus` scale(2) / `.hover-neighbor`、`.active-neighbor` scale(1.5)。
4. `:has()` 全部替换为 class 状态（性能契约要求零 `:has()`）：preflight 条改为 `startMainChatPreflightHeader` 给前一个 user 消息打 `.has-preflight-follow`；邮箱页改为 `body.email-page-open`（`showEmailWorkspace`/`closeEmailWorkspace`/`showHomeUtilityPage` 统一维护）。
5. 上下文条触发按钮移除 `onclick`（保持 hover/focus 展开契约，index.html fallback 与 chat-context.js render 两处）。

**测试契约对齐（功能已完成但断言过时）**：
- pi-agent-queue：转写 finalize 现带第三参 `state && state.usage`（更完整）；`.message.user.has-preflight-follow` 替代 `:has` 选择器。
- color-theme-picker：选择器 720px 双列 + 移动端 360px 响应式；导航点改为 primary 派生（注释明确说明避免 --theme-soft 的调色板兼容理由）。
- pdf-paper-home-chat：PDF 由"每轮内联全文"重构为"按需资源"（`registerMainChatAgentResource('current-pdf')` + `read_page_context(resourceId="current-pdf")` + `<CURRENT_PDF_SELECTION>`）。
- main-drag-file-provenance：视觉附件检测内联为 `requiresVisionForChat = hasVisionInputForMainChat() || hasChatAttachmentVision(...)`（行为保留）。
- meta-analysis-shared-agent：工具循环现含全部 9 个族（新增 agentResourceTools、utilityTools），spread 断言更新。
- email-workspace：`.email-page-open` 替代 `:has()` 选择器断言。

**验证**：原 16 个失败用例全部通过；`tsc --noEmit` 干净；`node scripts/check-public-js.js` 通过。全量套件中 pdf-wiki-manager / workspace-* / skill-optimization / literature-collection-manager / project-citation-evidence-ledger 存在**环境性抖动**（5s 超时的重 IO 测试，失败集每次漂移，HEAD 基线同样失败，且这些模块不导入任何本次改动文件），与本轮改动无关。

### 收尾状态

**计划目标达成**：Phase 0（缓存指标+基线脚本）、Phase 1（三段式 Prompt：Meta 灰度+主聊天+unified-chat）、Phase 2（追加式会话日志三处接入）、Phase 3（token-meter+compaction+/compact）、Phase 4（PI 强制 steering 注入+队列↔日志对齐）、Phase 5（DSH SDK spike+决策门 G2：路线 C）、Phase 6（回归+发布检查）、在途功能完成（16 个既有失败用例修复）全部落地，进度记录于本文档 §15。

**遗留的操作性待办（需要活环境，非代码工作）**：
1. 用 `scripts/cache-baseline.js replay` 连活服务器+真实 provider，对比改造前后 cacheReadTokens 命中率，验证 ≥40% 目标（改造前基线为"未计量/≈0"，需先跑一次 `stats` 确认 provider 是否返回 cache 字段）；
2. 仓库既有脏改动（index.html/styles/chat-bridge.ts 桥层）导致的 16 个既有失败用例，应由仓库所有者另行处理；
3. 路线 A（DSH 嵌入）挂起条件重评估：DSH 稳定版 + Windows SEA 产物 + 体积预算（见 Phase 5）。
