export interface APIClient {
  chat(options: ChatOptions): Promise<string>;
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

export interface ChatOptions {
  model?: string;
  messages: Message[];
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
  /**
   * forceProvider='codex' 时禁用小牛马降级；用于长任务避免 Codex 超时后把超大上下文再发给小牛马。
   */
  disableFallback?: boolean;
  /**
   * 单次 Codex CLI 调用超时，毫秒。
   */
  codexTimeoutMs?: number;
  /**
   * 传给 Codex CLI 的图片附件路径。Codex exec 支持 `-i <file>`，
   * 图片类任务应使用附件而不是只把路径写进 prompt。
   */
  codexImages?: string[];
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
