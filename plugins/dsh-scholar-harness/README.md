# dsh-scholar-harness

Scholar Harness 核心功能接入 DeepSeek Harness（DSH）：把本地 Scholar Harness 桌面服务的文献库、句子级 PDF Wiki 证据库、Meta 分析数据库以 DSH 插件的形式暴露给 Agent 与 Web GUI。

- **Host 半部**（`lib/index.js`）：连接本机 Scholar Harness 本地服务（默认 `http://127.0.0.1:18789`），注册 `scholar_*` Agent 工具、`/api/dsh-scholar/*` HTTP 路由与系统提示段。
- **浏览器半部**（`lib/client.js`）：在 DSH Web GUI 侧边栏注入「Scholar」入口，主栏渲染概览 / 文献 / PDF Wiki / Meta 四个面板。

## 安装（当前 DSH web profile）

```sh
# 从本包所在目录（dsh-scholar-harness/）执行；dsh 会把相对路径锚定到当前目录
dsh plugin --profile web add link:./
```

这会执行 `pnpm add link:...`，并把本包加入 profile 的 `dsh.profile.bundles`（因为 package.json 声明了 `dsh.bundle.patch`）。重启 `dsh web` 后插件生效。

> 本机 `node_modules/@deepseek-ai/*` 是指向 DSH 安装目录的 junction（`scripts/setup-junctions.cmd` 可重建）；`.gitignore` 已忽略该目录，源码不依赖它。

### 重启与验证

- **一键重启 GUI**（激活插件，需管理员）：`npm run restart-dsh-web`（等价双击 `scripts/restart-dsh-web.bat`）。重启后刷新 http://127.0.0.1:3080。
- **冒烟测试**（连活服务，零依赖）：`npm run smoke` 或 `node scripts/smoke-test.cjs`，覆盖引擎 6 方法 + 工具导出 + 路由表 + 客户端 bundle 契约。
- **配置合成检查**（无需重启）：`dsh --profile web --dump-config | findstr scholar`。

### 启用（若 bundle 未自动挂载）

确认 `C:\Users\Administrator\.dsh\profiles\web\package.json` 的 `dsh.profile.bundles` 已包含 `"dsh-scholar-harness"`；若没有，手动追加一行（与本包 `cordis.patch.yml` 的 `- insert` 配合完成挂载）。

### 技能（可选）

```sh
# 把技能复制到用户 skill 根目录，DSH 即可发现
mkdir -p ~/.dsh/skills
cp -r skills/* ~/.dsh/skills/
```

## Agent 工具

| 工具 | 说明 |
|---|---|
| `scholar_health` | 服务可达性、当前用户、R 插件状态 |
| `scholar_literature_list` | 文献库（papers + 年份/期刊/关键词摘要，≤100 篇） |
| `scholar_literature_search` | 混合检索（BM25 + vector + rerank） |
| `scholar_pdf_wiki_status` | PDF Wiki 句子级证据库状态（PDF/论点组/句子点/队列） |
| `scholar_pdf_wiki_topics` | PDF Wiki 主题目录 |
| `scholar_meta_sources` | Meta 分析数据库摘要 |

## GUI 路由

| 路由 | 说明 |
|---|---|
| `GET /api/dsh-scholar/health` | 健康 |
| `GET /api/dsh-scholar/literature` | 文献库 |
| `POST /api/dsh-scholar/literature/search` | 检索（body: `{query, topK?, mode?}`） |
| `GET /api/dsh-scholar/pdf-wiki/status` | PDF Wiki 状态 |
| `GET /api/dsh-scholar/pdf-wiki/topics` | 主题目录 |
| `GET /api/dsh-scholar/meta` | Meta 数据库摘要 |

所有路由带 loopback-only 信任栅栏（与 dsh-ssh 一致），LAN 暴露部署不会对外提供本机学术数据。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `http://127.0.0.1:18789` | Scholar Harness 本地服务地址；可用环境变量 `SCHOLAR_HARNESS_URL` 覆盖 |
| `timeoutMs` | `30000` | 每次请求超时 |
| `announceToAgent` | `true` | 是否向 Agent 系统提示词注入插件说明 |
| `enabled` | `true` | 总开关 |

## 数据与安全

- 数据来自本机 Scholar Harness 服务同一用户目录；插件只读，不写任何文献/证据/Meta 数据。
- 检索分数只是线索，引用可信度以 Scholar Harness 证据句与参考文献映射为准（与桌面端产品底线一致）。
- 插件是纯 JS、无构建步骤；`lib/client.js` 为手写 loader 闭包（无平台模块依赖，`dsh.client.inject` 为空）。
