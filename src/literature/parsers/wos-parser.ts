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

  private parseFields(entry: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    let currentField: string | null = null;
    const listLikeFields = new Set(['AU', 'AF', 'CR', 'DE', 'ID', 'WC', 'SC']);

    for (const rawLine of entry.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.length < 3) continue;
      
      const twoCharCode = line.substring(0, 2);
      const hasSpace = line.length > 2 && line[2] === ' ';

      if (hasSpace && /^[A-Z]{2}$/.test(twoCharCode)) {
        currentField = twoCharCode;
        const value = line.substring(3).trim();
        if (value) {
          const values = fields.get(currentField) || [];
          values.push(value);
          fields.set(currentField, values);
        } else if (!fields.has(currentField)) {
          fields.set(currentField, []);
        }
      } else if (currentField) {
        const continuation = line.trim();
        if (!continuation) continue;
        const values = fields.get(currentField) || [];
        if (listLikeFields.has(currentField) || values.length === 0) {
          values.push(continuation);
        } else {
          values[values.length - 1] = `${values[values.length - 1]} ${continuation}`;
        }
        fields.set(currentField, values);
      }
    }

    return fields;
  }

  private toUnified(fields: Map<string, string[]>): UnifiedLiterature {
    const shortAuthors = this.getValues(fields, ['AU']);
    const authorValues = shortAuthors.length > 0 ? shortAuthors : this.getValues(fields, ['AF']);
    const authors = this.parseAuthors(authorValues.join('; '));
    const year = parseInt(this.getFirst(fields, ['PY']) || '0');
    const title = this.normalizeText(this.getJoined(fields, ['TI']));
    
    const lit: Partial<UnifiedLiterature> = {
      title,
      authors,
      author: authors.map(a => a.name).join(', '),
      year,
      abstract: this.normalizeText(this.getJoined(fields, ['AB'])),
      keywords: this.parseKeywords(this.getValues(fields, ['DE', 'ID']).join('; ')),
      journal: this.getFirst(fields, ['SO', 'J9']),
      volume: this.getFirst(fields, ['VL']),
      issue: this.getFirst(fields, ['IS']),
      doi: this.getFirst(fields, ['DI', 'DO']),
      documentType: this.mapDocumentType(this.getFirst(fields, ['PT'])),
      categories: this.parseKeywords(this.getValues(fields, ['WC', 'SC']).join('; ')),
      references: this.getValues(fields, ['CR']),
      source: 'wos',
      rawData: JSON.stringify(Object.fromEntries(
        Array.from(fields.entries()).map(([key, values]) => [key, values.length === 1 ? values[0] : values])
      )),
    };

    const startPage = this.getFirst(fields, ['BP']);
    const endPage = this.getFirst(fields, ['EP']);
    const pages = startPage && endPage
      ? `${startPage}-${endPage}`
      : this.getFirst(fields, ['AR']);
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

  private getValues(fields: Map<string, string[]>, tags: string[]): string[] {
    const values: string[] = [];
    for (const tag of tags) {
      values.push(...(fields.get(tag) || []));
    }
    return values.map(value => value.trim()).filter(Boolean);
  }

  private getFirst(fields: Map<string, string[]>, tags: string[]): string {
    return this.getValues(fields, tags)[0] || '';
  }

  private getJoined(fields: Map<string, string[]>, tags: string[]): string {
    return this.getValues(fields, tags).join(' ').replace(/\s+/g, ' ').trim();
  }
}
