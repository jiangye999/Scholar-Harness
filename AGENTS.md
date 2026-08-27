# AGENTS.md - Scholar Harness 当前开发指南

**项目**: Scholar Harness 论文写作助手  
**当前版本**: 1.0.10
**产品形态**: Electron 桌面软件 + 本地 Express 服务 + 云端账号/授权服务 + 官网下载页  
**技术栈**: Node.js 22+ / TypeScript / Express / Electron / Vitest / Next.js  
**核心架构**: 两级 AI Agent 协作 + PDF Wiki 句子级证据库 + 混合检索 + 数据分析/R 作图工作流

本文档给后续接手项目的 Agent 使用。除非子目录有更具体的 `AGENTS.md`，本文件规则适用于整个仓库。

---

## 快速命令

### 主应用

```bash
npm run dev
npm run build
npm start
npm test
npx vitest run
npx vitest run __tests__/agents
```

### Electron 桌面端

```bash
npm run electron:dev
npm run electron:preview
npm run electron:build
npm run electron:build:debug
npm run electron:build:mac
npm run electron:build:signed
```

### 云端服务

```bash
cd cloud
npm run dev
npm run build
npm start
npm test
npm run db:migrate
```

### 官网

```bash
cd scholarharness-website
npm run dev
npm run build
npm run lint
```

---

## 当前产品边界

Scholar Harness 当前不是单一聊天应用，而是一个桌面科研写作平台。改动时要明确自己触碰的是哪一层：

1. **桌面壳层**: `electron/`，负责窗口、登录页、本地服务启动、打包图标和安装包行为。
2. **本地后端**: `src/server/local-server.ts` 与 `src/server/routes/`，负责本地 API、文件处理、PDF、R、Auto Research、计量和 Meta 分析。
3. **前端主界面**: `src/public/index.html`，当前大量交互仍集中在单文件 HTML/JS 中。
4. **AI Agent 层**: `agents/`、`workflows/`、`src/orchestrator/`，负责论文写作、检索、任务编排和质量控制。
5. **文献/PDF/证据层**: `src/literature/`、`src/utils/pdf-wiki-manager.ts`、`src/utils/autoresearch-manager.ts`。
6. **云端账号和授权**: `cloud/`，负责注册、登录、验证码、订阅、激活码、内测码、下载统计。
7. **官网**: `scholarharness-website/`，负责产品展示、注册入口、帮助文档、下载入口。
8. **部署和安装包**: `dist-electron/`、`scholarharness-website/public/downloads/`、服务器 `/root/website/out/downloads/`。
9. **DSH 插件（能力外放）**: `plugins/dsh-scholar-harness/`，把本地 Scholar Harness 服务以 DeepSeek Harness 插件形式暴露给 DSH Agent 与 Web GUI（`scholar_*` 工具、`/api/dsh-scholar/*` 路由、侧边栏「Scholar」面板、SKILL.md 技能）。只读接入，不碰产品底线；与 `docs/pi-agent-cache-and-dsh-plan.md` 的路线 C 一致。

---

## 目录地图

```text
agents/                         两级 Agent 与写作执行
workflows/                      对话流程状态机
src/
  public/index.html             桌面应用主界面
  server/local-server.ts         本地 Express 主入口
  server/routes/                 本地 API 路由
  server/services/               本地服务层
  literature/                    文献解析、检索、引用格式
  utils/                         PDF Wiki、Auto Research、日志、路径、备份等
  bridge/                        AI provider 与 chat bridge
  research/                      研究会话与综述工具
  config/                        写作 profile、Auto Research、引用约束等
electron/                       Electron 主进程、预加载、登录窗口
cloud/                          云端 API、认证、支付、数据库、授权
scholarharness-website/          官网 Next.js 静态站点
configs/                        模型、期刊、检索配置
sci_writing_skills/             章节写作技能
skills/                         通用写作技能
scripts/                        构建、图标、bytecode、复制资源脚本
tools/                          外部工具资源，例如 GetData、PPT master
__tests__/                      Vitest 测试
docs/                           项目说明、法务、集成文档
artifacts/                      生成产物和临时材料，默认不要提交
```

---

## 核心流程

### 论文写作与两级 Agent

```text
用户输入主题/材料
  -> ConversationFlow 识别阶段
  -> PrimaryAgent 生成检索问题和写作 Skill
  -> LiteratureSearchAgent/HybridRetrievalEngine 检索材料
  -> SecondaryAgent 写章节并验证引用
  -> 质量检查、格式化、下载输出
```

关键文件：

- `agents/primary-agent.ts`
- `agents/secondary-agent-v2.ts`
- `agents/literature-search-agent.ts`
- `agents/agent-collaboration-workflow.ts`
- `agents/parallel-search-orchestrator.ts`
- `workflows/conversation-flow.ts`
- `src/server/routes/unified-chat.ts`
- `src/server/unified-chat-processor.ts`

写作相关改动必须保持：

- 用户阶段可恢复。
- 章节计划、写作进度和下载文件路径可追踪。
- AI 输出不能绕过引用校验。
- 长任务要有进度日志，不能让前端无反馈等待。

### 文献检索

混合检索由 BM25、向量检索和元数据过滤组成。

关键文件：

- `src/literature/parsers/`
- `src/literature/retrieval/bm25-retriever.ts`
- `src/literature/retrieval/vector-retriever.ts`
- `src/literature/retrieval/hybrid-engine.ts`
- `src/literature/retrieval/sentence-retriever.ts`
- `src/utils/retrieval-engine-manager.ts`

注意事项：

- 不同来源文献必须统一到 `UnifiedLiterature`。
- DOI、题名、年份、期刊、摘要和关键词字段不要随意改名。
- 检索分数变化会影响写作和 Auto Research 质量，改动后要补测试或跑真实样例。

### PDF Wiki 句子级证据库

PDF Wiki 是当前软件的重要壁垒。它不是普通 PDF 摘要，而是句子级证据库。

关键逻辑：

- 给 PDF 原文句子分配稳定 `sentenceId`。
- 抽取句子级论点。
- 保存 `evidenceSentenceIds`、`inTextCitations`、`referenceIndexes`。
- 文中引用使用唯一编号。
- 尾注使用“编号 + 句子内容 + 来源信息”与文中编号一一对应。

关键文件：

- `src/utils/pdf-wiki-manager.ts`
- `src/utils/pdf-wiki-pdf-management.ts`
- `src/server/routes/pdf-fast-text.ts`
- `src/server/routes/pdf-marker.ts`
- `src/server/local-server.ts` 中 PDF Wiki 相关路由
- `__tests__/utils/pdf-wiki-manager.test.ts`

维护规则：

- 不要让 AI 根据语义猜参考文献编号。
- `referenceIndexes` 只能来自证据句明确出现的引用或可信候选。
- `match=bm25` 只能作为排查线索，不能直接作为引用依据。
- 阅读原文界面的功能以气泡展开为主，保留与 AI 聊天能力。

### Auto Research

Auto Research 用于选题审查、文献图谱、证据蓝图和研究报告。

关键文件：

- `src/utils/autoresearch-manager.ts`
- `src/server/routes/autoresearch.ts`
- `src/config/auto-research-paper-topic-skill.ts`
- `__tests__/utils/autoresearch-manager.test.ts`

维护规则：

- 结果应能作为输入框上方“持续使用”上下文。
- 用户勾选后，必须随 query 一起进入 AI 请求。
- 生成报告、草稿和附件时，应直接在聊天气泡下方提供下载链接。

### 文献计量分析

当前文献计量分析不仅输出图表，还服务于论文写作准备。

界面要求：

- 在“基于文献计量学的研究热点、主题演化与知识结构分析”气泡下方并列展示：
  - 计量学论文草稿
  - 10 项分析就绪度
  - 方法部分可写内容
  - 结果部分可写内容
  - 讨论角度
  - 局限性
- 用户鼠标移动到哪个气泡，就在下方空白处展开对应页面。

关键文件：

- `src/server/routes/bibliometrics.ts`
- `src/utils/bibliometrics.ts`
- `src/utils/bibliometrics-artifacts.ts`
- `src/public/index.html`

### Meta 分析与图像数字化复核

Meta 分析模块包含图像数字化复核、数据处理、R 图表和结果输出。

维护重点：

- 图像数字化复核中的“新建列”要服务于后续数据清洗和效应量计算。
- 数据处理后的“确定”功能必须明确保存最终数据，而不是只更新界面状态。
- GetData 相关功能可检测、导入、启动 `GetData.exe`。

关键文件：

- `src/server/routes/meta-analysis.ts`
- `src/server/routes/experiment-results.ts`
- `src/server/services/experiment-analyzer.ts`
- `src/server/local-server.ts` 中 GetData 和 Meta 相关路由
- `src/public/index.html`

### 数据统计分析与 R 作图

当前 R 作图流程必须包含“处理/分组颜色确认”。

规则：

- 作图前要让用户确认各处理或分组对应颜色。
- AI 可以推荐顶刊常用配色，例如 Okabe-Ito、NEJM/Lancet、Cell、高对比和低饱和综述图配色。
- 用户确认后的颜色配置必须传给后端。
- 后端生成 R 代码时必须使用命名颜色向量。
- 同一处理在不同图、不同 panel、`color` 和 `fill` 中颜色一致。
- 修复 R 代码时也必须保留颜色配置。

关键文件：

- `src/server/routes/r-code.ts`
- `src/server/routes/data-analysis.ts`
- `src/server/utils/experiment-figure-labels.ts`
- `src/public/index.html`

验证命令：

```bash
node scripts/check-public-js.js
npm run build
```

---

## 官网、下载和更新

官网位于 `scholarharness-website/`，静态导出后部署到服务器 Nginx 目录。

### 下载统计

下载统计在云端服务中维护。

关键文件：

- `cloud/server/routes/downloads.ts`
- `cloud/server/index.ts`
- `scholarharness-website/src/app/page.tsx`
- `scholarharness-website/public/downloads/latest.json`

规则：

- 官网按钮应通过统计接口记录下载次数，再跳转到安装包。
- 下载统计不应阻塞真实下载；统计失败时也要允许用户下载。
- 大安装包不建议长期直接放在低带宽 VPS 上，优先使用对象存储和 CDN。

### 更新提示

客户端更新提示依赖 `downloads/latest.json`。

上传新安装包后必须同步更新：

```json
{
  "version": "1.0.6",
  "downloadUrl": "https://scholarharness.com/downloads/scholar-harness-setup-1.0.6.exe",
  "publishedAt": "2026-07-08",
  "releaseNotes": "..."
}
```

维护规则：

- `version` 必须高于客户端当前版本。
- `downloadUrl` 必须能公网下载。
- `publishedAt` 使用实际发布日期。
- `releaseNotes` 写给用户看，不写内部实现细节。
- 官网、服务器 `/downloads`、云端下载统计资产列表要保持一致。

### 安装包体积和下载速度

当前 Windows 安装包约 466 MB。若直接从 VPS 下载，速度受 VPS 出网带宽限制。

建议：

- 对外下载使用 COS/OSS + CDN。
- 官网保留统计和跳转。
- VPS 只保留最新版本和必要回滚版本。
- 清理旧安装包，避免根分区满。

---

## 打包规则

### Windows

```bash
npm run electron:build
```

相关配置在根 `package.json` 的 `build` 字段。

重点：

- `electron/icon.ico` 是 Windows 应用和快捷方式图标来源。
- `nsis.installerIcon`、`uninstallerIcon`、`installerHeaderIcon` 都应指向同一 ico。
- `createDesktopShortcut` 和 `createStartMenuShortcut` 必须保留。
- 如果图标异常，检查 `dist/electron/icon.ico` 是否被复制进包。

### macOS

```bash
npm run electron:build:mac
```

重点：

- `scripts/prepare-mac-icon.js`
- `scripts/write-mac-electron-builder-config.js`
- `build/icon.icns`
- 输出包含 x64 和 arm64 dmg/zip。

### 打包前检查

```bash
npm run build
tsc -p electron/tsconfig.json
node scripts/build-copy.js
```

打包发布前至少确认：

- 桌面快捷方式图标正常。
- 开始菜单图标正常。
- 安装包能打开。
- 登录窗口输入框文字颜色正常。
- 主界面能启动本地服务。
- 下载更新提示不会指向旧版本。

---

## 代码风格

### TypeScript

- `strict: true`
- `target: ES2022`
- 主项目模块为 CommonJS。
- 避免新增 `any`，必要时优先用 `unknown` 和类型守卫。
- 不要硬编码 API Key、密钥、数据库密码、服务器私钥。

### 导入顺序

```ts
import * as fs from 'fs/promises';
import * as path from 'path';

import { z } from 'zod';

import { logger } from '../src/utils/logger';
import type { UserState } from '../src/types';
```

### 日志

```ts
import { logger } from '../src/utils/logger';

logger.debug('debug detail');
logger.info('normal progress');
logger.warn('recoverable warning');
logger.error('unexpected error', error);
```

优先使用 `logger`，不要在核心服务里新增裸 `console.log`。

### 错误处理

```ts
try {
  const content = await fs.readFile(filePath, 'utf-8');
  return content;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return null;
  }
  throw error;
}
```

API 错误响应应包含：

```ts
interface ErrorResponse {
  code: string;
  message: string;
  recoverable: boolean;
}
```

---

## 前端维护规则

当前主界面集中在 `src/public/index.html`，改动风险较高。

规则：

- 修改前先定位相关函数和 DOM id，不要大范围重排。
- 任何新增按钮、气泡、输入框都要检查移动端和窄屏。
- 输入框文字颜色必须可读，不能出现白字白底。
- 作图、PDF、Meta、计量等工作流按钮要有明确状态提示。
- 下载文件应直接出现在对应聊天气泡下方。
- 阅读原文界面功能采用气泡展开，不再做右侧边栏。

每次改 `src/public/index.html` 后运行：

```bash
node scripts/check-public-js.js
npm run build
```

---

## 云端认证和授权

云端模块负责：

- 邮箱验证码注册和登录
- 用户信息
- 激活码和内测码
- 订阅和支付
- 下载统计
- 管理后台
- Prompt/Skill 云端同步

关键目录：

```text
cloud/server/routes/
cloud/server/middleware/
cloud/auth/
cloud/database/
cloud/storage/
cloud/payment/
cloud/exe/
```

规则：

- 所有外部输入使用 Zod 或等效校验。
- 认证接口不要泄露用户是否存在的敏感细节。
- 验证码、授权码、订阅状态要有服务端校验，不能只靠前端隐藏。
- 云端路由变更后检查 `cloud/server/index.ts` 是否注册。

---

## 数据和文件安全

不要提交：

- `.env`
- API Key
- SSH 私钥
- 用户上传的 PDF、Word、Excel 原始数据
- 数据库导出
- 安装包大文件，除非用户明确要求
- `node_modules`
- `dist`、`dist-electron`、`.next` 等构建产物

`artifacts/` 用于临时生成材料，例如软著申请材料、扫描结果、部署包。默认不作为产品源码提交。

`artifacts/scratch/` 是 AI 会话临时目录，所有临时代码、裁剪图、日志、实验产物都放这里，任务结束后运行 `npm run clean:scratch` 自动清空。仓库根目录或任务目录不允许再出现 `tmp_fig5_diag/`、`measure_more_tmp.js` 这类散落临时文件。

---

## 测试策略

按改动范围选择测试：

### 通用

```bash
npm run build
npm test
```

### 前端主界面

```bash
node scripts/check-public-js.js
npm run build
```

### Agent 和写作流程

```bash
npx vitest run __tests__/agents
npx vitest run __tests__/workflows
```

### PDF Wiki

```bash
npx vitest run __tests__/utils/pdf-wiki-manager.test.ts
```

### Auto Research

```bash
npx vitest run __tests__/utils/autoresearch-manager.test.ts
```

### 文献解析和检索

```bash
npx vitest run __tests__/parsers
npx vitest run __tests__/utils/keyword-library.test.ts
```

### 云端

```bash
cd cloud
npm run build
npm test
```

### 官网

```bash
cd scholarharness-website
npm run build
```

---

## 部署注意事项

### 官网静态站点

当前 Nginx 站点根目录常用路径：

```text
/root/website/out
```

部署官网时确保：

- `out/` 同步完整。
- `/downloads/latest.json` 存在。
- `/downloads/*.exe` 或 CDN 跳转地址可用。
- Nginx `root` 指向正确目录。

### 安装包

如果安装包仍放在官网服务器：

```text
/root/website/out/downloads/
```

发布新版本必须同步：

- Windows exe
- Windows blockmap
- macOS dmg/zip，如本次需要
- `latest.json`
- 下载统计配置 `cloud/server/routes/downloads.ts`
- 官网按钮展示文案

### VPS 健康

部署前后检查：

```bash
df -h
free -h
systemctl status nginx
sudo nginx -t
```

若下载慢，不要优先改前端。先检查：

- 安装包大小
- VPS 出网带宽
- 是否走 CDN
- Nginx 是否支持 range
- 用户网络线路

---

## 知识产权材料

软著材料位于：

```text
artifacts/software-copyright/
```

当前软著申请名建议：

```text
Scholar Harness 论文写作助手软件 V1.0.6
```

提交前确认：

- 著作权人写个人还是单位。
- 开发方式是否为独立开发。
- 是否已经首次发表。
- 申请表、说明书、源程序材料的软件名称和版本号一致。

专利布局建议优先保护：

- PDF Wiki 句子级论点库与引用尾注映射。
- 多 Agent 协同论文写作与引用校验。
- 混合检索增强的学术证据生成与可信度验证。
- 图像数字化复核和 R 作图一致配色可作为后续改进点。

---

## 当前容易踩坑的点

1. `src/public/index.html` 很大，改动前先用 `rg` 定位函数，改动后必须跑 public JS 检查。
2. 输入框、注册页、登录页要检查文字颜色，避免白字白底。
3. 官网下载按钮不只是链接，还牵涉下载统计和更新清单。
4. 打包图标同时涉及 `electron/icon.ico`、`dist/electron/icon.ico` 和 electron-builder 配置。
5. 更新提示只看 `latest.json`，上传安装包后忘改这个文件，客户端不会提示更新。
6. PDF Wiki 引用不能靠 AI 猜，必须保留证据句和参考文献对应。
7. R 作图修复流程也要传处理组颜色配置，否则用户确认的配色会丢。
8. 旧安装包会迅速占满 VPS 磁盘，发布后要清理历史文件。
9. 云端新增路由后要确认 `cloud/server/index.ts` 注册。
10. 本地桌面端和官网注册页是两套前端，不要只改一边。

---

## 推荐工作流

1. 先用 `rg` 找到现有实现，读完周边代码再改。
2. 只改与任务直接相关的文件，不顺手重构无关模块。
3. 对已有用户改动保持尊重，不回滚不相关变更。
4. 修改前端后跑 `node scripts/check-public-js.js`。
5. 修改 TypeScript 后跑 `npm run build`。
6. 修改云端后跑 `cd cloud && npm run build`。
7. 修改官网后跑 `cd scholarharness-website && npm run build`。
8. 涉及打包、下载、更新时，同步检查安装包、图标、`latest.json`、官网链接和下载统计。

---

## Agent 复杂问题解决协议

任何多步骤复杂任务（诊断、作图、写作、代码修复）都先读 `skill-packs/agent-problem-solving/skills/problem-solving-protocol/SKILL.md` 并遵循其阶段协议：

1. **P0 任务契约**：动手前先写 3-6 行 brief（目标、输入、验收标准、约束、验证命令），验收标准不明先问清。
2. **P1 基准校准**：先建立坐标系和已知参考点再测量，禁止盲扫候选坐标。
3. **P2 工具化**：同类操作第 3 次必须工具化。图件/像素诊断复用 `skill-packs/agent-problem-solving/skills/diagnostic-runner/`（`scripts/pixel_scan.py`），禁止堆 `diag_v9b.py → diag_v9c.py` 版本号脚本，禁止超过 5 行的 `python -c "..."` 内联命令。所有临时代码、裁剪图、日志和实验产物一律放 `artifacts/scratch/`，禁止散落仓库根目录或任务目录。
4. **P3 结构化执行**：输出契约 `{status, summary, next_actions, artifacts}`，结论化输出，原始日志落盘不灌会话。
5. **P4 验证**：独立方法交叉验证，回查验收标准。
6. **P5 收敛**：fix forward 标准工具，删除实验产物，运行 `npm run clean:scratch` 清空 `artifacts/scratch/`。

任务契约模板见 `skill-packs/agent-problem-solving/templates/task-brief.md`。

---

## 联系

项目联系人：sjs@cau.edu.cn
