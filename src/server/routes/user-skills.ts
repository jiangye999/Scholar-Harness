import { Router, Request, Response } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../utils/logger';
import { resolveUserId } from '../auth-guard-singleton';
import { listAvailableAgentSkills } from '../services/agent-skills';
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
