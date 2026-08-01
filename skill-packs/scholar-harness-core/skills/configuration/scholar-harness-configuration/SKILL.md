---
name: scholar-harness-configuration
description: Configure and teach Scholar Harness after the secondary agent is available. Use when a user wants to set up or troubleshoot the primary agent, secondary agent, Embedding API, Codex CLI, R/Python/Office runtimes, MCP plugins, built-in or user Skills, workspace access, or literature imports from Web of Science/CNKI in RIS, TXT, BibTeX, or PDF form.
---

# Scholar Harness 配置与使用向导

## 目标

把配置任务变成由小牛马主持的逐步向导：先识别用户要完成的科研任务，再检查当前能力，只补齐真正需要的配置。能由 Scholar Harness 打开或检测的界面直接调用页面动作，不让用户在菜单中反复寻找。

## 对话规则

1. 先确认小牛马可用；如果不可用，打开小牛马配置，并在其保存成功后继续。
2. 一次只询问一个会改变配置路径的问题。不要一次抛出长清单。
3. 先问用户要完成什么，例如论文写作、PDF Wiki、文献计量、Meta 分析、R 作图或 Office 文档处理；由目标反推最小配置集。
4. 说明“必需、推荐、可选”，不要诱导用户把所有能力都装一遍。
5. API Key、密码、令牌不得要求用户发在普通聊天消息里。打开对应的本机密码输入框，让用户在那里粘贴；不得复述、展示或写入日志。
6. 登录、注册、付费、验证码和授权确认由用户本人完成。可打开官方页面，但不得代替用户登录或购买。
7. 保存后重新检测连接；成功时明确说已经能做什么，失败时给出一个最可能原因和一个下一步。
8. 安装 Skill 或插件前先展示名称、用途、来源和需要的权限。涉及联网、文件写入或命令执行的 MCP，要让用户明确确认。

## 执行流程

### 1. 形成最小配置方案

根据用户目标从下列能力中选择：

- 日常问答与轻量执行：小牛马。
- 规划、复杂推理、Skill 生成与质量检查：大牛马。
- 语义检索、摘要/句子相似匹配：Embedding。
- 本地工程修改、文件操作和复杂自动化：Codex CLI。
- 数据分析和论文作图：R；通用脚本和数据处理：Python；Word/Excel/PPT：OfficeCLI。
- 外部检索、知识库或专业服务：MCP 插件。
- 稳定复用的任务规则：系统内置或用户 Skill。
- PDF 句子级证据与引用尾注：PDF Wiki。
- 摘要级检索、文献计量和写作准备：WoS/CNKI/RIS/TXT 文献导入。

需要字段、推荐依赖和验证条件时读取 `references/configuration-map.md`。

### 2. 使用 Scholar Harness 页面动作

回复末尾可以输出一个页面动作块。动作块会被前端移除并立即执行：

```html
<scholar-harness-ui-action action="open_secondary_config"></scholar-harness-ui-action>
```

只使用以下动作：

- `open_secondary_config`：打开小牛马安全配置。
- `open_primary_config`：打开大牛马安全配置。
- `open_embedding_config`：打开 Embedding 安全配置。
- `open_vendor_config`：在右侧隔离网页视图中打开模型厂商官网；必须提供白名单中的 `vendor_id`：`openrouter`、`dashscope`、`qwen`、`deepseek`、`zhipu`、`moonshot`、`volcengine`、`baidu` 或 `tencent`。
- `open_codex_config`：打开 Codex 配置并自动展开。
- `open_skill_config`：打开 Skill 清单和持续使用选择。
- `set_persistent_skills`：在用户明确确认后，把已选 Skill 直接加入持续使用；同时提供 `skill_ids="精确ID1,精确ID2"`。
- `open_runtime_plugins`：打开 R、Python、OfficeCLI 与 MCP 插件页。
- `open_workspace_panel`：打开工作目录面板。
- `upload_literature`：打开 RIS/TXT/BibTeX 等文献题录上传。
- `upload_pdf_wiki`：打开 PDF Wiki 上传。

每次最多执行一个最符合当前步骤的动作。不要同时打开多个页面。不得把任意网址放进动作参数；只能使用 `vendor_id`，由软件映射并校验官网地址。

### 3. 配置模型与本地能力

- 大牛马、小牛马和 Embedding：先让用户选平台，再用 `open_vendor_config` 在右侧打开官网，例如：

```html
<scholar-harness-ui-action action="open_vendor_config" vendor_id="deepseek"></scholar-harness-ui-action>
```

用户取得 Key 后只在密码框粘贴，填写服务商给出的 Model ID，检测通过后保存。若厂商登录或验证流程不能在内置视图完成，让用户点击右侧的“浏览器打开”回退。
- Codex：先自动检测现有命令；检测到就启用并选择模型/Reasoning Effort，未检测到才说明安装步骤。
- R、Python、OfficeCLI：优先自动检测；检测失败再让用户选择“一键安装”或提供可执行文件完整路径。
- 不把官网账号 API、网页地址或模型展示名误当作 OpenAI 兼容 API URL、API Key 或 Model ID。

### 4. 配置 Skill

先调用 `list_available_skills` 按用户任务筛选，不要把全部 Skill 内容塞进对话。每项只展示名称、能解决的问题、来源和是否建议持续使用。

用户明确选择后，可以执行 `set_persistent_skills` 直接加入持续使用；需要浏览、导入或手动调整时再打开 `open_skill_config`。系统自带 Skill 可由 AI 自动按意图加载；“持续使用”只用于用户希望每轮都附加的规则。

### 5. 配置插件

先说明内置运行时与 MCP 的差别：

- R/Python/OfficeCLI 是本机运行时。
- MCP 是向 AI 暴露工具的服务，启用后 AI 会根据工具名称和用途自行选择。

打开 `open_runtime_plugins` 后，优先展示已安装插件；需要新能力时在 MCP 市场按任务关键词检索。只有安装成功、发现工具成功且启用的 MCP 才算配置完成。

### 6. 教用户导入和使用文献

涉及 WoS、CNKI、RIS、TXT、BibTeX、PDF 或“怎么上传文献”时读取 `references/literature-import.md`。

必须先区分：

- 文献题录/摘要库：使用 `upload_literature`，适合检索、Embedding、Auto Research 和文献计量。
- PDF Wiki：使用 `upload_pdf_wiki`，适合原文句子、论点、文中引用和尾注证据。

不要把 RIS/TXT 当作全文 PDF，也不要承诺题录文件能提供原文句子。

## 完成标准

结束配置前给出一份短验收：

- 已配置并通过检测的能力；
- 尚未配置但不影响当前目标的能力；
- 用户现在可以直接发出的第一条任务示例；
- 如涉及文献，明确下一步上传哪类文件、走哪个入口。
