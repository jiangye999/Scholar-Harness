export { BaseParser } from './base-parser';
export { WoSParser } from './wos-parser';
export { CNKIParser } from './cnki-parser';
export { RISParser } from './ris-parser';
export { BIBParser } from './bib-parser';

import { BaseParser } from './base-parser';
import { WoSParser } from './wos-parser';
import { CNKIParser } from './cnki-parser';
import { RISParser } from './ris-parser';
import { BIBParser } from './bib-parser';
import type { UnifiedLiterature } from '../../types/literature';
import * as fs from 'fs/promises';

export type ParserSource = 'wos' | 'cnki' | 'ris' | 'bib';

export class ParserFactory {
  static create(source: ParserSource): BaseParser {
    switch (source) {
      case 'wos':
        return new WoSParser();
      case 'cnki':
        return new CNKIParser();
      case 'ris':
        return new RISParser();
      case 'bib':
        return new BIBParser();
      default:
        throw new Error(`Unknown parser source: ${source}`);
    }
  }

  /**
   * 自动检测文件格式并解析
   * 支持内容字符串或文件路径
   */
  static async parseFile(filePath: string): Promise<UnifiedLiterature[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    return this.parseContent(content, filePath);
  }

  /**
   * 从内容字符串解析（支持 Electron 内存文件）
   */
  static parseContent(content: string, fileName?: string): UnifiedLiterature[] {
    const wosParser = new WoSParser();
    const cnkiParser = new CNKIParser();
    const risParser = new RISParser();
    const bibParser = new BIBParser();

    // 🔴 优先检测知网 RIS 格式（避免被 WoS 的 /^TI\s/m 误匹配）
    // 知网 RIS 特征：RT Journal Article 或 DS CNKI 标识
    if (content.match(/^RT\s+(Journal|Book|Conference|Thesis)/im) || content.includes('DS CNKI')) {
      return risParser.parseContent(content);
    }

    // 按优先级尝试各种格式
    if (risParser.validate(content)) {
      return risParser.parseContent(content);
    }

    if (bibParser.validate(content)) {
      return this.parseBIBContent(content);
    }

    if (wosParser.validate(content)) {
      return this.parseWoSContent(content);
    }

    if (cnkiParser.validate(content)) {
      return this.parseCNKIContent(content);
    }

    throw new Error('Unable to detect file format. Supported formats: WoS, CNKI, RIS, BIB');
  }

  /**
   * 从内容字符串解析 RIS 格式（支持标准 RIS 和知网 RIS）
   */
  private static parseRISContent(content: string): UnifiedLiterature[] {
    const papers: UnifiedLiterature[] = [];
    
    // 添加调试日志
    console.log(`[ParserFactory.parseRISContent] Content length: ${content.length}`);
    console.log(`[ParserFactory.parseRISContent] Content preview: ${content.substring(0, 100).replace(/\n/g, '\\n')}`);
    
    // 知网 RIS 格式：记录以 RT Journal Article/Book/Conference/Thesis 开头，没有 ER 或空行分隔
    // 标准 RIS 格式：记录以 TY - 开头，用 ER - 结束或空行分隔
    // 需要检测并使用正确的分隔策略
    
    const isCNKIRISFormat = content.match(/^RT\s+(Journal|Book|Conference|Thesis)/im);
    console.log(`[ParserFactory.parseRISContent] CNKI RIS format detected: ${!!isCNKIRISFormat}`);
    
    let records: string[];
    
    if (isCNKIRISFormat) {
      // 知网 RIS：以 RT 行作为记录分隔标记
      // 将内容按 RT 行分割，每条 RT 开头的行开始一个新记录
      const lines = content.split('\n');
      const recordBlocks: string[] = [];
      let currentBlock: string[] = [];
      
      for (const line of lines) {
        // RT 行表示新记录开始
        if (line.match(/^RT\s+(Journal|Book|Conference|Thesis)/i)) {
          if (currentBlock.length > 0) {
            recordBlocks.push(currentBlock.join('\n'));
          }
          currentBlock = [line];
        } else if (line.trim()) {
          // 非空行，添加到当前记录
          currentBlock.push(line);
        } else {
          // 空行也可能是记录结束（某些知网导出可能有空行）
          if (currentBlock.length > 0) {
            recordBlocks.push(currentBlock.join('\n'));
            currentBlock = [];
          }
        }
      }
      
      // 最后一条记录
      if (currentBlock.length > 0) {
        recordBlocks.push(currentBlock.join('\n'));
      }
      
      records = recordBlocks;
      console.log(`[ParserFactory.parseRISContent] CNKI RIS: Split into ${records.length} record(s) by RT lines`);
    } else {
      // 标准 RIS：用 ER 或空行分隔
      records = content.split(/(?:^ER\s*-*\s*$)|(?:\n\s*\n)/m);
      console.log(`[ParserFactory.parseRISContent] Standard RIS: Split into ${records.length} record(s) by ER or blank lines`);
    }
    
    for (let ri = 0; ri < records.length; ri++) {
      const record = records[ri];
      if (!record.trim()) {
        console.log(`[ParserFactory.parseRISContent] Record ${ri} is empty, skipping`);
        continue;
      }
      
      console.log(`[ParserFactory.parseRISContent] Processing record ${ri}, length: ${record.length}`);
      const lines = record.split('\n');
      const fields = new Map<string, string[]>();
      
      for (const line of lines) {
        // 移除 Windows 换行符 \r（文件可能使用 \r\n）
        const cleanLine = line.replace(/\r$/, '');
        
        // 标准 RIS: TY  - JOUR（两字符 + 空格/- + 空格 + 内容）
        // 知网 RIS: A1 Sharma Ashutosh（两字符 + 空格 + 内容）
        // 使用宽松正则：两字符后跟至少一个空格或 -
        const match = cleanLine.match(/^([A-Z0-9]{2})\s+[-\s]*(.*)$/);
        if (match) {
          const [, tag, value] = match;
          const trimmed = value.trim();
          if (trimmed) {
            const existing = fields.get(tag) || [];
            existing.push(trimmed);
            fields.set(tag, existing);
          }
        }
        // 知网 RIS: RT Journal Article 格式（特殊处理）
        const cnkiMatch = cleanLine.match(/^RT\s+(Journal|Book|Conference|Thesis)/i);
        if (cnkiMatch) {
          fields.set('RT', [cnkiMatch[1]]);
        }
      }
      
      // 输出解析到的字段
      console.log(`[ParserFactory.parseRISContent] Record ${ri} fields:`, Object.fromEntries(fields));
      
      // 标题：TI 或 T1
      const title = this.getField(fields, ['TI', 'T1']);
      console.log(`[ParserFactory.parseRISContent] Record ${ri} title:`, title || 'NOT FOUND');
      
      if (title) {
        // 作者：知网用分号分隔，标准 RIS 每行一个
        let authors: { name: string }[] = [];
        const authorFields = fields.get('AU') || fields.get('A1') || [];
        for (const authorField of authorFields) {
          if (authorField.includes(';')) {
            // 知网格式：分号分隔
            authors.push(...authorField.split(';').map(s => s.trim()).filter(s => s).map(name => ({ name })));
          } else {
            authors.push({ name: authorField.trim() });
          }
        }
        if (authors.length === 0) authors = [{ name: 'Unknown' }];
        
        // 年份：PY, Y1, YR（处理 prepublish 等特殊值）
        const yearRaw = this.getField(fields, ['PY', 'Y1', 'YR']) || '';
        const yearMatch = yearRaw.match(/(\d{4})/);
        const year = yearMatch ? parseInt(yearMatch[1]) : new Date().getFullYear();
        if (yearRaw && !yearMatch) {
          console.warn(`[ParserFactory] Non-year value: "${yearRaw}", using current year`);
        }
        
        // 摘要：AB, N2
        const abstract = this.getField(fields, ['AB', 'N2']) || '';
        
        // 关键词：KW, K1（知网，用分号分隔）
        const kwRaw = fields.get('KW') || fields.get('K1') || [];
        const keywords = kwRaw.flatMap(kw => 
          kw.split(/[;，,]/).map(k => k.trim()).filter(k => k)
        );
        
        // 期刊：SO, JF
        const journal = this.getField(fields, ['SO', 'JF']) || '';
        
        // DOI：DO, DI
        const doi = this.getField(fields, ['DO', 'DI']) || '';
        
        // 卷期页码
        const volume = this.getField(fields, ['VL', 'VO']) || '';
        const issue = this.getField(fields, ['IS']) || '';
        const pages = this.getField(fields, ['SP']) || this.getField(fields, ['OP']) || '';
        
        // 来源检测：DS CNKI 表示知网导出
        const dataSource = this.getField(fields, ['DS']) || '';
        const source: 'wos' | 'cnki' = dataSource.toLowerCase().includes('cnki') ? 'cnki' : 'wos';
        
        papers.push({
          id: `ris-${Date.now()}-${papers.length}`,
          title,
          authors,
          author: authors.map(a => a.name).join(', ') || 'Unknown',
          year,
          abstract,
          keywords,
          journal,
          volume,
          issue,
          pages,
          doi,
          documentType: 'article',
          source,  // 根据实际来源设置
        });
      }
    }
    
    return papers;
  }

  /**
   * 从内容字符串解析 BIB 格式
   */
  private static parseBIBContent(content: string): UnifiedLiterature[] {
    const papers: UnifiedLiterature[] = [];
    const entries = content.split(/^@/m).filter(e => e.trim());
    
    for (const entry of entries) {
      const fields = new Map<string, string>();
      
      // 解析字段
      const fieldRegex = /(\w+)\s*=\s*(?:\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}|"([^"]*)"|(\d+))/gi;
      let match;
      while ((match = fieldRegex.exec(entry)) !== null) {
        const fieldName = match[1].toLowerCase();
        const value = match[2] || match[3] || match[4] || '';
        fields.set(fieldName, value.trim());
      }
      
      const title = fields.get('title') || fields.get('booktitle');
      if (title) {
        const authorStr = fields.get('author') || '';
        const authors = authorStr.split(/\s+and\s+/i).map(name => ({
          name: name.trim(),
        }));
        
        const year = parseInt(fields.get('year') || '') || new Date().getFullYear();
        
        papers.push({
          id: `bib-${Date.now()}-${papers.length}`,
          title,
          authors: authors.length > 0 ? authors : [{ name: 'Unknown' }],
          author: authorStr || 'Unknown',
          year,
          abstract: fields.get('abstract') || '',
          keywords: (fields.get('keywords') || '').split(/[;,]/).map(k => k.trim()).filter(k => k),
          journal: fields.get('journal') || fields.get('booktitle') || '',
          doi: fields.get('doi') || '',
          documentType: 'article',
          source: 'wos',
        });
      }
    }
    
    return papers;
  }

  /**
   * 从内容字符串解析 WoS 格式
   */
  private static parseWoSContent(content: string): UnifiedLiterature[] {
    const papers: UnifiedLiterature[] = [];
    const records = content.split(/^ER\s*$/m);
    
    for (const record of records) {
      if (!record.trim() || !record.match(/^PT\s/m) || !record.match(/^TI\s/m)) continue;

      const fields = this.parseWoSFields(record);
      const title = this.getWoSFirst(fields, ['TI']);
      const year = this.getWoSFirst(fields, ['PY']);
      const journal = this.getWoSFirst(fields, ['SO', 'J9']);
      const abstract = this.getWoSJoined(fields, ['AB']);
      const shortAuthors = this.getWoSValues(fields, ['AU']);
      const authors = shortAuthors.length > 0 ? shortAuthors : this.getWoSValues(fields, ['AF']);
      const keywords = this.splitWoSDelimited(this.getWoSValues(fields, ['DE', 'ID']));
      const categories = this.splitWoSDelimited(this.getWoSValues(fields, ['WC', 'SC']));
      const references = this.getWoSValues(fields, ['CR']);
      const doi = this.getWoSFirst(fields, ['DI', 'DO']);
      const volume = this.getWoSFirst(fields, ['VL']);
      const issue = this.getWoSFirst(fields, ['IS']);
      const startPage = this.getWoSFirst(fields, ['BP']);
      const endPage = this.getWoSFirst(fields, ['EP']);
      const articleNumber = this.getWoSFirst(fields, ['AR']);
      const pages = startPage && endPage ? `${startPage}-${endPage}` : (startPage || articleNumber);
      
      if (title) {
        papers.push({
          id: doi ? `doi_${doi.replace(/[\/.]/g, '_')}` : `wos-${Date.now()}-${papers.length}`,
          title,
          authors: authors.length > 0 ? authors.map(name => ({ name })) : [{ name: 'Unknown' }],
          author: authors.join(', ') || 'Unknown',
          year: parseInt(year) || new Date().getFullYear(),
          abstract,
          keywords,
          journal,
          volume,
          issue,
          pages,
          doi,
          categories,
          references,
          documentType: 'article',
          source: 'wos',
          rawData: JSON.stringify(Object.fromEntries(fields)),
        });
      }
    }
    
    return papers;
  }

  private static parseWoSFields(record: string): Map<string, string[]> {
    const fields = new Map<string, string[]>();
    let currentTag: string | null = null;
    const listLikeFields = new Set(['AU', 'AF', 'CR', 'DE', 'ID', 'WC', 'SC']);

    for (const rawLine of record.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      const fieldMatch = line.match(/^([A-Z0-9]{2})\s(.*)$/);
      if (fieldMatch) {
        const tag = fieldMatch[1];
        const value = fieldMatch[2].trim();
        currentTag = tag;
        if (value) {
          const values = fields.get(tag) || [];
          values.push(value);
          fields.set(tag, values);
        } else if (!fields.has(tag)) {
          fields.set(tag, []);
        }
        continue;
      }

      if (currentTag && /^\s{3,}\S/.test(line)) {
        const continuation = line.trim();
        if (!continuation) continue;
        const values = fields.get(currentTag) || [];
        if (listLikeFields.has(currentTag) || values.length === 0) {
          values.push(continuation);
        } else {
          values[values.length - 1] = `${values[values.length - 1]} ${continuation}`;
        }
        fields.set(currentTag, values);
      }
    }

    return fields;
  }

  private static getWoSValues(fields: Map<string, string[]>, tags: string[]): string[] {
    const values: string[] = [];
    for (const tag of tags) {
      values.push(...(fields.get(tag) || []));
    }
    return values.map(value => value.trim()).filter(Boolean);
  }

  private static getWoSFirst(fields: Map<string, string[]>, tags: string[]): string {
    return this.getWoSValues(fields, tags)[0] || '';
  }

  private static getWoSJoined(fields: Map<string, string[]>, tags: string[]): string {
    return this.getWoSValues(fields, tags).join(' ').replace(/\s+/g, ' ').trim();
  }

  private static splitWoSDelimited(values: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      for (const item of value.split(/[;，,；]/)) {
        const trimmed = item.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        result.push(trimmed);
      }
    }
    return result;
  }

  /**
   * 从内容字符串解析 CNKI 格式（中文标签格式）
   * 支持多行摘要和关键词的正确解析
   */
  private static parseCNKIContent(content: string): UnifiedLiterature[] {
    const papers: UnifiedLiterature[] = [];
    const lines = content.split('\n');
    
    // 检测格式类型
    if (content.includes('【题　　名】') || content.includes('【题名】')) {
      let currentPaper: Record<string, string> = {};
      let currentField: string | null = null;
      let currentValue: string[] = [];
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        // 检测新字段开始
        const fieldMatch = line.match(/【(.+?)】/);
        if (fieldMatch) {
          // 保存上一个字段
          if (currentField && currentValue.length > 0) {
            currentPaper[currentField] = currentValue.join(' ').trim();
          }
          
          // 开始新字段
          const fieldName = this.mapCNKIFieldName(fieldMatch[1]);
          const fieldContent = line.replace(/【(.+?)】/, '').trim();
          currentField = fieldName;
          currentValue = fieldContent ? [fieldContent] : [];
          
          // 如果检测到新的文献（【题名】出现且已有数据）
          if (fieldName === 'title' && currentPaper.title) {
            papers.push(this.createCNKIPaper(currentPaper, papers.length));
            currentPaper = {};
          }
        } else if (currentField && trimmed) {
          // 续行内容（多行摘要、标题等）
          currentValue.push(trimmed);
        } else if (!trimmed && currentField) {
          // 空行结束当前字段
          if (currentValue.length > 0) {
            currentPaper[currentField] = currentValue.join(' ').trim();
          }
          currentField = null;
          currentValue = [];
        }
      }
      
      // 保存最后一个字段
      if (currentField && currentValue.length > 0) {
        currentPaper[currentField] = currentValue.join(' ').trim();
      }
      
      // 添加最后一篇文献
      if (currentPaper.title) {
        papers.push(this.createCNKIPaper(currentPaper, papers.length));
      }
    }
    
    return papers;
  }
  
  /**
   * 将 CNKI 中文字段名映射到标准字段名
   */
  private static mapCNKIFieldName(cnkiName: string): string {
    const normalized = cnkiName.replace(/\s+/g, '');  // 去除全角空格
    const map: Record<string, string> = {
      '题名': 'title',
      '作者': 'authors',
      '来源': 'source',
      '刊名': 'journal',
      '年': 'year',
      '卷': 'volume',
      '期': 'issue',
      '页码': 'pages',
      '页': 'pages',
      '关键词': 'keywords',
      '摘要': 'abstract',
      'DOI': 'doi',
      'ISSN': 'issn',
    };
    return map[normalized] || normalized;
  }
  
  /**
   * 从解析数据创建 CNKI 文献对象
   */
  private static createCNKIPaper(data: Record<string, string>, index: number): UnifiedLiterature {
    const authors = (data.authors || 'Unknown').split(/[,;；，]/).map(name => ({
      name: name.trim(),
    })).filter(a => a.name);
    
    const keywords = (data.keywords || '').split(/[;，,；]/).map(k => k.trim()).filter(k => k);
    
    return {
      id: `cnki-${Date.now()}-${index}`,
      title: data.title || 'Unknown Title',
      authors: authors.length > 0 ? authors : [{ name: 'Unknown' }],
      author: authors.map(a => a.name).join(', ') || 'Unknown',
      year: parseInt(data.year || '') || new Date().getFullYear(),
      abstract: data.abstract || '',  // 现在正确收集多行摘要
      keywords,
      journal: data.journal || '',
      volume: data.volume,
      issue: data.issue,
      pages: data.pages,
      doi: data.doi,
      documentType: 'article',
      source: 'cnki',
    };
  }

  private static getField(fields: Map<string, string[]>, tags: string[]): string {
    for (const tag of tags) {
      const values = fields.get(tag);
      if (values && values.length > 0) {
        return values[0];
      }
    }
    return '';
  }
}
