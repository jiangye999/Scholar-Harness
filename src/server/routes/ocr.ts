import { Router } from 'express';
import multer from 'multer';
import * as fs from 'fs/promises';
import * as path from 'path';
import { PDFParse } from 'pdf-parse';
import { createWorker } from 'tesseract.js';
import { logger } from '../../utils/logger';
import { getDataDir } from '../../utils/paths';

const engData = require('@tesseract.js-data/eng') as { code: string; gzip: boolean; langPath: string };
const chiSimData = require('@tesseract.js-data/chi_sim') as { code: string; gzip: boolean; langPath: string };

const router = Router();

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp', '.tif', '.tiff']);
const TEXT_EXTENSIONS = new Set(['.txt', '.md']);
const PDF_EXTENSIONS = new Set(['.pdf']);
const MAX_FILES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

type OcrLanguage = 'eng' | 'chi_sim' | 'chi_sim+eng';

interface OcrFileResult {
  filename: string;
  kind: 'image-ocr' | 'pdf-text' | 'plain-text' | 'unsupported' | 'failed';
  text: string;
  confidence?: number | null;
  warning?: string;
  error?: string;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
  },
});

function normalizeLanguage(value: unknown): OcrLanguage {
  const lang = String(value || '').trim().toLowerCase();
  if (lang === 'eng') return 'eng';
  if (lang === 'chi_sim') return 'chi_sim';
  return 'chi_sim+eng';
}

function normalizeOcrText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

async function copyLanguageDataIfNeeded(langCode: 'eng' | 'chi_sim', tessdataDir: string): Promise<void> {
  const source = langCode === 'eng'
    ? path.join(engData.langPath, 'eng.traineddata.gz')
    : path.join(chiSimData.langPath, 'chi_sim.traineddata.gz');
  const destination = path.join(tessdataDir, `${langCode}.traineddata.gz`);

  try {
    await fs.access(destination);
    return;
  } catch {
    await fs.copyFile(source, destination);
  }
}

async function prepareTessdata(language: OcrLanguage): Promise<string> {
  const tessdataDir = path.join(getDataDir(), 'ocr', 'tessdata');
  await fs.mkdir(tessdataDir, { recursive: true });

  if (language.includes('chi_sim')) {
    await copyLanguageDataIfNeeded('chi_sim', tessdataDir);
  }
  if (language.includes('eng')) {
    await copyLanguageDataIfNeeded('eng', tessdataDir);
  }

  return tessdataDir;
}

async function extractPdfText(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return normalizeOcrText(String(result.text || ''));
  } finally {
    await parser.destroy();
  }
}

async function runImageOcr(files: Express.Multer.File[], language: OcrLanguage): Promise<OcrFileResult[]> {
  if (files.length === 0) return [];

  const tessdataDir = await prepareTessdata(language);
  const worker = await createWorker(language, undefined, {
    langPath: tessdataDir,
    cachePath: tessdataDir,
    cacheMethod: 'none',
    gzip: true,
    logger: message => {
      if (message.status && message.progress !== undefined) {
        logger.debug(`[OCR] ${message.status}: ${Math.round(message.progress * 100)}%`);
      }
    },
  });

  try {
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });

    const results: OcrFileResult[] = [];
    for (const file of files) {
      try {
        const recognized = await worker.recognize(file.buffer);
        const text = normalizeOcrText(recognized.data.text || '');
        results.push({
          filename: file.originalname,
          kind: 'image-ocr',
          text,
          confidence: Number.isFinite(recognized.data.confidence) ? recognized.data.confidence : null,
          warning: text ? undefined : '未识别到可用文字，请确认图片清晰度或改用更高分辨率截图。',
        });
      } catch (error) {
        logger.warn(`[OCR] Failed to recognize ${file.originalname}: ${(error as Error).message}`);
        results.push({
          filename: file.originalname,
          kind: 'failed',
          text: '',
          error: (error as Error).message || '图片 OCR 失败',
        });
      }
    }
    return results;
  } finally {
    await worker.terminate();
  }
}

router.post('/recognize', upload.array('files', MAX_FILES), async (req, res) => {
  try {
    const files = (req.files || []) as Express.Multer.File[];
    if (files.length === 0) {
      res.status(400).json({ success: false, error: '请先选择需要 OCR 的文件。' });
      return;
    }

    const language = normalizeLanguage(req.body?.language);
    const imageFiles: Express.Multer.File[] = [];
    const results: OcrFileResult[] = [];

    for (const file of files) {
      const ext = path.extname(file.originalname || '').toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext)) {
        imageFiles.push(file);
        continue;
      }

      if (PDF_EXTENSIONS.has(ext)) {
        try {
          const text = await extractPdfText(file.buffer);
          results.push({
            filename: file.originalname,
            kind: 'pdf-text',
            text,
            warning: text ? '该 PDF 使用本地文本提取；如果是扫描版 PDF，当前工具不会逐页图像 OCR。' : '未提取到文字，可能是扫描版或加密 PDF。',
          });
        } catch (error) {
          logger.warn(`[OCR] PDF text extraction failed for ${file.originalname}: ${(error as Error).message}`);
          results.push({
            filename: file.originalname,
            kind: 'failed',
            text: '',
            error: (error as Error).message || 'PDF 文本提取失败',
          });
        }
        continue;
      }

      if (TEXT_EXTENSIONS.has(ext)) {
        results.push({
          filename: file.originalname,
          kind: 'plain-text',
          text: normalizeOcrText(file.buffer.toString('utf-8')),
        });
        continue;
      }

      results.push({
        filename: file.originalname,
        kind: 'unsupported',
        text: '',
        warning: `不支持的文件格式：${ext || '未知'}。当前 OCR 工具支持图片、PDF 文本提取、TXT/MD。`,
      });
    }

    const imageResults = await runImageOcr(imageFiles, language);
    const ordered = files.map(file => {
      const existing = results.find(result => result.filename === file.originalname);
      if (existing) return existing;
      const imageResult = imageResults.find(result => result.filename === file.originalname);
      return imageResult || {
        filename: file.originalname,
        kind: 'failed',
        text: '',
        error: 'OCR 结果丢失',
      };
    });

    const combinedText = ordered
      .filter(item => item.text)
      .map(item => `【${item.filename}】\n${item.text}`)
      .join('\n\n');

    res.json({
      success: true,
      language,
      count: ordered.length,
      results: ordered,
      text: combinedText,
    });
  } catch (error) {
    logger.error('[OCR] Recognize route failed:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message || 'OCR 识别失败',
    });
  }
});

export default router;
