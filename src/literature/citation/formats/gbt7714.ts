import type { UnifiedLiterature, Author, FormattedReference } from '../../../types/literature';

export class GBT7714Formatter {
  format(lit: UnifiedLiterature, numericId?: number): FormattedReference {
    const authors = this.formatAuthors(lit.authors);
    const title = lit.title;
    const documentTypeCode = this.getDocumentTypeCode(lit.documentType);
    const journal = lit.journal;
    const year = lit.year;
    const volume = lit.volume || '';
    const issue = lit.issue || '';
    const pages = lit.pages || '';
    const doi = lit.doi || '';

    let formatted = '';

    if (documentTypeCode === 'J' || documentTypeCode === 'M') {
      const volIssue = volume ? `, ${volume}${issue ? `(${issue})` : ''}` : '';
      const pageStr = pages ? `: ${pages}` : '';
      const doiStr = doi ? `. DOI: ${doi}` : '';
      
      formatted = `${authors}. ${title}[${documentTypeCode}]. ${journal}${volIssue}${pageStr}${doiStr}.`;
    } else if (documentTypeCode === 'C') {
      formatted = `${authors}. ${title}[${documentTypeCode}]//${journal}. ${year}.`;
    } else if (documentTypeCode === 'D') {
      formatted = `${authors}. ${title}[${documentTypeCode}]. ${journal}, ${year}.`;
    } else {
      formatted = `${authors}. ${title}[${documentTypeCode}]. ${journal}, ${year}.`;
    }

    const citationKey = this.generateCitationKey(lit);

    return {
      id: lit.id,
      numericId,
      citationKey,
      formatted: formatted.trim(),
      style: 'gbt7714',
    };
  }

  formatAll(
    literatures: UnifiedLiterature[],
    citationOrder?: Map<string, number>
  ): FormattedReference[] {
    return literatures.map(lit => {
      const numericId = citationOrder?.get(lit.id);
      return this.format(lit, numericId);
    });
  }

  private formatAuthors(authors: Author[]): string {
    if (authors.length === 0) return '';

    if (authors.length <= 3) {
      return authors.map(a => this.formatAuthorName(a)).join(', ');
    } else {
      return `${this.formatAuthorName(authors[0])}, ${this.formatAuthorName(authors[1])}, ${this.formatAuthorName(authors[2])}, 等`;
    }
  }

  private formatAuthorName(author: Author): string {
    if (author.lastName && author.firstName) {
      return `${author.lastName}, ${author.firstName}`;
    }
    return author.name;
  }

  private getDocumentTypeCode(type: string): string {
    const codeMap: Record<string, string> = {
      'article': 'J',
      'book': 'M',
      'conference': 'C',
      'thesis': 'D',
      'review': 'J',
      'chapter': 'M',
      'other': 'Z',
    };
    return codeMap[type] || 'J';
  }

  private generateCitationKey(lit: UnifiedLiterature): string {
    const firstAuthor = lit.authors[0]?.lastName || 'Unknown';
    const shortTitle = lit.title.slice(0, 20).replace(/\s+/g, '');
    return `${firstAuthor}${lit.year}${shortTitle}`;
  }
}
