# NiceAIGC 桥接插件 - 完整使用指南

> 让你的 Node.js 项目接入 NiceAIGC 会员 AI，支持 API/浏览器双模式

---

## 📦 插件概览

**位置：** `/root/academic-writing-skills/niceaigc-bridge/`

**功能：**
- ✅ 浏览器自动化模式（通过 OpenClaw browser 工具）
- ✅ HTTP 服务（REST API）
- ✅ 命令行工具
- ✅ Node.js 模块导入
- ✅ 批量处理支持

**适用场景：**
- 论文润色
- 学术翻译
- 内容扩展
- 学术问答
- 批量文本处理

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd /root/academic-writing-skills/niceaigc-bridge
npm install
```

### 2. 配置

编辑 `config.json`：

```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://niceaigc.com/chat"  ← 你的对话页面 URL
  }
}
```

### 3. 测试

```bash
node test.js
```

看到 `✅ 测试成功！` 即表示配置正确。

---

## 📖 文档导航

| 文档 | 用途 |
|------|------|
| **QUICKSTART.md** | 5 分钟快速开始 |
| **NODEJS_INTEGRATION.md** | Node.js 集成指南（详细） |
| **README.md** | Python 版本完整文档 |
| **INTEGRATION.md** | Python 集成指南 |

---

## 💻 使用方式

### 方式 1: HTTP 服务（推荐）

```bash
# 启动服务
node server.js --port 8765

# 调用
curl http://localhost:8765/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "请帮我润色这段论文..."}'
```

**响应：**
```json
{
  "success": true,
  "response": "AI 的回复内容...",
  "timestamp": "2026-03-24T01:10:00.000Z"
}
```

### 方式 2: Node.js 模块导入

```javascript
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';

const bridge = new NiceAIGCBridge();
const response = await bridge.sendMessage('请帮我润色...');
```

### 方式 3: 命令行工具

```bash
# 直接发送消息
node cli.js "请帮我润色这段文字..."

# 从文件读取，保存到文件
node cli.js --input prompt.txt --output response.txt

# 启动 HTTP 服务
node cli.js --serve --port 8765

# 测试连接
node cli.js --test
```

---

## 🔌 集成示例

### Express 后端集成

```javascript
// app.js
import express from 'express';
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';

const app = express();
app.use(express.json());

const bridge = new NiceAIGCBridge();

app.post('/api/polish', async (req, res) => {
  const { text } = req.body;
  const message = `请帮我润色以下学术文本：\n\n${text}`;
  
  const response = await bridge.sendMessage(message);
  
  res.json({
    success: true,
    original: text,
    polished: response
  });
});

app.listen(3000, () => {
  console.log('服务运行在 http://localhost:3000');
});
```

### React 前端调用

```jsx
async function polishText(text) {
  const resp = await fetch('http://localhost:8765/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text })
  });
  
  const data = await resp.json();
  return data.response;
}
```

---

## 📁 文件结构

```
niceaigc-bridge/
├── QUICKSTART.md            # 快速开始指南
├── NODEJS_INTEGRATION.md    # Node.js 集成指南
├── README.md                # Python 版本文档
├── INTEGRATION.md           # Python 集成指南
├── config.json              # 配置文件
├── bridge.js                # Node.js 核心模块 ⭐
├── bridge.py                # Python 核心模块
├── server.js                # HTTP 服务器
├── cli.js                   # 命令行工具
├── test.js                  # 测试脚本
├── examples.js              # Node.js 示例
├── examples.py              # Python 示例
├── package.json             # Node.js 依赖
└── __init__.py              # Python 包入口
```

---

## 🎯 API 端点（HTTP 服务）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/chat` | POST | 发送消息 |
| `/chat/file` | POST | 发送消息并保存文件 |
| `/chat/batch` | POST | 批量处理 |

---

## ⚙️ 配置说明

### config.json

```json
{
  "mode": "browser",              // 运行模式：browser / auto
  "niceaigc": {
    "chat_url": "https://..."     // NiceAIGC 对话页面 URL
  },
  "local": {
    "output_file": "/tmp/..."     // 默认输出文件路径
  },
  "browser": {
    "profile": "chrome",          // 浏览器配置：chrome / openclaw
    "timeout_ms": 30000,          // 页面加载超时
    "wait_for_response_ms": 5000  // 等待 AI 响应时间
  }
}
```

---

## 🐛 故障排查

### 问题 1: 测试失败

**检查：**
- Chrome 是否已安装并登录 NiceAIGC
- `chat_url` 配置是否正确
- OpenClaw 是否正常工作

### 问题 2: 找不到输入框/发送按钮

**解决：**
1. 手动打开 NiceAIGC 页面
2. 运行 `openclaw browser --action snapshot --refs aria`
3. 查看元素列表，找到正确的 ref ID
4. 修改 `bridge.js` 中的 `identifyElements` 方法

### 问题 3: 响应提取不完整

**解决：**
- 增加 `wait_for_response_ms` 到 10000 或更高
- 检查页面结构是否变化

---

## 💡 最佳实践

1. **使用 HTTP 服务** - 便于前后端分离，支持多语言调用
2. **配置超时时间** - 根据网络情况调整 `wait_for_response_ms`
3. **批量处理加延迟** - 避免请求过快被限制
4. **错误处理** - 始终捕获异常并提供友好提示
5. **日志记录** - 记录请求和响应便于调试

---

## 📞 获取帮助

1. **快速问题** - 查看 `QUICKSTART.md`
2. **集成问题** - 查看 `NODEJS_INTEGRATION.md`
3. **运行示例** - `node examples.js`
4. **测试连接** - `node test.js`

---

## 📝 更新日志

### v0.1.0 (2026-03-24)
- ✅ 初始版本发布
- ✅ Node.js 核心模块
- ✅ HTTP 服务器
- ✅ 命令行工具
- ✅ 完整文档

---

*NiceAIGC 桥接插件 v0.1.0 | 为学术论文写作而生*
