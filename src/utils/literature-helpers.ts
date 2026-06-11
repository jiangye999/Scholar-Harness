/**
 * 文献处理统一工具模块
 * 
 * 解决问题：
 * - C1: Author 字段格式不一致
 * - D1: 文献 ID 重复风险
 * - D2: Embedding 匹配使用 Title
 */

import * as crypto from 'crypto';
import type { Author, UnifiedLiterature } from '../types/literature';

/**
 * 生成唯一的文献 ID
 * 
 * 策略：基于 DOI + title + year + firstAuthor 生成确定性 hash
 * 确保同一篇文献多次上传也能得到相同 ID
 */
export function generateLiteratureId(
  title: string,
  year: number | string,
  authors: Author[] | string,
  doi?: string
): string {
  // 如果有 DOI，使用 DOI 作为基础（DOI 是全局唯一的）
  if (doi) {
    return `doi_${doi.replace(/[\/\.]/g, '_')}`;
  }
  
  // 否则使用 title + year + firstAuthor 组合
  const firstAuthor = Array.isArray(authors) 
    ? (authors[0]?.lastName || authors[0]?.name || 'unknown')
    : (typeof authors === 'string' ? authors.split(/[,;]/)[0].trim() : 'unknown');
  
  const yearStr = String(year || '0000');
  const titleNorm = (title || '').toLowerCase().replace(/\s+/g, '_').slice(0, 50);
  const authorNorm = firstAuthor.toLowerCase().replace(/\s+/g, '_');
  
  // 使用 hash 确保一致性
  const hash = crypto
    .createHash('md5')
    .update(`${authorNorm}_${yearStr}_${titleNorm}`)
    .digest('hex')
    .slice(0, 12);
  
  return `lit_${authorNorm}_${yearStr}_${hash}`;
}

/**
 * 解析作者字符串为结构化的 Author 数组
 * 
 * 支持多种格式：
 * - "Zhang, San; Li, Si; Wang, Wu" (WoS 格式)
 * - "San Zhang, Si Li, Wu Wang" (中文格式)
 * - ["Zhang, San", "Li, Si"] (数组格式)
 */
export function parseAuthorsToString(authorInput: unknown): Author[] {
  if (!authorInput) {
    return [{ name: 'Unknown' }];
  }
  
  // 已经是 Author[] 格式
  if (Array.isArray(authorInput) && authorInput.length > 0) {
    const first = authorInput[0];
    if (typeof first === 'object' && 'name' in first) {
      return authorInput as Author[];
    }
    // 是 string[] 格式，需要解析
    const authorStrings = authorInput as string[];
    return authorStrings.map(a => parseSingleAuthor(a));
  }
  
  // 字符串格式
  if (typeof authorInput === 'string') {
    const authors = authorInput
      .split(/[,;；，]/)
      .map(a => a.trim())
      .filter(a => a.length > 0);
    
    if (authors.length === 0) {
      return [{ name: 'Unknown' }];
    }
    
    return authors.map(a => parseSingleAuthor(a));
  }
  
  return [{ name: 'Unknown' }];
}

/**
 * 解析单个作者字符串
 */
function parseSingleAuthor(authorStr: string): Author {
  const trimmed = authorStr.trim();
  
  if (!trimmed) {
    return { name: 'Unknown' };
  }
  
  // "Zhang, San" 格式 (Last, First)
  const commaParts = trimmed.split(',');
  if (commaParts.length >= 2) {
    const lastName = commaParts[0].trim();
    const firstName = commaParts.slice(1).join(',').trim();
    return {
      name: trimmed,
      lastName,
      firstName,
    };
  }
  
  // "San Zhang" 格式 (First Last) - 英文
  const spaceParts = trimmed.split(/\s+/);
  if (spaceParts.length >= 2 && /^[A-Za-z]/.test(trimmed)) {
    const lastName = spaceParts[spaceParts.length - 1];
    const firstName = spaceParts.slice(0, -1).join(' ');
    return {
      name: trimmed,
      lastName,
      firstName,
    };
  }
  
  // 中文格式或其他，直接作为 name
  return { name: trimmed };
}

/**
 * 将 Author[] 转换为显示字符串
 */
export function authorsToString(authors: Author[] | string): string {
  if (typeof authors === 'string') {
    return authors;
  }
  
  if (!Array.isArray(authors) || authors.length === 0) {
    return 'Unknown';
  }
  
  return authors.map(a => a.name).join(', ');
}

/**
 * 解析关键词为字符串数组
 */
export function parseKeywords(keywordsInput: unknown): string[] {
  if (!keywordsInput) {
    return [];
  }
  
  if (Array.isArray(keywordsInput)) {
    return keywordsInput
      .filter(k => typeof k === 'string' && k.trim())
      .map(k => k.trim());
  }
  
  if (typeof keywordsInput === 'string') {
    return keywordsInput
      .split(/[,;；，]/)
      .map(k => k.trim())
      .filter(k => k.length > 0);
  }
  
  return [];
}

/**
 * 推断文献来源类型
 * 
 * 根据文件名和内容特征推断是 WoS 还是 CNKI
 */
export function inferSourceType(
  fileName: string,
  content?: string
): 'wos' | 'cnki' | 'ris' | 'bib' | 'unknown' {
  const lowerName = fileName.toLowerCase();
  
  // 根据文件扩展名
  if (lowerName.endsWith('.ris')) {
    return 'ris';
  }
  if (lowerName.endsWith('.bib')) {
    return 'bib';
  }
  
  // 根据内容特征
  if (content) {
    // 知网 RIS 格式特征：RT Journal Article/Book/Conference 或 DS CNKI
    if (
      content.match(/^RT\s+(Journal|Book|Conference|Thesis)/im) ||
      content.includes('DS CNKI') ||
      content.includes('DS cnki')
    ) {
      return 'cnki';
    }

    // WoS 特征
    if (
      content.includes('Clarivate Analytics Web of Science') ||
      content.includes('Web of Science') ||
      content.match(/^FN\s+Clarivate/m) ||
      (content.match(/^ER\s*$/m) && content.match(/^TI\s+/m))
    ) {
      return 'wos';
    }

    // CNKI 中文标签格式特征
    if (
      content.includes('【题　　名】') ||
      content.includes('【题名】') ||
      content.includes('【作者】') ||
      content.includes('【来　　源】')
    ) {
      return 'cnki';
    }

    // RIS 格式特征
    if (content.match(/^TY\s+-/m) && content.match(/^ER\s+-/m)) {
      return 'ris';
    }

    // BIB 格式特征
    if (content.match(/^@\w+\{/m)) {
      return 'bib';
    }
  }
  
  // 默认为 WoS（兼容旧数据）
  return 'wos';
}

/**
 * 规范化文献数据为 UnifiedLiterature 格式
 * 
 * 确保所有字段类型正确，ID 唯一
 */
export function normalizeLiterature(
  paper: Record<string, unknown>,
  index: number,
  sourceType?: 'wos' | 'cnki' | 'ris' | 'bib'
): UnifiedLiterature {
  const title = String(paper.title || 'Unknown Title');
  const authors = parseAuthorsToString(paper.authors || paper.author);
  const year = parseInt(String(paper.year || new Date().getFullYear())) || new Date().getFullYear();
  const keywords = parseKeywords(paper.keywords);
  const source = sourceType || 
    (typeof paper.source === 'string' ? (paper.source as 'wos' | 'cnki') : 'wos');
  
  const lit: UnifiedLiterature = {
    id: paper.id as string || generateLiteratureId(
      title,
      year,
      authors,
      paper.doi as string
    ),
    citationId: typeof paper.citationId === 'number' ? paper.citationId : index + 1,
    title,
    authors,
    author: authorsToString(authors),
    year,
    abstract: String(paper.abstract || ''),
    keywords,
    journal: String(paper.journal || ''),
    volume: paper.volume ? String(paper.volume) : undefined,
    issue: paper.issue ? String(paper.issue) : undefined,
    pages: paper.pages ? String(paper.pages) : undefined,
    doi: paper.doi ? String(paper.doi) : undefined,
    documentType: (paper.documentType as UnifiedLiterature['documentType']) || 'article',
    categories: Array.isArray(paper.categories) 
      ? (paper.categories as string[])
      : parseKeywords(paper.categories),
    aiKeywords: parseKeywords(paper.aiKeywords),
    source: source as 'wos' | 'cnki',
    embedding: Array.isArray(paper.embedding) ? (paper.embedding as number[]) : undefined,
  };
  
  return lit;
}

/**
 * 批量规范化文献数据
 */
export function normalizePapers(
  papers: Array<Record<string, unknown>>,
  sourceType?: 'wos' | 'cnki' | 'ris' | 'bib'
): UnifiedLiterature[] {
  return papers.map((paper, index) => normalizeLiterature(paper, index, sourceType));
}

export default {
  generateLiteratureId,
  parseAuthorsToString,
  authorsToString,
  parseKeywords,
  inferSourceType,
  normalizeLiterature,
  normalizePapers,
};
