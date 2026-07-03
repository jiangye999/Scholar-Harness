/**
 * 数据分析路由
 *
 * 第一版提供 SPSS 风格的本地统计分析：
 * 上传 Excel/CSV -> 识别变量 -> 选择分析方法 -> 返回统计表和解释。
 */

import { Router } from 'express';
import multer from 'multer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { logger } from '../../utils/logger';
import { getUserUploadDir, sanitizeUserId } from '../../utils/paths';
import { researchSessionManager } from '../../research/research-session-manager';
import {
  loadUserMemory,
  saveMemoryToFiles,
  saveUserMemory,
  withMemoryLock,
  removeFromDeletedKeys,
  type MemoryEntry,
} from './memory';

const router = Router();

let XLSX: typeof import('xlsx') | null = null;
async function getXLSX(): Promise<typeof import('xlsx')> {
  if (!XLSX) {
    XLSX = await import('xlsx');
  }
  return XLSX;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`不支持的文件格式: ${ext}。仅支持 Excel (.xlsx, .xls) 和 CSV 文件。`));
  },
});

type VariableType = 'numeric' | 'categorical' | 'date' | 'empty';
type AnalysisMethod =
  | 'descriptive'
  | 'independent_t'
  | 'paired_t'
  | 'anova'
  | 'correlation'
  | 'regression'
  | 'chi_square'
  | 'visualization'
  | 'normality'
  | 'variance_homogeneity'
  | 'nonparametric'
  | 'two_way_anova'
  | 'pca'
  | 'cluster'
  | 'mixed_effects'
  | 'survival';

interface DataVariable {
  name: string;
  type: VariableType;
  missingCount: number;
  nonMissingCount: number;
  uniqueCount: number;
  sampleValues: string[];
}

interface DataColumn extends DataVariable {
  values: unknown[];
}

interface ParsedDataset {
  filename: string;
  sheetName: string;
  sheetNames: string[];
  rowCount: number;
  columnCount: number;
  columns: DataColumn[];
  previewRows: string[][];
}

interface AnalysisResult {
  title: string;
  markdown: string;
  warnings: string[];
  significance?: AnalysisSignificance;
}

interface SignificanceComparison {
  groups: string[];
  pValue: number;
  adjustedPValue?: number;
  pFormatted: string;
  adjustedPFormatted?: string;
  stars: string;
  label: string;
  significant: boolean;
}

interface AnalysisSignificance {
  method: string;
  responseVar?: string;
  groupVar?: string;
  variableA?: string;
  variableB?: string;
  statistic?: string;
  statisticValue?: number;
  df?: number;
  df1?: number;
  df2?: number;
  pValue?: number;
  pFormatted?: string;
  stars?: string;
  significant?: boolean;
  label?: string;
  comparisons?: SignificanceComparison[];
  analyses?: AnalysisSignificance[];
  note?: string;
}

interface DatasetSummaryForOverview {
  filename: string;
  sheetName: string;
  sheetNames: string[];
  rowCount: number;
  columnCount: number;
  variables: DataVariable[];
  previewRows: string[][];
}

router.post('/inspect', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传 Excel 或 CSV 文件' });
    }

    const dataset = await parseDataset(req.file.buffer, req.file.originalname);
    res.json({
      success: true,
      data: toDatasetSummary(dataset),
    });
  } catch (error) {
    logger.error('[DataAnalysis] Inspect failed:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: '请上传 Excel 或 CSV 文件' });
    }

    const methods = normalizeMethods(req.body.methods || req.body.method);
    const method = methods[0] || 'descriptive';
    const dataset = await parseDataset(req.file.buffer, req.file.originalname);
    const options = {
      numericVar: readBodyString(req.body.numericVar),
      numericVar2: readBodyString(req.body.numericVar2),
      groupVar: readBodyString(req.body.groupVar),
      categoryVar: readBodyString(req.body.categoryVar),
      categoryVar2: readBodyString(req.body.categoryVar2),
      dependentVar: readBodyString(req.body.dependentVar),
      predictorVars: readPredictorVars(req.body.predictorVars),
      hypothesizedMean: Number(readBodyString(req.body.hypothesizedMean) || '0'),
    };
    const extraQuery = cleanDataAnalysisExtraQuery(req.body.extraQuery);

    const result = runAnalyses(dataset, methods, options);
    if (extraQuery) {
      result.markdown = `${result.markdown}\n\n## 用户额外要求\n\n${extraQuery}`;
    }
    const userId = sanitizeUserId(readBodyString(req.body.userId) || 'web-user');
    const datasetSummary = toDatasetSummary(dataset);
    const memoryUpdate = await updateDataAnalysisMemory({
      userId,
      dataset,
      methods,
      options,
      result,
      extraQuery,
    }).catch((error) => {
      logger.warn('[DataAnalysis] Failed to update memory:', error);
      return { dataUpdated: false, experimentUpdated: false, error: (error as Error).message };
    });
    const researchSession = await recordDataAnalysisResearchProvenance({
      userId,
      researchSessionId: readBodyString(req.body.researchSessionId),
      datasetSummary,
      methods,
      options,
      result,
      extraQuery,
      memoryUpdate,
    }).catch((error) => {
      logger.warn('[ResearchSession] Failed to record data-analysis provenance:', error);
      return undefined;
    });
    await writeDataAnalysisOverviewStatus({
      userId,
      datasetSummary,
      methods,
      options,
      result,
      extraQuery,
      memoryUpdate,
      researchSession,
    }).catch((error) => {
      logger.warn('[DataAnalysis] Failed to persist overview status:', error);
    });
    res.json({
      success: true,
      data: {
        dataset: datasetSummary,
        method,
        methods,
        result,
        memoryUpdate,
        researchSession,
      },
    });
  } catch (error) {
    logger.error('[DataAnalysis] Analyze failed:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/methods', (req, res) => {
  res.json({
    success: true,
    data: {
      methods: [
        { id: 'descriptive', name: '描述性统计', description: '均值、标准差、分位数、频数和缺失值概览' },
        { id: 'independent_t', name: '独立样本 t 检验', description: '比较两个独立组在一个连续变量上的均值差异' },
        { id: 'paired_t', name: '配对样本 t 检验', description: '比较两个配对连续变量的均值差异' },
        { id: 'anova', name: '单因素方差分析', description: '比较三个及以上组别的均值差异' },
        { id: 'correlation', name: '相关分析', description: 'Pearson 和 Spearman 相关系数' },
        { id: 'regression', name: '线性回归', description: '连续因变量与一个或多个连续自变量的线性关系' },
        { id: 'chi_square', name: '卡方检验', description: '两个分类变量之间的关联检验' },
        { id: 'normality', name: '正态性检验', description: 'Shapiro-Wilk、QQ 图和分布诊断（R 代码生成）' },
        { id: 'variance_homogeneity', name: '方差齐性检验', description: 'Levene/Bartlett 方差齐性诊断（R 代码生成）' },
        { id: 'nonparametric', name: '非参数检验', description: 'Mann-Whitney、Wilcoxon 或 Kruskal-Wallis（R 代码生成）' },
        { id: 'two_way_anova', name: '双因素方差分析', description: '两个分组因素及交互作用（R 代码生成）' },
        { id: 'pca', name: '主成分分析 PCA', description: '降维、载荷和样本得分图（R 代码生成）' },
        { id: 'cluster', name: '聚类分析', description: '层次聚类或 K-means 聚类（R 代码生成）' },
        { id: 'mixed_effects', name: '混合效应模型', description: '含随机效应的重复/嵌套设计（R 代码生成）' },
        { id: 'survival', name: '生存分析', description: 'Kaplan-Meier 和 Cox 回归（R 代码生成）' },
        { id: 'visualization', name: '图表建议', description: '根据字段类型推荐适合的图表和 R 作图入口' },
      ],
    },
  });
});

async function parseDataset(buffer: Buffer, filename: string): Promise<ParsedDataset> {
  const xlsx = await getXLSX();
  const workbook = xlsx.read(buffer, {
    type: 'buffer',
    cellDates: true,
    raw: true,
  });

  if (workbook.SheetNames.length === 0) {
    throw new Error('文件中没有可读取的工作表');
  }

  const sheetName = workbook.SheetNames[0];
  const firstSheet = workbook.Sheets[sheetName];
  const rawRows = xlsx.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  const rows = rawRows.filter(row => row.some(cell => !isMissing(cell)));
  if (rows.length < 2) {
    throw new Error('数据至少需要包含一行表头和一行数据');
  }

  const headers = makeUniqueHeaders(rows[0]);
  const dataRows = rows.slice(1);
  const columns = headers.map((name, colIndex) => {
    const values = dataRows.map(row => row[colIndex]);
    const nonMissing = values.filter(value => !isMissing(value));
    const sampleValues = nonMissing.slice(0, 6).map(formatCell);
    const uniqueValues = new Set(nonMissing.map(value => formatCell(value)));
    const type = inferVariableType(nonMissing);

    return {
      name,
      type,
      values,
      missingCount: values.length - nonMissing.length,
      nonMissingCount: nonMissing.length,
      uniqueCount: uniqueValues.size,
      sampleValues,
    };
  });

  return {
    filename,
    sheetName,
    sheetNames: workbook.SheetNames,
    rowCount: dataRows.length,
    columnCount: headers.length,
    columns,
    previewRows: rows.slice(0, 8).map(row => headers.map((_, index) => formatCell(row[index]))),
  };
}

function makeUniqueHeaders(headerRow: unknown[]): string[] {
  const seen = new Map<string, number>();
  return headerRow.map((value, index) => {
    const raw = formatCell(value).trim() || `Column_${index + 1}`;
    const base = raw.replace(/\s+/g, '_');
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function inferVariableType(values: unknown[]): VariableType {
  if (values.length === 0) return 'empty';

  const numericCount = values.filter(value => Number.isFinite(toNumber(value))).length;
  if (numericCount / values.length >= 0.85) return 'numeric';

  const dateCount = values.filter(value => value instanceof Date || !Number.isNaN(Date.parse(String(value)))).length;
  if (dateCount / values.length >= 0.85) return 'date';

  return 'categorical';
}

function toDatasetSummary(dataset: ParsedDataset): {
  filename: string;
  sheetName: string;
  sheetNames: string[];
  rowCount: number;
  columnCount: number;
  variables: DataVariable[];
  previewRows: string[][];
} {
  return {
    filename: dataset.filename,
    sheetName: dataset.sheetName,
    sheetNames: dataset.sheetNames,
    rowCount: dataset.rowCount,
    columnCount: dataset.columnCount,
    variables: dataset.columns.map(({ values, ...variable }) => variable),
    previewRows: dataset.previewRows,
  };
}

function getAnalysisMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    descriptive: '描述性统计',
    independent_t: '独立样本 t 检验',
    paired_t: '配对样本 t 检验',
    anova: '单因素方差分析',
    correlation: '相关分析',
    regression: '线性回归',
    chi_square: '卡方检验',
    visualization: '图表建议',
    normality: '正态性检验',
    variance_homogeneity: '方差齐性检验',
    nonparametric: '非参数检验',
    two_way_anova: '双因素方差分析',
    pca: '主成分分析 PCA',
    cluster: '聚类分析',
    mixed_effects: '混合效应模型',
    survival: '生存分析',
  };
  return labels[method] || method;
}

async function writeDataAnalysisOverviewStatus(input: {
  userId: string;
  datasetSummary: DatasetSummaryForOverview;
  methods: string[];
  options: Record<string, unknown>;
  result: AnalysisResult;
  extraQuery?: string;
  memoryUpdate: unknown;
  researchSession?: { sessionId: string; provenanceRecordId: string; artifactId: string };
}): Promise<void> {
  const dir = path.join(getUserUploadDir(input.userId), 'data-analysis');
  const status = {
    version: 1,
    userId: sanitizeUserId(input.userId),
    updatedAt: new Date().toISOString(),
    dataset: {
      filename: input.datasetSummary.filename,
      sheetName: input.datasetSummary.sheetName,
      sheetNames: input.datasetSummary.sheetNames,
      rowCount: input.datasetSummary.rowCount,
      columnCount: input.datasetSummary.columnCount,
      variableCount: input.datasetSummary.variables.length,
      numericVariableCount: input.datasetSummary.variables.filter(variable => variable.type === 'numeric').length,
      categoricalVariableCount: input.datasetSummary.variables.filter(variable => variable.type === 'categorical').length,
      variables: input.datasetSummary.variables.slice(0, 80).map(variable => ({
        name: variable.name,
        type: variable.type,
        missingCount: variable.missingCount,
        nonMissingCount: variable.nonMissingCount,
        uniqueCount: variable.uniqueCount,
      })),
    },
    methods: input.methods,
    methodLabels: input.methods.map(getAnalysisMethodLabel),
    options: input.options,
    result: {
      title: input.result.title,
      warningCount: input.result.warnings.length,
      warnings: input.result.warnings.slice(0, 20),
      significance: input.result.significance,
      markdownPreview: input.result.markdown.slice(0, 8000),
    },
    extraQuery: input.extraQuery || '',
    memoryUpdate: input.memoryUpdate,
    researchSession: input.researchSession,
  };
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'latest-analysis.json'), JSON.stringify(status, null, 2), 'utf-8');
}

function runAnalysis(
  dataset: ParsedDataset,
  method: AnalysisMethod,
  options: {
    numericVar: string;
    numericVar2: string;
    groupVar: string;
    categoryVar: string;
    categoryVar2: string;
    dependentVar: string;
    predictorVars: string[];
    hypothesizedMean: number;
  }
): AnalysisResult {
  switch (method) {
    case 'descriptive':
      return analyzeDescriptive(dataset, options.numericVar);
    case 'independent_t':
      return analyzeIndependentT(dataset, options.numericVar, options.groupVar);
    case 'paired_t':
      return analyzePairedT(dataset, options.numericVar, options.numericVar2);
    case 'anova':
      return analyzeAnova(dataset, options.numericVar, options.groupVar);
    case 'correlation':
      return analyzeCorrelation(dataset, options.numericVar, options.numericVar2);
    case 'regression':
      return analyzeRegression(dataset, options.dependentVar || options.numericVar, options.predictorVars);
    case 'chi_square':
      return analyzeChiSquare(dataset, options.categoryVar || options.groupVar, options.categoryVar2);
    case 'visualization':
      return analyzeVisualization(dataset);
    case 'normality':
    case 'variance_homogeneity':
    case 'nonparametric':
    case 'two_way_anova':
    case 'pca':
    case 'cluster':
    case 'mixed_effects':
    case 'survival':
      return analyzeRCodeOnlyMethod(dataset, method, options);
    default:
      return analyzeDescriptive(dataset, '');
  }
}

function runAnalyses(
  dataset: ParsedDataset,
  methods: AnalysisMethod[],
  options: {
    numericVar: string;
    numericVar2: string;
    groupVar: string;
    categoryVar: string;
    categoryVar2: string;
    dependentVar: string;
    predictorVars: string[];
    hypothesizedMean: number;
  }
): AnalysisResult {
  const selectedMethods: AnalysisMethod[] = methods.length > 0 ? methods : ['descriptive'];
  if (selectedMethods.length === 1) return runAnalysis(dataset, selectedMethods[0], options);

  const sections: string[] = [`# 多方法数据分析报告`, `数据集：${dataset.filename}，${dataset.rowCount} 行，${dataset.columnCount} 列。`];
  const warnings: string[] = [];
  const significanceAnalyses: AnalysisSignificance[] = [];
  for (const method of selectedMethods) {
    try {
      const result = runAnalysis(dataset, method, options);
      sections.push(`\n\n---\n\n${result.markdown}`);
      warnings.push(...result.warnings.map(item => `${getAnalysisMethodDisplayName(method)}：${item}`));
      if (result.significance) significanceAnalyses.push(result.significance);
    } catch (error) {
      const message = (error as Error).message;
      warnings.push(`${getAnalysisMethodDisplayName(method)} 未完成：${message}`);
      sections.push(`\n\n---\n\n# ${getAnalysisMethodDisplayName(method)}\n\n未完成：${message}`);
    }
  }

  return {
    title: '多方法数据分析报告',
    markdown: appendWarnings(sections.join('\n\n'), warnings),
    warnings,
    significance: significanceAnalyses.length > 0
      ? {
          method: 'multiple analyses',
          significant: significanceAnalyses.some(item => item.significant),
          analyses: significanceAnalyses,
          note: 'When generating linked R plots, use only the listed analyses/comparisons for real significance labels. If a selected method has no real significance result, do not draw x/xx/xxx placeholders or invented letter groups.',
        }
      : undefined,
  };
}

async function updateDataAnalysisMemory(args: {
  userId: string;
  dataset: ParsedDataset;
  methods: AnalysisMethod[];
  options: {
    numericVar: string;
    numericVar2: string;
    groupVar: string;
    categoryVar: string;
    categoryVar2: string;
    dependentVar: string;
    predictorVars: string[];
    hypothesizedMean: number;
  };
  result: AnalysisResult;
  extraQuery: string;
}): Promise<{ dataUpdated: boolean; experimentUpdated: boolean }> {
  const dataSummary = buildDataAnalysisDataSummary(args);
  const experimentSummary = shouldWriteExperimentSummaryFromExtraQuery(args.extraQuery)
    ? buildDataAnalysisExperimentSummary(args)
    : '';
  if (!dataSummary && !experimentSummary) return { dataUpdated: false, experimentUpdated: false };

  return withMemoryLock(args.userId, async () => {
    const memory = await loadUserMemory(args.userId);
    let dataUpdated = false;
    let experimentUpdated = false;
    if (dataSummary) {
      appendMemoryEntry(memory.entries, 'data_summary', dataSummary, 'data_analysis_auto');
      removeFromDeletedKeys(memory, 'data_summary');
      dataUpdated = true;
    }
    if (experimentSummary) {
      appendMemoryEntry(memory.entries, 'experiment_summary', experimentSummary, 'data_analysis_extra_query');
      removeFromDeletedKeys(memory, 'experiment_summary');
      experimentUpdated = true;
    }
    await saveUserMemory(memory);
    await saveMemoryToFiles(args.userId, memory);
    logger.info(`[DataAnalysis] Memory updated for ${args.userId}: data=${dataUpdated}, experiment=${experimentUpdated}`);
    return { dataUpdated, experimentUpdated };
  });
}

function appendMemoryEntry(entries: MemoryEntry[], key: string, content: string, source: string): void {
  const cleaned = content.trim();
  if (!cleaned) return;
  const existing = entries.find(entry => entry.key === key);
  const timestamp = new Date().toISOString();
  if (!existing) {
    entries.push({ key, value: cleaned, source, timestamp });
    return;
  }
  if (existing.value.includes(cleaned.slice(0, Math.min(600, cleaned.length)))) {
    existing.timestamp = timestamp;
    existing.source = source;
    return;
  }
  existing.value = `${existing.value.trim()}\n\n---\n\n${cleaned}`.trim();
  existing.source = source;
  existing.timestamp = timestamp;
}

function buildDataAnalysisDataSummary(args: Parameters<typeof updateDataAnalysisMemory>[0]): string {
  const dataset = args.dataset;
  const variables = dataset.columns.map(column =>
    `- ${column.name}: ${column.type}; 有效 N=${column.nonMissingCount}; 缺失=${column.missingCount}; 示例=${column.sampleValues.join(', ') || '无'}`
  ).join('\n');
  const selectedVariables = [
    args.options.numericVar ? `数值变量=${args.options.numericVar}` : '',
    args.options.numericVar2 ? `第二数值变量=${args.options.numericVar2}` : '',
    args.options.groupVar ? `分组变量=${args.options.groupVar}` : '',
    args.options.categoryVar ? `分类变量A=${args.options.categoryVar}` : '',
    args.options.categoryVar2 ? `分类变量B=${args.options.categoryVar2}` : '',
    args.options.dependentVar ? `因变量=${args.options.dependentVar}` : '',
    args.options.predictorVars.length ? `自变量=${args.options.predictorVars.join(', ')}` : '',
  ].filter(Boolean).join('；') || '自动选择变量';
  const significance = args.result.significance
    ? `\n\n结构化显著性信息：\n${JSON.stringify(args.result.significance, null, 2).slice(0, 8000)}`
    : '';
  return `【数据分析自动更新】${new Date().toISOString()}
数据文件：${dataset.filename}
工作表：${dataset.sheetName}
数据结构：${dataset.rowCount} 行，${dataset.columnCount} 列。
分析方法：${args.methods.map(getAnalysisMethodDisplayName).join(' + ')}
变量选择：${selectedVariables}

变量概览：
${variables}

分析结果、检验结果、p 值和显著性：
${args.result.markdown.slice(0, 22000)}${significance}

用户额外要求：
${args.extraQuery || '无'}`;
}

function shouldWriteExperimentSummaryFromExtraQuery(extraQuery: string): boolean {
  if (!extraQuery.trim()) return false;
  return /(试验|实验|研究地点|地点|站点|site|location|field|greenhouse|温室|处理|treatment|施肥|灌溉|品种|作物|crop|土壤|soil|方法|method|设计|design|重复|replicate|plot|小区|采样|sampling|材料|materials)/i.test(extraQuery);
}

function buildDataAnalysisExperimentSummary(args: Parameters<typeof updateDataAnalysisMemory>[0]): string {
  return `【数据分析额外要求中提取的试验资料】${new Date().toISOString()}
数据文件：${args.dataset.filename}
以下内容来自用户在数据分析界面填写的额外要求。仅记录其中可能涉及试验设计、处理、地点、材料或方法的描述；统计表和纯数值检验结果不写入本字段。

${args.extraQuery}`;
}

function pToStars(p: number): string {
  if (!Number.isFinite(p)) return 'ns';
  if (p < 0.001) return '***';
  if (p < 0.01) return '**';
  if (p < 0.05) return '*';
  return 'ns';
}

function pToLabel(p: number): string {
  const pFormatted = formatP(p);
  return `${pToStars(p)} (p=${pFormatted})`;
}

function adjustPValuesHolm(values: number[]): number[] {
  const indexed = values
    .map((p, index) => ({ p: Number.isFinite(p) ? Math.max(0, Math.min(1, p)) : 1, index }))
    .sort((a, b) => a.p - b.p);
  const adjustedSorted = new Array(indexed.length).fill(1);
  let runningMax = 0;
  indexed.forEach((item, rank) => {
    const adjusted = Math.min(1, item.p * (indexed.length - rank));
    runningMax = Math.max(runningMax, adjusted);
    adjustedSorted[rank] = runningMax;
  });
  const output = new Array(indexed.length).fill(1);
  indexed.forEach((item, rank) => {
    output[item.index] = adjustedSorted[rank];
  });
  return output;
}

function welchTTest(valuesA: number[], valuesB: number[]): { t: number; df: number; p: number } {
  const statsA = describeNumbers(valuesA);
  const statsB = describeNumbers(valuesB);
  const se = Math.sqrt((statsA.variance / statsA.count) + (statsB.variance / statsB.count));
  const t = (statsA.mean - statsB.mean) / se;
  const dfNumerator = Math.pow((statsA.variance / statsA.count) + (statsB.variance / statsB.count), 2);
  const dfDenominator = (Math.pow(statsA.variance / statsA.count, 2) / (statsA.count - 1))
    + (Math.pow(statsB.variance / statsB.count, 2) / (statsB.count - 1));
  const df = dfNumerator / dfDenominator;
  return { t, df, p: twoTailedTPValue(t, df) };
}

function analyzeDescriptive(dataset: ParsedDataset, selectedVar: string): AnalysisResult {
  const warnings: string[] = [];
  const numericColumns = selectedVar
    ? [requireColumn(dataset, selectedVar, 'numeric')]
    : dataset.columns.filter(column => column.type === 'numeric');
  const categoricalColumns = dataset.columns.filter(column => column.type === 'categorical');

  if (numericColumns.length === 0 && categoricalColumns.length === 0) {
    throw new Error('没有可用于描述统计的数值变量或分类变量');
  }

  const numericRows = numericColumns.map(column => {
    const values = getNumericValues(column);
    const stats = describeNumbers(values);
    return [
      column.name,
      String(stats.count),
      formatNumber(stats.mean),
      formatNumber(stats.sd),
      formatNumber(stats.median),
      formatNumber(stats.q1),
      formatNumber(stats.q3),
      formatNumber(stats.min),
      formatNumber(stats.max),
      String(column.missingCount),
    ];
  });

  const frequencySections = categoricalColumns.slice(0, selectedVar ? 0 : 5).map(column => {
    const counts = countCategories(column.values);
    const top = counts.slice(0, 8).map(item => `| ${escapePipe(item.label)} | ${item.count} | ${formatNumber(item.percent)}% |`).join('\n');
    return `### ${column.name} 频数\n\n| 类别 | 频数 | 百分比 |\n| --- | ---: | ---: |\n${top}`;
  });

  const markdown = [
    `# 描述性统计`,
    `数据集：${dataset.filename}，${dataset.rowCount} 行，${dataset.columnCount} 列。`,
    numericRows.length > 0
      ? `\n## 连续变量\n\n| 变量 | N | 均值 | 标准差 | 中位数 | Q1 | Q3 | 最小值 | 最大值 | 缺失 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n${numericRows.map(row => `| ${row.join(' | ')} |`).join('\n')}`
      : '',
    frequencySections.join('\n\n'),
    `\n## 解释\n连续变量建议同时报告均值±标准差和中位数[IQR]；分类变量建议报告频数和百分比。若缺失值较多，论文方法部分需要说明缺失值处理策略。`,
  ].filter(Boolean).join('\n\n');

  return { title: '描述性统计', markdown, warnings };
}

function analyzeIndependentT(dataset: ParsedDataset, numericVar: string, groupVar: string): AnalysisResult {
  const warnings: string[] = [];
  const numericColumn = selectNumericColumn(dataset, numericVar);
  const groupColumn = selectCategoricalColumn(dataset, groupVar);
  const grouped = groupNumericValues(numericColumn, groupColumn);
  const groups = Array.from(grouped.entries()).filter(([, values]) => values.length >= 2);

  if (groups.length < 2) {
    throw new Error('独立样本 t 检验需要至少两个组别，且每组至少有 2 个有效数值');
  }
  if (groups.length > 2) {
    warnings.push(`分组变量包含 ${groups.length} 个组别，独立样本 t 检验仅比较前两个有效组；多组比较建议使用 ANOVA。`);
  }

  const [groupA, groupB] = groups.slice(0, 2);
  const statsA = describeNumbers(groupA[1]);
  const statsB = describeNumbers(groupB[1]);
  const se = Math.sqrt((statsA.variance / statsA.count) + (statsB.variance / statsB.count));
  const t = (statsA.mean - statsB.mean) / se;
  const dfNumerator = Math.pow((statsA.variance / statsA.count) + (statsB.variance / statsB.count), 2);
  const dfDenominator = (Math.pow(statsA.variance / statsA.count, 2) / (statsA.count - 1))
    + (Math.pow(statsB.variance / statsB.count, 2) / (statsB.count - 1));
  const df = dfNumerator / dfDenominator;
  const p = twoTailedTPValue(t, df);
  const pooledSd = Math.sqrt(((statsA.count - 1) * statsA.variance + (statsB.count - 1) * statsB.variance) / (statsA.count + statsB.count - 2));
  const cohenD = (statsA.mean - statsB.mean) / pooledSd;

  const markdown = `# 独立样本 t 检验

因变量：${numericColumn.name}  
分组变量：${groupColumn.name}

| 组别 | N | 均值 | 标准差 |
| --- | ---: | ---: | ---: |
| ${escapePipe(groupA[0])} | ${statsA.count} | ${formatNumber(statsA.mean)} | ${formatNumber(statsA.sd)} |
| ${escapePipe(groupB[0])} | ${statsB.count} | ${formatNumber(statsB.mean)} | ${formatNumber(statsB.sd)} |

| 检验 | t | df | p | Cohen's d |
| --- | ---: | ---: | ---: | ---: |
| Welch t-test | ${formatNumber(t)} | ${formatNumber(df)} | ${formatP(p)} | ${formatNumber(cohenD)} |

## 解释
${p < 0.05 ? `两组在 ${numericColumn.name} 上存在统计学显著差异。` : `两组在 ${numericColumn.name} 上未达到 0.05 水平的统计学显著差异。`}Cohen's d 可用于描述差异的效应量。`;

  return {
    title: '独立样本 t 检验',
    markdown: appendWarnings(markdown, warnings),
    warnings,
    significance: {
      method: 'Welch t-test',
      responseVar: numericColumn.name,
      groupVar: groupColumn.name,
      statistic: 't',
      statisticValue: t,
      df,
      pValue: p,
      pFormatted: formatP(p),
      stars: pToStars(p),
      significant: p < 0.05,
      label: pToLabel(p),
      comparisons: [{
        groups: [groupA[0], groupB[0]],
        pValue: p,
        pFormatted: formatP(p),
        stars: pToStars(p),
        label: pToLabel(p),
        significant: p < 0.05,
      }],
      note: 'Use this comparison to annotate the linked box/violin/bar plot. Do not invent additional p values.',
    },
  };
}

function analyzePairedT(dataset: ParsedDataset, varA: string, varB: string): AnalysisResult {
  const colA = selectNumericColumn(dataset, varA);
  const colB = selectNumericColumn(dataset, varB, [colA.name]);
  const pairs: Array<[number, number]> = [];

  for (let index = 0; index < dataset.rowCount; index += 1) {
    const a = toNumber(colA.values[index]);
    const b = toNumber(colB.values[index]);
    if (Number.isFinite(a) && Number.isFinite(b)) pairs.push([a, b]);
  }

  if (pairs.length < 2) {
    throw new Error('配对样本 t 检验需要至少 2 对有效数值');
  }

  const diffs = pairs.map(([a, b]) => a - b);
  const stats = describeNumbers(diffs);
  const se = stats.sd / Math.sqrt(stats.count);
  const t = stats.mean / se;
  const df = stats.count - 1;
  const p = twoTailedTPValue(t, df);
  const dz = stats.mean / stats.sd;

  const markdown = `# 配对样本 t 检验

变量 A：${colA.name}  
变量 B：${colB.name}

| 配对数 | 平均差值(A-B) | 差值标准差 | t | df | p | Cohen's dz |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ${stats.count} | ${formatNumber(stats.mean)} | ${formatNumber(stats.sd)} | ${formatNumber(t)} | ${df} | ${formatP(p)} | ${formatNumber(dz)} |

## 解释
${p < 0.05 ? `两次测量或两个配对变量之间存在统计学显著差异。` : `两次测量或两个配对变量之间未达到 0.05 水平的统计学显著差异。`}平均差值为正表示 ${colA.name} 整体高于 ${colB.name}。`;

  return {
    title: '配对样本 t 检验',
    markdown,
    warnings: [],
    significance: {
      method: 'paired t-test',
      variableA: colA.name,
      variableB: colB.name,
      statistic: 't',
      statisticValue: t,
      df,
      pValue: p,
      pFormatted: formatP(p),
      stars: pToStars(p),
      significant: p < 0.05,
      label: pToLabel(p),
      comparisons: [{
        groups: [colA.name, colB.name],
        pValue: p,
        pFormatted: formatP(p),
        stars: pToStars(p),
        label: pToLabel(p),
        significant: p < 0.05,
      }],
      note: 'Use this paired comparison to annotate the linked paired plot. Do not invent additional p values.',
    },
  };
}

function analyzeAnova(dataset: ParsedDataset, numericVar: string, groupVar: string): AnalysisResult {
  const numericColumn = selectNumericColumn(dataset, numericVar);
  const groupColumn = selectCategoricalColumn(dataset, groupVar);
  const grouped = Array.from(groupNumericValues(numericColumn, groupColumn).entries()).filter(([, values]) => values.length >= 2);

  if (grouped.length < 2) {
    throw new Error('ANOVA 至少需要两个有效组别，且每组至少有 2 个数值');
  }

  const allValues = grouped.flatMap(([, values]) => values);
  const grandMean = mean(allValues);
  let ssBetween = 0;
  let ssWithin = 0;
  const groupRows = grouped.map(([label, values]) => {
    const stats = describeNumbers(values);
    ssBetween += stats.count * Math.pow(stats.mean - grandMean, 2);
    ssWithin += values.reduce((sum, value) => sum + Math.pow(value - stats.mean, 2), 0);
    return [label, String(stats.count), formatNumber(stats.mean), formatNumber(stats.sd)];
  });

  const dfBetween = grouped.length - 1;
  const dfWithin = allValues.length - grouped.length;
  const msBetween = ssBetween / dfBetween;
  const msWithin = ssWithin / dfWithin;
  const f = msBetween / msWithin;
  const p = fPValue(f, dfBetween, dfWithin);
  const etaSquared = ssBetween / (ssBetween + ssWithin);
  const rawPairwise = grouped.flatMap(([labelA, valuesA], indexA) =>
    grouped.slice(indexA + 1).map(([labelB, valuesB]) => {
      const test = welchTTest(valuesA, valuesB);
      return { labelA, labelB, p: test.p };
    })
  );
  const adjusted = adjustPValuesHolm(rawPairwise.map(item => item.p));
  const comparisons = rawPairwise.map((item, index): SignificanceComparison => {
    const adjustedP = adjusted[index];
    return {
      groups: [item.labelA, item.labelB],
      pValue: item.p,
      adjustedPValue: adjustedP,
      pFormatted: formatP(item.p),
      adjustedPFormatted: formatP(adjustedP),
      stars: pToStars(adjustedP),
      label: `${pToStars(adjustedP)} (Holm p=${formatP(adjustedP)})`,
      significant: adjustedP < 0.05,
    };
  });

  const markdown = `# 单因素方差分析

因变量：${numericColumn.name}  
分组变量：${groupColumn.name}

| 组别 | N | 均值 | 标准差 |
| --- | ---: | ---: | ---: |
${groupRows.map(row => `| ${row.join(' | ')} |`).join('\n')}

| 来源 | SS | df | MS | F | p | eta² |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 组间 | ${formatNumber(ssBetween)} | ${dfBetween} | ${formatNumber(msBetween)} | ${formatNumber(f)} | ${formatP(p)} | ${formatNumber(etaSquared)} |
| 组内 | ${formatNumber(ssWithin)} | ${dfWithin} | ${formatNumber(msWithin)} |  |  |  |

## 事后比较（Welch t-test + Holm 校正）

| 组别 1 | 组别 2 | 原始 p | Holm 校正 p | 显著性 |
| --- | --- | ---: | ---: | --- |
${comparisons.map(item => `| ${escapePipe(item.groups[0])} | ${escapePipe(item.groups[1])} | ${item.pFormatted} | ${item.adjustedPFormatted} | ${item.stars} |`).join('\n')}

## 解释
${p < 0.05 ? `不同组别在 ${numericColumn.name} 上存在统计学显著差异；作图时应优先按照上方 Holm 校正后的事后比较结果标注具体组间差异。` : `不同组别在 ${numericColumn.name} 上未达到 0.05 水平的统计学显著差异；作图时不应标注显著组间差异，除非用户补充说明中明确给出。`}eta² 表示组别解释的总变异比例。`;

  return {
    title: '单因素方差分析',
    markdown,
    warnings: [],
    significance: {
      method: 'one-way ANOVA with pairwise Welch t-tests and Holm correction',
      responseVar: numericColumn.name,
      groupVar: groupColumn.name,
      statistic: 'F',
      statisticValue: f,
      df1: dfBetween,
      df2: dfWithin,
      pValue: p,
      pFormatted: formatP(p),
      stars: pToStars(p),
      significant: p < 0.05,
      label: `ANOVA ${pToLabel(p)}`,
      comparisons,
      note: 'For linked plots, annotate only the pairwise comparisons listed here, using adjustedPValue/adjustedPFormatted/stars. Do not invent unlisted comparisons.',
    },
  };
}

function analyzeCorrelation(dataset: ParsedDataset, varA: string, varB: string): AnalysisResult {
  const colA = selectNumericColumn(dataset, varA);
  const colB = selectNumericColumn(dataset, varB, [colA.name]);
  const pairs = pairedNumericValues(colA, colB);

  if (pairs.length < 3) {
    throw new Error('相关分析至少需要 3 对有效数值');
  }

  const x = pairs.map(pair => pair[0]);
  const y = pairs.map(pair => pair[1]);
  const pearson = pearsonCorrelation(x, y);
  const pearsonT = pearson * Math.sqrt((pairs.length - 2) / (1 - pearson * pearson));
  const pearsonP = twoTailedTPValue(pearsonT, pairs.length - 2);
  const spearman = pearsonCorrelation(rankValues(x), rankValues(y));
  const spearmanT = spearman * Math.sqrt((pairs.length - 2) / (1 - spearman * spearman));
  const spearmanP = twoTailedTPValue(spearmanT, pairs.length - 2);

  const markdown = `# 相关分析

变量 X：${colA.name}  
变量 Y：${colB.name}

| 方法 | N | r/rho | p |
| --- | ---: | ---: | ---: |
| Pearson | ${pairs.length} | ${formatNumber(pearson)} | ${formatP(pearsonP)} |
| Spearman | ${pairs.length} | ${formatNumber(spearman)} | ${formatP(spearmanP)} |

## 解释
Pearson 反映线性相关，Spearman 反映单调相关。${pearsonP < 0.05 ? `Pearson 相关达到统计学显著，说明两个变量之间可能存在线性关系。` : `Pearson 相关未达到统计学显著。`}相关不代表因果关系。`;

  return { title: '相关分析', markdown, warnings: [] };
}

function analyzeRegression(dataset: ParsedDataset, dependentVar: string, requestedPredictors: string[]): AnalysisResult {
  const dependentColumn = selectNumericColumn(dataset, dependentVar);
  const predictors = requestedPredictors.length > 0
    ? requestedPredictors.map(name => requireColumn(dataset, name, 'numeric'))
    : dataset.columns.filter(column => column.type === 'numeric' && column.name !== dependentColumn.name).slice(0, 1);

  if (predictors.length === 0) {
    throw new Error('线性回归至少需要一个数值型自变量');
  }

  const rows: { y: number; x: number[] }[] = [];
  for (let index = 0; index < dataset.rowCount; index += 1) {
    const y = toNumber(dependentColumn.values[index]);
    const x = predictors.map(column => toNumber(column.values[index]));
    if (Number.isFinite(y) && x.every(Number.isFinite)) rows.push({ y, x });
  }

  if (rows.length <= predictors.length + 1) {
    throw new Error('有效样本量不足，无法估计线性回归模型');
  }

  const regression = ordinaryLeastSquares(rows.map(row => row.x), rows.map(row => row.y));
  const coefficientRows = regression.coefficients.map((coefficient, index) => {
    const name = index === 0 ? 'Intercept' : predictors[index - 1].name;
    return `| ${escapePipe(name)} | ${formatNumber(coefficient)} | ${formatNumber(regression.standardErrors[index])} | ${formatNumber(regression.tValues[index])} | ${formatP(regression.pValues[index])} |`;
  }).join('\n');

  const markdown = `# 线性回归

因变量：${dependentColumn.name}  
自变量：${predictors.map(column => column.name).join(', ')}

| 指标 | 数值 |
| --- | ---: |
| 有效样本量 | ${rows.length} |
| R² | ${formatNumber(regression.rSquared)} |
| 调整 R² | ${formatNumber(regression.adjustedRSquared)} |
| F | ${formatNumber(regression.fStatistic)} |
| 模型 p | ${formatP(regression.modelPValue)} |

| 变量 | B | SE | t | p |
| --- | ---: | ---: | ---: | ---: |
${coefficientRows}

## 解释
${regression.modelPValue < 0.05 ? `整体回归模型达到统计学显著。` : `整体回归模型未达到 0.05 水平的统计学显著。`}系数 B 表示在其他自变量保持不变时，自变量每增加 1 个单位，因变量的预期变化量。`;

  return { title: '线性回归', markdown, warnings: [] };
}

function analyzeChiSquare(dataset: ParsedDataset, varA: string, varB: string): AnalysisResult {
  const colA = selectCategoricalColumn(dataset, varA);
  const colB = selectCategoricalColumn(dataset, varB, [colA.name]);
  const labelsA = uniqueCategories(colA.values);
  const labelsB = uniqueCategories(colB.values);

  if (labelsA.length < 2 || labelsB.length < 2) {
    throw new Error('卡方检验需要两个分类变量，且每个变量至少包含两个类别');
  }

  const table = labelsA.map(() => labelsB.map(() => 0));
  for (let index = 0; index < dataset.rowCount; index += 1) {
    if (isMissing(colA.values[index]) || isMissing(colB.values[index])) continue;
    const aIndex = labelsA.indexOf(formatCell(colA.values[index]));
    const bIndex = labelsB.indexOf(formatCell(colB.values[index]));
    if (aIndex >= 0 && bIndex >= 0) table[aIndex][bIndex] += 1;
  }

  const rowTotals = table.map(row => row.reduce((sum, value) => sum + value, 0));
  const colTotals = labelsB.map((_, colIndex) => table.reduce((sum, row) => sum + row[colIndex], 0));
  const total = rowTotals.reduce((sum, value) => sum + value, 0);
  let chiSquare = 0;
  for (let rowIndex = 0; rowIndex < labelsA.length; rowIndex += 1) {
    for (let colIndex = 0; colIndex < labelsB.length; colIndex += 1) {
      const expected = (rowTotals[rowIndex] * colTotals[colIndex]) / total;
      if (expected > 0) {
        chiSquare += Math.pow(table[rowIndex][colIndex] - expected, 2) / expected;
      }
    }
  }

  const df = (labelsA.length - 1) * (labelsB.length - 1);
  const p = chiSquarePValue(chiSquare, df);
  const cramersV = Math.sqrt(chiSquare / (total * Math.min(labelsA.length - 1, labelsB.length - 1)));
  const header = `| ${escapePipe(colA.name)} \\ ${escapePipe(colB.name)} | ${labelsB.map(escapePipe).join(' | ')} | 合计 |`;
  const divider = `| --- | ${labelsB.map(() => '---:').join(' | ')} | ---: |`;
  const rows = labelsA.map((label, index) => `| ${escapePipe(label)} | ${table[index].join(' | ')} | ${rowTotals[index]} |`).join('\n');

  const markdown = `# 卡方检验

变量 A：${colA.name}  
变量 B：${colB.name}

${header}
${divider}
${rows}
| 合计 | ${colTotals.join(' | ')} | ${total} |

| χ² | df | p | Cramer's V |
| ---: | ---: | ---: | ---: |
| ${formatNumber(chiSquare)} | ${df} | ${formatP(p)} | ${formatNumber(cramersV)} |

## 解释
${p < 0.05 ? `两个分类变量之间存在统计学显著关联。` : `两个分类变量之间未达到 0.05 水平的统计学显著关联。`}Cramer's V 用于描述关联强度。`;

  return { title: '卡方检验', markdown, warnings: [] };
}

function analyzeVisualization(dataset: ParsedDataset): AnalysisResult {
  const numericColumns = dataset.columns.filter(column => column.type === 'numeric');
  const categoricalColumns = dataset.columns.filter(column => column.type === 'categorical');
  const dateColumns = dataset.columns.filter(column => column.type === 'date');
  const suggestions: string[] = [];

  if (numericColumns.length >= 1) {
    suggestions.push(`直方图/密度图：查看 ${numericColumns[0].name} 的分布。`);
    suggestions.push(`箱线图：检查 ${numericColumns[0].name} 的异常值和分布偏态。`);
  }
  if (numericColumns.length >= 2) {
    suggestions.push(`散点图和相关矩阵：查看 ${numericColumns.slice(0, 4).map(column => column.name).join(', ')} 的关系。`);
  }
  if (numericColumns.length >= 1 && categoricalColumns.length >= 1) {
    suggestions.push(`分组箱线图/误差线图：比较 ${categoricalColumns[0].name} 不同组别的 ${numericColumns[0].name}。`);
  }
  if (dateColumns.length >= 1 && numericColumns.length >= 1) {
    suggestions.push(`折线图：展示 ${numericColumns[0].name} 随 ${dateColumns[0].name} 的变化趋势。`);
  }
  if (categoricalColumns.length >= 2) {
    suggestions.push(`堆叠柱状图/马赛克图：展示 ${categoricalColumns[0].name} 与 ${categoricalColumns[1].name} 的组成关系。`);
  }

  const markdown = `# 图表建议

数据集：${dataset.filename}，${dataset.rowCount} 行，${dataset.columnCount} 列。

## 变量概览

| 类型 | 变量 |
| --- | --- |
| 连续变量 | ${numericColumns.map(column => column.name).join(', ') || '无'} |
| 分类变量 | ${categoricalColumns.map(column => column.name).join(', ') || '无'} |
| 时间变量 | ${dateColumns.map(column => column.name).join(', ') || '无'} |

## 推荐图表

${suggestions.length > 0 ? suggestions.map(item => `- ${item}`).join('\n') : '- 当前数据类型不足以自动推荐图表，请检查字段类型。'}

## 下一步
如果要生成可投稿风格图表，可以继续使用“R语言作图”入口，并选择对应图表类型和科研论文主题。`;

  return { title: '图表建议', markdown, warnings: [] };
}

function getAnalysisMethodDisplayName(method: AnalysisMethod): string {
  const names: Record<AnalysisMethod, string> = {
    descriptive: '描述性统计',
    independent_t: '独立样本 t 检验',
    paired_t: '配对样本 t 检验',
    anova: '单因素方差分析',
    correlation: '相关分析',
    regression: '线性回归',
    chi_square: '卡方检验',
    visualization: '图表建议',
    normality: '正态性检验',
    variance_homogeneity: '方差齐性检验',
    nonparametric: '非参数检验',
    two_way_anova: '双因素方差分析',
    pca: '主成分分析 PCA',
    cluster: '聚类分析',
    mixed_effects: '混合效应模型',
    survival: '生存分析',
  };
  return names[method] || method;
}

function analyzeRCodeOnlyMethod(
  dataset: ParsedDataset,
  method: AnalysisMethod,
  options: {
    numericVar: string;
    numericVar2: string;
    groupVar: string;
    categoryVar: string;
    categoryVar2: string;
    dependentVar: string;
    predictorVars: string[];
  }
): AnalysisResult {
  const numericColumns = dataset.columns.filter(column => column.type === 'numeric').map(column => column.name);
  const categoricalColumns = dataset.columns.filter(column => column.type === 'categorical').map(column => column.name);
  const name = getAnalysisMethodDisplayName(method);
  const variableHint = [
    options.numericVar ? `数值变量：${options.numericVar}` : '',
    options.numericVar2 ? `第二数值变量：${options.numericVar2}` : '',
    options.groupVar ? `分组变量：${options.groupVar}` : '',
    options.categoryVar ? `分类变量 A：${options.categoryVar}` : '',
    options.categoryVar2 ? `分类变量 B：${options.categoryVar2}` : '',
    options.dependentVar ? `因变量：${options.dependentVar}` : '',
    options.predictorVars.length ? `自变量：${options.predictorVars.join(', ')}` : '',
  ].filter(Boolean).join('  \n') || '未指定变量，将由 R 代码根据字段类型自动选择。';
  const methodInstructions: Record<string, string> = {
    normality: '在 R 代码中对选定数值变量执行 Shapiro-Wilk 检验、QQ 图和密度图；样本量过大时可抽样或改用视觉诊断。',
    variance_homogeneity: '在 R 代码中对分组比较执行 Levene 检验或 Bartlett 检验，并输出方差齐性诊断。',
    nonparametric: '在 R 代码中根据组数自动选择 Mann-Whitney U / Wilcoxon signed-rank / Kruskal-Wallis 检验，并输出真实 p 值。',
    two_way_anova: '在 R 代码中需要两个分类自变量，拟合双因素 ANOVA 和交互作用；如果数据缺少第二分组变量，应在代码注释中提示用户补充。',
    pca: '在 R 代码中对多个数值变量标准化后执行 PCA，输出碎石图、载荷图和样本得分图。',
    cluster: '在 R 代码中对多个数值变量标准化后执行层次聚类或 K-means，并输出聚类图。',
    mixed_effects: '在 R 代码中使用 lme4/lmerTest 拟合混合效应模型；如果没有随机效应字段，应预留 random_effect_col 并提示用户填写。',
    survival: '在 R 代码中使用 survival/survminer 生成 Kaplan-Meier 或 Cox 模型；如果没有时间/结局字段，应预留 time_col/event_col 并提示用户填写。',
  };
  const markdown = `# ${name}

该方法已加入后续 R 代码生成清单，但当前本地统计引擎暂不直接计算该方法的最终检验表。

## 变量建议
${variableHint}

## 可用字段概览
- 连续变量：${numericColumns.join(', ') || '无'}
- 分类变量：${categoricalColumns.join(', ') || '无'}

## R 代码生成要求
${methodInstructions[method] || '请在 R 代码中生成对应分析。'}

## 显著性规则
该方法当前没有本地计算出的结构化显著性结果。生成作图代码时不得编造显著性；如用户未补充真实显著性，请不要在图中标注 x、xx、xxx、星号、p 值或 abc 字母占位，只能在代码注释中说明没有真实显著性结果。`;

  return {
    title: name,
    markdown,
    warnings: [`${name} 当前作为 R 代码生成项处理，本地分析结果不提供真实 p 值。`],
  };
}

function selectNumericColumn(dataset: ParsedDataset, preferredName: string, excludeNames: string[] = []): DataColumn {
  if (preferredName) return requireColumn(dataset, preferredName, 'numeric');
  const column = dataset.columns.find(item => item.type === 'numeric' && !excludeNames.includes(item.name));
  if (!column) throw new Error('没有可用的数值变量');
  return column;
}

function selectCategoricalColumn(dataset: ParsedDataset, preferredName: string, excludeNames: string[] = []): DataColumn {
  if (preferredName) return requireColumn(dataset, preferredName, 'categorical');
  const column = dataset.columns.find(item => item.type === 'categorical' && !excludeNames.includes(item.name));
  if (!column) throw new Error('没有可用的分类变量');
  return column;
}

function requireColumn(dataset: ParsedDataset, name: string, expectedType?: VariableType): DataColumn {
  const column = dataset.columns.find(item => item.name === name);
  if (!column) throw new Error(`找不到变量：${name}`);
  if (expectedType && column.type !== expectedType) {
    throw new Error(`变量 ${name} 不是${expectedType === 'numeric' ? '数值' : '分类'}变量`);
  }
  return column;
}

function getNumericValues(column: DataColumn): number[] {
  return column.values.map(toNumber).filter(Number.isFinite);
}

function groupNumericValues(numericColumn: DataColumn, groupColumn: DataColumn): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (let index = 0; index < numericColumn.values.length; index += 1) {
    const value = toNumber(numericColumn.values[index]);
    if (!Number.isFinite(value) || isMissing(groupColumn.values[index])) continue;
    const label = formatCell(groupColumn.values[index]);
    if (!grouped.has(label)) grouped.set(label, []);
    grouped.get(label)?.push(value);
  }
  return grouped;
}

function pairedNumericValues(colA: DataColumn, colB: DataColumn): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let index = 0; index < colA.values.length; index += 1) {
    const a = toNumber(colA.values[index]);
    const b = toNumber(colB.values[index]);
    if (Number.isFinite(a) && Number.isFinite(b)) pairs.push([a, b]);
  }
  return pairs;
}

function describeNumbers(values: number[]): {
  count: number;
  mean: number;
  variance: number;
  sd: number;
  median: number;
  q1: number;
  q3: number;
  min: number;
  max: number;
} {
  if (values.length === 0) {
    return { count: 0, mean: NaN, variance: NaN, sd: NaN, median: NaN, q1: NaN, q3: NaN, min: NaN, max: NaN };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const valueMean = mean(values);
  const varianceValue = values.length > 1
    ? values.reduce((sum, value) => sum + Math.pow(value - valueMean, 2), 0) / (values.length - 1)
    : 0;

  return {
    count: values.length,
    mean: valueMean,
    variance: varianceValue,
    sd: Math.sqrt(varianceValue),
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

function countCategories(values: unknown[]): Array<{ label: string; count: number; percent: number }> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const value of values) {
    if (isMissing(value)) continue;
    const label = formatCell(value);
    counts.set(label, (counts.get(label) || 0) + 1);
    total += 1;
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, percent: total > 0 ? (count / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}

function uniqueCategories(values: unknown[]): string[] {
  return Array.from(new Set(values.filter(value => !isMissing(value)).map(formatCell))).slice(0, 30);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantile(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 0) return NaN;
  const position = (sortedValues.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const xMean = mean(x);
  const yMean = mean(y);
  let numerator = 0;
  let xDenominator = 0;
  let yDenominator = 0;
  for (let index = 0; index < x.length; index += 1) {
    const xCentered = x[index] - xMean;
    const yCentered = y[index] - yMean;
    numerator += xCentered * yCentered;
    xDenominator += xCentered * xCentered;
    yDenominator += yCentered * yCentered;
  }
  return numerator / Math.sqrt(xDenominator * yDenominator);
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let cursor = 0;
  while (cursor < indexed.length) {
    let end = cursor;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[cursor].value) end += 1;
    const rank = (cursor + end + 2) / 2;
    for (let index = cursor; index <= end; index += 1) {
      ranks[indexed[index].index] = rank;
    }
    cursor = end + 1;
  }
  return ranks;
}

function ordinaryLeastSquares(xRows: number[][], y: number[]): {
  coefficients: number[];
  standardErrors: number[];
  tValues: number[];
  pValues: number[];
  rSquared: number;
  adjustedRSquared: number;
  fStatistic: number;
  modelPValue: number;
} {
  const design = xRows.map(row => [1, ...row]);
  const xt = transpose(design);
  const xtx = multiplyMatrices(xt, design);
  const xtxInv = invertMatrix(xtx);
  const xty = multiplyMatrixVector(xt, y);
  const coefficients = multiplyMatrixVector(xtxInv, xty);
  const fitted = design.map(row => dot(row, coefficients));
  const yMean = mean(y);
  const sse = y.reduce((sum, value, index) => sum + Math.pow(value - fitted[index], 2), 0);
  const sst = y.reduce((sum, value) => sum + Math.pow(value - yMean, 2), 0);
  const ssr = sst - sse;
  const n = y.length;
  const p = coefficients.length - 1;
  const dfResidual = n - p - 1;
  const mse = sse / dfResidual;
  const standardErrors = coefficients.map((_, index) => Math.sqrt(mse * xtxInv[index][index]));
  const tValues = coefficients.map((coefficient, index) => coefficient / standardErrors[index]);
  const pValues = tValues.map(t => twoTailedTPValue(t, dfResidual));
  const rSquared = sst > 0 ? 1 - (sse / sst) : 0;
  const adjustedRSquared = 1 - ((1 - rSquared) * (n - 1) / dfResidual);
  const fStatistic = (ssr / p) / mse;
  const modelPValue = fPValue(fStatistic, p, dfResidual);

  return { coefficients, standardErrors, tValues, pValues, rSquared, adjustedRSquared, fStatistic, modelPValue };
}

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
}

function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  return a.map(row => transpose(b).map(col => dot(row, col)));
}

function multiplyMatrixVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map(row => dot(row, vector));
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, value, index) => sum + value * b[index], 0);
}

function invertMatrix(matrix: number[][]): number[][] {
  const size = matrix.length;
  const augmented = matrix.map((row, rowIndex) => [
    ...row,
    ...Array.from({ length: size }, (_, colIndex) => rowIndex === colIndex ? 1 : 0),
  ]);

  for (let col = 0; col < size; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) pivotRow = row;
    }
    if (Math.abs(augmented[pivotRow][col]) < 1e-12) {
      throw new Error('回归自变量之间可能存在完全共线性，无法估计模型');
    }
    [augmented[col], augmented[pivotRow]] = [augmented[pivotRow], augmented[col]];
    const pivot = augmented[col][col];
    for (let j = 0; j < size * 2; j += 1) augmented[col][j] /= pivot;
    for (let row = 0; row < size; row += 1) {
      if (row === col) continue;
      const factor = augmented[row][col];
      for (let j = 0; j < size * 2; j += 1) augmented[row][j] -= factor * augmented[col][j];
    }
  }

  return augmented.map(row => row.slice(size));
}

function normalizeMethod(value: unknown): AnalysisMethod {
  const method = readBodyString(value) as AnalysisMethod;
  const allowed: AnalysisMethod[] = getAllowedAnalysisMethods();
  return allowed.includes(method) ? method : 'descriptive';
}

function getAllowedAnalysisMethods(): AnalysisMethod[] {
  return [
    'descriptive',
    'independent_t',
    'paired_t',
    'anova',
    'correlation',
    'regression',
    'chi_square',
    'normality',
    'variance_homogeneity',
    'nonparametric',
    'two_way_anova',
    'pca',
    'cluster',
    'mixed_effects',
    'survival',
    'visualization',
  ];
}

function normalizeMethods(value: unknown): AnalysisMethod[] {
  const rawValues = Array.isArray(value)
    ? value
    : (() => {
        const raw = readBodyString(value);
        if (!raw) return [];
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (Array.isArray(parsed)) return parsed;
        } catch {
          // Fall through to comma-separated parsing.
        }
        return raw.split(/[,;，；]/);
      })();
  const allowed = getAllowedAnalysisMethods();
  const normalized = rawValues
    .map(item => String(item || '').trim() as AnalysisMethod)
    .filter(method => allowed.includes(method));
  return Array.from(new Set(normalized)).slice(0, 8);
}

function readBodyString(value: unknown): string {
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return typeof value === 'string' ? value.trim() : '';
}

function cleanDataAnalysisExtraQuery(value: unknown): string {
  return readBodyString(value)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .slice(0, 5000);
}

function readPredictorVars(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  const raw = readBodyString(value);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(item => String(item).trim()).filter(Boolean);
  } catch {
    // Fall through to comma-separated parsing.
  }
  return raw.split(',').map(item => item.trim()).filter(Boolean);
}

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  const text = String(value).trim();
  return text === '' || /^(na|n\/a|null|nan|\.)$/i.test(text);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value instanceof Date) return NaN;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return NaN;
  const normalized = text.endsWith('%') ? text.slice(0, -1) : text;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatCell(value: unknown): string {
  if (isMissing(value)) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') return formatNumber(value);
  return String(value).trim();
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 0.001 || abs >= 100000)) return value.toExponential(3);
  return Number(value.toFixed(4)).toString();
}

function formatP(value: number): string {
  if (!Number.isFinite(value)) return '';
  return value < 0.001 ? '<0.001' : Number(value.toFixed(4)).toString();
}

function escapePipe(value: string): string {
  return String(value).replace(/\|/g, '\\|');
}

function appendWarnings(markdown: string, warnings: string[]): string {
  if (warnings.length === 0) return markdown;
  return `${markdown}\n\n## 注意\n${warnings.map(warning => `- ${warning}`).join('\n')}`;
}

function twoTailedTPValue(t: number, df: number): number {
  if (!Number.isFinite(t) || !Number.isFinite(df) || df <= 0) return NaN;
  const x = df / (df + t * t);
  const ib = regularizedBeta(x, df / 2, 0.5);
  return Math.min(1, Math.max(0, ib));
}

function fPValue(f: number, df1: number, df2: number): number {
  if (!Number.isFinite(f) || f < 0 || df1 <= 0 || df2 <= 0) return NaN;
  const x = (df1 * f) / (df1 * f + df2);
  return 1 - regularizedBeta(x, df1 / 2, df2 / 2);
}

function chiSquarePValue(chiSquare: number, df: number): number {
  if (!Number.isFinite(chiSquare) || chiSquare < 0 || df <= 0) return NaN;
  return regularizedGammaQ(df / 2, chiSquare / 2);
}

function logGamma(z: number): number {
  const coefficients = [
    676.5203681218851,
    -1259.1392167224028,
    771.3234287776531,
    -176.6150291621406,
    12.507343278686905,
    -0.13857109526572012,
    9.984369578019572e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) {
    return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  }
  let x = 0.9999999999998099;
  const shifted = z - 1;
  for (let index = 0; index < coefficients.length; index += 1) {
    x += coefficients[index] / (shifted + index + 1);
  }
  const t = shifted + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x);
}

function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) {
    return bt * betaContinuedFraction(x, a, b) / a;
  }
  return 1 - bt * betaContinuedFraction(1 - x, b, a) / b;
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const maxIterations = 200;
  const epsilon = 3e-7;
  const fpMin = 1e-30;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - qab * x / qap;
  if (Math.abs(d) < fpMin) d = fpMin;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= maxIterations; m += 1) {
    const m2 = 2 * m;
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    h *= d * c;
    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = 1 + aa / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) break;
    qab = a + b;
    qap = a + 1;
    qam = a - 1;
  }
  return h;
}

function regularizedGammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  if (x < a + 1) return 1 - regularizedGammaPSeries(a, x);
  return regularizedGammaQContinuedFraction(a, x);
}

function regularizedGammaPSeries(a: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 1e-8;
  let sum = 1 / a;
  let del = sum;
  let ap = a;
  for (let n = 1; n <= maxIterations; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * epsilon) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function regularizedGammaQContinuedFraction(a: number, x: number): number {
  const maxIterations = 200;
  const epsilon = 1e-8;
  const fpMin = 1e-30;
  let b = x + 1 - a;
  let c = 1 / fpMin;
  let d = 1 / b;
  let h = d;

  for (let i = 1; i <= maxIterations; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < fpMin) d = fpMin;
    c = b + an / c;
    if (Math.abs(c) < fpMin) c = fpMin;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < epsilon) break;
  }

  return Math.exp(-x + a * Math.log(x) - logGamma(a)) * h;
}

async function recordDataAnalysisResearchProvenance(input: {
  userId: string;
  researchSessionId?: string;
  datasetSummary: unknown;
  methods: string[];
  options: Record<string, unknown>;
  result: AnalysisResult;
  extraQuery?: string;
  memoryUpdate: unknown;
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactId: string }> {
  const dataset = input.datasetSummary as {
    filename?: string;
    sheetName?: string;
    rowCount?: number;
    columnCount?: number;
    columns?: Array<{ name?: string; type?: string }>;
  };
  const dataRef = {
    label: dataset.filename || 'uploaded dataset',
    sheetName: dataset.sheetName,
    columns: Array.isArray(dataset.columns)
      ? dataset.columns.map(column => String(column.name || '')).filter(Boolean)
      : undefined,
    rowCount: typeof dataset.rowCount === 'number' ? dataset.rowCount : undefined,
    statistic: input.result.significance?.method || input.methods.join(', '),
    pValue: input.result.significance?.pValue,
    metadata: {
      columnCount: dataset.columnCount,
      significance: input.result.significance,
    },
  };
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.researchSessionId,
    sessionTitle: dataset.filename ? `数据分析：${dataset.filename}` : '数据分析科研会话',
    targetType: 'data-analysis',
    targetId: dataset.filename || `data-analysis-${Date.now()}`,
    operation: 'data-analysis.analyze',
    sourceModule: 'data-analysis',
    input: {
      dataset: input.datasetSummary,
      methods: input.methods,
      options: input.options,
      extraQuery: input.extraQuery,
    },
    output: {
      title: input.result.title,
      markdown: input.result.markdown,
      warnings: input.result.warnings,
      significance: input.result.significance,
      memoryUpdate: input.memoryUpdate,
    },
    dataRefs: [dataRef],
    metadata: {
      memoryUpdate: input.memoryUpdate,
      warningCount: input.result.warnings.length,
    },
  });
  const artifact = await researchSessionManager.appendArtifact({
    userId: input.userId,
    sessionId: provenance.session.id,
    kind: 'data-analysis',
    name: input.result.title || dataRef.label,
    content: input.result.markdown,
    contentType: 'text/markdown',
    input: {
      dataset: input.datasetSummary,
      methods: input.methods,
      options: input.options,
    },
    provenanceRecordIds: [provenance.record.id],
    metadata: {
      warningCount: input.result.warnings.length,
      pValue: input.result.significance?.pValue,
    },
  });
  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
    artifactId: artifact.artifact.id,
  };
}

export default router;
