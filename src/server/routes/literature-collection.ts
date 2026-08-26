import { Router, type Request, type Response } from 'express';

import { logger } from '../../utils/logger';
import {
  LiteratureCollectionManager,
  type LiteratureCollectionJob,
  type LiteratureCollectionSource,
  type LiteratureSearchPlan,
} from '../../utils/literature-collection-manager';
import type { LLMToolCall, LLMToolDefinition } from '../../utils/llm-client';
import { sanitizeUserId } from '../../utils/paths';
import { prepareWorkspaceOutputDirectory } from '../services/workspace-directory';

interface PlannerRuntime {
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

interface LiteratureCollectionRoutesOptions {
  dataDir: string;
  manager?: LiteratureCollectionManager;
  getPlannerRuntime?: () => PlannerRuntime;
  importWosPlainText?: (args: {
    userId: string;
    fileName: string;
    content: string;
  }) => Promise<void> | void;
}

type AutomaticCollectionSource = 'auto' | 'wos' | 'cnki';

export interface LiteratureCollectionAgentExecutionContext {
  verifiedPrimaryIntent?: string;
  userMessage?: string;
  duplicateAttempt?: boolean;
}

interface AutomaticCollectionInput {
  userId: string;
  topic: string;
  requirements?: string;
  yearFrom?: number;
  yearTo?: number;
  documentTypes?: string[];
  maxRecords?: number;
  source?: AutomaticCollectionSource;
  outputRoot?: string;
}

interface AutomaticCollectionResult {
  status: 'queued' | 'awaiting-user' | 'configuration-required';
  plan: LiteratureSearchPlan;
  job?: LiteratureCollectionJob;
  config: ReturnType<LiteratureCollectionManager['getPublicConfig']>;
  message: string;
}

let sharedLiteratureCollectionManager: LiteratureCollectionManager | null = null;

function normalizeSource(value: unknown, fallbackMode: 'starter' | 'expanded'): LiteratureCollectionSource {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'cnki-assisted') return 'cnki-assisted';
  if (source === 'wos-expanded' || source === 'expanded') return 'wos-expanded';
  if (source === 'wos-starter' || source === 'starter') return 'wos-starter';
  return fallbackMode === 'expanded' ? 'wos-expanded' : 'wos-starter';
}

function normalizeStringList(value: unknown, fallback: string[] = []): string[] {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[;,，；]/);
  const normalized = values.map(item => String(item || '').trim()).filter(Boolean);
  return normalized.length > 0 ? normalized : fallback;
}

function normalizeOptionalYear(value: unknown): number | undefined {
  const year = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(year) && year >= 1800 && year <= 2200 ? year : undefined;
}

function resolveAgentCollectionSource(userMessage: string): Exclude<AutomaticCollectionSource, 'auto'> {
  const message = String(userMessage || '');
  const explicitlyRequestsCnki = /(?:CNKI|中国知网|知网)/i.test(message);
  const explicitlyRequestsWos = /(?:Web\s*of\s*Science|WOS|Clarivate)/i.test(message);
  if (explicitlyRequestsCnki && !explicitlyRequestsWos) return 'cnki';
  // An unqualified collection request uses the automatable WoS Expanded route.
  // Missing WoS credentials are a configuration state, not permission to
  // silently switch the user's request to the manual CNKI hand-off route.
  return 'wos';
}

async function runAutomaticLiteratureCollection(
  manager: LiteratureCollectionManager,
  input: AutomaticCollectionInput,
): Promise<AutomaticCollectionResult> {
  const userId = sanitizeUserId(input.userId || 'web-user');
  const topic = String(input.topic || '').trim();
  if (!topic) throw new Error('请输入需要检索的研究主题');
  const source = input.source || 'auto';
  const documentTypes = input.documentTypes?.length
    ? input.documentTypes
    : ['Article', 'Review'];
  const plan = await manager.planTopic({
    userId,
    topic,
    requirements: String(input.requirements || '').trim(),
    yearFrom: input.yearFrom,
    yearTo: input.yearTo,
    documentTypes,
  });
  const config = manager.getPublicConfig(userId);

  if (source !== 'cnki' && (!config.hasWosApiKey || config.wosMode !== 'expanded')) {
    return {
      status: 'configuration-required',
      plan,
      config,
      message: !config.hasWosApiKey
        ? 'WoS 检索方案已生成，但尚未创建、提交、排队或启动任何采集任务。当前缺少 Clarivate API Key；配置并保存后，系统才会自动继续当前主题。'
        : '当前配置为 WoS Starter 发现模式，不能用于 Full Record 批量入库。请切换为 Expanded，或导入 WoS Full Record and Cited References 文件。',
    };
  }

  const useCnki = source === 'cnki';
  const job = manager.createJob({
    userId,
    source: useCnki ? 'cnki-assisted' : 'wos-expanded',
    topic: plan.topic,
    query: useCnki ? plan.cnkiQuery : plan.wosQuery,
    planId: plan.id,
    yearFrom: plan.yearFrom,
    yearTo: plan.yearTo,
    documentTypes: plan.documentTypes,
    maxRecords: input.maxRecords,
    outputRoot: input.outputRoot,
    importToLiterature: true,
    importToBibliometrics: !useCnki,
  });
  return {
    status: useCnki ? 'awaiting-user' : 'queued',
    plan,
    job,
    config,
    message: useCnki
      ? 'CNKI 检索式已自动生成并保存为交接任务；受登录、验证码和机构权限限制，需要用户在已登录的 CNKI 页面完成导出。'
      : 'WoS Expanded Full Record 采集任务已进入持久化后台队列；完成后会自动进入通用文献库、Embedding 文献库和文献计量数据库。',
  };
}

export function getLiteratureCollectionAgentToolDefinitions(): LLMToolDefinition[] {
  if (!sharedLiteratureCollectionManager) return [];
  return [{
    type: 'function',
    function: {
      name: 'collect_literature_by_topic',
      description: '根据用户的一句话研究主题自动生成 WoS/CNKI 检索方案，并在已配置 WoS Expanded API 时直接提交后台采集和三库入库。仅用于 primaryIntent=literature_collection，或用户明确要求采集、收集、批量获取、从 WoS/CNKI 获取新文献；普通的引用核验、论点支撑和已有库检索应使用 Embedding/PDF Wiki，不能调用本工具。用户不需要手工填写年份、文献类型、检索式或最大量；只有用户明确给出限制时才传对应参数。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          topic: {
            type: 'string',
            description: '用户希望检索的自然语言研究主题，保留研究对象、处理和结局信息。',
          },
          requirements: {
            type: 'string',
            description: '用户在同一句话中明确提出的纳入、排除、地区、试验类型等限制；没有则留空。',
          },
          year_from: {
            type: 'number',
            minimum: 1800,
            maximum: 2200,
            description: '仅当用户明确限定起始年份时填写。',
          },
          year_to: {
            type: 'number',
            minimum: 1800,
            maximum: 2200,
            description: '仅当用户明确限定结束年份时填写。',
          },
          document_types: {
            type: 'array',
            items: { type: 'string' },
            description: '仅当用户明确指定文献类型时填写；默认 Article 和 Review。',
          },
          max_records: {
            type: 'number',
            minimum: 1,
            maximum: 100000,
            description: '仅当用户明确指定数量时填写；默认 10000。',
          },
          source: {
            type: 'string',
            enum: ['auto', 'wos', 'cnki'],
            description: '由当前用户请求锁定来源：未指定来源时只使用可自动后台运行的 WoS Expanded API；只有用户明确要求 CNKI/知网时才使用 cnki。WoS 缺少 Key 时不得擅自切换到 CNKI。',
          },
        },
        required: ['topic'],
      },
    },
  }];
}

export async function executeLiteratureCollectionAgentToolCall(
  call: LLMToolCall,
  userId: string,
  executionContext: LiteratureCollectionAgentExecutionContext = {},
): Promise<Record<string, unknown>> {
  if (call.function.name !== 'collect_literature_by_topic') {
    return {
      ok: false,
      toolName: call.function.name,
      summary: '未知文献采集工具',
      error: `不支持的工具：${call.function.name}`,
    };
  }
  if (executionContext.verifiedPrimaryIntent !== 'literature_collection') {
    return {
      ok: false,
      toolName: call.function.name,
      status: 'blocked',
      code: 'QUERY_INTENT_BLOCKED',
      summary: '已阻止未经授权的外部文献采集',
      error: '当前统一 Query 意图不是 literature_collection，不能创建 WoS/CNKI 采集任务。',
    };
  }
  if (executionContext.duplicateAttempt) {
    return {
      ok: false,
      toolName: call.function.name,
      status: 'blocked',
      code: 'DUPLICATE_COLLECTION_BLOCKED',
      summary: '已阻止同一轮重复创建采集链路',
      error: '同一用户请求只能创建一条来源明确的采集链路；WoS 配置缺失时不会自动改走 CNKI。',
    };
  }
  if (!sharedLiteratureCollectionManager) {
    return {
      ok: false,
      toolName: call.function.name,
      summary: '文献采集服务尚未初始化',
      error: '请重新启动本地服务后再试。',
    };
  }
  try {
    const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
    const source = resolveAgentCollectionSource(executionContext.userMessage || '');
    const result = await runAutomaticLiteratureCollection(sharedLiteratureCollectionManager, {
      userId,
      topic: String(args.topic || '').trim(),
      requirements: String(args.requirements || '').trim(),
      yearFrom: normalizeOptionalYear(args.year_from),
      yearTo: normalizeOptionalYear(args.year_to),
      documentTypes: normalizeStringList(args.document_types, ['Article', 'Review']),
      maxRecords: args.max_records === undefined ? 10_000 : Number(args.max_records),
      source,
    });
    return {
      ok: result.status !== 'configuration-required',
      toolName: call.function.name,
      summary: result.message,
      status: result.status,
      jobCreated: Boolean(result.job),
      planId: result.plan.id,
      topic: result.plan.topic,
      queryProvider: result.plan.provider,
      wosQuery: result.plan.wosQuery,
      cnkiQuery: result.plan.cnkiQuery,
      job: result.job ? {
        id: result.job.id,
        source: result.job.source,
        status: result.job.status,
        statusMessage: result.job.statusMessage,
        maxRecords: result.job.maxRecords,
      } : undefined,
      actionRequired: result.status === 'configuration-required'
        ? '必须明确告诉用户：当前只生成了检索方案，尚未创建、提交、排队或启动采集任务。请让用户只完成一次 WoS Expanded API Key 配置；不要声称任务已提交、进入后台或正在预检，也不要要求用户手工修改检索式或点击启动。'
        : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      toolName: call.function.name,
      summary: '自动文献采集未启动',
      error: (error as Error).message,
    };
  }
}

function sendError(res: Response, error: unknown, fallback: string, status = 400): void {
  const message = error instanceof Error && error.message ? error.message : fallback;
  res.status(status).json({
    success: false,
    code: 'LITERATURE_COLLECTION_ERROR',
    message,
    error: message,
    recoverable: true,
  });
}

export function createLiteratureCollectionRouter(
  options: LiteratureCollectionRoutesOptions,
): Router {
  const router = Router();
  const manager = options.manager || new LiteratureCollectionManager({
    dataDir: options.dataDir,
    getPlannerRuntime: options.getPlannerRuntime
      ? () => {
        const runtime = options.getPlannerRuntime?.();
        if (!runtime) return null;
        return {
          ...runtime,
          defaultModel: runtime.model,
        };
      }
      : undefined,
    importWosPlainText: options.importWosPlainText,
  });
  sharedLiteratureCollectionManager = manager;

  manager.recoverPersistentQueues();
  router.get('/config', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      res.json({ success: true, config: manager.getPublicConfig(userId) });
    } catch (error) {
      sendError(res, error, '读取文献采集配置失败');
    }
  });

  router.post('/config', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const config = manager.saveConfig(userId, {
        wosApiKey: typeof req.body?.wosApiKey === 'string' ? req.body.wosApiKey : undefined,
        keepWosApiKey: req.body?.keepWosApiKey !== false,
        wosMode: req.body?.wosMode === 'starter' ? 'starter' : 'expanded',
        wosStarterBaseUrl: req.body?.wosStarterBaseUrl,
        wosExpandedBaseUrl: req.body?.wosExpandedBaseUrl,
      });
      res.json({ success: true, config });
    } catch (error) {
      sendError(res, error, '保存文献采集配置失败');
    }
  });

  router.post('/config/test', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const result = await manager.testWosConnection(userId);
      res.json({ success: true, result });
    } catch (error) {
      sendError(res, error, 'WoS 连接检测失败');
    }
  });

  router.post('/plan', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const plan = await manager.planTopic({
        userId,
        topic: String(req.body?.topic || '').trim(),
        yearFrom: normalizeOptionalYear(req.body?.yearFrom),
        yearTo: normalizeOptionalYear(req.body?.yearTo),
        documentTypes: normalizeStringList(req.body?.documentTypes, ['Article', 'Review']),
        requirements: String(req.body?.requirements || '').trim(),
      });
      res.json({ success: true, plan });
    } catch (error) {
      logger.warn('[LiteratureCollection] Query plan route failed:', error);
      sendError(res, error, '生成检索方案失败');
    }
  });

  router.post('/auto', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      let outputRoot: string | undefined;
      if (req.body?.workspaceDirectory) {
        const prepared = await prepareWorkspaceOutputDirectory(
          req.body.workspaceDirectory,
          ['文献主题采集'],
        );
        outputRoot = prepared?.outputRoot;
      }
      const rawSource = String(req.body?.source || 'auto').trim().toLowerCase();
      const source: AutomaticCollectionSource = rawSource === 'cnki'
        ? 'cnki'
        : (rawSource === 'wos' ? 'wos' : 'auto');
      const result = await runAutomaticLiteratureCollection(manager, {
        userId,
        topic: String(req.body?.topic || '').trim(),
        requirements: String(req.body?.requirements || '').trim(),
        yearFrom: normalizeOptionalYear(req.body?.yearFrom),
        yearTo: normalizeOptionalYear(req.body?.yearTo),
        documentTypes: normalizeStringList(req.body?.documentTypes, ['Article', 'Review']),
        maxRecords: req.body?.maxRecords === undefined ? 10_000 : Number(req.body.maxRecords),
        source,
        outputRoot,
      });
      res.status(result.status === 'queued' ? 202 : 200).json({
        success: true,
        ...result,
      });
    } catch (error) {
      logger.warn('[LiteratureCollection] Automatic collection route failed:', error);
      sendError(res, error, '自动文献采集失败');
    }
  });

  router.post('/jobs', async (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const config = manager.getPublicConfig(userId);
      const source = normalizeSource(req.body?.source, config.wosMode);
      let outputRoot: string | undefined;
      if (req.body?.workspaceDirectory) {
        const prepared = await prepareWorkspaceOutputDirectory(
          req.body.workspaceDirectory,
          ['文献主题采集'],
        );
        outputRoot = prepared?.outputRoot;
      }
      const job = manager.createJob({
        userId,
        source,
        topic: String(req.body?.topic || '').trim(),
        query: String(req.body?.query || '').trim(),
        planId: typeof req.body?.planId === 'string' ? req.body.planId : undefined,
        yearFrom: normalizeOptionalYear(req.body?.yearFrom),
        yearTo: normalizeOptionalYear(req.body?.yearTo),
        documentTypes: normalizeStringList(req.body?.documentTypes, ['Article', 'Review']),
        maxRecords: req.body?.maxRecords,
        outputRoot,
        importToLiterature: req.body?.importToLiterature !== false,
        importToBibliometrics: req.body?.importToBibliometrics !== false,
      });
      res.status(202).json({ success: true, job });
    } catch (error) {
      logger.warn('[LiteratureCollection] Create job route failed:', error);
      sendError(res, error, '创建文献采集任务失败');
    }
  });

  router.get('/jobs', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      res.json({ success: true, jobs: manager.listJobs(userId) });
    } catch (error) {
      sendError(res, error, '读取文献采集任务失败');
    }
  });

  router.get('/jobs/:jobId', (req: Request, res: Response) => {
    try {
      const userId = sanitizeUserId(String(req.query.userId || 'web-user'));
      const job = manager.getJob(userId, req.params.jobId);
      if (!job) {
        sendError(res, new Error('采集任务不存在'), '采集任务不存在', 404);
        return;
      }
      res.json({ success: true, job });
    } catch (error) {
      sendError(res, error, '读取文献采集任务失败');
    }
  });

  router.post('/jobs/:jobId/:action', (req: Request, res: Response) => {
    try {
      const action = String(req.params.action || '').toLowerCase();
      if (!['pause', 'resume', 'cancel', 'retry'].includes(action)) {
        sendError(res, new Error('不支持的队列操作'), '不支持的队列操作', 404);
        return;
      }
      const userId = sanitizeUserId(String(req.body?.userId || 'web-user'));
      const job = manager.updateJobStatus(
        userId,
        req.params.jobId,
        action as 'pause' | 'resume' | 'cancel' | 'retry',
      );
      res.json({ success: true, job });
    } catch (error) {
      sendError(res, error, '更新文献采集任务失败');
    }
  });

  return router;
}

export default createLiteratureCollectionRouter;
