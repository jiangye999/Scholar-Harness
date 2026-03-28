# AI Agent 配置功能使用说明

## 🎯 功能说明

在 Web UI 界面左下角新增了 **🎯 AI Agent 配置** 按钮，允许你分别配置一级 AI 和二级 AI 使用的模型。

---

## 📍 入口位置

**左侧边栏底部** → **🎯 AI Agent 配置**

---

## 🤖 两级 AI 架构

### 一级 AI（规划师）
**职责**：
- 理解用户需求
- 生成写作指导（skill）
- 质量检查
- 对话决策

**配置项**：
- `一级 AI 模型`：默认 `qwen3.5-plus`

---

### 二级 AI（执行者）
**职责**：
- 根据一级 AI 生成的指导进行写作
- 智能文献引用
- LaTeX 格式输出

**配置项**（按章节）：
- `Introduction（引言）`：默认 `gpt-4o`
- `Methods（方法）`：默认 `gpt-4o`
- `Results（结果）`：默认 `gpt-4o`
- `Discussion（讨论）`：默认 `claude-sonnet-4-5`
- `Abstract（摘要）`：默认 `gpt-4o`
- `Conclusion（结论）`：默认 `claude-sonnet-4-5`

---

## 🔧 配置步骤

### 1️⃣ 打开配置对话框

点击左侧边栏底部的 **🎯 AI Agent 配置** 按钮

### 2️⃣ 配置一级 AI

在 **一级 AI（规划师）** 输入框中填写模型名称：
- 例如：`qwen3.5-plus`、`claude-sonnet-4-5`、`gpt-4o`

### 3️⃣ 配置二级 AI

在 **二级 AI（执行者）- 按章节** 区域，为不同章节配置不同模型：
- 逻辑性强、需要批判性思维的章节（如 Discussion）→ 推荐 `claude-sonnet-4-5`
- 结构化、精确描述的章节（如 Methods）→ 推荐 `gpt-4o`
- 中文写作 → 推荐 `qwen3.5-plus`

### 4️⃣ 保存配置

点击 **保存** 按钮

---

## 💡 推荐配置方案

### 方案一：经济实用型（省钱）

所有 AI 都使用同一个模型：
- 一级 AI：`qwen3.5-plus`
- 二级 AI（所有章节）：`qwen3.5-plus`

**优点**：成本低  
**缺点**：某些任务可能不是最优表现

---

### 方案二：最优性能型（烧钱）

每个 AI 使用最适合的模型：
- 一级 AI：`claude-sonnet-4-5`（理解能力强）
- 二级 AI - Introduction：`claude-sonnet-4-5`（逻辑清晰）
- 二级 AI - Methods：`gpt-4o`（精确描述）
- 二级 AI - Results：`gpt-4o`（数据准确）
- 二级 AI - Discussion：`claude-sonnet-4-5`（批判性思维）
- 二级 AI - Abstract：`gpt-4o`（简洁概括）
- 二级 AI - Conclusion：`claude-sonnet-4-5`（总结升华）

**优点**：每个环节都是最优表现  
**缺点**：成本高

---

### 方案三：平衡型（推荐）

性价比最高的配置：
- 一级 AI：`qwen3.5-plus`（够用）
- 二级 AI - Introduction/Discussion/Conclusion：`claude-sonnet-4-5`
- 二级 AI - Methods/Results/Abstract：`gpt-4o`

**优点**：关键环节用好模型，成本可控  
**缺点**：需要配置多个模型

---

## 📝 注意事项

1. **配置保存在浏览器**
   - 配置存储在 localStorage
   - 清除浏览器缓存会重置配置
   - 不同浏览器需要分别配置

2. **刷新页面生效**
   - 保存配置后，刷新页面生效
   - 系统会提示"AI Agent 配置已保存。刷新页面后生效。"

3. **模型名称要准确**
   - 必须填写 API 提供商支持的模型名称
   - 错误名称会导致 API 调用失败
   - 常见模型：`qwen3.5-plus`、`gpt-4o`、`claude-sonnet-4-5`

4. **一级 AI 模型不能为空**
   - 保存时会验证
   - 为空会弹出提示

---

## 🧪 测试配置

配置完成后，可以测试：

1. **测试一级 AI**
   - 提问："我想写一篇关于 N2O 排放的论文"
   - 观察 AI 是否能理解你的需求并给出规划建议

2. **测试二级 AI**
   - 进入写作阶段后
   - 观察生成的内容是否符合预期

3. **检查日志**
   - 服务器日志会显示使用的模型
   - `[Chat] User: xxx, Model: qwen3.5-plus, Agent: {...}`

---

## 🔄 恢复默认配置

如果想恢复默认配置：

1. 打开 **🎯 AI Agent 配置**
2. 手动修改为默认值：
   - 一级 AI：`qwen3.5-plus`
   - 二级 AI - Introduction：`gpt-4o`
   - 二级 AI - Methods：`gpt-4o`
   - 二级 AI - Results：`gpt-4o`
   - 二级 AI - Discussion：`claude-sonnet-4-5`
   - 二级 AI - Abstract：`gpt-4o`
   - 二级 AI - Conclusion：`claude-sonnet-4-5`
3. 点击 **保存**

或者：
1. 打开浏览器开发者工具（F12）
2. Console 中执行：
   ```javascript
   localStorage.removeItem('scholarclaw_agent_config');
   location.reload();
   ```

---

## 📊 配置示例

### 示例配置文件（JSON 格式）

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

---

## 🆘 常见问题

### Q1：配置后没有效果？
**A**：刷新页面后生效。如果还是没有效果，检查：
- 配置是否正确保存（重新打开配置查看）
- 浏览器缓存是否清除
- 服务器是否重启

### Q2：API 调用失败？
**A**：检查：
- 模型名称是否正确
- API Key 是否有效
- 该模型是否在你的 API 账户中可用

### Q3：可以只为某些章节配置不同模型吗？
**A**：可以！你可以：
- 所有章节都用同一个模型
- 或者每个章节用不同模型
- 完全自由配置

### Q4：配置会同步到其他设备吗？
**A**：不会。配置存储在当前浏览器的 localStorage 中，不同设备/浏览器需要分别配置。

---

**添加时间**：2026-03-10  
**版本**：v1.0.0
