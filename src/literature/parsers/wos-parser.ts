import * as fs from 'fs/promises';
import { BaseParser } from './base-parser';
import type { UnifiedLiterature, DocumentType } from '../../types/literature';

export class WoSParser extends BaseParser {
  private fieldMap: Map<string, string> = new Map();

  async parse(filePath: string): Promise<UnifiedLiterature[]> {
    const content = await this.readFile(filePath);
    
    if (!this.validate(content)) {
      throw new Error('Invalid Web of Science file format');
    }

    const entries = this.splitEntries(content);
    const results: UnifiedLiterature[] = [];

    for (const entry of entries) {
      try {
        const fields = this.parseFields(entry);
        const literature = this.toUnified(fields);
        results.push(literature);
      } catch (error) {
        console.warn('Failed to parse entry:', error);
      }
    }

    return results;
  }

  validate(content: string): boolean {
    return content.includes('PT ') && content.includes('ER');
  }

  private splitEntries(content: string): string[] {
    const entries: string[] = [];
    const lines = content.split('\n');
    let currentEntry: string[] = [];
    let inEntry = false;

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('PT ')) {
        if (inEntry && currentEntry.length > 0) {
          entries.push(currentEntry.join('\n'));
        }
        currentEntry = [line];
        inEntry = true;
      } else if (inEntry) {
        currentEntry.push(line);
        
        if (trimmed === 'ER') {
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
    const lines = entry.split('\n');
    let currentField: string | null = null;
    let currentValue: string[] = [];

    for (const line of lines) {
      if (line.length < 3) continue;
      
      const twoCharCode = line.substring(0, 2);
      const hasSpace = line.length > 2 && line[2] === ' ';

      if (hasSpace && /^[A-Z]{2}$/.test(twoCharCode)) {
        if (currentField && currentValue.length > 0) {
          fields.set(currentField, currentValue.join(' ').trim());
        }
        currentField = twoCharCode;
        currentValue = [line.substring(3).trim()];
      } else if (currentField) {
        currentValue.push(line.trim());
      }
    }

    if (currentField && currentValue.length > 0) {
      fields.set(currentField, currentValue.join(' ').trim());
    }

    return fields;
  }

  private toUnified(fields: Map<string, string>): UnifiedLiterature {
    const authors = this.parseAuthors(fields.get('AU') || '');
    const year = parseInt(fields.get('PY') || '0');
    const title = this.normalizeText(fields.get('TI') || '');
    
    const lit: Partial<UnifiedLiterature> = {
      title,
      authors,
      year,
      abstract: this.normalizeText(fields.get('AB') || ''),
      keywords: this.parseKeywords(fields.get('DE') || ''),
      journal: fields.get('SO') || '',
      volume: fields.get('VL'),
      issue: fields.get('IS'),
      doi: fields.get('DI'),
      documentType: this.mapDocumentType(fields.get('PT') || ''),
      categories: this.parseKeywords(fields.get('WC') || ''),
      references: this.parseReferences(fields.get('CR') || ''),
      source: 'wos',
      rawData: JSON.stringify(Object.fromEntries(fields)),
    };

    const pages = fields.get('BP') && fields.get('EP') 
      ? `${fields.get('BP')}-${fields.get('EP')}` 
      : fields.get('AR');
    lit.pages = pages;

    lit.id = this.generateId(lit);

    return lit as UnifiedLiterature;
  }

  private mapDocumentType(pt: string): DocumentType {
    const typeMap: Record<string, DocumentType> = {
      'J': 'article',
      'B': 'book',
      'S': 'conference',
      'P': 'conference',
      'R': 'review',
      'D': 'thesis',
      'C': 'chapter',
    };
    return typeMap[pt] || 'other';
  }

  private parseReferences(cr: string): string[] {
    if (!cr) return [];
    return cr.split('\n').map(r => r.trim()).filter(r => r.length > 0);
  }
}
