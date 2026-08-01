const readline = require('readline');

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}

// Some community MCP packages incorrectly send their logger output to stdout.
// Scholar Harness must ignore these lines without losing JSON-RPC responses.
process.stdout.write('info: booting noisy MCP server\n');

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  if (request.method === 'initialize') {
    process.stdout.write('warn: this line is not a JSON-RPC message\n');
    send(request.id, {
      protocolVersion: request.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-noisy-mcp', version: '1.0.0' },
    });
    return;
  }
  if (request.method === 'tools/list') {
    send(request.id, {
      tools: [{
        name: 'echo_noisy',
        description: 'Echo input after writing a noisy log line',
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
    process.stdout.write('error: simulated application log, not a protocol error\n');
    send(request.id, {
      content: [{ type: 'text', text: String(request.params.arguments.text || '') }],
      structuredContent: { echoed: request.params.arguments.text || '' },
      isError: false,
    });
  }
});
