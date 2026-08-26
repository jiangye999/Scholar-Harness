import { readFileSync } from 'fs';
import * as path from 'path';

import { describe, expect, it } from 'vitest';

const electronMain = readFileSync(path.resolve(process.cwd(), 'electron/main.ts'), 'utf-8');
const preload = readFileSync(path.resolve(process.cwd(), 'electron/preload.ts'), 'utf-8');
const shellNavigation = readFileSync(
  path.resolve(process.cwd(), 'src/public/app/shell-navigation.js'),
  'utf-8',
);
const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf-8')) as {
  scripts?: Record<string, string>;
};

describe('Electron frameless window-control IPC', () => {
  it('invokes minimize, maximize and close and receives the real main-process result', () => {
    expect(preload).toContain("ipcRenderer.invoke('window-control', action)");
    expect(preload).toContain("ipcRenderer.send('window-control-action', action)");
    expect(preload).not.toContain('return Promise.resolve({ success: true })');
    expect(shellNavigation).toContain('result.success !== true');
  });

  it('rebuilds the Electron main process and preload during every normal build', () => {
    expect(packageJson.scripts?.build).toContain('tsc -p electron/tsconfig.json');
  });

  it('controls the BrowserWindow owned by the sender with a trusted main-window fallback', () => {
    expect(electronMain).toContain('BrowserWindow.fromWebContents(sender)');
    expect(electronMain).toContain('mainWindow.webContents === sender');
    expect(electronMain).toContain("case 'minimize':");
    expect(electronMain).toContain("case 'maximize':");
    expect(electronMain).toContain("case 'close':");
  });

  it('keeps both the result-bearing channel and the old one-way compatibility channel', () => {
    expect(electronMain).toContain("ipcMain.handle('window-control'");
    expect(electronMain).toContain('return applyWindowControl(event.sender, action)');
    expect(electronMain).toContain("ipcMain.on('window-control-action'");
  });
});
