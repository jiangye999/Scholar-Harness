/**
 * R 代码生成路由
 * 用户上传 Excel 文件 → AI 分析数据结构 → 生成 R 作图代码
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as zlib from 'zlib';
import { Router } from 'express';
import archiver from 'archiver';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import { getDataDir, getMemoryDir, getProjectOwnedDataDir, sanitizeUserId } from '../../utils/paths';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';
import { researchSessionManager } from '../../research/research-session-manager';
import { prepareWorkspaceOutputDirectory } from '../services/workspace-directory';
import { downloadFileWithRetry, requestTextWithRetry } from '../services/resilient-download';

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
const R_ARTIFACT_EXTENSIONS = new Set([
  '.r', '.rmd', '.png', '.pdf', '.svg', '.jpg', '.jpeg', '.tif', '.tiff',
  '.csv', '.tsv', '.xls', '.xlsx', '.json', '.txt', '.md', '.html', '.htm',
  '.doc', '.docx', '.ppt', '.pptx', '.zip',
]);
const R_EXPORT_IMAGE_EXTENSIONS = new Set(['.png', '.svg', '.jpg', '.jpeg', '.tif', '.tiff']);
type RArtifactKind = 'image' | 'pdf' | 'code' | 'data' | 'text' | 'word' | 'presentation' | 'archive' | 'file';

const R_NO_AUTO_INSTALL_OPTIONAL_PACKAGES = new Set([
  'multcompView',
  'agricolae',
  'emmeans',
  'ggpubr',
  'ggsignif',
  'rstatix',
  'multcomp',
  'PMCMRplus',
  'car',
  'lme4',
  'lmerTest',
]);

const R_FONT_GUIDE = `
## 字体硬性规则

- 图中所有英文字母和数字必须使用 Times New Roman，新罗马字体。
- R 代码中必须设置统一字体变量，例如 \`font_family <- "serif"\`，并在 \`theme(text = element_text(family = font_family), axis.text = ..., axis.title = ..., legend.text = ..., legend.title = ...)\` 中应用。
- Windows 环境建议加入 \`try(windowsFonts(serif = windowsFont("TT Times New Roman")), silent = TRUE)\`，让 Rscript 使用系统 Times New Roman 映射，同时避免 PDF/PNG 设备报 \`invalid font type\`。
- 坐标轴数字、刻度标签、图例、显著性标注、标题、分面标签中的英文和数字都要继承 Times New Roman；不要使用默认 sans、Arial 或仅写 \`family = "serif"\`。
- 不要把 \`family\`、\`fontfamily\`、\`fonts\` 或 \`font\` 作为 \`ggsave()\` / \`safe_ggsave()\` 参数传入；这些参数可能被 PNG 设备拒绝，字体必须通过 ggplot theme 设置。
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
- 生成代码时优先使用系统注入的 \`scholar_as_date(x)\` 解析日期；不要直接对未知格式的字符/因子日期调用裸 \`as.Date(x)\`。
- 日期横坐标不能显示每一个日期标签。必须根据时间跨度设置合适的 breaks 和 labels：跨度小于 45 天可按 1 周或 2 周；小于 18 个月可按 1 月或 2 月；多年数据按 6 个月或 1 年；十年以上按 2 年或 5 年。
- 日期横坐标标签默认必须使用 ISO 格式 \`YYYY-MM-DD\`，即 R 代码中写 \`date_labels = "%Y-%m-%d"\`。不要使用系统 locale 默认格式、\`%b %d\`、\`%m月 %d\`、\`%Y年%m月%d日\` 或 “5月 27” 这类中文月份格式，除非用户明确要求中文日期。
- 使用 \`scale_x_date(date_breaks = "...", date_labels = "%Y-%m-%d")\` 或 \`scale_x_datetime(..., date_labels = "%Y-%m-%d")\` 控制日期显示，并用 \`guide_axis(check.overlap = TRUE)\`、\`theme(axis.text.x = element_text(angle = 30, hjust = 1))\` 避免标签重叠。
- 日期趋势图优先使用连续时间轴，不要用 \`factor(date)\` 或 \`scale_x_discrete()\` 把所有日期逐个展开。
`.trim();

const R_DATA_FORMAT_PLOT_SAFETY_GUIDE = `
## R 数据整理与作图安全硬性规则

- 生成 R 代码时必须先处理数据格式，再作图。不要直接把原始表头、中文列名、带单位列名、带空格/括号/斜杠/百分号的列名放进 \`aes()\`。
- 必须保留 \`data_raw\` 原始数据对象，并创建 \`data_clean\` 清洗对象；后续统计分析、汇总和 ggplot 作图都必须使用 \`data_clean\`。
- 必须保存列名映射表，例如 \`name_map <- data.frame(raw = names(data_raw), clean = make.names(names(data_raw), unique = TRUE))\`；如果表头包含单位，必须保存单位映射，例如 \`var_labels\` 或 \`axis_units\`。
- 必须显式转换变量类型：数值列用 \`as.numeric()\` 或 \`readr::parse_number()\` 思路安全转换；分类列转 \`factor\`；日期列转 \`Date/POSIXct\`；不要让字符型数字直接进入统计或坐标轴。
- 必须检查关键列是否存在、清洗后是否为空、分组是否至少有有效水平、数值列是否有有限值；如果条件不满足，必须 \`stop()\` 给出清楚错误，不要保存空白图，也不要让 ggplot 在中途报晦涩错误。
- 涉及长宽表转换时，必须明确 \`id_vars\`、\`measure_vars\` 和转换后的列名；不要盲目 \`pivot_longer(everything())\` 导致分组列和数值列混在一起。
- \`ggsave()\` 的 \`width\` 和 \`height\` 必须是英寸，不是像素；常规单图推荐 \`width=8-10\`、\`height=5-8\`，复杂多面板最多不要超过 \`width=14\`、\`height=10\`。禁止写 \`width=800\`、\`height=600\` 这类像素值。
- 保存图片必须使用 \`safe_ggsave()\` 或等效尺寸保护函数，把异常宽高裁剪到合理英寸范围，避免出现 “Dimensions exceed 50 inches”。
- 不要重新定义 \`safe_ggsave <- function(...)\`；系统会在执行阶段自动注入安全保存函数。代码中只需要调用 \`safe_ggsave(...)\`。
- 如果要标注显著性，必须来自用户数据分析结果、用户明确提供的 p 值/字母/星号，或代码中真实计算出的结果；不能编造显著性。
- 使用 \`scale_color_manual()\`、\`scale_colour_manual()\` 或 \`scale_fill_manual()\` 时，\`values\` 不能为空，且颜色数量必须不少于实际分组水平数；优先使用代码中定义的非空调色板，不要写 \`values = c()\` 或依赖可能为空的变量。
`.trim();

const R_ERROR_BAR_GUIDE = `
## 误差棒硬性规则

- 当用户要求“误差棒”“error bar”“每个点加误差棒”“带 SD/SE/CI”时，最终图中必须出现显式误差棒图层，例如 \`geom_errorbar()\`；不能只在文字或注释里说已添加。
- 添加误差棒前必须先判断当前主图类型，再选择对应的误差计算和图层：
  - 折线图、点图、散点图：每个已绘制的数据点都必须对应一个误差棒；误差棒数据必须和点图层使用同一粒度的数据，优先使用 \`geom_errorbar()\` 或 \`geom_linerange()\`。
  - 柱状图、分组柱状图：柱高通常应是均值或汇总值，误差棒应使用同一 x/group 汇总粒度的 SD/SE/CI；分组柱状图必须让 \`geom_col()\` 和 \`geom_errorbar()\` 使用相同的 \`position_dodge(...)\`。
  - 水平柱状图：误差范围应沿 x 方向表达，优先使用 \`geom_errorbarh()\` 或 \`geom_segment(aes(x = x_value - error_value, xend = x_value + error_value, y = group, yend = group))\`。
  - 箱线图、小提琴图：这类图已经展示分布；如果用户仍要求误差棒，应添加均值点和均值 ± SD/SE/CI 的 summary overlay，而不是给箱体本身随意添加虚假误差。
  - 面积图或趋势带：优先使用 \`geom_ribbon(aes(ymin = y_value - error_value, ymax = y_value + error_value), alpha = ...)\` 表达不确定性；除非用户明确要求竖线误差棒。
  - 热图、饼图等不适合误差棒的图：不要硬塞误差棒；应生成更适合表达误差的配套折线/点图/柱状图，或在代码注释说明该图型不适合直接添加误差棒。
- 优先使用用户表格中已有误差列，而不是重新计算。常见误差列名包括 \`sd\`、\`SD\`、\`se\`、\`SE\`、\`std\`、\`error\`、\`err\`、\`stderr\`、\`ci\`、\`CI\` 以及 \`*_sd\`、\`*_se\`。清洗列名后也要识别这些列。
- 如果原始数据已经是一行一个点，并且存在 \`sd\` / \`se\` / \`error\` 列，禁止在 \`group_by(date, treatment)\` 后用 \`sd(y)\` 重新计算误差；这会在单行分组时产生 \`NA\`，导致误差棒不可见。
- 如果 y 变量做了单位换算，误差列必须做完全相同的换算。例如 \`N2Oflux = N2Oflux * 100\` 时，\`sd = sd * 100\`。
- 对点加垂直误差棒的推荐写法是：\`geom_errorbar(aes(ymin = y_value - error_value, ymax = y_value + error_value), width = ..., linewidth = ..., na.rm = TRUE)\`；其中 \`error_value\` 必须是有限数值。
- 只有在表格没有误差列、且同一 x/group 下有多个重复观测时，才可以按组计算 SD 或 SE；代码中应先检查每组样本量，避免单样本组产生不可见误差棒。
`.trim();

const R_PACKAGE_DEPENDENCY_GUIDE = `
## R 包依赖硬性规则

- 默认只使用本系统常用基础作图依赖：ggplot2、readxl、dplyr、tidyr、scales、stringr。不要为了显著性标注、字母分组或主题美化默认加载可选包。
- 写代码前必须参考“本机 R 包长期记忆”。对清单中已安装的包可以直接使用；对清单中没有的非可选必要包，必须写 \`if (!requireNamespace("包名", quietly = TRUE)) install.packages("包名")\` 这类安装检查，并提供安装失败时的清楚提示或降级方案。
- 禁止默认写 \`library(multcompView)\`、\`library(agricolae)\`、\`library(emmeans)\`、\`library(ggpubr)\`、\`library(ggsignif)\`、\`library(rstatix)\`、\`library(multcomp)\` 或对应的 \`pkg::fun()\` 调用；这些包在用户本机可能未安装，会导致自动出图中断。
- 如果确实需要可选包，必须先用 \`requireNamespace("包名", quietly = TRUE)\` 判断；缺包时必须降级为 base R/ggplot2 实现或不标注，并在 R 注释中说明，不能 \`stop()\`。
- abc/compact letter display 如果无法在无额外包条件下可靠计算，就不要标注 abc；不要因为缺少 \`multcompView\`、\`agricolae\` 或 \`emmeans\` 让整张图失败。
- 统计结果已经由数据分析模块提供时，优先使用提供的 p 值/星号/字母；不要额外安装包重新计算一套不一致的显著性。
`.trim();

const R_USER_QUERY_PRIORITY_GUIDE = `
## 用户需求优先级硬性规则

- “额外要求”中的用户原始 query 是最高优先级，必须覆盖自动图表类型、数据分析默认建议、变量类型推断和模型自己的偏好。
- 如果用户原始 query 明确要求某种图型，例如“折线图”“线图”“趋势图”“line plot”，最终主图必须是该图型；如果上方“图表类型”或数据分析结果与 query 冲突，服从 query。
- 用户要求折线图时，主图必须使用 \`geom_line()\`，通常配合 \`geom_point()\`；禁止用 \`geom_col()\`、\`geom_bar()\` 或柱状图替代。
- 用户要求柱状图时才使用 \`geom_col()\` 或 \`geom_bar()\`；不要因为有分类分组变量就擅自把用户要求的折线图改成柱状图。
- 如果用户要求的图型与数据结构确实不兼容，必须在 R 代码中 \`stop()\` 给出清楚原因，不能静默改成另一种图型。
`.trim();

const R_SAFE_GGSAVE_HELPER = `
# Scholar Harness 作图尺寸安全保护：width/height 一律按英寸处理，自动拦截像素误填。
safe_plot_dimension <- function(value, fallback, min_value = 2.5, max_value = 14) {
  raw_value <- suppressWarnings(as.numeric(value)[1])
  if (!is.finite(raw_value) || raw_value <= 0) raw_value <- fallback
  if (raw_value > 50) {
    # 常见错误是把像素当作英寸，例如 800 x 600；这里按 100 dpi 粗略折算。
    raw_value <- if (raw_value >= 300) raw_value / 100 else fallback
  }
  max(min_value, min(max_value, raw_value))
}

safe_ggsave <- function(filename, plot = ggplot2::last_plot(), width = 8, height = 5,
                        dpi = 600, units = "in", bg = "white", limitsize = FALSE, ...) {
  width <- safe_plot_dimension(width, fallback = 8, min_value = 3, max_value = 14)
  height <- safe_plot_dimension(height, fallback = 5, min_value = 3, max_value = 10)
  extra_args <- list(...)
  # Font family belongs in ggplot theme(text = element_text(family = ...)).
  # Several PNG devices reject family/font arguments passed through ggsave(...).
  unsupported_device_args <- c("family", "fontfamily", "fonts", "font")
  extra_args[intersect(names(extra_args), unsupported_device_args)] <- NULL
  ggsave_args <- c(
    list(
      filename = filename,
      plot = plot,
      width = width,
      height = height,
      dpi = dpi,
      units = "in",
      bg = bg,
      limitsize = limitsize
    ),
    extra_args
  )
  do.call(ggplot2::ggsave, ggsave_args)
}
`.trim();

const R_SAFE_DATE_HELPER = `
# Scholar Harness 日期解析保护：兼容 Excel 数字日期、字符日期、年月/年份和因子日期，避免 charToDate 中断出图。
scholar_as_date <- function(x, origin = "1899-12-30", ...) {
  if (inherits(x, "Date")) return(x)
  if (inherits(x, "POSIXt")) return(as.Date.POSIXct(x))
  if (is.factor(x)) x <- as.character(x)
  make_na_date <- function(n) structure(rep(NA_real_, n), class = "Date")

  parse_from_text <- function(value, format = NULL) {
    value <- trimws(as.character(value))
    value[value %in% c("", "NA", "NaN", "NULL", "null", "None", "none")] <- NA_character_
    normalized <- value
    normalized <- gsub("[年./]", "-", normalized)
    normalized <- gsub("月", "-", normalized)
    normalized <- gsub("日", "", normalized)
    normalized <- gsub("\\\\s+", "", normalized)
    normalized <- gsub("-+", "-", normalized)
    normalized <- gsub("-$", "", normalized)

    out <- make_na_date(length(normalized))

    numeric_value <- suppressWarnings(as.numeric(normalized))
    numeric_text <- !is.na(numeric_value) & grepl("^[-+]?\\\\d+(?:\\\\.\\\\d+)?$", normalized)
    excel_serial <- numeric_text & numeric_value > 1000 & numeric_value < 100000
    if (any(excel_serial)) {
      out[excel_serial] <- suppressWarnings(base::as.Date(numeric_value[excel_serial], origin = origin))
    }
    year_text <- numeric_text & numeric_value >= 1000 & numeric_value <= 9999 & is.na(out)
    if (any(year_text)) {
      parsed_year <- suppressWarnings(strptime(sprintf("%04d-01-01", as.integer(numeric_value[year_text])), format = "%Y-%m-%d", tz = "UTC"))
      out[year_text] <- as.Date(parsed_year)
    }

    text_value <- normalized
    year_month <- grepl("^\\\\d{4}-\\\\d{1,2}$", text_value)
    text_value[year_month] <- paste0(text_value[year_month], "-01")
    year_only <- grepl("^\\\\d{4}$", text_value)
    text_value[year_only] <- paste0(text_value[year_only], "-01-01")

    formats <- c(format, "%Y-%m-%d", "%Y-%m-%d%H:%M:%S", "%Y%m%d", "%m-%d-%Y", "%d-%m-%Y")
    formats <- formats[!is.na(formats) & nzchar(formats)]
    for (fmt in unique(formats)) {
      pending <- is.na(out) & !is.na(text_value)
      if (!any(pending)) break
      parsed <- suppressWarnings(strptime(text_value[pending], format = fmt, tz = "UTC"))
      parsed_date <- as.Date(parsed)
      valid <- !is.na(parsed_date)
      pending_index <- which(pending)
      if (any(valid)) out[pending_index[valid]] <- parsed_date[valid]
    }
    out
  }

  extra_args <- list(...)
  explicit_format <- extra_args[["format"]]
  if (is.numeric(x)) {
    out <- make_na_date(length(x))
    finite <- is.finite(x)
    excel_serial <- finite & x > 1000 & x < 100000
    if (any(excel_serial)) {
      out[excel_serial] <- suppressWarnings(base::as.Date(x[excel_serial], origin = origin))
    }
    year_value <- finite & x >= 1000 & x <= 9999 & is.na(out)
    if (any(year_value)) {
      parsed_year <- suppressWarnings(strptime(sprintf("%04d-01-01", as.integer(x[year_value])), format = "%Y-%m-%d", tz = "UTC"))
      out[year_value] <- as.Date(parsed_year)
    }
    return(out)
  }

  parse_from_text(x, format = explicit_format)
}

as.Date.factor <- function(x, ...) scholar_as_date(as.character(x), ...)
as.Date.character <- function(x, ...) scholar_as_date(x, ...)
`.trim();

const R_SAFE_MANUAL_SCALE_HELPER = `
# Scholar Harness 手动配色保护：避免 scale_*_manual(values = character(0)) 中断出图。
scholar_manual_palette <- c(
  "#0072B2", "#D55E00", "#009E73", "#CC79A7",
  "#E69F00", "#56B4E9", "#F0E442", "#000000",
  "#6A3D9A", "#A6761D", "#666666", "#1B9E77"
)

scholar_safe_manual_values <- function(values = NULL, min_n = 64) {
  if (missing(values) || is.null(values)) values <- character(0)
  if (is.function(values)) {
    values <- tryCatch(values(min_n), error = function(e) character(0))
  }
  values <- tryCatch(as.character(values), error = function(e) character(0))
  values <- values[nzchar(values)]
  if (length(values) == 0) values <- scholar_manual_palette
  if (is.null(names(values)) || all(!nzchar(names(values)))) {
    values <- rep(values, length.out = max(min_n, length(values)))
  }
  values
}

scholar_scale_color_manual <- function(..., values = scholar_manual_palette) {
  ggplot2::scale_color_manual(..., values = scholar_safe_manual_values(values))
}

scholar_scale_colour_manual <- function(..., values = scholar_manual_palette) {
  ggplot2::scale_colour_manual(..., values = scholar_safe_manual_values(values))
}

scholar_scale_fill_manual <- function(..., values = scholar_manual_palette) {
  ggplot2::scale_fill_manual(..., values = scholar_safe_manual_values(values))
}
`.trim();

const rExecuteSchema = z.object({
  userId: z.string().optional(),
  rCode: z.string().min(1).max(2_000_000),
  filename: z.string().optional(),
  dataFilename: z.string().optional(),
  sourceDataFilePath: z.string().optional(),
  researchSessionId: z.string().optional(),
  workspaceDirectory: z.string().max(20_000).optional(),
  workspaceOutputType: z.enum(['meta-analysis', 'bibliometrics']).optional(),
  workspaceOutputId: z.string().max(160).optional(),
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
  kind?: RArtifactKind;
  absolutePath?: string;
}

interface RImageQualityResult {
  relativePath: string;
  suspicious: boolean;
  reason?: string;
  width?: number;
  height?: number;
  nonWhiteRatio?: number;
  centerInkRatio?: number;
  centerColoredRatio?: number;
  error?: string;
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

interface RInstalledPackageInfo {
  name: string;
  version: string;
  libPath?: string;
  priority?: string;
}

interface RPackageMemory {
  version: 1;
  userId: string;
  updatedAt: string;
  rscriptPath: string;
  rVersion?: string;
  packageCount: number;
  packages: RInstalledPackageInfo[];
  error?: string;
  memoryPath?: string;
  textPath?: string;
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

interface RChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface HttpJsonResponse {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  json: unknown;
}

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

function normalizeRManualScaleCallsInCode(code: string): string {
  return code
    .replace(/\b(?:ggplot2::)?scale_color_manual\s*\(/gi, 'scholar_scale_color_manual(')
    .replace(/\b(?:ggplot2::)?scale_colour_manual\s*\(/gi, 'scholar_scale_colour_manual(')
    .replace(/\b(?:ggplot2::)?scale_fill_manual\s*\(/gi, 'scholar_scale_fill_manual(')
    .replace(
      /(scholar_scale_color_manual\s*<-\s*function\s*\([^)]*\)\s*\{\s*)scholar_scale_color_manual\s*\(/gi,
      '$1ggplot2::scale_color_manual(',
    )
    .replace(
      /(scholar_scale_colour_manual\s*<-\s*function\s*\([^)]*\)\s*\{\s*)scholar_scale_colour_manual\s*\(/gi,
      '$1ggplot2::scale_colour_manual(',
    )
    .replace(
      /(scholar_scale_fill_manual\s*<-\s*function\s*\([^)]*\)\s*\{\s*)scholar_scale_fill_manual\s*\(/gi,
      '$1ggplot2::scale_fill_manual(',
    );
}

function ensureRManualScaleHelper(code: string): string {
  const normalized = normalizeRManualScaleCallsInCode(code);
  if (
    !/\bscholar_scale_(?:color|colour|fill)_manual\s*\(/i.test(normalized)
    || /scholar_scale_(?:color|colour|fill)_manual\s*<-/.test(normalized)
  ) {
    return normalized;
  }
  return `${R_SAFE_MANUAL_SCALE_HELPER}

${normalized}`;
}

function normalizeRDateCallsInCode(code: string): string {
  return code.replace(/(?<![A-Za-z0-9_.:])as\.Date\s*\(/g, 'scholar_as_date(');
}

function normalizeRDateAxisLabelFormatInCode(code: string): string {
  return replaceRScaleCallArguments(code, /\bscale_x_(?:date|datetime)\s*\(/gi, (args) => {
    const isoLabel = 'date_labels = "%Y-%m-%d"';
    let normalizedArgs = args
      .replace(/\bdate_labels\s*=\s*scales::date_format\s*\([^)]*\)/gi, isoLabel)
      .replace(/\bdate_labels\s*=\s*date_format\s*\([^)]*\)/gi, isoLabel)
      .replace(/\bdate_labels\s*=\s*["'][^"']*["']/gi, isoLabel);

    if (/\bdate_labels\s*=/.test(normalizedArgs)) return normalizedArgs;

    normalizedArgs = normalizedArgs
      .replace(/\blabels\s*=\s*scales::date_format\s*\([^)]*\)/gi, isoLabel)
      .replace(/\blabels\s*=\s*date_format\s*\([^)]*\)/gi, isoLabel);
    if (/\bdate_labels\s*=/.test(normalizedArgs)) return normalizedArgs;

    const trimmed = normalizedArgs.trim();
    return trimmed ? `${normalizedArgs}, ${isoLabel}` : isoLabel;
  });
}

function replaceRScaleCallArguments(
  code: string,
  callPattern: RegExp,
  transformArgs: (args: string) => string
): string {
  let output = '';
  let cursor = 0;
  callPattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(code)) !== null) {
    const openIndex = match.index + match[0].lastIndexOf('(');
    const closeIndex = findMatchingRParen(code, openIndex);
    if (closeIndex < 0) continue;
    output += code.slice(cursor, openIndex + 1);
    output += transformArgs(code.slice(openIndex + 1, closeIndex));
    cursor = closeIndex;
    callPattern.lastIndex = closeIndex + 1;
  }
  output += code.slice(cursor);
  return output;
}

function findMatchingRParen(code: string, openIndex: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let i = openIndex; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function ensureRSafeDateHelper(code: string): string {
  if (!/\bscholar_as_date\s*\(/.test(code) || /\bscholar_as_date\s*<-/.test(code)) {
    return code;
  }
  return `${R_SAFE_DATE_HELPER}

${code}`;
}

function looksLikeRStartLine(line: string): boolean {
  const trimmed = line.trim();
  return /^(?:#|library\s*\(|require\s*\(|requireNamespace\s*\(|suppressPackageStartupMessages\s*\(|options\s*\(|setwd\s*\(|dir\.create\s*\(|read(?:xl|r)?::|read_|write_|ggplot\s*\(|[A-Za-z.][A-Za-z0-9._]*\s*(?:<-|=|\())/.test(trimmed);
}

function looksLikeRCodeLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return true;
  if (/^```|^~~~/.test(trimmed)) return false;
  if (/^[-=]{3,}$/.test(trimmed)) return false;
  if (/^\d+\.\s+/.test(trimmed)) return false;
  if (/^(?:修改|说明|注意|主要|原代码|文件名|下面|以上|请|可以|如果|建议|输出格式|保存|显示图形|检查|转换|颜色配色|日期范围)/.test(trimmed)) return false;
  if (/^[+}),\]]/.test(trimmed)) return true;
  if (looksLikeRStartLine(trimmed)) return true;
  if (/(?:<-|->|::|\(|\)|\{|\}|\[|\]|\$|%>%|\|>)/.test(trimmed)) return true;
  if (/=/.test(trimmed) && /[,)]\s*$/.test(trimmed)) return true;
  if (/[\u4e00-\u9fff]/.test(trimmed)) return false;
  return true;
}

function commentUnsafeRNarrativeLines(code: string): string {
  return code.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (looksLikeRCodeLine(trimmed)) return line;
    const indent = line.match(/^\s*/)?.[0] || '';
    return `${indent}# ${trimmed}`;
  }).join('\n');
}

function enforceRCodeGuardrails(rCode: string): string {
  const executableCode = normalizeRDateAxisLabelFormatInCode(normalizeRDateCallsInCode(commentUnsafeRNarrativeLines(extractRCode(rCode))));
  const legendSafe = ensureRManualScaleHelper(enforceLegendPlacement(executableCode))
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
  const withDateHelper = ensureRSafeDateHelper(withFont);
  if (/scale_x_discrete\s*\(/i.test(withDateHelper) && /(date|time|year|month|日期|时间|年份|月份)/i.test(withDateHelper)) {
    return normalizeRPlotSaveCalls(`${withDateHelper}

# Scholar Harness 日期轴检查提示：
# 当前代码中出现 scale_x_discrete() 且脚本疑似包含日期/时间字段。
# 如果横坐标是日期，请改用 Date/POSIXct 连续时间轴，并使用 scale_x_date()
# 或 scale_x_datetime(date_breaks = ..., date_labels = "%Y-%m-%d") 控制标签密度，
# 避免把所有日期逐个显示导致重叠。
`);
  }
  return normalizeRPlotSaveCalls(withDateHelper);
}

function normalizeRPlotSaveCallsInCode(code: string): string {
  const manualSafe = ensureRManualScaleHelper(code);
  if (!/(?:ggsave|safe_ggsave)\s*\(/i.test(manualSafe)) return manualSafe;
  const withoutOldHelper = neutralizeUserSafeGgsaveDefinitions(stripScholarSafeGgsaveHelper(manualSafe));
  const replaced = withoutOldHelper.replace(/(?<![A-Za-z0-9_.:])ggsave\s*\(/g, 'safe_ggsave(');
  return `${R_SAFE_GGSAVE_HELPER}

${replaced}`;
}

function neutralizeUserSafeGgsaveDefinitions(code: string): string {
  return code.replace(/\bsafe_ggsave\s*(<-|=)\s*function\s*\(/gi, 'scholar_ignored_safe_ggsave $1 function(');
}

function stripScholarSafeGgsaveHelper(code: string): string {
  return code.replace(
    /# Scholar Harness 作图尺寸安全保护[\s\S]*?safe_ggsave\s*<-\s*function[\s\S]*?\n}\s*\n?/m,
    '',
  ).trimStart();
}

function normalizeRPlotSaveCalls(raw: string): string {
  if (!/ggsave\s*\(/i.test(raw) || /safe_ggsave\s*<-/.test(raw)) return raw;
  const codeBlock = raw.match(/```(?:r|R)?\s*([\s\S]*?)```/);
  if (!codeBlock) return normalizeRPlotSaveCallsInCode(raw);
  const normalizedCode = normalizeRPlotSaveCallsInCode((codeBlock[1] || '').trim());
  return raw.replace(codeBlock[0], `\`\`\`r\n${normalizedCode}\n\`\`\``);
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableAiApiStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableAiApiError(error: unknown): boolean {
  const err = error as NodeJS.ErrnoException & { code?: string; cause?: { code?: string } };
  const message = String((error as Error)?.message || error || '').toLowerCase();
  const code = String(err.code || err.cause?.code || '').toUpperCase();
  return [
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EAI_AGAIN',
    'ENOTFOUND',
    'UND_ERR_CONNECT_TIMEOUT',
    'ECONNABORTED',
  ].includes(code) || /timeout|timed out|fetch failed|network|socket|connection/i.test(message);
}

function formatAiApiError(error: unknown, apiUrl: string): string {
  const err = error as NodeJS.ErrnoException & { code?: string; cause?: { code?: string; message?: string } };
  const code = String(err.code || err.cause?.code || '').trim();
  const rawMessage = String(err.cause?.message || (error as Error)?.message || error || 'AI API 请求失败').trim();
  const host = (() => {
    try {
      return new URL(apiUrl).host;
    } catch {
      return apiUrl;
    }
  })();

  if (/timeout|timed out/i.test(rawMessage) || /TIMEOUT/i.test(code)) {
    return `AI API 连接超时：无法连接到 ${host}。请检查网络/代理，稍后重试，或切换到可访问的 API 地址。`;
  }
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) {
    return `AI API 域名解析失败：${host}。请检查网络 DNS、代理或 API 地址。`;
  }
  if (/ECONNREFUSED|ECONNRESET|ECONNABORTED/i.test(code)) {
    return `AI API 连接被中断：${host}。请稍后重试，或切换 API 服务商/代理。`;
  }
  return `AI API 请求失败：${rawMessage}`;
}

async function postJsonWithTimeout(urlString: string, headers: Record<string, string>, payload: unknown, timeoutMs: number): Promise<HttpJsonResponse> {
  const url = new URL(urlString);
  const body = JSON.stringify(payload);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port ? Number(url.port) : undefined,
      method: 'POST',
      path: `${url.pathname}${url.search}`,
      headers: {
        ...headers,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let json: unknown = null;
        if (text.trim()) {
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
        }
        resolve({
          ok: !!res.statusCode && res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode || 0,
          statusText: res.statusMessage || '',
          text,
          json,
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`AI API request timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function requestRChatCompletion(
  chatEndpoint: string,
  apiKey: string,
  body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
    temperature: number;
    max_tokens: number;
  },
  logLabel: string,
): Promise<RChatCompletionResponse> {
  const attempts = 3;
  const timeoutMs = 120_000;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      logger.info(`[${logLabel}] AI API request attempt ${attempt}/${attempts}, timeout=${timeoutMs}ms`);
      const response = await postJsonWithTimeout(chatEndpoint, {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + apiKey,
      }, body, timeoutMs);

      logger.info(`[${logLabel}] AI API response status: ${response.status}`);
      if (response.ok) {
        return response.json as RChatCompletionResponse;
      }

      const errorText = response.text.slice(0, 1000);
      lastError = new Error(`AI API 错误: ${response.status}${response.statusText ? ` ${response.statusText}` : ''}${errorText ? ` - ${errorText}` : ''}`);
      if (!isRetryableAiApiStatus(response.status) || attempt === attempts) {
        throw lastError;
      }
      logger.warn(`[${logLabel}] AI API retryable status ${response.status}, retrying...`);
    } catch (error) {
      lastError = error;
      if (!isRetryableAiApiError(error) || attempt === attempts) {
        throw new Error(formatAiApiError(error, chatEndpoint));
      }
      logger.warn(`[${logLabel}] AI API request failed on attempt ${attempt}/${attempts}: ${(error as Error).message}`);
    }
    await sleep(1200 * attempt);
  }

  throw new Error(formatAiApiError(lastError, chatEndpoint));
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

function buildRPackageMemoryPromptSection(memory?: RPackageMemory | null): string {
  if (!memory) {
    return `## 本机 R 包长期记忆

- 当前未读取到 R 包清单。生成代码时必须把非基础依赖写成 \`requireNamespace()\` 检查，并提供缺包降级方案。`;
  }

  const installedNames = new Set(memory.packages.map(pkg => pkg.name.toLowerCase()));
  const optionalPackages = Array.from(R_NO_AUTO_INSTALL_OPTIONAL_PACKAGES).sort((a, b) => a.localeCompare(b));
  const installedOptional = optionalPackages.filter(pkg => installedNames.has(pkg.toLowerCase()));
  const missingOptional = optionalPackages.filter(pkg => !installedNames.has(pkg.toLowerCase()));
  const packageList = memory.packages
    .map(pkg => `${pkg.name}${pkg.version ? `(${pkg.version})` : ''}`)
    .join(', ') || '未检测到已安装 R 包';

  return `## 本机 R 包长期记忆

**清单更新时间**: ${memory.updatedAt}
**Rscript**: ${memory.rscriptPath || '未检测到'}
**R 版本**: ${memory.rVersion || '未知'}
**已安装包数量**: ${memory.packageCount}
${memory.error ? `**刷新提示**: ${memory.error}` : ''}

**当前已安装包（包名(版本)）**:
${packageList}

**已安装的可选统计/显著性包**: ${installedOptional.length ? installedOptional.join(', ') : '无'}
**当前缺失的可选统计/显著性包**: ${missingOptional.length ? missingOptional.join(', ') : '无'}

包依赖要求：
- 写 R 代码前必须优先参考上面的“当前已安装包”清单。
- 已安装包可以直接 \`library()\`；未安装包不能直接 \`library()\` 或直接 \`pkg::fun()\`。
- 如果必须使用未安装包，代码必须包含 \`requireNamespace("包名", quietly = TRUE)\` 判断、\`install.packages("包名")\` 安装提示或安装代码，并且安装失败时有不影响出图的降级方案。
- 对 multcompView/agricolae/emmeans/ggpubr/ggsignif/rstatix 等可选包，默认不要安装；缺包时跳过对应显著性字母/括号，或用 base R + ggplot2 绘制已经真实存在的标注。`;
}

function buildTreatmentPalettePromptSection(treatmentPaletteConfig?: string): string {
  const config = typeof treatmentPaletteConfig === 'string' ? treatmentPaletteConfig.trim().slice(0, 12000) : '';
  if (!config) return '';
  return `## 处理/分组颜色一致性（最高优先级）

前端已让用户确认或采用系统推荐的顶刊常用处理配色。生成或修改 R 代码时必须执行下面的颜色配置，不要让 ggplot 使用默认灰色、默认离散色或随机颜色。

\`\`\`json
${config}
\`\`\`

硬性要求：
- 如果配置中有 \`variable\`，该变量就是优先的颜色/填充分组变量；如果列名清洗后发生变化，必须用 name_map 找到对应清洗列名。
- 如果配置中有 \`assignments\`，必须在 R 代码中定义命名向量，例如 \`scholar_user_palette <- c("Control" = "#0072B2", "Treatment" = "#D55E00")\`。
- 所有涉及同一处理/组别的 \`color\`、\`colour\`、\`fill\` scale 都必须使用同一命名向量，优先使用 \`scholar_scale_color_manual(values = scholar_user_palette)\`、\`scholar_scale_colour_manual(values = scholar_user_palette)\` 和 \`scholar_scale_fill_manual(values = scholar_user_palette)\`。
- 多张图、多面板图、显著性标注和图例中，同一处理名称必须保持同一个 HEX 颜色。
- 如果实际数据出现未列出的新增水平，只能从配置的推荐色板或 Okabe-Ito 色板追加颜色，不能改变已列出处理的颜色。`;
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
  dataAnalysisContext?: DataAnalysisRContext,
  treatmentPaletteConfig?: string,
  rPackageMemory?: RPackageMemory | null
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
  const treatmentPaletteSection = buildTreatmentPalettePromptSection(treatmentPaletteConfig);

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

${treatmentPaletteSection ? `${treatmentPaletteSection}
` : ''}

${themeSkillSection ? `${themeSkillSection}
` : ''}

${buildRPackageMemoryPromptSection(rPackageMemory)}

${R_USER_QUERY_PRIORITY_GUIDE}

${R_FONT_GUIDE}

${R_LEGEND_PLACEMENT_GUIDE}

${R_DATE_AXIS_GUIDE}

${R_ERROR_BAR_GUIDE}

${R_PACKAGE_DEPENDENCY_GUIDE}

${R_DATA_FORMAT_PLOT_SAFETY_GUIDE}

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
# 必须创建 data_raw、name_map 和 data_clean；统一清理列名、单位、缺失值和变量类型

# --------------------------------------------
# 4. 绘图代码
# --------------------------------------------
# 使用 ggplot2 绑定数据和指定图形类型

# --------------------------------------------
# 5. 保存图片
# --------------------------------------------
# 使用 safe_ggsave() 保存为 PDF 和 PNG，width/height 使用英寸
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
- 必须严格执行上面的“R 数据整理与作图安全硬性规则”，先生成稳健的数据清洗代码，再生成统计和作图代码
- 在作图前必须加入数据预处理与清洗步骤：检查列名、缺失值、重复行、异常类型；将数值列、分类列、日期列转换为适合 R/ggplot2 使用的数据结构；必要时使用 \`make.names()\` 或显式重命名，确保变量名可被 R 代码安全引用
- 如果用户表头包含单位（例如 \`Yield (kg/ha)\`、\`SOC g/kg\`、\`pH_0-20cm\`、\`温度(℃)\`），代码必须自动识别并分离“变量名”和“单位”：清洗后的列名去掉单位并转为 R 安全变量名；同时保留单位映射（如 \`axis_units\` 或 \`var_labels\`），在 \`labs(x=..., y=...)\`、图例标题或 facet 标签中显示原始变量名和单位，避免因为表头单位、括号、斜杠、百分号等字符导致 R 代码报错
- 预处理代码应保留原始数据对象，并创建清洗后的数据对象（例如 \`data_clean\`），后续统计整理和 ggplot 作图统一基于清洗后的数据
- 禁止在未检查关键列、有效行数、分组水平和有限数值的情况下直接作图
- 使用 ggplot2 包（假设用户已安装）
- 变量名使用英文，避免中文（以防编码问题）
- 如果数据结构不适合指定图表类型，请给出替代建议
- 所有文字标签使用英文（科研论文标准）
- 图中所有英文字母和数字必须使用 Times New Roman；不要使用默认 sans、Arial 或只写 serif。
- 应用主题对象 \`${ACTIVE_R_THEME_NAME}\` 到所有 ggplot 图形
- 如果主题代码中包含 \`nature_palette\`，请在有分组颜色或填充时优先使用该色板
- 不要默认依赖可选 R 包；尤其不要用 \`multcompView\`、\`agricolae\`、\`emmeans\`、\`ggpubr\`、\`ggsignif\`、\`rstatix\` 作为出图必要条件
- 图例必须遵守上面的图例位置硬性规则；如果有颜色、填充、线型或形状分组，不要把图例放在图中间遮挡数据。
- 日期/时间横坐标必须遵守上面的日期/时间坐标轴硬性规则；不要把每个日期都显示出来导致标签重合。
- 保存图片时必须使用 \`safe_ggsave()\` 或同等保护函数；使用合理的尺寸（如 width=10, height=8，单位英寸），不要把像素当英寸

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
- 显著性标注必须严格来自“结构化显著性信息”、上面的“数据分析结果”、用户在“额外要求”中明确提供的显著性说明，或 R 代码中真实计算出的检验结果；三者都没有真实显著性信息时，不得编造星号、字母分组、p 值，也不得用 \`x\`、\`xx\`、\`xxx\` 占位。
- 如果结构化显著性信息中有 comparisons，必须只标注这些 comparisons 中列出的组间比较；使用其中的 adjustedPFormatted/pFormatted、stars、label，不要自行添加未列出的比较。
- 如果结构化显著性信息显示 significant=false 或 stars=ns，默认不标星号、p 值或字母；不要预留 \`x\` 占位。
- 如果没有 comparisons 但图形是分组比较图，默认不画显著性括号和字母；只允许在 R 代码注释中说明“未提供真实显著性结果，因此不标注显著性”。
- abc/字母分组只能来自两类来源：用户明确给出的字母分组，或代码中真实执行 ANOVA/非参数检验 + post-hoc + compact letter display 后计算出的分组。没有 compact letter display 结果时，不要把 pairwise 星号硬转成 a/b/c，也不要写 \`xxx\`。
- 如果用户明确要求“abc”“字母分组”“显著性字母”，但没有提供现成结果，必须在 R 代码里先计算真实 post-hoc；compact letter display 只能在无需额外可选包或可选包已安装且有降级方案时使用。如果缺少 multcompView/agricolae/emmeans 等可选包、数据条件不足或计算失败，则不标字母，并在代码注释说明原因。
- 如果用户额外要求中给出了显著性字母、星号或 p 值，以用户说明为准，但必须在代码注释中标明这些标注来自用户补充说明。
- 优先生成可直接运行且不需要安装新包的显著性标注代码：用 ggplot2 的 geom_segment + geom_text 手动绘制括号和标签；只有在 ggpubr/ggsignif 已安装且有无包降级方案时才可调用。
- 不要让 R 代码重新计算一套与数据分析结果可能不一致的显著性；只有当用户明确要求重新检验时，才在代码中重新计算，并在注释中说明。
- 如果分析结果里已有 p 值、相关系数、回归系数、均值或样本量，可以在图注或注释中使用；不要编造未出现的统计量。
- R 代码仍然需要从本地数据文件读取全量数据，AI 看到的是结构、预览和统计结果，不是代替本地数据计算。
`;
}

function getRPluginRoot(userId: string): string {
  return path.join(getProjectOwnedDataDir('r-plugin'), sanitizeUserId(userId));
}

function getRDesktopArtifactRoot(userId: string): string {
  return path.join(os.homedir(), 'Desktop', 'Scholar Harness R图表', sanitizeUserId(userId));
}

interface RJobLocationRecord {
  userId: string;
  workDir: string;
  updatedAt: string;
}

interface RJobLocationRegistry {
  jobs: Record<string, RJobLocationRecord>;
}

let rJobLocationRegistryWriteChain: Promise<void> = Promise.resolve();

function getRJobLocationRegistryPath(): string {
  return path.join(getProjectOwnedDataDir('r-plugin'), 'job-locations.json');
}

function readRJobLocationRegistry(): RJobLocationRegistry {
  try {
    const parsed = JSON.parse(readFileSync(getRJobLocationRegistryPath(), 'utf-8')) as Partial<RJobLocationRegistry>;
    return { jobs: parsed.jobs && typeof parsed.jobs === 'object' ? parsed.jobs : {} };
  } catch {
    return { jobs: {} };
  }
}

async function rememberRJobLocation(userId: string, jobId: string, workDir: string): Promise<void> {
  const writeTask = rJobLocationRegistryWriteChain
    .catch(() => undefined)
    .then(async () => {
      const registry = readRJobLocationRegistry();
      registry.jobs[jobId] = {
        userId: sanitizeUserId(userId),
        workDir: path.resolve(workDir),
        updatedAt: new Date().toISOString(),
      };
      const entries = Object.entries(registry.jobs)
        .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 1000);
      const registryPath = getRJobLocationRegistryPath();
      await fs.mkdir(path.dirname(registryPath), { recursive: true });
      await fs.writeFile(registryPath, JSON.stringify({ jobs: Object.fromEntries(entries) }, null, 2), 'utf-8');
    });
  rJobLocationRegistryWriteChain = writeTask;
  await writeTask;
}

function parseRWorkspaceDirectory(value: string | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('工作目录参数不是合法 JSON');
  }
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

function getRPackageMemoryDir(userId: string): string {
  return path.join(getMemoryDir(), sanitizeUserId(userId || 'web-user'), 'r');
}

function getRPackageMemoryJsonPath(userId: string): string {
  return path.join(getRPackageMemoryDir(userId), 'installed-packages.json');
}

function getRPackageMemoryTextPath(userId: string): string {
  return path.join(getRPackageMemoryDir(userId), 'R语言已安装包长期记忆.txt');
}

function buildRPackageInventoryScript(): string {
  return [
    'clean_field <- function(x) {',
    '  x <- ifelse(is.na(x), "", as.character(x))',
    '  gsub("[\\t\\r\\n]+", " ", x)',
    '}',
    'scholar_user_lib <- Sys.getenv("R_LIBS_USER")',
    'if (!nzchar(scholar_user_lib)) scholar_user_lib <- file.path(Sys.getenv("LOCALAPPDATA"), "ScholarHarness", "R-library")',
    'if (nzchar(scholar_user_lib) && dir.exists(scholar_user_lib)) .libPaths(unique(c(scholar_user_lib, .libPaths())))',
    'cat("R_VERSION\\t", clean_field(R.version.string), "\\n", sep = "")',
    'ip <- installed.packages()',
    'fields <- c("Package", "Version", "LibPath", "Priority")',
    'available_fields <- intersect(fields, colnames(ip))',
    'df <- as.data.frame(ip[, available_fields, drop = FALSE], stringsAsFactors = FALSE)',
    'for (field in setdiff(fields, names(df))) df[[field]] <- ""',
    'df <- df[order(tolower(df$Package)), fields, drop = FALSE]',
    'cat("PACKAGE\\tPackage\\tVersion\\tLibPath\\tPriority\\n")',
    'for (i in seq_len(nrow(df))) {',
    '  cat("PACKAGE\\t", clean_field(df$Package[i]), "\\t", clean_field(df$Version[i]), "\\t", clean_field(df$LibPath[i]), "\\t", clean_field(df$Priority[i]), "\\n", sep = "")',
    '}',
  ].join('\n');
}

function parseRPackageInventoryOutput(stdout: string, userId: string, status: RscriptStatus): RPackageMemory {
  const packages = new Map<string, RInstalledPackageInfo>();
  let rVersion = status.version;
  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts[0] === 'R_VERSION') {
      rVersion = parts.slice(1).join('\t').trim() || rVersion;
      continue;
    }
    if (parts[0] !== 'PACKAGE') continue;
    const name = (parts[1] || '').trim();
    if (!name || name === 'Package') continue;
    const version = (parts[2] || '').trim();
    const key = name.toLowerCase();
    if (!packages.has(key)) {
      packages.set(key, {
        name,
        version,
        libPath: (parts[3] || '').trim() || undefined,
        priority: (parts[4] || '').trim() || undefined,
      });
    }
  }

  const packageList = Array.from(packages.values()).sort((a, b) => a.name.localeCompare(b.name));
  return {
    version: 1,
    userId: sanitizeUserId(userId || 'web-user'),
    updatedAt: new Date().toISOString(),
    rscriptPath: status.path,
    rVersion,
    packageCount: packageList.length,
    packages: packageList,
  };
}

function renderRPackageMemoryText(memory: RPackageMemory): string {
  const packageLines = memory.packages.length
    ? memory.packages.map(pkg => `- ${pkg.name}${pkg.version ? ` ${pkg.version}` : ''}`).join('\n')
    : '- 未检测到已安装 R 包。';
  const lines = [
    '# R语言已安装包长期记忆',
    '',
    `用户: ${memory.userId}`,
    `更新时间: ${memory.updatedAt}`,
    `Rscript: ${memory.rscriptPath || '未检测到'}`,
    `R版本: ${memory.rVersion || '未知'}`,
    `包数量: ${memory.packageCount}`,
  ];
  if (memory.error) lines.push(`刷新提示: ${memory.error}`);
  lines.push(
    '',
    '## 使用规则',
    '',
    '- 每次生成或修复 R 作图代码前，后端会刷新此文件，并把包清单提供给 AI。',
    '- 已安装包可以直接使用；未安装包必须先 requireNamespace() 判断，并提供安装代码或无包降级方案。',
    '- 可选统计/显著性包不能作为出图必要条件；缺包时应跳过对应标注或使用基础 ggplot2 实现。',
    '- 如果自动执行阶段成功安装了基础依赖，后端会再次刷新本文件。',
    '',
    '## 已安装包',
    '',
    packageLines,
    '',
  );
  return lines.join('\n');
}

async function writeRPackageMemory(memory: RPackageMemory): Promise<RPackageMemory> {
  const userId = sanitizeUserId(memory.userId || 'web-user');
  const memoryDir = getRPackageMemoryDir(userId);
  const memoryPath = getRPackageMemoryJsonPath(userId);
  const textPath = getRPackageMemoryTextPath(userId);
  const next: RPackageMemory = {
    ...memory,
    userId,
    memoryPath,
    textPath,
  };
  await fs.mkdir(memoryDir, { recursive: true });
  await fs.writeFile(memoryPath, JSON.stringify(next, null, 2), 'utf-8');
  await fs.writeFile(textPath, renderRPackageMemoryText(next), 'utf-8');
  return next;
}

async function readRPackageMemory(userIdInput: unknown): Promise<RPackageMemory | null> {
  const userId = sanitizeUserId(typeof userIdInput === 'string' && userIdInput.trim() ? userIdInput : 'web-user');
  try {
    const raw = await fs.readFile(getRPackageMemoryJsonPath(userId), 'utf-8');
    return JSON.parse(raw) as RPackageMemory;
  } catch {
    return null;
  }
}

async function refreshRPackageMemory(userIdInput: unknown): Promise<RPackageMemory> {
  const userId = sanitizeUserId(typeof userIdInput === 'string' && userIdInput.trim() ? userIdInput : 'web-user');
  const status = await getRscriptStatus();
  if (!status.available) {
    return writeRPackageMemory({
      version: 1,
      userId,
      updatedAt: new Date().toISOString(),
      rscriptPath: status.path,
      rVersion: status.version,
      packageCount: 0,
      packages: [],
      error: status.error || 'Rscript 不可用，无法刷新 R 包清单。',
    });
  }

  const memoryDir = path.join(getRPluginRoot(userId), 'package-memory');
  await fs.mkdir(memoryDir, { recursive: true });
  const scriptPath = path.join(memoryDir, `installed-packages-${Date.now()}-${randomUUID().slice(0, 6)}.R`);
  await fs.writeFile(scriptPath, buildRPackageInventoryScript(), 'utf-8');
  try {
    const result = await runProcess(status.path, [scriptPath], memoryDir, 30_000);
    if (result.timedOut) {
      throw new Error('刷新 R 包清单超时。');
    }
    if (result.exitCode !== 0) {
      throw new Error((result.stderr || result.stdout || `Rscript exited with code ${result.exitCode}`).trim());
    }
    const memory = parseRPackageInventoryOutput(result.stdout, userId, status);
    return writeRPackageMemory(memory);
  } finally {
    await fs.unlink(scriptPath).catch(() => undefined);
  }
}

async function getRPackageMemoryForPrompt(userIdInput: unknown): Promise<RPackageMemory> {
  const userId = sanitizeUserId(typeof userIdInput === 'string' && userIdInput.trim() ? userIdInput : 'web-user');
  try {
    return await refreshRPackageMemory(userId);
  } catch (error) {
    const fallback = await readRPackageMemory(userId);
    if (fallback) {
      return {
        ...fallback,
        error: `本次刷新失败，沿用上一次包清单：${(error as Error).message}`,
      };
    }
    return writeRPackageMemory({
      version: 1,
      userId,
      updatedAt: new Date().toISOString(),
      rscriptPath: '',
      packageCount: 0,
      packages: [],
      error: `刷新 R 包清单失败：${(error as Error).message}`,
    });
  }
}

function summarizeRPackageMemoryForResponse(memory?: RPackageMemory | null) {
  if (!memory) return null;
  return {
    updatedAt: memory.updatedAt,
    rscriptPath: memory.rscriptPath,
    rVersion: memory.rVersion,
    packageCount: memory.packageCount,
    memoryPath: memory.memoryPath,
    textPath: memory.textPath,
    error: memory.error,
  };
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
  const codeBlocks = Array.from(trimmed.matchAll(/```(?:r|R|rscript|Rscript)?\s*([\s\S]*?)```/g));
  if (codeBlocks.length) {
    const preferred = codeBlocks.find(match => /\b(?:library|ggplot|ggsave|safe_ggsave|read_|readxl|data\.frame)\b|<-/.test(match[1] || ''));
    return ((preferred || codeBlocks[0])[1] || '').trim();
  }

  const lines = trimmed.split(/\r?\n/);
  const firstCodeLine = lines.findIndex(line => looksLikeRStartLine(line));
  if (firstCodeLine > 0) {
    return lines.slice(firstCodeLine).join('\n').trim();
  }
  return trimmed;
}

function extractRRequiredPackages(code: string): string[] {
  const packages = new Set<string>();
  const basePackages = new Set([
    'base',
    'compiler',
    'datasets',
    'graphics',
    'grDevices',
    'grid',
    'methods',
    'parallel',
    'splines',
    'stats',
    'stats4',
    'tools',
    'utils',
  ]);
  const patterns = [
    /\b(?:library|require)\s*\(\s*(?:package\s*=\s*)?["']?([A-Za-z][A-Za-z0-9._]*)["']?/g,
    /\brequireNamespace\s*\(\s*["']([A-Za-z][A-Za-z0-9._]*)["']/g,
    /\b([A-Za-z][A-Za-z0-9.]*)::/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      const pkg = match[1];
      if (!pkg || basePackages.has(pkg)) continue;
      packages.add(pkg);
    }
  }
  return Array.from(packages).sort();
}

function buildRDependencyBootstrap(packages: string[]): string {
  const required = packages
    .filter(Boolean)
    .filter(pkg => !R_NO_AUTO_INSTALL_OPTIONAL_PACKAGES.has(pkg))
    .filter((pkg, index, arr) => arr.indexOf(pkg) === index)
    .sort();
  if (!required.length) return '';
  return [
    '# Scholar Harness dependency bootstrap',
    'scholar_cran_repos <- c(',
    '  "https://mirrors.tuna.tsinghua.edu.cn/CRAN/",',
    '  "https://mirrors.ustc.edu.cn/CRAN/",',
    '  "https://cloud.r-project.org",',
    '  "https://cran.r-project.org"',
    ')',
    'options(repos = c(CRAN = scholar_cran_repos[[1]]))',
    'scholar_user_lib <- Sys.getenv("R_LIBS_USER")',
    'if (!nzchar(scholar_user_lib)) scholar_user_lib <- file.path(Sys.getenv("LOCALAPPDATA"), "ScholarHarness", "R-library")',
    'dir.create(scholar_user_lib, recursive = TRUE, showWarnings = FALSE)',
    '.libPaths(unique(c(scholar_user_lib, .libPaths())))',
    `scholar_required_packages <- c(${required.map(item => JSON.stringify(item)).join(', ')})`,
    'scholar_missing_packages <- scholar_required_packages[!vapply(scholar_required_packages, requireNamespace, logical(1), quietly = TRUE)]',
    'if (length(scholar_missing_packages) > 0) {',
    '  message("Scholar Harness installing missing R packages: ", paste(scholar_missing_packages, collapse = ", "))',
    '  for (scholar_repo in scholar_cran_repos) {',
    '    options(repos = c(CRAN = scholar_repo))',
    '    message("Scholar Harness CRAN mirror: ", scholar_repo)',
    '    try(install.packages(scholar_missing_packages, dependencies = TRUE, lib = scholar_user_lib), silent = TRUE)',
    '    scholar_missing_packages <- scholar_required_packages[!vapply(scholar_required_packages, requireNamespace, logical(1), quietly = TRUE)]',
    '    if (length(scholar_missing_packages) == 0) break',
    '  }',
    '}',
    'scholar_still_missing <- scholar_required_packages[!vapply(scholar_required_packages, requireNamespace, logical(1), quietly = TRUE)]',
    'if (length(scholar_still_missing) > 0) {',
    '  stop(paste("Missing R packages after auto-install:", paste(scholar_still_missing, collapse = ", ")))',
    '}',
  ].join('\n');
}

function wrapExecutableRCode(rawCode: string): string {
  const executableUserCode = normalizeRDateAxisLabelFormatInCode(normalizeRDateCallsInCode(commentUnsafeRNarrativeLines(extractRCode(rawCode))));
  const hasExplicitPlotSave = /\b(?:safe_ggsave|ggsave|pdf|png|jpeg|jpg|tiff|svg)\s*\(/i.test(executableUserCode);
  const code = normalizeRPlotSaveCallsInCode(ensureRSafeDateHelper(executableUserCode));
  const saveHelper = /safe_ggsave\s*<-/.test(code) ? '' : R_SAFE_GGSAVE_HELPER;
  const dependencyBootstrap = buildRDependencyBootstrap(extractRRequiredPackages(code));
  const lines = [
    '# Scholar Harness R plugin execution wrapper',
    'options(stringsAsFactors = FALSE)',
    'dir.create("plots", showWarnings = FALSE, recursive = TRUE)',
    dependencyBootstrap,
    saveHelper,
    '',
    code,
    '',
  ];

  if (!hasExplicitPlotSave) {
    lines.push(
      '# Best-effort capture of the last ggplot object when the script did not call ggsave explicitly.',
      'try({',
      '  if (requireNamespace("ggplot2", quietly = TRUE)) {',
      '    p <- ggplot2::last_plot()',
      '    if (!is.null(p)) {',
      '      safe_ggsave(file.path("plots", "last_plot.png"), p, width = 8, height = 5, dpi = 600, bg = "white")',
      '      safe_ggsave(file.path("plots", "last_plot.pdf"), p, width = 8, height = 5, bg = "white")',
      '    }',
      '  }',
      '}, silent = TRUE)',
      '',
    );
  }

  return lines.join('\n');
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
      env: buildToolRuntimeEnv(process.env),
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
      artifacts.push({
        name: entry.name,
        relativePath,
        size: stat.size,
        url: `/api/r-code/artifact/${encodeURIComponent(userId)}/${encodeURIComponent(jobId)}?file=${encodeURIComponent(relativePath)}`,
        kind: getRArtifactKind(ext),
        absolutePath: fullPath,
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
    return diff || compareRArtifactPath(a, b);
  });
}

async function removeRNoiseArtifacts(jobDir: string): Promise<void> {
  await Promise.all([
    path.join(jobDir, 'Rplots.pdf'),
    path.join(jobDir, 'plots', 'Rplots.pdf'),
  ].map(async target => {
    try {
      await fs.unlink(target);
    } catch {
      // Optional R default device artifact may not exist.
    }
  }));
}

function selectRVisibleArtifacts(artifacts: RArtifact[], scriptPath?: string, dataFilePath?: string): RArtifact[] {
  const visible: RArtifact[] = [];
  const scriptName = scriptPath ? path.basename(scriptPath).toLowerCase() : '';
  const dataName = dataFilePath ? path.basename(dataFilePath).toLowerCase() : '';
  const plotFiles = artifacts.filter(file => (file.kind === 'image' || file.kind === 'pdf') && !isRNoisePlotArtifact(file));
  const imageCandidates = plotFiles.filter(file => file.kind === 'image');
  const pdfCandidates = plotFiles.filter(file => file.kind === 'pdf');

  if (imageCandidates.length > 1) {
    const imageStems = new Set(imageCandidates.map(getArtifactStem));
    imageCandidates
      .slice()
      .sort(compareRArtifactPath)
      .forEach(file => addVisibleRArtifact(visible, file));
    pdfCandidates
      .filter(file => imageStems.has(getArtifactStem(file)))
      .sort(compareRArtifactPath)
      .forEach(file => addVisibleRArtifact(visible, file));
  } else {
    const selectedImage = choosePreferredPlotArtifact(imageCandidates);
    const selectedPdf = choosePreferredPlotArtifact(
      selectedImage
        ? pdfCandidates.filter(file => getArtifactStem(file) === getArtifactStem(selectedImage))
        : pdfCandidates,
    ) || choosePreferredPlotArtifact(pdfCandidates);
    [selectedImage, selectedPdf].forEach(file => addVisibleRArtifact(visible, file));
  }

  const selectedCode = choosePreferredSupportArtifact(
    artifacts.filter(file => file.kind === 'code' && /\.r$/i.test(file.name || file.relativePath || '')),
    scriptName,
  );
  const selectedData = choosePreferredSupportArtifact(
    artifacts.filter(file => file.kind === 'data'),
    dataName,
  );

  [selectedCode, selectedData].forEach(file => addVisibleRArtifact(visible, file));
  return visible;
}

function addVisibleRArtifact(visible: RArtifact[], file: RArtifact | null): void {
  if (!file) return;
  if (!visible.some(item => item.relativePath === file.relativePath)) visible.push(file);
}

function isRNoisePlotArtifact(file: RArtifact): boolean {
  const name = path.basename(file.relativePath || file.name || '').toLowerCase();
  return name === 'rplots.pdf' || name === 'rplots.png';
}

function choosePreferredPlotArtifact(files: RArtifact[]): RArtifact | null {
  if (!files.length) return null;
  const sorted = [...files].sort((a, b) => {
    const aName = (a.relativePath || a.name || '').toLowerCase();
    const bName = (b.relativePath || b.name || '').toLowerCase();
    const aLast = aName.includes('last_plot') ? 1 : 0;
    const bLast = bName.includes('last_plot') ? 1 : 0;
    if (aLast !== bLast) return aLast - bLast;
    const aPlotDir = aName.includes('/plots/') || aName.startsWith('plots/') ? 0 : 1;
    const bPlotDir = bName.includes('/plots/') || bName.startsWith('plots/') ? 0 : 1;
    if (aPlotDir !== bPlotDir) return aPlotDir - bPlotDir;
    return b.size - a.size || compareRArtifactPath(a, b);
  });
  return sorted[0] || null;
}

function choosePreferredSupportArtifact(files: RArtifact[], preferredName: string): RArtifact | null {
  if (!files.length) return null;
  const normalizedPreferred = preferredName.toLowerCase();
  const sorted = [...files].sort((a, b) => {
    const aBase = path.basename(a.relativePath || a.name || '').toLowerCase();
    const bBase = path.basename(b.relativePath || b.name || '').toLowerCase();
    const aPreferred = normalizedPreferred && aBase === normalizedPreferred ? 0 : 1;
    const bPreferred = normalizedPreferred && bBase === normalizedPreferred ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const aRoot = (a.relativePath || '').includes('/') ? 1 : 0;
    const bRoot = (b.relativePath || '').includes('/') ? 1 : 0;
    if (aRoot !== bRoot) return aRoot - bRoot;
    return compareRArtifactPath(a, b);
  });
  return sorted[0] || null;
}

function compareRArtifactPath(a: RArtifact, b: RArtifact): number {
  const aName = a.relativePath || a.name || '';
  const bName = b.relativePath || b.name || '';
  return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
}

function getArtifactStem(file: RArtifact): string {
  const base = path.basename(file.relativePath || file.name || '').toLowerCase();
  return base.replace(/\.[^.]+$/, '');
}

function getRArtifactKind(ext: string): RArtifactKind {
  if (R_EXPORT_IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.r' || ext === '.rmd' || ext === '.json') return 'code';
  if (ext === '.csv' || ext === '.tsv' || ext === '.xls' || ext === '.xlsx') return 'data';
  if (ext === '.doc' || ext === '.docx') return 'word';
  if (ext === '.ppt' || ext === '.pptx') return 'presentation';
  if (ext === '.zip') return 'archive';
  if (ext === '.txt' || ext === '.md' || ext === '.html' || ext === '.htm') return 'text';
  return 'file';
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function getPngChannelCount(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 3) return 1;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  return 0;
}

function getPngPixel(
  row: Buffer,
  x: number,
  bitDepth: number,
  colorType: number,
  palette: Buffer | null,
): { r: number; g: number; b: number; a: number } | null {
  if (colorType === 3) {
    if (bitDepth !== 8 || !palette) return null;
    const index = row[x];
    const paletteOffset = index * 3;
    if (paletteOffset + 2 >= palette.length) return null;
    return {
      r: palette[paletteOffset],
      g: palette[paletteOffset + 1],
      b: palette[paletteOffset + 2],
      a: 255,
    };
  }

  const channels = getPngChannelCount(colorType);
  if (!channels || (bitDepth !== 8 && bitDepth !== 16)) return null;
  const bytesPerChannel = bitDepth === 16 ? 2 : 1;
  const offset = x * channels * bytesPerChannel;
  if (offset + channels * bytesPerChannel > row.length) return null;
  const readChannel = (channel: number) => row[offset + channel * bytesPerChannel];

  if (colorType === 0) {
    const gray = readChannel(0);
    return { r: gray, g: gray, b: gray, a: 255 };
  }
  if (colorType === 2) {
    return { r: readChannel(0), g: readChannel(1), b: readChannel(2), a: 255 };
  }
  if (colorType === 4) {
    const gray = readChannel(0);
    return { r: gray, g: gray, b: gray, a: readChannel(1) };
  }
  if (colorType === 6) {
    return { r: readChannel(0), g: readChannel(1), b: readChannel(2), a: readChannel(3) };
  }
  return null;
}

async function analyzePngVisualQuality(filePath: string, relativePath: string): Promise<RImageQualityResult> {
  try {
    const buffer = await fs.readFile(filePath);
    const signature = buffer.subarray(0, 8);
    if (signature.toString('hex') !== '89504e470d0a1a0a') {
      return { relativePath, suspicious: false, error: 'not a PNG file' };
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    let interlace = 0;
    let palette: Buffer | null = null;
    const idatChunks: Buffer[] = [];

    while (offset + 12 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) break;
      const data = buffer.subarray(dataStart, dataEnd);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'PLTE') {
        palette = Buffer.from(data);
      } else if (type === 'IDAT') {
        idatChunks.push(Buffer.from(data));
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4;
    }

    const channels = getPngChannelCount(colorType);
    if (!width || !height || !channels || !idatChunks.length) {
      return { relativePath, suspicious: false, width, height, error: 'PNG metadata is incomplete' };
    }
    if (interlace !== 0) {
      return { relativePath, suspicious: false, width, height, error: 'interlaced PNG skipped' };
    }
    if (!(bitDepth === 8 || bitDepth === 16 || (colorType === 3 && bitDepth === 8))) {
      return { relativePath, suspicious: false, width, height, error: `unsupported PNG bit depth ${bitDepth}` };
    }

    const bitsPerPixel = channels * bitDepth;
    const scanlineLength = Math.ceil((width * bitsPerPixel) / 8);
    const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
    const expectedMin = (scanlineLength + 1) * height;
    if (inflated.length < expectedMin) {
      return { relativePath, suspicious: false, width, height, error: 'PNG data is shorter than expected' };
    }

    const sampleStep = Math.max(1, Math.ceil(Math.sqrt((width * height) / 250_000)));
    const centerMinX = Math.floor(width * 0.16);
    const centerMaxX = Math.ceil(width * 0.94);
    const centerMinY = Math.floor(height * 0.10);
    const centerMaxY = Math.ceil(height * 0.90);
    let totalSamples = 0;
    let totalNonWhite = 0;
    let centerSamples = 0;
    let centerInk = 0;
    let centerColored = 0;
    let previousRow = Buffer.alloc(scanlineLength);

    for (let y = 0; y < height; y += 1) {
      const rowOffset = y * (scanlineLength + 1);
      const filterType = inflated[rowOffset];
      const row = Buffer.from(inflated.subarray(rowOffset + 1, rowOffset + 1 + scanlineLength));
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
        const up = previousRow[i] || 0;
        const upLeft = i >= bytesPerPixel ? previousRow[i - bytesPerPixel] || 0 : 0;
        if (filterType === 1) row[i] = (row[i] + left) & 0xff;
        else if (filterType === 2) row[i] = (row[i] + up) & 0xff;
        else if (filterType === 3) row[i] = (row[i] + Math.floor((left + up) / 2)) & 0xff;
        else if (filterType === 4) row[i] = (row[i] + paethPredictor(left, up, upLeft)) & 0xff;
      }

      if (y % sampleStep === 0) {
        for (let x = 0; x < width; x += sampleStep) {
          const pixel = getPngPixel(row, x, bitDepth, colorType, palette);
          if (!pixel || pixel.a <= 16) continue;
          totalSamples += 1;
          const maxChannel = Math.max(pixel.r, pixel.g, pixel.b);
          const minChannel = Math.min(pixel.r, pixel.g, pixel.b);
          const nonWhite = !(pixel.r >= 248 && pixel.g >= 248 && pixel.b >= 248);
          const ink = !(pixel.r >= 245 && pixel.g >= 245 && pixel.b >= 245);
          const colored = maxChannel - minChannel >= 22 && maxChannel < 250;
          if (nonWhite) totalNonWhite += 1;
          if (x >= centerMinX && x <= centerMaxX && y >= centerMinY && y <= centerMaxY) {
            centerSamples += 1;
            if (ink) centerInk += 1;
            if (colored) centerColored += 1;
          }
        }
      }
      previousRow = row;
    }

    const nonWhiteRatio = totalSamples ? totalNonWhite / totalSamples : 0;
    const centerInkRatio = centerSamples ? centerInk / centerSamples : 0;
    const centerColoredRatio = centerSamples ? centerColored / centerSamples : 0;
    const suspicious = totalSamples > 0 && (
      nonWhiteRatio < 0.0015 ||
      (centerInkRatio < 0.00035 && centerColoredRatio < 0.00008)
    );
    const reason = suspicious
      ? `主 PNG 疑似空白或有效绘图内容过少（nonWhite=${nonWhiteRatio.toFixed(5)}, centerInk=${centerInkRatio.toFixed(5)}, centerColor=${centerColoredRatio.toFixed(5)}）`
      : undefined;

    return {
      relativePath,
      suspicious,
      reason,
      width,
      height,
      nonWhiteRatio,
      centerInkRatio,
      centerColoredRatio,
    };
  } catch (error) {
    return {
      relativePath,
      suspicious: false,
      error: (error as Error).message,
    };
  }
}

async function analyzeRImageArtifacts(jobDir: string, artifacts: RArtifact[]): Promise<RImageQualityResult[]> {
  const root = path.resolve(jobDir);
  const imageArtifacts = artifacts.filter(file => file.kind === 'image' && /\.png$/i.test(file.relativePath || file.name || ''));
  const results: RImageQualityResult[] = [];
  for (const file of imageArtifacts) {
    const relativePath = file.relativePath || file.name;
    const fullPath = path.resolve(root, relativePath);
    if (!fullPath.startsWith(root + path.sep) && fullPath !== root) continue;
    results.push(await analyzePngVisualQuality(fullPath, relativePath));
  }
  return results;
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
  const registered = readRJobLocationRegistry().jobs[safeJobId];
  if (registered && sanitizeUserId(registered.userId) === safeUserId) {
    const registeredDir = path.resolve(registered.workDir);
    if (path.basename(registeredDir) === safeJobId && existsSync(registeredDir)) {
      return registeredDir;
    }
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
    const html = await requestTextWithRetry(baseUrl, {
      label: '读取 CRAN Windows 安装包列表',
      timeoutMs: 30_000,
      maxAttempts: 4,
      headers: { 'User-Agent': 'ScholarHarness' },
    });
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
    'agricolae',
    'multcompView',
    'emmeans',
    'metafor',
    'clubSandwich',
  ];
  return [
    'options(repos = c(CRAN = "https://cloud.r-project.org"), timeout = 600)',
    'scholar_user_lib <- Sys.getenv("R_LIBS_USER")',
    'if (!nzchar(scholar_user_lib)) scholar_user_lib <- file.path(Sys.getenv("LOCALAPPDATA"), "ScholarHarness", "R-library")',
    'dir.create(scholar_user_lib, recursive = TRUE, showWarnings = FALSE)',
    '.libPaths(unique(c(scholar_user_lib, .libPaths())))',
    `packages <- c(${packages.map(item => JSON.stringify(item)).join(', ')})`,
    'installed <- rownames(installed.packages())',
    'missing <- setdiff(packages, installed)',
    'cat("Required packages:", paste(packages, collapse = ", "), "\\n")',
    'if (length(missing) > 0) {',
    '  for (attempt in seq_len(3)) {',
    '    missing <- setdiff(packages, rownames(installed.packages()))',
    '    if (length(missing) == 0) break',
    '    cat("Installing missing packages (attempt", attempt, "/3):", paste(missing, collapse = ", "), "\\n")',
    '    try(install.packages(missing, dependencies = TRUE), silent = FALSE)',
    '    if (attempt < 3) Sys.sleep(2 ^ attempt)',
    '  }',
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
      await downloadFileWithRetry({
        url: installer.url,
        destination: installerPath,
        label: '下载 R 安装包',
        headers: { 'User-Agent': 'ScholarHarness' },
        maxAttempts: 4,
        timeoutMs: 120_000,
        onProgress: progress => {
          const percent = Math.min(55, Math.max(5, 5 + Math.round(progress.percent * 0.5)));
          const resumed = progress.resumed ? '（断点续传）' : '';
          updateRInstallJob({
            progress: percent,
            message: `正在下载 R 安装包 ${Math.round(progress.downloadedBytes / 1024 / 1024)}MB/${Math.round(progress.totalBytes / 1024 / 1024)}MB${resumed}`,
          });
        },
        onRetry: (attempt, maxAttempts, error) => {
          updateRInstallJob({
            message: `R 安装包连接中断，正在进行第 ${attempt}/${maxAttempts} 次尝试：${error.message}`,
          });
        },
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
    const detail = (error as Error).message;
    const actionableDetail = /下载|CRAN|ECONN|ETIMEDOUT|ENOTFOUND/i.test(detail)
      ? `${detail}。请检查 CRAN 网络访问或设置 HTTPS_PROXY；也可以手动安装 R 后点击“重新检测”。`
      : detail;
    updateRInstallJob({
      status: 'failed',
      stage: 'failed',
      progress: currentRInstallJob?.progress || 0,
      message: 'R 插件安装失败',
      error: actionableDetail,
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
        workRoot: getProjectOwnedDataDir('r-plugin'),
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
    let jobParentDir = getRDesktopArtifactRoot(userId);
    if (parsed.workspaceDirectory && parsed.workspaceOutputType === 'meta-analysis') {
      const outputId = String(parsed.workspaceOutputId || '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 120);
      if (!outputId) {
        return res.status(400).json({ success: false, error: 'Meta 分析 R 输出缺少有效的分析 ID' });
      }
      const preparedWorkspace = await prepareWorkspaceOutputDirectory(
        parseRWorkspaceDirectory(parsed.workspaceDirectory),
        ['Meta分析', 'runs', outputId, 'R图表'],
      );
      if (preparedWorkspace) jobParentDir = preparedWorkspace.outputRoot;
    } else if (parsed.workspaceDirectory && parsed.workspaceOutputType === 'bibliometrics') {
      const preparedWorkspace = await prepareWorkspaceOutputDirectory(
        parseRWorkspaceDirectory(parsed.workspaceDirectory),
        ['文献计量分析', 'R图表'],
      );
      if (preparedWorkspace) jobParentDir = preparedWorkspace.outputRoot;
    }
    const jobDir = path.join(jobParentDir, jobId);
    await fs.mkdir(jobDir, { recursive: true });
    await fs.mkdir(path.join(jobDir, 'plots'), { recursive: true });
    await rememberRJobLocation(userId, jobId, jobDir);

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
    } else if (parsed.sourceDataFilePath) {
      const resolvedSourceDataFile = path.resolve(parsed.sourceDataFilePath);
      if (!existsSync(resolvedSourceDataFile)) {
        return res.status(400).json({
          success: false,
          error: `上一次 R 作图数据文件不存在：${resolvedSourceDataFile}`,
        });
      }
      const sourceFilename = sanitizeRDataFilename(parsed.dataFilename || path.basename(resolvedSourceDataFile));
      dataFilePath = path.join(jobDir, sourceFilename);
      await fs.copyFile(resolvedSourceDataFile, dataFilePath);
    }

    logger.info(`[RCodePlugin] Executing R script: ${scriptPath}`);
    const result = await runProcess(status.path, [scriptPath], jobDir, parsed.timeoutMs || 180_000);
    void getRPackageMemoryForPrompt(userId)
      .then(memory => logger.info(`[RCodePlugin] R package memory refreshed after execution: ${memory.packageCount} packages`))
      .catch(error => logger.warn(`[RCodePlugin] Failed to refresh R package memory after execution: ${(error as Error).message}`));
    await removeRNoiseArtifacts(jobDir);
    const allArtifacts = await collectRArtifacts(jobDir, userId, jobId);
    const artifacts = selectRVisibleArtifacts(allArtifacts, scriptPath, dataFilePath);
    const imageFiles = artifacts.filter(file => file.kind === 'image');
    const supportFiles = artifacts.filter(file => file.kind !== 'image');
    const imageQuality = await analyzeRImageArtifacts(jobDir, artifacts);
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
      imageQuality,
    };

    if (result.timedOut || result.exitCode !== 0) {
      return res.status(500).json({
        success: false,
        error: result.timedOut ? 'R 执行超时' : `R 执行失败，退出码 ${result.exitCode}`,
        data: payload,
      });
    }
    if (!imageFiles.length) {
      return res.status(500).json({
        success: false,
        error: 'R 图像质量检查失败：脚本执行成功，但没有生成 PNG/JPG/SVG 等图片文件',
        data: payload,
      });
    }
    const suspiciousImage = imageQuality.find(item => item.suspicious);
    if (suspiciousImage) {
      return res.status(500).json({
        success: false,
        error: `R 图像质量检查失败：${suspiciousImage.reason || `${suspiciousImage.relativePath} 疑似空白`}`,
        data: payload,
      });
    }

    const researchSession = await recordRExecutionResearchProvenance({
      userId,
      researchSessionId: parsed.researchSessionId,
      parsed,
      payload,
    }).catch((error) => {
      logger.warn('[ResearchSession] Failed to record R execution provenance:', error);
      return undefined;
    });

    res.json({ success: true, data: { ...payload, researchSession } });
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
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
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
      analysisSignificance,
      treatmentPaletteConfig,
      researchSessionId,
      sourceDataFilePath
    } = req.body;

    // 调试日志
    logger.info(`[RCode] Request body fields: ${JSON.stringify({ userId, chartType, analysisType, workDir, dataFilename, themeId, sourceDataFilePath: sourceDataFilePath ? 'set' : '' })}`);
    logger.info(`[RCode] File received: ${file ? file.originalname : 'NO FILE'}`);
    logger.info(`[RCode] Theme code provided: ${themeCode ? 'YES' : 'NO'}`);

    let dataBuffer: Buffer | null = file?.buffer || null;
    let originalFilename = file?.originalname || '';
    let resolvedSourceDataFile = '';
    if (!dataBuffer && typeof sourceDataFilePath === 'string' && sourceDataFilePath.trim()) {
      resolvedSourceDataFile = path.resolve(sourceDataFilePath.trim());
      if (!existsSync(resolvedSourceDataFile)) {
        return res.status(400).json({
          success: false,
          error: `数据文件不存在：${resolvedSourceDataFile}`,
        });
      }
      const ext = path.extname(resolvedSourceDataFile).toLowerCase();
      if (!['.xlsx', '.xls', '.csv', '.tsv', '.txt'].includes(ext)) {
        return res.status(400).json({
          success: false,
          error: `当前 R 作图生成仅支持 Excel/CSV/TXT/TSV 数据文件：${path.basename(resolvedSourceDataFile)}`,
        });
      }
      dataBuffer = await fs.readFile(resolvedSourceDataFile);
      originalFilename = path.basename(resolvedSourceDataFile);
    }

    if (!dataBuffer || !originalFilename) {
      return res.status(400).json({
        success: false,
        error: '请上传 Excel/CSV 文件，或提供 sourceDataFilePath',
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

    logger.info(`[RCode] Processing file: ${originalFilename} for user: ${userId}${resolvedSourceDataFile ? ` | source=${resolvedSourceDataFile}` : ''}`);
    logger.info(`[RCode] Chart type: ${chartType}, Analysis: ${analysisType}`);
    logger.info(`[RCode] API URL: ${apiUrl}, Model: ${model}`);

    // 解析 Excel 数据结构
    const dataStructure = await parseExcelStructure(dataBuffer, originalFilename);
    logger.info(`[RCode] Parsed ${dataStructure.rowCount} rows, ${dataStructure.columns.length} columns`);
    const effectiveDataFilename = typeof dataFilename === 'string' && dataFilename.trim()
      ? dataFilename.trim()
      : originalFilename;
    const rPackageMemory = await getRPackageMemoryForPrompt(userId);
    logger.info(`[RCode] R package memory refreshed: ${rPackageMemory.packageCount} packages${rPackageMemory.error ? `, ${rPackageMemory.error}` : ''}`);

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
      },
      typeof treatmentPaletteConfig === 'string' ? treatmentPaletteConfig : undefined,
      rPackageMemory
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

    // 调用 AI API 生成 R 代码。使用 http/https 而不是 fetch，避免 undici 默认 10 秒连接超时导致裸 fetch failed。
    const aiData = await requestRChatCompletion(chatEndpoint, apiKey, {
      model: model || 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 32000,
    }, 'RCode');
    const rCode = enforceRCodeGuardrails(aiData.choices?.[0]?.message?.content || '');

    if (!rCode) {
      return res.status(500).json({
        success: false,
        error: 'AI 未返回有效代码',
      });
    }

    logger.info(`[RCode] Generated R code, length: ${rCode.length}`);

    const researchSession = await recordRGenerationResearchProvenance({
      userId: sanitizeUserId(userId || 'web-user'),
      researchSessionId: typeof researchSessionId === 'string' ? researchSessionId : undefined,
      filename: originalFilename,
      dataFilename: effectiveDataFilename,
      chartType,
      analysisType,
      customRequirements,
      model: model || 'gpt-4o',
      prompt,
      rCode,
      dataStructure: {
        columns: dataStructure.columns,
        rowCount: dataStructure.rowCount,
        previewRowCount: dataStructure.previewRowCount,
        sheetNames: dataStructure.sheetNames,
      },
      linkedFromDataAnalysis: linkedFromDataAnalysis === 'true' || linkedFromDataAnalysis === true,
    }).catch((error) => {
      logger.warn('[ResearchSession] Failed to record R generation provenance:', error);
      return undefined;
    });

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
        filename: originalFilename,
        dataFilename: effectiveDataFilename,
        sourceDataFilePath: resolvedSourceDataFile || undefined,
        rPackageMemory: summarizeRPackageMemoryForResponse(rPackageMemory),
        researchSession,
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
    const { userId, apiUrl, apiKey, model, codePath, existingCode: existingCodeBody, customRequirements, dataFilename, themeCode, themeId, treatmentPaletteConfig } = req.body;

    // 调试日志
    logger.info(`[RCodeDebug] Request for user: ${userId}`);
    logger.info(`[RCodeDebug] Code path: ${codePath}`);
    logger.info(`[RCodeDebug] Requirements: ${customRequirements}`);

    const inlineExistingCode = typeof existingCodeBody === 'string' ? existingCodeBody.trim() : '';
    if (!codePath && !inlineExistingCode) {
      return res.status(400).json({
        success: false,
        error: '请填写 R 代码文件路径或提供已有 R 代码',
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
      if (inlineExistingCode) {
        existingCode = inlineExistingCode;
        logger.info(`[RCodeDebug] Using inline existing code, length: ${existingCode.length}`);
      } else {
      existingCode = await fs.readFile(codePath, 'utf-8');
      logger.info(`[RCodeDebug] Read existing code, length: ${existingCode.length}`);
      }
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
    const treatmentPaletteSection = buildTreatmentPalettePromptSection(typeof treatmentPaletteConfig === 'string' ? treatmentPaletteConfig : undefined);
    const rPackageMemory = await getRPackageMemoryForPrompt(userId);
    logger.info(`[RCodeDebug] R package memory refreshed: ${rPackageMemory.packageCount} packages${rPackageMemory.error ? `, ${rPackageMemory.error}` : ''}`);
    const debugPrompt = `你是一个专业的 R 语言数据可视化专家。用户有一段已有的 R 作图代码，需要根据具体要求进行调整。

## 已有代码

\`\`\`r
${existingCode}
\`\`\`

## 用户需求

${customRequirements}

${treatmentPaletteSection ? `${treatmentPaletteSection}
` : ''}

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

${buildRPackageMemoryPromptSection(rPackageMemory)}

${R_USER_QUERY_PRIORITY_GUIDE}

${R_FONT_GUIDE}

${R_LEGEND_PLACEMENT_GUIDE}

${R_DATE_AXIS_GUIDE}

${R_ERROR_BAR_GUIDE}

${R_PACKAGE_DEPENDENCY_GUIDE}

${R_DATA_FORMAT_PLOT_SAFETY_GUIDE}

## 任务要求

1. **保持代码结构完整**：不要删除或大幅改动已有代码的核心逻辑
2. **只针对用户需求修改**：根据用户描述的具体问题进行调整
3. **保留注释**：保持原有的注释，可以添加新的注释说明修改内容
4. **输出完整代码**：返回修改后的完整 R 代码（不要只输出修改片段）
5. **统一主题对象**：所有 ggplot 图形统一使用 \`${ACTIVE_R_THEME_NAME}\`；如果启用了 Nature-skill，优先调整配色、标签、图例和导出规格
6. **数据预处理与清洗**：如原代码缺少数据检查，请补充列名清理、缺失值检查、重复行检查、变量类型转换和适合 ggplot2 的 \`data_clean\` 数据对象，确保后续作图代码使用结构正确的数据
7. **表头单位处理**：如果表头包含单位、括号、斜杠、百分号或中文单位，请把单位从代码变量名中分离出来；清洗后的列名用于 R 安全引用，原始变量名和单位保存在标签映射中，并显示在坐标轴标题、图例标题或 facet 标签里
8. **图例位置**：如原代码把图例放在图中间或遮挡数据，必须改到左上角、右上角、图外顶部或图外右侧；图内位置需要根据数据密度选择较空的一侧
9. **日期轴处理**：如原代码把日期当作离散字符或显示全部日期标签，必须改成连续日期轴，设置合理的 \`date_breaks\` 和 \`date_labels = "%Y-%m-%d"\`，默认用 2026-03-02 这种 ISO 日期格式，避免横坐标重叠和中文月份格式
10. **字体处理**：所有英文字母和数字必须使用 Times New Roman；如原代码使用 Arial、sans、serif 或默认字体，必须替换为显式 \`font_family <- "Times New Roman"\` 并应用到 theme
11. **保存尺寸处理**：如原代码的 \`ggsave()\` 使用了像素式宽高或超过 50 英寸的尺寸，必须改为 \`safe_ggsave()\`，并把 width/height 调整为合理英寸范围

## 输出格式

- 只输出一个 markdown 代码块，语言标记为 \`\`\`r
- 代码块外不要写任何解释、标题、修改说明、注意事项或 markdown 列表
- 代码内部的说明必须使用 R 注释（以 \`#\` 开头）
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
    const aiData = await requestRChatCompletion(chatEndpoint, apiKey, {
      model: model || 'gpt-4o',
      messages: [{ role: 'user', content: debugPrompt }],
      temperature: 0.7,
      max_tokens: 32000,
    }, 'RCodeDebug');
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
        rPackageMemory: summarizeRPackageMemoryForResponse(rPackageMemory),
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

async function recordRGenerationResearchProvenance(input: {
  userId: string;
  researchSessionId?: string;
  filename: string;
  dataFilename: string;
  chartType: unknown;
  analysisType: unknown;
  customRequirements: unknown;
  model: string;
  prompt: string;
  rCode: string;
  dataStructure: {
    columns?: Array<{ name?: string; type?: string }>;
    rowCount?: number;
    previewRowCount?: number;
    sheetNames?: string[];
  };
  linkedFromDataAnalysis: boolean;
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactId: string }> {
  const dataRef = {
    label: input.dataFilename || input.filename,
    columns: Array.isArray(input.dataStructure.columns)
      ? input.dataStructure.columns.map(column => String(column.name || '')).filter(Boolean)
      : undefined,
    rowCount: input.dataStructure.rowCount,
    metadata: {
      previewRowCount: input.dataStructure.previewRowCount,
      sheetNames: input.dataStructure.sheetNames,
    },
  };
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.researchSessionId,
    sessionTitle: `R 作图：${input.filename}`,
    targetType: 'r-code',
    targetId: `r-generate-${Date.now()}`,
    operation: 'r-code.generate',
    sourceModule: 'r-code',
    input: {
      filename: input.filename,
      chartType: input.chartType,
      analysisType: input.analysisType,
      customRequirements: input.customRequirements,
      dataStructure: input.dataStructure,
      linkedFromDataAnalysis: input.linkedFromDataAnalysis,
    },
    output: {
      rCode: input.rCode,
    },
    model: input.model,
    prompt: input.prompt,
    dataRefs: [dataRef],
    codeRefs: [{ language: 'R', metadata: { generated: true } }],
    metadata: {
      linkedFromDataAnalysis: input.linkedFromDataAnalysis,
    },
  });
  const artifact = await researchSessionManager.appendArtifact({
    userId: input.userId,
    sessionId: provenance.session.id,
    kind: 'r-code',
    name: `${input.filename} R code`,
    content: input.rCode,
    contentType: 'text/x-r',
    input: {
      chartType: input.chartType,
      analysisType: input.analysisType,
      customRequirements: input.customRequirements,
    },
    provenanceRecordIds: [provenance.record.id],
    metadata: {
      filename: input.filename,
      dataFilename: input.dataFilename,
    },
  });
  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
    artifactId: artifact.artifact.id,
  };
}

async function recordRExecutionResearchProvenance(input: {
  userId: string;
  researchSessionId?: string;
  parsed: z.infer<typeof rExecuteSchema>;
  payload: {
    jobId: string;
    workDir: string;
    scriptPath: string;
    dataFilePath: string;
    exitCode: number | null;
    timedOut: boolean;
    stdout: string;
    stderr: string;
    files: RArtifact[];
    imageFiles: RArtifact[];
    imageQuality: unknown[];
  };
}): Promise<{ sessionId: string; provenanceRecordId: string; artifactIds: string[]; reviewerReportId: string }> {
  const codeRef = {
    language: 'R' as const,
    filePath: input.payload.scriptPath,
    command: `Rscript ${input.payload.scriptPath}`,
    metadata: {
      jobId: input.payload.jobId,
      workDir: input.payload.workDir,
    },
  };
  const dataRefs = input.payload.dataFilePath
    ? [{
        label: path.basename(input.payload.dataFilePath),
        filePath: input.payload.dataFilePath,
      }]
    : [];
  const provenance = await researchSessionManager.appendProvenance({
    userId: input.userId,
    sessionId: input.researchSessionId,
    sessionTitle: `R 执行：${input.payload.jobId}`,
    targetType: 'figure',
    targetId: input.payload.jobId,
    operation: 'r-code.execute',
    sourceModule: 'r-code',
    input: {
      filename: input.parsed.filename,
      timeoutMs: input.parsed.timeoutMs,
      sourceDataFilePath: input.parsed.sourceDataFilePath,
    },
    output: {
      exitCode: input.payload.exitCode,
      timedOut: input.payload.timedOut,
      stdout: input.payload.stdout,
      stderr: input.payload.stderr,
      files: input.payload.files,
      imageQuality: input.payload.imageQuality,
    },
    dataRefs,
    codeRefs: [codeRef],
    metadata: {
      imageCount: input.payload.imageFiles.length,
      fileCount: input.payload.files.length,
    },
  });
  const artifactIds: string[] = [];
  for (const file of input.payload.imageFiles) {
    const artifact = await researchSessionManager.appendArtifact({
      userId: input.userId,
      sessionId: provenance.session.id,
      kind: 'figure',
      name: file.relativePath,
      filePath: path.join(input.payload.workDir, file.relativePath),
      contentType: inferRImageContentType(file.relativePath),
      input: {
        jobId: input.payload.jobId,
        scriptPath: input.payload.scriptPath,
        dataFilePath: input.payload.dataFilePath,
      },
      provenanceRecordIds: [provenance.record.id],
      metadata: {
        size: file.size,
        kind: file.kind,
      },
    });
    artifactIds.push(artifact.artifact.id);
  }
  const review = await researchSessionManager.runReviewer(input.userId, provenance.session.id);
  return {
    sessionId: provenance.session.id,
    provenanceRecordId: provenance.record.id,
    artifactIds,
    reviewerReportId: review.report.id,
  };
}

function inferRImageContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'image/*';
}

export default router;
