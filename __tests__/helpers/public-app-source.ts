import { readFileSync } from 'fs';
import path from 'path';

const SCRIPT_TAG_PATTERN = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
const LINK_TAG_PATTERN = /<link\b([^>]*)>/gi;

export function readPublicModuleSource(relativePath: string): string {
  const publicDir = path.resolve(process.cwd(), 'src/public');
  const normalizedPath = relativePath.replace(/^[/\\]+/, '');
  return readFileSync(path.resolve(publicDir, normalizedPath), 'utf8');
}

export function readPublicStyleSource(relativePath: string): string {
  return readPublicModuleSource(relativePath);
}

/**
 * Returns the public application source with local classic scripts expanded in
 * document order. Source-contract tests can keep inspecting complete feature
 * flows after index.html is split into maintainable runtime modules.
 */
export function readPublicAppSource(): string {
  const publicDir = path.resolve(process.cwd(), 'src/public');
  const htmlPath = path.join(publicDir, 'index.html');
  const html = readFileSync(htmlPath, 'utf8');

  const withStyles = html.replace(LINK_TAG_PATTERN, (tag, attributes: string) => {
    const relMatch = String(attributes || '').match(/\brel=["']([^"']+)["']/i);
    const sourceMatch = String(attributes || '').match(/\bhref=["']([^"']+)["']/i);
    if (!relMatch || !/\bstylesheet\b/i.test(relMatch[1]) || !sourceMatch) return tag;

    const sourceUrl = sourceMatch[1];
    if (/^(?:https?:)?\/\//i.test(sourceUrl)) return tag;

    const sourceCode = readPublicStyleSource(sourceUrl.split(/[?#]/, 1)[0]);
    return `<style data-source="${sourceUrl}">\n${sourceCode}\n</style>`;
  });

  return withStyles.replace(SCRIPT_TAG_PATTERN, (tag, attributes: string, inlineCode: string) => {
    const sourceMatch = String(attributes || '').match(/\bsrc=["']([^"']+)["']/i);
    if (!sourceMatch) return tag;

    const sourceUrl = sourceMatch[1];
    if (/^(?:https?:)?\/\//i.test(sourceUrl)) return tag;

    const sourceCode = readPublicModuleSource(sourceUrl.split(/[?#]/, 1)[0]);
    return `<script${attributes}>\n${sourceCode}\n${inlineCode || ''}</script>`;
  });
}
