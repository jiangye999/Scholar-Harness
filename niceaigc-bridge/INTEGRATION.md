# NiceAIGC 桥接插件 - 集成指南

> 将插件集成到你的学术论文写作项目中

---

## 📦 插件文件结构

```
/root/academic-writing-skills/niceaigc-bridge/
├── README.md              # 完整文档
├── INTEGRATION.md         # 本文件（集成指南）
├── config.json            # 配置文件
├── bridge.py              # 主桥接模块
├── api_mode.py            # API 模式实现
├── browser_mode.py        # 浏览器模式实现
├── examples.py            # 使用示例
└── __init__.py            # Python 包入口
```

---

## ⚡ 5 分钟快速集成

### 步骤 1: 配置 NiceAIGC

编辑 `config.json`：

```json
{
  "mode": "auto",
  "niceaigc": {
    "api_key": "你的 API Key（如有）",
    "api_url": "https://api.niceaigc.com/v1/chat/completions",
    "login_url": "https://niceaigc.com/login",
    "chat_url": "https://niceaigc.com/chat"  ← 修改为你的实际对话页面
  },
  ...
}
```

### 步骤 2: 测试连接

```bash
cd /root/academic-writing-skills/niceaigc-bridge

# 测试 API 模式
python3 bridge.py --test

# 测试浏览器模式（确保 Chrome 已登录 NiceAIGC）
python3 bridge.py --mode browser --test

# 发送测试消息
python3 bridge.py --message "你好，请帮我润色这句话：..."
```

### 步骤 3: 集成到项目

#### 方案 A: Python 项目直接导入

```python
# 在你的项目中添加
import sys
sys.path.insert(0, '/root/academic-writing-skills/niceaigc-bridge')

from bridge import NiceAIGCBridge

bridge = NiceAIGCBridge()
response = bridge.send_message("请帮我...")
```

#### 方案 B: HTTP 服务（推荐）

```bash
# 启动桥接服务
python3 bridge.py --serve --port 8765

# 你的项目通过 HTTP 调用
curl http://localhost:8765/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "请帮我..."}'
```

#### 方案 C: 命令行调用

```bash
# 单次调用
python3 bridge.py --message "..." --output response.txt

# 从文件读取
python3 bridge.py --input prompt.txt --output response.txt
```

---

## 🔌 集成到你的前后端项目

### 后端集成（假设你用 Python/FastAPI）

```python
# main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import sys
sys.path.insert(0, '/root/academic-writing-skills/niceaigc-bridge')
from bridge import NiceAIGCBridge

app = FastAPI()

# 允许跨域（前端调用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化桥接器
bridge = NiceAIGCBridge()

@app.post("/api/niceaigc/chat")
async def chat_with_niceaigc(message: str, mode: str = "auto"):
    """调用 NiceAIGC"""
    response = bridge.send_message(message, mode=mode)
    return {"response": response, "mode": mode}

@app.post("/api/niceaigc/chat/file")
async def chat_with_file(message: str, output_path: str = "/tmp/response.txt"):
    """调用并保存结果"""
    response = bridge.send_and_save(message, output_path)
    return {"response": response, "saved_to": output_path}

# 运行：uvicorn main:app --reload --port 8000
```

### 前端集成（JavaScript/TypeScript）

```typescript
// niceaigc-client.ts
export class NiceAIGCClient {
  private baseUrl: string;
  
  constructor(baseUrl: string = 'http://localhost:8765') {
    this.baseUrl = baseUrl;
  }
  
  async chat(message: string, mode: 'api' | 'browser' | 'auto' = 'auto'): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, mode })
    });
    
    const data = await response.json();
    return data.response;
  }
  
  async chatWithFile(message: string, outputPath?: string): Promise<{response: string, savedTo: string}> {
    const response = await fetch(`${this.baseUrl}/chat/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, outputPath })
    });
    
    return response.json();
  }
}

// 使用示例
const client = new NiceAIGCClient();
const response = await client.chat("请帮我润色这段论文...");
console.log(response);
```

### 前端集成（Vue/React）

```vue
<!-- Vue 示例 -->
<template>
  <div class="chat-container">
    <textarea v-model="message" placeholder="输入要润色的内容..." />
    <button @click="sendToNiceAIGC" :disabled="loading">
      {{ loading ? '处理中...' : '发送到 NiceAIGC' }}
    </button>
    <div v-if="response" class="response">
      <h3>AI 响应:</h3>
      <div v-html="formattedResponse"></div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      message: '',
      response: '',
      loading: false
    }
  },
  computed: {
    formattedResponse() {
      return this.response.replace(/\n/g, '<br>')
    }
  },
  methods: {
    async sendToNiceAIGC() {
      this.loading = true
      try {
        const resp = await fetch('http://localhost:8765/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: this.message })
        })
        const data = await resp.json()
        this.response = data.response
      } catch (e) {
        alert('请求失败：' + e.message)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>
```

---

## 🎯 模式选择建议

| 场景 | 推荐模式 | 理由 |
|------|----------|------|
| 有 API Key | `api` | 速度快、稳定、支持多轮对话 |
| 仅有会员账号 | `browser` | 无需 API，模拟真实操作 |
| 不确定/混合 | `auto` | 智能降级，最省心 |
| 批量处理 | `api` | 浏览器模式太慢 |
| 复杂页面交互 | `browser` | API 可能不支持 |

---

## ⚙️ 高级配置

### 自定义元素选择器（浏览器模式）

如果自动识别失败，可以在 `browser_mode.py` 中修改：

```python
self.selectors = {
    'input_box': 'textarea[placeholder="输入消息"]',
    'send_button': 'button.send-btn',
    'response_area': '.assistant-message'
}
```

### 调整超时时间

```json
{
  "browser": {
    "timeout_ms": 60000,        ← 页面加载超时
    "wait_for_response_ms": 10000  ← 等待 AI 响应时间
  }
}
```

### 使用特定浏览器配置

```json
{
  "browser": {
    "profile": "chrome"    ← 使用已登录的 Chrome
    // "profile": "openclaw"  ← 使用隔离浏览器
  }
}
```

---

## 🐛 常见问题

### Q1: 浏览器模式无法识别输入框

**解决：**
1. 手动打开 NiceAIGC 对话页面
2. 运行 `openclaw browser --action snapshot --refs aria`
3. 查看输出中的元素列表
4. 找到输入框的 `ref` ID
5. 在 `browser_mode.py` 中修改默认 fallback 值

### Q2: API 模式返回 401

**解决：**
1. 检查 `config.json` 中的 `api_key` 是否正确
2. 联系 NiceAIGC 确认 API 权限
3. 检查 API URL 是否正确

### Q3: 响应提取不完整

**解决：**
1. 增加 `wait_for_response_ms`（AI 可能还在生成）
2. 修改 `_extract_response_from_snapshot` 中的识别逻辑
3. 检查页面结构是否变化

---

## 📞 获取帮助

1. 查看 `README.md` 完整文档
2. 运行 `python3 examples.py` 查看示例
3. 检查 `config.json` 配置是否正确

---

*NiceAIGC 桥接插件 v0.1.0 | 2026-03-24*
