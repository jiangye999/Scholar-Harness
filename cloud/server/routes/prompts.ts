/**
 * Prompt API 路由
 * 提供云端 Prompt 服务：Skill 获取、生成、写作
 */

import { Router, Request, Response } from 'express';
import { authMiddleware, AuthenticatedRequest, requireSource } from '../middleware/auth';
import { decryptPrompt, hashPrompt, verifyPromptIntegrity } from '../../prompts/encryption';
import { DatabaseConnection } from '../../database';
import { logger } from '../../utils/logger';

let db: DatabaseConnection;

/**
 * 初始化 Prompt 路由
 */
export function initializePromptRoutes(database: DatabaseConnection): void {
  db = database;
}

const router = Router();

// ============ 类型定义 ============

interface SkillPrompt {
  id: string;
  name: string;
  category: string;
  content: string;
  version: number;
  language: 'zh' | 'en';
  lastUpdated: string;
  hash: string;
}

interface PromptGenerateRequest {
  chapterName: string;
  userPlan: {
    writingFocus: string;
    keyPoints: string[];
    specialRequirements?: string;
    wordCountTarget?: number;
  };
  researchContent: string;
  longTermMemory?: string;
  targetJournal?: string;
  journalStyleConfig?: Record<string, unknown>;
  userSkillId?: string;
}

interface GeneratedSkill {
  sectionName: string;
  userWritingFocus: string;
  userKeyPoints: string[];
  specialRequirements?: string;
  overallStructure: {
    paragraphCount: number;
    mainSections: string[];
    transitionStrategy: string;
  };
  paragraphDetails: Array<{
    paragraphId: number;
    title: string;
    purpose: string;
    contentOutline: string[];
    wordCountEstimate: number;
  }>;
  executionInstructions: string[];
}

interface PromptCacheRequest {
  skillIds: string[];
  includeAgentPrompts?: boolean;
}

interface PromptBundleRequest {
  promptIds?: string[];
}

// ============ 额度消耗配置 ============

const CREDIT_COSTS: Record<string, number> = {
  core_get: 0,
  bundle_get: 0,
  skill_get: 0,
  skill_list: 0,
  skill_cache: 0,
  generate: 1,
  write_introduction: 2,
  write_discussion: 3,
  write_methods: 2,
  write_results: 2,
};

const CORE_PROMPT_BUNDLES: Record<string, string[]> = {
  'paper-writing-full': [
    '01_title_skill',
    '02_abstract_skill',
    '03_introduction_skill',
    '04_methods_skill',
    '05_results_skill',
    '06_figures_tables_skill',
    '07_discussion_skill',
    '08_conclusion_skill',
    '09_additional_statements_skill',
    'auto_research_topic_content_skill',
    'auto_research_topic_content_skill_for_writing',
    'review_writer_quality_gate',
    'review_writer_sentence_quality_rules',
    'review_writer_section_review',
    'review_writer_final_audit',
    'review_writer_final_compact_audit',
    'review_writer_final_manuscript_optimization',
    'pdf_reader_assistant_soul',
    'pdf_paper_analysis_expert_soul',
  ],
  'auto-research-full': [
    'auto_research_topic_content_skill',
    'auto_research_topic_content_skill_for_writing',
    'review_writer_quality_gate',
    'review_writer_final_audit',
  ],
  'pdf-reading-full': [
    'pdf_reader_assistant_soul',
    'pdf_paper_analysis_expert_soul',
  ],
};

// ============ API 端点 ============

/**
 * GET /prompts/skills
 * 获取所有可用 Skill 列表（不返回内容）
 */
router.get('/skills', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const skills = await db.query<{
      id: string;
      name: string;
      category: string;
      version: number;
      language: string;
      updated_at: Date;
    }>(
      `SELECT id, name, category, version, language, updated_at 
       FROM prompts 
       WHERE category = 'writing' 
       ORDER BY id`
    );

    res.json({
      skills: skills.map(s => ({
        id: s.id,
        name: s.name,
        category: s.category,
        version: s.version,
        language: s.language,
        lastUpdated: s.updated_at.toISOString(),
      })),
    });
  } catch (error) {
    logger.error('[Prompts] Failed to get skills list:', error);
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

/**
 * GET /prompts/skills/:id
 * 获取单个 Skill 内容（需要 exe 认证）
 */
router.get('/skills/:id', authMiddleware, requireSource('exe'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requirePromptEntitlement(req, res))) return;
    const { id } = req.params;

    const skill = await db.queryOne<{
      id: string;
      name: string;
      content_encrypted: string;
      version: number;
      content_hash: string;
      language: string;
      updated_at: Date;
    }>(
      `SELECT id, name, content_encrypted, version, content_hash, language, updated_at 
       FROM prompts 
       WHERE id = $1`,
      [id]
    );

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found', message: `Skill '${id}' does not exist` });
    }

    // 解密内容
    const content = decryptPrompt(skill.content_encrypted);

    // 验证完整性
    if (!verifyPromptIntegrity(content, skill.content_hash)) {
      logger.error('[Prompts] Integrity check failed for skill:', id);
      return res.status(500).json({ error: 'Content integrity check failed' });
    }

    // 记录使用（不计费）
    await db.query(
      `INSERT INTO prompt_usage (user_id, prompt_type, prompt_id, credits_consumed) 
       VALUES ($1, 'skill_get', $2, 0)`,
      [req.user!.userId, id]
    );

    res.json({
      id: skill.id,
      name: skill.name,
      content,
      version: skill.version,
      language: skill.language,
      hash: skill.content_hash,
      lastUpdated: skill.updated_at.toISOString(),
    });
  } catch (error) {
    logger.error('[Prompts] Failed to get skill:', error);
    res.status(500).json({ error: 'Failed to get skill' });
  }
});

/**
 * GET /prompts/core/:id
 * 获取任意核心 Prompt/Skill/Soul 内容（需要 exe 认证）
 */
router.get('/core/:id', authMiddleware, requireSource('exe'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requirePromptEntitlement(req, res))) return;
    const prompt = await getPromptPayload(req.params.id);
    if (!prompt) {
      return res.status(404).json({ error: 'Prompt not found', message: `Prompt '${req.params.id}' does not exist` });
    }

    await db.query(
      `INSERT INTO prompt_usage (user_id, prompt_type, prompt_id, credits_consumed) 
       VALUES ($1, 'core_get', $2, 0)`,
      [req.user!.userId, prompt.id]
    );

    res.json(prompt);
  } catch (error) {
    logger.error('[Prompts] Failed to get core prompt:', error);
    res.status(500).json({ error: 'Failed to get core prompt' });
  }
});

/**
 * GET /prompts/version
 * 获取 Prompt 版本信息
 */
router.get('/version', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await db.queryOne<{ max_version: number; last_updated: Date }>(
      `SELECT MAX(version) as max_version, MAX(updated_at) as last_updated FROM prompts`
    );

    res.json({
      skillsVersion: result?.max_version || 1,
      agentVersion: result?.max_version || 1,
      lastUpdated: result?.last_updated?.toISOString() || new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[Prompts] Failed to get version:', error);
    res.status(500).json({ error: 'Failed to get version' });
  }
});

/**
 * POST /prompts/cache
 * 批量获取 Skills（用于离线预缓存）
 */
router.post('/cache', authMiddleware, requireSource('exe'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requirePromptEntitlement(req, res))) return;
    const { skillIds, includeAgentPrompts } = req.body as PromptCacheRequest;

    if (!skillIds || skillIds.length === 0) {
      return res.status(400).json({ error: 'skillIds required' });
    }

    const skills = await db.query<{
      id: string;
      content_encrypted: string;
      version: number;
      content_hash: string;
    }>(
      `SELECT id, content_encrypted, version, content_hash 
       FROM prompts 
       WHERE id = ANY($1)`,
      [skillIds]
    );

    const decryptedSkills = skills.map(s => {
      const content = decryptPrompt(s.content_encrypted);
      return {
        id: s.id,
        content,
        version: s.version,
        hash: s.content_hash,
      };
    });

    // 记录批量获取（不计费）
    await db.query(
      `INSERT INTO prompt_usage (user_id, prompt_type, credits_consumed) 
       VALUES ($1, 'skill_cache', 0)`,
      [req.user!.userId]
    );

    const versionResult = await db.queryOne<{ max_version: number }>(
      `SELECT MAX(version) as max_version FROM prompts`
    );

    res.json({
      skills: decryptedSkills,
      version: versionResult?.max_version || 1,
      cacheExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48小时
    });
  } catch (error) {
    logger.error('[Prompts] Failed to cache skills:', error);
    res.status(500).json({ error: 'Failed to cache skills' });
  }
});

/**
 * POST /prompts/bundles/:bundleId
 * 获取云端核心 Prompt 包。云端控制版本，本地只做加密缓存与用户 API 执行。
 */
router.post('/bundles/:bundleId', authMiddleware, requireSource('exe'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!(await requirePromptEntitlement(req, res))) return;
    const { bundleId } = req.params;
    const body = (req.body || {}) as PromptBundleRequest;
    const bundledIds = CORE_PROMPT_BUNDLES[bundleId] || [];
    const requestedIds = Array.isArray(body.promptIds) ? body.promptIds : [];
    const promptIds = uniquePromptIds(requestedIds.length > 0 ? requestedIds : bundledIds);

    if (promptIds.length === 0) {
      return res.status(400).json({ error: 'Prompt bundle is empty', bundleId });
    }
    if (promptIds.length > 80) {
      return res.status(400).json({ error: 'Too many prompts requested', max: 80 });
    }

    const prompts = await getPromptPayloads(promptIds);
    const foundIds = new Set(prompts.map(prompt => prompt.id));
    const missingIds = promptIds.filter(id => !foundIds.has(id));
    const version = prompts.reduce((max, prompt) => Math.max(max, prompt.version || 0), 1);

    await db.query(
      `INSERT INTO prompt_usage (user_id, prompt_type, prompt_id, credits_consumed) 
       VALUES ($1, 'bundle_get', $2, 0)`,
      [req.user!.userId, bundleId]
    );

    res.json({
      bundleId,
      version,
      prompts,
      missingIds,
      cacheExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      staleUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    logger.error('[Prompts] Failed to get prompt bundle:', error);
    res.status(500).json({ error: 'Failed to get prompt bundle' });
  }
});

/**
 * POST /prompts/generate
 * 生成 Skill（PrimaryAgent 大牛马）
 * 消耗 1 credit
 */
router.post('/generate', authMiddleware, requireSource('exe'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const input = req.body as PromptGenerateRequest;

    // 检查额度
    const subscription = await db.queryOne<{
      quota_remaining: number;
      status: string;
    }>(
      `SELECT quota_remaining, status FROM subscriptions WHERE user_id = $1`,
      [req.user!.userId]
    );

    if (!subscription || subscription.quota_remaining < CREDIT_COSTS.generate) {
      return res.status(403).json({ 
        error: 'Insufficient credits', 
        message: '需要 1 credit，请充值或升级套餐',
        creditsRequired: CREDIT_COSTS.generate,
      });
    }

    // trial 状态是内测码激活的试用期订阅，属于有效状态
    if (subscription.status !== 'active' && subscription.status !== 'trial') {
      return res.status(403).json({ 
        error: 'Subscription inactive', 
        message: `订阅状态: ${subscription.status}`,
      });
    }

    // 获取用户 Skill（如果有）
    let skillContent = '';
    if (input.userSkillId) {
      const skill = await db.queryOne<{ content_encrypted: string }>(
        `SELECT content_encrypted FROM prompts WHERE id = $1`,
        [input.userSkillId]
      );
      if (skill) {
        skillContent = decryptPrompt(skill.content_encrypted);
      }
    }

    // 构建 Prompt 模板（这里返回模板，实际 AI 调用在 exe 本地完成）
    const promptTemplate = buildPrimaryAgentPromptTemplate(input, skillContent);

    // 消耗额度
    await db.query(
      `UPDATE subscriptions SET quota_used = quota_used + $1, quota_remaining = quota_remaining - $1 
       WHERE user_id = $2`,
      [CREDIT_COSTS.generate, req.user!.userId]
    );

    // 记录使用
    await db.query(
      `INSERT INTO prompt_usage (user_id, prompt_type, prompt_id, credits_consumed) 
       VALUES ($1, 'generate', $2, $3)`,
      [req.user!.userId, input.userSkillId || 'default', CREDIT_COSTS.generate]
    );

    res.json({
      promptTemplate,
      skillId: input.userSkillId,
      creditsConsumed: CREDIT_COSTS.generate,
      quotaRemaining: subscription.quota_remaining - CREDIT_COSTS.generate,
    });
  } catch (error) {
    logger.error('[Prompts] Failed to generate:', error);
    res.status(500).json({ error: 'Failed to generate prompt' });
  }
});

/**
 * POST /prompts/write
 * 获取写作 Prompt（SecondaryAgent 小牛马）
 * 根据章节类型消耗不同额度
 */
router.post('/write', authMiddleware, requireSource('exe'), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { chapterName, skill, literatureCount } = req.body as {
      chapterName: string;
      skill: GeneratedSkill;
      literatureCount: number;
    };

    // 根据章节确定额度消耗
    const normalizedChapter = normalizeChapterName(chapterName);
    const creditCost = CREDIT_COSTS[`write_${normalizedChapter}`] || 2;

    // 检查额度
    const subscription = await db.queryOne<{
      quota_remaining: number;
      status: string;
    }>(
      `SELECT quota_remaining, status FROM subscriptions WHERE user_id = $1`,
      [req.user!.userId]
    );

    if (!subscription || subscription.quota_remaining < creditCost) {
      return res.status(403).json({ 
        error: 'Insufficient credits',
        creditsRequired: creditCost,
      });
    }

    // 构建写作 Prompt 模板
    const promptTemplate = buildSecondaryAgentPromptTemplate(skill, normalizedChapter, literatureCount);

    // 消耗额度
    await db.query(
      `UPDATE subscriptions SET quota_used = quota_used + $1, quota_remaining = quota_remaining - $1 
       WHERE user_id = $2`,
      [creditCost, req.user!.userId]
    );

    // 记录使用
    await db.query(
      `INSERT INTO prompt_usage (user_id, prompt_type, prompt_id, credits_consumed) 
       VALUES ($1, 'write', $2, $3)`,
      [req.user!.userId, normalizedChapter, creditCost]
    );

    res.json({
      promptTemplate,
      creditsConsumed: creditCost,
      quotaRemaining: subscription.quota_remaining - creditCost,
    });
  } catch (error) {
    logger.error('[Prompts] Failed to write:', error);
    res.status(500).json({ error: 'Failed to generate write prompt' });
  }
});

// ============ 辅助函数 ============

async function requirePromptEntitlement(req: AuthenticatedRequest, res: Response): Promise<boolean> {
  const subscription = await db.queryOne<{ status: string; quota_total: number; quota_remaining: number }>(
    `SELECT status, quota_total, quota_remaining
     FROM subscriptions
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.user!.userId]
  );

  if (!subscription || (subscription.status !== 'active' && subscription.status !== 'trial')) {
    res.status(403).json({
      error: 'Subscription inactive',
      message: subscription ? `订阅状态: ${subscription.status}` : '未找到有效订阅',
    });
    return false;
  }

  if (subscription.quota_total !== -1 && subscription.quota_remaining <= 0) {
    res.status(403).json({
      error: 'Insufficient quota',
      message: '额度不足，请充值或升级套餐',
    });
    return false;
  }

  return true;
}

async function getPromptPayload(id: string): Promise<SkillPrompt | null> {
  const prompts = await getPromptPayloads([id]);
  return prompts[0] || null;
}

async function getPromptPayloads(ids: string[]): Promise<SkillPrompt[]> {
  const promptIds = uniquePromptIds(ids);
  if (promptIds.length === 0) return [];

  const rows = await db.query<{
    id: string;
    name: string;
    category: string;
    content_encrypted: string;
    version: number;
    content_hash: string;
    language: string;
    updated_at: Date;
  }>(
    `SELECT id, name, category, content_encrypted, version, content_hash, language, updated_at 
     FROM prompts 
     WHERE id = ANY($1)`,
    [promptIds]
  );

  const byId = new Map(rows.map(row => [row.id, row]));
  const payloads: SkillPrompt[] = [];
  for (const id of promptIds) {
    const row = byId.get(id);
    if (!row) continue;
    try {
      const content = decryptPrompt(row.content_encrypted);
      if (!verifyPromptIntegrity(content, row.content_hash)) {
        logger.error('[Prompts] Integrity check failed for prompt:', id);
        continue;
      }
      payloads.push({
        id: row.id,
        name: row.name,
        category: row.category,
        content,
        version: row.version,
        language: row.language === 'en' ? 'en' : 'zh',
        lastUpdated: row.updated_at.toISOString(),
        hash: row.content_hash,
      });
    } catch (error) {
      logger.warn(`[Prompts] Prompt ${id} is not available or not encrypted correctly: ${(error as Error).message}`);
    }
  }
  return payloads;
}

function uniquePromptIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizeChapterName(chapterName: string): string {
  const normalized = chapterName.toLowerCase();
  
  if (normalized.includes('introduction') || normalized.includes('引言')) {
    return 'introduction';
  }
  if (normalized.includes('discussion') || normalized.includes('讨论')) {
    return 'discussion';
  }
  if (normalized.includes('methods') || normalized.includes('方法')) {
    return 'methods';
  }
  if (normalized.includes('results') || normalized.includes('结果')) {
    return 'results';
  }
  if (normalized.includes('abstract') || normalized.includes('摘要')) {
    return 'abstract';
  }
  if (normalized.includes('conclusion') || normalized.includes('结论')) {
    return 'conclusion';
  }
  
  return 'introduction';
}

function buildPrimaryAgentPromptTemplate(input: PromptGenerateRequest, skillContent: string): string {
  let template = `你是一级AI写作指导专家（大牛马）。你的任务是根据用户规划生成写作指导。

## 章节类型
${input.chapterName}

## 用户章节规划
- 写作重点: ${input.userPlan.writingFocus}
- 关键要点: ${input.userPlan.keyPoints.map(p => `- ${p}`).join('\n')}
- 特殊要求: ${input.userPlan.specialRequirements || '无'}
- 字数目标: ${input.userPlan.wordCountTarget || '根据内容自然决定'}
`;

  if (skillContent && skillContent.trim()) {
    template += `
## 用户上传的写作技能（Skill）
**必须严格按照此 Skill 执行！**

${skillContent}
`;
  }

  if (input.targetJournal) {
    template += `
## 目标期刊
${input.targetJournal}
`;
  }

  template += `
## 研究内容
${input.researchContent}

## 输出要求
生成 JSON 格式的写作指导，包含:
- section_name
- user_writing_focus
- user_key_points
- overall_structure (paragraph_count, main_sections, transition_strategy)
- paragraph_details (每个段落的目的、内容大纲、字数估计)
- execution_instructions

只输出纯 JSON，不要其他内容。`;

  return template;
}

function buildSecondaryAgentPromptTemplate(skill: GeneratedSkill, chapterType: string, literatureCount: number): string {
  return `你是一位专业的学术论文写作者（二级AI/小牛马）。

## 写作技能指导
${JSON.stringify(skill, null, 2)}

## 章节类型
${chapterType}

## 可用文献数量
${literatureCount} 篇相关文献

## 写作要求
1. 严格按照 skill 执行
2. 只引用提供的文献
3. 使用 LaTeX 格式
4. 每段完成后列出参考文献

开始生成内容。`;
}

export default router;
