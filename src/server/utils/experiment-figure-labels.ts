import type { ExperimentAnalysisResult } from '../services/experiment-analyzer';

interface ExperimentFigurePlanLike {
  figureName?: string;
  panelLabel?: string;
  caption?: string;
}

const FIGURE_ID_ONLY_RE = /^(?:fig(?:ure)?\.?|table|panel|subpanel|subplot|subfigure|supplementary(?:\s+figure)?|supplement|图|表)\s*[-_a-z0-9().\s]+$/i;
const FIGURE_LABEL_MISMATCH_PATTERNS = [
  /用户(?:指定|要求|提供|分组|标注).{0,40}(?:figure|panel|图|小图|子图).{0,80}(?:图内|图片|截图|右上角|可见).{0,80}(?:标记|标签|label|marker).{0,40}(?:不一致|冲突|差异)?/i,
  /图内(?:右上角)?可见.*(?:子图标记|面板标记|panel label|visible label|标签).*(?:不一致|冲突|差异)?/i,
  /右上角可见.*(?:子图标记|面板标记|panel label|标签)/i,
  /用户提供的小图标签.*图内可见/i,
  /图内小图标签显示为/i,
  /Figure 编号与.*面板标记.*(?:差异|不一致|冲突)/i,
  /visible panel label/i,
  /panel label visible in the image/i,
  /user (?:supplied|grouped|identified|provided|requested).{0,80}(?:panel|figure).{0,120}(?:visible|image).{0,80}(?:label|marker)/i,
  /panel marker/i,
];

function splitExperimentFragments(value: unknown): string[] {
  return String(value || '')
    .split(/[；;]+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function isFigureLabelMismatchFragment(fragment: string): boolean {
  return FIGURE_LABEL_MISMATCH_PATTERNS.some(pattern => pattern.test(fragment));
}

export function normalizeExperimentPanelLabel(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';

  const cleaned = text
    .replace(/^(?:panel|subpanel|subplot|subfigure|panel label)\s*/i, '')
    .trim();

  const parenthesized = cleaned.match(/\(([a-z0-9]+)\)\s*$/i);
  if (parenthesized?.[1]) return parenthesized[1].toLowerCase();

  const tailToken = cleaned.match(/([a-z0-9]+)\s*$/i);
  return tailToken?.[1]?.toLowerCase() || cleaned.toLowerCase();
}

export function extractExperimentPanelLabelFromFigureId(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';

  const parenthesized = text.match(/\(([a-z0-9]+)\)\s*$/i);
  if (parenthesized?.[1]) return parenthesized[1].toLowerCase();

  const figureSuffix = text.match(/(?:figure|fig\.?|table|图|表)\s*[-_ ]*\d+\s*([a-z0-9])$/i);
  if (figureSuffix?.[1]) return figureSuffix[1].toLowerCase();

  const panelSuffix = text.match(/(?:panel|subpanel|subplot|subfigure)\s*[-_ ]*\(?([a-z0-9]+)\)?$/i);
  if (panelSuffix?.[1]) return panelSuffix[1].toLowerCase();

  return '';
}

export function figureNameAlreadyIncludesPanelLabel(figureName: string, panelLabel: string): boolean {
  const name = String(figureName || '').trim();
  const panel = normalizeExperimentPanelLabel(panelLabel);
  if (!name || !panel) return false;

  const escapedPanel = panel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?:\\(${escapedPanel}\\)|[-_\\s]?${escapedPanel})$`, 'i').test(name);
}

export function formatExperimentFigureLabel(figureName: string, panelLabel: string): string {
  const name = String(figureName || '').trim();
  const panel = normalizeExperimentPanelLabel(panelLabel);

  if (!name) return panel ? `Figure (${panel})` : '';
  if (!panel || figureNameAlreadyIncludesPanelLabel(name, panel)) return name;
  return `${name}(${panel})`;
}

export function sanitizeExperimentLocationText(value: unknown, canonicalLabel = ''): string {
  const fragments = splitExperimentFragments(value);
  if (fragments.length === 0) return '';

  const normalizedCanonical = String(canonicalLabel || '').trim().toLowerCase();
  const cleaned = fragments.filter(fragment => {
    if (isFigureLabelMismatchFragment(fragment)) return false;
    const lowered = fragment.toLowerCase();
    if (normalizedCanonical && lowered === normalizedCanonical) return false;
    if (FIGURE_ID_ONLY_RE.test(fragment)) return false;
    return true;
  });

  return cleaned.join('；');
}

export function sanitizeExperimentUncertaintyText(value: unknown): string {
  const text = String(value || '').trim();
  if (!text) return '';

  const fragments = splitExperimentFragments(text);
  if (fragments.length === 0) return '';

  const cleaned = fragments.filter(fragment => !isFigureLabelMismatchFragment(fragment));
  if (cleaned.length === 0) return '';
  return cleaned.join('；');
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const text = String(value || '').trim();
    if (!text) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }

  return output;
}

export function normalizeExperimentAnalysisResultFigureLabels(
  result: ExperimentAnalysisResult
): ExperimentAnalysisResult {
  const plan = result.figurePlan as ExperimentFigurePlanLike | undefined;
  if (!plan) return result;

  const normalizedPlan = {
    ...plan,
    figureName: String(plan.figureName || '').trim(),
    panelLabel: normalizeExperimentPanelLabel(plan.panelLabel),
  };
  const canonicalLabel = formatExperimentFigureLabel(
    normalizedPlan.figureName || '',
    normalizedPlan.panelLabel || ''
  );

  const normalizedResults = (result.results || []).map(record => ({
    ...record,
    table_or_figure_id: canonicalLabel || String(record.table_or_figure_id || '').trim(),
    page_or_location: sanitizeExperimentLocationText(record.page_or_location, canonicalLabel),
    uncertainty_note: sanitizeExperimentUncertaintyText(record.uncertainty_note),
  }));

  const normalizedOverallSummary = {
    ...result.overall_summary,
    uncertain_items: dedupeStrings(
      (result.overall_summary?.uncertain_items || [])
        .map(item => sanitizeExperimentUncertaintyText(item))
        .filter(Boolean)
    ),
  };

  return {
    ...result,
    figurePlan: normalizedPlan,
    results: normalizedResults,
    overall_summary: normalizedOverallSummary,
  };
}
