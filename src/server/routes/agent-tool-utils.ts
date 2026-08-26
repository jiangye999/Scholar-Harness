/**
 * Agent tool utilities (pure, side-effect-free helpers extracted from the
 * 8000+ line chat-bridge.ts to make the tool-loop family easier to reuse and
 * test). These have no dependency on the ChatBridge singleton, so they can be
 * imported and unit-tested in isolation.
 */

import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';

/**
 * Tool-family pruning by intent: the research evidence-ledger / reviewer /
 * reproducibility / obsidian tools only make sense for research-writing,
 * literature, PDF Wiki and project tasks; injecting them into a file-search or
 * data-analysis turn only bloats the tool schema and slows the loop. Empty /
 * unknown intent keeps the full set (conservative).
 */
export const RESEARCH_TOOL_INTENTS = new Set([
  'academic_writing',
  'literature_retrieval',
  'literature_collection',
  'pdf_wiki',
  'project_management',
  'bibliometrics',
]);

export function filterUtilityAgentToolsByIntent(tools: LLMToolDefinition[], primaryIntent: string): LLMToolDefinition[] {
  if (!primaryIntent) return tools;
  const allowed = new Set<string>();
  if (primaryIntent === 'literature_retrieval' || primaryIntent === 'academic_writing' || primaryIntent === 'pdf_wiki') {
    allowed.add('utility_sentence_claim_search');
  }
  if (primaryIntent === 'data_analysis' || primaryIntent === 'r_plot' || primaryIntent === 'workspace_file' || primaryIntent === 'meta_analysis') {
    allowed.add('utility_data_analysis');
    allowed.add('utility_r_plot');
  }
  if (primaryIntent === 'project_management' || primaryIntent === 'academic_writing') {
    allowed.add('utility_flowchart_generate');
  }
  if (primaryIntent === 'project_management') {
    allowed.add('utility_ppt_generate');
  }
  if (allowed.size === 0) return [];
  return tools.filter(tool => allowed.has(tool.function.name));
}

/** True when a tool call is image inspection (vision tool or PIL/crop script). */
export function isImageInspectionCall(call: LLMToolCall): boolean {
    if (call.function.name === 'analyze_image') return true;
    if (call.function.name === 'analyze_images_batch') return true;
    if (call.function.name === 'exec_shell') {
      const command = String(call.function.arguments || '');
      return /(PIL|Image\.|numpy|crop|resize|LANCZOS|\.png|clean_image|image\d+|figure5)/i.test(command);
    }
    return false;
  }

/**
 * 脚本式“纯看图”检测：exec_shell 命令用 PIL/numpy/OpenCV 读取图片并做
 * 像素检查，但**不保存输出文件**。这类任务用视觉工具（analyze_images_batch）
 * 更简单、快速、省钱；反之，会保存输出文件的脚本属于图像处理/清理任务，
 * 或像素级精确数值检测（视觉模型无法可靠给出），应放行脚本。
 */
export function isScriptedImageInspectionCommand(command: string): boolean {
  const text = String(command || '');
  const usesImageLib = /(?:from\s+PIL|import\s+PIL|Image\.open|fromarray|cv2\.imread|plt\.imread|from\s+matplotlib|from\s+numpy|import\s+numpy|\bfromarray\b)/i.test(text)
    || /\bPIL\b|\bImage\b|\bnumpy\b|\bOpenCV\b|\bcv2\b/i.test(text);
  if (!usesImageLib) return false;
  // 有明确的输出/保存动作 = 图像处理/导出任务，不属于纯看图。
  const savesOutput = /(?:\.save\(|savefig\(|cv2\.imwrite|tofile\(|Image\.save|open\([^)]*['"](?:w|a|wb|ab)['"]\))/i.test(text);
  if (savesOutput) return false;
  // 纯看图特征：读取像素/尺寸/通道/直方图，或打印分析结论。
  return /(?:getpixel|pixel|\.size|\.shape|channels?|histogram|bbox|\.crop\(|\.resize\(|\.convert\(|np\.(?:array|mean|sum|count|where|nonzero)|print\(|残|白|像素|颜色|标签|panel|面板|fig)/i.test(text);
}

/**
 * 是否属于“测量/诊断脚本”执行：python 运行 diag_/measure_/inspect_ 或
 * 像素/连通域/检测类脚本。用于“文件优先”护栏——在还没读取任何源文件时
 * 提示模型先读 R/Python/Excel 源码，而不是先做像素逆向。
 */
export function isLikelyDiagnosticMeasurementScript(command: string): boolean {
  const text = String(command || '');
  return /\bpython\b/i.test(text)
    && /(?:diag_|measure_|inspect_|scan|pixel|连通|像素|测量|检测|crop)/i.test(text);
}

/**
 * 判断文件是否属于“运行中的临时测试/诊断文件”：diag_/measure_/inspect_/
 * scan_/tmp_/debug_/probe_ 前缀、_tmp/_temp 后缀、crops/scratch/tmp 目录，
 * 或带版本号的诊断脚本（diag_v33.py）。最终交付物（正式 R/Python/数据/图）
 * 通常没有这些特征，不会被误判。
 */
export function isLikelyTemporaryTestFile(filePath: string): boolean {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (!normalized) return false;
  const segments = normalized.split('/');
  const basename = segments[segments.length - 1] || '';
  const stem = basename.replace(/\.[^.]+$/, '').toLowerCase();
  const scriptLike = /\.(?:py|r|rmd|js|ts|sh|m|cmd|ps1)$/i.test(basename);
  const diagPrefix = /^(?:diag|measure|inspect|scan|debug|probe)[_.-]/i.test(stem);
  const tmpMarker = /(?:^|[_.-])(?:tmp|temp)(?:[_.-]|$)/i.test(stem) || /\.(?:tmp|temp)$/i.test(basename.toLowerCase());
  const versionedDiag = /(?:diag|measure|inspect|scan)[_.-]v?\d+/i.test(stem);
  // 位于诊断/临时目录（diag_/crops/scratch/tmp 等）内的文件视为临时。
  const tempDir = segments.slice(0, -1).some(segment =>
    /(?:diag|measure|inspect|scan|tmp|debug|probe|crops|scratch)/i.test(segment)
  );
  const testScript = scriptLike && /(?:^|[_.-])test[_.-]?/i.test(stem) && !/(?:final|deliver|release|result)/i.test(stem);
  return diagPrefix || tmpMarker || versionedDiag || tempDir || testScript;
}

/**
 * 视觉问题是否属于“代码已定义的属性”（字号/字体/颜色/线宽/坐标轴等）。
 * 这类问题应该直接读 R/Python 源码确认，视觉模型测不了精确字号，看图核对
 * 纯属浪费；只有渲染效果（残留标签、布局、图例渲染）才需要视觉工具。
 */
export function isCodeDefinedVisualPropertyQuestion(question: string): boolean {
  const text = String(question || '');
  return /(?:字号|字体|font[- ]?size|颜色|配色|线宽|line[- ]?width|坐标轴范围|轴刻度|坐标范围|cex|element_text|axis\.text|axis\.title)/i.test(text);
}

/**
 * 按本轮意图裁剪工作目录工具 schema，减少每轮请求里低频工具的
 * description token。核心文件工具（list/search/read/write/edit/exec/
 * copy/overview）始终保留；office 系列、移动/整理、导入资产、归档会话等
 * 只在出现对应信号时才暴露。未知工具保守保留，不改变执行能力。
 */
const ALWAYS_KEEP_WORKSPACE_TOOLS = new Set([
  'list_dir',
  'file_search',
  'grep_files',
  'read_file',
  'workspace_overview',
  'copy_file_to_workspace',
  'write_file',
  'edit_file',
  'exec_shell',
]);

export function filterWorkspaceToolsByIntent<T extends { function: { name: string } }>(
  tools: T[],
  input: { userMessage?: string; queryIntent?: { primaryIntent?: string; needsWorkspaceSearch?: boolean } | null },
): T[] {
  const message = String(input.userMessage || '');
  const primaryIntent = String(input.queryIntent?.primaryIntent || '');
  const needsWorkspaceSearch = input.queryIntent?.needsWorkspaceSearch === true;
  const wantsOffice = /(?:\.docx?|\.xlsx?|\.pptx?|\.xls\b|\bword\b|\bexcel\b|\bppt\b|\boffice\b|文档|表格|幻灯片|docx|xlsx|pptx|论文|稿件|manuscript)/i.test(message)
    || ['data_analysis', 'r_plot', 'meta_analysis', 'bibliometrics', 'workspace_file'].includes(primaryIntent);
  const wantsFileMove = /(?:移动|移到|挪|move|整理|reorgani[sz]e|删除空|remove.*empty)/i.test(message) || needsWorkspaceSearch;
  const wantsImport = /(?:导入|引入|import|资产|assets)/i.test(message);
  const wantsArchive = /(?:归档|历史会话|archiv)/i.test(message);
  return tools.filter(tool => {
    const name = tool.function.name;
    if (ALWAYS_KEEP_WORKSPACE_TOOLS.has(name)) return true;
    if (name.startsWith('office_') || name === 'build_figures_tables_docx') return wantsOffice;
    if (name === 'move_file' || name === 'remove_empty_directory') return wantsFileMove;
    if (name === 'import_workspace_assets') return wantsImport;
    if (name === 'list_archived_sessions') return wantsArchive;
    return true;
  });
}
