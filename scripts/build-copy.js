/**
 * 跨平台构建后文件复制脚本
 * 替代 Windows 特定的 xcopy 命令
 */

const fs = require('fs');
const path = require('path');

// 源目录和目标目录
const sources = [
  {
    src: 'src/public',
    dest: 'dist/src/public',
    description: 'Public static files'
  },
  {
    src: 'src/bridge/chat-bridge/config.json',
    dest: 'dist/src/bridge/chat-bridge/config.json',
    description: 'ChatBridge config'
  },
  {
    src: 'configs/souls',
    dest: 'dist/configs/souls',
    description: 'Soul prompt files'
  },
  {
    src: 'electron/icon.ico',
    dest: 'dist/electron/icon.ico',
    description: 'Electron window icon'
  },
  {
    src: 'electron/views',
    dest: 'dist/electron/views',
    description: 'Electron login views'
  }
];

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  // 创建目标目录
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  // 读取源目录
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * 复制单个文件
 */
function copyFile(src, dest) {
  // 确保目标目录存在
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[Copy] ${src} -> ${dest}`);
    return true;
  } else {
    console.warn(`[Skip] Source not found: ${src}`);
    return false;
  }
}

/**
 * 递归删除 source map 文件
 */
function removeSourceMaps(dir) {
  if (!fs.existsSync(dir)) return;
  
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      removeSourceMaps(fullPath);
    } else if (entry.name.endsWith('.js.map') || entry.name.endsWith('.d.ts.map')) {
      fs.unlinkSync(fullPath);
      console.log(`[Clean] Removed: ${fullPath}`);
    }
  }
}

/**
 * 删除桌面端不应携带的旧编译产物。
 * TypeScript/electron-builder 不会自动清理历史 dist 文件，避免 cloud 服务端源码残留进 exe。
 */
function removePath(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  fs.rmSync(targetPath, { recursive: true, force: true });
  console.log(`[Clean] Removed desktop-excluded artifact: ${targetPath}`);
}

/**
 * 执行复制
 */
function runCopy() {
  console.log('[Build Copy] Starting post-build file copy...');
  
  for (const item of sources) {
    console.log(`[Copy] Processing: ${item.description}`);
    
    if (fs.existsSync(item.src)) {
      const srcStat = fs.statSync(item.src);
      
      if (srcStat.isDirectory()) {
        copyDir(item.src, item.dest);
        console.log(`[Copy] Directory: ${item.src} -> ${item.dest}`);
      } else {
        copyFile(item.src, item.dest);
      }
    } else {
      console.warn(`[Skip] Source not found: ${item.src}`);
    }
  }
  
  // 清理 source map 文件（安全优化）
  console.log('[Build Copy] Cleaning source map files...');
  removeSourceMaps('dist');
  removePath('dist/cloud');
  removePath('dist/electron/auth-middleware.js');
  
  console.log('[Build Copy] Completed.');
}

// 执行
runCopy();
