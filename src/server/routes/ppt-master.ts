import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import * as fs from 'fs/promises';
import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import { z } from 'zod';
import { chatBridge } from '../../bridge/chat-bridge/chat-bridge';
import { extractPdfTextWithFastText, isPdfFastTextAvailable, resolvePdfFastTextExecutable } from '../../utils/pdf-fast-text';
import { logger } from '../../utils/logger';
import { callChatCompletion } from '../../utils/llm-client';
import { getDataDir, sanitizeUserId } from '../../utils/paths';

const router = Router();

const MAX_SOURCE_FILES = 20;
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;
const PROCESS_OUTPUT_LIMIT = 80_000;
const DEFAULT_PROCESS_TIMEOUT_MS = 5 * 60 * 1000;
const EXPORT_PROCESS_TIMEOUT_MS = 10 * 60 * 1000;

const ALLOWED_SOURCE_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.csv', '.tsv',
  '.pdf', '.docx', '.doc', '.odt', '.rtf',
  '.pptx', '.pptm', '.ppsx', '.ppsm', '.potx', '.potm',
  '.xlsx', '.xlsm', '.xls',
  '.epub', '.html', '.htm', '.tex', '.latex', '.rst', '.org', '.ipynb', '.typ',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tiff', '.tif',
  '.emf', '.wmf', '.svg',
]);

const ALLOWED_TEMPLATE_EXTENSIONS = new Set(['.pptx']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: MAX_SOURCE_FILES + 1,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_SOURCE_EXTENSIONS.has(ext) || ALLOWED_TEMPLATE_EXTENSIONS.has(ext)) {
      cb(null, true);
      return;
    }
    cb(new Error(`不支持的文件格式: ${ext}`));
  },
});

const createProjectSchema = z.object({
  userId: z.string().optional(),
  projectName: z.string().optional(),
  format: z.string().optional(),
  selectedTemplate: z.string().optional(),
  audience: z.string().optional(),
  pageCount: z.string().optional(),
  styleRequest: z.string().optional(),
  requirements: z.string().optional(),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
});

const projectActionSchema = z.object({
  userId: z.string().optional(),
  projectPath: z.string().min(1),
});

interface PythonCommand {
  command: string;
  argsPrefix: string[];
  display: string;
}

interface ProcessResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

interface TemplateOption {
  id: string;
  label: string;
  kind: string;
  group: string;
  relativePath: string;
  absolutePath: string;
  summary?: string;
}

type PptMasterJobStatus = 'queued' | 'running' | 'completed' | 'error';

interface PptMasterJobLog {
  at: string;
  message: string;
  step?: string;
}

interface PptMasterJob {
  jobId: string;
  userId: string;
  status: PptMasterJobStatus;
  step: string;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  logs: PptMasterJobLog[];
  projectPath?: string;
  requestPath?: string;
  files?: Array<{ name: string; size: number; url: string; path: string }>;
  error?: string;
}

type DeckSlideLayout = 'cover' | 'agenda' | 'flow' | 'timeline' | 'cards' | 'matrix' | 'chart' | 'image' | 'summary';

interface DeckSlide {
  title: string;
  bullets: string[];
  layout?: DeckSlideLayout;
  visualHint?: string;
  imageAssetName?: string;
  imagePlacementReason?: string;
  note?: string;
}

interface DeckOutline {
  title: string;
  subtitle: string;
  plan?: DeckGlobalPlan;
  slides: DeckSlide[];
}

interface DeckImageAsset {
  name: string;
  href: string;
  absolutePath: string;
  description?: string;
  suggestedUse?: string;
  confidence?: string;
  source?: string;
  sourcePdf?: string;
  page?: number;
  caption?: string;
  captionLabel?: string;
  captionTitle?: string;
  sectionTitle?: string;
  contextBefore?: string;
  contextAfter?: string;
  nearbyText?: string;
  semanticRole?: string;
  keyMessage?: string;
  suggestedSlideTitle?: string;
  placementReason?: string;
  width?: number;
  height?: number;
}

type FigureEvidenceRole = 'background' | 'method' | 'result' | 'discussion' | 'summary' | 'other';

interface FigureEvidence {
  figureId: string;
  assetName: string;
  href: string;
  absolutePath: string;
  caption: string;
  captionLabel: string;
  captionTitle: string;
  sourceText: string;
  role: FigureEvidenceRole;
  usableForSlides: FigureEvidenceRole[];
  confidence: string;
  source?: string;
  sourcePdf?: string;
  page?: number;
  width?: number;
  height?: number;
  keyMessage?: string;
  placementReason?: string;
  excludedReason?: string;
}

interface FigureEvidenceBundle {
  allowUncaptioned: boolean;
  accepted: FigureEvidence[];
  rejected: FigureEvidence[];
}

interface SourceMaterialSummary {
  fileName: string;
  type: string;
  extraction: string;
  textLength: number;
  error?: string;
}

interface SourceTextBundle {
  text: string;
  manifest: SourceMaterialSummary[];
  preprocessingReport: string;
}

interface DeckGlobalPlan {
  title: string;
  subtitle: string;
  coreMessage: string;
  mainQuestion: string;
  storyline: string[];
  evidenceMap: Array<{
    section: string;
    points: string[];
    sourceFiles: string[];
  }>;
  slidePlan: Array<{
    title: string;
    purpose: string;
    layout: DeckSlideLayout;
    evidence: string[];
    visual: string;
    imageAssetName?: string;
    imagePlacementReason?: string;
  }>;
  imageStrategy: Array<{
    fileName: string;
    suggestedSlide: string;
    reason: string;
  }>;
  risks: string[];
}

let cachedPythonCommand: PythonCommand | null = null;
const pptMasterJobs = new Map<string, PptMasterJob>();

router.get('/status', async (req, res) => {
  try {
    const skillDir = resolvePptMasterSkillDir();
    const scriptsDir = path.join(skillDir, 'scripts');
    const requirementsPath = path.join(skillDir, 'requirements.txt');
    const templates = await listTemplateOptions().catch(() => []);
    const codex = await chatBridge.getCodexCliStatus().catch((error) => ({
      available: false,
      path: '',
      error: (error as Error).message,
    }));
    const python = await findPythonCommand().catch((error) => ({
      command: '',
      argsPrefix: [],
      display: '',
      error: (error as Error).message,
    }));

    res.json({
      success: true,
      data: {
        available: existsSync(path.join(scriptsDir, 'project_manager.py')),
        skillDir,
        scriptsDir,
        requirementsPath,
        python,
        pdfFastText: {
          available: isPdfFastTextAvailable(),
          executable: resolvePdfFastTextExecutable(),
        },
        pdfVisualExtractor: {
          available: !!resolvePdfVisualExtractorScript(),
          engine: 'PyMuPDF',
        },
        codex,
        templateCount: templates.length,
        installCommand: `python -m pip install -r "${requirementsPath}"`,
      },
    });
  } catch (error) {
    res.json({
      success: true,
      data: {
        available: false,
        error: (error as Error).message,
      },
    });
  }
});

router.get('/templates', async (req, res) => {
  try {
    res.json({ success: true, data: { templates: await listTemplateOptions() } });
  } catch (error) {
    logger.error('[PptMaster] Failed to list templates:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/jobs/:jobId', (req, res) => {
  const job = pptMasterJobs.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ success: false, error: '未找到 PPT 生成任务' });
    return;
  }
  res.json({ success: true, data: job });
});

router.post(
  '/jobs',
  upload.fields([
    { name: 'sources', maxCount: MAX_SOURCE_FILES },
    { name: 'templatePptx', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const userId = sanitizeUserId(body.userId || 'web-user');
      const sourceFiles = getUploadedFiles(req.files, 'sources');
      const templateFiles = getUploadedFiles(req.files, 'templatePptx');
      const requirements = cleanText(body.requirements, 8000);

      if (!sourceFiles.length && !requirements) {
        return res.status(400).json({
          success: false,
          error: '请至少上传一份论文草稿、PDF、文献综述等材料，或填写汇报要求。',
        });
      }

      const job = createPptMasterJob(userId);
      res.json({ success: true, data: job });

      const clonedSources = cloneUploadedFiles(sourceFiles);
      const clonedTemplates = cloneUploadedFiles(templateFiles);
      setImmediate(() => {
        runPptMasterAutoJob(job.jobId, body, clonedSources, clonedTemplates).catch((error) => {
          failPptMasterJob(job.jobId, error);
        });
      });
    } catch (error) {
      logger.error('[PptMaster] Start job failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

router.post(
  '/projects',
  upload.fields([
    { name: 'sources', maxCount: MAX_SOURCE_FILES },
    { name: 'templatePptx', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const body = createProjectSchema.parse(req.body);
      const userId = sanitizeUserId(body.userId || 'web-user');
      const sourceFiles = getUploadedFiles(req.files, 'sources');
      const templateFiles = getUploadedFiles(req.files, 'templatePptx');
      const requirements = cleanText(body.requirements, 8000);

      if (!sourceFiles.length && !requirements) {
        return res.status(400).json({
          success: false,
          error: '请至少上传一份论文草稿、PDF、文献综述等材料，或填写汇报要求。',
        });
      }

      const skillDir = resolvePptMasterSkillDir();
      const requestedProjectName = normalizeProjectName(body.projectName);
      const canvasFormat = normalizeCanvasFormat(body.format);
      const jobId = randomUUID();
      const stagingDir = path.join(getPptMasterStagingRoot(userId), jobId);
      const sourceStagingDir = path.join(stagingDir, 'sources');
      const templateStagingDir = path.join(stagingDir, 'template');
      await fs.mkdir(sourceStagingDir, { recursive: true });
      await fs.mkdir(templateStagingDir, { recursive: true });
      await fs.mkdir(getPptMasterProjectsRoot(userId), { recursive: true });

      const createdProject = await initUniquePptMasterProject(
        getPptMasterProjectsRoot(userId),
        requestedProjectName,
        canvasFormat,
      );
      const { projectName, projectPath, initResult } = createdProject;
      assertPathInside(projectPath, getPptMasterProjectsRoot(userId), '项目路径不在允许目录内');

      const stagedSources: string[] = [];
      for (const file of sourceFiles) {
        const target = await saveUploadedFile(file, sourceStagingDir);
        stagedSources.push(target);
      }

      let importResult: ProcessResult | null = null;
      if (stagedSources.length) {
        importResult = await runPptMasterScript('project_manager.py', [
          'import-sources',
          projectPath,
          ...stagedSources,
          '--move',
        ], DEFAULT_PROCESS_TIMEOUT_MS);
        assertProcessSuccess(importResult, 'PPT Master 材料导入失败');
      }

      const selectedTemplate = await applySelectedTemplate(projectPath, body.selectedTemplate);
      const uploadedTemplate = templateFiles[0]
        ? await importUploadedPptxTemplate(projectPath, templateFiles[0], templateStagingDir)
        : null;

      const requestPath = await writeScholarHarnessRequest(projectPath, {
        projectName,
        canvasFormat,
        audience: cleanText(body.audience, 500),
        pageCount: cleanText(body.pageCount, 120),
        styleRequest: cleanText(body.styleRequest, 1200),
        requirements,
        selectedTemplate,
        uploadedTemplateDir: uploadedTemplate?.outputDir,
        sourceFilenames: sourceFiles.map((file) => file.originalname),
        skillDir,
      });

      const validateResult = await runPptMasterScript('project_manager.py', [
        'validate',
        projectPath,
      ], DEFAULT_PROCESS_TIMEOUT_MS);

      res.json({
        success: true,
        data: {
          projectPath,
          requestPath,
          sourceCount: sourceFiles.length,
          selectedTemplate,
          uploadedTemplate,
          validation: summarizeProcess(validateResult),
          commands: {
            qualityGate: `python "${path.join(skillDir, 'scripts', 'svg_quality_checker.py')}" "${projectPath}"`,
            export: [
              `python "${path.join(skillDir, 'scripts', 'total_md_split.py')}" "${projectPath}"`,
              `python "${path.join(skillDir, 'scripts', 'finalize_svg.py')}" "${projectPath}"`,
              `python "${path.join(skillDir, 'scripts', 'svg_to_pptx.py')}" "${projectPath}"`,
            ],
          },
          nextStep:
            '项目已创建。请按 scholarharness_request.md 和 tools/ppt-master/skills/ppt-master/SKILL.md 从 Strategist 阶段继续生成 design_spec.md、spec_lock.md 和 svg_output。导出前必须先运行 SVG 质量门。',
          logs: {
            init: summarizeProcess(initResult),
            import: importResult ? summarizeProcess(importResult) : null,
          },
        },
      });
    } catch (error) {
      logger.error('[PptMaster] Create project failed:', error);
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },
);

router.post('/quality-gate', async (req, res) => {
  try {
    const body = projectActionSchema.parse(req.body);
    const userId = sanitizeUserId(body.userId || 'web-user');
    const projectPath = resolveUserProjectPath(userId, body.projectPath);
    const result = await runPptMasterScript('svg_quality_checker.py', [projectPath], DEFAULT_PROCESS_TIMEOUT_MS);
    const hasSvgFiles = /Total files:\s*[1-9]\d*/.test(result.stdout);
    const passed = result.exitCode === 0 && hasSvgFiles;
    res.status(passed ? 200 : 400).json({
      success: passed,
      data: summarizeProcess(result),
      error: passed
        ? undefined
        : (hasSvgFiles ? 'SVG 质量门未通过，请先修复 svg_output 中的错误。' : 'svg_output 中没有 SVG 页面，不能视为质量门通过。'),
    });
  } catch (error) {
    logger.error('[PptMaster] Quality gate failed:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.post('/export', async (req, res) => {
  try {
    const body = projectActionSchema.parse(req.body);
    const userId = sanitizeUserId(body.userId || 'web-user');
    const projectPath = resolveUserProjectPath(userId, body.projectPath);

    const qualityResult = await runPptMasterScript('svg_quality_checker.py', [projectPath], DEFAULT_PROCESS_TIMEOUT_MS);
    const hasSvgFiles = /Total files:\s*[1-9]\d*/.test(qualityResult.stdout);
    if (qualityResult.exitCode !== 0 || !hasSvgFiles) {
      return res.status(400).json({
        success: false,
        error: hasSvgFiles ? 'SVG 质量门未通过，已阻止导出。' : 'svg_output 中没有 SVG 页面，已阻止导出。',
        data: { qualityGate: summarizeProcess(qualityResult) },
      });
    }

    const splitResult = await runPptMasterScript('total_md_split.py', [projectPath], DEFAULT_PROCESS_TIMEOUT_MS);
    assertProcessSuccess(splitResult, '讲稿拆分失败');

    const finalizeResult = await runPptMasterScript('finalize_svg.py', [projectPath], EXPORT_PROCESS_TIMEOUT_MS);
    assertProcessSuccess(finalizeResult, 'SVG 后处理失败');

    const exportResult = await runPptMasterScript('svg_to_pptx.py', [projectPath], EXPORT_PROCESS_TIMEOUT_MS);
    assertProcessSuccess(exportResult, 'PPTX 导出失败');

    res.json({
      success: true,
      data: {
        projectPath,
        files: await listExportFiles(userId, projectPath),
        logs: {
          qualityGate: summarizeProcess(qualityResult),
          splitNotes: summarizeProcess(splitResult),
          finalizeSvg: summarizeProcess(finalizeResult),
          exportPptx: summarizeProcess(exportResult),
        },
      },
    });
  } catch (error) {
    logger.error('[PptMaster] Export failed:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

router.get('/download', async (req, res) => {
  try {
    const userId = sanitizeUserId(req.query.userId || 'web-user');
    const projectPath = resolveUserProjectPath(userId, String(req.query.projectPath || ''));
    const filename = safeBasename(String(req.query.file || ''));
    const filePath = path.join(projectPath, 'exports', filename);
    assertPathInside(filePath, path.join(projectPath, 'exports'), '下载文件不在导出目录内');
    if (!existsSync(filePath) || path.extname(filePath).toLowerCase() !== '.pptx') {
      return res.status(404).json({ success: false, error: '导出文件不存在' });
    }
    res.download(filePath, filename);
  } catch (error) {
    logger.error('[PptMaster] Download failed:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

function createPptMasterJob(userId: string): PptMasterJob {
  const now = new Date().toISOString();
  const job: PptMasterJob = {
    jobId: randomUUID(),
    userId,
    status: 'queued',
    step: 'queued',
    progress: 0,
    message: '任务已加入队列',
    createdAt: now,
    updatedAt: now,
    logs: [],
  };
  pptMasterJobs.set(job.jobId, job);
  appendPptMasterJobLog(job, '任务已创建，正在准备材料。', 'queued', 1);
  return job;
}

function cloneUploadedFiles(files: Express.Multer.File[]): Express.Multer.File[] {
  return files.map((file) => ({
    ...file,
    buffer: Buffer.from(file.buffer),
  }));
}

function appendPptMasterJobLog(job: PptMasterJob, message: string, step = job.step, progress = job.progress): void {
  job.status = job.status === 'queued' ? 'running' : job.status;
  job.step = step;
  job.progress = Math.max(job.progress, Math.min(100, Math.floor(progress)));
  job.message = message;
  job.updatedAt = new Date().toISOString();
  job.logs.push({ at: job.updatedAt, message, step });
  if (job.logs.length > 200) job.logs.splice(0, job.logs.length - 200);
}

function failPptMasterJob(jobId: string, error: unknown): void {
  const job = pptMasterJobs.get(jobId);
  if (!job) return;
  const message = (error as Error)?.message || String(error);
  job.status = 'error';
  job.step = 'error';
  job.progress = Math.max(job.progress, 1);
  job.message = message;
  job.error = message;
  job.updatedAt = new Date().toISOString();
  job.logs.push({ at: job.updatedAt, message: `生成失败：${message}`, step: 'error' });
  logger.error('[PptMaster] Auto job failed:', error);
}

async function runPptMasterAutoJob(
  jobId: string,
  body: z.infer<typeof createProjectSchema>,
  sourceFiles: Express.Multer.File[],
  templateFiles: Express.Multer.File[],
): Promise<void> {
  const job = pptMasterJobs.get(jobId);
  if (!job) return;

  appendPptMasterJobLog(job, '正在创建 PPT Master 项目。', 'create-project', 5);
  const created = await createPptMasterProjectArtifacts(body, sourceFiles, templateFiles);
  job.projectPath = created.projectPath;
  job.requestPath = created.requestPath;
  appendPptMasterJobLog(job, '项目结构和材料导入完成。', 'project-ready', 18);

  appendPptMasterJobLog(job, '正在用 marker 预处理 PDF，并整理可读材料。', 'preprocess-sources', 24);
  const sourceBundle = await readProjectSourceBundle(created.projectPath);
  appendPptMasterJobLog(job, sourceBundle.preprocessingReport, 'preprocess-sources', 32);

  appendPptMasterJobLog(job, '正在整理上传图片，并自动裁剪 PDF 内嵌图表。', 'image-extract', 36);
  const uploadedImageAssets = await prepareDeckImageAssets(created.projectPath);
  const pdfVisualAssets = await extractPdfVisualAssets(created.projectPath);
  const imageAssets = sortImageAssetsForPlacement([...pdfVisualAssets, ...uploadedImageAssets]);
  appendPptMasterJobLog(job, `图像素材整理完成：上传图片 ${uploadedImageAssets.length} 个，PDF 图表/视觉区域 ${pdfVisualAssets.length} 个。`, 'image-extract', 39);
  appendPptMasterJobLog(job, '正在把图片标题、图注、上下文和图片路径交给 Codex 生成图文证据包。', 'image-analysis', 41);
  const analyzedImageAssets = await analyzeDeckImagesWithCodex(created.projectPath, imageAssets);
  await writeImageEvidenceReport(created.projectPath, analyzedImageAssets);

  appendPptMasterJobLog(job, '正在让 Codex 基于 marker 文本和图文证据包规划整体框架、证据链和插图策略。', 'global-plan', 45);
  const globalPlan = await generateDeckGlobalPlan({
    body,
    sourceBundle,
    sourceFilenames: sourceFiles.map((file) => file.originalname),
    imageAssets: analyzedImageAssets,
  });

  appendPptMasterJobLog(job, '正在让 Codex 拆解每页文本、讲稿、版面设计和图片插入位置。', 'outline', 52);
  const outline = await generateDeckOutline({
    body,
    sourceBundle,
    globalPlan,
    imageAssets: analyzedImageAssets,
    sourceFilenames: sourceFiles.map((file) => file.originalname),
  });

  appendPptMasterJobLog(job, `已生成 ${outline.slides.length} 页结构，正在按主线写入 SVG 页面。`, 'svg-generate', 60);
  const generated = await writeAutoDeckArtifacts({
    projectPath: created.projectPath,
    outline,
    format: normalizeCanvasFormat(body.format),
    audience: cleanText(body.audience, 500),
    styleRequest: cleanText(body.styleRequest, 1200),
    requirements: cleanText(body.requirements, 8000),
    selectedTemplate: created.selectedTemplate,
    uploadedTemplateDir: created.uploadedTemplate?.outputDir,
    imageAssets: analyzedImageAssets,
  });
  appendPptMasterJobLog(job, `已生成 ${generated.svgCount} 个 SVG 页面和讲稿。`, 'svg-ready', 68);

  appendPptMasterJobLog(job, '正在运行 SVG 质量门。', 'quality-gate', 76);
  const qualityResult = await runPptMasterScript('svg_quality_checker.py', [created.projectPath], DEFAULT_PROCESS_TIMEOUT_MS);
  assertProcessSuccess(qualityResult, 'SVG 质量门未通过');
  if (!/Total files:\s*[1-9]\d*/.test(qualityResult.stdout)) {
    throw new Error('SVG 质量门没有检查到任何页面，已阻止导出。');
  }
  appendPptMasterJobLog(job, 'SVG 质量门通过，正在导出 PPTX。', 'export', 84);

  const splitResult = await runPptMasterScript('total_md_split.py', [created.projectPath], DEFAULT_PROCESS_TIMEOUT_MS);
  assertProcessSuccess(splitResult, '讲稿拆分失败');
  appendPptMasterJobLog(job, '讲稿拆分完成，正在执行 SVG 后处理。', 'finalize-svg', 89);

  const finalizeResult = await runPptMasterScript('finalize_svg.py', [created.projectPath], EXPORT_PROCESS_TIMEOUT_MS);
  assertProcessSuccess(finalizeResult, 'SVG 后处理失败');
  appendPptMasterJobLog(job, 'SVG 后处理完成，正在生成 PPTX 文件。', 'svg-to-pptx', 94);

  const exportResult = await runPptMasterScript('svg_to_pptx.py', [created.projectPath], EXPORT_PROCESS_TIMEOUT_MS);
  assertProcessSuccess(exportResult, 'PPTX 导出失败');

  job.files = await listExportFiles(job.userId, created.projectPath);
  job.status = 'completed';
  job.step = 'completed';
  job.progress = 100;
  job.message = job.files.length ? 'PPTX 已生成，可以下载。' : '任务完成，但未发现导出的 PPTX 文件。';
  job.updatedAt = new Date().toISOString();
  job.logs.push({ at: job.updatedAt, message: job.message, step: 'completed' });
}

async function createPptMasterProjectArtifacts(
  body: z.infer<typeof createProjectSchema>,
  sourceFiles: Express.Multer.File[],
  templateFiles: Express.Multer.File[],
): Promise<{
  projectPath: string;
  requestPath: string;
  selectedTemplate: TemplateOption | null;
  uploadedTemplate: { originalName: string; outputDir: string; log: ProcessResult } | null;
}> {
  const userId = sanitizeUserId(body.userId || 'web-user');
  const requirements = cleanText(body.requirements, 8000);
  const skillDir = resolvePptMasterSkillDir();
  const requestedProjectName = normalizeProjectName(body.projectName);
  const canvasFormat = normalizeCanvasFormat(body.format);
  const jobId = randomUUID();
  const stagingDir = path.join(getPptMasterStagingRoot(userId), jobId);
  const sourceStagingDir = path.join(stagingDir, 'sources');
  const templateStagingDir = path.join(stagingDir, 'template');
  await fs.mkdir(sourceStagingDir, { recursive: true });
  await fs.mkdir(templateStagingDir, { recursive: true });
  await fs.mkdir(getPptMasterProjectsRoot(userId), { recursive: true });

  const createdProject = await initUniquePptMasterProject(
    getPptMasterProjectsRoot(userId),
    requestedProjectName,
    canvasFormat,
  );
  const { projectName, projectPath } = createdProject;
  assertPathInside(projectPath, getPptMasterProjectsRoot(userId), '项目路径不在允许目录内');

  const stagedSources: string[] = [];
  for (const file of sourceFiles) {
    const target = await saveUploadedFile(file, sourceStagingDir);
    stagedSources.push(target);
  }

  if (stagedSources.length) {
    const importResult = await runPptMasterScript('project_manager.py', [
      'import-sources',
      projectPath,
      ...stagedSources,
      '--move',
    ], DEFAULT_PROCESS_TIMEOUT_MS);
    assertProcessSuccess(importResult, 'PPT Master 材料导入失败');
  }

  const selectedTemplate = await applySelectedTemplate(projectPath, body.selectedTemplate);
  const uploadedTemplate = templateFiles[0]
    ? await importUploadedPptxTemplate(projectPath, templateFiles[0], templateStagingDir)
    : null;

  const requestPath = await writeScholarHarnessRequest(projectPath, {
    projectName,
    canvasFormat,
    audience: cleanText(body.audience, 500),
    pageCount: cleanText(body.pageCount, 120),
    styleRequest: cleanText(body.styleRequest, 1200),
    requirements,
    selectedTemplate,
    uploadedTemplateDir: uploadedTemplate?.outputDir,
    sourceFilenames: sourceFiles.map((file) => file.originalname),
    skillDir,
  });

  return { projectPath, requestPath, selectedTemplate, uploadedTemplate };
}

async function initUniquePptMasterProject(
  projectsRoot: string,
  requestedProjectName: string,
  canvasFormat: string,
): Promise<{ projectName: string; projectPath: string; initResult: ProcessResult }> {
  const baseName = normalizeProjectName(requestedProjectName);
  const attempts: string[] = [];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const projectName = await nextAvailablePptProjectName(projectsRoot, baseName, canvasFormat, attempt);
    attempts.push(projectName);
    const initResult = await runPptMasterScript('project_manager.py', [
      'init',
      projectName,
      '--format',
      canvasFormat,
      '--dir',
      projectsRoot,
    ], DEFAULT_PROCESS_TIMEOUT_MS);

    if (initResult.exitCode === 0 && !initResult.timedOut) {
      const projectPath = extractProjectPath(initResult.stdout)
        || path.join(projectsRoot, buildPptMasterProjectDirName(projectName, canvasFormat));
      return { projectName, projectPath, initResult };
    }

    const detail = `${initResult.stderr}\n${initResult.stdout}`;
    if (!/Project directory already exists|FileExistsError|already exists/i.test(detail)) {
      assertProcessSuccess(initResult, 'PPT Master 项目初始化失败');
    }
  }
  throw new Error(`PPT Master 项目初始化失败：同名项目目录连续冲突，已尝试 ${attempts.join('、')}`);
}

async function nextAvailablePptProjectName(
  projectsRoot: string,
  baseName: string,
  canvasFormat: string,
  attempt: number,
): Promise<string> {
  const now = new Date();
  const time = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  const candidates = attempt === 0
    ? [baseName]
    : [
        `${baseName}_${time}`,
        `${baseName}_${time}_${randomUUID().slice(0, 6)}`,
        `${baseName}_${Date.now().toString(36)}_${randomUUID().slice(0, 4)}`,
      ];
  for (const candidate of candidates) {
    const safeCandidate = normalizeProjectName(candidate);
    const expectedPath = path.join(projectsRoot, buildPptMasterProjectDirName(safeCandidate, canvasFormat));
    if (!existsSync(expectedPath)) return safeCandidate;
  }
  return normalizeProjectName(`${baseName}_${time}_${attempt}_${randomUUID().slice(0, 6)}`);
}

function buildPptMasterProjectDirName(projectName: string, canvasFormat: string): string {
  return `${projectName}_${normalizeCanvasFormat(canvasFormat)}_${localDateStamp()}`;
}

function localDateStamp(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
}

async function readProjectSourceBundle(projectPath: string): Promise<SourceTextBundle> {
  const sourcesDir = path.join(projectPath, 'sources');
  const parts: string[] = [];
  const manifest: SourceMaterialSummary[] = [];
  const readableExtensions = new Set([
    '.md', '.markdown', '.txt', '.csv', '.tsv', '.json',
    '.html', '.htm', '.tex', '.latex', '.rst', '.org', '.typ',
  ]);
  const files = await collectFiles(sourcesDir).catch(() => []);
  const pdfBaseNames = new Set(
    files
      .filter((filePath) => path.extname(filePath).toLowerCase() === '.pdf')
      .map((filePath) => path.basename(filePath, path.extname(filePath)).toLowerCase()),
  );
  const preprocessDir = path.join(projectPath, 'preprocessed');
  const markerDir = path.join(preprocessDir, 'pdf-marker');
  await fs.mkdir(markerDir, { recursive: true });

  for (const filePath of files) {
    const ext = path.extname(filePath).toLowerCase();
    const stat = await fs.stat(filePath).catch(() => null);
    if (!stat) continue;

    if (ext === '.pdf') {
      try {
        const extracted = await extractPdfTextWithFastText(filePath, {
          outputDir: markerDir,
          label: path.basename(filePath),
          timeoutMs: 300000,
        });
        const text = compactSourceText(extracted.text, 45_000);
        if (text) {
          parts.push(`\n\n## ${path.basename(filePath)}\n\n[PDF 预处理: pdf-marker-md]\n\n${text}`);
        }
        manifest.push({
          fileName: path.basename(filePath),
          type: 'pdf',
          extraction: 'pdf-marker-md',
          textLength: extracted.text.length,
        });
      } catch (error) {
        const message = (error as Error).message;
        manifest.push({
          fileName: path.basename(filePath),
          type: 'pdf',
          extraction: 'pdf-marker-md-failed',
          textLength: 0,
          error: message,
        });
        logger.warn(`[PptMaster] PDF marker preprocessing failed for ${filePath}: ${message}`);
      }
    } else if (readableExtensions.has(ext)) {
      const baseName = path.basename(filePath, ext).toLowerCase();
      if ((ext === '.md' || ext === '.markdown') && pdfBaseNames.has(baseName)) {
        manifest.push({
          fileName: path.basename(filePath),
          type: ext.replace(/^\./, '') || 'text',
          extraction: 'skipped-duplicate-pdf-markdown',
          textLength: 0,
        });
        continue;
      }
      if (stat.size > 8_000_000) {
        manifest.push({
          fileName: path.basename(filePath),
          type: ext.replace(/^\./, '') || 'text',
          extraction: 'skipped-large-text',
          textLength: 0,
          error: '文本文件超过 8MB，已跳过',
        });
        continue;
      }
      const raw = await fs.readFile(filePath, 'utf8').catch(() => '');
      const text = compactSourceText(stripSourceMarkup(raw), 35_000);
      if (text) {
        parts.push(`\n\n## ${path.basename(filePath)}\n\n${text}`);
      }
      manifest.push({
        fileName: path.basename(filePath),
        type: ext.replace(/^\./, '') || 'text',
        extraction: 'direct-text',
        textLength: raw.length,
      });
    } else if (isDeckImageExtension(ext)) {
      manifest.push({
        fileName: path.basename(filePath),
        type: 'image',
        extraction: 'image-asset',
        textLength: 0,
      });
    } else {
      manifest.push({
        fileName: path.basename(filePath),
        type: ext.replace(/^\./, '') || 'file',
        extraction: 'metadata-only',
        textLength: 0,
      });
    }
    if (parts.join('\n').length > 120_000) break;
  }

  const text = parts.join('\n').slice(0, 140_000);
  await fs.writeFile(path.join(preprocessDir, 'materials.md'), text || '# Materials\n\nNo readable text extracted.', 'utf8');
  await fs.writeFile(path.join(preprocessDir, 'material_manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  const pdfCount = manifest.filter((item) => item.type === 'pdf').length;
  const markerCount = manifest.filter((item) => item.extraction === 'pdf-marker-md').length;
  const directCount = manifest.filter((item) => item.extraction === 'direct-text').length;
  const imageCount = manifest.filter((item) => item.type === 'image').length;
  const failedCount = manifest.filter((item) => item.error).length;
  return {
    text,
    manifest,
    preprocessingReport: `材料预处理完成：PDF ${pdfCount} 个（marker 成功 ${markerCount} 个），文本 ${directCount} 个，图片 ${imageCount} 个${failedCount ? `，失败/跳过 ${failedCount} 个` : ''}。`,
  };
}

function compactSourceText(value: string, maxLength: number): string {
  return String(value || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, maxLength);
}

function stripSourceMarkup(value: string): string {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\|{2,}/g, ' ')
    .replace(/[ \t]{2,}/g, ' ');
}

function isDeckImageExtension(ext: string): boolean {
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg'].includes(ext.toLowerCase());
}

async function collectFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function generateDeckGlobalPlan(input: {
  body: z.infer<typeof createProjectSchema>;
  sourceBundle: SourceTextBundle;
  sourceFilenames: string[];
  imageAssets: DeckImageAsset[];
}): Promise<DeckGlobalPlan> {
  const requirements = cleanText(input.body.requirements, 8000);
  const pageCount = parseRequestedPageCount(input.body.pageCount, input.sourceBundle.text);
  const fallback = buildFallbackGlobalPlan(input, pageCount);
  const apiUrl = cleanText(input.body.apiUrl, 1000);
  const apiKey = cleanText(input.body.apiKey, 2000);
  const model = cleanText(input.body.model, 200) || 'gpt-4o';

  const codexPlan = await generateDeckGlobalPlanWithCodex(input, pageCount, fallback);
  if (codexPlan) return codexPlan;

  if (!apiUrl || !apiKey) return fallback;

  try {
    const content = await callChatCompletion(
      {
        apiUrl,
        apiKey,
        defaultModel: model,
        defaultTemperature: 0.25,
        label: 'PPT Master Global Planner',
      },
      {
        model,
        temperature: 0.25,
        maxTokens: 6000,
        messages: [
          {
            role: 'system',
            content:
              '你是学术汇报总策划。先做全局叙事规划，不直接写每页完整文案。只输出严格 JSON，不要 Markdown。必须忠实于材料，不得编造实验结果、p 值、样本量或结论。',
          },
          {
            role: 'user',
            content: [
              `请先基于材料规划一份 ${pageCount} 页中文汇报的全局蓝图。`,
              `目标听众：${cleanText(input.body.audience, 500) || '学术听众'}`,
              `风格：${cleanText(input.body.styleRequest, 1200) || '简洁、正式、学术'}`,
              `用户要求：${requirements || '无'}`,
              `源文件：${input.sourceFilenames.join('、') || '无'}`,
              `材料预处理：${input.sourceBundle.preprocessingReport}`,
              `图文证据包：\n${formatImageAssetsForPrompt(input.imageAssets) || '无上传图片'}`,
              '',
              '输出 JSON schema:',
              '{"title":"...","subtitle":"...","coreMessage":"整场汇报一句话主旨","mainQuestion":"核心科学/业务问题","storyline":["背景","问题","方法","结果","意义"],"evidenceMap":[{"section":"...","points":["..."],"sourceFiles":["..."]}],"slidePlan":[{"title":"...","purpose":"本页在主线中的作用","layout":"cover|agenda|flow|timeline|cards|matrix|chart|image|summary","evidence":["..."],"visual":"建议画什么","imageAssetName":"从图片证据中选择的精确文件名；没有则空"}],"imageStrategy":[{"fileName":"...","suggestedSlide":"...","reason":"..."}],"risks":["材料不足或不确定点"]}',
              'slidePlan 必须正好等于要求页数。它是后续逐页生成的唯一主线；不要让页面主题互相重复或跳跃。',
              '布局选择：封面 cover；目录 agenda；技术路线/机制 flow；研究进度 timeline；定量/趋势结果 chart；方法/指标对比 matrix；多点贡献 cards；图片证据 image；结尾 summary。',
              '如果 PDF 图表的图题/图注/上下文与某页证据直接相关，必须在该页填 imageAssetName，并优先把 layout 设为 image。imageAssetName 必须完全等于图文证据包里的 fileName。',
              'evidenceMap 要把证据归到背景、问题、方法、结果、创新、局限等逻辑位置，避免直接按文件顺序堆砌。',
              '',
              '材料：',
              input.sourceBundle.text.slice(0, 65_000) || requirements,
            ].join('\n'),
          },
        ],
      },
    );
    return normalizeDeckGlobalPlan(parseDeckOutlineJson(content), fallback, pageCount);
  } catch (error) {
    logger.warn('[PptMaster] LLM global plan failed, using fallback:', error);
    return fallback;
  }
}

async function generateDeckOutline(input: {
  body: z.infer<typeof createProjectSchema>;
  sourceBundle: SourceTextBundle;
  globalPlan: DeckGlobalPlan;
  imageAssets: DeckImageAsset[];
  sourceFilenames: string[];
}): Promise<DeckOutline> {
  const requirements = cleanText(input.body.requirements, 8000);
  const pageCount = parseRequestedPageCount(input.body.pageCount, input.sourceBundle.text);
  const fallback = buildFallbackDeckOutline(input, pageCount);
  const apiUrl = cleanText(input.body.apiUrl, 1000);
  const apiKey = cleanText(input.body.apiKey, 2000);
  const model = cleanText(input.body.model, 200) || 'gpt-4o';

  const codexOutline = await generateDeckOutlineWithCodex(input, pageCount, fallback);
  if (codexOutline) return codexOutline;

  if (!apiUrl || !apiKey) return fallback;

  try {
    const content = await callChatCompletion(
      {
        apiUrl,
        apiKey,
        defaultModel: model,
        defaultTemperature: 0.28,
        label: 'PPT Master Slide Planner',
      },
      {
        model,
        temperature: 0.28,
        maxTokens: 6500,
        messages: [
          {
            role: 'system',
            content:
              '你是学术汇报 PPT 执行策划助手。必须先遵守全局蓝图，再生成逐页页面。只输出严格 JSON，不要 Markdown。不得编造材料中没有的结果。',
          },
          {
            role: 'user',
            content: [
              `请把全局蓝图拆成 ${pageCount} 页中文 PPT 页面。`,
              `目标听众：${cleanText(input.body.audience, 500) || '学术听众'}`,
              `风格：${cleanText(input.body.styleRequest, 1200) || '简洁、正式、学术'}`,
              `用户要求：${requirements || '无'}`,
              '',
              '全局蓝图 JSON：',
              JSON.stringify(input.globalPlan, null, 2),
              '',
              '图文证据包：',
              formatImageAssetsForPrompt(input.imageAssets) || '无上传图片',
              '',
              '输出 JSON schema:',
              '{"title":"...","subtitle":"...","slides":[{"title":"...","layout":"flow|timeline|cards|matrix|chart|image|agenda|summary|cover","visualHint":"这一页应该画什么图，必须承接全局蓝图","imageAssetName":"从图片证据中选择的精确文件名；没有则空","bullets":["..."],"note":"..."}]}',
              'slides 必须正好等于要求页数。每页 3-5 条 bullet，每条不超过 28 个中文字符。note 为 1-3 句讲稿。',
              'PDF 中裁剪出来的相关图表必须放入对应内容页：只有当图题/图注/上下文与该页 bullet 和讲稿一致时，才填写 imageAssetName，并把 layout 设为 image。',
              '页面顺序必须有清晰因果：背景 -> 问题 -> 方法/技术路线 -> 结果/证据 -> 讨论/创新 -> 总结。不要按材料文件顺序机械排列。',
              '如果材料不足，写“待补充/需用户确认”，不要编造数值、样本量或结论。',
              '',
              '材料摘录：',
              input.sourceBundle.text.slice(0, 35_000) || requirements,
            ].join('\n'),
          },
        ],
      },
    );
    const outline = normalizeDeckOutline(parseDeckOutlineJson(content), fallback, pageCount);
    return { ...outline, plan: input.globalPlan };
  } catch (error) {
    logger.warn('[PptMaster] LLM outline failed, using fallback:', error);
    return fallback;
  }
}

async function generateDeckGlobalPlanWithCodex(
  input: {
    body: z.infer<typeof createProjectSchema>;
    sourceBundle: SourceTextBundle;
    sourceFilenames: string[];
    imageAssets: DeckImageAsset[];
  },
  pageCount: number,
  fallback: DeckGlobalPlan,
): Promise<DeckGlobalPlan | null> {
  const available = await isPptMasterCodexAvailable();
  if (!available) return null;
  const requirements = cleanText(input.body.requirements, 8000);
  try {
    const content = await chatBridge.chat({
      forceProvider: 'codex',
      disableFallback: true,
      codexTimeoutMs: 240000,
      temperature: 0.12,
      maxTokens: 7000,
      messages: [{
        role: 'user',
        content: [
          '你是学术汇报总策划。请基于 marker 提取文本和 PDF 图文证据包，先规划全局叙事，不要直接生成 SVG。',
          '必须让图片的图题/图注/附近正文和页面主题一致；不能只按图片顺序或文件名放图。',
          '只输出严格 JSON，不要 Markdown。不得编造材料中没有的实验结果、p 值、样本量或结论。',
          '',
          `页数：${pageCount}`,
          `目标听众：${cleanText(input.body.audience, 500) || '学术听众'}`,
          `风格：${cleanText(input.body.styleRequest, 1200) || '简洁、正式、学术'}`,
          `用户要求：${requirements || '无'}`,
          `源文件：${input.sourceFilenames.join('、') || '无'}`,
          `材料预处理：${input.sourceBundle.preprocessingReport}`,
          '',
          '图文证据包（每张图片含路径、PDF 页码、图题/图注、上下文和 Codex 初步摘要；imageAssetName 必须精确使用 fileName）：',
          formatImageAssetsForPrompt(input.imageAssets) || '无图片证据',
          '',
          '输出 JSON schema:',
          '{"title":"...","subtitle":"...","coreMessage":"整场汇报一句话主旨","mainQuestion":"核心科学/业务问题","storyline":["背景","问题","方法","结果","意义"],"evidenceMap":[{"section":"...","points":["..."],"sourceFiles":["..."]}],"slidePlan":[{"title":"...","purpose":"本页在主线中的作用","layout":"cover|agenda|flow|timeline|cards|matrix|chart|image|summary","evidence":["..."],"visual":"版面/图形设计建议","imageAssetName":"从图文证据包选择的精确 fileName；没有则空"}],"imageStrategy":[{"fileName":"...","suggestedSlide":"...","reason":"必须引用图题/图注/上下文说明为什么放这里"}],"risks":["材料不足或不确定点"]}',
          'slidePlan 必须正好等于页数。页面主线要有因果链：背景 -> 问题 -> 方法/技术路线 -> 结果/证据 -> 讨论/创新 -> 总结。',
          '只有当图题/图注/上下文与该页 evidence 直接相关时，才填写 imageAssetName；填写后 layout 优先设为 image。',
          '每个 imageStrategy.reason 必须说明该图片支撑哪条证据，避免文不对题。',
          '',
          'marker 文本材料：',
          input.sourceBundle.text.slice(0, 90_000) || requirements,
        ].join('\n'),
      }],
    });
    return normalizeDeckGlobalPlan(parseDeckOutlineJson(content), fallback, pageCount);
  } catch (error) {
    logger.warn('[PptMaster] Codex global plan failed, trying API/fallback:', error);
    return null;
  }
}

async function generateDeckOutlineWithCodex(
  input: {
    body: z.infer<typeof createProjectSchema>;
    sourceBundle: SourceTextBundle;
    globalPlan: DeckGlobalPlan;
    imageAssets: DeckImageAsset[];
    sourceFilenames: string[];
  },
  pageCount: number,
  fallback: DeckOutline,
): Promise<DeckOutline | null> {
  const available = await isPptMasterCodexAvailable();
  if (!available) return null;
  const requirements = cleanText(input.body.requirements, 8000);
  try {
    const content = await chatBridge.chat({
      forceProvider: 'codex',
      disableFallback: true,
      codexTimeoutMs: 240000,
      temperature: 0.15,
      maxTokens: 7500,
      messages: [{
        role: 'user',
        content: [
          '你是学术汇报 PPT 执行策划助手。请把全局蓝图拆成逐页内容、讲稿、版面设计和图片插入位置。',
          '必须综合 marker 文本、图题、图注、附近正文和图片路径来决定图片放在哪一页；图片与页面主题不一致时不要放。',
          '只输出严格 JSON，不要 Markdown。不得编造材料中没有的结果。',
          '',
          `页数：${pageCount}`,
          `目标听众：${cleanText(input.body.audience, 500) || '学术听众'}`,
          `风格：${cleanText(input.body.styleRequest, 1200) || '简洁、正式、学术'}`,
          `用户要求：${requirements || '无'}`,
          '',
          '全局蓝图 JSON：',
          JSON.stringify(input.globalPlan, null, 2),
          '',
          '图文证据包（imageAssetName 必须精确使用 fileName）：',
          formatImageAssetsForPrompt(input.imageAssets) || '无图片证据',
          '',
          '输出 JSON schema:',
          '{"title":"...","subtitle":"...","slides":[{"title":"...","layout":"flow|timeline|cards|matrix|chart|image|agenda|summary|cover","visualHint":"版面设计：主视觉、图片位置、辅助图形和信息层级","imageAssetName":"从图文证据包选择的精确 fileName；没有则空","bullets":["..."],"note":"1-3 句中文讲稿，说明该页怎么讲以及图片如何支撑观点"}]}',
          'slides 必须正好等于页数。每页 3-5 条 bullet，每条不超过 28 个中文字符。',
          '如果某页使用图片，bullets 和 note 必须明确承接该图片的图题/图注/上下文；layout 必须设为 image。',
          '如果一张图片只是封面装饰、logo、或与科学内容无关，不要使用。',
          '页面顺序必须清晰：背景 -> 问题 -> 方法/技术路线 -> 结果/证据 -> 讨论/创新 -> 总结。',
          '',
          'marker 文本材料摘录：',
          input.sourceBundle.text.slice(0, 50_000) || requirements,
        ].join('\n'),
      }],
    });
    const outline = normalizeDeckOutline(parseDeckOutlineJson(content), fallback, pageCount);
    return { ...outline, plan: input.globalPlan };
  } catch (error) {
    logger.warn('[PptMaster] Codex outline failed, trying API/fallback:', error);
    return null;
  }
}

async function isPptMasterCodexAvailable(): Promise<boolean> {
  const status = await chatBridge.getCodexCliStatus().catch((error) => ({
    available: false,
    path: '',
    error: (error as Error).message,
  }));
  return !!status.available;
}

function parseDeckOutlineJson(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('AI 未返回合法 JSON');
  }
}

function normalizeDeckGlobalPlan(raw: unknown, fallback: DeckGlobalPlan, pageCount: number): DeckGlobalPlan {
  const obj = raw as Record<string, unknown>;
  const storyline = arrayOfCleanText(obj?.storyline, 80, 8);
  const evidenceMapRaw = Array.isArray(obj?.evidenceMap) ? obj.evidenceMap : [];
  const slidePlanRaw = Array.isArray(obj?.slidePlan) ? obj.slidePlan : [];
  const imageStrategyRaw = Array.isArray(obj?.imageStrategy) ? obj.imageStrategy : [];
  const evidenceMap = evidenceMapRaw.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      section: cleanText(row.section, 80) || '材料证据',
      points: arrayOfCleanText(row.points, 120, 6),
      sourceFiles: arrayOfCleanText(row.sourceFiles, 120, 8),
    };
  }).filter((item) => item.points.length || item.sourceFiles.length).slice(0, 8);
  const slidePlan: DeckGlobalPlan['slidePlan'] = slidePlanRaw.map((item, index) => {
    const row = item as Record<string, unknown>;
    return {
      title: cleanText(row.title, 80) || fallback.slidePlan[index]?.title || `页面 ${index + 1}`,
      purpose: cleanText(row.purpose, 180) || fallback.slidePlan[index]?.purpose || '承接汇报主线',
      layout: normalizeSlideLayout(row.layout, index, pageCount),
      evidence: arrayOfCleanText(row.evidence, 100, 4),
      visual: cleanText(row.visual, 180) || fallback.slidePlan[index]?.visual || '可视化摘要',
      imageAssetName: cleanText(row.imageAssetName, 180) || fallback.slidePlan[index]?.imageAssetName,
    };
  }).slice(0, pageCount);
  while (slidePlan.length < pageCount) {
    slidePlan.push(fallback.slidePlan[slidePlan.length] || fallback.slidePlan[fallback.slidePlan.length - 1]);
  }

  return {
    title: cleanText(obj?.title, 100) || fallback.title,
    subtitle: cleanText(obj?.subtitle, 160) || fallback.subtitle,
    coreMessage: cleanText(obj?.coreMessage, 220) || fallback.coreMessage,
    mainQuestion: cleanText(obj?.mainQuestion, 180) || fallback.mainQuestion,
    storyline: storyline.length ? storyline : fallback.storyline,
    evidenceMap: evidenceMap.length ? evidenceMap : fallback.evidenceMap,
    slidePlan,
    imageStrategy: imageStrategyRaw.map((item) => {
      const row = item as Record<string, unknown>;
      return {
        fileName: cleanText(row.fileName, 160),
        suggestedSlide: cleanText(row.suggestedSlide, 120),
        reason: cleanText(row.reason, 220),
      };
    }).filter((item) => item.fileName || item.reason).slice(0, 10),
    risks: arrayOfCleanText(obj?.risks, 160, 8),
  };
}

function normalizeDeckOutline(raw: unknown, fallback: DeckOutline, pageCount: number): DeckOutline {
  const obj = raw as Record<string, unknown>;
  const slidesRaw = Array.isArray(obj?.slides) ? obj.slides : [];
  const slides: DeckSlide[] = slidesRaw.map((slide, index) => {
    const item = slide as Record<string, unknown>;
    const bullets = Array.isArray(item.bullets)
      ? item.bullets.map((bullet) => cleanText(bullet, 80)).filter(Boolean).slice(0, 5)
      : [];
    return {
      title: cleanText(item.title, 80) || '未命名页面',
      bullets: bullets.length ? bullets : ['围绕材料提炼核心信息', '保持事实准确与表达简洁', '用于后续汇报展开'],
      layout: normalizeSlideLayout(item.layout, index, pageCount),
      visualHint: cleanText(item.visualHint, 160),
      imageAssetName: cleanText(item.imageAssetName, 180) || fallback.slides[index]?.imageAssetName,
      note: cleanText(item.note, 600),
    };
  }).slice(0, pageCount);

  while (slides.length < pageCount) {
    slides.push(fallback.slides[slides.length] || fallback.slides[fallback.slides.length - 1]);
  }

  return {
    title: cleanText(obj?.title, 100) || fallback.title,
    subtitle: cleanText(obj?.subtitle, 160) || fallback.subtitle,
    plan: fallback.plan,
    slides,
  };
}

function buildFallbackGlobalPlan(input: {
  body: z.infer<typeof createProjectSchema>;
  sourceBundle: SourceTextBundle;
  sourceFilenames: string[];
  imageAssets: DeckImageAsset[];
}, pageCount: number): DeckGlobalPlan {
  const title = cleanText(input.body.projectName, 80) || '学术汇报';
  const requirements = cleanText(input.body.requirements, 500);
  const seedLines = extractSeedLines(input.sourceBundle.text || requirements, 18);
  const defaultTitles = ['汇报概览', '研究背景', '核心问题', '材料与方法', '关键结果', '讨论与解释', '创新点', '总结与展望'];
  const layoutPattern: DeckSlideLayout[] = ['cover', 'agenda', 'flow', 'timeline', 'chart', 'matrix', 'cards', 'image', 'summary'];
  return {
    title,
    subtitle: cleanText(input.body.styleRequest, 120) || '基于用户材料自动生成',
    coreMessage: seedLines[0] || requirements || '围绕上传材料形成一条完整汇报主线',
    mainQuestion: seedLines[1] || '本研究/项目要解决的核心问题是什么',
    storyline: ['背景与动机', '核心问题', '方法路线', '关键结果', '创新价值', '总结展望'],
    evidenceMap: [{
      section: '上传材料',
      points: seedLines.slice(0, 6),
      sourceFiles: input.sourceFilenames.slice(0, 8),
    }],
    slidePlan: Array.from({ length: pageCount }, (_, index) => ({
      title: defaultTitles[index] || `重点内容 ${index + 1}`,
      purpose: index === 0
        ? '建立汇报主题和听众预期'
        : (index === pageCount - 1 ? '收束结论和后续工作' : '承接全局主线并呈现关键证据'),
      layout: index === 0 ? 'cover' : (index === pageCount - 1 ? 'summary' : layoutPattern[index % layoutPattern.length]),
      evidence: seedLines.slice(index * 2, index * 2 + 3),
      visual: defaultTitles[index] || '可视化摘要',
      imageAssetName: input.imageAssets[index - 1]?.name,
    })),
    imageStrategy: input.imageAssets.map((asset) => ({
      fileName: asset.name,
      suggestedSlide: '图片证据页',
      reason: asset.description || '用户上传的图片材料，可作为证据或流程展示',
    })),
    risks: input.sourceBundle.manifest.filter((item) => item.error).map((item) => `${item.fileName}: ${item.error}`).slice(0, 6),
  };
}

function buildFallbackDeckOutline(input: {
  body: z.infer<typeof createProjectSchema>;
  sourceBundle: SourceTextBundle;
  globalPlan: DeckGlobalPlan;
  imageAssets: DeckImageAsset[];
  sourceFilenames: string[];
}, pageCount: number): DeckOutline {
  const title = cleanText(input.globalPlan.title, 80) || cleanText(input.body.projectName, 80) || '学术汇报';
  const requirements = cleanText(input.body.requirements, 500);
  const seedLines = extractSeedLines(input.sourceBundle.text || requirements, 40);
  const defaultTitles = ['汇报概览', '研究背景', '核心问题', '材料与方法', '关键结果', '讨论与解释', '创新点', '总结与展望'];
  const slides: DeckSlide[] = [];
  const layoutPattern: DeckSlideLayout[] = ['cover', 'agenda', 'flow', 'timeline', 'chart', 'matrix', 'cards', 'image', 'summary'];
  for (let i = 0; i < pageCount; i += 1) {
    const planned = input.globalPlan.slidePlan[i];
    const base = planned?.evidence?.length ? planned.evidence : seedLines.slice(i * 3, i * 3 + 5);
    slides.push({
      title: planned?.title || defaultTitles[i] || `重点内容 ${i + 1}`,
      bullets: (base.length ? base : [
        planned?.purpose || '围绕上传材料提炼页面重点',
        input.globalPlan.coreMessage || '避免编造材料中不存在的信息',
        '突出可以用于汇报的核心逻辑',
      ]).map((line) => line.slice(0, 34)).slice(0, 4),
      layout: planned?.layout || (i === 0 ? 'cover' : (i === pageCount - 1 ? 'summary' : layoutPattern[i % layoutPattern.length])),
      visualHint: planned?.visual || (i === 0 ? '标题页' : defaultTitles[i] || '可视化摘要'),
      imageAssetName: planned?.imageAssetName || input.imageAssets[i - 1]?.name,
      note: [planned?.purpose, ...base].filter(Boolean).join('。') || requirements || '本页用于承接汇报主线。',
    });
  }
  return {
    title,
    subtitle: cleanText(input.globalPlan.subtitle, 120) || cleanText(input.body.styleRequest, 120) || '基于用户材料自动生成',
    plan: input.globalPlan,
    slides,
  };
}

function arrayOfCleanText(value: unknown, maxLength: number, maxItems: number): string[] {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function extractSeedLines(text: string, maxItems: number): string[] {
  return String(text || '')
    .replace(/[#>*`|]/g, ' ')
    .split(/\r?\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8)
    .slice(0, maxItems);
}

function formatImageAssetsForPrompt(assets: DeckImageAsset[]): string {
  return assets.map((asset, index) => {
    const lines = [
      `${index + 1}. fileName: ${asset.name}`,
      `   path: ${asset.absolutePath}`,
      `   source: ${asset.source || 'uploaded'}${asset.sourcePdf ? ` | pdf: ${asset.sourcePdf}` : ''}${asset.page ? ` | page: ${asset.page}` : ''}${asset.width && asset.height ? ` | size: ${asset.width}x${asset.height}` : ''}`,
    ];
    if (asset.captionLabel || asset.captionTitle) {
      lines.push(`   figureTitle: ${[asset.captionLabel, asset.captionTitle].filter(Boolean).join(' ')}`);
    }
    if (asset.caption && asset.caption !== asset.captionTitle) lines.push(`   caption: ${asset.caption}`);
    if (asset.sectionTitle) lines.push(`   markerSection: ${asset.sectionTitle}`);
    if (asset.contextBefore) lines.push(`   contextBefore: ${asset.contextBefore}`);
    if (asset.contextAfter) lines.push(`   contextAfter: ${asset.contextAfter}`);
    if (asset.nearbyText && !asset.contextBefore && !asset.contextAfter) lines.push(`   nearbyText: ${asset.nearbyText}`);
    if (asset.description) lines.push(`   imageSummary: ${asset.description}`);
    if (asset.semanticRole || asset.keyMessage || asset.suggestedSlideTitle) {
      lines.push(`   codexEvidence: ${[
        asset.semanticRole ? `role=${asset.semanticRole}` : '',
        asset.keyMessage ? `message=${asset.keyMessage}` : '',
        asset.suggestedSlideTitle ? `slide=${asset.suggestedSlideTitle}` : '',
      ].filter(Boolean).join('; ')}`);
    }
    if (asset.suggestedUse || asset.placementReason) {
      lines.push(`   placementHint: ${[asset.suggestedUse, asset.placementReason].filter(Boolean).join('；')}`);
    }
    return lines.join('\n');
  }).join('\n');
}

async function writeImageEvidenceReport(projectPath: string, assets: DeckImageAsset[]): Promise<void> {
  const outputPath = path.join(projectPath, 'preprocessed', 'image_evidence.md');
  const body = assets.length
    ? formatImageAssetsForPrompt(assets)
    : 'No image evidence extracted.';
  await fs.writeFile(outputPath, `# Image Evidence\n\n${body}\n`, 'utf8').catch((error) => {
    logger.warn('[PptMaster] Failed to write image evidence report:', error);
  });
}

function parseRequestedPageCount(value: unknown, sourceText: string): number {
  const text = String(value || '');
  const nums = Array.from(text.matchAll(/\d{1,2}/g)).map((m) => Number(m[0])).filter(Number.isFinite);
  if (nums.length) {
    return Math.max(4, Math.min(18, Math.round(nums[nums.length - 1])));
  }
  const estimated = sourceText.length > 60_000 ? 12 : sourceText.length > 25_000 ? 10 : 8;
  return estimated;
}

function normalizeSlideLayout(value: unknown, index: number, total: number): DeckSlideLayout {
  if (index === 0) return 'cover';
  if (index === total - 1) return 'summary';
  const raw = String(value || '').trim().toLowerCase();
  const allowed: DeckSlideLayout[] = ['cover', 'agenda', 'flow', 'timeline', 'cards', 'matrix', 'chart', 'image', 'summary'];
  if ((allowed as string[]).includes(raw)) return raw as DeckSlideLayout;
  const pattern: DeckSlideLayout[] = ['agenda', 'flow', 'timeline', 'chart', 'matrix', 'cards', 'image'];
  return pattern[(index - 1) % pattern.length];
}

async function writeAutoDeckArtifacts(input: {
  projectPath: string;
  outline: DeckOutline;
  format: string;
  audience: string;
  styleRequest: string;
  requirements: string;
  selectedTemplate: TemplateOption | null;
  uploadedTemplateDir?: string;
  imageAssets?: DeckImageAsset[];
}): Promise<{ svgCount: number }> {
  const canvas = getCanvasInfo(input.format);
  const svgDir = path.join(input.projectPath, 'svg_output');
  const notesDir = path.join(input.projectPath, 'notes');
  await fs.mkdir(svgDir, { recursive: true });
  await fs.mkdir(notesDir, { recursive: true });
  const imageAssets = input.imageAssets || await prepareDeckImageAssets(input.projectPath);
  const outline = bindImageAssetsToOutline(input.outline, imageAssets);

  const slideNames: string[] = [];
  for (let i = 0; i < outline.slides.length; i += 1) {
    const slide = outline.slides[i];
    const stem = `${String(i + 1).padStart(2, '0')}_${slugForFile(slide.title) || 'slide'}`;
    slideNames.push(stem);
    const svg = renderSlideSvg({
      canvas,
      slide,
      index: i,
      total: outline.slides.length,
      deckTitle: outline.title,
      deckSubtitle: outline.subtitle,
      imageAssets,
    });
    await fs.writeFile(path.join(svgDir, `${stem}.svg`), svg, 'utf8');
  }

  await fs.writeFile(
    path.join(notesDir, 'total.md'),
    outline.slides.map((slide, index) => {
      const stem = slideNames[index];
      return `# ${stem}\n\n${slide.note || slide.bullets.join('；')}\n`;
    }).join('\n---\n\n'),
    'utf8',
  );

  await fs.writeFile(
    path.join(input.projectPath, 'design_spec.md'),
    [
      `# ${outline.title}`,
      '',
      '## Template Use',
      input.selectedTemplate ? `- Built-in template: ${input.selectedTemplate.relativePath}` : '- Built-in template: free design',
      input.uploadedTemplateDir ? `- Uploaded PPTX inheritance: ${input.uploadedTemplateDir}` : '- Uploaded PPTX inheritance: none',
      '',
      '## Audience',
      input.audience || 'Academic audience',
      '',
      '## Global Plan',
      `- Core message: ${outline.plan?.coreMessage || outline.subtitle || 'N/A'}`,
      `- Main question: ${outline.plan?.mainQuestion || 'N/A'}`,
      ...(outline.plan?.storyline || []).map((item, index) => `- Story ${index + 1}: ${item}`),
      '',
      '## Style Objective',
      input.styleRequest || 'Clean academic presentation with restrained visual hierarchy.',
      '',
      '## Page Roster',
      ...slideNames.map((name) => `- ${name}`),
      '',
      '## Image Placement',
      ...(outline.slides.map((slide, index) => slide.imageAssetName
        ? `- ${slideNames[index]}: ${slide.imageAssetName}`
        : '').filter(Boolean)),
      '',
      '## User Requirements',
      input.requirements || 'None',
      '',
    ].join('\n'),
    'utf8',
  );

  await fs.writeFile(
    path.join(input.projectPath, 'spec_lock.md'),
    [
      '# Execution Lock',
      '',
      '## canvas',
      `- format: ${input.format}`,
      `- viewBox: ${canvas.viewBox}`,
      '',
      '## colors',
      '- background: #F8FAFC',
      '- ink: #0F172A',
      '- accent: #0F766E',
      '- muted: #64748B',
      '- line: #CBD5E1',
      '- surface: #FFFFFF',
      '- border: #E2E8F0',
      '- body_text: #1E293B',
      '- chart_axis: #94A3B8',
      '- chart_label: #334155',
      '- blue: #2563EB',
      '- blue_light: #DBEAFE',
      '- blue_mid: #93C5FD',
      '- teal_light: #CCFBF1',
      '- teal_mid: #5EEAD4',
      '- purple: #7C3AED',
      '- purple_light: #EDE9FE',
      '- purple_mid: #C4B5FD',
      '- amber: #B45309',
      '- amber_light: #FEF3C7',
      '- amber_mid: #FCD34D',
      '- rose: #BE123C',
      '- rose_light: #FFE4E6',
      '- rose_mid: #FDA4AF',
      '',
      '## typography',
      '- font_family: Microsoft YaHei, Arial',
      '- number_family: Arial',
      '- body: 22',
      '- title: 42',
      '- subtitle: 24',
      '- annotation: 14',
      '',
      '## page_rhythm',
      ...slideNames.map((name, index) => `- ${name}: ${outline.slides[index]?.layout || (index === 0 ? 'cover' : index === slideNames.length - 1 ? 'summary' : 'content')}`),
      '',
      '## forbidden',
      '- rgba()',
      '- filter',
      '- foreignObject',
      '- script',
      '',
    ].join('\n'),
    'utf8',
  );

  return { svgCount: slideNames.length };
}

function bindImageAssetsToOutline(outline: DeckOutline, imageAssets: DeckImageAsset[]): DeckOutline {
  if (!imageAssets.length) return outline;
  const used = new Set<string>();
  const slides: DeckSlide[] = outline.slides.map((slide, index): DeckSlide => {
    const canUseImage = shouldUseImageLayout(slide, index, outline.slides.length);
    const plannedImage = outline.plan?.slidePlan[index]?.imageAssetName;
    const strategyImage = findImageStrategyNameForSlide(outline, slide);
    const explicit = resolveImageAssetByName(slide.imageAssetName || plannedImage || strategyImage, imageAssets);
    if (!explicit || !canUseImage || !isImageCompatibleWithSlide(slide, explicit)) {
      return {
        ...slide,
        imageAssetName: undefined,
        layout: slide.layout === 'image' ? fallbackLayoutWithoutImage(slide) : slide.layout,
      };
    }
    used.add(explicit.name);
    return {
      ...slide,
      imageAssetName: explicit.name,
      layout: 'image' as DeckSlideLayout,
      visualHint: slide.visualHint || explicit.suggestedUse || explicit.description,
    };
  });

  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index];
    if (slide.imageAssetName || !shouldUseImageLayout(slide, index, slides.length)) continue;
    const match = findBestImageAssetForSlide(slide, imageAssets, used);
    if (match && match.score >= 4) {
      used.add(match.asset.name);
      slides[index] = {
        ...slide,
        imageAssetName: match.asset.name,
        layout: 'image',
        visualHint: slide.visualHint || match.asset.suggestedUse || match.asset.description,
      };
    }
  }

  if (!slides.some((slide) => slide.imageAssetName)) {
    const targetIndex = findDefaultImageSlideIndex(slides);
    const match = findBestImageAssetForSlide(slides[targetIndex], imageAssets, used);
    const asset = match?.asset || imageAssets[0];
    slides[targetIndex] = {
      ...slides[targetIndex],
      imageAssetName: asset.name,
      layout: 'image',
      visualHint: slides[targetIndex].visualHint || asset.suggestedUse || asset.description,
    };
  }

  return {
    ...outline,
    slides: slides.map((slide) => slide.layout === 'image' && !slide.imageAssetName
      ? { ...slide, layout: fallbackLayoutWithoutImage(slide) }
      : slide),
  };
}

function findImageStrategyNameForSlide(outline: DeckOutline, slide: DeckSlide): string {
  const strategies = outline.plan?.imageStrategy || [];
  const slideText = normalizeMatchText(`${slide.title} ${slide.visualHint || ''} ${slide.bullets.join(' ')}`);
  for (const strategy of strategies) {
    const target = normalizeMatchText(`${strategy.suggestedSlide} ${strategy.reason}`);
    if (target && slideText && (target.includes(slideText) || slideText.includes(target))) {
      return strategy.fileName;
    }
  }
  return '';
}

function shouldUseImageLayout(slide: DeckSlide, index: number, total: number): boolean {
  const layout = normalizeSlideLayout(slide.layout, index, total);
  if (layout === 'cover' || layout === 'agenda' || layout === 'summary') return false;
  return true;
}

function findDefaultImageSlideIndex(slides: DeckSlide[]): number {
  const preferred = slides.findIndex((slide, index) => {
    if (!shouldUseImageLayout(slide, index, slides.length)) return false;
    return /图|表|结果|证据|数据|分析|机制|figure|table|result|evidence|chart/i.test(`${slide.title} ${slide.visualHint || ''} ${slide.bullets.join(' ')}`);
  });
  if (preferred >= 0) return preferred;
  const fallback = slides.findIndex((slide, index) => shouldUseImageLayout(slide, index, slides.length));
  return fallback >= 0 ? fallback : Math.min(1, Math.max(0, slides.length - 1));
}

function resolveImageAssetByName(name: unknown, imageAssets: DeckImageAsset[]): DeckImageAsset | null {
  const normalized = normalizeMatchText(String(name || ''));
  if (!normalized) return null;
  return imageAssets.find((asset) => normalizeMatchText(asset.name) === normalized)
    || imageAssets.find((asset) => normalizeMatchText(asset.name).includes(normalized) || normalized.includes(normalizeMatchText(asset.name)))
    || null;
}

function findBestImageAssetForSlide(
  slide: DeckSlide,
  imageAssets: DeckImageAsset[],
  used = new Set<string>(),
): { asset: DeckImageAsset; score: number } | null {
  let best: { asset: DeckImageAsset; score: number } | null = null;
  for (const asset of imageAssets) {
    if (used.has(asset.name)) continue;
    if (!isImageCompatibleWithSlide(slide, asset)) continue;
    const score = scoreImageAssetForSlide(slide, asset);
    if (!best || score > best.score) {
      best = { asset, score };
    }
  }
  return best;
}

function scoreImageAssetForSlide(slide: DeckSlide, asset: DeckImageAsset): number {
  const slideText = normalizeMatchText([
    slide.title,
    slide.visualHint,
    slide.bullets.join(' '),
    slide.note,
  ].join(' '));
  const assetText = normalizeMatchText([
    asset.name,
    asset.sourcePdf,
    asset.captionLabel,
    asset.captionTitle,
    asset.caption,
    asset.sectionTitle,
    asset.contextBefore,
    asset.contextAfter,
    asset.nearbyText,
    asset.description,
    asset.semanticRole,
    asset.keyMessage,
    asset.suggestedSlideTitle,
    asset.suggestedUse,
    asset.placementReason,
  ].join(' '));
  if (!slideText || !assetText) return 0;

  let score = 0;
  if (slide.imageAssetName && normalizeMatchText(slide.imageAssetName) === normalizeMatchText(asset.name)) score += 30;
  if (slideText.includes(assetText) || assetText.includes(slideText)) score += 8;

  const slideTokens = new Set(extractMatchTokens(slideText));
  for (const token of extractMatchTokens(assetText)) {
    if (slideTokens.has(token)) score += token.length >= 6 ? 2 : 1;
  }

  const figureMatch = asset.name.match(/(?:fig|figure|table|caption|embedded|visual)[^0-9]*(\d{1,3})/i);
  if (figureMatch && slideText.includes(figureMatch[1])) score += 2;
  const captionMatch = `${asset.captionLabel || ''} ${asset.captionTitle || ''}`.match(/(?:fig(?:ure)?\.?|table|图|表)\s*(\d{1,3})/i);
  if (captionMatch && slideText.includes(captionMatch[1])) score += 4;
  if (asset.suggestedSlideTitle && slideText.includes(normalizeMatchText(asset.suggestedSlideTitle))) score += 6;
  if (/图|表|结果|证据|figure|table|chart|result|evidence/i.test(slideText)) score += 1;
  score += Math.round(imagePlacementPriority(asset) / 6);
  return score;
}

function fallbackLayoutWithoutImage(slide: DeckSlide): DeckSlideLayout {
  const role = inferSlideSemanticRole(slide);
  if (role === 'method') return 'flow';
  if (role === 'result') return 'chart';
  if (role === 'discussion') return 'matrix';
  if (role === 'background') return 'flow';
  return 'cards';
}

function isImageCompatibleWithSlide(slide: DeckSlide, asset: DeckImageAsset): boolean {
  const slideRole = inferSlideSemanticRole(slide);
  const imageRole = asset.semanticRole || inferImageSemanticRole(asset);
  const slideText = normalizeMatchText(`${slide.title} ${slide.visualHint || ''} ${slide.bullets.join(' ')} ${slide.note || ''}`);
  const imageText = normalizeMatchText([
    asset.captionLabel,
    asset.captionTitle,
    asset.caption,
    asset.description,
    asset.keyMessage,
    asset.suggestedUse,
    asset.nearbyText,
  ].join(' '));

  if (!imageText) return true;
  if (slideRole === 'method') {
    if (imageRole === 'method') return true;
    return /实验|设计|方法|材料|采样|处理|田间|监测|测定|流程|protocol|design|method|sampling|treatment|measurement|field/i.test(imageText)
      && !/结果|累计|排放因子|主成分|回归|相关|通量动态|cumulative|emission factor|principal component|regression|correlation|seasonal dynamics/i.test(imageText);
  }
  if (slideRole === 'background') {
    if (imageRole === 'background' || imageRole === 'method') return true;
    return /降水|温度|水分|WFPS|背景|矛盾|precipitation|temperature|water filled pore space|climate/i.test(imageText)
      && !/table\s*[1234]|主成分|回归|cumulative emissions|PCA|principal component|regression/i.test(imageText);
  }
  if (slideRole === 'result') {
    return imageRole === 'result' || imageRole === 'discussion' || /结果|累计|排放|通量|表|图|result|emission|flux|table|fig/i.test(imageText);
  }
  if (slideRole === 'discussion') {
    return imageRole === 'discussion' || imageRole === 'result' || /机制|相关|pH|主成分|反硝化|硝化|讨论|PCA|correlation|denitrification|nitrification|mechanism/i.test(imageText);
  }
  return !/logo|journal|cover|期刊|封面/i.test(imageText) || /图|表|fig|table/i.test(slideText);
}

function inferSlideSemanticRole(slide: DeckSlide): 'background' | 'method' | 'result' | 'discussion' | 'summary' | 'other' {
  const text = normalizeMatchText(`${slide.title} ${slide.visualHint || ''} ${slide.bullets.join(' ')} ${slide.note || ''}`);
  if (/总结|结论|展望|summary|conclusion/i.test(text)) return 'summary';
  if (/背景|动机|问题|矛盾|研究命题|background|question/i.test(text)) return 'background';
  if (/方法|材料|实验|设计|路线|监测|测定|采样|method|material|design|experiment|monitoring|sampling/i.test(text)) return 'method';
  if (/结果|证据|累计|通量|峰值|排放|因子|result|evidence|emission|flux|factor/i.test(text)) return 'result';
  if (/机制|讨论|解释|创新|相关|pH|硝化|反硝化|mechanism|discussion|correlation|denitrification|nitrification/i.test(text)) return 'discussion';
  return 'other';
}

function inferImageSemanticRole(asset: DeckImageAsset): 'background' | 'method' | 'result' | 'discussion' | 'summary' | 'other' {
  const text = normalizeMatchText([
    asset.captionLabel,
    asset.captionTitle,
    asset.caption,
    asset.description,
    asset.nearbyText,
  ].join(' '));
  if (/降水|温度|水分|WFPS|water filled pore space|precipitation|temperature|climate/i.test(text)) return 'background';
  if (/实验|设计|方法|材料|采样|处理|田间|监测|测定|protocol|design|method|sampling|treatment|measurement|field experiment/i.test(text)
    && !/累计|排放因子|主成分|回归|相关|cumulative|emission factor|principal component|regression|correlation/i.test(text)) return 'method';
  if (/主成分|相关|pH|反硝化|硝化|PCA|principal component|correlation|denitrification|nitrification/i.test(text)) return 'discussion';
  if (/结果|累计|排放|通量|表|图|seasonal dynamics|cumulative|emission|flux|factor|soil characteristics|regression|table|fig/i.test(text)) return 'result';
  return 'other';
}

function normalizeMatchText(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[_\-]+/g, ' ')
    .replace(/[^\u4e00-\u9fa5a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractMatchTokens(value: string): string[] {
  return Array.from(value.matchAll(/[a-z0-9.]{3,}|[\u4e00-\u9fa5]{2,}/g))
    .map((match) => match[0])
    .filter((token) => !['image', 'figure', 'table', 'caption', 'embedded', 'visual', '用户上传图片'].includes(token));
}

function getCanvasInfo(format: string): { width: number; height: number; viewBox: string } {
  const normalized = normalizeCanvasFormat(format);
  if (normalized === 'ppt43') return { width: 1024, height: 768, viewBox: '0 0 1024 768' };
  if (normalized === 'xiaohongshu' || normalized === 'xhs') return { width: 1242, height: 1660, viewBox: '0 0 1242 1660' };
  if (normalized === 'story') return { width: 1080, height: 1920, viewBox: '0 0 1080 1920' };
  return { width: 1280, height: 720, viewBox: '0 0 1280 720' };
}

async function prepareDeckImageAssets(projectPath: string): Promise<DeckImageAsset[]> {
  const sourceFiles = await collectFiles(path.join(projectPath, 'sources')).catch(() => []);
  const imagesDir = path.join(projectPath, 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  const assets: DeckImageAsset[] = [];
  for (const source of sourceFiles) {
    const ext = path.extname(source).toLowerCase();
    if (!isDeckImageExtension(ext)) continue;
    const stat = await fs.stat(source).catch(() => null);
    if (!stat || stat.size > 25 * 1024 * 1024) continue;
    const filename = await uniquePath(path.join(imagesDir, safeBasename(path.basename(source))));
    await fs.copyFile(source, filename).catch(() => undefined);
    if (existsSync(filename)) {
      assets.push({
        name: path.basename(filename),
        href: `../images/${path.basename(filename)}`,
        absolutePath: filename,
      });
    }
    if (assets.length >= 8) break;
  }
  return assets;
}

async function extractPdfVisualAssets(projectPath: string): Promise<DeckImageAsset[]> {
  const scriptPath = resolvePdfVisualExtractorScript();
  if (!scriptPath) return [];
  const python = await findPythonCommand();
  const result = await runProcess(python.command, [
    ...python.argsPrefix,
    scriptPath,
    projectPath,
    '--max-assets',
    '12',
  ], {
    cwd: resolveProjectRoot(),
    timeoutMs: DEFAULT_PROCESS_TIMEOUT_MS,
  });

  if (result.exitCode !== 0) {
    logger.warn(`[PptMaster] PDF visual extraction failed: ${result.stderr || result.stdout}`);
    return [];
  }

  const manifestPath = path.join(projectPath, 'images', 'pdf-figures', 'manifest.json');
  const parsed = await readJsonIfExists(manifestPath);
  const items = Array.isArray((parsed as { items?: unknown[] })?.items)
    ? (parsed as { items: Array<Record<string, unknown>> }).items
    : [];

  return items.map((item): DeckImageAsset | null => {
    const filename = safeBasename(String(item.filename || ''));
    const absolutePath = String(item.absolutePath || path.join(projectPath, 'images', 'pdf-figures', filename));
    if (!filename || !existsSync(absolutePath)) return null;
    const asset: DeckImageAsset = {
      name: filename,
      href: `../images/pdf-figures/${filename}`,
      absolutePath,
      description: cleanText(item.description || item.caption, 360),
      suggestedUse: cleanText(item.suggestedUse, 220),
      confidence: cleanText(item.confidence, 30),
      source: cleanText(item.source, 80),
      sourcePdf: cleanText(item.sourcePdf, 180),
      page: Number(item.page) || undefined,
      caption: cleanText(item.caption, 1200),
      captionLabel: cleanText(item.captionLabel, 80),
      captionTitle: cleanText(item.captionTitle, 360),
      sectionTitle: cleanText(item.sectionTitle, 180),
      contextBefore: cleanText(item.contextBefore, 800),
      contextAfter: cleanText(item.contextAfter, 800),
      nearbyText: cleanText(item.nearbyText, 1400),
      semanticRole: cleanText(item.semanticRole, 80),
      width: Number(item.width) || undefined,
      height: Number(item.height) || undefined,
    };
    asset.semanticRole = asset.semanticRole || inferImageSemanticRole(asset);
    return asset;
  }).filter((asset): asset is DeckImageAsset => !!asset);
}

function resolvePdfVisualExtractorScript(): string | null {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    process.env.PPT_PDF_VISUAL_EXTRACTOR,
    resourcesPath ? path.join(resourcesPath, 'scripts', 'extract-pdf-visuals.py') : undefined,
    path.join(resolveProjectRoot(), 'scripts', 'extract-pdf-visuals.py'),
  ].filter(Boolean) as string[];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

async function analyzeDeckImagesWithCodex(projectPath: string, assets: DeckImageAsset[]): Promise<DeckImageAsset[]> {
  const manifestPath = path.join(projectPath, 'images', 'image_manifest.json');
  if (!assets.length) {
    await fs.writeFile(manifestPath, JSON.stringify([], null, 2), 'utf8').catch(() => undefined);
    return assets;
  }

  const fallback = assets.map((asset) => ({
    ...asset,
    description: asset.description || asset.captionTitle || asset.caption || `用户上传图片：${asset.name}`,
    suggestedUse: asset.suggestedUse || '作为图片证据页或材料展示页使用，需与图题、图注和上下文匹配',
    semanticRole: asset.semanticRole || inferImageSemanticRole(asset),
    confidence: asset.confidence || 'low',
  }));

  const status = await chatBridge.getCodexCliStatus().catch((error) => ({
    available: false,
    path: '',
    error: (error as Error).message,
  }));
  if (!status.available) {
    await fs.writeFile(manifestPath, JSON.stringify(fallback, null, 2), 'utf8').catch(() => undefined);
    return fallback;
  }

  const codexAssets = fallback.slice(0, Math.min(8, fallback.length));
  try {
    const response = await chatBridge.chat({
      forceProvider: 'codex',
      disableFallback: true,
      codexTimeoutMs: 120000,
      temperature: 0.1,
      maxTokens: 3000,
      messages: [{
        role: 'user',
        content: [
          '请分析这些本地图片文件及其 PDF 图题/图注/上下文，为学术汇报 PPT 生成图文证据摘要。',
          '必须优先相信图题、图注和附近正文；只有能从图片或上下文确认的信息才可写入摘要。',
          '你可以直接读取本地路径；如果某张图无法读取，就基于图题/图注/上下文说明，并标记 medium 或 low confidence，不要编造。',
          '只输出严格 JSON，不要 Markdown。',
          '',
          '输出 schema:',
          '{"images":[{"name":"文件名","captionTitle":"图题短标题","description":"可确认的图像内容摘要","semanticRole":"background|method|result|discussion|limitation|summary","keyMessage":"该图支撑的核心结论或信息","suggestedSlideTitle":"最适合放入的页面标题","suggestedUse":"适合放在哪类页面","placementReason":"为什么应放在该页面","confidence":"high|medium|low"}]}',
          '',
          '图文证据包：',
          formatImageAssetsForPrompt(codexAssets),
        ].join('\n'),
      }],
    });
    const raw = parseDeckOutlineJson(response) as Record<string, unknown>;
    const rows = Array.isArray(raw?.images) ? raw.images : [];
    const byName = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const item = row as Record<string, unknown>;
      const name = cleanText(item.name, 180);
      if (name) byName.set(name, item);
    }
    const enriched = fallback.map((asset) => {
      const item = byName.get(asset.name);
      if (!item) return asset;
      return {
        ...asset,
        captionTitle: cleanText(item.captionTitle, 360) || asset.captionTitle,
        description: cleanText(item.description, 360) || asset.description,
        semanticRole: cleanText(item.semanticRole, 80) || asset.semanticRole,
        keyMessage: cleanText(item.keyMessage, 260) || asset.keyMessage,
        suggestedSlideTitle: cleanText(item.suggestedSlideTitle, 120) || asset.suggestedSlideTitle,
        suggestedUse: cleanText(item.suggestedUse, 220) || asset.suggestedUse,
        placementReason: cleanText(item.placementReason, 260) || asset.placementReason,
        confidence: cleanText(item.confidence, 30) || asset.confidence,
      };
    });
    await fs.writeFile(manifestPath, JSON.stringify(enriched, null, 2), 'utf8').catch(() => undefined);
    return enriched;
  } catch (error) {
    logger.warn('[PptMaster] Codex image analysis failed, using filename fallback:', error);
    await fs.writeFile(manifestPath, JSON.stringify(fallback, null, 2), 'utf8').catch(() => undefined);
    return fallback;
  }
}

function sortImageAssetsForPlacement(assets: DeckImageAsset[]): DeckImageAsset[] {
  return [...assets].sort((a, b) => imagePlacementPriority(b) - imagePlacementPriority(a));
}

function imagePlacementPriority(asset: DeckImageAsset): number {
  const area = (asset.width || 0) * (asset.height || 0);
  let score = 0;
  if (asset.source === 'caption-crop') score += 30;
  if (asset.source === 'visual-region') score += 22;
  if (asset.source === 'embedded-image') score += 12;
  if (asset.captionTitle || asset.caption) score += 10;
  if (asset.keyMessage || asset.semanticRole) score += 6;
  if (area >= 600_000) score += 8;
  else if (area >= 250_000) score += 5;
  else if (area > 0 && area < 120_000) score -= 10;
  if (asset.width && asset.width < 480) score -= 5;
  if (asset.height && asset.height < 320) score -= 5;
  if (/caption|fig|figure|table|图|表/i.test(`${asset.name} ${asset.captionLabel || ''} ${asset.captionTitle || ''} ${asset.description || ''}`)) score += 4;
  return score;
}

function renderSlideSvg(input: {
  canvas: { width: number; height: number; viewBox: string };
  slide: DeckSlide;
  index: number;
  total: number;
  deckTitle: string;
  deckSubtitle: string;
  imageAssets: DeckImageAsset[];
}): string {
  const { canvas, slide, index, total } = input;
  const isCover = index === 0;
  const margin = Math.round(canvas.width * 0.07);
  const top = Math.round(canvas.height * 0.12);
  const titleSize = Math.max(34, Math.round(canvas.width * (isCover ? 0.044 : 0.032)));
  const maxChars = canvas.width > canvas.height ? 34 : 22;
  const titleLines = wrapText(isCover ? input.deckTitle : slide.title, isCover ? maxChars : maxChars + 4).slice(0, 3);
  const subtitle = isCover ? input.deckSubtitle : `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
  const theme = getSlideTheme(index);
  const layout = normalizeSlideLayout(slide.layout, index, total);
  const titleText = titleLines.map((line, i) =>
    `<text x="${margin}" y="${top + i * Math.round(titleSize * 1.18)}" font-family="Microsoft YaHei, Arial" font-size="${titleSize}" font-weight="700" fill="#0F172A">${escapeXml(line)}</text>`
  ).join('\n  ');
  const subtitleY = top + titleLines.length * Math.round(titleSize * 1.18) + Math.round(titleSize * 0.55);
  const footerY = canvas.height - Math.round(canvas.height * 0.06);
  const bodyTop = isCover ? Math.round(canvas.height * 0.55) : Math.round(canvas.height * 0.31);
  const bodyHeight = footerY - bodyTop - 28;
  const bodyWidth = canvas.width - margin * 2;
  const content = renderSlideVisual({
    canvas,
    slide,
    layout,
    x: margin,
    y: bodyTop,
    width: bodyWidth,
    height: bodyHeight,
    index,
    total,
    theme,
    imageAssets: input.imageAssets,
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="${canvas.viewBox}">
  <rect x="0" y="0" width="${canvas.width}" height="${canvas.height}" fill="#F8FAFC"/>
  <rect x="0" y="0" width="${Math.round(canvas.width * 0.018)}" height="${canvas.height}" fill="${theme.accent}"/>
  <circle cx="${Math.round(canvas.width * 0.86)}" cy="${Math.round(canvas.height * 0.18)}" r="${Math.round(canvas.width * 0.11)}" fill="${theme.light}" fill-opacity="0.7"/>
  <circle cx="${Math.round(canvas.width * 0.79)}" cy="${Math.round(canvas.height * 0.29)}" r="${Math.round(canvas.width * 0.045)}" fill="${theme.mid}" fill-opacity="0.55"/>
  <rect x="${margin}" y="${Math.round(canvas.height * 0.22)}" width="${Math.round(canvas.width * 0.86)}" height="1" fill="#CBD5E1"/>
  ${titleText}
  <text x="${margin}" y="${subtitleY}" font-family="Microsoft YaHei, Arial" font-size="${Math.max(18, Math.round(titleSize * 0.38))}" fill="#64748B">${escapeXml(subtitle || 'Scholar Harness')}</text>
  ${content}
  <text x="${margin}" y="${footerY}" font-family="Microsoft YaHei, Arial" font-size="${Math.max(14, Math.round(canvas.width * 0.012))}" fill="#64748B">${escapeXml(isCover ? 'Scholar Harness 自动生成' : input.deckTitle)}</text>
  <text x="${canvas.width - margin - 60}" y="${footerY}" font-family="Arial" font-size="${Math.max(14, Math.round(canvas.width * 0.012))}" fill="#64748B">${index + 1}/${total}</text>
</svg>
`;
}

function getSlideTheme(index: number): { accent: string; light: string; mid: string } {
  const themes = [
    { accent: '#0F766E', light: '#CCFBF1', mid: '#5EEAD4' },
    { accent: '#2563EB', light: '#DBEAFE', mid: '#93C5FD' },
    { accent: '#7C3AED', light: '#EDE9FE', mid: '#C4B5FD' },
    { accent: '#B45309', light: '#FEF3C7', mid: '#FCD34D' },
    { accent: '#BE123C', light: '#FFE4E6', mid: '#FDA4AF' },
  ];
  return themes[index % themes.length];
}

function renderSlideVisual(input: {
  canvas: { width: number; height: number; viewBox: string };
  slide: DeckSlide;
  layout: DeckSlideLayout;
  x: number;
  y: number;
  width: number;
  height: number;
  index: number;
  total: number;
  theme: { accent: string; light: string; mid: string };
  imageAssets: DeckImageAsset[];
}): string {
  if (input.layout === 'cover') return renderCoverVisual(input);
  if (input.layout === 'agenda') return renderAgendaVisual(input);
  if (input.layout === 'flow') return renderFlowVisual(input);
  if (input.layout === 'timeline') return renderTimelineVisual(input);
  if (input.layout === 'cards') return renderCardsVisual(input);
  if (input.layout === 'matrix') return renderMatrixVisual(input);
  if (input.layout === 'chart') return renderChartVisual(input);
  if (input.layout === 'image') return renderImageVisual(input);
  return renderSummaryVisual(input);
}

function renderCoverVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme } = input;
  const chips = (slide.bullets.length ? slide.bullets : ['研究背景', '技术路线', '关键发现']).slice(0, 4);
  const chipWidth = Math.floor((width - 48) / Math.min(4, chips.length));
  const chipSvg = chips.map((chip, i) => {
    const cx = x + i * (chipWidth + 16);
    return `<rect x="${cx}" y="${y + Math.round(height * 0.48)}" width="${chipWidth}" height="70" rx="14" fill="#FFFFFF" stroke="#CBD5E1"/>
  <circle cx="${cx + 28}" cy="${y + Math.round(height * 0.48) + 35}" r="10" fill="${theme.accent}"/>
  <text x="${cx + 50}" y="${y + Math.round(height * 0.48) + 43}" font-family="Microsoft YaHei, Arial" font-size="20" font-weight="700" fill="#0F172A">${escapeXml(chip.slice(0, 18))}</text>`;
  }).join('\n  ');
  return `<rect x="${x}" y="${y}" width="${width}" height="${Math.round(height * 0.32)}" rx="24" fill="${theme.light}" fill-opacity="0.74"/>
  <path d="M ${x + 28} ${y + Math.round(height * 0.16)} L ${x + Math.round(width * 0.35)} ${y + Math.round(height * 0.16)} L ${x + Math.round(width * 0.48)} ${y + Math.round(height * 0.27)} L ${x + Math.round(width * 0.8)} ${y + Math.round(height * 0.08)}" fill="none" stroke="${theme.accent}" stroke-width="5"/>
  <circle cx="${x + Math.round(width * 0.8)}" cy="${y + Math.round(height * 0.08)}" r="13" fill="${theme.accent}"/>
  ${chipSvg}`;
}

function renderAgendaVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, slide, theme } = input;
  const items = slide.bullets.slice(0, 5);
  const rowH = 62;
  return items.map((item, i) => {
    const yy = y + i * (rowH + 12);
    return `<rect x="${x}" y="${yy}" width="${width}" height="${rowH}" rx="14" fill="#FFFFFF" stroke="#E2E8F0"/>
  <circle cx="${x + 34}" cy="${yy + 31}" r="18" fill="${theme.light}"/>
  <text x="${x + 26}" y="${yy + 39}" font-family="Arial" font-size="22" font-weight="700" fill="${theme.accent}">${i + 1}</text>
  <text x="${x + 72}" y="${yy + 39}" font-family="Microsoft YaHei, Arial" font-size="23" font-weight="700" fill="#1E293B">${escapeXml(item)}</text>`;
  }).join('\n  ');
}

function renderFlowVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme } = input;
  const steps = slide.bullets.slice(0, 5);
  const boxW = Math.floor((width - (steps.length - 1) * 34) / Math.max(1, steps.length));
  const boxH = Math.min(126, Math.round(height * 0.48));
  const yy = y + Math.round(height * 0.2);
  return steps.map((step, i) => {
    const xx = x + i * (boxW + 34);
    const arrow = i < steps.length - 1
      ? `<line x1="${xx + boxW + 8}" y1="${yy + boxH / 2}" x2="${xx + boxW + 28}" y2="${yy + boxH / 2}" stroke="${theme.accent}" stroke-width="3"/>
  <polygon points="${xx + boxW + 28},${yy + boxH / 2} ${xx + boxW + 18},${yy + boxH / 2 - 7} ${xx + boxW + 18},${yy + boxH / 2 + 7}" fill="${theme.accent}"/>`
      : '';
    return `<rect x="${xx}" y="${yy}" width="${boxW}" height="${boxH}" rx="18" fill="#FFFFFF" stroke="${theme.mid}" stroke-width="2"/>
  <circle cx="${xx + 34}" cy="${yy + 34}" r="18" fill="${theme.accent}"/>
  <text x="${xx + 26}" y="${yy + 42}" font-family="Arial" font-size="22" font-weight="700" fill="#FFFFFF">${i + 1}</text>
  ${renderWrappedSvgText(step, xx + 22, yy + 76, boxW - 36, 20, 2, '#0F172A', '700')}
  ${arrow}`;
  }).join('\n  ');
}

function renderTimelineVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme } = input;
  const items = slide.bullets.slice(0, 5);
  const lineY = y + Math.round(height * 0.46);
  const gap = width / Math.max(1, items.length - 1);
  const nodes = items.map((item, i) => {
    const xx = items.length === 1 ? x + width / 2 : x + i * gap;
    const textY = i % 2 === 0 ? lineY - 94 : lineY + 52;
    return `<circle cx="${xx}" cy="${lineY}" r="15" fill="${theme.accent}"/>
  <circle cx="${xx}" cy="${lineY}" r="27" fill="${theme.light}" fill-opacity="0.65"/>
  <text x="${xx - 10}" y="${lineY + 7}" font-family="Arial" font-size="18" font-weight="700" fill="#FFFFFF">${i + 1}</text>
  ${renderWrappedSvgText(item, xx - 88, textY, 176, 18, 3, '#1E293B', '700')}`;
  }).join('\n  ');
  return `<line x1="${x}" y1="${lineY}" x2="${x + width}" y2="${lineY}" stroke="#CBD5E1" stroke-width="4"/>
  ${nodes}`;
}

function renderCardsVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme } = input;
  const items = slide.bullets.slice(0, 4);
  const cols = 2;
  const cardW = Math.floor((width - 24) / 2);
  const cardH = Math.floor((height - 24) / 2);
  return items.map((item, i) => {
    const xx = x + (i % cols) * (cardW + 24);
    const yy = y + Math.floor(i / cols) * (cardH + 24);
    return `<rect x="${xx}" y="${yy}" width="${cardW}" height="${cardH}" rx="18" fill="#FFFFFF" stroke="#E2E8F0"/>
  <rect x="${xx}" y="${yy}" width="8" height="${cardH}" rx="4" fill="${theme.accent}"/>
  <circle cx="${xx + 44}" cy="${yy + 42}" r="19" fill="${theme.light}"/>
  <text x="${xx + 36}" y="${yy + 50}" font-family="Arial" font-size="21" font-weight="700" fill="${theme.accent}">${i + 1}</text>
  ${renderWrappedSvgText(item, xx + 76, yy + 42, cardW - 100, 22, 4, '#0F172A', '700')}`;
  }).join('\n  ');
}

function renderMatrixVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme } = input;
  const items = slide.bullets.slice(0, 4);
  const midX = x + width / 2;
  const midY = y + height / 2;
  const labels = ['理论依据', '方法支撑', '结果证据', '应用价值'];
  const cells = items.map((item, i) => {
    const xx = i % 2 === 0 ? x : midX;
    const yy = i < 2 ? y : midY;
    const cellW = width / 2;
    const cellH = height / 2;
    return `<rect x="${xx + 8}" y="${yy + 8}" width="${cellW - 16}" height="${cellH - 16}" rx="18" fill="${i % 2 === 0 ? '#FFFFFF' : theme.light}" stroke="#E2E8F0"/>
  <text x="${xx + 30}" y="${yy + 44}" font-family="Microsoft YaHei, Arial" font-size="18" font-weight="700" fill="${theme.accent}">${escapeXml(labels[i] || `模块${i + 1}`)}</text>
  ${renderWrappedSvgText(item, xx + 30, yy + 84, cellW - 60, 21, 4, '#0F172A', '700')}`;
  }).join('\n  ');
  return `<line x1="${midX}" y1="${y}" x2="${midX}" y2="${y + height}" stroke="#CBD5E1" stroke-width="2"/>
  <line x1="${x}" y1="${midY}" x2="${x + width}" y2="${midY}" stroke="#CBD5E1" stroke-width="2"/>
  ${cells}`;
}

function renderChartVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme } = input;
  const items = slide.bullets.slice(0, 5);
  const chartX = x + Math.round(width * 0.08);
  const chartY = y + Math.round(height * 0.12);
  const chartW = Math.round(width * 0.54);
  const chartH = Math.round(height * 0.7);
  const maxBar = Math.max(1, ...items.map((item) => item.length));
  const bars = items.map((item, i) => {
    const barH = Math.max(28, Math.round((item.length / maxBar) * (chartH - 40)));
    const barW = Math.floor(chartW / (items.length * 1.55));
    const xx = chartX + 34 + i * Math.floor(chartW / Math.max(1, items.length));
    const yy = chartY + chartH - barH;
    return `<rect x="${xx}" y="${yy}" width="${barW}" height="${barH}" rx="8" fill="${i % 2 === 0 ? theme.accent : theme.mid}"/>
  <text x="${xx}" y="${chartY + chartH + 28}" font-family="Arial" font-size="14" fill="#64748B">P${i + 1}</text>`;
  }).join('\n  ');
  const legend = items.map((item, i) =>
    `<circle cx="${x + Math.round(width * 0.7)}" cy="${chartY + 28 + i * 44}" r="7" fill="${i % 2 === 0 ? theme.accent : theme.mid}"/>
  ${renderWrappedSvgText(item, x + Math.round(width * 0.72), chartY + 34 + i * 44, Math.round(width * 0.24), 17, 2, '#1E293B', '600')}`
  ).join('\n  ');
  return `<rect x="${chartX}" y="${chartY}" width="${chartW}" height="${chartH}" rx="18" fill="#FFFFFF" stroke="#E2E8F0"/>
  <line x1="${chartX + 34}" y1="${chartY + chartH}" x2="${chartX + chartW - 24}" y2="${chartY + chartH}" stroke="#94A3B8" stroke-width="2"/>
  <line x1="${chartX + 34}" y1="${chartY + 24}" x2="${chartX + 34}" y2="${chartY + chartH}" stroke="#94A3B8" stroke-width="2"/>
  ${bars}
  <text x="${chartX + 34}" y="${chartY + 42}" font-family="Microsoft YaHei, Arial" font-size="18" font-weight="700" fill="#334155">重点权重示意</text>
  ${legend}`;
}

function renderImageVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, height, slide, theme, imageAssets, index } = input;
  const asset = selectSlideImageAsset(slide, imageAssets, index);
  const panelW = Math.round(width * 0.52);
  const textX = x + panelW + 40;
  const frame = asset ? fitImageAssetFrame(asset, x, y, panelW, height) : null;
  const imageBlock = asset
    ? `<rect x="${x}" y="${y}" width="${panelW}" height="${height}" rx="20" fill="#FFFFFF" stroke="#CBD5E1"/>
  <image x="${frame?.x || x}" y="${frame?.y || y}" width="${frame?.width || panelW}" height="${frame?.height || height}" href="${escapeXml(asset.href)}" preserveAspectRatio="xMidYMid meet"/>`
    : `<rect x="${x}" y="${y}" width="${panelW}" height="${height}" rx="20" fill="${theme.light}" stroke="#CBD5E1"/>
  <path d="M ${x + 60} ${y + height - 72} L ${x + Math.round(panelW * 0.34)} ${y + Math.round(height * 0.52)} L ${x + Math.round(panelW * 0.52)} ${y + Math.round(height * 0.67)} L ${x + Math.round(panelW * 0.72)} ${y + Math.round(height * 0.42)} L ${x + panelW - 56} ${y + height - 72} Z" fill="${theme.accent}" fill-opacity="0.35"/>
  <circle cx="${x + Math.round(panelW * 0.72)}" cy="${y + 82}" r="28" fill="${theme.accent}" fill-opacity="0.55"/>
  <text x="${x + 48}" y="${y + 64}" font-family="Microsoft YaHei, Arial" font-size="20" font-weight="700" fill="${theme.accent}">图片 / 证据占位</text>`;
  return `${imageBlock}
  ${renderWrappedSvgText(slide.visualHint || asset?.suggestedUse || '图像证据与关键结论', textX, y + 24, width - panelW - 48, 21, 3, theme.accent, '700')}
  ${asset?.description ? renderWrappedSvgText(asset.description, textX, y + 96, width - panelW - 48, 17, 2, '#64748B', '600') : ''}
  ${renderBulletList(slide.bullets.slice(0, 4), textX, y + (asset?.description ? 156 : 126), width - panelW - 48, 22, theme.accent)}`;
}

function fitImageAssetFrame(asset: DeckImageAsset, x: number, y: number, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const naturalWidth = Number.isFinite(asset.width) ? Math.max(1, Math.round(asset.width || 0)) : 0;
  const naturalHeight = Number.isFinite(asset.height) ? Math.max(1, Math.round(asset.height || 0)) : 0;
  if (!naturalWidth || !naturalHeight) {
    return { x, y, width, height };
  }

  const scale = Math.min(width / naturalWidth, height / naturalHeight, 1);
  const fittedWidth = Math.max(1, Math.round(naturalWidth * scale));
  const fittedHeight = Math.max(1, Math.round(naturalHeight * scale));
  return {
    x: Math.round(x + (width - fittedWidth) / 2),
    y: Math.round(y + (height - fittedHeight) / 2),
    width: fittedWidth,
    height: fittedHeight,
  };
}

function selectSlideImageAsset(slide: DeckSlide, imageAssets: DeckImageAsset[], index: number): DeckImageAsset | null {
  if (!imageAssets.length) return null;
  const explicit = resolveImageAssetByName(slide.imageAssetName, imageAssets);
  if (explicit) return explicit;
  const match = findBestImageAssetForSlide(slide, imageAssets);
  if (match && match.score >= 3) return match.asset;
  return null;
}

function renderSummaryVisual(input: Parameters<typeof renderSlideVisual>[0]): string {
  const { x, y, width, slide, theme } = input;
  const items = slide.bullets.slice(0, 5);
  return `<rect x="${x}" y="${y}" width="${width}" height="${Math.max(120, items.length * 66 + 34)}" rx="22" fill="#FFFFFF" stroke="#E2E8F0"/>
  ${items.map((item, i) => {
    const yy = y + 52 + i * 64;
    return `<circle cx="${x + 42}" cy="${yy - 10}" r="16" fill="${theme.accent}"/>
  <path d="M ${x + 34} ${yy - 10} L ${x + 40} ${yy - 4} L ${x + 52} ${yy - 18}" fill="none" stroke="#FFFFFF" stroke-width="4"/>
  ${renderWrappedSvgText(item, x + 78, yy, width - 110, 23, 2, '#0F172A', '700')}`;
  }).join('\n  ')}`;
}

function renderBulletList(items: string[], x: number, y: number, width: number, fontSize: number, accent: string): string {
  return items.map((item, i) => {
    const yy = y + i * Math.round(fontSize * 2.05);
    return `<circle cx="${x + 9}" cy="${yy - Math.round(fontSize * 0.32)}" r="${Math.max(4, Math.round(fontSize * 0.16))}" fill="${accent}"/>
  ${renderWrappedSvgText(item, x + 30, yy, width - 32, fontSize, 2, '#1E293B', '600')}`;
  }).join('\n  ');
}

function renderWrappedSvgText(
  text: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  maxLines: number,
  fill: string,
  fontWeight: string,
): string {
  const maxChars = Math.max(8, Math.floor(width / (fontSize * 0.86)));
  return wrapText(text, maxChars).slice(0, maxLines).map((line, i) =>
    `<text x="${Math.round(x)}" y="${Math.round(y + i * fontSize * 1.35)}" font-family="Microsoft YaHei, Arial" font-size="${fontSize}" font-weight="${fontWeight}" fill="${fill}">${escapeXml(line)}</text>`
  ).join('\n  ');
}

function wrapText(text: string, maxChars: number): string[] {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const lines: string[] = [];
  let current = '';
  for (const char of clean) {
    current += char;
    const weight = Array.from(current).reduce((sum, c) => sum + (/[\u4e00-\u9fff]/.test(c) ? 1 : 0.55), 0);
    if (weight >= maxChars) {
      lines.push(current.trim());
      current = '';
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

function slugForFile(value: string): string {
  return String(value || '')
    .trim()
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_-]/g, '')
    .slice(0, 36);
}

function escapeXml(value: string): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function readJsonIfExists(filePath: string): Promise<unknown> {
  try {
    if (!existsSync(filePath)) return null;
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function getUploadedFiles(files: unknown, fieldName: string): Express.Multer.File[] {
  const bag = files as Record<string, Express.Multer.File[]> | undefined;
  return Array.isArray(bag?.[fieldName]) ? bag[fieldName] : [];
}

function getPptMasterDataRoot(): string {
  return path.join(getDataDir(), 'ppt-master');
}

function getPptMasterProjectsRoot(userId: string): string {
  return path.join(getPptMasterDataRoot(), 'projects', sanitizeUserId(userId));
}

function getPptMasterStagingRoot(userId: string): string {
  return path.join(getPptMasterDataRoot(), 'staging', sanitizeUserId(userId));
}

function resolvePptMasterSkillDir(): string {
  const explicit = process.env.PPT_MASTER_SKILL_DIR;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const candidates = [
    explicit,
    resourcesPath ? path.join(resourcesPath, 'tools', 'ppt-master', 'skills', 'ppt-master') : undefined,
    path.join(resolveProjectRoot(), 'tools', 'ppt-master', 'skills', 'ppt-master'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, 'SKILL.md')) &&
      existsSync(path.join(candidate, 'scripts', 'project_manager.py'))
    ) {
      return candidate;
    }
  }

  throw new Error('未找到 ppt-master skill。请确认 tools/ppt-master/skills/ppt-master 已下载，或设置 PPT_MASTER_SKILL_DIR。');
}

function resolveProjectRoot(): string {
  const maybeDist = path.resolve(__dirname, '..', '..', '..');
  return path.basename(maybeDist) === 'dist' ? path.resolve(maybeDist, '..') : maybeDist;
}

function getPythonCandidates(): PythonCommand[] {
  const configured = process.env.PYTHON || process.env.PYTHON_EXE;
  const candidates: PythonCommand[] = [];
  if (configured) {
    candidates.push({ command: configured, argsPrefix: [], display: configured });
  }
  candidates.push(
    { command: 'python', argsPrefix: [], display: 'python' },
    { command: 'python3', argsPrefix: [], display: 'python3' },
    { command: 'py', argsPrefix: ['-3'], display: 'py -3' },
  );
  return candidates;
}

async function findPythonCommand(): Promise<PythonCommand> {
  if (cachedPythonCommand) return cachedPythonCommand;
  for (const candidate of getPythonCandidates()) {
    const result = await runProcess(candidate.command, [...candidate.argsPrefix, '--version'], {
      cwd: resolveProjectRoot(),
      timeoutMs: 8000,
    });
    if (result.exitCode === 0) {
      cachedPythonCommand = candidate;
      return candidate;
    }
  }
  throw new Error('未检测到 Python。请安装 Python 3，并确保 python 或 py -3 可用。');
}

async function runPptMasterScript(scriptName: string, args: string[], timeoutMs: number): Promise<ProcessResult> {
  const skillDir = resolvePptMasterSkillDir();
  const scriptPath = path.join(skillDir, 'scripts', scriptName);
  if (!existsSync(scriptPath)) {
    throw new Error(`ppt-master 脚本不存在: ${scriptName}`);
  }
  const python = await findPythonCommand();
  return runProcess(python.command, [...python.argsPrefix, scriptPath, ...args], {
    cwd: skillDir,
    timeoutMs,
  });
}

async function runProcess(
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number },
): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const commandLine = `${command} ${args.map(formatCommandArg).join(' ')}`.trim();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout = trimProcessOutput(stdout + chunk.toString('utf8'));
    });
    child.stderr.on('data', (chunk) => {
      stderr = trimProcessOutput(stderr + chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        command: commandLine,
        exitCode: null,
        timedOut,
        stdout,
        stderr: trimProcessOutput(`${stderr}\n${error.message}`),
      });
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolve({
        command: commandLine,
        exitCode,
        timedOut,
        stdout,
        stderr,
      });
    });
  });
}

function trimProcessOutput(value: string): string {
  if (value.length <= PROCESS_OUTPUT_LIMIT) return value;
  return value.slice(value.length - PROCESS_OUTPUT_LIMIT);
}

function formatCommandArg(arg: string): string {
  return /\s/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg;
}

function assertProcessSuccess(result: ProcessResult, fallbackMessage: string): void {
  if (result.exitCode === 0 && !result.timedOut) return;
  const detail = (result.stderr || result.stdout || '').trim();
  throw new Error(`${fallbackMessage}${detail ? `：${detail}` : ''}`);
}

function summarizeProcess(result: ProcessResult): ProcessResult {
  return {
    command: result.command,
    exitCode: result.exitCode,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function extractProjectPath(stdout: string): string | null {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/(?:Project created:|\[OK\] Project initialized:)\s*(.+)$/);
    if (match) return match[1].trim();
  }
  return null;
}

function normalizeProjectName(value?: string): string {
  const raw = String(value || `scholarharness_ppt_${new Date().toISOString().slice(0, 10)}`).trim();
  const cleaned = raw
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  return cleaned || `scholarharness_ppt_${Date.now()}`;
}

function normalizeCanvasFormat(value?: string): string {
  const cleaned = String(value || 'ppt169').trim();
  return /^[a-zA-Z0-9_-]{2,40}$/.test(cleaned) ? cleaned : 'ppt169';
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value || '').trim().slice(0, maxLength);
}

async function saveUploadedFile(file: Express.Multer.File, targetDir: string): Promise<string> {
  const filename = safeBasename(file.originalname);
  const targetPath = await uniquePath(path.join(targetDir, filename));
  await fs.writeFile(targetPath, file.buffer);
  return targetPath;
}

function safeBasename(value: string): string {
  const cleaned = path.basename(value || '')
    .replace(/[/\\:<>|"?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `file_${randomUUID()}`;
}

async function uniquePath(filePath: string): Promise<string> {
  if (!existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  for (let i = 2; i < 10_000; i += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}_${i}${parsed.ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error('无法生成唯一文件名');
}

async function listTemplateOptions(): Promise<TemplateOption[]> {
  const skillDir = resolvePptMasterSkillDir();
  const templatesRoot = path.join(skillDir, 'templates');
  const groups = [
    { dir: 'brands', kind: 'brand', label: '品牌' },
    { dir: 'layouts', kind: 'layout', label: '版式' },
    { dir: 'decks', kind: 'deck', label: '整套模板' },
  ];
  const options: TemplateOption[] = [];

  for (const group of groups) {
    const groupDir = path.join(templatesRoot, group.dir);
    if (!existsSync(groupDir)) continue;
    const entries = await fs.readdir(groupDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const templateDir = path.join(groupDir, entry.name);
      const specPath = path.join(templateDir, 'design_spec.md');
      if (!existsSync(specPath)) continue;
      const spec = await fs.readFile(specPath, 'utf8').catch(() => '');
      const summary = extractTemplateSummary(spec);
      const kind = extractTemplateKind(spec) || group.kind;
      options.push({
        id: `${group.dir}/${entry.name}`,
        label: `${group.label} · ${entry.name}`,
        kind,
        group: group.dir,
        relativePath: `templates/${group.dir}/${entry.name}`,
        absolutePath: templateDir,
        summary,
      });
    }
  }

  return options.sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
}

function extractTemplateKind(spec: string): string | null {
  const match = spec.match(/^kind:\s*([a-zA-Z_-]+)/m);
  return match ? match[1].trim() : null;
}

function extractTemplateSummary(spec: string): string | undefined {
  const summaryMatch = spec.match(/^summary:\s*(.+)$/m);
  if (summaryMatch) return summaryMatch[1].trim().replace(/^["']|["']$/g, '').slice(0, 220);
  const headingMatch = spec.match(/^#\s+(.+)$/m);
  return headingMatch ? headingMatch[1].trim().slice(0, 220) : undefined;
}

async function applySelectedTemplate(projectPath: string, selectedTemplate?: string): Promise<TemplateOption | null> {
  const normalized = cleanText(selectedTemplate, 260);
  if (!normalized) return null;
  const options = await listTemplateOptions();
  const option = options.find((item) => item.relativePath === normalized || item.id === normalized);
  if (!option) {
    throw new Error(`未找到内置模板: ${normalized}`);
  }
  const templatesDir = path.join(projectPath, 'templates');
  await fs.mkdir(templatesDir, { recursive: true });
  await copyDirectoryContents(option.absolutePath, templatesDir);
  return option;
}

async function copyDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    await fs.cp(source, target, { recursive: true, force: true });
  }
}

async function importUploadedPptxTemplate(
  projectPath: string,
  file: Express.Multer.File,
  templateStagingDir: string,
): Promise<{ originalName: string; outputDir: string; log: ProcessResult }> {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_TEMPLATE_EXTENSIONS.has(ext)) {
    throw new Error('用户模板目前仅支持 .pptx，便于完整提取母版、版式和继承关系。');
  }
  const stagedTemplate = await saveUploadedFile(file, templateStagingDir);
  const outputDir = await uniquePath(path.join(projectPath, 'templates', 'uploaded_pptx_template'));
  const result = await runPptMasterScript('pptx_template_import.py', [
    stagedTemplate,
    '-o',
    outputDir,
    '--inheritance-mode',
    'both',
  ], DEFAULT_PROCESS_TIMEOUT_MS);
  assertProcessSuccess(result, 'PPTX 模板继承解析失败');
  return {
    originalName: file.originalname,
    outputDir,
    log: summarizeProcess(result),
  };
}

async function writeScholarHarnessRequest(
  projectPath: string,
  input: {
    projectName: string;
    canvasFormat: string;
    audience: string;
    pageCount: string;
    styleRequest: string;
    requirements: string;
    selectedTemplate: TemplateOption | null;
    uploadedTemplateDir?: string;
    sourceFilenames: string[];
    skillDir: string;
  },
): Promise<string> {
  const lines = [
    '# Scholar Harness PPT 生成请求',
    '',
    '## 基本信息',
    '',
    `- 项目名: ${input.projectName}`,
    `- 画布: ${input.canvasFormat}`,
    `- 目标听众: ${input.audience || '未指定'}`,
    `- 页数范围: ${input.pageCount || '由内容量决定'}`,
    `- 风格要求: ${input.styleRequest || '由 Strategist 根据内容决定'}`,
    '',
    '## 用户要求',
    '',
    input.requirements || '未填写额外要求。',
    '',
    '## 来源文件',
    '',
    ...(input.sourceFilenames.length
      ? input.sourceFilenames.map((filename) => `- ${filename}`)
      : ['- 无上传文件，仅根据用户要求生成。']),
    '',
    '## 模板继承',
    '',
    input.selectedTemplate
      ? `- 内置模板: ${input.selectedTemplate.relativePath} (${input.selectedTemplate.kind})`
      : '- 内置模板: 未选择，按 ppt-master 自由设计流程。',
    input.uploadedTemplateDir
      ? `- 用户 PPTX 模板已通过 pptx_template_import.py --inheritance-mode both 导入: ${input.uploadedTemplateDir}`
      : '- 用户 PPTX 模板: 未上传。',
    '',
    '## 执行约束',
    '',
    `- 严格按 ${path.join(input.skillDir, 'SKILL.md')} 执行。`,
    '- 从 Strategist 阶段继续：生成 design_spec.md 和 spec_lock.md 后，再逐页手写 SVG 到 svg_output/。',
    '- 导出前必须运行 svg_quality_checker.py；存在 error 时不得进入 finalize_svg.py 或 svg_to_pptx.py。',
    '- PPTX 模板导入目录中的 manifest.json、svg/inheritance.json、svg-flat/ 和 assets/ 是模板继承依据，不要丢弃。',
    '',
  ];
  const requestPath = path.join(projectPath, 'scholarharness_request.md');
  await fs.writeFile(requestPath, `${lines.join('\n')}\n`, 'utf8');
  return requestPath;
}

function resolveUserProjectPath(userId: string, rawPath: string): string {
  const projectPath = path.resolve(rawPath);
  assertPathInside(projectPath, getPptMasterProjectsRoot(userId), '项目路径不在当前用户 PPT Master 目录内');
  return projectPath;
}

function assertPathInside(targetPath: string, rootPath: string, message: string): void {
  const normalizedTarget = normalizePathForCompare(targetPath);
  const normalizedRoot = normalizePathForCompare(rootPath);
  if (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`)) {
    return;
  }
  throw new Error(message);
}

function normalizePathForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function listExportFiles(userId: string, projectPath: string): Promise<Array<{ name: string; size: number; url: string; path: string }>> {
  const exportDir = path.join(projectPath, 'exports');
  if (!existsSync(exportDir)) return [];
  const entries = await fs.readdir(exportDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.pptx') continue;
    const filePath = path.join(exportDir, entry.name);
    const stat = await fs.stat(filePath);
    files.push({
      name: entry.name,
      size: stat.size,
      path: filePath,
      url: `/api/ppt-master/download?userId=${encodeURIComponent(userId)}&projectPath=${encodeURIComponent(projectPath)}&file=${encodeURIComponent(entry.name)}`,
    });
  }
  return files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

export default router;
