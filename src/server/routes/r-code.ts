/**
 * R 代码生成路由
 * 用户上传 Excel 文件 → AI 分析数据结构 → 生成 R 作图代码
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { createWriteStream, existsSync } from 'fs';
import * as http from 'http';
import * as https from 'https';
import { Router } from 'express';
import archiver from 'archiver';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { getDataDir, sanitizeUserId } from '../../utils/paths';

const router = Router();

// 动态加载 xlsx，避免打包后模块缺失导致服务器启动失败
let XLSX: typeof import('xlsx') | null = null;
async function getXLSX(): Promise<typeof import('xlsx')> {
  if (!XLSX) {
    XLSX = await import('xlsx');
  }
  return XLSX;
}

// 内存存储，用于处理文件
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB 限制
  fileFilter: (req, file, cb) => {
    const allowedExtensions = ['.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件格式: ${ext}。仅支持 Excel (.xlsx, .xls) 和 CSV 文件。`));
    }
  },
});

/**
 * R 作图主题样式模板（用户提供的自定义主题）
 */
const R_THEME_TEMPLATE = `
# 自定义作图主题
font_family <- "serif"
if (.Platform$OS.type == "windows") {
  try(windowsFonts(serif = windowsFont("TT Times New Roman")), silent = TRUE)
}

new_theme1 <- theme_bw() +
  theme(panel.grid = element_blank())+
  theme(panel.border = element_rect(colour = "black",fill = NA,linewidth = 0.5))+
  theme(text = element_text(family = font_family),
        axis.text.x = element_text(size=14,color='black', family = font_family),
        axis.text.y  = element_text(size=14,color='black', family = font_family),
        axis.title=element_text(size=14,color='black',family = font_family),
        legend.position = c(0.98, 0.98),
        legend.justification = c(1, 1),
        legend.background = element_rect(fill = rgb(1, 1, 1, 0.78), colour = NA))
`;

const ACTIVE_R_THEME_NAME = 'new_theme1';
const DATA_PREVIEW_ROW_LIMIT = 30;
const R_ARTIFACT_EXTENSIONS = new Set(['.r', '.png', '.pdf', '.svg', '.jpg', '.jpeg', '.tif', '.tiff', '.csv', '.txt', '.md']);
const R_EXPORT_IMAGE_EXTENSIONS = new Set(['.png', '.pdf', '.svg', '.jpg', '.jpeg', '.tif', '.tiff']);

const R_FONT_GUIDE = `
## 字体硬性规则

- 图中所有英文字母和数字必须使用 Times New Roman，新罗马字体。
- R 代码中必须设置统一字体变量，例如 \`font_family <- "serif"\`，并在 \`theme(text = element_text(family = font_family), axis.text = ..., axis.title = ..., legend.text = ..., legend.title = ...)\` 中应用。
- Windows 环境建议加入 \`try(windowsFonts(serif = windowsFont("TT Times New Roman")), silent = TRUE)\`，让 Rscript 使用系统 Times New Roman 映射，同时避免 PDF/PNG 设备报 \`invalid font type\`。
- 坐标轴数字、刻度标签、图例、显著性标注、标题、分面标签中的英文和数字都要继承 Times New Roman；不要使用默认 sans、Arial 或仅写 \`family = "serif"\`。
`.trim();

const R_LEGEND_PLACEMENT_GUIDE = `
## 图例位置硬性规则

- 需要图例时，图例只能放在图内左上角或右上角，或在图外顶部/右侧；不要把图例放在图中间或数据最密集区域。
- 如果图例放在图内，必须根据数据分布选择左上角或右上角：优先选择上方数据点/柱/线更少的一侧。
- 推荐写法：右上角使用 \`theme(legend.position = c(0.98, 0.98), legend.justification = c(1, 1))\`；左上角使用 \`theme(legend.position = c(0.02, 0.98), legend.justification = c(0, 1))\`。
- 不允许使用 \`legend.position = c(0.5, 0.5)\`、\`legend.position = "center"\` 或其他会让图例遮挡主体数据的设置。
- 如果数据非常密集，优先把图例放到图外顶部或右侧，而不是放进图中间。
`.trim();

const R_DATE_AXIS_GUIDE = `
## 日期/时间坐标轴硬性规则

- 如果横坐标是日期、时间、年份、月份、采样日期或形如 \`YYYY-MM-DD\`、\`YYYY/MM/DD\`、Excel 日期序列的字段，必须先把该列转换为 \`Date\` 或 \`POSIXct\`，不要把日期当作普通字符或离散分类变量。
- 日期列转换需兼容常见格式：\`%Y-%m-%d\`、\`%Y/%m/%d\`、\`%Y.%m.%d\`、\`%Y-%m\`、\`%Y/%m\`、\`%Y\`；如果是 Excel 数字日期，使用 \`as.Date(x, origin = "1899-12-30")\`。
- 日期横坐标不能显示每一个日期标签。必须根据时间跨度设置合适的 breaks 和 labels：跨度小于 45 天可按 1 周或 2 周；小于 18 个月可按 1 月或 2 月；多年数据按 6 个月或 1 年；十年以上按 2 年或 5 年。
- 使用 \`scale_x_date(date_breaks = "...", date_labels = "...")\` 或 \`scale_x_datetime(...)\` 控制日期显示，并用 \`guide_axis(check.overlap = TRUE)\`、\`theme(axis.text.x = element_text(angle = 30, hjust = 1))\` 避免标签重叠。
- 日期趋势图优先使用连续时间轴，不要用 \`factor(date)\` 或 \`scale_x_discrete()\` 把所有日期逐个展开。
`.trim();

const rExecuteSchema = z.object({
  userId: z.string().optional(),
  rCode: z.string().min(1).max(2_000_000),
  filename: z.string().optional(),
  dataFilename: z.string().optional(),
  timeoutMs: z.coerce.number().int().min(10_000).max(600_000).optional(),
});

const rscriptPathSchema = z.object({
  rscriptPath: z.string().min(1).max(1000),
});

interface RscriptStatus {
  available: boolean;
  path: string;
  version?: string;
  error?: string;
}

interface RProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface RArtifact {
  name: string;
  relativePath: string;
  size: number;
  url: string;
  kind?: 'image' | 'code' | 'data' | 'text';
  absolutePath?: string;
}

interface RExportedFile {
  name: string;
  path: string;
  size: number;
}

interface RPluginConfig {
  rscriptPath?: string;
  installDir?: string;
  packageInstallAt?: string;
  updatedAt?: string;
}

interface RInstallJob {
  id: string;
  status: 'running' | 'complete' | 'failed';
  stage: string;
  progress: number;
  message: string;
  startedAt: string;
  updatedAt: string;
  error?: string;
  downloadUrl?: string;
  installDir?: string;
  rscriptPath?: string;
  stdout?: string;
  stderr?: string;
}

let currentRInstallJob: RInstallJob | null = null;

const NATURE_R_FIGURE_SKILL = `
## Nature-skill：Nature 风格科研图形约束

用户选择了 Nature 期刊风格。生成 R 作图代码时，请把以下要求融入图形设计，而不是只替换主题函数：

1. 图形必须服务于一个清晰的科学结论，避免无信息装饰、3D 效果、阴影、过度网格和冗余标题。
2. 坐标轴标题必须包含变量名和单位；分类标签要短、可读，必要时使用换行或旋转，但不要让标签重叠；英文字母和数字统一使用 Times New Roman。
3. 配色优先使用色盲友好的离散色板，例如 Okabe-Ito；不要使用彩虹色板。若使用分组颜色，请在代码中定义并应用 \`nature_palette\`。
4. 优先展示不确定性和统计信息，例如 SE/CI 误差线、置信带或显著性标注；不要编造 p 值、样本量或统计检验结果。
5. 多面板图只在确有必要时使用；如使用，请采用 a, b, c 形式的 panel labels，并保持各面板尺度和图例一致。
6. 图例应简洁并靠近数据含义；能直接标注时可减少图例依赖。若需要图例，必须按数据分布放在图内左上角或右上角，或放在图外顶部/右侧，禁止放在图中间遮挡数据。
7. 导出应适合投稿：优先保存矢量 PDF，同时保存高分辨率 PNG；PNG 使用 \`dpi = 600\`，宽高按图形复杂度合理设置。
8. 所有 ggplot 对象都必须追加 \`+ ${ACTIVE_R_THEME_NAME}\`，并在需要时追加 Nature 风格的 scale、legend、axis 和 save 设置。
`;

function normalizeThemeCode(themeCode?: string): string {
  const code = themeCode?.trim() || R_THEME_TEMPLATE.trim();
  if (!/\bnew_theme1\s*<-/.test(code) && /\bnew_theme\s*<-/.test(code)) {
    return `${code}

# 兼容旧主题变量名，后续绘图统一使用 new_theme1
new_theme1 <- new_theme`;
  }
  return code;
}

function enforceLegendPlacement(rCode: string): string {
  return rCode
    .replace(/legend\.position\s*=\s*c\(\s*0\.5\s*,\s*0\.5\s*\)/gi, 'legend.position = c(0.98, 0.98), legend.justification = c(1, 1)')
    .replace(/legend\.position\s*=\s*["']center["']/gi, 'legend.position = c(0.98, 0.98), legend.justification = c(1, 1)')
    .replace(/legend\.position\s*=\s*c\(\s*\.5\s*,\s*\.5\s*\)/gi, 'legend.position = c(0.98, 0.98), legend.justification = c(1, 1)');
}

function enforceRCodeGuardrails(rCode: string): string {
  const legendSafe = enforceLegendPlacement(rCode)
    .replace(/base_family\s*=\s*["']Arial["']/gi, 'base_family = "Times New Roman"')
    .replace(/family\s*=\s*["']Arial["']/gi, 'family = font_family')
    .replace(/family\s*=\s*["']sans["']/gi, 'family = font_family')
    .replace(/family\s*=\s*["']serif["']/gi, 'family = font_family');
  const withFont = /\bfont_family\s*<-/.test(legendSafe)
    ? legendSafe
    : `font_family <- "serif"
if (.Platform$OS.type == "windows") {
  try(windowsFonts(serif = windowsFont("TT Times New Roman")), silent = TRUE)
}

${legendSafe}`;
  if (/scale_x_discrete\s*\(/i.test(withFont) && /(date|time|year|month|日期|时间|年份|月份)/i.test(withFont)) {
    return `${withFont}

# Scholar Harness 日期轴检查提示：
# 当前代码中出现 scale_x_discrete() 且脚本疑似包含日期/时间字段。
# 如果横坐标是日期，请改用 Date/POSIXct 连续时间轴，并使用 scale_x_date()
# 或 scale_x_datetime(date_breaks = ..., date_labels = ...) 控制标签密度，
# 避免把所有日期逐个显示导致重叠。
`;
  }
  return withFont;
}

function getThemeDisplayName(themeId?: string): string {
  switch (themeId) {
    case 'paper_clean':
      return '科研论文简洁风格';
    case 'paper_grid':
      return '科研论文网格风格';
    case 'nature':
      return 'Nature 期刊风格（启用 Nature-skill）';
    case 'minimal':
      return '极简风格';
    case 'custom':
      return '用户自定义主题';
    default:
      return '未指定，使用默认科研论文简洁风格';
  }
}

function buildThemeSkillSection(themeId?: string): string {
  return themeId === 'nature' ? NATURE_R_FIGURE_SKILL.trim() : '';
}

/**
 * 解析 Excel/CSV 文件，提取数据结构信息
 */
async function parseExcelStructure(buffer: Buffer, filename: string): Promise<{
  columns: Array<{ name: string; type: string; sampleValues: string[] }>;
  rowCount: number;
  previewData: string;
  previewRowCount: number;
  sheetNames?: string[];
}> {
  const xlsx = await getXLSX();
  const ext = path.extname(filename).toLowerCase();
  let workbook: import('xlsx').WorkBook;

  if (ext === '.csv') {
    // CSV 文件
    workbook = xlsx.read(buffer, { type: 'buffer' });
  } else {
    // Excel 文件
    workbook = xlsx.read(buffer, { type: 'buffer' });
  }

  const sheetNames = workbook.SheetNames;
  const firstSheet = workbook.Sheets[sheetNames[0]];
  const jsonData = xlsx.utils.sheet_to_json(firstSheet, { header: 1 }) as unknown[][];

  if (jsonData.length === 0) {
    throw new Error('文件为空，无法解析数据结构');
  }

  // 获取列名（假设第一行是列名）
  const headers = jsonData[0] as string[];
  const dataRows = jsonData.slice(1) as unknown[][];

  // 分析每列的数据类型和样本值
  const columns = headers.map((header, colIndex) => {
    const columnValues = dataRows.slice(0, 5).map(row => row[colIndex]);
    const sampleValues = columnValues.map(v => {
      if (v === null || v === undefined) return 'NA';
      if (typeof v === 'number') return String(v);
      if (typeof v === 'string') return v.length > 30 ? v.substring(0, 30) + '...' : v;
      return String(v);
    });

    // 推断数据类型
    let type = 'unknown';
    const nonEmptyValues = columnValues.filter(v => v !== null && v !== undefined && v !== '');
    if (nonEmptyValues.length > 0) {
      if (nonEmptyValues.every(v => typeof v === 'number' || !isNaN(Number(v)))) {
        type = 'numeric';
      } else if (nonEmptyValues.every(v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v))) {
        type = 'date';
      } else if (nonEmptyValues.every(v => typeof v === 'string' && /^[A-Za-z]+$/.test(v))) {
        type = 'character';
      } else {
        type = 'character';
      }
    }

    return {
      name: header || `Column_${colIndex + 1}`,
      type,
      sampleValues,
    };
  });

  // 生成预览数据文本
  const previewRows = jsonData.slice(0, DATA_PREVIEW_ROW_LIMIT);
  const previewLines = previewRows.map(row => 
    row.map(cell => cell === null || cell === undefined ? 'NA' : String(cell)).join('\t')
  );
  const previewData = previewLines.join('\n');

  return {
    columns,
    rowCount: dataRows.length,
    previewData,
    previewRowCount: previewRows.length,
    sheetNames,
  };
}

interface ExcelStructure {
  columns: Array<{ name: string; type: string; sampleValues: string[] }>;
  rowCount: number;
  previewData: string;
  previewRowCount?: number;
  sheetNames?: string[];
}

interface DataAnalysisRContext {
  linkedFromDataAnalysis?: boolean;
  analysisResult?: string;
  analysisSelections?: string;
  analysisSignificance?: string;
}

/**
 * 构建 AI 提示词
 */
function buildRCodePrompt(
  dataStructure: ExcelStructure,
  chartType: string,
  analysisType: string,
  customRequirements?: string,
  workDir?: string,
  dataFilename?: string,
  themeCode?: string,
  themeId?: string,
  dataAnalysisContext?: DataAnalysisRContext
): string {
  const columnInfo = dataStructure.columns.map(col => 
    `- **${col.name}**: 类型=${col.type}, 样本值=[${col.sampleValues.join(', ')}]`
  ).join('\n');

  // 判断文件类型（Excel 或 CSV）
  const effectiveDataFilename = dataFilename || 'data.xlsx';
  const fileExt = effectiveDataFilename.toLowerCase().endsWith('.csv') ? 'csv' : 'xlsx';
  const readFunction = fileExt === 'csv' 
    ? 'read.csv("data.csv", header = TRUE)'
    : 'read_excel("data.xlsx")';

  // 构建工作目录部分
  const workDirSection = workDir 
    ? `
# --------------------------------------------
# 工作目录设置
# --------------------------------------------
getwd()
setwd('${workDir.replace(/\\/g, '/')}')
getwd()
`
    : '';

  // 构建主题部分
  const normalizedThemeCode = normalizeThemeCode(themeCode);
  const themeSection = `
# --------------------------------------------
# 自定义作图主题
# --------------------------------------------
${normalizedThemeCode}
`;
  const themeSkillSection = buildThemeSkillSection(themeId);
  const linkedAnalysisSection = buildLinkedDataAnalysisPromptSection(dataAnalysisContext);

  return `你是一个专业的 R 语言数据可视化专家。请根据用户提供的数据结构和作图需求，生成完整的、可直接运行的 R 语言作图代码。

## 数据结构信息

**文件包含 ${dataStructure.rowCount} 行数据，以下列：**

${columnInfo}

**数据预览（前 ${dataStructure.previewRowCount || DATA_PREVIEW_ROW_LIMIT} 行，包含表头）：**
\`\`\`
${dataStructure.previewData}
\`\`\`

${linkedAnalysisSection}

## 用户配置

**工作目录**: ${workDir || '不设置（使用当前目录）'}
**数据文件名**: ${effectiveDataFilename}
**图表类型**: ${chartType}
**分析类型**: ${analysisType}
**作图主题**: ${getThemeDisplayName(themeId)}
**额外要求**: ${customRequirements || '无特殊要求'}

${themeSkillSection ? `${themeSkillSection}
` : ''}

${R_FONT_GUIDE}

${R_LEGEND_PLACEMENT_GUIDE}

${R_DATE_AXIS_GUIDE}

## 必须包含的代码结构

代码必须按照以下结构生成：

\`\`\`r
${workDirSection}
# --------------------------------------------
# 1. 加载必要的包
# --------------------------------------------
library(ggplot2)
${fileExt === 'xlsx' ? 'library(readxl)' : '# CSV不需要额外包'}

# --------------------------------------------
# 2. 数据读取
# --------------------------------------------
# 从文件读取数据
data <- ${readFunction.replace(/"data\.(xlsx|csv)"/, `"${effectiveDataFilename}"`)}

# 查看数据结构
head(data)
str(data)

${themeSection}

# --------------------------------------------
# 3. 数据预处理（如果需要）
# --------------------------------------------
# 根据数据类型进行必要的预处理

# --------------------------------------------
# 4. 绘图代码
# --------------------------------------------
# 使用 ggplot2 绑定数据和指定图形类型

# --------------------------------------------
# 5. 保存图片
# --------------------------------------------
# 保存为 PDF 或 PNG
\`\`\`

## 输出要求

1. **完整的 R 代码**，严格按照上述结构生成
2. **代码注释**，解释每个关键步骤的作用
3. **输出格式**：
   - 使用 markdown 代码块格式 (\`\`\`r)
   - 代码块前简要说明图表设计思路（2-3句话）
   - 代码块后给出简要的使用说明

## 注意事项

- 确保代码可以直接运行，不需要额外修改
- 在作图前必须加入数据预处理与清洗步骤：检查列名、缺失值、重复行、异常类型；将数值列、分类列、日期列转换为适合 R/ggplot2 使用的数据结构；必要时使用 \`make.names()\` 或显式重命名，确保变量名可被 R 代码安全引用
- 如果用户表头包含单位（例如 \`Yield (kg/ha)\`、\`SOC g/kg\`、\`pH_0-20cm\`、\`温度(℃)\`），代码必须自动识别并分离“变量名”和“单位”：清洗后的列名去掉单位并转为 R 安全变量名；同时保留单位映射（如 \`axis_units\` 或 \`var_labels\`），在 \`labs(x=..., y=...)\`、图例标题或 facet 标签中显示原始变量名和单位，避免因为表头单位、括号、斜杠、百分号等字符导致 R 代码报错
- 预处理代码应保留原始数据对象，并创建清洗后的数据对象（例如 \`data_clean\`），后续统计整理和 ggplot 作图统一基于清洗后的数据
- 使用 ggplot2 包（假设用户已安装）
- 变量名使用英文，避免中文（以防编码问题）
- 如果数据结构不适合指定图表类型，请给出替代建议
- 所有文字标签使用英文（科研论文标准）
- 图中所有英文字母和数字必须使用 Times New Roman；不要使用默认 sans、Arial 或只写 serif。
- 应用主题对象 \`${ACTIVE_R_THEME_NAME}\` 到所有 ggplot 图形
- 如果主题代码中包含 \`nature_palette\`，请在有分组颜色或填充时优先使用该色板
- 图例必须遵守上面的图例位置硬性规则；如果有颜色、填充、线型或形状分组，不要把图例放在图中间遮挡数据。
- 日期/时间横坐标必须遵守上面的日期/时间坐标轴硬性规则；不要把每个日期都显示出来导致标签重合。
- 保存图片时使用合理的尺寸（如 width=10, height=8, 单位英寸）

请开始生成 R 代码：`;
}

function buildLinkedDataAnalysisPromptSection(context?: DataAnalysisRContext): string {
  if (!context?.linkedFromDataAnalysis) return '';

  const selections = String(context.analysisSelections || '').trim();
  const result = String(context.analysisResult || '').trim();
  const significance = String(context.analysisSignificance || '').trim();
  return `## 数据分析联动上下文

本次 R 作图由“数据分析”功能自动联动触发。请同时参考上方数据预览、变量结构和下方统计结果来生成作图代码。

**数据分析变量选择：**
\`\`\`json
${selections ? selections.slice(0, 4000) : '{}'}
\`\`\`

**数据分析结果：**
\`\`\`markdown
${result ? result.slice(0, 8000) : '未提供'}
\`\`\`

**结构化显著性信息（最高优先级）：**
\`\`\`json
${significance ? significance.slice(0, 12000) : '{}'}
\`\`\`

联动要求：
- 图形必须对应统计分析结果，不要只画泛泛的数据探索图。
- 如果用户多选了多个数据分析方法，必须把所有选中的分析写入同一个 R 代码文件：包括数据读取/清洗、各分析方法的统计代码、对应图形对象和保存代码；可以输出多个图文件或一个多面板组合图。
- 对于数据分析结果中标记为“R 代码生成项”的方法，必须在 R 代码中补上对应统计分析代码，但显著性标注仍必须遵守下面的显著性来源规则。
- 显著性标注必须严格来自“结构化显著性信息”、上面的“数据分析结果”，或用户在“额外要求”中明确提供的显著性说明；三者都没有真实显著性信息时，不得编造星号、字母分组或 p 值，但需要预留显著性标注位置，并统一用文本 \`x\` 作为占位标注。
- 如果结构化显著性信息中有 comparisons，必须只标注这些 comparisons 中列出的组间比较；使用其中的 adjustedPFormatted/pFormatted、stars、label，不要自行添加未列出的比较。
- 如果结构化显著性信息显示 significant=false 或 stars=ns，默认不标星号或 p 值；但仍应预留显著性位置，用 \`x\` 标注该比较或在合适位置标注 \`x\`，表示当前没有可用显著性结果。
- 如果没有 comparisons 但图形是分组比较图，请根据用于作图的分组变量预留 1-3 个显著性占位位置，标签统一为 \`x\`；代码注释必须写明“x 为显著性占位符，未提供真实显著性结果”。
- 如果用户额外要求中给出了显著性字母、星号或 p 值，以用户说明为准，但必须在代码注释中标明这些标注来自用户补充说明。
- 优先生成可直接运行的显著性标注代码：可使用 ggpubr::stat_pvalue_manual 或 ggsignif::geom_signif；如果不想依赖额外包，则用 geom_segment + geom_text 手动绘制括号和标签。
- 不要让 R 代码重新计算一套与数据分析结果可能不一致的显著性；只有当用户明确要求重新检验时，才在代码中重新计算，并在注释中说明。
- 如果分析结果里已有 p 值、相关系数、回归系数、均值或样本量，可以在图注或注释中使用；不要编造未出现的统计量。
- R 代码仍然需要从本地数据文件读取全量数据，AI 看到的是结构、预览和统计结果，不是代替本地数据计算。
`;
}

function getRPluginRoot(userId: string): string {
  return path.join(getDataDir(), 'r-plugin', sanitizeUserId(userId));
}

function getRDesktopArtifactRoot(userId: string): string {
  return path.join(os.homedir(), 'Desktop', 'Scholar Harness R图表', sanitizeUserId(userId));
}

function createRJobId(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', '-');
  return `${timestamp}-${randomUUID().slice(0, 8)}`;
}

function getRRuntimeRoot(): string {
  return path.join(getDataDir(), 'r-runtime');
}

function getRPluginConfigPath(): string {
  return path.join(getDataDir(), 'r-plugin-config.json');
}

async function readRPluginConfig(): Promise<RPluginConfig> {
  try {
    const raw = await fs.readFile(getRPluginConfigPath(), 'utf-8');
    return JSON.parse(raw) as RPluginConfig;
  } catch {
    return {};
  }
}

async function writeRPluginConfig(config: RPluginConfig): Promise<void> {
  const next = {
    ...(await readRPluginConfig()),
    ...config,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(getDataDir(), { recursive: true });
  await fs.writeFile(getRPluginConfigPath(), JSON.stringify(next, null, 2), 'utf-8');
}

function sanitizeRFilename(filename?: string): string {
  const cleaned = path.basename(String(filename || 'scholar-harness-r-job.R'))
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/[^a-zA-Z0-9._@ -]/g, '_')
    .slice(0, 120);
  return cleaned.toLowerCase().endsWith('.r') ? cleaned : `${cleaned || 'scholar-harness-r-job'}.R`;
}

function sanitizeRDataFilename(filename?: string): string {
  const cleaned = path.basename(String(filename || 'data.xlsx'))
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .slice(0, 180);
  return cleaned || 'data.xlsx';
}

function extractRCode(raw: string): string {
  const trimmed = raw.trim();
  const codeBlock = trimmed.match(/```(?:r|R)?\s*([\s\S]*?)```/);
  return (codeBlock ? codeBlock[1] : trimmed).trim();
}

function wrapExecutableRCode(rawCode: string): string {
  const code = extractRCode(rawCode);
  return [
    '# Scholar Harness R plugin execution wrapper',
    'options(stringsAsFactors = FALSE)',
    'dir.create("plots", showWarnings = FALSE, recursive = TRUE)',
    '',
    code,
    '',
    '# Best-effort capture of the last ggplot object when the script did not call ggsave explicitly.',
    'try({',
    '  if (requireNamespace("ggplot2", quietly = TRUE)) {',
    '    p <- ggplot2::last_plot()',
    '    if (!is.null(p)) {',
    '      ggplot2::ggsave(file.path("plots", "last_plot.png"), p, width = 8, height = 5, dpi = 600, bg = "white")',
    '      ggplot2::ggsave(file.path("plots", "last_plot.pdf"), p, width = 8, height = 5, bg = "white")',
    '    }',
    '  }',
    '}, silent = TRUE)',
    '',
  ].join('\n');
}

async function listRscriptCandidates(): Promise<string[]> {
  const candidates = new Set<string>();
  const config = await readRPluginConfig();
  if (config.rscriptPath) candidates.add(config.rscriptPath);
  if (process.env.RSCRIPT_PATH) candidates.add(process.env.RSCRIPT_PATH);
  if (process.env.R_HOME) {
    candidates.add(path.join(process.env.R_HOME, 'bin', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));
    candidates.add(path.join(process.env.R_HOME, 'bin', 'x64', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));
  }
  candidates.add(process.platform === 'win32' ? 'Rscript.exe' : 'Rscript');
  candidates.add('Rscript');

  const runtimeRoot = getRRuntimeRoot();
  candidates.add(path.join(runtimeRoot, 'bin', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));
  candidates.add(path.join(runtimeRoot, 'R', 'bin', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));
  candidates.add(path.join(runtimeRoot, 'R', 'bin', 'x64', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));

  if (process.platform === 'win32') {
    const whereCandidates = await listWindowsWhereRscriptCandidates();
    whereCandidates.forEach(item => candidates.add(item));
    const registryInstallPaths = await listWindowsRegistryRInstallPaths();
    registryInstallPaths.forEach(dir => addRInstallDirCandidates(candidates, dir));

    try {
      const runtimeEntries = await fs.readdir(runtimeRoot, { withFileTypes: true });
      runtimeEntries
        .filter(entry => entry.isDirectory() && /^R-/i.test(entry.name))
        .map(entry => path.join(runtimeRoot, entry.name))
        .sort()
        .reverse()
        .forEach(dir => {
          candidates.add(path.join(dir, 'bin', 'Rscript.exe'));
          candidates.add(path.join(dir, 'bin', 'x64', 'Rscript.exe'));
        });
    } catch {
      // Optional portable R plugin has not been installed.
    }

    const roots = await listWindowsRSearchRoots();
    for (const root of roots) {
      try {
        const entries = await fs.readdir(root, { withFileTypes: true });
        entries
          .filter(entry => entry.isDirectory() && /^R-/i.test(entry.name))
          .map(entry => path.join(root, entry.name))
          .sort()
          .reverse()
          .forEach(dir => {
            candidates.add(path.join(dir, 'bin', 'Rscript.exe'));
            candidates.add(path.join(dir, 'bin', 'x64', 'Rscript.exe'));
          });
      } catch {
        // Common R install path does not exist.
      }
    }
  } else {
    ['/usr/local/bin/Rscript', '/usr/bin/Rscript', '/opt/homebrew/bin/Rscript'].forEach(item => candidates.add(item));
  }

  return Array.from(candidates).filter(Boolean);
}

function addRInstallDirCandidates(candidates: Set<string>, dir: string): void {
  if (!dir) return;
  candidates.add(path.join(dir, 'bin', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));
  candidates.add(path.join(dir, 'bin', 'x64', process.platform === 'win32' ? 'Rscript.exe' : 'Rscript'));
}

async function listWindowsWhereRscriptCandidates(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  try {
    const result = await runProcess('where.exe', ['Rscript.exe'], process.cwd(), 10_000);
    if (result.exitCode !== 0) return [];
    return result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function listWindowsRegistryRInstallPaths(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const keys = [
    'HKCU\\SOFTWARE\\R-core\\R',
    'HKLM\\SOFTWARE\\R-core\\R',
    'HKLM\\SOFTWARE\\WOW6432Node\\R-core\\R',
  ];
  const paths = new Set<string>();
  for (const key of keys) {
    try {
      const result = await runProcess('reg.exe', ['query', key, '/v', 'InstallPath'], process.cwd(), 10_000);
      if (result.exitCode !== 0) continue;
      const match = result.stdout.match(/InstallPath\s+REG_\w+\s+(.+)/i);
      if (match?.[1]) paths.add(match[1].trim());
    } catch {
      // Registry key not present or reg.exe unavailable.
    }
  }
  return Array.from(paths);
}

async function listWindowsRSearchRoots(): Promise<string[]> {
  const roots = new Set<string>([
    'C:\\Program Files\\R',
    'C:\\Program Files (x86)\\R',
  ]);
  const envRoots = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'R') : '',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'R') : '',
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'R') : '',
  ].filter(Boolean);
  envRoots.forEach(item => roots.add(item));

  for (let code = 67; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    if (!existsSync(drive)) continue;
    roots.add(path.join(drive, 'R'));
    roots.add(path.join(drive, 'Program Files', 'R'));
    roots.add(path.join(drive, 'Program Files (x86)', 'R'));
  }

  return Array.from(roots);
}

function runProcess(command: string, args: string[], cwd: string, timeoutMs: number): Promise<RProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill();
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code, timedOut, stdout, stderr });
    });
  });
}

async function getRscriptStatus(): Promise<RscriptStatus> {
  const candidates = await listRscriptCandidates();
  let lastError = '未找到 Rscript。请安装 R，或设置 RSCRIPT_PATH 指向 Rscript 可执行文件。';
  for (const candidate of candidates) {
    try {
      if (path.isAbsolute(candidate) && !existsSync(candidate)) {
        continue;
      }
      const result = await runProcess(candidate, ['--version'], process.cwd(), 10_000);
      if (result.exitCode === 0) {
        return {
          available: true,
          path: candidate,
          version: (result.stdout || result.stderr).trim(),
        };
      }
      lastError = (result.stderr || result.stdout || `Rscript exited with code ${result.exitCode}`).trim();
    } catch (error) {
      lastError = (error as Error).message;
    }
  }
  return { available: false, path: candidates[0] || '', error: lastError };
}

async function collectRArtifacts(rootDir: string, userId: string, jobId: string): Promise<RArtifact[]> {
  const artifacts: RArtifact[] = [];
  const root = path.resolve(rootDir);

  async function walk(currentDir: string, depth: number): Promise<void> {
    if (depth > 4 || artifacts.length >= 120) return;
    let entries: Array<import('fs').Dirent>;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!R_ARTIFACT_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(fullPath);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');
      const kind = R_EXPORT_IMAGE_EXTENSIONS.has(ext)
        ? 'image'
        : (ext === '.r' ? 'code' : (ext === '.csv' ? 'data' : 'text'));
      artifacts.push({
        name: entry.name,
        relativePath,
        size: stat.size,
        url: `/api/r-code/artifact/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}?file=${encodeURIComponent(relativePath)}`,
        kind,
      });
    }
  }

  await walk(root, 0);
  const priority = (file: RArtifact) => {
    const name = `${file.relativePath || file.name}`.toLowerCase();
    if (name.includes('overall_pooled_effect_summary')) return 0;
    if (name.includes('_pooled_effect')) return 1;
    if (name.includes('subgroup_pooled_effect')) return 2;
    if (name.includes('subgroup_summary')) return 3;
    if (name.includes('mean_only_bootstrap_summary') || name.includes('pooled_effect_summary.csv')) return 2;
    if (name.includes('forest')) return 4;
    if (name.includes('pooled_effect_summary_all')) return 7;
    if (name.includes('last_plot')) return 8;
    return 6;
  };
  return artifacts.sort((a, b) => {
    const diff = priority(a) - priority(b);
    return diff || a.relativePath.localeCompare(b.relativePath);
  });
}

function resolveRArtifactPath(userId: string, jobId: string, file: unknown): string {
  const safeUserId = sanitizeUserId(userId);
  const safeJobId = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeJobId) {
    throw new Error('无效的 R 图表任务 ID');
  }
  const root = resolveRJobDir(safeUserId, safeJobId);
  const target = path.resolve(root, String(file || ''));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('无效的 R 图表文件路径');
  }
  return target;
}

function resolveRJobDir(userId: string, jobId: string): string {
  const safeUserId = sanitizeUserId(userId);
  const safeJobId = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeJobId) {
    throw new Error('无效的 R 图表任务 ID');
  }
  const desktopDir = path.resolve(getRDesktopArtifactRoot(safeUserId), safeJobId);
  if (existsSync(desktopDir)) return desktopDir;
  return path.resolve(getRPluginRoot(safeUserId), safeJobId);
}

function updateRInstallJob(patch: Partial<RInstallJob>): void {
  if (!currentRInstallJob) return;
  currentRInstallJob = {
    ...currentRInstallJob,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
}

async function resolveRWindowsInstaller(): Promise<{ url: string; filename: string }> {
  const baseUrl = 'https://cran.r-project.org/bin/windows/base/';
  try {
    const response = await fetch(baseUrl);
    if (!response.ok) {
      throw new Error(`CRAN index HTTP ${response.status}`);
    }
    const html = await response.text();
    const matches = Array.from(html.matchAll(/href=["'](R-([0-9.]+)-win\.exe)["']/gi));
    if (matches.length) {
      matches.sort((a, b) => compareVersionStrings(b[2], a[2]));
      return { url: baseUrl + matches[0][1], filename: matches[0][1] };
    }
  } catch (error) {
    logger.warn(`[RCodePlugin] Failed to resolve latest R installer from CRAN: ${(error as Error).message}`);
  }
  return { url: `${baseUrl}R-release-win.exe`, filename: 'R-release-win.exe' };
}

function compareVersionStrings(a: string, b: string): number {
  const aa = a.split('.').map(value => Number(value) || 0);
  const bb = b.split('.').map(value => Number(value) || 0);
  const len = Math.max(aa.length, bb.length);
  for (let index = 0; index < len; index += 1) {
    const diff = (aa[index] || 0) - (bb[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function downloadFile(url: string, destination: string, onProgress?: (progress: number, message: string) => void, redirectCount = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error('下载 R 安装包重定向次数过多'));
      return;
    }
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, response => {
      const statusCode = response.statusCode || 0;
      if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        downloadFile(nextUrl, destination, onProgress, redirectCount + 1).then(resolve, reject);
        return;
      }
      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`下载 R 安装包失败，HTTP ${statusCode}`));
        return;
      }
      const total = Number(response.headers['content-length'] || 0);
      let downloaded = 0;
      const file = createWriteStream(destination);
      response.on('data', chunk => {
        downloaded += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
        if (total > 0 && onProgress) {
          const percent = Math.min(55, Math.max(5, Math.round(downloaded / total * 55)));
          onProgress(percent, `正在下载 R 安装包 ${Math.round(downloaded / 1024 / 1024)}MB/${Math.round(total / 1024 / 1024)}MB`);
        }
      });
      response.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve());
      });
      file.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(120_000, () => {
      request.destroy(new Error('下载 R 安装包超时'));
    });
  });
}

function buildRPackageInstallScript(): string {
  const packages = [
    'ggplot2',
    'dplyr',
    'readxl',
    'scales',
    'tidyr',
    'stringr',
    'forcats',
    'igraph',
    'ggrepel',
    'ggpubr',
    'ggsignif',
    'patchwork',
    'broom',
    'readr',
    'metafor',
    'clubSandwich',
  ];
  return [
    'options(repos = c(CRAN = "https://cloud.r-project.org"))',
    `packages <- c(${packages.map(item => JSON.stringify(item)).join(', ')})`,
    'installed <- rownames(installed.packages())',
    'missing <- setdiff(packages, installed)',
    'cat("Required packages:", paste(packages, collapse = ", "), "\\n")',
    'if (length(missing) > 0) {',
    '  cat("Installing missing packages:", paste(missing, collapse = ", "), "\\n")',
    '  install.packages(missing, dependencies = TRUE)',
    '} else {',
    '  cat("All required packages are already installed.\\n")',
    '}',
    'still_missing <- setdiff(packages, rownames(installed.packages()))',
    'if (length(still_missing) > 0) stop(paste("Package install failed:", paste(still_missing, collapse = ", ")))',
    'cat("Scholar Harness R plugin packages ready.\\n")',
  ].join('\n');
}

async function runRPluginInstallJob(): Promise<void> {
  if (!currentRInstallJob) return;
  try {
    updateRInstallJob({ stage: 'detect', progress: 3, message: '正在检测已安装的 Rscript...' });
    let status = await getRscriptStatus();
    let rscriptPath = status.available ? status.path : '';
    let installDir = '';

    if (!rscriptPath) {
      if (process.platform !== 'win32') {
        throw new Error('当前一键安装只支持 Windows。其他系统请安装 R 后设置 RSCRIPT_PATH。');
      }
      const runtimeRoot = getRRuntimeRoot();
      installDir = path.join(runtimeRoot, 'R');
      const downloadDir = path.join(runtimeRoot, 'downloads');
      await fs.mkdir(downloadDir, { recursive: true });
      await fs.mkdir(installDir, { recursive: true });

      updateRInstallJob({ stage: 'download', progress: 5, message: '正在从 CRAN 解析 R Windows 安装包...' });
      const installer = await resolveRWindowsInstaller();
      const installerPath = path.join(downloadDir, installer.filename);
      updateRInstallJob({ downloadUrl: installer.url, installDir, message: `正在下载 ${installer.filename}...` });
      await downloadFile(installer.url, installerPath, (progress, message) => {
        updateRInstallJob({ progress, message });
      });

      updateRInstallJob({ stage: 'install', progress: 60, message: '正在静默安装 R 到软件数据目录...' });
      const installResult = await runProcess(
        installerPath,
        ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', `/DIR=${installDir}`],
        process.cwd(),
        15 * 60_000
      );
      if (installResult.exitCode !== 0 || installResult.timedOut) {
        throw new Error(installResult.timedOut
          ? 'R 安装超时'
          : `R 安装失败，退出码 ${installResult.exitCode}: ${installResult.stderr || installResult.stdout}`);
      }

      status = await getRscriptStatus();
      rscriptPath = status.available ? status.path : '';
      if (!rscriptPath) {
        const directCandidates = [
          path.join(installDir, 'bin', 'Rscript.exe'),
          path.join(installDir, 'bin', 'x64', 'Rscript.exe'),
        ];
        for (const candidate of directCandidates) {
          if (!existsSync(candidate)) continue;
          const check = await runProcess(candidate, ['--version'], process.cwd(), 10_000);
          if (check.exitCode === 0) {
            rscriptPath = candidate;
            break;
          }
        }
      }
      if (!rscriptPath) {
        throw new Error('R 已安装，但仍未找到 Rscript.exe。');
      }
    }

    updateRInstallJob({ stage: 'packages', progress: 78, message: '正在安装/检查常用 R 作图包...', rscriptPath });
    const bootstrapDir = path.join(getDataDir(), 'r-plugin-bootstrap');
    await fs.mkdir(bootstrapDir, { recursive: true });
    const packageScriptPath = path.join(bootstrapDir, 'install-r-packages.R');
    await fs.writeFile(packageScriptPath, buildRPackageInstallScript(), 'utf-8');
    const packageResult = await runProcess(rscriptPath, [packageScriptPath], bootstrapDir, 30 * 60_000);
    if (packageResult.exitCode !== 0 || packageResult.timedOut) {
      await writeRPluginConfig({ rscriptPath, installDir });
      throw new Error(packageResult.timedOut
        ? 'R 包安装超时'
        : `R 包安装失败，退出码 ${packageResult.exitCode}: ${packageResult.stderr || packageResult.stdout}`);
    }

    await writeRPluginConfig({
      rscriptPath,
      installDir,
      packageInstallAt: new Date().toISOString(),
    });
    updateRInstallJob({
      status: 'complete',
      stage: 'complete',
      progress: 100,
      message: 'R 插件已部署完成，可直接出图。',
      rscriptPath,
      installDir,
      stdout: packageResult.stdout.slice(-4000),
      stderr: packageResult.stderr.slice(-4000),
    });
  } catch (error) {
    updateRInstallJob({
      status: 'failed',
      stage: 'failed',
      progress: currentRInstallJob?.progress || 0,
      message: 'R 插件安装失败',
      error: (error as Error).message,
    });
    logger.error('[RCodePlugin] Install job failed:', error);
  }
}

/**
 * GET /api/r-code/plugin/status
 * 检查本机 Rscript 可用性
 */
router.get('/plugin/status', async (req, res) => {
  try {
    const status = await getRscriptStatus();
    res.json({
      success: true,
      data: {
        ...status,
        workRoot: path.join(getDataDir(), 'r-plugin'),
        runtimeRoot: getRRuntimeRoot(),
        configPath: getRPluginConfigPath(),
      },
    });
  } catch (error) {
    logger.error('[RCodePlugin] Status error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/r-code/plugin/auto-detect
 * 重新检测本机 Rscript，并把可用路径写入配置
 */
router.post('/plugin/auto-detect', async (req, res) => {
  try {
    const status = await getRscriptStatus();
    if (status.available && status.path) {
      await writeRPluginConfig({ rscriptPath: status.path });
    }
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('[RCodePlugin] Auto-detect error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/r-code/plugin/path
 * 保存用户手动指定的 Rscript 路径
 */
router.post('/plugin/path', async (req, res) => {
  try {
    const parsed = rscriptPathSchema.parse(req.body || {});
    const rscriptPath = parsed.rscriptPath.trim().replace(/^["']|["']$/g, '');
    const result = await runProcess(rscriptPath, ['--version'], process.cwd(), 10_000);
    if (result.exitCode !== 0 || result.timedOut) {
      return res.status(400).json({
        success: false,
        error: result.timedOut
          ? 'Rscript 路径检测超时'
          : `该路径无法运行 Rscript：${result.stderr || result.stdout || `exit ${result.exitCode}`}`,
      });
    }
    await writeRPluginConfig({ rscriptPath });
    res.json({
      success: true,
      data: {
        available: true,
        path: rscriptPath,
        version: (result.stdout || result.stderr).trim(),
      },
    });
  } catch (error) {
    logger.error('[RCodePlugin] Save path error:', error);
    const message = error instanceof z.ZodError
      ? error.errors.map(item => item.message).join('; ')
      : (error as Error).message;
    res.status(400).json({ success: false, error: message || '保存 Rscript 路径失败' });
  }
});

/**
 * POST /api/r-code/plugin/install
 * 一键部署 R 运行时和常用作图包
 */
router.post('/plugin/install', async (req, res) => {
  try {
    if (currentRInstallJob?.status === 'running') {
      return res.json({ success: true, data: currentRInstallJob });
    }
    currentRInstallJob = {
      id: randomUUID(),
      status: 'running',
      stage: 'start',
      progress: 1,
      message: 'R 插件安装任务已启动',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    void runRPluginInstallJob();
    res.json({ success: true, data: currentRInstallJob });
  } catch (error) {
    logger.error('[RCodePlugin] Install start error:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/r-code/plugin/install/status
 * 查询一键部署进度
 */
router.get('/plugin/install/status', (req, res) => {
  res.json({
    success: true,
    data: currentRInstallJob || {
      status: 'idle',
      stage: 'idle',
      progress: 0,
      message: '暂无 R 插件安装任务',
    },
  });
});

/**
 * POST /api/r-code/execute
 * 在本机 Rscript 中执行 R 代码，并返回生成的图表文件
 */
router.post('/execute', upload.single('file'), async (req, res) => {
  try {
    const parsed = rExecuteSchema.parse(req.body || {});
    const userId = sanitizeUserId(parsed.userId || 'web-user');
    const status = await getRscriptStatus();
    if (!status.available) {
      return res.status(400).json({
        success: false,
        error: status.error || 'Rscript 不可用',
        data: { status },
      });
    }

    const jobId = createRJobId();
    const jobDir = path.join(getRDesktopArtifactRoot(userId), jobId);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.mkdir(path.join(jobDir, 'plots'), { recursive: true });

    const filename = sanitizeRFilename(parsed.filename);
    const scriptPath = path.join(jobDir, filename);
    const script = wrapExecutableRCode(parsed.rCode);
    await fs.writeFile(scriptPath, script, 'utf-8');

    const uploadedFile = req.file;
    let dataFilePath = '';
    if (uploadedFile) {
      const dataFilename = sanitizeRDataFilename(parsed.dataFilename || uploadedFile.originalname);
      dataFilePath = path.join(jobDir, dataFilename);
      await fs.writeFile(dataFilePath, uploadedFile.buffer);
      const originalBasename = sanitizeRDataFilename(uploadedFile.originalname);
      if (originalBasename !== dataFilename) {
        await fs.writeFile(path.join(jobDir, originalBasename), uploadedFile.buffer);
      }
    }

    logger.info(`[RCodePlugin] Executing R script: ${scriptPath}`);
    const result = await runProcess(status.path, [scriptPath], jobDir, parsed.timeoutMs || 180_000);
    const artifacts = await collectRArtifacts(jobDir, userId, jobId);
    const imageFiles = artifacts.filter(file => file.kind === 'image');
    const supportFiles = artifacts.filter(file => file.kind !== 'image');
    const payload = {
      jobId,
      workDir: jobDir,
      plotDir: path.join(jobDir, 'plots'),
      scriptPath,
      dataFilePath,
      rscript: status,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      stdout: result.stdout.slice(-20_000),
      stderr: result.stderr.slice(-20_000),
      files: artifacts,
      imageFiles,
      supportFiles,
    };

    if (result.timedOut || result.exitCode !== 0) {
      return res.status(500).json({
        success: false,
        error: result.timedOut ? 'R 执行超时' : `R 执行失败，退出码 ${result.exitCode}`,
        data: payload,
      });
    }

    res.json({ success: true, data: payload });
  } catch (error) {
    logger.error('[RCodePlugin] Execute error:', error);
    const message = error instanceof z.ZodError
      ? error.errors.map(item => item.message).join('; ')
      : (error as Error).message;
    res.status(400).json({ success: false, error: message || 'R 执行失败' });
  }
});

/**
 * GET /api/r-code/artifact/:userId/:jobId?file=plots/x.png
 * 查看或下载 R 插件生成的图表文件
 */
router.get('/artifact/:userId/:jobId', (req, res) => {
  try {
    const target = resolveRArtifactPath(req.params.userId, req.params.jobId, req.query.file);
    res.sendFile(target);
  } catch (error) {
    res.status(400).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/r-code/artifact-zip/:userId/:jobId?scope=all|images
 * 打包下载 R 插件生成的图表文件
 */
router.get('/artifact-zip/:userId/:jobId', async (req, res) => {
  try {
    const userId = sanitizeUserId(req.params.userId || 'web-user');
    const jobId = String(req.params.jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
    const scope = String(req.query.scope || 'all').toLowerCase() === 'images' ? 'images' : 'all';
    const jobDir = resolveRJobDir(userId, jobId);
    const stat = await fs.stat(jobDir).catch(() => null);
    if (!stat?.isDirectory()) {
      res.status(404).json({ success: false, error: 'R 图表任务目录不存在，请重新生成图表' });
      return;
    }

    const artifacts = await collectRArtifacts(jobDir, userId, jobId);
    const selected = scope === 'images'
      ? artifacts.filter(file => file.kind === 'image')
      : artifacts;
    if (selected.length === 0) {
      res.status(404).json({ success: false, error: scope === 'images' ? '暂无可打包的图片文件' : '暂无可打包的 R 输出文件' });
      return;
    }

    const filename = `r-figures-${jobId}-${scope}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', error => {
      logger.error('[RCodePlugin] Artifact zip error:', error);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: (error as Error).message || '打包 R 图表文件失败' });
      } else {
        res.destroy(error as Error);
      }
    });
    archive.pipe(res);
    for (const file of selected) {
      archive.file(path.join(jobDir, file.relativePath), { name: file.relativePath });
    }
    await archive.finalize();
  } catch (error) {
    logger.error('[RCodePlugin] Artifact zip route error:', error);
    if (!res.headersSent) {
      res.status(400).json({ success: false, error: (error as Error).message || '打包 R 图表文件失败' });
    }
  }
});

/**
 * POST /api/r-code/generate
 * 上传 Excel 文件，生成 R 作图代码
 */
router.post('/generate', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    const { 
      userId, 
      apiUrl, 
      apiKey, 
      model, 
      chartType, 
      analysisType, 
      customRequirements,
      workDir,
      dataFilename,
      themeCode,
      themeId,
      linkedFromDataAnalysis,
      analysisResult,
      analysisSelections,
      analysisSignificance
    } = req.body;

    // 调试日志
    logger.info(`[RCode] Request body fields: ${JSON.stringify({ userId, chartType, analysisType, workDir, dataFilename, themeId })}`);
    logger.info(`[RCode] File received: ${file ? file.originalname : 'NO FILE'}`);
    logger.info(`[RCode] Theme code provided: ${themeCode ? 'YES' : 'NO'}`);

    if (!file) {
      return res.status(400).json({
        success: false,
        error: '请上传 Excel 或 CSV 文件',
      });
    }

    if (!chartType || !analysisType) {
      return res.status(400).json({
        success: false,
        error: '请指定图表类型和分析类型',
      });
    }

    if (!apiUrl || !apiKey) {
      logger.warn(`[RCode] API config missing: apiUrl=${apiUrl ? 'set' : 'empty'}, apiKey=${apiKey ? 'set' : 'empty'}`);
      return res.status(400).json({
        success: false,
        error: '请配置 API（点击 ⚙️ API 设置）',
      });
    }

    logger.info(`[RCode] Processing file: ${file.originalname} for user: ${userId}`);
    logger.info(`[RCode] Chart type: ${chartType}, Analysis: ${analysisType}`);
    logger.info(`[RCode] API URL: ${apiUrl}, Model: ${model}`);

    // 解析 Excel 数据结构
    const dataStructure = await parseExcelStructure(file.buffer, file.originalname);
    logger.info(`[RCode] Parsed ${dataStructure.rowCount} rows, ${dataStructure.columns.length} columns`);
    const effectiveDataFilename = typeof dataFilename === 'string' && dataFilename.trim()
      ? dataFilename.trim()
      : file.originalname;

    // 构建 AI 提示词（传入用户配置）
    const prompt = buildRCodePrompt(
      dataStructure, 
      chartType, 
      analysisType, 
      customRequirements,
      workDir,
      effectiveDataFilename,
      themeCode,
      typeof themeId === 'string' ? themeId : undefined,
      {
        linkedFromDataAnalysis: linkedFromDataAnalysis === 'true' || linkedFromDataAnalysis === true,
        analysisResult: typeof analysisResult === 'string' ? analysisResult : undefined,
        analysisSelections: typeof analysisSelections === 'string' ? analysisSelections : undefined,
        analysisSignificance: typeof analysisSignificance === 'string' ? analysisSignificance : undefined,
      }
    );

    // 处理 API URL - 确保格式正确
    let normalizedApiUrl = apiUrl.trim();
    // 去掉末尾斜杠
    if (normalizedApiUrl.endsWith('/')) {
      normalizedApiUrl = normalizedApiUrl.slice(0, -1);
    }
    // 确保 URL 格式正确
    const chatEndpoint = normalizedApiUrl.includes('/chat/completions')
      ? normalizedApiUrl
      : normalizedApiUrl + '/chat/completions';

    logger.info(`[RCode] Calling AI API: ${chatEndpoint}`);

    // 调用 AI API 生成 R 代码
    const aiResponse = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 32000,
      }),
    });

    logger.info(`[RCode] AI API response status: ${aiResponse.status}`);

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      logger.error('[RCode] AI API error:', errorText.slice(0, 500));
      return res.status(500).json({
        success: false,
        error: `AI API 错误: ${aiResponse.status}`,
      });
    }

    const aiData = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
    const rCode = enforceRCodeGuardrails(aiData.choices?.[0]?.message?.content || '');

    if (!rCode) {
      return res.status(500).json({
        success: false,
        error: 'AI 未返回有效代码',
      });
    }

    logger.info(`[RCode] Generated R code, length: ${rCode.length}`);

    // 返回结果
    res.json({
      success: true,
      data: {
        rCode,
        dataStructure: {
          columns: dataStructure.columns,
          rowCount: dataStructure.rowCount,
          previewRowCount: dataStructure.previewRowCount,
          sheetNames: dataStructure.sheetNames,
        },
        filename: file.originalname,
        dataFilename: effectiveDataFilename,
      },
    });

  } catch (error) {
    logger.error('[RCode] Error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /api/r-code/save
 * 将 R 代码保存到用户桌面（Electron 环境通过 IPC，Web 环境返回文件供下载）
 */
router.post('/save', async (req, res) => {
  try {
    const { rCode, filename, userId } = req.body;

    if (!rCode) {
      return res.status(400).json({
        success: false,
        error: '缺少 R 代码内容',
      });
    }

    // 生成文件名
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rFilename = filename 
      ? `${path.basename(filename, path.extname(filename))}_plot_${timestamp}.R`
      : `r_plot_code_${timestamp}.R`;

    // 在 Electron 环境中，通过 IPC 保存到桌面
    // 在 Web 环境中，返回文件内容供前端触发下载
    // 这里返回文件内容，由前端处理保存（Electron IPC 或 Web download）

    res.json({
      success: true,
      data: {
        filename: rFilename,
        content: rCode,
        // 提示前端如何处理
        saveMethod: 'electron_ipc_or_download',
        desktopPath: null, // Electron 环境由前端获取
      },
    });

  } catch (error) {
    logger.error('[RCode] Save error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * POST /api/r-code/debug
 * 调试模式：读取已有 R 代码文件，根据用户要求进行微调
 */
router.post('/debug', upload.none(), async (req, res) => {
  try {
    const { userId, apiUrl, apiKey, model, codePath, customRequirements, dataFilename, themeCode, themeId } = req.body;

    // 调试日志
    logger.info(`[RCodeDebug] Request for user: ${userId}`);
    logger.info(`[RCodeDebug] Code path: ${codePath}`);
    logger.info(`[RCodeDebug] Requirements: ${customRequirements}`);

    if (!codePath) {
      return res.status(400).json({
        success: false,
        error: '请填写 R 代码文件路径',
      });
    }

    if (!customRequirements) {
      return res.status(400).json({
        success: false,
        error: '请描述需要修改的内容',
      });
    }

    if (!apiUrl || !apiKey) {
      return res.status(400).json({
        success: false,
        error: '请配置 API（点击 ⚙️ API 设置）',
      });
    }

    // 从代码文件路径自动推断工作目录
    let inferredWorkDir = '';
    try {
      const parsedPath = path.parse(codePath);
      inferredWorkDir = parsedPath.dir.replace(/\\/g, '/');  // 统一使用正斜杠
      logger.info(`[RCodeDebug] Inferred work dir from code path: ${inferredWorkDir}`);
    } catch (e) {
      logger.warn('[RCodeDebug] Could not parse code path for work dir');
    }

    // 读取已有的 R 代码文件
    let existingCode = '';
    try {
      existingCode = await fs.readFile(codePath, 'utf-8');
      logger.info(`[RCodeDebug] Read existing code, length: ${existingCode.length}`);
    } catch (readError) {
      logger.error('[RCodeDebug] Failed to read file:', readError);
      return res.status(400).json({
        success: false,
        error: `无法读取代码文件：${codePath}。请确认路径正确且文件存在。`,
      });
    }

    // 构建 AI 提示词（调试模式）
    const normalizedThemeCode = themeCode ? normalizeThemeCode(themeCode) : '';
    const themeSkillSection = buildThemeSkillSection(typeof themeId === 'string' ? themeId : undefined);
    const debugPrompt = `你是一个专业的 R 语言数据可视化专家。用户有一段已有的 R 作图代码，需要根据具体要求进行调整。

## 已有代码

\`\`\`r
${existingCode}
\`\`\`

## 用户需求

${customRequirements}

## 附加配置

**工作目录（自动推断）**: ${inferredWorkDir || '从代码路径推断'}
**数据文件名**: ${dataFilename || '不修改'}
**作图主题**: ${getThemeDisplayName(typeof themeId === 'string' ? themeId : undefined)}
**主题样式**: ${themeCode ? '用户提供了新的主题样式' : '不修改'}

${themeCode ? `
### 主题样式代码
\`\`\`r
${normalizedThemeCode}
\`\`\`
` : ''}

${themeSkillSection ? `${themeSkillSection}
` : ''}

${R_FONT_GUIDE}

${R_LEGEND_PLACEMENT_GUIDE}

${R_DATE_AXIS_GUIDE}

## 任务要求

1. **保持代码结构完整**：不要删除或大幅改动已有代码的核心逻辑
2. **只针对用户需求修改**：根据用户描述的具体问题进行调整
3. **保留注释**：保持原有的注释，可以添加新的注释说明修改内容
4. **输出完整代码**：返回修改后的完整 R 代码（不要只输出修改片段）
5. **统一主题对象**：所有 ggplot 图形统一使用 \`${ACTIVE_R_THEME_NAME}\`；如果启用了 Nature-skill，优先调整配色、标签、图例和导出规格
6. **数据预处理与清洗**：如原代码缺少数据检查，请补充列名清理、缺失值检查、重复行检查、变量类型转换和适合 ggplot2 的 \`data_clean\` 数据对象，确保后续作图代码使用结构正确的数据
7. **表头单位处理**：如果表头包含单位、括号、斜杠、百分号或中文单位，请把单位从代码变量名中分离出来；清洗后的列名用于 R 安全引用，原始变量名和单位保存在标签映射中，并显示在坐标轴标题、图例标题或 facet 标签里
8. **图例位置**：如原代码把图例放在图中间或遮挡数据，必须改到左上角、右上角、图外顶部或图外右侧；图内位置需要根据数据密度选择较空的一侧
9. **日期轴处理**：如原代码把日期当作离散字符或显示全部日期标签，必须改成连续日期轴，设置合理的 \`date_breaks\` 和 \`date_labels\`，避免横坐标重叠
10. **字体处理**：所有英文字母和数字必须使用 Times New Roman；如原代码使用 Arial、sans、serif 或默认字体，必须替换为显式 \`font_family <- "Times New Roman"\` 并应用到 theme

## 输出格式

- 使用 markdown 代码块格式 (\`\`\`r)
- 代码块前简要说明修改了哪些内容（2-3句话）
- 确保代码可以直接运行

请开始修改代码：`;

    // 处理 API URL - 确保格式正确
    let normalizedApiUrl = apiUrl.trim();
    if (normalizedApiUrl.endsWith('/')) {
      normalizedApiUrl = normalizedApiUrl.slice(0, -1);
    }
    const chatEndpoint = normalizedApiUrl.includes('/chat/completions')
      ? normalizedApiUrl
      : normalizedApiUrl + '/chat/completions';

    logger.info(`[RCodeDebug] Calling AI API: ${chatEndpoint}`);

    // 调用 AI API
    const aiResponse = await fetch(chatEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [{ role: 'user', content: debugPrompt }],
        temperature: 0.7,
        max_tokens: 32000,
      }),
    });

    logger.info(`[RCodeDebug] AI API response status: ${aiResponse.status}`);

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      logger.error('[RCodeDebug] AI API error:', errorText.slice(0, 500));
      return res.status(500).json({
        success: false,
        error: `AI API 错误: ${aiResponse.status}`,
      });
    }

    const aiData = await aiResponse.json() as { choices?: Array<{ message?: { content?: string } }> };
    const adjustedCode = enforceRCodeGuardrails(aiData.choices?.[0]?.message?.content || '');

    if (!adjustedCode) {
      return res.status(500).json({
        success: false,
        error: 'AI 未返回有效代码',
      });
    }

    logger.info(`[RCodeDebug] Generated adjusted code, length: ${adjustedCode.length}`);

    // 返回结果
    res.json({
      success: true,
      data: {
        rCode: adjustedCode,
        originalCodePath: codePath,
        requirements: customRequirements,
      },
    });

  } catch (error) {
    logger.error('[RCodeDebug] Error:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

/**
 * GET /api/r-code/chart-types
 * 获取支持的图表类型列表
 */
router.get('/chart-types', (req, res) => {
  res.json({
    success: true,
    data: {
      chartTypes: [
        { id: 'scatter', name: '散点图', description: '适合展示两个连续变量的关系' },
        { id: 'line', name: '折线图', description: '适合展示时间序列或趋势数据' },
        { id: 'bar', name: '柱状图', description: '适合展示分类数据的比较' },
        { id: 'histogram', name: '直方图', description: '适合展示数据分布' },
        { id: 'boxplot', name: '箱线图', description: '适合展示数据分布和异常值' },
        { id: 'heatmap', name: '热力图', description: '适合展示矩阵数据或相关性' },
        { id: 'pie', name: '饼图', description: '适合展示比例数据' },
        { id: 'violin', name: '小提琴图', description: '适合展示数据分布密度' },
        { id: 'density', name: '密度图', description: '适合展示连续变量的概率分布' },
        { id: 'area', name: '面积图', description: '适合展示累积数据或范围' },
        { id: 'contour', name: '等高线图', description: '适合展示三维数据的二维投影' },
        { id: 'bubble', name: '气泡图', description: '适合展示三个变量的关系' },
        { id: 'errorbar', name: '误差棒图', description: '适合展示数据的误差范围' },
        { id: 'grouped_bar', name: '分组柱状图', description: '适合展示多组分类数据的比较' },
        { id: 'stacked_bar', name: '堆叠柱状图', description: '适合展示分类数据的组成比例' },
      ],
      analysisTypes: [
        { id: 'correlation', name: '相关性分析', description: '分析变量之间的相关性' },
        { id: 'comparison', name: '组间比较', description: '比较不同组之间的差异' },
        { id: 'distribution', name: '分布分析', description: '分析数据的分布特征' },
        { id: 'trend', name: '趋势分析', description: '分析数据随时间的变化趋势' },
        { id: 'composition', name: '组成分析', description: '分析数据的组成结构' },
        { id: 'ranking', name: '排序分析', description: '按某种指标排序展示' },
        { id: 'deviation', name: '偏差分析', description: '分析与基准的偏差' },
        { id: 'range', name: '范围分析', description: '分析数据的范围和变化' },
      ],
    },
  });
});

export default router;
