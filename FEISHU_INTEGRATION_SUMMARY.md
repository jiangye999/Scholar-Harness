# 飞书 WebSocket 长连接接入 - 改造总结

## 📦 本次改造内容

### 1. 新增文件

#### `src/messaging/feishu-websocket.ts`
飞书 WebSocket 长连接客户端封装
- 基于 `@larksuiteoapi/node-sdk` 实现
- 支持自动重连
- 事件订阅和消息处理
- 连接状态管理

#### `docs/feishu-integration.md`
飞书接入完整配置文档
- 飞书开放平台配置步骤
- ScholarClaw 配置指南
- 测试验证方法
- 常见问题解答

#### `.env.example`
环境变量配置模板
- 新增飞书配置项说明
- 包含所有必需和可选参数

### 2. 修改文件

#### `src/types/index.ts`
```typescript
export interface MessageHandler {
  send(userId: string, message: string): Promise<void>;
  sendImage?(userId: string, imageUrl: string, caption?: string): Promise<void>;
  handle?(userId: string, message: string): Promise<string | void>; // 新增
}
```

#### `src/messaging/feishu-handler.ts`
- 新增 `handle()` 方法：处理接收到的消息
- 集成 `ConversationFlow`：调用对话流程管理器
- 增加错误处理和日志记录

#### `src/server/local-server.ts`
- 导入飞书相关模块
- 新增 `startFeishuWebSocket()` 函数
- 服务器启动时初始化 WebSocket 客户端
- 新增优雅关闭处理（SIGINT/SIGTERM）

#### `README.md`
- 新增"飞书集成"功能说明
- 添加文档链接

### 3. 依赖安装

```bash
npm install @larksuiteoapi/node-sdk
```

---

## 🏗️ 架构设计

### 消息流程

```
飞书用户发送消息
    ↓
飞书开放平台（WebSocket 推送）
    ↓
FeishuWebSocketClient (wsClient.start)
    ↓
EventDispatcher.register('im.message.receive_v1')
    ↓
FeishuWebSocketClient.handleMessageEvent()
    ↓
FeishuHandler.handle()
    ↓
ConversationFlow.processMessage()
    ↓
FeishuHandler.send()
    ↓
飞书 API 发送回复
```

### 关键组件职责

| 组件 | 职责 |
|------|------|
| **FeishuWebSocketClient** | 管理 WebSocket 连接、事件订阅、自动重连 |
| **FeishuHandler** | 消息发送和处理的统一接口 |
| **ConversationFlow** | 对话流程管理（已有） |
| **EventDispatcher** | 飞书 SDK 提供的事件分发器 |

---

## ✅ 测试验证

### 构建测试
```bash
npm run build
```
✅ 编译成功，无 TypeScript 错误

### 文件验证
- ✅ `dist/src/messaging/feishu-websocket.js` - 已生成
- ✅ `dist/src/messaging/feishu-handler.js` - 已生成
- ✅ `dist/src/server/local-server.js` - 已生成

---

## 📝 使用指南

### 快速开始

1. **创建 .env 文件**
```env
FEISHU_APP_ID=cli_xxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

2. **启动服务**
```bash
npm start
```

3. **查看日志**
```
[Feishu] WebSocket client started successfully
```

### 飞书配置要点

1. **创建企业自建应用**（需要企业账号）
2. **开通机器人能力**
3. **事件订阅选择 WebSocket 模式**（关键！）
4. **订阅 `im.message.receive_v1` 事件**
5. **申请权限**：`im:message:read` 和 `im:message:send`

详细步骤见：[docs/feishu-integration.md](./docs/feishu-integration.md)

---

## 🔍 技术亮点

### 1. WebSocket 长连接优势
- ✅ 无需公网 IP
- ✅ 无需内网穿透
- ✅ 开发成本低（5 分钟 vs 1 周）
- ✅ 内置加密和鉴权

### 2. 自动重连机制
```typescript
private async handleReconnect(): Promise<void> {
  const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
  await new Promise(resolve => setTimeout(resolve, delay));
  await this.start();
}
```

### 3. 优雅关闭
```typescript
process.on('SIGINT', async () => {
  if (feishuWebSocketClient) {
    await feishuWebSocketClient.stop();
  }
  process.exit(0);
});
```

### 4. 类型安全
- ✅ 完整的 TypeScript 类型定义
- ✅ 接口约束和验证
- ✅ 编译时错误检查

---

## ⚠️ 注意事项

### 安全
- `.env` 文件已加入 `.gitignore`
- App Secret 只显示一次，需妥善保存
- 不要将凭证提交到 Git

### 限制
- 每个应用最多 50 个 WebSocket 连接
- 消息处理需在 3 秒内完成
- 仅支持企业自建应用

### 调试
```bash
# 开启详细日志
set DEBUG=1
npm start
```

---

## 📚 相关文档

- [飞书集成指南](./docs/feishu-integration.md) - 完整配置教程
- [飞书开放平台](https://open.feishu.cn/) - 官方文档
- [WebSocket 长连接文档](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN) - 技术说明
- [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk) - SDK 文档

---

## 🎯 下一步

### 可选增强功能
1. **发送富文本消息** - 使用 `FeishuHandler.sendRichText()`
2. **发送卡片消息** - 交互式 UI
3. **群聊支持** - 处理@机器人消息
4. **文件上传** - 支持在飞书中上传文献
5. **命令系统** - 如 `/help`, `/status`

### 性能优化
1. **连接池** - 支持多客户端
2. **消息队列** - 异步处理
3. **缓存机制** - 减少 API 调用

---

## 👥 技术支持

- 邮箱：sjs@cau.edu.cn
- 项目版本：v1.0.5 (Feishu Integration)
- 更新日期：2026-03-18

---

**改造完成！** ✅

现在你的 ScholarClaw 已经可以像 OpenClaw 一样通过 WebSocket 长连接接入飞书了！
