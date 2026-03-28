# 修复报告：三个文件追加保存模式（最终版）

## 修复概述

已修改**三个文件**的保存逻辑，支持**追加模式**（append），不会覆盖已有内容。每个文件都可以根据需要选择追加或合并。

---

## 修改详情

### 1. 实验资料总结 (`experiment_summary`)

**文件位置**: `src/server/local-server.ts` 第 3627 行

**新增参数**: `append`（默认为 `false`）

#### 保存模式对比

| 模式 | 参数 | 行为 | 适用场景 |
|------|------|------|----------|
| **追加模式** | `append: true` | 新内容直接追加到末尾，用空行分隔 | 补充新的实验方法、新增设备信息 |
| **智能合并** | `merge: true`（默认） | AI 分析并整合新旧内容，去重整合 | 整理同一实验的不同描述 |
| **覆盖模式** | `merge: false, append: false` | 直接替换旧内容（不推荐） | 完全重写时 |

#### 修改逻辑
```typescript
// 新增 simpleAppend 函数
const simpleAppend = (existing: string, newContent: string): string => {
  if (!existing) return newContent;
  if (!newContent) return existing;
  return existing + '\n\n' + newContent;
};

// 追加模式优先
if (append) {
  finalExperimentSummary = simpleAppend(existingExperimentSummary, experimentSummary);
} else if (merge && existingExperimentSummary) {
  // AI 智能合并（默认）
  // ...
}
```

---

### 2. 数据详细总结 (`data_summary`)

**文件位置**: `src/server/local-server.ts` 第 3695 行

**新增参数**: `append`（默认为 `false`）

#### 保存模式对比

同实验资料总结，支持追加、智能合并两种模式。

---

### 3. 论文章节草稿 (`chapter-draft`)

**文件位置**: `src/server/local-server.ts` 第 4359 行

**新增参数**: `append`（默认为 `false`）

#### 保存模式对比

| 模式 | 参数 | 行为 | 适用场景 |
|------|------|------|----------|
| **追加模式** | `append: true` | 新内容追加到文件末尾 | 继续写同一章节 |
| **覆盖模式** | `append: false`（默认） | 替换整章内容 | 重新开始或完整重写 |

#### 修改逻辑
```typescript
const { chapter, content, append = false } = req.body;

let finalContent = content;
if (append && fs.existsSync(filePath)) {
  const existingContent = fs.readFileSync(filePath, 'utf-8');
  finalContent = existingContent + '\n\n' + content;
}

// 同时更新 memory.json 中的草稿进度
memory.entries.push({
  key: 'draft_progress',
  value: `最后更新：${new Date().toLocaleString('zh-CN')} - 章节 ${chapter}`,
  // ...
});
```

---

## 使用方式

### API 调用示例

#### 1. 实验资料总结 - 追加模式
```javascript
POST /api/memory/web-user/update
{
  "experimentSummary": "新增的实验方法...",
  "append": true  // 追加到末尾
}
```

#### 2. 数据详细总结 - 追加模式
```javascript
POST /api/memory/web-user/update
{
  "dataSummary": "新补充的数据分析...",
  "append": true  // 追加到末尾
}
```

#### 3. 论文章节草稿 - 追加模式
```javascript
POST /api/chapter-draft/web-user
{
  "chapter": "methods",
  "content": "继续写方法部分的第二段...",
  "append": true  // 追加到同一章节
}
```

### Web UI 使用建议

1. **第一次上传完整材料和方法** → 系统自动创建（无需 append）
2. **后续补充细节** → 应传入 `append: true`
3. **继续写作草稿** → 每次传入 `append: true`

---

## 文件存储位置

### 1. 实验资料总结
- **文件**: `data/memory/web-user/memory.json`
- **字段**: `experiment_summary`
- **格式**: JSON 中的 value 字段

### 2. 数据详细总结
- **文件**: `data/memory/web-user/memory.json`
- **字段**: `data_summary`
- **格式**: JSON 中的 value 字段

### 3. 论文章节草稿
- **分章节**: `data/output/chapters/web-user/[章节名].md`
- **总草稿**: `data/uploads/web-user/paper-draft.tex`
- **进度记录**: `memory.json` 的 `draft_progress` 字段

**注意**：章节草稿和总草稿是独立的，分别保存。

---

## 容量限制

| 文件 | 修改前 | 修改后 | 说明 |
|------|--------|--------|------|
| experiment_summary | 3000 tokens | 32000 tokens | 无限制（API 最大值） |
| data_summary | 3000 tokens | 32000 tokens | 无限制（API 最大值） |
| chapter-draft | 无限制 | 无限制 | 直接文件写入，从未限制 |

---

## 验证清单

- ✅ TypeScript 编译成功
- ✅ 实验资料总结：支持 `append` 参数
- ✅ 数据详细总结：支持 `append` 参数
- ✅ 论文章节草稿：支持 `append` 参数
- ✅ 智能合并（merge）逻辑保留（向后兼容）
- ✅ 草稿保存时同步更新 memory.json 进度
- ✅ 文件已编译到 dist/

---

## 后续操作

### 重启服务器
```bash
pnpm start
```

### 测试追加功能

1. 打开 Web UI: http://localhost:18789
2. 第一次上传实验方法 → 正常保存
3. 第二次补充更多细节 → 应该追加到原文末尾
4. 检查 `memory.json` 文件大小 → 应该增大

或用 API 测试：
```bash
# 第一次
curl -X POST http://localhost:18789/api/memory/web-user/update \
  -H "Content-Type: application/json" \
  -d '{"experimentSummary": "第一段内容"}'

# 第二次追加
curl -X POST http://localhost:18789/api/memory/web-user/update \
  -H "Content-Type: application/json" \
  -d '{"experimentSummary": "第二段追加内容", "append": true}'
```

---

## 技术细节

### 为什么同时支持 merge 和 append？

- **append**: 简单、快速、保留所有内容（可能重复）
- **merge**: 智能、去重、整合（需要 AI 处理）

**建议**：
- 补充新材料时 → 用 `append: true`
- 整理修正内容时 → 用 `merge: true`（默认）

### Token 计算

追加模式不需要 AI 处理，**不消耗 tokens**，直接保存到文件。

---

## 修复时间

- **修复完成**: 2026-03-27
- **编译完成**: 2026-03-27 01:00
- **状态**: ✅ 已编译，等待重启

---

**三个文件现在都支持追加保存，不会覆盖已有内容！**
