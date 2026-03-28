import type { UnifiedLiterature, Author, FormattedReference } from '../../../types/literature';

export class APAFormatter {
  format(lit: UnifiedLiterature, numericId?: number): FormattedReference {
    const authors = this.formatAuthors(lit.authors);
    const title = lit.title;
    const year = lit.year || 'n.d.';
    const journal = lit.journal;
    const volume = lit.volume || '';
    const issue = lit.issue ? `(${lit.issue})` : '';
    const pages = lit.pages || '';
    const doi = lit.doi;

    let formatted = '';

    if (lit.documentType === 'article' || lit.documentType === 'review') {
      const volIssue = volume ? `, ${volume}${issue}` : '';
      const pageStr = pages ? `, ${pages}` : '';
      const doiStr = doi ? ` https://doi.org/${doi}` : '';
      
      formatted = `${authors} (${year}). ${title}. ${journal}${volIssue}${pageStr}.${doiStr}`;
    } else if (lit.documentType === 'book') {
      formatted = `${authors} (${year}). ${title}. ${journal}.`;
    } else if (lit.documentType === 'conference') {
      formatted = `${authors} (${year}). ${title}. In ${journal}.`;
    } else {
      formatted = `${authors} (${year}). ${title}. ${journal}.`;
    }

    const citationKey = this.generateCitationKey(lit);

    return {
      id: lit.id,
      numericId,
      citationKey,
      formatted: formatted.trim(),
      style: 'apa',
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

    if (authors.length === 1) {
      return this.formatAuthor(authors[0]);
    } else if (authors.length === 2) {
      return `${this.formatAuthor(authors[0])} & ${this.formatAuthor(authors[1])}`;
    } else if (authors.length <= 20) {
      const allButLast = authors.slice(0, -1).map(a => this.formatAuthor(a));
      const last = this.formatAuthor(authors[authors.length - 1]);
      return `${allButLast.join(', ')}, & ${last}`;
    } else {
      const first19 = authors.slice(0, 19).map(a => this.formatAuthor(a));
      const last = this.formatAuthor(authors[authors.length - 1]);
      return `${first19.join(', ')}, ... ${last}`;
    }
  }

  private formatAuthor(author: Author): string {
    if (author.lastName) {
      const initials = author.firstName
        ? author.firstName.split(/[\s\.]+/).map(n => n[0]?.toUpperCase()).filter(Boolean).join('. ')
        : '';
      return `${author.lastName}, ${initials}.`;
    }
    return author.name;
  }

  private generateCitationKey(lit: UnifiedLiterature): string {
    const firstAuthor = lit.authors[0]?.lastName || 'Unknown';
    return `${firstAuthor}${lit.year}`;
  }
}
