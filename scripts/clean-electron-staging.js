#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const outputRoot = path.resolve(repoRoot, 'dist-electron');
const stagingNames = ['win-unpacked', 'linux-unpacked', 'mac', 'mac-arm64', 'mac-universal'];
const removed = [];

for (const name of stagingNames) {
  const target = path.resolve(outputRoot, name);
  if (path.dirname(target) !== outputRoot || path.basename(target) !== name) {
    throw new Error(`Refusing to clean unexpected Electron staging path: ${target}`);
  }
  if (!fs.existsSync(target)) continue;
  const stat = fs.lstatSync(target);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Refusing to clean non-directory Electron staging target: ${target}`);
  }
  fs.rmSync(target, { recursive: true, force: true });
  removed.push(target);
}

console.log(JSON.stringify({
  status: 'success',
  summary: removed.length
    ? `已清理 ${removed.length} 个 Electron 解包 staging 目录；历史安装包未删除`
    : 'Electron staging 已为空；历史安装包未删除',
  artifacts: removed,
}, null, 2));
