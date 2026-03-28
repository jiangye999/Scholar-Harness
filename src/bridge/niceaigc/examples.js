/**
 * NiceAIGC 桥接插件 - Node.js 使用示例
 */

import NiceAIGCBridge from './bridge.js';

// ==================== 示例 1: 基础使用 ====================

async function exampleBasic() {
  console.log('='.repeat(50));
  console.log('示例 1: 基础使用');
  console.log('='.repeat(50));
  
  const bridge = new NiceAIGCBridge();
  
  const message = '请帮我润色以下论文摘要：\n\n本研究探讨了气候变化对生态系统的影响...';
  
  const response = await bridge.sendMessage(message);
  
  console.log(`\nAI 响应:\n${response}`);
  return response;
}

// ==================== 示例 2: 保存结果到文件 ====================

async function exampleSaveToFile() {
  console.log('\n' + '='.repeat(50));
  console.log('示例 2: 保存结果到文件');
  console.log('='.repeat(50));
  
  const bridge = new NiceAIGCBridge();
  
  const message = '请列出 5 个论文写作中常见的逻辑错误';
  
  const response = await bridge.sendAndSave(message, '/tmp/niceaigc_output.txt');
  
  console.log(`\n结果已保存到 /tmp/niceaigc_output.txt`);
  console.log(`响应预览:\n${response.substring(0, 200)}...`);
  return response;
}

// ==================== 示例 3: 集成到 Express 后端 ====================

function exampleExpressIntegration() {
  console.log('\n' + '='.repeat(50));
  console.log('示例 3: Express 后端集成');
  console.log('='.repeat(50));
  
  const code = `
// app.js - 你的 Express 后端
import express from 'express';
import NiceAIGCBridge from './niceaigc-bridge/bridge.js';

const app = express();
app.use(express.json());

const bridge = new NiceAIGCBridge();

// API 端点：调用 NiceAIGC
app.post('/api/ai/polish', async (req, res) => {
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: '缺少 text 参数' });
  }
  
  try {
    const message = \`请帮我润色以下学术文本，使其更加专业和流畅：\\n\\n\${text}\`;
    const response = await bridge.sendMessage(message);
    
    res.json({
      success: true,
      original: text,
      polished: response
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 启动服务
app.listen(3000, () => {
  console.log('后端服务运行在 http://localhost:3000');
});
`;
  
  console.log(code);
  return code;
}

// ==================== 示例 4: 前端调用示例 ====================

function exampleFrontendCall() {
  console.log('\n' + '='.repeat(50));
  console.log('示例 4: 前端调用示例');
  console.log('='.repeat(50));
  
  const code = `
// 前端 JavaScript（浏览器环境）
async function polishText(text) {
  const response = await fetch('http://localhost:8765/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: \`请帮我润色以下学术文本：\\n\\n\${text}\`
    })
  });
  
  const data = await response.json();
  
  if (data.success) {
    return data.response;
  } else {
    throw new Error(data.error);
  }
}

// 使用示例
const original = "This study is about climate change.";
const polished = await polishText(original);
console.log('润色后:', polished);
`;
  
  console.log(code);
  return code;
}

// ==================== 示例 5: 批量处理 ====================

async function exampleBatchProcessing() {
  console.log('\n' + '='.repeat(50));
  console.log('示例 5: 批量处理');
  console.log('='.repeat(50));
  
  const bridge = new NiceAIGCBridge();
  
  const messages = [
    '润色：This study is about climate change.',
    '润色：We found some interesting results.',
    '润色：The method we used is good.',
  ];
  
  console.log('批量处理 3 条消息...\\n');
  
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log(\`[\${i + 1}/\${messages.length}] \${msg}\`);
    
    try {
      const response = await bridge.sendMessage(msg);
      console.log(\`    → \${response.substring(0, 100)}...\\n\`);
    } catch (error) {
      console.log(\`    → 错误：\${error.message}\\n\`);
    }
    
    // 延迟避免请求过快
    if (i < messages.length - 1) {
      await bridge.sleep(2000);
    }
  }
}

// ==================== 示例 6: 测试连接 ====================

async function exampleTestConnection() {
  console.log('\n' + '='.repeat(50));
  console.log('示例 6: 测试连接');
  console.log('='.repeat(50));
  
  const bridge = new NiceAIGCBridge();
  
  const ok = await bridge.testConnection();
  
  if (ok) {
    console.log('\\n✅ 连接测试成功！');
  } else {
    console.log('\\n❌ 连接测试失败！');
  }
  
  return ok;
}

// ==================== 主程序 ====================

async function main() {
  console.log('\\n' + '='.repeat(60));
  console.log('   NiceAIGC 桥接插件 - Node.js 使用示例');
  console.log('='.repeat(60));
  
  const examples = [
    { name: '基础使用', fn: exampleBasic },
    { name: '保存文件', fn: exampleSaveToFile },
    { name: 'Express 集成', fn: exampleExpressIntegration },
    { name: '前端调用', fn: exampleFrontendCall },
    { name: '批量处理', fn: exampleBatchProcessing },
    { name: '测试连接', fn: exampleTestConnection },
  ];
  
  if (process.argv.length > 2) {
    // 运行指定示例
    const idx = parseInt(process.argv[2]) - 1;
    if (idx >= 0 && idx < examples.length) {
      await examples[idx].fn();
    } else {
      console.log(\`无效示例编号：\${idx + 1}\`);
    }
  } else {
    // 显示菜单
    console.log('\\n可用示例：');
    examples.forEach((ex, i) => {
      console.log(\`  \${i + 1}. \${ex.name}\`);
    });
    console.log('\\n运行方式：node examples.js [示例编号]');
    console.log('例如：node examples.js 1');
  }
}

main().catch(console.error);
