import { app, BrowserWindow, Menu, shell, dialog, ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as os from 'os';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';

let mainWindow: BrowserWindow | null = null;
let loginWindow: BrowserWindow | null = null;
let activationWindow: BrowserWindow | null = null;
let userInfoWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let serverStartPromise: Promise<void> | null = null;
let windowTransitionInProgress = false;
const PORT = 18789;
const AUTH_VALIDATION_TIMEOUT_MS = 15000;
const AUTH_VALIDATION_RETRIES = 3;
const UPDATE_MANIFEST_URL = process.env.SCHOLAR_HARNESS_UPDATE_MANIFEST_URL || 'https://scholarharness.com/downloads/latest.json';
const UPDATE_CHECK_TIMEOUT_MS = 10000;

interface AppUpdateManifest {
  version?: string;
  downloadUrl?: string;
  releaseNotes?: string;
  publishedAt?: string;
}

let updateCheckInProgress = false;
let startupUpdateCheckScheduled = false;

function finishWindowTransitionSoon(): void {
  setTimeout(() => {
    windowTransitionInProgress = false;
  }, 500);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });
}

function getDataDir(): string {
  const userDataPath = app.getPath('userData');
  const dataDir = path.join(userDataPath, 'data');
  
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  return dataDir;
}

/**
 * 启动日志文件
 */
function startupLog(message: string): void {
  const logFile = path.join(getDataDir(), 'startup.log');
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}\n`;
  
  try {
    fs.appendFileSync(logFile, logLine, 'utf-8');
    console.log(`[Electron] ${message}`);
  } catch (e) {
    console.error(`[Electron] Failed to write log: ${(e as Error).message}`);
  }
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, '')
    .split(/[^\d]+/)
    .filter(Boolean)
    .map(part => Number.parseInt(part, 10))
    .filter(part => Number.isFinite(part));
}

function compareVersions(left: string, right: string): number {
  const leftParts = normalizeVersion(left);
  const rightParts = normalizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index++) {
    const leftPart = leftParts[index] || 0;
    const rightPart = rightParts[index] || 0;

    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function requestJson(url: string, redirectCount = 0): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      reject(new Error(`无效更新地址：${url}`));
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;
    const req = client.get(parsedUrl, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': `ScholarHarness/${app.getVersion()}`,
      },
    }, (res) => {
      const statusCode = res.statusCode || 0;
      const location = res.headers.location;

      if (statusCode >= 300 && statusCode < 400 && location && redirectCount < 3) {
        res.resume();
        const redirectUrl = new URL(location, parsedUrl).toString();
        requestJson(redirectUrl, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        res.resume();
        reject(new Error(`更新清单请求失败：HTTP ${statusCode}`));
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          res.destroy(new Error('更新清单过大'));
        }
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('更新清单不是有效 JSON'));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(UPDATE_CHECK_TIMEOUT_MS, () => {
      req.destroy(new Error('更新检查请求超时'));
    });
  });
}

async function fetchUpdateManifest(): Promise<AppUpdateManifest> {
  const data = await requestJson(UPDATE_MANIFEST_URL);
  if (!data || typeof data !== 'object') {
    throw new Error('更新清单格式无效');
  }

  const manifest = data as AppUpdateManifest;
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error('更新清单缺少 version');
  }
  if (!manifest.downloadUrl || typeof manifest.downloadUrl !== 'string' || !/^https?:\/\//i.test(manifest.downloadUrl)) {
    throw new Error('更新清单缺少有效 downloadUrl');
  }

  return manifest;
}

function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() || mainWindow || loginWindow || activationWindow || userInfoWindow || undefined;
}

async function showMessageBox(options: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const parent = getDialogParent();
  return parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options);
}

async function checkForAppUpdate(options: { silent?: boolean } = {}): Promise<void> {
  if (updateCheckInProgress) return;

  updateCheckInProgress = true;
  try {
    const manifest = await fetchUpdateManifest();
    const latestVersion = manifest.version;
    const downloadUrl = manifest.downloadUrl;
    if (!latestVersion || !downloadUrl) {
      throw new Error('更新清单缺少必要字段');
    }

    const currentVersion = app.getVersion();

    if (compareVersions(latestVersion, currentVersion) <= 0) {
      if (!options.silent) {
        await showMessageBox({
          type: 'info',
          title: '检查更新',
          message: '当前已是最新版本',
          detail: `当前版本：${currentVersion}`,
          buttons: ['确定'],
        });
      }
      return;
    }

    const detailLines = [
      `当前版本：${currentVersion}`,
      `最新版本：${latestVersion}`,
      manifest.publishedAt ? `发布时间：${manifest.publishedAt}` : '',
      manifest.releaseNotes ? `\n更新说明：\n${manifest.releaseNotes}` : '',
    ].filter(Boolean);

    const result = await showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `发现 Scholar Harness ${latestVersion}`,
      detail: detailLines.join('\n'),
      buttons: ['立即下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      await shell.openExternal(downloadUrl);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    startupLog(`Update check failed: ${message}`);
    if (!options.silent) {
      await showMessageBox({
        type: 'warning',
        title: '检查更新失败',
        message: '暂时无法检查更新',
        detail: message,
        buttons: ['确定'],
      });
    }
  } finally {
    updateCheckInProgress = false;
  }
}

function scheduleStartupUpdateCheck(): void {
  if (!app.isPackaged || startupUpdateCheckScheduled) return;

  startupUpdateCheckScheduled = true;
  setTimeout(() => {
    checkForAppUpdate({ silent: true }).catch(error => {
      startupLog(`Scheduled update check failed: ${(error as Error).message}`);
    });
  }, 12000);
}

/**
 * 获取 openclaw 目录路径
 */
function getOpenclawDir(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'openclaw');
  }
  return path.join(process.cwd(), 'openclaw');
}

/**
 * 检查 Playwright 浏览器是否可用
 * 优先级：打包的 browsers 目录 > 系统缓存目录
 */
function checkPlaywrightBrowser(): boolean {
  const openclawDir = getOpenclawDir();
  const playwrightModulePath = path.join(openclawDir, 'node_modules', 'playwright');
  
  startupLog(`Checking Playwright at: ${playwrightModulePath}`);
  
  // 检查 playwright 模块是否存在
  if (!fs.existsSync(playwrightModulePath)) {
    startupLog('Playwright module not found');
    return false;
  }
  
  // 优先检查打包的浏览器目录
  const packagedBrowsersPath = path.join(openclawDir, 'browsers');
  startupLog(`Packaged browsers path: ${packagedBrowsersPath}`);
  
  if (fs.existsSync(packagedBrowsersPath)) {
    const browsers = fs.readdirSync(packagedBrowsersPath);
    const hasChromium = browsers.some(f => f.startsWith('chromium-'));
    
    startupLog(`Packaged browsers found: ${browsers.join(', ')}`);
    startupLog(`Chromium available in packaged: ${hasChromium}`);
    
    if (hasChromium) {
      startupLog('✅ Using packaged Chromium browser');
      return true;
    }
  }
  
  // 检查 browser-info.json（打包时生成的标记文件）
  const browserInfoPath = path.join(openclawDir, 'browser-info.json');
  if (fs.existsSync(browserInfoPath)) {
    try {
      const browserInfo = JSON.parse(fs.readFileSync(browserInfoPath, 'utf-8'));
      if (browserInfo.browsersPath && browserInfo.installedBrowsers) {
        const browsersPath = path.join(openclawDir, browserInfo.browsersPath);
        if (fs.existsSync(browsersPath)) {
          const hasChromium = browserInfo.installedBrowsers.some((f: string) => f.startsWith('chromium-'));
          if (hasChromium) {
            startupLog('✅ Found packaged browsers from browser-info.json');
            return true;
          }
        }
      }
    } catch (e) {
      startupLog(`Failed to read browser-info.json: ${(e as Error).message}`);
    }
  }
  
  // 最后检查系统缓存目录（Windows: LOCALAPPDATA/ms-playwright）
  const playwrightCachePath = path.join(process.env.LOCALAPPDATA || os.homedir(), 'ms-playwright');
  
  startupLog(`System Playwright cache: ${playwrightCachePath}`);
  
  if (!fs.existsSync(playwrightCachePath)) {
    startupLog('System Playwright cache not found');
    return false;
  }
  
  // 检查 chromium 是否存在
  const browsers = fs.readdirSync(playwrightCachePath);
  const hasChromium = browsers.some(f => f.startsWith('chromium-'));
  
  startupLog(`System browsers found: ${browsers.join(', ')}`);
  startupLog(`Chromium available in system: ${hasChromium}`);
  
  return hasChromium;
}

/**
 * 验证启动要求
 */
async function validateStartupRequirements(): Promise<{ valid: boolean; message: string }> {
  startupLog('Validating startup requirements...');
  
  // 1. 检查 openclaw 目录
  const openclawDir = getOpenclawDir();
  const openclawIndex = path.join(openclawDir, 'index.js');
  
  if (!fs.existsSync(openclawIndex)) {
    return { valid: false, message: 'openclaw 模块缺失，请重新安装应用' };
  }
  startupLog('✅ openclaw/index.js exists');
  
  // 2. 检查 Playwright 浏览器
  const playwrightOk = checkPlaywrightBrowser();
  if (!playwrightOk) {
    startupLog('⚠️ Playwright browser not available');
    // 返回需要安装浏览器
    return { valid: false, message: '需要安装浏览器自动化组件（首次启动时自动安装）' };
  }
  startupLog('✅ Playwright browser available');
  
  return { valid: true, message: 'OK' };
}

function getSkillDir(): string {
  if (app.isPackaged) {
    const skillPath = path.join(process.resourcesPath, 'sci_writing_skills');
    console.log('[Electron] Checking skill dir:', skillPath);
    console.log('[Electron] Resources path:', process.resourcesPath);
    if (fs.existsSync(skillPath)) {
      return skillPath;
    }
  }
  return path.join(process.cwd(), 'sci_writing_skills');
}

function getServerPath(): string {
  if (app.isPackaged) {
    // Server JS is unpacked from asar (see asarUnpack in package.json)
    // Child process spawned with ELECTRON_RUN_AS_NODE=1 cannot read from asar,
    // so we must use the unpacked path under app.asar.unpacked/
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'src', 'server', 'local-server.js');
  }
  return path.join(process.cwd(), 'dist', 'src', 'server', 'local-server.js');
}

function getUnpackedPath(relativePath: string): string {
  return path.join(process.resourcesPath, 'app.asar.unpacked', relativePath);
}

function getChatBridgeUserConfigPath(): string {
  return path.join(getDataDir(), 'chat-bridge-config.json');
}

/**
 * 检查端口是否被占用
 */
function checkPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const server = net.createServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
}

/**
 * 检查服务器是否健康（通过 health endpoint）
 */
async function checkServerHealth(expectedDataDir?: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${PORT}/health`, (res: any) => {
      if (res.statusCode !== 200) {
        resolve(false);
        return;
      }

      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        body += chunk;
      });
      res.on('end', () => {
        if (!expectedDataDir) {
          resolve(true);
          return;
        }
        try {
          const parsed = JSON.parse(body) as { dataDir?: unknown };
          const actualDataDir = path.resolve(String(parsed.dataDir || ''));
          const expected = path.resolve(expectedDataDir);
          resolve(actualDataDir.toLowerCase() === expected.toLowerCase());
        } catch {
          resolve(false);
        }
      });
    });
    
    req.on('error', () => {
      resolve(false);
    });
    
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * 尝试关闭占用端口的进程（仅 Windows）
 */
async function killProcessOnPort(port: number): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  
  return new Promise((resolve) => {
    const { exec } = require('child_process');
    exec(`netstat -ano | findstr :${port}`, (error: any, stdout: string) => {
      if (error || !stdout) {
        resolve(false);
        return;
      }
      
      // 提取 PID
      const lines = stdout.split('\n');
      for (const line of lines) {
        const match = line.match(/LISTENING\s+(\d+)/);
        if (match) {
          const pid = match[1];
          console.log(`[Electron] Found process ${pid} on port ${port}, killing...`);
          exec(`taskkill /F /PID ${pid}`, (err: any) => {
            if (err) {
              console.error(`[Electron] Failed to kill process ${pid}:`, err);
              resolve(false);
            } else {
              console.log(`[Electron] Killed process ${pid}`);
              resolve(true);
            }
          });
          return;
        }
      }
      resolve(false);
    });
  });
}

function startServer(): Promise<void> {
  return new Promise(async (resolve, reject) => {
    startupLog('Starting server process...');
    const dataDir = getDataDir();
    
    // 检查端口是否被占用
    const portInUse = await checkPortInUse(PORT);
    if (portInUse) {
      const healthyExistingServer = await checkServerHealth(dataDir);
      if (healthyExistingServer && app.isPackaged) {
        startupLog(`Port ${PORT} already has a healthy local server with matching DATA_DIR; reusing it`);
        resolve();
        return;
      }

      startupLog(
        healthyExistingServer
          ? `Port ${PORT} has a healthy dev server, replacing it to avoid stale routes after rebuild...`
          : `Port ${PORT} is in use but health check failed or DATA_DIR mismatched, attempting to free it...`
      );
      const killed = await killProcessOnPort(PORT);
      if (!killed) {
        // 等待端口释放
        await new Promise(r => setTimeout(r, 2000));
        const stillInUse = await checkPortInUse(PORT);
        if (stillInUse) {
          startupLog(`Port ${PORT} still in use, rejecting`);
          reject(new Error(`端口 ${PORT} 被占用。请关闭其他 Scholar Harness 实例后重试。`));
          return;
        }
      }
    }
    
    const skillDir = getSkillDir();
    const publicDir = app.isPackaged 
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'src', 'public')
      : path.join(process.cwd(), 'dist', 'src', 'public');
    const serverPath = getServerPath();
    const openclawDir = getOpenclawDir();
    
    startupLog(`App path: ${app.isPackaged ? app.getAppPath() : 'dev mode'}`);
    startupLog(`Server path: ${serverPath}`);
    startupLog(`Data dir: ${dataDir}`);
    startupLog(`Skill dir: ${skillDir}`);
    startupLog(`Public dir: ${publicDir}`);
    startupLog(`OpenClaw dir: ${openclawDir}`);
    
    console.log('[Electron] App path:', app.isPackaged ? app.getAppPath() : 'dev mode');
    console.log('[Electron] Server path:', serverPath);
    console.log('[Electron] Data dir:', dataDir);
    console.log('[Electron] Skill dir:', skillDir);
    console.log('[Electron] Public dir:', publicDir);
    console.log('[Electron] OpenClaw dir:', openclawDir);
    
    // 检查打包的浏览器目录
    const packagedBrowsersPath = path.join(openclawDir, 'browsers');
    const hasPackagedBrowsers = fs.existsSync(packagedBrowsersPath) && 
      fs.readdirSync(packagedBrowsersPath).some(f => f.startsWith('chromium-'));
    
    const envConfig: Record<string, string> = {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      SKILL_DIR: skillDir,
      PUBLIC_DIR: publicDir,
      OPENCLAW_DIR: openclawDir,
      CHAT_BRIDGE_CONFIG_PATH: getChatBridgeUserConfigPath(),
      ELECTRON_RUN_AS_NODE: '1',
    };
    
    // 如果存在打包的浏览器，设置环境变量
    if (hasPackagedBrowsers) {
      envConfig.PLAYWRIGHT_BROWSERS_PATH = packagedBrowsersPath;
      startupLog(`Packaged browsers found, setting PLAYWRIGHT_BROWSERS_PATH: ${packagedBrowsersPath}`);
      console.log('[Electron] Packaged browsers available:', packagedBrowsersPath);
    }
    
    startupLog(`Environment: PORT=${PORT}, DATA_DIR=${dataDir}, OPENCLAW_DIR=${openclawDir}`);
    
    // 检查服务器是否在运行（通过 stdout 日志或健康检查）
    let resolved = false;
    let attempts = 0;
    const maxAttempts = 120; // 最多等待 60 秒
    
    // 设置子进程工作目录，确保模块能正确加载
    const serverCwd = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked')
      : process.cwd();
    
    serverProcess = spawn(process.execPath, [serverPath], {
      env: envConfig,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: serverCwd,
    });
    
    serverProcess.stdout?.on('data', (data) => {
      const output = String(data);
      console.log(`[Server] ${output}`);
      startupLog(`[Server stdout] ${output.trim()}`);
      // 如果服务器输出了启动成功日志，视为服务器已启动
      if (!resolved && output.includes('running at http://localhost:')) {
        startupLog('Server startup detected from stdout');
        console.log('[Electron] Server startup detected from stdout');
        // 给服务器一点时间来完成初始化
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, 2000);
      }
    });
    
    serverProcess.stderr?.on('data', (data) => {
      const output = String(data);
      console.error(`[Server Error] ${output}`);
      startupLog(`[Server stderr] ${output.trim()}`);
    });
    
    serverProcess.on('error', (err) => {
      console.error('Failed to start server:', err);
      startupLog(`Server process error: ${err.message}`);
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });
    
    // 监听子进程退出事件，如果服务器进程崩溃立即报错
    serverProcess.on('exit', (code, signal) => {
      startupLog(`Server process exited with code ${code}, signal ${signal}`);
      console.error(`[Electron] Server process exited with code ${code}, signal ${signal}`);
      if (!resolved) {
        resolved = true;
        if (code !== 0) {
          reject(new Error(`本地服务器异常退出（退出码: ${code}）。可能是模块缺失，请检查日志: ${path.join(getDataDir(), 'startup.log')}`));
        } else {
          resolve();
        }
      } else if (code !== 0 && code !== null) {
        // 服务器启动成功后崩溃，尝试重启（最多3次）
        startupLog(`Server crashed after startup, attempting restart...`);
        console.error('[Electron] Server crashed after startup, attempting restart...');
        
        // 延迟重启，避免快速重启导致问题
        setTimeout(() => {
          startServer().then(() => {
            startupLog('Server restarted successfully');
            console.log('[Electron] Server restarted successfully');
          }).catch((restartError) => {
            startupLog(`Server restart failed: ${(restartError as Error).message}`);
            console.error('[Electron] Server restart failed:', restartError);
          });
        }, 2000);
      }
    });
    
    serverProcess.on('close', (code, signal) => {
      startupLog(`Server process closed with code ${code}, signal ${signal}`);
      if (!resolved) {
        resolved = true;
        if (code !== 0 && code !== null) {
          reject(new Error(`本地服务器异常关闭（退出码: ${code}）。请检查日志: ${path.join(getDataDir(), 'startup.log')}`));
        } else {
          resolve();
        }
      }
    });
    
    const checkServer = () => {
      if (resolved) return;
      attempts++;
      const req = http.get(`http://127.0.0.1:${PORT}/health`, (res: any) => {
        if (resolved) return;
        if (res.statusCode === 200) {
          resolved = true;
          console.log('[Electron] Server health check passed!');
          resolve();
        } else {
          if (attempts < maxAttempts) {
            setTimeout(checkServer, 500);
          } else if (!resolved) {
            resolved = true;
            const message = `本地服务器启动超时：/health 返回 ${res.statusCode}`;
            console.error('[Electron]', message);
            startupLog(message);
            reject(new Error(message));
          }
        }
      });
      
      req.on('error', () => {
        if (resolved) return;
        if (attempts < maxAttempts) {
          setTimeout(checkServer, 500);
        } else if (!resolved) {
          resolved = true;
          const message = `本地服务器启动超时：无法连接 http://127.0.0.1:${PORT}/health`;
          console.error('[Electron]', message);
          startupLog(message);
          reject(new Error(message));
        }
      });
      
      req.setTimeout(2000, () => {
        req.destroy();
        if (resolved) return;
        if (attempts < maxAttempts) {
          setTimeout(checkServer, 500);
        } else if (!resolved) {
          resolved = true;
          const message = `本地服务器启动超时：/health 请求超时`;
          console.error('[Electron]', message);
          startupLog(message);
          reject(new Error(message));
        }
      });
    };
    
    // 开始检测
    setTimeout(checkServer, 1000);
  });
}

async function ensureServerRunning(): Promise<void> {
  if (await checkServerHealth(getDataDir())) {
    return;
  }

  if (!serverStartPromise) {
    startupLog('Local server is not healthy; attempting to start it');
    serverStartPromise = startServer().finally(() => {
      serverStartPromise = null;
    });
  }

  await serverStartPromise;
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    startupLog('Main window already exists, focusing existing window');
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Scholar Harness - 学术论文写作助手',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'icon.ico')
      : path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      plugins: true,
      // 禁用缓存，确保每次加载最新版本
      partition: 'persist:scholar-harness',
      preload: app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'preload.js')
        : path.join(__dirname, 'preload.js'),
    },
    show: false,
  });

  let mainWindowShown = false;
  const showMainWindow = (reason: string): void => {
    if (mainWindowShown || !mainWindow || mainWindow.isDestroyed()) return;
    mainWindowShown = true;
    startupLog(`Showing main window (${reason})`);
    mainWindow.show();
    mainWindow.focus();
  };
  
  // 加载页面，添加错误处理
  // 清除缓存，确保加载最新版本
  mainWindow.webContents.session.clearCache().then(() => {
    console.log('[Electron] Cache cleared');
  }).catch((err) => {
    console.warn('[Electron] Failed to clear cache:', err);
  });
  
  mainWindow.loadURL(`http://127.0.0.1:${PORT}`).catch((err) => {
    console.error('[Electron] Failed to load page:', err);
    dialog.showErrorBox('加载失败', `无法加载应用页面：${err.message}\n\n请检查服务器是否正常运行。`);
    app.quit();
  });
  
  mainWindow.once('ready-to-show', () => {
    showMainWindow('ready-to-show');
  });

  mainWindow.webContents.once('did-finish-load', () => {
    showMainWindow('did-finish-load');
  });

  setTimeout(() => {
    showMainWindow('fallback-timeout');
  }, 5000);
  
  // 页面加载失败时的处理
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Electron] Page load failed:', errorCode, errorDescription);
    if (errorCode !== -3) { // 忽略中断错误
      dialog.showErrorBox('加载失败', `页面加载失败 (${errorCode}): ${errorDescription}`);
    }
  });
  
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(data|blob|about):/i.test(url)) {
      return { action: 'deny' };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            mainWindow?.reload();
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          },
        },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: async () => {
            dialog.showMessageBox(mainWindow!, {
              type: 'info',
              title: '关于 Scholar Harness',
              message: `Scholar Harness v${app.getVersion()}`,
              detail: '对话式学术论文写作助手\n\n开发团队：中国农业大学',
              buttons: ['确定'],
            });
          },
        },
        {
          label: '检查更新',
          click: async () => {
            await checkForAppUpdate({ silent: false });
          },
        },
        {
          label: '查看文档',
          click: async () => {
            shell.openExternal('https://github.com/your-repo/scholar-harness');
          },
        },
      ],
    },
  ];
  
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  startupLog('Application ready, starting validation...');
  scheduleStartupUpdateCheck();
  
  // 开发模式：检查是否需要打开窗口
  // 设置 ELECTRON_NO_WINDOW=1 环境变量可以禁止自动打开窗口
  const noWindow = process.env.ELECTRON_NO_WINDOW === '1';
  
  try {
    // 1. 验证启动要求
    const validation = await validateStartupRequirements();
    
    if (!validation.valid) {
      startupLog(`Validation failed: ${validation.message}`);
      
      // 如果是 Playwright 浏览器缺失，显示安装对话框
      if (validation.message.includes('浏览器自动化组件')) {
        startupLog('Showing Playwright installation dialog...');
        
        const result = dialog.showMessageBoxSync({
          type: 'info',
          title: '首次使用设置',
          message: 'Scholar Harness 需要安装浏览器自动化组件才能使用 AI 桥接功能。',
          detail: '点击"安装"将自动下载并安装浏览器组件（约 150MB，需要几分钟）。',
          buttons: ['安装', '稍后手动安装', '退出'],
          defaultId: 0,
          cancelId: 2,
        });
        
        if (result === 0) {
          // 用户选择安装
          startupLog('User chose to install Playwright...');
          try {
            // 显示安装进度窗口
            const installWindow = new BrowserWindow({
              width: 500,
              height: 300,
              resizable: false,
              frame: false,
              modal: true,
              webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
              },
            });
            
            installWindow.loadURL(`data:text/html,<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#f5f5f5;"><div style="text-align:center;"><h2>正在安装浏览器组件...</h2><p style="color:#666;">请稍候，这可能需要几分钟时间</p></div></body></html>`);
            
            // 执行安装
            const openclawDir = getOpenclawDir();
            startupLog(`Installing Playwright in: ${openclawDir}`);
            
            const { execSync } = require('child_process');
            execSync('npx playwright install chromium', {
              cwd: openclawDir,
              stdio: 'inherit',
              timeout: 300000, // 5 分钟超时
            });
            
            installWindow.close();
            startupLog('Playwright installed successfully!');
            
            // 继续启动
            startupLog('Starting server after Playwright installation...');
            await startServer();
            startupLog('Server started');
            
            // 显示登录窗口
            createLoginWindow();
          } catch (installError) {
            startupLog(`Playwright installation failed: ${(installError as Error).message}`);
            dialog.showErrorBox('安装失败', `浏览器组件安装失败：\n${(installError as Error).message}\n\n请手动运行：cd openclaw && npx playwright install chromium`);
            app.quit();
          }
        } else if (result === 1) {
          // 用户选择稍后安装
          startupLog('User chose manual installation, starting without Playwright...');
          startupLog('WARNING: AI bridge will not work until Playwright is installed');
          
          // 继续启动但 AI 桥接可能无法使用
          startupLog('Starting server...');
          await startServer();
          startupLog('Server started');
          
          createLoginWindow();
        } else {
          // 用户选择退出
          startupLog('User chose to exit');
          app.quit();
          return;
        }
      } else {
        // 其他验证失败
        dialog.showErrorBox('启动失败', validation.message);
        app.quit();
        return;
      }
    } else {
      // 验证通过，正常启动
      startupLog('Validation passed, starting server...');
      console.log('[Electron] Starting server...');
      await startServer();
      console.log('[Electron] Server started');
      startupLog('Server started successfully');
      
      // 开发模式：如果设置了 ELECTRON_NO_WINDOW=1，不创建窗口
      if (noWindow) {
        startupLog('ELECTRON_NO_WINDOW=1, skipping window creation');
        console.log('[Electron] Dev mode: No window requested, server running at http://localhost:' + PORT);
        return; // 不创建窗口，只运行服务器
      }
      
      // 检查是否需要登录
      const hasSession = await checkExistingSession();
      
      if (!hasSession) {
        // 无session，显示登录界面
        console.log('[Electron] No session found, showing login window');
        startupLog('No session found, showing login window');
        createLoginWindow();
      } else {
        // 有session，验证并创建主窗口
        console.log('[Electron] Session found, validating...');
        startupLog('Session found, validating...');
        const validationResult = await validateExistingSession();
        
        if (validationResult.valid) {
          console.log('[Electron] Session valid, creating main window');
          startupLog('Session valid, creating main window');
          createWindow();
        } else {
          // session无效，显示登录界面
          console.log('[Electron] Session invalid:', validationResult.reason);
          startupLog(`Session invalid: ${validationResult.reason}`);
          
          // 启动时的自动会话校验失败只静默回到登录页，避免打开软件时显示临时网络/超时提示。
          if (
            validationResult.reason === '未购买套餐'
            || validationResult.reason === '验证超时'
            || validationResult.reason === '网络连接失败'
            || validationResult.reason === '验证失败'
          ) {
            createLoginWindow();  // 不传递错误消息，静默显示登录界面
          } else {
            createLoginWindow(validationResult.reason);
          }
        }
      }
    }
  } catch (error) {
    console.error('[Electron] Failed to start:', error);
    startupLog(`Failed to start: ${(error as Error).message}`);
    dialog.showErrorBox('启动失败', `无法启动服务器：${error}\n\n日志文件位于：${path.join(getDataDir(), 'startup.log')}`);
    app.quit();
  }
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

async function checkActivation(): Promise<{ valid: boolean; message: string }> {
  try {
    if (app.isPackaged) {
      const activationPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'activation', 'client.js');
      
      if (!fs.existsSync(activationPath)) {
        console.warn('[Electron] Activation module not found:', activationPath);
        return { valid: true, message: '激活模块缺失，允许离线模式' };
      }
      
      const { ActivationClient } = require(activationPath);
      const client = new ActivationClient();
      await client.initialize();
      return client.verify();
    } else {
      return { valid: true, message: 'Dev mode' };
    }
  } catch (error) {
    console.error('[Electron] Activation check failed:', error);
    return { valid: false, message: '验证失败' };
  }
}

function createActivationWindow(reason: string): void {
  activationWindow = new BrowserWindow({
    width: 500,
    height: 400,
    resizable: false,
    title: 'Scholar Harness - 激活',
    icon: path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  
  activationWindow.loadURL(`http://127.0.0.1:${PORT}/activation`);
  
  activationWindow.on('closed', () => {
    activationWindow = null;
    if (!windowTransitionInProgress) {
      app.quit();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  console.log('[Electron] before-quit: killing child processes...');
  if (serverProcess) {
    try {
      // Windows 需要使用 'taskkill' 来终止进程树
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
      } else {
        serverProcess.kill('SIGKILL');
      }
    } catch (e) {
      console.error('[Electron] Failed to kill server process:', e);
    }
  }
});

app.on('will-quit', () => {
  console.log('[Electron] will-quit: ensuring child processes are killed...');
  // already handled in before-quit, but double-check
  if (serverProcess && serverProcess.pid) {
    try {
      spawn('taskkill', ['/pid', String(serverProcess.pid), '/f', '/t']);
    } catch (e) {}
  }
});

ipcMain.handle('activation-complete', async () => {
  console.log('[Electron] Activation complete, starting main app');
  
  if (activationWindow) {
    windowTransitionInProgress = true;
    activationWindow.close();
    activationWindow = null;
  }
  
  try {
    await startServer();
    createWindow();
    finishWindowTransitionSoon();
    return { success: true };
  } catch (error) {
    windowTransitionInProgress = false;
    console.error('[Electron] Failed to start after activation:', error);
    dialog.showErrorBox('启动失败', `无法启动服务器：${error}`);
    app.quit();
    return { success: false, error: String(error) };
  }
});

ipcMain.handle('check-activation', async () => {
  return checkActivation();
});

ipcMain.handle('get-device-id', async () => {
  const hostname = os.hostname();
  const platform = os.platform();
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : 'unknown';
  const data = `${hostname}:${platform}:${cpuModel}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
});

/**
 * 检查是否存在session
 */
async function checkExistingSession(): Promise<boolean> {
  try {
    const dataDir = getDataDir();
    const sessionPath = path.join(dataDir, '.session');
    
    const exists = fs.existsSync(sessionPath);
    console.log('[Electron] Session file exists:', exists);
    
    return exists;
  } catch (error) {
    console.error('[Electron] Check session failed:', error);
    return false;
  }
}

function requestAuthValidation(timeoutMs = AUTH_VALIDATION_TIMEOUT_MS): Promise<any> {
  return new Promise<any>((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}/api/auth/validate-session`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const result = JSON.parse(data);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      console.error('[Electron] Validate session request failed:', error);
      resolve({ valid: false, reason: '网络连接失败' });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ valid: false, reason: '验证超时' });
    });
  });
}

/**
 * 验证现有session
 */
async function validateExistingSession(): Promise<{ valid: boolean; reason?: string }> {
  try {
    let lastResponse: { valid: boolean; reason?: string } = { valid: false, reason: '验证失败' };
    for (let attempt = 1; attempt <= AUTH_VALIDATION_RETRIES; attempt += 1) {
      const response = await requestAuthValidation(AUTH_VALIDATION_TIMEOUT_MS) as { valid: boolean; reason?: string };
      lastResponse = response;
      if (response.valid) return response;

      const retryable = response.reason === '验证超时'
        || response.reason === '网络连接失败'
        || response.reason === '验证失败';
      if (!retryable || attempt === AUTH_VALIDATION_RETRIES) break;

      startupLog(`Session validation retry ${attempt + 1}/${AUTH_VALIDATION_RETRIES}: ${response.reason}`);
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    return lastResponse;
  } catch (error) {
    console.error('[Electron] Validate session failed:', error);
    return { valid: false, reason: '验证失败' };
  }
}

/**
 * 检查套餐状态（登录后调用）
 */
async function checkSubscriptionStatus(): Promise<{
  hasSubscription: boolean;
  reason?: string;
  subscription?: { plan_type: string; status: string; end_date: string };
}> {
  try {
    const response = await requestAuthValidation(AUTH_VALIDATION_TIMEOUT_MS);
    
    return {
      hasSubscription: response.valid === true,
      reason: response.reason,
      subscription: response.subscription,
    };
  } catch (error) {
    console.error('[Electron] Check subscription failed:', error);
    return { hasSubscription: false, reason: '验证失败' };
  }
}

/**
 * 创建购买引导窗口（无套餐时显示）
 */
let purchaseGuideWindow: BrowserWindow | null = null;

function createPurchaseGuideWindow(reason?: string): void {
  if (purchaseGuideWindow) {
    purchaseGuideWindow.focus();
    return;
  }
  
  purchaseGuideWindow = new BrowserWindow({
    width: 1040,
    height: 1000,
    minWidth: 1040,
    minHeight: 1000,
    resizable: true,
    frame: true,
    title: 'Scholar Harness - 购买套餐',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'icon.ico')
      : path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'preload.js')
        : path.join(__dirname, 'preload.js'),
    },
    show: false,
  });
  
  // 加载购买引导页面
  const purchasePath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'views', 'purchase-guide.html')
    : path.join(__dirname, 'views', 'purchase-guide.html');
  
  purchaseGuideWindow.loadFile(purchasePath).catch((err) => {
    console.error('[Electron] Failed to load purchase guide page:', err);
    // 如果加载失败，尝试加载在线页面
    purchaseGuideWindow?.loadURL('https://scholarharness.com/register/').catch(() => {
      dialog.showErrorBox('加载失败', `无法加载购买页面：${err.message}`);
      app.quit();
    });
  });
  
  purchaseGuideWindow.once('ready-to-show', () => {
    purchaseGuideWindow?.show();
    
    // 发送错误原因给页面
    if (reason) {
      purchaseGuideWindow?.webContents.send('purchase-reason', reason);
    }
  });
  
  // 处理外部链接
  purchaseGuideWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Electron] Purchase guide window open handler called for:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  purchaseGuideWindow.on('closed', () => {
    purchaseGuideWindow = null;
    // 如果主窗口和登录窗口都不存在，退出应用
    if (!windowTransitionInProgress && !mainWindow && !loginWindow) {
      app.quit();
    }
  });
}

/**
 * 创建登录窗口
 */
function createLoginWindow(errorMsg?: string): void {
  if (loginWindow) {
    loginWindow.focus();
    return;
  }
  
loginWindow = new BrowserWindow({
    width: 560,
    height: 820,
    minWidth: 520,
    minHeight: 760,
    resizable: true,
    frame: true,
    title: 'Scholar Harness - 登录',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'icon.ico')
      : path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'preload.js')
        : path.join(__dirname, 'preload.js'),
    },
    show: false,
  });
  
  // 加载登录页面
  const loginPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'views', 'login.html')
    : path.join(__dirname, 'views', 'login.html');
  
  loginWindow.loadFile(loginPath).catch((err) => {
    console.error('[Electron] Failed to load login page:', err);
    dialog.showErrorBox('加载失败', `无法加载登录页面：${err.message}`);
    app.quit();
  });
  
  loginWindow.once('ready-to-show', () => {
    loginWindow?.show();
    
    // 如果有错误消息，发送给登录页面
    if (errorMsg) {
      loginWindow?.webContents.send('login-error', errorMsg);
    }
  });
  
  // 处理 window.open() 调用（作为 fallback）
  loginWindow.webContents.setWindowOpenHandler(({ url }) => {
    console.log('[Electron] Login window open handler called for:', url);
    shell.openExternal(url);
    return { action: 'deny' };
  });
  
  loginWindow.on('closed', () => {
    loginWindow = null;
    
    // 如果主窗口和购买引导窗口都不存在，退出应用
    if (!windowTransitionInProgress && !mainWindow && !purchaseGuideWindow) {
      app.quit();
    }
  });
}

/**
 * 处理登录请求
 */
ipcMain.handle('login', async (event, credentials: { email: string; password: string; beta_code?: string }) => {
  try {
    console.log('[Electron] Processing login request for:', credentials.email);

    try {
      await ensureServerRunning();
    } catch (serverError) {
      const message = `本地服务器未启动，无法登录：${(serverError as Error).message}`;
      console.error('[Electron] Login blocked because server is unavailable:', serverError);
      startupLog(message);
      return {
        success: false,
        error: message,
      };
    }
    
    // 调用本地服务器的登录API
    const response = await new Promise<any>((resolve, reject) => {
      const postData = JSON.stringify({
        email: credentials.email,
        password: credentials.password,
        source: 'exe',
        beta_code: credentials.beta_code || undefined,
      });
      
      const options = {
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/auth/login',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('[Electron] Login request failed:', error);
        const errorWithCode = error as NodeJS.ErrnoException;
        const errorMsg = [errorWithCode.code, error.message, String(error)].filter(Boolean).join(' ');
        // 将底层网络错误转换为用户友好的消息
        if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET/i.test(errorMsg)) {
          reject(new Error(`无法连接到本地服务器 127.0.0.1:${PORT}，请重启应用或检查启动日志`));
        } else {
          reject(error);
        }
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('请求超时'));
      });
      
      req.write(postData);
      req.end();
    });
    
    if (response.message === 'Login successful') {
      // 登录成功
      console.log('[Electron] Login successful');
      
      // 检查是否有试用期激活信息
      if (response.trial_info) {
        console.log('[Electron] Trial info:', response.trial_info);
        startupLog(`Trial info: ${JSON.stringify(response.trial_info)}`);
      }
      if (response.referral_trial_info?.success) {
        console.log('[Electron] Referral trial info:', response.referral_trial_info);
        startupLog(`Referral trial info: ${JSON.stringify(response.referral_trial_info)}`);
      }
      
      // 登录成功后，验证套餐状态（严格模式）
      const subscriptionCheck = await checkSubscriptionStatus();
      
      if (!subscriptionCheck.hasSubscription) {
        // 无套餐，显示购买引导窗口
        console.log('[Electron] No subscription, showing purchase guide');
        startupLog('No subscription, showing purchase guide');
        
        windowTransitionInProgress = true;
        
        // 先创建购买引导窗口，再关闭登录窗口，避免 closed 事件触发 app.quit()
        createPurchaseGuideWindow(subscriptionCheck.reason || '未购买套餐');
        
        // 关闭登录窗口
        if (loginWindow) {
          loginWindow.close();
          loginWindow = null;
        }
        
        finishWindowTransitionSoon();
        
        return {
          success: false,
          error: '请先购买套餐',
          needPurchase: true,
          user: response.user,
          trial_info: response.trial_info,
          referral_trial_info: response.referral_trial_info,
        };
      }
      
      // 有有效套餐，关闭登录窗口，创建主窗口
      // 在创建主窗口前检查服务器是否健康
      const serverHealthy = await checkServerHealth(getDataDir());
      if (!serverHealthy) {
        console.error('[Electron] Server not healthy after login, cannot create main window');
        dialog.showErrorBox('服务器异常', '本地服务器已停止运行，请重启应用。');
        app.quit();
        return {
          success: false,
          error: '服务器异常，请重启应用',
        };
      }
      
      windowTransitionInProgress = true;
      
      // 先创建主窗口，再关闭登录窗口，避免 closed 事件触发 app.quit()
      createWindow();
      
      if (loginWindow) {
        loginWindow.close();
        loginWindow = null;
      }
      
      finishWindowTransitionSoon();
      
      return {
        success: true,
        user: response.user,
        subscription: subscriptionCheck.subscription,
        trial_info: response.trial_info,
        referral_trial_info: response.referral_trial_info,
      };
    } else {
      // 登录失败
      return {
        success: false,
        error: response.message || response.error || response.reason || '登录失败',
      };
    }
  } catch (error) {
    console.error('[Electron] Login failed:', error);
    
    return {
      success: false,
      error: error instanceof Error ? error.message : '登录失败',
    };
  }
});

/**
 * 处理打开外部链接请求
 * 通过主进程调用 shell.openExternal，比 preload 直接调用更可靠
 */
ipcMain.handle('open-external', async (event, url: string) => {
  try {
    console.log('[Electron] Opening external URL:', url);
    
    // 验证 URL 格式
    if (!url || !url.startsWith('http')) {
      console.warn('[Electron] Invalid URL:', url);
      return { success: false, error: 'Invalid URL' };
    }
    
    await shell.openExternal(url);
    console.log('[Electron] External URL opened successfully');
    return { success: true };
  } catch (error) {
    console.error('[Electron] Failed to open external URL:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to open URL' 
    };
  }
});

/**
 * 刷新验证套餐状态
 */
ipcMain.handle('refresh-subscription', async () => {
  try {
    console.log('[Electron] Refreshing subscription status...');
    
    const response = await requestAuthValidation(AUTH_VALIDATION_TIMEOUT_MS);
    
    return {
      valid: response.valid,
      reason: response.reason,
      subscription: response.subscription,
    };
  } catch (error) {
    console.error('[Electron] Refresh subscription failed:', error);
    return { valid: false, reason: '验证失败' };
  }
});

/**
 * 套餐验证成功后启动主窗口
 */
ipcMain.handle('subscription-validated', async () => {
  try {
    console.log('[Electron] Subscription validated, starting main window...');
    
    windowTransitionInProgress = true;
    
    // 先创建主窗口，再关闭购买引导窗口，避免 closed 事件触发 app.quit()
    createWindow();
    
    if (purchaseGuideWindow) {
      purchaseGuideWindow.close();
      purchaseGuideWindow = null;
    }
    if (loginWindow) {
      loginWindow.close();
      loginWindow = null;
    }
    
    finishWindowTransitionSoon();
    
    return { success: true };
  } catch (error) {
    windowTransitionInProgress = false;
    console.error('[Electron] Subscription validated handler failed:', error);
    return { success: false };
  }
});

/**
 * 退出登录
 */
ipcMain.handle('logout', async () => {
  try {
    console.log('[Electron] Logging out...');
    
    // 调用本地服务器的注销 API
    await new Promise<void>((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/auth/logout',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res) => {
        res.on('end', () => resolve());
      });
      
      req.on('error', (error) => {
        console.error('[Electron] Logout request failed:', error);
        resolve(); // 即使失败也继续
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve();
      });
      
      req.end();
    });
    
    windowTransitionInProgress = true;
    
    // 先显示登录窗口，再关闭其他窗口，避免窗口切换时触发 app.quit()
    createLoginWindow();
    
    if (purchaseGuideWindow) {
      purchaseGuideWindow.close();
      purchaseGuideWindow = null;
    }
    if (mainWindow) {
      mainWindow.close();
      mainWindow = null;
    }
    
    finishWindowTransitionSoon();
    
    return { success: true };
  } catch (error) {
    windowTransitionInProgress = false;
    console.error('[Electron] Logout failed:', error);
    return { success: false };
  }
});

/**
 * 获取用户信息
 */
ipcMain.handle('get-user-info', async () => {
  try {
    const response = await new Promise<any>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/auth/me`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({ error: '网络连接失败' });
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ error: '请求超时' });
      });
    });
    
    return response;
  } catch (error) {
    console.error('[Electron] Get user info failed:', error);
    return { error: '获取用户信息失败' };
  }
});

/**
 * 获取用量统计（用于柱状图）
 */
ipcMain.handle('get-daily-stats', async () => {
  try {
    const response = await new Promise<any>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/usage/daily-stats`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({ error: '网络连接失败' });
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ error: '请求超时' });
      });
    });
    
    return response;
  } catch (error) {
    console.error('[Electron] Get daily stats failed:', error);
    return { error: '获取用量统计失败' };
  }
});

/**
 * 获取充值链接
 */
ipcMain.handle('get-purchase-url', async (event, amountCNY: number) => {
  try {
    const response = await new Promise<any>((resolve, reject) => {
      const postData = JSON.stringify({ amount_cny: amountCNY });
      
      const options = {
        hostname: '127.0.0.1',
        port: PORT,
        path: '/api/usage/purchase-credits',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', (error) => {
        resolve({ error: '网络连接失败' });
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({ error: '请求超时' });
      });
      
      req.write(postData);
      req.end();
    });
    
    return response;
  } catch (error) {
    console.error('[Electron] Get purchase URL failed:', error);
    return { error: '获取充值链接失败' };
  }
});

/**
 * 打开充值网页
 */
ipcMain.handle('open-purchase-page', async (event, amountCNY: number) => {
  try {
    // 直接跳转到云端充值页面
    const purchaseUrl = `https://scholarharness.com/payment?type=credits&amount=${amountCNY}`;
    await shell.openExternal(purchaseUrl);
    return { success: true };
  } catch (error) {
    console.error('[Electron] Open purchase page failed:', error);
    return { success: false, error: '打开充值页面失败' };
  }
});

/**
 * 创建用户信息窗口
 */
function createUserInfoWindow(): void {
  if (userInfoWindow) {
    userInfoWindow.focus();
    return;
  }
  
  userInfoWindow = new BrowserWindow({
    width: 800,
    height: 900,
    minWidth: 650,
    minHeight: 750,
    resizable: true,
    frame: true,
    title: 'Scholar Harness - 用户信息',
    icon: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'icon.ico')
      : path.join(__dirname, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'preload.js')
        : path.join(__dirname, 'preload.js'),
    },
    show: false,
  });
  
  // 加载用户信息页面
  const userInfoPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist', 'electron', 'views', 'user-info.html')
    : path.join(__dirname, 'views', 'user-info.html');
  
  userInfoWindow.loadFile(userInfoPath).catch((err) => {
    console.error('[Electron] Failed to load user info page:', err);
    dialog.showErrorBox('加载失败', `无法加载用户信息页面：${err.message}`);
  });
  
  userInfoWindow.once('ready-to-show', () => {
    userInfoWindow?.show();
  });
  
  userInfoWindow.on('closed', () => {
    userInfoWindow = null;
  });
}

/**
 * 打开用户信息窗口（IPC调用）
 */
ipcMain.handle('open-user-info-window', async () => {
  createUserInfoWindow();
  return { success: true };
});

/**
 * 获取桌面路径
 */
ipcMain.handle('get-desktop-path', async () => {
  const desktopPath = path.join(os.homedir(), 'Desktop');
  // Windows 可能是中文桌面名称
  const possibleDesktopNames = ['Desktop', '桌面'];
  let actualDesktop = desktopPath;
  
  for (const name of possibleDesktopNames) {
    const testPath = path.join(os.homedir(), name);
    if (fs.existsSync(testPath)) {
      actualDesktop = testPath;
      break;
    }
  }
  
  return { path: actualDesktop };
});

/**
 * 保存文件到桌面（IPC调用）
 */
ipcMain.handle('save-file-to-desktop', async (event, filename: string, content: string) => {
  try {
    // 获取桌面路径
    const desktopPath = path.join(os.homedir(), 'Desktop');
    // Windows 可能是中文桌面名称
    const possibleDesktopNames = ['Desktop', '桌面'];
    let actualDesktop = desktopPath;
    
    for (const name of possibleDesktopNames) {
      const testPath = path.join(os.homedir(), name);
      if (fs.existsSync(testPath)) {
        actualDesktop = testPath;
        break;
      }
    }
    
    // 构建完整文件路径
    const filePath = path.join(actualDesktop, filename);
    
    // 写入文件
    fs.writeFileSync(filePath, content, 'utf-8');
    
    console.log('[Electron] File saved to desktop:', filePath);
    
    return {
      success: true,
      filepath: filePath,
    };
  } catch (error) {
    console.error('[Electron] Failed to save file to desktop:', error);
    return {
      success: false,
      error: (error as Error).message,
    };
  }
});

/**
 * 激活内测码（已登录用户）
 * 调用云服务器 API，携带本地 session 认证信息
 * 通过本地服务器 API 正确获取 access token（而不是直接读取加密文件）
 */
ipcMain.handle('activate-beta-code', async (event, code: string) => {
  try {
    console.log('[Electron] Activating beta code:', code);
    
    // 通过本地服务器 API 获取 access token（正确解密 session）
    const tokenResponse = await new Promise<{ hasToken: boolean; accessToken?: string; userId?: string; email?: string; error?: string }>((resolve) => {
      const req = http.get(`http://127.0.0.1:${PORT}/api/auth/token`, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (error) {
            resolve({ hasToken: false, error: '解析响应失败' });
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('[Electron] Get token request failed:', error);
        resolve({ hasToken: false, error: '网络连接失败' });
      });
      
      req.setTimeout(5000, () => {
        req.destroy();
        resolve({ hasToken: false, error: '获取认证信息超时' });
      });
    });
    
    if (!tokenResponse.hasToken || !tokenResponse.accessToken) {
      console.error('[Electron] No valid access token:', tokenResponse.error);
      return { success: false, reason: tokenResponse.error || '登录已过期，请重新登录' };
    }
    
    const accessToken = tokenResponse.accessToken;
    console.log('[Electron] Got valid access token for user:', tokenResponse.email);
    
    // 调用云服务器的内测码激活 API
    const https = require('https');
    const postData = JSON.stringify({ code: code.toUpperCase() });
    
    const options = {
      hostname: 'scholarharness.com',
      port: 443,
      path: '/api/v1/beta-codes/activate',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'Authorization': `Bearer ${accessToken}`,
      },
    };
    
    const response = await new Promise<any>((resolve, reject) => {
      const req = https.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });
      });
      
      req.on('error', (error: Error) => {
        console.error('[Electron] Beta code activation request failed:', error);
        resolve({ success: false, reason: '网络连接失败' });
      });
      
      req.setTimeout(15000, () => {
        req.destroy();
        resolve({ success: false, reason: '请求超时' });
      });
      
      req.write(postData);
      req.end();
    });
    
    console.log('[Electron] Beta code activation response:', response);
    
    if (response.success) {
      // 激活成功，返回结果（subscription 信息会在下次验证时自动从云端获取）
      console.log('[Electron] Beta code activation successful:', response.message || response.trial_days);
      
      return {
        success: true,
        trial_days: response.trial_days,
        access_type: response.access_type,
        message: response.message,
      };
    } else {
      return {
        success: false,
        reason: response.reason || response.message || '内测码激活失败',
      };
    }
  } catch (error) {
    console.error('[Electron] Beta code activation failed:', error);
    return { success: false, reason: '激活失败：' + (error instanceof Error ? error.message : '未知错误') };
  }
});
