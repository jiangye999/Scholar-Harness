/**
 * 实验结果 AI 分析服务
 * 
 * 功能：调用 AI API (小牛马) 分析上传的实验结果文件，
 * 提取结构化的论文结果信息。
 */

import mammoth = require('mammoth');

import { logger } from '../../utils/logger';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';

// ============ 类型定义 ============

export interface ExperimentAnalysisInput {
  fileBuffer: Buffer;
  fileName: string;
  fileType: 'image' | 'pdf' | 'word' | 'table' | 'text' | 'unknown';
  apiUrl: string;
  apiKey: string;
  model: string;
  savedPath?: string;
  extractedText?: string;
  extractionSource?: string;
  userInstruction?: string;
}

export interface ExperimentAnalysisResult {
  fileName: string;
  fileType: string;
  savedPath?: string;
  materialPassport?: {
    fileName: string;
    fileType: string;
    source: string;
    savedPath?: string;
    analysisProvider?: string;
    visionModel?: string;
    extractionSource?: string;
    confidence: 'high' | 'medium' | 'low';
    uncertainItems: string[];
    includeInWriting: boolean;
    linkedChapters: string[];
    createdAt: string;
  };
  paper_title: string;
  results: Array<{
    task?: string;
    dataset?: string;
    split_or_setting?: string;
    model_name?: string;
    baseline_or_proposed?: string;
    metric_name?: string;
    metric_value?: string;
    unit?: string;
    higher_is_better?: boolean | null;
    table_or_figure_id?: string;
    result_type?: string;
    compared_to?: string;
    improvement_value?: string;
    significance?: string;
    caption?: string;
    evidence_text?: string;
    page_or_location?: string;
    confidence?: 'high' | 'medium' | 'low';
    uncertainty_note?: string;
  }>;
  overall_summary: {
    main_findings: string[];
    best_model_claims: string[];
    ablation_findings: string[];
    robustness_findings: string[];
    efficiency_findings: string[];
    uncertain_items: string[];
  };
  analysisProvider?: string;
  fallbackAttempts?: string[];
  error?: string;
}

// ============ 分析提示词 ============

const ANALYSIS_PROMPT = `你是一名严谨的学术信息抽取助手。你的任务是从我提供的论文页面、截图、图片、表格或PDF片段中，尽可能准确地提取"结果（Results）"相关信息，并输出为结构化数据。

请严格遵守以下规则：

一、任务目标
1. 只提取论文中与"实验结果 / Results / Findings / Performance / Evaluation / Ablation / Comparison"相关的信息。
2. 优先识别并提取：
   - 结果表格
   - 图中的定量结果
   - 图注、表注中的关键信息
   - 正文中对结果的总结
3. 如果同一结果同时出现在正文和表图中，优先以表格/图中的原始数值为准，并保留正文解释。
4. 不要编造、补全或猜测缺失数据。看不清、无法确认、图片模糊时必须明确标注"不确定"。

二、提取范围
请尽量提取以下字段：
- paper_title：论文标题
- task：任务名称
- dataset：数据集名称
- split_or_setting：实验设置/数据划分/评测条件
- model_name：模型名称
- baseline_or_proposed：是基线方法、已有方法，还是本文方法
- metric_name：指标名称（如 Accuracy, F1, BLEU, ROUGE, AUC, mAP 等）
- metric_value：指标数值
- unit：单位（如 %, points；若无则留空）
- higher_is_better：该指标是否越高越好（true/false/null）
- table_or_figure_id：结果来自哪个表/图（如 Table 2, Fig. 3）
- result_type：main_result / ablation / robustness / efficiency / error_analysis / case_study / other
- compared_to：比较对象（若有）
- improvement_value：提升值（若文中明确给出）
- significance：统计显著性信息（如 p<0.05）
- caption：图注/表注原文
- evidence_text：支撑该结果的原文片段
- page_or_location：页码或所在位置
- confidence：high / medium / low
- uncertainty_note：不确定原因（如"表格右侧模糊""图例难辨认"）

三、抽取原则
1. 保持原意，不改写数值。
2. 数值必须保留原始格式：
   - 例如 91.2%、0.912、12.3 ± 0.4 都原样保留
3. 如果一个单元格包含多个值（如 mean ± std），整体保留到 metric_value。
4. 如果一个表格有多列指标，为每个"模型-数据集-指标"组合单独输出一条记录。
5. 如果图中只有趋势没有明确数值：
   - 可以总结趋势
   - 但 metric_value 填 null
   - 并在 uncertainty_note 中说明"图中未给出明确数值"
6. 如果无法确认某一列/某一行含义，不要猜，标记为 null 并说明原因。
7. 如果结果不是本文最终结果而是消融/附加实验，必须在 result_type 中标明。
8. 不要把方法介绍、数据集介绍、相关工作误提取为结果。

四、表格处理要求
看到表格时，请：
1. 先识别表号和表标题
2. 识别表头层级
3. 对跨列、跨行表头进行正确展开
4. 将每一行转换成清晰的结构化记录
5. 标记最佳值、次优值（若论文有加粗/下划线/颜色提示，则在备注中说明）
6. 若表中包含：
   - 平均值
   - 标准差
   - 显著性标记
   - 参数量
   - 推理速度
   - FLOPs
   也应提取，并在 metric_name 中准确区分

五、图片处理要求
看到曲线图、柱状图、散点图、热力图时，请：
1. 先识别图号和图标题
2. 提取图例中的模型/方法名称
3. 提取坐标轴名称和单位
4. 若图中有明确标注数值，提取数值
5. 若没有明确数值，只总结可确认趋势，例如：
   - "本文方法在所有噪声强度下均优于基线"
   - "随着参数增加，性能先升后降"
6. 趋势总结必须基于可见内容，禁止脑补

六、输出格式
请按以下 JSON 输出，必须是合法 JSON，不要输出额外解释文字：

{
  "paper_title": "",
  "results": [
    {
      "task": "",
      "dataset": "",
      "split_or_setting": "",
      "model_name": "",
      "baseline_or_proposed": "",
      "metric_name": "",
      "metric_value": "",
      "unit": "",
      "higher_is_better": null,
      "table_or_figure_id": "",
      "result_type": "",
      "compared_to": "",
      "improvement_value": "",
      "significance": "",
      "caption": "",
      "evidence_text": "",
      "page_or_location": "",
      "confidence": "",
      "uncertainty_note": ""
    }
  ],
  "overall_summary": {
    "main_findings": [],
    "best_model_claims": [],
    "ablation_findings": [],
    "robustness_findings": [],
    "efficiency_findings": [],
    "uncertain_items": []
  }
}

七、质量控制
输出前请自检：
1. 是否把每个结果拆成独立记录
2. 是否遗漏表号/图号
3. 是否混淆模型名、数据集名、指标名
4. 是否有任何猜测性补全
5. 是否对不确定内容做了标记

八、当信息不足时
如果图片模糊、表格截断、页码缺失或信息不全，请照样输出能确认的部分，但：
- 不确定字段填 null 或空字符串
- 在 confidence 中降低等级
- 在 uncertainty_note 中说明原因

现在开始处理我接下来提供的论文内容。`;

// ============ 核心分析函数 ============

/**
 * 分析实验结果文件
 */
export async function analyzeExperimentResults(input: ExperimentAnalysisInput): Promise<ExperimentAnalysisResult> {
  const { fileBuffer, fileName, fileType, apiUrl, apiKey, model, extractedText, extractionSource, userInstruction } = input;
  
  logger.info(`[ExperimentAnalyzer] Analyzing ${fileName} (${fileType}, ${fileBuffer.length} bytes)`);
  
  try {
    // 构建消息内容
    const messageContent = await buildMessageContent(fileBuffer, fileName, fileType, extractedText, extractionSource, userInstruction);
    
    if (!messageContent) {
      return {
        fileName,
        fileType,
        paper_title: '',
        results: [],
        overall_summary: {
          main_findings: [],
          best_model_claims: [],
          ablation_findings: [],
          robustness_findings: [],
          efficiency_findings: [],
          uncertain_items: [`无法处理文件类型: ${fileType}`],
        },
        error: `无法处理文件类型: ${fileType}`,
      };
    }
    
    // 调用 AI API
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model,
        messages: [
          {
            role: 'system',
            content: ANALYSIS_PROMPT,
          },
          messageContent,
        ],
        temperature: 0.1,  // 低温度确保准确提取
        max_tokens: 32000,  // 使用项目统一最高输出上限
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`[ExperimentAnalyzer] API error (${response.status}): ${errorText}`);
      return {
        fileName,
        fileType,
        paper_title: '',
        results: [],
        overall_summary: {
          main_findings: [],
          best_model_claims: [],
          ablation_findings: [],
          robustness_findings: [],
          efficiency_findings: [],
          uncertain_items: [`API 调用失败: ${response.status}`],
        },
        error: `API 调用失败: ${response.status}`,
      };
    }
    
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const aiResponse = data.choices?.[0]?.message?.content || '';
    
    // 解析 AI 返回的 JSON
    const parsedResult = parseAnalysisResponse(aiResponse);
    
    logger.info(`[ExperimentAnalyzer] Analysis complete for ${fileName}: ${parsedResult.results?.length || 0} results extracted`);
    
    return {
      fileName,
      fileType,
      paper_title: parsedResult.paper_title || '',
      results: parsedResult.results || [],
      overall_summary: {
        main_findings: parsedResult.overall_summary?.main_findings || [],
        best_model_claims: parsedResult.overall_summary?.best_model_claims || [],
        ablation_findings: parsedResult.overall_summary?.ablation_findings || [],
        robustness_findings: parsedResult.overall_summary?.robustness_findings || [],
        efficiency_findings: parsedResult.overall_summary?.efficiency_findings || [],
        uncertain_items: parsedResult.overall_summary?.uncertain_items || [],
      },
      analysisProvider: `api:${model}`,
    };
    
  } catch (error) {
    logger.error(`[ExperimentAnalyzer] Analysis failed for ${fileName}:`, error);
    return {
      fileName,
      fileType,
      paper_title: '',
      results: [],
      overall_summary: {
        main_findings: [],
        best_model_claims: [],
        ablation_findings: [],
        robustness_findings: [],
        efficiency_findings: [],
        uncertain_items: [`分析失败: ${(error as Error).message}`],
      },
      error: (error as Error).message,
    };
  }
}

/**
 * 使用本机 Codex CLI 分析实验结果文件。
 * 主要用于主页上传按钮的默认优先引擎；失败时由路由层降级到小牛马/大牛马 API。
 */
export async function analyzeExperimentResultsWithCodex(input: ExperimentAnalysisInput): Promise<ExperimentAnalysisResult> {
  const { fileName, fileType } = input;

  logger.info(`[ExperimentAnalyzer] Analyzing ${fileName} (${fileType}) with Codex CLI`);

  try {
    const prompt = await buildCodexAnalysisPrompt(input);
    const aiResponse = await chatBridge.chat({
      forceProvider: 'codex',
      disableFallback: true,
      codexTimeoutMs: 300000,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      maxTokens: 32000,
    });

    const parsedResult = parseAnalysisResponse(aiResponse);

    logger.info(`[ExperimentAnalyzer] Codex analysis complete for ${fileName}: ${parsedResult.results?.length || 0} results extracted`);

    return {
      fileName,
      fileType,
      paper_title: parsedResult.paper_title || '',
      results: parsedResult.results || [],
      overall_summary: {
        main_findings: parsedResult.overall_summary?.main_findings || [],
        best_model_claims: parsedResult.overall_summary?.best_model_claims || [],
        ablation_findings: parsedResult.overall_summary?.ablation_findings || [],
        robustness_findings: parsedResult.overall_summary?.robustness_findings || [],
        efficiency_findings: parsedResult.overall_summary?.efficiency_findings || [],
        uncertain_items: parsedResult.overall_summary?.uncertain_items || [],
      },
      analysisProvider: 'codex-cli',
    };
  } catch (error) {
    logger.warn(`[ExperimentAnalyzer] Codex analysis failed for ${fileName}:`, error);
    return {
      fileName,
      fileType,
      paper_title: '',
      results: [],
      overall_summary: {
        main_findings: [],
        best_model_claims: [],
        ablation_findings: [],
        robustness_findings: [],
        efficiency_findings: [],
        uncertain_items: [`Codex CLI 分析失败: ${(error as Error).message}`],
      },
      analysisProvider: 'codex-cli',
      error: (error as Error).message,
    };
  }
}

/**
 * 构建发送给 AI 的消息内容
 * 
 * 根据文件类型构建不同的消息格式：
 * - 图片：使用 base64 编码，发送 image_url 格式
 * - PDF/Word：提取文本内容发送（如果模型支持）
 * - 表格/文本：直接发送文本
 */
async function buildMessageContent(
  fileBuffer: Buffer,
  fileName: string,
  fileType: string,
  extractedText?: string,
  extractionSource?: string,
  userInstruction?: string
): Promise<{ role: string; content: string | Array<any> } | null> {
  const instructionSection = buildUserInstructionSection(userInstruction);
  
  // 图片类型 - 使用 base64 编码
  if (fileType === 'image') {
    const base64Data = fileBuffer.toString('base64');
    const mimeType = getMimeType(fileName);
    
    return {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请分析以下实验结果图片 "${fileName}"，提取结构化的实验数据。${instructionSection}`,
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Data}`,
          },
        },
      ],
    };
  }
  
  // PDF 类型 - 使用调用方预处理后的 TextIn 解析文本
  if (fileType === 'pdf') {
    if (extractedText?.trim()) {
      return buildTextAnalysisMessage(fileName, extractedText, extractionSource || 'TextIn PDF 解析结果', userInstruction);
    }

    return {
      role: 'user',
      content: `请分析以下 PDF 文件中的实验结果内容。

文件名: ${fileName}
文件大小: ${fileBuffer.length} bytes
${instructionSection}

注意：该 PDF 没有可用的 TextIn 解析文本。请不要编造结果，只能根据当前可见信息输出不确定项。

如果内容无法确认，请在 uncertain_items 中说明需要先配置或重试 TextIn PDF 解析。`,
    };
  }
  
  // Word 类型 - 抽取正文后分析
  if (fileType === 'word') {
    let wordText = extractedText?.trim() || '';
    let wordSource = extractionSource || 'Word 正文抽取';

    if (!wordText) {
      try {
        const result = await mammoth.extractRawText({ buffer: fileBuffer });
        wordText = normalizeExtractedText(result.value);
        if (result.messages.length > 0) {
          logger.warn(`[ExperimentAnalyzer] Word parse warnings for ${fileName}: ${result.messages.map(m => m.message).join('; ')}`);
        }
      } catch (error) {
        logger.warn(`[ExperimentAnalyzer] Failed to extract Word text for ${fileName}:`, error);
        wordSource = 'Word 正文抽取失败';
      }
    }

    if (wordText) {
      return buildTextAnalysisMessage(fileName, wordText, wordSource, userInstruction);
    }

    return {
      role: 'user',
      content: `请分析以下 Word 文档中的实验结果内容。

文件名: ${fileName}
文件大小: ${fileBuffer.length} bytes
${instructionSection}

注意：系统未能从该 Word 文档中抽取到可分析的正文。请不要编造结果。

请在 uncertain_items 中说明需要用户上传可解析的 .docx 文档，或将旧版 .doc 转换为 .docx/txt 后重试。`,
    };
  }
  
  // 表格/文本类型 - 直接发送内容
  if (fileType === 'table' || fileType === 'text') {
    const textContent = fileBuffer.toString('utf-8');
    
    const truncatedContent = truncateText(textContent);
    
    return {
      role: 'user',
      content: `请分析以下实验结果数据：

文件名: ${fileName}
${instructionSection}

内容：
${truncatedContent}

请提取结构化的实验数据。`,
    };
  }
  
  // 其他类型
  return {
    role: 'user',
    content: `请分析文件 "${fileName}" (类型: ${fileType}, 大小: ${fileBuffer.length} bytes) 中的实验结果内容。${instructionSection}`,
  };
}

function buildTextAnalysisMessage(
  fileName: string,
  textContent: string,
  source: string,
  userInstruction?: string
): { role: string; content: string } {
  const normalizedText = normalizeExtractedText(textContent);
  const truncatedContent = truncateText(normalizedText);
  const instructionSection = buildUserInstructionSection(userInstruction);

  return {
    role: 'user',
    content: `请分析以下实验结果文档内容：

文件名: ${fileName}
文本来源: ${source}
${instructionSection}

内容：
${truncatedContent}

请提取结构化的实验数据。`,
  };
}

async function buildCodexAnalysisPrompt(input: ExperimentAnalysisInput): Promise<string> {
  const messageContent = await buildMessageContent(
    input.fileBuffer,
    input.fileName,
    input.fileType,
    input.extractedText,
    input.extractionSource,
    input.userInstruction
  );

  let userContent = '';
  if (Array.isArray(messageContent?.content)) {
    const textParts = messageContent.content
      .filter((part: any) => part?.type === 'text' && part.text)
      .map((part: any) => String(part.text))
      .join('\n\n');
    userContent = `${textParts}

本地文件路径: ${input.savedPath || '未保存本地路径'}
文件大小: ${input.fileBuffer.length} bytes

请优先直接读取本地文件路径中的内容进行分析；如果当前 Codex CLI 环境无法读取图片/PDF/Word 文件，请只输出合法 JSON，并在 overall_summary.uncertain_items 中说明需要降级到小牛马/大牛马 API。`;
  } else {
    userContent = String(messageContent?.content || '');
    if (input.savedPath) {
      userContent += `\n\n本地文件路径: ${input.savedPath}`;
    }
  }

  return `${ANALYSIS_PROMPT}

---

${userContent}

请只输出一个合法 JSON 对象，不要输出 Markdown 代码围栏或额外解释。`;
}

function buildUserInstructionSection(userInstruction?: string): string {
  const instruction = String(userInstruction || '').trim();
  if (!instruction) return '';
  return `

用户随文件提交的补充要求/问题：
${truncateText(instruction, 12000)}

请在抽取实验结果时同时考虑这段要求；如果用户要求数据分析或 R 语言作图，请优先提取可支持后续统计分析、显著性标注和作图的变量、分组、单位、统计结果与原始证据。`;
}

function truncateText(text: string, maxLength = 20000): string {
  return text.length > maxLength
    ? `${text.substring(0, maxLength)}\n... [内容已截断，总长度: ${text.length} 字符]`
    : text;
}

function normalizeExtractedText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

/**
 * 获取文件的 MIME 类型
 */
function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  
  const mimeTypes: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'webp': 'image/webp',
    'tiff': 'image/tiff',
    'tif': 'image/tiff',
    'heic': 'image/heic',
    'heif': 'image/heif',
    'svg': 'image/svg+xml',
  };
  
  return mimeTypes[ext] || 'image/png';  // 默认使用 PNG
}

/**
 * 解析 AI 返回的分析结果
 */
function parseAnalysisResponse(responseText: string): {
  paper_title?: string;
  results?: Array<any>;
  overall_summary?: {
    main_findings?: string[];
    best_model_claims?: string[];
    ablation_findings?: string[];
    robustness_findings?: string[];
    efficiency_findings?: string[];
    uncertain_items?: string[];
  };
} {
  try {
    // 尝试提取 JSON 部分
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      
      // 验证基本结构
      if (parsed.paper_title !== undefined && parsed.results !== undefined) {
        return parsed;
      }
    }
    
    // 如果 JSON 解析失败，尝试从文本中提取关键信息
    logger.warn('[ExperimentAnalyzer] Failed to parse JSON, attempting text extraction');
    
    return {
      paper_title: '',
      results: [],
      overall_summary: {
        main_findings: ['AI 响应解析失败，原始内容可能包含有用信息'],
        uncertain_items: [responseText.substring(0, 500)],
      },
    };
    
  } catch (error) {
    logger.error('[ExperimentAnalyzer] Parse error:', error);
    
    return {
      paper_title: '',
      results: [],
      overall_summary: {
        uncertain_items: [`解析失败: ${(error as Error).message}`],
      },
    };
  }
}

export default {
  analyzeExperimentResults,
  analyzeExperimentResultsWithCodex,
};
