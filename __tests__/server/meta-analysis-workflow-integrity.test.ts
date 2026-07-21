import { readFileSync } from 'fs';
import path from 'path';

import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  path.resolve(__dirname, '../../src/server/routes/meta-analysis.ts'),
  'utf-8',
);
const serverSource = readFileSync(
  path.resolve(__dirname, '../../src/server/local-server.ts'),
  'utf-8',
);
const publicHtml = readFileSync(
  path.resolve(__dirname, '../../src/public/index.html'),
  'utf-8',
);
const pluginSource = readFileSync(
  path.resolve(__dirname, '../../plugins/scholar-harness-meta-analysis/src/server.ts'),
  'utf-8',
);
const pluginSkill = readFileSync(
  path.resolve(__dirname, '../../plugins/scholar-harness-meta-analysis/skills/meta-analysis-workflow/SKILL.md'),
  'utf-8',
);

describe('Meta analysis workflow integrity', () => {
  it('honors the confirmed MD/lnRR measure and only applies the positive-mean rule to lnRR', () => {
    expect(routeSource).toContain('resolveAutoOutcomeMeasure(spec, result, input)');
    expect(routeSource).toContain("measureByOutcome.get(spec.key) || 'lnRR_mean_only'");
    expect(routeSource).toContain(
      "(measure === 'lnRR' || measure === 'lnRR_mean_only') && (treatmentMean <= 0 || controlMean <= 0)",
    );
    expect(routeSource).toContain("return 'MD_mean_only'");
    expect(routeSource).toContain('controlRules: MetaControlRule[]');
    expect(serverSource).toContain('不同科学问题必须建立不同 controlRules');
  });

  it('uses equal study/cluster bootstrap rather than resampling dependent effect rows', () => {
    expect(routeSource).toContain('const clusterValues = new Map<string, number[]>()');
    expect(routeSource).toContain("method: 'mean-only equal-cluster non-parametric bootstrap'");
    expect(routeSource).toContain('bootstrap_cluster_mean <- function(d');
    expect(routeSource).toContain('cluster_means <- vapply(split(d$yi, d$cluster_id), mean');
    expect(routeSource).not.toContain('boots <- replicate(iterations, mean(sample(x, size = length(x), replace = TRUE)))');
    expect(pluginSkill).toContain('Never treat effect rows');
  });

  it('binds writing context and R artifacts to exact analysis and conversation versions', () => {
    expect(routeSource).toContain("path.join(getMetaAnalysisWritingContextDir(userId), 'runs'");
    expect(routeSource).toContain("path.join(getMetaAnalysisWritingContextDir(userId), 'conversations'");
    expect(routeSource).toContain('datasetFingerprint');
    expect(publicHtml).toContain("params.set('conversationId', currentConversationId)");
    expect(publicHtml).toContain('analysisId: pdfWikiMetaAnalysisLastRun');
    expect(publicHtml).toContain("conversationId: currentConversationId || ''");
  });

  it('generates standard-model study-level diagnostics but blocks invalid mean-only diagnostics', () => {
    expect(routeSource).toContain('_study_cluster_forest');
    expect(routeSource).toContain('_study_cluster_funnel');
    expect(routeSource).toContain('_leave_one_study_out.csv');
    expect(routeSource).toContain('_study_cluster_baujat');
    expect(routeSource).toContain('length(unique(d$cluster_id))');
    expect(routeSource).toContain('pi_lower = pi_lower');
    expect(routeSource).toContain('Funnel, Egger, Baujat and conventional heterogeneity diagnostics are not applicable to mean-only data');
  });

  it('reports evidence-quality coverage without equating significance with certainty', () => {
    expect(routeSource).toContain('偏倚风险评价');
    expect(routeSource).toContain('证据确定性（GRADE）');
    expect(routeSource).toContain('不要把统计显著性直接解释为高确定性证据');
  });

  it('keeps the Codex plugin on the active desktop user and exact analysis run', () => {
    expect(pluginSource).toContain("apiJson('/api/meta-analysis/active-user')");
    expect(pluginSource).toContain("params.set('analysisId', args.analysisId.trim())");
    expect(pluginSource).toContain('analysisId: run.analysisId');
    expect(pluginSource).toContain('conversationId: run.conversationId');
  });
});
