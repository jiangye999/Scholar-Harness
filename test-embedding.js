import fetch from 'node-fetch';

async function testDeepSeekEmbedding() {
  const apiKey = process.env.API_KEY || 'your-api-key';
  const apiUrl = process.env.API_URL || 'https://api.deepseek.com/v1';
  
  try {
    const response = await fetch(`${apiUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-embedding-v2',
        input: '这是一个测试文本'
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Embedding API 错误:', response.status, error);
      return false;
    }
    
    const data = await response.json();
    console.log('✅ Embedding API 可用');
    console.log('向量维度:', data.data[0].embedding.length);
    return true;
  } catch (e) {
    console.error('❌ Embedding API 测试失败:', e.message);
    return false;
  }
}

testDeepSeekEmbedding();
