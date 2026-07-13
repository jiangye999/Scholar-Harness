interface ReferenceCitationMapping {
  year: string;
  originalAuthor: string;
  surname: string;
  useEtAl: boolean;
}

function extractReferenceSurname(referenceBody: string, year: string): string {
  const escapedYear = year.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const authorBlock = String(referenceBody || '')
    .split(new RegExp(`\\(${escapedYear}\\)`))[0]
    .replace(/^\s*(?:[-*•]\s*)?/, '')
    .trim();
  if (!authorBlock) return '';

  const commaSurname = authorBlock.split(',')[0]?.trim();
  if (commaSurname && /[A-Za-z]/.test(commaSurname)) return commaSurname;

  const firstAuthor = authorBlock.split(/;|\band\b|&/i)[0]?.trim() || authorBlock;
  const tokens = firstAuthor.split(/\s+/).filter(Boolean);
  return tokens[tokens.length - 1]?.replace(/^[^A-Za-z]+|[^A-Za-z'’-]+$/g, '') || '';
}

function bibliographyBodyContainsYear(referenceBody: string, year: string): boolean {
  const escapedYear = year.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(?:\\(${escapedYear}\\)|(?:^|[,.;])\\s*${escapedYear}(?=\\s*[,.;:]|\\s|$))`,
    'i',
  ).test(String(referenceBody || ''));
}

function collectReferenceCitationMappings(text: string): ReferenceCitationMapping[] {
  const mappings: ReferenceCitationMapping[] = [];
  const linePattern = /^\s*(?:[-*•]\s*)?[\[(]([^\])]+?),\s*((?:19|20)\d{2}[a-z]?)[\])]\s+(.+)$/gim;
  let match: RegExpExecArray | null;
  while ((match = linePattern.exec(String(text || ''))) !== null) {
    const originalAuthor = match[1].trim();
    const year = match[2].trim();
    const referenceBody = match[3];
    if (!bibliographyBodyContainsYear(referenceBody, year)) continue;
    const surname = extractReferenceSurname(referenceBody, year);
    if (!surname) continue;
    mappings.push({
      year,
      originalAuthor,
      surname,
      useEtAl: /\bet\s+al\.?/i.test(originalAuthor),
    });
  }
  return mappings;
}

export function stripBibliographyAuthorYearPrefixes(content: string): string {
  return String(content || '').replace(
    /^(\s*(?:[-*•]\s*)?)[\[(]\s*([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Za-z][A-Za-z'’.-]*)?(?:\s+et\s+al\.?)?)\s*,\s*((?:19|20)\d{2}[a-z]?)\s*[\])]\s+(.+)$/gim,
    (fullMatch, prefix: string, _authorLabel: string, year: string, referenceBody: string) => (
      bibliographyBodyContainsYear(referenceBody, year)
        ? `${prefix}${referenceBody}`
        : fullMatch
    ),
  );
}

function authorYearLabel(mapping: ReferenceCitationMapping): string {
  return `${mapping.surname}${mapping.useEtAl ? ' et al.' : ''}, ${mapping.year}`;
}

export function normalizeAuthorYearCitationText(content: string): string {
  let text = String(content || '');
  if (!text.trim()) return text;

  const mappings = collectReferenceCitationMappings(text);
  if (mappings.length === 0) {
    return stripBibliographyAuthorYearPrefixes(text.replace(
      /\[([A-Z][A-Za-z'’.-]*(?:\s+et\s+al\.?)?),\s*((?:19|20)\d{2}[a-z]?)\]/g,
      '($1, $2)'
    ));
  }

  const uniqueByYear = new Map<string, ReferenceCitationMapping | null>();
  for (const mapping of mappings) {
    const existing = uniqueByYear.get(mapping.year);
    if (!existing) {
      uniqueByYear.set(mapping.year, mapping);
    } else if (existing.surname.toLowerCase() !== mapping.surname.toLowerCase()) {
      uniqueByYear.set(mapping.year, null);
    }
  }

  for (const mapping of mappings) {
    const escapedAuthor = mapping.originalAuthor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedYear = mapping.year.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement = authorYearLabel(mapping);
    text = text.replace(
      new RegExp(`[\\[(]${escapedAuthor},\\s*${escapedYear}[\\])]`, 'gi'),
      `(${replacement})`
    );
    text = text.replace(
      new RegExp(`\\b${escapedAuthor},\\s*${escapedYear}\\b`, 'gi'),
      replacement
    );
  }

  text = text.replace(
    /\b([A-Z]{1,3})(\s+et\s+al\.?)?,\s*((?:19|20)\d{2}[a-z]?)\b/g,
    (fullMatch, _initials: string, etAl: string | undefined, year: string) => {
      const mapping = uniqueByYear.get(year);
      if (!mapping) return fullMatch;
      return `${mapping.surname}${etAl || mapping.useEtAl ? ' et al.' : ''}, ${year}`;
    }
  );

  return stripBibliographyAuthorYearPrefixes(text);
}
