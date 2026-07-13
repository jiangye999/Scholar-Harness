export interface ExplicitWorkspaceFileWriteIntent {
  target: string;
  operation: 'write';
}

const WRITE_ACTION_PATTERN = /(?:更新|修改|编辑|改写|重写|写入|写回|覆盖|替换|追加|保存(?:到)?|同步(?:到)?|update|modify|edit|rewrite|write(?:\s+back)?|overwrite|replace|append|save(?:\s+to)?|sync(?:\s+to)?)/i;
const FILE_NOUN_PATTERN = /(?:文件|文档|工作簿|表格|演示文稿|脚本|代码|file|document|workbook|spreadsheet|presentation|script)/i;
const FILE_EXTENSION_PATTERN = /(?:docx?|xlsx?|pptx?|pdf|rtf|odt|ods|odp|txt|md|markdown|tex|csv|tsv|json|ya?ml|xml|html?|css|jsx?|tsx?|mjs|cjs|py|r|rmd|qmd|ipynb|sql|png|jpe?g|gif|bmp|webp|tiff?|svg)/i;

function cleanFileTarget(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/^[`"'“”‘’《》【】\s]+|[`"'“”‘’《》【】\s]+$/g, '')
    .replace(/[，。；;、!?！？]+$/g, '')
    .trim();
}

function isPlausibleFileTarget(value: string): boolean {
  if (!value || value.length < 2 || value.length > 260) return false;
  if (/^(?:这个|该|当前|目标|以下|上面|刚才|内容|正文|章节|草稿|文件|文档)$/i.test(value)) return false;
  return /[a-z0-9_\-.\\/\u3400-\u9fff]/i.test(value);
}

function firstPlausibleTarget(candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const target = cleanFileTarget(candidate);
    if (isPlausibleFileTarget(target)) return target;
  }
  return null;
}

/**
 * Detects an explicit request to mutate a named workspace file. The target may
 * be a full path, a file name with an extension, or a stem supplied after a
 * label such as "更新这个文件：paper-draft".
 */
export function extractExplicitWorkspaceFileWriteIntent(value: unknown): ExplicitWorkspaceFileWriteIntent | null {
  const text = String(value || '').trim();
  if (!text || !WRITE_ACTION_PATTERN.test(text)) return null;

  const candidates: unknown[] = [];

  const windowsPath = text.match(/([A-Za-z]:[\\/][^\r\n，。；;!?！？]{2,260})/);
  if (windowsPath?.[1]) candidates.push(windowsPath[1]);

  const quotedTargets = Array.from(text.matchAll(/[`"'“‘《【]([^`"'”’》】\r\n]{2,260})[`"'”’》】]/g));
  for (const match of quotedTargets) {
    if (FILE_NOUN_PATTERN.test(text) || FILE_EXTENSION_PATTERN.test(match[1] || '')) {
      candidates.push(match[1]);
    }
  }

  const extensionPattern = new RegExp(
    `([^\\s，。；;、!?！？<>|"'“”‘’]{2,220}\\.${FILE_EXTENSION_PATTERN.source})`,
    'i',
  );
  const extensionTarget = text.match(extensionPattern);
  if (extensionTarget?.[1]) candidates.push(extensionTarget[1]);

  const labelledTarget = text.match(
    /(?:这个|该|当前|目标|以下|上面|刚才的)?\s*(?:文件|文档|工作簿|表格|演示文稿|脚本|代码|file|document|workbook|spreadsheet|presentation|script)\s*(?:名(?:称)?\s*)?(?:是|为)?\s*[:：]?\s*[`"'“‘]?([^\s，。；;、!?！？`"'”’<>|]{2,220})/i,
  );
  if (labelledTarget?.[1]) candidates.push(labelledTarget[1]);

  const directTarget = text.match(
    /(?:更新|修改|编辑|改写|重写|写入|写回|覆盖|替换|追加|update|modify|edit|rewrite|overwrite|replace)\s*(?:到|至|into|to)?\s*[:：]?\s*[`"'“‘]?([A-Za-z0-9_\-.\\/\u3400-\u9fff]{2,220})/i,
  );
  if (
    directTarget?.[1]
    && /[._\-\\/]/.test(directTarget[1])
    && !/^(?:这个|该|当前|目标|以下|上面|刚才的)?(?:文件|文档)$/i.test(directTarget[1])
  ) {
    candidates.push(directTarget[1]);
  }

  const target = firstPlausibleTarget(candidates);
  return target ? { target, operation: 'write' } : null;
}
