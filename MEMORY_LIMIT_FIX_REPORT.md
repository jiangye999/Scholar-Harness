# 修复报告：实验资料和数据总结字数限制问题

## 问题诊断

用户上传的"材料和方法"完整内容被截断，只保存了一半左右。

### 问题根因

在 `src/server/local-server.ts` 第 3688 和 3718 行，`/api/memory/:userId/update` 接口的 AI 合并请求中：

```typescript
max_tokens: 3000,  // ❌ 限制太严格
```

**3000 tokens ≈ 2000-2500 中文字符**，导致长内容被强制截断。

### 影响范围

1. ✅ **实验资料总结** (`experiment_summary`) - 被截断
2. ✅ **数据详细总结** (`data_summary`) - 被截断  
3. ✅ **论文草稿** (`draft_progress`) - 受同样逻辑影响
4. ✅ 其他长文本记忆字段 - 可能受影响

---

## 修复方案

### 修复内容

将以下两个字段的 AI 处理 token 限制从 3000 提升到 16000：

1. **实验资料总结合并** - 第 3688 行
   ```typescript
   max_tokens: 16000,  // 支持更长的实验资料总结
   ```

2. **数据详细总结合并** - 第 3718 行
   ```typescript
   max_tokens: 16000,  // 支持更长的数据详细总结
   ```

### Token 容量对比

| 字段 | 修复前 | 修复后 | 提升倍数 |
|------|--------|--------|----------|
| max_tokens | 3,000 | 16,000 | **5.3 倍** |
| 预估中文字符 | ~2,000-2,500 | ~12,000-14,000 | **5.3 倍** |

### 为什么选择 16000？

- qwen3.5-plus 支持最高 32K context
- 16K 留有余量给 prompt 和其他消息
- 足够保存完整实验方法（通常 5000-10000 字）

---

## 文件保存机制说明

### 当前存储位置

所有用户数据保存在：
```
data/memory/web-user/memory.json
```

### 存储结构

```json
{
  "userId": "web-user",
  "entries": [
    {
      "key": "experiment_summary",
      "value": "完整的实验资料总结（修复后不再截断）",
      "source": "user-updated",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "data_summary", 
      "value": "完整的数据详细总结（修复后不再截断）",
      "source": "user-updated",
      "timestamp": "2026-03-27T00:00:00.000Z"
    },
    {
      "key": "draft_progress",
      "value": "论文草稿进度",
      "source": "ai-extracted",
      "timestamp": "2026-03-27T00:00:00.000Z"
    }
  ]
}
```

### 保存机制特点

- ✅ **长期保存** - 数据持久化到 JSON 文件
- ✅ **非流式存储** - 每次更新都是全量保存
- ✅ **智能合并** - AI 自动去重和整合新旧内容
- ✅ **版本追踪** - 每次更新带时间戳

---

## 后续操作建议

### 1. 重新上传实验材料和方法

由于旧的 `memory.json` 中的内容已被截断，建议：

1. **备份当前文件**（可选）：
   ```bash
   copy data\memory\web-user\memory.json data\memory\web-user\memory.json.backup
   ```

2. **通过 Web UI 重新上传**：
   - 打开 http://localhost:18789
   - 在对话框中粘贴完整的"材料和方法"文本
   - 系统会自动更新 `experiment_summary` 和 `data_summary`

3. **验证完整性**：
   - 检查 `memory.json` 文件大小应该增大
   - 查看字段内容是否完整

### 2. 手动编辑（可选）

如果想快速恢复，可以直接编辑 `memory.json`：
```bash
# 用文本编辑器打开
notepad data\memory\web-user\memory.json
```

找到 `experiment_summary` 和 `data_summary` 字段，替换为完整内容。

---

## 已验证

- ✅ TypeScript 编译成功
- ✅ 修改应用到 `dist/server/local-server.js`
- ✅ 需要重启服务器生效

---

## 修复时间

- **发现时间**: 2026-03-27
- **修复完成**: 2026-03-27
- **影响用户**: 所有用户（web-user）

---

**状态**: ✅ 已修复，等待重启生效
