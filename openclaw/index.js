#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const url = require('url');

/**
 * 设置 Playwright 浏览器路径
 * 优先级：
 * 1. 环境变量 PLAYWRIGHT_BROWSERS_PATH（已设置则不覆盖）
 * 2. openclaw/browsers 目录（打包后的浏览器）
 * 3. 系统默认 ms-playwright 缓存
 */
function setupPlaywrightBrowsersPath() {
  // 如果已设置，不覆盖
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) {
    console.error('[Browser] PLAYWRIGHT_BROWSERS_PATH already set:', process.env.PLAYWRIGHT_BROWSERS_PATH);
    return;
  }
  
  // 检查打包的浏览器目录
  const packagedBrowsersPath = path.join(__dirname, 'browsers');
  if (fs.existsSync(packagedBrowsersPath)) {
    const browsers = fs.readdirSync(packagedBrowsersPath);
    const hasChromium = browsers.some(f => f.startsWith('chromium-'));
    
    if (hasChromium) {
      process.env.PLAYWRIGHT_BROWSERS_PATH = packagedBrowsersPath;
      console.error('[Browser] Using packaged browsers:', packagedBrowsersPath);
      console.error('[Browser] Available browsers:', browsers.join(', '));
      return;
    }
  }
  
  // 检查 browser-info.json（打包时生成的标记文件）
  const browserInfoPath = path.join(__dirname, 'browser-info.json');
  if (fs.existsSync(browserInfoPath)) {
    try {
      const browserInfo = JSON.parse(fs.readFileSync(browserInfoPath, 'utf-8'));
      if (browserInfo.browsersPath) {
        const browsersPath = path.join(__dirname, browserInfo.browsersPath);
        if (fs.existsSync(browsersPath)) {
          process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
          console.error('[Browser] Using browsers from browser-info.json:', browsersPath);
          return;
        }
      }
    } catch (e) {
      console.error('[Browser] Failed to read browser-info.json:', e.message);
    }
  }
  
  console.error('[Browser] Using system default browser cache (ms-playwright)');
}

// 在加载 playwright 之前设置浏览器路径
setupPlaywrightBrowsersPath();

let Command, chromium;
try {
  const commander = require('commander');
  Command = commander.Command;
  const playwright = require('playwright');
  chromium = playwright.chromium;
} catch (e) {
  console.error('Error: Missing dependencies!');
  console.error('Please run: npm install');
  console.error('Error details:', e.message);
  process.exit(1);
}

const program = new Command();
const STATE_FILE = path.join(__dirname, 'browser-state.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// 全局配置
let globalConfig = {
  credentials: {
    email: '',
    password: ''
  },
  chat: {
    default_url: ''
  },
  bridge_secret: ''
};

/**
 * 脱敏邮箱
 */
function maskEmail(email) {
  if (!email || !email.includes('@')) return '';
  const [local, domain] = email.split('@');
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.substring(0, 2)}***@${domain}`;
}

/**
 * 脱敏密钥
 */
function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 4) return '****';
  return secret.substring(0, 2) + '****' + secret.substring(secret.length - 2);
}

/**
 * 加载本地配置
 */
function loadLocalConfig() {
  // 1. 首先尝试加载 openclaw/config.json
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const configData = fs.readFileSync(CONFIG_FILE, 'utf-8');
      globalConfig = { ...globalConfig, ...JSON.parse(configData) };
      console.error('[Config] 本地配置已加载:', CONFIG_FILE);
      if (globalConfig.credentials?.email) {
        console.error('[Config] openclaw/config.json 凭据已配置, masked_email:', maskEmail(globalConfig.credentials.email));
      }
    }
  } catch (e) {
    console.error('[Config] 加载 openclaw/config.json 失败:', e.message);
  }
  
  // 2. 尝试加载 chat-bridge-config.json（前端保存的用户配置）
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const chatBridgeConfigPath = path.join(dataDir, 'chat-bridge-config.json');
  try {
    if (fs.existsSync(chatBridgeConfigPath)) {
      const configData = fs.readFileSync(chatBridgeConfigPath, 'utf-8');
      const chatBridgeConfig = JSON.parse(configData);
      console.error('[Config] 找到 chat-bridge-config.json:', chatBridgeConfigPath);
      
      // 合并配置（chat-bridge-config 优先）
      if (chatBridgeConfig.chat) {
        if (chatBridgeConfig.chat.credentials?.email) {
          globalConfig.credentials = chatBridgeConfig.chat.credentials;
          console.error('[Config] chat-bridge-config.json 凭据已加载, masked_email:', maskEmail(globalConfig.credentials.email));
        }
        if (chatBridgeConfig.chat.chat_url) {
          globalConfig.chat = globalConfig.chat || {};
          globalConfig.chat.default_url = chatBridgeConfig.chat.chat_url;
          console.error('[Config] chat-bridge-config.json URL:', chatBridgeConfig.chat.chat_url);
        }
      }
      if (chatBridgeConfig.bridge_secret) {
        globalConfig.bridge_secret = chatBridgeConfig.bridge_secret;
      }
    }
  } catch (e) {
    console.error('[Config] 加载 chat-bridge-config.json 失败:', e.message);
  }
  
  if (globalConfig.bridge_secret) {
    console.error('[Config] bridge_secret已配置, masked:', maskSecret(globalConfig.bridge_secret));
  }
}

// 初始化时加载配置
loadLocalConfig();

/**
 * 统一 chat_url 解析逻辑
 * 优先级：
 * 1. 显式传入的 --url 或请求体 data.url
 * 2. process.env.CHAT_BRIDGE_CONFIG_PATH 指向的配置文件
 * 3. DATA_DIR/chat-bridge-config.json
 * 4. openclaw/config.json 仅作为最后 fallback
 */
function loadChatUrl() {
  // 优先使用环境变量 CHAT_URL
  if (process.env.CHAT_URL) {
    console.error('[Config] Using CHAT_URL from environment:', process.env.CHAT_URL);
    return process.env.CHAT_URL;
  }
  
  // 第二优先级：CHAT_BRIDGE_CONFIG_PATH 指向的配置文件
  const bridgeConfigPath = process.env.CHAT_BRIDGE_CONFIG_PATH;
  if (bridgeConfigPath) {
    try {
      if (fs.existsSync(bridgeConfigPath)) {
        const config = JSON.parse(fs.readFileSync(bridgeConfigPath, 'utf-8'));
        if (config.chat?.chat_url && String(config.chat.chat_url).trim()) {
          console.error('[Config] Loaded chat_url from CHAT_BRIDGE_CONFIG_PATH:', bridgeConfigPath);
          return String(config.chat.chat_url).trim();
        }
      }
    } catch (e) {
      console.error('[Config] 读取 CHAT_BRIDGE_CONFIG_PATH 失败:', e.message);
    }
  }
  
  // 第三优先级：DATA_DIR/chat-bridge-config.json
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
  const chatBridgeConfigPath = path.join(dataDir, 'chat-bridge-config.json');
  try {
    if (fs.existsSync(chatBridgeConfigPath)) {
      const config = JSON.parse(fs.readFileSync(chatBridgeConfigPath, 'utf-8'));
      if (config.chat?.chat_url && String(config.chat.chat_url).trim()) {
        console.error('[Config] Loaded chat_url from chat-bridge-config.json:', chatBridgeConfigPath);
        return String(config.chat.chat_url).trim();
      }
    }
  } catch (e) {
    console.error('[Config] 读取 chat-bridge-config.json 失败:', e.message);
  }
  
  // 最后才 fallback 到 openclaw/config.json（仅当前三者都不存在时）
  if (globalConfig.chat?.default_url && String(globalConfig.chat.default_url).trim()) {
    console.error('[Config] Using default_url from openclaw/config.json as fallback');
    return String(globalConfig.chat.default_url).trim();
  }
  
  console.error('[Config] No config found. URL must be provided via --url or environment variable CHAT_URL');
  return '';
}

function resolveChatUrl(preferredUrl, allowEmpty = false) {
  const candidate = preferredUrl && String(preferredUrl).trim()
    ? String(preferredUrl).trim()
    : loadChatUrl();

  if (!candidate) {
    if (allowEmpty) {
      console.error('[Config] ⚠️ Chat URL is empty, service will start but cannot send messages until configured');
      return '';
    }
    throw new Error('AI bridge chat URL is empty. Please save a valid URL in the frontend settings first.');
  }

  try {
    const parsed = new URL(candidate);
    if (!parsed.protocol || !parsed.host) {
      throw new Error('missing protocol or host');
    }
    return parsed.toString();
  } catch (error) {
    throw new Error(`AI bridge chat URL is invalid: ${candidate}`);
  }
}

let browser = null;
let context = null;
let page = null;
let paused = false;

/**
 * 验证 bridge_secret
 */
function validateBridgeSecret(req) {
  // 如果未配置 secret，兼容旧逻辑但警告
  if (!globalConfig.bridge_secret) {
    console.error('[Auth] bridge_secret 未配置，允许请求但日志警告');
    return true;
  }
  
  const providedSecret = req.headers['x-bridge-secret'];
  if (!providedSecret) {
    console.error('[Auth] 请求缺少 X-Bridge-Secret header');
    return false;
  }
  
  if (providedSecret !== globalConfig.bridge_secret) {
    console.error('[Auth] X-Bridge-Secret 不匹配');
    return false;
  }
  
  return true;
}

/**
 * 自动登录到 NiceAIGC
 */
async function autoLogin() {
  if (!page) return false;
  
  const email = globalConfig.credentials?.email;
  const password = globalConfig.credentials?.password;
  
  console.error('[Login] 尝试自动登录...');
  console.error('[Login] globalConfig.credentials:', email ? maskEmail(email) : 'EMPTY');
  console.error('[Login] password configured:', password ? 'YES' : 'EMPTY');
  
  if (!email || !password) {
    console.error('[Login] 未配置登录凭据，跳过自动登录');
    console.error('[Login] 请在 openclaw/config.json 中设置 credentials.email 和 credentials.password');
    console.error('[Login] 或在 chat-bridge-config.json 中配置（前端保存）');
    return false;
  }
  
  try {
    let currentUrl = await page.url();
    console.error('[Login] 当前 URL:', currentUrl);
    
    const needsLogin = currentUrl.includes('/login') || 
                       currentUrl.includes('fromurl') || 
                       currentUrl.includes('/jumpns') ||
                       currentUrl.includes('signin');
    
    if (!needsLogin) {
      // 额外检查页面是否显示登录表单
      try {
        const passwordInput = await page.locator('input[type="password"]').first();
        if (await passwordInput.isVisible({ timeout: 2000 })) {
          console.error('[Login] 检测到密码输入框，需要登录');
        } else {
          console.error('[Login] 不需要登录，继续');
          return true;
        }
      } catch (e) {
        console.error('[Login] 不需要登录，继续');
        return true;
      }
    }
    
console.error('[Login] 检测到登录页面，开始自动登录...');
    
    // 优先使用配置的 login_url，否则从 chat_url 推导
    let loginUrl = globalConfig.chat?.login_url;
    
    if (loginUrl && loginUrl.trim()) {
      console.error('[Login] 使用配置的登录页:', loginUrl);
    } else if (!currentUrl.includes('/login')) {
      const configUrl = globalConfig.chat?.default_url || loadChatUrl();
      if (configUrl) {
        const urlObj = new URL(configUrl);
        loginUrl = `${urlObj.origin}/login`;
        console.error('[Login] 从配置 URL 推导登录页:', loginUrl);
      } else {
        loginUrl = '';
      }
    }
    
    if (loginUrl && !currentUrl.includes('/login')) {
      await safeNavigate(loginUrl);
    }
    
    await new Promise(r => setTimeout(r, 1000));
    
    try {
      const emailTab = page.locator('button:has-text("邮箱登录")').first();
      if (await emailTab.isVisible({ timeout: 10000 })) {
        await emailTab.click();
        await new Promise(r => setTimeout(r, 300));
        console.error('[Login] 已切换到邮箱登录');
      }
    } catch (e) {}
    
    console.error('[Login] 填写邮箱:', maskEmail(email));
    const emailSelectors = [
      'input[placeholder*="邮箱"]',
      'input[placeholder*="邮箱/手机"]',
      'input[placeholder*="ID"]',
      'input[placeholder*="账号"]',
      'input[placeholder*="用户名"]',
      'input[placeholder*="手机"]',
      'input[type="text"]',
      'input:not([type])',
    ];
    let emailFilled = false;
    for (const selector of emailSelectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 5000 })) {
          await el.fill(email);
          console.error('[Login] 使用选择器填写邮箱:', selector);
          emailFilled = true;
          break;
        }
      } catch (e) {}
    }
    if (!emailFilled) {
      console.error('[Login] 未找到邮箱输入框，尝试第一个可见 input');
      await page.locator('input').first().fill(email);
    }
    
    console.error('[Login] 填写密码');
    try {
      await page.fill('input[type="password"]', password);
    } catch (e) {
      const allInputs = await page.locator('input').all();
      for (let i = allInputs.length - 1; i >= 0; i--) {
        const inputType = await allInputs[i].getAttribute('type');
        if (inputType !== 'text' || i > 0) {
          try {
            await allInputs[i].fill(password);
            console.error('[Login] 使用第', i, '个 input 填写密码');
            break;
          } catch (e2) {}
        }
      }
    }
    
    const submitSelectors = [
      'button[type="submit"]',
      'button:has-text("登录")',
      'button:has-text("登 录")',
      'button:has-text("Login")',
      'button:has-text("Sign in")',
    ];
    for (const selector of submitSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 10000 })) {
          await btn.click();
          console.error('[Login] 点击登录按钮:', selector);
          break;
        }
      } catch (e) {}
    }
    
    await page.waitForFunction(() => {
      return !location.href.includes('/login');
    }, { timeout: 30000 });
    
    await saveState();
    await new Promise(r => setTimeout(r, 1000));
    
    console.error('[Login] ✅ 登录成功！');
    return true;
  } catch (e) {
    console.error('[Login] ❌ 自动登录失败:', e.message);
    return false;
  }
}

async function initBrowser(profile = 'chrome', forceNew = false) {
  if (!forceNew && browser && context) {
    console.error('[Browser] 复用现有浏览器上下文');
    const pages = await context.pages();
    if (pages.length > 0) {
      page = pages[0];
    }
    return page;
  }
  
  const userDataDir = path.join(__dirname, 'browser-data');
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const contextOptions = {
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true,
  };

  if (profile === 'chrome' && fs.existsSync(STATE_FILE)) {
    try {
      contextOptions.storageState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      console.error('[Browser] 加载已保存的登录状态');
    } catch (e) {
      console.error('Failed to load storage state:', e.message);
    }
  }

  const browserChannels = [
    'chrome-beta',
    'chrome-dev',
    'chrome-canary',
    'msedge-beta',
    'msedge-dev',
    'chrome',
    'msedge',
    null
  ];
  let lastError = null;

  for (const channel of browserChannels) {
    try {
      const launchOptions = {
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--disable-extensions',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-default-apps',
          '--start-maximized',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
      };
      
      if (channel) {
        launchOptions.channel = channel;
      }

      console.error(`Trying browser: ${channel || 'chromium'}`);
      
      if (!browser) {
        browser = await chromium.launch(launchOptions);
      }
      
      context = await browser.newContext({
        ...contextOptions,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      });
      
      page = await context.newPage();
      
      page.on('error', (err) => console.error('[Page Error]', err.message));
      page.on('crash', () => console.error('[Page Crashed]'));
      
      console.error(`Browser launched successfully: ${channel || 'chromium'}`);
      console.error(`[Anti-Detection] Using ${channel || 'chromium'} to bypass automation detection`);
      return page;
    } catch (error) {
      lastError = error;
      console.error(`Failed to launch ${channel}:`, error.message);
      if (browser) {
        try { await browser.close(); } catch (e) {}
        browser = null;
      }
    }
  }

  console.error('All browser launch attempts failed');
  console.error('Please ensure Chrome or Edge is installed on your system');
  throw lastError;
}

async function safeNavigate(targetUrl, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.error(`Navigation attempt ${i + 1}: ${targetUrl}`);
      
      await page.goto(targetUrl, { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {
        console.error('Network idle timeout, continuing anyway');
      });
      
      await new Promise(r => setTimeout(r, 2000));
      
      console.error(`Navigation successful: ${targetUrl}`);
      return true;
    } catch (error) {
      console.error(`Navigation attempt ${i + 1} failed:`, error.message);
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }
  throw new Error(`Navigation failed after ${maxRetries} attempts`);
}

async function saveState() {
  if (context) {
    try {
      const state = await context.storageState();
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
      console.error('Browser state saved');
    } catch (e) {
      console.error('Failed to save state:', e.message);
    }
  }
}

async function closeBrowser() {
  await saveState();
  if (browser) {
    await browser.close();
    browser = null;
    context = null;
    page = null;
  }
}

/**
 * 查找最佳输入框（增强版）
 */
async function findBestInput(page, maxWaitMs = 60000) {
  // 扩展的选择器列表，覆盖更多类型的输入框
  const selectors = [
    // 优先：可编辑富文本框
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"][data-placeholder]',
    'div[contenteditable="true"][data-testid]',
    'div[contenteditable="true"]',
    'div[role="textbox"]',
    // 常见的textarea
    'textarea',
    'textarea[data-testid]',
    'textarea[data-id]',
    'textarea[placeholder]',
    // 常见的input
    'input[type="text"]',
    'input[type="search"]',
    'input[role="textbox"]',
    'input[contenteditable]',
    // ACE/Slate 等编辑器
    '.ace_text-input',
    '.ProseMirror',
    '.ck-editor__editable',
    // 通用
    '[contenteditable]',
    '[role="textbox"]',
    '[data-testid*="input"]',
    'input:not([type])',
  ];
  
  const startTime = Date.now();
  let bestInput = null;
  let bestSelector = null;
  
  console.error('[InputFinder] 开始查找输入框, maxWaitMs=', maxWaitMs);
  console.error('[InputFinder] 当前页面 URL:', await page.url());
  
  // 尝试多次，最多等待 maxWaitMs
  while (Date.now() - startTime < maxWaitMs && !bestInput) {
    const elapsed = Date.now() - startTime;
    console.error(`[InputFinder] 第 ${Math.floor(elapsed/1000)} 秒，尝试查找输入框...`);
    
    for (const selector of selectors) {
      try {
        const elements = await page.locator(selector).all();
        console.error(`[InputFinder] Selector "${selector}" 找到 ${elements.length} 个元素`);
        
        for (const el of elements) {
          try {
            const visible = await el.isVisible({ timeout: 500 });
            const editable = await el.getAttribute('contenteditable').catch(() => null);
            const disabled = await el.getAttribute('disabled').catch(() => null);
            
            // 跳过隐藏或禁用的元素
            if (!visible || disabled === '') continue;
            
            // 获取元素尺寸
            const bbox = await el.boundingBox().catch(() => null);
            if (!bbox || bbox.width < 50 || bbox.height < 20) continue;
            
            bestInput = el;
            bestSelector = selector;
            console.error(`[InputFinder] ✅ Found: ${selector}, visible=${visible}, contenteditable=${editable}, bbox=${JSON.stringify(bbox)}`);
            
            // 优先返回富文本输入框
            if (selector.includes('contenteditable') || selector === 'div[role="textbox"]' || selector.includes('ProseMirror') || selector.includes('ck-editor')) {
              console.error('[InputFinder] ✅ Selected as best: contenteditable/rich-text input');
              return { element: el, selector };
            }
            
          } catch (e) {
            // 单个元素检查失败，继续下一个
          }
        }
      } catch (e) {
        // 选择器失败，继续下一个
        console.error(`[InputFinder] Selector "${selector}" 失败:`, e.message);
      }
    }
    
    // 如果没找到，等待一下再试
    if (!bestInput && Date.now() - startTime < maxWaitMs) {
      console.error('[InputFinder] 本次未找到输入框，等待 2 秒...');
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  
  // 如果还没找到，返回最后一个备选
  if (bestInput) {
    console.error(`[InputFinder] Using fallback selector: ${bestSelector}`);
    return { element: bestInput, selector: bestSelector };
  }
  
  // 最终诊断：列出页面上所有可能的输入元素
  console.error('[InputFinder] ❌ 最终未找到输入框，列出页面所有元素...');
  try {
    console.error('[InputFinder] === 页面诊断信息 ===');
    console.error('[InputFinder] URL:', await page.url());
    console.error('[InputFinder] Title:', await page.title());
    
    const bodyText = await page.textContent('body').catch(() => '');
    console.error('[InputFinder] Body 文本 (前500字符):', bodyText.substring(0, 500));
    
    const allInputs = await page.locator('input, textarea, div[contenteditable], [role="textbox"]').all();
    console.error(`[InputFinder] 总共找到 ${allInputs.length} 个潜在输入元素`);
    
    for (let i = 0; i < Math.min(allInputs.length, 15); i++) {
      try {
        const tag = await allInputs[i].evaluate(el => el.tagName);
        const type = await allInputs[i].getAttribute('type').catch(() => 'N/A');
        const placeholder = await allInputs[i].getAttribute('placeholder').catch(() => 'N/A');
        const visible = await allInputs[i].isVisible().catch(() => false);
        const bbox = await allInputs[i].boundingBox().catch(() => null);
        console.error(`[InputFinder] Element[${i}]: ${tag} type=${type} placeholder="${placeholder}" visible=${visible} bbox=${JSON.stringify(bbox)}`);
      } catch (e) {
        console.error(`[InputFinder] Element[${i}] 检查失败:`, e.message);
      }
    }
    
    // 尝试列出页面所有按钮
    const buttons = await page.locator('button').all();
    console.error(`[InputFinder] 页面共有 ${buttons.length} 个按钮`);
    for (let i = 0; i < Math.min(buttons.length, 10); i++) {
      try {
        const text = await buttons[i].textContent().catch(() => '');
        const visible = await buttons[i].isVisible().catch(() => false);
        console.error(`[InputFinder] Button[${i}]: "${text.substring(0, 50)}" visible=${visible}`);
      } catch (e) {}
    }
    
    console.error('[InputFinder] === 诊断结束 ===');
  } catch (e) {
    console.error('[InputFinder] 诊断过程出错:', e.message);
  }
  
  return { element: null, selector: null };
}

/**
 * 查找发送按钮
 */
async function findSendButton(page) {
  const selectors = [
    'button[type="submit"]',
    'button:has-text("发送")',
    'button:has-text("Send")',
    'button:has-text("发送消息")',
    '[aria-label*="发送"]',
    '[aria-label*="Send"]',
    'button:has-text("Submit")'
  ];
  
  for (const selector of selectors) {
    try {
      const elements = await page.locator(selector).all();
      for (const el of elements) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          console.error(`[SendButton] Found: ${selector}, visible=true`);
          return { element: el, selector };
        }
      }
    } catch (e) {}
  }
  
  console.error('[SendButton] No send button found, will fallback to Enter');
  return { element: null, selector: null };
}

/**
 * 通过 UI 发送消息
 */
async function sendMessageThroughUI(page, inputEl, message) {
  // 1. 聚焦输入框
  try {
    await inputEl.click({ force: true, timeout: 5000 });
  } catch (e) {
    console.error('[SendMessage] Click failed, trying focus instead');
    await inputEl.focus().catch(() => {});
  }
  await new Promise(r => setTimeout(r, 500));
  
  // 2. 清空旧内容 - 根据元素类型选择方式
  try {
    const tagName = await inputEl.evaluate(el => el.tagName);
    if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
      // 对于 textarea/input，使用 fill 或 triple-click 全选
      await inputEl.fill('');
    } else {
      // 对于 contenteditable，使用键盘全选删除
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
    }
  } catch (e) {
    console.error('[SendMessage] Clear failed:', e.message);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
  }
  await new Promise(r => setTimeout(r, 500));
  
  // 3. 粘贴消息
  try {
    await page.evaluate(t => navigator.clipboard.writeText(t), message);
    await new Promise(r => setTimeout(r, 200));
    await page.keyboard.press('Control+v');
  } catch (e) {
    console.error('[SendMessage] Clipboard paste failed, trying fill:', e.message);
    try {
      await inputEl.fill(message);
    } catch (e2) {
      console.error('[SendMessage] fill also failed:', e2.message);
    }
  }
  
  // 4. 等待粘贴完成
  await new Promise(r => setTimeout(r, 1500));
  
  // 5. 校验输入框内容 - 根据元素类型选择方式
  let actualText = '';
  let actualLength = 0;
  try {
    const tagName = await inputEl.evaluate(el => el.tagName);
    if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
      actualText = await inputEl.inputValue() || '';
    } else {
      actualText = await inputEl.textContent() || '';
    }
  } catch (e) {
    try {
      actualText = await inputEl.textContent() || '';
    } catch (e2) {
      actualText = await inputEl.inputValue().catch(() => '');
    }
  }
  
  actualLength = actualText.trim().length;
  const expectedLength = message.trim().length;
  console.error(`[SendMessage] Expected length: ${expectedLength}, Actual length: ${actualLength}`);
  
  // 6. 如果未达到 80%，重试一次
  if (actualLength < expectedLength * 0.8) {
    console.error('[SendMessage] Content insufficient (${actualLength} < ${expectedLength * 0.8}), retrying...');
    await new Promise(r => setTimeout(r, 2000));
    
    try {
      const tagName = await inputEl.evaluate(el => el.tagName);
      if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
        await inputEl.fill(message);
      } else {
        await page.keyboard.press('Control+a');
        await page.keyboard.press('Backspace');
        await page.evaluate(t => navigator.clipboard.writeText(t), message);
        await new Promise(r => setTimeout(r, 200));
        await page.keyboard.press('Control+v');
      }
    } catch (e) {
      console.error('[SendMessage] Retry fill/paste failed:', e.message);
    }
    
    await new Promise(r => setTimeout(r, 1500));
    
    try {
      const tagName = await inputEl.evaluate(el => el.tagName);
      if (tagName === 'TEXTAREA' || tagName === 'INPUT') {
        actualText = await inputEl.inputValue() || '';
      } else {
        actualText = await inputEl.textContent() || '';
      }
    } catch (e) {
      actualText = await inputEl.inputValue().catch(() => '');
    }
    console.error(`[SendMessage] After retry - Expected: ${expectedLength}, Actual: ${actualText.trim().length}`);
  }
  
  // 7. 找发送按钮并点击
  const sendBtn = await findSendButton(page);
  let sendMethod = 'Enter';
  
  if (sendBtn.element) {
    try {
      await sendBtn.element.click({ timeout: 5000 });
      sendMethod = 'Click';
      console.error('[SendMessage] Sent via button click');
    } catch (e) {
      console.error('[SendMessage] Button click failed, fallback to Enter');
      await page.keyboard.press('Enter');
      sendMethod = 'Enter';
    }
  } else {
    await page.keyboard.press('Enter');
    console.error('[SendMessage] Sent via Enter key');
  }
  
  console.error(`[SendMessage] Final method: ${sendMethod}`);
  return sendMethod;
}

/**
 * 提取助手响应
 */
async function extractAssistantResponse(page, previousSnapshot) {
  const selectors = [
    'article',
    '[class*="message"]',
    '[data-testid*="message"]',
    '[class*="response"]',
    '.markdown',
    '.rendered-content'
  ];
  
  let candidates = [];
  let candidateCount = 0;
  
  for (const selector of selectors) {
    try {
      const elements = await page.locator(selector).all();
      for (const el of elements) {
        const visible = await el.isVisible().catch(() => false);
        if (visible) {
          candidates.push(el);
          candidateCount++;
        }
      }
    } catch (e) {}
  }
  
  console.error(`[ExtractResponse] Found ${candidateCount} candidate nodes`);
  
  // 优先找新增的 assistant 节点
  let bestContent = '';
  for (const el of candidates) {
    try {
      const text = await el.textContent();
      if (text && text.trim().length > 30) {
        // 过滤掉与用户输入完全相同的内容
        if (!text.includes('用户请求') && !text.includes('请帮我')) {
          bestContent = text.trim();
          // 找到明显是响应的内容就返回
          if (bestContent.length > 50) {
            break;
          }
        }
      }
    } catch (e) {}
  }
  
  // 清理噪音
  bestContent = bestContent
    .replace(/^思考中\.\.\./gm, '')
    .replace(/^已思考\s*\d+\s*秒?\n*/gm, '')
    .replace(/^已思考若干秒\n*/gm, '')
    .replace(/^大模型\s*说：/gm, '')
    .trim();
  
  console.error(`[ExtractResponse] Best candidate: ${bestContent.length} chars`);
  return bestContent;
}

async function openPageForChat(targetUrl) {
  if (!page) {
    throw new Error('Page is not initialized');
  }

  await safeNavigate(targetUrl);
  console.error(`[OpenPage] Opened: ${targetUrl}`);

  // 等待 SPA 应用完全渲染
  await new Promise(r => setTimeout(r, 3000));
  
  // 额外等待直到页面 URL 稳定
  try {
    await page.waitForFunction(() => {
      return document.readyState === 'complete' && 
             !document.title.includes('加载中') &&
             !document.title.includes('loading');
    }, { timeout: 10000 }).catch(() => {});
  } catch (e) {}
  
  let currentUrl = await page.url();
  console.error(`[OpenPage] Current URL after wait: ${currentUrl}`);
  
  // 检测是否需要登录（三层检测）
  let needsLogin = currentUrl.includes('/login') || 
                   currentUrl.includes('fromurl') || 
                   currentUrl.includes('/jumpns') ||
                   currentUrl.includes('signin');

  // 第二层：检测登录表单元素
  if (!needsLogin) {
    try {
      const loginIndicators = [
        'input[type="password"]',
        'button:has-text("登录")',
        'button:has-text("Login")',
        'button:has-text("登 录")',
        'input[placeholder*="密码"]',
        'input[placeholder*="password"]',
      ];
      for (const selector of loginIndicators) {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 })) {
          needsLogin = true;
          console.error('[OpenPage] 检测到登录表单元素:', selector);
          break;
        }
      }
    } catch (e) {}
  }

  // 第三层：检测页面文本中的登录提示
  if (!needsLogin) {
    try {
      const pageText = await page.textContent('body').catch(() => '');
      const loginTexts = [
        '缺少用户标识', '请重新登录', '请先登录', '请登录后',
        '请输入账号', '请输入密码', '登录超时', '身份验证',
        'login', 'signin', 'password', '账号', '密码'
      ];
      for (const text of loginTexts) {
        if (pageText.toLowerCase().includes(text.toLowerCase())) {
          needsLogin = true;
          console.error(`[OpenPage] 检测到登录提示文本: "${text}", 需要重新登录`);
          break;
        }
      }
    } catch (e) {}
  }

  if (needsLogin) {
    console.error('[OpenPage] 需要登录，尝试自动登录...');
    
    // 如果不在登录页，导航到登录页
    if (!currentUrl.includes('/login')) {
      const configUrl = globalConfig.chat?.default_url || loadChatUrl() || targetUrl;
      if (configUrl) {
        try {
          const urlObj = new URL(configUrl);
          const loginUrl = `${urlObj.origin}/login`;
          console.error('[OpenPage] 导航到登录页:', loginUrl);
          await safeNavigate(loginUrl);
          await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
          console.error('[OpenPage] 解析 URL 失败:', e.message);
        }
      }
    }
    
    const loginSuccess = await autoLogin();
    if (!loginSuccess) {
      throw new Error('登录失败，请检查 openclaw/config.json 中的凭据配置');
    }
    console.error('[OpenPage] 登录成功，等待页面加载...');
    
    // 登录后需要更长的等待时间
    await new Promise(r => setTimeout(r, 5000));

    await safeNavigate(targetUrl);
    console.error('[OpenPage] 导航回聊天页，等待渲染...');
    await new Promise(r => setTimeout(r, 4000));

    try {
      const btn1 = page.locator('button:has-text("我知道了")');
      if (await btn1.isVisible({ timeout: 10000 })) {
        await btn1.click();
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) {}
  }

  await saveState();
}

program
  .name('openclaw')
  .description('Browser automation tool for NiceAIGC integration')
  .version('1.0.0');

program
  .command('browser')
  .description('Browser automation commands')
  .option('--action <action>', 'Single action: open, fill, click, snapshot, chat')
  .option('--url <url>', 'URL to open')
  .option('--profile <profile>', 'Browser profile', 'chrome')
  .option('--selector <selector>', 'Element selector')
  .option('--text <text>', 'Text to fill')
  .option('--text-file <file>', 'File containing text to fill')
  .option('--wait <ms>', 'Wait time for response', '15000')
  .option('--keep-alive', 'Keep browser open')
  .option('--reuse-page', 'Reuse existing page')
  .action(async (options) => {
    const action = options.action || 'open';
    const waitMs = parseInt(options.wait) || 15000;
    
    try {
      if (!page && action !== 'open') {
        page = await initBrowser(options.profile);
      }
      
      switch (action) {
        case 'open':
          if (!options.url) {
            console.error('Error: URL is required for open action');
            process.exit(1);
          }
          if (!page) {
            page = await initBrowser(options.profile);
          }
          await openPageForChat(options.url);
          break;
          
        case 'fill':
          if (!options.selector) {
            console.error('Error: --selector is required for fill action');
            process.exit(1);
          }
          const textToFill = options.textFile 
            ? fs.readFileSync(options.textFile, 'utf-8')
            : options.text || '';
          await page.fill(options.selector, textToFill);
          console.error(`Filled ${options.selector}`);
          break;
          
        case 'click':
          if (!options.selector) {
            console.error('Error: --selector is required for click action');
            process.exit(1);
          }
          await page.click(options.selector);
          console.error(`Clicked ${options.selector}`);
          break;
          
        case 'snapshot':
          const snapshot = await page.accessibility.snapshot();
          console.log(JSON.stringify(snapshot, null, 2));
          break;
          
        case 'chat':
          if (!options.url) {
            const configUrl = loadChatUrl();
            if (!configUrl) {
              console.error('Error: URL is required. Use --url <url> or set CHAT_URL environment variable.');
              process.exit(1);
            }
            options.url = configUrl;
          }
          if (!page) {
            page = await initBrowser(options.profile);
          }
          
          if (!options.reusePage) {
            await safeNavigate(options.url);
            console.error(`Navigated to: ${options.url}`);
          } else {
            console.error(`Reusing existing page, skipping navigation`);
          }
          
          await new Promise(r => setTimeout(r, 2000));
          let currentUrl = await page.url();
          let needsLogin = currentUrl.includes('/login') || 
                           currentUrl.includes('fromurl') || 
                           currentUrl.includes('/jumpns') ||
                           currentUrl.includes('signin');
          
          // 第二层：检测登录表单元素
          if (!needsLogin) {
            try {
              const loginIndicators = [
                'input[type="password"]',
                'button:has-text("登录")',
                'button:has-text("Login")',
                'button:has-text("登 录")',
                'input[placeholder*="密码"]',
                'input[placeholder*="password"]',
              ];
              for (const selector of loginIndicators) {
                const el = page.locator(selector).first();
                if (await el.isVisible({ timeout: 3000 })) {
                  needsLogin = true;
                  console.error('[Chat] 检测到登录表单元素:', selector);
                  break;
                }
              }
            } catch (e) {}
          }
          
          // 第三层：检测页面文本
          if (!needsLogin) {
            try {
              const pageText = await page.textContent('body').catch(() => '');
              const loginTexts = [
                '缺少用户标识', '请重新登录', '请先登录', '请登录后',
                '请输入账号', '请输入密码', '登录超时', '身份验证'
              ];
              for (const text of loginTexts) {
                if (pageText.includes(text)) {
                  needsLogin = true;
                  console.error(`[Chat] 检测到登录提示文本: "${text}"`);
                  break;
                }
              }
            } catch (e) {}
          }
          
          if (needsLogin) {
            console.error('[Chat] 需要登录，尝试自动登录...');
            const configUrl = globalConfig.chat?.default_url || loadChatUrl() || options.url;
            if (configUrl) {
              try {
                const urlObj = new URL(configUrl);
                const loginUrl = `${urlObj.origin}/login`;
                await safeNavigate(loginUrl);
                await new Promise(r => setTimeout(r, 1500));
              } catch (e) {}
            }
            const loginSuccess = await autoLogin();
            if (!loginSuccess) {
              console.error('[Chat] 自动登录失败');
              console.log(JSON.stringify({ type: 'error', error: '登录失败，请检查 openclaw/config.json 中的凭据配置' }));
              break;
            }
            await new Promise(r => setTimeout(r, 3000));
            if (options.url) {
              await safeNavigate(options.url);
              await new Promise(r => setTimeout(r, 1500));
            }
            try {
              const btn1 = page.locator('button:has-text("我知道了")');
              if (await btn1.isVisible({ timeout: 10000 })) {
                await btn1.click();
                await new Promise(r => setTimeout(r, 500));
              }
            } catch (e) {}
          }
          
          const message = options.textFile 
            ? fs.readFileSync(options.textFile, 'utf-8')
            : options.text || '测试';
          
          const inputInfo = await findBestInput(page);
          if (inputInfo.element) {
            await sendMessageThroughUI(page, inputInfo.element, message);
          }
          
          console.error(`Waiting ${waitMs}ms for response...`);
          await new Promise(r => setTimeout(r, waitMs));
          
          let response = await extractAssistantResponse(page, null);
          
          if (!response) {
            response = await page.content();
          }
          
          console.log(JSON.stringify({ type: 'response', content: response }));
          break;
          
        default:
          console.error(`Unknown action: ${action}`);
          process.exit(1);
      }
      
      if (!options.keepAlive) {
        await closeBrowser();
      }
      
    } catch (error) {
      console.error('Error:', error.message);
      if (!options.keepAlive) {
        await closeBrowser();
      }
      process.exit(1);
    }
  });

program
  .command('close')
  .description('Close browser and save state')
  .action(async () => {
    await closeBrowser();
    console.error('Browser closed');
  });

program
  .command('serve')
  .description('Run as HTTP service')
  .option('--port <port>', 'Port', '19222')
  .option('--url <url>', 'Chat URL (reads from config if not provided)')
  .option('--profile <profile>', 'Browser profile', 'chrome')
  .action(async (options) => {
    const PORT = parseInt(options.port);
    let chatUrl = resolveChatUrl(options.url, true); // 允许空 URL
    const profile = options.profile;
    
    console.error(`[OpenClaw Service] Starting on port ${PORT}...`);
    console.error(`[OpenClaw Service] Initial chat URL: ${chatUrl || '(empty - waiting for configuration)'}`);
    console.error(`[OpenClaw Service] bridge_secret configured: ${!!globalConfig.bridge_secret}`);
    
    // 如果 URL 为空，启动服务但不初始化浏览器
    if (!chatUrl) {
      console.error('[OpenClaw Service] ⚠️ No chat URL configured, service starting in standby mode');
      console.error('[OpenClaw Service] Please configure URL via frontend settings, then use /open to initialize');
    }
    
    try {
      if (!page && chatUrl) {
        console.error('[OpenClaw Service] Initializing browser...');
        page = await initBrowser(profile);
        console.error('[OpenClaw Service] Browser initialized, navigating...');
        await safeNavigate(chatUrl);
        await saveState();
        console.error('[OpenClaw Service] Browser ready');
      } else if (!page && !chatUrl) {
        console.error('[OpenClaw Service] Service ready (standby mode - no browser initialized)');
      }
    } catch (initError) {
      console.error('[OpenClaw Service] ❌ Browser initialization failed:', initError.message);
      console.error('[OpenClaw Service] Service continuing in degraded mode...');
      // 不退出进程，允许服务继续运行，用户可以通过 /open 重新初始化
    }
    
    const server = http.createServer(async (req, res) => {
      const parsedUrl = url.parse(req.url, true);
      const pathname = parsedUrl.pathname;
      
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      
      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }
      
      // 鉴权检查（仅针对敏感操作）
      // /health 和 /state 始终允许（旧兼容）
      // /chat, /pause, /resume, /refresh, /newchat, /open 在配置了 bridge_secret 时需要认证
      const sensitivePaths = ['/chat', '/pause', '/resume', '/refresh', '/newchat', '/open'];
      if (sensitivePaths.includes(pathname) && !validateBridgeSecret(req)) {
        res.writeHead(401);
        res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing X-Bridge-Secret' }));
        return;
      }
      
      try {
        if (pathname === '/health') {
          res.writeHead(200);
          res.end(JSON.stringify({ status: 'ok', url: page ? await page.url() : null, paused }));
          return;
        }

        if (pathname === '/state' && req.method === 'GET') {
          res.writeHead(200);
          res.end(JSON.stringify({
            success: true,
            paused,
            currentUrl: page ? await page.url() : null,
            hasActivePage: !!page,
            hasConfiguredUrl: !!chatUrl && String(chatUrl).trim() !== '',
            needsConfiguration: !chatUrl || String(chatUrl).trim() === '',
          }));
          return;
        }

        if (pathname === '/pause' && req.method === 'POST') {
          paused = true;
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, paused }));
          return;
        }

        if (pathname === '/resume' && req.method === 'POST') {
          paused = false;
          res.writeHead(200);
          res.end(JSON.stringify({ success: true, paused }));
          return;
        }
        
        if (pathname === '/chat' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = JSON.parse(body);
              const message = data.message || '';
              
              // 检查 URL 是否为空
              const providedUrl = data.url || chatUrl;
              if (!providedUrl || !String(providedUrl).trim()) {
                res.writeHead(400);
                res.end(JSON.stringify({ 
                  error: 'AI bridge URL is empty. Please save a valid URL in the frontend settings (⚙️ AI桥接配置) first.',
                  needsConfiguration: true
                }));
                return;
              }
              
              const requestUrl = resolveChatUrl(providedUrl);
              const waitMs = data.wait || 60000;
              const streamMode = data.stream === true;

              if (paused) {
                res.writeHead(409);
                res.end(JSON.stringify({ error: 'Bridge is paused' }));
                return;
              }
              
              if (data.credentials?.email && data.credentials?.password) {
                globalConfig.credentials = data.credentials;
                console.error('[OpenClaw Service] 使用请求中的凭据, masked_email:', maskEmail(data.credentials.email));
              } else {
                loadLocalConfig();
                console.error('[OpenClaw Service] 重新加载配置文件');
              }

              const effectiveUrl = requestUrl;
              
              if (!page) {
                console.error('[OpenClaw Service] No page, initializing...');
                page = await initBrowser(profile);
                await openPageForChat(effectiveUrl);
                chatUrl = effectiveUrl;
              } else {
                const currentUrl = await page.url();
                if (!currentUrl || currentUrl === 'about:blank' || currentUrl === '') {
                  console.error('[OpenClaw Service] Page is about:blank, reopening...');
                  await openPageForChat(effectiveUrl);
                  chatUrl = effectiveUrl;
                }
              }
              
              console.error(`[OpenClaw Service] Chat: ${message.length} chars, URL: ${requestUrl}, stream: ${streamMode}`);
              
              if (data.newPage) {
                console.error(`[OpenClaw Service] newPage requested, reopening: ${effectiveUrl}`);
                await openPageForChat(effectiveUrl);
                chatUrl = effectiveUrl;
              } else if (requestUrl !== chatUrl) {
                console.error(`[OpenClaw Service] URL changed, reopening: ${requestUrl}`);
                await openPageForChat(requestUrl);
                chatUrl = requestUrl;
              }
              
              // 等待更长时间让 SPA 渲染完成
              await new Promise(r => setTimeout(r, 5000));
              
              console.error('[OpenClaw Service] 等待输入框出现...');
              const inputInfo = await findBestInput(page, 60000);  // 最多等待 60 秒
              let inputEl = inputInfo.element;
              
              if (streamMode) {
                res.writeHead(200, {
                  'Content-Type': 'text/event-stream',
                  'Cache-Control': 'no-cache',
                  'Connection': 'keep-alive'
                });
                
                if (!inputEl) {
                  const currentPageUrl = await page.url();
                  console.error('[OpenClaw Service] ❌ 未找到输入框，页面当前URL:', currentPageUrl);
                  console.error('[OpenClaw Service] ❌ 等待超时或未找到匹配的选择器');
                  
                  // 获取页面诊断信息
                  let pageInfo = {
                    url: currentPageUrl,
                    title: await page.title().catch(() => 'N/A'),
                    inputCount: 0,
                    buttonCount: 0
                  };
                  try {
                    const visibleInputs = await page.locator('input, textarea, div[contenteditable], [role="textbox"]').all();
                    pageInfo.inputCount = visibleInputs.length;
                  } catch (e) {}
                  try {
                    const buttons = await page.locator('button').all();
                    pageInfo.buttonCount = buttons.length;
                  } catch (e) {}
                  
                  const errorMsg = `未找到输入框 | URL: ${currentPageUrl} | 输入元素: ${pageInfo.inputCount} | 按钮: ${pageInfo.buttonCount}`;
                  console.error('[OpenClaw Service] 错误详情:', errorMsg);
                  res.write(`data: ${JSON.stringify({ type: 'error', error: errorMsg })}\n\n`);
                  res.end();
                  return;
                }
                
                // 记录发送前的消息节点快照
                let msgCountBefore = 0;
                let lastSentContent = '';
                try {
                  const articles = await page.locator('article').all();
                  msgCountBefore = articles.length;
                } catch (e) {}
                if (msgCountBefore === 0) {
                  try {
                    const msgs = await page.locator('[class*="message"]').all();
                    msgCountBefore = msgs.length;
                  } catch (e) {}
                }
                
                await sendMessageThroughUI(page, inputEl, message);
                console.error('[OpenClaw Service] 消息已发送');
                
                await new Promise(r => setTimeout(r, 2000));
                
                // 分阶段状态机：WAIT_THINK -> WAIT_OUTPUT -> WAIT_STABLE
                let phase = 'WAIT_THINK';
                let stableCount = 0;
                let validContentReceived = false;
                const startTime = Date.now();
                let lastChunkContent = '';
                let thinkingContent = '';      // 保存思考阶段内容
                let outputContent = '';        // 保存正式输出内容
                let fullRawContent = '';       // 保存完整原始内容
                let thinkingStartTime = null;  // 思考开始时间
                let outputStartTime = null;    // 输出开始时间
                
                res.write(`data: ${JSON.stringify({ type: 'start', content: '', phase: 'WAIT_THINK' })}\n\n`);
                
                while (Date.now() - startTime < waitMs) {
                  try {
                    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                    
                    let allElements = [];
                    let selectorUsed = '';
                    
                    // NiceAIGC 兼容：尝试多种选择器
                    const selectorsToTry = [
                      'article',
                      '[class*="message"]',
                      '[class*="response"]',
                      '[class*="chat"]',
                      '[data-role="assistant"]',
                      '[data-role="bot"]',
                      '.prose',
                      '.markdown-body',
                      '.response-text',
                      '.chat-message',
                      '.assistant-message',
                      '[class*="answer"]',
                      '[class*="reply"]',
                      '.content-wrapper',  // NiceAIGC 可能使用的
                      '.message-content',
                      '.text-content'
                    ];
                    
                    for (const selector of selectorsToTry) {
                      try {
                        const found = await page.locator(selector).all();
                        if (found.length > 0) {
                          allElements = found;
                          selectorUsed = selector;
                          console.error(`[OpenClaw Service] 找到响应元素: ${selector}, 数量: ${found.length}`);
                          break;
                        }
                      } catch (e) {}
                    }
                    
                    // 如果所有选择器都失败，尝试更通用的方法
                    if (allElements.length === 0) {
                      try {
                        // 查找页面上所有可见的文本容器
                        const pageContent = await page.evaluate(() => {
                          const containers = document.querySelectorAll('div, section, main, aside');
                          const results = [];
                          for (const el of containers) {
                            const text = el.textContent?.trim() || '';
                            if (text.length > 100) {
                              results.push({
                                selector: el.className || el.tagName,
                                textLength: text.length,
                                preview: text.substring(0, 50)
                              });
                            }
                          }
                          return results.slice(0, 10);
                        });
                        console.error('[OpenClaw Service] ⚠️ 常规选择器未匹配，页面文本容器:');
                        for (const pc of pageContent) {
                          console.error(`  - ${pc.selector}: ${pc.textLength}字符 "${pc.preview}..."`);
                        }
                      } catch (e) {
                        console.error('[OpenClaw Service] 页面分析失败:', e.message);
                      }
                    }
                    
                    if (allElements.length > 0) {
                      const targetIndex = Math.max(msgCountBefore, allElements.length - 1);
                      const lastElement = allElements[targetIndex] || allElements[allElements.length - 1];
                      const rawContent = await lastElement.textContent() || '';
                      fullRawContent = rawContent;
                      
                      // 🔍 详细诊断日志
                      console.error(`[OpenClaw Service] 内容检测:`);
                      console.error(`  - rawContent 长度: ${rawContent.length}`);
                      console.error(`  - rawContent 预览: "${rawContent.substring(0, 100)}..."`);
                      console.error(`  - msgCountBefore: ${msgCountBefore}, targetIndex: ${targetIndex}`);
                      console.error(`  - 当前 phase: ${phase}`);
                      
                      // 检测思考状态（关键：识别思考中的模型）
                      // NiceAIGC 兼容：添加英文思考提示
                      const isThinking = rawContent.includes('思考中') || 
                                         rawContent.includes('正在思考') ||
                                         rawContent.match(/已思考\s*\d+\s*秒/) ||
                                         rawContent.includes('思考...') ||
                                         rawContent.includes('Thinking') ||
                                         rawContent.includes('Generating') ||
                                         rawContent.match(/thinking\s*\d+\s*s/i) ||
                                         rawContent.includes('...');
                      
                      console.error(`  - isThinking: ${isThinking}`);
                      
                      // 提取思考时间（如果有）
                      const thinkMatch = rawContent.match(/已思考\s*(\d+)\s*秒?/);
                      const thinkTime = thinkMatch ? parseInt(thinkMatch[1]) : 0;
                      
                      // 清理后的正式输出内容（不含思考标记）
                      const cleanOutput = rawContent
                        .replace(/大模型\s*说：/g, '')
                        .replace(/已思考\s*\d+\s*秒?\n*/g, '')
                        .replace(/已思考若干秒\n*/g, '')
                        .replace(/思考中\.\.\./g, '')
                        .replace(/正在思考/g, '')
                        .replace(/思考\.\.\./g, '')
                        .replace(/Thinking\.\.\./gi, '')
                        .replace(/Generating\.\.\./gi, '')
                        .trim();
                      
                      console.error(`  - cleanOutput 长度: ${cleanOutput.length}`);
                      console.error(`  - cleanOutput 预览: "${cleanOutput.substring(0, 100)}..."`);
                      
                      // ===== 阶段一：等待思考完成 =====
                      if (phase === 'WAIT_THINK') {
                        if (isThinking) {
                          // 模型正在思考，保存思考内容
                          thinkingContent = rawContent;
                          if (!thinkingStartTime) {
                            thinkingStartTime = Date.now();
                            console.error('[OpenClaw Service] 检测到思考开始');
                          }
                          // 每5秒发送思考进度
                          if (thinkTime > 0 && thinkTime % 5 === 0) {
                            res.write(`data: ${JSON.stringify({ 
                              type: 'thinking', 
                              phase: 'WAIT_THINK',
                              thinkTime: thinkTime,
                              content: rawContent
                            })}\n\n`);
                            console.error('[OpenClaw Service] 思考进行中:', thinkTime, '秒');
                          }
                        } else if (cleanOutput.length > 10) {
                          // 降低阈值：只要有10字符以上的有效内容就开始输出
                          // NiceAIGC 可能没有思考阶段，直接输出
                          phase = 'WAIT_OUTPUT';
                          outputStartTime = Date.now();
                          outputContent = cleanOutput;
                          lastChunkContent = cleanOutput;
                          validContentReceived = true;
                          stableCount = 0;
                          
                          console.error('[OpenClaw Service] 🚀 进入输出阶段');
                          console.error(`[OpenClaw Service] 初始内容长度: ${cleanOutput.length} 字符`);
                          console.error('[OpenClaw Service] 思考内容长度:', thinkingContent.length, '字符');
                          
                          // 发送思考完成事件（即使没有思考过程）
                          res.write(`data: ${JSON.stringify({ 
                            type: 'thinking_complete', 
                            phase: 'WAIT_OUTPUT',
                            thinking: thinkingContent,
                            thinkTime: thinkTime,
                            content: cleanOutput
                          })}\n\n`);
                          
                          // 立即发送第一个 chunk
                          res.write(`data: ${JSON.stringify({ 
                            type: 'chunk', 
                            phase: 'WAIT_OUTPUT',
                            content: cleanOutput,
                            newChunk: cleanOutput
                          })}\n\n`);
                          console.error(`[OpenClaw Service] 已发送初始内容: ${cleanOutput.length} 字符`);
                        } else {
                          // 内容太短，可能是空响应或用户消息
                          console.error(`[OpenClaw Service] ⚠️ 内容太短 (${cleanOutput.length}字符)，等待更多内容...`);
                        }
                      }
                      
                      // ===== 阶段二：等待输出完成 =====
                      else if (phase === 'WAIT_OUTPUT') {
                        if (cleanOutput.length > lastChunkContent.length) {
                          // 内容仍在增长，继续输出
                          const newChunk = cleanOutput.slice(lastChunkContent.length);
                          outputContent = cleanOutput;
                          lastChunkContent = cleanOutput;
                          stableCount = 0;
                          
                          res.write(`data: ${JSON.stringify({ 
                            type: 'chunk', 
                            phase: 'WAIT_OUTPUT',
                            content: cleanOutput,
                            newChunk: newChunk
                          })}\n\n`);
                          console.error(`[OpenClaw Service] 输出增长: ${cleanOutput.length} 字符 (+${newChunk.length})`);
                        } else if (cleanOutput.length === lastChunkContent.length && cleanOutput.length > 10) {
                          // 内容稳定，进入稳定检测阶段
                          phase = 'WAIT_STABLE';
                          stableCount = 1;
                          console.error('[OpenClaw Service] 输出稳定检测开始');
                        }
                      }
                      
                      // ===== 阶段三：稳定性检测 =====
                      else if (phase === 'WAIT_STABLE') {
                        if (cleanOutput.length > lastChunkContent.length) {
                          // 内容又开始增长，回退到输出阶段
                          phase = 'WAIT_OUTPUT';
                          stableCount = 0;
                          const newChunk = cleanOutput.slice(lastChunkContent.length);
                          outputContent = cleanOutput;
                          lastChunkContent = cleanOutput;
                          res.write(`data: ${JSON.stringify({ 
                            type: 'chunk', 
                            phase: 'WAIT_OUTPUT',
                            content: cleanOutput,
                            newChunk: newChunk
                          })}\n\n`);
                          console.error('[OpenClaw Service] 输出恢复增长:', cleanOutput.length, '字符');
                        } else if (cleanOutput.length === lastChunkContent.length) {
                          stableCount++;
                          // 需要至少 24 次（12秒）稳定才结束
                          if (stableCount >= 24) {
                            console.error('[OpenClaw Service] 输出稳定(连续24次相同)，完成');
                            break;
                          }
                          // 每10次（5秒）打印进度
                          if (stableCount % 10 === 0) {
                            console.error('[OpenClaw Service] 稳定检测:', stableCount, '/ 24');
                          }
                        }
                      }
                    }
                  } catch (e) {
                    console.error('[OpenClaw Service] 循环错误:', e.message);
                  }
                  
                  // 检查停止生成按钮（辅助判断）
                  try {
                    const stopBtn = await page.locator('button:has-text("停止生成"), button:has-text("Stop"), button:has-text("重新生成"), button:has-text("regenerate")').first();
                    const isGenerating = await stopBtn.isVisible().catch(() => false);
                    
                    // 只有在输出阶段且稳定后才用按钮判断
                    if (!isGenerating && phase === 'WAIT_STABLE' && stableCount >= 12) {
                      console.error('[OpenClaw Service] 检测到生成完成（停止按钮消失+已稳定）');
                      break;
                    }
                  } catch (e) {}
                  
                  await new Promise(r => setTimeout(r, 500));
                }
                
                // 最终输出：包含思考内容 + 正式输出 + 完整原始内容
                res.write(`data: ${JSON.stringify({ 
                  type: 'done', 
                  phase: phase,
                  content: outputContent,              // 清理后的正式输出
                  thinking: thinkingContent,           // 思考阶段内容
                  rawContent: fullRawContent,          // 完整原始内容
                  hasThinking: thinkingContent.length > 0,
                  totalTime: Date.now() - startTime,
                  thinkingTime: thinkingStartTime ? (outputStartTime - thinkingStartTime) : 0,
                  outputTime: outputStartTime ? (Date.now() - outputStartTime) : 0
                })}\n\n`);
                res.end();
                console.error('[OpenClaw Service] 响应完成:');
                console.error('[OpenClaw Service] - 思考内容:', thinkingContent.length, '字符');
                console.error('[OpenClaw Service] - 正式输出:', outputContent.length, '字符');
                console.error('[OpenClaw Service] - 总耗时:', Math.round((Date.now() - startTime) / 1000), '秒');
                
              } else {
                if (!inputEl) {
                  console.error('[OpenClaw Service] (非流式) 未找到输入框，页面URL:', await page.url());
                  res.writeHead(500);
                  res.end(JSON.stringify({ error: '未找到输入框' }));
                  return;
                }
                
                await sendMessageThroughUI(page, inputEl, message);
                
                await new Promise(r => setTimeout(r, waitMs));
                
                let response = await extractAssistantResponse(page, null);
                
                res.writeHead(200);
                res.end(JSON.stringify({ content: response }));
              }
            } catch (e) {
              console.error('[OpenClaw Service] Error:', e.message);
              res.writeHead(500);
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        
        if (pathname === '/newchat' && req.method === 'GET') {
          try {
            console.error(`[OpenClaw Service] New chat requested`);
            if (page) {
              await safeNavigate(chatUrl);
              console.error(`[OpenClaw Service] Navigated to new chat: ${chatUrl}`);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true, message: 'New chat created' }));
            } else {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'No active page' }));
            }
          } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }
        
        if (pathname === '/refresh' && req.method === 'GET') {
          try {
            console.error(`[OpenClaw Service] Page refresh requested`);
            if (page) {
              await page.reload();
              console.error(`[OpenClaw Service] Page refreshed`);
              res.writeHead(200);
              res.end(JSON.stringify({ success: true, message: 'Page refreshed' }));
            } else {
              res.writeHead(400);
              res.end(JSON.stringify({ error: 'No active page' }));
            }
          } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
          }
          return;
        }

        if (pathname === '/open' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => body += chunk);
          req.on('end', async () => {
            try {
              const data = body ? JSON.parse(body) : {};
              const requestUrl = resolveChatUrl(data.url || chatUrl);

              if (!requestUrl || !requestUrl.trim()) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'URL is required' }));
                return;
              }

              if (!page) {
                console.error('[OpenClaw Service] No page for /open, initializing browser...');
                page = await initBrowser(profile);
              }

              console.error(`[OpenClaw Service] Open page requested: ${requestUrl}`);
              await openPageForChat(requestUrl);
              chatUrl = requestUrl;

              res.writeHead(200);
              res.end(JSON.stringify({
                success: true,
                message: 'Page opened',
                currentUrl: page ? await page.url() : requestUrl,
                hasActivePage: !!page,
              }));
            } catch (e) {
              console.error('[OpenClaw Service] /open error:', e.message);
              res.writeHead(500);
              res.end(JSON.stringify({ error: e.message }));
            }
          });
          return;
        }
        
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (e) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[OpenClaw Service] ❌ Port ${PORT} is already in use`);
        console.error(`[OpenClaw Service] Exiting to prevent multi-instance...`);
        process.exit(1);  // ✅ 端口被占用时退出进程
      } else {
        console.error(`[OpenClaw Service] ❌ Server error:`, err.message);
        process.exit(1);  // ✅ 其他服务器错误也退出
      }
    });
    
    server.listen(PORT, () => {
      console.error(`[OpenClaw Service] ✅ Listening on http://localhost:${PORT}`);
    });
  });

// 全局错误处理，防止进程崩溃
process.on('uncaughtException', (err) => {
  console.error('[OpenClaw] ❌ Uncaught Exception:', err.message);
  console.error(err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[OpenClaw] ❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

program.parse();
