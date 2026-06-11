#!/usr/bin/env node
/**
 * NiceAIGC 桥接插件 - CLI 命令行工具
 * 
 * 使用方式：
 *   node cli.js "消息内容"
 *   node cli.js --input prompt.txt --output response.txt
 *   node cli.js --serve --port 8765
 */

import NiceAIGCBridge from './bridge.js';
import { readFile, writeFile } from 'fs/promises';

async function main() {
  const args = process.argv.slice(2);
  
  // 显示帮助
  if (args.includes('--help') || args.includes('-h') || args.length === 0) {
    console.log(`
NiceAIGC 桥接插件 - CLI 工具

使用方式:
  node cli.js "消息内容"
  node cli.js --input prompt.txt --output response.txt
  node cli.js --serve --port 8765
  node cli.js --test

选项:
  --input, -i     从文件读取输入
  --output, -o    保存结果到文件
  --serve, -s     启动 HTTP 服务
  --port, -p      HTTP 服务端口（默认：8765）
  --test, -t      测试连接
  --help, -h      显示帮助

示例:
  node cli.js "请帮我润色这段论文..."
  node cli.js -i prompt.txt -o response.txt
  node cli.js --serve --port 8000
  node cli.js --test
`);
    return;
  }
  
  const bridge = new NiceAIGCBridge();
  
  // 测试连接
  if (args.includes('--test') || args.includes('-t')) {
    console.log('测试连接...');
    const ok = await bridge.testConnection();
    process.exit(ok ? 0 : 1);
  }
  
  // 启动 HTTP 服务
  if (args.includes('--serve') || args.includes('-s')) {
    const portIndex = args.findIndex(a => a === '--port' || a === '-p');
    const port = portIndex > -1 ? args[portIndex + 1] : '8765';
    
    console.log(`启动 HTTP 服务，端口：${port}`);
    console.log('请按 Ctrl+C 停止服务');
    console.log('');
    
    // 启动 server.js
    import('child_process').then(({ spawn }) => {
      const server = spawn('node', ['server.js', '--port', port], {
        stdio: 'inherit'
      });
      
      server.on('error', (err) => {
        console.error('启动失败:', err.message);
        process.exit(1);
      });
    });
    
    return;
  }
  
  // 获取输入
  let message = '';
  const inputIndex = args.findIndex(a => a === '--input' || a === '-i');
  
  if (inputIndex > -1) {
    // 从文件读取
    const inputFile = args[inputIndex + 1];
    message = await readFile(inputFile, 'utf-8');
    console.log(`从文件读取：${inputFile}`);
  } else {
    // 从命令行参数读取（第一个非选项参数）
    message = args.find(a => !a.startsWith('-'));
    
    if (!message) {
      console.error('错误：请提供消息内容或 --input 文件');
      console.error('使用 --help 查看帮助');
      process.exit(1);
    }
  }
  
  // 发送消息
  console.log('发送到 NiceAIGC...');
  console.log(`消息长度：${message.length} 字符`);
  console.log('');
  
  try {
    const response = await bridge.sendMessage(message);
    
    // 输出结果
    const outputIndex = args.findIndex(a => a === '--output' || a === '-o');
    
    if (outputIndex > -1) {
      // 保存到文件
      const outputFile = args[outputIndex + 1];
      await writeFile(outputFile, response, 'utf-8');
      console.log(`结果已保存到：${outputFile}`);
    } else {
      // 输出到控制台
      console.log('AI 响应:');
      console.log('='.repeat(60));
      console.log(response);
      console.log('='.repeat(60));
    }
    
  } catch (error) {
    console.error('错误:', error.message);
    process.exit(1);
  }
}

main().catch(console.error);
