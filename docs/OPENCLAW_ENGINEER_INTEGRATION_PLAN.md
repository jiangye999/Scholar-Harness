# Scholar Harness 功能梳理与 OpenClaw 接入方案

本文档给工程师使用，目标是把 Scholar Harness 当前的学术写作、文献、PDF、数据分析等能力接入 OpenClaw（小龙虾），让 OpenClaw 能作为一个稳定的 AI 执行通道参与聊天、PDF 处理、论文生成和质量审查。

## 1. 项目定位

Scholar Harness 是一个对话式学术论文写作助手。当前架构是本地 Electron/Express 应用 + 可选云端协同，核心是“两级 AI 协作”：

- 大牛马：负责规划、提纲、Skill 生成、复杂质量审查、策略性判断。
- 小牛马：负责日常聊天、长期记忆更新、执行写作、引用验证、降级兜底。
- Codex CLI：当前已作为本机长任务/复杂任务优先引擎接入部分流程。
- OpenClaw：项目内已有 `openclaw/` 浏览器自动化工具和 `ChatBridgeAdapter` 入口，但当前主流程偏 API/Codex CLI，浏览器桥接服务部分在代码中有“已弃用”标记，需要工程化整理后重新作为稳定 Provider 接入。

## 2. 当前主要功能

### 2.1 基础对话与 Agent 路由

- 首页聊天：用户可以直接和学术写作助手对话。
- `@小牛马`：默认走小牛马 API，适合轻量回答、记忆整理、普通改写。
- `@大牛马`：走大牛马配置；如果配置了 Codex 优先，当前逻辑会优先尝试 Codex CLI。
- `@codex`：强制走 Codex CLI，失败后按当前代码逻辑降级到小牛马。
- 长期记忆：支持跨会话记忆、结构化记忆、实验资料总结、数据总结。
- 会话持久化：本地保存会话、草稿、上传资料和检索索引。

相关入口：

- 前端：`src/public/index.html`
- 聊天路由：`src/server/routes/chat-bridge.ts`
- 统一聊天：`src/server/routes/unified-chat.ts`
- 处理器：`src/server/unified-chat-processor.ts`
- Adapter：`src/bridge/chat-bridge/chat-bridge.ts`

### 2.2 配置中心

配置中心目前承担这些内容：

- 大牛马 API：`primary.api_url`、`primary.api_key`、`primary.model`
- 小牛马 API：`secondary.api_url`、`secondary.api_key`、`secondary.model`
- Codex CLI：是否启用、是否优先、CLI 路径、模型、reasoning effort、sandbox、timeout、PDF Wiki 并发数。
- PDF Wiki/TextIn/联网搜索等配置。

配置文件默认写到用户数据目录：

- `DATA_DIR/chat-bridge-config.json`

相关接口：

- `GET /api/chat-bridge/config`
- `POST /api/chat-bridge/config`
- `GET /api/chat-bridge/codex/status`
- `GET /api/chat-bridge/codex/models`

### 2.3 文献库与 Embedding 文献库

- 支持导入 WoS/CNKI 等文献数据。
- 支持 Embedding 文献库查看、检索、收藏论文。
- 使用 BM25 + Vector 的混合检索引擎。
- 支持一键写论文时选择摘要库、Wiki 论点库或两者共同检索。

相关模块：

- `src/literature/retrieval/`
- `src/server/routes/literature.ts`
- `src/server/routes/embedding-library.ts`

### 2.4 PDF Wiki / Wiki 论点库

当前 PDF Wiki 是项目最复杂的知识库功能之一：

- 用户上传 PDF，生成 Wiki 论点库。
- 优先使用 Codex CLI 解析 PDF，失败后降级 TextIn / 小牛马 API / 其他解析方式。
- 从 PDF 中抽取：
  - 论文元数据；
  - 研究对象、地点、处理、作物、土壤指标；
  - 论点；
  - 正反论据；
  - 支撑该论据的原文内容和原因；
  - 参考文献索引；
  - meta 分析表格数据。
- 支持 PDF 管理、分组、多组归属、收藏、批量深入分析。
- 深入分析会复用已保存的 PDF 文本，不应重复把同一个 PDF 传给 TextIn。
- 支持 meta 数据库展示和导出 Excel。
- 支持用户上传 Excel 模板，让 AI 按用户表头结构从 PDF 的图表、结果、材料方法中提取数据。

相关入口：

- `src/utils/pdf-wiki-manager.ts`
- `src/utils/pdf-wiki-pdf-management.ts`
- `src/server/local-server.ts` 中大量 `/api/pdf-wiki/*` 路由
- 前端 PDF Wiki UI：`src/public/index.html`

### 2.5 一键写论文

当前“一键写论文”逻辑：

- 用户输入主题和目标字数。
- AI 自动决定章节数、每章段落数、每段句数。
- AI 先生成提纲，再逐句生成检索词。
- 每句话检索摘要库和/或 Wiki 论点库 Top20，但只挑最相关的 1-3 篇作为证据。
- 可勾选：
  - 跨会话长期记忆；
  - 实验资料；
  - 文献库选择；
  - 目标期刊章节写作风格；
  - 文中引用格式；
  - 目标期刊参考文献格式。
- 写作时发送章节 Skill 和期刊风格，不应截断这两类内容。
- 生成后做质量审查，使用用到的参考文献摘要和详细信息一起评审。
- 支持后台状态、主页同步进度、停止、重启、导出 Word。
- Word 导出需要标题、统一参考文献格式、普通文本数字格式，不强制上下角标。

相关接口：

- `POST /api/review-writer/start`
- `GET /api/review-writer/progress/:jobId`
- `POST /api/review-writer/stop/:jobId`
- `POST /api/review-writer/restart/:jobId`
- `GET /api/review-writer/latest`
- `POST /api/review-writer/docx`

### 2.6 实验资料上传

- 用户可上传图片、表格、PDF、Word。
- 上传按钮旁输入框内容会和文件一起提交。
- AI 会把用户输入的额外要求、文件内容、结构化结果一起用于实验资料分析。
- 如果用户要求“数据分析”或“R 作图”，上传的表格文件会直接联动数据分析/R 代码生成流程。
- 结果会追加/合并到长期记忆：
  - `data_summary`：数据结构、变量、描述统计、检验结果、p 值、显著性、用户额外要求。
  - `experiment_summary`：只在用户额外要求包含试验设计、处理、地点、方法等描述性信息时写入。

相关入口：

- `src/server/routes/experiment-results.ts`
- `src/server/services/experiment-analyzer.ts`

### 2.7 数据分析

数据分析界面支持用户上传数据，并多选多个分析方法，生成同一份分析结果/代码文件。

当前分析方法包括：

- 描述性统计；
- 正态性检验；
- 方差齐性检验；
- 独立样本 t 检验；
- 配对样本 t 检验；
- 单因素方差分析；
- 双因素方差分析；
- 非参数检验；
- 相关分析；
- 线性回归；
- 卡方检验；
- PCA；
- 聚类分析；
- 混合效应模型；
- 生存分析；
- 图表建议。

支持额外 query 窗口，用户可以补充研究问题、显著性标注要求、处理说明等。

相关接口：

- `POST /api/data-analysis/inspect`
- `POST /api/data-analysis/analyze`

### 2.8 R 语言作图

- 支持上传数据生成 R 代码。
- 可和数据分析结果联动。
- 作图提示词要求先做数据预处理、清洗、确保数据结构正确。
- 如果表头含单位，代码中应去掉单位或做安全列名转换，但坐标轴应展示单位。
- 必须严格按照数据分析结果或用户补充说明标注显著性。
- 如果没有显著性数据，需要预留显著性位置代码，并用 `x` 表示。

相关接口：

- `POST /api/r-code/generate`
- `POST /api/r-code/save`
- `POST /api/r-code/debug`
- `GET /api/r-code/chart-types`

### 2.9 云端与反馈

- 项目包含云端模块 `cloud/`，用于账号、订阅、管理后台等。
- 已添加意见反馈功能需求：客户端左侧边栏左下角提交反馈，云端 `https://scholarharness.com/admin/` 查看反馈。

## 3. 现有 OpenClaw 状态

项目内已有：

- `openclaw/index.js`：OpenClaw 主实现。
- `openclaw/package.json`：声明 `openclaw` bin。
- `openclaw/README.md`：说明 CLI 和 HTTP 服务。
- `openclaw/browsers/`：打包用浏览器资源。
- `src/bridge/chat-bridge/chat-bridge.ts`：已有 `ChatBridgeAdapter`，当前支持 API、Codex CLI 和部分旧浏览器桥接逻辑。
- `package.json` 的 `build.extraResources` 已把 openclaw 的核心文件、node_modules、browsers 打入 Electron 包。

需要注意：

- `ChatBridgeAdapter.chat()` 当前主逻辑是 API/Codex CLI。
- `openclaw serve` 相关同步、启动、SSE 流式部分在 `chat-bridge.ts` 中有“已弃用”注释。
- `POST /api/chat-bridge/open-page` 当前返回“API 桥接模式，无需打开浏览器桥接页面”。
- 如果公司要真正接上小龙虾，应把 OpenClaw 重新整理成一个正式 Provider，而不是只依赖旧注释代码。

## 4. 建议接入目标

OpenClaw 接入后应能作为一个 AI Provider，被所有需要 AI 的任务统一调用：

```text
用户请求
  -> 前端识别 @对象/功能入口
  -> Express 路由
  -> AI Provider Router
  -> OpenClaw Provider / Codex Provider / Primary API / Secondary API
  -> 返回文本、JSON、进度或文件
```

建议 Provider 优先级：

- 用户显式 `@codex`：Codex CLI。
- 用户显式 `@大牛马`：优先 OpenClaw 或 Codex，根据配置决定；失败后大牛马 API；再失败小牛马。
- 用户显式 `@小牛马`：小牛马 API，不走 OpenClaw，保持轻量稳定。
- 一键写论文：默认优先 Codex/OpenClaw 这类长任务引擎；小牛马只做降级。
- PDF Wiki：默认优先 Codex/OpenClaw 处理 PDF 结构化抽取；TextIn/API 作为降级。
- 普通聊天：如果用户在配置中心勾选“优先使用 OpenClaw”，则默认 OpenClaw，否则小牛马。

## 5. 推荐工程实现

### 5.1 抽象统一 Provider 接口

新增或整理一个统一接口，例如：

```ts
export type AiProviderName = 'openclaw' | 'codex' | 'primary' | 'secondary';

export interface AiProviderRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
  onProgress?: (chunk: string) => void;
}

export interface AiProviderResult {
  provider: AiProviderName;
  content: string;
  raw?: unknown;
}

export interface AiProvider {
  name: AiProviderName;
  isAvailable(): Promise<boolean>;
  chat(request: AiProviderRequest): Promise<AiProviderResult>;
}
```

然后让：

- `OpenClawProvider` 调用 `openclaw serve` 的 HTTP API 或直接 spawn `node openclaw/index.js ...`。
- `CodexProvider` 包装当前 `runCodexCli`。
- `PrimaryApiProvider` 包装大牛马 API。
- `SecondaryApiProvider` 包装小牛马 API。

这样后续一键写论文、PDF Wiki、数据分析、R 作图都不需要各自写一套降级逻辑。

### 5.2 OpenClaw 推荐两种运行模式

#### 模式 A：HTTP 服务模式，推荐

启动一个本地服务：

```bash
cd openclaw
node index.js serve
```

默认端口：`19222`。

Scholar Harness 调用：

```http
POST http://127.0.0.1:19222/chat
Content-Type: application/json

{
  "message": "用户问题或完整提示词",
  "url": "目标聊天网页 URL",
  "stream": false,
  "newPage": false
}
```

优点：

- 浏览器会话可复用。
- 适合长任务。
- 可做健康检查、重启、页面刷新。

必须补齐：

- `/health`：返回浏览器是否启动、当前 URL、是否登录、最近错误。
- `/chat`：支持 `timeout_ms`、`stream`、`response_format`。
- `/open`：打开或切换目标网页。
- `/reset`：重开会话。
- `/stop`：停止当前生成。

#### 模式 B：CLI 单次调用模式

每次任务 spawn 一次 OpenClaw 命令。

优点是隔离性好，缺点是慢，且浏览器状态复用差。只建议作为 HTTP 服务不可用时的兜底。

### 5.3 配置中心需要增加 OpenClaw 配置

建议在 `chat-bridge-config.json` 增加：

```json
{
  "openclaw": {
    "enabled": true,
    "prefer": false,
    "mode": "service",
    "service_url": "http://127.0.0.1:19222",
    "command": "",
    "chat_url": "",
    "login_url": "",
    "timeout_ms": 900000,
    "max_retries": 2,
    "fallback_provider": "secondary"
  }
}
```

前端配置项：

- 启用 OpenClaw；
- 优先使用 OpenClaw；
- 服务地址；
- 聊天页面 URL；
- 登录页面 URL；
- 超时时间；
- 测试连接；
- 打开登录页面；
- 重启 OpenClaw；
- 当前状态。

### 5.4 与现有 Codex 配置的关系

Codex CLI 和 OpenClaw 不要混成一个配置。

建议保留：

- `codex.*`：本机 Codex CLI，适合代码、结构化长任务、PDF Wiki 抽取。
- `openclaw.*`：浏览器桥接，适合调用网页端 AI、公司内部网页模型或无法直接 API 调用的 AI 服务。

调用优先级由任务决定：

- PDF Wiki 结构化抽取：Codex 优先；OpenClaw 可作为第二优先；再 TextIn/API。
- 一键写论文：Codex 或 OpenClaw 均可做长任务，但建议默认 Codex，因为它更适合长上下文和文件任务。
- 普通聊天：OpenClaw 可优先，因为用户可能需要走公司统一网页 AI。

## 6. 具体接入点

### 6.1 ChatBridgeAdapter

文件：`src/bridge/chat-bridge/chat-bridge.ts`

当前已经承担 provider 选择。工程师可在这里新增：

- `openclaw?: OpenClawConfig`
- `getOpenClawStatus()`
- `runOpenClawServiceChat(options)`
- `ensureOpenClawServiceRunning()`
- `chatWithFallbackChain(options, providers)`

当前 `chat()` 里已经有 `forceProvider` 概念，应扩展：

- `forceProvider: 'openclaw'`
- `forceProvider: 'codex'`
- `forceProvider: 'primary'`
- `forceProvider: 'secondary'`

### 6.2 ChatBridge 路由

文件：`src/server/routes/chat-bridge.ts`

需要增加或恢复：

- `GET /api/chat-bridge/openclaw/status`
- `POST /api/chat-bridge/openclaw/open`
- `POST /api/chat-bridge/openclaw/restart`
- `POST /api/chat-bridge/openclaw/test`

并在现有：

- `GET /api/chat-bridge/config`
- `POST /api/chat-bridge/config`

里读写 `openclaw` 配置。

### 6.3 前端配置中心

文件：`src/public/index.html`

需要在配置中心增加 OpenClaw 配置块：

- 开关：启用 OpenClaw；
- 开关：优先使用 OpenClaw；
- 输入框：服务 URL；
- 输入框：聊天页面 URL；
- 输入框：CLI 路径，可为空；
- 按钮：检测；
- 按钮：打开登录页；
- 状态提示：可用/不可用/已登录/需登录/最近错误。

### 6.4 一键写论文

文件：`src/server/local-server.ts`

当前一键写论文使用 `callReviewWriterLlm` 等内部函数。需要让这些函数走统一 Provider Router。

建议：

- 提纲规划：优先 `codex`，若用户勾选 OpenClaw 优先则走 `openclaw`。
- 逐句写作：优先 `codex/openclaw`，失败重试同 Provider，再降级。
- 质量审查：不要再把整篇论文反复丢给小牛马；优先使用同一个长任务 Provider，并带上已用参考文献摘要。
- 如果 OpenClaw 返回空、超时、网页卡住，应执行一次 `/reset` 后重试，再降级。

### 6.5 PDF Wiki

文件：`src/utils/pdf-wiki-manager.ts`

当前已存在 Codex PDF Wiki 抽取逻辑。接入 OpenClaw 时建议：

- 不替换现有 Codex 路径，新增 `OpenClawPdfExtractor`。
- 输入：PDF 文本、PDF 文件路径、用户 Excel 模板表头、当前 meta schema。
- 输出必须是 JSON，且通过 Zod/本地 schema 校验。
- OpenClaw 返回非法 JSON 时：
  1. 用同一 Provider 发送“修复 JSON”提示词；
  2. 仍失败再重试一次原任务；
  3. 仍失败才降级 TextIn/API。

### 6.6 数据分析与 R 作图

这两块核心计算应尽量留在本地 Node/R 代码生成流程，不建议让 OpenClaw 直接替代数据分析逻辑。

推荐用途：

- 解释分析结果；
- 根据数据分析结果生成 R 代码；
- 根据用户额外 query 改写图注、显著性说明、结果段落。

## 7. OpenClaw 输入输出规范

为避免后续功能不稳定，必须对不同任务定义稳定输出。

### 7.1 普通聊天

输出纯文本。

### 7.2 JSON 任务

提示词必须包含：

```text
只输出合法 JSON，不要 Markdown，不要代码块，不要解释。
如果无法提取某字段，填空字符串、空数组或 null，不要编造。
```

服务端必须：

- 去掉 ```json 代码块；
- 解析 JSON；
- 校验 schema；
- 保存原始响应用于排错；
- 非法 JSON 先让 OpenClaw 自修复，不要立刻降级。

### 7.3 长任务

长任务必须有：

- jobId；
- status：queued/running/succeeded/failed/stopped；
- progress；
- message；
- startedAt/updatedAt；
- stopRequested；
- result/error。

一键写论文已有类似状态管理，可复用。

## 8. 安全与打包要求

- API Key、网页登录凭据必须加密保存，不要写入仓库。
- 配置返回前端时只能返回 `has_api_key`、`masked_email` 等脱敏字段。
- OpenClaw 的浏览器 profile 不要混用不同用户账号。
- Electron 打包时必须确认 `openclaw/index.js`、`openclaw/package.json`、`openclaw/node_modules`、`openclaw/browsers` 都在 `extraResources`。
- Windows 下路径要支持：
  - 手动路径；
  - PATH；
  - 打包后 `process.resourcesPath/openclaw`；
  - 开发环境 `process.cwd()/openclaw`。

## 9. 验收清单

### 9.1 配置验收

- 配置中心能保存 OpenClaw 开关、服务 URL、聊天 URL。
- 刷新页面后配置不丢失。
- `GET /api/chat-bridge/config` 能脱敏返回。
- `POST /api/chat-bridge/config` 不覆盖已有 Codex/大小牛马配置。

### 9.2 OpenClaw 可用性

- 能启动 `openclaw serve`。
- `GET /health` 返回可用。
- 能打开配置的聊天页。
- 未登录时能提示用户登录，而不是静默失败。
- 登录后能发送“你好”并取回回答。

### 9.3 聊天路由

- `@openclaw` 或配置优先 OpenClaw 后，聊天实际走 OpenClaw。
- OpenClaw 失败后按配置降级。
- `@小牛马` 仍只走小牛马。
- `@codex` 仍走 Codex CLI。

### 9.4 PDF Wiki

- 多个 PDF 可排队/并发处理。
- OpenClaw/Codex 抽取失败时先同 Provider 重试和 JSON 修复。
- 最终生成论点、正反论据、支撑原文、meta 表格。
- meta 数据导出 Excel 只有一个统一表头，不同 PDF 缺失字段留空。

### 9.5 一键写论文

- 提纲、逐句写作、质量审查能按配置走 OpenClaw/Codex。
- 关闭弹窗后主页仍显示进度。
- 停止、重启正常。
- 超时不会卡死任务。
- 生成 Word 正常。

## 10. 建议开发顺序

1. 新增 `OpenClawProvider`，只实现 `isAvailable()` 和普通 `chat()`。
2. 扩展 `chat-bridge-config.json` 和配置中心 UI。
3. 增加 `/api/chat-bridge/openclaw/status/test/open/restart`。
4. 让普通聊天支持 `forceProvider='openclaw'`。
5. 把一键写论文的 LLM 调用改为统一 Provider Router。
6. 把 PDF Wiki 的 JSON 抽取加入 OpenClaw Provider 和 JSON 修复机制。
7. 补充超时、重试、降级、日志和验收测试。

## 11. 最小可交付版本

第一版不要一次性改所有功能。最小可交付建议：

- 配置中心可配置 OpenClaw。
- 普通聊天可走 OpenClaw。
- OpenClaw 失败可降级小牛马。
- 一键写论文可选择 OpenClaw 优先。
- PDF Wiki 可把 OpenClaw 作为 Codex 失败后的 JSON 抽取 Provider。

等这几个稳定后，再扩展到更复杂的 meta 数据库、批量 PDF、质量审查循环和云端协同。
