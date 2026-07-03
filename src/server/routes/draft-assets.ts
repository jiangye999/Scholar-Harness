import { randomUUID } from 'crypto';
import { Router } from 'express';
import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { SessionStore, sanitizeDraftChapterName } from '../../storage/session-store';
import { getDataDir, getUserUploadDir, sanitizeUserId } from '../../utils/paths';
import { logger } from '../../utils/logger';

const MANIFEST_VERSION = 1;
const DEFAULT_SUBSECTION_KEY = 'section';
const FIGURE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.tif', '.tiff', '.bmp', '.gif', '.pdf']);

export interface DraftFigureAsset {
  id: string;
  userId: string;
  chapterName: string;
  chapterKey: string;
  subsectionId?: string;
  subsectionTitle?: string;
  subsectionKey: string;
  figureLabel: string;
  caption: string;
  fileName: string;
  filePath: string;
  relativePath: string;
  url: string;
  source: {
    kind: 'r-code' | 'experiment-results';
    jobId?: string;
    relativePath?: string;
    originalPath?: string;
    url?: string;
  };
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
  caption: z.string().max(2000).optional().default(''),
  source: z.object({
    kind: z.enum(['r-code', 'experiment-results']),
    jobId: z.string().max(120).optional(),
    relativePath: z.string().max(500).optional(),
    originalPath: z.string().max(1000).optional(),
    url: z.string().max(1000).optional(),
  }),
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
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
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

async function resolveSourceFigure(userId: string, source: z.infer<typeof saveDraftFigureSchema>['source']): Promise<string> {
  const sourcePath = source.kind === 'r-code'
    ? resolveRSourceFigure(userId, source)
    : resolveExperimentSourceFigure(userId, source);
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error('源图件不是文件');
  const ext = path.extname(sourcePath).toLowerCase();
  if (!FIGURE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持保存该图件格式：${ext || 'unknown'}`);
  }
  return sourcePath;
}

function toManifestRelativePath(assetRoot: string, filePath: string): string {
  return path.relative(assetRoot, filePath).replace(/\\/g, '/');
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

async function copyFigureToDraftAssets(input: {
  userId: string;
  sourcePath: string;
  chapterKey: string;
  subsectionKey: string;
}): Promise<{ id: string; filePath: string; relativePath: string; fileName: string }> {
  const assetRoot = getDraftAssetRoot(input.userId);
  const ext = path.extname(input.sourcePath).toLowerCase();
  const id = `fig_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const fileName = `${id}${ext}`;
  const targetDir = path.join(assetRoot, input.chapterKey, input.subsectionKey);
  await fs.mkdir(targetDir, { recursive: true });
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
  const existing = await sessionStore.loadDraft(asset.userId, asset.chapterKey);
  const figureBlock = buildFigureDraftBlock(asset);
  const nextContent = insertFigureBlockIntoDraft(
    existing?.content || '',
    figureBlock,
    asset.subsectionId || '',
    asset.subsectionTitle || ''
  );
  if (nextContent === (existing?.content || '')) return false;
  await sessionStore.saveDraft(asset.userId, asset.chapterKey, nextContent);
  return true;
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

export function createDraftAssetsRouter(options: { sessionStore: SessionStore }): Router {
  const router = Router();

  router.post('/figures', async (req, res) => {
    try {
      const body = saveDraftFigureSchema.parse(req.body || {});
      const userId = sanitizeUserId(body.userId || 'web-user');
      const chapterKey = normalizeDraftAssetChapterKey(body.chapterName);
      const chapterName = normalizeDisplayText(body.chapterName, chapterKey, 160);
      const subsectionKey = sanitizeDraftChapterName(body.subsectionId || body.subsectionTitle || DEFAULT_SUBSECTION_KEY);
      const sourcePath = await resolveSourceFigure(userId, body.source);
      const copied = await copyFigureToDraftAssets({ userId, sourcePath, chapterKey, subsectionKey });
      const figureLabel = normalizeDisplayText(body.figureLabel, 'Figure', 120);
      const caption = normalizeDisplayText(body.caption, figureLabel, 2000);
      const asset: DraftFigureAsset = {
        id: copied.id,
        userId,
        chapterName,
        chapterKey,
        subsectionId: normalizeDisplayText(body.subsectionId, '', 160),
        subsectionTitle: normalizeDisplayText(body.subsectionTitle, '', 260),
        subsectionKey,
        figureLabel,
        caption,
        fileName: copied.fileName,
        filePath: copied.filePath,
        relativePath: copied.relativePath,
        url: `/api/draft-assets/figure/${encodeURIComponent(userId)}/${encodeURIComponent(copied.id)}`,
        source: body.source,
        createdAt: new Date().toISOString(),
      };

      const manifest = await loadDraftFigureManifest(userId);
      manifest.figures.push(asset);
      await saveDraftFigureManifest(userId, manifest);
      const draftUpdated = await appendFigureToDraft(options.sessionStore, asset);

      logger.info(`[DraftAssets] Saved ${asset.id} to ${userId}/${chapterKey}/${subsectionKey}`);
      res.json({ success: true, asset, draftUpdated });
    } catch (error) {
      logger.error('[DraftAssets] Save figure failed:', error);
      const status = error instanceof z.ZodError ? 400 : 500;
      res.status(status).json({ success: false, error: (error as Error).message || '保存图件失败' });
    }
  });

  router.get('/figures', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.query.userId || 'web-user');
      const chapterKey = req.query.chapterName ? normalizeDraftAssetChapterKey(req.query.chapterName) : '';
      const subsectionKey = req.query.subsectionId ? sanitizeDraftChapterName(req.query.subsectionId) : '';
      const figures = (await loadDraftFigureManifest(userId)).figures.filter(asset => {
        if (chapterKey && asset.chapterKey !== chapterKey) return false;
        if (subsectionKey && asset.subsectionKey !== subsectionKey) return false;
        return true;
      });
      res.json({ success: true, figures });
    } catch (error) {
      logger.error('[DraftAssets] List figures failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message || '读取图件失败' });
    }
  });

  router.get('/figure/:userId/:assetId', async (req, res) => {
    try {
      const userId = sanitizeUserId(req.params.userId || 'web-user');
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
