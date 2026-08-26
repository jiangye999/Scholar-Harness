import { Router, type Request, type Response } from 'express';
import * as path from 'path';

import { z, ZodError } from 'zod';

import { logger } from '../../utils/logger';
import { resolveUserId } from '../auth-guard-singleton';
import {
  approveConstructorChange,
  buildConstructorPlan,
  cancelConstructorJob,
  deleteConstructorFeatureStorage,
  detectReasonix,
  getConstructorFeatureAsset,
  getConstructorCapabilitySummary,
  getConstructorChange,
  getConstructorCoreDiff,
  getConstructorJobLog,
  getConstructorSourceStatus,
  installConstructorFeature,
  listConstructorFeatures,
  listConstructorChanges,
  listConstructorJobs,
  readConstructorFeatureStorage,
  rollbackConstructorFeature,
  rollbackConstructorCoreChange,
  scaffoldConstructorFeature,
  setConstructorFeatureEnabled,
  startConstructorPipeline,
  startReasonixBuild,
  startReasonixCoreProposal,
  startReasonixInstall,
  startConstructorCoreApply,
  resumeConstructorPipeline,
  uninstallConstructorFeature,
  writeConstructorFeatureStorage,
} from '../services/constructor-agent';

const router = Router();

const featureIdSchema = z.string().trim().regex(/^[a-z][a-z0-9-]{2,63}$/);
const userRequestSchema = z.object({
  userId: z.string().trim().max(120).default('web-user'),
  request: z.string().trim().min(5).max(20_000),
  mode: z.enum(['auto', 'runtime-feature', 'core-change']).default('auto'),
});
const scaffoldSchema = userRequestSchema.extend({
  featureId: featureIdSchema,
  name: z.string().trim().min(1).max(100),
  version: z.string().trim().regex(/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i).default('0.1.0'),
});
const installSchema = z.object({
  userId: z.string().trim().max(120).default('web-user'),
  stagingDir: z.string().trim().min(1).max(1200),
  enable: z.boolean().default(false),
});
const toggleSchema = z.object({
  userId: z.string().trim().max(120).default('web-user'),
  enabled: z.boolean(),
});
const buildSchema = z.object({
  userId: z.string().trim().max(120).default('web-user'),
  featureId: featureIdSchema,
  request: z.string().trim().min(5).max(20_000),
  stagingDir: z.string().trim().min(1).max(1200),
  changeId: z.string().trim().regex(/^change-\d{10,}-[a-f0-9]{8}$/).optional(),
});
const changeIdSchema = z.string().trim().regex(/^change-\d{10,}-[a-f0-9]{8}$/);
const changeApprovalSchema = z.object({
  userId: z.string().trim().max(120).default('web-user'),
  stage: z.enum(['plan', 'apply']),
  confirmation: z.string().trim().max(80),
});
const storageKeySchema = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/);
const storageValueSchema = z.object({
  userId: z.string().trim().max(120).default('web-user'),
  value: z.unknown(),
});

function errorMessage(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map(issue => issue.message).join('；');
  return (error as Error)?.message || String(error);
}

async function routeUserId(req: Request): Promise<string> {
  return resolveUserId(req.body?.userId || req.query?.userId || 'web-user');
}

router.get('/status', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    const [reasonix, features, jobs, changes, capabilities] = await Promise.all([
      detectReasonix().catch(error => {
        logger.warn('[ConstructorAgent] Reasonix status check failed without blocking workspace:', error);
        return { installed: false, version: '' };
      }),
      listConstructorFeatures(userId),
      listConstructorJobs(userId),
      listConstructorChanges(userId),
      getConstructorCapabilitySummary(),
    ]);
    res.json({
      success: true,
      userId,
      architecture: 'capability-map + runtime-feature-packages + governed-core-changes',
      featureApiVersion: 1,
      capabilities,
      source: getConstructorSourceStatus(),
      executor: { id: 'reasonix', name: 'Reasonix (DeepSeek-native)', ...reasonix },
      features,
      jobs,
      changes,
    });
  } catch (error) {
    logger.error('[ConstructorAgent] Failed to read status:', error);
    res.status(500).json({ success: false, code: 'CONSTRUCTOR_STATUS_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/capabilities', async (req: Request, res: Response) => {
  try {
    const request = String(req.query.request || '').slice(0, 20_000);
    res.json({ success: true, capabilities: await getConstructorCapabilitySummary(request), source: getConstructorSourceStatus() });
  } catch (error) {
    res.status(500).json({ success: false, code: 'CONSTRUCTOR_CAPABILITIES_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/features', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    const enabledOnly = String(req.query.enabledOnly || '') === 'true';
    res.json({ success: true, features: await listConstructorFeatures(userId, enabledOnly) });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_LIST_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/features/:featureId/assets/*', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    const assetPath = String(req.params[0] || '');
    const filePath = await getConstructorFeatureAsset(userId, req.params.featureId, assetPath);
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(path.resolve(filePath));
  } catch (error) {
    res.status(404).json({ success: false, code: 'FEATURE_ASSET_NOT_FOUND', message: errorMessage(error), recoverable: false });
  }
});

router.get('/features/:featureId/storage/:key', async (req: Request, res: Response) => {
  try {
    const featureId = featureIdSchema.parse(req.params.featureId);
    const key = storageKeySchema.parse(req.params.key);
    const userId = await routeUserId(req);
    const value = await readConstructorFeatureStorage(userId, featureId, key);
    res.json({ success: true, value });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_STORAGE_READ_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.put('/features/:featureId/storage/:key', async (req: Request, res: Response) => {
  try {
    const featureId = featureIdSchema.parse(req.params.featureId);
    const key = storageKeySchema.parse(req.params.key);
    const input = storageValueSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    await writeConstructorFeatureStorage(userId, featureId, key, input.value);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_STORAGE_WRITE_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.delete('/features/:featureId/storage/:key', async (req: Request, res: Response) => {
  try {
    const featureId = featureIdSchema.parse(req.params.featureId);
    const key = storageKeySchema.parse(req.params.key);
    const userId = await routeUserId(req);
    await deleteConstructorFeatureStorage(userId, featureId, key);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_STORAGE_DELETE_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/plan', async (req: Request, res: Response) => {
  try {
    const input = userRequestSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    res.json({ success: true, plan: await buildConstructorPlan(userId, input.request, input.mode) });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CONSTRUCTOR_PLAN_INVALID', message: errorMessage(error), recoverable: true });
  }
});

router.post('/pipeline', async (req: Request, res: Response) => {
  try {
    const input = userRequestSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    const result = await startConstructorPipeline(userId, input.request);
    res.status(result.state === 'started' ? 202 : 200).json({ success: true, ...result });
  } catch (error) {
    logger.warn('[ConstructorAgent] One-click pipeline rejected:', error);
    res.status(400).json({ success: false, code: 'CONSTRUCTOR_PIPELINE_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/changes', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    res.json({ success: true, changes: await listConstructorChanges(userId) });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CONSTRUCTOR_CHANGES_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/changes/:changeId', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const userId = await routeUserId(req);
    res.json({ success: true, change: await getConstructorChange(userId, changeId) });
  } catch (error) {
    res.status(404).json({ success: false, code: 'CONSTRUCTOR_CHANGE_NOT_FOUND', message: errorMessage(error), recoverable: false });
  }
});

router.post('/changes/:changeId/approve', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const input = changeApprovalSchema.parse(req.body || {});
    const expected = input.stage === 'plan' ? '批准重大修改' : '应用并保留回滚点';
    if (input.confirmation !== expected) {
      return res.status(409).json({ success: false, code: 'EXPLICIT_APPROVAL_REQUIRED', message: `请输入“${expected}”确认`, recoverable: true });
    }
    const userId = await resolveUserId(input.userId);
    return res.json({ success: true, change: await approveConstructorChange(userId, changeId, input.stage) });
  } catch (error) {
    return res.status(400).json({ success: false, code: 'CONSTRUCTOR_APPROVAL_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/changes/:changeId/pipeline', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const userId = await routeUserId(req);
    const result = await resumeConstructorPipeline(userId, changeId);
    res.status(202).json({ success: true, ...result });
  } catch (error) {
    logger.warn('[ConstructorAgent] Approved pipeline failed to resume:', error);
    res.status(400).json({ success: false, code: 'CONSTRUCTOR_PIPELINE_RESUME_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/changes/:changeId/core-proposal', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const userId = await routeUserId(req);
    const job = await startReasonixCoreProposal(userId, changeId);
    res.status(202).json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CORE_PROPOSAL_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/changes/:changeId/diff', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const userId = await routeUserId(req);
    res.json({ success: true, diff: await getConstructorCoreDiff(userId, changeId) });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CORE_DIFF_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/changes/:changeId/apply', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const userId = await routeUserId(req);
    const job = await startConstructorCoreApply(userId, changeId);
    res.status(202).json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CORE_APPLY_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/changes/:changeId/rollback', async (req: Request, res: Response) => {
  try {
    const changeId = changeIdSchema.parse(req.params.changeId);
    const userId = await routeUserId(req);
    res.json({ success: true, change: await rollbackConstructorCoreChange(userId, changeId) });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CORE_ROLLBACK_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/scaffold', async (req: Request, res: Response) => {
  try {
    const input = scaffoldSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    const result = await scaffoldConstructorFeature(userId, {
      id: input.featureId,
      name: input.name,
      description: input.request,
      version: input.version,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_SCAFFOLD_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/install', async (req: Request, res: Response) => {
  try {
    const input = installSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    const feature = await installConstructorFeature(userId, input.stagingDir, { enable: input.enable });
    res.json({ success: true, feature });
  } catch (error) {
    logger.warn('[ConstructorAgent] Feature install rejected:', error);
    res.status(400).json({ success: false, code: 'FEATURE_INSTALL_REJECTED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/features/:featureId/toggle', async (req: Request, res: Response) => {
  try {
    const featureId = featureIdSchema.parse(req.params.featureId);
    const input = toggleSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    await setConstructorFeatureEnabled(userId, featureId, input.enabled);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_TOGGLE_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/features/:featureId/rollback', async (req: Request, res: Response) => {
  try {
    const featureId = featureIdSchema.parse(req.params.featureId);
    const userId = await routeUserId(req);
    await rollbackConstructorFeature(userId, featureId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_ROLLBACK_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.delete('/features/:featureId', async (req: Request, res: Response) => {
  try {
    const featureId = featureIdSchema.parse(req.params.featureId);
    const userId = await routeUserId(req);
    await uninstallConstructorFeature(userId, featureId);
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ success: false, code: 'FEATURE_UNINSTALL_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/executors/reasonix/install', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    const job = await startReasonixInstall(userId);
    res.status(202).json({ success: true, job });
  } catch (error) {
    res.status(400).json({ success: false, code: 'REASONIX_INSTALL_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/executors/reasonix/build', async (req: Request, res: Response) => {
  try {
    const input = buildSchema.parse(req.body || {});
    const userId = await resolveUserId(input.userId);
    const reasonix = await detectReasonix();
    if (!reasonix.installed) {
      return res.status(409).json({ success: false, code: 'REASONIX_NOT_INSTALLED', message: '请先一键安装 Reasonix', recoverable: true });
    }
    const job = await startReasonixBuild(userId, input);
    return res.status(202).json({ success: true, job });
  } catch (error) {
    return res.status(400).json({ success: false, code: 'REASONIX_BUILD_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/jobs', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    res.json({ success: true, jobs: await listConstructorJobs(userId) });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CONSTRUCTOR_JOBS_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.get('/jobs/:jobId/log', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    res.json({ success: true, log: await getConstructorJobLog(userId, req.params.jobId) });
  } catch (error) {
    res.status(404).json({ success: false, code: 'CONSTRUCTOR_JOB_LOG_FAILED', message: errorMessage(error), recoverable: true });
  }
});

router.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const userId = await routeUserId(req);
    const cancelled = await cancelConstructorJob(userId, req.params.jobId);
    res.status(cancelled ? 200 : 409).json({ success: cancelled, cancelled });
  } catch (error) {
    res.status(400).json({ success: false, code: 'CONSTRUCTOR_JOB_CANCEL_FAILED', message: errorMessage(error), recoverable: true });
  }
});

export default router;
