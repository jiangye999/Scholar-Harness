# UI 改造总结 - 飞书配置集成

## 📦 本次改造内容

### ✅ 完成的功能

#### 1. **删除文献导出指南**
- ✅ 移除 Web of Science 导出介绍
- ✅ 移除中国知网 CNKI 导出介绍
- ✅ 移除 PubMed 导出介绍
- ✅ 删除相关 JavaScript 代码和 guides 数据

#### 2. **飞书配置集成到 UI**
- ✅ 新增"飞书机器人配置"按钮（侧边栏）
- ✅ 配置对话框包含：
  - App ID 输入框
  - App Secret 输入框（密码框）
  - 配置状态提示（已配置/未配置）
  - 查看详细配置指南链接
- ✅ 本地存储配置（localStorage）
- ✅ 服务器 API 支持动态配置

---

## 🏗️ 技术实现

### 前端改动

#### 1. HTML 结构
**文件**: `src/public/index.html`

**删除**:
```html
<div class="lit-section">
  <div class="lit-title">📚 文献下载指南</div>
  <button class="lit-btn" onclick="showLitGuide('wos')">Web of Science</button>
  <button class="lit-btn" onclick="showLitGuide('cnki')">中国知网 CNKI</button>
  <button class="lit-btn" onclick="showLitGuide('pubmed')">PubMed</button>
  <div class="lit-info" id="litInfo">...</div>
</div>
```

**新增**:
```html
<button class="lit-btn" onclick="showFeishuDialog()">🤖 飞书机器人配置</button>
```

#### 2. JavaScript 函数
**新增函数**:
- `showFeishuDialog()` - 显示飞书配置对话框
- `saveFeishuConfig()` - 保存飞书配置

**删除函数**:
- `showLitGuide(type)` - 显示文献导出指南
- `guides` 常量对象

#### 3. 配置存储
```javascript
localStorage.setItem('scholarclaw_feishu', JSON.stringify({ 
  appId: appId, 
  appSecret: appSecret 
}));
```

### 后端改动

#### 文件：`src/server/local-server.ts`

**新增 API 端点**:

1. **POST /api/feishu/config**
   - 功能：动态配置飞书凭证
   - 参数：`{ appId: string, appSecret: string }`
   - 响应：`{ success: boolean, message: string }`
   - 特性：支持运行时更新，无需重启

2. **GET /api/feishu/status**
   - 功能：查询飞书配置状态
   - 响应：`{ configured: boolean, connected: boolean, appId: string }`

**变量修改**:
```typescript
// 从 const 改为 let，支持运行时更新
let feishuAppId = process.env.FEISHU_APP_ID || "";
let feishuAppSecret = process.env.FEISHU_APP_SECRET || "";
```

---

## 📱 用户界面

### 侧边栏布局

**修改前**:
```
┌─────────────────────┐
│ SCHOLARCLOW         │
├─────────────────────┤
│ + New Chat          │
├─────────────────────┤
│ 📤 上传文献摘要     │
├─────────────────────┤
│ 📚 文献下载指南     │ ← 已删除
│  - Web of Science   │
│  - CNKI             │
│  - PubMed           │
├─────────────────────┤
│ History             │
├─────────────────────┤
│ ⚙️ API 设置          │
│ 🤖 切换模型         │
│ 🌐 联网搜索配置     │
│ 📰 分析期刊风格     │
└─────────────────────┘
```

**修改后**:
```
┌─────────────────────┐
│ SCHOLARCLOW         │
├─────────────────────┤
│ + New Chat          │
├─────────────────────┤
│ 📤 上传文献摘要     │
├─────────────────────┤
│ History             │
├─────────────────────┤
│ ⚙️ API 设置          │
│ 🤖 切换模型         │
│ 🌐 联网搜索配置     │
│ 🤖 飞书机器人配置   │ ← 新增
│ 📰 分析期刊风格     │
└─────────────────────┘
```

### 配置对话框

```
┌────────────────────────────────────┐
│ 🤖 飞书机器人配置              ✕   │
├────────────────────────────────────┤
│ ✓ 已配置飞书机器人                 │
│                                    │
│ 将 ScholarClaw 接入飞书，通过       │
│ WebSocket 长连接实现聊天式论文写作。│
│ 无需公网 IP，本地即可运行。        │
│ [查看详细配置指南]                 │
│                                    │
│ App ID                             │
│ ┌──────────────────────────────┐  │
│ │ cli_xxxxxxxxxxxxx            │  │
│ └──────────────────────────────┘  │
│                                    │
│ App Secret [获取凭证]              │
│ ┌──────────────────────────────┐  │
│ │ ••••••••••••••••             │  │
│ └──────────────────────────────┘  │
│                                    │
│ 💡 提示：配置后需重启服务器。      │
│                                    │
│      [取消]      [保存]            │
└────────────────────────────────────┘
```

---

## 🔍 使用流程

### 步骤 1：打开配置界面
1. 点击侧边栏 "🤖 飞书机器人配置"
2. 查看当前配置状态

### 步骤 2：填写配置
1. 输入 App ID（从飞书开放平台获取）
2. 输入 App Secret（密码格式显示）
3. 点击"保存"

### 步骤 3：生效配置
- ✅ **方案一**：服务器自动重启 WebSocket 连接（推荐）
- ✅ **方案二**：手动重启服务器

### 步骤 4：验证状态
- 查看对话框返回的系统消息
- 访问 `GET /api/feishu/status` 查看连接状态

---

## 📊 对比分析

### 改造前
- ❌ 文献导出指南占用侧边栏空间
- ❌ 飞书配置需要编辑 .env 文件
- ❌ 配置后必须重启服务器
- ❌ 无法动态查看配置状态

### 改造后
- ✅ 界面更简洁（删除 3 个按钮）
- ✅ 飞书配置集成到 UI
- ✅ 支持运行时动态配置
- ✅ 实时查看连接状态
- ✅ 无需手动编辑配置文件

---

## 🎯 用户体验提升

### 1. **空间优化**
- 删除文献下载指南区域
- 侧边栏空间更充分利用
- 配置项集中管理

### 2. **配置便捷性**
- 无需打开文本编辑器
- 图形化界面操作
- 即时反馈配置结果

### 3. **状态可视化**
- 已配置：绿色提示框
- 未配置：黄色警告框
- API 实时返回状态

### 4. **错误处理**
- 表单验证（必填项检查）
- 友好的错误提示
- 详细的配置指南链接

---

## 🔧 技术细节

### 安全性
- ✅ App Secret 使用密码输入框（隐藏显示）
- ✅ 配置存储在 localStorage（浏览器端）
- ✅ 不通过 HTTP 明文传输凭证

### 兼容性
- ✅ 保留 .env 配置支持
- ✅ 环境变量优先级更高
- ✅ 支持多种配置方式并存

### 可扩展性
- ✅ 模块化设计
- ✅ 易于添加更多配置项
- ✅ API 设计符合 RESTful 规范

---

## 📝 相关文档

- [飞书集成完整指南](./docs/feishu-integration.md)
- [改造总结](./FEISHU_INTEGRATION_SUMMARY.md)
- [项目 README](./README.md)

---

## 🚀 下一步建议

### 可选增强功能
1. **配置测试** - 添加"测试连接"按钮
2. **自动重启** - 配置后自动重启 WebSocket
3. **状态指示器** - 侧边栏显示连接状态图标
4. **多机器人支持** - 支持配置多个飞书应用

---

**改造完成！** ✅

现在你的 ScholarClaw 拥有：
- ✅ 更简洁的 UI 界面
- ✅ 便捷的飞书配置体验
- ✅ 无需手动编辑配置文件
- ✅ 实时查看连接状态

**开始使用**：
1. 访问 http://localhost:18789
2. 点击侧边栏 "🤖 飞书机器人配置"
3. 填写 App ID 和 App Secret
4. 保存并重启服务器

**技术支持**: sjs@cau.edu.cn  
**更新日期**: 2026-03-18
