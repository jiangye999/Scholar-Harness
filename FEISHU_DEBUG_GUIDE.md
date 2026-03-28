# 飞书配置调试指南

## 🔍 问题诊断步骤

### 步骤 1: 确认服务器正在运行

```bash
# Windows
netstat -ano | findstr "18789"
```

**期望输出**:
```
TCP    0.0.0.0:18789    0.0.0.0:0    LISTENING    [PID]
```

如果没有输出，说明服务器未运行，请执行：
```bash
npm start
```

---

### 步骤 2: 测试 API 端点

**方式 1: 使用浏览器开发者工具**

1. 打开 http://localhost:18789
2. 按 `F12` 打开开发者工具
3. 切换到 **Network** (网络) 标签
4. 点击 "🤖 飞书机器人配置" 按钮
5. 填写 App ID 和 App Secret
6. 点击"保存"
7. 在 Network 标签中查找 `config` 请求
8. 点击查看：
   - **Status**: 应该是 `200 OK`
   - **Response**: 应该看到 `{success: true, ...}`

**方式 2: 使用测试脚本**

```bash
# 保存服务器后运行
node test-feishu-api.js
```

**期望输出**:
```
Status: 200
✅ API endpoint is working!
```

---

### 步骤 3: 检查服务器日志

启动服务器后，观察控制台输出：

**期望看到的日志**:
```
[Feishu] WebSocket not enabled (missing FEISHU_APP_ID or FEISHU_APP_SECRET)
# 或者
[Feishu] WebSocket client started successfully
```

**配置后应该看到**:
```
[Feishu] Stopped old WebSocket client
[Feishu] WebSocket client restarted with new config
```

如果没有看到这些日志，说明：
1. API 请求没有到达服务器
2. 或者服务器代码有错误

---

### 步骤 4: 检查浏览器控制台

按 `F12` 打开开发者工具，切换到 **Console** 标签：

**可能看到的错误**:

❌ `Failed to fetch`
- 原因：服务器未运行或端口错误
- 解决：启动服务器 `npm start`

❌ `404 Not Found`
- 原因：API 端点未注册
- 解决：重新编译 `npm run build`

❌ `CORS policy`
- 原因：跨域问题（不太可能，因为是本地）
- 解决：检查服务器是否允许本地请求

---

## 🐛 常见问题排查

### 问题 1: 点击保存后没有任何反应

**可能原因**:
1. JavaScript 错误
2. 函数未定义
3. 元素 ID 错误

**排查步骤**:
1. 打开浏览器控制台（F12 → Console）
2. 查看是否有红色错误
3. 检查 `saveFeishuConfig` 函数是否存在：
   ```javascript
   // 在控制台输入
   typeof window.saveFeishuConfig
   // 应该返回 "function"
   ```

**解决方法**:
```bash
# 强制刷新浏览器清除缓存
Ctrl + Shift + R (Windows)
Cmd + Shift + R (Mac)

# 或重新编译
npm run build
```

---

### 问题 2: 显示"请求失败"

**可能原因**:
1. 服务器未启动
2. API 端点不存在
3. 路由冲突

**排查步骤**:
```bash
# 1. 检查服务器
netstat -ano | findstr "18789"

# 2. 测试 API
curl -X POST http://localhost:18789/api/feishu/config \
  -H "Content-Type: application/json" \
  -d '{"appId":"test","appSecret":"test"}'

# 3. 查看服务器日志
# 启动服务器时观察控制台
```

---

### 问题 3: 服务器日志没有任何输出

**可能原因**:
1. 请求被拦截
2. 路由未注册
3. 中间件问题

**排查步骤**:

1. **检查 API 是否注册**:
```bash
grep -n "app.post.*feishu" dist/src/server/local-server.js
```

期望输出：
```
2848:app.post("/api/feishu/config", async (req, res) => {
```

2. **检查导入是否正确**:
```bash
grep -n "require.*feishu" dist/src/server/local-server.js
```

期望输出：
```
46:const feishu_handler_1 = require("../messaging/feishu-handler");
47:const feishu_websocket_1 = require("../messaging/feishu-websocket");
```

3. **检查变量是否定义**:
```bash
grep -n "let feishuAppId" dist/src/server/local-server.js
```

期望输出：
```
2957:let feishuAppId = process.env.FEISHU_APP_ID || "";
let feishuAppSecret = process.env.FEISHU_APP_SECRET || "";
```

---

### 问题 4: 前端显示成功但后端无日志

**可能原因**:
1. 前端 fetch 成功但后端未处理
2. 日志级别设置问题
3. 异步处理延迟

**排查步骤**:

1. **检查前端请求**:
```javascript
// 在浏览器控制台
fetch('/api/feishu/config', {
  method: 'POST',
  headers: {'Content-Type': 'application/json'},
  body: JSON.stringify({appId: 'test', appSecret: 'test'})
})
.then(r => r.json())
.then(d => console.log('Response:', d))
.catch(e => console.error('Error:', e));
```

2. **查看服务器日志**:
   - 是否看到 `[Feishu]` 开头的日志
   - 是否有错误信息

3. **检查 logger 配置**:
```bash
# 查看 logger 是否正确导入
grep -n "import.*logger" dist/src/server/local-server.js
```

---

## ✅ 完整测试流程

### 1. 清理并重启
```bash
# 停止所有 node 进程
taskkill /F /IM node.exe

# 清理缓存
npm run build

# 启动服务器
npm start
```

### 2. 观察启动日志
应该看到：
```
[Feishu] WebSocket not enabled (missing FEISHU_APP_ID or FEISHU_APP_SECRET)
```

### 3. 打开浏览器
访问 http://localhost:18789

### 4. 打开开发者工具
按 `F12` → Network 标签

### 5. 配置飞书
1. 点击 "🤖 飞书机器人配置"
2. 填写：
   - App ID: `test_app_id`
   - App Secret: `test_secret`
3. 点击"保存"

### 6. 检查 Network 标签
- 应该有 `POST /api/feishu/config` 请求
- Status: `200`
- Response: `{success: true, message: "...", connected: false}`

### 7. 检查服务器日志
应该看到：
```
[Feishu] Stopped old WebSocket client
[Feishu] WebSocket client restarted with new config
```

### 8. 检查连接状态
再次点击 "🤖 飞书机器人配置"，应该看到：
- ⚠️ 未配置飞书机器人（如果配置被清除）
- 或 ✓ 已配置飞书机器人（如果保存成功）

---

## 🔧 终极解决方案

如果以上都不行，尝试：

### 1. 完全重装
```bash
# 删除构建文件
rm -rf dist

# 重新编译
npm run build

# 重启服务器
npm start
```

### 2. 检查文件完整性
```bash
# 检查源文件
ls -la src/messaging/feishu-*.ts
ls -la src/server/local-server.ts

# 检查编译文件
ls -la dist/src/messaging/feishu-*.js
ls -la dist/src/server/local-server.js
```

### 3. 查看完整错误日志
```bash
# 开启 DEBUG 模式
set DEBUG=1
npm start
```

---

## 📊 预期行为对照表

| 步骤 | 前端行为 | 后端行为 | Network | 服务器日志 |
|------|---------|---------|---------|-----------|
| 打开配置对话框 | 显示输入框 | 无 | 无 | 无 |
| 点击保存 | 发送 POST 请求 | 接收请求 | POST /api/feishu/config | 无 |
| 验证输入 | 检查非空 | 检查非空 | - | 无 |
| 保存配置 | localStorage | 更新内存变量 | Status: 200 | 无 |
| 重启 WebSocket | 无 | 停止旧连接 | - | `[Feishu] Stopped old...` |
| 启动新连接 | 无 | 启动新连接 | - | `[Feishu] WebSocket client restarted...` |
| 返回结果 | 显示成功消息 | 返回 JSON | Response: {success: true} | 无 |
| 关闭对话框 | 关闭 modal | 无 | - | 无 |

---

## 🎯 快速诊断脚本

创建文件 `diagnose-feishu.js`:

```javascript
const http = require('http');

function test(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 18789,
      path: url,
      method: method,
      headers: data ? {'Content-Type': 'application/json'} : {}
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`${method} ${url} → ${res.statusCode}`);
        try {
          console.log(JSON.parse(body));
        } catch(e) {
          console.log(body);
        }
        resolve({status: res.statusCode, data: body});
      });
    });
    
    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function diagnose() {
  console.log('=== 飞书配置诊断 ===\n');
  
  console.log('1. 测试 GET /api/feishu/status');
  await test('/api/feishu/status');
  
  console.log('\n2. 测试 POST /api/feishu/config');
  await test('/api/feishu/config', 'POST', {
    appId: 'test_id',
    appSecret: 'test_secret'
  });
  
  console.log('\n3. 再次检查状态');
  await test('/api/feishu/status');
  
  console.log('\n=== 诊断完成 ===');
}

diagnose().catch(console.error);
```

运行：
```bash
node diagnose-feishu.js
```

---

**技术支持**: sjs@cau.edu.cn  
**更新日期**: 2026-03-18
