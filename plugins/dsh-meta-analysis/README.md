# dsh-meta-analysis

独立 Meta 分析插件：**完整复刻 Scholar Harness 桌面端 Meta 分析模块的流程与界面**，但数据完全存于 DSH 本地用户目录（`$DSH_HOME/meta-analysis/<userId>/`），与 Scholar Harness 服务**零网络/数据关联**。

## 功能（对照 Scholar Harness Meta 模块）

| Scholar Harness 模块 | 本插件对应 |
|---|---|
| Meta 数据库（PDF 来源列表） | 研究来源管理（添加/列表/删除） |
| Meta 分析编码表（列/行编辑） | 编码表编辑器（新增列/行、单元格编辑、保存） |
| 图像数字化复核（GetData 导入） | 数字化复核：粘贴 GetData/WebPlotDigitizer 导出的 CSV/TXT，导入目标列或追加新列 |
| Meta 分析向导（inspect → 配置 → 运行） | 预检（变量/候选结果/推荐配置）+ 效应量映射配置 + 运行 |
| 效应量（lnRR/MD/SMD/mean-only） | 同算法（含 mean-only 等权重聚类 bootstrap，9999 次） |
| 固定/随机效应、异质性 Q/I²/τ² | 同算法（DerSimonian–Laird） |
| 亚组分析（≥3 效应量且 ≥2 研究） | 同规则 |
| R/metafor 脚本生成 | 同生成逻辑（可直接在任何 R 环境执行） |
| 结果导出 | 效应量 CSV 下载、R 脚本/报告 Markdown 复制 |

## 安装（当前 DSH web profile）

```sh
# 先建立 @deepseek-ai junction（首次克隆后必须）
scripts\setup-junctions.cmd

# 安装到 profile（会把本包加入 dsh.profile.bundles）
dsh plugin --profile web add link:E:\AI_projects\scholar-harness-1.0.0\plugins\dsh-meta-analysis
```

重启 `dsh web`（`scripts\restart-dsh-web.bat`）后生效。侧边栏出现「Meta 分析」入口。

## 验证

```sh
npm run smoke     # 21 项冒烟：存储/效应量/汇总/亚组/inspect/run/R 脚本/CSV/报告/路由/工具/客户端契约
```

## Agent 工具

| 工具 | 说明 |
|---|---|
| `dsh_meta_health` | 数据目录、当前项目、来源/分析计数 |
| `dsh_meta_sources` | 研究来源列表（编码表行/列数） |
| `dsh_meta_inspect` | 预检：变量推断、候选结果、调节变量、推荐配置 |
| `dsh_meta_run` | 用显式 config 运行分析（效应量/汇总/亚组/R 脚本/报告） |
| `dsh_meta_analyses` | 历史分析列表 |

## GUI 路由（全部 loopback 信任栅栏）

`/api/dsh-meta/projects`、`/sources`、`/sources/detail`、`/sources/add`、`/sources/delete`、`/coding/columns/add`、`/coding/rows/add`、`/coding/save`、`/coding/delete`、`/digitization/import`、`/inspect`、`/run`、`/analyses`、`/analyses/detail`、`/analyses/delete`、`/status`。

## 配置

| 键 | 默认 | 说明 |
|---|---|---|
| `dataRoot` | `$DSH_HOME/meta-analysis` | 数据根目录；可用环境变量 `DSH_META_DATA_ROOT` 覆盖 |
| `userId` | `default` | 数据目录下的用户子目录 |
| `projectId` | 首个项目 | 当前项目（自动创建默认项目） |

## 数据与安全

- 数据只存在于 DSH 本地 JSON 文件，原子写入；**不调用 Scholar Harness、不上传任何数据**。
- 统计为本地计算；R/metafor 脚本与 CSV 生成后可在任何 R 环境运行。
- 统计口径与 Scholar Harness 一致：lnRR 要求均值 > 0；mean-only 不报告 Q/I²/τ²；亚组要求 ≥3 效应量且 ≥2 研究。
