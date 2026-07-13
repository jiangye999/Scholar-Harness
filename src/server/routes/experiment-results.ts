/**
 * 实验结果上传和分析路由
 * 
 * 功能：
 * 1. 支持上传图片、表格、PDF、Word、截图等实验结果文件
 * 2. 按用户配置选择分析引擎：仅在启用 Codex CLI 优先时尝试 Codex，否则直接使用小牛马/大牛马 API
 * 3. 返回 JSON 格式的实验结果数据
 */

import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { logger } from '../../utils/logger';
import { getUserUploadDir, getMemoryDir, getDataDir } from '../../utils/paths';
import { extractPdfTextWithFastText } from '../../utils/pdf-fast-text';
import {
  extractExperimentPanelLabelFromFigureId,
  formatExperimentFigureLabel,
  normalizeExperimentAnalysisResultFigureLabels,
  normalizeExperimentPanelLabel,
} from '../utils/experiment-figure-labels';
import {
  analyzeExperimentResults,
  analyzeExperimentResultsWithCodex,
  type ExperimentAnalysisInput,
  type ExperimentAnalysisResult
} from '../services/experiment-analyzer';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import { decrypt, isEncrypted } from '../../utils/encryption';
import { resolveUserId } from '../auth-guard-singleton';
import { 
  loadUserMemory, 
  saveUserMemory, 
  saveMemoryToFiles, 
  isKeyDeleted,
  autoRestoreDeletedKeyIfEmpty,
  type MemoryEntry 
} from './memory';

const router = Router();
const MIN_FREE_UPLOAD_BYTES = 512 * 1024 * 1024;

interface AgentApiRuntimeConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  visionModel?: string;
}

interface ExperimentFigurePlan {
  originalFileName?: string;
  figureName?: string;
  panelLabel?: string;
  title?: string;
  caption?: string;
}

function readUploadText(value: unknown, maxLength = 12000): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return String(raw || '').trim().slice(0, maxLength);
}

function readExperimentFigurePlan(value: unknown): ExperimentFigurePlan | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const plan: ExperimentFigurePlan = {
      originalFileName: readUploadText((parsed as Record<string, unknown>).originalFileName, 300),
      figureName: readUploadText((parsed as Record<string, unknown>).figureName, 120),
      panelLabel: readUploadText((parsed as Record<string, unknown>).panelLabel, 40),
      title: readUploadText((parsed as Record<string, unknown>).title, 500),
      caption: readUploadText((parsed as Record<string, unknown>).caption, 1200),
    };
    return Object.values(plan).some(Boolean) ? plan : undefined;
  } catch {
    return undefined;
  }
}

function buildFigurePlanInstruction(plan?: ExperimentFigurePlan): string {
  if (!plan) return '';
  const lines = [
    plan.figureName ? `- Figure 分组/图片名称：${plan.figureName}` : '',
    plan.panelLabel ? `- 小图标签：${plan.panelLabel}` : '',
    plan.title ? `- 用户填写的图片标题：${plan.title}` : '',
    plan.caption ? `- 用户填写的图注/注释：${plan.caption}` : '',
  ].filter(Boolean);
  if (lines.length === 0) return '';
  return `用户对这张图片的组织规划如下，请按该规划抽取和组织结果，不要把同一 Figure 下的小图拆散为无关图片：
${lines.join('\n')}
- 上述 figureName + panelLabel 是本次归档的规范编号。输出 JSON 时，table_or_figure_id 必须优先使用这个编号。
- 如果截图右上角残留了别的 (a)/(b)/(c) 子图字母，默认视为裁剪残留或原图内部标记，不要把它改写成新的主编号。
- 除非残留标签直接影响内容识别，否则不要把“用户编号和图内子图字母不一致”反复写进 uncertainty_note 或 overall_summary.uncertain_items。`;
}

function mergeInstructionWithFigurePlan(userInstruction: string, plan?: ExperimentFigurePlan): string {
  const figurePlanInstruction = buildFigurePlanInstruction(plan);
  return [userInstruction, figurePlanInstruction].filter(Boolean).join('\n\n');
}

function detectExperimentFileType(fileName: string): 'image' | 'pdf' | 'word' | 'table' | 'text' | 'unknown' {
  const ext = path.extname(fileName).toLowerCase();
  if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif', '.heic', '.heif', '.svg'].includes(ext)) {
    return 'image';
  }
  if (ext === '.pdf') return 'pdf';
  if (['.doc', '.docx'].includes(ext)) return 'word';
  if (['.xlsx', '.xls', '.csv'].includes(ext)) return 'table';
  if (['.txt', '.md'].includes(ext)) return 'text';
  return 'unknown';
}

function isNoSpaceError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOSPC';
}

async function getFreeDiskBytes(targetPath: string): Promise<number | null> {
  let current = targetPath;
  while (current && current !== path.dirname(current)) {
    try {
      const stats = await fs.statfs(current);
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      current = path.dirname(current);
    }
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '未知';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function decryptConfigSecret(value?: string): string {
  if (!value) return '';
  try {
    return isEncrypted(value) ? decrypt(value) : value;
  } catch (error) {
    logger.warn('[ExperimentResults] Failed to decrypt saved API key, using raw value');
    return value;
  }
}

function readChatBridgeAgentConfigs(): { primary: AgentApiRuntimeConfig; secondary: AgentApiRuntimeConfig; secondaryVision: AgentApiRuntimeConfig } {
  const defaults = {
    primary: {
      apiUrl: process.env.PRIMARY_API_URL || process.env.API_URL || '',
      apiKey: process.env.PRIMARY_API_KEY || process.env.API_KEY || '',
      model: process.env.PRIMARY_MODEL || 'claude-sonnet-4-5',
      visionModel: process.env.PRIMARY_VISION_MODEL || process.env.PRIMARY_MODEL || 'claude-sonnet-4-5',
    },
    secondary: {
      apiUrl: process.env.SECONDARY_API_URL || process.env.API_URL || '',
      apiKey: process.env.SECONDARY_API_KEY || process.env.API_KEY || '',
      model: process.env.SECONDARY_MODEL || 'gpt-4o',
      visionModel: process.env.SECONDARY_VISION_MODEL || process.env.SECONDARY_MODEL || 'gpt-4o',
    },
    secondaryVision: {
      apiUrl: process.env.SECONDARY_VISION_API_URL || '',
      apiKey: process.env.SECONDARY_VISION_API_KEY || '',
      model: process.env.SECONDARY_VISION_MODEL || 'gpt-4o',
      visionModel: process.env.SECONDARY_VISION_MODEL || 'gpt-4o',
    },
  };

  try {
    const configPath = path.join(getDataDir(), 'chat-bridge-config.json');
    const parsed = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'));
    return {
      primary: {
        apiUrl: String(parsed.primary?.api_url || defaults.primary.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: decryptConfigSecret(parsed.primary?.api_key) || defaults.primary.apiKey,
        model: String(parsed.primary?.model || defaults.primary.model || 'claude-sonnet-4-5'),
        visionModel: String(parsed.primary?.vision_model || parsed.primary?.model || defaults.primary.visionModel || defaults.primary.model || 'claude-sonnet-4-5'),
      },
      secondary: {
        apiUrl: String(parsed.secondary?.api_url || defaults.secondary.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: decryptConfigSecret(parsed.secondary?.api_key) || defaults.secondary.apiKey,
        model: String(parsed.secondary?.model || defaults.secondary.model || 'gpt-4o'),
        visionModel: String(parsed.secondary?.vision_model || parsed.secondary?.model || defaults.secondary.visionModel || defaults.secondary.model || 'gpt-4o'),
      },
      secondaryVision: {
        apiUrl: String(parsed.secondary_vision?.api_url || defaults.secondaryVision.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: decryptConfigSecret(parsed.secondary_vision?.api_key) || defaults.secondaryVision.apiKey,
        model: String(parsed.secondary_vision?.model || defaults.secondaryVision.model || 'gpt-4o'),
        visionModel: String(parsed.secondary_vision?.model || defaults.secondaryVision.visionModel || 'gpt-4o'),
      },
    };
  } catch {
    return defaults;
  }
}

function readChatBridgeCodexPreference(): { enabled: boolean; prefer: boolean } {
  try {
    const configPath = path.join(getDataDir(), 'chat-bridge-config.json');
    const parsed = JSON.parse(fsSync.readFileSync(configPath, 'utf-8'));
    const codex = parsed.codex || {};
    return {
      enabled: codex.enabled !== false && codex.prefer === true,
      prefer: codex.prefer === true,
    };
  } catch {
    return { enabled: false, prefer: false };
  }
}

function isUsableCodexAnalysisResult(result: ExperimentAnalysisResult): boolean {
  if (result.error) return false;
  if ((result.results?.length || 0) > 0) return true;
  const uncertainText = (result.overall_summary?.uncertain_items || []).join('\n');
  return !/(无法读取|无法处理|不可用|需要.*降级|需要.*API|请.*降级|cannot read|unavailable|fallback)/i.test(uncertainText);
}

function isImageExperimentFile(fileType: ExperimentAnalysisInput['fileType']): boolean {
  return fileType === 'image';
}

function modelForExperimentFile(provider: AgentApiRuntimeConfig, fileType: ExperimentAnalysisInput['fileType']): string {
  return isImageExperimentFile(fileType)
    ? (provider.visionModel || provider.model)
    : provider.model;
}

function buildMaterialPassport(input: {
  fileName: string;
  fileType: ExperimentAnalysisInput['fileType'];
  savedPath?: string;
  result: ExperimentAnalysisResult;
  extractionSource?: string;
  providers: { primary: AgentApiRuntimeConfig; secondary: AgentApiRuntimeConfig; secondaryVision?: AgentApiRuntimeConfig };
}): ExperimentAnalysisResult['materialPassport'] {
  const uncertainItems = input.result.overall_summary?.uncertain_items || [];
  const resultConfidences = (input.result.results || [])
    .map(item => item.confidence)
    .filter((value): value is 'high' | 'medium' | 'low' => value === 'high' || value === 'medium' || value === 'low');
  const hasLowConfidence = resultConfidences.includes('low') || uncertainItems.length > 0 || !!input.result.error;
  const hasHighConfidence = resultConfidences.length > 0 && resultConfidences.every(value => value === 'high');
  const confidence: 'high' | 'medium' | 'low' = hasLowConfidence ? 'low' : (hasHighConfidence ? 'high' : 'medium');
  const provider = input.result.analysisProvider || '';
  const visionModel = input.fileType === 'image'
    ? (provider.startsWith('secondary-vision:')
        ? input.providers.secondaryVision?.model
        : provider.startsWith('secondary:')
        ? input.providers.secondary.visionModel
        : provider.startsWith('primary:')
          ? input.providers.primary.visionModel
          : input.providers.secondaryVision?.model || input.providers.secondary.visionModel || input.providers.primary.visionModel)
    : undefined;
  const hasResults = (input.result.results?.length || 0) > 0;
  const linkedChapters = hasResults ? ['Results', 'Discussion'] : [];

  return {
    fileName: input.fileName,
    fileType: input.fileType,
    source: 'homepage-experiment-upload',
    savedPath: input.savedPath,
    analysisProvider: input.result.analysisProvider,
    visionModel,
    extractionSource: input.extractionSource,
    confidence,
    uncertainItems,
    includeInWriting: hasResults && !input.result.error,
    linkedChapters,
    createdAt: new Date().toISOString(),
  };
}

function hasMemoryWorthyExperimentResult(result: ExperimentAnalysisResult): boolean {
  if ((result.results?.length || 0) > 0) return true;
  const summary = result.overall_summary;
  if (!summary) return false;
  return [
    summary.main_findings,
    summary.best_model_claims,
    summary.ablation_findings,
    summary.robustness_findings,
    summary.efficiency_findings,
  ].some(items => Array.isArray(items) && items.some(item => String(item || '').trim()));
}

function stringifyExperimentMemoryValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map(item => stringifyExperimentMemoryValue(item))
      .filter(Boolean)
      .join('；');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function joinExperimentMemoryValues(values: unknown[], separator = '；'): string {
  return values
    .map(value => stringifyExperimentMemoryValue(value))
    .filter(Boolean)
    .join(separator);
}

function formatExperimentRecordForMemory(
  record: ExperimentAnalysisResult['results'][number],
  index: number
): string | null {
  const lines: string[] = [];
  const heading = joinExperimentMemoryValues([
    record.table_or_figure_id,
    record.result_type,
    record.task,
    record.metric_name,
  ], ' / ');

  lines.push(`  记录${index + 1}${heading ? `（${heading}）` : ''}`);

  const pushLine = (label: string, value: unknown): void => {
    const text = stringifyExperimentMemoryValue(value);
    if (text) {
      lines.push(`    - ${label}: ${text}`);
    }
  };

  const metricName = stringifyExperimentMemoryValue(record.metric_name);
  const metricValue = stringifyExperimentMemoryValue(record.metric_value);
  const unit = stringifyExperimentMemoryValue(record.unit);
  const metricText = metricValue
    ? `${metricName || '指标值'}: ${metricValue}${unit}`
    : metricName;

  pushLine('图表/位置', joinExperimentMemoryValues([record.table_or_figure_id, record.page_or_location], '；'));
  pushLine('任务/数据', joinExperimentMemoryValues([record.task, record.dataset, record.split_or_setting], '；'));
  pushLine('处理/模型', joinExperimentMemoryValues([record.model_name, record.baseline_or_proposed], '；'));
  pushLine('指标', metricText);
  pushLine('比较对象', record.compared_to);
  pushLine('变化/提升', joinExperimentMemoryValues([record.improvement_value, record.significance], '；'));
  if (record.higher_is_better !== undefined && record.higher_is_better !== null) {
    pushLine('指标方向', record.higher_is_better ? '越高越好' : '越低越好');
  }
  pushLine('图注/说明', record.caption);
  pushLine('证据原文', record.evidence_text);
  pushLine('可信度', record.confidence);
  pushLine('不确定性', record.uncertainty_note);

  return lines.length > 1 ? lines.join('\n') : null;
}

function getFigureSortValue(name: string): number {
  const text = String(name || '').trim();
  const supplementary = /(?:supplement|supplementary|fig\.\s*s|figure\s*s|图\s*s|补充)/i.test(text);
  const match = text.match(/(?:figure|fig\.?|图|s)\s*[-_ ]*(\d+)/i) || text.match(/(\d+)/);
  if (!match) return Number.MAX_SAFE_INTEGER;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return Number.MAX_SAFE_INTEGER;
  return supplementary ? 10000 + value : value;
}

function comparePanelLabel(a: string, b: string): number {
  const left = String(a || '').trim().toLowerCase();
  const right = String(b || '').trim().toLowerCase();
  if (!left && right) return 1;
  if (left && !right) return -1;
  return left.localeCompare(right, 'zh-CN', { numeric: true });
}

function getResultFigureGroupName(result: ExperimentAnalysisResult): string {
  const planned = result.figurePlan?.figureName?.trim();
  if (planned) return planned;

  for (const record of result.results || []) {
    const figureId = stringifyExperimentMemoryValue(record.table_or_figure_id);
    if (figureId) return figureId;
  }

  if (result.fileType === 'image') return '未分组图件';
  return '非图件材料';
}

function getResultPanelLabel(result: ExperimentAnalysisResult): string {
  const planned = normalizeExperimentPanelLabel(result.figurePlan?.panelLabel || '');
  if (planned) return planned;

  for (const record of result.results || []) {
    const figureId = stringifyExperimentMemoryValue(record.table_or_figure_id);
    const panelLabel = extractExperimentPanelLabelFromFigureId(figureId);
    if (panelLabel) return panelLabel;
  }

  return '';
}

function formatResultSummaryItems(result: ExperimentAnalysisResult): string[] {
  const summary = result.overall_summary;
  if (!summary) return [];
  const items = [
    ...(summary.main_findings || []),
    ...(summary.best_model_claims || []),
    ...(summary.ablation_findings || []),
    ...(summary.robustness_findings || []),
    ...(summary.efficiency_findings || []),
  ];
  const seen = new Set<string>();
  return items
    .map(item => stringifyExperimentMemoryValue(item))
    .filter(item => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function uniqueExperimentMemoryValues(values: unknown[], limit = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const text = stringifyExperimentMemoryValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
}

function formatRecordMetricLine(record: ExperimentAnalysisResult['results'][number], index: number): string {
  const setting = joinExperimentMemoryValues([record.dataset, record.split_or_setting], '；');
  const group = joinExperimentMemoryValues([record.model_name, record.baseline_or_proposed], '；');
  const metricName = stringifyExperimentMemoryValue(record.metric_name);
  const metricValue = stringifyExperimentMemoryValue(record.metric_value);
  const unit = stringifyExperimentMemoryValue(record.unit);
  const comparison = joinExperimentMemoryValues([record.compared_to, record.improvement_value], '；');
  const significance = stringifyExperimentMemoryValue(record.significance);
  const resultType = stringifyExperimentMemoryValue(record.result_type);
  const location = joinExperimentMemoryValues([record.table_or_figure_id, record.page_or_location], '；');
  const evidence = stringifyExperimentMemoryValue(record.evidence_text || record.caption);
  const uncertainty = stringifyExperimentMemoryValue(record.uncertainty_note);

  const parts = [
    setting ? `设置=${setting}` : '',
    group ? `处理/组别=${group}` : '',
    metricName || metricValue ? `指标=${metricName || '未命名指标'}${metricValue ? `，值=${metricValue}${unit}` : ''}` : '',
    comparison ? `比较=${comparison}` : '',
    significance ? `显著性=${significance}` : '',
    resultType ? `类型=${resultType}` : '',
    location ? `位置=${location}` : '',
    evidence ? `证据=${evidence}` : '',
    uncertainty ? `不确定=${uncertainty}` : '',
  ].filter(Boolean);

  return `  - 记录${index + 1}：${parts.length ? parts.join('；') : stringifyExperimentMemoryValue(record)}`;
}

function formatStructuredImageDataSummary(
  result: ExperimentAnalysisResult,
  figureLabel: string
): string[] {
  const records = result.results || [];
  const summaryItems = formatResultSummaryItems(result);
  const figureIds = uniqueExperimentMemoryValues(records.map(record => record.table_or_figure_id), 8);
  const locations = uniqueExperimentMemoryValues(records.map(record => record.page_or_location), 8);
  const dataObjects = uniqueExperimentMemoryValues(records.flatMap(record => [record.task, record.dataset, record.split_or_setting]), 12);
  const groups = uniqueExperimentMemoryValues(records.flatMap(record => [record.model_name, record.baseline_or_proposed, record.compared_to]), 12);
  const metrics = uniqueExperimentMemoryValues(records.map(record => {
    const metricName = stringifyExperimentMemoryValue(record.metric_name);
    const unit = stringifyExperimentMemoryValue(record.unit);
    return metricName ? `${metricName}${unit ? ` (${unit})` : ''}` : '';
  }), 12);
  const captions = uniqueExperimentMemoryValues([
    result.figurePlan?.caption,
    ...records.map(record => record.caption),
  ], 3);
  const evidenceSnippets = uniqueExperimentMemoryValues(records.map(record => record.evidence_text), 5);
  const confidenceValues = uniqueExperimentMemoryValues(records.map(record => record.confidence), 5);
  const uncertainItems = uniqueExperimentMemoryValues([
    ...(result.overall_summary?.uncertain_items || []),
    ...records.map(record => record.uncertainty_note),
  ], 8);

  const lines: string[] = ['- 结构化数据总结：'];
  lines.push(`  - 图件编号：${figureLabel}`);
  lines.push(`  - 文件：${result.fileName}`);
  if (captions.length > 0) lines.push(`  - 图注/用户注释：${captions.join('；')}`);
  if (figureIds.length > 0 || locations.length > 0) {
    lines.push(`  - 图内定位：${[figureIds.join('；'), locations.join('；')].filter(Boolean).join('；')}`);
  }
  lines.push(`  - 数据对象/实验设置：${dataObjects.length ? dataObjects.join('；') : '未从图片中明确识别'}`);
  lines.push(`  - 处理/组别/比较对象：${groups.length ? groups.join('；') : '未从图片中明确识别'}`);
  lines.push(`  - 指标与单位：${metrics.length ? metrics.join('；') : '未从图片中明确识别'}`);

  if (records.length > 0) {
    lines.push('  - 结构化数据记录：');
    records.slice(0, 20).forEach((record, index) => {
      lines.push(formatRecordMetricLine(record, index));
    });
    if (records.length > 20) {
      lines.push(`  - 其余 ${records.length - 20} 条结构化记录未在摘要中展开。`);
    }
  } else if (result.error) {
    lines.push(`  - 结构化数据记录：未提取成功，错误=${result.error}`);
  } else {
    lines.push('  - 结构化数据记录：未从图片中提取到可确认的结构化记录');
  }

  if (summaryItems.length > 0) {
    lines.push('  - 数据趋势/比较结论：');
    summaryItems.slice(0, 10).forEach(item => lines.push(`    - ${item}`));
  }
  if (evidenceSnippets.length > 0) {
    lines.push('  - 证据片段：');
    evidenceSnippets.forEach(item => lines.push(`    - ${item}`));
  }
  if (confidenceValues.length > 0 || uncertainItems.length > 0) {
    lines.push(`  - 置信度/不确定性：${[
      confidenceValues.length ? `置信度=${confidenceValues.join('；')}` : '',
      uncertainItems.length ? `不确定项=${uncertainItems.join('；')}` : '',
    ].filter(Boolean).join('；')}`);
  }

  return lines;
}

function buildFigureGroupedDataSummary(results: ExperimentAnalysisResult[], userInstruction: string): string {
  const groups = new Map<string, ExperimentAnalysisResult[]>();

  for (const rawResult of results) {
    const result = normalizeExperimentAnalysisResultFigureLabels(rawResult);
    const groupName = getResultFigureGroupName(result);
    const group = groups.get(groupName) || [];
    group.push(result);
    groups.set(groupName, group);
  }

  if (groups.size === 0) return '';

  const lines: string[] = [
    `【按图件编号整理的结构化数据总结】${new Date().toISOString()}`,
  ];
  if (userInstruction) {
    lines.push('', `用户随文件提交的要求：${userInstruction}`);
  }

  const sortedGroups = Array.from(groups.entries()).sort(([a], [b]) => {
    const sortA = getFigureSortValue(a);
    const sortB = getFigureSortValue(b);
    if (sortA !== sortB) return sortA - sortB;
    return a.localeCompare(b, 'zh-CN', { numeric: true });
  });

  for (const [groupName, groupResults] of sortedGroups) {
    lines.push('', `### ${groupName}`);
    const sortedResults = groupResults.slice().sort((a, b) => {
      const panelCompare = comparePanelLabel(getResultPanelLabel(a), getResultPanelLabel(b));
      if (panelCompare !== 0) return panelCompare;
      return String(a.fileName || '').localeCompare(String(b.fileName || ''), 'zh-CN', { numeric: true });
    });

    for (const result of sortedResults) {
      const panelLabel = getResultPanelLabel(result);
      const figureLabel = formatExperimentFigureLabel(groupName, panelLabel);
      lines.push('', `#### ${figureLabel}`);
      if (result.savedPath) {
        lines.push(`- 本地保存路径：${result.savedPath}`);
      }
      if (result.analysisProvider) {
        lines.push(`- 分析引擎：${result.analysisProvider}`);
      }

      if (result.error) {
        lines.push(`- 分析状态：失败 - ${result.error}`);
      } else {
        lines.push(`- 分析状态：已提取 ${(result.results || []).length} 条结构化结果`);
      }

      if (result.paper_title) {
        lines.push(`- 论文/来源标题：${result.paper_title}`);
      }
      lines.push(...formatStructuredImageDataSummary(result, figureLabel));
    }
  }

  return lines.join('\n');
}

async function analyzeExperimentResultsWithDefaultFallback(input: ExperimentAnalysisInput, providers: {
  primary: AgentApiRuntimeConfig;
  secondary: AgentApiRuntimeConfig;
  secondaryVision?: AgentApiRuntimeConfig;
}): Promise<ExperimentAnalysisResult> {
  const attempts: string[] = [];
  const codexPreference = readChatBridgeCodexPreference();

  if (codexPreference.enabled && codexPreference.prefer) {
    const codexStatus = await chatBridge.getCodexCliStatus().catch(error => ({
      available: false,
      path: '',
      error: (error as Error).message,
    }));

    if (codexStatus.available) {
      const codexResult = await analyzeExperimentResultsWithCodex(input);
      if (isUsableCodexAnalysisResult(codexResult)) {
        return { ...codexResult, fallbackAttempts: attempts };
      }
      attempts.push(`Codex CLI: ${codexResult.error || '未得到可用分析结果'}`);
    } else {
      attempts.push(`Codex CLI: ${codexStatus.error || '不可用'}`);
    }
  } else {
    attempts.push('Codex CLI: 已按配置关闭');
  }

  if (input.fileType === 'image' && providers.secondaryVision?.apiUrl && providers.secondaryVision.apiKey) {
    const model = providers.secondaryVision.model || providers.secondaryVision.visionModel || 'gpt-4o';
    const secondaryVisionResult = await analyzeExperimentResults({
      ...input,
      apiUrl: providers.secondaryVision.apiUrl,
      apiKey: providers.secondaryVision.apiKey,
      model,
    });
    if (!secondaryVisionResult.error) {
      return { ...secondaryVisionResult, analysisProvider: `secondary-vision:${model}`, fallbackAttempts: attempts };
    }
    attempts.push(`小牛马视觉 API: ${secondaryVisionResult.error}`);
  } else if (input.fileType === 'image') {
    attempts.push('小牛马视觉 API: 未配置');
  }

  if (providers.secondary.apiUrl && providers.secondary.apiKey) {
    const model = modelForExperimentFile(providers.secondary, input.fileType);
    const secondaryResult = await analyzeExperimentResults({
      ...input,
      apiUrl: providers.secondary.apiUrl,
      apiKey: providers.secondary.apiKey,
      model,
    });
    if (!secondaryResult.error) {
      return { ...secondaryResult, analysisProvider: `secondary:${model}`, fallbackAttempts: attempts };
    }
    attempts.push(`小牛马 API: ${secondaryResult.error}`);
  } else {
    attempts.push('小牛马 API: 未配置');
  }

  if (providers.primary.apiUrl && providers.primary.apiKey) {
    const model = modelForExperimentFile(providers.primary, input.fileType);
    const primaryResult = await analyzeExperimentResults({
      ...input,
      apiUrl: providers.primary.apiUrl,
      apiKey: providers.primary.apiKey,
      model,
    });
    if (!primaryResult.error) {
      return { ...primaryResult, analysisProvider: `primary:${model}`, fallbackAttempts: attempts };
    }
    attempts.push(`大牛马 API: ${primaryResult.error}`);
  } else {
    attempts.push('大牛马 API: 未配置');
  }

  return {
    fileName: input.fileName,
    fileType: input.fileType,
    paper_title: '',
    results: [],
    overall_summary: {
      main_findings: [],
      best_model_claims: [],
      ablation_findings: [],
      robustness_findings: [],
      efficiency_findings: [],
      uncertain_items: attempts,
    },
    fallbackAttempts: attempts,
    error: '当前配置下可用的实验资料分析引擎均不可用或调用失败',
  };
}

// 配置 multer 存储 - 内存存储，适合处理图片和文档
const storage = multer.memoryStorage();

// 文件过滤器 - 支持图片、PDF、Word
const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = [
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp',  // 图片
    '.pdf',                                             // PDF
    '.doc', '.docx',                                    // Word
    '.xlsx', '.xls',                                    // Excel (表格)
    '.csv',                                             // CSV
    '.tiff', '.tif',                                    // TIFF 图片
    '.heic', '.heif',                                   // Apple 图片格式
    '.svg',                                             // SVG
    '.txt',                                             // 文本
    '.md',                                              // Markdown
  ];
  
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`不支持的文件类型: ${ext}。支持的格式: 图片(png/jpg/gif/bmp/webp/tiff), PDF, Word(doc/docx), Excel(xlsx/xls/csv), 文本(txt/md)`));
  }
};

// 配置上传 - 最大 50MB，最多 20 个文件
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024,  // 50MB
    files: 20,                    // 最多20个文件
  },
  fileFilter,
});

/**
 * POST /api/experiment-results/upload
 * 上传实验结果文件并进行 AI 分析
 * 
 * 请求体:
 * - files: 多个文件 (multipart/form-data)
 * - userId: 用户 ID (可选，默认 'web-user')
 * - apiUrl: AI API 地址 (可选，使用服务器配置)
 * - apiKey: AI API Key (可选，使用服务器配置)
 * - model: AI 模型 (可选，默认使用配置的模型)
 * - userInstruction/userMessage/extraQuery: 用户在输入框中随文件提交的分析要求
 * 
 * 响应:
 * - success: boolean
 * - results: ExperimentAnalysisResult[] - 每个文件的分析结果
 * - combinedSummary: 所有结果的合并总结
 * - error: string (如果失败)
 */
router.post('/upload', upload.array('files', 20), async (req, res) => {
  try {
    const userId = await resolveUserId(req.body.userId);
    let apiUrl = req.body.apiUrl || '';
    let apiKey = req.body.apiKey || '';
    let model = req.body.model || '';
    let secondaryModel = req.body.secondaryModel || '';
    let secondaryVisionModel = req.body.secondaryVisionModel || '';
    let secondaryVisionApiUrl = req.body.secondaryVisionApiUrl || req.body.visionApiUrl || '';
    let secondaryVisionApiKey = req.body.secondaryVisionApiKey || req.body.visionApiKey || '';
    const userInstruction = readUploadText(req.body.userInstruction || req.body.userMessage || req.body.extraQuery);
    const workflowIntent = readUploadText(req.body.workflowIntent, 2000);
    const figurePlan = readExperimentFigurePlan(req.body.figurePlan);
    const sourceFileName = readUploadText(req.body.sourceFileName, 300);
    const sourceFilePath = readUploadText(req.body.sourceFilePath, 2400);
    const inputSource = readUploadText(req.body.inputSource, 40);
    
    const files = req.files as Express.Multer.File[];
    
    if (!files || files.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请上传实验结果文件',
        results: [],
      });
    }
    
    logger.info(`[ExperimentResults] Processing ${files.length} files for user ${userId}${userInstruction ? ' with user instruction' : ''}`);
    
    const savedAgentConfigs = readChatBridgeAgentConfigs();
    const providers = {
      secondary: {
        apiUrl: String(apiUrl || savedAgentConfigs.secondary.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: String(apiKey || savedAgentConfigs.secondary.apiKey || ''),
        model: String(secondaryModel || model || savedAgentConfigs.secondary.model || 'gpt-4o'),
        visionModel: String(secondaryVisionModel || savedAgentConfigs.secondary.visionModel || secondaryModel || model || savedAgentConfigs.secondary.model || 'gpt-4o'),
      },
      secondaryVision: {
        apiUrl: String(secondaryVisionApiUrl || savedAgentConfigs.secondaryVision.apiUrl || '').trim().replace(/\/+$/, ''),
        apiKey: String(secondaryVisionApiKey || savedAgentConfigs.secondaryVision.apiKey || ''),
        model: String(secondaryVisionModel || savedAgentConfigs.secondaryVision.model || savedAgentConfigs.secondaryVision.visionModel || 'gpt-4o'),
        visionModel: String(secondaryVisionModel || savedAgentConfigs.secondaryVision.visionModel || savedAgentConfigs.secondaryVision.model || 'gpt-4o'),
      },
      primary: savedAgentConfigs.primary,
    };
    
    // 保存上传的文件到用户目录（便于后续引用）
    const userDir = getUserUploadDir(userId);
    const experimentDir = path.join(userDir, 'experiment-results');

    const uploadBytes = files.reduce((sum, file) => sum + Number(file.size || file.buffer?.length || 0), 0);
    const freeBytes = await getFreeDiskBytes(experimentDir);
    const requiredBytes = Math.max(MIN_FREE_UPLOAD_BYTES, uploadBytes * 2 + 128 * 1024 * 1024);
    if (freeBytes !== null && freeBytes < requiredBytes) {
      return res.status(507).json({
        success: false,
        code: 'ENOSPC',
        error: `磁盘空间不足，无法保存上传文件。当前可用 ${formatBytes(freeBytes)}，建议至少保留 ${formatBytes(requiredBytes)}。请清理 C 盘或迁移 Scholar Harness 数据目录后重试。`,
        results: [],
        freeBytes,
        requiredBytes,
      });
    }
    
    // 确保目录存在
    await fs.mkdir(experimentDir, { recursive: true });
    
    // 处理每个文件
    const results: ExperimentAnalysisResult[] = [];
    const savedFiles: Array<{
      originalName: string;
      originalPath?: string;
      inputSource?: string;
      savedPath: string;
      type: string;
      figurePlan?: ExperimentFigurePlan;
    }> = [];
    for (const file of files) {
      let fileType = detectExperimentFileType(file.originalname);
      let savedPath = '';

      try {
        const fileFigurePlan = figurePlan && (!figurePlan.originalFileName || figurePlan.originalFileName === file.originalname)
          ? figurePlan
          : undefined;
        const sourceTrace = [
          inputSource === 'drop' ? '该文件由用户拖入页面。' : '',
          sourceFileName ? `用户提供时的原始文件名：${sourceFileName}` : '',
          sourceFilePath ? `用户提供时的原始本地路径：${sourceFilePath}` : '',
        ].filter(Boolean).join('\n');
        const fileUserInstruction = [
          mergeInstructionWithFigurePlan(userInstruction, fileFigurePlan),
          sourceTrace,
        ].filter(Boolean).join('\n\n');
        const timestamp = Date.now();
        const savedName = `${timestamp}-${file.originalname}`;
        savedPath = path.join(experimentDir, savedName);
        
        // 保存文件
        await fs.writeFile(savedPath, file.buffer);
        
        savedFiles.push({
          originalName: sourceFileName || file.originalname,
          originalPath: sourceFilePath || undefined,
          inputSource: inputSource || undefined,
          savedPath,
          type: fileType,
          figurePlan: fileFigurePlan,
        });
        
        logger.info(`[ExperimentResults] Saved file: ${file.originalname} (${fileType}, ${file.buffer.length} bytes)`);

        let extractedText: string | undefined;
        let extractionSource: string | undefined;
        if (fileType === 'pdf') {
          const fastText = await extractPdfTextWithFastText(savedPath, {
            outputDir: path.join(experimentDir, 'pdf-fast-text'),
            label: file.originalname,
          });
          extractedText = fastText.text;
          extractionSource = 'pdf-marker-md 快速文本 PDF 解析结果';
        }
        
        // 调用 AI 分析服务：按配置启用 Codex 优先，否则直接走小牛马视觉/小牛马/大牛马
        const rawAnalysisResult = await analyzeExperimentResultsWithDefaultFallback({
          fileBuffer: file.buffer,
          fileName: file.originalname,
          fileType,
          apiUrl: providers.secondary.apiUrl,
          apiKey: providers.secondary.apiKey,
          model: providers.secondary.model,
          savedPath,
          extractedText,
          extractionSource,
          userInstruction: fileUserInstruction,
          figurePlan: fileFigurePlan,
        }, providers);
        const analysisResult = normalizeExperimentAnalysisResultFigureLabels({
          ...rawAnalysisResult,
          figurePlan: fileFigurePlan || rawAnalysisResult.figurePlan,
        });
        
        const materialPassport = buildMaterialPassport({
          fileName: file.originalname,
          fileType,
          savedPath,
          result: analysisResult,
          extractionSource,
          providers,
        });

        results.push({
          ...analysisResult,
          savedPath,
          materialPassport,
          figurePlan: analysisResult.figurePlan || fileFigurePlan,
        });
        
      } catch (fileError) {
        logger.error(`[ExperimentResults] Failed to process file ${file.originalname}:`, fileError);
        if (isNoSpaceError(fileError)) {
          if (savedPath) {
            await fs.unlink(savedPath).catch(() => undefined);
          }
          return res.status(507).json({
            success: false,
            code: 'ENOSPC',
            error: `磁盘空间不足，文件保存失败：${file.originalname}。请清理 C 盘或迁移 Scholar Harness 数据目录后重试。`,
            results: [],
          });
        }
        results.push({
          fileName: file.originalname,
          fileType,
          savedPath,
          materialPassport: {
            fileName: file.originalname,
            fileType,
            source: 'homepage-experiment-upload',
            savedPath,
            confidence: 'low',
            uncertainItems: [`文件处理失败: ${(fileError as Error).message}`],
            includeInWriting: false,
            linkedChapters: [],
            createdAt: new Date().toISOString(),
          },
          paper_title: '',
          results: [],
          figurePlan,
          overall_summary: {
            main_findings: [],
            best_model_claims: [],
            ablation_findings: [],
            robustness_findings: [],
            efficiency_findings: [],
            uncertain_items: [`文件处理失败: ${(fileError as Error).message}`],
          },
          error: (fileError as Error).message,
        });
      }
    }
    
    // 合并所有结果的总结
    const combinedSummary = combineAnalysisResults(results);
    
    logger.info(`[ExperimentResults] Completed analysis for ${files.length} files, ${results.length} results`);
    
    // ========== 关键修复：将分析结果写入 Memory ==========
    // 上传图片后的分析结果也需要更新到 data_summary
    try {
      const memory = await loadUserMemory(userId);
      const memoryResults = results.filter(hasMemoryWorthyExperimentResult);
      let memoryChanged = false;

      const appendMemoryEntry = (
        rawKey: 'experiment_summary' | 'data_summary',
        structuredKey: 'experiment_summary_structured' | 'data_summary_structured',
        text: string,
        source: string
      ): void => {
        if (text.length <= 20) return;

        autoRestoreDeletedKeyIfEmpty(memory, rawKey);
        if (isKeyDeleted(memory, rawKey) || isKeyDeleted(memory, structuredKey)) {
          logger.info(`[ExperimentResults] SKIP "${rawKey}" - user has deleted this key`);
          return;
        }

        const existingRaw = memory.entries.find(e => e.key === rawKey);
        const existingStructured = memory.entries.find(e => e.key === structuredKey);
        const existingContent = [
          existingRaw?.value,
          existingStructured?.value,
        ].filter(Boolean).join('\n\n');
        const duplicateMarker = text.substring(0, 120);
        if (existingContent.includes(duplicateMarker)) {
          logger.info(`[ExperimentResults] Skip duplicate content in ${rawKey}`);
          return;
        }

        const shouldAppendExactStructured =
          rawKey === 'data_summary' && source.startsWith('experiment-results-upload');
        if (shouldAppendExactStructured) {
          const newStructuredValue = existingStructured?.value
            ? existingStructured.value + '\n\n---\n\n' + text
            : text;
          const newStructuredEntry: MemoryEntry = {
            key: structuredKey,
            value: newStructuredValue,
            source,
            timestamp: new Date().toISOString(),
          };
          const existingStructuredIndex = memory.entries.findIndex(e => e.key === structuredKey);
          if (existingStructuredIndex >= 0) {
            memory.entries[existingStructuredIndex] = newStructuredEntry;
          } else {
            memory.entries.push(newStructuredEntry);
          }
          memoryChanged = true;
          logger.info(`[ExperimentResults] Appended exact upload content to ${structuredKey} (${text.length} chars)`);
          return;
        }

        const newValue = existingRaw?.value
          ? existingRaw.value + '\n\n---\n\n' + text
          : text;
        const newEntry: MemoryEntry = {
          key: rawKey,
          value: newValue,
          source,
          timestamp: new Date().toISOString(),
        };
        const existingIndex = memory.entries.findIndex(e => e.key === rawKey);
        if (existingIndex >= 0) {
          memory.entries[existingIndex] = newEntry;
        } else {
          memory.entries.push(newEntry);
        }
        memoryChanged = true;
        logger.info(`[ExperimentResults] Updated ${rawKey} with upload content (${text.length} chars)`);
      };

      // 用户希望图片/文件内容直接进入“数据详细总结”，并按 Figure 1/2/3 组织。
      const uploadRecordText = buildFigureGroupedDataSummary(memoryResults, userInstruction);
      appendMemoryEntry(
        'data_summary',
        'data_summary_structured',
        uploadRecordText,
        'experiment-results-upload-manifest'
      );
      
      // 构建分析结果的文本描述
      const analysisTextParts: string[] = [];

      if (userInstruction && memoryResults.length > 0) {
        analysisTextParts.push(`【用户随实验资料提交的要求】\n${userInstruction}`);
      }
      
      // 1. 整体总结（combinedSummary 直接包含 main_findings 等字段）
      const summaryLines: string[] = [];
      const memoryCombinedSummary = combineAnalysisResults(memoryResults);
      if (memoryCombinedSummary.main_findings?.length > 0) {
        summaryLines.push('主要发现：');
        memoryCombinedSummary.main_findings.forEach((f: string) => summaryLines.push(`  - ${f}`));
      }
      if (memoryCombinedSummary.best_model_claims?.length > 0) {
        summaryLines.push('最佳模型结果：');
        memoryCombinedSummary.best_model_claims.forEach((c: string) => summaryLines.push(`  - ${c}`));
      }
      if (summaryLines.length > 0) {
        analysisTextParts.push(`【${memoryResults.length}个实验结果文件分析总结】\n${summaryLines.join('\n')}`);
      }
      
      // 2. 每个文件的详细结果
      for (const result of memoryResults) {
        if (result.results && result.results.length > 0) {
          const fileLines: string[] = [];
          fileLines.push(`文件：${result.fileName}`);
          if (result.figurePlan?.figureName || result.figurePlan?.panelLabel || result.figurePlan?.caption) {
            const figurePlanLabel = formatExperimentFigureLabel(
              result.figurePlan.figureName || '',
              result.figurePlan.panelLabel || ''
            );
            fileLines.push(`用户图片规划：${[
              figurePlanLabel,
              result.figurePlan.caption ? `：${result.figurePlan.caption}` : '',
            ].filter(Boolean).join('')}`);
          }
          if (result.paper_title) {
            fileLines.push(`论文/来源标题：${result.paper_title}`);
          }
          if (result.analysisProvider) {
            fileLines.push(`分析引擎：${result.analysisProvider}`);
          }
          
          for (const [recordIndex, record] of result.results.entries()) {
            const formattedRecord = formatExperimentRecordForMemory(record, recordIndex);
            if (formattedRecord) {
              fileLines.push(formattedRecord);
            }
          }
          
          if (fileLines.length > 1) {
            analysisTextParts.push(fileLines.join('\n'));
          }
        }
        
        // 添加不确定性说明
        if (result.overall_summary?.uncertain_items?.length > 0) {
          const uncertainText = joinExperimentMemoryValues(result.overall_summary.uncertain_items, '; ');
          if (uncertainText) {
            analysisTextParts.push(`注意：${uncertainText}`);
          }
        }
      }
      
      const analysisText = analysisTextParts.join('\n\n');
      if (results.length > 0 && memoryResults.length === 0) {
        logger.info('[ExperimentResults] Skip memory update: no usable experiment analysis results');
      }
      
      // 更新 data_summary（数值型结果）
      if (!uploadRecordText && analysisText.length > 50) {
        appendMemoryEntry(
          'data_summary',
          'data_summary_structured',
          analysisText,
          'experiment-results-upload'
        );
      }

      if (memoryChanged) {
        // 保存 memory；saveUserMemory 会把 raw summary 并入对应 structured summary
        memory.updatedAt = new Date().toISOString();
        await saveUserMemory(memory);
        
        // 从落盘后的 memory 同步具体 txt 文件，避免 structured/raw 优先级不一致
        const savedMemory = await loadUserMemory(userId);
        await saveMemoryToFiles(userId, savedMemory);

        logger.info('[ExperimentResults] Saved exact upload records to memory; skipped AI re-summarization to preserve previous figure records');
      }
      
    } catch (memoryError) {
      logger.warn('[ExperimentResults] Failed to update memory:', memoryError);
      // 不影响主流程，继续返回结果
    }
    
    res.json({
      success: true,
      results,
      combinedSummary,
      savedFiles: savedFiles.map(f => ({
        name: f.originalName,
        originalName: f.originalName,
        originalPath: f.originalPath || '',
        inputSource: f.inputSource || '',
        type: f.type,
        figurePlan: f.figurePlan,
        source: {
          kind: 'experiment-results',
          originalPath: f.savedPath,
        },
      })),
      userInstruction,
      workflowIntent,
    });
    
  } catch (error) {
    logger.error('[ExperimentResults] Upload error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
      results: [],
    });
  }
});

/**
 * GET /api/experiment-results/:userId
 * 获取用户上传的实验结果文件列表
 */
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    const userDir = getUserUploadDir(userId);
    const experimentDir = path.join(userDir, 'experiment-results');
    
    // 检查目录是否存在
    try {
      await fs.access(experimentDir);
    } catch {
      return res.json({
        success: true,
        files: [],
        message: '暂无上传的实验结果文件',
      });
    }
    
    // 读取目录中的文件
    const files = await fs.readdir(experimentDir);
    const fileInfos: Array<{ name: string; type: string; size: number; uploadTime: string }> = [];
    
    for (const fileName of files) {
      const filePath = path.join(experimentDir, fileName);
      const stats = await fs.stat(filePath);
      const ext = path.extname(fileName).toLowerCase();
      
      let type = 'unknown';
      if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) type = 'image';
      else if (ext === '.pdf') type = 'pdf';
      else if (['.doc', '.docx'].includes(ext)) type = 'word';
      else if (['.xlsx', '.xls', '.csv'].includes(ext)) type = 'table';
      
      // 从文件名中提取上传时间（格式: timestamp-originalname）
      const timestampMatch = fileName.match(/^(\d+)-/);
      const uploadTime = timestampMatch 
        ? new Date(parseInt(timestampMatch[1])).toISOString()
        : stats.mtime.toISOString();
      
      fileInfos.push({
        name: fileName.replace(/^\d+-/, ''),  // 移除时间戳前缀
        type,
        size: stats.size,
        uploadTime,
      });
    }
    
    res.json({
      success: true,
      files: fileInfos,
    });
    
  } catch (error) {
    logger.error('[ExperimentResults] Get files error:', error);
    res.json({
      success: false,
      files: [],
      error: (error as Error).message,
    });
  }
});

/**
 * DELETE /api/experiment-results/:userId/:fileName
 * 删除指定的实验结果文件
 */
router.delete('/:userId/:fileName', async (req, res) => {
  try {
    const { userId, fileName } = req.params;
    const userDir = getUserUploadDir(userId);
    const experimentDir = path.join(userDir, 'experiment-results');
    
    // 查找匹配的文件（考虑时间戳前缀）
    const files = await fs.readdir(experimentDir);
    const matchingFile = files.find(f => f.endsWith(`-${fileName}`) || f === fileName);
    
    if (!matchingFile) {
      return res.status(404).json({
        success: false,
        error: '文件不存在',
      });
    }
    
    const filePath = path.join(experimentDir, matchingFile);
    await fs.unlink(filePath);
    
    logger.info(`[ExperimentResults] Deleted file: ${fileName} for user ${userId}`);
    
    res.json({
      success: true,
      message: '文件已删除',
    });
    
  } catch (error) {
    logger.error('[ExperimentResults] Delete file error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * 合合多个分析结果
 */
function combineAnalysisResults(results: ExperimentAnalysisResult[]): {
  main_findings: string[];
  best_model_claims: string[];
  ablation_findings: string[];
  robustness_findings: string[];
  efficiency_findings: string[];
  uncertain_items: string[];
  totalResultsCount: number;
} {
  const combined = {
    main_findings: [] as string[],
    best_model_claims: [] as string[],
    ablation_findings: [] as string[],
    robustness_findings: [] as string[],
    efficiency_findings: [] as string[],
    uncertain_items: [] as string[],
    totalResultsCount: 0,
  };
  
  for (const result of results) {
    if (result.overall_summary) {
      combined.main_findings.push(...result.overall_summary.main_findings || []);
      combined.best_model_claims.push(...result.overall_summary.best_model_claims || []);
      combined.ablation_findings.push(...result.overall_summary.ablation_findings || []);
      combined.robustness_findings.push(...result.overall_summary.robustness_findings || []);
      combined.efficiency_findings.push(...result.overall_summary.efficiency_findings || []);
      combined.uncertain_items.push(...result.overall_summary.uncertain_items || []);
    }
    combined.totalResultsCount += result.results?.length || 0;
  }
  
  // 去重
  combined.main_findings = [...new Set(combined.main_findings)];
  combined.best_model_claims = [...new Set(combined.best_model_claims)];
  combined.ablation_findings = [...new Set(combined.ablation_findings)];
  combined.robustness_findings = [...new Set(combined.robustness_findings)];
  combined.efficiency_findings = [...new Set(combined.efficiency_findings)];
  
  return combined;
}

export default router;
