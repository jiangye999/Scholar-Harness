#!/usr/bin/env node
/**
 * OpenClaw - 浏览器自动化工具（手动模式版本）
 * 
 * 专用于解决反自动化检测问题
 * 使用方式：
 *   1. 启动服务: node index-manual.js serve
 *   2. 手动打开浏览器并登录
 *   3. 通过 API 调用
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 19222;
const STATE_FILE = path.join(__dirname, 'browser-state.json');
const PID_FILE = path.join(__dirname, 'browser.pid');

// 浏览器进程
let browserProcess = null;

/**
 * 从配置文件读取聊天 URL
 * 支持多种环境：开发环境、打包环境、环境变量
 */
function loadChatUrl() {
  // 优先使用环境变量
  if (process.env.CHAT_URL) {
    console.log('[Config] Using CHAT_URL from environment:', process.env.CHAT_URL);
    return process.env.CHAT_URL;
  }
  
  // 尝试从配置文件读取
  const configPaths = [
    // 打包环境：resources/app.asar.unpacked/dist/src/bridge/chat-bridge/config.json
    path.join(__dirname, '..', 'app.asar.unpacked', 'dist', 'src', 'bridge', 'chat-bridge', 'config.json'),
    // 打包环境：resources/dist/src/bridge/chat-bridge/config.json
    path.join(__dirname, '..', 'dist', 'src', 'bridge', 'chat-bridge', 'config.json'),
    // 开发环境：项目根目录/src/bridge/chat-bridge/config.json
    path.join(__dirname, '..', '..', 'src', 'bridge', 'chat-bridge', 'config.json'),
    // 开发环境：相对于 openclaw 目录
    path.join(__dirname, '..', 'src', 'bridge', 'chat-bridge', 'config.json'),
    // Electron 环境变量路径
    process.env.CHAT_BRIDGE_CONFIG_PATH || '',
  ].filter(p => p); // 过滤空路径
  
  for (const configPath of configPaths) {
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (config.chat?.chat_url) {
          console.log('[Config] Loaded chat_url from config:', configPath);
          return config.chat.chat_url;
        }
      }
    } catch (e) {
      // 继续尝试下一个路径
    }
  }
  
  // 未找到配置，返回空字符串（需要用户传入）
  console.log('[Config] No config found. URL must be provided via --url or environment variable CHAT_URL');
  return '';
}

/**
 * 打开系统默认浏览器（手动模式）
 * 不使用 Playwright，避免反自动化检测
 */
async function openBrowserManually(targetUrl) {
  const { exec } = require('child_process');
  const platform = process.platform;
  
  console.log('[Manual Mode] Opening browser manually...');
  console.log('[Manual Mode] URL:', targetUrl);
  
  let command;
  
  if (platform === 'win32') {
    // Windows: 尝试 Chrome, Edge, Firefox, 最后是默认浏览器
    const browsers = [
      { name: 'Chrome', cmd: `start chrome "${targetUrl}"` },
      { name: 'Edge', cmd: `start msedge "${targetUrl}"` },
      { name: 'Firefox', cmd: `start firefox "${targetUrl}"` },
      { name: 'Default', cmd: `start "" "${targetUrl}"` }
    ];
    
    for (const browser of browsers) {
      try {
        console.log(`[Manual Mode] Trying ${browser.name}...`);
        exec(browser.cmd);
        console.log(`[Manual Mode] ✅ Opened with ${browser.name}`);
        return { success: true, browser: browser.name };
      } catch (e) {
        console.log(`[Manual Mode] ❌ ${browser.name} not available`);
      }
    }
  } else if (platform === 'darwin') {
    // macOS
    command = `open "${targetUrl}"`;
    exec(command);
  } else {
    // Linux
    command = `xdg-open "${targetUrl}"`;
    exec(command);
  }
  
  return { success: true };
}

/**
 * 保存浏览器状态（用于持久化登录）
 */
async function saveBrowserState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.log('[State] Browser state saved');
  } catch (e) {
    console.error('[State] Failed to save:', e.message);
  }
}

/**
 * 加载浏览器状态
 */
function loadBrowserState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('[State] Failed to load:', e.message);
  }
  return null;
}

/**
 * HTTP 服务模式
 */
function startServer() {
  console.log('\n========================================');
  console.log('  OpenClaw Manual Mode Service');
  console.log('========================================\n');
  console.log(`[Service] Starting on port ${PORT}...`);
  console.log('[Service] Mode: Manual (Anti-Detection)\n');
  
  const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    // CORS
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }
    
    try {
      // 健康检查
      if (pathname === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ 
          status: 'ok', 
          mode: 'manual',
          message: 'Browser should be opened manually by user'
        }));
        return;
      }
      
      // 打开浏览器
      if (pathname === '/open' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            // 从请求或配置文件读取 URL，不再硬编码
            const targetUrl = data.url || loadChatUrl();
            
            if (!targetUrl) {
              res.writeHead(400);
              res.end(JSON.stringify({
                error: 'URL is required. Provide url in request body or set CHAT_URL environment variable.'
              }));
              return;
            }
            
            const result = await openBrowserManually(targetUrl);
            
            res.writeHead(200);
            res.end(JSON.stringify({
              success: true,
              message: 'Browser opened. Please login manually.',
              url: targetUrl,
              ...result
            }));
          } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      
      // 聊天（提示用户手动操作）
      if (pathname === '/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
          try {
            const data = JSON.parse(body);
            const message = data.message || '';
            
            console.log('\n[Chat] Message received:', message.substring(0, 100));
            
            res.writeHead(200);
            res.end(JSON.stringify({
              success: false,
              error: 'Manual mode: Please use the browser window to chat.',
              hint: 'This service only opens the browser. You need to interact manually.',
              message_preview: message.substring(0, 200)
            }));
          } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          }
        });
        return;
      }
      
      // 获取使用说明
      if (pathname === '/help') {
        res.writeHead(200);
        res.end(JSON.stringify({
          mode: 'manual',
          description: 'Anti-detection browser opener',
          endpoints: {
            'GET /health': 'Health check',
            'POST /open': 'Open browser manually (body: {url: string})',
            'POST /chat': 'Not supported in manual mode',
            'GET /help': 'This help'
          },
          usage: [
            '1. POST /open to open browser',
            '2. Login manually in the browser',
            '3. Use the browser directly for chat'
          ]
        }));
        return;
      }
      
      // 404
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found. Try GET /help' }));
      
    } catch (e) {
      console.error('[Service] Error:', e.message);
      res.writeHead(500);
      res.end(JSON.stringify({ error: e.message }));
    }
  });
  
  server.listen(PORT, () => {
    console.log(`[Service] ✅ Listening on http://localhost:${PORT}`);
    console.log('\n[Service] Endpoints:');
    console.log('  GET  /health - Health check');
    console.log('  POST /open   - Open browser manually');
    console.log('  GET  /help   - Usage instructions\n');
    console.log('========================================');
    console.log('  使用说明');
    console.log('========================================');
    console.log('1. 浏览器会通过系统默认方式打开');
    console.log('2. 如果页面空白，手动刷新页面');
    console.log('3. 登录你的 NiceAIGC 账号');
    console.log('4. 登录后可以直接使用浏览器对话');
    console.log('========================================\n');
  });
  
  // 优雅关闭
  process.on('SIGINT', () => {
    console.log('\n[Service] Shutting down...');
    server.close();
    process.exit(0);
  });
}

// CLI
const args = process.argv.slice(2);
const command = args[0];

if (command === 'serve') {
  startServer();
} else if (command === 'open') {
  // 从参数或配置文件读取 URL，不再硬编码
  const targetUrl = args[1] || loadChatUrl();
  
  if (!targetUrl) {
    console.log('\n❌ Error: URL is required.');
    console.log('\nUsage:');
    console.log('  node index-manual.js open <url>');
    console.log('  node index-manual.js open');
    console.log('\nOr set CHAT_URL environment variable.');
    process.exit(1);
  }
  
  openBrowserManually(targetUrl).then(result => {
    console.log('\n✅ Browser opened');
    console.log(`URL: ${targetUrl}`);
    console.log('Please login manually and use the browser directly.\n');
  });
} else {
  console.log(`
OpenClaw Manual Mode - Browser Opener for AI Chat Services

Usage:
  node index-manual.js serve           Start HTTP service
  node index-manual.js open <url>      Open browser directly

Service Endpoints:
  POST /open    Open browser manually (body: {url: string})
  GET  /health  Health check

Configuration:
  - Set CHAT_URL environment variable
  - Or configure in src/bridge/niceaigc/config.json (niceaigc.chat_url)
  - Or provide URL via command line/HTTP request

Example:
  node index-manual.js serve
  curl -X POST http://localhost:19222/open -H "Content-Type: application/json" -d '{"url":"YOUR_CHAT_URL"}'
  
  node index-manual.js open "YOUR_CHAT_URL"
`);
}