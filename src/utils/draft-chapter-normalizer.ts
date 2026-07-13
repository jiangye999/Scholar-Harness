export interface NumberedDraftHeading {
  number: string;
  depth: number;
  title: string;
}

interface DraftSubsectionBlock {
  key: string;
  number: string;
  title: string;
  body: string;
  order: number;
}

export function parseNumberedDraftHeading(value: unknown): NumberedDraftHeading | null {
  const title = String(value || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .trim();
  const match = title.match(/^(\d+(?:\.\d+)+)(?:[.)、:：\s-]+|$)([\s\S]*)$/);
  if (!match) return null;
  const number = match[1];
  return {
    number,
    depth: number.split('.').length,
    title,
  };
}

export function isNumberedDraftSubsection(value: unknown): boolean {
  const parsed = parseNumberedDraftHeading(value);
  return !!parsed && parsed.depth > 1;
}

function compareHeadingNumbers(left: string, right: string): number {
  const leftParts = left.split('.').map(part => Number(part));
  const rightParts = right.split('.').map(part => Number(part));
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? -1) - (rightParts[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function normalizeNestedDraftSectionMarkup(content: unknown): string {
  return String(content || '').replace(
    /\\section(\*?)\{([^{}]+)\}/g,
    (fullMatch, _star: string, rawTitle: string) => {
      const title = String(rawTitle || '').trim();
      return isNumberedDraftSubsection(title)
        ? `\\subsection*{${title}}`
        : fullMatch;
    }
  );
}

export function normalizeDraftChapterContent(content: unknown): string {
  const normalized = normalizeNestedDraftSectionMarkup(content).trim();
  const headingPattern = /\\subsection\*?\{([^{}]+)\}\s*/g;
  const matches = Array.from(normalized.matchAll(headingPattern));
  if (matches.length === 0) return normalized;

  const firstHeadingIndex = matches[0].index ?? 0;
  const prefix = normalized.slice(0, firstHeadingIndex).trim();
  const blocks: DraftSubsectionBlock[] = [];
  const numberedBlockIndex = new Map<string, number>();
  const recoveredBodyParts: string[] = [];

  const recoverEmbeddedBody = (previousBody: string, nextBody: string) => {
    const previous = previousBody.trim();
    const next = nextBody.trim();
    if (!previous || !next || previous.length <= next.length || !previous.startsWith(next)) return;
    const tail = previous.slice(next.length).trim();
    if (tail.length < 80) return;
    const compactTail = tail.replace(/\s+/g, '');
    const compactPrefix = prefix.replace(/\s+/g, '');
    if (compactPrefix && (compactPrefix.includes(compactTail) || compactTail.includes(compactPrefix))) return;
    if (recoveredBodyParts.some(item => item.replace(/\s+/g, '') === compactTail)) return;
    recoveredBodyParts.push(tail);
  };

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextMatch = matches[index + 1];
    const start = (match.index ?? 0) + match[0].length;
    const end = nextMatch?.index ?? normalized.length;
    const title = String(match[1] || '').trim();
    const body = normalized.slice(start, end).trim();
    const numbered = parseNumberedDraftHeading(title);

    if (!numbered || numbered.depth < 2) {
      blocks.push({
        key: `unstructured-${index}`,
        number: '',
        title,
        body,
        order: index,
      });
      continue;
    }

    const existingIndex = numberedBlockIndex.get(numbered.number);
    const nextBlock: DraftSubsectionBlock = {
      key: numbered.number,
      number: numbered.number,
      title,
      body,
      order: index,
    };
    if (existingIndex === undefined) {
      numberedBlockIndex.set(numbered.number, blocks.length);
      blocks.push(nextBlock);
    } else {
      // Repeated numbered headings are revisions, not additional subsections.
      recoverEmbeddedBody(blocks[existingIndex].body, nextBlock.body);
      blocks[existingIndex] = nextBlock;
    }
  }

  blocks.sort((left, right) => {
    if (left.number && right.number) {
      return compareHeadingNumbers(left.number, right.number) || left.order - right.order;
    }
    return left.order - right.order;
  });

  const parts = [prefix, ...recoveredBodyParts].filter(Boolean);
  for (const block of blocks) {
    const heading = `\\subsection*{${block.title}}`;
    parts.push(block.body ? `${heading}\n${block.body}` : heading);
  }
  return parts.join('\n\n').trim();
}
