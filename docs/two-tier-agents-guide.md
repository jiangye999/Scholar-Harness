# 两级 AI 协作功能使用说明

## 🎯 功能概述

现在 ScholarClaw 实现了真正的**两级 AI 协作**写作流程：

### 一级 AI（规划师）
- **职责**：理解需求、生成写作指导（skill）、质量检查
- **模型**：可配置（默认 `qwen3.5-plus`）
- **调用时机**：写作流程开始、质量检查时

### 二级 AI（执行者）
- **职责**：根据一级 AI 生成的 skill 进行精准写作
- **模型**：按章节配置（每个章节可不同）
- **调用时机**：一级 AI 生成 skill 后

---

## 🚀 测试流程

### 方式一：浏览器控制台测试（推荐）

1. **打开浏览器**
   - 访问：http://localhost:18789
   - 按 `F12` 打开开发者工具

2. **配置 Agent 模型**
   - 点击左侧边栏 **🎯 AI Agent 配置**
   - 设置一级 AI 和二级 AI 的模型
   - 点击 **保存**

3. **测试一级 AI**
   在控制台执行：
   ```javascript
   window.testPrimaryAgent()
   ```
   
   应该看到：
   ```
   🧪 测试一级 AI（生成 skill）...
   ✅ Skill 生成成功！
   { ... skill JSON ... }
   ```

4. **测试完整写作流程**
   ```javascript
   var testPlan = {
     chapterName: 'introduction',
     writingFocus: '介绍研究背景和意义',
     keyPoints: ['研究现状', '研究缺口', '研究目标'],
     specialRequirements: '无'
   };
   window.startAgentWriting(testPlan);
   ```

---

### 方式二：直接调用 API

使用 Postman 或 curl 测试：

#### 1. 测试一级 AI（生成 skill）

```bash
curl -X POST http://localhost:18789/api/generate-skill \
  -H "Content-Type: application/json" \
  -d '{
    "apiUrl": "https://modelgate.cn/v1",
    "apiKey": "你的 API 密钥",
    "agentConfig": {
      "primaryModel": "qwen3.5-plus"
    },
    "chapterPlan": {
      "chapterName": "introduction",
      "writingFocus": "介绍研究背景",
      "keyPoints": ["现状", "缺口", "目标"],
      "specialRequirements": "无"
    }
  }'
```

#### 2. 测试二级 AI（写作）

```bash
curl -X POST http://localhost:18789/api/write-section \
  -H "Content-Type: application/json" \
  -d '{
    "apiUrl": "https://modelgate.cn/v1",
    "apiKey": "你的 API 密钥",
    "agentConfig": {
      "secondaryIntroduction": "gpt-4o"
    },
    "skill": { ... 上一步返回的 skill ... },
    "chapterPlan": { ... 章节规划 ... },
    "researchContent": "研究内容",
    "chapterName": "introduction"
  }'
```

#### 3. 测试完整流程

```bash
curl -X POST http://localhost:18789/api/write-with-agents \
  -H "Content-Type: application/json" \
  -d '{
    "apiUrl": "https://modelgate.cn/v1",
    "apiKey": "你的 API 密钥",
    "agentConfig": {
      "primaryModel": "qwen3.5-plus",
      "secondaryIntroduction": "gpt-4o"
    },
    "chapterPlan": {
      "chapterName": "introduction",
      "writingFocus": "介绍研究背景",
      "keyPoints": ["现状", "缺口", "目标"]
    },
    "researchContent": "研究内容"
  }'
```

---

## 📊 工作流程

### 完整写作流程（`/api/write-with-agents`）

```
用户请求
  ↓
[步骤 1] 一级 AI 生成 skill
  ├─ 分析章节规划
  ├─ 整合期刊风格
  └─ 生成详细写作指导
  ↓
[步骤 2] 二级 AI 写作
  ├─ 读取 skill 指导
  ├─ 搜索相关文献
  └─ 生成论文内容
  ↓
[步骤 3] 一级 AI 质量检查
  ├─ 检查是否符合 skill
  ├─ 检查文献引用
  └─ 优化表达
  ↓
返回最终内容
```

---

## 🔧 API 端点

### 1. `/api/generate-skill` - 生成写作指导

**请求参数**：
```json
{
  "apiUrl": "string",      // API 地址
  "apiKey": "string",      // API 密钥
  "agentConfig": {         // Agent 配置（可选）
    "primaryModel": "qwen3.5-plus"
  },
  "chapterPlan": {         // 章节规划（必需）
    "chapterName": "introduction",
    "writingFocus": "写作重点",
    "keyPoints": ["要点 1", "要点 2"],
    "specialRequirements": "特殊要求"
  },
  "styleGuide": "string",  // 期刊风格指南（可选）
  "researchContent": "string"  // 研究内容（可选）
}
```

**返回结果**：
```json
{
  "success": true,
  "skill": {
    "sectionName": "introduction",
    "userWritingFocus": "...",
    "userKeyPoints": [...],
    "styleGuideContent": "...",
    "overallStructure": { ... },
    "paragraphDetails": [ ... ],
    "executionInstructions": "..."
  }
}
```

---

### 2. `/api/write-section` - 写作章节

**请求参数**：
```json
{
  "apiUrl": "string",
  "apiKey": "string",
  "agentConfig": {
    "secondaryIntroduction": "gpt-4o"
  },
  "skill": { ... },           // 一级 AI 生成的 skill（必需）
  "chapterPlan": { ... },     // 章节规划（必需）
  "styleGuide": "string",
  "researchContent": "string",
  "chapterName": "introduction"
}
```

**返回结果**：
```json
{
  "success": true,
  "content": "LaTeX 格式的论文章节内容..."
}
```

---

### 3. `/api/quality-check` - 质量检查

**请求参数**：
```json
{
  "apiUrl": "string",
  "apiKey": "string",
  "agentConfig": { ... },
  "content": "string",        // 待检查的内容（必需）
  "styleGuide": "string",
  "chapterPlan": { ... }      // 章节规划（必需）
}
```

**返回结果**：
```json
{
  "success": true,
  "content": "优化后的内容..."
}
```

---

### 4. `/api/write-with-agents` - 完整流程

**推荐使用！** 自动执行三级流程。

**请求参数**：同 `/api/generate-skill`

**返回结果**：
```json
{
  "success": true,
  "skill": { ... },           // 一级 AI 生成的 skill
  "content": "..."            // 最终写作内容
}
```

---

## 🎨 前端集成

### 在浏览器中使用

前端已提供全局函数：

```javascript
// 测试一级 AI
window.testPrimaryAgent()

// 开始写作
window.startAgentWriting(chapterPlan)
```

### 在聊天中触发

可以在对话中说：
- "开始写作引言部分"
- "帮我写 Discussion"
- "根据我的规划开始写作"

系统会识别并调用 Agent 写作流程。

---

## 📝 配置示例

### 经济型配置（省钱）

```json
{
  "primaryModel": "qwen3.5-plus",
  "secondaryIntroduction": "qwen3.5-plus",
  "secondaryMethods": "qwen3.5-plus",
  "secondaryResults": "qwen3.5-plus",
  "secondaryDiscussion": "qwen3.5-plus",
  "secondaryAbstract": "qwen3.5-plus",
  "secondaryConclusion": "qwen3.5-plus"
}
```

### 平衡型配置（推荐）

```json
{
  "primaryModel": "qwen3.5-plus",
  "secondaryIntroduction": "claude-sonnet-4-5",
  "secondaryMethods": "gpt-4o",
  "secondaryResults": "gpt-4o",
  "secondaryDiscussion": "claude-sonnet-4-5",
  "secondaryAbstract": "gpt-4o",
  "secondaryConclusion": "claude-sonnet-4-5"
}
```

### 性能型配置（最优）

```json
{
  "primaryModel": "claude-sonnet-4-5",
  "secondaryIntroduction": "claude-sonnet-4-5",
  "secondaryMethods": "gpt-4o",
  "secondaryResults": "gpt-4o",
  "secondaryDiscussion": "claude-sonnet-4-5",
  "secondaryAbstract": "gpt-4o",
  "secondaryConclusion": "claude-sonnet-4-5"
}
```

---

## 🔍 日志查看

服务器日志会显示 Agent 调用过程：

```
[Sklill] Generating skill for introduction
[Sklill] Skill generated: 1234 chars
[Writing] Writing section: introduction
[Writing] Section written: 5678 chars
[QualityCheck] Running quality check
[QualityCheck] Check completed: 5432 chars
[Workflow] Complete workflow finished
```

---

## ❓ 常见问题

### Q1: Agent 没有被调用？
**A**: 检查：
1. 是否配置了正确的 API Key
2. Agent 配置是否保存（localStorage）
3. 服务器日志是否有报错

### Q2: 写作内容不符合预期？
**A**: 调整：
1. chapterPlan 的写作重点描述
2. 更换更适合的模型
3. 提供更详细的研究内容

### Q3: API 调用失败？
**A**: 检查：
1. API URL 是否正确
2. API Key 是否有效
3. 模型名称是否支持

### Q4: 如何查看 skill 内容？
**A**: 调用 `/api/generate-skill` 后，返回的 JSON 中包含完整的 skill 结构。

---

## 📁 相关文件

- **后端实现**: `src/server/local-server.ts`（第 1500+ 行）
- **一级 AI**: `agents/primary-agent.ts`
- **二级 AI**: `agents/secondary-agent.ts`
- **前端函数**: `src/public/index.html`（第 815+ 行）
- **Agent 配置**: `localStorage.scholarclaw_agent_config`

---

**实现时间**: 2026-03-10  
**版本**: v1.0.2（支持两级 AI 协作）
