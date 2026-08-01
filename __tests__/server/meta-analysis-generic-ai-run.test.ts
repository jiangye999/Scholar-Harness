import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  MetaAnalysisAssistantInput,
  MetaAnalysisAssistantResult,
  MetaAnalysisIntegratedDataTable,
} from '../../src/server/routes/meta-analysis';

const originalDataDir = process.env.DATA_DIR;
const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-harness-meta-generic-'));

let createMetaAnalysisRouter: typeof import('../../src/server/routes/meta-analysis').createMetaAnalysisRouter;
let clearPathCache: typeof import('../../src/utils/paths').clearPathCache;

beforeAll(async () => {
  process.env.DATA_DIR = testDataDir;
  ({ clearPathCache } = await import('../../src/utils/paths'));
  clearPathCache();
  ({ createMetaAnalysisRouter } = await import('../../src/server/routes/meta-analysis'));
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  clearPathCache?.();
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

function createTestApp(
  tables: MetaAnalysisIntegratedDataTable[],
  generateAiPlan: (input: MetaAnalysisAssistantInput) => Promise<MetaAnalysisAssistantResult>,
) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use('/api/meta-analysis', createMetaAnalysisRouter({
    getIntegratedDataTablesForExport: async () => tables,
    generateAiPlan,
  }));
  return app;
}

function table(
  pdfId: string,
  columns: string[],
  rows: Array<Record<string, unknown>>,
): MetaAnalysisIntegratedDataTable {
  return {
    id: `${pdfId}-table`,
    pdfId,
    pdfName: `${pdfId}.pdf`,
    pdfTitle: `Study ${pdfId}`,
    columns,
    rows,
    rowCount: rows.length,
    realRowCount: rows.length,
  };
}

describe('generic Meta AI confirmed execution', () => {
  it('keeps Meta copies, analysis files and writing context in the configured composer workspace', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'scholar-meta-user-workspace-'));
    try {
      const columns = [
        'Study#',
        'Biomass_tmean',
        'Biomass_tsd',
        'Biomass_tn',
        'Biomass_ckmean',
        'Biomass_cksd',
        'Biomass_ckn',
      ];
      const tables = [
        table('p1', columns, [
          { 'Study#': 'S1', Biomass_tmean: 12, Biomass_tsd: 2, Biomass_tn: 5, Biomass_ckmean: 10, Biomass_cksd: 1.8, Biomass_ckn: 5 },
          { 'Study#': 'S2', Biomass_tmean: 18, Biomass_tsd: 2.5, Biomass_tn: 6, Biomass_ckmean: 15, Biomass_cksd: 2.1, Biomass_ckn: 6 },
        ]),
      ];
      const app = createTestApp(tables, async () => ({
        provider: 'test-ai',
        workflowStage: 'ready_for_analysis',
        assistantMessage: '已确认分析配置。',
        operations: [],
        suggestedConfig: {
          model: 'random',
          method: 'REML',
          studyIdColumn: 'Study#',
          clusterBy: 'Study#',
          outcomes: [{
            id: 'biomass',
            label: '生物量',
            measure: 'lnRR',
            treatmentMean: 'Biomass_tmean',
            treatmentSd: 'Biomass_tsd',
            treatmentN: 'Biomass_tn',
            controlMean: 'Biomass_ckmean',
            controlSd: 'Biomass_cksd',
            controlN: 'Biomass_ckn',
          }],
        },
      }));
      const conversationId = 'meta_ai_chat_workspace_storage_123456';
      const aiWorkRoot = path.join(
        workspaceRoot,
        'ScholarHarness_AI_Workspaces',
        'Conversation-writing-session-1',
      );

      const response = await request(app)
        .post('/api/meta-analysis/ai-plan')
        .send({
          userId: 'meta-workspace-storage-test',
          conversationId,
          writingConversationId: 'writing-session-1',
          pdfIds: ['p1'],
          query: '确认，开始分析',
          supplementalContext: {
            workspaceDirectory: {
              enabled: true,
              path: workspaceRoot,
              permission: 'workspace-write',
              aiWorkRoot,
            },
            workspaceFiles: [],
            chatAttachments: [],
            selectedContextSources: {},
            selectedSkills: [],
          },
        })
        .expect(200);

      const metaRoot = path.join(aiWorkRoot, 'Meta分析');
      const autoRun = response.body.data.autoRun as Record<string, unknown>;
      const outputFiles = autoRun.outputFiles as Record<string, string>;
      expect(response.body.data.workspace.copyStoragePath.startsWith(metaRoot)).toBe(true);
      expect(response.body.data.workspace.excelJsonPath.startsWith(metaRoot)).toBe(true);
      expect(String(autoRun.outputDirectory).startsWith(metaRoot)).toBe(true);
      expect(fs.readFileSync(outputFiles.effectSizesCsv, 'utf-8')).toContain('outcome_id');
      expect(fs.readFileSync(outputFiles.rScript, 'utf-8')).toContain('metafor');
      expect(fs.readFileSync(outputFiles.reportMarkdown, 'utf-8')).toContain('Meta');
      expect(fs.existsSync(outputFiles.context)).toBe(true);
      const internalContextPointer = JSON.parse(fs.readFileSync(path.join(
        testDataDir,
        'uploads',
        'meta-workspace-storage-test',
        'meta-analysis',
        'runs',
        String(autoRun.analysisId),
        'writing-context.json',
      ), 'utf-8')) as Record<string, unknown>;
      expect(internalContextPointer.source).toBe('meta-analysis-writing-context-pointer');
      expect(internalContextPointer).not.toHaveProperty('effectRows');

      const resultContainerRunDir = path.join(
        testDataDir,
        'uploads',
        'meta-workspace-storage-test',
        'meta-analysis',
        'result-container',
        'runs',
        String(autoRun.analysisId),
      );
      const containerContext = JSON.parse(fs.readFileSync(
        path.join(resultContainerRunDir, 'writing-context.json'),
        'utf-8',
      )) as Record<string, unknown>;
      expect(containerContext.source).toBe('meta-analysis-writing-context');
      expect(containerContext.effectRows).toHaveLength(2);
      expect(fs.readFileSync(path.join(resultContainerRunDir, 'meta_effect_sizes.csv'), 'utf-8')).toContain('outcome_id');
      expect(fs.readFileSync(path.join(resultContainerRunDir, 'meta_analysis.R'), 'utf-8')).toContain('metafor');
      expect(fs.readFileSync(path.join(resultContainerRunDir, 'meta_analysis_report.md'), 'utf-8')).toContain('Meta');

      const contextResponse = await request(app)
        .get('/api/meta-analysis/writing-context')
        .query({ userId: 'meta-workspace-storage-test', analysisId: autoRun.analysisId })
        .expect(200);
      expect(contextResponse.body.data.outputDirectory).toBe(autoRun.outputDirectory);

      fs.rmSync(workspaceRoot, { recursive: true, force: true });
      const crossWorkspaceContext = await request(app)
        .get('/api/meta-analysis/writing-context')
        .query({
          userId: 'meta-workspace-storage-test',
          conversationId: 'different-home-conversation',
        })
        .expect(200);
      expect(crossWorkspaceContext.body.data.analysisId).toBe(autoRun.analysisId);
      expect(crossWorkspaceContext.body.data.effectRows).toHaveLength(2);

      const crossWorkspaceCsv = await request(app)
        .get('/api/meta-analysis/writing-context/effect-sizes.csv')
        .query({
          userId: 'meta-workspace-storage-test',
          conversationId: 'different-home-conversation',
        })
        .expect(200);
      expect(crossWorkspaceCsv.text).toContain('outcome_id');
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it('runs an arbitrary wide-format outcome instead of limiting auto-run to N2O/NO', async () => {
    const columns = [
      'Study#',
      'Biomass_tmean',
      'Biomass_tsd',
      'Biomass_tn',
      'Biomass_ckmean',
      'Biomass_cksd',
      'Biomass_ckn',
    ];
    const tables = [
      table('p1', columns, [
        { 'Study#': 'S1', Biomass_tmean: 12, Biomass_tsd: 2, Biomass_tn: 5, Biomass_ckmean: 10, Biomass_cksd: 1.8, Biomass_ckn: 5 },
        { 'Study#': 'S2', Biomass_tmean: 18, Biomass_tsd: 2.5, Biomass_tn: 6, Biomass_ckmean: 15, Biomass_cksd: 2.1, Biomass_ckn: 6 },
      ]),
      table('p2', columns, [
        { 'Study#': 'S3', Biomass_tmean: 9, Biomass_tsd: 1.2, Biomass_tn: 4, Biomass_ckmean: 8, Biomass_cksd: 1.1, Biomass_ckn: 4 },
      ]),
    ];
    const app = createTestApp(tables, async () => ({
      provider: 'test-ai',
      workflowStage: 'ready_for_analysis',
      assistantMessage: '已确认生物量分析配置。',
      operations: [],
      suggestedConfig: {
        model: 'random',
        method: 'REML',
        studyIdColumn: 'Study#',
        clusterBy: 'Study#',
        outcomes: [{
          id: 'biomass',
          label: '生物量',
          measure: 'lnRR',
          treatmentMean: 'Biomass_tmean',
          treatmentSd: 'Biomass_tsd',
          treatmentN: 'Biomass_tn',
          controlMean: 'Biomass_ckmean',
          controlSd: 'Biomass_cksd',
          controlN: 'Biomass_ckn',
        }],
      },
    }));

    const response = await request(app)
      .post('/api/meta-analysis/ai-plan')
      .send({
        userId: 'meta-generic-wide-test',
        conversationId: 'meta_ai_chat_generic_wide_123456',
        pdfIds: ['p1', 'p2'],
        query: '确认，可以开始分析',
      })
      .expect(200);

    expect(response.body.data.workflowStage).toBe('analysis_completed');
    expect(response.body.data.autoRun.effectRows).toHaveLength(3);
    expect(response.body.data.autoRun.effectRows.every((row: Record<string, unknown>) => row.outcome_label === '生物量')).toBe(true);
    expect(response.body.data.autoPreparedDataset.notes.join('\n')).toContain('任意因变量');
  });

  it('executes split and SE-to-SD operations before using AI-created columns', async () => {
    const columns = ['Study#', 'Treatment yield', 'Control yield', 'Treatment n', 'Control n'];
    const tables = [
      table('p1', columns, [
        { 'Study#': 'S1', 'Treatment yield': '10 ± 1', 'Control yield': '8 ± 0.8', 'Treatment n': 4, 'Control n': 4 },
        { 'Study#': 'S2', 'Treatment yield': '12 ± 1.2', 'Control yield': '9 ± 0.9', 'Treatment n': 5, 'Control n': 5 },
      ]),
      table('p2', columns, [
        { 'Study#': 'S3', 'Treatment yield': '15 ± 1.5', 'Control yield': '11 ± 1.1', 'Treatment n': 6, 'Control n': 6 },
      ]),
    ];
    const app = createTestApp(tables, async () => ({
      provider: 'test-ai',
      workflowStage: 'ready_for_analysis',
      assistantMessage: '已确认拆列和SE换算。',
      operations: [
        { id: 'split-t', type: 'split_mean_sd', title: '拆分处理组', rationale: '均值±SE', params: { sourceColumn: 'Treatment yield', meanColumn: 'yield_t_mean', spreadColumn: 'yield_t_se', spreadType: 'se' } },
        { id: 'split-c', type: 'split_mean_sd', title: '拆分对照组', rationale: '均值±SE', params: { sourceColumn: 'Control yield', meanColumn: 'yield_c_mean', spreadColumn: 'yield_c_se', spreadType: 'se' } },
        { id: 'sd-t', type: 'convert_se_to_sd', title: '处理组SE转SD', rationale: 'SD=SE*sqrt(n)', params: { seColumn: 'yield_t_se', nColumn: 'Treatment n', sdColumn: 'yield_t_sd' } },
        { id: 'sd-c', type: 'convert_se_to_sd', title: '对照组SE转SD', rationale: 'SD=SE*sqrt(n)', params: { seColumn: 'yield_c_se', nColumn: 'Control n', sdColumn: 'yield_c_sd' } },
      ],
      suggestedConfig: {
        model: 'random',
        method: 'REML',
        studyIdColumn: 'Study#',
        clusterBy: 'Study#',
        outcomes: [{
          id: 'yield',
          label: '产量',
          measure: 'SMD',
          treatmentMean: 'yield_t_mean',
          treatmentSd: 'yield_t_sd',
          treatmentN: 'Treatment n',
          controlMean: 'yield_c_mean',
          controlSd: 'yield_c_sd',
          controlN: 'Control n',
        }],
      },
    }));

    const response = await request(app)
      .post('/api/meta-analysis/ai-plan')
      .send({
        userId: 'meta-generic-operation-test',
        conversationId: 'meta_ai_chat_generic_operation_123456',
        pdfIds: ['p1', 'p2'],
        query: '接受这个整理方案并开始分析',
      })
      .expect(200);

    expect(response.body.data.autoRun.effectRows).toHaveLength(3);
    expect(response.body.data.autoRun.effectRows[0].treatment_mean).toBe(10);
    expect(response.body.data.autoRun.effectRows[0].treatment_sd).toBe(2);
    expect(response.body.data.autoPreparedDataset.notes.join('\n')).toContain('处理组SE转SD');
  });

  it('pairs arbitrary long-format treatment and control rows from the confirmed control rule', async () => {
    const columns = ['Study#', 'Group', 'Biomass', 'Crop'];
    const tables = [
      table('p1', columns, [
        { 'Study#': 'S1', Group: 'Control', Biomass: 10, Crop: 'Maize' },
        { 'Study#': 'S1', Group: 'Treatment', Biomass: 14, Crop: 'Maize' },
      ]),
      table('p2', columns, [
        { 'Study#': 'S2', Group: 'Control', Biomass: 8, Crop: 'Wheat' },
        { 'Study#': 'S2', Group: 'Treatment', Biomass: 9.6, Crop: 'Wheat' },
      ]),
    ];
    const app = createTestApp(tables, async () => ({
      provider: 'test-ai',
      workflowStage: 'ready_for_analysis',
      assistantMessage: '已确认长表处理/对照配对。',
      dataUnderstanding: {
        controlGroups: [{ column: 'Group', values: ['Control'] }],
        treatmentGroups: [{ column: 'Group', values: ['Treatment'] }],
      },
      operations: [],
      suggestedConfig: {
        model: 'random',
        method: 'REML',
        studyIdColumn: 'Study#',
        clusterBy: 'Study#',
        subgroupColumns: ['Crop'],
        controlRules: [{
          id: 'treatment-vs-control',
          label: 'Treatment vs Control',
          treatmentLabels: ['Treatment'],
          controlLabels: ['Control'],
          matchColumns: ['Study#'],
        }],
        outcomes: [{
          id: 'biomass-long',
          label: '长表生物量',
          measure: 'lnRR_mean_only',
          treatmentMean: 'Biomass',
          controlMean: 'Biomass',
        }],
      },
    }));

    const response = await request(app)
      .post('/api/meta-analysis/ai-plan')
      .send({
        userId: 'meta-generic-pairing-test',
        conversationId: 'meta_ai_chat_generic_pairing_123456',
        pdfIds: ['p1', 'p2'],
        query: '没问题，按这个对照规则运行',
      })
      .expect(200);

    expect(response.body.data.autoRun.effectRows).toHaveLength(2);
    expect(response.body.data.autoRun.effectRows.map((row: Record<string, unknown>) => row.treatment_mean)).toEqual([14, 9.6]);
    expect(response.body.data.autoRun.effectRows.map((row: Record<string, unknown>) => row.control_mean)).toEqual([10, 8]);
    expect(response.body.data.autoPreparedDataset.notes.join('\n')).toContain('通用处理/对照配对');
  });

  it('executes unit conversion and range grouping as real copy-workspace transformations', async () => {
    const columns = ['Study#', 'Treatment mass (mg)', 'Control mass (mg)', 'Duration (d)'];
    const tables = [
      table('p1', columns, [
        { 'Study#': 'S1', 'Treatment mass (mg)': 1200, 'Control mass (mg)': 1000, 'Duration (d)': 20 },
        { 'Study#': 'S2', 'Treatment mass (mg)': 1800, 'Control mass (mg)': 1500, 'Duration (d)': 60 },
      ]),
      table('p2', columns, [
        { 'Study#': 'S3', 'Treatment mass (mg)': 2200, 'Control mass (mg)': 2000, 'Duration (d)': 120 },
      ]),
    ];
    const app = createTestApp(tables, async () => ({
      provider: 'test-ai',
      workflowStage: 'ready_for_analysis',
      assistantMessage: '已确认单位换算和持续时间分组。',
      operations: [
        { id: 'unit-t', type: 'unit_convert', title: '处理组mg转g', rationale: '统一单位', params: { sourceColumn: 'Treatment mass (mg)', targetColumn: 'Treatment mass (g)', factor: 0.001 } },
        { id: 'unit-c', type: 'unit_convert', title: '对照组mg转g', rationale: '统一单位', params: { sourceColumn: 'Control mass (mg)', targetColumn: 'Control mass (g)', factor: 0.001 } },
        { id: 'duration-group', type: 'range_group', title: '持续时间分组', rationale: '用于亚组', params: { sourceColumn: 'Duration (d)', targetColumn: 'Duration group', spec: '0-30=短期;30-90=中期;>90=长期' } },
      ],
      suggestedConfig: {
        model: 'random',
        method: 'REML',
        studyIdColumn: 'Study#',
        clusterBy: 'Study#',
        subgroupColumns: ['Duration group'],
        outcomes: [{
          id: 'mass',
          label: '质量',
          measure: 'lnRR_mean_only',
          treatmentMean: 'Treatment mass (g)',
          controlMean: 'Control mass (g)',
        }],
      },
    }));

    const response = await request(app)
      .post('/api/meta-analysis/ai-plan')
      .send({
        userId: 'meta-generic-transform-test',
        conversationId: 'meta_ai_chat_generic_transform_123456',
        pdfIds: ['p1', 'p2'],
        query: '确认后运行',
      })
      .expect(200);

    expect(response.body.data.autoRun.effectRows).toHaveLength(3);
    expect(response.body.data.autoRun.effectRows[0].treatment_mean).toBe(1.2);
    expect(response.body.data.autoRun.effectRows.map((row: { moderators: Record<string, unknown> }) => row.moderators['Duration group'])).toEqual(['短期', '中期', '长期']);
  });
});
