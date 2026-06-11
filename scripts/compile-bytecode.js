/**
 * Scholar Harness Bytecode Compiler
 * 
 * 将核心 JavaScript 文件编译为 V8 字节码 (.jsc)，防止源码泄露
 * 
 * 编译优先级：
 * P0 - 核心业务逻辑（Agent、Workflow、AI Prompt）
 * P1 - 服务端核心（路由、处理器、认证）
 * P2 - 文献处理（检索引擎、解析器）
 * P3 - 工具函数（加密、日志）
 */

const bytenode = require('bytenode');
const fs = require('fs');
const path = require('path');

// ============================================
// 配置：需要编译的目录和文件
// ============================================

const compileConfig = {
  // 目录配置：{ dir: 目录路径, priority: 优先级, recursive: 是否递归 }
  directories: [
    // P0 - 核心 AI Agent（最高优先级）
    { dir: 'dist/agents', priority: 'P0', recursive: false },
    { dir: 'dist/workflows', priority: 'P0', recursive: false },
    
    // ⚠️ P1 - 服务端核心 - 不编译字节码（V8 版本不兼容问题）
    // 服务端文件通过 ELECTRON_RUN_AS_NODE=1 子进程运行
    // 字节码在不同 Node/V8 版本间不兼容
    // 注释掉，保留原始 JS 文件
    // { dir: 'dist/src/server/routes', priority: 'P1', recursive: false },
    // { dir: 'dist/src/server/services', priority: 'P1', recursive: false },
    { dir: 'dist/src/bridge', priority: 'P1', recursive: true },
    
    // P2 - 文献检索引擎
    { dir: 'dist/src/literature/retrieval', priority: 'P2', recursive: false },
    { dir: 'dist/src/literature/citation', priority: 'P2', recursive: true },
    { dir: 'dist/src/literature/parsers', priority: 'P2', recursive: false },
    { dir: 'dist/src/literature/generation', priority: 'P2', recursive: false },
    { dir: 'dist/src/literature/planning', priority: 'P2', recursive: false },
    
    // P3 - 工具函数
    { dir: 'dist/src/utils', priority: 'P3', recursive: false },
    { dir: 'dist/src/storage', priority: 'P3', recursive: false },
  ],
  
  // 单文件配置：{ file: 文件路径, priority: 优先级, createLoader: 是否创建 loader }
  singleFiles: [
    // ⚠️ 服务端核心文件 - 不编译字节码（V8 版本不兼容问题）
    // Electron 使用 ELECTRON_RUN_AS_NODE=1 启动服务端子进程
    // 这时子进程运行的是 Electron 内置的 Node.js（V8 版本可能与本地不同）
    // 字节码格式在不同 V8 版本间不兼容，会导致 cachedDataRejected 错误
    // 因此保留原始 JS 文件，不编译为 .jsc
    // { file: 'dist/src/server/local-server.js', priority: 'P0', createLoader: true },
    // { file: 'dist/src/server/unified-chat-processor.js', priority: 'P1', createLoader: true },
    // { file: 'dist/src/server/auth-guard.js', priority: 'P1', createLoader: true },
    
    // Electron 主进程 - 不编译字节码（V8 版本不兼容问题）
    // Electron 内置 Node 版本与本地 Node 不同，字节码会被拒绝
    // 注释掉，跳过编译，保留原始 JS 文件
    // { file: 'dist/electron/main.js', priority: 'P0', createLoader: true },
    
    // 激活模块
    { file: 'dist/src/activation/client.js', priority: 'P1', createLoader: true },
    
  ],
  
  // 排除文件（不需要编译）
  excludePatterns: [
    /\.d\.js$/,          // 类型声明
    /\.test\.js$/,       // 测试文件
    /\.spec\.js$/,       // 测试文件
    /index\.js$/,        // 索引文件（通常只是导出）
  ],
  
  // 关键文件（即使匹配排除模式也要编译）
  forceCompile: [
    'dist/src/literature/retrieval/index.js',  // 检索引擎入口
    'dist/src/literature/parsers/index.js',    // 解析器入口
    'dist/src/bridge/chat-bridge/index.js',    // 桥接入口（如果存在）
  ],
};

// ============================================
// 编译逻辑
// ============================================

console.log('[Bytecode] Starting compilation...');
console.log('[Bytecode] Node version:', process.version);
console.log('[Bytecode] Working directory:', process.cwd());

let totalFiles = 0;
let successCount = 0;
let failCount = 0;
let skipCount = 0;

/**
 * 检查文件是否应该被排除
 */
function shouldExclude(filePath) {
  const basename = path.basename(filePath);
  
  // 检查强制编译列表
  if (compileConfig.forceCompile.some(f => filePath.includes(f.replace('dist/', '')))) {
    return false;
  }
  
  // 检查排除模式
  return compileConfig.excludePatterns.some(pattern => pattern.test(basename));
}

/**
 * 获取目录中的所有 JS 文件
 */
function getJsFilesInDir(dirPath, recursive) {
  if (!fs.existsSync(dirPath)) {
    console.warn('[Bytecode] Directory not found:', dirPath);
    return [];
  }
  
  const files = [];
  
  if (recursive) {
    // 递归遍历
    function walkDir(currentPath) {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          walkDir(fullPath);
        } else if (entry.name.endsWith('.js') && !shouldExclude(fullPath)) {
          files.push(fullPath);
        }
      }
    }
    walkDir(dirPath);
  } else {
    // 仅当前目录
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.js') && !shouldExclude(path.join(dirPath, entry.name))) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  }
  
  return files;
}

/**
 * 编译单个文件
 */
async function compileFile(filePath, createLoader = true, priority = 'P3') {
  totalFiles++;
  
  const fullPath = path.resolve(filePath);
  
  if (!fs.existsSync(fullPath)) {
    console.warn(`[Bytecode] [${priority}] File not found, skipping:`, filePath);
    skipCount++;
    return { success: false, reason: 'not_found' };
  }
  
  const jscPath = fullPath.replace('.js', '.jsc');
  
  try {
    console.log(`[Bytecode] [${priority}] Compiling:`, filePath);
    
    await bytenode.compileFile(fullPath, jscPath);
    
    if (createLoader) {
      // 创建 loader 文件，替换原 JS 文件
      const loaderContent = `require('bytenode');module.exports=require('./${path.basename(jscPath)}');`;
      fs.writeFileSync(fullPath, loaderContent, 'utf8');
      console.log(`[Bytecode] [${priority}] ✓ Compiled with loader:`, jscPath);
    } else {
      // 删除原 JS 文件
      fs.unlinkSync(fullPath);
      console.log(`[Bytecode] [${priority}] ✓ Compiled (no loader):`, jscPath);
    }
    
    successCount++;
    return { success: true };
  } catch (error) {
    console.error(`[Bytecode] [${priority}] ✗ Failed:`, filePath, error.message);
    failCount++;
    return { success: false, reason: error.message };
  }
}

/**
 * 主编译流程
 */
async function main() {
  const startTime = Date.now();
  
  // 1. 编译目录中的文件
  console.log('\n[Bytecode] Phase 1: Compiling directory files...');
  
  for (const dirConfig of compileConfig.directories) {
    const files = getJsFilesInDir(dirConfig.dir, dirConfig.recursive);
    console.log(`[Bytecode] Found ${files.length} files in ${dirConfig.dir} (${dirConfig.priority})`);
    
    for (const file of files) {
      // 所有目录文件都创建 loader
      await compileFile(file, true, dirConfig.priority);
    }
  }
  
  // 2. 编译单独指定的文件
  console.log('\n[Bytecode] Phase 2: Compiling single files...');
  
  for (const fileConfig of compileConfig.singleFiles) {
    await compileFile(fileConfig.file, fileConfig.createLoader, fileConfig.priority);
  }
  
  // 3. 复制激活模块到正确位置
  console.log('\n[Bytecode] Phase 3: Copying activation module...');
  
  const activationDir = 'dist/activation';
  if (!fs.existsSync(activationDir)) {
    fs.mkdirSync(activationDir, { recursive: true });
  }
  
  const clientJscSrc = 'dist/src/activation/client.jsc';
  const clientJscDest = 'dist/activation/client.jsc';
  
  if (fs.existsSync(clientJscSrc)) {
    fs.copyFileSync(clientJscSrc, clientJscDest);
    console.log('[Bytecode] Copied client.jsc to activation dir');
  }
  
  // 4. 输出统计信息
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  console.log('\n[Bytecode] ========================================');
  console.log('[Bytecode] Compilation Summary');
  console.log('[Bytecode] ========================================');
  console.log(`[Bytecode] Total files processed: ${totalFiles}`);
  console.log(`[Bytecode] Successfully compiled: ${successCount}`);
  console.log(`[Bytecode] Failed: ${failCount}`);
  console.log(`[Bytecode] Skipped: ${skipCount}`);
  console.log(`[Bytecode] Duration: ${duration}s`);
  console.log('[Bytecode] ========================================');
  
  // 5. 验证关键文件
  console.log('\n[Bytecode] Verification:');
  
  // 应编译为 .jsc 的关键文件
  const criticalCompiledFiles = [
    'dist/agents/primary-agent.jsc',
    'dist/agents/secondary-agent-v2.jsc',
    'dist/workflows/conversation-flow.jsc',
  ];
  
  for (const file of criticalCompiledFiles) {
    const exists = fs.existsSync(file);
    console.log(`  ${exists ? '✓' : '✗'} ${file}`);
  }
  
  // 确认服务端核心文件保留原始 JS（不编译，V8 兼容性）
  const serverJsFiles = [
    { path: 'dist/src/server/local-server.js', note: 'server entry (not compiled - V8 compat)' },
    { path: 'dist/src/server/auth-guard.js', note: 'auth guard (not compiled - V8 compat)' },
    { path: 'dist/src/server/unified-chat-processor.js', note: 'chat processor (not compiled - V8 compat)' },
    { path: 'dist/electron/main.js', note: 'electron main (not compiled - V8 compat)' },
  ];
  
  for (const { path, note } of serverJsFiles) {
    const exists = fs.existsSync(path);
    console.log(`  ${exists ? '✓' : '✗'} ${path} (${note})`);
  }
  
  // 6. 失败处理
  if (failCount > 0) {
    console.warn('\n[Bytecode] WARNING: Some files failed to compile. Check errors above.');
    console.warn('[Bytecode] This may be due to:');
    console.warn('[Bytecode]   - Syntax not supported by bytenode');
    console.warn('[Bytecode]   - Dynamic require() statements');
    console.warn('[Bytecode]   - ES module syntax (use CommonJS)');
  }
  
  // 返回退出码
  if (failCount > 0 && failCount > totalFiles * 0.1) {
    // 如果失败超过10%，视为错误
    process.exit(1);
  }
}

// 运行
main().catch(error => {
  console.error('[Bytecode] Fatal error:', error);
  process.exit(1);
});
