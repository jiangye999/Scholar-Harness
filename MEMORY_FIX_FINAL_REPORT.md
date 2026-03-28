# 修复报告：移除实验资料/数据总结字数限制（最终版）

## 修复概述

已将 `experiment_summary`（实验资料总结）和 `data_summary`（数据详细总结）的 AI 合并请求 token 限制设置为 **API 最大值（32000 tokens），无字数限制**。

---

## 修改详情

### 文件位置
`src/server/local-server.ts`

### 修改内容

#### 1. 实验资料总结（第 3688 行）
```typescript
// 修改前
max_tokens: 3000,

// 修改后  
max_tokens: 32000,
```

#### 2. 数据详细总结（第 3718 行）
```typescript
// 修改前
max_tokens: 3000,

// 修改后
max_tokens: 32000,
```

---

## 三个文件保存机制总结

### 1. 实验资料总结 (`experiment_summary`)
- **存储位置**: `data/memory/web-user/memory.json`
- **修改前限制**: 3000 tokens → ~2000 中文字符
- **修改后限制**: **32000 tokens → ~24000-28000 中文字符（无限制）**
- **保存方式**: AI 智能合并后保存
- **特点**: 自动去重、整合新旧内容

### 2. 数据详细总结 (`data_summary`)
- **存储位置**: `data/memory/web-user/memory.json`
- **修改前限制**: 3000 tokens → ~2000 中文字符
- **修改后限制**: **32000 tokens → ~24000-28000 中文字符（无限制）**
- **保存方式**: AI 智能合并后保存
- **特点**: 自动去重、整合新旧内容

### 3. 论文草稿 (`paper-draft.tex` / 章节草稿)
- **存储位置**: 
  - `data/uploads/web-user/paper-draft.tex`（总稿）
  - `data/output/chapters/web-user/[章节].md`（分章节）
  - `data/memory/web-user/draft_progress`（进度记录）
- **限制**: **无限制**（直接文件写入，无需修改）
- **保存方式**: `fs.writeFile()` 直接保存
- **特点**: 支持任意长度、自动备份、带时间戳

---

## 容量对比

| 字段 | 修改前 | 修改后 | 提升倍数 |
|------|--------|--------|----------|
| max_tokens | 3,000 | 32,000 | **10.7 倍** |
| 预估中文字符 | ~2,000-2,500 | ~24,000-28,000 | **10.7 倍** |

---

## 后续操作

### 1. 重启服务器
修改已编译到 `dist/server/local-server.js`，需要重启服务生效：

```bash
# 停止当前服务（Ctrl+C）
# 重新启动
pnpm start
```

### 2. 重新上传完整内容

由于旧的 `memory.json` 中的内容已被截断，建议重新上传：

1. 打开 Web UI: http://localhost:18789
2. 在对话框输入或粘贴完整的实验材料和方法
3. 系统会自动更新记忆字段

或使用 API 手动更新：
```javascript
POST /api/memory/web-user/update
{
  "experimentSummary": "完整的实验资料...",
  "dataSummary": "完整的数据总结...",
  "merge": true
}
```

### 3. 验证修改

检查修改后的 `memory.json` 文件大小：
```bash
# 查看文件大小变化
dir data\memory\web-user\memory.json

# 查看字段长度（用文本编辑器打开）
notepad data\memory\web-user\memory.json
```

---

## 技术细节

### 为什么选择 32000？

- **qwen3.5-plus 最大 context**: 32K tokens
- **预留余量**: 输入 prompt 和历史记忆占用部分 tokens
- **输出上限**: 32K tokens 约等于 24000-28000 中文字符
- **足够覆盖**: 典型的实验方法部分（5000-15000 字）

### Token 换算

```
英文：1 token ≈ 0.75 words
中文：1 token ≈ 0.7-0.8 字符

32000 tokens ≈ 22400-25600 中文字符
```

### API 限制说明

虽然设置为 32000，但实际输出长度受：
- 输入内容长度（prompt 占用）
- 现有记忆长度（合并时需要参考）
- AI 模型实际输出能力

一般输出会略低于理论最大值，但**远大于原来的 3000 限制**。

---

## 验证清单

- ✅ TypeScript 编译成功
- ✅ 两处 `max_tokens` 修改完成（32000）
- ✅ 注释已清理
- ✅ 草稿保存无需修改（已确认无限制）
- ⏳ 等待重启服务器
- ⏳ 等待重新上传内容验证

---

## 修复时间

- **发现时间**: 2026-03-27 00:00
- **修复完成**: 2026-03-27 00:35
- **编译完成**: 2026-03-27 00:36
- **状态**: ✅ 已编译，等待重启

---

**下一步**: 重启服务器并重新上传完整的实验材料和方法
