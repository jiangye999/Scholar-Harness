import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { z } from 'zod';

import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';
import { decrypt, encrypt, isEncrypted } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';
import { buildToolRuntimeEnv } from '../../utils/tool-runtime-env';

const pluginInputSchema = z.object({
  id: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/i),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(''),
  command: z.string().trim().min(1).max(1000),
  args: z.array(z.string().max(2000)).max(40).default([]),
  env: z.record(z.string().max(8000)).default({}),
  enabled: z.boolean().default(false),
  source: z.enum(['market', 'custom']).default('custom'),
  risk: z.enum(['read', 'network', 'write', 'command']).default('network'),
  iconKind: z.enum(['curated', 'npm', 'github', 'custom']).default('custom'),
  iconUrl: z.string().url().max(2000).optional().or(z.literal('')),
});

export type McpPluginInput = z.infer<typeof pluginInputSchema>;

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpPluginRecord extends McpPluginInput {
  installedAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  status?: 'ready' | 'error' | 'unchecked';
  error?: string;
  tools: McpDiscoveredTool[];
}

interface McpPluginStore {
  version: 1;
  plugins: McpPluginRecord[];
}

const marketplaceConfigSchema = z.object({
  smitheryApiKey: z.string().trim().max(8000).default(''),
  pulseApiKey: z.string().trim().max(8000).default(''),
  pulseTenantId: z.string().trim().max(500).default(''),
});

type McpMarketplaceConfig = z.infer<typeof marketplaceConfigSchema>;

interface StoredMcpMarketplaceConfig {
  version: 1;
  smitheryApiKey: string;
  pulseApiKey: string;
  pulseTenantId: string;
}

interface McpCuratedMarketplacePlugin extends Omit<McpPluginInput, 'enabled'> {
  autoEnableOnInstall?: boolean;
}

export const BROWSER_ASSIST_PLUGIN_ID = 'browser-assist';

const BROWSER_ASSIST_USAGE_POLICY = [
  '仅在普通网页读取或官方 API 无法取得内容时使用，并优先访问官网、开放获取页面和用户有权访问的内容。',
  '浏览器必须保持可见；遇到登录、CAPTCHA、滑块、人机验证或访问授权页面时，立即停止自动操作并请用户亲自在浏览器中完成。',
  '用户明确确认验证完成后才可继续。禁止自动求解验证码、伪装真人轨迹、隐藏自动化特征、轮换代理、规避访问控制或绕过网站限制。',
  '应遵守网站服务条款并限制访问频率；不得批量抓取用户无权访问的受限内容。',
].join('');

export const MCP_PLUGIN_MARKETPLACE: McpCuratedMarketplacePlugin[] = [
  {
    id: BROWSER_ASSIST_PLUGIN_ID,
    name: 'Browser Assist MCP',
    description: '学术网页读取受登录或人机验证阻塞时，打开可见浏览器供用户人工接管；验证完成后 AI 可复用持久会话继续读取。不会破解验证码或规避网站限制。',
    command: 'npx',
    args: [
      '-y',
      '@playwright/mcp@latest',
      '--user-data-dir',
      '${pluginDataDir}/profile',
      '--output-dir',
      '${pluginDataDir}/output',
      '--output-mode',
      'file',
      '--save-session',
      '--viewport-size',
      '1440x900',
      '--timeout-navigation',
      '90000',
      '--timeout-action',
      '15000',
    ],
    env: {},
    source: 'market',
    risk: 'network',
    iconKind: 'curated',
    autoEnableOnInstall: true,
  },
  {
    id: 'filesystem',
    name: 'Filesystem MCP',
    description: '在用户授权的目录中读取、搜索和管理文件。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '${workspace}'],
    env: {},
    source: 'market',
    risk: 'write',
    iconKind: 'curated',
  },
  {
    id: 'memory',
    name: 'Memory MCP',
    description: '为 AI 提供可持久化的知识图谱记忆工具。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
    source: 'market',
    risk: 'write',
    iconKind: 'curated',
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking MCP',
    description: '为复杂研究任务提供可检查的分步分析工具。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    env: {},
    source: 'market',
    risk: 'read',
    iconKind: 'curated',
  },
  {
    id: 'github',
    name: 'GitHub MCP',
    description: '搜索仓库、读取 Issue 与 Pull Request；需要配置 GitHub Token。',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    source: 'market',
    risk: 'network',
    iconKind: 'curated',
  },
];

export interface McpMarketplaceCandidate extends Omit<McpPluginInput, 'enabled'> {
  origin: 'curated' | 'npm' | 'github' | 'smithery' | 'glama' | 'pulsemcp' | 'mcpso';
  url?: string;
  version?: string;
  stars?: number;
  updatedAt?: string;
  installable?: boolean;
  projectType?: 'mcp' | 'related-project';
  aiAdaptable?: boolean;
  autoEnableOnInstall?: boolean;
}

function marketplaceId(prefix: string, value: string): string {
  const normalized = value.toLowerCase()
    .replace(/^@/, '')
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return `${prefix}-${normalized || 'plugin'}`.slice(0, 80);
}

async function searchNpmMcpPlugins(query: string): Promise<McpMarketplaceCandidate[]> {
  const text = query ? `${query} mcp` : 'academic research literature citation paper mcp';
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=20`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Scholar-Harness/1.0.8' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`npm Registry 返回 HTTP ${response.status}`);
  const payload = await response.json() as { objects?: Array<{ package?: any }> };
  const explicitMcpPackages = (payload.objects || []).map(item => item.package || {}).filter(pkg => {
    if (!pkg.name) return false;
    const identity = [
      pkg.name,
      pkg.description,
      ...(Array.isArray(pkg.keywords) ? pkg.keywords : []),
    ].filter(Boolean).join(' ');
    return /(?:^|[^a-z0-9])mcp(?:[^a-z0-9]|$)|model\s+context\s+protocol/i.test(identity);
  });
  return Promise.all(explicitMcpPackages.slice(0, 12).map(async pkg => {
    let hasExecutable = false;
    try {
      const metadataResponse = await fetch(
        `https://registry.npmjs.org/${encodeURIComponent(String(pkg.name))}/latest`,
        {
          headers: { accept: 'application/json', 'user-agent': 'Scholar-Harness/1.0.8' },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (metadataResponse.ok) {
        const metadata = await metadataResponse.json() as { bin?: string | Record<string, string> };
        hasExecutable = typeof metadata.bin === 'string'
          ? !!metadata.bin.trim()
          : !!metadata.bin && Object.keys(metadata.bin).length > 0;
      }
    } catch {
      hasExecutable = false;
    }
    return {
      id: marketplaceId('npm', String(pkg.name)),
      name: String(pkg.name),
      description: String(pkg.description || 'npm MCP package'),
      command: 'npx',
      args: hasExecutable ? ['-y', String(pkg.name)] : [],
      env: {},
      source: 'market' as const,
      risk: 'network' as const,
      origin: 'npm' as const,
      iconKind: 'npm' as const,
      url: String(pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`),
      version: String(pkg.version || ''),
      updatedAt: String(pkg.date || ''),
      installable: hasExecutable,
    };
  }));
}

async function resolveGithubNpxLaunch(
  fullName: string,
  headers: Record<string, string>,
): Promise<{ command: string; args: string[] } | null> {
  if (!/^[^/\s]+\/[^/\s]+$/.test(fullName)) return null;
  try {
    const response = await fetch(`https://api.github.com/repos/${fullName}/contents/package.json`, {
      headers: { ...headers, accept: 'application/vnd.github.raw+json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const packageJson = await response.json() as {
      bin?: string | Record<string, string>;
    };
    const hasExecutable = typeof packageJson.bin === 'string'
      ? !!packageJson.bin.trim()
      : !!packageJson.bin && Object.keys(packageJson.bin).length > 0;
    return hasExecutable
      ? { command: 'npx', args: ['-y', `github:${fullName}`] }
      : null;
  } catch {
    return null;
  }
}

async function searchGithubMcpPlugins(query: string): Promise<McpMarketplaceCandidate[]> {
  const searchText = query
    ? `${query} in:name,description,readme`
    : 'MCP academic research literature citation paper in:name,description,readme';
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchText)}&sort=stars&order=desc&per_page=20`;
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'Scholar-Harness/1.0.8',
  };
  const githubToken = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`GitHub Search 返回 HTTP ${response.status}`);
  const payload = await response.json() as { items?: any[] };
  const repositories = (payload.items || []).filter(repo => {
    if (!repo.full_name || repo.archived) return false;
    return true;
  });
  return Promise.all(repositories.slice(0, 16).map(async repo => {
    const explicitMcp = (() => {
    const identity = [
      repo.name,
      repo.description,
      ...(Array.isArray(repo.topics) ? repo.topics : []),
    ].filter(Boolean).join(' ');
    return /(?:^|[^a-z0-9])mcp(?:[^a-z0-9]|$)|model\s+context\s+protocol/i.test(identity);
    })();
    const fullName = String(repo.full_name);
    const launch = explicitMcp ? await resolveGithubNpxLaunch(fullName, headers) : null;
    return {
      id: marketplaceId('github', fullName),
      name: fullName,
      description: String(repo.description || 'GitHub MCP repository'),
      command: launch?.command || 'npx',
      args: launch?.args || [],
      env: {},
      source: 'market' as const,
      risk: 'network' as const,
      origin: 'github' as const,
      iconKind: 'github' as const,
      iconUrl: String(repo.owner?.avatar_url || ''),
      url: String(repo.html_url || ''),
      stars: Number(repo.stargazers_count || 0),
      updatedAt: String(repo.updated_at || ''),
      installable: !!launch,
      projectType: explicitMcp ? 'mcp' as const : 'related-project' as const,
      aiAdaptable: !explicitMcp,
    };
  }));
}

function pickArray(payload: any): any[] {
  if (Array.isArray(payload)) return payload;
  for (const key of ['servers', 'items', 'data', 'results']) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.[key]?.servers)) return payload[key].servers;
  }
  return [];
}

async function searchSmitheryMcpPlugins(query: string, config: McpMarketplaceConfig): Promise<McpMarketplaceCandidate[]> {
  const token = String(process.env.SMITHERY_API_KEY || config.smitheryApiKey || '').trim();
  if (!token) throw new Error('需要配置 SMITHERY_API_KEY');
  const url = `https://api.smithery.ai/servers?q=${encodeURIComponent(query || 'academic research')}&pageSize=20`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Smithery 返回 HTTP ${response.status}`);
  const payload = await response.json();
  return pickArray(payload).map(server => {
    const qualifiedName = String(server.qualifiedName || `${server.namespace || ''}/${server.slug || ''}`).replace(/^\/|\/$/g, '');
    return {
      id: marketplaceId('smithery', qualifiedName || String(server.id || server.displayName)),
      name: String(server.displayName || qualifiedName || 'Smithery MCP'),
      description: String(server.description || ''),
      command: 'npx',
      args: ['-y', '@smithery/cli@latest', 'run', qualifiedName],
      env: {},
      source: 'market' as const,
      risk: 'network' as const,
      iconKind: 'custom' as const,
      iconUrl: String(server.iconUrl || ''),
      origin: 'smithery' as const,
      url: String(server.homepage || (qualifiedName ? `https://smithery.ai/server/${qualifiedName}` : 'https://smithery.ai/')),
      installable: !!qualifiedName,
    };
  });
}

async function searchGlamaMcpPlugins(query: string): Promise<McpMarketplaceCandidate[]> {
  const url = `https://glama.ai/api/mcp/v1/servers?query=${encodeURIComponent(query || 'academic research')}&first=20`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'Scholar-Harness/1.0.8' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Glama 返回 HTTP ${response.status}`);
  const payload = await response.json();
  const githubHeaders: Record<string, string> = {
    'user-agent': 'Scholar-Harness/1.0.8',
    'x-github-api-version': '2022-11-28',
  };
  const githubToken = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (githubToken) githubHeaders.authorization = `Bearer ${githubToken}`;
  const candidates = await Promise.all(pickArray(payload).slice(0, 20).map(async server => {
    const namespace = String(server.namespace || server.owner || '');
    const slug = String(server.slug || server.name || server.id || '');
    const repositoryUrl = String(server.repositoryUrl || server.repository_url || server.repository?.url || '');
    const githubMatch = /github\.com\/([^/\s]+\/[^/#\s]+)/i.exec(repositoryUrl);
    const githubRepo = githubMatch ? githubMatch[1].replace(/\.git$/i, '') : '';
    const launch = githubRepo ? await resolveGithubNpxLaunch(githubRepo, githubHeaders) : null;
    return {
      id: marketplaceId('glama', `${namespace}-${slug}`),
      name: String(server.displayName || server.title || slug || 'Glama MCP'),
      description: String(server.description || ''),
      command: launch?.command || 'npx',
      args: launch?.args || [],
      env: {},
      source: 'market' as const,
      risk: 'network' as const,
      iconKind: 'custom' as const,
      iconUrl: String(server.iconUrl || server.imageUrl || ''),
      origin: 'glama' as const,
      url: String(server.url || server.homepage || (namespace && slug ? `https://glama.ai/mcp/servers/${namespace}/${slug}` : 'https://glama.ai/mcp/servers')),
      installable: !!launch,
    };
  }));
  return candidates.filter(plugin => plugin.name);
}

async function searchPulseMcpPlugins(query: string, config: McpMarketplaceConfig): Promise<McpMarketplaceCandidate[]> {
  const apiKey = String(process.env.PULSEMCP_API_KEY || config.pulseApiKey || '').trim();
  const tenantId = String(process.env.PULSEMCP_TENANT_ID || config.pulseTenantId || '').trim();
  if (!apiKey || !tenantId) throw new Error('需要配置 PULSEMCP_API_KEY 和 PULSEMCP_TENANT_ID');
  const url = `https://api.pulsemcp.com/v0.1/servers?limit=20&version=latest&search=${encodeURIComponent(query || 'academic research')}`;
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'x-api-key': apiKey, 'x-tenant-id': tenantId },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`PulseMCP 返回 HTTP ${response.status}`);
  const payload = await response.json();
  return pickArray(payload).map(server => {
    const name = String(server.title || server.name || server.id || 'PulseMCP Server');
    const packages = Array.isArray(server.packages) ? server.packages : [];
    const npmPackage = packages.find((item: any) => String(item.registryType || item.registry || '').toLowerCase().includes('npm'));
    const packageName = String(npmPackage?.identifier || npmPackage?.name || '');
    return {
      id: marketplaceId('pulsemcp', String(server.name || server.id || name)),
      name,
      description: String(server.description || ''),
      command: 'npx',
      args: packageName ? ['-y', packageName] : [],
      env: {},
      source: 'market' as const,
      risk: 'network' as const,
      iconKind: 'custom' as const,
      iconUrl: String(server.iconUrl || ''),
      origin: 'pulsemcp' as const,
      url: String(server.websiteUrl || server.repository?.url || 'https://www.pulsemcp.com/servers'),
      installable: !!packageName,
    };
  });
}

async function searchMcpSoPlugins(query: string): Promise<McpMarketplaceCandidate[]> {
  const url = `https://mcp.so/servers?q=${encodeURIComponent(query || 'academic research')}`;
  const response = await fetch(url, {
    headers: { accept: 'text/html', 'user-agent': 'Scholar-Harness/1.0.8' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`MCP.so 返回 HTTP ${response.status}`);
  const html = await response.text();
  const results: McpMarketplaceCandidate[] = [];
  const seen = new Set<string>();
  const pattern = /<a[^>]+href=["'](\/server\/[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && results.length < 20) {
    const pathName = match[1];
    if (seen.has(pathName)) continue;
    seen.add(pathName);
    const text = match[2].replace(/<[^>]+>/g, ' ').replace(/&[^;]+;/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    results.push({
      id: marketplaceId('mcpso', pathName),
      name: text.slice(0, 100),
      description: '来自 MCP.so 公共目录；请查看来源页获取安装配置。',
      command: 'npx',
      args: [],
      env: {},
      source: 'market',
      risk: 'network',
      iconKind: 'custom',
      origin: 'mcpso',
      url: `https://mcp.so${pathName}`,
      installable: false,
    });
  }
  return results;
}

export async function searchMcpPluginMarketplace(query: string): Promise<{
  plugins: McpMarketplaceCandidate[];
  warnings: string[];
}> {
  const normalizedQuery = String(query || '').trim().slice(0, 120);
  const marketplaceConfig = await readMarketplaceConfig();
  const curated: McpMarketplaceCandidate[] = MCP_PLUGIN_MARKETPLACE
    .filter(plugin => !normalizedQuery || `${plugin.name} ${plugin.description}`.toLowerCase().includes(normalizedQuery.toLowerCase()))
    .map(plugin => ({ ...plugin, origin: 'curated' as const, url: '' }));
  const settled = await Promise.allSettled([
    searchNpmMcpPlugins(normalizedQuery),
    searchGithubMcpPlugins(normalizedQuery),
    searchSmitheryMcpPlugins(normalizedQuery, marketplaceConfig),
    searchGlamaMcpPlugins(normalizedQuery),
    searchPulseMcpPlugins(normalizedQuery, marketplaceConfig),
    searchMcpSoPlugins(normalizedQuery),
  ]);
  const warnings: string[] = [];
  const providerNames = ['npm', 'GitHub', 'Smithery', 'Glama', 'PulseMCP', 'MCP.so'];
  const online = settled.flatMap((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    warnings.push(`${providerNames[index]}：${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    return [];
  });
  const unique = new Map<string, McpMarketplaceCandidate>();
  [...curated, ...online].forEach(plugin => {
    if (!normalizedQuery) {
      const academicText = `${plugin.name} ${plugin.description} ${plugin.url || ''}`.toLowerCase();
      if (!/(academic|research|literature|paper|citation|reference|journal|scholar|arxiv|pubmed|crossref|zotero|doi|论文|文献|引用|期刊|科研|学术)/i.test(academicText)) {
        return;
      }
    }
    if (!unique.has(plugin.id)) unique.set(plugin.id, plugin);
  });
  return { plugins: Array.from(unique.values()), warnings };
}

function getStorePath(): string {
  return path.join(getDataDir(), 'mcp-plugins.json');
}

function getMarketplaceConfigPath(): string {
  return path.join(getDataDir(), 'mcp-marketplace-config.json');
}

function decryptConfigValue(value: unknown): string {
  const normalized = String(value || '');
  if (!normalized) return '';
  try {
    return isEncrypted(normalized) ? decrypt(normalized) : normalized;
  } catch (error) {
    logger.warn('[McpPlugins] Failed to decrypt marketplace credential:', error);
    return '';
  }
}

async function readMarketplaceConfig(): Promise<McpMarketplaceConfig> {
  try {
    const stored = JSON.parse(await fs.readFile(getMarketplaceConfigPath(), 'utf-8')) as Partial<StoredMcpMarketplaceConfig>;
    return marketplaceConfigSchema.parse({
      smitheryApiKey: decryptConfigValue(stored.smitheryApiKey),
      pulseApiKey: decryptConfigValue(stored.pulseApiKey),
      pulseTenantId: decryptConfigValue(stored.pulseTenantId),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[McpPlugins] Failed to read marketplace configuration:', error);
    }
    return marketplaceConfigSchema.parse({});
  }
}

export async function getMcpMarketplaceConfigStatus(): Promise<{
  smitheryConfigured: boolean;
  pulseConfigured: boolean;
}> {
  const config = await readMarketplaceConfig();
  return {
    smitheryConfigured: !!String(process.env.SMITHERY_API_KEY || config.smitheryApiKey).trim(),
    pulseConfigured: !!String(process.env.PULSEMCP_API_KEY || config.pulseApiKey).trim()
      && !!String(process.env.PULSEMCP_TENANT_ID || config.pulseTenantId).trim(),
  };
}

export async function saveMcpMarketplaceConfig(input: unknown): Promise<{
  smitheryConfigured: boolean;
  pulseConfigured: boolean;
}> {
  const previous = await readMarketplaceConfig();
  const parsed = marketplaceConfigSchema.partial().parse(input);
  const next = marketplaceConfigSchema.parse({
    smitheryApiKey: parsed.smitheryApiKey === undefined ? previous.smitheryApiKey : parsed.smitheryApiKey,
    pulseApiKey: parsed.pulseApiKey === undefined ? previous.pulseApiKey : parsed.pulseApiKey,
    pulseTenantId: parsed.pulseTenantId === undefined ? previous.pulseTenantId : parsed.pulseTenantId,
  });
  const stored: StoredMcpMarketplaceConfig = {
    version: 1,
    smitheryApiKey: next.smitheryApiKey ? encrypt(next.smitheryApiKey) : '',
    pulseApiKey: next.pulseApiKey ? encrypt(next.pulseApiKey) : '',
    pulseTenantId: next.pulseTenantId ? encrypt(next.pulseTenantId) : '',
  };
  await fs.mkdir(getDataDir(), { recursive: true });
  const tempPath = `${getMarketplaceConfigPath()}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(stored, null, 2), 'utf-8');
  await fs.rename(tempPath, getMarketplaceConfigPath());
  return getMcpMarketplaceConfigStatus();
}

async function readStore(): Promise<McpPluginStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(getStorePath(), 'utf-8')) as Partial<McpPluginStore>;
    return {
      version: 1,
      plugins: Array.isArray(parsed.plugins) ? parsed.plugins : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[McpPlugins] Failed to read plugin store:', error);
    }
    return { version: 1, plugins: [] };
  }
}

async function writeStore(store: McpPluginStore): Promise<void> {
  await fs.mkdir(getDataDir(), { recursive: true });
  const tempPath = `${getStorePath()}.${randomUUID()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), 'utf-8');
  await fs.rename(tempPath, getStorePath());
}

function publicPlugin(plugin: McpPluginRecord): McpPluginRecord {
  return {
    ...plugin,
    env: Object.fromEntries(
      Object.entries(plugin.env || {}).map(([key, value]) => [key, value ? '••••••••' : '']),
    ),
  };
}

function sanitizeToolName(value: string): string {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'tool';
}

function exposedToolName(pluginId: string, toolName: string): string {
  return `user_mcp__${sanitizeToolName(pluginId)}__${sanitizeToolName(toolName)}`.slice(0, 120);
}

function parseExposedToolName(name: string): { pluginId: string; toolName: string } | null {
  const match = /^user_mcp__([^_][a-zA-Z0-9_-]*)__([a-zA-Z0-9_-]+)$/.exec(name);
  return match ? { pluginId: match[1], toolName: match[2] } : null;
}

const BROWSER_ASSIST_ALLOWED_TOOLS = new Set([
  'browser_close',
  'browser_click',
  'browser_drag',
  'browser_fill_form',
  'browser_handle_dialog',
  'browser_hover',
  'browser_navigate',
  'browser_navigate_back',
  'browser_press_key',
  'browser_resize',
  'browser_select_option',
  'browser_snapshot',
  'browser_tabs',
  'browser_take_screenshot',
  'browser_type',
  'browser_wait_for',
]);

const BROWSER_ASSIST_VERIFICATION_PATTERN = new RegExp([
  'captcha',
  'recaptcha',
  'hcaptcha',
  'turnstile',
  'cloudflare.{0,20}challenge',
  'verify.{0,20}(?:human|person)',
  'human.{0,20}verification',
  '人机验证',
  '验证码',
  '滑块验证',
  'stealth',
  'webdriver',
  'fingerprint spoof',
  'proxy rotation',
  '绕过.{0,12}(?:验证|反爬|限制)',
  '破解.{0,12}(?:验证|验证码)',
].join('|'), 'i');

const browserAssistCallTimes: number[] = [];

export function filterMcpToolsForPlugin(
  plugin: Pick<McpPluginRecord, 'id'>,
  tools: McpDiscoveredTool[],
): McpDiscoveredTool[] {
  if (plugin.id !== BROWSER_ASSIST_PLUGIN_ID) return tools;
  return tools.filter(tool => BROWSER_ASSIST_ALLOWED_TOOLS.has(tool.name));
}

export function validateMcpPluginToolCallPolicy(
  plugin: Pick<McpPluginRecord, 'id'>,
  toolName: string,
  args: Record<string, unknown>,
): void {
  if (plugin.id !== BROWSER_ASSIST_PLUGIN_ID) return;
  if (!BROWSER_ASSIST_ALLOWED_TOOLS.has(toolName)) {
    throw new Error(`Browser Assist 不允许调用高风险浏览器工具：${toolName}`);
  }
  const serializedArgs = JSON.stringify(args);
  if (BROWSER_ASSIST_VERIFICATION_PATTERN.test(serializedArgs)) {
    throw new Error(
      'Browser Assist 已检测到登录、验证码、人机验证或规避检测相关操作。'
      + '请让用户在可见浏览器中亲自完成验证；用户确认完成后，AI 再通过页面快照继续。',
    );
  }
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (url && url !== 'about:blank' && !/^https?:\/\//i.test(url)) {
    throw new Error('Browser Assist 只允许打开 HTTP(S) 网页。');
  }
  const now = Date.now();
  while (browserAssistCallTimes.length && now - browserAssistCallTimes[0] > 60_000) {
    browserAssistCallTimes.shift();
  }
  if (browserAssistCallTimes.length >= 60) {
    throw new Error('Browser Assist 已达到安全访问频率上限，请稍后继续，避免对目标网站造成高频请求。');
  }
  browserAssistCallTimes.push(now);
}

async function resolveMcpRuntimeArgs(plugin: McpPluginRecord): Promise<string[]> {
  const requiresPluginDataDir = plugin.args.some(arg => arg.includes('${pluginDataDir}'));
  const pluginDataDir = path.join(getDataDir(), 'mcp-runtime', sanitizeToolName(plugin.id));
  if (requiresPluginDataDir) {
    await fs.mkdir(pluginDataDir, { recursive: true });
  }
  return plugin.args
    .filter(arg => arg !== '${workspace}')
    .map(arg => arg.replaceAll('${pluginDataDir}', pluginDataDir));
}

export class McpStdioSession {
  private child: ChildProcessWithoutNullStreams | null = null;
  private initialized = false;
  private startPromise: Promise<void> | null = null;
  private buffer = Buffer.alloc(0);
  private framing: 'jsonl' | 'content-length' = 'jsonl';
  private stderr = '';
  private sequence = 1;
  private pending = new Map<number, {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer?: NodeJS.Timeout;
  }>();

  constructor(
    private readonly plugin: McpPluginRecord,
    private readonly timeouts: { initializeMs?: number; listToolsMs?: number } = {},
  ) {}

  async start(): Promise<void> {
    if (
      this.child
      && this.initialized
      && this.child.exitCode === null
      && !this.child.killed
    ) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }
    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startProcess(): Promise<void> {
    if (this.child) this.close();
    this.buffer = Buffer.alloc(0);
    this.stderr = '';
    this.initialized = false;
    const command = this.plugin.command;
    const args = await resolveMcpRuntimeArgs(this.plugin);
    const adapterEntry = args.find(arg => /\.mjs$/i.test(arg));
    if (adapterEntry) {
      try {
        const source = await fs.readFile(adapterEntry, 'utf-8');
        if (/Content-Length\s*:/i.test(source) && /content-length/i.test(source)) {
          this.framing = 'content-length';
          logger.info(`[McpPlugins:${this.plugin.id}] Detected Content-Length stdio framing.`);
        }
      } catch {
        // Non-local or unreadable entries use the current MCP JSON-lines transport.
      }
    }
    const env = {
      ...buildToolRuntimeEnv(process.env),
      ...Object.fromEntries(
        Object.entries(this.plugin.env || {})
          .filter(([, value]) => value)
          .map(([key, value]) => [key, isEncrypted(value) ? decrypt(value) : value]),
      ),
    };
    const isWindowsScript = process.platform === 'win32' && /(?:^|[\\/])(?:npx|npm|pnpm|yarn)(?:\.cmd)?$/i.test(command);
    const child = isWindowsScript
      ? spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', 'call', command, ...args], {
          cwd: process.cwd(),
          env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : spawn(command, args, {
          cwd: process.cwd(),
          env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
    this.child = child;
    child.stdout.on('data', chunk => this.consume(Buffer.from(chunk)));
    child.stderr.on('data', chunk => {
      const text = String(chunk || '').trim();
      if (text) {
        this.stderr = `${this.stderr}\n${text}`.trim().slice(-4000);
        logger.debug(`[McpPlugins:${this.plugin.id}] ${text.slice(0, 1000)}`);
      }
    });
    child.on('error', error => this.failAll(error));
    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.child = null;
        this.initialized = false;
      }
      const signedCode = typeof code === 'number' && code > 0x7fffffff
        ? code - 0x100000000
        : code;
      const detail = this.stderr
        ? `：${this.stderr.replace(/\s+/g, ' ').slice(-1200)}`
        : '。该程序没有返回 MCP 初始化响应，请检查它是否为可执行的 stdio MCP Server，以及依赖和环境变量是否完整';
      this.failAll(new Error(
        `MCP 插件进程已退出（退出码=${signedCode ?? 'unknown'}${signal ? `，信号=${signal}` : ''}）${detail}`,
      ));
    });
    try {
      await this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'scholar-harness', version: '1.0.8' },
      }, this.timeouts.initializeMs === undefined ? 60_000 : this.timeouts.initializeMs);
      this.notify('notifications/initialized', {});
      this.initialized = true;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  async listTools(): Promise<McpDiscoveredTool[]> {
    const result = await this.request(
      'tools/list',
      {},
      this.timeouts.listToolsMs === undefined ? 20_000 : this.timeouts.listToolsMs,
    );
    return (Array.isArray(result?.tools) ? result.tools : []).map((tool: any) => ({
      name: String(tool.name || ''),
      description: String(tool.description || ''),
      inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object'
        ? tool.inputSchema as Record<string, unknown>
        : { type: 'object', properties: {} },
    })).filter((tool: McpDiscoveredTool) => tool.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args }, 120_000);
  }

  close(): void {
    const child = this.child;
    this.child = null;
    this.initialized = false;
    if (child) child.kill();
    this.failAll(new Error('MCP 会话已关闭'));
  }

  private request(method: string, params: unknown, timeoutMs: number): Promise<any> {
    if (!this.child) return Promise.reject(new Error('MCP 插件尚未启动'));
    const id = this.sequence++;
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`MCP 请求超时：${method}`));
          }, timeoutMs)
        : undefined;
      this.pending.set(id, { resolve, reject, timer });
      try {
        // Register the waiter before writing. A local stdio server can answer
        // synchronously; writing first would drop that response and later
        // surface a false initialize timeout.
        this.write(payload);
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private write(payload: unknown): void {
    const body = Buffer.from(JSON.stringify(payload), 'utf-8');
    if (this.framing === 'content-length') {
      this.child?.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
      this.child?.stdin.write(body);
      return;
    }
    this.child?.stdin.write(Buffer.concat([body, Buffer.from('\n')]));
  }

  private consume(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.framing === 'content-length') {
      this.consumeContentLengthMessages();
      return;
    }
    while (this.buffer.length) {
      const lineEnd = this.buffer.indexOf(0x0a);
      if (lineEnd < 0) return;
      const body = this.buffer.subarray(0, lineEnd).toString('utf-8').trim();
      this.buffer = this.buffer.subarray(lineEnd + 1);
      if (!body) continue;
      try {
        const message = JSON.parse(body);
        if (typeof message.id !== 'number') continue;
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        if (pending.timer) clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
        else pending.resolve(message.result);
      } catch (error) {
        if (/^(?:trace|debug|info|warn|error)\s*:/i.test(body)) {
          logger.debug(`[McpPlugins:${this.plugin.id}] Ignored non-protocol stdout: ${body.slice(0, 1000)}`);
          continue;
        }
        logger.warn(`[McpPlugins:${this.plugin.id}] Invalid MCP response:`, error);
      }
    }
  }

  private consumeContentLengthMessages(): void {
    while (this.buffer.length) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const headers = this.buffer.subarray(0, headerEnd).toString('ascii');
      const lengthMatch = /(?:^|\r\n)Content-Length:\s*(\d+)/i.exec(headers);
      if (!lengthMatch) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        logger.warn(`[McpPlugins:${this.plugin.id}] MCP response is missing Content-Length.`);
        continue;
      }
      const contentLength = Number(lengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + contentLength) return;
      const body = this.buffer.subarray(bodyStart, bodyStart + contentLength).toString('utf-8');
      this.buffer = this.buffer.subarray(bodyStart + contentLength);
      this.consumeMessageBody(body);
    }
  }

  private consumeMessageBody(body: string): void {
    try {
      const message = JSON.parse(body);
      if (typeof message.id !== 'number') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      if (pending.timer) clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error)));
      else pending.resolve(message.result);
    } catch (error) {
      logger.warn(`[McpPlugins:${this.plugin.id}] Invalid MCP response:`, error);
    }
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

interface PooledMcpSession {
  signature: string;
  session: McpStdioSession;
  idleTimer?: NodeJS.Timeout;
}

const MCP_SESSION_IDLE_MS = 10 * 60 * 1000;
const pooledMcpSessions = new Map<string, PooledMcpSession>();

function getMcpPluginRuntimeSignature(plugin: McpPluginRecord): string {
  return JSON.stringify({
    command: plugin.command,
    args: plugin.args,
    env: plugin.env,
    updatedAt: plugin.updatedAt,
  });
}

function disposePooledMcpSession(pluginId: string): void {
  const entry = pooledMcpSessions.get(pluginId);
  if (!entry) return;
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.session.close();
  pooledMcpSessions.delete(pluginId);
}

function schedulePooledMcpSessionCleanup(pluginId: string, entry: PooledMcpSession): void {
  if (entry.idleTimer) clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    if (pooledMcpSessions.get(pluginId) === entry) {
      disposePooledMcpSession(pluginId);
    }
  }, MCP_SESSION_IDLE_MS);
  entry.idleTimer.unref?.();
}

function getPooledMcpSession(plugin: McpPluginRecord): PooledMcpSession {
  const signature = getMcpPluginRuntimeSignature(plugin);
  const existing = pooledMcpSessions.get(plugin.id);
  if (existing && existing.signature === signature) {
    schedulePooledMcpSessionCleanup(plugin.id, existing);
    return existing;
  }
  if (existing) disposePooledMcpSession(plugin.id);
  const entry: PooledMcpSession = {
    signature,
    session: new McpStdioSession(plugin, { initializeMs: 60_000 }),
  };
  pooledMcpSessions.set(plugin.id, entry);
  schedulePooledMcpSessionCleanup(plugin.id, entry);
  return entry;
}

function mcpToolFailure(plugin: McpPluginRecord | undefined, error: unknown): Record<string, unknown> {
  const detail = error instanceof Error ? error.message : String(error || '未知错误');
  const pluginLabel = plugin?.name || plugin?.id || 'MCP 插件';
  const message = `${pluginLabel} 调用失败：${detail}`;
  return {
    isError: true,
    error: message,
    content: [{ type: 'text', text: message }],
  };
}

export async function listMcpPlugins(): Promise<McpPluginRecord[]> {
  return (await readStore()).plugins.map(publicPlugin);
}

export async function saveMcpPlugin(input: unknown): Promise<McpPluginRecord> {
  const parsed = pluginInputSchema.parse(input);
  disposePooledMcpSession(parsed.id);
  const store = await readStore();
  const existing = store.plugins.find(plugin => plugin.id === parsed.id);
  const now = new Date().toISOString();
  const env = Object.fromEntries(
    Object.entries(parsed.env).map(([key, value]) => [
      key,
      value === '••••••••'
        ? String(existing?.env?.[key] || '')
        : (value ? encrypt(value) : ''),
    ]),
  );
  const record: McpPluginRecord = {
    ...parsed,
    env,
    installedAt: existing?.installedAt || now,
    updatedAt: now,
    status: existing?.status || 'unchecked',
    tools: existing?.tools || [],
  };
  store.plugins = [...store.plugins.filter(plugin => plugin.id !== record.id), record];
  await writeStore(store);
  return publicPlugin(record);
}

export async function removeMcpPlugin(id: string): Promise<boolean> {
  disposePooledMcpSession(id);
  const store = await readStore();
  const next = store.plugins.filter(plugin => plugin.id !== id);
  if (next.length === store.plugins.length) return false;
  store.plugins = next;
  await writeStore(store);
  return true;
}

export async function setMcpPluginEnabled(id: string, enabled: boolean): Promise<McpPluginRecord> {
  disposePooledMcpSession(id);
  const store = await readStore();
  const plugin = store.plugins.find(item => item.id === id);
  if (!plugin) throw new Error('插件不存在');
  plugin.enabled = enabled;
  plugin.updatedAt = new Date().toISOString();
  await writeStore(store);
  return publicPlugin(plugin);
}

export async function discoverMcpPlugin(
  id: string,
  options: { initializeTimeoutMs?: number; listToolsTimeoutMs?: number } = {},
): Promise<McpPluginRecord> {
  disposePooledMcpSession(id);
  const store = await readStore();
  const plugin = store.plugins.find(item => item.id === id);
  if (!plugin) throw new Error('插件不存在');
  const session = new McpStdioSession(plugin, {
    initializeMs: options.initializeTimeoutMs,
    listToolsMs: options.listToolsTimeoutMs,
  });
  try {
    await session.start();
    plugin.tools = filterMcpToolsForPlugin(plugin, await session.listTools());
    plugin.status = 'ready';
    plugin.error = plugin.id === BROWSER_ASSIST_PLUGIN_ID && plugin.tools.length === 0
      ? 'Playwright MCP 未返回允许的浏览器工具，请检查安装版本。'
      : '';
    if (plugin.error) plugin.status = 'error';
  } catch (error) {
    plugin.status = 'error';
    plugin.error = (error as Error).message;
  } finally {
    session.close();
  }
  plugin.lastCheckedAt = new Date().toISOString();
  plugin.updatedAt = plugin.lastCheckedAt;
  await writeStore(store);
  return publicPlugin(plugin);
}

export async function installBrowserAssistMcpPlugin(): Promise<McpPluginRecord> {
  const existing = (await listMcpPlugins()).find(plugin => plugin.id === BROWSER_ASSIST_PLUGIN_ID);
  if (existing?.status === 'ready' && existing.tools.length > 0) {
    return existing.enabled
      ? existing
      : setMcpPluginEnabled(BROWSER_ASSIST_PLUGIN_ID, true);
  }

  const template = MCP_PLUGIN_MARKETPLACE.find(plugin => plugin.id === BROWSER_ASSIST_PLUGIN_ID);
  if (!template) {
    throw new Error('Browser Assist MCP 内置安装配置缺失');
  }

  await saveMcpPlugin({
    ...template,
    enabled: false,
  });
  const discovered = await discoverMcpPlugin(BROWSER_ASSIST_PLUGIN_ID, {
    initializeTimeoutMs: 180_000,
    listToolsTimeoutMs: 60_000,
  });
  if (discovered.status !== 'ready' || discovered.tools.length === 0) {
    return discovered;
  }
  return setMcpPluginEnabled(BROWSER_ASSIST_PLUGIN_ID, true);
}

export async function getEnabledMcpToolDefinitions(): Promise<LLMToolDefinition[]> {
  const plugins = (await readStore()).plugins.filter(plugin => (
    plugin.enabled && plugin.status === 'ready' && plugin.tools.length > 0
  ));
  return plugins.flatMap(plugin => plugin.tools.map(tool => ({
    type: 'function' as const,
    function: {
      name: exposedToolName(plugin.id, tool.name),
      description: [
        `[用户插件：${plugin.name}；权限等级：${plugin.risk}]`,
        tool.description || tool.name,
        plugin.id === BROWSER_ASSIST_PLUGIN_ID ? BROWSER_ASSIST_USAGE_POLICY : '',
        plugin.risk === 'write' || plugin.risk === 'command'
          ? '此工具可能修改文件或执行命令；用户本轮未明确要求执行时，必须先询问确认。'
          : '',
      ].filter(Boolean).join(' '),
      parameters: tool.inputSchema,
    },
  })));
}

export async function getEnabledMcpPluginCatalogPrompt(): Promise<string> {
  const plugins = (await readStore()).plugins.filter(plugin => (
    plugin.enabled && plugin.status === 'ready' && plugin.tools.length > 0
  ));
  if (!plugins.length) {
    return [
      '## 用户已安装 MCP 插件',
      '当前没有已启用且检测成功的用户 MCP 插件。',
      '不要把 Codex Apps、应用候选列表或插件市场候选误报为已安装插件。',
    ].join('\n');
  }
  return [
    '## 用户已安装 MCP 插件（当前真实清单）',
    '以下插件已经安装、启用并通过工具检测，可以由你根据用户任务自行选择调用。',
    '用户询问“已安装插件/可用插件”时必须以此清单回答；不要用 Codex Apps 候选列表替代。',
    ...plugins.map(plugin => [
      `- ${plugin.name}（ID: ${plugin.id}；权限: ${plugin.risk}）`,
      `  用途：${plugin.description || '未提供说明'}`,
      ...(plugin.id === BROWSER_ASSIST_PLUGIN_ID
        ? [`  强制规则：${BROWSER_ASSIST_USAGE_POLICY}`]
        : []),
      `  工具：${plugin.tools.map(tool => tool.name).join('、')}`,
    ].join('\n')),
  ].join('\n');
}

export async function executeMcpPluginToolCall(call: LLMToolCall): Promise<unknown> {
  const parsedName = parseExposedToolName(call.function.name);
  if (!parsedName) return mcpToolFailure(undefined, new Error('不是用户 MCP 插件工具'));
  const store = await readStore();
  const plugin = store.plugins.find(item => item.id === parsedName.pluginId && item.enabled);
  if (!plugin) return mcpToolFailure(undefined, new Error('插件未安装或未启用'));
  const tool = plugin.tools.find(item => sanitizeToolName(item.name) === parsedName.toolName);
  if (!tool) return mcpToolFailure(plugin, new Error('插件工具不存在，请重新检测插件'));
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(call.function.arguments || '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed;
  } catch {
    return mcpToolFailure(plugin, new Error('插件工具参数不是有效 JSON'));
  }
  try {
    validateMcpPluginToolCallPolicy(plugin, tool.name, args);
  } catch (error) {
    return mcpToolFailure(plugin, error);
  }
  if (plugin.id === BROWSER_ASSIST_PLUGIN_ID) {
    const url = typeof args.url === 'string' ? args.url : '';
    let host = '';
    try {
      host = url ? new URL(url).host : '';
    } catch {
      host = '';
    }
    logger.info(`[BrowserAssist] ${tool.name}${host ? ` | host=${host}` : ''}`);
  }

  let entry = getPooledMcpSession(plugin);
  try {
    await entry.session.start();
  } catch (firstError) {
    logger.warn(`[McpPlugins:${plugin.id}] Initialize failed; recreating the session once.`, firstError);
    disposePooledMcpSession(plugin.id);
    entry = getPooledMcpSession(plugin);
    try {
      await entry.session.start();
    } catch (retryError) {
      disposePooledMcpSession(plugin.id);
      return mcpToolFailure(plugin, retryError);
    }
  }

  try {
    const result = await entry.session.callTool(tool.name, args);
    schedulePooledMcpSessionCleanup(plugin.id, entry);
    return result;
  } catch (error) {
    disposePooledMcpSession(plugin.id);
    return mcpToolFailure(plugin, error);
  }
}

export function isMcpPluginToolName(name: string): boolean {
  return !!parseExposedToolName(name);
}
