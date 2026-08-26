import { createHash } from 'crypto';

import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';

export interface HarnessCapabilitySkill {
  id: string;
  name: string;
  description: string;
  category: string;
  source: 'bundled' | 'user';
  sourceLabel: string;
  manualTrigger?: string;
}

export interface HarnessCapabilityMcpPlugin {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  status?: 'ready' | 'error' | 'unchecked';
  risk: 'read' | 'network' | 'write' | 'command';
  updatedAt?: string;
  tools: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
}

export interface HarnessCapabilityInventory {
  skills: HarnessCapabilitySkill[];
  mcpPlugins: HarnessCapabilityMcpPlugin[];
  domainManifest?: string;
}

/**
 * 领域能力清单（pi-style 能力外放）。
 *
 * 这些能力不直接作为 tool schema 暴露给模型（避免 79 个专用工具把每轮
 * prompt 撑爆）。模型通过 read_capabilities 按需读取本清单，再用
 * invoke_capability 触发对应能力。领域知识放在“可读文件/清单”里，
 * 而不是塞进系统提示词。
 */
const EXTERNAL_LITERATURE_COLLECTION_CAPABILITY =
  '- capability: collect_literature_by_topic —— 按主题采集外部文献（WoS/CNKI，需要授权配置）。args: { topic, ... }';

const CAPABILITIES_MANIFEST_LINES = [
  '## Scholar Harness 领域能力清单',
  '',
  '以下能力不直接暴露为工具，需要用 invoke_capability 调用（capability=能力名，args=参数对象）。',
  '文件参数必须是当前授权工作目录内的真实路径，不能猜路径。',
  '',
  '### 数据分析与作图',
  '- capability: utility_data_analysis —— 读取工作目录 Excel/CSV，检查字段或执行统计（descriptive/independent_t/paired_t/anova/correlation/regression/chi_square/normality/pca/cluster 等）。args: { action:"inspect"|"analyze", filePath, methods:[...], sheetName?, numericVar?, groupVar?, dependentVar?, extraQuery? }',
  '- capability: utility_r_plot —— 用数据文件生成受控 R 作图代码（与“R 语言作图”页面共用后端）。args: { filePath, chartType:"boxplot|bar|scatter|line|heatmap", analysisType:"comparison|correlation|trend", customRequirements?, treatmentPaletteConfig? }',
  '',
  '### 文献计量与 Meta 分析',
  '- capability: meta_inspect_selected_dataset —— 查看已勾选的 Meta 数据字段、样例、缺失率、候选效应量。args: {}',
  '- capability: meta_run_selected_analysis —— 在字段映射/效应量配置明确后运行 Meta 分析。args: {}',
  '',
  '### 证据与检索',
  '- capability: utility_sentence_claim_search —— 在本地 Embedding 文献库与 PDF Wiki 证据库检索支撑某学术句子的证据。args: { query, topK?, targetReferenceFormat? }',
  '- capability: search_local_literature —— 检索本地文献证据（Embedding 库 + PDF Wiki）。args: { query, topK?, sourceMode? }',
  EXTERNAL_LITERATURE_COLLECTION_CAPABILITY,
  '',
  '### 科研增强',
  '- capability: research_build_evidence_ledger —— 生成项目科研证据账本（论断/引用/PDF Wiki 证据/图表/代码/来源）。args: {}',
  '- capability: research_run_reviewer —— 运行审稿与可追溯性检查。args: {}',
  '- capability: research_export_reproducibility_bundle —— 导出可复现实验包。args: {}',
  '- capability: research_sync_obsidian —— 同步 PDF Wiki 论点到内置 Obsidian 知识库。args: {}',
  '- capability: research_search_obsidian —— 检索已同步的 Obsidian 论点知识库。args: { query, limit? }',
  '- capability: research_prepare_submission —— 生成期刊投稿准备包（Cover Letter/Highlights/审稿问题）。args: { targetJournal, manuscriptTitle?, abstractText?, ... }',
  '',
  '### 办公产物',
  '- capability: utility_flowchart_generate —— 把材料整理成可编辑 Mermaid 流程图。args: { instruction, filePaths?, flowchartType? }',
  '- capability: utility_ppt_generate —— 创建/查询 PPT 汇报后台任务。args: { operation:"create"|"status", jobId?, requirements?, sourcePaths? }',
  '',
  '### 页面资源与邮箱',
  '- capability: read_page_context —— 读取会话资源目录中的页面数据（current-pdf/bibliometrics/meta-analysis/auto-research/ordinary-draft）。args: { resourceId, detailLevel? }',
  '- capability: search_email_database —— 检索已同步邮箱邮件元数据与摘要；仅明确关键词才传 query，“看邮件/最近邮件/概览”时 query 留空。args: { query?, sender?, unreadOnly?, limit? }',
  '- capability: read_email_message —— 读取一封邮件正文。args: { accountId, messageId }',
  '- capability: query_email_knowledge_graph —— 查询邮件知识图谱节点与关系。args: { query?, nodeType?, limit? }',
  '',
  '### 上下文资源（如可用）',
  '- capability: read_page_context 之外，若任务涉及文献库、PDF Wiki、Meta、Auto Research 等页面勾选资源，优先通过 read_page_context 读取，而不是重复采集。',
];

export function getCapabilitiesManifest(options: { includeExternalLiteratureCollection?: boolean } = {}): string {
  const includeExternalLiteratureCollection = options.includeExternalLiteratureCollection !== false;
  return CAPABILITIES_MANIFEST_LINES
    .filter(line => includeExternalLiteratureCollection || line !== EXTERNAL_LITERATURE_COLLECTION_CAPABILITY)
    .join('\n');
}

export const CAPABILITIES_MANIFEST = getCapabilitiesManifest();

export function getReadCapabilitiesToolDefinition(): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'read_capabilities',
      description: '读取 Scholar Harness 的领域能力清单（数据分析、R 作图、Meta 分析、文献计量、证据账本、投稿准备、PPT、流程图、邮箱检索等）及其参数。这些能力不直接暴露为工具；先读本清单，再用 invoke_capability 调用对应能力。',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  };
}

export function getInvokeCapabilityToolDefinition(): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'invoke_capability',
      description: '调用 Scholar Harness 的一个领域能力（R 作图、数据分析、Meta 分析、证据检索、科研增强、PPT、流程图等）。先用 read_capabilities 读取能力清单确定 capability 名和 args 参数，再调用本工具。能力不直接暴露为独立工具，只有这一个入口。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          capability: { type: 'string', description: '能力名，见 read_capabilities 清单。' },
          args: { type: 'object', additionalProperties: true, description: '该能力需要的参数对象，见清单。' },
        },
        required: ['capability'],
      },
    },
  };
}

export function getListHarnessCapabilitiesToolDefinition(): LLMToolDefinition {
  return {
    type: 'function',
    function: {
      name: 'list_harness_capabilities',
      description: '实时列出 Scholar Harness 当前真正可用的 Skill、用户 Skill、MCP 插件与领域能力。用户询问“你有哪些 Skill/插件/MCP/工具/能力”时必须调用本工具，不能用 Pi、Codex 或 OpenCode 自己的原生清单代替。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          section: {
            type: 'string',
            enum: ['all', 'skills', 'mcp', 'domain'],
            description: '要查看的能力类别，默认 all。',
          },
          query: { type: 'string', description: '可选：按名称、描述、类别或工具名筛选。' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
        },
      },
    },
  };
}

export function isListHarnessCapabilitiesToolName(name: string): boolean {
  return name === 'list_harness_capabilities';
}

function capabilitySearchMatch(parts: unknown[], query: string): boolean {
  if (!query) return true;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = parts.map(part => String(part || '')).join(' ').toLowerCase();
  return terms.every(term => haystack.includes(term));
}

export function formatHarnessCapabilityInventory(
  inventory: HarnessCapabilityInventory,
  rawOptions: Record<string, unknown> = {},
): { content: string; data: Record<string, unknown> } {
  const requestedSection = String(rawOptions.section || 'all').trim().toLowerCase();
  const section = ['skills', 'mcp', 'domain'].includes(requestedSection) ? requestedSection : 'all';
  const query = String(rawOptions.query || '').trim();
  const limit = Math.min(200, Math.max(1, Math.floor(Number(rawOptions.limit || 100))));
  const skills = inventory.skills
    .filter(skill => capabilitySearchMatch([
      skill.id,
      skill.name,
      skill.description,
      skill.category,
      skill.source,
      skill.sourceLabel,
      skill.manualTrigger,
    ], query))
    .slice(0, limit);
  const plugins = inventory.mcpPlugins
    .filter(plugin => capabilitySearchMatch([
      plugin.id,
      plugin.name,
      plugin.description,
      plugin.status,
      plugin.risk,
      ...plugin.tools.flatMap(tool => [tool.name, tool.description]),
    ], query))
    .slice(0, limit);
  const readyPlugins = inventory.mcpPlugins.filter(plugin => (
    plugin.enabled && plugin.status === 'ready' && plugin.tools.length > 0
  ));
  const lines = [
    '## Scholar Harness 实时能力清单',
    '本清单来自 Scholar Harness 当前运行时注册结果；Pi/Codex/OpenCode 自身的原生能力列表不是本清单的替代品。',
    `- Agent Skills：${inventory.skills.length}（用户配置 ${inventory.skills.filter(skill => skill.source === 'user').length}）`,
    `- MCP 插件：已配置 ${inventory.mcpPlugins.length}，当前可调用 ${readyPlugins.length}`,
    '- MCP 调用方式：先用 list_user_mcp_tools 发现当前工具，再用 invoke_user_mcp_tool 调用。',
  ];
  if (section === 'all' || section === 'skills') {
    lines.push('', `### Skills${query ? `（筛选：${query}）` : ''}`);
    lines.push(...(skills.length
      ? skills.map(skill => `- [${skill.id}] ${skill.name}（${skill.category}/${skill.source === 'user' ? '用户配置' : skill.sourceLabel}）：${skill.description}${skill.manualTrigger ? `；命令 /${skill.manualTrigger.replace(/^\/+/, '')}` : ''}`)
      : ['- 没有匹配的 Skill。']));
  }
  if (section === 'all' || section === 'mcp') {
    lines.push('', `### MCP 插件${query ? `（筛选：${query}）` : ''}`);
    lines.push(...(plugins.length
      ? plugins.map(plugin => {
          const availability = plugin.enabled && plugin.status === 'ready' && plugin.tools.length > 0
            ? '可调用'
            : `不可调用：${plugin.enabled ? (plugin.status || 'unchecked') : '未启用'}`;
          const tools = plugin.tools.length ? plugin.tools.map(tool => tool.name).join('、') : '尚未发现工具';
          return `- [${plugin.id}] ${plugin.name}（${availability}；权限 ${plugin.risk}）：${plugin.description || '未提供说明'}；工具：${tools}`;
        })
      : ['- 当前没有已配置的 MCP 插件。']));
  }
  if (section === 'all' || section === 'domain') {
    lines.push('', inventory.domainManifest || CAPABILITIES_MANIFEST);
  }
  return {
    content: lines.join('\n'),
    data: {
      section,
      query,
      totalSkills: inventory.skills.length,
      matchedSkills: skills,
      configuredMcpPlugins: inventory.mcpPlugins.length,
      readyMcpPlugins: readyPlugins.length,
      matchedMcpPlugins: plugins.map(plugin => ({
        id: plugin.id,
        name: plugin.name,
        enabled: plugin.enabled,
        status: plugin.status || 'unchecked',
        risk: plugin.risk,
        tools: plugin.tools.map(tool => tool.name),
      })),
    },
  };
}

export function buildHarnessCapabilitySignature(inventory: HarnessCapabilityInventory): string {
  const normalized = {
    skills: inventory.skills
      .map(skill => ({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        source: skill.source,
        sourceLabel: skill.sourceLabel,
        manualTrigger: skill.manualTrigger || '',
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    mcpPlugins: inventory.mcpPlugins
      .map(plugin => ({
        id: plugin.id,
        name: plugin.name,
        description: plugin.description || '',
        enabled: plugin.enabled,
        status: plugin.status || 'unchecked',
        risk: plugin.risk,
        tools: plugin.tools
          .map(tool => ({
            name: tool.name,
            description: tool.description || '',
            inputSchema: tool.inputSchema || {},
          }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    domainManifest: inventory.domainManifest || CAPABILITIES_MANIFEST,
  };
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 20);
}

export function isReadCapabilitiesToolName(name: string): boolean {
  return name === 'read_capabilities';
}

/**
 * 把 invoke_capability 调用重写为目标能力调用（capability -> 工具名，
 * args -> 工具 arguments），复用既有执行器路由。
 */
export function rewriteInvokeCapabilityCall(call: LLMToolCall): LLMToolCall | null {
  if (call.function.name !== 'invoke_capability') return call;
  let parsed: Record<string, unknown> = {};
  try {
    const value = JSON.parse(call.function.arguments || '{}');
    parsed = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return null;
  }
  const capability = String(parsed.capability || '').trim();
  if (!capability) return null;
  const args = parsed.args && typeof parsed.args === 'object' && !Array.isArray(parsed.args)
    ? parsed.args as Record<string, unknown>
    : {};
  return {
    ...call,
    function: {
      name: capability,
      arguments: JSON.stringify(args),
    },
  };
}
