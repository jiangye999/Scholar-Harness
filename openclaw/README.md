# OpenClaw

浏览器自动化工具，用于 AI 聊天桥接服务。

## 安装

```bash
cd openclaw
npm install
```

## 配置

URL 从以下位置读取（优先级从高到低）：

1. **环境变量**: 设置 `CHAT_URL` 环境变量
2. **配置文件**: `src/bridge/chat-bridge/config.json` 中的 `chat.chat_url`
3. **命令行参数**: 使用 `--url` 参数

**推荐方式**: 在聊天界面左下角的 AI 聊天桥接配置中设置 URL，openclaw 会自动读取。

## 使用

```bash
# 打开浏览器（URL 从配置读取）
openclaw browser --action open --profile chrome

# 或指定 URL
openclaw browser --action open --url "YOUR_CHAT_URL" --profile chrome

# 填充文本
openclaw browser --action fill --selector "textarea" --text "你好"

# 点击按钮
openclaw browser --action click --selector "button[type=submit]"

# 获取页面快照
openclaw browser --action snapshot --refs aria

# 关闭浏览器
openclaw close

# 启动 HTTP 服务（端口 19222）
openclaw serve
```

## HTTP 服务

启动服务后，可通过 HTTP API 控制：

```bash
# 启动服务
openclaw serve

# 打开浏览器
curl -X POST http://localhost:19222/open -H "Content-Type: application/json" -d '{"url":"YOUR_CHAT_URL"}'

# 发送消息
curl -X POST http://localhost:19222/chat -H "Content-Type: application/json" -d '{"message":"你好","url":"YOUR_CHAT_URL"}'
```

## 依赖

- Node.js 16+
- Playwright
- Chrome 或 Edge 浏览器