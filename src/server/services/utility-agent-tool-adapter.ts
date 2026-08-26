import * as fs from 'fs/promises';
import * as http from 'http';
import * as path from 'path';
import { randomBytes } from 'crypto';

import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';
import { logger } from '../../utils/logger';

const DEFAULT_LOCAL_PORT = 18789;
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const DATA_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv']);
const R_DATA_EXTENSIONS = new Set(['.xlsx', '.xls', '.csv', '.tsv', '.txt']);
const FLOWCHART_EXTENSIONS = new Set(['.pdf', '.docx', '.md', '.markdown', '.txt']);
const PPT_SOURCE_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv', '.pdf', '.docx', '.doc', '.odt', '.rtf',
  '.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm', '.xlsx', '.xlsm', '.xls',
  '.epub', '.html', '.htm', '.tex', '.latex', '.rst', '.org', '.ipynb', '.typ',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif', '.emf', '.wmf', '.svg',
]);

export const UTILITY_AGENT_TOOL_NAMES = [
  'utility_sentence_claim_search',
  'utility_data_analysis',
  'utility_r_plot',
  'utility_flowchart_generate',
  'utility_ppt_generate',
] as const;

const utilityToolNameSet = new Set<string>(UTILITY_AGENT_TOOL_NAMES);

export const UTILITY_AGENT_TOOL_GUIDANCE = [
  '你具备与“实用工具”页面共用后端服务层的五项正式工具：句子论点检索、数据分析、R 作图、流程图制作和 PPT 汇报生成。',
  '这五项能力不直接作为独立工具暴露；需要执行时先调用 read_capabilities 核对参数，再调用 invoke_capability，并把 utility_* 名称放在 capability 字段中。禁止把 utility_* 名称当作直接 tool call 输出。',
  '只有用户任务确实需要时才调用；不要因为工具存在就自动执行。文件参数必须来自当前已授权工作目录，不能猜路径。',
  'PPT 是后台任务：create 仅代表任务已创建，必须用 status 查询到 completed 后才能声称生成完成。',
  'R 作图工具生成可执行 R 代码；只有返回结果明确包含已生成图表时，才能声称图片已经产出。',
].join('\n');

export interface UtilityAgentToolResult {
  ok: boolean;
  toolName: string;
  summary: string;
  data?: unknown;
  error?: string;
  statusCode?: number;
}

interface UtilityHttpRequest {
  method: 'GET' | 'POST';
  pathname: string;
  headers?: Record<string, string>;
  body?: Buffer;
  signal?: AbortSignal;
}

interface UtilityHttpResponse {
  statusCode: number;
  data: unknown;
}

export type UtilityAgentTransport = (request: UtilityHttpRequest) => Promise<UtilityHttpResponse>;

export interface UtilityAgentToolContext {
  userId: string;
  workspaceRoot?: string;
  apiUrl?: string;
  apiKey?: string;
  model?: string;
  localPort?: number;
  signal?: AbortSignal;
  transport?: UtilityAgentTransport;
}

interface MultipartFile {
  fieldName: string;
  filePath: string;
  filename: string;
  contentType: string;
}

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length ? { required } : {}),
  };
}

export function getUtilityAgentToolDefinitions(): LLMToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'utility_sentence_claim_search',
        description: '在本地 Embedding 文献库与 PDF Wiki 证据库中检索能支撑给定学术句子或论点的证据。用于找证据，不用于普通闲聊。',
        parameters: objectSchema({
          query: { type: 'string', description: '需要检索证据的完整句子或原子论点。' },
          topK: { type: 'integer', minimum: 1, maximum: 20, default: 6 },
          targetReferenceFormat: { type: 'string', description: '可选的参考文献格式要求。' },
        }, ['query']),
      },
    },
    {
      type: 'function',
      function: {
        name: 'utility_data_analysis',
        description: '读取当前授权工作目录中的 Excel/CSV 数据，检查字段或执行正式统计分析。',
        parameters: objectSchema({
          action: { type: 'string', enum: ['inspect', 'analyze'], default: 'analyze' },
          filePath: { type: 'string', description: '当前授权工作目录内的数据文件绝对路径或相对路径。' },
          methods: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['descriptive', 'independent_t', 'paired_t', 'anova', 'correlation', 'regression', 'chi_square', 'normality', 'variance_homogeneity', 'nonparametric', 'two_way_anova', 'pca', 'cluster', 'mixed_effects', 'survival', 'visualization'],
            },
            minItems: 1,
          },
          sheetName: { type: 'string' },
          numericVar: { type: 'string' },
          numericVar2: { type: 'string' },
          groupVar: { type: 'string' },
          categoryVar: { type: 'string' },
          categoryVar2: { type: 'string' },
          dependentVar: { type: 'string' },
          predictorVars: { type: 'array', items: { type: 'string' } },
          hypothesizedMean: { type: 'number' },
          extraQuery: { type: 'string', description: '用户对统计分析的补充要求。' },
        }, ['filePath']),
      },
    },
    {
      type: 'function',
      function: {
        name: 'utility_r_plot',
        description: '根据当前授权工作目录内的数据文件生成受控的 R 作图代码，与“R语言作图”页面共用后端。',
        parameters: objectSchema({
          filePath: { type: 'string', description: '当前授权工作目录内的 Excel/CSV/TSV/TXT 数据文件。' },
          chartType: { type: 'string', description: '图表类型，如 boxplot、bar、scatter、line、heatmap。' },
          analysisType: { type: 'string', description: '分析类型，如 comparison、correlation、trend。' },
          customRequirements: { type: 'string', description: '图表、统计标注、panel 和期刊风格要求。' },
          themeId: { type: 'string' },
          themeCode: { type: 'string' },
          treatmentPaletteConfig: { type: 'object', additionalProperties: true },
        }, ['filePath', 'chartType', 'analysisType']),
      },
    },
    {
      type: 'function',
      function: {
        name: 'utility_flowchart_generate',
        description: '把用户说明、项目上下文和当前授权工作目录中的材料整理成可编辑 Mermaid 流程图。',
        parameters: objectSchema({
          instruction: { type: 'string', description: '用户对流程图内容和重点的要求。' },
          manualText: { type: 'string', description: '直接作为依据的文字材料。' },
          selectedSources: { type: 'array', items: { type: 'string' }, description: '页面支持的内部材料来源标识。' },
          filePaths: { type: 'array', items: { type: 'string' }, maxItems: 16, description: '授权工作目录内的 PDF/DOCX/MD/TXT 文件。' },
          currentDsl: { type: 'string', description: '可选的现有 Mermaid 草稿。' },
          flowchartType: { type: 'string', enum: ['research-route', 'paper-logic', 'experiment-design', 'analysis-workflow', 'software-module'], default: 'research-route' },
          detailLevel: { type: 'string', enum: ['compact', 'standard', 'detailed'], default: 'detailed' },
        }),
      },
    },
    {
      type: 'function',
      function: {
        name: 'utility_ppt_generate',
        description: '创建或查询 PPT 汇报生成后台任务，与“PPT汇报生成”页面共用任务服务。',
        parameters: objectSchema({
          operation: { type: 'string', enum: ['create', 'status'], default: 'create' },
          jobId: { type: 'string', description: 'operation=status 时必填。' },
          requirements: { type: 'string', description: '汇报目标、内容、结构和风格要求。' },
          sourcePaths: { type: 'array', items: { type: 'string' }, maxItems: 20, description: '当前授权工作目录内的汇报材料。' },
          templatePath: { type: 'string', description: '可选的当前授权工作目录内 PPTX 模板。' },
          projectName: { type: 'string' },
          format: { type: 'string' },
          selectedTemplate: { type: 'string' },
          audience: { type: 'string' },
          pageCount: { type: 'string' },
          styleRequest: { type: 'string' },
        }),
      },
    },
  ];
}

// 数据分析和 R 作图是产品核心能力（论文写作的数据/R 工作流），不应与低频工具一起默认关闭。
// 主聊天把这两项作为“常驻”工具保留，视觉（analyze_image）只用于核对渲染结果，不替代数值分析。
export const UTILITY_CORE_AGENT_TOOL_NAMES = [
  'utility_data_analysis',
  'utility_r_plot',
] as const;

function splitUtilityToolDefinitions(predicate: (name: string) => boolean): LLMToolDefinition[] {
  return getUtilityAgentToolDefinitions().filter(tool => predicate(tool.function.name));
}

export function getUtilityCoreAgentToolDefinitions(): LLMToolDefinition[] {
  const core = new Set<string>(UTILITY_CORE_AGENT_TOOL_NAMES);
  return splitUtilityToolDefinitions(name => core.has(name));
}

export function getUtilityExtendedAgentToolDefinitions(): LLMToolDefinition[] {
  const core = new Set<string>(UTILITY_CORE_AGENT_TOOL_NAMES);
  return splitUtilityToolDefinitions(name => !core.has(name));
}

export function isUtilityAgentToolName(name: string): boolean {
  return utilityToolNameSet.has(name);
}

function parseArguments(call: LLMToolCall): Record<string, unknown> {
  try {
    const parsed = JSON.parse(call.function.arguments || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (error) {
    throw new Error(`工具参数不是有效 JSON：${(error as Error).message}`);
  }
}

function readString(value: unknown, maxLength = 24_000): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function readStringArray(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(item => readString(item, 4_000)).filter(Boolean).slice(0, maxItems);
}

function ensureWorkspaceRoot(context: UtilityAgentToolContext): string {
  const root = readString(context.workspaceRoot, 32_000);
  if (!root) throw new Error('当前请求没有配置工作目录，不能调用需要文件的实用工具。');
  return path.resolve(root);
}

async function resolveWorkspaceFile(
  context: UtilityAgentToolContext,
  requestedPath: unknown,
  allowedExtensions: Set<string>,
  maxBytes: number,
): Promise<string> {
  const root = ensureWorkspaceRoot(context);
  const value = readString(requestedPath, 32_000);
  if (!value) throw new Error('缺少文件路径。');
  const resolved = path.resolve(root, value);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('文件路径超出当前授权工作目录。');
  }
  const ext = path.extname(resolved).toLowerCase();
  if (!allowedExtensions.has(ext)) {
    throw new Error(`不支持的文件格式：${ext || '(无扩展名)'}`);
  }
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile()) throw new Error(`文件不存在：${resolved}`);
  if (stat.size > maxBytes) throw new Error(`文件过大：${path.basename(resolved)}`);
  return resolved;
}

function contentTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === '.pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.csv') return 'text/csv';
  if (['.txt', '.md', '.markdown', '.tsv'].includes(ext)) return 'text/plain';
  return 'application/octet-stream';
}

async function buildMultipartBody(
  fields: Record<string, string>,
  files: MultipartFile[],
): Promise<{ body: Buffer; contentType: string }> {
  const boundary = `----ScholarHarness${randomBytes(12).toString('hex')}`;
  const chunks: Buffer[] = [];
  const append = (value: string | Buffer) => chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8'));
  for (const [name, value] of Object.entries(fields)) {
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${name.replaceAll('"', '')}"\r\n\r\n${value}\r\n`);
  }
  for (const file of files) {
    const buffer = await fs.readFile(file.filePath);
    append(`--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName.replaceAll('"', '')}"; filename="${file.filename.replaceAll('"', '')}"\r\nContent-Type: ${file.contentType}\r\n\r\n`);
    append(buffer);
    append('\r\n');
  }
  append(`--${boundary}--\r\n`);
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

function defaultTransport(port: number): UtilityAgentTransport {
  return (request) => new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      method: request.method,
      path: request.pathname,
      headers: {
        Accept: 'application/json',
        ...(request.body ? { 'Content-Length': String(request.body.length) } : {}),
        ...(request.headers || {}),
      },
      signal: request.signal,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy(new Error('实用工具响应过大，已停止读取。'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        try {
          resolve({ statusCode: res.statusCode || 500, data: text ? JSON.parse(text) : {} });
        } catch {
          reject(new Error(`实用工具返回了非 JSON 响应（HTTP ${res.statusCode || 500}）。`));
        }
      });
    });
    req.on('error', reject);
    if (request.body) req.write(request.body);
    req.end();
  });
}

async function requestJson(
  context: UtilityAgentToolContext,
  pathname: string,
  body?: Record<string, unknown>,
  method: 'GET' | 'POST' = 'POST',
): Promise<UtilityHttpResponse> {
  const encoded = body ? Buffer.from(JSON.stringify(body), 'utf8') : undefined;
  const transport = context.transport || defaultTransport(context.localPort || Number(process.env.PORT) || DEFAULT_LOCAL_PORT);
  return transport({
    method,
    pathname,
    headers: encoded ? { 'Content-Type': 'application/json; charset=utf-8' } : undefined,
    body: encoded,
    signal: context.signal,
  });
}

async function requestMultipart(
  context: UtilityAgentToolContext,
  pathname: string,
  fields: Record<string, string>,
  files: MultipartFile[],
): Promise<UtilityHttpResponse> {
  const multipart = await buildMultipartBody(fields, files);
  const transport = context.transport || defaultTransport(context.localPort || Number(process.env.PORT) || DEFAULT_LOCAL_PORT);
  return transport({
    method: 'POST',
    pathname,
    headers: { 'Content-Type': multipart.contentType },
    body: multipart.body,
    signal: context.signal,
  });
}

function normalizeResponse(toolName: string, response: UtilityHttpResponse, successSummary: string): UtilityAgentToolResult {
  const payload = response.data && typeof response.data === 'object'
    ? response.data as { success?: unknown; data?: unknown; error?: unknown; message?: unknown }
    : {};
  const ok = response.statusCode >= 200 && response.statusCode < 300 && payload.success !== false;
  return {
    ok,
    toolName,
    summary: ok ? successSummary : `${toolName} 执行失败`,
    ...(ok ? { data: payload.data ?? response.data } : {}),
    ...(!ok ? { error: readString(payload.error || payload.message, 8_000) || `HTTP ${response.statusCode}` } : {}),
    statusCode: response.statusCode,
  };
}

async function executeSentenceSearch(args: Record<string, unknown>, context: UtilityAgentToolContext): Promise<UtilityAgentToolResult> {
  const query = readString(args.query, 12_000);
  if (!query) throw new Error('query 不能为空。');
  const topK = Math.min(20, Math.max(1, Math.floor(Number(args.topK) || 6)));
  const response = await requestJson(context, '/api/sentence/claim-match', {
    query,
    topK,
    userId: context.userId,
    targetReferenceFormat: readString(args.targetReferenceFormat, 2_000),
    projectRoot: context.workspaceRoot || '',
  });
  return normalizeResponse('utility_sentence_claim_search', response, `已完成句子论点检索（Top ${topK}）`);
}

async function executeDataAnalysis(args: Record<string, unknown>, context: UtilityAgentToolContext): Promise<UtilityAgentToolResult> {
  const filePath = await resolveWorkspaceFile(context, args.filePath, DATA_EXTENSIONS, 20 * 1024 * 1024);
  const action = readString(args.action, 20) === 'inspect' ? 'inspect' : 'analyze';
  const methods = readStringArray(args.methods, 12);
  const fields: Record<string, string> = action === 'inspect'
    ? { sheetName: readString(args.sheetName, 500) }
    : {
        userId: context.userId,
        methods: JSON.stringify(methods.length ? methods : ['descriptive']),
        method: methods[0] || 'descriptive',
        sheetName: readString(args.sheetName, 500),
        numericVar: readString(args.numericVar, 500),
        numericVar2: readString(args.numericVar2, 500),
        groupVar: readString(args.groupVar, 500),
        categoryVar: readString(args.categoryVar, 500),
        categoryVar2: readString(args.categoryVar2, 500),
        dependentVar: readString(args.dependentVar, 500),
        predictorVars: JSON.stringify(readStringArray(args.predictorVars, 50)),
        hypothesizedMean: String(Number(args.hypothesizedMean) || 0),
        extraQuery: readString(args.extraQuery, 4_000),
      };
  const response = await requestMultipart(context, `/api/data-analysis/${action}`, fields, [{
    fieldName: 'file',
    filePath,
    filename: path.basename(filePath),
    contentType: contentTypeForFile(filePath),
  }]);
  return normalizeResponse('utility_data_analysis', response, action === 'inspect' ? '已读取数据字段' : '已完成数据分析');
}

async function executeRPlot(args: Record<string, unknown>, context: UtilityAgentToolContext): Promise<UtilityAgentToolResult> {
  if (!readString(context.apiUrl) || !readString(context.apiKey)) {
    throw new Error('当前会话没有可用的小牛马 API URL/API Key，无法生成 R 作图代码。');
  }
  const filePath = await resolveWorkspaceFile(context, args.filePath, R_DATA_EXTENSIONS, 100 * 1024 * 1024);
  const palette = args.treatmentPaletteConfig && typeof args.treatmentPaletteConfig === 'object'
    ? JSON.stringify(args.treatmentPaletteConfig)
    : '';
  const response = await requestMultipart(context, '/api/r-code/generate', {
    userId: context.userId,
    apiUrl: readString(context.apiUrl, 4_000),
    apiKey: readString(context.apiKey, 16_000),
    model: readString(context.model, 500) || 'gpt-4o',
    chartType: readString(args.chartType, 200),
    analysisType: readString(args.analysisType, 200),
    customRequirements: readString(args.customRequirements, 12_000),
    workDir: path.dirname(filePath),
    dataFilename: path.basename(filePath),
    sourceDataFilePath: filePath,
    themeCode: readString(args.themeCode, 8_000),
    themeId: readString(args.themeId, 200),
    treatmentPaletteConfig: palette,
    mode: 'workspace-path',
  }, []);
  return normalizeResponse('utility_r_plot', response, '已生成 R 作图代码');
}

async function executeFlowchart(args: Record<string, unknown>, context: UtilityAgentToolContext): Promise<UtilityAgentToolResult> {
  const filePaths = readStringArray(args.filePaths, 16);
  const files: MultipartFile[] = [];
  for (const requested of filePaths) {
    const filePath = await resolveWorkspaceFile(context, requested, FLOWCHART_EXTENSIONS, 100 * 1024 * 1024);
    files.push({ fieldName: 'files', filePath, filename: path.basename(filePath), contentType: contentTypeForFile(filePath) });
  }
  const instruction = readString(args.instruction, 4_000);
  const manualText = readString(args.manualText, 60_000);
  const selectedSources = readStringArray(args.selectedSources, 20);
  const materialsResponse = await requestMultipart(context, '/api/flowchart-maker/materials', {
    userId: context.userId,
    selectedSources: JSON.stringify(selectedSources),
    manualText: manualText || instruction,
  }, files);
  const materialsResult = normalizeResponse('utility_flowchart_generate', materialsResponse, '已整理流程图材料');
  if (!materialsResult.ok) return materialsResult;
  const materialData = materialsResult.data && typeof materialsResult.data === 'object'
    ? materialsResult.data as { markdown?: unknown }
    : {};
  const markdown = readString(materialData.markdown, 120_000);
  if (!markdown) throw new Error('没有可用于生成流程图的材料。');
  const response = await requestJson(context, '/api/flowchart-maker/ai-generate', {
    userId: context.userId,
    markdown,
    currentDsl: readString(args.currentDsl, 5_000),
    instruction,
    flowchartType: readString(args.flowchartType, 80) || 'research-route',
    detailLevel: readString(args.detailLevel, 80) || 'detailed',
  });
  return normalizeResponse('utility_flowchart_generate', response, '已生成可编辑流程图');
}

async function executePpt(args: Record<string, unknown>, context: UtilityAgentToolContext): Promise<UtilityAgentToolResult> {
  const operation = readString(args.operation, 20) === 'status' ? 'status' : 'create';
  if (operation === 'status') {
    const jobId = readString(args.jobId, 200);
    if (!jobId) throw new Error('查询 PPT 任务状态时必须提供 jobId。');
    const response = await requestJson(context, `/api/ppt-master/jobs/${encodeURIComponent(jobId)}`, undefined, 'GET');
    return normalizeResponse('utility_ppt_generate', response, '已读取 PPT 生成任务状态');
  }
  const sourcePaths = readStringArray(args.sourcePaths, 20);
  const requirements = readString(args.requirements, 24_000);
  if (!sourcePaths.length && !requirements) throw new Error('创建 PPT 任务需要 requirements 或至少一个 sourcePaths 文件。');
  const files: MultipartFile[] = [];
  for (const requested of sourcePaths) {
    const filePath = await resolveWorkspaceFile(context, requested, PPT_SOURCE_EXTENSIONS, 100 * 1024 * 1024);
    files.push({ fieldName: 'sources', filePath, filename: path.basename(filePath), contentType: contentTypeForFile(filePath) });
  }
  const templateValue = readString(args.templatePath, 32_000);
  if (templateValue) {
    const templatePath = await resolveWorkspaceFile(context, templateValue, new Set(['.pptx']), 100 * 1024 * 1024);
    files.push({ fieldName: 'templatePptx', filePath: templatePath, filename: path.basename(templatePath), contentType: contentTypeForFile(templatePath) });
  }
  const response = await requestMultipart(context, '/api/ppt-master/jobs', {
    userId: context.userId,
    requirements,
    projectName: readString(args.projectName, 500),
    format: readString(args.format, 100),
    selectedTemplate: readString(args.selectedTemplate, 500),
    audience: readString(args.audience, 500),
    pageCount: readString(args.pageCount, 120),
    styleRequest: readString(args.styleRequest, 1_200),
    apiUrl: readString(context.apiUrl, 4_000),
    apiKey: readString(context.apiKey, 16_000),
    model: readString(context.model, 500),
  }, files);
  return normalizeResponse('utility_ppt_generate', response, '已创建 PPT 后台生成任务');
}

export async function executeUtilityAgentToolCall(
  call: LLMToolCall,
  context: UtilityAgentToolContext,
): Promise<UtilityAgentToolResult> {
  const toolName = call.function.name;
  if (!isUtilityAgentToolName(toolName)) {
    return { ok: false, toolName, summary: `${toolName} 执行失败`, error: '未知实用工具。' };
  }
  try {
    const args = parseArguments(call);
    switch (toolName) {
      case 'utility_sentence_claim_search':
        return await executeSentenceSearch(args, context);
      case 'utility_data_analysis':
        return await executeDataAnalysis(args, context);
      case 'utility_r_plot':
        return await executeRPlot(args, context);
      case 'utility_flowchart_generate':
        return await executeFlowchart(args, context);
      case 'utility_ppt_generate':
        return await executePpt(args, context);
      default:
        return { ok: false, toolName, summary: `${toolName} 执行失败`, error: '未知实用工具。' };
    }
  } catch (error) {
    const message = (error as Error).message || String(error);
    logger.warn(`[UtilityAgentTool] ${toolName} failed: ${message}`);
    return { ok: false, toolName, summary: `${toolName} 执行失败`, error: message };
  }
}
