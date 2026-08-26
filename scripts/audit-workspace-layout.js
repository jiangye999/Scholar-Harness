#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const allowedDirectories = new Set([
  '.agents', '.codex', '.github', '.vscode', '__tests__', 'agents', 'artifacts',
  'assets', 'cloud', 'configs', 'data', 'docker', 'docs', 'electron', 'examples',
  'openclaw', 'plugins', 'prompts', 'scholarharness-website', 'sci_writing_skills',
  'scripts', 'skill-packs', 'skills', 'src', 'tools', 'workflows',
]);
const generatedDirectories = new Set([
  '.next', 'backup', 'coverage', 'dist', 'dist-electron', 'downloads',
  'node_modules', 'out', 'release', 'tmp',
]);
const allowedRootFiles = new Set([
  '.dockerignore', '.env.example', '.gitignore', 'AGENTS.md', 'CHANGELOG.md',
  'CLAUDE.md', 'Dockerfile', 'LICENSE', 'README.md', 'docker-compose.yml',
  'package-lock.json', 'package.json', 'tsconfig.json', 'vitest.config.ts',
]);
const suspiciousName = /(?:^|[._-])(tmp|temp|debug|diag|diagnostic|measure|scratch|backup|copy|old|test-output|render|preview|log)(?:[._-]|$)/i;
const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
const unexpectedDirectories = [];
const suspiciousRootFiles = [];
const generated = [];

for (const entry of entries) {
  if (entry.name === '.git') continue;
  if (entry.isDirectory()) {
    if (generatedDirectories.has(entry.name)) generated.push(entry.name);
    else if (!allowedDirectories.has(entry.name)) unexpectedDirectories.push(entry.name);
    continue;
  }
  if (!allowedRootFiles.has(entry.name) && suspiciousName.test(entry.name)) {
    suspiciousRootFiles.push(entry.name);
  }
}

const nextActions = [];
if (suspiciousRootFiles.length || unexpectedDirectories.length) {
  nextActions.push('先人工确认审计清单；不要对脏工作树运行 git clean。');
  nextActions.push('临时代码、日志、裁剪图和实验输出统一移入 artifacts/scratch/。');
}
if (generated.length) {
  nextActions.push('构建产物按 clean:build、clean:electron-staging 和独立发布保留策略管理。');
}

console.log(JSON.stringify({
  status: suspiciousRootFiles.length || unexpectedDirectories.length ? 'attention' : 'clean',
  summary: `根目录发现 ${suspiciousRootFiles.length} 个可疑文件、${unexpectedDirectories.length} 个未登记目录、${generated.length} 个生成目录`,
  next_actions: nextActions,
  artifacts: {
    suspicious_root_files: suspiciousRootFiles.sort(),
    unexpected_directories: unexpectedDirectories.sort(),
    generated_directories: generated.sort(),
  },
}, null, 2));
