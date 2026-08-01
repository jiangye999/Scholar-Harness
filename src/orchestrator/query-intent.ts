/**
 * Transport-agnostic query-routing policy shared by every chat entry point.
 */
export type QueryPrimaryIntent =
  | 'workspace_file'
  | 'literature_collection'
  | 'literature_retrieval'
  | 'academic_writing'
  | 'data_analysis'
  | 'r_plot'
  | 'meta_analysis'
  | 'bibliometrics'
  | 'pdf_wiki'
  | 'multimodal_task'
  | 'skill_or_tool'
  | 'project_management'
  | 'general_chat';

export type QueryIntentAction =
  | 'collect'
  | 'search'
  | 'read'
  | 'create'
  | 'edit'
  | 'delete'
  | 'analyze'
  | 'plot'
  | 'write'
  | 'explain'
  | 'continue'
  | 'configure'
  | 'other';

export type QueryIntentDataSource =
  | 'external_literature'
  | 'workspace'
  | 'attachments'
  | 'conversation'
  | 'literature'
  | 'pdf_wiki'
  | 'meta_analysis'
  | 'bibliometrics'
  | 'mixed'
  | 'none'
  | 'unknown';

export type QueryIntentLiteratureEvidenceMode =
  | 'none'
  | 'reuse_existing'
  | 'search_new';

export interface QueryIntentHistoryMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface QueryIntentFileReference {
  name?: string;
  path?: string;
  type?: string;
}

export interface QueryIntentClassifierInput {
  message: string;
  history?: QueryIntentHistoryMessage[];
  workspaceRoot?: string;
  aiWorkRoot?: string;
  workspaceFileMentions?: QueryIntentFileReference[];
  attachments?: QueryIntentFileReference[];
  explicitParts?: Array<Record<string, unknown>>;
  /** UI selections and active-page state that help the model resolve intent. */
  contextItems?: Array<Record<string, unknown>>;
}

export interface QueryIntent {
  version: 1;
  source: 'ai' | 'fallback';
  primaryIntent: QueryPrimaryIntent;
  secondaryIntents: QueryPrimaryIntent[];
  action: QueryIntentAction;
  dataSource: QueryIntentDataSource;
  isContextualFollowUp: boolean;
  needsWorkspaceSearch: boolean;
  needsWebSearch: boolean;
  needsLiteratureRetrieval: boolean;
  /** AI decision about whether this turn reuses prior evidence or starts a new search. */
  literatureEvidenceMode?: QueryIntentLiteratureEvidenceMode;
  needsToolExecution: boolean;
  needsClarification: boolean;
  resolvedQuery: string;
  referencedFiles: string[];
  excludedFiles: string[];
  requestedOutputs: string[];
  requestedMethods: string[];
  confidence: number;
  reason: string;
  recognizedAt: string;
}

const PRIMARY_INTENTS = new Set<QueryPrimaryIntent>([
  'workspace_file',
  'literature_collection',
  'literature_retrieval',
  'academic_writing',
  'data_analysis',
  'r_plot',
  'meta_analysis',
  'bibliometrics',
  'pdf_wiki',
  'multimodal_task',
  'skill_or_tool',
  'project_management',
  'general_chat',
]);

const ACTIONS = new Set<QueryIntentAction>([
  'collect',
  'search',
  'read',
  'create',
  'edit',
  'delete',
  'analyze',
  'plot',
  'write',
  'explain',
  'continue',
  'configure',
  'other',
]);

const DATA_SOURCES = new Set<QueryIntentDataSource>([
  'external_literature',
  'workspace',
  'attachments',
  'conversation',
  'literature',
  'pdf_wiki',
  'meta_analysis',
  'bibliometrics',
  'mixed',
  'none',
  'unknown',
]);

const LITERATURE_EVIDENCE_MODES = new Set<QueryIntentLiteratureEvidenceMode>([
  'none',
  'reuse_existing',
  'search_new',
]);

const FILE_EXTENSION_SOURCE = [
  'docx?', 'xlsx?', 'pptx?', 'pdf', 'rtf', 'odt', 'ods', 'odp',
  'txt', 'md', 'markdown', 'tex', 'bib', 'ris',
  'csv', 'tsv', 'json', 'jsonl', 'ya?ml', 'xml', 'html?',
  'css', 'jsx?', 'tsx?', 'mjs', 'cjs', 'py', 'r', 'rmd', 'qmd',
  'ipynb', 'sql', 'png', 'jpe?g', 'gif', 'bmp', 'webp', 'tiff?', 'svg',
  'zip', 'rds', 'rdata', 'sav', 'dta', 'parquet', 'feather',
].join('|');

// Chinese alternatives are deliberately separate from ASCII alternatives.
// Without ASCII word boundaries, strings such as "profile", "preview" and
// "preference" used to match file/view/reference and could route a normal
// English message into workspace or literature retrieval.
const FILE_WORD_PATTERN = /(?:文件|文档|目录|文件夹|工作目录|草稿|正文稿|手稿|脚本|代码|图片|图表|表格|工作簿|演示文稿)|\b(?:files?|documents?|folders?|directories|directory|workspace|drafts?|manuscripts?|scripts?|workbooks?|spreadsheets?|presentations?)\b/i;
const WORKSPACE_CONTAINER_PATTERN = /(?:文件|文档|目录|文件夹|工作目录|路径)|\b(?:files?|documents?|folders?|directories|directory|workspace|paths?)\b/i;
const WORKSPACE_ACTION_PATTERN = /(?:查找|寻找|搜索|定位|列出|打开|读取|查看|更新|修改|编辑|改写|写入|写回|保存|生成|创建|新建|删除|移除|去掉|清除|取消|不保留|不要套|直接放|移动|搬移|迁移|重命名|归档|整理|重组|扁平化|合并|比较|最新|最近|最新版)|\b(?:find|search|locate|list|open|read|view|update|modify|edit|write|save|create|delete|remove|clear|move|relocate|rename|archive|organize|reorganize|flatten|merge|compare|latest|newest|recent)\b/i;
const AI_WORKSPACE_REFERENCE_PATTERN = /(?:ScholarHarness_AI_Workspaces|AI\s*(?:工作目录|工作文件夹|workspace)|(?:AI|模型|助手)(?:之前|先前|刚才|上次|本次)?(?:生成|输出|产出|保存)(?:的)?(?:内容|材料|结果|产物|文件|文档|草稿))|\b(?:AI|agent)[- ]?(?:workspace|outputs?|artifacts?)\b/i;
const WORKSPACE_REUSE_ACTION_PATTERN = /(?:找一下|找下|找找|查找|寻找|搜索|定位|列出|打开|读取|查看|看看|核对|继续|接着|基于|根据|结合|使用|利用|复用)|\b(?:find|search|locate|list|open|read|view|inspect|continue|reuse|use|based\s+on)\b/i;
const WORKSPACE_REUSE_OBJECT_PATTERN = /(?:相关内容|相关材料|已有内容|已有材料|已有结果|已有产物|现有内容|现有材料|现有结果|之前(?:生成|输出|保存)(?:的)?(?:内容|材料|结果|文件|文档|草稿)|刚才(?:生成|输出|保存)(?:的)?(?:内容|材料|结果|文件|文档|草稿)|上次(?:生成|输出|保存)(?:的)?(?:内容|材料|结果|文件|文档|草稿)|生成(?:的)?(?:内容|材料|结果|产物|文件|文档|草稿)|输出(?:的)?(?:内容|材料|结果|产物|文件|文档|草稿)|工作产物|本地产物)|\b(?:existing|previous|prior|generated|saved|local)\s+(?:content|materials?|results?|outputs?|artifacts?|files?|documents?|drafts?)\b/i;
const CONTEXTUAL_FOLLOWUP_PATTERN = /(?:除了|排除|不要这个|还有|另一个|下一个|第二个|其余|剩下|这个|那个|它|刚才|之前|前面|上面|原来|我的意思|对应(?:段落|句子|内容)|你(?:刚才|之前)?(?:给|生成|输出|检索|写)(?:的)?|上一个|继续|然后呢|还有呢|呢\s*[：:]?)|\b(?:except|exclude|other|another|next|second|rest|remaining|continue|previous|above)\b|(?:this|that)\s+one|what\s+else|what\s+i\s+mean|as\s+before/i;
const EXCLUSION_PATTERN = /(?:除了|排除|不要|不包括|剔除|忽略)|\b(?:except|exclude|without)\b|other\s+than/i;
const LITERATURE_DIRECT_PATTERN = /(?:文献检索|检索文献|查找文献|查询文献|寻找文献|搜索文献|搜索论文|查找论文|寻找论文|引用文献|文献支撑|文献证据|撰写文献综述|写文献综述)|\bliterature\s+search\b|\b(?:write|conduct|prepare|perform)\s+(?:a\s+)?literature\s+review\b|\b(?:search|find|retrieve|recommend)\s+(?:for\s+)?(?:papers?|studies|literature)\b|\blook\s+up\s+(?:papers?|studies|literature)\b/i;
const LITERATURE_OBJECT_PATTERN = /(?:文献|论文|参考文献|引用|研究证据|文献证据|相关研究|已有研究|学术证据|文献综述)|\b(?:literature|papers?|studies|references?|citations?|evidence)\b|scholarly\s+evidence/i;
const LITERATURE_ACTION_PATTERN = /(?:检索|搜索|查找|查询|寻找|推荐|列出|提供|给出|补充|引用|核验|验证|支撑|支持|需要|想要|有哪些)|\b(?:search|find|retrieve|recommend|list|provide|give|cite|verify|support|need|want)\b|look\s+up/i;
const EXTERNAL_LITERATURE_SOURCE_PATTERN = /(?:Web\s*of\s*Science|WOS|CNKI|知网|Clarivate|外部文献库|在线文献库|外部数据库)|\b(?:web\s+of\s+science|wos|cnki|clarivate)\b/i;
const LITERATURE_COLLECTION_ACTION_PATTERN = /(?:采集|收集|抓取|批量获取|批量检索|批量下载|批量导出|自动采集|自动收集|建立文献库|补充文献库|导入新(?:的)?(?:文献|论文))|\b(?:collect|harvest|bulk\s+(?:retrieve|download|export)|build\s+(?:a\s+)?literature\s+(?:library|database))\b/i;
const EXTERNAL_LITERATURE_EXPORT_ACTION_PATTERN = /(?:获取|下载|导出|拉取|调取)|\b(?:get|retrieve|download|export|fetch)\b/i;
const LITERATURE_RECORD_QUANTITY_PATTERN = /(?:\d{1,7}|[一二三四五六七八九十百千万两]+)\s*(?:篇|条|份)\s*(?:文献|论文|记录)?/i;
const LITERATURE_QUERY_ONLY_PATTERN = /(?:检索式|查询式|布尔式|检索策略|检索方案)|\b(?:search|query)\s+(?:string|syntax|strategy)\b/i;
const LITERATURE_COLLECTION_DIRECT_PATTERN = /(?:(?:采集|收集|抓取|批量获取|批量检索|批量下载|批量导出|自动采集|自动收集)[\s\S]{0,120}(?:文献|论文|记录))|(?:(?:文献|论文|记录)[\s\S]{0,80}(?:采集|收集|抓取|批量获取|批量下载|批量导出))|\b(?:collect|harvest|bulk\s+(?:retrieve|download|export))\b[\s\S]{0,120}\b(?:papers?|studies|literature|records?)\b/i;
const REFERENCE_SECTION_EDIT_PATTERN = /(?:参考文献|引用)(?:章节|部分|列表|格式|样式|标题)|\b(?:references?|bibliography|citations?)\s+(?:section|list|format|style|heading)\b/i;
const WEB_SEARCH_PATTERN = /(?:联网搜索|网络搜索|网页搜索|上网查|搜索互联网|查互联网|最新新闻|实时(?:数据|价格|政策|信息))|\b(?:web|online)\s+search\b|search\s+the\s+web|browse\s+the\s+web|\blatest\s+news\b|\breal[- ]?time\b|\bcurrent\s+(?:news|price|policy|law|regulation)\b/i;
const WRITING_PATTERN = /(?:撰写|写作|续写|继续写|接着写|写一段|扩写|缩写|润色|改写|摘要|引言|绪论|方法|结果|讨论|结论|论文|文章|章节)|\b(?:manuscripts?|papers?|articles?|abstract|introduction|methods?|results?|discussion|conclusions?|chapters?|sections?|continue\s+writing)\b/i;
const WRITING_ACTION_PATTERN = /(?:撰写|写作|续写|继续写|接着写|写一段|扩写|缩写|润色|改写|重写)|\b(?:write|rewrite|polish|draft|expand|shorten|revise|continue\s+writing)\b/i;
const CITATION_REQUIRED_SECTION_PATTERN = /(?:引言|绪论|讨论|文献综述|研究现状|相关工作|理论基础|理论框架|研究背景)|\b(?:introduction|discussion|literature\s+review|related\s+work|theoretical\s+(?:background|framework)|research\s+background)\b/i;
const DATA_ANALYSIS_DIRECT_PATTERN = /(?:数据分析|统计分析|方差分析|相关分析|主成分分析)|\bdata\s+analysis\b/i;
const DATA_ANALYSIS_OBJECT_PATTERN = /(?:显著性|方差|回归|相关性?|聚类|主成分)|\b(?:pca|anova|regression|correlation|statistics?)\b/i;
const ANALYSIS_ACTION_PATTERN = /(?:分析|计算|检验|拟合|运行|执行|比较)|\b(?:analy[sz]e|calculate|compute|test|fit|run|perform|compare)\b/i;
const R_PLOT_DIRECT_PATTERN = /(?:r\s*(?:作图|绘图|代码|脚本)|作图|绘图|画图|重绘|配色|调整图例|修改坐标轴)|\bggplot2?\b/i;
const PLOT_OBJECT_PATTERN = /(?:图|图表|图形|图例|坐标轴)|\b(?:plots?|figures?|charts?|visuali[sz]ations?)\b/i;
const PLOT_ACTION_PATTERN = /(?:做|生成|创建|绘制|画|重绘|修改|调整|编辑|导出|配色)|\b(?:create|generate|draw|plot|visuali[sz]e|redraw|edit|modify|update|export|color)\b/i;
const PLOT_TEXT_ONLY_PATTERN = /(?:图题|图片标题|图注文字|图注内容)|\b(?:figure|plot|chart)(?:\s+[a-z]?\d+(?:\([a-z0-9]+\)|[a-z])?)?\s+(?:caption|title|description)\b/i;
const META_DIRECT_PATTERN = /(?:meta\s*分析|荟萃分析)|\bmeta-analysis\b/i;
const META_OBJECT_PATTERN = /(?:效应量|森林图|漏斗图|异质性|亚组分析|敏感性分析)|\beffect\s+size\b|\bforest\s+plot\b|\bfunnel\s+plot\b|\bheterogeneity\b/i;
const BIBLIOMETRICS_DIRECT_PATTERN = /(?:文献计量分析|计量学分析)|\b(?:bibliometric|scientometric)\s+analysis\b/i;
const BIBLIOMETRICS_OBJECT_PATTERN = /(?:文献计量|计量学|知识图谱|共现|共被引|文献耦合|突现词|主题演化)|\b(?:bibliometrics?|scientometrics?|citespace|vosviewer)\b/i;
const PDF_WIKI_PATTERN = /(?:pdf\s*wiki|句子级wiki|论点库|证据句|pdf句子级)|\b(?:sentenceId|referenceIndexes)\b/i;
const PROJECT_PATTERN = /(?:新建项目|导入项目|切换项目|项目目录|项目记忆)|\bproject\s+(?:import|switch|create|memory)\b/i;

function compactText(value: unknown, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

function normalizeStringArray(value: unknown, maxItems = 20, maxLength = 500): string[] {
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = compactText(item, maxLength);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output;
}

function normalizeEnum<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const candidate = String(value || '').trim() as T;
  return allowed.has(candidate) ? candidate : fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function extractBalancedJsonObject(content: string): string {
  const text = String(content || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  const start = text.indexOf('{');
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function parseRecord(rawResponse: string): Record<string, unknown> {
  const jsonText = extractBalancedJsonObject(rawResponse);
  if (!jsonText) return {};
  try {
    const value = JSON.parse(jsonText);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function extractFileReferences(value: unknown): string[] {
  const text = String(value || '');
  if (!text) return [];
  const patterns = [
    new RegExp(`([A-Za-z]:[\\\\/][^\\r\\n"'<>|]{1,500}?\\.(?:${FILE_EXTENSION_SOURCE}))`, 'gi'),
    new RegExp(`((?:[A-Za-z0-9_@()\\-.\\u3400-\\u9fff]+[ ]+){0,8}[A-Za-z0-9_@()\\-.\\u3400-\\u9fff]+\\.(?:${FILE_EXTENSION_SOURCE}))`, 'gi'),
  ];
  const results: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const candidate = String(match[1] || '')
        .trim()
        .replace(/^[`"'“”‘’《》【】\s]+|[`"'“”‘’《》【】，。；;、!?！？\s]+$/g, '');
      const key = candidate.toLowerCase();
      if (!candidate || seen.has(key)) continue;
      seen.add(key);
      results.push(candidate);
      if (results.length >= 30) return results;
    }
  }
  return results;
}

function truncateHistoryContent(value: unknown, maxLength = 6000): string {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  const headLength = Math.floor(maxLength * 0.55);
  const tailLength = maxLength - headLength;
  return `${text.slice(0, headLength)}\n...[意图识别上下文中段已压缩]...\n${text.slice(-tailLength)}`;
}

function getRecentHistory(input: QueryIntentClassifierInput): QueryIntentHistoryMessage[] {
  return (Array.isArray(input.history) ? input.history : [])
    .filter(item => item && (item.role === 'user' || item.role === 'assistant' || item.role === 'system'))
    .map(item => ({
      role: item.role,
      content: truncateHistoryContent(item.content),
    }))
    .slice(-8);
}

/**
 * The semantic classifier is an ambiguity resolver, not a mandatory gateway.
 * Keep its prompt deliberately small so an ambiguous follow-up cannot delay
 * every otherwise deterministic chat request.
 */
function getClassifierHistory(input: QueryIntentClassifierInput): QueryIntentHistoryMessage[] {
  const history = getRecentHistory(input).slice(-6);
  let latestAssistantIndex = -1;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    if (history[index].role === 'assistant') {
      latestAssistantIndex = index;
      break;
    }
  }
  return history.map((item, index) => ({
    ...item,
    // Contextual requests such as “accept your suggestion” depend on the
    // preceding assistant result. Preserve substantially more of that turn
    // while keeping older turns compact.
    content: truncateHistoryContent(item.content, index === latestAssistantIndex ? 7000 : 1800),
  }));
}

function getPriorFileReferences(input: QueryIntentClassifierInput): string[] {
  const history = getRecentHistory(input);
  const references: string[] = [];
  const seen = new Set<string>();
  for (const item of history.slice(-6)) {
    for (const candidate of extractFileReferences(item.content)) {
      const key = candidate.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      references.push(candidate);
    }
  }
  return references;
}

function filenameStem(value: string): string {
  const name = value.replace(/\\/g, '/').split('/').pop() || value;
  return name.replace(new RegExp(`\\.(?:${FILE_EXTENSION_SOURCE})$`, 'i'), '').trim().toLowerCase();
}

function resolveExcludedFiles(message: string, priorFiles: string[]): string[] {
  if (!EXCLUSION_PATTERN.test(message)) return [];
  const normalizedMessage = message.toLowerCase();
  const matched = priorFiles.filter(file => {
    const name = file.replace(/\\/g, '/').split('/').pop() || file;
    const stem = filenameStem(name);
    return normalizedMessage.includes(name.toLowerCase())
      || (!!stem && normalizedMessage.includes(stem))
      || /(?:这个|那个|它|刚才)/.test(normalizedMessage);
  });
  return matched.slice(0, 10);
}

function hasRPlotRequest(message: string, hasDataContext = false): boolean {
  return R_PLOT_DIRECT_PATTERN.test(message)
    || (
      PLOT_OBJECT_PATTERN.test(message)
      && !PLOT_TEXT_ONLY_PATTERN.test(message)
      && (PLOT_ACTION_PATTERN.test(message) || hasDataContext)
    );
}

function hasDataAnalysisRequest(message: string, hasDataContext = false): boolean {
  return DATA_ANALYSIS_DIRECT_PATTERN.test(message)
    || (
      DATA_ANALYSIS_OBJECT_PATTERN.test(message)
      && (ANALYSIS_ACTION_PATTERN.test(message) || hasDataContext)
    );
}

function hasMetaAnalysisRequest(message: string, hasDataContext = false): boolean {
  return META_DIRECT_PATTERN.test(message)
    || (
      META_OBJECT_PATTERN.test(message)
      && (ANALYSIS_ACTION_PATTERN.test(message) || PLOT_ACTION_PATTERN.test(message) || hasDataContext)
    );
}

function hasBibliometricsRequest(message: string, hasDataContext = false): boolean {
  return BIBLIOMETRICS_DIRECT_PATTERN.test(message)
    || (
      BIBLIOMETRICS_OBJECT_PATTERN.test(message)
      && (ANALYSIS_ACTION_PATTERN.test(message) || PLOT_ACTION_PATTERN.test(message) || hasDataContext)
    );
}

function isCitationRequiredWritingRequest(input: QueryIntentClassifierInput): boolean {
  const message = String(input.message || '');
  if (WRITING_ACTION_PATTERN.test(message) && CITATION_REQUIRED_SECTION_PATTERN.test(message)) {
    return true;
  }
  if (!CONTEXTUAL_FOLLOWUP_PATTERN.test(message) || !WRITING_ACTION_PATTERN.test(message)) {
    return false;
  }
  return getRecentHistory(input)
    .slice(-4)
    .some(item => CITATION_REQUIRED_SECTION_PATTERN.test(item.content));
}

function resolveAction(message: string, fallback: QueryIntentAction): QueryIntentAction {
  if (/(?:删除|移除|去掉|清除)|\b(?:delete|remove|clear)\b/i.test(message)) return 'delete';
  if (/(?:更新|修改|编辑|改写|写回|覆盖|替换|追加|取消|不保留|不要套|直接放|移动|搬移|迁移|重命名|归档|整理|重组|扁平化)|\b(?:update|modify|edit|rewrite|overwrite|replace|append|move|relocate|rename|archive|organize|reorganize|flatten)\b/i.test(message)) return 'edit';
  if (/(?:创建|新建|生成|导出)|\b(?:create|generate|export)\b/i.test(message)) return 'create';
  if (/(?:打开|读取|查看|解释)|\b(?:open|read|view|explain)\b/i.test(message)) return 'read';
  if (/(?:查找|寻找|搜索|定位|列出|最新|最近|除了|还有|下一个)|\b(?:find|search|locate|list|latest|newest|another|next|except)\b/i.test(message)) return 'search';
  if (hasRPlotRequest(message)) return 'plot';
  if (hasDataAnalysisRequest(message) || hasMetaAnalysisRequest(message) || hasBibliometricsRequest(message)) return 'analyze';
  if (WRITING_PATTERN.test(message)) return 'write';
  if (CONTEXTUAL_FOLLOWUP_PATTERN.test(message)) return 'continue';
  return fallback;
}

function hasExplicitLiteratureRequest(message: string): boolean {
  const withoutFileNames = message.replace(
    new RegExp(`\\b[^\\s]{1,240}\\.(?:${FILE_EXTENSION_SOURCE})\\b`, 'gi'),
    ' '
  );
  if (REFERENCE_SECTION_EDIT_PATTERN.test(withoutFileNames)
      && !LITERATURE_DIRECT_PATTERN.test(withoutFileNames)) {
    return false;
  }
  return LITERATURE_DIRECT_PATTERN.test(withoutFileNames)
    || (
      LITERATURE_OBJECT_PATTERN.test(withoutFileNames)
      && LITERATURE_ACTION_PATTERN.test(withoutFileNames)
    );
}

function hasExplicitLiteratureCollectionRequest(message: string): boolean {
  const withoutFileNames = message.replace(
    new RegExp(`\\b[^\\s]{1,240}\\.(?:${FILE_EXTENSION_SOURCE})\\b`, 'gi'),
    ' '
  );
  if (
    LITERATURE_QUERY_ONLY_PATTERN.test(withoutFileNames)
    && !LITERATURE_RECORD_QUANTITY_PATTERN.test(withoutFileNames)
    && !LITERATURE_COLLECTION_DIRECT_PATTERN.test(withoutFileNames)
  ) {
    return false;
  }
  return LITERATURE_COLLECTION_DIRECT_PATTERN.test(withoutFileNames)
    || (
      EXTERNAL_LITERATURE_SOURCE_PATTERN.test(withoutFileNames)
      && (
        LITERATURE_COLLECTION_ACTION_PATTERN.test(withoutFileNames)
        || LITERATURE_ACTION_PATTERN.test(withoutFileNames)
        || (
          EXTERNAL_LITERATURE_EXPORT_ACTION_PATTERN.test(withoutFileNames)
          && (
            LITERATURE_OBJECT_PATTERN.test(withoutFileNames)
            || LITERATURE_RECORD_QUANTITY_PATTERN.test(withoutFileNames)
          )
        )
      )
    );
}

function hasExplicitWebSearchRequest(message: string): boolean {
  return WEB_SEARCH_PATTERN.test(
    message.replace(new RegExp(`\\b[^\\s]{1,240}\\.(?:${FILE_EXTENSION_SOURCE})\\b`, 'gi'), ' ')
  );
}

function hasExplicitLiteratureSkillRequest(input: QueryIntentClassifierInput): boolean {
  return (Array.isArray(input.explicitParts) ? input.explicitParts : [])
    .filter(part => String(part?.type || '') === 'slash')
    .some(part =>
      /(?:sentence[-_ ]?search|literature[-_ ]?(?:search|retrieval)|文献检索|逐句检索)/i.test(
        String(part.trigger || part.name || part.command || '')
      )
    );
}

function hasExplicitWorkspaceSkillRequest(input: QueryIntentClassifierInput): boolean {
  return (Array.isArray(input.explicitParts) ? input.explicitParts : [])
    .filter(part => String(part?.type || '') === 'slash')
    .some(part =>
      /(?:file[-_ ]?(?:search|read|write)|workspace[-_ ]?(?:search|read|write)|文件检索|文件搜索|工作目录)/i.test(
        String(part.trigger || part.name || part.command || '')
      )
    );
}

function hasExplicitMessageWorkspaceRequest(input: QueryIntentClassifierInput): boolean {
  return (Array.isArray(input.explicitParts) ? input.explicitParts : [])
    .some(part =>
      String(part?.type || '') === 'workspace'
      && String(part?.source || '') === 'message-path'
      && Boolean(String(part?.path || part?.root || '').trim())
    );
}

function getExplicitWorkspaceReferences(input: QueryIntentClassifierInput): string[] {
  const references = [
    ...(Array.isArray(input.workspaceFileMentions) ? input.workspaceFileMentions : []),
    ...(Array.isArray(input.explicitParts) ? input.explicitParts
      .filter(part => String(part?.type || '') === 'workspace_file')
      .map(part => ({
        path: String(part.path || ''),
        name: String(part.name || part.label || ''),
      })) : []),
  ];
  return normalizeStringArray(references.map(item => item.path || item.name), 30, 1000);
}

export function classifyQueryIntentFallback(input: QueryIntentClassifierInput): QueryIntent {
  const message = compactText(input.message, 20000);
  const priorFiles = getPriorFileReferences(input);
  const explicitWorkspaceFiles = getExplicitWorkspaceReferences(input);
  const explicitMessageWorkspace = hasExplicitMessageWorkspaceRequest(input);
  const currentFiles = extractFileReferences(message);
  const contextualFollowUp = CONTEXTUAL_FOLLOWUP_PATTERN.test(message);
  const hasWorkspaceLanguage = WORKSPACE_CONTAINER_PATTERN.test(message)
    && (WORKSPACE_ACTION_PATTERN.test(message) || currentFiles.length > 0 || contextualFollowUp);
  const hasAuthorizedWorkspaceReuse = !!input.workspaceRoot
    && (
      AI_WORKSPACE_REFERENCE_PATTERN.test(message)
      || (
        WORKSPACE_REUSE_ACTION_PATTERN.test(message)
        && WORKSPACE_REUSE_OBJECT_PATTERN.test(message)
      )
    );
  const hardWorkspaceFollowUp = explicitWorkspaceFiles.length > 0
    || explicitMessageWorkspace
    || currentFiles.length > 0
    || hasWorkspaceLanguage
    || hasAuthorizedWorkspaceReuse
    || (contextualFollowUp && priorFiles.length > 0);
  const excludedFiles = resolveExcludedFiles(message, priorFiles);
  const explicitLiteratureCollection = hasExplicitLiteratureCollectionRequest(message);
  const explicitLiterature = hasExplicitLiteratureRequest(message);
  const explicitWebSearch = hasExplicitWebSearchRequest(message);
  const hasAttachments = Array.isArray(input.attachments) && input.attachments.length > 0;
  const imageAttachment = hasAttachments && input.attachments!.some(item =>
    String(item.type || '').toLowerCase() === 'image'
    || /\.(?:png|jpe?g|gif|bmp|webp|tiff?|svg)$/i.test(String(item.name || item.path || ''))
  );
  const routingText = currentFiles.reduce(
    (text, file) => text.replace(file, ' '),
    message
  );
  const hasDataContext = hasAttachments || currentFiles.length > 0;
  const hasMetaIntent = hasMetaAnalysisRequest(routingText, hasDataContext);
  const hasBibliometricsIntent = hasBibliometricsRequest(routingText, hasDataContext);
  const hasPdfWikiIntent = PDF_WIKI_PATTERN.test(routingText);
  const hasRPlotIntent = hasRPlotRequest(routingText, hasDataContext);
  const hasDataAnalysisIntent = hasDataAnalysisRequest(routingText, hasDataContext);
  const hasProjectIntent = PROJECT_PATTERN.test(routingText);
  const hasWritingIntent = WRITING_PATTERN.test(routingText);
  const citationRequiredWriting = isCitationRequiredWritingRequest(input);
  const explicitSkillParts = Array.isArray(input.explicitParts)
    ? input.explicitParts.filter(part => String(part?.type || '') === 'slash')
    : [];
  const hasExplicitSkillIntent = explicitSkillParts.length > 0;
  const hasExplicitLiteratureSkillIntent = hasExplicitLiteratureSkillRequest(input);
  const hasExplicitWorkspaceSkillIntent = hasExplicitWorkspaceSkillRequest(input);

  let primaryIntent: QueryPrimaryIntent = 'general_chat';
  let action: QueryIntentAction = 'explain';
  let dataSource: QueryIntentDataSource = 'conversation';
  let needsWorkspaceSearch = false;
  let needsWebSearch = explicitWebSearch;
  let needsLiteratureRetrieval = false;
  let needsToolExecution = false;
  let confidence = 0.62;
  let reason = '未发现需要专用工作流的强信号，按普通对话处理。';

  if (explicitLiteratureCollection) {
    primaryIntent = 'literature_collection';
    action = 'collect';
    dataSource = 'external_literature';
    needsWorkspaceSearch = false;
    needsWebSearch = false;
    needsLiteratureRetrieval = false;
    needsToolExecution = true;
    confidence = 0.99;
    reason = '检测到采集、批量获取或从 WoS/CNKI 获取新文献的意图，应调用外部文献采集工具，不能先检索本地 Embedding/PDF Wiki。';
  } else if (hasMetaIntent) {
    primaryIntent = 'meta_analysis';
    action = resolveAction(message, 'analyze');
    dataSource = hasAttachments ? 'attachments' : 'meta_analysis';
    needsWorkspaceSearch = hardWorkspaceFollowUp || (!!input.workspaceRoot && FILE_WORD_PATTERN.test(message));
    needsToolExecution = true;
    needsLiteratureRetrieval = explicitLiterature;
    confidence = 0.94;
    reason = '检测到 Meta 分析、效应量或诊断分析意图。';
  } else if (hasBibliometricsIntent) {
    primaryIntent = 'bibliometrics';
    action = resolveAction(message, 'analyze');
    dataSource = 'bibliometrics';
    needsWorkspaceSearch = hardWorkspaceFollowUp;
    needsToolExecution = true;
    needsLiteratureRetrieval = explicitLiterature;
    confidence = 0.94;
    reason = '检测到文献计量或知识结构分析意图。';
  } else if (hasPdfWikiIntent) {
    primaryIntent = 'pdf_wiki';
    action = resolveAction(message, 'search');
    dataSource = 'pdf_wiki';
    needsWorkspaceSearch = hardWorkspaceFollowUp;
    needsToolExecution = true;
    needsLiteratureRetrieval = false;
    confidence = 0.94;
    reason = '检测到 PDF Wiki、句子级论点或证据映射意图。';
  } else if (hasRPlotIntent) {
    primaryIntent = 'r_plot';
    action = 'plot';
    dataSource = hasAttachments ? 'attachments' : (input.workspaceRoot ? 'workspace' : 'unknown');
    needsWorkspaceSearch = hardWorkspaceFollowUp || !!input.workspaceRoot;
    needsToolExecution = true;
    needsLiteratureRetrieval = explicitLiterature;
    confidence = 0.91;
    reason = '检测到绘图、图形修改或 R 作图意图。';
  } else if (hasDataAnalysisIntent) {
    primaryIntent = 'data_analysis';
    action = 'analyze';
    dataSource = hasAttachments ? 'attachments' : (input.workspaceRoot ? 'workspace' : 'unknown');
    needsWorkspaceSearch = hardWorkspaceFollowUp || !!input.workspaceRoot;
    needsToolExecution = true;
    needsLiteratureRetrieval = explicitLiterature;
    confidence = 0.9;
    reason = '检测到数据或统计分析意图。';
  } else if (hasProjectIntent) {
    primaryIntent = 'project_management';
    action = resolveAction(message, 'configure');
    dataSource = input.workspaceRoot ? 'workspace' : 'conversation';
    needsWorkspaceSearch = hardWorkspaceFollowUp;
    needsToolExecution = true;
    confidence = 0.9;
    reason = '检测到项目创建、导入、切换或项目记忆意图。';
  } else if (hasExplicitSkillIntent) {
    primaryIntent = 'skill_or_tool';
    action = 'configure';
    dataSource = hasExplicitWorkspaceSkillIntent ? 'workspace' : 'conversation';
    needsWorkspaceSearch = hasExplicitWorkspaceSkillIntent;
    needsToolExecution = true;
    needsLiteratureRetrieval = explicitLiterature || hasExplicitLiteratureSkillIntent;
    confidence = 0.98;
    reason = '检测到消息开头解析出的显式 Skill 或工具调用。';
  } else if (hasWritingIntent && WRITING_ACTION_PATTERN.test(routingText)) {
    primaryIntent = 'academic_writing';
    action = resolveAction(message, 'write');
    dataSource = hardWorkspaceFollowUp || hasAttachments ? 'mixed' : 'conversation';
    needsWorkspaceSearch = hardWorkspaceFollowUp;
    needsLiteratureRetrieval = explicitLiterature || citationRequiredWriting;
    needsToolExecution = hardWorkspaceFollowUp || explicitLiterature || citationRequiredWriting;
    confidence = 0.9;
    reason = citationRequiredWriting
      ? '检测到需要参考文献支撑的章节写作，必须先检索本地双库并匹配证据。'
      : '检测到明确的学术写作、续写、改写或润色动作。';
  } else if (hardWorkspaceFollowUp) {
    primaryIntent = 'workspace_file';
    action = resolveAction(message, 'search');
    dataSource = hasAttachments ? 'mixed' : 'workspace';
    needsWorkspaceSearch = true;
    needsLiteratureRetrieval = explicitLiterature;
    needsToolExecution = true;
    confidence = explicitWorkspaceFiles.length || currentFiles.length ? 0.99 : 0.97;
    reason = contextualFollowUp && priorFiles.length > 0
      ? '当前句是上一轮文件结果的上下文跟进，应先解析指代并继续搜索工作目录。'
      : (explicitMessageWorkspace
          ? '当前句显式粘贴并授权了一个本地路径，应在该路径及其会话 AI 工作目录内检索。'
          : (hasAuthorizedWorkspaceReuse
              ? '当前句要求查找或复用已授权目录中的 AI 历史产物，应检索 ScholarHarness_AI_Workspaces 及用户配置目录。'
              : '当前句明确涉及工作目录文件或文件操作。'));
  } else if (explicitLiterature) {
    primaryIntent = 'literature_retrieval';
    action = 'search';
    dataSource = 'literature';
    needsLiteratureRetrieval = true;
    needsToolExecution = true;
    confidence = 0.95;
    reason = '用户明确要求检索、引用或文献证据。';
  } else if (imageAttachment) {
    primaryIntent = 'multimodal_task';
    action = 'analyze';
    dataSource = 'attachments';
    needsToolExecution = true;
    confidence = 0.86;
    reason = '当前请求包含图片附件，需要继续进行多模态意图识别。';
  }
  if (needsWebSearch) {
    needsToolExecution = true;
  }

  const secondaryIntents: QueryPrimaryIntent[] = [];
  if (primaryIntent !== 'workspace_file' && needsWorkspaceSearch) {
    secondaryIntents.push('workspace_file');
  }
  if (primaryIntent !== 'literature_retrieval' && needsLiteratureRetrieval) {
    secondaryIntents.push('literature_retrieval');
  }
  if (primaryIntent !== 'r_plot' && hasRPlotIntent) {
    secondaryIntents.push('r_plot');
  }
  if (primaryIntent !== 'data_analysis' && hasDataAnalysisIntent) {
    secondaryIntents.push('data_analysis');
  }
  const referencedFiles = normalizeStringArray([
    ...explicitWorkspaceFiles,
    ...currentFiles,
    ...(contextualFollowUp ? priorFiles : []),
  ], 30, 1000);
  let resolvedQuery = message;
  if (primaryIntent === 'workspace_file' && contextualFollowUp && priorFiles.length > 0) {
    const details = [
      excludedFiles.length ? `排除文件：${excludedFiles.join('；')}` : '',
      `上一轮文件候选：${priorFiles.join('；')}`,
      /(?:最新|最近|除了|还有|下一个)|\b(?:another|next|except)\b/i.test(message)
        ? '继续在用户配置目录和整个 ScholarHarness_AI_Workspaces 容器中核对候选文件；当前会话优先，也检查其他会话子目录，并按实际修改时间降序。'
        : '',
    ].filter(Boolean).join(' ');
    resolvedQuery = `${message} [上下文解析：${details}]`;
  }

  return {
    version: 1,
    source: 'fallback',
    primaryIntent,
    secondaryIntents,
    action,
    dataSource,
    isContextualFollowUp: contextualFollowUp && getRecentHistory(input).length > 0,
    needsWorkspaceSearch,
    needsWebSearch,
    needsLiteratureRetrieval,
    needsToolExecution,
    needsClarification: false,
    resolvedQuery,
    referencedFiles,
    excludedFiles,
    requestedOutputs: [],
    requestedMethods: [],
    confidence,
    reason,
    recognizedAt: new Date().toISOString(),
  };
}

export function shouldUseAiQueryIntentClassifier(
  input: QueryIntentClassifierInput,
  _fallbackIntent?: QueryIntent,
): boolean {
  // Every meaningful turn is classified semantically first. Local rules are
  // retained only as a recovery path when the classifier is unavailable or
  // returns an invalid payload; attachments, slash Skills and explicit files
  // are context for the model rather than reasons to skip it.
  return Boolean(
    String(input.message || '').trim()
    || getRecentHistory(input).length
    || (input.attachments || []).length
    || (input.explicitParts || []).length
    || (input.contextItems || []).length
  );
}

export function buildQueryIntentClassifierPrompt(input: QueryIntentClassifierInput): string {
  const history = getClassifierHistory(input);
  const historyLines = history.map((item, index) =>
    `### ${index + 1}. ${item.role}\n${item.content}`
  );
  const explicitWorkspaceFiles = getExplicitWorkspaceReferences(input);
  const attachmentLines = (Array.isArray(input.attachments) ? input.attachments : [])
    .slice(0, 12)
    .map((item, index) => `- attachment_${index + 1}: ${compactText(item.name || item.path || item.type, 1000)}`);
  return [
    '你是 Scholar Harness 的统一 Query 意图识别器，不是最终回答助手。',
    '你的输出会决定是否搜索工作目录、是否联网、是否检索文献以及调用哪类科研工具。只输出一个严格 JSON 对象。',
    '',
    '## 最高优先级规则',
    '1. CURRENT_USER_QUERY 是本轮目标，但“这个/那个/它/除了这个/还有呢/下一个/第二个/继续”等必须结合最近对话解析。',
    '2. 文件名、路径、扩展名、工作目录、最新文件、排除某文件、继续找另一个文件，统一归为 workspace_file；不能因为文件名包含英文或论文术语就改判成文献检索。',
    '3. 结合 RECENT_CONVERSATION 判断本轮是否真的需要执行新的文献检索。用户要求复用、插入、调整或纠正上一轮已经检索到的文献时，needsLiteratureRetrieval=false，dataSource=conversation；只有需要获取新证据时才为 true。撰写新的引言、讨论、文献综述等引用密集内容且历史证据不足时通常需要新检索。',
    '3a. literatureEvidenceMode 必须由你根据当前 Query 与最近对话判断：reuse_existing=只复用上一轮已有文献/建议/结果；search_new=确实要从 Embedding/PDF Wiki 获取新证据；none=本轮不涉及文献证据。只有 search_new 才允许 needsLiteratureRetrieval=true。',
    '3b. “接受你的结果/建议”“按刚才结果处理”“把这些文献插入句子/尾注”等上下文执行请求，如果最近 assistant 已经给出结果、文献或建议，必须选择 reuse_existing，不得因为出现“参考文献、支撑、引用、尾注”而重新检索。除非用户明确说“再检索、另找、新增、补找、重新搜索”或现有证据不足并明确要求补充新证据。',
    '4. 只有 CURRENT_USER_QUERY 明确要求联网、网页、实时信息或当前新闻/价格/政策时，needsWebSearch 才能为 true；“latest/newest/recent file”、英文单词或历史内容都不能触发联网。',
    '5. 显式 @ 文件、/ Skill、附件和工作目录状态优先于自然语言猜测。',
    '6. 多步骤请求选择最能代表最终产物的 primaryIntent，其余写入 secondaryIntents；同时正确设置 needsWorkspaceSearch、needsWebSearch、needsLiteratureRetrieval 和 needsToolExecution。',
    '7. resolvedQuery 应把上下文指代还原成第二阶段 Agent 可直接执行的完整指令；不得虚构历史中不存在的文件或事实。',
    '8. 英文必须按完整单词和语义组合判断；profile 不是 file，preview 不是 view，preference 不是 reference，findings 不是 find。裸露的 Figure、regression、paper 也不等于执行作图、统计或检索，必须同时存在相应动作和对象。',
    '9. 用户已配置工作目录时，“找相关内容”“继续使用之前 AI 输出”“检查刚才生成的结果”属于 workspace_file；必须搜索整个 ScholarHarness_AI_Workspaces 容器（当前会话优先，但不能漏掉其余会话子目录）和用户配置目录。',
    '10. “采集/收集/获取/下载/导出若干篇文献”或“从 WoS/CNKI 获取新文献”属于 literature_collection，needsLiteratureRetrieval=false；“在已有库找引用、证据、支撑或核验”才属于 literature_retrieval，needsLiteratureRetrieval=true。两者不能混用。',
    '',
    '## 允许的枚举',
    '- primaryIntent/secondaryIntents: workspace_file | literature_collection | literature_retrieval | academic_writing | data_analysis | r_plot | meta_analysis | bibliometrics | pdf_wiki | multimodal_task | skill_or_tool | project_management | general_chat',
    '- action: collect | search | read | create | edit | delete | analyze | plot | write | explain | continue | configure | other',
    '- dataSource: external_literature | workspace | attachments | conversation | literature | pdf_wiki | meta_analysis | bibliometrics | mixed | none | unknown',
    '',
    '## JSON 字段',
    '{',
    '  "primaryIntent": "...",',
    '  "secondaryIntents": ["..."],',
    '  "action": "...",',
    '  "dataSource": "...",',
    '  "isContextualFollowUp": true,',
    '  "needsWorkspaceSearch": true,',
    '  "needsWebSearch": false,',
    '  "needsLiteratureRetrieval": false,',
    '  "literatureEvidenceMode": "none | reuse_existing | search_new",',
    '  "needsToolExecution": true,',
    '  "needsClarification": false,',
    '  "resolvedQuery": "结合历史还原后的完整任务",',
    '  "referencedFiles": ["..."],',
    '  "excludedFiles": ["..."],',
    '  "requestedOutputs": ["..."],',
    '  "requestedMethods": ["..."],',
    '  "confidence": 0.0,',
    '  "reason": "一句话理由"',
    '}',
    '',
    '## 关键示例',
    'user: 帮我采集极端降雨对农田土壤 N2O 排放影响的文献',
    '正确：primaryIntent=literature_collection，action=collect，dataSource=external_literature，needsLiteratureRetrieval=false，needsToolExecution=true；调用 WoS/CNKI 外部采集工具，不运行本地 Embedding/PDF Wiki 检索。',
    '',
    'user: 给我去 Web of Science 导出 3000 篇关于华北平原玉米 N2O 排放相关的文献',
    '正确：primaryIntent=literature_collection，action=collect，dataSource=external_literature，needsLiteratureRetrieval=false，needsToolExecution=true；“导出 3000 篇文献”是明确的新文献采集请求，不能要求用户改写成“采集”。',
    '',
    'user: 在我已有的文献库里找支持“极端降雨促进 N2O 排放”的证据并给出引用',
    '正确：primaryIntent=literature_retrieval，action=search，dataSource=literature，needsLiteratureRetrieval=true；检索本地 Embedding/PDF Wiki，不创建外部采集任务。',
    '',
    'assistant: 工作目录最新的 .docx 是 supporting information.docx。',
    'user: 除了这个呢：supporting information',
    '正确：primaryIntent=workspace_file，action=search，isContextualFollowUp=true，needsWorkspaceSearch=true，needsWebSearch=false，needsLiteratureRetrieval=false，excludedFiles=["supporting information.docx"]，resolvedQuery=排除 supporting information.docx 后在两个工作目录中按 mtime 查找下一个最新的 .docx。',
    '',
    'user: 检索有关 N2O 排放与降水关系的论文并给出引用',
    '正确：primaryIntent=literature_retrieval，needsLiteratureRetrieval=true。',
    '',
    'user: Please update preference settings and preview profile.',
    '正确：primaryIntent=general_chat，needsWorkspaceSearch=false，needsWebSearch=false，needsLiteratureRetrieval=false。',
    '',
    'user: Format the References section in APA style.',
    '正确：这是参考文献章节格式操作，不是检索请求；needsLiteratureRetrieval=false。',
    '',
    'assistant: 已检索到三篇相关文献，并给出了对应引用。',
    'user: 把刚才那句话改回来，只把你检索到的三篇文献插入对应句子。',
    '正确：这是基于对话历史的局部纠错和已有证据复用，primaryIntent=academic_writing，action=edit，dataSource=conversation，isContextualFollowUp=true，literatureEvidenceMode=reuse_existing，needsLiteratureRetrieval=false。不得把“检索到的”误解为新的检索动作。',
    '',
    'assistant: 已给出参考文献补充方案和对应句子的修改建议。',
    'user: 接受你的结果和建议，给我把参考文献补充进对应句子后面，以及尾注。',
    '正确：这是执行上一轮已经形成的结果，不是获取新证据。primaryIntent=academic_writing，action=edit，dataSource=conversation，isContextualFollowUp=true，literatureEvidenceMode=reuse_existing，needsLiteratureRetrieval=false。',
    '',
    'user: 找一下之前 AI 输出里与 N2O 有关的内容',
    '正确：如果 configuredWorkspace 可用，primaryIntent=workspace_file，action=search，needsWorkspaceSearch=true；递归检索 ScholarHarness_AI_Workspaces 和用户配置目录，不触发联网或文献检索。',
    '',
    '<RECENT_CONVERSATION>',
    historyLines.length ? historyLines.join('\n\n') : '无历史消息',
    '</RECENT_CONVERSATION>',
    '',
    '<CURRENT_USER_QUERY>',
    String(input.message || '').slice(0, 8000),
    '</CURRENT_USER_QUERY>',
    '',
    '<STRUCTURED_CONTEXT>',
    `configuredWorkspace: ${compactText(input.workspaceRoot || '', 1000) || 'unavailable'}`,
    `currentAiWorkRoot: ${compactText(input.aiWorkRoot || '', 1000) || 'unavailable'}`,
    `explicitWorkspaceFiles: ${explicitWorkspaceFiles.length ? JSON.stringify(explicitWorkspaceFiles) : '[]'}`,
    `attachments:\n${attachmentLines.length ? attachmentLines.join('\n') : '- none'}`,
    `explicitParts: ${JSON.stringify((input.explicitParts || []).slice(0, 30))}`,
    `contextItems: ${JSON.stringify((input.contextItems || []).slice(0, 50))}`,
    '</STRUCTURED_CONTEXT>',
  ].join('\n');
}

export function parseQueryIntentResponse(
  rawResponse: string,
  input: QueryIntentClassifierInput
): QueryIntent {
  const fallback = classifyQueryIntentFallback(input);
  const record = parseRecord(rawResponse);
  if (Object.keys(record).length === 0) return fallback;

  let intent: QueryIntent = {
    version: 1,
    source: 'ai',
    primaryIntent: normalizeEnum(record.primaryIntent, PRIMARY_INTENTS, fallback.primaryIntent),
    secondaryIntents: normalizeStringArray(record.secondaryIntents, 8, 80)
      .map(item => normalizeEnum(item, PRIMARY_INTENTS, 'general_chat'))
      .filter((item, index, items) => item !== 'general_chat' && items.indexOf(item) === index),
    action: normalizeEnum(record.action, ACTIONS, fallback.action),
    dataSource: normalizeEnum(record.dataSource, DATA_SOURCES, fallback.dataSource),
    isContextualFollowUp: normalizeBoolean(record.isContextualFollowUp, fallback.isContextualFollowUp),
    needsWorkspaceSearch: normalizeBoolean(record.needsWorkspaceSearch, fallback.needsWorkspaceSearch),
    needsWebSearch: normalizeBoolean(record.needsWebSearch, fallback.needsWebSearch),
    needsLiteratureRetrieval: normalizeBoolean(record.needsLiteratureRetrieval, fallback.needsLiteratureRetrieval),
    literatureEvidenceMode: normalizeEnum(
      record.literatureEvidenceMode,
      LITERATURE_EVIDENCE_MODES,
      normalizeBoolean(record.needsLiteratureRetrieval, fallback.needsLiteratureRetrieval)
        ? 'search_new'
        : (normalizeEnum(record.dataSource, DATA_SOURCES, fallback.dataSource) === 'conversation'
          ? 'reuse_existing'
          : 'none')
    ),
    needsToolExecution: normalizeBoolean(record.needsToolExecution, fallback.needsToolExecution),
    needsClarification: normalizeBoolean(record.needsClarification, false),
    resolvedQuery: compactText(record.resolvedQuery || fallback.resolvedQuery, 12000),
    referencedFiles: normalizeStringArray(record.referencedFiles, 30, 1000),
    excludedFiles: normalizeStringArray(record.excludedFiles, 20, 1000),
    requestedOutputs: normalizeStringArray(record.requestedOutputs, 20, 500),
    requestedMethods: normalizeStringArray(record.requestedMethods, 20, 300),
    confidence: Number.isFinite(Number(record.confidence))
      ? Math.min(1, Math.max(0, Number(record.confidence)))
      : fallback.confidence,
    reason: compactText(record.reason || fallback.reason, 1000),
    recognizedAt: new Date().toISOString(),
  };

  const explicitWebSearchRequest = hasExplicitWebSearchRequest(input.message);

  // Web access remains fail-closed because it leaves the local application.
  // Local literature retrieval follows the AI's contextual semantic decision;
  // deterministic classification is only used when the AI classifier is unavailable.
  intent.needsWebSearch = explicitWebSearchRequest;
  if (Object.prototype.hasOwnProperty.call(record, 'literatureEvidenceMode')) {
    intent.needsLiteratureRetrieval = intent.literatureEvidenceMode === 'search_new';
  }
  if (intent.needsWebSearch || intent.needsLiteratureRetrieval) {
    intent.needsToolExecution = true;
  }

  if (intent.primaryIntent === 'workspace_file') {
    intent.needsWorkspaceSearch = true;
    intent.needsToolExecution = true;
  } else if (intent.primaryIntent === 'literature_collection') {
    intent.action = 'collect';
    intent.dataSource = 'external_literature';
    intent.needsWorkspaceSearch = false;
    intent.needsWebSearch = false;
    intent.needsLiteratureRetrieval = false;
    intent.needsToolExecution = true;
  } else if (intent.primaryIntent === 'literature_retrieval') {
    // A primary label does not independently authorize a new search. The AI
    // may use it for a contextual reference-editing turn while explicitly
    // choosing reuse_existing.
    intent.needsToolExecution = intent.needsToolExecution || intent.needsLiteratureRetrieval;
  }
  if (!intent.needsLiteratureRetrieval) {
    intent.secondaryIntents = intent.secondaryIntents.filter(item => item !== 'literature_retrieval');
  }
  if (intent.needsWorkspaceSearch && intent.primaryIntent !== 'workspace_file'
      && !intent.secondaryIntents.includes('workspace_file')) {
    intent.secondaryIntents.push('workspace_file');
  }
  if (intent.needsLiteratureRetrieval && intent.primaryIntent !== 'literature_retrieval'
      && !intent.secondaryIntents.includes('literature_retrieval')) {
    intent.secondaryIntents.push('literature_retrieval');
  }

  return intent;
}

export function normalizeQueryIntent(value: unknown): QueryIntent | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Number(record.version) !== 1) return null;
  const fallback = classifyQueryIntentFallback({
    message: String(record.resolvedQuery || ''),
  });
  const intent = parseQueryIntentResponse(JSON.stringify(record), {
    message: String(record.resolvedQuery || ''),
  });
  intent.source = record.source === 'fallback' ? 'fallback' : 'ai';
  intent.recognizedAt = compactText(record.recognizedAt, 100) || fallback.recognizedAt;
  return intent;
}

export function buildQueryIntentPromptBlock(intent: QueryIntent | null | undefined): string {
  if (!intent) return '';
  const routing = {
    primaryIntent: intent.primaryIntent,
    secondaryIntents: intent.secondaryIntents,
    action: intent.action,
    dataSource: intent.dataSource,
    isContextualFollowUp: intent.isContextualFollowUp,
    needsWorkspaceSearch: intent.needsWorkspaceSearch,
    needsWebSearch: intent.needsWebSearch,
    needsLiteratureRetrieval: intent.needsLiteratureRetrieval,
    literatureEvidenceMode: intent.literatureEvidenceMode,
    needsToolExecution: intent.needsToolExecution,
    needsClarification: intent.needsClarification,
    resolvedQuery: intent.resolvedQuery,
    referencedFiles: intent.referencedFiles,
    excludedFiles: intent.excludedFiles,
    requestedOutputs: intent.requestedOutputs,
    requestedMethods: intent.requestedMethods,
    confidence: intent.confidence,
    reason: intent.reason,
    source: intent.source,
  };
  const rules = [
    '执行规则：',
    '- 结构化意图只是正式 Agent 的路由建议，不是工具调用命令，也不得覆盖 CURRENT_USER_REQUEST；正式 Agent 必须结合当前 query、最近对话和可用资源自行决定是否调用任何工具。',
    intent.needsWorkspaceSearch
      ? '- 路由器认为工作目录检索可能有帮助。只有正式 Agent 判断当前任务确实需要核对文件时才调用目录工具，并遵守 referencedFiles 和 excludedFiles。'
      : '',
    intent.needsWebSearch
      ? '- 路由器认为联网可能有帮助。正式 Agent 仍需确认当前请求确实依赖实时/外部事实后再联网，并仅围绕 resolvedQuery 搜索。'
      : '- 本轮不得仅因英文、latest/newest/recent、科学术语或历史消息而擅自联网。',
    intent.needsLiteratureRetrieval
      ? '- 路由器认为文献证据可能有帮助。不得在正式 Agent 之前自动检索；由正式 Agent 判断是否调用本地文献检索，并自行确定检索问题、来源和条数。'
      : '- 本轮不得仅因英文术语、论文文件名或历史学术内容而擅自触发文献检索。',
    intent.needsToolExecution && intent.primaryIntent !== 'literature_collection'
      ? '- 路由器认为工具执行可能有帮助；正式 Agent 应先判断工具是否必要，再选择与 primaryIntent/action 对应的能力。'
      : '',
    intent.primaryIntent === 'literature_collection'
      ? '- 主页聊天输入框暂不开放 WoS/CNKI 外部采集，不得调用 collect_literature_by_topic，也不得改走本地 Embedding 文献库或 PDF Wiki。简洁说明该入口暂未开放即可。'
      : '',
  ].filter(Boolean);
  return [
    '## 统一 AI Query 意图（路由中间结果）',
    '```json',
    JSON.stringify(routing, null, 2),
    '```',
    ...rules,
    '',
  ].join('\n');
}
