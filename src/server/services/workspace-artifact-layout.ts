/**
 * Workspace artifact layout (AI 工作区产物目录规范).
 *
 * Spec: docs/workspace-artifact-layout.md
 *
 * Every conversation-scoped AI work root (`<workspaceRoot>/ScholarHarness_AI_Workspaces/
 * Conversation-<id>/`) follows one canonical structure:
 *
 *   drafts/                    草稿：word 草稿 + 代码文件
 *   figures_tables/            图表总文件夹
 *     figures_tables.docx      图片整合文件（图注在图下；表头在表上、注解在表下）
 *     figure1/…figureN/        每图一个子文件夹
 *       figureN.png            图片位图
 *       figureN.pdf            矢量版
 *       figureN.R|.py          作图代码
 *       figureN_data.csv       作图数据
 *     table1/…tableN/          每表一个子文件夹
 *       table1.png / table1.pdf
 *       table1.R|.py
 *       table1_data.csv
 *   supplementary/             补充图表与稳定补充材料 Word
 *     supplementary-materials.docx
 *     figure1/… / table1/…     与正文图表相同的单项结构
 *
 * This service scans an AI work root, organizes loose figure/table assets into
 * the canonical sub-folders, and can regenerate the integrated Word document.
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { logger } from '../../utils/logger';
import {
  WordFigureTableEntry,
  writeFigureTableDocx,
} from '../../utils/word-draft-docx';

export const WORKSPACE_ARTIFACT_LAYOUT = {
  draftsDir: 'drafts',
  figuresTablesDir: 'figures_tables',
  integratedDocxName: 'figures_tables.docx',
  supplementaryDir: 'supplementary',
  supplementaryDocxName: 'supplementary-materials.docx',
} as const;

export const PROJECT_CUMULATIVE_ARTIFACTS_DIRECTORY_NAME = '项目累计产物';

/** Matches workspace-directory.ts: the AI workspace container inside the user root. */
export const AI_WORKSPACE_CONTAINER_NAME = 'ScholarHarness_AI_Workspaces';
const USER_VIEW_DIRECTORY_NAME = '用户查看';
const AI_SOURCE_COPY_DIRECTORY_NAME = '源文件副本';

export type FigureTableAssetRole = 'image' | 'pdf' | 'code' | 'data' | 'other';

const ASSET_ROLE_BY_EXTENSION: Record<string, FigureTableAssetRole> = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.tif': 'image',
  '.tiff': 'image', '.svg': 'image', '.bmp': 'image', '.webp': 'image', '.gif': 'image',
  '.pdf': 'pdf',
  '.r': 'code', '.rmd': 'code', '.qmd': 'code', '.py': 'code', '.ipynb': 'code',
  '.do': 'code', '.m': 'code', '.sas': 'code', '.sps': 'code', '.spss': 'code',
  '.csv': 'data', '.tsv': 'data', '.xlsx': 'data', '.xls': 'data',
  '.json': 'data', '.dat': 'data', '.txt': 'data',
};

const SKIPPED_SCAN_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.cache', '__pycache__']);

export interface FigureTableAsset {
  key: string;
  kind: 'figure' | 'table';
  index: number;
  role: FigureTableAssetRole;
  absolutePath: string;
  /** Path relative to the AI work root, forward slashes. */
  relativePath: string;
  /** True when the file already sits inside its canonical figures_tables/<key>/ folder. */
  canonical: boolean;
}

export interface FigureTableEntry {
  key: string;
  kind: 'figure' | 'table';
  index: number;
  /** Directory relative to the AI work root, e.g. "figures_tables/figure1". */
  dir: string;
  assets: FigureTableAsset[];
}

export interface ArtifactLayoutView {
  aiWorkRoot: string;
  draftsDir: string;
  figuresTablesDir: string;
  integratedDocxPath: string;
  entries: FigureTableEntry[];
}

export interface OrganizeAssetMove {
  from: string;
  to: string;
}

export interface OrganizeResult {
  layout: ArtifactLayoutView;
  moved: OrganizeAssetMove[];
  copied: OrganizeAssetMove[];
  skipped: Array<{ path: string; reason: string }>;
  unclassified: Array<{ path: string; reason: string }>;
}

export interface FigureTableCaptionInput {
  /** Rendered below a figure image (图注), or as the table title (表题). */
  caption?: string;
  /** Rendered below the caption / below the table (注解). */
  note?: string;
}

export interface IntegratedDocxBuildResult {
  docxPath: string;
  docxRelativePath: string;
  included: Array<{ key: string; kind: 'figure' | 'table'; source: string }>;
  skipped: Array<{ key: string; reason: string }>;
}

export interface IntegratedDocxBuildOptions {
  collection?: 'main' | 'supplementary';
}

function normalizeRelative(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function isSubPath(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Parse "figure1" / "Figure 1" / "fig 3" / "图2" / "table1" / "表 4" style keys. */
export function parseFigureTableKey(value: string): { kind: 'figure' | 'table'; index: number } | null {
  const cleaned = String(value || '').trim();
  const figureMatch = cleaned.match(/^(?:figure|fig)\s*[._-]?\s*(\d+)$/i);
  if (figureMatch) return { kind: 'figure', index: Number(figureMatch[1]) };
  const tableMatch = cleaned.match(/^(?:table|tab)\s*[._-]?\s*(\d+)$/i);
  if (tableMatch) return { kind: 'table', index: Number(tableMatch[1]) };
  const cjkFigureMatch = cleaned.match(/^图\s*(\d+)$/);
  if (cjkFigureMatch) return { kind: 'figure', index: Number(cjkFigureMatch[1]) };
  const cjkTableMatch = cleaned.match(/^表\s*(\d+)$/);
  if (cjkTableMatch) return { kind: 'table', index: Number(cjkTableMatch[1]) };
  return null;
}

export function figureTableKey(kind: 'figure' | 'table', index: number): string {
  return `${kind}${index}`;
}

export function figureTableDisplayLabel(key: string): string {
  const parsed = parseFigureTableKey(key);
  if (!parsed) return key;
  return `${parsed.kind === 'figure' ? 'Figure' : 'Table'} ${parsed.index}`;
}

export function classifyAssetRole(filePath: string): FigureTableAssetRole {
  return ASSET_ROLE_BY_EXTENSION[path.extname(filePath).toLowerCase()] || 'other';
}

export function resolveArtifactDirs(aiWorkRoot: string): {
  draftsDir: string;
  figuresTablesDir: string;
  integratedDocxPath: string;
} {
  const draftsDir = path.join(aiWorkRoot, WORKSPACE_ARTIFACT_LAYOUT.draftsDir);
  const figuresTablesDir = path.join(aiWorkRoot, WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir);
  return {
    draftsDir,
    figuresTablesDir,
    integratedDocxPath: path.join(figuresTablesDir, WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName),
  };
}

/**
 * Conversation workbenches are intentionally isolated, but figure/table
 * sources are project-scoped deliverables. Keep a cumulative source root next
 * to the Conversation-* folders so a later conversation cannot rebuild the
 * stable Word from only its own newly-created assets.
 */
export function resolveProjectCumulativeArtifactRoot(aiWorkRoot: string): string {
  const resolved = path.resolve(aiWorkRoot);
  return path.basename(resolved).toLowerCase().startsWith('conversation-')
    ? path.join(path.dirname(resolved), PROJECT_CUMULATIVE_ARTIFACTS_DIRECTORY_NAME)
    : resolved;
}

/** Canonical file name for an asset inside a figureN/tableN folder. */
export function canonicalAssetFilename(key: string, role: FigureTableAssetRole, sourcePath: string): string {
  const lowerExtension = path.extname(sourcePath).toLowerCase();
  if (role === 'image') return `${key}${lowerExtension || '.png'}`;
  if (role === 'pdf') return `${key}.pdf`;
  if (role === 'code') {
    // Keep the original extension case for code files (.R stays .R).
    const rawExtension = path.extname(sourcePath);
    return `${key}${rawExtension || '.R'}`;
  }
  if (role === 'data') return `${key}_data${lowerExtension || '.csv'}`;
  return `${key}${lowerExtension || '.bin'}`;
}

function parseEntryKeyFromRelative(relativePath: string, fileBase: string): { kind: 'figure' | 'table'; index: number } | null {
  const parts = normalizeRelative(relativePath).split('/');
  // figures_tables/figure1/... — the directory name carries the key.
  for (const part of parts) {
    if (part === WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir) continue;
    const parsed = parseFigureTableKey(part);
    if (parsed) return parsed;
    const withoutExtension = part.replace(/\.[^.]+$/, '');
    if (withoutExtension !== part) {
      const parsedWithoutExtension = parseFigureTableKey(withoutExtension);
      if (parsedWithoutExtension) return parsedWithoutExtension;
    }
  }
  // Otherwise fall back to the file name (fig1.png, table2.csv …).
  const fromFile = parseFigureTableKey(fileBase);
  if (fromFile) return fromFile;
  const baseWithoutExtension = fileBase.replace(/\.[^.]+$/, '');
  const fromBaseWithoutExtension = parseFigureTableKey(baseWithoutExtension);
  if (fromBaseWithoutExtension) return fromBaseWithoutExtension;
  return null;
}

async function walkAiWorkFiles(aiWorkRoot: string): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const rows: Array<{ absolutePath: string; relativePath: string }> = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (SKIPPED_SCAN_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === AI_SOURCE_COPY_DIRECTORY_NAME) continue;
        await walk(absolutePath);
      } else if (entry.isFile()) {
        rows.push({
          absolutePath,
          relativePath: normalizeRelative(path.relative(aiWorkRoot, absolutePath)),
        });
      }
    }
  }
  await walk(aiWorkRoot);
  return rows;
}

function isIntegratedDocxPath(relativePath: string, figuresTablesDir: string): boolean {
  return normalizeRelative(relativePath) ===
    normalizeRelative(path.relative(figuresTablesDir, path.join(figuresTablesDir, WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName)))
    || path.basename(relativePath) === WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName;
}

/**
 * Scan the AI work root and group figure/table assets by canonical key.
 * Returns canonical entries plus loose assets that have no recognizable key.
 */
export async function scanFigureTableAssets(aiWorkRoot: string): Promise<{
  entries: FigureTableEntry[];
  loose: FigureTableAsset[];
}> {
  const dirs = resolveArtifactDirs(aiWorkRoot);
  const files = await walkAiWorkFiles(aiWorkRoot);

  const byKey = new Map<string, FigureTableEntry>();
  const loose: FigureTableAsset[] = [];

  for (const file of files) {
    if (isIntegratedDocxPath(file.relativePath, dirs.figuresTablesDir)) continue;
    const base = path.basename(file.absolutePath);
    if (base.toLowerCase().startsWith(WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir)) continue;

    const parsed = parseEntryKeyFromRelative(file.relativePath, base);
    if (!parsed) {
      loose.push({
        key: '',
        kind: 'figure',
        index: 0,
        role: classifyAssetRole(file.absolutePath),
        absolutePath: file.absolutePath,
        relativePath: file.relativePath,
        canonical: false,
      });
      continue;
    }

    const key = figureTableKey(parsed.kind, parsed.index);
    const canonicalDir = path.join(dirs.figuresTablesDir, key);
    const canonical = normalizeRelative(file.relativePath).startsWith(
      normalizeRelative(path.relative(aiWorkRoot, canonicalDir))
    );

    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        key,
        kind: parsed.kind,
        index: parsed.index,
        dir: normalizeRelative(path.relative(aiWorkRoot, canonicalDir)),
        assets: [],
      };
      byKey.set(key, entry);
    }
    entry.assets.push({
      key,
      kind: parsed.kind,
      index: parsed.index,
      role: classifyAssetRole(file.absolutePath),
      absolutePath: file.absolutePath,
      relativePath: file.relativePath,
      canonical,
    });
  }

  const entries = Array.from(byKey.values()).sort((a, b) =>
    a.kind === b.kind ? a.index - b.index : (a.kind === 'figure' ? -1 : 1)
  );
  return { entries, loose };
}

function readCaptionFileContent(entryDir: string, key: string): Promise<string | null> {
  return fs.readFile(path.join(entryDir, `${key}_caption.md`), 'utf-8')
    .catch(() => fs.readFile(path.join(entryDir, `${key}_caption.txt`), 'utf-8'))
    .catch(() => null);
}

/** Read "figure1_caption.md|txt" inside the entry folder: first line = title/caption, rest = note. */
export async function readEntryCaption(entryDir: string, key: string): Promise<{ caption: string; note: string } | null> {
  const content = await readCaptionFileContent(entryDir, key);
  if (content == null) return null;
  const lines = String(content).split(/\r?\n/).map(line => line.replace(/^#+\s*/, '').trim());
  const firstMeaningful = lines.findIndex(line => line.length > 0);
  if (firstMeaningful === -1) return null;
  const caption = lines[firstMeaningful];
  const note = lines.slice(firstMeaningful + 1).filter(line => line.length > 0).join('\n');
  return { caption, note: note || '' };
}

function parseSimpleCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const content = String(text || '');
  for (let index = 0; index < content.length; index += 1) {
    const ch = content[index];
    if (inQuotes) {
      if (ch === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some(cell => cell.trim())) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some(cell => cell.trim())) rows.push(row);
  }
  return rows;
}

async function readTableDataCsv(csvPath: string, maxRows = 40): Promise<{ headers: string[]; rows: string[][] } | null> {
  const content = await fs.readFile(csvPath, 'utf-8').catch(() => null);
  if (content == null) return null;
  const parsed = parseSimpleCsv(content).filter(row => row.some(cell => cell.trim()));
  if (parsed.length === 0) return null;
  const headers = parsed[0].map(cell => String(cell).trim());
  const rows = parsed.slice(1, maxRows + 1).map(row => row.map(cell => String(cell).trim()));
  return { headers, rows };
}

async function scanCollectionEntries(
  aiWorkRoot: string,
  collectionDirectory: string,
  outputDocxName: string,
): Promise<FigureTableEntry[]> {
  const collectionRoot = path.join(aiWorkRoot, collectionDirectory);
  const files = await walkAiWorkFiles(collectionRoot);
  const byKey = new Map<string, FigureTableEntry>();

  for (const file of files) {
    if (path.basename(file.absolutePath).toLowerCase() === outputDocxName.toLowerCase()) continue;
    const parsed = parseEntryKeyFromRelative(file.relativePath, path.basename(file.absolutePath));
    if (!parsed) continue;
    const key = figureTableKey(parsed.kind, parsed.index);
    const canonicalDir = path.join(collectionRoot, key);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        key,
        kind: parsed.kind,
        index: parsed.index,
        dir: normalizeRelative(path.relative(aiWorkRoot, canonicalDir)),
        assets: [],
      };
      byKey.set(key, entry);
    }
    entry.assets.push({
      key,
      kind: parsed.kind,
      index: parsed.index,
      role: classifyAssetRole(file.absolutePath),
      absolutePath: file.absolutePath,
      relativePath: normalizeRelative(path.relative(aiWorkRoot, file.absolutePath)),
      canonical: isSubPath(canonicalDir, file.absolutePath),
    });
  }

  return Array.from(byKey.values()).sort((left, right) =>
    left.kind === right.kind ? left.index - right.index : (left.kind === 'figure' ? -1 : 1)
  );
}

async function synchronizeProjectCollectionAssets(
  aiWorkRoot: string,
  collectionDirectory: string,
  outputDocxName: string,
): Promise<string> {
  const resolvedAiWorkRoot = path.resolve(aiWorkRoot);
  const cumulativeRoot = resolveProjectCumulativeArtifactRoot(resolvedAiWorkRoot);
  if (cumulativeRoot === resolvedAiWorkRoot) return resolvedAiWorkRoot;

  const projectRoot = path.dirname(resolvedAiWorkRoot);
  const projectEntries = await fs.readdir(projectRoot, { withFileTypes: true }).catch(() => []);
  const conversationRoots = projectEntries
    .filter(entry => entry.isDirectory() && entry.name.toLowerCase().startsWith('conversation-'))
    .map(entry => path.join(projectRoot, entry.name));
  if (!conversationRoots.some(root => path.resolve(root) === resolvedAiWorkRoot)) {
    conversationRoots.push(resolvedAiWorkRoot);
  }

  const newestByRelativePath = new Map<string, {
    sourcePath: string;
    mtimeMs: number;
    size: number;
    currentConversation: boolean;
  }>();

  for (const conversationRoot of conversationRoots) {
    const collectionRoot = path.join(conversationRoot, collectionDirectory);
    const entries = await scanCollectionEntries(conversationRoot, collectionDirectory, outputDocxName);
    for (const asset of entries.flatMap(entry => entry.assets)) {
      const relativePath = normalizeRelative(path.relative(collectionRoot, asset.absolutePath));
      if (!relativePath || relativePath.startsWith('../')) continue;
      const stat = await fs.stat(asset.absolutePath).catch(() => null);
      if (!stat?.isFile()) continue;
      const candidate = {
        sourcePath: asset.absolutePath,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        currentConversation: path.resolve(conversationRoot) === resolvedAiWorkRoot,
      };
      const existing = newestByRelativePath.get(relativePath);
      if (
        !existing
        || candidate.mtimeMs > existing.mtimeMs
        || (candidate.mtimeMs === existing.mtimeMs && candidate.currentConversation && !existing.currentConversation)
      ) {
        newestByRelativePath.set(relativePath, candidate);
      }
    }
  }

  const cumulativeCollectionRoot = path.join(cumulativeRoot, collectionDirectory);
  for (const [relativePath, candidate] of newestByRelativePath) {
    const targetPath = path.resolve(cumulativeCollectionRoot, relativePath);
    if (!isSubPath(cumulativeCollectionRoot, targetPath)) continue;
    const targetStat = await fs.stat(targetPath).catch(() => null);
    const shouldCopy = !targetStat?.isFile()
      || targetStat.size !== candidate.size
      || candidate.mtimeMs > targetStat.mtimeMs;
    if (!shouldCopy) continue;

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.copyFile(candidate.sourcePath, temporaryPath);
    await fs.rm(targetPath, { force: true });
    await fs.rename(temporaryPath, targetPath);
  }

  return cumulativeRoot;
}

/**
 * Regenerate the integrated Word document (figures_tables.docx):
 *   figure → embedded image, caption BELOW the image, note below the caption;
 *   table  → title ABOVE, bold header row on top, note BELOW.
 */
export async function buildIntegratedDocx(
  aiWorkRoot: string,
  captions: Record<string, FigureTableCaptionInput> = {},
  options: IntegratedDocxBuildOptions = {},
): Promise<IntegratedDocxBuildResult> {
  const dirs = resolveArtifactDirs(aiWorkRoot);
  const supplementary = options.collection === 'supplementary';
  const collectionDirectory = supplementary
    ? WORKSPACE_ARTIFACT_LAYOUT.supplementaryDir
    : WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir;
  const outputDocxName = supplementary
    ? WORKSPACE_ARTIFACT_LAYOUT.supplementaryDocxName
    : WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName;
  const docxPath = supplementary
    ? path.join(aiWorkRoot, collectionDirectory, outputDocxName)
    : dirs.integratedDocxPath;
  const cumulativeRoot = await synchronizeProjectCollectionAssets(
    aiWorkRoot,
    collectionDirectory,
    outputDocxName,
  );
  const entries = await scanCollectionEntries(cumulativeRoot, collectionDirectory, outputDocxName);

  const docEntries: WordFigureTableEntry[] = [];
  const included: IntegratedDocxBuildResult['included'] = [];
  const skipped: IntegratedDocxBuildResult['skipped'] = [];

  for (const entry of entries) {
    const entryDir = path.join(cumulativeRoot, entry.dir);
    const fileCaption = await readEntryCaption(entryDir, entry.key);
    const explicit = captions[entry.key];

    if (entry.kind === 'figure') {
      const bitmap = entry.assets.find(asset => asset.role === 'image' && /\.(png|jpe?g)$/i.test(asset.absolutePath));
      const otherImage = bitmap || entry.assets.find(asset => asset.role === 'image');
      if (!otherImage) {
        skipped.push({ key: entry.key, reason: '子文件夹内没有图片文件（png/jpg/…）' });
        continue;
      }
      const label = figureTableDisplayLabel(entry.key);
      docEntries.push({
        type: 'figure',
        key: entry.key,
        imagePath: otherImage.absolutePath,
        imageName: path.basename(otherImage.absolutePath),
        caption: explicit?.caption || fileCaption?.caption || `${label}.`,
        note: explicit?.note || fileCaption?.note || '图注：未填写。',
        sourcePath: otherImage.absolutePath,
      });
      included.push({ key: entry.key, kind: 'figure', source: otherImage.relativePath });
      continue;
    }

    const csvAsset = entry.assets.find(asset => asset.role === 'data' && /\.csv$/i.test(asset.absolutePath));
    const table = csvAsset ? await readTableDataCsv(csvAsset.absolutePath) : null;
    if (!csvAsset || !table || table.headers.length === 0) {
      skipped.push({ key: entry.key, reason: '子文件夹内没有可用的 CSV 数据（需 tableN_data.csv）' });
      continue;
    }
    const label = figureTableDisplayLabel(entry.key);
    docEntries.push({
      type: 'table',
      key: entry.key,
      title: explicit?.caption || fileCaption?.caption || `${label}.`,
      headers: table.headers,
      rows: table.rows,
      note: explicit?.note || fileCaption?.note || '表注：未填写。',
      sourcePath: csvAsset.absolutePath,
    });
    included.push({ key: entry.key, kind: 'table', source: csvAsset.relativePath });
  }

  if (docEntries.length === 0) {
    return {
      docxPath,
      docxRelativePath: normalizeRelative(path.relative(aiWorkRoot, docxPath)),
      included,
      skipped,
    };
  }

  await writeFigureTableDocx(docxPath, docEntries, {
    title: supplementary ? '补充材料（图片与表格）' : '正文使用的图片与表格',
  });

  return {
    docxPath,
    docxRelativePath: normalizeRelative(path.relative(aiWorkRoot, docxPath)),
    included,
    skipped,
  };
}

export interface OrganizeFigureTableOptions {
  mode?: 'move' | 'copy' | 'dry-run';
}

/**
 * Move/copy loose figure/table assets into the canonical figures_tables/<key>/
 * sub-folders with canonical file names. Word drafts found at the AI work root
 * are moved into drafts/. Files whose key cannot be determined are left in
 * place and reported as unclassified.
 */
export async function organizeFigureTableAssets(
  aiWorkRoot: string,
  options: OrganizeFigureTableOptions = {}
): Promise<OrganizeResult> {
  const mode = options.mode || 'move';
  const dirs = resolveArtifactDirs(aiWorkRoot);
  const { entries, loose } = await scanFigureTableAssets(aiWorkRoot);
  const files = await walkAiWorkFiles(aiWorkRoot);

  const moved: OrganizeAssetMove[] = [];
  const copied: OrganizeAssetMove[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const unclassified: Array<{ path: string; reason: string }> = [];

  const isInsideCanonicalEntry = (relativePath: string): boolean => {
    const parts = normalizeRelative(relativePath).split('/');
    if (!parts.includes(WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir)) return false;
    return parts.some(part => parseFigureTableKey(part) != null);
  };

  const isInsideDrafts = (relativePath: string): boolean => {
    const parts = normalizeRelative(relativePath).split('/');
    return parts[0] === WORKSPACE_ARTIFACT_LAYOUT.draftsDir;
  };

  const isIntegratedDocx = (relativePath: string): boolean => {
    return path.basename(relativePath) === WORKSPACE_ARTIFACT_LAYOUT.integratedDocxName;
  };

  // 1) Figure/table assets: organize every non-canonical asset (loose files
  //    plus assets that carry a figureN/tableN key but sit outside their
  //    canonical figures_tables/<key>/ folder) into the canonical folder.
  const nonCanonicalAssets = [
    ...loose,
    ...entries.flatMap(entry => entry.assets.filter(asset => !asset.canonical)),
  ];

  for (const asset of nonCanonicalAssets) {
    if (asset.role === 'other') {
      unclassified.push({ path: asset.relativePath, reason: '无法识别的文件类型（非图片/PDF/代码/数据）' });
      continue;
    }
    if (isInsideCanonicalEntry(asset.relativePath)) continue;
    if (isInsideDrafts(asset.relativePath)) continue;

    const parsed = asset.key
      ? parseFigureTableKey(asset.key)
      : parseEntryKeyFromRelative(asset.relativePath, path.basename(asset.absolutePath));
    if (!parsed) {
      unclassified.push({ path: asset.relativePath, reason: '文件名无法解析出 figureN/tableN 编号' });
      continue;
    }

    const key = figureTableKey(parsed.kind, parsed.index);
    const targetDir = path.join(dirs.figuresTablesDir, key);
    const targetName = canonicalAssetFilename(key, asset.role, asset.absolutePath);
    const targetPath = path.join(targetDir, targetName);

    if (path.resolve(asset.absolutePath) === path.resolve(targetPath)) continue;

    const targetExists = await fs.stat(targetPath).catch(() => null);
    if (targetExists) {
      skipped.push({ path: asset.relativePath, reason: `目标已存在：${normalizeRelative(path.relative(aiWorkRoot, targetPath))}` });
      continue;
    }

    if (mode === 'dry-run') {
      moved.push({ from: asset.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
      continue;
    }

    await fs.mkdir(targetDir, { recursive: true });
    if (mode === 'copy') {
      await fs.copyFile(asset.absolutePath, targetPath);
      copied.push({ from: asset.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
    } else {
      await fs.rename(asset.absolutePath, targetPath).catch(async (error) => {
        logger.warn('[ArtifactLayout] rename failed, falling back to copy+unlink:', error);
        await fs.copyFile(asset.absolutePath, targetPath);
        await fs.unlink(asset.absolutePath);
      });
      moved.push({ from: asset.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
    }
  }

  // 2) Word drafts at the AI work root (not inside any canonical folder) → drafts/.
  for (const file of files) {
    const extension = path.extname(file.absolutePath).toLowerCase();
    if (extension !== '.docx' && extension !== '.doc') continue;
    if (isIntegratedDocx(file.relativePath)) continue;
    if (isInsideDrafts(file.relativePath)) continue;
    if (isInsideCanonicalEntry(file.relativePath)) continue;

    const targetPath = path.join(dirs.draftsDir, path.basename(file.absolutePath));
    const targetExists = await fs.stat(targetPath).catch(() => null);
    if (targetExists) {
      skipped.push({ path: file.relativePath, reason: `drafts/ 中已存在同名文件：${path.basename(file.absolutePath)}` });
      continue;
    }

    if (mode === 'dry-run') {
      moved.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
      continue;
    }

    await fs.mkdir(dirs.draftsDir, { recursive: true });
    if (mode === 'copy') {
      await fs.copyFile(file.absolutePath, targetPath);
      copied.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
    } else {
      await fs.rename(file.absolutePath, targetPath);
      moved.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
    }
  }

  const refreshedScan = await scanFigureTableAssets(aiWorkRoot);
  const layout = await listArtifactLayout(aiWorkRoot, refreshedScan.entries);
  return { layout, moved, copied, skipped, unclassified };
}

export interface ImportSourceAssetMove {
  from: string;
  to: string;
}

export interface ImportSourceWorkspaceResult {
  imported: ImportSourceAssetMove[];
  skipped: Array<{ path: string; reason: string }>;
  unclassified: Array<{ path: string; reason: string }>;
  layout: ArtifactLayoutView;
}

export interface ImportSourceWorkspaceOptions {
  mode?: 'copy' | 'dry-run';
}

async function walkSourceFiles(sourceRoot: string, excludedRoots: string[]): Promise<Array<{ absolutePath: string; relativePath: string }>> {
  const rows: Array<{ absolutePath: string; relativePath: string }> = [];
  const excluded = new Set(excludedRoots.map(value => path.resolve(value).toLowerCase()));
  const excludedBasenames = new Set(excludedRoots.map(value => path.basename(path.resolve(value)).toLowerCase()));

  async function walk(dir: string): Promise<void> {
    if (excluded.has(path.resolve(dir).toLowerCase())) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (SKIPPED_SCAN_DIRECTORIES.has(entry.name.toLowerCase())) continue;
      // Never treat the AI workspace container (or the current AI work root)
      // as source material: AI products are not user source files.
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === AI_WORKSPACE_CONTAINER_NAME.toLowerCase()) continue;
        if (entry.name === USER_VIEW_DIRECTORY_NAME) continue;
        if (excludedBasenames.has(entry.name.toLowerCase())) continue;
      }
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        rows.push({
          absolutePath,
          relativePath: normalizeRelative(path.relative(sourceRoot, absolutePath)),
        });
      }
    }
  }
  await walk(sourceRoot);
  return rows;
}

/**
 * Review the user workspace source root and COPY its figure/table assets and
 * Word drafts into the canonical AI work structure (figures_tables/figureN|tableN/
 * and drafts/). The source files are never modified, moved or deleted — this is
 * a pure read-and-copy import that is idempotent: re-running it only imports
 * newly added source files (figureN/tableN grow incrementally as the user and
 * the AI keep working together).
 */
export async function importSourceWorkspaceAssets(
  sourceRoot: string,
  aiWorkRoot: string,
  options: ImportSourceWorkspaceOptions = {}
): Promise<ImportSourceWorkspaceResult> {
  const mode = options.mode || 'copy';
  const dirs = resolveArtifactDirs(aiWorkRoot);
  const imported: ImportSourceAssetMove[] = [];
  const skipped: Array<{ path: string; reason: string }> = [];
  const unclassified: Array<{ path: string; reason: string }> = [];

  const resolvedSource = path.resolve(sourceRoot);
  const resolvedAiWork = path.resolve(aiWorkRoot);
  if (resolvedSource === resolvedAiWork) {
    return { imported, skipped, unclassified, layout: await listArtifactLayout(aiWorkRoot) };
  }

  const excludedRoots = isSubPath(resolvedSource, resolvedAiWork) ? [resolvedAiWork] : [];
  const files = await walkSourceFiles(resolvedSource, excludedRoots);

  for (const file of files) {
    const extension = path.extname(file.absolutePath).toLowerCase();

    // Word drafts → drafts/.
    if (extension === '.docx' || extension === '.doc') {
      const targetPath = path.join(dirs.draftsDir, path.basename(file.absolutePath));
      const targetExists = await fs.stat(targetPath).catch(() => null);
      if (targetExists) {
        skipped.push({ path: file.relativePath, reason: `drafts/ 中已存在同名文件：${path.basename(file.absolutePath)}` });
        continue;
      }
      if (mode === 'dry-run') {
        imported.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
        continue;
      }
      await fs.mkdir(dirs.draftsDir, { recursive: true });
      await fs.copyFile(file.absolutePath, targetPath);
      imported.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
      continue;
    }

    const role = classifyAssetRole(file.absolutePath);
    if (role === 'other') {
      unclassified.push({ path: file.relativePath, reason: '无法识别的文件类型（非图片/PDF/代码/数据）' });
      continue;
    }

    const parsed = parseEntryKeyFromRelative(file.relativePath, path.basename(file.absolutePath));
    if (!parsed) {
      unclassified.push({ path: file.relativePath, reason: '文件名无法解析出 figureN/tableN 编号' });
      continue;
    }

    const key = figureTableKey(parsed.kind, parsed.index);
    const targetDir = path.join(dirs.figuresTablesDir, key);
    const targetName = canonicalAssetFilename(key, role, file.absolutePath);
    const targetPath = path.join(targetDir, targetName);
    const targetExists = await fs.stat(targetPath).catch(() => null);
    if (targetExists) {
      skipped.push({ path: file.relativePath, reason: `目标已存在：${normalizeRelative(path.relative(aiWorkRoot, targetPath))}` });
      continue;
    }

    if (mode === 'dry-run') {
      imported.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
      continue;
    }

    await fs.mkdir(targetDir, { recursive: true });
    await fs.copyFile(file.absolutePath, targetPath);
    imported.push({ from: file.relativePath, to: normalizeRelative(path.relative(aiWorkRoot, targetPath)) });
  }

  return {
    imported,
    skipped,
    unclassified,
    layout: await listArtifactLayout(aiWorkRoot),
  };
}

export async function listArtifactLayout(aiWorkRoot: string, entries?: FigureTableEntry[]): Promise<ArtifactLayoutView> {
  const dirs = resolveArtifactDirs(aiWorkRoot);
  const scanned = entries || (await scanFigureTableAssets(aiWorkRoot)).entries;

  return {
    aiWorkRoot,
    draftsDir: WORKSPACE_ARTIFACT_LAYOUT.draftsDir,
    figuresTablesDir: WORKSPACE_ARTIFACT_LAYOUT.figuresTablesDir,
    integratedDocxPath: normalizeRelative(path.relative(aiWorkRoot, dirs.integratedDocxPath)),
    entries: scanned,
  };
}
