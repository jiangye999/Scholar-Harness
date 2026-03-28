# 跨会话记忆系统说明

## 📋 架构设计

### 用户维度（跨会话共享）

```
data/memory/
└── web-user/
    └── memory.json          ← 所有会话共享的长期记忆
```

**存储内容**：
- ✅ 8 个长期记忆类型
  - research_topic
  - target_journal
  - writing_task
  - key_concepts
  - important_findings
  - experimental_design
  - data_status
  - user_preferences

---

### 会话维度（独立存储）

```
data/memory/web-user/
└── conversations/
    ├── conv-1773127xxx.json  ← 会话 1 的对话记录
    ├── conv-1773128yyy.json  ← 会话 2 的对话记录
    └── conv-1773129zzz.json  ← 会话 3 的对话记录
```

**存储内容**：
- 对话标题
- 对话摘要
- 关键主题
- 消息数量

---

### 本地存储（浏览器）

```javascript
localStorage:
├── scholarclaw_userid          → 'web-user'（固定）
├── scholarclaw_conv_web-user   → 'conv-xxx'（当前会话）
├── scholarclaw_msgs_web-user_conv-xxx  → 会话 xxx 的消息
├── scholarclaw_msgs_web-user_conv-yyy  → 会话 yyy 的消息
└── scholarclaw_lit_web-user    → 文献库（跨会话共享）
```

---

## 🔄 工作流程

### 1. 新建会话（点击 New Chat）

```javascript
// 保持 userId 不变
currentUserId = 'web-user';  ← 不变

// 创建新的 conversationId
currentConversationId = 'conv-' + Date.now();  ← 新建

// 清空界面
messagesDiv.innerHTML = '';

// 保留文献库（跨会话共享）
uploadedFiles 保持不变;
```

**效果**：
- ✅ 新的对话界面
- ✅ 共享文献库
- ✅ 共享长期记忆
- ✅ 独立的消息历史

---

### 2. 切换会话（点击历史对话）

```javascript
function loadConversation(convId) {
  currentConversationId = convId;  ← 切换
  currentUserId = 'web-user';      ← 不变
  
  // 加载该会话的消息
  var msgs = localStorage.getItem(
    'scholarclaw_msgs_web-user_' + convId
  );
  
  // 保留文献库
  uploadedFiles 保持不变;
}
```

**效果**：
- ✅ 加载历史消息
- ✅ 文献库不变
- ✅ 长期记忆共享

---

### 3. 发送消息

```javascript
async function sendMessage() {
  // 存储到当前会话
  var storageKey = MSG_KEY + currentUserId + '_' + currentConversationId;
  
  localStorage.setItem(
    storageKey,
    JSON.stringify(messages)
  );
  
  // 长期记忆在对话结束后由后端 AI 自动更新
}
```

---

## 📊 数据流

```
用户操作
   ↓
[New Chat]
   ↓
创建 conv-xxx
   ↓
发送消息 → 保存到 localStorage
              ↓
         msgs_web-user_conv-xxx
              ↓
         对话结束
              ↓
         后端 AI 提取记忆
              ↓
         更新 memory.json (跨会话)
              ↓
         更新 conv-xxx.json (会话维度)
```

---

## 🎯 跨会话共享的内容

| 类型 | 存储位置 | 是否跨会话 |
|------|---------|-----------|
| **长期记忆** | `data/memory/web-user/memory.json` | ✅ 是 |
| **文献库** | `data/uploads/web-user/literature.txt` | ✅ 是 |
| **期刊风格** | `data/uploads/web-user/journal-styles/` | ✅ 是 |
| **API 配置** | `localStorage.scholarclaw_api_*` | ✅ 是 |
| **对话消息** | `localStorage.scholarclaw_msgs_*` | ❌ 否（每个会话独立） |
| **历史对话列表** | `localStorage.scholarclaw_history` | ✅ 是（记录所有会话） |

---

## ✅ 使用示例

### 场景 1：长期记忆跨会话

```
会话 1 (conv-xxx):
用户：我想写关于 N2O 排放的论文
AI：好的，已记录您的研究主题

[点击 New Chat]

会话 2 (conv-yyy):
用户：还记得我的研究主题吗？
AI：记得！您的研究主题是"N2O 排放" ✅
```

---

### 场景 2：文献库跨会话

```
会话 1 (conv-xxx):
[上传 5 篇文献]
AI：已加载 1325 篇文献

[点击 New Chat]

会话 2 (conv-yyy):
📚 已加载文献库：
• 文献数量：1325 篇 ✅
• 年份范围：1987-2026
```

---

### 场景 3：期刊风格跨会话

```
会话 1 (conv-xxx):
[上传 Global Change Biology 范文 5 篇]
AI：已分析期刊风格

[点击 New Chat]

会话 2 (conv-yyy):
[开始写作]
AI：将根据 Global Change Biology 的风格为您写作 ✅
```

---

## 🔧 技术实现

### 关键代码

**固定 userId**：
```javascript
// initApp()
if (!currentUserId || currentUserId.indexOf('chat-') === 0) {
  currentUserId = 'web-user';  // 固定用户 ID
}
```

**会话隔离**：
```javascript
// 使用 userId + conversationId 组合存储
var storageKey = MSG_KEY + currentUserId + '_' + currentConversationId;
localStorage.setItem(storageKey, JSON.stringify(messages));
```

**跨会话共享**：
```javascript
// newChat() 不清空 uploadedFiles
// 文献库保持
uploadedFiles 保持不变;

// 只创建新的 conversationId
currentConversationId = 'conv-' + Date.now();
```

---

## 📝 迁移旧数据

如果之前使用了 `chat-xxx` 格式的用户 ID：

```bash
# 移动记忆文件
mv data/memory/chat-*/memory.json data/memory/web-user/

# 移动文献库
mv data/uploads/chat-*/literature.txt data/uploads/web-user/

# 移动期刊风格
mv data/uploads/chat-*/journal-styles/ data/uploads/web-user/
```

---

## ✅ 验证方法

### 1. 检查长期记忆

```javascript
// 浏览器控制台
fetch('/api/memory/web-user')
  .then(r => r.json())
  .then(console.log);
```

应该显示 8 个记忆类型的数据。

---

### 2. 检查文献库

```javascript
// 浏览器控制台
fetch('/api/literature/web-user')
  .then(r => r.json())
  .then(console.log);
```

应该显示文献统计信息。

---

### 3. 测试跨会话

1. 会话 1：上传文献，聊天
2. 点击 New Chat
3. 会话 2：查看文献库和长期记忆
4. 应该都能看到会话 1 的内容 ✅

---

**完成时间**: 2026-03-10  
**版本**: v1.0.14 Cross-Session Memory
