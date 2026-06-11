# 🔍 文献持久化功能测试指南

## ✅ 代码修改确认

已确认所有修改都已编译到 `dist/src/server/local-server.js`：

### 1. Embedding 合并到 literature.json ✅
**位置**: 第 3464-3499 行
```javascript
// 将 embedding 合并到 literature.json
const literatureFile = path.join(userDir, "literature.json");
if (fs.existsSync(literatureFile)) {
  const litData = JSON.parse(fs.readFileSync(literatureFile, 'utf-8'));
  const litPapers = Array.isArray(litData) ? litData : (litData.papers || []);
  
  // 创建 embedding 映射
  const embeddingMap = new Map();
  for (const emb of embeddings) {
    embeddingMap.set(emb.paperId, emb.embedding);
  }
  
  // 合并 embedding 到文献数据
  let mergedCount = 0;
  for (const paper of litPapers) {
    if (paper.title && embeddingMap.has(paper.title)) {
      paper.embedding = embeddingMap.get(paper.title);
      mergedCount++;
    }
  }
  
  // 保存更新后的 literature.json
  fs.writeFileSync(literatureFile, JSON.stringify({ papers: litPapers }, null, 2), 'utf-8');
  logger_1.logger.info(`[Embedding] Merged ${mergedCount} embeddings into literature.json`);
}
```

### 2. 上传后立即索引文献 ✅
**位置**: 第 3287-3310 行
```javascript
else {
  // 如果没有配置 embedding，立即索引文献并保存缓存
  logger_1.logger.info("[Upload] No embedding configured, indexing papers immediately...");
  try {
    const unifiedLiteratures = mergedPapers.map((paper, index) => ({
      id: `lit-${index}-${Date.now()}`,
      citationId: paper.citationId || index + 1,
      title: paper.title || 'Unknown Title',
      authors: parseAuthors(paper.author || paper.authors?.join(', ') || 'Unknown'),
      author: paper.author || paper.authors?.join(', ') || 'Unknown',
      year: parseInt(paper.year) || new Date().getFullYear(),
      abstract: paper.abstract || '',
      keywords: Array.isArray(paper.keywords) ? paper.keywords : (paper.keywords || '').split(/[,;]/).map((k) => k.trim()).filter((k) => k),
      journal: paper.journal || '',
      doi: paper.doi || '',
      documentType: 'article',
      source: 'wos',
      embedding: paper.embedding,
    }));
    
    await globalRetrievalEngine.index(unifiedLiteratures);
    logger_1.logger.info(`[Upload] Indexed ${unifiedLiteratures.length} papers to retrieval engine`);
    
    const cacheDir = path.join(userDir, "index-cache");
    globalRetrievalEngine.saveIndex(cacheDir);
    logger_1.logger.info(`[Upload] Saved index cache to ${cacheDir}`);
    
  } catch (indexError) {
    logger_1.logger.error('[Upload] Failed to index papers:', indexError);
  }
}
```

### 3. 退出时保存索引 ✅
**位置**: 第 6003-6030 行
```javascript
process.on('SIGINT', async () => {
    logger_1.logger.info('[Server] Shutting down...');
    // 保存检索引擎索引
    try {
        const cacheDir = path.join(uploadDir, "web-user", "index-cache");
        const stats = globalRetrievalEngine.getStatistics();
        if (stats.totalCount > 0) {
            globalRetrievalEngine.saveIndex(cacheDir);
            logger_1.logger.info(`[Server] Saved index cache (${stats.totalCount} papers)`);
        }
    }
    catch (e) {
        logger_1.logger.error('[Server] Failed to save index cache:', e);
    }
    process.exit(0);
});
```

---

## 🚀 正确的打包和测试流程

### 步骤 1: 清理旧文件
```bash
# 删除旧的编译输出
rm -rf dist
rm -rf dist-electron

# 或者 Windows:
rd /s /q dist
rd /s /q dist-electron
```

### 步骤 2: 重新编译 TypeScript
```bash
npm run build
```

**预期输出**:
```
> scholar-harness@1.0.0 build
> tsc && xcopy /E /I /Y src\public dist\src\public ...
```

**验证编译成功**:
```bash
# 检查文件是否存在
ls dist/src/server/local-server.js

# 检查修改是否在文件中
grep "Merged.*embeddings into literature.json" dist/src/server/local-server.js
```

### 步骤 3: 重新打包 Electron 应用
```bash
npm run electron:build
```

**预期输出**:
```
• electron-builder  version=26.8.1
• loaded configuration  file=package.json
• building        target=nsis file=dist-electron/Scholar Harness Setup 1.0.0.exe
```

**打包输出位置**: `dist-electron/Scholar Harness Setup 1.0.0.exe`

### 步骤 4: 安装并测试

#### A. 安装应用
1. 运行 `dist-electron/Scholar Harness Setup 1.0.0.exe`
2. 选择安装目录
3. 安装完成后启动应用

#### B. 检查用户数据目录
**位置**: `C:\Users\[你的用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\`

**应该包含**:
```
web-user/
├── literature.json          # 文献数据（包含 embedding）
├── literature.txt            # 文献文本摘要
├── embeddings.json           # Embedding 备份
└── index-cache/              # 检索引擎缓存
    ├── literature-map.json   # 文献映射（包含 embedding）
    ├── bm25-index.json       # BM25 索引
    └── vector-index.json     # 向量索引
```

#### C. 测试流程

**测试 1: 文献上传**
1. 打开应用
2. 上传 WoS/RIS/BIB 文献文件
3. **观察 Console 输出**（打开开发者工具 F12）:
   ```
   [Upload] Saved X papers for user web-user
   [Upload] No embedding configured, indexing papers immediately...
   [Upload] Indexed X papers to retrieval engine
   [Upload] Saved index cache to C:\Users\...\data\uploads\web-user\index-cache
   ```

**测试 2: 重启后持久化**
1. 上传文献后，关闭应用
2. 重新打开应用
3. **观察 Console 输出**:
   ```
   [Startup] Successfully loaded cached index (X papers)
   ```
4. 立即发送消息："检索关于 [你的文献主题] 的论文"
5. **应该立即返回结果，不需要等待**

**测试 3: Embedding 配置**
1. 打开设置页面
2. 配置 Embedding API:
   - **URL**: 你的 embedding API 地址
   - **Key**: 你的 API Key
   - **Model**: `text-embedding-3-small` 或 `text-embedding-v4`
3. 重新上传文献
4. **观察 Console 输出**:
   ```
   [Upload] Starting embedding generation in background...
   [Embedding] Saved X embeddings for user web-user
   [Embedding] Merged X embeddings into literature.json
   [Embedding] Indexed X papers to retrieval engine
   [Embedding] Saved index cache
   ```

---

## 🔧 故障排查

### 问题 1: "功能没实现" 的可能原因

#### 原因 A: 没有重新编译
**症状**: 修改的代码没有被打包
**解决**:
```bash
npm run build
npm run electron:build
```

#### 原因 B: 使用了旧的打包文件
**症状**: 安装后功能不变
**解决**: 
1. 完全卸载旧版本
2. 删除 `C:\Users\[用户名]\AppData\Roaming\scholar-harness`
3. 重新安装新版本

#### 原因 C: 没有配置 Embedding API
**症状**: 文献保存了但没有 embedding
**解决**: 
1. 打开设置页面
2. 配置 Embedding API URL 和 Key
3. 重新上传文献

#### 原因 D: 数据目录路径问题
**症状**: 找不到文献数据
**解决**: 检查 Electron 的 userData 路径
```javascript
// electron/main.js 第 13 行
const userDataPath = app.getPath('userData');
// 应该是: C:\Users\[用户名]\AppData\Roaming\scholar-harness
```

### 问题 2: 如何验证功能是否生效

#### 方法 A: 检查 Console 日志
打开开发者工具（F12），观察是否有以下日志：
- `[Upload] Indexed X papers to retrieval engine` ✅
- `[Upload] Saved index cache` ✅
- `[Embedding] Merged X embeddings into literature.json` ✅
- `[Startup] Successfully loaded cached index` ✅

#### 方法 B: 检查文件系统
```bash
# Windows PowerShell
ls C:\Users\[你的用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\

# 检查 index-cache 目录
ls C:\Users\[你的用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\index-cache\

# 查看 literature.json 是否包含 embedding
cat C:\Users\[你的用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\literature.json
```

#### 方法 C: 测试检索功能
1. 上传文献后立即关闭应用
2. 重新打开应用
3. 发送消息："检索关于 [主题] 的文献"
4. 如果立即返回结果 → **持久化成功** ✅
5. 如果提示"文献库为空" → **持久化失败** ❌

---

## 📋 测试检查清单

- [ ] 已运行 `npm run build`
- [ ] 已运行 `npm run electron:build`
- [ ] 已卸载旧版本应用
- [ ] 已删除 `%APPDATA%\scholar-harness` 目录
- [ ] 已安装新版本应用
- [ ] 已打开开发者工具查看日志
- [ ] 已测试文献上传
- [ ] 已测试应用重启
- [ ] 已测试检索功能
- [ ] 已配置 Embedding API（可选）
- [ ] 已检查 `literature.json` 包含 embedding 字段
- [ ] 已检查 `index-cache` 目录存在

---

## 🐛 如果还是不行

请提供以下信息：

1. **Console 日志**:
   - 上传文献时的完整日志
   - 重启应用时的日志
   - 检索文献时的日志

2. **文件系统检查**:
   - `%APPDATA%\scholar-harness\data\uploads\web-user\` 目录内容
   - `literature.json` 文件内容（前 50 行）

3. **Embedding 配置**:
   - 是否配置了 Embedding API？
   - API URL 和 Model 是什么？

4. **打包方式**:
   - 使用的是 `npm run electron:build` 吗？
   - 安装包路径是什么？

---

## 💡 快速验证脚本

创建 `test-persistence.js` 文件：

```javascript
const fs = require('fs');
const path = require('path');

const dataDir = path.join(process.env.APPDATA, 'scholar-harness', 'data', 'uploads', 'web-user');

console.log('=== 检查数据目录 ===');
console.log('路径:', dataDir);
console.log('是否存在:', fs.existsSync(dataDir));

if (fs.existsSync(dataDir)) {
  console.log('\n=== 目录内容 ===');
  const files = fs.readdirSync(dataDir);
  console.log('文件列表:', files);
  
  const litFile = path.join(dataDir, 'literature.json');
  if (fs.existsSync(litFile)) {
    const litData = JSON.parse(fs.readFileSync(litFile, 'utf-8'));
    const papers = Array.isArray(litData) ? litData : litData.papers;
    console.log('\n文献数量:', papers.length);
    console.log('第一篇文献是否有 embedding:', !!papers[0]?.embedding);
  }
  
  const cacheDir = path.join(dataDir, 'index-cache');
  if (fs.existsSync(cacheDir)) {
    console.log('\n索引缓存目录存在 ✅');
    const cacheFiles = fs.readdirSync(cacheDir);
    console.log('缓存文件:', cacheFiles);
  } else {
    console.log('\n索引缓存目录不存在 ❌');
  }
}
```

运行测试:
```bash
node test-persistence.js
```

---

**请按照以上步骤逐一测试，如果还有问题请提供详细的错误信息！**