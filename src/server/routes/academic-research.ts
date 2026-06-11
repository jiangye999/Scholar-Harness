import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../../utils/logger';
import {
  runAcademicResearchSkill,
  type AcademicResearchMode,
} from '../services/academic-research-skills';

const router = Router();

const academicResearchModeSchema = z.enum([
  'socratic-plan',
  'research-plan',
  'citation-integrity',
  'multi-review',
  'pipeline-gate',
  'material-passport',
]);

const runRequestSchema = z.object({
  mode: academicResearchModeSchema,
  userId: z.string().optional(),
  chapterName: z.string().optional(),
  topic: z.string().optional(),
  targetJournal: z.string().optional(),
  paperType: z.string().optional(),
  currentPhase: z.string().optional(),
  researchContext: z.string().optional(),
  chapterPlan: z.unknown().optional(),
  content: z.string().optional(),
  references: z.array(z.unknown()).optional(),
  experimentResults: z.array(z.unknown()).optional(),
  userInstruction: z.string().optional(),
  maxTokens: z.number().int().min(1000).max(64000).optional(),
});

router.post('/run', async (req, res) => {
  const parsed = runRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: parsed.error.flatten(),
    });
    return;
  }

  try {
    const result = await runAcademicResearchSkill({
      ...parsed.data,
      mode: parsed.data.mode as AcademicResearchMode,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    logger.error('[AcademicResearch] Run failed:', error);
    res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
});

router.get('/modes', (_req, res) => {
  res.json({
    success: true,
    modes: [
      {
        id: 'socratic-plan',
        name: '大牛马规划增强',
        description: '研究问题、论文类型、目标期刊、章节重点的苏格拉底式规划。',
      },
      {
        id: 'research-plan',
        name: 'Deep Research 前置检索规划',
        description: '生成检索策略、纳排标准、文献矩阵和 Hybrid Retrieval 查询。',
      },
      {
        id: 'citation-integrity',
        name: '引用与主张真实性审计',
        description: '检查引用存在性、元数据匹配、claim-reference alignment 和未引用强断言。',
      },
      {
        id: 'multi-review',
        name: '多审稿人质量检查',
        description: '方法学、领域、跨学科、逻辑挑战者和主编的多视角审稿。',
      },
      {
        id: 'pipeline-gate',
        name: 'Pipeline 阶段闸门',
        description: '判断 research/planning/writing/integrity/review/revision/final 的下一步。',
      },
      {
        id: 'material-passport',
        name: '实验材料护照',
        description: '记录上传材料来源、提取模型、置信度、未确认项和关联章节。',
      },
    ],
  });
});

export default router;
