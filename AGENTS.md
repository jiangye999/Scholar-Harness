# AGENTS.md - ScholarClaw 开发指南

**项目**: 对话式学术论文写作助手  
**技术栈**: Node.js 22+ / TypeScript / Vitest  
**架构**: 两级 AI 协作 (Primary + Secondary Agent)

---

## 快速命令

```bash
# 开发
pnpm dev              # 热重载开发
pnpm dev:local        # 本地服务器模式
pnpm dev:cli          # CLI 模式

# 构建
pnpm build            # TypeScript 编译

# 测试
pnpm test                         # 运行所有测试
pnpm vitest run                   # 单次运行所有测试
pnpm vitest run __tests__/agents  # 运行单个目录的测试
pnpm vitest run primary-agent     # 运行匹配文件名的测试
pnpm vitest --watch               # 监听模式

# 启动
pnpm start             # 生产模式
pnpm start:cli         # CLI 生产模式
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
| 常量 | UPPER_SNAKE | `DEFAULT_MODEL` |
| 文件 | kebab-case | `primary-agent.ts`, `session-store.ts` |
| 私有属性 | 下划线前缀 | `private apiClient`, `private dataDir` |

### 导入顺序

```typescript
// 1. Node 内置模块
import * as fs from 'fs/promises';
import * as path from 'path';

// 2. 第三方库
import { z } from 'zod';
import { describe, it, expect, beforeEach } from 'vitest';

// 3. 项目模块 (相对路径)
import { logger } from '../src/utils/logger';
import type { UserState, ChapterPlan } from '../types';
```

### 类型定义

```typescript
// 使用 interface 定义对象类型
export interface ChapterPlan {
  chapterName: string;
  writingFocus: string;
  keyPoints: string[];
  specialRequirements?: string;  // 可选属性用 ?
}

// 使用 type 定义联合类型或工具类型
export type ConversationPhase = 
  | 'greeting' | 'topic' | 'journal' 
  | 'upload' | 'planning' | 'writing' | 'complete';

// 使用 Zod 进行运行时验证
export const ChapterPlanSchema = z.object({
  chapterName: z.string(),
  writingFocus: z.string(),
  keyPoints: z.array(z.string()),
});
```

---

## 核心架构

### 两级 Agent 系统

```
PrimaryAgent (一级 AI)          SecondaryAgent (二级 AI)
├── generateSkill()              ├── writeSection()
├── qualityCheck()               ├── addCitations()
└── 模型: claude-sonnet-4.5      └── 模型: gpt-4o / claude
```

### 状态管理

```typescript
interface UserState {
  phase: ConversationPhase;           // 当前阶段
  paperTopic?: string;                // 论文主题
  targetJournal?: string;             // 目标期刊
  chapterPlans: Map<string, ChapterPlan>;  // 章节规划
  writingProgress: Map<string, SectionProgress>; // 写作进度
}
```

### 文件结构

```
scholar-claw/
├── agents/          # AI Agent 实现
├── workflows/       # 对话流程管理
├── src/
│   ├── types/       # 类型定义 (index.ts)
│   ├── utils/       # 工具函数 (logger.ts)
│   ├── storage/     # 数据持久化
│   └── server/      # 服务器入口
├── configs/         # 配置文件 (models.json)
├── skills/          # 技能定义 (paper-writing/)
└── __tests__/       # 测试文件
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

## 日志规范

```typescript
import { logger } from '../src/utils/logger';

logger.debug('详细调试信息');    // 仅 DEBUG=1 时输出
logger.info('流程进度');         // 正常信息
logger.warn('需要注意的情况');   // 警告
logger.error('错误', error);    // 错误
```

---

## 测试规范

```typescript
// 使用 Vitest
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('PrimaryAgent', () => {
  let agent: PrimaryAgent;
  
  const mockApiClient = {
    chat: vi.fn().mockResolvedValue('response'),
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
  "primary": { "model": "claude-sonnet-4.5", "temperature": 0.7 },
  "secondary": {
    "introduction": { "model": "gpt-4o", "temperature": 0.7 },
    "discussion": { "model": "claude-sonnet-4.5", "temperature": 0.7 }
  }
}
```

---

## 重要提醒

- **不要**硬编码 API Key，使用 `.env` 文件
- **必须**处理用户中断和进度保存
- **必须**使用 Zod 验证外部输入
- **优先**使用 `console.log`/`logger` 而非复杂日志库
- **保持**函数简洁，单一职责

---

**联系**: sjs@cau.edu.cn