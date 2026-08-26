---
name: dsh-meta-analysis
description: Run the complete Meta analysis workflow inside DSH with local data (independent from the Scholar Harness desktop service). Manage research sources and coding tables, import GetData/WebPlotDigitizer digitization data, inspect variables and candidate outcomes, configure effect-size mappings (lnRR/MD/SMD/mean-only), run fixed/random-effect analyses with heterogeneity and subgroups, and export effect-size CSV, R/metafor script, and a Markdown report. Use whenever the user asks to conduct, inspect, continue, or export a Meta analysis in DSH.
---

# dsh-meta-analysis 工作流（独立本地数据）

DSH 本地 Meta 分析插件，数据存于 `$DSH_HOME/meta-analysis/`，**与 Scholar Harness 桌面服务零关联**。

## 流程

1. 调用 `dsh_meta_health`。若数据目录可用，报告当前项目与来源计数。
2. 需要来源/编码表概览时调用 `dsh_meta_sources`。
3. 若无来源或编码表为空，告诉用户在 GUI「Meta 分析 → 研究来源」添加来源并填写编码表；编码表列名建议使用可识别后缀（如 `biomass_tmean/biomass_tsd/biomass_tn/biomass_ckmean/biomass_cksd/biomass_ckn`，或中文「处理组均值/处理组SD/处理组n/对照组均值/对照组SD/对照组n」），以便自动识别。
4. 编码表就绪后调用 `dsh_meta_inspect`，阅读候选结果、变量与推荐配置。
5. 向用户确认效应量映射（每个结果的 measure、处理组/对照组列、direction）与模型（fixed/random/mixed、REML）。
6. 确认后调用 `dsh_meta_run` 并传入 config。审查返回的 summaries、subgroups、quality、rCode、markdown。
7. 需要时用 `dsh_meta_analyses` 回溯历史结果；导出请引导用户在 GUI「结果」页下载 CSV / 复制 R 脚本与报告。
8. 论文写作前调用 `dsh_meta_writing_context`（analysisId 必填），把返回的 contextMarkdown/summaries/subgroups 作为写作上下文；GUI「结果」页可下载完整写作上下文 JSON。

## 统计约束（与 Scholar Harness 一致）

- 绝不编造缺失的 SD、SE、n、研究数、p 值、I²、τ² 或显著性。
- lnRR/MD/SMD 需要映射的统计字段完整；仅均值分析（lnRR_mean_only/MD_mean_only）只在用户接受等权重聚类 bootstrap 解释时使用。
- lnRR 要求处理组与对照组均值均为正。
- 同一研究的多个效应量应按真实研究 ID 聚类；不要把它们当作独立 bootstrap 单元。
- mean-only 分析不报告 Q、I²、τ²、Egger、漏斗或 Baujat 结果。
- 亚组分析要求每组 ≥3 个效应量且 ≥2 个研究，否则视为证据不足。
- 统计显著性不等于证据确定性；缺少风险偏倚或 GRADE 字段时如实说明。
- 生成 R/metafor 脚本与 CSV 后，R 执行需在用户自己的 R 环境中完成。

## 结果汇报

分开陈述：① 编码表内容；② 被排除/跳过的行及原因；③ 拟合模型的估计；④ 异质性与亚组/调节分析支持什么；⑤ 仍有不确定或对建模选择敏感的部分。写论文章节时只使用 `dsh_meta_run` 返回值与已生成产物，绝不描述未生成的结果。
