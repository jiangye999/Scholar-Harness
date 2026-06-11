/**
 * Electron 打包验证脚本
 * 检查打包后的exe是否包含所有必要依赖
 */

const fs = require('fs');
const path = require('path');

// 打包输出目录
const DIST_DIR = path.join(__dirname, '..', 'dist-electron', 'win-unpacked');
const RESOURCES_DIR = path.join(DIST_DIR, 'resources');
const UNPACKED_DIR = path.join(RESOURCES_DIR, 'app.asar.unpacked');
const UNPACKED_MODULES = path.join(UNPACKED_DIR, 'node_modules');

// 必须存在的核心依赖
const REQUIRED_MODULES = [
  'express',
  'axios',
  'body-parser',
  'multer',
  'archiver',
  'zod',
  'dotenv',
  'bytenode',
  'follow-redirects',
  'form-data',
  'mime',
  'asynckit',
  'combined-stream',
  'delayed-stream',
];

// 必须存在的服务端脚本（只检查 JS 文件，不使用字节码）
// 字节码在 Electron 内置 Node.js 版本下不兼容，保留原始 JS 文件
const REQUIRED_SERVER_FILES = [
  'dist/src/server/local-server.js',
  'dist/src/server/auth-guard.js',
];

console.log('='.repeat(60));
console.log('Electron 打包验证');
console.log('='.repeat(60));
console.log();

// 检查目录是否存在
console.log('[1] 检查打包目录结构...');
console.log('    打包目录:', DIST_DIR);
console.log('    存在:', fs.existsSync(DIST_DIR) ? '✓' : '✗');
console.log('    Resources:', RESOURCES_DIR);
console.log('    存在:', fs.existsSync(RESOURCES_DIR) ? '✓' : '✗');
console.log('    Unpacked:', UNPACKED_DIR);
console.log('    存在:', fs.existsSync(UNPACKED_DIR) ? '✓' : '✗');
console.log('    Unpacked node_modules:', UNPACKED_MODULES);
console.log('    存在:', fs.existsSync(UNPACKED_MODULES) ? '✓' : '✗');
console.log();

if (!fs.existsSync(UNPACKED_MODULES)) {
  console.log('❌ 错误: app.asar.unpacked/node_modules 不存在');
  console.log('   请先运行 npm run electron:build');
  process.exit(1);
}

// 检查核心依赖
console.log('[2] 检查核心依赖模块...');
let missingModules = [];
let foundModules = [];

for (const mod of REQUIRED_MODULES) {
  const modPath = path.join(UNPACKED_MODULES, mod);
  const exists = fs.existsSync(modPath);
  if (exists) {
    foundModules.push(mod);
    console.log(`    ✓ ${mod}`);
  } else {
    missingModules.push(mod);
    console.log(`    ✗ ${mod} (缺失)`);
  }
}
console.log();

if (missingModules.length > 0) {
  console.log('❌ 错误: 以下核心依赖缺失:');
  missingModules.forEach(m => console.log(`   - ${m}`));
  console.log();
  console.log('   修复方法: 检查 package.json 的 asarUnpack 配置是否包含这些依赖');
  console.log('   然后重新运行 npm run electron:build');
} else {
  console.log('✓ 所有核心依赖都已正确解包');
}
console.log();

// 检查服务端脚本
console.log('[3] 检查服务端脚本...');
let missingScripts = [];
let foundScripts = [];

for (const file of REQUIRED_SERVER_FILES) {
  const filePath = path.join(UNPACKED_DIR, file);
  const exists = fs.existsSync(filePath);
  if (exists) {
    foundScripts.push(file);
    console.log(`    ✓ ${file}`);
  } else {
    missingScripts.push(file);
    console.log(`    ✗ ${file} (缺失)`);
  }
}
console.log();

// 检查服务端 JS 文件格式（不应是 bytecode loader）
console.log('[4] 检查服务端 JS 文件格式...');
const localServerJs = path.join(UNPACKED_DIR, 'dist/src/server/local-server.js');
if (fs.existsSync(localServerJs)) {
  const stats = fs.statSync(localServerJs);
  const content = fs.readFileSync(localServerJs, 'utf-8');
  
  // 检查文件大小 - bytecode loader 只有几十字节，原始 JS 文件应该很大
  if (stats.size < 1000) {
    console.log(`    ✗ local-server.js 文件太小 (${stats.size} bytes)，可能是 bytecode loader`);
    missingScripts.push('local-server.js size');
  } else if (content.includes('require(\'bytenode\')')) {
    console.log('    ✗ local-server.js 是 bytecode loader，不应使用字节码');
    missingScripts.push('local-server.js bytecode');
  } else {
    console.log(`    ✓ local-server.js 是原始 JS 文件 (${Math.round(stats.size/1024)} KB)`);
  }
}
console.log();

// 检查额外资源
console.log('[5] 检查额外资源...');
const extraResources = [
  { name: 'configs', path: path.join(RESOURCES_DIR, 'configs') },
  { name: 'openclaw', path: path.join(RESOURCES_DIR, 'openclaw') },
  { name: 'sci_writing_skills', path: path.join(RESOURCES_DIR, 'sci_writing_skills') },
];

for (const res of extraResources) {
  const exists = fs.existsSync(res.path);
  console.log(`    ${exists ? '✓' : '✗'} ${res.name}`);
}
console.log();

// 检查 Electron 视图
console.log('[6] 检查 Electron 视图文件...');
const viewsDir = path.join(UNPACKED_DIR, 'dist/electron/views');
const viewFiles = ['login.html', 'login.css', 'login.js', 'purchase-guide.html'];

if (fs.existsSync(viewsDir)) {
  for (const file of viewFiles) {
    const filePath = path.join(viewsDir, file);
    const exists = fs.existsSync(filePath);
    console.log(`    ${exists ? '✓' : '✗'} ${file}`);
  }
} else {
  console.log('    ✗ views 目录不存在');
}
console.log();

// 总结
console.log('='.repeat(60));
console.log('验证总结');
console.log('='.repeat(60));

const totalIssues = missingModules.length + missingScripts.length;

if (totalIssues === 0) {
  console.log('✓ 所有检查通过，打包结构正确');
  console.log();
  console.log('下一步:');
  console.log('  1. 运行 dist-electron/win-unpacked/Scholar Harness.exe');
  console.log('  2. 查看启动日志: %APPDATA%/scholar-harness/data/startup.log');
  console.log('  3. 测试登录功能');
  console.log();
  process.exit(0);
} else {
  console.log(`❌ 发现 ${totalIssues} 个问题`);
  console.log();
  console.log('建议修复步骤:');
  console.log('  1. 检查 package.json 的 asarUnpack 配置');
  console.log('  2. 确保 npm install 已完成');
  console.log('  3. 重新运行 npm run electron:build');
  console.log();
  process.exit(1);
}