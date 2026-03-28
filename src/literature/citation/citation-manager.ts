import type {
  UnifiedLiterature,
  CitationMark,
  CitationStyle,
} from '../../types/literature';

interface ParagraphBinding {
  paragraphId: string;
  citationIds: string[];
}

export class CitationManager {
  private citationMap: Map<string, CitationMark> = new Map();
  private paragraphBindings: Map<string, CitationMark[]> = new Map();
  private citationCounter: number = 0;
  private style: CitationStyle;
  private literatures: Map<string, UnifiedLiterature> = new Map();

  constructor(style: CitationStyle = 'numeric') {
    this.style = style;
  }

  setLiteratures(literatures: Map<string, UnifiedLiterature>): void {
    this.literatures = literatures;
  }

  bindCitations(paragraphId: string, literatureIds: string[]): CitationMark[] {
    const marks: CitationMark[] = [];

    for (const litId of literatureIds) {
      let mark = this.citationMap.get(litId);

      if (!mark) {
        this.citationCounter++;
        const lit = this.literatures.get(litId);

        if (this.style === 'numeric') {
          mark = {
            style: 'numeric',
            numericId: this.citationCounter,
            literatureId: litId,
          };
        } else {
          mark = {
            style: 'author-year',
            authorYear: this.formatAuthorYear(lit),
            literatureId: litId,
          };
        }

        this.citationMap.set(litId, mark);
      }

      marks.push(mark);
    }

    this.paragraphBindings.set(paragraphId, marks);
    return marks;
  }

  formatCitationMarks(marks: CitationMark[]): string {
    if (marks.length === 0) return '';

    if (this.style === 'numeric') {
      const ids = marks.map(m => m.numericId!).sort((a, b) => a - b);
      const compressed = this.compressRanges(ids);
      return compressed.map(r =>
        Array.isArray(r) ? `[${r[0]}-${r[1]}]` : `[${r}]`
      ).join(',');
    } else {
      const authorYears = marks.map(m => m.authorYear!).filter(Boolean);
      return `(${authorYears.join('; ')})`;
    }
  }

  private compressRanges(ids: number[]): Array<number | [number, number]> {
    if (ids.length === 0) return [];

    const result: Array<number | [number, number]> = [];
    let start = ids[0];
    let prev = ids[0];

    for (let i = 1; i <= ids.length; i++) {
      if (i < ids.length && ids[i] === prev + 1) {
        prev = ids[i];
      } else {
        if (start === prev) {
          result.push(start);
        } else {
          result.push([start, prev]);
        }
        if (i < ids.length) {
          start = prev = ids[i];
        }
      }
    }

    return result;
  }

  private formatAuthorYear(lit?: UnifiedLiterature): string {
    if (!lit) return 'Unknown';
    const author = lit.authors[0]?.lastName || lit.authors[0]?.name || 'Unknown';
    return `${author}, ${lit.year}`;
  }

  getCitation(literatureId: string): CitationMark | undefined {
    return this.citationMap.get(literatureId);
  }

  getParagraphCitations(paragraphId: string): CitationMark[] {
    return this.paragraphBindings.get(paragraphId) || [];
  }

  getAllCitations(): CitationMark[] {
    return Array.from(this.citationMap.values()).sort((a, b) => {
      if (a.numericId && b.numericId) {
        return a.numericId - b.numericId;
      }
      return 0;
    });
  }

  getUsedLiteratureIds(): string[] {
    return Array.from(this.citationMap.keys());
  }

  getCitationCount(): number {
    return this.citationCounter;
  }

  getUniqueCitationCount(): number {
    return this.citationMap.size;
  }

  getBindings(): ParagraphBinding[] {
    return Array.from(this.paragraphBindings.entries()).map(([paragraphId, marks]) => ({
      paragraphId,
      citationIds: marks.map(m => m.literatureId),
    }));
  }

  setStyle(style: CitationStyle): void {
    this.style = style;
    this.reset();
  }

  reset(): void {
    this.citationMap.clear();
    this.paragraphBindings.clear();
    this.citationCounter = 0;
  }
}
