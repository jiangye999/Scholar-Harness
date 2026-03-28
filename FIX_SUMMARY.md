# 问题修复总结

## 🐛 发现的问题

### 问题 1: `saveWebSearchConfig` 函数丢失
**症状**: 联网搜索配置点保存没反应  
**原因**: 在之前编辑时误删除了 `window.saveWebSearchConfig` 函数定义  
**修复**:
- ✅ 重新添加 `window.saveWebSearchConfig` 函数
- ✅ 函数功能：保存 Tavily API Key 到 localStorage

### 问题 2: 飞书配置需要手动重启服务器
**症状**: UI 配置飞书后提示需要重启服务器  
**原因**: WebSocket 在服务器启动时初始化，配置更新后没有自动重启  
**修复**:
- ✅ 修改 `/api/feishu/config` API，自动重启 WebSocket 连接
- ✅ 停止旧连接 → 使用新配置启动新连接 → 返回连接状态
- ✅ 更新 UI 提示信息

### 问题 3: 浏览器缓存导致 UI 不更新
**症状**: 修改后浏览器仍然显示旧界面  
**原因**: 浏览器缓存了旧的 HTML 文件  
**解决方法**:
- 强制刷新浏览器：`Ctrl + Shift + R` (Windows) 或 `Cmd + Shift + R` (Mac)
- 或清除浏览器缓存后刷新

---

## ✅ 修复内容

### 前端修复 (`src/public/index.html`)

#### 1. 恢复 `saveWebSearchConfig` 函数
```javascript
window.saveWebSearchConfig = function() {
  var key = document.getElementById('webSearchKey').value.trim();
  
  localStorage.setItem(WEB_SEARCH_KEY, JSON.stringify({ 
    url: 'https://api.tavily.com/search', 
    key: key 
  }));
  closeModal();
  appendMessage('[系统] 联网搜索配置已保存。如果配置了有效的 API Key，我可以帮你搜索网上最新文献。', 'bot', false);
}
```

#### 2. 更新飞书配置提示
```javascript
// 修改前
'💡 提示：配置后需重启服务器才能生效。'

// 修改后
'💡 提示：配置后自动重启飞书连接，无需手动重启服务器。'
```

#### 3. 优化保存成功消息
```javascript
// 修改前
appendMessage('[系统] 飞书机器人配置已保存。' + (data.message || ''), 'bot', false);

// 修改后
const statusMsg = data.connected ? 
  '[系统] 飞书机器人配置已保存并自动启动！✓' : 
  '[系统] 配置已保存，但连接失败：' + (data.error || '请检查凭证');
appendMessage(statusMsg, 'bot', false);
```

### 后端修复 (`src/server/local-server.ts`)

#### 优化 `/api/feishu/config` API
```typescript
// 修改前：只保存配置，要求用户手动重启
feishuAppId = appId;
feishuAppSecret = appSecret;
res.json({ success: true, message: "配置已更新，请重启服务器" });

// 修改后：自动重启 WebSocket 连接
feishuAppId = appId;
feishuAppSecret = appSecret;

// 停止旧连接
if (feishuWebSocketClient) {
  await feishuWebSocketClient.stop();
}

// 启动新连接
const feishuHandler = new FeishuHandler({ appId, appSecret });
feishuWebSocketClient = new FeishuWebSocketClient({ appId, appSecret }, feishuHandler);
await feishuWebSocketClient.start();

res.json({ 
  success: true, 
  message: "配置已更新，飞书机器人已自动启动",
  connected: feishuWebSocketClient.isConnectionAlive()
});
```

---

## 🔍 文件验证

### 验证清单
- ✅ `saveWebSearchConfig` 函数存在于 `dist/src/public/index.html`
- ✅ `saveFeishuConfig` 函数存在于 `dist/src/public/index.html`
- ✅ "飞书机器人配置"按钮存在于侧边栏
- ✅ "文献下载指南"区域已从侧边栏移除
- ✅ Web of Science、CNKI、PubMed 导出说明已删除

### 验证命令
```bash
# 验证 saveWebSearchConfig 存在
grep "saveWebSearchConfig = function" dist/src/public/index.html

# 验证 saveFeishuConfig 存在
grep "saveFeishuConfig = function" dist/src/public/index.html

# 验证飞书按钮存在
grep "飞书机器人配置" dist/src/public/index.html

# 验证旧文献指南已删除
grep "文献下载指南" dist/src/public/index.html
# 应该返回空
```

---

## 🎯 架构说明

### 飞书如何与项目交互

```
┌─────────────────────────────────────────────────────────┐
│  用户界面 (UI)                                           │
│  ┌────────────────────────────────────────────────┐    │
│  │ 🤖 飞书机器人配置对话框                        │    │
│  │ - App ID 输入框                                │    │
│  │ - App Secret 输入框                            │    │
│  │ - 保存按钮 → POST /api/feishu/config          │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ HTTP 请求
                   ↓
┌─────────────────────────────────────────────────────────┐
│  服务器 (local-server.ts)                                │
│  ┌────────────────────────────────────────────────┐    │
│  │ POST /api/feishu/config                        │    │
│  │ 1. 更新内存变量 feishuAppId/feishuAppSecret   │    │
│  │ 2. 停止旧 WebSocket 连接                         │    │
│  │ 3. 使用新配置启动新 WebSocket 连接               │    │
│  │ 4. 返回连接状态                                 │    │
│  └────────────────────────────────────────────────┘    │
│                                                          │
│  ┌────────────────────────────────────────────────┐    │
│  │ GET /api/feishu/status                         │    │
│  │ - 返回当前配置状态                              │    │
│  │ - 返回连接状态                                  │    │
│  └────────────────────────────────────────────────┘    │
└──────────────────┬──────────────────────────────────────┘
                   │
                   │ WebSocket 长连接
                   ↓
┌─────────────────────────────────────────────────────────┐
│  飞书开放平台 (Feishu Open Platform)                     │
│  - im.message.receive_v1 事件推送                       │
│  - 机器人消息发送 API                                   │
└─────────────────────────────────────────────────────────┘
```

### 关键点

1. **UI 配置的 API 和飞书是独立的**
   - UI API 配置 (`/api/feishu/config`) → 飞书凭证
   - UI API 配置 (`/api/chat`, `/api/models`) → AI 模型 API
   - 两者使用不同的配置，互不影响

2. **飞书使用自己的凭证**
   - 不使用 UI 中配置的 AI API (API_URL/API_KEY)
   - 使用飞书开放平台的 App ID 和 App Secret

3. **自动重启机制**
   - 配置保存后自动停止旧连接
   - 使用新配置启动新连接
   - 无需手动重启服务器

---

## 🚀 测试步骤

### 测试 1: 联网搜索配置
1. 访问 http://localhost:18789
2. 点击 "🌐 联网搜索配置"
3. 输入 Tavily API Key
4. 点击"保存"
5. ✅ 应该看到消息："联网搜索配置已保存"

### 测试 2: 飞书配置
1. 点击 "🤖 飞书机器人配置"
2. 输入飞书 App ID 和 App Secret
3. 点击"保存"
4. ✅ 应该看到消息："飞书机器人配置已保存并自动启动！✓"
5. 检查服务器日志：`[Feishu] WebSocket client restarted with new config`

### 测试 3: 验证界面
1. 检查侧边栏是否有 "🤖 飞书机器人配置" 按钮
2. 确认侧边栏没有 "📚 文献下载指南" 区域
3. 确认没有 Web of Science、CNKI、PubMed 按钮

---

## 📝 注意事项

### 清除浏览器缓存
如果修改后界面没有更新，请：
1. **强制刷新**: `Ctrl + Shift + R` (Windows) 或 `Cmd + Shift + R` (Mac)
2. **清除缓存**: 浏览器设置 → 清除浏览数据 → 缓存的图像和文件
3. **无痕模式**: 打开无痕窗口测试

### 飞书配置失败排查
如果飞书配置后显示连接失败：
1. 检查 App ID 和 App Secret 是否正确
2. 查看服务器日志中的详细错误信息
3. 确认网络可以访问飞书开放平台
4. 确认已在飞书后台开通事件订阅

---

## 📊 修复对比

| 功能 | 修复前 | 修复后 |
|------|--------|--------|
| 联网搜索保存 | ❌ 无响应 | ✅ 正常保存 |
| 飞书配置 | ❌ 需手动重启 | ✅ 自动重启 |
| 飞书状态提示 | ⚠️ 模糊提示 | ✅ 明确显示连接状态 |
| 文献导出指南 | ✅ 存在 | ✅ 已删除 |
| 飞书配置按钮 | ❌ 不存在 | ✅ 已添加 |

---

**修复完成！** ✅

现在所有功能都应该正常工作了。如果还有问题，请：
1. 强制刷新浏览器清除缓存
2. 检查服务器日志查看错误信息
3. 查看本文档的排查指南

**技术支持**: sjs@cau.edu.cn  
**更新日期**: 2026-03-18
