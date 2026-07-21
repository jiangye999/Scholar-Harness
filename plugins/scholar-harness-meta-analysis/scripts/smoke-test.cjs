const { spawn } = require('node:child_process');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const child = spawn(process.execPath, [path.join(pluginRoot, 'dist', 'server.js')], {
  cwd: pluginRoot,
  stdio: ['pipe', 'pipe', 'inherit'],
});

let output = '';
const live = process.argv.includes('--live');
const expectedTools = [
  'meta_health',
  'meta_list_sources',
  'meta_upload_pdfs',
  'meta_extract_sources',
  'meta_get_source',
  'meta_add_coding_column',
  'meta_save_coding_table',
  'meta_delete_coding_selection',
  'meta_import_digitized_data',
  'meta_export_coding_tables',
  'meta_inspect_dataset',
  'meta_plan_analysis',
  'meta_run_analysis',
  'meta_get_results',
  'meta_export_results',
  'pdfwiki_obsidian_status',
  'pdfwiki_obsidian_sync',
  'pdfwiki_obsidian_search',
  'pdfwiki_obsidian_export',
];
const timer = setTimeout(() => {
  child.kill();
  throw new Error('MCP smoke test timed out');
}, 5000);

child.stdout.setEncoding('utf8');
child.stdout.on('data', chunk => {
  output += chunk;
  const lines = output.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < (live ? 3 : 2)) return;
  const responses = lines.map(line => JSON.parse(line));
  const tools = responses.find(item => item.id === 2)?.result?.tools || [];
  if (!responses.find(item => item.id === 1)?.result?.serverInfo) return;
  const toolNames = new Set(tools.map(tool => tool.name));
  const missingTools = expectedTools.filter(name => !toolNames.has(name));
  if (missingTools.length > 0) throw new Error(`Missing tools: ${missingTools.join(', ')}`);
  if (tools.length !== expectedTools.length) {
    throw new Error(`Expected exactly ${expectedTools.length} tools, received ${tools.length}`);
  }
  if (live) {
    const healthText = responses.find(item => item.id === 3)?.result?.content?.[0]?.text || '';
    if (!healthText.includes('"status": "ok"')) throw new Error(`Live health tool failed: ${healthText}`);
  }
  clearTimeout(timer);
  child.kill();
  process.stdout.write(`MCP smoke test passed: ${tools.length} tools${live ? ', live API connected' : ''}\n`);
});

child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } } })}\n`);
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`);
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`);
if (live) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'meta_health', arguments: {} } })}\n`);
}
