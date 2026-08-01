export interface APIClient {
  chat(options: ChatOptions): Promise<string>;
}

export interface CodexBridgeToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface CodexBridgeToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface CodexBridgeToolSet {
  definitions: CodexBridgeToolDefinition[];
  execute: (call: CodexBridgeToolCall) => Promise<unknown>;
}

/**
 * 单个 Agent 的 API 配置
 */
export interface AgentApiConfig {
  api_url: string;
  api_key: string;
  model: string;
  vision_model?: string;
  description?: string;
}

export interface PiSteeringMessage {
  id: string;
  message: string;
  chatAttachments?: Array<{
    name?: string;
    path?: string;
    type?: string;
    [key: string]: unknown;
  }>;
  workspaceFileMentions?: Array<{
    name?: string;
    path?: string;
    kind?: string;
    [key: string]: unknown;
  }>;
}

/** Server-internal callbacks used by the Pi-style active agent session. */
export interface PiSessionRuntime {
  sessionId: string;
  takeSteeringMessages: (options?: { allowAttachments?: boolean }) => Promise<PiSteeringMessage[]>;
  markSteeringApplied: (messageId: string) => Promise<void>;
  requeueSteeringMessage: (messageId: string) => Promise<void>;
}

export interface ChatOptions {
  model?: string;
  messages: Message[];
  userId?: string;
  conversationId?: string | null;
  temperature?: number;
  maxTokens?: number;
  onProgress?: (chunk: string) => void;
  newPage?: boolean;
  /**
   * 强制指定使用的 provider/agent
   * - 'browser': 强制使用浏览器模式（chat_url）- 已弃用
   * - 'api': 强制使用 API 模式
   * - 'primary': 使用大牛马 API 配置（规划、Skill生成）
   * - 'secondary': 使用小牛马 API 配置（执行写作）
   * - 'codex': 使用本机 Codex CLI
   * - undefined: 自动选择
   */
  forceProvider?: 'browser' | 'api' | 'primary' | 'secondary' | 'codex';
  /** 强制直接使用指定 API provider，不允许“优先 Codex”设置接管；用于隔离评测。 */
  bypassCodexPreference?: boolean;
  /**
   * forceProvider='codex' 时禁用小牛马降级；用于长任务避免 Codex 超时后把超大上下文再发给小牛马。
   */
  disableFallback?: boolean;
  /**
   * 单次 Codex CLI 调用超时，毫秒。
   */
  codexTimeoutMs?: number;
  /** Codex model selected in the composer for this request. */
  codexModel?: string;
  /** Codex reasoning level selected in the composer for this request. */
  codexReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
  /**
   * 传给 Codex CLI 的图片附件路径。Codex exec 支持 `-i <file>`，
   * 图片类任务应使用附件而不是只把路径写进 prompt。
   */
  codexImages?: string[];
  /**
   * OpenAI-compatible 视觉模型可读取的图片附件路径。
   * 本地服务会把这些路径转为 data URL 后放入 image_url content part。
   */
  visionImages?: string[];
  /**
   * 可自动识别的 Agent Skill 紧凑目录。API provider 通过原生 load_skill
   * 工具加载；Codex CLI 通过目录中的入口路径使用自身文件工具读取。
   */
  agentSkillCatalogPrompt?: string;
  /** Codex CLI 首轮需要授权读取的 Skill 包和用户 Skill 镜像目录。 */
  agentSkillRoots?: string[];
  /** Codex resume 轮次需要重新附加的用户显式斜杠 Skill 内容。 */
  explicitAgentSkillPrompt?: string;
  /**
   * 用户授权的本地工作目录。Codex 通过 --cd/--add-dir 访问；
   * 小牛马/大牛马通过后端原生工具循环访问。
   */
  workspaceDirectory?: {
    root?: string;
    path?: string;
    permission?: 'read-only' | 'workspace-write' | 'danger-full-access';
    aiWorkRoot?: string;
    safeWorkRoot?: string;
  };
  queryEnvelope?: {
    id?: string;
    sessionId?: string;
    text?: string;
    originalText?: string;
    delivery?: 'steer' | 'queue';
    provider?: 'browser' | 'api' | 'primary' | 'secondary' | 'codex' | 'auto';
    parts?: unknown[];
    workspace?: {
      root?: string;
      path?: string;
      permission?: 'read-only' | 'workspace-write' | 'danger-full-access';
    };
    contextFlags?: Record<string, boolean>;
    createdAt?: string;
  };
  /** Lightweight page state needed by Codex resume turns. */
  draftContext?: {
    articleWritingProgress?: {
      available?: boolean;
      completedChapterCount?: number;
      totalChapterCount?: number;
      totalSubsectionCount?: number;
      activeTarget?: {
        chapterKey?: string;
        chapterTitle?: string;
        subsectionId?: string;
        subsectionTitle?: string;
        subsectionIndex?: number;
      } | null;
    };
    [key: string]: unknown;
  };
  /** Recent Scholar Harness-visible turns, including API fallback output not present in a Codex thread. */
  conversationHandoff?: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  /** Codex App Server 专用的 Scholar Harness 原生工具桥；API provider 不读取此字段。 */
  codexToolSet?: CodexBridgeToolSet;
  /**
   * 小牛马 API 配置（来自前端 ⚙️ API 设置）
   * 当 forceProvider='api' 或 'secondary' 时优先使用这些配置
   */
  apiUrl?: string;
  apiKey?: string;
  /**
   * 含图片/图表截图等视觉输入时优先使用的小牛马多模态配置。
   */
  requiresVision?: boolean;
  visionApiUrl?: string;
  visionApiKey?: string;
  visionModel?: string;
  /** Internal Pi-style steering queue. Never accepted directly from an HTTP client. */
  piSession?: PiSessionRuntime;
  /** Server-internal cancellation probe for the active Pi/Codex run. */
  isCancelled?: () => boolean;
  /** Server-internal signal that aborts active HTTP/model work for this run. */
  abortSignal?: AbortSignal;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface MessageHandler {
  send(userId: string, message: string): Promise<void>;
  sendImage?(userId: string, imageUrl: string, caption?: string): Promise<void>;
  handle?(userId: string, message: string): Promise<string | void>;
}

export type ConversationPhase = 
  | 'greeting'
  | 'topic'
  | 'research'
  | 'journal'
  | 'upload'
  | 'planning'
  | 'writing'
  | 'integrity'
  | 'review'
  | 'revision'
  | 'final'
  | 'complete';

export interface ChapterPlan {
  chapterName: string;
  enabled: boolean;
  writingFocus: string;
  keyPoints: string[];
  specialRequirements?: string;
  wordCountTarget?: number;
  customTitle?: string;
}

export interface SectionProgress {
  status: 'pending' | 'generating' | 'reviewing' | 'completed' | 'failed';
  skillGenerated: boolean;
  content?: string;
  wordCount?: number;
  citationsUsed?: string[];
  error?: string;
}

export interface UserState {
  id: string;
  phase: ConversationPhase;
  paperTopic?: string;
  targetJournal?: string;
  researchContent?: string;
  researchContentPath?: string;
  journalPapers?: string[];
  literatureDb?: string;
  chapterPlans: Map<string, ChapterPlan>;
  currentChapter?: string;
  writingProgress: Map<string, SectionProgress>;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface GeneratedSkill {
  sectionName: string;
  customTitle?: string;
  userWritingFocus: string;
  userKeyPoints: string[];
  specialRequirements?: string;
  wordCountTarget?: number;
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

export interface WritingInput {
  skill: GeneratedSkill;
  chapterPlan: ChapterPlan;
  researchContent: string;
  literatureRetriever?: LiteratureRetriever;
}

export interface LiteratureRetriever {
  search(query: string, options?: SearchOptions): Promise<LiteratureReference[]>;
  getByKeywords(keywords: string[]): Promise<LiteratureReference[]>;
}

export interface SearchOptions {
  limit?: number;
  minQuality?: number;
  yearFrom?: number;
  yearTo?: number;
}

export interface LiteratureReference {
  citekey: string;
  authors: string[];
  title: string;
  journal?: string;
  year: number;
  citations?: number;
  abstract?: string;
  doi?: string;
}

export interface JournalConfig {
  name: string;
  impactFactor?: number;
  wordLimits?: {
    abstract?: number;
    introduction?: number;
    methods?: number;
    results?: number;
    discussion?: number;
    conclusion?: number;
  };
  style?: string;
}

export interface ModelConfig {
  primary: ModelSettings;
  secondary: Record<string, ModelSettings>;
}

export interface ModelSettings {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface IntegrationConfig {
  paperWriterPath: string;
  apiUrl: string;
  apiKey: string;
}

export interface WritingResult {
  chapterName: string;
  content: string;
  latexContent: string;
  wordCount: number;
  citationsUsed: string[];
  qualityScore?: number;
}

export interface ResearchContent {
  text: string;
  tables?: TableData[];
  images?: ImageData[];
}

export interface TableData {
  id: string;
  caption: string;
  data: string[][];
}

export interface ImageData {
  id: string;
  caption: string;
  description: string;
}

export interface ErrorResponse {
  code: string;
  message: string;
  recoverable: boolean;
  phase?: ConversationPhase;
}
