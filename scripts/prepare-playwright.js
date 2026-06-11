/**
 * Playwright 浏览器准备脚本
 * 打包前检查并确保浏览器可用
 * 
 * 核心改动：将浏览器安装到 openclaw/browsers 目录
 * 这样打包时可以一起打包进 exe
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

console.log('\n========================================');
console.log('  Playwright Browser Preparation');
console.log('  (Pre-installed for Packaging)');
console.log('========================================\n');

const openclawPath = path.join(__dirname, '..', 'openclaw');
const browsersDestPath = path.join(openclawPath, 'browsers');

// 检查 openclaw 是否存在
if (!fs.existsSync(openclawPath)) {
  console.error('[ERROR] openclaw directory not found:', openclawPath);
  process.exit(1);
}

// 检查 playwright 是否已安装
const playwrightModulePath = path.join(openclawPath, 'node_modules', 'playwright');
if (!fs.existsSync(playwrightModulePath)) {
  console.log('[INFO] Installing playwright dependencies...');
  try {
    execSync('npm install', { cwd: openclawPath, stdio: 'inherit' });
    console.log('[SUCCESS] Dependencies installed');
  } catch (e) {
    console.error('[ERROR] Failed to install dependencies:', e.message);
    process.exit(1);
  }
}

// 创建 browsers 目录
if (!fs.existsSync(browsersDestPath)) {
  fs.mkdirSync(browsersDestPath, { recursive: true });
  console.log('[INFO] Created browsers directory:', browsersDestPath);
}

console.log('[INFO] Target browsers directory:', browsersDestPath);
console.log('[INFO] Checking installed browsers...');

// 检查 openclaw/browsers 中是否已有 chromium
const browsersInstalledInTarget = fs.existsSync(browsersDestPath) &&
  fs.readdirSync(browsersDestPath).some(f => f.startsWith('chromium-'));

// 也检查系统缓存目录（作为 fallback）
const systemCachePath = path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
const browsersInstalledInSystem = fs.existsSync(systemCachePath) &&
  fs.readdirSync(systemCachePath).some(f => f.startsWith('chromium-'));

if (browsersInstalledInTarget) {
  console.log('[SUCCESS] Chromium browser already installed in target directory');
  const installedBrowsers = fs.readdirSync(browsersDestPath);
  console.log('[INFO] Installed browsers:', installedBrowsers.join(', '));
} else if (browsersInstalledInSystem) {
  // 从系统缓存复制到 openclaw/browsers
  console.log('\n[INFO] Found browser in system cache, copying to target...');
  const installedBrowsers = fs.readdirSync(systemCachePath);
  console.log('[INFO] Source browsers:', installedBrowsers.join(', '));
  
  try {
    copyBrowsers(systemCachePath, browsersDestPath);
    console.log('[SUCCESS] Browsers copied to target directory');
  } catch (e) {
    console.error('[ERROR] Failed to copy browsers:', e.message);
    console.log('[INFO] Will try to install directly...');
    browsersInstalledInSystem = false; // 强制重新安装
  }
}

if (!browsersInstalledInTarget && !browsersInstalledInSystem) {
  console.log('\n[INFO] Chromium browser not found. Installing to target directory...');
  console.log('[INFO] This may take a few minutes...\n');
  
  try {
    // 关键：使用 PLAYWRIGHT_BROWSERS_PATH 环境变量指定安装位置
    // 这样浏览器会直接安装到 openclaw/browsers 目录
    const env = {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: browsersDestPath
    };
    
    // 安装 chromium 浏览器到指定目录
    execSync('npx playwright install chromium', {
      cwd: openclawPath,
      stdio: 'inherit',
      timeout: 300000, // 5 分钟超时
      env: env
    });
    console.log('\n[SUCCESS] Chromium browser installed to:', browsersDestPath);
  } catch (e) {
    console.error('[ERROR] Failed to install Chromium:', e.message);
    console.error('[INFO] You may need to run this manually:');
    console.error('[INFO]   set PLAYWRIGHT_BROWSERS_PATH=' + browsersDestPath);
    console.error('[INFO]   cd openclaw && npx playwright install chromium');
    process.exit(1);
  }
}

// 验证安装
console.log('\n[INFO] Verifying installation...');
const finalBrowsers = fs.readdirSync(browsersDestPath);
console.log('[INFO] Installed browsers in target:', finalBrowsers.join(', '));

// 检查 chromium 目录大小
const chromiumDir = finalBrowsers.find(f => f.startsWith('chromium-'));
if (chromiumDir) {
  const chromiumPath = path.join(browsersDestPath, chromiumDir);
  const size = getDirectorySize(chromiumPath);
  console.log('[INFO] Chromium size:', (size / 1024 / 1024).toFixed(2), 'MB');
  
  if (size < 100 * 1024 * 1024) { // 小于 100MB 可能不完整
    console.warn('[WARN] Chromium installation may be incomplete (expected >100MB)');
  }
}

// 写入一个标记文件，记录浏览器路径信息
const browserInfoPath = path.join(openclawPath, 'browser-info.json');
fs.writeFileSync(browserInfoPath, JSON.stringify({
  browsersPath: 'browsers',
  installedBrowsers: finalBrowsers,
  packagedAt: new Date().toISOString()
}, null, 2));
console.log('[INFO] Browser info saved to:', browserInfoPath);

console.log('\n========================================');
console.log('  Preparation Complete');
console.log('========================================');
console.log('\n[NEXT] Run: npm run electron:build');
console.log('[INFO] Browsers will be packaged with the exe');
console.log('\n');

/**
 * 递归复制目录
 */
function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
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
 * 复制浏览器目录（只复制 chromium）
 */
function copyBrowsers(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (entry.name.startsWith('chromium-')) {
      // 只复制 chromium，其他浏览器不需要
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      
      console.log('[COPY] Copying:', entry.name);
      copyDir(srcPath, destPath);
      console.log('[COPY] Done:', entry.name);
    }
  }
}

/**
 * 计算目录大小
 */
function getDirectorySize(dirPath) {
  let totalSize = 0;
  
  function traverse(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(fullPath);
      } else {
        try {
          totalSize += fs.statSync(fullPath).size;
        } catch (e) {
          // 忽略无法访问的文件
        }
      }
    }
  }
  
  traverse(dirPath);
  return totalSize;
}