import { describe, expect, it } from 'vitest';

import {
  extractExperimentPanelLabelFromFigureId,
  formatExperimentFigureLabel,
  normalizeExperimentAnalysisResultFigureLabels,
} from '../../src/server/utils/experiment-figure-labels';
import type { ExperimentAnalysisResult } from '../../src/server/services/experiment-analyzer';

describe('experiment figure label normalization', () => {
  it('formats canonical figure labels without duplicating panel suffixes', () => {
    expect(formatExperimentFigureLabel('Figure 2', 'b')).toBe('Figure 2(b)');
    expect(formatExperimentFigureLabel('Figure 2(b)', 'b')).toBe('Figure 2(b)');
  });

  it('extracts panel labels from common figure id styles', () => {
    expect(extractExperimentPanelLabelFromFigureId('Figure 4(h)')).toBe('h');
    expect(extractExperimentPanelLabelFromFigureId('Figure 4h')).toBe('h');
    expect(extractExperimentPanelLabelFromFigureId('panel (c)')).toBe('c');
  });

  it('prefers the user-planned figure label and removes mismatch-only noise', () => {
    const result: ExperimentAnalysisResult = {
      fileName: 'NOflux_24_SpringMaize.png',
      fileType: 'image',
      paper_title: '',
      figurePlan: {
        figureName: 'Figure 2',
        panelLabel: 'b',
        caption: '2024年春玉米 NO 排放通量',
      },
      results: [
        {
          table_or_figure_id: 'Figure 2(c)',
          metric_name: 'NO fluxes',
          page_or_location: 'Figure 2(c)；上传图片；右上角可见子图标记“(c)”',
          uncertainty_note: '用户指定 Figure 2(b)，但图内可见子图标记为(c)。',
        },
      ],
      overall_summary: {
        main_findings: [],
        best_model_claims: [],
        ablation_findings: [],
        robustness_findings: [],
        efficiency_findings: [],
        uncertain_items: [
          '用户指定 Figure 2(b)，但图内可见子图标记为(c)。',
          '图中未给出明确数值',
        ],
      },
    };

    const normalized = normalizeExperimentAnalysisResultFigureLabels(result);

    expect(normalized.figurePlan?.panelLabel).toBe('b');
    expect(normalized.results[0].table_or_figure_id).toBe('Figure 2(b)');
    expect(normalized.results[0].page_or_location).toBe('上传图片');
    expect(normalized.results[0].uncertainty_note).toBe('');
    expect(normalized.overall_summary.uncertain_items).toEqual(['图中未给出明确数值']);
  });
});
