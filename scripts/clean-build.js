#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const target = path.resolve(repoRoot, 'dist');

if (path.dirname(target) !== repoRoot || path.basename(target) !== 'dist') {
  throw new Error(`Refusing to clean unexpected build path: ${target}`);
}

if (fs.existsSync(target)) {
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing to clean non-directory build target: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
}

console.log(JSON.stringify({
  status: 'success',
  summary: '已清理 TypeScript 构建目录，下一次编译不会夹带陈旧文件',
  artifacts: [target],
}, null, 2));
