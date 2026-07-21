import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../utils/logger';
import { resolveUserId } from '../auth-guard-singleton';
import {
  createAgentSkillRuntime,
  deleteBundledAgentSkill,
  listAvailableAgentSkills,
} from '../services/agent-skills';
import {
  activateSkillOptimizationCandidate,
  addSkillOptimizationCase,
  deleteSkillOptimizationCase,
  evaluateSkillOptimizationCandidate,
  generateSkillOptimizationCandidate,
  getSkillOptimizationLab,
  rollbackSkillOptimizationVersion,
  skillOptimizationCaseInputSchema,
  skillOptimizationCaseUpdateSchema,
  skillOptimizationEvaluateSchema,
  skillOptimizationGenerateSchema,
  skillOptimizationRollbackSchema,
  updateSkillOptimizationCase,
} from '../services/skill-optimization';
import {
  createUserSkill,
  deleteUserSkill,
  discoverAcademicWritingSkills,
  importUserSkillFromGitHubUrl,
  listUserSkills,
  researchTargetVenueRequirements,
  targetVenueRequirementSchema,
  updateUserSkill,
  userSkillDiscoverySchema,
  userSkillImportUrlSchema,
  userSkillInputSchema,
  userSkillUpdateSchema,
} from '../services/user-skills';

const router = Router();

function formatSkillError(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues.map((issue) => issue.message).join('；') || 'Skill 配置格式不正确';
  }
  return (error as Error)?.message || String(error);
}

async function resolveRouteUserId(req: Request): Promise<string> {
  return resolveUserId(req.params.userId || req.body?.userId || req.query?.userId || 'web-user');
}

router.get('/:userId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const skills = await listUserSkills(userId);
    res.json({ success: true, userId, skills });
  } catch (error) {
    logger.error('[UserSkills] Failed to list skills:', error);
    res.status(500).json({ success: false, error: formatSkillError(error) });
  }
});

router.get('/:userId/available', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const skills = await listAvailableAgentSkills(userId);
    res.json({ success: true, userId, skills });
  } catch (error) {
    logger.error('[UserSkills] Failed to list available agent skills:', error);
    res.status(500).json({ success: false, error: formatSkillError(error) });
  }
});

router.delete('/:userId/bundled/:skillId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const deleted = await deleteBundledAgentSkill(userId, req.params.skillId);
    const skills = await listAvailableAgentSkills(userId);
    res.json({ success: true, userId, deleted, skills });
  } catch (error) {
    logger.warn('[AgentSkills] Failed to delete bundled Skill:', error);
    const message = formatSkillError(error);
    res.status(message.includes('未找到') ? 404 : 400).json({ success: false, error: message });
  }
});

router.get('/:userId/bundled/:skillId/content', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const runtime = await createAgentSkillRuntime(userId);
    const result = await runtime.executeToolCall({
      id: `persistent-bundled-skill-${Date.now()}`,
      type: 'function',
      function: {
        name: 'load_skill',
        arguments: JSON.stringify({
          skill_id: req.params.skillId,
          reason: '用户在“持续使用 Skill”中固定启用该系统自带 Skill',
        }),
      },
    });
    if (!result.ok) {
      return res.status(404).json({ success: false, error: result.error || '读取系统自带 Skill 失败' });
    }
    return res.json({ success: true, userId, content: result.content, data: result.data || {} });
  } catch (error) {
    logger.warn('[AgentSkills] Failed to load bundled Skill content:', error);
    return res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = userSkillInputSchema.parse(req.body || {});
    const skill = await createUserSkill(userId, input);
    const skills = await listUserSkills(userId);
    res.json({ success: true, userId, skill, skills });
  } catch (error) {
    logger.warn('[UserSkills] Failed to create skill:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/import-url', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = userSkillImportUrlSchema.parse(req.body || {});
    const result = await importUserSkillFromGitHubUrl(userId, input);
    const skills = await listUserSkills(userId);
    res.json({
      success: true,
      userId,
      skill: result.skill,
      importedSkills: result.skills,
      createdCount: result.createdCount,
      updatedCount: result.updatedCount,
      failedFiles: result.failedFiles,
      source: result.source,
      skills,
    });
  } catch (error) {
    logger.warn('[UserSkills] Failed to import skill from GitHub URL:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/discover', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = userSkillDiscoverySchema.parse(req.body || {});
    const result = await discoverAcademicWritingSkills(userId, input);
    res.json({ success: true, userId, ...result });
  } catch (error) {
    logger.warn('[UserSkills] Failed to discover academic writing skills:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/target-venue-requirements', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = targetVenueRequirementSchema.parse(req.body || {});
    const result = await researchTargetVenueRequirements(input);
    res.json({ success: true, userId, ...result });
  } catch (error) {
    logger.warn('[UserSkills] Failed to research target venue requirements:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.get('/:userId/:skillId/optimization', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to load lab:', error);
    const message = formatSkillError(error);
    res.status(message.includes('未找到') ? 404 : 400).json({ success: false, error: message });
  }
});

router.post('/:userId/:skillId/optimization/cases', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = skillOptimizationCaseInputSchema.parse(req.body || {});
    const trajectory = await addSkillOptimizationCase(userId, req.params.skillId, input);
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, trajectory, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to add case:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.put('/:userId/:skillId/optimization/cases/:caseId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = skillOptimizationCaseUpdateSchema.parse(req.body || {});
    const trajectory = await updateSkillOptimizationCase(
      userId,
      req.params.skillId,
      req.params.caseId,
      input,
    );
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, trajectory, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to update case:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.delete('/:userId/:skillId/optimization/cases/:caseId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const deleted = await deleteSkillOptimizationCase(userId, req.params.skillId, req.params.caseId);
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, deleted, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to delete case:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/:skillId/optimization/candidates', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = skillOptimizationGenerateSchema.parse(req.body || {});
    const candidate = await generateSkillOptimizationCandidate(userId, req.params.skillId, input);
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, candidate, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to generate candidate:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/:skillId/optimization/candidates/:candidateId/evaluate', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = skillOptimizationEvaluateSchema.parse(req.body || {});
    const candidate = await evaluateSkillOptimizationCandidate(
      userId,
      req.params.skillId,
      req.params.candidateId,
      input,
    );
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, candidate, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to evaluate candidate:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/:skillId/optimization/candidates/:candidateId/activate', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const result = await activateSkillOptimizationCandidate(userId, req.params.skillId, req.params.candidateId);
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, ...result, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to activate candidate:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.post('/:userId/:skillId/optimization/rollback', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = skillOptimizationRollbackSchema.parse(req.body || {});
    const result = await rollbackSkillOptimizationVersion(userId, req.params.skillId, input.versionId);
    const lab = await getSkillOptimizationLab(userId, req.params.skillId);
    res.json({ success: true, userId, ...result, ...lab });
  } catch (error) {
    logger.warn('[SkillOptimization] Failed to rollback version:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

router.put('/:userId/:skillId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const input = userSkillUpdateSchema.parse(req.body || {});
    const skill = await updateUserSkill(userId, req.params.skillId, input);
    const skills = await listUserSkills(userId);
    res.json({ success: true, userId, skill, skills });
  } catch (error) {
    logger.warn('[UserSkills] Failed to update skill:', error);
    const message = formatSkillError(error);
    res.status(message.includes('未找到') ? 404 : 400).json({ success: false, error: message });
  }
});

router.delete('/:userId/:skillId', async (req: Request, res: Response) => {
  try {
    const userId = await resolveRouteUserId(req);
    const deleted = await deleteUserSkill(userId, req.params.skillId);
    const skills = await listUserSkills(userId);
    res.json({ success: true, userId, deleted, skills });
  } catch (error) {
    logger.warn('[UserSkills] Failed to delete skill:', error);
    res.status(400).json({ success: false, error: formatSkillError(error) });
  }
});

export default router;
