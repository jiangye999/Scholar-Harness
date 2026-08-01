import mammoth = require('mammoth');

export interface WordSidebarImportImage {
  index: number;
  contentType: string;
  buffer: Buffer;
  figureLabel: string;
  caption: string;
  chapterKey: string;
  chapterTitle: string;
}

export interface WordSidebarImportSection {
  key: string;
  title: string;
  content: string;
}

export interface WordSidebarImportResult {
  sections: WordSidebarImportSection[];
  images: WordSidebarImportImage[];
  warnings: string[];
}

interface WordHtmlBlock {
  kind: 'heading' | 'paragraph' | 'image';
  level?: number;
  text: string;
  imageIndex?: number;
}

const WORD_CHAPTER_ALIASES: Array<{
  key: string;
  title: string;
  patterns: RegExp[];
}> = [
  { key: 'title', title: 'Title', patterns: [/^(?:title|题目|标题)$/i] },
  { key: 'abstract', title: 'Abstract', patterns: [/^(?:abstract|summary|摘要|概要)$/i] },
  {
    key: 'introduction',
    title: 'Introduction',
    patterns: [/^(?:introduction|background|intro|引言|绪论|研究背景)$/i],
  },
  {
    key: 'methods',
    title: 'Materials and Methods',
    patterns: [
      /^(?:materials?\s+and\s+methods?|materials?\s*&\s*methods?|methods?|methodology|experimental\s+(?:design|procedures?)|材料与方法|材料和方法|研究方法|方法)$/i,
    ],
  },
  {
    key: 'results_discussion',
    title: 'Results and Discussion',
    patterns: [/^(?:results?\s+and\s+discussion|results?\s*&\s*discussion|结果与讨论|结果和讨论)$/i],
  },
  { key: 'results', title: 'Results', patterns: [/^(?:results?|findings|结果|研究结果)$/i] },
  {
    key: 'discussion',
    title: 'Discussion',
    patterns: [
      /^(?:discussion|general\s+discussion|discussion\s+and\s+(?:implications?|conclusions?|outlook)|讨论|讨论与(?:启示|展望|结论)|综合讨论)$/i,
    ],
  },
  {
    key: 'conclusion',
    title: 'Conclusion',
    patterns: [/^(?:conclusions?|concluding\s+remarks|summary\s+and\s+conclusions?|结论|结论与展望|总结与展望|展望)$/i],
  },
  {
    key: 'references',
    title: 'References',
    patterns: [/^(?:references?|bibliography|literature\s+cited|参考文献)$/i],
  },
  {
    key: 'acknowledgements',
    title: 'Acknowledgements',
    patterns: [/^(?:acknowledg(?:e)?ments?|致谢)$/i],
  },
  {
    key: 'supplementary_materials',
    title: 'Supplementary Materials',
    patterns: [/^(?:supplementary\s+(?:materials?|information)|supporting\s+information|补充材料|附录)$/i],
  },
];

function decodeHtmlEntities(value: string): string {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function htmlFragmentToText(value: string): string {
  return decodeHtmlEntities(
    String(value || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<\/td>/gi, '\t')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeHeading(value: string): string {
  return String(value || '')
    // A numeral is a heading prefix only when it is followed by punctuation
    // or whitespace. Without that boundary, words such as "Discussion"
    // (starting with valid Roman-numeral letters D/I/C) are truncated.
    .replace(/^\s*(?:chapter\s+)?(?:[ivxlcdm]+|\d+(?:\.\d+)*)(?:\s*[.)、:：-]\s*|\s+)/i, '')
    .replace(/[：:。.\s_-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function identifyWordSidebarChapter(value: string): { key: string; title: string } | null {
  const heading = normalizeHeading(value);
  if (!heading || heading.length > 100) return null;
  for (const alias of WORD_CHAPTER_ALIASES) {
    if (alias.patterns.some(pattern => pattern.test(heading))) {
      return { key: alias.key, title: alias.title };
    }
  }
  return null;
}

function extractImageIndexes(fragment: string): number[] {
  const indexes: number[] = [];
  const pattern = /word-sidebar-image:\/\/(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(String(fragment || ''))) !== null) {
    indexes.push(Number(match[1]));
  }
  return indexes;
}

function parseWordHtmlBlocks(html: string): WordHtmlBlock[] {
  const blocks: WordHtmlBlock[] = [];
  const blockPattern = /<(h[1-6]|p|li|figcaption|table)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(String(html || ''))) !== null) {
    const tag = match[1].toLowerCase();
    const inner = match[2] || '';
    const imageIndexes = extractImageIndexes(inner);
    for (const imageIndex of imageIndexes) {
      blocks.push({ kind: 'image', text: '', imageIndex });
    }
    const text = htmlFragmentToText(inner);
    if (!text) continue;
    const headingKind = /^h[1-6]$/.test(tag);
    const leadingEmphasis = !headingKind
      ? inner.match(/^\s*<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>([\s\S]*)$/i)
      : null;
    const emphasizedChapter = leadingEmphasis
      ? identifyWordSidebarChapter(htmlFragmentToText(leadingEmphasis[2]))
      : null;
    if (emphasizedChapter && leadingEmphasis) {
      blocks.push({
        kind: 'heading',
        level: 1,
        text: htmlFragmentToText(leadingEmphasis[2]),
      });
      const remainingText = htmlFragmentToText(leadingEmphasis[3]);
      if (remainingText) {
        blocks.push({ kind: 'paragraph', text: remainingText });
      }
      continue;
    }
    if (!headingKind && text.includes('\n')) {
      const lines = text.split(/\n+/).map(line => line.trim()).filter(Boolean);
      if (lines.length > 1 && identifyWordSidebarChapter(lines[0])) {
        blocks.push({ kind: 'heading', level: 1, text: lines[0] });
        blocks.push({ kind: 'paragraph', text: lines.slice(1).join('\n') });
        continue;
      }
    }
    blocks.push({
      kind: headingKind ? 'heading' : 'paragraph',
      level: headingKind ? Number(tag.slice(1)) : undefined,
      text,
    });
  }
  return blocks;
}

function normalizeDraftText(value: string): string {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectFigureCaption(value: string): { label: string; caption: string } | null {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(?:(Figure|Fig\.?|图)\s*([Ss]?\d+(?:\s*[-.]\s*[A-Za-z0-9]+)?(?:\s*\([A-Za-z0-9]+\))?))\s*[.:：-]?\s*(.*)$/i);
  if (!match) return null;
  const rawPrefix = /^图$/i.test(match[1]) ? '图' : 'Figure';
  const number = String(match[2] || '').replace(/\s+/g, '');
  return {
    label: `${rawPrefix} ${number}`.trim(),
    caption: text,
  };
}

export function parseWordSidebarHtml(
  html: string,
  imageInputs: Array<Pick<WordSidebarImportImage, 'index' | 'contentType' | 'buffer'>>
): WordSidebarImportResult {
  const blocks = parseWordHtmlBlocks(html);
  const warnings: string[] = [];
  const sections: WordSidebarImportSection[] = [];
  const sectionByKey = new Map<string, WordSidebarImportSection>();
  const imageContext = new Map<number, {
    chapterKey: string;
    chapterTitle: string;
    previousText: string;
    nextText: string;
  }>();
  let activeSection: WordSidebarImportSection | null = null;
  let pendingPreamble: string[] = [];

  const ensureSection = (key: string, title: string): WordSidebarImportSection => {
    const existing = sectionByKey.get(key);
    if (existing) return existing;
    const created = { key, title, content: '' };
    sectionByKey.set(key, created);
    sections.push(created);
    return created;
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const detected = block.kind !== 'image' ? identifyWordSidebarChapter(block.text) : null;
    if (detected) {
      activeSection = ensureSection(detected.key, detected.title);
      if (detected.key !== 'title' && pendingPreamble.length > 0 && !sectionByKey.has('title')) {
        const titleSection = ensureSection('title', 'Title');
        titleSection.content = normalizeDraftText(pendingPreamble[0]);
      }
      pendingPreamble = [];
      continue;
    }

    if (block.kind === 'image' && block.imageIndex !== undefined) {
      const previousText = [...blocks.slice(Math.max(0, index - 2), index)]
        .reverse()
        .find(item => item.kind !== 'image' && item.text)?.text || '';
      const nextText = blocks.slice(index + 1, index + 4)
        .find(item => item.kind !== 'image' && item.text)?.text || '';
      imageContext.set(block.imageIndex, {
        chapterKey: activeSection?.key || 'paper-figures',
        chapterTitle: activeSection?.title || '论文图片',
        previousText,
        nextText,
      });
      continue;
    }

    if (!activeSection) {
      if (block.text) pendingPreamble.push(block.text);
      continue;
    }

    const isSubheading = block.kind === 'heading'
      || (block.text.length <= 120 && /^(?:\d+(?:\.\d+)+|[A-Z]\.)\s+/.test(block.text));
    const addition = isSubheading
      ? `\\subsection{${block.text.replace(/[{}]/g, '')}}`
      : block.text;
    activeSection.content = normalizeDraftText(
      activeSection.content ? `${activeSection.content}\n\n${addition}` : addition
    );
  }

  if (!sections.length && pendingPreamble.length > 0) {
    warnings.push('Word 中未识别到标准章节标题，未自动覆盖章节草稿。');
  } else if (pendingPreamble.length > 0 && !sectionByKey.has('title')) {
    const titleSection = ensureSection('title', 'Title');
    titleSection.content = normalizeDraftText(pendingPreamble[0]);
  }

  const images = imageInputs.map((image, position) => {
    const context = imageContext.get(image.index) || {
      chapterKey: 'paper-figures',
      chapterTitle: '论文图片',
      previousText: '',
      nextText: '',
    };
    const caption = detectFigureCaption(context.nextText)
      || detectFigureCaption(context.previousText)
      || { label: `Figure ${position + 1}`, caption: '' };
    return {
      ...image,
      figureLabel: caption.label,
      caption: caption.caption,
      chapterKey: context.chapterKey,
      chapterTitle: context.chapterTitle,
    };
  });

  return {
    sections: sections
      .map(section => ({ ...section, content: normalizeDraftText(section.content) }))
      .filter(section => section.content),
    images,
    warnings,
  };
}

export async function parseWordSidebarDocument(buffer: Buffer): Promise<WordSidebarImportResult> {
  const capturedImages: Array<Pick<WordSidebarImportImage, 'index' | 'contentType' | 'buffer'>> = [];
  const result = await mammoth.convertToHtml({ buffer }, {
    styleMap: [
      "p[style-name='Title'] => h1:fresh",
      "p[style-name='Heading 1'] => h1:fresh",
      "p[style-name='Heading 2'] => h2:fresh",
      "p[style-name='Heading 3'] => h3:fresh",
      "p[style-name='Heading1'] => h1:fresh",
      "p[style-name='Heading2'] => h2:fresh",
      "p[style-name='Heading3'] => h3:fresh",
      "p[style-name='标题 1'] => h1:fresh",
      "p[style-name='标题 2'] => h2:fresh",
      "p[style-name='标题 3'] => h3:fresh",
      "p[style-name='标题1'] => h1:fresh",
      "p[style-name='标题2'] => h2:fresh",
      "p[style-name='标题3'] => h3:fresh",
      "p[style-name='一级标题'] => h1:fresh",
      "p[style-name='二级标题'] => h2:fresh",
      "p[style-name='三级标题'] => h3:fresh",
    ],
    convertImage: mammoth.images.imgElement(async image => {
      const index = capturedImages.length;
      capturedImages.push({
        index,
        contentType: String(image.contentType || 'image/png').toLowerCase(),
        buffer: await image.readAsBuffer(),
      });
      return { src: `word-sidebar-image://${index}` };
    }),
    externalFileAccess: false,
    ignoreEmptyParagraphs: false,
  });
  const parsed = parseWordSidebarHtml(result.value, capturedImages);
  const mammothWarnings = (result.messages || [])
    .map(message => String(message.message || '').trim())
    .filter(Boolean);
  parsed.warnings.push(...mammothWarnings);
  return parsed;
}
