#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

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

let browser = null;
let context = null;
let page = null;

async function connectToBrowser() {
  try {
    console.error('Connecting to Chrome on port 9222...');
    const resp = await fetch('http://localhost:9222/json/version');
    const data = await resp.json();
    console.error('Chrome version:', data.Browser);
    const browserWSEndpoint = data.webSocketDebuggerUrl;
    console.error('WebSocket endpoint:', browserWSEndpoint);
    browser = await chromium.connect(browserWSEndpoint);
    await new Promise(r => setTimeout(r, 500));
    const targets = await browser.contexts();
    if (targets.length > 0) {
      context = targets[0];
    } else {
      context = await browser.newContext();
    }
    const pages = await context.pages();
    page = pages.length > 0 ? pages[0] : await context.newPage();
    console.error('Connected successfully');
    return page;
  } catch (error) {
    console.error('Failed to connect to browser:', error.message);
    console.error('Make sure Chrome is running with: chrome --remote-debugging-port=9222');
    throw error;
  }
}

async function initBrowser(profile = 'chrome') {
  const launchOptions = {
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  };

  const contextOptions = {
    viewport: { width: 1280, height: 720 },
  };

  if (profile === 'chrome' && fs.existsSync(STATE_FILE)) {
    contextOptions.storageState = STATE_FILE;
  }

  try {
    browser = await chromium.launch(launchOptions);
    context = await browser.newContext(contextOptions);
    page = await context.newPage();
    return page;
  } catch (error) {
    console.error('Failed to launch browser:', error.message);
    console.error('Please run: npx playwright install chromium');
    throw error;
  }
}

async function saveState() {
  if (context) {
    await context.storageState({ path: STATE_FILE });
  }
}

async function closeBrowser() {
  await saveState();
  if (browser) {
    await browser.close();
  }
}

program
  .name('openclaw')
  .description('Browser automation tool for NiceAIGC integration')
  .version('1.0.0');

program
  .command('browser')
  .description('Browser automation commands')
  .option('--action <action>', 'Single action: open, fill, click, snapshot')
  .option('--actions <actions>', 'Comma-separated actions: open,fill,click,snapshot')
  .option('--url <url>', 'URL to open')
  .option('--profile <profile>', 'Browser profile', 'chrome')
  .option('--selector <selector>', 'Element selector')
  .option('--text <text>', 'Text to fill')
  .option('--refs <refs>', 'Reference type', 'aria')
  .option('--format <format>', 'Output format', 'text')
  .option('--keep-alive', 'Keep browser open after actions')
  .option('--wait <ms>', 'Wait time in ms for chat action', '5000')
  .option('--connect', 'Connect to existing Chrome with remote debugging')
  .action(async (options) => {
    let actions = [];
    if (options.actions) {
      actions = options.actions.split(',');
    } else if (options.action) {
      actions = [options.action];
    }
    
    const needsBrowser = actions.some(a => ['fill', 'click', 'snapshot', 'chat'].includes(a));
    if (needsBrowser && !page) {
      page = await initBrowser(options.profile);
    }
    
    try {
      for (const action of actions) {
        switch (action.trim()) {
          case 'open':
            if (!options.url) {
              console.error('Error: URL is required for open action');
              process.exit(1);
            }
            page = await initBrowser(options.profile);
            await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
            console.error(`Opened: ${options.url}`);
            await saveState();
            break;

          case 'fill':
            if (!page) {
              console.error('Error: Browser not initialized. Use --action open first');
              process.exit(1);
            }
            if (!options.selector || !options.text) {
              console.error('Error: --selector and --text are required for fill action');
              process.exit(1);
            }
            await page.fill(options.selector, options.text);
            console.error(`Filled ${options.selector}`);
            break;

          case 'click':
            if (!page) {
              console.error('Error: Browser not initialized. Use --action open first');
              process.exit(1);
            }
            if (!options.selector) {
              console.error('Error: --selector is required for click action');
              process.exit(1);
            }
            await page.click(options.selector);
            console.error(`Clicked ${options.selector}`);
            break;

          case 'snapshot':
            if (!page) {
              console.error('Error: Browser not initialized. Use --action open first');
              process.exit(1);
            }
            
            if (options.format === 'text') {
              const text = await page.evaluate(() => document.body.innerText);
              console.error(text);
            } else {
              const elements = await page.evaluate(() => {
                const results = [];
                const allElements = document.querySelectorAll('*');
                allElements.forEach((el, index) => {
                  const tagName = el.tagName.toLowerCase();
                  const ariaLabel = el.getAttribute('aria-label') || '';
                  const placeholder = el.getAttribute('placeholder') || '';
                  const text = el.textContent?.substring(0, 50) || '';
                  
                  if (tagName === 'textarea' || tagName === 'input' || tagName === 'button') {
                    results.push(`[${index}] ${tagName} aria="${ariaLabel}" placeholder="${placeholder}" text="${text}"`);
                  }
                });
                return results;
              });
              console.error(elements.join('\n'));
            }
            break;

          case 'chat':
            console.error('Chat action starting...');
            let currentUrl = null;
            try {
              currentUrl = page ? await page.url() : null;
            } catch (e) {
              currentUrl = null;
            }
            console.error('Current URL:', currentUrl);
            
            if (!page || currentUrl === 'about:blank' || !currentUrl) {
              console.error('Initializing browser...');
              if (options.connect) {
                console.error('Connecting to existing Chrome...');
                page = await connectToBrowser();
              } else {
                page = await initBrowser(options.profile);
                console.error('Browser initialized, navigating to URL...');
                await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
                await saveState();
              }
            }
            console.error('Final URL:', await page.url());
            
            // Check if we need to login
            let url = await page.url();
            
            // Wait a bit for any redirects to complete
            await new Promise(r => setTimeout(r, 3000));
            url = await page.url();
            
            const needsLogin = url.includes('/login') || 
                              url.includes('fromurl') || 
                              url.includes('/jumpns');
            
            if (needsLogin) {
              console.error('Login required, attempting auto-login...');
              try {
                // Navigate to login page
                await page.goto('https://node8.nice188.com/login', { waitUntil: 'domcontentloaded' });
                await new Promise(r => setTimeout(r, 1000));
                
                // Click email login tab first
                const emailTab = await page.locator('button:has-text("邮箱登录")').first();
                try {
                  await emailTab.click({ timeout: 5000 });
                  await new Promise(r => setTimeout(r, 500));
                } catch (e) {}
                
                // Fill email and password quickly
                await page.fill('input[placeholder*="邮箱"]', 'sjs@cau.edu.cn');
                await page.fill('input[type="password"]', '!woaisjs159');
                
                // Click login button
                await page.click('button[type="submit"]');
                
                // Wait for navigation to chat page
                await page.waitForFunction(() => {
                  return !location.href.includes('/login');
                }, { timeout: 30000 });
                await saveState();
                
                // Short wait for page to fully load
                await new Promise(r => setTimeout(r, 1000));
              } catch (e) {
                console.error('Auto-login failed:', e.message);
              }
            }
            
            console.error('Waiting for page to fully load...');
            await new Promise(r => setTimeout(r, 3000));
            
            // Try to close any modals or popups
            try {
              const modalSelectors = [
                '[id*="modal"] button', '[class*="modal"] button',
                '[id*="dialog"] button', '[class*="dialog"] button',
                'button:has-text("关闭")', 'button:has-text("确定")',
                '.close, .close-button', '[aria-label*="关闭"]'
              ];
              for (const sel of modalSelectors) {
                try {
                  const btn = await page.locator(sel).first();
                  if (await btn.isVisible({ timeout: 2000 })) {
                    await btn.click();
                    console.error('Closed modal with:', sel);
                    await new Promise(r => setTimeout(r, 500));
                    break;
                  }
                } catch (e) {}
              }
            } catch (e) {}
            
            // Find input element and send button using Playwright locators
            let inputEl = null;
            let sendBtn = null;
            
            try {
              // Try common input selectors - prioritize contenteditable divs for modern chat UIs
              const inputSelectors = [
                'div[contenteditable="true"]',
                'textarea[placeholder*="问"]',
                'textarea[placeholder*="输入"]',
                'textarea[aria-label*="输入"]',
                'textarea',
                'input[placeholder*="问"]',
                'input[placeholder*="输入"]',
                'input[type="text"]'
              ];
              
              for (const selector of inputSelectors) {
                try {
                  const el = await page.locator(selector).first();
                  const isVisible = await el.isVisible({ timeout: 3000 });
                  if (isVisible) {
                    inputEl = el;
                    console.error('Found input:', selector);
                    break;
                  }
                } catch (e) {
                  continue;
                }
              }
              
              // Find send button
              const buttonSelectors = [
                'button[aria-label*="发送"]',
                'button:has-text("发送")',
                'button[type="submit"]',
                'button:has-svg, button svg',
                'button'
              ];
              
              for (const selector of buttonSelectors) {
                try {
                  const el = await page.locator(selector).first();
                  if (await el.isVisible({ timeout: 2000 })) {
                    sendBtn = el;
                    console.error('Found send button:', selector);
                    break;
                  }
                } catch (e) {
                  continue;
                }
              }
            } catch (e) {
              console.error('Element detection error:', e.message);
            }
            
            // Fill input
            if (inputEl) {
              try {
                // Check if it's a contenteditable div
                const isContentEditable = await inputEl.evaluate(el => 
                  el.tagName === 'DIV' && el.getAttribute('contenteditable') === 'true'
                );
                
                if (isContentEditable) {
                  // For contenteditable, use fill() which works better than keyboard
                  await inputEl.fill(options.text);
                  console.error('Filled contenteditable with:', options.text);
                } else {
                  await inputEl.fill(options.text);
                  console.error('Filled input with:', options.text);
                }
              } catch (e) {
                console.error('Fill error:', e.message);
                // Fallback: try clicking and using keyboard
                await inputEl.click({ force: true });
                await new Promise(r => setTimeout(r, 500));
                await page.keyboard.type(options.text);
              }
            } else {
              // Last resort: try keyboard input after clicking on body
              await page.click('body', { force: true });
              await new Promise(r => setTimeout(r, 500));
              await page.keyboard.type(options.text);
              console.error('Typed text via keyboard (no input found)');
            }
            
            await new Promise(r => setTimeout(r, 500));
            
            // Click send or press Enter
            let messageSent = false;
            
            // For contenteditable inputs (ChatGPT-style), use Enter key
            // For traditional inputs with send buttons, try clicking the button
            if (inputEl) {
              const isContentEditable = await inputEl.evaluate(el => 
                el.tagName === 'DIV' && el.getAttribute('contenteditable') === 'true'
              );
              
              if (isContentEditable) {
                // ChatGPT-style: press Enter to send
                try {
                  await page.keyboard.press('Enter');
                  console.error('Pressed Enter to send (ChatGPT-style)');
                  messageSent = true;
                } catch (e) {
                  console.error('Enter key failed:', e.message);
                }
              } else if (sendBtn) {
                // Traditional: click send button
                try {
                  await sendBtn.click({ force: true, timeout: 5000 });
                  console.error('Clicked send button');
                  messageSent = true;
                } catch (e) {
                  console.error('Send button click failed:', e.message);
                }
              }
            }
            
            // Fallback if nothing worked
            if (!messageSent) {
              try {
                await page.keyboard.press('Enter');
                console.error('Pressed Enter as fallback');
              } catch (e) {
                console.error('Final fallback failed:', e.message);
              }
            }
            
            await new Promise(r => setTimeout(r, 1000));
            
            console.error('Waiting', options.wait, 'ms for response...');
            await new Promise(r => setTimeout(r, parseInt(options.wait) || 5000));
            
            // Simple response extraction
            let response = '';
            try {
              response = await page.evaluate(() => {
                // Try to find the last message/response
                const articles = document.querySelectorAll('article');
                if (articles.length > 0) {
                  return articles[articles.length - 1].innerText?.substring(0, 2000) || '';
                }
                
                // Fallback to main content
                const main = document.querySelector('main');
                if (main) {
                  return main.innerText?.substring(0, 2000) || '';
                }
                
                // Last resort
                return document.body?.innerText?.substring(0, 2000) || '';
              });
            } catch (e) {
              // Silent fail
            }
            
            // Output ONLY the response, nothing else
            console.log(response || '[No response extracted]');
            break;

          default:
            console.error(`Unknown action: ${action}`);
            process.exit(1);
        }
      }
    } catch (error) {
      console.error('Error:', error.message);
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

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

program.parse();
