const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(process.argv[2] || path.join(repoRoot, 'artifacts', 'vendor-inspection', 'AI-Research-SKILLs'));
const packRoot = path.join(repoRoot, 'skill-packs', 'orchestra-ai-research');
const vendorRoot = path.join(packRoot, 'vendor');
const categoryPattern = /^(?:0-autoresearch-skill|\d{2}-)/;

function isPathWithin(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function readFrontmatterField(content, field) {
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1] || '';
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(new RegExp(`^${escaped}\\s*:\\s*(.+)$`, 'im').exec(frontmatter)?.[1] || '')
    .trim()
    .replace(/^(["'])([\s\S]*)\1$/, '$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferSkillMetadata(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const heading = /^\s*#\s+(.+)$/m.exec(content)?.[1]?.trim() || '';
  return {
    name: readFrontmatterField(content, 'name') || heading || path.basename(path.dirname(filePath)),
    description: readFrontmatterField(content, 'description'),
  };
}

if (!fs.existsSync(path.join(sourceRoot, 'LICENSE'))) {
  throw new Error(`Upstream repository not found: ${sourceRoot}`);
}
if (!isPathWithin(repoRoot, vendorRoot)) {
  throw new Error(`Unsafe vendor target: ${vendorRoot}`);
}

const categories = fs.readdirSync(sourceRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && categoryPattern.test(entry.name))
  .map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b));

if (categories.length !== 23) {
  throw new Error(`Expected 23 upstream categories, found ${categories.length}`);
}

fs.rmSync(vendorRoot, { recursive: true, force: true });
fs.mkdirSync(vendorRoot, { recursive: true });
for (const category of categories) {
  fs.cpSync(path.join(sourceRoot, category), path.join(vendorRoot, category), { recursive: true });
}
fs.copyFileSync(path.join(sourceRoot, 'LICENSE'), path.join(packRoot, 'LICENSE'));

const skillFiles = [];
function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(fullPath);
    else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') skillFiles.push(fullPath);
  }
}
visit(vendorRoot);
skillFiles.sort((a, b) => a.localeCompare(b));
if (skillFiles.length !== 98) {
  throw new Error(`Expected 98 SKILL.md files, found ${skillFiles.length}`);
}

let commit = 'unknown';
try {
  commit = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
} catch {
  // A source archive may not include .git; pack.json remains authoritative.
}

const lines = [
  '# Orchestra AI Research SKILLs Index',
  '',
  `- Source: https://github.com/Orchestra-Research/AI-Research-SKILLs`,
  `- Vendored commit: \`${commit}\``,
  `- Skills: ${skillFiles.length}`,
  `- Categories: ${categories.length}`,
  '',
  'Read only the sub-skill needed for the current request. Paths below are relative to this pack root.',
  '',
];

for (const category of categories) {
  lines.push(`## ${category}`, '');
  const categoryPrefix = `${path.sep}${category}${path.sep}`.toLowerCase();
  for (const filePath of skillFiles.filter(file => file.toLowerCase().includes(categoryPrefix))) {
    const relativePath = path.relative(packRoot, filePath).split(path.sep).join('/');
    const metadata = inferSkillMetadata(filePath);
    lines.push(`- [${metadata.name}](${relativePath})${metadata.description ? `: ${metadata.description}` : ''}`);
  }
  lines.push('');
}

fs.writeFileSync(path.join(packRoot, 'INDEX.md'), `${lines.join('\n').trim()}\n`, 'utf8');
console.log(`[Orchestra Skills] Synced ${skillFiles.length} skills across ${categories.length} categories from ${commit}.`);
