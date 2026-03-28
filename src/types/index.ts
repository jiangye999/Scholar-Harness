export interface APIClient {
  chat(options: ChatOptions): Promise<string>;
}

export interface ChatOptions {
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
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
  | 'journal'
  | 'upload'
  | 'planning'
  | 'writing'
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
  styleGuideContent: string;
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
  styleGuide?: string;
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
