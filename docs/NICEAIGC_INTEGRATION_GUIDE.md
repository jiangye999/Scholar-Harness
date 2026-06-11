# NiceAIGC 集成使用说明

## 问题说明

NiceAIGC 网站 (https://niceaigc.com/chat) 具有反自动化检测机制，使用 Playwright 自动化浏览器时会被检测并导致页面崩溃。

## 解决方案

### 方案 1: 手动登录 + Service 模式（推荐）

1. **启动 Service 模式**：
```bash
cd openclaw
node index.js serve --url "https://niceaigc.com/chat" --port 19222
```

2. **手动登录**：
   - 浏览器会自动打开 NiceAIGC 页面
   - 如果页面崩溃，刷新页面（F5）
   - 手动登录你的 NiceAIGC 账号
   - 登录后，浏览器状态会自动保存

3. **使用 Service**：
```bash
# 发送聊天消息
curl http://localhost:19222/chat \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"message": "你好，请帮我润色这段文字", "wait": 30000}'
```

### 方案 2: 使用 Playwright 的持久化上下文

Playwright 支持持久化浏览器上下文，可以保存登录状态：

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launchPersistentContext('./user-data', {
    headless: false,
    channel: 'chrome'
  });
  
  const page = browser.pages()[0];
  await page.goto('https://niceaigc.com/chat');
  
  // 手动登录后，状态会保存在 ./user-data 目录
})();
```

### 方案 3: 使用现有登录的 Chrome

1. 找到你已登录 NiceAIGC 的 Chrome 用户数据目录：
   - Windows: `%LOCALAPPDATA%\Google\Chrome\User Data`
   - Mac: `~/Library/Application Support/Google/Chrome`
   - Linux: `~/.config/google-chrome`

2. 复制用户数据到 openclaw 目录：
```bash
cp -r "/path/to/Chrome/User Data/Default" ./openclaw/browser-data/chrome
```

3. 修改 openclaw/index.js 使用该数据目录

## 配置文件

`src/bridge/niceaigc/config.json`:
```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://niceaigc.com/chat"
  },
  "browser": {
    "profile": "chrome",
    "timeout_ms": 300000,
    "wait_for_response_ms": 240000
  },
  "service": {
    "enabled": true,
    "port": 19222
  }
}
```

## API 端点

### Service 模式 (`node index.js serve`)

- `GET /health` - 健康检查
- `POST /chat` - 发送聊天消息
  ```json
  {
    "message": "你的消息",
    "wait": 30000,  // 等待响应时间（毫秒）
    "stream": false, // 是否流式响应
    "newPage": false // 是否打开新页面
  }
  ```
- `POST /navigate` - 导航到新 URL
  ```json
  {
    "url": "https://niceaigc.com/chat"
  }
  ```

## 常见问题

### Q: 页面一直崩溃怎么办？

A: NiceAIGC 检测到了自动化工具。解决方法：
1. 使用 Service 模式
2. 手动刷新页面并登录
3. 登录后状态会保存，下次可以使用

### Q: 如何查看浏览器状态？

A: 浏览器状态保存在 `openclaw/browser-state.json` 文件中。

### Q: 响应提取不准确？

A: NiceAIGC 的页面结构可能会变化，需要更新 `openclaw/index.js` 中的选择器：

```javascript
const inputSelectors = [
  'div[contenteditable="true"]',
  'textarea[placeholder*="输入"]',
  // 添加新的选择器
];

const responseSelectors = [
  '.message-content',
  // 添加新的选择器
];
```

## 推荐使用方式

**生产环境**：使用 Service 模式 + 手动登录
```bash
# 1. 启动服务
cd openclaw
node index.js serve

# 2. 在浏览器中手动登录 NiceAIGC
# 3. 服务会自动保存登录状态
# 4. 通过 API 调用
```

**开发测试**：使用命令行模式
```bash
cd openclaw
node index.js browser --action open --url "https://niceaigc.com/chat" --keep-alive
# 手动登录后，执行其他操作
```