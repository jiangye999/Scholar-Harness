import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

import mammoth = require('mammoth');

import { normalizeDraftSection } from '../../utils/draft-section-classifier';
import { parseWordSidebarDocument } from './word-sidebar-import';
import {
  resolveWorkspaceDirectoryRoot,
  resolveWorkspaceFilePath,
  type WorkspaceDirectoryInput,
} from './workspace-directory';

export interface DiscussionFrameworkSubsection {
  id?: string;
  title: string;
  idea?: string;
  [key: string]: unknown;
}

export interface DiscussionFrameworkChapter {
  id?: string;
  key?: string;
  title: string;
  idea?: string;
  subsections?: DiscussionFrameworkSubsection[];
  [key: string]: unknown;
}

export interface DiscussionFrameworkState {
  version?: number;
  profileId?: string;
  planningStatus?: 'draft' | 'confirmed';
  planningUpdatedAt?: string;
  planningConfirmedAt?: string;
  structureSource?: FrameworkStructureSource;
  chapters: DiscussionFrameworkChapter[];
  [key: string]: unknown;
}

export interface FrameworkStructureSource {
  type: 'workspace' | 'agent' | 'word-import' | 'internal-draft';
  path?: string;
  modifiedAt?: string;
  fingerprint?: string;
  detectedAt: string;
  appliedAt?: string;
}

export interface FrameworkExtractedSubsection {
  title: string;
  idea?: string;
}

export interface FrameworkExtractedChapter {
  key: string;
  title: string;
  idea?: string;
  evidencePlan?: string;
  subsections: FrameworkExtractedSubsection[];
}

export interface FrameworkStructureCandidate {
  path: string;
  extension: string;
  modifiedAt: string;
  size: number;
  score: number;
  chapterCount: number;
  subsectionCount: number;
  chapters: FrameworkExtractedChapter[];
  fingerprint: string;
}

export interface FrameworkProposalDiff {
  addedChapters: string[];
  removedChapters: string[];
  renamedChapters: Array<{ from: string; to: string }>;
  addedSubsections: Array<{ chapter: string; subsection: string }>;
  removedSubsections: Array<{ chapter: string; subsection: string }>;
  updatedChapterPlans: string[];
  updatedSubsectionPlans: Array<{ chapter: string; subsection: string }>;
  changed: boolean;
}

export interface DiscussionFrameworkProposal {
  id: string;
  projectId: string;
  createdAt: string;
  source: FrameworkStructureSource;
  summary: string;
  reason?: string;
  baseState: DiscussionFrameworkState;
  chapters: FrameworkExtractedChapter[];
  diff: FrameworkProposalDiff;
  status: 'pending' | 'applied' | 'dismissed';
  appliedAt?: string;
  dismissedAt?: string;
}

export interface FrameworkProjectTarget {
  projectId: string;
  projectDir: string;
}

interface StoredFrameworkRecord {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  updatedAt: string;
  updatedBy: string;
  state: DiscussionFrameworkState;
}

const FRAMEWORK_DIRECTORY = 'framework';
const FRAMEWORK_STATE_FILE = 'paper-framework.json';
const LATEST_PROPOSAL_FILE = 'latest-proposal.json';
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_FILES = 80;
const MAX_DOCX_FILES = 16;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_DOCX_BYTES = 64 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.docx', '.md', '.markdown', '.tex', '.latex', '.txt']);
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.svn', '.hg', 'node_modules', 'dist', 'dist-electron', '.next', 'coverage',
  'scholarharness_ai_workspaces', 'artifacts', 'tmp', 'temp', '__pycache__',
]);

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function normalizeIdentity(value: unknown): string {
  return String(value || '')
    .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/, '')
    .replace(/^\s*(?:chapter\s+)?(?:[ivxlcdm]+|\d+(?:\.\d+)*)(?:\s*[.)、:：-]\s*|\s+)/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '');
}

function canonicalChapterKey(value: unknown): string {
  const title = String(value || '').trim();
  const normalized = normalizeIdentity(title);
  const aliases: Array<[string, RegExp]> = [
    ['title', /^(?:title|题目|标题)$/i],
    ['abstract', /^(?:abstract|summary|摘要|概要)$/i],
    ['introduction', /^(?:introduction|background|intro|引言|绪论|研究背景)$/i],
    ['literature_review', /^(?:literaturereview|reviewofliterature|文献综述|研究进展)$/i],
    ['methods', /^(?:materialsandmethods|methods|methodology|材料与方法|材料和方法|研究方法|方法)$/i],
    ['results_discussion', /^(?:resultsanddiscussion|结果与讨论|结果和讨论)$/i],
    ['results', /^(?:results|findings|结果|研究结果)$/i],
    ['discussion', /^(?:discussion|讨论|综合讨论)$/i],
    ['conclusion', /^(?:conclusion|conclusions|结论|结论与展望|总结与展望)$/i],
    ['references', /^(?:references|bibliography|参考文献)$/i],
    ['acknowledgements', /^(?:acknowledgements|acknowledgments|致谢)$/i],
    ['supplementary_materials', /^(?:supplementarymaterials|supportinginformation|补充材料|附录)$/i],
  ];
  const alias = aliases.find(([, pattern]) => pattern.test(normalized));
  if (alias) return alias[0];
  const normalizedDraftKey = normalizeDraftSection(title);
  if (normalizedDraftKey) return normalizedDraftKey;
  return normalized
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || `chapter_${crypto.createHash('sha1').update(title).digest('hex').slice(0, 10)}`;
}

function cleanHeadingTitle(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/^\s*(?:chapter\s+)?(?:[ivxlcdm]+|\d+(?:\.\d+)*)(?:\s*[.)、:：-]\s*|\s+)/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

interface DetectedHeading {
  position: number;
  level: number;
  title: string;
}

function buildStructureFromHeadings(headings: DetectedHeading[]): FrameworkExtractedChapter[] {
  const usable = headings
    .map(heading => ({ ...heading, title: cleanHeadingTitle(heading.title) }))
    .filter(heading => heading.title.length >= 2 && heading.title.length <= 240)
    .sort((left, right) => left.position - right.position);
  if (!usable.length) return [];

  const levelCounts = new Map<number, number>();
  for (const heading of usable) levelCounts.set(heading.level, (levelCounts.get(heading.level) || 0) + 1);
  let chapterLevel = Math.min(...usable.map(heading => heading.level));
  const firstLevelCount = levelCounts.get(chapterLevel) || 0;
  const nextLevelCount = levelCounts.get(chapterLevel + 1) || 0;
  const firstHeading = usable.find(heading => heading.level === chapterLevel);
  const knownChapterKeys = new Set([
    'title', 'abstract', 'introduction', 'literature_review', 'methods', 'results_discussion',
    'results', 'discussion', 'conclusion', 'references', 'acknowledgements', 'supplementary_materials',
  ]);
  if (
    firstLevelCount === 1
    && nextLevelCount >= 2
    && firstHeading
    && !knownChapterKeys.has(canonicalChapterKey(firstHeading.title))
  ) {
    chapterLevel += 1;
  }

  const chapters: FrameworkExtractedChapter[] = [];
  let active: FrameworkExtractedChapter | null = null;
  const subsectionSeen = new Set<string>();
  for (const heading of usable) {
    if (heading.level < chapterLevel) continue;
    if (heading.level === chapterLevel) {
      active = {
        key: canonicalChapterKey(heading.title),
        title: heading.title,
        subsections: [],
      };
      chapters.push(active);
      subsectionSeen.clear();
      continue;
    }
    if (!active || heading.level !== chapterLevel + 1) continue;
    const identity = normalizeIdentity(heading.title);
    if (!identity || subsectionSeen.has(identity)) continue;
    subsectionSeen.add(identity);
    active.subsections.push({ title: heading.title });
  }
  return chapters.filter(chapter => chapter.title && chapter.key);
}

export function extractFrameworkStructureFromText(content: string): FrameworkExtractedChapter[] {
  const text = String(content || '').replace(/\r\n?/g, '\n');
  const headings: DetectedHeading[] = [];
  let match: RegExpExecArray | null;

  const markdownPattern = /^\s{0,3}(#{1,6})\s+(.+)$/gm;
  while ((match = markdownPattern.exec(text)) !== null) {
    headings.push({ position: match.index, level: match[1].length, title: match[2] });
  }

  const latexPattern = /\\(section|subsection|subsubsection)\*?\{([^}]*)\}/g;
  while ((match = latexPattern.exec(text)) !== null) {
    const level = match[1] === 'section' ? 1 : (match[1] === 'subsection' ? 2 : 3);
    headings.push({ position: match.index, level, title: match[2] });
  }

  const numberedPattern = /^\s*((?:\d+\.)*\d+)[.)、:：-]?\s+([^\n]{2,220})\s*$/gm;
  while ((match = numberedPattern.exec(text)) !== null) {
    headings.push({ position: match.index, level: match[1].split('.').length, title: match[2] });
  }

  if (!headings.length) {
    const canonicalPattern = /^\s*(Abstract|Introduction|Background|Literature Review|Materials? and Methods?|Methods?|Results(?: and Discussion)?|Discussion|Conclusions?|摘要|引言|绪论|文献综述|材料与方法|结果(?:与讨论)?|讨论|结论(?:与展望)?)\s*$/gim;
    while ((match = canonicalPattern.exec(text)) !== null) {
      headings.push({ position: match.index, level: 1, title: match[1] });
    }
  }

  const deduplicated: DetectedHeading[] = [];
  const seen = new Set<string>();
  for (const heading of headings.sort((left, right) => left.position - right.position || left.level - right.level)) {
    const key = `${heading.position}:${heading.level}:${normalizeIdentity(heading.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduplicated.push(heading);
  }
  return buildStructureFromHeadings(deduplicated);
}

async function extractFrameworkStructureFromDocx(buffer: Buffer): Promise<FrameworkExtractedChapter[]> {
  const result = await mammoth.convertToHtml(
    { buffer },
    {
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='标题 1'] => h1:fresh",
        "p[style-name='标题 2'] => h2:fresh",
        "p[style-name='标题 3'] => h3:fresh",
      ],
    },
  );
  const headings: DetectedHeading[] = [];
  const pattern = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(result.value || '')) !== null) {
    headings.push({ position: match.index, level: Number(match[1]), title: match[2] });
  }
  const structured = buildStructureFromHeadings(headings);
  if (structured.length) return structured;

  const fallback = await parseWordSidebarDocument(buffer);
  return fallback.sections.map(section => ({
    key: section.key || canonicalChapterKey(section.title),
    title: section.title,
    subsections: extractFrameworkStructureFromText(section.content)
      .flatMap(chapter => chapter.subsections.length ? chapter.subsections : [{ title: chapter.title }]),
  }));
}

function frameworkDirectory(projectDir: string): string {
  return path.join(projectDir, FRAMEWORK_DIRECTORY);
}

function frameworkStatePath(projectDir: string): string {
  return path.join(frameworkDirectory(projectDir), FRAMEWORK_STATE_FILE);
}

function proposalDirectory(projectDir: string): string {
  return path.join(frameworkDirectory(projectDir), 'proposals');
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), 'utf-8');
  await fs.rename(temporaryPath, filePath);
}

function sanitizeFrameworkState(value: unknown): DiscussionFrameworkState {
  const serialized = JSON.stringify(value || {});
  if (Buffer.byteLength(serialized, 'utf-8') > MAX_STATE_BYTES) {
    throw new Error('论文框架数据超过 2 MB，无法保存');
  }
  const parsed = JSON.parse(serialized) as DiscussionFrameworkState;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.chapters)) {
    throw new Error('论文框架缺少 chapters 数组');
  }
  if (parsed.chapters.length > 100) throw new Error('论文框架章节不能超过 100 个');
  parsed.chapters = parsed.chapters.map(chapter => ({
    ...chapter,
    title: String(chapter?.title || '').trim().slice(0, 240),
    idea: String(chapter?.idea || '').slice(0, 20_000),
    evidencePlan: String(chapter?.evidencePlan || '').slice(0, 20_000),
    subsections: (Array.isArray(chapter?.subsections) ? chapter.subsections : []).slice(0, 100).map(subsection => ({
      ...subsection,
      title: String(subsection?.title || '').trim().slice(0, 240),
      idea: String(subsection?.idea || '').slice(0, 12_000),
    })),
  })).filter(chapter => chapter.title);
  return parsed;
}

export async function loadDiscussionFrameworkRecord(target: FrameworkProjectTarget): Promise<StoredFrameworkRecord | null> {
  try {
    const content = await fs.readFile(frameworkStatePath(target.projectDir), 'utf-8');
    const parsed = JSON.parse(content) as StoredFrameworkRecord;
    if (!parsed || parsed.projectId !== target.projectId || !parsed.state) return null;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveDiscussionFrameworkState(
  target: FrameworkProjectTarget,
  stateInput: unknown,
  updatedBy: string,
  expectedRevision?: number,
): Promise<StoredFrameworkRecord> {
  const state = sanitizeFrameworkState(stateInput);
  const current = await loadDiscussionFrameworkRecord(target);
  if (expectedRevision !== undefined && current && current.revision !== expectedRevision) {
    const error = new Error('论文框架已在其他会话中更新，请刷新后重试');
    (error as Error & { code?: string; current?: StoredFrameworkRecord }).code = 'FRAMEWORK_REVISION_CONFLICT';
    (error as Error & { code?: string; current?: StoredFrameworkRecord }).current = current;
    throw error;
  }
  const next: StoredFrameworkRecord = {
    schemaVersion: 1,
    projectId: target.projectId,
    revision: (current?.revision || 0) + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: String(updatedBy || 'web-user').slice(0, 160),
    state,
  };
  await writeJsonAtomic(frameworkStatePath(target.projectDir), next);
  return next;
}

function shouldExcludeDirectory(relativePath: string, name: string): boolean {
  const lowerName = name.toLowerCase();
  if (EXCLUDED_DIRECTORIES.has(lowerName)) return true;
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  return normalized === 'artifacts/scratch' || normalized.includes('/artifacts/scratch/');
}

async function collectCandidateFiles(root: string, selectedFile?: string): Promise<Array<{ absolutePath: string; relativePath: string; size: number; mtimeMs: number }>> {
  if (selectedFile) {
    const resolved = resolveWorkspaceFilePath(root, selectedFile);
    const stat = await fs.stat(resolved.absolutePath);
    const extension = path.extname(resolved.absolutePath).toLowerCase();
    if (!stat.isFile() || !SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error('指定文件不是可提取框架的 DOCX、Markdown、LaTeX 或 TXT 文件');
    }
    return [{ absolutePath: resolved.absolutePath, relativePath: resolved.relativePath, size: stat.size, mtimeMs: stat.mtimeMs }];
  }

  const records: Array<{ absolutePath: string; relativePath: string; size: number; mtimeMs: number }> = [];
  const queue: Array<{ absolutePath: string; relativePath: string }> = [{ absolutePath: root, relativePath: '' }];
  while (queue.length && records.length < 3000) {
    const current = queue.shift()!;
    const entries = await fs.readdir(current.absolutePath, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = current.relativePath ? path.join(current.relativePath, entry.name) : entry.name;
      const absolutePath = path.join(current.absolutePath, entry.name);
      if (entry.isDirectory()) {
        if (!shouldExcludeDirectory(relativePath, entry.name)) queue.push({ absolutePath, relativePath });
        continue;
      }
      if (!entry.isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
      const stat = await fs.stat(absolutePath);
      if ((path.extname(entry.name).toLowerCase() === '.docx' && stat.size > MAX_DOCX_BYTES) || stat.size > MAX_DOCX_BYTES) continue;
      records.push({ absolutePath, relativePath, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  return records;
}

function preScoreCandidate(relativePath: string, mtimeMs: number): number {
  const normalized = relativePath.replace(/\\/g, '/').toLowerCase();
  const name = path.basename(normalized);
  let score = 0;
  if (/(?:manuscript|paper|article|draft|论文|稿件|文章|草稿|毕业论文|学位论文)/i.test(name)) score += 80;
  if (/(?:outline|framework|structure|提纲|框架|目录)/i.test(name)) score += 55;
  if (/^(?:readme|license|changelog|agents)\b/i.test(name)) score -= 120;
  if (/(?:backup|备份|copy|副本|old|旧版)/i.test(name)) score -= 20;
  const ageDays = Math.max(0, (Date.now() - mtimeMs) / 86_400_000);
  score += Math.max(0, 20 - Math.min(20, ageDays));
  return score;
}

async function parseCandidate(record: { absolutePath: string; relativePath: string; size: number; mtimeMs: number }): Promise<FrameworkStructureCandidate | null> {
  const extension = path.extname(record.absolutePath).toLowerCase();
  let chapters: FrameworkExtractedChapter[] = [];
  if (extension === '.docx') {
    const buffer = await fs.readFile(record.absolutePath);
    chapters = await extractFrameworkStructureFromDocx(buffer);
  } else {
    if (record.size > MAX_TEXT_BYTES) return null;
    chapters = extractFrameworkStructureFromText(await fs.readFile(record.absolutePath, 'utf-8'));
  }
  if (!chapters.length) return null;
  const modifiedAt = new Date(record.mtimeMs).toISOString();
  const structureJson = JSON.stringify(chapters);
  const fingerprint = crypto.createHash('sha256')
    .update(record.relativePath.replace(/\\/g, '/'))
    .update(String(record.size))
    .update(String(Math.floor(record.mtimeMs)))
    .update(structureJson)
    .digest('hex');
  const subsectionCount = chapters.reduce((total, chapter) => total + chapter.subsections.length, 0);
  return {
    path: record.relativePath.replace(/\\/g, '/'),
    extension,
    modifiedAt,
    size: record.size,
    score: preScoreCandidate(record.relativePath, record.mtimeMs) + chapters.length * 30 + subsectionCount * 3,
    chapterCount: chapters.length,
    subsectionCount,
    chapters,
    fingerprint,
  };
}

export async function scanWorkspaceFrameworkStructure(input: {
  workspaceDirectory: WorkspaceDirectoryInput;
  selectedFile?: string;
}): Promise<{ root: string; selected: FrameworkStructureCandidate; candidates: FrameworkStructureCandidate[] }> {
  const root = await resolveWorkspaceDirectoryRoot(input.workspaceDirectory);
  const records = await collectCandidateFiles(root, input.selectedFile);
  const sortedRecords = records.sort((left, right) => {
    const scoreDiff = preScoreCandidate(right.relativePath, right.mtimeMs) - preScoreCandidate(left.relativePath, left.mtimeMs);
    return scoreDiff || right.mtimeMs - left.mtimeMs;
  });
  const shortlisted: typeof sortedRecords = [];
  let docxCount = 0;
  for (const record of sortedRecords) {
    if (shortlisted.length >= MAX_SCAN_FILES) break;
    if (path.extname(record.absolutePath).toLowerCase() === '.docx') {
      if (docxCount >= MAX_DOCX_FILES) continue;
      docxCount += 1;
    }
    shortlisted.push(record);
  }
  const parsed: FrameworkStructureCandidate[] = [];
  for (const record of shortlisted) {
    try {
      const candidate = await parseCandidate(record);
      if (candidate) parsed.push(candidate);
    } catch {
      // A corrupt or locked candidate must not block other manuscript files.
    }
  }
  parsed.sort((left, right) => right.score - left.score || Date.parse(right.modifiedAt) - Date.parse(left.modifiedAt));
  if (!parsed.length) {
    throw new Error('工作目录中没有识别到包含章节标题的 DOCX、Markdown、LaTeX 或 TXT 论文文件');
  }
  return { root, selected: parsed[0], candidates: parsed.slice(0, 12) };
}

function findChapterMatch(
  chapters: DiscussionFrameworkChapter[],
  proposed: FrameworkExtractedChapter,
  usedIndexes: Set<number>,
): { chapter: DiscussionFrameworkChapter; index: number } | null {
  const proposedIdentity = normalizeIdentity(proposed.title);
  const proposedKey = canonicalChapterKey(proposed.key || proposed.title);
  for (let index = 0; index < chapters.length; index += 1) {
    if (usedIndexes.has(index)) continue;
    const chapter = chapters[index];
    const chapterIdentity = normalizeIdentity(chapter.title);
    const chapterKey = canonicalChapterKey(chapter.key || chapter.syncedDraftKey || chapter.title);
    if (chapterIdentity === proposedIdentity || chapterKey === proposedKey) return { chapter, index };
  }
  return null;
}

export function diffDiscussionFramework(
  state: DiscussionFrameworkState,
  proposedChapters: FrameworkExtractedChapter[],
): FrameworkProposalDiff {
  const existing = Array.isArray(state.chapters) ? state.chapters : [];
  const used = new Set<number>();
  const addedChapters: string[] = [];
  const renamedChapters: Array<{ from: string; to: string }> = [];
  const addedSubsections: Array<{ chapter: string; subsection: string }> = [];
  const removedSubsections: Array<{ chapter: string; subsection: string }> = [];
  const updatedChapterPlans: string[] = [];
  const updatedSubsectionPlans: Array<{ chapter: string; subsection: string }> = [];

  for (const proposed of proposedChapters) {
    const match = findChapterMatch(existing, proposed, used);
    if (!match) {
      addedChapters.push(proposed.title);
      for (const subsection of proposed.subsections) addedSubsections.push({ chapter: proposed.title, subsection: subsection.title });
      continue;
    }
    used.add(match.index);
    if (normalizeIdentity(match.chapter.title) !== normalizeIdentity(proposed.title)) {
      renamedChapters.push({ from: match.chapter.title, to: proposed.title });
    }
    if (
      (String(proposed.idea || '').trim() && String(proposed.idea || '').trim() !== String(match.chapter.idea || '').trim())
      || (String(proposed.evidencePlan || '').trim() && String(proposed.evidencePlan || '').trim() !== String(match.chapter.evidencePlan || '').trim())
    ) {
      updatedChapterPlans.push(proposed.title);
    }
    const existingSubsections = Array.isArray(match.chapter.subsections) ? match.chapter.subsections : [];
    const proposedIdentities = new Set(proposed.subsections.map(subsection => normalizeIdentity(subsection.title)));
    const existingIdentities = new Set(existingSubsections.map(subsection => normalizeIdentity(subsection.title)));
    for (const subsection of proposed.subsections) {
      if (!existingIdentities.has(normalizeIdentity(subsection.title))) {
        addedSubsections.push({ chapter: proposed.title, subsection: subsection.title });
      } else if (String(subsection.idea || '').trim()) {
        const existingSubsection = existingSubsections.find(current => normalizeIdentity(current.title) === normalizeIdentity(subsection.title));
        if (String(existingSubsection?.idea || '').trim() !== String(subsection.idea || '').trim()) {
          updatedSubsectionPlans.push({ chapter: proposed.title, subsection: subsection.title });
        }
      }
    }
    for (const subsection of existingSubsections) {
      if (!proposedIdentities.has(normalizeIdentity(subsection.title))) {
        removedSubsections.push({ chapter: match.chapter.title, subsection: subsection.title });
      }
    }
  }
  const removedChapters = existing
    .map((chapter, index) => ({ chapter, index }))
    .filter(item => !used.has(item.index))
    .map(item => item.chapter.title);
  return {
    addedChapters,
    removedChapters,
    renamedChapters,
    addedSubsections,
    removedSubsections,
    updatedChapterPlans,
    updatedSubsectionPlans,
    changed: Boolean(
      addedChapters.length
      || removedChapters.length
      || renamedChapters.length
      || addedSubsections.length
      || removedSubsections.length
      || updatedChapterPlans.length
      || updatedSubsectionPlans.length
    ),
  };
}

function hasManualFrameworkContent(chapter: DiscussionFrameworkChapter): boolean {
  if (String(chapter.idea || '').trim()) return true;
  if (String(chapter.evidencePlan || '').trim()) return true;
  if (String(chapter.analysis || '').trim()) return true;
  if (Array.isArray(chapter.figureReferences) && chapter.figureReferences.length > 0) return true;
  return (Array.isArray(chapter.subsections) ? chapter.subsections : []).some(subsection => String(subsection.idea || '').trim());
}

export function mergeDiscussionFrameworkState(
  stateInput: DiscussionFrameworkState,
  proposedChapters: FrameworkExtractedChapter[],
  source: FrameworkStructureSource,
): DiscussionFrameworkState {
  const state = sanitizeFrameworkState(stateInput);
  const existing = state.chapters || [];
  const used = new Set<number>();
  const merged: DiscussionFrameworkChapter[] = [];
  for (const proposed of proposedChapters) {
    const match = findChapterMatch(existing, proposed, used);
    const base: DiscussionFrameworkChapter = match
      ? { ...match.chapter }
      : {
          id: createId('chapter'),
          title: proposed.title,
          idea: '',
          evidencePlan: '',
          analysis: '',
          analysisUpdatedAt: '',
          analysisProgress: '',
          analysisProgressStatus: '',
          syncedFigures: [],
          figureReferences: [],
          writingStatus: 'not_started',
          collapsed: true,
          subsections: [],
        };
    if (match) used.add(match.index);
    const oldSubsections = Array.isArray(base.subsections) ? base.subsections : [];
    const usedSubsections = new Set<number>();
    const nextSubsections: DiscussionFrameworkSubsection[] = proposed.subsections.map(subsection => {
      const identity = normalizeIdentity(subsection.title);
      const index = oldSubsections.findIndex((current, currentIndex) => (
        !usedSubsections.has(currentIndex) && normalizeIdentity(current.title) === identity
      ));
      if (index >= 0) {
        usedSubsections.add(index);
        return {
          ...oldSubsections[index],
          title: subsection.title,
          idea: String(subsection.idea || '').trim() || String(oldSubsections[index].idea || ''),
        };
      }
      return { id: createId('sub'), title: subsection.title, idea: String(subsection.idea || '').trim() };
    });
    oldSubsections.forEach((subsection, index) => {
      if (!usedSubsections.has(index) && String(subsection.idea || '').trim()) nextSubsections.push(subsection);
    });
    merged.push({
      ...base,
      key: proposed.key,
      title: proposed.title,
      idea: String(proposed.idea || '').trim() || String(base.idea || ''),
      evidencePlan: String(proposed.evidencePlan || '').trim() || String(base.evidencePlan || ''),
      subsections: nextSubsections,
      structureSource: source,
    });
  }
  existing.forEach((chapter, index) => {
    if (!used.has(index) && hasManualFrameworkContent(chapter)) {
      merged.push({ ...chapter, structureMissingFromLatestSource: true });
    }
  });
  const now = new Date().toISOString();
  return {
    ...state,
    version: Math.max(3, Number(state.version || 0)),
    planningStatus: 'draft',
    planningConfirmedAt: '',
    planningUpdatedAt: now,
    structureSource: { ...source, appliedAt: now },
    chapters: merged,
  };
}

export async function createDiscussionFrameworkProposal(input: {
  target: FrameworkProjectTarget;
  state: DiscussionFrameworkState;
  chapters: FrameworkExtractedChapter[];
  source: FrameworkStructureSource;
  summary: string;
  reason?: string;
}): Promise<DiscussionFrameworkProposal> {
  const baseState = sanitizeFrameworkState(input.state);
  const proposal: DiscussionFrameworkProposal = {
    id: createId('framework_proposal'),
    projectId: input.target.projectId,
    createdAt: new Date().toISOString(),
    source: input.source,
    summary: String(input.summary || '检测到论文框架更新').slice(0, 2000),
    reason: String(input.reason || '').slice(0, 4000) || undefined,
    baseState,
    chapters: input.chapters.slice(0, 100).map(chapter => ({
      key: canonicalChapterKey(chapter.key || chapter.title),
      title: cleanHeadingTitle(chapter.title),
      idea: String(chapter.idea || '').trim().slice(0, 20_000) || undefined,
      evidencePlan: String(chapter.evidencePlan || '').trim().slice(0, 20_000) || undefined,
      subsections: chapter.subsections.slice(0, 100).map(subsection => ({
        title: cleanHeadingTitle(subsection.title),
        idea: String(subsection.idea || '').trim().slice(0, 12_000) || undefined,
      })).filter(subsection => subsection.title),
    })).filter(chapter => chapter.title),
    diff: diffDiscussionFramework(baseState, input.chapters),
    status: 'pending',
  };
  await writeJsonAtomic(path.join(proposalDirectory(input.target.projectDir), `${proposal.id}.json`), proposal);
  await writeJsonAtomic(path.join(frameworkDirectory(input.target.projectDir), LATEST_PROPOSAL_FILE), proposal);
  return proposal;
}

export async function loadLatestDiscussionFrameworkProposal(target: FrameworkProjectTarget): Promise<DiscussionFrameworkProposal | null> {
  try {
    const directory = proposalDirectory(target.projectDir);
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const pending: DiscussionFrameworkProposal[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/^framework_proposal_.+\.json$/i.test(entry.name)) continue;
      try {
        const content = await fs.readFile(path.join(directory, entry.name), 'utf-8');
        const proposal = JSON.parse(content) as DiscussionFrameworkProposal;
        if (proposal && proposal.projectId === target.projectId && proposal.status === 'pending') pending.push(proposal);
      } catch {
        // Ignore a partially written or legacy proposal and continue with the queue.
      }
    }
    pending.sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''));
    return pending[0] || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function loadProposal(target: FrameworkProjectTarget, proposalId: string): Promise<DiscussionFrameworkProposal> {
  const safeId = path.basename(String(proposalId || ''));
  if (safeId !== proposalId || !safeId.startsWith('framework_proposal_')) throw new Error('无效的框架建议 ID');
  const content = await fs.readFile(path.join(proposalDirectory(target.projectDir), `${safeId}.json`), 'utf-8');
  const proposal = JSON.parse(content) as DiscussionFrameworkProposal;
  if (!proposal || proposal.projectId !== target.projectId) throw new Error('框架建议不属于当前项目');
  return proposal;
}

export async function applyDiscussionFrameworkProposal(
  target: FrameworkProjectTarget,
  proposalId: string,
  updatedBy: string,
): Promise<{ proposal: DiscussionFrameworkProposal; record: StoredFrameworkRecord }> {
  const proposal = await loadProposal(target, proposalId);
  if (proposal.status !== 'pending') throw new Error('该框架建议已经处理');
  const current = await loadDiscussionFrameworkRecord(target);
  const currentState = current?.state || proposal.baseState;
  const merged = mergeDiscussionFrameworkState(currentState, proposal.chapters, proposal.source);
  const record = await saveDiscussionFrameworkState(target, merged, updatedBy);
  proposal.status = 'applied';
  proposal.appliedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(proposalDirectory(target.projectDir), `${proposal.id}.json`), proposal);
  await writeJsonAtomic(path.join(frameworkDirectory(target.projectDir), LATEST_PROPOSAL_FILE), proposal);
  return { proposal, record };
}

export async function dismissDiscussionFrameworkProposal(target: FrameworkProjectTarget, proposalId: string): Promise<DiscussionFrameworkProposal> {
  const proposal = await loadProposal(target, proposalId);
  if (proposal.status !== 'pending') return proposal;
  proposal.status = 'dismissed';
  proposal.dismissedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(proposalDirectory(target.projectDir), `${proposal.id}.json`), proposal);
  await writeJsonAtomic(path.join(frameworkDirectory(target.projectDir), LATEST_PROPOSAL_FILE), proposal);
  return proposal;
}

export function resolveFrameworkProjectTarget(dataDir: string, projectId: string): FrameworkProjectTarget {
  const safeProjectId = path.basename(String(projectId || '').trim());
  if (!safeProjectId || safeProjectId !== projectId || !safeProjectId.startsWith('project-')) {
    throw new Error('无效的项目 ID，无法保存论文框架');
  }
  return { projectId: safeProjectId, projectDir: path.join(dataDir, 'projects', safeProjectId) };
}
