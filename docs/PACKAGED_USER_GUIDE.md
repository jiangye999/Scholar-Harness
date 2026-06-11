# 打包后使用指南

## 快速诊断

如果遇到问题，先运行诊断：

```batch
"C:\Program Files\Scholar Harness\resources\openclaw\diagnose.bat"
```

## NiceAIGC 使用

### 问题：浏览器打开但页面空白

**原因**：NiceAIGC 有反自动化检测

**解决方法**：

1. **手动打开浏览器**（推荐）：
   ```
   双击运行：C:\Program Files\Scholar Harness\resources\openclaw\open-niceaigc-simple.bat
   ```

2. **或直接访问**：
   - 用 Chrome 打开：https://niceaigc.com/chat
   - 登录账号
   - 使用浏览器对话

## 其他 AI 服务配置

推荐使用 API 模式，更稳定：

### OpenAI
- API URL: `https://api.openai.com/v1`
- 需要 API Key

### Claude
- API URL: `https://api.anthropic.com/v1`
- 需要 API Key

### 通义千问
- API URL: `https://dashscope.aliyuncs.com/compatible-mode/v1`
- 需要 API Key

### DeepSeek
- API URL: `https://api.deepseek.com/v1`
- 需要 API Key

## 文件位置

安装后的文件结构：

```
C:\Program Files\Scholar Harness\
├── Scholar Harness.exe           # 主程序
└── resources\
    ├── openclaw\                  # 浏览器自动化工具
    │   ├── open-niceaigc-simple.bat  # ✅ 手动启动 NiceAIGC
    │   ├── diagnose.bat           # 诊断工具
    │   └── index.js
    ├── sci_writing_skills\        # 写作技能
    └── configs\                   # 配置文件

C:\Users\用户名\AppData\Roaming\scholar-harness\
├── data\                          # 用户数据
├── logs\                          # 日志
└── browser-state.json             # 浏览器登录状态
```

## 常见问题

### Q: 打包后 NiceAIGC 不能用？

A: 使用手动打开方式：
```
resources\openclaw\open-niceaigc-simple.bat
```

### Q: 如何查看日志？

A: 日志位置：
```
%APPDATA%\scholar-harness\logs\
```

### Q: 数据存储在哪里？

A: 用户数据位置：
```
%APPDATA%\scholar-harness\data\
```

### Q: 如何重置应用？

A: 删除数据目录：
```batch
rd /s /q "%APPDATA%\scholar-harness"
```

## 技术支持

- Email: sjs@cau.edu.cn
- 项目文档: `resources\docs\`