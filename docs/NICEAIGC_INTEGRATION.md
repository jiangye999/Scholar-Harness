# NiceAIGC 集成指南

## 概述

ScholarClaw 现已支持通过 NiceAIGC Bridge 接入 NiceAIGC 会员 AI，实现：
- 浏览器自动化操作 NiceAIGC 网页
- 双向通信：本地项目 ↔ NiceAIGC
- 作为可选 AI Provider 集成

**重要说明**：本集成使用**浏览器自动化模式**，不需要 API Key，直接通过控制 Chrome 浏览器操作网页。

## 工作原理对比

| 模式 | 需要 API Key | 工作原理 | 速度 | 稳定性 |
|------|-------------|---------|------|--------|
| **浏览器模式** | ❌ 不需要 | 自动化操作 Chrome 网页 | 较慢（需等待页面加载） | 依赖网页结构 |
| API 模式 | ✅ 需要 | 直接调用 HTTP API | 快 | 稳定 |

**本项目当前使用浏览器模式**，因为 NiceAIGC 未提供公开 API。

## 系统架构

```
用户输入 → ScholarClaw → NiceAIGC Bridge → OpenClaw → Playwright → Chrome → NiceAIGC 网页
     ↑                                                                            ↓
     └────────────────────────────────  AI 响应返回  ←─────────────────────────────┘
```

## 前置要求

### 必需组件

1. **Chrome 浏览器** ✅
   - 必须安装 Google Chrome
   - 在 Chrome 中登录 NiceAIGC 账号（仅需一次）

2. **OpenClaw** ✅
   - 已部署到 `E:\AI_projects\openclaw`
   - 需要添加到系统 PATH

3. **Node.js 依赖** ✅
   - Playwright（浏览器自动化库）
   - 已随 OpenClaw 一起安装

### 不需要的组件

- ❌ **API Key** - 浏览器模式不需要
- ❌ **NiceAIGC 账号密码** - 只需在 Chrome 中登录一次
- ❌ **额外配置** - 除 PATH 外无需其他配置

## 文件结构

```
E:\AI_projects\
├── scholar-claw-feishu-1.0.0.5\    # ScholarClaw 项目
│   ├── src\bridge\niceaigc\
│   │   ├── niceaigc-bridge.ts       # TypeScript 适配器
│   │   └── config.json               # 配置文件
│   └── ...
├── openclaw\                         # 浏览器自动化工具
│   ├── index.js
│   ├── openclaw.bat
│   └── setup-path.bat
└── ...
```

## 配置步骤

### 步骤 1: 配置 config.json

已自动配置为你的 URL：

```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://node8.nice188.com/"
  },
  "browser": {
    "profile": "chrome",
    "timeout_ms": 30000,
    "wait_for_response_ms": 8000
  }
}
```

### 步骤 2: 配置 OpenClaw PATH

**方法 A：自动配置（推荐）**

双击运行：
```
E:\AI_projects\openclaw\setup-path.bat
```

**方法 B：手动配置**

1. 右键"此电脑" → 属性 → 高级系统设置
2. 环境变量 → 用户变量 → PATH → 编辑
3. 新建 → 添加 `E:\AI_projects\openclaw`
4. 确定保存

### 步骤 3: 验证 OpenClaw

关闭所有命令提示符，重新打开：

```bash
# 验证版本
openclaw --version

# 测试浏览器（会打开 Chrome）
openclaw browser --action open --url "https://node8.nice188.com/"
```

### 步骤 4: 启动 ScholarClaw

```bash
cd E:\AI_projects\scholar-claw-feishu-1.0.0.5
pnpm build
pnpm start
```

### 步骤 5: UI 配置

1. 浏览器访问 `http://localhost:18789`
2. 点击左侧 "🔄 NiceAIGC 配置"
3. URL 已预设为 `https://node8.nice188.com/`
4. 勾选"启用 NiceAIGC Bridge"
5. 点击"测试连接"
6. 成功后点击"保存"

## 使用方式

### HTTP API

```bash
# 发送消息
curl http://localhost:18789/api/niceaigc/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "请帮我润色这段论文..."}'
```

### TypeScript 代码

```typescript
import { NiceAIGCBridgeAdapter } from './src/bridge/niceaigc/niceaigc-bridge';

const bridge = new NiceAIGCBridgeAdapter();
const response = await bridge.chat({
  messages: [{ role: 'user', content: '你好' }]
});
```

## 工作流程详解

### 1. 初始化阶段

```
ScholarClaw 启动
    ↓
加载 config.json
    ↓
启动 OpenClaw 服务
    ↓
等待用户请求
```

### 2. 请求处理阶段

```
用户发送消息
    ↓
ScholarClaw 接收请求
    ↓
调用 NiceAIGCBridgeAdapter
    ↓
执行: openclaw browser --action open --url "https://node8.nice188.com/"
    ↓
Playwright 启动 Chrome
    ↓
Chrome 打开 NiceAIGC 页面
    ↓
识别输入框和发送按钮
    ↓
填充用户消息
    ↓
点击发送按钮
    ↓
等待 AI 响应（8秒）
    ↓
提取响应文本
    ↓
返回给 ScholarClaw
    ↓
显示在 UI 上
```

### 3. 浏览器保持登录

- Chrome 会保持登录状态（通过 Playwright 的 storage state）
- 不需要每次都重新登录
- 如果 Cookie 过期，需要手动在 Chrome 中重新登录一次

## 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|---------|---------|
| openclaw 命令找不到 | PATH 未生效 | 重启命令提示符或重新登录 Windows |
| Chrome 未启动 | Chrome 未安装 | 安装 Google Chrome |
| 页面无法访问 | URL 错误 | 检查 config.json 中的 URL |
| 无法输入文本 | 元素选择器错误 | 更新 niceaigc-bridge.ts 中的选择器 |
| 无响应提取 | 等待时间太短 | 增加 wait_for_response_ms 到 10000-15000 |
| 需要重新登录 | Cookie 过期 | 在 Chrome 中手动登录一次 |

## 注意事项

1. **Chrome 必须保持可用** - 浏览器模式依赖 Chrome
2. **首次登录** - 第一次需要在 Chrome 中手动登录 NiceAIGC
3. **响应延迟** - 浏览器模式比 API 慢，需要等待页面加载和 AI 生成
4. **资源占用** - 会启动 Chrome 浏览器进程，占用内存
5. **并发限制** - 不建议同时发送多个请求，串行处理更稳定
6. **无 API 成本** - 浏览器模式不产生 API 调用费用

## 常见问题

### Q: 为什么不用 API 模式？
**A**: NiceAIGC 未提供公开 API，只能通过网页访问。

### Q: 需要 NiceAIGC 账号密码吗？
**A**: 不需要。只需在 Chrome 中登录一次，之后保持登录状态。

### Q: 支持多用户吗？
**A**: 当前配置是全局的，所有请求使用同一个 Chrome 会话。

### Q: 可以关闭 Chrome 窗口吗？
**A**: 可以。下次请求会自动重新打开。

### Q: 为什么需要 OpenClaw？
**A**: OpenClaw 封装了 Playwright，提供统一的命令行接口供 ScholarClaw 调用。

## 技术栈

- **Playwright** - 浏览器自动化库
- **Chromium** - Playwright 内置的浏览器（或系统 Chrome）
- **Node.js** - 运行环境
- **Express** - HTTP 服务
- **TypeScript** - 开发语言
