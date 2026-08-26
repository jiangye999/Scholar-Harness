import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import {
  deriveProjectWritingStatus,
  type ProjectUserRequirement,
} from './project-writing-status';

export const CHAPTER_WRITING_PROGRESS_FILE = '章节写作进度.json';
export const GLOBAL_WRITING_REQUIREMENTS_FILE = '用户写作要求.json';

export type WritingRequirementCategory =
  | 'research_and_target'
  | 'language_and_style'
  | 'structure_and_content'
  | 'citations_and_evidence'
  | 'data_figures_and_analysis'
  | 'files_and_delivery'
  | 'workflow_and_interaction'
  | 'other';

export interface StoredWritingRequirement {
  id: string;
  text: string;
  sourceLabels: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  active: boolean;
}

export interface WritingRequirementsFile {
  schemaVersion: 1;
  scope: 'global';
  userId: string;
  updatedAt: string;
  instructions: string;
  categories: Record<WritingRequirementCategory, {
    label: string;
    items: StoredWritingRequirement[];
  }>;
}

export interface WritingStateSyncResult {
  progressPath?: string;
  workspaceRequirementsPath?: string;
  globalRequirementsPath: string;
  requirements: StoredWritingRequirement[];
  warnings: string[];
}

const CATEGORY_LABELS: Record<WritingRequirementCategory, string> = {
  research_and_target: '研究主题与目标期刊',
  language_and_style: '语言与写作风格',
  structure_and_content: '论文结构与内容安排',
  citations_and_evidence: '引用、证据与参考文献',
  data_figures_and_analysis: '数据、图表与统计分析',
  files_and_delivery: '文件、格式与交付要求',
  workflow_and_interaction: '工作流与交互要求',
  other: '其他要求',
};

function cleanText(value: unknown, maxChars = 2_000): string {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxChars);
}

function requirementId(text: string): string {
  const identity = cleanText(text).toLowerCase().replace(/\s+/g, '');
  return `req_${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;
}

export function classifyWritingRequirement(value: unknown): WritingRequirementCategory {
  const text = cleanText(value);
  if (/(?:期刊|journal|投稿|研究主题|论文主题|研究问题|研究目标|关键词)/i.test(text)) return 'research_and_target';
  if (/(?:中文|英文|语言|语气|文风|写作风格|简洁|学术表达|时态|术语)/i.test(text)) return 'language_and_style';
  if (/(?:章节|小节|结构|框架|引言|方法|结果|讨论|结论|摘要|标题|正文|段落|逻辑|论证顺序)/i.test(text)) return 'structure_and_content';
  if (/(?:引用|参考文献|citation|reference|doi|证据|文献|尾注)/i.test(text)) return 'citations_and_evidence';
  if (/(?:数据|图表|图片|figure|table|统计|效应量|显著性|R语言|作图|分析)/i.test(text)) return 'data_figures_and_analysis';
  if (/(?:文件|目录|word|docx|pdf|excel|xlsx|markdown|命名|保存|导出|下载|交付)/i.test(text)) return 'files_and_delivery';
  if (/(?:每次|以后|自动|不要询问|先讨论|确认|交互|回复|回答|执行|工具|agent|模型)/i.test(text)) return 'workflow_and_interaction';
  return 'other';
}

function createEmptyRequirementsFile(userId: string, now: string): WritingRequirementsFile {
  const categories = {} as WritingRequirementsFile['categories'];
  (Object.keys(CATEGORY_LABELS) as WritingRequirementCategory[]).forEach(category => {
    categories[category] = { label: CATEGORY_LABELS[category], items: [] };
  });
  return {
    schemaVersion: 1,
    scope: 'global',
    userId,
    updatedAt: now,
    instructions: '这是跨项目生效的全局写作要求。active=false 的条目不会提供给 AI；可以修改 text 或添加新条目。',
    categories,
  };
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(`JSON 文件格式无效，已停止覆盖以保护用户修改：${filePath}`);
    }
    throw error;
  }
}

function extractRequirements(value: unknown, now: string): StoredWritingRequirement[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const categories = (value as Record<string, unknown>).categories;
  if (!categories || typeof categories !== 'object' || Array.isArray(categories)) return [];
  const results: StoredWritingRequirement[] = [];
  Object.values(categories as Record<string, unknown>).forEach(groupValue => {
    const group = groupValue && typeof groupValue === 'object' && !Array.isArray(groupValue)
      ? groupValue as Record<string, unknown>
      : {};
    const items = Array.isArray(group.items) ? group.items : [];
    items.forEach(itemValue => {
      if (typeof itemValue === 'string') {
        const text = cleanText(itemValue);
        if (text) results.push({ id: requirementId(text), text, sourceLabels: ['用户编辑 JSON'], firstSeenAt: now, lastSeenAt: now, active: true });
        return;
      }
      if (!itemValue || typeof itemValue !== 'object' || Array.isArray(itemValue)) return;
      const item = itemValue as Record<string, unknown>;
      const text = cleanText(item.text);
      if (!text) return;
      results.push({
        id: cleanText(item.id, 120) || requirementId(text),
        text,
        sourceLabels: Array.isArray(item.sourceLabels) ? item.sourceLabels.map(label => cleanText(label, 120)).filter(Boolean) : ['用户编辑 JSON'],
        firstSeenAt: cleanText(item.firstSeenAt, 80) || now,
        lastSeenAt: cleanText(item.lastSeenAt, 80) || now,
        active: item.active !== false,
      });
    });
  });
  return results;
}

function mergeRequirements(
  existing: StoredWritingRequirement[],
  incoming: ProjectUserRequirement[],
  now: string,
): StoredWritingRequirement[] {
  const merged = new Map<string, StoredWritingRequirement>();
  existing.forEach(item => {
    const id = requirementId(item.text);
    merged.set(id, { ...item, id });
  });
  incoming.forEach(item => {
    const text = cleanText(item.text);
    if (!text) return;
    const id = requirementId(text);
    const current = merged.get(id);
    const sourceLabel = cleanText(item.label, 120) || item.source;
    merged.set(id, current ? {
      ...current,
      text,
      lastSeenAt: now,
      sourceLabels: Array.from(new Set([...current.sourceLabels, sourceLabel])).slice(0, 12),
    } : {
      id,
      text,
      sourceLabels: [sourceLabel],
      firstSeenAt: now,
      lastSeenAt: now,
      active: true,
    });
  });
  return Array.from(merged.values()).sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt));
}

function buildRequirementsFile(userId: string, items: StoredWritingRequirement[], now: string): WritingRequirementsFile {
  const file = createEmptyRequirementsFile(userId, now);
  items.forEach(item => {
    file.categories[classifyWritingRequirement(`${item.sourceLabels.join(' ')} ${item.text}`)].items.push(item);
  });
  return file;
}

function buildProgressFile(projectId: string, contextValue: unknown, now: string): Record<string, unknown> {
  const context = contextValue && typeof contextValue === 'object' && !Array.isArray(contextValue)
    ? contextValue as Record<string, unknown>
    : {};
  const progress = context.articleWritingProgress && typeof context.articleWritingProgress === 'object'
    ? context.articleWritingProgress as Record<string, unknown>
    : {};
  const chapters = Array.isArray(progress.chapters) ? progress.chapters : [];
  const status = deriveProjectWritingStatus(context);
  return {
    schemaVersion: 1,
    scope: 'project',
    projectId,
    updatedAt: now,
    effectiveStage: status.stage,
    effectiveStageLabel: status.stageLabel,
    frameworkExplicitlyConfirmed: status.frameworkExplicitlyConfirmed,
    canContinueWriting: status.canContinueWriting,
    summary: {
      totalChapterCount: status.totalChapterCount,
      draftedChapterCount: status.draftedChapterCount,
      completedChapterCount: status.completedChapterCount,
      activeChapterCount: status.activeChapterCount,
    },
    evidence: status.evidence,
    chapters: chapters.map((value, index) => {
      const chapter = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
      return {
        order: Number(chapter.order || index + 1),
        key: cleanText(chapter.key, 180),
        title: cleanText(chapter.title || chapter.key, 300),
        status: cleanText(chapter.status, 80) || (chapter.completed === true ? 'completed' : (chapter.current === true ? 'in_progress' : (chapter.drafted === true ? 'drafted' : 'not_started'))),
        drafted: chapter.drafted === true || Number(chapter.draftChars || 0) > 0,
        draftChars: Math.max(0, Number(chapter.draftChars || 0)),
        completed: chapter.completed === true,
        current: chapter.current === true,
        fileName: cleanText(chapter.fileName, 260),
        storagePath: cleanText(chapter.storagePath, 600),
        objective: cleanText(chapter.objective, 2_000),
        subsections: Array.isArray(chapter.subsections) ? chapter.subsections : [],
      };
    }),
  };
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
  await fs.rename(temporaryPath, filePath);
}

export async function syncWritingStateFiles(input: {
  userId: string;
  projectId: string;
  context: unknown;
  requirements: ProjectUserRequirement[];
  globalRequirementsPath: string;
  workspaceRoot?: string;
  workspaceWritable?: boolean;
  now?: string;
}): Promise<WritingStateSyncResult> {
  const now = input.now || new Date().toISOString();
  const warnings: string[] = [];
  const workspaceRoot = input.workspaceRoot ? path.resolve(input.workspaceRoot) : '';
  const workspaceRequirementsPath = workspaceRoot ? path.join(workspaceRoot, GLOBAL_WRITING_REQUIREMENTS_FILE) : '';
  const canonicalValue = await readJsonFile(input.globalRequirementsPath);
  const workspaceValue = workspaceRequirementsPath ? await readJsonFile(workspaceRequirementsPath) : null;
  const existing = [
    ...extractRequirements(canonicalValue, now),
    ...extractRequirements(workspaceValue, now),
  ];
  const merged = mergeRequirements(existing, input.requirements, now);
  const requirementsFile = buildRequirementsFile(input.userId, merged, now);
  await writeJsonAtomic(input.globalRequirementsPath, requirementsFile);

  let progressPath: string | undefined;
  let mirroredRequirementsPath: string | undefined;
  if (workspaceRoot && input.workspaceWritable !== false) {
    progressPath = path.join(workspaceRoot, CHAPTER_WRITING_PROGRESS_FILE);
    mirroredRequirementsPath = workspaceRequirementsPath;
    await writeJsonAtomic(progressPath, buildProgressFile(input.projectId, input.context, now));
    await writeJsonAtomic(mirroredRequirementsPath, requirementsFile);
  } else if (workspaceRoot) {
    warnings.push('当前工作目录为只读，已更新全局要求主记录，但未写入工作目录 JSON。');
  } else {
    warnings.push('当前没有配置用户工作目录，已更新全局要求主记录，但未生成项目进度 JSON。');
  }

  return {
    progressPath,
    workspaceRequirementsPath: mirroredRequirementsPath,
    globalRequirementsPath: input.globalRequirementsPath,
    requirements: merged.filter(item => item.active !== false),
    warnings,
  };
}
