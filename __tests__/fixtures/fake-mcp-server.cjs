const readline = require('readline');

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    send(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-mcp', version: '1.0.0' },
    });
    return;
  }
  if (request.method === 'tools/list') {
    send(request.id, {
      tools: [{
        name: 'echo',
        description: 'Echo input',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
        },
      }],
    });
    return;
  }
  if (request.method === 'tools/call') {
    send(request.id, {
      content: [{ type: 'text', text: String(request.params.arguments.text || '') }],
      structuredContent: { echoed: request.params.arguments.text || '' },
      isError: false,
    });
  }
});
