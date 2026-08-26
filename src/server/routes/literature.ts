import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ParserFactory, type ParserSource } from '../../literature/parsers';
import { HybridRetrievalEngine } from '../../literature/retrieval';
import { ParagraphGenerator } from '../../literature/generation';
import { getUserUploadDir, getIndexCacheDir, getUserLiteraturePath } from '../../utils/paths';
import type {
  ImportResponse,
  RetrievalResult,
  WriteResponse,
  UnifiedLiterature,
} from '../../types/literature';
import { getProjectRuntimeContext } from '../../utils/project-runtime-context';

const router = Router();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // 使用统一的路径管理模块获取用户上传目录
    const userId = req.body.userId || 'web-user';
    const uploadDir = getUserUploadDir(userId);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${timestamp}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.csv', '.ris', '.bib'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .txt, .csv, .ris, .bib files are allowed.'));
    }
  },
});

const literatureIndex = new Map<string, UnifiedLiterature>();

// 全局检索引擎实例 - 由 local-server.ts 通过 setRetrievalEngine 设置
let globalRetrievalEngine: HybridRetrievalEngine | null = null;
const projectRetrievalEngines = new Map<string, HybridRetrievalEngine>();

// 本地检索引擎 - 作为后备
const localRetrievalEngine = new HybridRetrievalEngine();

// 设置全局检索引擎（由 local-server.ts 调用）
export function setRetrievalEngine(engine: HybridRetrievalEngine, projectId = ''): void {
  const scopedProjectId = projectId || getProjectRuntimeContext()?.projectId || '';
  if (scopedProjectId) projectRetrievalEngines.set(scopedProjectId, engine);
  globalRetrievalEngine = engine;
  console.log('[Literature] Global retrieval engine set');
}

// 获取当前使用的检索引擎
export function getRetrievalEngine(): HybridRetrievalEngine {
  const projectId = getProjectRuntimeContext()?.projectId || '';
  if (projectId && projectRetrievalEngines.has(projectId)) {
    return projectRetrievalEngines.get(projectId)!;
  }
  return globalRetrievalEngine || localRetrievalEngine;
}

const apiConfig = {
  url: process.env.API_URL,
  key: process.env.API_KEY,
};

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const source = req.body.source as string | undefined;
    const filePath = req.file?.path;
    const confirmLegalSource = req.body.confirmLegalSource; // 用户确认来源合法性

    if (!filePath) {
      return res.status(400).json({
        success: false,
        count: 0,
        sample: [],
        error: 'No file uploaded',
      });
    }

    if (source && !['wos', 'cnki', 'ris', 'bib', 'auto'].includes(source)) {
      return res.status(400).json({
        success: false,
        count: 0,
        sample: [],
        error: 'Invalid source. Must be one of "auto", "wos", "cnki", "ris", or "bib"',
      });
    }

    // 合规验证：必须确认文献来源合法性
    if (!confirmLegalSource || confirmLegalSource !== 'true') {
      return res.status(400).json({
        success: false,
        count: 0,
        sample: [],
        error: '必须确认文献来源合法性。请确保您上传的文献来自合法授权渠道（如机构订阅、个人购买等），不得上传未经授权获取的文献。',
        code: 'LEGAL_SOURCE_NOT_CONFIRMED',
      });
    }

    const literatures = source && source !== 'auto'
      ? await ParserFactory.create(source as ParserSource).parse(filePath)
      : await ParserFactory.parseFile(filePath);

    await getRetrievalEngine().addDocuments(literatures);

    for (const lit of literatures) {
      literatureIndex.set(lit.id, lit);
    }

    const response: ImportResponse = {
      success: true,
      count: literatures.length,
      sample: literatures.slice(0, 3).map(l => ({
        title: l.title,
        authors: l.authors.map(a => a.name),
        year: l.year,
      })),
      // 返回合规确认信息
      compliance: {
        legal_source_confirmed: true,
        confirmed_at: new Date().toISOString(),
        disclaimer: '用户已确认文献来源合法性。请遵守版权法规定，不得用于非法用途。',
      },
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      count: 0,
      sample: [],
      error: (error as Error).message,
    });
  }
});

router.post('/search', async (req, res) => {
  try {
    const {
      query,
      filters,
      topK = 20,
      mode = 'hybrid',
    } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required',
      });
    }

    const result: RetrievalResult = await getRetrievalEngine().retrieve({
      query,
      filters,
      topK,
      searchMode: mode,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

router.post('/write', async (req, res) => {
  try {
    const {
      topic,
      filters,
      expectedParagraphs = 3,
      citationStyle = 'numeric',
      referenceStyle = 'gbt7714',
      maxCitationsPerParagraph = 3,
    } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: 'Topic is required',
      });
    }

    if (literatureIndex.size === 0) {
      return res.status(400).json({
        success: false,
        error: 'No literature indexed. Please import literature first.',
      });
    }

    const retrieved = await getRetrievalEngine().retrieve({
      query: topic,
      filters,
      topK: 50,
      searchMode: 'hybrid',
    });

    const generator = new ParagraphGenerator(undefined, {
      maxCitationsPerParagraph,
      citationStyle,
      referenceStyle,
      requireEvidence: true,
      allowParaphrasing: true,
    });

    generator.setLiteratures(literatureIndex);

    const output = await generator.generate(
      topic,
      retrieved.results,
      expectedParagraphs
    );

    const response: WriteResponse = {
      success: true,
      data: output,
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    } as WriteResponse);
  }
});

router.get('/stats', (req, res) => {
  const stats = getRetrievalEngine().getStatistics();
  res.json({
    success: true,
    data: {
      ...stats,
      totalIndexed: literatureIndex.size,
    },
  });
});

// GET /api/literature/:userId - 获取用户文献信息
router.get('/:userId', async (req, res) => {
  try {
    const userId = req.params.userId;
    // 使用统一的路径管理模块获取文献路径
    const literatureFile = getUserLiteraturePath(userId);
    
    const exists = await fs.access(literatureFile).then(() => true).catch(() => false);
    
    if (!exists) {
      return res.json({
        success: false,
        papers: [],
        summary: null,
      });
    }
    
    const content = await fs.readFile(literatureFile, 'utf-8');
    const data = JSON.parse(content);
    
    const papers = Array.isArray(data) ? data : (data.papers || []);
    
    // Generate summary
    const years = [...new Set(papers.map((p: any) => p.year).filter(Boolean))].sort() as number[];
    const journals = [...new Set(papers.map((p: any) => p.journal).filter(Boolean))].slice(0, 10);
    const keywords = [...new Set(papers.flatMap((p: any) => p.keywords || []).filter(Boolean))].slice(0, 20);
    
    res.json({
      success: true,
      papers: papers.slice(0, 100), // Limit to 100 for performance
      summary: {
        count: papers.length,
        years: years.slice(0, 10),
        journals,
        keywords,
      },
    });
  } catch (error) {
    res.json({
      success: false,
      papers: [],
      summary: null,
      error: (error as Error).message,
    });
  }
});

router.delete('/clear', (req, res) => {
  literatureIndex.clear();
  getRetrievalEngine().clear();
  res.json({
    success: true,
    message: 'Literature index cleared',
  });
});

export default router;
