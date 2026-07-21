const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'src', 'public', 'index.html');
const publicDir = path.dirname(htmlPath);
const html = fs.readFileSync(htmlPath, 'utf8');

function countStandaloneTags(pattern) {
  return (html.match(pattern) || []).length;
}

const structureChecks = [
  {
    label: 'script tags',
    open: countStandaloneTags(/^\s*<script(?:\s[^>]*)?>\s*$/gim),
    close: countStandaloneTags(/^\s*<\/script>\s*$/gim),
  },
  {
    label: 'style tags',
    open: countStandaloneTags(/^\s*<style(?:\s[^>]*)?>\s*$/gim),
    close: countStandaloneTags(/^\s*<\/style>\s*$/gim),
  },
  {
    label: 'body tags',
    open: countStandaloneTags(/^\s*<body(?:\s[^>]*)?>\s*$/gim),
    close: countStandaloneTags(/^\s*<\/body>\s*$/gim),
  },
];

let hasError = false;

structureChecks.forEach((check) => {
  if (check.open !== check.close || check.open === 0) {
    hasError = true;
    console.error(`[Public JS] Invalid HTML structure: ${check.label} open=${check.open}, close=${check.close}`);
  }
});

[
  { label: 'main chat input', pattern: /\bid=["']userInput["']/i },
  { label: 'main application shell', pattern: /\bclass=["'][^"']*\bmain\b[^"']*["']/i },
].forEach((required) => {
  if (!required.pattern.test(html)) {
    hasError = true;
    console.error(`[Public JS] Missing required page structure: ${required.label}`);
  }
});

const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)]
  .map((match, index) => {
    const attrs = match[1] || '';
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcMatch) {
      return { index, label: `inline script ${index}`, code: match[2] };
    }

    const src = srcMatch[1];
    if (/^https?:\/\//i.test(src)) {
      return null;
    }

    const srcPath = path.resolve(publicDir, src.replace(/^\/+/, ''));
    return {
      index,
      label: src,
      code: fs.readFileSync(srcPath, 'utf8'),
    };
  })
  .filter(Boolean);

scripts.forEach((script, index) => {
  try {
    new Function(script.code);
  } catch (error) {
    hasError = true;
    console.error(`[Public JS] Syntax error in ${script.label}: ${error.message}`);
  }
});

if (hasError) {
  process.exit(1);
}

console.log(`[Public JS] Checked ${scripts.length} script file/block(s)`);
