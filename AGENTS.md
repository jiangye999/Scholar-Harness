# AGENTS.md - Scholar Harness 开发指南

**项目**: 对话式学术论文写作助手 (Scholar Harness)  
**技术栈**: Node.js 22+ / TypeScript / Express / Vitest  
**架构**: 两级 AI 协作 (Primary + Secondary Agent) + 混合检索引擎

---

## 快速命令

```bash
# 开发
npm run dev              # 热重载开发 (ts-node-dev)
npm run electron:dev     # Electron 开发模式

# 构建
npm run build            # TypeScript 编译
npm run electron:build   # 打包 Windows exe

# 测试
npm test                 # 运行所有测试 (vitest)
npx vitest run           # 单次运行
npx vitest run __tests__/agents  # 运行特定目录
npx vitest --watch       # 监听模式

# 启动
npm start                # 生产模式 (Express 服务器)
```

---

## 项目架构

### 目录结构

```
scholar-harness/
├── agents/                    # AI Agent 实现
│   ├── primary-agent.ts       # 一级 AI (大牛马) - 规划、生成 Skill、质量检查
│   ├── secondary-agent-v2.ts  # 二级 AI (小牛马) - 执行写作、引用验证
│   ├── literature-search-agent.ts  # 文献检索与筛选 Agent
│   ├── agent-collaboration-workflow.ts  # 大小牛马协作流程
│   ├── parallel-search-orchestrator.ts  # 并行检索编排
│   ├── sentence-chunker.ts    # 句子级分块
│   ├── paragraph-agent.ts     # 段落生成 Agent
│   └── cow-agent.ts           # 通用写作 Agent
│
├── workflows/
│   └── conversation-flow.ts   # 对话流程管理器
│
├── src/
│   ├── server/                # Express 服务器
│   │   ├── local-server.ts    # 主服务器入口
│   │   ├── routes/            # API 路由
│   │   │   ├── chat-bridge.ts # 聊天桥接
│   │   │   ├── unified-chat.ts # 统一聊天接口
│   │   │   ├── literature.ts  # 文献管理
│   │   │   └── memory.ts      # 记忆管理
│   │   └── middleware/        # 中间件
│   │
│   ├── types/                 # 类型定义
│   │   ├── index.ts           # 核心类型
│   │   └── literature.ts      # 文献系统类型
│   │
│   ├── utils/                 # 工具函数
│   │   ├── logger.ts          # 日志工具
│   │   ├── paths.ts           # 路径管理
│   │   ├── sanitize.ts        # 输入清理
│   │   ├── encryption.ts      # 加密工具
│   │   └── backup-manager.ts  # 备份管理
│   │
│   ├── storage/
│   │   └── session-store.ts   # 会话持久化
│   │
│   ├── literature/            # 文献系统
│   │   ├── parsers/           # 文献解析器 (WoS, CNKI)
│   │   ├── retrieval/         # 检索引擎
│   │   │   ├── bm25-retriever.ts    # BM25 检索
│   │   │   ├── vector-retriever.ts  # 向量检索
│   │   │   ├── hybrid-engine.ts     # 混合检索引擎
│   │   │   └── sentence-retriever.ts # 句子级检索
│   │   ├── generation/        # 内容生成
│   │   │   └── paragraph-generator.ts # 段落生成器
│   │   ├── citation/          # 引用管理
│   │   │   ├── citation-manager.ts
│   │   │   └── formats/       # 引用格式 (APA, GB/T 7714)
│   │   └── planning/
│   │       └── sentence-planner.ts # 句子级规划
│   │
│   ├── bridge/                # 桥接模块
│   │   ├── ai-provider-factory.ts
│   │   └── chat-bridge/
│   │
│   └── orchestrator/
│       └── task-orchestrator.ts # 任务编排
│
├── configs/                   # 配置文件
│   ├── models.json            # 模型配置
│   ├── journals.json          # 期刊配置
│   └── literature-retrieval.json # 检索配置
│
├── skills/
│   └── paper-writing/
│       └── SKILL.md           # 论文写作技能定义
│
├── sci_writing_skills/        # 章节写作技能
│   ├── 01_title_skill.md
│   ├── 02_abstract_skill.md
│   ├── 03_introduction_skill.md
│   ├── 04_methods_skill.md
│   ├── 05_results_skill.md
│   ├── 06_figures_tables_skill.md
│   ├── 07_discussion_skill.md
│   ├── 08_conclusion_skill.md
│   └── 09_additional_statements_skill.md
│
├── cloud/                     # 云服务模块
│   ├── server/                # 云服务器
│   ├── auth/                  # 认证模块
│   ├── payment/               # 支付模块
│   ├── storage/               # 存储模块
│   └── database/              # 数据库
│
├── electron/                  # Electron 桌面应用
│   └── main.ts
│
├── openclaw/                  # OpenClaw 集成
│
└── __tests__/                 # 测试文件
    ├── agents/
    └── workflows/
```

---

## 核心架构

### 两级 Agent 系统

```
┌─────────────────────────────────────────────────────────────┐
│                    Agent Collaboration                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────────┐      ┌─────────────────────────┐   │
│  │   PrimaryAgent      │      │    SecondaryAgent       │   │
│  │   (大牛马)           │      │    (小牛马)              │   │
│  ├─────────────────────┤      ├─────────────────────────┤   │
│  │ • generateSkill()   │─────▶│ • writeSection()        │   │
│  │ • qualityCheck()    │      │ • validateCitations()   │   │
│  │ • generateSearch    │      │ • formatLatex()         │   │
│  │   Queries()         │      │ • writeSectionWith      │   │
│  │                     │      │   ParallelSearch()      │   │
│  ├─────────────────────┤      ├─────────────────────────┤   │
│  │ Model:              │      │ Models (by chapter):    │   │
│  │ claude-sonnet-4.5   │      │ • introduction: gpt-4o  │   │
│  │                     │      │ • discussion: claude    │   │
│  │                     │      │ • methods: gpt-4o       │   │
│  └─────────────────────┘      └─────────────────────────┘   │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │           AgentCollaborationWorkflow                 │    │
│  ├─────────────────────────────────────────────────────┤    │
│  │ 1. PrimaryAgent.generateSearchQueries()              │    │
│  │ 2. LiteratureSearchAgent.executeSearchPipeline()     │    │
│  │ 3. PrimaryAgent.generateSkill()                      │    │
│  │ 4. SecondaryAgent.writeSectionWithParallelSearch()   │    │
│  └─────────────────────────────────────────────────────┘    │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 文献检索系统

```
┌─────────────────────────────────────────────────────────────┐
│                 HybridRetrievalEngine                       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐   │
│  │ BM25Retriever│   │VectorRetriever│   │MetadataFilter   │   │
│  │ (关键词匹配) │   │ (语义相似度)  │   │ (元数据筛选)    │   │
│  └──────┬──────┘   └──────┬──────┘   └────────┬────────┘   │
│         │                 │                    │            │
│         └────────────┬────┴────────────────────┘            │
│                      ▼                                      │
│              ┌───────────────┐                              │
│              │  分数融合排序  │                              │
│              │ combinedScore │                              │
│              └───────────────┘                              │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 对话流程状态机

```typescript
type ConversationPhase = 
  | 'greeting'   // 问候 - 引导用户开始
  | 'topic'      // 主题 - 收集论文主题
  | 'journal'    // 期刊 - 确认目标期刊
  | 'upload'     // 上传 - 收集研究材料
  | 'planning'   // 规划 - 章节规划
  | 'writing'    // 写作 - 执行写作
  | 'complete';  // 完成 - 输出结果
```

---

## 核心类型定义

### 用户状态 (UserState)

```typescript
interface UserState {
  id: string;
  phase: ConversationPhase;
  paperTopic?: string;
  targetJournal?: string;
  researchContent?: string;
  researchContentPath?: string;
  journalPapers?: string[];
  literatureDb?: string;
  chapterPlans: Map<string, ChapterPlan>;
  currentChapter?: string;
  writingProgress: Map<string, SectionProgress>;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}
```

### 章节规划 (ChapterPlan)

```typescript
interface ChapterPlan {
  chapterName: string;
  enabled: boolean;
  writingFocus: string;
  keyPoints: string[];
  specialRequirements?: string;
  wordCountTarget?: number;
  customTitle?: string;
}
```

### 写作 Skill (GeneratedSkill)

```typescript
interface GeneratedSkill {
  sectionName: string;
  userWritingFocus: string;
  userKeyPoints: string[];
  specialRequirements?: string;
  overallStructure: {
    paragraphCount: number;
    mainSections: string[];
    transitionStrategy: string;
  };
  paragraphDetails: Array<{
    paragraphId: number;
    title: string;
    purpose: string;
    contentOutline: string[];
    wordCountEstimate: number;
  }>;
  executionInstructions: string[];
}
```

### 文献检索结果 (RetrievedDocument)

```typescript
interface RetrievedDocument extends UnifiedLiterature {
  bm25Score?: number;
  vectorScore?: number;
  rerankScore?: number;
  combinedScore: number;
  rank?: number;
}

interface UnifiedLiterature {
  id: string;
  title: string;
  authors: Author[];
  author: string;        // 显示用字符串
  year: number;
  abstract: string;
  keywords: string[];
  journal: string;
  doi?: string;
  source: 'wos' | 'cnki';
  embedding?: number[];
}
```

---

## 代码风格

### TypeScript 规范

- **严格模式**: 启用 `strict: true`
- **模块**: CommonJS (`module: "CommonJS"`)
- **目标**: ES2022
- **避免 `any`**: 使用具体类型或 `unknown`

### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 类/接口 | PascalCase | `PrimaryAgent`, `UserState` |
| 函数/变量 | camelCase | `generateSkill()`, `chapterPlans` |
| 常量 | UPPER_SNAKE | `DEFAULT_MODEL`, `SESSION_TTL_MS` |
| 文件 | kebab-case | `primary-agent.ts`, `session-store.ts` |
| 私有属性 | 无前缀 | `private apiClient`, `private dataDir` |

### 导入顺序

```typescript
// 1. Node 内置模块
import * as fs from 'fs/promises';
import * as path from 'path';

// 2. 第三方库
import { z } from 'zod';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// 3. 项目模块 (相对路径)
import { logger } from '../src/utils/logger';
import type { UserState, ChapterPlan } from '../src/types';
```

---

## 日志规范

```typescript
import { logger } from '../src/utils/logger';

logger.debug('详细调试信息');    // 仅 DEBUG=1 时输出
logger.info('流程进度');         // 正常信息
logger.warn('需要注意的情况');   // 警告
logger.error('错误', error);    // 错误
```

---

## 错误处理

```typescript
// 使用类型守卫处理已知错误
try {
  const content = await fs.readFile(filePath, 'utf-8');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return null;  // 文件不存在，返回 null
  }
  throw error;    // 其他错误继续抛出
}

// 统一错误响应格式
interface ErrorResponse {
  code: string;
  message: string;
  recoverable: boolean;
  phase?: ConversationPhase;
}
```

---

## 测试规范

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PrimaryAgent } from '../../agents/primary-agent';

describe('PrimaryAgent', () => {
  let agent: PrimaryAgent;
  
  const mockApiClient = {
    chat: vi.fn().mockResolvedValue('{"sectionName":"test",...}'),
  };

  beforeEach(() => {
    agent = new PrimaryAgent(mockApiClient as any, 'claude-sonnet-4-5');
  });

  it('should generate skill from user plan', async () => {
    const skill = await agent.generateSkill(mockInput);
    expect(skill).toHaveProperty('sectionName');
  });
});
```

---

## 配置文件

### configs/models.json

```json
{
  "primary": {
    "model": "claude-sonnet-4-5",
    "temperature": 0.7,
    "maxTokens": 4000
  },
  "secondary": {
    "introduction": { "model": "gpt-4o", "temperature": 0.7 },
    "methods": { "model": "gpt-4o", "temperature": 0.7 },
    "results": { "model": "gpt-4o", "temperature": 0.7 },
    "discussion": { "model": "claude-sonnet-4-5", "temperature": 0.7 },
    "abstract": { "model": "gpt-4o", "temperature": 0.5 },
    "conclusion": { "model": "claude-sonnet-4-5", "temperature": 0.7 }
  },
  "fallback": {
    "model": "gpt-4o",
    "temperature": 0.7
  }
}
```

---

## 重要提醒

- **不要**硬编码 API Key，使用 `.env` 文件或环境变量
- **必须**处理用户中断和进度保存 (SessionStore)
- **必须**使用 Zod 验证外部输入
- **优先**使用 `logger` 而非 `console.log`
- **保持**函数简洁，单一职责
- **引用验证**: 二级 AI 会自动验证引用的真实性，移除无效引用

---

## 环境变量

```bash
# .env 文件示例
API_URL=https://api.example.com/v1
API_KEY=your-api-key
PRIMARY_MODEL=qwen3.5-plus
EMBEDDING_MODEL=text-embedding-3-small
TAVILY_API_KEY=your-tavily-key
EXA_API_KEY=your-exa-key
PORT=18799
DEBUG=1
```

---

**联系**: sjs@cau.edu.cn
