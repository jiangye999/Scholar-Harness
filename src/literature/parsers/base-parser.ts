import * as fs from 'fs/promises';
import type { UnifiedLiterature, Author } from '../../types/literature';

export abstract class BaseParser {
  abstract parse(filePath: string): Promise<UnifiedLiterature[]>;
  abstract validate(content: string): boolean;

  protected async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  protected generateId(lit: Partial<UnifiedLiterature>): string {
    if (lit.doi) {
      return `doi_${lit.doi.replace(/[\/\.]/g, '_')}`;
    }
    const firstAuthor = lit.authors?.[0]?.lastName || 'unknown';
    const title = lit.title?.slice(0, 20).replace(/\s+/g, '_') || 'unknown';
    return `${firstAuthor}_${lit.year}_${title}`;
  }

  protected parseAuthors(authorString: string): Author[] {
    if (!authorString) return [];
    
    return authorString.split(';').map(name => {
      const trimmed = name.trim();
      const parts = trimmed.split(',');
      
      if (parts.length >= 2) {
        return {
          name: trimmed,
          lastName: parts[0].trim(),
          firstName: parts[1].trim(),
        };
      }
      
      const spaceParts = trimmed.split(' ');
      if (spaceParts.length >= 2) {
        return {
          name: trimmed,
          lastName: spaceParts[spaceParts.length - 1],
          firstName: spaceParts.slice(0, -1).join(' '),
        };
      }
      
      return { name: trimmed };
    });
  }

  /**
   * 解析关键词字符串为数组
   * 支持中英文分隔符：英文分号(;)、英文逗号(,)、中文分号(；)、中文逗号(，)
   */
  protected parseKeywords(keywordString: string): string[] {
    if (!keywordString) return [];
    return keywordString
      .split(/[;，,；]/)  // 支持中英文标点
      .map(k => k.trim())
      .filter(k => k.length > 0);
  }

  protected normalizeText(text: string): string {
    return text
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim();
  }
}
