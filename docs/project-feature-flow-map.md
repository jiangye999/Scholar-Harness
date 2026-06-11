# Scholar Harness 全功能流程线路图

本文档用于交给 GPT、Mermaid、Excalidraw、FigJam 或其他绘图工具，生成 Scholar Harness 项目的全功能流程图。建议最终画成一张横向大图，分为五层：用户界面层、后端 API 层、AI/Agent 层、数据存储层、输出成果层。

## 给 GPT 的绘图提示词

请根据下面内容绘制一张「Scholar Harness 全功能流程线路图」。要求：

- 使用横向流程图，从左到右展示：用户入口 -> 前端功能 -> API 路由 -> Agent/服务 -> 本地数据 -> 输出结果。
- 用泳道或分层结构区分：前端 UI、Express API、AI/Agent、数据存储、最终产物。
- 重点突出这些主链路：对话写作、长期记忆、Embedding 文献库、PDF Wiki 论点库、实验资料上传、目标期刊风格提取、AutoResearch、一键写论文、数据分析与 R 作图。
- 同类功能用同色系，推荐深绿色为主色，辅以灰色、蓝绿色、金色区分数据、AI、输出。
- 箭头需要标出关键 API 或关键动作，但不要把每个小接口都画成大节点；密集接口可以放到模块旁边作为小注释。
- 输出一张总览图，再输出 3-5 张局部放大图：文献/PDF Wiki、实验资料/数据分析、AutoResearch、一键写作、长期记忆。

## 一句话总览

Scholar Harness 是一个本地优先的学术/文稿写作工作台：用户上传文献、PDF、实验资料、目标期刊样例和研究主题后，系统通过两级 Agent、Codex CLI、Embedding 检索、PDF Wiki 证据抽取、长期记忆和 AutoResearch 工作流，生成可追溯的研究报告、论文草稿、数据分析结果、R 作图代码和 Word/Markdown 下载文件。

## 顶层总流程

```mermaid
flowchart LR
  U["用户"] --> UI["浏览器 / Electron 前端\nsrc/public/index.html"]
  UI --> P["项目与写作模式\n论文写作 / 论文审阅 / 基金 / 专利 / 软著 / 商业计划书 / 通用文稿"]
  UI --> C["配置中心\nAPI Key / 模型 / Codex CLI / Embedding / PDF Wiki"]
  UI --> M["跨会话长期记忆"]
  UI --> L["Embedding 文献库"]
  UI --> W["PDF Wiki 论点库"]
  UI --> E["实验资料与数据分析"]
  UI --> J["目标期刊/模板风格"]
  UI --> A["AutoResearch"]
  UI --> R["一键写作"]
  UI --> D["草稿管理"]

  P --> API["Express API\nsrc/server/local-server.ts + routes"]
  C --> API
  M --> API
  L --> API
  W --> API
  E --> API
  J --> API
  A --> API
  R --> API
  D --> API

  API --> AG["AI/Agent 层\nChatBridge / PrimaryAgent / SecondaryAgent / Codex CLI"]
  API --> SVC["本地服务层\nretrieval / pdf-wiki / autoresearch / experiment-analyzer"]
  AG --> STORE["本地数据层\ndata/memory, data/uploads, data/autoresearch, drafts, journal-styles"]
  SVC --> STORE

  STORE --> OUT["输出成果\n聊天回答 / 论文草稿 / AutoResearch 报告 / Word / Markdown / R 代码 / PDF Wiki 证据 / 文献图谱"]
  OUT --> U
```

## 前端入口和主要按钮

```mermaid
flowchart TB
  UI["主页面 index.html"] --> Chat["对话输入框 / 发送"]
  UI --> UploadLit["上传文献摘要"]
  UI --> UploadPdf["上传 PDF 生成论点库"]
  UI --> UploadExp["上传实验资料"]
  UI --> Journal["上传目标期刊样例 / Author Guidelines"]
  UI --> Memory["长期记忆管理"]
  UI --> AutoResearch["AutoResearch 面板"]
  UI --> OneClick["一键写论文/文稿"]
  UI --> Data["数据分析"]
  UI --> RCode["R 语言作图"]
  UI --> Project["项目管理"]
  UI --> Config["API / Codex / Embedding / PDF Wiki 配置"]

  Chat --> SendRule["发送前检查 pendingExperimentFiles\n有实验文件则先上传分析"]
  SendRule --> ExpUpload["/api/experiment-results/upload"]
  SendRule --> ChatBridge["/api/chat-bridge/chat"]
```

## 项目和写作模式

写作模式由 `PROJECT_WRITING_PROFILES` 控制，前端和后端都会根据当前 profile 改变文案、资料标签、风格标签和一键写作目标。

| 模式 ID | 用途 | 主要输出 |
|---|---|---|
| `paper-writing` | 论文辅助写作 | 论文草稿、参考文献、Word |
| `paper-review` | 论文辅助审阅 | 审稿意见、修改建议、审阅报告 |
| `grant-writing` | 基金辅助写作 | 申报书草稿、评审要点 |
| `patent-writing` | 专利辅助写作 | 技术交底、权利要求、说明书草稿 |
| `software-copyright` | 软著写作 | 软著材料、功能说明 |
| `business-plan` | 商业计划书写作 | 商业计划书 |
| `general-writing` | 通用文稿写作 | 普通文稿 |

核心接口：

- `GET /api/project-writing-profiles`
- `POST /api/projects/new`
- `GET /api/projects`
- `GET /api/projects/current`
- `POST /api/projects/current/profile`
- `POST /api/projects/:projectId/open`
- `DELETE /api/projects/:projectId`

## 对话与两级 Agent 流程

```mermaid
flowchart LR
  UserMsg["用户输入消息"] --> CheckFiles{"是否有待上传实验文件?"}
  CheckFiles -- "是" --> ExpFlow["实验资料上传分析流程"]
  CheckFiles -- "否" --> ChatBridge["ChatBridge\n/api/chat-bridge/chat"]

  ChatBridge --> Provider{"选择提供者"}
  Provider --> Codex["Codex CLI\nforceProvider=codex"]
  Provider --> Primary["PrimaryAgent 大牛马\n规划 / Skill / 质量检查"]
  Provider --> Secondary["SecondaryAgent 小牛马\n执行写作 / 引用验证"]
  Provider --> Fallback["普通 API 模型 fallback"]

  Primary --> Skill["生成章节 Skill / 搜索策略"]
  Secondary --> Write["章节或句子写作"]
  Write --> Cite["引用验证 / 删除无效引用"]
  Cite --> Draft["草稿保存"]
  ChatBridge --> MemoryUpdate["长期记忆更新"]
  ChatBridge --> ConvSave["保存会话摘要"]
```

关键代码：

- `src/server/routes/chat-bridge.ts`
- `agents/primary-agent.ts`
- `agents/secondary-agent-v2.ts`
- `agents/agent-collaboration-workflow.ts`
- `workflows/conversation-flow.ts`

## 跨会话长期记忆流程

```mermaid
flowchart TB
  Source["记忆来源"] --> ChatMemory["对话自动提取"]
  Source --> ManualMemory["手动更新记忆"]
  Source --> ExpMemory["实验资料/数据分析写入"]
  Source --> AutoResearchMemory["AutoResearch 项目记忆"]

  ChatMemory --> MemoryJson["data/memory/{userId}/memory.json"]
  ManualMemory --> MemoryJson
  ExpMemory --> MemoryJson
  AutoResearchMemory --> AutoResearchState["data/autoresearch/{userId}/state.json"]

  MemoryJson --> Dimensions["普通长期记忆维度"]
  Dimensions --> Experiment["实验资料记忆\nexperiment_summary_structured / research_method / experimental_design"]
  Dimensions --> Data["数据结果记忆\ndata_summary_structured / key_findings / data_status"]
  Dimensions --> Paper["论文设定记忆\npaper_topic / target_journal / key_concepts"]
  Dimensions --> Writing["写作进度记忆\nwriting_progress / completed_chapters / pending_chapters"]
  Dimensions --> Preference["用户偏好记忆\nwriting_style / citation_preferences"]

  MemoryJson --> Txt["同步 txt 文件\n试验资料总结.txt / 数据详细总结.txt"]
  MemoryJson --> WriterContext["一键写作时按章节/句子选取相关片段"]
```

关键接口：

- `POST /api/memory/update`
- `GET /api/memory/:userId`
- `GET /api/memory/detail/:userId`
- `GET /api/memory/summary-status/:userId`
- `POST /api/memory/clear-selected/:userId`
- `DELETE /api/memory/clear/:userId`
- `POST /api/research-material/save`
- `POST /api/data-summary/save`
- `POST /api/summary/generate`

## Embedding 文献库流程

```mermaid
flowchart LR
  Upload["上传文献摘要 / RIS / Bib / WoS / CNKI / PDF"] --> Parse["解析文献记录\nParserFactory / WOS / CNKI / RIS / Bib"]
  Parse --> LitJson["data/uploads/{userId}/literature.json"]
  LitJson --> EmbeddingConfig["Embedding 配置\n/api/embedding/config"]
  EmbeddingConfig --> Embed["生成 embedding / 进度流"]
  Embed --> IndexCache["index-cache / 向量索引"]
  IndexCache --> LibraryUI["Embedding 文献库 UI"]
  LibraryUI --> Tags["关键词 / AI 关键词 / 合并标签 / 外部标签"]
  LibraryUI --> Search["BM25 + Vector + Metadata 混合检索"]
  Search --> Evidence["句子写作证据 / AutoResearch 文献图谱 / PDF Wiki 检索"]
  LibraryUI --> DOI["按 DOI 下载 OA PDF"]
```

关键接口：

- `POST /api/upload`
- `GET /api/literature`
- `POST /api/literature/search`
- `GET /api/embedding/config`
- `POST /api/embedding/config`
- `GET /api/embedding/progress`
- `GET /api/embedding/progress/stream`
- `GET /api/embedding-library`
- `POST /api/embedding-library/filter`
- `POST /api/embedding-library/manual-merge`
- `POST /api/embedding-library/outer-tags`
- `POST /api/embedding-library/refresh-merged-tags`
- `POST /api/embedding-library/favorites`
- `POST /api/embedding-library/download-by-doi`
- `POST /api/oa-paper-download`

核心代码：

- `src/literature/parsers/*`
- `src/literature/retrieval/*`
- `src/public/embedding-library.js`
- `src/server/routes/embedding-library.ts`
- `src/utils/retrieval-engine-manager.ts`

## PDF Wiki 论点库流程

当前 PDF Wiki 已从“点云优先”改回“句子级论点库”：主要提取论文 Introduction、Discussion、Conclusion 中的句子，识别句尾显式引用，匹配参考文献，再判断句子是否可成为论点。

```mermaid
flowchart TB
  PdfUpload["上传 PDF"] --> PdfQueue["PDF Wiki 队列 / 重建 / 深入分析"]
  PdfQueue --> FastText["PDF 快速文本解析\npdf-fast-text / marker-md"]
  FastText --> Sections["章节识别\nIntroduction / Discussion / Conclusion"]
  Sections --> SentenceChunks["逐句 chunk"]
  SentenceChunks --> CitationMatch["句尾显式引用匹配\n如 [8,10,13] 或 Author-Year"]
  CitationMatch --> RefMap["匹配参考文献表"]
  SentenceChunks --> ClaimAI["AI 判断句子是否可做论点\nclaimCandidate / claimText / claimType"]
  ClaimAI --> Entries["PDF Wiki entries\n句子级论点库"]
  RefMap --> Entries
  Entries --> UIList["前端展示\n按句子/论点查看"]
  Entries --> Retrieval["进入检索与写作证据"]
  Entries --> AutoResearchEvidence["同步到 AutoResearch 证据库"]
  FastText --> Meta["meta_data.json\n研究地点/作物/处理/土壤指标/表格"]
  Meta --> Export["Meta 表导出"]
```

管理功能：

- PDF 列表、分组、删除、收藏、合并论点。
- PDF 深入分析。
- Meta 模板上传、删除、导出。
- 论点库 rebuild。

关键接口：

- `GET /api/pdf-wiki/status`
- `GET /api/pdf-wiki/entries`
- `POST /api/pdf-wiki/entries/delete`
- `POST /api/pdf-wiki/entries/merge`
- `POST /api/pdf-wiki/entries/favorite`
- `GET /api/pdf-wiki/pdfs`
- `GET /api/pdf-wiki/meta`
- `POST /api/pdf-wiki/meta/delete`
- `POST /api/pdf-wiki/meta/tables/export`
- `POST /api/pdf-wiki/pdfs/:pdfId/deep-analysis`
- `POST /api/pdf-wiki/rebuild`
- `GET /api/pdf-wiki/config`
- `POST /api/pdf-wiki/config`
- `GET /api/pdf-wiki/meta-template`
- `POST /api/pdf-wiki/meta-template`
- `DELETE /api/pdf-wiki/meta-template`

核心代码：

- `src/utils/pdf-wiki-manager.ts`
- `src/utils/pdf-wiki-pdf-management.ts`
- `src/utils/pdf-fast-text.ts`

## 实验资料上传、数据分析与 R 作图流程

```mermaid
flowchart LR
  SelectFile["选择实验资料文件"] --> Pending["pendingExperimentFiles"]
  Pending --> Send["点击发送"]
  Send --> Upload["/api/experiment-results/upload"]
  Upload --> SaveFile["保存到 data/uploads/{userId}/experiment-results"]
  SaveFile --> TypeDetect["识别类型\nimage / pdf / word / table / text"]
  TypeDetect --> Analyze["AI 分析\nCodex CLI -> 小牛马 -> 大牛马"]
  Analyze --> Passport["materialPassport\n可信度 / 来源 / linkedChapters"]
  Analyze --> DataSummary["写入 data_summary"]
  DataSummary --> Structured["异步生成 data_summary_structured"]

  Send --> Intent{"输入框是否包含\n数据分析/作图意图?"}
  Intent -- "是且有表格" --> DataAnalysis["/api/data-analysis/analyze"]
  DataAnalysis --> DataMemory["写入 data_summary\n必要时写 experiment_summary"]
  DataAnalysis --> RIntent{"是否要求 R 作图?"}
  RIntent -- "是" --> RCode["/api/r-code/generate"]
  RCode --> RFile["R 代码 / 可保存到桌面"]
```

注意：上传按钮文案是“上传实验资料”，但这条链路当前更偏“实验结果/数据文件分析”，默认主要写入 `data_summary`。如果用户手动录入实验设计、研究地点、处理设置，应走 `POST /api/research-material/save` 写入 `experiment_summary`。

关键接口：

- `POST /api/experiment-results/upload`
- `GET /api/experiment-results/:userId`
- `DELETE /api/experiment-results/:userId/:fileName`
- `POST /api/data-analysis/inspect`
- `POST /api/data-analysis/analyze`
- `GET /api/data-analysis/methods`
- `POST /api/r-code/generate`
- `POST /api/r-code/save`
- `POST /api/r-code/debug`
- `GET /api/r-code/chart-types`

核心代码：

- `src/server/routes/experiment-results.ts`
- `src/server/services/experiment-analyzer.ts`
- `src/server/routes/data-analysis.ts`
- `src/server/routes/r-code.ts`

## 目标期刊风格、Author Guidelines 与 Cover Letter 要求

```mermaid
flowchart TB
  Input["用户输入"] --> StyleFiles["上传目标期刊样例 PDF/TXT/RIS/Bib"]
  Input --> GuidelineUrl["Author Guidelines URL"]
  Input --> GuidelineText["粘贴 Guidelines 文本"]
  Input --> CoverText["粘贴 Cover Letter 要求"]
  Input --> Crawl["输入期刊名并自动爬取"]

  StyleFiles --> StyleAPI["/api/analyze-journal-style"]
  GuidelineUrl --> StyleAPI
  GuidelineText --> StyleAPI
  CoverText --> StyleAPI
  Crawl --> SearchGuidelines["搜索/抓取候选官网页面"]
  SearchGuidelines --> StyleAPI

  StyleAPI --> AIStyle["AI 提取风格与投稿规范"]
  AIStyle --> StyleStore["data/uploads/{userId}/journal-styles"]
  StyleStore --> ChatWriting["聊天写作引用章节风格"]
  StyleStore --> OneClickWriter["一键写作选择目标风格"]
```

提取内容包括：

- 章节结构和写作风格。
- 句式、语气、常见表达。
- 目标期刊参考文献格式。
- `author_guidelines`
- `cover_letter_requirements`
- `submission_materials.crawl_sources`

关键接口：

- `POST /api/analyze-journal-style`
- `GET /api/journal-styles/list`
- `GET /api/journal-styles/:journal/:section`

## AutoResearch 流程

AutoResearch 是长期自主研究任务，不是普通聊天。用户只填研究主题，系统自动同步文献图谱和证据库，生成假设、缺口、实验计划、草稿框架、自评和最终报告。

```mermaid
stateDiagram-v2
  [*] --> 选题
  选题 --> 文献图谱: sync embedding library
  文献图谱 --> 假设: cluster/tag/topic analysis
  假设 --> 证据库: sync PDF Wiki + embedding abstract evidence
  证据库 --> 实验数据计划
  实验数据计划 --> 草稿
  草稿 --> 审稿式自检
  审稿式自检 --> 修订
  修订 --> 最终报告
  最终报告 --> 一键写论文
```

```mermaid
flowchart LR
  Topic["研究主题"] --> Run["/api/autoresearch/run"]
  Run --> LitMap["文献图谱\nnodes/tags/snapshots"]
  Run --> Evidence["证据库\nPDF Wiki evidence + embedding abstracts"]
  Run --> Memory["项目级研究记忆\nfinding/hypothesis/failure/decision/method/constraint/evidence/todo"]
  Run --> Eval["自评\n引用对齐 / 证据充分性 / 创新性 / 可复现性"]
  Eval --> Report["最终 AutoResearch 报告"]
  Report --> Edit["查看/编辑 Markdown"]
  Report --> Download["下载报告"]
  Report --> WritePaper["一键写论文草稿"]
  WritePaper --> PaperDraft["论文草稿 Markdown / 下载"]
  Run --> Replay["操作记录与 replay 文件\ninput/output/toolResults/version/hash"]
```

关键接口：

- `GET /api/autoresearch/state`
- `GET /api/autoresearch/progress`
- `POST /api/autoresearch/start`
- `POST /api/autoresearch/run`
- `POST /api/autoresearch/stages`
- `POST /api/autoresearch/memory`
- `POST /api/autoresearch/sync-pdf-wiki`
- `POST /api/autoresearch/sync-embedding-library`
- `POST /api/autoresearch/evaluate`
- `GET /api/autoresearch/final-reports/:reportId/markdown`
- `PUT /api/autoresearch/final-reports/:reportId/markdown`
- `GET /api/autoresearch/final-reports/:reportId/download`
- `POST /api/autoresearch/final-reports/:reportId/write-paper`
- `GET /api/autoresearch/paper-drafts/:draftId/markdown`
- `PUT /api/autoresearch/paper-drafts/:draftId/markdown`
- `GET /api/autoresearch/paper-drafts/:draftId/download`
- `POST /api/autoresearch/operations`

核心状态文件：

- `data/autoresearch/{userId}/state.json`
- `projectMemory`
- `failureLessons`
- `evidenceLibrary`
- `literatureMap`
- `operations`
- `evaluations`
- `finalReports`
- `paperDrafts`

## 一键写论文/文稿流程

一键写作是后台长任务，有进度条和打字机式当前状态显示。它根据项目模式生成论文、审稿意见、基金、专利、软著、商业计划书或通用文稿。

```mermaid
flowchart TB
  Dialog["一键写作弹窗"] --> Input["主题 / 要求 / 字数 / 引用格式 / 参考文献格式"]
  Input --> Options["可选上下文\n长期记忆 / 实验资料 / 目标期刊风格 / Codex 优先"]
  Options --> Start["/api/review-writer/start"]
  Start --> Job["后台 Job\nprogress polling"]
  Job --> ARS["ARS pipeline gate\n研究到写作条件检查"]
  ARS --> Outline["AI 自动定结构\n章节/段落/句子计划"]
  Outline --> Retrieval["逐句检索证据\nEmbedding / PDF Wiki / 文献库"]
  Retrieval --> SectionWrite["逐句/逐段写作"]
  SectionWrite --> Quality["严格审稿式质量检查"]
  Quality --> Revise["自动修订 / 保留最高分版本"]
  Revise --> Result["最终正文"]
  Result --> Copy["复制"]
  Result --> Docx["导出 Word"]
```

关键接口：

- `POST /api/review-writer/start`
- `GET /api/review-writer/progress/:jobId`
- `POST /api/review-writer/stop/:jobId`
- `POST /api/review-writer/restart/:jobId`
- `GET /api/review-writer/latest`
- `POST /api/review-writer/generate`
- `POST /api/review-writer/docx`

写作时可使用的上下文：

- 长期记忆：`data/memory/{userId}/memory.json`
- 实验/项目资料：`experiment_summary`、`experiment_summary_structured`、`research_method`、`experimental_design`、`试验资料总结.txt`
- 文献库：Embedding 文献库、PDF Wiki 论点库、普通 literature.json
- 目标期刊/模板风格：`journal-styles`
- Skills：`sci_writing_skills/*`、`skills/paper-writing/SKILL.md`

## 草稿管理流程

```mermaid
flowchart LR
  DraftSource["聊天写作 / 一键写作 / AutoResearch 写论文"] --> DraftAPI["草稿 API"]
  DraftAPI --> FullDraft["完整草稿"]
  DraftAPI --> ChapterDraft["章节草稿"]
  DraftAPI --> SmartSave["智能保存 / 合并新旧内容"]
  FullDraft --> View["查看"]
  FullDraft --> Edit["编辑"]
  FullDraft --> Download["下载 Markdown / LaTeX / Word 等"]
```

关键接口：

- `GET /api/draft/:userId`
- `GET /api/draft/:userId/download`
- `POST /api/draft/:userId`
- `PUT /api/draft/:userId`
- `POST /api/draft/:userId/smart-save`
- `DELETE /api/draft/:userId`
- `POST /api/draft/:userId/confirm-action`
- `POST /api/chapter-draft/:userId`
- `DELETE /api/chapter-draft/:userId/:chapter`
- `POST /api/paper-draft/save`

## 检索增强写作流程

```mermaid
flowchart LR
  Query["用户问题 / 章节任务 / 句子任务"] --> Detect["/api/retrieval/detect\n判断是否需要检索"]
  Detect --> Execute["/api/retrieval/execute"]
  Execute --> BM25["BM25 Retriever"]
  Execute --> Vector["Vector Retriever"]
  Execute --> Meta["Metadata Filter"]
  BM25 --> Fusion["分数融合 / rerank"]
  Vector --> Fusion
  Meta --> Fusion
  Fusion --> Evidence["候选文献/句子证据"]
  Evidence --> Writer["写作 Agent"]
  Writer --> Citation["Citation Manager\nAPA / GB/T 7714"]
```

核心代码：

- `src/literature/retrieval/bm25-retriever.ts`
- `src/literature/retrieval/vector-retriever.ts`
- `src/literature/retrieval/hybrid-engine.ts`
- `src/literature/retrieval/sentence-retriever.ts`
- `src/literature/citation/citation-manager.ts`

## 备份、导入导出和系统配置

```mermaid
flowchart TB
  Config["系统配置"] --> Settings["/api/settings\n模型/接口设置"]
  Config --> Model["/api/model / /api/models"]
  Config --> ChatBridgeConfig["/api/chat-bridge/config"]
  Config --> CodexStatus["/api/chat-bridge/codex/status"]
  Config --> Embedding["/api/embedding/config"]
  Config --> PdfWikiConfig["/api/pdf-wiki/config"]

  Backup["备份"] --> Create["/api/backups/create/:userId"]
  Backup --> List["/api/backups/:userId"]
  Backup --> Restore["/api/backups/restore"]

  Feedback["用户反馈"] --> FeedbackAPI["/api/feedback"]
```

关键数据目录：

| 目录/文件 | 作用 |
|---|---|
| `data/memory/{userId}/memory.json` | 普通跨会话长期记忆 |
| `data/memory/{userId}/conversations/*.json` | 会话记录与摘要 |
| `data/uploads/{userId}/literature.json` | 文献库 |
| `data/uploads/{userId}/index-cache/` | 检索/向量索引缓存 |
| `data/uploads/{userId}/journal-styles/` | 目标期刊或模板风格 |
| `data/uploads/{userId}/experiment-results/` | 上传的实验资料/结果文件 |
| `data/autoresearch/{userId}/` | AutoResearch 状态、报告、回放 |
| `data/chat-bridge-config.json` | 大牛马/小牛马/Codex 配置 |
| `data/backups/` | 项目备份 |

## 节点清单，便于绘图

### 用户入口节点

- 主对话
- 上传文献摘要
- 上传 PDF 生成论点库
- 上传实验资料
- 上传目标期刊样例
- 目标期刊 Author Guidelines / Cover Letter 爬取
- AutoResearch
- 一键写论文/文稿
- 数据分析
- R 语言作图
- 长期记忆管理
- 项目管理
- API/模型配置

### 后端 API 模块节点

- Auth/Quota/Feedback
- ChatBridge
- Memory
- Literature
- Embedding Library
- PDF Wiki
- Experiment Results
- Data Analysis
- R Code
- Journal Style
- AutoResearch
- Review Writer
- Draft
- Project Manager
- Backup Manager

### AI/Agent 节点

- Codex CLI
- PrimaryAgent 大牛马
- SecondaryAgent 小牛马
- LiteratureSearchAgent
- ParallelSearchOrchestrator
- SentenceChunker
- ParagraphAgent
- CowAgent
- ChatBridge provider fallback

### 数据节点

- memory.json
- conversations
- literature.json
- index-cache
- pdf-wiki store
- meta_data.json
- journal-styles
- experiment-results
- drafts
- autoresearch state
- replay files
- backups

### 输出节点

- 聊天回答
- 章节草稿
- 完整论文/文稿
- Word 文件
- Markdown 文件
- AutoResearch 最终报告
- AutoResearch 论文草稿
- PDF Wiki 论点库
- PDF Meta 表
- 文献图谱
- 数据分析报告
- R 作图代码
- 期刊风格指南
- Cover Letter 要求

## 建议最终绘图布局

```text
[用户]
  |
  v
[前端主界面 index.html]
  |-- 对话写作 ---------> ChatBridge/Agents ---------> 草稿/记忆/会话
  |-- 文献上传 ---------> 文献解析/Embedding --------> 文献库/检索证据
  |-- PDF 上传 ---------> PDF Wiki 深入分析 -------> 句子级论点库/Meta
  |-- 实验资料上传 -----> Codex/小牛马/大牛马 -----> data_summary/结构化总结
  |-- 数据分析/R作图 --> 统计分析/R 代码 ----------> 分析报告/R脚本
  |-- 期刊风格 ---------> 样例+官网爬虫+AI提取 ----> journal-styles
  |-- AutoResearch -----> 文献图谱+证据库+自评 ----> 最终报告/论文草稿
  |-- 一键写作 ---------> 结构规划+逐句检索+审稿 --> Word/Markdown
  |-- 记忆管理 ---------> memory.json/txt ----------> 后续写作上下文
  |-- 项目管理/备份 ----> project-manager/backup ---> 项目切换/恢复
```

## 图中需要强调的规则

- 上传实验资料后，发送消息会先走实验资料上传分析，不再继续普通聊天。
- PDF Wiki 句子引用匹配以显式文中引用为主，不把 semantic 候选当成直接引用。
- 实验资料/项目资料用于背景和方法上下文，不作为文献引用证据。
- 写作中的科学事实和引用应来自文献库、PDF Wiki 证据或用户明确提供的数据。
- AutoResearch 的核心不是一次性生成文本，而是“文献图谱 -> 假设 -> 证据库 -> 自评 -> 报告 -> 草稿”的可追溯闭环。
- 所有长期任务都应记录输入、输出、工具结果、版本和可回放文件。

