const http = require('http');

console.log('Testing Feishu API endpoint...\n');

// Test 1: Check if API endpoint exists
const postData = JSON.stringify({
  appId: 'test_app_id',
  appSecret: 'test_app_secret'
});

const options = {
  hostname: 'localhost',
  port: 18789,
  path: '/api/feishu/config',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(postData)
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log(`Headers: ${JSON.stringify(res.headers)}`);
  
  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });
  res.on('end', () => {
    console.log(`Response: ${body}`);
    try {
      const data = JSON.parse(body);
      if (data.success) {
        console.log('✅ API endpoint is working!');
      } else {
        console.log('⚠️ API returned error:', data.error);
      }
    } catch (e) {
      console.log('⚠️ Could not parse response');
    }
  });
});

req.on('error', (e) => {
  console.log('❌ Request failed:', e.message);
  console.log('\nPossible reasons:');
  console.log('1. Server is not running');
  console.log('2. API endpoint is not registered');
  console.log('3. Wrong port (expected 18789)');
});

req.write(postData);
req.end();
