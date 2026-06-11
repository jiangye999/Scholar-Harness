/**
 * Run bytenode compilation with Electron's embedded Node/V8.
 *
 * V8 cached bytecode is only compatible with the V8 version that created it.
 * The packaged app starts the local server through Electron with
 * ELECTRON_RUN_AS_NODE=1, so compiling .jsc files with the system Node can
 * make the installed app fail at startup with cachedDataRejected.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const electronPath = require('electron');
const compilerPath = path.join(__dirname, 'compile-bytecode.js');

const result = spawnSync(electronPath, [compilerPath], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
  },
  stdio: 'inherit',
});

if (result.error) {
  console.error('[Bytecode] Failed to launch Electron compiler:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
