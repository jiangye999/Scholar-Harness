function textValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const text = textValue(value).trim();
    if (text) return text;
  }
  return '';
}

function parsePageNumber(record: Record<string, unknown>): number {
  const page = firstText(record.page, record.pages, record.page_number, record.pageNumber);
  const match = page.match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function parsePositiveNumber(...values: unknown[]): number {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return 0;
}

/**
 * Deterministic local classification for PDF image assets. Extraction
 * provenance and geometry are safer here than asking an AI to judge every
 * image during a large batch.
 */
export function isNonScientificPdfFigureRecord(
  record: Record<string, unknown>,
  fileName = ''
): boolean {
  const text = [
    fileName,
    record.id,
    record.figure_id,
    record.figureId,
    record.number,
    record.label,
    record.name,
    record.title,
    record.caption,
    record.captionTitle,
    record.description,
    record.note,
    record.ocr_text,
    record.ocrText,
    record.nearbyText,
    record.contextBefore,
    record.contextAfter,
    record.source,
    record.type,
  ].map(textValue).join(' ').replace(/\s+/g, ' ').toLowerCase();

  if (/(elsevier|springer|wiley|mdpi|frontiers|sciencedirect|geoderma|publisher)\s+(logo|mark|brand|cover)/i.test(text)) {
    return true;
  }
  if (/(logo|decorative|decoration|ornament|placeholder|misembedded|cover\s+page|journal\s+cover|front\s+cover|cover\s+image|publisher\s+mark|期刊封面|出版社标志|出版社\s*logo|装饰图|占位图)/i.test(text)) {
    return true;
  }
  if (/(not\s+(?:a\s+)?scientific\s+figure|not\s+the\s+actual\s+figure|not\s+a\s+data\s+figure|not\s+.*with\s+data)/i.test(text)) {
    return true;
  }
  if (/(no\s+(?:axes|axis|labels?|numerical\s+data|numeric\s+data|data\s+visible|chart|graph|table\s+content)|cannot\s+extract\s+meaningful\s+data|no\s+meaningful\s+data)/i.test(text)) {
    return true;
  }

  const source = firstText(record.source, record.type).toLowerCase();
  const pageNumber = parsePageNumber(record);
  const caption = firstText(record.caption, record.caption_text, record.captionText);
  const captionTitle = firstText(record.captionTitle, record.caption_title, record.title);
  const genericExtractionTitle = /^(?:embedded image from pdf page|detected visual region on pdf page|fallback rendered pdf page)\b/i.test(captionTitle);
  const hasRealCaption = /(?:fig(?:ure)?\.?|table|图|表)\s*(?:\d+|[ivxlcdm]+|[一二三四五六七八九十百]+)/i.test(caption)
    || (!!captionTitle.trim() && !genericExtractionTitle);
  const isEmbeddedImage = /embedded[-_\s]?image/.test(source);
  const contentHash = firstText(record.contentHash, record.content_hash);
  const hasExtractionGeometry = parsePositiveNumber(
    record.width,
    record.imageWidth,
    record.rectWidth,
    record.rect_width
  ) > 0;

  // Publisher marks and journal covers are commonly stored as large,
  // high-resolution image assets on the title page without a real caption.
  if (pageNumber === 1 && isEmbeddedImage && !hasRealCaption) {
    return true;
  }
  // Legacy extraction records did not persist geometry or a content hash and
  // could bind a later body paragraph mentioning "Fig. 1" to a title-page
  // publisher image. Treat those unreliable page-1 embedded assets as
  // boilerplate; current extraction records carry geometry/hash metadata.
  if (pageNumber === 1 && isEmbeddedImage && !contentHash && !hasExtractionGeometry) {
    return true;
  }

  const width = parsePositiveNumber(record.width, record.imageWidth, record.rectWidth);
  const height = parsePositiveNumber(record.height, record.imageHeight, record.rectHeight);
  const aspectRatio = width > 0 && height > 0 ? width / height : 0;
  const pageAreaRatio = parsePositiveNumber(record.pageAreaRatio, record.page_area_ratio);
  if (isEmbeddedImage && !hasRealCaption) {
    if (pageAreaRatio > 0 && pageAreaRatio < 0.018) return true;
    if (aspectRatio > 6.5 || (aspectRatio > 0 && aspectRatio < 0.12)) return true;
  }

  return false;
}
