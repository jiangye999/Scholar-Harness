import * as fs from 'fs/promises';
import { BaseParser } from './base-parser';
import type { UnifiedLiterature, Author } from '../../types/literature';

/**
 * BibTeX 格式解析器
 * 
 * 支持标准 BibTeX 格式，常见于 LaTeX 论文写作
 */
export class BIBParser extends BaseParser {
  async parse(filePath: string): Promise<UnifiedLiterature[]> {
    const content = await this.readFile(filePath);
    
    if (!this.validate(content)) {
      throw new Error('Invalid BibTeX file format');
    }

    const entries = this.splitEntries(content);
    const results: UnifiedLiterature[] = [];

    for (const entry of entries) {
      try {
        const fields = this.parseFields(entry);
        const literature = this.toUnified(fields);
        results.push(literature);
      } catch (error) {
        console.warn('Failed to parse BibTeX entry:', error);
      }
    }

    return results;
  }

  validate(content: string): boolean {
    // BibTeX 文件以 @type{ 开头
    return content.match(/^@\w+\{/m) !== null;
  }

  private splitEntries(content: string): string[] {
    const entries: string[] = [];
    const lines = content.split('\n');
    let currentEntry: string[] = [];
    let braceDepth = 0;
    let inEntry = false;

    for (const line of lines) {
      // 检测条目开始
      if (line.match(/^@\w+\{/)) {
        if (inEntry && currentEntry.length > 0) {
          entries.push(currentEntry.join('\n'));
        }
        currentEntry = [line];
        inEntry = true;
        braceDepth = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      } else if (inEntry) {
        currentEntry.push(line);
        braceDepth += (line.match(/\{/g) || []).length;
        braceDepth -= (line.match(/\}/g) || []).length;
        
        // 条目结束（括号匹配）
        if (braceDepth <= 0) {
          entries.push(currentEntry.join('\n'));
          currentEntry = [];
          inEntry = false;
        }
      }
    }

    return entries.filter(e => e.trim());
  }

  private parseFields(entry: string): Map<string, string> {
    const fields = new Map<string, string>();
    
    // 提取条目类型
    const typeMatch = entry.match(/^@(\w+)\s*\{/);
    if (typeMatch) {
      fields.set('_type', typeMatch[1].toLowerCase());
    }
    
    // 提取引用键
    const keyMatch = entry.match(/^@\w+\s*\{([^,]+),/);
    if (keyMatch) {
      fields.set('_key', keyMatch[1].trim());
    }

    // 解析字段 - 支持多种格式
    // 格式1: field = {value}
    // 格式2: field = "value"
    // 格式3: field = value (无引号)
    const fieldRegex = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|(\d+))/gi;
    let match;
    
    while ((match = fieldRegex.exec(entry)) !== null) {
      const fieldName = match[1].toLowerCase();
      const value = match[2] || match[3] || match[4] || '';
      fields.set(fieldName, value.trim());
    }

    return fields;
  }

  private toUnified(fields: Map<string, string>): UnifiedLiterature {
    const title = fields.get('title') || fields.get('booktitle') || '';
    const authors = this.parseBibAuthors(fields.get('author') || '');
    const year = parseInt(fields.get('year') || '') || new Date().getFullYear();
    const journal = fields.get('journal') || fields.get('booktitle') || fields.get('publisher') || '';
    const abstract = fields.get('abstract') || '';
    const keywords = this.parseKeywords(fields.get('keywords') || fields.get('keywords') || '');
    const doi = fields.get('doi') || '';
    const volume = fields.get('volume') || '';
    const issue = fields.get('number') || fields.get('issue') || '';
    const pages = fields.get('pages') || '';
    const entryType = fields.get('_type') || 'article';

    const lit: Partial<UnifiedLiterature> = {
      title: this.normalizeText(title),
      authors,
      author: authors.map(a => a.name).join(', '),
      year,
      abstract: this.normalizeText(abstract),
      keywords,
      journal,
      volume,
      issue,
      pages,
      doi,
      documentType: this.mapDocumentType(entryType),
      source: 'wos', // BibTeX 格式来源标记为 wos（兼容）
      rawData: JSON.stringify(Object.fromEntries(fields)),
    };

    lit.id = this.generateId(lit);

    return lit as UnifiedLiterature;
  }

  private parseBibAuthors(authorStr: string): Author[] {
    if (!authorStr) {
      return [{ name: 'Unknown' }];
    }

    // BibTeX 作者格式：多个作者用 " and " 分隔
    const authorParts = authorStr.split(/\s+and\s+/i);
    
    return authorParts.map(part => {
      const trimmed = part.trim();
      
      // 格式: "Last, First" 或 "First Last"
      const commaParts = trimmed.split(',');
      if (commaParts.length >= 2) {
        return {
          name: trimmed,
          lastName: commaParts[0].trim(),
          firstName: commaParts.slice(1).join(',').trim(),
        };
      }
      
      // 格式: "First Last" - 最后一个词是姓
      const words = trimmed.split(/\s+/);
      if (words.length >= 2) {
        const lastName = words[words.length - 1];
        const firstName = words.slice(0, -1).join(' ');
        return {
          name: trimmed,
          lastName,
          firstName,
        };
      }
      
      return { name: trimmed };
    });
  }

  private mapDocumentType(type: string): UnifiedLiterature['documentType'] {
    const typeMap: Record<string, UnifiedLiterature['documentType']> = {
      'article': 'article',
      'inproceedings': 'conference',
      'conference': 'conference',
      'book': 'book',
      'incollection': 'chapter',
      'phdthesis': 'thesis',
      'mastersthesis': 'thesis',
      'techreport': 'article',
      'misc': 'other',
    };
    return typeMap[type.toLowerCase()] || 'article';
  }
}