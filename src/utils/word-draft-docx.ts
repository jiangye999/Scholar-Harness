import type { Response } from "express";
import archiver from "archiver";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { logger } from "./logger";

interface WordReferenceEntry {
  id?: string;
  key?: string;
  raw: string;
  citation: string;
}

type WordDraftBlock =
  | { type: 'heading'; level: 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'references'; references: WordReferenceEntry[] };

export interface WordReferenceExtraction {
  body: string;
  references: string;
  trailingBody: string;
}

interface WordDraftBlockOptions {
  includeUncitedReferences?: boolean;
  appendParagraphReferences?: boolean;
}

interface WordDraftSections {
  documentTitle: string;
  sections: Array<{ title: string; content: string }>;
}

interface WordParagraphOptions {
  style?: string;
  alignment?: 'left' | 'center' | 'both';
  before?: number;
  after?: number;
  line?: number;
  keepNext?: boolean;
  bold?: boolean;
  sizeHalfPoints?: number;
}

function escapeHtmlForWord(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeTextWithWordFonts(value: string): string {
  return escapeHtmlForWord(value);
}

function escapeXmlForWord(value: string): string {
  return value
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripLatexPreambleForWord(content: string): string {
  let text = content.replace(/\r\n/g, '\n');

  if (text.includes('\\begin{document}')) {
    text = text.split('\\begin{document}')[1] || text;
  }

  if (text.includes('\\end{document}')) {
    text = text.split('\\end{document}')[0];
  }

  return text
    .replace(/\\maketitle/g, '')
    .replace(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/gi, '\n\n## Abstract\n\n$1\n\n')
    .trim();
}

function normalizePlainScriptCharactersForWord(value: string): string {
  const scriptMap: Record<string, string> = {
    '⁰': '0',
    '¹': '1',
    '²': '2',
    '³': '3',
    '⁴': '4',
    '⁵': '5',
    '⁶': '6',
    '⁷': '7',
    '⁸': '8',
    '⁹': '9',
    '⁺': '+',
    '⁻': '-',
    '⁼': '=',
    '⁽': '(',
    '⁾': ')',
    'ⁿ': 'n',
    '₀': '0',
    '₁': '1',
    '₂': '2',
    '₃': '3',
    '₄': '4',
    '₅': '5',
    '₆': '6',
    '₇': '7',
    '₈': '8',
    '₉': '9',
    '₊': '+',
    '₋': '-',
    '₌': '=',
    '₍': '(',
    '₎': ')'
  };

  return value.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿ₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎]/g, char => scriptMap[char] || char);
}

function cleanLatexInlineForWord(value: string): string {
  let text = normalizePlainScriptCharactersForWord(value);

  const unwrapCommands = ['textbf', 'textit', 'emph', 'underline', 'text', 'textsuperscript', 'textsubscript'];
  for (const command of unwrapCommands) {
    const pattern = new RegExp(`\\\\${command}\\{([^{}]*)\\}`, 'g');
    let previous: string;
    do {
      previous = text;
      text = text.replace(pattern, '$1');
    } while (text !== previous);
  }

  text = text
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(/([_^])\{([^{}]*)\}/g, '$2')
    .replace(/([_^])([A-Za-z0-9+\-=]+)/g, '$2')
    .replace(/\\url\{([^{}]*)\}/g, '$1')
    .replace(/\\href\{[^{}]*\}\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?(?:\[[^\]]*\])?\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}]/g, '')
    .replace(/[ \t]+/g, ' ')
    .trim();

  return normalizePlainScriptCharactersForWord(text);
}

function cleanReferenceTextForWord(value: string): string {
  return cleanLatexInlineForWord(value)
    .replace(/^[-*]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitDraftForWord(content: string): WordDraftSections {
  let text = stripLatexPreambleForWord(content);
  const titleMatch = text.match(/\\(?:title|paperTitle)\{([^{}]+)\}/i);
  const documentTitle = titleMatch ? cleanLatexInlineForWord(titleMatch[1]) : '';
  if (titleMatch) {
    text = text.replace(titleMatch[0], '').trim();
  }

  const sectionRegex = /\\section\{([^}]+)\}/g;
  const sections: Array<{ title: string; content: string }> = [];
  let currentTitle = '论文草稿';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sectionRegex.exec(text)) !== null) {
    const previousContent = text.slice(lastIndex, match.index).trim();
    if (previousContent) {
      sections.push({ title: currentTitle, content: previousContent });
    }
    currentTitle = cleanLatexInlineForWord(match[1]) || '论文草稿';
    lastIndex = sectionRegex.lastIndex;
  }

  const trailingContent = text.slice(lastIndex).trim();
  if (trailingContent) {
    sections.push({ title: currentTitle, content: trailingContent });
  }

  if (sections.length === 0 && text.trim()) {
    sections.push({ title: '论文草稿', content: text.trim() });
  }

  return { documentTitle, sections };
}

function splitDraftSectionsForWord(content: string): Array<{ title: string; content: string }> {
  return splitDraftForWord(content).sections;
}

function getLastDoiMatchForWord(value: string): { start: number; end: number } | null {
  const doiRegex = /\b(?:doi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?10\.\d{4,9}\/[^\s]+/gi;
  let match: RegExpExecArray | null;
  let last: { start: number; end: number } | null = null;

  while ((match = doiRegex.exec(value)) !== null) {
    last = {
      start: match.index,
      end: match.index + match[0].length
    };
  }

  return last;
}

function getSentenceBoundaryIndexesForWord(value: string): number[] {
  const indexes: number[] = [];
  const boundaryRegex = /[.。](?=\s+[\u3400-\u9fffA-Z])/g;
  let match: RegExpExecArray | null;

  while ((match = boundaryRegex.exec(value)) !== null) {
    indexes.push(match.index + match[0].length);
  }

  return indexes;
}

function isReferenceStartForWord(value: string): boolean {
  return /^(?:\\bibitem\{|\[\d+\]|\d+[.、])\s*/.test(value.replace(/^[-*]\s*/, '').trim());
}

function looksLikeCompleteReferenceForWord(value: string): boolean {
  const text = cleanReferenceTextForWord(value);
  if (!text) return false;

  const hasYear = /\b(?:19|20)\d{2}[a-z]?\b/i.test(text);
  const hasDoi = /\b10\.\d{4,9}\//i.test(text);
  const hasLiteratureType = /\[(?:J|M|C|D|R|S|P|N|EB\/OL|J\/OL|OL)\]/i.test(text);
  const hasVolumeIssueOrPages = /(?:\b\d+\s*\(\s*\d+\s*\)|\b\d+\s*[,，]\s*\d+|\b\d+\s*[:：]\s*[A-Za-z0-9]+|\bpp?\.?\s*\d+)/i.test(text);
  const hasJournalSeparators = /[Jj]ournal|[Pp]roceedings|[Ww]ater|[Nn]ature|[Ss]cience|[Aa]griculture|[Ee]nvironment|[Ss]oil/.test(text);
  const sentenceEndCount = (text.match(/[.。]/g) || []).length;

  return text.length >= 35 && hasYear && (
    hasDoi
    || hasLiteratureType
    || hasVolumeIssueOrPages
    || (hasJournalSeparators && sentenceEndCount >= 2)
    || sentenceEndCount >= 3
  );
}

function looksLikeProseBodyForWord(value: string): boolean {
  const text = cleanLatexInlineForWord(value)
    .replace(/\s+/g, ' ')
    .trim();

  if (!text || isReferenceStartForWord(text)) return false;
  if (/^(?:doi|https?:\/\/|www\.)/i.test(text)) return false;

  const hasSentencePunctuation = /[.。!?！？]/.test(text);
  const hasAuthorYearCitation = /\([A-Z][A-Za-z'’.-]*(?:\s+et\s+al\.?)?,\s*(?:19|20)\d{2}[a-z]?\)/.test(text)
    || /（[^）]*(?:19|20)\d{2}[a-z]?[^）]*）/.test(text);
  const tokenCount = (text.match(/[A-Za-z]+|[\u3400-\u9fff]/g) || []).length;

  return hasSentencePunctuation && (
    (hasAuthorYearCitation && text.length >= 40)
    || text.length >= 80
    || tokenCount >= 18
  );
}

function findReferenceBodyBoundaryForWord(value: string): number | null {
  const doiMatch = getLastDoiMatchForWord(value);
  if (doiMatch) {
    const trailingBody = value.slice(doiMatch.end).replace(/^[\s.。;；,，:：]+/, '').trim();
    if (looksLikeProseBodyForWord(trailingBody)) {
      return doiMatch.end;
    }
  }

  for (const boundary of getSentenceBoundaryIndexesForWord(value)) {
    const reference = value.slice(0, boundary).trim();
    const trailingBody = value.slice(boundary).replace(/^[\s.。;；,，:：]+/, '').trim();

    if (looksLikeCompleteReferenceForWord(reference) && looksLikeProseBodyForWord(trailingBody)) {
      return boundary;
    }
  }

  return null;
}

function splitInlineReferenceTailForWord(value: string): { reference: string; trailingBody: string } {
  const boundary = findReferenceBodyBoundaryForWord(value);
  if (boundary === null) {
    return { reference: value, trailingBody: '' };
  }

  const reference = value.slice(0, boundary).trim();
  const trailingBody = value.slice(boundary).replace(/^[\s.。;；,，:：]+/, '').trim();
  return { reference, trailingBody };
}

function lineEndsWithReferenceTerminalForWord(value: string): boolean {
  if (!looksLikeCompleteReferenceForWord(value)) return false;

  const boundary = findReferenceBodyBoundaryForWord(value);
  return boundary === null;
}

function splitReferenceBlockForWord(referenceBlock: string): { references: string; trailingBody: string } {
  const normalized = referenceBlock.replace(/\r\n/g, '\n').trim();
  if (!normalized) {
    return { references: '', trailingBody: '' };
  }

  const referenceLines: string[] = [];
  const bodyLines: string[] = [];
  let inTrailingBody = false;
  let previousReferenceLooksComplete = false;

  for (const line of normalized.split('\n')) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    if (inTrailingBody) {
      bodyLines.push(trimmedLine);
      continue;
    }

    if (!isReferenceStartForWord(trimmedLine) && previousReferenceLooksComplete && looksLikeProseBodyForWord(trimmedLine)) {
      bodyLines.push(trimmedLine);
      inTrailingBody = true;
      continue;
    }

    const split = splitInlineReferenceTailForWord(trimmedLine);
    referenceLines.push(split.reference);

    if (split.trailingBody) {
      bodyLines.push(split.trailingBody);
      inTrailingBody = true;
      previousReferenceLooksComplete = false;
    } else {
      previousReferenceLooksComplete = lineEndsWithReferenceTerminalForWord(trimmedLine);
    }
  }

  return {
    references: referenceLines.join('\n').trim(),
    trailingBody: bodyLines.join('\n\n').trim()
  };
}

export function extractReferenceBlockForWord(sectionContent: string): WordReferenceExtraction {
  let body = sectionContent;
  let references = '';
  let trailingBody = '';

  const bibliographyRegex = /\\begin\{thebibliography\}\{[^}]*\}([\s\S]*?)\\end\{thebibliography\}/i;
  const bibliographyMatch = body.match(bibliographyRegex);
  if (bibliographyMatch) {
    const split = splitReferenceBlockForWord(bibliographyMatch[1]);
    references = [references, split.references].filter(Boolean).join('\n');
    trailingBody = [trailingBody, split.trailingBody].filter(Boolean).join('\n\n');
    body = body.replace(bibliographyMatch[0], '\n');
  }

  const latexRefHeading = body.match(/\\section\*\{(?:References|参考文献|Bibliography)\}/i);
  const markdownRefHeading = body.match(/(?:^|\n)\s*(?:#{1,6}\s*)?(?:参考文献|References|Bibliography)\s*:?\s*\n/i);
  const refHeading = latexRefHeading || markdownRefHeading;

  if (refHeading && typeof refHeading.index === 'number') {
    const headingStart = refHeading.index;
    const headingEnd = headingStart + refHeading[0].length;
    const split = splitReferenceBlockForWord(body.slice(headingEnd));
    references = [references, split.references].filter(Boolean).join('\n');
    trailingBody = [trailingBody, split.trailingBody].filter(Boolean).join('\n\n');
    body = body.slice(0, headingStart).trim();
  }

  return {
    body: body.trim(),
    references: references.trim(),
    trailingBody: trailingBody.trim()
  };
}

function getReferenceId(raw: string, fallbackIndex: number): string {
  const bracketMatch = raw.match(/^\s*\[(\d+)\]/);
  if (bracketMatch) return bracketMatch[1];

  const numericMatch = raw.match(/^\s*(\d+)[.、]/);
  if (numericMatch) return numericMatch[1];

  return String(fallbackIndex + 1);
}

function getEnglishSurname(authorName: string): string {
  const clean = authorName
    .replace(/\bet\s+al\.?/ig, '')
    .replace(/[^\w\s'.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!clean) return 'Unknown';

  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length === 1) return tokens[0];

  const secondTokenLooksLikeInitial = /^[A-Z]\.?$/i.test(tokens[1]) || /^[A-Z]{1,3}$/i.test(tokens[1]);
  if (secondTokenLooksLikeInitial) {
    return tokens[0];
  }

  return tokens[tokens.length - 1];
}

function buildAuthorYearCitationForWord(reference: string): string {
  const text = cleanReferenceTextForWord(reference);
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : 'n.d.';
  const withoutNumber = text.replace(/^(\[\d+\]|\d+[.、])\s*/, '').trim();
  const authorsSegment = (withoutNumber.split(/[.。]/)[0] || withoutNumber.slice(0, yearMatch?.index || 80)).trim();
  const hasEtAl = /\bet\s+al\.?\b/i.test(authorsSegment) || /等/.test(authorsSegment);
  const authorNames = authorsSegment
    .split(/,|，|;|；|、|\band\b|和/)
    .map(author => author.trim())
    .filter(author => author && !/\bet\s+al\.?\b/i.test(author) && author !== '等');

  const firstAuthor = authorNames[0] || authorsSegment || 'Unknown';

  if (/[\u3400-\u9fff]/.test(firstAuthor)) {
    const chineseName = firstAuthor.match(/[\u3400-\u9fff]{2,4}/)?.[0] || firstAuthor;
    const suffix = hasEtAl || authorNames.length > 1 ? '等' : '';
    return `(${chineseName}${suffix}, ${year})`;
  }

  const surname = getEnglishSurname(firstAuthor);
  const suffix = hasEtAl || authorNames.length > 1 ? ' et al.' : '';
  return `(${surname}${suffix}, ${year})`;
}

function parseReferenceEntriesForWord(referenceBlock: string): WordReferenceEntry[] {
  const block = referenceBlock
    .replace(/\r\n/g, '\n')
    .replace(/\\begin\{thebibliography\}\{[^}]*\}/gi, '')
    .replace(/\\end\{thebibliography\}/gi, '')
    .trim();

  if (!block) return [];

  const entries: WordReferenceEntry[] = [];
  const bibitemRegex = /\\bibitem\{([^}]+)\}\s*([\s\S]*?)(?=\\bibitem\{|$)/g;
  let bibMatch: RegExpExecArray | null;
  let bibIndex = 0;

  while ((bibMatch = bibitemRegex.exec(block)) !== null) {
    const raw = cleanReferenceTextForWord(bibMatch[2]);
    if (raw) {
      entries.push({
        id: String(bibIndex + 1),
        key: bibMatch[1].trim(),
        raw,
        citation: buildAuthorYearCitationForWord(raw)
      });
      bibIndex++;
    }
  }

  if (entries.length > 0) {
    return entries;
  }

  const lines = block
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const hasNumberedEntries = lines.some(line => /^(\[\d+\]|\d+[.、])\s*/.test(line.replace(/^[-*]\s*/, '').trim()));
  if (!hasNumberedEntries) {
    return lines
      .map((raw, index) => ({
        id: String(index + 1),
        raw: cleanReferenceTextForWord(raw),
        citation: buildAuthorYearCitationForWord(raw)
      }))
      .filter(entry => !!entry.raw);
  }

  const rawEntries: string[] = [];
  let current = '';

  for (const line of lines) {
    const cleanLine = line.replace(/^[-*]\s*/, '').trim();
    const startsNewEntry = /^(\[\d+\]|\d+[.、])\s*/.test(cleanLine);

    if (startsNewEntry && current) {
      rawEntries.push(current.trim());
      current = cleanLine;
    } else {
      current = [current, cleanLine].filter(Boolean).join(' ');
    }
  }

  if (current) {
    rawEntries.push(current.trim());
  }

  return rawEntries
    .map((raw, index) => ({
      id: getReferenceId(raw, index),
      raw: cleanReferenceTextForWord(raw),
      citation: buildAuthorYearCitationForWord(raw)
    }))
    .filter(entry => !!entry.raw);
}

function expandCitationIdsForWord(value: string): string[] {
  const ids: string[] = [];
  const parts = value.split(/[,，;；、]/).map(part => part.trim()).filter(Boolean);

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 20) {
        for (let i = start; i <= end; i++) {
          ids.push(String(i));
        }
      }
    } else if (/^\d+$/.test(part)) {
      ids.push(part);
    }
  }

  return [...new Set(ids)];
}

function joinReferenceCitationsForWord(entries: WordReferenceEntry[]): string {
  const uniqueCitations = [...new Set(entries.map(entry => entry.citation).filter(Boolean))];
  if (uniqueCitations.length === 0) return '';
  return `(${uniqueCitations.map(citation => citation.replace(/^\(|\)$/g, '')).join('; ')})`;
}

function replaceCitationsForWord(text: string, references: WordReferenceEntry[]): string {
  const byId = new Map<string, WordReferenceEntry>();
  const byKey = new Map<string, WordReferenceEntry>();

  references.forEach(reference => {
    if (reference.id) byId.set(reference.id, reference);
    if (reference.key) byKey.set(reference.key, reference);
  });

  let converted = text.replace(/\\cite[pt]?\{([^}]+)\}/g, (_match, keys: string) => {
    const entries = keys
      .split(',')
      .map(key => byKey.get(key.trim()) || byId.get(key.trim()))
      .filter((entry): entry is WordReferenceEntry => !!entry);

    return entries.length > 0 ? joinReferenceCitationsForWord(entries) : _match;
  });

  return converted;
}

function collectParagraphReferencesForWord(rawParagraph: string, convertedParagraph: string, references: WordReferenceEntry[]): WordReferenceEntry[] {
  const byId = new Map<string, WordReferenceEntry>();
  const byKey = new Map<string, WordReferenceEntry>();
  const used = new Map<string, WordReferenceEntry>();

  references.forEach(reference => {
    if (reference.id) byId.set(reference.id, reference);
    if (reference.key) byKey.set(reference.key, reference);
  });

  rawParagraph.replace(/\[(\d+(?:\s*[-–]\s*\d+)?(?:\s*[,，;；、]\s*\d+(?:\s*[-–]\s*\d+)?)*)\]/g, (_match, rawIds: string) => {
    expandCitationIdsForWord(rawIds).forEach(id => {
      const entry = byId.get(id);
      if (entry) used.set(entry.id || entry.citation, entry);
    });
    return _match;
  });

  rawParagraph.replace(/\\cite[pt]?\{([^}]+)\}/g, (_match, keys: string) => {
    keys.split(',').map(key => key.trim()).forEach(key => {
      const entry = byKey.get(key) || byId.get(key);
      if (entry) used.set(entry.key || entry.id || entry.citation, entry);
    });
    return _match;
  });

  references.forEach(entry => {
    if (convertedParagraph.includes(entry.citation)) {
      used.set(entry.id || entry.key || entry.citation, entry);
    }
  });

  return Array.from(used.values());
}

function renderParagraphReferencesForWord(references: WordReferenceEntry[]): string {
  if (references.length === 0) return '';

  const items = references.map(reference =>
    `<p class="ref-item">${escapeTextWithWordFonts(reference.raw)}</p>`
  ).join('\n');

  return `<p class="blank-line">&nbsp;</p>
<div class="paragraph-references">
<p class="ref-title">${escapeTextWithWordFonts('参考文献：')}</p>
${items}
</div>`;
}

function buildWordDraftBlocks(
  body: string,
  references: WordReferenceEntry[],
  options: WordDraftBlockOptions = {}
): WordDraftBlock[] {
  const includeUncitedReferences = options.includeUncitedReferences ?? true;
  const appendParagraphReferences = options.appendParagraphReferences ?? true;
  const normalizedBody = body
    .replace(/\\subsection\{([^}]+)\}/g, '\n\n## $1\n\n')
    .replace(/\\subsubsection\{([^}]+)\}/g, '\n\n### $1\n\n')
    .replace(/\\paragraph\{([^}]+)\}/g, '\n\n#### $1\n\n')
    .replace(/\r\n/g, '\n')
    .trim();

  const blocks = normalizedBody.split(/\n{2,}/).map(block => block.trim()).filter(Boolean);
  const rendered: WordDraftBlock[] = [];
  const usedReferenceKeys = new Set<string>();

  for (const block of blocks) {
    const headingMatch = block.match(/^(#{2,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length === 2 ? 2 : 3;
      rendered.push({
        type: 'heading',
        level,
        text: cleanLatexInlineForWord(headingMatch[2])
      });
      continue;
    }

    const rawParagraph = block.replace(/\n+/g, ' ').trim();
    const convertedParagraph = cleanLatexInlineForWord(replaceCitationsForWord(rawParagraph, references));
    if (!convertedParagraph) continue;

    rendered.push({ type: 'paragraph', text: convertedParagraph });

    const paragraphReferences = collectParagraphReferencesForWord(rawParagraph, convertedParagraph, references);
    paragraphReferences.forEach(reference => {
      usedReferenceKeys.add(reference.id || reference.key || reference.citation);
    });
    if (appendParagraphReferences && paragraphReferences.length > 0) {
      rendered.push({ type: 'references', references: paragraphReferences });
    }
  }

  const uncitedReferences = references.filter(reference => !usedReferenceKeys.has(reference.id || reference.key || reference.citation));
  if (includeUncitedReferences && uncitedReferences.length > 0) {
    rendered.push({ type: 'references', references: uncitedReferences });
  }

  return rendered;
}

function renderSectionBodyForWord(
  body: string,
  references: WordReferenceEntry[],
  options: WordDraftBlockOptions = {}
): string {
  return buildWordDraftBlocks(body, references, options)
    .map(block => {
      if (block.type === 'heading') {
        const level = block.level === 2 ? 'h2' : 'h3';
        return `<${level}>${escapeTextWithWordFonts(block.text)}</${level}>`;
      }

      if (block.type === 'paragraph') {
        return `<p>${escapeTextWithWordFonts(block.text)}</p>`;
      }

      return renderParagraphReferencesForWord(block.references);
    })
    .filter(Boolean)
    .join('\n');
}

function buildWordDraftHtml(content: string): string {
  const draft = splitDraftForWord(content);
  const sections = draft.sections;
  const documentTitleHtml = draft.documentTitle
    ? `<h1 class="document-title">${escapeTextWithWordFonts(draft.documentTitle)}</h1>`
    : '';
  const sectionHtml = sections.map(section => {
    const extracted = extractReferenceBlockForWord(section.content);
    const references = parseReferenceEntriesForWord(extracted.references);
    const sectionTitle = cleanLatexInlineForWord(section.title);
    const titleHtml = sectionTitle ? `<h1>${escapeTextWithWordFonts(sectionTitle)}</h1>` : '';
    const bodyHtmlParts = [renderSectionBodyForWord(extracted.body, references)];
    if (extracted.trailingBody) {
      bodyHtmlParts.push('<p class="blank-line">&nbsp;</p>');
      bodyHtmlParts.push(renderSectionBodyForWord(extracted.trailingBody, references, {
        includeUncitedReferences: false,
        appendParagraphReferences: false
      }));
    }
    const bodyHtml = bodyHtmlParts.filter(Boolean).join('\n');
    return `<section class="section">${titleHtml}\n${bodyHtml}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="UTF-8">
<title>论文草稿</title>
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
@page WordSection1 { size: 595.3pt 841.9pt; margin: 72pt 72pt 72pt 72pt; }
body {
  font-family: "Times New Roman", serif;
  mso-ascii-font-family: "Times New Roman";
  mso-hansi-font-family: "Times New Roman";
  mso-fareast-font-family: "Times New Roman";
  font-size: 12pt;
  line-height: 1.6;
  color: #000;
}
.section {
  page: WordSection1;
  margin-bottom: 18pt;
}
h1 {
  font-family: "Times New Roman", serif;
  mso-fareast-font-family: "Times New Roman";
  font-size: 16pt;
  font-weight: bold;
  margin: 18pt 0 12pt 0;
}
.document-title {
  text-align: center;
  font-size: 18pt;
  margin: 0 0 18pt 0;
}
h2 {
  font-family: "Times New Roman", serif;
  mso-fareast-font-family: "Times New Roman";
  font-size: 14pt;
  font-weight: bold;
  margin: 14pt 0 10pt 0;
}
h3 {
  font-family: "Times New Roman", serif;
  mso-fareast-font-family: "Times New Roman";
  font-size: 12pt;
  font-weight: bold;
  margin: 12pt 0 8pt 0;
}
p {
  margin: 0 0 12pt 0;
  text-align: justify;
  line-height: 1.6;
}
.blank-line {
  margin: 0 0 6pt 0;
  line-height: 6pt;
}
.paragraph-references {
  margin: 0 0 12pt 0;
}
.paragraph-references p {
  font-size: 10.5pt;
  line-height: 1.45;
  text-align: left;
  margin: 0 0 4pt 0;
}
.ref-title {
  font-weight: bold;
}
</style>
</head>
<body>
${documentTitleHtml}
${sectionHtml}
</body>
</html>`;
}

function normalizeWordSectionTitle(title: string): string {
  return title
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isWordTitleSection(title: string): boolean {
  const normalized = normalizeWordSectionTitle(title);
  return ['title', '论文标题', '题名'].includes(normalized);
}

function isWordAbstractSection(title: string): boolean {
  const normalized = normalizeWordSectionTitle(title);
  return ['abstract', '摘要'].includes(normalized);
}

function shouldStartWordSectionOnNewPage(sections: Array<{ title: string; content: string }>, index: number): boolean {
  if (index === 0) return false;

  const currentTitle = cleanLatexInlineForWord(sections[index].title);
  const previousTitle = cleanLatexInlineForWord(sections[index - 1].title);

  // Title and Abstract usually belong to the front matter, so keep them together.
  if (isWordAbstractSection(currentTitle) && isWordTitleSection(previousTitle)) {
    return false;
  }

  return true;
}

function wordRunXml(text: string, options: WordParagraphOptions = {}): string {
  const size = options.sizeHalfPoints ?? 24;
  const preserveSpace = /^\s|\s$|\s{2,}/.test(text) ? ' xml:space="preserve"' : '';

  return `<w:r>
<w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
${options.bold ? '<w:b/><w:bCs/>' : ''}
<w:sz w:val="${size}"/>
<w:szCs w:val="${size}"/>
</w:rPr>
<w:t${preserveSpace}>${escapeXmlForWord(text)}</w:t>
</w:r>`;
}

function wordParagraphXml(text: string, options: WordParagraphOptions = {}): string {
  const before = options.before ?? 0;
  const after = options.after ?? 200;
  const line = options.line ?? 384;
  const pPr = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.keepNext ? '<w:keepNext/>' : '',
    `<w:spacing w:before="${before}" w:after="${after}" w:line="${line}" w:lineRule="auto"/>`,
    options.alignment ? `<w:jc w:val="${options.alignment}"/>` : ''
  ].filter(Boolean).join('\n');

  return `<w:p>
<w:pPr>
${pPr}
</w:pPr>
${wordRunXml(text, options)}
</w:p>`;
}

function wordPageBreakXml(): string {
  return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
}

function wordBlankLineXml(): string {
  return wordParagraphXml('', {
    style: 'Normal',
    alignment: 'left',
    before: 0,
    after: 0,
    line: 384,
    sizeHalfPoints: 24
  });
}

function wordReferenceListXml(references: WordReferenceEntry[]): string {
  if (references.length === 0) return '';

  const title = wordParagraphXml('参考文献：', {
    style: 'ReferenceTitle',
    alignment: 'left',
    before: 120,
    after: 80,
    line: 290,
    bold: true,
    sizeHalfPoints: 21
  });

  const items = references.map(reference => wordParagraphXml(reference.raw, {
    style: 'ReferenceItem',
    alignment: 'left',
    before: 0,
    after: 80,
    line: 290,
    sizeHalfPoints: 21
  })).join('\n');

  return `${title}\n${items}`;
}

function wordDraftBlockXml(block: WordDraftBlock): string {
  if (block.type === 'heading') {
    return wordParagraphXml(block.text, {
      style: block.level === 2 ? 'Heading2' : 'Heading3',
      alignment: 'left',
      before: block.level === 2 ? 280 : 240,
      after: block.level === 2 ? 160 : 120,
      line: 320,
      keepNext: true,
      bold: true,
      sizeHalfPoints: block.level === 2 ? 28 : 24
    });
  }

  if (block.type === 'paragraph') {
    return wordParagraphXml(block.text, {
      style: 'Normal',
      alignment: 'both',
      before: 0,
      after: 200,
      line: 384,
      sizeHalfPoints: 24
    });
  }

  return wordReferenceListXml(block.references);
}

export function buildWordDraftDocumentXml(content: string): string {
  const draft = splitDraftForWord(content);
  const sections = draft.sections;
  const body: string[] = [];

  if (draft.documentTitle) {
    body.push(wordParagraphXml(draft.documentTitle, {
      style: 'Title',
      alignment: 'center',
      before: 0,
      after: 360,
      line: 360,
      keepNext: true,
      bold: true,
      sizeHalfPoints: 36
    }));
  }

  sections.forEach((section, index) => {
    const extracted = extractReferenceBlockForWord(section.content);
    const references = parseReferenceEntriesForWord(extracted.references);
    const sectionTitle = cleanLatexInlineForWord(section.title);

    if (shouldStartWordSectionOnNewPage(sections, index)) {
      body.push(wordPageBreakXml());
    }

    if (sectionTitle) {
      body.push(wordParagraphXml(sectionTitle, {
        style: 'Heading1',
        alignment: 'left',
        before: 0,
        after: 240,
        line: 320,
        keepNext: true,
        bold: true,
        sizeHalfPoints: 32
      }));
    }

    const blocks = buildWordDraftBlocks(extracted.body, references);
    body.push(...blocks.map(wordDraftBlockXml));

    if (extracted.trailingBody) {
      body.push(wordBlankLineXml());
      const trailingBlocks = buildWordDraftBlocks(extracted.trailingBody, references, {
        includeUncitedReferences: false,
        appendParagraphReferences: false
      });
      body.push(...trailingBlocks.map(wordDraftBlockXml));
    }
  });

  if (body.length === 0) {
    body.push(wordParagraphXml(''));
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
  xmlns:v="urn:schemas-microsoft-com:vml"
  xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w10="urn:schemas-microsoft-com:office:word"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
  xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
  xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
  xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
  xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
  mc:Ignorable="w14 wp14">
<w:body>
${body.join('\n')}
<w:sectPr>
<w:pgSz w:w="11906" w:h="16838"/>
<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
<w:cols w:space="720"/>
<w:docGrid w:linePitch="360"/>
</w:sectPr>
</w:body>
</w:document>`;
}

export function buildWordDraftStylesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults>
<w:rPrDefault>
<w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="24"/>
<w:szCs w:val="24"/>
</w:rPr>
</w:rPrDefault>
</w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal">
<w:name w:val="Normal"/>
<w:pPr>
<w:spacing w:after="200" w:line="384" w:lineRule="auto"/>
<w:jc w:val="both"/>
</w:pPr>
<w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="24"/>
<w:szCs w:val="24"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Title">
<w:name w:val="Title"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:keepNext/>
<w:spacing w:after="360" w:line="360" w:lineRule="auto"/>
<w:jc w:val="center"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:bCs/>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="36"/>
<w:szCs w:val="36"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading1">
<w:name w:val="heading 1"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:keepNext/>
<w:spacing w:after="240" w:line="320" w:lineRule="auto"/>
<w:outlineLvl w:val="0"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:bCs/>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="32"/>
<w:szCs w:val="32"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading2">
<w:name w:val="heading 2"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:keepNext/>
<w:spacing w:before="280" w:after="160" w:line="320" w:lineRule="auto"/>
<w:outlineLvl w:val="1"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:bCs/>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="28"/>
<w:szCs w:val="28"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="Heading3">
<w:name w:val="heading 3"/>
<w:basedOn w:val="Normal"/>
<w:next w:val="Normal"/>
<w:qFormat/>
<w:pPr>
<w:keepNext/>
<w:spacing w:before="240" w:after="120" w:line="320" w:lineRule="auto"/>
<w:outlineLvl w:val="2"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:bCs/>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="24"/>
<w:szCs w:val="24"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="ReferenceTitle">
<w:name w:val="Reference Title"/>
<w:basedOn w:val="Normal"/>
<w:pPr>
<w:spacing w:before="120" w:after="80" w:line="290" w:lineRule="auto"/>
<w:jc w:val="left"/>
</w:pPr>
<w:rPr>
<w:b/>
<w:bCs/>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="21"/>
<w:szCs w:val="21"/>
</w:rPr>
</w:style>
<w:style w:type="paragraph" w:styleId="ReferenceItem">
<w:name w:val="Reference Item"/>
<w:basedOn w:val="Normal"/>
<w:pPr>
<w:spacing w:after="80" w:line="290" w:lineRule="auto"/>
<w:jc w:val="left"/>
</w:pPr>
<w:rPr>
<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>
<w:sz w:val="21"/>
<w:szCs w:val="21"/>
</w:rPr>
</w:style>
</w:styles>`;
}

function wordDraftSettingsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:zoom w:percent="100"/>
<w:defaultTabStop w:val="720"/>
<w:characterSpacingControl w:val="doNotCompress"/>
</w:settings>`;
}

function wordDraftContentTypesXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
</Types>`;
}

function wordDraftRootRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function wordDraftDocumentRelsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;
}

function appendWordDraftArchiveEntries(archive: ReturnType<typeof archiver>, content: string): void {
  archive.append(wordDraftContentTypesXml(), { name: '[Content_Types].xml' });
  archive.append(wordDraftRootRelsXml(), { name: '_rels/.rels' });
  archive.append(buildWordDraftDocumentXml(content), { name: 'word/document.xml' });
  archive.append(buildWordDraftStylesXml(), { name: 'word/styles.xml' });
  archive.append(wordDraftSettingsXml(), { name: 'word/settings.xml' });
  archive.append(wordDraftDocumentRelsXml(), { name: 'word/_rels/document.xml.rels' });
}

export function buildWordDraftDocxBuffer(content: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer | Uint8Array) => {
      chunks.push(Buffer.from(chunk));
    });
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    appendWordDraftArchiveEntries(archive, content);
    void archive.finalize().catch(reject);
  });
}

export async function writeWordDraftDocx(filePath: string, content: string): Promise<void> {
  const resolvedPath = path.resolve(String(filePath || '').trim());
  if (!resolvedPath || path.extname(resolvedPath).toLowerCase() !== '.docx') {
    throw new Error('Word 草稿输出路径必须是 .docx 文件');
  }
  if (!String(content || '').trim()) {
    throw new Error('草稿内容为空，无法生成 Word 文件');
  }

  await mkdir(path.dirname(resolvedPath), { recursive: true });
  const buffer = await buildWordDraftDocxBuffer(content);
  await writeFile(resolvedPath, buffer);
}

export function sendWordDraftDocx(res: Response, content: string): void {
  const archive = archiver('zip', { zlib: { level: 9 } });

  archive.on('error', (err: Error) => {
    logger.error('[DOCX] Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Word 文档创建失败' });
    }
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', 'attachment; filename="paper-draft.docx"');

  archive.pipe(res);
  appendWordDraftArchiveEntries(archive, content);
  void archive.finalize();
}
