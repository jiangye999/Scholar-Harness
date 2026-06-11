# 消息发送流程调试指南

## 问题：第二次消息仍然发送完整提示词

### 完整调试流程

请按以下步骤收集日志：

#### 1. 重启服务器
```bash
npm run build
npm start
```

#### 2. 打开浏览器开发者工具
- 按 F12 打开开发者工具
- 切换到 Console 标签

#### 3. 第一次发送消息
在对话框输入：`你好`

**预期看到的日志**：
```
[Debug] isFirstMessage calculation: {savedMsgsLength: 0, isFirstMessage: true}
[Debug] Context to send: {
  isFirstMessage: true,
  skipFullPrompt: false,
  finalIsFirstMessage: true,
  contextIsFirstMessage: true
}
[Debug] prepareNiceAIGCContext: isFirstMessage=true, message="你好..."
```

**后端日志应该显示**：
```
[NiceAIGC Route] context.isFirstMessage: true
[Debug] Context received: {isFirstMessage: true, isFirstMessageType: 'boolean', isFirstMessageValue: 'true'}
[Debug] isFirstMessage calculation: context.isFirstMessage=true, result=true
[Debug] buildEnrichedMessage: FIRST message, message="你好..."
[Debug] FINAL enrichedMessage (XXXX chars):
```

#### 4. 第二次发送消息
在对话框输入：`测试`

**预期看到的日志**：
```
[Debug] isFirstMessage calculation: {savedMsgsLength: 2, isFirstMessage: false}
[Debug] Context to send: {
  isFirstMessage: false,
  skipFullPrompt: false,
  finalIsFirstMessage: false,
  contextIsFirstMessage: false
}
[Debug] prepareNiceAIGCContext: isFirstMessage=false, message="测试..."
```

**后端日志应该显示**：
```
[NiceAIGC Route] context.isFirstMessage: false
[Debug] Context received: {isFirstMessage: false, isFirstMessageType: 'boolean', isFirstMessageValue: 'false'}
[Debug] isFirstMessage calculation: context.isFirstMessage=false, result=false
[Debug] buildEnrichedMessage: NOT first message, message="测试..."
[Debug] buildEnrichedMessage: shortPrompt length=XXX, preview="..."
```

### 如果第二次消息仍然显示 `isFirstMessage=true`

可能的原因：

#### 原因 1: localStorage 被清除
检查浏览器 Console：
```javascript
localStorage.getItem('scholarclaw_messages_web-user_conv-XXXXX')
```
如果返回 `null`，说明 localStorage 被清除了。

#### 原因 2: conversationId 改变
检查是否每次都生成了新的 conversationId：
```javascript
// 在 Console 中查看
console.log('Current conversationId:', currentConversationId);
```

#### 原因 3: savedMsgs 计算错误
在 `index.html:2318` 处添加断点或日志：
```javascript
console.log('[CRITICAL] savedMsgs from localStorage:', savedMsgs);
console.log('[CRITICAL] savedMsgs.length:', savedMsgs.length);
console.log('[CRITICAL] isFirstMessage will be:', savedMsgs.length === 0);
```

### 调试命令

在浏览器 Console 中执行：

```javascript
// 查看当前对话历史
var storageKey = 'scholarclaw_messages_web-user_' + currentConversationId;
var msgs = localStorage.getItem(storageKey);
console.log('Storage key:', storageKey);
console.log('Saved messages:', msgs ? JSON.parse(msgs) : []);

// 查看所有对话
for (var i = 0; i < localStorage.length; i++) {
  var key = localStorage.key(i);
  if (key && key.includes('scholarclaw_messages')) {
    console.log('Found:', key, '→', localStorage.getItem(key)?.substring(0, 100));
  }
}
```

### 临时修复方案

如果问题持续，可以在前端强制检查：

在 `index.html` 的 `sendMessage` 函数中找到：
```javascript
var isFirstMessage = savedMsgs.length === 0;
```

改为：
```javascript
// 强制检查：如果有历史消息，就不是第一次
var isFirstMessage = savedMsgs.length === 0 && !localStorage.getItem(storageKey);
console.log('[FORCE CHECK] savedMsgs.length=' + savedMsgs.length + ', localStorage has key=' + !!localStorage.getItem(storageKey) + ', isFirstMessage=' + isFirstMessage);
```

### 报告问题时请提供

1. **完整的浏览器 Console 日志**（从第一次到第二次消息）
2. **完整的后端日志**（从第一次到第二次消息）
3. **localStorage 检查结果**：
   ```javascript
   localStorage.getItem('scholarclaw_messages_web-user_' + currentConversationId)
   ```