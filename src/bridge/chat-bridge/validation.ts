/**
 * Chat Bridge 输入验证 Schema
 * 使用 Zod 进行运行时验证
 */

import { z } from 'zod';

export const CHAT_HISTORY_MAX_ITEMS = 20;
export const CHAT_HISTORY_MAX_CHARS_PER_MESSAGE = 20_000;
export const CHAT_HISTORY_TOTAL_MAX_CHARS = 100_000;
const CHAT_HISTORY_TRUNCATION_MARKER = '\n\n[历史消息过长，本次请求仅保留首尾；完整内容仍保存在本地会话中]\n\n';

export interface ChatHistoryNormalizationStats {
  inputMessages: number;
  outputMessages: number;
  inputChars: number;
  outputChars: number;
  truncatedMessages: number;
  droppedMessages: number;
}

function truncateChatHistoryContent(value: string, maxChars: number): string {
  const text = String(value || '');
  const limit = Math.max(0, Math.floor(maxChars));
  if (text.length <= limit) return text;
  if (limit <= CHAT_HISTORY_TRUNCATION_MARKER.length + 2) return text.slice(0, limit);
  const available = limit - CHAT_HISTORY_TRUNCATION_MARKER.length;
  const headLength = Math.floor(available * 0.7);
  const tailLength = available - headLength;
  return `${text.slice(0, headLength)}${CHAT_HISTORY_TRUNCATION_MARKER}${text.slice(-tailLength)}`;
}

/**
 * Normalize only the network request copy of visible chat history. The full
 * local conversation remains untouched. Keeping this before Zod validation
 * prevents one large assistant/tool transcript from permanently blocking a
 * conversation while preserving the newest context and both ends of a long
 * message.
 */
export function normalizeChatRequestHistory(body: unknown): {
  body: unknown;
  stats: ChatHistoryNormalizationStats;
} {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : null;
  const source = record && Array.isArray(record.history) ? record.history : [];
  const stats: ChatHistoryNormalizationStats = {
    inputMessages: source.length,
    outputMessages: source.length,
    inputChars: 0,
    outputChars: 0,
    truncatedMessages: 0,
    droppedMessages: 0,
  };
  if (!record || !Array.isArray(record.history)) return { body, stats };

  source.forEach((item) => {
    if (item && typeof item === 'object' && typeof (item as Record<string, unknown>).content === 'string') {
      stats.inputChars += ((item as Record<string, unknown>).content as string).length;
    }
  });

  const bounded = source.slice(-CHAT_HISTORY_MAX_ITEMS).map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const message = item as Record<string, unknown>;
    if (typeof message.content !== 'string') return { ...message };
    const content = truncateChatHistoryContent(message.content, CHAT_HISTORY_MAX_CHARS_PER_MESSAGE);
    if (content.length < message.content.length) stats.truncatedMessages += 1;
    return { ...message, content };
  });
  stats.droppedMessages = source.length - bounded.length;

  const retained: unknown[] = [];
  let remainingChars = CHAT_HISTORY_TOTAL_MAX_CHARS;
  for (let index = bounded.length - 1; index >= 0; index -= 1) {
    const item = bounded[index];
    const message = item && typeof item === 'object' && !Array.isArray(item)
      ? item as Record<string, unknown>
      : null;
    const content = message && typeof message.content === 'string' ? message.content : null;
    if (content === null) {
      retained.unshift(item);
      continue;
    }
    if (remainingChars <= 0) {
      stats.droppedMessages += 1;
      continue;
    }
    if (content.length <= remainingChars) {
      retained.unshift(item);
      remainingChars -= content.length;
      continue;
    }
    const shortened = truncateChatHistoryContent(content, remainingChars);
    if (shortened) {
      retained.unshift({ ...message, content: shortened });
      stats.truncatedMessages += 1;
      remainingChars -= shortened.length;
    } else {
      stats.droppedMessages += 1;
    }
  }

  stats.outputMessages = retained.length;
  stats.outputChars = retained.reduce<number>((total, item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return total;
    const content = (item as Record<string, unknown>).content;
    return total + (typeof content === 'string' ? content.length : 0);
  }, 0);

  return {
    body: { ...record, history: retained },
    stats,
  };
}

/**
 * URL 验证（放宽限制，允许各种 URL 格式）
 */
const urlSchema = z.string()
  .refine(
    (val) => {
      if (!val) return true; // 允许空值
      try {
        new URL(val);
        return true;
      } catch {
        // 允许 localhost 和内网地址
        return /^(https?:\/\/)?(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(val) ||
               /^(https?:\/\/)?[\w.-]+(:\d+)?(\/.*)?$/i.test(val);
      }
    },
    { message: '无效的 URL 格式' }
  );

/**
 * 邮箱验证
 */
const emailSchema = z.string()
  .email('无效的邮箱格式')
  .optional();

/**
 * 密码验证
 */
const passwordSchema = z.string()
  .optional();

/**
 * API Key 验证
 */
const apiKeySchema = z.string()
  .optional();

/**
 * 端口号验证
 */
const portSchema = z.number()
  .int('端口必须是整数')
  .min(1, '端口必须大于 0')
  .optional();

/**
 * 模式验证
 */
const modeSchema = z.enum(['browser', 'api', 'auto'], {
  errorMap: () => ({ message: '模式必须是 browser、api 或 auto' }),
}).optional();

/**
 * 凭据验证 Schema
 */
export const credentialsSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
}).optional();

/**
 * 单个 Agent API 配置验证 Schema
 */
const agentApiConfigSchema = z.object({
  api_url: z.string().optional(),
  api_key: z.string().optional(),
  model: z.string().optional(),
  vision_model: z.string().optional(),
  description: z.string().optional(),
  pool: z.object({
    models: z.array(z.object({
      id: z.string().min(1),
      label: z.string().optional(),
      model: z.string(),
      api_url: z.string().optional(),
      api_key: z.string().optional(),
      vision_model: z.string().optional(),
      enabled: z.boolean().optional(),
      priority: z.number().int().min(0).max(9999).optional(),
    })).min(1),
    active_model_id: z.string().optional(),
    auto_fallback: z.boolean().optional(),
  }).optional(),
});

const codexCliConfigSchema = z.object({
  enabled: z.boolean().optional(),
  prefer: z.boolean().optional(),
  command: z.string().optional(),
  model: z.string().optional(),
  reasoning_effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  pdf_wiki_sandbox: z.enum(['workspace-write', 'danger-full-access']).optional(),
  timeout_ms: z.number().int().min(10000).max(1800000).optional(),
  pdf_wiki_concurrency: z.number().int().min(1).max(6).optional(),
  concurrency: z.number().int().min(1).max(6).optional(),
});

const codingAgentRuntimeConfigSchema = z.object({
  enabled: z.boolean().optional(),
  prefer: z.boolean().optional(),
  command: z.string().max(2400).optional(),
  model: z.string().max(300).optional(),
  reasoning_effort: z.string().max(40).optional(),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  timeout_ms: z.number().int().min(10000).max(3600000).optional(),
  auto_approve: z.boolean().optional(),
  fallback_to_secondary: z.boolean().optional(),
  provider_auth: z.object({
    mode: z.enum(['api_key', 'cli_login']).optional(),
    provider: z.string().max(120).refine(value => !value || /^[a-z0-9][a-z0-9._\/-]{0,119}$/.test(value), 'Invalid provider ID').optional(),
    api_key: z.string().max(12000).optional(),
  }).optional(),
});

export const runtimeInstallRequestSchema = z.object({
  confirmed: z.literal(true),
});

export const runtimeModelsRequestSchema = z.object({
  command: z.string().max(2400).optional(),
  provider: z.string().max(120).refine(value => !value || /^[a-z0-9][a-z0-9._\/-]{0,119}$/.test(value), 'Invalid provider ID').optional(),
  auth_mode: z.enum(['api_key', 'cli_login']).optional(),
  api_key: z.string().max(12000).optional(),
});

export const runtimeLoginRequestSchema = z.object({
  command: z.string().max(2400).optional(),
  provider: z.string().regex(/^[a-z0-9][a-z0-9._\/-]{0,119}$/),
});

/**
 * 配置保存请求验证 Schema
 * 支持草原 (primary) 和小牛马 (secondary) 两套独立 API 配置
 */
export const saveConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mode: modeSchema,
  // 旧的浏览器模式字段（向后兼容，可选）
  chatUrl: z.string().optional(),
  loginUrl: z.string().optional(),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  bridgeSecret: z.string().optional(),
  credentials: z.object({
    email: z.string().optional(),
    password: z.string().optional(),
  }).optional(),
  // ========== 新的双 Agent API 配置 ==========
  // 草原 API 配置（规划、Skill生成、质量检查）
  primary: agentApiConfigSchema.optional(),
  // 小牛马 API 配置（执行写作、引用验证）
  secondary: agentApiConfigSchema.optional(),
  // 小牛马视觉/多模态 API 配置（图片、图表截图等）
  secondary_vision: agentApiConfigSchema.optional(),
  // Codex CLI 配置（作为草原之外的本机执行入口）
  codex: codexCliConfigSchema.optional(),
  agent_runtimes: z.object({
    default: z.enum(['', 'codex', 'pi', 'opencode']).optional(),
    codex: codingAgentRuntimeConfigSchema.optional(),
    pi: codingAgentRuntimeConfigSchema.optional(),
    opencode: codingAgentRuntimeConfigSchema.optional(),
  }).optional(),
  // 浏览器配置
  browser: z.object({
    profile: z.string().optional(),
    timeout_ms: z.number().int().min(1000).optional(),
    wait_for_response_ms: z.number().int().min(1000).optional(),
  }).optional(),
  // 服务配置
  service: z.object({
    enabled: z.boolean().optional(),
    port: z.number().int().min(1).optional(),
  }).optional(),
});

/**
 * 布尔值转换 Schema
 * 支持多种输入格式：boolean、string ("true"/"false")、number (1/0)、undefined
 * 使用 preprocess 先规范化输入，再传递给 boolean schema
 */
const coerceBoolean = z.preprocess((val) => {
  // undefined/null -> undefined（保持 optional）
  if (val === undefined || val === null) return undefined;
  // 已经是 boolean -> 直接返回
  if (typeof val === 'boolean') return val;
  // string -> 转换
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    if (lower === 'true' || lower === '1') return true;
    if (lower === 'false' || lower === '0') return false;
    return Boolean(val);
  }
  // number -> 转换
  if (typeof val === 'number') return val === 1;
  // 其他类型 -> 尝试 Boolean()
  return Boolean(val);
}, z.boolean()).optional();

const chatImagePathSchema = z.string().min(1).max(2400);
const chatAttachmentSchema = z.object({
  name: z.string().max(300).optional(),
  path: z.string().min(1).max(2400).optional(),
  type: z.string().max(80).optional(),
  size: z.number().nonnegative().max(1024 * 1024 * 1024).optional(),
  previewUrl: z.string().max(3000).optional(),
  originalName: z.string().max(300).optional(),
  originalPath: z.string().max(2400).optional(),
  lastModified: z.number().nonnegative().optional(),
  inputSource: z.string().max(80).optional(),
}).passthrough();

const CHAT_REQUEST_MAX_BYTES = 4 * 1024 * 1024;
const CHAT_INTENT_REQUEST_MAX_BYTES = 2 * 1024 * 1024;

function enforceSerializedSize(
  value: unknown,
  ctx: z.RefinementCtx,
  maxBytes: number,
  message: string,
): void {
  try {
    const serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  } catch {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请求内容无法序列化' });
  }
}

/**
 * 聊天请求验证 Schema
 */
export const chatRequestSchema = z.object({
  message: z.string()
    .min(1, '消息不能为空')
    .max(20000, '消息过长'),
  context: z.object({
    systemPrompt: z.string().max(40000).nullable().optional(),
    soulContent: z.string().max(40000).nullable().optional(),
    taskType: z.string().max(500).nullable().optional(),
    memory: z.any().optional(),
    literature: z.any().optional(),
    journalStyle: z.any().optional(),
    writingSkill: z.any().optional(),
    bibliometrics: z.any().optional(),
    bibliometricsExplicit: z.boolean().optional(),
    bibliometricsPinned: z.boolean().optional(),
    metaAnalysis: z.any().optional(),
    metaAnalysisExplicit: z.boolean().optional(),
    metaAnalysisPinned: z.boolean().optional(),
    autoResearch: z.any().optional(),
    autoResearchExplicit: z.boolean().optional(),
    autoResearchPinned: z.boolean().optional(),
    contextSourceStatus: z.any().optional(),
    userSkillPrompt: z.string().max(200000).optional(),
    invokedUserSkills: z.array(z.any()).max(30).optional(),
    discussionFramework: z.any().optional(),
    autonomousRetrieval: z.any().optional(),
    relevantLiterature: z.string().max(500000).nullable().optional(),
    webSearchContext: z.string().max(200000).nullable().optional(),
    isFirstMessage: z.any().optional(),
  }).passthrough().optional(),
  options: z.record(z.any()).optional(),
  stream: coerceBoolean,
  newPage: coerceBoolean,
  userId: z.string().max(200).nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  conversationId: z.string().max(200).nullable().optional(),
  piQueueMessageId: z.string().max(160).optional(),
  piQueueOriginalMessage: z.string().max(20000).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(40000, '单条历史消息过长'),
  })).max(80, '历史消息过多').optional(),
  /**
   * 强制指定使用的 provider/agent
   * - 'browser': 强制使用浏览器模式（chat_url）- 已弃用
   * - 'api': 强制使用 API 模式
   * - 'primary': 使用草原 API 配置（规划、Skill生成）
   * - 'secondary': 使用小牛马 API 配置（执行写作）
   * - 'codex': 使用本机 Codex CLI
   */
  forceProvider: z.enum(['browser', 'api', 'primary', 'secondary', 'codex', 'pi', 'opencode']).optional(),
  agentRuntime: z.enum(['codex', 'pi', 'opencode']).optional(),
  agentRuntimeModel: z.string().max(300).optional(),
  agentRuntimeReasoningEffort: z.string().max(40).optional(),
  agentRuntimeTimeoutMs: z.number().int().min(-1).max(3_600_000).optional(),
  workspaceDirectory: z.object({
    enabled: coerceBoolean,
    path: z.string().max(2400).optional(),
    root: z.string().max(2400).optional(),
    conversationId: z.string().max(200).optional(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }).passthrough().optional(),
  queryEnvelope: z.any().optional(),
  frontendState: z.any().optional(),
  /**
   * 小牛马 API 配置（来自前端 ⚙️ API 设置）
   * 当 forceProvider='api' 或 'secondary' 时使用这些配置
   */
  apiUrl: z.string().max(4000).optional(),
  apiKey: z.string().max(12000).optional(),
  model: z.string().max(300).optional(),
  /** 当前请求绑定的模型池 entry id；避免依赖异步全局 active 状态。 */
  modelId: z.string().min(1).max(200).optional(),
  /** Composer-level Codex model override for this request. */
  codexModel: z.string().max(200).optional(),
  /** Composer-level Codex reasoning override for this request. */
  codexReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  /** 主聊天 reasoning_effort（来自设置页，控制推理强度与速度）。 */
  reasoningEffort: z.enum(['low', 'medium', 'high']).optional(),
  /**
   * 小牛马模型（用于记忆提取、结构化总结等）
   * 来自前端 ⚙️ API 设置中的 secondary model 配置
   */
  secondaryModel: z.string().max(300).optional(),
  /**
   * 当请求包含图片、图表截图等视觉输入时，优先使用小牛马视觉 API 配置。
   */
  requiresVision: coerceBoolean,
  visionApiUrl: z.string().max(4000).optional(),
  visionApiKey: z.string().max(12000).optional(),
  visionModel: z.string().max(300).optional(),
  codexImages: z.array(chatImagePathSchema).max(12).optional(),
  visionImages: z.array(chatImagePathSchema).max(12).optional(),
  chatAttachments: z.array(chatAttachmentSchema).max(12).optional(),
  /**
   * P1: optional hard tool-cycle budget. 0 or undefined keeps the default
   * soft convergence (no hard stop); a positive value forces the agent loop to
   * converge after that many rounds and return the accumulated result.
   */
  hardToolCycleLimit: z.number().int().min(0).max(100).optional(),
}).superRefine((value, ctx) => {
  enforceSerializedSize(value, ctx, CHAT_REQUEST_MAX_BYTES, '聊天请求总大小超过 4 MB');
});

/**
 * 主聊天第一阶段统一 Query 意图识别。
 * 该接口只决定后续路由，不执行文件、检索、写作或分析任务。
 */
export const queryIntentRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(20000, '消息过长'),
  userId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  forceProvider: z.enum(['browser', 'api', 'primary', 'secondary', 'codex', 'pi', 'opencode']).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(20000),
  })).max(20).optional(),
  workspaceDirectory: z.object({
    enabled: coerceBoolean,
    path: z.string().max(2400).optional(),
    root: z.string().max(2400).optional(),
    aiWorkRoot: z.string().max(2400).optional(),
    safeWorkRoot: z.string().max(2400).optional(),
    conversationId: z.string().max(200).optional(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }).passthrough().optional(),
  workspaceFileMentions: z.array(z.object({
    name: z.string().max(300).optional(),
    path: z.string().max(2400).optional(),
    type: z.string().max(80).optional(),
  }).passthrough()).max(30).optional(),
  chatAttachments: z.array(z.object({
    name: z.string().max(300).optional(),
    path: z.string().max(2400).optional(),
    type: z.string().max(80).optional(),
  }).passthrough()).max(12).optional(),
  explicitParts: z.array(z.record(z.any())).max(30).optional(),
  contextItems: z.array(z.record(z.any())).max(50).optional(),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().max(300).optional(),
}).superRefine((value, ctx) => {
  enforceSerializedSize(value, ctx, CHAT_INTENT_REQUEST_MAX_BYTES, '意图识别请求总大小超过 2 MB');
});

/**
 * 图片附件的第一阶段 AI 意图识别请求。
 * 该接口只返回结构化视觉意图；真正的任务仍由后续 /chat 请求执行。
 */
export const multimodalIntentRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(20000, '消息过长'),
  userId: z.string().max(200).nullable().optional(),
  conversationId: z.string().max(200).nullable().optional(),
  forceProvider: z.enum(['browser', 'api', 'primary', 'secondary', 'codex', 'pi', 'opencode']).optional(),
  workspaceDirectory: z.object({
    enabled: coerceBoolean,
    path: z.string().max(2400).optional(),
    root: z.string().max(2400).optional(),
    conversationId: z.string().max(200).optional(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }).passthrough().optional(),
  apiUrl: z.string().max(4000).optional(),
  apiKey: z.string().max(12000).optional(),
  model: z.string().max(300).optional(),
  visionApiUrl: z.string().max(4000).optional(),
  visionApiKey: z.string().max(12000).optional(),
  visionModel: z.string().max(300).optional(),
  codexImages: z.array(chatImagePathSchema).max(12).optional(),
  visionImages: z.array(chatImagePathSchema).max(12).optional(),
  chatAttachments: z.array(chatAttachmentSchema).min(1, '至少需要一个图片附件').max(12),
}).superRefine((value, ctx) => {
  enforceSerializedSize(value, ctx, CHAT_INTENT_REQUEST_MAX_BYTES, '多模态意图请求总大小超过 2 MB');
});

const piQueueBehaviorSchema = z.enum(['steer', 'follow_up']);

const piQueueAttachmentSchema = z.object({
  name: z.string().max(300).optional(),
  path: z.string().max(2400).optional(),
  type: z.string().max(80).optional(),
  size: z.number().nonnegative().optional(),
  previewUrl: z.string().max(3000).optional(),
  originalName: z.string().max(300).optional(),
  originalPath: z.string().max(2400).optional(),
  lastModified: z.number().nonnegative().optional(),
  inputSource: z.string().max(80).optional(),
}).passthrough();

const piQueueWorkspaceFileSchema = z.object({
  name: z.string().max(300).optional(),
  path: z.string().max(2400).optional(),
  kind: z.string().max(80).optional(),
  size: z.number().nonnegative().optional(),
}).passthrough();

export const piQueueMessageRequestSchema = z.object({
  userId: z.string().nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  message: z.string().min(1, '排队消息不能为空').max(20000, '排队消息过长'),
  behavior: piQueueBehaviorSchema.default('follow_up'),
  clientMessageId: z.string().max(160).optional(),
  chatAttachments: z.array(piQueueAttachmentSchema).max(12).optional(),
  workspaceFileMentions: z.array(piQueueWorkspaceFileSchema).max(30).optional(),
});

export const piQueueMessageUpdateSchema = z.object({
  userId: z.string().nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  message: z.string().min(1, '排队消息不能为空').max(20000, '排队消息过长').optional(),
  behavior: piQueueBehaviorSchema.optional(),
}).refine(value => value.message !== undefined || value.behavior !== undefined, {
  message: '至少需要修改消息内容或队列类型',
});

export const piQueueSessionActionSchema = z.object({
  userId: z.string().nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
});

/**
 * 控制请求验证 Schema
 */
export const controlRequestSchema = z.object({
  action: z.enum(['newchat', 'pause', 'resume', 'refresh'], {
    errorMap: () => ({ message: '无效的控制操作' }),
  }),
});

/**
 * 打开页面请求验证 Schema
 */
export const openPageRequestSchema = z.object({
  url: urlSchema.optional(),
});

/**
 * 验证并返回结果
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  try {
    const result = schema.safeParse(data);
    if (result.success) {
      return { success: true, data: result.data };
    }
    const firstError = result.error.errors[0];
    return {
      success: false,
      error: firstError?.message || '验证失败',
    };
  } catch (e) {
    return {
      success: false,
      error: '验证过程出错',
    };
  }
}

/**
 * 净化 URL（移除危险字符）
 */
export function sanitizeUrl(url: string | undefined): string {
  if (!url) return '';
  
  // 移除控制字符
  let sanitized = url.replace(/[\x00-\x1F\x7F]/g, '');
  
  // 移除潜在的 JavaScript 协议
  sanitized = sanitized.replace(/^javascript:/i, '');
  
  // 移除 data: 协议
  sanitized = sanitized.replace(/^data:/i, '');
  
  return sanitized.trim();
}

/**
 * 净化字符串输入（移除控制字符）
 */
export function sanitizeString(str: string | undefined): string {
  if (!str) return '';
  // 移除控制字符，保留换行和制表符
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
