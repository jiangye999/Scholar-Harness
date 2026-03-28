# 上下文感知的 Skill 加载功能

> **版本**: v1.0.7  
> **更新日期**: 2026-03-27  
> **核心改进**: AI 可以在用户模糊请求时自动从对话历史中推断章节类型

---

## 🎯 问题背景

### 常见使用场景

**场景 1：讨论后写作**
```
用户（多轮讨论后）：按照这个结构写就行

AI（之前）：❌ 无法识别要写哪个章节
AI（现在）：✅ 检测到是"results"章节
```

**场景 2：延续对话**
```
用户：开始写吧

AI（之前）：❌ 不知道写什么
AI（现在）：✅ 从上下文推断是"discussion"
```

---

## ✨ 三层检测机制

### 第一层：明确检测
检测用户消息中的**章节关键词 + 写作动词**

**示例**：
```
"帮我写引言" → introduction ✅
"开始写讨论" → discussion ✅
"生成结果部分" → results ✅
```

**关键词**：
- 写作动词：写、开始写、生成、帮我写
- 章节词：引言、方法、结果、讨论、结论

---

### 第二层：模糊请求检测
检测用户的**模糊写作请求**，然后从**历史消息**中寻找章节线索

**模糊请求关键词**：
```
"按这个结构写"
"按照这个结构"
"开始写吧"
"可以写了"
"帮我写"
"write this"
"follow this structure"
```

**历史消息检测**：
```typescript
// 检查最近 10 轮对话（AI 回复 + 用户消息）
检查是否包含：
- "结果部分应该..." → results
- "讨论部分需要..." → discussion
- "引言的结构..." → introduction
- ...
```

---

### 第三层：上下文频率分析
统计最近对话中**各章节被提及的频率**，选择最频繁的章节

**示例**：
```
用户：我们刚才讨论的结果部分，结构怎么安排？
AI:   结果部分应该包含 3 个图表...
用户：好的，那我开始写了
       ↓
分析上下文："结果部分" 出现 2 次
       ↓
推断：用户要写 results
```

---

## 📊 检测流程

```
用户消息："按这个结构写"
        ↓
[第一层] 有"写" → 有章节词？
        ↓
        ❌ 没有明确章节词
        ↓
[第二层] 是模糊请求？ → 检查历史消息
        ↓
        ✅ "按这个结构写" 命中模糊请求
        ↓
搜索历史消息（最多 10 轮）：
- AI: "您的结果部分应该包含..."
        ↓
✅ 检测到"结果部分"
        ↓
返回：results
        ↓
加载：05_results_skill.md
```

---

## 💡 使用示例

### 示例 1：典型的多轮讨论后写作

**对话流程**：
```
用户：我想写结果部分，应该怎么组织？

AI:   结果部分通常包含：
      1. 主要发现
      2. 数据对比
      3. 统计分析
      
      您打算先写哪个部分？

用户：先写数据对比吧

AI:   好的。数据对比应该包括：
      - 处理间对比
      - 时间序列变化
      - 与预期值对比
      
      您有具体的对比数据吗？

用户：有的，N2O 排放数据已经整理好了
      按照这个结构给我写就行

AI（自动检测）:
      ✅ 从历史消息中检测到"结果部分"
      ✅ 加载 results 技能
      ✅ 按照结果技能指导写作
```

**关键检测点**：
- 用户消息："按照这个结构给我写就行"
- 触发：模糊请求检测
- 搜索历史：发现"结果部分"出现 2 次
- 推断：results → 加载 `05_results_skill.md`

---

### 示例 2：简单的延续请求

**对话流程**：
```
用户：讨论部分怎么写比较好？

AI:   Discussion 应该包含：
      1. 主要发现总结
      2. 与文献对比
      3. 局限性讨论
      4. 结论
      
      您想重点讨论哪个方面？

用户：重点写和文献的对比

AI:   好的。对比文献时，建议：
      - 支持您发现的文献
      - 与您发现矛盾的文献
      - 可能的解释
      
      您找到哪些相关文献？

用户：找到了 5 篇相关的
      开始写吧

AI（自动检测）:
      ✅ 从历史消息中检测到"讨论部分"
      ✅ 加载 discussion 技能
      ✅ 按照讨论技能指导写作
```

---

### 示例 3：中英文混合场景

**对话流程**：
```
用户：Results 部分的结构怎么安排？

AI:   Results 应该包含...

用户：好的，明白了
      write this

AI（自动检测）:
      ✅ 从历史消息中检测到"Results"
      ✅ 加载 results 技能
```

---

## 🎯 检测优先级

```
1. 明确检测（最高优先级）
   - "帮我写引言" → 直接返回 introduction
   - 优先级最高，一旦匹配立即返回

2. 模糊请求 + 历史检测（中等优先级）
   - "按这个结构写" → 搜索历史
   - 搜索最近 10 轮对话
   - 找到即返回

3. 上下文频率分析（较低优先级）
   - 统计各章节提及频率
   - 需要 mentions ≥ 2
   - 返回最频繁的章节

4. 未检测到（返回 null）
   - 不使用技能
   - AI 按通用方式回复
```

---

## 🧪 测试场景

### 测试 1：明确请求
```
输入："帮我写讨论"
预期：discussion ✅
日志：[Skill] Auto-loaded discussion skill for writing task (context-aware)
```

### 测试 2：模糊请求 + 历史明确
```
历史："您的结果部分应该包含 3 个图表..."
输入："按这个结构写"
预期：results ✅
日志：[Skill] Found 'results' in conversation context
```

### 测试 3：模糊请求 + 频率分析
```
历史：（多次提到"讨论部分"）
输入："开始写吧"
预期：discussion ✅
日志：[Skill] Inferred chapter 'discussion' from context (3 mentions)
```

### 测试 4：完全模糊
```
历史：（未提及任何章节）
输入："写吧"
预期：null ❌
日志：[Skill] No chapter type detected, skipping skill load
```

---

## 📋 日志格式

### 成功检测到章节
```
[ChatProcessor] Processing for web-user: 按照这个结构写...
[Skill] Detected vague write request, searching conversation context for chapter type
[Skill] Found 'results' in conversation context at message 8
[Skill] Auto-loaded results skill for writing task (context-aware)
[Skill] Loaded skill: 05_results_skill.md for chapter: results
```

### 频率分析检测到
```
[Skill] Detected vague write request, searching conversation context for chapter type
[Skill] Inferred chapter 'discussion' from context (3 mentions)
[Skill] Auto-loaded discussion skill for writing task (context-aware)
```

### 未检测到
```
[Skill] No chapter type detected, skipping skill load
```

---

## 🔧 技术实现

### 核心函数

```typescript
function detectChapterType(
  message: string, 
  history?: Array<{ role: string; content: string }>
): string | null
```

**参数说明**：
- `message`: 用户当前消息
- `history`: 可选项，最近的对话历史

**返回**：
- 章节类型字符串：'introduction', 'methods', 'results', 'discussion', 'conclusion', 'abstract', 'title', 'figures'
- `null`: 未检测到

### 调用示例

```typescript
// 获取对话历史
const contextHistory = conversationHistory.get(userId) || [];

// 传入历史进行检测
const detectedChapter = detectChapterType(userMessage, contextHistory);

// 根据结果加载技能
if (detectedChapter) {
  writingSkillContent = loadWritingSkill(detectedChapter);
}
```

### 关键代码片段

```typescript
// 模糊请求检测
const vagueWriteRequests = [
  '按这个结构写', '按照这个结构', '开始写吧', 
  'write this', 'follow this structure', 'start writing'
];

const isVagueWriteRequest = vagueWriteRequests.some(req => 
  messageLower.includes(req)
);

// 搜索历史消息
if (isVagueWriteRequest && history && history.length > 0) {
  const recentContext = history.slice(-10);
  
  for (let i = recentContext.length - 1; i >= 0; i--) {
    const msg = recentContext[i].content.toLowerCase();
    
    if (msg.includes('结果部分') || msg.includes('results section')) {
      logger.info(`[Skill] Found 'results' in conversation context at message ${i}`);
      return 'results';
    }
  }
}
```

---

## ⚠️ 注意事项

### 1. 上下文窗口大小
默认检查**最近 10 轮**对话（5 轮用户 + 5 轮 AI）
- 太短：可能错过早期讨论
- 太长：可能检测到不相关的章节

**修改方法**：
```typescript
const recentContext = history.slice(-10); // 修改数字调整窗口
```

### 2. 频率阈值
默认要求章节在上下文中出现 **≥ 2 次**
- 太低：容易误判
- 太高：容易漏判

**修改方法**：
```typescript
if (detectedChapter && maxMentions >= 2) { // 修改数字
  return detectedChapter;
}
```

### 3. 优先级覆盖
如果用户明确说"写引言"，即使上下文中"讨论"出现 10 次，也优先使用明确的请求。

---

## 🚀 最佳实践

### ✅ 推荐做法
1. **在上下文中明确章节名**：
   ```
   AI: "您的结果部分应该包含..."
   ```

2. **AI 回复中重复章节名**：
   ```
   AI: "结果部分的第一段应该..."
   AI: "结果部分的第二段..."
   ```

3. **鼓励用户在连续对话中使用**：
   ```
   用户："讨论部分怎么写？"
   AI:   "Discussion 应该..."
   用户："好的，开始写吧" → ✅ 检测到
   ```

### ❌ 避免做法
1. **跨会话使用模糊请求**：
   ```
   会话 1：讨论了结果部分
   会话 2："按这个结构写" → ❌ 新会话没有历史
   
   解决：使用长期记忆中的写作进度
   ```

2. **混淆多个章节**：
   ```
   用户："我想写引言和方法"
   
   解决：分解为两个请求
   ```

---

## 📊 效果对比

### 之前（无上下文检测）
```
用户：讨论部分的结构很重要

AI:   是的，Discussion 应该包含...

用户：好的，按照这个结构写

AI:   好的！请告诉我您想写什么内容？
      ❌ 没有加载任何技能
```

### 现在（上下文感知检测）
```
用户：讨论部分的结构很重要

AI:   是的，Discussion 应该包含...

用户：好的，按照这个结构写

AI:   好的！我将按照 SCI Discussion 的标准结构帮您写作。
      ✅ 检测到"讨论部分"，加载 discussion 技能
      
      一个优秀的 Discussion 应该：
      1. 总结主要发现
      2. 与文献比较
      3. 讨论局限性
      4. 提出未来方向
      
      让我们从第一步开始：请用一句话总结您的主要发现。
```

---

## 🔮 后续规划

- [ ] 基于长期写作进度推断章节
- [ ] 支持用户指定默认章节
- [ ] 检测多个章节并发请求
- [ ] 智能跳过已完成的章节

---

## 📝 更新日志

### v1.0.7 (2026-03-27)
**新增**：
- ✅ 三层检测机制（明确 → 模糊 → 频率）
- ✅ 上下文感知的章节推断
- ✅ 历史消息中的章节线索检测
- ✅ 频率分析（mentions ≥ 2）

**改进**：
- ✅ 支持多轮讨论后模糊请求
- ✅ 中英文混合检测
- ✅ 更智能的 skill 加载

---

**更新**: 2026-03-27  
**版本**: v1.0.7 Context-Aware Skill Loading
