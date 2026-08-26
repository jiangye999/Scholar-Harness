# AI 工作区产物目录规范（Workspace Artifact Layout）

> 版本：v2.0 ｜ 适用：Scholar Harness 1.0.8 ｜ 关联实现：`src/server/services/workspace-workbench.ts`、`src/server/services/workspace-artifact-layout.ts`、`src/server/services/workspace-output-mirror.ts`

本文档定义 AI 在工作路径（AI 工作区）与用户工作台中的**统一产物目录结构**，使草稿、图表、代码、数据不再散落各处。

## 0. 三条基本原则

1. **源文件永久只读**：用户工作目录（`<workspaceRoot>/`）中的原始文件只允许扫描和复制。AI 不得修改、移动、重命名或删除它们，也不存在“发布回原路径”的例外。
2. **跨会话增量生成**：`figure1…figureN` 与 `table1…tableN` 不是一次性生成的。每次生成图表 Word 前，系统会把同一项目所有历史 `Conversation-*` 的图表源合并到项目级 `项目累计产物/`；不同编号持续追加，同编号使用最新源文件，然后据此重建完整 Word。
3. **最新文件通过快捷方式交付**：AI 生成或修改的用户可见文件保存在当前会话工作台；`<workspaceRoot>/用户查看/`只保存快捷方式。快捷方式每次覆盖刷新，始终指向最新工作文件。三个主要 Word 另存项目级稳定副本，后续会话不得使其消失。

## 1. 三层工作区

| 层级 | 位置 | 说明 |
|---|---|---|
| 用户源文件 | `<workspaceRoot>/` | 用户授权目录中的原始材料；AI 只能读取和复制 |
| AI 工作台 | `<workspaceRoot>/ScholarHarness_AI_Workspaces/Conversation-<会话id>/` | 每个会话独立工作；包含完整源副本、可修改工作文件和规范产物 |
| 用户查看 | `<workspaceRoot>/用户查看/` | 仅存放最新产物快捷方式；用户从这里打开和继续修改 AI 工作台中的真实文件 |

每个 Agent 回合开始前，所有当前源文件都会刷新到 `<aiWorkRoot>/源文件副本/`；该副本也只读。第一次编辑某个源文件时，系统从源副本初始化 `<aiWorkRoot>/工作文件/<相对路径>`。后续回合继续读取工作文件，因此用户通过快捷方式做的人工修改不会被旧源副本覆盖。未配置工作目录时，Codex、Pi 和 OpenCode 使用 `<dataDir>/agent-workspaces/<agent>/<user>/<project>/<conversation>/`，不得退回应用源码仓库作为 cwd。

## 1.1 产物发布策略

- Shell、Codex CLI、Pi 和 OpenCode 自动发现的用户可见新增/修改文件保留在当前会话目录，并自动刷新相应快捷方式。
- 日志、缓存、临时脚本、逐页渲染图、诊断输出和中间数据禁止自动发布。
- 修改已有源文件时，`write_file`、`edit_file`、`office_apply` 只修改 `工作文件/`中的派生版本。
- `publish=true` 与 `publish_workspace_artifacts` 保留为兼容接口，但“发布”仅表示刷新快捷方式，不复制文件、不覆盖源文件。
- 每轮准备和每次产物刷新都会重写 `README_ScholarHarness_AI_Workspace.md`，记录规则、目录和当前产物。

## 2. 规范目录结构

```
<aiWorkRoot>/
├── 源文件副本/                    # 每轮完整刷新，只读
├── 工作文件/                      # 源文件的持续可编辑派生版本
├── framework/                     # 正文框架、章节规划、提纲
├── drafts/                          # 草稿
│   ├── paper-draft.docx             # 持续更新的唯一主要 Word 草稿
│   └── analysis_code.R / .py        # 代码文件
├── supplementary/                 # 补充文件与补充 Word
│   ├── supplementary-materials.docx # 持续更新的补充材料 Word
│   └── figure1/… / table1/…         # 补充图表，结构同正文图表
├── other_outputs/                  # 其他用户可见产物
├── README_ScholarHarness_AI_Workspace.md
│
└── figures_tables/                  # 图表总文件夹
    ├── figures_tables.docx          # 图片整合文件（自动生成）
    ├── figure1/                     # 每图一个子文件夹
    │   ├── figure1.png              # 图片位图
    │   ├── figure1.pdf              # 矢量版
    │   ├── figure1.R                # 作图代码（.py 同理）
    │   ├── figure1_data.csv         # 作图数据
    │   └── figure1_caption.txt      # 图注（首行标题，其余为注解，可选）
    ├── figure2/ … figureN/
    ├── table1/
    │   ├── table1.png / table1.pdf  # 表格导出图（可选）
    │   ├── table1.R                 # 生成表格的代码
    │   ├── table1_data.csv          # 表格数据（生成整合 Word 必需）
    │   └── table1_caption.txt       # 表题（首行）+ 注解（可选）
    └── table2/ … tableN/
```

项目内还会维护 `<projectRoot>/项目交付物/`，固定保存 `paper-draft.docx`、`figures_tables.docx`、`supplementary-materials.docx` 的最新稳定副本。“用户查看/drafts”始终指向这里；某轮没有生成对应内容时保留已有版本，不删除、不改名，也不创建 `v2/final/latest` 等平行主文件。

项目内同时维护 `<projectRoot>/项目累计产物/figures_tables/` 和 `<projectRoot>/项目累计产物/supplementary/`。它们是跨会话图表源的项目级累计副本；`figures_tables.docx` 与 `supplementary-materials.docx` 必须从这里的完整集合生成，不能只读取当前会话。

“用户查看”固定分类如下：

- `drafts/`：只放 `paper-draft.docx`、`figures_tables.docx`、`supplementary-materials.docx`；
- `figure/`：正文图表及其 PNG、PDF、R、Python、Excel、TXT、CSV 等配套文件；
- `framework/`：`paper-draft.docx` 对应的论文框架与章节规划；
- `supplementary/`：补充材料及其配套文件；
- `other_outputs/`：不属于以上类别的其他用户可见产物。

### 命名规则

- 图表子文件夹固定命名：`figure1`、`figure2`…`figureN` 与 `table1`、`table2`…`tableN`（小写、无空格）。
- 子文件夹内文件名：
  - 图片：`figureN.png`（`tableN.png` 可选）
  - 矢量版：`figureN.pdf`
  - 作图代码：`figureN.R` / `figureN.py`（保留原扩展名大小写）
  - 作图数据：`figureN_data.csv`（`tableN_data.csv`）
- 标题与注解文件：`figureN_caption.txt` / `tableN_caption.txt`（也支持 `.md`）；**首行为标题/图注，其余行合并为注解**。
- 无法识别编号的散乱文件（如 `last_plot.png`、`plot_codes.R`）不会被自动移动，会列入 `unclassified` 报告，等待用户或 AI 指定归属。

## 3. 图片整合文件排版规则

`figures_tables.docx` 由后端自动生成，排版遵循学术惯例：

| 元素 | 位置 |
|---|---|
| 图（Figure） | 图片本体 → **图注在图片下方** → 注解在图注下方 |
| 表（Table） | **表题在表格上方** → 表头行加粗置顶 → 表格 → **注解在表格下方** |

- 支持嵌入 PNG / JPG（按 5.6 英寸宽度等比缩放）；PDF/SVG 等不可嵌入格式会在图注下加占位说明，原文件保留在子文件夹。
- 表格数据来自 `tableN_data.csv`（首行作为表头，最多 40 行数据）。
- 无图片的 `figureN/` 与无 CSV 数据的 `tableN/` 会被跳过并列入 `skipped` 报告。
- 每个已纳入 Word 的图片和表格都写出标题、图注/表注及“文件位置”，以便回溯实际图片或表格数据源。
- `supplementary-materials.docx` 使用相同排版规则，但只读取 `supplementary/` 下的图表。

## 4. API

所有接口复用现有工作目录授权（`prepareWorkspaceOutputDirectory`），需传 `workspaceRoot` + `permission`（非只读）+ `conversationId`。

| 端点 | 说明 |
|---|---|
| `POST /api/workspace-artifacts/import` | **审查源目录并复制归类**（源文件不动）：扫描用户工作目录，把可识别编号的图表资产复制进 `figures_tables/figureN|tableN/`、Word 草稿复制进 `drafts/`；幂等增量，可反复执行；`mode: copy \| dry-run`；`buildDocx: true` 时重新生成整合 Word |
| `POST /api/workspace-artifacts/organize` | 整理 **AI 工作区内**自身产生的散乱产物（AI 生成物可移动）；`mode: move \| copy \| dry-run`；`buildDocx`、`captions` 同上 |
| `GET /api/workspace-artifacts/layout` | 返回当前会话 AI 工作区的规范结构视图（drafts 文件 + 全部 figureN/tableN 条目） |
| `POST /api/workspace-artifacts/build-integrated-docx` | 仅重新生成 `figures_tables.docx` |

导入请求示例（用户配置完工作目录后第一次审查归类，或持续工作中随时追加）：

```json
POST /api/workspace-artifacts/import
{
  "workspaceRoot": "C:/Users/me/projects/paper",
  "permission": "workspace-write",
  "conversationId": "abc-123",
  "mode": "copy",
  "buildDocx": true,
  "captions": {
    "figure1": { "caption": "Treatment effects by group", "note": "数据来自实验记录。" }
  }
}
```

导入规则：

- 源目录扫描自动**跳过 `ScholarHarness_AI_Workspaces` 容器和 `用户查看`**（二者都不是源文件）与 `.git`/`node_modules` 等目录；
- 能解析出 `figureN/tableN` 编号的图片/PDF/代码/数据文件 → 复制到对应子文件夹（规范文件名）；
- `.docx/.doc` → 复制到 `drafts/`；
- 无法识别编号的文件 → 列入 `unclassified` 报告，原样留在源目录；
- 目标已存在同名文件 → 列入 `skipped` 报告，**不覆盖**（保证增量不破坏已有产物）。

## 5. AI 约束

AI 工作目录上下文（`buildWorkspaceDirectoryContext`）会向模型注入「AI 产物目录规范」与「源文件保护与增量归类」两节，要求：

1. Word 草稿与代码文件写入 `drafts/`；
2. 所有图片与表格写入 `figures_tables/`，每个图表一个 `figureN/` / `tableN/` 子文件夹；
3. 每个子文件夹内放位图、矢量版、作图代码、作图数据四类文件；
4. 作图脚本直接输出到对应子文件夹，不把产物散落在根目录或临时目录；
5. 需要标题/注解时在子文件夹内写 `figureN_caption.txt`（首行标题，其余注解）；
6. **用户目录原始文件永久只读**；指定修改已有文件时，也只能修改 `工作文件/`中的派生版本；
7. **figureN/tableN 随持续工作逐步生成**，每轮只追加新增内容，不要求一次整理完。
8. Shell/CLI 的用户可见生成物留在会话工作区并刷新 `用户查看`快捷方式，不能整批回灌或覆盖源目录。
9. 持续维护三个固定 Word；相关内容变化后刷新，本轮无变化则保留，不得删除、改名或用带版本号文件替代。

## 6. 与现有产物来源的对应

| 现有来源 | 规范落点 |
|---|---|
| R 作图（`r-code` jobDir/plots） | 整理后进入 `figures_tables/figureN/` |
| 数据分析工作台产物 | 整理后进入 `figures_tables/figureN|tableN/` |
| 写作草稿 docx（review-writer / 大论文工作台） | `drafts/` |
| Meta 分析 R 脚本与数据 | `figures_tables/` 对应子文件夹 |
