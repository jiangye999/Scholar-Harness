import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

export interface PdfLiteParseResult {
  markdown: string;
  text: string;
  outputPath: string;
  jsonPath: string;
  pageCount: number;
}

export interface PdfLiteParseOptions {
  outputDir?: string;
  targetPages?: string;
  maxPages?: number;
  timeoutMs?: number;
  label?: string;
}

type LiteParseModule = {
  LiteParse?: new (config?: Record<string, unknown>) => {
    parse(input: string | Buffer | Uint8Array): Promise<{
      text?: string;
      pages?: Array<{
        pageNum?: number;
        text?: string;
        textItems?: Array<{
          text?: string;
          x?: number;
          y?: number;
          width?: number;
          height?: number;
          fontName?: string;
          fontSize?: number;
          confidence?: number;
        }>;
      }>;
    }>;
  };
  default?: new (config?: Record<string, unknown>) => {
    parse(input: string | Buffer | Uint8Array): Promise<{
      text?: string;
      pages?: Array<{ pageNum?: number; text?: string; textItems?: Array<Record<string, unknown>> }>;
    }>;
  };
};

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<LiteParseModule>;

async function importLiteParseModule(): Promise<LiteParseModule> {
  if (process.env.VITEST) {
    return await import('@llamaindex/liteparse') as unknown as LiteParseModule;
  }
  return dynamicImport('@llamaindex/liteparse');
}

function normalizeExtractedText(text: string): string {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function resolveNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export function isLiteParseAvailable(): boolean {
  try {
    require.resolve('@llamaindex/liteparse/package.json');
    return true;
  } catch {
    return false;
  }
}

export async function extractPdfTextWithLiteParse(
  pdfPath: string,
  options: PdfLiteParseOptions = {}
): Promise<PdfLiteParseResult> {
  if (!fs.existsSync(pdfPath)) {
    throw new Error(`PDF 文件不存在：${pdfPath}`);
  }

  const timeoutMs = resolveNumber(options.timeoutMs || process.env.LITEPARSE_TIMEOUT_MS, 300000, 1000, 1800000);
  const outputDir = options.outputDir || path.join(process.cwd(), 'tmp', 'liteparse');
  await fs.promises.mkdir(outputDir, { recursive: true });

  const baseName = path.basename(pdfPath, path.extname(pdfPath))
    .replace(/[<>:"/\\|?*\x00-\x1F]+/g, '_')
    .slice(0, 120) || `pdf-${crypto.randomUUID()}`;
  const suffix = crypto.randomBytes(4).toString('hex');
  const outputPath = path.join(outputDir, `${baseName}-${suffix}.md`);
  const jsonPath = path.join(outputDir, `${baseName}-${suffix}.liteparse.json`);

  logger.info(`[LiteParse] Extracting ${options.label || path.basename(pdfPath)}`);

  const parsed = await withTimeout(async () => {
    const module = await importLiteParseModule();
    const LiteParse = module.LiteParse || module.default;
    if (!LiteParse) {
      throw new Error('LiteParse 模块未导出 LiteParse 类');
    }
    const parser = new LiteParse({
      ocrEnabled: !/^(0|false|off)$/i.test(String(process.env.LITEPARSE_OCR_ENABLED || 'true')),
      ocrLanguage: process.env.LITEPARSE_OCR_LANGUAGE || 'eng',
      maxPages: resolveNumber(options.maxPages || process.env.LITEPARSE_MAX_PAGES, 1000, 1, 5000),
      targetPages: options.targetPages || process.env.LITEPARSE_TARGET_PAGES || undefined,
      dpi: resolveNumber(process.env.LITEPARSE_DPI, 150, 72, 600),
      outputFormat: 'json',
      preserveVerySmallText: /^(1|true|yes)$/i.test(String(process.env.LITEPARSE_PRESERVE_SMALL_TEXT || '')),
      quiet: true,
      numWorkers: resolveNumber(process.env.LITEPARSE_NUM_WORKERS, Math.max(1, Math.min(4, (osCpus() || 2) - 1)), 1, 32),
    });
    return parser.parse(pdfPath);
  }, timeoutMs);

  const text = normalizeExtractedText(parsed.text || (parsed.pages || []).map(page => page.text || '').join('\n\n'));
  if (!text) {
    throw new Error('LiteParse 提取结果为空，可能是扫描件、加密 PDF 或缺少 OCR 语言包');
  }

  const markdown = buildLiteParseMarkdown(parsed.pages || [], text);
  await fs.promises.writeFile(outputPath, markdown, 'utf-8');
  await fs.promises.writeFile(jsonPath, JSON.stringify(parsed, null, 2), 'utf-8');

  return {
    markdown,
    text,
    outputPath,
    jsonPath,
    pageCount: parsed.pages?.length || 0,
  };
}

async function withTimeout<T>(factory: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      factory(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`LiteParse 提取超时（${timeoutMs}ms）`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function osCpus(): number {
  try {
    return require('os').cpus().length || 2;
  } catch {
    return 2;
  }
}

function buildLiteParseMarkdown(
  pages: Array<{ pageNum?: number; text?: string; textItems?: Array<Record<string, unknown>> }>,
  fallbackText: string
): string {
  if (!pages.length) return fallbackText;
  return pages
    .map((page, index) => {
      const pageText = normalizeExtractedText(page.text || '');
      return [`## Page ${page.pageNum || index + 1}`, '', pageText].join('\n');
    })
    .join('\n\n')
    .trim();
}
