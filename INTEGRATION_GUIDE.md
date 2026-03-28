# ScholarClaw-Feishu v1.0.0.5 整合指南

> **日期**: 2026-03-27  
> **整合内容**: 智能记忆补充 + SCI 写作技能自动加载

---

## 📋 整合清单

### ✅ 已完成
1. 复制 SCI 写作技能文件（10 个 .md 文件）
2. 验证目标项目结构

### ⏳ 待完成
1. 修改 `src/server/local-server.ts` - 添加技能加载函数
2. 修改 `data/memory/web-user/memory.json` - 更新为 17 个字段
3. 复制文档文件

---

## 🔧 Step 1: 修改 local-server.ts

### 1.1 添加 skillDir 初始化

**位置**: 约第 39 行，在 memoryDir 初始化之后

```typescript
const memoryDir = path.join(dataDir, "memory");
if (!fs.existsSync(memoryDir)) {
  fs.mkdirSync(memoryDir, { recursive: true });
}

// ========== 添加以下内容 ==========
const skillDir = path.join(projectRoot, "sci_writing_skills");
if (!fs.existsSync(skillDir)) {
  logger.warn("[Skill] Writing skill directory not found:", skillDir);
} else {
  logger.info("[Skill] Writing skills loaded from:", skillDir);
}
```

---

### 1.2 添加 loadWritingSkill() 函数

**位置**: 在 extractTextFromFile() 函数之后

```typescript
/**
 * Load SCI writing skill by chapter type
 * @param chapterType - Type of chapter: introduction, methods, results, discussion, etc.
 * @returns Skill content or empty string if not found
 */
function loadWritingSkill(chapterType: string): string {
  const skillMap: Record<string, string> = {
    'title': '01_title_skill.md',
    'abstract': '02_abstract_skill.md',
    'introduction': '03_introduction_skill.md',
    'intro': '03_introduction_skill.md',
    'methods': '04_methods_skill.md',
    'method': '04_methods_skill.md',
    'methodology': '04_methods_skill.md',
    'materials': '04_methods_skill.md',
    'results': '05_results_skill.md',
    'result': '05_results_skill.md',
    'figures': '06_figures_tables_skill.md',
    'tables': '06_figures_tables_skill.md',
    'discussion': '07_discussion_skill.md',
    'conclusion': '08_conclusion_skill.md',
    'conclusions': '08_conclusion_skill.md',
    'additional': '09_additional_statements_skill.md',
    'statement': '09_additional_statements_skill.md'
  };
  
  const skillFile = skillMap[chapterType.toLowerCase()];
  if (!skillFile) {
    logger.info(`[Skill] No skill found for chapter type: ${chapterType}`);
    return '';
  }
  
  const skillPath = path.join(skillDir, skillFile);
  if (!fs.existsSync(skillPath)) {
    logger.warn(`[Skill] Skill file not found: ${skillPath}`);
    return '';
  }
  
  try {
    const skillContent = fs.readFileSync(skillPath, 'utf-8');
    logger.info(`[Skill] Loaded skill: ${skillFile} for chapter: ${chapterType}`);
    return skillContent;
  } catch (e) {
    logger.error(`[Skill] Failed to load skill: ${skillPath}`, e);
    return '';
  }
}
```

---

### 1.3 添加 detectChapterType() 函数（上下文感知版本）

**位置**: 在 loadWritingSkill() 函数之后

```typescript
/**
 * Detect chapter type from user message and conversation context
 * @param message - User's current message
 * @param history - Recent conversation history
 * @returns Detected chapter type or null
 */
function detectChapterType(message: string, history?: Array<{ role: string; content: string }>): string | null {
  const messageLower = message.toLowerCase();
  
  // ========== 1. 先检测用户当前消息中的明确章节提及 ==========
  
  // 检测明确的章节动词："写"、"开始写"、"生成" 等
  const explicitWriteActions = [
    '写', '开始写', '开始', '生成', '帮我', '给我', 
    'write', 'start writing', 'begin', 'generate', 'draft'
  ];
  
  const hasWriteAction = explicitWriteActions.some(action => 
    messageLower.includes(action)
  );
  
  // 如果消息包含写作动作，优先检测章节类型
  if (hasWriteAction) {
    if (messageLower.includes('引言') || messageLower.includes('introduction') || 
        messageLower.includes('intro')) {
      return 'introduction';
    }
    
    if (messageLower.includes('方法') || messageLower.includes('methods') || 
        messageLower.includes('methodology') || messageLower.includes('材料')) {
      return 'methods';
    }
    
    if (messageLower.includes('结果') || messageLower.includes('results') || 
        messageLower.includes('数据')) {
      return 'results';
    }
    
    if (messageLower.includes('讨论') || messageLower.includes('discussion') || 
        messageLower.includes('discuss')) {
      return 'discussion';
    }
    
    if (messageLower.includes('结论') || messageLower.includes('conclusion') || 
        messageLower.includes('总结')) {
      return 'conclusion';
    }
    
    if (messageLower.includes('摘要') || messageLower.includes('abstract')) {
      return 'abstract';
    }
    
    if (messageLower.includes('标题') || messageLower.includes('title')) {
      return 'title';
    }
    
    if (messageLower.includes('图表') || messageLower.includes('figures') || 
        messageLower.includes('tables') || messageLower.includes('图') || messageLower.includes('表')) {
      return 'figures';
    }
  }
  
  // ========== 2. 检测模糊的写作请求（无明确章节） ==========
  
  // 模糊写作请求关键词
  const vagueWriteRequests = [
    '按这个结构写', '按照这个结构', '开始写吧', '开始写作', 
    '可以写了', '帮我写', '给我写', '写吧', '写',
    'write this', 'follow this structure', 'start writing', 'go ahead'
  ];
  
  const isVagueWriteRequest = vagueWriteRequests.some(req => 
    messageLower.includes(req)
  );
  
  // 如果是模糊写作请求，检查历史消息寻找讨论中的章节
  if (isVagueWriteRequest && history && history.length > 0) {
    logger.info("[Skill] Detected vague write request, searching conversation context for chapter type");
    
    // 检查最近的 AI 回复和用户消息（最多 5 轮）
    const recentContext = history.slice(-10);
    
    for (let i = recentContext.length - 1; i >= 0; i--) {
      const msg = recentContext[i].content.toLowerCase();
      
      // 检测 AI 回复中提到的章节（AI 可能说过"您的结果部分应该包含..."）
      if (msg.includes('结果部分') || msg.includes('results section')) {
        logger.info(`[Skill] Found 'results' in conversation context at message ${i}`);
        return 'results';
      }
      
      if (msg.includes('讨论部分') || msg.includes('discussion section')) {
        logger.info(`[Skill] Found 'discussion' in conversation context at message ${i}`);
        return 'discussion';
      }
      
      if (msg.includes('引言部分') || msg.includes('introduction section')) {
        logger.info(`[Skill] Found 'introduction' in conversation context at message ${i}`);
        return 'introduction';
      }
      
      if (msg.includes('方法部分') || msg.includes('methods section')) {
        logger.info(`[Skill] Found 'methods' in conversation context at message ${i}`);
        return 'methods';
      }
      
      if (msg.includes('结论部分') || msg.includes('conclusion section')) {
        logger.info(`[Skill] Found 'conclusion' in conversation context at message ${i}`);
        return 'conclusion';
      }
    }
  }
  
  // ========== 3. 检查最近提到的章节（通过记忆） ==========
  
  // 如果用户最近讨论过某个章节，应该继续该章节
  
  if (history && history.length > 0) {
    const recentContext = history.slice(-5);
    const contextText = recentContext.map(msg => msg.content).join(' ').toLowerCase();
    
    // 统计每个章节在上下文中出现的频率
    const chapterMentions = {
      'introduction': (contextText.match(/引言 |introduction|intro/g) || []).length,
      'methods': (contextText.match(/方法|methods|methodology/g) || []).length,
      'results': (contextText.match(/结果|results|数据/g) || []).length,
      'discussion': (contextText.match(/讨论|discussion/g) || []).length,
      'conclusion': (contextText.match(/结论|conclusion/g) || []).length
    };
    
    // 找出最频繁提到的章节
    let maxMentions = 0;
    let detectedChapter: string | null = null;
    
    for (const [chapter, count] of Object.entries(chapterMentions)) {
      if (count > maxMentions) {
        maxMentions = count;
        detectedChapter = chapter;
      }
    }
    
    // 如果某个章节被提到 2 次以上，认为这是当前讨论的章节
    if (detectedChapter && maxMentions >= 2) {
      logger.info(`[Skill] Inferred chapter '${detectedChapter}' from context (${maxMentions} mentions)`);
      return detectedChapter;
    }
  }
  
  // 未检测到章节
  return null;
}
```

---

### 1.4 修改 processChatMessage() 函数

**位置**: 找到 processChatMessage() 函数，在其中添加 skill 加载逻辑

查找（约第 4000 行附近）:
```typescript
const decisionResponse = await fetch(useApiUrl + "/chat/completions", {
```

在 decisionResponse 解析之后添加:

```typescript
// ========== 🚀 自动加载 SCI 写作技能（增强上下文检测） ==========
let writingSkillContent = "";

// 获取对话历史用于上下文检测
const contextHistory = conversationHistory.get(userId) || [];
const detectedChapter = detectChapterType(userMessage, contextHistory);

if (detectedChapter) {
  writingSkillContent = loadWritingSkill(detectedChapter);
  if (writingSkillContent) {
    logger.info(`[Skill] Auto-loaded ${detectedChapter} skill for writing task (context-aware)`);
  }
} else {
  logger.info("[Skill] No chapter type detected, skipping skill load");
}
```

---

### 1.5 在 finalSystemPrompt 中注入 skill 内容

**位置**: 找到 finalSystemPrompt 赋值处

查找:
```typescript
const finalSystemPrompt = `你是一个专业的学术论文写作助手...
```

在 taskHint 之后、memoryIntro 之前添加:

```typescript
// 🚀 注入写作技能指导
let writingSkillSection = "";
if (writingSkillContent) {
  writingSkillSection = `\n\n## ✨ SCI 写作技能指导\n\n系统已自动加载 **${detectedChapter}** 章节的写作技能指南。\n请严格按照以下技能要求指导用户写作：\n\n${writingSkillContent}\n\n---\n`;
}
```

然后修改 finalSystemPrompt:

```typescript
const finalSystemPrompt = `你是一个专业的学术论文写作助手。${soulContent ? "\n" + soulContent : ""}
${memoryIntro}
${memoryContext}
${writingProgressContext}

## 你的能力
1. **文献库搜索**：可以从用户上传的文献中查找相关信息
2. **联网搜索**：可以搜索互联网上的最新研究
3. **智能引用**：自动使用 "(作者，年份)" 格式引用文献

## 文献库信息
${hasLiterature ? literatureSummary : "用户还没有上传文献。"}
${journalStyleContent}
${journalStyleHint}

${relevantLiterature}
${webSearchContext}
${taskHint}
${writingSkillSection}

## 回答要求
1. 回答必须有文献依据
2. 必须使用 "(作者，年份)" 格式引用文献
3. 如果有相关文献，必须引用；不要编造引用
4. 使用专业的学术表达

// ... 后续内容保持不变
```

---

## 🔧 Step 2: 更新 memory.json（17 个字段）

**位置**: `data/memory/web-user/memory.json`

备份现有文件后，更新 entries 数组，添加 9 个新字段：

```json
{
  "userId": "web-user",
  "entries": [
    // 现有字段...
    {
      "key": "experiment_summary",
      "value": "...",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "data_summary",
      "value": "...",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    // ========== 添加以下 9 个新字段 ==========
    {
      "key": "draft_progress",
      "value": "无",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "methodology_details",
      "value": "无",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "equipment_info",
      "value": "无",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "sample_info",
      "value": "无",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "structured_data",
      "value": "{}",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "statistical_results",
      "value": "无",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "data_visualization",
      "value": "无",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    }
  ],
  "conversations": [...],
  "updatedAt": "2026-03-27T00:00:00.000Z"
}
```

---

## 📁 需要复制的文档文件

```bash
# 文档
cp "E:/AI_projects/scholar-claw-feishu -1.0.1/docs/smart-memory-system.md" "E:/AI_projects/scholar-claw-feishu -1.0.0.5/docs/"
cp "E:/AI_projects/scholar-claw-feishu -1.0.1/docs/context-aware-skill-loading.md" "E:/AI_projects/scholar-claw-feishu -1.0.0.5/docs/"

# 更新说明
cp "E:/AI_projects/scholar-claw-feishu -1.0.1/RELEASE_NOTES-v1.0.5.md" "E:/AI_projects/scholar-claw-feishu -1.0.0.5/"
cp "E:/AI_projects/scholar-claw-feishu -1.0.1/RELEASE_NOTES-v1.0.6.md" "E:/AI_projects/scholar-claw-feishu -1.0.0.5/"
```

---

## ✅ 验证步骤

### 1. 编译测试
```bash
cd "E:/AI_projects/scholar-claw-feishu -1.0.0.5"
npm run build
```

### 2. 日志验证
启动服务后查看:
```
[Skill] Writing skills loaded from: ...\sci_writing_skills
[Skill] Auto-loaded introduction skill for writing task
```

### 3. 功能测试
发送消息:
```
帮我写引言
按这个结构写
```

---

## 📞 帮助

如果在整合过程中遇到问题，请参考：
- `docs/smart-memory-system.md` - 智能记忆系统说明
- `docs/context-aware-skill-loading.md` - 上下文感知 skill 加载说明

---

**创建时间**: 2026-03-27  
**适用版本**: ScholarClaw-Feishu v1.0.0.5
