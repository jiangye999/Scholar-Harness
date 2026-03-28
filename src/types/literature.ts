// ScholarClaw - Literature Types
// 文献检索与引用生成系统的类型定义

// ============ 基础文献类型 ============

/**
 * 作者信息
 */
export interface Author {
  name: string;                  // 完整姓名
  firstName?: string;            // 名
  lastName?: string;             // 姓
  affiliation?: string;          // 所属机构
}

/**
 * 文献类型
 */
export type DocumentType =
  | 'article'
  | 'review'
  | 'conference'
  | 'book'
  | 'chapter'
  | 'thesis'
  | 'other';

/**
 * 统一文献结构
 * 支持 WoS 和知网导入的文献
 */
export interface UnifiedLiterature {
  id: string;                    // 唯一标识符
  citationId?: number;           // 引用编号（用于显示）
  title: string;                 // 标题
  authors: Author[];             // 作者列表（结构化）
  author: string;                // 作者字符串（用于显示和引用）
  year: number;                  // 发表年份
  abstract: string;              // 摘要
  keywords: string[];            // 关键词
  journal: string;               // 期刊/来源
  volume?: string;               // 卷号
  issue?: string;                // 期号
  pages?: string;                // 页码范围
  doi?: string;                  // DOI
  documentType: DocumentType;    // 文献类型
  categories?: string[];         // 学科分类
  references?: string[];         // 参考文献列表（如果有）
  source: 'wos' | 'cnki';        // 数据来源
  rawData?: string;              // 原始数据（用于调试）
  embedding?: number[];          // 向量嵌入（用于语义搜索）
  chunks?: string[];             // 文本分块
}

// ============ 检索配置 ============

/**
 * BM25 配置
 */
export interface BM25Config {
  topN: number;
  k1: number;                    // BM25 参数 k1
  b: number;                     // BM25 参数 b
  fieldWeights: {
    title: number;
    keywords: number;
    abstract: number;
    authors: number;
    journal: number;
  };
}

/**
 * 向量检索配置
 */
export interface VectorConfig {
  topN: number;
  model: string;                 // embedding 模型
  dimensions: number;
  similarity: 'cosine' | 'dot';
}

/**
 * 重排序配置
 */
export interface RerankerConfig {
  enabled: boolean;
  topN: number;
  model?: string;
}

/**
 * 完整检索配置
 */
export interface RetrievalConfig {
  bm25: BM25Config;
  vector: VectorConfig;
  reranker: RerankerConfig;
  maxCitationsPerParagraph: number;
  defaultCitationStyle: CitationStyle;
  defaultReferenceStyle: ReferenceStyle;
}

// ============ 检索查询与结果 ============

/**
 * 元数据过滤器
 */
export interface MetadataFilters {
  yearFrom?: number;
  yearTo?: number;
  authors?: string[];
  journals?: string[];
  categories?: string[];
  documentTypes?: DocumentType[];
}

/**
 * 检索查询
 */
export interface RetrievalQuery {
  query: string;
  filters?: MetadataFilters;
  topK?: number;
  searchMode?: 'bm25' | 'vector' | 'hybrid';
}

/**
 * 检索到的文档（包含分数）
 */
export interface RetrievedDocument extends UnifiedLiterature {
  bm25Score?: number;
  vectorScore?: number;
  rerankScore?: number;
  combinedScore: number;
  rank?: number;
}

/**
 * 检索结果列表
 */
export interface RetrievalResult {
  query: string;
  filters?: MetadataFilters;
  totalCount: number;
  results: RetrievedDocument[];
  timing: {
    bm25Ms: number;
    vectorMs: number;
    rerankMs: number;
    totalMs: number;
  };
}

// ============ 引文相关 ============

/**
 * 引文风格
 */
export type CitationStyle = 'numeric' | 'author-year';

/**
 * 参考文献风格
 */
export type ReferenceStyle = 'gbt7714' | 'apa';

/**
 * 引文标记
 */
export interface CitationMark {
  style: CitationStyle;
  numericId?: number;            // [1], [2]...
  authorYear?: string;           // (Zhang, 2023)
  literatureId: string;          // 对应文献ID
}

/**
 * 格式化后的参考文献
 */
export interface FormattedReference {
  id: string;
  numericId?: number;
  citationKey: string;
  formatted: string;
  style: ReferenceStyle;
}

// ============ 段落生成 ============

/**
 * 段落证据
 */
export interface ParagraphEvidence {
  paragraphId: string;
  content: string;
  evidenceIds: string[];
  generated: boolean;
}

/**
 * 句子级写作规划
 */
export interface SentencePlan {
  sentenceId: string;
  intent: string;
  keywords: string[];
  expectedCitations: number;
  retrievedDocs?: RetrievedDocument[];
}

/**
 * 句子级证据
 */
export interface SentenceEvidence {
  sentenceId: string;
  content: string;
  evidenceIds: string[];
  intent: string;
}

/**
 * 写作输出
 */
export interface WritingOutput {
  generatedText: string;
  paragraphs: ParagraphEvidence[];
  references: FormattedReference[];
  citationStyle: CitationStyle;
  referenceStyle: ReferenceStyle;
  statistics: {
    totalParagraphs: number;
    totalCitations: number;
    uniqueReferences: number;
  };
  sentencePlans?: SentencePlan[];
}

// ============ 日志 ============

/**
 * 检索日志条目
 */
export interface RetrievalLogEntry {
  timestamp: Date;
  query: string;
  filters?: MetadataFilters;
  results: {
    bm25Count: number;
    vectorCount: number;
    rerankedCount: number;
    finalCount: number;
  };
  paragraphBindings: Array<{
    paragraphId: string;
    evidenceIds: string[];
  }>;
}

// ============ API 请求/响应 ============

/**
 * 文献导入请求
 */
export interface ImportRequest {
  source: 'wos' | 'cnki';
  filePath: string;
}

/**
 * 文献导入响应
 */
export interface ImportResponse {
  success: boolean;
  count: number;
  sample: Array<{
    title: string;
    authors: string[];
    year: number;
  }>;
  error?: string;
  errors?: string[];
}

/**
 * 写作请求
 */
export interface WriteRequest {
  topic: string;
  filters?: MetadataFilters;
  expectedParagraphs?: number;
  citationStyle?: CitationStyle;
  referenceStyle?: ReferenceStyle;
  maxCitationsPerParagraph?: number;
}

/**
 * 写作响应
 */
export interface WriteResponse {
  success: boolean;
  data?: WritingOutput;
  error?: string;
}
