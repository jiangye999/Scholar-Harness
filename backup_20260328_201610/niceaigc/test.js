/**
 * NiceAIGC 桥接插件 - 快速测试脚本
 * 
 * 使用方式：
 *   node test.js
 *   node test.js "自定义测试消息"
 */

import NiceAIGCBridge from './bridge.js';

async function test() {
  console.log('');
  console.log('='.repeat(60));
  console.log('   NiceAIGC 桥接插件 - 连接测试');
  console.log('='.repeat(60));
  console.log('');
  
  const bridge = new NiceAIGCBridge();
  
  // 加载配置
  try {
    await bridge.loadConfig();
    console.log('✅ 配置加载成功');
    console.log(`   模式：${bridge.config.mode}`);
    console.log(`   NiceAIGC URL: ${bridge.config.niceaigc.chat_url}`);
    console.log('');
  } catch (error) {
    console.log('❌ 配置加载失败');
    console.log(`   错误：${error.message}`);
    console.log('');
    console.log('请检查 config.json 文件是否存在且格式正确');
    return false;
  }
  
  // 测试消息
  const testMessage = process.argv[2] || '你好，请帮我测试一下这个桥接插件是否正常工作。如果收到这条消息，请回复"测试成功"。';
  
  console.log('发送测试消息...');
  console.log(`消息：${testMessage.substring(0, 50)}${testMessage.length > 50 ? '...' : ''}`);
  console.log('');
  
  try {
    console.log('正在连接到 NiceAIGC...');
    const response = await bridge.sendMessage(testMessage);
    
    console.log('');
    console.log('✅ 测试成功！');
    console.log('');
    console.log('AI 响应:');
    console.log('-'.repeat(60));
    console.log(response);
    console.log('-'.repeat(60));
    console.log('');
    console.log(`响应长度：${response.length} 字符`);
    console.log('');
    console.log('='.repeat(60));
    console.log('桥接插件工作正常！可以开始集成了。');
    console.log('='.repeat(60));
    console.log('');
    console.log('下一步:');
    console.log('  1. 查看 NODEJS_INTEGRATION.md 了解集成方法');
    console.log('  2. 运行 node examples.js 查看更多示例');
    console.log('  3. 运行 node server.js 启动 HTTP 服务');
    console.log('');
    
    return true;
    
  } catch (error) {
    console.log('');
    console.log('❌ 测试失败！');
    console.log('');
    console.log(`错误信息：${error.message}`);
    console.log('');
    console.log('可能的原因:');
    console.log('  1. Chrome 未启动或未登录 NiceAIGC');
    console.log('  2. NiceAIGC URL 配置错误');
    console.log('  3. 网络连接问题');
    console.log('  4. 页面元素识别失败');
    console.log('');
    console.log('建议:');
    console.log('  1. 手动打开 NiceAIGC 网站并登录');
    console.log('  2. 检查 config.json 中的 chat_url 是否正确');
    console.log('  3. 确保 OpenClaw browser 工具正常工作');
    console.log('');
    
    return false;
  }
}

// 运行测试
test()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('未捕获的错误:', error);
    process.exit(1);
  });
