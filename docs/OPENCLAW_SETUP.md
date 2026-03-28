# OpenClaw PATH 配置指南

## 快速配置（推荐）

### 方法 1: 使用自动配置脚本

1. 将 `setup-openclaw-path.bat` 复制到你的 OpenClaw 项目根目录
2. 双击运行该脚本
3. 按提示操作即可

### 方法 2: 手动配置

#### 步骤 1: 找到 OpenClaw 项目路径

假设你的 OpenClaw 项目在：
```
E:\Projects\openclaw
```

#### 步骤 2: 创建启动脚本

在 OpenClaw 目录下创建 `openclaw.bat`：

```batch
@echo off
cd /d "E:\Projects\openclaw"
node index.js %*
```

#### 步骤 3: 添加到系统 PATH

**Windows 10/11:**

1. 右键"此电脑" → 属性 → 高级系统设置
2. 点击"环境变量"
3. 在"用户变量"中找到 PATH，双击编辑
4. 点击"新建"，添加 OpenClaw 路径：
   ```
   E:\Projects\openclaw
   ```
5. 点击确定保存

**或者使用 PowerShell (管理员):**

```powershell
[Environment]::SetEnvironmentVariable(
    "PATH",
    $env:PATH + ";E:\Projects\openclaw",
    "User"
)
```

#### 步骤 4: 验证

关闭所有命令提示符，重新打开，运行：

```bash
openclaw --version
```

如果显示版本号，说明配置成功！

---

## 在 ScholarClaw 中使用

### 1. 确保配置完成

```bash
# 测试 OpenClaw 是否可用
openclaw --version

# 测试浏览器功能
openclaw browser --action open --url "https://node8.nice188.com/"
```

### 2. 启动 ScholarClaw

```bash
cd scholar-claw-feishu-1.0.0.5
pnpm start
```

### 3. 配置 NiceAIGC

1. 打开 http://localhost:18789
2. 点击左侧 "🔄 NiceAIGC 配置"
3. URL 已预设为 `https://node8.nice188.com/`
4. 勾选"启用 NiceAIGC Bridge"
5. 点击"测试连接"
6. 成功后点击"保存"

### 4. 开始使用

现在你可以：
- 在对话框中发送消息
- 消息会通过 OpenClaw 自动转发到 NiceAIGC
- AI 响应会返回到 ScholarClaw 界面

---

## 故障排查

### 问题 1: 'openclaw' 不是内部或外部命令

**原因**: PATH 未正确配置或未生效

**解决**:
1. 重启命令提示符
2. 检查 PATH 是否包含 OpenClaw 目录：
   ```bash
   echo %PATH%
   ```
3. 确认 openclaw.bat 存在于该目录

### 问题 2: Chrome 无法启动

**原因**: Chrome 未安装或 profile 配置错误

**解决**:
1. 确保 Chrome 已安装
2. 在 Chrome 中登录 NiceAIGC 账号
3. 运行以下命令测试：
   ```bash
   openclaw browser --action open --url "https://node8.nice188.com/"
   ```

### 问题 3: 连接测试成功但发送消息失败

**原因**: 页面元素选择器不匹配

**解决**:
1. 在浏览器中打开 `https://node8.nice188.com/`
2. 运行：
   ```bash
   openclaw browser --action snapshot --refs aria
   ```
3. 查看输出中的元素列表
4. 根据实际元素更新 `src/bridge/niceaigc/niceaigc-bridge.ts` 中的选择器

---

## 目录结构示例

假设你的项目结构如下：

```
E:\AI_projects\
├── scholar-claw-feishu-1.0.0.5\    # ScholarClaw 项目
│   ├── src\bridge\niceaigc\
│   │   └── config.json               # 已配置你的 URL
│   └── ...
├── openclaw\                         # OpenClaw 项目
│   ├── index.js
│   ├── openclaw.bat                  # 启动脚本
│   └── ...
└── backups\                          # 备份文件
```

---

## 验证清单

- [ ] OpenClaw 项目可以独立运行
- [ ] 创建了 openclaw.bat 启动脚本
- [ ] PATH 环境变量包含 OpenClaw 目录
- [ ] 新开命令提示符可以运行 `openclaw --version`
- [ ] Chrome 已安装并登录 NiceAIGC
- [ ] ScholarClaw 已构建并启动
- [ ] NiceAIGC 配置对话框中 URL 正确
- [ ] 连接测试成功
