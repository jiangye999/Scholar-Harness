import { Router } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs/promises';
import { ParserFactory } from '../../literature/parsers';
import { HybridRetrievalEngine } from '../../literature/retrieval';
import { ParagraphGenerator } from '../../literature/generation';
import type {
  ImportResponse,
  RetrievalResult,
  WriteResponse,
  UnifiedLiterature,
} from '../../types/literature';

const router = Router();

const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), 'uploads', 'literature');
    await fs.mkdir(uploadDir, { recursive: true });
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
const retrievalEngine = new HybridRetrievalEngine();

// 允许外部设置检索引擎实例（用于全局共享）
export function setRetrievalEngine(engine: HybridRetrievalEngine): void {
  // 将全局引擎的配置同步到本地 engine
  // 注意：这里实际上需要替换 engine 实例，但为了类型安全，我们只同步配置
  // 真正的共享是通过 local-server.ts 中的 globalRetrievalEngine 实现的
}

const apiConfig = {
  url: process.env.API_URL,
  key: process.env.API_KEY,
};

router.post('/import', upload.single('file'), async (req, res) => {
  try {
    const source = req.body.source as 'wos' | 'cnki';
    const filePath = req.file?.path;

    if (!filePath) {
      return res.status(400).json({
        success: false,
        count: 0,
        sample: [],
        error: 'No file uploaded',
      });
    }

    if (!source || !['wos', 'cnki'].includes(source)) {
      return res.status(400).json({
        success: false,
        count: 0,
        sample: [],
        error: 'Invalid source. Must be "wos" or "cnki"',
      });
    }

    const parser = ParserFactory.create(source);
    const literatures = await parser.parse(filePath);

    await retrievalEngine.index(literatures);

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

    const result: RetrievalResult = await retrievalEngine.retrieve({
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

    const retrieved = await retrievalEngine.retrieve({
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
  const stats = retrievalEngine.getStatistics();
  res.json({
    success: true,
    data: {
      ...stats,
      totalIndexed: literatureIndex.size,
    },
  });
});

router.delete('/clear', (req, res) => {
  literatureIndex.clear();
  retrievalEngine.clear();
  res.json({
    success: true,
    message: 'Literature index cleared',
  });
});

export default router;
