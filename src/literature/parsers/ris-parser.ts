import * as fs from 'fs/promises';
import { BaseParser } from './base-parser';
import type { UnifiedLiterature, Author } from '../../types/literature';
import { logger } from '../../utils/logger';

/**
 * RIS 格式解析器
 * 
 * 支持标准 RIS 格式，常见于 EndNote、Mendeley 等文献管理软件导出
 */
export class RISParser extends BaseParser {
  async parse(filePath: string): Promise<UnifiedLiterature[]> {
    const content = await this.readFile(filePath);
    return this.parseContent(content);
  }

  parseContent(content: string): UnifiedLiterature[] {
    if (!this.validate(content)) {
      throw new Error('Invalid RIS file format');
    }

    const records = this.splitRecords(content);
    const results: UnifiedLiterature[] = [];

    for (const record of records) {
      try {
        const fields = this.parseFields(record);
        const literature = this.toUnified(fields);
        results.push(literature);
      } catch (error) {
        logger.warn('[RISParser] Failed to parse RIS entry:', error);
      }
    }

    return results;
  }

  validate(content: string): boolean {
    // 标准 RIS 格式：TY - 开头
    // 知网 RIS 格式：RT Journal Article/Book 等开头
    return content.includes('TY  -') 
      || content.match(/^TY\s*-/m) !== null
      || content.match(/^RT\s+(Journal|Book|Conference|Thesis)/m) !== null;
  }

  private splitRecords(content: string): string[] {
    const records: string[] = [];
    const lines = content.split(/\r\n|\n|\r/);
    let currentRecord: string[] = [];
    let inRecord = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      // TY - 开始新记录（标准 RIS）
      // RT Journal/Book/Conference 开始新记录（知网 RIS）
      if (line.match(/^TY\s*-/)) {
        if (inRecord && currentRecord.length > 0) {
          records.push(currentRecord.join('\n'));
        }
        currentRecord = [line];
        inRecord = true;
      } else if (line.match(/^RT\s+(Journal|Book|Conference|Thesis)/i)) {
        // 知网 RIS 格式
        if (inRecord && currentRecord.length > 0) {
          records.push(currentRecord.join('\n'));
        }
        currentRecord = [line];
        inRecord = true;
      } else if (inRecord) {
        currentRecord.push(line);
        
        // ER - 结束记录（标准 RIS）
        // 空行或新记录开始也视为结束（知网 RIS 有时没有 ER）
        if (trimmed.match(/^ER\s*-*$/) || (trimmed === '' && currentRecord.length > 3)) {
          records.push(currentRecord.join('\n'));
          currentRecord = [];
          inRecord = false;
        }
      }
    }

    // 处理最后一个记录（知网 RIS 可能没有 ER 结束标记）
    if (inRecord && currentRecord.length > 3) {
      records.push(currentRecord.join('\n'));
    }

    return records.filter(r => r.trim());
  }

  private parseFields(record: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    const lines = record.split(/\r\n|\n|\r/);
    const knownTags = new Set([
      'TY', 'RT', 'TI', 'T1', 'T2', 'T3', 'AU', 'A1', 'A2', 'A3', 'A4',
      'PY', 'Y1', 'YR', 'DA', 'SO', 'JF', 'JO', 'J2', 'JA', 'AB', 'N2',
      'N1', 'KW', 'K1', 'DE', 'DO', 'DI', 'VL', 'VO', 'IS', 'IP', 'SP',
      'EP', 'OP', 'PB', 'CY', 'SN', 'UR', 'LA', 'DS', 'AD', 'ER',
    ]);
    let currentTag: string | null = null;

    for (const line of lines) {
      const cleanLine = line.replace(/\r$/, '');
      const trimmedLine = cleanLine.trim();
      if (!trimmedLine) {
        continue;
      }

      let match = cleanLine.match(/^([A-Z0-9]{2})\s*-\s*(.*)$/);
      if (!match) {
        match = cleanLine.match(/^([A-Z0-9]{2})\s+(.+)$/);
        if (match && !knownTags.has(match[1])) {
          match = null;
        }
      }

      if (match) {
        const [, tag, value] = match;
        const trimmed = value.trim();
        currentTag = tag;
        if (trimmed && tag !== 'ER') {
          const existing = fields.get(tag) || [];
          existing.push(trimmed);
          fields.set(tag, existing);
        }
        continue;
      }

      if (currentTag) {
        const existing = fields.get(currentTag);
        if (existing && existing.length > 0) {
          existing[existing.length - 1] = `${existing[existing.length - 1]} ${trimmedLine}`;
        }
      }
    }

    return fields;
  }

  private toUnified(fields: Map<string, string[]>): UnifiedLiterature {
    // 标准RIS和知网RIS的字段映射
    // 知网: T1=标题, JF=期刊, YR=年份, K1=关键词, OP=页码, VO=卷, IS=期, RT=类型
    // 标准: TI/T1=标题, SO/JF=期刊, PY/Y1=年份, KW=关键词, SP/EP=页码, VL=卷, IS=期, TY=类型
    const title = this.getFirstField(fields, ['TI', 'T1']) || '';
    const authors = this.parseAuthorsFromFields(fields);
    const year = this.extractYear(this.getFirstField(fields, ['PY', 'Y1', 'YR', 'DA']) || '');
    const journal = this.getFirstField(fields, ['SO', 'JF', 'JO', 'T2', 'J2', 'JA', 'PB']) || '';
    const abstract = this.getFirstField(fields, ['AB', 'N2', 'N1']) || '';
    const keywords = this.getKeywordFields(fields, ['KW', 'K1', 'DE']);
    const doi = this.getFirstField(fields, ['DO', 'DI']) || '';
    const volume = this.getFirstField(fields, ['VL', 'VO']) || '';
    const issue = this.getFirstField(fields, ['IS', 'IP']) || '';
    // 知网的 OP 字段表示页码（如 "23-25" 或 "107936-"）
    const pages = this.formatPages(
      this.getFirstField(fields, ['SP']),
      this.getFirstField(fields, ['EP'])
    ) || this.getFirstField(fields, ['OP']);

    // 知网的 RT 字段表示记录类型（如 "RT Journal Article"）
    const recordType = this.getFirstField(fields, ['TY', 'RT']) || '';
    const documentType = this.mapDocumentType(recordType);

    // 检测来源：DS CNKI 标记表示知网导出
    const dataSource = this.getFirstField(fields, ['DS']) || '';
    const source: 'wos' | 'cnki' = dataSource.toLowerCase().includes('cnki') ? 'cnki' : 'wos';

    const lit: Partial<UnifiedLiterature> = {
      title: this.normalizeText(title),
      authors,
      author: authors.map(a => a.name).join(', '),
      year,
      abstract: this.normalizeText(abstract),
      keywords,
      journal: this.normalizeText(journal),
      volume,
      issue,
      pages,
      doi,
      documentType,
      source,  // 根据实际来源设置
      rawData: JSON.stringify(Object.fromEntries(fields)),
    };

    lit.id = this.generateId(lit);

    return lit as UnifiedLiterature;
  }

  private getFirstField(fields: Map<string, string[]>, tags: string[]): string {
    for (const tag of tags) {
      const values = fields.get(tag);
      if (values && values.length > 0) {
        return values[0];
      }
    }
    return '';
  }

  private getFields(fields: Map<string, string[]>, tags: string[]): string[] {
    const result: string[] = [];
    for (const tag of tags) {
      const values = fields.get(tag);
      if (values) {
        result.push(...values);
      }
    }
    return result;
  }

  private getKeywordFields(fields: Map<string, string[]>, tags: string[]): string[] {
    const seen = new Set<string>();
    const keywords: string[] = [];

    for (const raw of this.getFields(fields, tags)) {
      for (const keyword of this.parseKeywords(raw)) {
        const key = keyword.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          keywords.push(keyword);
        }
      }
    }

    return keywords;
  }

  private parseAuthorsFromFields(fields: Map<string, string[]>): Author[] {
    const authorStrings: string[] = [];
    
    // 收集所有作者字段
    for (const tag of ['AU', 'A1', 'A2', 'A3', 'A4']) {
      const values = fields.get(tag);
      if (values) {
        // 知网 RIS 格式：作者用分号分隔，如 "Sharma Ashutosh;Georgi Mikhail;..."
        for (const value of values) {
          if (value.includes(';')) {
            // 分号分隔格式（知网）
            authorStrings.push(...value.split(';').map(s => s.trim()).filter(s => s));
          } else {
            // 标准 RIS 格式：每行一个作者
            authorStrings.push(value);
          }
        }
      }
    }

    if (authorStrings.length === 0) {
      return [{ name: 'Unknown' }];
    }

    return authorStrings.map(name => {
      const trimmed = name.trim();
      const parts = trimmed.split(',');
      
      if (parts.length >= 2) {
        return {
          name: trimmed,
          lastName: parts[0].trim(),
          firstName: parts[1].trim(),
        };
      }
      
      // 知网格式：名字在前，姓氏在后（如 "Sharma Ashutosh"）
      const words = trimmed.split(/\s+/);
      if (words.length >= 2) {
        // 对于中文作者名，整个字符串作为 name
        // 对于英文作者名，假设最后一个词是姓氏
        if (/[\u4e00-\u9fa5]/.test(trimmed)) {
          return { name: trimmed };
        }
        return {
          name: trimmed,
          lastName: words[words.length - 1],
          firstName: words.slice(0, -1).join(' '),
        };
      }
      
      return { name: trimmed };
    });
  }

  /**
   * 提取年份，处理特殊值如 "prepublish"
   * 
   * CNKI RIS 格式可能包含非年份值：
   * - YR prepublish → 预出版文章，尝试从其他字段获取年份
   * - IS prepublish → issue 字段也可能是这个值
   * 
   * 返回：年份或当前年份（作为 fallback）
   */
  private extractYear(dateStr: string): number {
    // 首先尝试直接提取年份
    const match = dateStr.match(/(\d{4})/);
    if (match) {
      return parseInt(match[1]);
    }
    
    // 特殊值处理：prepublish 等非年份值
    // 返回当前年份作为 fallback，同时记录警告
    if (dateStr && !dateStr.match(/\d{4}/)) {
      logger.warn(`[RISParser] Non-year value in date field: "${dateStr}". Using current year as fallback.`);
    }
    
    return new Date().getFullYear();
  }

  private formatPages(start?: string, end?: string): string | undefined {
    if (start && end) {
      return `${start}-${end}`;
    }
    return start || undefined;
  }

  private mapDocumentType(ty: string): UnifiedLiterature['documentType'] {
    const typeMap: Record<string, UnifiedLiterature['documentType']> = {
      // 标准 RIS 类型
      'JOUR': 'article',
      'JFULL': 'article',
      'BOOK': 'book',
      'CHAP': 'chapter',
      'THES': 'thesis',
      'CONF': 'conference',
      'RPRT': 'article',
      'ELEC': 'article',
      // 知网 RIS 类型（如 "RT Journal Article"）
      'JOURNAL': 'article',
      'ARTICLE': 'article',
      'CONFERENCE': 'conference',
      'DISSERTATION': 'thesis',
    };
    // 处理 "Journal Article" 这样的格式
    const normalizedType = ty.toUpperCase().replace(/^(RT\s+)?/, '').split(/\s+/)[0] || '';
    return typeMap[normalizedType] || 'article';
  }
}
