#!/usr/bin/env node
/* Clean the AI scratch directory (artifacts/scratch).
 * All temporary code, crops, logs and experiment outputs produced by an agent
 * during a task MUST live under artifacts/scratch. This script wipes its
 * contents after a task finishes and recreates the folder with a marker README.
 *
 * Safety: the resolved target is verified to be exactly <repo>/artifacts/scratch
 * before anything is removed. It never touches paths outside that directory.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SCRATCH_REL = path.join('artifacts', 'scratch');

function fail(message) {
  console.error(`clean-scratch: ${message}`);
  process.exit(1);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const scratch = path.resolve(repoRoot, SCRATCH_REL);

  if (path.dirname(scratch) !== path.resolve(repoRoot, 'artifacts')) {
    fail(`unexpected scratch path ${scratch}`);
  }

  const removed = [];
  let freedBytes = 0;

  if (fs.existsSync(scratch)) {
    const stat = fs.statSync(scratch);
    if (!stat.isDirectory()) {
      fail(`${scratch} is not a directory; refusing to remove`);
    }
    for (const entry of fs.readdirSync(scratch)) {
      const target = path.join(scratch, entry);
      const st = fs.statSync(target);
      const entrySize = st.isDirectory() ? dirSize(target) : st.size;
      fs.rmSync(target, { recursive: true, force: true });
      freedBytes += entrySize;
      removed.push(entry);
    }
  }

  fs.mkdirSync(scratch, { recursive: true });
  const readme = path.join(scratch, 'README.md');
  fs.writeFileSync(
    readme,
    [
      '# artifacts/scratch',
      '',
      'AI 会话临时目录：所有临时代码、裁剪图、日志与实验产物都在这里。',
      '任务结束（P5 收敛）后运行 `npm run clean:scratch` 清空本目录。',
      '',
    ].join('\n'),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        status: 'success',
        summary: removed.length
          ? `已清除 ${removed.length} 项，释放约 ${formatBytes(freedBytes)}`
          : 'scratch 已为空',
        removed,
        freed_bytes: freedBytes,
        scratch,
      },
      null,
      2
    )
  );
}

function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += dirSize(full);
    } else {
      total += fs.statSync(full).size;
    }
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

main();
