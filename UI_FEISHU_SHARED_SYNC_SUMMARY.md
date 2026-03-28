# UI 和飞书端口信息共用实现总结

## 概述

已成功将 1.0.0.6 版本的 UI 和飞书端口信息共用功能同步到 1.0.0.5 项目。

## 核心改进

### 1. 统一用户 ID 系统

**关键代码** (`src/server/local-server.ts`):
```typescript
async function processChatMessage(userId: string, userMessage: string): Promise<string> {
  // 统一用户 ID：所有用户（飞书 + Web UI）共用同一个 "web-user" ID
  // 这样飞书和 Web UI 用户可以共享记忆、文献库、写作进度等所有数据
  const unifiedUserId = "web-user";
  
  // ... 所有数据操作都使用 unifiedUserId
  const userMemory = loadUserMemory(unifiedUserId);
  const userDir = path.join(uploadDir, unifiedUserId);
}
```

**效果**:
- ✅ 飞书用户和 Web UI 用户使用同一个用户 ID (`"web-user"`)
- ✅ 共享记忆数据（研究主题、实验总结、数据总结等）
- ✅ 共享文献库（上传的文献对两个端口都可见）
- ✅ 共享写作进度（引言、方法、结果等章节草稿）
- ✅ 共享会话历史

### 2. 全局共享组件

**全局检索引擎单例**:
```typescript
const globalRetrievalEngine = new HybridRetrievalEngine({}, { 
  url: currentApiUrl, 
  key: currentApiKey 
});

// 设置文献路由使用全局检索引擎
setRetrievalEngine(globalRetrievalEngine);
```

**全局消息处理器**:
```typescript
const globalMessageHandler = {
  async send(userId: string, message: string): Promise<void> {
    // Web UI 的 send 实现（通过 HTTP 响应）
    logger.info(`[GlobalHandler] Message to ${userId}: ${message.substring(0, 50)}...`);
  },
  async handle(userId: string, message: string): Promise<string> {
    return await processChatMessage(userId, message);
  },
};
```

**全局会话流管理**:
```typescript
const globalConversationFlow = new ConversationFlow(
  globalMessageHandler,
  sessionStore,
  { 
    apiUrl: currentApiUrl, 
    apiKey: currentApiKey,
    embeddingModel: process.env.EMBEDDING_MODEL || 'text-embedding-3-small',
    maxConcurrency: 5 
  },
  globalRetrievalEngine  // 传入共享的检索引擎实例
);
```

### 3. 飞书 WebSocket 集成

```typescript
async function startFeishuWebSocket() {
  const feishuHandler = new FeishuHandler({
    appId: feishuAppId,
    appSecret: feishuAppSecret,
  }, globalConversationFlow, processChatMessage);

  feishuWebSocketClient = new FeishuWebSocketClient({
    appId: feishuAppId,
    appSecret: feishuAppSecret,
  }, feishuHandler);

  await feishuWebSocketClient.start();
}
```

## 数据共享示例

### 场景 1：文献上传
1. **Web UI 用户上传文献** → 保存到 `data/uploads/web-user/literature.txt`
2. **飞书用户询问** "我上传了哪些文献？" → 读取同一个文件 → 返回相同结果

### 场景 2：写作进度
1. **飞书用户** "帮我写引言" → 保存到 `data/sessions/web-user/drafts/`
2. **Web UI 用户** 查看草稿 → 显示相同的引言草稿

### 场景 3：记忆同步
1. **Web UI 用户** 讨论实验设计 → AI 提取并保存到 `data/memory/web-user/memory.json`
2. **飞书用户** "我的研究主题是什么？" → 读取同一个记忆文件 → 返回之前讨论的主题

## 文件变更清单

### 修改的文件
1. `src/server/local-server.ts` - 完全替换为 1.0.0.6 版本
2. `src/server/routes/literature.ts` - 添加 `setRetrievalEngine()` 导出

### 新增的代码模式
- 统一用户 ID: `unifiedUserId = "web-user"`
- 全局共享组件单例模式
- 飞书和 Web UI 共用 `processChatMessage` 处理器

## 测试建议

### 测试场景 1：文献共享
```
1. 在 Web UI 上传文献文件
2. 在飞书中问："我上传了哪些文献？"
3. 验证：飞书应该能列出 Web UI 上传的文献
```

### 测试场景 2：写作进度共享
```
1. 在飞书中开始写作："帮我写引言"
2. 在 Web UI 查看草稿列表
3. 验证：Web UI 应该能看到飞书中创建的草稿
```

### 测试场景 3：记忆同步
```
1. 在 Web UI 讨论研究主题："我想研究华北平原 N2O 排放"
2. 在飞书中问："我的研究主题是什么？"
3. 验证：飞书应该能回忆起 Web UI 中提到的主题
```

## 注意事项

1. **数据目录结构**: 所有用户数据现在都存储在 `data/{uploads,sessions,memory}/web-user/` 下
2. **多用户场景**: 当前实现假设所有用户使用同一个共享空间，如需区分用户，需要修改 `unifiedUserId` 逻辑
3. **向后兼容**: 原有的用户数据（如果存在）不会自动迁移到新的统一 ID 下

## 验证状态

- ✅ TypeScript 编译通过
- ✅ 文件行数与 1.0.0.6 完全一致（4345 行）
- ✅ 全局共享组件已正确配置
- ✅ 飞书 WebSocket 集成已更新

## 下一步

1. 启动服务器测试实际功能
2. 验证 Web UI 和飞书之间的数据同步
3. 根据需要调整用户隔离策略（如果需要多用户支持）

---

**同步完成时间**: 2026-03-26  
**源版本**: scholar-claw-feishu-1.0.0.6  
**目标版本**: scholar-claw-feishu-1.0.0.5
