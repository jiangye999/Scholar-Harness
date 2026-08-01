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

const inlineStyleTags = [...html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)];
const stylesheets = [...html.matchAll(/<link\b([^>]*)>/gi)]
  .map((match, index) => {
    const attrs = match[1] || '';
    const relMatch = attrs.match(/\brel=["']([^"']+)["']/i);
    const hrefMatch = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!relMatch || !/\bstylesheet\b/i.test(relMatch[1]) || !hrefMatch) return null;

    const href = hrefMatch[1];
    if (/^(?:https?:)?\/\//i.test(href)) return null;

    const localHref = href.split(/[?#]/, 1)[0];
    const stylesheetPath = path.resolve(publicDir, localHref.replace(/^\/+/, ''));
    return {
      index,
      label: href,
      code: fs.readFileSync(stylesheetPath, 'utf8'),
    };
  })
  .filter(Boolean);

if (inlineStyleTags.length === 0 && stylesheets.length === 0) {
  hasError = true;
  console.error('[Public JS] Missing page styles: no inline styles or local stylesheets found');
}

function validateCssBraces(source, label) {
  let depth = 0;
  let quote = '';
  let inComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inComment) {
      if (char === '*' && next === '/') {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = '';
      }
      continue;
    }

    if (char === '/' && next === '*') {
      inComment = true;
      index += 1;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth < 0) break;
    }
  }

  if (depth !== 0 || quote || inComment) {
    hasError = true;
    console.error(
      `[Public JS] Invalid CSS structure in ${label}: depth=${depth}, quote=${Boolean(quote)}, comment=${inComment}`
    );
  }
}

inlineStyleTags.forEach((match, index) => validateCssBraces(match[2], `inline style ${index}`));
stylesheets.forEach((stylesheet) => validateCssBraces(stylesheet.code, stylesheet.label));

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

    const localSrc = src.split(/[?#]/, 1)[0];
    const srcPath = path.resolve(publicDir, localSrc.replace(/^\/+/, ''));
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

console.log(
  `[Public JS] Checked ${scripts.length} script file/block(s) and ` +
  `${stylesheets.length + inlineStyleTags.length} style file/block(s)`
);
