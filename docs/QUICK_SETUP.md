## 快速配置步骤

### 1. config.json 已更新 ✅

你的 NiceAIGC URL 已更新为：`https://node8.nice188.com/`

配置文件位置：`src/bridge/niceaigc/config.json`

### 2. OpenClaw PATH 配置

**假设你的 OpenClaw 项目在 `E:\Projects\openclaw`**

#### 步骤 A: 创建启动脚本

在 `E:\Projects\openclaw` 目录下创建 `openclaw.bat`：

```batch
@echo off
cd /d "E:\Projects\openclaw"
node index.js %*
```

#### 步骤 B: 添加到 PATH（选择一种方法）

**方法 1 - 使用 PowerShell (推荐):**

```powershell
[Environment]::SetEnvironmentVariable(
    "PATH",
    $env:PATH + ";E:\Projects\openclaw",
    "User"
)
```

**方法 2 - 使用命令提示符:**

```cmd
setx PATH "%PATH%;E:\Projects\openclaw"
```

**方法 3 - 手动设置:**

1. Win + R，输入 `sysdm.cpl` 回车
2. 高级 → 环境变量
3. 用户变量 → PATH → 编辑
4. 新建 → 输入 `E:\Projects\openclaw`
5. 确定 → 确定 → 确定

#### 步骤 C: 验证

关闭所有命令提示符，重新打开，运行：

```bash
openclaw --version
```

应该显示版本号。

### 3. 测试浏览器功能

```bash
# 打开你的 NiceAIGC 页面
openclaw browser --action open --url "https://node8.nice188.com/"
```

应该会自动打开 Chrome 并访问该页面。

### 4. 启动 ScholarClaw

```bash
cd scholar-claw-feishu-1.0.0.5
pnpm build
pnpm start
```

### 5. 在 UI 中配置

1. 浏览器访问 `http://localhost:18789`
2. 点击左侧 "🔄 NiceAIGC 配置"
3. URL 应该已经预设为 `https://node8.nice188.com/`
4. 勾选"启用 NiceAIGC Bridge"
5. 点击"测试连接"
6. 成功后点击"保存"

---

## 常见问题

**Q: openclaw 命令找不到？**
A: 需要重启命令提示符，PATH 更新后在新窗口中生效。

**Q: 测试连接成功但无法发送消息？**
A: 可能是页面元素选择器不匹配，需要在 Chrome 中运行：
```bash
openclaw browser --action snapshot --refs aria
```
然后查看输出中的元素选择器。

**Q: 需要保持 Chrome 一直开着吗？**
A: 是的，浏览器模式需要 Chrome 保持登录状态。

**Q: 支持多用户吗？**
A: 目前配置是全局的，所有用户共享同一个 NiceAIGC 会话。
