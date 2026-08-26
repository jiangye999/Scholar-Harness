import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';

import { describe, expect, it } from 'vitest';

import {
  captureRuntimeCommand,
  resolveRuntimeExecutable,
  resolveNpmNodeShim,
  selectWindowsRuntimeExecutable,
  spawnRuntimeExecutable,
} from '../../src/bridge/agent-runtime/process-utils';

describe('Coding Agent runtime executable resolution', () => {
  it('resolves an npm cmd shim to its direct node entry point', () => {
    if (process.platform !== 'win32') return;
    const executable = resolveRuntimeExecutable('', ['pi']);
    expect(executable).toMatch(/\.cmd$/i);
    const shim = resolveNpmNodeShim(executable || '');

    expect(shim?.node).toMatch(/node\.exe$/i);
    expect(shim?.script).toMatch(/[\\/]pi-coding-agent[\\/]dist[\\/]cli\.js$/i);
  });

  it('prefers npm.cmd over the extensionless Windows npm shim', () => {
    const extensionless = 'C:\\Program Files\\nodejs\\npm';
    const commandShim = `${extensionless}.cmd`;
    const existing = new Set([extensionless, commandShim]);

    expect(selectWindowsRuntimeExecutable(
      [extensionless, commandShim],
      candidate => existing.has(candidate),
    )).toBe(commandShim);
  });

  it('expands an explicit extensionless Windows path to its runnable shim', () => {
    const extensionless = 'C:\\Users\\tester\\AppData\\Roaming\\npm\\opencode';
    const commandShim = `${extensionless}.cmd`;

    expect(selectWindowsRuntimeExecutable(
      [extensionless],
      candidate => candidate === commandShim,
    )).toBe(commandShim);
  });

  it('ignores unsupported Windows script extensions', () => {
    const powershellShim = 'C:\\Program Files\\nodejs\\npm.ps1';

    expect(selectWindowsRuntimeExecutable(
      [powershellShim],
      candidate => candidate === powershellShim,
    )).toBeNull();
  });

  it('resolves the local npm installation to a spawnable Windows command', async () => {
    if (process.platform !== 'win32') return;
    const executable = resolveRuntimeExecutable('', ['npm']);

    expect(executable).toBeTruthy();
    expect(executable).toMatch(/\.(?:cmd|exe|com|bat)$/i);
    expect(executable).not.toMatch(/[\\/]npm$/i);
    const result = await captureRuntimeCommand(executable || '', ['--version'], { timeoutMs: 20_000 });
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+/);
  });

  it('passes JSONL stdin through the installed Pi npm shim', async () => {
    if (process.platform !== 'win32') return;
    const executable = resolveRuntimeExecutable('', ['pi']);
    if (!executable || !resolveNpmNodeShim(executable)) return;
    const sessionDir = mkdtempSync(path.join(os.tmpdir(), 'scholar-pi-rpc-probe-'));
    const child = spawnRuntimeExecutable(executable, [
      '--mode', 'rpc', '--session-dir', sessionDir, '--name', 'Scholar Harness Test Probe',
    ], { cwd: sessionDir, env: { PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0' } });

    try {
      const response = await new Promise<Record<string, unknown>>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('Pi get_state integration probe timed out')), 20_000);
        child.stdout?.on('data', chunk => {
          output += String(chunk);
          const line = output.split(/\r?\n/).find(item => item.trim().startsWith('{'));
          if (!line) return;
          clearTimeout(timer);
          try { resolve(JSON.parse(line) as Record<string, unknown>); }
          catch (error) { reject(error); }
        });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.stdin?.write(`${JSON.stringify({ id: 'probe', type: 'get_state' })}\n`);
      });

      expect(response).toMatchObject({ type: 'response', command: 'get_state', success: true });
    } finally {
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, 3_000);
        child.once('close', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
      rmSync(sessionDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  }, 30_000);
});
