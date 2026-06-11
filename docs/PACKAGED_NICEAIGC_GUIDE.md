# 打包后 NiceAIGC 使用指南

## 问题分析

### 为什么开发环境可以，打包后不行？

**开发环境**：
- 直接运行 Node.js，路径清晰：`E:\AI_projects\scholar-harness-1.0.0\openclaw`
- Playwright 可以正常启动浏览器
- 浏览器以开发模式运行，安全限制较少

**打包后（exe）**：
- 安装到：`C:\Program Files\Scholar Harness\`
- openclaw 在：`C:\Program Files\Scholar Harness\resources\openclaw\`
- Playwright 需要在打包环境运行
- **关键问题**：NiceAIGC 检测到自动化工具并拦截

### 具体表现

1. 浏览器窗口弹出 ✅
2. 页面空白或崩溃 ❌
3. 错误信息：Page crashed

## 解决方案

### 方案 1：手动打开浏览器（最简单）

**打包后推荐使用此方案**：

1. **创建桌面快捷方式**（安装后）：
   ```
   目标：C:\Program Files\Scholar Harness\resources\openclaw\open-niceaigc-simple.bat
   ```

2. **或手动打开浏览器**：
   - 用 Chrome/Edge 访问：https://niceaigc.com/chat
   - 登录账号
   - 直接使用浏览器对话

### 方案 2：修改应用，使用系统浏览器

修改 `niceaigc-bridge.ts`，打包后不使用 Playwright：

```typescript
// 在打包环境中，直接打开系统浏览器
if (process.env.OPENCLAW_DIR && app.isPackaged) {
  // 使用简单命令打开浏览器
  const { exec } = require('child_process');
  exec(`start chrome "${chatUrl}"`);
  return "请在打开的浏览器中手动操作";
}
```

### 方案 3：打包时包含手动模式

将 `open-niceaigc-simple.bat` 打包到应用目录：

**已经打包进去了**，因为：
```json
"extraResources": [
  { "from": "openclaw", "to": "openclaw" }
]
```

安装后位置：
```
C:\Program Files\Scholar Harness\resources\openclaw\open-niceaigc-simple.bat
```

## 打包后的使用流程

### 步骤 1：诊断问题

如果 NiceAIGC 无法使用，运行诊断：

```batch
cd "C:\Program Files\Scholar Harness\resources\"
node scripts\diagnose-environment.js
```

### 步骤 2：手动启动浏览器

```batch
"C:\Program Files\Scholar Harness\resources\openclaw\open-niceaigc-simple.bat"
```

### 步骤 3：登录并使用

1. 浏览器打开后，如果空白按 F5 刷新
2. 登录 NiceAIGC
3. 使用浏览器对话

## 技术细节

### 为什么 Playwright 会失败？

1. **反自动化检测**：
   - NiceAIGC 检测 `navigator.webdriver`
   - 检测自动化工具的特征
   - 检测浏览器指纹

2. **打包环境限制**：
   - ASAR 打包影响文件访问
   - 权限限制
   - 路径变化

3. **Playwright 在打包环境的挑战**：
   - 需要正确的浏览器路径
   - 需要完整的依赖
   - 需要正确的权限

### 打包配置检查

`package.json` 中已配置：

```json
{
  "extraResources": [
    { "from": "openclaw", "to": "openclaw" },
    { "from": "openclaw/node_modules", "to": "openclaw/node_modules" }
  ]
}
```

这确保了：
- ✅ `openclaw/index.js` 被打包
- ✅ `openclaw/node_modules/` 被打包
- ✅ `openclaw/*.bat` 被打包

## 最佳实践

### 推荐的使用方式

1. **开发阶段**：
   - 使用 `npm run electron:dev`
   - NiceAIGC 功能完整可用

2. **打包后**：
   - 使用手动浏览器方案
   - 或提供直接的浏览器链接

3. **给用户的建议**：
   - 将 NiceAIGC 作为辅助功能
   - 推荐使用 API 模式（如果有 key）
   - 或使用其他 AI 服务（OpenAI, Claude 等）

## 替代方案

### 使用其他 AI 服务

Scholar Harness 支持：

1. **OpenAI API**：
   - 稳定可靠
   - 无需浏览器
   - 推荐 ✅

2. **Claude API**：
   - 学术写作质量高
   - 推荐 ✅

3. **通义千问**：
   - 国内访问快
   - 中文支持好

4. **DeepSeek**：
   - 成本低
   - 性能好

### 配置方式

在应用中点击"API 设置"：
- API URL: `https://api.openai.com/v1`
- API Key: 你的 key
- Model: `gpt-4` 或 `gpt-3.5-turbo`

## 总结

**打包后的问题根源**：NiceAIGC 的反自动化检测，不是打包配置问题。

**解决方案**：
1. 手动打开浏览器（最简单）
2. 使用其他 AI API（最稳定）
3. 修改代码绕过 Playwright（需要开发）

**文件位置**：
- 诊断工具：`resources\scripts\diagnose-environment.js`
- 手动启动：`resources\openclaw\open-niceaigc-simple.bat`
- 文档：`resources\docs\NICEAIGC_TROUBLESHOOTING.md`