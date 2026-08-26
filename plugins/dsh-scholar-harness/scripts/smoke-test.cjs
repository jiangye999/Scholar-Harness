#!/usr/bin/env node
/**
 * dsh-scholar-harness 冒烟测试（零依赖，连活服务）。
 *
 * 用法：
 *   node scripts/smoke-test.cjs
 *   SCHOLAR_HARNESS_URL=http://127.0.0.1:18789 node scripts/smoke-test.cjs
 *
 * 覆盖：引擎各方法、工具注册契约、路由表、客户端 bundle 契约。
 * 退出码：0 = 全部通过；1 = 任一失败。
 */
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const PKG_ROOT = path.resolve(__dirname, '..');

// 让 @deepseek-ai/* 从插件自身的 node_modules junction 解析（与宿主加载一致）。
const req = createRequire(path.join(PKG_ROOT, 'package.json'));

let pass = 0;
let fail = 0;

function ok(name, detail) {
  pass += 1;
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
}
function bad(name, detail) {
  fail += 1;
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
}

(async () => {
  // ---- 1. 宿主模块可加载 ----
  let engineMod;
  try {
    engineMod = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'engine.js')).href);
    ok('engine.js 可加载', typeof engineMod.ScholarHarnessClient);
  } catch (error) {
    bad('engine.js 可加载', error.message);
    process.exit(1);
  }

  // ---- 2. 连活服务：健康/文献/PDF Wiki/Meta/检索 ----
  const engine = new engineMod.ScholarHarnessClient({
    baseUrl: process.env.SCHOLAR_HARNESS_URL || 'http://127.0.0.1:18789',
    timeoutMs: 15000,
  });
  try {
    const health = await engine.health();
    ok('engine.health()', health.reachable ? `服务可达，用户 ${health.activeUserId}` : `不可达: ${health.error}`);
  } catch (error) {
    bad('engine.health()', error.message);
  }
  try {
    const lit = await engine.literature();
    ok('engine.literature()', `success=${lit.success} count=${lit.count}`);
  } catch (error) {
    bad('engine.literature()', error.message);
  }
  try {
    const wiki = await engine.pdfWikiStatus();
    ok('engine.pdfWikiStatus()', `success=${wiki.success} entries=${wiki.entryCount} points=${wiki.sentencePointCount}`);
  } catch (error) {
    bad('engine.pdfWikiStatus()', error.message);
  }
  try {
    const topics = await engine.pdfWikiTopics();
    ok('engine.pdfWikiTopics()', `success=${topics.success} topics=${topics.topics.length}`);
  } catch (error) {
    bad('engine.pdfWikiTopics()', error.message);
  }
  try {
    const meta = await engine.metaDatabase();
    ok('engine.metaDatabase()', `success=${meta.success} pdfs=${meta.pdfCount}`);
  } catch (error) {
    bad('engine.metaDatabase()', error.message);
  }
  try {
    const search = await engine.literatureSearch({ query: 'soil nitrogen', topK: 2 });
    ok('engine.literatureSearch()', `success=${search.success} returned=${search.results.length}`);
  } catch (error) {
    bad('engine.literatureSearch()', error.message);
  }

  // ---- 3. 工具注册契约 ----
  let toolsMod;
  try {
    toolsMod = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'tools.js')).href);
    const names = Object.keys(toolsMod).filter((k) => k.endsWith('Tool'));
    ok('tools.js 导出 6 个工具', names.join(', '));
  } catch (error) {
    bad('tools.js 导出', error.message);
  }

  // ---- 4. 路由表 ----
  let routesMod;
  try {
    routesMod = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'routes.js')).href);
    const routes = routesMod.makeScholarRoutes({ engine });
    ok('makeScholarRoutes()', `${routes.length} 条路由`);
  } catch (error) {
    bad('makeScholarRoutes()', error.message);
  }

  // ---- 5. 客户端 bundle 契约 ----
  const clientSrc = fs.readFileSync(path.join(PKG_ROOT, 'lib', 'client.js'), 'utf8');
  const checks = {
    'window.__ModuleLoader__.load({': clientSrc.includes('window.__ModuleLoader__.load({'),
    'id: "dsh-scholar-harness"': clientSrc.includes('id: "dsh-scholar-harness"'),
    'factory: (require) => {': clientSrc.includes('factory: (require) => {'),
    'exports.apply = apply': clientSrc.includes('exports.apply = apply'),
    'exports.inject = inject': clientSrc.includes('exports.inject = inject'),
    'return module.exports': clientSrc.includes('return module.exports'),
  };
  for (const [fragment, found] of Object.entries(checks)) {
    if (found) ok(`client.js 含 ${fragment}`);
    else bad(`client.js 缺 ${fragment}`);
  }

  // ---- 6. package.json 的 dsh 声明 ----
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  if (pkg.dsh?.bundle?.patch && pkg.dsh?.client?.platform === 'web' && pkg.exports?.['./client']) {
    ok('package.json dsh 声明', `bundle.patch=${pkg.dsh.bundle.patch} client.platform=${pkg.dsh.client.platform}`);
  } else {
    bad('package.json dsh 声明', JSON.stringify(pkg.dsh));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('smoke-test crashed:', error);
  process.exit(1);
});

function pathToFileURL(p) {
  const resolved = path.resolve(p);
  return { href: 'file:///' + resolved.replace(/\\/g, '/') };
}
