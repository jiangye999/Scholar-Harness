# ScholarClaw + NiceAIGC 完整备份

**备份时间**: 2026-03-28 20:16  
**版本**: v2.0 - 双模式整合版

---

## 系统架构

本备份包含完整的 ScholarClaw + NiceAIGC 整合系统，实现以下功能：

1. **NiceAIGC 作为大脑**: 处理复杂写作构思、高质量内容生成
2. **API Flow 作为手脚**: 更新跨会话长期记忆、数据持久化
3. **智能上下文传递**: 完整传递记忆、文献、期刊风格、写作技能
4. **增强的 UI 显示**: Markdown 格式渲染，层次分明

---

## 备份文件清单

### ScholarClaw 源代码

| 文件 | 路径 | 说明 |
|------|------|------|
| niceaigc-bridge.ts | src/bridge/niceaigc/ | NiceAIGC 桥接适配器 |
| config.json | src/bridge/niceaigc/ | NiceAIGC 配置文件 |
| niceaigc.ts | src/server/routes/ | NiceAIGC API 路由 |
| memory.ts | src/server/routes/ | 记忆管理路由（手脚层） |
| unified-chat.ts | src/server/routes/ | 统一聊天路由（可选） |
| task-orchestrator.ts | src/orchestrator/ | 任务协调器（可选） |
| index.html | src/public/ | 前端 UI（增强版） |
| openclaw-bridge.js | src/bridge/ | OpenClaw 桥接（旧版） |

### OpenClaw 外部项目

| 文件 | 说明 |
|------|------|
| openclaw_index.js | 浏览器自动化脚本（修改版） |
| openclaw_state.json | 浏览器登录状态（如有） |

---

## 核心功能

### 1. 双模式协作架构

```
用户输入
    ↓
[前端] 准备完整上下文
    ↓
[NiceAIGC - 大脑] 生成高质量内容
    ↓
[前端] 显示响应
    ↓
[API - 手脚] 更新长期记忆
    ↓
[完成]
```

### 2. 传递的上下文

**前端 → NiceAIGC**:
- systemPrompt (完整系统提示词)
- soulContent (用户自定义灵魂)
- taskType (任务类型检测)
- writingSkill (章节写作技能)
- memory (跨会话长期记忆)
  - writingProgress
  - completedChapters
  - pendingChapters
  - conversations
  - other
- literature (文献上下文)
- journalStyle (期刊风格)

### 3. 增强的 Markdown 渲染

支持的格式：
- 标题 (H1-H6)
- 粗体、斜体、删除线
- 行内代码、代码块
- 引用块
- 无序/有序列表
- 链接
- 分隔线
- 表格

### 4. 记忆管理

**存储位置**: `data/uploads/{userId}/memory.json`

**自动提取**:
- writing_progress
- completed_chapters
- pending_chapters
- paper_topic
- target_journal
- key_findings
- research_method

**更新时机**: 每次 NiceAIGC 对话结束后

---

## 配置说明

### 必须配置

1. **NiceAIGC**:
   - URL: `https://node8.nice188.com/`
   - 账号: sjs@cau.edu.cn
   - 已启用

2. **API 配置** (可选，用于智能记忆提取):
   - URL: 你的 OpenAI API 地址
   - Key: API Key

### 配置文件

`src/bridge/niceaigc/config.json`:
```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://node8.nice188.com/"
  },
  "browser": {
    "profile": "chrome",
    "timeout_ms": 70000,
    "wait_for_response_ms": 15000
  }
}
```

---

## 关键代码修改

### 1. 前端 index.html

**prepareNiceAIGCContext()**: 从服务器读取记忆
```javascript
// 从服务器读取跨会话长期记忆
var memoryResponse = await fetch('/api/memory/' + currentUserId);
```

**updateMemoryWithAPI()**: 调用 API 更新记忆
```javascript
await fetch('/api/memory/update', {...})
```

**formatMessage()**: 增强的 Markdown 渲染
- 支持标题、列表、引用、代码等

### 2. 后端 niceaigc.ts

**buildEnrichedMessage()**: 构建完整增强消息
- 整合 16 项上下文
- 生成结构化提示词

### 3. 后端 memory.ts (新增)

**记忆管理路由**:
- POST /api/memory/update: 更新记忆
- GET /api/memory/:userId: 读取记忆

**extractMemoryFromConversation()**: 从对话提取关键信息

---

## 使用流程

1. **启动服务**: `pnpm start`
2. **打开 UI**: 访问 http://localhost:18789
3. **配置 NiceAIGC**: 点击配置按钮，启用并保存
4. **开始对话**: 输入消息，系统自动调用 NiceAIGC
5. **查看响应**: 格式化的 Markdown 显示
6. **自动更新记忆**: 对话结束后自动保存关键信息

---

## 恢复备份

```bash
# 复制源代码
cp -r backup_*/niceaigc src/bridge/
cp -r backup_*/routes src/server/
cp -r backup_*/orchestrator src/ 2>/dev/null
cp backup_*/index.html src/public/

# 复制 OpenClaw
cp backup_*/openclaw_index.js E:/AI_projects/openclaw/index.js

# 重新构建
pnpm build

# 启动
pnpm start
```

---

## 技术栈

- **前端**: HTML + JavaScript + CSS
- **后端**: Node.js + Express + TypeScript
- **浏览器自动化**: Playwright (OpenClaw)
- **AI 服务**: NiceAIGC (node8.nice188.com)
- **数据存储**: localStorage + 文件系统

---

## 联系方式

项目: ScholarClaw  
版本: v2.0  
备份日期: 2026-03-28
