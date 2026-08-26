#!/usr/bin/env node
/* Diagnose the 16 failing assertions: locate each target string in the
 * current concatenated public source (index.html + styles + app JS), plus the
 * two server-source targets. Prints FOUND/MISSING with a context excerpt. */
'use strict';
const fs = require('fs');
const path = require('path');

const publicDir = path.resolve(__dirname, '..', 'src', 'public');

function readFileLf(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function readPublicAppSource() {
  const html = readFileLf(path.join(publicDir, 'index.html'));
  const linkRe = /<link\b([^>]*)>/gi;
  const scriptRe = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let out = html.replace(linkRe, (tag, attrs) => {
    const rel = String(attrs || '').match(/\brel=["']([^"']+)["']/i);
    const href = String(attrs || '').match(/\bhref=["']([^"']+)["']/i);
    if (!rel || !/\bstylesheet\b/i.test(rel[1]) || !href) return tag;
    if (/^(?:https?:)?\/\//i.test(href[1])) return tag;
    const src = readFileLf(path.join(publicDir, href[1].split(/[?#]/, 1)[0]));
    return `<style data-source="${href[1]}">\n${src}\n</style>`;
  });
  out = out.replace(scriptRe, (tag, attrs, inline) => {
    const src = String(attrs || '').match(/\bsrc=["']([^"']+)["']/i);
    if (!src) return tag;
    if (/^(?:https?:)?\/\//i.test(src[1])) return tag;
    const code = readFileLf(path.join(publicDir, src[1].split(/[?#]/, 1)[0]));
    return `<script${attrs}>\n${code}\n${inline || ''}</script>`;
  });
  return out;
}

const source = readPublicAppSource();
const route = readFileLf(path.resolve(__dirname, '..', 'src', 'server', 'routes', 'chat-bridge.ts'));
const bridge = readFileLf(path.resolve(__dirname, '..', 'src', 'bridge', 'chat-bridge', 'chat-bridge.ts'));

const cases = [
  ['email-workspace: compose view header (multiline)', source, `</h2></div>' +\n        '<div class=`],
  ['output-attachment: content-visibility', source, 'content-visibility: auto;'],
  ['pi-agent-queue: finish with usage (actual)', source, 'attachedRenderer.finish(mainChatAttachedRunText, elapsedMs,'],
  ['ctx-bubble: toggleMainContextSourceBar onclick', source, 'onclick="toggleMainContextSourceBar(event)"'],
  ['ctx-bubble: meta rowCount multiline', source, `'默认使用 Meta 分析数据库中 ' + rowCount +\n            ' 条数据（所有数据）`],
  ['main-chat-input: :has( usage', source, ':has('],
  ['message-retrieval: 正在自动重试', source, '正在自动重试'],
  ['sidebar-layout: setProperty multiline', source, `root.style.setProperty(\n          '--active-left-sidebar-width',`],
  ['color-theme: width 360px', source, 'width: 360px;'],
  ['color-theme: theme-soft dot', source, 'background: var(--theme-soft) !important;'],
  ['pdf-paper-home: loadActivePdfPaperChat', source, 'context.pdfPaperChat = await loadActi'],
  ['meta-ai-composer: dot scale2 multiline', source, `transform: translate(-50%, -50%) scale(2);`],
  ['pdf-wiki-overview: PDF 图片 multiline', source, `? 'PDF 图片'\n          : '论文一览图'`],
  ['drag-provenance: hasVisualReferenceAttachments', source, 'var hasVisualReferenceAttachments = h'],
  ['codex-isolation: ternary 10sp', route, 'shouldUseAgentToolLoop\n          ? a'],
  ['codex-isolation: ternary 8sp', route, 'shouldUseAgentToolLoop\n        ? a'],
  ['meta-shared-agent: tool spread', bridge, '...skillTools, ...draftTools, ...rese'],
];

for (const [name, haystack, needle] of cases) {
  const idx = haystack.indexOf(needle);
  if (idx < 0) {
    console.log(`MISSING  ${name}`);
    continue;
  }
  const before = haystack.slice(Math.max(0, idx - 40), idx).replace(/\n/g, '\\n');
  const after = haystack.slice(idx, idx + needle.length + 60).replace(/\n/g, '\\n');
  console.log(`FOUND    ${name}\n         ...${before}|${after}|`);
}
