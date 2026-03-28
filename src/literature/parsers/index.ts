export { BaseParser } from './base-parser';
export { WoSParser } from './wos-parser';
export { CNKIParser } from './cnki-parser';

import { BaseParser } from './base-parser';
import { WoSParser } from './wos-parser';
import { CNKIParser } from './cnki-parser';
import type { UnifiedLiterature } from '../../types/literature';
import * as fs from 'fs/promises';

export class ParserFactory {
  static create(source: 'wos' | 'cnki'): BaseParser {
    switch (source) {
      case 'wos':
        return new WoSParser();
      case 'cnki':
        return new CNKIParser();
      default:
        throw new Error(`Unknown parser source: ${source}`);
    }
  }

  static async parseFile(filePath: string): Promise<UnifiedLiterature[]> {
    const wosParser = new WoSParser();
    const cnkiParser = new CNKIParser();

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      
      if (wosParser.validate(content)) {
        return wosParser.parse(filePath);
      }
      
      if (cnkiParser.validate(content)) {
        return cnkiParser.parse(filePath);
      }
      
      throw new Error('Unable to detect file format');
    } catch {
      throw new Error('Failed to parse file');
    }
  }
}
