---
name: feature-package-build
description: 按 Scholar Harness Feature Package v1 构建可预览、可启用、可回滚的运行时扩展。构造 Agent 或 Reasonix 编写功能时使用。
---

# 运行时功能包构建

必须在构造 Agent 提供的暂存目录工作。

1. 保留 `feature.json` 的 `schemaVersion: 1` 和 `apiVersion: 1`。
2. 页面入口放在 `frontend/`；所有路径必须相对包根目录，禁止 `..` 和绝对路径。
3. 只声明实际使用的权限：`ui:page`、`ui:navigation`、`chat:command`、`feature:storage`、`network:https`。
4. 页面运行于无同源权限的 sandbox iframe，不假设可以直接访问宿主 DOM。
5. 持久数据只能写入功能包私有存储；不得写核心配置或其他功能包。
6. 在 `IMPLEMENTATION.md` 写明实现、测试、已知限制和回滚说明。

禁止添加任意 shell、Electron 主进程、认证、支付、更新器或核心文件覆盖能力。
