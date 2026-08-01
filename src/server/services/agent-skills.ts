import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import { z } from 'zod';

import { getDataDir, getUserUploadDir, sanitizeUserId } from '../../utils/paths';
import { logger } from '../../utils/logger';
import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';
import { listUserSkills, type UserSkill } from './user-skills';

const PACK_CACHE_TTL_MS = 5_000;
const MAX_SKILL_FILE_CHARS = 120_000;
const MAX_RESOURCE_FILE_CHARS = 240_000;
const MAX_RESOURCE_LIST_ITEMS = 160;
const SKILL_RESOURCE_EXTENSIONS = new Set([
  '.bib', '.css', '.csv', '.html', '.js', '.json', '.md', '.markdown', '.py',
  '.r', '.rmd', '.sh', '.sty', '.tex', '.ts', '.txt', '.yaml', '.yml',
]);

const packSkillSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(1200),
  entry: z.string().trim().min(1).max(500),
  aliases: z.array(z.string().trim().min(1).max(100)).optional().default([]),
  policyOverlay: z.string().trim().max(4000).optional().default(''),
  enabled: z.boolean().optional().default(true),
});

const skillPackSchema = z.object({
  schemaVersion: z.number().int().min(1),
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(160),
  version: z.string().trim().max(100).optional().default(''),
  sourceRepository: z.string().trim().max(1000).optional().default(''),
  sourceCommit: z.string().trim().max(200).optional().default(''),
  license: z.string().trim().max(200).optional().default(''),
  noticeFile: z.string().trim().max(500).optional().default(''),
  skills: z.array(packSkillSchema).min(1),
});

interface BundledAgentSkill {
  id: string;
  rawId: string;
  name: string;
  description: string;
  category: string;
  aliases: string[];
  policyOverlay: string;
  sourceKind: 'bundled';
  sourceLabel: string;
  packId: string;
  packRoot: string;
  skillRoot: string;
  entryPath: string;
  license: string;
  sourceRepository: string;
  sourceCommit: string;
}

interface UserAgentSkill {
  id: string;
  rawId: string;
  name: string;
  description: string;
  category: string;
  aliases: string[];
  sourceKind: 'user';
  sourceLabel: string;
  trigger: string;
  prompt: string;
}

type InternalAgentSkill = BundledAgentSkill | UserAgentSkill;

export interface AgentSkillDescriptor {
  id: string;
  name: string;
  description: string;
  category: string;
  aliases: string[];
  source: 'bundled' | 'user';
  sourceLabel: string;
  manualTrigger?: string;
  explicitlyActive: boolean;
}

export interface AgentSkillToolResult {
  ok: boolean;
  toolName: string;
  summary: string;
  content: string;
  error?: string;
  data?: Record<string, unknown>;
}

export interface CodexAgentSkillContext {
  catalogPrompt: string;
  allowedRoots: string[];
}

export interface AgentSkillCatalogOptions {
  query?: string;
  maxChars?: number;
  fullCatalogPath?: string;
}

export interface AgentSkillCompletionContract {
  id: string;
  skillId: string;
  skillName: string;
  completeMarker: string;
  blockedMarker: string;
}

function readCompletionContractAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`\\b${name}=["']([^"']+)["']`, 'i'));
  return String(match?.[1] || '').trim();
}

function parseCompletionContracts(skill: UserAgentSkill): AgentSkillCompletionContract[] {
  const contracts: AgentSkillCompletionContract[] = [];
  const tagPattern = /<completion-contract\b([^>]*)\/?>/gi;
  for (const match of skill.prompt.matchAll(tagPattern)) {
    const attributes = match[1] || '';
    const id = readCompletionContractAttribute(attributes, 'id');
    const completeMarker = readCompletionContractAttribute(attributes, 'complete-marker');
    const blockedMarker = readCompletionContractAttribute(attributes, 'blocked-marker');
    if (
      !/^[a-z0-9][a-z0-9._-]{2,100}$/i.test(id)
      || !/^[A-Z0-9][A-Z0-9_-]{3,100}$/.test(completeMarker)
      || !/^[A-Z0-9][A-Z0-9_-]{3,100}$/.test(blockedMarker)
    ) {
      continue;
    }
    contracts.push({
      id,
      skillId: skill.id,
      skillName: skill.name,
      completeMarker,
      blockedMarker,
    });
  }
  return contracts;
}

const DISCUSSION_AUTO_SKILL_PRIORITY: Record<string, number> = {
  'scientific-writing': 400,
  'scientific-critical-thinking': 300,
  'citation-management': 200,
  'literature-review': 100,
};

export function selectDiscussionAutoSkillIds(
  descriptors: AgentSkillDescriptor[],
  limit = 6,
): string[] {
  const discussionPattern = /discussion|讨论|论文写作|学术写作|scientific writing|critical thinking|批判性思维|citation|引用管理|literature review|文献综述/i;
  return descriptors
    .filter(skill => !skill.explicitlyActive)
    .map(skill => {
      const rawId = skill.id.split(':').pop() || skill.id;
      const metadata = [skill.name, skill.description, ...skill.aliases].join(' ');
      const priority = DISCUSSION_AUTO_SKILL_PRIORITY[rawId]
        || (discussionPattern.test(metadata) ? (skill.source === 'user' ? 500 : 50) : 0);
      return { id: skill.id, priority };
    })
    .filter(skill => skill.priority > 0)
    .sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id))
    .slice(0, Math.max(0, limit))
    .map(skill => skill.id);
}

interface BundledSkillCache {
  expiresAt: number;
  skills: BundledAgentSkill[];
  packRoots: string[];
}

let bundledSkillCache: BundledSkillCache | null = null;

function getDisabledBundledSkillsPath(userId: string): string {
  return path.join(
    getDataDir(),
    'agent-skills',
    sanitizeUserId(userId),
    'disabled-bundled-skills.json',
  );
}

async function readDisabledBundledSkillIds(userId: string): Promise<Set<string>> {
  try {
    const parsed = JSON.parse(await fs.readFile(getDisabledBundledSkillsPath(userId), 'utf-8')) as unknown;
    const ids = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { skillIds?: unknown }).skillIds)
        ? (parsed as { skillIds: unknown[] }).skillIds
        : []);
    return new Set(ids.map(id => String(id || '').trim()).filter(Boolean));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    logger.warn(`[AgentSkills] Failed to read disabled bundled Skills for ${sanitizeUserId(userId)}:`, error);
    return new Set();
  }
}

async function writeDisabledBundledSkillIds(userId: string, skillIds: Set<string>): Promise<void> {
  const filePath = getDisabledBundledSkillsPath(userId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await writeAtomic(filePath, `${JSON.stringify({
    version: 1,
    skillIds: Array.from(skillIds).sort(),
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function isPathWithin(parentPath: string, childPath: string): boolean {
  const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeSkillIdPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function uniqueExistingDirectories(candidates: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(resolved);
    }
  }
  return result;
}

function getSkillPackRootCandidates(): string[] {
  const configured = String(process.env.AGENT_SKILL_PACK_DIR || '').trim();
  const executableDir = path.dirname(process.execPath);
  return uniqueExistingDirectories([
    ...(configured ? configured.split(path.delimiter).map(item => item.trim()).filter(Boolean) : []),
    path.resolve(process.cwd(), 'skill-packs'),
    path.resolve(process.cwd(), '..', 'skill-packs'),
    path.resolve(__dirname, '..', '..', '..', 'skill-packs'),
    path.resolve(__dirname, '..', '..', '..', '..', 'skill-packs'),
    path.join(executableDir, 'skill-packs'),
    path.join(executableDir, 'resources', 'skill-packs'),
  ]);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findPackDirectories(root: string): Promise<string[]> {
  if (!await pathExists(root)) return [];
  if (await pathExists(path.join(root, 'pack.json'))) return [root];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const directories: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(root, entry.name);
    if (await pathExists(path.join(candidate, 'pack.json'))) {
      directories.push(candidate);
    }
  }
  return directories;
}

async function loadPackDirectory(packRoot: string): Promise<BundledAgentSkill[]> {
  const manifestPath = path.join(packRoot, 'pack.json');
  const manifest = skillPackSchema.parse(JSON.parse(await fs.readFile(manifestPath, 'utf-8')));
  const skills: BundledAgentSkill[] = [];
  for (const rawSkill of manifest.skills) {
    if (!rawSkill.enabled) continue;
    const entryPath = path.resolve(packRoot, rawSkill.entry);
    if (!isPathWithin(packRoot, entryPath)) {
      throw new Error(`Skill entry 超出包目录: ${rawSkill.entry}`);
    }
    if (!await pathExists(entryPath)) {
      logger.warn(`[AgentSkills] Missing skill entry: ${entryPath}`);
      continue;
    }
    const packId = normalizeSkillIdPart(manifest.id);
    const rawId = normalizeSkillIdPart(rawSkill.id);
    skills.push({
      id: `${packId}:${rawId}`,
      rawId,
      name: rawSkill.name,
      description: rawSkill.description,
      category: rawSkill.category,
      aliases: rawSkill.aliases,
      policyOverlay: rawSkill.policyOverlay,
      sourceKind: 'bundled',
      sourceLabel: manifest.name,
      packId,
      packRoot,
      skillRoot: path.dirname(entryPath),
      entryPath,
      license: manifest.license,
      sourceRepository: manifest.sourceRepository,
      sourceCommit: manifest.sourceCommit,
    });
  }
  return skills;
}

async function loadBundledAgentSkills(): Promise<{ skills: BundledAgentSkill[]; packRoots: string[] }> {
  if (bundledSkillCache && bundledSkillCache.expiresAt > Date.now()) {
    return bundledSkillCache;
  }
  const packDirectories: string[] = [];
  for (const root of getSkillPackRootCandidates()) {
    packDirectories.push(...await findPackDirectories(root));
  }
  const uniquePackDirectories = uniqueExistingDirectories(packDirectories);
  const skills: BundledAgentSkill[] = [];
  for (const packRoot of uniquePackDirectories) {
    try {
      skills.push(...await loadPackDirectory(packRoot));
    } catch (error) {
      logger.warn(`[AgentSkills] Failed to load pack ${packRoot}:`, error);
    }
  }
  const skillById = new Map<string, BundledAgentSkill>();
  for (const skill of skills) {
    if (!skillById.has(skill.id)) skillById.set(skill.id, skill);
  }
  bundledSkillCache = {
    expiresAt: Date.now() + PACK_CACHE_TTL_MS,
    skills: Array.from(skillById.values()),
    packRoots: uniquePackDirectories,
  };
  return bundledSkillCache;
}

function toUserAgentSkill(skill: UserSkill): UserAgentSkill {
  return {
    id: `user:${skill.id}`,
    rawId: skill.id,
    name: skill.name,
    description: skill.description || `用户配置的 /${skill.trigger} Skill`,
    category: 'user',
    aliases: [skill.trigger, `/${skill.trigger}`],
    sourceKind: 'user',
    sourceLabel: '用户配置',
    trigger: skill.trigger,
    prompt: skill.prompt,
  };
}

const JOURNAL_STYLE_SECTIONS = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];

async function loadJournalStyleAgentSkills(userId: string): Promise<UserAgentSkill[]> {
  const roots = [
    { dir: path.join(getUserUploadDir(userId), 'journal-styles'), sourceLabel: 'PDF 提取章节风格' },
    ...(userId === 'web-user'
      ? []
      : [{ dir: path.join(getUserUploadDir('web-user'), 'journal-styles'), sourceLabel: '共享章节风格' }]),
  ];
  const skills: UserAgentSkill[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    const entries = await fs.readdir(root.dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9_\-.]+$/.test(entry.name)) continue;
      const stylePath = path.join(root.dir, entry.name, 'style.json');
      try {
        const raw = await fs.readFile(stylePath, 'utf-8');
        const parsed = JSON.parse(raw) as unknown;
        const papers = Array.isArray(parsed) ? parsed : [];
        if (!papers.length) continue;
        const first = papers[0] && typeof papers[0] === 'object' ? papers[0] as Record<string, unknown> : {};
        const journalName = String(first.journal || entry.name.replace(/_/g, ' ')).trim();
        for (const section of JOURNAL_STYLE_SECTIONS) {
          const id = `journal-style:${entry.name}:${section}`;
          if (seen.has(id)) continue;
          seen.add(id);
          const sectionLabel = section === 'methods' ? '方法'
            : section === 'results' ? '结果'
            : section === 'discussion' ? '讨论'
            : section === 'introduction' ? '引言'
            : section === 'abstract' ? '摘要'
            : '结论';
          skills.push({
            id,
            rawId: id,
            name: `${journalName} ${sectionLabel}写作风格`,
            description: `在撰写${sectionLabel}章节时复用 ${journalName} 已提取的结构、措辞、论证节奏与语气特征。`,
            category: 'writing-style',
            aliases: [journalName, section, sectionLabel, `${journalName} ${sectionLabel}`],
            sourceKind: 'user',
            sourceLabel: root.sourceLabel,
            trigger: `style-${entry.name}-${section}`.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 80),
            prompt: [
              `你正在使用从 PDF 文献中提取的 ${journalName} ${sectionLabel}章节写作风格。`,
              `请只把这些材料作为结构、措辞、论证节奏与语气参考，不得复制原文，不得虚构数据或引用。`,
              `当前目标章节：${sectionLabel}（${section}）。`,
              '',
              '提取的风格数据：',
              raw.slice(0, MAX_SKILL_FILE_CHARS),
            ].join('\n'),
          });
        }
      } catch (error) {
        logger.warn(`[AgentSkills] Failed to load journal style ${stylePath}:`, error);
      }
    }
  }
  return skills;
}

async function loadInternalAgentSkills(userId: string): Promise<{ skills: InternalAgentSkill[]; packRoots: string[] }> {
  const bundled = await loadBundledAgentSkills();
  const disabledBundledSkillIds = await readDisabledBundledSkillIds(userId);
  const userSkills = (await listUserSkills(userId))
    .filter(skill => skill.enabled)
    .map(toUserAgentSkill);
  const journalStyleSkills = await loadJournalStyleAgentSkills(userId);
  return {
    skills: [
      ...bundled.skills.filter(skill => !disabledBundledSkillIds.has(skill.id)),
      ...userSkills,
      ...journalStyleSkills,
    ],
    packRoots: bundled.packRoots,
  };
}

function toDescriptor(skill: InternalAgentSkill, explicitlyActive: Set<string>): AgentSkillDescriptor {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    category: skill.category,
    aliases: skill.aliases,
    source: skill.sourceKind,
    sourceLabel: skill.sourceLabel,
    manualTrigger: skill.sourceKind === 'user' ? `/${skill.trigger}` : undefined,
    explicitlyActive: explicitlyActive.has(skill.id),
  };
}

function normalizeExplicitSkillIds(skillIds: Iterable<string>): Set<string> {
  const result = new Set<string>();
  for (const rawId of skillIds) {
    const id = String(rawId || '').trim();
    if (!id) continue;
    result.add(id.startsWith('user:') || id.includes(':') ? id : `user:${id}`);
  }
  return result;
}

function toCatalogLineText(value: unknown): string {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

function tokenizeSkillCatalogText(value: unknown): Set<string> {
  const text = toCatalogLineText(value).normalize('NFKC').toLowerCase();
  const tokens = new Set<string>();
  for (const match of text.matchAll(/[a-z0-9][a-z0-9._-]{1,}/g)) {
    tokens.add(match[0]);
  }
  for (const match of text.matchAll(/[\u3400-\u9fff]{2,}/g)) {
    const chunk = match[0];
    if (chunk.length <= 4) tokens.add(chunk);
    for (let index = 0; index < chunk.length - 1; index += 1) {
      tokens.add(chunk.slice(index, index + 2));
    }
  }
  return tokens;
}

function rankSkillCatalogDescriptors(
  descriptors: AgentSkillDescriptor[],
  query: string,
): AgentSkillDescriptor[] {
  const queryText = toCatalogLineText(query).normalize('NFKC').toLowerCase();
  if (!queryText) return [...descriptors];
  const queryTokens = tokenizeSkillCatalogText(queryText);
  return descriptors
    .map((skill, originalIndex) => {
      const searchable = [
        skill.id,
        skill.name,
        skill.description,
        skill.category,
        ...skill.aliases,
        skill.manualTrigger || '',
      ].join(' ').normalize('NFKC').toLowerCase();
      const skillTokens = tokenizeSkillCatalogText(searchable);
      let overlap = 0;
      for (const token of queryTokens) {
        if (skillTokens.has(token)) overlap += token.length >= 4 ? 4 : 1;
      }
      const exactName = skill.name && queryText.includes(skill.name.toLowerCase()) ? 60 : 0;
      const explicit = skill.explicitlyActive ? 10_000 : 0;
      const userPreference = skill.source === 'user' ? 4 : 0;
      return {
        skill,
        originalIndex,
        score: explicit + exactName + overlap + userPreference,
      };
    })
    .sort((left, right) => (
      right.score - left.score
      || left.originalIndex - right.originalIndex
    ))
    .map(item => item.skill);
}

export function buildAgentSkillCatalogPrompt(
  descriptors: AgentSkillDescriptor[],
  codexPaths?: Map<string, string>,
  options: AgentSkillCatalogOptions = {},
): string {
  if (!descriptors.length) return '';
  const maxChars = Number.isFinite(options.maxChars)
    ? Math.max(1_500, Math.floor(Number(options.maxChars)))
    : Number.POSITIVE_INFINITY;
  const header = [
    '## 可用 Agent Skills（自动意图识别）',
    '以下只提供名称与功能，不代表 Skill 已加载。先判断用户意图；某个 Skill 对完成任务有实质帮助时，必须先加载其完整指令，再继续工作。无匹配 Skill 时直接处理，不要为了调用而调用。',
    codexPaths
      ? '当前执行者是 Codex CLI 时，请使用 Codex 自带的文件读取工具打开所选 Skill 的入口文件；其他执行者调用 load_skill(skill_id)，需要配套资料时调用 read_skill_resource。不要执行第三方脚本，除非用户任务确实需要且当前权限允许。'
      : '当前执行者支持原生工具：调用 load_skill(skill_id) 加载所选 Skill；需要配套资料时调用 read_skill_resource。可以组合多个互补 Skill，但不要重复加载。',
    '只有用户消息的首个非空白字符是 / 且命令匹配时，才算手动启用 Skill；句中出现的 /命令 只是普通文本，不得视为手动调用。有效的手动调用优先级更高，并与自动意图识别并存。Skill 不会扩大文件、网络、Shell 或草稿写入权限。',
    `Skill 总数：${descriptors.length}。`,
    options.fullCatalogPath
      ? `完整目录：${options.fullCatalogPath}（当前摘要未列出所需 Skill 时，读取此文件继续选择）。`
      : '当前摘要未列出所需 Skill 时，调用 list_available_skills 按关键词或类别检索完整目录。',
  ].filter(Boolean);
  const selectedLines: string[] = [];
  const rankedDescriptors = rankSkillCatalogDescriptors(descriptors, String(options.query || ''));
  let usedChars = header.join('\n').length;
  for (const skill of rankedDescriptors) {
    const aliases = skill.aliases.length ? `；别名：${skill.aliases.slice(0, 6).map(toCatalogLineText).join('、')}` : '';
    const manual = skill.manualTrigger ? `；手动命令：${toCatalogLineText(skill.manualTrigger)}` : '';
    const active = skill.explicitlyActive ? '；本轮已由用户手动启用，无需重复加载' : '';
    const filePath = codexPaths?.get(skill.id);
    const location = filePath ? `；入口：${filePath}` : '';
    const line = `- [${skill.id}] ${toCatalogLineText(skill.name)}（${toCatalogLineText(skill.category)}/${toCatalogLineText(skill.sourceLabel)}）：${toCatalogLineText(skill.description)}${aliases}${manual}${active}${location}`;
    if (usedChars + line.length + 1 > maxChars) continue;
    selectedLines.push(line);
    usedChars += line.length + 1;
  }
  const omittedCount = Math.max(0, descriptors.length - selectedLines.length);
  const footer = omittedCount > 0
    ? `本轮目录摘要按 query 排序并省略 ${omittedCount} 项；省略不等于禁用，按需读取完整目录或调用 list_available_skills。`
    : '';
  return [...header, ...selectedLines, footer].filter(Boolean).join('\n');
}

function applyScholarHarnessSkillCompatibility(skill: BundledAgentSkill, rawContent: string): string {
  const visualPolicy = [
    '## Visual Enhancement Policy (Scholar Harness)',
    '',
    'Visual generation is optional. Follow the user request, target-journal rules, existing figure plan, and confirmed plotting workflow. Do not generate a graphical abstract or additional AI image unless it is actually required.',
    '',
  ].join('\n');
  let content = rawContent.replace(
    /\n## Visual Enhancement with Scientific Schematics[\s\S]*?(?=\n##\s+)/i,
    `\n${visualPolicy}`,
  );
  if (skill.rawId === 'scientific-writing') {
    content = content.replace(
      /\*\*⚠️ MANDATORY:[\s\S]*?(?=\n##\s+Core Capabilities)/i,
      'Visuals are optional and governed by the Scholar Harness policy overlay.\n\n',
    );
  }
  return content;
}

async function listResourcePaths(root: string): Promise<string[]> {
  const paths: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    if (paths.length >= MAX_RESOURCE_LIST_ITEMS) return;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (paths.length >= MAX_RESOURCE_LIST_ITEMS) return;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase() !== 'skill.md') {
        paths.push(path.relative(root, fullPath).split(path.sep).join('/'));
      }
    }
  };
  await visit(root);
  return paths;
}

function parseToolArguments(rawArguments: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    throw new Error('工具参数不是有效 JSON');
  }
}

function getSearchTerms(query: string): string[] {
  const normalized = query.toLowerCase();
  return Array.from(new Set([
    ...(normalized.match(/[a-z0-9_.-]{2,}/g) || []),
    ...(normalized.match(/[\u4e00-\u9fa5]{2,}/g) || []),
  ])).slice(0, 24);
}

function skillSearchScore(skill: InternalAgentSkill, terms: string[]): number {
  if (!terms.length) return 1;
  const name = skill.name.toLowerCase();
  const description = skill.description.toLowerCase();
  const aliases = skill.aliases.join(' ').toLowerCase();
  return terms.reduce((score, term) => (
    score
    + (name.includes(term) ? 10 : 0)
    + (aliases.includes(term) ? 7 : 0)
    + (description.includes(term) ? 4 : 0)
  ), 0);
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, filePath);
}

function safeUserSkillFileName(skill: UserAgentSkill): string {
  const name = normalizeSkillIdPart(skill.name).slice(0, 60) || 'skill';
  return `${name}-${crypto.createHash('sha1').update(skill.id).digest('hex').slice(0, 8)}.md`;
}

export class AgentSkillRuntime {
  private readonly skillById: Map<string, InternalAgentSkill>;
  private readonly descriptors: AgentSkillDescriptor[];
  private readonly explicitSkillIds: Set<string>;
  private readonly loadedSkillIds = new Set<string>();

  constructor(
    private readonly userId: string,
    skills: InternalAgentSkill[],
    private readonly packRoots: string[],
    explicitSkillIds: Iterable<string>,
  ) {
    this.explicitSkillIds = normalizeExplicitSkillIds(explicitSkillIds);
    this.skillById = new Map(skills.map(skill => [skill.id, skill]));
    this.descriptors = skills.map(skill => toDescriptor(skill, this.explicitSkillIds));
  }

  getCatalog(): AgentSkillDescriptor[] {
    return this.descriptors.map(skill => ({ ...skill, aliases: [...skill.aliases] }));
  }

  getCatalogPrompt(options: AgentSkillCatalogOptions = {}): string {
    return buildAgentSkillCatalogPrompt(this.descriptors, undefined, options);
  }

  getActiveCompletionContracts(): AgentSkillCompletionContract[] {
    const activeSkillIds = new Set([...this.explicitSkillIds, ...this.loadedSkillIds]);
    const contracts = Array.from(activeSkillIds)
      .map(skillId => this.skillById.get(skillId))
      .filter((skill): skill is UserAgentSkill => Boolean(skill && skill.sourceKind === 'user'))
      .flatMap(skill => parseCompletionContracts(skill));
    return Array.from(
      new Map(contracts.map(contract => [`${contract.skillId}:${contract.id}`, contract])).values(),
    );
  }

  getToolDefinitions(): LLMToolDefinition[] {
    if (!this.descriptors.length) return [];
    return [
      {
        type: 'function',
        function: {
          name: 'load_skill',
          description: '按 skill_id 加载一个可用 Skill 的完整指令。先根据系统提供的 Skill 目录判断意图，匹配时必须调用本工具后再应用 Skill。',
          parameters: {
            type: 'object',
            properties: {
              skill_id: { type: 'string', description: 'Skill 目录中的精确 id，例如 open-science-academic:peer-review。' },
              reason: { type: 'string', description: '简要说明当前任务为什么需要这个 Skill。' },
            },
            required: ['skill_id'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'read_skill_resource',
          description: '读取已加载内置 Skill 的配套 references、assets、scripts 或示例文件。只读取文本，不会执行脚本。',
          parameters: {
            type: 'object',
            properties: {
              skill_id: { type: 'string', description: '已加载 Skill 的精确 id。' },
              resource_path: { type: 'string', description: 'load_skill 返回的相对资源路径。' },
              start_line: { type: 'number', description: '起始行号，默认 1。' },
              max_lines: { type: 'number', description: '最多读取行数，默认 240，最大 800。' },
            },
            required: ['skill_id', 'resource_path'],
          },
        },
      },
      {
        type: 'function',
        function: {
          name: 'list_available_skills',
          description: '按关键词或类别重新筛选可用 Skill。系统提示已给出完整目录；仅在需要缩小候选时调用。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '可选：任务、能力或 Skill 名称关键词。' },
              category: { type: 'string', description: '可选：writing、research、visualization、configuration、user。' },
              limit: { type: 'number', description: '最多返回数量，默认 20，最大 50。' },
            },
            required: [],
          },
        },
      },
    ];
  }

  async executeToolCall(call: LLMToolCall): Promise<AgentSkillToolResult> {
    const toolName = call.function.name;
    try {
      const args = parseToolArguments(call.function.arguments);
      if (toolName === 'load_skill') return await this.loadSkill(args);
      if (toolName === 'read_skill_resource') {
        const skill = this.resolveSkill(args.skill_id);
        let autoLoaded: AgentSkillToolResult | null = null;
        if (!this.loadedSkillIds.has(skill.id) && !this.explicitSkillIds.has(skill.id)) {
          autoLoaded = await this.loadSkill({
            skill_id: skill.id,
            reason: '读取 Skill 配套资源前自动补充加载完整 Skill 指令',
          });
          if (!autoLoaded.ok) return autoLoaded;
        }
        const resource = await this.readSkillResource(args);
        if (!autoLoaded || !resource.ok) return resource;
        return {
          ...resource,
          summary: `已自动加载 Skill 并读取资源：${skill.name}`,
          content: [autoLoaded.content, resource.content].filter(Boolean).join('\n\n'),
          data: {
            ...(resource.data || {}),
            skillId: skill.id,
            autoLoaded: true,
          },
        };
      }
      if (toolName === 'list_available_skills') return this.listAvailableSkills(args);
      throw new Error(`未知 Skill 工具: ${toolName}`);
    } catch (error) {
      const message = (error as Error).message || String(error);
      logger.warn(`[AgentSkills] ${toolName} failed: ${message}`);
      return {
        ok: false,
        toolName,
        summary: `${toolName} 执行失败`,
        content: message,
        error: message,
      };
    }
  }

  async prepareCodexContext(options: AgentSkillCatalogOptions = {}): Promise<CodexAgentSkillContext> {
    const codexRoot = path.join(getDataDir(), 'agent-skills', sanitizeUserId(this.userId), 'codex');
    await fs.mkdir(codexRoot, { recursive: true });
    const codexPaths = new Map<string, string>();
    const activeUserFiles = new Set<string>();

    for (const skill of this.skillById.values()) {
      if (skill.sourceKind === 'bundled') {
        codexPaths.set(skill.id, skill.entryPath);
        continue;
      }
      const filename = safeUserSkillFileName(skill);
      activeUserFiles.add(filename.toLowerCase());
      const filePath = path.join(codexRoot, filename);
      const content = [
        `# ${skill.name}`,
        '',
        `Source: Scholar Harness user Skill /${skill.trigger}`,
        '',
        skill.prompt,
        '',
      ].join('\n');
      await writeAtomic(filePath, content);
      codexPaths.set(skill.id, filePath);
    }

    const existingFiles = await fs.readdir(codexRoot, { withFileTypes: true });
    for (const entry of existingFiles) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      if (entry.name.toLowerCase() === 'catalog.md' || activeUserFiles.has(entry.name.toLowerCase())) continue;
      await fs.unlink(path.join(codexRoot, entry.name)).catch(() => undefined);
    }

    const catalogPath = path.join(codexRoot, 'CATALOG.md');
    const completeCatalogPrompt = buildAgentSkillCatalogPrompt(this.descriptors, codexPaths, {
      fullCatalogPath: catalogPath,
    });
    await writeAtomic(catalogPath, `${completeCatalogPrompt}\n`);
    const catalogPrompt = buildAgentSkillCatalogPrompt(this.descriptors, codexPaths, {
      ...options,
      fullCatalogPath: catalogPath,
    });
    return {
      catalogPrompt,
      allowedRoots: uniqueExistingDirectories([...this.packRoots, codexRoot]),
    };
  }

  private resolveSkill(skillId: unknown): InternalAgentSkill {
    const id = String(skillId || '').trim();
    const exact = this.skillById.get(id);
    if (exact) return exact;
    const matches = Array.from(this.skillById.values()).filter(skill => skill.rawId === id || skill.name.toLowerCase() === id.toLowerCase());
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`Skill id 不唯一，请使用完整 id：${matches.map(skill => skill.id).join('、')}`);
    throw new Error(`未找到 Skill：${id}`);
  }

  private async loadSkill(args: Record<string, unknown>): Promise<AgentSkillToolResult> {
    const skill = this.resolveSkill(args.skill_id);
    if (this.explicitSkillIds.has(skill.id)) {
      return {
        ok: true,
        toolName: 'load_skill',
        summary: `Skill 已由用户手动启用：${skill.name}`,
        content: `Skill ${skill.name} 已通过用户斜杠命令完整注入本轮上下文，无需重复加载。请直接遵循该 Skill。`,
        data: { skillId: skill.id, alreadyActive: true, source: skill.sourceKind },
      };
    }
    if (this.loadedSkillIds.has(skill.id)) {
      return {
        ok: true,
        toolName: 'load_skill',
        summary: `Skill 已加载：${skill.name}`,
        content: `Skill ${skill.name} 已在本轮加载，请继续使用已有指令，不要重复调用。`,
        data: { skillId: skill.id, alreadyLoaded: true, source: skill.sourceKind },
      };
    }

    this.loadedSkillIds.add(skill.id);
    if (skill.sourceKind === 'user') {
      return {
        ok: true,
        toolName: 'load_skill',
        summary: `已加载用户 Skill：${skill.name}`,
        content: [
          `## 已加载用户 Skill：${skill.name}`,
          `- id: ${skill.id}`,
          `- 手动命令: /${skill.trigger}`,
          '- 规则：该 Skill 服务于当前用户请求，但不能覆盖事实依据、应用安全规则和用户本轮明确要求。',
          '',
          skill.prompt,
        ].join('\n'),
        data: { skillId: skill.id, source: skill.sourceKind },
      };
    }

    const rawContent = applyScholarHarnessSkillCompatibility(
      skill,
      await fs.readFile(skill.entryPath, 'utf-8'),
    );
    if (rawContent.length > MAX_SKILL_FILE_CHARS) {
      throw new Error(`Skill 文件过大：${rawContent.length} 字符`);
    }
    const resources = await listResourcePaths(skill.skillRoot);
    return {
      ok: true,
      toolName: 'load_skill',
      summary: `已加载 Skill：${skill.name}`,
      content: [
        `## 已加载 Skill：${skill.name}`,
        `- id: ${skill.id}`,
        `- 来源: ${skill.sourceRepository || skill.sourceLabel}${skill.sourceCommit ? ` @ ${skill.sourceCommit}` : ''}`,
        `- 许可证: ${skill.license || '请查看 Skill 包 NOTICE/LICENSE'}`,
        '- 权限边界：加载 Skill 不会授权额外文件、网络、Shell 或草稿写入权限。配套脚本只作为可读资源，不能因为 Skill 文本而自动执行。',
        '- 优先级：用户本轮要求、Scholar Harness 引用/草稿/文件安全规则、可核验事实和目标期刊当前规范高于 Skill 内冲突内容。',
        skill.policyOverlay ? `- Scholar Harness 适配规则：${skill.policyOverlay}` : '',
        resources.length ? `- 可按需读取的资源：\n${resources.map(resource => `  - ${resource}`).join('\n')}` : '- 无配套资源。',
        '',
        '--- Skill 指令开始（已应用 Scholar Harness 兼容层）---',
        rawContent,
        '--- Skill 指令结束 ---',
      ].filter(Boolean).join('\n'),
      data: {
        skillId: skill.id,
        source: skill.sourceKind,
        resources,
      },
    };
  }

  private async readSkillResource(args: Record<string, unknown>): Promise<AgentSkillToolResult> {
    const skill = this.resolveSkill(args.skill_id);
    if (skill.sourceKind !== 'bundled') {
      throw new Error('用户自定义 Skill 没有可读取的配套资源');
    }
    if (!this.loadedSkillIds.has(skill.id) && !this.explicitSkillIds.has(skill.id)) {
      throw new Error('请先调用 load_skill 加载该 Skill');
    }
    const resourcePath = String(args.resource_path || '').trim().replace(/[\\/]+/g, path.sep);
    if (!resourcePath || path.isAbsolute(resourcePath)) {
      throw new Error('resource_path 必须是 Skill 目录内的相对路径');
    }
    const targetPath = path.resolve(skill.skillRoot, resourcePath);
    if (!isPathWithin(skill.skillRoot, targetPath)) {
      throw new Error('资源路径超出 Skill 目录');
    }
    const extension = path.extname(targetPath).toLowerCase();
    if (!SKILL_RESOURCE_EXTENSIONS.has(extension)) {
      throw new Error(`不支持读取该资源类型：${extension || '(无扩展名)'}`);
    }
    const rawContent = await fs.readFile(targetPath, 'utf-8');
    if (rawContent.length > MAX_RESOURCE_FILE_CHARS) {
      throw new Error(`资源文件过大：${rawContent.length} 字符`);
    }
    const lines = rawContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const startLine = Math.max(1, Math.floor(Number(args.start_line || 1)));
    const maxLines = Math.min(800, Math.max(1, Math.floor(Number(args.max_lines || 240))));
    const selected = lines.slice(startLine - 1, startLine - 1 + maxLines);
    const nextStartLine = startLine - 1 + selected.length < lines.length ? startLine + selected.length : null;
    return {
      ok: true,
      toolName: 'read_skill_resource',
      summary: `读取 Skill 资源：${skill.name}/${resourcePath}`,
      content: [
        `Skill resource: ${skill.id}/${resourcePath}`,
        `Lines: ${startLine}-${startLine + Math.max(0, selected.length - 1)} / ${lines.length}`,
        nextStartLine ? `Next start_line: ${nextStartLine}` : 'End of file',
        '',
        selected.join('\n'),
      ].join('\n'),
      data: { skillId: skill.id, resourcePath, startLine, nextStartLine, totalLines: lines.length },
    };
  }

  private listAvailableSkills(args: Record<string, unknown>): AgentSkillToolResult {
    const query = String(args.query || '').trim();
    const category = String(args.category || '').trim().toLowerCase();
    const limit = Math.min(50, Math.max(1, Math.floor(Number(args.limit || 20))));
    const terms = getSearchTerms(query);
    const skills = Array.from(this.skillById.values())
      .filter(skill => !category || skill.category.toLowerCase() === category)
      .map(skill => ({ skill, score: skillSearchScore(skill, terms) }))
      .filter(item => !terms.length || item.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .slice(0, limit)
      .map(item => toDescriptor(item.skill, this.explicitSkillIds));
    return {
      ok: true,
      toolName: 'list_available_skills',
      summary: `找到 ${skills.length} 个可用 Skill`,
      content: skills.length
        ? skills.map(skill => `- [${skill.id}] ${skill.name}：${skill.description}${skill.explicitlyActive ? '（已手动启用）' : ''}`).join('\n')
        : '没有匹配的可用 Skill。',
      data: { skills },
    };
  }
}

export async function createAgentSkillRuntime(
  userId: string,
  explicitSkillIds: Iterable<string> = [],
): Promise<AgentSkillRuntime> {
  const loaded = await loadInternalAgentSkills(userId);
  return new AgentSkillRuntime(userId, loaded.skills, loaded.packRoots, explicitSkillIds);
}

export async function listAvailableAgentSkills(
  userId: string,
  explicitSkillIds: Iterable<string> = [],
): Promise<AgentSkillDescriptor[]> {
  return (await createAgentSkillRuntime(userId, explicitSkillIds)).getCatalog();
}

export async function deleteBundledAgentSkill(
  userId: string,
  skillId: string,
): Promise<{ id: string; name: string }> {
  const normalizedId = String(skillId || '').trim();
  const bundled = await loadBundledAgentSkills();
  const skill = bundled.skills.find(item => item.id === normalizedId);
  if (!skill) {
    throw new Error(`未找到可删除的内置 Skill：${normalizedId}`);
  }
  const disabledIds = await readDisabledBundledSkillIds(userId);
  disabledIds.add(skill.id);
  await writeDisabledBundledSkillIds(userId, disabledIds);
  return { id: skill.id, name: skill.name };
}

export function formatAgentSkillToolResult(result: AgentSkillToolResult): string {
  return JSON.stringify({
    ok: result.ok,
    summary: result.summary,
    content: result.content,
    error: result.error,
    data: result.data,
  });
}

export function clearAgentSkillRegistryCache(): void {
  bundledSkillCache = null;
}
