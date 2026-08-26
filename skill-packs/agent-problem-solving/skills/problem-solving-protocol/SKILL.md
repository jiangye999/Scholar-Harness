---
name: problem-solving-protocol
description: Governing protocol for any complex multi-step task executed in a chat session via tools — diagnostics, R plotting, paper writing, code fixing. Use when a task will require more than a few tool calls, when the same kind of operation would otherwise be repeated, or when the session shows signs of throwaway script piles, log floods, or blind trial-and-error. Load this protocol before the first tool call of a complex task.
---

# 复杂问题解决协议

## Purpose

让 AI 聊天会话把复杂任务收敛到「一次性、可复用、结论化」的执行，而不是一次性脚本堆、日志洪流和试错循环。本协议面向所有复杂问题解决，不限于图像诊断。

## Non-negotiable Model

- 复杂任务必须按阶段顺序执行：任务契约 → 基准校准 → 工具化 → 结构化执行 → 验证 → 收敛。
- 同类操作出现第 3 次时，必须工具化，禁止继续内联复制。
- 禁止版本号脚本堆（`diag_v9b.py` → `diag_v9c.py`）。一个关注点只有一个标准脚本，改错就修它，不派生新文件。
- 禁止超过 5 行的 `python -c "..."` / `node -e "..."` 内联单行命令。
- 输出结论，不输出原始数据洪流。调试细节落盘，会话里只留摘要。
- 先校准再测量，禁止对未知坐标系盲扫 10 个候选。

## 阶段协议

### P0 任务契约（不写代码前先写 3-6 行 brief）

记录：

- 目标与输入（文件、路径、已知参数）；
- 期望输出与**验收标准**（如何判断"做完了"）；
- 约束与不触碰清单；
- 验证命令。

验收标准写不出来就先把任务问清楚，不要开始动手。

### P1 基准校准（Ground Truth）

在测量/猜测之前先建立基准：

- 识别领域对象、坐标系、已知不变点（例如面板角点、已知文件路径）；
- 用已知参考点校准坐标映射，再推导目标位置，而不是逐行试错；
- 把假设写进 brief，测量结果与假设冲突时优先修正假设。

### P2 工具化（Toolify）

- 动手写临时代码前，先查技能包是否已有可复用工具（如 `diagnostic-runner`）。
- 构建带参数的命名脚本：文件、区域、任务用命令行参数传入。
- 输出目录先 `os.makedirs(..., exist_ok=True)`，禁止首跑因缺目录崩溃。
- 新增通用能力时优先回到技能包工具里扩展，而不是在任务目录里新写。
- **所有临时代码、裁剪图、日志、实验产物一律放 `artifacts/scratch/`**，禁止散落在仓库根目录或任务目录。临时代码 = 测试脚本、诊断脚本、一次性数据整理脚本及其产物。

### P3 结构化执行

- 一次运行尽量完成一个关注点，输出结构化结论（JSON 报告 + 不超过 5 行人类可读摘要）。
- 每次运行输出契约：

  ```json
  { "status": "success|warning|error", "summary": "一行结论", "next_actions": ["..."], "artifacts": ["文件路径"] }
  ```

- 原始扫描/日志写文件，会话里只贴摘要与结论。

### P4 验证

- 用独立方法交叉验证关键结论（例如视觉复核 + 像素扫描，以像素为准）。
- 回查 P0 验收标准，逐项确认。
- 运行 P0 记录的验证命令。

### P5 收敛

- 修标准脚本（fix forward），不派生新版本文件。
- 删除实验性裁剪/临时产物，保留标准工具。
- 运行 `npm run clean:scratch` 清空 `artifacts/scratch/`，确保临时目录空。
- 给用户 2-3 行结论，附产物路径，说明遗留风险。

## 错误恢复契约

每个错误路径必须包含：

- **根因提示**：先找原因再动手，禁止只掩盖症状。
- **安全重试**：修好工具后按 P2→P3 重跑。
- **显式停止条件**：什么情况必须停下来问用户（例如需求漂移、验收标准不明、数据不可信）。

首跑崩溃（如缺目录、文件不存在）是工具自身的 bug，修工具，不是修这一次。

## 上下文预算

- 大段日志写文件，需要时按需读取，不整体灌入上下文。
- 会话里保留的是结论、文件路径、下一步行动。
- 在阶段边界做摘要切换，不在任务中途随意截断。

## 反模式清单

- [x] 版本号脚本堆（v9b → v9c）→ 一个关注点一个标准脚本。
- [x] 巨型内联 `python -c` / `node -e` → 命名参数化脚本。
- [x] 盲扫候选坐标 → 先校准再测量。
- [x] 日志洪流无结论 → 结论化输出，细节落盘。
- [x] 两种验证方法互相矛盾无裁决基准 → 以像素/数据 ground truth 为准，视觉只做抽样复核。
- [x] 只修症状不更新工具 → fix forward 标准工具。
- [x] 反复复制同一段检测逻辑 → 抽象进技能包工具。

## 度量

每完成一个复杂任务记录：工具调用轮数、重试次数、是否复用已有工具、会话总字符量。长期低于基准（例如同类诊断超过 8 轮工具调用）就说明动作空间或观测契约仍需收紧。
