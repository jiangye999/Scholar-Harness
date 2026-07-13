export interface ReferenceTailnoteRecord {
  surname: string;
  year: string;
  authors: string;
  title: string;
  journal: string;
  doi: string;
}

interface InTextCitation {
  surname: string;
  year: string;
}

function normalizeKeyPart(value: string): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
}

function referenceKey(surname: string, year: string): string {
  return `${normalizeKeyPart(surname)}:${String(year || '').toLowerCase()}`;
}

function extractField(block: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(block || '').match(new RegExp(`^\\*\\*${escaped}\\*\\*\\s*[:：]\\s*(.+)$`, 'im'));
  return String(match?.[1] || '').trim();
}

function surnameFromAuthors(authors: string): string {
  const firstAuthor = String(authors || '').split(/;|\band\b|&/i)[0]?.trim() || '';
  if (!firstAuthor) return '';
  if (firstAuthor.includes(',')) return firstAuthor.split(',')[0].trim();
  const tokens = firstAuthor.split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1]?.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '') || '';
}

function surnameFromCitationLabel(label: string): string {
  const match = String(label || '').match(/^\(?\s*([A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)?)\s*(?:et\s+al\.?)?\s*,/i);
  return String(match?.[1] || '').trim();
}

function recordCompleteness(record: ReferenceTailnoteRecord): number {
  return [record.authors, record.title, record.journal, record.doi].filter(value => value && !/^unknown$/i.test(value)).length;
}

export function collectReferenceTailnoteRecords(sourceTexts: string[]): Map<string, ReferenceTailnoteRecord> {
  const records = new Map<string, ReferenceTailnoteRecord>();
  for (const sourceText of sourceTexts || []) {
    const text = String(sourceText || '');
    const headings = Array.from(text.matchAll(/^###\s+\[\d+\]\s+(.+)$/gim));
    for (let index = 0; index < headings.length; index++) {
      const heading = headings[index];
      const start = (heading.index || 0) + heading[0].length;
      const end = index + 1 < headings.length ? (headings[index + 1].index || text.length) : text.length;
      const block = text.slice(start, Math.min(end, start + 20_000));
      const title = String(heading[1] || '').trim();
      const citationLabel = extractField(block, '引用格式');
      const authors = extractField(block, '作者');
      const year = extractField(block, '年份').match(/(?:19|20)\d{2}[a-z]?/i)?.[0] || '';
      const journal = extractField(block, '期刊');
      const doi = extractField(block, 'DOI');
      const surname = surnameFromCitationLabel(citationLabel) || surnameFromAuthors(authors);
      if (!surname || !year || !title || /^unknown(?:\s+title)?$/i.test(title)) continue;
      const record: ReferenceTailnoteRecord = { surname, year, authors, title, journal, doi };
      const key = referenceKey(surname, year);
      const existing = records.get(key);
      if (!existing || recordCompleteness(record) > recordCompleteness(existing)) records.set(key, record);
    }
  }
  return records;
}

export function extractInTextCitations(content: string): InTextCitation[] {
  const citations: InTextCitation[] = [];
  const seen = new Set<string>();
  const parentheticalPattern = /\(([^()]{1,500})\)/g;
  let parenthetical: RegExpExecArray | null;
  while ((parenthetical = parentheticalPattern.exec(String(content || ''))) !== null) {
    const parts = parenthetical[1].split(/;/);
    for (const part of parts) {
      const match = part.trim().match(/^([A-Z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*)?)(\s+et\s+al\.?)?\s*,\s*((?:19|20)\d{2}[a-z]?)$/i);
      if (!match) continue;
      const surname = match[1].trim();
      const year = match[3].trim();
      const key = referenceKey(surname, year);
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({
        surname,
        year,
      });
    }
  }
  return citations;
}

function hasReferenceSection(content: string): boolean {
  return /(?:^|\n)\s*(?:#{1,6}\s*|\\section\*?\{)?(?:references|参考文献)(?:\})?\s*:?[ \t]*(?:\n|$)/im.test(String(content || ''));
}

export function appendVerifiedReferenceTailnotes(content: string, sourceTexts: string[]): string {
  const text = String(content || '').trimEnd();
  if (!text || hasReferenceSection(text)) return text;
  const citations = extractInTextCitations(text);
  if (citations.length === 0) return text;

  const records = collectReferenceTailnoteRecords(sourceTexts);
  const matchedCount = citations.filter(citation => records.has(referenceKey(citation.surname, citation.year))).length;
  if (matchedCount === 0) return text;

  const lines = citations.map(citation => {
    const record = records.get(referenceKey(citation.surname, citation.year));
    if (!record) return '';
    const authors = record.authors && !/^unknown$/i.test(record.authors) ? record.authors : record.surname;
    const journal = record.journal && !/^unknown$/i.test(record.journal) ? ` ${record.journal}.` : '';
    const doi = record.doi && !/^unknown$/i.test(record.doi) ? ` DOI: ${record.doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')}.` : '';
    return `- ${authors}. (${record.year}). ${record.title}.${journal}${doi}`.replace(/\.\./g, '.');
  }).filter(Boolean);

  return `${text}\n\n## References\n\n${lines.join('\n')}`;
}
