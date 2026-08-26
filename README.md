# Scholar Harness - 对话式学术论文写作助手

> 🎓 你的学术写作伙伴 —— AI 辅助，你主导写作

---

## 📋 目录

1. [快速开始（新用户指南）](#-快速开始新用户指南)
2. [项目介绍](#-项目介绍)
3. [功能特性](#-功能特性)
4. [Windows 一键脚本](#-windows-一键脚本)
5. [使用指南](#-使用指南)
6. [项目架构](#-项目架构)
7. [开发指南](#-开发指南)
8. [常见问题](#-常见问题)
9. [技术支持](#-技术支持)

---

## 🚀 快速开始（新用户指南）

### 环境要求

- **Node.js**: 22.0.0 或更高版本（npm 会随 Node.js 一起安装）

### 安装步骤

#### 方式一：使用一键脚本（推荐）

```bash
# 1. 解压项目到任意文件夹
# 2. 进入项目目录，双击运行：
install.bat    # 安装所有依赖

# 3. 安装完成后，双击运行：
start.bat          # 启动服务器

# 4. 浏览器访问：
http://localhost:18789
```

#### 方式二：手动命令行安装

```bash
# 1. 进入项目目录
cd scholar-claw-1.0.0

# 2. 安装项目依赖
npm install

# 3. 创建环境配置文件
copy .env.example .env
# 编辑 .env 文件，填入你的 API Key

# 4. 构建项目
npm run build

# 5. 启动服务器
npm start

# 7. 浏览器访问 http://localhost:18789
```

### 首次使用配置

1. **打开 Web 界面**: http://localhost:18789
2. **配置 API**: 点击左下角 ⚙️ **API 设置**
   - API URL: `https://modelgate.cn/v1`（或其他 OpenAI 兼容接口）
   - API Key: 你的 API 密钥
3. **选择模型**: 点击 🤖 **切换模型** 选择对话模型
4. **配置 AI 助手**: 点击 🎯 **AI 助手配置** 设置写作助手模型
5. **开始写作**: 在对话框输入 "帮我写引言" 即可开始

---

## 📖 项目介绍

**ScholarClaw** 是一个对话式学术论文写作助手，通过 AI 辅助帮助研究者更高效地完成学术论文写作。

### 核心理念

- **你是专家，AI 是助手** —— AI 提供写作指导和建议，但写作的主导权始终在你手中
- **逐步引导，不越俎代庖** —— AI 会引导你逐步完成每个章节，而不是一次性生成整章内容
- **真实可信，绝不编造** —— 所有引用必须来自真实文献，绝不虚构

### 适用场景

- 📝 学术论文写作（引言、方法、结果、讨论等）
- 📚 文献综述整理
- 🎯 期刊投稿准备
- ✍️ 论文修改润色

---

## ✨ 功能特性

### 核心功能

| 功能 | 说明 |
|------|------|
| 💬 **对话式写作** | 通过自然对话进行论文写作指导 |
| 📄 **文献管理** | 上传 PDF 文件，AI 自动读取并引用 |
| 🎯 **期刊风格分析** | 上传目标期刊范文，AI 学习其写作风格 |
| 🌐 **联网搜索** | 配置 Tavily API 进行学术搜索 |
| 🧠 **长期记忆** | 自动保存研究主题、写作偏好等信息 |
| ⚙️ **灵活配置** | 支持多种 AI 模型（OpenAI、Claude、通义千问等） |

### 工作流程

```
用户请求："帮我写引言"
  ↓
AI 识别为写作任务
  ↓
生成写作指导：
- 写作重点建议
- 关键要点提示
- 整体结构规划
- 执行指令
  ↓
用户根据指导逐步写作
  ↓
AI 协助修改和优化
```

---

## 🪟 Windows 一键脚本

### 脚本说明

| 脚本文件 | 用途 | 使用场景 |
|---------|------|---------|
| `install.bat` | 安装所有依赖 | **新用户首次使用** |
| `reinstall.bat` | 完全重装依赖 | 项目复制/移动后修复 |
| `start.bat` | 启动服务器 | 日常使用 |

### 详细说明

#### 1. install.bat（新用户安装）

**功能**:
- 检查 Node.js 是否安装
- 安装项目依赖
- 创建默认 `.env` 配置文件

**使用**:
```bash
# 双击运行，或命令行执行：
install.bat
```

#### 2. reinstall.bat（完全重装）

**功能**:
- 删除损坏的 `node_modules`
- 删除 `dist` 构建目录
- 删除 `package-lock.json`
- 重新安装并构建

**使用场景**:
- 项目从其他位置复制后
- `node_modules` 损坏
- 依赖出现问题

```bash
# 双击运行，或命令行执行：
reinstall.bat
```

#### 3. start.bat（启动服务）

**功能**:
- 检查依赖完整性
- 自动构建（如需要）
- 启动 Web 服务器
- 显示访问地址

**使用**:
```bash
# 双击运行，或命令行执行：
start.bat
```

---

## 📖 使用指南

### 基本对话

直接在对话框输入你的需求：

```
我想写一篇关于华北平原 N2O 排放的论文
```

### 请求写作指导

```
帮我写引言
开始写方法部分
撰写讨论章节
```

AI 会自动：
1. 询问写作重点
2. 确认章节结构
3. 提供逐步指导

### 上传文献

1. 点击对话界面的 📎 **附件按钮**
2. 选择 PDF 文件上传
3. AI 会自动读取文献内容
4. 可以在对话中引用这些文献

### 配置期刊风格

1. 点击左下角 📰 **期刊风格分析**
2. 上传目标期刊的范文 PDF
3. AI 会学习该期刊的写作风格
4. 后续写作会遵循该风格

### 常用命令

```
# 请求写作指导
"帮我写引言"
"开始写方法"
"撰写讨论部分"

# 优化内容
"帮我优化这段文字"
"这段话有没有逻辑问题"

# 引用文献
"根据 Smith 2020 的研究..."
"引用我上传的第 3 篇文献"

# 修改建议
"这段话太长了，简化一下"
"用更学术的语言重写"
```

---

## 🏗️ 项目架构

### 技术栈

- **Runtime**: Node.js 22+
- **Language**: TypeScript
- **Framework**: Express.js
- **Testing**: Vitest
- **Package Manager**: npm

### 目录结构

```
scholar-claw/
├── agents/              # AI Agent 实现
│   └── primary-agent.ts # 主 AI 助手
├── src/
│   ├── server/          # 服务器
│   │   ├── local-server.ts    # Express 服务器
│   │   └── public/            # Web UI 静态文件
│   │       └── index.html     # 前端界面
│   ├── types/           # 类型定义
│   ├── utils/           # 工具函数
│   └── storage/         # 数据持久化
├── configs/             # 配置文件
│   └── models.json      # 模型配置
├── skills/              # 技能定义
├── docs/                # 文档
├── __tests__/           # 测试文件
├── install.bat          # Windows 安装脚本
├── start.bat            # Windows 启动脚本
├── reinstall.bat        # Windows 重装脚本
├── package.json         # 项目配置
├── tsconfig.json        # TypeScript 配置
└── .env                 # 环境变量（需创建）
```

### 核心组件

```
┌─────────────────────────────────────┐
│           Web UI (前端)              │
│  ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │ 对话界面 │ │文献上传 │ │ 配置面板│ │
│  └─────────┘ └─────────┘ └────────┘ │
└────────────────┬────────────────────┘
                 │ HTTP API
                 ▼
┌─────────────────────────────────────┐
│         Express Server (后端)        │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ API Routes  │  │ AI Agent     │  │
│  │ - /api/chat │  │ - 生成指导   │  │
│  │ - /api/skill│  │ - 质量检查   │  │
│  └─────────────┘  └──────────────┘  │
└─────────────────────────────────────┘
```

---

## 🔧 开发指南

### 环境准备

```bash
# 安装依赖
npm install

# 创建环境变量文件
cp .env.example .env
```

### 开发命令

```bash
# 开发模式（热重载）
npm run dev

# 构建项目
npm run build

# 运行测试
npm test

# 生产模式
npm start
```

### 代码规范

#### TypeScript 规范

- **严格模式**: 启用 `strict: true`
- **模块**: CommonJS (`module: "CommonJS"`)
- **目标**: ES2022
- **避免 `any`**: 使用具体类型或 `unknown`

#### 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 类/接口 | PascalCase | `PrimaryAgent`, `UserState` |
| 函数/变量 | camelCase | `generateSkill()`, `chapterPlans` |
| 常量 | UPPER_SNAKE | `DEFAULT_MODEL` |
| 文件 | kebab-case | `primary-agent.ts` |
| 私有属性 | 下划线前缀 | `private _apiClient` |

#### 导入顺序

```typescript
// 1. Node 内置模块
import * as fs from 'fs/promises';

// 2. 第三方库
import { z } from 'zod';

// 3. 项目模块
import { logger } from '../src/utils/logger';
```

### 错误处理

```typescript
try {
  const content = await fs.readFile(filePath, 'utf-8');
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return null;  // 文件不存在
  }
  throw error;    // 其他错误继续抛出
}
```

### 测试规范

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('PrimaryAgent', () => {
  it('should generate skill from user plan', async () => {
    const skill = await agent.generateSkill(mockInput);
    expect(skill).toHaveProperty('sectionName');
  });
});
```

---

## ❓ 常见问题

### Q: 双击 bat 文件闪退怎么办？

**A**: 
1. 确保项目路径**不包含空格**或**特殊字符**
2. 运行 `reinstall.bat` 完全重装
3. 或用命令提示符运行查看错误信息：
   ```cmd
   cd "项目路径"
   install.bat
   ```

### Q: AI 为什么不直接帮我写作？

**A**: 这是设计如此。AI 只提供写作指导，不直接生成内容：
- 保持学术诚信
- 你是研究专家，主导写作
- AI 作为辅助工具

### Q: 支持哪些 AI 模型？

**A**: 任何 OpenAI 兼容接口的模型：
- 通义千问: `qwen3.5-plus`, `qwen-max`
- Claude: `claude-sonnet-4-5`
- OpenAI: `gpt-4o`, `gpt-4`
- 以及其他兼容模型

### Q: 项目复制后无法运行？

**A**: 复制项目后依赖可能损坏：
```bash
# 运行重装脚本修复
reinstall.bat
```

### Q: 如何配置多个项目？

**A**: 每个项目需要独立安装依赖：
```bash
# 项目 A
cd project-a
install.bat

# 项目 B
cd project-b
install.bat
```

---

## 📞 技术支持

- **邮箱**: sjs@cau.edu.cn
- **版本**: v1.0.4 Simplified
- **更新日期**: 2026-03-10

---

## 📝 更新日志

### v1.0.4 (2026-03-10) - 简化版

**优化**:
- ✅ 添加 Windows 一键安装/启动脚本
- ✅ 优化 bat 文件兼容性
- ✅ 完善用户文档

**保留功能**:
- ✅ 核心对话功能
- ✅ AI 写作指导
- ✅ 文献管理
- ✅ 期刊分析

### v1.0.0-1.0.3

- 初始 Web UI 版本
- 单 AI 助手架构
- 自动识别写作任务

---

**开始使用**: 运行 `install.bat` → 运行 `start.bat` → 访问 http://localhost:18789

---

## License

Scholar Harness 完整产品仓库采用根目录 [LICENSE](LICENSE) 中的专有软件许可。除非某个第三方组件或子目录明确附带独立许可证，否则不得复制、修改、分发、再许可、反编译或用于商业托管。
