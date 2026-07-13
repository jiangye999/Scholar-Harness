import { normalizeDraftChapterContent } from './draft-chapter-normalizer';

export type DraftSaveMode = 'merge' | 'replace';

export interface EmbeddedTitleDraftParts {
  title: string;
  abstract: string;
}

interface DraftReferenceParts {
  body: string;
  heading: string;
  references: string;
}

const REFERENCE_HEADING_PATTERN = /(?:^|\n)([ \t]*(?:#{1,6}[ \t]*(?:references?|参考文献)[ \t]*|\\(?:sub)*section\*?\{(?:references?|参考文献)\}))[ \t]*(?:\r?\n|$)/im;

function splitDraftReferences(content: string): DraftReferenceParts {
  const normalized = String(content || '').trim();
  const match = REFERENCE_HEADING_PATTERN.exec(normalized);
  if (!match || match.index === undefined) {
    return { body: normalized, heading: '', references: '' };
  }

  const headingStart = match.index + (match[0].startsWith('\n') ? 1 : 0);
  const headingEnd = match.index + match[0].length;
  return {
    body: normalized.slice(0, headingStart).trim(),
    heading: String(match[1] || '').trim(),
    references: normalized.slice(headingEnd).trim(),
  };
}

function compactDraftContent(content: string): string {
  return String(content || '')
    .replace(/\s+/g, '')
    .replace(/[，。,.；;：:、"'“”‘’`*_#>-]/g, '');
}

export function extractEmbeddedTitleFromAbstractDraft(content: unknown): EmbeddedTitleDraftParts | null {
  const text = String(content || '').trim();
  const match = text.match(
    /^\s*(?:#{1,6}\s*)?(?:title|标题|题目)\s*[:：]?\s*\r?\n+([\s\S]{3,600}?)\r?\n+(?:#{1,6}\s*)?(?:abstract|摘要)\s*[:：]?\s*\r?\n+([\s\S]+)$/i
  );
  if (!match) return null;
  const title = String(match[1] || '').trim();
  const abstract = String(match[2] || '').trim();
  if (!title || !abstract || /\r?\n\s*\r?\n/.test(title)) return null;
  return { title, abstract };
}

export function mergeDraftBodyUnique(existing: string, incoming: string): string {
  const current = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!current) return next;
  if (!next) return current;

  const currentCompact = compactDraftContent(current);
  const nextCompact = compactDraftContent(next);
  if (nextCompact && currentCompact.includes(nextCompact)) return current;
  if (currentCompact && nextCompact.includes(currentCompact)) return next;
  return `${current}\n\n${next}`;
}

function mergeReferenceLines(existing: string, incoming: string): string {
  const lines = [...String(existing || '').split(/\r?\n/), ...String(incoming || '').split(/\r?\n/)];
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const identity = trimmed
      .replace(/^[-*•]\s*/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    merged.push(trimmed);
  }
  return merged.join('\n');
}

export function mergeDraftChapterContent(
  existing: string,
  incoming: string,
  mode: DraftSaveMode = 'merge'
): string {
  const next = normalizeDraftChapterContent(incoming);
  if (mode === 'replace') return next;

  const current = normalizeDraftChapterContent(existing);
  const currentParts = splitDraftReferences(current);
  const nextParts = splitDraftReferences(next);
  const body = normalizeDraftChapterContent(mergeDraftBodyUnique(currentParts.body, nextParts.body));
  const references = mergeReferenceLines(currentParts.references, nextParts.references);
  const heading = currentParts.heading || nextParts.heading || '## References';

  return [body, references ? `${heading}\n${references}` : '']
    .filter(Boolean)
    .join('\n\n')
    .trim();
}
