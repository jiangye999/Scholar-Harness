# Scholar Harness 配置能力图

## 模型与检索

| 能力 | 必填 | 保存与验证 | 常见问题 |
| --- | --- | --- | --- |
| 小牛马 | OpenAI 兼容 API URL、API Key、Model ID | 小牛马引导配置；保存前请求模型列表验证 | 把官网地址当 API URL；模型展示名不是 Model ID |
| 大牛马 | OpenAI 兼容 API URL、API Key、Model ID | 大牛马引导配置；保存前请求模型列表验证 | OpenRouter 模型通常包含供应商前缀 |
| Embedding | API URL、API Key、Embedding Model ID、启用开关 | Embedding 引导配置；测试向量接口后保存 | 把聊天模型填成 Embedding 模型 |
| Codex CLI | 可执行命令、模型、Reasoning Effort | 配置中心自动检测版本和模型 | 命令不在 PATH；路径指向目录而非可执行文件 |

## 本机运行时

| 能力 | 用途 | 检测方式 |
| --- | --- | --- |
| Rscript | Meta 分析、统计模型、论文级作图 | 自动检测；也可填写 `Rscript.exe` |
| Python | 数据处理、脚本运行、科研计算 | 自动检测；也可填写 `python.exe` |
| OfficeCLI | Word、Excel、PPT 读取和处理 | 自动检测；也可填写 `officecli` 可执行文件 |

## Skill 与 MCP

- Skill 是任务规则与工作流。系统会把名称和用途放入目录，AI 按意图选择并在需要时加载。
- “持续使用 Skill”会把规则附加到之后每轮主聊天；只给确实需要长期保持的风格或约束勾选。
- MCP 是可调用工具。安装不等于可用；必须完成启动、工具发现并启用。
- MCP 权限分为只读、联网、文件写入和命令执行。后二者安装前必须明确确认。

## 推荐的最小组合

- 论文问答/改写：小牛马。
- 完整论文规划与审稿：小牛马 + 大牛马 + 相关写作 Skill。
- 大批文献语义检索：小牛马 + Embedding + RIS/TXT 题录。
- PDF 证据库：小牛马 + PDF Wiki；复杂批处理可加 Codex。
- Meta 分析：小牛马 + R；图像取数按需加 Python/GetData。
- Word/Excel/PPT 自动处理：小牛马 + OfficeCLI。

## 密钥安全

- 只在带 `type=password` 的本机配置框粘贴 API Key。
- 不把 Key 放进聊天、截图、日志、Skill、工作目录文件或问题复现材料。
- 配置接口的读取响应只返回 `hasApiKey`，不应回传明文 Key。
- 更换或泄露 Key 时，应在供应商后台撤销旧 Key，再在 Scholar Harness 更新。
