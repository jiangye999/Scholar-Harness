# NiceAIGC 桥接插件

> 学术论文写作项目 ↔ NiceAIGC 会员 AI 转发器

---

## 📋 功能概述

本插件实现**本地学术写作项目**与**NiceAIGC 会员 AI**之间的双向通信：

- ✅ **API 模式**：直接调用 NiceAIGC API（快速、稳定）
- ✅ **浏览器模式**：通过浏览器自动化操作 NiceAIGC 网页 UI（模拟会员操作）
- ✅ **混合模式**：优先 API，失败时自动切换到浏览器模式
- ✅ **自动转发**：捕获本地对话 → 转发至 NiceAIGC → 回传结果

---

## 🚀 快速开始

### 1. 配置

编辑 `config.json`：

```json
{
  "mode": "auto",
  "niceaigc": {
    "api_key": "your-api-key-here",
    "api_url": "https://api.niceaigc.com/v1/chat/completions",
    "login_url": "https://niceaigc.com/login",
    "chat_url": "https://niceaigc.com/chat"
  },
  "local": {
    "api_endpoint": "http://localhost:8000/api/chat",
    "output_file": "/tmp/niceaigc_response.txt"
  },
  "browser": {
    "profile": "chrome",
    "timeout_ms": 30000,
    "wait_for_response_ms": 5000
  }
}
```

### 2. 模式说明

| 模式 | 说明 | 适用场景 |
|------|------|----------|
| `api` | 直接调用 API | 有 API key，追求速度 |
| `browser` | 浏览器自动化 | 无 API，仅有会员账号 |
| `auto` | 智能切换（推荐） | 优先 API，失败时降级 |

### 3. 使用方式

#### 方式 A：作为 Python 模块调用

```python
from niceaigc_bridge import NiceAIGCBridge

bridge = NiceAIGCBridge(config_path="config.json")

# 发送消息
response = bridge.send_message("请帮我润色这段论文...")

# 输出结果
print(response)
```

#### 方式 B：命令行调用

```bash
# 单次转发
python3 bridge.py --message "请帮我润色这段论文..."

# 从文件读取输入
python3 bridge.py --input prompt.txt --output response.txt

# 指定模式
python3 bridge.py --mode browser --message "..."
```

#### 方式 C：HTTP 服务（集成到后端）

```bash
# 启动桥接服务
python3 bridge.py --serve --port 8765

# 后端调用
curl http://localhost:8765/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "请帮我润色..."}'
```

---

## 📐 架构设计

```
本地项目 ──→ bridge.py ──→ [路由选择] ──→ api_mode.py / browser_mode.py
    ↑                                        │
    │                                        ↓
    │                                   NiceAIGC
    │                              (API 或 网页 UI)
    │                                        │
    └────────────────────────────────────────┘
                    (回传结果)
```

---

## 🔍 浏览器模式工作原理

1. **登录**：自动打开 NiceAIGC 登录页面（需预先登录或使用 Cookie）
2. **导航**：打开通话页面
3. **输入**：在对话框中输入用户消息
4. **发送**：点击发送按钮或按 Enter
5. **等待**：等待 AI 生成回复
6. **提取**：截取页面快照，提取 AI 回复内容
7. **返回**：将结果回传到本地项目

---

## ⚙️ 配置项详解

### 核心配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `mode` | string | `"auto"` | 运行模式：`api` / `browser` / `auto` |
| `niceaigc.api_key` | string | `""` | NiceAIGC API Key（API 模式必需） |
| `niceaigc.api_url` | string | `""` | API 端点 URL |
| `niceaigc.login_url` | string | `""` | 登录页面 URL |
| `niceaigc.chat_url` | string | `""` | 对话页面 URL |

### 浏览器配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `browser.profile` | string | `"chrome"` | 浏览器配置：`chrome` / `openclaw` |
| `browser.timeout_ms` | number | `30000` | 页面加载超时时间 |
| `browser.wait_for_response_ms` | number | `5000` | 等待 AI 响应时间 |

### 本地配置

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `local.api_endpoint` | string | `""` | 本地项目 API 端点（回传用） |
| `local.output_file` | string | `""` | 输出文件路径（文件回传用） |

---

## 🛠️ 集成到现有项目

### 后端集成（Python）

```python
# 在你的后端 API 中添加路由
from fastapi import FastAPI
from niceaigc_bridge import NiceAIGCBridge

app = FastAPI()
bridge = NiceAIGCBridge()

@app.post("/api/chat/niceaigc")
async def chat_with_niceaigc(message: str):
    response = bridge.send_message(message)
    return {"response": response}
```

### 前端集成（JavaScript）

```javascript
// 前端直接调用桥接服务
async function sendToNiceAIGC(message) {
  const resp = await fetch('http://localhost:8765/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  const data = await resp.json();
  return data.response;
}
```

---

## ⚠️ 注意事项

1. **浏览器模式需要预先登录**：确保 Chrome 已登录 NiceAIGC 账号
2. **API 模式需要有效 Key**：联系 NiceAIGC 获取 API 访问权限
3. **会话保持**：浏览器模式使用 `profile: "chrome"` 复用现有登录状态
4. **速率限制**：避免短时间内大量请求，防止被封禁

---

## 🐛 故障排查

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| API 模式返回 401 | API Key 无效 | 检查 config.json 中的 api_key |
| 浏览器模式无法登录 | Cookie 过期 | 手动登录 NiceAIGC 后重试 |
| 响应提取失败 | 页面结构变化 | 更新 browser_mode.py 中的元素选择器 |
| 超时 | 网络慢或 AI 响应慢 | 增加 timeout_ms 和 wait_for_response_ms |

---

## 📝 更新日志

- **v0.1.0** (2026-03-24) - 初始版本，基础框架

---

*NiceAIGC 桥接插件 | 学术论文写作助手*
