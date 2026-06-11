# NiceAIGC 使用说明

## 问题：打包后浏览器打开但页面空白

**原因**：NiceAIGC 有反自动化检测机制，Playwright 等自动化工具会被识别并拦截。

## 解决方案

### 方案 1：手动打开浏览器（推荐）

直接运行脚本打开浏览器：

```
openclaw\open-niceaigc-simple.bat
```

或者手动在浏览器中访问：
```
https://niceaigc.com/chat
```

**使用步骤**：
1. 双击运行 `openclaw\open-niceaigc-simple.bat`
2. 浏览器会自动打开 NiceAIGC
3. 如果页面空白，按 **F5 刷新**
4. 登录你的 NiceAIGC 账号
5. 登录后直接使用浏览器对话

### 方案 2：从应用中打开

在应用中点击 NiceAIGC 功能后：
1. 如果浏览器打开但页面空白
2. **手动刷新页面（按 F5）**
3. 登录账号
4. 之后可以正常使用

### 方案 3：禁用自动化检测（高级）

如果你有技术能力，可以尝试：

1. **使用 Chrome 扩展**：
   - 安装 User-Agent Switcher
   - 安装 Privacy Badger
   
2. **使用其他浏览器**：
   - Firefox 的反检测更好
   - 或使用 Brave 浏览器

3. **清除浏览器数据**：
   - 清除 niceaigc.com 的 Cookie
   - 重新登录

## 为什么会出现这个问题？

NiceAIGC 使用了以下反自动化技术：
- 浏览器指纹检测
- WebDriver 标记检测
- 自动化工具特征识别
- 行为分析

Playwright 等工具会被这些检测机制识别并拦截。

## 长期解决方案

考虑使用以下替代方案：

1. **API 模式**（如果有 API Key）：
   - 直接调用 NiceAIGC API
   - 无需浏览器，更稳定

2. **其他 AI 服务**：
   - OpenAI API
   - Claude API
   - 通义千问 API
   - DeepSeek API

3. **本地部署模型**：
   - Ollama
   - LM Studio
   - 完全离线，无限制

## 联系支持

如果问题持续，请联系：
- Email: sjs@cau.edu.cn
- 项目: https://github.com/your-repo/scholar-harness