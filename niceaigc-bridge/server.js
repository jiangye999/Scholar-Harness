/**
 * NiceAIGC 桥接插件 - HTTP 服务器
 * 
 * 启动后提供 REST API 供你的后端调用
 * 
 * 使用方式：
 *   node server.js --port 8765
 * 
 * API 端点：
 *   POST /chat - 发送消息
 *   POST /chat/file - 发送消息并保存文件
 *   GET /health - 健康检查
 */

import express from 'express';
import cors from 'cors';
import NiceAIGCBridge from './bridge.js';

const app = express();
const PORT = process.env.PORT || 8765;

/**
 * 获取默认输出路径（跨平台兼容）
 */
function getDefaultOutputPath() {
  return 'data/niceaigc_response.txt';
}

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));

// 初始化桥接器
const bridge = new NiceAIGCBridge();

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'niceaigc-bridge', timestamp: new Date().toISOString() });
});

/**
 * POST /chat
 * 发送消息到 NiceAIGC
 * 
 * 请求体：
 * {
 *   "message": "请帮我润色这段论文...",
 *   "mode": "browser"  // 可选，默认 browser
 * }
 * 
 * 响应：
 * {
 *   "response": "AI 的回复内容",
 *   "success": true,
 *   "timestamp": "..."
 * }
 */
app.post('/chat', async (req, res) => {
  try {
    const { message, mode } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: '缺少 message 参数' 
      });
    }
    
    console.log(`[Server] 收到请求 | 消息长度：${message.length}`);
    
    const response = await bridge.sendMessage(message, mode);
    
    res.json({
      success: true,
      response,
      timestamp: new Date().toISOString(),
      mode: mode || 'browser'
    });
    
  } catch (error) {
    console.error(`[Server] 错误：${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /chat/file
 * 发送消息并保存结果到文件
 * 
 * 请求体：
 * {
 *   "message": "请帮我润色...",
 *   "outputPath": "data/response.txt"  // 可选，相对路径
 * }
 * 
 * 响应：
 * {
 *   "response": "AI 的回复内容",
 *   "savedTo": "data/response.txt",
 *   "success": true
 * }
 */
app.post('/chat/file', async (req, res) => {
  try {
    const { message, outputPath } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        success: false, 
        error: '缺少 message 参数' 
      });
    }
    
    console.log(`[Server] 收到文件保存请求 | 消息长度：${message.length}`);
    
    const response = await bridge.sendAndSave(message, outputPath);
    
    res.json({
      success: true,
      response,
      savedTo: outputPath || getDefaultOutputPath(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[Server] 错误：${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /chat/batch
 * 批量处理多条消息
 * 
 * 请求体：
 * {
 *   "messages": ["消息 1", "消息 2", ...],
 *   "delay": 2000  // 每条消息之间的延迟（毫秒），可选
 * }
 * 
 * 响应：
 * {
 *   "results": [
 *     { "message": "消息 1", "response": "...", "success": true },
 *     { "message": "消息 2", "response": "...", "success": false, "error": "..." }
 *   ],
 *   "total": 2,
 *   "success": 1,
 *   "failed": 1
 * }
 */
app.post('/chat/batch', async (req, res) => {
  try {
    const { messages, delay = 2000 } = req.body;
    
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'messages 必须是非空数组' 
      });
    }
    
    console.log(`[Server] 收到批量请求 | 消息数：${messages.length}`);
    
    const results = [];
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      
      try {
        const response = await bridge.sendMessage(message);
        results.push({
          index: i,
          message,
          response,
          success: true
        });
        successCount++;
      } catch (error) {
        results.push({
          index: i,
          message,
          success: false,
          error: error.message
        });
        failCount++;
      }
      
      // 延迟（避免请求过快）
      if (i < messages.length - 1 && delay > 0) {
        await bridge.sleep(delay);
      }
    }
    
    res.json({
      success: true,
      results,
      total: messages.length,
      success: successCount,
      failed: failCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error(`[Server] 错误：${error.message}`);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log('');
  console.log('='.repeat(60));
  console.log('   NiceAIGC 桥接服务已启动');
  console.log('='.repeat(60));
  console.log(`   端口：${PORT}`);
  console.log(`   地址：http://localhost:${PORT}`);
  console.log('');
  console.log('可用端点:');
  console.log('   GET  /health      - 健康检查');
  console.log('   POST /chat        - 发送消息');
  console.log('   POST /chat/file   - 发送消息并保存文件');
  console.log('   POST /chat/batch  - 批量处理');
  console.log('');
  console.log('示例:');
  console.log('   curl http://localhost:' + PORT + '/health');
  console.log('   curl -X POST http://localhost:' + PORT + '/chat \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"message": "请帮我润色这段论文..."}\'');
  console.log('='.repeat(60));
  console.log('');
});
