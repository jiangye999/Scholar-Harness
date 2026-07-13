export interface DraftSubsectionTarget {
  id?: string;
  title: string;
  index?: number;
  number?: string;
}

interface DraftSubsectionRange {
  title: string;
  headingStart: number;
  bodyStart: number;
  bodyEnd: number;
}

function normalizeSubsectionIdentity(value: unknown): string {
  return String(value || '')
    .replace(/^\s*\d+(?:\.\d+)+(?:[.)、:：\s-]+|$)/, '')
    .replace(/\\[a-zA-Z]+\*?\{([^{}]*)\}/g, '$1')
    .replace(/^#{1,6}\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '')
    .trim();
}

function cleanSubsectionTitle(target: DraftSubsectionTarget): string {
  const rawTitle = String(target.title || '').trim();
  if (!rawTitle) throw new Error('缺少当前写作小节标题');
  const explicitNumber = String(target.number || '').trim();
  if (!explicitNumber || /^\d+(?:\.\d+)+/.test(rawTitle)) return rawTitle;
  return `${explicitNumber} ${rawTitle}`;
}

function findReferenceSectionStart(content: string): number {
  const patterns = [
    /\\section\*?\{\s*References\s*\}/i,
    /(?:^|\n)#{1,6}\s+(?:References|参考文献|尾注)\s*(?=\n|$)/i,
  ];
  let earliest = -1;
  for (const pattern of patterns) {
    const match = pattern.exec(content);
    if (match && (earliest < 0 || match.index < earliest)) earliest = match.index;
  }
  return earliest;
}

function collectSubsectionRanges(content: string): DraftSubsectionRange[] {
  const matches = Array.from(content.matchAll(/\\subsection\*?\{([^{}]+)\}\s*/g));
  const referenceStart = findReferenceSectionStart(content);
  return matches.map((match, index) => {
    const headingStart = match.index ?? 0;
    const bodyStart = headingStart + match[0].length;
    const nextHeadingStart = matches[index + 1]?.index ?? content.length;
    const bodyEnd = referenceStart >= bodyStart && referenceStart < nextHeadingStart
      ? referenceStart
      : nextHeadingStart;
    return {
      title: String(match[1] || '').trim(),
      headingStart,
      bodyStart,
      bodyEnd,
    };
  });
}

function mergeUniqueText(existing: string, incoming: string): string {
  const current = String(existing || '').trim();
  const next = String(incoming || '').trim();
  if (!current) return next;
  if (!next) return current;
  const currentCompact = current.replace(/\s+/g, '');
  const nextCompact = next.replace(/\s+/g, '');
  if (nextCompact && currentCompact.includes(nextCompact)) return current;
  if (currentCompact && nextCompact.includes(currentCompact)) return next;
  return `${current}\n\n${next}`;
}

export function extractDraftSubsectionContent(
  content: unknown,
  target: DraftSubsectionTarget,
): string {
  const text = String(content || '');
  const targetIdentity = normalizeSubsectionIdentity(target.title);
  const targetNumber = String(target.number || '').trim();
  const range = collectSubsectionRanges(text).find(item => {
    if (targetNumber && String(item.title).trim().startsWith(targetNumber)) return true;
    return normalizeSubsectionIdentity(item.title) === targetIdentity;
  });
  return range ? text.slice(range.bodyStart, range.bodyEnd).trim() : '';
}

export function upsertDraftSubsectionContent(
  existingContent: unknown,
  incomingContent: unknown,
  target: DraftSubsectionTarget,
  mode: 'merge' | 'replace' = 'merge',
): string {
  const existing = String(existingContent || '').trim();
  const incoming = String(incomingContent || '').trim();
  if (!incoming) return existing;

  const title = cleanSubsectionTitle(target);
  const targetIdentity = normalizeSubsectionIdentity(target.title);
  const targetNumber = String(target.number || '').trim();
  const ranges = collectSubsectionRanges(existing);
  const range = ranges.find(item => {
    if (targetNumber && String(item.title).trim().startsWith(targetNumber)) return true;
    return normalizeSubsectionIdentity(item.title) === targetIdentity;
  });

  if (range) {
    const currentBody = existing.slice(range.bodyStart, range.bodyEnd).trim();
    const nextBody = mode === 'replace' ? incoming : mergeUniqueText(currentBody, incoming);
    const before = existing.slice(0, range.bodyStart).replace(/\s+$/g, '');
    const after = existing.slice(range.bodyEnd).replace(/^\s+/g, '');
    return [before, nextBody, after].filter(Boolean).join('\n').trim();
  }

  const block = `\\subsection*{${title}}\n${incoming}`;
  if (!existing) return block;
  const referenceStart = findReferenceSectionStart(existing);
  if (referenceStart < 0) return `${existing}\n\n${block}`.trim();

  const beforeReferences = existing.slice(0, referenceStart).trim();
  const references = existing.slice(referenceStart).trim();
  return [beforeReferences, block, references].filter(Boolean).join('\n\n').trim();
}
