import type { UnifiedLiterature, MetadataFilters } from '../../types/literature';

interface IndexedDocument {
  id: string;
  year: number;
  authors: string[];
  journal: string;
  categories: string[];
  documentType: string;
}

export class MetadataFilter {
  private documents: Map<string, IndexedDocument> = new Map();

  index(literatures: UnifiedLiterature[]): void {
    for (const lit of literatures) {
      this.documents.set(lit.id, {
        id: lit.id,
        year: lit.year,
        authors: lit.authors.map(a => a.name.toLowerCase()),
        journal: lit.journal.toLowerCase(),
        categories: (lit.categories || []).map(c => c.toLowerCase()),
        documentType: lit.documentType,
      });
    }
  }

  addDocument(lit: UnifiedLiterature): void {
    this.documents.set(lit.id, {
      id: lit.id,
      year: lit.year,
      authors: lit.authors.map(a => a.name.toLowerCase()),
      journal: lit.journal.toLowerCase(),
      categories: (lit.categories || []).map(c => c.toLowerCase()),
      documentType: lit.documentType,
    });
  }

  filter(filters: MetadataFilters): Set<string> {
    const results: Set<string> = new Set();

    for (const [id, doc] of this.documents) {
      if (this.matchesFilters(doc, filters)) {
        results.add(id);
      }
    }

    return results;
  }

  filterDocuments(docIds: string[], filters: MetadataFilters): string[] {
    return docIds.filter(id => {
      const doc = this.documents.get(id);
      if (!doc) return false;
      return this.matchesFilters(doc, filters);
    });
  }

  private matchesFilters(doc: IndexedDocument, filters: MetadataFilters): boolean {
    if (filters.yearFrom !== undefined && doc.year < filters.yearFrom) {
      return false;
    }

    if (filters.yearTo !== undefined && doc.year > filters.yearTo) {
      return false;
    }

    if (filters.authors && filters.authors.length > 0) {
      const authorMatch = filters.authors.some(author =>
        doc.authors.some(a => a.includes(author.toLowerCase()))
      );
      if (!authorMatch) return false;
    }

    if (filters.journals && filters.journals.length > 0) {
      const journalMatch = filters.journals.some(journal =>
        doc.journal.includes(journal.toLowerCase())
      );
      if (!journalMatch) return false;
    }

    if (filters.categories && filters.categories.length > 0) {
      const categoryMatch = filters.categories.some(category =>
        doc.categories.some(c => c.includes(category.toLowerCase()))
      );
      if (!categoryMatch) return false;
    }

    if (filters.documentTypes && filters.documentTypes.length > 0) {
      if (!filters.documentTypes.includes(doc.documentType as any)) {
        return false;
      }
    }

    return true;
  }

  getStatistics(): {
    totalCount: number;
    yearRange: { min: number; max: number };
    topJournals: Array<{ name: string; count: number }>;
    topAuthors: Array<{ name: string; count: number }>;
  } {
    const years: number[] = [];
    const journalCounts: Map<string, number> = new Map();
    const authorCounts: Map<string, number> = new Map();

    for (const doc of this.documents.values()) {
      if (doc.year > 0) years.push(doc.year);
      
      journalCounts.set(doc.journal, (journalCounts.get(doc.journal) || 0) + 1);
      
      for (const author of doc.authors) {
        authorCounts.set(author, (authorCounts.get(author) || 0) + 1);
      }
    }

    const sortedJournals = Array.from(journalCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const sortedAuthors = Array.from(authorCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    return {
      totalCount: this.documents.size,
      yearRange: {
        min: years.length > 0 ? Math.min(...years) : 0,
        max: years.length > 0 ? Math.max(...years) : 0,
      },
      topJournals: sortedJournals,
      topAuthors: sortedAuthors,
    };
  }

  clear(): void {
    this.documents.clear();
  }
}
