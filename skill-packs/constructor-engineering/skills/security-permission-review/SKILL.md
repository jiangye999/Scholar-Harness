---
name: security-permission-review
description: 在安装和启用前审查构造功能包的权限、路径、网络和敏感边界。任何生成或导入的功能包都必须使用。
---

# 功能包安全与权限审查

逐项拒绝：

- 绝对路径、`..`、符号链接逃逸或读取父目录。
- 任意 shell、PowerShell、cmd、进程注入或安装目录改写。
- 认证、支付、订阅、更新器、Electron 主进程和云端管理权限。
- 明文 API Key、密码、Cookie、Token 或将秘密写入日志。
- 未声明的网络访问或非 HTTPS 目标。
- 页面绕过 sandbox 直接操控宿主 DOM。

权限说明必须面向用户，列出用途和关闭后的影响。发现高风险项时保持停用并给出替代设计。
