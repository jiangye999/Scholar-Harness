# 🚀 快速开始 - NiceAIGC 桥接插件

> 5 分钟让你的 Node.js 项目接入 NiceAIGC 会员 AI

---

## 📋 前提条件

- ✅ Node.js 已安装（v16+）
- ✅ Chrome 浏览器已安装
- ✅ 已登录 NiceAIGC 会员账号
- ✅ OpenClaw 环境可用

---

## ⚡ 3 步开始

### 步骤 1: 安装依赖

```bash
cd /root/academic-writing-skills/niceaigc-bridge
npm install
```

### 步骤 2: 配置 NiceAIGC URL

编辑 `config.json`，修改 `chat_url` 为你的实际对话页面 URL：

```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://niceaigc.com/chat"  ← 改成你的 URL
  }
}
```

### 步骤 3: 测试

```bash
# 运行测试
node test.js

# 看到 "✅ 测试成功！" 即表示配置正确
```

---

## 🎯 使用方式

### 方式 A: 启动 HTTP 服务（推荐）

```bash
# 启动服务
node server.js --port 8765

# 测试
curl http://localhost:8765/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "请帮我润色这段论文..."}'
```

### 方式 B: 直接导入模块

```javascript
// 在你的 Node.js 项目中
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';

const bridge = new NiceAIGCBridge();
const response = await bridge.sendMessage('请帮我润色...');
console.log(response);
```

### 方式 C: 命令行调用

```bash
node bridge.js --message "请帮我润色这段文字..."
```

---

## 📦 文件说明

| 文件 | 说明 |
|------|------|
| `bridge.js` | 核心桥接模块 |
| `server.js` | HTTP 服务器 |
| `test.js` | 快速测试脚本 |
| `examples.js` | 使用示例 |
| `config.json` | 配置文件 |
| `NODEJS_INTEGRATION.md` | Node.js 集成指南（详细） |
| `README.md` | 完整文档 |

---

## 🔧 集成到你的项目

### 方案 1: 复制插件到你的项目

```bash
# 复制整个插件文件夹
cp -r /root/academic-writing-skills/niceaigc-bridge /your/project/
```

然后在你的代码中：

```javascript
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';
```

### 方案 2: 独立服务，HTTP 调用

保持插件在原位置，启动服务：

```bash
node /root/academic-writing-skills/niceaigc-bridge/server.js --port 8765
```

你的项目通过 HTTP 调用：

```javascript
const resp = await fetch('http://localhost:8765/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '...' })
});
```

---

## 🐛 遇到问题？

### 问题 1: 测试失败

**检查清单：**
- [ ] Chrome 浏览器是否已安装？
- [ ] 是否已登录 NiceAIGC 账号？
- [ ] `config.json` 中的 `chat_url` 是否正确？
- [ ] OpenClaw 是否正常工作？

### 问题 2: 找不到输入框/发送按钮

**解决：**
1. 手动打开 NiceAIGC 对话页面
2. 运行 `openclaw browser --action snapshot --refs aria`
3. 查看输出中的元素列表
4. 在 `bridge.js` 中调整 `identifyElements` 方法

### 问题 3: 响应提取不完整

**解决：**
1. 编辑 `config.json`
2. 增加 `browser.wait_for_response_ms` 到 10000 或更高
3. 重试

---

## 📖 下一步

1. **查看示例** - `node examples.js`
2. **阅读集成指南** - `NODEJS_INTEGRATION.md`
3. **开始集成** - 选择适合你的方案

---

## 💡 典型应用场景

| 场景 | 推荐方案 |
|------|----------|
| 论文润色 | HTTP 服务 + `/api/polish` 端点 |
| 学术翻译 | HTTP 服务 + `/api/translate` 端点 |
| 内容扩展 | 直接导入模块 |
| 批量处理 | HTTP 服务 + `/chat/batch` 端点 |
| 快速测试 | 命令行调用 |

---

*NiceAIGC 桥接插件 v0.1.0 | 2026-03-24*
