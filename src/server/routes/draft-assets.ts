import { randomUUID } from 'crypto';
import { Router } from 'express';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import multer from 'multer';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { SessionStore, sanitizeDraftChapterName } from '../../storage/session-store';
import { getDataDir, getUserUploadDir, sanitizeUserId } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { parseWordSidebarDocument } from '../services/word-sidebar-import';

const MANIFEST_VERSION = 1;
const DEFAULT_SUBSECTION_KEY = 'section';
const FIGURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.tif', '.tiff', '.bmp', '.gif', '.pdf']);
const draftFigureManifestLocks = new Map<string, Promise<void>>();

export interface DraftFigureAsset {
  id: string;
  userId: string;
  chapterName: string;
  chapterKey: string;
  subsectionId?: string;
  subsectionTitle?: string;
  subsectionKey: string;
  figureLabel: string;
  title: string;
  caption: string;
  originalFileName: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  url: string;
  source: {
    kind: 'r-code' | 'experiment-results' | 'chat-upload' | 'merged-library' | 'word-import';
    jobId?: string;
    relativePath?: string;
    originalPath?: string;
    url?: string;
    sourceAssetIds?: string[];
    documentName?: string;
    importId?: string;
    figureIndex?: number;
  };
  draftLinked: boolean;
  createdAt: string;
}

interface DraftFigureManifest {
  version: 1;
  updatedAt: string;
  figures: DraftFigureAsset[];
}

const saveDraftFigureSchema = z.object({
  userId: z.string().optional(),
  chapterName: z.string().min(1).max(160),
  subsectionId: z.string().max(160).optional().default(''),
  subsectionTitle: z.string().max(260).optional().default(''),
  figureLabel: z.string().max(120).optional().default('Figure'),
  title: z.string().max(500).optional().default(''),
  caption: z.string().max(2000).optional().default(''),
  requestedFileName: z.string().max(260).optional().default(''),
  source: z.object({
    kind: z.enum(['r-code', 'experiment-results', 'chat-upload']),
    jobId: z.string().max(120).optional(),
    relativePath: z.string().max(500).optional(),
    originalPath: z.string().max(1000).optional(),
    url: z.string().max(1000).optional(),
  }),
});

const savePaperFigureSchema = saveDraftFigureSchema.omit({ chapterName: true }).extend({
  chapterName: z.string().max(160).optional().default(''),
});

const updatePaperFigureSchema = z.object({
  userId: z.string().optional(),
  figureLabel: z.string().max(120).optional(),
  title: z.string().max(500).optional(),
  caption: z.string().max(2000).optional(),
});

const paperFigureAssetIdsSchema = z.array(
  z.string().regex(/^[a-zA-Z0-9_-]+$/).max(120)
).min(1).max(100);

const deletePaperFiguresSchema = z.object({
  userId: z.string().optional(),
  assetIds: paperFigureAssetIdsSchema,
});

const mergePaperFiguresSchema = z.object({
  userId: z.string().optional(),
  assetIds: paperFigureAssetIdsSchema.min(2).max(20),
  figureLabel: z.string().max(120).optional().default('Figure'),
  title: z.string().max(500).optional().default(''),
  caption: z.string().max(2000).optional().default(''),
  dataUrl: z.string().max(48 * 1024 * 1024),
});

const importWordSidebarSchema = z.object({
  userId: z.string().optional(),
  mode: z.enum(['preview', 'overwrite']).optional().default('preview'),
});

const wordSidebarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: 64 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(String(file.originalname || '')).toLowerCase();
    if (extension !== '.docx') {
      callback(new Error('只支持导入 .docx Word 文件'));
      return;
    }
    callback(null, true);
  },
});

export function normalizeDraftAssetChapterKey(value: unknown): string {
  const raw = String(value || '').trim();
  const lowered = raw.toLowerCase().replace(/[\s_-]+/g, '');
  const aliases: Record<string, string> = {
    title: 'title',
    abstract: 'abstract',
    摘要: 'abstract',
    introduction: 'introduction',
    intro: 'introduction',
    引言: 'introduction',
    前言: 'introduction',
    methods: 'methods',
    method: 'methods',
    materialsandmethods: 'methods',
    材料与方法: 'methods',
    方法: 'methods',
    results: 'results',
    result: 'results',
    结果: 'results',
    discussion: 'discussion',
    讨论: 'discussion',
    conclusion: 'conclusion',
    conclusions: 'conclusion',
    结论: 'conclusion',
  };
  return aliases[lowered] || sanitizeDraftChapterName(raw || 'results');
}

function normalizeDisplayText(value: unknown, fallback: string, maxLength: number): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, maxLength);
}

function getDraftAssetRoot(userId: string): string {
  return path.join(getUserUploadDir(userId), 'draft-assets');
}

function getDraftFigureManifestPath(userId: string): string {
  return path.join(getDraftAssetRoot(userId), 'manifest.json');
}

async function loadDraftFigureManifest(userId: string): Promise<DraftFigureManifest> {
  const manifestPath = getDraftFigureManifestPath(userId);
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as Partial<DraftFigureManifest>;
    return {
      version: MANIFEST_VERSION,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
      figures: Array.isArray(parsed.figures) ? parsed.figures.filter(Boolean) as DraftFigureAsset[] : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: MANIFEST_VERSION, updatedAt: new Date().toISOString(), figures: [] };
    }
    throw error;
  }
}

async function saveDraftFigureManifest(userId: string, manifest: DraftFigureManifest): Promise<void> {
  const manifestPath = getDraftFigureManifestPath(userId);
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  manifest.updatedAt = new Date().toISOString();
  const temporaryPath = `${manifestPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(manifest, null, 2), 'utf-8');
  try {
    await fs.rename(temporaryPath, manifestPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST' && code !== 'EPERM' && code !== 'EACCES') throw error;
    await fs.rm(manifestPath, { force: true });
    await fs.rename(temporaryPath, manifestPath);
  }
}

function getDraftFigureTimestamp(asset: DraftFigureAsset): number {
  const timestamp = new Date(asset.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getWordImportGroupKey(asset: DraftFigureAsset): string {
  if (asset.source?.kind !== 'word-import') return '';
  return String(asset.source.importId || asset.source.documentName || '').trim().toLowerCase();
}

function compareFigureLabels(a: DraftFigureAsset, b: DraftFigureAsset): number {
  const aIndex = Number(a.source?.figureIndex);
  const bIndex = Number(b.source?.figureIndex);
  const aHasIndex = Number.isInteger(aIndex) && aIndex >= 0;
  const bHasIndex = Number.isInteger(bIndex) && bIndex >= 0;
  if (aHasIndex && bHasIndex && aIndex !== bIndex) return aIndex - bIndex;
  if (aHasIndex !== bHasIndex) return aHasIndex ? -1 : 1;
  return String(a.figureLabel || a.fileName || '').localeCompare(
    String(b.figureLabel || b.fileName || ''),
    'en',
    { numeric: true, sensitivity: 'base' }
  );
}

export function sortDraftFigureAssetsForDisplay(assets: DraftFigureAsset[]): DraftFigureAsset[] {
  const wordImportTimestamps = new Map<string, number>();
  for (const asset of assets) {
    const groupKey = getWordImportGroupKey(asset);
    if (!groupKey) continue;
    wordImportTimestamps.set(
      groupKey,
      Math.max(wordImportTimestamps.get(groupKey) || 0, getDraftFigureTimestamp(asset))
    );
  }

  return assets.slice().sort((a, b) => {
    const aGroup = getWordImportGroupKey(a);
    const bGroup = getWordImportGroupKey(b);
    if (aGroup && aGroup === bGroup) {
      return compareFigureLabels(a, b);
    }
    const aTimestamp = aGroup
      ? wordImportTimestamps.get(aGroup) || getDraftFigureTimestamp(a)
      : getDraftFigureTimestamp(a);
    const bTimestamp = bGroup
      ? wordImportTimestamps.get(bGroup) || getDraftFigureTimestamp(b)
      : getDraftFigureTimestamp(b);
    return bTimestamp - aTimestamp
      || String(a.id || '').localeCompare(String(b.id || ''), 'en', { numeric: true });
  });
}

async function withDraftFigureManifestLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const lockKey = sanitizeUserId(userId);
  const previous = (draftFigureManifestLocks.get(lockKey) || Promise.resolve()).catch(() => undefined);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  draftFigureManifestLocks.set(lockKey, tail);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (draftFigureManifestLocks.get(lockKey) === tail) draftFigureManifestLocks.delete(lockKey);
  }
}

export async function loadDraftFigureAssetsForUser(userId: string): Promise<DraftFigureAsset[]> {
  return (await loadDraftFigureManifest(sanitizeUserId(userId))).figures;
}

function getRPluginRoot(userId: string): string {
  return path.join(getDataDir(), 'r-plugin', sanitizeUserId(userId));
}

function getRDesktopArtifactRoot(userId: string): string {
  return path.join(os.homedir(), 'Desktop', 'Scholar Harness R图表', sanitizeUserId(userId));
}

function resolveScopedFile(rootPath: string, requestedPath: unknown): string {
  const root = path.resolve(rootPath);
  const target = path.resolve(root, String(requestedPath || ''));
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('无效的图件文件路径');
  }
  return target;
}

function resolveRJobDir(userId: string, jobId: string): string {
  const safeJobId = String(jobId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeJobId) throw new Error('无效的 R 图表任务 ID');
  const desktopDir = path.resolve(getRDesktopArtifactRoot(userId), safeJobId);
  if (fsSync.existsSync(desktopDir)) return desktopDir;
  return path.resolve(getRPluginRoot(userId), safeJobId);
}

function resolveRSourceFigure(userId: string, source: z.infer<typeof saveDraftFigureSchema>['source']): string {
  if (!source.jobId || !source.relativePath) {
    throw new Error('保存 R 图件需要 jobId 和 relativePath');
  }
  return resolveScopedFile(resolveRJobDir(userId, source.jobId), source.relativePath);
}

function resolveExperimentSourceFigure(userId: string, source: z.infer<typeof saveDraftFigureSchema>['source']): string {
  const experimentRoot = path.resolve(getUserUploadDir(userId), 'experiment-results');
  const requested = source.originalPath
    ? path.resolve(source.originalPath)
    : path.resolve(experimentRoot, String(source.relativePath || ''));
  const relative = path.relative(experimentRoot, requested);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('实验图件只能从当前用户的 experiment-results 目录保存');
  }
  return requested;
}

function resolveChatUploadSourceFigure(userId: string, source: z.infer<typeof saveDraftFigureSchema>['source']): string {
  const attachmentRoot = path.resolve(getDataDir(), 'chat-attachments', sanitizeUserId(userId));
  const requested = path.resolve(String(source.originalPath || ''));
  const relative = path.relative(attachmentRoot, requested);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('聊天上传图件只能从当前用户的 chat-attachments 目录保存');
  }
  return requested;
}

async function resolveSourceFigure(userId: string, source: z.infer<typeof saveDraftFigureSchema>['source']): Promise<string> {
  const sourcePath = source.kind === 'r-code'
    ? resolveRSourceFigure(userId, source)
    : (source.kind === 'chat-upload'
        ? resolveChatUploadSourceFigure(userId, source)
        : resolveExperimentSourceFigure(userId, source));
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error('源图件不是文件');
  const ext = path.extname(sourcePath).toLowerCase();
  if (!FIGURE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持保存该图件格式：${ext || 'unknown'}`);
  }
  return sourcePath;
}

export function buildDraftFigureFileStem(figureLabel: unknown, title: unknown, requestedFileName: unknown): string {
  const requestedStem = path.parse(String(requestedFileName || '').trim()).name;
  const combined = requestedStem || [figureLabel, title].map(value => String(value || '').trim()).filter(Boolean).join('_');
  return (combined || 'Figure')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/[\s.]+$/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
    || 'Figure';
}

function toManifestRelativePath(assetRoot: string, filePath: string): string {
  return path.relative(assetRoot, filePath).replace(/\\/g, '/');
}

function sanitizeImportedDocumentName(value: unknown): string {
  const raw = path.basename(String(value || 'paper.docx')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
  return (raw || 'paper.docx').slice(0, 220);
}

function getWordImageExtension(contentType: string): string {
  const normalized = String(contentType || '').toLowerCase();
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
  if (normalized === 'image/gif') return '.gif';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/svg+xml') return '.svg';
  if (normalized === 'image/tiff') return '.tiff';
  if (normalized === 'image/bmp') return '.bmp';
  return '.png';
}

function isSupportedWordImage(contentType: string, buffer: Buffer): boolean {
  if (!buffer.length || buffer.length > 40 * 1024 * 1024) return false;
  return /^(?:image\/(?:png|jpe?g|gif|webp|svg\+xml|tiff|bmp))$/i.test(String(contentType || ''));
}

function latexEscape(value: string): string {
  return String(value || '')
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([{}#$%&_])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}');
}

function latexPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/([{}#%])/g, '\\$1');
}

export function buildFigureDraftBlock(asset: Pick<DraftFigureAsset, 'id' | 'figureLabel' | 'caption' | 'filePath'>): string {
  const figureLabel = normalizeDisplayText(asset.figureLabel, 'Figure', 120);
  const caption = normalizeDisplayText(asset.caption, figureLabel, 2000);
  const labelSlug = asset.id.replace(/[^a-zA-Z0-9_-]/g, '');
  return [
    `% scholar-figure:${asset.id}`,
    `\\begin{figure}[htbp]`,
    `\\centering`,
    `\\includegraphics[width=0.85\\textwidth]{${latexPath(asset.filePath)}}`,
    `\\caption{${latexEscape(caption)}}`,
    `\\label{fig:${labelSlug}}`,
    `\\end{figure}`,
  ].join('\n');
}

function normalizeHeadingText(value: string): string {
  return String(value || '')
    .replace(/\\[a-zA-Z]+\*?\{([^}]*)\}/g, '$1')
    .replace(/^[#\s]+/, '')
    .replace(/[：:。.\-_\s]+/g, '')
    .toLowerCase();
}

function subsectionHeadingTitle(subsectionId: string, subsectionTitle: string): string {
  const id = String(subsectionId || '').trim();
  const title = String(subsectionTitle || '').trim();
  if (id && title && !normalizeHeadingText(title).startsWith(normalizeHeadingText(id))) return `${id} ${title}`;
  return title || id || 'Figures';
}

function findSubsectionRange(content: string, subsectionId: string, subsectionTitle: string): { start: number; end: number } | null {
  const candidates = [subsectionTitle, subsectionId].map(normalizeHeadingText).filter(Boolean);
  if (candidates.length === 0) return null;

  const patterns = [
    /\\subsection\*?\{([^}]*)\}/g,
    /^##\s+(.+)$/gm,
  ];

  for (const pattern of patterns) {
    const matches = Array.from(content.matchAll(pattern));
    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index];
      const heading = normalizeHeadingText(match[1] || '');
      if (!candidates.some(candidate => heading.includes(candidate) || candidate.includes(heading))) continue;
      const nextMatch = matches[index + 1];
      const sectionAfter = content.slice((match.index || 0) + match[0].length).search(/\n\s*(?:\\section\*?\{|\\subsection\*?\{|##\s+)/);
      const fallbackEnd = sectionAfter >= 0
        ? (match.index || 0) + match[0].length + sectionAfter
        : content.length;
      return {
        start: match.index || 0,
        end: nextMatch?.index !== undefined ? Math.min(nextMatch.index, fallbackEnd) : fallbackEnd,
      };
    }
  }

  return null;
}

export function insertFigureBlockIntoDraft(
  draftContent: string,
  figureBlock: string,
  subsectionId: string,
  subsectionTitle: string
): string {
  const content = String(draftContent || '').trim();
  const block = String(figureBlock || '').trim();
  if (!block) return content;
  const marker = block.match(/scholar-figure:([a-zA-Z0-9_-]+)/)?.[0];
  if (marker && content.includes(marker)) return content;

  const endDocumentMatch = content.match(/\n\s*\\end\{document\}\s*$/);
  const bodyEnd = endDocumentMatch?.index ?? content.length;
  const body = content.slice(0, bodyEnd).trimEnd();
  const suffix = endDocumentMatch ? content.slice(bodyEnd) : '';
  const range = findSubsectionRange(body, subsectionId, subsectionTitle);

  if (range) {
    const before = body.slice(0, range.end).trimEnd();
    const after = body.slice(range.end).trimStart();
    return `${before}\n\n${block}${after ? `\n\n${after}` : ''}${suffix ? `\n${suffix.trimStart()}` : ''}`;
  }

  const heading = subsectionHeadingTitle(subsectionId, subsectionTitle);
  const insertion = `\\subsection{${latexEscape(heading)}}\n\n${block}`;
  return `${body ? `${body}\n\n` : ''}${insertion}${suffix ? `\n${suffix.trimStart()}` : ''}`;
}

export function removeFigureBlockFromDraft(draftContent: string, assetId: string): string {
  const safeAssetId = String(assetId || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeAssetId) return String(draftContent || '');
  const escapedId = safeAssetId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const figurePattern = new RegExp(
    `\\n?%\\s*scholar-figure:${escapedId}\\s*\\n\\\\begin\\{figure\\}[\\s\\S]*?\\\\end\\{figure\\}\\s*\\n?`,
    'g'
  );
  return String(draftContent || '')
    .replace(figurePattern, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function copyFigureToDraftAssets(input: {
  userId: string;
  sourcePath: string;
  chapterKey: string;
  subsectionKey: string;
  figureLabel?: string;
  title?: string;
  requestedFileName?: string;
}): Promise<{ id: string; filePath: string; relativePath: string; fileName: string }> {
  const assetRoot = getDraftAssetRoot(input.userId);
  const ext = path.extname(input.sourcePath).toLowerCase();
  const id = `fig_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const targetDir = path.join(assetRoot, input.chapterKey, input.subsectionKey);
  await fs.mkdir(targetDir, { recursive: true });
  const stem = buildDraftFigureFileStem(input.figureLabel, input.title, input.requestedFileName);
  let fileName = `${stem}${ext}`;
  let suffix = 2;
  while (fsSync.existsSync(path.join(targetDir, fileName))) {
    fileName = `${stem}-${suffix}${ext}`;
    suffix += 1;
  }
  const filePath = path.join(targetDir, fileName);
  await fs.copyFile(input.sourcePath, filePath);
  return {
    id,
    filePath,
    fileName,
    relativePath: toManifestRelativePath(assetRoot, filePath),
  };
}

async function appendFigureToDraft(sessionStore: SessionStore, asset: DraftFigureAsset): Promise<boolean> {
  const figureBlock = buildFigureDraftBlock(asset);
  let changed = false;
  await sessionStore.updateDraft(asset.userId, asset.chapterKey, current => {
    const existingContent = current?.content || '';
    const nextContent = insertFigureBlockIntoDraft(
      existingContent,
      figureBlock,
      asset.subsectionId || '',
      asset.subsectionTitle || ''
    );
    changed = nextContent !== existingContent;
    return nextContent;
  });
  return changed;
}

function getContentTypeForAsset(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.bmp') return 'image/bmp';
  if (ext === '.pdf') return 'application/pdf';
  if (ext === '.tif' || ext === '.tiff') return 'image/tiff';
  return 'image/png';
}

export function createDraftAssetsRouter(options: {
  sessionStore: SessionStore;
  onDraftUpdated?: (userId: string, chapterKey: string) => Promise<void>;
  resolveUserId?: (requestedUserId: string) => Promise<string>;
}): Router {
  const router = Router();
  const resolveDraftAssetUserId = async (value: unknown) => {
    const requested = sanitizeUserId(value || 'web-user');
    return sanitizeUserId(options.resolveUserId ? await options.resolveUserId(requested) : requested);
  };

  router.post('/import-word', wordSidebarUpload.single('file'), async (req, res) => {
    let createdImportDir = '';
    try {
      const body = importWordSidebarSchema.parse(req.body || {});
      const userId = await resolveDraftAssetUserId(body.userId);
      const upload = req.file;
      if (!upload?.buffer?.length) {
        res.status(400).json({ success: false, error: '请选择要导入的 .docx Word 文件' });
        return;
      }
      const documentName = sanitizeImportedDocumentName(upload.originalname);
      const parsed = await parseWordSidebarDocument(upload.buffer);
      const existingSections = await Promise.all(parsed.sections.map(async section => ({
        ...section,
        exists: Boolean(String((await options.sessionStore.loadDraft(userId, section.key))?.content || '').trim()),
      })));
      const supportedImages = parsed.images.filter(image => isSupportedWordImage(image.contentType, image.buffer));
      const skippedImageCount = parsed.images.length - supportedImages.length;

      if (body.mode === 'preview') {
        res.json({
          success: true,
          preview: true,
          documentName,
          sections: existingSections.map(section => ({
            key: section.key,
            title: section.title,
            chars: section.content.length,
            exists: section.exists,
          })),
          figures: supportedImages.map(image => ({
            figureLabel: image.figureLabel,
            caption: image.caption,
            chapterKey: image.chapterKey,
            chapterTitle: image.chapterTitle,
            bytes: image.buffer.length,
            contentType: image.contentType,
          })),
          warnings: [
            ...parsed.warnings,
            ...(skippedImageCount ? [`有 ${skippedImageCount} 张嵌入图片因格式或大小不受支持而跳过。`] : []),
          ],
          conflictCount: existingSections.filter(section => section.exists).length,
        });
        return;
      }

      if (parsed.sections.length === 0 && supportedImages.length === 0) {
        res.status(400).json({
          success: false,
          error: 'Word 中没有识别到标准章节或可导入图片，请检查文档是否使用了章节标题及嵌入图片。',
          warnings: parsed.warnings,
        });
        return;
      }

      const importId = `word_${Date.now()}_${randomUUID().replace(/-/g, '').slice(0, 8)}`;
      const assetRoot = getDraftAssetRoot(userId);
      createdImportDir = path.join(assetRoot, 'paper-figures', 'word-import', importId);
      const documentDir = path.join(assetRoot, 'word-import', 'documents');
      const backupDir = path.join(assetRoot, 'word-import', 'backups', importId);
      await Promise.all([
        fs.mkdir(createdImportDir, { recursive: true }),
        fs.mkdir(documentDir, { recursive: true }),
        fs.mkdir(backupDir, { recursive: true }),
      ]);

      const backupRecords = existingSections
        .filter(section => section.exists)
        .map(section => ({
          key: section.key,
          title: section.title,
          content: String(section.content || ''),
        }));
      const currentDraftBackups = await Promise.all(backupRecords.map(async section => ({
        key: section.key,
        title: section.title,
        content: String((await options.sessionStore.loadDraft(userId, section.key))?.content || ''),
      })));
      await fs.writeFile(
        path.join(backupDir, 'overwritten-drafts.json'),
        JSON.stringify({
          version: 1,
          documentName,
          importedAt: new Date().toISOString(),
          chapters: currentDraftBackups,
        }, null, 2),
        'utf-8'
      );
      const storedDocumentName = `${importId}-${documentName}`;
      await fs.writeFile(path.join(documentDir, storedDocumentName), upload.buffer);

      const createdAssets: DraftFigureAsset[] = [];
      const importedAt = new Date().toISOString();
      for (let index = 0; index < supportedImages.length; index += 1) {
        const image = supportedImages[index];
        const extension = getWordImageExtension(image.contentType);
        const id = `fig_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        const stem = buildDraftFigureFileStem(
          image.figureLabel || `Figure ${index + 1}`,
          image.caption,
          `${path.parse(documentName).name}-${image.figureLabel || `Figure-${index + 1}`}`
        );
        const fileName = `${stem}${extension}`;
        const filePath = path.join(createdImportDir, fileName);
        await fs.writeFile(filePath, image.buffer);
        const chapterKey = normalizeDraftAssetChapterKey(image.chapterKey || 'paper-figures');
        createdAssets.push({
          id,
          userId,
          chapterName: normalizeDisplayText(image.chapterTitle, chapterKey, 160),
          chapterKey,
          subsectionId: '',
          subsectionTitle: '',
          subsectionKey: 'word-import',
          figureLabel: normalizeDisplayText(image.figureLabel, `Figure ${index + 1}`, 120),
          title: normalizeDisplayText(image.caption, image.figureLabel || `Figure ${index + 1}`, 500),
          caption: normalizeDisplayText(image.caption, image.figureLabel || `Figure ${index + 1}`, 2000),
          originalFileName: fileName,
          fileName,
          filePath,
          relativePath: toManifestRelativePath(assetRoot, filePath),
          url: `/api/draft-assets/figure/${encodeURIComponent(userId)}/${encodeURIComponent(id)}`,
          source: {
            kind: 'word-import',
            documentName,
            importId,
            figureIndex: index,
            relativePath: toManifestRelativePath(assetRoot, filePath),
          },
          draftLinked: false,
          createdAt: importedAt,
        });
      }

      for (const section of parsed.sections) {
        await options.sessionStore.updateDraft(userId, section.key, () => section.content);
      }

      let replacedAssets: DraftFigureAsset[] = [];
      await withDraftFigureManifestLock(userId, async () => {
        const manifest = await loadDraftFigureManifest(userId);
        replacedAssets = manifest.figures.filter(asset =>
          asset.source?.kind === 'word-import'
          && String(asset.source.documentName || '').toLowerCase() === documentName.toLowerCase()
        );
        manifest.figures = manifest.figures
          .filter(asset => !replacedAssets.some(previous => previous.id === asset.id))
          .concat(createdAssets);
        await saveDraftFigureManifest(userId, manifest);
      });

      await Promise.all(replacedAssets.map(async asset => {
        try {
          await fs.rm(resolveScopedFile(assetRoot, asset.relativePath), { force: true });
        } catch (error) {
          logger.warn(`[DraftAssets] Could not remove replaced Word figure ${asset.relativePath}: ${(error as Error).message}`);
        }
      }));
      for (const section of parsed.sections) {
        if (options.onDraftUpdated) await options.onDraftUpdated(userId, section.key);
      }

      logger.info(
        `[DraftAssets] Imported Word ${documentName} for ${userId}; `
        + `chapters=${parsed.sections.length}, figures=${createdAssets.length}, overwritten=${existingSections.filter(section => section.exists).length}`
      );
      res.json({
        success: true,
        preview: false,
        documentName,
        importedSections: parsed.sections.map(section => ({
          key: section.key,
          title: section.title,
          chars: section.content.length,
          overwritten: existingSections.some(existing => existing.key === section.key && existing.exists),
        })),
        importedFigures: createdAssets.map(asset => ({
          id: asset.id,
          figureLabel: asset.figureLabel,
          caption: asset.caption,
          chapterKey: asset.chapterKey,
          url: asset.url,
        })),
        replacedFigureCount: replacedAssets.length,
        backupPath: toManifestRelativePath(assetRoot, path.join(backupDir, 'overwritten-drafts.json')),
        warnings: [
          ...parsed.warnings,
          ...(skippedImageCount ? [`有 ${skippedImageCount} 张嵌入图片因格式或大小不受支持而跳过。`] : []),
        ],
      });
    } catch (error) {
      if (createdImportDir) {
        await fs.rm(createdImportDir, { recursive: true, force: true }).catch(() => undefined);
      }
      logger.error('[DraftAssets] Import Word into sidebar failed:', error);
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json({ success: false, error: (error as Error).message || '导入 Word 失败' });
    }
  });

  router.post('/figures', async (req, res) => {
    try {
      const body = saveDraftFigureSchema.parse(req.body || {});
      const userId = await resolveDraftAssetUserId(body.userId);
      const chapterKey = normalizeDraftAssetChapterKey(body.chapterName);
      const chapterName = normalizeDisplayText(body.chapterName, chapterKey, 160);
      const subsectionKey = sanitizeDraftChapterName(body.subsectionId || body.subsectionTitle || DEFAULT_SUBSECTION_KEY);
      const sourcePath = await resolveSourceFigure(userId, body.source);
      const figureLabel = normalizeDisplayText(body.figureLabel, 'Figure', 120);
      const title = normalizeDisplayText(body.title, '', 500);
      const caption = normalizeDisplayText(body.caption, figureLabel, 2000);
      const copied = await copyFigureToDraftAssets({
        userId,
        sourcePath,
        chapterKey,
        subsectionKey,
        figureLabel,
        title,
        requestedFileName: body.requestedFileName,
      });
      const asset: DraftFigureAsset = {
        id: copied.id,
        userId,
        chapterName,
        chapterKey,
        subsectionId: normalizeDisplayText(body.subsectionId, '', 160),
        subsectionTitle: normalizeDisplayText(body.subsectionTitle, '', 260),
        subsectionKey,
        figureLabel,
        title,
        caption,
        originalFileName: path.basename(sourcePath),
        fileName: copied.fileName,
        filePath: copied.filePath,
        relativePath: copied.relativePath,
        url: `/api/draft-assets/figure/${encodeURIComponent(userId)}/${encodeURIComponent(copied.id)}`,
        source: body.source,
        draftLinked: true,
        createdAt: new Date().toISOString(),
      };

      await withDraftFigureManifestLock(userId, async () => {
        const manifest = await loadDraftFigureManifest(userId);
        manifest.figures.push(asset);
        await saveDraftFigureManifest(userId, manifest);
      });
      const draftUpdated = await appendFigureToDraft(options.sessionStore, asset);
      if (draftUpdated && options.onDraftUpdated) {
        await options.onDraftUpdated(userId, chapterKey);
      }

      logger.info(`[DraftAssets] Saved ${asset.id} to ${userId}/${chapterKey}/${subsectionKey}`);
      res.json({ success: true, asset, draftUpdated });
    } catch (error) {
      logger.error('[DraftAssets] Save figure failed:', error);
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json({ success: false, error: (error as Error).message || '保存图件失败' });
    }
  });

  router.post('/figures/library', async (req, res) => {
    try {
      const body = savePaperFigureSchema.parse(req.body || {});
      const userId = await resolveDraftAssetUserId(body.userId);
      const chapterKey = body.chapterName ? normalizeDraftAssetChapterKey(body.chapterName) : 'paper-figures';
      const chapterName = normalizeDisplayText(body.chapterName, '论文图片', 160);
      const subsectionKey = sanitizeDraftChapterName(body.subsectionId || body.subsectionTitle || 'library');
      const sourcePath = await resolveSourceFigure(userId, body.source);
      const figureLabel = normalizeDisplayText(body.figureLabel, 'Figure', 120);
      const title = normalizeDisplayText(body.title, '', 500);
      const caption = normalizeDisplayText(body.caption, title || figureLabel, 2000);
      const copied = await copyFigureToDraftAssets({
        userId,
        sourcePath,
        chapterKey,
        subsectionKey,
        figureLabel,
        title,
        requestedFileName: body.requestedFileName,
      });
      const asset: DraftFigureAsset = {
        id: copied.id,
        userId,
        chapterName,
        chapterKey,
        subsectionId: normalizeDisplayText(body.subsectionId, '', 160),
        subsectionTitle: normalizeDisplayText(body.subsectionTitle, '', 260),
        subsectionKey,
        figureLabel,
        title,
        caption,
        originalFileName: path.basename(sourcePath),
        fileName: copied.fileName,
        filePath: copied.filePath,
        relativePath: copied.relativePath,
        url: `/api/draft-assets/figure/${encodeURIComponent(userId)}/${encodeURIComponent(copied.id)}`,
        source: body.source,
        draftLinked: false,
        createdAt: new Date().toISOString(),
      };

      await withDraftFigureManifestLock(userId, async () => {
        const manifest = await loadDraftFigureManifest(userId);
        manifest.figures.push(asset);
        await saveDraftFigureManifest(userId, manifest);
      });

      logger.info(`[DraftAssets] Archived paper figure ${asset.id} for ${userId}`);
      res.json({ success: true, asset, draftUpdated: false });
    } catch (error) {
      logger.error('[DraftAssets] Archive paper figure failed:', error);
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json({ success: false, error: (error as Error).message || '保存论文图片失败' });
    }
  });

  router.patch('/figures/:assetId', async (req, res) => {
    try {
      const body = updatePaperFigureSchema.parse(req.body || {});
      const userId = await resolveDraftAssetUserId(body.userId);
      const assetId = String(req.params.assetId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const asset = await withDraftFigureManifestLock(userId, async () => {
        const manifest = await loadDraftFigureManifest(userId);
        const index = manifest.figures.findIndex(item => item.id === assetId);
        if (index < 0) throw new Error('图件不存在');
        const current = manifest.figures[index];
        manifest.figures[index] = {
          ...current,
          ...(body.figureLabel !== undefined ? { figureLabel: normalizeDisplayText(body.figureLabel, 'Figure', 120) } : {}),
          ...(body.title !== undefined ? { title: normalizeDisplayText(body.title, '', 500) } : {}),
          ...(body.caption !== undefined ? { caption: normalizeDisplayText(body.caption, current.figureLabel || 'Figure', 2000) } : {}),
        };
        await saveDraftFigureManifest(userId, manifest);
        return manifest.figures[index];
      });
      res.json({ success: true, asset });
    } catch (error) {
      logger.error('[DraftAssets] Update paper figure failed:', error);
      const status = error instanceof z.ZodError ? 400 : ((error as Error).message === '图件不存在' ? 404 : 500);
      res.status(status).json({ success: false, error: (error as Error).message || '更新论文图片失败' });
    }
  });

  router.delete('/figures', async (req, res) => {
    try {
      const body = deletePaperFiguresSchema.parse(req.body || {});
      const userId = await resolveDraftAssetUserId(body.userId);
      const requestedIds = new Set(body.assetIds);
      const removedAssets = await withDraftFigureManifestLock(userId, async () => {
        const manifest = await loadDraftFigureManifest(userId);
        const removed = manifest.figures.filter(asset => requestedIds.has(asset.id));
        if (removed.length !== requestedIds.size) {
          const foundIds = new Set(removed.map(asset => asset.id));
          const missing = body.assetIds.filter(assetId => !foundIds.has(assetId));
          throw new Error(`图件不存在：${missing.join(', ')}`);
        }
        manifest.figures = manifest.figures.filter(asset => !requestedIds.has(asset.id));
        await saveDraftFigureManifest(userId, manifest);
        return removed;
      });

      const assetRoot = path.resolve(getDraftAssetRoot(userId));
      await Promise.all(removedAssets.map(async asset => {
        try {
          await fs.rm(resolveScopedFile(assetRoot, asset.relativePath), { force: true });
        } catch (error) {
          logger.warn(`[DraftAssets] Removed manifest entry but could not remove ${asset.relativePath}: ${(error as Error).message}`);
        }
      }));

      const linkedByChapter = new Map<string, string[]>();
      removedAssets.filter(asset => asset.draftLinked).forEach(asset => {
        const ids = linkedByChapter.get(asset.chapterKey) || [];
        ids.push(asset.id);
        linkedByChapter.set(asset.chapterKey, ids);
      });
      for (const [chapterKey, assetIds] of linkedByChapter.entries()) {
        let changed = false;
        await options.sessionStore.updateDraft(userId, chapterKey, current => {
          const previous = current?.content || '';
          const next = assetIds.reduce(removeFigureBlockFromDraft, previous);
          changed = next !== previous;
          return next;
        });
        if (changed && options.onDraftUpdated) await options.onDraftUpdated(userId, chapterKey);
      }

      logger.info(`[DraftAssets] Deleted ${removedAssets.length} paper figure(s) for ${userId}`);
      res.json({ success: true, deletedIds: removedAssets.map(asset => asset.id), deletedCount: removedAssets.length });
    } catch (error) {
      logger.error('[DraftAssets] Delete paper figures failed:', error);
      const message = (error as Error).message || '删除论文图片失败';
      const status = error instanceof z.ZodError ? 400 : (message.startsWith('图件不存在') ? 404 : 500);
      res.status(status).json({ success: false, error: message });
    }
  });

  router.post('/figures/merge', async (req, res) => {
    try {
      const body = mergePaperFiguresSchema.parse(req.body || {});
      const userId = await resolveDraftAssetUserId(body.userId);
      const manifest = await loadDraftFigureManifest(userId);
      const assetById = new Map(manifest.figures.map(asset => [asset.id, asset]));
      const sourceAssets = body.assetIds.map(assetId => assetById.get(assetId));
      const missingIds = body.assetIds.filter((_, index) => !sourceAssets[index]);
      if (missingIds.length) throw new Error(`图件不存在：${missingIds.join(', ')}`);

      const match = body.dataUrl.match(/^data:image\/png;base64,([a-zA-Z0-9+/=\r\n]+)$/);
      if (!match) throw new Error('合并图片数据必须是 PNG');
      const imageBuffer = Buffer.from(match[1], 'base64');
      const pngSignature = imageBuffer.subarray(0, 8).toString('hex');
      if (!imageBuffer.length || pngSignature !== '89504e470d0a1a0a') throw new Error('合并后的 PNG 数据无效');
      if (imageBuffer.length > 40 * 1024 * 1024) throw new Error('合并后的图片超过 40 MB，请降低原图尺寸后重试');

      const assetRoot = getDraftAssetRoot(userId);
      const targetDir = path.join(assetRoot, 'paper-figures', 'merged');
      await fs.mkdir(targetDir, { recursive: true });
      const id = `fig_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const figureLabel = normalizeDisplayText(body.figureLabel, 'Figure', 120);
      const title = normalizeDisplayText(body.title, 'Merged figure', 500);
      const caption = normalizeDisplayText(body.caption, title || figureLabel, 2000);
      const stem = buildDraftFigureFileStem(figureLabel, title, '');
      let fileName = `${stem}.png`;
      let suffix = 2;
      while (fsSync.existsSync(path.join(targetDir, fileName))) {
        fileName = `${stem}-${suffix}.png`;
        suffix += 1;
      }
      const filePath = path.join(targetDir, fileName);
      await fs.writeFile(filePath, imageBuffer);
      const asset: DraftFigureAsset = {
        id,
        userId,
        chapterName: '论文图片',
        chapterKey: 'paper-figures',
        subsectionId: '',
        subsectionTitle: '',
        subsectionKey: 'merged',
        figureLabel,
        title,
        caption,
        originalFileName: fileName,
        fileName,
        filePath,
        relativePath: toManifestRelativePath(assetRoot, filePath),
        url: `/api/draft-assets/figure/${encodeURIComponent(userId)}/${encodeURIComponent(id)}`,
        source: { kind: 'merged-library', sourceAssetIds: body.assetIds },
        draftLinked: false,
        createdAt: new Date().toISOString(),
      };
      await withDraftFigureManifestLock(userId, async () => {
        const current = await loadDraftFigureManifest(userId);
        current.figures.push(asset);
        await saveDraftFigureManifest(userId, current);
      });

      logger.info(`[DraftAssets] Merged ${body.assetIds.length} paper figures into ${id} for ${userId}`);
      res.json({ success: true, asset });
    } catch (error) {
      logger.error('[DraftAssets] Merge paper figures failed:', error);
      const message = (error as Error).message || '合并论文图片失败';
      const status = error instanceof z.ZodError ? 400 : (message.startsWith('图件不存在') ? 404 : 500);
      res.status(status).json({ success: false, error: message });
    }
  });

  router.get('/figures', async (req, res) => {
    try {
      const userId = await resolveDraftAssetUserId(req.query.userId);
      const chapterKey = req.query.chapterName ? normalizeDraftAssetChapterKey(req.query.chapterName) : '';
      const subsectionKey = req.query.subsectionId ? sanitizeDraftChapterName(req.query.subsectionId) : '';
      const figures = sortDraftFigureAssetsForDisplay((await loadDraftFigureManifest(userId)).figures.filter(asset => {
        if (chapterKey && asset.chapterKey !== chapterKey) return false;
        if (subsectionKey && asset.subsectionKey !== subsectionKey) return false;
        return true;
      }));
      res.json({ success: true, figures });
    } catch (error) {
      logger.error('[DraftAssets] List figures failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || '读取图件失败' });
    }
  });

  router.get('/figure/:userId/:assetId', async (req, res) => {
    try {
      const userId = await resolveDraftAssetUserId(req.params.userId);
      const assetId = String(req.params.assetId || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const asset = (await loadDraftFigureManifest(userId)).figures.find(item => item.id === assetId);
      if (!asset) {
        res.status(404).json({ success: false, error: '图件不存在' });
        return;
      }
      const assetRoot = path.resolve(getDraftAssetRoot(userId));
      const filePath = resolveScopedFile(assetRoot, asset.relativePath);
      res.type(getContentTypeForAsset(filePath));
      res.sendFile(filePath);
    } catch (error) {
      logger.error('[DraftAssets] Serve figure failed:', error);
      res.status(400).json({ success: false, error: (error as Error).message || '读取图件文件失败' });
    }
  });

  return router;
}

export default createDraftAssetsRouter;
