# 📁 路径问题检查报告

## ✅ 已修复的问题

### 问题 1: DATA_DIR 环境变量未使用 ⚠️ **关键问题！**

**位置**: `src/server/local-server.ts` 第 35-49 行

**问题描述**:
- Electron 通过环境变量 `DATA_DIR` 传递数据目录路径
- 但服务器代码完全忽略了这个环境变量
- 导致文献保存到错误的位置

**修复前**:
```typescript
function getDataDir(): string {
  const isPkg = !!(process as any).pkg;

  if (isPkg) {
    // pkg 模式：C:\Users\[用户名]\.scholar-harness\data
    return path.join(os.homedir(), '.scholar-harness', 'data');
  } else {
    // 开发模式：项目目录/data
    return path.join(projectRoot, "data");
  }
  // ❌ 完全忽略了 process.env.DATA_DIR！
}
```

**修复后**:
```typescript
function getDataDir(): string {
  // 优先使用 Electron 传递的 DATA_DIR 环境变量
  if (process.env.DATA_DIR) {
    const electronDataDir = process.env.DATA_DIR;
    if (!fs.existsSync(electronDataDir)) {
      fs.mkdirSync(electronDataDir, { recursive: true });
    }
    logger.info('[Server] Using Electron data dir:', electronDataDir);
    return electronDataDir;
  }

  // pkg 打包模式
  const isPkg = !!(process as any).pkg;
  if (isPkg) {
    const userDataDir = path.join(os.homedir(), '.scholar-harness', 'data');
    if (!fs.existsSync(userDataDir)) {
      fs.mkdirSync(userDataDir, { recursive: true });
    }
    logger.info('[Server] Running in pkg mode, data dir:', userDataDir);
    return userDataDir;
  }

  // 开发模式
  const projectRoot = path.resolve(__dirname, "..", "..");
  const devDataDir = path.join(projectRoot, "data");
  logger.info('[Server] Running in dev mode, data dir:', devDataDir);
  return devDataDir;
}
```

**影响**:
- ✅ 文献现在会保存到正确的位置：`C:\Users\[用户名]\AppData\Roaming\scholar-harness\data`
- ✅ 重启应用后文献数据会保留
- ✅ 索引缓存也会保存到正确位置

---

### 问题 2: SOUL.md 文件路径问题

**位置**: `src/server/local-server.ts` 第 3447-3453 行

**问题描述**:
- SOUL.md 使用 `__dirname` 定位
- 在打包后 `__dirname` 指向 app.asar 内部
- 文件没有被包含在打包配置中

**修复前**:
```typescript
function loadSoulFile(): string {
  const soulPath = path.join(__dirname, "..", "..", "SOUL.md");
  if (fs.existsSync(soulPath)) {
    return fs.readFileSync(soulPath, 'utf-8');
  }
  return '';
}
```

**修复后**:
```typescript
function loadSoulFile(): string {
  // 尝试多个可能的路径
  const possiblePaths = [
    path.join(dataDir, "SOUL.md"),  // 数据目录中的 SOUL.md
    path.join((process as any).resourcesPath || "", "SOUL.md"),  // Electron resources 目录
    path.join(__dirname, "..", "..", "SOUL.md"),  // 源代码目录
  ];

  for (const soulPath of possiblePaths) {
    if (fs.existsSync(soulPath)) {
      logger.info(`[SOUL] Found at: ${soulPath}`);
      return fs.readFileSync(soulPath, 'utf-8');
    }
  }

  logger.warn("[SOUL] SOUL.md not found, using default personality");
  return '';
}
```

**打包配置修复**:
```json
"extraResources": [
  {
    "from": "SOUL.md",
    "to": "SOUL.md"
  },
  ...
]
```

---

## ✅ 已验证的正确路径

### 1. uploadDir 路径 ✅
**定义**: `const uploadDir = path.join(dataDir, "uploads");`

**所有使用位置** (33 处):
- ✅ 所有都正确使用 `uploadDir`
- ✅ 没有硬编码路径
- ✅ 没有使用 `process.cwd()`

**示例**:
```typescript
const userDir = path.join(uploadDir, userId);
const litJsonFile = path.join(userDir, "literature.json");
const cacheDir = path.join(userDir, "index-cache");
```

---

### 2. 索引缓存路径 ✅
**所有 saveIndex 调用** (7 处):

| 位置 | 路径 | 状态 |
|------|------|------|
| 第 2709 行 | `path.join(uploadDir, "web-user", "index-cache")` | ✅ |
| 第 3761 行 | `path.join(userDir, "index-cache")` | ✅ |
| 第 3985 行 | `path.join(userDir, "index-cache")` | ✅ |
| 第 5917 行 | `path.join(uploadDir, "web-user", "index-cache")` | ✅ |
| 第 6370 行 | `path.join(uploadDir, "web-user", "index-cache")` | ✅ |
| 第 6671 行 | `path.join(uploadDir, "web-user", "index-cache")` | ✅ |
| 第 6689 行 | `path.join(uploadDir, "web-user", "index-cache")` | ✅ |

**所有路径都正确！**

---

### 3. literature.json 路径 ✅
**所有使用位置** (26 处):
- ✅ 所有都使用 `path.join(userDir, "literature.json")`
- ✅ 没有硬编码路径
- ✅ 路径一致

---

### 4. embeddings.json 路径 ✅
**使用位置**:
```typescript
const embeddingFile = path.join(userDir, "embeddings.json");
```
✅ 路径正确

---

## 📊 路径使用统计

| 路径变量 | 使用次数 | 状态 |
|---------|---------|------|
| `uploadDir` | 33 次 | ✅ 全部正确 |
| `dataDir` | 5 次 | ✅ 全部正确 |
| `userDir` | 13 次 | ✅ 全部正确 |
| `process.cwd()` | 0 次 | ✅ 未使用 |
| `__dirname` | 3 次 | ⚠️ 已修复 |

---

## 🔍 Electron 环境变量传递

### Electron 传递的环境变量：
```typescript
// electron/main.ts 第 71-79 行
env: {
  ...process.env,
  PORT: String(PORT),
  DATA_DIR: dataDir,              // ✅ 修复后会被使用
  SKILL_DIR: skillDir,            // ✅ 已正确使用
  PUBLIC_DIR: publicDir,          // ✅ 已正确使用
  OPENCLAW_DIR: ...,
  ELECTRON_RUN_AS_NODE: '1',
}
```

### 服务器接收并使用：
```typescript
// src/server/local-server.ts

// DATA_DIR - 修复后优先使用
const dataDir = getDataDir();  // ✅ 会检查 process.env.DATA_DIR

// SKILL_DIR - 已正确使用
const skillDir = process.env.SKILL_DIR || ...;  // ✅

// PUBLIC_DIR - 已正确使用
const publicDir = process.env.PUBLIC_DIR || ...;  // ✅
```

---

## 🎯 修复后的数据流

### 文献上传流程：
```
用户上传文献
    ↓
POST /api/upload
    ↓
保存到: C:\Users\[用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\literature.json
    ↓
索引到: globalRetrievalEngine
    ↓
保存缓存: C:\Users\[用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\index-cache\
    ├── literature-map.json
    ├── bm25-index.json
    └── vector-index.json (如果有 embedding)
```

### 应用启动流程：
```
Electron 启动
    ↓
设置 DATA_DIR 环境变量
    ↓
服务器启动
    ↓
initializeLiteratureIndex()
    ↓
加载缓存: C:\Users\[用户名]\AppData\Roaming\scholar-harness\data\uploads\web-user\index-cache\
    ↓
文献立即可用 ✅
```

---

## 📝 测试验证

### 1. 检查数据目录
```powershell
# 打开应用后，检查数据目录
dir "$env:APPDATA\scholar-harness\data\uploads\web-user" -Recurse

# 预期输出：
# literature.json
# literature.txt
# embeddings.json (如果有 embedding)
# index-cache/
#   ├── literature-map.json
#   ├── bm25-index.json
#   └── vector-index.json
```

### 2. 检查日志
```
[Server] Using Electron data dir: C:\Users\[用户名]\AppData\Roaming\scholar-harness\data
[Upload] Saved X papers for user web-user
[Upload] Indexed X papers to retrieval engine
[Upload] Saved index cache to C:\Users\...\index-cache
[Startup] Successfully loaded cached index (X papers)
```

---

## ✅ 修复总结

| 问题 | 严重程度 | 状态 | 影响 |
|------|---------|------|------|
| DATA_DIR 未使用 | 🔴 关键 | ✅ 已修复 | 文献无法持久化 |
| SOUL.md 路径 | 🟡 中等 | ✅ 已修复 | AI 个性丢失 |
| uploadDir 路径 | 🟢 正常 | ✅ 已验证 | 无问题 |
| 索引缓存路径 | 🟢 正常 | ✅ 已验证 | 无问题 |

---

## 🚀 下一步

1. ✅ 所有路径问题已修复
2. 🔄 重新编译：`npm run build`
3. 📦 重新打包：`npm run electron:build`
4. 🧪 测试验证：
   - 上传文献
   - 重启应用
   - 检查文献是否保留
   - 测试检索功能

---

**所有路径问题已修复！现在可以重新打包测试了。**