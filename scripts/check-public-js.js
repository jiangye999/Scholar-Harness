const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'src', 'public', 'index.html');
const publicDir = path.dirname(htmlPath);
const html = fs.readFileSync(htmlPath, 'utf8');
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

let hasError = false;

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
