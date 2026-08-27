import { spawn } from 'child_process';
import * as crypto from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import { Socket } from 'net';
import * as os from 'os';
import * as path from 'path';

import { z } from 'zod';

import { decrypt, isEncrypted } from '../../utils/encryption';
import { logger } from '../../utils/logger';
import { getDataDir, sanitizeUserId } from '../../utils/paths';

const FEATURE_API_VERSION = 1;
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i;
const MAX_FEATURE_FILES = 500;
const MAX_FEATURE_BYTES = 25 * 1024 * 1024;

type CommandInvocation = { command: string; args: string[] };

type ReasonixProviderConfig = {
  apiUrl: string;
  apiKey: string;
  model: string;
};

type RunCommandJobOptions = {
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onClose?: (code: number | null) => Promise<void>;
};

type PreparedReasonixWorkspace = {
  configPath: string;
  env: NodeJS.ProcessEnv;
  bypassedProxies: string[];
  executionDir: string;
  reasonixHome: string;
  sourceDir: string;
  temporary: boolean;
};

const PROXY_ENV_NAMES = new Set([
  'http_proxy',
  'https_proxy',
  'all_proxy',
]);

type ProxyEndpoint = { host: string; port: number };

function parseLoopbackProxyEndpoint(value: string): ProxyEndpoint | null {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['127.0.0.1', 'localhost', '::1'].includes(host)) return null;
    const fallbackPort = parsed.protocol.startsWith('socks') ? 1080 : parsed.protocol === 'https:' ? 443 : 80;
    const port = Number(parsed.port || fallbackPort);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? { host, port } : null;
  } catch {
    return null;
  }
}

async function canConnectToProxy(endpoint: ProxyEndpoint, timeoutMs = 450): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new Socket();
    let settled = false;
    const finish = (available: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(available);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(endpoint.port, endpoint.host);
  });
}

export async function buildReasonixProcessEnvironment(
  reasonixHome: string,
  inheritedEnvironment: NodeJS.ProcessEnv = process.env,
  probe: (endpoint: ProxyEndpoint) => Promise<boolean> = canConnectToProxy,
): Promise<{ env: NodeJS.ProcessEnv; bypassedProxies: string[] }> {
  const env: NodeJS.ProcessEnv = { REASONIX_HOME: reasonixHome };
  const bypassedProxies = new Set<string>();
  const probeResults = new Map<string, boolean>();

  for (const [key, rawValue] of Object.entries(inheritedEnvironment)) {
    if (!PROXY_ENV_NAMES.has(key.toLowerCase()) || !rawValue) continue;
    const endpoint = parseLoopbackProxyEndpoint(rawValue.trim());
    if (!endpoint) continue;
    const endpointKey = `${endpoint.host}:${endpoint.port}`;
    let available = probeResults.get(endpointKey);
    if (available === undefined) {
      available = await probe(endpoint);
      probeResults.set(endpointKey, available);
    }
    if (available) continue;
    env[key] = undefined;
    bypassedProxies.add(endpointKey);
  }

  // Windows environment keys are case-insensitive, while a JavaScript object
  // can contain multiple casings. Delete every conventional spelling so a
  // stale proxy cannot leak into the Reasonix child process.
  if (bypassedProxies.size) {
    for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
      env[key] = undefined;
    }
  }

  return { env, bypassedProxies: Array.from(bypassedProxies) };
}

function mergeChildProcessEnvironment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const merged: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return merged;
}

function findCommandOnPath(names: string[]): string | null {
  const entries = String(process.env.PATH || '')
    .split(path.delimiter)
    .map(entry => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  for (const entry of entries) {
    for (const name of names) {
      const candidate = path.resolve(entry, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

async function resolveReasonixInvocation(args: string[]): Promise<CommandInvocation | null> {
  if (process.platform !== 'win32') return { command: 'reasonix', args };
  const executable = findCommandOnPath(['reasonix.exe']);
  if (executable) return { command: executable, args };
  const shim = findCommandOnPath(['reasonix.cmd', 'reasonix.bat']);
  if (!shim) return null;
  const packageRoot = path.join(path.dirname(shim), 'node_modules', 'reasonix');
  try {
    const packageJson = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8')) as {
      bin?: string | Record<string, string>;
    };
    const relativeBin = typeof packageJson.bin === 'string'
      ? packageJson.bin
      : packageJson.bin?.reasonix || Object.values(packageJson.bin || {})[0];
    const nodeExecutable = findCommandOnPath(['node.exe', 'node']);
    if (!relativeBin || !nodeExecutable) return null;
    const cliEntry = path.resolve(packageRoot, relativeBin);
    if (!existsSync(cliEntry)) return null;
    return { command: nodeExecutable, args: [cliEntry, ...args] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[ConstructorAgent] Failed to resolve Reasonix npm entry:', error);
    }
    return null;
  }
}

async function resolveNpmInvocation(args: string[]): Promise<CommandInvocation> {
  if (process.platform !== 'win32') return { command: 'npm', args };
  const nodeExecutable = findCommandOnPath(['node.exe', 'node']);
  const npmShim = findCommandOnPath(['npm.cmd', 'npm.bat']);
  const candidates = [
    process.env.npm_execpath || '',
    nodeExecutable ? path.join(path.dirname(nodeExecutable), 'node_modules', 'npm', 'bin', 'npm-cli.js') : '',
    npmShim ? path.join(path.dirname(npmShim), 'node_modules', 'npm', 'bin', 'npm-cli.js') : '',
  ].filter(Boolean);
  const npmCli = candidates.find(candidate => existsSync(candidate));
  if (!nodeExecutable || !npmCli) throw new Error('未检测到可安全调用的 Node.js/npm，请先安装 Node.js 22+');
  return { command: nodeExecutable, args: [npmCli, ...args] };
}

export const constructorPermissionSchema = z.enum([
  'ui:page',
  'ui:navigation',
  'chat:command',
  'feature:storage',
  'network:https',
]);

const relativeAssetPathSchema = z.string().trim().min(1).max(240).refine(value => {
  if (path.isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  return !normalized.startsWith('/') && !normalized.split('/').includes('..');
}, '资源路径必须位于功能包目录内');

const pageContributionSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(240).default(''),
  entry: relativeAssetPathSchema,
});

const navigationContributionSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(40),
  pageId: z.string().trim().min(1).max(64),
  section: z.enum(['tools', 'view']).default('tools'),
});

const commandContributionSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9-]*$/),
  label: z.string().trim().min(1).max(60),
  promptTemplate: z.string().trim().min(1).max(4000),
});

export const constructorFeatureManifestSchema = z.object({
  schemaVersion: z.literal(1),
  apiVersion: z.literal(FEATURE_API_VERSION),
  id: z.string().trim().regex(FEATURE_ID_PATTERN),
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().regex(VERSION_PATTERN),
  description: z.string().trim().max(600).default(''),
  author: z.string().trim().max(100).default('Scholar Harness Constructor Agent'),
  permissions: z.array(constructorPermissionSchema).max(8).default([]),
  contributions: z.object({
    pages: z.array(pageContributionSchema).max(12).default([]),
    navigation: z.array(navigationContributionSchema).max(12).default([]),
    commands: z.array(commandContributionSchema).max(20).default([]),
  }).default({ pages: [], navigation: [], commands: [] }),
  compatibility: z.object({
    minAppVersion: z.string().trim().max(30).default('1.0.10'),
  }).default({ minAppVersion: '1.0.10' }),
});

export type ConstructorFeatureManifest = z.infer<typeof constructorFeatureManifestSchema>;

type ConstructorFeatureRecord = {
  id: string;
  enabled: boolean;
  activeVersion: string;
  versions: string[];
  installedAt: string;
  updatedAt: string;
};

type ConstructorRegistry = {
  schemaVersion: 1;
  features: Record<string, ConstructorFeatureRecord>;
};

export type ConstructorJob = {
  id: string;
  kind: 'reasonix-build' | 'reasonix-install' | 'reasonix-core-proposal' | 'core-apply';
  status: 'queued' | 'running' | 'success' | 'error' | 'cancelled';
  message: string;
  userId: string;
  featureId?: string;
  changeId?: string;
  stagingDir?: string;
  createdAt: string;
  updatedAt: string;
  exitCode?: number | null;
  logPath: string;
};

type ConstructorCapabilityDomain = {
  id: string;
  name: string;
  aliases: string[];
  paths: string[];
};

type ConstructorCapabilityMap = {
  schemaVersion: number;
  appVersion: string;
  domains: ConstructorCapabilityDomain[];
  inventory: {
    frontendModules: Array<{ file: string; globals: string[]; endpoints: string[] }>;
    frontendStyles: string[];
    localRoutes: Array<{ file: string; endpoints: string[] }>;
    cloudRoutes: Array<{ file: string; endpoints: string[] }>;
    services: string[];
  };
  protectedZones: Array<{ id: string; paths: string[]; approval: 'high' | 'critical' }>;
  governance: Record<string, string>;
};

export type ConstructorRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ConstructorChangeMode = 'runtime-feature' | 'core-change';
export type ConstructorIntentOperation = 'create-runtime' | 'modify-runtime' | 'modify-core';
export type ConstructorChangeStatus =
  | 'planned'
  | 'awaiting-plan-approval'
  | 'approved-for-generation'
  | 'generating'
  | 'awaiting-apply-approval'
  | 'approved-for-apply'
  | 'applying'
  | 'applied'
  | 'rolled-back'
  | 'failed';

export type ConstructorChangePlan = {
  id: string;
  userId: string;
  objective: string;
  mode: ConstructorChangeMode;
  risk: ConstructorRiskLevel;
  operation?: ConstructorIntentOperation;
  targetFeature?: {
    id: string;
    name: string;
    version: string;
    confidence: number;
  };
  intentSummary?: string[];
  status: ConstructorChangeStatus;
  requiresApproval: boolean;
  affectedDomains: ConstructorCapabilityDomain[];
  affectedFiles: string[];
  impactSummary: string[];
  validationCommands: string[];
  rollbackStrategy: string[];
  approval?: { planApprovedAt?: string; applyApprovedAt?: string };
  workspaceDir?: string;
  backupDir?: string;
  proposalJobId?: string;
  applyJobId?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConstructorPipelineResult = {
  state: 'started' | 'approval-required';
  plan: ConstructorChangePlan;
  featureId?: string;
  stagingDir?: string;
  job?: ConstructorJob;
};

const runningJobs = new Map<string, ReturnType<typeof spawn>>();

function nowIso(): string {
  return new Date().toISOString();
}

function getConstructorRoot(userId: string): string {
  return path.join(getDataDir(), 'constructor-agent', sanitizeUserId(userId));
}

function getFeaturesRoot(userId: string): string {
  return path.join(getConstructorRoot(userId), 'features');
}

function getRegistryPath(userId: string): string {
  return path.join(getConstructorRoot(userId), 'registry.json');
}

function getJobsRoot(userId: string): string {
  return path.join(getConstructorRoot(userId), 'jobs');
}

function getChangesRoot(userId: string): string {
  return path.join(getConstructorRoot(userId), 'changes');
}

function getChangePath(userId: string, changeId: string): string {
  return path.join(getChangesRoot(userId), `${changeId}.json`);
}

function getFeatureVersionDir(userId: string, featureId: string, version: string): string {
  return path.join(getFeaturesRoot(userId), featureId, version);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM') throw error;
    await fs.rm(filePath, { force: true });
    await fs.rename(temporaryPath, filePath);
  }
}

function capabilityMapCandidates(): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '';
  return [
    path.resolve(process.cwd(), 'configs', 'constructor-agent', 'software-capability-map.json'),
    path.resolve(__dirname, '../../../configs/constructor-agent/software-capability-map.json'),
    path.resolve(__dirname, '../../../../configs/constructor-agent/software-capability-map.json'),
    path.resolve(resourcesPath, 'configs', 'constructor-agent', 'software-capability-map.json'),
  ];
}

function constructorSkillPackCandidates(): string[] {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || '';
  return [
    path.resolve(process.cwd(), 'skill-packs', 'constructor-engineering'),
    path.resolve(__dirname, '../../../skill-packs/constructor-engineering'),
    path.resolve(__dirname, '../../../../skill-packs/constructor-engineering'),
    path.resolve(resourcesPath, 'skill-packs', 'constructor-engineering'),
  ];
}

async function loadConstructorEngineeringSkills(skillIds: string[]): Promise<string> {
  for (const root of constructorSkillPackCandidates()) {
    try {
      const pack = JSON.parse(await fs.readFile(path.join(root, 'pack.json'), 'utf8')) as {
        skills?: Array<{ id: string; entry: string; policyOverlay?: string }>;
      };
      const sections: string[] = [];
      for (const skill of pack.skills || []) {
        if (!skillIds.includes(skill.id)) continue;
        const entryPath = resolveInside(root, skill.entry);
        const body = (await fs.readFile(entryPath, 'utf8')).slice(0, 18_000);
        sections.push(`## ${skill.id}\nPolicy overlay: ${skill.policyOverlay || 'none'}\n${body}`);
      }
      if (sections.length) return sections.join('\n\n');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn(`[ConstructorAgent] Failed to load engineering skills from ${root}:`, error);
    }
  }
  throw new Error('构造 Agent 工程 Skill 包不存在');
}

export async function getConstructorCapabilityMap(): Promise<ConstructorCapabilityMap> {
  for (const candidate of capabilityMapCandidates()) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      const value = JSON.parse(raw) as ConstructorCapabilityMap;
      if (value?.schemaVersion === 1 && Array.isArray(value.domains) && value.inventory) return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(`[ConstructorAgent] Invalid capability map at ${candidate}:`, error);
      }
    }
  }
  throw new Error('软件能力地图不存在，请先执行 npm run build 生成');
}

function normalizeForMatch(value: string): string {
  return value.toLocaleLowerCase().replace(/\s+/g, ' ');
}

function normalizeIntentPhrase(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

type InstalledConstructorFeature = {
  id: string;
  name: string;
  description: string;
  version: string;
  aliases: string[];
};

function buildRuntimeFeatureCapabilityDomain(feature: {
  id: string;
  name: string;
  aliases?: string[];
}): ConstructorCapabilityDomain {
  return {
    id: `runtime-feature:${feature.id}`,
    name: `运行时功能包：${feature.name}`,
    aliases: feature.aliases?.length ? feature.aliases : [feature.id, feature.name],
    paths: [`constructor-agent/features/${feature.id}`],
  };
}

function normalizeRuntimeFeaturePlanScope(plan: ConstructorChangePlan): void {
  if (plan.operation !== 'modify-runtime' || !plan.targetFeature) return;
  const domain = buildRuntimeFeatureCapabilityDomain(plan.targetFeature);
  plan.affectedDomains = [domain];
  plan.affectedFiles = [...domain.paths];
  plan.impactSummary = [
    `改造方式：修改已有运行时功能“${plan.targetFeature.name}”`,
    `风险等级：${plan.risk}`,
    `涉及范围：仅运行时功能包“${plan.targetFeature.name}”`,
    '从当前已安装版本建立隔离副本；构建成功后替换该功能包，并保留原启用状态。',
  ];
}

async function listInstalledConstructorFeatureCandidates(userId: string): Promise<InstalledConstructorFeature[]> {
  const registry = await readRegistry(userId);
  const candidates: InstalledConstructorFeature[] = [];
  for (const record of Object.values(registry.features)) {
    try {
      const manifest = await readManifest(getFeatureVersionDir(userId, record.id, record.activeVersion));
      candidates.push({
        id: record.id,
        name: manifest.name,
        description: manifest.description,
        version: record.activeVersion,
        aliases: [
          manifest.name,
          ...manifest.contributions.pages.flatMap(page => [page.title, page.subtitle]),
          ...manifest.contributions.navigation.map(item => item.label),
        ].filter(Boolean),
      });
    } catch (error) {
      logger.warn(`[ConstructorAgent] Failed to inspect installed feature ${record.id} during intent analysis:`, error);
    }
  }
  return candidates;
}

function isExplicitNewFeatureRequest(request: string): boolean {
  const normalized = normalizeForMatch(request);
  return [
    '新增一个', '新建一个', '创建一个', '另做一个', '再做一个', '额外增加',
    '新增独立', '新建独立', '独立页面', '独立功能', '独立插件', '独立扩展',
    'create a new', 'add a new', 'another feature',
  ].some(keyword => normalized.includes(keyword));
}

function isExistingFunctionMutationRequest(request: string): boolean {
  const normalized = normalizeForMatch(request);
  return [
    '修改', '调整', '改成', '替换', '删除', '去掉', '移动', '重构', '修复', '隐藏', '移除',
    '合并', '拆分', '缩窄', '加宽', '上移', '下移', '覆盖', '优化', '美化', '跟随', '同步',
    '适配', '联动', '继承', '保持', '响应', '变成', '变为', '换成', '使用主题', '提速', '加速',
  ].some(keyword => normalized.includes(keyword));
}

function requestTargetsMappedCapability(request: string, map: ConstructorCapabilityMap): boolean {
  const normalized = normalizeIntentPhrase(request);
  return map.domains.some(domain => [domain.id, domain.name, ...domain.aliases].some(term => {
    const candidate = normalizeIntentPhrase(term);
    return candidate.length >= 2 && normalized.includes(candidate);
  }));
}

function matchInstalledConstructorFeature(
  request: string,
  candidates: InstalledConstructorFeature[],
): (InstalledConstructorFeature & { confidence: number }) | null {
  if (isExplicitNewFeatureRequest(request)) return null;
  const normalizedRequest = normalizeIntentPhrase(request);
  if (!normalizedRequest) return null;
  let best: (InstalledConstructorFeature & { confidence: number }) | null = null;
  for (const candidate of candidates) {
    let score = 0;
    for (const alias of candidate.aliases) {
      const normalizedAlias = normalizeIntentPhrase(alias);
      if (normalizedAlias.length < 2) continue;
      if (normalizedRequest.includes(normalizedAlias)) {
        score = Math.max(score, Math.min(100, 72 + normalizedAlias.length * 2));
        continue;
      }
      if (normalizedAlias.includes(normalizedRequest) && normalizedRequest.length >= 4) {
        score = Math.max(score, 70);
        continue;
      }
      const bigrams = new Set<string>();
      for (let index = 0; index < normalizedAlias.length - 1; index += 1) {
        bigrams.add(normalizedAlias.slice(index, index + 2));
      }
      if (!bigrams.size) continue;
      let overlap = 0;
      for (const token of bigrams) if (normalizedRequest.includes(token)) overlap += 1;
      score = Math.max(score, Math.round((overlap / bigrams.size) * 65));
    }
    if (score >= 55 && (!best || score > best.confidence)) best = { ...candidate, confidence: score };
  }
  return best;
}

function rankCapabilityDomains(request: string, map: ConstructorCapabilityMap): ConstructorCapabilityDomain[] {
  const normalized = normalizeForMatch(request);
  const ranked = map.domains.map(domain => {
    const terms = [domain.id, domain.name, ...domain.aliases].map(normalizeForMatch);
    const score = terms.reduce((sum, term) => sum + (normalized.includes(term) ? Math.max(2, term.length) : 0), 0);
    return { domain, score };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score);
  if (ranked.length) return ranked.slice(0, 5).map(item => item.domain);
  return map.domains.filter(domain => ['chat-agent', 'desktop-shell'].includes(domain.id));
}

export async function getConstructorCapabilitySummary(request = ''): Promise<{
  appVersion: string;
  domainCount: number;
  frontendModuleCount: number;
  routeFileCount: number;
  endpointCount: number;
  serviceCount: number;
  relevantDomains: ConstructorCapabilityDomain[];
}> {
  const map = await getConstructorCapabilityMap();
  const routes = [...map.inventory.localRoutes, ...map.inventory.cloudRoutes];
  return {
    appVersion: map.appVersion,
    domainCount: map.domains.length,
    frontendModuleCount: map.inventory.frontendModules.length,
    routeFileCount: routes.length,
    endpointCount: routes.reduce((sum, item) => sum + item.endpoints.length, 0),
    serviceCount: map.inventory.services.length,
    relevantDomains: request ? rankCapabilityDomains(request, map) : map.domains,
  };
}

function sourceWorkspaceRoot(): string | null {
  const candidates = [process.cwd(), path.resolve(__dirname, '../../..')];
  for (const candidate of candidates) {
    try {
      if (existsSync(path.join(candidate, 'package.json')) && existsSync(path.join(candidate, 'src', 'server', 'local-server.ts'))) return candidate;
    } catch {
      // Continue to the next candidate.
    }
  }
  return null;
}

export function getConstructorSourceStatus(): { available: boolean; mode: 'source' | 'packaged'; root?: string } {
  const root = sourceWorkspaceRoot();
  return root ? { available: true, mode: 'source', root } : { available: false, mode: 'packaged' };
}

function assertChangeId(changeId: string): string {
  return z.string().regex(/^change-\d{10,}-[a-f0-9]{8}$/).parse(changeId);
}

async function saveChange(plan: ConstructorChangePlan): Promise<void> {
  plan.updatedAt = nowIso();
  await writeJsonAtomic(getChangePath(plan.userId, plan.id), plan);
}

export async function getConstructorChange(userId: string, changeId: string): Promise<ConstructorChangePlan> {
  const safeId = assertChangeId(changeId);
  const raw = await fs.readFile(getChangePath(userId, safeId), 'utf8');
  return JSON.parse(raw) as ConstructorChangePlan;
}

export async function listConstructorChanges(userId: string): Promise<ConstructorChangePlan[]> {
  try {
    const root = getChangesRoot(userId);
    const names = (await fs.readdir(root)).filter(name => /^change-\d{10,}-[a-f0-9]{8}\.json$/.test(name));
    const changes = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8')) as ConstructorChangePlan));
    return changes.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function classifyConstructorRisk(request: string): { mode: ConstructorChangeMode; risk: ConstructorRiskLevel } {
  const normalized = normalizeForMatch(request);
  const critical = ['认证', '登录', '支付', '订阅', '授权', '激活码', '分销', '数据库迁移', '用户数据', '删除数据', 'auth', 'payment', 'license', 'migration'];
  const high = ['electron', '主进程', '安装包', '更新器', '后端', '路由', 'api', '核心', '删除功能', '修改现有', '替换', '云端', '官网'];
  const medium = ['隐藏', '停用', '导航', '侧边栏', '共享数据', '导入', '导出'];
  const existingUiTargets = ['现有', '已有', '当前', '原来', '主页', '聊天界面', '前端', '按钮', '气泡', '导航', '侧边栏', '输入框', '样式', '布局', '图标', '头像', '主题', 'hover', 'css', 'dom'];
  const isolatedAddition = ['新增独立页面', '新建独立页面', '新增功能页', '新建功能页', '运行时功能包', '独立插件', '独立扩展'];
  if (critical.some(keyword => normalized.includes(keyword))) return { mode: 'core-change', risk: 'critical' };
  if (high.some(keyword => normalized.includes(keyword))) return { mode: 'core-change', risk: 'high' };
  if (
    !isolatedAddition.some(keyword => normalized.includes(keyword))
    && existingUiTargets.some(keyword => normalized.includes(keyword))
    && isExistingFunctionMutationRequest(request)
  ) return { mode: 'core-change', risk: 'high' };
  if (medium.some(keyword => normalized.includes(keyword))) return { mode: 'runtime-feature', risk: 'medium' };
  return { mode: 'runtime-feature', risk: 'low' };
}

export async function createConstructorChangePlan(
  userId: string,
  request: string,
  requestedMode: 'auto' | ConstructorChangeMode = 'auto',
): Promise<ConstructorChangePlan> {
  const map = await getConstructorCapabilityMap();
  const installedFeatures = await listInstalledConstructorFeatureCandidates(userId);
  const matchedFeature = matchInstalledConstructorFeature(request, installedFeatures);
  const keywordClassification = classifyConstructorRisk(request);
  const modifiesMappedCapability = !matchedFeature
    && !isExplicitNewFeatureRequest(request)
    && isExistingFunctionMutationRequest(request)
    && requestTargetsMappedCapability(request, map);
  const classification = matchedFeature
    ? { mode: 'runtime-feature' as const, risk: 'low' as const }
    : keywordClassification.mode === 'core-change'
      ? keywordClassification
      : modifiesMappedCapability
      ? { mode: 'core-change' as const, risk: 'high' as const }
      : keywordClassification;
  const mode = classification.mode === 'core-change'
    ? 'core-change'
    : requestedMode === 'auto' ? classification.mode : requestedMode;
  const risk: ConstructorRiskLevel = mode === 'core-change' && classification.risk === 'low' ? 'high' : classification.risk;
  const affectedDomains: ConstructorCapabilityDomain[] = matchedFeature
    ? [buildRuntimeFeatureCapabilityDomain(matchedFeature)]
    : rankCapabilityDomains(request, map);
  const affectedFiles = Array.from(new Set(affectedDomains.flatMap(domain => domain.paths))).slice(0, 40);
  const requiresApproval = risk !== 'low';
  const id = `change-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const operation: ConstructorIntentOperation = matchedFeature
    ? 'modify-runtime'
    : mode === 'core-change' ? 'modify-core' : 'create-runtime';
  const plan: ConstructorChangePlan = {
    id,
    userId: sanitizeUserId(userId),
    objective: request.trim(),
    mode,
    risk,
    operation,
    targetFeature: matchedFeature ? {
      id: matchedFeature.id,
      name: matchedFeature.name,
      version: matchedFeature.version,
      confidence: matchedFeature.confidence,
    } : undefined,
    intentSummary: matchedFeature ? [
      `识别为修改已有功能：${matchedFeature.name}`,
      `复用原功能包 ${matchedFeature.id}@${matchedFeature.version}，不创建重复入口`,
      `匹配置信度：${matchedFeature.confidence}%`,
    ] : [
      mode === 'core-change' ? '识别为修改 Scholar Harness 现有核心功能' : '未匹配到已有功能，识别为新增独立运行时功能',
      `已结合 ${affectedDomains.length} 个相关产品域进行影响定位`,
    ],
    status: requiresApproval ? 'awaiting-plan-approval' : 'planned',
    requiresApproval,
    affectedDomains,
    affectedFiles,
    impactSummary: [
      `改造方式：${matchedFeature ? `修改已有运行时功能“${matchedFeature.name}”` : mode === 'core-change' ? '核心源码候选变更' : '新增可热插拔运行时功能包'}`,
      `风险等级：${risk}`,
      `涉及产品域：${affectedDomains.map(domain => domain.name).join('、')}`,
      mode === 'core-change' ? '先在隔离副本中生成并验证，不直接写入正在运行的软件。' : '安装后默认停用，用户确认后才启用。',
    ],
    validationCommands: mode === 'core-change'
      ? ['node scripts/check-public-js.js', 'npm run build', '按受影响产品域运行 Vitest']
      : ['校验 feature.json', '检查资源路径与权限', '在沙箱 iframe 中预览'],
    rollbackStrategy: mode === 'core-change'
      ? ['生成前保留隔离基线', '应用前逐文件备份', '构建或测试失败时自动恢复备份', '保留人工一键回滚入口']
      : ['新版本默认停用', '可回滚到上一功能包版本', '可完整卸载并删除私有存储'],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await saveChange(plan);
  return plan;
}

export async function approveConstructorChange(
  userId: string,
  changeId: string,
  stage: 'plan' | 'apply',
): Promise<ConstructorChangePlan> {
  const plan = await getConstructorChange(userId, changeId);
  plan.approval = plan.approval || {};
  if (stage === 'plan') {
    if (plan.status !== 'awaiting-plan-approval' && plan.status !== 'planned') throw new Error('当前变更不处于方案批准阶段');
    plan.status = 'approved-for-generation';
    plan.approval.planApprovedAt = nowIso();
  } else {
    if (plan.status !== 'awaiting-apply-approval') throw new Error('当前变更还没有可应用的核心修改候选');
    plan.status = 'approved-for-apply';
    plan.approval.applyApprovedAt = nowIso();
  }
  await saveChange(plan);
  return plan;
}

async function readRegistry(userId: string): Promise<ConstructorRegistry> {
  try {
    const raw = await fs.readFile(getRegistryPath(userId), 'utf8');
    const value = JSON.parse(raw) as ConstructorRegistry;
    if (value?.schemaVersion === 1 && value.features && typeof value.features === 'object') return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[ConstructorAgent] Failed to read registry, rebuilding an empty registry:', error);
    }
  }
  return { schemaVersion: 1, features: {} };
}

async function saveRegistry(userId: string, registry: ConstructorRegistry): Promise<void> {
  await writeJsonAtomic(getRegistryPath(userId), registry);
}

function resolveInside(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  const relative = path.relative(resolvedRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('功能包资源路径越过了允许目录');
  }
  return candidate;
}

async function readManifest(packageDir: string): Promise<ConstructorFeatureManifest> {
  const manifestPath = resolveInside(packageDir, 'feature.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const manifest = constructorFeatureManifestSchema.parse(JSON.parse(raw));
  const pageIds = new Set(manifest.contributions.pages.map(page => page.id));
  for (const page of manifest.contributions.pages) {
    const entryPath = resolveInside(packageDir, page.entry);
    const stat = await fs.lstat(entryPath);
    if (stat.isSymbolicLink()) throw new Error(`页面入口不允许使用符号链接：${page.entry}`);
    if (!stat.isFile()) throw new Error(`页面入口不是文件：${page.entry}`);
  }
  for (const item of manifest.contributions.navigation) {
    if (!pageIds.has(item.pageId)) throw new Error(`导航 ${item.id} 指向了不存在的页面 ${item.pageId}`);
  }
  return manifest;
}

async function validateFeaturePackageTree(packageDir: string): Promise<void> {
  let fileCount = 0;
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`功能包不允许包含符号链接：${entry.name}`);
      if (entry.isDirectory()) {
        await visit(entryPath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`功能包包含不受支持的文件类型：${entry.name}`);
      const stat = await fs.stat(entryPath);
      fileCount += 1;
      totalBytes += stat.size;
      if (fileCount > MAX_FEATURE_FILES) throw new Error(`功能包文件不能超过 ${MAX_FEATURE_FILES} 个`);
      if (totalBytes > MAX_FEATURE_BYTES) throw new Error('功能包总大小不能超过 25 MB');
    }
  };
  await visit(packageDir);
}

function buildPublicFeature(record: ConstructorFeatureRecord, manifest: ConstructorFeatureManifest) {
  return {
    ...record,
    manifest,
    assetBaseUrl: `/api/constructor-agent/features/${encodeURIComponent(record.id)}/assets`,
  };
}

export async function listConstructorFeatures(userId: string, enabledOnly = false): Promise<unknown[]> {
  const registry = await readRegistry(userId);
  const output: unknown[] = [];
  for (const record of Object.values(registry.features)) {
    if (enabledOnly && !record.enabled) continue;
    try {
      const manifest = await readManifest(getFeatureVersionDir(userId, record.id, record.activeVersion));
      output.push(buildPublicFeature(record, manifest));
    } catch (error) {
      logger.warn(`[ConstructorAgent] Skipping invalid installed feature ${record.id}:`, error);
    }
  }
  return output;
}

export async function getConstructorFeatureAsset(
  userId: string,
  featureId: string,
  relativePath: string,
): Promise<string> {
  if (!FEATURE_ID_PATTERN.test(featureId)) throw new Error('功能包 id 不合法');
  const registry = await readRegistry(userId);
  const record = registry.features[featureId];
  if (!record || !record.enabled) throw new Error('功能包未启用或不存在');
  const root = getFeatureVersionDir(userId, featureId, record.activeVersion);
  await readManifest(root);
  const assetPath = resolveInside(root, relativePath);
  const stat = await fs.lstat(assetPath);
  if (stat.isSymbolicLink()) throw new Error('功能包资源不允许使用符号链接');
  if (!stat.isFile()) throw new Error('功能包资源不存在');
  return assetPath;
}

const STORAGE_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

async function assertFeatureStoragePermission(userId: string, featureId: string): Promise<void> {
  if (!FEATURE_ID_PATTERN.test(featureId)) throw new Error('功能包 id 不合法');
  const registry = await readRegistry(userId);
  const record = registry.features[featureId];
  if (!record || !record.enabled) throw new Error('功能包未启用或不存在');
  const manifest = await readManifest(getFeatureVersionDir(userId, featureId, record.activeVersion));
  if (!manifest.permissions.includes('feature:storage')) throw new Error('功能包未获私有存储权限');
}

function getFeatureStoragePath(userId: string, featureId: string, key: string): string {
  if (!STORAGE_KEY_PATTERN.test(key)) throw new Error('存储键不合法');
  return path.join(getConstructorRoot(userId), 'storage', featureId, `${key}.json`);
}

export async function readConstructorFeatureStorage(
  userId: string,
  featureId: string,
  key: string,
): Promise<unknown | null> {
  await assertFeatureStoragePermission(userId, featureId);
  try {
    return JSON.parse(await fs.readFile(getFeatureStoragePath(userId, featureId, key), 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function writeConstructorFeatureStorage(
  userId: string,
  featureId: string,
  key: string,
  value: unknown,
): Promise<void> {
  await assertFeatureStoragePermission(userId, featureId);
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('存储值必须是可序列化的 JSON');
  if (Buffer.byteLength(serialized, 'utf8') > 256 * 1024) {
    throw new Error('单个功能包存储值不能超过 256 KB');
  }
  await writeJsonAtomic(getFeatureStoragePath(userId, featureId, key), value);
}

export async function deleteConstructorFeatureStorage(
  userId: string,
  featureId: string,
  key: string,
): Promise<void> {
  await assertFeatureStoragePermission(userId, featureId);
  await fs.rm(getFeatureStoragePath(userId, featureId, key), { force: true });
}

export async function installConstructorFeature(
  userId: string,
  sourceDir: string,
  options: { enable?: boolean } = {},
): Promise<unknown> {
  const packageDir = path.resolve(sourceDir);
  const stagingRoot = path.resolve(getConstructorRoot(userId), 'staging');
  const sourceRelative = path.relative(stagingRoot, packageDir);
  if (!sourceRelative || sourceRelative.startsWith('..') || path.isAbsolute(sourceRelative)) {
    throw new Error('只能安装构造 Agent 暂存目录中的功能包');
  }
  await validateFeaturePackageTree(packageDir);
  const manifest = await readManifest(packageDir);
  const targetDir = getFeatureVersionDir(userId, manifest.id, manifest.version);
  const targetRoot = path.resolve(getFeaturesRoot(userId));
  const relativeTarget = path.relative(targetRoot, targetDir);
  if (relativeTarget.startsWith('..') || path.isAbsolute(relativeTarget)) throw new Error('功能包安装路径不安全');
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(targetDir), { recursive: true });
  await fs.cp(packageDir, targetDir, { recursive: true, force: true });
  await validateFeaturePackageTree(targetDir);
  const installedManifest = await readManifest(targetDir);

  const registry = await readRegistry(userId);
  const existing = registry.features[manifest.id];
  const timestamp = nowIso();
  registry.features[manifest.id] = {
    id: manifest.id,
    enabled: options.enable ?? existing?.enabled ?? false,
    activeVersion: manifest.version,
    versions: Array.from(new Set([...(existing?.versions || []), manifest.version])),
    installedAt: existing?.installedAt || timestamp,
    updatedAt: timestamp,
  };
  await saveRegistry(userId, registry);
  logger.info(`[ConstructorAgent] Installed feature ${manifest.id}@${manifest.version}`);
  return buildPublicFeature(registry.features[manifest.id], installedManifest);
}

export async function setConstructorFeatureEnabled(
  userId: string,
  featureId: string,
  enabled: boolean,
): Promise<void> {
  const registry = await readRegistry(userId);
  const record = registry.features[featureId];
  if (!record) throw new Error('功能包不存在');
  if (enabled) await readManifest(getFeatureVersionDir(userId, featureId, record.activeVersion));
  record.enabled = enabled;
  record.updatedAt = nowIso();
  await saveRegistry(userId, registry);
}

export async function rollbackConstructorFeature(userId: string, featureId: string): Promise<void> {
  const registry = await readRegistry(userId);
  const record = registry.features[featureId];
  if (!record) throw new Error('功能包不存在');
  const index = record.versions.indexOf(record.activeVersion);
  const previousVersion = index > 0 ? record.versions[index - 1] : '';
  if (!previousVersion) throw new Error('没有可回滚的历史版本');
  await readManifest(getFeatureVersionDir(userId, featureId, previousVersion));
  record.activeVersion = previousVersion;
  record.updatedAt = nowIso();
  await saveRegistry(userId, registry);
}

export async function uninstallConstructorFeature(userId: string, featureId: string): Promise<void> {
  const registry = await readRegistry(userId);
  if (!registry.features[featureId]) throw new Error('功能包不存在');
  delete registry.features[featureId];
  await saveRegistry(userId, registry);
  await fs.rm(path.join(getFeaturesRoot(userId), featureId), { recursive: true, force: true });
}

export async function buildConstructorPlan(
  userId: string,
  request: string,
  requestedMode: 'auto' | ConstructorChangeMode = 'auto',
): Promise<ConstructorChangePlan> {
  return createConstructorChangePlan(userId, request, requestedMode);
}

export async function scaffoldConstructorFeature(
  userId: string,
  input: { id: string; name: string; description: string; version?: string },
): Promise<{ stagingDir: string; manifest: ConstructorFeatureManifest }> {
  const featureId = z.string().trim().regex(FEATURE_ID_PATTERN).parse(input.id);
  const version = z.string().trim().regex(VERSION_PATTERN).parse(input.version || '0.1.0');
  const stagingDir = path.join(getConstructorRoot(userId), 'staging', `${featureId}-${Date.now()}`);
  const manifest = constructorFeatureManifestSchema.parse({
    schemaVersion: 1,
    apiVersion: FEATURE_API_VERSION,
    id: featureId,
    name: input.name,
    version,
    description: input.description,
    permissions: ['ui:page', 'ui:navigation', 'feature:storage'],
    contributions: {
      pages: [{ id: 'main', title: input.name, subtitle: input.description, entry: 'frontend/index.html' }],
      navigation: [{ id: 'main-nav', label: input.name, pageId: 'main', section: 'tools' }],
      commands: [],
    },
  });
  await fs.mkdir(path.join(stagingDir, 'frontend'), { recursive: true });
  await writeJsonAtomic(path.join(stagingDir, 'feature.json'), manifest);
  const safeTitle = input.name.replace(/[<>&"']/g, '');
  const safeDescription = input.description.replace(/[<>&"']/g, '');
  await fs.writeFile(path.join(stagingDir, 'frontend', 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;color:#1f2937;background:#fff}main{max-width:860px;margin:auto}h1{margin:0 0 8px}p{line-height:1.7}</style></head>
<body><main><h1>${safeTitle}</h1><p>${safeDescription || '功能包页面已创建，等待构造 Agent 完善。'}</p></main></body></html>\n`, 'utf8');
  await fs.writeFile(path.join(stagingDir, 'README.md'), `# ${input.name}\n\n${input.description}\n`, 'utf8');
  return { stagingDir, manifest };
}

function incrementConstructorFeatureVersion(version: string, occupied: string[]): string {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[a-z0-9.-]+)?$/i.exec(version);
  const major = Number(match?.[1] || 0);
  const minor = Number(match?.[2] || 1);
  let patch = Number(match?.[3] || 0) + 1;
  let candidate = `${major}.${minor}.${patch}`;
  while (occupied.includes(candidate)) {
    patch += 1;
    candidate = `${major}.${minor}.${patch}`;
  }
  return candidate;
}

async function stageInstalledConstructorFeatureRevision(
  userId: string,
  featureId: string,
): Promise<{ stagingDir: string; manifest: ConstructorFeatureManifest }> {
  const registry = await readRegistry(userId);
  const record = registry.features[featureId];
  if (!record) throw new Error(`待修改的已有功能包不存在：${featureId}`);
  const sourceDir = getFeatureVersionDir(userId, featureId, record.activeVersion);
  const currentManifest = await readManifest(sourceDir);
  const nextVersion = incrementConstructorFeatureVersion(currentManifest.version, record.versions);
  const stagingDir = path.join(getConstructorRoot(userId), 'staging', `${featureId}-${nextVersion}-${Date.now()}`);
  await fs.mkdir(path.dirname(stagingDir), { recursive: true });
  await fs.cp(sourceDir, stagingDir, { recursive: true, force: true });
  const manifest = constructorFeatureManifestSchema.parse({ ...currentManifest, version: nextVersion });
  await writeJsonAtomic(path.join(stagingDir, 'feature.json'), manifest);
  return { stagingDir, manifest };
}

async function persistJob(job: ConstructorJob): Promise<void> {
  await writeJsonAtomic(path.join(getJobsRoot(job.userId), `${job.id}.json`), job);
}

async function appendJobLog(job: ConstructorJob, text: string): Promise<void> {
  await fs.mkdir(path.dirname(job.logPath), { recursive: true });
  await fs.appendFile(job.logPath, text, 'utf8');
}

function decryptConstructorSecret(value: unknown): string {
  const secret = typeof value === 'string' ? value.trim() : '';
  if (!secret) return '';
  try {
    return isEncrypted(secret) ? decrypt(secret) : secret;
  } catch (error) {
    logger.warn('[ConstructorAgent] Failed to decrypt the configured secondary API key:', error);
    return '';
  }
}

function normalizeReasonixApiUrl(value: string): string {
  return value.trim().replace(/\/chat\/completions\/?$/i, '').replace(/\/+$/, '');
}

async function resolveReasonixProviderConfig(): Promise<ReasonixProviderConfig> {
  const fallback: ReasonixProviderConfig = {
    apiUrl: normalizeReasonixApiUrl(process.env.SECONDARY_API_URL || process.env.API_URL || ''),
    apiKey: process.env.SECONDARY_API_KEY || process.env.API_KEY || '',
    model: process.env.SECONDARY_MODEL || 'deepseek-chat',
  };
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(getDataDir(), 'chat-bridge-config.json'), 'utf8')) as {
      secondary?: { api_url?: string; api_key?: string; model?: string };
    };
    const secondary = parsed.secondary || {};
    const resolved = {
      apiUrl: normalizeReasonixApiUrl(String(secondary.api_url || fallback.apiUrl || '')),
      apiKey: decryptConstructorSecret(secondary.api_key) || fallback.apiKey,
      model: String(secondary.model || fallback.model || 'deepseek-chat').trim(),
    };
    if (resolved.apiUrl && resolved.apiKey && resolved.model) return resolved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('[ConstructorAgent] Failed to read the configured secondary model for Reasonix:', error);
    }
  }
  if (fallback.apiUrl && fallback.apiKey && fallback.model) return fallback;
  const deepSeekKey = String(process.env.DEEPSEEK_API_KEY || '').trim();
  if (deepSeekKey) {
    return { apiUrl: 'https://api.deepseek.com', apiKey: deepSeekKey, model: 'deepseek-chat' };
  }
  throw new Error('Reasonix 缺少模型配置。请先在“小牛马”中配置 OpenAI 兼容 API URL、API Key 和模型，或设置 DEEPSEEK_API_KEY');
}

function tomlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

export async function writeReasonixProjectConfig(
  workspaceDir: string,
  provider: Pick<ReasonixProviderConfig, 'apiUrl' | 'model'>,
): Promise<string> {
  const resolvedWorkspace = path.resolve(workspaceDir);
  await fs.mkdir(resolvedWorkspace, { recursive: true });
  const configPath = path.join(resolvedWorkspace, 'reasonix.toml');
  const content = [
    'config_version = 5',
    'default_model = "scholar-harness-constructor"',
    '',
    '[agent]',
    'temperature = 0.0',
    'compact_ratio = 0.8',
    'compact_force_ratio = 0.9',
    'cold_resume_prune = true',
    '',
    '[tools]',
    'enabled = []',
    'bash_timeout_seconds = 0',
    'mcp_call_timeout_seconds = 300',
    '',
    '[permissions]',
    'mode = "allow"',
    'deny = ["Bash(git push*)", "Bash(rm -rf*)", "Bash(Remove-Item -Recurse*)"]',
    '',
    '[sandbox]',
    'workspace_root = "."',
    'bash = "off"',
    'network = true',
    '',
    '[[providers]]',
    'name = "scholar-harness-constructor"',
    'kind = "openai"',
    `base_url = ${tomlString(normalizeReasonixApiUrl(provider.apiUrl))}`,
    `model = ${tomlString(provider.model)}`,
    'api_key_env = "SCHOLAR_HARNESS_REASONIX_API_KEY"',
    '',
  ].join('\n');
  const temporaryPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, content, 'utf8');
  await fs.rename(temporaryPath, configPath);
  const stat = await fs.stat(configPath);
  if (!stat.isFile() || stat.size < 100) throw new Error('Reasonix 项目配置生成失败');
  return configPath;
}

export function buildReasonixRunArgs(workspaceDir: string, prompt: string): string[] {
  return [
    'run',
    '--dir',
    path.resolve(workspaceDir),
    // `reasonix run` is headless. Its CLI default is `ask`, which deliberately
    // rejects writer fallbacks because there is no approval UI to answer. The
    // constructor always operates on an isolated staging copy, so explicitly
    // enable unattended ordinary writes while the config deny rules and
    // workspace sandbox continue to protect destructive/out-of-root access.
    '--permission-mode',
    'auto',
    '--max-steps',
    '0',
    prompt,
  ];
}

async function prepareReasonixWorkspace(workspaceDir: string, jobId: string): Promise<PreparedReasonixWorkspace> {
  const sourceDir = path.resolve(workspaceDir);
  let executionDir = sourceDir;
  let temporary = false;
  const runtimeName = crypto.createHash('sha256').update(`${jobId}:${sourceDir}`).digest('hex').slice(0, 12);
  const reasonixHome = path.join(os.tmpdir(), 'shr-rxh', runtimeName);

  // Reasonix 1.19.x on Windows cannot canonicalize deeply nested project-local
  // reasonix.toml paths even when Node and PowerShell can access the file. Run
  // it from a short, isolated copy and synchronize the result back afterwards.
  if (process.platform === 'win32') {
    const runtimeRoot = path.join(os.tmpdir(), 'shr-rx');
    executionDir = path.join(runtimeRoot, runtimeName);
    const relativeRuntime = path.relative(path.resolve(runtimeRoot), path.resolve(executionDir));
    if (relativeRuntime.startsWith('..') || path.isAbsolute(relativeRuntime)) {
      throw new Error('Reasonix 短路径工作区解析失败');
    }
    await fs.mkdir(runtimeRoot, { recursive: true });
    await fs.rm(executionDir, { recursive: true, force: true });
    await fs.cp(sourceDir, executionDir, { recursive: true, force: true });
    temporary = true;
  }

  try {
    const provider = await resolveReasonixProviderConfig();
    const configPath = await writeReasonixProjectConfig(executionDir, provider);
    await fs.access(configPath);

    // Reasonix 1.19.x deliberately resolves provider secrets only from its
    // global <REASONIX_HOME>/.env, not from inherited environment variables or
    // a project-local .env. Use an isolated per-job home so the user's global
    // Reasonix settings stay untouched and the credential disappears after the
    // task finishes.
    await fs.rm(reasonixHome, { recursive: true, force: true });
    await fs.mkdir(reasonixHome, { recursive: true });
    const credentialPath = path.join(reasonixHome, '.env');
    const temporaryCredentialPath = `${credentialPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(
      temporaryCredentialPath,
      `SCHOLAR_HARNESS_REASONIX_API_KEY=${JSON.stringify(provider.apiKey.replace(/\r?\n/g, ''))}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    await fs.rename(temporaryCredentialPath, credentialPath);
    await fs.access(credentialPath);

    const processEnvironment = await buildReasonixProcessEnvironment(reasonixHome);
    return {
      configPath,
      executionDir,
      reasonixHome,
      sourceDir,
      temporary,
      env: processEnvironment.env,
      bypassedProxies: processEnvironment.bypassedProxies,
    };
  } catch (error) {
    await fs.rm(path.join(executionDir, 'reasonix.toml'), { force: true });
    await fs.rm(reasonixHome, { recursive: true, force: true });
    if (temporary) await fs.rm(executionDir, { recursive: true, force: true });
    throw error;
  }
}

async function finalizeReasonixWorkspace(prepared: PreparedReasonixWorkspace): Promise<void> {
  await fs.rm(prepared.configPath, { force: true });
  try {
    if (prepared.temporary) {
      await fs.cp(prepared.executionDir, prepared.sourceDir, {
        recursive: true,
        force: true,
        filter: candidate => {
          const name = path.basename(candidate).toLowerCase();
          return name !== 'reasonix.toml'
            && name !== '.reasonix'
            && name !== '.git'
            && name !== '.env';
        },
      });
      await fs.rm(prepared.executionDir, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(prepared.reasonixHome, { recursive: true, force: true });
  }
}

export async function listConstructorJobs(userId: string): Promise<ConstructorJob[]> {
  const root = getJobsRoot(userId);
  try {
    const names = (await fs.readdir(root)).filter(name => name.endsWith('.json'));
    const jobs = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8')) as ConstructorJob));
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function getConstructorJobLog(userId: string, jobId: string): Promise<string> {
  if (!/^\d{10,}-[a-f0-9]{8}$/.test(jobId)) throw new Error('任务 id 不合法');
  const jobs = await listConstructorJobs(userId);
  const job = jobs.find(item => item.id === jobId);
  if (!job) throw new Error('任务不存在');
  try {
    return (await fs.readFile(job.logPath, 'utf8')).slice(-120_000);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export async function detectReasonix(): Promise<{ installed: boolean; version: string }> {
  try {
    const invocation = await resolveReasonixInvocation(['--version']);
    if (!invocation) return { installed: false, version: '' };
    return await new Promise(resolve => {
      let output = '';
      let settled = false;
      const finish = (value: { installed: boolean; version: string }) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      try {
        const child = spawn(invocation.command, invocation.args, { windowsHide: true, shell: false });
        child.stdout.on('data', chunk => { output += chunk.toString(); });
        child.stderr.on('data', chunk => { output += chunk.toString(); });
        child.on('error', () => finish({ installed: false, version: '' }));
        child.on('close', code => finish({ installed: code === 0, version: output.trim().slice(0, 200) }));
      } catch {
        finish({ installed: false, version: '' });
      }
    });
  } catch (error) {
    logger.warn('[ConstructorAgent] Reasonix detection degraded safely:', error);
    return { installed: false, version: '' };
  }
}

function createJob(userId: string, kind: ConstructorJob['kind'], featureId?: string): ConstructorJob {
  const id = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const root = getJobsRoot(userId);
  return {
    id,
    kind,
    status: 'queued',
    message: '任务已进入后台队列',
    userId: sanitizeUserId(userId),
    featureId,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    logPath: path.join(root, `${id}.log`),
  };
}

async function runCommandJob(
  job: ConstructorJob,
  command: string,
  args: string[],
  cwd: string,
  options: RunCommandJobOptions = {},
): Promise<void> {
  job.status = 'running';
  job.message = '后台任务正在运行';
  job.updatedAt = nowIso();
  await persistJob(job);
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn(command, args, {
      cwd,
      windowsHide: true,
      shell: false,
      env: mergeChildProcessEnvironment({ ...options.env, NO_COLOR: '1' }),
    });
  } catch (error) {
    job.status = 'error';
    job.message = (error as Error)?.message || String(error);
    job.updatedAt = nowIso();
    await appendJobLog(job, `\n${job.message}\n`);
    try {
      if (options.onClose) await options.onClose(null);
    } catch (cleanupError) {
      await appendJobLog(job, `\n启动失败后的清理也失败：${(cleanupError as Error)?.message || String(cleanupError)}\n`);
    }
    await persistJob(job);
    return;
  }
  runningJobs.set(job.id, child);
  let timedOut = false;
  const timeout = options.timeoutMs && options.timeoutMs > 0
    ? setTimeout(() => {
      timedOut = true;
      void appendJobLog(job, `\n任务超过 ${Math.round(options.timeoutMs! / 60_000)} 分钟，已终止进程树。\n`);
      if (process.platform === 'win32' && child.pid) {
        try {
          spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
            windowsHide: true,
            shell: false,
            stdio: 'ignore',
          });
        } catch {
          child.kill();
        }
      } else {
        child.kill();
      }
    }, options.timeoutMs)
    : null;
  timeout?.unref?.();
  child.stdout?.on('data', chunk => { void appendJobLog(job, chunk.toString()); });
  child.stderr?.on('data', chunk => { void appendJobLog(job, chunk.toString()); });
  child.on('error', error => { void appendJobLog(job, `\n${error.message}\n`); });
  child.on('close', code => {
    void (async () => {
      if (timeout) clearTimeout(timeout);
      runningJobs.delete(job.id);
      job.exitCode = code;
      job.status = code === 0 && !timedOut ? 'success' : 'error';
      job.message = timedOut
        ? '后台任务超时，已安全终止'
        : (code === 0 ? '后台任务已完成' : `后台任务失败（exit=${code ?? 'unknown'}）`);
      try {
        if (options.onClose) await options.onClose(code);
      } catch (error) {
        job.status = 'error';
        job.message = (error as Error)?.message || String(error);
        await appendJobLog(job, `\n后处理失败：${job.message}\n`);
      }
      job.updatedAt = nowIso();
      await persistJob(job);
    })();
  });
}

export async function startReasonixInstall(userId: string): Promise<ConstructorJob> {
  const invocation = await resolveNpmInvocation(['install', '-g', 'reasonix@1.31.4']);
  const job = createJob(userId, 'reasonix-install');
  await persistJob(job);
  void runCommandJob(job, invocation.command, invocation.args, getConstructorRoot(userId), {
    timeoutMs: 15 * 60_000,
  });
  return job;
}

export async function startReasonixBuild(
  userId: string,
  input: { featureId: string; request: string; stagingDir: string; changeId?: string; autoInstall?: boolean },
): Promise<ConstructorJob> {
  const featureId = z.string().trim().regex(FEATURE_ID_PATTERN).parse(input.featureId);
  const constructorRoot = path.resolve(getConstructorRoot(userId));
  const stagingDir = path.resolve(input.stagingDir);
  const relative = path.relative(constructorRoot, stagingDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Reasonix 只能在构造 Agent 暂存目录内工作');
  let change: ConstructorChangePlan | undefined;
  if (input.changeId) {
    change = await getConstructorChange(userId, input.changeId);
    if (change.mode !== 'runtime-feature') throw new Error('核心源码变更必须使用隔离核心改造流程');
    if (change.requiresApproval && change.status !== 'approved-for-generation') throw new Error('该方案需要用户明确批准后才能生成');
  }
  await fs.stat(stagingDir);
  const prompt = [
    'You are implementing a Scholar Harness runtime Feature Package.',
    `Feature request: ${input.request.trim()}`,
    change?.operation === 'modify-runtime'
      ? `Intent is MODIFY EXISTING FEATURE PACKAGE ${featureId}. Preserve its feature id, navigation identity, storage keys, and existing behavior. Edit the files already present in this workspace; do not create a second feature, page, or navigation entry for the requested adjustment.`
      : 'Intent is CREATE A NEW isolated runtime feature package because no existing Scholar Harness or installed feature matched the request.',
    'This is an unattended background build already authorized by the user. Create and edit the required files directly; do not call ask, request approval, or stop at a preview-only plan.',
    'Work only in the current directory. Do not read or write parent directories.',
    'Keep feature.json schemaVersion=1 and apiVersion=1.',
    'Do not add Electron main-process, auth, payment, updater, arbitrary shell, or core-file mutation capabilities.',
    'Implement the frontend inside frontend/. Preserve a valid feature.json.',
    'For persistent state, request feature:storage and use the parent message bridge: postMessage({source:"scholar-harness-feature",requestId,type:"storage.get|storage.set|storage.delete",key,value}, "*").',
    'Host replies use source:"scholar-harness-host" and include both success and ok booleans; accept only messages from window.parent. For theme integration, request postMessage({source:"scholar-harness-feature",type:"theme.request"}, "*") and consume the returned type:"theme" CSS variable map. New features should prefer the stable --feature-* variables.',
    'Finish by validating all relative paths and writing IMPLEMENTATION.md with tests and rollback notes.',
    'Apply these Scholar Harness engineering skills:',
    await loadConstructorEngineeringSkills([
      'requirements-contract', 'architecture-impact', 'feature-package-build', 'api-contract',
      'security-permission-review', 'test-release-gate', 'migration-rollback',
    ]),
  ].join('\n');
  const job = createJob(userId, 'reasonix-build', featureId);
  job.changeId = input.changeId;
  job.stagingDir = stagingDir;
  await persistJob(job);
  const prepared = await prepareReasonixWorkspace(stagingDir, job.id);
  await appendJobLog(job, `Reasonix 项目配置已生成：${prepared.configPath}\n`);
  if (prepared.temporary) {
    await appendJobLog(job, `Reasonix Windows 短路径工作区：${prepared.executionDir}\n`);
  }
  if (prepared.bypassedProxies.length) {
    await appendJobLog(job, `检测到不可用的本地代理 ${prepared.bypassedProxies.join('、')}；本任务已绕过该代理直连模型服务（未修改系统代理）。\n`);
  }
  const invocation = await resolveReasonixInvocation(buildReasonixRunArgs(prepared.executionDir, prompt));
  if (!invocation) {
    await finalizeReasonixWorkspace(prepared);
    throw new Error('Reasonix 启动入口不可用，请重新一键安装');
  }
  void runCommandJob(job, invocation.command, invocation.args, prepared.executionDir, {
    env: prepared.env,
    onClose: async code => {
      await finalizeReasonixWorkspace(prepared);
      try {
        if (code === 0 && input.autoInstall) {
          const preserveExistingEnabledState = change?.operation === 'modify-runtime';
          await installConstructorFeature(
            userId,
            stagingDir,
            preserveExistingEnabledState ? {} : { enable: false },
          );
          job.message = preserveExistingEnabledState
            ? '构建、清单校验和更新已完成（已保留原启用状态）'
            : '构建、清单校验和安装已完成（功能包默认停用）';
        }
      } catch (error) {
        if (input.changeId) {
          const current = await getConstructorChange(userId, input.changeId);
          current.status = 'failed';
          await saveChange(current);
        }
        throw error;
      }
      if (input.changeId && input.autoInstall) {
        const current = await getConstructorChange(userId, input.changeId);
        current.status = code === 0 ? 'applied' : 'failed';
        await saveChange(current);
      }
    },
  });
  return job;
}

function deriveConstructorFeatureIdentity(request: string): { featureId: string; name: string } {
  const hash = crypto.createHash('sha256').update(request, 'utf8').digest('hex').slice(0, 6);
  const words = request
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34)
    .replace(/-+$/g, '');
  const prefix = /^[a-z]/.test(words) && words.length >= 3 ? words : 'custom-feature';
  const featureId = `${prefix}-${Date.now().toString(36)}-${hash}`.slice(0, 64).replace(/-+$/g, '');
  const firstLine = request.split(/\r?\n/).map(line => line.trim()).find(Boolean) || '自定义功能';
  return { featureId, name: firstLine.slice(0, 80) };
}

async function startRuntimeFeaturePipeline(
  userId: string,
  plan: ConstructorChangePlan,
): Promise<ConstructorPipelineResult> {
  normalizeRuntimeFeaturePlanScope(plan);
  const modifyingExisting = plan.operation === 'modify-runtime' && !!plan.targetFeature;
  const identity = modifyingExisting
    ? { featureId: plan.targetFeature!.id, name: plan.targetFeature!.name }
    : deriveConstructorFeatureIdentity(plan.objective);
  const scaffold = modifyingExisting
    ? await stageInstalledConstructorFeatureRevision(userId, identity.featureId)
    : await scaffoldConstructorFeature(userId, {
      id: identity.featureId,
      name: identity.name,
      description: plan.objective,
      version: '0.1.0',
    });
  plan.status = 'generating';
  await saveChange(plan);
  let job: ConstructorJob;
  try {
    job = await startReasonixBuild(userId, {
      featureId: identity.featureId,
      request: plan.objective,
      stagingDir: scaffold.stagingDir,
      changeId: plan.id,
      autoInstall: true,
    });
  } catch (error) {
    plan.status = 'failed';
    await saveChange(plan);
    throw error;
  }
  return {
    state: 'started',
    plan,
    featureId: identity.featureId,
    stagingDir: scaffold.stagingDir,
    job,
  };
}

export async function startConstructorPipeline(
  userId: string,
  request: string,
): Promise<ConstructorPipelineResult> {
  const plan = await createConstructorChangePlan(userId, request, 'auto');
  if (plan.requiresApproval) return { state: 'approval-required', plan };
  return startRuntimeFeaturePipeline(userId, plan);
}

export async function resumeConstructorPipeline(
  userId: string,
  changeId: string,
): Promise<ConstructorPipelineResult> {
  const plan = await getConstructorChange(userId, changeId);
  if (plan.status === 'failed' && plan.mode === 'runtime-feature' && !plan.requiresApproval) {
    return startRuntimeFeaturePipeline(userId, plan);
  }
  if (plan.status !== 'approved-for-generation') throw new Error('该改造方案尚未获得生成批准');
  if (plan.mode === 'core-change') {
    const job = await startReasonixCoreProposal(userId, plan.id);
    return { state: 'started', plan, job };
  }
  return startRuntimeFeaturePipeline(userId, plan);
}

const CORE_ALLOWED_TOP_LEVEL = new Set([
  'src', 'agents', 'workflows', 'electron', 'cloud', 'scholarharness-website', 'configs', 'scripts',
  'skills', 'sci_writing_skills', '__tests__', 'tsconfig.json',
]);
const CORE_EXCLUDED_SEGMENTS = new Set([
  '.git', '.next', 'node_modules', 'dist', 'dist-electron', 'artifacts', 'coverage', 'data', 'downloads',
]);

function normalizedRelative(root: string, candidate: string): string {
  return path.relative(root, candidate).replace(/\\/g, '/');
}

function isCoreSourcePathAllowed(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../') || path.isAbsolute(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.some(segment => CORE_EXCLUDED_SEGMENTS.has(segment))) return false;
  if (segments.some(segment => segment === '.env' || segment.startsWith('.env.'))) return false;
  return CORE_ALLOWED_TOP_LEVEL.has(segments[0]);
}

async function copyCoreWorkspace(sourceRoot: string, workspaceDir: string): Promise<void> {
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  for (const topLevel of CORE_ALLOWED_TOP_LEVEL) {
    const source = path.join(sourceRoot, topLevel);
    if (!existsSync(source)) continue;
    await fs.cp(source, path.join(workspaceDir, topLevel), {
      recursive: true,
      force: true,
      filter: candidate => {
        const relative = normalizedRelative(sourceRoot, candidate);
        const segments = relative.replace(/\\/g, '/').split('/');
        if (segments.some(segment => CORE_EXCLUDED_SEGMENTS.has(segment))) return false;
        return !segments.some(segment => segment === '.env' || segment.startsWith('.env.'));
      },
    });
  }
}

async function collectFileHashes(root: string): Promise<Record<string, { sha256: string; bytes: number }>> {
  const result: Record<string, { sha256: string; bytes: number }> = {};
  const pending = [root];
  while (pending.length) {
    const current = pending.pop()!;
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        pending.push(candidate);
        continue;
      }
      const relative = normalizedRelative(root, candidate);
      if (!isCoreSourcePathAllowed(relative)) continue;
      const content = await fs.readFile(candidate);
      result[relative] = { sha256: crypto.createHash('sha256').update(content).digest('hex'), bytes: content.length };
    }
  }
  return result;
}

function getCoreWorkspaceDir(userId: string, changeId: string): string {
  return path.join(getConstructorRoot(userId), 'core-workspaces', changeId, 'source');
}

function getCoreBaselinePath(userId: string, changeId: string): string {
  return path.join(getConstructorRoot(userId), 'core-workspaces', changeId, 'baseline.json');
}

export async function startReasonixCoreProposal(userId: string, changeId: string): Promise<ConstructorJob> {
  const plan = await getConstructorChange(userId, changeId);
  if (plan.mode !== 'core-change') throw new Error('该方案不是核心源码改造');
  if (plan.status !== 'approved-for-generation') throw new Error('请先明确批准核心改造方案');
  const sourceRoot = sourceWorkspaceRoot();
  if (!sourceRoot) throw new Error('当前为无源码的安装版；只能生成更新包方案，不能直接改写 app.asar');
  const workspaceDir = getCoreWorkspaceDir(userId, plan.id);
  const job = createJob(userId, 'reasonix-core-proposal');
  job.changeId = plan.id;
  job.stagingDir = workspaceDir;
  job.message = '正在创建核心源码隔离副本';
  await persistJob(job);
  plan.status = 'generating';
  plan.workspaceDir = workspaceDir;
  plan.proposalJobId = job.id;
  await saveChange(plan);

  void (async () => {
    try {
      await copyCoreWorkspace(sourceRoot, workspaceDir);
      await writeJsonAtomic(getCoreBaselinePath(userId, plan.id), await collectFileHashes(workspaceDir));
      const capabilityMap = await getConstructorCapabilityMap();
      const relevant = rankCapabilityDomains(plan.objective, capabilityMap);
      const engineeringSkills = await loadConstructorEngineeringSkills([
        'requirements-contract', 'architecture-impact', 'api-contract', 'security-permission-review',
        'test-release-gate', 'migration-rollback', 'core-change-governance',
      ]);
      const prompt = [
        'You are the Scholar Harness Constructor Agent working on an isolated full-source copy.',
        `Change id: ${plan.id}`,
        `Objective: ${plan.objective}`,
        `Risk: ${plan.risk}. User explicitly approved generation of a core-change candidate.`,
        'This is an unattended background build already authorized by the user. Create and edit the candidate files directly; do not call ask, request another approval, or stop at a preview-only plan.',
        `Relevant product domains: ${relevant.map(domain => `${domain.name} [${domain.paths.join(', ')}]`).join('; ')}`,
        'Understand the existing implementation before editing. Reuse the same routes, UI shell, state recovery, logging, and file-path conventions.',
        'Do not read or write outside the current directory. Never access secrets, .env files, user documents, databases, or deployment credentials.',
        'Do not edit package.json, package-lock.json, generated artifacts, node_modules, dist, installers, or release assets.',
        'Preserve existing behavior outside the objective. Add or update focused tests. Do not silently remove features or data migrations.',
        'Run node scripts/check-public-js.js when frontend code changes. Record validation commands and all changed paths in CONSTRUCTOR_CHANGE_REPORT.md.',
        'Include an exact rollback note for each changed subsystem. Stop after producing the candidate; do not deploy or apply it.',
        'Apply these Scholar Harness engineering skills:',
        engineeringSkills,
      ].join('\n');
      const prepared = await prepareReasonixWorkspace(workspaceDir, job.id);
      await appendJobLog(job, `Reasonix 项目配置已生成：${prepared.configPath}\n`);
      if (prepared.temporary) {
        await appendJobLog(job, `Reasonix Windows 短路径工作区：${prepared.executionDir}\n`);
      }
      if (prepared.bypassedProxies.length) {
        await appendJobLog(job, `检测到不可用的本地代理 ${prepared.bypassedProxies.join('、')}；本任务已绕过该代理直连模型服务（未修改系统代理）。\n`);
      }
      const invocation = await resolveReasonixInvocation(buildReasonixRunArgs(prepared.executionDir, prompt));
      if (!invocation) {
        await finalizeReasonixWorkspace(prepared);
        throw new Error('Reasonix 启动入口不可用，请重新一键安装');
      }
      await runCommandJob(job, invocation.command, invocation.args, prepared.executionDir, {
        env: prepared.env,
        onClose: async code => {
          await finalizeReasonixWorkspace(prepared);
          const current = await getConstructorChange(userId, plan.id);
          current.status = code === 0 ? 'awaiting-apply-approval' : 'failed';
          await saveChange(current);
        },
      });
    } catch (error) {
      job.status = 'error';
      job.message = (error as Error)?.message || String(error);
      job.updatedAt = nowIso();
      await appendJobLog(job, `\n${job.message}\n`);
      await persistJob(job);
      const current = await getConstructorChange(userId, plan.id);
      current.status = 'failed';
      await saveChange(current);
    }
  })();
  return job;
}

export async function getConstructorCoreDiff(
  userId: string,
  changeId: string,
): Promise<{ added: string[]; modified: string[]; deleted: string[]; total: number }> {
  const plan = await getConstructorChange(userId, changeId);
  if (!plan.workspaceDir) throw new Error('该变更还没有核心源码候选');
  const baseline = JSON.parse(await fs.readFile(getCoreBaselinePath(userId, plan.id), 'utf8')) as Record<string, { sha256: string }>;
  const current = await collectFileHashes(plan.workspaceDir);
  const added = Object.keys(current).filter(file => !baseline[file]);
  const modified = Object.keys(current).filter(file => baseline[file] && baseline[file].sha256 !== current[file].sha256);
  const deleted = Object.keys(baseline).filter(file => !current[file]);
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort(), total: added.length + modified.length + deleted.length };
}

async function restoreCoreBackup(plan: ConstructorChangePlan): Promise<void> {
  const sourceRoot = sourceWorkspaceRoot();
  if (!sourceRoot || !plan.backupDir) throw new Error('没有可用的核心变更回滚点');
  const manifestPath = path.join(plan.backupDir, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { existed: string[]; absent: string[] };
  for (const relative of manifest.existed) {
    const source = resolveInside(path.join(plan.backupDir, 'files'), relative);
    const destination = resolveInside(sourceRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  for (const relative of manifest.absent) await fs.rm(resolveInside(sourceRoot, relative), { force: true, recursive: true });
}

export async function startConstructorCoreApply(userId: string, changeId: string): Promise<ConstructorJob> {
  const plan = await getConstructorChange(userId, changeId);
  if (plan.mode !== 'core-change' || plan.status !== 'approved-for-apply') throw new Error('核心修改候选尚未获得应用批准');
  const sourceRoot = sourceWorkspaceRoot();
  if (!sourceRoot || !plan.workspaceDir) throw new Error('当前环境没有可应用的源码工作区');
  const diff = await getConstructorCoreDiff(userId, changeId);
  if (!diff.total) throw new Error('核心修改候选没有产生文件变化');
  const validationInvocation = await resolveNpmInvocation(['run', 'build']);
  const changed = [...diff.added, ...diff.modified, ...diff.deleted];
  if (changed.some(relative => !isCoreSourcePathAllowed(relative))) throw new Error('候选包含不允许应用的路径');
  const backupDir = path.join(getConstructorRoot(userId), 'backups', plan.id);
  await fs.rm(backupDir, { recursive: true, force: true });
  const existed: string[] = [];
  const absent: string[] = [];
  for (const relative of changed) {
    const original = resolveInside(sourceRoot, relative);
    try {
      const stat = await fs.stat(original);
      if (!stat.isFile()) throw new Error(`核心变更只能覆盖文件：${relative}`);
      const backup = resolveInside(path.join(backupDir, 'files'), relative);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(original, backup);
      existed.push(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      absent.push(relative);
    }
  }
  await writeJsonAtomic(path.join(backupDir, 'manifest.json'), { existed, absent, diff, createdAt: nowIso() });
  for (const relative of [...diff.added, ...diff.modified]) {
    const candidate = resolveInside(plan.workspaceDir, relative);
    const destination = resolveInside(sourceRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(candidate, destination);
  }
  for (const relative of diff.deleted) await fs.rm(resolveInside(sourceRoot, relative), { force: true, recursive: true });
  plan.backupDir = backupDir;
  plan.status = 'applying';
  const job = createJob(userId, 'core-apply');
  job.changeId = plan.id;
  plan.applyJobId = job.id;
  await saveChange(plan);
  await persistJob(job);
  void runCommandJob(job, validationInvocation.command, validationInvocation.args, sourceRoot, {
    onClose: async code => {
      const current = await getConstructorChange(userId, plan.id);
      if (code === 0) {
        current.status = 'applied';
      } else {
        await restoreCoreBackup(current);
        current.status = 'rolled-back';
        job.message = '验证失败，已自动恢复应用前备份';
      }
      await saveChange(current);
    },
  });
  return job;
}

export async function rollbackConstructorCoreChange(userId: string, changeId: string): Promise<ConstructorChangePlan> {
  const plan = await getConstructorChange(userId, changeId);
  if (!plan.backupDir) throw new Error('该变更没有可用回滚点');
  await restoreCoreBackup(plan);
  plan.status = 'rolled-back';
  await saveChange(plan);
  return plan;
}

export async function cancelConstructorJob(userId: string, jobId: string): Promise<boolean> {
  const child = runningJobs.get(jobId);
  if (!child) return false;
  child.kill();
  runningJobs.delete(jobId);
  const jobPath = path.join(getJobsRoot(userId), `${jobId}.json`);
  const job = JSON.parse(await fs.readFile(jobPath, 'utf8')) as ConstructorJob;
  job.status = 'cancelled';
  job.message = '用户已取消任务';
  job.updatedAt = nowIso();
  await persistJob(job);
  return true;
}
