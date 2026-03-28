# ScholarClaw 飞书机器人接入指南

本文档指导你将 ScholarClaw 接入飞书，实现通过飞书聊天进行论文写作。

---

## 📋 目录

1. [快速开始](#-快速开始)
2. [飞书开放平台配置](#-飞书开放平台配置)
3. [ScholarClaw 配置](#-scholarclaw-配置)
4. [测试与验证](#-测试与验证)
5. [常见问题](#-常见问题)

---

## 🚀 快速开始

### 接入方式对比

| 方式 | 优点 | 缺点 | 推荐场景 |
|------|------|------|---------|
| **WebSocket 长连接** | ✅ 无需公网 IP<br>✅ 无需内网穿透<br>✅ 开发简单 | ❌ 单集群最多 50 连接 | 本地开发、内网部署 |
| Webhook | ✅ 适合大规模部署<br>✅ 官方推荐 | ❌ 需要公网 IP<br>❌ 需要 HTTPS | 云服务部署 |

**本指南使用 WebSocket 长连接方式**（推荐）

### 前置条件

- ✅ 飞书企业账号（个人版无法创建自定义应用）
- ✅ 飞书开发者后台权限
- ✅ Node.js 22+
- ✅ ScholarClaw 项目

---

## 🔧 飞书开放平台配置

### 步骤 1：创建企业自建应用

1. 访问 [飞书开放平台](https://open.feishu.cn/)
2. 点击 **企业自建** → **+ 创建应用**
3. 填写应用信息：
   - **应用名称**：ScholarClaw 机器人
   - **应用图标**：上传一个图标（可选）
4. 点击 **创建**

### 步骤 2：获取应用凭证

1. 在应用管理页面，点击 **凭证与基础信息**
2. 记录以下信息：
   - **App ID**：`cli_a1b2c3d4e5f6`
   - **App Secret**：`xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

> ⚠️ **重要**：App Secret 只显示一次，请立即复制保存！

### 步骤 3：开通机器人能力

1. 在左侧菜单点击 **机器人** → **开发配置**
2. 点击 **开通机器人**
3. 配置机器人信息：
   - **机器人名称**：ScholarClaw
   - **机器人描述**：学术论文写作助手
   - **头像**：上传一个头像

### 步骤 4：配置事件订阅（WebSocket 模式）

1. 在左侧菜单点击 **事件订阅** → **开通事件订阅**
2. 选择 **使用长连接接收事件**（WebSocket 模式）
3. **无需填写请求 URL**（这是与 Webhook 模式的关键区别）

### 步骤 5：订阅消息事件

1. 在事件订阅页面，搜索并添加以下事件：
   - ✅ **接收消息 v1.0** (`im.message.receive_v1`)
   
2. 配置事件权限：
   - 选择 **机器人发送和接收单聊、群聊消息**
   - 点击 **申请权限**

### 步骤 6：配置机器人权限

1. 在左侧菜单点击 **权限管理**
2. 搜索并添加以下权限：
   - ✅ `im:message:read` - 读取消息
   - ✅ `im:message:send` - 发送消息

3. 点击 **申请权限**（需要管理员审批）

### 步骤 7：发布应用

1. 在应用版本页面，点击 **创建版本**
2. 填写版本信息：
   - **版本号**：1.0.0
   - **更新说明**：初始版本
3. 点击 **提交审核** 或 **直接发布**（测试企业可免审）

---

## 💻 ScholarClaw 配置

### 步骤 1：创建 .env 文件

在项目根目录创建 `.env` 文件：

```bash
# .env
API_URL=https://modelgate.cn/v1
API_KEY=your_api_key_here
PRIMARY_MODEL=qwen3.5-plus

# 飞书配置
FEISHU_APP_ID=cli_a1b2c3d4e5f6
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
PORT=18789
```

> ⚠️ **安全提醒**：
> - `.env` 文件已添加到 `.gitignore`，不会被提交到 Git
> - 不要将 `.env` 文件分享给他人
> - 生产环境使用环境变量注入

### 步骤 2：启动服务

```bash
# 方式一：使用启动脚本（推荐）
start.bat

# 方式二：手动启动
npm run build
npm start
```

### 步骤 3：验证飞书连接

启动后查看日志：

```
[Feishu] WebSocket not enabled (missing FEISHU_APP_ID or FEISHU_APP_SECRET)
# 或
[Feishu] WebSocket client started successfully
```

如果看到 `started successfully`，说明连接成功！

---

## ✅ 测试与验证

### 测试 1：私聊测试

1. 在飞书中找到你的机器人（ScholarClaw）
2. 发送消息：`你好`
3. 机器人应回复问候语

### 测试 2：写作测试

发送消息：`帮我写引言`

机器人应进入写作流程。

### 测试 3：日志检查

查看服务器日志，应该看到：

```
[FeishuWS] Processing message from ou_xxxxxxxx: 你好...
[FeishuWS] Message processed for ou_xxxxxxxx
```

---

## ❓ 常见问题

### Q1: 应用创建失败？

**A**: 确保使用**企业账号**登录，个人版无法创建自定义应用。

### Q2: WebSocket 连接失败？

**A**: 检查以下几点：
1. 确认 `FEISHU_APP_ID` 和 `FEISHU_APP_SECRET` 正确
2. 检查网络是否能访问公网
3. 查看日志中的错误信息
4. 确认事件订阅已开通并配置了 WebSocket 模式

### Q3: 机器人收不到消息？

**A**: 可能原因：
1. 事件订阅未开通
2. 未订阅 `im.message.receive_v1` 事件
3. 权限未审批通过
4. 机器人未添加到聊天（群聊需要@机器人）

### Q4: 机器人无法发送消息？

**A**: 检查权限：
1. `im:message:send` 权限是否已开通
2. 机器人是否已被添加到目标聊天
3. 查看 API 返回错误日志

### Q5: 部署到云服务器？

**A**: 如果使用云服务器（有公网 IP），可以使用 Webhook 模式：
1. 在飞书后台配置 **请求 URL** 为 `https://your-domain.com/api/feishu/webhook`
2. 在服务器添加 webhook 路由
3. 但 WebSocket 模式仍然可用，更简单

### Q6: 日志级别如何调整？

**A**: 设置环境变量：
```bash
# Windows
set DEBUG=1

# Linux/Mac
export DEBUG=1
```

---

## 📚 进阶配置

### 自定义机器人人格

修改 `workflows/conversation-flow.ts` 中的 `handleGreeting` 方法。

### 添加更多事件

在 `feishu-websocket.ts` 中添加：

```typescript
eventDispatcher.register({
  'im.message.receive_v1': async (data: any) => {
    // 接收消息
  },
  'im.chat.update_v1': async (data: any) => {
    // 群聊更新
  },
});
```

### 发送富文本消息

使用 `FeishuHandler.sendRichText()` 方法。

---

## 🔗 相关资源

- [飞书开放平台文档](https://open.feishu.cn/document/)
- [飞书 WebSocket 长连接文档](https://open.feishu.cn/document/ukTMukTMukTM/uYDNxYjL2QTM24iN0EjN/event-subscription-configure-/request-url-configuration-case)
- [ScholarClaw 项目文档](./README.md)
- [@larksuiteoapi/node-sdk](https://www.npmjs.com/package/@larksuiteoapi/node-sdk)

---

**技术支持**: sjs@cau.edu.cn  
**更新日期**: 2026-03-18
