const { exec } = require('child_process');
const { promisify } = require('util');
const path = require('path');

const execAsync = promisify(exec);

class OpenClawBridge {
  constructor() {
    this.openclawPath = 'E:\\AI_projects\\openclaw';
  }

  async runCommand(action, options = {}) {
    const { url, selector, text, profile = 'chrome' } = options;
    
    let command = `cd "${this.openclawPath}" && node index.js browser --action ${action}`;
    
    if (url) command += ` --url "${url}"`;
    if (selector) command += ` --selector "${selector}"`;
    if (text) command += ` --text "${text}"`;
    if (profile) command += ` --profile ${profile}`;
    
    try {
      const { stdout, stderr } = await execAsync(command, { timeout: 30000 });
      return { success: true, stdout, stderr };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  async openBrowser(url) {
    return await this.runCommand('open', { url });
  }
}

module.exports = OpenClawBridge;
