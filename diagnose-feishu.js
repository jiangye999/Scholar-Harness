const http = require('http');

function test(url, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 18789,
      path: url,
      method: method,
      headers: data ? {'Content-Type': 'application/json'} : {}
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        console.log(`${method} ${url} → ${res.statusCode}`);
        try {
          const json = JSON.parse(body);
          console.log(JSON.stringify(json, null, 2));
        } catch(e) {
          console.log(body);
        }
        resolve({status: res.statusCode, data: body});
      });
    });
    
    req.on('error', (e) => {
      console.error(`❌ ${method} ${url} → ERROR: ${e.message}`);
      reject(e);
    });
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function diagnose() {
  console.log('=== 飞书配置诊断 ===\n');
  
  try {
    console.log('1. 测试 GET /api/feishu/status');
    await test('/api/feishu/status');
    
    console.log('\n2. 测试 POST /api/feishu/config');
    await test('/api/feishu/config', 'POST', {
      appId: 'cli_test123',
      appSecret: 'test_secret_12345'
    });
    
    console.log('\n3. 再次检查状态');
    await test('/api/feishu/status');
    
    console.log('\n=== 诊断完成 ===\n');
    console.log('如果看到 200 状态码，说明 API 正常工作。');
    console.log('如果看到错误，请检查：');
    console.log('1. 服务器是否运行 (npm start)');
    console.log('2. 端口是否为 18789');
    console.log('3. 服务器日志中是否有 Feishu 相关输出');
  } catch (error) {
    console.error('\n诊断失败:', error.message);
    console.log('\n可能的原因:');
    console.log('1. 服务器未运行 → 执行: npm start');
    console.log('2. 端口不是 18789 → 修改脚本中的 port');
    console.log('3. API 端点未注册 → 重新编译：npm run build');
  }
}

diagnose().catch(console.error);
