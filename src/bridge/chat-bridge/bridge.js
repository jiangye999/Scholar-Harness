/**
 * NiceAIGC 桥接插件 - Node.js 版本
 * 
 * 功能：
 * - 通过 OpenClaw browser 工具自动化操作 NiceAIGC 网页
 * - 支持消息转发和结果回传
 * - 可集成到 Node.js 后端项目
 * 
 * 使用示例：
 *   import NiceAIGCBridge from './bridge.js';
 *   
 *   const bridge = new NiceAIGCBridge();
 *   const response = await bridge.sendMessage('请帮我润色这段论文...');
 *   console.log(response);
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);

// 获取当前文件目录
const __dirname = dirname(fileURLToPath(import.meta.url));

class NiceAIGCBridge {
  constructor(configPath = null) {
    this.configPath = configPath || join(__dirname, 'config.json');
    this.config = null;
    this.selectors = {
      inputBox: null,
      sendButton: null,
      responseArea: null
    };
  }

  /**
   * 加载配置文件
   */
  async loadConfig() {
    try {
      const configData = await readFile(this.configPath, 'utf-8');
      this.config = JSON.parse(configData);
      console.log(`[Bridge] 配置加载完成 | 模式：${this.config.mode}`);
      return this.config;
    } catch (error) {
      console.error(`[Bridge] 配置加载失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 发送消息到 NiceAIGC 并获取响应
   * @param {string} message - 用户消息
   * @param {string} mode - 运行模式（可选）
   * @returns {Promise<string>} AI 响应
   */
  async sendMessage(message, mode = null) {
    if (!this.config) {
      await this.loadConfig();
    }

    const useMode = mode || this.config.mode;
    console.log(`[Bridge] 发送消息 | 模式：${useMode}`);
    console.log(`[Bridge] 消息长度：${message.length} 字符`);

    try {
      if (useMode === 'browser') {
        return await this.sendViaBrowser(message);
      } else if (useMode === 'auto') {
        // auto 模式下只有浏览器可用（无 API Key）
        return await this.sendViaBrowser(message);
      } else {
        throw new Error(`不支持的模式：${useMode}`);
      }
    } catch (error) {
      console.error(`[Bridge] 错误：${error.message}`);
      throw error;
    }
  }

  /**
   * 通过浏览器发送消息
   * @param {string} message - 用户消息
   * @returns {Promise<string>} AI 响应
   */
  async sendViaBrowser(message) {
    console.log('[Bridge] 使用浏览器模式...');

    const chatUrl = this.config.niceaigc.chat_url;
    const profile = this.config.browser.profile;
    const waitMs = this.config.browser.wait_for_response_ms || 5000;

    // 步骤 1: 打开对话页面
    console.log('[Browser] 步骤 1/5: 打开对话页面...');
    await this.runCommand(`openclaw browser --action open --url "${chatUrl}" --profile ${profile}`);

    // 步骤 2: 等待页面加载
    console.log('[Browser] 步骤 2/5: 等待页面加载...');
    await this.sleep(2000);

    // 步骤 3: 截取快照，识别元素
    console.log('[Browser] 步骤 3/5: 识别页面元素...');
    const snapshot = await this.getSnapshot();
    const { inputRef, sendRef } = this.identifyElements(snapshot);

    // 步骤 4: 输入消息
    console.log('[Browser] 步骤 4/5: 输入消息...');
    await this.typeMessage(inputRef, message);

    // 步骤 5: 点击发送并等待响应
    console.log('[Browser] 步骤 5/5: 发送消息并等待响应...');
    await this.clickSend(sendRef);
    await this.sleep(waitMs);

    // 提取响应
    const response = await this.extractResponse();
    console.log(`[Browser] ✅ 收到响应 | 长度：${response.length} 字符`);
    
    return response;
  }

  /**
   * 运行 OpenClaw 命令
   * @param {string} cmd - 命令
   * @param {boolean} captureOutput - 是否捕获输出
   * @returns {Promise<string>} 命令输出
   */
  async runCommand(cmd, captureOutput = false) {
    console.log(`[Browser] 执行：${cmd}`);
    
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024
      });
      
      if (stderr) {
        console.warn(`[Browser] 警告：${stderr}`);
      }
      
      return stdout;
    } catch (error) {
      console.error(`[Browser] 命令执行失败：${error.message}`);
      throw error;
    }
  }

  /**
   * 截取页面快照
   * @returns {Promise<object>} 快照数据
   */
  async getSnapshot() {
    const profile = this.config.browser.profile;
    const output = await this.runCommand(
      `openclaw browser --action snapshot --refs aria --profile ${profile}`,
      true
    );
    
    try {
      return JSON.parse(output);
    } catch (error) {
      console.warn('[Browser] 快照解析失败，返回空对象');
      return { elements: [] };
    }
  }

  /**
   * 从快照中识别输入框和发送按钮
   * @param {object} snapshot - 页面快照
   * @returns {object} { inputRef, sendRef }
   */
  identifyElements(snapshot) {
    const elements = snapshot.elements || [];
    let inputRef = null;
    let sendRef = null;

    for (const elem of elements) {
      const ref = elem.ref || '';
      const role = (elem.role || '').toLowerCase();
      const name = (elem.name || '').toLowerCase();

      // 识别输入框
      if (!inputRef) {
        if (role.includes('textbox') || role.includes('textarea') || 
            name.includes('input') || name.includes('message') ||
            name.includes('输入')) {
          inputRef = ref;
          console.log(`[Browser] 找到输入框：${ref}`);
        }
      }

      // 识别发送按钮
      if (!sendRef) {
        if (role === 'button' && 
            (name.includes('send') || name.includes('发送') || name.includes('submit'))) {
          sendRef = ref;
          console.log(`[Browser] 找到发送按钮：${ref}`);
        }
      }
    }

    // Fallback 默认值
    if (!inputRef) {
      inputRef = 'e12';
      console.warn(`[Browser] ⚠️ 未找到输入框，使用默认：${inputRef}`);
    }

    if (!sendRef) {
      sendRef = 'e14';
      console.warn(`[Browser] ⚠️ 未找到发送按钮，使用默认：${sendRef}`);
    }

    return { inputRef, sendRef };
  }

  /**
   * 在输入框中输入消息
   * @param {string} ref - 输入框引用 ID
   * @param {string} message - 消息内容
   */
  async typeMessage(ref, message) {
    const profile = this.config.browser.profile;
    // 处理特殊字符
    const escapedMessage = message.replace(/"/g, '\\"');
    
    await this.runCommand(
      `openclaw browser --action act --kind type --ref ${ref} --text "${escapedMessage}" --profile ${profile}`
    );
  }

  /**
   * 点击发送按钮
   * @param {string} ref - 按钮引用 ID
   */
  async clickSend(ref) {
    const profile = this.config.browser.profile;
    await this.runCommand(
      `openclaw browser --action act --kind click --ref ${ref} --profile ${profile}`
    );
  }

  /**
   * 提取 AI 响应
   * @returns {Promise<string>} AI 响应文本
   */
  async extractResponse() {
    const maxAttempts = 5;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const snapshot = await this.getSnapshot();
        const response = this.parseResponseFromSnapshot(snapshot);
        
        if (response && response.length > 10) {
          return response;
        }
        
        console.log(`[Browser] 尝试 ${attempt}/${maxAttempts}: 响应太短，继续等待...`);
        await this.sleep(2000);
      } catch (error) {
        console.warn(`[Browser] 尝试 ${attempt}/${maxAttempts}: 提取失败 - ${error.message}`);
        await this.sleep(2000);
      }
    }
    
    // 最后一次尝试
    const snapshot = await this.getSnapshot();
    return this.parseResponseFromSnapshot(snapshot) || '（未能提取到响应）';
  }

  /**
   * 从快照中解析 AI 响应
   * @param {object} snapshot - 页面快照
   * @returns {string} AI 响应
   */
  parseResponseFromSnapshot(snapshot) {
    const elements = snapshot.elements || [];
    const responses = [];

    for (const elem of elements) {
      const name = (elem.name || '').toLowerCase();
      const text = elem.text || '';

      // 识别 AI 回复区域
      if (name.includes('assistant') || name.includes('ai') || name.includes('model') ||
          name.includes('回复') || name.includes('响应')) {
        if (text && text.length > 10) {
          responses.push(text);
        }
      }
    }

    // 返回最新的响应
    if (responses.length > 0) {
      return responses[responses.length - 1];
    }

    // 备用方案：查找最后一个文本块
    for (let i = elements.length - 1; i >= 0; i--) {
      const text = elements[i].text || '';
      if (text && text.length > 50) {
        return text;
      }
    }

    return '';
  }

  /**
   * 发送消息并保存结果到文件
   * @param {string} message - 用户消息
   * @param {string} outputPath - 输出文件路径
   * @returns {Promise<string>} AI 响应
   */
  async sendAndSave(message, outputPath = null) {
    const response = await this.sendMessage(message);
    
    // 使用相对路径，跨平台兼容
    const path = outputPath || this.config.local.output_file || 'data/niceaigc_response.txt';
    await writeFile(path, response, 'utf-8');
    
    console.log(`[Bridge] 结果已保存到：${path}`);
    return response;
  }

  /**
   * 测试连接
   * @returns {Promise<boolean>} 连接是否正常
   */
  async testConnection() {
    try {
      if (!this.config) {
        await this.loadConfig();
      }
      
      console.log('[Bridge] 测试连接...');
      const response = await this.sendMessage('测试连接');
      console.log(`[Bridge] ✅ 连接测试成功 | 响应：${response.substring(0, 50)}...`);
      return true;
    } catch (error) {
      console.error(`[Bridge] ❌ 连接测试失败：${error.message}`);
      return false;
    }
  }

  /**
   * 休眠函数
   * @param {number} ms - 毫秒数
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default NiceAIGCBridge;
