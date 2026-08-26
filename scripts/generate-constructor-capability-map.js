const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputPath = path.join(root, 'configs', 'constructor-agent', 'software-capability-map.json');

function walk(relativeDir, extensions) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];
  const output = [];
  const pending = [absoluteDir];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(fullPath);
      else if (!extensions || extensions.some(extension => entry.name.endsWith(extension))) {
        output.push(path.relative(root, fullPath).replace(/\\/g, '/'));
      }
    }
  }
  return output.sort();
}

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), 'utf8');
  } catch {
    return '';
  }
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

const routeFiles = walk('src/server/routes', ['.ts']);
const cloudRouteFiles = walk('cloud/server/routes', ['.ts']);
const frontendFiles = walk('src/public/app', ['.js']);
const styleFiles = walk('src/public/styles', ['.css']);
const serviceFiles = walk('src/server/services', ['.ts']);

function extractEndpoints(relativePath) {
  const source = read(relativePath);
  const endpoints = [];
  const matcher = /(?:router|app)\.(get|post|put|patch|delete|use)\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = matcher.exec(source))) endpoints.push(`${match[1].toUpperCase()} ${match[2]}`);
  return unique(endpoints);
}

function extractFrontendCapabilities(relativePath) {
  const source = read(relativePath);
  const globals = [];
  const endpoints = [];
  let match;
  const globalMatcher = /window\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((match = globalMatcher.exec(source))) globals.push(match[1]);
  const endpointMatcher = /['"`]((?:\/api\/)[A-Za-z0-9_?&=\-\/${}.:%]+)['"`]/g;
  while ((match = endpointMatcher.exec(source))) endpoints.push(match[1]);
  return { globals: unique(globals), endpoints: unique(endpoints) };
}

const domains = [
  { id: 'chat-agent', name: '主页聊天与两级 Agent', aliases: ['聊天', 'Agent', '模型', '工作目录', '历史对话'], paths: ['agents', 'workflows', 'src/bridge', 'src/orchestrator', 'src/server/routes/unified-chat.ts', 'src/server/unified-chat-processor.ts', 'src/public/app/chat-controls.js', 'src/public/app/chat-rendering.js'] },
  { id: 'pdf-wiki', name: 'PDF 管理与 Wiki 句子级证据库', aliases: ['PDF', 'Wiki', '论点库', '引用', '证据句'], paths: ['src/utils/pdf-wiki-manager.ts', 'src/utils/pdf-wiki-pdf-management.ts', 'src/server/routes/pdf-fast-text.ts', 'src/server/routes/pdf-marker.ts', 'src/public/app/pdf-wiki.js', 'src/public/app/pdf-wiki-graph.js'] },
  { id: 'literature', name: '文献、Embedding 与混合检索', aliases: ['文献', 'Embedding', 'BM25', 'reranker', '检索'], paths: ['src/literature', 'src/utils/retrieval-engine-manager.ts', 'src/server/routes/embedding-library.ts'] },
  { id: 'meta-analysis', name: 'Meta 分析与图像数字化复核', aliases: ['Meta', '效应量', '数字化复核', '森林图'], paths: ['src/server/routes/meta-analysis.ts', 'src/server/routes/experiment-results.ts', 'src/server/services/experiment-analyzer.ts', 'src/public/app/meta-analysis.js'] },
  { id: 'bibliometrics', name: '文献计量分析', aliases: ['文献计量', '关键词网络', '合作网络'], paths: ['src/server/routes/bibliometrics.ts', 'src/utils/bibliometrics.ts', 'src/utils/bibliometrics-artifacts.ts', 'src/public/app/academic-workflows.js'] },
  { id: 'auto-research', name: 'Auto Research', aliases: ['Auto Research', '选题审查', '研究蓝图'], paths: ['src/utils/autoresearch-manager.ts', 'src/server/routes/autoresearch.ts', 'src/public/app/auto-research.js'] },
  { id: 'data-r', name: '数据分析与 R/Python/Office 工具', aliases: ['R', 'Python', 'Office', '作图', '数据分析'], paths: ['src/server/routes/r-code.ts', 'src/server/routes/data-analysis.ts', 'src/server/routes/python-plugin.ts', 'src/server/routes/office-plugin.ts', 'src/public/app/analysis-tools.js'] },
  { id: 'skills-plugins', name: 'Skill、MCP 与插件市场', aliases: ['Skill', 'MCP', '插件', '工具'], paths: ['skills', 'sci_writing_skills', 'src/server/routes/user-skills.ts', 'src/server/routes/mcp-plugins.ts', 'src/public/app/skill-config.js'] },
  { id: 'desktop-shell', name: 'Electron 桌面壳与安装更新', aliases: ['Electron', '窗口', '侧边栏', '安装包', '更新'], paths: ['electron', 'scripts', 'package.json'] },
  { id: 'cloud', name: '云端账号、授权、支付与分销', aliases: ['登录', '授权', '支付', '订阅', '分销商'], paths: ['cloud'] },
  { id: 'website', name: '官网、下载与帮助', aliases: ['官网', '下载页', '注册页', '帮助'], paths: ['scholarharness-website'] },
];

const map = {
  schemaVersion: 1,
  appVersion: JSON.parse(read('package.json') || '{}').version || 'unknown',
  purpose: 'Constructor Agent build-time software capability map',
  sourceMode: 'generated-at-build-time',
  domains,
  inventory: {
    frontendModules: frontendFiles.map(file => ({ file, ...extractFrontendCapabilities(file) })),
    frontendStyles: styleFiles,
    localRoutes: routeFiles.map(file => ({ file, endpoints: extractEndpoints(file) })),
    cloudRoutes: cloudRouteFiles.map(file => ({ file, endpoints: extractEndpoints(file) })),
    services: serviceFiles,
  },
  protectedZones: [
    { id: 'identity', paths: ['cloud/auth', 'cloud/server/middleware'], approval: 'critical' },
    { id: 'payment-license', paths: ['cloud/payment', 'cloud/server/routes'], approval: 'critical' },
    { id: 'electron-main', paths: ['electron'], approval: 'high' },
    { id: 'database-migration', paths: ['cloud/database'], approval: 'critical' },
    { id: 'updater-release', paths: ['package.json', 'scripts', 'scholarharness-website/public/downloads'], approval: 'high' },
    { id: 'user-data', paths: ['src/utils/paths.ts', 'src/server/routes'], approval: 'critical' },
  ],
  governance: {
    low: '可逆的运行时功能包；安装后默认停用',
    medium: '影响既有页面或数据表现；要求方案确认',
    high: '核心源码、Electron 或跨模块契约；要求方案批准与应用批准',
    critical: '认证、支付、授权、数据库迁移或用户数据；要求双重批准、备份、验证和自动回滚',
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8');
const endpointCount = [...map.inventory.localRoutes, ...map.inventory.cloudRoutes].reduce((sum, item) => sum + item.endpoints.length, 0);
process.stdout.write(`[constructor-map] ${domains.length} domains, ${frontendFiles.length} frontend modules, ${routeFiles.length + cloudRouteFiles.length} route files, ${endpointCount} endpoints\n`);
