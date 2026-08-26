# 编程 Agent Runtime 容器

Scholar Harness 通过统一的 `CodingAgentProtocolAdapter` 契约接入 Codex、Pi 和 OpenCode。三种运行时共享前端选择、配置持久化、工作区策略、事件流、工具网关、取消和错误降级；各自的原生协议只存在于适配器内部。

## 架构

```text
主页输入框 / 配置中心
  -> /api/chat-bridge/chat + /agent-runtimes/*
  -> ChatBridgeAdapter（选择运行时、准备安全工作副本、验证产物）
  -> CodingAgentRuntimeRegistry
       -> CodexAppServerRuntimeAdapter（app-server JSON-RPC + MCP）
       -> PiRpcRuntimeAdapter（持久 JSONL RPC + Extension）
       -> OpenCodeJsonRuntimeAdapter（run --format json + MCP）
  -> AgentToolGateway（localhost + Bearer Token + 会话隔离）
  -> Scholar Harness 原生工具
```

## 能力矩阵

| 能力 | Codex | Pi | OpenCode |
| --- | --- | --- | --- |
| 持久会话 | app-server thread | RPC 进程和 session-dir | session ID 映射 |
| 流式输出 | app-server 事件 | JSONL RPC 事件 | `--format json` 事件 |
| Scholar 工具 | MCP stdio | 动态 Extension | 本地 MCP |
| steer / follow-up | 支持 | 支持 | CLI 适配暂不支持 |
| 取消 | thread interrupt | RPC abort，超时后终止进程 | 终止当前 run 进程 |
| 模型发现 | Scholar 模型清单 | `pi --list-models` | `opencode models` |

## 配置

Codex、Pi 和 OpenCode 统一保存在 `agent_runtimes` 中。`agent_runtimes.default` 可取空字符串、`codex`、`pi` 或 `opencode`。旧版顶层 `codex` 字段仍由服务端双向镜像，保证已有模型、PDF Wiki 并发和 App Server 设置不会在升级后丢失。显式从输入框的“编程 Agent”容器选择运行时会覆盖默认值。

```json
{
  "agent_runtimes": {
    "default": "pi",
    "codex": {
      "enabled": true,
      "command": "codex",
      "model": "gpt-5.5",
      "reasoning_effort": "xhigh",
      "sandbox": "workspace-write",
      "timeout_ms": 300000,
      "fallback_to_secondary": true
    },
    "pi": {
      "enabled": true,
      "command": "pi",
      "model": "openai/gpt-5.5",
      "reasoning_effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000,
      "fallback_to_secondary": true
    },
    "opencode": {
      "enabled": true,
      "command": "opencode",
      "model": "openai/gpt-5.5",
      "reasoning_effort": "high",
      "sandbox": "workspace-write",
      "timeout_ms": 1800000,
      "auto_approve": true,
      "fallback_to_secondary": true
    }
  }
}
```

CLI 路径可以留空，服务会安全探测可执行文件。配置内容不会拼成 Shell 命令，进程统一以参数数组和 `shell: false` 启动。

## 工作区和权限

- `workspace-write`：先复制到 Scholar Harness 会话级安全工作区，运行时只在副本中写入；完成后由现有产物验证和镜像逻辑处理真实文件。
- `read-only`：不创建可写副本。Pi 只启用读取类内置工具；OpenCode 显式禁止 `edit`、`bash`、`task` 和 `external_directory`。
- `danger-full-access`：仅在用户明确选择后传给运行时；仍保留工具网关的 Token 和会话隔离。
- MCP/Extension 工具只通过 `127.0.0.1` 临时网关调用。每个会话使用独立 Bearer Token，工具执行保留 receipt，最终文件仍需通过 Scholar Harness 的真实产物校验。

## 错误与降级

运行时不可用、模型无效或协议异常时会返回带运行时名称的错误。如果请求依赖 Scholar Harness 原生工具、用户禁用降级，或 `fallback_to_secondary=false`，错误直接返回；否则可以降级到小牛马 API。取消和中断不参与降级，防止用户停止后任务被另一模型继续执行。

## 扩展新的运行时

新增适配器时实现 `status`、`listModels`、`runTurn`、`interrupt`，声明能力矩阵并注册到 `CodingAgentRuntimeRegistry`。不要在前端保存任意命令模板，也不要绕过 `AgentToolGateway` 和安全工作区。

## 验证

```bash
npx vitest run __tests__/bridge/agent-runtime-adapters.test.ts __tests__/bridge/coding-agent-runtime-contract.test.ts
node scripts/check-public-js.js
npm run build
```
