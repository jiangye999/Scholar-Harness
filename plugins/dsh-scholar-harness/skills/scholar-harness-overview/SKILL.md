---
name: scholar-harness-overview
description: Inspect the local Scholar Harness desktop service — literature library, sentence-level PDF Wiki evidence library, and Meta analysis database status. Use whenever the user asks about 文献库/PDF Wiki/证据库/Meta 状态 in Scholar Harness, or before starting any academic writing workflow that depends on the local service.
---

# Scholar Harness 概览（本地服务状态）

使用 `scholar_*` 工具检查本机 Scholar Harness 服务。Scholar Harness 桌面端是唯一数据源；这些工具是只读状态入口，不修改任何数据。

## 流程

1. 先调用 `scholar_health`。若 `reachable: false`，告诉用户先启动 Scholar Harness 桌面软件（默认 http://127.0.0.1:18789），不要继续。
2. 需要文献库概览时调用 `scholar_literature_list`；需要检索时调用 `scholar_literature_search`（默认 hybrid 混合检索）。
3. 需要 PDF Wiki 证据库状态时调用 `scholar_pdf_wiki_status`，主题目录用 `scholar_pdf_wiki_topics`。
4. 需要 Meta 分析数据时调用 `scholar_meta_sources`。

## 约束

- 不要把「文献库为空」当作服务故障；先看 `scholar_health`。
- 检索分数（combinedScore）只是排序线索，不代表引用可信度；引用依据必须来自证据句与参考文献映射（在 Scholar Harness 桌面端核对）。
- 本插件只读：论文写作、Meta 全流程、R 作图仍引导用户在 Scholar Harness 桌面端完成。
