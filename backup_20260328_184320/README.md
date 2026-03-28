# ScholarClaw + NiceAIGC 备份
备份时间: 2026-03-28 18:43

## 备份文件清单

### ScholarClaw 项目修改
1. `niceaigc-bridge.ts` - NiceAIGC 桥接适配器
   - 修复了 Windows 路径问题（使用正斜杠）
   - 增加了超时时从 error.stdout 获取响应
   - 增加 maxBuffer 到 10MB

2. `config.json` - NiceAIGC 配置文件
   - timeout_ms: 70000 (70秒总超时)
   - wait_for_response_ms: 15000 (15秒响应等待)

3. `niceaigc.ts` - API 路由
   - 处理 /api/niceaigc/chat 请求
   - 返回格式: { success: true, response: "...", provider: "niceaigc" }

### OpenClaw 项目修改
4. `openclaw_index.js` - 浏览器自动化脚本
   - 所有 console.log 改为 console.error（调试信息输出到 stderr）
   - 只保留最终响应输出到 stdout
   - 减少了各种延迟（5秒→3秒，2秒→1秒，1秒→500ms）
   - 添加了自动登录功能
   - 改进了元素检测逻辑

## 关键修复点

### 1. 路径问题
- 原问题: Windows 反斜杠在 child_process.exec 中被转义
- 修复: 使用正斜杠 E:/AI_projects/openclaw

### 2. 响应提取
- 原问题: 命令超时后 stdout 为空
- 修复: 从 error.stdout 获取已收集的输出

### 3. 输出分离
- 原问题: 调试信息和响应混在一起
- 修复: 调试信息→stderr, 响应→stdout

### 4. 自动登录
- 添加了自动检测登录状态
- 自动填写邮箱密码登录
- 自动保存登录状态

## 使用方法

1. 确保 openclaw 项目存在于 E:/AI_projects/openclaw
2. 确保已安装 Playwright: `cd E:/AI_projects/openclaw && npm install`
3. 运行 ScholarClaw: `pnpm start`
4. 在 UI 界面输入消息，系统会自动通过 NiceAIGC 处理

## 配置文件说明

### src/bridge/niceaigc/config.json
```json
{
  "mode": "browser",
  "niceaigc": {
    "chat_url": "https://node8.nice188.com/"
  },
  "browser": {
    "profile": "chrome",
    "timeout_ms": 70000,
    "wait_for_response_ms": 15000
  }
}
```

## 恢复备份

将备份文件复制回原位置：
- niceaigc-bridge.ts → src/bridge/niceaigc/
- config.json → src/bridge/niceaigc/
- niceaigc.ts → src/server/routes/
- openclaw_index.js → E:/AI_projects/openclaw/index.js

然后运行 `pnpm build` 重新构建。
