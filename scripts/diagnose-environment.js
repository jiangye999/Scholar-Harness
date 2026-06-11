#!/usr/bin/env node
/**
 * 环境诊断脚本
 * 用于对比开发环境 vs 打包环境
 */

console.log('\n========================================');
console.log('  Scholar Harness 环境诊断');
console.log('========================================\n');

// 1. 基本信息
console.log('【基本信息】');
console.log('  Node 版本:', process.version);
console.log('  平台:', process.platform);
console.log('  架构:', process.arch);
console.log('  当前工作目录:', process.cwd());

// 2. 环境变量
console.log('\n【关键环境变量】');
console.log('  OPENCLAW_DIR:', process.env.OPENCLAW_DIR || '(未设置)');
console.log('  DATA_DIR:', process.env.DATA_DIR || '(未设置)');
console.log('  SKILL_DIR:', process.env.SKILL_DIR || '(未设置)');
console.log('  PUBLIC_DIR:', process.env.PUBLIC_DIR || '(未设置)');
console.log('  ELECTRON_RUN_AS_NODE:', process.env.ELECTRON_RUN_AS_NODE || '(未设置)');

// 3. 打包相关
console.log('\n【打包环境】');
console.log('  process.resourcesPath:', process.resourcesPath || '(未设置)');
console.log('  process.execPath:', process.execPath);
console.log('  __dirname:', __dirname);
console.log('  __filename:', __filename);

// 4. openclaw 路径检查
const path = require('path');
const fs = require('fs');

const possibleOpenclawPaths = [
  process.env.OPENCLAW_DIR,
  process.resourcesPath ? path.join(process.resourcesPath, 'openclaw') : null,
  path.join(process.cwd(), 'openclaw'),
  path.join(__dirname, '..', '..', '..', 'openclaw'),
  path.join(__dirname, '..', '..', '..', '..', 'openclaw'),
].filter(Boolean);

console.log('\n【openclaw 路径检查】');
for (const p of possibleOpenclawPaths) {
  const exists = fs.existsSync(p);
  const indexExists = exists && fs.existsSync(path.join(p, 'index.js'));
  const nodeModulesExists = exists && fs.existsSync(path.join(p, 'node_modules'));
  
  console.log(`\n  路径: ${p}`);
  console.log('    目录存在:', exists ? '✅' : '❌');
  if (exists) {
    console.log('    index.js:', indexExists ? '✅' : '❌');
    console.log('    node_modules:', nodeModulesExists ? '✅' : '❌');
    
    if (nodeModulesExists) {
      const playwrightExists = fs.existsSync(path.join(p, 'node_modules', 'playwright'));
      const commanderExists = fs.existsSync(path.join(p, 'node_modules', 'commander'));
      console.log('    playwright:', playwrightExists ? '✅' : '❌');
      console.log('    commander:', commanderExists ? '✅' : '❌');
    }
  }
}

// 5. 测试 spawn
console.log('\n【spawn 测试】');
const { spawn } = require('child_process');

const openclawPath = process.env.OPENCLAW_DIR || path.join(process.cwd(), 'openclaw');
const indexPath = path.join(openclawPath, 'index.js');

if (fs.existsSync(indexPath)) {
  console.log('  尝试运行: node index.js --version');
  const test = spawn('node', ['index.js', '--version'], {
    cwd: openclawPath,
    timeout: 5000
  });
  
  let output = '';
  test.stdout.on('data', (data) => {
    output += data.toString();
  });
  
  test.stderr.on('data', (data) => {
    output += data.toString();
  });
  
  test.on('close', (code) => {
    console.log('  退出码:', code);
    console.log('  输出:', output.trim() || '(无)');
    if (code === 0) {
      console.log('  ✅ openclaw 可执行');
    } else {
      console.log('  ❌ openclaw 执行失败');
    }
    
    // 6. 总结
    console.log('\n========================================');
    console.log('  诊断完成');
    console.log('========================================\n');
  });
  
  test.on('error', (err) => {
    console.log('  ❌ 执行错误:', err.message);
    console.log('\n========================================');
    console.log('  诊断完成');
    console.log('========================================\n');
  });
} else {
  console.log('  ❌ index.js 不存在:', indexPath);
  console.log('\n========================================');
  console.log('  诊断完成');
  console.log('========================================\n');
}