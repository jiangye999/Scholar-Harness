/**
 * 工作目录细则索引（Prompt 瘦身）。
 *
 * 系统提示只常驻“安全底线”规则；操作性细则按 key 存放，模型需要时通过
 * read_workspace_rule 工具按需读取，减少每轮固定携带的长规则 token。
 * 安全底线（权限、不猜、写前读、exec_shell 只读优先、报错必修）不在此表，
 * 永远常驻系统提示。
 */

export interface WorkspaceRuleEntry {
  title: string;
  content: string;
}

export const WORKSPACE_RULE_INDEX: Record<string, WorkspaceRuleEntry> = {
  workspace_scope: {
    title: '检索范围与归档会话',
    content: [
      'file_search、grep_files、list_dir 默认 scope=current：只覆盖用户源目录（排除 ScholarHarness_AI_Workspaces 容器）和当前会话 AI 工作区，不要只检查根目录直接文件。',
      '其他历史会话属于归档：先调用 list_archived_sessions 查看归档会话，再用 scope=archive 精确检索；不要把归档里的旧副本当成当前权威文件。',
    ].join('\n'),
  },
  safe_workspace: {
    title: 'AI 安全工作区与文件同步',
    content: [
      '用户源目录是已有文件的权威版本；同相对路径的源文件与 AI 工作副本同时存在时，每轮和每次受控读取都先用当前源文件刷新副本，禁止直接沿用旧副本。',
      '进入工作目录后已创建当前会话 AI 工作文件夹；所有修改、生成、R/Python/OfficeCLI 脚本运行先发生在 AI 工作目录。',
      'write_file/edit_file/office_apply 对已有源文件的修改会由后端按相对路径安全发布，确保两处一致；如果用户在 AI 读取后又保存了源文件，停止覆盖并要求重新读取。',
      '要运行脚本或修改 Office 文件，先读取脚本、复制数据文件或读取 Office 文档结构；Excel/图片/PDF/二进制数据等不能 read_file 的依赖必须先用 copy_file_to_workspace 放入 AI 工作文件夹。',
    ].join('\n'),
  },
  office_tools: {
    title: 'Office 文档工具选择',
    content: [
      '用户只要求读取 .docx 正文纯文本时，直接调用 read_file（后端自动解析 DOCX），不得因二进制格式改读旧 TXT。',
      '需要检查结构/格式、渲染或修改 .docx/.xlsx/.pptx 时，使用 office_view、office_get、office_query、office_apply；不确定 OfficeCLI 属性名时先调用 office_help。',
    ].join('\n'),
  },
  docx_fonts: {
    title: '论文草稿字体',
    content: '生成或更新论文草稿 DOCX 时，正文、标题、表格、图注和参考文献统一使用 Times New Roman；除非用户明确指定其他字体。',
  },
  read_file_window: {
    title: '按行读取文件',
    content: '需要读取代码或数据时，用 read_file 按行窗口读取；需要继续读取时用 nextStartLine 继续，不要重复读同一段。',
  },
  powershell_syntax: {
    title: 'Windows PowerShell 语法',
    content: '在 Windows PowerShell 中不要使用 bash 语法，例如 ||、&&、2>nul、grep、ls -la；检查文件存在用 Test-Path，递归找文件用 Get-ChildItem -Recurse -Filter "*.ext"。',
  },
  search_followup: {
    title: '搜索未命中的后续动作',
    content: [
      '不要因为目录摘要或一次 file_search 没显示某个文件就回答“没有”；必须先搜索相关文件名、变量名、图名或关键词。',
      '如果 file_search 没命中，检查结果里的 scanTruncated；必要时用 scope=all 或 scope=archive 覆盖历史会话，或继续用递归 list_dir、grep_files、PowerShell 的 Get-ChildItem -Recurse 确认。',
    ].join('\n'),
  },
  legacy_block: {
    title: '旧工具块格式',
    content: '不要输出 ```workspace_tool 代码块；旧格式仅用于历史兼容，当前会话使用原生工具调用。',
  },
};

export const WORKSPACE_RULE_KEYS_PROMPT = [
  '工作目录细则（需要时调用 read_workspace_rule 读取，无需每轮全部携带）：',
  ...Object.keys(WORKSPACE_RULE_INDEX).map(key => `${key}（${WORKSPACE_RULE_INDEX[key].title}）`),
  'project_legacy（完整对话遗产清单：最近处理过的文件与历史会话结论全文，按需读取）',
].join('；');

export function getWorkspaceRuleContent(key: string): string | null {
  const entry = WORKSPACE_RULE_INDEX[String(key || '').trim()];
  return entry ? `${entry.title}：\n${entry.content}` : null;
}
