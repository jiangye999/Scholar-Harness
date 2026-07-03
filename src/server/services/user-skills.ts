import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { z } from 'zod';
import { getDataDir, sanitizeUserId } from '../../utils/paths';
import { logger } from '../../utils/logger';

const USER_SKILL_TRIGGER_RE = /^[a-zA-Z0-9_\-\u4e00-\u9fa5]{1,32}$/u;
const USER_SKILL_COMMAND_RE = /(^|[\s\n])\/([a-zA-Z0-9_\-\u4e00-\u9fa5]{1,32})(?=$|[\s\n，。,.!?！？;；:：])/gu;
const GITHUB_FETCH_TIMEOUT_MS = 15000;
const MAX_IMPORTED_SKILL_BYTES = 512 * 1024;
const USER_SKILL_TEXT_FILE_RE = /\.(md|markdown|txt)$/i;

export const userSkillInputSchema = z.object({
  name: z.string().trim().min(1, 'Skill 名称不能为空').max(80, 'Skill 名称过长'),
  trigger: z.string().trim().min(1, '斜杠命令不能为空').max(40, '斜杠命令过长'),
  description: z.string().trim().max(1000, '说明过长').optional().default(''),
  prompt: z.string().trim().min(1, 'Skill 指令不能为空').max(20000, 'Skill 指令过长'),
  enabled: z.boolean().optional().default(true),
});

export const userSkillUpdateSchema = userSkillInputSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  '没有需要更新的字段',
);

export const userSkillImportUrlSchema = z.object({
  url: z.string().trim().min(1, '请填写 GitHub Skill 链接').max(2048, '链接过长'),
});

export type UserSkillInput = z.infer<typeof userSkillInputSchema>;
export type UserSkillUpdateInput = z.infer<typeof userSkillUpdateSchema>;
export type UserSkillImportUrlInput = z.infer<typeof userSkillImportUrlSchema>;

export interface UserSkill {
  id: string;
  name: string;
  trigger: string;
  description: string;
  prompt: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserSkillInvocation {
  originalMessage: string;
  cleanMessage: string;
  promptBlock: string;
  invokedSkills: Array<Pick<UserSkill, 'id' | 'name' | 'trigger' | 'description'>>;
}

export interface UserSkillUrlImportResult {
  skill: UserSkill;
  source: {
    inputUrl: string;
    resolvedUrl: string;
    filename: string;
    githubPath?: string;
  };
}

interface GitHubTarget {
  kind: 'raw' | 'blob' | 'tree' | 'repo';
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
  rawUrl?: string;
}

interface GitHubRepoInfo {
  default_branch?: string;
}

interface GitHubTreeResponse {
  tree?: Array<{
    path?: string;
    type?: string;
    url?: string;
  }>;
}

function getUserSkillDir(userId: string): string {
  return path.join(getDataDir(), 'user-skills', sanitizeUserId(userId));
}

function getUserSkillPath(userId: string): string {
  return path.join(getUserSkillDir(userId), 'skills.json');
}

function normalizeTrigger(value: string): string {
  const trigger = String(value || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '');
  if (!USER_SKILL_TRIGGER_RE.test(trigger)) {
    throw new Error('斜杠命令只能包含 1-32 位中文、英文、数字、下划线或短横线');
  }
  return trigger;
}

function normalizeSkillRecord(input: UserSkill): UserSkill {
  return {
    id: String(input.id || crypto.randomUUID()),
    name: String(input.name || '').trim().slice(0, 80),
    trigger: normalizeTrigger(input.trigger),
    description: String(input.description || '').trim().slice(0, 1000),
    prompt: String(input.prompt || '').trim().slice(0, 20000),
    enabled: input.enabled !== false,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt || input.createdAt || new Date().toISOString(),
  };
}

async function ensureUserSkillDir(userId: string): Promise<void> {
  await fs.mkdir(getUserSkillDir(userId), { recursive: true });
}

async function readUserSkillFile(userId: string): Promise<UserSkill[]> {
  const filePath = getUserSkillPath(userId);
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const skills = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && Array.isArray((parsed as { skills?: unknown }).skills)
        ? (parsed as { skills: unknown[] }).skills
        : []);
    return skills
      .map((item) => normalizeSkillRecord(item as UserSkill))
      .filter((skill) => skill.name && skill.prompt);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    logger.warn(`[UserSkills] Failed to read skill file for ${sanitizeUserId(userId)}:`, error);
    return [];
  }
}

async function writeUserSkillFile(userId: string, skills: UserSkill[]): Promise<void> {
  await ensureUserSkillDir(userId);
  const filePath = getUserSkillPath(userId);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = JSON.stringify({
    version: 1,
    updatedAt: new Date().toISOString(),
    skills,
  }, null, 2);
  await fs.writeFile(tmpPath, payload, 'utf-8');
  await fs.rename(tmpPath, filePath);
}

function triggerKey(trigger: string): string {
  return normalizeTrigger(trigger).toLowerCase();
}

function ensureTriggerAvailable(skills: UserSkill[], trigger: string, selfId?: string): void {
  const key = triggerKey(trigger);
  const duplicated = skills.find((skill) => skill.id !== selfId && triggerKey(skill.trigger) === key);
  if (duplicated) {
    throw new Error(`斜杠命令 /${trigger} 已被 Skill「${duplicated.name}」占用`);
  }
}

function makeTriggerFromText(value: string): string {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.(md|markdown|txt)$/i, '')
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-zA-Z0-9_\-\u4e00-\u9fa5]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return cleaned || 'skill';
}

function resolveUniqueTrigger(skills: UserSkill[], baseTrigger: string): string {
  const base = makeTriggerFromText(baseTrigger);
  const used = new Set(skills.map((skill) => triggerKey(skill.trigger)));
  if (!used.has(base.toLowerCase())) {
    return base;
  }
  const root = (base.slice(0, 28).replace(/-+$/g, '') || 'skill');
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${root}-${index}`.slice(0, 32);
    if (!used.has(candidate.toLowerCase())) {
      return candidate;
    }
  }
  return `${root}-${Date.now().toString(36)}`.slice(0, 32);
}

function inferSkillNameFromContent(filename: string, content: string): string {
  const headingMatch = String(content || '').match(/^\s*#\s+(.+)$/m);
  const heading = headingMatch?.[1]?.trim().replace(/\s+#*$/, '');
  const stem = String(filename || 'skill').replace(/\.(md|markdown|txt)$/i, '').trim();
  return (heading || stem || '用户 Skill').slice(0, 80);
}

function parseGitHubTarget(inputUrl: string): GitHubTarget {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    throw new Error('链接格式不正确，请粘贴 GitHub 文件、目录或仓库链接');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('只支持 https GitHub 链接');
  }

  const host = parsed.hostname.toLowerCase();
  const parts = parsed.pathname.split('/').filter(Boolean);

  if (host === 'raw.githubusercontent.com') {
    const [owner, repo, branch, ...pathParts] = parts;
    if (!owner || !repo || !branch || pathParts.length === 0) {
      throw new Error('raw.githubusercontent.com 链接缺少仓库或文件路径');
    }
    const filePath = pathParts.join('/');
    if (!USER_SKILL_TEXT_FILE_RE.test(filePath)) {
      throw new Error('只支持导入 .md、.markdown 或 .txt Skill 文件');
    }
    return {
      kind: 'raw',
      owner,
      repo,
      branch,
      path: filePath,
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
    };
  }

  if (host !== 'github.com') {
    throw new Error('只支持 github.com 或 raw.githubusercontent.com 链接');
  }

  const [owner, repo, mode, branch, ...pathParts] = parts;
  if (!owner || !repo) {
    throw new Error('GitHub 链接缺少 owner/repo');
  }

  if (mode === 'blob') {
    const filePath = pathParts.join('/');
    if (!branch || !filePath) {
      throw new Error('GitHub 文件链接缺少分支或文件路径');
    }
    if (!USER_SKILL_TEXT_FILE_RE.test(filePath)) {
      throw new Error('只支持导入 .md、.markdown 或 .txt Skill 文件');
    }
    return {
      kind: 'blob',
      owner,
      repo,
      branch,
      path: filePath,
      rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`,
    };
  }

  if (mode === 'tree') {
    return {
      kind: 'tree',
      owner,
      repo,
      branch,
      path: pathParts.join('/'),
    };
  }

  return {
    kind: 'repo',
    owner,
    repo,
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Scholar-Harness-User-Skill-Importer',
        'Accept': 'application/vnd.github+json, text/plain, */*',
        ...(init?.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`下载失败：GitHub 返回 ${response.status}`);
  }
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > MAX_IMPORTED_SKILL_BYTES) {
    throw new Error('Skill 文件过大，请控制在 512KB 以内');
  }
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf-8') > MAX_IMPORTED_SKILL_BYTES) {
    throw new Error('Skill 文件过大，请控制在 512KB 以内');
  }
  return text;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetchWithTimeout(url);
  if (!response.ok) {
    throw new Error(`GitHub API 请求失败：${response.status}`);
  }
  return await response.json() as T;
}

async function resolveDefaultBranch(owner: string, repo: string, preferredBranch?: string): Promise<string> {
  if (preferredBranch) {
    return preferredBranch;
  }
  const repoInfo = await fetchJson<GitHubRepoInfo>(`https://api.github.com/repos/${owner}/${repo}`);
  return repoInfo.default_branch || 'main';
}

function pickSkillPathFromTree(tree: GitHubTreeResponse, prefix = ''): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const blobs = (tree.tree || [])
    .filter((item) => item.type === 'blob' && item.path)
    .map((item) => item.path || '')
    .filter((itemPath) => !normalizedPrefix || itemPath === normalizedPrefix || itemPath.startsWith(`${normalizedPrefix}/`));

  if (blobs.length === 0) {
    throw new Error('该 GitHub 链接下没有可导入的 Skill 文件');
  }

  const skillMd = blobs
    .filter((itemPath) => /(^|\/)SKILL\.md$/i.test(itemPath))
    .sort((a, b) => a.length - b.length);
  if (skillMd.length > 0) {
    return skillMd[0];
  }

  const textFiles = blobs
    .filter((itemPath) => USER_SKILL_TEXT_FILE_RE.test(itemPath))
    .sort((a, b) => a.length - b.length);
  if (textFiles.length === 1) {
    return textFiles[0];
  }

  if (textFiles.length > 1) {
    throw new Error('该目录下有多个 .md/.txt 文件，请粘贴具体的 SKILL.md 文件链接');
  }

  throw new Error('该 GitHub 链接下没有 .md、.markdown 或 .txt Skill 文件');
}

async function resolveGitHubSkillFile(inputUrl: string): Promise<{ rawUrl: string; filename: string; path: string }> {
  const target = parseGitHubTarget(inputUrl);
  if (target.rawUrl && target.path) {
    return {
      rawUrl: target.rawUrl,
      filename: path.posix.basename(target.path),
      path: target.path,
    };
  }

  const branch = await resolveDefaultBranch(target.owner, target.repo, target.branch);
  const tree = await fetchJson<GitHubTreeResponse>(
    `https://api.github.com/repos/${target.owner}/${target.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
  );
  const filePath = pickSkillPathFromTree(tree, target.path || '');
  return {
    rawUrl: `https://raw.githubusercontent.com/${target.owner}/${target.repo}/${branch}/${filePath}`,
    filename: path.posix.basename(filePath),
    path: filePath,
  };
}

export async function listUserSkills(userId: string): Promise<UserSkill[]> {
  const skills = await readUserSkillFile(userId);
  return skills.sort((a, b) => {
    const at = Date.parse(a.updatedAt || a.createdAt || '') || 0;
    const bt = Date.parse(b.updatedAt || b.createdAt || '') || 0;
    return bt - at;
  });
}

export async function createUserSkill(userId: string, input: UserSkillInput): Promise<UserSkill> {
  const parsed = userSkillInputSchema.parse(input);
  const skills = await readUserSkillFile(userId);
  const trigger = normalizeTrigger(parsed.trigger);
  ensureTriggerAvailable(skills, trigger);
  const now = new Date().toISOString();
  const skill: UserSkill = {
    id: crypto.randomUUID(),
    name: parsed.name.trim(),
    trigger,
    description: parsed.description || '',
    prompt: parsed.prompt.trim(),
    enabled: parsed.enabled !== false,
    createdAt: now,
    updatedAt: now,
  };
  await writeUserSkillFile(userId, [skill, ...skills]);
  return skill;
}

export async function importUserSkillFromGitHubUrl(
  userId: string,
  input: UserSkillImportUrlInput,
): Promise<UserSkillUrlImportResult> {
  const parsed = userSkillImportUrlSchema.parse(input);
  const resolved = await resolveGitHubSkillFile(parsed.url);
  const content = (await fetchText(resolved.rawUrl)).trim();
  if (!content) {
    throw new Error('下载到的 Skill 文件内容为空');
  }

  const skills = await readUserSkillFile(userId);
  const name = inferSkillNameFromContent(resolved.filename, content);
  const trigger = resolveUniqueTrigger(skills, name || resolved.filename);
  const now = new Date().toISOString();
  const skill: UserSkill = {
    id: crypto.randomUUID(),
    name,
    trigger,
    description: `从 GitHub 导入：${resolved.path}`,
    prompt: content.slice(0, 20000),
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };

  await writeUserSkillFile(userId, [skill, ...skills]);
  return {
    skill,
    source: {
      inputUrl: parsed.url,
      resolvedUrl: resolved.rawUrl,
      filename: resolved.filename,
      githubPath: resolved.path,
    },
  };
}

export async function updateUserSkill(userId: string, skillId: string, input: UserSkillUpdateInput): Promise<UserSkill> {
  const parsed = userSkillUpdateSchema.parse(input);
  const skills = await readUserSkillFile(userId);
  const index = skills.findIndex((skill) => skill.id === skillId);
  if (index < 0) {
    throw new Error('未找到该 Skill');
  }
  const current = skills[index];
  const nextTrigger = parsed.trigger !== undefined ? normalizeTrigger(parsed.trigger) : current.trigger;
  ensureTriggerAvailable(skills, nextTrigger, current.id);
  const updated: UserSkill = normalizeSkillRecord({
    ...current,
    ...parsed,
    trigger: nextTrigger,
    updatedAt: new Date().toISOString(),
  });
  skills[index] = updated;
  await writeUserSkillFile(userId, skills);
  return updated;
}

export async function deleteUserSkill(userId: string, skillId: string): Promise<boolean> {
  const skills = await readUserSkillFile(userId);
  const next = skills.filter((skill) => skill.id !== skillId);
  if (next.length === skills.length) {
    return false;
  }
  await writeUserSkillFile(userId, next);
  return true;
}

export async function parseUserSkillInvocation(userId: string, message: string): Promise<UserSkillInvocation> {
  const originalMessage = String(message || '');
  const skills = (await listUserSkills(userId)).filter((skill) => skill.enabled);
  if (!originalMessage || skills.length === 0) {
    return {
      originalMessage,
      cleanMessage: originalMessage,
      promptBlock: '',
      invokedSkills: [],
    };
  }

  const skillByTrigger = new Map<string, UserSkill>();
  for (const skill of skills) {
    skillByTrigger.set(triggerKey(skill.trigger), skill);
  }

  const invoked = new Map<string, UserSkill>();
  let cleanMessage = originalMessage.replace(
    USER_SKILL_COMMAND_RE,
    (fullMatch: string, prefix: string, command: string) => {
      const skill = skillByTrigger.get(triggerKey(command));
      if (!skill) {
        return fullMatch;
      }
      invoked.set(skill.id, skill);
      return prefix;
    },
  );

  cleanMessage = cleanMessage
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const invokedSkills = Array.from(invoked.values());
  if (invokedSkills.length === 0) {
    return {
      originalMessage,
      cleanMessage: originalMessage,
      promptBlock: '',
      invokedSkills: [],
    };
  }

  const promptBlock = [
    '## 用户显式调用的自定义 Skill',
    '用户在本轮消息中使用斜杠命令调用了以下自定义 Skill。请把这些 Skill 作为本轮任务的高优先级写作/分析规则，但仍需服从用户当前请求、事实依据和安全约束。',
    ...invokedSkills.map((skill, index) => [
      '',
      `### ${index + 1}. /${skill.trigger} - ${skill.name}`,
      skill.description ? `说明：${skill.description}` : '',
      'Skill 指令：',
      skill.prompt,
    ].filter(Boolean).join('\n')),
  ].join('\n');

  return {
    originalMessage,
    cleanMessage: cleanMessage || originalMessage,
    promptBlock,
    invokedSkills: invokedSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      trigger: skill.trigger,
      description: skill.description,
    })),
  };
}
