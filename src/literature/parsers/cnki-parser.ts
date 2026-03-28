import * as fs from 'fs/promises';
import { BaseParser } from './base-parser';
import type { UnifiedLiterature, DocumentType } from '../../types/literature';

export class CNKIParser extends BaseParser {
  async parse(filePath: string): Promise<UnifiedLiterature[]> {
    const content = await this.readFile(filePath);
    
    if (!this.validate(content)) {
      throw new Error('Invalid CNKI file format');
    }

    const format = this.detectFormat(content);
    
    switch (format) {
      case 'custom':
        return this.parseCustomFormat(content);
      case 'gb7714':
        return this.parseGB7714Format(content);
      default:
        return this.parseAutoFormat(content);
    }
  }

  validate(content: string): boolean {
    const hasTitle = content.includes('Title:') || content.includes('题名');
    const hasAuthor = content.includes('Author:') || content.includes('作者');
    const hasSource = content.includes('Source:') || content.includes('来源');
    return hasTitle || hasAuthor || hasSource;
  }

  private detectFormat(content: string): 'custom' | 'gb7714' | 'unknown' {
    if (content.includes('【题　　名】') || content.includes('【作者】')) {
      return 'custom';
    }
    if (content.match(/\[\d+\][\s\S]*?\./)) {
      return 'gb7714';
    }
    return 'unknown';
  }

  private parseCustomFormat(content: string): UnifiedLiterature[] {
    const entries: string[] = [];
    const lines = content.split('\n');
    let currentEntry: string[] = [];

    for (const line of lines) {
      if (line.startsWith('【来　　源】') || line.startsWith('【来源】')) {
        if (currentEntry.length > 0) {
          currentEntry.push(line);
          entries.push(currentEntry.join('\n'));
          currentEntry = [];
        }
      } else {
        currentEntry.push(line);
      }
    }

    if (currentEntry.length > 0) {
      entries.push(currentEntry.join('\n'));
    }

    return entries.map(entry => this.parseCustomEntry(entry));
  }

  private parseCustomEntry(entry: string): UnifiedLiterature {
    const fields = new Map<string, string>();
    const lines = entry.split('\n');
    let currentField: string | null = null;
    let currentValue: string[] = [];

    const fieldPatterns: [RegExp, string][] = [
      [/【题　　名】|【题名】/, 'title'],
      [/【作者】/, 'authors'],
      [/【来　　源】|【来源】/, 'source'],
      [/【刊　　名】|【刊名】/, 'journal'],
      [/【ISSN】/, 'issn'],
      [/【年】/, 'year'],
      [/【卷】/, 'volume'],
      [/【期】/, 'issue'],
      [/【页码】|【页】/, 'pages'],
      [/【关键词】/, 'keywords'],
      [/【摘　　要】|【摘要】/, 'abstract'],
      [/【基金】/, 'funding'],
      [/【DOI】/, 'doi'],
    ];

    for (const line of lines) {
      let matched = false;
      
      for (const [pattern, fieldName] of fieldPatterns) {
        if (pattern.test(line)) {
          if (currentField) {
            fields.set(currentField, currentValue.join(' ').trim());
          }
          currentField = fieldName;
          currentValue = [line.replace(pattern, '').trim()];
          matched = true;
          break;
        }
      }

      if (!matched && currentField) {
        currentValue.push(line.trim());
      }
    }

    if (currentField) {
      fields.set(currentField, currentValue.join(' ').trim());
    }

    return this.fieldsToUnified(fields);
  }

  private parseGB7714Format(content: string): UnifiedLiterature[] {
    const entries: string[] = [];
    const regex = /\[(\d+)\]([\s\S]*?)(?=\[\d+\]|$)/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      entries.push(match[2].trim());
    }

    return entries.map(entry => this.parseGB7714Entry(entry));
  }

  private parseGB7714Entry(entry: string): UnifiedLiterature {
    const fields = new Map<string, string>();
    
    const authorMatch = entry.match(/^(.+?)\.\s*/);
    if (authorMatch) {
      fields.set('authors', authorMatch[1]);
    }

    const titleMatch = entry.match(/\.(\s*[\[【](.+?)[\]】])?\s*(.+?)\[/);
    if (titleMatch) {
      fields.set('title', titleMatch[3].trim());
    }

    const journalMatch = entry.match(/\[J\]\s*\.\s*(.+?),\s*(\d{4})/);
    if (journalMatch) {
      fields.set('journal', journalMatch[1]);
      fields.set('year', journalMatch[2]);
    }

    const volumeMatch = entry.match(/,(\d+)\((\d+)\):/);
    if (volumeMatch) {
      fields.set('volume', volumeMatch[1]);
      fields.set('issue', volumeMatch[2]);
    }

    const pagesMatch = entry.match(/:(\d+-?\d*)\./);
    if (pagesMatch) {
      fields.set('pages', pagesMatch[1]);
    }

    return this.fieldsToUnified(fields);
  }

  private parseAutoFormat(content: string): UnifiedLiterature[] {
    const lines = content.split('\n').filter(l => l.trim());
    const entries: UnifiedLiterature[] = [];
    
    for (const line of lines) {
      if (line.length > 20) {
        try {
          const fields = this.guessFields(line);
          if (fields.get('title') && fields.get('authors')) {
            entries.push(this.fieldsToUnified(fields));
          }
        } catch {
        }
      }
    }

    return entries;
  }

  private guessFields(line: string): Map<string, string> {
    const fields = new Map<string, string>();
    
    const parts = line.split(/[,，;；]/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      
      if (/^\d{4}$/.test(trimmed)) {
        fields.set('year', trimmed);
      } else if (trimmed.includes('大学') || trimmed.includes('学院') || trimmed.includes('研究所')) {
        if (!fields.get('journal')) {
          fields.set('journal', trimmed);
        }
      } else if (trimmed.length < 50 && (trimmed.includes(' ') || /[，,]/.test(trimmed))) {
        if (!fields.get('authors')) {
          fields.set('authors', trimmed);
        }
      } else if (trimmed.length > 10) {
        if (!fields.get('title')) {
          fields.set('title', trimmed);
        }
      }
    }

    return fields;
  }

  private fieldsToUnified(fields: Map<string, string>): UnifiedLiterature {
    const authors = this.parseAuthors(fields.get('authors') || '');
    const year = parseInt(fields.get('year') || '0');
    const title = this.normalizeText(fields.get('title') || '');

    const lit: Partial<UnifiedLiterature> = {
      title,
      authors,
      year,
      abstract: this.normalizeText(fields.get('abstract') || ''),
      keywords: this.parseKeywords(fields.get('keywords') || ''),
      journal: fields.get('journal') || '',
      volume: fields.get('volume'),
      issue: fields.get('issue'),
      pages: fields.get('pages'),
      doi: fields.get('doi'),
      documentType: 'article',
      source: 'cnki',
      rawData: JSON.stringify(Object.fromEntries(fields)),
    };

    lit.id = this.generateId(lit);

    return lit as UnifiedLiterature;
  }
}
