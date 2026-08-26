#!/usr/bin/env node
/**
 * dsh-meta-analysis 冒烟测试（零依赖，纯本地，不连 Scholar Harness）。
 *
 * 用法：node scripts/smoke-test.cjs
 * 覆盖：存储、统计引擎（效应量/汇总/异质性/亚组/bootstrap）、R 脚本、
 *       CSV、Markdown、工具导出、路由表、客户端 bundle 契约。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const PKG_ROOT = path.resolve(__dirname, '..');
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-meta-smoke-'));

let pass = 0;
let fail = 0;
function ok(name, detail) { pass += 1; console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`); }
function bad(name, detail) { fail += 1; console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }

function pathToFileURL(p) {
  const resolved = path.resolve(p);
  return { href: 'file:///' + resolved.replace(/\\/g, '/') };
}

(async () => {
  const { MetaStore } = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'store.js')).href);
  const stats = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'stats.js')).href);
  const { MetaEngine } = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'engine.js')).href);
  const { makeMetaRoutes } = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'routes.js')).href);
  const tools = await import(pathToFileURL(path.join(PKG_ROOT, 'lib', 'tools.js')).href);

  // ---- 1. store ----
  try {
    const store = new MetaStore({ dataRoot: TMP_ROOT, userId: 'smoke' });
    const project = store.createProject({ name: '冒烟项目' });
    const project2 = store.getProject(project.id);
    ok('store CRUD', `id=${project.id} name=${project2.name}`);
  } catch (error) {
    bad('store CRUD', error.message);
  }

  // ---- 2. stats: effect sizes ----
  const lnrr = stats.calculateEffectSize({ treatmentMean: 12, treatmentSd: 2, treatmentN: 10, controlMean: 10, controlSd: 2.5, controlN: 10 }, 'lnRR', 1);
  ok('lnRR 效应量', lnrr.ok ? `yi=${lnrr.yi.toFixed(4)} vi=${lnrr.vi.toFixed(4)}` : lnrr.reason);
  const md = stats.calculateEffectSize({ treatmentMean: 12, treatmentSd: 2, treatmentN: 10, controlMean: 10, controlSd: 2.5, controlN: 10 }, 'MD', 1);
  ok('MD 效应量', md.ok ? `yi=${md.yi.toFixed(4)} vi=${md.vi.toFixed(4)}` : md.reason);
  const smd = stats.calculateEffectSize({ treatmentMean: 12, treatmentSd: 2, treatmentN: 10, controlMean: 10, controlSd: 2.5, controlN: 10 }, 'SMD', 1);
  ok('SMD 效应量', smd.ok ? `yi=${smd.yi.toFixed(4)} vi=${smd.vi.toFixed(4)}` : smd.reason);
  const meanOnly = stats.calculateEffectSize({ treatmentMean: 12, controlMean: 10 }, 'lnRR_mean_only', 1);
  ok('mean-only lnRR', meanOnly.ok ? `yi=${meanOnly.yi.toFixed(4)}` : meanOnly.reason);

  // ---- 3. stats: build effect rows + summarize ----
  const dataset = stats.datasetFromSources([
    {
      pdfId: 's1',
      title: 'Study A',
      dataTable: {
        columns: ['Study#', 'biomass_tmean', 'biomass_tsd', 'biomass_tn', 'biomass_ckmean', 'biomass_cksd', 'biomass_ckn', '土壤类型'],
        rows: [
          { 'Study#': 'A1', biomass_tmean: '12', biomass_tsd: '2', biomass_tn: '10', biomass_ckmean: '10', biomass_cksd: '2.5', biomass_ckn: '10', '土壤类型': '砂土' },
          { 'Study#': 'A2', biomass_tmean: '14', biomass_tsd: '2.2', biomass_tn: '12', biomass_ckmean: '11', biomass_cksd: '2.8', biomass_ckn: '12', '土壤类型': '砂土' },
          { 'Study#': 'A3', biomass_tmean: '11', biomass_tsd: '1.8', biomass_tn: '8', biomass_ckmean: '9.5', biomass_cksd: '2.1', biomass_ckn: '8', '土壤类型': '黏土' },
          { 'Study#': 'A4', biomass_tmean: '15', biomass_tsd: '3', biomass_tn: '15', biomass_ckmean: '12', biomass_cksd: '3.2', biomass_ckn: '15', '土壤类型': '黏土' },
          { 'Study#': 'A5', biomass_tmean: '13', biomass_tsd: '2.4', biomass_tn: '9', biomass_ckmean: '10.5', biomass_cksd: '2.2', biomass_ckn: '9', '土壤类型': '砂土' },
          { 'Study#': 'A6', biomass_tmean: '12.5', biomass_tsd: '2.1', biomass_tn: '11', biomass_ckmean: '10.8', biomass_cksd: '2.6', biomass_ckn: '11', '土壤类型': '黏土' },
        ],
      },
    },
  ]);
  const config = {
    model: 'random',
    method: 'REML',
    studyIdColumn: 'Study#',
    clusterBy: 'Study#',
    subgroupColumns: ['土壤类型'],
    outcomes: [
      {
        id: 'biomass', label: '生物量',
        measure: 'lnRR',
        treatmentMean: 'biomass_tmean', treatmentSd: 'biomass_tsd', treatmentN: 'biomass_tn',
        controlMean: 'biomass_ckmean', controlSd: 'biomass_cksd', controlN: 'biomass_ckn',
        direction: 1,
      },
    ],
  };
  const effectBuild = stats.buildEffectRows(dataset, config);
  ok('buildEffectRows', `${effectBuild.effectRows.length} 行，跳过 ${effectBuild.skippedRows.length}`);
  const summaries = stats.summarizeEffects(effectBuild.effectRows);
  ok('summarizeEffects', summaries.length ? `${summaries[0].outcomeLabel} k=${summaries[0].k} I2=${Number.isFinite(summaries[0].heterogeneity.i2) ? summaries[0].heterogeneity.i2.toFixed(1) : 'n/a'}%` : 'none');
  const subgroups = stats.summarizeSubgroups(effectBuild.effectRows, ['土壤类型']);
  ok('summarizeSubgroups', `${subgroups.length} 组`);

  // ---- 4. inspect ----
  const engine = new MetaEngine({ dataRoot: TMP_ROOT, userId: 'smoke' });
  const project = engine.store.getProject();
  const sources = project.sources || [];
  const inspect = engine.inspect(dataset, project.id, sources.map(s => s.pdfId));
  ok('inspect', `candidates=${inspect.candidateOutcomes.length} moderators=${inspect.moderatorCandidates.length} warnings=${inspect.warnings.length}`);

  // ---- 5. full run ----
  const run = engine.run(dataset, config, { sourcePdfIds: ['s1'] });
  ok('run', `analysisId=${run.analysisId} effects=${run.effectRows.length} summaries=${run.summaries.length} subgroups=${run.subgroups.length}`);
  ok('run.csv', `${run.effectRowsCsv.split('\n').length} 行`);
  ok('run.rCode', `${run.rCode.split('\n').length} 行 R 脚本，含 metafor: ${run.rCode.includes('metafor')}`);
  ok('run.markdown', `含合并效应量: ${run.markdown.includes('合并效应量')}`);
  ok('run.writingContext', run.writingContext
    ? `available=${run.writingContext.available} contextMarkdown=${(run.writingContext.contextMarkdown || '').split('\n').length} 行`
    : 'MISSING');

  // ---- 6. routes ----
  try {
    const routes = makeMetaRoutes({ store: engine.store, engine });
    ok('routes', `${routes.length} 条`);
  } catch (error) {
    bad('routes', error.message);
  }

  // ---- 7. tools ----
  try {
    const names = Object.keys(tools).filter(k => k.startsWith('dshMeta') && k.endsWith('Tool'));
    ok('tools', names.join(', '));
  } catch (error) {
    bad('tools', error.message);
  }

  // ---- 8. client bundle contract ----
  const clientSrc = fs.readFileSync(path.join(PKG_ROOT, 'lib', 'client.js'), 'utf8');
  const checks = {
    'window.__ModuleLoader__.load({': clientSrc.includes('window.__ModuleLoader__.load({'),
    'id: "dsh-meta-analysis"': clientSrc.includes('id: "dsh-meta-analysis"'),
    'exports.apply': clientSrc.includes('exports.apply = apply'),
    'exports.inject': clientSrc.includes('exports.inject = inject'),
    'view marker': clientSrc.includes('data-dsh-meta-view'),
  };
  for (const [fragment, found] of Object.entries(checks)) {
    if (found) ok(`client.js 含 ${fragment}`);
    else bad(`client.js 缺 ${fragment}`);
  }

  // ---- 9. package.json dsh 声明 ----
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
  if (pkg.dsh?.bundle?.patch && pkg.dsh?.client?.platform === 'web' && pkg.exports?.['./client']) {
    ok('package.json dsh 声明');
  } else {
    bad('package.json dsh 声明');
  }

  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((error) => {
  console.error('smoke-test crashed:', error);
  process.exit(1);
});
