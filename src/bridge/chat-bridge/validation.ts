/**
 * Chat Bridge 输入验证 Schema
 * 使用 Zod 进行运行时验证
 */

import { z } from 'zod';

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

/**
 * 配置保存请求验证 Schema
 * 支持大牛马 (primary) 和小牛马 (secondary) 两套独立 API 配置
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
  // 大牛马 API 配置（规划、Skill生成、质量检查）
  primary: agentApiConfigSchema.optional(),
  // 小牛马 API 配置（执行写作、引用验证）
  secondary: agentApiConfigSchema.optional(),
  // 小牛马视觉/多模态 API 配置（图片、图表截图等）
  secondary_vision: agentApiConfigSchema.optional(),
  // Codex CLI 配置（作为大牛马的本机执行入口）
  codex: codexCliConfigSchema.optional(),
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

/**
 * 聊天请求验证 Schema
 */
export const chatRequestSchema = z.object({
  message: z.string()
    .min(1, '消息不能为空'),
  context: z.object({
    systemPrompt: z.string().nullable().optional(),
    soulContent: z.string().nullable().optional(),
    taskType: z.string().nullable().optional(),
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
    userSkillPrompt: z.string().optional(),
    invokedUserSkills: z.array(z.any()).optional(),
    discussionFramework: z.any().optional(),
    autonomousRetrieval: z.any().optional(),
    relevantLiterature: z.string().nullable().optional(),
    webSearchContext: z.string().nullable().optional(),
    isFirstMessage: z.any().optional(),
  }).passthrough().optional(),
  options: z.record(z.any()).optional(),
  stream: coerceBoolean,
  newPage: coerceBoolean,
  userId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  piQueueMessageId: z.string().max(160).optional(),
  piQueueOriginalMessage: z.string().max(20000).optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })).optional(),
  /**
   * 强制指定使用的 provider/agent
   * - 'browser': 强制使用浏览器模式（chat_url）- 已弃用
   * - 'api': 强制使用 API 模式
   * - 'primary': 使用大牛马 API 配置（规划、Skill生成）
   * - 'secondary': 使用小牛马 API 配置（执行写作）
   * - 'codex': 使用本机 Codex CLI
   */
  forceProvider: z.enum(['browser', 'api', 'primary', 'secondary', 'codex']).optional(),
  workspaceDirectory: z.object({
    enabled: coerceBoolean,
    path: z.string().optional(),
    root: z.string().optional(),
    conversationId: z.string().max(200).optional(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }).passthrough().optional(),
  queryEnvelope: z.any().optional(),
  frontendState: z.any().optional(),
  /**
   * 小牛马 API 配置（来自前端 ⚙️ API 设置）
   * 当 forceProvider='api' 或 'secondary' 时使用这些配置
   */
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  /** Composer-level Codex model override for this request. */
  codexModel: z.string().max(200).optional(),
  /** Composer-level Codex reasoning override for this request. */
  codexReasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']).optional(),
  /**
   * 小牛马模型（用于记忆提取、结构化总结等）
   * 来自前端 ⚙️ API 设置中的 secondary model 配置
   */
  secondaryModel: z.string().optional(),
  /**
   * 当请求包含图片、图表截图等视觉输入时，优先使用小牛马视觉 API 配置。
   */
  requiresVision: coerceBoolean,
  visionApiUrl: z.string().optional(),
  visionApiKey: z.string().optional(),
  visionModel: z.string().optional(),
  codexImages: z.array(z.string()).optional(),
  visionImages: z.array(z.string()).optional(),
  chatAttachments: z.array(z.object({
    name: z.string().optional(),
    path: z.string().optional(),
    type: z.string().optional(),
    size: z.number().optional(),
    previewUrl: z.string().optional(),
  }).passthrough()).optional(),
});

/**
 * 主聊天第一阶段统一 Query 意图识别。
 * 该接口只决定后续路由，不执行文件、检索、写作或分析任务。
 */
export const queryIntentRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(20000, '消息过长'),
  userId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  forceProvider: z.enum(['browser', 'api', 'primary', 'secondary', 'codex']).optional(),
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
  model: z.string().optional(),
});

/**
 * 图片附件的第一阶段 AI 意图识别请求。
 * 该接口只返回结构化视觉意图；真正的任务仍由后续 /chat 请求执行。
 */
export const multimodalIntentRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(20000, '消息过长'),
  userId: z.string().nullable().optional(),
  conversationId: z.string().nullable().optional(),
  forceProvider: z.enum(['browser', 'api', 'primary', 'secondary', 'codex']).optional(),
  workspaceDirectory: z.object({
    enabled: coerceBoolean,
    path: z.string().optional(),
    root: z.string().optional(),
    conversationId: z.string().max(200).optional(),
    permission: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  }).passthrough().optional(),
  apiUrl: z.string().optional(),
  apiKey: z.string().optional(),
  model: z.string().optional(),
  visionApiUrl: z.string().optional(),
  visionApiKey: z.string().optional(),
  visionModel: z.string().optional(),
  codexImages: z.array(z.string()).optional(),
  visionImages: z.array(z.string()).optional(),
  chatAttachments: z.array(z.object({
    name: z.string().optional(),
    path: z.string().optional(),
    type: z.string().optional(),
    size: z.number().optional(),
    previewUrl: z.string().optional(),
  }).passthrough()).min(1, '至少需要一个图片附件').max(12),
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
  message: z.string().min(1, '排队消息不能为空').max(20000, '排队消息过长'),
  behavior: piQueueBehaviorSchema.default('follow_up'),
  clientMessageId: z.string().max(160).optional(),
  chatAttachments: z.array(piQueueAttachmentSchema).max(12).optional(),
  workspaceFileMentions: z.array(piQueueWorkspaceFileSchema).max(30).optional(),
});

export const piQueueMessageUpdateSchema = z.object({
  userId: z.string().nullable().optional(),
  message: z.string().min(1, '排队消息不能为空').max(20000, '排队消息过长').optional(),
  behavior: piQueueBehaviorSchema.optional(),
}).refine(value => value.message !== undefined || value.behavior !== undefined, {
  message: '至少需要修改消息内容或队列类型',
});

export const piQueueSessionActionSchema = z.object({
  userId: z.string().nullable().optional(),
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
