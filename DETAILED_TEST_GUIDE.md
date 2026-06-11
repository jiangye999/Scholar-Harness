# 🧪 文献持久化功能验证指南

## ⚠️ 重要前提

功能已经实现并打包，但需要满足以下条件才能生效：

### 条件 1: 配置 Embedding API（可选）

如果你想要 embedding 功能，必须配置：

1. 打开应用
2. 进入设置页面
3. 配置以下信息：
   - **Embedding API URL**: 例如 `https://api.openai.com/v1`
   - **Embedding API Key**: 你的 API Key
   - **Embedding Model**: `text-embedding-3-small` 或其他模型

### 条件 2: 功能即使没有 Embedding API 也会工作

**重要**: 即使没有配置 Embedding API，文献持久化功能也会工作！

- ✅ 文献会上传并保存到 `literature.json`
- ✅ 会建立 BM25 索引并保存缓存
- ✅ 重启应用后会自动加载索引
- ⚠️ 只是没有 semantic search（语义检索）功能

---

## 📝 详细测试步骤

### 步骤 1: 完全卸载旧版本

```powershell
# 1. 卸载应用（如果在安装版）
# 控制面板 → 程序和功能 → 卸载 Scholar Harness

# 2. 删除用户数据目录（重要！）
Remove-Item -Recurse -Force "$env:APPDATA\scholar-harness"

# 3. 验证删除成功
Test-Path "$env:APPDATA\scholar-harness"  # 应该返回 False
```

### 步骤 2: 安装新版本

```powershell
# 运行安装程序
E:\AI_projects\scholar-harness-1.0.0\dist-electron\Scholar Harness Setup 1.0.0.exe

# 或者直接运行解压版
E:\AI_projects\scholar-harness-1.0.0\dist-electron\win-unpacked\Scholar Harness.exe
```

### 步骤 3: 首次上传文献测试

#### 3.1 打开开发者工具
- 启动应用后按 `F12` 或 `Ctrl+Shift+I`
- 切换到 Console 标签

#### 3.2 上传文献文件
1. 点击"上传文献"按钮
2. 选择一个 WoS/RIS/BIB 文件（例如包含 10 篇文献）
3. **观察 Console 输出**

#### 3.3 预期 Console 日志

**情况 A: 没有配置 Embedding API**
```
[Upload] Processing X files for user web-user
[Upload] File xxx.ris: X papers extracted
[Upload] Saved X papers for user web-user
[Upload] No embedding configured, indexing papers immediately...  ← 关键日志！
[Upload] Indexed X papers to retrieval engine                    ← 关键日志！
[Upload] Saved index cache to C:\Users\...\data\uploads\web-user\index-cache  ← 关键日志！
```

**情况 B: 已配置 Embedding API**
```
[Upload] Processing X files for user web-user
[Upload] File xxx.ris: X papers extracted
[Upload] Saved X papers for user web-user
[Upload] Starting embedding generation in background...
[Embedding] Saved X embeddings for user web-user
[Embedding] Merged X embeddings into literature.json            ← 关键日志！
[Embedding] Indexed X papers to retrieval engine                ← 关键日志！
[Embedding] Saved index cache to ...                            ← 关键日志！
```

#### 3.4 验证文件系统

```powershell
# 检查用户数据目录
$dir = "$env:APPDATA\scholar-harness\data\uploads\web-user"
Get-ChildItem $dir -Recurse | Select-Object FullName, Length

# 预期文件：
# web-user/
# ├── literature.json          (文献数据)
# ├── literature.txt           (文献文本)
# ├── embeddings.json          (如果有 embedding)
# └── index-cache/             (索引缓存)
#     ├── literature-map.json
#     ├── bm25-index.json
#     └── vector-index.json    (如果有 embedding)
```

### 步骤 4: 重启持久化测试

#### 4.1 关闭应用
- 点击关闭按钮或 `Alt+F4`
- **观察 Console 输出**：
```
[Server] Shutting down...
[Server] Saved index cache (X papers)  ← 关键日志！
```

#### 4.2 重新打开应用
- 再次启动 Scholar Harness
- **观察 Console 输出**：
```
[Startup] Loading cached index from C:\Users\...\index-cache
[Startup] Successfully loaded cached index (X papers)  ← 关键日志！
```

#### 4.3 立即测试检索
- 不需要重新上传文献
- 直接发送消息：`检索关于 [你的文献主题] 的论文`
- **应该立即返回结果**，不需要等待

---

## 🐛 故障排查

### 问题 1: 没有看到 "[Upload] Saved index cache" 日志

**原因**: 可能上传失败或路径问题

**解决**:
```powershell
# 检查 Console 是否有错误日志
# 检查上传目录是否存在
$uploadDir = "$env:APPDATA\scholar-harness\data\uploads\web-user"
if (!(Test-Path $uploadDir)) {
    New-Item -ItemType Directory -Path $uploadDir -Force
}
```

### 问题 2: 重启后提示"文献库为空"

**原因**: 索引缓存加载失败

**解决**:
```powershell
# 检查缓存文件是否存在
$cacheDir = "$env:APPDATA\scholar-harness\data\uploads\web-user\index-cache"
Get-ChildItem $cacheDir

# 应该看到：
# literature-map.json
# bm25-index.json
# vector-index.json (如果有 embedding)

# 如果不存在，手动触发重建：
# 1. 打开应用
# 2. 上传一个文献文件
# 3. 观察 Console 日志
```

### 问题 3: Embedding 生成失败

**原因**: Embedding API 配置错误或网络问题

**解决**:
1. 检查 API URL 格式（应该是 `https://xxx/v1`，不要带 `/embeddings`）
2. 检查 API Key 是否正确
3. 检查网络连接
4. 查看 Console 错误日志

**临时方案**: 不配置 Embedding API，使用 BM25 检索（也能工作）

---

## 📊 功能验证检查清单

打印此清单，逐项验证：

- [ ] 已完全卸载旧版本
- [ ] 已删除 `%APPDATA%\scholar-harness` 目录
- [ ] 已安装新版本（或使用解压版）
- [ ] 已打开开发者工具（F12）
- [ ] 已上传文献文件
- [ ] 看到 `[Upload] Indexed X papers` 日志
- [ ] 看到 `[Upload] Saved index cache` 日志
- [ ] 文件系统存在 `literature.json`
- [ ] 文件系统存在 `index-cache/` 目录
- [ ] 已关闭应用
- [ ] 看到 `[Server] Saved index cache` 日志
- [ ] 已重新打开应用
- [ ] 看到 `[Startup] Successfully loaded cached index` 日志
- [ ] 立即检索文献成功
- [ ] （可选）已配置 Embedding API
- [ ] （可选）看到 `[Embedding] Merged X embeddings` 日志

---

## 🔍 快速验证脚本

保存为 `test-persistence.ps1` 并运行：

```powershell
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Scholar Harness 持久化验证工具" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$dir = "$env:APPDATA\scholar-harness\data\uploads\web-user"

Write-Host "📁 检查用户数据目录..." -ForegroundColor Yellow
if (Test-Path $dir) {
    Write-Host "  ✅ 目录存在: $dir" -ForegroundColor Green

    $litFile = Join-Path $dir "literature.json"
    if (Test-Path $litFile) {
        $litData = Get-Content $litFile | ConvertFrom-Json
        $papers = if ($litData.papers) { $litData.papers } else { $litData }
        Write-Host "  ✅ 文献数量: $($papers.Count)" -ForegroundColor Green

        $withEmb = ($papers | Where-Object { $_.embedding }).Count
        Write-Host "  $($withEmb -gt 0 ? '✅' : '⚠️ ') 包含 embedding: $withEmb/$($papers.Count)" -ForegroundColor $(if ($withEmb -gt 0) { 'Green' } else { 'Yellow' })
    } else {
        Write-Host "  ⚠️  literature.json 不存在（未上传文献）" -ForegroundColor Yellow
    }

    $cacheDir = Join-Path $dir "index-cache"
    if (Test-Path $cacheDir) {
        Write-Host "  ✅ 索引缓存目录存在" -ForegroundColor Green
        $cacheFiles = Get-ChildItem $cacheDir -File
        foreach ($file in $cacheFiles) {
            Write-Host "    📄 $($file.Name) ($('{0:N0}' -f $file.Length) bytes)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  ❌ 索引缓存目录不存在" -ForegroundColor Red
    }
} else {
    Write-Host "  ⚠️  数据目录不存在（首次运行后创建）" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  验证完成！" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
```

---

## 📞 如果还是不行

请提供以下信息：

### 1. Console 完整日志
从应用启动到上传文献的完整 Console 输出（截图或文本）

### 2. 文件系统截图
```powershell
# 运行此命令并截图
Get-ChildItem "$env:APPDATA\scholar-harness\data\uploads\web-user" -Recurse | Format-Table FullName, Length
```

### 3. 文献数据检查
```powershell
# 检查 literature.json 内容
Get-Content "$env:APPDATA\scholar-harness\data\uploads\web-user\literature.json" | ConvertFrom-Json | ConvertTo-Json -Depth 2
```

### 4. 应用版本
```
Scholar Harness v1.0.0
打包时间: 2026-04-03
```

---

## 💡 常见误解

### 误解 1: "没有看到 embedding 就是功能没实现"
**事实**: 即使没有 embedding，BM25 索引也会建立并持久化

### 误解 2: "重启后要重新上传"
**事实**: 重启后会自动加载缓存，不需要重新上传

### 误解 3: "功能没生效"
**事实**: 功能可能已生效，只是：
- 没有查看 Console 日志
- 没有测试检索功能
- 没有检查文件系统

---

**请按照此指南逐步测试，如果还有问题请提供详细的错误信息！**