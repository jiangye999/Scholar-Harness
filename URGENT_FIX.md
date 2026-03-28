# 🚨 紧急修复：飞书 WebSocket SDK 导入问题

## 问题原因

TypeScript 编译后，飞书 SDK 的导入方式不正确：
- **错误**: `new node_sdk_1.default.WSClient()` 
- **正确**: `new node_sdk_1.WSClient()`

飞书 SDK (`@larksuiteoapi/node-sdk`) 是直接导出，不是通过 `default` 导出。

---

## ✅ 完整修复步骤

### 步骤 1: 停止所有 Node 进程

**Windows**:
1. 按 `Ctrl + Shift + Esc` 打开任务管理器
2. 找到所有 `node.exe` 进程
3. 右键 → 结束任务

**或者命令行**:
```bash
taskkill /F /IM node.exe
```

**如果无法杀掉进程**:
1. 重启电脑
2. 或者换一个端口（修改 `.env` 中的 `PORT`）

---

### 步骤 2: 清理并重新编译

```bash
# 删除所有编译文件
rm -rf dist

# 重新编译
npm run build

# 复制 public 文件
cp -r src/public dist/src/public
```

---

### 步骤 3: 修复导入路径

编辑 `dist/src/server/local-server.js`，找到这两行：
```javascript
const feishu_handler_1 = require("./messaging/feishu-handler");
const feishu_websocket_1 = require("./messaging/feishu-websocket");
```

修改为：
```javascript
const feishu_handler_1 = require("../messaging/feishu-handler");
const feishu_websocket_1 = require("../messaging/feishu-websocket");
```

**或者使用 sed 命令**:
```bash
sed -i 's|require("./messaging/|require("../messaging/|g' dist/src/server/local-server.js
```

---

### 步骤 4: 启动服务器

```bash
npm start
```

**期望看到的日志**:
```
ScholarClaw running at http://localhost:18789 (Model: qwen3.5-plus)
[Feishu] WebSocket not enabled (missing FEISHU_APP_ID or FEISHU_APP_SECRET)
```

---

### 步骤 5: 测试飞书配置

1. **浏览器访问**: http://localhost:18789

2. **打开开发者工具** (F12) → Network 标签

3. **点击** "🤖 飞书机器人配置"

4. **填写测试值**:
   - App ID: `cli_test123`
   - App Secret: `test_secret_123`

5. **点击保存**

6. **查看 Network**:
   - 应该有 `POST /api/feishu/config`
   - Status: `200 OK`
   - Response: `{success: true, ...}`

7. **查看服务器控制台**:
```
[Feishu] Stopped old WebSocket client (如果有旧连接)
[Feishu] WebSocket client restarted with new config
[Feishu] WebSocket client started successfully
```

---

## 🔧 如果还有问题

### 问题 1: 仍然是 `Cannot read properties of undefined`

**原因**: 服务器还在运行旧代码

**解决**:
1. 必须完全停止服务器
2. 删除 `dist` 目录
3. 重新编译
4. 重新启动

### 问题 2: 端口被占用

**解决 1 - 换端口**:
编辑 `.env`:
```env
PORT=18790
```

**解决 2 - 找到并杀掉进程**:
```bash
# 查找占用端口的进程
netstat -ano | findstr "18789"

# 假设 PID 是 12345
taskkill /F /PID 12345
```

### 问题 3: 找不到模块

**错误**: `Cannot find module '../messaging/...'`

**原因**: 路径不对

**解决**:
```bash
# 检查文件是否存在
ls dist/src/messaging/*.js

# 如果不存在，复制并编译
cp -r src/messaging dist/src/messaging
npx tsc dist/src/messaging/*.ts --outDir dist/src/messaging --module CommonJS --target ES2022
```

---

## 🎯 最终测试脚本

运行诊断脚本：
```bash
node diagnose-feishu.js
```

**期望输出**:
```
=== 飞书配置诊断 ===

1. 测试 GET /api/feishu/status
GET /api/feishu/status → 200
{
  "configured": false,
  "connected": false,
  "appId": ""
}

2. 测试 POST /api/feishu/config
POST /api/feishu/config → 200
{
  "success": true,
  "message": "配置已更新，飞书机器人已自动启动",
  "connected": false
}

3. 再次检查状态
GET /api/feishu/status → 200
{
  "configured": true,
  "connected": false,
  "appId": "cli_test..."
}

=== 诊断完成 ===
```

---

## 📝 代码修复（永久方案）

如果要永久修复，需要修改源文件 `src/messaging/feishu-websocket.ts`:

**修改前**:
```typescript
import Lark, { WSClient, EventDispatcher } from '@larksuiteoapi/node-sdk';

this.wsClient = new Lark.WSClient({...});
```

**修改后**:
```typescript
// 使用 require 避免 TypeScript 编译问题
const Lark = require('@larksuiteoapi/node-sdk');
const WSClient = Lark.WSClient;
const EventDispatcher = Lark.EventDispatcher;

import type { WSClient as WSClientType } from '@larksuiteoapi/node-sdk';

export class FeishuWebSocketClient {
  private wsClient: WSClientType;
  
  constructor(...) {
    this.wsClient = new WSClient({...});
  }
}
```

然后重新编译：
```bash
npm run build
```

---

**技术支持**: sjs@cau.edu.cn  
**更新日期**: 2026-03-18
