import * as path from 'path';

const SEQUENTIAL_PAGE_IMAGE_PATTERN = /^(page|sheet|slide)[\s_-]*0*(\d+)\.(png|jpe?g|webp|bmp|tiff?)$/i;
const TRANSIENT_QA_DIRECTORY_PATTERN = /^(?:\.?scholar[-_]?harness[-_]?(?:qa|temp)|qa(?:[-_].*)?|review(?:[-_].*)?|render(?:ed)?(?:[-_].*)?|preview(?:[-_].*)?|docx[-_]?(?:pages?|render|preview|qa)|pdf[-_]?(?:pages?|render|preview|qa)|pages?|temp|tmp)$/i;

interface SequentialPageImage {
  directory: string;
  series: string;
  extension: string;
}

function parseSequentialPageImage(filePath: string): SequentialPageImage | null {
  const value = String(filePath || '').trim();
  if (!value) return null;
  const match = SEQUENTIAL_PAGE_IMAGE_PATTERN.exec(path.basename(value));
  if (!match) return null;
  return {
    directory: path.dirname(path.resolve(value)),
    series: match[1].toLowerCase(),
    extension: match[3].toLowerCase(),
  };
}

function normalizeComparablePath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Detect page-by-page Office/PDF visual-QA renders. These files are useful to
 * the agent while checking layout, but they are not user deliverables.
 */
export function isTransientPageQaArtifact(filePath: string): boolean {
  const pageImage = parseSequentialPageImage(filePath);
  if (!pageImage) return false;
  return path.resolve(String(filePath || ''))
    .split(/[\\/]+/)
    .filter(Boolean)
    .some(segment => TRANSIENT_QA_DIRECTORY_PATTERN.test(segment));
}

/**
 * Keep real deliverables while removing sequential page render sets. The
 * directory-name check handles one-at-a-time mirroring; grouping also catches
 * ad-hoc folders when at least two numbered page images were produced.
 */
export function filterUserFacingWorkspaceOutputPaths(filePaths: string[]): string[] {
  const values = (filePaths || [])
    .map(filePath => String(filePath || '').trim())
    .filter(Boolean);
  const groupCounts = new Map<string, number>();

  values.forEach(filePath => {
    const parsed = parseSequentialPageImage(filePath);
    if (!parsed) return;
    const groupKey = [
      normalizeComparablePath(parsed.directory),
      parsed.series,
      parsed.extension,
    ].join('|');
    groupCounts.set(groupKey, (groupCounts.get(groupKey) || 0) + 1);
  });

  return values.filter(filePath => {
    if (isTransientPageQaArtifact(filePath)) return false;
    const parsed = parseSequentialPageImage(filePath);
    if (!parsed) return true;
    const groupKey = [
      normalizeComparablePath(parsed.directory),
      parsed.series,
      parsed.extension,
    ].join('|');
    return (groupCounts.get(groupKey) || 0) < 2;
  });
}
