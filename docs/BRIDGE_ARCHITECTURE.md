# Scholar Harness 桥接架构详解

## 🏗️ 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户界面 (Web UI)                          │
│                    src/public/index.html                         │
└────────────────────┬────────────────────────────────────────────┘
                     │ HTTP API
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Express 服务器                                │
│                 src/server/local-server.ts                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  路由层 (Routes)                                          │  │
│  │  ├── /api/chat          → unified-chat.ts                │  │
│  │  ├── /api/niceaigc      → niceaigc.ts                    │  │
│  │  ├── /api/memory        → memory.ts                      │  │
│  │  └── /api/literature    → literature.ts                  │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    桥接层 (Bridge Layer)                         │
│                   src/bridge/                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  AI Provider Factory                                      │  │
│  │  ai-provider-factory.ts                                   │  │
│  │  ├── 统一的 AI 提供者接口                                 │  │
│  │  ├── 管理 OpenAI / NiceAIGC / Auto 模式                  │  │
│  │  └── 单例模式管理 Adapter                                 │  │
│  └───────────┬──────────────────────────────────┬───────────┘  │
│              │                                  │               │
│  ┌───────────▼──────────────┐    ┌──────────────▼───────────┐  │
│  │  NiceAIGC Bridge         │    │  OpenAI Bridge           │  │
│  │  niceaigc-bridge.ts      │    │  (未来扩展)              │  │
│  │  ├── 配置管理            │    │                          │  │
│  │  ├── 消息格式转换        │    │                          │  │
│  │  ├── Service 模式        │    │                          │  │
│  │  └── Browser 模式        │    │                          │  │
│  └───────────┬──────────────┘    └──────────────────────────┘  │
└──────────────┼──────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     浏览器自动化层                                │
│                        openclaw/                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  OpenClaw - Playwright 自动化                               │ │
│  │  index.js                                                   │ │
│  │  ├── 命令行模式 (CLI)                                       │ │
│  │  │   ├── browser --action open                             │ │
│  │  │   ├── browser --action chat                             │ │
│  │  │   └── browser --action snapshot                         │ │
│  │  └── HTTP 服务模式 (Service)                               │ │
│  │      ├── POST /chat                                        │ │
│  │      ├── POST /navigate                                    │ │
│  │      └── GET /health                                       │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                    外部服务 (NiceAIGC)                           │
│                https://niceaigc.com/chat                         │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  NiceAIGC 聊天界面                                          │ │
│  │  ├── 输入框: div[contenteditable="true"]                   │ │
│  │  ├── 发送: Enter 键                                        │ │
│  │  └── 响应: .message-content                                │ │
│  └────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

## 📁 目录结构

```
scholar-harness-1.0.0/
├── src/
│   ├── bridge/                          # 桥接层
│   │   ├── ai-provider-factory.ts       # AI 提供者工厂
│   │   └── chat-bridge/                 # 现有聊天桥接实现
│   │       ├── niceaigc-bridge.ts       # 主要桥接实现
│   │       ├── config.json              # 配置文件
│   │       ├── server.js                # 独立服务
│   │       ├── bridge.js                # Node.js ES Module 版本
│   │       ├── bridge.py                # Python 版本
│   │       └── browser_mode.py          # Python 浏览器模式
│   │
│   ├── server/                          # 服务器
│   │   ├── local-server.ts              # 主服务器
│   │   └── routes/                      # 路由
│   │       ├── niceaigc.ts              # NiceAIGC 路由
│   │       ├── unified-chat.ts          # 统一聊天路由
│   │       ├── memory.ts                # 记忆管理
│   │       └── literature.ts            # 文献管理
│   │
│   └── public/                          # 前端
│       └── index.html                   # Web UI
│
├── openclaw/                            # 浏览器自动化工具
│   ├── index.js                         # 主要实现
│   ├── index-manual.js                  # 手动模式
│   ├── open-niceaigc-simple.bat         # 简单启动脚本
│   ├── config.json                      # 配置
│   └── node_modules/                    # 依赖
│       ├── playwright/                  # 浏览器自动化
│       └── commander/                   # CLI 框架
│
└── niceaigc-bridge/                     # 备用桥接方案
    ├── bridge.js                        # ES Module 版本
    ├── bridge.py                        # Python 版本
    ├── browser_mode.py                  # 浏览器模式
    └── api_mode.py                      # API 模式
```

## 🔄 数据流

### 1. 用户发起聊天请求

```
用户输入
  ↓
前端 (index.html)
  ↓ POST /api/niceaigc/chat
Express 路由 (niceaigc.ts)
  ↓ 调用 niceAIGCAdapter.chat()
NiceAIGC Bridge Adapter
  ↓ 判断 service.enabled
  ├─ true  → sendViaService() → HTTP POST localhost:19222/chat
  └─ false → sendViaBrowser() → spawn node index.js browser --action chat
OpenClaw (index.js)
  ↓ 启动 Playwright 浏览器
访问 https://niceaigc.com/chat
  ↓ 自动输入消息
  ↓ 等待响应
提取响应内容
  ↓ 返回给 Bridge
返回给前端
  ↓ 显示给用户
```

### 2. Service 模式（推荐）

```typescript
// 配置
{
  "service": {
    "enabled": true,
    "port": 19222
  }
}

// 数据流
用户 → 前端 → 路由 → Bridge → HTTP POST localhost:19222/chat
                                        ↓
                            OpenClaw Service (常驻进程)
                                        ↓
                            Playwright 浏览器 (保持打开)
                                        ↓
                            NiceAIGC 页面
```

**优点**：
- 浏览器保持打开，无需每次启动
- 响应更快
- 可以保存登录状态

### 3. Browser 模式（单次）

```typescript
// 配置
{
  "service": {
    "enabled": false
  }
}

// 数据流
用户 → 前端 → 路由 → Bridge → spawn('node', ['index.js'])
                                        ↓
                            每次启动新的浏览器进程
                                        ↓
                            执行完成后关闭
```

**缺点**：
- 每次启动慢
- 需要重新登录

## 🔧 核心组件详解

### 1. NiceAIGC / OpenClaw 集成

> 注意：本文档中的早期 `src/bridge/niceaigc/niceaigc-bridge.ts` 设计已不再与当前仓库结构一致。
> 当前仓库以 `openclaw/index.js` 和 `niceaigc-bridge/bridge.js` 为主要可见实现。

**职责**：
- 管理配置
- 提供统一的 chat 接口
- 处理消息格式转换
- 管理 Service 和 Browser 两种模式

**关键方法**：

```typescript
class NiceAIGCBridgeAdapter {
  // 加载配置
  async loadConfig(): Promise<NiceAIGCConfig>
  
  // 主要聊天接口
  async chat(options: ChatOptions): Promise<string>
  
  // Service 模式
  private async sendViaService(message, onProgress, newPage): Promise<string>
  
  // Browser 模式
  private async sendViaBrowser(message, onProgress, newPage): Promise<string>
  
  // 执行 openclaw 命令
  private async runCommand(command, timeout, onChunk): Promise<{stdout, stderr}>
}
```

### 2. AIProviderFactory

**文件**: `src/bridge/ai-provider-factory.ts`

**职责**：
- 统一管理多个 AI 提供者
- 单例模式
- 支持自动切换

```typescript
class AIProviderFactory {
  // 初始化
  static initialize(config: AIProviderConfig): void
  
  // 统一聊天接口
  static async chat(options: ChatOptions): Promise<string>
  
  // 获取 NiceAIGC Adapter
  static getNiceAIGCAdapter(): NiceAIGCBridgeAdapter | null
}
```

### 3. OpenClaw

**文件**: `openclaw/index.js`

**职责**：
- Playwright 浏览器自动化
- 提供命令行和 HTTP 服务两种模式
- 管理 Chrome/Edge/Chromium 浏览器

**关键功能**：

```javascript
// 命令行模式
node index.js browser --action open --url "https://..."
node index.js browser --action chat --text "消息" --wait 30000

// Service 模式
node index.js serve --port 19222
// POST /chat
// GET /health
```

## 🎯 配置文件

### src/bridge/niceaigc/config.json

```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://niceaigc.com/chat"
  },
  "browser": {
    "profile": "chrome",
    "timeout_ms": 300000,
    "wait_for_response_ms": 240000
  },
  "service": {
    "enabled": true,
    "port": 19222
  }
}
```

## 🚀 使用示例

### 1. 在路由中使用

```typescript
import { NiceAIGCBridgeAdapter } from '../../bridge/niceaigc/niceaigc-bridge';

const adapter = new NiceAIGCBridgeAdapter();
await adapter.loadConfig();

const response = await adapter.chat({
  messages: [{ role: 'user', content: '你好' }],
  onProgress: (chunk) => console.log(chunk),
  newPage: false
});
```

### 2. 通过 AIProviderFactory

```typescript
import { AIProviderFactory } from '../../bridge/ai-provider-factory';

AIProviderFactory.initialize({
  provider: 'niceaigc',
  niceaigc: {
    enabled: true
  }
});

const response = await AIProviderFactory.chat({
  messages: [{ role: 'user', content: '你好' }]
});
```

### 3. 直接调用 OpenClaw

```bash
# 命令行
cd openclaw
node index.js browser --action chat --text "你好" --wait 30000

# Service 模式
node index.js serve
curl -X POST http://localhost:19222/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "你好", "wait": 30000}'
```

## ⚠️ 打包注意事项

### 1. 路径处理

**开发环境**：
```typescript
// openclaw 在项目根目录
const openclawPath = path.join(process.cwd(), 'openclaw');
```

**打包环境**：
```typescript
// openclaw 在 resources 目录
const openclawPath = process.env.OPENCLAW_DIR 
  || path.join(process.resourcesPath, 'openclaw');
```

### 2. Electron 配置

`electron/main.ts`:
```typescript
serverProcess = spawn(process.execPath, [serverPath], {
  env: {
    ...process.env,
    OPENCLAW_DIR: app.isPackaged 
      ? path.join(process.resourcesPath, 'openclaw') 
      : path.join(process.cwd(), 'openclaw'),
  },
});
```

### 3. package.json 打包配置

```json
{
  "extraResources": [
    { "from": "openclaw", "to": "openclaw" },
    { "from": "openclaw/node_modules", "to": "openclaw/node_modules" }
  ]
}
```

## 🐛 已知问题

### 1. NiceAIGC 反自动化检测

**问题**：Playwright 启动的浏览器会被 NiceAIGC 检测并拦截

**表现**：页面空白或崩溃

**解决方案**：
- 使用手动模式：`openclaw/open-niceaigc-simple.bat`
- 或使用其他 AI 服务（OpenAI, Claude 等）

### 2. Service 模式需要手动启动

**问题**：应用启动时不会自动启动 Service

**解决方案**：
- 用户需要手动运行：`node index.js serve`
- 或修改 Electron main.ts 自动启动 Service

## 📝 最佳实践

### 1. 推荐使用 Service 模式

```typescript
// 配置
{
  "service": {
    "enabled": true,
    "port": 19222
  }
}

// 启动
cd openclaw
node index.js serve

// 然后启动应用
npm start
```

### 2. 配置 OpenAI 作为备选

```typescript
AIProviderFactory.initialize({
  provider: 'auto',  // 自动选择
  niceaigc: { enabled: true },
  openai: { 
    apiKey: 'your-key', 
    baseUrl: 'https://api.openai.com/v1' 
  }
});
```

### 3. 持久化登录状态

NiceAIGC 的登录状态保存在：
```
openclaw/browser-state.json
```

打包后：
```
%APPDATA%\scholar-harness\browser-state.json
```

## 🔮 未来改进

1. **集成 Playwright Stealth**
   - 绕过反自动化检测
   - 提高成功率

2. **自动启动 Service**
   - Electron 启动时自动启动 Service
   - 无需用户手动操作

3. **更好的错误处理**
   - 检测页面崩溃自动重试
   - 提供更友好的错误提示

4. **支持更多 AI 提供者**
   - Claude API
   - 通义千问 API
   - DeepSeek API