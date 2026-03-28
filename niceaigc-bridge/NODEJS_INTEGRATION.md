# NiceAIGC 桥接插件 - Node.js 集成指南

> 专为 Node.js 后端项目设计的集成方案

---

## 📦 快速开始（3 步）

### 步骤 1: 安装依赖

```bash
cd /root/academic-writing-skills/niceaigc-bridge

# 安装 Node.js 依赖
npm install
```

### 步骤 2: 配置 NiceAIGC URL

编辑 `config.json`：

```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://niceaigc.com/chat"  ← 修改为你的实际 URL
  },
  ...
}
```

### 步骤 3: 测试

```bash
# 测试连接
node test.js

# 运行示例
node examples.js 1

# 启动 HTTP 服务
node server.js --port 8765
```

---

## 🔌 集成到你的 Node.js 后端

### 方案 A: 直接导入模块（推荐）

```javascript
// app.js - 你的 Express/Koa 后端
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';

const bridge = new NiceAIGCBridge();

// API 端点：论文润色
app.post('/api/polish', async (req, res) => {
  const { text } = req.body;
  
  try {
    const message = `请帮我润色以下学术文本，使其更加专业和流畅：\n\n${text}`;
    const response = await bridge.sendMessage(message);
    
    res.json({
      success: true,
      original: text,
      polished: response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API 端点：学术问答
app.post('/api/ask', async (req, res) => {
  const { question } = req.body;
  
  try {
    const message = `请作为学术论文编辑专家回答以下问题：\n\n${question}`;
    const response = await bridge.sendMessage(message);
    
    res.json({
      success: true,
      question,
      answer: response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### 方案 B: 独立 HTTP 服务（微服务架构）

启动桥接服务：

```bash
node server.js --port 8765
```

你的后端调用：

```javascript
// 在你的后端中
async function callNiceAIGC(message) {
  const response = await fetch('http://localhost:8765/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  
  const data = await response.json();
  
  if (data.success) {
    return data.response;
  } else {
    throw new Error(data.error);
  }
}

// 使用
const polished = await callNiceAIGC('请润色这段文字...');
```

### 方案 C: 命令行调用（简单场景）

```javascript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function polishWithNiceAIGC(text) {
  const escapedText = text.replace(/"/g, '\\"');
  
  const { stdout } = await execAsync(
    `node /root/academic-writing-skills/niceaigc-bridge/bridge.js --message "${escapedText}"`
  );
  
  // 解析输出获取 AI 响应
  const match = stdout.match(/AI 响应：([\s\S]*)/);
  return match ? match[1].trim() : '';
}
```

---

## 🎯 完整项目示例

### 项目结构

```
your-project/
├── app.js                 # 主后端应用
├── package.json
└── niceaigc-bridge/       # 桥接插件（复制过来）
    ├── bridge.js
    ├── config.json
    └── ...
```

### 完整后端代码

```javascript
// app.js
import express from 'express';
import cors from 'cors';
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 初始化桥接器
const bridge = new NiceAIGCBridge();

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'academic-writing' });
});

/**
 * POST /api/polish
 * 论文润色
 */
app.post('/api/polish', async (req, res) => {
  const { text, tone = 'academic' } = req.body;
  
  if (!text || text.length < 10) {
    return res.status(400).json({ 
      success: false, 
      error: '请输入至少 10 个字符的文本' 
    });
  }
  
  try {
    const toneMap = {
      'academic': '学术化、专业化',
      'concise': '简洁明了',
      'detailed': '详细展开',
      'native': '地道英语'
    };
    
    const style = toneMap[tone] || toneMap.academic;
    const message = `请帮我润色以下学术文本，使其更加${style}：\n\n${text}`;
    
    console.log(`[API] 收到润色请求 | 长度：${text.length}`);
    
    const response = await bridge.sendMessage(message);
    
    res.json({
      success: true,
      original: text,
      polished: response,
      tone,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[API] 错误：${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/translate
 * 学术翻译
 */
app.post('/api/translate', async (req, res) => {
  const { text, from = 'zh', to = 'en' } = req.body;
  
  if (!text) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少 text 参数' 
    });
  }
  
  try {
    const langMap = { 'zh': '中文', 'en': '英语' };
    const message = `请将以下${langMap[from]}学术文本翻译成${langMap[to]}，保持学术风格和专业术语准确：\n\n${text}`;
    
    const response = await bridge.sendMessage(message);
    
    res.json({
      success: true,
      original: text,
      translated: response,
      from,
      to,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/expand
 * 内容扩展
 */
app.post('/api/expand', async (req, res) => {
  const { outline, targetWords = 500 } = req.body;
  
  if (!outline) {
    return res.status(400).json({ 
      success: false, 
      error: '缺少 outline 参数' 
    });
  }
  
  try {
    const message = `请根据以下大纲扩展成一段完整的学术文本，目标字数约${targetWords}字：\n\n${outline}`;
    
    const response = await bridge.sendMessage(message);
    
    res.json({
      success: true,
      outline,
      expanded: response,
      targetWords,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/batch
 * 批量处理
 */
app.post('/api/batch', async (req, res) => {
  const { tasks } = req.body;
  
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'tasks 必须是非空数组' 
    });
  }
  
  try {
    const results = [];
    
    for (const task of tasks) {
      try {
        const response = await bridge.sendMessage(task.message);
        results.push({
          id: task.id,
          success: true,
          response
        });
      } catch (error) {
        results.push({
          id: task.id,
          success: false,
          error: error.message
        });
      }
      
      // 延迟避免请求过快
      await bridge.sleep(1000);
    }
    
    res.json({
      success: true,
      results,
      total: tasks.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`🚀 学术写作服务运行在 http://localhost:${PORT}`);
  console.log('');
  console.log('可用端点:');
  console.log('  POST /api/polish    - 论文润色');
  console.log('  POST /api/translate - 学术翻译');
  console.log('  POST /api/expand    - 内容扩展');
  console.log('  POST /api/batch     - 批量处理');
  console.log('  GET  /health        - 健康检查');
});
```

---

## 📝 前端调用示例

### React 组件

```jsx
// PolishCard.jsx
import { useState } from 'react';

export default function PolishCard() {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handlePolish = async () => {
    if (!input.trim()) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const resp = await fetch('http://localhost:3000/api/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input, tone: 'academic' })
      });
      
      const data = await resp.json();
      
      if (data.success) {
        setOutput(data.polished);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="polish-card">
      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="输入要润色的文本..."
        rows={6}
      />
      
      <button onClick={handlePolish} disabled={loading}>
        {loading ? '润色中...' : '润色'}
      </button>
      
      {error && <div className="error">{error}</div>}
      
      {output && (
        <div className="output">
          <h3>润色后:</h3>
          <div>{output}</div>
        </div>
      )}
    </div>
  );
}
```

### Vue 组件

```vue
<template>
  <div class="polish-card">
    <textarea v-model="input" placeholder="输入要润色的文本..." rows="6" />
    
    <button @click="handlePolish" :disabled="loading">
      {{ loading ? '润色中...' : '润色' }}
    </button>
    
    <div v-if="error" class="error">{{ error }}</div>
    
    <div v-if="output" class="output">
      <h3>润色后:</h3>
      <div>{{ output }}</div>
    </div>
  </div>
</template>

<script>
export default {
  data() {
    return {
      input: '',
      output: '',
      loading: false,
      error: null
    }
  },
  methods: {
    async handlePolish() {
      if (!this.input.trim()) return;
      
      this.loading = true;
      this.error = null;
      
      try {
        const resp = await fetch('http://localhost:3000/api/polish', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: this.input, tone: 'academic' })
        });
        
        const data = await resp.json();
        
        if (data.success) {
          this.output = data.polished;
        } else {
          this.error = data.error;
        }
      } catch (err) {
        this.error = err.message;
      } finally {
        this.loading = false;
      }
    }
  }
}
</script>
```

---

## 🐛 常见问题

### Q1: 浏览器模式无法打开页面

**解决：**
1. 确保 Chrome 已安装
2. 确保已登录 NiceAIGC 账号
3. 检查 `config.json` 中的 `chat_url` 是否正确

### Q2: 响应提取失败

**解决：**
1. 手动打开 NiceAIGC 页面查看结构
2. 运行 `openclaw browser --action snapshot --refs aria` 查看元素
3. 修改 `bridge.js` 中的 `identifyElements` 方法

### Q3: 请求超时

**解决：**
1. 增加 `config.json` 中的 `wait_for_response_ms`
2. 检查网络连接
3. 确认 NiceAIGC 服务正常

---

## 📞 获取帮助

1. 运行 `node examples.js` 查看示例
2. 查看 `README.md` 完整文档
3. 检查 `config.json` 配置

---

*NiceAIGC 桥接插件 v0.1.0 - Node.js 版 | 2026-03-24*
