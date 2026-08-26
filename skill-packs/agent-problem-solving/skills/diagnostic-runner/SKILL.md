---
name: diagnostic-runner
description: Reusable pixel-level diagnostic toolkit for image/figure issues — missing borders, overlapping labels, panel size mismatch, significance-letter collisions in R-rendered figures. Use when a user reports a problem in a rendered PNG/PDF figure and the fix depends on exact pixel positions, when panel coordinates must be mapped between a clean source panel and a final composite, or when a previous session started writing throwaway v9b/v9c-style scripts.
---

# 像素诊断工具

## Purpose

把「看图、猜坐标、写一次性脚本」的图件诊断改成「校准、跑标准工具、读结构化结论」。本技能配合 `problem-solving-protocol` 使用：先契约，再校准，再调用本工具。

## 工具

`scripts/pixel_scan.py`（依赖 Pillow，无其他库）。

| 子命令 | 作用 | 关键参数 |
|---|---|---|
| `hscan` | 沿某行扫暗像素段 | `--y --x0 --x1` |
| `vscan` | 沿某列扫暗像素段 | `--x --y0 --y1` |
| `border` | 找最长连续暗段（边框线） | `--axis h\|v --pos --lo --hi --min-run` |
| `crop` | 按 `L,T,R,B` 裁剪落盘 | `--box --out` |
| `panel` | 面板 clean 尺寸/缩放/左上角 → 最终图坐标映射 | `--width --height --scale --left --top` |

所有子命令输出一行 JSON 到 stdout；`--json 路径` 时把完整报告写文件。输出目录自动创建，不会首跑崩溃。

**临时产物约定**：裁剪图、扫描报告等一次性诊断产物一律写到 `artifacts/scratch/`（仓库根目录下），禁止散落在 `figure5/` 等任务目录或仓库根目录。任务结束后运行 `npm run clean:scratch` 一键清空。

## 诊断流程（先校准后测量）

1. **建立坐标基准**：用 `panel` 子命令把已知的 clean 面板角点/线（例如 clean 图右上角）映射到最终图，得到目标像素位置。禁止对未知坐标盲扫多个候选行。
2. **一个关注点一条命令**：检查边框缺失用 `border`；检查标签/字母重叠用 `hscan`/`vscan` 定位暗段边界再对比；检查尺寸一致性用 `panel` 对比两面板矩形。
3. **裁剪留证**：任何结论先 `crop` 落盘，便于视觉抽样复核。视觉复核只做抽样，结论以像素数据为准。
4. **输出契约**：每轮只贴结论（status + summary + next_actions + artifacts），原始扫描数据写文件。禁止把 `runs` 长列表整个贴进会话。

## 输出示例

```json
{
  "status": "success",
  "summary": "面板 a 右边框 x=2071：纵向 dark_px=0，边框缺失",
  "next_actions": ["检查该面板 R 绘制代码是否漏画右侧边框"],
  "artifacts": ["figure5/diag_crops/v9_a_topright.png", "figure5/diag_runs_a.json"]
}
```

## 扩展规则

- 新检测需求优先扩展 `pixel_scan.py` 的子命令或增加返回值字段，而不是在任务目录新建脚本。
- 一个关注点一个标准脚本。任务目录里不应出现 `diag_v9b.py`、`diag_v9c.py` 这类版本堆；对标准工具做增量修改（fix forward）。
- 脚本必须保持无状态：输入输出全部走参数，不硬编码文件路径。
- 一次性诊断脚本与其裁剪产物都放 `artifacts/scratch/`，任务结束清空，不留 `tmp_fig5_diag/` 这类散落目录。
